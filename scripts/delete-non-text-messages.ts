import mongoose from "mongoose";
import { S3Client, DeleteObjectCommand, ListObjectsV2Command, DeleteObjectsCommand, HeadBucketCommand } from "@aws-sdk/client-s3";

const MONGODB_URI = process.env.MONGODB_URI!;
const DB_NAME = "cpaas-platform";
const BUCKET = process.env.MINIO_BUCKET || "whatsapp-media";
const ENDPOINT = process.env.MINIO_ENDPOINT || "http://localhost:9000";
const ACCESS_KEY = process.env.MINIO_ROOT_USER || "minioadmin";
const SECRET_KEY = process.env.MINIO_ROOT_PASSWORD || "minioadmin123";

const s3 = new S3Client({
  endpoint: ENDPOINT,
  region: "us-east-1",
  credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
  forcePathStyle: true,
});

function ts(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

async function deleteAllMinIOObjects(): Promise<number> {
  let deleted = 0;
  let continuationToken: string | undefined;

  do {
    const listResult = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      MaxKeys: 1000,
      ContinuationToken: continuationToken,
    }));

    const objects = listResult.Contents || [];
    if (objects.length === 0) break;

    for (const obj of objects) {
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: obj.Key! }));
        deleted++;
      } catch (e: any) {
        console.warn(`${ts()} [cleanup] Failed to delete ${obj.Key}: ${e.message}`);
      }
    }
    console.log(`${ts()} [cleanup] Deleted ${deleted} objects from MinIO so far...`);

    continuationToken = listResult.IsTruncated ? listResult.NextContinuationToken : undefined;
  } while (continuationToken);

  return deleted;
}

async function run() {
  console.log(`${ts()} [cleanup] Starting deletion of all non-text messages...`);

  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
    console.log(`${ts()} [cleanup] MinIO bucket '${BUCKET}' accessible`);
  } catch (err: any) {
    console.warn(`${ts()} [cleanup] MinIO not accessible: ${err.message} — will skip S3 cleanup`);
  }

  await mongoose.connect(MONGODB_URI, { dbName: DB_NAME, maxPoolSize: 5, socketTimeoutMS: 120000 });
  console.log(`${ts()} [cleanup] MongoDB connected`);

  const db = mongoose.connection.db!;
  const messagesCol = db.collection("messages");

  const nonTextTypes = ["IMAGE", "VIDEO", "AUDIO", "DOCUMENT", "FILE", "STICKER"];

  const countBefore = await messagesCol.countDocuments({ type: { $in: nonTextTypes } });
  const totalMessages = await messagesCol.countDocuments({});
  console.log(`${ts()} [cleanup] Found ${countBefore} non-text messages out of ${totalMessages} total`);

  if (countBefore === 0) {
    console.log(`${ts()} [cleanup] No non-text messages found. Checking for leftover base64 fields...`);
  }

  console.log(`${ts()} [cleanup] Step 1: Deleting ALL objects from MinIO bucket '${BUCKET}'...`);
  try {
    const minioDeleted = await deleteAllMinIOObjects();
    console.log(`${ts()} [cleanup] Deleted ${minioDeleted} objects from MinIO`);
  } catch (err: any) {
    console.warn(`${ts()} [cleanup] MinIO cleanup error: ${err.message}`);
  }

  console.log(`${ts()} [cleanup] Step 2: Deleting non-text messages from MongoDB...`);
  const deleteResult = await messagesCol.deleteMany({ type: { $in: nonTextTypes } });
  console.log(`${ts()} [cleanup] Deleted ${deleteResult.deletedCount} non-text messages from MongoDB`);

  console.log(`${ts()} [cleanup] Step 3: Cleaning up any remaining base64/mediaKey fields on text messages...`);
  const cleanupResult1 = await messagesCol.updateMany(
    {
      $or: [
        { "metadata.base64": { $exists: true } },
        { "metadata.mediaKey": { $exists: true } },
      ],
    },
    {
      $unset: {
        "metadata.base64": "",
        "metadata.mediaKey": "",
      },
    }
  );
  const cleanupResult2 = await messagesCol.updateMany(
    { "metadata.mediaInfo": { $exists: true } },
    { $unset: { "metadata.mediaInfo": "" } }
  );
  console.log(`${ts()} [cleanup] Cleaned up ${cleanupResult1.modifiedCount + cleanupResult2.modifiedCount} remaining documents`);

  const remaining = await messagesCol.countDocuments({});
  console.log(`${ts()} [cleanup] ════════════════════════════════`);
  console.log(`${ts()} [cleanup] Cleanup complete!`);
  console.log(`${ts()} [cleanup]   Non-text deleted: ${deleteResult.deletedCount}`);
  console.log(`${ts()} [cleanup]   Messages remaining: ${remaining}`);
  console.log(`${ts()} [cleanup] ════════════════════════════════`);

  await mongoose.disconnect();
  console.log(`${ts()} [cleanup] Done.`);
}

run().catch((err) => {
  console.error(`${ts()} [cleanup] FATAL:`, err);
  process.exit(1);
});

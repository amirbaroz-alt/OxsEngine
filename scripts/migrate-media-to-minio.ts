import mongoose from "mongoose";
import { S3Client, PutObjectCommand, HeadObjectCommand, HeadBucketCommand } from "@aws-sdk/client-s3";

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

function buildKey(tenantId: string, messageId: string, mimeType: string): string {
  const extMap: Record<string, string> = {
    "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp",
    "video/mp4": "mp4", "video/3gpp": "3gp", "video/webm": "webm",
    "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/webm": "webm", "audio/aac": "aac",
    "application/pdf": "pdf", "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.ms-excel": "xls",
  };
  const ext = extMap[mimeType] || mimeType.split("/")[1]?.split(";")[0] || "bin";
  const safe = `media.${ext}`.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${tenantId}/${messageId}/${safe}`;
}

async function objectExists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function uploadToMinio(buffer: Buffer, key: string, contentType: string): Promise<void> {
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: buffer, ContentType: contentType }));
}

function ts(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms / 1000}s: ${label}`)), ms)
    ),
  ]);
}

const BASE64_QUERY = {
  $or: [
    { "metadata.base64": { $exists: true, $type: "string" } },
    { "metadata.mediaInfo.base64": { $exists: true, $type: "string" } },
  ],
};

async function run() {
  console.log(`${ts()} [migration] Starting media migration from MongoDB to MinIO...`);

  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
    console.log(`${ts()} [migration] MinIO bucket '${BUCKET}' is accessible`);
  } catch (err: any) {
    console.error(`${ts()} [migration] FATAL: MinIO bucket '${BUCKET}' not accessible: ${err.message}`);
    process.exit(1);
  }

  await mongoose.connect(MONGODB_URI, {
    dbName: DB_NAME,
    maxPoolSize: 5,
    socketTimeoutMS: 600000,
    connectTimeoutMS: 30000,
    serverSelectionTimeoutMS: 30000,
  });
  console.log(`${ts()} [migration] MongoDB connected`);

  const db = mongoose.connection.db!;
  const collection = db.collection("messages");

  const needsMigrationQuery = {
    ...BASE64_QUERY,
    $and: [
      { $or: [{ "metadata.mediaKey": { $exists: false } }, { "metadata.mediaKey": null }, { "metadata.mediaKey": "" }] },
    ],
  };

  const ids = await collection
    .find(needsMigrationQuery, { projection: { _id: 1 } })
    .toArray();
  const totalCount = ids.length;
  console.log(`${ts()} [migration] Found ${totalCount} messages needing migration`);

  if (totalCount === 0) {
    const withBase64 = await collection.countDocuments(BASE64_QUERY);
    if (withBase64 > 0) {
      console.log(`${ts()} [migration] Found ${withBase64} messages with leftover base64 (already have mediaKey). Cleaning up...`);
      const result = await collection.updateMany(
        { "metadata.mediaKey": { $exists: true, $ne: null, $ne: "" }, ...BASE64_QUERY },
        { $unset: { "metadata.base64": "", "metadata.mediaInfo.base64": "" } }
      );
      console.log(`${ts()} [migration] Cleaned up ${result.modifiedCount} messages`);
    }
    console.log(`${ts()} [migration] Nothing to migrate. Done.`);
    await mongoose.disconnect();
    return;
  }

  const sizeInfo = await collection.aggregate([
    { $match: needsMigrationQuery },
    {
      $project: {
        _id: 1,
        tenantId: 1,
        mimeType: { $ifNull: ["$metadata.mimeType", { $ifNull: ["$metadata.mediaInfo.mimeType", "application/octet-stream"] }] },
        base64Len: {
          $cond: {
            if: { $gt: [{ $strLenCP: { $ifNull: ["$metadata.base64", ""] } }, 0] },
            then: { $strLenCP: "$metadata.base64" },
            else: { $strLenCP: { $ifNull: ["$metadata.mediaInfo.base64", ""] } },
          },
        },
        base64Field: {
          $cond: {
            if: { $gt: [{ $strLenCP: { $ifNull: ["$metadata.base64", ""] } }, 0] },
            then: "metadata.base64",
            else: "metadata.mediaInfo.base64",
          },
        },
      },
    },
    { $sort: { base64Len: 1 } },
  ], { allowDiskUse: true, maxTimeMS: 120000 }).toArray();

  console.log(`${ts()} [migration] Got size info for ${sizeInfo.length} documents (sorted smallest first)`);

  let migrated = 0;
  let failed = 0;
  let skipped = 0;
  let timedOut = 0;
  const MAX_BASE64_CHARS = 20_000_000;

  for (let i = 0; i < sizeInfo.length; i++) {
    const info = sizeInfo[i];
    const msgId = String(info._id);
    const tenantId = String(info.tenantId || "unknown");
    const mimeType = info.mimeType || "application/octet-stream";
    const base64Len = info.base64Len || 0;
    const base64Field = info.base64Field || "metadata.base64";
    const idx = `[${i + 1}/${sizeInfo.length}]`;
    const estSizeMB = ((base64Len * 3) / 4 / 1024 / 1024).toFixed(2);

    if (base64Len === 0) {
      console.log(`${ts()} [migration] ${idx} ${msgId}: empty base64, skipping`);
      skipped++;
      continue;
    }

    if (base64Len > MAX_BASE64_CHARS) {
      console.log(`${ts()} [migration] ${idx} ${msgId}: base64 too large (${estSizeMB}MB, ${base64Len} chars), deferring — may need direct DB access`);
      skipped++;
      continue;
    }

    try {
      console.log(`${ts()} [migration] ${idx} ${msgId}: reading ~${estSizeMB}MB base64 (${base64Len} chars)...`);

      const fullDoc = await withTimeout(
        collection.findOne(
          { _id: info._id },
          { projection: { [base64Field]: 1 } }
        ),
        180000,
        "base64 fetch"
      );

      if (!fullDoc) {
        console.log(`${ts()} [migration] ${idx} ${msgId}: doc not found, skipping`);
        skipped++;
        continue;
      }

      const md = fullDoc.metadata as any;
      const base64Data = md?.base64 || md?.mediaInfo?.base64;
      if (!base64Data || typeof base64Data !== "string" || base64Data.length === 0) {
        console.log(`${ts()} [migration] ${idx} ${msgId}: base64 empty after fetch, skipping`);
        skipped++;
        continue;
      }

      const buffer = Buffer.from(base64Data, "base64");
      const sizeMB = (buffer.length / 1024 / 1024).toFixed(2);

      if (buffer.length === 0) {
        console.log(`${ts()} [migration] ${idx} ${msgId}: decoded to 0 bytes, skipping`);
        skipped++;
        continue;
      }

      const key = buildKey(tenantId, msgId, mimeType);
      console.log(`${ts()} [migration] ${idx} ${msgId}: uploading ${sizeMB}MB → ${key}`);

      await withTimeout(uploadToMinio(buffer, key, mimeType), 120000, "MinIO upload");

      const verified = await withTimeout(objectExists(key), 30000, "MinIO verify");
      if (!verified) {
        console.error(`${ts()} [migration] ${idx} ${msgId}: VERIFICATION FAILED — object not in MinIO after upload`);
        failed++;
        continue;
      }

      await collection.updateOne(
        { _id: info._id },
        {
          $set: { "metadata.mediaKey": key, "metadata.mediaStatus": "completed" },
          $unset: { "metadata.base64": "", "metadata.mediaInfo.base64": "" },
        }
      );

      migrated++;
      console.log(`${ts()} [migration] ${idx} ${msgId}: ✓ migrated successfully`);
    } catch (err: any) {
      if (err.message?.includes("Timeout")) {
        console.error(`${ts()} [migration] ${idx} ${msgId}: TIMEOUT — ${err.message}`);
        timedOut++;
      } else {
        console.error(`${ts()} [migration] ${idx} ${msgId}: ERROR — ${err.message}`);
      }
      failed++;
    }
  }

  console.log(`${ts()} [migration] ════════════════════════════════`);
  console.log(`${ts()} [migration] Migration complete!`);
  console.log(`${ts()} [migration]   Total found:  ${sizeInfo.length}`);
  console.log(`${ts()} [migration]   Migrated:     ${migrated}`);
  console.log(`${ts()} [migration]   Failed:       ${failed} (${timedOut} timed out)`);
  console.log(`${ts()} [migration]   Skipped:      ${skipped}`);
  console.log(`${ts()} [migration] ════════════════════════════════`);

  await mongoose.disconnect();
  console.log(`${ts()} [migration] Done.`);
}

run().catch((err) => {
  console.error(`${ts()} [migration] FATAL ERROR:`, err);
  process.exit(1);
});

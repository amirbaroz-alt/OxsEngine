import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand, CreateBucketCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const BUCKET = process.env.MINIO_BUCKET || "whatsapp-media";
const ENDPOINT = process.env.MINIO_ENDPOINT || "http://localhost:9000";
const ACCESS_KEY = process.env.MINIO_ROOT_USER || "minioadmin";
const SECRET_KEY = process.env.MINIO_ROOT_PASSWORD || "minioadmin123";

const s3 = new S3Client({
  endpoint: ENDPOINT,
  region: "us-east-1",
  credentials: {
    accessKeyId: ACCESS_KEY,
    secretAccessKey: SECRET_KEY,
  },
  forcePathStyle: true,
});

function log(msg: string) {
  console.log(`${new Date().toLocaleTimeString("en-US")} [minio] ${msg}`);
}

export async function initBucket(): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
    log(`Bucket '${BUCKET}' exists`);
  } catch (err: any) {
    if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
      await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
      log(`Bucket '${BUCKET}' created`);
    } else {
      log(`Bucket check error: ${err.message}`);
      throw err;
    }
  }
}

export function buildMediaKey(tenantId: string, messageId: string, fileName?: string): string {
  const safe = (fileName || "file").replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${tenantId}/${messageId}/${safe}`;
}

export async function uploadMedia(buffer: Buffer, key: string, contentType: string): Promise<{ key: string; size: number }> {
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }));
  log(`Uploaded ${key} (${buffer.length} bytes, ${contentType})`);
  return { key, size: buffer.length };
}

export async function getPresignedUrl(key: string, expiresIn = 3600): Promise<string> {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(s3, command, { expiresIn });
}

export async function objectExists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

export async function deleteObject(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

export async function getObject(key: string): Promise<{ body: any; contentType: string; contentLength: number }> {
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  return {
    body: res.Body,
    contentType: res.ContentType || "application/octet-stream",
    contentLength: res.ContentLength || 0,
  };
}

export async function isMinioAvailable(): Promise<boolean> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
    return true;
  } catch {
    return false;
  }
}

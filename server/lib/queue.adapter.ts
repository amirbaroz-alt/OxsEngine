import mongoose from "mongoose";
import { log } from "../lib/logger";

const TAG = "queue-adapter";

export type QueueName = "logs" | "sms_retry" | "email_retry" | "jobs";

export interface QueueMessage {
  id: string;
  queue: QueueName;
  payload: unknown;
  attempts: number;
  createdAt: Date;
  visibleAfter: Date;
  processingId: string;
}

// ---------------------------------------------------------------------------
// Dev implementation — MongoDB (via mongoose default connection)
// ---------------------------------------------------------------------------

const COLLECTION = "queue_messages";
const VISIBILITY_TIMEOUT_MS = 30_000;
const TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

function getCol() {
  return mongoose.connection.collection(COLLECTION);
}

async function ensureIndexes() {
  const col = getCol();
  await col.createIndex({ createdAt: 1 }, { expireAfterSeconds: TTL_SECONDS, background: true });
  await col.createIndex({ queue: 1, visibleAfter: 1 }, { background: true });
}

// Run once at startup (errors are non-fatal)
ensureIndexes().catch((err) =>
  log(`Failed to ensure queue indexes: ${err?.message}`, TAG)
);

const mongoAdapter = {
  async enqueue(queue: QueueName, payload: unknown, delayMs = 0): Promise<string> {
    const col = getCol();
    const now = new Date();
    const doc = {
      queue,
      payload,
      attempts: 0,
      createdAt: now,
      visibleAfter: new Date(now.getTime() + delayMs),
      processingId: null,
    };
    const result = await col.insertOne(doc);
    const id = result.insertedId.toHexString();
    log(`enqueue queue=${queue} id=${id} delayMs=${delayMs}`, TAG);
    return id;
  },

  async dequeue(queue: QueueName, batchSize = 1): Promise<QueueMessage[]> {
    const col = getCol();
    const now = new Date();
    const processingId = new mongoose.Types.ObjectId().toHexString();
    const visibilityDeadline = new Date(now.getTime() + VISIBILITY_TIMEOUT_MS);

    const messages: QueueMessage[] = [];

    for (let i = 0; i < batchSize; i++) {
      const doc = await col.findOneAndUpdate(
        {
          queue,
          visibleAfter: { $lte: now },
          processingId: null,
        },
        {
          $set: { processingId, visibleAfter: visibilityDeadline },
          $inc: { attempts: 1 },
        },
        { returnDocument: "after", sort: { visibleAfter: 1 } }
      );
      if (!doc) break;
      messages.push({
        id: (doc._id as mongoose.Types.ObjectId).toHexString(),
        queue: doc.queue as QueueName,
        payload: doc.payload,
        attempts: doc.attempts as number,
        createdAt: doc.createdAt as Date,
        visibleAfter: doc.visibleAfter as Date,
        processingId: doc.processingId as string,
      });
    }

    if (messages.length > 0) {
      log(`dequeue queue=${queue} count=${messages.length}`, TAG);
    }
    return messages;
  },

  async ack(id: string): Promise<void> {
    const col = getCol();
    await col.deleteOne({ _id: new mongoose.Types.ObjectId(id) });
    log(`ack id=${id}`, TAG);
  },

  async nack(id: string, retryDelayMs = 5_000): Promise<void> {
    const col = getCol();
    const visibleAfter = new Date(Date.now() + retryDelayMs);
    await col.updateOne(
      { _id: new mongoose.Types.ObjectId(id) },
      {
        $inc: { attempts: 1 },
        $unset: { processingId: "" },
        $set: { visibleAfter },
      }
    );
    log(`nack id=${id} retryDelayMs=${retryDelayMs}`, TAG);
  },
};

// ---------------------------------------------------------------------------
// Prod implementation — SQS (stub)
// ---------------------------------------------------------------------------

const sqsAdapter = {
  async enqueue(_queue: QueueName, _payload: unknown, _delayMs = 0): Promise<string> {
    throw new Error("SQS not yet implemented");
  },
  async dequeue(_queue: QueueName, _batchSize = 1): Promise<QueueMessage[]> {
    throw new Error("SQS not yet implemented");
  },
  async ack(_id: string): Promise<void> {
    throw new Error("SQS not yet implemented");
  },
  async nack(_id: string, _retryDelayMs = 5_000): Promise<void> {
    throw new Error("SQS not yet implemented");
  },
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const queueAdapter =
  process.env.NODE_ENV === "production" ? sqsAdapter : mongoAdapter;

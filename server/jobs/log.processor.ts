import mongoose, { Schema, Document } from "mongoose";
import { queueAdapter } from "../lib/queue.adapter";
import { log } from "../lib/logger";
import type { LogEvent } from "../lib/log.adapter";

const TAG = "log-processor";

// ---------------------------------------------------------------------------
// Mongoose model
// ---------------------------------------------------------------------------

export interface ISystemLog extends Document {
  correlationId: string;
  tenantId?: string;
  service: string;
  action: string;
  status: string;
  level: string;
  durationMs?: number;
  error?: string;
  data?: Record<string, unknown>;
  timestamp: Date;
}

const SystemLogSchema = new Schema<ISystemLog>(
  {
    correlationId: { type: String, required: true, index: true },
    tenantId:      { type: String, index: true },
    service:       { type: String, required: true },
    action:        { type: String, required: true },
    status:        { type: String, required: true },
    level:         { type: String, default: "info" },
    durationMs:    { type: Number },
    error:         { type: String },
    data:          { type: Schema.Types.Mixed },
    timestamp:     { type: Date, required: true },
  },
  {
    collection: "system_logs",
    timestamps: { createdAt: true, updatedAt: false },
  }
);

// TTL: 30 days
SystemLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });
// Compound indexes
SystemLogSchema.index({ tenantId: 1, timestamp: -1 });
SystemLogSchema.index({ service: 1, status: 1, timestamp: -1 });

const SystemLog =
  mongoose.models.SystemLog ||
  mongoose.model<ISystemLog>("SystemLog", SystemLogSchema);

// ---------------------------------------------------------------------------
// Processor
// ---------------------------------------------------------------------------

const BATCH_SIZE = 20;

async function processLogs(): Promise<void> {
  let messages;
  try {
    messages = await queueAdapter.dequeue("logs", BATCH_SIZE);
  } catch (err: unknown) {
    log(`dequeue error: ${err instanceof Error ? err.message : String(err)}`, TAG);
    return;
  }

  if (messages.length === 0) return;

  log(`processing ${messages.length} log message(s)`, TAG);

  for (const msg of messages) {
    try {
      const event = msg.payload as LogEvent;
      await SystemLog.create({
        correlationId: event.correlationId,
        tenantId:      event.tenantId,
        service:       event.service,
        action:        event.action,
        status:        event.status,
        level:         event.level ?? "info",
        durationMs:    event.durationMs,
        error:         event.error,
        data:          event.data,
        timestamp:     new Date(event.timestamp),
      });
      await queueAdapter.ack(msg.id);
    } catch (err: unknown) {
      const msg2 = err instanceof Error ? err.message : String(err);
      log(`failed to persist log id=${msg.id}: ${msg2}`, TAG);
      await queueAdapter.nack(msg.id, 10_000).catch(() => undefined);
    }
  }
}

// ---------------------------------------------------------------------------
// Entry point (DEV / in-process)
// PROD: export processLogs and wire to Lambda handler instead
// ---------------------------------------------------------------------------

export function startLogProcessor(): void {
  if (process.env.NODE_ENV === "production") {
    log("log processor runs as Lambda in production — skipping in-process scheduler", TAG);
    return;
  }
  log("starting in-process log processor (5s interval)", TAG);
  setInterval(() => {
    processLogs().catch((err) =>
      log(`unhandled error in processLogs: ${err?.message}`, TAG)
    );
  }, 5_000);
}

// Lambda handler export for PROD
export async function handler(): Promise<void> {
  await processLogs();
}

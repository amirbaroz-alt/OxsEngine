import { randomUUID } from "crypto";
import { queueAdapter } from "./queue.adapter";
import { log } from "./logger";

const TAG = "log-adapter";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LogLevel = "info" | "warn" | "error" | "debug";
export type LogStatus = "success" | "error" | "pending";

export interface LogEventParams {
  correlationId?: string;
  tenantId?: string;
  service: string;
  action: string;
  status: LogStatus;
  level?: LogLevel;
  durationMs?: number;
  error?: string;
  data?: Record<string, unknown>;
}

export interface LogEvent extends LogEventParams {
  correlationId: string;
  level: LogLevel;
  timestamp: string; // ISO 8601
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function generateCorrelationId(): string {
  return randomUUID();
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export const logAdapter = {
  async emit(params: LogEventParams): Promise<string> {
    const event: LogEvent = {
      ...params,
      correlationId: params.correlationId ?? generateCorrelationId(),
      level: params.level ?? (params.status === "error" ? "error" : "info"),
      timestamp: new Date().toISOString(),
    };

    try {
      const id = await queueAdapter.enqueue("logs", event);
      return id;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`Failed to enqueue log event: ${msg}`, TAG);
      throw err;
    }
  },
};

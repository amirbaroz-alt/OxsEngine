import { IAuditStep } from "../models/SystemAuditLog";

export interface TraceData {
  traceId: string;
  parentTraceId?: string;
  whatsappMessageId?: string;
  tenantId?: string;
  direction: "INBOUND" | "OUTBOUND";
  pipelineStatus: "PENDING" | "COMPLETED" | "FAILED" | "STUCK" | "PARTIAL" | "PARTIAL_BUFFER_EXCEEDED";
  encryptedContent?: string;
  sequenceTimestamp?: Date;
  assignedWorkerId?: string;
  handlingStatus: "OPEN" | "IN_PROGRESS" | "RESOLVED";
  retryCount: number;
  steps: IAuditStep[];
  startedAt: number;
  messageType?: string;
  mimeType?: string;
  fileSize?: number;
  senderPhone?: string;
  senderName?: string;
  phoneNumberId?: string;
}

const TRACE_TTL_MS = 5 * 60 * 1000;
const parsedMaxBuffer = parseInt(process.env.OMMA_MAX_BUFFER_SIZE || "1000", 10);
export const MAX_BUFFER_SIZE = Number.isFinite(parsedMaxBuffer) && parsedMaxBuffer > 0 ? parsedMaxBuffer : 1000;

export type FlushCallback = (data: TraceData) => Promise<void>;

class TraceBuffer {
  private store = new Map<string, TraceData>();
  private timers = new Map<string, NodeJS.Timeout>();
  private expireCallbacks = new Map<string, (data: TraceData) => void>();
  private onForceFlush: FlushCallback | null = null;

  setForceFlushHandler(handler: FlushCallback): void {
    this.onForceFlush = handler;
  }

  async set(traceId: string, data: TraceData): Promise<void> {
    if (this.store.size >= MAX_BUFFER_SIZE && !this.store.has(traceId)) {
      await this.evictOldest();
    }
    this.store.set(traceId, data);
    this.resetTTL(traceId);
  }

  get(traceId: string): TraceData | undefined {
    return this.store.get(traceId);
  }

  findByWhatsappMessageId(wamid: string): TraceData | undefined {
    for (const data of this.store.values()) {
      if (data.whatsappMessageId === wamid) return data;
    }
    return undefined;
  }

  update(traceId: string, partial: Partial<TraceData>): TraceData | undefined {
    const existing = this.store.get(traceId);
    if (!existing) return undefined;
    const updated = { ...existing, ...partial };
    this.store.set(traceId, updated);
    this.resetTTL(traceId);
    return updated;
  }

  addStep(traceId: string, step: IAuditStep): TraceData | undefined {
    const existing = this.store.get(traceId);
    if (!existing) return undefined;
    existing.steps.push(step);
    this.store.set(traceId, existing);
    this.resetTTL(traceId);
    return existing;
  }

  delete(traceId: string): TraceData | undefined {
    const data = this.store.get(traceId);
    this.store.delete(traceId);
    this.expireCallbacks.delete(traceId);
    const timer = this.timers.get(traceId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(traceId);
    }
    return data;
  }

  has(traceId: string): boolean {
    return this.store.has(traceId);
  }

  getAll(): TraceData[] {
    return Array.from(this.store.values());
  }

  size(): number {
    return this.store.size;
  }

  setExpireCallback(traceId: string, cb: (data: TraceData) => void): void {
    this.expireCallbacks.set(traceId, cb);
    this.resetTTL(traceId);
  }

  private async evictOldest(): Promise<void> {
    let oldestId: string | null = null;
    let oldestStart = Infinity;
    for (const [id, data] of this.store.entries()) {
      if (data.startedAt < oldestStart) {
        oldestStart = data.startedAt;
        oldestId = id;
      }
    }
    if (!oldestId) return;

    const evicted = this.delete(oldestId);
    if (evicted && this.onForceFlush) {
      evicted.pipelineStatus = "PARTIAL_BUFFER_EXCEEDED";
      evicted.steps.push({
        step: "BUFFER_EVICTED",
        status: "FAIL",
        error: `Buffer exceeded MAX_BUFFER_SIZE (${MAX_BUFFER_SIZE})`,
        timestamp: new Date(),
        duration: Date.now() - evicted.startedAt,
      });
      try {
        await this.onForceFlush(evicted);
      } catch (_) {}
    }
  }

  private resetTTL(traceId: string): void {
    const existing = this.timers.get(traceId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      const data = this.store.get(traceId);
      this.store.delete(traceId);
      this.timers.delete(traceId);
      const cb = this.expireCallbacks.get(traceId);
      this.expireCallbacks.delete(traceId);
      if (data && cb) {
        cb(data);
      }
    }, TRACE_TTL_MS);
    timer.unref();
    this.timers.set(traceId, timer);
  }
}

export const traceBuffer = new TraceBuffer();

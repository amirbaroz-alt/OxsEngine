import { log } from "../lib/logger";

type JobStatus = "pending" | "processing" | "completed" | "failed";

interface QueueJob<T = any> {
  id: string;
  payload: T;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  createdAt: number;
  error?: string;
}

interface QueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  totalEnqueued: number;
  totalProcessed: number;
  totalFailed: number;
}

type ProcessorFn<T = any> = (payload: T) => Promise<void>;

const RECENT_MESSAGE_IDS = new Map<string, number>();
const DEDUP_TTL_MS = 5 * 60 * 1000;

let dedupCleanupTimer: ReturnType<typeof setInterval> | null = null;

function startDedupCleanup() {
  if (dedupCleanupTimer) return;
  dedupCleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, timestamp] of RECENT_MESSAGE_IDS) {
      if (now - timestamp > DEDUP_TTL_MS) {
        RECENT_MESSAGE_IDS.delete(key);
      }
    }
  }, 60_000);
  dedupCleanupTimer.unref();
}

export function isDuplicateMessage(waMessageId: string): boolean {
  if (RECENT_MESSAGE_IDS.has(waMessageId)) {
    return true;
  }
  RECENT_MESSAGE_IDS.set(waMessageId, Date.now());
  return false;
}

export function getDedupCacheSize(): number {
  return RECENT_MESSAGE_IDS.size;
}

class MessageQueue<T = any> {
  private queue: QueueJob<T>[] = [];
  private activeCount = 0;
  private concurrency: number;
  private processor: ProcessorFn<T> | null = null;
  private jobCounter = 0;
  private stats = {
    totalEnqueued: 0,
    totalProcessed: 0,
    totalFailed: 0,
  };

  constructor(concurrency = 5) {
    this.concurrency = concurrency;
    startDedupCleanup();
  }

  setProcessor(fn: ProcessorFn<T>): void {
    this.processor = fn;
  }

  enqueue(payload: T, maxAttempts = 3): string {
    const id = `job_${++this.jobCounter}_${Date.now()}`;
    const job: QueueJob<T> = {
      id,
      payload,
      status: "pending",
      attempts: 0,
      maxAttempts,
      createdAt: Date.now(),
    };
    this.queue.push(job);
    this.stats.totalEnqueued++;
    this.processNext();
    return id;
  }

  private async processNext(): Promise<void> {
    if (!this.processor) return;
    if (this.activeCount >= this.concurrency) return;

    const job = this.queue.find((j) => j.status === "pending");
    if (!job) return;

    job.status = "processing";
    job.attempts++;
    this.activeCount++;

    try {
      await this.processor(job.payload);
      job.status = "completed";
      this.stats.totalProcessed++;
    } catch (err: any) {
      const canRetry = job.attempts < job.maxAttempts;
      if (canRetry) {
        const delay = Math.min(1000 * Math.pow(2, job.attempts - 1), 8000);
        job.status = "pending";
        job.error = err.message;
        log(`Queue job ${job.id} failed (attempt ${job.attempts}/${job.maxAttempts}), retrying in ${delay}ms: ${err.message}`, "queue");
        setTimeout(() => this.processNext(), delay);
      } else {
        job.status = "failed";
        job.error = err.message;
        this.stats.totalFailed++;
        log(`Queue job ${job.id} permanently failed after ${job.attempts} attempts: ${err.message}`, "queue");
      }
    } finally {
      this.activeCount--;
      this.cleanupOldJobs();
      this.processNext();
    }
  }

  private cleanupOldJobs(): void {
    const maxKept = 200;
    const completedOrFailed = this.queue.filter(
      (j) => j.status === "completed" || j.status === "failed"
    );
    if (completedOrFailed.length > maxKept) {
      const toRemove = completedOrFailed.length - maxKept;
      let removed = 0;
      this.queue = this.queue.filter((j) => {
        if (removed >= toRemove) return true;
        if (j.status === "completed" || j.status === "failed") {
          removed++;
          return false;
        }
        return true;
      });
    }
  }

  getStats(): QueueStats {
    const pending = this.queue.filter((j) => j.status === "pending").length;
    const processing = this.queue.filter((j) => j.status === "processing").length;
    const completed = this.queue.filter((j) => j.status === "completed").length;
    const failed = this.queue.filter((j) => j.status === "failed").length;
    return {
      pending,
      processing,
      completed,
      failed,
      totalEnqueued: this.stats.totalEnqueued,
      totalProcessed: this.stats.totalProcessed,
      totalFailed: this.stats.totalFailed,
    };
  }

  getDepth(): number {
    return this.queue.filter((j) => j.status === "pending" || j.status === "processing").length;
  }

  get size(): number {
    return this.queue.filter((j) => j.status === "pending").length;
  }

  get pending(): number {
    return this.queue.filter((j) => j.status === "processing").length;
  }

  add(fn: () => Promise<void>): void {
    this.processor = async (p: any) => {
      if (typeof p === "function") await p();
    };
    this.enqueue(fn as any);
  }
}

export const webhookQueue = new MessageQueue(5);

export { MessageQueue };

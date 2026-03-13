export class PipelineTimeoutError extends Error {
  public readonly label: string;
  public readonly timeoutMs: number;

  constructor(label: string, timeoutMs: number) {
    super(`Pipeline timeout: "${label}" did not complete within ${timeoutMs}ms`);
    this.name = "PipelineTimeoutError";
    this.label = label;
    this.timeoutMs = timeoutMs;
  }
}

export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new PipelineTimeoutError(label, timeoutMs));
    }, timeoutMs);
    if (timer.unref) timer.unref();
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timer);
  });
}

export const PIPELINE_TIMEOUT_MS = 30_000;
export const TENANT_RESOLUTION_TIMEOUT_MS = 15_000;

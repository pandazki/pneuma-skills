// Type declarations for the untyped shared fal queue runner (fal-queue.mjs).
// The module is plain JS so it can be copied into a skill and run by
// `node` with no build step; these stubs exist so TypeScript callers and
// `modes/plotwise/__tests__/` can use it under `tsc --noEmit`.

/** One queue-state change, as reported to `onStatus`. */
export interface FalQueueStatus {
  /** "IN_QUEUE" | "IN_PROGRESS" — or whatever else fal starts sending. */
  status: string;
  queue_position?: number;
}

/** One announced submit back-off, so no transient failure is silent. */
export interface FalRetryInfo {
  /** 1-based index of the attempt that just failed. */
  attempt: number;
  /** Total attempts this job will make. */
  attempts: number;
  delayMs: number;
  reason: string;
}

export interface RunFalJobOptions {
  /** Synchronous endpoint, e.g. `https://fal.run/minimax/h3-max/image-to-video`. */
  url: string;
  /** Request body, serialized as JSON. */
  body: unknown;
  /** fal API key, sent as `Authorization: Key <key>`. */
  key: string;
  /** Aborting cancels the job remotely before the rejection surfaces. */
  signal?: AbortSignal;
  /** Wall clock for the whole job. Default 10 minutes. */
  deadlineMs?: number;
  /** Gap between status polls. Default 900 ms. */
  pollMs?: number;
  /** Names the job in deadline and cancellation messages. */
  label?: string;
  fetchImpl?: typeof fetch;
  /** Called when — and only when — the queue state changes. */
  onStatus?: (update: FalQueueStatus) => void;
  /** Called before each submit back-off. */
  onRetry?: (info: FalRetryInfo) => void;
  /** Back-off between submit attempts. Default `[6000, 15000]`. */
  retryDelaysMs?: readonly number[];
  /** Injectable delay; must reject with an AbortError when `signal` fires. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export interface FalJobResult<T = any> {
  /** The endpoint's own response body, fetched from `response_url`. */
  data: T;
  /** Wall clock from submit to result, in milliseconds. */
  apiMs: number;
  /** `data.timings.inference`, else the status's `metrics.inference_time`. */
  inferenceSeconds?: number;
  requestId?: string;
  /** Submit attempts spent — 1 unless a transient failure was retried. */
  attempts: number;
}

/**
 * The queue endpoint for a synchronous fal URL. Only `fal.run` is
 * rewritten; a URL already on the queue host (or any other host, such as a
 * test double) comes back unchanged. Throws when `url` is not a URL.
 */
export function toQueueUrl(url: string): string;

/** A timer that loses the race against `signal`, rejecting when it fires. */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void>;

/**
 * Submit one job to `queue.fal.run`, poll it to completion and return its
 * result. Rejects with an `AbortError` (after PUTting `cancel_url`) when
 * `signal` fires, with the upstream message on `FAILED`, and with a
 * `<label> exceeded Ns` error on `deadlineMs`.
 */
export function runFalJob<T = any>(options: RunFalJobOptions): Promise<FalJobResult<T>>;

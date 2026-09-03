/**
 * Type surface of async-job-queue.mjs — the play manager's scheduler.
 * Exists so `modes/plotwise/__tests__/` can pin the queue under
 * `tsc --noEmit` (the skill directory itself is excluded from the
 * typecheck because it is shipped, not compiled).
 */

/** One job as reported by `snapshot()`. `startedAt` is set once running. */
export interface QueueSnapshotItem {
  key: string;
  priority: number;
  enqueuedAt: number;
  startedAt?: number;
}

export interface QueueSnapshot {
  /** Pending jobs in the order they will start. */
  queued: QueueSnapshotItem[];
  active: QueueSnapshotItem[];
  concurrency: number;
}

/**
 * A job. The signal fires when the job is cancelled — pass it down to
 * `runFalJob` so a pruned branch is cancelled remotely too.
 */
export type QueueJob = (signal: AbortSignal) => Promise<void>;

export declare class AsyncJobQueue {
  /**
   * @param concurrency How many jobs may run at once (clamped to >= 1).
   * @param onChange Called on every transition of a key: queued, started,
   *   finished, cancelled.
   */
  constructor(concurrency: number, onChange?: (key: string) => void);

  /** Widen or narrow the cap. Widening starts whatever now fits. */
  setConcurrency(value: number): void;

  /**
   * Queue `run` under `key`. A key already active is left alone; a key
   * already pending keeps its original run function and takes the lower of
   * the two priorities. Returns true only when this call created the job.
   */
  enqueue(key: string, priority: number, run: QueueJob): boolean;

  /**
   * Drop a pending job, or abort a running one's signal. The three
   * outcomes are distinct: `undefined` means the key was never here.
   */
  cancel(key: string): "pending" | "active" | undefined;

  /** Cancel every matching job — one pruned subtree, one call. */
  cancelWhere(predicate: (key: string) => boolean): { pending: number; active: number };

  snapshot(): QueueSnapshot;

  /** Resolves once nothing is pending and nothing is running. */
  whenIdle(): Promise<void>;
}

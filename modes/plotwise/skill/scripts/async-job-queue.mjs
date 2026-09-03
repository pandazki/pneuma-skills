/**
 * AsyncJobQueue — a priority queue with a concurrency cap and real
 * cancellation, for the play manager.
 *
 * The manager plans further ahead than it renders: scenes the learner may
 * never reach are queued behind the ones they are about to see, and the
 * moment a choice prunes a subtree the jobs for it must stop — including
 * the one already talking to fal, which is why a running job is handed an
 * `AbortSignal` rather than a cancellation flag it might ignore. That
 * signal is what reaches `runFalJob`, which PUTs `cancel_url` so a pruned
 * branch stops costing money.
 *
 * Order is by priority number ascending — the distance from what the
 * learner is watching — and FIFO within one priority. (Ties are safe:
 * `enqueuedAt` has millisecond resolution, but the sort is stable over a
 * Map iterated in insertion order, so same-millisecond jobs keep their
 * enqueue order.)
 *
 * A job's own failure is contained: the queue swallows it so one bad
 * render cannot stop the pipeline. Reporting it is the run function's job
 * — it owns the node's `status` and `error` fields.
 *
 * Node 22+, no dependencies.
 */

export class AsyncJobQueue {
  /** @type {Map<string, { key: string, priority: number, enqueuedAt: number, run: (signal: AbortSignal) => Promise<void> }>} */
  #pending = new Map();

  /** @type {Map<string, { key: string, priority: number, enqueuedAt: number, startedAt: number, run: (signal: AbortSignal) => Promise<void>, controller: AbortController }>} */
  #active = new Map();

  /** @type {Set<() => void>} */
  #idleWaiters = new Set();

  #concurrency = 1;

  /** @type {(key: string) => void} */
  #onChange;

  /**
   * @param {number} concurrency  How many jobs may run at once (min 1).
   * @param {(key: string) => void} [onChange]  Called on every transition
   *   of a key: queued, started, finished, cancelled.
   */
  constructor(concurrency, onChange = () => undefined) {
    this.#concurrency = Math.max(1, Math.floor(concurrency));
    this.#onChange = onChange;
  }

  /** Widen or narrow the cap. Widening starts whatever now fits. */
  setConcurrency(value) {
    this.#concurrency = Math.max(1, Math.floor(value));
    this.#drain();
  }

  /**
   * Queue `run` under `key`. A key already active is left alone; a key
   * already pending keeps its original run function and takes the better
   * (lower) of the two priorities — re-queuing is how the manager says
   * "this one got closer", not "do it twice".
   *
   * @returns {boolean} true when this call created the job.
   */
  enqueue(key, priority, run) {
    if (this.#active.has(key)) return false;
    const existing = this.#pending.get(key);
    if (existing) {
      existing.priority = Math.min(existing.priority, priority);
      this.#onChange(key);
      this.#drain();
      return false;
    }
    this.#pending.set(key, { key, priority, run, enqueuedAt: Date.now() });
    this.#onChange(key);
    this.#drain();
    return true;
  }

  /**
   * Drop a pending job, or abort a running one.
   *
   * @returns {"pending" | "active" | undefined} What was cancelled — the
   *   three outcomes are distinct on purpose: the caller marks a node
   *   `cancelled` differently depending on whether work had started, and
   *   `undefined` means the key was never here.
   */
  cancel(key) {
    const pending = this.#pending.get(key);
    if (pending) {
      this.#pending.delete(key);
      this.#onChange(key);
      this.#resolveIdleIfNeeded();
      return "pending";
    }
    const active = this.#active.get(key);
    if (active) {
      active.controller.abort(new DOMException(`job cancelled: ${key}`, "AbortError"));
      this.#onChange(key);
      return "active";
    }
    return undefined;
  }

  /**
   * Cancel every job whose key matches — one pruned subtree, one call.
   *
   * @returns {{ pending: number, active: number }} How many of each shape.
   */
  cancelWhere(predicate) {
    let pending = 0;
    let active = 0;
    for (const key of [...this.#pending.keys()]) {
      if (!predicate(key)) continue;
      if (this.cancel(key) === "pending") pending += 1;
    }
    for (const key of [...this.#active.keys()]) {
      if (!predicate(key)) continue;
      if (this.cancel(key) === "active") active += 1;
    }
    return { pending, active };
  }

  /** What the manager publishes as `play.queued` / `play.active`. */
  snapshot() {
    return {
      queued: [...this.#pending.values()]
        .sort((a, b) => a.priority - b.priority || a.enqueuedAt - b.enqueuedAt)
        .map(({ key, priority, enqueuedAt }) => ({ key, priority, enqueuedAt })),
      active: [...this.#active.values()].map(({ key, priority, enqueuedAt, startedAt }) => ({
        key,
        priority,
        enqueuedAt,
        startedAt,
      })),
      concurrency: this.#concurrency,
    };
  }

  /** Resolves once nothing is pending and nothing is running. */
  whenIdle() {
    if (!this.#pending.size && !this.#active.size) return Promise.resolve();
    return new Promise((resolve) => this.#idleWaiters.add(resolve));
  }

  /** Start whatever fits, best priority first. */
  #drain() {
    while (this.#active.size < this.#concurrency && this.#pending.size) {
      const next = [...this.#pending.values()].sort(
        (a, b) => a.priority - b.priority || a.enqueuedAt - b.enqueuedAt,
      )[0];
      this.#pending.delete(next.key);
      const controller = new AbortController();
      const running = { ...next, controller, startedAt: Date.now() };
      this.#active.set(next.key, running);
      this.#onChange(next.key);
      void next
        .run(controller.signal)
        // A job's own failure belongs to the job — swallowing it here keeps
        // one bad render from stopping the queue.
        .catch(() => undefined)
        .finally(() => {
          // Only clear the slot this run owns: a key re-queued and restarted
          // while this one was settling must not be evicted by it.
          if (this.#active.get(next.key) === running) this.#active.delete(next.key);
          this.#onChange(next.key);
          this.#resolveIdleIfNeeded();
          this.#drain();
        });
    }
  }

  #resolveIdleIfNeeded() {
    if (this.#pending.size || this.#active.size) return;
    for (const resolve of this.#idleWaiters) resolve();
    this.#idleWaiters.clear();
  }
}

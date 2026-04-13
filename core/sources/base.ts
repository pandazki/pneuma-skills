import type { Source, SourceEvent } from "../types/source.js";

/**
 * Abstract base class for all built-in and third-party Source implementations.
 *
 * Owns the four invariants documented on Source<T> in core/types/source.ts:
 * single writer, change-read-via-subscription, time-locked write Promises,
 * origin tagging. Subclasses only fill in:
 *
 *   - doWrite(value): perform the actual persistence. Must emit a
 *     { origin: "self" } event before resolving (see the helper
 *     emit() method below). Should throw on failure — BaseSource
 *     re-throws to the write() caller.
 *
 *   - Whatever mechanism they use to observe external changes.
 *     When an external change arrives, the subclass calls
 *     this.emit({ kind: "value", value, origin: "external" }) to
 *     propagate it.
 *
 *   - An initial-load pathway that ultimately calls
 *     this.emit({ kind: "value", value, origin: "initial" }) once.
 *
 * Subclasses should call super.destroy() from their own destroy() to
 * guarantee the listener set is cleared.
 */
export abstract class BaseSource<T> implements Source<T> {
  private listeners = new Set<(e: SourceEvent<T>) => void>();
  private latest: T | null = null;
  private destroyed = false;

  // Serializes write() calls. Each write awaits the previous. We use
  // .catch inside the chain so one rejection doesn't poison subsequent
  // writes — the rejection is still propagated to THAT call's caller via
  // the separate `next` promise.
  private writeQueue: Promise<void> = Promise.resolve();

  current(): T | null {
    return this.latest;
  }

  subscribe(listener: (event: SourceEvent<T>) => void): () => void {
    if (this.destroyed) return () => {};
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Public entry point for writes. Serializes against any in-flight or
   * queued writes, then calls the subclass's doWrite(). The returned
   * Promise resolves only after doWrite() has resolved AND the self event
   * has been delivered to all subscribers (the subclass is responsible
   * for emitting that event from within doWrite, typically as its very
   * last step before returning).
   */
  write(value: T): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    // Chain: wait for previous write (regardless of success), then run
    // this one. The returned `next` is what we give the caller; the
    // `.catch` on the stored queue prevents one failure from breaking
    // the chain for later writes.
    const prev = this.writeQueue;
    const next = prev
      .catch(() => {})
      .then(() => {
        if (this.destroyed) return;
        return this.doWrite(value);
      });
    this.writeQueue = next.catch(() => {});
    return next;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.listeners.clear();
    this.latest = null;
  }

  /**
   * Subclass hook: actually persist the value. Must emit a self event
   * before resolving. Throw to signal failure — BaseSource propagates
   * the error to the write() caller.
   */
  protected abstract doWrite(value: T): Promise<void>;

  /**
   * Subclass hook: emit an event to all current subscribers. Updates
   * the internal `latest` cache if this is a value event. Listeners that
   * throw are isolated — their error is caught and logged, other
   * listeners still receive the event.
   */
  protected emit(event: SourceEvent<T>): void {
    if (this.destroyed) return;
    if (event.kind === "value") {
      this.latest = event.value;
    }
    // Snapshot the listener set so a listener that subscribes / unsubscribes
    // during delivery doesn't disturb iteration.
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(event);
      } catch (err) {
        // Don't throw — one listener's bug shouldn't break others.
        // Log to console; providers can override this if they need
        // structured logging (via SourceContext.log, but BaseSource has
        // no ctx, so console is the floor).
        // eslint-disable-next-line no-console
        console.error("[source] listener threw", err);
      }
    }
  }

  /**
   * Subclass utility: check whether destroy() has been called. Useful
   * for guarding async code paths that resume after an await boundary.
   */
  protected get isDestroyed(): boolean {
    return this.destroyed;
  }
}

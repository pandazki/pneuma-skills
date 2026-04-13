import { BaseSource } from "./base.js";

/**
 * Ephemeral in-process source. Keeps state in memory, no persistence.
 * Used for session-scoped data (presence, cursor, UI mode flags, etc.)
 * where a refresh is expected to start fresh.
 *
 * Config:
 *   { initial?: T }  -- optional starting value
 *
 * The initial event fires in a microtask after construction so that
 * subscribers registered synchronously right after `new MemorySource()`
 * still catch it.
 */
export interface MemorySourceConfig<T> {
  initial?: T;
}

export class MemorySource<T> extends BaseSource<T> {
  constructor(config: MemorySourceConfig<T>) {
    super();
    if (config.initial !== undefined) {
      // Defer to a microtask so listeners subscribed right after
      // construction still catch the initial event.
      queueMicrotask(() => {
        if (this.isDestroyed) return;
        this.emit({ kind: "value", value: config.initial as T, origin: "initial" });
      });
    }
  }

  protected async doWrite(value: T): Promise<void> {
    this.emit({ kind: "value", value, origin: "self" });
  }
}

import { BaseSource } from "./base.js";
import type {
  FileChannel,
  FileChangeEvent,
} from "../types/source.js";

export interface JsonFileConfig<T> {
  path: string;
  parse: (raw: string) => T;
  serialize: (value: T) => string;
}

/**
 * Single-file structured source. Reads a file as raw text, calls `parse`
 * to produce a typed value, and on write() calls `serialize` + persists
 * via FileChannel.write().
 *
 * ## Origin handling
 *
 * JsonFileSource relies on the FileChannel / server tagging file change
 * events with origin: "self" vs "external". When it receives an event
 * tagged "self", it treats the content as the echo of its own write()
 * and drops the event (since it has already emitted a self event from
 * the write() call itself). When it receives an event tagged "external",
 * it parses and emits as external.
 *
 * This means the CORRECTNESS of origin detection is entirely the
 * responsibility of the server-side pendingSelfWrites machinery
 * (server/file-watcher.ts + server/index.ts POST /api/files). This
 * source trusts the tag.
 *
 * ## Parse errors
 *
 * Non-fatal. A parse failure emits a { kind: "error" } event; the
 * source stays live and a later successful update still delivers a
 * value event. If the first-ever value is observed post-error, it
 * still fires with origin: "initial" (a parse error does not count
 * as having observed an initial value).
 */
export class JsonFileSource<T> extends BaseSource<T> {
  private unsubscribe: (() => void) | null = null;
  private hasEmittedInitial = false;

  constructor(
    private config: JsonFileConfig<T>,
    private channel: FileChannel,
  ) {
    super();
    this.unsubscribe = channel.subscribe((batch) => this.onBatch(batch));
    queueMicrotask(() => this.fireInitialFromSnapshot());
  }

  private fireInitialFromSnapshot(): void {
    if (this.isDestroyed) return;
    const file = this.channel.snapshot().find((f) => f.path === this.config.path);
    if (!file) return;  // missing on startup is not an error — current() stays null
    this.processContent(file.content, "initial");
  }

  private onBatch(batch: FileChangeEvent[]): void {
    if (this.isDestroyed) return;
    const relevant = batch.find((ev) => ev.path === this.config.path);
    if (!relevant) return;
    if (relevant.origin === "self") {
      // Our own write has already emitted a self event from write().
      // Drop the echo.
      return;
    }
    // External change (or initial for a previously-missing file).
    const origin = this.hasEmittedInitial ? "external" : "initial";
    this.processContent(relevant.content, origin);
  }

  private processContent(raw: string, origin: "initial" | "external"): void {
    let parsed: T;
    try {
      parsed = this.config.parse(raw);
    } catch (err) {
      this.emit({
        kind: "error",
        code: "E_PARSE",
        message: (err as Error).message,
        raw,
      });
      return;
    }
    this.hasEmittedInitial = true;
    this.emit({ kind: "value", value: parsed, origin });
  }

  protected async doWrite(value: T): Promise<void> {
    const content = this.config.serialize(value);
    await this.channel.write(this.config.path, content);
    // The write succeeded. Emit the self event now so the caller's
    // await resolves with state already consistent. hasEmittedInitial
    // is guaranteed true after a write because we are now observing
    // a value.
    this.hasEmittedInitial = true;
    this.emit({ kind: "value", value, origin: "self" });
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    super.destroy();
  }
}

import { BaseSource } from "./base.js";
import type {
  FileChannel,
  FileChangeEvent,
} from "../types/source.js";
import type { ViewerFileContent } from "../types/viewer-contract.js";

export interface AggregateFileConfig<T> {
  /** All file path globs this aggregate depends on. Used to scope watching. */
  patterns: string[];
  /** Optional ignore globs. */
  ignore?: string[];
  /**
   * Build the aggregate from the current file snapshot. Return null if the
   * aggregate cannot be built (e.g. required files missing) — the source
   * will stay in "no initial yet" state and a later snapshot change may
   * succeed. Throw to emit an error event without killing the source.
   */
  load: (files: ReadonlyArray<ViewerFileContent>) => T | null;
  /**
   * Decompose a new aggregate value back into file-level operations.
   * Called from write(). Receives the current (pre-write) snapshot so
   * save can compute diffs (e.g. which slide files to delete when an
   * id has been removed from a Deck).
   */
  save: (
    value: T,
    current: ReadonlyArray<ViewerFileContent>,
  ) => {
    writes: Array<{ path: string; content: string }>;
    deletes: string[];
  };
}

/**
 * Multi-file domain aggregate source.
 *
 * Used when a mode's domain is a structured aggregate (a Deck, a Site,
 * a Studio) that happens to be persisted across multiple files. The
 * viewer consumes `Source<T>` where T is the domain type and never
 * sees file paths; the provider handles translation to/from files.
 *
 * Origin handling: when a file change batch arrives, the provider
 * re-runs `load()` against the full current snapshot. If the batch
 * contains any `origin: "self"` entries, the emission is tagged "self"
 * (our own write round-tripped); otherwise "external". The first
 * successful load ever emits "initial" regardless of the triggering
 * origin.
 *
 * Parse/load errors are non-fatal: they emit `{ kind: "error" }` and
 * leave the source alive for future updates.
 */
export class AggregateFileSource<T> extends BaseSource<T> {
  private unsubscribe: (() => void) | null = null;
  private matcher: (path: string) => boolean;
  private ignoreMatcher: (path: string) => boolean;
  private hasEmittedInitial = false;

  constructor(
    private config: AggregateFileConfig<T>,
    private channel: FileChannel,
  ) {
    super();
    this.matcher = compileGlobList(config.patterns);
    this.ignoreMatcher = compileGlobList(config.ignore ?? []);
    this.unsubscribe = channel.subscribe((batch) => this.onBatch(batch));
    queueMicrotask(() => this.tryLoad("initial"));
  }

  private onBatch(batch: FileChangeEvent[]): void {
    if (this.isDestroyed) return;
    const relevant = batch.some(
      (ev) => this.matcher(ev.path) && !this.ignoreMatcher(ev.path),
    );
    if (!relevant) return;
    const hasSelf = batch.some((ev) => ev.origin === "self");
    const origin: "self" | "external" = hasSelf ? "self" : "external";
    // If we've never successfully loaded, the first success still fires
    // as "initial" — we treat initial-after-error as the first real observation.
    const effectiveOrigin = this.hasEmittedInitial ? origin : "initial";
    this.tryLoad(effectiveOrigin);
  }

  private tryLoad(origin: "initial" | "self" | "external"): void {
    if (this.isDestroyed) return;
    const files = this.channel.snapshot().filter(
      (f) => this.matcher(f.path) && !this.ignoreMatcher(f.path),
    );
    let value: T | null;
    try {
      value = this.config.load(files);
    } catch (err) {
      this.emit({
        kind: "error",
        code: "E_LOAD",
        message: (err as Error).message,
      });
      return;
    }
    if (value === null) {
      // load returned null — aggregate not yet ready (missing required
      // files). Silent: don't emit, don't error. A later file change
      // may produce a valid aggregate.
      return;
    }
    this.hasEmittedInitial = true;
    this.emit({ kind: "value", value, origin });
  }

  protected async doWrite(value: T): Promise<void> {
    const currentFiles = this.channel.snapshot().filter(
      (f) => this.matcher(f.path) && !this.ignoreMatcher(f.path),
    );
    let ops: { writes: Array<{ path: string; content: string }>; deletes: string[] };
    try {
      ops = this.config.save(value, currentFiles);
    } catch (err) {
      this.emit({
        kind: "error",
        code: "E_SAVE",
        message: (err as Error).message,
      });
      throw err;
    }
    // Execute the file operations in order: writes first, then deletes.
    // A single save() producing both writes and deletes means the viewer
    // has computed a complete new state; ordering only matters for
    // observable intermediate states which we don't expose.
    for (const w of ops.writes) {
      await this.channel.write(w.path, w.content);
    }
    for (const d of ops.deletes) {
      await this.channel.delete(d);
    }
    // Emit the self event after all file ops have been ack'd.
    this.hasEmittedInitial = true;
    this.emit({ kind: "value", value, origin: "self" });
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    super.destroy();
  }
}

// Shared with file-glob — kept inline here to avoid cross-module imports
// in this leaf file. If a third provider needs it, lift to sources/glob.ts.
function compileGlobList(patterns: string[]): (path: string) => boolean {
  if (patterns.length === 0) return () => false;
  const regexes = patterns.map(compileGlob);
  return (path: string) => regexes.some((r) => r.test(path));
}

function compileGlob(pattern: string): RegExp {
  let p = pattern.replace(/^\.\//, "");
  let rx = "";
  let i = 0;
  while (i < p.length) {
    const ch = p[i];
    if (ch === "*") {
      if (p[i + 1] === "*") {
        rx += ".*";
        i += 2;
        if (p[i] === "/") i++;
      } else {
        rx += "[^/]*";
        i++;
      }
    } else if (ch === "?") {
      rx += "[^/]";
      i++;
    } else if ("\\^$.|+()[]{}".includes(ch)) {
      rx += "\\" + ch;
      i++;
    } else {
      rx += ch;
      i++;
    }
  }
  return new RegExp("^" + rx + "$");
}

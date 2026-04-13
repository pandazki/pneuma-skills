import { BaseSource } from "./base.js";
import type {
  FileChannel,
  FileChangeEvent,
} from "../types/source.js";
import type { ViewerFileContent } from "../types/viewer-contract.js";

export interface FileGlobConfig {
  patterns: string[];
  ignore?: string[];
}

/**
 * Multi-file aggregate source backed by a FileChannel. Subscribes to the
 * channel, filters incoming changes by its declared patterns, and emits
 * the full snapshot of matching files as a single SourceEvent on each
 * change.
 *
 * ## Why the whole snapshot, not just the delta?
 *
 * Existing viewers (all 6 write-back modes + diagram) consume a full
 * `files: ViewerFileContent[]` array and do `files.find(...)` / filter.
 * Emitting the full snapshot lets the P5 migration be a 1-line change
 * (useSource(sources.files)) without restructuring any viewer's internal
 * data flow. A future optimization could emit a delta shape, but it
 * would force every viewer to rebuild its own snapshot cache. YAGNI.
 *
 * ## Write semantics
 *
 * file-glob is READ-ONLY via `source.write()`. A viewer that wants to
 * write individual files should declare a separate `json-file` source
 * per file, or call FileChannel.write() directly if it genuinely needs
 * to write an arbitrary unstructured path (e.g. a binary asset). Calling
 * write() on a FileGlobSource throws.
 */
export class FileGlobSource extends BaseSource<ViewerFileContent[]> {
  private unsubscribe: (() => void) | null = null;
  private matcher: (path: string) => boolean;
  private ignoreMatcher: (path: string) => boolean;

  constructor(
    private config: FileGlobConfig,
    private channel: FileChannel,
  ) {
    super();
    this.matcher = compileGlobList(config.patterns);
    this.ignoreMatcher = compileGlobList(config.ignore ?? []);
    this.unsubscribe = channel.subscribe((batch) => this.onBatch(batch));
    // Fire initial snapshot on the next microtask so synchronous
    // subscribers see it.
    queueMicrotask(() => this.fireInitial());
  }

  private fireInitial(): void {
    if (this.isDestroyed) return;
    const matching = this.filterSnapshot(this.channel.snapshot());
    this.emit({ kind: "value", value: matching, origin: "initial" });
  }

  private onBatch(batch: FileChangeEvent[]): void {
    if (this.isDestroyed) return;
    const anyMatch = batch.some(
      (ev) => this.matcher(ev.path) && !this.ignoreMatcher(ev.path),
    );
    if (!anyMatch) return;
    // Determine the dominant origin for this emission. If any event in
    // the batch is tagged "self", we tag the whole emission "self"
    // (the viewer's own write round-tripped); otherwise "external".
    // We do NOT combine self+external in one emission — the FileChannel
    // guarantees that batches are coherent (one chokidar debounce window)
    // and a mixed-origin batch would indicate a runtime bug we want to
    // surface rather than paper over.
    const hasSelf = batch.some((ev) => ev.origin === "self");
    const origin: "self" | "external" = hasSelf ? "self" : "external";
    const matching = this.filterSnapshot(this.channel.snapshot());
    this.emit({ kind: "value", value: matching, origin });
  }

  private filterSnapshot(
    files: ReadonlyArray<ViewerFileContent>,
  ): ViewerFileContent[] {
    return files.filter(
      (f) => this.matcher(f.path) && !this.ignoreMatcher(f.path),
    );
  }

  protected async doWrite(_value: ViewerFileContent[]): Promise<void> {
    throw new Error(
      "FileGlobSource is read-only via Source.write(). To write " +
        "individual files, declare a json-file source per path or use " +
        "FileChannel.write() directly.",
    );
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    super.destroy();
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Minimal glob matcher
// ────────────────────────────────────────────────────────────────────────────

/**
 * Compile a list of glob patterns into a single predicate.
 *
 * Supports the subset of glob syntax that Pneuma's existing watchPatterns
 * use: `*` (any chars except /), `**` (any chars including /), `?`
 * (single char), literal paths. No brace expansion, no character classes.
 * If the list is empty, the predicate returns false (use this for the
 * ignore list; patterns list callers should guarantee non-empty).
 */
function compileGlobList(patterns: string[]): (path: string) => boolean {
  if (patterns.length === 0) return () => false;
  const regexes = patterns.map(compileGlob);
  return (path: string) => regexes.some((r) => r.test(path));
}

function compileGlob(pattern: string): RegExp {
  // Normalize leading ./ — watchPatterns don't typically use it, but be safe.
  let p = pattern.replace(/^\.\//, "");
  // Escape regex specials except for the glob metachars we care about.
  let rx = "";
  let i = 0;
  while (i < p.length) {
    const ch = p[i];
    if (ch === "*") {
      if (p[i + 1] === "*") {
        // ** — any characters including /
        rx += ".*";
        i += 2;
        // Swallow a following / so `**/foo` matches `foo` too.
        if (p[i] === "/") i++;
      } else {
        // * — any characters except /
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

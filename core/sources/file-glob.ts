import { BaseSource } from "./base.js";
import { compileGlobList } from "./glob.js";
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

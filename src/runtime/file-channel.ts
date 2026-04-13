import type {
  FileChannel,
  FileChangeEvent,
} from "../../core/types/source.js";
import type { ViewerFileContent } from "../../core/types/viewer-contract.js";
import { fileEventBus } from "./file-event-bus.js";
import { useStore } from "../store/index.js";

/**
 * Get the API base URL (dev proxy vs prod same-origin). Mirrors the
 * helper used inline in several mode viewers — centralized here so
 * every source gets the same resolution.
 */
function getApiBase(): string {
  if (import.meta.env.DEV) {
    return `http://${location.hostname}:${import.meta.env.VITE_API_PORT || "17007"}`;
  }
  return "";
}

/**
 * Browser-side FileChannel implementation. Backed by:
 *   - snapshot: the workspace slice `files` array
 *   - subscribe: fileEventBus (populated by workspace-slice.updateFiles)
 *   - write: POST /api/files
 *   - delete: DELETE /api/files?path=...
 *
 * One instance per active mode. The runtime creates it in
 * useSourceInstances (Task 3.7) and destroys it on mode switch. The
 * BrowserFileChannel owns the subscription relationship with
 * fileEventBus — its own subscribe/unsubscribe tracks handlers from
 * Source instances (file-glob / json-file / aggregate-file providers).
 */
export class BrowserFileChannel implements FileChannel {
  private unsubBus: (() => void) | null = null;
  private handlers = new Set<(batch: FileChangeEvent[]) => void>();

  constructor() {
    this.unsubBus = fileEventBus.subscribe((batch) => this.dispatch(batch));
  }

  snapshot(): ReadonlyArray<ViewerFileContent> {
    // Read directly from the store — synchronous, same source of truth
    // that useViewerProps uses to build props.files.
    const files = useStore.getState().files;
    return files.map((f) => ({ path: f.path, content: f.content }));
  }

  subscribe(handler: (batch: FileChangeEvent[]) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  async write(path: string, content: string): Promise<void> {
    const res = await fetch(`${getApiBase()}/api/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`POST /api/files failed: ${res.status} ${text}`);
    }
  }

  async delete(path: string): Promise<void> {
    const url = `${getApiBase()}/api/files?path=${encodeURIComponent(path)}`;
    const res = await fetch(url, { method: "DELETE" });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`DELETE /api/files failed: ${res.status} ${text}`);
    }
  }

  private dispatch(batch: FileChangeEvent[]): void {
    for (const handler of Array.from(this.handlers)) {
      try {
        handler(batch);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[file-channel] handler threw", err);
      }
    }
  }

  destroy(): void {
    this.unsubBus?.();
    this.unsubBus = null;
    this.handlers.clear();
  }
}

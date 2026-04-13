import type { FileChangeEvent } from "../../core/types/source.js";

/**
 * Browser-side singleton pub/sub for file change events. The workspace
 * slice's updateFiles() publishes to this bus; the FileChannel
 * implementation (src/runtime/file-channel.ts) subscribes and re-emits
 * to its own subscribers (which are Source instances).
 *
 * We use a module-level singleton because there is only ever one
 * workspace per browser tab in Pneuma. A multi-workspace future would
 * need to scope this to a session id.
 */
class FileEventBus {
  private handlers = new Set<(batch: FileChangeEvent[]) => void>();

  subscribe(handler: (batch: FileChangeEvent[]) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  publish(batch: FileChangeEvent[]): void {
    // Snapshot to allow handlers to subscribe/unsubscribe during delivery.
    for (const handler of Array.from(this.handlers)) {
      try {
        handler(batch);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[file-event-bus] handler threw", err);
      }
    }
  }
}

export const fileEventBus = new FileEventBus();

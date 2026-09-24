/**
 * `native` watch backend: ONE recursive `fs.watch` per root.
 *
 * Under Bun on macOS every `fs.watch` in the process is a path in one shared
 * FSEventStream, and Bun rebuilds that stream from "now" on every watch add or
 * close; events that land in the rebuild gap are lost (the gap grows with the
 * number of paths: ~20-40 ms at 1,200). So this backend registers the root
 * once and never adds or closes a watch while it runs. It cannot prune: the
 * layer drops ignored paths (a flood under an ignored `.venv` is delivered
 * and filtered in JS). Symlinks are not followed, on macOS or Linux.
 *
 * Measured on macOS arm64, Bun 1.4.0: setup 3-4 ms at any tree size, median
 * latency ~11 ms, 20,000-write floods delivered. On Linux Bun walks the tree
 * synchronously and adds one inotify watch per directory; running out of
 * watches is reported through `error` (the layer falls back to chokidar).
 */

// Called through the default export, not a named import, so a test can spy on
// `fs.watch` and prove the one-watch-per-root rule.
import fs from "node:fs";
import type { WatchBackend } from "./types.js";

export const nativeBackend: WatchBackend = ({ root }, sink) => {
  const watcher = fs.watch(root, { recursive: true, persistent: true }, (_event, filename) => {
    // Bun reports an overflow (Linux IN_Q_OVERFLOW, Windows ReadDirectoryChangesW)
    // as an event without a filename.
    if (filename === null || filename === undefined) {
      sink.overflow();
      return;
    }
    sink.notice(String(filename).replaceAll("\\", "/"));
  });
  watcher.on("error", (err) => sink.error(err as NodeJS.ErrnoException));

  let closed = false;
  return {
    kind: "native",
    ready: Promise.resolve(),
    close: async () => {
      if (closed) return;
      closed = true;
      watcher.close();
    },
  };
};

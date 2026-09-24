/**
 * `chokidar` watch backend: chokidar 5, pruning ignored directories before
 * traversal.
 *
 * The Linux and Windows default and the universal fallback. On Linux it
 * prunes (209 inotify watches where a recursive native watch registers
 * 2,105) and survives the watch limit where native errors; Bun adds inotify
 * watches incrementally there, so per-path watches have no loss window. On
 * Windows each directory gets its own ReadDirectoryChangesW buffer, so a flood
 * in one directory cannot overflow the whole tree's.
 *
 * NOT for macOS by default: under Bun its per-path `fs.watch` calls each
 * rebuild the process-wide FSEventStream and lose events in flight, and
 * registration is superlinear (see `native.ts`).
 *
 * Differences from the pre-layer watcher: no `awaitWriteFinish` (the layer
 * owns write stability for every backend) and `followSymlinks: false`
 * (native does not follow them either).
 *
 * The raw `fs.watch` events are forwarded too. chokidar emits `add` only
 * after a successful stat and `unlink` only for a path it tracked, so a file
 * created and removed before that stat produced no event at all, while a
 * snapshot or a project scan could have listed it (2026-09-24, Linux). The
 * layer stats every notice, so a duplicate costs one `lstat`.
 */

import { watch } from "chokidar";
import { basename, join, relative } from "node:path";
import type { WatchBackend } from "./types.js";

export const chokidarBackend: WatchBackend = ({ root, ignore }, sink) => {
  const toRel = (path: string): string | null => {
    const rel = relative(root, path).replaceAll("\\", "/");
    return rel === ".." || rel.startsWith("../") ? null : rel;
  };

  const watcher = watch(root, {
    persistent: true,
    ignoreInitial: true,
    followSymlinks: false,
    // chokidar v4+ compares string entries by equality (no globs), so the
    // predicate is always a function.
    ignored: (path, stats) => {
      const rel = toRel(path);
      if (rel === null || rel === "") return false;
      return ignore(rel, stats ? stats.isDirectory() : undefined);
    },
  });

  const onPath = (path: string) => {
    const rel = toRel(path);
    if (rel) sink.notice(rel);
  };
  watcher.on("add", onPath);
  watcher.on("change", onPath);
  watcher.on("unlink", onPath);
  watcher.on("addDir", onPath);
  watcher.on("unlinkDir", onPath);
  watcher.on("raw", (_event, evPath, details) => {
    const watched = (details as { watchedPath?: string } | undefined)?.watchedPath;
    if (!watched) return;
    // A directory's watch names the child; a file's watch names the file.
    // (A child named like its directory is noticed as the directory, whose
    // reconcile covers it.)
    onPath(!evPath || evPath === basename(watched) ? watched : join(watched, evPath));
  });
  watcher.on("error", (err) => sink.error(err as NodeJS.ErrnoException));

  const ready = new Promise<void>((resolve) => watcher.once("ready", () => resolve()));
  return { kind: "chokidar", ready, close: () => watcher.close() };
};

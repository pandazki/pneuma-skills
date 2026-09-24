/**
 * Watch backend contract.
 *
 * A backend reports only that "something happened at rel". Event types are
 * deliberately absent: under Bun on macOS every FSEvents event is typed
 * `rename` (FSEvents flags are sticky per path), so the layer classifies each
 * notice with one `lstat` instead. See `server/watch/index.ts`.
 */

import type { WatcherBackendKind } from "../../core/types/workspace-watcher.js";

/**
 * Root-relative, '/'-separated path → true to skip it. `isDir` is undefined
 * when the entry has not been classified yet; the predicate must then return
 * true only for a path it would skip as either a file or a directory.
 * Backends that can prune before traversal (chokidar) use it to do so.
 */
export type WatchIgnore = (rel: string, isDir: boolean | undefined) => boolean;

export interface WatchBackendOptions {
  /** Absolute path of an existing directory. */
  root: string;
  ignore: WatchIgnore;
}

export interface WatchSink {
  /** Something happened at `rel` (root-relative, '/'-separated; "" is the root). */
  notice(rel: string): void;
  /** The OS lost events (Linux IN_Q_OVERFLOW, Windows buffer overflow): rescan. */
  overflow(): void;
  /** A registration failure or runtime error. */
  error(err: NodeJS.ErrnoException): void;
}

export interface WatchBackendHandle {
  readonly kind: WatcherBackendKind;
  /** Resolves once the backend delivers every later change under the root. */
  readonly ready: Promise<void>;
  close(): Promise<void>;
}

/** May throw synchronously when the root cannot be registered at all. */
export type WatchBackend = (opts: WatchBackendOptions, sink: WatchSink) => WatchBackendHandle;

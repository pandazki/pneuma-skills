/**
 * Workspace watcher contract.
 *
 * A session's file watcher runs on one of two backends behind one layer
 * (`server/watch/`):
 *
 * - `native`   — one recursive `fs.watch` per watched root. The macOS default:
 *                under Bun every `fs.watch` shares one FSEventStream that is
 *                rebuilt on each add/close, so per-path watches lose events.
 * - `chokidar` — chokidar 5 with pre-traversal pruning. The Linux and Windows
 *                default, and the fallback when `native` cannot cover a root.
 *
 * `PNEUMA_WATCHER=native|chokidar` overrides the platform default. The health
 * record below is reported as `watcher` by `GET /api/session`.
 */

export const WATCHER_BACKEND_KINDS = ["native", "chokidar"] as const;

export type WatcherBackendKind = (typeof WATCHER_BACKEND_KINDS)[number];

/**
 * Parse a `PNEUMA_WATCHER` value. Returns null for an absent or unknown
 * value; the caller then keeps the platform default (and says so).
 */
export function parseWatcherBackendKind(value: string | null | undefined): WatcherBackendKind | null {
  if (value == null) return null;
  const normalized = value.trim().toLowerCase();
  return (WATCHER_BACKEND_KINDS as readonly string[]).includes(normalized)
    ? (normalized as WatcherBackendKind)
    : null;
}

/** `GET /api/session` → `watcher` (null when the server has no workspace watcher). */
export interface WatcherHealth {
  /** Backend currently delivering events (after any fallback). */
  backend: WatcherBackendKind;
  /** True once the backend is registered and the initial file index is built. */
  ready: boolean;
  /**
   * True when the watcher left its selected backend (fallback) or a backend
   * reported an error. Coverage or latency may differ from the default; the
   * server log names the cause.
   */
  degraded: boolean;
  /**
   * Epoch ms of the last change the backend reported under a watched
   * (non-ignored) path; null before the first one. A probe write that does
   * not move it means the watcher is not hearing the workspace.
   */
  lastEventAt: number | null;
}

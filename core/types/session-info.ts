import type { WatcherHealth } from "./workspace-watcher.js";

/** Session shell metadata returned by GET /api/session, independent of the backend. */
export interface SessionInfo {
  sessionId: string | null;
  /** Resolved human-readable name, or null until this session has one. */
  title: string | null;
  workspace: string;
  project: {
    projectRoot: string;
    homeRoot: string;
    sessionDir: string;
    projectName?: string;
    projectDescription?: string;
  } | null;
  watcher: WatcherHealth | null;
}

/**
 * Manual registry renames win over persisted names and agent refinements.
 * Disk metadata may be absent or malformed; blank names are not titles.
 */
export function resolveSessionTitle(persisted: unknown, registered: unknown): string | null {
  const record = (value: unknown): Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  const saved = record(persisted);
  const registry = record(registered);
  for (const value of [registry.sessionName, saved.sessionName, saved.displayName, registry.displayName]) {
    if (typeof value !== "string") continue;
    const title = value.replace(/\s+/g, " ").trim();
    if (title) return title;
  }
  return null;
}

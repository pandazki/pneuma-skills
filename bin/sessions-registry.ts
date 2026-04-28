/**
 * Sessions Registry (Pneuma 3.0)
 *
 * Handles sessions.json schema migration and CRUD operations:
 * - Reads legacy array (SessionRecord[]) and upgrades to new shape
 * - Reads new shape ({ projects, sessions }) unchanged
 * - Provides upsert helpers for quick and project session entries
 *
 * File: ~/.pneuma/sessions.json
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentBackendType } from "../core/types/agent-backend.js";
import { getDefaultBackendType } from "../backends/index.js";

/**
 * Project registry entry — represents a project in the global registry.
 * Used to track projects with multiple sessions.
 */
export interface ProjectRegistryEntry {
  /** ID: typically the absolute project root path */
  id: string;
  /** Slug-like project identifier */
  name: string;
  /** Human-readable project name */
  displayName: string;
  /** Optional project description */
  description?: string;
  /** Absolute path to project root */
  root: string;
  /** Timestamp (ms) when project was created */
  createdAt: number;
  /** Timestamp (ms) of last access */
  lastAccessed: number;
  /**
   * Soft-delete flag — when `true` the project is hidden from default
   * listings but its on-disk files (sessions, manifest, preferences) are
   * untouched. Treat `undefined` as equivalent to `false`; the writer
   * deliberately omits the field rather than serializing `archived: false`
   * so legacy entries remain byte-identical after a round trip.
   */
  archived?: boolean;
}

/**
 * Quick session entry — legacy 2.x workspace-rooted session.
 * State is stored under workspace/.pneuma/ directly.
 */
export interface QuickSessionRegistryEntry {
  /** ID: workspace::mode */
  id: string;
  kind: "quick";
  /** Mode name (doc, webcraft, etc.) */
  mode: string;
  /** Display name for this session */
  displayName: string;
  /** Optional: custom display name from --session-name */
  sessionName?: string;
  /** Absolute path to workspace directory */
  workspace: string;
  /** Absolute path to session state directory (same as workspace for quick sessions) */
  sessionDir: string;
  /** Backend type (claude-code or codex) */
  backendType: AgentBackendType;
  /** Last accessed timestamp (ms) */
  lastAccessed: number;
  /** Whether editing is enabled */
  editing?: boolean;
}

/**
 * Project session entry — Pneuma 3.0 project-based session.
 * State is stored under projectRoot/.pneuma/sessions/{id}/.
 */
export interface ProjectSessionRegistryEntry {
  /** ID: projectRoot::sessionId (unique across projects) */
  id: string;
  kind: "project";
  /** Session ID within the project */
  sessionId: string;
  /** Absolute path to project root */
  projectRoot: string;
  /** Mode name (doc, webcraft, etc.) */
  mode: string;
  /** Display name for this session */
  displayName: string;
  /** Optional: custom display name from --session-name */
  sessionName?: string;
  /** Absolute path to session state directory (projectRoot/.pneuma/sessions/{id}) */
  sessionDir: string;
  /** Backend type (claude-code or codex) */
  backendType: AgentBackendType;
  /** Last accessed timestamp (ms) */
  lastAccessed: number;
  /** Whether editing is enabled */
  editing?: boolean;
}

/**
 * Union type for session registry entries.
 */
export type AnySessionRegistryEntry =
  | QuickSessionRegistryEntry
  | ProjectSessionRegistryEntry;

/**
 * Root shape of ~/.pneuma/sessions.json (Pneuma 3.0+).
 * Replaces the legacy array format.
 */
export interface SessionsFile {
  projects: ProjectRegistryEntry[];
  sessions: AnySessionRegistryEntry[];
}

/**
 * Parse raw JSON content into a SessionsFile, applying legacy upgrade.
 * Shared by both async and sync readers — keeps a single canonical
 * upgrade path so the two siblings can't drift apart.
 *
 * @param text — UTF-8 contents of sessions.json (or empty string)
 * @returns SessionsFile with both projects and sessions arrays
 */
function parseSessionsContent(text: string): SessionsFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { projects: [], sessions: [] };
  }

  // Legacy: array of SessionRecord[] → upgrade to new shape
  if (Array.isArray(raw)) {
    const sessions: AnySessionRegistryEntry[] = raw.map((r) => {
      const rec = r as Record<string, unknown>;
      return {
        id: String(rec.id ?? ""),
        kind: "quick" as const,
        mode: String(rec.mode ?? "doc"),
        displayName: String(rec.displayName ?? ""),
        sessionName:
          typeof rec.sessionName === "string" ? rec.sessionName : undefined,
        workspace: String(rec.workspace ?? ""),
        sessionDir: String(rec.workspace ?? ""), // legacy: workspace == sessionDir
        backendType: (rec.backendType as AgentBackendType) || getDefaultBackendType(),
        lastAccessed: Number(rec.lastAccessed ?? 0),
        editing:
          typeof rec.editing === "boolean" ? rec.editing : undefined,
      };
    });
    return { projects: [], sessions };
  }

  // New shape: { projects?, sessions? }
  if (raw && typeof raw === "object" && "sessions" in raw) {
    const obj = raw as {
      projects?: ProjectRegistryEntry[];
      sessions?: AnySessionRegistryEntry[];
    };
    return {
      projects: Array.isArray(obj.projects) ? obj.projects : [],
      sessions: Array.isArray(obj.sessions) ? obj.sessions : [],
    };
  }

  // Fallback for malformed data
  return { projects: [], sessions: [] };
}

/**
 * Read sessions.json with automatic legacy upgrade.
 * - If file doesn't exist: returns empty object
 * - If array: upgrades to { projects: [], sessions: [...] }
 * - If object with sessions/projects: returns as-is
 *
 * @param path — path to ~/.pneuma/sessions.json
 * @returns SessionsFile with both projects and sessions arrays
 */
export async function readSessionsFile(path: string): Promise<SessionsFile> {
  if (!existsSync(path)) {
    return { projects: [], sessions: [] };
  }

  let text: string;
  try {
    text = await readFile(path, "utf-8");
  } catch {
    return { projects: [], sessions: [] };
  }

  return parseSessionsContent(text);
}

/**
 * Synchronous sibling of {@link readSessionsFile}. Used by code paths that
 * cannot easily go async (e.g. `reconcileSessionsRegistry`, the launcher
 * boot's auto-start scan). Same logic, same legacy-upgrade behavior.
 */
export function readSessionsFileSync(path: string): SessionsFile {
  if (!existsSync(path)) {
    return { projects: [], sessions: [] };
  }

  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch {
    return { projects: [], sessions: [] };
  }

  return parseSessionsContent(text);
}

/**
 * Write sessions.json in the new shape.
 * Creates parent directory if needed.
 *
 * @param path — path to ~/.pneuma/sessions.json
 * @param data — SessionsFile object to persist
 */
export async function writeSessionsFile(
  path: string,
  data: SessionsFile
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2), "utf-8");
}

/**
 * Synchronous sibling of {@link writeSessionsFile}. Used by code paths that
 * cannot easily go async. Same logic.
 */
export function writeSessionsFileSync(path: string, data: SessionsFile): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
}

/**
 * Upsert a session entry, keeping most recent first.
 *
 * @param data — current SessionsFile
 * @param entry — session entry to upsert (replaces existing with same id, or prepends)
 * @param cap — max number of session entries to keep (default 200)
 * @returns new SessionsFile with upserted session
 */
export function upsertSession(
  data: SessionsFile,
  entry: AnySessionRegistryEntry,
  cap = 200
): SessionsFile {
  const filtered = data.sessions.filter((s) => s.id !== entry.id);
  filtered.unshift(entry);
  return { projects: data.projects, sessions: filtered.slice(0, cap) };
}

/**
 * Upsert a project entry, keeping most recent first.
 *
 * Preserves `archived` from the existing entry when the incoming entry
 * doesn't carry the flag — same merge pattern as {@link pickSessionName}.
 * This prevents a plain `pneuma <mode>` resume from silently un-archiving a
 * project just because the launch path doesn't know about archive state.
 *
 * @param data — current SessionsFile
 * @param entry — project entry to upsert (replaces existing with same id, or prepends)
 * @returns new SessionsFile with upserted project
 */
export function upsertProject(
  data: SessionsFile,
  entry: ProjectRegistryEntry
): SessionsFile {
  const existing = data.projects.find((p) => p.id === entry.id);
  const filtered = data.projects.filter((p) => p.id !== entry.id);
  const merged: ProjectRegistryEntry = {
    ...entry,
  };
  const archived = pickArchived(entry.archived, existing?.archived);
  if (archived === true) {
    merged.archived = true;
  } else {
    delete merged.archived;
  }
  filtered.unshift(merged);
  return { projects: filtered, sessions: data.sessions };
}

/**
 * Merge rule for the `archived` flag during an upsert.
 *
 * - If the incoming entry explicitly sets `archived` (true or false), it wins.
 * - Otherwise the existing flag is preserved.
 * - `undefined` on both sides folds to `undefined` (treated as not archived
 *   on read).
 *
 * Mirrors {@link pickSessionName}'s shape so the archive flag survives plain
 * resume-style upserts that don't carry archive metadata.
 */
export function pickArchived(
  incoming: boolean | undefined,
  existing: boolean | undefined
): boolean | undefined {
  if (incoming !== undefined) return incoming;
  return existing;
}

/**
 * Soft-archive the project with the given id. Returns a new SessionsFile
 * with the matching project's `archived` flag set to true; siblings are
 * untouched. If the id isn't found, returns the input data unchanged
 * (idempotent — the caller doesn't need to special-case the miss).
 */
export function archiveProject(
  data: SessionsFile,
  id: string
): SessionsFile {
  const projects = data.projects.map((p) =>
    p.id === id ? { ...p, archived: true } : p
  );
  return { projects, sessions: data.sessions };
}

/**
 * Restore a soft-archived project — clears the `archived` flag (omits it
 * from the entry rather than writing `archived: false`, so the round-tripped
 * shape matches a never-archived entry byte-for-byte). If the id isn't
 * found, returns the input data unchanged.
 */
export function restoreProject(
  data: SessionsFile,
  id: string
): SessionsFile {
  const projects = data.projects.map((p) => {
    if (p.id !== id) return p;
    const { archived: _omit, ...rest } = p;
    return rest;
  });
  return { projects, sessions: data.sessions };
}

/**
 * Pre-3.0 the session-rename feature relied on the upsert path keeping the
 * existing custom name when a resume launch didn't supply one. The 3.0
 * registry refactor dropped that branch and started overwriting with
 * `undefined`, so a plain `pneuma <mode>` resume silently erased renames.
 *
 * This helper formalizes the merge: the new run's `--session-name` wins when
 * present (including being able to update an existing rename), otherwise we
 * keep whatever the registry already had.
 *
 * Returns `undefined` when neither side carries a name — callers should write
 * the property as `undefined` so the json shape stays stable.
 *
 * @param incoming — `--session-name` value from the current run (`""`/`undefined` = not provided)
 * @param existing — sessionName from the prior registry entry, if any
 */
export function pickSessionName(
  incoming: string | undefined,
  existing: string | undefined
): string | undefined {
  if (incoming !== undefined && incoming !== "") return incoming;
  return existing;
}

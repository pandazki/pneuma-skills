/**
 * Project init from existing sessions.
 *
 * When the user creates a project and selects 1+ existing quick sessions,
 * each selected session is **copied** (non-destructive) into a new founder
 * session subdir under `<projectRoot>/.pneuma/sessions/<newSessionId>/`.
 *
 * Sources of state for a quick session live at `<workspace>/.pneuma/`. The
 * skill files (`.claude/skills/`, `CLAUDE.md`) live at `<workspace>/`. We
 * copy:
 *
 *   <source>/.pneuma/{session.json, history.json, config.json,
 *     skill-version.json, shadow.git/, checkpoints.jsonl}
 *     → <newSessionDir>/{...}
 *   <source>/.claude/skills/  → <newSessionDir>/.claude/skills/
 *   <source>/CLAUDE.md        → <newSessionDir>/CLAUDE.md
 *   <source>/.agents/skills/  → <newSessionDir>/.agents/skills/  (codex)
 *   <source>/AGENTS.md        → <newSessionDir>/AGENTS.md         (codex)
 *
 * The `session.json` is rewritten to use the freshly-minted UUID. The
 * `agentSessionId` is preserved so resume continues to work; the agent CLI
 * will spawn a *new* underlying session if the resume token is rejected.
 *
 * The original source workspace is left untouched.
 */

import { cp, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  readSessionsFile,
  writeSessionsFile,
  upsertSession,
  type AnySessionRegistryEntry,
  type ProjectSessionRegistryEntry,
  type QuickSessionRegistryEntry,
  type SessionsFile,
} from "../bin/sessions-registry.js";
import { resolveSessionPaths } from "../core/path-resolver-pneuma.js";

export interface ImportedSessionInfo {
  sessionId: string;
  mode: string;
  displayName: string;
  sessionDir: string;
}

export interface ImportSessionsOptions {
  projectRoot: string;
  /** Session registry IDs (the `id` field, e.g. "<workspace>::<mode>"). */
  sourceSessionIds: string[];
  sessionsRegistryPath: string;
  /** Time used to stamp `lastAccessed` for the imported entries. */
  now?: number;
}

export interface ImportSessionsResult {
  imported: ImportedSessionInfo[];
  skipped: string[];
}

/**
 * Best-effort copy: returns true if `src` exists and was copied, false otherwise.
 * Uses `cp(..., { recursive: true })` for directories and bare files alike.
 */
async function copyIfExists(src: string, dst: string): Promise<boolean> {
  if (!existsSync(src)) return false;
  await cp(src, dst, { recursive: true });
  return true;
}

/**
 * Find a session in the registry by id and return it iff it's a quick session.
 * Project sessions are not importable (they already live inside a project).
 */
function findQuickSession(
  data: SessionsFile,
  id: string,
): QuickSessionRegistryEntry | null {
  const entry = data.sessions.find((s) => s.id === id);
  if (!entry) return null;
  if (entry.kind !== "quick") return null;
  return entry;
}

/**
 * Copy one quick session's state + skill files into a fresh subdir.
 *
 * @returns ImportedSessionInfo on success, or null if the source workspace
 *          can't be found / read.
 */
async function importOneSession(
  source: QuickSessionRegistryEntry,
  projectRoot: string,
  now: number,
): Promise<{ info: ImportedSessionInfo; entry: ProjectSessionRegistryEntry } | null> {
  if (!existsSync(source.workspace)) return null;
  const sourceStateDir = join(source.workspace, ".pneuma");
  const sourceSessionJson = join(sourceStateDir, "session.json");

  const newSessionId = crypto.randomUUID();
  const paths = resolveSessionPaths({
    kind: "project",
    projectRoot,
    sessionId: newSessionId,
  });
  await mkdir(paths.stateDir, { recursive: true });

  // 1) session.json — rewrite sessionId, keep agentSessionId / mode / backendType.
  let originalSession: Record<string, unknown> = {};
  if (existsSync(sourceSessionJson)) {
    try {
      originalSession = JSON.parse(await readFile(sourceSessionJson, "utf-8"));
    } catch {
      originalSession = {};
    }
  }
  const newSession = {
    ...originalSession,
    sessionId: newSessionId,
    mode: source.mode,
    backendType: source.backendType,
    createdAt:
      typeof originalSession.createdAt === "number"
        ? originalSession.createdAt
        : now,
  };
  await writeFile(
    join(paths.stateDir, "session.json"),
    JSON.stringify(newSession, null, 2),
    "utf-8",
  );

  // 2) Copy state files that exist.
  for (const f of ["history.json", "config.json", "skill-version.json", "checkpoints.jsonl"]) {
    const src = join(sourceStateDir, f);
    if (existsSync(src)) {
      await copyFile(src, join(paths.stateDir, f));
    }
  }
  // shadow.git/ — recursive
  await copyIfExists(join(sourceStateDir, "shadow.git"), join(paths.stateDir, "shadow.git"));

  // 3) Skill files at workspace root.
  await copyIfExists(join(source.workspace, ".claude"), join(paths.stateDir, ".claude"));
  await copyIfExists(join(source.workspace, ".agents"), join(paths.stateDir, ".agents"));
  await copyIfExists(join(source.workspace, "CLAUDE.md"), join(paths.stateDir, "CLAUDE.md"));
  await copyIfExists(join(source.workspace, "AGENTS.md"), join(paths.stateDir, "AGENTS.md"));

  const entry: ProjectSessionRegistryEntry = {
    id: `${projectRoot}::${newSessionId}`,
    kind: "project",
    sessionId: newSessionId,
    projectRoot,
    mode: source.mode,
    displayName: source.displayName,
    sessionName: source.sessionName,
    sessionDir: paths.sessionDir,
    backendType: source.backendType,
    lastAccessed: now,
    editing: source.editing,
  };

  const info: ImportedSessionInfo = {
    sessionId: newSessionId,
    mode: source.mode,
    displayName: source.displayName,
    sessionDir: paths.sessionDir,
  };

  return { info, entry };
}

/**
 * Public entry point. Imports zero or more sessions; non-existent ids are
 * silently skipped (kept in `skipped` for the caller to report if desired).
 */
export async function importSessionsIntoProject(
  opts: ImportSessionsOptions,
): Promise<ImportSessionsResult> {
  const now = opts.now ?? Date.now();
  const data = await readSessionsFile(opts.sessionsRegistryPath);
  const imported: ImportedSessionInfo[] = [];
  const skipped: string[] = [];
  let workingData: SessionsFile = data;

  for (const id of opts.sourceSessionIds) {
    const source = findQuickSession(workingData, id);
    if (!source) {
      skipped.push(id);
      continue;
    }
    const result = await importOneSession(source, opts.projectRoot, now);
    if (!result) {
      skipped.push(id);
      continue;
    }
    imported.push(result.info);
    workingData = upsertSession(workingData, result.entry as AnySessionRegistryEntry);
  }

  if (imported.length > 0) {
    await writeSessionsFile(opts.sessionsRegistryPath, workingData);
  }

  return { imported, skipped };
}

import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  isProjectManifest,
  type ProjectManifest,
} from "./types/project-manifest.js";

export type WorkspaceKind = "quick" | "project";

export async function detectWorkspaceKind(workspace: string): Promise<WorkspaceKind> {
  const projectJson = join(workspace, ".pneuma", "project.json");
  return existsSync(projectJson) ? "project" : "quick";
}

export async function loadProjectManifest(
  projectRoot: string
): Promise<ProjectManifest | null> {
  const path = join(projectRoot, ".pneuma", "project.json");
  if (!existsSync(path)) return null;
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw);
    return isProjectManifest(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeProjectManifest(
  projectRoot: string,
  manifest: ProjectManifest
): Promise<void> {
  const dir = join(projectRoot, ".pneuma");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "project.json"),
    JSON.stringify(manifest, null, 2),
    "utf-8"
  );
}

export interface ProjectSessionRef {
  /**
   * Canonical project-session id. Always matches the session's directory name
   * under `<projectRoot>/.pneuma/sessions/`, never the backend's protocol id —
   * those are stored separately in `session.json` as `agentSessionId`.
   */
  sessionId: string;
  mode: string;
  sessionDir: string;
  /**
   * Backend type the session was created with (`claude-code`, `codex`, ...).
   * Defaults to `claude-code` for older sessions where `session.json` predates
   * the `backendType` field. Surface so resume callers can pick the right
   * backend instead of the launcher default.
   */
  backendType?: string;
  /**
   * Human-readable session name (from `--session-name` or rename), if persisted
   * in `session.json` as `sessionName`/`displayName`. Undefined when the user
   * never named the session — callers fall back to the truncated id.
   */
  displayName?: string;
  /**
   * Last-touched timestamp (ms epoch). Sourced from `history.json` mtime when
   * present, then `session.json` mtime, then the persisted `createdAt`.
   * Reflects "when the user last did something here" rather than just creation.
   */
  lastAccessed?: number;
}

export async function scanProjectSessions(
  projectRoot: string
): Promise<ProjectSessionRef[]> {
  const sessionsDir = join(projectRoot, ".pneuma", "sessions");
  if (!existsSync(sessionsDir)) return [];
  const entries = await readdir(sessionsDir);
  const out: ProjectSessionRef[] = [];
  for (const id of entries) {
    const sessionDir = join(sessionsDir, id);
    const sessionJson = join(sessionDir, "session.json");
    if (!existsSync(sessionJson)) continue;
    try {
      const s = await stat(sessionDir);
      if (!s.isDirectory()) continue;
      const data = JSON.parse(await readFile(sessionJson, "utf-8")) as {
        sessionId?: string;
        mode?: string;
        backendType?: string;
        sessionName?: string;
        displayName?: string;
        createdAt?: number;
      };
      if (typeof data.mode !== "string") continue;
      // Trust the directory name as the canonical session id — that's what
      // `/api/launch` round-trips to find this session again. `session.json`'s
      // top-level `sessionId` should match, but if a stale write left them out
      // of sync (the bug Fix 1 plugs), preferring the directory name keeps the
      // panel usable.
      const sessionId =
        typeof data.sessionId === "string" && data.sessionId.length > 0
          ? data.sessionId
          : id;

      // lastAccessed: history.json mtime > session.json mtime > createdAt.
      let lastAccessed: number | undefined;
      const historyPath = join(sessionDir, "history.json");
      try {
        if (existsSync(historyPath)) {
          lastAccessed = (await stat(historyPath)).mtimeMs;
        }
      } catch {
        // ignore
      }
      if (lastAccessed === undefined) {
        try {
          lastAccessed = (await stat(sessionJson)).mtimeMs;
        } catch {
          // ignore
        }
      }
      if (lastAccessed === undefined && typeof data.createdAt === "number") {
        lastAccessed = data.createdAt;
      }

      const displayName =
        typeof data.sessionName === "string" && data.sessionName.length > 0
          ? data.sessionName
          : typeof data.displayName === "string" && data.displayName.length > 0
            ? data.displayName
            : undefined;

      out.push({
        sessionId,
        mode: data.mode,
        sessionDir,
        ...(typeof data.backendType === "string"
          ? { backendType: data.backendType }
          : {}),
        ...(displayName !== undefined ? { displayName } : {}),
        ...(lastAccessed !== undefined ? { lastAccessed } : {}),
      });
    } catch {
      // skip corrupt session
    }
  }
  return out;
}

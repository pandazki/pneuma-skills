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
  /**
   * URL to fetch the session's viewer thumbnail (per-mode snapshot written by
   * the viewer at run time). Only set when `<sessionDir>/thumbnail.png` exists
   * on disk. The route serving this URL is `/api/projects/:id/sessions/:sid/thumbnail`.
   */
  thumbnailUrl?: string;
  /**
   * One-line preview derived from `history.json`'s first user message. Used
   * by the project panel so three sessions of the same mode are visually
   * distinguishable. Truncated to ~100 chars + "…" and kept to a single
   * sentence. Undefined when history is missing or contains no user message.
   */
  preview?: string;
}

/**
 * Extract a one-line preview from a Pneuma `history.json`. The first
 * `user_message` entry's text is used; viewer-context wrappers and chat
 * history `<viewer-context>...</viewer-context>` prefixes are stripped so the
 * preview reflects what the user actually typed.
 *
 * Defensive against malformed payloads: returns `undefined` for any parse /
 * shape error rather than throwing.
 */
function extractPreviewFromHistory(raw: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as { type?: string; role?: string; content?: unknown; message?: unknown };
    const isUser =
      e.type === "user_message" ||
      (e.role === "user" && typeof e.content !== "undefined");
    if (!isUser) continue;
    let text: string | undefined;
    if (typeof e.content === "string") {
      text = e.content;
    } else if (Array.isArray(e.content)) {
      // Anthropic-style content blocks: pick the first text block.
      for (const block of e.content) {
        if (
          block &&
          typeof block === "object" &&
          (block as { type?: string }).type === "text" &&
          typeof (block as { text?: unknown }).text === "string"
        ) {
          text = (block as { text: string }).text;
          break;
        }
      }
    }
    if (typeof text !== "string") continue;
    // Strip leading <viewer-context>...</viewer-context> wrapper if present —
    // it's machine-generated context, not user intent.
    const cleaned = text.replace(/^\s*<viewer-context[^>]*>[\s\S]*?<\/viewer-context>\s*/i, "");
    const trimmed = cleaned.trim();
    if (!trimmed) continue;
    // Take only the first sentence (split on ., !, ?, or newline).
    const sentenceMatch = trimmed.match(/^[\s\S]*?[.!?](?=\s|$)/);
    let firstSentence = sentenceMatch ? sentenceMatch[0].trim() : trimmed.split(/\n/)[0]!.trim();
    if (firstSentence.length > 100) {
      firstSentence = `${firstSentence.slice(0, 100).trimEnd()}…`;
    }
    return firstSentence || undefined;
  }
  return undefined;
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
      // The directory name is the canonical session id — it's what `/api/launch`
      // round-trips to find this session, and what the URL carries. `session.json`'s
      // top-level `sessionId` should match the directory name, but we've seen
      // legacy / pre-fix sessions where it points at a sibling directory. Override
      // when missing/empty *or* when it doesn't match the directory name —
      // otherwise the panel's resume click resolves to a stale, possibly-wrong dir.
      const matchesDir =
        typeof data.sessionId === "string" &&
        data.sessionId.length > 0 &&
        data.sessionId === id;
      const sessionId = matchesDir ? (data.sessionId as string) : id;

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

      // thumbnailUrl: per-session viewer snapshot. The frontend hits the URL
      // produced by `/api/projects/:id/sessions/:sid/thumbnail` (mounted in
      // projects-routes.ts), so we just check existence here and let the
      // route do the actual file read.
      const thumbnailPath = join(sessionDir, "thumbnail.png");
      const thumbnailUrl = existsSync(thumbnailPath)
        ? `/api/projects/${encodeURIComponent(projectRoot)}/sessions/${encodeURIComponent(sessionId)}/thumbnail`
        : undefined;

      // preview: first user message text from history.json. Skipped silently
      // when history is missing or malformed — three illustrate sessions still
      // distinguish themselves via thumbnail / time even without preview text.
      let preview: string | undefined;
      if (existsSync(historyPath)) {
        try {
          const raw = await readFile(historyPath, "utf-8");
          preview = extractPreviewFromHistory(raw);
        } catch {
          // ignore
        }
      }

      out.push({
        sessionId,
        mode: data.mode,
        sessionDir,
        ...(typeof data.backendType === "string"
          ? { backendType: data.backendType }
          : {}),
        ...(displayName !== undefined ? { displayName } : {}),
        ...(lastAccessed !== undefined ? { lastAccessed } : {}),
        ...(thumbnailUrl !== undefined ? { thumbnailUrl } : {}),
        ...(preview !== undefined ? { preview } : {}),
      });
    } catch {
      // skip corrupt session
    }
  }
  return out;
}

#!/usr/bin/env bun
/**
 * list-project-sessions.ts — Enumerate the current project's Pneuma
 * sessions with just enough signal to re-title the un-tidied ones.
 *
 * Reads `$PNEUMA_PROJECT_ROOT/.pneuma/sessions/<id>/{session.json,history.json}`
 * for every session, then prints a single JSON object to stdout:
 *
 *   {
 *     "projectRoot": "/abs/path",
 *     "total": 12,
 *     "needsTidy": 7,
 *     "sessions": [
 *       {
 *         "sessionId": "abc",
 *         "mode": "webcraft",
 *         "displayName": null,        // current stored title (null = default)
 *         "description": null,        // current stored summary
 *         "sessionName": null,        // user's manual rename (wins over refine)
 *         "needsTidy": true,          // no manual name AND no refined title
 *         "skipReason": null,         // why it was skipped, if needsTidy=false
 *         "messageCount": 14,
 *         "lastAccessed": 1777570000000,
 *         "digest": ["first user message…", "second…"]   // synthetic tags dropped
 *       }
 *     ]
 *   }
 *
 * Self-contained: only node built-ins. Run from the agent's session dir:
 *   bun .claude/skills/pneuma-project-tidy/scripts/list-project-sessions.ts
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const DIGEST_MAX_MESSAGES = 8;
const DIGEST_MAX_CHARS = 220;

function projectRoot(): string {
  const root = process.env.PNEUMA_PROJECT_ROOT;
  if (!root) {
    console.error(
      "PNEUMA_PROJECT_ROOT is not set — this script only runs inside a project session.",
    );
    process.exit(2);
  }
  return root;
}

interface SessionJson {
  sessionId?: string;
  mode?: string;
  sessionName?: string;
  displayName?: string;
  description?: string;
  refinedAt?: number;
  createdAt?: number;
}

interface HistoryMessage {
  type?: string;
  content?: unknown;
  timestamp?: number;
}

/**
 * Strip the synthetic blocks the runtime prepends to a user turn —
 * `<viewer-context>…</viewer-context>`, `<user-actions>…</user-actions>`,
 * and self-closing `<pneuma:… />` / `<system-… />` env tags — leaving the
 * human's actual words. Returns "" when the message is pure synthetic noise.
 */
function stripSyntheticPrefix(input: string): string {
  let s = input.trim();
  let prev: string;
  do {
    prev = s;
    s = s.replace(/^<(viewer-context|user-actions)\b[^>]*>[\s\S]*?<\/\1>\s*/i, "");
    s = s.replace(/^<(?:pneuma:[\w-]+|system-[\w-]+)\b[^>]*\/>\s*/i, "");
    s = s.replace(/^<(pneuma:[\w-]+)\b[^>]*>[\s\S]*?<\/\1>\s*/i, "");
    s = s.trim();
  } while (s !== prev);
  return s;
}

/** A "real" user message — synthetic context/env wrappers removed. */
function realUserText(msg: HistoryMessage): string | null {
  if (msg.type !== "user_message") return null;
  if (typeof msg.content !== "string") return null;
  const text = stripSyntheticPrefix(msg.content);
  return text.length > 0 ? text : null;
}

async function readHistoryDigest(
  historyPath: string,
): Promise<{ digest: string[]; messageCount: number }> {
  let raw: string;
  try {
    raw = await readFile(historyPath, "utf-8");
  } catch {
    return { digest: [], messageCount: 0 };
  }
  let parsed: HistoryMessage[];
  try {
    parsed = JSON.parse(raw) as HistoryMessage[];
  } catch {
    return { digest: [], messageCount: 0 };
  }
  if (!Array.isArray(parsed)) return { digest: [], messageCount: 0 };

  const digest: string[] = [];
  let messageCount = 0;
  for (const msg of parsed) {
    const text = realUserText(msg);
    if (text === null) continue;
    messageCount++;
    if (digest.length < DIGEST_MAX_MESSAGES) {
      digest.push(
        text.length > DIGEST_MAX_CHARS ? `${text.slice(0, DIGEST_MAX_CHARS)}…` : text,
      );
    }
  }
  return { digest, messageCount };
}

async function main() {
  const root = projectRoot();
  const sessionsDir = join(root, ".pneuma", "sessions");

  let dirents: string[];
  try {
    dirents = await readdir(sessionsDir);
  } catch {
    console.log(JSON.stringify({ projectRoot: root, total: 0, needsTidy: 0, sessions: [] }));
    return;
  }

  const rows: Array<Record<string, unknown>> = [];

  for (const id of dirents) {
    const dir = join(sessionsDir, id);
    let isDir = false;
    try {
      isDir = (await stat(dir)).isDirectory();
    } catch {
      isDir = false;
    }
    if (!isDir) continue;

    const sessionJsonPath = join(dir, "session.json");
    let meta: SessionJson;
    try {
      meta = JSON.parse(await readFile(sessionJsonPath, "utf-8")) as SessionJson;
    } catch {
      continue; // not a real session dir
    }

    const sessionId = meta.sessionId ?? id;
    const sessionName = meta.sessionName?.trim() || null;
    const displayName = meta.displayName?.trim() || null;
    const description = meta.description?.trim() || null;

    let needsTidy = true;
    let skipReason: string | null = null;
    if (sessionName) {
      needsTidy = false;
      skipReason = "用户已手动命名";
    } else if (displayName) {
      needsTidy = false;
      skipReason = "已整理过";
    }

    const { digest, messageCount } = await readHistoryDigest(join(dir, "history.json"));

    // lastAccessed — history.json mtime is the best signal, else session.json.
    let lastAccessed = meta.createdAt ?? 0;
    try {
      lastAccessed = Math.max(lastAccessed, (await stat(join(dir, "history.json"))).mtimeMs);
    } catch {
      try {
        lastAccessed = Math.max(lastAccessed, (await stat(sessionJsonPath)).mtimeMs);
      } catch {
        /* keep createdAt */
      }
    }

    rows.push({
      sessionId,
      mode: meta.mode ?? "unknown",
      displayName,
      description,
      sessionName,
      needsTidy,
      skipReason,
      messageCount,
      lastAccessed: Math.round(lastAccessed),
      digest,
    });
  }

  rows.sort((a, b) => (b.lastAccessed as number) - (a.lastAccessed as number));

  console.log(
    JSON.stringify(
      {
        projectRoot: root,
        total: rows.length,
        needsTidy: rows.filter((r) => r.needsTidy).length,
        sessions: rows,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

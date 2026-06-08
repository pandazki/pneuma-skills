import { t } from "./i18n.js";

/**
 * `pneuma session refine` CLI — pushes a refined session title + description
 * to the running Pneuma server, which rewrites the active session's
 * `session.json` (and the global registry entry), then broadcasts
 * `session_meta_updated` so the launcher and ProjectPanel rows refresh
 * without a reload.
 *
 * The agent is told (via the `pneuma-session` global skill) to call this
 * when the conversation has produced enough substance for a meaningful
 * title / one-line summary — either inline when the user asks ("整理一下
 * 会话信息"), or from a Task subagent on the agent's own initiative so the
 * main turn isn't blocked.
 *
 * Modeled directly on `pneuma handoff` — same JSON-on-stdin-or-flag shape,
 * same env contract, same exit codes. Single-shot, no retry loop.
 *
 * Env vars:
 *   PNEUMA_SERVER_URL — required. Server sets this on agent spawn.
 *   PNEUMA_SESSION_ID — required. The active session id (auto-injected).
 */

export interface SessionRefineInput {
  /**
   * The refined human-readable title — what the session is about, not what
   * the agent did. ≤40 characters after trim. Replaces the mode-based
   * default ("WebCraft session") wherever the registry surfaces the name,
   * but an explicit `sessionName` (manual rename) still wins.
   */
  displayName?: string;
  /**
   * The refined one-line summary — 1-2 sentences. ≤280 characters. Replaces
   * the history-derived preview in the session-row UI.
   */
  description?: string;
}

export interface SessionCliEnv {
  PNEUMA_SERVER_URL?: string;
  PNEUMA_SESSION_ID?: string;
}

export interface SessionCliIo {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  readStdin: () => Promise<string>;
  fetch: (
    url: string,
    init: { method: "POST"; headers: Record<string, string>; body: string },
  ) => Promise<{ status: number; json: () => Promise<unknown>; text: () => Promise<string> }>;
}

const HELP_TEXT = (): string => t("session.refine.usage");

const DISPLAY_NAME_MAX = 40;
const DESCRIPTION_MAX = 280;

/**
 * Parse the `pneuma session refine` arg subset (the `session refine` tokens
 * already shifted off). Same recognised flags as `pneuma handoff`:
 *   --json '<json>'    — payload inline
 *   --stdin            — read payload from stdin
 *   --help, -h         — show usage
 */
export function parseSessionRefineArgs(args: string[]): {
  json?: string;
  stdin?: boolean;
  help?: boolean;
  targetSession?: string;
} {
  const out: { json?: string; stdin?: boolean; help?: boolean; targetSession?: string } = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json" && i + 1 < args.length) {
      out.json = args[++i];
    } else if (arg === "--stdin") {
      out.stdin = true;
    } else if ((arg === "--target-session" || arg === "--target") && i + 1 < args.length) {
      out.targetSession = args[++i];
    } else if (arg === "--help" || arg === "-h") {
      out.help = true;
    }
  }
  return out;
}

/**
 * Coerce + validate a parsed JSON payload into the typed input. Throws
 * Error with a human-readable message on the first violation. Both fields
 * are optional, but at least one must be present and non-empty — a no-op
 * refine is almost always a programming bug.
 *
 * Length caps mirror what the UI can render without clipping; the agent is
 * told about them in the skill prompt so it picks the right shape.
 */
export function validateSessionRefinePayload(raw: unknown): SessionRefineInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("payload must be a JSON object");
  }
  const obj = raw as Record<string, unknown>;

  const coerceString = (key: string, maxLen: number): string | undefined => {
    const value = obj[key];
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string") {
      throw new Error(`field "${key}" must be a string`);
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) return undefined;
    if (trimmed.length > maxLen) {
      throw new Error(`field "${key}" must be ≤${maxLen} characters (got ${trimmed.length})`);
    }
    return trimmed;
  };

  const displayName = coerceString("displayName", DISPLAY_NAME_MAX);
  const description = coerceString("description", DESCRIPTION_MAX);

  if (displayName === undefined && description === undefined) {
    throw new Error('payload must include at least one of "displayName" or "description"');
  }

  return {
    ...(displayName !== undefined ? { displayName } : {}),
    ...(description !== undefined ? { description } : {}),
  };
}

/**
 * Pure handler — testable without spawning a real CLI. Accepts the parsed
 * argv tail (post `session refine`), env, and an IO surface. Returns the
 * exit code.
 */
export async function runSessionRefineCommand(
  args: string[],
  env: SessionCliEnv,
  io: SessionCliIo,
): Promise<number> {
  const parsed = parseSessionRefineArgs(args);

  if (parsed.help) {
    io.stdout(HELP_TEXT());
    return 0;
  }

  if (!parsed.json && !parsed.stdin) {
    io.stderr(t("session.refine.missing_args"));
    io.stderr(HELP_TEXT());
    return 2;
  }

  const sessionId = env.PNEUMA_SESSION_ID;
  if (!sessionId) {
    io.stderr(t("session.refine.missing_session_id"));
    return 2;
  }

  const serverUrl = env.PNEUMA_SERVER_URL;
  if (!serverUrl) {
    io.stderr(t("session.refine.missing_server_url"));
    return 2;
  }

  let rawJson = parsed.json;
  if (!rawJson && parsed.stdin) {
    rawJson = await io.readStdin();
  }
  if (!rawJson || rawJson.trim().length === 0) {
    io.stderr(t("session.refine.empty_payload"));
    return 2;
  }

  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(rawJson);
  } catch (err) {
    io.stderr(t("session.refine.invalid_json", { message: err instanceof Error ? err.message : String(err) }));
    return 2;
  }

  let body: SessionRefineInput;
  try {
    body = validateSessionRefinePayload(parsedPayload);
  } catch (err) {
    io.stderr(t("session.refine.validation_error", { message: err instanceof Error ? err.message : String(err) }));
    return 2;
  }

  // A `--target-session <id>` refines a sibling session under the same
  // project (used by `project-tidy`); without it the server refines its own.
  const targetSession = parsed.targetSession?.trim();
  const requestBody: Record<string, unknown> = { ...body };
  if (targetSession) requestBody.targetSessionId = targetSession;

  const url = `${serverUrl.replace(/\/$/, "")}/api/session/refine`;
  let response: { status: number; json: () => Promise<unknown>; text: () => Promise<string> };
  try {
    response = await io.fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody),
    });
  } catch (err) {
    io.stderr(t("session.refine.fetch_failed", { url, message: err instanceof Error ? err.message : String(err) }));
    return 1;
  }

  if (response.status >= 200 && response.status < 300) {
    const titleSuffix = body.displayName ? t("session.refine.success_title", { title: body.displayName }) : "";
    const descSuffix = body.description ? t("session.refine.success_desc", { description: body.description }) : "";
    io.stdout(t("session.refine.success", { titleSuffix, descSuffix }));
    return 0;
  }

  let serverError = `server returned ${response.status}`;
  try {
    const data = (await response.json()) as { error?: string };
    if (data && typeof data.error === "string") serverError = data.error;
  } catch {
    try {
      const text = await response.text();
      if (text) serverError = text;
    } catch {
      // Fall back to the status-code-only message.
    }
  }
  io.stderr(t("session.refine.server_error", { message: serverError }));
  return 1;
}

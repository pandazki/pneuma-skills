/**
 * `pneuma handoff` CLI — emits a structured handoff payload to the running
 * Pneuma server, which broadcasts a `handoff_proposed` event to the source
 * session's browser. The agent calls this command (via its Bash tool) after
 * receiving a `<pneuma:request-handoff>` chat tag.
 *
 * Reads JSON from `--json '<inline>'` or stdin, validates required fields,
 * then POSTs to `${PNEUMA_SERVER_URL}/api/handoffs/emit`. Single-shot — no
 * retry loop. Failures land in stderr and produce a non-zero exit code so
 * the agent can see the error in its tool result and decide how to recover.
 *
 * Env vars:
 *   PNEUMA_SERVER_URL — required. Server sets this on agent spawn.
 *   PNEUMA_SESSION_ID — required. The source session id (already injected).
 */

export interface HandoffJsonPayload {
  target_mode?: unknown;
  target_session?: unknown;
  intent?: unknown;
  summary?: unknown;
  suggested_files?: unknown;
  key_decisions?: unknown;
  open_questions?: unknown;
  // Allow extras — server validates & strips. We don't reject here.
  [key: string]: unknown;
}

export interface HandoffEmitInput {
  source_session_id: string;
  target_mode: string;
  target_session?: string;
  intent: string;
  summary?: string;
  suggested_files?: string[];
  key_decisions?: string[];
  open_questions?: string[];
}

export interface HandoffCliEnv {
  PNEUMA_SERVER_URL?: string;
  PNEUMA_SESSION_ID?: string;
}

export interface HandoffCliIo {
  /** Logger for stdout output (the success/info channel). */
  stdout: (line: string) => void;
  /** Logger for stderr output (the error channel). */
  stderr: (line: string) => void;
  /** Read stdin to a string. */
  readStdin: () => Promise<string>;
  /** POST a JSON body and return status + parsed JSON (or text on failure). */
  fetch: (
    url: string,
    init: { method: "POST"; headers: Record<string, string>; body: string },
  ) => Promise<{ status: number; json: () => Promise<unknown>; text: () => Promise<string> }>;
}

/**
 * Parse the `pneuma handoff` arg subset (the `handoff` token already shifted
 * off). Recognised flags:
 *   --json '<json>'    — payload inline
 *   --stdin            — read payload from stdin
 *   --help, -h         — show usage
 *
 * Multiple `--json` invocations only keep the last (consistent with most CLI
 * arg-parsers); same for `--stdin`.
 */
export function parseHandoffArgs(args: string[]): {
  json?: string;
  stdin?: boolean;
  help?: boolean;
} {
  const out: { json?: string; stdin?: boolean; help?: boolean } = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json" && i + 1 < args.length) {
      out.json = args[++i];
    } else if (arg === "--stdin") {
      out.stdin = true;
    } else if (arg === "--help" || arg === "-h") {
      out.help = true;
    }
  }
  return out;
}

const HELP_TEXT = `Usage: pneuma handoff --json '<json>' | --stdin

Emit a structured handoff to the active Pneuma session. The server shows the
user a HandoffCard; if confirmed, the target session is spawned with the
payload pre-loaded. Reads JSON with these fields:

  target_mode       string   required  Mode name (e.g. "webcraft")
  target_session    string   optional  Existing session id, "auto", or omit
  intent            string   required  One sentence — what the target does
  summary           string   optional  Few sentences on what's done here
  suggested_files   string[] optional  Project-relative paths, ordered
  key_decisions     string[] optional  Locked-in decisions for the target
  open_questions    string[] optional  Things the target should resolve

Env vars:
  PNEUMA_SERVER_URL   POSTed against
  PNEUMA_SESSION_ID   source session id (auto-injected)
`;

/**
 * Coerce + validate a parsed JSON payload into the typed input. Throws Error
 * with a human-readable message on the first violation; the caller surfaces
 * to stderr.
 *
 * Required fields:
 *   - target_mode (non-empty string)
 *   - intent (non-empty string)
 *
 * Optional string-array fields are only accepted if every entry is a string;
 * silent coercion would let bad agent calls slip through.
 */
export function validateHandoffPayload(
  raw: unknown,
  sourceSessionId: string,
): HandoffEmitInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("payload must be a JSON object");
  }
  const obj = raw as Record<string, unknown>;
  const requireString = (key: string): string => {
    const value = obj[key];
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`field "${key}" is required and must be a non-empty string`);
    }
    return value;
  };
  const optionalString = (key: string): string | undefined => {
    const value = obj[key];
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string") {
      throw new Error(`field "${key}" must be a string`);
    }
    return value;
  };
  const optionalStringArray = (key: string): string[] | undefined => {
    const value = obj[key];
    if (value === undefined || value === null) return undefined;
    if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
      throw new Error(`field "${key}" must be an array of strings`);
    }
    return value as string[];
  };

  const target_mode = requireString("target_mode");
  const intent = requireString("intent");
  const target_session = optionalString("target_session");
  const summary = optionalString("summary");
  const suggested_files = optionalStringArray("suggested_files");
  const key_decisions = optionalStringArray("key_decisions");
  const open_questions = optionalStringArray("open_questions");

  return {
    source_session_id: sourceSessionId,
    target_mode,
    intent,
    ...(target_session !== undefined ? { target_session } : {}),
    ...(summary !== undefined ? { summary } : {}),
    ...(suggested_files !== undefined ? { suggested_files } : {}),
    ...(key_decisions !== undefined ? { key_decisions } : {}),
    ...(open_questions !== undefined ? { open_questions } : {}),
  };
}

/**
 * Pure handler — testable without spawning a real CLI. Accepts the parsed
 * argv tail (post `handoff`), env, and an IO surface. Returns the exit code.
 */
export async function runHandoffCommand(
  args: string[],
  env: HandoffCliEnv,
  io: HandoffCliIo,
): Promise<number> {
  const parsed = parseHandoffArgs(args);

  if (parsed.help) {
    io.stdout(HELP_TEXT);
    return 0;
  }

  if (!parsed.json && !parsed.stdin) {
    io.stderr("error: pass --json '<json>' or --stdin");
    io.stderr(HELP_TEXT);
    return 2;
  }

  const sourceSessionId = env.PNEUMA_SESSION_ID;
  if (!sourceSessionId) {
    io.stderr("error: PNEUMA_SESSION_ID env var not set (must run inside a session)");
    return 2;
  }

  const serverUrl = env.PNEUMA_SERVER_URL;
  if (!serverUrl) {
    io.stderr("error: PNEUMA_SERVER_URL env var not set (must run inside a session)");
    return 2;
  }

  let rawJson = parsed.json;
  if (!rawJson && parsed.stdin) {
    rawJson = await io.readStdin();
  }
  if (!rawJson || rawJson.trim().length === 0) {
    io.stderr("error: empty JSON payload");
    return 2;
  }

  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(rawJson);
  } catch (err) {
    io.stderr(`error: invalid JSON — ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }

  let body: HandoffEmitInput;
  try {
    body = validateHandoffPayload(parsedPayload, sourceSessionId);
  } catch (err) {
    io.stderr(`error: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }

  const url = `${serverUrl.replace(/\/$/, "")}/api/handoffs/emit`;
  let response: { status: number; json: () => Promise<unknown>; text: () => Promise<string> };
  try {
    response = await io.fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    io.stderr(`error: failed to reach Pneuma server at ${url}: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  if (response.status >= 200 && response.status < 300) {
    let parsedBody: { handoff_id?: string; status?: string } = {};
    try {
      parsedBody = (await response.json()) as { handoff_id?: string; status?: string };
    } catch {
      // Server should return JSON, but a non-JSON 2xx still counts as success.
    }
    io.stdout(
      `Handoff submitted; awaiting user confirmation.${parsedBody.handoff_id ? ` (id ${parsedBody.handoff_id})` : ""}`,
    );
    return 0;
  }

  // Surface the server's error message verbatim if it returned JSON.
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
  io.stderr(`error: ${serverError}`);
  return 1;
}

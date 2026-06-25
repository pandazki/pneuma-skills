/**
 * `pneuma borrow` CLI — the dispatch leg of a borrow (peer / round-trip
 * cross-mode handoff). Run by the LIVE host session A's agent (via its Bash
 * tool) when it wants to borrow another mode B's capability for one bounded
 * job. Unlike a handoff (a goto — A is killed, B takes over), a borrow is a
 * subroutine call: A stays alive and foreground, B does the job in a
 * background sub-session and returns its result, control returns to A.
 *
 * This verb constructs and validates a {@link BorrowDispatchPayload}, then
 * POSTs it to A's OWN per-session server at `POST $PNEUMA_SERVER_URL/api/borrows/dispatch`.
 * That server (a sibling task — code to the contract, it is not built here)
 * mints the borrow id, stages `<Bdir>/.pneuma/borrow-brief.json`, records the
 * link, and spawns B in the background. The CLI prints the server's reply
 * verbatim as JSON so A's agent can `JSON.parse` it and learn the `borrow_id`.
 *
 * Machine-readable: dispatched in `bin/pneuma.ts::main()` BEFORE `p.intro()`
 * so the clack banner never lands on stdout and breaks the agent's parse
 * (server.md gotcha: "Machine-readable CLI subcommands bypass `p.intro()`").
 * Single-shot — no retry loop. Failures go to stderr with a non-zero exit so
 * the agent sees the error in its tool result and can recover.
 *
 * Env vars (set by the server when it spawned A's agent):
 *   PNEUMA_SERVER_URL — required. A's own per-session server origin.
 *   PNEUMA_SESSION_ID — A's session id (informational here; the server
 *                       identifies the host session from the connection).
 *
 * Pure handler + IO surface mirror `bin/handoff-cli.ts` so tests exercise the
 * dispatch logic without a live server.
 */

import type {
  BorrowDispatchPayload,
  BorrowScope,
} from "../core/types/borrow.js";

// ── Public types ──────────────────────────────────────────────────────────────

export interface BorrowCliEnv {
  PNEUMA_SERVER_URL?: string;
  PNEUMA_SESSION_ID?: string;
}

export interface BorrowCliIo {
  /** Logger for stdout (the machine-readable success/result channel). */
  stdout: (line: string) => void;
  /** Logger for stderr (the error channel). */
  stderr: (line: string) => void;
  /** Read stdin to a string. */
  readStdin: () => Promise<string>;
  /** POST a JSON body; return status + parsed JSON (or text on failure). */
  fetch: (
    url: string,
    init: { method: "POST"; headers: Record<string, string>; body: string },
  ) => Promise<{ status: number; json: () => Promise<unknown>; text: () => Promise<string> }>;
}

export interface ParsedBorrowArgs {
  /** Target sub-mode B, from `--mode <B>` (authoritative over any payload `mode`). */
  mode?: string;
  /** The borrow brief + options as inline JSON, from `--json '<json>'`. */
  json?: string;
  /** Read the JSON payload from stdin instead. */
  stdin?: boolean;
  help?: boolean;
}

const HELP_TEXT = `pneuma borrow — borrow another mode's capability for one bounded job

Run from a LIVE host session's agent. Dispatches a background sub-session in
mode <B> that does the bounded job, writes a result, and signals completion;
control returns to you. Prints the server's reply as JSON (parse it for the
borrow_id).

Usage:
  pneuma borrow --mode <B> --json '{"brief":"...", ...}'
  pneuma borrow --mode <B> --stdin   # read the JSON payload from stdin

JSON payload fields (BorrowDispatchPayload — see core/types/borrow.ts):
  brief             REQUIRED. The bounded job, stated for B's first turn.
  inputs            string[]. Host files/dirs B should read (absolute paths).
  expects           What B must produce, in B's terms.
  scope             "return" (default) | "in-place".
  in_place_targets  string[]. Host files B may edit — only when scope is "in-place".
  summary           Optional context for B.
  language          BCP47-ish source-conversation language (e.g. zh-CN).

Options:
  --mode <B>   Target sub-mode (authoritative; overrides any payload "mode").
  --json <s>   Inline JSON payload.
  --stdin      Read the JSON payload from stdin.
  --help, -h   Show this help.

Env:
  PNEUMA_SERVER_URL  required — your own session server.
  PNEUMA_SESSION_ID  your session id.
`;

// ── Arg parsing ─────────────────────────────────────────────────────────────

/**
 * Parse the `pneuma borrow` arg tail (the `borrow` token already shifted off).
 * Last value wins for repeated `--mode` / `--json` (standard CLI behavior).
 */
export function parseBorrowArgs(args: string[]): ParsedBorrowArgs {
  const out: ParsedBorrowArgs = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--mode" && i + 1 < args.length) {
      out.mode = args[++i];
    } else if (arg === "--json" && i + 1 < args.length) {
      out.json = args[++i];
    } else if (arg === "--stdin") {
      out.stdin = true;
    } else if (arg === "--help" || arg === "-h") {
      out.help = true;
    }
  }
  return out;
}

// ── Validation ────────────────────────────────────────────────────────────────

const BORROW_SCOPES: ReadonlySet<string> = new Set<BorrowScope>(["return", "in-place"]);

/**
 * Coerce + validate a parsed JSON payload (plus the authoritative `--mode`
 * flag) into a typed {@link BorrowDispatchPayload}. Throws Error with a
 * human-readable message on the first violation; the caller surfaces it to
 * stderr.
 *
 * The `--mode` flag is authoritative: it is the borrow's target mode, so it
 * overrides any `mode` the agent happened to also put in the JSON body. This
 * keeps the surface unambiguous (`--mode wordtaste` always wins) and matches
 * how the verb reads at the call site (`pneuma borrow --mode B ...`).
 *
 * Required: `brief` (non-empty string). Optional fields are accepted only when
 * well-typed — silent coercion would let a malformed agent call slip through
 * to the server. The deeper invariants (`in_place_targets` ignored unless
 * `scope === "in-place"`, traversal containment) are the dispatch route's job
 * per the contract; this CLI validates shape, not policy.
 */
export function validateBorrowDispatch(
  raw: unknown,
  modeFlag: string | undefined,
): BorrowDispatchPayload {
  const mode = (modeFlag ?? "").trim();
  if (mode.length === 0) {
    throw new Error('missing --mode <B>: the target sub-mode is required');
  }
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

  const brief = requireString("brief");
  const inputs = optionalStringArray("inputs");
  const expects = optionalString("expects");
  const summary = optionalString("summary");
  const language = optionalString("language");
  const in_place_targets = optionalStringArray("in_place_targets");

  let scope: BorrowScope | undefined;
  if (obj.scope !== undefined && obj.scope !== null) {
    if (typeof obj.scope !== "string" || !BORROW_SCOPES.has(obj.scope)) {
      throw new Error('field "scope" must be "return" or "in-place"');
    }
    scope = obj.scope as BorrowScope;
  }

  return {
    mode,
    brief,
    ...(inputs !== undefined ? { inputs } : {}),
    ...(expects !== undefined ? { expects } : {}),
    ...(scope !== undefined ? { scope } : {}),
    ...(in_place_targets !== undefined ? { in_place_targets } : {}),
    ...(summary !== undefined ? { summary } : {}),
    ...(language !== undefined ? { language } : {}),
  };
}

// ── Main entrypoint ─────────────────────────────────────────────────────────

/**
 * Pure handler — testable without spawning a real CLI. Accepts the parsed
 * argv tail (post `borrow`), env, and an IO surface. Returns the exit code.
 *
 * Exit codes mirror the sibling verbs: 0 success, 2 caller error (bad
 * args/env/payload — the agent should fix and retry), 1 transport/server
 * error (the borrow could not be dispatched).
 */
export async function runBorrowCommand(
  args: string[],
  env: BorrowCliEnv,
  io: BorrowCliIo,
): Promise<number> {
  const parsed = parseBorrowArgs(args);

  if (parsed.help) {
    io.stdout(HELP_TEXT);
    return 0;
  }

  const serverUrl = env.PNEUMA_SERVER_URL;
  if (!serverUrl) {
    io.stderr("PNEUMA_SERVER_URL is not set — run this inside a Pneuma session's agent.");
    return 2;
  }

  if (!parsed.mode || parsed.mode.trim().length === 0) {
    io.stderr("Missing --mode <B>. See `pneuma borrow --help`.");
    return 2;
  }

  if (!parsed.json && !parsed.stdin) {
    io.stderr("Missing --json '<payload>' or --stdin. See `pneuma borrow --help`.");
    return 2;
  }

  let rawJson = parsed.json;
  if (!rawJson && parsed.stdin) {
    rawJson = await io.readStdin();
  }
  if (!rawJson || rawJson.trim().length === 0) {
    io.stderr("Empty borrow payload.");
    return 2;
  }

  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(rawJson);
  } catch (err) {
    io.stderr(`Invalid JSON payload: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }

  let body: BorrowDispatchPayload;
  try {
    body = validateBorrowDispatch(parsedPayload, parsed.mode);
  } catch (err) {
    io.stderr(`Invalid borrow payload: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }

  const url = `${serverUrl.replace(/\/$/, "")}/api/borrows/dispatch`;
  let response: { status: number; json: () => Promise<unknown>; text: () => Promise<string> };
  try {
    response = await io.fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    io.stderr(`Failed to reach ${url}: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  if (response.status >= 200 && response.status < 300) {
    // Echo the server's reply verbatim as JSON — A's agent JSON.parses this
    // to learn the borrow_id / state. Fall back to a minimal envelope if the
    // server returned a non-JSON 2xx (still a success).
    let reply: unknown = {};
    try {
      reply = await response.json();
    } catch {
      reply = { ok: true };
    }
    io.stdout(JSON.stringify(reply));
    return 0;
  }

  // Surface the server's error verbatim if it returned JSON `{ error }`.
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
  io.stderr(`Borrow dispatch failed: ${serverError}`);
  return 1;
}

/**
 * `pneuma borrow-return` CLI — the return leg of a borrow. Run by the
 * BORROWED mode B's agent (via its Bash tool) the moment it finishes the
 * bounded job dispatched by `pneuma borrow`. It does two things, in order:
 *
 *   1. Writes a valid {@link BorrowResult} to `<Bdir>/borrow-result.json`
 *      (atomic tmp+rename), where `<Bdir>` is B's session dir (`PNEUMA_SESSION_DIR`).
 *      B is the sole writer of everything under `<Bdir>`. This file is the
 *      durable record — it survives A's server being down, a B crash after the
 *      write, replay, and resume (disk is the source of truth per ADR-015 / the
 *      controlled-state-surface invariant).
 *   2. POSTs an EXPLICIT completion signal to A's OWN per-session server at
 *      `return_via.host_server_url + /api/borrows/return` so A is poked live.
 *      The explicit signal is the v1-handoff post-mortem lesson made concrete:
 *      never let A infer "B is done" from a file appearing on disk. B declares done.
 *
 * The write happens first and is the success criterion for the deliverable;
 * the POST is a best-effort live poke. If A's server is gone (A's window
 * closed), the POST fails but the result file still lets A reconcile the
 * borrow on its next resume — so a failed poke is surfaced (exit 1) but never
 * costs the result.
 *
 * Machine-readable: dispatched in `bin/pneuma.ts::main()` BEFORE `p.intro()`
 * (server.md gotcha) so the clack banner never pollutes stdout.
 *
 * Env vars (set by the server when it spawned B's agent):
 *   PNEUMA_SESSION_DIR — required. B's session dir == `<Bdir>`; the result
 *                        file is written here.
 *
 * The host server's coordinates (`return_via.host_server_url` + the borrow id)
 * travel in the JSON payload — B learned them from the borrow brief the skill
 * installer surfaced. Pure handler + IO surface mirror `bin/handoff-cli.ts`.
 */

import { mkdirSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";

import { isBorrowResult, type BorrowResult, type BorrowReturnVia } from "../core/types/borrow.js";

// ── Public types ──────────────────────────────────────────────────────────────

export interface BorrowReturnCliEnv {
  /** B's session dir (`<Bdir>`) — where `borrow-result.json` is written. */
  PNEUMA_SESSION_DIR?: string;
}

export interface BorrowReturnCliIo {
  /** Logger for stdout (the machine-readable success channel). */
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

export interface ParsedBorrowReturnArgs {
  json?: string;
  stdin?: boolean;
  help?: boolean;
}

const HELP_TEXT = `pneuma borrow-return — finish a borrow and return its result to the host

Run from the BORROWED mode's agent when the bounded job is done. Writes the
result to <Bdir>/borrow-result.json and pokes the host session's server so it
picks the result up. Find the borrow_id + host server url in the borrow brief
the skill surfaced on your first turn.

Usage:
  pneuma borrow-return --json '{...}'
  pneuma borrow-return --stdin    # read the JSON payload from stdin

JSON payload = a BorrowResult (see core/types/borrow.ts) PLUS return_via:
  borrow_id      REQUIRED. The borrow this result fulfills.
  mode           REQUIRED. The mode you ran.
  status         REQUIRED. "completed" | "failed" | "partial".
  produced       REQUIRED array. Each entry { path, kind?, role? }. May be []
                 when status is "failed".
  change_notes   REQUIRED. WHAT changed and WHY, in your voice (the host reasons
                 about the change from this without diffing files).
  applied_in_place  string[]. Host files you edited — only for scope "in-place".
  open_questions    string[]. Anything you could not resolve.
  produced_at    number (ms). Optional — stamped for you when omitted.
  return_via     REQUIRED. { borrow_id, host_server_url } from the brief.

Options:
  --json <s>   Inline JSON payload.
  --stdin      Read the JSON payload from stdin.
  --help, -h   Show this help.

Env:
  PNEUMA_SESSION_DIR  required — your own session dir (where the result is written).
`;

// ── Arg parsing ─────────────────────────────────────────────────────────────

/**
 * Parse the `pneuma borrow-return` arg tail (the `borrow-return` token already
 * shifted off). Last value wins for repeated `--json`.
 */
export function parseBorrowReturnArgs(args: string[]): ParsedBorrowReturnArgs {
  const out: ParsedBorrowReturnArgs = {};
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

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * Split + validate the return payload into the on-disk {@link BorrowResult}
 * and the {@link BorrowReturnVia} relay coordinates.
 *
 * The agent passes both in one JSON object (the result fields it produced plus
 * the `return_via` it copied from the brief). This function:
 *   - lifts `return_via` out so it never bleeds into the on-disk BorrowResult
 *     (B is the sole writer of `borrow-result.json`, which is pure result);
 *   - stamps `produced_at` with `Date.now()` when the agent omits it (so the
 *     agent doesn't have to compute a ms epoch);
 *   - validates the remaining object with the contract guard `isBorrowResult`,
 *     and the relay coordinates by shape.
 *
 * Throws Error on the first violation; the caller surfaces it to stderr.
 */
export function validateBorrowReturn(raw: unknown): {
  result: BorrowResult;
  returnVia: BorrowReturnVia;
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("payload must be a JSON object");
  }
  const obj = raw as Record<string, unknown>;

  // Lift return_via out — it is relay metadata, not part of the result file.
  const relay = obj.return_via;
  if (!relay || typeof relay !== "object" || Array.isArray(relay)) {
    throw new Error('field "return_via" is required (from the borrow brief: { borrow_id, host_server_url })');
  }
  const relayObj = relay as Record<string, unknown>;
  if (typeof relayObj.host_server_url !== "string" || relayObj.host_server_url.trim().length === 0) {
    throw new Error('field "return_via.host_server_url" is required and must be a non-empty string');
  }
  if (typeof relayObj.borrow_id !== "string" || relayObj.borrow_id.trim().length === 0) {
    throw new Error('field "return_via.borrow_id" is required and must be a non-empty string');
  }
  const returnVia: BorrowReturnVia = {
    borrow_id: relayObj.borrow_id,
    host_server_url: relayObj.host_server_url,
  };

  // Build the candidate result without return_via, stamping produced_at.
  const { return_via: _omit, ...resultFields } = obj;
  const candidate: Record<string, unknown> = {
    ...resultFields,
    produced_at: typeof resultFields.produced_at === "number" ? resultFields.produced_at : Date.now(),
  };

  if (!isBorrowResult(candidate)) {
    throw new Error(
      "payload is not a valid BorrowResult — require: borrow_id, mode, status (completed|failed|partial), produced[] (each with a string path), change_notes",
    );
  }

  return { result: candidate, returnVia };
}

// ── Atomic write ──────────────────────────────────────────────────────────────

function atomicWriteJson(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), "utf-8");
  renameSync(tmp, path);
}

// ── Main entrypoint ─────────────────────────────────────────────────────────

/**
 * Pure handler — testable without spawning a real CLI. Returns the exit code.
 *
 * Exit codes:
 *   0  result written AND host poked successfully.
 *   2  caller error (bad args/env/payload) — nothing written, agent should fix.
 *   1  result WAS written, but the live poke to A failed (transport or non-2xx).
 *      A still recovers from the on-disk result on its next resume.
 */
export async function runBorrowReturnCommand(
  args: string[],
  env: BorrowReturnCliEnv,
  io: BorrowReturnCliIo,
): Promise<number> {
  const parsed = parseBorrowReturnArgs(args);

  if (parsed.help) {
    io.stdout(HELP_TEXT);
    return 0;
  }

  const sessionDir = env.PNEUMA_SESSION_DIR;
  if (!sessionDir) {
    io.stderr("PNEUMA_SESSION_DIR is not set — run this inside a Pneuma session's agent.");
    return 2;
  }

  if (!parsed.json && !parsed.stdin) {
    io.stderr("Missing --json '<payload>' or --stdin. See `pneuma borrow-return --help`.");
    return 2;
  }

  let rawJson = parsed.json;
  if (!rawJson && parsed.stdin) {
    rawJson = await io.readStdin();
  }
  if (!rawJson || rawJson.trim().length === 0) {
    io.stderr("Empty borrow-return payload.");
    return 2;
  }

  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(rawJson);
  } catch (err) {
    io.stderr(`Invalid JSON payload: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }

  let result: BorrowResult;
  let returnVia: BorrowReturnVia;
  try {
    const validated = validateBorrowReturn(parsedPayload);
    result = validated.result;
    returnVia = validated.returnVia;
  } catch (err) {
    io.stderr(`Invalid borrow-return payload: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }

  // 1. Write the durable result file first — it is the success criterion for
  //    the deliverable and the record A reconciles from if the live poke fails.
  const resultPath = join(sessionDir, "borrow-result.json");
  try {
    atomicWriteJson(resultPath, result);
  } catch (err) {
    io.stderr(`Failed to write ${resultPath}: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  // 2. Poke A's own server with an explicit completion signal. The result_path
  //    lets A read the deliverable without re-deriving the location.
  const url = `${returnVia.host_server_url.replace(/\/$/, "")}/api/borrows/return`;
  const signal = {
    borrow_id: returnVia.borrow_id,
    mode: result.mode,
    status: result.status,
    result_path: resultPath,
  };

  let response: { status: number; json: () => Promise<unknown>; text: () => Promise<string> };
  try {
    response = await io.fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(signal),
    });
  } catch (err) {
    io.stderr(
      `Result written to ${resultPath}, but failed to reach the host server at ${url}: ${
        err instanceof Error ? err.message : String(err)
      }. The host will reconcile the result on its next resume.`,
    );
    return 1;
  }

  if (response.status >= 200 && response.status < 300) {
    io.stdout(JSON.stringify({ ok: true, borrow_id: returnVia.borrow_id, result_path: resultPath }));
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
  io.stderr(`Result written to ${resultPath}, but the host server rejected the completion signal: ${serverError}`);
  return 1;
}

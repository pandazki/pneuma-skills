#!/usr/bin/env bun
/**
 * cross_family_probe.ts — detect which model-family routes are actually
 * USABLE and write the result to .pneuma/cross-family.json. The wordtaste
 * viewer reads this memory source to render the family-availability banner;
 * the agent reads it to plan how it generates.
 *
 * Run this on the agent's first turn (SKILL.md step 0). It probes the CLIs
 * the orchestrator can shell out to (`claude`, `codex`) and the one route
 * that is not a CLI at all: the hosted writer route, exercised with a single
 * one-token call against the same key and the same model `run_leaf.ts` would
 * use.
 *
 * Liveness, not PATH-presence: a CLI on PATH but unauthenticated may fall
 * into an interactive flow that hangs forever, so each probe runs a trivial
 * non-interactive invocation under a HARD timeout. The probe MUST NOT hang
 * under any circumstance and always exits 0 writing valid JSON — an unusable
 * family is a normal degraded state, not an error the agent should abort on.
 *
 * Output target resolution (first writable wins):
 *   1. $PNEUMA_SESSION_DIR/.pneuma/cross-family.json  (session dir, preferred)
 *   2. ./.pneuma/cross-family.json                    (cwd fallback)
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadOpenRouterKey, writerModel } from "./lib/session.ts";

// Per-family liveness timeout (seconds). A clean CLI answers well within
// this; an unauthenticated/hanging one is killed at the boundary and reported
// false. The families are probed in PARALLEL, so the whole probe finishes in
// roughly this bound, not the sum.
const PROBE_TIMEOUT = Number(process.env.WORDTASTE_PROBE_TIMEOUT || "12");

/**
 * Run one probe command with a hard timeout: TERM at the deadline, KILL 300ms
 * later, and the group reaped either way. Output is discarded — only success
 * within the deadline matters.
 */
function runWithTimeout(command: string, args: string[], seconds: number): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: ["ignore", "ignore", "ignore"],
      env: process.env,
    });
    let settled = false;
    const finish = (status: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve(status);
    };
    const deadline = setTimeout(() => {
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          // Already gone.
        }
        setTimeout(() => {
          if (child.pid !== undefined) {
            try {
              process.kill(-child.pid, "SIGKILL");
            } catch {
              // Already gone.
            }
          }
        }, 300);
      }
      finish(124); // conventional timeout exit code
    }, seconds * 1000);
    child.on("error", () => finish(127));
    child.on("close", (code) => finish(code ?? 1));
  });
}

/**
 * Probe one family: false when not on PATH; otherwise its cheapest
 * non-interactive auth-exercising call under the hard timeout.
 *   codex  — `login status` reports auth state directly (no model spend).
 *   claude — a minimal `-p` print call (a real, in-family generation hop).
 */
async function probeFamily(name: string): Promise<boolean> {
  if (Bun.which(name) === null) return false;
  let status: number;
  switch (name) {
    case "codex":
      status = await runWithTimeout("codex", ["login", "status"], PROBE_TIMEOUT);
      break;
    case "claude":
      status = await runWithTimeout("claude", ["-p", "ping", "--output-format", "text"], PROBE_TIMEOUT);
      break;
    default:
      // Unknown family: a bare --version proves install but not auth; be
      // conservative and only trust a clean run.
      status = await runWithTimeout(name, ["--version"], PROBE_TIMEOUT);
      break;
  }
  return status === 0;
}

/**
 * Probe the hosted writer route with one real one-token call: a key can
 * belong to an account that is not allowed to reach the model it would write
 * with, which returns 403 on the first real call and nowhere earlier. The key
 * is built into a `fetch` header in memory — never an argument, never a file.
 */
async function probeOpenRouter(sessionRoot: string): Promise<boolean> {
  const key = loadOpenRouterKey(sessionRoot);
  if (key === null) return false;
  const endpoint =
    process.env.WORDTASTE_OPENROUTER_URL || "https://openrouter.ai/api/v1/chat/completions";
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: writerModel(sessionRoot),
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
      }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT * 1000),
    });
    // Mirror `curl --fail`: a 4xx/5xx is an unusable route, not an error.
    return response.status < 400;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  let outDir = "./.pneuma";
  let sessionRoot = ".";
  const sessionDir = process.env.PNEUMA_SESSION_DIR;
  if (sessionDir && existsSync(sessionDir) && statSync(sessionDir).isDirectory()) {
    outDir = join(sessionDir, ".pneuma");
    sessionRoot = sessionDir;
  }
  try {
    mkdirSync(outDir, { recursive: true });
  } catch {
    process.stderr.write(`wordtaste: cross_family_probe — cannot create ${outDir}\n`);
    process.exit(1);
  }
  const outFile = join(outDir, "cross-family.json");

  // Each family's liveness check is independent and the slow one dominates,
  // so run all three at once and join.
  const [claude, codex, openrouter] = await Promise.all([
    probeFamily("claude"),
    probeFamily("codex"),
    probeOpenRouter(sessionRoot),
  ]);

  // The shape matches the `crossFamily` memory source in manifest.ts, and the
  // original keys keep their exact spelling and meaning for every consumer.
  writeFileSync(
    outFile,
    `{\n  "claude": ${claude},\n  "codex": ${codex},\n  "openrouter": ${openrouter}\n}\n`,
  );
  process.exit(0);
}

if (import.meta.main) await main();

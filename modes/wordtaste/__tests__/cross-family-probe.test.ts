/**
 * cross_family_probe.sh — liveness (not PATH-presence) detection.
 *
 * The probe must do a fast, non-hanging liveness check per family: a CLI that
 * is on PATH but cannot actually answer (unauthenticated → interactive OAuth
 * that hangs) must be reported `false`, not `true`. These tests drive the
 * script against stub CLIs that simulate the three real-world states —
 * authenticated, present-but-hangs (unauth), and absent — and pin the two
 * load-bearing guarantees: correct liveness JSON, and a hard bound on runtime
 * (the probe NEVER hangs, even when a stubbed CLI blocks forever).
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROBE = join(import.meta.dir, "..", "skill", "scripts", "cross_family_probe.sh");

/** A stub CLI that exits 0 immediately (authenticated, answers fast). */
const STUB_OK = `#!/usr/bin/env bash
# Accepts a "login status" subcommand (codex) or a -p prompt (claude/gemini).
echo "ok"
exit 0
`;

/** A stub CLI that blocks forever (present but unauthenticated → would hang). */
const STUB_HANG = `#!/usr/bin/env bash
# Simulate the interactive OAuth wait gemini falls into when unauthenticated.
echo "Code Assist login required." >&2
sleep 600
exit 1
`;

interface ProbeRun {
  json: { claude: boolean; codex: boolean; gemini: boolean };
  elapsedMs: number;
  exitCode: number;
}

async function runProbe(stubs: Partial<Record<"claude" | "codex" | "gemini", string>>): Promise<ProbeRun> {
  const work = mkdtempSync(join(tmpdir(), "wordtaste-probe-"));
  const binDir = join(work, "bin");
  mkdirSync(binDir, { recursive: true });
  for (const [name, body] of Object.entries(stubs)) {
    const p = join(binDir, name);
    writeFileSync(p, body);
    chmodSync(p, 0o755);
  }
  const sessionDir = join(work, "session");
  mkdirSync(sessionDir, { recursive: true });

  const t0 = Date.now();
  // PATH = only the stub bin dir + the system tools the script itself needs
  // (mkdir, cat, sleep, kill…). Keep /bin and /usr/bin so the script runs, but
  // they hold NO claude/codex/gemini, so only the stubs are discoverable.
  const proc = Bun.spawn(["bash", PROBE], {
    env: {
      PATH: `${binDir}:/usr/bin:/bin`,
      PNEUMA_SESSION_DIR: sessionDir,
      // Short per-family timeout so a hanging stub is killed quickly and the
      // suite stays fast — the liveness contract is independent of the value.
      WORDTASTE_PROBE_TIMEOUT: "3",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  const stderr = await new Response(proc.stderr).text();
  const elapsedMs = Date.now() - t0;

  const outPath = join(sessionDir, ".pneuma", "cross-family.json");
  let json;
  try {
    json = JSON.parse(readFileSync(outPath, "utf8"));
  } catch (e) {
    rmSync(work, { recursive: true, force: true });
    throw new Error(`probe wrote no JSON (exit ${exitCode}); stderr:\n${stderr}`);
  }
  rmSync(work, { recursive: true, force: true });
  return { json, elapsedMs, exitCode };
}

describe("cross_family_probe.sh — liveness detection", () => {
  beforeAll(() => {
    // Sanity: the script exists and is the one under test.
    expect(readFileSync(PROBE, "utf8")).toContain("cross_family_probe");
  });

  test("authenticated CLI (fast clean exit) is reported true", async () => {
    const { json, exitCode } = await runProbe({ codex: STUB_OK });
    expect(exitCode).toBe(0);
    expect(json.codex).toBe(true);
  });

  test("present-but-hanging CLI is reported false (does NOT hang the probe)", async () => {
    const { json, elapsedMs, exitCode } = await runProbe({ gemini: STUB_HANG });
    expect(exitCode).toBe(0);
    expect(json.gemini).toBe(false);
    // The whole probe (which includes a hard timeout) must finish far faster
    // than the stub's 600s sleep — this is the entire point of the fix.
    expect(elapsedMs).toBeLessThan(20_000);
  });

  test("absent CLI is reported false", async () => {
    const { json, exitCode } = await runProbe({});
    expect(exitCode).toBe(0);
    expect(json.claude).toBe(false);
    expect(json.codex).toBe(false);
    expect(json.gemini).toBe(false);
  });

  test("mixed: one live, one hanging, one absent → true/false/false", async () => {
    const { json, elapsedMs, exitCode } = await runProbe({
      codex: STUB_OK,
      gemini: STUB_HANG,
      // claude absent
    });
    expect(exitCode).toBe(0);
    expect(json.codex).toBe(true);
    expect(json.gemini).toBe(false);
    expect(json.claude).toBe(false);
    expect(elapsedMs).toBeLessThan(20_000);
  });

  test("always writes valid JSON with all three keys", async () => {
    const { json } = await runProbe({ codex: STUB_OK });
    expect(Object.keys(json).sort()).toEqual(["claude", "codex", "gemini"]);
    for (const k of ["claude", "codex", "gemini"] as const) {
      expect(typeof json[k]).toBe("boolean");
    }
  });
});

/**
 * cross_family_probe.ts — liveness (not PATH-presence) detection.
 *
 * The probe must do a fast, non-hanging liveness check per family: a CLI that
 * is on PATH but cannot actually answer (unauthenticated → interactive OAuth
 * that hangs) must be reported `false`, not `true`. These tests drive the
 * script against stub CLIs that simulate the real-world states —
 * authenticated, present-but-hangs (unauth), and absent — and pin the two
 * load-bearing guarantees: correct liveness JSON, and a hard bound on runtime
 * (the probe NEVER hangs, even when a stubbed CLI blocks forever). The hosted
 * route is served by a local HTTP server, so no test ever reaches the network
 * or a real key.
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROBE = join(import.meta.dir, "..", "skill", "scripts", "cross_family_probe.ts");

/** A stub CLI that exits 0 immediately (authenticated, answers fast). */
const STUB_OK = `#!/usr/bin/env bash
# Accepts a "login status" subcommand (codex) or a -p prompt (claude).
echo "ok"
exit 0
`;

/** A stub CLI that blocks forever (present but unauthenticated → would hang). */
const STUB_HANG = `#!/usr/bin/env bash
# Simulate a CLI waiting for interactive authentication.
echo "Code Assist login required." >&2
sleep 600
exit 1
`;

/** An invented token, and the string every leak assertion looks for. */
const KEY = "sk-or-v1-probe-testonly-0123456789";

/**
 * The deadline (`WORDTASTE_PROBE_TIMEOUT`, seconds, fractional accepted) each
 * case hands the probe. A hang-path case asserts the deadline FIRES, so the
 * deadline is the whole cost of the case — and a short one is also the LESS
 * flaky choice, because the `elapsedMs` bound it is measured against keeps
 * every second of headroom the deadline does not spend.
 *
 *   HANG_ONLY — nothing in the run has to answer: the CLI sleeps forever, or
 *     the hosted route never replies. The parent-side timer fires by wall
 *     clock regardless of what the child is doing, so this is deterministic
 *     however small it is.
 *   HANG_PLUS_LIVE — a hang and a real answer share one run. The families are
 *     probed together, so the run costs the deadline no matter how fast the
 *     live half is, AND the live half must beat that same deadline: the two
 *     requirements pull against each other and there is no cheaper setting.
 *     This keeps the value the file has always used — measured at 2s, a
 *     `bash` stub under a parallel suite can miss a 2s deadline and flip the
 *     live answer to false, which is a lie about the CLI, not about the load.
 *   LIVE_ONLY (default) — nothing hangs, so the deadline is never reached and
 *     its value costs nothing. Generous on purpose: pure margin.
 */
const HANG_ONLY = { WORDTASTE_PROBE_TIMEOUT: "0.3" };
const HANG_PLUS_LIVE = { WORDTASTE_PROBE_TIMEOUT: "3" };
const LIVE_ONLY_TIMEOUT = "10";

interface HostedRequest {
  auth: string | null;
  body: string;
}

interface HostedServer {
  url: string;
  requests: HostedRequest[];
  stop(): void;
}

/**
 * A local stand-in for the hosted route. It records the Authorization header
 * and the body of every request, then answers with the named status — or
 * never answers at all, which is the measured shape of a stalled route.
 */
function startHosted(options: { status?: number; hang?: boolean } = {}): HostedServer {
  const requests: HostedRequest[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      requests.push({ auth: request.headers.get("authorization"), body: await request.text() });
      if (options.hang) return await new Promise<Response>(() => {});
      return new Response("{}", { status: options.status ?? 200 });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}/api/v1/chat/completions`,
    requests,
    stop: () => server.stop(true),
  };
}

interface ProbeRun {
  json: { claude: boolean; codex: boolean; openrouter: boolean };
  elapsedMs: number;
  exitCode: number;
  stderr: string;
  requests: HostedRequest[];
  /** Every file under the harness root after the run, with its contents. */
  files: Array<{ path: string; text: string }>;
}

function filesUnder(dir: string): Array<{ path: string; text: string }> {
  const out: Array<{ path: string; text: string }> = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(full));
    else if (entry.isFile()) out.push({ path: full, text: readFileSync(full, "latin1") });
  }
  return out;
}

async function runProbe(
  stubs: Partial<Record<"claude" | "codex", string>>,
  extraEnv: Record<string, string> = {},
  sessionFiles: Record<string, string> = {},
  hosted?: HostedServer,
): Promise<ProbeRun> {
  const work = mkdtempSync(join(tmpdir(), "wordtaste-probe-"));
  const binDir = join(work, "bin");
  const scratch = join(work, "tmp");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(scratch, { recursive: true });
  for (const [name, body] of Object.entries(stubs)) {
    const p = join(binDir, name);
    writeFileSync(p, body);
    chmodSync(p, 0o755);
  }
  const sessionDir = join(work, "session");
  mkdirSync(sessionDir, { recursive: true });
  for (const [name, body] of Object.entries(sessionFiles)) {
    writeFileSync(join(sessionDir, name), body);
  }

  const t0 = Date.now();
  // PATH = only the stub bin dir + the system dirs, which hold NO
  // claude/codex, so only the stubs are discoverable. TMPDIR points inside
  // the harness so every scratch file the probe makes is scanned afterwards.
  // cwd inside the harness: Bun auto-loads a `.env` from the working
  // directory into process.env, and the repo root has one.
  const proc = Bun.spawn([process.execPath, PROBE], {
    cwd: work,
    env: {
      PATH: `${binDir}:/usr/bin:/bin`,
      HOME: work,
      TMPDIR: scratch,
      PNEUMA_SESSION_DIR: sessionDir,
      // Per-family deadline. The liveness contract is independent of the
      // value, so each case picks the cheapest one that still proves its
      // point — see HANG_ONLY / HANG_PLUS_LIVE / LIVE_ONLY_TIMEOUT above.
      WORDTASTE_PROBE_TIMEOUT: LIVE_ONLY_TIMEOUT,
      ...(hosted ? { WORDTASTE_OPENROUTER_URL: hosted.url } : {}),
      ...extraEnv,
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
  const files = filesUnder(work);
  rmSync(work, { recursive: true, force: true });
  return { json, elapsedMs, exitCode, stderr, requests: hosted?.requests ?? [], files };
}

describe("cross_family_probe.ts — liveness detection", () => {
  beforeAll(() => {
    // Sanity: the script exists and is the one under test.
    expect(readFileSync(PROBE, "utf8")).toContain("cross_family_probe");
    expect(statSync(PROBE).isFile()).toBe(true);
  });

  test("authenticated CLI (fast clean exit) is reported true", async () => {
    const { json, exitCode } = await runProbe({ codex: STUB_OK });
    expect(exitCode).toBe(0);
    expect(json.codex).toBe(true);
  });

  test("present-but-hanging CLI is reported false (does NOT hang the probe)", async () => {
    const { json, elapsedMs, exitCode } = await runProbe({ claude: STUB_HANG }, HANG_ONLY);
    expect(exitCode).toBe(0);
    expect(json.claude).toBe(false);
    // The whole probe (which includes a hard timeout) must finish far faster
    // than the stub's 600s sleep — this is the entire point of the fix.
    expect(elapsedMs).toBeLessThan(20_000);
  });

  test("absent CLI is reported false", async () => {
    const { json, exitCode } = await runProbe({});
    expect(exitCode).toBe(0);
    expect(json.claude).toBe(false);
    expect(json.codex).toBe(false);
  });

  test("mixed: one live and one hanging → true/false", async () => {
    const { json, elapsedMs, exitCode } = await runProbe(
      { codex: STUB_OK, claude: STUB_HANG },
      HANG_PLUS_LIVE,
    );
    expect(exitCode).toBe(0);
    expect(json.codex).toBe(true);
    expect(json.claude).toBe(false);
    expect(elapsedMs).toBeLessThan(20_000);
  });

  test("always writes valid JSON with every supported route key", async () => {
    const { json } = await runProbe({ codex: STUB_OK });
    expect(Object.keys(json).sort()).toEqual(["claude", "codex", "openrouter"]);
    for (const k of ["claude", "codex", "openrouter"] as const) {
      expect(typeof json[k]).toBe("boolean");
    }
  });

  test("keeps successful probe metadata out of the visible terminal stream", async () => {
    const { stderr } = await runProbe({ codex: STUB_OK, claude: STUB_OK });
    expect(stderr).toBe("");
  });
});

/**
 * The hosted writer route is the one the probe can answer without any CLI at
 * all, and the one whose "present" answer is most often wrong: a key can
 * exist for an account that is not allowed to reach the model it names. So
 * presence is never the test — one real call is.
 */
describe("cross_family_probe.ts — the hosted writer route", () => {
  test("a key plus a call that succeeds is reported true", async () => {
    const hosted = startHosted();
    try {
      const { json, exitCode } = await runProbe({}, { OPENROUTER_API_KEY: KEY }, {}, hosted);
      expect(exitCode).toBe(0);
      expect(json.openrouter).toBe(true);
    } finally {
      hosted.stop();
    }
  });

  test("an account that cannot reach the model is reported false", async () => {
    // A 403 is the measured shape of an account holding a valid key with no
    // access to the model it would write with.
    const hosted = startHosted({ status: 403 });
    try {
      const { json } = await runProbe({}, { OPENROUTER_API_KEY: KEY }, {}, hosted);
      expect(json.openrouter).toBe(false);
    } finally {
      hosted.stop();
    }
  });

  test("a call that never returns is reported false, and does not hang the probe", async () => {
    const hosted = startHosted({ hang: true });
    try {
      const { json, elapsedMs } = await runProbe(
        {},
        { OPENROUTER_API_KEY: KEY, ...HANG_ONLY },
        {},
        hosted,
      );
      expect(json.openrouter).toBe(false);
      expect(elapsedMs).toBeLessThan(20_000);
    } finally {
      hosted.stop();
    }
  });

  test("no key is false, and no call is made", async () => {
    const hosted = startHosted();
    try {
      const { json, requests } = await runProbe({}, {}, {}, hosted);
      expect(json.openrouter).toBe(false);
      expect(requests).toHaveLength(0);
    } finally {
      hosted.stop();
    }
  });

  test("reads the session .env the mode's envMapping writes", async () => {
    const hosted = startHosted();
    try {
      const { json, requests } = await runProbe({}, {}, {
        ".env": `OPENROUTER_API_KEY=${KEY}\n`,
      }, hosted);
      expect(json.openrouter).toBe(true);
      expect(requests[0]?.auth).toBe(`Bearer ${KEY}`);
    } finally {
      hosted.stop();
    }
  });

  test("probes the model the writer would actually be given", async () => {
    const named = startHosted();
    try {
      const run = await runProbe({}, {
        OPENROUTER_API_KEY: KEY,
        WORDTASTE_WRITER_MODEL: "moonshotai/kimi-k2-thinking",
      }, {}, named);
      expect(run.requests[0]?.body).toContain("moonshotai/kimi-k2-thinking");
    } finally {
      named.stop();
    }

    // …including the model a session chose through its init parameter.
    const configured = startHosted();
    try {
      const run = await runProbe({}, { OPENROUTER_API_KEY: KEY }, {
        "config.json": JSON.stringify({ writerModel: "qwen/qwen3-max" }),
      }, configured);
      expect(run.requests[0]?.body).toContain("qwen/qwen3-max");
    } finally {
      configured.stop();
    }

    const byDefault = startHosted();
    try {
      const run = await runProbe({}, { OPENROUTER_API_KEY: KEY }, {}, byDefault);
      const body = JSON.parse(run.requests[0]!.body) as { model: string; max_tokens: number };
      expect(body.model).toBe("anthropic/claude-sonnet-5");
      // One token of budget: this is a liveness call, not a generation.
      expect(body.max_tokens).toBe(1);
    } finally {
      byDefault.stop();
    }
  }, 20_000);

  test("the key reaches the route as an in-memory header and lands in no file", async () => {
    const hosted = startHosted();
    try {
      const { requests, stderr, files } = await runProbe({}, { OPENROUTER_API_KEY: KEY }, {}, hosted);
      // The one place the key may appear is the Authorization header the
      // route itself received.
      expect(requests[0]?.auth).toBe(`Bearer ${KEY}`);
      expect(requests[0]?.body).not.toContain(KEY);
      expect(stderr).toBe("");
      // No file anywhere under the harness — session, HOME, or TMPDIR — ever
      // held the token. The bash era staged it through a 0600 header file;
      // `fetch` removes even that.
      for (const file of files) {
        expect([file.path, file.text.includes(KEY)]).toEqual([file.path, false]);
      }
    } finally {
      hosted.stop();
    }
  });

  test("leaves the other two answers exactly as they were", async () => {
    const hosted = startHosted();
    try {
      const { json } = await runProbe({ codex: STUB_OK, claude: STUB_HANG }, {
        OPENROUTER_API_KEY: KEY,
        ...HANG_PLUS_LIVE,
      }, {}, hosted);
      expect(json.codex).toBe(true);
      expect(json.claude).toBe(false);
      expect(json.openrouter).toBe(true);
    } finally {
      hosted.stop();
    }
  }, 20_000);
});

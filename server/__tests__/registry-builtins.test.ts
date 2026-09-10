/**
 * `/api/registry` builtins — the payload the launcher's marketplace is built
 * from.
 *
 * Pins the one derived field on a builtin entry: `hasInitParams`, "this mode
 * asks the user something before it launches". It used to be a hardcoded
 * `name === "slide" || name === "illustrate" || name === "kami"` conditional
 * in `server/index.ts` — mode knowledge in the server, and stale the moment a
 * mode gained params. It is now read out of each manifest by `parseManifestTs`,
 * so this test asserts the flag against the REAL builtin manifests on disk:
 * the three legacy modes must keep reporting true, and the modes the hardcoded
 * list never knew about must report true as well.
 *
 * Scope note: the flag is payload-only today — no launcher UI reads it (the
 * init form is driven by `/api/launch/prepare`, which returns the resolved
 * `initParams` themselves). What is pinned here is the server-side derivation,
 * not a rendered behaviour.
 *
 * Hermetic by construction, because this boots the LAUNCHER server against the
 * developer's real machine:
 *   - `HOME` is redirected to a tmpdir for the duration, so launcher boot's
 *     `bootstrapAgentCommandAutoUpdate` cannot re-stamp the real
 *     `~/.claude/commands/handoff-pneuma.md` / `~/.agents/skills/…` /
 *     `~/.pneuma/agent-commands.json` when the worktree version differs from
 *     the installed one (`core/agent-command-installer.ts` reads `process.env.HOME`
 *     first for exactly this).
 *   - `shutdownProjectCache()` tears down the chokidar watchers launcher boot
 *     starts for every project in the real `~/.pneuma/sessions.json` (that
 *     prime resolves the registry path through `homedir()`, which Bun caches
 *     at process start, so the HOME redirect does not reach it). Left running,
 *     they keep re-scanning real project trees — and the event loop alive —
 *     for the rest of the run. Mirrors `projects-routes.test.ts` /
 *     `projects-cache.test.ts`.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startServer } from "../index.js";
import { shutdownProjectCache } from "../projects-cache.js";

const TEST_PORT = 19884;
const WORKSPACE = mkdtempSync(join(tmpdir(), "pneuma-registry-test-"));

type BuiltinEntry = { name: string; hasInitParams?: boolean };

let server: Awaited<ReturnType<typeof startServer>>;
let tmpHome = "";
let originalHome: string | undefined;
let registryStatus = 0;
let builtins: BuiltinEntry[] = [];

const entry = (name: string): BuiltinEntry => {
  const found = builtins.find((b) => b.name === name);
  if (!found) throw new Error(`builtin "${name}" missing from /api/registry`);
  return found;
};

// 30s, not Bun's default 5s: the route awaits a live fetch of the published
// mode registry that is itself allowed 5s before it aborts, so on a slow DNS
// the hook budget is the first thing to blow — a failure about nothing this
// test is asserting. The assertions moved out of the hook for the same reason:
// a hook that throws reports as a hook error, not as the failing case.
beforeAll(async () => {
  originalHome = process.env.HOME;
  tmpHome = mkdtempSync(join(tmpdir(), "pneuma-registry-home-"));
  process.env.HOME = tmpHome;

  server = await startServer({ port: TEST_PORT, workspace: WORKSPACE, launcherMode: true });
  const res = await fetch(`http://localhost:${TEST_PORT}/api/registry?locale=en`);
  registryStatus = res.status;
  const data = await res.json() as { builtins?: BuiltinEntry[] };
  builtins = data.builtins ?? [];
}, 30_000);

afterAll(async () => {
  (server as { server?: { stop?: () => void } } | undefined)?.server?.stop?.();
  await shutdownProjectCache();
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  // Guarded: a boot that fails before the tmp home exists must surface ITS
  // error, not a teardown TypeError on top of it.
  if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
  rmSync(WORKSPACE, { recursive: true, force: true });
});

describe("GET /api/registry — hasInitParams is derived from the manifest", () => {
  test("answers 200 with the builtin modes", () => {
    expect(registryStatus).toBe(200);
    expect(builtins.length).toBeGreaterThan(0);
  });

  // The three the hardcoded conditional named — behaviour must be identical.
  for (const name of ["slide", "illustrate", "kami"]) {
    test(`${name} still reports hasInitParams (no regression)`, () => {
      expect(entry(name).hasInitParams).toBe(true);
    });
  }

  // Modes with init params that the hardcoded list never knew about.
  for (const name of ["plotwise", "clipcraft", "bansho", "webcraft"]) {
    test(`${name} now reports hasInitParams`, () => {
      expect(entry(name).hasInitParams).toBe(true);
    });
  }

  test("doc asks nothing at launch and omits the flag", () => {
    expect(entry("doc").hasInitParams).toBeFalsy();
  });

  test("cosmos declares an empty params array and omits the flag", () => {
    expect(entry("cosmos").hasInitParams).toBeFalsy();
  });
});

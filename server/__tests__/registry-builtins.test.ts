/**
 * `/api/registry` builtins — the launcher's marketplace payload.
 *
 * Pins the one derived field on a builtin entry: `hasInitParams`, which says
 * "this mode asks the user something before it launches". It used to be a
 * hardcoded `name === "slide" || name === "illustrate" || name === "kami"`
 * conditional in `server/index.ts` — mode knowledge in the server, and stale
 * the moment a mode gained params. It is now read out of each manifest by
 * `parseManifestTs`, so this test asserts the flag against the REAL builtin
 * manifests on disk: the three legacy modes must keep reporting true, and the
 * modes the hardcoded list never knew about must report true as well.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startServer } from "../index.js";

const TEST_PORT = 19884;
const WORKSPACE = mkdtempSync(join(tmpdir(), "pneuma-registry-test-"));

type BuiltinEntry = { name: string; hasInitParams?: boolean };

let server: Awaited<ReturnType<typeof startServer>>;
let builtins: BuiltinEntry[] = [];

const entry = (name: string): BuiltinEntry => {
  const found = builtins.find((b) => b.name === name);
  if (!found) throw new Error(`builtin "${name}" missing from /api/registry`);
  return found;
};

beforeAll(async () => {
  server = await startServer({ port: TEST_PORT, workspace: WORKSPACE, launcherMode: true });
  const res = await fetch(`http://localhost:${TEST_PORT}/api/registry?locale=en`);
  expect(res.status).toBe(200);
  const data = await res.json() as { builtins?: BuiltinEntry[] };
  builtins = data.builtins ?? [];
});

afterAll(() => {
  (server as { server?: { stop?: () => void } } | undefined)?.server?.stop?.();
  rmSync(WORKSPACE, { recursive: true, force: true });
});

describe("GET /api/registry — hasInitParams is derived from the manifest", () => {
  test("returns the builtin modes", () => {
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

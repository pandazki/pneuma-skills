/**
 * `/api/registry` after the mode-distribution split.
 *
 * Two invariants live here.
 *
 * 1. **No mode list in the server.** The launcher's grid used to be built
 *    from a hardcoded array of eighteen names in `server/index.ts`. Adding a
 *    mode meant editing the server, and the array's own comment admitted the
 *    pattern was fragile. The offered set is now derived: every mode
 *    directory with a `manifest.ts` that does not declare `hidden: true`.
 *    This test reads the same directory and demands the two agree — including
 *    `mode-maker`, which the old array silently omitted.
 *
 * 2. **Order comes from `modes/distribution.json`, then the catalog.**
 *    The modes this distribution ships lead the list; everything else
 *    follows. That file is the one authority for the split (proposal D2), so
 *    the server must not re-state it.
 *
 * The `catalog` bucket itself is exercised where its data exists — this core
 * has no generated `modes/catalog.json`, so every mode is in the tree and the
 * bucket is legitimately empty. What is pinned here is that the key is part
 * of the contract and that an in-tree mode is never reported twice.
 *
 * Hermetic in the same way as `registry-builtins.test.ts`: `HOME` is
 * redirected for the duration so launcher boot cannot re-stamp the
 * developer's real agent-command installs, and the project cache's chokidar
 * watchers are shut down afterwards so they do not keep the event loop alive.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { startServer } from "../index.js";
import { shutdownProjectCache } from "../projects-cache.js";
import { parseManifestTs } from "../../core/utils/manifest-parser.js";

const TEST_PORT = 19887;
const WORKSPACE = mkdtempSync(join(tmpdir(), "pneuma-registry-catalog-"));
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MODES_DIR = join(PROJECT_ROOT, "modes");

interface RegistryPayload {
  builtins: Array<{ name: string }>;
  catalog: Array<{ name: string; state: string; unpackedSize: number }>;
  local: Array<{ name: string }>;
}

let server: Awaited<ReturnType<typeof startServer>>;
let tmpHome = "";
let originalHome: string | undefined;
let payload: RegistryPayload = { builtins: [], catalog: [], local: [] };
let status = 0;

/** Every mode directory in the tree that a user may be offered. */
function offerableModeDirs(): string[] {
  return readdirSync(MODES_DIR).filter((dir) => {
    const manifest = join(MODES_DIR, dir, "manifest.ts");
    if (!existsSync(manifest)) return false;
    try {
      return parseManifestTs(readFileSync(manifest, "utf-8"), "en").hidden !== true;
    } catch {
      return false;
    }
  });
}

function hiddenModeDirs(): string[] {
  return readdirSync(MODES_DIR).filter((dir) => {
    const manifest = join(MODES_DIR, dir, "manifest.ts");
    if (!existsSync(manifest)) return false;
    try {
      return parseManifestTs(readFileSync(manifest, "utf-8"), "en").hidden === true;
    } catch {
      return false;
    }
  });
}

function bundledNames(): string[] {
  const raw = JSON.parse(readFileSync(join(MODES_DIR, "distribution.json"), "utf-8")) as {
    bundled: string[];
  };
  return raw.bundled;
}

beforeAll(async () => {
  originalHome = process.env.HOME;
  tmpHome = mkdtempSync(join(tmpdir(), "pneuma-registry-catalog-home-"));
  process.env.HOME = tmpHome;

  server = await startServer({ port: TEST_PORT, workspace: WORKSPACE, launcherMode: true });
  const res = await fetch(`http://localhost:${TEST_PORT}/api/registry?locale=en`);
  status = res.status;
  payload = (await res.json()) as RegistryPayload;
}, 30_000);

afterAll(async () => {
  (server as { server?: { stop?: () => void } } | undefined)?.server?.stop?.();
  await shutdownProjectCache();
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
  rmSync(WORKSPACE, { recursive: true, force: true });
});

describe("GET /api/registry — the offered set is derived, not listed", () => {
  test("answers 200 with both mode buckets", () => {
    expect(status).toBe(200);
    expect(Array.isArray(payload.builtins)).toBe(true);
    expect(Array.isArray(payload.catalog)).toBe(true);
  });

  test("every offerable mode directory is reported", () => {
    const reported = new Set([
      ...payload.builtins.map((m) => m.name),
      ...payload.catalog.map((m) => m.name),
    ]);
    const missing = offerableModeDirs().filter((dir) => !reported.has(dir));
    expect(missing).toEqual([]);
  });

  test("mode-maker is reported — the hardcoded list used to drop it", () => {
    const reported = [...payload.builtins, ...payload.catalog].map((m) => m.name);
    expect(reported).toContain("mode-maker");
  });

  test("hidden modes never leak into the offered set", () => {
    const reported = new Set([
      ...payload.builtins.map((m) => m.name),
      ...payload.catalog.map((m) => m.name),
    ]);
    const hidden = hiddenModeDirs();
    expect(hidden.length).toBeGreaterThan(0); // the filter is actually exercised
    expect(hidden.filter((name) => reported.has(name))).toEqual([]);
  });

  test("a directory without a manifest is not a mode", () => {
    const names = payload.builtins.map((m) => m.name);
    expect(names).not.toContain("_shared");
  });

  test("the modes this distribution ships lead the order", () => {
    const bundled = new Set(bundledNames());
    const order = payload.builtins.map((m) => m.name);
    const lastBundled = order.reduce((acc, name, i) => (bundled.has(name) ? i : acc), -1);
    const firstOther = order.findIndex((name) => !bundled.has(name));
    expect(lastBundled).toBeGreaterThan(-1);
    if (firstOther !== -1) expect(lastBundled).toBeLessThan(firstOther);
  });

  test("a mode present in the tree is never also offered as a download", () => {
    const builtinNames = new Set(payload.builtins.map((m) => m.name));
    const both = payload.catalog.filter((m) => builtinNames.has(m.name));
    expect(both).toEqual([]);
  });
});

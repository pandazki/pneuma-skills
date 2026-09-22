/**
 * `/api/registry` says where an installed catalog mode's source is.
 *
 * The gallery's "Edit in Mode Maker" copies a mode's files into a fresh
 * workspace, and `POST /api/mode-maker/fork` resolves the source as "the
 * explicit `sourcePath`, or `<package>/modes/<name>`". In a released package
 * a catalog mode has no directory under `modes/` at all — only its showcase
 * images — so a fork by bare name answers `Mode "<name>" not found`, and the
 * button offered next to an installed catalog mode could never work.
 *
 * The launcher is the side that knows which mode it is looking at, so the
 * registry hands it the install directory and the launcher passes it as
 * `sourcePath` — the same way it already does for a local mode. This test
 * pins the half of that contract the server owns.
 *
 * Deliberately NOT named `path`: `local[]`'s `path` is also a launch
 * specifier and the workspace `evolve` edits in place, and a catalog install
 * is neither — `core/mode-catalog.ts` owns that directory and replaces it on
 * the next core upgrade.
 *
 * Hermetic: `HOME` is redirected so the fake install lands in a throwaway
 * `~/.pneuma/catalog/`, and the project cache's watchers are shut down after.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startServer } from "../index.js";
import { shutdownProjectCache } from "../projects-cache.js";
import {
  MODE_CATALOG_FORMAT,
  MODE_INSTALL_RECORD,
  type ModeCatalog,
  type ModeInstallRecord,
} from "../../core/types/mode-catalog.js";

const TEST_PORT = 19895;
const INSTALLED = "installed-mode";
const ABSENT = "absent-mode";
const SHA = "a".repeat(64);

interface RegistryCatalogEntry {
  name: string;
  state: string;
  installPath?: string;
}

let projectRoot: string;
let workspace: string;
let tmpHome: string;
let originalHome: string | undefined;
let server: Awaited<ReturnType<typeof startServer>>;
let catalogBucket: RegistryCatalogEntry[] = [];

/** A released package: showcase images for both modes, source for neither. */
function writeFixturePackage(root: string): void {
  writeFileSync(
    join(root, "modes", "distribution.json"),
    JSON.stringify({ bundled: ["_shared"] }, null, 2),
  );
  const catalog: ModeCatalog = {
    formatVersion: MODE_CATALOG_FORMAT,
    coreVersion: "9.9.9",
    generatedAt: "2026-09-22T00:00:00.000Z",
    modes: [INSTALLED, ABSENT].map((name) => ({
      name,
      version: "1.0.0",
      displayName: { en: name },
      archive: { url: `https://example.invalid/${name}.tar.gz`, size: 1024, sha256: SHA },
      unpackedSize: 4096,
    })),
  };
  writeFileSync(join(root, "modes", "catalog.json"), JSON.stringify(catalog, null, 2));
}

/**
 * What a completed install looks like on disk: the mode under
 * `<root>/modes/<name>/`, and the record — written last — that marks it
 * complete. The sha matches the catalog entry, so the state is `installed`
 * rather than `stale`.
 */
function fakeInstall(home: string, name: string): string {
  const root = join(home, ".pneuma", "catalog", name);
  const modeDir = join(root, "modes", name);
  mkdirSync(modeDir, { recursive: true });
  writeFileSync(join(modeDir, "manifest.ts"), "export default {};");
  const record: ModeInstallRecord = {
    name,
    version: "1.0.0",
    coreVersion: "9.9.9",
    sha256: SHA,
    installedAt: "2026-09-22T00:00:00.000Z",
  };
  writeFileSync(join(root, MODE_INSTALL_RECORD), JSON.stringify(record, null, 2));
  return modeDir;
}

beforeAll(async () => {
  originalHome = process.env.HOME;
  tmpHome = mkdtempSync(join(tmpdir(), "pneuma-catalog-source-home-"));
  process.env.HOME = tmpHome;

  projectRoot = mkdtempSync(join(tmpdir(), "pneuma-catalog-source-pkg-"));
  mkdirSync(join(projectRoot, "modes"), { recursive: true });
  writeFixturePackage(projectRoot);
  fakeInstall(tmpHome, INSTALLED);
  workspace = mkdtempSync(join(tmpdir(), "pneuma-catalog-source-ws-"));

  server = await startServer({
    port: TEST_PORT,
    workspace,
    projectRoot,
    launcherMode: true,
  });
  const res = await fetch(`http://localhost:${TEST_PORT}/api/registry?locale=en`);
  const payload = (await res.json()) as { catalog: RegistryCatalogEntry[] };
  catalogBucket = payload.catalog ?? [];
}, 30_000);

afterAll(async () => {
  (server as { server?: { stop?: (force?: boolean) => void } } | undefined)?.server?.stop?.(true);
  await shutdownProjectCache().catch(() => {});
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  for (const dir of [tmpHome, projectRoot, workspace]) {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("GET /api/registry — catalog[].installPath", () => {
  test("the fixture is a released package: both modes are catalog entries", () => {
    expect(catalogBucket.map((m) => m.name).sort()).toEqual([ABSENT, INSTALLED].sort());
  });

  test("an installed catalog mode reports a directory that really holds its source", () => {
    const entry = catalogBucket.find((m) => m.name === INSTALLED);
    expect(entry?.state).toBe("installed");
    expect(entry?.installPath).toBeTruthy();
    // The value has to be usable as a fork source, not merely present.
    expect(existsSync(join(entry!.installPath!, "manifest.ts"))).toBe(true);
  });

  test("a mode that is not on this machine reports no source at all", () => {
    // The absence is what the launcher gates the Edit button on: a mode with
    // nothing to copy must not offer an action that copies it.
    const entry = catalogBucket.find((m) => m.name === ABSENT);
    expect(entry?.state).toBe("not-installed");
    expect(entry?.installPath).toBeUndefined();
  });
});

/**
 * `scripts/publish-modes.ts` is the release half of the mode split: the core
 * on npm and the archives on the CDN have to come from one commit, and the
 * package ships the pins. These tests run the whole pipeline against a
 * throwaway mode tree — build, stage, pack, catalog — with the remote side
 * injected, so nothing here reaches R2 or the npm registry.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { extractArchive } from "../../snapshot/archive.js";
import { MODE_PACKAGE_STAMP } from "../../core/types/mode-catalog.js";
import type { ModeCatalog, ModePackageStamp } from "../../core/types/mode-catalog.js";
import {
  archiveKey,
  ArchiveUnreadableError,
  catalogModeNames,
  catalogsEquivalent,
  createPublicReadStore,
  parseArgs,
  PublishRefusedError,
  publishModes,
  readCoreVersion,
  readDistribution,
  type ArchiveStore,
} from "../publish-modes.js";

const BUILT_AT = "2026-09-23T00:00:00.000Z";
const BASE_URL = "https://cdn.test";
const VERSION = "9.9.9";

let root: string;

/**
 * A mode tree with one bundled mode and one catalog mode. The catalog mode
 * carries one of everything the archive rules talk about: source that must
 * travel, tests/harness/showcase that must not, and a stale `node_modules`
 * from someone's local `bun install`.
 */
function writeFixture(): string {
  // The fixture is a miniature checkout: `--version` is bound to the
  // package.json beside the mode tree, because the archives are stamped with
  // the core that built them.
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture-core", version: VERSION }, null, 2));

  const modesDir = join(root, "modes");
  mkdirSync(modesDir, { recursive: true });
  writeFileSync(
    join(modesDir, "distribution.json"),
    JSON.stringify({ bundled: ["bundled-mode"] }, null, 2),
  );

  const bundled = join(modesDir, "bundled-mode");
  mkdirSync(bundled, { recursive: true });
  writeFileSync(join(bundled, "manifest.ts"), manifestSource("bundled-mode", "0.1.0"));

  const mode = join(modesDir, "fixture");
  mkdirSync(join(mode, "skill"), { recursive: true });
  mkdirSync(join(mode, "viewer"), { recursive: true });
  mkdirSync(join(mode, "__tests__"), { recursive: true });
  mkdirSync(join(mode, "viewer", "__tests__"), { recursive: true });
  mkdirSync(join(mode, "harness"), { recursive: true });
  mkdirSync(join(mode, "showcase"), { recursive: true });
  mkdirSync(join(mode, "node_modules", "stale"), { recursive: true });
  writeFileSync(join(mode, "manifest.ts"), manifestSource("fixture", "1.2.3"));
  writeFileSync(
    join(mode, "pneuma-mode.ts"),
    ['import manifest from "./manifest.js";', "export default { manifest, viewer: { id: manifest.name } };", ""].join("\n"),
  );
  writeFileSync(join(mode, "skill", "SKILL.md"), "# Fixture skill\n");
  writeFileSync(join(mode, "viewer", "Preview.ts"), "export const preview = 1;\n");
  writeFileSync(join(mode, "__tests__", "fixture.test.ts"), "// never shipped\n");
  writeFileSync(join(mode, "viewer", "__tests__", "nested.test.ts"), "// never shipped\n");
  writeFileSync(join(mode, "harness", "evidence.bin"), "x".repeat(4096));
  writeFileSync(join(mode, "showcase", "hero.png"), "not really a png");
  writeFileSync(join(mode, "node_modules", "stale", "index.js"), "module.exports = 1;\n");
  return modesDir;
}

/** A second catalog mode, for the rules that only exist when a run can be partial. */
function addCatalogMode(modesDir: string, name: string, version: string): void {
  const dir = join(modesDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "manifest.ts"), manifestSource(name, version));
  writeFileSync(
    join(dir, "pneuma-mode.ts"),
    ['import manifest from "./manifest.js";', "export default { manifest, viewer: { id: manifest.name } };", ""].join("\n"),
  );
}

function manifestSource(name: string, version: string): string {
  return [
    "export const manifest = {",
    `  name: "${name}",`,
    `  version: "${version}",`,
    `  displayName: { en: "Fixture Mode", "zh-CN": "Fixture Mode (zh)" },`,
    `  description: { en: "A mode that exists to be packed" },`,
    "  icon: `<svg viewBox=\"0 0 24 24\"></svg>`,",
    "};",
    "export default manifest;",
    "",
  ].join("\n");
}

/** Remote side that records calls instead of making them. */
function fakeStore(overrides: Partial<ArchiveStore> = {}) {
  const puts: string[] = [];
  const jsonPuts: Array<{ key: string; value: unknown }> = [];
  const store: ArchiveStore = {
    publicUrl: BASE_URL,
    readSha256: async () => null,
    readJson: async () => null,
    putFile: async (key) => {
      puts.push(key);
      return `${BASE_URL}/${key}`;
    },
    putJson: async (key, value) => {
      jsonPuts.push({ key, value });
      return `${BASE_URL}/${key}`;
    },
    ...overrides,
  };
  return { store, puts, jsonPuts };
}

async function dryRun(modesDir: string, outDir: string, builtAt = BUILT_AT) {
  return publishModes({
    version: VERSION,
    dryRun: true,
    outDir,
    modesDir,
    baseUrl: BASE_URL,
    builtAt,
    log: () => {},
  });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "publish-modes-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("catalog set", () => {
  it("is every mode directory distribution.json does not bundle", () => {
    const modesDir = writeFixture();
    expect(readDistribution(modesDir).bundled).toEqual(["bundled-mode"]);
    expect(catalogModeNames(modesDir)).toEqual(["fixture"]);
  });

  it("addresses an archive by both the core and the mode version", () => {
    expect(archiveKey("3.52.0", "backlot", "0.4.1")).toBe("official/v3.52.0/backlot-0.4.1.tar.gz");
  });
});

/**
 * Every archive is stamped with the core that built it and only runs there, so
 * the release version has to be a fact about the source being packed — not a
 * label the caller picks.
 */
describe("the version is bound to the checkout", () => {
  it("refuses a semver version this checkout does not declare", async () => {
    const modesDir = writeFixture();
    await expect(
      publishModes({ version: "9.9.8", dryRun: true, outDir: join(root, "out"), modesDir, log: () => {} }),
    ).rejects.toThrow(/9\.9\.8 does not match this checkout, which is 9\.9\.9/);
  });

  it("says which file it could not read rather than publishing unbound", async () => {
    const modesDir = writeFixture();
    rmSync(join(root, "package.json"));
    await expect(
      publishModes({ version: VERSION, dryRun: true, outDir: join(root, "out"), modesDir, log: () => {} }),
    ).rejects.toThrow(/cannot read the core version from .*package\.json/);
  });

  it("reads the checkout's version and rejects a package.json without one", () => {
    writeFileSync(join(root, "package.json"), JSON.stringify({ version: "1.2.3" }));
    expect(readCoreVersion(root)).toBe("1.2.3");
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "no-version" }));
    expect(() => readCoreVersion(root)).toThrow(/declares no "version"/);
  });
});

describe("publishModes --dry-run", () => {
  it("packs the mode source with a stamp and the prebuilt bundle", async () => {
    const modesDir = writeFixture();
    const out = join(root, "out");
    const result = await dryRun(modesDir, out);

    const unpacked = join(root, "unpacked");
    await extractArchive(result.modes[0]!.archivePath, unpacked);

    expect(existsSync(join(unpacked, "manifest.ts"))).toBe(true);
    expect(existsSync(join(unpacked, "skill", "SKILL.md"))).toBe(true);
    expect(existsSync(join(unpacked, ".build", "pneuma-mode.js"))).toBe(true);

    const stamp = JSON.parse(readFileSync(join(unpacked, MODE_PACKAGE_STAMP), "utf-8")) as ModePackageStamp;
    expect(stamp).toEqual({
      formatVersion: 1,
      name: "fixture",
      version: "1.2.3",
      coreVersion: VERSION,
      builtAt: BUILT_AT,
    });
  });

  it("leaves tests, harness, showcase and a stale node_modules behind", async () => {
    const modesDir = writeFixture();
    const result = await dryRun(modesDir, join(root, "out"));
    const unpacked = join(root, "unpacked");
    await extractArchive(result.modes[0]!.archivePath, unpacked);

    for (const path of ["__tests__", "harness", "showcase", "node_modules", join("viewer", "__tests__")]) {
      expect(existsSync(join(unpacked, path))).toBe(false);
    }
    // The viewer source next to the dropped nested __tests__ still travels.
    expect(existsSync(join(unpacked, "viewer", "Preview.ts"))).toBe(true);
  });

  it("pins each archive by its own bytes", async () => {
    const modesDir = writeFixture();
    const result = await dryRun(modesDir, join(root, "out"));
    const entry = result.catalog.modes[0]!;
    const bytes = new Uint8Array(readFileSync(result.modes[0]!.archivePath));
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(bytes);

    expect(entry.archive.sha256).toBe(hasher.digest("hex"));
    expect(entry.archive.size).toBe(statSync(result.modes[0]!.archivePath).size);
    expect(entry.archive.size).toBe(bytes.length);
    expect(entry.archive.url).toBe(`${BASE_URL}/official/v${VERSION}/fixture-1.2.3.tar.gz`);
  });

  it("quotes the install size of the extracted tree, not the archive", async () => {
    const modesDir = writeFixture();
    const result = await dryRun(modesDir, join(root, "out"));
    const entry = result.catalog.modes[0]!;

    const unpacked = join(root, "unpacked");
    await extractArchive(result.modes[0]!.archivePath, unpacked);
    expect(entry.unpackedSize).toBe(treeSize(unpacked));
    expect(entry.unpackedSize).toBeGreaterThan(entry.archive.size);
  });

  it("copies the introduction out of the manifest, keeping every locale", async () => {
    const modesDir = writeFixture();
    const { catalog } = await dryRun(modesDir, join(root, "out"));
    const entry = catalog.modes[0]!;

    expect(entry.name).toBe("fixture");
    expect(entry.version).toBe("1.2.3");
    expect(entry.displayName).toEqual({ en: "Fixture Mode", "zh-CN": "Fixture Mode (zh)" });
    expect(entry.description).toBe("A mode that exists to be packed");
    expect(entry.icon).toContain("<svg");
    expect(catalog).toMatchObject({ formatVersion: 1, coreVersion: VERSION, generatedAt: BUILT_AT });
  });

  it("writes the catalog beside the archives and nowhere else", async () => {
    const modesDir = writeFixture();
    const out = join(root, "out");
    const result = await dryRun(modesDir, out);

    expect(result.catalogPath).toBe(join(out, "catalog.json"));
    expect(existsSync(join(modesDir, "catalog.json"))).toBe(false);
    expect(result.modes[0]!.upload).toBe("dry-run");
  });

  it("produces the same bytes twice from the same source", async () => {
    const modesDir = writeFixture();
    const first = await dryRun(modesDir, join(root, "out-a"));
    const second = await dryRun(modesDir, join(root, "out-b"));

    expect(second.catalog).toEqual(first.catalog);
    expect(readFileSync(second.modes[0]!.archivePath)).toEqual(readFileSync(first.modes[0]!.archivePath));
  });

  it("changes only the clock when only the clock changed", async () => {
    const modesDir = writeFixture();
    const first = await dryRun(modesDir, join(root, "out-a"));
    const later = await dryRun(modesDir, join(root, "out-b"), "2026-10-01T00:00:00.000Z");

    expect(catalogsEquivalent(first.catalog, later.catalog)).toBe(false); // the stamp is inside the bytes
    expect(later.catalog.modes[0]!.unpackedSize).toBe(first.catalog.modes[0]!.unpackedSize);
    expect(later.catalog.generatedAt).toBe("2026-10-01T00:00:00.000Z");
  });

  it("rejects --only for a mode that is not in the catalog", async () => {
    const modesDir = writeFixture();
    await expect(
      publishModes({ version: VERSION, dryRun: true, outDir: join(root, "out"), modesDir, only: ["bundled-mode"], log: () => {} }),
    ).rejects.toThrow(/not catalog modes: bundled-mode/);
  });

  it("refuses a version that is not semver", async () => {
    const modesDir = writeFixture();
    await expect(
      publishModes({ version: "latest", dryRun: true, outDir: join(root, "out"), modesDir, log: () => {} }),
    ).rejects.toThrow(/--version must be a semver release/);
  });
});

describe("publishModes upload rules", () => {
  it("uploads every archive and the catalog beside them", async () => {
    const modesDir = writeFixture();
    const { store, puts, jsonPuts } = fakeStore();
    const result = await publishModes({
      version: VERSION,
      dryRun: false,
      outDir: join(root, "out"),
      modesDir,
      builtAt: BUILT_AT,
      store,
      catalogPath: join(root, "shipped-catalog.json"),
      isVersionOnNpm: async () => false,
      log: () => {},
    });

    expect(puts).toEqual([`official/v${VERSION}/fixture-1.2.3.tar.gz`]);
    expect(jsonPuts.map((p) => p.key)).toEqual([`official/v${VERSION}/catalog.json`]);
    expect(result.modes[0]!.upload).toBe("uploaded");

    const shipped = JSON.parse(readFileSync(join(root, "shipped-catalog.json"), "utf-8")) as ModeCatalog;
    expect(shipped).toEqual(result.catalog);
  });

  it("skips a key that already holds the same bytes, without asking npm", async () => {
    const modesDir = writeFixture();
    const dry = await dryRun(modesDir, join(root, "dry"));
    const sha = dry.catalog.modes[0]!.archive.sha256;

    let npmAsked = false;
    const { store, puts } = fakeStore({
      readSha256: async () => sha,
      readJson: async () => dry.catalog,
    });
    const result = await publishModes({
      version: VERSION,
      dryRun: false,
      outDir: join(root, "out"),
      modesDir,
      builtAt: BUILT_AT,
      store,
      catalogPath: join(root, "shipped-catalog.json"),
      isVersionOnNpm: async () => {
        npmAsked = true;
        return true;
      },
      log: () => {},
    });

    expect(result.modes[0]!.upload).toBe("skipped");
    expect(puts).toEqual([]);
    expect(npmAsked).toBe(false);
  });

  it("overwrites a differing key while the version is not on npm yet", async () => {
    const modesDir = writeFixture();
    const { store, puts } = fakeStore({ readSha256: async () => "0".repeat(64) });
    const result = await publishModes({
      version: VERSION,
      dryRun: false,
      outDir: join(root, "out"),
      modesDir,
      builtAt: BUILT_AT,
      store,
      catalogPath: join(root, "shipped-catalog.json"),
      isVersionOnNpm: async () => false,
      log: () => {},
    });

    expect(result.modes[0]!.upload).toBe("uploaded");
    expect(puts).toEqual([`official/v${VERSION}/fixture-1.2.3.tar.gz`]);
  });

  it("refuses to overwrite a differing key once the version is on npm", async () => {
    const modesDir = writeFixture();
    const { store, puts, jsonPuts } = fakeStore({ readSha256: async () => "0".repeat(64) });
    const catalogPath = join(root, "shipped-catalog.json");

    const error = await publishModes({
      version: VERSION,
      dryRun: false,
      outDir: join(root, "out"),
      modesDir,
      builtAt: BUILT_AT,
      store,
      catalogPath,
      isVersionOnNpm: async () => true,
      log: () => {},
    }).then(() => null, (e: unknown) => e);

    expect(error).toBeInstanceOf(PublishRefusedError);
    expect((error as Error).message).toContain("is published on npm");
    expect((error as Error).message).toContain("Bump the version");
    // Nothing is decided halfway: no archive, no catalog, no shipped pins.
    expect(puts).toEqual([]);
    expect(jsonPuts).toEqual([]);
    expect(existsSync(catalogPath)).toBe(false);
  });

  it("refuses when the published catalog would change even if the archives match", async () => {
    const modesDir = writeFixture();
    const dry = await dryRun(modesDir, join(root, "dry"));
    const stale: ModeCatalog = { ...dry.catalog, modes: [] };
    const { store, jsonPuts } = fakeStore({
      readSha256: async () => dry.catalog.modes[0]!.archive.sha256,
      readJson: async () => stale,
    });

    await expect(
      publishModes({
        version: VERSION,
        dryRun: false,
        outDir: join(root, "out"),
        modesDir,
        builtAt: BUILT_AT,
        store,
        catalogPath: join(root, "shipped-catalog.json"),
        isVersionOnNpm: async () => true,
        log: () => {},
      }),
    ).rejects.toBeInstanceOf(PublishRefusedError);
    expect(jsonPuts).toEqual([]);
  });

  it("needs a store when it is not a dry run", async () => {
    const modesDir = writeFixture();
    await expect(
      publishModes({ version: VERSION, dryRun: false, outDir: join(root, "out"), modesDir, log: () => {} }),
    ).rejects.toThrow(/ArchiveStore is required/);
  });
});

/**
 * `--only` repairs one archive. The catalog it produces describes one mode,
 * and the package ships the catalog — so a partial run must never be able to
 * hand a release a catalog that pins less than the whole set.
 */
describe("partial runs", () => {
  it("withholds the catalog and names what it did not build", async () => {
    const modesDir = writeFixture();
    addCatalogMode(modesDir, "second", "0.2.0");
    const out = join(root, "out");
    const lines: string[] = [];

    const result = await publishModes({
      version: VERSION,
      dryRun: true,
      outDir: out,
      modesDir,
      builtAt: BUILT_AT,
      only: ["fixture"],
      log: (line) => lines.push(line),
    });

    expect(result.partial).toBe(true);
    expect(result.catalog.modes.map((m) => m.name)).toEqual(["fixture"]);
    // Nothing in the staging dir is allowed to look like the release's pins.
    expect(result.catalogPath).toBe(join(out, "catalog.partial.json"));
    expect(existsSync(join(out, "catalog.json"))).toBe(false);
    expect(lines.join("\n")).toContain("PARTIAL RUN");
    expect(lines.join("\n")).toContain("second");
  });

  it("uploads the repaired archive but never the release catalog", async () => {
    const modesDir = writeFixture();
    addCatalogMode(modesDir, "second", "0.2.0");
    const { store, puts, jsonPuts } = fakeStore();
    const catalogPath = join(root, "shipped-catalog.json");

    const result = await publishModes({
      version: VERSION,
      dryRun: false,
      outDir: join(root, "out"),
      modesDir,
      builtAt: BUILT_AT,
      only: ["fixture"],
      store,
      catalogPath,
      isVersionOnNpm: async () => false,
      log: () => {},
    });

    expect(result.partial).toBe(true);
    expect(result.modes[0]!.upload).toBe("uploaded");
    expect(puts).toEqual([`official/v${VERSION}/fixture-1.2.3.tar.gz`]);
    expect(jsonPuts).toEqual([]);
    expect(existsSync(catalogPath)).toBe(false);
  });

  it("is a full run when --only happens to name every catalog mode", async () => {
    const modesDir = writeFixture();
    addCatalogMode(modesDir, "second", "0.2.0");
    const { store, jsonPuts } = fakeStore();

    const result = await publishModes({
      version: VERSION,
      dryRun: false,
      outDir: join(root, "out"),
      modesDir,
      builtAt: BUILT_AT,
      only: ["second", "fixture"],
      store,
      catalogPath: join(root, "shipped-catalog.json"),
      isVersionOnNpm: async () => false,
      log: () => {},
    });

    expect(result.partial).toBe(false);
    expect(result.catalog.modes.map((m) => m.name)).toEqual(["fixture", "second"]);
    expect(jsonPuts.map((p) => p.key)).toEqual([`official/v${VERSION}/catalog.json`]);
    expect(existsSync(join(root, "shipped-catalog.json"))).toBe(true);
  });
});

/**
 * The overwrite rule only consults npm once something is already at a key, so
 * "I could not read it" must never arrive at the planner as "there is nothing
 * there".
 */
describe("store reads are three-valued", () => {
  let cdn: ReturnType<typeof Bun.serve>;
  let respond: (req: Request) => Response;

  beforeEach(() => {
    respond = () => new Response("archive bytes", { status: 200 });
    cdn = Bun.serve({ port: 0, fetch: (req) => respond(req) });
  });
  afterEach(() => cdn.stop(true));

  function storeAt(exists: boolean): ArchiveStore {
    return createPublicReadStore({
      publicUrl: cdn.url.origin,
      keyExists: async () => exists,
      putFile: async (key) => key,
      putJson: async (key) => key,
    });
  }

  it("answers null only when the bucket says the key is absent", async () => {
    expect(await storeAt(false).readSha256("official/v9.9.9/gone.tar.gz")).toBeNull();
    expect(await storeAt(false).readJson("official/v9.9.9/catalog.json")).toBeNull();
  });

  it("hashes the public copy when it reads cleanly", async () => {
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update("archive bytes");
    expect(await storeAt(true).readSha256("official/v9.9.9/fixture-1.2.3.tar.gz")).toBe(hasher.digest("hex"));
  });

  it("raises instead of calling a present-but-unreadable archive absent", async () => {
    respond = () => new Response("upstream is having a moment", { status: 503 });
    await expect(storeAt(true).readSha256("official/v9.9.9/fixture-1.2.3.tar.gz")).rejects.toBeInstanceOf(
      ArchiveUnreadableError,
    );
  });

  it("raises instead of calling an unparseable catalog absent", async () => {
    respond = () => new Response("<html>nope</html>", { status: 200 });
    await expect(storeAt(true).readJson("official/v9.9.9/catalog.json")).rejects.toThrow(/not readable JSON/);
  });

  it("raises when the public copy cannot be reached at all", async () => {
    const store = createPublicReadStore({
      publicUrl: "http://127.0.0.1:1",
      keyExists: async () => true,
      putFile: async (key) => key,
      putJson: async (key) => key,
      timeoutMs: 2000,
    });
    await expect(store.readSha256("official/v9.9.9/fixture-1.2.3.tar.gz")).rejects.toThrow(/could not be read/);
  });

  it("stops the run rather than overwriting a key it could not read", async () => {
    const modesDir = writeFixture();
    const { store, puts, jsonPuts } = fakeStore({
      readSha256: async () => {
        throw new ArchiveUnreadableError("cdn read failed");
      },
    });

    await expect(
      publishModes({
        version: VERSION,
        dryRun: false,
        outDir: join(root, "out"),
        modesDir,
        builtAt: BUILT_AT,
        store,
        catalogPath: join(root, "shipped-catalog.json"),
        isVersionOnNpm: async () => true,
        log: () => {},
      }),
    ).rejects.toThrow(/cdn read failed/);
    expect(puts).toEqual([]);
    expect(jsonPuts).toEqual([]);
  });
});

describe("catalogsEquivalent", () => {
  it("ignores generatedAt and nothing else", () => {
    const base: ModeCatalog = {
      formatVersion: 1,
      coreVersion: "1.0.0",
      generatedAt: "2026-01-01T00:00:00.000Z",
      modes: [],
    };
    expect(catalogsEquivalent(base, { ...base, generatedAt: "2026-02-02T00:00:00.000Z" })).toBe(true);
    expect(catalogsEquivalent(base, { ...base, coreVersion: "1.0.1" })).toBe(false);
  });
});

describe("parseArgs", () => {
  it("reads the release flags", () => {
    expect(parseArgs(["--version", "3.52.0", "--dry-run", "--out", "/tmp/x", "--only", "doc, draw"])).toEqual({
      version: "3.52.0",
      dryRun: true,
      out: "/tmp/x",
      only: ["doc", "draw"],
    });
  });

  it("stops on an unknown flag instead of publishing something unintended", () => {
    expect(() => parseArgs(["--versoin", "3.52.0"])).toThrow(/unknown argument/);
    expect(() => parseArgs(["--version"])).toThrow(/needs a value/);
  });
});

function treeSize(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) total += treeSize(path);
    else if (entry.isFile()) total += statSync(path).size;
  }
  return total;
}

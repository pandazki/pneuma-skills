/**
 * Catalog install tests — against a real HTTP server and real tar archives.
 *
 * The thing under test is a state machine over the filesystem and the
 * network, so mocking either would only pin the mock: every case below
 * downloads real bytes from a local `Bun.serve` into a throwaway home and
 * then inspects what is (and is not) on disk.
 *
 * The invariants:
 *  - the install record is written LAST, so an interrupted install is
 *    re-fetched rather than run;
 *  - a bad archive (wrong sha, wrong size, 404, cancelled, unreadable)
 *    leaves nothing behind and says which of those happened;
 *  - `stale` is decided by comparing the record's sha with the catalog's,
 *    which is how a core upgrade forces a re-download;
 *  - in a repo checkout the in-tree source wins and nothing hits the
 *    network.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  catalogInstallRoot,
  catalogRoot,
  ensureCatalogMode,
  formatInstallSize,
  installCatalogMode,
  installState,
  isBundledMode,
  isCatalogMode,
  listCatalogModeNames,
  ModeInstallError,
  readInstallRecord,
  readModeCatalog,
  resolveCatalogMode,
} from "../mode-catalog.js";
import {
  MODE_CATALOG_FORMAT,
  MODE_INSTALL_RECORD,
  MODE_PACKAGE_STAMP,
  type ModeCatalog,
} from "../types/mode-catalog.js";
import { buildModeArchive, sha256Hex } from "./fixtures/catalog-archive.js";

const CORE_VERSION = "9.9.9";
const MODE_NAME = "demo";
const MODE_VERSION = "0.4.2";

// ── Fixture server ───────────────────────────────────────────────────────────

/** Archive bytes served at `/official/v9.9.9/demo-0.4.2.tar.gz`. */
let archive: Uint8Array<ArrayBuffer>;
/** A second, differently-built archive — stands in for the next release. */
let archiveV2: Uint8Array<ArrayBuffer>;
/** Same mode, packed without the `modes/<name>/` prefix. */
let archiveFlat: Uint8Array<ArrayBuffer>;
/** Same mode, packed without its `pneuma-package.json` stamp. */
let archiveUnstamped: Uint8Array<ArrayBuffer>;
let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;
let hits: Record<string, number>;

/** Bind the shared fixture builder to this file's mode. */
function buildArchive(opts: {
  layout: "nested" | "flat";
  version?: string;
  marker?: string;
  stamp?: Record<string, unknown> | null;
}): Uint8Array<ArrayBuffer> {
  return buildModeArchive({
    name: MODE_NAME,
    version: opts.version ?? MODE_VERSION,
    coreVersion: CORE_VERSION,
    layout: opts.layout,
    ...(opts.marker ? { marker: opts.marker } : {}),
    ...(opts.stamp !== undefined ? { stamp: opts.stamp } : {}),
  });
}

/** A response whose body is exactly these bytes, with a content-length. */
function serveBytes(bytes: Uint8Array<ArrayBuffer>): Response {
  return new Response(new Blob([bytes]));
}

const sha256 = sha256Hex;

beforeAll(() => {
  archive = buildArchive({ layout: "nested", marker: "v1" });
  archiveV2 = buildArchive({ layout: "nested", marker: "v2" });
  archiveFlat = buildArchive({ layout: "flat", marker: "flat" });
  archiveUnstamped = buildArchive({ layout: "nested", marker: "v1", stamp: null });
  hits = {};

  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      hits[url.pathname] = (hits[url.pathname] ?? 0) + 1;

      // The archive this release pins.
      if (url.pathname === "/ok.tar.gz") {
        return serveBytes(archive);
      }
      // Same URL, different bytes — the "next release" case.
      if (url.pathname === "/v2.tar.gz") {
        return serveBytes(archiveV2);
      }
      // A flat archive (no `modes/<name>/` prefix).
      if (url.pathname === "/flat.tar.gz") {
        return serveBytes(archiveFlat);
      }
      // An archive with no package stamp.
      if (url.pathname === "/unstamped.tar.gz") {
        return serveBytes(archiveUnstamped);
      }
      // Bytes that are not the archive the catalog pins.
      if (url.pathname === "/tampered.tar.gz") {
        const tampered = new Uint8Array(archive);
        tampered[tampered.length - 1] ^= 0xff;
        return new Response(tampered);
      }
      // Fewer bytes than the catalog declares, streamed without a
      // content-length so only the post-download check can catch it.
      if (url.pathname === "/truncated.tar.gz") {
        const half = archive.slice(0, Math.floor(archive.length / 2));
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(half);
            controller.close();
          },
        });
        return new Response(stream, { headers: { "content-type": "application/gzip" } });
      }
      // Never finishes: one chunk, then silence, so a caller can cancel.
      if (url.pathname === "/slow.tar.gz") {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(archive.slice(0, 64));
            // Deliberately never closed.
          },
        });
        return new Response(stream);
      }
      // Not a gzip stream at all.
      if (url.pathname === "/garbage.tar.gz") {
        return new Response(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
      }
      return new Response("not found", { status: 404 });
    },
  });
  baseUrl = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server.stop(true);
});

// ── Fixture package root + home ──────────────────────────────────────────────

let projectRoot: string;
let home: string;
let env: { projectRoot: string; home: string };

function writeDistribution(bundled: string[]): void {
  writeFileSync(
    join(projectRoot, "modes", "distribution.json"),
    JSON.stringify({ bundled }, null, 2),
  );
}

function writeCatalog(opts?: {
  path?: string;
  bytes?: Uint8Array<ArrayBuffer>;
  size?: number;
  sha256?: string;
  version?: string;
}): ModeCatalog {
  const bytes = opts?.bytes ?? archive;
  const catalog: ModeCatalog = {
    formatVersion: MODE_CATALOG_FORMAT,
    coreVersion: CORE_VERSION,
    generatedAt: new Date().toISOString(),
    modes: [
      {
        name: MODE_NAME,
        version: opts?.version ?? MODE_VERSION,
        displayName: { en: "Demo" },
        description: { en: "A fixture mode" },
        archive: {
          url: `${baseUrl}${opts?.path ?? "/ok.tar.gz"}`,
          size: opts?.size ?? bytes.length,
          sha256: opts?.sha256 ?? sha256(bytes),
        },
        unpackedSize: bytes.length * 3,
      },
    ],
  };
  writeFileSync(
    join(projectRoot, "modes", "catalog.json"),
    JSON.stringify(catalog, null, 2),
  );
  return catalog;
}

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "pneuma-catalog-pkg-"));
  home = mkdtempSync(join(tmpdir(), "pneuma-catalog-home-"));
  env = { projectRoot, home };
  mkdirSync(join(projectRoot, "modes"), { recursive: true });
  writeDistribution(["_shared", "slide"]);
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

/** Nothing half-installed, and no temp files left in the catalog root. */
function expectNothingLeftBehind(): void {
  expect(existsSync(catalogInstallRoot(MODE_NAME, env))).toBe(false);
  const leftovers = existsSync(catalogRoot(env)) ? readdirSync(catalogRoot(env)) : [];
  expect(leftovers).toEqual([]);
}

async function expectInstallError(
  promise: Promise<unknown>,
): Promise<ModeInstallError> {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(ModeInstallError);
  return caught as ModeInstallError;
}

// ── Membership ───────────────────────────────────────────────────────────────

describe("catalog membership", () => {
  test("bundled names come from distribution.json, catalog names from the catalog", () => {
    writeCatalog();
    expect(isBundledMode("slide", env)).toBe(true);
    expect(isBundledMode(MODE_NAME, env)).toBe(false);
    expect(isCatalogMode(MODE_NAME, env)).toBe(true);
    expect(isCatalogMode("slide", env)).toBe(false);
    expect(listCatalogModeNames(env)).toEqual([MODE_NAME]);
  });

  test("a repo checkout has no catalog file and derives membership from the tree", () => {
    // No catalog.json — exactly what a checkout looks like.
    mkdirSync(join(projectRoot, "modes", "in-tree-only"), { recursive: true });
    writeFileSync(join(projectRoot, "modes", "in-tree-only", "manifest.ts"), "export default {};");
    expect(readModeCatalog(env)).toBeNull();
    expect(listCatalogModeNames(env)).toEqual(["in-tree-only"]);
    expect(isCatalogMode("in-tree-only", env)).toBe(true);
    // `modes/<name>/showcase` without a manifest is what a released package
    // keeps for a catalog mode; it is not a mode directory.
    mkdirSync(join(projectRoot, "modes", "showcase-only", "showcase"), { recursive: true });
    expect(isCatalogMode("showcase-only", env)).toBe(false);
  });

  test("a name that could escape the modes directory is never a mode", () => {
    expect(isCatalogMode("../evil", env)).toBe(false);
    expect(isCatalogMode("", env)).toBe(false);
  });
});

// ── Happy path ───────────────────────────────────────────────────────────────

describe("install", () => {
  test("downloads, verifies, extracts and records — in that order", async () => {
    const catalog = writeCatalog();
    const seen: Array<{ received: number; total: number }> = [];

    const resolved = await ensureCatalogMode(MODE_NAME, {
      ...env,
      onProgress: (p) => seen.push(p),
    });

    expect(resolved.source).toBe("installed");
    expect(resolved.modeDir).toBe(join(catalogInstallRoot(MODE_NAME, env), "modes", MODE_NAME));
    // Package-relative seed keys (`modes/demo/seed/README.md`) must resolve
    // against the install root exactly as they do against the package root.
    expect(resolved.seedBase).toBe(catalogInstallRoot(MODE_NAME, env));
    expect(existsSync(join(resolved.seedBase, "modes", MODE_NAME, "seed", "README.md"))).toBe(true);
    expect(readFileSync(join(resolved.modeDir, "marker.txt"), "utf-8")).toBe("v1");

    // Progress is reported against the catalog's size, not the response's.
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.at(-1)!.received).toBe(catalog.modes[0]!.archive.size);
    expect(seen.at(-1)!.total).toBe(catalog.modes[0]!.archive.size);

    const record = readInstallRecord(MODE_NAME, env);
    expect(record).toEqual({
      name: MODE_NAME,
      version: MODE_VERSION,
      coreVersion: CORE_VERSION,
      sha256: catalog.modes[0]!.archive.sha256,
      installedAt: record!.installedAt,
    });
    expect(installState(MODE_NAME, env)).toBe("installed");
    // The record lives beside the mode tree, not inside it.
    expect(existsSync(join(catalogInstallRoot(MODE_NAME, env), MODE_INSTALL_RECORD))).toBe(true);
  });

  test("a second launch of an installed mode does not hit the network", async () => {
    writeCatalog();
    await ensureCatalogMode(MODE_NAME, env);
    const before = hits["/ok.tar.gz"] ?? 0;
    const again = await ensureCatalogMode(MODE_NAME, env);
    expect(hits["/ok.tar.gz"] ?? 0).toBe(before);
    expect(again.source).toBe("installed");
  });

  test("normalizes a flat archive into the modes/<name>/ layout", async () => {
    writeCatalog({ path: "/flat.tar.gz", bytes: archiveFlat });
    const resolved = await ensureCatalogMode(MODE_NAME, env);
    expect(resolved.modeDir).toBe(join(catalogInstallRoot(MODE_NAME, env), "modes", MODE_NAME));
    expect(readFileSync(join(resolved.modeDir, "marker.txt"), "utf-8")).toBe("flat");
    expect(resolved.seedBase).toBe(catalogInstallRoot(MODE_NAME, env));
  });
});

// ── Failure modes ────────────────────────────────────────────────────────────

describe("install failures", () => {
  test("a checksum mismatch is rejected and nothing is left behind", async () => {
    writeCatalog({ path: "/tampered.tar.gz" });
    const err = await expectInstallError(installCatalogMode(MODE_NAME, env));
    expect(err.code).toBe("checksum-mismatch");
    expect(err.message).toContain("SHA-256");
    expect(err.url).toContain("/tampered.tar.gz");
    expectNothingLeftBehind();
    expect(installState(MODE_NAME, env)).toBe("not-installed");
  });

  test("a truncated download is rejected by size", async () => {
    writeCatalog({ path: "/truncated.tar.gz" });
    const err = await expectInstallError(installCatalogMode(MODE_NAME, env));
    expect(err.code).toBe("size-mismatch");
    expect(err.message).toContain("truncated");
    expectNothingLeftBehind();
  });

  test("a size the CDN declares differently is rejected before the body", async () => {
    // Same archive, but the catalog pins a size the response contradicts.
    writeCatalog({ size: archive.length + 4096 });
    const err = await expectInstallError(installCatalogMode(MODE_NAME, env));
    expect(err.code).toBe("size-mismatch");
    expectNothingLeftBehind();
  });

  test("a missing archive reports the status and the URL", async () => {
    writeCatalog({ path: "/gone.tar.gz" });
    const err = await expectInstallError(installCatalogMode(MODE_NAME, env));
    expect(err.code).toBe("http");
    expect(err.message).toContain("404");
    expect(err.message).toContain(MODE_NAME);
    expectNothingLeftBehind();
  });

  test("an aborted download stops and cleans up", async () => {
    writeCatalog({ path: "/slow.tar.gz" });
    const controller = new AbortController();
    const err = await expectInstallError(
      installCatalogMode(MODE_NAME, {
        ...env,
        signal: controller.signal,
        onProgress: () => controller.abort(),
      }),
    );
    expect(err.code).toBe("aborted");
    expectNothingLeftBehind();
  });

  test("an unreadable archive reports the extract failure", async () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    writeCatalog({ path: "/garbage.tar.gz", bytes: garbage });
    const err = await expectInstallError(installCatalogMode(MODE_NAME, env));
    expect(err.code).toBe("extract-failed");
    expectNothingLeftBehind();
  });

  test("an archive without the package stamp is refused", async () => {
    writeCatalog({ path: "/unstamped.tar.gz", bytes: archiveUnstamped });
    const err = await expectInstallError(installCatalogMode(MODE_NAME, env));
    expect(err.code).toBe("invalid-archive");
    expect(err.message).toContain(MODE_PACKAGE_STAMP);
    expectNothingLeftBehind();
  });

  test("a mode the release does not publish is named as such", async () => {
    writeCatalog();
    const err = await expectInstallError(installCatalogMode("nosuch", env));
    expect(err.code).toBe("unknown-mode");
    expect(err.message).toContain("catalog");
  });

  test("with no catalog at all the error says a checkout runs from source", async () => {
    const err = await expectInstallError(installCatalogMode(MODE_NAME, env));
    expect(err.code).toBe("unknown-mode");
    expect(err.message).toContain("modes/<name>/");
  });
});

// ── Staleness and interruption ───────────────────────────────────────────────

describe("install state", () => {
  test("a catalog whose sha changed makes the install stale, and re-installs", async () => {
    writeCatalog();
    await ensureCatalogMode(MODE_NAME, env);
    expect(installState(MODE_NAME, env)).toBe("installed");
    expect(readFileSync(join(catalogInstallRoot(MODE_NAME, env), "modes", MODE_NAME, "marker.txt"), "utf-8")).toBe("v1");

    // The core was upgraded: same mode, a bundle built by the new release.
    writeCatalog({ path: "/v2.tar.gz", bytes: archiveV2 });
    expect(installState(MODE_NAME, env)).toBe("stale");

    const resolved = await ensureCatalogMode(MODE_NAME, env);
    expect(installState(MODE_NAME, env)).toBe("installed");
    expect(readFileSync(join(resolved.modeDir, "marker.txt"), "utf-8")).toBe("v2");
    expect(readInstallRecord(MODE_NAME, env)!.sha256).toBe(sha256(archiveV2));
  });

  test("an install interrupted before its record is incomplete and is re-fetched", async () => {
    writeCatalog();
    await ensureCatalogMode(MODE_NAME, env);
    const root = catalogInstallRoot(MODE_NAME, env);

    // Exactly the state a crash between the rename and the record leaves:
    // a full tree, no record. Plus a file the re-fetch must not preserve.
    rmSync(join(root, MODE_INSTALL_RECORD));
    writeFileSync(join(root, "leftover.txt"), "from the interrupted attempt");
    expect(installState(MODE_NAME, env)).toBe("not-installed");
    expect(resolveCatalogMode(MODE_NAME, env)).toBeNull();

    const before = hits["/ok.tar.gz"] ?? 0;
    await ensureCatalogMode(MODE_NAME, env);
    expect(hits["/ok.tar.gz"] ?? 0).toBe(before + 1);
    expect(existsSync(join(root, "leftover.txt"))).toBe(false);
    expect(installState(MODE_NAME, env)).toBe("installed");
  });

  test("a failed re-install of a stale mode does not leave the stale copy runnable", async () => {
    writeCatalog();
    await ensureCatalogMode(MODE_NAME, env);
    // New release, but the archive is missing from the CDN.
    writeCatalog({ path: "/gone.tar.gz", bytes: archiveV2 });
    expect(installState(MODE_NAME, env)).toBe("stale");

    const err = await expectInstallError(ensureCatalogMode(MODE_NAME, env));
    expect(err.code).toBe("http");
    // The old tree is still on disk (we do not delete before we have the
    // replacement), but it reports stale — the launch path refuses to run a
    // bundle built by another core rather than silently using it.
    expect(installState(MODE_NAME, env)).toBe("stale");
  });
});

// ── Repo checkout ────────────────────────────────────────────────────────────

describe("in-tree resolution", () => {
  test("source in the package wins over the catalog and needs no network", async () => {
    writeCatalog();
    const inTree = join(projectRoot, "modes", MODE_NAME);
    mkdirSync(inTree, { recursive: true });
    writeFileSync(join(inTree, "manifest.ts"), "export default {};");

    const before = hits["/ok.tar.gz"] ?? 0;
    const resolved = await ensureCatalogMode(MODE_NAME, env);
    expect(hits["/ok.tar.gz"] ?? 0).toBe(before);
    expect(resolved.source).toBe("in-tree");
    expect(resolved.modeDir).toBe(inTree);
    // Package-relative seed keys resolve against the package root.
    expect(resolved.seedBase).toBe(projectRoot);
    expect(installState(MODE_NAME, env)).toBe("installed");
    expect(existsSync(catalogInstallRoot(MODE_NAME, env))).toBe(false);
  });

  test("in-tree source wins even when an install is present", async () => {
    writeCatalog();
    await ensureCatalogMode(MODE_NAME, env);
    const inTree = join(projectRoot, "modes", MODE_NAME);
    mkdirSync(inTree, { recursive: true });
    writeFileSync(join(inTree, "manifest.ts"), "export default {};");
    expect(resolveCatalogMode(MODE_NAME, env)!.source).toBe("in-tree");
  });
});

describe("formatInstallSize", () => {
  test("reads as a download size", () => {
    expect(formatInstallSize(6_391_234)).toBe("6.1 MB");
    expect(formatInstallSize(19_900_000)).toBe("19 MB");
    expect(formatInstallSize(140_000)).toBe("137 KB");
    expect(formatInstallSize(0)).toBe("0 MB");
  });
});

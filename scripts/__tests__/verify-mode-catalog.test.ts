/**
 * The release job runs `scripts/verify-mode-catalog.ts` before `npm publish`.
 * Its whole job is to turn "this release's modes are not really out there" from
 * a bug a user discovers into a failed release step — both halves of it: the
 * archives the catalog pins have to exist, and the catalog has to pin every
 * catalog mode of the checkout being published. So these tests drive it against
 * a fixture checkout and a real HTTP server that answers correctly, wrongly,
 * and not at all.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ModeCatalog } from "../../core/types/mode-catalog.js";
import { catalogCoverage, catalogUrl, main, verifyCatalog } from "../verify-mode-catalog.js";

const ARCHIVE_BYTES = 4096;
const VERSION = "9.9.9";

let server: ReturnType<typeof Bun.serve>;
let root: string;
let modesDir: string;
/** Bytes the fixture server claims for each archive, keyed by mode name. */
let served: Map<string, number>;

function catalogFor(origin: string, entries: Array<{ name: string; size: number; version?: string }>): ModeCatalog {
  return {
    formatVersion: 1,
    coreVersion: VERSION,
    generatedAt: "2026-09-23T00:00:00.000Z",
    modes: entries.map((e) => ({
      name: e.name,
      version: e.version ?? "1.0.0",
      displayName: `Mode ${e.name}`,
      archive: { url: `${origin}/official/v${VERSION}/${e.name}-1.0.0.tar.gz`, size: e.size, sha256: "0".repeat(64) },
      unpackedSize: e.size * 4,
    })),
  };
}

/**
 * A miniature checkout: the catalog set the gate compares against is every
 * mode directory `distribution.json` does not bundle.
 */
function writeCheckout(catalogModes: Array<{ name: string; version?: string }>, bundled: string[] = []): void {
  rmSync(modesDir, { recursive: true, force: true });
  mkdirSync(modesDir, { recursive: true });
  writeFileSync(join(modesDir, "distribution.json"), JSON.stringify({ bundled }, null, 2));
  for (const name of [...catalogModes.map((m) => m.name), ...bundled]) {
    mkdirSync(join(modesDir, name), { recursive: true });
    const version = catalogModes.find((m) => m.name === name)?.version ?? "1.0.0";
    writeFileSync(
      join(modesDir, name, "manifest.ts"),
      [
        "export const manifest = {",
        `  name: "${name}",`,
        `  version: "${version}",`,
        `  displayName: { en: "Mode ${name}" },`,
        "};",
        "export default manifest;",
        "",
      ].join("\n"),
    );
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "verify-catalog-"));
  modesDir = join(root, "modes");
  writeCheckout([{ name: "present" }]);
  served = new Map([["present", ARCHIVE_BYTES]]);
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      const match = /\/official\/v[^/]+\/(.+)-1\.0\.0\.tar\.gz$/.exec(url.pathname);
      const size = match ? served.get(match[1]!) : undefined;
      if (size === undefined) return new Response("not found", { status: 404 });
      // HEAD answers must carry the length explicitly — it is the only thing
      // the gate can compare against the pin.
      return new Response(null, { status: 200, headers: { "content-length": String(size) } });
    },
  });
});

afterEach(() => {
  server.stop(true);
  rmSync(root, { recursive: true, force: true });
});

describe("verifyCatalog", () => {
  it("accepts an archive whose length matches the pin", async () => {
    const verdicts = await verifyCatalog(catalogFor(server.url.origin, [{ name: "present", size: ARCHIVE_BYTES }]));
    expect(verdicts).toEqual([
      { name: "present", url: `${server.url.origin}/official/v${VERSION}/present-1.0.0.tar.gz`, ok: true, detail: "ok" },
    ]);
  });

  it("fails on a size mismatch and says both numbers", async () => {
    const verdicts = await verifyCatalog(catalogFor(server.url.origin, [{ name: "present", size: ARCHIVE_BYTES - 1 }]));
    expect(verdicts[0]!.ok).toBe(false);
    expect(verdicts[0]!.detail).toBe(`size ${ARCHIVE_BYTES} B, catalog pins ${ARCHIVE_BYTES - 1} B`);
  });

  it("fails on an archive that was never uploaded", async () => {
    const verdicts = await verifyCatalog(catalogFor(server.url.origin, [{ name: "missing", size: ARCHIVE_BYTES }]));
    expect(verdicts[0]!).toMatchObject({ name: "missing", ok: false, detail: "HTTP 404" });
  });

  it("reports an unreachable host instead of passing it", async () => {
    const offline = catalogFor("http://127.0.0.1:1", [{ name: "present", size: ARCHIVE_BYTES }]);
    const verdicts = await verifyCatalog(offline, { timeoutMs: 2000 });
    expect(verdicts[0]!.ok).toBe(false);
    expect(verdicts[0]!.detail).toStartWith("unreachable:");
  });
});

/**
 * Every URL in a truncated catalog resolves, so HEAD checks alone report a
 * clean release. The set is what has to be compared.
 */
describe("catalogCoverage", () => {
  it("passes a catalog that describes the checkout exactly", () => {
    writeCheckout([{ name: "present" }, { name: "second" }], ["bundled-one"]);
    const catalog = catalogFor(server.url.origin, [{ name: "present", size: 1 }, { name: "second", size: 1 }]);
    expect(catalogCoverage(catalog, modesDir)).toEqual([]);
  });

  it("names the catalog modes a partial publish left out", () => {
    writeCheckout([{ name: "present" }, { name: "second" }]);
    const catalog = catalogFor(server.url.origin, [{ name: "present", size: 1 }]);
    expect(catalogCoverage(catalog, modesDir)).toEqual(["second: a catalog mode of this checkout, missing from the catalog"]);
  });

  it("catches a pin left behind by an older mode version", () => {
    writeCheckout([{ name: "present", version: "1.1.0" }]);
    const catalog = catalogFor(server.url.origin, [{ name: "present", size: 1, version: "1.0.0" }]);
    expect(catalogCoverage(catalog, modesDir)).toEqual([
      "present: catalog pins 1.0.0, this checkout's manifest says 1.1.0",
    ]);
  });

  it("catches an entry for something this checkout does not publish", () => {
    writeCheckout([{ name: "present" }], ["bundled-one"]);
    const catalog = catalogFor(server.url.origin, [{ name: "present", size: 1 }, { name: "bundled-one", size: 1 }]);
    expect(catalogCoverage(catalog, modesDir)).toEqual([
      "bundled-one: listed in the catalog but not a catalog mode of this checkout",
    ]);
  });
});

describe("main", () => {
  function writeCatalog(catalog: ModeCatalog): string {
    const path = join(root, "catalog.json");
    writeFileSync(path, JSON.stringify(catalog, null, 2));
    return path;
  }

  /** Always against the fixture checkout, never the repository's own modes. */
  function verify(args: string[]): Promise<number> {
    return main([...args, "--modes-dir", modesDir]);
  }

  it("exits 0 when every pinned archive is there", async () => {
    const path = writeCatalog(catalogFor(server.url.origin, [{ name: "present", size: ARCHIVE_BYTES }]));
    expect(await verify(["--catalog", path, "--version", VERSION])).toBe(0);
  });

  it("exits 1 when a pinned archive is a different size", async () => {
    const path = writeCatalog(catalogFor(server.url.origin, [{ name: "present", size: 1 }]));
    expect(await verify(["--catalog", path, "--version", VERSION])).toBe(1);
  });

  it("exits 1 when the catalog was built for another core release", async () => {
    const catalog = catalogFor(server.url.origin, [{ name: "present", size: ARCHIVE_BYTES }]);
    const path = writeCatalog({ ...catalog, coreVersion: "1.0.0" });
    expect(await verify(["--catalog", path, "--version", VERSION])).toBe(1);
  });

  it("exits 1 when the catalog was never generated", async () => {
    expect(await verify(["--catalog", join(root, "absent.json"), "--version", VERSION])).toBe(1);
  });

  it("exits 1 on an empty catalog rather than reporting nothing to check", async () => {
    const path = writeCatalog(catalogFor(server.url.origin, []));
    expect(await verify(["--catalog", path, "--version", VERSION])).toBe(1);
  });

  it("exits 1 on a catalog that pins one mode of a release that has two", async () => {
    // What `publish:modes --only present` used to be able to leave behind: a
    // well-formed catalog whose single archive is genuinely on the CDN.
    writeCheckout([{ name: "present" }, { name: "second" }]);
    served.set("second", ARCHIVE_BYTES);
    const path = writeCatalog(catalogFor(server.url.origin, [{ name: "present", size: ARCHIVE_BYTES }]));
    expect(await verify(["--catalog", path, "--version", VERSION])).toBe(1);
  });

  it("exits 1 when the catalog pins a mode version this checkout no longer has", async () => {
    writeCheckout([{ name: "present", version: "2.0.0" }]);
    const path = writeCatalog(catalogFor(server.url.origin, [{ name: "present", size: ARCHIVE_BYTES }]));
    expect(await verify(["--catalog", path, "--version", VERSION])).toBe(1);
  });

  it("exits 1 when the checkout's catalog set cannot be read at all", async () => {
    const path = writeCatalog(catalogFor(server.url.origin, [{ name: "present", size: ARCHIVE_BYTES }]));
    rmSync(join(modesDir, "distribution.json"));
    expect(await verify(["--catalog", path, "--version", VERSION])).toBe(1);
  });

  it("--fetch installs the published catalog and then verifies it", async () => {
    const catalog = catalogFor(server.url.origin, [{ name: "present", size: ARCHIVE_BYTES }]);
    const path = join(root, "catalog.json");
    const withCatalogRoute = Bun.serve({
      port: 0,
      fetch: (req) =>
        new URL(req.url).pathname.endsWith("/catalog.json")
          ? Response.json(catalog)
          : new Response(null, { status: 200, headers: { "content-length": String(ARCHIVE_BYTES) } }),
    });
    try {
      const code = await verify(["--catalog", path, "--version", VERSION, "--base-url", withCatalogRoute.url.origin, "--fetch"]);
      expect(code).toBe(0);
      expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual(catalog);
    } finally {
      withCatalogRoute.stop(true);
    }
  });

  it("--fetch exits 1 when the release's modes were never published", async () => {
    const notFound = Bun.serve({ port: 0, fetch: () => new Response("no such key", { status: 404 }) });
    try {
      const code = await verify([
        "--catalog", join(root, "catalog.json"),
        "--version", VERSION,
        "--base-url", notFound.url.origin,
        "--fetch",
      ]);
      expect(code).toBe(1);
    } finally {
      notFound.stop(true);
    }
  });

  it("builds the catalog URL under the release's own prefix", () => {
    expect(catalogUrl("https://cdn.test/", "3.52.0")).toBe("https://cdn.test/official/v3.52.0/catalog.json");
  });

  it("exits 2 on an unknown flag instead of silently verifying nothing", async () => {
    expect(await main(["--catalouge", "x"])).toBe(2);
  });
});

/**
 * The release job runs `scripts/verify-mode-catalog.ts` before `npm publish`.
 * Its whole job is to turn "the archives never reached the CDN" from a bug a
 * user discovers into a failed release step, so these tests drive it against a
 * real HTTP server that answers correctly, wrongly, and not at all.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ModeCatalog } from "../../core/types/mode-catalog.js";
import { catalogUrl, main, verifyCatalog } from "../verify-mode-catalog.js";

const ARCHIVE_BYTES = 4096;
const VERSION = "9.9.9";

let server: ReturnType<typeof Bun.serve>;
let root: string;
/** Bytes the fixture server claims for each archive, keyed by mode name. */
let served: Map<string, number>;

function catalogFor(origin: string, entries: Array<{ name: string; size: number }>): ModeCatalog {
  return {
    formatVersion: 1,
    coreVersion: VERSION,
    generatedAt: "2026-09-23T00:00:00.000Z",
    modes: entries.map((e) => ({
      name: e.name,
      version: "1.0.0",
      displayName: `Mode ${e.name}`,
      archive: { url: `${origin}/official/v${VERSION}/${e.name}-1.0.0.tar.gz`, size: e.size, sha256: "0".repeat(64) },
      unpackedSize: e.size * 4,
    })),
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "verify-catalog-"));
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

describe("main", () => {
  function writeCatalog(catalog: ModeCatalog): string {
    const path = join(root, "catalog.json");
    writeFileSync(path, JSON.stringify(catalog, null, 2));
    return path;
  }

  it("exits 0 when every pinned archive is there", async () => {
    const path = writeCatalog(catalogFor(server.url.origin, [{ name: "present", size: ARCHIVE_BYTES }]));
    expect(await main(["--catalog", path, "--version", VERSION])).toBe(0);
  });

  it("exits 1 when a pinned archive is a different size", async () => {
    const path = writeCatalog(catalogFor(server.url.origin, [{ name: "present", size: 1 }]));
    expect(await main(["--catalog", path, "--version", VERSION])).toBe(1);
  });

  it("exits 1 when the catalog was built for another core release", async () => {
    const catalog = catalogFor(server.url.origin, [{ name: "present", size: ARCHIVE_BYTES }]);
    const path = writeCatalog({ ...catalog, coreVersion: "1.0.0" });
    expect(await main(["--catalog", path, "--version", VERSION])).toBe(1);
  });

  it("exits 1 when the catalog was never generated", async () => {
    expect(await main(["--catalog", join(root, "absent.json"), "--version", VERSION])).toBe(1);
  });

  it("exits 1 on an empty catalog rather than reporting nothing to check", async () => {
    const path = writeCatalog(catalogFor(server.url.origin, []));
    expect(await main(["--catalog", path, "--version", VERSION])).toBe(1);
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
      const code = await main(["--catalog", path, "--version", VERSION, "--base-url", withCatalogRoute.url.origin, "--fetch"]);
      expect(code).toBe(0);
      expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual(catalog);
    } finally {
      withCatalogRoute.stop(true);
    }
  });

  it("--fetch exits 1 when the release's modes were never published", async () => {
    const notFound = Bun.serve({ port: 0, fetch: () => new Response("no such key", { status: 404 }) });
    try {
      const code = await main([
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

/**
 * `/api/catalog` + `/api/catalog/install` route contract.
 *
 * The launcher reads these shapes directly, so the test asserts the wire
 * format — the entry fields, the install state per entry, and the
 * newline-delimited `progress` / `done` / `error` events — rather than the
 * installer's internals (those are pinned in
 * `core/__tests__/mode-catalog.test.ts`). Real archive bytes over a real
 * local server, because the failure the launcher has to render is a
 * download failure.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { registerCatalogRoutes, type CatalogRouteResponse } from "../catalog-routes.js";
import { catalogInstallRoot, installState } from "../../core/mode-catalog.js";
import { MODE_CATALOG_FORMAT, type ModeCatalog } from "../../core/types/mode-catalog.js";
import { buildModeArchive, sha256Hex } from "../../core/__tests__/fixtures/catalog-archive.js";

const MODE = "demo";
const MODE_VERSION = "1.2.3";
const CORE_VERSION = "9.9.9";

let archive: Uint8Array<ArrayBuffer>;
let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;
let projectRoot: string;
let home: string;

function writeCatalog(path: string, sha?: string): void {
  const catalog: ModeCatalog = {
    formatVersion: MODE_CATALOG_FORMAT,
    coreVersion: CORE_VERSION,
    generatedAt: "2026-09-22T00:00:00.000Z",
    modes: [
      {
        name: MODE,
        version: MODE_VERSION,
        displayName: { en: "Demo", "zh-CN": "演示" },
        description: { en: "A fixture mode" },
        archive: {
          url: `${baseUrl}${path}`,
          size: archive.length,
          sha256: sha ?? sha256Hex(archive),
        },
        unpackedSize: 4096,
      },
    ],
  };
  writeFileSync(join(projectRoot, "modes", "catalog.json"), JSON.stringify(catalog, null, 2));
}

function makeApp(): Hono {
  const app = new Hono();
  registerCatalogRoutes(app, { projectRoot, home });
  return app;
}

/** Read an NDJSON body into the events it declares. */
async function readEvents(res: Response): Promise<Array<Record<string, unknown>>> {
  const text = await res.text();
  return text
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

beforeAll(() => {
  archive = buildModeArchive({ name: MODE, version: MODE_VERSION, coreVersion: CORE_VERSION });
  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/ok.tar.gz") return new Response(new Blob([archive]));
      return new Response("nope", { status: 404 });
    },
  });
  baseUrl = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server.stop(true);
});

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "pneuma-catalog-route-pkg-"));
  home = mkdtempSync(join(tmpdir(), "pneuma-catalog-route-home-"));
  mkdirSync(join(projectRoot, "modes"), { recursive: true });
  writeFileSync(
    join(projectRoot, "modes", "distribution.json"),
    JSON.stringify({ bundled: ["_shared", "slide"] }),
  );
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

describe("GET /api/catalog", () => {
  test("returns every entry with its install state", async () => {
    writeCatalog("/ok.tar.gz");
    const res = await makeApp().request("/api/catalog");
    expect(res.status).toBe(200);
    const body = (await res.json()) as CatalogRouteResponse;

    expect(body.available).toBe(true);
    expect(body.coreVersion).toBe(CORE_VERSION);
    expect(body.modes).toHaveLength(1);
    const entry = body.modes[0]!;
    expect(entry.name).toBe(MODE);
    expect(entry.version).toBe(MODE_VERSION);
    expect(entry.displayName).toEqual({ en: "Demo", "zh-CN": "演示" });
    expect(entry.archive.size).toBe(archive.length);
    expect(entry.unpackedSize).toBe(4096);
    expect(entry.state).toBe("not-installed");
    expect(entry.inTree).toBe(false);
  });

  test("a repo checkout has no catalog and says so instead of erroring", async () => {
    const res = await makeApp().request("/api/catalog");
    expect(res.status).toBe(200);
    const body = (await res.json()) as CatalogRouteResponse;
    expect(body.available).toBe(false);
    expect(body.modes).toEqual([]);
  });

  test("an installed entry reports installed, and a changed catalog reports stale", async () => {
    writeCatalog("/ok.tar.gz");
    const app = makeApp();
    // The install only completes as the stream is read — reading to the
    // terminal event is the contract, not awaiting the response object.
    const installed = await app.request("/api/catalog/install", {
      method: "POST",
      body: JSON.stringify({ name: MODE }),
      headers: { "content-type": "application/json" },
    });
    expect((await readEvents(installed)).at(-1)!.event).toBe("done");
    let body = (await (await app.request("/api/catalog")).json()) as CatalogRouteResponse;
    expect(body.modes[0]!.state).toBe("installed");

    // The core was upgraded: same mode, a different archive.
    writeCatalog("/ok.tar.gz", "0".repeat(64));
    body = (await (await makeApp().request("/api/catalog")).json()) as CatalogRouteResponse;
    expect(body.modes[0]!.state).toBe("stale");
  });
});

describe("POST /api/catalog/install", () => {
  test("streams progress and ends with done", async () => {
    writeCatalog("/ok.tar.gz");
    const res = await makeApp().request("/api/catalog/install", {
      method: "POST",
      body: JSON.stringify({ name: MODE }),
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");

    const events = await readEvents(res);
    const progress = events.filter((e) => e.event === "progress");
    expect(progress.length).toBeGreaterThan(0);
    for (const p of progress) {
      expect(typeof p.received).toBe("number");
      expect(p.total).toBe(archive.length);
    }
    const terminal = events.at(-1)!;
    expect(terminal.event).toBe("done");
    expect(terminal.version).toBe(MODE_VERSION);
    expect(installState(MODE, { projectRoot, home })).toBe("installed");
  });

  test("a failed download ends with an actionable error event and installs nothing", async () => {
    writeCatalog("/missing.tar.gz");
    const res = await makeApp().request("/api/catalog/install", {
      method: "POST",
      body: JSON.stringify({ name: MODE }),
      headers: { "content-type": "application/json" },
    });
    // The stream has already started, so the failure rides in the body.
    expect(res.status).toBe(200);

    const events = await readEvents(res);
    const terminal = events.at(-1)!;
    expect(terminal.event).toBe("error");
    expect(terminal.code).toBe("http");
    expect(String(terminal.message)).toContain("404");
    expect(String(terminal.url)).toContain("/missing.tar.gz");
    expect(existsSync(catalogInstallRoot(MODE, { projectRoot, home }))).toBe(false);
  });

  test("an unknown mode is an error event, not a crash", async () => {
    writeCatalog("/ok.tar.gz");
    const res = await makeApp().request("/api/catalog/install", {
      method: "POST",
      body: JSON.stringify({ name: "nosuch" }),
      headers: { "content-type": "application/json" },
    });
    const events = await readEvents(res);
    expect(events.at(-1)!.event).toBe("error");
    expect(events.at(-1)!.code).toBe("unknown-mode");
  });

  test("rejects a body without a name", async () => {
    writeCatalog("/ok.tar.gz");
    const res = await makeApp().request("/api/catalog/install", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(400);
  });
});

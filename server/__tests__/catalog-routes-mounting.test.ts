/**
 * `/api/catalog` and `/api/catalog/install` are mounted on BOTH server
 * flavours.
 *
 * The routes were first registered inside the `launcherMode` branch, next to
 * favorites and libraries. But the ProjectPanel's mode picker runs inside a
 * PER-SESSION server and posts to its own origin, so its "download this mode,
 * then open the launch sheet" action reached a route that did not exist: the
 * download could never finish, and the tile sat on an HTTP 404 that the user
 * had no way to read as "wrong server".
 *
 * `/api/registry` already lives on both for the same reason (the per-session
 * mode switcher reads it), and installing into `~/.pneuma/catalog/` is a
 * machine-level operation regardless of which server is asked — so the
 * catalog routes belong wherever the registry does.
 *
 * What this pins is the MOUNTING, not the installer: the wire format and the
 * failure events are `server/__tests__/catalog-routes.test.ts`, the download
 * and verification are `core/__tests__/mode-catalog.test.ts`. Here a 404
 * means the route is missing, and any answered request means it is there.
 *
 * Hermetic like the other `startServer` suites: `HOME` is redirected for the
 * duration so launcher boot cannot touch the developer's real `~/.pneuma`,
 * and the project cache's chokidar watchers are shut down afterwards so they
 * do not keep the event loop alive.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startServer } from "../index.js";
import { shutdownProjectCache } from "../projects-cache.js";
import type { CatalogRouteResponse } from "../catalog-routes.js";
import { MODE_CATALOG_FORMAT, type ModeCatalog } from "../../core/types/mode-catalog.js";

const SESSION_PORT = 19893;
const LAUNCHER_PORT = 19894;
const MODE = "demo";

/**
 * Port 1 is reserved and nothing listens on it, so a fetch fails at connect
 * without a timeout. The install stream then has to report the failure as its
 * terminal event — which is only observable if the route exists at all.
 */
const UNREACHABLE = "http://127.0.0.1:1/demo-1.0.0.tar.gz";

let projectRoot: string;
let workspace: string;
let tmpHome: string;
let originalHome: string | undefined;
let sessionServer: Awaited<ReturnType<typeof startServer>>;
let launcherServer: Awaited<ReturnType<typeof startServer>>;

/** A released-package shape: no mode source, one catalog entry. */
function writeFixturePackage(root: string): void {
  mkdirSync(join(root, "modes", MODE, "showcase"), { recursive: true });
  writeFileSync(
    join(root, "modes", "distribution.json"),
    JSON.stringify({ bundled: ["_shared"] }, null, 2),
  );
  const catalog: ModeCatalog = {
    formatVersion: MODE_CATALOG_FORMAT,
    coreVersion: "9.9.9",
    generatedAt: "2026-09-22T00:00:00.000Z",
    modes: [
      {
        name: MODE,
        version: "1.0.0",
        displayName: { en: "Demo" },
        description: { en: "A fixture mode" },
        archive: { url: UNREACHABLE, size: 1024, sha256: "0".repeat(64) },
        unpackedSize: 4096,
      },
    ],
  };
  writeFileSync(join(root, "modes", "catalog.json"), JSON.stringify(catalog, null, 2));
}

/** Read an NDJSON install stream into the events it declares. */
async function readEvents(res: Response): Promise<Array<Record<string, unknown>>> {
  const text = await res.text();
  return text
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

beforeAll(async () => {
  originalHome = process.env.HOME;
  tmpHome = mkdtempSync(join(tmpdir(), "pneuma-catalog-mount-home-"));
  process.env.HOME = tmpHome;

  projectRoot = mkdtempSync(join(tmpdir(), "pneuma-catalog-mount-pkg-"));
  writeFixturePackage(projectRoot);
  workspace = mkdtempSync(join(tmpdir(), "pneuma-catalog-mount-ws-"));

  sessionServer = await startServer({
    port: SESSION_PORT,
    workspace,
    projectRoot,
    modeName: MODE,
  });
  launcherServer = await startServer({
    port: LAUNCHER_PORT,
    workspace,
    projectRoot,
    launcherMode: true,
  });
}, 30_000);

afterAll(async () => {
  await sessionServer?.cleanup?.().catch(() => {});
  (sessionServer as { server?: { stop?: (force?: boolean) => void } } | undefined)?.server?.stop?.(true);
  (launcherServer as { server?: { stop?: (force?: boolean) => void } } | undefined)?.server?.stop?.(true);
  await shutdownProjectCache().catch(() => {});
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  for (const dir of [tmpHome, projectRoot, workspace]) {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe.each([
  ["per-session server", () => SESSION_PORT],
  ["launcher server", () => LAUNCHER_PORT],
])("%s", (_label, portOf) => {
  test("GET /api/catalog answers with this release's catalog", async () => {
    const res = await fetch(`http://localhost:${portOf()}/api/catalog`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as CatalogRouteResponse;
    expect(body.available).toBe(true);
    expect(body.coreVersion).toBe("9.9.9");
    expect(body.modes.map((m) => m.name)).toEqual([MODE]);
    expect(body.modes[0]!.state).toBe("not-installed");
  });

  test("POST /api/catalog/install runs the installer instead of 404ing", async () => {
    const res = await fetch(`http://localhost:${portOf()}/api/catalog/install`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: MODE }),
    });
    // 200 + a stream is the contract even for a failed download: the reason
    // travels in the body's terminal event. A 404 here is the bug.
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    const events = await readEvents(res);
    const terminal = events.at(-1);
    expect(terminal?.event).toBe("error");
    // Reached the download, i.e. the handler ran — not a routing failure.
    expect(terminal?.code).toBe("network");
    expect(String(terminal?.message)).toContain(UNREACHABLE);
  }, 15_000);

  test("an unknown mode is refused by the installer, still not by the router", async () => {
    const res = await fetch(`http://localhost:${portOf()}/api/catalog/install`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "no-such-mode" }),
    });
    expect(res.status).toBe(200);
    const terminal = (await readEvents(res)).at(-1);
    expect(terminal?.event).toBe("error");
    expect(terminal?.code).toBe("unknown-mode");
  });
});

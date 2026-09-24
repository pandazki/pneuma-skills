/**
 * The session server on the shared workspace watcher, through real HTTP:
 *
 * - `GET /api/session` reports the watcher's health (`watcher`), the
 *   diagnostic that replaces "write a probe file and watch the WebSocket".
 * - `proxy.json` created after start hot-loads from that same watcher (F12),
 *   so `/proxy/<name>/*` reaches the new upstream without a restart.
 * - `sessionId` names the session this server serves even with no agent
 *   connected (`--viewing`), not only while one is.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ViewerConfig } from "../../core/types/mode-manifest.js";
import type { WatcherHealth } from "../../core/types/workspace-watcher.js";
import { createSessionWatcher } from "../file-watcher.js";
import { startServer } from "../index.js";
import { resolveWatcherBackend, type WorkspaceWatcher } from "../watch/index.js";

const PORT = 19850 + Math.floor(Math.random() * 100);
const SESSION_ID = "session-watcher-test-session";
const VIEWER: ViewerConfig = { watchPatterns: ["**/*.md"], ignorePatterns: [], serveDir: "." };

let ws: string;
let watcher: WorkspaceWatcher;
let server: Awaited<ReturnType<typeof startServer>>;
let upstream: ReturnType<typeof Bun.serve>;

const api = (path: string) => fetch(`http://localhost:${server.port}${path}`);

async function waitFor<T>(what: string, probe: () => Promise<T | undefined | null | false>, timeoutMs = 3_000): Promise<T> {
  const start = performance.now();
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (performance.now() - start > timeoutMs) throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await Bun.sleep(25);
  }
}

beforeAll(async () => {
  ws = realpathSync(mkdtempSync(join(tmpdir(), "pneuma-session-watcher-")));
  mkdirSync(join(ws, "docs"), { recursive: true });
  mkdirSync(join(ws, ".pneuma"), { recursive: true });
  writeFileSync(join(ws, ".pneuma", "session.json"), JSON.stringify({ sessionId: SESSION_ID, mode: "doc" }));
  upstream = Bun.serve({ port: 0, fetch: () => new Response("upstream-ok") });
  watcher = createSessionWatcher(ws, VIEWER, { stateDir: join(ws, ".pneuma") });
  server = await startServer({
    port: PORT,
    workspace: ws,
    watchPatterns: VIEWER.watchPatterns,
    stateDir: join(ws, ".pneuma"),
    workspaceWatcher: watcher,
  });
  await watcher.ready;
});

afterAll(async () => {
  // cleanup() also shuts the project cache down, so no watcher a route
  // primed outlives this file (the watcher suites share the process).
  await server?.cleanup?.();
  server?.server?.stop?.(true);
  upstream?.stop(true);
  await watcher?.close();
  rmSync(ws, { recursive: true, force: true });
});

describe("GET /api/session → watcher", () => {
  test("reports the backend, readiness and the last change heard", async () => {
    const first = (await (await api("/api/session")).json()) as { watcher: WatcherHealth };
    expect(first.watcher).toMatchObject({
      backend: resolveWatcherBackend().kind,
      ready: true,
      degraded: false,
    });

    const before = Date.now();
    writeFileSync(join(ws, "docs", "probe.md"), "# probe");
    const heard = await waitFor("lastEventAt to move past the probe write", async () => {
      const body = (await (await api("/api/session")).json()) as { watcher: WatcherHealth };
      return body.watcher.lastEventAt !== null && body.watcher.lastEventAt >= before ? body.watcher : null;
    });
    expect(heard.degraded).toBe(false);
  });
});

// Round-2 finding 5 (2026-09-24): a `--viewing` session answered
// `sessionId: null` — the field only named a session with a live agent
// connection, so a page opened without `?session=` joined "default".
describe("GET /api/session → sessionId", () => {
  test("names the session this server serves while no agent is connected", async () => {
    const body = (await (await api("/api/session")).json()) as { sessionId: string | null };
    expect(body.sessionId).toBe(SESSION_ID);
  });
});

describe("proxy.json hot reload (F12)", () => {
  test("a proxy.json created after start routes /proxy/<name>/*; removing it stops routing", async () => {
    const before = await api("/proxy/up/hello");
    expect(before.status).not.toBe(200);

    writeFileSync(join(ws, "proxy.json"), JSON.stringify({ up: { target: `http://localhost:${upstream.port}` } }));
    await waitFor("the new proxy route", async () => {
      const res = await api("/proxy/up/hello");
      return res.status === 200 && (await res.text()) === "upstream-ok";
    });

    unlinkSync(join(ws, "proxy.json"));
    await waitFor("the proxy route to be cleared", async () => (await api("/proxy/up/hello")).status !== 200);
  });
});

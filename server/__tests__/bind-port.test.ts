/**
 * Port binding fails loudly (review finding, 2026-09-24): when every port in
 * the scan range was taken, `startServer` used to log "server running" and
 * return an unassigned `server`, and the CLI printed its ready banner for a
 * server that did not exist.
 */

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bindFirstFreePort } from "../bind-port.js";
import { startServer } from "../index.js";
import { shutdownProjectCache } from "../projects-cache.js";

const occupied: ReturnType<typeof Bun.serve>[] = [];
const dirs: string[] = [];

/** Occupy `count` consecutive ports on the address the servers bind; returns the first. */
function occupyRange(count: number): number {
  for (let tries = 0; tries < 20; tries++) {
    const base = 21000 + Math.floor(Math.random() * 4000);
    const held: ReturnType<typeof Bun.serve>[] = [];
    try {
      for (let i = 0; i < count; i++) {
        held.push(Bun.serve({ port: base + i, hostname: "0.0.0.0", fetch: () => new Response("taken") }));
      }
      occupied.push(...held);
      return base;
    } catch {
      for (const s of held) s.stop(true);
    }
  }
  throw new Error(`could not occupy ${count} consecutive ports`);
}

/** `count` consecutive ports nobody listens on (bound and released at once). */
function freeRange(count: number): number {
  const base = occupyRange(count);
  for (const s of occupied.splice(-count)) s.stop(true);
  return base;
}

/** Can this host listen on the IPv6 loopback? */
const IPV6_LOOPBACK = (() => {
  try {
    Bun.serve({ port: 0, hostname: "::1", fetch: () => new Response("") }).stop(true);
    return true;
  } catch {
    return false;
  }
})();

afterEach(() => {
  for (const s of occupied.splice(0)) s.stop(true);
});

afterAll(async () => {
  await shutdownProjectCache();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("bindFirstFreePort", () => {
  const serveOn = (port: number) => Bun.serve({ port, hostname: "0.0.0.0", fetch: () => new Response("mine") });

  test("skips taken ports and returns the first one that binds", async () => {
    const base = occupyRange(2);
    const bound = await bindFirstFreePort(base, 5, serveOn);
    occupied.push(bound.server);
    expect(bound.port).toBe(base + 2);
    expect(bound.server.port).toBe(base + 2);
  });

  test("throws, naming the range, when every attempt is taken", async () => {
    const base = occupyRange(3);
    let error: unknown;
    try {
      await bindFirstFreePort(base, 3, serveOn);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(`No free port: ${base}–${base + 2} are all in use (3 attempts)`);
    expect((error as NodeJS.ErrnoException).code).toBe("EADDRINUSE");
  });

  test("any other bind error is thrown at once, without trying the next port", async () => {
    const tried: number[] = [];
    const denied = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    const base = freeRange(5);
    await expect(
      bindFirstFreePort(base, 5, (port) => {
        tried.push(port);
        throw denied;
      }),
    ).rejects.toThrow(denied);
    expect(tried).toEqual([base]);
  });

  // Round-2 finding 4 (2026-09-24): a `python -m http.server` held
  // 127.0.0.1:18791, the wildcard bind on 18791 still succeeded (macOS lets a
  // wildcard and a specific address share a port), and `localhost:18791` —
  // the URL the CLI prints — reached the other process.
  test("a port another process listens on only at 127.0.0.1 is skipped", async () => {
    const base = freeRange(3);
    occupied.push(Bun.serve({ port: base, hostname: "127.0.0.1", fetch: () => new Response("someone else") }));
    const bound = await bindFirstFreePort(base, 3, serveOn);
    occupied.push(bound.server);
    expect(bound.port).toBe(base + 1);
    expect(await (await fetch(`http://localhost:${bound.port}/`)).text()).toBe("mine");
  });

  test.skipIf(!IPV6_LOOPBACK)("a port another process listens on only at ::1 is skipped", async () => {
    const base = freeRange(3);
    occupied.push(Bun.serve({ port: base, hostname: "::1", fetch: () => new Response("someone else") }));
    const bound = await bindFirstFreePort(base, 3, serveOn);
    occupied.push(bound.server);
    expect(bound.port).toBe(base + 1);
  });
});

describe("startServer when every port in its range is taken", () => {
  test("the launcher server rejects instead of reporting a server that never bound", async () => {
    const base = occupyRange(10);
    const ws = realpathSync(mkdtempSync(join(tmpdir(), "pneuma-bind-launcher-")));
    dirs.push(ws);
    await expect(startServer({ port: base, workspace: ws, launcherMode: true })).rejects.toThrow(
      new RegExp(`${base}.*${base + 9}`),
    );
  });

  test("the session server rejects instead of reporting a server that never bound", async () => {
    const base = occupyRange(10);
    const ws = realpathSync(mkdtempSync(join(tmpdir(), "pneuma-bind-session-")));
    dirs.push(ws);
    await expect(
      startServer({ port: base, workspace: ws, watchPatterns: ["**/*.md"], stateDir: join(ws, ".pneuma") }),
    ).rejects.toThrow(new RegExp(`${base}.*${base + 9}`));
  });
});

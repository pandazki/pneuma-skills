import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir, homedir } from "node:os";
import { startServer } from "../index.js";

/**
 * Security tests for path traversal and command injection vulnerabilities.
 *
 * C1: GET /api/sessions/thumbnail — workspace param must be a known session
 * C2: GET /api/modes/:name/showcase/* — path traversal via encoded segments
 * C3: POST /api/processes/:taskId/kill — must be numeric PID, no shell exec
 */

const TEST_PORT = 19876;
const TEST_WORKSPACE = join(tmpdir(), "pneuma-security-test-" + Date.now());
const SECRET_DIR = join(tmpdir(), "pneuma-security-secret-" + Date.now());
const PNEUMA_HOME = join(homedir(), ".pneuma");

let server: ReturnType<typeof startServer>;
let registryBackup: string | null = null;

function api(path: string, init?: RequestInit) {
  return fetch(`http://localhost:${TEST_PORT}${path}`, init);
}

beforeAll(() => {
  // Set up test workspace with a thumbnail
  mkdirSync(join(TEST_WORKSPACE, ".pneuma"), { recursive: true });
  writeFileSync(join(TEST_WORKSPACE, ".pneuma", "thumbnail.png"), "REAL_THUMB");

  // Set up a "secret" directory that should NOT be reachable
  mkdirSync(join(SECRET_DIR, ".pneuma"), { recursive: true });
  writeFileSync(join(SECRET_DIR, ".pneuma", "thumbnail.png"), "SECRET_DATA");

  // Backup and write a test sessions registry that only includes TEST_WORKSPACE
  const registryPath = join(PNEUMA_HOME, "sessions.json");
  try { registryBackup = require("node:fs").readFileSync(registryPath, "utf-8"); } catch { registryBackup = null; }
  mkdirSync(PNEUMA_HOME, { recursive: true });
  writeFileSync(registryPath, JSON.stringify([
    { id: "test::doc", mode: "doc", workspace: TEST_WORKSPACE, lastAccessed: Date.now() },
  ]));

  server = startServer({
    port: TEST_PORT,
    workspace: TEST_WORKSPACE,
    launcherMode: true,
  });
});

afterAll(() => {
  server?.stop?.();
  rmSync(TEST_WORKSPACE, { recursive: true, force: true });
  rmSync(SECRET_DIR, { recursive: true, force: true });
  // Restore original sessions registry
  const registryPath = join(PNEUMA_HOME, "sessions.json");
  if (registryBackup !== null) {
    writeFileSync(registryPath, registryBackup as string);
  }
});

// ── C1: Thumbnail path validation ────────────────────────────────────────────

describe("C1: Thumbnail endpoint path validation", () => {
  test("rejects missing workspace param", async () => {
    const res = await api("/api/sessions/thumbnail");
    expect(res.status).toBe(400);
  });

  test("serves thumbnail for registered workspace", async () => {
    const res = await api(`/api/sessions/thumbnail?workspace=${encodeURIComponent(TEST_WORKSPACE)}`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toBe("REAL_THUMB");
  });

  test("rejects unregistered workspace (arbitrary path)", async () => {
    const res = await api(`/api/sessions/thumbnail?workspace=${encodeURIComponent(SECRET_DIR)}`);
    expect(res.status).toBe(403);
  });

  test("rejects path traversal via ../ to reach secret dir", async () => {
    const traversal = join(TEST_WORKSPACE, "..", "pneuma-security-secret-" + SECRET_DIR.split("-").pop());
    const res = await api(`/api/sessions/thumbnail?workspace=${encodeURIComponent(traversal)}`);
    expect(res.status).toBe(403);
  });

  test("rejects workspace with encoded dot-dot segments", async () => {
    const encoded = encodeURIComponent(TEST_WORKSPACE + "/../../../etc");
    const res = await api(`/api/sessions/thumbnail?workspace=${encoded}`);
    expect(res.status).toBe(403);
  });
});

// ── C2: Showcase asset path traversal ────────────────────────────────────────

describe("C2: Showcase asset path traversal", () => {
  test("rejects .. in mode name via URL encoding", async () => {
    const res = await api("/api/modes/..%2F..%2Fetc/showcase/passwd");
    expect([400, 404]).toContain(res.status);
  });

  test("rejects .. in asset path via URL encoding", async () => {
    const res = await api("/api/modes/webcraft/showcase/..%2F..%2F..%2Fetc%2Fpasswd");
    expect([400, 404]).toContain(res.status);
  });

  test("rejects url-encoded traversal in nested asset path", async () => {
    const res = await api("/api/modes/webcraft/showcase/img/..%2F..%2F..%2Fetc%2Fpasswd");
    expect([400, 404]).toContain(res.status);
  });

  test("404 for non-existent but valid showcase path", async () => {
    const res = await api("/api/modes/webcraft/showcase/nonexistent.png");
    expect(res.status).toBe(404);
  });
});

// ── C3: Process kill endpoint — test via separate non-launcher server ────────

describe("C3: Process kill endpoint safety", () => {
  const C3_PORT = 19877;
  let c3Server: ReturnType<typeof startServer>;

  beforeAll(() => {
    c3Server = startServer({
      port: C3_PORT,
      workspace: TEST_WORKSPACE,
    });
  });

  afterAll(() => {
    c3Server?.stop?.();
  });

  function c3api(path: string, init?: RequestInit) {
    return fetch(`http://localhost:${C3_PORT}${path}`, init);
  }

  test("rejects non-numeric taskId", async () => {
    const res = await c3api("/api/processes/evilcmd/kill", { method: "POST" });
    expect(res.status).toBe(400);
  });

  test("rejects hex-only taskId (not numeric)", async () => {
    const res = await c3api("/api/processes/deadbeef/kill", { method: "POST" });
    expect(res.status).toBe(400);
  });

  test("rejects negative PID", async () => {
    const res = await c3api("/api/processes/-1/kill", { method: "POST" });
    expect(res.status).toBe(400);
  });

  test("rejects zero PID", async () => {
    const res = await c3api("/api/processes/0/kill", { method: "POST" });
    expect(res.status).toBe(400);
  });

  test("prevents killing self", async () => {
    const res = await c3api(`/api/processes/${process.pid}/kill`, { method: "POST" });
    expect(res.status).toBe(403);
  });

  test("accepts valid numeric PID (non-existent process)", async () => {
    // Use a very high PID unlikely to exist
    const res = await c3api("/api/processes/999999/kill", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
  });
});

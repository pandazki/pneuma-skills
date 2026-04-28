import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detectWorkspaceKind,
  loadProjectManifest,
  writeProjectManifest,
  scanProjectSessions,
} from "../project-loader.js";

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pneuma-proj-"));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("detectWorkspaceKind", () => {
  test("returns 'quick' for empty dir", async () => {
    expect(await detectWorkspaceKind(tmp)).toBe("quick");
  });

  test("returns 'quick' when only legacy session.json exists", async () => {
    await mkdir(join(tmp, ".pneuma"), { recursive: true });
    await writeFile(
      join(tmp, ".pneuma", "session.json"),
      JSON.stringify({ sessionId: "x", mode: "doc", backendType: "claude-code", createdAt: 1 })
    );
    expect(await detectWorkspaceKind(tmp)).toBe("quick");
  });

  test("returns 'project' when project.json exists", async () => {
    await mkdir(join(tmp, ".pneuma"), { recursive: true });
    await writeFile(
      join(tmp, ".pneuma", "project.json"),
      JSON.stringify({ version: 1, name: "p", displayName: "P", createdAt: 1 })
    );
    expect(await detectWorkspaceKind(tmp)).toBe("project");
  });
});

describe("loadProjectManifest / writeProjectManifest", () => {
  test("write then read round-trips", async () => {
    await writeProjectManifest(tmp, {
      version: 1,
      name: "test-proj",
      displayName: "Test Project",
      description: "hello",
      createdAt: 12345,
    });
    const m = await loadProjectManifest(tmp);
    expect(m).not.toBeNull();
    expect(m!.name).toBe("test-proj");
    expect(m!.description).toBe("hello");
  });

  test("loadProjectManifest returns null when missing", async () => {
    const m = await loadProjectManifest(tmp);
    expect(m).toBeNull();
  });

  test("loadProjectManifest returns null on invalid shape", async () => {
    await mkdir(join(tmp, ".pneuma"), { recursive: true });
    await writeFile(join(tmp, ".pneuma", "project.json"), JSON.stringify({ name: "x" }));
    expect(await loadProjectManifest(tmp)).toBeNull();
  });
});

describe("scanProjectSessions", () => {
  test("returns [] when no sessions/", async () => {
    expect(await scanProjectSessions(tmp)).toEqual([]);
  });

  test("returns sessionId list from sessions subdirs containing session.json", async () => {
    const base = join(tmp, ".pneuma", "sessions");
    await mkdir(join(base, "abc"), { recursive: true });
    await writeFile(
      join(base, "abc", "session.json"),
      JSON.stringify({ sessionId: "abc", mode: "doc", backendType: "claude-code", createdAt: 1 })
    );
    await mkdir(join(base, "def"), { recursive: true });
    await writeFile(
      join(base, "def", "session.json"),
      JSON.stringify({ sessionId: "def", mode: "webcraft", backendType: "claude-code", createdAt: 2 })
    );
    // dir without session.json should be skipped
    await mkdir(join(base, "incomplete"), { recursive: true });

    const sessions = await scanProjectSessions(tmp);
    const ids = sessions.map((s) => s.sessionId).sort();
    expect(ids).toEqual(["abc", "def"]);
  });

  test("surfaces backendType, displayName, and lastAccessed when present", async () => {
    const base = join(tmp, ".pneuma", "sessions");
    await mkdir(join(base, "named"), { recursive: true });
    await writeFile(
      join(base, "named", "session.json"),
      JSON.stringify({
        sessionId: "named",
        mode: "doc",
        backendType: "codex",
        sessionName: "Hero Section",
        createdAt: 100,
      })
    );
    // history.json present — its mtime should drive lastAccessed
    await writeFile(join(base, "named", "history.json"), JSON.stringify([]));

    const sessions = await scanProjectSessions(tmp);
    const named = sessions.find((s) => s.sessionId === "named");
    expect(named).toBeDefined();
    expect(named!.backendType).toBe("codex");
    expect(named!.displayName).toBe("Hero Section");
    // lastAccessed is mtime-based; we can't predict the exact ms but it must
    // be a positive number near now.
    expect(typeof named!.lastAccessed).toBe("number");
    expect(named!.lastAccessed).toBeGreaterThan(0);
  });

  test("session id round-trips: directory name === scanned sessionId === persisted sessionId", async () => {
    // Models the post-Fix-1 invariant: the project-session id we generate at
    // startup is the directory name AND the field stored inside session.json.
    // ProjectPanel + ModeSwitcher rely on these three identifiers staying in
    // lockstep so /api/launch?sessionId=<id> resolves the right directory.
    const startupSessionId = "session-roundtrip-id";
    const sessionDir = join(tmp, ".pneuma", "sessions", startupSessionId);
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, "session.json"),
      JSON.stringify({
        sessionId: startupSessionId,
        agentSessionId: "backend-protocol-id-must-not-leak",
        mode: "doc",
        backendType: "claude-code",
        createdAt: 1,
      })
    );

    const sessions = await scanProjectSessions(tmp);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe(startupSessionId);
    // The agent's protocol id is intentionally not surfaced on ProjectSessionRef.
    expect((sessions[0] as { agentSessionId?: string }).agentSessionId).toBeUndefined();
  });

  test("falls back to directory name when session.json sessionId is missing/empty", async () => {
    // Mirrors the post-Fix-1 invariant: the directory name is the canonical
    // id even if a stale session.json write left the field unset. Older
    // 3.0 sessions would otherwise vanish from the panel.
    const base = join(tmp, ".pneuma", "sessions");
    await mkdir(join(base, "dir-key-only"), { recursive: true });
    await writeFile(
      join(base, "dir-key-only", "session.json"),
      JSON.stringify({ mode: "doc", backendType: "claude-code", createdAt: 1 })
    );

    const sessions = await scanProjectSessions(tmp);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe("dir-key-only");
  });
});

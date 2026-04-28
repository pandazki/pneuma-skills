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

  test("overrides mismatched sessionId with directory name", async () => {
    // Legacy demo sessions on disk (`/Users/pandazki/Tmp/pneuma-demo-project`)
    // have session.json files where the persisted sessionId points at a
    // sibling directory — clicking resume in the panel would otherwise
    // resolve to the wrong session. The directory name always wins.
    const base = join(tmp, ".pneuma", "sessions");
    await mkdir(join(base, "real-dir-id"), { recursive: true });
    await writeFile(
      join(base, "real-dir-id", "session.json"),
      JSON.stringify({
        sessionId: "stale-pointer-to-elsewhere",
        mode: "illustrate",
        backendType: "claude-code",
        createdAt: 1,
      })
    );

    const sessions = await scanProjectSessions(tmp);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe("real-dir-id");
  });

  test("thumbnailUrl set when thumbnail.png exists, undefined otherwise", async () => {
    const base = join(tmp, ".pneuma", "sessions");
    // With thumbnail
    await mkdir(join(base, "with-thumb"), { recursive: true });
    await writeFile(
      join(base, "with-thumb", "session.json"),
      JSON.stringify({ sessionId: "with-thumb", mode: "illustrate", backendType: "claude-code", createdAt: 1 })
    );
    await writeFile(join(base, "with-thumb", "thumbnail.png"), Buffer.from([0x89, 0x50]));
    // Without thumbnail
    await mkdir(join(base, "no-thumb"), { recursive: true });
    await writeFile(
      join(base, "no-thumb", "session.json"),
      JSON.stringify({ sessionId: "no-thumb", mode: "doc", backendType: "claude-code", createdAt: 2 })
    );

    const sessions = await scanProjectSessions(tmp);
    const withThumb = sessions.find((s) => s.sessionId === "with-thumb");
    const noThumb = sessions.find((s) => s.sessionId === "no-thumb");
    expect(withThumb).toBeDefined();
    expect(noThumb).toBeDefined();
    expect(withThumb!.thumbnailUrl).toBe(
      `/api/projects/${encodeURIComponent(tmp)}/sessions/with-thumb/thumbnail`
    );
    expect(noThumb!.thumbnailUrl).toBeUndefined();
  });

  test("preview extracts first user message text from history.json", async () => {
    const base = join(tmp, ".pneuma", "sessions");
    await mkdir(join(base, "with-history"), { recursive: true });
    await writeFile(
      join(base, "with-history", "session.json"),
      JSON.stringify({ sessionId: "with-history", mode: "doc", backendType: "claude-code", createdAt: 1 })
    );
    await writeFile(
      join(base, "with-history", "history.json"),
      JSON.stringify([
        { type: "system_event", subtype: "boot", ts: 1 },
        {
          type: "user_message",
          content: "Build me a hero section.",
          timestamp: 2,
        },
        { type: "assistant", message: { content: [{ type: "text", text: "Sure." }] } },
      ])
    );

    const sessions = await scanProjectSessions(tmp);
    const ref = sessions.find((s) => s.sessionId === "with-history");
    expect(ref?.preview).toBe("Build me a hero section.");
  });

  test("preview strips <viewer-context> wrapper before extracting", async () => {
    // Pneuma chat injects a `<viewer-context>...</viewer-context>` block
    // before the user's actual prompt. The preview should reflect what the
    // user *typed*, not the machine context.
    const base = join(tmp, ".pneuma", "sessions");
    await mkdir(join(base, "with-ctx"), { recursive: true });
    await writeFile(
      join(base, "with-ctx", "session.json"),
      JSON.stringify({ sessionId: "with-ctx", mode: "illustrate", backendType: "claude-code", createdAt: 1 })
    );
    await writeFile(
      join(base, "with-ctx", "history.json"),
      JSON.stringify([
        {
          type: "user_message",
          content: '<viewer-context content-set="x" mode="illustrate">\nActive: foo\n</viewer-context>\n\nMake the hero feel cinematic.',
          timestamp: 1,
        },
      ])
    );

    const sessions = await scanProjectSessions(tmp);
    const ref = sessions.find((s) => s.sessionId === "with-ctx");
    expect(ref?.preview).toBe("Make the hero feel cinematic.");
  });

  test("preview truncates long single-sentence text to ~100 chars + ellipsis", async () => {
    const longText = "A".repeat(120) + " end"; // 124 chars, no terminator
    const base = join(tmp, ".pneuma", "sessions");
    await mkdir(join(base, "long"), { recursive: true });
    await writeFile(
      join(base, "long", "session.json"),
      JSON.stringify({ sessionId: "long", mode: "doc", backendType: "claude-code", createdAt: 1 })
    );
    await writeFile(
      join(base, "long", "history.json"),
      JSON.stringify([{ type: "user_message", content: longText, timestamp: 1 }])
    );

    const sessions = await scanProjectSessions(tmp);
    const ref = sessions.find((s) => s.sessionId === "long");
    expect(ref?.preview).toBeDefined();
    expect(ref!.preview!.length).toBeLessThanOrEqual(101); // 100 chars + ellipsis
    expect(ref!.preview!.endsWith("…")).toBe(true);
  });

  test("preview handles Anthropic-style array content blocks", async () => {
    // Defensive against future shapes — Anthropic SDK content can be an
    // array of blocks. The first text block wins.
    const base = join(tmp, ".pneuma", "sessions");
    await mkdir(join(base, "array-content"), { recursive: true });
    await writeFile(
      join(base, "array-content", "session.json"),
      JSON.stringify({ sessionId: "array-content", mode: "doc", backendType: "claude-code", createdAt: 1 })
    );
    await writeFile(
      join(base, "array-content", "history.json"),
      JSON.stringify([
        {
          role: "user",
          content: [
            { type: "image", source: {} },
            { type: "text", text: "Caption this." },
          ],
        },
      ])
    );

    const sessions = await scanProjectSessions(tmp);
    const ref = sessions.find((s) => s.sessionId === "array-content");
    expect(ref?.preview).toBe("Caption this.");
  });

  test("preview is undefined when history.json is missing or malformed", async () => {
    const base = join(tmp, ".pneuma", "sessions");
    // No history at all
    await mkdir(join(base, "no-hist"), { recursive: true });
    await writeFile(
      join(base, "no-hist", "session.json"),
      JSON.stringify({ sessionId: "no-hist", mode: "doc", backendType: "claude-code", createdAt: 1 })
    );
    // Malformed JSON
    await mkdir(join(base, "bad-hist"), { recursive: true });
    await writeFile(
      join(base, "bad-hist", "session.json"),
      JSON.stringify({ sessionId: "bad-hist", mode: "doc", backendType: "claude-code", createdAt: 1 })
    );
    await writeFile(join(base, "bad-hist", "history.json"), "not json {[");
    // No user messages
    await mkdir(join(base, "no-user"), { recursive: true });
    await writeFile(
      join(base, "no-user", "session.json"),
      JSON.stringify({ sessionId: "no-user", mode: "doc", backendType: "claude-code", createdAt: 1 })
    );
    await writeFile(
      join(base, "no-user", "history.json"),
      JSON.stringify([{ type: "system_event", subtype: "boot", ts: 1 }])
    );

    const sessions = await scanProjectSessions(tmp);
    expect(sessions.find((s) => s.sessionId === "no-hist")?.preview).toBeUndefined();
    expect(sessions.find((s) => s.sessionId === "bad-hist")?.preview).toBeUndefined();
    expect(sessions.find((s) => s.sessionId === "no-user")?.preview).toBeUndefined();
  });
});

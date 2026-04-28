import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { mountProjectsRoutes } from "../projects-routes.js";

let home: string;
let testApp: Hono;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "pneuma-home-"));
  testApp = new Hono();
  mountProjectsRoutes(testApp, { homeDir: home });
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("GET /api/projects", () => {
  test("returns empty array when no projects", async () => {
    const res = await testApp.request("/api/projects");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.projects).toEqual([]);
  });

  test("response includes homeDir for path shortening", async () => {
    const res = await testApp.request("/api/projects");
    expect(res.status).toBe(200);
    const body = await res.json();
    // The harness passes `home` as the homeDir option (line 15) — the route
    // surfaces it on the top-level response so panels / cards can render `~`
    // shortcuts without an extra fetch.
    expect(body.homeDir).toBe(home);
  });

  test("response entries include sessionCount, modeBreakdown, and coverImageUrl", async () => {
    const projRoot = join(home, "rich-proj");
    await mkdir(projRoot, { recursive: true });
    await mkdir(join(projRoot, ".pneuma", "sessions", "s-doc"), { recursive: true });
    await mkdir(join(projRoot, ".pneuma", "sessions", "s-web"), { recursive: true });
    await writeFile(
      join(projRoot, ".pneuma", "project.json"),
      JSON.stringify({ version: 1, name: "rich", displayName: "Rich", createdAt: 1 })
    );
    await writeFile(
      join(projRoot, ".pneuma", "sessions", "s-doc", "session.json"),
      JSON.stringify({ sessionId: "s-doc", mode: "doc", backendType: "claude-code", createdAt: 1 })
    );
    await writeFile(
      join(projRoot, ".pneuma", "sessions", "s-web", "session.json"),
      JSON.stringify({ sessionId: "s-web", mode: "webcraft", backendType: "claude-code", createdAt: 2 })
    );
    // Drop a cover image so coverImageUrl should populate.
    await writeFile(join(projRoot, ".pneuma", "cover.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    await mkdir(join(home, ".pneuma"), { recursive: true });
    await writeFile(
      join(home, ".pneuma", "sessions.json"),
      JSON.stringify({
        projects: [
          {
            id: projRoot,
            name: "rich",
            displayName: "Rich",
            description: "demo",
            root: projRoot,
            createdAt: 1,
            lastAccessed: 1,
          },
        ],
        sessions: [],
      })
    );

    const res = await testApp.request("/api/projects");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.projects).toHaveLength(1);
    const p = body.projects[0];
    expect(p.sessionCount).toBe(2);
    expect(p.modeBreakdown).toEqual(["doc", "webcraft"]);
    expect(p.coverImageUrl).toBe(
      `/api/projects/${encodeURIComponent(projRoot)}/cover`
    );
  });

  test("omits coverImageUrl when no cover.png is present", async () => {
    const projRoot = join(home, "no-cover-proj");
    await mkdir(join(projRoot, ".pneuma"), { recursive: true });
    await writeFile(
      join(projRoot, ".pneuma", "project.json"),
      JSON.stringify({ version: 1, name: "p", displayName: "P", createdAt: 1 })
    );
    await mkdir(join(home, ".pneuma"), { recursive: true });
    await writeFile(
      join(home, ".pneuma", "sessions.json"),
      JSON.stringify({
        projects: [
          {
            id: projRoot,
            name: "p",
            displayName: "P",
            root: projRoot,
            createdAt: 1,
            lastAccessed: 1,
          },
        ],
        sessions: [],
      })
    );
    const res = await testApp.request("/api/projects");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.projects[0].sessionCount).toBe(0);
    expect(body.projects[0].modeBreakdown).toEqual([]);
    expect(body.projects[0].coverImageUrl).toBeUndefined();
  });
});

describe("GET /api/projects archived filter (Phase 4)", () => {
  // All cases share the same fixture: two projects on disk + in registry,
  // one archived and one active. Different requests against the same
  // setup keep the test bodies focused on the filter behavior.
  async function seedTwoProjects(): Promise<{ active: string; archived: string }> {
    const active = join(home, "active-proj");
    const archived = join(home, "archived-proj");
    for (const root of [active, archived]) {
      await mkdir(join(root, ".pneuma"), { recursive: true });
      await writeFile(
        join(root, ".pneuma", "project.json"),
        JSON.stringify({ version: 1, name: "p", displayName: "P", createdAt: 1 }),
      );
    }
    await mkdir(join(home, ".pneuma"), { recursive: true });
    await writeFile(
      join(home, ".pneuma", "sessions.json"),
      JSON.stringify({
        projects: [
          {
            id: active,
            name: "active",
            displayName: "Active",
            root: active,
            createdAt: 1,
            lastAccessed: 2,
          },
          {
            id: archived,
            name: "archived",
            displayName: "Archived",
            root: archived,
            createdAt: 1,
            lastAccessed: 1,
            archived: true,
          },
        ],
        sessions: [],
      }),
    );
    return { active, archived };
  }

  test("default response hides archived projects + still surfaces homeDir", async () => {
    const { active } = await seedTwoProjects();
    const res = await testApp.request("/api/projects");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.projects).toHaveLength(1);
    expect(body.projects[0].id).toBe(active);
    expect(body.homeDir).toBe(home);
  });

  test("?archived=true returns only archived projects + homeDir", async () => {
    const { archived } = await seedTwoProjects();
    const res = await testApp.request("/api/projects?archived=true");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.projects).toHaveLength(1);
    expect(body.projects[0].id).toBe(archived);
    expect(body.projects[0].archived).toBe(true);
    expect(body.homeDir).toBe(home);
  });

  test("?archived=all returns both buckets + homeDir", async () => {
    await seedTwoProjects();
    const res = await testApp.request("/api/projects?archived=all");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.projects).toHaveLength(2);
    expect(body.homeDir).toBe(home);
  });

  test("unknown ?archived= value falls back to the default filter", async () => {
    const { active } = await seedTwoProjects();
    const res = await testApp.request("/api/projects?archived=garbage");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.projects).toHaveLength(1);
    expect(body.projects[0].id).toBe(active);
  });
});

describe("POST /api/projects/:id/archive + /restore (Phase 4)", () => {
  async function seedSingleProject(): Promise<string> {
    const root = join(home, "round-trip");
    await mkdir(join(root, ".pneuma"), { recursive: true });
    await writeFile(
      join(root, ".pneuma", "project.json"),
      JSON.stringify({ version: 1, name: "p", displayName: "P", createdAt: 1 }),
    );
    await mkdir(join(home, ".pneuma"), { recursive: true });
    await writeFile(
      join(home, ".pneuma", "sessions.json"),
      JSON.stringify({
        projects: [
          {
            id: root,
            name: "rt",
            displayName: "RT",
            root,
            createdAt: 1,
            lastAccessed: 1,
          },
        ],
        sessions: [],
      }),
    );
    return root;
  }

  test("archive then restore round-trips, listing reflects each step", async () => {
    const root = await seedSingleProject();
    const id = encodeURIComponent(root);

    // Archive
    const archiveRes = await testApp.request(`/api/projects/${id}/archive`, {
      method: "POST",
    });
    expect(archiveRes.status).toBe(200);
    expect(await archiveRes.json()).toEqual({ archived: true });

    // Default listing now hides it
    const afterArchive = await testApp.request("/api/projects").then((r) => r.json());
    expect(afterArchive.projects).toHaveLength(0);
    // ?archived=true reveals it
    const archivedOnly = await testApp
      .request("/api/projects?archived=true")
      .then((r) => r.json());
    expect(archivedOnly.projects).toHaveLength(1);
    expect(archivedOnly.projects[0].id).toBe(root);

    // Restore
    const restoreRes = await testApp.request(`/api/projects/${id}/restore`, {
      method: "POST",
    });
    expect(restoreRes.status).toBe(200);
    expect(await restoreRes.json()).toEqual({ archived: false });

    // Default listing has it back
    const afterRestore = await testApp.request("/api/projects").then((r) => r.json());
    expect(afterRestore.projects).toHaveLength(1);
    expect(afterRestore.projects[0].id).toBe(root);
    // ?archived=true is empty again
    const archivedEmpty = await testApp
      .request("/api/projects?archived=true")
      .then((r) => r.json());
    expect(archivedEmpty.projects).toHaveLength(0);
  });

  test("archive 404s on unknown id", async () => {
    await mkdir(join(home, ".pneuma"), { recursive: true });
    await writeFile(
      join(home, ".pneuma", "sessions.json"),
      JSON.stringify({ projects: [], sessions: [] }),
    );
    const res = await testApp.request(
      `/api/projects/${encodeURIComponent("/nope")}/archive`,
      { method: "POST" },
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "project not found" });
  });

  test("restore 404s on unknown id", async () => {
    await mkdir(join(home, ".pneuma"), { recursive: true });
    await writeFile(
      join(home, ".pneuma", "sessions.json"),
      JSON.stringify({ projects: [], sessions: [] }),
    );
    const res = await testApp.request(
      `/api/projects/${encodeURIComponent("/nope")}/restore`,
      { method: "POST" },
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "project not found" });
  });

  test("archive flips registry entry on disk, restore clears it", async () => {
    const root = await seedSingleProject();
    const id = encodeURIComponent(root);

    await testApp.request(`/api/projects/${id}/archive`, { method: "POST" });
    let registry = JSON.parse(
      await readFile(join(home, ".pneuma", "sessions.json"), "utf-8"),
    );
    expect(registry.projects[0].archived).toBe(true);

    await testApp.request(`/api/projects/${id}/restore`, { method: "POST" });
    registry = JSON.parse(
      await readFile(join(home, ".pneuma", "sessions.json"), "utf-8"),
    );
    // restoreProject omits the field rather than writing `archived: false`,
    // so the round-tripped JSON should match the never-archived shape.
    expect(registry.projects[0].archived).toBeUndefined();
    expect("archived" in registry.projects[0]).toBe(false);
  });
});

describe("GET /api/projects/:id/cover", () => {
  test("streams the cover.png when present", async () => {
    const projRoot = join(home, "cover-present");
    await mkdir(join(projRoot, ".pneuma"), { recursive: true });
    await writeFile(
      join(projRoot, ".pneuma", "project.json"),
      JSON.stringify({ version: 1, name: "p", displayName: "P", createdAt: 1 })
    );
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await writeFile(join(projRoot, ".pneuma", "cover.png"), pngBytes);
    await mkdir(join(home, ".pneuma"), { recursive: true });
    await writeFile(
      join(home, ".pneuma", "sessions.json"),
      JSON.stringify({
        projects: [
          {
            id: projRoot,
            name: "p",
            displayName: "P",
            root: projRoot,
            createdAt: 1,
            lastAccessed: 1,
          },
        ],
        sessions: [],
      })
    );
    const res = await testApp.request(
      `/api/projects/${encodeURIComponent(projRoot)}/cover`
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/png");
    const buf = new Uint8Array(await res.arrayBuffer());
    expect(buf.length).toBe(pngBytes.length);
  });

  test("404 when project has no cover.png", async () => {
    const projRoot = join(home, "cover-missing");
    await mkdir(join(projRoot, ".pneuma"), { recursive: true });
    await writeFile(
      join(projRoot, ".pneuma", "project.json"),
      JSON.stringify({ version: 1, name: "p", displayName: "P", createdAt: 1 })
    );
    await mkdir(join(home, ".pneuma"), { recursive: true });
    await writeFile(
      join(home, ".pneuma", "sessions.json"),
      JSON.stringify({
        projects: [
          {
            id: projRoot,
            name: "p",
            displayName: "P",
            root: projRoot,
            createdAt: 1,
            lastAccessed: 1,
          },
        ],
        sessions: [],
      })
    );
    const res = await testApp.request(
      `/api/projects/${encodeURIComponent(projRoot)}/cover`
    );
    expect(res.status).toBe(404);
  });

  test("404 when project id is unknown", async () => {
    const res = await testApp.request(
      `/api/projects/${encodeURIComponent("/nonexistent/path")}/cover`
    );
    expect(res.status).toBe(404);
  });
});

describe("POST /api/projects", () => {
  test("creates a project at given root with project.json", async () => {
    const projRoot = join(home, "myproj");
    await mkdir(projRoot, { recursive: true });
    const res = await testApp.request("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        root: projRoot,
        name: "myproj",
        displayName: "My Project",
        description: "test",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.created).toBe(true);

    const manifestPath = join(projRoot, ".pneuma", "project.json");
    const m = JSON.parse(await Bun.file(manifestPath).text());
    expect(m.name).toBe("myproj");
    expect(m.displayName).toBe("My Project");
  });

  test("rejects when project.json already exists", async () => {
    const projRoot = join(home, "exists");
    await mkdir(join(projRoot, ".pneuma"), { recursive: true });
    await writeFile(
      join(projRoot, ".pneuma", "project.json"),
      JSON.stringify({ version: 1, name: "x", displayName: "X", createdAt: 1 })
    );
    const res = await testApp.request("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        root: projRoot,
        name: "x",
        displayName: "X",
      }),
    });
    expect(res.status).toBe(409);
  });

  test("rejects when required fields missing", async () => {
    const res = await testApp.request("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ root: "/tmp" }),
    });
    expect(res.status).toBe(400);
  });

  test("rejects malformed JSON body with 400", async () => {
    const res = await testApp.request("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });

  test("empty initFromSessions behaves like no-session create", async () => {
    const projRoot = join(home, "empty-init");
    await mkdir(projRoot, { recursive: true });
    const res = await testApp.request("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        root: projRoot,
        name: "empty-init",
        displayName: "Empty Init",
        initFromSessions: [],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.created).toBe(true);
    expect(body.importedSessions).toEqual([]);
    expect(existsSync(join(projRoot, ".pneuma", "sessions"))).toBe(false);
    // Manifest should not have founderSessionId.
    const m = JSON.parse(
      await readFile(join(projRoot, ".pneuma", "project.json"), "utf-8")
    );
    expect(m.founderSessionId).toBeUndefined();
  });

  test("imports a quick session into the new project as a founder", async () => {
    // Set up a quick session on disk + in registry.
    const wsDir = join(home, "src-ws");
    await mkdir(join(wsDir, ".pneuma", "shadow.git"), { recursive: true });
    await mkdir(join(wsDir, ".claude", "skills", "doc"), { recursive: true });
    await writeFile(
      join(wsDir, ".pneuma", "session.json"),
      JSON.stringify({
        sessionId: "old-session",
        agentSessionId: "agent-abc",
        mode: "doc",
        backendType: "claude-code",
        createdAt: 100,
      })
    );
    await writeFile(
      join(wsDir, ".pneuma", "history.json"),
      JSON.stringify([{ type: "system_event", subtype: "boot", ts: 100 }])
    );
    await writeFile(join(wsDir, ".pneuma", "config.json"), JSON.stringify({ slideWidth: 1280 }));
    await writeFile(join(wsDir, ".pneuma", "skill-version.json"), JSON.stringify({ mode: "doc", version: "1.0.0" }));
    await writeFile(join(wsDir, ".pneuma", "shadow.git", "HEAD"), "ref: refs/heads/master\n");
    await writeFile(join(wsDir, "CLAUDE.md"), "# preserved\n");
    await writeFile(join(wsDir, ".claude", "skills", "doc", "SKILL.md"), "# doc skill\n");

    const sessionId = `${wsDir}::doc`;
    await mkdir(join(home, ".pneuma"), { recursive: true });
    await writeFile(
      join(home, ".pneuma", "sessions.json"),
      JSON.stringify({
        projects: [],
        sessions: [
          {
            id: sessionId,
            kind: "quick",
            mode: "doc",
            displayName: "src-ws-doc",
            workspace: wsDir,
            sessionDir: wsDir,
            backendType: "claude-code",
            lastAccessed: 100,
          },
        ],
      })
    );

    const projRoot = join(home, "imported-proj");
    await mkdir(projRoot, { recursive: true });
    const res = await testApp.request("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        root: projRoot,
        name: "imported",
        displayName: "Imported",
        initFromSessions: [sessionId],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.created).toBe(true);
    expect(body.importedSessions).toHaveLength(1);
    const newSessionId = body.importedSessions[0].sessionId as string;
    expect(typeof newSessionId).toBe("string");
    expect(body.importedSessions[0].mode).toBe("doc");

    // New session subdir on disk
    const newSessionDir = join(projRoot, ".pneuma", "sessions", newSessionId);
    expect(existsSync(join(newSessionDir, "session.json"))).toBe(true);
    expect(existsSync(join(newSessionDir, "history.json"))).toBe(true);
    expect(existsSync(join(newSessionDir, "config.json"))).toBe(true);
    expect(existsSync(join(newSessionDir, "skill-version.json"))).toBe(true);
    expect(existsSync(join(newSessionDir, "shadow.git", "HEAD"))).toBe(true);
    expect(existsSync(join(newSessionDir, "CLAUDE.md"))).toBe(true);
    expect(existsSync(join(newSessionDir, ".claude", "skills", "doc", "SKILL.md"))).toBe(true);

    const newSession = JSON.parse(
      await readFile(join(newSessionDir, "session.json"), "utf-8")
    );
    expect(newSession.sessionId).toBe(newSessionId);
    expect(newSession.agentSessionId).toBe("agent-abc"); // preserved
    expect(newSession.mode).toBe("doc");

    // Manifest founderSessionId set when exactly one was imported
    const m = JSON.parse(
      await readFile(join(projRoot, ".pneuma", "project.json"), "utf-8")
    );
    expect(m.founderSessionId).toBe(newSessionId);

    // Source workspace UNTOUCHED (non-destructive copy)
    const origSession = JSON.parse(
      await readFile(join(wsDir, ".pneuma", "session.json"), "utf-8")
    );
    expect(origSession.sessionId).toBe("old-session");
    expect(existsSync(join(wsDir, "CLAUDE.md"))).toBe(true);
    expect(existsSync(join(wsDir, ".claude", "skills", "doc", "SKILL.md"))).toBe(true);

    // Registry now contains both the original quick session and the new
    // project session.
    const registry = JSON.parse(
      await readFile(join(home, ".pneuma", "sessions.json"), "utf-8")
    );
    const ids = registry.sessions.map((s: { id: string }) => s.id).sort();
    expect(ids).toContain(sessionId); // original preserved
    expect(ids).toContain(`${projRoot}::${newSessionId}`); // imported added
  });

  test("non-existent initFromSessions IDs are silently skipped", async () => {
    const projRoot = join(home, "skip-bad-ids");
    await mkdir(projRoot, { recursive: true });
    await mkdir(join(home, ".pneuma"), { recursive: true });
    await writeFile(
      join(home, ".pneuma", "sessions.json"),
      JSON.stringify({ projects: [], sessions: [] })
    );
    const res = await testApp.request("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        root: projRoot,
        name: "skip-bad",
        displayName: "Skip Bad",
        initFromSessions: ["does-not-exist::doc"],
      }),
    });
    // Project still created; nothing imported.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.created).toBe(true);
    expect(body.importedSessions).toEqual([]);
    // No founder set.
    const m = JSON.parse(
      await readFile(join(projRoot, ".pneuma", "project.json"), "utf-8")
    );
    expect(m.founderSessionId).toBeUndefined();
  });

  test("multiple imports leave founderSessionId unset", async () => {
    // Two source quick sessions
    const wsA = join(home, "ws-a");
    const wsB = join(home, "ws-b");
    for (const w of [wsA, wsB]) {
      await mkdir(join(w, ".pneuma"), { recursive: true });
      await writeFile(
        join(w, ".pneuma", "session.json"),
        JSON.stringify({ sessionId: "x", mode: "doc", backendType: "claude-code", createdAt: 1 })
      );
      await writeFile(join(w, ".pneuma", "history.json"), "[]");
    }
    const idA = `${wsA}::doc`;
    const idB = `${wsB}::doc`;
    await mkdir(join(home, ".pneuma"), { recursive: true });
    await writeFile(
      join(home, ".pneuma", "sessions.json"),
      JSON.stringify({
        projects: [],
        sessions: [
          { id: idA, kind: "quick", mode: "doc", displayName: "A", workspace: wsA, sessionDir: wsA, backendType: "claude-code", lastAccessed: 1 },
          { id: idB, kind: "quick", mode: "doc", displayName: "B", workspace: wsB, sessionDir: wsB, backendType: "claude-code", lastAccessed: 2 },
        ],
      })
    );

    const projRoot = join(home, "multi-init");
    await mkdir(projRoot, { recursive: true });
    const res = await testApp.request("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        root: projRoot,
        name: "multi",
        displayName: "Multi",
        initFromSessions: [idA, idB],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.importedSessions).toHaveLength(2);
    const m = JSON.parse(
      await readFile(join(projRoot, ".pneuma", "project.json"), "utf-8")
    );
    expect(m.founderSessionId).toBeUndefined();
  });
});

describe("GET /api/projects/:id/sessions", () => {
  test("returns sessions in the project", async () => {
    const projRoot = join(home, "sessions-proj");
    await mkdir(join(projRoot, ".pneuma", "sessions", "abc"), { recursive: true });
    await writeFile(
      join(projRoot, ".pneuma", "project.json"),
      JSON.stringify({ version: 1, name: "p", displayName: "P", createdAt: 1 })
    );
    await writeFile(
      join(projRoot, ".pneuma", "sessions", "abc", "session.json"),
      JSON.stringify({ sessionId: "abc", mode: "doc", backendType: "claude-code", createdAt: 1 })
    );

    const id = encodeURIComponent(projRoot);
    const res = await testApp.request(`/api/projects/${id}/sessions`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].sessionId).toBe("abc");
  });

  test("surfaces backendType, displayName, and lastAccessed on session refs", async () => {
    const projRoot = join(home, "rich-sessions-proj");
    const sessionDir = join(projRoot, ".pneuma", "sessions", "rich");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(projRoot, ".pneuma", "project.json"),
      JSON.stringify({ version: 1, name: "p", displayName: "P", createdAt: 1 })
    );
    await writeFile(
      join(sessionDir, "session.json"),
      JSON.stringify({
        sessionId: "rich",
        mode: "webcraft",
        backendType: "codex",
        sessionName: "Marketing Site",
        createdAt: 100,
      })
    );
    // history.json drives lastAccessed when present.
    await writeFile(join(sessionDir, "history.json"), JSON.stringify([]));

    const id = encodeURIComponent(projRoot);
    const res = await testApp.request(`/api/projects/${id}/sessions`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions).toHaveLength(1);
    const ref = body.sessions[0];
    expect(ref.sessionId).toBe("rich");
    expect(ref.backendType).toBe("codex");
    expect(ref.displayName).toBe("Marketing Site");
    expect(typeof ref.lastAccessed).toBe("number");
    expect(ref.lastAccessed).toBeGreaterThan(0);
  });

  test("returns 404 when not a project", async () => {
    const id = encodeURIComponent("/nonexistent/path");
    const res = await testApp.request(`/api/projects/${id}/sessions`);
    expect(res.status).toBe(404);
  });
});

describe("POST /api/handoffs/:id/cancel", () => {
  test("removes handoff file", async () => {
    const projRoot = join(home, "cancel-proj");
    const handoffsDir = join(projRoot, ".pneuma", "handoffs");
    await mkdir(handoffsDir, { recursive: true });
    await writeFile(
      join(projRoot, ".pneuma", "project.json"),
      JSON.stringify({ version: 1, name: "p", displayName: "P", createdAt: 1 })
    );
    await writeFile(
      join(handoffsDir, "h-cancel.md"),
      `---\nhandoff_id: h-cancel\ntarget_mode: webcraft\nsource_session: src\nsource_mode: doc\nintent: x\ncreated_at: 2026-04-27T00:00:00Z\n---\nbody\n`
    );

    const res = await testApp.request(
      `/api/handoffs/h-cancel/cancel?project=${encodeURIComponent(projRoot)}`,
      { method: "POST" }
    );
    expect(res.status).toBe(200);
    expect(existsSync(join(handoffsDir, "h-cancel.md"))).toBe(false);
  });

  test("404 when handoff file does not exist", async () => {
    const projRoot = join(home, "cancel-noexist");
    await mkdir(join(projRoot, ".pneuma"), { recursive: true });
    await writeFile(
      join(projRoot, ".pneuma", "project.json"),
      JSON.stringify({ version: 1, name: "p", displayName: "P", createdAt: 1 })
    );
    const res = await testApp.request(
      `/api/handoffs/missing/cancel?project=${encodeURIComponent(projRoot)}`,
      { method: "POST" }
    );
    expect(res.status).toBe(404);
  });

  test("400 when project query param missing", async () => {
    const res = await testApp.request("/api/handoffs/x/cancel", { method: "POST" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/handoffs/:id/confirm", () => {
  test("kills source, launches target, writes session_event to source history", async () => {
    const projRoot = join(home, "confirm-proj");
    await mkdir(join(projRoot, ".pneuma", "sessions", "src-1"), { recursive: true });
    await writeFile(
      join(projRoot, ".pneuma", "project.json"),
      JSON.stringify({ version: 1, name: "p", displayName: "P", createdAt: 1 })
    );
    // Source session with empty history
    await writeFile(
      join(projRoot, ".pneuma", "sessions", "src-1", "session.json"),
      JSON.stringify({ sessionId: "src-1", mode: "doc", backendType: "claude-code", createdAt: 1 })
    );
    await writeFile(
      join(projRoot, ".pneuma", "sessions", "src-1", "history.json"),
      JSON.stringify([])
    );
    // Handoff file
    const handoffsDir = join(projRoot, ".pneuma", "handoffs");
    await mkdir(handoffsDir, { recursive: true });
    await writeFile(
      join(handoffsDir, "h-confirm.md"),
      `---\nhandoff_id: h-confirm\ntarget_mode: webcraft\ntarget_session: auto\nsource_session: src-1\nsource_mode: doc\nintent: build site\ncreated_at: 2026-04-27T00:00:00Z\n---\nbody\n`
    );

    // Mock callbacks
    const killed: string[] = [];
    const launched: Array<{ mode: string; project: string; sessionId?: string }> = [];

    const mockApp = new Hono();
    mountProjectsRoutes(mockApp, {
      homeDir: home,
      killSession: async (sid) => { killed.push(sid); },
      launchSession: async (params) => {
        launched.push(params);
        return "http://localhost:17080?session=mock-target&mode=webcraft";
      },
    });

    const res = await mockApp.request(
      `/api/handoffs/h-confirm/confirm?project=${encodeURIComponent(projRoot)}`,
      { method: "POST" }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.confirmed).toBe(true);
    expect(body.launchUrl).toContain("session=mock-target");

    expect(killed).toEqual(["src-1"]);
    expect(launched).toHaveLength(1);
    expect(launched[0].mode).toBe("webcraft");
    expect(launched[0].project).toBe(projRoot);

    // source history has switched_out event
    const hist = JSON.parse(
      await readFile(join(projRoot, ".pneuma", "sessions", "src-1", "history.json"), "utf-8")
    );
    expect(hist.some((e: { type?: string; subtype?: string }) =>
      e.type === "session_event" && e.subtype === "switched_out"
    )).toBe(true);
  });

  test("404 when handoff file missing", async () => {
    const projRoot = join(home, "confirm-noexist");
    await mkdir(join(projRoot, ".pneuma"), { recursive: true });
    await writeFile(
      join(projRoot, ".pneuma", "project.json"),
      JSON.stringify({ version: 1, name: "p", displayName: "P", createdAt: 1 })
    );
    const noopApp = new Hono();
    mountProjectsRoutes(noopApp, {
      homeDir: home,
      killSession: async () => {},
      launchSession: async () => "http://example",
    });
    const res = await noopApp.request(
      `/api/handoffs/missing/confirm?project=${encodeURIComponent(projRoot)}`,
      { method: "POST" }
    );
    expect(res.status).toBe(404);
  });
});

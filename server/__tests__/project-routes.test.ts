import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { startServer } from "../index.js";
import { createProjectSession, recentProjectsRegistryPath } from "../../core/project.js";

const TEST_PORT = 19891;
const TEST_WORKSPACE = join(tmpdir(), `pneuma-project-routes-workspace-${Date.now()}`);
const TEST_PROJECT = join(tmpdir(), `pneuma-project-routes-project-${Date.now()}`);
const TEST_QUICK_WORKSPACE = join(tmpdir(), `pneuma-project-routes-quick-${Date.now()}`);
const REGISTRY_PATH = recentProjectsRegistryPath(homedir());
const SESSION_REGISTRY_PATH = join(homedir(), ".pneuma", "sessions.json");

let server: Awaited<ReturnType<typeof startServer>>;
let registryBackup: string | null = null;
let hadRegistry = false;
let sessionRegistryBackup: string | null = null;
let hadSessionRegistry = false;

function api(path: string, init?: RequestInit) {
  return fetch(`http://localhost:${TEST_PORT}${path}`, init);
}

describe("project launcher routes", () => {
  beforeAll(async () => {
    mkdirSync(TEST_WORKSPACE, { recursive: true });
    mkdirSync(TEST_PROJECT, { recursive: true });
    mkdirSync(TEST_QUICK_WORKSPACE, { recursive: true });
    mkdirSync(join(homedir(), ".pneuma"), { recursive: true });
    hadRegistry = existsSync(REGISTRY_PATH);
    if (hadRegistry) registryBackup = readFileSync(REGISTRY_PATH, "utf-8");
    hadSessionRegistry = existsSync(SESSION_REGISTRY_PATH);
    if (hadSessionRegistry) sessionRegistryBackup = readFileSync(SESSION_REGISTRY_PATH, "utf-8");

    server = await startServer({
      port: TEST_PORT,
      workspace: TEST_WORKSPACE,
      launcherMode: true,
    });
  });

  afterAll(() => {
    server?.stop?.();
    rmSync(TEST_WORKSPACE, { recursive: true, force: true });
    rmSync(TEST_PROJECT, { recursive: true, force: true });
    rmSync(TEST_QUICK_WORKSPACE, { recursive: true, force: true });
    if (hadRegistry && registryBackup !== null) {
      writeFileSync(REGISTRY_PATH, registryBackup);
    } else {
      rmSync(REGISTRY_PATH, { force: true });
    }
    if (hadSessionRegistry && sessionRegistryBackup !== null) {
      writeFileSync(SESSION_REGISTRY_PATH, sessionRegistryBackup);
    } else {
      rmSync(SESSION_REGISTRY_PATH, { force: true });
    }
  });

  test("GET /api/projects returns a projects array", async () => {
    const res = await api("/api/projects");
    expect(res.status).toBe(200);
    const body = await res.json() as { projects: unknown[] };
    expect(Array.isArray(body.projects)).toBe(true);
  });

  test("POST /api/projects creates an explicit project", async () => {
    const res = await api("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        root: TEST_PROJECT,
        name: "Route Project",
        description: "Created from the launcher API",
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { project: { name: string; root: string } };
    expect(body.project.name).toBe("Route Project");
    expect(body.project.root).toBe(TEST_PROJECT);
  });

  test("GET /api/projects includes newly created projects", async () => {
    const res = await api("/api/projects");
    const body = await res.json() as { projects: Array<{ name: string; root: string }> };
    expect(body.projects.some((p) => p.name === "Route Project" && p.root === TEST_PROJECT)).toBe(true);
  });

  test("GET /api/projects/:projectId returns project identity and sessions", async () => {
    createProjectSession(TEST_PROJECT, {
      mode: "webcraft",
      displayName: "Webcraft",
      backendType: "codex",
      role: "Build the home page",
      now: () => "2026-04-28T08:00:00.000Z",
      idFactory: () => "web-overview",
    });

    const listRes = await api("/api/projects");
    const listBody = await listRes.json() as { projects: Array<{ projectId: string; name: string }> };
    const record = listBody.projects.find((p) => p.name === "Route Project");
    expect(record).toBeDefined();

    const res = await api(`/api/projects/${encodeURIComponent(record!.projectId)}`);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      project: { name: string; description?: string; root: string; createdAt: string };
      sessions: Array<{ sessionId: string; mode: string; role?: string; backendType: string; status: string; lastAccessed: string }>;
    };

    expect(body.project).toMatchObject({
      name: "Route Project",
      description: "Created from the launcher API",
      root: TEST_PROJECT,
    });
    expect(body.project.createdAt).toBeTruthy();
    expect(body.sessions).toEqual([
      expect.objectContaining({
        sessionId: "web-overview",
        mode: "webcraft",
        role: "Build the home page",
        backendType: "codex",
        status: "active",
        lastAccessed: "2026-04-28T08:00:00.000Z",
      }),
    ]);
  });

  test("project handoff routes draft reviewed context and confirm a target session", async () => {
    const listRes = await api("/api/projects");
    const listBody = await listRes.json() as { projects: Array<{ projectId: string; name: string }> };
    const record = listBody.projects.find((p) => p.name === "Route Project");
    expect(record).toBeDefined();
    const beforeRes = await api(`/api/projects/${encodeURIComponent(record!.projectId)}`);
    const beforeBody = await beforeRes.json() as { sessions: Array<{ sessionId: string }> };

    const draftRes = await api(`/api/projects/${encodeURIComponent(record!.projectId)}/handoffs/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fromSessionId: "web-overview",
        toMode: "doc",
        goal: "Turn the page into a launch brief.",
      }),
    });
    expect(draftRes.status).toBe(200);
    const draftBody = await draftRes.json() as { handoffId: string; content: string };
    expect(draftBody.content).toContain("fromSessionId: web-overview");
    expect(draftBody.content).toContain("toMode: doc");
    expect(draftBody.content).toContain("Turn the page into a launch brief.");

    const confirmRes = await api(`/api/projects/${encodeURIComponent(record!.projectId)}/handoffs/${encodeURIComponent(draftBody.handoffId)}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: `${draftBody.content}\nReviewed in Launcher.\n`,
        toMode: "doc",
        targetDisplayName: "Doc",
        backendType: "codex",
      }),
    });
    expect(confirmRes.status).toBe(200);
    const confirmBody = await confirmRes.json() as { handoff: { toSessionId?: string; content: string }; targetSession: { sessionId: string; mode: string } };
    expect(confirmBody.targetSession.mode).toBe("doc");
    expect(confirmBody.handoff.toSessionId).toBe(confirmBody.targetSession.sessionId);
    expect(confirmBody.handoff.content).toContain("Reviewed in Launcher.");
  });

  test("handoff confirm rejects edited frontmatter that targets a different mode", async () => {
    const listRes = await api("/api/projects");
    const listBody = await listRes.json() as { projects: Array<{ projectId: string; name: string }> };
    const record = listBody.projects.find((p) => p.name === "Route Project");
    expect(record).toBeDefined();
    const beforeRes = await api(`/api/projects/${encodeURIComponent(record!.projectId)}`);
    const beforeBody = await beforeRes.json() as { sessions: Array<{ sessionId: string }> };

    const draftRes = await api(`/api/projects/${encodeURIComponent(record!.projectId)}/handoffs/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fromSessionId: "web-overview",
        toMode: "doc",
      }),
    });
    const draftBody = await draftRes.json() as { handoffId: string; content: string };
    const mismatchedContent = draftBody.content.replace("toMode: doc", "toMode: webcraft");

    const confirmRes = await api(`/api/projects/${encodeURIComponent(record!.projectId)}/handoffs/${encodeURIComponent(draftBody.handoffId)}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: mismatchedContent,
        toMode: "doc",
        targetDisplayName: "Doc",
        backendType: "codex",
        newSession: true,
      }),
    });

    expect(confirmRes.status).toBe(400);
    const afterRes = await api(`/api/projects/${encodeURIComponent(record!.projectId)}`);
    const afterBody = await afterRes.json() as { sessions: Array<{ sessionId: string }> };
    expect(afterBody.sessions).toHaveLength(beforeBody.sessions.length);
  });

  test("POST /api/projects/upgrade-session creates a project from a quick session fork", async () => {
    mkdirSync(join(TEST_QUICK_WORKSPACE, ".pneuma"), { recursive: true });
    writeFileSync(join(TEST_QUICK_WORKSPACE, ".pneuma", "session.json"), JSON.stringify({
      sessionId: "quick-route",
      mode: "doc",
      backendType: "codex",
      createdAt: 123,
    }, null, 2));
    writeFileSync(join(TEST_QUICK_WORKSPACE, ".pneuma", "history.json"), JSON.stringify([{ content: "route history" }]));
    writeFileSync(join(TEST_QUICK_WORKSPACE, "route-brief.md"), "# Route Brief\n");

    const upgradeRoot = join(TEST_PROJECT, "upgraded-route");
    const res = await api("/api/projects/upgrade-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceWorkspace: TEST_QUICK_WORKSPACE,
        projectRoot: upgradeRoot,
        name: "Route Upgrade",
        displayName: "Doc",
        deliverableTransfer: "copy",
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { project: { name: string; root: string }; session: { sourceQuickSessionId?: string; sessionWorkspace: string } };
    expect(body.project).toMatchObject({ name: "Route Upgrade", root: upgradeRoot });
    expect(body.session.sourceQuickSessionId).toBe("quick-route");
    expect(readFileSync(join(upgradeRoot, "route-brief.md"), "utf-8")).toBe("# Route Brief\n");
    expect(readFileSync(join(body.session.sessionWorkspace, ".pneuma", "history.json"), "utf-8")).toContain("route history");
    expect(existsSync(join(TEST_QUICK_WORKSPACE, ".pneuma", "session.json"))).toBe(true);
  });

  test("POST /api/projects/:projectId/evolve runs project-scoped evolution", async () => {
    const listRes = await api("/api/projects");
    const listBody = await listRes.json() as { projects: Array<{ projectId: string; name: string }> };
    const record = listBody.projects.find((p) => p.name === "Route Project");
    expect(record).toBeDefined();
    writeFileSync(join(TEST_PROJECT, "project-evolve.md"), "# Project Evolve\n");

    const res = await api(`/api/projects/${encodeURIComponent(record!.projectId)}/evolve`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { sourceSessionCount: number; preferencesPath: string };

    expect(body.sourceSessionCount).toBeGreaterThan(0);
    expect(body.preferencesPath).toBe(join(TEST_PROJECT, ".pneuma", "project-preferences.md"));
    expect(readFileSync(body.preferencesPath, "utf-8")).toContain("Project Evolution");
    expect(readFileSync(join(TEST_PROJECT, ".pneuma", "timeline.jsonl"), "utf-8")).toContain("project.evolved");
  });

  test("GET /api/sessions filters stale project session registry entries", async () => {
    const projectSession = createProjectSession(TEST_PROJECT, {
      mode: "doc",
      displayName: "Doc",
      backendType: "codex",
      now: () => "2026-04-28T09:00:00.000Z",
      idFactory: () => "doc-stale-registry",
    });

    writeFileSync(SESSION_REGISTRY_PATH, JSON.stringify([
      {
        id: `${projectSession.sessionWorkspace}::doc`,
        mode: "doc",
        displayName: "Doc",
        workspace: projectSession.sessionWorkspace,
        backendType: "codex",
        lastAccessed: 2,
      },
      {
        id: `${TEST_QUICK_WORKSPACE}::doc`,
        mode: "doc",
        displayName: "Doc",
        workspace: TEST_QUICK_WORKSPACE,
        backendType: "codex",
        lastAccessed: 1,
      },
    ]));

    const res = await api("/api/sessions");
    expect(res.status).toBe(200);
    const body = await res.json() as { sessions: Array<{ workspace: string }> };
    expect(body.sessions.map((session) => session.workspace)).toEqual([TEST_QUICK_WORKSPACE]);
  });

  test("GET /api/processes/children exposes project metadata for launched project sessions", async () => {
    const pid = 424242;
    server.childProcesses.set(pid, {
      proc: {} as never,
      specifier: "webcraft",
      workspace: TEST_PROJECT,
      projectRoot: TEST_PROJECT,
      projectSessionId: "web-overview",
      url: "http://localhost:18000",
      startedAt: 123,
    });

    const res = await api("/api/processes/children");
    expect(res.status).toBe(200);
    const body = await res.json() as { processes: Array<{ pid: number; projectRoot?: string; projectSessionId?: string }> };
    expect(body.processes.find((process) => process.pid === pid)).toMatchObject({
      projectRoot: TEST_PROJECT,
      projectSessionId: "web-overview",
    });

    server.childProcesses.delete(pid);
  });
});

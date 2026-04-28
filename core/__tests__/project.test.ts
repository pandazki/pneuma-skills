import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createProject,
  createProjectSession,
  listProjectSessions,
  loadProjectSession,
  loadProject,
  loadRecentProjects,
  projectManifestPath,
  projectPneumaDir,
  projectSessionDir,
  projectSessionWorkspace,
  recentProjectsRegistryPath,
  recordRecentProject,
  resolveProjectRuntime,
} from "../project.js";

describe("project manifest", () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `pneuma-project-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("createProject writes project.json and project-preferences.md", () => {
    const project = createProject(root, {
      name: "Launch Site",
      description: "Marketing site for Pneuma",
      now: () => "2026-04-28T00:00:00.000Z",
      idFactory: () => "project_123",
    });

    expect(project.projectId).toBe("project_123");
    expect(project.name).toBe("Launch Site");
    expect(project.root).toBe(root);
    expect(existsSync(projectManifestPath(root))).toBe(true);
    expect(existsSync(join(projectPneumaDir(root), "project-preferences.md"))).toBe(true);

    const loaded = loadProject(root);
    expect(loaded?.description).toBe("Marketing site for Pneuma");
  });

  test("createProject derives a readable name from the directory when name is omitted", () => {
    const project = createProject(root, {
      now: () => "2026-04-28T00:00:00.000Z",
      idFactory: () => "project_derived",
    });

    expect(project.name).toBe(root.split("/").pop());
  });

  test("loadProject returns null when project.json is absent", () => {
    expect(loadProject(root)).toBeNull();
  });
});

describe("project sessions", () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `pneuma-project-session-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
    createProject(root, {
      name: "Session Project",
      now: () => "2026-04-28T00:00:00.000Z",
      idFactory: () => "project_sessions",
    });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("createProjectSession creates session.json, workspace, and scratch", () => {
    const session = createProjectSession(root, {
      mode: "webcraft",
      displayName: "Webcraft",
      backendType: "claude-code",
      role: "Build the landing page",
      now: () => "2026-04-28T01:00:00.000Z",
      idFactory: () => "webcraft-abc",
    });

    expect(session.sessionId).toBe("webcraft-abc");
    expect(session.projectId).toBe("project_sessions");
    expect(session.sessionWorkspace).toBe(projectSessionWorkspace(root, "webcraft-abc"));
    expect(existsSync(join(projectSessionDir(root, "webcraft-abc"), "session.json"))).toBe(true);
    expect(existsSync(projectSessionWorkspace(root, "webcraft-abc"))).toBe(true);
    expect(existsSync(join(projectSessionDir(root, "webcraft-abc"), "scratch"))).toBe(true);
  });

  test("listProjectSessions returns sessions sorted by lastAccessed descending", () => {
    createProjectSession(root, {
      mode: "doc",
      displayName: "Doc",
      backendType: "claude-code",
      now: () => "2026-04-28T01:00:00.000Z",
      idFactory: () => "doc-old",
    });
    createProjectSession(root, {
      mode: "webcraft",
      displayName: "Webcraft",
      backendType: "codex",
      now: () => "2026-04-28T02:00:00.000Z",
      idFactory: () => "web-new",
    });

    expect(listProjectSessions(root).map((s) => s.sessionId)).toEqual(["web-new", "doc-old"]);
  });
});

describe("recent project registry", () => {
  let home: string;
  let root: string;

  beforeEach(() => {
    home = join(tmpdir(), `pneuma-project-home-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    root = join(tmpdir(), `pneuma-project-registry-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(home, { recursive: true });
    mkdirSync(root, { recursive: true });
    createProject(root, {
      name: "Registry Project",
      now: () => "2026-04-28T00:00:00.000Z",
      idFactory: () => "project_registry",
    });
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  });

  test("recordRecentProject writes ~/.pneuma/projects.json style records", () => {
    recordRecentProject(root, {
      homeDir: home,
      now: () => "2026-04-28T03:00:00.000Z",
    });

    expect(existsSync(recentProjectsRegistryPath(home))).toBe(true);
    const records = loadRecentProjects(home);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      projectId: "project_registry",
      name: "Registry Project",
      root,
      lastAccessed: "2026-04-28T03:00:00.000Z",
    });
  });

  test("recordRecentProject de-duplicates by projectId and keeps newest first", () => {
    recordRecentProject(root, { homeDir: home, now: () => "2026-04-28T03:00:00.000Z" });
    recordRecentProject(root, { homeDir: home, now: () => "2026-04-28T04:00:00.000Z" });

    const records = loadRecentProjects(home);
    expect(records).toHaveLength(1);
    expect(records[0].lastAccessed).toBe("2026-04-28T04:00:00.000Z");
  });
});

describe("project runtime", () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `pneuma-project-runtime-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("resolveProjectRuntime creates a project session workspace", () => {
    const runtime = resolveProjectRuntime({
      projectRoot: root,
      mode: "webcraft",
      displayName: "Webcraft",
      backendType: "claude-code",
      role: "Build the hero section",
      now: () => "2026-04-28T05:00:00.000Z",
      projectIdFactory: () => "project_runtime",
      sessionIdFactory: () => "web-runtime",
    });

    expect(runtime.project.projectId).toBe("project_runtime");
    expect(runtime.session.sessionId).toBe("web-runtime");
    expect(runtime.workspace).toBe(join(root, ".pneuma", "sessions", "web-runtime", "workspace"));
    expect(runtime.projectRoot).toBe(root);
  });

  test("resolveProjectRuntime resumes an existing project session when sessionId is provided", () => {
    createProject(root, {
      name: "Resume Project",
      now: () => "2026-04-28T00:00:00.000Z",
      idFactory: () => "project_resume",
    });
    createProjectSession(root, {
      mode: "doc",
      displayName: "Doc",
      backendType: "codex",
      role: "Draft copy",
      now: () => "2026-04-28T01:00:00.000Z",
      idFactory: () => "doc-existing",
    });

    const runtime = resolveProjectRuntime({
      projectRoot: root,
      mode: "doc",
      displayName: "Doc",
      backendType: "codex",
      sessionId: "doc-existing",
      now: () => "2026-04-28T06:00:00.000Z",
    });

    expect(runtime.session.sessionId).toBe("doc-existing");
    expect(runtime.session.role).toBe("Draft copy");
    expect(runtime.workspace).toBe(projectSessionWorkspace(root, "doc-existing"));
    expect(listProjectSessions(root)).toHaveLength(1);
    expect(loadProjectSession(root, "doc-existing")?.lastAccessed).toBe("2026-04-28T06:00:00.000Z");
  });
});

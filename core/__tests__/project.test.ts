import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildProjectInstructionContext,
  confirmProjectHandoff,
  createProject,
  createProjectHandoffDraft,
  createProjectSession,
  listProjectSessions,
  loadProjectSession,
  loadProject,
  loadRecentProjects,
  projectHandoffPath,
  projectManifestPath,
  projectPneumaDir,
  projectSessionDir,
  projectSessionWorkspace,
  recentProjectsRegistryPath,
  recordRecentProject,
  resolveProjectRuntime,
  runProjectEvolution,
  upgradeQuickSessionToProject,
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

describe("project instruction context", () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `pneuma-project-context-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
    createProject(root, {
      name: "Context Project",
      description: "Cross-mode project",
      now: () => "2026-04-28T00:00:00.000Z",
      idFactory: () => "project_context",
    });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("buildProjectInstructionContext summarizes project identity and peer sessions without workspace paths", () => {
    createProjectSession(root, {
      mode: "doc",
      displayName: "Doc",
      backendType: "claude-code",
      role: "Draft the copy",
      now: () => "2026-04-28T01:00:00.000Z",
      idFactory: () => "doc-peer",
    });
    const runtime = resolveProjectRuntime({
      projectRoot: root,
      mode: "webcraft",
      displayName: "Webcraft",
      backendType: "codex",
      role: "Build the page",
      now: () => "2026-04-28T02:00:00.000Z",
      sessionIdFactory: () => "web-current",
    });

    const context = buildProjectInstructionContext(runtime);

    expect(context).toMatchObject({
      projectId: "project_context",
      projectName: "Context Project",
      projectRoot: root,
      description: "Cross-mode project",
      role: "Build the page",
      currentSessionId: "web-current",
      currentMode: "webcraft",
      currentSessionDisplayName: "Webcraft",
    });
    expect(context.peerSessions).toEqual([
      {
        sessionId: "doc-peer",
        mode: "doc",
        displayName: "Doc",
        role: "Draft the copy",
        backendType: "claude-code",
        status: "active",
        lastAccessed: "2026-04-28T01:00:00.000Z",
      },
    ]);
    expect(JSON.stringify(context)).not.toContain("sessionWorkspace");
    expect(JSON.stringify(context)).not.toContain(projectSessionWorkspace(root, "doc-peer"));
  });
});

describe("project handoffs", () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `pneuma-project-handoff-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
    createProject(root, {
      name: "Handoff Project",
      now: () => "2026-04-28T00:00:00.000Z",
      idFactory: () => "project_handoff",
    });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("createProjectHandoffDraft creates a reviewable draft without raw source session history", () => {
    createProjectSession(root, {
      mode: "webcraft",
      displayName: "Webcraft",
      backendType: "codex",
      role: "Build the landing page",
      now: () => "2026-04-28T01:00:00.000Z",
      idFactory: () => "web-source",
    });
    mkdirSync(join(projectSessionWorkspace(root, "web-source"), ".pneuma"), { recursive: true });
    writeFileSync(join(projectSessionWorkspace(root, "web-source"), ".pneuma", "history.json"), "raw-history-secret");

    const draft = createProjectHandoffDraft(root, {
      fromSessionId: "web-source",
      toMode: "doc",
      goal: "Turn the landing page decisions into launch copy.",
      now: () => "2026-04-28T02:00:00.000Z",
      idFactory: () => "handoff-1",
    });

    expect(draft.handoffId).toBe("handoff-1");
    expect(draft.content).toContain("handoffId: handoff-1");
    expect(draft.content).toContain("fromSessionId: web-source");
    expect(draft.content).toContain("fromMode: webcraft");
    expect(draft.content).toContain("toMode: doc");
    expect(draft.content).toContain("## Goal");
    expect(draft.content).toContain("## Decisions");
    expect(draft.content).toContain("## Constraints");
    expect(draft.content).toContain("## Relevant Files");
    expect(draft.content).toContain("## Open Questions");
    expect(draft.content).toContain("## Suggested Next Step");
    expect(draft.content).toContain("Turn the landing page decisions into launch copy.");
    expect(draft.content).not.toContain("raw-history-secret");
    expect(draft.content).not.toContain(projectSessionWorkspace(root, "web-source"));
  });

  test("confirmProjectHandoff writes a confirmed handoff and startup context can include it", () => {
    createProjectSession(root, {
      mode: "webcraft",
      displayName: "Webcraft",
      backendType: "codex",
      now: () => "2026-04-28T01:00:00.000Z",
      idFactory: () => "web-source",
    });
    createProjectSession(root, {
      mode: "doc",
      displayName: "Doc",
      backendType: "codex",
      now: () => "2026-04-28T02:00:00.000Z",
      idFactory: () => "doc-target",
    });
    const draft = createProjectHandoffDraft(root, {
      fromSessionId: "web-source",
      toMode: "doc",
      now: () => "2026-04-28T03:00:00.000Z",
      idFactory: () => "handoff-2",
    });

    const handoff = confirmProjectHandoff(root, {
      handoffId: draft.handoffId,
      content: `${draft.content}\nReviewed context only.\n`,
      toSessionId: "doc-target",
      now: () => "2026-04-28T04:00:00.000Z",
    });
    const written = readFileSync(projectHandoffPath(root, "handoff-2"), "utf-8");

    expect(handoff.toSessionId).toBe("doc-target");
    expect(written).toContain("toSessionId: doc-target");
    expect(written).toContain("confirmedAt: 2026-04-28T04:00:00.000Z");
    expect(written).toContain("Reviewed context only.");

    const runtime = resolveProjectRuntime({
      projectRoot: root,
      mode: "doc",
      displayName: "Doc",
      backendType: "codex",
      sessionId: "doc-target",
      handoffId: "handoff-2",
      now: () => "2026-04-28T05:00:00.000Z",
    });
    const context = buildProjectInstructionContext(runtime);

    expect(context.handoff).toMatchObject({
      handoffId: "handoff-2",
      fromSessionId: "web-source",
      toSessionId: "doc-target",
      fromMode: "webcraft",
      toMode: "doc",
    });
    expect(context.handoff?.content).toContain("Reviewed context only.");
    expect(readFileSync(join(root, ".pneuma", "timeline.jsonl"), "utf-8")).toContain("handoff.created");
  });
});

describe("quick session upgrade", () => {
  let sourceWorkspace: string;
  let projectRoot: string;

  beforeEach(() => {
    sourceWorkspace = join(tmpdir(), `pneuma-quick-source-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    projectRoot = join(tmpdir(), `pneuma-upgraded-project-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(sourceWorkspace, ".pneuma"), { recursive: true });
    writeFileSync(join(sourceWorkspace, ".pneuma", "session.json"), JSON.stringify({
      sessionId: "quick-123",
      mode: "doc",
      backendType: "codex",
      createdAt: 123,
    }, null, 2));
    writeFileSync(join(sourceWorkspace, ".pneuma", "history.json"), JSON.stringify([{ role: "user", content: "source history" }]));
    writeFileSync(join(sourceWorkspace, ".pneuma", "config.json"), JSON.stringify({ topic: "launch" }));
    writeFileSync(join(sourceWorkspace, "brief.md"), "# Quick Brief\n");
  });

  afterEach(() => {
    rmSync(sourceWorkspace, { recursive: true, force: true });
    rmSync(projectRoot, { recursive: true, force: true });
  });

  test("upgradeQuickSessionToProject forks a quick session into a project without mutating the source", () => {
    const result = upgradeQuickSessionToProject(sourceWorkspace, projectRoot, {
      name: "Upgraded Project",
      description: "Long-running project",
      displayName: "Doc",
      copyDeliverables: true,
      now: () => "2026-04-28T06:00:00.000Z",
      projectIdFactory: () => "project_upgrade",
      sessionIdFactory: () => "doc-upgraded",
    });

    expect(result.project.projectId).toBe("project_upgrade");
    expect(result.session.sessionId).toBe("doc-upgraded");
    expect(result.session.sourceQuickSessionId).toBe("quick-123");
    expect(existsSync(join(sourceWorkspace, ".pneuma", "session.json"))).toBe(true);
    expect(readFileSync(join(sourceWorkspace, "brief.md"), "utf-8")).toBe("# Quick Brief\n");
    expect(readFileSync(join(projectRoot, "brief.md"), "utf-8")).toBe("# Quick Brief\n");
    expect(readFileSync(join(projectSessionWorkspace(projectRoot, "doc-upgraded"), ".pneuma", "history.json"), "utf-8")).toContain("source history");
    expect(readFileSync(join(projectSessionWorkspace(projectRoot, "doc-upgraded"), ".pneuma", "config.json"), "utf-8")).toContain("launch");
    expect(readFileSync(join(projectRoot, ".pneuma", "timeline.jsonl"), "utf-8")).toContain("session.upgraded");
  });

  test("upgradeQuickSessionToProject can leave deliverables in place", () => {
    upgradeQuickSessionToProject(sourceWorkspace, projectRoot, {
      name: "Metadata Only Project",
      displayName: "Doc",
      copyDeliverables: false,
      now: () => "2026-04-28T07:00:00.000Z",
      projectIdFactory: () => "project_metadata_only",
      sessionIdFactory: () => "doc-metadata-only",
    });

    expect(existsSync(join(projectRoot, "brief.md"))).toBe(false);
    expect(existsSync(join(sourceWorkspace, "brief.md"))).toBe(true);
  });

  test("upgradeQuickSessionToProject refuses to overwrite existing project deliverables", () => {
    mkdirSync(projectRoot, { recursive: true });
    writeFileSync(join(projectRoot, "brief.md"), "# Existing Project Brief\n");

    expect(() => upgradeQuickSessionToProject(sourceWorkspace, projectRoot, {
      name: "Collision Project",
      displayName: "Doc",
      copyDeliverables: true,
      now: () => "2026-04-28T07:30:00.000Z",
      projectIdFactory: () => "project_collision",
      sessionIdFactory: () => "doc-collision",
    })).toThrow("Refusing to overwrite existing project deliverable");

    expect(readFileSync(join(projectRoot, "brief.md"), "utf-8")).toBe("# Existing Project Brief\n");
    expect(readFileSync(join(sourceWorkspace, "brief.md"), "utf-8")).toBe("# Quick Brief\n");
  });
});

describe("project evolution", () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `pneuma-project-evolve-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
    createProject(root, {
      name: "Evolution Project",
      description: "Project-scoped learning",
      now: () => "2026-04-28T00:00:00.000Z",
      idFactory: () => "project_evolve",
    });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("runProjectEvolution scans project evidence and writes only project preferences", () => {
    createProjectSession(root, {
      mode: "webcraft",
      displayName: "Webcraft",
      backendType: "codex",
      role: "Build the site",
      now: () => "2026-04-28T01:00:00.000Z",
      idFactory: () => "web-evolve",
    });
    createProjectSession(root, {
      mode: "doc",
      displayName: "Doc",
      backendType: "codex",
      role: "Draft copy",
      now: () => "2026-04-28T02:00:00.000Z",
      idFactory: () => "doc-evolve",
    });
    const draft = createProjectHandoffDraft(root, {
      fromSessionId: "web-evolve",
      toMode: "doc",
      now: () => "2026-04-28T03:00:00.000Z",
      idFactory: () => "handoff-evolve",
    });
    confirmProjectHandoff(root, {
      handoffId: draft.handoffId,
      content: `${draft.content}\nKeep the tone concise.\n`,
      toSessionId: "doc-evolve",
      now: () => "2026-04-28T04:00:00.000Z",
    });
    writeFileSync(join(root, "index.html"), "<main>Launch</main>\n");
    const before = readFileSync(join(root, ".pneuma", "project-preferences.md"), "utf-8");

    const result = runProjectEvolution(root, {
      now: () => "2026-04-28T08:00:00.000Z",
    });
    const after = readFileSync(join(root, ".pneuma", "project-preferences.md"), "utf-8");

    expect(result.preferencesPath).toBe(join(root, ".pneuma", "project-preferences.md"));
    expect(result.sourceSessionCount).toBe(2);
    expect(result.handoffCount).toBe(1);
    expect(result.deliverableCount).toBe(1);
    expect(after).toContain(before);
    expect(after).toContain("## Project Evolution - 2026-04-28T08:00:00.000Z");
    expect(after).toContain("Sessions scanned: 2");
    expect(after).toContain("Handoffs scanned: 1");
    expect(after).toContain("Deliverables summarized: 1");
    expect(after).toContain("webcraft");
    expect(after).toContain("index.html");
    expect(readFileSync(join(root, ".pneuma", "timeline.jsonl"), "utf-8")).toContain("project.evolved");
  });
});

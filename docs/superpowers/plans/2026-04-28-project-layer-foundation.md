# Project Layer Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the foundation for optional Pneuma projects: project metadata, recent-project registry, project session sandboxes, and CLI/launcher launch plumbing while preserving quick-session behavior.

**Architecture:** Add a focused `core/project.ts` module that owns project manifests, session manifests, timeline events, and recent-project registry files. CLI launch code resolves a project session into a normal `workspace` pointing at `.pneuma/sessions/<session-id>/workspace`, while keeping `projectRoot` as explicit runtime metadata for later context injection and UI work.

**Tech Stack:** Bun, TypeScript, Hono launcher routes, existing `bin/pneuma.ts` CLI flow, existing Bun test suite.

---

## Scope

This plan implements the foundation needed before Launcher overview, editable cross-mode handoffs, project preference injection, quick-session upgrade UI, and project-level evolve. Those features are represented as follow-up board cards because they are independently testable subsystems.

This foundation must ship with one observable guarantee: `pneuma <mode>` still behaves as a quick session, while `pneuma <mode> --project <root> --role <role>` creates or uses a project and stores session state under the project session sandbox.

## File Map

- Create: `core/project.ts`
  - Project manifest types and read/write helpers.
  - Project session manifest helpers.
  - Timeline append helper.
  - Recent-project registry helpers.
  - Runtime session path resolver.

- Create: `core/__tests__/project.test.ts`
  - Unit tests for project creation, project loading, session sandbox resolution, timeline append, registry behavior, and corrupt manifest handling.

- Modify: `bin/pneuma-cli-helpers.ts`
  - Add `--project` and `--role` parsing.
  - Extend `ParsedCliArgs`.

- Modify: `bin/__tests__/pneuma-cli-helpers.test.ts`
  - Assert project and role flags parse without changing quick-session defaults.

- Modify: `bin/pneuma.ts`
  - Resolve project session runtime before workspace existence checks.
  - Use the session sandbox as `workspace` for skill install, config, history, watcher, server, and backend cwd.
  - Record recent project and project session metadata.

- Modify: `server/index.ts`
  - Add Launcher-mode project APIs.
  - Accept project launch fields in `/api/launch`.
  - Spawn child processes with `--project` and `--role` when requested.

- Create: `server/__tests__/project-routes.test.ts`
  - Route tests for listing projects, creating projects, project path validation, and project launch argument behavior where observable without spawning a real agent.

## Task 1: Project Domain Module

**Files:**
- Create: `core/project.ts`
- Create: `core/__tests__/project.test.ts`

- [ ] **Step 1: Write failing tests for project manifest creation**

Create `core/__tests__/project.test.ts` with this first test group:

```ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createProject,
  loadProject,
  projectManifestPath,
  projectPneumaDir,
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
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```bash
bun test core/__tests__/project.test.ts
```

Expected: FAIL because `core/project.ts` does not exist.

- [ ] **Step 3: Implement project manifest helpers**

Create `core/project.ts` with these exports:

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { homedir } from "node:os";

export interface ProjectManifest {
  schemaVersion: 1;
  projectId: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  root: string;
  deliverablePaths?: string[];
  defaultBackendType?: "claude-code" | "codex";
}

export interface CreateProjectOptions {
  name?: string;
  description?: string;
  now?: () => string;
  idFactory?: () => string;
}

export function projectPneumaDir(projectRoot: string): string {
  return join(resolve(projectRoot), ".pneuma");
}

export function projectManifestPath(projectRoot: string): string {
  return join(projectPneumaDir(projectRoot), "project.json");
}

export function projectPreferencesPath(projectRoot: string): string {
  return join(projectPneumaDir(projectRoot), "project-preferences.md");
}

export function projectTimelinePath(projectRoot: string): string {
  return join(projectPneumaDir(projectRoot), "timeline.jsonl");
}

export function projectSessionsDir(projectRoot: string): string {
  return join(projectPneumaDir(projectRoot), "sessions");
}

function defaultNow(): string {
  return new Date().toISOString();
}

function defaultProjectId(): string {
  return `project_${crypto.randomUUID()}`;
}

export function loadProject(projectRoot: string): ProjectManifest | null {
  const filePath = projectManifestPath(projectRoot);
  if (!existsSync(filePath)) return null;
  const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as ProjectManifest;
  if (parsed.schemaVersion !== 1 || !parsed.projectId || !parsed.name) {
    throw new Error(`Invalid Pneuma project manifest: ${filePath}`);
  }
  return { ...parsed, root: resolve(projectRoot) };
}

export function createProject(projectRoot: string, options: CreateProjectOptions = {}): ProjectManifest {
  const root = resolve(projectRoot);
  const existing = loadProject(root);
  if (existing) return existing;

  const now = options.now?.() ?? defaultNow();
  const manifest: ProjectManifest = {
    schemaVersion: 1,
    projectId: options.idFactory?.() ?? defaultProjectId(),
    name: options.name?.trim() || basename(root),
    ...(options.description?.trim() ? { description: options.description.trim() } : {}),
    createdAt: now,
    updatedAt: now,
    root,
  };

  mkdirSync(projectPneumaDir(root), { recursive: true });
  mkdirSync(projectSessionsDir(root), { recursive: true });
  writeFileSync(projectManifestPath(root), JSON.stringify(manifest, null, 2));
  if (!existsSync(projectPreferencesPath(root))) {
    writeFileSync(projectPreferencesPath(root), "# Project Preferences\n\n");
  }
  appendProjectTimelineEvent(root, {
    type: "project.created",
    at: now,
    projectId: manifest.projectId,
    name: manifest.name,
  });
  return manifest;
}
```

Add the timeline helper at the bottom of the same file:

```ts
export type ProjectTimelineEvent =
  | { type: "project.created"; at: string; projectId: string; name: string }
  | { type: "project.updated"; at: string; changes: Record<string, unknown> }
  | { type: "session.created"; at: string; sessionId: string; mode: string; role?: string }
  | { type: "session.resumed"; at: string; sessionId: string }
  | { type: "deliverable.published"; at: string; sessionId: string; paths: string[] };

export function appendProjectTimelineEvent(projectRoot: string, event: ProjectTimelineEvent): void {
  mkdirSync(projectPneumaDir(projectRoot), { recursive: true });
  const line = `${JSON.stringify(event)}\n`;
  const path = projectTimelinePath(projectRoot);
  writeFileSync(path, line, { flag: "a" });
}
```

- [ ] **Step 4: Run the focused test and confirm it passes**

Run:

```bash
bun test core/__tests__/project.test.ts
```

Expected: PASS for the manifest test group.

## Task 2: Project Session Sandboxes

**Files:**
- Modify: `core/project.ts`
- Modify: `core/__tests__/project.test.ts`

- [ ] **Step 1: Add failing tests for session sandbox creation**

Append these tests to `core/__tests__/project.test.ts`:

```ts
import {
  createProjectSession,
  listProjectSessions,
  projectSessionDir,
  projectSessionWorkspace,
} from "../project.js";

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
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```bash
bun test core/__tests__/project.test.ts
```

Expected: FAIL because session helper exports do not exist.

- [ ] **Step 3: Implement session helpers**

Add these exports to `core/project.ts`:

```ts
export interface ProjectSessionManifest {
  schemaVersion: 1;
  sessionId: string;
  projectId: string;
  mode: string;
  role?: string;
  displayName: string;
  backendType: "claude-code" | "codex";
  status: "active" | "idle" | "archived";
  createdAt: string;
  lastAccessed: string;
  sessionWorkspace: string;
  deliverablePaths?: string[];
  sourceQuickSessionId?: string;
}

export interface CreateProjectSessionOptions {
  mode: string;
  displayName: string;
  backendType: "claude-code" | "codex";
  role?: string;
  now?: () => string;
  idFactory?: () => string;
}

export function projectSessionDir(projectRoot: string, sessionId: string): string {
  return join(projectSessionsDir(projectRoot), sessionId);
}

export function projectSessionWorkspace(projectRoot: string, sessionId: string): string {
  return join(projectSessionDir(projectRoot, sessionId), "workspace");
}

function defaultSessionId(mode: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `${mode}-${stamp}-${crypto.randomUUID().slice(0, 8)}`;
}

export function createProjectSession(
  projectRoot: string,
  options: CreateProjectSessionOptions,
): ProjectSessionManifest {
  const project = createProject(projectRoot);
  const now = options.now?.() ?? defaultNow();
  const sessionId = options.idFactory?.() ?? defaultSessionId(options.mode);
  const dir = projectSessionDir(projectRoot, sessionId);
  const workspace = projectSessionWorkspace(projectRoot, sessionId);
  mkdirSync(workspace, { recursive: true });
  mkdirSync(join(dir, "scratch"), { recursive: true });

  const session: ProjectSessionManifest = {
    schemaVersion: 1,
    sessionId,
    projectId: project.projectId,
    mode: options.mode,
    ...(options.role?.trim() ? { role: options.role.trim() } : {}),
    displayName: options.displayName,
    backendType: options.backendType,
    status: "active",
    createdAt: now,
    lastAccessed: now,
    sessionWorkspace: workspace,
  };

  writeFileSync(join(dir, "session.json"), JSON.stringify(session, null, 2));
  appendProjectTimelineEvent(projectRoot, {
    type: "session.created",
    at: now,
    sessionId,
    mode: options.mode,
    ...(options.role?.trim() ? { role: options.role.trim() } : {}),
  });
  return session;
}

export function listProjectSessions(projectRoot: string): ProjectSessionManifest[] {
  const dir = projectSessionsDir(projectRoot);
  if (!existsSync(dir)) return [];
  const sessions: ProjectSessionManifest[] = [];
  for (const entry of readdirSync(dir)) {
    const filePath = join(dir, entry, "session.json");
    try {
      if (!statSync(join(dir, entry)).isDirectory() || !existsSync(filePath)) continue;
      sessions.push(JSON.parse(readFileSync(filePath, "utf-8")) as ProjectSessionManifest);
    } catch {
      continue;
    }
  }
  return sessions.sort((a, b) => b.lastAccessed.localeCompare(a.lastAccessed));
}
```

- [ ] **Step 4: Run the focused test and confirm it passes**

Run:

```bash
bun test core/__tests__/project.test.ts
```

Expected: PASS for manifest and session helper tests.

## Task 3: Recent Project Registry

**Files:**
- Modify: `core/project.ts`
- Modify: `core/__tests__/project.test.ts`

- [ ] **Step 1: Add failing tests for recent-project registry behavior**

Append this test group:

```ts
import {
  loadRecentProjects,
  recordRecentProject,
  recentProjectsRegistryPath,
} from "../project.js";

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
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```bash
bun test core/__tests__/project.test.ts
```

Expected: FAIL because registry helper exports do not exist.

- [ ] **Step 3: Implement recent-project registry helpers**

Add these exports to `core/project.ts`:

```ts
export interface RecentProjectRecord {
  projectId: string;
  name: string;
  description?: string;
  root: string;
  lastAccessed: string;
}

export interface RecordRecentProjectOptions {
  homeDir?: string;
  now?: () => string;
  limit?: number;
}

export function recentProjectsRegistryPath(homeDir = homedir()): string {
  return join(homeDir, ".pneuma", "projects.json");
}

export function loadRecentProjects(homeDir = homedir()): RecentProjectRecord[] {
  const path = recentProjectsRegistryPath(homeDir);
  try {
    const records = JSON.parse(readFileSync(path, "utf-8")) as RecentProjectRecord[];
    return records.filter((record) => existsSync(record.root));
  } catch {
    return [];
  }
}

export function saveRecentProjects(records: RecentProjectRecord[], homeDir = homedir()): void {
  const path = recentProjectsRegistryPath(homeDir);
  mkdirSync(join(homeDir, ".pneuma"), { recursive: true });
  writeFileSync(path, JSON.stringify(records, null, 2));
}

export function recordRecentProject(projectRoot: string, options: RecordRecentProjectOptions = {}): RecentProjectRecord {
  const project = createProject(projectRoot);
  const home = options.homeDir ?? homedir();
  const record: RecentProjectRecord = {
    projectId: project.projectId,
    name: project.name,
    ...(project.description ? { description: project.description } : {}),
    root: resolve(projectRoot),
    lastAccessed: options.now?.() ?? defaultNow(),
  };
  const limit = options.limit ?? 50;
  const next = [
    record,
    ...loadRecentProjects(home).filter((existing) => existing.projectId !== record.projectId),
  ].slice(0, limit);
  saveRecentProjects(next, home);
  return record;
}
```

- [ ] **Step 4: Run the focused test and confirm it passes**

Run:

```bash
bun test core/__tests__/project.test.ts
```

Expected: PASS.

## Task 4: CLI Argument Parsing

**Files:**
- Modify: `bin/pneuma-cli-helpers.ts`
- Modify: `bin/__tests__/pneuma-cli-helpers.test.ts`

- [ ] **Step 1: Add failing parser tests**

Add these tests to `bin/__tests__/pneuma-cli-helpers.test.ts`:

```ts
test("parseCliArgs parses project and role flags", () => {
  const parsed = parseCliArgs(
    [
      "bun",
      "bin/pneuma.ts",
      "webcraft",
      "--project",
      "./site",
      "--role",
      "Build the home page",
    ],
    "/tmp/base",
  );

  expect(parsed.mode).toBe("webcraft");
  expect(parsed.projectRoot).toBe("/tmp/base/site");
  expect(parsed.role).toBe("Build the home page");
  expect(parsed.workspace).toBe("/tmp/base");
});

test("parseCliArgs preserves quick-session defaults when project is absent", () => {
  const parsed = parseCliArgs(["bun", "bin/pneuma.ts", "doc"], "/tmp/workspace");

  expect(parsed.projectRoot).toBe("");
  expect(parsed.role).toBe("");
  expect(parsed.workspace).toBe("/tmp/workspace");
});
```

- [ ] **Step 2: Run the focused parser test and confirm it fails**

Run:

```bash
bun test bin/__tests__/pneuma-cli-helpers.test.ts
```

Expected: FAIL because `projectRoot` and `role` are not on `ParsedCliArgs`.

- [ ] **Step 3: Extend parser types and logic**

Modify `bin/pneuma-cli-helpers.ts`:

```ts
export interface ParsedCliArgs {
  mode: string;
  workspace: string;
  projectRoot: string;
  role: string;
  port: number;
  backendType: AgentBackendType;
  showHelp: boolean;
  showVersion: boolean;
  noOpen: boolean;
  debug: boolean;
  forceDev: boolean;
  noPrompt: boolean;
  skipSkill: boolean;
  replayPackage: string;
  replaySource: string;
  sessionName: string;
  viewing: boolean;
}
```

Inside `parseCliArgs` initialize:

```ts
let projectRoot = "";
let role = "";
```

Add flag handling:

```ts
} else if (arg === "--project" && i + 1 < args.length) {
  projectRoot = resolve(cwd, args[++i]);
} else if (arg === "--role" && i + 1 < args.length) {
  role = args[++i];
```

Return the new fields:

```ts
return {
  mode,
  workspace: resolve(cwd, workspace),
  projectRoot,
  role,
  port,
  backendType,
  showHelp,
  showVersion,
  noOpen,
  debug,
  forceDev,
  noPrompt,
  skipSkill,
  replayPackage,
  replaySource,
  sessionName,
  viewing,
};
```

- [ ] **Step 4: Run parser tests**

Run:

```bash
bun test bin/__tests__/pneuma-cli-helpers.test.ts
```

Expected: PASS.

## Task 5: Project Runtime Resolution in CLI

**Files:**
- Modify: `bin/pneuma.ts`
- Modify: `core/project.ts`
- Modify: `core/__tests__/project.test.ts`

- [ ] **Step 1: Add a runtime resolver test**

Append this test to `core/__tests__/project.test.ts`:

```ts
import { resolveProjectRuntime } from "../project.js";

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
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```bash
bun test core/__tests__/project.test.ts
```

Expected: FAIL because `resolveProjectRuntime` does not exist.

- [ ] **Step 3: Implement the runtime resolver**

Add this to `core/project.ts`:

```ts
export interface ResolveProjectRuntimeOptions {
  projectRoot: string;
  mode: string;
  displayName: string;
  backendType: "claude-code" | "codex";
  role?: string;
  now?: () => string;
  projectIdFactory?: () => string;
  sessionIdFactory?: () => string;
}

export interface ProjectRuntime {
  projectRoot: string;
  workspace: string;
  project: ProjectManifest;
  session: ProjectSessionManifest;
}

export function resolveProjectRuntime(options: ResolveProjectRuntimeOptions): ProjectRuntime {
  const project = createProject(options.projectRoot, {
    now: options.now,
    idFactory: options.projectIdFactory,
  });
  const session = createProjectSession(options.projectRoot, {
    mode: options.mode,
    displayName: options.displayName,
    backendType: options.backendType,
    role: options.role,
    now: options.now,
    idFactory: options.sessionIdFactory,
  });
  recordRecentProject(options.projectRoot, { now: options.now });
  return {
    projectRoot: resolve(options.projectRoot),
    workspace: session.sessionWorkspace,
    project,
    session,
  };
}
```

- [ ] **Step 4: Wire runtime resolution into `bin/pneuma.ts`**

In `bin/pneuma.ts`, extend parsed args:

```ts
const { mode, port, backendType, noOpen, debug, forceDev, noPrompt, skipSkill, replaySource, sessionName, viewing, projectRoot, role } = parsedArgs;
let { workspace, replayPackage } = parsedArgs;
```

After mode manifest loading and before workspace existence checks, add:

```ts
let activeProjectRoot = "";
let projectSessionId = "";

if (projectRoot) {
  const { resolveProjectRuntime } = await import("../core/project.js");
  const runtime = resolveProjectRuntime({
    projectRoot,
    mode: modeName,
    displayName: manifest.displayName,
    backendType,
    role,
  });
  activeProjectRoot = runtime.projectRoot;
  projectSessionId = runtime.session.sessionId;
  workspace = runtime.workspace;
  p.log.info(`Project: ${runtime.project.name} (${activeProjectRoot})`);
  p.log.info(`Project session: ${projectSessionId}`);
}
```

Do not change existing quick-session behavior. All existing call sites for `loadSession(workspace)`, `saveSession(workspace)`, `installSkill`, `startServer({ workspace })`, backend `cwd: workspace`, and `startFileWatcher` should continue using the resolved `workspace` variable.

- [ ] **Step 5: Add help text for project flags**

In the CLI usage block in `bin/pneuma.ts`, add:

```text
  --project <path>             Launch inside an explicit Pneuma project root
  --role <text>                Describe this session's role within the project
```

- [ ] **Step 6: Run foundation tests**

Run:

```bash
bun test core/__tests__/project.test.ts bin/__tests__/pneuma-cli-helpers.test.ts
```

Expected: PASS.

## Task 6: Launcher Routes for Project Records

**Files:**
- Modify: `server/index.ts`
- Create: `server/__tests__/project-routes.test.ts`

- [ ] **Step 1: Add failing route tests**

Create `server/__tests__/project-routes.test.ts`:

```ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startServer } from "../index.js";

const TEST_PORT = 19891;
const TEST_WORKSPACE = join(tmpdir(), `pneuma-project-routes-workspace-${Date.now()}`);
const TEST_PROJECT = join(tmpdir(), `pneuma-project-routes-project-${Date.now()}`);

let server: Awaited<ReturnType<typeof startServer>>;

function api(path: string, init?: RequestInit) {
  return fetch(`http://localhost:${TEST_PORT}${path}`, init);
}

describe("project launcher routes", () => {
  beforeAll(async () => {
    mkdirSync(TEST_WORKSPACE, { recursive: true });
    mkdirSync(TEST_PROJECT, { recursive: true });
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
});
```

- [ ] **Step 2: Run route tests and confirm failure**

Run:

```bash
bun test server/__tests__/project-routes.test.ts
```

Expected: FAIL because `/api/projects` does not exist.

- [ ] **Step 3: Add project routes inside Launcher mode**

In `server/index.ts`, import project helpers:

```ts
import { createProject, loadRecentProjects, recordRecentProject } from "../core/project.js";
```

Inside `if (options.launcherMode)`, near the existing `/api/sessions` route, add:

```ts
app.get("/api/projects", (c) => {
  const projects = loadRecentProjects();
  return c.json({ projects });
});

app.post("/api/projects", async (c) => {
  try {
    const body = await c.req.json<{ root?: string; name?: string; description?: string }>();
    const rawRoot = body.root?.trim();
    if (!rawRoot) return c.json({ error: "root is required" }, 400);
    const root = resolve(rawRoot.replace(/^~/, homedir()));
    mkdirSync(root, { recursive: true });
    const project = createProject(root, {
      name: body.name,
      description: body.description,
    });
    recordRecentProject(root);
    return c.json({ project });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 500);
  }
});
```

- [ ] **Step 4: Extend `/api/launch` request body and child args**

In the `/api/launch` route, extend the destructured body:

```ts
const { specifier, workspace: targetWorkspace, projectRoot, role, initParams, skipSkill, backendType, replayPackage: replayPkg, replaySource, sessionName, viewing } = await c.req.json<{
  specifier: string;
  workspace: string;
  projectRoot?: string;
  role?: string;
  initParams?: Record<string, string | number>;
  skipSkill?: boolean;
  backendType?: AgentBackendType;
  replayPackage?: string;
  replaySource?: string;
  sessionName?: string;
  viewing?: boolean;
}>();
```

When building child args, use project launch when `projectRoot` is present:

```ts
const args = projectRoot
  ? ["bun", pneumaBin, specifier, "--project", resolve(projectRoot.replace(/^~/, homedir())), "--no-prompt", "--no-open"]
  : ["bun", pneumaBin, specifier, "--workspace", resolvedWorkspace, "--no-prompt", "--no-open"];

if (role?.trim()) args.push("--role", role.trim());
```

Keep the existing `--backend`, `--skip-skill`, `--viewing`, replay, debug, and dev argument pushes unchanged.

- [ ] **Step 5: Run route tests**

Run:

```bash
bun test server/__tests__/project-routes.test.ts
```

Expected: PASS.

## Task 7: Verification and Commit

**Files:**
- Modify all files touched in Tasks 1-6.

- [ ] **Step 1: Run focused tests**

Run:

```bash
bun test core/__tests__/project.test.ts bin/__tests__/pneuma-cli-helpers.test.ts server/__tests__/project-routes.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run broader relevant tests**

Run:

```bash
bun test bin/__tests__/pneuma-cli-helpers.test.ts server/__tests__/security-path-traversal.test.ts server/__tests__/skill-installer.test.ts core/__tests__/project.test.ts server/__tests__/project-routes.test.ts
```

Expected: PASS. If `security-path-traversal.test.ts` fails because fixed ports are occupied, rerun once after confirming no local Pneuma test server is still active.

- [ ] **Step 3: Run full test suite if the focused set passes**

Run:

```bash
bun test
```

Expected: PASS.

- [ ] **Step 4: Inspect quick-session behavior by launching help and parser-only paths**

Run:

```bash
bun bin/pneuma.ts --help
```

Expected: the command prints usage and includes both `--workspace` and `--project`.

- [ ] **Step 5: Commit the foundation**

```bash
git add core/project.ts core/__tests__/project.test.ts bin/pneuma-cli-helpers.ts bin/__tests__/pneuma-cli-helpers.test.ts bin/pneuma.ts server/index.ts server/__tests__/project-routes.test.ts
git commit -m "feat: add project session foundation"
```

## Follow-Up Board Cards

These are intentionally outside this foundation plan:

1. Launcher Project Overview UI
   - Recent Projects section.
   - Project detail screen.
   - Start/resume project session actions.

2. Project Context and Preferences Injection
   - Inject project identity, role, and peer session summaries.
   - Add project preference layer after global preferences.
   - Make project-over-personal conflict ordering explicit.

3. Cross-Mode Handoff Flow
   - Generate editable handoff drafts.
   - Write `.pneuma/handoffs/<handoff-id>.md`.
   - Resume latest matching mode session or start a new session.

4. Quick Session to Project Upgrade
   - Seed project from an existing quick session.
   - Choose or create project root.
   - Fork session state without destroying the source quick session.

5. Project-Level Evolve
   - Scan project sessions, handoffs, and timeline.
   - Write only to `.pneuma/project-preferences.md`.

## Self-Review

- Spec coverage for the foundation is complete: project identity, project session sandbox, recent-project registry, explicit project activation, quick-session preservation, and basic Launcher launch plumbing all map to tasks.
- Deferred items match independently testable subsystems from the design spec and are listed as follow-up board cards.
- No task requires changing existing quick-session storage paths.
- `workspace` continues to mean backend cwd and watcher root; for project sessions it resolves to the session sandbox.
- The plan avoids hidden cross-session reads and does not introduce project-wide file watching.

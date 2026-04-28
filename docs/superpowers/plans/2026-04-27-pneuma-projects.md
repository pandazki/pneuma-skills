# Pneuma 3.0 Project Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the 3.0 Project Layer — a project organization tier above sessions with cross-mode handoff via files and project-scoped preferences — while keeping 2.x quick sessions fully backward-compatible.

**Architecture:** Add a `<project>/.pneuma/{project.json, preferences/, handoffs/, sessions/{id}/}` structure. Each session gets fully isolated `.claude/` + `CLAUDE.md` + state under its session subdir; agent CWD = sessionDir. Project root holds a shared layer (project.json, project preferences, handoff files). Mode switch is driven by agent-written handoff markdown files at `<project>/.pneuma/handoffs/<id>.md`, captured by chokidar, confirmed by user, consumed by target session. Multi-window concurrent sessions allowed; shared layer is re-read on each session start (no real-time push).

**Tech Stack:** Bun ≥ 1.3.5, TypeScript strict, Hono 4.7, React 19, Zustand 5, chokidar 5, bun:test. No new dependencies.

**Spec:** [`docs/design/2026-04-27-pneuma-projects-design.md`](../../design/2026-04-27-pneuma-projects-design.md)

---

## File Structure

### New files

| Path | Responsibility |
|------|---------------|
| `core/types/project-manifest.ts` | `ProjectManifest` shape (project.json) + `ProjectSummary` |
| `core/project-loader.ts` | Detect quick vs project, load/write `project.json`, scan project sessions |
| `core/path-resolver-pneuma.ts` | Compute `sessionDir`, `stateDir`, `homeRoot`, `projectRoot` from inputs (single source of truth for path policy) |
| `core/__tests__/project-loader.test.ts` | Unit tests for project detection and loading |
| `core/__tests__/path-resolver-pneuma.test.ts` | Unit tests for path resolution policy |
| `server/handoff-watcher.ts` | chokidar watcher on `<project>/.pneuma/handoffs/`, emits structured events |
| `server/__tests__/handoff-watcher.test.ts` | Watcher unit tests |
| `server/__tests__/skill-installer-project.test.ts` | sessionDir-parameterized install + new markers |
| `modes/_shared/skills/pneuma-project/SKILL.md` | Shared skill for project-mode sessions |
| `modes/_shared/skills/pneuma-project/manifest.json` | Skill manifest (if needed for installer) |
| `src/components/CreateProjectDialog.tsx` | Launcher form: name + root + optional init-from-session |
| `src/components/ProjectPage.tsx` | Project detail view: sessions list + new-session + evolve-prefs |
| `src/components/HandoffCard.tsx` | Render pending handoff with Confirm/Edit/Cancel |
| `src/components/ModeSwitcherDropdown.tsx` | Dropdown next to mode tag for switching |
| `src/store/project-slice.ts` | Zustand slice: current project context + handoff inbox |

### Modified files

| Path | Change summary |
|------|---------------|
| `bin/pneuma.ts` | Startup dispatch: detect quick vs project, compute paths, inject env vars |
| `bin/pneuma-cli-helpers.ts` | Extend `PersistedSession` and `SessionRecord` schemas; add `parseCliArgs` flags `--project`, `--session-id` |
| `core/types/agent-backend.ts` | Extend `AgentLaunchOptions` with `homeRoot`, `projectRoot`, `sessionDir` |
| `server/skill-installer.ts` | Parameterize install target by `sessionDir`; add `pneuma:project` and `pneuma:handoff` marker injection; install `pneuma-project` shared skill conditionally |
| `server/index.ts` | New routes: `/api/projects` (list/create), `/api/projects/:id/sessions`, `/api/handoffs/:id/confirm`, `/api/handoffs/:id/cancel`. Wire handoff-watcher to ws push |
| `src/App.tsx` | Mount `HandoffCard` overlay; wire `ModeSwitcherDropdown` into header |
| `src/components/Launcher.tsx` | Add Recent Projects section + Create Project button |
| `src/store/session-slice.ts` | Add `projectRoot`, `homeRoot`, `sessionDir` fields to session state |
| `docs/reference/viewer-agent-protocol.md` | Document new env vars + handoff file protocol |

### Documentation final pass (last task)

| Path | Change |
|------|--------|
| `CLAUDE.md` (root) | Replace "Per-Workspace Persistence" → "Per-Session Persistence + Project Layer"; update Session Registry section schema; new "Project Lifecycle" section |
| `README.md` (root) | Add brief Projects feature mention |
| `package.json` + `CHANGELOG.md` | Version bump per release rules |

---

## Phase 1 — Foundation (types, project-loader, path-resolver)

### Task 1: ProjectManifest type

**Files:**
- Create: `core/types/project-manifest.ts`
- Test: `core/__tests__/project-manifest.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// core/__tests__/project-manifest.test.ts
import { describe, expect, test } from "bun:test";
import {
  isProjectManifest,
  type ProjectManifest,
  type ProjectSummary,
} from "../types/project-manifest.js";

describe("ProjectManifest", () => {
  test("isProjectManifest accepts a valid object", () => {
    const m: ProjectManifest = {
      version: 1,
      name: "my-startup",
      displayName: "My Startup",
      description: "AI tools demo site",
      createdAt: 1714200000000,
      founderSessionId: "abc-123",
    };
    expect(isProjectManifest(m)).toBe(true);
  });

  test("isProjectManifest rejects missing required fields", () => {
    expect(isProjectManifest({})).toBe(false);
    expect(isProjectManifest({ name: "x" })).toBe(false);
    expect(isProjectManifest({ version: 1, name: "x" })).toBe(false);
  });

  test("isProjectManifest tolerates omitted optional fields", () => {
    const m = {
      version: 1,
      name: "minimal",
      displayName: "minimal",
      createdAt: 1,
    };
    expect(isProjectManifest(m)).toBe(true);
  });

  test("ProjectSummary keeps lastAccessed and root", () => {
    const s: ProjectSummary = {
      root: "/Users/x/proj",
      name: "proj",
      displayName: "Proj",
      lastAccessed: 1,
      sessionCount: 3,
    };
    expect(s.sessionCount).toBe(3);
  });
});
```

- [ ] **Step 2: Run test — confirm it fails**

```bash
bun test core/__tests__/project-manifest.test.ts
```

Expected: fail with module-not-found / import error.

- [ ] **Step 3: Implement the type module**

```typescript
// core/types/project-manifest.ts
/**
 * On-disk schema for `<projectRoot>/.pneuma/project.json`.
 * `version` enables forward-compatible migrations.
 */
export interface ProjectManifest {
  version: 1;
  name: string;
  displayName: string;
  description?: string;
  createdAt: number;
  founderSessionId?: string;
}

export interface ProjectSummary {
  root: string;
  name: string;
  displayName: string;
  description?: string;
  createdAt?: number;
  lastAccessed: number;
  sessionCount: number;
}

export function isProjectManifest(value: unknown): value is ProjectManifest {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === 1 &&
    typeof v.name === "string" &&
    typeof v.displayName === "string" &&
    typeof v.createdAt === "number"
  );
}
```

- [ ] **Step 4: Run test — confirm it passes**

```bash
bun test core/__tests__/project-manifest.test.ts
```

Expected: 4 pass.

- [ ] **Step 5: Commit**

```bash
git add core/types/project-manifest.ts core/__tests__/project-manifest.test.ts
git commit -m "feat(core): add ProjectManifest type and guard"
```

---

### Task 2: Path resolver (sessionDir / stateDir / homeRoot / projectRoot policy)

**Files:**
- Create: `core/path-resolver-pneuma.ts`
- Test: `core/__tests__/path-resolver-pneuma.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// core/__tests__/path-resolver-pneuma.test.ts
import { describe, expect, test } from "bun:test";
import { resolveSessionPaths } from "../path-resolver-pneuma.js";

describe("resolveSessionPaths", () => {
  test("quick session: sessionDir = workspace, stateDir = workspace/.pneuma", () => {
    const p = resolveSessionPaths({
      kind: "quick",
      workspace: "/ws",
    });
    expect(p.kind).toBe("quick");
    expect(p.sessionDir).toBe("/ws");
    expect(p.stateDir).toBe("/ws/.pneuma");
    expect(p.homeRoot).toBe("/ws");
    expect(p.projectRoot).toBeNull();
  });

  test("project session: sessionDir under sessions/{id}, stateDir flat", () => {
    const p = resolveSessionPaths({
      kind: "project",
      projectRoot: "/proj",
      sessionId: "abc-123",
    });
    expect(p.kind).toBe("project");
    expect(p.sessionDir).toBe("/proj/.pneuma/sessions/abc-123");
    expect(p.stateDir).toBe("/proj/.pneuma/sessions/abc-123");
    expect(p.homeRoot).toBe("/proj");
    expect(p.projectRoot).toBe("/proj");
  });

  test("project session also exposes shared paths", () => {
    const p = resolveSessionPaths({
      kind: "project",
      projectRoot: "/proj",
      sessionId: "x",
    });
    expect(p.projectPreferencesDir).toBe("/proj/.pneuma/preferences");
    expect(p.projectHandoffsDir).toBe("/proj/.pneuma/handoffs");
    expect(p.projectManifestPath).toBe("/proj/.pneuma/project.json");
  });

  test("quick session has no project shared paths", () => {
    const p = resolveSessionPaths({
      kind: "quick",
      workspace: "/ws",
    });
    expect(p.projectPreferencesDir).toBeNull();
    expect(p.projectHandoffsDir).toBeNull();
    expect(p.projectManifestPath).toBeNull();
  });
});
```

- [ ] **Step 2: Run test — confirm it fails**

```bash
bun test core/__tests__/path-resolver-pneuma.test.ts
```

Expected: module-not-found.

- [ ] **Step 3: Implement the resolver**

```typescript
// core/path-resolver-pneuma.ts
import { join } from "node:path";

export type SessionPathKind = "quick" | "project";

export interface QuickSessionInput {
  kind: "quick";
  workspace: string;
}

export interface ProjectSessionInput {
  kind: "project";
  projectRoot: string;
  sessionId: string;
}

export type SessionPathInput = QuickSessionInput | ProjectSessionInput;

export interface SessionPaths {
  kind: SessionPathKind;
  sessionDir: string;
  stateDir: string;
  homeRoot: string;
  projectRoot: string | null;
  projectPreferencesDir: string | null;
  projectHandoffsDir: string | null;
  projectManifestPath: string | null;
}

export function resolveSessionPaths(input: SessionPathInput): SessionPaths {
  if (input.kind === "quick") {
    return {
      kind: "quick",
      sessionDir: input.workspace,
      stateDir: join(input.workspace, ".pneuma"),
      homeRoot: input.workspace,
      projectRoot: null,
      projectPreferencesDir: null,
      projectHandoffsDir: null,
      projectManifestPath: null,
    };
  }
  const sessionDir = join(input.projectRoot, ".pneuma", "sessions", input.sessionId);
  return {
    kind: "project",
    sessionDir,
    stateDir: sessionDir,
    homeRoot: input.projectRoot,
    projectRoot: input.projectRoot,
    projectPreferencesDir: join(input.projectRoot, ".pneuma", "preferences"),
    projectHandoffsDir: join(input.projectRoot, ".pneuma", "handoffs"),
    projectManifestPath: join(input.projectRoot, ".pneuma", "project.json"),
  };
}
```

- [ ] **Step 4: Run test — confirm it passes**

```bash
bun test core/__tests__/path-resolver-pneuma.test.ts
```

Expected: 4 pass.

- [ ] **Step 5: Commit**

```bash
git add core/path-resolver-pneuma.ts core/__tests__/path-resolver-pneuma.test.ts
git commit -m "feat(core): add session path resolver for quick vs project modes"
```

---

### Task 3: Project loader (detect, load, scan)

**Files:**
- Create: `core/project-loader.ts`
- Test: `core/__tests__/project-loader.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// core/__tests__/project-loader.test.ts
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
});
```

- [ ] **Step 2: Run test — confirm it fails**

```bash
bun test core/__tests__/project-loader.test.ts
```

Expected: module not found.

- [ ] **Step 3: Implement the loader**

```typescript
// core/project-loader.ts
import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  isProjectManifest,
  type ProjectManifest,
} from "./types/project-manifest.js";

export type WorkspaceKind = "quick" | "project";

export async function detectWorkspaceKind(workspace: string): Promise<WorkspaceKind> {
  const projectJson = join(workspace, ".pneuma", "project.json");
  return existsSync(projectJson) ? "project" : "quick";
}

export async function loadProjectManifest(
  projectRoot: string
): Promise<ProjectManifest | null> {
  const path = join(projectRoot, ".pneuma", "project.json");
  if (!existsSync(path)) return null;
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw);
    return isProjectManifest(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeProjectManifest(
  projectRoot: string,
  manifest: ProjectManifest
): Promise<void> {
  const dir = join(projectRoot, ".pneuma");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "project.json"),
    JSON.stringify(manifest, null, 2),
    "utf-8"
  );
}

export interface ProjectSessionRef {
  sessionId: string;
  mode: string;
  sessionDir: string;
}

export async function scanProjectSessions(
  projectRoot: string
): Promise<ProjectSessionRef[]> {
  const sessionsDir = join(projectRoot, ".pneuma", "sessions");
  if (!existsSync(sessionsDir)) return [];
  const entries = await readdir(sessionsDir);
  const out: ProjectSessionRef[] = [];
  for (const id of entries) {
    const sessionDir = join(sessionsDir, id);
    const sessionJson = join(sessionDir, "session.json");
    if (!existsSync(sessionJson)) continue;
    try {
      const s = await stat(sessionDir);
      if (!s.isDirectory()) continue;
      const data = JSON.parse(await readFile(sessionJson, "utf-8")) as {
        sessionId?: string;
        mode?: string;
      };
      if (typeof data.sessionId === "string" && typeof data.mode === "string") {
        out.push({ sessionId: data.sessionId, mode: data.mode, sessionDir });
      }
    } catch {
      // skip corrupt session
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test — confirm it passes**

```bash
bun test core/__tests__/project-loader.test.ts
```

Expected: 7 pass.

- [ ] **Step 5: Commit**

```bash
git add core/project-loader.ts core/__tests__/project-loader.test.ts
git commit -m "feat(core): add project-loader (detect, load, scan sessions)"
```

---

## Phase 2 — Skill Installer Adaptation

### Task 4: Parameterize installSkill target by sessionDir

**Files:**
- Modify: `server/skill-installer.ts:649`+ (the `installSkill` signature and internals)
- Test: `server/__tests__/skill-installer-project.test.ts` (new)

**Context:** Currently `installSkill(workspace, ...)` writes to `<workspace>/.claude/skills/<installName>/` and `<workspace>/CLAUDE.md`. We add a `sessionDir` option (default = workspace for backward compat) so project sessions can target `<project>/.pneuma/sessions/{id}/`. Existing callers stay unchanged.

- [ ] **Step 1: Read current `installSkill` signature**

```bash
sed -n '640,720p' server/skill-installer.ts
```

Note the existing parameters object — we'll add `sessionDir?: string` to it without breaking existing callers.

- [ ] **Step 2: Write the failing test**

```typescript
// server/__tests__/skill-installer-project.test.ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installSkill } from "../skill-installer.js";
import type { ModeManifest } from "../../core/types/mode-manifest.js";

let tmp: string;
let modeSrc: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pneuma-installer-"));
  modeSrc = join(tmp, "mode-src");
  await mkdir(join(modeSrc, "skill"), { recursive: true });
  await writeFile(join(modeSrc, "skill", "SKILL.md"), "# Test Skill\n");
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

function makeManifest(): ModeManifest {
  return {
    name: "test-mode",
    displayName: "Test Mode",
    skill: {
      sourceDir: "skill",
      installName: "pneuma-test",
      version: "1.0.0",
      claudeMdSnippet: "## Pneuma Test Mode\nGo do test things.",
    },
    viewer: { entry: "viewer/index.tsx" },
    agent: { backend: "claude-code" },
  } as unknown as ModeManifest;
}

describe("installSkill with sessionDir parameter", () => {
  test("when sessionDir is omitted, installs at workspace (legacy behavior)", async () => {
    const workspace = join(tmp, "ws");
    await mkdir(workspace, { recursive: true });
    await installSkill({
      workspace,
      manifest: makeManifest(),
      modeSourceDir: modeSrc,
      params: {},
      backendType: "claude-code",
    });
    expect(existsSync(join(workspace, ".claude", "skills", "pneuma-test", "SKILL.md"))).toBe(true);
    expect(existsSync(join(workspace, "CLAUDE.md"))).toBe(true);
  });

  test("when sessionDir is provided, installs at sessionDir not workspace", async () => {
    const workspace = join(tmp, "proj");
    const sessionDir = join(workspace, ".pneuma", "sessions", "abc-123");
    await mkdir(sessionDir, { recursive: true });

    await installSkill({
      workspace,
      sessionDir,
      manifest: makeManifest(),
      modeSourceDir: modeSrc,
      params: {},
      backendType: "claude-code",
    });

    expect(existsSync(join(sessionDir, ".claude", "skills", "pneuma-test", "SKILL.md"))).toBe(true);
    expect(existsSync(join(sessionDir, "CLAUDE.md"))).toBe(true);
    // workspace root should NOT have these
    expect(existsSync(join(workspace, ".claude", "skills", "pneuma-test"))).toBe(false);
    expect(existsSync(join(workspace, "CLAUDE.md"))).toBe(false);
  });
});
```

- [ ] **Step 3: Run test — confirm it fails**

```bash
bun test server/__tests__/skill-installer-project.test.ts
```

Expected: fails because `installSkill` doesn't accept `sessionDir` and ignores any custom target.

- [ ] **Step 4: Modify `installSkill` to accept `sessionDir`**

In `server/skill-installer.ts` around line 649:

(a) Add to the options interface:

```typescript
export interface InstallSkillOptions {
  // ... existing fields ...
  /**
   * Where to write `.claude/skills/<installName>/` and `CLAUDE.md`.
   * Defaults to `workspace` for backward compatibility (quick sessions).
   * For project sessions, set to `<project>/.pneuma/sessions/{sessionId}/`.
   */
  sessionDir?: string;
}
```

(b) Inside the function body, derive the install target once at the top:

```typescript
const installTarget = options.sessionDir ?? options.workspace;
```

(c) Replace every internal use of `workspace` for `.claude/skills/...`, `.agents/skills/...`, `CLAUDE.md`, and `AGENTS.md` paths with `installTarget`. Search and replace systematically inside this function only — the `workspace` parameter is still passed to template engine for `{{workspace}}` substitutions and to `installMcpServers` (those should keep using `workspace`).

- [ ] **Step 5: Run test — confirm it passes**

```bash
bun test server/__tests__/skill-installer-project.test.ts
```

Expected: 2 pass.

- [ ] **Step 6: Run full test suite — confirm no regression**

```bash
bun test
```

Expected: 739 → 741 pass (added 2), 0 fail.

- [ ] **Step 7: Commit**

```bash
git add server/skill-installer.ts server/__tests__/skill-installer-project.test.ts
git commit -m "feat(skill-installer): parameterize install target by sessionDir"
```

---

### Task 5: Inject `pneuma:project` marker

**Files:**
- Modify: `server/skill-installer.ts` (add `buildProjectSection` + inject into instructions file)
- Test: `server/__tests__/skill-installer-project.test.ts` (extend)

**Context:** When the session is project-scoped, we read `<projectRoot>/.pneuma/project.json` + `<projectRoot>/.pneuma/preferences/{profile.md, mode-{name}.md}` (critical blocks only) + scan sibling sessions, and assemble a `<!-- pneuma:project:start --> ... <!-- pneuma:project:end -->` section in CLAUDE.md / AGENTS.md.

- [ ] **Step 1: Add the failing test**

Append to `server/__tests__/skill-installer-project.test.ts`:

```typescript
import { writeProjectManifest } from "../../core/project-loader.js";

describe("pneuma:project marker", () => {
  test("project session gets pneuma:project block with project info", async () => {
    const workspace = join(tmp, "proj-info");
    const sessionDir = join(workspace, ".pneuma", "sessions", "s1");
    await mkdir(sessionDir, { recursive: true });
    await writeProjectManifest(workspace, {
      version: 1,
      name: "demo",
      displayName: "Demo Project",
      description: "Demo for tests",
      createdAt: 1,
    });

    await installSkill({
      workspace,
      sessionDir,
      projectRoot: workspace,
      manifest: makeManifest(),
      modeSourceDir: modeSrc,
      params: {},
      backendType: "claude-code",
    });

    const claudeMd = await readFile(join(sessionDir, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toContain("<!-- pneuma:project:start -->");
    expect(claudeMd).toContain("<!-- pneuma:project:end -->");
    expect(claudeMd).toContain("Demo Project");
    expect(claudeMd).toContain("Demo for tests");
  });

  test("project session embeds project preferences critical block", async () => {
    const workspace = join(tmp, "proj-prefs");
    const sessionDir = join(workspace, ".pneuma", "sessions", "s2");
    await mkdir(sessionDir, { recursive: true });
    await writeProjectManifest(workspace, {
      version: 1,
      name: "p",
      displayName: "P",
      createdAt: 1,
    });
    await mkdir(join(workspace, ".pneuma", "preferences"), { recursive: true });
    await writeFile(
      join(workspace, ".pneuma", "preferences", "profile.md"),
      "# Project Prefs\n\n<!-- pneuma-critical:start -->\n- 调性偏暖橙\n<!-- pneuma-critical:end -->\n"
    );

    await installSkill({
      workspace,
      sessionDir,
      projectRoot: workspace,
      manifest: makeManifest(),
      modeSourceDir: modeSrc,
      params: {},
      backendType: "claude-code",
    });

    const claudeMd = await readFile(join(sessionDir, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toContain("调性偏暖橙");
  });

  test("quick session does NOT get pneuma:project block", async () => {
    const workspace = join(tmp, "quick");
    await mkdir(workspace, { recursive: true });

    await installSkill({
      workspace,
      manifest: makeManifest(),
      modeSourceDir: modeSrc,
      params: {},
      backendType: "claude-code",
    });

    const claudeMd = await readFile(join(workspace, "CLAUDE.md"), "utf-8");
    expect(claudeMd).not.toContain("<!-- pneuma:project:start -->");
  });
});
```

- [ ] **Step 2: Run — confirm fails**

```bash
bun test server/__tests__/skill-installer-project.test.ts
```

Expected: 3 new tests fail (no pneuma:project block produced).

- [ ] **Step 3: Implement `buildProjectSection`**

Add to `server/skill-installer.ts` (near `buildAndInjectPreferences`):

```typescript
import { loadProjectManifest, scanProjectSessions } from "../core/project-loader.js";

const PROJECT_MARKER_START = "<!-- pneuma:project:start -->";
const PROJECT_MARKER_END = "<!-- pneuma:project:end -->";

export interface ProjectSectionInput {
  projectRoot: string;
  currentSessionId?: string;
  currentMode: string;
}

export async function buildProjectSection(
  input: ProjectSectionInput
): Promise<string | null> {
  const manifest = await loadProjectManifest(input.projectRoot);
  if (!manifest) return null;

  const lines: string[] = [];
  lines.push(`### Project: ${manifest.displayName}`);
  if (manifest.description) {
    lines.push("");
    lines.push(`**Description**: ${manifest.description}`);
  }

  const sessions = await scanProjectSessions(input.projectRoot);
  const others = sessions.filter((s) => s.sessionId !== input.currentSessionId);
  if (others.length > 0) {
    lines.push("");
    lines.push("**Other sessions in this project**:");
    for (const s of others) {
      lines.push(`- \`${s.mode}/${s.sessionId}\``);
    }
  }

  const profile = extractPreferenceCritical(
    join(input.projectRoot, ".pneuma", "preferences", "profile.md")
  );
  const modePref = extractPreferenceCritical(
    join(input.projectRoot, ".pneuma", "preferences", `mode-${input.currentMode}.md`)
  );

  if (profile || modePref) {
    lines.push("");
    lines.push("**Project Preferences (Critical)**:");
    if (profile) {
      lines.push("");
      lines.push("Global:");
      lines.push(profile);
    }
    if (modePref) {
      lines.push("");
      lines.push(`${input.currentMode} mode:`);
      lines.push(modePref);
    }
  }

  return lines.join("\n");
}

export function injectProjectSection(
  instructionsContent: string,
  body: string | null
): string {
  // Strip any existing block first
  const stripped = instructionsContent.replace(
    new RegExp(
      `${escapeRegExp(PROJECT_MARKER_START)}[\\s\\S]*?${escapeRegExp(PROJECT_MARKER_END)}\\n?`,
      "g"
    ),
    ""
  );
  if (!body) return stripped;
  const block = `${PROJECT_MARKER_START}\n${body}\n${PROJECT_MARKER_END}\n`;
  return stripped.trimEnd() + "\n\n" + block;
}

// Local helper if not already in file:
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
```

- [ ] **Step 4: Wire into `installSkill`**

In `installSkill`, after the existing `buildAndInjectPreferences` call, add:

```typescript
if (options.projectRoot) {
  const projectBody = await buildProjectSection({
    projectRoot: options.projectRoot,
    currentSessionId: options.sessionId,
    currentMode: options.manifest.name,
  });
  const instructionsPath = join(installTarget, instructionsFileName); // "CLAUDE.md" or "AGENTS.md"
  const current = existsSync(instructionsPath)
    ? await readFile(instructionsPath, "utf-8")
    : "";
  await writeFile(instructionsPath, injectProjectSection(current, projectBody), "utf-8");
}
```

Also extend `InstallSkillOptions` with `projectRoot?: string` and `sessionId?: string`.

- [ ] **Step 5: Run — confirm passes**

```bash
bun test server/__tests__/skill-installer-project.test.ts
```

Expected: 5 pass.

- [ ] **Step 6: Full suite**

```bash
bun test
```

Expected: 744 pass / 0 fail.

- [ ] **Step 7: Commit**

```bash
git add server/skill-installer.ts server/__tests__/skill-installer-project.test.ts
git commit -m "feat(skill-installer): inject pneuma:project marker for project sessions"
```

---

### Task 6: Inject `pneuma:handoff` marker

**Files:**
- Modify: `server/skill-installer.ts`
- Test: extend `server/__tests__/skill-installer-project.test.ts`

**Context:** When a session starts in a project, scan `<projectRoot>/.pneuma/handoffs/` for files whose YAML frontmatter has `target_mode = <currentMode>` and (optionally) `target_session = <currentSessionId> | "auto"`. Inject the matching handoff path + frontmatter summary into a `<!-- pneuma:handoff:start --> ... <!-- pneuma:handoff:end -->` block. Multiple matches list all (rare but possible).

- [ ] **Step 1: Add the test**

```typescript
describe("pneuma:handoff marker", () => {
  test("injects pending handoff for current mode", async () => {
    const workspace = join(tmp, "proj-handoff");
    const sessionDir = join(workspace, ".pneuma", "sessions", "target-1");
    await mkdir(sessionDir, { recursive: true });
    await writeProjectManifest(workspace, { version: 1, name: "p", displayName: "P", createdAt: 1 });
    const handoffsDir = join(workspace, ".pneuma", "handoffs");
    await mkdir(handoffsDir, { recursive: true });
    await writeFile(
      join(handoffsDir, "hf-1.md"),
      `---
handoff_id: hf-1
target_mode: test-mode
target_session: auto
source_session: src-1
source_mode: doc
intent: Build the landing page
created_at: 2026-04-27T00:00:00Z
---

# Handoff body

Important content here.
`
    );

    await installSkill({
      workspace,
      sessionDir,
      projectRoot: workspace,
      sessionId: "target-1",
      manifest: makeManifest(),
      modeSourceDir: modeSrc,
      params: {},
      backendType: "claude-code",
    });

    const claudeMd = await readFile(join(sessionDir, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toContain("<!-- pneuma:handoff:start -->");
    expect(claudeMd).toContain("hf-1.md");
    expect(claudeMd).toContain("Build the landing page");
  });

  test("does NOT inject handoff for a different target_mode", async () => {
    const workspace = join(tmp, "proj-handoff-mismatch");
    const sessionDir = join(workspace, ".pneuma", "sessions", "t2");
    await mkdir(sessionDir, { recursive: true });
    await writeProjectManifest(workspace, { version: 1, name: "p", displayName: "P", createdAt: 1 });
    const handoffsDir = join(workspace, ".pneuma", "handoffs");
    await mkdir(handoffsDir, { recursive: true });
    await writeFile(
      join(handoffsDir, "hf-2.md"),
      `---
handoff_id: hf-2
target_mode: webcraft
source_session: src
source_mode: doc
intent: x
created_at: 2026-04-27T00:00:00Z
---
body
`
    );

    await installSkill({
      workspace,
      sessionDir,
      projectRoot: workspace,
      sessionId: "t2",
      manifest: makeManifest(),
      modeSourceDir: modeSrc,
      params: {},
      backendType: "claude-code",
    });

    const claudeMd = await readFile(join(sessionDir, "CLAUDE.md"), "utf-8");
    expect(claudeMd).not.toContain("hf-2.md");
  });
});
```

- [ ] **Step 2: Run — confirm fails**

```bash
bun test server/__tests__/skill-installer-project.test.ts
```

- [ ] **Step 3: Implement handoff scanner + inject**

Add to `server/skill-installer.ts`:

```typescript
const HANDOFF_MARKER_START = "<!-- pneuma:handoff:start -->";
const HANDOFF_MARKER_END = "<!-- pneuma:handoff:end -->";

interface HandoffFrontmatter {
  handoff_id: string;
  target_mode: string;
  target_session?: string;
  source_session?: string;
  source_mode?: string;
  intent?: string;
  suggested_files?: string[];
  created_at?: string;
}

interface PendingHandoff {
  path: string;
  frontmatter: HandoffFrontmatter;
}

function parseHandoffFrontmatter(raw: string): HandoffFrontmatter | null {
  const match = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const body = match[1];
  const fm: Record<string, unknown> = {};
  let currentList: string[] | null = null;
  let currentKey: string | null = null;
  for (const line of body.split("\n")) {
    if (currentList && line.startsWith("  - ")) {
      currentList.push(line.slice(4).trim());
      continue;
    }
    if (currentList) {
      currentList = null;
      currentKey = null;
    }
    const kv = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (!kv) continue;
    const [, k, v] = kv;
    if (v === "" || v === undefined) {
      // expecting a list
      const list: string[] = [];
      fm[k] = list;
      currentList = list;
      currentKey = k;
    } else {
      fm[k] = v.trim();
    }
  }
  if (typeof fm.handoff_id !== "string" || typeof fm.target_mode !== "string") {
    return null;
  }
  return fm as unknown as HandoffFrontmatter;
}

export async function findPendingHandoffs(
  projectRoot: string,
  currentMode: string,
  currentSessionId: string
): Promise<PendingHandoff[]> {
  const dir = join(projectRoot, ".pneuma", "handoffs");
  if (!existsSync(dir)) return [];
  const files = await readdir(dir);
  const out: PendingHandoff[] = [];
  for (const f of files) {
    if (!f.endsWith(".md")) continue;
    const path = join(dir, f);
    const raw = await readFile(path, "utf-8");
    const fm = parseHandoffFrontmatter(raw);
    if (!fm) continue;
    if (fm.target_mode !== currentMode) continue;
    if (fm.target_session && fm.target_session !== "auto" && fm.target_session !== currentSessionId) continue;
    out.push({ path, frontmatter: fm });
  }
  return out;
}

function buildHandoffSection(handoffs: PendingHandoff[]): string | null {
  if (handoffs.length === 0) return null;
  const lines: string[] = [];
  lines.push("### Pending Handoff");
  lines.push("");
  lines.push("Read the file below, internalize, then `rm` it.");
  for (const h of handoffs) {
    lines.push("");
    lines.push(`- File: \`${h.path}\``);
    lines.push(`  - From: ${h.frontmatter.source_mode ?? "unknown"} (${h.frontmatter.source_session ?? "unknown"})`);
    if (h.frontmatter.intent) lines.push(`  - Intent: ${h.frontmatter.intent}`);
    if (h.frontmatter.suggested_files?.length) {
      lines.push(`  - Suggested files: ${h.frontmatter.suggested_files.join(", ")}`);
    }
  }
  return lines.join("\n");
}

export function injectHandoffSection(
  instructionsContent: string,
  body: string | null
): string {
  const stripped = instructionsContent.replace(
    new RegExp(
      `${escapeRegExp(HANDOFF_MARKER_START)}[\\s\\S]*?${escapeRegExp(HANDOFF_MARKER_END)}\\n?`,
      "g"
    ),
    ""
  );
  if (!body) return stripped;
  const block = `${HANDOFF_MARKER_START}\n${body}\n${HANDOFF_MARKER_END}\n`;
  return stripped.trimEnd() + "\n\n" + block;
}
```

Also add `import { readdir } from "node:fs/promises";` if not already present.

- [ ] **Step 4: Wire into `installSkill`**

After the project-section injection block:

```typescript
if (options.projectRoot && options.sessionId) {
  const handoffs = await findPendingHandoffs(
    options.projectRoot,
    options.manifest.name,
    options.sessionId
  );
  const handoffBody = buildHandoffSection(handoffs);
  const instructionsPath = join(installTarget, instructionsFileName);
  const current = existsSync(instructionsPath)
    ? await readFile(instructionsPath, "utf-8")
    : "";
  await writeFile(instructionsPath, injectHandoffSection(current, handoffBody), "utf-8");
}
```

- [ ] **Step 5: Run — confirm passes**

```bash
bun test server/__tests__/skill-installer-project.test.ts
```

Expected: 7 pass.

- [ ] **Step 6: Commit**

```bash
git add server/skill-installer.ts server/__tests__/skill-installer-project.test.ts
git commit -m "feat(skill-installer): inject pneuma:handoff marker on session start"
```

---

### Task 7: Create `pneuma-project` shared skill

**Files:**
- Create: `modes/_shared/skills/pneuma-project/SKILL.md`
- Modify: `server/skill-installer.ts` — install conditionally for project sessions
- Test: extend `server/__tests__/skill-installer-project.test.ts`

- [ ] **Step 1: Write SKILL.md**

```markdown
<!-- modes/_shared/skills/pneuma-project/SKILL.md -->
---
name: pneuma-project
description: Project-context awareness for sessions running inside a Pneuma project (cross-mode handoff and project-scoped preferences).
---

# Pneuma Project Skill

You are a session running inside a Pneuma **project** — a multi-session, multi-mode workspace organized around a shared goal. Read `$PNEUMA_PROJECT_ROOT/.pneuma/project.json` for the project identity and description.

## Layout you live in

- `$PNEUMA_PROJECT_ROOT/` — the user's project root. Final deliverables (websites, videos, docs the user actually wants) go here.
- `$PNEUMA_SESSION_DIR/` — your private working area (also your CWD). Drafts, scratch, internal-state files live here.
- `$PNEUMA_PROJECT_ROOT/.pneuma/preferences/{profile.md,mode-{name}.md}` — project-scoped preferences. Same schema as `~/.pneuma/preferences/`.
- `$PNEUMA_PROJECT_ROOT/.pneuma/handoffs/<id>.md` — cross-mode handoff messages (see below).
- `$PNEUMA_PROJECT_ROOT/.pneuma/sessions/<otherId>/` — sibling sessions. Do not read their internals; coordinate through handoffs.

## Cross-mode handoff protocol

When the user invokes mode switching, you receive a chat message like `<pneuma:request-handoff target="..." />`. Respond by writing a markdown file to `$PNEUMA_PROJECT_ROOT/.pneuma/handoffs/<id>.md` using the Write tool. Schema:

```markdown
---
handoff_id: <unique slug, e.g. hf-2026042701>
target_mode: <mode name>
target_session: <existing session id, "auto", or omit for new>
source_session: $PNEUMA_SESSION_ID
source_mode: <your mode>
source_display_name: <session display name>
intent: <one-line user intent>
suggested_files:
  - <path relative to $PNEUMA_PROJECT_ROOT>
created_at: <ISO 8601>
---

# Handoff: <source_mode> → <target_mode>

## Current progress
What's been done in this session that the target needs to know.

## Switching intent
Why are we switching? What does the user want next?

## Key decisions and constraints
Aesthetic, technical, scope decisions already locked in.

## Files the target should read first
Prioritized list with one-line "why" each.

## Open questions
Things you didn't decide; let the target judge.
```

After the file is written, the Pneuma UI captures it via filesystem watcher and asks the user to confirm. Do not delete it yourself — the **target** session will consume and remove it.

## Consuming a handoff

When you start, the CLAUDE.md `pneuma:handoff` block lists pending handoffs targeting you. Read the file, internalize the context, then delete it via `rm` (Bash tool). Treat the handoff like a system briefing — its content takes precedence over your default mode skill.

## Project preferences (read-write rules)

- Same `<!-- pneuma-critical:start --> ... <!-- pneuma-critical:end -->` and `<!-- changelog:start --> ... <!-- changelog:end -->` markers as personal preferences.
- When updating, read first, then full-rewrite (last-writer-wins).
- Project preferences are scoped to *this* project — not generalize-able to the user's other work. Personal preferences live in `~/.pneuma/preferences/` and are managed by the `pneuma-preferences` skill.
- Conflict policy: when project preferences contradict personal, follow the project preference and tell the user once with a brief reason ("project says X; personal says Y; going with project for this session").

## Boundaries

- Do not write non-deliverable files into `$PNEUMA_PROJECT_ROOT/`. Scratch, drafts, templates → keep in `$PNEUMA_SESSION_DIR/`.
- Do not read sibling sessions' history.json or shadow.git directly. Coordinate through handoff files only.
- Do not modify `.pneuma/project.json` casually — that's project identity. Update it only when the user explicitly asks (e.g., rename, edit description).
```

- [ ] **Step 2: Add the install test**

Append to `server/__tests__/skill-installer-project.test.ts`:

```typescript
describe("pneuma-project shared skill", () => {
  test("installed in project sessions", async () => {
    const workspace = join(tmp, "proj-shared");
    const sessionDir = join(workspace, ".pneuma", "sessions", "s");
    await mkdir(sessionDir, { recursive: true });
    await writeProjectManifest(workspace, { version: 1, name: "p", displayName: "P", createdAt: 1 });

    await installSkill({
      workspace,
      sessionDir,
      projectRoot: workspace,
      sessionId: "s",
      manifest: makeManifest(),
      modeSourceDir: modeSrc,
      params: {},
      backendType: "claude-code",
    });

    expect(existsSync(join(sessionDir, ".claude", "skills", "pneuma-project", "SKILL.md"))).toBe(true);
  });

  test("NOT installed in quick sessions", async () => {
    const workspace = join(tmp, "quick-shared");
    await mkdir(workspace, { recursive: true });

    await installSkill({
      workspace,
      manifest: makeManifest(),
      modeSourceDir: modeSrc,
      params: {},
      backendType: "claude-code",
    });

    expect(existsSync(join(workspace, ".claude", "skills", "pneuma-project"))).toBe(false);
  });
});
```

- [ ] **Step 3: Run — confirm fails**

```bash
bun test server/__tests__/skill-installer-project.test.ts
```

- [ ] **Step 4: Implement conditional install**

In `server/skill-installer.ts`, find `installSkillDependencies` (line ~538). The `pneuma-preferences` is already installed as a global dependency. Mirror that path to add `pneuma-project` only when `options.projectRoot` is set.

Add a helper:

```typescript
async function installPneumaProjectSkill(installTarget: string, backendType: AgentBackendType): Promise<void> {
  const skillsRoot = backendType === "codex" ? ".agents/skills" : ".claude/skills";
  const target = join(installTarget, skillsRoot, "pneuma-project");
  const source = join(getModesRoot(), "_shared", "skills", "pneuma-project");
  await mkdir(target, { recursive: true });
  await copyDir(source, target);
}
```

Where `getModesRoot()` is the existing helper that resolves the modes directory (look at how `pneuma-preferences` is resolved — usually `join(import.meta.dir, "..", "modes")` or similar). Reuse the same convention.

In `installSkill`, after `installSkillDependencies` call, add:

```typescript
if (options.projectRoot) {
  await installPneumaProjectSkill(installTarget, options.backendType);
}
```

- [ ] **Step 5: Run — confirm passes**

```bash
bun test server/__tests__/skill-installer-project.test.ts
```

Expected: 9 pass.

- [ ] **Step 6: Full suite**

```bash
bun test
```

Expected: 750+ pass / 0 fail.

- [ ] **Step 7: Commit**

```bash
git add modes/_shared/skills/pneuma-project/SKILL.md server/skill-installer.ts server/__tests__/skill-installer-project.test.ts
git commit -m "feat(modes): add pneuma-project shared skill, install in project sessions"
```

---

## Phase 3 — CLI Startup Dispatch

### Task 8: Add `--project` and `--session-id` flags + startup branching

**Files:**
- Modify: `bin/pneuma-cli-helpers.ts` (extend `ParsedCliArgs` and `parseCliArgs`)
- Modify: `bin/pneuma.ts` (dispatch logic + env vars)
- Modify: `core/types/agent-backend.ts` (extend `AgentLaunchOptions`)
- Test: extend existing CLI helper tests; add new dispatch test

- [ ] **Step 1: Add the failing test**

Create `bin/__tests__/cli-args-project.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { parseCliArgs } from "../pneuma-cli-helpers.js";

describe("parseCliArgs project flags", () => {
  test("--project flag captured", () => {
    const args = parseCliArgs(["bun", "pneuma", "doc", "--project", "/tmp/p"]);
    expect(args.project).toBe("/tmp/p");
  });

  test("--session-id flag captured", () => {
    const args = parseCliArgs(["bun", "pneuma", "doc", "--session-id", "abc-123"]);
    expect(args.sessionIdOverride).toBe("abc-123");
  });

  test("flags absent → defaults", () => {
    const args = parseCliArgs(["bun", "pneuma", "doc", "--workspace", "/tmp/w"]);
    expect(args.project).toBe("");
    expect(args.sessionIdOverride).toBe("");
  });
});
```

- [ ] **Step 2: Run — confirm fails**

```bash
bun test bin/__tests__/cli-args-project.test.ts
```

- [ ] **Step 3: Extend `ParsedCliArgs` and parser**

In `bin/pneuma-cli-helpers.ts`:

(a) Add to interface:

```typescript
export interface ParsedCliArgs {
  // ... existing ...
  project: string;
  sessionIdOverride: string;
}
```

(b) Add to defaults in `parseCliArgs` body:

```typescript
let project = "";
let sessionIdOverride = "";
```

(c) Add cases inside the for-loop:

```typescript
case "--project":
  project = resolve(args[++i] ?? cwd);
  break;
case "--session-id":
  sessionIdOverride = args[++i] ?? "";
  break;
```

(d) Add to return:

```typescript
return { /* existing */, project, sessionIdOverride };
```

Also add `import { resolve } from "node:path";` if not already present.

- [ ] **Step 4: Run — confirm passes**

```bash
bun test bin/__tests__/cli-args-project.test.ts
```

- [ ] **Step 5: Extend `AgentLaunchOptions`**

In `core/types/agent-backend.ts:41`:

```typescript
export interface AgentLaunchOptions {
  // ... existing fields ...
  /** Working directory for the agent process. Defaults to workspace. */
  cwd?: string;
  /** Project root for project-scoped sessions; null for quick sessions. */
  projectRoot?: string | null;
  /** User-facing root (project root for project sessions, workspace for quick). */
  homeRoot?: string;
  /** Pneuma session id (for env injection). */
  sessionId?: string;
}
```

- [ ] **Step 6: Add the dispatch test**

Create `bin/__tests__/startup-dispatch.test.ts`:

```typescript
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveStartupContext } from "../startup-dispatch.js";

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pneuma-dispatch-"));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("resolveStartupContext", () => {
  test("workspace without project.json → quick context", async () => {
    const ctx = await resolveStartupContext({
      mode: "doc",
      workspace: tmp,
      project: "",
      sessionIdOverride: "",
    });
    expect(ctx.kind).toBe("quick");
    expect(ctx.paths.sessionDir).toBe(tmp);
    expect(ctx.paths.projectRoot).toBeNull();
  });

  test("workspace WITH project.json → project context, generates session id", async () => {
    await mkdir(join(tmp, ".pneuma"), { recursive: true });
    await writeFile(
      join(tmp, ".pneuma", "project.json"),
      JSON.stringify({ version: 1, name: "p", displayName: "P", createdAt: 1 })
    );
    const ctx = await resolveStartupContext({
      mode: "doc",
      workspace: tmp,
      project: "",
      sessionIdOverride: "",
    });
    expect(ctx.kind).toBe("project");
    expect(ctx.paths.projectRoot).toBe(tmp);
    expect(ctx.sessionId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(ctx.paths.sessionDir).toBe(join(tmp, ".pneuma", "sessions", ctx.sessionId));
  });

  test("explicit --project overrides workspace detection", async () => {
    const proj = join(tmp, "proj");
    await mkdir(join(proj, ".pneuma"), { recursive: true });
    await writeFile(
      join(proj, ".pneuma", "project.json"),
      JSON.stringify({ version: 1, name: "p", displayName: "P", createdAt: 1 })
    );
    const ctx = await resolveStartupContext({
      mode: "doc",
      workspace: tmp,
      project: proj,
      sessionIdOverride: "",
    });
    expect(ctx.kind).toBe("project");
    expect(ctx.paths.projectRoot).toBe(proj);
  });

  test("--session-id reuses given id", async () => {
    await mkdir(join(tmp, ".pneuma"), { recursive: true });
    await writeFile(
      join(tmp, ".pneuma", "project.json"),
      JSON.stringify({ version: 1, name: "p", displayName: "P", createdAt: 1 })
    );
    const ctx = await resolveStartupContext({
      mode: "doc",
      workspace: tmp,
      project: "",
      sessionIdOverride: "fixed-id",
    });
    expect(ctx.sessionId).toBe("fixed-id");
    expect(ctx.paths.sessionDir).toBe(join(tmp, ".pneuma", "sessions", "fixed-id"));
  });
});
```

- [ ] **Step 7: Implement startup-dispatch**

Create `bin/startup-dispatch.ts`:

```typescript
import { randomUUID } from "node:crypto";
import { detectWorkspaceKind } from "../core/project-loader.js";
import { resolveSessionPaths, type SessionPaths } from "../core/path-resolver-pneuma.js";

export interface StartupInput {
  mode: string;
  workspace: string;
  project: string;          // from --project flag, "" if not set
  sessionIdOverride: string; // from --session-id flag, "" if not set
}

export interface StartupContext {
  kind: "quick" | "project";
  sessionId: string;
  paths: SessionPaths;
}

export async function resolveStartupContext(input: StartupInput): Promise<StartupContext> {
  // Explicit --project wins; otherwise check workspace for project.json
  let projectRoot: string | null = null;
  if (input.project) {
    projectRoot = input.project;
  } else {
    const kind = await detectWorkspaceKind(input.workspace);
    if (kind === "project") projectRoot = input.workspace;
  }

  if (projectRoot) {
    const sessionId = input.sessionIdOverride || randomUUID();
    return {
      kind: "project",
      sessionId,
      paths: resolveSessionPaths({ kind: "project", projectRoot, sessionId }),
    };
  }

  // Quick session — use existing PersistedSession id if exists, else new
  // (For test purposes we leave id generation to the caller; quick sessions reuse on resume.)
  const sessionId = input.sessionIdOverride || randomUUID();
  return {
    kind: "quick",
    sessionId,
    paths: resolveSessionPaths({ kind: "quick", workspace: input.workspace }),
  };
}
```

- [ ] **Step 8: Run — confirm passes**

```bash
bun test bin/__tests__/startup-dispatch.test.ts
```

Expected: 4 pass.

- [ ] **Step 9: Wire into `bin/pneuma.ts`**

In `bin/pneuma.ts` main flow (around line 1240–1660):

(a) Replace direct workspace-based path computation with a call to `resolveStartupContext` early in main:

```typescript
const startup = await resolveStartupContext({
  mode: parsed.mode,
  workspace: parsed.workspace,
  project: parsed.project,
  sessionIdOverride: parsed.sessionIdOverride,
});
```

(b) Use `startup.paths` everywhere that previously hardcoded `<workspace>/.pneuma/...`:
- `session.json` path → `join(startup.paths.stateDir, "session.json")`
- `history.json` → `join(startup.paths.stateDir, "history.json")`
- `config.json` → `join(startup.paths.stateDir, "config.json")`
- `skill-version.json` → `join(startup.paths.stateDir, "skill-version.json")`
- skill install target → `startup.paths.sessionDir` (passed as `sessionDir` to `installSkill`)
- shadow-git init dir → `join(startup.paths.stateDir, "shadow.git")`

If `startup.kind === "project"`, mkdir `startup.paths.sessionDir` recursively before any file writes.

(c) Pass project context to `installSkill`:

```typescript
await installSkill({
  workspace: parsed.workspace,
  sessionDir: startup.paths.sessionDir,
  projectRoot: startup.paths.projectRoot,
  sessionId: startup.sessionId,
  manifest,
  modeSourceDir: resolved.path,
  params: resolvedParams,
  backendType: parsed.backendType,
  // ... other existing options
});
```

(d) Inject env vars at agent launch (find the `backend.launch({...})` call):

```typescript
const env = {
  ...process.env,
  PNEUMA_SESSION_DIR: startup.paths.sessionDir,
  PNEUMA_HOME_ROOT: startup.paths.homeRoot,
  PNEUMA_SESSION_ID: startup.sessionId,
  ...(startup.paths.projectRoot ? { PNEUMA_PROJECT_ROOT: startup.paths.projectRoot } : {}),
};

await backend.launch({
  cwd: startup.paths.sessionDir,
  projectRoot: startup.paths.projectRoot,
  homeRoot: startup.paths.homeRoot,
  sessionId: startup.sessionId,
  env,
  // ... existing options
});
```

(e) Update `recordSession` call to pass project info (will be used by Task 9).

- [ ] **Step 10: Smoke test the whole startup with a quick session**

```bash
bun bin/pneuma.ts doc --workspace /tmp/test-ws --no-open --no-prompt --port 17080
```

Expected: server starts, no error, session.json appears at `/tmp/test-ws/.pneuma/session.json`. Kill with Ctrl+C. (This is a manual smoke; quick session path must remain unchanged.)

- [ ] **Step 11: Smoke test with a project session**

```bash
mkdir -p /tmp/test-proj/.pneuma
echo '{"version":1,"name":"smoke","displayName":"Smoke","createdAt":1}' > /tmp/test-proj/.pneuma/project.json
bun bin/pneuma.ts doc --workspace /tmp/test-proj --no-open --no-prompt --port 17081
```

Expected: server starts; `ls /tmp/test-proj/.pneuma/sessions/<uuid>/` shows session.json + .claude/ + CLAUDE.md. Kill with Ctrl+C.

- [ ] **Step 12: Full suite + commit**

```bash
bun test
```

Expected: pass count up by ~7, all green.

```bash
git add bin/pneuma.ts bin/pneuma-cli-helpers.ts bin/startup-dispatch.ts bin/__tests__/cli-args-project.test.ts bin/__tests__/startup-dispatch.test.ts core/types/agent-backend.ts
git commit -m "feat(cli): branch startup on quick vs project; add --project / --session-id flags"
```

---

## Phase 4 — Sessions Registry Schema

### Task 9: Migrate `~/.pneuma/sessions.json` to projects + sessions object

**Files:**
- Modify: `bin/pneuma-cli-helpers.ts` (`SessionRecord` interface + reader/writer logic)
- Modify: `bin/pneuma.ts` (`recordSession` invocation path)
- Test: `bin/__tests__/sessions-registry-migration.test.ts` (new)

**Context:** Today the file is `SessionRecord[]` (array). 3.0 wraps it as `{ projects: ProjectSummary[]; sessions: SessionRecord[] }`. Reader auto-upgrades arrays. Writers always emit the new shape.

- [ ] **Step 1: Add the test**

```typescript
// bin/__tests__/sessions-registry-migration.test.ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSessionsFile, writeSessionsFile } from "../sessions-registry.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pneuma-reg-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("sessions registry migration", () => {
  test("reads legacy array as object with kind=quick", async () => {
    const file = join(dir, "sessions.json");
    await writeFile(file, JSON.stringify([
      {
        id: "/ws::doc",
        mode: "doc",
        displayName: "doc-1",
        workspace: "/ws",
        backendType: "claude-code",
        lastAccessed: 1,
      },
    ]));
    const data = await readSessionsFile(file);
    expect(data.projects).toEqual([]);
    expect(data.sessions).toHaveLength(1);
    expect(data.sessions[0].kind).toBe("quick");
    expect(data.sessions[0].mode).toBe("doc");
  });

  test("reads new shape unchanged", async () => {
    const file = join(dir, "sessions.json");
    await writeFile(file, JSON.stringify({
      projects: [{
        id: "/proj",
        name: "p",
        displayName: "P",
        root: "/proj",
        createdAt: 1,
        lastAccessed: 1,
      }],
      sessions: [{
        id: "/proj::abc",
        kind: "project",
        sessionId: "abc",
        projectRoot: "/proj",
        mode: "webcraft",
        displayName: "land",
        sessionDir: "/proj/.pneuma/sessions/abc",
        backendType: "claude-code",
        lastAccessed: 1,
      }],
    }));
    const data = await readSessionsFile(file);
    expect(data.projects).toHaveLength(1);
    expect(data.sessions[0].kind).toBe("project");
  });

  test("returns empty if file does not exist", async () => {
    const data = await readSessionsFile(join(dir, "missing.json"));
    expect(data).toEqual({ projects: [], sessions: [] });
  });

  test("write then read round-trips new shape", async () => {
    const file = join(dir, "sessions.json");
    await writeSessionsFile(file, {
      projects: [],
      sessions: [{
        id: "/ws::doc",
        kind: "quick",
        mode: "doc",
        displayName: "d",
        workspace: "/ws",
        sessionDir: "/ws",
        backendType: "claude-code",
        lastAccessed: 1,
      }],
    });
    const data = await readSessionsFile(file);
    expect(data.sessions).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run — confirm fails**

```bash
bun test bin/__tests__/sessions-registry-migration.test.ts
```

- [ ] **Step 3: Implement registry module**

Create `bin/sessions-registry.ts`:

```typescript
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentBackendType } from "../core/types/agent-backend.js";
import { getDefaultBackendType } from "../backends/index.js";

export interface ProjectRegistryEntry {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  root: string;
  createdAt: number;
  lastAccessed: number;
}

export interface QuickSessionRegistryEntry {
  id: string;
  kind: "quick";
  mode: string;
  displayName: string;
  sessionName?: string;
  workspace: string;
  sessionDir: string;
  backendType: AgentBackendType;
  lastAccessed: number;
  editing?: boolean;
}

export interface ProjectSessionRegistryEntry {
  id: string;
  kind: "project";
  sessionId: string;
  projectRoot: string;
  mode: string;
  displayName: string;
  sessionName?: string;
  sessionDir: string;
  backendType: AgentBackendType;
  lastAccessed: number;
  editing?: boolean;
}

export type AnySessionRegistryEntry =
  | QuickSessionRegistryEntry
  | ProjectSessionRegistryEntry;

export interface SessionsFile {
  projects: ProjectRegistryEntry[];
  sessions: AnySessionRegistryEntry[];
}

const EMPTY: SessionsFile = { projects: [], sessions: [] };

export async function readSessionsFile(path: string): Promise<SessionsFile> {
  if (!existsSync(path)) return { projects: [], sessions: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf-8"));
  } catch {
    return { projects: [], sessions: [] };
  }
  if (Array.isArray(raw)) {
    // Legacy: array of records → upgrade
    const sessions: AnySessionRegistryEntry[] = raw.map((r) => {
      const rec = r as Record<string, unknown>;
      return {
        id: String(rec.id ?? ""),
        kind: "quick",
        mode: String(rec.mode ?? "doc"),
        displayName: String(rec.displayName ?? ""),
        sessionName: typeof rec.sessionName === "string" ? rec.sessionName : undefined,
        workspace: String(rec.workspace ?? ""),
        sessionDir: String(rec.workspace ?? ""), // legacy: workspace == sessionDir
        backendType: (rec.backendType as AgentBackendType) ?? getDefaultBackendType(),
        lastAccessed: Number(rec.lastAccessed ?? 0),
        editing: typeof rec.editing === "boolean" ? rec.editing : undefined,
      };
    });
    return { projects: [], sessions };
  }
  if (raw && typeof raw === "object" && "sessions" in raw) {
    const obj = raw as { projects?: ProjectRegistryEntry[]; sessions?: AnySessionRegistryEntry[] };
    return {
      projects: Array.isArray(obj.projects) ? obj.projects : [],
      sessions: Array.isArray(obj.sessions) ? obj.sessions : [],
    };
  }
  return { ...EMPTY };
}

export async function writeSessionsFile(path: string, data: SessionsFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2), "utf-8");
}

export function upsertSession(
  data: SessionsFile,
  entry: AnySessionRegistryEntry,
  cap = 200
): SessionsFile {
  const filtered = data.sessions.filter((s) => s.id !== entry.id);
  filtered.unshift(entry);
  return { projects: data.projects, sessions: filtered.slice(0, cap) };
}

export function upsertProject(
  data: SessionsFile,
  entry: ProjectRegistryEntry
): SessionsFile {
  const filtered = data.projects.filter((p) => p.id !== entry.id);
  filtered.unshift(entry);
  return { projects: filtered, sessions: data.sessions };
}
```

- [ ] **Step 4: Run — confirm passes**

```bash
bun test bin/__tests__/sessions-registry-migration.test.ts
```

Expected: 4 pass.

- [ ] **Step 5: Wire into `bin/pneuma.ts`**

Find the existing `recordSession` call (around line 1290 area in helpers — check actual line). Replace its body with a call to the new module:

```typescript
// in bin/pneuma.ts after agent launches successfully
const sessionsPath = join(homedir(), ".pneuma", "sessions.json");
const data = await readSessionsFile(sessionsPath);

const entry: AnySessionRegistryEntry =
  startup.kind === "project"
    ? {
        id: `${startup.paths.projectRoot}::${startup.sessionId}`,
        kind: "project",
        sessionId: startup.sessionId,
        projectRoot: startup.paths.projectRoot!,
        mode: parsed.mode,
        displayName,
        sessionDir: startup.paths.sessionDir,
        backendType: parsed.backendType,
        lastAccessed: Date.now(),
        editing: parsed.viewing ? false : true,
      }
    : {
        id: `${parsed.workspace}::${parsed.mode}`,
        kind: "quick",
        mode: parsed.mode,
        displayName,
        workspace: parsed.workspace,
        sessionDir: startup.paths.sessionDir,
        backendType: parsed.backendType,
        lastAccessed: Date.now(),
        editing: parsed.viewing ? false : true,
      };

let next = upsertSession(data, entry);
if (startup.kind === "project") {
  // refresh project entry too
  const manifest = await loadProjectManifest(startup.paths.projectRoot!);
  if (manifest) {
    next = upsertProject(next, {
      id: startup.paths.projectRoot!,
      name: manifest.name,
      displayName: manifest.displayName,
      description: manifest.description,
      root: startup.paths.projectRoot!,
      createdAt: manifest.createdAt,
      lastAccessed: Date.now(),
    });
  }
}
await writeSessionsFile(sessionsPath, next);
```

The legacy `recordSession` in `pneuma-cli-helpers.ts` can be deprecated; rename or delete it after callers migrate. Confirm no other caller uses it (`grep -r "recordSession" bin/ server/ src/`).

- [ ] **Step 6: Smoke test**

Run quick session and verify `~/.pneuma/sessions.json` has new shape:

```bash
bun bin/pneuma.ts doc --workspace /tmp/test-ws --no-open --no-prompt --port 17082 &
sleep 2
cat ~/.pneuma/sessions.json | head -30
kill %1
```

Expected: file is `{ "projects": [...], "sessions": [...] }` shape.

- [ ] **Step 7: Commit**

```bash
git add bin/sessions-registry.ts bin/pneuma.ts bin/__tests__/sessions-registry-migration.test.ts
git commit -m "feat(registry): add sessions.json projects+sessions schema with legacy upgrade"
```

---

## Phase 5 — Handoff Protocol

### Task 10: Handoff watcher (server)

**Files:**
- Create: `server/handoff-watcher.ts`
- Create: `server/__tests__/handoff-watcher.test.ts`
- Modify: `server/index.ts` (instantiate watcher when project session)

- [ ] **Step 1: Add the test**

```typescript
// server/__tests__/handoff-watcher.test.ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHandoffWatcher } from "../handoff-watcher.js";

let dir: string;
let handoffsDir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pneuma-handoff-"));
  handoffsDir = join(dir, ".pneuma", "handoffs");
  await mkdir(handoffsDir, { recursive: true });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function makeHandoff(content: { id: string; target: string; intent: string }): string {
  return `---\nhandoff_id: ${content.id}\ntarget_mode: ${content.target}\nsource_session: src\nsource_mode: doc\nintent: ${content.intent}\ncreated_at: 2026-04-27T00:00:00Z\n---\n\n# Handoff\n\nbody here.\n`;
}

describe("startHandoffWatcher", () => {
  test("emits 'created' event when a new handoff file appears", async () => {
    const events: { type: string; id: string; target_mode: string }[] = [];
    const stop = await startHandoffWatcher({
      projectRoot: dir,
      onEvent: (e) => events.push({ type: e.type, id: e.handoff.frontmatter.handoff_id, target_mode: e.handoff.frontmatter.target_mode }),
    });

    await writeFile(join(handoffsDir, "h1.md"), makeHandoff({ id: "h1", target: "webcraft", intent: "build site" }));

    // wait for chokidar add event
    await new Promise((r) => setTimeout(r, 400));

    expect(events.length).toBe(1);
    expect(events[0]).toEqual({ type: "created", id: "h1", target_mode: "webcraft" });

    await stop();
  });

  test("emits 'deleted' event when handoff file is removed", async () => {
    const file = join(handoffsDir, "h2.md");
    await writeFile(file, makeHandoff({ id: "h2", target: "webcraft", intent: "x" }));

    const events: { type: string; id: string }[] = [];
    const stop = await startHandoffWatcher({
      projectRoot: dir,
      onEvent: (e) => events.push({ type: e.type, id: e.handoff.frontmatter.handoff_id }),
    });

    // initial scan emits 'created' for existing file
    await new Promise((r) => setTimeout(r, 400));
    events.length = 0; // reset

    await unlink(file);
    await new Promise((r) => setTimeout(r, 400));

    expect(events).toEqual([{ type: "deleted", id: "h2" }]);
    await stop();
  });

  test("ignores non-md files", async () => {
    const events: unknown[] = [];
    const stop = await startHandoffWatcher({
      projectRoot: dir,
      onEvent: (e) => events.push(e),
    });

    await writeFile(join(handoffsDir, "notes.txt"), "hello");
    await new Promise((r) => setTimeout(r, 400));

    expect(events.length).toBe(0);
    await stop();
  });
});
```

- [ ] **Step 2: Run — confirm fails**

```bash
bun test server/__tests__/handoff-watcher.test.ts
```

- [ ] **Step 3: Implement watcher**

```typescript
// server/handoff-watcher.ts
import chokidar, { type FSWatcher } from "chokidar";
import { readFile } from "node:fs/promises";
import { join, basename } from "node:path";

export interface HandoffFrontmatter {
  handoff_id: string;
  target_mode: string;
  target_session?: string;
  source_session?: string;
  source_mode?: string;
  source_display_name?: string;
  intent?: string;
  suggested_files?: string[];
  created_at?: string;
}

export interface ParsedHandoff {
  path: string;
  frontmatter: HandoffFrontmatter;
  body: string;
}

export type HandoffEvent =
  | { type: "created"; handoff: ParsedHandoff }
  | { type: "deleted"; handoff: ParsedHandoff };

export interface HandoffWatcherOptions {
  projectRoot: string;
  onEvent: (e: HandoffEvent) => void;
}

export async function startHandoffWatcher(
  options: HandoffWatcherOptions
): Promise<() => Promise<void>> {
  const dir = join(options.projectRoot, ".pneuma", "handoffs");
  const watcher: FSWatcher = chokidar.watch(dir, {
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
    depth: 0,
  });

  const cache = new Map<string, ParsedHandoff>();

  watcher.on("add", async (path) => {
    if (!path.endsWith(".md")) return;
    const parsed = await safeParse(path);
    if (!parsed) return;
    cache.set(path, parsed);
    options.onEvent({ type: "created", handoff: parsed });
  });

  watcher.on("change", async (path) => {
    if (!path.endsWith(".md")) return;
    const parsed = await safeParse(path);
    if (!parsed) return;
    cache.set(path, parsed);
    options.onEvent({ type: "created", handoff: parsed });
  });

  watcher.on("unlink", (path) => {
    if (!path.endsWith(".md")) return;
    const cached = cache.get(path);
    if (!cached) return;
    cache.delete(path);
    options.onEvent({ type: "deleted", handoff: cached });
  });

  return async () => {
    await watcher.close();
  };
}

async function safeParse(path: string): Promise<ParsedHandoff | null> {
  try {
    const raw = await readFile(path, "utf-8");
    const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!match) return null;
    const fm = parseFrontmatter(match[1]);
    if (!fm) return null;
    return { path, frontmatter: fm, body: match[2] };
  } catch {
    return null;
  }
}

function parseFrontmatter(body: string): HandoffFrontmatter | null {
  const fm: Record<string, unknown> = {};
  let currentList: string[] | null = null;
  for (const line of body.split("\n")) {
    if (currentList && line.startsWith("  - ")) {
      currentList.push(line.slice(4).trim());
      continue;
    }
    currentList = null;
    const kv = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (!kv) continue;
    const [, k, v] = kv;
    if (v === "") {
      const list: string[] = [];
      fm[k] = list;
      currentList = list;
    } else {
      fm[k] = v.trim();
    }
  }
  if (typeof fm.handoff_id !== "string" || typeof fm.target_mode !== "string") return null;
  return fm as unknown as HandoffFrontmatter;
}
```

- [ ] **Step 4: Run — confirm passes**

```bash
bun test server/__tests__/handoff-watcher.test.ts
```

Expected: 3 pass.

- [ ] **Step 5: Wire into server**

In `server/index.ts` `startServer` function, after the existing chokidar file-watcher setup, add:

```typescript
import { startHandoffWatcher } from "./handoff-watcher.js";

// ... inside startServer, after we know if this is a project session:
let stopHandoffWatcher: (() => Promise<void>) | null = null;
if (options.projectRoot) {
  stopHandoffWatcher = await startHandoffWatcher({
    projectRoot: options.projectRoot,
    onEvent: (e) => {
      // broadcast to all browser ws connections for this session
      wsBridge.broadcastToBrowser(options.sessionId, {
        type: "handoff_event",
        kind: e.type,
        handoff: e.handoff,
      });
    },
  });
}
```

Add to the shutdown handler:

```typescript
if (stopHandoffWatcher) await stopHandoffWatcher();
```

The `ServerOptions` interface needs a new optional `projectRoot?: string` field.

- [ ] **Step 6: Commit**

```bash
git add server/handoff-watcher.ts server/__tests__/handoff-watcher.test.ts server/index.ts
git commit -m "feat(server): handoff-watcher emits add/delete events to ws"
```

---

### Task 11: Handoff Card UI (frontend)

**Files:**
- Create: `src/components/HandoffCard.tsx`
- Create: `src/store/project-slice.ts`
- Modify: `src/store/index.ts` (or wherever the root store is composed) to include `project-slice`
- Modify: `src/App.tsx` (mount HandoffCard overlay when handoff present)
- Modify: `src/ws.ts` (route `handoff_event` messages into project-slice)

**Context:** No deep TDD here — UI component plus a small store slice. We add a unit test for the slice reducer-like updates and rely on manual verification for the rendered card.

- [ ] **Step 1: Add the slice unit test**

```typescript
// src/store/__tests__/project-slice.test.ts
import { describe, expect, test } from "bun:test";
import { create } from "zustand";
import { createProjectSlice, type ProjectSlice } from "../project-slice.js";

describe("project-slice", () => {
  test("recordHandoffCreated adds to inbox keyed by handoff_id", () => {
    const useStore = create<ProjectSlice>((set, get) => createProjectSlice(set, get));
    useStore.getState().recordHandoffCreated({
      path: "/p/.pneuma/handoffs/h1.md",
      frontmatter: { handoff_id: "h1", target_mode: "webcraft" },
      body: "body",
    });
    expect(useStore.getState().handoffInbox.has("h1")).toBe(true);
  });

  test("recordHandoffDeleted removes from inbox", () => {
    const useStore = create<ProjectSlice>((set, get) => createProjectSlice(set, get));
    const h = { path: "x", frontmatter: { handoff_id: "h1", target_mode: "w" }, body: "" };
    useStore.getState().recordHandoffCreated(h);
    useStore.getState().recordHandoffDeleted("h1");
    expect(useStore.getState().handoffInbox.has("h1")).toBe(false);
  });
});
```

- [ ] **Step 2: Run — confirm fails**

```bash
bun test src/store/__tests__/project-slice.test.ts
```

- [ ] **Step 3: Implement the slice**

```typescript
// src/store/project-slice.ts
import type { StateCreator } from "zustand";

export interface HandoffData {
  path: string;
  frontmatter: {
    handoff_id: string;
    target_mode: string;
    target_session?: string;
    source_session?: string;
    source_mode?: string;
    source_display_name?: string;
    intent?: string;
    suggested_files?: string[];
    created_at?: string;
  };
  body: string;
}

export interface ProjectContext {
  projectRoot: string | null;
  homeRoot: string;
  sessionDir: string;
  projectName?: string;
  projectDescription?: string;
}

export interface ProjectSlice {
  projectContext: ProjectContext | null;
  handoffInbox: Map<string, HandoffData>;
  setProjectContext: (ctx: ProjectContext | null) => void;
  recordHandoffCreated: (h: HandoffData) => void;
  recordHandoffDeleted: (handoffId: string) => void;
  clearHandoffs: () => void;
}

export const createProjectSlice: StateCreator<ProjectSlice> = (set) => ({
  projectContext: null,
  handoffInbox: new Map(),
  setProjectContext: (ctx) => set({ projectContext: ctx }),
  recordHandoffCreated: (h) =>
    set((s) => {
      const next = new Map(s.handoffInbox);
      next.set(h.frontmatter.handoff_id, h);
      return { handoffInbox: next };
    }),
  recordHandoffDeleted: (id) =>
    set((s) => {
      const next = new Map(s.handoffInbox);
      next.delete(id);
      return { handoffInbox: next };
    }),
  clearHandoffs: () => set({ handoffInbox: new Map() }),
});
```

Then mount it in `src/store/index.ts` (the existing combined store) — follow the pattern of existing slices. Search:

```bash
grep -n "createSessionSlice\|createPluginSlice" src/store/index.ts
```

Add `createProjectSlice` mounting alongside.

- [ ] **Step 4: Run — confirm passes**

```bash
bun test src/store/__tests__/project-slice.test.ts
```

- [ ] **Step 5: Implement HandoffCard**

```tsx
// src/components/HandoffCard.tsx
import { useStore } from "../store/index.js";

export function HandoffCard() {
  const inbox = useStore((s) => s.handoffInbox);
  const projectContext = useStore((s) => s.projectContext);
  const sessionMode = useStore((s) => s.sessionMode);

  if (!projectContext) return null;

  // Show only handoffs whose target_mode does NOT match current session's mode
  // (the current session would have already consumed its own pending ones).
  // Pending = those targeting another mode; we surface them on the source side
  // so the user can confirm switch.
  const items = Array.from(inbox.values()).filter(
    (h) => h.frontmatter.target_mode !== sessionMode
  );

  if (items.length === 0) return null;

  const handleConfirm = async (handoffId: string) => {
    await fetch(`/api/handoffs/${handoffId}/confirm`, { method: "POST" });
  };
  const handleCancel = async (handoffId: string) => {
    await fetch(`/api/handoffs/${handoffId}/cancel`, { method: "POST" });
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 w-[420px] flex flex-col gap-3">
      {items.map((h) => (
        <div
          key={h.frontmatter.handoff_id}
          className="bg-cc-surface border border-cc-border rounded-xl shadow-2xl p-4"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-cc-fg-muted text-sm">Handoff Ready</span>
            <span className="text-cc-primary text-sm">
              {h.frontmatter.source_mode} → {h.frontmatter.target_mode}
            </span>
          </div>
          {h.frontmatter.intent && (
            <div className="text-cc-fg text-sm mb-3">{h.frontmatter.intent}</div>
          )}
          <details className="mb-3">
            <summary className="cursor-pointer text-cc-fg-muted text-xs">
              Show full handoff
            </summary>
            <pre className="text-xs text-cc-fg-muted whitespace-pre-wrap mt-2 max-h-64 overflow-auto">
              {h.body}
            </pre>
          </details>
          <div className="flex gap-2 justify-end">
            <button
              className="px-3 py-1 text-sm border border-cc-border rounded hover:border-cc-fg-muted"
              onClick={() => handleCancel(h.frontmatter.handoff_id)}
            >
              Cancel
            </button>
            <button
              className="px-3 py-1 text-sm bg-cc-primary text-white rounded hover:opacity-90"
              onClick={() => handleConfirm(h.frontmatter.handoff_id)}
            >
              Confirm Switch
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Wire into App**

Add to `src/App.tsx` near the bottom of the editor-layout JSX:

```tsx
import { HandoffCard } from "./components/HandoffCard.js";
// ...
<HandoffCard />
```

- [ ] **Step 7: Wire WS message routing**

In `src/ws.ts`, where the existing `onMessage` switch handles message types, add:

```typescript
case "handoff_event": {
  const store = useStore.getState();
  if (msg.kind === "created") store.recordHandoffCreated(msg.handoff);
  if (msg.kind === "deleted") store.recordHandoffDeleted(msg.handoff.frontmatter.handoff_id);
  break;
}
```

- [ ] **Step 8: Manual visual check**

(Defer to Task 17 smoke test where the full handoff lifecycle exists.)

- [ ] **Step 9: Commit**

```bash
git add src/store/project-slice.ts src/store/__tests__/project-slice.test.ts src/store/index.ts src/components/HandoffCard.tsx src/App.tsx src/ws.ts
git commit -m "feat(ui): add project-slice and HandoffCard for pending handoffs"
```

---

## Phase 6 — Launcher (project list, create dialog, project page)

### Task 12: Backend API for projects

**Files:**
- Modify: `server/index.ts` — add routes
- Test: extend the relevant routes test (or create `server/__tests__/projects-routes.test.ts`)

- [ ] **Step 1: Add the route test**

```typescript
// server/__tests__/projects-routes.test.ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
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
});
```

- [ ] **Step 2: Run — confirm fails**

```bash
bun test server/__tests__/projects-routes.test.ts
```

- [ ] **Step 3: Implement routes**

Create `server/projects-routes.ts`:

```typescript
import type { Hono } from "hono";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  loadProjectManifest,
  scanProjectSessions,
  writeProjectManifest,
} from "../core/project-loader.js";
import {
  readSessionsFile,
  writeSessionsFile,
  upsertProject,
} from "../bin/sessions-registry.js";

export interface ProjectsRoutesOptions {
  homeDir: string; // typically homedir(); for tests, override
}

export function mountProjectsRoutes(app: Hono, options: ProjectsRoutesOptions): void {
  const sessionsPath = join(options.homeDir, ".pneuma", "sessions.json");

  app.get("/api/projects", async (c) => {
    const data = await readSessionsFile(sessionsPath);
    return c.json({ projects: data.projects });
  });

  app.post("/api/projects", async (c) => {
    const body = (await c.req.json()) as {
      root: string;
      name: string;
      displayName: string;
      description?: string;
    };
    if (!body.root || !body.name || !body.displayName) {
      return c.json({ error: "missing fields" }, 400);
    }
    const manifestPath = join(body.root, ".pneuma", "project.json");
    if (existsSync(manifestPath)) {
      return c.json({ error: "project already exists at this path" }, 409);
    }
    const now = Date.now();
    await writeProjectManifest(body.root, {
      version: 1,
      name: body.name,
      displayName: body.displayName,
      description: body.description,
      createdAt: now,
    });

    // register in sessions.json projects[]
    const data = await readSessionsFile(sessionsPath);
    const next = upsertProject(data, {
      id: body.root,
      name: body.name,
      displayName: body.displayName,
      description: body.description,
      root: body.root,
      createdAt: now,
      lastAccessed: now,
    });
    await writeSessionsFile(sessionsPath, next);

    return c.json({ created: true, root: body.root });
  });

  app.get("/api/projects/:id/sessions", async (c) => {
    const id = decodeURIComponent(c.req.param("id"));
    const manifest = await loadProjectManifest(id);
    if (!manifest) return c.json({ error: "not a project" }, 404);
    const refs = await scanProjectSessions(id);
    return c.json({
      project: { ...manifest, root: id },
      sessions: refs,
    });
  });
}
```

- [ ] **Step 4: Mount routes in server/index.ts**

```typescript
import { mountProjectsRoutes } from "./projects-routes.js";
import { homedir } from "node:os";
// inside startServer, after Hono app is created:
mountProjectsRoutes(app, { homeDir: homedir() });
```

- [ ] **Step 5: Run — confirm passes**

```bash
bun test server/__tests__/projects-routes.test.ts
```

Expected: 4 pass.

- [ ] **Step 6: Commit**

```bash
git add server/projects-routes.ts server/__tests__/projects-routes.test.ts server/index.ts
git commit -m "feat(server): /api/projects routes (list, create, sessions)"
```

---

### Task 13: Recent Projects + Create Project dialog (Launcher UI)

**Files:**
- Modify: `src/components/Launcher.tsx` (new section + button)
- Create: `src/components/CreateProjectDialog.tsx`

**Context:** UI work; manual visual verification required after each commit.

- [ ] **Step 1: Implement CreateProjectDialog**

```tsx
// src/components/CreateProjectDialog.tsx
import { useState } from "react";

export interface CreateProjectDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (root: string) => void;
}

export function CreateProjectDialog({ open, onClose, onCreated }: CreateProjectDialogProps) {
  const [root, setRoot] = useState("");
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const submit = async () => {
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ root, name: name || basename(root), displayName: displayName || name || basename(root), description }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "create failed");
        setSubmitting(false);
        return;
      }
      onCreated(data.root);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center">
      <div className="bg-cc-surface border border-cc-border rounded-xl p-6 w-[480px]">
        <h2 className="text-cc-fg text-lg mb-4">Create Project</h2>
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="text-cc-fg-muted">Project root path (must already exist)</span>
            <input className="w-full mt-1 bg-cc-bg border border-cc-border rounded px-2 py-1 text-cc-fg"
                   value={root} onChange={(e) => setRoot(e.target.value)}
                   placeholder="/Users/x/Code/my-project" />
          </label>
          <label className="block text-sm">
            <span className="text-cc-fg-muted">Display name</span>
            <input className="w-full mt-1 bg-cc-bg border border-cc-border rounded px-2 py-1 text-cc-fg"
                   value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                   placeholder="My Project" />
          </label>
          <label className="block text-sm">
            <span className="text-cc-fg-muted">Description (optional)</span>
            <textarea className="w-full mt-1 bg-cc-bg border border-cc-border rounded px-2 py-1 text-cc-fg"
                      rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
        </div>
        {error && <div className="mt-3 text-red-400 text-sm">{error}</div>}
        <div className="flex justify-end gap-2 mt-5">
          <button className="px-3 py-1 text-sm border border-cc-border rounded" onClick={onClose}>
            Cancel
          </button>
          <button
            className="px-3 py-1 text-sm bg-cc-primary text-white rounded disabled:opacity-50"
            disabled={!root || submitting}
            onClick={submit}
          >
            {submitting ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

function basename(p: string): string {
  const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return idx >= 0 ? p.slice(idx + 1) : p;
}
```

- [ ] **Step 2: Add Recent Projects section + Create button to Launcher**

Open `src/components/Launcher.tsx`. Find where Recent Sessions is rendered (search for "Recent Sessions" or `recent`). Add above it:

```tsx
import { useState, useEffect } from "react";
import { CreateProjectDialog } from "./CreateProjectDialog.js";

// inside Launcher component:
const [projects, setProjects] = useState<Array<{ id: string; root: string; displayName: string; lastAccessed: number }>>([]);
const [createOpen, setCreateOpen] = useState(false);

const reloadProjects = async () => {
  const res = await fetch("/api/projects");
  const data = await res.json();
  setProjects(data.projects ?? []);
};
useEffect(() => { void reloadProjects(); }, []);

// ... in JSX, before Recent Sessions:
<section className="mb-6">
  <div className="flex items-center justify-between mb-2">
    <h3 className="text-cc-fg-muted text-sm uppercase">Recent Projects</h3>
    <button className="text-cc-primary text-sm" onClick={() => setCreateOpen(true)}>
      + Create Project
    </button>
  </div>
  {projects.length === 0 && (
    <div className="text-cc-fg-muted text-sm">No projects yet.</div>
  )}
  <div className="grid grid-cols-2 gap-2">
    {projects.map((p) => (
      <a key={p.id} href={`/project?root=${encodeURIComponent(p.root)}`}
         className="block bg-cc-surface border border-cc-border rounded p-3 hover:border-cc-primary">
        <div className="text-cc-fg">{p.displayName}</div>
        <div className="text-cc-fg-muted text-xs mt-1 truncate">{p.root}</div>
      </a>
    ))}
  </div>
</section>
<CreateProjectDialog
  open={createOpen}
  onClose={() => setCreateOpen(false)}
  onCreated={() => void reloadProjects()}
/>
```

- [ ] **Step 3: Manual visual check**

```bash
bun run dev --no-prompt &
# open http://localhost:17996 in browser; verify Recent Projects section renders
# click + Create Project; fill form; verify project.json appears at /tmp/test-create
mkdir -p /tmp/test-create
# In dialog: root=/tmp/test-create, displayName="Test Create"
# After Create: section shows new entry; check /tmp/test-create/.pneuma/project.json exists
```

Use chrome-devtools-mcp or manual screenshot to confirm visual quality (per CLAUDE.md "Visual verification for frontend changes" rule).

- [ ] **Step 4: Commit**

```bash
git add src/components/CreateProjectDialog.tsx src/components/Launcher.tsx
git commit -m "feat(launcher): Recent Projects section + Create Project dialog"
```

---

### Task 14: Project page

**Files:**
- Create: `src/components/ProjectPage.tsx`
- Modify: `src/App.tsx` to route to ProjectPage when URL has `?project=...`

**Context:** Show sessions in a project + buttons to create new session in any mode + evolve project preferences (button stub for now; wired in Phase 8).

- [ ] **Step 1: Implement ProjectPage**

```tsx
// src/components/ProjectPage.tsx
import { useEffect, useState } from "react";

export interface ProjectPageProps {
  projectRoot: string;
  onBack: () => void;
  onOpenSession: (sessionId: string, mode: string) => void;
}

interface ProjectPageState {
  project: { name: string; displayName: string; description?: string } | null;
  sessions: Array<{ sessionId: string; mode: string; sessionDir: string }>;
  loading: boolean;
  error: string;
}

export function ProjectPage({ projectRoot, onBack, onOpenSession }: ProjectPageProps) {
  const [state, setState] = useState<ProjectPageState>({
    project: null,
    sessions: [],
    loading: true,
    error: "",
  });
  const [modes, setModes] = useState<string[]>([]);
  const [selectedMode, setSelectedMode] = useState("doc");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(projectRoot)}/sessions`);
        const data = await res.json();
        if (!res.ok) {
          setState({ project: null, sessions: [], loading: false, error: data.error });
          return;
        }
        setState({
          project: data.project,
          sessions: data.sessions,
          loading: false,
          error: "",
        });
      } catch (e) {
        setState({ project: null, sessions: [], loading: false, error: String(e) });
      }
    })();
    // load modes for the new-session selector
    (async () => {
      const res = await fetch("/api/modes");
      const data = await res.json();
      setModes(data.modes?.map((m: { name: string }) => m.name) ?? []);
    })();
  }, [projectRoot]);

  const startNewSession = async () => {
    const res = await fetch("/api/launch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: selectedMode,
        project: projectRoot,
      }),
    });
    const data = await res.json();
    if (data.url) window.location.href = data.url;
  };

  if (state.loading) return <div className="p-6 text-cc-fg-muted">Loading...</div>;
  if (state.error) return <div className="p-6 text-red-400">{state.error}</div>;
  if (!state.project) return <div className="p-6">Project not found</div>;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <button className="text-cc-fg-muted text-sm mb-4" onClick={onBack}>← Back</button>
      <h1 className="text-cc-fg text-2xl">{state.project.displayName}</h1>
      <div className="text-cc-fg-muted text-sm mt-1">{projectRoot}</div>
      {state.project.description && (
        <p className="text-cc-fg mt-2">{state.project.description}</p>
      )}

      <section className="mt-6">
        <h2 className="text-cc-fg-muted text-sm uppercase mb-2">Start New Session</h2>
        <div className="flex gap-2 items-center">
          <select className="bg-cc-bg border border-cc-border rounded px-2 py-1 text-cc-fg"
                  value={selectedMode} onChange={(e) => setSelectedMode(e.target.value)}>
            {modes.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <button className="px-3 py-1 bg-cc-primary text-white rounded" onClick={startNewSession}>
            Launch
          </button>
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-cc-fg-muted text-sm uppercase mb-2">Sessions ({state.sessions.length})</h2>
        {state.sessions.length === 0 && (
          <div className="text-cc-fg-muted text-sm">No sessions yet.</div>
        )}
        <ul className="space-y-2">
          {state.sessions.map((s) => (
            <li key={s.sessionId}>
              <button
                className="w-full text-left bg-cc-surface border border-cc-border rounded px-3 py-2 hover:border-cc-primary"
                onClick={() => onOpenSession(s.sessionId, s.mode)}
              >
                <span className="text-cc-primary">{s.mode}</span>
                <span className="text-cc-fg ml-2">{s.sessionId}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Wire into App routing**

Open `src/App.tsx`. Search for the existing launcher render branch. Add a project page branch — read `?project=` from `window.location.search`:

```tsx
const url = new URL(window.location.href);
const projectParam = url.searchParams.get("project");

if (isLauncher && projectParam) {
  return (
    <ProjectPage
      projectRoot={projectParam}
      onBack={() => { url.searchParams.delete("project"); window.location.href = url.toString(); }}
      onOpenSession={(sessionId, mode) => {
        // Reuse existing /api/launch flow with project + sessionId
        fetch("/api/launch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode, project: projectParam, sessionId }),
        }).then((r) => r.json()).then((d) => { if (d.url) window.location.href = d.url; });
      }}
    />
  );
}
```

Also update Launcher's `<a href="/project?root=...">` to use `?project=` consistently.

- [ ] **Step 3: Extend `/api/launch` to accept `project` and `sessionId`**

In `server/index.ts`'s `/api/launch` handler (search for `/api/launch`), accept the new fields and pass `--project` / `--session-id` to the spawned child process arg list.

- [ ] **Step 4: Manual visual check**

```bash
bun run dev --no-prompt &
# In browser: create a project, click into it, verify sessions list (should be empty),
# launch a doc session, verify it spawns inside <projectRoot>/.pneuma/sessions/<id>/
```

- [ ] **Step 5: Commit**

```bash
git add src/components/ProjectPage.tsx src/App.tsx server/index.ts
git commit -m "feat(launcher): project page with sessions list and launch flow"
```

---

## Phase 7 — Mode Switch UX

### Task 15: Mode Switcher Dropdown

**Files:**
- Create: `src/components/ModeSwitcherDropdown.tsx`
- Modify: `src/App.tsx` (or wherever the mode tag is rendered in the editor header)

- [ ] **Step 1: Implement the dropdown**

```tsx
// src/components/ModeSwitcherDropdown.tsx
import { useEffect, useState } from "react";
import { useStore } from "../store/index.js";

export function ModeSwitcherDropdown() {
  const projectContext = useStore((s) => s.projectContext);
  const sessionMode = useStore((s) => s.sessionMode);
  const sendChatMessage = useStore((s) => s.sendChatMessage); // existing action
  const [open, setOpen] = useState(false);
  const [modes, setModes] = useState<string[]>([]);
  const [siblings, setSiblings] = useState<Array<{ sessionId: string; mode: string }>>([]);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const r1 = await fetch("/api/modes");
      const d1 = await r1.json();
      setModes(d1.modes?.map((m: { name: string }) => m.name) ?? []);
      if (projectContext?.projectRoot) {
        const r2 = await fetch(`/api/projects/${encodeURIComponent(projectContext.projectRoot)}/sessions`);
        const d2 = await r2.json();
        setSiblings(d2.sessions ?? []);
      }
    })();
  }, [open, projectContext]);

  if (!projectContext) {
    return <span className="px-2 py-1 text-sm text-cc-fg-muted">{sessionMode}</span>;
  }

  const switchTo = async (target: string, targetSession: string | "auto" = "auto") => {
    const intent = window.prompt(`Switch to ${target}. What should the new session do?`, "");
    if (intent === null) { setOpen(false); return; }
    const tag = `<pneuma:request-handoff target="${target}" target_session="${targetSession}" intent="${intent.replace(/"/g, "&quot;")}" />`;
    sendChatMessage(tag);
    setOpen(false);
  };

  const otherSiblings = siblings.filter((s) => s.mode !== sessionMode);
  const siblingsByMode = new Map<string, Array<{ sessionId: string }>>();
  for (const s of otherSiblings) {
    if (!siblingsByMode.has(s.mode)) siblingsByMode.set(s.mode, []);
    siblingsByMode.get(s.mode)!.push({ sessionId: s.sessionId });
  }

  return (
    <div className="relative">
      <button
        className="px-2 py-1 text-sm bg-cc-surface border border-cc-border rounded hover:border-cc-primary"
        onClick={() => setOpen(!open)}
      >
        {sessionMode} ▼
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 w-64 bg-cc-surface border border-cc-border rounded shadow-2xl z-50">
          <div className="px-3 py-2 text-cc-fg-muted text-xs uppercase">Switch mode</div>
          {modes.filter((m) => m !== sessionMode).map((m) => {
            const existing = siblingsByMode.get(m);
            return (
              <div key={m} className="border-t border-cc-border">
                <button
                  className="w-full text-left px-3 py-2 hover:bg-cc-bg/50 text-cc-fg"
                  onClick={() => switchTo(m, existing?.[0].sessionId ?? "auto")}
                >
                  {m} {existing && <span className="text-cc-fg-muted text-xs ml-2">({existing.length} existing)</span>}
                </button>
                {existing && existing.length > 1 && (
                  <div className="pl-4">
                    {existing.map((e) => (
                      <button key={e.sessionId}
                              className="block w-full text-left px-3 py-1 text-cc-fg-muted text-xs hover:text-cc-fg"
                              onClick={() => switchTo(m, e.sessionId)}>
                        Resume {e.sessionId.slice(0, 8)}
                      </button>
                    ))}
                  </div>
                )}
                <button
                  className="block w-full text-left px-3 py-1 text-cc-fg-muted text-xs hover:text-cc-fg pl-6"
                  onClick={() => switchTo(m, "auto")}
                >
                  + New {m} session
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Mount in editor header**

Find the existing place in `src/App.tsx` (or `src/components/TopBar.tsx`) that displays the current mode label. Replace with `<ModeSwitcherDropdown />`.

- [ ] **Step 3: Manual visual check**

```bash
bun run dev --no-prompt &
# create a project, launch doc session, verify mode tag becomes a dropdown
# click → see other modes; clicking webcraft prompts for intent then injects tag
# verify chat shows the <pneuma:request-handoff ...> message
```

- [ ] **Step 4: Commit**

```bash
git add src/components/ModeSwitcherDropdown.tsx src/App.tsx
git commit -m "feat(ui): mode switcher dropdown for project sessions"
```

---

### Task 16: Confirm/Cancel handoff API + execution

**Files:**
- Modify: `server/index.ts` (or `server/projects-routes.ts`) — add `/api/handoffs/:id/confirm` and `/api/handoffs/:id/cancel`
- Test: extend `server/__tests__/projects-routes.test.ts`

**Context:** Confirm flow: read handoff frontmatter → kill source backend → write `switched_out` event to source `history.json` → launch target session via existing `/api/launch` machinery (passing `--project` + `--session-id` if target_session != "auto") → write `switched_in` event to target session's `history.json`. Cancel flow: just `unlink` the handoff file.

This is the most complex single task; break carefully.

- [ ] **Step 1: Add tests for cancel + confirm-without-target-session**

```typescript
// extend server/__tests__/projects-routes.test.ts

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
});
```

- [ ] **Step 2: Run — confirm fails**

- [ ] **Step 3: Implement cancel route**

In `server/projects-routes.ts`:

```typescript
import { unlink } from "node:fs/promises";

app.post("/api/handoffs/:id/cancel", async (c) => {
  const id = c.req.param("id");
  const project = c.req.query("project");
  if (!project) return c.json({ error: "project required" }, 400);
  const dir = join(project, ".pneuma", "handoffs");
  const target = join(dir, `${id}.md`);
  if (!existsSync(target)) return c.json({ error: "not found" }, 404);
  await unlink(target);
  return c.json({ cancelled: true });
});
```

- [ ] **Step 4: Implement confirm route (more complex)**

```typescript
import { readFile, appendFile } from "node:fs/promises";
import { startHandoffWatcher } from "./handoff-watcher.js"; // already imported
// We need a reference to the active backend manager. The simplest path:
// the confirm route triggers an internal "switch" pipeline that uses the
// same primitives /api/launch already uses to spawn a new session, plus
// a kill-current-session step.

app.post("/api/handoffs/:id/confirm", async (c) => {
  const id = c.req.param("id");
  const project = c.req.query("project");
  if (!project) return c.json({ error: "project required" }, 400);
  const handoffPath = join(project, ".pneuma", "handoffs", `${id}.md`);
  if (!existsSync(handoffPath)) return c.json({ error: "not found" }, 404);

  const raw = await readFile(handoffPath, "utf-8");
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return c.json({ error: "invalid handoff" }, 400);
  const fm: Record<string, string> = {};
  for (const line of fmMatch[1].split("\n")) {
    const kv = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].trim();
  }

  // Source: kill if running
  const sourceSessionId = fm.source_session;
  if (sourceSessionId && options.killSession) {
    await options.killSession(sourceSessionId);
    // append switched_out event to source history
    const sourceHistory = findSessionHistory(project, sourceSessionId);
    if (sourceHistory) {
      await appendSessionEvent(sourceHistory, {
        type: "session_event",
        subtype: "switched_out",
        handoff_id: id,
        ts: Date.now(),
      });
    }
  }

  // Target: spawn via launcher with --project + --session-id
  const target = fm.target_mode;
  const targetSession = fm.target_session && fm.target_session !== "auto" ? fm.target_session : "";
  const launchUrl = await options.launchSession({
    mode: target,
    project,
    sessionId: targetSession,
  });

  return c.json({ confirmed: true, launchUrl, handoffId: id });
});
```

`options.killSession` and `options.launchSession` are new function-typed callbacks passed by `server/index.ts` when mounting routes — they let routes invoke session lifecycle ops without circular imports.

`findSessionHistory(project, sessionId)` returns the path to `<project>/.pneuma/sessions/<id>/history.json` or null.

`appendSessionEvent(historyPath, event)` reads, appends, writes — a small helper.

Add helpers:

```typescript
// server/projects-routes.ts (helpers)
async function findSessionHistory(project: string, sessionId: string): Promise<string | null> {
  const path = join(project, ".pneuma", "sessions", sessionId, "history.json");
  return existsSync(path) ? path : null;
}

interface SessionEvent {
  type: "session_event";
  subtype: "switched_out" | "switched_in";
  handoff_id: string;
  ts: number;
}

async function appendSessionEvent(historyPath: string, event: SessionEvent): Promise<void> {
  let arr: unknown[] = [];
  try {
    const raw = await readFile(historyPath, "utf-8");
    const data = JSON.parse(raw);
    if (Array.isArray(data)) arr = data;
    else if (data && typeof data === "object" && Array.isArray((data as { messages?: unknown[] }).messages)) {
      arr = (data as { messages: unknown[] }).messages;
    }
  } catch { /* ignore */ }
  arr.push(event);
  await writeFile(historyPath, JSON.stringify(arr, null, 2), "utf-8");
}
```

- [ ] **Step 5: Wire callbacks in server/index.ts**

In `startServer`, pass the existing kill + launch primitives:

```typescript
mountProjectsRoutes(app, {
  homeDir: homedir(),
  killSession: async (sessionId) => {
    // existing kill machinery — find by sessionId across active backends
    await sessionManager.killSession(sessionId);
  },
  launchSession: async ({ mode, project, sessionId }) => {
    return await launcherSpawnChild({
      mode,
      project,
      sessionId,
      backendType: getDefaultBackendType(),
    });
  },
});
```

`sessionManager.killSession` and `launcherSpawnChild` should already exist in some form — check `bin/pneuma.ts:1100-1200` for the existing `/api/launch` flow. Refactor as needed to expose these primitives.

- [ ] **Step 6: Add `switched_in` event when target session starts**

In `bin/pneuma.ts` after agent successfully launches in a project session, check if `<project>/.pneuma/handoffs/` has any handoff for this session/mode — if yes, append `switched_in` event to local history.json. The `installSkill` injection already surfaces the file to the agent; the event recording is in addition.

- [ ] **Step 7: Run tests**

```bash
bun test server/__tests__/projects-routes.test.ts
```

Expected: cancel test passes; confirm test (if added) passes given mocked callbacks.

- [ ] **Step 8: Manual end-to-end smoke**

```bash
# in worktree
mkdir -p /tmp/handoff-proj
echo '{"version":1,"name":"smoke","displayName":"Smoke","createdAt":1}' > /tmp/handoff-proj/.pneuma/project.json
bun run dev --no-prompt &

# In browser: open the project, launch a doc session
# In the chat, type or click: <pneuma:request-handoff target="webcraft" target_session="auto" intent="build the landing" />
# Wait for agent to write handoff file
# Verify HandoffCard appears
# Click Confirm → window navigates to webcraft session
# Verify webcraft session's CLAUDE.md has pneuma:handoff block
# Verify agent reads + deletes the handoff file (it's gone from /tmp/handoff-proj/.pneuma/handoffs/)
# Verify both source and target history.json have session_event entries
```

- [ ] **Step 9: Commit**

```bash
git add server/projects-routes.ts server/index.ts bin/pneuma.ts server/__tests__/projects-routes.test.ts
git commit -m "feat(handoff): confirm/cancel routes + session_event on switch"
```

---

## Phase 8 — Project Evolution

### Task 17: Project-scope evolve entry

**Files:**
- Modify: `src/components/ProjectPage.tsx` — wire "Evolve Project Preferences" button
- Modify: `bin/pneuma.ts` — when running `evolve` mode with `--project`, set workspace = projectRoot and pass project context to evolution-agent
- Modify: `server/evolution-agent.ts` — when project mode is active, scan `<project>/.pneuma/sessions/*/history.json` instead of just current
- Test: `server/__tests__/evolution-project.test.ts` (new)

- [ ] **Step 1: Add a small focused test**

```typescript
// server/__tests__/evolution-project.test.ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectProjectHistorySources } from "../evolution-agent.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pneuma-evol-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("collectProjectHistorySources", () => {
  test("returns history paths for each session in the project", async () => {
    await mkdir(join(dir, ".pneuma", "sessions", "s1"), { recursive: true });
    await mkdir(join(dir, ".pneuma", "sessions", "s2"), { recursive: true });
    await writeFile(join(dir, ".pneuma", "sessions", "s1", "history.json"), "[]");
    await writeFile(join(dir, ".pneuma", "sessions", "s2", "history.json"), "[]");

    const paths = await collectProjectHistorySources(dir);
    expect(paths).toHaveLength(2);
    expect(paths.every((p) => p.endsWith("history.json"))).toBe(true);
  });

  test("returns empty when no sessions", async () => {
    expect(await collectProjectHistorySources(dir)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — confirm fails**

- [ ] **Step 3: Implement helper in evolution-agent.ts**

In `server/evolution-agent.ts`, export:

```typescript
import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

export async function collectProjectHistorySources(projectRoot: string): Promise<string[]> {
  const dir = join(projectRoot, ".pneuma", "sessions");
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir);
  const out: string[] = [];
  for (const id of entries) {
    const h = join(dir, id, "history.json");
    if (existsSync(h)) out.push(h);
  }
  return out;
}
```

- [ ] **Step 4: Wire `buildEvolutionPrompt` to use it**

Look at `buildEvolutionPrompt` (lines ~47-61). When `manifest.name === "evolve"` AND env has `PNEUMA_PROJECT_ROOT`, prepend project history sources to the data sources list, and shift output target to `<projectRoot>/.pneuma/preferences/`.

Concrete change: in `buildEvolutionMetadata` (lines ~68-87), when invoking agent for project evolve, add to its data sources:

```typescript
if (env.PNEUMA_PROJECT_ROOT) {
  const projectHistorySources = await collectProjectHistorySources(env.PNEUMA_PROJECT_ROOT);
  metadata.projectHistoryPaths = projectHistorySources;
  metadata.outputPreferencesDir = join(env.PNEUMA_PROJECT_ROOT, ".pneuma", "preferences");
}
```

- [ ] **Step 5: Wire ProjectPage button**

In `src/components/ProjectPage.tsx` add:

```tsx
const evolveProject = async () => {
  const res = await fetch("/api/launch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode: "evolve",
      project: projectRoot,
    }),
  });
  const data = await res.json();
  if (data.url) window.location.href = data.url;
};
// ...
<button className="px-3 py-1 text-sm bg-cc-surface border border-cc-border rounded ml-2" onClick={evolveProject}>
  Evolve Project Preferences
</button>
```

- [ ] **Step 6: Run tests + commit**

```bash
bun test server/__tests__/evolution-project.test.ts
bun test
```

```bash
git add server/evolution-agent.ts server/__tests__/evolution-project.test.ts src/components/ProjectPage.tsx
git commit -m "feat(evolve): project-scope evolve entry, scans all session histories"
```

---

## Phase 9 — Documentation Pass

### Task 18: Update root CLAUDE.md / README.md / reference docs

**Files:**
- Modify: `CLAUDE.md` (root)
- Modify: `README.md` (root)
- Modify: `docs/reference/viewer-agent-protocol.md`
- Modify: `package.json` (version) + `CHANGELOG.md`

- [ ] **Step 1: Update CLAUDE.md**

In the "Per-Workspace Persistence" section, replace with a "Per-Session Persistence" section covering both quick and project layouts. Add a new "Project Layer (3.0)" section listing `<project>/.pneuma/{project.json, preferences/, handoffs/, sessions/{id}/}` and the new env vars.

In "Skill Installation & Update Detection", list the two new markers (`pneuma:project`, `pneuma:handoff`).

In "Session Registry", update schema to `{ projects, sessions }`.

In "User Preferences", add a sentence about project-scoped preferences at `<projectRoot>/.pneuma/preferences/`.

In "CLI Flags" table, add `--project` and `--session-id`.

In "Known Gotchas", add:
- "Project session paths" — sessionDir = `<project>/.pneuma/sessions/{id}/`, state files flat (no nested `.pneuma/`)
- "Handoff file lifecycle" — created by source agent, deleted by target agent after consume; UI captures via chokidar

- [ ] **Step 2: Update README.md**

Add a brief "Projects (3.0)" section after the Modes section:

```markdown
## Projects (3.0)

Pneuma supports an optional Project layer above sessions. A project is any user directory marked by `<root>/.pneuma/project.json`. Inside a project you can:

- Run multiple sessions in different modes (doc, webcraft, clipcraft, ...) all targeting the same project root
- Switch modes mid-conversation — the source agent writes a handoff file, the target session consumes it
- Maintain project-scoped preferences orthogonal to your global preferences

Quick (project-less) sessions remain fully supported — projects are opt-in. Create a project from the launcher's "Create Project" button.
```

- [ ] **Step 3: Update docs/reference/viewer-agent-protocol.md**

Find the section listing environment variables (or add one). Add:

```markdown
### Environment variables

Every Pneuma session injects:

- `PNEUMA_SESSION_DIR` — the agent's CWD; where `.claude/skills/`, `CLAUDE.md`, and state files live
- `PNEUMA_HOME_ROOT` — user-facing root: workspace for quick sessions, project root for project sessions; deliverables go here
- `PNEUMA_SESSION_ID` — session UUID
- `PNEUMA_PROJECT_ROOT` — *project sessions only*; absolute path to the project root

### Handoff protocol (project sessions)

Cross-mode handoff between sessions in the same project is file-based. The source session writes a markdown file with YAML frontmatter to `$PNEUMA_PROJECT_ROOT/.pneuma/handoffs/<id>.md`. The Pneuma server watches this directory and surfaces a Handoff Card UI for user confirmation. On confirm, the target session is launched (or resumed) and its CLAUDE.md `pneuma:handoff` marker block points it to the file. The target consumes the file and `rm`s it.

Frontmatter schema: `handoff_id`, `target_mode`, `target_session?` ("auto" | sessionId), `source_session`, `source_mode`, `source_display_name?`, `intent?`, `suggested_files?` (list), `created_at`. See `docs/design/2026-04-27-pneuma-projects-design.md` for full body conventions.
```

- [ ] **Step 4: Bump version**

```bash
# Update package.json "version" to next minor (e.g., 2.38.0 → 2.39.0)
# Update CLAUDE.md "**Version:**" line to match
# Add CHANGELOG.md section:
```

CHANGELOG entry:

```markdown
## 2.39.0 — 2026-04-27

### Added
- **Project Layer (3.0 organization dimension)**: `<projectRoot>/.pneuma/{project.json, preferences/, handoffs/, sessions/}` — optional, opt-in via Launcher "Create Project". See `docs/design/2026-04-27-pneuma-projects-design.md`.
- Cross-mode handoff: source agent writes a markdown handoff file; UI surfaces a Handoff Card; target session consumes and deletes the file.
- Project-scoped preferences orthogonal to personal: new `pneuma:project` CLAUDE.md marker.
- New shared skill `pneuma-project` installed in project sessions.
- New CLI flags: `--project <path>`, `--session-id <id>`.
- New env vars: `PNEUMA_SESSION_DIR`, `PNEUMA_HOME_ROOT`, `PNEUMA_PROJECT_ROOT`, `PNEUMA_SESSION_ID`.
- Launcher: Recent Projects section, Create Project dialog, project page.
- Mode switcher dropdown in project session header.
- Project-scope `pneuma evolve` (scans all session histories under the project).

### Changed
- `~/.pneuma/sessions.json` schema upgraded to `{ projects: [...], sessions: [...] }`. Legacy array shape auto-upgraded on read.
- `installSkill` accepts `sessionDir` to target session-scoped install paths.

### Compatibility
- Quick sessions (workspace without `project.json`) keep 2.x behavior unchanged.
- Old `sessions.json` arrays are read transparently; first write upgrades the file.
```

- [ ] **Step 5: Final test + commit**

```bash
bun test
```

Expected: all passing (target ~770+ tests, original 739 + new tests added across phases).

```bash
git add CLAUDE.md README.md docs/reference/viewer-agent-protocol.md package.json CHANGELOG.md
git commit -m "docs: 3.0 project layer in CLAUDE.md, README, reference, version bump 2.39.0"
```

---

## Self-Review Notes

After completing all tasks, run a final pass:

- [ ] All quick-session smoke tests still pass: open an old workspace with `bun bin/pneuma.ts doc --workspace <old-ws>`, confirm no error and existing behavior intact.
- [ ] Project session smoke test full lifecycle: create project, doc session, switch to webcraft via dropdown, agent writes handoff, UI shows card, confirm → webcraft session starts and consumes handoff file.
- [ ] Multi-window smoke: open two browser tabs at the same project, each on a different session — both work concurrently, shadow-git per session, no file lock contention.
- [ ] sessions.json reads cleanly in both legacy-array and new-object shapes after running for a while.
- [ ] `~/.pneuma/preferences/` (personal) and `<project>/.pneuma/preferences/` (project) coexist in the same CLAUDE.md when both are populated.

---

## Spec Coverage Map

| Spec § | Implemented in tasks |
|--------|---------------------|
| §2.1 Quick session structure | Preserved (Tasks 4, 8) |
| §2.2 Project structure | Tasks 1, 2, 3, 8 |
| §2.3 Path aliases | Task 2 |
| §3 Environment variables | Task 8 |
| §4.1-4.2 CLAUDE.md markers | Tasks 5, 6 |
| §4.3 Personal + project prefs orthogonal | Task 5 (project section embeds project prefs critical) |
| §5 Mode switching protocol | Tasks 6, 10, 11, 15, 16 |
| §6 pneuma-project shared skill | Task 7 |
| §7 Project creation in Launcher | Tasks 12, 13 |
| §8 Sessions registry schema | Task 9 |
| §9 Launcher UX | Tasks 13, 14, 15 |
| §10 Mode switch UI | Task 15 |
| §11 Project Evolution | Task 17 |
| §12 Implementation paths | All tasks; Task 18 doc updates |
| §13 Compatibility | Tasks 4 (legacy install path), 9 (legacy registry read) |
| §14 Risks | Mitigated via TDD coverage |
| §16 Testing strategy | Tests in Tasks 1-12, 17 |

**Note on §7 "Initialize from existing session" (founder copy)**: This is intentionally deferred to a follow-up plan (`docs/superpowers/plans/<later>-pneuma-projects-init-from-session.md`). The minimum viable Create Project dialog (Task 13) creates an empty project; users can launch their first session via the project page (Task 14). Init-from-session is a one-time copy that benefits from being implemented after the core lifecycle is verified working.

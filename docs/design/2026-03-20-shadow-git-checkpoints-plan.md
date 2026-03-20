# Shadow Git Checkpoints Implementation Plan (Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically record workspace file changes at the end of each agent turn using a shadow git repo, so future export/replay features have accurate checkpoint data.

**Architecture:** A `shadow-git.ts` module manages a bare git repo at `.pneuma/shadow.git` (separate from user's `.git` via `--git-dir`/`--work-tree`). It initializes on session start and captures checkpoints on each `result` message. A serial Promise queue prevents git concurrency issues.

**Tech Stack:** Git CLI (via `Bun.spawn`), `node:fs` (`appendFileSync`), `bun:test`

**Spec:** `docs/adr/adr-013-history-sharing-replay.md`, `docs/design/history-sharing-replay.md`

---

### Task 1: Create `server/shadow-git.ts` — core module

**Files:**
- Create: `server/shadow-git.ts`
- Test: `server/__tests__/shadow-git.test.ts`

- [ ] **Step 1: Write the failing tests for `initShadowGit`**

```typescript
// server/__tests__/shadow-git.test.ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initShadowGit, isShadowGitAvailable } from "../shadow-git.js";

describe("shadow-git", () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "shadow-git-test-"));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  describe("initShadowGit", () => {
    test("creates bare repo at .pneuma/shadow.git", async () => {
      await initShadowGit(workspace);
      expect(existsSync(join(workspace, ".pneuma", "shadow.git", "HEAD"))).toBe(true);
      expect(isShadowGitAvailable(workspace)).toBe(true);
    });

    test("is idempotent — second call is a no-op", async () => {
      await initShadowGit(workspace);
      await initShadowGit(workspace); // should not throw
      expect(isShadowGitAvailable(workspace)).toBe(true);
    });

    test("creates initial commit", async () => {
      // Write a file before init so the initial commit captures it
      await Bun.write(join(workspace, "index.html"), "<h1>hello</h1>");
      await initShadowGit(workspace);

      const proc = Bun.spawn(
        ["git", `--git-dir=${join(workspace, ".pneuma", "shadow.git")}`, "log", "--oneline"],
        { stdout: "pipe" }
      );
      const log = await new Response(proc.stdout).text();
      expect(log).toContain("initial");
    });

    test("excludes .pneuma and node_modules", async () => {
      const excludePath = join(workspace, ".pneuma", "shadow.git", "info", "exclude");
      await initShadowGit(workspace);
      const content = await Bun.file(excludePath).text();
      expect(content).toContain(".pneuma");
      expect(content).toContain("node_modules");
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test server/__tests__/shadow-git.test.ts`
Expected: FAIL — module `../shadow-git` not found

- [ ] **Step 3: Implement `initShadowGit` and `isShadowGitAvailable`**

```typescript
// server/shadow-git.ts
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const SHADOW_DIR_NAME = "shadow.git";
const EXCLUDE_RULES = `.pneuma
node_modules
.DS_Store
dist
.env
.env.*
*.log
`;

// Track which workspaces have shadow git enabled
const availableWorkspaces = new Set<string>();

function gitDir(workspace: string): string {
  return join(workspace, ".pneuma", SHADOW_DIR_NAME);
}

function shadowGit(workspace: string, args: string[], options?: { stdout?: "pipe" | "ignore" }): Bun.Subprocess {
  return Bun.spawn(
    ["git", `--git-dir=${gitDir(workspace)}`, `--work-tree=${workspace}`, ...args],
    { cwd: workspace, stdout: options?.stdout ?? "ignore", stderr: "ignore" },
  );
}

export async function initShadowGit(workspace: string): Promise<void> {
  const dir = gitDir(workspace);

  // Idempotent — skip if already initialized
  if (existsSync(join(dir, "HEAD"))) {
    availableWorkspaces.add(workspace);
    return;
  }

  try {
    mkdirSync(join(workspace, ".pneuma"), { recursive: true });
    await Bun.spawn(["git", "init", "--bare", dir], { stdout: "ignore", stderr: "ignore" }).exited;

    // Set git identity for commits (avoids failure on systems without global git config)
    await Bun.spawn(["git", `--git-dir=${dir}`, "config", "user.email", "pneuma@local"], { stdout: "ignore" }).exited;
    await Bun.spawn(["git", `--git-dir=${dir}`, "config", "user.name", "Pneuma Shadow"], { stdout: "ignore" }).exited;

    // Write exclude rules
    await Bun.write(join(dir, "info", "exclude"), EXCLUDE_RULES);

    // Initial commit capturing current workspace state
    await shadowGit(workspace, ["add", "-A"]).exited;
    await shadowGit(workspace, ["commit", "-m", "initial", "--allow-empty"]).exited;

    availableWorkspaces.add(workspace);
  } catch (err) {
    console.warn("[shadow-git] init failed, checkpoints disabled:", err);
  }
}

export function isShadowGitAvailable(workspace: string): boolean {
  return availableWorkspaces.has(workspace);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test server/__tests__/shadow-git.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/shadow-git.ts server/__tests__/shadow-git.test.ts
git commit -m "feat(shadow-git): add initShadowGit with bare repo creation and exclude rules"
```

---

### Task 2: Implement `enqueueCheckpoint` with serial queue

**Files:**
- Modify: `server/shadow-git.ts`
- Test: `server/__tests__/shadow-git.test.ts`

- [ ] **Step 1: Write the failing tests for checkpoint capture**

Append to `server/__tests__/shadow-git.test.ts`:

```typescript
import { initShadowGit, isShadowGitAvailable, enqueueCheckpoint, listCheckpoints } from "../shadow-git.js";

// ... existing tests ...

describe("enqueueCheckpoint", () => {
  test("captures file changes as a checkpoint", async () => {
    await initShadowGit(workspace);

    // Make a change after initial commit
    await Bun.write(join(workspace, "style.css"), "body { color: red; }");

    // Enqueue and wait for it to complete
    const done = enqueueCheckpoint(workspace, 1);
    await done;

    const checkpoints = await listCheckpoints(workspace);
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0].turn).toBe(1);
    expect(checkpoints[0].hash).toMatch(/^[0-9a-f]{7,}/);
  });

  test("skips checkpoint when no files changed", async () => {
    await initShadowGit(workspace);

    const done = enqueueCheckpoint(workspace, 1);
    await done;

    const checkpoints = await listCheckpoints(workspace);
    expect(checkpoints).toHaveLength(0);
  });

  test("captures multiple checkpoints sequentially", async () => {
    await initShadowGit(workspace);

    await Bun.write(join(workspace, "a.txt"), "first");
    await enqueueCheckpoint(workspace, 1);

    await Bun.write(join(workspace, "b.txt"), "second");
    await enqueueCheckpoint(workspace, 2);

    const checkpoints = await listCheckpoints(workspace);
    expect(checkpoints).toHaveLength(2);
    expect(checkpoints[0].turn).toBe(1);
    expect(checkpoints[1].turn).toBe(2);
  });

  test("is a no-op when shadow git is not available", async () => {
    // Don't init — shadow git not available
    const done = enqueueCheckpoint(workspace, 1);
    await done; // should not throw
  });
});
```

- [ ] **Step 2: Run tests to verify new tests fail**

Run: `bun test server/__tests__/shadow-git.test.ts`
Expected: FAIL — `enqueueCheckpoint` and `listCheckpoints` not found

- [ ] **Step 3: Implement `enqueueCheckpoint` and `listCheckpoints`**

Add to `server/shadow-git.ts`:

```typescript
// --- Checkpoint serial queue ---

const queues = new Map<string, Promise<void>>();

export function enqueueCheckpoint(workspace: string, turnIndex: number): Promise<void> {
  if (!availableWorkspaces.has(workspace)) return Promise.resolve();

  const prev = queues.get(workspace) ?? Promise.resolve();
  const next = prev
    .then(() => captureCheckpointInner(workspace, turnIndex))
    .catch((err) => console.warn("[shadow-git] checkpoint failed:", err));
  queues.set(workspace, next);
  return next;
}

async function captureCheckpointInner(workspace: string, turnIndex: number): Promise<void> {
  // Check for changes
  const diffProc = shadowGit(workspace, ["diff", "HEAD", "--quiet"]);
  const diffExit = await diffProc.exited;

  // Also check for untracked files
  const untrackedProc = shadowGit(workspace, ["ls-files", "--others", "--exclude-standard"], { stdout: "pipe" });
  const untracked = (await new Response(untrackedProc.stdout).text()).trim();

  // exit code 0 = no diff, and no untracked files → nothing to commit
  if (diffExit === 0 && !untracked) return;

  await shadowGit(workspace, ["add", "-A"]).exited;
  await shadowGit(workspace, ["commit", "-m", `turn-${turnIndex}`]).exited;

  const hashProc = shadowGit(workspace, ["rev-parse", "--short", "HEAD"], { stdout: "pipe" });
  const hash = (await new Response(hashProc.stdout).text()).trim();

  const entry = JSON.stringify({ turn: turnIndex, ts: Date.now(), hash }) + "\n";
  appendFileSync(checkpointsIndexPath(workspace), entry);
}

function checkpointsIndexPath(workspace: string): string {
  return join(workspace, ".pneuma", "checkpoints.jsonl");
}

// --- Checkpoint listing ---

export interface CheckpointEntry {
  turn: number;
  ts: number;
  hash: string;
}

export async function listCheckpoints(workspace: string): Promise<CheckpointEntry[]> {
  const indexPath = checkpointsIndexPath(workspace);
  if (!existsSync(indexPath)) return [];

  const content = await Bun.file(indexPath).text();
  return content
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as CheckpointEntry);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test server/__tests__/shadow-git.test.ts`
Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/shadow-git.ts server/__tests__/shadow-git.test.ts
git commit -m "feat(shadow-git): add enqueueCheckpoint with serial queue and listCheckpoints"
```

---

### Task 3: Implement `createBundle` and `exportCheckpointFiles`

**Files:**
- Modify: `server/shadow-git.ts`
- Test: `server/__tests__/shadow-git.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `server/__tests__/shadow-git.test.ts`:

```typescript
import { initShadowGit, enqueueCheckpoint, listCheckpoints, createBundle, exportCheckpointFiles } from "../shadow-git.js";

// ... existing tests ...

describe("createBundle", () => {
  test("creates a git bundle file containing all checkpoints", async () => {
    await initShadowGit(workspace);
    await Bun.write(join(workspace, "a.txt"), "hello");
    await enqueueCheckpoint(workspace, 1);

    const bundlePath = join(workspace, "test.bundle");
    await createBundle(workspace, bundlePath);
    expect(existsSync(bundlePath)).toBe(true);

    // Verify bundle is valid by checking it
    const verify = Bun.spawn(["git", "bundle", "verify", bundlePath], { stdout: "ignore", stderr: "ignore" });
    expect(await verify.exited).toBe(0);
  });
});

describe("exportCheckpointFiles", () => {
  test("exports the file tree at a specific checkpoint", async () => {
    await initShadowGit(workspace);

    await Bun.write(join(workspace, "a.txt"), "version-1");
    await enqueueCheckpoint(workspace, 1);

    await Bun.write(join(workspace, "a.txt"), "version-2");
    await Bun.write(join(workspace, "b.txt"), "new-file");
    await enqueueCheckpoint(workspace, 2);

    const checkpoints = await listCheckpoints(workspace);
    const outDir = mkdtempSync(join(tmpdir(), "export-test-"));

    // Export checkpoint 1 — should have a.txt with "version-1", no b.txt
    await exportCheckpointFiles(workspace, checkpoints[0].hash, outDir);
    expect(await Bun.file(join(outDir, "a.txt")).text()).toBe("version-1");
    expect(existsSync(join(outDir, "b.txt"))).toBe(false);

    rmSync(outDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run tests to verify new tests fail**

Run: `bun test server/__tests__/shadow-git.test.ts`
Expected: FAIL — `createBundle` and `exportCheckpointFiles` not found

- [ ] **Step 3: Implement `createBundle` and `exportCheckpointFiles`**

Add to `server/shadow-git.ts`:

```typescript
export async function createBundle(workspace: string, outPath: string): Promise<void> {
  const proc = Bun.spawn(
    ["git", `--git-dir=${gitDir(workspace)}`, "bundle", "create", outPath, "--all"],
    { stdout: "ignore", stderr: "ignore" },
  );
  const exitCode = await proc.exited;
  if (exitCode !== 0) throw new Error(`git bundle create failed with exit code ${exitCode}`);
}

export async function exportCheckpointFiles(workspace: string, hash: string, outDir: string): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  // Use git archive to export a clean file tree (no .git)
  const archive = Bun.spawn(
    ["git", `--git-dir=${gitDir(workspace)}`, "archive", hash],
    { stdout: "pipe", stderr: "ignore" },
  );
  // Pipe to tar extract
  const extract = Bun.spawn(
    ["tar", "x", "-C", outDir],
    { stdin: archive.stdout, stdout: "ignore", stderr: "ignore" },
  );
  await extract.exited;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test server/__tests__/shadow-git.test.ts`
Expected: All 10 tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/shadow-git.ts server/__tests__/shadow-git.test.ts
git commit -m "feat(shadow-git): add createBundle and exportCheckpointFiles for export support"
```

---

### Task 4: Integrate shadow git init into session startup

**Files:**
- Modify: `bin/pneuma.ts` (around line 899, after skill install)

- [ ] **Step 1: Add import and init call**

At the top of `bin/pneuma.ts`, add import:

```typescript
import { initShadowGit } from "../server/shadow-git.js";
```

The skill install block is guarded by `if (!skipSkillInstall) { ... }` (around lines 888-900). The shadow git init must be **OUTSIDE** this guard so it runs even with `--skip-skill`. Insert it **after the closing `}` of the skill install block** (line ~900) and **before the content seed check** (`if (manifest.init && manifest.init.contentCheckPattern)` at line ~902):

```typescript
  } // ← end of if (!skipSkillInstall) block

  // Initialize shadow git for checkpoint tracking
  await initShadowGit(workspace);

  // 1.5 Seed default content if workspace has no meaningful files
  if (manifest.init && manifest.init.contentCheckPattern) {
```

- [ ] **Step 2: Verify placement by reading the surrounding code**

Read `bin/pneuma.ts` lines 885-910 and confirm the `initShadowGit` call is:
1. AFTER the skill install `if` block's closing brace
2. BEFORE the content seed check
3. At the same indentation level as other top-level startup steps

- [ ] **Step 3: Manual test**

```bash
# Create a temp workspace and run pneuma
mkdir /tmp/test-shadow && cd /tmp/test-shadow
bun run dev webcraft --workspace /tmp/test-shadow --no-open --debug
# After startup, check:
ls -la /tmp/test-shadow/.pneuma/shadow.git/HEAD
# Should exist
# Ctrl+C to stop
rm -rf /tmp/test-shadow
```

- [ ] **Step 4: Commit**

```bash
git add bin/pneuma.ts
git commit -m "feat: initialize shadow git on session startup for checkpoint tracking"
```

---

### Task 5: Integrate checkpoint capture into WsBridge (Claude Code path)

**Files:**
- Modify: `server/ws-bridge.ts` (in `handleResultMessage`, around line 645)

- [ ] **Step 1: Add import**

At top of `server/ws-bridge.ts`:

```typescript
import { enqueueCheckpoint, isShadowGitAvailable } from "./shadow-git.js";
```

- [ ] **Step 2: Add checkpoint call at end of `handleResultMessage`**

At the end of the `handleResultMessage` method (after the final `broadcastToBrowsers` for session_update, around line 645), add:

```typescript
    // Capture shadow git checkpoint after turn completes
    if (this.workspace && isShadowGitAvailable(this.workspace)) {
      const turnIndex = session.state.num_turns ?? 0;
      enqueueCheckpoint(this.workspace, turnIndex);
    }
```

Note: `enqueueCheckpoint` returns a Promise but we intentionally don't await it — it runs in the background and errors are caught internally.

- [ ] **Step 3: Commit**

```bash
git add server/ws-bridge.ts
git commit -m "feat: capture shadow git checkpoint on turn result (Claude Code path)"
```

---

### Task 6: Integrate checkpoint capture into Codex bridge

**Files:**
- Modify: `server/ws-bridge-codex.ts` (interface + result handler, around lines 17-20 and 76-79)

- [ ] **Step 1: Extend `CodexBridgeDeps` with workspace**

In `server/ws-bridge-codex.ts`, modify the interface:

```typescript
export interface CodexBridgeDeps {
  broadcastToBrowsers: (session: Session, msg: BrowserIncomingMessage) => void;
  persistSession?: (session: Session) => void;
  workspace?: string;  // For shadow git checkpoint capture
}
```

- [ ] **Step 2: Add checkpoint call in result handler**

At the top of the file, add import:

```typescript
import { enqueueCheckpoint, isShadowGitAvailable } from "./shadow-git.js";
```

In the `attachCodexAdapterHandlers` function, modify the `result` branch (around line 76-79). After `deps.persistSession?.(session);`, add:

```typescript
      // Capture shadow git checkpoint
      if (deps.workspace && isShadowGitAvailable(deps.workspace)) {
        enqueueCheckpoint(deps.workspace);
      }
```

Note: For Codex, `enqueueCheckpoint` uses an internal auto-increment counter (see below) since Codex doesn't provide `num_turns`. We add a `nextTurnIndex()` helper to `shadow-git.ts`:

```typescript
// In shadow-git.ts — add per-workspace turn counter for backends without num_turns
const turnCounters = new Map<string, number>();

export function nextTurnIndex(workspace: string): number {
  const current = turnCounters.get(workspace) ?? 0;
  const next = current + 1;
  turnCounters.set(workspace, next);
  return next;
}
```

Then the Codex call becomes:
```typescript
import { enqueueCheckpoint, isShadowGitAvailable, nextTurnIndex } from "./shadow-git.js";
// ...
enqueueCheckpoint(deps.workspace, nextTurnIndex(deps.workspace));
```

- [ ] **Step 3: Pass workspace through deps at the call site**

The caller is in `server/ws-bridge.ts`, method `attachCodexAdapter` (around line 78-80). Add `workspace`:

```typescript
attachCodexAdapterHandlers(sessionId, session, adapter, {
  broadcastToBrowsers: (s, msg) => this.broadcastToBrowsers(s, msg),
  workspace: this.workspace,  // Add this line
});
```

- [ ] **Step 4: Commit**

```bash
git add server/ws-bridge-codex.ts
# Also add the caller file if modified
git commit -m "feat: capture shadow git checkpoint on turn result (Codex path)"
```

---

### Task 7: Add checkpoint listing API route

**Files:**
- Modify: `server/index.ts` (add route in the session API section)

- [ ] **Step 1: Add import**

```typescript
import { listCheckpoints } from "./shadow-git.js";
```

- [ ] **Step 2: Add API route**

In the non-launcher mode routes section of `server/index.ts` (near other `/api/` routes like `/api/session`, `/api/config`), add:

```typescript
  app.get("/api/history/checkpoints", async (c) => {
    const checkpoints = await listCheckpoints(workspace);
    return c.json({ checkpoints });
  });
```

- [ ] **Step 3: Manual test**

```bash
# With a running pneuma session that has had at least one turn:
curl http://localhost:17007/api/history/checkpoints
# Should return: {"checkpoints":[{"turn":1,"ts":...,"hash":"..."},...]}}
```

- [ ] **Step 4: Commit**

```bash
git add server/index.ts
git commit -m "feat: add /api/history/checkpoints endpoint"
```

---

### Task 8: Run full test suite and verify no regressions

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

Run: `bun test`
Expected: All tests pass, including existing `ws-bridge*.test.ts` tests

- [ ] **Step 2: Run shadow-git tests specifically**

Run: `bun test server/__tests__/shadow-git.test.ts --verbose`
Expected: All 10 tests pass

- [ ] **Step 3: Integration smoke test**

```bash
# Test with a real webcraft session
mkdir /tmp/smoke-test && cd /tmp/smoke-test
bun run dev webcraft --workspace /tmp/smoke-test --no-open --debug
# Send a message via the UI or wait for agent to make changes
# Then check:
cat /tmp/smoke-test/.pneuma/checkpoints.jsonl
# Should have checkpoint entries after agent turns
# Ctrl+C
rm -rf /tmp/smoke-test
```

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address test/integration issues from shadow-git integration"
```

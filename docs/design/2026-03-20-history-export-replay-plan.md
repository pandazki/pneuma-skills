# History Export & Replay Implementation Plan (Phase 2-4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable users to export session history as a shareable package, replay it in a player UI, and continue conversations from shared history.

**Architecture:** Export reads history.json + shadow git checkpoints, packages them with a git bundle and summary into a tar.gz. Replay mode launches the server without an agent, feeds messages to the existing rendering pipeline. Continue-conversation restores workspace files and injects a compact summary into CLAUDE.md.

**Tech Stack:** Bun, Hono, React 19, Zustand 5, git CLI, tar

**Spec:** `docs/adr/adr-013-history-sharing-replay.md`, `docs/design/history-sharing-replay.md`

---

## File Structure

### New files
| File | Responsibility |
|------|----------------|
| `core/types/shared-history.ts` | SharedHistoryPackage, CheckpointEntry, SessionSummary types |
| `server/history-export.ts` | Export logic: read history + checkpoints, sanitize, create bundle, generate summary, package tar.gz |
| `server/history-summary.ts` | Summary generation from message history (mechanical extraction) |
| `server/history-import.ts` | Import logic: unpack tar.gz, clone bundle, extract checkpoint files, load messages |
| `src/store/replay-slice.ts` | Replay state management (playback position, speed, controls) |
| `src/components/ReplayPlayer.tsx` | Playback controls UI (play/pause, speed, turn navigation) |
| `src/components/ReplayTimeline.tsx` | Checkpoint timeline bar |

### Modified files
| File | Change |
|------|--------|
| `server/index.ts` | Add `/api/history/export`, replay-mode routes |
| `bin/pneuma.ts` | Add `history export`, `history open` CLI subcommands |
| `src/store/index.ts` | Add replay slice to combined store |
| `src/App.tsx` | Conditional replay mode UI |
| `server/skill-installer.ts` | Add `<!-- pneuma:resumed -->` section injection |

---

### Task 1: SharedHistory type definitions

**Files:**
- Create: `core/types/shared-history.ts`

- [ ] **Step 1: Create type definitions**

```typescript
// core/types/shared-history.ts
export interface SharedHistoryPackage {
  version: 1;
  metadata: {
    id: string;
    title: string;
    description?: string;
    mode: string;
    backendType: string;
    model?: string;
    totalTurns: number;
    totalCost?: number;
    createdAt: number;
    exportedAt: number;
    duration: number;
  };
  summary: SessionSummary;
  checkpoints: ExportedCheckpoint[];
}

export interface ExportedCheckpoint {
  turn: number;
  timestamp: number;
  hash: string;
  label: string;
  filesChanged: number;
  filesAdded: number;
  filesDeleted: number;
  messageSeqRange: [number, number];
}

export interface SessionSummary {
  overview: string;
  keyDecisions: string[];
  workspaceFiles: { path: string; lines: number }[];
  recentConversation: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add core/types/shared-history.ts
git commit -m "feat: add SharedHistory type definitions"
```

---

### Task 2: Summary generation module

**Files:**
- Create: `server/history-summary.ts`
- Test: `server/__tests__/history-summary.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// server/__tests__/history-summary.test.ts
import { describe, expect, test } from "bun:test";
import { generateSummary } from "../history-summary.js";
import type { BrowserIncomingMessage } from "../session-types.js";

describe("generateSummary", () => {
  test("extracts overview from user messages", () => {
    const messages: BrowserIncomingMessage[] = [
      { type: "user_message", content: "Create a landing page", timestamp: 1000, id: "1" },
      { type: "user_message", content: "Add a dark theme", timestamp: 2000, id: "2" },
      { type: "user_message", content: "Fix the mobile layout", timestamp: 3000, id: "3" },
    ] as any;
    const summary = generateSummary(messages, []);
    expect(summary.overview).toContain("Create a landing page");
    expect(summary.overview).toContain("3");
  });

  test("extracts recent conversation (last 3 turns)", () => {
    const messages: BrowserIncomingMessage[] = [];
    for (let i = 0; i < 5; i++) {
      messages.push({ type: "user_message", content: `User message ${i}`, timestamp: i * 1000, id: `u${i}` } as any);
      messages.push({
        type: "assistant",
        message: { id: `a${i}`, content: [{ type: "text", text: `Response ${i}` }], model: "test", stop_reason: "end_turn", role: "assistant" },
        parent_tool_use_id: null,
        timestamp: i * 1000 + 500,
      } as any);
    }
    const summary = generateSummary(messages, []);
    expect(summary.recentConversation).toContain("User message 4");
    expect(summary.recentConversation).toContain("Response 4");
    expect(summary.recentConversation).not.toContain("User message 0");
  });

  test("generates workspace file list", () => {
    const files = [
      { path: "index.html", lines: 100 },
      { path: "style.css", lines: 50 },
    ];
    const summary = generateSummary([], files);
    expect(summary.workspaceFiles).toEqual(files);
  });
});
```

- [ ] **Step 2: Implement summary generation**

```typescript
// server/history-summary.ts
import type { BrowserIncomingMessage } from "./session-types.js";
import type { SessionSummary } from "../core/types/shared-history.js";

export function generateSummary(
  messages: BrowserIncomingMessage[],
  workspaceFiles: { path: string; lines: number }[],
): SessionSummary {
  const userMessages = messages.filter((m) => m.type === "user_message") as Array<{ type: "user_message"; content: string; timestamp: number }>;
  const assistantMessages = messages.filter((m) => m.type === "assistant") as Array<{ type: "assistant"; message: { content: Array<{ type: string; text?: string }> } }>;

  // Overview: first 3 user messages + total turn count
  const firstThree = userMessages.slice(0, 3).map((m) => m.content).join("; ");
  const overview = userMessages.length <= 3
    ? firstThree
    : `${firstThree} ... (${userMessages.length} turns total)`;

  // Key decisions: extract lines from assistant messages containing decision-like words
  const keyDecisions: string[] = [];
  for (const msg of assistantMessages) {
    for (const block of msg.message.content) {
      if (block.type === "text" && block.text) {
        const lines = block.text.split("\n");
        for (const line of lines) {
          if (/(?:decided|chose|using|selected|went with|picked|opted)/i.test(line) && line.length < 200) {
            keyDecisions.push(line.trim());
            if (keyDecisions.length >= 10) break;
          }
        }
      }
      if (keyDecisions.length >= 10) break;
    }
  }

  // Recent conversation: last 3 turns (user + assistant pairs)
  const recentTurns: string[] = [];
  const lastUserMsgs = userMessages.slice(-3);
  for (const userMsg of lastUserMsgs) {
    recentTurns.push(`[user] ${userMsg.content}`);
    // Find the next assistant message after this user message
    const userIdx = messages.indexOf(userMsg as any);
    for (let i = userIdx + 1; i < messages.length; i++) {
      const m = messages[i];
      if (m.type === "assistant") {
        const textBlocks = (m as any).message?.content?.filter((b: any) => b.type === "text") ?? [];
        const text = textBlocks.map((b: any) => b.text).join("\n").slice(0, 500);
        if (text) recentTurns.push(`[assistant] ${text}`);
        break;
      }
      if (m.type === "user_message") break;
    }
  }

  return {
    overview,
    keyDecisions: keyDecisions.slice(0, 5),
    workspaceFiles,
    recentConversation: recentTurns.join("\n"),
  };
}
```

- [ ] **Step 3: Run tests, verify pass**

Run: `bun test server/__tests__/history-summary.test.ts`

- [ ] **Step 4: Commit**

```bash
git add server/history-summary.ts server/__tests__/history-summary.test.ts core/types/shared-history.ts
git commit -m "feat: add history summary generation from message history"
```

---

### Task 3: History export module

**Files:**
- Create: `server/history-export.ts`
- Test: `server/__tests__/history-export.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// server/__tests__/history-export.test.ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initShadowGit, enqueueCheckpoint } from "../shadow-git.js";
import { exportHistory } from "../history-export.js";

describe("exportHistory", () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "history-export-test-"));
    mkdirSync(join(workspace, ".pneuma"), { recursive: true });
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  test("creates a tar.gz package with manifest and messages", async () => {
    // Setup: create workspace with history and shadow git
    await initShadowGit(workspace);
    await Bun.write(join(workspace, "index.html"), "<h1>Hello</h1>");
    await enqueueCheckpoint(workspace, 1);

    const history = [
      { type: "user_message", content: "Create a page", timestamp: 1000, id: "u1" },
      { type: "assistant", message: { id: "a1", content: [{ type: "text", text: "Done" }], model: "test", stop_reason: "end_turn", role: "assistant" }, parent_tool_use_id: null, timestamp: 1500 },
      { type: "result", data: { num_turns: 1, total_cost_usd: 0.01, duration_ms: 500 } },
    ];
    writeFileSync(join(workspace, ".pneuma", "history.json"), JSON.stringify(history));
    writeFileSync(join(workspace, ".pneuma", "session.json"), JSON.stringify({
      sessionId: "test-session",
      mode: "webcraft",
      backendType: "claude-code",
      createdAt: 900,
    }));

    const outPath = join(workspace, "export.tar.gz");
    const result = await exportHistory(workspace, { output: outPath, title: "Test Export" });

    expect(existsSync(outPath)).toBe(true);
    expect(result.checkpointCount).toBe(1);
    expect(result.messageCount).toBe(3);

    // Verify package contents
    const extractDir = mkdtempSync(join(tmpdir(), "extract-test-"));
    await Bun.spawn(["tar", "xzf", outPath, "-C", extractDir]).exited;

    expect(existsSync(join(extractDir, "manifest.json"))).toBe(true);
    expect(existsSync(join(extractDir, "messages.jsonl"))).toBe(true);
    expect(existsSync(join(extractDir, "repo.bundle"))).toBe(true);

    const manifest = JSON.parse(readFileSync(join(extractDir, "manifest.json"), "utf-8"));
    expect(manifest.version).toBe(1);
    expect(manifest.metadata.title).toBe("Test Export");
    expect(manifest.metadata.mode).toBe("webcraft");
    expect(manifest.checkpoints).toHaveLength(1);

    rmSync(extractDir, { recursive: true, force: true });
  });

  test("works without checkpoints (no shadow git)", async () => {
    const history = [
      { type: "user_message", content: "Hello", timestamp: 1000, id: "u1" },
    ];
    writeFileSync(join(workspace, ".pneuma", "history.json"), JSON.stringify(history));
    writeFileSync(join(workspace, ".pneuma", "session.json"), JSON.stringify({
      sessionId: "test", mode: "webcraft", backendType: "claude-code", createdAt: 900,
    }));

    const outPath = join(workspace, "export.tar.gz");
    const result = await exportHistory(workspace, { output: outPath });

    expect(existsSync(outPath)).toBe(true);
    expect(result.checkpointCount).toBe(0);
    expect(result.messageCount).toBe(1);
  });
});
```

- [ ] **Step 2: Implement history export**

```typescript
// server/history-export.ts
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, basename, relative } from "node:path";
import { tmpdir } from "node:os";
import { listCheckpoints, createBundle, isShadowGitAvailable } from "./shadow-git.js";
import { generateSummary } from "./history-summary.js";
import type { SharedHistoryPackage, ExportedCheckpoint } from "../core/types/shared-history.js";
import type { BrowserIncomingMessage } from "./session-types.js";

interface ExportOptions {
  output?: string;
  title?: string;
  description?: string;
}

interface ExportResult {
  outputPath: string;
  messageCount: number;
  checkpointCount: number;
}

export async function exportHistory(workspace: string, options: ExportOptions = {}): Promise<ExportResult> {
  // 1. Read session metadata
  const sessionPath = join(workspace, ".pneuma", "session.json");
  const session = JSON.parse(readFileSync(sessionPath, "utf-8"));

  // 2. Read history
  const historyPath = join(workspace, ".pneuma", "history.json");
  const messages: BrowserIncomingMessage[] = existsSync(historyPath)
    ? JSON.parse(readFileSync(historyPath, "utf-8"))
    : [];

  // 3. Read checkpoints
  const checkpoints = await listCheckpoints(workspace);

  // 4. Build checkpoint index with message seq ranges
  const exportedCheckpoints: ExportedCheckpoint[] = buildCheckpointIndex(messages, checkpoints);

  // 5. Scan workspace files for summary
  const workspaceFiles = scanWorkspaceFiles(workspace);

  // 6. Generate summary
  const summary = generateSummary(messages, workspaceFiles);

  // 7. Build manifest
  const id = `${session.mode}-${basename(workspace)}-${Date.now()}`;
  const timestamps = messages
    .filter((m: any) => m.timestamp)
    .map((m: any) => m.timestamp);

  const manifest: SharedHistoryPackage = {
    version: 1,
    metadata: {
      id,
      title: options.title ?? `${session.mode} session`,
      description: options.description,
      mode: session.mode,
      backendType: session.backendType,
      totalTurns: messages.filter((m) => m.type === "result").length,
      createdAt: session.createdAt,
      exportedAt: Date.now(),
      duration: timestamps.length >= 2 ? timestamps[timestamps.length - 1] - timestamps[0] : 0,
    },
    summary,
    checkpoints: exportedCheckpoints,
  };

  // 8. Create staging directory
  const stageDir = mkdtempSync(join(tmpdir(), "pneuma-export-"));
  mkdirSync(stageDir, { recursive: true });

  // Write manifest
  writeFileSync(join(stageDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  // Write messages as JSONL (sanitize workspace paths)
  const workspacePrefix = workspace.endsWith("/") ? workspace : workspace + "/";
  const messagesJsonl = messages
    .map((m) => JSON.stringify(m).replaceAll(workspacePrefix, ""))
    .join("\n");
  writeFileSync(join(stageDir, "messages.jsonl"), messagesJsonl);

  // Create git bundle if shadow git available
  if (isShadowGitAvailable(workspace) && checkpoints.length > 0) {
    await createBundle(workspace, join(stageDir, "repo.bundle"));
  }

  // 9. tar.gz the staging directory
  const outputPath = options.output ?? join(workspace, `${id}.tar.gz`);
  await Bun.spawn(
    ["tar", "czf", outputPath, "-C", stageDir, "."],
    { stdout: "ignore", stderr: "ignore" },
  ).exited;

  // Cleanup staging
  await Bun.spawn(["rm", "-rf", stageDir]).exited;

  return { outputPath, messageCount: messages.length, checkpointCount: checkpoints.length };
}

function buildCheckpointIndex(
  messages: BrowserIncomingMessage[],
  checkpoints: Array<{ turn: number; ts: number; hash: string }>,
): ExportedCheckpoint[] {
  return checkpoints.map((cp) => {
    // Find message range by timestamp proximity
    let startIdx = 0;
    let endIdx = messages.length - 1;

    // Find the result message closest to this checkpoint's timestamp
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i] as any;
      if (m.type === "result" && m.timestamp && Math.abs(m.timestamp - cp.ts) < 5000) {
        endIdx = i;
        // Walk back to find the user_message that started this turn
        for (let j = i - 1; j >= 0; j--) {
          if (messages[j].type === "user_message") {
            startIdx = j;
            break;
          }
        }
        break;
      }
    }

    return {
      turn: cp.turn,
      timestamp: cp.ts,
      hash: cp.hash,
      label: `Turn ${cp.turn}`,
      filesChanged: 0, // Will be enriched later if needed
      filesAdded: 0,
      filesDeleted: 0,
      messageSeqRange: [startIdx, endIdx] as [number, number],
    };
  });
}

function scanWorkspaceFiles(workspace: string): { path: string; lines: number }[] {
  const results: { path: string; lines: number }[] = [];
  const ignore = new Set([".pneuma", "node_modules", ".git", ".claude", ".agents", "dist", ".DS_Store"]);

  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      if (ignore.has(entry)) continue;
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (stat.isFile() && stat.size < 1_000_000) {
        try {
          const content = readFileSync(full, "utf-8");
          const lines = content.split("\n").length;
          results.push({ path: relative(workspace, full), lines });
        } catch {
          // Skip binary files
        }
      }
    }
  }

  try { walk(workspace); } catch { /* empty workspace */ }
  return results;
}
```

- [ ] **Step 3: Run tests, verify pass**

Run: `bun test server/__tests__/history-export.test.ts`

- [ ] **Step 4: Commit**

```bash
git add server/history-export.ts server/__tests__/history-export.test.ts
git commit -m "feat: add history export — packages history + checkpoints into tar.gz"
```

---

### Task 4: Export API route + CLI command

**Files:**
- Modify: `server/index.ts`
- Modify: `bin/pneuma.ts`

- [ ] **Step 1: Add export API route**

In `server/index.ts`, add import:
```typescript
import { exportHistory } from "./history-export.js";
```

Near the existing `/api/history/checkpoints` route, add:
```typescript
  app.post("/api/history/export", async (c) => {
    try {
      const body = await c.req.json<{ title?: string; description?: string }>();
      const result = await exportHistory(workspace, {
        title: body.title,
        description: body.description,
      });
      return c.json(result);
    } catch (err: any) {
      return c.json({ error: err.message ?? "Export failed" }, 500);
    }
  });
```

- [ ] **Step 2: Add CLI subcommand**

In `bin/pneuma.ts`, find the subcommand dispatch section (around line 612, near `if (rawArgs[0] === "snapshot")`). Add before it:

```typescript
  if (rawArgs[0] === "history") {
    if (rawArgs[1] === "export") {
      let workspace = process.cwd();
      let output: string | undefined;
      let title: string | undefined;
      for (let i = 2; i < rawArgs.length; i++) {
        if (rawArgs[i] === "--workspace" && i + 1 < rawArgs.length) workspace = resolve(rawArgs[++i]);
        else if (rawArgs[i] === "--output" && i + 1 < rawArgs.length) output = resolve(rawArgs[++i]);
        else if (rawArgs[i] === "--title" && i + 1 < rawArgs.length) title = rawArgs[++i];
      }
      const { exportHistory } = await import("../server/history-export.js");
      const result = await exportHistory(workspace, { output, title });
      console.log(`Exported ${result.messageCount} messages, ${result.checkpointCount} checkpoints`);
      console.log(`Output: ${result.outputPath}`);
      return;
    }
    if (rawArgs[1] === "open") {
      // Phase 3 — placeholder for now
      console.log("history open: not yet implemented");
      return;
    }
  }
```

- [ ] **Step 3: Commit**

```bash
git add server/index.ts bin/pneuma.ts
git commit -m "feat: add history export API route and CLI command"
```

---

### Task 5: History import module

**Files:**
- Create: `server/history-import.ts`
- Test: `server/__tests__/history-import.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// server/__tests__/history-import.test.ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initShadowGit, enqueueCheckpoint } from "../shadow-git.js";
import { exportHistory } from "../history-export.js";
import { importHistory, loadReplayPackage } from "../history-import.js";

describe("history-import", () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "history-import-test-"));
    mkdirSync(join(workspace, ".pneuma"), { recursive: true });
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  test("round-trip: export then import recovers manifest and messages", async () => {
    // Setup workspace with history
    await initShadowGit(workspace);
    await Bun.write(join(workspace, "index.html"), "<h1>Test</h1>");
    await enqueueCheckpoint(workspace, 1);

    const history = [
      { type: "user_message", content: "Hello", timestamp: 1000, id: "u1" },
      { type: "result", data: { num_turns: 1 } },
    ];
    writeFileSync(join(workspace, ".pneuma", "history.json"), JSON.stringify(history));
    writeFileSync(join(workspace, ".pneuma", "session.json"), JSON.stringify({
      sessionId: "s1", mode: "webcraft", backendType: "claude-code", createdAt: 500,
    }));

    // Export
    const tarPath = join(workspace, "export.tar.gz");
    await exportHistory(workspace, { output: tarPath, title: "Round Trip" });

    // Import
    const importDir = mkdtempSync(join(tmpdir(), "import-test-"));
    const pkg = await importHistory(tarPath, importDir);

    expect(pkg.manifest.version).toBe(1);
    expect(pkg.manifest.metadata.title).toBe("Round Trip");
    expect(pkg.manifest.metadata.mode).toBe("webcraft");
    expect(pkg.messages).toHaveLength(2);
    expect(pkg.messages[0].type).toBe("user_message");
    expect(pkg.hasBundle).toBe(true);

    rmSync(importDir, { recursive: true, force: true });
  });

  test("extractCheckpointFiles restores file tree from bundle", async () => {
    await initShadowGit(workspace);
    await Bun.write(join(workspace, "page.html"), "<p>content</p>");
    await enqueueCheckpoint(workspace, 1);

    const history = [{ type: "user_message", content: "x", timestamp: 1, id: "1" }];
    writeFileSync(join(workspace, ".pneuma", "history.json"), JSON.stringify(history));
    writeFileSync(join(workspace, ".pneuma", "session.json"), JSON.stringify({
      sessionId: "s", mode: "doc", backendType: "claude-code", createdAt: 0,
    }));

    const tarPath = join(workspace, "export.tar.gz");
    await exportHistory(workspace, { output: tarPath });

    const importDir = mkdtempSync(join(tmpdir(), "import-cp-"));
    const pkg = await importHistory(tarPath, importDir);

    // Extract checkpoint files
    const cpDir = mkdtempSync(join(tmpdir(), "cp-files-"));
    await pkg.extractCheckpointFiles(pkg.manifest.checkpoints[0].hash, cpDir);

    expect(await Bun.file(join(cpDir, "page.html")).text()).toBe("<p>content</p>");

    rmSync(importDir, { recursive: true, force: true });
    rmSync(cpDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Implement history import**

```typescript
// server/history-import.ts
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { SharedHistoryPackage } from "../core/types/shared-history.js";
import type { BrowserIncomingMessage } from "./session-types.js";

export interface ImportedPackage {
  manifest: SharedHistoryPackage;
  messages: BrowserIncomingMessage[];
  hasBundle: boolean;
  importDir: string;
  extractCheckpointFiles: (hash: string, outDir: string) => Promise<void>;
}

export async function importHistory(tarPath: string, importDir?: string): Promise<ImportedPackage> {
  const dir = importDir ?? mkdtempSync(join(tmpdir(), "pneuma-import-"));
  mkdirSync(dir, { recursive: true });

  // Extract tar.gz
  await Bun.spawn(["tar", "xzf", tarPath, "-C", dir], { stdout: "ignore", stderr: "ignore" }).exited;

  // Read manifest
  const manifest: SharedHistoryPackage = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf-8"));

  // Read messages from JSONL
  const messagesContent = readFileSync(join(dir, "messages.jsonl"), "utf-8");
  const messages: BrowserIncomingMessage[] = messagesContent
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));

  // Check for bundle
  const bundlePath = join(dir, "repo.bundle");
  const hasBundle = existsSync(bundlePath);

  // Clone bundle to a local repo for checkout operations
  let repoDir: string | null = null;
  if (hasBundle) {
    repoDir = join(dir, ".shadow-repo");
    await Bun.spawn(
      ["git", "clone", "--bare", bundlePath, repoDir],
      { stdout: "ignore", stderr: "ignore" },
    ).exited;
  }

  return {
    manifest,
    messages,
    hasBundle,
    importDir: dir,
    extractCheckpointFiles: async (hash: string, outDir: string) => {
      if (!repoDir) throw new Error("No bundle available for checkpoint extraction");
      mkdirSync(outDir, { recursive: true });
      const archive = Bun.spawn(
        ["git", `--git-dir=${repoDir}`, "archive", hash],
        { stdout: "pipe", stderr: "ignore" },
      );
      const extract = Bun.spawn(
        ["tar", "x", "-C", outDir],
        { stdin: archive.stdout, stdout: "ignore", stderr: "ignore" },
      );
      await extract.exited;
    },
  };
}
```

- [ ] **Step 3: Run tests, verify pass**

Run: `bun test server/__tests__/history-import.test.ts`

- [ ] **Step 4: Commit**

```bash
git add server/history-import.ts server/__tests__/history-import.test.ts
git commit -m "feat: add history import — unpacks tar.gz, clones bundle, extracts checkpoints"
```

---

### Task 6: Replay slice (frontend state)

**Files:**
- Create: `src/store/replay-slice.ts`
- Modify: `src/store/index.ts`

- [ ] **Step 1: Create replay slice**

```typescript
// src/store/replay-slice.ts
import type { StateCreator } from "zustand";
import type { AppState } from "./index";

export interface ReplaySlice {
  // State
  replayMode: boolean;
  replayMessages: any[];
  replayCheckpoints: any[];
  currentSeq: number;
  activeCheckpointHash: string | null;
  playbackSpeed: number;
  isPlaying: boolean;
  replayMetadata: {
    title: string;
    mode: string;
    totalTurns: number;
    duration: number;
  } | null;
  replaySummary: any | null;

  // Actions
  enterReplayMode: (data: {
    messages: any[];
    checkpoints: any[];
    metadata: ReplaySlice["replayMetadata"];
    summary: any;
  }) => void;
  exitReplayMode: () => void;
  setCurrentSeq: (seq: number) => void;
  setActiveCheckpoint: (hash: string | null) => void;
  setPlaybackSpeed: (speed: number) => void;
  setIsPlaying: (playing: boolean) => void;
}

export const createReplaySlice: StateCreator<AppState, [], [], ReplaySlice> = (set) => ({
  replayMode: false,
  replayMessages: [],
  replayCheckpoints: [],
  currentSeq: 0,
  activeCheckpointHash: null,
  playbackSpeed: 1,
  isPlaying: false,
  replayMetadata: null,
  replaySummary: null,

  enterReplayMode: (data) =>
    set({
      replayMode: true,
      replayMessages: data.messages,
      replayCheckpoints: data.checkpoints,
      replayMetadata: data.metadata,
      replaySummary: data.summary,
      currentSeq: 0,
      activeCheckpointHash: null,
      isPlaying: false,
    }),

  exitReplayMode: () =>
    set({
      replayMode: false,
      replayMessages: [],
      replayCheckpoints: [],
      replayMetadata: null,
      replaySummary: null,
      currentSeq: 0,
      activeCheckpointHash: null,
      isPlaying: false,
    }),

  setCurrentSeq: (seq) => set({ currentSeq: seq }),
  setActiveCheckpoint: (hash) => set({ activeCheckpointHash: hash }),
  setPlaybackSpeed: (speed) => set({ playbackSpeed: speed }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
});
```

- [ ] **Step 2: Add replay slice to store**

Read `src/store/index.ts` and add:
- Import: `import { createReplaySlice, type ReplaySlice } from "./replay-slice.js";`
- Add `ReplaySlice` to the `AppState` intersection type
- Add `...createReplaySlice(...a)` in the store creator

- [ ] **Step 3: Commit**

```bash
git add src/store/replay-slice.ts src/store/index.ts
git commit -m "feat: add replay slice to Zustand store"
```

---

### Task 7: Replay player UI components

**Files:**
- Create: `src/components/ReplayPlayer.tsx`
- Create: `src/components/ReplayTimeline.tsx`

- [ ] **Step 1: Create ReplayPlayer (playback controls)**

```tsx
// src/components/ReplayPlayer.tsx
import { useStore } from "../store/index.js";

export function ReplayPlayer() {
  const {
    replayMode, replayMessages, replayCheckpoints, replayMetadata,
    currentSeq, playbackSpeed, isPlaying,
    setCurrentSeq, setIsPlaying, setPlaybackSpeed, setActiveCheckpoint,
  } = useStore();

  if (!replayMode || !replayMetadata) return null;

  const totalMessages = replayMessages.length;
  const currentTurn = replayMessages.slice(0, currentSeq + 1).filter((m: any) => m.type === "user_message").length;
  const totalTurns = replayMetadata.totalTurns;

  const seekToCheckpoint = (idx: number) => {
    const cp = replayCheckpoints[idx];
    if (!cp) return;
    setCurrentSeq(cp.messageSeqRange[1]);
    setActiveCheckpoint(cp.hash);
    setIsPlaying(false);
  };

  const prevTurn = () => {
    for (let i = currentSeq - 1; i >= 0; i--) {
      if (replayMessages[i].type === "user_message") {
        setCurrentSeq(i);
        // Find matching checkpoint
        const cp = replayCheckpoints.find((c: any) => i >= c.messageSeqRange[0] && i <= c.messageSeqRange[1]);
        if (cp) setActiveCheckpoint(cp.hash);
        return;
      }
    }
    setCurrentSeq(0);
  };

  const nextTurn = () => {
    for (let i = currentSeq + 1; i < totalMessages; i++) {
      if (replayMessages[i].type === "user_message") {
        setCurrentSeq(i);
        const cp = replayCheckpoints.find((c: any) => i >= c.messageSeqRange[0] && i <= c.messageSeqRange[1]);
        if (cp) setActiveCheckpoint(cp.hash);
        return;
      }
    }
    setCurrentSeq(totalMessages - 1);
    setIsPlaying(false);
  };

  const speeds = [1, 2, 4, 8];
  const nextSpeed = () => {
    const idx = speeds.indexOf(playbackSpeed);
    setPlaybackSpeed(speeds[(idx + 1) % speeds.length]);
  };

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-t border-cc-border bg-cc-surface/80 backdrop-blur text-sm">
      <div className="flex items-center gap-1">
        <button onClick={prevTurn} className="px-2 py-1 rounded hover:bg-cc-hover text-cc-text-secondary" title="Previous turn">◄◄</button>
        <button
          onClick={() => setIsPlaying(!isPlaying)}
          className="px-3 py-1 rounded bg-cc-primary text-black font-medium"
        >
          {isPlaying ? "⏸" : "▶"}
        </button>
        <button onClick={nextTurn} className="px-2 py-1 rounded hover:bg-cc-hover text-cc-text-secondary" title="Next turn">►►</button>
      </div>

      <div className="text-cc-text-secondary">
        Turn {currentTurn}/{totalTurns}
      </div>

      <div className="flex-1 mx-2">
        <input
          type="range"
          min={0}
          max={totalMessages - 1}
          value={currentSeq}
          onChange={(e) => {
            setCurrentSeq(Number(e.target.value));
            setIsPlaying(false);
          }}
          className="w-full accent-cc-primary"
        />
      </div>

      <button
        onClick={nextSpeed}
        className="px-2 py-1 rounded hover:bg-cc-hover text-cc-text-secondary tabular-nums"
      >
        {playbackSpeed}x
      </button>

      <div className="text-cc-text-secondary text-xs">
        {replayMetadata.title}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create ReplayTimeline**

```tsx
// src/components/ReplayTimeline.tsx
import { useStore } from "../store/index.js";

export function ReplayTimeline() {
  const {
    replayMode, replayCheckpoints, activeCheckpointHash,
    setCurrentSeq, setActiveCheckpoint, setIsPlaying,
  } = useStore();

  if (!replayMode || replayCheckpoints.length === 0) return null;

  return (
    <div className="flex items-center gap-2 px-4 py-1.5 border-t border-cc-border bg-cc-bg text-xs overflow-x-auto">
      {replayCheckpoints.map((cp: any, idx: number) => (
        <button
          key={cp.hash}
          onClick={() => {
            setCurrentSeq(cp.messageSeqRange[1]);
            setActiveCheckpoint(cp.hash);
            setIsPlaying(false);
          }}
          className={`flex items-center gap-1 px-2 py-1 rounded whitespace-nowrap transition-colors ${
            activeCheckpointHash === cp.hash
              ? "bg-cc-primary/20 text-cc-primary border border-cc-primary/40"
              : "text-cc-text-secondary hover:bg-cc-hover"
          }`}
        >
          <span className={`w-2 h-2 rounded-full ${
            activeCheckpointHash === cp.hash ? "bg-cc-primary" : "bg-cc-text-secondary/40"
          }`} />
          {cp.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/ReplayPlayer.tsx src/components/ReplayTimeline.tsx
git commit -m "feat: add replay player controls and checkpoint timeline UI"
```

---

### Task 8: Integrate replay mode into App

**Files:**
- Modify: `src/App.tsx`
- Modify: `server/index.ts`
- Modify: `bin/pneuma.ts`

- [ ] **Step 1: Add replay API routes to server**

In `server/index.ts`, add import:
```typescript
import { importHistory } from "./history-import.js";
```

Add replay-mode routes (conditionally, when a replay package is loaded). Add a module-level variable to hold the imported package, and routes to serve it:

```typescript
// Near the top, after other let/const declarations
let replayPackage: Awaited<ReturnType<typeof importHistory>> | null = null;

// In the route section, add:
app.post("/api/replay/load", async (c) => {
  try {
    const body = await c.req.json<{ path: string }>();
    replayPackage = await importHistory(body.path);
    return c.json({
      manifest: replayPackage.manifest,
      messageCount: replayPackage.messages.length,
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.get("/api/replay/messages", (c) => {
  if (!replayPackage) return c.json({ error: "No replay loaded" }, 400);
  return c.json({ messages: replayPackage.messages });
});

app.post("/api/replay/checkout/:hash", async (c) => {
  if (!replayPackage) return c.json({ error: "No replay loaded" }, 400);
  const hash = c.req.param("hash");
  const outDir = join(workspace, ".pneuma", "replay-checkout");
  await Bun.spawn(["rm", "-rf", outDir]).exited;
  await replayPackage.extractCheckpointFiles(hash, outDir);
  // Read extracted files and return as JSON
  const files: { path: string; content: string }[] = [];
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  function walk(dir: string, prefix: string) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const rel = prefix ? `${prefix}/${entry}` : entry;
      const stat = statSync(full);
      if (stat.isDirectory()) walk(full, rel);
      else if (stat.size < 500_000) {
        try { files.push({ path: rel, content: readFileSync(full, "utf-8") }); } catch {}
      }
    }
  }
  walk(outDir, "");
  return c.json({ files });
});
```

- [ ] **Step 2: Add ReplayPlayer and ReplayTimeline to App.tsx**

Read `src/App.tsx` to understand the current layout structure. Then add imports and conditionally render replay components at the bottom of the layout:

```typescript
import { ReplayPlayer } from "./components/ReplayPlayer.js";
import { ReplayTimeline } from "./components/ReplayTimeline.js";
```

In the JSX, after the main content area (before the closing wrapper), add:

```tsx
{replayMode && (
  <>
    <ReplayTimeline />
    <ReplayPlayer />
  </>
)}
```

Where `replayMode` comes from `useStore()`.

- [ ] **Step 3: Implement `history open` CLI command**

In `bin/pneuma.ts`, replace the placeholder in the `history open` branch:

```typescript
    if (rawArgs[1] === "open") {
      const target = rawArgs[2];
      if (!target) {
        console.error("Usage: pneuma history open <path-or-url>");
        process.exit(1);
      }
      const resolvedPath = resolve(target);
      // For now, just start server and load replay via API
      // Full implementation will be in a follow-up
      console.log(`Opening replay: ${resolvedPath}`);
      console.log("Note: Full replay mode launch is coming in next iteration.");
      console.log("For now, start a session and use POST /api/replay/load with the path.");
      return;
    }
```

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx server/index.ts bin/pneuma.ts
git commit -m "feat: integrate replay mode — API routes, UI components, CLI placeholder"
```

---

### Task 9: Context restoration for "Continue Conversation"

**Files:**
- Modify: `server/skill-installer.ts`
- Modify: `server/history-import.ts`

- [ ] **Step 1: Add resumed context injection to skill-installer**

Read `server/skill-installer.ts` to find the existing `<!-- pneuma:start -->` / `<!-- pneuma:end -->` injection pattern.

Add a new function `injectResumedContext` that:
1. Checks for `.pneuma/resumed-context.xml` in the workspace
2. If found, injects its content within a `<!-- pneuma:resumed:start -->` / `<!-- pneuma:resumed:end -->` section inside the `<!-- pneuma:start -->` block in CLAUDE.md / AGENTS.md

```typescript
export function injectResumedContext(workspace: string, backendType: string): void {
  const contextPath = join(workspace, ".pneuma", "resumed-context.xml");
  if (!existsSync(contextPath)) return;

  const context = readFileSync(contextPath, "utf-8");
  const markerStart = "<!-- pneuma:resumed:start -->";
  const markerEnd = "<!-- pneuma:resumed:end -->";
  const section = `${markerStart}\n${context}\n${markerEnd}`;

  const instructionsFile = backendType === "codex"
    ? join(workspace, "AGENTS.md")
    : join(workspace, "CLAUDE.md");

  if (!existsSync(instructionsFile)) return;

  let content = readFileSync(instructionsFile, "utf-8");

  // Remove existing resumed section if present
  const existingStart = content.indexOf(markerStart);
  const existingEnd = content.indexOf(markerEnd);
  if (existingStart !== -1 && existingEnd !== -1) {
    content = content.slice(0, existingStart) + content.slice(existingEnd + markerEnd.length);
  }

  // Inject before <!-- pneuma:end --> if it exists, otherwise append
  const pneumaEnd = content.indexOf("<!-- pneuma:end -->");
  if (pneumaEnd !== -1) {
    content = content.slice(0, pneumaEnd) + section + "\n" + content.slice(pneumaEnd);
  } else {
    content += "\n" + section;
  }

  writeFileSync(instructionsFile, content);
}
```

- [ ] **Step 2: Add restoreWorkspace function to history-import**

Add to `server/history-import.ts`:

```typescript
export async function restoreWorkspaceFromHistory(
  pkg: ImportedPackage,
  targetWorkspace: string,
): Promise<void> {
  const { manifest, hasBundle } = pkg;

  // 1. Extract last checkpoint's files to workspace
  if (hasBundle && manifest.checkpoints.length > 0) {
    const lastCheckpoint = manifest.checkpoints[manifest.checkpoints.length - 1];
    await pkg.extractCheckpointFiles(lastCheckpoint.hash, targetWorkspace);
  }

  // 2. Create .pneuma directory
  const pneumaDir = join(targetWorkspace, ".pneuma");
  mkdirSync(pneumaDir, { recursive: true });

  // 3. Write resumed-context.xml from summary
  const summary = manifest.summary;
  const contextXml = `<resumed-session original-turns="${manifest.metadata.totalTurns}" original-mode="${manifest.metadata.mode}">
  <summary>
    This is a resumed session from shared history. Continue naturally from where the previous session left off.

    ## Overview
    ${summary.overview}

    ## Key Decisions
${summary.keyDecisions.map((d) => `    - ${d}`).join("\n")}

    ## Current Files
${summary.workspaceFiles.map((f) => `    - ${f.path} (${f.lines} lines)`).join("\n")}
  </summary>
  <recent-conversation>
${summary.recentConversation}
  </recent-conversation>
</resumed-session>`;

  writeFileSync(join(pneumaDir, "resumed-context.xml"), contextXml);

  // 4. Write session.json for the new session
  writeFileSync(join(pneumaDir, "session.json"), JSON.stringify({
    sessionId: crypto.randomUUID(),
    mode: manifest.metadata.mode,
    backendType: manifest.metadata.backendType,
    createdAt: Date.now(),
    resumedFrom: manifest.metadata.id,
  }));
}
```

- [ ] **Step 3: Call injectResumedContext from installSkill**

In `server/skill-installer.ts`, at the end of the `installSkill` function (after existing injection), add:

```typescript
  injectResumedContext(workspace, backendType);
```

- [ ] **Step 4: Commit**

```bash
git add server/skill-installer.ts server/history-import.ts
git commit -m "feat: add context restoration for continue-conversation from shared history"
```

---

### Task 10: Full test suite verification

- [ ] **Step 1: Run all tests**

Run: `bun test`
Expected: All tests pass, no regressions

- [ ] **Step 2: Run new tests specifically**

```bash
bun test server/__tests__/history-summary.test.ts server/__tests__/history-export.test.ts server/__tests__/history-import.test.ts --verbose
```

- [ ] **Step 3: E2E test — export from running session**

```bash
# Start a webcraft session, do some work, then:
curl -X POST http://localhost:PORT/api/history/export \
  -H "Content-Type: application/json" \
  -d '{"title": "E2E Test"}' | python3 -m json.tool
```

- [ ] **Step 4: Commit any fixes**

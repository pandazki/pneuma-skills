# Replay Mode Redesign — Two-Phase Session

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign replay mode as a phase within a normal session, enabling seamless one-way transition from replay to normal editing ("Continue Work").

**Architecture:** Replay is no longer a separate session type — it's a `replayMode` flag on a normal session with a real workspace. The server starts normally but delays agent backend launch until "Continue Work" is clicked. The frontend gates all interactive UI (chat input, viewer edit modes, model status) behind the `replayMode` flag. Continue Work applies the final checkpoint state, injects compact-style context, launches the agent, and flips the flag — irreversible.

**Tech Stack:** Bun, Hono, React 19, Zustand, xterm.js, shadow-git

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `server/replay-continue.ts` | `/api/replay/continue` handler — applies final checkpoint, installs skill, injects resumed context, signals server to launch agent |

### Modified Files
| File | Changes |
|------|---------|
| `bin/pneuma.ts` | Replay creates real workspace at `~/.pneuma/replay-workspaces/<id>/`; delays agent launch + file watcher + skill install; keeps history/greeting skip |
| `bin/pneuma-cli-helpers.ts` | Add `replaySource` field to parsed args (source workspace path for existing session replay) |
| `server/index.ts` | Add `POST /api/replay/continue` route; add `GET /api/replay/status` route; server holds mutable `replayMode` flag; conditionally register agent launch capability |
| `server/shadow-git.ts` | Export `getLatestCheckpointHash(workspace)` helper |
| `core/types/viewer-contract.ts` | Add `readonly?: boolean` to `ViewerPreviewProps` |
| `src/App.tsx` | Pass `readonly={replayMode}` to viewer; connect WS always (not just non-replay); gate replay UI rendering |
| `src/store/replay-slice.ts` | Add `continueWork()` action that calls `/api/replay/continue` + exits replay mode |
| `src/store/session-slice.ts` | Expose `replayMode` from server init response; handle continue transition |
| `src/components/ChatPanel.tsx` | Hide `ChatInput` when `replayMode`; show replay messages instead of live messages |
| `src/components/ChatInput.tsx` | No changes needed (hidden by parent) |
| `src/components/TopBar.tsx` | Hide model status, "+" button, share dropdown when `replayMode`; show "Replay" badge |
| `src/components/ReplayPlayer.tsx` | Add "Continue Work" button on the right side; wire to `continueWork()` |
| `src/components/Launcher.tsx` | Detect shadow-git presence in sessions; show replay icon on hover; launch with `replaySource` for existing workspaces |
| `src/ws.ts` | Always connect WS; handle `session_init` with `replayMode` flag from server |
| `server/history-import.ts` | Add `importFromWorkspace(sourceWorkspace, targetWorkspace)` — clones shadow-git bundle + history from existing workspace |

### Deleted / Obsoleted
| File | Action |
|------|--------|
| `src/components/ReplayTimeline.tsx` | Already a no-op stub — can remove |

---

## Key Design Decisions

1. **Continue Work always applies FINAL checkpoint** — regardless of current playback position
2. **Continue Work resets history** — `shadow.git` re-initialized (final state = initial commit), `history.json` cleared, `checkpoints.jsonl` cleared; `session.json` records `resumedFrom` for audit only
3. **Replay workspace is always new** — `~/.pneuma/replay-workspaces/<package-id>/` for imports, or `~/.pneuma/replay-workspaces/<workspace-basename>-<ts>/` for existing session replay
4. **WS connects immediately** — simplifies Continue transition (no reconnect needed)
5. **Server holds `replayMode` flag** — `/api/replay/status` lets frontend query, `/api/replay/continue` flips it
6. **Launcher shows replay for any session with shadow-git** — checks `<workspace>/.pneuma/shadow.git/HEAD` + `<workspace>/.pneuma/history.json`
7. **Viewer `readonly` prop** — each mode implements readonly behavior (suppress select/annotate, disable editing)

---

## Tasks

### Task 1: Server — Replay State + Continue Endpoint

**Files:**
- Create: `server/replay-continue.ts`
- Modify: `server/index.ts`
- Modify: `server/shadow-git.ts`
- Test: `server/__tests__/replay-continue.test.ts`

- [ ] **Step 1: Write tests for replay continue logic**

```typescript
// server/__tests__/replay-continue.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("replay-continue", () => {
  let workspace: string;

  beforeEach(() => {
    workspace = join(tmpdir(), `replay-continue-test-${Date.now()}`);
    mkdirSync(join(workspace, ".pneuma"), { recursive: true });
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  test("prepareWorkspaceForContinue clears replay state", async () => {
    // Setup: create checkpoints.jsonl and history.json
    writeFileSync(join(workspace, ".pneuma", "checkpoints.jsonl"), '{"turn":1}\n');
    writeFileSync(join(workspace, ".pneuma", "history.json"), '[{"type":"user_message"}]');
    writeFileSync(join(workspace, ".pneuma", "session.json"), JSON.stringify({
      sessionId: "replay-123",
      mode: "doc",
      backendType: "claude-code",
      createdAt: Date.now(),
    }));

    const { prepareWorkspaceForContinue } = await import("../replay-continue.js");
    await prepareWorkspaceForContinue(workspace, {
      originalMode: "doc",
      summary: { overview: "test", keyDecisions: [], workspaceFiles: [], recentConversation: "" },
    });

    // checkpoints.jsonl should be cleared
    expect(readFileSync(join(workspace, ".pneuma", "checkpoints.jsonl"), "utf-8")).toBe("");
    // history.json should be cleared
    expect(readFileSync(join(workspace, ".pneuma", "history.json"), "utf-8")).toBe("[]");
    // session.json should have resumedFrom
    const session = JSON.parse(readFileSync(join(workspace, ".pneuma", "session.json"), "utf-8"));
    expect(session.resumedFrom).toBeTruthy();
    // resumed-context.xml should exist
    expect(existsSync(join(workspace, ".pneuma", "resumed-context.xml"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test server/__tests__/replay-continue.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Add `getLatestCheckpointHash` to shadow-git.ts**

In `server/shadow-git.ts`, add after `listCheckpoints`:

```typescript
/** Get the hash of the latest checkpoint (last line of checkpoints.jsonl) */
export async function getLatestCheckpointHash(workspace: string): Promise<string | null> {
  const entries = await listCheckpoints(workspace);
  if (entries.length === 0) return null;
  return entries[entries.length - 1].hash;
}
```

- [ ] **Step 4: Implement `replay-continue.ts`**

```typescript
// server/replay-continue.ts
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { initShadowGit } from "./shadow-git.js";
import type { SessionSummary } from "../core/types/shared-history.js";

interface ContinueOptions {
  originalMode: string;
  summary: SessionSummary;
  backendType?: string;
}

/**
 * Prepare workspace for Continue Work transition:
 * 1. Clear replay-era checkpoint and history data
 * 2. Write resumed-context.xml for skill installer injection
 * 3. Re-initialize shadow-git (current files become initial commit)
 * 4. Update session.json with resumedFrom marker
 */
export async function prepareWorkspaceForContinue(
  workspace: string,
  options: ContinueOptions,
): Promise<void> {
  const pneumaDir = join(workspace, ".pneuma");
  mkdirSync(pneumaDir, { recursive: true });

  // 1. Clear old checkpoint index and history
  writeFileSync(join(pneumaDir, "checkpoints.jsonl"), "");
  writeFileSync(join(pneumaDir, "history.json"), "[]");

  // 2. Remove old shadow.git so initShadowGit creates fresh one
  const shadowGitDir = join(pneumaDir, "shadow.git");
  if (existsSync(shadowGitDir)) {
    const { rmSync } = await import("node:fs");
    rmSync(shadowGitDir, { recursive: true, force: true });
  }

  // 3. Re-initialize shadow-git (current workspace files = initial commit)
  await initShadowGit(workspace);

  // 4. Write resumed-context.xml for skill-installer injection
  const contextXml = buildResumedContextXml(options.summary, options.originalMode);
  writeFileSync(join(pneumaDir, "resumed-context.xml"), contextXml, "utf-8");

  // 5. Update session.json with resumedFrom marker
  const sessionPath = join(pneumaDir, "session.json");
  if (existsSync(sessionPath)) {
    const session = JSON.parse(readFileSync(sessionPath, "utf-8"));
    session.resumedFrom = {
      timestamp: Date.now(),
      originalMode: options.originalMode,
    };
    // Clear replay-era session ID
    delete session.agentSessionId;
    writeFileSync(sessionPath, JSON.stringify(session, null, 2));
  }
}

function buildResumedContextXml(summary: SessionSummary, mode: string): string {
  const keyDecisions = summary.keyDecisions.length > 0
    ? summary.keyDecisions.map((d) => `- ${d}`).join("\n")
    : "- No key decisions recorded";

  const workspaceFiles = summary.workspaceFiles.length > 0
    ? summary.workspaceFiles.map((f) => `- ${f}`).join("\n")
    : "- No files recorded";

  return `<resumed-session original-mode="${mode}">
  <summary>
    This is a resumed work session. The following is a summary of the previous work.
    Continue naturally from where the previous session left off.

    ## Overview
    ${summary.overview}

    ## Key Decisions
    ${keyDecisions}

    ## Current Files
    ${workspaceFiles}
  </summary>

  <recent-conversation>
    ${summary.recentConversation || "No recent conversation recorded."}
  </recent-conversation>
</resumed-session>`;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test server/__tests__/replay-continue.test.ts`
Expected: PASS

- [ ] **Step 6: Add server routes in `server/index.ts`**

After the existing `/api/replay/checkout/:hash` route, add:

```typescript
// Replay status — frontend queries this to know if we're in replay mode
app.get("/api/replay/status", (c) => {
  return c.json({ replayMode: !!options.replayPackagePath });
});

// Continue Work — transition from replay to normal session
app.post("/api/replay/continue", async (c) => {
  if (!replayPackage) {
    return c.json({ error: "Not in replay mode" }, 400);
  }

  try {
    const { prepareWorkspaceForContinue } = await import("./replay-continue.js");

    // 1. Apply final checkpoint to workspace (already done by checkout — ensure final state)
    const checkpoints = replayPackage.manifest.checkpoints;
    const lastCheckpoint = checkpoints[checkpoints.length - 1];
    if (lastCheckpoint) {
      const outDir = workspace; // Write directly to workspace
      await replayPackage.extractCheckpointFiles(lastCheckpoint.hash, outDir);
    }

    // 2. Prepare workspace (clear replay state, re-init shadow-git, write context)
    await prepareWorkspaceForContinue(workspace, {
      originalMode: replayPackage.manifest.metadata.mode,
      summary: replayPackage.manifest.summary,
      backendType: options.replayPackagePath ? "claude-code" : undefined,
    });

    // 3. Clear replay package reference
    replayPackage = null;

    return c.json({
      ok: true,
      workspace,
      mode: options.modeName,
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});
```

**Note:** The actual agent launch happens at the CLI level (see Task 3). The server route prepares the workspace; the CLI/frontend coordinate the agent startup via WS.

- [ ] **Step 7: Commit**

```bash
git add server/replay-continue.ts server/__tests__/replay-continue.test.ts server/index.ts server/shadow-git.ts
git commit -m "feat: add replay continue endpoint and workspace preparation"
```

---

### Task 2: ViewerContract — Add `readonly` Prop

**Files:**
- Modify: `core/types/viewer-contract.ts:190` (ViewerPreviewProps)
- Modify: `src/App.tsx`

- [ ] **Step 1: Add `readonly` to ViewerPreviewProps**

In `core/types/viewer-contract.ts`, add to `ViewerPreviewProps` interface (after `commands`):

```typescript
  /** When true, viewer should suppress editing, selection, and annotation modes.
   *  Used during replay mode. Each mode implements its own readonly behavior. */
  readonly?: boolean;
```

- [ ] **Step 2: Pass `readonly` from App.tsx**

In `src/App.tsx`, the `useViewerProps()` hook already builds props. Add `readonly` to the returned object:

```typescript
// Inside useViewerProps(), add to the return object:
const replayMode = useStore((s) => s.replayMode);

return {
  // ... existing props
  readonly: replayMode,
};
```

And in the existing `viewerProps` usage, it's already spread into `<PreviewComponent {...viewerProps} />`, so no further changes needed.

- [ ] **Step 3: Commit**

```bash
git add core/types/viewer-contract.ts src/App.tsx
git commit -m "feat: add readonly prop to ViewerPreviewProps for replay mode"
```

---

### Task 3: CLI — Replay Creates Real Workspace + Delayed Agent Launch

**Files:**
- Modify: `bin/pneuma.ts`
- Modify: `bin/pneuma-cli-helpers.ts`
- Modify: `server/index.ts` (add `ServerOptions.replayMode` boolean, distinct from `replayPackagePath`)
- Modify: `server/history-import.ts` (add `importFromWorkspace`)

- [ ] **Step 1: Add `importFromWorkspace` to history-import.ts**

This function bundles shadow-git + history from an existing workspace and imports them into a new replay workspace:

```typescript
// Add to server/history-import.ts

/**
 * Import replay data from an existing workspace's shadow-git.
 * Creates a history package from the workspace's own checkpoint data + message history.
 */
export async function importFromWorkspace(
  sourceWorkspace: string,
  targetWorkspace: string,
): Promise<ImportedPackage> {
  const { mkdirSync, readFileSync, existsSync, copyFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { createBundle, listCheckpoints } = await import("./shadow-git.js");

  const importDir = join(targetWorkspace, ".pneuma", "replay");
  mkdirSync(importDir, { recursive: true });

  // 1. Read source history
  const historyPath = join(sourceWorkspace, ".pneuma", "history.json");
  let messages: any[] = [];
  if (existsSync(historyPath)) {
    messages = JSON.parse(readFileSync(historyPath, "utf-8"));
  }

  // 2. Read source checkpoints
  const checkpoints = await listCheckpoints(sourceWorkspace);

  // 3. Create git bundle from source shadow-git
  const bundlePath = join(importDir, "repo.bundle");
  const shadowGitExists = existsSync(join(sourceWorkspace, ".pneuma", "shadow.git", "HEAD"));
  let hasBundle = false;
  if (shadowGitExists && checkpoints.length > 0) {
    try {
      await createBundle(sourceWorkspace, bundlePath);
      hasBundle = true;
    } catch (err) {
      console.warn("[history-import] Failed to create bundle from source:", err);
    }
  }

  // 4. Read source session for metadata
  const sessionPath = join(sourceWorkspace, ".pneuma", "session.json");
  let sourceSession: any = {};
  if (existsSync(sessionPath)) {
    sourceSession = JSON.parse(readFileSync(sessionPath, "utf-8"));
  }

  // 5. Build manifest
  const { generateSummary } = await import("./history-summary.js");
  const summary = generateSummary(messages);

  const manifest = {
    version: 1 as const,
    metadata: {
      id: `replay-${Date.now()}`,
      title: sourceSession.mode || "Session Replay",
      mode: sourceSession.mode || "unknown",
      backendType: sourceSession.backendType || "claude-code",
      totalTurns: checkpoints.length,
      createdAt: sourceSession.createdAt || Date.now(),
      exportedAt: Date.now(),
      duration: 0,
    },
    summary,
    checkpoints: checkpoints.map((cp: any) => ({
      turn: cp.turn,
      timestamp: cp.ts,
      hash: cp.hash,
      label: `Turn ${cp.turn}`,
      filesChanged: 0,
      filesAdded: 0,
      filesDeleted: 0,
      messageSeqRange: [0, 0] as [number, number],
    })),
  };

  // Write manifest for replay load
  const { writeFileSync } = await import("node:fs");
  writeFileSync(join(importDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  // Write messages as JSONL
  writeFileSync(
    join(importDir, "messages.jsonl"),
    messages.map((m: any) => JSON.stringify(m)).join("\n") + (messages.length > 0 ? "\n" : ""),
  );

  // 6. Clone bundle for checkout access
  if (hasBundle) {
    const cloneDir = join(importDir, ".shadow-repo");
    const proc = Bun.spawn(["git", "clone", "--bare", bundlePath, cloneDir], {
      stdout: "pipe", stderr: "pipe",
    });
    await proc.exited;
  }

  // Return as ImportedPackage
  return importHistory(importDir);
}
```

- [ ] **Step 2: Modify CLI replay flow in `bin/pneuma.ts`**

Replace the current replay branch (`if (replayPackage) { ... }` around line 1123) with a flow that:
1. Creates a real workspace at `~/.pneuma/replay-workspaces/<id>/`
2. Imports replay data into that workspace
3. Starts server with `replayMode: true` (new flag) but with a real workspace
4. Skips agent launch, skill install, file watcher, greeting — same as now
5. Still connects WS bridge with a session ID
6. Records session to global registry

Key changes to `bin/pneuma.ts` main flow:

```typescript
// After line ~736 where parsedArgs are destructured, handle replay workspace:
if (replayPackage) {
  // Create dedicated replay workspace
  const replayId = `${modeName}-${Date.now()}`;
  const replayWorkspacesDir = join(homedir(), ".pneuma", "replay-workspaces");
  mkdirSync(replayWorkspacesDir, { recursive: true });
  const replayWorkspace = join(replayWorkspacesDir, replayId);
  mkdirSync(replayWorkspace, { recursive: true });

  // Override workspace to the new replay workspace
  // (The rest of the flow uses this workspace)
  workspace = replayWorkspace; // Note: workspace is let-bound from parsedArgs
}
```

Then in the existing replay branch (line ~1123):
- Keep `sessionId` generation as before
- But use the real replay workspace
- Pass `replayMode: true` to server options
- Do NOT launch agent, file watcher, skill install, greeting (same as now)
- DO still connect WS bridge and persist session

For `replaySource` (existing workspace replay from launcher):
```typescript
// In parseCliArgs, add --replay-source flag
// When --replay-source is set, import from that workspace's shadow-git
if (parsedArgs.replaySource) {
  const { importFromWorkspace } = await import("../server/history-import.js");
  // Create replay workspace
  const replayId = `${basename(parsedArgs.replaySource)}-${Date.now()}`;
  const replayWorkspace = join(homedir(), ".pneuma", "replay-workspaces", replayId);
  mkdirSync(replayWorkspace, { recursive: true });
  workspace = replayWorkspace;
  // The importFromWorkspace result is used later for pre-loading
}
```

- [ ] **Step 3: Add `replayMode` to ServerOptions and wire status endpoint**

In `server/index.ts`, add to `ServerOptions`:
```typescript
replayMode?: boolean; // Server starts in replay mode (delays agent launch)
```

Add status endpoint that uses this flag (mutable — flipped by continue):
```typescript
let serverReplayMode = options.replayMode ?? false;

app.get("/api/replay/status", (c) => {
  return c.json({ replayMode: serverReplayMode });
});
```

The continue endpoint sets `serverReplayMode = false`.

- [ ] **Step 4: Add `--replay-source` to CLI arg parsing**

In `bin/pneuma-cli-helpers.ts`, add `replaySource: string` to the parsed args interface and parse `--replay-source <path>`:

```typescript
// In parseCliArgs:
} else if (arg === "--replay-source" && i + 1 < args.length) {
  replaySource = resolve(args[++i]);
}
```

- [ ] **Step 5: Commit**

```bash
git add bin/pneuma.ts bin/pneuma-cli-helpers.ts server/index.ts server/history-import.ts
git commit -m "feat: replay creates real workspace with delayed agent launch"
```

---

### Task 4: Frontend — Readonly UI in Replay Mode

**Files:**
- Modify: `src/components/TopBar.tsx`
- Modify: `src/components/ChatPanel.tsx`
- Modify: `src/components/ReplayPlayer.tsx`
- Modify: `src/App.tsx`
- Modify: `src/ws.ts`
- Modify: `src/store/replay-slice.ts`

- [ ] **Step 1: Always connect WebSocket in App.tsx**

In `src/App.tsx`, remove the conditional that skips WS connection in replay mode. The current code (line ~242):

```typescript
// BEFORE (skip WS in replay):
if (replayPath) {
  // Replay mode — no WebSocket connection needed
} else if (explicitSession) {
  connect(explicitSession);
} else { ... }
```

Change to:

```typescript
// AFTER (always connect WS):
if (explicitSession) {
  connect(explicitSession);
} else {
  fetch(`${getApiBase()}/api/session`)
    .then((r) => r.json())
    .then((d) => connect(d.sessionId || "default"))
    .catch(() => connect("default"));
}
```

The replay loading still happens in the `loadModeAsync().then()` chain as before.

- [ ] **Step 2: TopBar readonly mode**

In `src/components/TopBar.tsx`, add replay-aware rendering:

```typescript
// At the top of the TopBar component:
const replayMode = useStore((s) => s.replayMode);
const replayMetadata = useStore((s) => s.replayMetadata);
```

Then gate UI elements:
- Hide the "+" button (workspace item creation) when `replayMode`
- Hide `ShareDropdown` when `replayMode`
- Replace model status ("Idle · no model") with a "Replay" badge:

```tsx
{replayMode ? (
  <div className="flex items-center gap-2 text-sm text-cc-muted">
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-cc-primary/10 text-cc-primary text-xs font-medium">
      Replay
    </span>
    {replayMetadata?.title && (
      <span className="text-cc-muted/60 truncate max-w-[200px]">{replayMetadata.title}</span>
    )}
  </div>
) : (
  // ... existing model status UI
)}
```

- [ ] **Step 3: ChatPanel readonly mode**

In `src/components/ChatPanel.tsx`, hide `ChatInput` when in replay mode:

```typescript
const replayMode = useStore((s) => s.replayMode);

// In JSX, wrap ChatInput:
{!replayMode && <ChatInput ... />}
```

The messages rendering continues to work — replay engine already pushes messages via `store.appendMessage()`.

- [ ] **Step 4: Add `continueWork` action to replay-slice.ts**

```typescript
// In src/store/replay-slice.ts, add to the slice:
continueWork: async () => {
  const base = (await import("../utils/api.js")).getApiBase();
  const resp = await fetch(`${base}/api/replay/continue`, { method: "POST" });
  const data = await resp.json();
  if (data.error) throw new Error(data.error);

  // Exit replay mode — this triggers UI transition
  get().exitReplayMode();

  // Reload workspace files (now the real files from final checkpoint)
  const filesResp = await fetch(`${base}/api/files`);
  const filesData = await filesResp.json();
  if (filesData.files?.length) {
    set({ files: filesData.files } as any); // Cross-slice — uses combined store
  }
},
```

- [ ] **Step 5: ReplayPlayer — Add Continue Work button**

In `src/components/ReplayPlayer.tsx`, add a button on the right side of the control bar:

```tsx
// After the speed selector, add:
<button
  onClick={async () => {
    stopPlayback();
    try {
      await useStore.getState().continueWork();
    } catch (err) {
      console.error("[replay] Continue failed:", err);
    }
  }}
  className="ml-auto px-4 py-1.5 rounded-lg bg-cc-primary text-white text-sm font-medium hover:brightness-110 transition-all whitespace-nowrap"
>
  Continue Work
</button>
```

- [ ] **Step 6: Query replay status on WS init**

In `src/ws.ts`, after connecting, query `/api/replay/status` and set store accordingly. Or better — include `replayMode` in the session init payload from the server side.

In `server/index.ts`, in the browser WS `open` handler where session state is sent, include:
```typescript
// Add to the session state broadcast:
replayMode: serverReplayMode,
```

In `src/ws.ts`, in `processMessage` for `session_init` or initial state:
```typescript
if (data.replayMode) {
  // Store already entered replay mode via loadReplay — this confirms it
}
```

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx src/components/TopBar.tsx src/components/ChatPanel.tsx src/components/ReplayPlayer.tsx src/store/replay-slice.ts src/ws.ts server/index.ts
git commit -m "feat: frontend readonly UI in replay mode with Continue Work button"
```

---

### Task 5: Launcher — Shadow-Git Detection + Replay Entry

**Files:**
- Modify: `src/components/Launcher.tsx`
- Modify: `server/index.ts` (launcher routes — add shadow-git check endpoint)

- [ ] **Step 1: Add shadow-git detection endpoint**

In `server/index.ts`, inside the `launcherMode` block, add:

```typescript
// Check if a workspace has replay-able shadow-git data
app.get("/api/sessions/replay-available", (c) => {
  const workspace = c.req.query("workspace");
  if (!workspace) return c.json({ available: false });

  const hasShadowGit = existsSync(join(workspace, ".pneuma", "shadow.git", "HEAD"));
  const hasHistory = existsSync(join(workspace, ".pneuma", "history.json"));
  const hasCheckpoints = existsSync(join(workspace, ".pneuma", "checkpoints.jsonl"));

  // Check that checkpoints is non-empty
  let checkpointCount = 0;
  if (hasCheckpoints) {
    try {
      const content = readFileSync(join(workspace, ".pneuma", "checkpoints.jsonl"), "utf-8").trim();
      checkpointCount = content ? content.split("\n").length : 0;
    } catch {}
  }

  return c.json({
    available: hasShadowGit && hasHistory && checkpointCount > 0,
    checkpointCount,
  });
});
```

- [ ] **Step 2: Enhance session list to include replay availability**

In the existing `GET /api/sessions` handler, add `hasReplayData` to each session:

```typescript
const sessionsWithThumbs = sessions.map((s) => ({
  ...s,
  hasThumbnail: existsSync(join(s.workspace, ".pneuma", "thumbnail.png")),
  hasReplayData: existsSync(join(s.workspace, ".pneuma", "shadow.git", "HEAD"))
    && existsSync(join(s.workspace, ".pneuma", "checkpoints.jsonl"))
    && (() => {
      try {
        const content = readFileSync(join(s.workspace, ".pneuma", "checkpoints.jsonl"), "utf-8").trim();
        return content.split("\n").length > 0;
      } catch { return false; }
    })(),
}));
```

- [ ] **Step 3: Add replay button to Launcher session cards**

In `src/components/Launcher.tsx`, in the session card hover actions (where delete button lives), add a replay button to the left of delete:

```tsx
{session.hasReplayData && (
  <button
    onClick={(e) => {
      e.stopPropagation();
      handleReplaySession(session);
    }}
    className="p-1 rounded hover:bg-cc-primary/20 text-cc-muted hover:text-cc-primary transition-colors"
    title="Replay session"
  >
    {/* Play icon (▶) */}
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M4 2l10 6-10 6V2z"/>
    </svg>
  </button>
)}
```

- [ ] **Step 4: Implement `handleReplaySession` in Launcher**

```typescript
const handleReplaySession = async (session: SessionRecord) => {
  setLaunching(true);
  try {
    const res = await fetch(`${getApiBase()}/api/launch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        specifier: session.mode,
        workspace: session.workspace,
        backend: session.backendType || "claude-code",
        replaySource: session.workspace, // Key: tells CLI to import from this workspace
      }),
    });
    const data = await res.json();
    if (data.url) {
      window.location.href = data.url;
    }
  } catch (err) {
    console.error("Failed to launch replay:", err);
  } finally {
    setLaunching(false);
  }
};
```

- [ ] **Step 5: Wire `replaySource` through the launch endpoint**

In `server/index.ts`, the `POST /api/launch` handler spawns a child pneuma process. Add `--replay-source` to the args when `body.replaySource` is present:

```typescript
// In the launch handler, when building child process args:
if (body.replaySource) {
  args.push("--replay-source", body.replaySource);
}
```

- [ ] **Step 6: Commit**

```bash
git add src/components/Launcher.tsx server/index.ts
git commit -m "feat: launcher shows replay button for sessions with shadow-git data"
```

---

### Task 6: Agent Launch on Continue Work

**Files:**
- Modify: `bin/pneuma.ts`
- Modify: `server/index.ts`

This is the most complex integration: when `/api/replay/continue` is called, the server needs to signal the CLI process to launch the agent backend. The cleanest approach is an internal event system.

- [ ] **Step 1: Add continue event to server**

The server exposes a callback that the CLI registers for "continue" events:

In `server/index.ts`, add to the return value of `startServer`:

```typescript
// Add to the return type:
onReplayContinue?: (callback: () => Promise<void>) => void;

// Implementation:
let replayContinueCallback: (() => Promise<void>) | null = null;

// Exposed for CLI to register:
const onReplayContinue = (cb: () => Promise<void>) => {
  replayContinueCallback = cb;
};

// In the POST /api/replay/continue handler, after workspace prep:
if (replayContinueCallback) {
  await replayContinueCallback();
}
serverReplayMode = false;
```

Return `onReplayContinue` from `startServer`.

- [ ] **Step 2: Register continue callback in CLI**

In `bin/pneuma.ts`, in the replay branch, after `startServer`:

```typescript
if (replayPackage) {
  // ... existing replay setup

  // Register continue callback — this launches the agent when user clicks Continue Work
  if (serverResult.onReplayContinue) {
    serverResult.onReplayContinue(async () => {
      // 1. Install skill
      p.log.step("Continue Work: installing skill...");
      installSkill(workspace, manifest.skill, modeSourceDir, resolvedParams, manifest.viewerApi, backendType);

      // Record installed skill version
      const skillVersionPath = join(workspace, ".pneuma", "skill-version.json");
      writeFileSync(skillVersionPath, JSON.stringify({ mode: modeName, version: manifest.version }));

      // 2. Launch agent backend
      const sessionBackendType = backendType;
      backend = createBackend(sessionBackendType, actualPort);

      const agentSession = backend.launch({
        cwd: workspace,
        permissionMode: manifest.agent?.permissionMode,
        env: { PNEUMA_API: `http://localhost:${actualPort}` },
      });

      const newSessionId = agentSession.sessionId;
      wsBridge.getOrCreateSession(newSessionId, sessionBackendType);

      // Wire Codex adapter if needed
      if (sessionBackendType === "codex") {
        const { CodexBackend } = await import("../backends/codex/index.js");
        if (backend instanceof CodexBackend) {
          const existingAdapter = backend.getAdapter(newSessionId);
          if (existingAdapter) {
            wsBridge.attachCodexAdapter(newSessionId, existingAdapter);
          }
          backend.onAdapterCreated((sid, adapter) => {
            if (sid === newSessionId) wsBridge.attachCodexAdapter(sid, adapter);
          });
        }
      }

      // 3. Save session
      saveSession(workspace, {
        sessionId: newSessionId,
        mode: modeName,
        backendType: sessionBackendType,
        createdAt: Date.now(),
      });

      // Record to global registry
      recordSession(modeName, manifest.displayName, workspace, sessionBackendType);

      // 4. Start file watcher
      startFileWatcher(workspace, manifest.viewer, (files) => {
        wsBridge.broadcastToSession(newSessionId, { type: "content_update", files });
      });

      // 5. Start history persistence
      historyInterval = setInterval(() => {
        const history = wsBridge.getMessageHistory(newSessionId);
        if (history.length > 0) saveHistory(workspace, history);
      }, 5_000);

      // 6. Send greeting (this is a fresh session post-continue)
      if (manifest.agent?.greeting) {
        wsBridge.injectGreeting(newSessionId, manifest.agent.greeting);
      }

      p.log.success("Continue Work: agent launched, session active");
    });
  }
}
```

- [ ] **Step 3: Handle agent exit in continue mode**

The `backend.onSessionExited` handler should also be registered inside the continue callback (it's created there). Copy the existing exit handler logic from the normal flow.

- [ ] **Step 4: Commit**

```bash
git add bin/pneuma.ts server/index.ts
git commit -m "feat: agent launch on Continue Work via server callback"
```

---

### Task 7: Clean Up + Integration Test

**Files:**
- Delete: `src/components/ReplayTimeline.tsx` (no-op stub)
- Modify: `src/App.tsx` (remove ReplayTimeline import)
- Modify: `src/replay-engine.ts` (ensure `loadReplay` works with new workspace model)

- [ ] **Step 1: Remove ReplayTimeline stub**

Delete `src/components/ReplayTimeline.tsx` and remove its import and usage from `src/App.tsx`.

- [ ] **Step 2: Verify replay-engine.ts compatibility**

The replay engine calls `/api/replay/checkout/:hash` which writes to `workspace/.pneuma/replay-checkout/`. With the new design, `workspace` is a real replay workspace, so this still works. No changes needed to replay-engine.ts.

However, ensure `checkoutCheckpoint` in `replay-engine.ts` works with the new workspace — the checkout endpoint in `server/index.ts` uses `workspace` variable which is the real replay workspace. This is correct.

- [ ] **Step 3: Update CLAUDE.md with new CLI flags**

Add `--replay-source <path>` to the CLI Flags table.

- [ ] **Step 4: Update design doc**

Update `docs/design/history-sharing-replay.md` Phase 3 and Phase 4 to reflect the two-phase session design instead of separate session types.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: clean up ReplayTimeline stub, update docs for two-phase replay design"
```

---

## Execution Order

```
Task 1: Server (replay-continue endpoint)      — foundation
Task 2: ViewerContract (readonly prop)          — independent, parallel with 1
Task 3: CLI (replay workspace + delayed launch) — depends on 1
Task 4: Frontend (readonly UI + Continue)       — depends on 1, 2
Task 5: Launcher (shadow-git detection)         — depends on 3
Task 6: Agent launch callback                   — depends on 1, 3
Task 7: Cleanup + integration                   — depends on all
```

Tasks 1 and 2 can run in parallel. Tasks 3-6 are sequential. Task 7 is final cleanup.

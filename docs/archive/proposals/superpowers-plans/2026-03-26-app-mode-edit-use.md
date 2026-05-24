# App Mode Edit/Use Switching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add edit/use mode switching to app-layout modes so GridBoard can serve as a daily-driver dashboard (use mode) with on-demand agent editing (edit mode).

**Architecture:** A `viewMode` state in session.json drives frontend rendering and agent lifecycle. Same server process, agent spawned/killed on demand via a new `/api/session/view-mode` endpoint. Frontend uses `interactionMode` prop to control viewer behavior. Launcher gains a "My Apps" section for use-mode sessions.

**Tech Stack:** Bun server (Hono), React 19 + Zustand 5, existing Claude Code backend lifecycle

**Spec:** `docs/superpowers/specs/2026-03-26-app-mode-edit-use-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `bin/pneuma-cli-helpers.ts` | Add `viewMode` to `PersistedSession` and `SessionRecord` types |
| `bin/pneuma.ts` | `--use-mode` CLI flag, conditional skill install + agent spawn |
| `server/index.ts` | `POST /api/session/view-mode` endpoint, `/api/config` returns viewMode, agent hot-launch/kill |
| `src/store/mode-slice.ts` | `viewMode` state + setter |
| `src/App.tsx` | App layout conditional rendering for use/edit modes |
| `src/components/AppModeToggle.tsx` | New: edit button (use mode) + done button (edit mode) |
| `core/types/viewer-contract.ts` | `interactionMode` in `ViewerPreviewProps` |
| `modes/gridboard/viewer/GridBoardPreview.tsx` | Consume `interactionMode` prop |
| `src/components/Launcher.tsx` | "My Apps" section, filtering, actions |
| `server/index.ts` (launcher routes) | `viewMode` + `layout` fields in session registry API |

---

### Task 1: Add viewMode to session types

**Files:**
- Modify: `bin/pneuma-cli-helpers.ts:5-21`

- [ ] **Step 1: Add viewMode to PersistedSession**

In `bin/pneuma-cli-helpers.ts`, add `viewMode` to the `PersistedSession` interface:

```typescript
export interface PersistedSession {
  sessionId: string;
  agentSessionId?: string;
  mode: string;
  backendType: AgentBackendType;
  createdAt: number;
  viewMode?: "edit" | "use";
}
```

- [ ] **Step 2: Add viewMode and layout to SessionRecord**

In the same file, extend `SessionRecord`:

```typescript
export interface SessionRecord {
  id: string;
  mode: string;
  displayName: string;
  sessionName?: string;
  workspace: string;
  backendType: AgentBackendType;
  lastAccessed: number;
  viewMode?: "edit" | "use";
  layout?: "editor" | "app";
}
```

- [ ] **Step 3: Run tests**

Run: `bun test`
Expected: All existing tests pass (type-only changes, no runtime behavior change).

- [ ] **Step 4: Commit**

```bash
git add bin/pneuma-cli-helpers.ts
git commit -m "feat(app-mode): add viewMode to PersistedSession and SessionRecord types"
```

---

### Task 2: Add interactionMode to ViewerPreviewProps

**Files:**
- Modify: `core/types/viewer-contract.ts:190-228`

- [ ] **Step 1: Add interactionMode to ViewerPreviewProps**

In `core/types/viewer-contract.ts`, add `interactionMode` to `ViewerPreviewProps` after the `readonly` field (line 227):

```typescript
  /** When true, viewer should suppress editing, selection, and annotation modes.
   *  Used during replay mode. Each mode implements its own readonly behavior. */
  readonly?: boolean;
  /** Interaction mode for app-layout edit/use switching.
   *  "full": all interactions enabled (edit mode, default)
   *  "view": Pneuma editing disabled (drag/resize/select), tile-internal interactions preserved (use mode) */
  interactionMode?: "full" | "view";
```

- [ ] **Step 2: Run tests**

Run: `bun test`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add core/types/viewer-contract.ts
git commit -m "feat(app-mode): add interactionMode to ViewerPreviewProps contract"
```

---

### Task 3: Add viewMode to frontend store

**Files:**
- Modify: `src/store/mode-slice.ts`

- [ ] **Step 1: Add viewMode state and setter to ModeSlice**

In `src/store/mode-slice.ts`, add to the `ModeSlice` interface:

```typescript
export interface ModeSlice {
  modeViewer: ViewerContract | null;
  modeDisplayName: string;
  modeCommands: ViewerCommandDescriptor[];
  initParams: Record<string, number | string>;
  layout: "editor" | "app";
  viewMode: "edit" | "use";

  setModeViewer: (viewer: ViewerContract) => void;
  setModeDisplayName: (name: string) => void;
  setModeCommands: (commands: ViewerCommandDescriptor[]) => void;
  setInitParams: (params: Record<string, number | string>) => void;
  setLayout: (layout: "editor" | "app") => void;
  setViewMode: (viewMode: "edit" | "use") => void;
}
```

Add the default and setter in `createModeSlice`:

```typescript
export const createModeSlice: StateCreator<AppState, [], [], ModeSlice> = (set) => ({
  modeViewer: null,
  modeDisplayName: "",
  modeCommands: [],
  initParams: {},
  layout: "editor",
  viewMode: "edit",

  // ...existing setters...
  setViewMode: (viewMode) => set({ viewMode }),
});
```

- [ ] **Step 2: Load viewMode from /api/config**

In `src/App.tsx`, find the `fetch(\`${getApiBase()}/api/config\`)` call (around line 257-263). Add `viewMode` to the response handling:

```typescript
    fetch(`${getApiBase()}/api/config`)
      .then((r) => r.json())
      .then((d) => {
        if (d.initParams) useStore.getState().setInitParams(d.initParams);
        if (d.layout) useStore.getState().setLayout(d.layout);
        if (d.viewMode) useStore.getState().setViewMode(d.viewMode);
      })
      .catch(() => { });
```

- [ ] **Step 3: Run tests**

Run: `bun test`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/store/mode-slice.ts src/App.tsx
git commit -m "feat(app-mode): add viewMode state to frontend store"
```

---

### Task 4: Server endpoint for viewMode switching

**Files:**
- Modify: `server/index.ts`
- Modify: `bin/pneuma.ts` (pass session helpers to server, register callback)

- [ ] **Step 1: Add viewMode to /api/config response**

In `server/index.ts`, find the `app.get("/api/config")` handler (around line 1086). Add a `viewMode` field. The server needs to know the current viewMode — read it from session.json on startup. Add to `ServerOptions`:

```typescript
export interface ServerOptions {
  // ...existing fields
  manifestProxy?: Record<string, ProxyRoute>;
  viewMode?: "edit" | "use";  // Initial view mode (from session.json or --use-mode flag)
}
```

Update the `/api/config` response:

```typescript
  app.get("/api/config", (c) => {
    return c.json({
      initParams: options.initParams || {},
      layout: options.layout || "editor",
      ...(options.window ? { window: options.window } : {}),
      replayMode: serverReplayMode,
      viewMode: currentViewMode,
    });
  });
```

Add a mutable `currentViewMode` variable after the proxy config section (alongside other mutable server state):

```typescript
  let currentViewMode: "edit" | "use" = options.viewMode ?? "edit";
```

- [ ] **Step 2: Add POST /api/session/view-mode endpoint**

Add this endpoint in the non-launcher section of `server/index.ts`, near the other session endpoints:

```typescript
  // ── View Mode switching (app layout only) ──────────────────────────────
  app.post("/api/session/view-mode", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const newMode = body.mode;
    if (newMode !== "edit" && newMode !== "use") {
      return c.json({ error: "mode must be 'edit' or 'use'" }, 400);
    }

    const oldMode = currentViewMode;
    currentViewMode = newMode;

    // Persist to session.json
    try {
      const sessionPath = join(workspace, ".pneuma", "session.json");
      if (existsSync(sessionPath)) {
        const session = JSON.parse(readFileSync(sessionPath, "utf-8"));
        session.viewMode = newMode;
        writeFileSync(sessionPath, JSON.stringify(session, null, 2));
      }
    } catch (err) {
      console.error("[server] Failed to persist viewMode:", err);
    }

    // Agent lifecycle: launch on edit, kill on use
    let agentStatus: "launched" | "killed" | "unchanged" = "unchanged";

    if (newMode === "edit" && oldMode === "use") {
      // Launch agent — trigger the deferred launch callback
      if (viewModeLaunchCallback) {
        try {
          await viewModeLaunchCallback();
          agentStatus = "launched";
        } catch (err) {
          console.error("[server] Failed to launch agent:", err);
          return c.json({ error: "Failed to launch agent" }, 500);
        }
      }
    } else if (newMode === "use" && oldMode === "edit") {
      // Kill agent — broadcast disconnect and let CLI handle cleanup
      wsBridge.broadcastToAllBrowsers({ type: "cli_disconnected" });
      agentStatus = "killed";
      // The actual process kill is handled by the CLI layer (bin/pneuma.ts)
      // via a kill callback registered at startup
      if (viewModeKillCallback) {
        try {
          await viewModeKillCallback();
        } catch (err) {
          console.error("[server] Failed to kill agent:", err);
        }
      }
    }

    console.log(`[server] View mode: ${oldMode} → ${newMode} (agent: ${agentStatus})`);
    return c.json({ ok: true, agentStatus });
  });
```

Add the callback variables near the top of the non-launcher section:

```typescript
  let viewModeLaunchCallback: (() => Promise<void>) | null = null;
  let viewModeKillCallback: (() => Promise<void>) | null = null;
```

Expose registration functions in the return value of `startServer`:

```typescript
  const onViewModeLaunch = (cb: () => Promise<void>) => { viewModeLaunchCallback = cb; };
  const onViewModeKill = (cb: () => Promise<void>) => { viewModeKillCallback = cb; };

  return { server, wsBridge, terminalManager, port: serverPort, modeMakerCleanup, onReplayContinue, onViewModeLaunch, onViewModeKill };
```

- [ ] **Step 3: Run tests**

Run: `bun test`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add server/index.ts
git commit -m "feat(app-mode): add /api/session/view-mode endpoint with agent lifecycle callbacks"
```

---

### Task 5: CLI --use-mode flag and agent lifecycle wiring

**Files:**
- Modify: `bin/pneuma.ts`
- Modify: `bin/pneuma-cli-helpers.ts` (parseCliArgs)

- [ ] **Step 1: Add --use-mode to CLI arg parsing**

In `bin/pneuma-cli-helpers.ts`, add `useMode` to `ParsedCliArgs`:

```typescript
export interface ParsedCliArgs {
  // ...existing fields
  sessionName: string;
  useMode: boolean;
}
```

In the `parseCliArgs` function, add parsing for `--use-mode` flag (follow the pattern of `--skip-skill`):

```typescript
  // Inside the for loop that processes args
  if (arg === "--use-mode") { result.useMode = true; continue; }
```

And set the default:

```typescript
  const result: ParsedCliArgs = {
    // ...existing defaults
    useMode: false,
  };
```

- [ ] **Step 2: Wire --use-mode in bin/pneuma.ts normal mode startup**

In `bin/pneuma.ts`, find the normal mode section (after replay mode handling, around line 1267). Read `useMode` from parsed args. When `useMode` is true:

1. Skip `installSkill` call
2. Skip agent backend launch
3. Set initial `viewMode: "use"` in session.json
4. Pass `viewMode: "use"` to `startServer`

Find the `startServer` call (around line 1124) and add `viewMode`:

```typescript
  const { server, wsBridge, port: actualPort, modeMakerCleanup, onReplayContinue, onViewModeLaunch, onViewModeKill } = startServer({
    // ...existing options
    viewMode: parsedArgs.useMode ? "use" : (existing?.viewMode ?? "edit"),
  });
```

After the `startServer` call, add conditional logic:

```typescript
  if (parsedArgs.useMode) {
    // Use mode — no agent, just server
    p.log.info("Use mode: dashboard only, no agent");

    // Register launch callback for when user switches to edit mode
    onViewModeLaunch(async () => {
      p.log.step("Switching to edit mode: installing skill and launching agent...");
      installSkill(workspace, manifest.skill, modeSourceDir, resolvedParams, manifest.viewerApi, backendType, manifest.proxy);
      const backend = createBackend(backendType, actualPort);
      // ... launch agent (same as normal mode launch code)
    });
  } else {
    // Edit mode — existing flow (install skill + launch agent)
    // ... existing code, but also register the kill callback:
    onViewModeKill(async () => {
      p.log.step("Switching to use mode: stopping agent...");
      backend.kill(session.sessionId);
    });
  }
```

Note: The exact launch/kill wiring depends on the existing code structure. The agent launch code in normal mode (around lines 1268-1410) should be extracted into a reusable function that both the initial startup and the viewMode launch callback can call. This refactoring is critical — do NOT duplicate the launch logic.

- [ ] **Step 3: Persist viewMode in recordSession**

In `bin/pneuma.ts`, find the `recordSession` function call sites. Update the `recordSession` function to accept and persist `viewMode` and `layout`:

```typescript
function recordSession(
  mode: string,
  displayName: string,
  workspace: string,
  backendType: AgentBackendType,
  sessionName?: string,
  viewMode?: "edit" | "use",
  layout?: "editor" | "app",
): void {
  const id = `${workspace}::${mode}`;
  const records = loadSessionsRegistry();
  const existing = records.findIndex((r) => r.id === id);
  const entry: SessionRecord = {
    id, mode, displayName, workspace, backendType,
    lastAccessed: Date.now(),
    ...(sessionName ? { sessionName } : {}),
    ...(viewMode ? { viewMode } : {}),
    ...(layout ? { layout } : {}),
  };
  // ...rest of existing logic
```

- [ ] **Step 4: Run tests**

Run: `bun test`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add bin/pneuma.ts bin/pneuma-cli-helpers.ts
git commit -m "feat(app-mode): --use-mode flag, conditional agent launch, viewMode persistence"
```

---

### Task 6: Frontend app layout rendering with viewMode

**Files:**
- Modify: `src/App.tsx:305-326`
- Create: `src/components/AppModeToggle.tsx`

- [ ] **Step 1: Create AppModeToggle component**

Create `src/components/AppModeToggle.tsx`:

```tsx
import { useState, useCallback } from "react";
import { useStore } from "../store.js";
import { getApiBase } from "../utils/api.js";

/**
 * AppModeToggle — floating buttons for edit/use mode switching.
 *
 * Use mode: semi-transparent edit button (bottom-right), hover to reveal.
 * Edit mode: "Done" button to return to use mode.
 */
export default function AppModeToggle() {
  const viewMode = useStore((s) => s.viewMode);
  const setViewMode = useStore((s) => s.setViewMode);
  const [switching, setSwitching] = useState(false);

  const switchMode = useCallback(async (newMode: "edit" | "use") => {
    setSwitching(true);
    try {
      const res = await fetch(`${getApiBase()}/api/session/view-mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: newMode }),
      });
      if (res.ok) {
        setViewMode(newMode);
      }
    } catch (err) {
      console.error("Failed to switch view mode:", err);
    } finally {
      setSwitching(false);
    }
  }, [setViewMode]);

  if (viewMode === "use") {
    // Semi-transparent edit button — hover reveals
    return (
      <button
        onClick={() => switchMode("edit")}
        disabled={switching}
        style={{
          position: "fixed", bottom: 20, right: 20, zIndex: 9999,
          width: 40, height: 40, borderRadius: 10,
          background: "rgba(249,115,22,0.15)", border: "1px solid rgba(249,115,22,0.3)",
          color: "#f97316", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          opacity: 0.4, transition: "opacity 0.2s, background 0.2s",
          backdropFilter: "blur(8px)",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.background = "rgba(249,115,22,0.25)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.4"; e.currentTarget.style.background = "rgba(249,115,22,0.15)"; }}
        title="Enter edit mode"
      >
        {switching ? (
          <div style={{ width: 16, height: 16, border: "2px solid rgba(249,115,22,0.3)", borderTopColor: "#f97316", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
          </svg>
        )}
      </button>
    );
  }

  // Edit mode: "Done" button
  return (
    <button
      onClick={() => switchMode("use")}
      disabled={switching}
      style={{
        position: "fixed", top: 16, right: 16, zIndex: 9999,
        height: 32, paddingLeft: 12, paddingRight: 12, borderRadius: 8,
        background: "rgba(249,115,22,0.9)", border: "none",
        color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600,
        display: "flex", alignItems: "center", gap: 6,
        transition: "background 0.2s",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(249,115,22,1)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(249,115,22,0.9)"; }}
      title="Back to dashboard"
    >
      {switching ? "Switching..." : "Done"}
    </button>
  );
}
```

- [ ] **Step 2: Update App.tsx app layout rendering**

In `src/App.tsx`, find the app layout block (lines 305-326). Replace it with viewMode-aware rendering:

```tsx
  if (layout === "app") {
    const isUseMode = viewMode === "use";
    return (
      <div className="h-screen w-screen bg-cc-bg text-cc-fg relative overflow-hidden">
        <div ref={previewRef} className="h-full w-full">
          {PreviewComponent ? (
            <PreviewComponent
              {...viewerProps}
              interactionMode={isUseMode ? "view" : "full"}
            />
          ) : (
            <LazyFallback />
          )}
        </div>
        {replayMode ? (
          <ReplayPlayer />
        ) : isUseMode ? (
          <Suspense fallback={null}>
            <AppModeToggle />
          </Suspense>
        ) : (
          <>
            <Suspense fallback={null}>
              <AgentBubble />
            </Suspense>
            <Suspense fallback={null}>
              <AppModeToggle />
            </Suspense>
          </>
        )}
      </div>
    );
  }
```

Add imports at the top of App.tsx:

```typescript
const AppModeToggle = lazy(() => import("./components/AppModeToggle.js"));
```

And add `viewMode` to the store subscriptions near line 296:

```typescript
  const viewMode = useStore((s) => s.viewMode);
```

- [ ] **Step 3: Run tests**

Run: `bun test`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/AppModeToggle.tsx src/App.tsx
git commit -m "feat(app-mode): app layout rendering with viewMode toggle"
```

---

### Task 7: GridBoard interactionMode support

**Files:**
- Modify: `modes/gridboard/viewer/GridBoardPreview.tsx`

- [ ] **Step 1: Accept and apply interactionMode prop**

In `GridBoardPreview.tsx`, find where `readonly` is destructured from props (around line 197). The function receives `ViewerPreviewProps`. Find the line that derives `onSelect` and `onNotifyAgent` from readonly:

```typescript
  // Existing (around line 199-201):
  const onSelect = readonly ? (() => {}) : rawOnSelect;
  const onNotifyAgent = readonly ? undefined : rawOnNotifyAgent;
```

Add `interactionMode` handling. When `interactionMode === "view"`: disable Pneuma editing (drag, resize, select, notifications, gallery) but keep tile-internal interactions alive. The key difference from `readonly` is that `readonly` also disables tile content interactions (for replay), while `interactionMode: "view"` only disables framework-level editing.

```typescript
  // Readonly mode: suppress ALL interactions (replay)
  // View mode: suppress Pneuma editing only, tiles still interactive
  const isViewMode = !readonly && interactionMode === "view";
  const editingDisabled = readonly || isViewMode;

  const onSelect = editingDisabled ? (() => {}) : rawOnSelect;
  const onNotifyAgent = editingDisabled ? undefined : rawOnNotifyAgent;
```

Then search for all places in the file that check `if (readonly) return;` for drag, resize, and tile management operations. Add `|| isViewMode` to each guard:

- Drag handlers: change `if (readonly) return;` to `if (editingDisabled) return;`
- Resize handlers: same
- Remove tile handler: same
- Gallery: hide when `editingDisabled`
- Grid lines: hide when `isViewMode`
- GridToolbar: hide when `isViewMode`

Important: do NOT change the `readonly` prop on `TileSlot` — tile-internal rendering should remain fully interactive in view mode. Only the framework-level editing chrome is disabled.

- [ ] **Step 2: Verify existing readonly behavior unchanged**

Check that replay mode still works: `readonly` should still disable everything including tile interactions. The new `editingDisabled` flag covers both `readonly` and `isViewMode`, but tile content rendering is only affected by `readonly` (passed to TileSlot).

- [ ] **Step 3: Run tests**

Run: `bun test`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add modes/gridboard/viewer/GridBoardPreview.tsx
git commit -m "feat(app-mode): GridBoard interactionMode support for use/edit mode"
```

---

### Task 8: Launcher "My Apps" section

**Files:**
- Modify: `server/index.ts` (launcher routes — /api/sessions response)
- Modify: `src/components/Launcher.tsx`

- [ ] **Step 1: Include viewMode and layout in session registry API**

In `server/index.ts`, find the launcher's `GET /api/sessions` handler. The response already returns session records. Update the `recordSession` calls in `bin/pneuma.ts` to include `viewMode` and `layout` (already done in Task 5). The API response already serializes the full `SessionRecord`, so `viewMode` and `layout` will be included automatically once they're in the records.

- [ ] **Step 2: Add "My Apps" section to Launcher.tsx**

In `src/components/Launcher.tsx`, find where sessions are rendered (the "Recent Sessions" section). Add a "My Apps" section above it that filters for `layout === "app" && viewMode === "use"`:

The Launcher component receives sessions from the `/api/sessions` API. Add filtering logic:

```typescript
const appSessions = sessions.filter(s => s.layout === "app" && s.viewMode === "use");
const recentSessions = sessions.filter(s => !(s.layout === "app" && s.viewMode === "use"));
```

Render "My Apps" section before "Recent Sessions" with:
- Session name + mode display name
- Status indicator (check if server is running by pinging its port)
- [Open] button — opens the session URL
- [Edit] button — sends `POST /api/session/view-mode { mode: "edit" }` to the session's server, then opens

The exact UI implementation should follow the existing Launcher design patterns (card layout, hover effects, etc.). Read the current Launcher.tsx to match the style precisely.

- [ ] **Step 3: Add auto-start for use-mode sessions**

In the launcher startup flow (`server/index.ts`, launcher mode block), after the server starts, scan `sessions.json` for use-mode app sessions and auto-start them:

```typescript
// Auto-start use-mode app sessions
if (options.launcherMode) {
  const sessions = loadSessionsRegistry();
  const appSessions = sessions.filter(s => s.layout === "app" && s.viewMode === "use");
  for (const session of appSessions) {
    if (!existsSync(session.workspace)) continue;
    // Spawn: pneuma <mode> --workspace <path> --use-mode --no-open --port auto
    // Use the same child process spawning mechanism as /api/launch
    console.log(`[launcher] Auto-starting app: ${session.displayName} (${session.workspace})`);
    // ... spawn child process
  }
}
```

The exact spawning code should reuse the existing `/api/launch` mechanism (Bun.spawn with the pneuma CLI).

- [ ] **Step 4: Run tests**

Run: `bun test`
Expected: All tests pass.

- [ ] **Step 5: Manual verification**

1. Start `bun run dev gridboard` → edit mode works as before
2. Click "Done" → switches to use mode (agent killed, edit chrome hidden)
3. Click edit button (bottom-right) → switches back to edit mode (agent launched)
4. Tiles remain interactive in use mode (todo checkboxes, etc.)
5. Close and restart with `--use-mode` → starts in use mode directly
6. Launcher shows "My Apps" section for use-mode sessions

- [ ] **Step 6: Commit**

```bash
git add server/index.ts src/components/Launcher.tsx
git commit -m "feat(app-mode): launcher My Apps section with auto-start"
```

---

### Task 9: Update documentation

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add app mode docs**

In `CLAUDE.md`, add to the CLI Flags table:

```markdown
| `--use-mode` | Start in use mode (no agent, dashboard only) |
```

Add to Server API Reference:

```markdown
### View Mode (app layout)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/session/view-mode` | Switch between edit/use mode (launches/kills agent) |
```

Add to Known Gotchas:

```markdown
- **App mode viewMode**: `viewMode` is only meaningful for `layout: "app"` modes. Editor-layout modes ignore it. The viewMode is persisted in both `.pneuma/session.json` and `~/.pneuma/sessions.json`.
- **Use mode agent lifecycle**: In use mode, no agent process runs. Switching to edit mode triggers a full agent launch (skill install + spawn). Switching back kills the agent. The server process stays alive throughout.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add app mode edit/use switching to CLAUDE.md"
```

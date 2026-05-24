# App Mode: Edit/Use Mode Switching

> App-layout modes gain two runtime states — "use mode" for daily dashboard consumption, "edit mode" for agent-assisted creation. Same server process, agent launched on demand.

## Problem

App-layout modes (like GridBoard) currently always start with a full agent session. But the daily use case is "glance at my dashboard" — no editing needed. Running a full agent process for read-only viewing wastes resources and adds unnecessary UI clutter (agent bubble, grid lines, drag handles).

## Solution

Add a `viewMode` state to app-layout sessions that switches between two runtime modes within the same server process:

- **Use mode** — viewer fullscreen, no agent, no editing UI, tile interactions preserved
- **Edit mode** — full Pneuma experience, agent bubble, drag/resize/gallery

The Launcher manages app sessions separately: auto-starts use-mode sessions on launch, provides a "My Apps" section for quick access.

---

## Core State Model

### Single Server, Agent On Demand

One workspace = one server process. The agent is an optional component inside it, not a separate process type.

```
┌─────────────────────────────────────────────┐
│  Server Process (Hono + proxy + file watch) │
│                                             │
│  Use Mode ◄──────────────► Edit Mode        │
│  - Viewer fullscreen        - Viewer + Agent│
│  - No agent process         - Agent running │
│  - Tile interactions only   - Full editing  │
└─────────────────────────────────────────────┘
```

### State Persistence

`.pneuma/session.json` gains a `viewMode` field:

```typescript
interface PersistedSession {
  sessionId: string;
  agentSessionId?: string;
  mode: string;
  backendType: AgentBackendType;
  createdAt: number;
  viewMode?: "edit" | "use";  // Only meaningful for layout:"app" modes
}
```

Default is `"edit"` (existing behavior unchanged).

### Switching Flow

**Use to Edit:**
1. Frontend sends `POST /api/session/view-mode` with `{ mode: "edit" }`
2. Server persists `viewMode: "edit"` to session.json
3. Server launches agent process (reuses deferred-launch mechanism from replay mode)
4. Server updates session registry (`~/.pneuma/sessions.json`)
5. Frontend transitions to edit UI (agent bubble appears, grid lines fade in)

**Edit to Use:**
1. Frontend sends `POST /api/session/view-mode` with `{ mode: "use" }`
2. Server kills agent process
3. Server persists `viewMode: "use"` to session.json
4. Server updates session registry
5. Frontend transitions to use UI (agent bubble disappears, edit chrome fades out)

---

## Frontend Architecture

### Layer Separation

The viewMode switch lives in **App.tsx** (Pneuma runtime shell), not inside any viewer. Viewers receive a derived `interactionMode` prop and know nothing about edit/use concepts.

```
┌─ App.tsx (Pneuma Runtime Shell) ─────────────────┐
│                                                    │
│  viewMode state + toggle UI + agent lifecycle      │
│                                                    │
│  ┌─ Viewer ──────────────────────────────────┐    │
│  │  Receives: interactionMode: "full" | "view"│    │
│  │  "view": no drag/resize/select, tiles OK   │    │
│  │  "full": everything enabled                 │    │
│  └────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────┘
```

### interactionMode vs readonly

| Prop | Purpose | Tile interactions | Drag/resize | Agent notifications |
|------|---------|-------------------|-------------|---------------------|
| `readonly` | Replay mode | Disabled | Disabled | Disabled |
| `interactionMode: "view"` | Use mode | **Enabled** | Disabled | Disabled |
| `interactionMode: "full"` | Edit mode | Enabled | Enabled | Enabled |

`readonly` remains for replay. `interactionMode` is the new prop for edit/use distinction.

### Rendering Rules

```
layout === "app" && viewMode === "use"
  → Viewer fullscreen + hover-reveal edit button (bottom-right)
  → Viewer receives interactionMode="view"
  → No AgentBubble, no toolbar, no grid lines

layout === "app" && viewMode === "edit"
  → Viewer fullscreen + AgentBubble + "Done" button
  → Viewer receives interactionMode="full"
  → Full editing experience (current behavior)

layout === "editor"
  → Dual-panel layout (unchanged, viewMode ignored)
```

### UI Elements

**Use mode:** A small edit button in the bottom-right corner. Semi-transparent by default, becomes opaque on hover. Minimal Pneuma branding — one icon, no text.

**Edit mode:** The existing agent bubble UI, plus a "Done" button (in the agent bubble area or as a floating button) to return to use mode.

**Transitions:** Agent bubble expand/collapse animation on mode switch. Grid lines and drag handles fade in/out.

---

## Server Changes

### New API Endpoint

```
POST /api/session/view-mode
Body: { mode: "edit" | "use" }
Response: { ok: true, agentStatus: "launched" | "killed" }
```

Handles:
- Persisting viewMode to `.pneuma/session.json`
- Updating `~/.pneuma/sessions.json` registry
- Launching or killing the agent process

### Agent Hot-Switch

The mechanism for launching an agent mid-session already exists (replay mode's "Continue Work" flow):
- Server holds a `backendType` and launch config from startup
- On `mode: "edit"` request, call `backend.launch(...)` with existing workspace/session info
- On `mode: "use"` request, call `backend.kill(sessionId)`

No new process management code needed — reuse the deferred launch pattern.

### CLI Flag: --use-mode

```bash
# Use mode (lightweight, no agent)
pneuma gridboard --workspace ~/dashboard --use-mode --no-open

# Edit mode (full, current behavior)
pneuma gridboard --workspace ~/dashboard
```

`--use-mode` skips:
- Skill installation (`installSkill` — already installed from previous edit session)
- Agent process spawn
- Greeting message

Does NOT skip:
- Server startup (proxy, file watch, content serving all needed)
- Proxy config loading (tiles fetch data in use mode)
- Frontend serving (Vite dev or dist)

---

## Launcher Integration

### Session Registry Extension

`~/.pneuma/sessions.json` records gain:

```typescript
interface SessionRecord {
  // ...existing fields
  viewMode?: "edit" | "use";
  layout?: "editor" | "app";
}
```

Updated whenever viewMode changes (via the `/api/session/view-mode` endpoint).

### Launcher UI: "My Apps" Section

```
┌─ Launcher ──────────────────────────────────┐
│                                              │
│  ── My Apps ──────────────────────────────   │
│  [Home Dashboard]  Running  [Open] [Edit]    │
│  [Work Monitor]    Stopped  [Start] [Edit]   │
│                                              │
│  ── Recent Sessions ─────────────────────    │
│  (existing, shows non-app sessions)          │
│                                              │
│  ── Built-in Modes ──────────────────────    │
│  (existing)                                  │
└──────────────────────────────────────────────┘
```

**Filtering:**
- My Apps: `layout === "app" && viewMode === "use"`
- Recent Sessions: everything else

**Actions:**
- [Open] — navigate to session URL (server already running)
- [Edit] — send `POST /api/session/view-mode { mode: "edit" }`, then open
- [Start] — spawn `pneuma <mode> --workspace <path> --use-mode --no-open`
- [Stop] — kill the server process

### Auto-Start on Launcher Launch

When the launcher starts (CLI `pneuma` with no args, or Electron app launch):

1. Scan `sessions.json` for `viewMode === "use"` entries
2. For each, check if workspace still exists
3. Spawn `pneuma <mode> --workspace <path> --use-mode --no-open --port <auto>`
4. Mark as "Running" in launcher UI

This gives the "persistent desktop widgets" experience — open Pneuma and your dashboards are already running.

---

## Scope and Applicability

This feature applies to **all modes with `layout: "app"`**. Currently only GridBoard uses app layout, but any future app-layout mode (e.g., a Remotion player, a drawing canvas) automatically gains edit/use switching.

Modes with `layout: "editor"` are unaffected — they always run in edit mode with the dual-panel layout.

---

## Changes Summary

| Layer | File(s) | Change |
|-------|---------|--------|
| **Types** | `bin/pneuma-cli-helpers.ts` | `viewMode` field on `PersistedSession` |
| **CLI** | `bin/pneuma.ts` | `--use-mode` flag, skip skill install + agent spawn |
| **Server** | `server/index.ts` | `POST /api/session/view-mode` endpoint, `/api/config` returns viewMode |
| **Server** | `server/index.ts` | Agent hot-launch/kill on viewMode switch (reuse replay continue pattern) |
| **Store** | `src/store/mode-slice.ts` | `viewMode` state + setter |
| **App** | `src/App.tsx` | App layout conditional rendering for use/edit modes |
| **Component** | `src/components/AppModeToggle.tsx` | New — edit button (use mode) + done button (edit mode) |
| **Viewer** | `modes/gridboard/viewer/GridBoardPreview.tsx` | `interactionMode: "full" \| "view"` prop |
| **Viewer contract** | `core/types/viewer-contract.ts` | `interactionMode` in ViewerPreviewProps |
| **Launcher** | `src/components/Launcher.tsx` | "My Apps" section, auto-start logic |
| **Launcher** | `server/index.ts` (launcher routes) | Session registry with viewMode/layout fields |

## Out of Scope

- Electron widget-mode windows (frameless, transparent, always-on-top) — future enhancement
- Per-tile interaction config (some tiles view-only in use mode) — not needed now
- Multi-window (pop out individual tiles) — future enhancement
- System data sources (CPU, memory, filesystem) — proxy mechanism already covers this extensibility

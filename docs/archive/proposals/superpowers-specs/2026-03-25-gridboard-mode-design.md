# GridBoard Mode — Design Spec

**Date:** 2026-03-25
**Status:** Draft

## Overview

GridBoard is a dashboard editor mode for Pneuma. Users collaborate with an Agent to create, configure, and arrange Tile components on a fixed-size grid canvas. The final output is an exportable standalone webpage — a personal dashboard that fetches data and refreshes autonomously.

**Formula:** Editor layout (viewer preview + chat) → build board → export standalone page

## Terminology

| Term | Definition |
|------|-----------|
| **Board** | Fixed-pixel canvas divided into a grid. One board per workspace. |
| **Tile** | A registered React component rendered in a grid cell. Has metadata, size constraints, optional data source, and lifecycle state. |
| **Gallery** | Sidebar panel listing all available/disabled tiles for placement onto the board. |
| **Cell** | One grid unit. Tiles occupy integer multiples of cells. |

## Data Model

### File Structure

```
workspace/
├── board.json              ← Grid config + tile registry (layout, state)
├── theme.css               ← Global theme (CSS custom properties)
└── tiles/
    └── <tile-id>/
        ├── Tile.tsx         ← defineTile() standard component
        └── ...              ← Optional supporting files (assets, helpers)
```

### board.json

```json
{
  "board": {
    "width": 800,
    "height": 800,
    "columns": 8,
    "rows": 8
  },
  "tiles": {
    "weather": {
      "label": "Weather",
      "component": "tiles/weather/Tile.tsx",
      "status": "active",
      "position": { "col": 0, "row": 0 },
      "size": { "cols": 2, "rows": 2 }
    },
    "todo": {
      "label": "Todo List",
      "component": "tiles/todo/Tile.tsx",
      "status": "disabled",
      "position": { "col": 4, "row": 0 },
      "size": { "cols": 2, "rows": 4 }
    },
    "pomodoro": {
      "label": "Pomodoro Timer",
      "component": "tiles/pomodoro/Tile.tsx",
      "status": "available"
    }
  }
}
```

**Rules:**
- `position` and `size` use grid units (not pixels). Viewer computes pixel placement from board dimensions.
- `status: "available"` tiles have no `position` or `size` (not yet placed).
- `status: "disabled"` tiles retain `position`/`size` for easy re-enable.
- Board pixel dimensions are configurable at init. Range: 400–1600px per axis, 4–16 columns/rows.

### theme.css

Global CSS custom properties that all tiles inherit. Penetrates Shadow DOM boundaries.

```css
:root {
  --board-bg: #0a0a0a;
  --tile-bg: #18181b;
  --tile-border: #27272a;
  --tile-radius: 12px;
  --tile-padding: 16px;
  --text-primary: #fafafa;
  --text-secondary: #a1a1aa;
  --text-muted: #52525b;
  --accent: #f97316;
  --font-family: "Inter", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", monospace;
}
```

Agent should use these variables when creating tiles. The skill includes the full variable list.

## Tile Protocol

### defineTile()

Each tile exports a `defineTile()` call as its default export. This factory function standardizes the contract:

```tsx
import { defineTile } from "gridboard";

export default defineTile({
  // ── Metadata (readable without instantiation, used by Gallery)
  label: "Weather",
  description: "Real-time weather with 3-day forecast",

  // ── Size constraints (grid units)
  minSize: { cols: 2, rows: 2 },
  maxSize: { cols: 4, rows: 4 },

  // ── Data source (optional — tiles without external data omit this)
  dataSource: {
    refreshInterval: 300, // seconds; runtime enforces minimum 30s
    async fetch(ctx) {
      // ctx.signal  — AbortSignal (cancelled on unmount/refresh)
      // ctx.params  — user-configurable parameters
      const res = await fetch(
        `https://api.weather.com?city=${ctx.params.city}`,
        { signal: ctx.signal }
      );
      return res.json();
    },
  },

  // ── Configurable parameters (serialized to board.json on change)
  params: {
    city: { type: "string", default: "Tokyo", label: "City" },
  },

  // ── Render
  render({ data, width, height, loading, error }) {
    if (loading) return <div className="animate-pulse">Loading...</div>;
    if (error) return <div className="text-red-400">{error.message}</div>;
    return (
      <div style={{ padding: "var(--tile-padding)" }}>
        <h3 style={{ color: "var(--text-secondary)", fontSize: 12 }}>{data.city}</h3>
        <span style={{ color: "var(--text-primary)", fontSize: 36 }}>{data.temp}°</span>
      </div>
    );
  },
});
```

### TileProps Interface

```ts
interface TileRenderProps {
  data: unknown;          // Latest fetch result (null before first fetch)
  width: number;          // Current pixel width
  height: number;         // Current pixel height
  loading: boolean;       // True during fetch
  error: Error | null;    // Last fetch error (null if OK)
}

interface TileFetchContext {
  signal: AbortSignal;
  params: Record<string, unknown>;
}

interface TileSizeConstraint {
  cols: number;
  rows: number;
}

interface TileParamDescriptor {
  type: "string" | "number" | "boolean";
  default: unknown;
  label: string;
}

interface TileDefinition {
  label: string;
  description: string;
  minSize: TileSizeConstraint;
  maxSize: TileSizeConstraint;
  dataSource?: {
    refreshInterval: number;
    fetch: (ctx: TileFetchContext) => Promise<unknown>;
  };
  params?: Record<string, TileParamDescriptor>;
  render: (props: TileRenderProps) => React.ReactNode;
}
```

### Tile Lifecycle

```
available  →  active  →  disabled  →  active (re-enable)
                ↓
            deleted (removed from board.json + files)
```

- **available**: Registered in board.json, no position. Visible in Gallery.
- **active**: Placed on board, rendered and data-refreshing.
- **disabled**: Hidden from board, retains layout config. Visible in Gallery.
- **deleted**: Removed entirely from board.json. Tile files may optionally be kept on disk.

## Tile Rendering

### Shadow DOM Isolation

Each active tile is rendered inside a Shadow DOM container:

```
<div class="tile-slot" data-tile-id="weather" style="grid position...">
  <!-- resize handles, selection frame, overlay (light DOM) -->
  #shadow-root (open)
    <style>/* theme.css variables + tile scoped styles */</style>
    <TileComponent ... />  <!-- React portal into shadow root -->
</div>
```

**Why Shadow DOM:**
- CSS isolation between tiles (no class name collisions)
- CSS custom properties from theme.css penetrate shadow boundary
- Agent writes styles freely without worrying about conflicts
- JS is not isolated (same page context) — tiles can fetch freely

### Compilation Pipeline

```
Agent modifies tiles/weather/Tile.tsx
  → chokidar detects change
  → Server triggers Bun.build() → .build/<tileId>.js
  → content_update pushed to browser
  → Viewer dynamic import() of new module, replaces tile render
```

The `.build/` directory is gitignored. Compilation happens server-side on every watched file change.

### Overlay States

A tile can show an overlay in these situations:

| State | Visual | Trigger | Exit |
|-------|--------|---------|------|
| **Resizing** | Semi-transparent mask + "Resizing..." spinner | User completes resize drag | Agent finishes rewrite, or user cancels in chat |
| **Compiling** | Brief flash indicator | File change detected | Compilation + hot-reload complete |
| **Error** | Red border + error message | Bun.build failure or runtime error | Agent fixes the code |

## Viewer Design

### Layout

Editor layout (`layout: "editor"`). Left panel = Board preview. Right panel = Chat / Editor / Terminal.

### Board Canvas

- Fixed pixel dimensions from `board.json`
- Centered in viewer panel; scrolls if board exceeds viewport
- Grid lines rendered at low opacity (toggleable via toolbar)
- Background color from `--board-bg`

### Toolbar (bottom of viewer panel)

| Button | Action |
|--------|--------|
| Gallery | Toggle gallery sidebar |
| Grid Lines | Toggle grid overlay visibility |
| Board Settings | Edit board dimensions (triggers re-layout) |

### Interaction Modes

**Idle — Browsing**
- Tiles render normally; internal interactions work (scrollable lists, clickable links)
- Hover tile → floating action buttons appear at top-right corner (⚙ configure / ⏸ disable / ✕ remove)

**Selected — Click tile border or title area**
- Blue selection frame with resize handles (4 edges + 4 corners)
- Sends `<viewer-context>` to Agent with tile metadata
- User can issue chat commands referencing "this tile"

**Drag Move — Hold tile title bar**
- Ghost preview follows cursor, snapping to grid
- Grid guide lines highlight target position
- Overlap detection: red border if target conflicts with another tile
- Drop → snap to nearest valid grid position
- **Pure frontend operation** — updates `position` in board.json directly

**Drag Resize — Pull resize handle**
- Visual preview of new grid size (cols × rows label)
- Constrained by `minSize` / `maxSize` from tile definition
- Cannot overlap other tiles
- Drop → snap to grid → tile enters **resizing overlay**
- Sends viewer notification to Agent: `{ type: "tile_resized", tileId, oldSize, newSize }`
- Agent rewrites component for new dimensions → file change → compile → overlay clears
- User cancels in chat → overlay clears immediately, content left as-is

**Gallery — Sidebar drawer**
- Lists all `available` + `disabled` tiles
- Each entry shows: label, description, minSize badge
- Drag tile from Gallery onto Board → place at drop position → status becomes `active`
- Or click "+" → auto-place at first gap that fits `minSize`
- "Create Tile" button at top → sends command notification to Agent

### viewer-context

**Tile selected:**
```xml
<viewer-context mode="gridboard" tile="weather" size="2x2" status="active">
Tile: Weather (2×2 at col 0, row 0)
Component: tiles/weather/Tile.tsx
Data source: refreshInterval 300s
Params: { city: "Tokyo" }
Description: Real-time weather with 3-day forecast
</viewer-context>
```

**No selection (board overview):**
```xml
<viewer-context mode="gridboard">
Board: 800×800, 8×8 grid
Active tiles: weather (2×2), news-feed (4×3), todo (2×4)
Disabled: pomodoro
Available: clock, calendar
Empty cells: 28/64
</viewer-context>
```

### Viewer Actions (Agent → Viewer)

| Action | Params | Purpose |
|--------|--------|---------|
| `navigate-to` | `{ tileId: string }` | Scroll to and select a tile |
| `open-gallery` | `{}` | Open the gallery sidebar |
| `place-tile` | `{ tileId, col, row }` | Place a tile at a specific grid position |
| `remove-tile` | `{ tileId }` | Remove tile from board (→ available) |

### Viewer Commands (User → Agent)

| Command | Trigger | Effect |
|---------|---------|--------|
| `Create Tile` | Gallery "New" button or toolbar | Notify Agent that user wants a new tile |
| `Configure` | Tile hover ⚙ button | Notify Agent to adjust tile's params or appearance |

### Viewer Notifications (Viewer → Agent, proactive)

| Notification | When | Payload |
|--------------|------|---------|
| `tile_resized` | User completes resize drag | `{ tileId, oldSize: {cols,rows}, newSize: {cols,rows} }` |
| `tile_moved` | User completes drag move | `{ tileId, oldPosition: {col,row}, newPosition: {col,row} }` |
| `tile_status_changed` | User enables/disables/removes via UI | `{ tileId, oldStatus, newStatus }` |

## ModeManifest

```ts
export const manifest: ModeManifest = {
  name: "gridboard",
  displayName: "GridBoard",
  version: "0.1.0",
  description: "Interactive dashboard builder with draggable tile grid",

  layout: "editor",

  skill: {
    sourceDir: "skill",
    installName: "gridboard",
    claudeMdSection: "GridBoard Mode",
  },

  viewer: {
    watchPatterns: [
      "board.json",
      "theme.css",
      "tiles/**/Tile.tsx",
      "tiles/**/*.{ts,tsx,css}",
    ],
    ignorePatterns: [
      "node_modules", ".git", ".claude", ".pneuma", ".build",
    ],
    serveDir: ".",
  },

  viewerApi: {
    workspace: { type: "single" },
    actions: [
      {
        id: "navigate-to",
        label: "Focus tile",
        category: "navigation",
        params: [{ name: "tileId", type: "string", required: true }],
      },
      {
        id: "open-gallery",
        label: "Open tile gallery",
        category: "navigation",
        params: [],
      },
      {
        id: "place-tile",
        label: "Place tile on board",
        category: "layout",
        params: [
          { name: "tileId", type: "string", required: true },
          { name: "col", type: "number", required: true },
          { name: "row", type: "number", required: true },
        ],
      },
      {
        id: "remove-tile",
        label: "Remove tile from board",
        category: "layout",
        params: [{ name: "tileId", type: "string", required: true }],
      },
    ],
    commands: [
      { id: "create-tile", label: "Create Tile" },
      { id: "configure-tile", label: "Configure Tile" },
    ],
    locatorDescription: "Tiles are identified by tileId from board.json",
  },

  agent: {
    permissionMode: "bypassPermissions",
    greeting:
      "What kind of dashboard would you like to build? Describe the tiles you want — I'll create the components and lay them out on the grid.",
  },

  init: {
    contentCheckPattern: "board.json",
    seedFiles: ["default"],
    params: [
      { key: "boardWidth", label: "Board Width (px)", type: "number", default: 800 },
      { key: "boardHeight", label: "Board Height (px)", type: "number", default: 800 },
      { key: "columns", label: "Grid Columns", type: "number", default: 8 },
      { key: "rows", label: "Grid Rows", type: "number", default: 8 },
    ],
  },
};
```

## Skill Design

### SKILL.md Contents

The skill prompt injected into CLAUDE.md should cover:

1. **defineTile() API** — Full type signature, required fields, optional fields
2. **Theme variables** — Complete list from theme.css; agent must use these
3. **board.json schema** — Field descriptions, status lifecycle
4. **Size inference guidelines** — Heuristics for choosing tile dimensions:
   - News/feed → wide (4×3 or wider)
   - Clock/metric → small square (2×2)
   - List/todo → narrow tall (2×4)
   - Chart/graph → medium square (3×3 or 4×3)
5. **Resize adaptation rules** — When a tile is resized, content should meaningfully adapt (more items in a list, larger chart, additional data columns), not just scale
6. **Built-in tile references** — Point to seed tiles as canonical examples
7. **File conventions** — One directory per tile, default export from Tile.tsx, supporting files co-located

### Skill References

Include the built-in seed tiles as reference files so the Agent can study them as examples of correct `defineTile()` usage.

## Seed Templates

One default seed: a starter board with 3–4 example tiles demonstrating different patterns.

### default/

```
board.json          ← Pre-configured 800×800 / 8×8 board with example tiles
theme.css           ← Default dark theme
tiles/
  clock/Tile.tsx    ← 2×2, no dataSource, static render (time via setInterval)
  weather/Tile.tsx  ← 3×2, fetch API + refreshInterval
  todo/Tile.tsx     ← 2×4, local state with interaction (checkbox toggle)
  rss-feed/Tile.tsx ← 4×3, fetch + scrollable list
```

These serve dual purposes:
- **User**: See a working board immediately, understand what's possible
- **Agent**: Reference implementations of the `defineTile()` contract

## Export (Extension Point)

Export is deferred to a future iteration. The design reserves:

- Server route: `GET /export/gridboard` — preview, `GET /export/gridboard/download` — download
- Target output: self-contained HTML page with:
  - Compiled tile JS bundle (all active tiles)
  - Data refresh runtime (scheduler, abort management)
  - theme.css inlined
  - board.json layout data inlined
  - Zero dependency on Pneuma runtime
- Packaging strategy TBD (single HTML vs. HTML + assets zip)

## Open Questions

1. **Tile params editing UI** — Should the viewer provide a built-in params form (from `params` declaration), or always delegate to Agent via chat? A built-in form is more immediate; chat is more flexible.
2. **Tile-to-tile communication** — Should tiles be fully isolated, or is there a shared state bus? Current design assumes full isolation. Cross-tile data (e.g., a filter tile controlling other tiles) would require a future protocol extension.
3. **Export format details** — Single HTML vs. HTML+JS bundle vs. deployable static site. Depends on tile complexity and asset needs.

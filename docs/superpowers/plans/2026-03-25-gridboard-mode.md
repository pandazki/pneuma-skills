# GridBoard Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a GridBoard mode — a dashboard editor with a draggable tile grid, `defineTile()` protocol, Shadow DOM isolation, and browser-based JIT compilation of tile TSX components.

**Architecture:** Tiles are React TSX components authored via `defineTile()` factory. The viewer renders them on a fixed-pixel grid with Shadow DOM isolation and shared theme CSS variables. Tile compilation uses browser-side Babel JIT (same pattern as Remotion mode). Board layout persists in `board.json`; tile components live in `tiles/<id>/Tile.tsx`.

**Tech Stack:** React 19, Bun, @babel/standalone (browser JIT), Shadow DOM, CSS custom properties

**Spec:** `docs/superpowers/specs/2026-03-25-gridboard-mode-design.md`

---

## File Structure

```
modes/gridboard/
├── manifest.ts                    # ModeManifest declaration
├── pneuma-mode.ts                 # ModeDefinition (manifest + viewer contract)
├── viewer/
│   ├── GridBoardPreview.tsx        # Main viewer component
│   ├── tile-compiler.ts           # Pure JIT compiler (Babel-based, like remotion-compiler.ts)
│   ├── use-tile-compiler.ts       # React hook wrapping tile-compiler
│   ├── TileSlot.tsx               # Single tile container (Shadow DOM, overlay states)
│   ├── TileGallery.tsx            # Gallery sidebar (available/disabled tiles)
│   ├── GridToolbar.tsx            # Bottom toolbar (gallery toggle, grid lines, settings)
│   └── scaffold.ts               # Seed file generator
├── skill/
│   └── SKILL.md                   # Agent skill prompt
└── seed/
    └── default/
        ├── board.json             # Starter board config
        ├── theme.css              # Default dark theme
        └── tiles/
            ├── clock/Tile.tsx     # 2×2 static tile (no data source)
            ├── weather/Tile.tsx   # 3×2 fetch + refresh tile
            └── todo/Tile.tsx      # 2×4 interactive local-state tile
```

**Modified files:**
- `core/mode-loader.ts` — add gridboard to builtin registry
- `package.json` — add @babel/standalone dependency (already present for Remotion)

---

### Task 1: Mode Skeleton — manifest.ts + mode-loader registration

**Files:**
- Create: `modes/gridboard/manifest.ts`
- Modify: `core/mode-loader.ts:35-92`

- [ ] **Step 1: Create manifest.ts**

```typescript
// modes/gridboard/manifest.ts
import type { ModeManifest } from "../../core/types/mode-manifest.js";

const gridboardManifest: ModeManifest = {
  name: "gridboard",
  version: "0.1.0",
  displayName: "GridBoard",
  description: "Interactive dashboard builder with draggable tile grid",
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="4" rx="1"/><rect x="14" y="11" width="7" height="10" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>`,

  skill: {
    sourceDir: "skill",
    installName: "pneuma-gridboard",
    claudeMdSection: `## Pneuma GridBoard Mode

You are running inside **Pneuma**, a co-creation workspace where you and the user build dashboards together — you write tile components, the user sees live results in a browser preview panel.

This is **GridBoard Mode**: interactive dashboard building with a snapping tile grid.

For the defineTile() API, theme variables, board.json schema, and tile sizing guidelines, consult the \`pneuma-gridboard\` skill.

### Architecture
- \`board.json\` — Grid configuration + tile registry (layout, status, sizing)
- \`theme.css\` — Global theme via CSS custom properties (all tiles inherit)
- \`tiles/<id>/Tile.tsx\` — Each tile is a React component using \`defineTile()\`
- Grid: {{columns}}×{{rows}} cells on a {{boardWidth}}×{{boardHeight}}px canvas

### Core Rules
- Every tile MUST use \`defineTile()\` from the gridboard runtime — see skill for full API
- Use theme CSS variables (\`var(--tile-bg)\`, \`var(--text-primary)\`, etc.) for visual consistency
- Always update \`board.json\` when adding/removing/moving tiles
- When creating a new tile: create directory \`tiles/<id>/\`, write \`Tile.tsx\`, register in \`board.json\`
- Size tiles appropriately: news → wide (4×3+), clocks → small square (2×2), lists → narrow tall (2×4)
- On resize notification: adapt content meaningfully (more items, larger charts), not just CSS scale
- Do not modify \`.claude/\` or \`.pneuma/\` directories`,
  },

  viewer: {
    watchPatterns: [
      "board.json",
      "theme.css",
      "tiles/**/*.tsx",
      "tiles/**/*.ts",
      "tiles/**/*.css",
    ],
    ignorePatterns: [
      "node_modules/**",
      ".git/**",
      ".claude/**",
      ".pneuma/**",
    ],
    serveDir: ".",
  },

  viewerApi: {
    workspace: {
      type: "all",
      multiFile: true,
      ordered: false,
      hasActiveFile: false,
    },
    actions: [
      {
        id: "navigate-to",
        label: "Focus tile",
        category: "navigate",
        agentInvocable: true,
        params: {
          tileId: { type: "string", description: "Tile ID from board.json", required: true },
        },
        description: "Scroll to and select a specific tile",
      },
      {
        id: "open-gallery",
        label: "Open tile gallery",
        category: "ui",
        agentInvocable: true,
        params: {},
        description: "Open the tile gallery sidebar",
      },
    ],
    commands: [
      { id: "create-tile", label: "Create Tile", description: "Request agent to create a new tile" },
    ],
    locatorDescription: 'After creating or editing tiles, embed locator cards so the user can jump to them. Navigate to tile: `data=\'{"tileId":"weather"}\'`.',
  },

  agent: {
    permissionMode: "bypassPermissions",
    greeting: `<system-info pneuma-mode="Pneuma GridBoard Mode" skill="pneuma-gridboard" session="new"></system-info>
The user just opened the workspace. You are ready to assist with dashboard creation. Greet the user briefly (1-2 sentences) and mention they can describe what tiles they want on their dashboard.`,
  },

  init: {
    contentCheckPattern: "board.json",
    seedFiles: {
      "modes/gridboard/seed/default/": "./",
    },
    params: [
      { name: "boardWidth", label: "Board Width (px)", description: "400-1600", type: "number", defaultValue: 800 },
      { name: "boardHeight", label: "Board Height (px)", description: "400-1600", type: "number", defaultValue: 800 },
      { name: "columns", label: "Grid Columns", description: "4-16", type: "number", defaultValue: 8 },
      { name: "rows", label: "Grid Rows", description: "4-16", type: "number", defaultValue: 8 },
    ],
  },

  evolution: {
    directive: `Learn the user's dashboard design preferences from their conversation history.
Focus on: visual style (minimal/data-dense/colorful), tile size preferences,
data source patterns, refresh frequency habits, layout density, color palette,
and content organization. Augment the skill to guide the main agent toward
these preferences as defaults while respecting explicit user instructions.`,
  },
};

export default gridboardManifest;
```

- [ ] **Step 2: Register in mode-loader.ts**

Add to `builtinModes` in `core/mode-loader.ts` after the `remotion` entry:

```typescript
gridboard: {
  type: "builtin",
  manifestLoader: () =>
    import("../modes/gridboard/manifest.js").then((m) => m.default),
  definitionLoader: () =>
    import("../modes/gridboard/pneuma-mode.js").then((m) => m.default),
},
```

- [ ] **Step 3: Commit**

```bash
git add modes/gridboard/manifest.ts core/mode-loader.ts
git commit -m "feat(gridboard): add mode manifest and register in mode-loader"
```

---

### Task 2: Seed Templates — board.json + theme.css + example tiles

**Files:**
- Create: `modes/gridboard/seed/default/board.json`
- Create: `modes/gridboard/seed/default/theme.css`
- Create: `modes/gridboard/seed/default/tiles/clock/Tile.tsx`
- Create: `modes/gridboard/seed/default/tiles/weather/Tile.tsx`
- Create: `modes/gridboard/seed/default/tiles/todo/Tile.tsx`

- [ ] **Step 1: Create board.json**

```json
{
  "board": {
    "width": 800,
    "height": 800,
    "columns": 8,
    "rows": 8
  },
  "tiles": {
    "clock": {
      "label": "Clock",
      "component": "tiles/clock/Tile.tsx",
      "status": "active",
      "position": { "col": 0, "row": 0 },
      "size": { "cols": 2, "rows": 2 }
    },
    "weather": {
      "label": "Weather",
      "component": "tiles/weather/Tile.tsx",
      "status": "active",
      "position": { "col": 2, "row": 0 },
      "size": { "cols": 3, "rows": 2 }
    },
    "todo": {
      "label": "Todo List",
      "component": "tiles/todo/Tile.tsx",
      "status": "active",
      "position": { "col": 5, "row": 0 },
      "size": { "cols": 3, "rows": 4 }
    }
  }
}
```

- [ ] **Step 2: Create theme.css**

```css
:root {
  --board-bg: #09090b;
  --board-grid-line: rgba(255, 255, 255, 0.04);
  --tile-bg: #18181b;
  --tile-border: #27272a;
  --tile-border-hover: #3f3f46;
  --tile-radius: 12px;
  --tile-padding: 16px;
  --tile-header-height: 28px;
  --text-primary: #fafafa;
  --text-secondary: #a1a1aa;
  --text-muted: #52525b;
  --accent: #f97316;
  --accent-dim: rgba(249, 115, 22, 0.15);
  --success: #22c55e;
  --warning: #eab308;
  --error: #ef4444;
  --font-family: "Inter", system-ui, -apple-system, sans-serif;
  --font-mono: "JetBrains Mono", "Fira Code", monospace;
  --selection-color: #3b82f6;
  --selection-bg: rgba(59, 130, 246, 0.1);
  --overlay-bg: rgba(9, 9, 11, 0.7);
}
```

- [ ] **Step 3: Create clock tile**

```tsx
// tiles/clock/Tile.tsx
import { defineTile } from "gridboard";

export default defineTile({
  label: "Clock",
  description: "Simple analog/digital clock display",
  minSize: { cols: 2, rows: 2 },
  maxSize: { cols: 4, rows: 4 },

  render({ width, height }) {
    const [time, setTime] = React.useState(new Date());

    React.useEffect(() => {
      const timer = setInterval(() => setTime(new Date()), 1000);
      return () => clearInterval(timer);
    }, []);

    const hours = time.getHours().toString().padStart(2, "0");
    const minutes = time.getMinutes().toString().padStart(2, "0");
    const seconds = time.getSeconds().toString().padStart(2, "0");
    const dateStr = time.toLocaleDateString("en-US", {
      weekday: "short", month: "short", day: "numeric",
    });

    const isLarge = width > 250 && height > 250;

    return (
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", height: "100%", gap: 4,
        fontFamily: "var(--font-mono)", color: "var(--text-primary)",
      }}>
        <div style={{ fontSize: isLarge ? 48 : 32, fontWeight: 200, letterSpacing: 2 }}>
          {hours}:{minutes}
        </div>
        <div style={{ fontSize: isLarge ? 20 : 14, color: "var(--text-muted)" }}>
          {seconds}s
        </div>
        <div style={{ fontSize: isLarge ? 14 : 11, color: "var(--text-secondary)", marginTop: 4 }}>
          {dateStr}
        </div>
      </div>
    );
  },
});
```

- [ ] **Step 4: Create weather tile**

```tsx
// tiles/weather/Tile.tsx
import { defineTile } from "gridboard";

export default defineTile({
  label: "Weather",
  description: "Current weather conditions with temperature",
  minSize: { cols: 2, rows: 2 },
  maxSize: { cols: 4, rows: 4 },

  params: {
    city: { type: "string", default: "Tokyo", label: "City" },
  },

  dataSource: {
    refreshInterval: 600,
    async fetch(ctx) {
      // Demo: use wttr.in for no-API-key weather
      const res = await fetch(
        `https://wttr.in/${encodeURIComponent(String(ctx.params.city))}?format=j1`,
        { signal: ctx.signal }
      );
      if (!res.ok) throw new Error(`Weather API error: ${res.status}`);
      const data = await res.json();
      const current = data.current_condition?.[0] || {};
      return {
        temp: current.temp_C || "—",
        feelsLike: current.FeelsLikeC || "—",
        desc: current.weatherDesc?.[0]?.value || "Unknown",
        humidity: current.humidity || "—",
        wind: current.windspeedKmph || "—",
        city: String(ctx.params.city),
      };
    },
  },

  render({ data, width, height, loading, error }) {
    if (loading && !data) {
      return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-muted)" }}>
          Loading weather...
        </div>
      );
    }
    if (error && !data) {
      return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--error)", padding: 16, textAlign: "center", fontSize: 13 }}>
          {error.message}
        </div>
      );
    }
    const d = data as any;
    const isWide = width > 250;
    return (
      <div style={{ padding: "var(--tile-padding)", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>{d?.city}</div>
          <div style={{ fontSize: isWide ? 42 : 32, fontWeight: 200, color: "var(--text-primary)", lineHeight: 1 }}>
            {d?.temp}°C
          </div>
          <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>{d?.desc}</div>
        </div>
        {isWide && (
          <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--text-muted)" }}>
            <span>Feels {d?.feelsLike}°</span>
            <span>💧 {d?.humidity}%</span>
            <span>💨 {d?.wind}km/h</span>
          </div>
        )}
      </div>
    );
  },
});
```

- [ ] **Step 5: Create todo tile**

```tsx
// tiles/todo/Tile.tsx
import { defineTile } from "gridboard";

export default defineTile({
  label: "Todo List",
  description: "Simple interactive todo list with checkboxes",
  minSize: { cols: 2, rows: 3 },
  maxSize: { cols: 4, rows: 8 },

  render({ width, height }) {
    const [items, setItems] = React.useState([
      { id: 1, text: "Review dashboard layout", done: false },
      { id: 2, text: "Add data sources", done: false },
      { id: 3, text: "Customize theme colors", done: true },
      { id: 4, text: "Share with team", done: false },
    ]);

    const toggle = (id: number) => {
      setItems(prev => prev.map(item =>
        item.id === id ? { ...item, done: !item.done } : item
      ));
    };

    const doneCount = items.filter(i => i.done).length;

    return (
      <div style={{ padding: "var(--tile-padding)", height: "100%", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>Tasks</span>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{doneCount}/{items.length}</span>
        </div>
        <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
          {items.map(item => (
            <div
              key={item.id}
              onClick={() => toggle(item.id)}
              style={{
                display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
                borderRadius: 8, cursor: "pointer", fontSize: 13,
                background: item.done ? "transparent" : "var(--accent-dim)",
                color: item.done ? "var(--text-muted)" : "var(--text-primary)",
                textDecoration: item.done ? "line-through" : "none",
                transition: "all 0.15s ease",
              }}
            >
              <span style={{
                width: 18, height: 18, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center",
                border: item.done ? "none" : "1.5px solid var(--text-muted)",
                background: item.done ? "var(--accent)" : "transparent",
                color: "#fff", fontSize: 11, flexShrink: 0,
              }}>
                {item.done && "✓"}
              </span>
              {item.text}
            </div>
          ))}
        </div>
      </div>
    );
  },
});
```

- [ ] **Step 6: Commit**

```bash
git add modes/gridboard/seed/
git commit -m "feat(gridboard): add seed templates (board.json, theme, 3 example tiles)"
```

---

### Task 3: Tile Compiler — browser-side JIT compilation

Pattern: follow `modes/remotion/viewer/remotion-compiler.ts` architecture.

**Files:**
- Create: `modes/gridboard/viewer/tile-compiler.ts`
- Create: `modes/gridboard/viewer/use-tile-compiler.ts`

- [ ] **Step 1: Create tile-compiler.ts (pure functions, testable in Bun)**

This module handles:
- Parse `defineTile()` calls from TSX source
- Transpile TSX → JS via pluggable transpiler (Babel in browser, Bun.Transpiler in tests)
- Evaluate compiled module with injected `React` + `defineTile` runtime
- Extract tile metadata (label, description, minSize, maxSize, params) and render function
- Content-hash caching to avoid recompilation on unchanged files

Key exports:
- `setTranspiler(fn)` — configure transpiler
- `compileTile(source, filename, externals)` — compile single tile TSX → TileDefinition
- `compileTiles(files, boardConfig)` — compile all tiles referenced in board.json
- `simpleHash(str)` — content hash for caching

The `externals` map provides `React` and the `defineTile` factory. The `defineTile` factory captures the definition object when called.

- [ ] **Step 2: Create use-tile-compiler.ts (React hook)**

Hook wrapping tile-compiler with:
- Babel transpiler setup (import @babel/standalone)
- Debounced recompilation (300ms) on file changes
- Content-hash caching
- Returns `Map<tileId, { definition: TileDefinition, error?: string }>`

- [ ] **Step 3: Commit**

```bash
git add modes/gridboard/viewer/tile-compiler.ts modes/gridboard/viewer/use-tile-compiler.ts
git commit -m "feat(gridboard): add tile JIT compiler (Babel-based, like Remotion)"
```

---

### Task 4: TileSlot Component — Shadow DOM container + overlay states

**Files:**
- Create: `modes/gridboard/viewer/TileSlot.tsx`

- [ ] **Step 1: Create TileSlot.tsx**

Renders a single tile in a Shadow DOM container:
- Creates a `<div>` with `ref`, attaches `shadowRoot` on mount
- Injects theme CSS variables into shadow root's `<style>` tag
- Renders tile's React component via `ReactDOM.createRoot` in shadow root
- Manages overlay states: resizing (spinner), compiling (flash), error (red border)
- Props: `tileId`, `definition`, `data`, `loading`, `error`, `width`, `height`, `themeCSS`, `isResizing`, `isSelected`, `onSelect`

- [ ] **Step 2: Commit**

```bash
git add modes/gridboard/viewer/TileSlot.tsx
git commit -m "feat(gridboard): add TileSlot with Shadow DOM isolation + overlays"
```

---

### Task 5: GridBoardPreview — main viewer component

**Files:**
- Create: `modes/gridboard/viewer/GridBoardPreview.tsx`

- [ ] **Step 1: Create GridBoardPreview.tsx**

Main viewer implementing `ViewerPreviewProps`:

**Board rendering:**
- Parse `board.json` from files to get grid config + tile registry
- Parse `theme.css` from files
- Render fixed-size board div (centered, overflow scroll)
- Draw grid lines via CSS repeating-linear-gradient
- Position active tiles using absolute positioning computed from grid units

**Tile lifecycle:**
- Use `useTileCompiler(files)` to compile all tile TSX files
- For each active tile: render `<TileSlot>` with compiled definition
- Data fetching: manage per-tile fetch cycles with `refreshInterval`, pass data/loading/error to TileSlot
- Respect min refresh interval (30s)

**Selection:**
- Click tile → call `onSelect` with tile metadata (tileId, size, position, component path)
- Selected tile shows blue border

**Drag move:**
- Mousedown on tile header → drag mode
- Show ghost preview snapping to grid during drag
- Drop → validate no overlap → update position in board.json via `POST /api/files`

**Drag resize:**
- Mousedown on resize handles (edges/corners)
- Show size preview, constrained by minSize/maxSize
- Drop → update size in board.json → set tile to resizing state → notify agent via `onNotifyAgent`
- Agent rewrites tile → file change → recompile → clear resizing overlay

**Actions:**
- Handle `navigate-to` (scroll + select tile), `open-gallery` (toggle state)

**Viewer context:**
- Implement context extraction for both selected tile and board overview

- [ ] **Step 2: Commit**

```bash
git add modes/gridboard/viewer/GridBoardPreview.tsx
git commit -m "feat(gridboard): add main GridBoardPreview viewer component"
```

---

### Task 6: TileGallery + GridToolbar

**Files:**
- Create: `modes/gridboard/viewer/TileGallery.tsx`
- Create: `modes/gridboard/viewer/GridToolbar.tsx`

- [ ] **Step 1: Create TileGallery.tsx**

Sidebar drawer showing available + disabled tiles:
- Slide-in from right
- Each tile card: label, description, minSize badge, status indicator
- "Add to Board" button → find first empty space for minSize → update board.json
- "Create Tile" button → trigger viewer command notification to agent

- [ ] **Step 2: Create GridToolbar.tsx**

Bottom toolbar:
- Gallery toggle button
- Grid lines visibility toggle
- Board info display (dimensions, tile count)

- [ ] **Step 3: Commit**

```bash
git add modes/gridboard/viewer/TileGallery.tsx modes/gridboard/viewer/GridToolbar.tsx
git commit -m "feat(gridboard): add tile gallery sidebar and grid toolbar"
```

---

### Task 7: pneuma-mode.ts — ViewerContract binding

**Files:**
- Create: `modes/gridboard/pneuma-mode.ts`

- [ ] **Step 1: Create pneuma-mode.ts**

```typescript
import type { ModeDefinition } from "../../core/types/mode-definition.js";
import type { ViewerSelectionContext, ViewerFileContent } from "../../core/types/viewer-contract.js";
import GridBoardPreview from "./viewer/GridBoardPreview.js";
import gridboardManifest from "./manifest.js";

const gridboardMode: ModeDefinition = {
  manifest: gridboardManifest,
  viewer: {
    PreviewComponent: GridBoardPreview,
    workspace: {
      type: "all",
      multiFile: true,
      ordered: false,
      hasActiveFile: false,
      resolveItems(files) {
        return files
          .filter(f => f.path === "board.json" || f.path.startsWith("tiles/"))
          .map(f => ({ path: f.path, label: f.path }));
      },
    },
    extractContext(selection, files) {
      if (!selection) {
        // Board overview context
        const boardFile = files.find(f => f.path === "board.json" || f.path.endsWith("/board.json"));
        if (!boardFile) return "";
        try {
          const board = JSON.parse(boardFile.content);
          const tiles = board.tiles || {};
          const active = Object.entries(tiles).filter(([, t]: any) => (t as any).status === "active");
          const disabled = Object.entries(tiles).filter(([, t]: any) => (t as any).status === "disabled");
          const available = Object.entries(tiles).filter(([, t]: any) => (t as any).status === "available");
          const totalCells = (board.board?.columns || 8) * (board.board?.rows || 8);
          const usedCells = active.reduce((sum, [, t]: any) => sum + ((t as any).size?.cols || 0) * ((t as any).size?.rows || 0), 0);
          const lines = [
            `<viewer-context mode="gridboard">`,
            `Board: ${board.board?.width || 800}×${board.board?.height || 800}, ${board.board?.columns || 8}×${board.board?.rows || 8} grid`,
          ];
          if (active.length > 0) lines.push(`Active tiles: ${active.map(([id, t]: any) => `${id} (${(t as any).size?.cols}×${(t as any).size?.rows})`).join(", ")}`);
          if (disabled.length > 0) lines.push(`Disabled: ${disabled.map(([id]) => id).join(", ")}`);
          if (available.length > 0) lines.push(`Available: ${available.map(([id]) => id).join(", ")}`);
          lines.push(`Empty cells: ${totalCells - usedCells}/${totalCells}`);
          lines.push(`</viewer-context>`);
          return lines.join("\n");
        } catch { return ""; }
      }

      // Tile selected context
      const tileId = selection.type === "tile" ? selection.content : "";
      if (!tileId) return "";
      const boardFile = files.find(f => f.path === "board.json" || f.path.endsWith("/board.json"));
      if (!boardFile) return "";
      try {
        const board = JSON.parse(boardFile.content);
        const tile = board.tiles?.[tileId];
        if (!tile) return "";
        const lines = [
          `<viewer-context mode="gridboard" tile="${tileId}" size="${tile.size?.cols}x${tile.size?.rows}" status="${tile.status}">`,
          `Tile: ${tile.label} (${tile.size?.cols}×${tile.size?.rows} at col ${tile.position?.col}, row ${tile.position?.row})`,
          `Component: ${tile.component}`,
        ];
        if (tile.description) lines.push(`Description: ${tile.description}`);
        lines.push(`</viewer-context>`);
        return lines.join("\n");
      } catch { return ""; }
    },
    updateStrategy: "full-reload",
    locatorDescription: 'After creating or editing tiles, embed locator cards so the user can jump to them. Navigate to tile: `data=\'{"tileId":"weather"}\'`.',
  },
};

export default gridboardMode;
```

- [ ] **Step 2: Commit**

```bash
git add modes/gridboard/pneuma-mode.ts
git commit -m "feat(gridboard): add pneuma-mode.ts viewer contract binding"
```

---

### Task 8: Skill prompt — SKILL.md

**Files:**
- Create: `modes/gridboard/skill/SKILL.md`

- [ ] **Step 1: Create SKILL.md**

Content covers:
- defineTile() full API with TypeScript types
- Theme CSS variables (full list from theme.css)
- board.json schema and field descriptions
- Tile lifecycle: available → active → disabled → deleted
- Size inference heuristics (news=wide, clock=square, list=tall, chart=medium)
- Resize adaptation rules (meaningfully adapt content, not just scale)
- File conventions (one dir per tile, Tile.tsx as default export)
- Example: complete tile from scratch

- [ ] **Step 2: Create scaffold.ts**

```typescript
// modes/gridboard/viewer/scaffold.ts
interface ScaffoldFile { path: string; content: string; }

export function scaffoldGridBoard(params?: { title?: string }): ScaffoldFile[] {
  const title = params?.title || "My Dashboard";
  return [
    {
      path: "board.json",
      content: JSON.stringify({
        board: { width: 800, height: 800, columns: 8, rows: 8 },
        tiles: {},
      }, null, 2),
    },
    {
      path: "theme.css",
      content: `:root {\n  --board-bg: #09090b;\n  --tile-bg: #18181b;\n  --tile-border: #27272a;\n  --tile-radius: 12px;\n  --tile-padding: 16px;\n  --text-primary: #fafafa;\n  --text-secondary: #a1a1aa;\n  --text-muted: #52525b;\n  --accent: #f97316;\n  --font-family: "Inter", system-ui, sans-serif;\n  --font-mono: "JetBrains Mono", monospace;\n}\n`,
    },
  ];
}
```

- [ ] **Step 3: Commit**

```bash
git add modes/gridboard/skill/ modes/gridboard/viewer/scaffold.ts
git commit -m "feat(gridboard): add SKILL.md and scaffold generator"
```

---

### Task 9: Integration — wire up and test end-to-end

- [ ] **Step 1: Verify mode loads**

Run: `bun run dev gridboard --workspace /tmp/test-gridboard --no-open`
Expected: Server starts, skill installed, seed files copied

- [ ] **Step 2: Open in browser**

Navigate to `http://localhost:17996` (or printed port)
Expected: Board canvas visible with 3 seed tiles (clock, weather, todo)

- [ ] **Step 3: Test tile interactions**

- Click a tile → selection highlight appears
- Verify clock updates every second
- Verify todo checkboxes toggle
- Verify weather fetches data (may fail with network, but UI should show loading/error state)

- [ ] **Step 4: Test drag move**

- Drag a tile by its header → grid preview → drop in new position
- Verify board.json updated

- [ ] **Step 5: Test drag resize**

- Drag a tile's resize handle → resize preview → drop
- Verify resizing overlay appears
- Verify viewer notification sent to agent

- [ ] **Step 6: Test gallery**

- Open gallery → verify available/disabled tiles listed
- Add tile from gallery → verify it appears on board

- [ ] **Step 7: Commit final adjustments**

```bash
git add -A
git commit -m "feat(gridboard): integration fixes and polish"
```

---
name: pneuma-gridboard
description: >
  GridBoard Mode workspace guidelines. Use for ANY task in this workspace:
  creating or editing dashboards, adding tiles, changing layouts, updating data sources,
  adjusting themes, resizing tiles, or any dashboard-building task.
  This skill defines the defineTile() API, board.json schema, theming conventions,
  size guidelines, and resize adaptation rules for the live-preview tile grid environment.
  Consult before your first edit in a new conversation.
---

# Pneuma GridBoard Mode — Dashboard Building Skill

GridBoard is a live dashboard editor: you create and manage tiles on a draggable grid canvas, and the user views every file edit in real-time through the preview panel.

**Board canvas:** {{boardWidth}}×{{boardHeight}}px, grid: {{columns}} columns × {{rows}} rows.

## Core Principles

1. **Act, don't ask**: For straightforward edits, just do them. Only ask for clarification on ambiguous requests
2. **Live preview**: The user sees changes as you make each file edit — keep files in a valid state at all times
3. **Sync board.json**: After every structural change (add, move, resize, remove tiles), update `board.json` immediately
4. **Theme consistency**: Use CSS custom properties from `theme.css` for all colors, fonts, and spacing — no hardcoded values
5. **Size with intention**: Choose tile sizes that fit the content — charts need room for axes, stat cards can be compact
6. **Adapt on resize**: When a tile's dimensions change, restructure content meaningfully — never just CSS scale
7. **Design, don't just lay out**: Tiles should feel crafted, not templated. Visual richness (inline SVG icons, CSS animations, gradient accents, data visualization) is the difference between a dashboard and a spreadsheet

---

## File Architecture

```
workspace/
  board.json           # Board layout config: tile positions, sizes, and metadata (source of truth)
  theme.css            # Shared CSS theme (custom properties + base styles)
  tiles/
    <tile-id>/
      Tile.tsx         # Tile component — export default defineTile({...})
      ...              # Supporting files (helpers, sub-components, local CSS)
```

### One Directory Per Tile

Each tile lives in its own directory under `tiles/`. The entry point must be `Tile.tsx` with a default export of `defineTile({...})`. Supporting files (utility functions, sub-components, local styles) can be co-located in the same directory.

---

## defineTile() API

Use `import { defineTile } from "gridboard"` in every tile file. **React is available as a global — do not import it.**

```ts
interface TileRenderProps {
  data: unknown;          // Latest fetch result (null before first fetch)
  width: number;          // Current pixel width of the tile
  height: number;         // Current pixel height of the tile
  loading: boolean;       // True while a fetch is in progress
  error: Error | null;    // Last fetch error, or null if no error
}

interface TileFetchContext {
  signal: AbortSignal;                    // Cancelled on unmount or manual refresh
  params: Record<string, unknown>;        // User-configurable params (see TileDefinition.params)
}

interface TileDefinition {
  label: string;
  description: string;
  minSize: { cols: number; rows: number };
  maxSize: { cols: number; rows: number };
  dataSource?: {
    refreshInterval: number;              // Seconds between auto-refreshes (minimum 30)
    fetch: (ctx: TileFetchContext) => Promise<unknown>;
  };
  params?: Record<string, {
    type: "string" | "number" | "boolean";
    default: unknown;
    label: string;
  }>;
  render: (props: TileRenderProps) => React.ReactNode;
}
```

### Complete Tile Example

```tsx
import { defineTile } from "gridboard";

export default defineTile({
  label: "Metric Card",
  description: "Shows a single KPI with trend indicator",
  minSize: { cols: 2, rows: 2 },
  maxSize: { cols: 4, rows: 3 },

  params: {
    label: { type: "string", default: "Revenue", label: "Metric label" },
    unit:  { type: "string", default: "$",       label: "Unit prefix" },
  },

  dataSource: {
    refreshInterval: 60,
    fetch: async ({ signal, params }) => {
      // Use /proxy/<name>/ to avoid CORS — proxied by pneuma runtime
      const res = await fetch("/proxy/myapi/metrics/revenue", { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  },

  render({ data, width, height, loading, error, params }) {
    if (loading && !data) {
      return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
          <span style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading…</span>
        </div>
      );
    }

    if (error) {
      return (
        <div style={{ padding: "var(--tile-padding)", color: "var(--error)", fontSize: 12 }}>
          {error.message}
        </div>
      );
    }

    const value = (data as any)?.value ?? 0;
    const trend = (data as any)?.trend ?? 0;
    // Adapt layout to available space
    const compact = width < 200 || height < 120;

    return (
      <div style={{
        padding: "var(--tile-padding)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        height: "100%",
        fontFamily: "var(--font-family)",
      }}>
        <div style={{ color: "var(--text-secondary)", fontSize: compact ? 11 : 13 }}>
          {params.label as string}
        </div>
        <div style={{
          color: "var(--text-primary)",
          fontSize: compact ? 24 : 36,
          fontWeight: 700,
          lineHeight: 1.1,
        }}>
          {params.unit}{value.toLocaleString()}
        </div>
        {!compact && (
          <div style={{ color: trend >= 0 ? "var(--success)" : "var(--error)", fontSize: 12, marginTop: 4 }}>
            {trend >= 0 ? "▲" : "▼"} {Math.abs(trend)}%
          </div>
        )}
      </div>
    );
  },
});
```

---

## Theme CSS Variables

Always use these variables. Modify `theme.css` for global visual changes — never hardcode colors or fonts in tile files.

| Variable | Purpose |
|---|---|
| `--board-bg` | Board canvas background |
| `--board-grid-line` | Grid line color (faint, for visual reference) |
| `--tile-bg` | Tile background surface |
| `--tile-border` | Tile border color (default state) |
| `--tile-border-hover` | Tile border color on hover |
| `--tile-radius` | Tile corner radius |
| `--tile-padding` | Inner tile padding (use for content insets) |
| `--text-primary` | Primary text (headings, values) |
| `--text-secondary` | Secondary text (labels, captions) |
| `--text-muted` | Muted text (hints, placeholders, empty states) |
| `--accent` | Accent color (interactive elements, highlights) |
| `--accent-dim` | Dimmed accent (backgrounds, subtle indicators) |
| `--success` | Positive trend / success state |
| `--warning` | Warning / attention state |
| `--error` | Error / negative trend state |
| `--font-family` | Primary sans-serif font stack |
| `--font-mono` | Monospace font stack (code, numbers) |
| `--selection-color` | Text color when tile is selected |
| `--selection-bg` | Background color when tile is selected |
| `--overlay-bg` | Semi-transparent overlay (modals, tooltips) |

---

## board.json Schema

```json
{
  "board": {
    "width": 800,
    "height": 800,
    "columns": 8,
    "rows": 8
  },
  "tiles": {
    "<tile-id>": {
      "label": "Human-readable tile name",
      "component": "tiles/<tile-id>/Tile.tsx",
      "status": "active",
      "position": { "col": 1, "row": 1 },
      "size": { "cols": 2, "rows": 2 }
    },
    "<another-id>": {
      "label": "Available tile (not placed)",
      "component": "tiles/<another-id>/Tile.tsx",
      "status": "available"
    }
  }
}
```

### Tile Status Values

| Status | Has `position` + `size`? | Description |
|---|---|---|
| `active` | Yes | Placed and visible on the board |
| `disabled` | Yes | Hidden but retains its last position/size |
| `available` | No | In the gallery, not yet placed |

### Tile Lifecycle

```
available  →  active     (user places tile from gallery)
active     →  disabled   (user hides tile)
disabled   →  active     (user re-enables tile)
active     →  (deleted)  (user removes tile entirely — delete file + remove from board.json)
```

- Position uses 1-based column and row indices
- `size.cols` and `size.rows` are the span in grid units
- Tiles must not overlap — check existing positions before placing a new tile
- `available` tiles have no `position` or `size` fields

---

## Size Inference Guidelines

Choose initial tile sizes based on content type. When unsure, go slightly larger — users can always shrink.

| Content Type | Recommended Size | Reason |
|---|---|---|
| Clock / single metric | 2×2 | Small, glanceable — no wasted space |
| Weather / status card | 3×2 | Needs width for icon + label detail |
| List / todo / feed | 2×4 or 3×4 | Vertical content benefits from height |
| News / article feed | 4×3+ | Wide headlines + summaries need room |
| Chart / graph | 3×3 or 4×3 | Axes + data labels need sufficient area |
| Calendar | 4×4 | Grid-within-grid needs generous space |
| Table / data grid | 4×3 or 5×3 | Columns need horizontal room |
| Map | 4×4 or 5×4 | Spatial context requires area |
| Text / notes | 3×3 or 3×4 | Readable line length + scrollable height |

---

## Resize Adaptation Rules
> *Consult [resize adaptation reference](references/resize-adaptation.md) for per-tier design expectations, implementation patterns, and the screenshot test.*

Resize is the defining interaction of GridBoard. **Small tiles show data. Large tiles show craft.**

### Breakpoint approach

```tsx
const compact  = width < 180 || height < 120;   // key value only, no decoration
const medium   = !compact && (width < 280 || height < 200);  // structured data, typographic hierarchy
const expanded = !compact && !medium;             // full visual experience — SVG icons, visualizations, animations
```

Each tier should be a **distinct visual design**, not a parametric variation. When a tile grows:
- Compact → Medium: add secondary data, introduce typographic contrast
- Medium → Expanded: add SVG iconography, data visualization, data-driven color, contextual detail

What does NOT count: bigger fonts, more padding, same elements rearranged.

---

## Workflow: Creating a New Tile

1. Create `tiles/<tile-id>/Tile.tsx` with `defineTile({...})`
2. Choose `minSize` and `maxSize` that fit the content (see size table above)
3. Implement a responsive `render` using `width`/`height` breakpoints
4. Add an entry to `board.json` `tiles` map
5. Set `status: "active"` with a `position` and `size` if placing immediately; `status: "available"` for gallery-only
6. Use only CSS custom properties from `theme.css`

## Workflow: Editing an Existing Tile

1. Edit `tiles/<tile-id>/Tile.tsx`
2. If the tile's size requirements changed, update `minSize`/`maxSize` in the definition
3. If position or size on the board changed, update `board.json`
4. Never modify `.claude/` or `.pneuma/` — managed by the runtime

---

## Locator cards

After creating or editing tiles, embed `<viewer-locator>` cards in chat so the user can jump straight to the result. Navigate by tile ID, or open the gallery to browse available tile types.

```html
<!-- Jump to a specific tile -->
<viewer-locator action="navigate-to" data='{"tileId":"revenue-chart"}' label="Revenue Chart" />

<!-- Open the tile gallery -->
<viewer-locator action="open-gallery" data='{}' label="Browse tiles" />
```

## External API Access (Proxy)

Tile code runs in the browser. Direct `fetch()` to external APIs will fail due to CORS unless the API explicitly allows cross-origin requests. **Always use the proxy for external APIs.**

### Decision Rule

```
Need to fetch data from an external API?
  ├─ Is it already in the proxy list (see CLAUDE.md Proxy section)?
  │   └─ Yes → use /proxy/<name>/<path>
  └─ No → add it to proxy.json first, then use /proxy/<name>/<path>
```

**Never use absolute URLs** like `https://api.example.com/...` in tile fetch code. Even if an API works without proxy today (e.g. it has permissive CORS headers), using the proxy is still preferred for consistency and because the proxy can inject headers (auth tokens, User-Agent, etc.).

### Adding a New Proxy

Write `proxy.json` in the workspace root. It takes effect immediately — no restart needed.

```json
{
  "myapi": {
    "target": "https://api.example.com",
    "headers": {
      "Authorization": "Bearer {{API_KEY}}",
      "User-Agent": "Mozilla/5.0 (compatible)"
    },
    "methods": ["GET", "POST"],
    "description": "My API — needs auth and browser UA"
  }
}
```

- `target` — base URL (required)
- `headers` — injected on every request; `{{ENV_VAR}}` resolves from process.env (optional)
- `methods` — allowed HTTP methods, defaults to `["GET"]` only (optional)
- Workspace `proxy.json` merges with mode defaults; same name overrides the default

### Common Patterns

| Scenario | What to do |
|----------|-----------|
| API needs auth header | Add `"headers": { "Authorization": "Bearer {{TOKEN}}" }` to proxy config |
| API blocks non-browser requests | Add `"User-Agent": "Mozilla/5.0 ..."` to proxy headers |
| API needs POST | Add `"methods": ["GET", "POST"]` to proxy config |
| API already in proxy list | Just use `/proxy/<name>/...` directly |

### Example

```tsx
dataSource: {
  refreshInterval: 300,
  async fetch({ signal }) {
    // ✅ Always go through proxy
    const res = await fetch("/proxy/bilibili/x/web-interface/popular?ps=10&pn=1", { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.code !== 0) throw new Error(json.message);
    return json.data.list;
  },
}
```

---

## Design Quality
> *Consult [tile visual design reference](references/tile-visual-design.md) for SVG patterns, data-driven color, typography hierarchy, and visualization components.*

Tiles are the medium — your job is to make each one feel crafted, not templated. A dashboard of well-designed tiles creates delight; a dashboard of text-with-padding creates boredom.

**Your visual toolkit** (all available in TSX, no external dependencies):
- **Inline SVG** — icons, charts, gauges, sparklines. This is your primary visual tool. Draw vectors, don't use emoji.
- **Data-driven color** — gradients and accents that respond to the data (temperature heatmap, trend colors, category palettes).
- **Typography contrast** — large bold `var(--font-mono)` for primary data, small muted labels. Hierarchy through weight and size.
- **CSS animations** — `@keyframes` via `<style dangerouslySetInnerHTML>`. Pulsing indicators, shimmer effects. Use sparingly.

**Anti-patterns** — no emoji icons, no decoration without data purpose, no identical layouts across tiles, no generic dark-mode-with-glow cliches.

**Aspiration check**: would someone screenshot this tile to show a friend? If not, add an SVG icon, a data-driven color accent, or a visualization.

---

## Constraints

- Do not import React — it is available as a global
- Use `import { defineTile } from "gridboard"` as the only gridboard import
- **No JSX tags for local components** — the tile runtime cannot resolve locally-defined components as JSX tags. `<WeatherIcon />` will throw "WeatherIcon is not defined" even if defined in the same file. Use plain function calls instead:
  ```tsx
  // BAD — will crash at runtime
  function WeatherIcon({ type }: { type: string }) { return <svg>...</svg>; }
  // ... inside render:
  <WeatherIcon type="rain" />

  // GOOD — plain function call works
  function renderWeatherIcon(type: string) { return <svg>...</svg>; }
  // ... inside render:
  {renderWeatherIcon("rain")}
  ```
- Do not create files outside `tiles/`, `board.json`, and `theme.css` unless explicitly asked
- Do not run long-running background processes
- `refreshInterval` must be at least 30 seconds — do not poll more frequently
- Keep `board.json` valid JSON at all times — invalid JSON breaks the viewer

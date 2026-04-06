# Diagram Mode Design

**Date:** 2026-04-06
**Branch:** `feat/drawio-mode`
**Status:** Draft

## Summary

A new `diagram` mode for Pneuma Skills, replacing the Excalidraw-based `draw` mode with draw.io's professional diagramming ecosystem. Agent generates mxGraphModel XML, Viewer streams it in real-time with animations. Phase 1 is read-only rendering with full Agent skill; editing deferred to Phase 2.

## Goals

1. Professional-grade diagram rendering using draw.io's viewer library (10,000+ shapes: AWS, Azure, GCP, Kubernetes, BPMN, UML, etc.)
2. Streaming render during Agent output -- incremental XML healing, merge, fade-in animations, viewport tracking
3. Full Agent skill with XML reference, style guide, and shape search knowledge
4. Standard `.drawio` file format -- files can be opened directly in draw.io desktop/web
5. "Open in draw.io" escape hatch for user editing

## Non-Goals (Phase 1)

- Embedded draw.io editor (iframe embed mode) -- deferred to Phase 2
- Direct canvas editing in Pneuma -- deferred to Phase 2
- MCP server integration (`@drawio/mcp` tool server) -- not needed; Agent writes XML directly

## Architecture

```
Agent generates XML ─→ writes .drawio file ─→ chokidar detects change
                                                      │
                                            ┌─────────▼──────────┐
                                            │  DiagramPreview.tsx │
                                            │                    │
                                            │  Agent streaming?  │
                                            │  ├─ YES: healXml   │
                                            │  │  → merge delta  │
                                            │  │  → animate      │
                                            │  │  → follow cam   │
                                            │  └─ NO: render     │
                                            │     final diagram  │
                                            │     (GraphViewer)  │
                                            └────────────────────┘
```

### Dual Render Modes

| State | Renderer | User Interaction |
|-------|----------|------------------|
| **Agent streaming** | Raw `Graph` instance + incremental XML merge | Read-only. Pan/zoom. Select elements for context. |
| **Agent idle** | `GraphViewer` with toolbar (zoom, layers, tags) | Read-only with toolbar. Select elements. "Open in draw.io" button. |

The transition: when Agent finishes writing, destroy the streaming `Graph`, render final XML via `GraphViewer.createViewerForElement()` with pop/fade intro animation.

### Streaming Pipeline

Borrowed from drawio-mcp's proven approach:

1. **File change detected** -- read `.drawio` XML (may be partial/truncated)
2. **`healPartialXml(xml)`** -- truncate at last complete `>`, strip comments, auto-close open tags via stack
3. **`streamMergeXmlDelta(graph, pendingEdges, xmlNode)`** -- parse with `mxUtils.parseXml()`, iterate `<root>` children:
   - Existing cells: update style, value, geometry
   - New cells: insert with parent resolution; edges with missing terminals go to `pendingEdges`
   - Vertices without geometry: hidden initially (prevent label flash at origin)
4. **`queueCellAnimation(graph, newIds)`** -- 200ms debounced fade-in (0.4s ease-out opacity transition)
5. **`streamFollowNewCells(graph)`** -- compute bounding box, lerp viewport (factor 0.15) toward new content

### Agent Streaming Detection

The Viewer needs to know when the Agent is actively writing. Options:

- **Primary:** Track file modification frequency. If `.drawio` file changes within the last ~2 seconds, assume streaming. After 2s of no changes, transition to final render.
- **Fallback:** The framework's `contentVersion` prop increments on each file change batch. Debounce: if no new `contentVersion` for 2s, streaming is over.

This avoids needing a dedicated WS message for streaming state -- it's purely reactive to file changes.

## File Structure

```
modes/diagram/
├── manifest.ts                  # ModeManifest
├── pneuma-mode.ts               # ModeDefinition (manifest + viewer binding)
├── seed/
│   └── diagram.drawio           # Welcome diagram (workflow + prompt tips)
├── skill/
│   ├── SKILL.md                 # Agent guidelines (format, rules, patterns)
│   └── references/
│       ├── xml-reference.md     # mxGraphModel XML complete reference
│       └── style-reference.md   # Style properties reference
├── viewer/
│   ├── DiagramPreview.tsx       # Main viewer component
│   ├── useStreamRender.ts       # Streaming hook (heal → merge → animate → follow)
│   ├── useGraphViewer.ts        # Final render hook (GraphViewer initialization)
│   └── drawio-loader.ts         # Lazy load viewer-static.min.js from CDN
└── showcase/
    └── showcase.json            # Launcher gallery metadata
```

## Viewer Component: DiagramPreview.tsx

### Props (ViewerPreviewProps)

Standard Pneuma viewer props: `files`, `selection`, `onSelect`, `mode`, `actionRequest`, `onActionResult`, `onActiveFileChange`, `activeFile`, `navigateRequest`, `onNavigateComplete`, `readonly`.

### Lifecycle

```
mount → loadViewerScript() → parse .drawio from files
  │
  ├─ files changing rapidly → streaming mode
  │    └─ healPartialXml → streamMergeXmlDelta → animate → follow
  │
  └─ files stable (2s idle) → final mode
       └─ GraphViewer.createViewerForElement() with toolbar
```

### Preview Modes

| Mode | Behavior |
|------|----------|
| `view` | GraphViewer with zoom/layers toolbar. Pan and zoom. |
| `edit` | Same as view in Phase 1 (no editing capability yet). |
| `select` | Click elements → capture context + thumbnail → `onSelect()` |
| `annotate` | Click elements → annotation popover → save annotation |

### Toolbar

- Zoom in/out/fit (provided by GraphViewer)
- Layers toggle (provided by GraphViewer)
- Theme toggle (light/dark -- `adaptiveColors="auto"` on mxGraphModel)
- **"Open in draw.io"** button -- generates compressed URL via pako deflateRaw + base64, opens `https://app.diagrams.net/?...#create=...`
- File path display in header

### Selection & Context

When user clicks an element in select/annotate mode:
1. Detect clicked cell via `graph.getCellAt(x, y)` or pointer event mapping
2. Build selection context: cell ID, type (vertex/edge), label, style summary
3. Capture thumbnail via SVG export of the relevant portion
4. Call `onSelect()` with `ViewerSelectionContext`

### Echo Detection

Same pattern as draw mode: track `lastSavedContentRef`. When file change arrives, compare to last content we wrote. If identical, skip re-render.

### Multi-File Support

- Watch pattern: `**/*.drawio`
- TopBar navigation for multiple `.drawio` files
- `activeFile` tracking
- `createEmpty()` generates `diagram-N.drawio` with minimal valid XML

## draw.io Library Loading

### Strategy: CDN with Lazy Load

```typescript
// drawio-loader.ts
let loaded = false;
let loading: Promise<void> | null = null;

export function loadDrawio(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (loading) return loading;
  
  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://viewer.diagrams.net/js/viewer-static.min.js';
    script.async = true;
    script.onload = () => { loaded = true; resolve(); };
    script.onerror = reject;
    document.head.appendChild(script);
  });
  
  return loading;
}
```

### Globals After Load

| Global | Purpose |
|--------|---------|
| `GraphViewer` | Final render with UI controls |
| `Graph` | Raw graph for streaming |
| `mxCodec` | XML codec for cell decode |
| `mxUtils` | `parseXml()` utility |
| `mxCell` | Cell constructor |
| `mxGeometry` | Decoded via codec |

### TypeScript Declarations

Add a `drawio.d.ts` in the viewer directory declaring the global types used from `viewer-static.min.js`. Minimal declarations for `Graph`, `GraphViewer`, `mxCodec`, `mxUtils`, `mxCell`, `mxGeometry` with only the methods actually called.

## Skill Design

### SKILL.md

Core agent instructions:
- `.drawio` file format: `<mxfile>` → `<diagram>` → `<mxGraphModel>` → `<root>`
- Structural rules: cell 0 (root container) + cell 1 (default layer) always required
- Edge rules: edges MUST have `<mxGeometry relative="1" as="geometry"/>` child element (not self-closing)
- Style string format: semicolon-separated `key=value` pairs
- Dark mode: always use `adaptiveColors="auto"` on mxGraphModel
- ID conventions: descriptive IDs (`user-box`, `arrow-1-to-2`)
- Common diagram patterns: flowchart, architecture, sequence, ER, mind map
- Shape search guidance: draw.io has 10,000+ shapes across libraries (AWS, Azure, GCP, Cisco, K8s, BPMN, UML, electrical, P&ID, mockup)

### references/xml-reference.md

Complete XML reference adapted from drawio-mcp's `shared/xml-reference.md`:
- mxCell structure (vertex vs edge)
- mxGeometry (absolute vs relative, points, offsets)
- Container/group patterns (`container=1`, `parent` relationships)
- Connection points (`exitX/Y`, `entryX/Y`)
- Labels (HTML mode `html=1`, `whiteSpace=wrap`)
- Multi-page diagrams

### references/style-reference.md

Style properties adapted from drawio-mcp's `shared/style-reference.md`:
- Fill/stroke: `fillColor`, `strokeColor`, `strokeWidth`, `dashed`, `opacity`, `gradientColor`
- Shapes: `shape=` values, `rounded`, `arcSize`
- Text: `fontSize`, `fontFamily`, `fontColor`, `fontStyle` (bitmask), `align`, `verticalAlign`
- Edges: `edgeStyle`, `curved`, `startArrow`, `endArrow`
- Containers: `container=1`, `swimlane`, `startSize`
- Sketch mode: `sketch=1`, `fillStyle=hachure`

## Manifest Configuration

```typescript
export const diagramManifest: ModeManifest = {
  name: "diagram",
  version: "1.0.0",
  displayName: "Diagram",
  description: "Professional diagrams powered by draw.io — flowcharts, architecture, UML, and more",
  icon: "...", // SVG icon (diagram/flowchart themed)
  
  skill: {
    sourceDir: "skill",
    installName: "pneuma-diagram",
    claudeMdSection: "...", // Agent instructions summary
  },
  
  viewer: {
    watchPatterns: ["**/*.drawio"],
    ignorePatterns: [],
    serveDir: ".",
  },
  
  viewerApi: {
    workspace: {
      type: "all",
      multiFile: true,
      hasActiveFile: true,
    },
    locatorDescription: "...", // Navigation card format for .drawio files
    scaffold: {
      description: "Reset the active diagram to empty state",
      clearPatterns: ["(active file)"],
    },
  },
  
  agent: {
    permissionMode: "bypassPermissions",
    greeting: "...", // System info card + brief welcome
  },
  
  init: {
    contentCheckPattern: "**/*.drawio",
    seedFiles: { "modes/diagram/seed/diagram.drawio": "diagram.drawio" },
  },
  
  evolution: {
    directive: "Learn user's diagram preferences: types, layout styles, colors, shapes, connectors",
  },
};
```

## pneuma-mode.ts

```typescript
export const diagramMode: ModeDefinition = {
  manifest: diagramManifest,
  viewer: {
    PreviewComponent: DiagramPreview,
    workspace: {
      type: "all",
      multiFile: true,
      ordered: false,
      hasActiveFile: true,
      topBarNavigation: true,
      resolveItems(files) { /* filter .drawio files */ },
      createEmpty(files) { /* generate diagram-N.drawio */ },
    },
    extractContext(selection, files) {
      // Return <viewer-context mode="diagram" file="...">
      // Include selected element info: type, label, style summary
    },
    updateStrategy: "full-reload",
  },
};
```

## Seed File: diagram.drawio

A welcome diagram similar to draw mode's seed, showing:
1. Title: "Pneuma Diagram"
2. 3-step workflow: Describe → AI generates → Diagram updates (as a proper flowchart)
3. Prompt suggestion cards
4. Selection hint

Uses draw.io's cleaner rendering style (not hand-drawn) with `rounded=1`, proper arrows, and professional color palette.

## "Open in draw.io" Button

Generates a URL using pako compression:
```typescript
function generateDrawioUrl(xml: string): string {
  const encoded = encodeURIComponent(xml);
  const compressed = pako.deflateRaw(encoded);
  const base64 = btoa(Array.from(compressed, b => String.fromCharCode(b)).join(''));
  const createObj = { type: 'xml', compressed: true, data: base64 };
  return `https://app.diagrams.net/?pv=0&grid=0#create=${encodeURIComponent(JSON.stringify(createObj))}`;
}
```

Opens in new tab. User edits there, exports/saves, and places the file back in workspace.

## Dependencies

| Package | Purpose | New? |
|---------|---------|------|
| `pako` | deflateRaw for "Open in draw.io" URL | Yes (lightweight, ~28KB) |

`viewer-static.min.js` is loaded from CDN at runtime -- no npm dependency.

## Registration

Add `diagram` to:
1. `modes/` directory
2. Mode loader (`core/mode-loader.ts`) builtin registry
3. CLAUDE.md builtin modes list

## Phase 2 (Future)

- Embedded draw.io editor via iframe (`embed.diagrams.net`) with postMessage protocol
- `react-drawio` npm package for React wrapper
- Dual mode: streaming render during Agent output, full editor during idle
- autosave events → file sync → Agent reads latest state

# Diagram Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new `diagram` mode that uses draw.io's rendering engine for professional-grade diagram creation with streaming visualization.

**Architecture:** Agent generates mxGraphModel XML and writes `.drawio` files. Viewer loads `viewer-static.min.js` from CDN, renders with raw `Graph` during streaming (incremental XML healing + merge + animations), then switches to `GraphViewer` for final render with toolbar. "Open in draw.io" button provides editing escape hatch.

**Tech Stack:** draw.io `viewer-static.min.js` (CDN), `pako` (already in project), React 19, TypeScript, Zustand

**Spec:** `docs/superpowers/specs/2026-04-06-diagram-mode-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `modes/diagram/manifest.ts` | Create | ModeManifest declaration |
| `modes/diagram/pneuma-mode.ts` | Create | ModeDefinition (manifest + viewer binding) |
| `modes/diagram/viewer/DiagramPreview.tsx` | Create | Main viewer component (dual-mode render, selection, toolbar) |
| `modes/diagram/viewer/drawio-loader.ts` | Create | Lazy CDN script loader for viewer-static.min.js |
| `modes/diagram/viewer/drawio-types.d.ts` | Create | TypeScript declarations for draw.io globals |
| `modes/diagram/viewer/stream-renderer.ts` | Create | Streaming pipeline: healPartialXml, streamMergeXmlDelta, animations, viewport follow |
| `modes/diagram/viewer/drawio-url.ts` | Create | "Open in draw.io" URL generation (pako compress) |
| `modes/diagram/skill/SKILL.md` | Create | Agent instructions for .drawio XML generation |
| `modes/diagram/skill/references/xml-reference.md` | Create | Complete mxGraphModel XML reference |
| `modes/diagram/skill/references/style-reference.md` | Create | Style properties reference |
| `modes/diagram/seed/diagram.drawio` | Create | Welcome diagram seed file |
| `core/mode-loader.ts` | Modify | Add `diagram` to builtin registry |
| `CLAUDE.md` | Modify | Add `diagram` to builtin modes list |

---

### Task 1: Skill Files (Agent Knowledge Base)

The agent skill is the foundation -- it teaches the Agent how to generate valid draw.io XML. This must be done first because all viewer testing depends on having valid XML to render.

**Files:**
- Create: `modes/diagram/skill/SKILL.md`
- Create: `modes/diagram/skill/references/xml-reference.md`
- Create: `modes/diagram/skill/references/style-reference.md`

- [ ] **Step 1: Create SKILL.md**

```markdown
# Pneuma Diagram Mode

You create professional diagrams using draw.io's XML format. Files use the `.drawio` extension and are fully compatible with the draw.io desktop and web editor.

## File Format

Every `.drawio` file uses this structure:

```xml
<mxfile>
  <diagram id="page-1" name="Page-1">
    <mxGraphModel adaptiveColors="auto" dx="0" dy="0" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        <!-- your diagram cells here -->
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
```

### Critical Rules

1. **Cell 0 and Cell 1 are mandatory** -- Cell 0 is the root container, Cell 1 (parent="0") is the default layer. Never omit them.
2. **Vertices need `vertex="1"`**, edges need `edge="1"`** -- these are mutually exclusive.
3. **Every edge MUST have a child element**: `<mxGeometry relative="1" as="geometry"/>` -- NOT self-closing on the mxCell tag. This is a separate child element.
4. **Use `adaptiveColors="auto"`** on mxGraphModel for automatic dark mode support.
5. **No XML comments** (`<!-- -->`) inside the diagram content -- they cause parsing issues.
6. **All IDs must be unique** within the diagram. Use descriptive IDs like `"user-box"`, `"arrow-1-2"`.
7. **Escape special characters** in values: `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#39;`

### Style String Format

Styles are semicolon-separated `key=value` pairs on the `style` attribute:
```
rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;
```

### Common Patterns

**Rounded rectangle (node):**
```xml
<mxCell id="node-1" value="Process Step" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1">
  <mxGeometry x="100" y="100" width="160" height="60" as="geometry"/>
</mxCell>
```

**Diamond (decision):**
```xml
<mxCell id="decision-1" value="Yes / No?" style="rhombus;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;" vertex="1" parent="1">
  <mxGeometry x="100" y="200" width="120" height="80" as="geometry"/>
</mxCell>
```

**Arrow (edge):**
```xml
<mxCell id="edge-1" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=1;" edge="1" source="node-1" target="decision-1" parent="1">
  <mxGeometry relative="1" as="geometry"/>
</mxCell>
```

**Labeled arrow:**
```xml
<mxCell id="edge-2" value="Yes" style="edgeStyle=orthogonalEdgeStyle;rounded=1;" edge="1" source="decision-1" target="node-2" parent="1">
  <mxGeometry relative="1" as="geometry"/>
</mxCell>
```

**Container / group:**
```xml
<mxCell id="group-1" value="Service Layer" style="rounded=1;whiteSpace=wrap;html=1;container=1;collapsible=0;fillColor=#f5f5f5;strokeColor=#666666;strokeWidth=2;fontStyle=1;verticalAlign=top;spacingTop=10;" vertex="1" parent="1">
  <mxGeometry x="50" y="50" width="400" height="300" as="geometry"/>
</mxCell>
<!-- Children use parent="group-1" with coordinates relative to the group -->
<mxCell id="child-1" value="Handler" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="group-1">
  <mxGeometry x="20" y="50" width="120" height="40" as="geometry"/>
</mxCell>
```

### Color Palette

Use these professional colors for consistency:

| Purpose | Fill | Stroke |
|---------|------|--------|
| Blue (default) | `#dae8fc` | `#6c8ebf` |
| Green (success) | `#d5e8d4` | `#82b366` |
| Yellow (warning) | `#fff2cc` | `#d6b656` |
| Orange (attention) | `#ffe6cc` | `#d79b00` |
| Red (error/danger) | `#f8cecc` | `#b85450` |
| Purple (special) | `#e1d5e7` | `#9673a6` |
| Gray (neutral) | `#f5f5f5` | `#666666` |

### Shape Library

draw.io includes 10,000+ professional shapes. Beyond core shapes (rectangle, ellipse, rhombus, triangle, hexagon, cylinder, cloud), you can use stencil library shapes:

- **AWS**: `shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.lambda`
- **Azure**: `shape=mxgraph.azure.virtual_machine`
- **GCP**: `shape=mxgraph.gcp2.compute_engine`
- **Kubernetes**: `shape=mxgraph.kubernetes.pod`
- **UML**: `shape=umlActor`, `shape=umlLifeline`
- **Network**: `shape=mxgraph.cisco.router`

See `references/style-reference.md` for the complete style properties catalog.
See `references/xml-reference.md` for the complete XML structure reference.

### Tips

- **Layout**: Keep consistent spacing (40-60px gaps between nodes). Align nodes on a grid.
- **Text**: Use `whiteSpace=wrap;html=1;` for text wrapping in nodes. Keep labels concise.
- **Edges**: Use `edgeStyle=orthogonalEdgeStyle;rounded=1;` for clean routed connections.
- **Font**: Default is fine. For emphasis use `fontStyle=1` (bold), `fontStyle=2` (italic), `fontStyle=4` (underline). Combine with addition: `fontStyle=3` = bold+italic.
- **Never change existing cell IDs** when modifying a diagram -- this preserves user selections and viewer state.
```

Save this as `modes/diagram/skill/SKILL.md`.

- [ ] **Step 2: Create xml-reference.md**

Adapt from the drawio-mcp `shared/xml-reference.md`. Create `modes/diagram/skill/references/xml-reference.md` with the complete XML structure reference covering:

- mxfile/diagram/mxGraphModel/root structure
- mxCell attributes (id, value, style, vertex, edge, parent, source, target, connectable, visible)
- mxGeometry (absolute for vertices, relative for edges, points for waypoints, offsets for labels)
- Container patterns (container=1, parent relationships, relative coordinates)
- Layer patterns (cells with parent="0")
- Tags and metadata (object/UserObject wrapper, tags attribute, placeholders)
- Dark mode (adaptiveColors="auto", light-dark() function)
- Critical well-formedness rules (no comments, unique IDs, edge geometry requirement)
- Edge routing (orthogonal, segment, elbow, curved, entity-relation)
- Connection points (exitX/Y, entryX/Y, 0.0-1.0 relative)

Use the content from `/tmp/drawio-mcp/shared/xml-reference.md` as the primary source, adapting for agent consumption.

- [ ] **Step 3: Create style-reference.md**

Adapt from the drawio-mcp `shared/style-reference.md`. Create `modes/diagram/skill/references/style-reference.md` with the complete style catalog covering:

- Style string format and syntax
- Core shape types with examples
- Extended shapes (cube, document, folder, card, etc.)
- Stencil library shapes (AWS, Azure, GCP, Cisco, Kubernetes, UML, mockup)
- Fill/Stroke properties
- Text/Label properties
- Edge/Connector properties
- Arrow markers
- Container/Swimlane properties
- Sketch mode (sketch=1, fillStyle=hachure)
- Predefined style classes (text, edgeLabel, label, group, etc.)
- Color theme classes (blue, green, yellow, orange, red, etc.)
- HTML label patterns
- Validation checklist

Use the content from `/tmp/drawio-mcp/shared/style-reference.md` as the primary source, adapting for agent consumption.

- [ ] **Step 4: Commit skill files**

```bash
git add modes/diagram/skill/
git commit -m "feat(diagram): add agent skill files with draw.io XML reference"
```

---

### Task 2: Seed File

**Files:**
- Create: `modes/diagram/seed/diagram.drawio`

- [ ] **Step 1: Create seed diagram**

Create `modes/diagram/seed/diagram.drawio` -- a welcome diagram that demonstrates the 3-step workflow and suggests prompts. Use proper draw.io XML:

```xml
<mxfile>
  <diagram id="welcome" name="Welcome">
    <mxGraphModel adaptiveColors="auto" dx="0" dy="0" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>

        <!-- Title -->
        <mxCell id="title" value="&lt;b&gt;Pneuma Diagram&lt;/b&gt;" style="text;html=1;align=center;verticalAlign=middle;whiteSpace=wrap;rounded=0;fontSize=28;fontColor=#1a1a1a;" vertex="1" parent="1">
          <mxGeometry x="200" y="20" width="400" height="40" as="geometry"/>
        </mxCell>

        <mxCell id="subtitle" value="Describe in words, AI creates professional diagrams for you" style="text;html=1;align=center;verticalAlign=middle;whiteSpace=wrap;rounded=0;fontSize=14;fontColor=#666666;" vertex="1" parent="1">
          <mxGeometry x="200" y="60" width="400" height="30" as="geometry"/>
        </mxCell>

        <!-- Step 1: Describe -->
        <mxCell id="step-1" value="&lt;b&gt;1. Describe&lt;/b&gt;&lt;br&gt;Tell the AI what to draw" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;fontSize=13;verticalAlign=middle;" vertex="1" parent="1">
          <mxGeometry x="120" y="130" width="160" height="70" as="geometry"/>
        </mxCell>

        <!-- Step 2: Generate -->
        <mxCell id="step-2" value="&lt;b&gt;2. AI Generates&lt;/b&gt;&lt;br&gt;Watch it stream live" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;fontSize=13;verticalAlign=middle;" vertex="1" parent="1">
          <mxGeometry x="340" y="130" width="160" height="70" as="geometry"/>
        </mxCell>

        <!-- Step 3: Diagram -->
        <mxCell id="step-3" value="&lt;b&gt;3. Diagram Ready&lt;/b&gt;&lt;br&gt;Professional quality" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;fontSize=13;verticalAlign=middle;" vertex="1" parent="1">
          <mxGeometry x="560" y="130" width="160" height="70" as="geometry"/>
        </mxCell>

        <!-- Arrows -->
        <mxCell id="arrow-1-2" style="edgeStyle=orthogonalEdgeStyle;rounded=1;strokeColor=#999999;" edge="1" source="step-1" target="step-2" parent="1">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="arrow-2-3" style="edgeStyle=orthogonalEdgeStyle;rounded=1;strokeColor=#999999;" edge="1" source="step-2" target="step-3" parent="1">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>

        <!-- Divider -->
        <mxCell id="divider" value="" style="line;strokeWidth=1;strokeColor=#cccccc;dashed=1;" vertex="1" parent="1">
          <mxGeometry x="120" y="240" width="600" height="10" as="geometry"/>
        </mxCell>

        <!-- Prompt suggestions -->
        <mxCell id="tips-title" value="&lt;b&gt;Try these prompts&lt;/b&gt;" style="text;html=1;align=left;verticalAlign=middle;whiteSpace=wrap;rounded=0;fontSize=14;fontColor=#333333;" vertex="1" parent="1">
          <mxGeometry x="120" y="270" width="200" height="30" as="geometry"/>
        </mxCell>

        <mxCell id="tip-1" value="Draw a user authentication flowchart with login, OAuth, and MFA paths" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#f5f5f5;strokeColor=#cccccc;fontSize=11;align=left;spacingLeft=10;" vertex="1" parent="1">
          <mxGeometry x="120" y="310" width="600" height="36" as="geometry"/>
        </mxCell>

        <mxCell id="tip-2" value="Draw a microservice architecture with API gateway, services, databases, and message queue" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#f5f5f5;strokeColor=#cccccc;fontSize=11;align=left;spacingLeft=10;" vertex="1" parent="1">
          <mxGeometry x="120" y="356" width="600" height="36" as="geometry"/>
        </mxCell>

        <mxCell id="tip-3" value="Draw an ER diagram for an e-commerce system with users, products, orders, and reviews" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#f5f5f5;strokeColor=#cccccc;fontSize=11;align=left;spacingLeft=10;" vertex="1" parent="1">
          <mxGeometry x="120" y="402" width="600" height="36" as="geometry"/>
        </mxCell>

        <!-- Selection hint -->
        <mxCell id="hint" value="Tip: Select elements on the diagram, then chat -- AI knows what you picked" style="text;html=1;align=center;verticalAlign=middle;whiteSpace=wrap;rounded=0;fontSize=11;fontColor=#999999;fontStyle=2;" vertex="1" parent="1">
          <mxGeometry x="200" y="460" width="400" height="30" as="geometry"/>
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
```

- [ ] **Step 2: Commit seed file**

```bash
git add modes/diagram/seed/
git commit -m "feat(diagram): add welcome seed diagram"
```

---

### Task 3: draw.io Library Loader and TypeScript Types

**Files:**
- Create: `modes/diagram/viewer/drawio-loader.ts`
- Create: `modes/diagram/viewer/drawio-types.d.ts`

- [ ] **Step 1: Create drawio-types.d.ts**

Create `modes/diagram/viewer/drawio-types.d.ts` with minimal type declarations for the draw.io globals we actually use:

```typescript
/**
 * Minimal TypeScript declarations for draw.io viewer-static.min.js globals.
 * Only declares methods/properties actually used by DiagramPreview.
 */

interface MxCell {
  id: string;
  value: string | null;
  style: string | null;
  vertex: boolean;
  edge: boolean;
  visible: boolean;
  connectable: boolean;
  source: MxCell | null;
  target: MxCell | null;
  geometry: MxGeometry | null;
  parent: MxCell | null;
}

interface MxGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  relative: boolean;
  points: Array<{ x: number; y: number }> | null;
}

interface MxGraphModel {
  cells: Record<string, MxCell>;
  root: MxCell | null;
  getCell(id: string): MxCell | null;
  add(parent: MxCell, cell: MxCell, index?: number): MxCell;
  setStyle(cell: MxCell, style: string): void;
  setValue(cell: MxCell, value: string): void;
  setGeometry(cell: MxCell, geometry: MxGeometry): void;
  setTerminal(cell: MxCell, terminal: MxCell | null, isSource: boolean): void;
  setVisible(cell: MxCell, visible: boolean): void;
  beginUpdate(): void;
  endUpdate(): void;
  contains(cell: MxCell): boolean;
  getParent(cell: MxCell): MxCell | null;
}

interface MxCellState {
  width: number;
  height: number;
  shape: { node: SVGElement | HTMLElement } | null;
  text: { node: SVGElement | HTMLElement } | null;
}

interface DrawioGraph {
  getModel(): MxGraphModel;
  view: {
    validate(): void;
    getState(cell: MxCell): MxCellState | null;
    scale: number;
    translate: { x: number; y: number };
    scaleAndTranslate(scale: number, tx: number, ty: number): void;
  };
  setEnabled(enabled: boolean): void;
  destroy(): void;
  getCellAt(x: number, y: number, parent?: MxCell | null): MxCell | null;
  createPopAnimations?: (cells: MxCell[], flag: boolean) => unknown[];
  executeAnimations?: (anims: unknown[], done: () => void, d1: number, d2: number) => void;
}

interface DrawioGraphViewer {
  graph: DrawioGraph;
  lightbox: boolean;
}

interface MxCodecInstance {
  lookup: ((id: string) => MxCell | null) | null;
  decode(node: Element): unknown;
  updateElements?: () => void;
}

declare class Graph {
  constructor(container: HTMLElement);
  getModel(): MxGraphModel;
  view: DrawioGraph["view"];
  setEnabled(enabled: boolean): void;
  destroy(): void;
  getCellAt(x: number, y: number, parent?: MxCell | null): MxCell | null;
  createPopAnimations?: DrawioGraph["createPopAnimations"];
  executeAnimations?: DrawioGraph["executeAnimations"];
}

declare class GraphViewer {
  static createViewerForElement(
    element: HTMLElement,
    callback: (viewer: DrawioGraphViewer) => void,
  ): void;
  static processElements(): void;
  graph: DrawioGraph;
}

declare class mxCodec {
  constructor(doc?: Document);
  lookup: ((id: string) => MxCell | null) | null;
  decode(node: Element): unknown;
  updateElements?: () => void;
}

declare namespace mxUtils {
  function parseXml(xml: string): Document;
}

declare class mxCell {
  constructor(value?: string | null, geometry?: MxGeometry | null, style?: string | null);
  id: string;
  value: string | null;
  style: string | null;
  vertex: boolean;
  edge: boolean;
  visible: boolean;
  connectable: boolean;
  source: MxCell | null;
  target: MxCell | null;
  geometry: MxGeometry | null;
  parent: MxCell | null;
}
```

- [ ] **Step 2: Create drawio-loader.ts**

Create `modes/diagram/viewer/drawio-loader.ts`:

```typescript
/**
 * Lazy loader for draw.io viewer-static.min.js from CDN.
 * Exposes Graph, GraphViewer, mxCodec, mxUtils, mxCell globals on window.
 */

const VIEWER_CDN_URL = "https://viewer.diagrams.net/js/viewer-static.min.js";

let loaded = false;
let loading: Promise<void> | null = null;

export function loadDrawio(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (loading) return loading;

  loading = new Promise<void>((resolve, reject) => {
    // Check if already loaded by another path
    if (typeof GraphViewer !== "undefined") {
      loaded = true;
      resolve();
      return;
    }

    const script = document.createElement("script");
    script.src = VIEWER_CDN_URL;
    script.async = true;
    script.onload = () => {
      loaded = true;
      resolve();
    };
    script.onerror = () => reject(new Error("Failed to load draw.io viewer"));
    document.head.appendChild(script);
  });

  return loading;
}

export function isDrawioLoaded(): boolean {
  return loaded;
}
```

- [ ] **Step 3: Commit loader and types**

```bash
git add modes/diagram/viewer/drawio-loader.ts modes/diagram/viewer/drawio-types.d.ts
git commit -m "feat(diagram): add draw.io CDN loader and TypeScript declarations"
```

---

### Task 4: Streaming Renderer

The core streaming pipeline. This is the most complex piece -- ported from drawio-mcp's proven implementation, adapted to work with file-change events instead of MCP callbacks.

**Files:**
- Create: `modes/diagram/viewer/stream-renderer.ts`

- [ ] **Step 1: Create stream-renderer.ts**

Create `modes/diagram/viewer/stream-renderer.ts` with these exported functions:

```typescript
/**
 * Streaming renderer for draw.io diagrams.
 *
 * Ported from drawio-mcp's app-server streaming implementation.
 * Adapted for Pneuma's file-change-driven architecture:
 * - drawio-mcp receives partial XML from MCP tool input callbacks
 * - Pneuma receives complete (but growing) .drawio files from chokidar
 *
 * The pipeline: file XML → extractMxGraphXml → healPartialXml →
 * streamMergeXmlDelta → queueCellAnimation → streamFollowNewCells
 */

// ── Types ────────────────────────────────────────────────────────────────────

interface PendingEdge {
  cell: MxCell;
  sourceId: string | null;
  targetId: string | null;
}

interface StreamState {
  graph: DrawioGraph;
  pendingEdges: PendingEdge[];
  pendingAnimCellIds: string[];
  deferredAnimCellIds: string[];
  animatedCellIds: Record<string, boolean>;
  animDebounceTimer: ReturnType<typeof setTimeout> | null;
}

// ── XML Extraction ───────────────────────────────────────────────────────────

/**
 * Extract the <mxGraphModel> XML from a .drawio file.
 * .drawio wraps content in <mxfile><diagram>...</diagram></mxfile>.
 * The inner content may be raw XML or base64-deflated (we handle raw only
 * since the Agent writes uncompressed XML).
 */
export function extractMxGraphXml(drawioXml: string): string | null {
  // Try to find <mxGraphModel directly (already unwrapped or raw)
  const mgmIdx = drawioXml.indexOf("<mxGraphModel");
  if (mgmIdx !== -1) {
    // Extract from <mxGraphModel to its closing tag (or end of string)
    const endTag = "</mxGraphModel>";
    const endIdx = drawioXml.lastIndexOf(endTag);
    if (endIdx !== -1) {
      return drawioXml.substring(mgmIdx, endIdx + endTag.length);
    }
    // Partial -- return from mxGraphModel to end
    return drawioXml.substring(mgmIdx);
  }
  return null;
}

// ── Partial XML Healing ──────────────────────────────────────────────────────

/**
 * Heal truncated XML by auto-closing unclosed tags.
 * Returns null if the XML is too incomplete to be useful.
 */
export function healPartialXml(partialXml: string): string | null {
  if (partialXml == null || typeof partialXml !== "string") return null;
  if (partialXml.indexOf("<root") === -1) return null;

  const lastClose = partialXml.lastIndexOf(">");
  if (lastClose === -1) return null;

  let xml = partialXml.substring(0, lastClose + 1);
  const stripped = xml.replace(/<!--[\s\S]*?-->/g, "").replace(/<!--[\s\S]*$/, "");

  const tagStack: string[] = [];
  const tagRegex = /<(\/?[a-zA-Z][a-zA-Z0-9]*)[^>]*?(\/?)>/g;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(stripped)) !== null) {
    const nameOrClose = match[1];
    const selfClose = match[2];
    if (match[0].charAt(1) === "?") continue;
    if (selfClose === "/") continue;
    if (nameOrClose.charAt(0) === "/") {
      const closeName = nameOrClose.substring(1);
      if (tagStack.length > 0 && tagStack[tagStack.length - 1] === closeName) {
        tagStack.pop();
      }
    } else {
      tagStack.push(nameOrClose);
    }
  }

  for (let i = tagStack.length - 1; i >= 0; i--) {
    xml += "</" + tagStack[i] + ">";
  }

  return xml;
}

// ── Stream State Management ──────────────────────────────────────────────────

export function createStreamState(graph: DrawioGraph): StreamState {
  return {
    graph,
    pendingEdges: [],
    pendingAnimCellIds: [],
    deferredAnimCellIds: [],
    animatedCellIds: {},
    animDebounceTimer: null,
  };
}

export function destroyStreamState(state: StreamState): void {
  if (state.animDebounceTimer != null) {
    clearTimeout(state.animDebounceTimer);
  }
  state.graph.destroy();
}

// ── Cell ID Tracking ─────────────────────────────────────────────────────────

export function getModelCellIds(model: MxGraphModel): Set<string> {
  return new Set(Object.keys(model.cells));
}

export function findNewCellIds(model: MxGraphModel, prevIds: Set<string>): string[] {
  const newIds: string[] = [];
  for (const id of Object.keys(model.cells)) {
    if (!prevIds.has(id)) newIds.push(id);
  }
  return newIds;
}

// ── Incremental Merge ────────────────────────────────────────────────────────

/**
 * Merge parsed XML into a live Graph instance incrementally.
 * Updates existing cells, inserts new ones, resolves pending edge terminals.
 */
export function streamMergeXmlDelta(state: StreamState, xmlNode: Element): void {
  const { graph } = state;
  if (xmlNode.nodeName !== "mxGraphModel") return;

  const model = graph.getModel();
  const codec = new mxCodec(xmlNode.ownerDocument);
  codec.lookup = (id: string) => model.getCell(id);

  const rootNode = xmlNode.getElementsByTagName("root")[0];
  if (rootNode == null) return;

  const cellNodes = rootNode.childNodes;

  model.beginUpdate();
  try {
    for (let i = 0; i < cellNodes.length; i++) {
      const cellNode = cellNodes[i] as Element;
      if (cellNode.nodeType !== 1) continue;

      let actualCellNode = cellNode;
      if (cellNode.nodeName === "UserObject" || cellNode.nodeName === "object") {
        const inner = cellNode.getElementsByTagName("mxCell");
        if (inner.length > 0) {
          actualCellNode = inner[0];
          if (!actualCellNode.getAttribute("id") && cellNode.getAttribute("id")) {
            actualCellNode.setAttribute("id", cellNode.getAttribute("id")!);
          }
        }
      }

      const id = actualCellNode.getAttribute("id");
      if (id == null) continue;

      const existing = model.getCell(id);

      if (existing != null) {
        // Update existing cell
        const style = actualCellNode.getAttribute("style");
        if (style != null && style !== existing.style) model.setStyle(existing, style);

        const value = actualCellNode.getAttribute("value");
        if (value != null && value !== existing.value) model.setValue(existing, value);

        const geoNodes = actualCellNode.getElementsByTagName("mxGeometry");
        if (geoNodes.length > 0) {
          const geo = codec.decode(geoNodes[0]) as MxGeometry | null;
          if (geo != null) {
            const hadZeroBounds =
              existing.geometry == null || (existing.geometry.width === 0 && existing.geometry.height === 0);
            const hasNonZeroBounds = geo.width > 0 || geo.height > 0;

            model.setGeometry(existing, geo);

            if (hadZeroBounds && hasNonZeroBounds && !state.animatedCellIds[id]) {
              if (!existing.visible) model.setVisible(existing, true);
              const dIdx = state.deferredAnimCellIds.indexOf(id);
              if (dIdx >= 0) state.deferredAnimCellIds.splice(dIdx, 1);
              if (state.pendingAnimCellIds.indexOf(id) === -1) {
                state.pendingAnimCellIds.push(id);
              }
            }
          }
        }
      } else {
        // Insert new cell
        streamInsertCell(state, model, codec, actualCellNode);
      }
    }

    // Resolve pending edges
    const stillPending: PendingEdge[] = [];
    for (const entry of state.pendingEdges) {
      if (!model.contains(entry.cell)) continue;
      let resolved = true;

      if (entry.sourceId != null && entry.cell.source == null) {
        const src = model.getCell(entry.sourceId);
        if (src != null) model.setTerminal(entry.cell, src, true);
        else resolved = false;
      }
      if (entry.targetId != null && entry.cell.target == null) {
        const tgt = model.getCell(entry.targetId);
        if (tgt != null) model.setTerminal(entry.cell, tgt, false);
        else resolved = false;
      }
      if (resolved) model.setVisible(entry.cell, true);
      else stillPending.push(entry);
    }
    state.pendingEdges = stillPending;
  } finally {
    model.endUpdate();
  }

  // Pre-hide pending animation cells to prevent flash
  if (state.pendingAnimCellIds.length > 0) {
    graph.view.validate();
    for (const animId of state.pendingAnimCellIds) {
      const cell = model.getCell(animId);
      if (cell == null) continue;
      const cellState = graph.view.getState(cell);
      if (cellState?.shape?.node) cellState.shape.node.style.opacity = "0";
      if (cellState?.text?.node) cellState.text.node.style.opacity = "0";
    }
  }
}

function streamInsertCell(
  state: StreamState,
  model: MxGraphModel,
  codec: MxCodecInstance,
  cellNode: Element,
): void {
  const id = cellNode.getAttribute("id");
  const parentId = cellNode.getAttribute("parent");
  const sourceId = cellNode.getAttribute("source");
  const targetId = cellNode.getAttribute("target");
  const value = cellNode.getAttribute("value");
  const style = cellNode.getAttribute("style");
  const isVertex = cellNode.getAttribute("vertex") === "1";
  const isEdge = cellNode.getAttribute("edge") === "1";
  const isConnectable = cellNode.getAttribute("connectable");
  const isVisible = cellNode.getAttribute("visible");

  const cell = new mxCell(value, null, style);
  cell.id = id!;
  cell.vertex = isVertex;
  cell.edge = isEdge;
  if (isConnectable === "0") cell.connectable = false;
  if (isVisible === "0") cell.visible = false;

  const geoNodes = cellNode.getElementsByTagName("mxGeometry");
  let hasGeo = false;
  if (geoNodes.length > 0) {
    const geo = codec.decode(geoNodes[0]) as MxGeometry | null;
    if (geo != null) {
      cell.geometry = geo;
      hasGeo = (geo.width > 0 || geo.height > 0) || geo.relative;
    }
  }

  // Hide vertices without geometry to prevent label flash at (0,0)
  if (isVertex && !hasGeo) {
    cell.visible = false;
  }

  let parent = parentId != null ? model.getCell(parentId) : null;
  if (parent == null && model.root != null) {
    if (id === "0") return;
    if (id === "1") {
      if (model.getCell("1") != null) return;
      parent = model.root;
    } else {
      parent = model.getCell("1") || model.root;
    }
  }
  if (parent == null) return;

  model.add(parent, cell);

  if (isEdge) {
    const source = sourceId != null ? model.getCell(sourceId) : null;
    const target = targetId != null ? model.getCell(targetId) : null;
    let hasMissing = false;

    if (source != null) model.setTerminal(cell, source, true);
    else if (sourceId != null) hasMissing = true;

    if (target != null) model.setTerminal(cell, target, false);
    else if (targetId != null) hasMissing = true;

    if (hasMissing) {
      model.setVisible(cell, false);
      state.pendingEdges.push({ cell, sourceId, targetId });
    }
  }
}

// ── Animations ───────────────────────────────────────────────────────────────

export function queueCellAnimation(state: StreamState, cellIds: string[]): void {
  for (const id of cellIds) {
    state.pendingAnimCellIds.push(id);
  }

  if (state.animDebounceTimer != null) {
    clearTimeout(state.animDebounceTimer);
  }

  state.animDebounceTimer = setTimeout(() => {
    state.animDebounceTimer = null;
    flushCellAnimations(state);
  }, 200);
}

function flushCellAnimations(state: StreamState): void {
  const { graph } = state;
  if (state.pendingAnimCellIds.length === 0) return;

  const ids = state.pendingAnimCellIds;
  state.pendingAnimCellIds = [];

  graph.view.validate();

  const readyCells: MxCell[] = [];
  const deferred: string[] = [];

  for (const id of ids) {
    const cell = graph.getModel().getCell(id);
    if (cell == null) continue;

    const cellState = graph.view.getState(cell);
    const hasBounds = cellState != null && (cellState.width > 1 || cellState.height > 1);

    if (!cell.edge && !hasBounds) {
      deferred.push(id);
      continue;
    }
    readyCells.push(cell);
  }

  if (deferred.length > 0) {
    for (const d of deferred) state.deferredAnimCellIds.push(d);
  }

  if (readyCells.length === 0) return;

  for (const c of readyCells) state.animatedCellIds[c.id] = true;

  const allNodes: (SVGElement | HTMLElement)[] = [];
  for (const c of readyCells) {
    const cellState = graph.view.getState(c);
    if (cellState?.shape?.node) allNodes.push(cellState.shape.node);
    if (cellState?.text?.node) allNodes.push(cellState.text.node);
  }

  if (allNodes.length === 0) return;

  // Fade in via CSS transition
  for (const node of allNodes) {
    node.style.opacity = "0";
    node.style.visibility = "visible";
    node.style.transition = "opacity 0.4s ease-out";
  }

  requestAnimationFrame(() => {
    for (const node of allNodes) node.style.opacity = "1";
    setTimeout(() => {
      for (const node of allNodes) node.style.transition = "";
    }, 450);
  });
}

// ── Viewport Follow ──────────────────────────────────────────────────────────

/**
 * Smoothly pan/zoom the streaming graph to follow newly added cells.
 * Uses lerp for smooth camera convergence.
 */
export function streamFollowNewCells(state: StreamState, container: HTMLElement): void {
  const { graph } = state;
  const model = graph.getModel();

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let cellCount = 0;

  for (const id of Object.keys(model.cells)) {
    if (id === "0" || id === "1") continue;
    const cell = model.cells[id];
    if (!cell.visible) continue;
    const geo = cell.geometry;
    if (geo == null || geo.relative) continue;

    // Accumulate parent offsets for contained cells
    let ox = 0, oy = 0;
    let p = model.getParent(cell);
    while (p != null && p.id !== "0" && p.id !== "1") {
      if (p.geometry != null && !p.geometry.relative) {
        ox += p.geometry.x;
        oy += p.geometry.y;
      }
      p = model.getParent(p);
    }

    const x1 = geo.x + ox;
    const y1 = geo.y + oy;
    const x2 = x1 + (geo.width || 0);
    const y2 = y1 + (geo.height || 0);

    minX = Math.min(minX, x1);
    minY = Math.min(minY, y1);
    maxX = Math.max(maxX, x2);
    maxY = Math.max(maxY, y2);
    cellCount++;
  }

  if (cellCount === 0) return;

  const uw = maxX - minX;
  const uh = maxY - minY;
  if (uw <= 0 && uh <= 0) return;

  const padding = 20;
  const cw = container.clientWidth;
  let ch = container.clientHeight;
  if (cw <= 0 || ch <= 0) return;

  const fitScaleW = (cw - padding * 2) / Math.max(uw, 1);
  let targetScale = Math.min(fitScaleW, 1);
  targetScale = Math.max(targetScale, 0.1);

  // Grow container if needed
  const neededH = Math.ceil(uh * targetScale + padding * 2);
  const streamH = Math.max(400, neededH);
  if (ch < streamH) {
    container.style.height = streamH + "px";
    ch = streamH;
  }

  // Center horizontally, show bottom edge vertically
  const cx = (minX + maxX) / 2;
  const viewH = ch / targetScale;
  const viewW = cw / targetScale;
  const targetTx = viewW / 2 - cx;
  let targetTy: number;

  if (uh <= viewH - (padding * 2) / targetScale) {
    const cy = (minY + maxY) / 2;
    targetTy = viewH / 2 - cy;
  } else {
    const bottomPad = padding / targetScale;
    targetTy = viewH - bottomPad - maxY;
  }

  const curScale = graph.view.scale;
  const curTx = graph.view.translate.x;
  const curTy = graph.view.translate.y;

  const dScale = Math.abs(curScale - targetScale);
  const dTx = Math.abs(curTx - targetTx) * targetScale;
  const dTy = Math.abs(curTy - targetTy) * targetScale;
  if (dScale < 0.005 && dTx < 2 && dTy < 2) return;

  const lerpFactor = 0.15;
  let newScale = curScale + (targetScale - curScale) * lerpFactor;
  let newTx = curTx + (targetTx - curTx) * lerpFactor;
  let newTy = curTy + (targetTy - curTy) * lerpFactor;

  if (Math.abs(newScale - targetScale) < 0.005) newScale = targetScale;
  if (Math.abs(newTx - targetTx) < 1) newTx = targetTx;
  if (Math.abs(newTy - targetTy) < 1) newTy = targetTy;

  graph.view.scaleAndTranslate(newScale, newTx, newTy);
}
```

- [ ] **Step 2: Commit stream renderer**

```bash
git add modes/diagram/viewer/stream-renderer.ts
git commit -m "feat(diagram): add streaming renderer with XML healing, merge, and animations"
```

---

### Task 5: "Open in draw.io" URL Generator

**Files:**
- Create: `modes/diagram/viewer/drawio-url.ts`

- [ ] **Step 1: Create drawio-url.ts**

Create `modes/diagram/viewer/drawio-url.ts`:

```typescript
/**
 * Generate "Open in draw.io" URLs using pako compression.
 */
import pako from "pako";

export function generateDrawioEditUrl(xml: string): string {
  const encoded = encodeURIComponent(xml);
  const compressed = pako.deflateRaw(encoded);
  const base64 = btoa(
    Array.from(compressed, (b: number) => String.fromCharCode(b)).join(""),
  );
  const createObj = { type: "xml", compressed: true, data: base64 };
  return (
    "https://app.diagrams.net/?pv=0&grid=0#create=" +
    encodeURIComponent(JSON.stringify(createObj))
  );
}
```

- [ ] **Step 2: Verify pako is available**

```bash
cd /Users/pandazki/Codes/pneuma-skills && grep '"pako"' package.json
```

If pako is not in package.json dependencies, install it:
```bash
bun add pako && bun add -d @types/pako
```

- [ ] **Step 3: Commit**

```bash
git add modes/diagram/viewer/drawio-url.ts
git commit -m "feat(diagram): add 'Open in draw.io' URL generator"
```

---

### Task 6: Manifest and Mode Definition

**Files:**
- Create: `modes/diagram/manifest.ts`
- Create: `modes/diagram/pneuma-mode.ts`

- [ ] **Step 1: Create manifest.ts**

Create `modes/diagram/manifest.ts`:

```typescript
import type { ModeManifest } from "../../core/types/mode-manifest.js";

const diagramManifest: ModeManifest = {
  name: "diagram",
  version: "1.0.0",
  displayName: "Diagram",
  description: "Professional diagrams powered by draw.io — flowcharts, architecture, UML, and more",
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><path d="M10 6.5h4M6.5 10v4M17.5 10v4"/></svg>`,

  skill: {
    sourceDir: "skill",
    installName: "pneuma-diagram",
    claudeMdSection: `## Pneuma Diagram Mode

You are running inside **Pneuma**, a co-creation environment. The user sees a live preview of draw.io diagrams you create.

### How it works
- You write \`.drawio\` files (draw.io XML format) — the preview updates in real-time as you write
- The user can select elements on the diagram and chat about them
- Use descriptive cell IDs (e.g. "user-box", "arrow-1-2") for stable references
- Always include \`adaptiveColors="auto"\` on mxGraphModel for dark mode support
- See the skill reference files for complete XML and style documentation`,
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
      ordered: false,
      hasActiveFile: true,
    },
    locatorDescription: `After creating diagrams, embed a locator card so the user can navigate to it:
\`\`\`pneuma-locator
data='{"file":"architecture.drawio"}'
\`\`\``,
    scaffold: {
      description: "Reset the active diagram to empty state",
      params: {},
      clearPatterns: ["(active file)"],
    },
  },

  agent: {
    permissionMode: "bypassPermissions",
    greeting: `<system-info pneuma-mode="Pneuma Diagram Mode" skill="pneuma-diagram" session="new"></system-info>
The user just opened a new Diagram session. Greet them briefly (1-2 sentences) and suggest what kind of diagram they might want to create.`,
  },

  init: {
    contentCheckPattern: "**/*.drawio",
    seedFiles: {
      "modes/diagram/seed/diagram.drawio": "diagram.drawio",
    },
  },

  evolution: {
    directive:
      "Learn the user's diagramming preferences: diagram types, layout styles, color choices, shapes, connector styles, labeling conventions, and level of detail.",
  },
};

export default diagramManifest;
```

- [ ] **Step 2: Create pneuma-mode.ts**

Create `modes/diagram/pneuma-mode.ts`:

```typescript
import type { ModeDefinition } from "../../core/types/mode-definition.js";
import type {
  ViewerSelectionContext,
  ViewerFileContent,
} from "../../core/types/viewer-contract.js";
import DiagramPreview from "./viewer/DiagramPreview.js";
import diagramManifest from "./manifest.js";

const _captureRef: {
  current: (() => Promise<{ data: string; media_type: string } | null>) | null;
} = { current: null };

export function setDiagramCaptureViewport(
  fn: (() => Promise<{ data: string; media_type: string } | null>) | null,
) {
  _captureRef.current = fn;
}

const diagramMode: ModeDefinition = {
  manifest: diagramManifest,

  viewer: {
    PreviewComponent: DiagramPreview,

    workspace: {
      type: "all",
      multiFile: true,
      ordered: false,
      hasActiveFile: true,
      topBarNavigation: true,

      resolveItems(files) {
        return files
          .filter((f) => f.path.endsWith(".drawio"))
          .map((f, i) => ({
            path: f.path,
            label: f.path.replace(/^.*\//, "").replace(/\.drawio$/, ""),
            index: i,
          }));
      },

      createEmpty(files) {
        const existing = new Set(files.map((f) => f.path));
        let name = "diagram.drawio";
        let n = 1;
        while (existing.has(name)) {
          name = `diagram-${n++}.drawio`;
        }
        const empty = `<mxfile>
  <diagram id="page-1" name="Page-1">
    <mxGraphModel adaptiveColors="auto" dx="0" dy="0" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;
        return [{ path: name, content: empty }];
      },
    },

    extractContext(
      selection: ViewerSelectionContext | null,
      files: ViewerFileContent[],
    ): string {
      const file =
        selection?.file ||
        files.find((f) => f.path.endsWith(".drawio"))?.path ||
        files[0]?.path ||
        "";
      if (!file) return "";

      if (selection?.type === "annotations" && selection.annotations?.length) {
        const attrs = [`mode="diagram"`, `file="${file}"`];
        const lines: string[] = ["Annotations:"];
        selection.annotations.forEach((ann, i) => {
          const el = ann.element;
          const primary =
            el.label || `${el.type} "${(el.content || "").slice(0, 50)}"`;
          lines.push(`  ${i + 1}. [${ann.slideFile}] ${primary}`);
          if (ann.comment) lines.push(`     Feedback: ${ann.comment}`);
        });
        return `<viewer-context ${attrs.join(" ")}>\n${lines.join("\n")}\n</viewer-context>`;
      }

      const attrs = [`mode="diagram"`, `file="${file}"`];
      const lines: string[] = [];

      if (selection && selection.type !== "viewing" && selection.content) {
        lines.push(
          selection.label
            ? `Selected: ${selection.label}`
            : `Selected: ${selection.content}`,
        );
        if (selection.thumbnail) {
          lines.push("[selection screenshot attached]");
        }
      }

      return `<viewer-context ${attrs.join(" ")}>\n${lines.join("\n")}\n</viewer-context>`;
    },

    updateStrategy: "full-reload",

    async captureViewport() {
      return _captureRef.current ? _captureRef.current() : null;
    },
  },
};

export default diagramMode;
```

- [ ] **Step 3: Commit manifest and mode definition**

```bash
git add modes/diagram/manifest.ts modes/diagram/pneuma-mode.ts
git commit -m "feat(diagram): add manifest and mode definition"
```

---

### Task 7: DiagramPreview Viewer Component

The main React component. Handles dual-mode rendering (streaming vs final), selection, annotation, toolbar, and "Open in draw.io" button.

**Files:**
- Create: `modes/diagram/viewer/DiagramPreview.tsx`

- [ ] **Step 1: Create DiagramPreview.tsx**

Create `modes/diagram/viewer/DiagramPreview.tsx`. This is the largest file. Structure:

```typescript
/**
 * DiagramPreview — Diagram Mode viewer component.
 *
 * Implements ViewerContract's PreviewComponent.
 * Uses draw.io's viewer-static.min.js for rendering:
 * - Streaming mode: raw Graph with incremental XML merge and animations
 * - Final mode: GraphViewer with zoom/layers toolbar
 *
 * Credits:
 * - draw.io / diagrams.net (https://www.drawio.com) — Apache 2.0 licensed
 *   diagramming tool by JGraph Ltd. This mode uses viewer-static.min.js.
 */

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import type {
  ViewerPreviewProps,
  ViewerSelectionContext,
} from "../../../core/types/viewer-contract.js";
import { useStore } from "../../../src/store.js";
import { setDiagramCaptureViewport } from "../pneuma-mode.js";
import ScaffoldConfirm from "../../../src/components/ScaffoldConfirm.js";
import { loadDrawio, isDrawioLoaded } from "./drawio-loader.js";
import {
  extractMxGraphXml,
  healPartialXml,
  createStreamState,
  destroyStreamState,
  getModelCellIds,
  findNewCellIds,
  streamMergeXmlDelta,
  queueCellAnimation,
  streamFollowNewCells,
  type StreamState,
} from "./stream-renderer.js";
import { generateDrawioEditUrl } from "./drawio-url.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function getApiBase(): string {
  const port = (import.meta as any).env?.VITE_API_PORT;
  return port ? `http://localhost:${port}` : "";
}

/** Parse the active .drawio file content from the files array. */
function parseDrawioFile(
  files: ViewerPreviewProps["files"],
  activeFile?: string | null,
): { xml: string; filePath: string } | null {
  const target = activeFile
    ? files.find((f) => f.path === activeFile)
    : files.find((f) => f.path.endsWith(".drawio"));
  if (!target) return null;
  const content = typeof target.content === "string" ? target.content : "";
  if (!content.trim()) return null;
  return { xml: content, filePath: target.path };
}

// ── Component ────────────────────────────────────────────────────────────────

export default function DiagramPreview({
  files,
  selection,
  onSelect,
  mode: rawPreviewMode,
  imageVersion,
  actionRequest,
  onActionResult,
  onActiveFileChange,
  activeFile,
  navigateRequest,
  onNavigateComplete,
  readonly,
  onNotifyAgent,
}: ViewerPreviewProps) {
  const previewMode = readonly ? "view" : rawPreviewMode;
  const setPreviewMode = useStore((s) => s.setPreviewMode);
  const pushUserAction = useStore((s) => s.pushUserAction);
  const annotations = useStore((s) => s.annotations);
  const addAnnotation = useStore((s) => s.addAnnotation);

  // ── State ────────────────────────────────────────────────────────────────

  const [ready, setReady] = useState(isDrawioLoaded());
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    try {
      return (localStorage.getItem("pneuma-diagram-theme") as "light" | "dark") || "light";
    } catch { return "light"; }
  });

  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const streamStateRef = useRef<StreamState | null>(null);
  const graphViewerRef = useRef<DrawioGraphViewer | null>(null);
  const lastRenderedXmlRef = useRef<string>("");
  const streamIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isStreamingRef = useRef(false);
  const lastFileContentRef = useRef<string>("");

  // Annotation popover state
  const [pendingAnnotation, setPendingAnnotation] = useState<{
    file: string;
    selection: ViewerSelectionContext;
    position: { x: number; y: number };
  } | null>(null);

  // Scaffold state
  const [scaffoldPending, setScaffoldPending] = useState<{
    files: string[];
    patterns: string[];
    resolve: (confirmed: boolean) => void;
    source: string;
  } | null>(null);

  // ── Load draw.io library ────────────────────────────────────────────────

  useEffect(() => {
    loadDrawio().then(() => setReady(true));
  }, []);

  // ── Parse current file ──────────────────────────────────────────────────

  const drawioData = useMemo(
    () => parseDrawioFile(files, activeFile),
    [files, activeFile],
  );

  // ── Streaming vs Final render ───────────────────────────────────────────
  //
  // Strategy: when file content changes, enter streaming mode (raw Graph).
  // After 2 seconds of no changes, transition to final mode (GraphViewer).

  useEffect(() => {
    if (!ready || !containerRef.current || !drawioData) return;

    const { xml, filePath } = drawioData;

    // Echo detection: skip if content hasn't changed
    if (xml === lastFileContentRef.current) return;
    lastFileContentRef.current = xml;

    const mgXml = extractMxGraphXml(xml);
    if (!mgXml) return;

    const healed = healPartialXml(mgXml);
    if (!healed) return;

    let xmlDoc: Document;
    try {
      xmlDoc = mxUtils.parseXml(healed);
    } catch {
      return; // Unparseable, wait for more content
    }
    const xmlNode = xmlDoc.documentElement;

    // ── Enter or continue streaming mode ──────────────────────────────
    isStreamingRef.current = true;

    if (!streamStateRef.current) {
      // Destroy any existing GraphViewer
      if (graphViewerRef.current) {
        graphViewerRef.current = null;
      }
      containerRef.current.innerHTML = "";

      const graphDiv = document.createElement("div");
      graphDiv.style.width = "100%";
      graphDiv.style.height = "100%";
      graphDiv.style.overflow = "hidden";
      containerRef.current.appendChild(graphDiv);
      containerRef.current.style.minHeight = "400px";

      const graph = new Graph(graphDiv) as unknown as DrawioGraph;
      graph.setEnabled(false);
      streamStateRef.current = createStreamState(graph);
    }

    const state = streamStateRef.current;
    const prevIds = getModelCellIds(state.graph.getModel());
    streamMergeXmlDelta(state, xmlNode);
    const newIds = findNewCellIds(state.graph.getModel(), prevIds);

    if (newIds.length > 0) {
      queueCellAnimation(state, newIds);
    }

    streamFollowNewCells(state, containerRef.current);

    // ── Reset idle timer → transition to final after 2s ───────────────
    if (streamIdleTimerRef.current) {
      clearTimeout(streamIdleTimerRef.current);
    }
    streamIdleTimerRef.current = setTimeout(() => {
      transitionToFinal(xml);
    }, 2000);

  }, [ready, drawioData]);

  // ── Transition to final GraphViewer ─────────────────────────────────────

  const transitionToFinal = useCallback((xml: string) => {
    if (!containerRef.current) return;
    isStreamingRef.current = false;

    // Destroy streaming graph
    if (streamStateRef.current) {
      // Crossfade: fade out streaming container
      const streamChild = containerRef.current.firstElementChild as HTMLElement | null;
      if (streamChild) {
        streamChild.style.transition = "opacity 0.3s ease-out";
        streamChild.style.opacity = "0";
      }

      setTimeout(() => {
        if (streamStateRef.current) {
          destroyStreamState(streamStateRef.current);
          streamStateRef.current = null;
        }
        renderFinal(xml);
      }, 300);
    } else {
      renderFinal(xml);
    }
  }, []);

  const renderFinal = useCallback((xml: string) => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = "";
    containerRef.current.style.minHeight = "";
    lastRenderedXmlRef.current = xml;

    const mgXml = extractMxGraphXml(xml);
    if (!mgXml) return;

    const graphDiv = document.createElement("div");
    graphDiv.className = "mxgraph";
    graphDiv.setAttribute(
      "data-mxgraph",
      JSON.stringify({
        highlight: "#0000ff",
        "dark-mode": theme === "dark" ? true : "auto",
        nav: true,
        resize: true,
        toolbar: "zoom layers tags",
        xml: mgXml,
      }),
    );
    containerRef.current.appendChild(graphDiv);

    try {
      GraphViewer.createViewerForElement(graphDiv, (viewer: DrawioGraphViewer) => {
        graphViewerRef.current = viewer;
      });
    } catch (e) {
      console.error("Failed to create GraphViewer:", e);
    }
  }, [theme]);

  // ── Theme persistence ───────────────────────────────────────────────────

  useEffect(() => {
    try { localStorage.setItem("pneuma-diagram-theme", theme); } catch {}
    // Re-render final if not streaming
    if (!isStreamingRef.current && lastRenderedXmlRef.current) {
      renderFinal(lastRenderedXmlRef.current);
    }
  }, [theme, renderFinal]);

  // ── Selection handling ──────────────────────────────────────────────────

  const handleContainerClick = useCallback(
    (e: React.MouseEvent) => {
      if (previewMode !== "select" && previewMode !== "annotate") return;
      if (!graphViewerRef.current && !streamStateRef.current) return;

      const graph = graphViewerRef.current?.graph ?? streamStateRef.current?.graph;
      if (!graph) return;

      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const graphX = e.clientX - rect.left;
      const graphY = e.clientY - rect.top;

      // Transform screen coords to graph coords
      const scale = graph.view.scale;
      const tx = graph.view.translate.x;
      const ty = graph.view.translate.y;
      const modelX = graphX / scale - tx;
      const modelY = graphY / scale - ty;

      const cell = graph.getCellAt(modelX, modelY);
      if (!cell || cell.id === "0" || cell.id === "1") {
        if (previewMode === "select") onSelect(null);
        return;
      }

      const label = cell.value || "";
      const cellType = cell.vertex ? "vertex" : cell.edge ? "edge" : "cell";
      const description = label
        ? `${cellType} "${label.replace(/<[^>]*>/g, "").slice(0, 80)}"`
        : `${cellType} (id: ${cell.id})`;

      const filePath = drawioData?.filePath || "";

      const selectionCtx: ViewerSelectionContext = {
        type: "element",
        content: description,
        label: description,
        file: filePath,
      };

      if (previewMode === "select") {
        onSelect(selectionCtx);
      } else if (previewMode === "annotate") {
        setPendingAnnotation({
          file: filePath,
          selection: selectionCtx,
          position: { x: e.clientX - rect.left, y: e.clientY - rect.top },
        });
      }
    },
    [previewMode, onSelect, drawioData],
  );

  // ── Annotation confirm ──────────────────────────────────────────────────

  const confirmAnnotation = useCallback(
    (comment: string) => {
      if (!pendingAnnotation) return;
      const id = `ann-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      addAnnotation({
        id,
        slideFile: pendingAnnotation.file,
        element: {
          type: "cell",
          content: pendingAnnotation.selection.content || "",
          label: pendingAnnotation.selection.label || "",
        },
        comment,
        timestamp: Date.now(),
      });
      setPendingAnnotation(null);
    },
    [pendingAnnotation, addAnnotation],
  );

  // ── Scaffold action handler ─────────────────────────────────────────────

  useEffect(() => {
    if (!actionRequest || actionRequest.actionId !== "scaffold") return;
    const filePath = drawioData?.filePath;
    if (!filePath) {
      onActionResult?.(actionRequest.requestId, {
        success: false,
        message: "No active .drawio file",
      });
      return;
    }

    setScaffoldPending({
      files: [filePath],
      patterns: ["(active file)"],
      resolve: async (confirmed) => {
        if (!confirmed) {
          onActionResult?.(actionRequest.requestId, {
            success: false,
            message: "User cancelled scaffold",
          });
          setScaffoldPending(null);
          return;
        }
        try {
          const emptyXml = `<mxfile>\n  <diagram id="page-1" name="Page-1">\n    <mxGraphModel adaptiveColors="auto" dx="0" dy="0" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" math="0" shadow="0">\n      <root>\n        <mxCell id="0"/>\n        <mxCell id="1" parent="0"/>\n      </root>\n    </mxGraphModel>\n  </diagram>\n</mxfile>`;
          await fetch(`${getApiBase()}/api/files`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: filePath, content: emptyXml }),
          });
          onActionResult?.(actionRequest.requestId, {
            success: true,
            message: `Diagram "${filePath}" reset to empty`,
          });
        } catch (e) {
          onActionResult?.(actionRequest.requestId, {
            success: false,
            message: `Failed to reset: ${e}`,
          });
        }
        setScaffoldPending(null);
      },
      source: "scaffold",
    });
  }, [actionRequest]);

  // ── Navigate request ────────────────────────────────────────────────────

  useEffect(() => {
    if (!navigateRequest) return;
    const data = navigateRequest.data as { file?: string } | undefined;
    if (data?.file) {
      onActiveFileChange?.(data.file);
    }
    onNavigateComplete?.();
  }, [navigateRequest]);

  // ── "Open in draw.io" ──────────────────────────────────────────────────

  const openInDrawio = useCallback(() => {
    if (!drawioData) return;
    const url = generateDrawioEditUrl(drawioData.xml);
    window.open(url, "_blank");
  }, [drawioData]);

  // ── Escape key ──────────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (pendingAnnotation) {
          setPendingAnnotation(null);
        } else if (previewMode === "select" || previewMode === "annotate") {
          setPreviewMode("view");
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [pendingAnnotation, previewMode, setPreviewMode]);

  // ── Capture viewport for agent ──────────────────────────────────────────

  useEffect(() => {
    setDiagramCaptureViewport(async () => {
      if (!containerRef.current) return null;
      try {
        // Use html2canvas-style approach: serialize SVG from the container
        const svgEl = containerRef.current.querySelector("svg");
        if (!svgEl) return null;
        const svgData = new XMLSerializer().serializeToString(svgEl);
        const blob = new Blob([svgData], { type: "image/svg+xml" });
        const reader = new FileReader();
        return new Promise((resolve) => {
          reader.onload = () => {
            resolve({
              data: (reader.result as string).split(",")[1],
              media_type: "image/svg+xml",
            });
          };
          reader.readAsDataURL(blob);
        });
      } catch {
        return null;
      }
    });
    return () => setDiagramCaptureViewport(null);
  }, []);

  // ── Cleanup ─────────────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (streamIdleTimerRef.current) clearTimeout(streamIdleTimerRef.current);
      if (streamStateRef.current) destroyStreamState(streamStateRef.current);
    };
  }, []);

  // ── Render ──────────────────────────────────────────────────────────────

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center">
        <DiagramToolbar
          previewMode={previewMode}
          setPreviewMode={setPreviewMode}
          theme={theme}
          setTheme={setTheme}
          filePath={drawioData?.filePath}
          readonly={readonly}
          onOpenInDrawio={openInDrawio}
          hasContent={false}
        />
        <p className="text-neutral-500 text-sm">Loading draw.io viewer...</p>
      </div>
    );
  }

  if (!drawioData) {
    return (
      <div className="flex h-full items-center justify-center">
        <DiagramToolbar
          previewMode={previewMode}
          setPreviewMode={setPreviewMode}
          theme={theme}
          setTheme={setTheme}
          readonly={readonly}
          onOpenInDrawio={openInDrawio}
          hasContent={false}
        />
        <p className="text-neutral-500 text-sm">No .drawio files in workspace</p>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col">
      <DiagramToolbar
        previewMode={previewMode}
        setPreviewMode={setPreviewMode}
        theme={theme}
        setTheme={setTheme}
        filePath={drawioData.filePath}
        readonly={readonly}
        onOpenInDrawio={openInDrawio}
        hasContent={true}
      />

      <div
        ref={containerRef}
        className={`flex-1 overflow-auto ${theme === "dark" ? "bg-neutral-900" : "bg-white"}`}
        style={{ cursor: previewMode === "select" || previewMode === "annotate" ? "crosshair" : "default" }}
        onClick={handleContainerClick}
      />

      {pendingAnnotation && (
        <AnnotationPopover
          position={pendingAnnotation.position}
          onConfirm={confirmAnnotation}
          onCancel={() => setPendingAnnotation(null)}
        />
      )}

      {scaffoldPending && (
        <ScaffoldConfirm
          files={scaffoldPending.files}
          patterns={scaffoldPending.patterns}
          onConfirm={() => scaffoldPending.resolve(true)}
          onCancel={() => scaffoldPending.resolve(false)}
        />
      )}
    </div>
  );
}

// ── Toolbar ──────────────────────────────────────────────────────────────────

function DiagramToolbar({
  previewMode,
  setPreviewMode,
  theme,
  setTheme,
  filePath,
  readonly,
  onOpenInDrawio,
  hasContent,
}: {
  previewMode: string;
  setPreviewMode: (m: "view" | "edit" | "select" | "annotate") => void;
  theme: "light" | "dark";
  setTheme: (t: "light" | "dark") => void;
  filePath?: string;
  readonly?: boolean;
  onOpenInDrawio: () => void;
  hasContent: boolean;
}) {
  const btn = (mode: string, label: string, icon: React.ReactNode) => (
    <button
      onClick={() => setPreviewMode(mode as any)}
      className={`flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors ${
        previewMode === mode
          ? "bg-neutral-700 text-white"
          : "text-neutral-400 hover:text-neutral-200"
      }`}
      title={label}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="flex items-center gap-2 border-b border-neutral-800 bg-neutral-900 px-3 py-1.5">
      {!readonly && (
        <>
          {btn("view", "View", <EyeIcon />)}
          {btn("select", "Select", <CursorIcon />)}
          {btn("annotate", "Annotate", <AnnotateIcon />)}
          <div className="mx-1 h-4 w-px bg-neutral-700" />
        </>
      )}

      <button
        onClick={() => setTheme(theme === "light" ? "dark" : "light")}
        className="text-neutral-400 hover:text-neutral-200 rounded px-1.5 py-1 text-xs"
        title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
      >
        {theme === "light" ? <SunIcon /> : <MoonIcon />}
      </button>

      {hasContent && (
        <button
          onClick={onOpenInDrawio}
          className="text-neutral-400 hover:text-neutral-200 rounded px-2 py-1 text-xs flex items-center gap-1"
          title="Open in draw.io for editing"
        >
          <ExternalLinkIcon />
          Edit in draw.io
        </button>
      )}

      <div className="flex-1" />
      {filePath && (
        <span className="text-neutral-500 text-xs truncate max-w-[200px]">
          {filePath}
        </span>
      )}
    </div>
  );
}

// ── Annotation Popover ───────────────────────────────────────────────────────

function AnnotationPopover({
  position,
  onConfirm,
  onCancel,
}: {
  position: { x: number; y: number };
  onConfirm: (comment: string) => void;
  onCancel: () => void;
}) {
  const [comment, setComment] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  return (
    <div
      className="absolute z-50 rounded-lg border border-neutral-700 bg-neutral-800 p-3 shadow-lg"
      style={{ left: Math.min(position.x, window.innerWidth - 280), top: position.y + 10, width: 260 }}
    >
      <input
        ref={inputRef}
        type="text"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onConfirm(comment);
          if (e.key === "Escape") onCancel();
        }}
        placeholder="Add a comment (optional)"
        className="w-full rounded border border-neutral-600 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-200 placeholder-neutral-500 outline-none focus:border-blue-500"
      />
      <div className="mt-2 flex justify-end gap-2">
        <button onClick={onCancel} className="rounded px-2 py-1 text-xs text-neutral-400 hover:text-neutral-200">
          Cancel
        </button>
        <button
          onClick={() => onConfirm(comment)}
          className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-500"
        >
          Add
        </button>
      </div>
    </div>
  );
}

// ── Icons ────────────────────────────────────────────────────────────────────

const iconClass = "w-3.5 h-3.5";

function EyeIcon() {
  return (
    <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function CursorIcon() {
  return (
    <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
    </svg>
  );
}

function AnnotateIcon() {
  return (
    <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}
```

- [ ] **Step 2: Commit viewer component**

```bash
git add modes/diagram/viewer/DiagramPreview.tsx
git commit -m "feat(diagram): add DiagramPreview viewer with streaming and final render"
```

---

### Task 8: Mode Registration and CLAUDE.md Update

**Files:**
- Modify: `core/mode-loader.ts:92-99` (add diagram entry before closing brace)
- Modify: `CLAUDE.md` (add `diagram` to builtin modes list)

- [ ] **Step 1: Register diagram in mode-loader.ts**

Add the diagram entry to the builtin registry in `core/mode-loader.ts`, after the `gridboard` entry (line 98) and before the closing `};` (line 99):

```typescript
  diagram: {
    type: "builtin",
    manifestLoader: () =>
      import("../modes/diagram/manifest.js").then((m) => m.default),
    definitionLoader: () =>
      import("../modes/diagram/pneuma-mode.js").then((m) => m.default),
  },
```

- [ ] **Step 2: Update CLAUDE.md builtin modes list**

In `CLAUDE.md`, find the line:
```
**Builtin Modes:** `webcraft`, `doc`, `slide`, `draw`, `illustrate`, `remotion`, `gridboard`, `clipcraft`, `mode-maker`, `evolve`
```

Add `diagram` after `draw`:
```
**Builtin Modes:** `webcraft`, `doc`, `slide`, `draw`, `diagram`, `illustrate`, `remotion`, `gridboard`, `clipcraft`, `mode-maker`, `evolve`
```

Also update the modes directory listing line in the Project Structure section:
```
├── modes/{webcraft,doc,slide,draw,diagram,illustrate,remotion,gridboard,clipcraft,mode-maker,evolve}/
```

- [ ] **Step 3: Commit registration**

```bash
git add core/mode-loader.ts CLAUDE.md
git commit -m "feat(diagram): register diagram as builtin mode"
```

---

### Task 9: Smoke Test

**Files:** None (testing only)

- [ ] **Step 1: Verify TypeScript compiles**

```bash
cd /Users/pandazki/Codes/pneuma-skills && bunx tsc --noEmit 2>&1 | head -30
```

Fix any type errors that appear.

- [ ] **Step 2: Verify mode loads in dev server**

```bash
cd /tmp/test-diagram && mkdir -p /tmp/test-diagram
cd /Users/pandazki/Codes/pneuma-skills && bun run dev diagram --workspace /tmp/test-diagram --no-open --port 18100 &
sleep 3
curl -s http://localhost:18100/api/mode-info | head -5
kill %1 2>/dev/null
```

Expected: mode-info returns `{"name":"diagram",...}` without errors.

- [ ] **Step 3: Verify seed file is valid XML**

Parse the seed file to check well-formedness:

```bash
xmllint --noout modes/diagram/seed/diagram.drawio 2>&1
```

Or if xmllint is not available:
```bash
bun -e "const xml = Bun.file('modes/diagram/seed/diagram.drawio').text(); new DOMParser().parseFromString(await xml, 'text/xml')" 2>&1
```

- [ ] **Step 4: Visual verification**

Start the dev server and open in browser. Use chrome-devtools-mcp to screenshot and verify:
- The seed diagram renders correctly
- The toolbar is visible (View, Select, Annotate, theme toggle, "Edit in draw.io")
- The layout follows the project's design tokens (dark zinc bg, neutral toolbar)

- [ ] **Step 5: Commit any fixes**

If any fixes were needed, commit them:
```bash
git add -A && git commit -m "fix(diagram): address smoke test issues"
```

---

### Task 10: Showcase Metadata

**Files:**
- Create: `modes/diagram/showcase/showcase.json`

- [ ] **Step 1: Create showcase.json**

Create `modes/diagram/showcase/showcase.json`:

```json
{
  "tagline": "Professional diagrams powered by draw.io",
  "highlights": [
    {
      "title": "10,000+ Shapes",
      "description": "AWS, Azure, GCP, Kubernetes, UML, BPMN, network, and more"
    },
    {
      "title": "Streaming Render",
      "description": "Watch diagrams build in real-time as AI generates them"
    },
    {
      "title": "draw.io Compatible",
      "description": "Files open directly in draw.io desktop and web editor"
    }
  ]
}
```

- [ ] **Step 2: Commit showcase**

```bash
git add modes/diagram/showcase/
git commit -m "feat(diagram): add showcase metadata"
```

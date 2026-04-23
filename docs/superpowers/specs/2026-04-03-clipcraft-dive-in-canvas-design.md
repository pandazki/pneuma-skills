# ClipCraft xyflow Dive-In Canvas — Design Spec

## Overview

Replace the current per-type dive-in panels (VideoDiveContent, AudioDiveContent, etc.) with an interactive xyflow canvas that visualizes the generation tree for a single clip×layer slot. Each GraphNode becomes an xyflow node with rich preview; parentId links become directed edges flowing left-to-right. The user browses the tree, creates new variants via inline input or agent chat, and explicitly selects which variant to use in the timeline.

This is the feature the Domain Model v2 was built to support — generation trees, provenance tracking, and variant management made visible and interactive.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Canvas scope | Single slot tree per clip×layer | Time axis selects clip, layer dimension selects material type → one observation center node. Focused, matches dive-in semantics. |
| Tree layout | Horizontal L→R (dagre `rankdir: "LR"`) | Evolution/time reads naturally left-to-right. Root (origin) on left, newest generations on right. |
| Node cards | Rich preview for all nodes | User has "dived in" — prioritize intuitiveness over density. Sacrifice node count visibility if needed, not per-node detail. |
| Browse vs bind | Separated | Click = browse (focus + details). Explicit "Use This" button = update slot binding. Safe exploration without accidental timeline changes. |
| Creation input | Canvas inline + agent chat (equivalent) | Inline input near focused node for direct interaction. Agent chat auto-injects dive context for same effect. Both create child nodes. |
| Provenance display | Origin label + user instruction on every node | Each node shows how it was created and what the user asked for. No emoji — SVG icons or text labels only. |
| Live updates | Automatic via file watching | graph.json change → chokidar → WS → store → xyflow re-render. New nodes appear with generating status. |
| Backwards compat | Dropped | No published version exists. Old dive-in panels deleted entirely. |

## Scope

**This spec covers:**
1. DiveCanvas component (ReactFlow wrapper replacing DivePanel)
2. Custom xyflow node types (visual, audio, text) with rich preview
3. NodeShell (shared provenance/status/action UI)
4. Horizontal tree layout hook (dagre)
5. Inline input for variant creation
6. Agent chat dive-context integration
7. Slot binding update flow ("Use This")
8. Store changes (new actions, provenance field)

**Not in scope:**
- Graph pruning / node deletion UI
- Multi-slot canvas (showing multiple layers at once)
- Drag-to-reorder or manual node positioning
- Undo/redo on the canvas

## Domain Model Extension

### New field: `metadata.origin`

Add an `origin` field to GraphNode metadata to track provenance:

```typescript
type NodeOrigin = "upload" | "ai-gen" | "manual" | "ai-search";
```

| Origin | Label | When |
|--------|-------|------|
| `"upload"` | Upload | User uploaded a reference image/asset |
| `"ai-gen"` | AI Generated | Agent called MCP tool to generate |
| `"manual"` | Manual Input | User typed caption/text directly |
| `"ai-search"` | AI Search | Agent searched and fetched from web |

Convention: agent sets `metadata.origin` when creating nodes. Display layer reads it for provenance badge.

### New store action

```typescript
| { type: "UPDATE_SLOT_BINDING"; clipId: string; slot: "visual" | "audio" | "caption"; selectedNodeId: string }
| { type: "UPDATE_BGM_BINDING"; selectedNodeId: string }
```

These update the `selectedNodeId` in a clip's slot binding (or bgm binding) without changing `rootNodeId`. Triggered by "Use This" button.

## Component Architecture

### New Files

| File | Purpose |
|------|---------|
| `dive/DiveCanvas.tsx` | Main container. Wraps `ReactFlowProvider` + `ReactFlow`. Reads slot binding from store, computes tree, renders xyflow. |
| `dive/nodes/NodeShell.tsx` | Shared outer wrapper for all node types. Renders provenance badge, status indicator, "Use This" button, selected/active ring. |
| `dive/nodes/VisualNode.tsx` | Custom xyflow node for image/video. Shows thumbnail or video frame preview, prompt text, model, dimensions/duration. |
| `dive/nodes/AudioNode.tsx` | Custom xyflow node for audio. Shows waveform bars, voice label, duration, text content (for TTS). |
| `dive/nodes/TextNode.tsx` | Custom xyflow node for text (captions). Shows text content preview, editable on focus. |
| `dive/DiveInlineInput.tsx` | Floating input anchored near the focused node. Sends message with dive context. |
| `dive/use-tree-layout.ts` | Hook: takes `SlotBinding` + `AssetGraph` → returns `{ nodes: Node[], edges: Edge[] }` using dagre horizontal layout. |

### Modified Files

| File | Change |
|------|--------|
| `TimelineShell.tsx` | `timelineMode === "dive"` renders `DiveCanvas` instead of `DivePanel` |
| `DiveHeader.tsx` | Keep as-is (back button, layer label, scene nav). Remove content-routing logic. |
| `store/types.ts` | Add `UPDATE_SLOT_BINDING`, `UPDATE_BGM_BINDING` actions. Add `diveFocusedNodeId: string | null` to state. |
| `store/reducer.ts` | Handle new actions. `UPDATE_SLOT_BINDING` patches clip's slot binding. |
| `types.ts` | Document `metadata.origin` convention (no type change needed — metadata is already `Record<string, unknown>`). |

### Deleted Files

| File | Reason |
|------|--------|
| `dive/DivePanel.tsx` | Replaced by DiveCanvas |
| `dive/DiveInput.tsx` | Replaced by DiveInlineInput + chat context |
| `dive/VideoDiveContent.tsx` | Replaced by VisualNode |
| `dive/AudioDiveContent.tsx` | Replaced by AudioNode |
| `dive/CaptionDiveContent.tsx` | Replaced by TextNode |
| `dive/BgmDiveContent.tsx` | BGM uses AudioNode (same kind) |

## Node Card Design

### NodeShell (shared wrapper)

Every xyflow node renders inside NodeShell which provides:

```
┌─────────────────────────────┐
│ [origin badge]  [status dot]│  ← header line
│                             │
│   [type-specific content]   │  ← VisualNode / AudioNode / TextNode
│                             │
│ "user's prompt/instruction" │  ← prompt text (truncated)
│ model · metadata            │  ← secondary info
│                             │
│ [ Use This ] or [✓ Active]  │  ← binding action (only if not browsing root)
└─────────────────────────────┘
```

- **Selected node** (current slot binding): orange border + glow + "Active" badge
- **Focused node** (clicked for browsing): lighter border highlight
- **Other nodes**: default dark border
- **Generating nodes**: pulsing border animation + spinner

### Origin Badge

Small label in top-left of node:

| Origin | Icon | Label text |
|--------|------|------------|
| `upload` | ↑ (upload arrow SVG) | "Upload" |
| `ai-gen` | sparkle SVG | "AI Generated" |
| `manual` | pen SVG | "Manual" |
| `ai-search` | search SVG | "AI Search" |

Styled as a pill: dark background, muted text, small SVG icon. No emoji.

### VisualNode (image/video)

- Thumbnail/frame preview (scaled to ~160×90)
- For video: show a representative frame (use existing `useCurrentFrame` hook pattern for the active video, static thumbnail for others)
- Prompt text below preview
- Metadata line: model name, dimensions, duration (video)

### AudioNode

- Waveform visualization (compact, ~120 bars)
- For TTS: show the spoken text content
- Voice label, duration
- Prompt/instruction if AI-generated

### TextNode

- Text content rendered directly (up to ~3 lines, truncated)
- Font/style info from project config
- Editable textarea when focused (direct edit dispatches UPDATE_SCENE_CAPTION)

## Layout: use-tree-layout Hook

```typescript
function useTreeLayout(
  slotBinding: SlotBinding | null,
  graph: AssetGraph,
  selectedNodeId: string | null,  // current slot binding's selected
  focusedNodeId: string | null,   // user's browsing focus
): { nodes: Node[]; edges: Edge[] }
```

**Algorithm:**
1. If no slot binding, return empty
2. Get tree from `getTreeForSlot(state, slotBinding)` 
3. Run dagre layout with `rankdir: "LR"`, `nodesep: 40`, `ranksep: 120`
4. Map GraphNode → xyflow Node with position from dagre
5. Map parentId links → xyflow Edge
6. Mark the `selectedNodeId` node with `data.isActive = true`
7. Mark the `focusedNodeId` node with `data.isFocused = true`

**Edge styling:**
- Path from root to selected node: orange/highlighted
- Other edges: muted gray
- Derive the "active path" by tracing `getLineage(state, selectedNodeId)`

**Viewport:**
- On mount: `fitView` with padding, centered on `selectedNodeId`
- On focus change: `setCenter` to pan smoothly to focused node

## Inline Input (DiveInlineInput)

A floating input that appears on the canvas, anchored near the focused node.

**Behavior:**
1. Appears when user focuses a node (click)
2. Positioned below or to the right of the focused node (avoid overlap)
3. Shows context: "Based on [node label]:"
4. Enter sends message via `sendUserMessage()` with dive context XML:
   ```xml
   <dive-context layer="visual" clipId="clip-001" focusedNodeId="node-b2">
     make it brighter, add lens flare
   </dive-context>
   ```
5. Input clears after send
6. Also accessible via agent chat — selecting a node in the canvas sets `diveFocusedNodeId` in store, chat input auto-prepends context

**Implementation:** Render as an xyflow panel (absolute positioned within ReactFlow container), not as an xyflow node. Use `useReactFlow().getNode()` to get the focused node's position for anchoring.

## Slot Binding Update Flow

When user clicks "Use This" on a non-active node:

1. Dispatch `UPDATE_SLOT_BINDING` action with `{ clipId, slot, selectedNodeId: clickedNode.id }`
2. Reducer updates the clip's slot binding: `clip[slot].selectedNodeId = newId` (keeps `rootNodeId` unchanged)
3. Reducer also writes the update to storyboard.json via the domain API (or dispatches a side effect)
4. The canvas re-renders — old active node loses orange ring, new one gains it
5. Preview panel (above timeline) updates to show the new selected asset

**For BGM:** Same flow but dispatches `UPDATE_BGM_BINDING`.

**Domain API integration:** The reducer change is local/optimistic. A side effect calls `PATCH /api/domain/storyboard` to persist. If the API call fails, the UI should show an error state (but this is edge-case — agent and viewer share the same server).

## Data Flow

### Reading (store → canvas)

```
store.graph (AssetGraph) + store.storyboard (clips[].visual/audio/caption bindings)
  → useTreeLayout() resolves slot → dagre → xyflow nodes/edges
  → ReactFlow renders with custom node types
```

### Creating (user → agent → store)

```
User types in DiveInlineInput or agent chat
  → sendUserMessage() with <dive-context>
  → Agent reads context, creates pending GraphNode via PATCH /api/domain/graph
  → graph.json updated → chokidar → WS → SYNC_FILES → store.graph updated
  → useTreeLayout() sees new node → xyflow adds it with "generating" animation
  → Agent calls MCP tool, updates node to "ready" via PATCH /api/domain/graph
  → Node re-renders with rich preview content
```

### Selecting (user → store → API)

```
User clicks "Use This" on node
  → dispatch UPDATE_SLOT_BINDING
  → reducer updates clip slot binding (optimistic)
  → side effect: PATCH /api/domain/storyboard
  → canvas re-renders (new active node highlighted)
  → preview panel shows new asset
```

## Styling

Follow existing Ethereal Tech theme:
- Background: `#09090b` with dot grid pattern (xyflow `Background` component with `BackgroundVariant.Dots`)
- Node cards: `#1c1917` fill, `#27272a` or `#3f3f46` border
- Active node: `#431407` fill, `#f97316` border, `box-shadow: 0 0 20px rgba(249,115,22,0.15)`
- Edges: `#3f3f46` default, `#f97316` for active path
- Text: `#e5e5e5` primary, `#a1a1aa` secondary, `#71717a` muted
- Controls/minimap: match dark theme (override xyflow defaults like IllustratePreview does)

Import `@xyflow/react/dist/style.css` and override with CSS variables.

## Files Summary

### New
| File | Purpose |
|------|---------|
| `modes/clipcraft/viewer/timeline/dive/DiveCanvas.tsx` | ReactFlow canvas container |
| `modes/clipcraft/viewer/timeline/dive/nodes/NodeShell.tsx` | Shared node wrapper (provenance, status, actions) |
| `modes/clipcraft/viewer/timeline/dive/nodes/VisualNode.tsx` | Image/video node |
| `modes/clipcraft/viewer/timeline/dive/nodes/AudioNode.tsx` | Audio node |
| `modes/clipcraft/viewer/timeline/dive/nodes/TextNode.tsx` | Text/caption node |
| `modes/clipcraft/viewer/timeline/dive/DiveInlineInput.tsx` | Floating canvas input |
| `modes/clipcraft/viewer/timeline/dive/use-tree-layout.ts` | Dagre layout hook |

### Modified
| File | Change |
|------|--------|
| `modes/clipcraft/viewer/timeline/TimelineShell.tsx` | Render DiveCanvas instead of DivePanel |
| `modes/clipcraft/viewer/timeline/dive/DiveHeader.tsx` | Remove content routing, keep nav |
| `modes/clipcraft/viewer/store/types.ts` | New actions, `diveFocusedNodeId` state |
| `modes/clipcraft/viewer/store/reducer.ts` | Handle UPDATE_SLOT_BINDING, UPDATE_BGM_BINDING, SET_DIVE_FOCUSED_NODE |

### Deleted
| File | Reason |
|------|--------|
| `modes/clipcraft/viewer/timeline/dive/DivePanel.tsx` | Replaced by DiveCanvas |
| `modes/clipcraft/viewer/timeline/dive/DiveInput.tsx` | Replaced by DiveInlineInput |
| `modes/clipcraft/viewer/timeline/dive/VideoDiveContent.tsx` | Replaced by VisualNode |
| `modes/clipcraft/viewer/timeline/dive/AudioDiveContent.tsx` | Replaced by AudioNode |
| `modes/clipcraft/viewer/timeline/dive/CaptionDiveContent.tsx` | Replaced by TextNode |
| `modes/clipcraft/viewer/timeline/dive/BgmDiveContent.tsx` | Replaced by AudioNode |

## Non-Goals

- Graph node deletion UI (can grow freely for now)
- Multi-slot canvas (showing visual + audio + caption trees simultaneously)
- Manual node positioning / drag-to-reorder
- Canvas undo/redo
- Node comparison view (side-by-side diff of two variants)
- Export generation tree as image/document

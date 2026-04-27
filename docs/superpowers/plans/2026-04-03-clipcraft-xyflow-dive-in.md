# ClipCraft xyflow Dive-In Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace flat dive-in panels with an interactive xyflow canvas that visualizes generation trees, enables variant browsing, inline creation, and explicit slot binding selection.

**Architecture:** Each clip×layer slot maps to one generation tree. The tree is laid out horizontally (L→R) using dagre. Custom xyflow nodes (NodeShell + type-specific content) show rich previews with provenance. Users browse by clicking nodes, create variants via inline input, and switch bindings via "Use This" buttons.

**Tech Stack:** @xyflow/react 12, @dagrejs/dagre, React 19, Zustand (via context), existing ClipCraft domain model v2

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `modes/clipcraft/viewer/timeline/dive/DiveCanvas.tsx` | ReactFlowProvider wrapper + ReactFlow canvas. Reads slot binding from store, passes to layout hook, renders xyflow. |
| `modes/clipcraft/viewer/timeline/dive/nodes/NodeShell.tsx` | Shared node wrapper: provenance badge, status indicator, "Use This"/"Active" button, selected/focused ring styling. |
| `modes/clipcraft/viewer/timeline/dive/nodes/VisualNode.tsx` | Custom xyflow node for image/video: thumbnail preview, prompt, model, dimensions/duration. |
| `modes/clipcraft/viewer/timeline/dive/nodes/AudioNode.tsx` | Custom xyflow node for audio: waveform bars, voice label, TTS text, duration. |
| `modes/clipcraft/viewer/timeline/dive/nodes/TextNode.tsx` | Custom xyflow node for text/caption: content preview, editable textarea when focused. |
| `modes/clipcraft/viewer/timeline/dive/DiveInlineInput.tsx` | Floating input panel anchored near focused node. Sends message with `<dive-context>` XML. |
| `modes/clipcraft/viewer/timeline/dive/use-tree-layout.ts` | Hook: SlotBinding + AssetGraph → dagre layout → xyflow `Node[]` + `Edge[]`. |

### Modified Files

| File | Change |
|------|--------|
| `modes/clipcraft/viewer/timeline/TimelineShell.tsx` | Swap `DivePanel` import → `DiveCanvas` |
| `modes/clipcraft/viewer/timeline/dive/DiveHeader.tsx` | Remove emoji from LAYER_META icons, use text/unicode symbols |
| `modes/clipcraft/viewer/store/types.ts` | Add `diveFocusedNodeId`, new actions |
| `modes/clipcraft/viewer/store/reducer.ts` | Handle `UPDATE_SLOT_BINDING`, `UPDATE_BGM_BINDING`, `SET_DIVE_FOCUSED_NODE` |

### Deleted Files

| File | Reason |
|------|--------|
| `modes/clipcraft/viewer/timeline/dive/DivePanel.tsx` | Replaced by DiveCanvas |
| `modes/clipcraft/viewer/timeline/dive/DiveInput.tsx` | Replaced by DiveInlineInput |
| `modes/clipcraft/viewer/timeline/dive/VideoDiveContent.tsx` | Replaced by VisualNode |
| `modes/clipcraft/viewer/timeline/dive/AudioDiveContent.tsx` | Replaced by AudioNode |
| `modes/clipcraft/viewer/timeline/dive/CaptionDiveContent.tsx` | Replaced by TextNode |
| `modes/clipcraft/viewer/timeline/dive/BgmDiveContent.tsx` | Replaced by AudioNode |

---

### Task 1: Install dagre + Store Extensions

**Files:**
- Modify: `package.json` (add `@dagrejs/dagre` + `@types/dagre`)
- Modify: `modes/clipcraft/viewer/store/types.ts`
- Modify: `modes/clipcraft/viewer/store/reducer.ts`

- [ ] **Step 1: Install dagre**

```bash
bun add @dagrejs/dagre && bun add -d @types/dagre
```

- [ ] **Step 2: Add new state field and actions to store types**

In `modes/clipcraft/viewer/store/types.ts`:

Add to `ClipCraftState` interface, after the `focusedLayer` field:

```typescript
  // Dive-in canvas
  diveFocusedNodeId: string | null;
```

Add to `ClipCraftAction` union, after the `SET_FOCUSED_LAYER` action:

```typescript
  // Dive-in canvas
  | { type: "SET_DIVE_FOCUSED_NODE"; nodeId: string | null }
  | { type: "UPDATE_SLOT_BINDING"; clipId: string; slot: "visual" | "audio" | "caption"; selectedNodeId: string }
  | { type: "UPDATE_BGM_BINDING"; selectedNodeId: string }
```

- [ ] **Step 3: Add initial state and reducer cases**

In `modes/clipcraft/viewer/store/reducer.ts`:

Add `diveFocusedNodeId: null` to `initialState` (after `focusedLayer: null`).

Add three new cases to the reducer switch, before the `default` case:

```typescript
    case "SET_DIVE_FOCUSED_NODE":
      return { ...state, diveFocusedNodeId: action.nodeId };

    case "UPDATE_SLOT_BINDING": {
      const sb = state.storyboard as StoryboardV2;
      if (!sb.clips) return state;
      const clips = sb.clips.map(c => {
        if (c.id !== action.clipId) return c;
        const binding = c[action.slot];
        if (!binding) return c;
        return { ...c, [action.slot]: { ...binding, selectedNodeId: action.selectedNodeId } };
      });
      return { ...state, storyboard: { ...sb, clips } };
    }

    case "UPDATE_BGM_BINDING": {
      const sb = state.storyboard as StoryboardV2;
      if (!sb.bgm) return state;
      return {
        ...state,
        storyboard: { ...sb, bgm: { ...sb.bgm, selectedNodeId: action.selectedNodeId } },
      };
    }
```

- [ ] **Step 4: Verify build**

```bash
bun run build 2>&1 | head -20
```

Expected: Build succeeds (or only unrelated warnings).

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lockb modes/clipcraft/viewer/store/types.ts modes/clipcraft/viewer/store/reducer.ts
git commit -m "feat(clipcraft): add dagre dep + dive-in store actions (slot binding, focused node)"
```

---

### Task 2: Tree Layout Hook

**Files:**
- Create: `modes/clipcraft/viewer/timeline/dive/use-tree-layout.ts`

- [ ] **Step 1: Create the layout hook**

Create `modes/clipcraft/viewer/timeline/dive/use-tree-layout.ts`:

```typescript
import { useMemo } from "react";
import dagre from "@dagrejs/dagre";
import type { Node, Edge } from "@xyflow/react";
import type { AssetGraph, SlotBinding, GraphNode } from "../../../types.js";

/** Node width/height constants for dagre layout */
const NODE_WIDTH = 200;
const NODE_HEIGHT = 160;

export interface TreeNodeData {
  graphNode: GraphNode;
  isActive: boolean;
  isFocused: boolean;
  isOnActivePath: boolean;
  clipId: string;
  slot: "visual" | "audio" | "caption" | undefined;
}

/**
 * Takes a slot binding + asset graph and returns positioned xyflow nodes + edges.
 * Layout: horizontal tree, left-to-right (dagre rankdir: LR).
 */
export function useTreeLayout(
  slotBinding: SlotBinding | null,
  graph: AssetGraph,
  diveFocusedNodeId: string | null,
  clipId: string,
  slot: "visual" | "audio" | "caption" | undefined,
): { nodes: Node<TreeNodeData>[]; edges: Edge[] } {
  return useMemo(() => {
    if (!slotBinding) return { nodes: [], edges: [] };

    // 1. Collect all nodes in the tree via BFS from root
    const treeNodes: GraphNode[] = [];
    const queue = [slotBinding.rootNodeId];
    const visited = new Set<string>();
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      const node = graph.nodes[id];
      if (!node) continue;
      treeNodes.push(node);
      for (const n of Object.values(graph.nodes)) {
        if (n.parentId === id && !visited.has(n.id)) {
          queue.push(n.id);
        }
      }
    }

    if (treeNodes.length === 0) return { nodes: [], edges: [] };

    // 2. Build active path (lineage from root to selected)
    const activePath = new Set<string>();
    let cur: string | null = slotBinding.selectedNodeId;
    while (cur) {
      activePath.add(cur);
      const node = graph.nodes[cur];
      cur = node?.parentId ?? null;
    }

    // 3. Dagre layout
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 120 });
    g.setDefaultEdgeLabel(() => ({}));

    for (const node of treeNodes) {
      g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
    }
    for (const node of treeNodes) {
      if (node.parentId && visited.has(node.parentId)) {
        g.setEdge(node.parentId, node.id);
      }
    }

    dagre.layout(g);

    // 4. Map to xyflow nodes
    const xyNodes: Node<TreeNodeData>[] = treeNodes.map(gn => {
      const pos = g.node(gn.id);
      const nodeType =
        gn.kind === "image" || gn.kind === "video" ? "visual" :
        gn.kind === "audio" ? "audio" : "text";
      return {
        id: gn.id,
        type: nodeType,
        position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
        data: {
          graphNode: gn,
          isActive: gn.id === slotBinding.selectedNodeId,
          isFocused: gn.id === diveFocusedNodeId,
          isOnActivePath: activePath.has(gn.id),
          clipId,
          slot,
        },
      };
    });

    // 5. Map to xyflow edges
    const xyEdges: Edge[] = treeNodes
      .filter(gn => gn.parentId && visited.has(gn.parentId))
      .map(gn => {
        const isActive = activePath.has(gn.id) && activePath.has(gn.parentId!);
        return {
          id: `edge-${gn.parentId}-${gn.id}`,
          source: gn.parentId!,
          target: gn.id,
          style: {
            stroke: isActive ? "#f97316" : "#3f3f46",
            strokeWidth: isActive ? 2 : 1,
          },
          animated: gn.status === "generating",
        };
      });

    return { nodes: xyNodes, edges: xyEdges };
  }, [slotBinding, graph, diveFocusedNodeId, clipId, slot]);
}
```

- [ ] **Step 2: Verify build**

```bash
bun run build 2>&1 | head -20
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add modes/clipcraft/viewer/timeline/dive/use-tree-layout.ts
git commit -m "feat(clipcraft): add dagre-based tree layout hook for dive-in canvas"
```

---

### Task 3: NodeShell (Shared Node Wrapper)

**Files:**
- Create: `modes/clipcraft/viewer/timeline/dive/nodes/NodeShell.tsx`

- [ ] **Step 1: Create NodeShell component**

Create `modes/clipcraft/viewer/timeline/dive/nodes/NodeShell.tsx`:

```typescript
import { useCallback } from "react";
import type { GraphNode } from "../../../../types.js";
import { useClipCraftDispatch } from "../../../store/ClipCraftContext.js";

type NodeOrigin = "upload" | "ai-gen" | "manual" | "ai-search";

const ORIGIN_CONFIG: Record<NodeOrigin, { icon: string; label: string }> = {
  "upload":     { icon: "↑", label: "Upload" },
  "ai-gen":     { icon: "✦", label: "AI Generated" },
  "manual":     { icon: "✎", label: "Manual" },
  "ai-search":  { icon: "⌕", label: "AI Search" },
};

const STATUS_COLORS: Record<string, string> = {
  ready: "#22c55e",
  generating: "#f59e0b",
  pending: "#71717a",
  error: "#ef4444",
};

interface Props {
  graphNode: GraphNode;
  isActive: boolean;
  isFocused: boolean;
  clipId?: string;
  slot?: "visual" | "audio" | "caption";
  children: React.ReactNode;
}

export function NodeShell({ graphNode, isActive, isFocused, clipId, slot, children }: Props) {
  const dispatch = useClipCraftDispatch();
  const origin = (graphNode.metadata?.origin as NodeOrigin) ?? "ai-gen";
  const originCfg = ORIGIN_CONFIG[origin] ?? ORIGIN_CONFIG["ai-gen"];
  const statusColor = STATUS_COLORS[graphNode.status] ?? STATUS_COLORS.pending;

  const handleUseThis = useCallback(() => {
    if (slot && clipId) {
      dispatch({ type: "UPDATE_SLOT_BINDING", clipId, slot, selectedNodeId: graphNode.id });
    } else if (clipId === "__bgm__") {
      dispatch({ type: "UPDATE_BGM_BINDING", selectedNodeId: graphNode.id });
    }
  }, [dispatch, clipId, slot, graphNode.id]);

  const handleClick = useCallback(() => {
    dispatch({ type: "SET_DIVE_FOCUSED_NODE", nodeId: graphNode.id });
  }, [dispatch, graphNode.id]);

  const borderColor = isActive ? "#f97316" : isFocused ? "#a1a1aa" : "#3f3f46";
  const bgColor = isActive ? "#431407" : "#1c1917";
  const canBind = slot || clipId === "__bgm__";

  return (
    <div
      onClick={handleClick}
      style={{
        width: 200,
        background: bgColor,
        border: `${isActive ? 2 : 1}px solid ${borderColor}`,
        borderRadius: 10,
        padding: 10,
        cursor: "pointer",
        boxShadow: isActive ? "0 0 20px rgba(249,115,22,0.15)" : "none",
        animation: graphNode.status === "generating" ? "pulse 2s ease-in-out infinite" : undefined,
      }}
    >
      {/* Header: origin badge + status dot */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          background: isActive ? "#7c2d12" : "#27272a",
          padding: "2px 8px",
          borderRadius: 4,
          fontSize: 10,
          color: isActive ? "#fdba74" : "#a1a1aa",
        }}>
          <span style={{ fontSize: 11 }}>{originCfg.icon}</span>
          {originCfg.label}
        </span>
        <span style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: statusColor,
          flexShrink: 0,
        }} />
      </div>

      {/* Type-specific content (children) */}
      {children}

      {/* Prompt / instruction */}
      {graphNode.prompt && (
        <div style={{
          fontSize: 10,
          color: isActive ? "#e5e5e5" : "#a1a1aa",
          marginTop: 8,
          lineHeight: 1.4,
          overflow: "hidden",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
        }}>
          "{graphNode.prompt}"
        </div>
      )}

      {/* Model + metadata line */}
      {graphNode.model && (
        <div style={{ fontSize: 9, color: "#71717a", marginTop: 4 }}>
          {graphNode.model}
          {graphNode.metadata?.duration != null && ` · ${(graphNode.metadata.duration as number).toFixed(1)}s`}
          {graphNode.metadata?.width != null && ` · ${graphNode.metadata.width}×${graphNode.metadata.height}`}
        </div>
      )}

      {/* Use This / Active button */}
      {canBind && (
        <div style={{ marginTop: 8 }}>
          {isActive ? (
            <div style={{
              padding: "4px 0",
              textAlign: "center",
              background: "#7c2d12",
              borderRadius: 4,
              fontSize: 10,
              color: "#fdba74",
            }}>
              ✓ Active
            </div>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); handleUseThis(); }}
              style={{
                width: "100%",
                padding: "4px 0",
                textAlign: "center",
                background: "#27272a",
                border: "1px solid #3f3f46",
                borderRadius: 4,
                fontSize: 10,
                color: "#a1a1aa",
                cursor: "pointer",
              }}
            >
              Use This
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
bun run build 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add modes/clipcraft/viewer/timeline/dive/nodes/NodeShell.tsx
git commit -m "feat(clipcraft): add NodeShell wrapper with provenance badges and binding actions"
```

---

### Task 4: Custom xyflow Node Types (Visual, Audio, Text)

**Files:**
- Create: `modes/clipcraft/viewer/timeline/dive/nodes/VisualNode.tsx`
- Create: `modes/clipcraft/viewer/timeline/dive/nodes/AudioNode.tsx`
- Create: `modes/clipcraft/viewer/timeline/dive/nodes/TextNode.tsx`

- [ ] **Step 1: Create VisualNode**

Create `modes/clipcraft/viewer/timeline/dive/nodes/VisualNode.tsx`:

```typescript
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { TreeNodeData } from "../use-tree-layout.js";
import { NodeShell } from "./NodeShell.js";
import { useWorkspaceUrl } from "../../../hooks/useWorkspaceUrl.js";

export function VisualNode({ data }: NodeProps) {
  const { graphNode, isActive, isFocused, clipId, slot } = data as TreeNodeData;
  const url = useWorkspaceUrl();
  const thumbnail = (graphNode.metadata?.thumbnail as string) ?? graphNode.source;

  return (
    <>
      {graphNode.parentId && <Handle type="target" position={Position.Left} style={{ background: "#3f3f46" }} />}
      <NodeShell graphNode={graphNode} isActive={isActive} isFocused={isFocused} clipId={clipId} slot={slot}>
        <div style={{
          width: "100%",
          height: 90,
          background: "#292524",
          borderRadius: 6,
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}>
          {thumbnail && graphNode.status === "ready" ? (
            <img
              src={url(thumbnail)}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
              draggable={false}
            />
          ) : graphNode.status === "generating" ? (
            <span style={{ color: "#f59e0b", fontSize: 11 }}>Generating...</span>
          ) : graphNode.status === "error" ? (
            <span style={{ color: "#ef4444", fontSize: 11 }}>
              {(graphNode.metadata?.errorMessage as string) ?? "Error"}
            </span>
          ) : (
            <span style={{ color: "#52525b", fontSize: 11 }}>
              {graphNode.kind === "video" ? "Video" : "Image"}
            </span>
          )}
        </div>
      </NodeShell>
      <Handle type="source" position={Position.Right} style={{ background: "#3f3f46" }} />
    </>
  );
}
```

- [ ] **Step 2: Create AudioNode**

Create `modes/clipcraft/viewer/timeline/dive/nodes/AudioNode.tsx`:

```typescript
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { TreeNodeData } from "../use-tree-layout.js";
import { NodeShell } from "./NodeShell.js";

export function AudioNode({ data }: NodeProps) {
  const { graphNode, isActive, isFocused, clipId, slot } = data as TreeNodeData;
  const voice = graphNode.metadata?.voice as string | undefined;
  const duration = graphNode.metadata?.duration as number | undefined;

  return (
    <>
      {graphNode.parentId && <Handle type="target" position={Position.Left} style={{ background: "#3f3f46" }} />}
      <NodeShell graphNode={graphNode} isActive={isActive} isFocused={isFocused} clipId={clipId} slot={slot}>
        {graphNode.content && (
          <div style={{
            background: "#292524",
            borderRadius: 6,
            padding: "8px 10px",
            fontSize: 11,
            color: "#d4d4d8",
            lineHeight: 1.4,
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
          }}>
            {graphNode.content}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 6, fontSize: 10, color: "#71717a" }}>
          {voice && <span>Voice: {voice}</span>}
          {duration != null && <span>{duration.toFixed(1)}s</span>}
        </div>
        {graphNode.status === "generating" && (
          <div style={{ marginTop: 6, fontSize: 10, color: "#f59e0b" }}>Generating...</div>
        )}
        {graphNode.status === "error" && (
          <div style={{ marginTop: 6, fontSize: 10, color: "#ef4444" }}>
            {(graphNode.metadata?.errorMessage as string) ?? "Generation failed"}
          </div>
        )}
      </NodeShell>
      <Handle type="source" position={Position.Right} style={{ background: "#3f3f46" }} />
    </>
  );
}
```

- [ ] **Step 3: Create TextNode**

Create `modes/clipcraft/viewer/timeline/dive/nodes/TextNode.tsx`:

```typescript
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { TreeNodeData } from "../use-tree-layout.js";
import { NodeShell } from "./NodeShell.js";

export function TextNode({ data }: NodeProps) {
  const { graphNode, isActive, isFocused, clipId, slot } = data as TreeNodeData;

  return (
    <>
      {graphNode.parentId && <Handle type="target" position={Position.Left} style={{ background: "#3f3f46" }} />}
      <NodeShell graphNode={graphNode} isActive={isActive} isFocused={isFocused} clipId={clipId} slot={slot}>
        <div style={{
          background: "#292524",
          borderRadius: 6,
          padding: "8px 10px",
          fontSize: 12,
          color: "#e5e5e5",
          lineHeight: 1.5,
          minHeight: 40,
          overflow: "hidden",
          display: "-webkit-box",
          WebkitLineClamp: 4,
          WebkitBoxOrient: "vertical",
        }}>
          {graphNode.content || <span style={{ color: "#52525b", fontStyle: "italic" }}>Empty</span>}
        </div>
      </NodeShell>
      <Handle type="source" position={Position.Right} style={{ background: "#3f3f46" }} />
    </>
  );
}
```

- [ ] **Step 4: Verify build**

```bash
bun run build 2>&1 | head -20
```

- [ ] **Step 5: Commit**

```bash
git add modes/clipcraft/viewer/timeline/dive/nodes/VisualNode.tsx modes/clipcraft/viewer/timeline/dive/nodes/AudioNode.tsx modes/clipcraft/viewer/timeline/dive/nodes/TextNode.tsx
git commit -m "feat(clipcraft): add VisualNode, AudioNode, TextNode custom xyflow nodes"
```

---

### Task 5: DiveInlineInput

**Files:**
- Create: `modes/clipcraft/viewer/timeline/dive/DiveInlineInput.tsx`

- [ ] **Step 1: Create the inline input component**

Create `modes/clipcraft/viewer/timeline/dive/DiveInlineInput.tsx`:

```typescript
import { useState, useCallback } from "react";
import { sendUserMessage } from "../../../../../src/ws.js";
import { useClipCraftState } from "../../store/ClipCraftContext.js";
import type { LayerType } from "../../store/types.js";

interface Props {
  layer: LayerType;
  clipId: string;
  focusedNodeId: string | null;
}

export function DiveInlineInput({ layer, clipId, focusedNodeId }: Props) {
  const [text, setText] = useState("");
  const state = useClipCraftState();
  const focusedNode = focusedNodeId ? state.graph.nodes[focusedNodeId] : null;

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const contextAttrs = [
      `layer="${layer}"`,
      `clipId="${clipId}"`,
      focusedNodeId ? `focusedNodeId="${focusedNodeId}"` : "",
    ].filter(Boolean).join(" ");

    const message = `<dive-context ${contextAttrs}>\n${trimmed}\n</dive-context>`;
    sendUserMessage(message);
    setText("");
  }, [text, layer, clipId, focusedNodeId]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const nodeLabel = focusedNode
    ? (focusedNode.prompt?.slice(0, 30) ?? focusedNode.content?.slice(0, 30) ?? focusedNode.id)
    : null;

  return (
    <div style={{
      position: "absolute",
      bottom: 16,
      left: "50%",
      transform: "translateX(-50%)",
      background: "#1c1917",
      border: "1px solid #f97316",
      borderRadius: 10,
      padding: "10px 14px",
      display: "flex",
      gap: 8,
      alignItems: "center",
      width: 400,
      maxWidth: "calc(100% - 32px)",
      boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
      zIndex: 10,
    }}>
      {nodeLabel && (
        <span style={{
          color: "#71717a",
          fontSize: 11,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          maxWidth: 120,
          flexShrink: 0,
        }}>
          Based on: {nodeLabel}
        </span>
      )}
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Describe what you want to create..."
        style={{
          flex: 1,
          background: "transparent",
          border: "none",
          color: "#e5e5e5",
          fontSize: 12,
          fontFamily: "'Inter', system-ui, sans-serif",
          outline: "none",
          minWidth: 0,
        }}
      />
      <button
        onClick={handleSend}
        disabled={!text.trim()}
        style={{
          background: text.trim() ? "#f97316" : "#3f3f46",
          border: "none",
          borderRadius: 6,
          color: "#fff",
          cursor: text.trim() ? "pointer" : "default",
          padding: "4px 12px",
          fontSize: 11,
          fontWeight: 600,
          flexShrink: 0,
        }}
      >
        Send
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
bun run build 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add modes/clipcraft/viewer/timeline/dive/DiveInlineInput.tsx
git commit -m "feat(clipcraft): add DiveInlineInput for canvas-based variant creation"
```

---

### Task 6: DiveCanvas (Main Container)

**Files:**
- Create: `modes/clipcraft/viewer/timeline/dive/DiveCanvas.tsx`

- [ ] **Step 1: Create DiveCanvas component**

Create `modes/clipcraft/viewer/timeline/dive/DiveCanvas.tsx`:

```typescript
import { useMemo, useEffect } from "react";
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
  ReactFlowProvider,
  useReactFlow,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useClipCraftState, useClipCraftDispatch } from "../../store/ClipCraftContext.js";
import { selectSortedClips } from "../../store/selectors.js";
import type { LayerType } from "../../store/types.js";
import type { StoryboardV2, SlotBinding } from "../../../types.js";
import { useTreeLayout } from "./use-tree-layout.js";
import { DiveHeader } from "./DiveHeader.js";
import { DiveInlineInput } from "./DiveInlineInput.js";
import { VisualNode } from "./nodes/VisualNode.js";
import { AudioNode } from "./nodes/AudioNode.js";
import { TextNode } from "./nodes/TextNode.js";

const RF_DARK_STYLES = `
.react-flow {
  --xy-controls-button-background-color-default: #27272a;
  --xy-controls-button-background-color-hover-default: #3f3f46;
  --xy-controls-button-color-default: #a1a1aa;
  --xy-controls-button-color-hover-default: #fafafa;
  --xy-controls-button-border-color-default: rgba(63, 63, 70, 0.5);
  --xy-controls-box-shadow-default: 0 2px 8px rgba(0,0,0,0.4);
  --xy-minimap-background-color-default: rgba(0,0,0,0.6);
  --xy-minimap-mask-background-color-default: rgba(0,0,0,0.7);
  --xy-minimap-mask-stroke-color-default: rgba(63,63,70,0.5);
  --xy-minimap-node-background-color-default: #f97316;
  --xy-minimap-node-stroke-color-default: transparent;
  --xy-background-color-default: #09090b;
  --xy-background-pattern-dots-color-default: rgba(255,255,255,0.05);
  --xy-node-background-color-default: transparent;
  --xy-node-border-default: none;
  --xy-node-boxshadow-hover-default: none;
  --xy-node-boxshadow-selected-default: none;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}
`;

const nodeTypes: NodeTypes = {
  visual: VisualNode,
  audio: AudioNode,
  text: TextNode,
};

function sceneAtTime(clips: { duration: number }[], globalTime: number): number {
  let cumulative = 0;
  for (let i = 0; i < clips.length; i++) {
    if (globalTime < cumulative + clips[i].duration || i === clips.length - 1) return i;
    cumulative += clips[i].duration;
  }
  return 0;
}

function DiveCanvasInner() {
  const state = useClipCraftState();
  const dispatch = useClipCraftDispatch();
  const { fitView } = useReactFlow();

  const { diveLayer, playback, graph, diveFocusedNodeId } = state;
  const clips = selectSortedClips(state);
  const layer: LayerType = diveLayer ?? "video";

  const activeClipIdx = useMemo(
    () => sceneAtTime(clips, playback.globalTime),
    [clips, playback.globalTime],
  );
  const activeClip = clips[activeClipIdx] ?? null;

  const slotBinding: SlotBinding | null = useMemo(() => {
    if (!activeClip) return null;
    if (layer === "bgm") {
      return (state.storyboard as StoryboardV2).bgm;
    }
    const slotKey = layer === "video" ? "visual" : layer;
    return activeClip[slotKey as keyof typeof activeClip] as SlotBinding | null;
  }, [activeClip, layer, state.storyboard]);

  const clipId = layer === "bgm" ? "__bgm__" : (activeClip?.id ?? "");
  const slotForBinding: "visual" | "audio" | "caption" | undefined = useMemo(() => {
    if (layer === "bgm") return undefined;
    if (layer === "video") return "visual";
    return layer;
  }, [layer]);

  const { nodes, edges } = useTreeLayout(slotBinding, graph, diveFocusedNodeId, clipId, slotForBinding);

  // Fit view when tree changes
  useEffect(() => {
    if (nodes.length > 0) {
      const timer = setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 50);
      return () => clearTimeout(timer);
    }
  }, [nodes.length, fitView]);

  // Clear focused node when exiting dive
  useEffect(() => {
    return () => {
      dispatch({ type: "SET_DIVE_FOCUSED_NODE", nodeId: null });
    };
  }, [dispatch]);

  return (
    <div style={{
      height: "100%",
      display: "flex",
      flexDirection: "column",
      background: "#09090b",
    }}>
      <style>{RF_DARK_STYLES}</style>

      <DiveHeader />

      <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
        {nodes.length > 0 ? (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            proOptions={{ hideAttribution: true }}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            style={{ background: "#09090b" }}
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="rgba(255,255,255,0.04)" />
            <Controls showInteractive={false} />
            <MiniMap nodeColor={() => "#f97316"} pannable zoomable />
          </ReactFlow>
        ) : (
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            color: "#52525b",
            fontSize: 13,
            fontStyle: "italic",
          }}>
            No generation tree for this slot yet. Use the input below to create one.
          </div>
        )}

        <DiveInlineInput layer={layer} clipId={clipId} focusedNodeId={diveFocusedNodeId} />
      </div>

      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "6px 16px",
        borderTop: "1px solid #27272a",
        fontSize: 11,
        flexShrink: 0,
      }}>
        <span style={{ color: "#71717a" }}>{nodes.length} node{nodes.length !== 1 ? "s" : ""}</span>
        {slotBinding && (
          <>
            <span style={{ color: "#3f3f46" }}>|</span>
            <span style={{ color: "#a1a1aa" }}>
              Active: <span style={{ color: "#f97316" }}>{slotBinding.selectedNodeId}</span>
            </span>
          </>
        )}
        <span style={{ marginLeft: "auto", color: "#52525b" }}>
          Click to browse · "Use This" to switch · Type to create
        </span>
      </div>
    </div>
  );
}

export function DiveCanvas() {
  return (
    <ReactFlowProvider>
      <DiveCanvasInner />
    </ReactFlowProvider>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
bun run build 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add modes/clipcraft/viewer/timeline/dive/DiveCanvas.tsx
git commit -m "feat(clipcraft): add DiveCanvas xyflow container with tree visualization"
```

---

### Task 7: Wire Up + Delete Old Files

**Files:**
- Modify: `modes/clipcraft/viewer/timeline/TimelineShell.tsx`
- Modify: `modes/clipcraft/viewer/timeline/dive/DiveHeader.tsx`
- Delete: 6 old dive component files

- [ ] **Step 1: Update TimelineShell to use DiveCanvas**

In `modes/clipcraft/viewer/timeline/TimelineShell.tsx`:

Replace the import:
```typescript
// OLD:
import { DivePanel } from "./dive/DivePanel.js";
// NEW:
import { DiveCanvas } from "./dive/DiveCanvas.js";
```

Replace in JSX (inside the `timelineMode === "dive"` branch):
```typescript
// OLD:
            <DivePanel videoRefs={videoRefs} />
// NEW:
            <DiveCanvas />
```

- [ ] **Step 2: Update DiveHeader to remove emoji icons**

In `modes/clipcraft/viewer/timeline/dive/DiveHeader.tsx`, replace the LAYER_META constant:

```typescript
// OLD:
const LAYER_META: Record<LayerType, { label: string; icon: string; color: string }> = {
  caption: { label: "CAPTION", icon: "Tt", color: "#f97316" },
  video:   { label: "VIDEO",   icon: "🎬", color: "#eab308" },
  audio:   { label: "AUDIO",   icon: "🔊", color: "#38bdf8" },
  bgm:     { label: "BGM",     icon: "♪",  color: "#a78bfa" },
};

// NEW:
const LAYER_META: Record<LayerType, { label: string; icon: string; color: string }> = {
  caption: { label: "CAPTION", icon: "Tt", color: "#f97316" },
  video:   { label: "VIDEO",   icon: "▶",  color: "#eab308" },
  audio:   { label: "AUDIO",   icon: "♪",  color: "#38bdf8" },
  bgm:     { label: "BGM",     icon: "♫",  color: "#a78bfa" },
};
```

- [ ] **Step 3: Delete old dive components**

```bash
rm modes/clipcraft/viewer/timeline/dive/DivePanel.tsx
rm modes/clipcraft/viewer/timeline/dive/DiveInput.tsx
rm modes/clipcraft/viewer/timeline/dive/VideoDiveContent.tsx
rm modes/clipcraft/viewer/timeline/dive/AudioDiveContent.tsx
rm modes/clipcraft/viewer/timeline/dive/CaptionDiveContent.tsx
rm modes/clipcraft/viewer/timeline/dive/BgmDiveContent.tsx
```

- [ ] **Step 4: Verify build — check for broken imports**

```bash
bun run build 2>&1 | head -40
```

If any file still imports deleted modules, fix those imports. Common candidate: `ExplodedView.tsx` may import `DivePanel` — check and fix.

- [ ] **Step 5: Commit**

```bash
git add -A modes/clipcraft/viewer/timeline/
git commit -m "feat(clipcraft): wire DiveCanvas into TimelineShell, delete old dive panels"
```

---

### Task 8: Visual Verification

This task has no code changes — it's a manual verification step.

- [ ] **Step 1: Start dev server**

```bash
bun run dev clipcraft --workspace ~/pneuma-projects/clipcraft-20260402-0903
```

- [ ] **Step 2: Verify dive-in canvas**

Open the browser and test:

1. Expand 3D timeline view
2. Double-click a layer (e.g. video) to enter dive mode
3. Verify the xyflow canvas renders with generation tree nodes (horizontal L→R)
4. Verify provenance badges show on each node
5. Verify the active node (slot's `selectedNodeId`) has orange highlight
6. Click another node — verify it gets a focus ring (lighter border) but active doesn't change
7. Click "Use This" on a non-active node — verify orange highlight moves
8. Type in the inline input — verify message sends with `<dive-context>` wrapper
9. Press Escape — verify return to overview mode
10. Try BGM layer dive-in
11. Check minimap and zoom controls work

- [ ] **Step 3: Take screenshot for verification**

Use the browser to screenshot the dive-in canvas and verify it looks correct.

- [ ] **Step 4: Fix any visual issues found**

Common things to check:
- Node cards not overflowing their bounds
- Edge arrows rendering correctly
- Dark theme CSS variables applied (no white backgrounds)
- Inline input positioned correctly at bottom
- Status bar shows correct node count

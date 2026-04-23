# ClipCraft Domain Model v2 — Design Spec

## Overview

Redesign the ClipCraft data model from a flat `Storyboard { scenes: Scene[] }` structure to a domain-driven model with **generation trees**, **provenance tracking**, and **variant management**. Every generated artifact (image, video, audio, text) lives as a node in a project-wide asset graph. Scenes reference the graph via slot bindings that track both the tree root and the currently selected variant.

This is the foundational layer for:
- **xyflow dive-in** — visualize generation trees as interactive node graphs (follow-up spec)
- **Creative path reproduction** — trace exactly how any result was achieved
- **Preference learning** — understand creator's aesthetic choices across variants
- **Retroactive editing** — go back to any branch point and explore alternatives

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Registry scope | Hybrid: project-wide registry + slot binding | Assets shared globally, scenes bind to selected variants |
| What's an "asset" | Binary assets + text content nodes | Text (captions, prompts) also has provenance; unified `GraphNode` with optional `source` for files |
| Slot reference | Typed: `{ rootNodeId, selectedNodeId }` | Always know the tree origin + current pick without traversing |
| Agent write mechanism | API endpoints with schema validation | JSON can be large; programmatic validation catches errors; PATCH for incremental, PUT for bulk |
| Persistence | Two files: `storyboard.json` + `graph.json` | Separation of concerns; graph can grow large independently |
| Memory management | Metadata + file path references only | Binary files loaded on demand by viewer; never in registry memory |

## Scope

**This spec covers:**
1. Domain entity definitions (TypeScript types)
2. Persistence format (graph.json v1, storyboard.json v2)
3. Domain API endpoints (PATCH/PUT/GET)
4. Schema validation
5. Viewer store changes (new state fields, selectors)
6. Compatibility bridge (v1 → v2 migration in reducer)
7. Skill prompt updates (agent uses new API)

**Follow-up spec (not in scope):**
- xyflow dive-in canvas (depends on this model being in place)
- Creative path visualization
- Preference learning system

## Domain Entities

### Project (Aggregate Root)

The project is the top-level container. It owns the timeline and references the asset graph. Persisted across `project.json` (metadata), `storyboard.json` (timeline), and `graph.json` (assets).

```typescript
// project.json — unchanged from v1
interface ProjectConfig {
  title: string;
  aspectRatio: string;
  resolution: { width: number; height: number };
  fps: number;
  style: {
    captionFont: string;
    captionPosition: "top" | "bottom" | "center";
    captionStyle: "outline" | "background" | "plain";
  };
}
```

### GraphNode (Entity)

Every generated artifact — image, video, audio file, or text content — is a node in the asset graph. Nodes form trees via `parentId` links. The graph is append-mostly: nodes are rarely deleted, allowing full history traversal.

```typescript
interface GraphNode {
  id: string;                          // Unique across project, e.g. "node-a1b2c3"
  kind: "image" | "video" | "audio" | "text";
  status: "pending" | "generating" | "ready" | "error";

  // Lineage
  parentId: string | null;             // What this was derived from (null = root)

  // Content
  source?: string;                     // File path for binary assets (relative to workspace)
  content?: string;                    // Text value for text nodes (caption, TTS script)

  // Generation context (provenance)
  prompt?: string;                     // Generation instruction
  model?: string;                      // Model/provider used
  params?: Record<string, unknown>;    // Model-specific parameters (seed, temperature, etc.)

  // Metadata
  createdAt: number;                   // Timestamp (ms)
  metadata?: Record<string, unknown>;  // Extensible: duration, dimensions, voice, errorMessage, etc.
}
```

**Key properties:**
- `parentId` creates the tree structure. A root node has `parentId: null`.
- `source` is set for binary assets (image/video/audio files). `content` is set for text nodes. Both can be null during `pending`/`generating`.
- `params` preserves reproducibility — same model + prompt + params should produce similar results.
- `metadata` is a flexible bag for type-specific data (video duration, image dimensions, TTS voice ID, error messages).

### AssetGraph (Entity Collection)

The collection of all graph nodes. Persisted as `graph.json`.

```typescript
interface AssetGraph {
  version: 1;
  nodes: Record<string, GraphNode>;    // Keyed by node ID
}
```

### SlotBinding (Value Object)

A pointer from a timeline clip slot into the asset graph. Knows both the tree root (for navigating the full generation history) and the currently selected node.

```typescript
interface SlotBinding {
  rootNodeId: string;                  // Tree origin — for "show me the full history"
  selectedNodeId: string;              // Currently active node — for "what's playing now"
}
```

### Clip (Entity)

Replaces `Scene`. A unit in the timeline with slot bindings to the asset graph.

```typescript
interface Clip {
  id: string;                          // Stable ID, e.g. "clip-001"
  order: number;                       // 1-based sequence position
  duration: number;                    // Seconds
  visual: SlotBinding | null;          // Bound to image or video node
  audio: SlotBinding | null;           // Bound to audio node (TTS)
  caption: SlotBinding | null;         // Bound to text node
  transition: {
    type: "cut" | "crossfade" | "fade-to-black";
    duration: number;
  };
}
```

### Storyboard v2 (Timeline)

The timeline structure. Persisted as `storyboard.json` with `version: 2`.

```typescript
interface StoryboardV2 {
  version: 2;
  clips: Clip[];
  bgm: SlotBinding | null;            // Bound to audio node (BGM)
  characterRefs: CharacterRef[];       // Unchanged from v1
}
```

## Persistence

### graph.json

```json
{
  "version": 1,
  "nodes": {
    "node-a1": {
      "id": "node-a1",
      "kind": "image",
      "status": "ready",
      "parentId": null,
      "source": "assets/images/forest-sunset-seed.png",
      "prompt": "森林日落 温暖色调 4K cinematic",
      "model": "flux-1",
      "params": { "seed": 42 },
      "createdAt": 1775200000000,
      "metadata": { "width": 1920, "height": 1080 }
    },
    "node-b2": {
      "id": "node-b2",
      "kind": "video",
      "status": "ready",
      "parentId": "node-a1",
      "source": "assets/clips/forest-sunset-v1.mp4",
      "prompt": "Camera slowly pushes through forest canopy, warm sunset light",
      "model": "veo-3.1",
      "createdAt": 1775200100000,
      "metadata": { "duration": 5.0, "width": 1920, "height": 1080 }
    },
    "node-c3": {
      "id": "node-c3",
      "kind": "text",
      "status": "ready",
      "parentId": null,
      "content": "每一片叶子都是一块小小的太阳能板",
      "createdAt": 1775200200000
    }
  }
}
```

### storyboard.json (v2)

```json
{
  "version": 2,
  "clips": [
    {
      "id": "clip-001",
      "order": 1,
      "duration": 5.0,
      "visual": {
        "rootNodeId": "node-a1",
        "selectedNodeId": "node-b2"
      },
      "audio": {
        "rootNodeId": "node-d4",
        "selectedNodeId": "node-d4"
      },
      "caption": {
        "rootNodeId": "node-c3",
        "selectedNodeId": "node-c3"
      },
      "transition": { "type": "crossfade", "duration": 0.5 }
    }
  ],
  "bgm": {
    "rootNodeId": "node-e5",
    "selectedNodeId": "node-e5"
  },
  "characterRefs": []
}
```

## Domain API

Agent writes through API endpoints. Server validates schema and referential integrity, then persists and broadcasts to viewer.

### PATCH /api/domain/graph

Merge nodes into the graph. Add new nodes or update existing ones.

```
Request:  { nodes: { "node-xyz": GraphNode, ... } }
Response: { ok: true } | { ok: false, error: string, details?: string[] }
```

**Validation:**
- Each node must have `id`, `kind`, `status`, `createdAt`
- `parentId` (if set) must reference an existing node in the graph (either already persisted or in the same batch)
- `kind` must be one of the valid types
- `source` paths must be under `assets/`

### PUT /api/domain/graph

Full replace of the graph. For bulk operations or restructuring.

```
Request:  { version: 1, nodes: { ... } }
Response: { ok: true } | { ok: false, error: string, details?: string[] }
```

**Validation:** Same per-node validation as PATCH, plus referential integrity across the full graph (no orphaned parentId references).

### PATCH /api/domain/storyboard

Update the storyboard. Clips array is a **full replace** (not merge-by-ID) — the agent sends the complete clips list. This avoids complex merge semantics and matches the agent's read-modify-write pattern. BGM binding is optional — omit to leave unchanged.

```
Request:  { clips?: Clip[], bgm?: SlotBinding | null }
Response: { ok: true } | { ok: false, error: string, details?: string[] }
```

**Validation:**
- All `rootNodeId` and `selectedNodeId` in slot bindings must reference existing nodes in graph.json
- `selectedNodeId` must be a descendant of (or equal to) `rootNodeId`
- Clip IDs must be unique
- `order` values must be sequential with no gaps

### GET /api/domain/state

Read the full domain state. Agent calls this before making changes.

```
Response: { storyboard: StoryboardV2, graph: AssetGraph, project: ProjectConfig }
```

### POST /api/domain/graph/query (optional, future)

Query helpers for common patterns:

```
Request:  { type: "tree", rootNodeId: "node-a1" }
Response: { nodes: GraphNode[] }  // All descendants of root

Request:  { type: "variants", parentId: "node-a1" }
Response: { nodes: GraphNode[] }  // Direct children only

Request:  { type: "lineage", nodeId: "node-b2" }
Response: { path: GraphNode[] }   // From root to this node
```

Not in v1 — agent can derive these from the flat node map. Add when graph grows large enough that full reads become expensive.

## Viewer Store Changes

### New State Fields

```typescript
interface ClipCraftState {
  // Existing
  project: ProjectConfig;
  storyboard: StoryboardV2;    // Updated type

  // New
  graph: AssetGraph;           // The full node graph

  // ... rest unchanged
}
```

### New Selectors (Display-Layer API)

```typescript
/** Resolve a slot binding to its selected GraphNode. Returns null if node not found. */
function resolveSlot(state: ClipCraftState, binding: SlotBinding | null): GraphNode | null;

/** Get all nodes in a generation tree, starting from the root. */
function getTreeForSlot(state: ClipCraftState, binding: SlotBinding | null): GraphNode[];

/** Get direct children (variants) of a node. */
function getVariants(state: ClipCraftState, nodeId: string): GraphNode[];

/** Get the lineage path from root to a specific node. */
function getLineage(state: ClipCraftState, nodeId: string): GraphNode[];

/** Resolve a clip to "flat" display data (for timeline/preview — backwards compat). */
function resolveClipForDisplay(state: ClipCraftState, clip: Clip): {
  visual: { source?: string; prompt?: string; status: string; thumbnail?: string } | null;
  audio: { source?: string; text?: string; voice?: string; status: string; duration?: number } | null;
  caption: string | null;
};
```

`resolveClipForDisplay` is the compatibility bridge — existing timeline/preview components call this instead of reading `scene.visual.source` directly. It resolves slot bindings through the graph transparently.

### Reducer: v1 Compatibility Bridge

The `SYNC_FILES` case detects storyboard version and handles both:

```typescript
case "SYNC_FILES": {
  const storyboard = parseJSON(files, "storyboard.json", EMPTY_STORYBOARD);
  const graph = parseJSON(files, "graph.json", EMPTY_GRAPH);

  if (storyboard.version === 1 || !storyboard.version) {
    // Legacy v1: convert flat scenes to v2 format + synthetic graph nodes
    const { converted, syntheticGraph } = migrateV1ToV2(storyboard);
    return { ...state, storyboard: converted, graph: mergeGraphs(graph, syntheticGraph) };
  }

  return { ...state, storyboard, graph };
}
```

The `migrateV1ToV2` function creates synthetic `GraphNode` entries for each v1 scene's visual/audio/caption, generating stable IDs from scene IDs (e.g. `scene-001` → `node-scene-001-visual`). This ensures existing projects keep working without manual migration.

## Skill Prompt Updates

The agent's skill instructions need to:

1. **Read state via API** — `GET /api/domain/state` instead of reading files directly
2. **Write graph nodes via API** — `PATCH /api/domain/graph` to add/update nodes
3. **Write storyboard via API** — `PATCH /api/domain/storyboard` to update clip bindings
4. **Follow generation protocol** — create `pending` node → call MCP tool → update node to `ready`
5. **Preserve lineage** — always set `parentId` when creating a variant or refinement
6. **Select after generating** — update the clip's `selectedNodeId` to the new node

Example workflow for "make this brighter":
1. Read current state: `GET /api/domain/state`
2. Find the clip's visual binding: `clip.visual.selectedNodeId = "node-b2"`
3. Create new variant node: `PATCH /api/domain/graph` with `{ nodes: { "node-f6": { kind: "video", parentId: "node-b2", status: "generating", prompt: "same but brighter", ... } } }`
4. Call MCP tool to generate
5. Update node: `PATCH /api/domain/graph` with `{ nodes: { "node-f6": { ...updatedFields, status: "ready", source: "assets/clips/..." } } }`
6. Update binding: `PATCH /api/domain/storyboard` with `{ clips: [{ ...clip, visual: { rootNodeId: "node-a1", selectedNodeId: "node-f6" } }] }`

## Files

### New

| File | Purpose |
|------|---------|
| `modes/clipcraft/types.ts` | **Rewrite.** New entity types: `GraphNode`, `AssetGraph`, `SlotBinding`, `Clip`, `StoryboardV2`. Keep `ProjectConfig`, `CharacterRef`, `SceneTransition` unchanged. |
| `server/domain-api.ts` | **New.** Hono routes for `/api/domain/*`. Schema validation, read/write `graph.json` + `storyboard.json`, broadcast changes. |
| `modes/clipcraft/viewer/store/selectors.ts` | **Extend.** Add `resolveSlot`, `getTreeForSlot`, `getVariants`, `getLineage`, `resolveClipForDisplay`. |
| `modes/clipcraft/viewer/store/reducer.ts` | **Modify.** Parse `graph.json`, v1→v2 compatibility bridge in `SYNC_FILES`. |
| `modes/clipcraft/viewer/store/types.ts` | **Modify.** Add `graph: AssetGraph` to state. |
| `modes/clipcraft/skill/rules/storyboard-protocol.md` | **Rewrite.** Agent uses API endpoints, generation tree workflow. |

### Migration Path

| Phase | What changes | What keeps working |
|-------|-------------|-------------------|
| 1. Types + API | New types.ts, domain-api.ts, server routes | Nothing uses them yet |
| 2. Store + selectors | Reducer reads graph.json, new selectors, v1 bridge | All existing components (via resolveClipForDisplay) |
| 3. Skill prompt | Agent writes via API instead of direct file I/O | Viewer already handles both formats |
| 4. Component migration | Components switch from flat scene fields to selectors | Gradual, per-component |

## Non-Goals

- xyflow dive-in canvas (follow-up spec)
- Graph pruning / garbage collection (can grow freely for now)
- Multi-user collaboration / conflict resolution
- Graph versioning / undo-redo
- Binary asset deduplication

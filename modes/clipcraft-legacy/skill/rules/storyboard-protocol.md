# Domain Protocol (v2)

This document defines the protocol for reading and writing project data. The domain model uses two data files:
- `graph.json` — asset generation graph (all variants, lineage, provenance)
- `storyboard.json` — timeline (clips with slot bindings into the graph)

**IMPORTANT: Always use the API endpoints to read and write. Do NOT write these files directly.**

## API Endpoints

### Read State

```
GET /api/domain/state
→ { storyboard, graph, project }
```

Always read before writing. The state may have changed since your last read.

### Update Graph (add/update nodes)

```
PATCH /api/domain/graph
body: { nodes: { "node-id": GraphNode, ... } }
→ { ok: true } or { ok: false, error, details }
```

Merges nodes into the existing graph. Use for adding new generation results or updating status.

### Replace Graph (bulk)

```
PUT /api/domain/graph
body: { version: 1, nodes: { ... } }
→ { ok: true } or { ok: false, error, details }
```

Full replace. Use for restructuring or bulk operations.

### Update Storyboard

```
PATCH /api/domain/storyboard
body: { clips?: Clip[], bgm?: SlotBinding | null }
→ { ok: true } or { ok: false, error, details }
```

`clips` is a full replace of the clips array. `bgm` is optional (omit to keep current).

## Graph Node

Every generated artifact is a node:

```json
{
  "id": "node-a1b2c3",
  "kind": "image" | "video" | "audio" | "text",
  "status": "pending" | "generating" | "ready" | "error",
  "parentId": "node-parent" | null,
  "source": "assets/clips/result.mp4",
  "content": "Text value for text nodes",
  "prompt": "Generation instruction",
  "model": "kling-3-omni",
  "params": { "seed": 42 },
  "createdAt": 1775200000000,
  "metadata": { "duration": 5.0, "width": 1920, "height": 1080 }
}
```

- `parentId` creates lineage. Root nodes have `null`. Variants reference their parent.
- `source` for binary files (relative path under assets/). `content` for text nodes.
- `metadata` is extensible — use for duration, dimensions, voice, errorMessage, thumbnail, etc.

## Slot Binding

Clips reference graph nodes via bindings:

```json
{ "rootNodeId": "node-a1", "selectedNodeId": "node-b2" }
```

- `rootNodeId` — the original starting point of the generation tree
- `selectedNodeId` — the currently chosen variant

## Clip

```json
{
  "id": "clip-001",
  "order": 1,
  "duration": 5.0,
  "visual": { "rootNodeId": "...", "selectedNodeId": "..." },
  "audio": { "rootNodeId": "...", "selectedNodeId": "..." },
  "caption": { "rootNodeId": "...", "selectedNodeId": "..." },
  "transition": { "type": "crossfade", "duration": 0.5 }
}
```

## Generation Workflow

### Creating new content for a clip

1. Read state: `GET /api/domain/state`
2. Create a root node with `status: "generating"`:
   ```
   PATCH /api/domain/graph
   { nodes: { "node-xyz": { id: "node-xyz", kind: "image", status: "generating", parentId: null, prompt: "...", createdAt: <now>, model: "flux-1" } } }
   ```
3. Call MCP tool to generate
4. Update node with result:
   ```
   PATCH /api/domain/graph
   { nodes: { "node-xyz": { ...same, status: "ready", source: "assets/images/result.png" } } }
   ```
5. Bind to clip:
   ```
   PATCH /api/domain/storyboard
   { clips: [ { ...clip, visual: { rootNodeId: "node-xyz", selectedNodeId: "node-xyz" } } ] }
   ```

### Creating a variant ("make this brighter")

1. Read state: `GET /api/domain/state`
2. Find current selected node: `clip.visual.selectedNodeId = "node-abc"`
3. Create variant with `parentId` pointing to current:
   ```
   PATCH /api/domain/graph
   { nodes: { "node-new": { id: "node-new", kind: "video", status: "generating", parentId: "node-abc", prompt: "brighter version", createdAt: <now> } } }
   ```
4. Generate, update status to ready
5. Update binding — keep same `rootNodeId`, change `selectedNodeId`:
   ```
   PATCH /api/domain/storyboard
   { clips: [ { ...clip, visual: { rootNodeId: "node-a1", selectedNodeId: "node-new" } } ] }
   ```

### Key Rules

- **Always set `parentId`** when creating a variant or refinement
- **Always set `status: "generating"` before calling MCP** (viewer shows spinner)
- **Re-read state before writing** (concurrent changes possible)
- **Node IDs must be unique** — use format `node-<random>` (e.g. `node-a1b2c3`)
- **Source paths under `assets/`** — same conventions as before
- **Keep `rootNodeId` stable** — only `selectedNodeId` changes when picking variants

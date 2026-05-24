# ClipCraft Domain Model v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat Storyboard/Scene data model with a domain-driven model featuring generation trees, provenance tracking, and variant management — the foundation for xyflow dive-in and creative workflow learning.

**Architecture:** Two persistence files (`graph.json` for the asset graph, `storyboard.json` v2 for timeline bindings), domain API endpoints with schema validation (`/api/domain/*`), viewer store with graph-aware selectors and a v1→v2 compatibility bridge. The agent writes through API endpoints; the server validates and broadcasts; the viewer resolves slot bindings through the graph.

**Tech Stack:** TypeScript, Hono (server routes), Bun file I/O, React 19 (viewer store/reducer), existing chokidar file watcher for change broadcasts.

---

## File Structure

| File | Responsibility |
|------|---------------|
| `modes/clipcraft/types.ts` | **Rewrite.** Domain entity types: `GraphNode`, `AssetGraph`, `SlotBinding`, `Clip`, `StoryboardV2`. Keep `ProjectConfig`, `CharacterRef`, `SceneTransition`, `ASPECT_RATIOS` unchanged. Keep legacy `Scene`/`Storyboard` types for v1 compat. |
| `modes/clipcraft/domain-validation.ts` | **New.** Schema validation functions for graph nodes and storyboard. Pure functions, no I/O. |
| `server/domain-api.ts` | **New.** Hono route registration: `GET /api/domain/state`, `PATCH /api/domain/graph`, `PUT /api/domain/graph`, `PATCH /api/domain/storyboard`. Reads/writes JSON files, validates, broadcasts. |
| `server/index.ts` | **Modify.** Register domain API routes, watch `graph.json`. |
| `modes/clipcraft/viewer/store/types.ts` | **Modify.** Add `graph: AssetGraph` to `ClipCraftState`. |
| `modes/clipcraft/viewer/store/reducer.ts` | **Modify.** Parse `graph.json` in `SYNC_FILES`, v1→v2 compatibility bridge. |
| `modes/clipcraft/viewer/store/selectors.ts` | **Extend.** Add `resolveSlot`, `getTreeForSlot`, `getVariants`, `getLineage`, `resolveClipForDisplay`. |
| `modes/clipcraft/seed/default/graph.json` | **New.** Empty seed: `{ "version": 1, "nodes": {} }` |
| `modes/clipcraft/skill/rules/storyboard-protocol.md` | **Rewrite.** Agent uses domain API endpoints, generation tree workflow. |

---

### Task 1: Rewrite domain entity types

**Files:**
- Modify: `modes/clipcraft/types.ts`

- [ ] **Step 1: Add new v2 entity types**

In `modes/clipcraft/types.ts`, add the following types **after** the existing types (do NOT delete legacy types yet — they're needed for v1 compat):

```typescript
// ── Domain Model v2 ─────────────────────────────────────────────────────────

/** A node in the asset generation graph. */
export interface GraphNode {
  id: string;
  kind: "image" | "video" | "audio" | "text";
  status: AssetStatus;
  parentId: string | null;
  source?: string;
  content?: string;
  prompt?: string;
  model?: string;
  params?: Record<string, unknown>;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

/** The project-wide asset graph — all generated artifacts and their lineage. */
export interface AssetGraph {
  version: 1;
  nodes: Record<string, GraphNode>;
}

/** Pointer from a timeline slot into the asset graph. */
export interface SlotBinding {
  rootNodeId: string;
  selectedNodeId: string;
}

/** A clip in the timeline (replaces Scene in v2). */
export interface Clip {
  id: string;
  order: number;
  duration: number;
  visual: SlotBinding | null;
  audio: SlotBinding | null;
  caption: SlotBinding | null;
  transition: SceneTransition;
}

/** Storyboard v2 — timeline with slot bindings. */
export interface StoryboardV2 {
  version: 2;
  clips: Clip[];
  bgm: SlotBinding | null;
  characterRefs: CharacterRef[];
}

/** Union type for storyboard — v1 (legacy) or v2. */
export type AnyStoryboard = Storyboard | StoryboardV2;

/** Empty defaults for v2 structures. */
export const EMPTY_GRAPH: AssetGraph = { version: 1, nodes: {} };
export const EMPTY_STORYBOARD_V2: StoryboardV2 = { version: 2, clips: [], bgm: null, characterRefs: [] };
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/pandazki/Codes/pneuma-skills && bun run build`
Expected: Build succeeds (new types are additive, nothing references them yet)

- [ ] **Step 3: Commit**

```bash
git add modes/clipcraft/types.ts
git commit -m "feat(clipcraft): add v2 domain entity types (GraphNode, AssetGraph, SlotBinding, Clip, StoryboardV2)"
```

---

### Task 2: Create domain validation module

**Files:**
- Create: `modes/clipcraft/domain-validation.ts`

- [ ] **Step 1: Write validation tests**

Create `modes/clipcraft/__tests__/domain-validation.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { validateGraphNodes, validateStoryboard } from "../domain-validation.js";
import type { GraphNode, AssetGraph } from "../types.js";

describe("validateGraphNodes", () => {
  test("accepts valid nodes", () => {
    const existing: AssetGraph = { version: 1, nodes: {} };
    const nodes: Record<string, GraphNode> = {
      "node-1": { id: "node-1", kind: "image", status: "ready", parentId: null, createdAt: Date.now(), source: "assets/images/test.png" },
    };
    const result = validateGraphNodes(nodes, existing);
    expect(result.ok).toBe(true);
  });

  test("rejects node with missing id", () => {
    const existing: AssetGraph = { version: 1, nodes: {} };
    const nodes = { "x": { kind: "image", status: "ready", parentId: null, createdAt: Date.now() } } as any;
    const result = validateGraphNodes(nodes, existing);
    expect(result.ok).toBe(false);
    expect(result.errors![0]).toContain("id");
  });

  test("rejects node with invalid kind", () => {
    const existing: AssetGraph = { version: 1, nodes: {} };
    const nodes = { "node-1": { id: "node-1", kind: "pdf", status: "ready", parentId: null, createdAt: Date.now() } } as any;
    const result = validateGraphNodes(nodes, existing);
    expect(result.ok).toBe(false);
  });

  test("rejects node with orphaned parentId", () => {
    const existing: AssetGraph = { version: 1, nodes: {} };
    const nodes: Record<string, GraphNode> = {
      "node-1": { id: "node-1", kind: "video", status: "ready", parentId: "nonexistent", createdAt: Date.now() },
    };
    const result = validateGraphNodes(nodes, existing);
    expect(result.ok).toBe(false);
    expect(result.errors![0]).toContain("parentId");
  });

  test("allows parentId referencing node in same batch", () => {
    const existing: AssetGraph = { version: 1, nodes: {} };
    const nodes: Record<string, GraphNode> = {
      "node-1": { id: "node-1", kind: "image", status: "ready", parentId: null, createdAt: Date.now() },
      "node-2": { id: "node-2", kind: "video", status: "ready", parentId: "node-1", createdAt: Date.now() },
    };
    const result = validateGraphNodes(nodes, existing);
    expect(result.ok).toBe(true);
  });

  test("rejects source path not under assets/", () => {
    const existing: AssetGraph = { version: 1, nodes: {} };
    const nodes: Record<string, GraphNode> = {
      "node-1": { id: "node-1", kind: "image", status: "ready", parentId: null, createdAt: Date.now(), source: "../../../etc/passwd" },
    };
    const result = validateGraphNodes(nodes, existing);
    expect(result.ok).toBe(false);
    expect(result.errors![0]).toContain("source");
  });
});

describe("validateStoryboard", () => {
  const graph: AssetGraph = {
    version: 1,
    nodes: {
      "node-1": { id: "node-1", kind: "image", status: "ready", parentId: null, createdAt: Date.now() },
      "node-2": { id: "node-2", kind: "video", status: "ready", parentId: "node-1", createdAt: Date.now() },
    },
  };

  test("accepts valid storyboard", () => {
    const clips = [
      { id: "clip-001", order: 1, duration: 5, visual: { rootNodeId: "node-1", selectedNodeId: "node-2" }, audio: null, caption: null, transition: { type: "cut" as const, duration: 0 } },
    ];
    const result = validateStoryboard({ clips }, graph);
    expect(result.ok).toBe(true);
  });

  test("rejects binding to nonexistent node", () => {
    const clips = [
      { id: "clip-001", order: 1, duration: 5, visual: { rootNodeId: "node-1", selectedNodeId: "missing" }, audio: null, caption: null, transition: { type: "cut" as const, duration: 0 } },
    ];
    const result = validateStoryboard({ clips }, graph);
    expect(result.ok).toBe(false);
    expect(result.errors![0]).toContain("missing");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/pandazki/Codes/pneuma-skills && bun test modes/clipcraft/__tests__/domain-validation.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement validation functions**

Create `modes/clipcraft/domain-validation.ts`:

```typescript
import type { GraphNode, AssetGraph, Clip, SlotBinding } from "./types.js";

export interface ValidationResult {
  ok: boolean;
  errors?: string[];
}

const VALID_KINDS = new Set(["image", "video", "audio", "text"]);
const VALID_STATUSES = new Set(["pending", "generating", "ready", "error"]);

/**
 * Validate a batch of graph nodes for PATCH merge.
 * Checks required fields, valid enums, parentId references, and source paths.
 */
export function validateGraphNodes(
  nodes: Record<string, GraphNode>,
  existingGraph: AssetGraph,
): ValidationResult {
  const errors: string[] = [];
  const allNodeIds = new Set([...Object.keys(existingGraph.nodes), ...Object.keys(nodes)]);

  for (const [key, node] of Object.entries(nodes)) {
    if (!node.id || node.id !== key) {
      errors.push(`Node "${key}": id must match key (got "${node.id}")`);
    }
    if (!node.kind || !VALID_KINDS.has(node.kind)) {
      errors.push(`Node "${key}": invalid kind "${node.kind}" (expected: ${[...VALID_KINDS].join(", ")})`);
    }
    if (!node.status || !VALID_STATUSES.has(node.status)) {
      errors.push(`Node "${key}": invalid status "${node.status}"`);
    }
    if (node.createdAt == null || typeof node.createdAt !== "number") {
      errors.push(`Node "${key}": createdAt is required and must be a number`);
    }
    if (node.parentId != null && !allNodeIds.has(node.parentId)) {
      errors.push(`Node "${key}": parentId "${node.parentId}" references nonexistent node`);
    }
    if (node.source && !node.source.startsWith("assets/")) {
      errors.push(`Node "${key}": source path must be under assets/ (got "${node.source}")`);
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

/**
 * Validate a full graph (for PUT replace).
 * Same per-node checks as PATCH, plus no orphaned parentId references.
 */
export function validateFullGraph(graph: AssetGraph): ValidationResult {
  const errors: string[] = [];
  const nodeIds = new Set(Object.keys(graph.nodes));

  for (const [key, node] of Object.entries(graph.nodes)) {
    if (!node.id || node.id !== key) {
      errors.push(`Node "${key}": id must match key`);
    }
    if (!node.kind || !VALID_KINDS.has(node.kind)) {
      errors.push(`Node "${key}": invalid kind "${node.kind}"`);
    }
    if (!node.status || !VALID_STATUSES.has(node.status)) {
      errors.push(`Node "${key}": invalid status "${node.status}"`);
    }
    if (node.createdAt == null) {
      errors.push(`Node "${key}": createdAt required`);
    }
    if (node.parentId != null && !nodeIds.has(node.parentId)) {
      errors.push(`Node "${key}": orphaned parentId "${node.parentId}"`);
    }
    if (node.source && !node.source.startsWith("assets/")) {
      errors.push(`Node "${key}": source path must be under assets/`);
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

/**
 * Validate storyboard updates (clips + bgm binding).
 * Checks that all slot binding node IDs exist in the graph.
 */
export function validateStoryboard(
  update: { clips?: Clip[]; bgm?: SlotBinding | null },
  graph: AssetGraph,
): ValidationResult {
  const errors: string[] = [];
  const nodeIds = new Set(Object.keys(graph.nodes));

  function checkBinding(binding: SlotBinding | null, label: string) {
    if (!binding) return;
    if (!nodeIds.has(binding.rootNodeId)) {
      errors.push(`${label}: rootNodeId "${binding.rootNodeId}" not found in graph`);
    }
    if (!nodeIds.has(binding.selectedNodeId)) {
      errors.push(`${label}: selectedNodeId "${binding.selectedNodeId}" not found in graph`);
    }
  }

  if (update.clips) {
    const clipIds = new Set<string>();
    for (const clip of update.clips) {
      if (clipIds.has(clip.id)) {
        errors.push(`Duplicate clip id "${clip.id}"`);
      }
      clipIds.add(clip.id);
      checkBinding(clip.visual, `Clip "${clip.id}".visual`);
      checkBinding(clip.audio, `Clip "${clip.id}".audio`);
      checkBinding(clip.caption, `Clip "${clip.id}".caption`);
    }
  }

  if (update.bgm !== undefined) {
    checkBinding(update.bgm, "bgm");
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/pandazki/Codes/pneuma-skills && bun test modes/clipcraft/__tests__/domain-validation.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add modes/clipcraft/domain-validation.ts modes/clipcraft/__tests__/domain-validation.test.ts
git commit -m "feat(clipcraft): add domain validation for graph nodes and storyboard bindings"
```

---

### Task 3: Create domain API server routes

**Files:**
- Create: `server/domain-api.ts`
- Modify: `server/index.ts`
- Create: `modes/clipcraft/seed/default/graph.json`

- [ ] **Step 1: Create empty graph.json seed**

Create `modes/clipcraft/seed/default/graph.json`:

```json
{
  "version": 1,
  "nodes": {}
}
```

- [ ] **Step 2: Create the domain API module**

Create `server/domain-api.ts`:

```typescript
// server/domain-api.ts — Domain API for ClipCraft generation graph + storyboard v2

import type { Hono } from "hono";
import { join } from "node:path";
import type { AssetGraph, StoryboardV2, ProjectConfig } from "../modes/clipcraft/types.js";
import { EMPTY_GRAPH, EMPTY_STORYBOARD_V2 } from "../modes/clipcraft/types.js";
import { validateGraphNodes, validateFullGraph, validateStoryboard } from "../modes/clipcraft/domain-validation.js";

interface DomainApiOptions {
  workspace: string;
  /** Called after writing to notify the viewer via WS */
  onUpdate: (files: { path: string; content: string }[]) => void;
}

function graphPath(workspace: string) {
  return join(workspace, "graph.json");
}
function storyboardPath(workspace: string) {
  return join(workspace, "storyboard.json");
}
function projectPath(workspace: string) {
  return join(workspace, "project.json");
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const file = Bun.file(path);
    if (!(await file.exists())) return fallback;
    return await file.json() as T;
  } catch {
    return fallback;
  }
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await Bun.write(path, JSON.stringify(data, null, 2) + "\n");
}

export function registerDomainApiRoutes(app: Hono, options: DomainApiOptions) {
  const { workspace, onUpdate } = options;

  // ── GET /api/domain/state ───────────────────────────────────────────
  app.get("/api/domain/state", async (c) => {
    const [graph, storyboard, project] = await Promise.all([
      readJson<AssetGraph>(graphPath(workspace), EMPTY_GRAPH),
      readJson<StoryboardV2>(storyboardPath(workspace), EMPTY_STORYBOARD_V2),
      readJson<ProjectConfig>(projectPath(workspace), { title: "Untitled", aspectRatio: "16:9", resolution: { width: 1920, height: 1080 }, fps: 30, style: { captionFont: "Inter", captionPosition: "bottom", captionStyle: "outline" } }),
    ]);
    return c.json({ storyboard, graph, project });
  });

  // ── PATCH /api/domain/graph ─────────────────────────────────────────
  app.patch("/api/domain/graph", async (c) => {
    const body = await c.req.json<{ nodes: Record<string, unknown> }>();
    if (!body.nodes || typeof body.nodes !== "object") {
      return c.json({ ok: false, error: "body.nodes is required" }, 400);
    }

    const graph = await readJson<AssetGraph>(graphPath(workspace), EMPTY_GRAPH);
    const validation = validateGraphNodes(body.nodes as any, graph);
    if (!validation.ok) {
      return c.json({ ok: false, error: "Validation failed", details: validation.errors }, 400);
    }

    // Merge nodes
    for (const [id, node] of Object.entries(body.nodes)) {
      graph.nodes[id] = node as any;
    }

    const gp = graphPath(workspace);
    await writeJson(gp, graph);
    onUpdate([{ path: "graph.json", content: JSON.stringify(graph, null, 2) }]);
    return c.json({ ok: true });
  });

  // ── PUT /api/domain/graph ───────────────────────────────────────────
  app.put("/api/domain/graph", async (c) => {
    const body = await c.req.json<AssetGraph>();
    if (!body.nodes || body.version !== 1) {
      return c.json({ ok: false, error: "Invalid graph format" }, 400);
    }

    const validation = validateFullGraph(body);
    if (!validation.ok) {
      return c.json({ ok: false, error: "Validation failed", details: validation.errors }, 400);
    }

    const gp = graphPath(workspace);
    await writeJson(gp, body);
    onUpdate([{ path: "graph.json", content: JSON.stringify(body, null, 2) }]);
    return c.json({ ok: true });
  });

  // ── PATCH /api/domain/storyboard ────────────────────────────────────
  app.patch("/api/domain/storyboard", async (c) => {
    const body = await c.req.json<{ clips?: unknown[]; bgm?: unknown }>();
    const graph = await readJson<AssetGraph>(graphPath(workspace), EMPTY_GRAPH);

    const validation = validateStoryboard(body as any, graph);
    if (!validation.ok) {
      return c.json({ ok: false, error: "Validation failed", details: validation.errors }, 400);
    }

    const storyboard = await readJson<StoryboardV2>(storyboardPath(workspace), EMPTY_STORYBOARD_V2);

    if (body.clips !== undefined) {
      storyboard.clips = body.clips as any;
    }
    if (body.bgm !== undefined) {
      storyboard.bgm = body.bgm as any;
    }
    storyboard.version = 2;

    const sp = storyboardPath(workspace);
    await writeJson(sp, storyboard);
    onUpdate([{ path: "storyboard.json", content: JSON.stringify(storyboard, null, 2) }]);
    return c.json({ ok: true });
  });
}
```

- [ ] **Step 3: Register domain API routes in server**

In `server/index.ts`, add the import at the top (near other route imports around line 15-19):

```typescript
import { registerDomainApiRoutes } from "./domain-api.js";
```

Then register the routes. Find where `registerExportRoutes` is called (around line 1519) and add after it:

```typescript
  // ── Domain API routes (ClipCraft generation graph) ──────────────────
  if (options.modeName === "clipcraft") {
    registerDomainApiRoutes(app, {
      workspace,
      onUpdate: (files) => {
        const sid = wsBridge.getActiveSessionId();
        if (sid) {
          if (isManualRefresh) {
            queueContentUpdate(files);
          } else {
            wsBridge.broadcastToSession(sid, { type: "content_update", files });
          }
        }
      },
    });
  }
```

- [ ] **Step 4: Add graph.json to file watcher patterns**

Search in `server/index.ts` for where the chokidar file watcher is configured and ensure `graph.json` is watched. It likely watches all `.json` files in the workspace root already — verify by checking the watcher patterns. If `graph.json` isn't covered, add it.

Note: The existing watcher likely watches `*.json` at the workspace root, which would include `graph.json`. Verify and adjust if needed.

- [ ] **Step 5: Verify build**

Run: `cd /Users/pandazki/Codes/pneuma-skills && bun run build`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add server/domain-api.ts server/index.ts modes/clipcraft/seed/default/graph.json
git commit -m "feat(clipcraft): add domain API routes (PATCH/PUT/GET) with schema validation"
```

---

### Task 4: Update viewer store for graph support

**Files:**
- Modify: `modes/clipcraft/viewer/store/types.ts`
- Modify: `modes/clipcraft/viewer/store/reducer.ts`

- [ ] **Step 1: Add graph to viewer state**

In `modes/clipcraft/viewer/store/types.ts`:

Add import for new types (update the existing import from `../../types.js`):

```typescript
import type { Storyboard, StoryboardV2, AnyStoryboard, ProjectConfig, Scene, AssetGraph, GraphNode, SlotBinding, Clip } from "../../types.js";
```

Add `graph: AssetGraph` to `ClipCraftState` (after the `storyboard` field):

```typescript
  // In ClipCraftState, change storyboard type and add graph:
  storyboard: AnyStoryboard;

  // Asset graph (v2 domain model)
  graph: AssetGraph;
```

- [ ] **Step 2: Update reducer for graph support**

In `modes/clipcraft/viewer/store/reducer.ts`:

Update imports:

```typescript
import type { Storyboard, StoryboardV2, AnyStoryboard, ProjectConfig, AssetGraph, GraphNode, SlotBinding, Clip, Scene, SceneVisual, SceneAudio } from "../../types.js";
import { EMPTY_GRAPH } from "../../types.js";
```

Add `graph: EMPTY_GRAPH` to `initialState` (after `storyboard`):

```typescript
  graph: EMPTY_GRAPH,
```

Add the `migrateV1ToV2` helper function (before the reducer):

```typescript
/**
 * Convert a v1 storyboard to v2 format by creating synthetic graph nodes
 * for each scene's visual, audio, and caption.
 */
function migrateV1ToV2(v1: Storyboard): { converted: StoryboardV2; syntheticGraph: AssetGraph } {
  const nodes: Record<string, GraphNode> = {};
  const clips: Clip[] = [];

  for (const scene of v1.scenes) {
    let visualBinding: SlotBinding | null = null;
    let audioBinding: SlotBinding | null = null;
    let captionBinding: SlotBinding | null = null;

    if (scene.visual) {
      const nodeId = `node-${scene.id}-visual`;
      nodes[nodeId] = {
        id: nodeId,
        kind: scene.visual.type === "video" ? "video" : "image",
        status: scene.visual.status,
        parentId: null,
        source: scene.visual.source,
        prompt: scene.visual.prompt,
        model: scene.visual.model,
        createdAt: Date.now(),
        metadata: {
          ...(scene.visual.thumbnail ? { thumbnail: scene.visual.thumbnail } : {}),
          ...(scene.visual.errorMessage ? { errorMessage: scene.visual.errorMessage } : {}),
        },
      };
      visualBinding = { rootNodeId: nodeId, selectedNodeId: nodeId };
    }

    if (scene.audio) {
      const nodeId = `node-${scene.id}-audio`;
      nodes[nodeId] = {
        id: nodeId,
        kind: "audio",
        status: scene.audio.status,
        parentId: null,
        source: scene.audio.source,
        content: scene.audio.text,
        model: scene.audio.model,
        createdAt: Date.now(),
        metadata: {
          ...(scene.audio.voice ? { voice: scene.audio.voice } : {}),
          ...(scene.audio.duration != null ? { duration: scene.audio.duration } : {}),
          ...(scene.audio.errorMessage ? { errorMessage: scene.audio.errorMessage } : {}),
        },
      };
      audioBinding = { rootNodeId: nodeId, selectedNodeId: nodeId };
    }

    if (scene.caption) {
      const nodeId = `node-${scene.id}-caption`;
      nodes[nodeId] = {
        id: nodeId,
        kind: "text",
        status: "ready",
        parentId: null,
        content: typeof scene.caption === "string" ? scene.caption : (scene.caption as any)?.text ?? "",
        createdAt: Date.now(),
      };
      captionBinding = { rootNodeId: nodeId, selectedNodeId: nodeId };
    }

    clips.push({
      id: scene.id,
      order: scene.order,
      duration: scene.duration,
      visual: visualBinding,
      audio: audioBinding,
      caption: captionBinding,
      transition: scene.transition,
    });
  }

  // BGM
  let bgmBinding: SlotBinding | null = null;
  if (v1.bgm) {
    const nodeId = "node-bgm";
    nodes[nodeId] = {
      id: nodeId,
      kind: "audio",
      status: "ready",
      parentId: null,
      source: v1.bgm.source,
      createdAt: Date.now(),
      metadata: {
        title: v1.bgm.title,
        volume: v1.bgm.volume,
        fadeIn: v1.bgm.fadeIn,
        fadeOut: v1.bgm.fadeOut,
      },
    };
    bgmBinding = { rootNodeId: nodeId, selectedNodeId: nodeId };
  }

  return {
    converted: { version: 2, clips, bgm: bgmBinding, characterRefs: v1.characterRefs },
    syntheticGraph: { version: 1, nodes },
  };
}
```

Update the `SYNC_FILES` case to handle both v1 and v2 storyboards, and parse `graph.json`:

```typescript
    case "SYNC_FILES": {
      const project = parseJSON<ProjectConfig>(
        action.files,
        "project.json",
        DEFAULT_PROJECT,
      );
      const rawStoryboard = parseJSON<AnyStoryboard>(
        action.files,
        "storyboard.json",
        EMPTY_STORYBOARD,
      );
      const graph = parseJSON<AssetGraph>(
        action.files,
        "graph.json",
        EMPTY_GRAPH,
      );

      // Detect version and handle accordingly
      if (rawStoryboard.version === 2) {
        // V2: use as-is
        return {
          ...state,
          project,
          storyboard: rawStoryboard as StoryboardV2,
          graph,
          imageVersion: action.imageVersion,
        };
      }

      // V1 (legacy): migrate to v2 format + synthetic graph nodes
      const v1 = rawStoryboard as Storyboard;
      // Coerce caption: agent sometimes writes {text, style} objects instead of string
      for (const scene of v1.scenes) {
        if (scene.caption && typeof scene.caption !== "string") {
          scene.caption = (scene.caption as any).text ?? "";
        }
      }
      const { converted, syntheticGraph } = migrateV1ToV2(v1);
      // Merge synthetic nodes with any existing graph nodes
      const mergedGraph: AssetGraph = {
        version: 1,
        nodes: { ...graph.nodes, ...syntheticGraph.nodes },
      };

      return {
        ...state,
        project,
        storyboard: converted,
        graph: mergedGraph,
        imageVersion: action.imageVersion,
      };
    }
```

- [ ] **Step 3: Update SEEK case to work with both Clip and Scene**

The `SEEK` reducer case currently reads `state.storyboard.scenes`. After the migration, the storyboard always has `clips` (even v1 is converted). Update the SEEK case:

```typescript
    case "SEEK": {
      const sb = state.storyboard as StoryboardV2;
      const sorted = [...sb.clips].sort((a, b) => a.order - b.order);
      let seekCumulative = 0;
      let seekIndex = 0;
      for (let i = 0; i < sorted.length; i++) {
        if (action.globalTime < seekCumulative + sorted[i].duration || i === sorted.length - 1) {
          seekIndex = i;
          break;
        }
        seekCumulative += sorted[i].duration;
      }
      return {
        ...state,
        playback: {
          ...state.playback,
          globalTime: action.globalTime,
          currentSceneIndex: seekIndex,
          currentTime: action.globalTime - seekCumulative,
        },
      };
    }
```

Also update `UPDATE_SCENE_CAPTION` and `UPDATE_BGM_CONFIG` to work with v2:

```typescript
    case "UPDATE_SCENE_CAPTION": {
      const sb = state.storyboard as StoryboardV2;
      // For v2: update the text content node in the graph
      const clip = sb.clips.find(c => c.id === action.sceneId);
      if (!clip?.caption) return state;
      const nodeId = clip.caption.selectedNodeId;
      const node = state.graph.nodes[nodeId];
      if (!node) return state;
      return {
        ...state,
        graph: {
          ...state.graph,
          nodes: {
            ...state.graph.nodes,
            [nodeId]: { ...node, content: action.caption },
          },
        },
      };
    }

    case "UPDATE_BGM_CONFIG": {
      const sb = state.storyboard as StoryboardV2;
      if (!sb.bgm) return state;
      const nodeId = sb.bgm.selectedNodeId;
      const node = state.graph.nodes[nodeId];
      if (!node) return state;
      return {
        ...state,
        graph: {
          ...state.graph,
          nodes: {
            ...state.graph.nodes,
            [nodeId]: {
              ...node,
              metadata: { ...(node.metadata ?? {}), ...action.config },
            },
          },
        },
      };
    }
```

- [ ] **Step 4: Verify build**

Run: `cd /Users/pandazki/Codes/pneuma-skills && bun run build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add modes/clipcraft/viewer/store/types.ts modes/clipcraft/viewer/store/reducer.ts
git commit -m "feat(clipcraft): add graph to viewer store with v1→v2 compatibility bridge"
```

---

### Task 5: Add graph-aware selectors

**Files:**
- Modify: `modes/clipcraft/viewer/store/selectors.ts`

- [ ] **Step 1: Add new selectors**

In `modes/clipcraft/viewer/store/selectors.ts`, add imports and new selectors:

Update the imports at the top:

```typescript
import type { Scene, GraphNode, SlotBinding, Clip, StoryboardV2 } from "../../types.js";
import type { ClipCraftState } from "./types.js";
```

Add the following selectors after the existing ones:

```typescript
// ── v2 Graph-Aware Selectors ─────────────────────────────────────────────────

/** Get sorted clips from the v2 storyboard. */
export function selectSortedClips(state: ClipCraftState): Clip[] {
  const sb = state.storyboard as StoryboardV2;
  if (!sb.clips) return [];
  return [...sb.clips].sort((a, b) => a.order - b.order);
}

/** Resolve a slot binding to its selected GraphNode. */
export function resolveSlot(state: ClipCraftState, binding: SlotBinding | null): GraphNode | null {
  if (!binding) return null;
  return state.graph.nodes[binding.selectedNodeId] ?? null;
}

/** Get all nodes in a generation tree starting from the root. */
export function getTreeForSlot(state: ClipCraftState, binding: SlotBinding | null): GraphNode[] {
  if (!binding) return [];
  const nodes = state.graph.nodes;
  const result: GraphNode[] = [];

  // BFS from root
  const queue = [binding.rootNodeId];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const node = nodes[id];
    if (!node) continue;
    result.push(node);
    // Find children
    for (const n of Object.values(nodes)) {
      if (n.parentId === id && !visited.has(n.id)) {
        queue.push(n.id);
      }
    }
  }

  return result;
}

/** Get direct children (variants) of a node. */
export function getVariants(state: ClipCraftState, nodeId: string): GraphNode[] {
  return Object.values(state.graph.nodes).filter(n => n.parentId === nodeId);
}

/** Get the lineage path from root to a specific node. */
export function getLineage(state: ClipCraftState, nodeId: string): GraphNode[] {
  const nodes = state.graph.nodes;
  const path: GraphNode[] = [];
  let current = nodes[nodeId];
  while (current) {
    path.unshift(current);
    current = current.parentId ? nodes[current.parentId] : undefined;
  }
  return path;
}

/**
 * Resolve a clip to flat display data for backwards compatibility.
 * Existing timeline/preview components use this instead of reading scene fields directly.
 */
export function resolveClipForDisplay(state: ClipCraftState, clip: Clip): {
  visual: { source?: string; prompt?: string; status: string; thumbnail?: string; type?: string } | null;
  audio: { source?: string; text?: string; voice?: string; status: string; duration?: number } | null;
  caption: string | null;
} {
  const visualNode = resolveSlot(state, clip.visual);
  const audioNode = resolveSlot(state, clip.audio);
  const captionNode = resolveSlot(state, clip.caption);

  return {
    visual: visualNode ? {
      source: visualNode.source,
      prompt: visualNode.prompt,
      status: visualNode.status,
      thumbnail: (visualNode.metadata?.thumbnail as string) ?? undefined,
      type: visualNode.kind === "video" ? "video" : "image",
    } : null,
    audio: audioNode ? {
      source: audioNode.source,
      text: audioNode.content,
      voice: (audioNode.metadata?.voice as string) ?? undefined,
      status: audioNode.status,
      duration: (audioNode.metadata?.duration as number) ?? undefined,
    } : null,
    caption: captionNode?.content ?? null,
  };
}
```

Also update `selectSortedScenes` and `selectTotalDuration` to work with v2 by delegating to clips:

```typescript
/** Scenes sorted by order — v2 compat: delegates to clips. */
export function selectSortedScenes(state: ClipCraftState): Scene[] {
  // If v2, build synthetic Scene objects from clips + graph for backwards compat
  const sb = state.storyboard as StoryboardV2;
  if (sb.version === 2 && sb.clips) {
    return [...sb.clips]
      .sort((a, b) => a.order - b.order)
      .map(clip => {
        const display = resolveClipForDisplay(state, clip);
        return {
          id: clip.id,
          order: clip.order,
          duration: clip.duration,
          visual: display.visual ? {
            type: (display.visual.type ?? "image") as "image" | "video",
            status: display.visual.status as any,
            source: display.visual.source,
            prompt: display.visual.prompt,
            thumbnail: display.visual.thumbnail,
          } : null,
          audio: display.audio ? {
            type: "tts" as const,
            status: display.audio.status as any,
            text: display.audio.text ?? "",
            voice: display.audio.voice,
            source: display.audio.source,
            duration: display.audio.duration,
          } : null,
          caption: display.caption,
          transition: clip.transition,
        };
      });
  }

  // Legacy v1 path
  const v1 = state.storyboard as any;
  if (v1.scenes) {
    return [...v1.scenes].sort((a: Scene, b: Scene) => a.order - b.order);
  }
  return [];
}

/** Sum of all clip durations. */
export function selectTotalDuration(state: ClipCraftState): number {
  const sb = state.storyboard as StoryboardV2;
  if (sb.version === 2 && sb.clips) {
    return sb.clips.reduce((sum, c) => sum + c.duration, 0);
  }
  const v1 = state.storyboard as any;
  if (v1.scenes) {
    return v1.scenes.reduce((sum: number, s: Scene) => sum + s.duration, 0);
  }
  return 0;
}
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/pandazki/Codes/pneuma-skills && bun run build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add modes/clipcraft/viewer/store/selectors.ts
git commit -m "feat(clipcraft): add graph-aware selectors with backwards-compatible resolveClipForDisplay"
```

---

### Task 6: Rewrite storyboard protocol skill prompt

**Files:**
- Modify: `modes/clipcraft/skill/rules/storyboard-protocol.md`

- [ ] **Step 1: Rewrite the storyboard protocol**

Replace the contents of `modes/clipcraft/skill/rules/storyboard-protocol.md` with:

```markdown
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
```

- [ ] **Step 2: Verify build (no code changes, but ensure no broken references)**

Run: `cd /Users/pandazki/Codes/pneuma-skills && bun run build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add modes/clipcraft/skill/rules/storyboard-protocol.md
git commit -m "feat(clipcraft): rewrite storyboard-protocol for domain API v2 with generation trees"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Domain entity types (GraphNode, AssetGraph, SlotBinding, Clip, StoryboardV2) → Task 1
- ✅ Persistence format (graph.json v1, storyboard.json v2) → Task 1 (types) + Task 3 (seed file)
- ✅ Domain API endpoints (PATCH/PUT/GET) → Task 3
- ✅ Schema validation → Task 2
- ✅ Viewer store (graph state field) → Task 4
- ✅ v1→v2 compatibility bridge → Task 4 (migrateV1ToV2)
- ✅ New selectors (resolveSlot, getTreeForSlot, getVariants, getLineage, resolveClipForDisplay) → Task 5
- ✅ selectSortedScenes backwards compat → Task 5
- ✅ Skill prompt updates → Task 6

**Placeholder scan:** No TBDs or vague steps. All code is complete.

**Type consistency:** `GraphNode`, `AssetGraph`, `SlotBinding`, `Clip`, `StoryboardV2` defined in Task 1, imported consistently in Tasks 2-5. `validateGraphNodes` signature in Task 2 matches usage in Task 3. `resolveSlot` in Task 5 uses `SlotBinding` and `GraphNode` from Task 1. `migrateV1ToV2` in Task 4 produces `StoryboardV2` + `AssetGraph` matching Task 1 definitions.

**Note:** Task 4 is the largest and most complex (reducer rewrite with v1 bridge). The implementer should be dispatched with a standard model, not a cheap one.

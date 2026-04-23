// server/domain-api.ts — Domain API for ClipCraft generation graph + storyboard v2

import type { Hono } from "hono";
import { join } from "node:path";
import type { AssetGraph, StoryboardV2, ProjectConfig, Storyboard, GraphNode, SlotBinding, Clip } from "../modes/clipcraft-legacy/types.js";
import { EMPTY_GRAPH, EMPTY_STORYBOARD_V2 } from "../modes/clipcraft-legacy/types.js";
import { validateGraphNodes, validateFullGraph, validateStoryboard } from "../modes/clipcraft-legacy/domain-validation.js";

interface DomainApiOptions {
  workspace: string;
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

// ── v1 → v2 migration (same logic as viewer reducer, server-side) ──────────

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
      const caption = typeof scene.caption === "string" ? scene.caption : (scene.caption as any)?.text ?? "";
      const nodeId = `node-${scene.id}-caption`;
      nodes[nodeId] = {
        id: nodeId, kind: "text", status: "ready", parentId: null,
        content: caption, createdAt: Date.now(),
      };
      captionBinding = { rootNodeId: nodeId, selectedNodeId: nodeId };
    }

    clips.push({
      id: scene.id, order: scene.order, duration: scene.duration,
      visual: visualBinding, audio: audioBinding, caption: captionBinding,
      transition: scene.transition,
    });
  }

  let bgmBinding: SlotBinding | null = null;
  if (v1.bgm) {
    const nodeId = "node-bgm";
    nodes[nodeId] = {
      id: nodeId, kind: "audio", status: "ready", parentId: null,
      source: v1.bgm.source, createdAt: Date.now(),
      metadata: { title: v1.bgm.title, volume: v1.bgm.volume, fadeIn: v1.bgm.fadeIn, fadeOut: v1.bgm.fadeOut },
    };
    bgmBinding = { rootNodeId: nodeId, selectedNodeId: nodeId };
  }

  return {
    converted: { version: 2, clips, bgm: bgmBinding, characterRefs: v1.characterRefs },
    syntheticGraph: { version: 1, nodes },
  };
}

// ── Routes ──────────────────────────────────────────────────────────────────

export function registerDomainApiRoutes(app: Hono, options: DomainApiOptions) {
  const { workspace, onUpdate } = options;

  app.get("/api/domain/state", async (c) => {
    let [graph, rawStoryboard, project] = await Promise.all([
      readJson<AssetGraph>(graphPath(workspace), EMPTY_GRAPH),
      readJson<any>(storyboardPath(workspace), EMPTY_STORYBOARD_V2),
      readJson<ProjectConfig>(projectPath(workspace), { title: "Untitled", aspectRatio: "16:9", resolution: { width: 1920, height: 1080 }, fps: 30, style: { captionFont: "Inter", captionPosition: "bottom", captionStyle: "outline" } }),
    ]);

    // Auto-migrate v1 → v2 on first read, persist to disk
    if (rawStoryboard.version !== 2 && rawStoryboard.scenes) {
      const { converted, syntheticGraph } = migrateV1ToV2(rawStoryboard as Storyboard);
      graph = { version: 1, nodes: { ...graph.nodes, ...syntheticGraph.nodes } };
      rawStoryboard = converted;
      // Persist migration to disk
      await Promise.all([
        writeJson(storyboardPath(workspace), converted),
        writeJson(graphPath(workspace), graph),
      ]);
      onUpdate([
        { path: "storyboard.json", content: JSON.stringify(converted, null, 2) },
        { path: "graph.json", content: JSON.stringify(graph, null, 2) },
      ]);
    }

    return c.json({ storyboard: rawStoryboard, graph, project });
  });

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

    for (const [id, node] of Object.entries(body.nodes)) {
      graph.nodes[id] = node as any;
    }

    const gp = graphPath(workspace);
    await writeJson(gp, graph);
    onUpdate([{ path: "graph.json", content: JSON.stringify(graph, null, 2) }]);
    return c.json({ ok: true });
  });

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

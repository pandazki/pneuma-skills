import type { Scene, GraphNode, SlotBinding, Clip, StoryboardV2 } from "../../types.js";
import type { ClipCraftState } from "./types.js";

// ── Existing selectors (updated for v2 compat) ──────────────────────────────

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

/** Scenes sorted by order — builds synthetic Scene objects from v2 clips for backwards compat. */
export function selectSortedScenes(state: ClipCraftState): Scene[] {
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

  // Legacy v1 fallback (shouldn't happen since reducer always migrates, but safe)
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

/**
 * The "active" scene: if playing, the scene at currentSceneIndex;
 * otherwise the selected scene; otherwise the first scene.
 */
export function selectActiveScene(state: ClipCraftState): Scene | null {
  const sorted = selectSortedScenes(state);
  if (sorted.length === 0) return null;

  if (state.playback.playing) {
    return sorted[state.playback.currentSceneIndex] ?? sorted[0];
  }

  if (state.selectedSceneId) {
    return sorted.find((s) => s.id === state.selectedSceneId) ?? sorted[0];
  }

  return sorted[0];
}

/** Scene generation progress counts. */
export function selectProgress(state: ClipCraftState): {
  ready: number;
  generating: number;
  pending: number;
  error: number;
  total: number;
} {
  const scenes = selectSortedScenes(state);
  let ready = 0;
  let generating = 0;
  let pending = 0;
  let error = 0;

  for (const scene of scenes) {
    const status = scene.visual?.status ?? "pending";
    switch (status) {
      case "ready":
        ready++;
        break;
      case "generating":
        generating++;
        break;
      case "error":
        error++;
        break;
      default:
        pending++;
    }
  }

  return { ready, generating, pending, error, total: scenes.length };
}

/** Total number of non-gitkeep asset files across all groups. */
export function selectAssetCount(state: ClipCraftState): number {
  let count = 0;
  for (const files of Object.values(state.assets)) {
    count += files.length;
  }
  return count;
}

// ── v2 Graph-Aware Selectors ─────────────────────────────────────────────────

/** Get all nodes in a generation tree starting from the root. */
export function getTreeForSlot(state: ClipCraftState, binding: SlotBinding | null): GraphNode[] {
  if (!binding) return [];
  const nodes = state.graph.nodes;
  const result: GraphNode[] = [];

  const queue = [binding.rootNodeId];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const node = nodes[id];
    if (!node) continue;
    result.push(node);
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

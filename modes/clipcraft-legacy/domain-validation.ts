import type { GraphNode, AssetGraph, Clip, SlotBinding } from "./types.js";

export interface ValidationResult {
  ok: boolean;
  errors?: string[];
}

const VALID_KINDS = new Set(["image", "video", "audio", "text"]);
const VALID_STATUSES = new Set(["pending", "generating", "ready", "error"]);

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

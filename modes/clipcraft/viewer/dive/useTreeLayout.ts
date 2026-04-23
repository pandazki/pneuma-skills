import { useMemo } from "react";
import dagre from "@dagrejs/dagre";
import type { Node, Edge } from "@xyflow/react";
import type { Asset, AssetType } from "@pneuma-craft/core";
import { usePneumaCraftStore } from "@pneuma-craft/react";
import type { PendingGeneration } from "../generation/PendingGenerations.js";
import { theme } from "../theme/tokens.js";

const NODE_WIDTH = 200;
const NODE_HEIGHT = 160;

/**
 * A node's relationship to the drilled-into clip's bound asset:
 *   - "variant":   same asset-type as the clip. The node can be bound
 *                  to the clip via rebind-clip. Use this / Active / +
 *                  Variant all make sense.
 *   - "reference": different asset-type (e.g. an image serving as the
 *                  first-frame anchor of a video clip). Appears in the
 *                  DAG for lineage, but binding it to the clip would
 *                  crash playback — so Use This is hidden. + Variant
 *                  still works (the user can branch new references). */
export type NodeRole = "variant" | "reference";

export interface TreeNodeData {
  asset: Asset;
  isActive: boolean;
  isFocused: boolean;
  isOnActivePath: boolean;
  /** See NodeRole docs. */
  role: NodeRole;
  clipId: string;
  [key: string]: unknown;
}

/**
 * Collect every asset reachable from `rootAssetId` through provenance edges
 * (both ancestors and descendants/variants) and lay them out horizontally
 * with dagre. Highlights the path from root to `activeAssetId`.
 */
export function useTreeLayout(
  rootAssetId: string | null,
  activeAssetId: string | null,
  diveFocusedNodeId: string | null,
  clipId: string,
  /** Asset type of the clip's bound asset — used to classify each
   *  reachable asset as variant (same type) or reference (different).
   *  Pass null when there is no active clip. */
  activeAssetType: AssetType | null = null,
  /** Variant requests that have been dispatched but not yet resolved —
   *  rendered as synthetic "Generating…" nodes attached to their
   *  source so the DAG shows immediate feedback. Only pending entries
   *  whose source is reachable in the current tree are rendered. */
  pendingGenerations: PendingGeneration[] = [],
): { nodes: Node<TreeNodeData>[]; edges: Edge[] } {
  const coreState = usePneumaCraftStore((s) => s.coreState);

  return useMemo(() => {
    if (!rootAssetId) return { nodes: [], edges: [] };

    // 1. BFS over provenance edges, collecting reachable assets.
    const reachable = new Set<string>();
    const parentByChild = new Map<string, string | null>();
    const queue: string[] = [rootAssetId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      for (const edge of coreState.provenance.edges.values()) {
        if (edge.fromAssetId === id && !reachable.has(edge.toAssetId)) {
          parentByChild.set(edge.toAssetId, id);
          queue.push(edge.toAssetId);
        }
        if (edge.toAssetId === id && edge.fromAssetId && !reachable.has(edge.fromAssetId)) {
          parentByChild.set(id, edge.fromAssetId);
          queue.push(edge.fromAssetId);
        }
      }
    }

    const treeAssets: Asset[] = [];
    for (const id of reachable) {
      const asset = coreState.registry.get(id);
      if (asset) treeAssets.push(asset);
    }
    if (treeAssets.length === 0) return { nodes: [], edges: [] };

    // 2. Active path: walk parentByChild from activeAssetId to root.
    const activePath = new Set<string>();
    let cur: string | null = activeAssetId ?? rootAssetId;
    while (cur) {
      activePath.add(cur);
      cur = parentByChild.get(cur) ?? null;
    }

    // 2b. Pending placeholders attached to any source that is already
    //     reachable. Agent-side completion is tracked by the pending
    //     provider; here we just co-lay them out with dagre so they
    //     don't collide with real sibling variants.
    const applicablePending = pendingGenerations.filter((p) =>
      reachable.has(p.sourceAssetId),
    );

    // 3. Dagre layout.
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 120 });
    g.setDefaultEdgeLabel(() => ({}));

    for (const asset of treeAssets) {
      g.setNode(asset.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
    }
    for (const p of applicablePending) {
      g.setNode(p.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
    }
    for (const [child, parent] of parentByChild.entries()) {
      if (parent && reachable.has(parent) && reachable.has(child)) {
        g.setEdge(parent, child);
      }
    }
    for (const p of applicablePending) {
      g.setEdge(p.sourceAssetId, p.id);
    }

    dagre.layout(g);

    // 4. Map to xyflow nodes.
    //    Role classification: any node matching the clip's asset type
    //    is a variant candidate (can be rebound via USE THIS). A node
    //    with a different type is a cross-format reference — the DAG
    //    still shows it for lineage, but binding it to the clip would
    //    break playback, so the node is flagged accordingly.
    const xyNodes: Node<TreeNodeData>[] = treeAssets.map((asset) => {
      const pos = g.node(asset.id);
      const nodeType =
        asset.type === "image" || asset.type === "video" ? "visual" :
        asset.type === "audio" ? "audio" : "text";
      const role: NodeRole =
        activeAssetType != null && asset.type !== activeAssetType
          ? "reference"
          : "variant";
      return {
        id: asset.id,
        type: nodeType,
        position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
        data: {
          asset,
          isActive: asset.id === activeAssetId,
          isFocused: asset.id === diveFocusedNodeId,
          isOnActivePath: activePath.has(asset.id),
          role,
          clipId,
        },
      };
    });

    // 5. Edges.
    const xyEdges: Edge[] = [];
    for (const [child, parent] of parentByChild.entries()) {
      if (!parent || !reachable.has(parent) || !reachable.has(child)) continue;
      const isActive = activePath.has(child) && activePath.has(parent);
      const childAsset = coreState.registry.get(child);
      xyEdges.push({
        id: `edge-${parent}-${child}`,
        source: parent,
        target: child,
        style: {
          stroke: isActive ? theme.color.accent : theme.color.borderStrong,
          strokeWidth: isActive ? 1.6 : 1,
        },
        animated: childAsset?.status === "generating",
      });
    }

    // 6. Pending placeholders: synthesize a fake asset (status:
    //    "generating") plus an edge from the source. The fake asset
    //    keeps VisualNode / AudioNode / TextNode from crashing on
    //    access; the empty uri routes through the "placeholder"
    //    branch (spinner / pulse) that real generating assets already
    //    get. Node carries the pending's id so it's a stable React
    //    key and can be auto-removed when the real asset lands.
    for (const p of applicablePending) {
      const pos = g.node(p.id);
      if (!pos) continue;
      const fakeAsset: Asset = {
        id: p.id,
        type: p.kind === "audio" ? "audio" : p.kind,
        uri: "",
        name: "Generating…",
        metadata: {},
        createdAt: p.startedAt,
        status: "generating",
      };
      const nodeType =
        p.kind === "image" || p.kind === "video" ? "visual" :
        p.kind === "audio" ? "audio" : "text";
      // Pending entries always ride the variant lane for their source
      // (we only emit them from variant dispatches, which stay
      // within-kind). Role is "variant".
      xyNodes.push({
        id: p.id,
        type: nodeType,
        position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
        data: {
          asset: fakeAsset,
          isActive: false,
          isFocused: false,
          isOnActivePath: false,
          role: "variant",
          clipId,
        },
      });
      xyEdges.push({
        id: `edge-${p.sourceAssetId}-${p.id}`,
        source: p.sourceAssetId,
        target: p.id,
        style: {
          stroke: theme.color.warn,
          strokeWidth: 1.2,
          strokeDasharray: "4 4",
        },
        animated: true,
      });
    }

    return { nodes: xyNodes, edges: xyEdges };
  }, [
    rootAssetId,
    activeAssetId,
    diveFocusedNodeId,
    clipId,
    activeAssetType,
    pendingGenerations,
    coreState,
  ]);
}

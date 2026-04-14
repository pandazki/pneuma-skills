import { useMemo } from "react";
import dagre from "@dagrejs/dagre";
import type { Node, Edge } from "@xyflow/react";
import type { Asset } from "@pneuma-craft/core";
import { usePneumaCraftStore } from "@pneuma-craft/react";
import { theme } from "../theme/tokens.js";

const NODE_WIDTH = 200;
const NODE_HEIGHT = 160;

export interface TreeNodeData {
  asset: Asset;
  isActive: boolean;
  isFocused: boolean;
  isOnActivePath: boolean;
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

    // 3. Dagre layout.
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 120 });
    g.setDefaultEdgeLabel(() => ({}));

    for (const asset of treeAssets) {
      g.setNode(asset.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
    }
    for (const [child, parent] of parentByChild.entries()) {
      if (parent && reachable.has(parent) && reachable.has(child)) {
        g.setEdge(parent, child);
      }
    }

    dagre.layout(g);

    // 4. Map to xyflow nodes.
    const xyNodes: Node<TreeNodeData>[] = treeAssets.map((asset) => {
      const pos = g.node(asset.id);
      const nodeType =
        asset.type === "image" || asset.type === "video" ? "visual" :
        asset.type === "audio" ? "audio" : "text";
      return {
        id: asset.id,
        type: nodeType,
        position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
        data: {
          asset,
          isActive: asset.id === activeAssetId,
          isFocused: asset.id === diveFocusedNodeId,
          isOnActivePath: activePath.has(asset.id),
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

    return { nodes: xyNodes, edges: xyEdges };
  }, [rootAssetId, activeAssetId, diveFocusedNodeId, clipId, coreState]);
}

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

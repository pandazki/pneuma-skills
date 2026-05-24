/**
 * CosmosPreview — the interactive player for a cosmos.json projection.
 *
 * Subscribes to `props.sources.cosmos` (a single JSON file), lays the
 * graph out with dagre, renders with @xyflow/react, and routes the
 * mode's four declared actions (navigate-to / focus-layer / fit-view /
 * switch-persona) through `actionRequest` → `onActionResult`.
 *
 * The schema and the tech-stack choice (React Flow + dagre) come from
 * Lum1104/Understand-Anything (MIT) — see NOTICE.md for the borrow/
 * adapt/drop mapping.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge as RfEdge,
  type Node as RfNode,
  type NodeProps,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";

import type { ViewerPreviewProps } from "../../../core/types/viewer-contract.js";
import type { Source } from "../../../core/types/source.js";
import { useSource } from "../../../src/hooks/useSource.js";
import type { Cosmos, CosmosEdge, CosmosNode } from "../types.js";

// ── Persona density ───────────────────────────────────────────────────

type Persona = "overview" | "learn" | "deep-dive";

const DEFAULT_LAYER_COLOR = "#a1a1aa"; // zinc-400 fallback

// ── Node data (must be Record<string, unknown>-compatible for xyflow v12)

interface NodeData extends Record<string, unknown> {
  cosmosNode: CosmosNode;
  color: string;
  persona: Persona;
  dimmed: boolean;
}

// ── Layout (dagre LR) ────────────────────────────────────────────────

const NODE_W = 220;
const NODE_H = 76;

function layout(
  nodes: CosmosNode[],
  edges: CosmosEdge[],
): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", ranksep: 80, nodesep: 36 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H });
  for (const e of edges) {
    // Dagre ignores edges to/from unknown nodes — guard so a malformed
    // cosmos.json doesn't take the whole viewer down.
    if (g.hasNode(e.source) && g.hasNode(e.target)) {
      g.setEdge(e.source, e.target);
    }
  }
  dagre.layout(g);
  const out = new Map<string, { x: number; y: number }>();
  for (const n of nodes) {
    const pos = g.node(n.id);
    if (pos) out.set(n.id, { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 });
  }
  return out;
}

// ── CosmosNodeCard — the React Flow node component ──────────────────

function CosmosNodeCard({ data, selected }: NodeProps<RfNode<NodeData>>) {
  const { cosmosNode, color, persona, dimmed } = data;
  return (
    <div
      className="cc-cosmos-node"
      style={{
        width: NODE_W,
        minHeight: NODE_H,
        background: "rgba(24,24,27,0.92)",
        border: `1px solid ${selected ? "#f97316" : color}`,
        borderRadius: 10,
        padding: "10px 12px",
        boxShadow: selected
          ? "0 0 0 2px rgba(249,115,22,0.35), 0 6px 18px rgba(0,0,0,0.4)"
          : "0 2px 10px rgba(0,0,0,0.35)",
        opacity: dimmed ? 0.22 : 1,
        transition: "opacity 200ms ease, box-shadow 150ms ease, border-color 150ms ease",
        color: "#e4e4e7",
        fontFamily: "Inter, -apple-system, sans-serif",
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: color, border: "none" }} />
      <div
        style={{
          fontSize: 10,
          letterSpacing: 0.4,
          textTransform: "uppercase",
          color,
          marginBottom: 2,
        }}
      >
        {cosmosNode.type}
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.2 }}>{cosmosNode.name}</div>
      {persona !== "overview" && cosmosNode.summary && (
        <div
          style={{
            fontSize: 11,
            color: "#a1a1aa",
            marginTop: 6,
            lineHeight: 1.35,
            display: "-webkit-box",
            WebkitLineClamp: persona === "deep-dive" ? 4 : 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {cosmosNode.summary}
        </div>
      )}
      {persona === "deep-dive" && cosmosNode.tags && cosmosNode.tags.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
          {cosmosNode.tags.slice(0, 5).map((t) => (
            <span
              key={t}
              style={{
                fontSize: 9,
                padding: "1px 6px",
                borderRadius: 4,
                background: "rgba(255,255,255,0.06)",
                color: "#d4d4d8",
              }}
            >
              {t}
            </span>
          ))}
        </div>
      )}
      <Handle type="source" position={Position.Right} style={{ background: color, border: "none" }} />
    </div>
  );
}

const NODE_TYPES = { cosmosNode: CosmosNodeCard };

// ── Canvas (consumes useReactFlow, must be inside ReactFlowProvider) ──

interface CanvasProps {
  cosmos: Cosmos;
  persona: Persona;
  focusedLayer: string | null;
  selectedNodeId: string | null;
  onSelectNode: (n: CosmosNode | null) => void;
  registerFitView: (fn: () => void) => void;
  registerNavigate: (fn: (nodeId: string) => void) => void;
}

function Canvas({
  cosmos,
  persona,
  focusedLayer,
  selectedNodeId,
  onSelectNode,
  registerFitView,
  registerNavigate,
}: CanvasProps) {
  const layerColor = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of cosmos.layers) m.set(l.id, l.color ?? DEFAULT_LAYER_COLOR);
    return m;
  }, [cosmos.layers]);

  const positions = useMemo(() => layout(cosmos.nodes, cosmos.edges), [cosmos.nodes, cosmos.edges]);

  const rfNodes: RfNode<NodeData>[] = useMemo(
    () =>
      cosmos.nodes.map((n) => ({
        id: n.id,
        type: "cosmosNode",
        position: positions.get(n.id) ?? { x: 0, y: 0 },
        data: {
          cosmosNode: n,
          color: layerColor.get(n.layerId ?? "") ?? DEFAULT_LAYER_COLOR,
          persona,
          dimmed: focusedLayer != null && n.layerId !== focusedLayer,
        },
        selected: n.id === selectedNodeId,
      })),
    [cosmos.nodes, positions, layerColor, persona, focusedLayer, selectedNodeId],
  );

  const rfEdges: RfEdge[] = useMemo(
    () =>
      cosmos.edges.map((e, i) => ({
        id: `e-${i}-${e.source}-${e.target}`,
        source: e.source,
        target: e.target,
        label: e.type,
        labelStyle: { fontSize: 9, fill: "#71717a" },
        labelBgStyle: { fill: "rgba(9,9,11,0.85)" },
        labelBgPadding: [3, 5],
        labelBgBorderRadius: 3,
        style: {
          stroke:
            focusedLayer != null &&
            (cosmos.nodes.find((n) => n.id === e.source)?.layerId !== focusedLayer ||
              cosmos.nodes.find((n) => n.id === e.target)?.layerId !== focusedLayer)
              ? "rgba(82,82,91,0.2)"
              : "rgba(161,161,170,0.55)",
          strokeWidth: 1.2,
        },
        animated: e.direction === "bidirectional",
      })),
    [cosmos.edges, cosmos.nodes, focusedLayer],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<RfNode<NodeData>>(rfNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<RfEdge>(rfEdges);
  useEffect(() => setNodes(rfNodes), [rfNodes, setNodes]);
  useEffect(() => setEdges(rfEdges), [rfEdges, setEdges]);

  const rf = useReactFlow();

  useEffect(() => {
    registerFitView(() => rf.fitView({ padding: 0.2, duration: 400 }));
  }, [rf, registerFitView]);

  useEffect(() => {
    registerNavigate((nodeId: string) => {
      const pos = positions.get(nodeId);
      if (!pos) return;
      rf.setCenter(pos.x + NODE_W / 2, pos.y + NODE_H / 2, { zoom: 1.2, duration: 400 });
    });
  }, [rf, positions, registerNavigate]);

  const handlePaneClick = useCallback(() => onSelectNode(null), [onSelectNode]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={(_evt, rfn) => onSelectNode((rfn.data as NodeData).cosmosNode)}
      onPaneClick={handlePaneClick}
      nodeTypes={NODE_TYPES}
      fitView
      fitViewOptions={{ padding: 0.18, duration: 0 }}
      minZoom={0.15}
      proOptions={{ hideAttribution: true }}
      style={{ background: "#09090b" }}
    >
      <Background color="#27272a" gap={28} />
      <Controls style={{ background: "#18181b", border: "1px solid #27272a" }} />
    </ReactFlow>
  );
}

// ── Sidebar (layer legend + persona toggle) ──────────────────────────

interface SidebarProps {
  cosmos: Cosmos;
  persona: Persona;
  onPersona: (p: Persona) => void;
  focusedLayer: string | null;
  onFocusLayer: (id: string | null) => void;
}

function Sidebar({ cosmos, persona, onPersona, focusedLayer, onFocusLayer }: SidebarProps) {
  return (
    <aside
      style={{
        width: 220,
        flexShrink: 0,
        padding: "16px 14px",
        background: "rgba(24,24,27,0.6)",
        borderLeft: "1px solid #27272a",
        color: "#d4d4d8",
        fontFamily: "Inter, sans-serif",
        fontSize: 12,
        overflowY: "auto",
      }}
    >
      <div style={{ fontSize: 10, letterSpacing: 0.6, textTransform: "uppercase", color: "#71717a", marginBottom: 8 }}>
        {cosmos.project.name}
      </div>
      <div style={{ fontSize: 10, color: "#71717a", marginBottom: 16 }}>
        {cosmos.nodes.length} nodes · {cosmos.edges.length} edges · {cosmos.layers.length} layers
      </div>

      <div style={{ fontSize: 10, letterSpacing: 0.4, textTransform: "uppercase", color: "#a1a1aa", marginBottom: 6 }}>
        Density
      </div>
      <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
        {(["overview", "learn", "deep-dive"] as const).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPersona(p)}
            style={{
              flex: 1,
              padding: "5px 6px",
              borderRadius: 5,
              border: `1px solid ${persona === p ? "#f97316" : "#27272a"}`,
              background: persona === p ? "rgba(249,115,22,0.15)" : "transparent",
              color: persona === p ? "#fb923c" : "#a1a1aa",
              fontSize: 10,
              cursor: "pointer",
              textTransform: "capitalize",
            }}
          >
            {p === "deep-dive" ? "Deep" : p}
          </button>
        ))}
      </div>

      <div style={{ fontSize: 10, letterSpacing: 0.4, textTransform: "uppercase", color: "#a1a1aa", marginBottom: 6 }}>
        Layers
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <button
          type="button"
          onClick={() => onFocusLayer(null)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "5px 8px",
            borderRadius: 5,
            border: `1px solid ${focusedLayer === null ? "#3f3f46" : "#27272a"}`,
            background: focusedLayer === null ? "rgba(63,63,70,0.4)" : "transparent",
            color: "#d4d4d8",
            fontSize: 11,
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <span style={{ width: 10, height: 10, borderRadius: 2, background: "#52525b" }} />
          All layers
        </button>
        {cosmos.layers.map((l) => {
          const active = focusedLayer === l.id;
          const count = cosmos.nodes.filter((n) => n.layerId === l.id).length;
          return (
            <button
              key={l.id}
              type="button"
              onClick={() => onFocusLayer(active ? null : l.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "5px 8px",
                borderRadius: 5,
                border: `1px solid ${active ? l.color ?? "#3f3f46" : "#27272a"}`,
                background: active ? `${l.color}22` : "transparent",
                color: "#d4d4d8",
                fontSize: 11,
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <span style={{ width: 10, height: 10, borderRadius: 2, background: l.color ?? DEFAULT_LAYER_COLOR }} />
              <span style={{ flex: 1 }}>{l.label}</span>
              <span style={{ color: "#71717a", fontSize: 10 }}>{count}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

// ── Empty state ──────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "#09090b",
        color: "#71717a",
        fontFamily: "Inter, sans-serif",
        gap: 8,
        padding: 24,
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 16, color: "#d4d4d8" }}>No cosmos yet</div>
      <div style={{ fontSize: 13, maxWidth: 420, lineHeight: 1.5 }}>
        Drop content into the workspace — code, prose, research, anything —
        and ask the agent to project it. The cosmos will appear here.
      </div>
    </div>
  );
}

// ── Top-level PreviewComponent ──────────────────────────────────────

export function CosmosPreview(props: ViewerPreviewProps) {
  const cosmosSource = props.sources.cosmos as Source<Cosmos> | undefined;
  const { value: cosmos } = useSource(cosmosSource);
  const [persona, setPersona] = useState<Persona>("learn");
  const [focusedLayer, setFocusedLayer] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const fitViewRef = useRef<() => void>(() => {});
  const navigateRef = useRef<(id: string) => void>(() => {});

  // Handle selection — produce a ViewerSelectionContext with the
  // round-trippable address per the protocol.
  const handleSelectNode = useCallback(
    (n: CosmosNode | null) => {
      setSelectedNodeId(n?.id ?? null);
      if (!n) {
        props.onSelect(null);
        return;
      }
      props.onSelect({
        type: "cosmos-node",
        content: n.name,
        address: { nodeId: n.id },
        label: `${n.type} "${n.name}"`,
        nearbyText: n.summary,
      });
    },
    [props],
  );

  // Route agent action requests (navigate-to / focus-layer / fit-view / switch-persona).
  useEffect(() => {
    const req = props.actionRequest;
    if (!req || !props.onActionResult) return;
    try {
      switch (req.actionId) {
        case "navigate-to": {
          const address = req.params?.address as { nodeId?: string } | undefined;
          if (address?.nodeId) {
            navigateRef.current(address.nodeId);
            setSelectedNodeId(address.nodeId);
            props.onActionResult(req.requestId, { success: true });
          } else {
            props.onActionResult(req.requestId, { success: false, message: "missing address.nodeId" });
          }
          break;
        }
        case "focus-layer": {
          const address = req.params?.address as { layerId?: string } | undefined;
          if (address?.layerId) {
            setFocusedLayer(address.layerId);
            props.onActionResult(req.requestId, { success: true });
          } else {
            props.onActionResult(req.requestId, { success: false, message: "missing address.layerId" });
          }
          break;
        }
        case "fit-view": {
          fitViewRef.current();
          props.onActionResult(req.requestId, { success: true });
          break;
        }
        case "switch-persona": {
          const p = req.params?.persona as Persona | undefined;
          if (p === "overview" || p === "learn" || p === "deep-dive") {
            setPersona(p);
            props.onActionResult(req.requestId, { success: true });
          } else {
            props.onActionResult(req.requestId, { success: false, message: "invalid persona" });
          }
          break;
        }
        default: {
          props.onActionResult(req.requestId, { success: false, message: "unknown action" });
        }
      }
    } catch (err) {
      props.onActionResult(req.requestId, { success: false, message: String(err) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.actionRequest]);

  if (!cosmos) return <EmptyState />;

  return (
    <div style={{ display: "flex", height: "100%", width: "100%", background: "#09090b" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <ReactFlowProvider>
          <Canvas
            cosmos={cosmos}
            persona={persona}
            focusedLayer={focusedLayer}
            selectedNodeId={selectedNodeId}
            onSelectNode={handleSelectNode}
            registerFitView={(fn) => {
              fitViewRef.current = fn;
            }}
            registerNavigate={(fn) => {
              navigateRef.current = fn;
            }}
          />
        </ReactFlowProvider>
      </div>
      <Sidebar
        cosmos={cosmos}
        persona={persona}
        onPersona={setPersona}
        focusedLayer={focusedLayer}
        onFocusLayer={setFocusedLayer}
      />
    </div>
  );
}

export default CosmosPreview;

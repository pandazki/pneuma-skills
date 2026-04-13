import { useMemo, useEffect } from "react";
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
  ReactFlowProvider,
  useReactFlow,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useComposition, usePlayback } from "@pneuma-craft/react";
import type { Asset } from "@pneuma-craft/core";
import { useTimelineMode } from "../hooks/useTimelineMode.js";
import { useVariantPointer } from "./useVariantPointer.js";
import { tracksForLayer, type LayerType } from "../overview/layerTypes.js";
import { useTreeLayout } from "./useTreeLayout.js";
import { DiveHeader } from "./DiveHeader.js";
import { VisualNode } from "./nodes/VisualNode.js";
import { AudioNode } from "./nodes/AudioNode.js";
import { TextNode } from "./nodes/TextNode.js";

const RF_DARK_STYLES = `
.react-flow {
  --xy-controls-button-background-color-default: #27272a;
  --xy-controls-button-background-color-hover-default: #3f3f46;
  --xy-controls-button-color-default: #a1a1aa;
  --xy-controls-button-color-hover-default: #fafafa;
  --xy-background-color-default: #09090b;
  --xy-background-pattern-dots-color-default: rgba(255,255,255,0.05);
  --xy-node-background-color-default: transparent;
  --xy-node-border-default: none;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}
`;

const nodeTypes: NodeTypes = {
  visual: VisualNode,
  audio: AudioNode,
  text: TextNode,
};

function DiveCanvasInner() {
  const composition = useComposition();
  const playback = usePlayback();
  const { diveLayer, diveFocusedNodeId, setDiveFocusedNodeId } = useTimelineMode();
  const { get: getVariant } = useVariantPointer();
  const { fitView, setCenter, getNode } = useReactFlow();

  const layer: LayerType = (diveLayer ?? "video") as LayerType;
  const tracks = composition?.tracks ?? [];

  // Find the clip at the current time for the active dive layer.
  const activeClip = useMemo(() => {
    for (const track of tracksForLayer(tracks, layer)) {
      for (const clip of track.clips) {
        if (
          playback.currentTime >= clip.startTime &&
          playback.currentTime < clip.startTime + clip.duration
        ) {
          return clip;
        }
      }
    }
    return null;
  }, [tracks, layer, playback.currentTime]);

  const clipId = activeClip?.id ?? "";
  // Root asset for the provenance tree = the clip's current assetId, or the
  // mode-local pointer override if set.
  const rootAssetId = useMemo(() => {
    if (!activeClip) return null;
    const override = getVariant(activeClip.id);
    return override ?? activeClip.assetId ?? null;
  }, [activeClip, getVariant]);

  const activeAssetId = rootAssetId;

  const { nodes, edges } = useTreeLayout(rootAssetId, activeAssetId, diveFocusedNodeId, clipId);

  // Caption layer: synthesize a single TextNode from clip.text.
  const effectiveNodes = useMemo(() => {
    if (layer !== "caption") return nodes;
    if (!activeClip) return [];
    const syntheticAsset: Asset = {
      id: `caption-${activeClip.id}`,
      type: "text",
      uri: "",
      name: activeClip.text ?? "",
      metadata: {},
      createdAt: Date.now(),
    };
    return [{
      id: syntheticAsset.id,
      type: "text",
      position: { x: 0, y: 0 },
      data: {
        asset: syntheticAsset,
        isActive: true,
        isFocused: false,
        isOnActivePath: true,
        clipId: activeClip.id,
      },
    }];
  }, [layer, nodes, activeClip]);

  const effectiveEdges = layer === "caption" ? [] : edges;

  useEffect(() => {
    if (effectiveNodes.length > 0) {
      const timer = setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 50);
      return () => clearTimeout(timer);
    }
  }, [effectiveNodes.length, fitView]);

  useEffect(() => {
    if (!diveFocusedNodeId) return;
    const rfNode = getNode(diveFocusedNodeId);
    if (rfNode) {
      const x = rfNode.position.x + (rfNode.measured?.width ?? 200) / 2;
      const y = rfNode.position.y + (rfNode.measured?.height ?? 160) / 2;
      setCenter(x, y, { duration: 300 });
    }
  }, [diveFocusedNodeId, getNode, setCenter]);

  useEffect(() => {
    return () => setDiveFocusedNodeId(null);
  }, [setDiveFocusedNodeId]);

  return (
    <div style={{
      height: "100%", display: "flex", flexDirection: "column",
      background: "#09090b",
    }}>
      <style>{RF_DARK_STYLES}</style>

      <DiveHeader />

      <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
        {effectiveNodes.length > 0 ? (
          <ReactFlow
            nodes={effectiveNodes}
            edges={effectiveEdges}
            nodeTypes={nodeTypes}
            proOptions={{ hideAttribution: true }}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            style={{ background: "#09090b" }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={24}
              size={1}
              color="rgba(255,255,255,0.04)"
            />
            <Controls showInteractive={false} />
            <MiniMap nodeColor={() => "#f97316"} pannable zoomable />
          </ReactFlow>
        ) : (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            height: "100%", color: "#52525b", fontSize: 13, fontStyle: "italic",
          }}>
            No generation tree for this slot yet.
          </div>
        )}
      </div>

      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "6px 16px", borderTop: "1px solid #27272a",
        fontSize: 11, flexShrink: 0,
      }}>
        <span style={{ color: "#71717a" }}>
          {effectiveNodes.length} node{effectiveNodes.length !== 1 ? "s" : ""}
        </span>
        {rootAssetId && (
          <>
            <span style={{ color: "#3f3f46" }}>|</span>
            <span style={{ color: "#a1a1aa" }}>
              Active: <span style={{ color: "#f97316" }}>{rootAssetId}</span>
            </span>
          </>
        )}
        <span style={{ marginLeft: "auto", color: "#52525b" }}>
          Click to browse {"\u00B7"} "Use This" to switch variant pointer
        </span>
      </div>
    </div>
  );
}

export function DiveCanvas() {
  return (
    <ReactFlowProvider>
      <DiveCanvasInner />
    </ReactFlowProvider>
  );
}

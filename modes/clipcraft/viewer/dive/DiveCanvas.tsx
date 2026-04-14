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
import { theme } from "../theme/tokens.js";

const RF_DARK_STYLES = `
.react-flow {
  --xy-controls-button-background-color-default: ${theme.color.surface2};
  --xy-controls-button-background-color-hover-default: ${theme.color.surface3};
  --xy-controls-button-color-default: ${theme.color.ink2};
  --xy-controls-button-color-hover-default: ${theme.color.ink0};
  --xy-controls-button-border-color-default: ${theme.color.borderWeak};
  --xy-background-color-default: ${theme.color.surface0};
  --xy-background-pattern-dots-color-default: oklch(40% 0.01 55 / 0.18);
  --xy-node-background-color-default: transparent;
  --xy-node-border-default: none;
}
.react-flow__minimap {
  background: ${theme.color.surface1};
  border: 1px solid ${theme.color.borderWeak};
  border-radius: ${theme.radius.md}px;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.65; }
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
    return [
      {
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
      },
    ];
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
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: theme.color.surface0,
        fontFamily: theme.font.ui,
      }}
    >
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
            style={{ background: theme.color.surface0 }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={24}
              size={1}
              color="oklch(40% 0.01 55 / 0.18)"
            />
            <Controls showInteractive={false} />
            <MiniMap nodeColor={() => theme.color.accent} pannable zoomable />
          </ReactFlow>
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: theme.color.ink4,
              fontFamily: theme.font.ui,
              fontSize: theme.text.base,
              fontStyle: "italic",
              letterSpacing: theme.text.trackingBase,
            }}
          >
            No generation tree for this slot yet.
          </div>
        )}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: theme.space.space3,
          padding: `${theme.space.space2}px ${theme.space.space4}px`,
          borderTop: `1px solid ${theme.color.borderWeak}`,
          background: theme.color.surface1,
          fontFamily: theme.font.ui,
          fontSize: theme.text.xs,
          flexShrink: 0,
          letterSpacing: theme.text.trackingBase,
        }}
      >
        <span style={{ color: theme.color.ink3 }}>
          {effectiveNodes.length} node{effectiveNodes.length !== 1 ? "s" : ""}
        </span>
        {rootAssetId && (
          <>
            <span style={{ color: theme.color.ink5 }}>·</span>
            <span style={{ color: theme.color.ink2 }}>
              Active{" "}
              <span
                style={{
                  color: theme.color.accentBright,
                  fontFamily: theme.font.numeric,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {rootAssetId}
              </span>
            </span>
          </>
        )}
        <span
          style={{
            marginLeft: "auto",
            color: theme.color.ink5,
            fontStyle: "italic",
          }}
        >
          Click to browse · "Use This" to switch variant pointer
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

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
import { useComposition, usePlayback, usePneumaCraftStore } from "@pneuma-craft/react";
import type { Asset } from "@pneuma-craft/core";
import { useTimelineMode } from "../hooks/useTimelineMode.js";
import { useVariantPointer } from "./useVariantPointer.js";
import { tracksForLayer, type LayerType } from "../overview/layerTypes.js";
import { useTreeLayout } from "./useTreeLayout.js";
import { DiveHeader } from "./DiveHeader.js";
import { DiveTrackRibbon } from "./DiveTrackRibbon.js";
import { usePendingGenerations } from "../generation/PendingGenerations.js";
import { VisualNode } from "./nodes/VisualNode.js";
import { AudioNode } from "./nodes/AudioNode.js";
import { TextNode } from "./nodes/TextNode.js";
import { AssetInfoView } from "../assetInfo/AssetInfoView.js";
import { XIcon } from "../icons/index.js";
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
/* Suppress the default selection ring — our NodeShell draws its own
   active/focus states and the extra outline just adds noise. */
.react-flow__node.selected { outline: none; box-shadow: none; }
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

  // Find the clip at the current time for the active dive layer —
  // plus the track it sits on, so the ribbon above the canvas can
  // show the user their spatial position in the timeline.
  const { clip: activeClip, track: activeTrack } = useMemo(() => {
    for (const track of tracksForLayer(tracks, layer)) {
      for (const clip of track.clips) {
        if (
          playback.currentTime >= clip.startTime &&
          playback.currentTime < clip.startTime + clip.duration
        ) {
          return { clip, track };
        }
      }
    }
    return { clip: null, track: null };
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
  // The clip's bound asset type decides which nodes in the DAG are
  // swap-candidates (same type → variant) vs read-only references.
  const coreStateForType = usePneumaCraftStore((s) => s.coreState);
  const activeAssetType = useMemo(() => {
    if (!activeAssetId) return null;
    const asset = coreStateForType.registry.get(activeAssetId);
    return asset?.type ?? null;
  }, [activeAssetId, coreStateForType.registry]);

  const { pending } = usePendingGenerations();
  const { nodes, edges } = useTreeLayout(
    rootAssetId,
    activeAssetId,
    diveFocusedNodeId,
    clipId,
    activeAssetType,
    pending,
  );

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
          role: "variant" as const,
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
      <DiveTrackRibbon
        activeTrack={activeTrack}
        activeClipId={activeClip?.id ?? null}
      />

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
        <DiveDetailPanel
          focusedAssetId={diveFocusedNodeId}
          onClose={() => setDiveFocusedNodeId(null)}
          onNavigateToParent={(id) => setDiveFocusedNodeId(id)}
        />
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
          Click to browse · "Use This" binds this variant to the clip
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

// ─────────────────────────────────────────────────────────────────────────────
// Detail panel — slides in on the right when a node is focused
// ─────────────────────────────────────────────────────────────────────────────

function DiveDetailPanel({
  focusedAssetId,
  onClose,
  onNavigateToParent,
}: {
  focusedAssetId: string | null;
  onClose: () => void;
  onNavigateToParent: (assetId: string) => void;
}) {
  const coreState = usePneumaCraftStore((s) => s.coreState);
  const asset = focusedAssetId
    ? (coreState.registry.get(focusedAssetId) ?? null)
    : null;
  const edge = useMemo(() => {
    if (!focusedAssetId) return null;
    for (const e of coreState.provenance.edges.values()) {
      if (e.toAssetId === focusedAssetId) return e;
    }
    return null;
  }, [coreState.provenance.edges, focusedAssetId]);
  const parentAsset = edge?.fromAssetId
    ? (coreState.registry.get(edge.fromAssetId) ?? null)
    : null;

  if (!asset) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: theme.space.space3,
        right: theme.space.space3,
        bottom: theme.space.space3,
        width: 340,
        maxWidth: "40%",
        background: theme.color.surface1,
        border: `1px solid ${theme.color.borderStrong}`,
        borderRadius: theme.radius.lg,
        boxShadow: theme.elevation.s3,
        display: "flex",
        flexDirection: "column",
        padding: theme.space.space4,
        gap: theme.space.space3,
        overflow: "auto",
        zIndex: 5,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: theme.space.space2,
        }}
      >
        <div
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: theme.text.base,
            fontWeight: theme.text.weightSemibold,
            color: theme.color.ink0,
            letterSpacing: theme.text.trackingTight,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {asset.name}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="close detail panel"
          title="Close (click node again)"
          style={{
            width: 24,
            height: 24,
            borderRadius: theme.radius.sm,
            background: "transparent",
            border: `1px solid ${theme.color.borderWeak}`,
            color: theme.color.ink2,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
            flexShrink: 0,
          }}
        >
          <XIcon size={11} />
        </button>
      </div>

      <AssetInfoView
        asset={asset}
        edge={edge}
        parentAsset={parentAsset}
        onNavigateToParent={onNavigateToParent}
      />
    </div>
  );
}

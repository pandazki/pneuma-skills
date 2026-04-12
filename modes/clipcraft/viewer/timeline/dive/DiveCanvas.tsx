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
import { useClipCraftState, useClipCraftDispatch } from "../../store/ClipCraftContext.js";
import { selectSortedClips } from "../../store/selectors.js";
import type { LayerType } from "../../store/types.js";
import type { StoryboardV2, SlotBinding } from "../../../types.js";
import { useTreeLayout } from "./use-tree-layout.js";
import { DiveHeader } from "./DiveHeader.js";
import { DiveInlineInput } from "./DiveInlineInput.js";
import { VisualNode } from "./nodes/VisualNode.js";
import { AudioNode } from "./nodes/AudioNode.js";
import { TextNode } from "./nodes/TextNode.js";

const RF_DARK_STYLES = `
.react-flow {
  --xy-controls-button-background-color-default: #27272a;
  --xy-controls-button-background-color-hover-default: #3f3f46;
  --xy-controls-button-color-default: #a1a1aa;
  --xy-controls-button-color-hover-default: #fafafa;
  --xy-controls-button-border-color-default: rgba(63, 63, 70, 0.5);
  --xy-controls-box-shadow-default: 0 2px 8px rgba(0,0,0,0.4);
  --xy-minimap-background-color-default: rgba(0,0,0,0.6);
  --xy-minimap-mask-background-color-default: rgba(0,0,0,0.7);
  --xy-minimap-mask-stroke-color-default: rgba(63,63,70,0.5);
  --xy-minimap-node-background-color-default: #f97316;
  --xy-minimap-node-stroke-color-default: transparent;
  --xy-background-color-default: #09090b;
  --xy-background-pattern-dots-color-default: rgba(255,255,255,0.05);
  --xy-node-background-color-default: transparent;
  --xy-node-border-default: none;
  --xy-node-boxshadow-hover-default: none;
  --xy-node-boxshadow-selected-default: none;
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

function sceneAtTime(clips: { duration: number }[], globalTime: number): number {
  let cumulative = 0;
  for (let i = 0; i < clips.length; i++) {
    if (globalTime < cumulative + clips[i].duration || i === clips.length - 1) return i;
    cumulative += clips[i].duration;
  }
  return 0;
}

function DiveCanvasInner() {
  const state = useClipCraftState();
  const dispatch = useClipCraftDispatch();
  const { fitView, setCenter, getNode } = useReactFlow();

  const { diveLayer, playback, graph, diveFocusedNodeId } = state;
  const clips = selectSortedClips(state);
  const layer: LayerType = diveLayer ?? "video";

  const activeClipIdx = useMemo(
    () => sceneAtTime(clips, playback.globalTime),
    [clips, playback.globalTime],
  );
  const activeClip = clips[activeClipIdx] ?? null;

  const slotBinding: SlotBinding | null = useMemo(() => {
    if (!activeClip) return null;
    if (layer === "bgm") {
      return (state.storyboard as StoryboardV2).bgm;
    }
    const slotKey = layer === "video" ? "visual" : layer;
    return activeClip[slotKey as keyof typeof activeClip] as SlotBinding | null;
  }, [activeClip, layer, state.storyboard]);

  const clipId = layer === "bgm" ? "__bgm__" : (activeClip?.id ?? "");
  const slotForBinding: "visual" | "audio" | "caption" | undefined = useMemo(() => {
    if (layer === "bgm") return undefined;
    if (layer === "video") return "visual";
    return layer;
  }, [layer]);

  const { nodes, edges } = useTreeLayout(slotBinding, graph, diveFocusedNodeId, clipId, slotForBinding);

  // Fit view when tree changes
  useEffect(() => {
    if (nodes.length > 0) {
      const timer = setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 50);
      return () => clearTimeout(timer);
    }
  }, [nodes.length, fitView]);

  // Pan to focused node
  useEffect(() => {
    if (!diveFocusedNodeId) return;
    const rfNode = getNode(diveFocusedNodeId);
    if (rfNode) {
      const x = rfNode.position.x + (rfNode.measured?.width ?? 200) / 2;
      const y = rfNode.position.y + (rfNode.measured?.height ?? 160) / 2;
      setCenter(x, y, { duration: 300 });
    }
  }, [diveFocusedNodeId, getNode, setCenter]);

  // Clear focused node when exiting dive
  useEffect(() => {
    return () => {
      dispatch({ type: "SET_DIVE_FOCUSED_NODE", nodeId: null });
    };
  }, [dispatch]);

  return (
    <div style={{
      height: "100%",
      display: "flex",
      flexDirection: "column",
      background: "#09090b",
    }}>
      <style>{RF_DARK_STYLES}</style>

      <DiveHeader />

      <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
        {nodes.length > 0 ? (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            proOptions={{ hideAttribution: true }}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            style={{ background: "#09090b" }}
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="rgba(255,255,255,0.04)" />
            <Controls showInteractive={false} />
            <MiniMap nodeColor={() => "#f97316"} pannable zoomable />
          </ReactFlow>
        ) : (
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            color: "#52525b",
            fontSize: 13,
            fontStyle: "italic",
          }}>
            No generation tree for this slot yet. Use the input below to create one.
          </div>
        )}

        <DiveInlineInput layer={layer} clipId={clipId} focusedNodeId={diveFocusedNodeId} />
      </div>

      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "6px 16px",
        borderTop: "1px solid #27272a",
        fontSize: 11,
        flexShrink: 0,
      }}>
        <span style={{ color: "#71717a" }}>{nodes.length} node{nodes.length !== 1 ? "s" : ""}</span>
        {slotBinding && (
          <>
            <span style={{ color: "#3f3f46" }}>|</span>
            <span style={{ color: "#a1a1aa" }}>
              Active: <span style={{ color: "#f97316" }}>{slotBinding.selectedNodeId}</span>
            </span>
          </>
        )}
        <span style={{ marginLeft: "auto", color: "#52525b" }}>
          Click to browse · "Use This" to switch · Type to create
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

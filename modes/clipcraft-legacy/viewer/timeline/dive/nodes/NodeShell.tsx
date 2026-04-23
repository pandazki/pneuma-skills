import { useCallback } from "react";
import type { GraphNode } from "../../../../types.js";
import { useClipCraftDispatch } from "../../../store/ClipCraftContext.js";

type NodeOrigin = "upload" | "ai-gen" | "manual" | "ai-search";

const ORIGIN_CONFIG: Record<NodeOrigin, { icon: string; label: string }> = {
  "upload":     { icon: "↑", label: "Upload" },
  "ai-gen":     { icon: "✦", label: "AI Generated" },
  "manual":     { icon: "✎", label: "Manual" },
  "ai-search":  { icon: "⌕", label: "AI Search" },
};

const STATUS_COLORS: Record<string, string> = {
  ready: "#22c55e",
  generating: "#f59e0b",
  pending: "#71717a",
  error: "#ef4444",
};

interface Props {
  graphNode: GraphNode;
  isActive: boolean;
  isFocused: boolean;
  clipId?: string;
  slot?: "visual" | "audio" | "caption";
  children: React.ReactNode;
}

export function NodeShell({ graphNode, isActive, isFocused, clipId, slot, children }: Props) {
  const dispatch = useClipCraftDispatch();
  const origin = (graphNode.metadata?.origin as NodeOrigin) ?? "ai-gen";
  const originCfg = ORIGIN_CONFIG[origin] ?? ORIGIN_CONFIG["ai-gen"];
  const statusColor = STATUS_COLORS[graphNode.status] ?? STATUS_COLORS.pending;

  const handleUseThis = useCallback(() => {
    if (slot && clipId) {
      dispatch({ type: "UPDATE_SLOT_BINDING", clipId, slot, selectedNodeId: graphNode.id });
    } else if (clipId === "__bgm__") {
      dispatch({ type: "UPDATE_BGM_BINDING", selectedNodeId: graphNode.id });
    }
  }, [dispatch, clipId, slot, graphNode.id]);

  const handleClick = useCallback(() => {
    dispatch({ type: "SET_DIVE_FOCUSED_NODE", nodeId: graphNode.id });
  }, [dispatch, graphNode.id]);

  const borderColor = isActive ? "#f97316" : isFocused ? "#a1a1aa" : "#3f3f46";
  const bgColor = isActive ? "#431407" : "#1c1917";
  const canBind = slot || clipId === "__bgm__";

  return (
    <div
      onClick={handleClick}
      style={{
        width: 200,
        background: bgColor,
        border: `${isActive ? 2 : 1}px solid ${borderColor}`,
        borderRadius: 10,
        padding: 10,
        cursor: "pointer",
        boxShadow: isActive ? "0 0 20px rgba(249,115,22,0.15)" : "none",
        animation: graphNode.status === "generating" ? "pulse 2s ease-in-out infinite" : undefined,
      }}
    >
      {/* Header: origin badge + status dot */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          background: isActive ? "#7c2d12" : "#27272a",
          padding: "2px 8px",
          borderRadius: 4,
          fontSize: 10,
          color: isActive ? "#fdba74" : "#a1a1aa",
        }}>
          <span style={{ fontSize: 11 }}>{originCfg.icon}</span>
          {originCfg.label}
        </span>
        <span style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: statusColor,
          flexShrink: 0,
        }} />
      </div>

      {/* Type-specific content (children) */}
      {children}

      {/* Prompt / instruction */}
      {graphNode.prompt && (
        <div style={{
          fontSize: 10,
          color: isActive ? "#e5e5e5" : "#a1a1aa",
          marginTop: 8,
          lineHeight: 1.4,
          overflow: "hidden",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
        }}>
          "{graphNode.prompt}"
        </div>
      )}

      {/* Model + metadata line */}
      {graphNode.model && (
        <div style={{ fontSize: 9, color: "#71717a", marginTop: 4 }}>
          {graphNode.model}
          {graphNode.metadata?.duration != null && ` · ${(graphNode.metadata.duration as number).toFixed(1)}s`}
          {graphNode.metadata?.width != null && ` · ${graphNode.metadata.width}×${graphNode.metadata.height}`}
        </div>
      )}

      {/* Use This / Active button */}
      {canBind && (
        <div style={{ marginTop: 8 }}>
          {isActive ? (
            <div style={{
              padding: "4px 0",
              textAlign: "center",
              background: "#7c2d12",
              borderRadius: 4,
              fontSize: 10,
              color: "#fdba74",
            }}>
              ✓ Active
            </div>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); handleUseThis(); }}
              style={{
                width: "100%",
                padding: "4px 0",
                textAlign: "center",
                background: "#27272a",
                border: "1px solid #3f3f46",
                borderRadius: 4,
                fontSize: 10,
                color: "#a1a1aa",
                cursor: "pointer",
              }}
            >
              Use This
            </button>
          )}
        </div>
      )}
    </div>
  );
}

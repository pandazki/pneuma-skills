import { useCallback, useMemo } from "react";
import type { Asset } from "@pneuma-craft/core";
import { usePneumaCraftStore } from "@pneuma-craft/react";
import { useVariantPointer } from "../useVariantPointer.js";
import { useTimelineMode } from "../../hooks/useTimelineMode.js";

type NodeOrigin = "upload" | "ai-gen" | "manual" | "ai-search";

const ORIGIN_CONFIG: Record<NodeOrigin, { icon: string; label: string }> = {
  "upload":     { icon: "\u2191", label: "Upload" },
  "ai-gen":     { icon: "\u2726", label: "AI Generated" },
  "manual":     { icon: "\u270E", label: "Manual" },
  "ai-search":  { icon: "\u2315", label: "AI Search" },
};

const STATUS_COLORS: Record<string, string> = {
  ready: "#22c55e",
  generating: "#f59e0b",
  pending: "#71717a",
  failed: "#ef4444",
};

interface Props {
  asset: Asset;
  isActive: boolean;
  isFocused: boolean;
  clipId: string;
  children: React.ReactNode;
}

export function NodeShell({ asset, isActive, isFocused, clipId, children }: Props) {
  const { set } = useVariantPointer();
  const { setDiveFocusedNodeId } = useTimelineMode();
  const coreState = usePneumaCraftStore((s) => s.coreState);

  // Look up the provenance edge that terminates at this asset. That edge's
  // operation carries the prompt/model/params metadata legacy read from
  // graphNode.metadata.
  const edge = useMemo(() => {
    for (const e of coreState.provenance.edges.values()) {
      if (e.toAssetId === asset.id) return e;
    }
    return null;
  }, [coreState.provenance.edges, asset.id]);

  const op = edge?.operation;
  const originRaw = op?.params?.source as string | undefined;
  const origin: NodeOrigin =
    originRaw === "upload" ? "upload" :
    op?.type === "generate" ? "ai-gen" :
    op?.type === "import" ? "upload" :
    "manual";
  const originCfg = ORIGIN_CONFIG[origin];
  const statusColor = STATUS_COLORS[asset.status ?? "ready"] ?? STATUS_COLORS.pending;

  const prompt = op?.params?.prompt as string | undefined;
  const model = op?.params?.model as string | undefined;

  const handleUseThis = useCallback(() => {
    set(clipId, asset.id);
  }, [set, clipId, asset.id]);

  const handleClick = useCallback(() => {
    setDiveFocusedNodeId(asset.id);
  }, [setDiveFocusedNodeId, asset.id]);

  const borderColor = isActive ? "#f97316" : isFocused ? "#a1a1aa" : "#3f3f46";
  const bgColor = isActive ? "#431407" : "#1c1917";

  return (
    <div
      onClick={handleClick}
      style={{
        width: 200, background: bgColor,
        border: `${isActive ? 2 : 1}px solid ${borderColor}`,
        borderRadius: 10, padding: 10, cursor: "pointer",
        boxShadow: isActive ? "0 0 20px rgba(249,115,22,0.15)" : "none",
        animation: asset.status === "generating" ? "pulse 2s ease-in-out infinite" : undefined,
      }}
    >
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 8,
      }}>
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 4,
          background: isActive ? "#7c2d12" : "#27272a",
          padding: "2px 8px", borderRadius: 4, fontSize: 10,
          color: isActive ? "#fdba74" : "#a1a1aa",
        }}>
          <span style={{ fontSize: 11 }}>{originCfg.icon}</span>
          {originCfg.label}
        </span>
        <span style={{
          width: 8, height: 8, borderRadius: "50%",
          background: statusColor, flexShrink: 0,
        }} />
      </div>

      {children}

      {prompt && (
        <div style={{
          fontSize: 10, color: isActive ? "#e5e5e5" : "#a1a1aa",
          marginTop: 8, lineHeight: 1.4, overflow: "hidden",
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
        }}>
          "{prompt}"
        </div>
      )}

      {model && (
        <div style={{ fontSize: 9, color: "#71717a", marginTop: 4 }}>
          {model}
          {asset.metadata.duration != null && ` \u00B7 ${asset.metadata.duration.toFixed(1)}s`}
          {asset.metadata.width != null && ` \u00B7 ${asset.metadata.width}\u00D7${asset.metadata.height}`}
        </div>
      )}

      <div style={{ marginTop: 8 }}>
        {isActive ? (
          <div style={{
            padding: "4px 0", textAlign: "center", background: "#7c2d12",
            borderRadius: 4, fontSize: 10, color: "#fdba74",
          }}>
            {"\u2713"} Active
          </div>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); handleUseThis(); }}
            style={{
              width: "100%", padding: "4px 0", textAlign: "center",
              background: "#27272a", border: "1px solid #3f3f46",
              borderRadius: 4, fontSize: 10, color: "#a1a1aa", cursor: "pointer",
            }}
          >
            Use This
          </button>
        )}
      </div>
    </div>
  );
}

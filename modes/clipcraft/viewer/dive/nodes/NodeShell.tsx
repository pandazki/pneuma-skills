import { useCallback, useMemo, type ReactElement } from "react";
import type { Asset } from "@pneuma-craft/core";
import { usePneumaCraftStore } from "@pneuma-craft/react";
import { useVariantPointer } from "../useVariantPointer.js";
import { useTimelineMode } from "../../hooks/useTimelineMode.js";
import {
  UploadIcon,
  SparkleIcon,
  PencilIcon,
  SearchIcon,
  CheckIcon,
  type IconProps,
} from "../../icons/index.js";
import { theme } from "../../theme/tokens.js";

type NodeOrigin = "upload" | "ai-gen" | "manual" | "ai-search";

const ORIGIN_CONFIG: Record<
  NodeOrigin,
  { Icon: (props: IconProps) => ReactElement; label: string }
> = {
  upload: { Icon: UploadIcon, label: "Upload" },
  "ai-gen": { Icon: SparkleIcon, label: "AI Generated" },
  manual: { Icon: PencilIcon, label: "Manual" },
  "ai-search": { Icon: SearchIcon, label: "AI Search" },
};

const STATUS_COLORS: Record<string, string> = {
  ready: theme.color.success,
  generating: theme.color.warn,
  pending: theme.color.ink4,
  failed: theme.color.danger,
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
    originRaw === "upload"
      ? "upload"
      : op?.type === "generate"
        ? "ai-gen"
        : op?.type === "import"
          ? "upload"
          : "manual";
  const originCfg = ORIGIN_CONFIG[origin];
  const OriginIcon = originCfg.Icon;
  const statusColor =
    STATUS_COLORS[asset.status ?? "ready"] ?? STATUS_COLORS.pending;

  const prompt = op?.params?.prompt as string | undefined;
  const model = op?.params?.model as string | undefined;

  const handleUseThis = useCallback(() => {
    set(clipId, asset.id);
  }, [set, clipId, asset.id]);

  const handleClick = useCallback(() => {
    setDiveFocusedNodeId(asset.id);
  }, [setDiveFocusedNodeId, asset.id]);

  return (
    <div
      onClick={handleClick}
      style={{
        width: 200,
        background: isActive ? theme.color.accentSoft : theme.color.surface1,
        border: `1px solid ${
          isActive
            ? theme.color.accentBorder
            : isFocused
              ? theme.color.borderStrong
              : theme.color.borderWeak
        }`,
        borderRadius: theme.radius.md,
        padding: theme.space.space3,
        cursor: "pointer",
        fontFamily: theme.font.ui,
        transition: `background ${theme.duration.base}ms ${theme.easing.out}, border-color ${theme.duration.base}ms ${theme.easing.out}`,
        animation:
          asset.status === "generating" ? "pulse 2s ease-in-out infinite" : undefined,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: theme.space.space2,
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: theme.space.space1,
            background: isActive
              ? "oklch(74% 0.16 55 / 0.22)"
              : theme.color.surface2,
            padding: `2px ${theme.space.space2}px`,
            borderRadius: theme.radius.sm,
            fontSize: theme.text.xs,
            fontWeight: theme.text.weightSemibold,
            letterSpacing: theme.text.trackingWide,
            color: isActive ? theme.color.accentBright : theme.color.ink2,
          }}
        >
          <OriginIcon size={11} />
          {originCfg.label}
        </span>
        <span
          aria-label={`status ${asset.status ?? "ready"}`}
          style={{
            width: 7,
            height: 7,
            borderRadius: theme.radius.pill,
            background: statusColor,
            flexShrink: 0,
          }}
        />
      </div>

      {children}

      {prompt && (
        <div
          style={{
            fontSize: theme.text.xs,
            color: isActive ? theme.color.ink0 : theme.color.ink2,
            marginTop: theme.space.space2,
            lineHeight: theme.text.lineHeightSnug,
            letterSpacing: theme.text.trackingBase,
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            fontStyle: "italic",
          }}
        >
          “{prompt}”
        </div>
      )}

      {model && (
        <div
          style={{
            fontFamily: theme.font.numeric,
            fontVariantNumeric: "tabular-nums",
            fontSize: theme.text.xs,
            color: theme.color.ink4,
            marginTop: theme.space.space1,
            letterSpacing: theme.text.trackingBase,
          }}
        >
          {model}
          {asset.metadata.duration != null &&
            ` · ${asset.metadata.duration.toFixed(1)}s`}
          {asset.metadata.width != null &&
            ` · ${asset.metadata.width}×${asset.metadata.height}`}
        </div>
      )}

      <div style={{ marginTop: theme.space.space2 }}>
        {isActive ? (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: theme.space.space1,
              width: "100%",
              padding: `${theme.space.space1}px 0`,
              background: theme.color.accentSoft,
              border: `1px solid ${theme.color.accentBorder}`,
              borderRadius: theme.radius.sm,
              fontSize: theme.text.xs,
              fontWeight: theme.text.weightSemibold,
              letterSpacing: theme.text.trackingCaps,
              textTransform: "uppercase",
              color: theme.color.accentBright,
            }}
          >
            <CheckIcon size={11} />
            Active
          </div>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleUseThis();
            }}
            style={{
              width: "100%",
              padding: `${theme.space.space1}px 0`,
              background: theme.color.surface2,
              border: `1px solid ${theme.color.borderWeak}`,
              borderRadius: theme.radius.sm,
              fontFamily: theme.font.ui,
              fontSize: theme.text.xs,
              fontWeight: theme.text.weightSemibold,
              letterSpacing: theme.text.trackingCaps,
              textTransform: "uppercase",
              color: theme.color.ink2,
              cursor: "pointer",
              transition: `background ${theme.duration.quick}ms ${theme.easing.out}, color ${theme.duration.quick}ms ${theme.easing.out}`,
            }}
          >
            Use This
          </button>
        )}
      </div>
    </div>
  );
}

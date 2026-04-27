import { useCallback, useMemo, type ReactElement } from "react";
import type { Asset } from "@pneuma-craft/core";
import { useDispatch, usePneumaCraftStore } from "@pneuma-craft/react";
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
import { typeAccent } from "../../assetInfo/typeAccent.js";
import { useGenerationDialog } from "../../generation/useGenerationDialog.js";
import {
  sourceFromAsset,
  type AssetKind,
} from "../../generation/dispatchGeneration.js";

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

/** Classify an asset's origin from the provenance operation that
 *  produced it. Returns null when we can't make a confident call —
 *  callers then just omit the origin chip so the card stays clean
 *  rather than parading an incorrect label. */
function classifyOriginOrNull(
  op:
    | { type?: string; params?: Record<string, unknown> | undefined }
    | undefined,
): NodeOrigin | null {
  const source = op?.params?.source as string | undefined;
  if (source === "upload") return "upload";
  if (source === "manual") return "manual";
  if (source === "ai-search") return "ai-search";
  if (op?.type === "generate" || op?.type === "derive") return "ai-gen";
  if (op?.type === "import") return "upload";
  return null;
}

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
  /** "variant" = same type as the clip's bound asset (swap candidate).
   *  "reference" = cross-type lineage entry — not bindable to the clip. */
  role: "variant" | "reference";
  children: React.ReactNode;
}

export function NodeShell({ asset, isActive, isFocused, clipId, role, children }: Props) {
  const dispatch = useDispatch();
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
  const origin = classifyOriginOrNull(op);
  const originCfg = origin ? ORIGIN_CONFIG[origin] : null;
  const OriginIcon = originCfg?.Icon ?? null;
  const statusColor =
    STATUS_COLORS[asset.status ?? "ready"] ?? STATUS_COLORS.pending;

  const prompt = op?.params?.prompt as string | undefined;
  const model = op?.params?.model as string | undefined;
  const accent = typeAccent(asset.type);
  const TypeIcon = accent.Icon;

  const handleUseThis = useCallback(() => {
    dispatch("human", {
      type: "composition:rebind-clip",
      clipId,
      assetId: asset.id,
    });
  }, [dispatch, clipId, asset.id]);

  const handleClick = useCallback(() => {
    setDiveFocusedNodeId(asset.id);
  }, [setDiveFocusedNodeId, asset.id]);

  const { openForVariant } = useGenerationDialog();
  const variantKind: AssetKind | null =
    asset.type === "image" || asset.type === "video" || asset.type === "audio"
      ? asset.type
      : null;
  const handleVariant = useCallback(() => {
    if (!variantKind) return;
    const source = sourceFromAsset(
      asset,
      (op?.params?.prompt as string | undefined) ?? null,
      (op?.params?.model as string | undefined) ?? null,
      (op?.params?.aspect_ratio as string | undefined) ?? null,
    );
    if (!source) return;
    openForVariant(source, variantKind);
  }, [openForVariant, asset, op, variantKind]);

  return (
    <div
      onClick={handleClick}
      style={{
        width: 200,
        position: "relative",
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
        paddingLeft: theme.space.space3 + 4,
        cursor: "pointer",
        fontFamily: theme.font.ui,
        transition: `background ${theme.duration.base}ms ${theme.easing.out}, border-color ${theme.duration.base}ms ${theme.easing.out}`,
        animation:
          asset.status === "generating" ? "pulse 2s ease-in-out infinite" : undefined,
      }}
    >
      {/* Type accent stripe down the left edge — ambient kind indicator */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 4,
          background: accent.color,
          borderTopLeftRadius: theme.radius.md,
          borderBottomLeftRadius: theme.radius.md,
        }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: theme.space.space1,
          marginBottom: theme.space.space2,
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: theme.space.space1,
            background: accent.soft,
            padding: `2px ${theme.space.space2}px`,
            borderRadius: theme.radius.sm,
            fontSize: theme.text.xs,
            fontWeight: theme.text.weightSemibold,
            letterSpacing: theme.text.trackingWide,
            color: accent.color,
          }}
        >
          <TypeIcon size={11} />
          {accent.label}
        </span>
        {originCfg && OriginIcon && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: theme.space.space1,
              padding: `2px ${theme.space.space2}px`,
              borderRadius: theme.radius.sm,
              fontSize: theme.text.xs,
              fontWeight: theme.text.weightMedium,
              letterSpacing: theme.text.trackingWide,
              color: theme.color.ink3,
            }}
          >
            <OriginIcon size={11} />
            {originCfg.label}
          </span>
        )}
        <span
          aria-label={`status ${asset.status ?? "ready"}`}
          style={{
            width: 7,
            height: 7,
            borderRadius: theme.radius.pill,
            background: statusColor,
            flexShrink: 0,
            marginLeft: "auto",
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

      <div
        style={{
          marginTop: theme.space.space2,
          display: "flex",
          gap: theme.space.space1,
        }}
      >
        {role === "reference" ? (
          // Reference nodes live in the DAG for lineage only — they
          // can't be bound to the clip (type mismatch would break
          // playback). A small chip makes the read-only role obvious.
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: theme.space.space1,
              flex: 1,
              padding: `${theme.space.space1}px 0`,
              background: "transparent",
              border: `1px dashed ${theme.color.borderWeak}`,
              borderRadius: theme.radius.sm,
              fontSize: theme.text.xs,
              fontWeight: theme.text.weightMedium,
              letterSpacing: theme.text.trackingCaps,
              textTransform: "uppercase",
              color: theme.color.ink4,
            }}
            title="Cross-type reference — can't be bound to the current clip"
          >
            Reference
          </div>
        ) : isActive ? (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: theme.space.space1,
              flex: 1,
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
              flex: 1,
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
        {variantKind && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleVariant();
            }}
            title="Generate a variant from this asset"
            aria-label="generate variant"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: theme.space.space1,
              padding: `${theme.space.space1}px ${theme.space.space2}px`,
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
              transition: `background ${theme.duration.quick}ms ${theme.easing.out}, color ${theme.duration.quick}ms ${theme.easing.out}, border-color ${theme.duration.quick}ms ${theme.easing.out}`,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = theme.color.accentBright;
              e.currentTarget.style.borderColor = theme.color.accentBorder;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = theme.color.ink2;
              e.currentTarget.style.borderColor = theme.color.borderWeak;
            }}
          >
            <SparkleIcon size={11} />
            Variant
          </button>
        )}
      </div>
    </div>
  );
}

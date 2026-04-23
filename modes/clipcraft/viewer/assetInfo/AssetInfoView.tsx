/**
 * AssetInfoView — canonical "who is this asset" display.
 *
 * Renders an asset's full identity in one consistent shape:
 *   - Hero preview (image at native aspect / video with controls /
 *     audio waveform + player / text block)
 *   - Origin badge (AI Generated / Upload / Manual / AI Search) + model
 *   - Format line (dimensions, aspect, duration, voice — picked per kind)
 *   - Foldable prompt from the producing provenance edge (3-line peek,
 *     "Show full" toggles an expanded scrollable view)
 *   - Lineage: "From <parent> · derive" or "Root" (parent is clickable)
 *   - Semantic id + createdAt
 *
 * Consumers:
 *   - Variant dialog (shows the source the user is iterating on)
 *   - Asset lightbox (metadata sidebar next to the hero)
 *   - Dive focused-node side panel (details of the currently selected
 *     variant node)
 *
 * The hero can be suppressed (`showHero={false}`) when the caller
 * already owns a larger preview — e.g. the lightbox renders its own
 * hero and uses this only for the sidebar.
 */

import { useState } from "react";
import type { Asset, AssetType } from "@pneuma-craft/react";
import type { Operation } from "@pneuma-craft/core";
import { useWorkspaceAssetUrl } from "../assets/useWorkspaceAssetUrl.js";
import { AudioWaveform } from "../assets/AudioWaveform.js";
import {
  SparkleIcon,
  UploadIcon,
  PencilIcon,
  SearchIcon,
  AudioIcon,
  type IconProps,
} from "../icons/index.js";
import { theme } from "../theme/tokens.js";

type NodeOrigin = "upload" | "ai-gen" | "manual" | "ai-search";

const ORIGIN_CONFIG: Record<
  NodeOrigin,
  { Icon: (p: IconProps) => React.ReactElement; label: string }
> = {
  upload: { Icon: UploadIcon, label: "Upload" },
  "ai-gen": { Icon: SparkleIcon, label: "AI Generated" },
  manual: { Icon: PencilIcon, label: "Manual" },
  "ai-search": { Icon: SearchIcon, label: "AI Search" },
};

function classifyOrigin(op: Operation | null): NodeOrigin | null {
  const source = op?.params?.source as string | undefined;
  if (source === "upload") return "upload";
  if (source === "manual") return "manual";
  if (source === "ai-search") return "ai-search";
  // generate = first-time AI, derive = AI variant — both AI-produced.
  if (op?.type === "generate" || op?.type === "derive") return "ai-gen";
  if (op?.type === "import") return "upload";
  // Unknown origin — don't invent a label.
  return null;
}

export interface AssetInfoViewProps {
  asset: Asset;
  /** Provenance edge that terminates at this asset — carries the
   *  prompt, model, and operation params. Pass null for orphans. */
  edge: { fromAssetId: string | null; operation: Operation } | null;
  /** Optional resolved parent asset, used for the "From <name>" line.
   *  When omitted the lineage row falls back to the raw fromAssetId. */
  parentAsset?: Asset | null;
  /** When true (default), renders the media hero inline. Set to false
   *  in contexts that own their own hero (e.g. lightbox sidebar). */
  showHero?: boolean;
  /** Click handler on the lineage chip. Receives parent asset id. */
  onNavigateToParent?: (parentAssetId: string) => void;
  /** Optional max-height for the container — lightbox uses this to
   *  match its hero height. */
  maxHeight?: number | string;
}

export function AssetInfoView({
  asset,
  edge,
  parentAsset,
  showHero = true,
  onNavigateToParent,
  maxHeight,
}: AssetInfoViewProps) {
  const op = edge?.operation ?? null;
  const origin = classifyOrigin(op);
  const originCfg = origin ? ORIGIN_CONFIG[origin] : null;
  const OriginIcon = originCfg?.Icon ?? null;

  const prompt =
    typeof op?.params?.prompt === "string" ? (op.params.prompt as string) : null;
  const model =
    typeof op?.params?.model === "string" ? (op.params.model as string) : null;
  const agentId = op?.agentId ?? null;
  const label = op?.label ?? null;

  const md = (asset.metadata ?? {}) as Record<string, unknown>;
  const width = typeof md.width === "number" ? md.width : null;
  const height = typeof md.height === "number" ? md.height : null;
  const duration = typeof md.duration === "number" ? md.duration : null;
  const voice = typeof md.voice === "string" ? md.voice : null;
  const aspectRatio =
    typeof op?.params?.aspect_ratio === "string"
      ? (op.params.aspect_ratio as string)
      : null;

  const formatBits: string[] = [];
  if (width && height) formatBits.push(`${width}×${height}`);
  if (aspectRatio) formatBits.push(aspectRatio);
  if (duration != null) formatBits.push(`${duration.toFixed(1)}s`);
  if (voice) formatBits.push(`voice · ${voice}`);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: theme.space.space3,
        maxHeight,
        overflow: maxHeight ? "auto" : undefined,
      }}
    >
      {showHero && <HeroMedia asset={asset} />}

      <div style={{ display: "flex", alignItems: "center", gap: theme.space.space2, flexWrap: "wrap" }}>
        {originCfg && OriginIcon && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: theme.space.space1,
              padding: `2px ${theme.space.space2}px`,
              background: theme.color.surface2,
              borderRadius: theme.radius.sm,
              fontSize: theme.text.xs,
              fontWeight: theme.text.weightSemibold,
              letterSpacing: theme.text.trackingWide,
              color: theme.color.ink2,
            }}
          >
            <OriginIcon size={11} />
            {originCfg.label}
          </span>
        )}
        {model && (
          <span
            style={{
              fontFamily: theme.font.numeric,
              fontVariantNumeric: "tabular-nums",
              fontSize: theme.text.xs,
              color: theme.color.ink3,
              letterSpacing: theme.text.trackingBase,
            }}
          >
            {model}
          </span>
        )}
        {agentId && (
          <span
            style={{
              fontFamily: theme.font.numeric,
              fontSize: theme.text.xs,
              color: theme.color.ink5,
            }}
          >
            · {agentId}
          </span>
        )}
      </div>

      {formatBits.length > 0 && (
        <div
          style={{
            fontFamily: theme.font.numeric,
            fontVariantNumeric: "tabular-nums",
            fontSize: theme.text.sm,
            color: theme.color.ink2,
            letterSpacing: theme.text.trackingBase,
          }}
        >
          {formatBits.join("  ·  ")}
        </div>
      )}

      {(prompt || label) && (
        <FoldableProse
          heading={prompt ? "Prompt" : "Label"}
          body={prompt ?? label ?? ""}
        />
      )}

      <LineageRow
        edge={edge}
        parentAsset={parentAsset}
        onNavigateToParent={onNavigateToParent}
      />

      <div
        style={{
          marginTop: theme.space.space1,
          paddingTop: theme.space.space2,
          borderTop: `1px solid ${theme.color.borderWeak}`,
          display: "flex",
          alignItems: "baseline",
          gap: theme.space.space2,
          fontSize: theme.text.xs,
          color: theme.color.ink4,
        }}
      >
        <span
          style={{
            fontFamily: theme.font.numeric,
            fontVariantNumeric: "tabular-nums",
            color: theme.color.ink3,
            letterSpacing: theme.text.trackingBase,
          }}
        >
          {asset.id}
        </span>
        <span style={{ marginLeft: "auto" }} title={absoluteTime(asset.createdAt)}>
          {relativeTime(asset.createdAt)}
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Hero preview — native aspect, honors media type
// ─────────────────────────────────────────────────────────────────────────────

function HeroMedia({ asset }: { asset: Asset }) {
  const url = useWorkspaceAssetUrl(asset.id);
  const type: AssetType = asset.type;
  const heroFrame: React.CSSProperties = {
    width: "100%",
    maxHeight: 360,
    borderRadius: theme.radius.base,
    background: theme.color.surface0,
    border: `1px solid ${theme.color.borderWeak}`,
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };

  if (!url || asset.status === "pending" || asset.status === "failed") {
    return (
      <div
        style={{
          ...heroFrame,
          minHeight: 120,
          color: theme.color.ink4,
          fontSize: theme.text.sm,
          fontStyle: "italic",
        }}
      >
        {asset.status === "pending"
          ? "Pending generation"
          : asset.status === "failed"
            ? "Generation failed"
            : "Preview not available"}
      </div>
    );
  }

  if (type === "image") {
    return (
      <div style={heroFrame}>
        <img
          src={url}
          alt={asset.name}
          style={{ maxWidth: "100%", maxHeight: 360, objectFit: "contain" }}
        />
      </div>
    );
  }

  if (type === "video") {
    return (
      <div style={heroFrame}>
        <video
          src={url}
          controls
          muted
          playsInline
          preload="metadata"
          style={{ maxWidth: "100%", maxHeight: 360 }}
        />
      </div>
    );
  }

  if (type === "audio") {
    return (
      <div
        style={{
          ...heroFrame,
          flexDirection: "column",
          gap: theme.space.space3,
          padding: theme.space.space4,
          minHeight: 160,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: theme.space.space3,
            color: theme.color.layerAudio,
          }}
        >
          <AudioIcon size={28} />
          <AudioWaveform url={url} width={240} height={48} />
        </div>
        <audio src={url} controls style={{ width: "100%", maxWidth: 420 }} />
      </div>
    );
  }

  // Text / unknown
  return (
    <div
      style={{
        ...heroFrame,
        padding: theme.space.space4,
        color: theme.color.ink1,
        fontFamily: theme.font.display,
        fontSize: theme.text.lg,
        textAlign: "center",
      }}
    >
      {asset.name}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Foldable prose — peek N lines, click "Show full" to expand
// ─────────────────────────────────────────────────────────────────────────────

const PEEK_LINES = 3;

function FoldableProse({ heading, body }: { heading: string; body: string }) {
  const [expanded, setExpanded] = useState(false);
  const canFold = body.length > 140 || body.split("\n").length > PEEK_LINES;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: theme.space.space1 }}>
      <div
        style={{
          fontSize: theme.text.xs,
          color: theme.color.ink3,
          textTransform: "uppercase",
          letterSpacing: theme.text.trackingCaps,
          fontWeight: theme.text.weightSemibold,
        }}
      >
        {heading}
      </div>
      <div
        style={{
          fontSize: theme.text.sm,
          color: theme.color.ink1,
          fontStyle: "italic",
          lineHeight: theme.text.lineHeightSnug,
          letterSpacing: theme.text.trackingBase,
          whiteSpace: "pre-wrap",
          overflow: expanded ? "auto" : "hidden",
          display: expanded ? "block" : "-webkit-box",
          WebkitLineClamp: expanded ? undefined : PEEK_LINES,
          WebkitBoxOrient: expanded ? undefined : "vertical",
          maxHeight: expanded ? 240 : undefined,
        }}
      >
        “{body}”
      </div>
      {canFold && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={{
            alignSelf: "flex-start",
            background: "transparent",
            border: "none",
            padding: 0,
            color: theme.color.accentBright,
            fontFamily: theme.font.ui,
            fontSize: theme.text.xs,
            fontWeight: theme.text.weightSemibold,
            letterSpacing: theme.text.trackingCaps,
            textTransform: "uppercase",
            cursor: "pointer",
          }}
        >
          {expanded ? "Show less" : "Show full"}
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Lineage row — "From <parent> · derive" or "Root"
// ─────────────────────────────────────────────────────────────────────────────

function LineageRow({
  edge,
  parentAsset,
  onNavigateToParent,
}: {
  edge: AssetInfoViewProps["edge"];
  parentAsset?: Asset | null;
  onNavigateToParent?: (id: string) => void;
}) {
  const fromId = edge?.fromAssetId ?? null;
  const opType = edge?.operation?.type ?? "generate";

  if (!fromId) {
    return (
      <div style={rowStyle()}>
        <span style={chipLabel()}>Lineage</span>
        <span style={{ fontSize: theme.text.sm, color: theme.color.ink3, letterSpacing: theme.text.trackingBase }}>
          Root — {opType}
        </span>
      </div>
    );
  }

  const parentLabel = parentAsset?.name ?? fromId;

  return (
    <div style={rowStyle()}>
      <span style={chipLabel()}>From</span>
      <button
        type="button"
        onClick={() => onNavigateToParent?.(fromId)}
        disabled={!onNavigateToParent}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: theme.space.space1,
          padding: `2px ${theme.space.space2}px`,
          background: theme.color.surface2,
          border: `1px solid ${theme.color.borderWeak}`,
          borderRadius: theme.radius.sm,
          color: theme.color.accentBright,
          fontFamily: theme.font.numeric,
          fontVariantNumeric: "tabular-nums",
          fontSize: theme.text.xs,
          cursor: onNavigateToParent ? "pointer" : "default",
          letterSpacing: theme.text.trackingBase,
        }}
      >
        {parentLabel}
      </button>
      <span
        style={{
          fontSize: theme.text.xs,
          color: theme.color.ink4,
          letterSpacing: theme.text.trackingWide,
          textTransform: "uppercase",
        }}
      >
        · {opType}
      </span>
    </div>
  );
}

function rowStyle(): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: theme.space.space2,
    flexWrap: "wrap",
  };
}

function chipLabel(): React.CSSProperties {
  return {
    fontSize: theme.text.xs,
    color: theme.color.ink3,
    textTransform: "uppercase",
    letterSpacing: theme.text.trackingCaps,
    fontWeight: theme.text.weightSemibold,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Time helpers — relative with absolute on hover
// ─────────────────────────────────────────────────────────────────────────────

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

function absoluteTime(ts: number): string {
  return new Date(ts).toISOString().replace("T", " ").slice(0, 19);
}

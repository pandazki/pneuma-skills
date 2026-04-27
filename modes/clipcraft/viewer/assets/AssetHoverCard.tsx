/**
 * AssetHoverCard — lightweight popover that shows the core asset
 * identity when the user hovers a library thumbnail / row.
 *
 * One popover for the whole panel (owned by the provider) so moving
 * the cursor between thumbnails doesn't stack multiple cards. The
 * hover state is gated by a 300ms open delay so fast mouse-overs
 * don't flicker cards, and a ~150ms close delay so crossing into
 * the popover body itself doesn't dismiss it.
 *
 * Shows, from top: thumbnail scaled up (native aspect, capped), type
 * chip, origin + model line, prompt snippet (3 lines, no expansion —
 * for the full text the user opens the lightbox), dimensions /
 * duration / voice line. Everything reads from the same classifier
 * and typeAccent helper the dive nodes and AssetInfoView already
 * share, so the visual language is consistent.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Asset } from "@pneuma-craft/react";
import { usePneumaCraftStore } from "@pneuma-craft/react";
import type { Operation } from "@pneuma-craft/core";
import { theme } from "../theme/tokens.js";
import { typeAccent } from "../assetInfo/typeAccent.js";
import {
  SparkleIcon,
  UploadIcon,
  PencilIcon,
  SearchIcon,
  AudioIcon,
  type IconProps,
} from "../icons/index.js";
import { useWorkspaceAssetUrl } from "./useWorkspaceAssetUrl.js";
import { AudioWaveform } from "./AudioWaveform.js";

const OPEN_DELAY_MS = 300;
const CLOSE_DELAY_MS = 150;
const CARD_WIDTH = 260;
const THUMB_MAX_HEIGHT = 160;
const VIEWPORT_MARGIN = 12;

// ── Origin classifier (same rules as AssetInfoView) ──────────────────────

type OriginKind = "upload" | "ai-gen" | "manual" | "ai-search";
const ORIGIN_ICON: Record<
  OriginKind,
  { Icon: (p: IconProps) => React.ReactElement; label: string }
> = {
  upload: { Icon: UploadIcon, label: "Upload" },
  "ai-gen": { Icon: SparkleIcon, label: "AI Generated" },
  manual: { Icon: PencilIcon, label: "Manual" },
  "ai-search": { Icon: SearchIcon, label: "AI Search" },
};
function classifyOrigin(op: Operation | null): OriginKind | null {
  const source = op?.params?.source as string | undefined;
  if (source === "upload") return "upload";
  if (source === "manual") return "manual";
  if (source === "ai-search") return "ai-search";
  if (op?.type === "generate" || op?.type === "derive") return "ai-gen";
  if (op?.type === "import") return "upload";
  return null;
}

// ── Provider ─────────────────────────────────────────────────────────────

interface HoverTarget {
  asset: Asset;
  rect: DOMRect;
}

interface AssetHoverApi {
  /** Called on thumbnail mouseenter — schedules the popover to open
   *  after the delay. Cancels any pending close. */
  onHoverStart: (asset: Asset, rect: DOMRect) => void;
  /** Called on thumbnail mouseleave — schedules a close after a
   *  short grace so the user can cross into the popover. */
  onHoverEnd: () => void;
}

const Ctx = createContext<AssetHoverApi | null>(null);

export function AssetHoverProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<HoverTarget | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insidePopoverRef = useRef(false);

  const clearTimers = useCallback(() => {
    if (openTimer.current) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const onHoverStart = useCallback(
    (asset: Asset, rect: DOMRect) => {
      clearTimers();
      openTimer.current = setTimeout(() => {
        setActive({ asset, rect });
        openTimer.current = null;
      }, OPEN_DELAY_MS);
    },
    [clearTimers],
  );

  const onHoverEnd = useCallback(() => {
    clearTimers();
    closeTimer.current = setTimeout(() => {
      if (!insidePopoverRef.current) setActive(null);
      closeTimer.current = null;
    }, CLOSE_DELAY_MS);
  }, [clearTimers]);

  // When the popover itself is hovered, suppress close so the user
  // can read it without it disappearing from under them.
  const onPopoverEnter = useCallback(() => {
    insidePopoverRef.current = true;
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);
  const onPopoverLeave = useCallback(() => {
    insidePopoverRef.current = false;
    onHoverEnd();
  }, [onHoverEnd]);

  // Safety: clear timers on unmount.
  useEffect(() => () => clearTimers(), [clearTimers]);

  const api = useMemo<AssetHoverApi>(
    () => ({ onHoverStart, onHoverEnd }),
    [onHoverStart, onHoverEnd],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      {active && (
        <HoverPopover
          target={active}
          onEnter={onPopoverEnter}
          onLeave={onPopoverLeave}
        />
      )}
    </Ctx.Provider>
  );
}

export function useAssetHover(): AssetHoverApi {
  const api = useContext(Ctx);
  if (!api) {
    throw new Error(
      "useAssetHover must be called inside an AssetHoverProvider",
    );
  }
  return api;
}

// ── Popover body ────────────────────────────────────────────────────────

function HoverPopover({
  target,
  onEnter,
  onLeave,
}: {
  target: HoverTarget;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const { asset, rect } = target;
  const url = useWorkspaceAssetUrl(asset.id);
  const accent = typeAccent(asset.type);
  const TypeIcon = accent.Icon;

  // Look up the provenance edge that produced this asset for origin /
  // model / prompt. Doing it here keeps AssetThumbnail free of the
  // lookup cost — it only runs on the asset currently hovered.
  const coreState = usePneumaCraftStore((s) => s.coreState);
  const edge = useMemo(() => {
    for (const e of coreState.provenance.edges.values()) {
      if (e.toAssetId === asset.id) return e;
    }
    return null;
  }, [coreState.provenance.edges, asset.id]);

  const op = edge?.operation ?? null;
  const origin = classifyOrigin(op);
  const originCfg = origin ? ORIGIN_ICON[origin] : null;
  const OriginIcon = originCfg?.Icon ?? null;

  const prompt =
    typeof op?.params?.prompt === "string" ? (op.params.prompt as string) : null;
  const model =
    typeof op?.params?.model === "string" ? (op.params.model as string) : null;

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

  // Compute position: default to the right of the anchor, flipping
  // to the left when there isn't enough room. Vertically clamp to the
  // viewport so the card never hangs off the top/bottom edge.
  const { left, top } = useMemo(() => {
    const vw = typeof window !== "undefined" ? window.innerWidth : 1920;
    const vh = typeof window !== "undefined" ? window.innerHeight : 1080;
    const preferRight = rect.right + 12 + CARD_WIDTH + VIEWPORT_MARGIN <= vw;
    const l = preferRight ? rect.right + 12 : rect.left - 12 - CARD_WIDTH;
    let t = rect.top;
    // Rough card height estimate for clamping — popover may actually
    // be shorter; this is a pre-measure cap, not exact.
    const estHeight = 260;
    if (t + estHeight + VIEWPORT_MARGIN > vh) t = vh - estHeight - VIEWPORT_MARGIN;
    if (t < VIEWPORT_MARGIN) t = VIEWPORT_MARGIN;
    return { left: Math.max(VIEWPORT_MARGIN, l), top: t };
  }, [rect]);

  return (
    <div
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{
        position: "fixed",
        left,
        top,
        width: CARD_WIDTH,
        zIndex: 10_000,
        background: theme.color.surface1,
        border: `1px solid ${theme.color.borderStrong}`,
        borderRadius: theme.radius.lg,
        boxShadow: theme.elevation.s3,
        padding: theme.space.space3,
        display: "flex",
        flexDirection: "column",
        gap: theme.space.space2,
        fontFamily: theme.font.ui,
        pointerEvents: "auto",
      }}
    >
      <HoverThumb asset={asset} url={url} />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: theme.space.space1,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: theme.space.space1,
            padding: `2px ${theme.space.space2}px`,
            background: accent.soft,
            color: accent.color,
            borderRadius: theme.radius.sm,
            fontSize: theme.text.xs,
            fontWeight: theme.text.weightSemibold,
            letterSpacing: theme.text.trackingWide,
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
              fontSize: theme.text.xs,
              color: theme.color.ink3,
              letterSpacing: theme.text.trackingWide,
            }}
          >
            <OriginIcon size={11} />
            {originCfg.label}
          </span>
        )}
      </div>
      <div
        style={{
          fontSize: theme.text.sm,
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
      {prompt && (
        <div
          style={{
            fontSize: theme.text.xs,
            color: theme.color.ink2,
            fontStyle: "italic",
            lineHeight: theme.text.lineHeightSnug,
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
          }}
        >
          “{prompt}”
        </div>
      )}
      {(model || formatBits.length > 0) && (
        <div
          style={{
            fontFamily: theme.font.numeric,
            fontVariantNumeric: "tabular-nums",
            fontSize: theme.text.xs,
            color: theme.color.ink4,
            letterSpacing: theme.text.trackingBase,
          }}
        >
          {[model, ...formatBits].filter(Boolean).join("  ·  ")}
        </div>
      )}
    </div>
  );
}

function HoverThumb({ asset, url }: { asset: Asset; url: string | null }) {
  const frame: React.CSSProperties = {
    width: "100%",
    maxHeight: THUMB_MAX_HEIGHT,
    borderRadius: theme.radius.base,
    overflow: "hidden",
    background: theme.color.surface0,
    border: `1px solid ${theme.color.borderWeak}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };

  if (!url || asset.status === "pending" || asset.status === "failed") {
    return (
      <div
        style={{
          ...frame,
          height: 96,
          color: theme.color.ink4,
          fontSize: theme.text.xs,
          fontStyle: "italic",
        }}
      >
        {asset.status === "pending"
          ? "Pending"
          : asset.status === "failed"
            ? "Failed"
            : "No preview"}
      </div>
    );
  }
  if (asset.type === "image") {
    return (
      <div style={frame}>
        <img
          src={url}
          alt={asset.name}
          style={{ maxWidth: "100%", maxHeight: THUMB_MAX_HEIGHT, objectFit: "contain" }}
        />
      </div>
    );
  }
  if (asset.type === "video") {
    return (
      <div style={frame}>
        <video
          src={url}
          muted
          playsInline
          preload="metadata"
          onLoadedData={(e) => {
            (e.target as HTMLVideoElement).currentTime = 0.1;
          }}
          style={{ maxWidth: "100%", maxHeight: THUMB_MAX_HEIGHT }}
        />
      </div>
    );
  }
  if (asset.type === "audio") {
    return (
      <div style={{ ...frame, flexDirection: "column", gap: theme.space.space2, padding: theme.space.space3, height: 96 }}>
        <AudioIcon size={22} />
        <AudioWaveform url={url} width={220} height={32} />
      </div>
    );
  }
  return <div style={{ ...frame, height: 72, color: theme.color.ink3 }}>{asset.name}</div>;
}

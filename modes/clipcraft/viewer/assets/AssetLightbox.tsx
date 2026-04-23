import { useEffect, useMemo } from "react";
import { usePneumaCraftStore } from "@pneuma-craft/react";
import type { Asset } from "@pneuma-craft/react";
import { useWorkspaceAssetUrl } from "./useWorkspaceAssetUrl.js";
import { XIcon, AudioIcon } from "../icons/index.js";
import { theme } from "../theme/tokens.js";
import { AssetInfoView } from "../assetInfo/AssetInfoView.js";

/**
 * Full-screen preview of a single asset. Two-column layout: the media
 * hero fills the left (dominating the visual weight) and
 * AssetInfoView sits on the right as the metadata sidebar — lineage,
 * foldable prompt, model, dimensions, created-at, semantic id.
 *
 * The sidebar's own hero is suppressed (`showHero={false}`) because
 * the lightbox already renders a larger hero on the left; duplicating
 * it would push the metadata off-screen.
 */
export function AssetLightbox({
  asset,
  onClose,
  onNavigateToAsset,
}: {
  asset: Asset;
  onClose: () => void;
  /** Optional navigation when user clicks the lineage "From" chip. */
  onNavigateToAsset?: (assetId: string) => void;
}) {
  const url = useWorkspaceAssetUrl(asset.id);

  // Escape-to-close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const coreState = usePneumaCraftStore((s) => s.coreState);
  const edge = useMemo(() => {
    for (const e of coreState.provenance.edges.values()) {
      if (e.toAssetId === asset.id) return e;
    }
    return null;
  }, [coreState.provenance.edges, asset.id]);
  const parentAsset = edge?.fromAssetId
    ? (coreState.registry.get(edge.fromAssetId) ?? null)
    : null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "oklch(0% 0 0 / 0.8)",
        backdropFilter: "blur(2px)",
        WebkitBackdropFilter: "blur(2px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: theme.font.ui,
        padding: theme.space.space5,
      }}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="close"
        title="Close (Esc)"
        style={{
          position: "absolute",
          top: theme.space.space4,
          right: theme.space.space4,
          width: 32,
          height: 32,
          borderRadius: theme.radius.pill,
          background: theme.color.surface2,
          border: `1px solid ${theme.color.border}`,
          color: theme.color.ink1,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          zIndex: 1,
        }}
      >
        <XIcon size={14} />
      </button>

      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 360px",
          gap: theme.space.space5,
          width: "min(1400px, 96vw)",
          maxHeight: "86vh",
          background: theme.color.surface1,
          border: `1px solid ${theme.color.borderStrong}`,
          borderRadius: theme.radius.lg,
          boxShadow: theme.elevation.s3,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: 0,
            minHeight: 0,
            padding: theme.space.space5,
            background: theme.color.surface0,
          }}
        >
          <HeroMediaLarge asset={asset} url={url} />
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            minHeight: 0,
            padding: theme.space.space5,
            borderLeft: `1px solid ${theme.color.borderWeak}`,
            background: theme.color.surface1,
            overflow: "auto",
          }}
        >
          <div
            style={{
              fontSize: theme.text.lg,
              fontWeight: theme.text.weightSemibold,
              color: theme.color.ink0,
              letterSpacing: theme.text.trackingTight,
              marginBottom: theme.space.space1,
            }}
          >
            {asset.name}
          </div>
          <div
            style={{
              fontFamily: theme.font.numeric,
              fontSize: theme.text.xs,
              color: theme.color.ink4,
              marginBottom: theme.space.space4,
              letterSpacing: theme.text.trackingBase,
            }}
          >
            {asset.uri || asset.id}
          </div>
          <AssetInfoView
            asset={asset}
            edge={edge}
            parentAsset={parentAsset}
            showHero={false}
            onNavigateToParent={onNavigateToAsset}
          />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Larger hero renderer for the lightbox — same per-type shape as
// AssetInfoView's HeroMedia but sized to fill the left column
// ─────────────────────────────────────────────────────────────────────────────

function HeroMediaLarge({ asset, url }: { asset: Asset; url: string | null }) {
  if (!url || asset.status === "pending" || asset.status === "failed") {
    return (
      <div
        style={{
          fontSize: theme.text.base,
          color: theme.color.ink3,
          padding: theme.space.space6,
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

  if (asset.type === "image") {
    return (
      <img
        src={url}
        alt={asset.name}
        style={{
          maxWidth: "100%",
          maxHeight: "76vh",
          objectFit: "contain",
          borderRadius: theme.radius.sm,
        }}
      />
    );
  }

  if (asset.type === "video") {
    return (
      <video
        src={url}
        controls
        autoPlay
        muted
        style={{
          maxWidth: "100%",
          maxHeight: "76vh",
          objectFit: "contain",
          borderRadius: theme.radius.sm,
        }}
      />
    );
  }

  if (asset.type === "audio") {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: theme.space.space4,
          padding: theme.space.space6,
          background: theme.color.surface1,
          border: `1px solid ${theme.color.borderWeak}`,
          borderRadius: theme.radius.lg,
          minWidth: 360,
        }}
      >
        <div
          style={{
            width: 88,
            height: 88,
            borderRadius: theme.radius.pill,
            background: theme.color.layerAudioSoft,
            border: `1px solid ${theme.color.layerAudio}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: theme.color.layerAudio,
          }}
        >
          <AudioIcon size={40} />
        </div>
        <audio src={url} controls autoPlay style={{ width: 320 }} />
      </div>
    );
  }

  return (
    <div
      style={{
        fontFamily: theme.font.display,
        fontSize: theme.text.xl,
        color: theme.color.ink1,
        padding: theme.space.space6,
        textAlign: "center",
      }}
    >
      {asset.name}
    </div>
  );
}

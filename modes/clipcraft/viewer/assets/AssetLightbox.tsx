import { useCallback, useEffect, useMemo, useState } from "react";
import { useComposition, useDispatch, usePneumaCraftStore } from "@pneuma-craft/react";
import type { Asset } from "@pneuma-craft/react";
import { useWorkspaceAssetUrl } from "./useWorkspaceAssetUrl.js";
import { XIcon, AudioIcon, VideoIcon, SparkleIcon, TrashIcon } from "../icons/index.js";
import { theme } from "../theme/tokens.js";
import { AssetInfoView } from "../assetInfo/AssetInfoView.js";
import { useGenerationDialog } from "../generation/useGenerationDialog.js";
import { sourceFromAsset } from "../generation/dispatchGeneration.js";

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

  const { openForVariant, openForCreateVideoFromImage } = useGenerationDialog();

  const handleGenerateVariant = useCallback(() => {
    if (asset.type !== "image" && asset.type !== "video" && asset.type !== "audio") return;
    const src = sourceFromAsset(
      asset,
      (edge?.operation?.params?.prompt as string | undefined) ?? null,
      (edge?.operation?.params?.model as string | undefined) ?? null,
      (edge?.operation?.params?.aspect_ratio as string | undefined) ?? null,
    );
    if (!src) return;
    onClose(); // close lightbox so dialog isn't layered on backdrop
    openForVariant(src, asset.type);
  }, [asset, edge, openForVariant, onClose]);

  const handleGenerateVideoFromThis = useCallback(() => {
    if (asset.type !== "image") return;
    if (!asset.uri) return;
    onClose();
    openForCreateVideoFromImage({
      assetId: asset.id,
      uri: asset.uri,
      name: asset.name ?? asset.id,
    });
  }, [asset, openForCreateVideoFromImage, onClose]);

  const variantKind =
    asset.type === "image" || asset.type === "video" || asset.type === "audio"
      ? asset.type
      : null;

  // ── Delete flow ────────────────────────────────────────────────────────
  // Any clip on the timeline still bound to this asset blocks the delete:
  // removing the asset would leave the clip pointing at a ghost id and
  // playback would crash. The user has to swap the clip off (via USE
  // THIS on a sibling, or rebinding manually) before delete is allowed.
  const composition = useComposition();
  const boundClips = useMemo(() => {
    const out: { trackName: string; clipId: string; startTime: number }[] = [];
    for (const track of composition?.tracks ?? []) {
      for (const clip of track.clips) {
        if (clip.assetId === asset.id) {
          out.push({ trackName: track.name, clipId: clip.id, startTime: clip.startTime });
        }
      }
    }
    return out;
  }, [composition, asset.id]);
  const dispatch = useDispatch();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  useEffect(() => {
    setConfirmingDelete(false);
  }, [asset.id]);
  const handleDelete = useCallback(() => {
    if (boundClips.length > 0) return; // button is disabled in this state
    // Unlink every edge touching the asset, then remove the asset.
    // Craft doesn't auto-clean provenance on asset:remove, so without
    // this, the DAG would hold dangling edges pointing at a ghost id.
    for (const e of coreState.provenance.edges.values()) {
      if (e.toAssetId === asset.id || e.fromAssetId === asset.id) {
        dispatch("human", { type: "provenance:unlink", edgeId: e.id });
      }
    }
    dispatch("human", { type: "asset:remove", assetId: asset.id });
    onClose();
  }, [boundClips.length, coreState.provenance.edges, asset.id, dispatch, onClose]);

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
          <div
            style={{
              marginTop: theme.space.space4,
              paddingTop: theme.space.space3,
              borderTop: `1px solid ${theme.color.borderWeak}`,
              display: "flex",
              flexDirection: "column",
              gap: theme.space.space2,
            }}
          >
            {asset.type === "image" && asset.uri && (
              <button
                type="button"
                onClick={handleGenerateVideoFromThis}
                style={primaryActionBtnStyle}
                title="Generate a new video clip with this image as the first frame"
              >
                <VideoIcon size={13} />
                <span>Generate video from this image</span>
              </button>
            )}
            {variantKind && (
              <button
                type="button"
                onClick={handleGenerateVariant}
                style={secondaryActionBtnStyle}
                title="Generate a variant of this asset"
              >
                <SparkleIcon size={13} />
                <span>Generate variant</span>
              </button>
            )}
            {boundClips.length > 0 ? (
              <div
                style={{
                  marginTop: theme.space.space2,
                  padding: theme.space.space2,
                  background: theme.color.surface0,
                  border: `1px dashed ${theme.color.borderWeak}`,
                  borderRadius: theme.radius.sm,
                  fontSize: theme.text.xs,
                  color: theme.color.ink4,
                  lineHeight: theme.text.lineHeightSnug,
                  fontStyle: "italic",
                }}
              >
                Bound to {boundClips.length} clip
                {boundClips.length > 1 ? "s" : ""} on the timeline — swap
                those off this asset (via Use This on a sibling) before
                deleting.
              </div>
            ) : confirmingDelete ? (
              <div
                style={{
                  marginTop: theme.space.space2,
                  display: "flex",
                  flexDirection: "column",
                  gap: theme.space.space2,
                  padding: theme.space.space2,
                  background: theme.color.dangerSoft,
                  border: `1px solid ${theme.color.dangerBorder}`,
                  borderRadius: theme.radius.sm,
                }}
              >
                <span
                  style={{
                    fontSize: theme.text.xs,
                    color: theme.color.dangerInk,
                    letterSpacing: theme.text.trackingBase,
                  }}
                >
                  Delete this asset? Its provenance edges will also be
                  removed. The file on disk stays — clean it up via the
                  Asset Manager if you want.
                </span>
                <div style={{ display: "flex", gap: theme.space.space2 }}>
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(false)}
                    style={{ ...secondaryActionBtnStyle, flex: 1 }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleDelete}
                    style={{ ...dangerActionBtnStyle, flex: 1 }}
                  >
                    <TrashIcon size={13} />
                    <span>Delete</span>
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                style={ghostDangerBtnStyle}
                title="Delete this asset from the project"
              >
                <TrashIcon size={13} />
                <span>Delete asset</span>
              </button>
            )}
          </div>
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

const primaryActionBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: theme.space.space2,
  height: 32,
  padding: `0 ${theme.space.space3}px`,
  background: theme.color.accentSoft,
  border: `1px solid ${theme.color.accentBorder}`,
  borderRadius: theme.radius.base,
  color: theme.color.accentBright,
  fontFamily: theme.font.ui,
  fontSize: theme.text.sm,
  fontWeight: theme.text.weightSemibold,
  letterSpacing: theme.text.trackingBase,
  cursor: "pointer",
  transition: `background ${theme.duration.quick}ms ${theme.easing.out}`,
};

const secondaryActionBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: theme.space.space2,
  height: 32,
  padding: `0 ${theme.space.space3}px`,
  background: theme.color.surface2,
  border: `1px solid ${theme.color.borderWeak}`,
  borderRadius: theme.radius.base,
  color: theme.color.ink2,
  fontFamily: theme.font.ui,
  fontSize: theme.text.sm,
  fontWeight: theme.text.weightMedium,
  letterSpacing: theme.text.trackingBase,
  cursor: "pointer",
  transition: `background ${theme.duration.quick}ms ${theme.easing.out}, color ${theme.duration.quick}ms ${theme.easing.out}`,
};

const ghostDangerBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: theme.space.space2,
  height: 30,
  padding: `0 ${theme.space.space3}px`,
  background: "transparent",
  border: `1px solid ${theme.color.borderWeak}`,
  borderRadius: theme.radius.base,
  color: theme.color.ink4,
  fontFamily: theme.font.ui,
  fontSize: theme.text.xs,
  fontWeight: theme.text.weightMedium,
  letterSpacing: theme.text.trackingBase,
  cursor: "pointer",
  transition: `color ${theme.duration.quick}ms ${theme.easing.out}, border-color ${theme.duration.quick}ms ${theme.easing.out}`,
};

const dangerActionBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: theme.space.space2,
  height: 30,
  padding: `0 ${theme.space.space3}px`,
  background: theme.color.danger,
  border: `1px solid ${theme.color.danger}`,
  borderRadius: theme.radius.base,
  color: "oklch(98% 0 0)",
  fontFamily: theme.font.ui,
  fontSize: theme.text.sm,
  fontWeight: theme.text.weightSemibold,
  letterSpacing: theme.text.trackingBase,
  cursor: "pointer",
};

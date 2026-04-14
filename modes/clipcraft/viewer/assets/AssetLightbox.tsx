import type { Asset } from "@pneuma-craft/react";
import { useWorkspaceAssetUrl } from "./useWorkspaceAssetUrl.js";
import { XIcon, AudioIcon } from "../icons/index.js";
import { theme } from "../theme/tokens.js";

export function AssetLightbox({
  asset,
  onClose,
}: {
  asset: Asset;
  onClose: () => void;
}) {
  const url = useWorkspaceAssetUrl(asset.id);

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
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: theme.font.ui,
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
          transition: `background ${theme.duration.quick}ms ${theme.easing.out}, color ${theme.duration.quick}ms ${theme.easing.out}`,
        }}
      >
        <XIcon size={14} />
      </button>

      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          maxWidth: "90vw",
          maxHeight: "80vh",
        }}
      >
        {url && asset.type === "image" && (
          <img
            src={url}
            alt={asset.name}
            style={{
              maxWidth: "90vw",
              maxHeight: "75vh",
              objectFit: "contain",
              borderRadius: theme.radius.sm,
            }}
          />
        )}
        {url && asset.type === "video" && (
          <video
            src={url}
            controls
            autoPlay
            muted
            style={{
              maxWidth: "90vw",
              maxHeight: "75vh",
              objectFit: "contain",
              borderRadius: theme.radius.sm,
            }}
          />
        )}
        {url && asset.type === "audio" && (
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
        )}
        {!url && (
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
              : "Preview not available"}
          </div>
        )}
      </div>

      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          marginTop: theme.space.space4,
          textAlign: "center",
          maxWidth: "90vw",
        }}
      >
        <div
          style={{
            fontSize: theme.text.base,
            color: theme.color.ink0,
            fontWeight: theme.text.weightSemibold,
            letterSpacing: theme.text.trackingTight,
          }}
        >
          {asset.name}
        </div>
        <div
          style={{
            fontFamily: theme.font.numeric,
            fontSize: theme.text.sm,
            color: theme.color.ink4,
            marginTop: 2,
            letterSpacing: theme.text.trackingBase,
          }}
        >
          {asset.uri || asset.id}
        </div>
      </div>
    </div>
  );
}

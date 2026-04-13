import type { Asset } from "@pneuma-craft/react";
import { useWorkspaceAssetUrl } from "./useWorkspaceAssetUrl.js";

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
        background: "rgba(0,0,0,0.85)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <button
        onClick={onClose}
        aria-label="close"
        style={{
          position: "absolute",
          top: 16,
          right: 16,
          width: 32,
          height: 32,
          borderRadius: 16,
          background: "rgba(255,255,255,0.1)",
          border: "1px solid rgba(255,255,255,0.2)",
          color: "#e4e4e7",
          fontSize: 16,
          cursor: "pointer",
        }}
      >
        ×
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
              borderRadius: 4,
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
              borderRadius: 4,
            }}
          />
        )}
        {url && asset.type === "audio" && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 16,
              padding: 32,
            }}
          >
            <div style={{ fontSize: 48, color: "#71717a" }}>♪</div>
            <audio src={url} controls autoPlay style={{ width: 320 }} />
          </div>
        )}
        {!url && (
          <div style={{ fontSize: 13, color: "#71717a", padding: 32 }}>
            {asset.status === "pending" ? "Pending generation" : "Preview not available"}
          </div>
        )}
      </div>

      <div
        onClick={(e) => e.stopPropagation()}
        style={{ marginTop: 12, textAlign: "center", maxWidth: "90vw" }}
      >
        <div style={{ fontSize: 13, color: "#e4e4e7", fontWeight: 500 }}>{asset.name}</div>
        <div style={{ fontSize: 11, color: "#71717a", marginTop: 2 }}>{asset.uri || asset.id}</div>
      </div>
    </div>
  );
}

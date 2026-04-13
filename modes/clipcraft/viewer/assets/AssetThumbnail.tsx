import { useCallback } from "react";
import type { Asset } from "@pneuma-craft/react";
import { useWorkspaceAssetUrl } from "./useWorkspaceAssetUrl.js";
import { useAssetError } from "./useAssetErrors.js";
import { useAssetMetadata } from "./useAssetMetadata.js";

export interface AssetThumbnailProps {
  asset: Asset;
  onOpen: (asset: Asset) => void;
  onDelete: (assetId: string) => void;
}

export function AssetThumbnail({ asset, onOpen, onDelete }: AssetThumbnailProps) {
  const url = useWorkspaceAssetUrl(asset.id);
  const error = useAssetError(asset.id);
  const meta = useAssetMetadata(asset.id);

  const tooltip = [
    asset.name,
    meta?.model ? `model: ${meta.model}` : null,
    meta?.prompt ? `prompt: ${meta.prompt}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onDelete(asset.id);
    },
    [asset.id, onDelete],
  );

  return (
    <div
      onClick={() => onOpen(asset)}
      title={tooltip}
      style={{
        position: "relative",
        width: 48,
        height: 48,
        borderRadius: 3,
        overflow: "hidden",
        background: "#18181b",
        cursor: "pointer",
        border: error ? "1px solid #ef4444" : "1px solid transparent",
      }}
    >
      {url && asset.type === "video" ? (
        <video
          src={url}
          muted
          playsInline
          preload="metadata"
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
          onLoadedData={(e) => {
            (e.target as HTMLVideoElement).currentTime = 0.1;
          }}
        />
      ) : url && asset.type === "image" ? (
        <img
          src={url}
          alt={asset.name}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            fontSize: 10,
            color: "#71717a",
            textAlign: "center",
            padding: 2,
          }}
        >
          {asset.status === "pending" ? "…pending" : asset.name.slice(0, 8)}
        </div>
      )}

      {error && (
        <div
          style={{
            position: "absolute",
            left: 2,
            bottom: 2,
            background: "rgba(239,68,68,0.9)",
            color: "#fff",
            fontSize: 8,
            padding: "0 3px",
            borderRadius: 2,
            maxWidth: "90%",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {error}
        </div>
      )}

      <button
        onClick={handleDelete}
        className="asset-delete-btn"
        style={{
          position: "absolute",
          top: 1,
          right: 1,
          width: 14,
          height: 14,
          borderRadius: 7,
          background: "rgba(0,0,0,0.7)",
          border: "none",
          color: "#ef4444",
          fontSize: 9,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
        aria-label={`remove ${asset.name}`}
      >
        x
      </button>
    </div>
  );
}

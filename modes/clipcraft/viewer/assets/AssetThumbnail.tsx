import { useCallback, useState } from "react";
import type { Asset } from "@pneuma-craft/react";
import { useWorkspaceAssetUrl } from "./useWorkspaceAssetUrl.js";
import { useAssetError } from "./useAssetErrors.js";
import { useAssetMetadata } from "./useAssetMetadata.js";
import { theme } from "../theme/tokens.js";
import { XIcon } from "../icons/index.js";
import { startAssetDrag } from "../timeline/hooks/useTrackDropTarget.js";

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

  const [dragging, setDragging] = useState(false);
  const canDrag = asset.type !== "text" && !!url;

  return (
    <div
      onClick={() => onOpen(asset)}
      title={tooltip}
      draggable={canDrag}
      onDragStart={(e) => {
        if (!canDrag) {
          e.preventDefault();
          return;
        }
        startAssetDrag(e, asset);
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      style={{
        position: "relative",
        width: 56,
        height: 56,
        borderRadius: theme.radius.sm,
        overflow: "hidden",
        background: theme.color.surface2,
        cursor: canDrag ? "grab" : "pointer",
        opacity: dragging ? 0.4 : 1,
        border: error
          ? `1px solid ${theme.color.danger}`
          : `1px solid ${theme.color.borderWeak}`,
        transition: `opacity ${theme.duration.quick}ms ${theme.easing.out}`,
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
            fontFamily: theme.font.ui,
            fontSize: theme.text.xs,
            color: theme.color.ink4,
            textAlign: "center",
            padding: 2,
            letterSpacing: theme.text.trackingBase,
          }}
        >
          {asset.status === "pending" ? "Pending…" : asset.name.slice(0, 8)}
        </div>
      )}

      {error && (
        <div
          style={{
            position: "absolute",
            left: 2,
            bottom: 2,
            background: theme.color.dangerSoft,
            border: `1px solid ${theme.color.dangerBorder}`,
            color: theme.color.dangerInk,
            fontFamily: theme.font.ui,
            fontSize: theme.text.xs,
            padding: "0 4px",
            borderRadius: theme.radius.sm,
            maxWidth: "92%",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={handleDelete}
        className="asset-delete-btn"
        style={{
          position: "absolute",
          top: 3,
          right: 3,
          width: 16,
          height: 16,
          borderRadius: theme.radius.pill,
          background: "oklch(0% 0 0 / 0.65)",
          border: `1px solid ${theme.color.borderWeak}`,
          color: theme.color.ink1,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
        }}
        aria-label={`remove ${asset.name}`}
      >
        <XIcon size={9} />
      </button>
    </div>
  );
}

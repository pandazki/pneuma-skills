import { useState } from "react";
import type { Asset } from "@pneuma-craft/react";
import { useWorkspaceAssetUrl } from "./useWorkspaceAssetUrl.js";
import { useAssetError } from "./useAssetErrors.js";
import { useAssetMetadata } from "./useAssetMetadata.js";
import { theme } from "../theme/tokens.js";
import { typeAccent } from "../assetInfo/typeAccent.js";
import { WarningIcon } from "../icons/index.js";
import { startAssetDrag } from "../timeline/hooks/useTrackDropTarget.js";

export interface AssetThumbnailProps {
  asset: Asset;
  onOpen: (asset: Asset) => void;
  isMissing?: boolean;
}

export function AssetThumbnail({ asset, onOpen, isMissing = false }: AssetThumbnailProps) {
  const url = useWorkspaceAssetUrl(asset.id);
  const error = useAssetError(asset.id);
  const meta = useAssetMetadata(asset.id);
  const accent = typeAccent(asset.type);
  const TypeIcon = accent.Icon;

  const tooltip = [
    asset.name,
    meta?.model ? `model: ${meta.model}` : null,
    meta?.prompt ? `prompt: ${meta.prompt}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const [dragging, setDragging] = useState(false);
  const canDrag = asset.type !== "text" && !!url;

  return (
    <div
      data-asset-id={asset.id}
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
        opacity: dragging ? 0.4 : isMissing ? 0.4 : 1,
        border: error
          ? `1px solid ${theme.color.danger}`
          : isMissing
          ? `1px solid ${theme.color.dangerBorder}`
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

      {/* Type corner — small colored chip so image / video / audio /
          text cards stay distinguishable at 56×56, where frame
          content alone (especially for title-card-style stills vs
          short video clips) can blur. */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          top: 2,
          left: 2,
          width: 14,
          height: 14,
          borderRadius: theme.radius.sm,
          background: accent.soft,
          color: accent.color,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backdropFilter: "blur(1px)",
          WebkitBackdropFilter: "blur(1px)",
        }}
      >
        <TypeIcon size={9} />
      </span>

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

      {isMissing && (
        <div
          style={{
            position: "absolute",
            top: 2,
            right: 2,
            background: theme.color.dangerSoft,
            borderRadius: 3,
            padding: "1px 4px",
            fontSize: 10,
            color: theme.color.dangerInk,
            display: "flex",
            alignItems: "center",
            gap: 2,
          }}
          title={`File not found on disk: ${asset.uri}`}
        >
          <WarningIcon size={10} />
          missing
        </div>
      )}
    </div>
  );
}

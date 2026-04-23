import { useCallback, useState } from "react";
import type { Asset, AssetType } from "@pneuma-craft/react";
import { AssetThumbnail } from "./AssetThumbnail.js";
import { AudioWaveform } from "./AudioWaveform.js";
import { theme } from "../theme/tokens.js";
import { startAssetDrag } from "../timeline/hooks/useTrackDropTarget.js";

/** Workspace-relative uri → URL served by the dev/content server. */
function contentUrl(uri: string): string {
  if (!uri) return "";
  return `/content/${uri.split("/").map(encodeURIComponent).join("/")}`;
}

export interface AssetGroupProps {
  label: string;
  type: AssetType;
  display: "thumbnail" | "list";
  assets: Asset[];
  missingUris: Set<string>;
  onOpen: (asset: Asset) => void;
  onUpload: (files: FileList) => void;
}

export function AssetGroup({
  label,
  display,
  assets,
  missingUris,
  onOpen,
  onUpload,
}: AssetGroupProps) {
  const [dragOver, setDragOver] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      if (!e.dataTransfer.files?.length) return;
      onUpload(e.dataTransfer.files);
    },
    [onUpload],
  );

  return (
    <div
      style={{
        marginBottom: theme.space.space4,
        borderRadius: theme.radius.sm,
        border: dragOver
          ? `1px dashed ${theme.color.accent}`
          : "1px dashed transparent",
        background: dragOver ? theme.color.accentFaint : "transparent",
        padding: dragOver ? theme.space.space1 : 0,
        transition: `border-color ${theme.duration.quick}ms ${theme.easing.out}, background ${theme.duration.quick}ms ${theme.easing.out}`,
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          marginBottom: theme.space.space2,
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "baseline",
            gap: theme.space.space2,
            fontFamily: theme.font.ui,
            fontSize: theme.text.xs,
            fontWeight: theme.text.weightSemibold,
            color: theme.color.ink2,
            textTransform: "uppercase",
            letterSpacing: theme.text.trackingCaps,
          }}
        >
          {label}
          <span
            style={{
              color: theme.color.ink5,
              fontWeight: theme.text.weightRegular,
              fontFamily: theme.font.numeric,
              fontVariantNumeric: "tabular-nums",
              letterSpacing: theme.text.trackingBase,
            }}
          >
            {assets.length}
          </span>
        </span>
      </div>

      {assets.length === 0 ? (
        <div
          style={{
            fontFamily: theme.font.ui,
            fontSize: theme.text.xs,
            color: theme.color.ink5,
            padding: `${theme.space.space1}px 0`,
            fontStyle: "italic",
            letterSpacing: theme.text.trackingBase,
          }}
        >
          No {label.toLowerCase()} yet
        </div>
      ) : display === "thumbnail" ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 56px)",
            gap: theme.space.space1,
          }}
        >
          {assets.map((a) => (
            <AssetThumbnail
              key={a.id}
              asset={a}
              onOpen={onOpen}
              isMissing={missingUris.has(a.uri)}
            />
          ))}
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          {assets.map((a) => (
            <AssetListRow key={a.id} asset={a} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  );
}

function AssetListRow({
  asset,
  onOpen,
}: {
  asset: Asset;
  onOpen: (a: Asset) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const canDrag = asset.type !== "text";
  return (
    <div
      data-asset-id={asset.id}
      onClick={() => onOpen(asset)}
      title={asset.uri || asset.name}
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
        fontFamily: theme.font.ui,
        fontSize: theme.text.sm,
        color: theme.color.ink1,
        padding: `${theme.space.space1}px ${theme.space.space2}px`,
        borderRadius: theme.radius.sm,
        background: theme.color.surface2,
        border: `1px solid ${theme.color.borderWeak}`,
        display: "flex",
        alignItems: "center",
        gap: theme.space.space2,
        cursor: canDrag ? "grab" : "pointer",
        opacity: dragging ? 0.4 : 1,
        transition: `background ${theme.duration.quick}ms ${theme.easing.out}, border-color ${theme.duration.quick}ms ${theme.easing.out}, opacity ${theme.duration.quick}ms ${theme.easing.out}`,
      }}
    >
      {asset.type === "audio" && asset.uri ? (
        <AudioWaveform url={contentUrl(asset.uri)} width={60} height={20} />
      ) : null}
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          flex: 1,
          minWidth: 0,
        }}
      >
        {asset.name}
      </span>
    </div>
  );
}

import { useCallback, useRef, useState } from "react";
import type { Asset, AssetType } from "@pneuma-craft/react";
import { AssetThumbnail } from "./AssetThumbnail.js";
import { theme } from "../theme/tokens.js";
import { XIcon } from "../icons/index.js";
import { startAssetDrag } from "../timeline/hooks/useTrackDropTarget.js";

export interface AssetGroupProps {
  label: string;
  type: AssetType;
  display: "thumbnail" | "list";
  accept: string;
  assets: Asset[];
  missingUris: Set<string>;
  onOpen: (asset: Asset) => void;
  onDelete: (assetId: string) => void;
  onUpload: (files: FileList) => void;
}

export function AssetGroup({
  label,
  display,
  accept,
  assets,
  missingUris,
  onOpen,
  onDelete,
  onUpload,
}: AssetGroupProps) {
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const triggerPicker = useCallback(() => {
    if (fileInputRef.current) {
      fileInputRef.current.accept = accept;
      fileInputRef.current.click();
    }
  }, [accept]);

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files) return;
      onUpload(e.target.files);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [onUpload],
  );

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
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={handleInput}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
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
        <button
          type="button"
          onClick={triggerPicker}
          title={`Upload to ${label}`}
          aria-label={`upload to ${label}`}
          style={{
            background: "transparent",
            border: `1px solid ${theme.color.borderWeak}`,
            borderRadius: theme.radius.sm,
            color: theme.color.ink3,
            fontFamily: theme.font.ui,
            fontSize: theme.text.base,
            padding: 0,
            width: 22,
            height: 18,
            cursor: "pointer",
            lineHeight: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: `color ${theme.duration.quick}ms ${theme.easing.out}, border-color ${theme.duration.quick}ms ${theme.easing.out}`,
          }}
        >
          +
        </button>
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
          Drop files here
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
              onDelete={onDelete}
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
            <AssetListRow
              key={a.id}
              asset={a}
              onOpen={onOpen}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AssetListRow({
  asset,
  onOpen,
  onDelete,
}: {
  asset: Asset;
  onOpen: (a: Asset) => void;
  onDelete: (id: string) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const canDrag = asset.type !== "text";
  return (
    <div
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
        justifyContent: "space-between",
        cursor: canDrag ? "grab" : "pointer",
        opacity: dragging ? 0.4 : 1,
        gap: theme.space.space2,
        transition: `background ${theme.duration.quick}ms ${theme.easing.out}, border-color ${theme.duration.quick}ms ${theme.easing.out}, opacity ${theme.duration.quick}ms ${theme.easing.out}`,
      }}
    >
      <span
        style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
      >
        {asset.name}
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(asset.id);
        }}
        style={{
          background: "transparent",
          border: "none",
          color: theme.color.ink4,
          cursor: "pointer",
          padding: 0,
          width: 18,
          height: 18,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
        aria-label={`remove ${asset.name}`}
      >
        <XIcon size={11} />
      </button>
    </div>
  );
}

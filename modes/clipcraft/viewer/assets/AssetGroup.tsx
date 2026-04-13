import { useCallback, useRef, useState } from "react";
import type { Asset, AssetType } from "@pneuma-craft/react";
import { AssetThumbnail } from "./AssetThumbnail.js";

export interface AssetGroupProps {
  label: string;
  type: AssetType;
  display: "thumbnail" | "list";
  accept: string;
  assets: Asset[];
  onOpen: (asset: Asset) => void;
  onDelete: (assetId: string) => void;
  onUpload: (files: FileList) => void;
}

export function AssetGroup({
  label,
  display,
  accept,
  assets,
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
        marginBottom: 16,
        borderRadius: 4,
        border: dragOver ? "1px dashed #f97316" : "1px dashed transparent",
        background: dragOver ? "rgba(249, 115, 22, 0.05)" : "transparent",
        padding: dragOver ? 4 : 0,
        transition: "border-color 0.15s, background 0.15s",
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
          marginBottom: 6,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "#a1a1aa",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {label}
          <span style={{ marginLeft: 6, color: "#52525b", fontWeight: 400 }}>
            {assets.length}
          </span>
        </span>
        <button
          onClick={triggerPicker}
          title={`Upload to ${label}`}
          style={{
            background: "none",
            border: "1px solid #3f3f46",
            borderRadius: 3,
            color: "#71717a",
            fontSize: 11,
            padding: "1px 6px",
            cursor: "pointer",
            lineHeight: "16px",
          }}
        >
          +
        </button>
      </div>

      {assets.length === 0 ? (
        <div style={{ fontSize: 11, color: "#52525b", padding: "4px 0" }}>
          Drop files here
        </div>
      ) : display === "thumbnail" ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 48px)", gap: 4 }}>
          {assets.map((a) => (
            <AssetThumbnail key={a.id} asset={a} onOpen={onOpen} onDelete={onDelete} />
          ))}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
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
  return (
    <div
      onClick={() => onOpen(asset)}
      title={asset.uri || asset.name}
      style={{
        fontSize: 11,
        color: "#d4d4d8",
        padding: "3px 4px",
        borderRadius: 3,
        background: "#18181b",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        cursor: "pointer",
      }}
    >
      <span
        style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
      >
        {asset.name}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete(asset.id);
        }}
        style={{
          background: "none",
          border: "none",
          color: "#52525b",
          cursor: "pointer",
          fontSize: 10,
          padding: "0 2px",
          flexShrink: 0,
        }}
        aria-label={`remove ${asset.name}`}
      >
        x
      </button>
    </div>
  );
}

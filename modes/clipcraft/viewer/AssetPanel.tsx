// modes/clipcraft/viewer/AssetPanel.tsx
import { useState, useCallback, useRef } from "react";
import { useClipCraftState, useClipCraftDispatch } from "./store/ClipCraftContext.js";
import { selectSortedScenes } from "./store/selectors.js";
import { useWorkspaceUrl } from "./hooks/useWorkspaceUrl.js";
import { useAssetActions } from "./hooks/useAssets.js";

interface AssetGroup {
  label: string;
  prefix: string;
  display: "thumbnail" | "list";
  accept: string;
}

const ASSET_GROUPS: AssetGroup[] = [
  { label: "Images", prefix: "assets/images/", display: "thumbnail", accept: "image/*" },
  { label: "Clips", prefix: "assets/clips/", display: "thumbnail", accept: "video/*" },
  { label: "Reference", prefix: "assets/reference/", display: "thumbnail", accept: "image/*" },
  { label: "Audio", prefix: "assets/audio/", display: "list", accept: "audio/*" },
  { label: "BGM", prefix: "assets/bgm/", display: "list", accept: "audio/*" },
];

function isVideoFile(path: string): boolean {
  return /\.(mp4|webm|mov)$/i.test(path);
}

function isImageFile(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(path);
}

function isAudioFile(path: string): boolean {
  return /\.(mp3|wav|ogg|flac|aac|m4a|wma)$/i.test(path);
}

function AssetLightbox({
  asset,
  onClose,
  url,
}: {
  asset: { path: string; name: string };
  onClose: () => void;
  url: (path: string) => string;
}) {
  const src = url(asset.path);
  const isVideo = isVideoFile(asset.path);
  const isImage = isImageFile(asset.path);
  const isAudio = isAudioFile(asset.path);

  return (
    <div
      onClick={(e) => { e.stopPropagation(); onClose(); }}
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
      {/* Close button */}
      <button
        onClick={onClose}
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
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 10000,
        }}
      >
        &times;
      </button>

      {/* Content area — stop propagation so clicking content doesn't close */}
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
        {isImage && (
          <img
            src={src}
            alt={asset.name}
            style={{ maxWidth: "90vw", maxHeight: "75vh", objectFit: "contain", borderRadius: 4 }}
          />
        )}
        {isVideo && (
          <video
            src={src}
            controls
            autoPlay
            muted
            style={{ maxWidth: "90vw", maxHeight: "75vh", objectFit: "contain", borderRadius: 4 }}
          />
        )}
        {isAudio && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, padding: 32 }}>
            <div style={{ fontSize: 48, color: "#71717a" }}>{"\u266A"}</div>
            <div style={{ fontSize: 14, color: "#e4e4e7", fontWeight: 500 }}>{asset.name}</div>
            <audio src={src} controls autoPlay style={{ width: 320 }} />
          </div>
        )}
        {!isImage && !isVideo && !isAudio && (
          <div style={{ fontSize: 14, color: "#71717a", padding: 32 }}>Preview not available</div>
        )}
      </div>

      {/* Filename + path below preview */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          marginTop: 12,
          textAlign: "center",
          maxWidth: "90vw",
        }}
      >
        <div style={{ fontSize: 13, color: "#e4e4e7", fontWeight: 500 }}>{asset.name}</div>
        <div style={{ fontSize: 11, color: "#71717a", marginTop: 2 }}>{asset.path}</div>
      </div>
    </div>
  );
}

export function AssetPanel() {
  const state = useClipCraftState();
  const dispatch = useClipCraftDispatch();
  const url = useWorkspaceUrl();
  const { upload, remove } = useAssetActions();

  const sortedScenes = selectSortedScenes(state);
  const { selectedSceneId, activePanel, captionsEnabled, uploading } = state;

  const [dragOver, setDragOver] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadTarget, setUploadTarget] = useState<string>("");
  const [previewAsset, setPreviewAsset] = useState<{ path: string; name: string } | null>(null);

  const handleSelectScene = useCallback(
    (sceneId: string) => dispatch({ type: "SELECT_SCENE", sceneId }),
    [dispatch],
  );

  const setActiveTab = useCallback(
    (panel: "assets" | "script") => dispatch({ type: "SET_PANEL", panel }),
    [dispatch],
  );

  const handleToggleCaptions = useCallback(
    () => dispatch({ type: "TOGGLE_CAPTIONS" }),
    [dispatch],
  );

  // Build grouped files from the store's assets (keyed by subdirectory)
  // We still need the ASSET_GROUPS structure for UI rendering, so map prefix -> group key
  const getGroupFiles = useCallback(
    (prefix: string) => {
      // prefix is like "assets/images/" -> group key is "images"
      const groupKey = prefix.slice("assets/".length, -1); // strip "assets/" and trailing "/"
      return state.assets[groupKey] ?? [];
    },
    [state.assets],
  );

  // Upload handler for file input
  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFiles = e.target.files;
      if (!selectedFiles || !uploadTarget) return;
      for (const file of Array.from(selectedFiles)) {
        await upload(file, uploadTarget);
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [uploadTarget, upload],
  );

  // Drag and drop handlers
  const handleDragOver = useCallback((e: React.DragEvent, prefix: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(prefix);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(null);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent, prefix: string) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(null);
      const droppedFiles = e.dataTransfer.files;
      if (!droppedFiles.length) return;
      for (const file of Array.from(droppedFiles)) {
        await upload(file, prefix);
      }
    },
    [upload],
  );

  const handleDelete = useCallback(
    async (path: string) => {
      await remove(path);
    },
    [remove],
  );

  const triggerUpload = (prefix: string, accept: string) => {
    setUploadTarget(prefix);
    if (fileInputRef.current) {
      fileInputRef.current.accept = accept;
      fileInputRef.current.click();
    }
  };

  const renderThumbnail = (asset: { path: string; name: string }) => {
    const src = url(asset.path);

    return (
      <div
        key={asset.path}
        onClick={() => setPreviewAsset(asset)}
        style={{ position: "relative", width: 48, height: 48, borderRadius: 3, overflow: "hidden", background: "#18181b", cursor: "pointer" }}
        title={asset.name}
      >
        {isVideoFile(asset.path) ? (
          <video
            src={src}
            muted
            playsInline
            preload="metadata"
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
            onLoadedData={(e) => {
              (e.target as HTMLVideoElement).currentTime = 0.1;
            }}
          />
        ) : isImageFile(asset.path) ? (
          <img src={src} alt={asset.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
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
            {asset.name.slice(0, 8)}
          </div>
        )}
        {/* Delete button on hover */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleDelete(asset.path);
          }}
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
            opacity: 0,
            transition: "opacity 0.15s",
          }}
          className="asset-delete-btn"
        >
          x
        </button>
        <style>{`.asset-delete-btn { opacity: 0 !important; } div:hover > .asset-delete-btn { opacity: 1 !important; }`}</style>
      </div>
    );
  };

  const renderAssetsTab = () => (
    <div style={{ padding: "8px 10px", overflowY: "auto", flex: 1 }}>
      {/* Hidden file input */}
      <input ref={fileInputRef} type="file" multiple style={{ display: "none" }} onChange={handleFileSelect} />

      {uploading && (
        <div style={{ fontSize: 11, color: "#f97316", padding: "4px 0", marginBottom: 8 }}>Uploading...</div>
      )}

      {ASSET_GROUPS.map((group) => {
        const items = getGroupFiles(group.prefix);
        const isDragTarget = dragOver === group.prefix;
        return (
          <div
            key={group.prefix}
            style={{
              marginBottom: 16,
              borderRadius: 4,
              border: isDragTarget ? "1px dashed #f97316" : "1px dashed transparent",
              background: isDragTarget ? "rgba(249, 115, 22, 0.05)" : "transparent",
              padding: isDragTarget ? 4 : 0,
              transition: "border-color 0.15s, background 0.15s",
            }}
            onDragOver={(e) => handleDragOver(e, group.prefix)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, group.prefix)}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: "#a1a1aa", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {group.label}
                <span style={{ marginLeft: 6, color: "#52525b", fontWeight: 400 }}>{items.length}</span>
              </span>
              <button
                onClick={() => triggerUpload(group.prefix, group.accept)}
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
                title={`Upload to ${group.label}`}
              >
                +
              </button>
            </div>

            {items.length === 0 ? (
              <div style={{ fontSize: 11, color: "#52525b", padding: "4px 0" }}>Drop files here</div>
            ) : group.display === "thumbnail" ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 48px)", gap: 4 }}>
                {items.map((f) => renderThumbnail(f))}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {items.map((f) => (
                  <div
                    key={f.path}
                    onClick={() => setPreviewAsset(f)}
                    style={{
                      fontSize: 11,
                      color: "#d4d4d8",
                      padding: "3px 4px",
                      borderRadius: 3,
                      background: "#18181b",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      cursor: "pointer",
                    }}
                    title={f.path}
                  >
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{f.name}</span>
                    <button
                      onClick={() => handleDelete(f.path)}
                      style={{
                        background: "none",
                        border: "none",
                        color: "#52525b",
                        cursor: "pointer",
                        fontSize: 10,
                        padding: "0 2px",
                        flexShrink: 0,
                      }}
                    >
                      x
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  const renderScriptTab = () => (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      {/* Caption toggle */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 10px",
          borderBottom: "1px solid #27272a",
        }}
      >
        <span style={{ fontSize: 11, color: "#a1a1aa" }}>Captions</span>
        <button
          onClick={handleToggleCaptions}
          style={{
            background: captionsEnabled ? "#f97316" : "#27272a",
            border: "none",
            borderRadius: 10,
            width: 32,
            height: 18,
            cursor: "pointer",
            position: "relative",
            transition: "background 0.2s",
          }}
        >
          <div
            style={{
              width: 14,
              height: 14,
              borderRadius: "50%",
              background: "#fff",
              position: "absolute",
              top: 2,
              left: captionsEnabled ? 16 : 2,
              transition: "left 0.2s",
            }}
          />
        </button>
      </div>

      {/* Scene list */}
      <div style={{ overflowY: "auto", flex: 1, padding: "8px 10px" }}>
        {sortedScenes.length === 0 ? (
          <div style={{ fontSize: 11, color: "#52525b", padding: "4px 0" }}>No scenes yet</div>
        ) : (
          sortedScenes.map((scene, index) => {
            const isSelected = scene.id === selectedSceneId;
            return (
              <div
                key={scene.id}
                onClick={() => handleSelectScene(scene.id)}
                style={{
                  padding: "8px 8px",
                  marginBottom: 4,
                  borderRadius: 4,
                  border: isSelected ? "1px solid #f97316" : "1px solid transparent",
                  background: isSelected ? "rgba(249, 115, 22, 0.08)" : "transparent",
                  cursor: "pointer",
                  transition: "border-color 0.15s, background 0.15s",
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 600, color: isSelected ? "#f97316" : "#a1a1aa", marginBottom: 2 }}>
                  Scene {index + 1}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "#d4d4d8",
                    lineHeight: 1.4,
                    overflow: "hidden",
                    display: "-webkit-box",
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical",
                  }}
                >
                  {scene.caption || <span style={{ color: "#52525b" }}>No caption</span>}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  return (
    <div
      style={{
        width: 220,
        minWidth: 220,
        background: "#111113",
        borderRight: "1px solid #27272a",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* Tab bar */}
      <div style={{ display: "flex", borderBottom: "1px solid #27272a", flexShrink: 0 }}>
        {(["assets", "script"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              flex: 1,
              background: "none",
              border: "none",
              borderBottom: activePanel === tab ? "2px solid #f97316" : "2px solid transparent",
              color: activePanel === tab ? "#e4e4e7" : "#71717a",
              fontSize: 12,
              fontWeight: 500,
              padding: "8px 0",
              cursor: "pointer",
              textTransform: "capitalize",
              transition: "color 0.15s, border-color 0.15s",
            }}
          >
            {tab === "assets" ? "Assets" : "Script"}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activePanel === "assets" ? renderAssetsTab() : renderScriptTab()}

      {/* Asset lightbox */}
      {previewAsset && <AssetLightbox asset={previewAsset} onClose={() => setPreviewAsset(null)} url={url} />}
    </div>
  );
}

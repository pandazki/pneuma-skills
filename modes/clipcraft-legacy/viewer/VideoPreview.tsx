// modes/clipcraft/viewer/VideoPreview.tsx
import { useCallback } from "react";
import { useClipCraftState } from "./store/ClipCraftContext.js";
import { selectActiveScene, selectSortedScenes, selectTotalDuration } from "./store/selectors.js";
import { usePlayback } from "./hooks/usePlayback.js";
import { useAudioMixer } from "./hooks/useAudioMixer.js";
import { useWorkspaceUrl } from "./hooks/useWorkspaceUrl.js";
import { ExportPanel } from "./ExportPanel.js";
import { ASPECT_RATIOS } from "../types.js";

export function VideoPreview({ videoRefs }: { videoRefs: React.RefObject<Map<string, HTMLVideoElement>> }) {
  const state = useClipCraftState();
  const url = useWorkspaceUrl();

  const scenes = selectSortedScenes(state);
  const activeScene = selectActiveScene(state);
  const totalDuration = selectTotalDuration(state);
  const { project, captionsEnabled } = state;

  // Video element refs — keyed by scene id, lifted to ClipCraftLayout and shared with TimelineShell
  const { activeVideoRef, playing, togglePlay } = usePlayback(videoRefs);
  useAudioMixer();

  const ar = ASPECT_RATIOS[project.aspectRatio] ?? ASPECT_RATIOS["16:9"];
  const aspectRatio = ar.width / ar.height;

  // Collect video scenes for preloading
  const videoScenes = scenes.filter(
    (s) => s.visual?.status === "ready" && s.visual?.source && /\.(mp4|webm|mov)$/i.test(s.visual.source),
  );

  const setVideoRef = useCallback((sceneId: string, el: HTMLVideoElement | null) => {
    if (el) videoRefs.current.set(sceneId, el);
    else videoRefs.current.delete(sceneId);
  }, []);

  // Render non-video active scene (pending/generating/error/image)
  const renderFallback = () => {
    if (!activeScene) {
      return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#71717a" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 8 }}>&#x1F3AC;</div>
            <div>No scenes yet — describe your video idea to get started</div>
          </div>
        </div>
      );
    }

    const visual = activeScene.visual;
    if (!visual || visual.status === "pending") {
      return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#71717a" }}>
          <div style={{ textAlign: "center", padding: 24 }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>&#x1F4CB;</div>
            <div style={{ fontSize: 14 }}>{visual?.prompt ?? "Waiting for content..."}</div>
          </div>
        </div>
      );
    }

    if (visual.status === "generating") {
      return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#a1a1aa" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 36, marginBottom: 8, animation: "spin 2s linear infinite" }}>&#x23F3;</div>
            <div style={{ fontSize: 13 }}>Generating...</div>
          </div>
        </div>
      );
    }

    if (visual.status === "error") {
      return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#ef4444" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>&#x26A0;&#xFE0F;</div>
            <div style={{ fontSize: 13 }}>{visual.errorMessage ?? "Generation failed"}</div>
          </div>
        </div>
      );
    }

    // Image fallback
    const imgSrc = visual.thumbnail ?? visual.source;
    if (imgSrc && !/\.(mp4|webm|mov)$/i.test(imgSrc)) {
      return (
        <img
          src={url(imgSrc)}
          alt={`Scene ${activeScene.id}`}
          style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000" }}
        />
      );
    }

    return null;
  };

  const isActiveVideo = activeScene && videoScenes.some((s) => s.id === activeScene.id);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#09090b" }}>
      {/* Preview area */}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          position: "relative",
        }}
      >
        {/* Export button — top right overlay */}
        <div style={{ position: "absolute", top: 8, right: 12, zIndex: 20 }}>
          <ExportPanel />
        </div>
        <div
          style={{
            width: "100%",
            maxHeight: "100%",
            aspectRatio: `${aspectRatio}`,
            background: "#0a0a0a",
            borderRadius: 4,
            overflow: "hidden",
            position: "relative",
          }}
        >
          {/* Preloaded video elements — all in DOM, only active one visible */}
          {videoScenes.map((scene) => {
            const isActive = activeScene?.id === scene.id;
            return (
              <video
                key={scene.id}
                ref={(el) => setVideoRef(scene.id, el)}
                src={url(scene.visual!.source!)}
                preload="auto"
                playsInline
                muted={true}
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                  background: "#000",
                  display: isActive ? "block" : "none",
                }}
              />
            );
          })}

          {/* Fallback for non-video scenes or no scenes */}
          {!isActiveVideo && renderFallback()}

          {/* Caption overlay */}
          {captionsEnabled && activeScene?.caption && (
            <div
              style={{
                position: "absolute",
                bottom: "8%",
                left: "50%",
                transform: "translateX(-50%)",
                background: "rgba(0, 0, 0, 0.65)",
                color: "#fff",
                fontSize: "clamp(13px, 1.6vw, 18px)",
                fontWeight: 400,
                fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
                padding: "6px 16px",
                borderRadius: 4,
                maxWidth: "90%",
                textAlign: "center",
                lineHeight: 1.4,
                whiteSpace: "nowrap",
                textShadow: "0 1px 3px rgba(0,0,0,0.6)",
                pointerEvents: "none",
                zIndex: 10,
              }}
            >
              {activeScene.caption.replace(/\n/g, " ")}
            </div>
          )}
        </div>
      </div>

      {/* Controls bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "8px 16px",
          borderTop: "1px solid #27272a",
          fontSize: 12,
          color: "#a1a1aa",
        }}
      >
        <button
          onClick={togglePlay}
          style={{ background: "none", border: "none", color: "#e4e4e7", cursor: "pointer", fontSize: 18, padding: 0 }}
        >
          {playing ? "\u23F8" : "\u25B6"}
        </button>

        <span style={{ fontFamily: "monospace" }}>{totalDuration.toFixed(1)}s</span>

        <span style={{ fontSize: 11, color: "#52525b" }}>{project.aspectRatio}</span>

        <RefreshButton />
      </div>
    </div>
  );
}

/** Manual refresh button — flushes queued file changes from server. */
function RefreshButton() {
  const handleRefresh = useCallback(() => {
    fetch("/api/refresh", { method: "POST" }).catch(() => {});
  }, []);

  return (
    <button
      onClick={handleRefresh}
      title="Refresh content (manual mode)"
      style={{
        background: "none",
        border: "1px solid #3f3f46",
        borderRadius: 4,
        color: "#71717a",
        cursor: "pointer",
        padding: "2px 8px",
        fontSize: 11,
      }}
    >
      Refresh
    </button>
  );
}

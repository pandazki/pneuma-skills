import { useMemo } from "react";
import type { Scene } from "../../types.js";
import { useFrameExtractor } from "./hooks/useFrameExtractor.js";
import { useWorkspaceUrl } from "../hooks/useWorkspaceUrl.js";

const TRACK_H = 48;
const FRAME_H = TRACK_H - 8;

interface SceneClipProps {
  scene: Scene;
  x: number;
  width: number;
  selected: boolean;
  urlFn: (path: string) => string;
  pixelsPerSecond: number;
}

function SceneClip({ scene, x, width, selected, urlFn, pixelsPerSecond }: SceneClipProps) {
  const status = scene.visual?.status ?? "pending";
  const source = scene.visual?.source;
  const isVideo = source?.match(/\.(mp4|webm|mov)$/i);

  // Only extract frames from video files.
  // Use raw /content/ path (no cache-busting ?v=) so the extractor cache
  // isn't invalidated on every imageVersion bump from the file watcher.
  const frameOpts = useMemo(() => {
    if (status !== "ready" || !source || !isVideo) return null;
    const interval = pixelsPerSecond >= 60 ? 0.5 : pixelsPerSecond >= 30 ? 1 : 2;
    return {
      videoUrl: `/content/${source}`,
      duration: scene.duration,
      frameInterval: interval,
      frameHeight: FRAME_H,
    };
  }, [status, source, isVideo, pixelsPerSecond, scene.duration]);

  const { frames, loading } = useFrameExtractor(frameOpts);

  // For images, just repeat the thumbnail
  const thumbnail = scene.visual?.thumbnail || scene.visual?.source;
  const isImage = thumbnail && !isVideo && status === "ready";

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        width: width - 1,
        height: TRACK_H - 4,
        top: 2,
        background: selected ? "#1e1a14" : "#18181b",
        borderRadius: 3,
        border: selected ? "1px solid rgba(249,115,22,0.3)" : "1px solid #27272a",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        boxSizing: "border-box",
      }}
    >
      {/* Video frames filmstrip — each frame fills equal portion of clip width */}
      {frames.length > 0 && frames.map((f, i) => {
        const frameW = Math.max(1, (width - 2) / frames.length);
        return (
          <img
            key={i}
            src={f.dataUrl}
            alt=""
            style={{
              height: FRAME_H,
              width: frameW,
              objectFit: "cover",
              flexShrink: 0,
            }}
          />
        );
      })}

      {/* Image thumbnail fill */}
      {isImage && frames.length === 0 && (
        <ImageFill src={urlFn(thumbnail)} width={width - 2} height={FRAME_H} />
      )}

      {/* Loading */}
      {loading && frames.length === 0 && (
        <div style={{ padding: "0 4px", fontSize: 9, color: "#a1a1aa" }}>Loading...</div>
      )}

      {/* Generating */}
      {status === "generating" && (
        <span style={{ fontSize: 9, color: "#a16207", padding: "0 4px", whiteSpace: "nowrap" }}>
          {"\u23F3"} generating
        </span>
      )}

      {/* Error */}
      {status === "error" && (
        <span style={{ fontSize: 9, color: "#ef4444", padding: "0 4px", whiteSpace: "nowrap" }}>
          {"\u26A0"} error
        </span>
      )}

      {/* Pending */}
      {status === "pending" && (
        <span style={{ fontSize: 9, color: "#3f3f46", padding: "0 4px" }}>&mdash;</span>
      )}
    </div>
  );
}

/** Fill a region with repeated copies of an image thumbnail. */
function ImageFill({ src, width, height }: { src: string; width: number; height: number }) {
  const count = Math.max(1, Math.ceil(width / (height * 1.5)));
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <img
          key={i}
          src={src}
          alt=""
          style={{
            height,
            width: height * 1.5,
            objectFit: "cover",
            flexShrink: 0,
            opacity: i > 0 ? 0.7 : 1,
          }}
        />
      ))}
    </>
  );
}

interface Props {
  scenes: Scene[];
  totalDuration: number;
  selectedSceneId: string | null;
  pixelsPerSecond: number;
  scrollLeft: number;
}

export function VideoTrack({ scenes, totalDuration, selectedSceneId, pixelsPerSecond, scrollLeft }: Props) {
  const urlFn = useWorkspaceUrl();
  let offset = 0;

  return (
    <div style={{ position: "relative", height: TRACK_H, overflow: "hidden" }}>
      {scenes.map((scene) => {
        const x = offset * pixelsPerSecond - scrollLeft;
        const w = scene.duration * pixelsPerSecond;
        offset += scene.duration;

        if (x + w < -10 || x > 2000) return null;

        return (
          <SceneClip
            key={scene.id}
            scene={scene}
            x={x}
            width={w}
            selected={scene.id === selectedSceneId}
            urlFn={urlFn}
            pixelsPerSecond={pixelsPerSecond}
          />
        );
      })}
    </div>
  );
}

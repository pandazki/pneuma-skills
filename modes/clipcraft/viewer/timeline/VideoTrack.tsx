// Ported from modes/clipcraft-legacy/viewer/timeline/VideoTrack.tsx.
//
// Visual language (layout, colors, selection treatment, filmstrip rendering,
// status badges) is verbatim. The only swap is the data source: legacy
// iterated `scenes` (with `scene.visual?.source` + cumulative offset) against
// a reducer selector; this version walks a craft `Track.clips` array and
// resolves each clip's asset via `useAsset(clip.assetId)`.
//
// The legacy "SceneClip" subcomponent is now "VideoClip" — one component per
// craft clip, with its own useFrameExtractor hook so the rules-of-hooks are
// preserved when clips come and go. Image assets fall back to tiled ImageFill;
// video assets render the decoded filmstrip.

import { useMemo } from "react";
import type { Track, Clip } from "@pneuma-craft/timeline";
import { useAsset } from "@pneuma-craft/react";
import { useFrameExtractor } from "./hooks/useFrameExtractor.js";

const TRACK_H = 48;
const FRAME_H = TRACK_H - 8;

function contentUrl(uri: string): string {
  if (!uri) return "";
  return `/content/${uri.split("/").map(encodeURIComponent).join("/")}`;
}

interface VideoClipProps {
  clip: Clip;
  x: number;
  width: number;
  selected: boolean;
  pixelsPerSecond: number;
  onSelect: (clipId: string) => void;
}

function VideoClip({ clip, x, width, selected, pixelsPerSecond, onSelect }: VideoClipProps) {
  const asset = useAsset(clip.assetId);
  const status = asset?.status ?? "ready";
  const uri = asset?.uri ?? "";
  const isVideo = asset?.type === "video";
  const isImage = asset?.type === "image";

  // Only extract frames from video assets. Raw /content/ path (no cache-busting)
  // so the extractor cache isn't invalidated on file-watcher echoes.
  const frameOpts = useMemo(() => {
    if (status !== "ready" || !uri || !isVideo) return null;
    const interval = pixelsPerSecond >= 60 ? 0.5 : pixelsPerSecond >= 30 ? 1 : 2;
    return {
      videoUrl: contentUrl(uri),
      duration: clip.duration,
      frameInterval: interval,
      frameHeight: FRAME_H,
    };
  }, [status, uri, isVideo, pixelsPerSecond, clip.duration]);

  const { frames, loading } = useFrameExtractor(frameOpts);

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onSelect(clip.id);
      }}
      style={{
        position: "absolute",
        left: Math.round(x),
        width: Math.round(width - 1),
        height: TRACK_H - 4,
        top: 2,
        background: selected ? "#1e1a14" : "#18181b",
        borderRadius: 3,
        border: selected ? "1px solid rgba(249,115,22,0.3)" : "1px solid #27272a",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        boxSizing: "border-box",
        cursor: "pointer",
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
              pointerEvents: "none",
            }}
          />
        );
      })}

      {/* Image thumbnail fill */}
      {isImage && status === "ready" && uri && frames.length === 0 && (
        <ImageFill src={contentUrl(uri)} width={width - 2} height={FRAME_H} />
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

      {/* Failed */}
      {status === "failed" && (
        <span style={{ fontSize: 9, color: "#ef4444", padding: "0 4px", whiteSpace: "nowrap" }}>
          {"\u26A0"} error
        </span>
      )}

      {/* Pending (craft default for unresolved assets) */}
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
            pointerEvents: "none",
          }}
        />
      ))}
    </>
  );
}

interface Props {
  track: Track;
  selectedClipId: string | null;
  pixelsPerSecond: number;
  scrollLeft: number;
  onSelect: (clipId: string) => void;
}

export function VideoTrack({ track, selectedClipId, pixelsPerSecond, scrollLeft, onSelect }: Props) {
  return (
    <div style={{ position: "relative", height: TRACK_H, overflow: "hidden" }}>
      {track.clips.map((clip) => {
        const x = clip.startTime * pixelsPerSecond - scrollLeft;
        const w = clip.duration * pixelsPerSecond;
        // off-screen cull matches legacy's heuristic
        if (x + w < -10 || x > 4000) return null;
        return (
          <VideoClip
            key={clip.id}
            clip={clip}
            x={x}
            width={w}
            selected={clip.id === selectedClipId}
            pixelsPerSecond={pixelsPerSecond}
            onSelect={onSelect}
          />
        );
      })}
    </div>
  );
}

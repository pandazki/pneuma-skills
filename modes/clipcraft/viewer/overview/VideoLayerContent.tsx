import { useMemo } from "react";
import type { Clip, Track } from "@pneuma-craft/timeline";
import { useFrameExtractor } from "../timeline/hooks/useFrameExtractor.js";
import { useWorkspaceAssetUrl } from "../assets/useWorkspaceAssetUrl.js";

interface Props {
  tracks: Track[];
  totalDuration: number;
  height: number;
  pixelsPerSecond: number;
  scrollLeft: number;
  selectedClipId: string | null;
}

export function VideoLayerContent({
  tracks, height, pixelsPerSecond, scrollLeft, selectedClipId,
}: Props) {
  const frameH = height - 8;

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", padding: "0 4px" }}>
      {tracks.flatMap((track) =>
        track.clips.map((clip) => {
          const x = clip.startTime * pixelsPerSecond - scrollLeft;
          const w = clip.duration * pixelsPerSecond;
          if (x + w < -10 || x > 3000) return null;
          return (
            <VideoClip3D
              key={clip.id}
              clip={clip}
              x={x}
              w={w}
              frameH={frameH}
              pixelsPerSecond={pixelsPerSecond}
              selected={clip.id === selectedClipId}
            />
          );
        }),
      )}
    </div>
  );
}

function VideoClip3D({
  clip, x, w, frameH, pixelsPerSecond, selected,
}: {
  clip: Clip; x: number; w: number; frameH: number;
  pixelsPerSecond: number; selected: boolean;
}) {
  const videoUrl = useWorkspaceAssetUrl(clip.assetId);
  const frameInterval =
    pixelsPerSecond >= 150 ? 0.25 :
    pixelsPerSecond >= 60 ? 0.5 :
    pixelsPerSecond >= 30 ? 1 : 2;

  const frameOpts = useMemo(() => {
    if (!videoUrl) return null;
    return {
      videoUrl,
      duration: clip.duration,
      frameInterval,
      frameHeight: frameH,
    };
  }, [videoUrl, clip.duration, frameInterval, frameH]);

  const { frames } = useFrameExtractor(frameOpts);

  return (
    <div style={{
      position: "absolute", left: x, width: w - 2, height: frameH,
      borderRadius: 4, overflow: "hidden",
      border: selected ? "1px solid rgba(249,115,22,0.4)" : "1px solid rgba(255,255,255,0.06)",
      background: "#0a0a0a",
    }}>
      {frames.length > 0 ? (
        <div style={{ display: "flex", height: "100%", alignItems: "center", overflow: "hidden" }}>
          {(() => {
            const aspect = frames[0].width / frames[0].height;
            const naturalW = frameH * aspect;
            const clipW = w - 2;
            const visibleCount = Math.max(1, Math.ceil(clipW / naturalW));
            const step = Math.max(1, frames.length / visibleCount);
            const picked: typeof frames = [];
            for (let i = 0; i < visibleCount && i * step < frames.length; i++) {
              picked.push(frames[Math.min(Math.floor(i * step), frames.length - 1)]);
            }
            const tileW = clipW / picked.length;
            return picked.map((f, i) => (
              <img key={i} src={f.dataUrl} alt="" style={{
                height: frameH, width: tileW, objectFit: "cover", flexShrink: 0,
              }} />
            ));
          })()}
        </div>
      ) : (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          height: "100%", color: "#27272a", fontSize: 12,
        }}>—</div>
      )}
    </div>
  );
}

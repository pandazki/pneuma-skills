import { useMemo } from "react";
import type { Clip, Track } from "@pneuma-craft/timeline";
import { useFrameExtractor } from "../timeline/hooks/useFrameExtractor.js";
import { useWorkspaceAssetUrl } from "../assets/useWorkspaceAssetUrl.js";
import { theme } from "../theme/tokens.js";

interface Props {
  tracks: Track[];
  totalDuration: number;
  height: number;
  pixelsPerSecond: number;
  scrollLeft: number;
  selectedClipId: string | null;
}

export function VideoLayerContent({
  tracks,
  height,
  pixelsPerSecond,
  scrollLeft,
  selectedClipId,
}: Props) {
  const frameH = height - 8;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        padding: `0 ${theme.space.space1}px`,
      }}
    >
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
  clip,
  x,
  w,
  frameH,
  pixelsPerSecond,
  selected,
}: {
  clip: Clip;
  x: number;
  w: number;
  frameH: number;
  pixelsPerSecond: number;
  selected: boolean;
}) {
  const videoUrl = useWorkspaceAssetUrl(clip.assetId);
  const frameInterval =
    pixelsPerSecond >= 150
      ? 0.25
      : pixelsPerSecond >= 60
        ? 0.5
        : pixelsPerSecond >= 30
          ? 1
          : 2;

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
    <div
      style={{
        position: "absolute",
        left: x,
        width: w - 2,
        height: frameH,
        borderRadius: theme.radius.sm,
        overflow: "hidden",
        border: selected
          ? `1px solid ${theme.color.accentBorder}`
          : `1px solid ${theme.color.borderWeak}`,
        background: "oklch(8% 0.005 55)",
      }}
    >
      {frames.length > 0 ? (
        <div
          style={{
            display: "flex",
            height: "100%",
            alignItems: "center",
            overflow: "hidden",
          }}
        >
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
              <img
                key={i}
                src={f.dataUrl}
                alt=""
                style={{
                  height: frameH,
                  width: tileW,
                  objectFit: "cover",
                  flexShrink: 0,
                }}
              />
            ));
          })()}
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            color: theme.color.ink5,
            fontFamily: theme.font.ui,
            fontSize: theme.text.sm,
          }}
        >
          —
        </div>
      )}
    </div>
  );
}

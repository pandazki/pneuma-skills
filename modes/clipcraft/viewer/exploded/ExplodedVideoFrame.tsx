import { useEffect, useMemo, useRef } from "react";
import type { Clip, Track } from "@pneuma-craft/timeline";
import { useComposition, useAsset } from "@pneuma-craft/react";
import { useWorkspaceAssetUrl } from "../assets/useWorkspaceAssetUrl.js";
import { theme } from "../theme/tokens.js";

interface Props {
  track: Track;
  currentTime: number;
  width: number;
  height: number;
}

/**
 * Exploded mode renders each video card as a single still frame at the
 * playhead — "what's on THIS layer RIGHT NOW". Overview 3D (front/side)
 * keeps the filmstrip representation; only the exploded view opts into
 * the "slice at a moment in time" semantics.
 */
export function ExplodedVideoFrame({ track, currentTime, width, height }: Props) {
  const composition = useComposition();
  const arRatio = composition?.settings
    ? composition.settings.width / composition.settings.height
    : 16 / 9;

  const activeClip = useMemo<Clip | null>(() => {
    const hit = track.clips.find(
      (c) =>
        currentTime >= c.startTime &&
        currentTime < c.startTime + c.duration,
    );
    return hit ?? null;
  }, [track.clips, currentTime]);

  // Letterbox: inner box matches the composition aspect, scaled to fit
  // (width × height). We cover rather than letterbox inside the inner
  // box so a portrait clip still fills a landscape card — matches the
  // exported preview's behaviour.
  const box = useMemo(() => fitAspect(width, height, arRatio), [width, height, arRatio]);

  if (!activeClip) {
    return <EmptyPlaceholder />;
  }
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "oklch(6% 0.003 55)",
      }}
    >
      <div
        style={{
          width: box.w,
          height: box.h,
          borderRadius: theme.radius.sm,
          overflow: "hidden",
          border: `1px solid ${theme.color.borderWeak}`,
        }}
      >
        <ClipMedia clip={activeClip} currentTime={currentTime} />
      </div>
    </div>
  );
}

function ClipMedia({ clip, currentTime }: { clip: Clip; currentTime: number }) {
  const asset = useAsset(clip.assetId);
  const url = useWorkspaceAssetUrl(clip.assetId);

  if (!url) return <EmptyPlaceholder />;

  if (asset?.type === "image") {
    return (
      <img
        src={url}
        alt=""
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          display: "block",
        }}
      />
    );
  }

  return <VideoFrame url={url} clip={clip} currentTime={currentTime} />;
}

function VideoFrame({
  url,
  clip,
  currentTime,
}: {
  url: string;
  clip: Clip;
  currentTime: number;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const targetSec = clip.inPoint + Math.max(0, currentTime - clip.startTime);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Seek whenever the target time shifts. We never call .play() here —
    // exploded mode wants a static frame aligned to the composition's
    // playhead, driven externally by usePlayback.
    if (Math.abs(el.currentTime - targetSec) > 0.03) {
      try {
        el.currentTime = targetSec;
      } catch {
        // Some browsers throw if called before metadata is ready; the
        // loadedmetadata handler below re-applies the target once ready.
      }
    }
  }, [targetSec, url]);

  return (
    <video
      ref={ref}
      src={url}
      muted
      playsInline
      preload="auto"
      onLoadedMetadata={(e) => {
        const el = e.currentTarget;
        try {
          el.currentTime = targetSec;
        } catch {
          // ignore — the effect will retry on next tick
        }
      }}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "cover",
        display: "block",
        background: "oklch(6% 0.003 55)",
      }}
    />
  );
}

function EmptyPlaceholder() {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: theme.color.ink5,
        fontFamily: theme.font.ui,
        fontSize: theme.text.sm,
      }}
    >
      —
    </div>
  );
}

function fitAspect(
  maxW: number,
  maxH: number,
  ratio: number,
): { w: number; h: number } {
  if (maxW <= 0 || maxH <= 0) return { w: 0, h: 0 };
  const byH = { w: maxH * ratio, h: maxH };
  if (byH.w <= maxW) return byH;
  return { w: maxW, h: maxW / ratio };
}

// modes/clipcraft/viewer/timeline/TrackRow.tsx
//
// Plan 5 Task 4 — TrackRow walks a track's clips, resolves each clip's
// asset via useAsset(), and branches by track.type to render filmstrip
// thumbnails (video), waveform bars (audio), or text (subtitle). Also
// consumes useSelection() to highlight selected clips. Asset status
// (pending/generating/failed) takes over the inner content with a
// placeholder.
//
// Adaptations from the plan prose (see task 4 notes):
// - useFrameExtractor / useWaveform in this repo use an options-object
//   signature returning FrameData[] / WaveformData, not the plan's
//   (url, interval, duration) / (url, bars, duration) positional form.
//   Call sites translate accordingly.
// - useAsset returns Asset | undefined. Asset.status is optional
//   ('pending' | 'generating' | 'ready' | 'failed'); absence means ready.
import type { CSSProperties } from "react";
import { useAsset, useSelection } from "@pneuma-craft/react";
import type { Track, Clip } from "@pneuma-craft/timeline";
import { ClipStrip } from "./ClipStrip.js";
import { TrackLabel } from "./TrackLabel.js";
import { useFrameExtractor } from "./hooks/useFrameExtractor.js";
import { useWaveform } from "./hooks/useWaveform.js";

export interface TrackRowProps {
  track: Track;
  pixelsPerSecond: number;
  scrollLeft: number;
  trackHeight: number;
  totalWidth: number;
  onSelectClip: (clipId: string) => void;
}

const WORKSPACE_CONTENT_BASE = "/content";

function contentUrlFor(uri: string): string {
  if (!uri) return "";
  return `${WORKSPACE_CONTENT_BASE}/${uri.split("/").map(encodeURIComponent).join("/")}`;
}

export function TrackRow({
  track,
  pixelsPerSecond,
  scrollLeft,
  trackHeight,
  totalWidth,
  onSelectClip,
}: TrackRowProps) {
  const selection = useSelection();
  const selectedClipIds = new Set(
    selection.type === "clip" ? selection.ids : [],
  );

  const rowStyle: CSSProperties = {
    display: "flex",
    height: trackHeight,
    borderBottom: "1px solid #27272a",
  };

  const trackAreaStyle: CSSProperties = {
    position: "relative",
    flex: 1,
    height: "100%",
    overflow: "hidden",
  };

  return (
    <div className="cc-track-row" style={rowStyle}>
      <TrackLabel track={track} />
      <div className="cc-track-area" style={trackAreaStyle}>
        {/* Fixed-width inner sizer so scrollLeft is meaningful relative
            to the full composition duration, not the viewport. */}
        <div style={{ position: "absolute", left: 0, top: 0, width: totalWidth, height: "100%" }}>
          {track.clips.map((clip) => (
            <ClipStrip
              key={clip.id}
              clip={clip}
              pixelsPerSecond={pixelsPerSecond}
              scrollLeft={scrollLeft}
              trackHeight={trackHeight}
              selected={selectedClipIds.has(clip.id)}
              onSelect={onSelectClip}
            >
              {track.type === "subtitle" ? (
                <SubtitleInner clip={clip} />
              ) : (
                <ClipInner track={track} clip={clip} trackHeight={trackHeight} />
              )}
            </ClipStrip>
          ))}
        </div>
      </div>
    </div>
  );
}

function ClipInner({
  track,
  clip,
  trackHeight,
}: {
  track: Track;
  clip: Clip;
  trackHeight: number;
}) {
  const asset = useAsset(clip.assetId);
  if (!asset) {
    return <PlaceholderInner reason="missing asset" />;
  }
  // Asset.status is optional; absence is equivalent to 'ready'.
  if (asset.status === "pending" || asset.status === "generating") {
    return <PlaceholderInner reason={asset.status} />;
  }
  if (asset.status === "failed") {
    return <PlaceholderInner reason="failed" />;
  }

  if (track.type === "video") {
    return <VideoInner uri={asset.uri} clip={clip} trackHeight={trackHeight} />;
  }
  if (track.type === "audio") {
    return <AudioInner uri={asset.uri} clip={clip} />;
  }
  return <PlaceholderInner reason={`unknown track type: ${track.type}`} />;
}

function VideoInner({
  uri,
  clip,
  trackHeight,
}: {
  uri: string;
  clip: Clip;
  trackHeight: number;
}) {
  // Real hook signature: useFrameExtractor({ videoUrl, duration, frameInterval, frameHeight })
  // returns { frames: FrameData[]; loading; error }.
  const { frames } = useFrameExtractor({
    videoUrl: contentUrlFor(uri),
    duration: clip.duration,
    frameInterval: frameIntervalFor(clip.duration),
    frameHeight: Math.max(32, trackHeight),
  });
  return (
    <div
      className="cc-video-inner"
      style={{
        display: "flex",
        height: "100%",
        width: "100%",
        overflow: "hidden",
        background: "#0a0a0a",
      }}
    >
      {frames.length === 0 ? (
        <div style={{ ...placeholderTextStyle, width: "100%" }}>decoding…</div>
      ) : (
        frames.map((f, i) => (
          <img
            key={i}
            src={f.dataUrl}
            alt=""
            style={{
              height: "100%",
              width: `${100 / frames.length}%`,
              objectFit: "cover",
              pointerEvents: "none",
            }}
          />
        ))
      )}
    </div>
  );
}

function frameIntervalFor(clipDurationSec: number): number {
  if (clipDurationSec <= 4) return 0.5;
  if (clipDurationSec <= 15) return 1;
  return 2;
}

function AudioInner({ uri, clip }: { uri: string; clip: Clip }) {
  const bars = 64; // fine-grained enough for a 96px-wide clip
  // Real hook signature: useWaveform({ audioUrl, bars, maxDuration })
  // returns { waveform: { peaks, duration } | null; loading }.
  const { waveform } = useWaveform({
    audioUrl: contentUrlFor(uri),
    bars,
    maxDuration: clip.duration,
  });
  const peaks = waveform?.peaks ?? [];
  return (
    <div
      className="cc-audio-inner"
      style={{
        display: "flex",
        alignItems: "center",
        height: "100%",
        padding: "4px 2px",
        gap: 1,
      }}
    >
      {peaks.length === 0 ? (
        <div style={{ ...placeholderTextStyle, width: "100%" }}>decoding…</div>
      ) : (
        peaks.map((p, i) => (
          <div
            key={i}
            style={{
              width: `${100 / bars}%`,
              height: `${Math.max(4, p * 100)}%`,
              background: "#f97316",
              borderRadius: 1,
            }}
          />
        ))
      )}
    </div>
  );
}

function SubtitleInner({ clip }: { clip: Clip }) {
  return (
    <div
      className="cc-subtitle-inner"
      style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        padding: "0 6px",
        color: "#e4e4e7",
        fontSize: 11,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {clip.text || <em style={{ opacity: 0.5 }}>subtitle</em>}
    </div>
  );
}

function PlaceholderInner({ reason }: { reason: string }) {
  return <div style={{ ...placeholderTextStyle, width: "100%" }}>{reason}</div>;
}

const placeholderTextStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  height: "100%",
  color: "#71717a",
  fontSize: 10,
  fontFamily: "system-ui, sans-serif",
  textTransform: "uppercase",
  letterSpacing: 0.5,
};

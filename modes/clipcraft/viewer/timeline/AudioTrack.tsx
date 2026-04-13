// Ported from modes/clipcraft-legacy/viewer/timeline/AudioTrack.tsx.
// Visual language verbatim; data source swapped from `scenes` + reducer to
// craft `Track.clips` + `useAsset(clip.assetId)`.

import { useMemo } from "react";
import type { Track, Clip } from "@pneuma-craft/timeline";
import { useAsset } from "@pneuma-craft/react";
import { WaveformBars } from "./WaveformBars.js";
import { useWaveform } from "./hooks/useWaveform.js";

const TRACK_H = 32;
const BAR_H = TRACK_H - 12;

function contentUrl(uri: string): string {
  if (!uri) return "";
  return `/content/${uri.split("/").map(encodeURIComponent).join("/")}`;
}

interface AudioClipProps {
  clip: Clip;
  x: number;
  width: number;
  selected: boolean;
  onSelect: (clipId: string) => void;
}

function AudioClip({ clip, x, width, selected, onSelect }: AudioClipProps) {
  const asset = useAsset(clip.assetId);
  const status = asset?.status ?? "ready";
  const uri = asset?.uri ?? "";
  const hasAudio = status === "ready" && !!uri && asset?.type === "audio";

  const waveOpts = useMemo(() => {
    if (!hasAudio) return null;
    return {
      audioUrl: contentUrl(uri),
      bars: Math.max(8, Math.round(width / 4)),
      maxDuration: clip.duration,
    };
  }, [hasAudio, uri, width, clip.duration]);

  const { waveform } = useWaveform(waveOpts);

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
        background: selected ? "#1a1e2a" : "#18181b",
        borderRadius: 3,
        border: selected ? "1px solid rgba(249,115,22,0.3)" : "1px solid #27272a",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxSizing: "border-box",
        cursor: "pointer",
      }}
    >
      {waveform ? (
        <WaveformBars peaks={waveform.peaks} height={BAR_H} color={selected ? "#38bdf8" : "#1e3a5f"} />
      ) : hasAudio ? (
        <div style={{ fontSize: 9, color: "#38bdf8", opacity: 0.5 }}>loading...</div>
      ) : null}
    </div>
  );
}

interface Props {
  track: Track;
  selectedClipId: string | null;
  pixelsPerSecond: number;
  scrollLeft: number;
  onSelect: (clipId: string) => void;
}

export function AudioTrack({ track, selectedClipId, pixelsPerSecond, scrollLeft, onSelect }: Props) {
  return (
    <div style={{ position: "relative", height: TRACK_H, overflow: "hidden" }}>
      {track.clips.map((clip) => {
        const x = clip.startTime * pixelsPerSecond - scrollLeft;
        const w = clip.duration * pixelsPerSecond;
        if (x + w < -10 || x > 4000) return null;
        return (
          <AudioClip
            key={clip.id}
            clip={clip}
            x={x}
            width={w}
            selected={clip.id === selectedClipId}
            onSelect={onSelect}
          />
        );
      })}
    </div>
  );
}

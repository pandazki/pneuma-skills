import type { Track } from "@pneuma-craft/timeline";
import { FakeWaveform } from "./FakeWaveform.js";

interface Props {
  tracks: Track[];
  totalDuration: number;
  height: number;
  pixelsPerSecond: number;
  scrollLeft: number;
  selectedClipId: string | null;
}

export function AudioLayerContent({
  tracks, height, pixelsPerSecond, scrollLeft, selectedClipId,
}: Props) {
  const barH = height - 12;

  return (
    <div style={{ position: "absolute", inset: 0, padding: "4px" }}>
      {tracks.flatMap((track) =>
        track.clips.map((clip) => {
          const x = clip.startTime * pixelsPerSecond - scrollLeft;
          const w = clip.duration * pixelsPerSecond;
          if (x + w < -10 || x > 3000) return null;
          const sel = clip.id === selectedClipId;
          return (
            <div key={clip.id} style={{
              position: "absolute", left: x, width: w - 2, top: 4, bottom: 4,
              borderRadius: 4, overflow: "hidden",
              background: sel ? "#1a1e2a" : "#111318",
              border: sel ? "1px solid rgba(249,115,22,0.3)" : "1px solid #1e2030",
              display: "flex", alignItems: "center", justifyContent: "center",
              gap: 1, padding: "0 4px",
            }}>
              <FakeWaveform
                seed={clip.id}
                bars={Math.max(10, Math.floor(w / 5))}
                height={barH}
                color={sel ? "#38bdf8" : "#1e3a5f"}
              />
            </div>
          );
        }),
      )}
    </div>
  );
}

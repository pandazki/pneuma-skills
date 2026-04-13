import type { Track } from "@pneuma-craft/timeline";

interface Props {
  tracks: Track[];
  totalDuration: number;
  height: number;
  pixelsPerSecond: number;
  scrollLeft: number;
  selectedClipId: string | null;
}

export function CaptionLayerContent({
  tracks, height, pixelsPerSecond, scrollLeft, selectedClipId,
}: Props) {
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
              background: sel ? "#2d2519" : "#1a1a1e",
              border: sel ? "1px solid rgba(249,115,22,0.3)" : "1px solid #27272a",
              padding: "6px 10px",
              display: "flex", alignItems: "center",
            }}>
              <span style={{
                fontSize: Math.min(13, height * 0.3),
                color: clip.text ? (sel ? "#e4e4e7" : "#a1a1aa") : "#3f3f46",
                lineHeight: "1.4",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}>
                {clip.text ?? "No caption"}
              </span>
            </div>
          );
        }),
      )}
    </div>
  );
}

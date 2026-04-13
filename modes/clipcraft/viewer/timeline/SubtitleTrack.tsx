// Ported from modes/clipcraft-legacy/viewer/timeline/CaptionTrack.tsx.
// Visual language verbatim; data source swapped from `scenes[].caption` to
// craft `Track.clips[].text`. No asset gate — subtitles are text-only and
// don't require an Asset.

import type { Track } from "@pneuma-craft/timeline";

const TRACK_H = 32;

interface Props {
  track: Track;
  selectedClipId: string | null;
  pixelsPerSecond: number;
  scrollLeft: number;
  onSelect: (clipId: string) => void;
}

export function SubtitleTrack({
  track,
  selectedClipId,
  pixelsPerSecond,
  scrollLeft,
  onSelect,
}: Props) {
  return (
    <div style={{ position: "relative", height: TRACK_H, overflow: "hidden" }}>
      {track.clips.map((clip) => {
        const x = clip.startTime * pixelsPerSecond - scrollLeft;
        const w = clip.duration * pixelsPerSecond;
        const sel = clip.id === selectedClipId;
        if (x + w < -10 || x > 4000) return null;
        return (
          <div
            key={clip.id}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(clip.id);
            }}
            style={{
              position: "absolute",
              left: Math.round(x),
              width: Math.round(w - 1),
              height: TRACK_H - 4,
              top: 2,
              background: sel ? "#2d2519" : "#1a1a1e",
              borderRadius: 3,
              border: sel ? "1px solid rgba(249,115,22,0.3)" : "1px solid #27272a",
              overflow: "hidden",
              padding: "2px 6px",
              fontSize: 9,
              lineHeight: `${TRACK_H - 8}px`,
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
              color: clip.text ? (sel ? "#e4e4e7" : "#a1a1aa") : "#3f3f46",
              boxSizing: "border-box",
              cursor: "pointer",
            }}
          >
            {clip.text ?? ""}
          </div>
        );
      })}
    </div>
  );
}

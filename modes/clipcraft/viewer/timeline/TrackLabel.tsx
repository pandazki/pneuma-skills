// modes/clipcraft/viewer/timeline/TrackLabel.tsx
import type { Track } from "@pneuma-craft/timeline";

export const TRACK_LABEL_WIDTH = 96;

export interface TrackLabelProps {
  track: Track;
}

export function TrackLabel({ track }: TrackLabelProps) {
  const icon = iconFor(track.type);
  return (
    <div
      className="cc-track-label"
      style={{
        width: TRACK_LABEL_WIDTH,
        height: "100%",
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "0 8px",
        fontSize: 11,
        color: "#d4d4d8",
        background: "#18181b",
        borderRight: "1px solid #27272a",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <span aria-hidden style={{ opacity: 0.6 }}>{icon}</span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {track.name || track.type}
      </span>
    </div>
  );
}

function iconFor(type: Track["type"]): string {
  switch (type) {
    case "video": return "V";
    case "audio": return "A";
    case "subtitle": return "T";
    default: return "?";
  }
}

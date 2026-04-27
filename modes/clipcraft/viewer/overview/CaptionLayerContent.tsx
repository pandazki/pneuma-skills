import type { Track } from "@pneuma-craft/timeline";
import { theme } from "../theme/tokens.js";

interface Props {
  track: Track;
  height: number;
  pixelsPerSecond: number;
  scrollLeft: number;
  selectedClipId: string | null;
}

export function CaptionLayerContent({
  track,
  height,
  pixelsPerSecond,
  scrollLeft,
  selectedClipId,
}: Props) {
  return (
    <div style={{ position: "absolute", inset: 0, padding: 4 }}>
      {track.clips.map((clip) => {
        const x = clip.startTime * pixelsPerSecond - scrollLeft;
        const w = clip.duration * pixelsPerSecond;
        if (x + w < -10 || x > 3000) return null;
        const sel = clip.id === selectedClipId;
        return (
          <div
            key={clip.id}
            style={{
              position: "absolute",
              left: x,
              width: w - 2,
              top: 4,
              bottom: 4,
              borderRadius: theme.radius.sm,
              overflow: "hidden",
              background: sel ? theme.color.surface3 : theme.color.surface1,
              border: sel
                ? `1px solid ${theme.color.accentBorder}`
                : `1px solid ${theme.color.borderWeak}`,
              padding: `${theme.space.space1}px ${theme.space.space3}px`,
              display: "flex",
              alignItems: "center",
            }}
          >
            <span
              style={{
                fontFamily: theme.font.display,
                fontSize: Math.min(14, height * 0.32),
                color: clip.text
                  ? sel
                    ? theme.color.ink0
                    : theme.color.ink1
                  : theme.color.ink5,
                lineHeight: theme.text.lineHeightSnug,
                letterSpacing: theme.text.trackingTight,
                fontWeight: theme.text.weightMedium,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontStyle: clip.text ? "normal" : "italic",
              }}
            >
              {clip.text ?? "No caption"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

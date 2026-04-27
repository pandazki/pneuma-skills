import type { Track } from "@pneuma-craft/timeline";
import { FakeWaveform } from "./FakeWaveform.js";
import { theme } from "../theme/tokens.js";

interface Props {
  track: Track;
  height: number;
  pixelsPerSecond: number;
  scrollLeft: number;
  selectedClipId: string | null;
}

export function AudioLayerContent({
  track,
  height,
  pixelsPerSecond,
  scrollLeft,
  selectedClipId,
}: Props) {
  const barH = height - 12;

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
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 1,
              padding: `0 ${theme.space.space1}px`,
            }}
          >
            <FakeWaveform
              seed={clip.id}
              bars={Math.max(10, Math.floor(w / 5))}
              height={barH}
              color={sel ? theme.color.accentBright : theme.color.layerAudio}
            />
          </div>
        );
      })}
    </div>
  );
}

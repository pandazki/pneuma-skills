// modes/clipcraft/viewer/PlaybackControls.tsx
import { usePlayback } from "@pneuma-craft/react";

const formatTime = (t: number): string => {
  if (!Number.isFinite(t)) return "0";
  return t.toFixed(1);
};

export function PlaybackControls() {
  const { state, currentTime, duration, play, pause, seek } = usePlayback();
  const isPlaying = state === "playing";
  const canSeek = duration > 0;

  return (
    <div
      className="cc-playback-controls"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 12px",
        background: "#18181b",
        color: "#e4e4e7",
        fontFamily: "system-ui, sans-serif",
        fontSize: 13,
      }}
    >
      <button
        type="button"
        onClick={isPlaying ? pause : play}
        aria-label={isPlaying ? "pause" : "play"}
        disabled={!canSeek}
        style={{
          padding: "4px 10px",
          background: "#27272a",
          color: "#fafafa",
          border: "1px solid #3f3f46",
          borderRadius: 4,
          cursor: canSeek ? "pointer" : "not-allowed",
        }}
      >
        {isPlaying ? "Pause" : "Play"}
      </button>
      <input
        type="range"
        role="slider"
        min={0}
        max={canSeek ? duration : 1}
        step={0.01}
        value={currentTime}
        disabled={!canSeek}
        onChange={(e) => seek(Number(e.target.value))}
        style={{ flex: 1 }}
      />
      <span
        className="cc-time-readout"
        style={{ fontVariantNumeric: "tabular-nums", minWidth: 80, textAlign: "right" }}
      >
        {formatTime(currentTime)} / {formatTime(duration)}
      </span>
    </div>
  );
}

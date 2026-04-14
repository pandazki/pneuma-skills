import { useCallback } from "react";
import { useComposition, usePlayback } from "@pneuma-craft/react";

/**
 * Global transport: play/pause, goto start/end, time/duration,
 * playback rate. Always visible at the top of the Timeline.
 *
 * All state lives in the craft store — this component is a thin
 * view + dispatcher. No local state.
 */
export function TransportBar() {
  const composition = useComposition();
  const playback = usePlayback();

  const isPlaying = playback.state === "playing";

  const togglePlay = useCallback(() => {
    if (isPlaying) playback.pause();
    else playback.play();
  }, [isPlaying, playback]);

  const gotoStart = useCallback(() => {
    playback.seek(0);
  }, [playback]);

  const gotoEnd = useCallback(() => {
    playback.seek(Math.max(0, playback.duration ?? 0));
  }, [playback]);

  const onSpeedChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const v = parseFloat(e.target.value);
      if (!Number.isNaN(v)) playback.setPlaybackRate(v);
    },
    [playback],
  );

  const disabled = !composition;
  const totalSec = playback.duration ?? 0;
  const curSec = playback.currentTime ?? 0;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "6px 12px",
        borderBottom: "1px solid #27272a",
        fontSize: 11,
        color: "#a1a1aa",
        background: "#0a0a0b",
      }}
    >
      <button
        type="button"
        onClick={gotoStart}
        disabled={disabled}
        style={iconBtn(disabled)}
        title="Go to start (Home)"
        aria-label="go to start"
      >
        {"\u23EE"}
      </button>
      <button
        type="button"
        onClick={togglePlay}
        disabled={disabled}
        style={iconBtn(disabled)}
        title={isPlaying ? "Pause (Space)" : "Play (Space)"}
        aria-label={isPlaying ? "pause" : "play"}
      >
        {isPlaying ? "\u23F8" : "\u25B6"}
      </button>
      <button
        type="button"
        onClick={gotoEnd}
        disabled={disabled}
        style={iconBtn(disabled)}
        title="Go to end (End)"
        aria-label="go to end"
      >
        {"\u23ED"}
      </button>
      <span
        style={{
          fontFamily: "ui-monospace, SFMono-Regular, monospace",
          fontSize: 11,
          color: "#e4e4e7",
          marginLeft: 4,
        }}
      >
        {formatTime(curSec)} <span style={{ color: "#52525b" }}>/</span>{" "}
        <span style={{ color: "#a1a1aa" }}>{formatTime(totalSec)}</span>
      </span>
      <div style={{ flex: 1 }} />
      <label
        style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "#71717a" }}
      >
        Speed
        <select
          onChange={onSpeedChange}
          value={String(playback.playbackRate ?? 1)}
          disabled={disabled}
          style={{
            background: "#18181b",
            color: "#e4e4e7",
            border: "1px solid #27272a",
            borderRadius: 3,
            fontSize: 10,
            padding: "1px 4px",
            cursor: disabled ? "not-allowed" : "pointer",
          }}
        >
          <option value="0.25">0.25×</option>
          <option value="0.5">0.5×</option>
          <option value="1">1×</option>
          <option value="1.5">1.5×</option>
          <option value="2">2×</option>
        </select>
      </label>
    </div>
  );
}

function iconBtn(disabled: boolean): React.CSSProperties {
  return {
    background: "transparent",
    border: "1px solid #27272a",
    borderRadius: 3,
    color: disabled ? "#3f3f46" : "#e4e4e7",
    width: 24,
    height: 22,
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: 12,
    lineHeight: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
  };
}

function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const mm = Math.floor(s / 60);
  const ss = s - mm * 60;
  return `${String(mm).padStart(2, "0")}:${ss.toFixed(2).padStart(5, "0")}`;
}

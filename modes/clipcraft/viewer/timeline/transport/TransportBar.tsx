import { useCallback } from "react";
import { useComposition, usePlayback } from "@pneuma-craft/react";
import { useTimelineMode } from "../../hooks/useTimelineMode.js";
import { useEditorTool } from "../hooks/useEditorTool.js";

/**
 * Global transport: play/pause, goto start/end, time/duration,
 * playback rate, and the 3D-view toggle (signature pneuma feature).
 * Always visible at the top of the Timeline.
 *
 * All state lives in the craft store — this component is a thin
 * view + dispatcher. No local state.
 */
export function TransportBar() {
  const composition = useComposition();
  const playback = usePlayback();
  const editorTool = useEditorTool();
  const { timelineMode, setTimelineMode } = useTimelineMode();
  const isExpanded = timelineMode !== "collapsed";

  const toggleExpanded = useCallback(() => {
    setTimelineMode(isExpanded ? "collapsed" : "overview");
  }, [isExpanded, setTimelineMode]);

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

  const setRate = useCallback(
    (rate: number) => {
      playback.setPlaybackRate(rate);
    },
    [playback],
  );

  const disabled = !composition;
  const totalSec = playback.duration ?? 0;
  // Use display time so the transport doesn't jiggle around while
  // the user hover-scrubs in split mode — it stays anchored at the
  // real playhead position.
  const curSec = editorTool.getDisplayTime(playback.currentTime ?? 0);

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
      <SpeedSegmentControl
        value={playback.playbackRate ?? 1}
        disabled={disabled}
        onChange={setRate}
      />
      <Threed3DToggle expanded={isExpanded} disabled={disabled} onToggle={toggleExpanded} />
    </div>
  );
}

/**
 * Compact segmented speed selector — five fixed options, active
 * segment gets the pneuma orange fill + soft glow. Replaces a
 * native <select> dropdown so the whole transport row stays
 * scanable at a glance.
 */
const SPEED_OPTIONS = [0.25, 0.5, 1, 1.5, 2] as const;

function SpeedSegmentControl({
  value,
  disabled,
  onChange,
}: {
  value: number;
  disabled: boolean;
  onChange: (rate: number) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Playback speed"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 2,
        padding: 2,
        borderRadius: 5,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {SPEED_OPTIONS.map((rate) => {
        const active = Math.abs(value - rate) < 1e-4;
        return (
          <button
            key={rate}
            type="button"
            onClick={() => !disabled && onChange(rate)}
            disabled={disabled}
            aria-pressed={active}
            title={`${rate}×`}
            style={{
              background: active
                ? "linear-gradient(135deg, rgba(249,115,22,0.45), rgba(249,115,22,0.15))"
                : "transparent",
              border: "none",
              color: active ? "#fed7aa" : "#a1a1aa",
              fontSize: 9,
              fontWeight: active ? 700 : 500,
              letterSpacing: 0.2,
              padding: "3px 7px",
              borderRadius: 3,
              cursor: disabled ? "not-allowed" : "pointer",
              minWidth: 28,
              height: 16,
              lineHeight: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "all 160ms cubic-bezier(0.2, 0.8, 0.2, 1)",
              boxShadow: active
                ? "0 0 8px rgba(249,115,22,0.35), inset 0 1px 0 rgba(255,255,255,0.08)"
                : "none",
            }}
          >
            {rate}×
          </button>
        );
      })}
    </div>
  );
}

/**
 * "3D view" pneuma signature button. Glassmorphism + soft orange glow.
 * The icon is three stacked perspective layers that fan apart on
 * activation. Visible weight without going gaudy.
 */
function Threed3DToggle({
  expanded,
  disabled,
  onToggle,
}: {
  expanded: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      title={expanded ? "Collapse 3D view" : "Open 3D view"}
      aria-pressed={expanded}
      style={{
        position: "relative",
        height: 24,
        padding: "0 10px 0 8px",
        display: "flex",
        alignItems: "center",
        gap: 6,
        background: expanded
          ? "linear-gradient(135deg, rgba(249,115,22,0.32), rgba(249,115,22,0.06))"
          : "linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        border: expanded
          ? "1px solid rgba(249,115,22,0.55)"
          : "1px solid rgba(255,255,255,0.1)",
        borderRadius: 4,
        color: expanded ? "#fed7aa" : "#a1a1aa",
        cursor: disabled ? "not-allowed" : "pointer",
        fontSize: 9,
        fontWeight: 600,
        letterSpacing: 0.7,
        textTransform: "uppercase",
        transition: "all 220ms cubic-bezier(0.2, 0.8, 0.2, 1)",
        boxShadow: expanded
          ? "0 0 14px rgba(249,115,22,0.4), inset 0 1px 0 rgba(255,255,255,0.1)"
          : "inset 0 1px 0 rgba(255,255,255,0.04)",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Layers3DIcon expanded={expanded} />
      <span>3D</span>
    </button>
  );
}

function Layers3DIcon({ expanded }: { expanded: boolean }) {
  // When expanded, the top + bottom layers fan apart vertically.
  const offset = expanded ? 1.5 : 0;
  const t = "transform 260ms cubic-bezier(0.2, 0.8, 0.2, 1)";
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
      <g
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
        strokeLinecap="round"
        fill="none"
      >
        <path
          d="M 2 4 L 9 2 L 12 4 L 5 6 Z"
          style={{ transform: `translateY(${-offset}px)`, transition: t, transformOrigin: "center" }}
        />
        <path d="M 2 7 L 9 5 L 12 7 L 5 9 Z" />
        <path
          d="M 2 10 L 9 8 L 12 10 L 5 12 Z"
          style={{ transform: `translateY(${offset}px)`, transition: t, transformOrigin: "center" }}
        />
      </g>
    </svg>
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

import { useCallback } from "react";
import { useComposition, usePlayback } from "@pneuma-craft/react";
import { useTimelineMode } from "../../hooks/useTimelineMode.js";
import { useEditorTool } from "../hooks/useEditorTool.js";
import {
  PlayIcon,
  PauseIcon,
  SkipBackIcon,
  SkipForwardIcon,
} from "../../icons/index.js";
import { theme } from "../../theme/tokens.js";

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
  // Use display time so the transport doesn't jiggle around while the
  // user hover-scrubs in split mode — it stays anchored at the real
  // playhead position.
  const curSec = editorTool.getDisplayTime(playback.currentTime ?? 0);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: theme.space.space3,
        padding: `${theme.space.space2}px ${theme.space.space4}px`,
        borderBottom: `1px solid ${theme.color.borderWeak}`,
        fontFamily: theme.font.ui,
        background: theme.color.surface0,
      }}
    >
      <button
        type="button"
        onClick={gotoStart}
        disabled={disabled}
        style={ghostBtn(disabled)}
        title="Go to start (Home)"
        aria-label="go to start"
      >
        <SkipBackIcon size={13} />
      </button>
      <button
        type="button"
        onClick={togglePlay}
        disabled={disabled}
        style={primaryBtn(disabled)}
        title={isPlaying ? "Pause (Space)" : "Play (Space)"}
        aria-label={isPlaying ? "pause" : "play"}
      >
        {isPlaying ? <PauseIcon size={13} /> : <PlayIcon size={13} />}
      </button>
      <button
        type="button"
        onClick={gotoEnd}
        disabled={disabled}
        style={ghostBtn(disabled)}
        title="Go to end (End)"
        aria-label="go to end"
      >
        <SkipForwardIcon size={13} />
      </button>
      <Timecode current={curSec} total={totalSec} />
      <div style={{ flex: 1 }} />
      <SpeedSegmentControl
        value={playback.playbackRate ?? 1}
        disabled={disabled}
        onChange={setRate}
      />
      <Threed3DToggle
        expanded={isExpanded}
        disabled={disabled}
        onToggle={toggleExpanded}
      />
    </div>
  );
}

function Timecode({ current, total }: { current: number; total: number }) {
  return (
    <span
      aria-label="playback position"
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: theme.space.space1,
        fontFamily: theme.font.numeric,
        fontSize: theme.text.base,
        fontVariantNumeric: "tabular-nums",
        letterSpacing: theme.text.trackingBase,
        marginLeft: theme.space.space2,
      }}
    >
      <span
        style={{
          color: theme.color.ink0,
          fontWeight: theme.text.weightSemibold,
        }}
      >
        {formatTime(current)}
      </span>
      <span style={{ color: theme.color.ink5 }}>/</span>
      <span style={{ color: theme.color.ink3 }}>{formatTime(total)}</span>
    </span>
  );
}

/**
 * Compact segmented speed selector — five fixed options, active
 * segment gets a solid-but-gentle accent fill. No backdrop-blur, no
 * box-shadow glow; depth comes from surface contrast.
 */
const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 2] as const;

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
        gap: 1,
        padding: 2,
        borderRadius: theme.radius.base,
        background: theme.color.surface2,
        border: `1px solid ${theme.color.borderWeak}`,
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
              background: active ? theme.color.accentSoft : "transparent",
              border: "none",
              color: active ? theme.color.accentBright : theme.color.ink3,
              fontFamily: theme.font.numeric,
              fontSize: theme.text.xs,
              fontWeight: active
                ? theme.text.weightSemibold
                : theme.text.weightMedium,
              fontVariantNumeric: "tabular-nums",
              letterSpacing: theme.text.trackingBase,
              padding: `3px ${theme.space.space2}px`,
              borderRadius: theme.radius.sm,
              cursor: disabled ? "not-allowed" : "pointer",
              minWidth: 30,
              height: 18,
              lineHeight: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: `background ${theme.duration.quick}ms ${theme.easing.out}, color ${theme.duration.quick}ms ${theme.easing.out}`,
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
 * "3D view" pneuma signature button. Solid tinted bg + accent border
 * when active — no glassmorphism, no gradient, no glow. The icon
 * layers fan apart subtly when expanded.
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
        padding: `0 ${theme.space.space3}px 0 ${theme.space.space2}px`,
        display: "flex",
        alignItems: "center",
        gap: theme.space.space2,
        background: expanded ? theme.color.accentSoft : theme.color.surface2,
        border: `1px solid ${
          expanded ? theme.color.accentBorder : theme.color.border
        }`,
        borderRadius: theme.radius.base,
        color: expanded ? theme.color.accentBright : theme.color.ink2,
        cursor: disabled ? "not-allowed" : "pointer",
        fontFamily: theme.font.ui,
        fontSize: theme.text.xs,
        fontWeight: theme.text.weightSemibold,
        letterSpacing: theme.text.trackingCaps,
        textTransform: "uppercase",
        transition: `background ${theme.duration.base}ms ${theme.easing.out}, color ${theme.duration.base}ms ${theme.easing.out}, border-color ${theme.duration.base}ms ${theme.easing.out}`,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <AnimatedLayers3D expanded={expanded} />
      <span>3D</span>
    </button>
  );
}

/**
 * Transport-bar-specific variant of Layers3DIcon: the outer layers
 * fan apart vertically when the button is in the "expanded" state.
 * Kept inline because the per-path animation doesn't generalize to
 * the library icon API.
 */
function AnimatedLayers3D({ expanded }: { expanded: boolean }) {
  const offset = expanded ? 2 : 0;
  const t = `transform ${theme.duration.slow}ms ${theme.easing.out}`;
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <g
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        fill="none"
      >
        <path
          d="M8 2 L14 5 L8 8 L2 5 Z"
          style={{
            transform: `translateY(${-offset}px)`,
            transition: t,
            transformOrigin: "center",
          }}
        />
        <path d="M2 8 L8 11 L14 8" opacity="0.65" />
        <path
          d="M2 11 L8 14 L14 11"
          opacity="0.35"
          style={{
            transform: `translateY(${offset}px)`,
            transition: t,
            transformOrigin: "center",
          }}
        />
      </g>
    </svg>
  );
}

function ghostBtn(disabled: boolean): React.CSSProperties {
  return {
    background: "transparent",
    border: `1px solid ${theme.color.borderWeak}`,
    borderRadius: theme.radius.sm,
    color: disabled ? theme.color.ink5 : theme.color.ink2,
    width: 24,
    height: 24,
    cursor: disabled ? "not-allowed" : "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    transition: `color ${theme.duration.quick}ms ${theme.easing.out}, border-color ${theme.duration.quick}ms ${theme.easing.out}`,
  };
}

function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    background: disabled ? theme.color.surface2 : theme.color.surface3,
    border: `1px solid ${theme.color.border}`,
    borderRadius: theme.radius.sm,
    color: disabled ? theme.color.ink5 : theme.color.ink0,
    width: 28,
    height: 24,
    cursor: disabled ? "not-allowed" : "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    transition: `background ${theme.duration.quick}ms ${theme.easing.out}, color ${theme.duration.quick}ms ${theme.easing.out}`,
  };
}

function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const mm = Math.floor(s / 60);
  const ss = s - mm * 60;
  return `${String(mm).padStart(2, "0")}:${ss.toFixed(2).padStart(5, "0")}`;
}

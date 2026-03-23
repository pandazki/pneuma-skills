/**
 * RemotionControls — custom playback controls for the Remotion Player.
 * Timeline scrubber, play/pause, speed selector, time display, loop range.
 */

import { useCallback, useRef, useState } from "react";
import type { PlayerRef } from "@remotion/player";

interface RemotionControlsProps {
  playerRef: React.RefObject<PlayerRef | null>;
  frame: number;
  durationInFrames: number;
  fps: number;
  playing: boolean;
  playbackRate: number;
  loop: boolean;
  inFrame: number | null;
  outFrame: number | null;
  onPlayPause: () => void;
  onSeek: (frame: number) => void;
  onRateChange: (rate: number) => void;
  onLoopToggle: () => void;
  onSetIn: () => void;
  onSetOut: () => void;
  onClearRange: () => void;
}

const SPEED_OPTIONS = [0.5, 1, 1.5, 2] as const;

// All icons render at 14×14 with consistent stroke weight for visual uniformity
const ICON_SIZE = 14;

function formatTime(frame: number, fps: number): string {
  const totalSeconds = frame / fps;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const frames = Math.floor(frame % fps);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(frames).padStart(2, "0")}`;
}

export default function RemotionControls({
  playerRef,
  frame,
  durationInFrames,
  fps,
  playing,
  playbackRate,
  loop,
  inFrame,
  outFrame,
  onPlayPause,
  onSeek,
  onRateChange,
  onLoopToggle,
  onSetIn,
  onSetOut,
  onClearRange,
}: RemotionControlsProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showFrames, setShowFrames] = useState(false);

  const lastFrame = Math.max(1, durationInFrames - 1);
  const progress = Math.min(1, frame / lastFrame);
  const hasRange = inFrame !== null || outFrame !== null;
  const rangeStartPct = inFrame !== null ? (inFrame / lastFrame) * 100 : 0;
  const rangeEndPct = outFrame !== null ? (outFrame / lastFrame) * 100 : 100;

  const seekFromMouse = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      onSeek(Math.round(ratio * lastFrame));
    },
    [lastFrame, onSeek],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      setIsDragging(true);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      seekFromMouse(e.clientX);
    },
    [seekFromMouse],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (isDragging) seekFromMouse(e.clientX);
    },
    [isDragging, seekFromMouse],
  );

  const handlePointerUp = useCallback(() => setIsDragging(false), []);

  const accent = "var(--cc-primary, #f97316)";

  // Shared button style for icon buttons
  const iconBtnClass = "w-7 h-7 flex items-center justify-center rounded-md hover:bg-white/10 transition-colors";

  return (
    <div className="flex flex-col gap-2 px-4 py-3"
      style={{ background: "var(--cc-bg-secondary, #18181b)" }}>

      {/* ── Timeline ─────────────────────────────────────────────── */}
      <div
        ref={trackRef}
        className="relative h-2 rounded-full cursor-pointer group"
        style={{ background: "var(--cc-bg-tertiary, #27272a)" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {/* Loop range band */}
        {hasRange && (
          <div className="absolute inset-y-0 rounded-full"
            style={{ left: `${rangeStartPct}%`, width: `${rangeEndPct - rangeStartPct}%`, background: accent, opacity: 0.15 }}
          />
        )}

        {/* Progress fill */}
        <div className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${progress * 100}%`, background: accent, opacity: 0.6 }}
        />

        {/* In/Out markers — rendered above progress for visibility */}
        {inFrame !== null && (
          <div className="absolute" style={{ left: `${rangeStartPct}%`, top: -3, bottom: -3, zIndex: 2 }}>
            <div style={{ width: 2, height: "100%", background: accent, borderRadius: 1 }} />
            <div style={{ position: "absolute", top: 0, left: -2, width: 6, height: 6, borderRadius: "50%", background: accent }} />
          </div>
        )}
        {outFrame !== null && (
          <div className="absolute" style={{ left: `${rangeEndPct}%`, top: -3, bottom: -3, zIndex: 2 }}>
            <div style={{ width: 2, height: "100%", background: accent, borderRadius: 1, marginLeft: -2 }} />
            <div style={{ position: "absolute", bottom: 0, right: -2, width: 6, height: 6, borderRadius: "50%", background: accent }} />
          </div>
        )}

        {/* Playhead */}
        <div className="absolute top-1/2 -translate-y-1/2 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ left: `calc(${progress * 100}% - 5px)`, width: 10, height: 10, background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.4)", zIndex: 3 }}
        />
      </div>

      {/* ── Controls row ─────────────────────────────────────────── */}
      <div className="flex items-center gap-2" style={{ color: "var(--cc-text-secondary, #a1a1aa)" }}>

        {/* Play / Pause */}
        <button onClick={onPlayPause} className={iconBtnClass} title={playing ? "Pause (Space)" : "Play (Space)"}>
          {playing ? (
            <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" fill="currentColor">
              <rect x="3" y="2" width="3.5" height="12" rx="1" />
              <rect x="9.5" y="2" width="3.5" height="12" rx="1" />
            </svg>
          ) : (
            <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" fill="currentColor">
              <path d="M4 2.5v11l9-5.5z" />
            </svg>
          )}
        </button>

        {/* Time display */}
        <button
          className="font-mono text-[11px] tabular-nums hover:text-white transition-colors min-w-[110px] text-left"
          onClick={() => setShowFrames(!showFrames)}
          title="Click to toggle frame numbers"
        >
          {showFrames
            ? `${frame} / ${durationInFrames} f`
            : `${formatTime(frame, fps)} / ${formatTime(durationInFrames, fps)}`}
        </button>

        {/* ── Range group: [ ] ↻ ✕ ── */}
        <div className="flex items-center rounded-md overflow-hidden"
          style={{ background: "var(--cc-bg-tertiary, #27272a)" }}>
          <button onClick={onSetIn} className={iconBtnClass} style={{ color: inFrame !== null ? accent : undefined, borderRadius: 0 }} title="Set in-point (I)">
            <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M5 3v10" />
              <path d="M5 8h7" />
              <path d="M9 5l3 3-3 3" />
            </svg>
          </button>
          <button onClick={onSetOut} className={iconBtnClass} style={{ color: outFrame !== null ? accent : undefined, borderRadius: 0 }} title="Set out-point (O)">
            <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M11 3v10" />
              <path d="M4 8h7" />
              <path d="M7 5L4 8l3 3" />
            </svg>
          </button>
          <button onClick={onLoopToggle} className={iconBtnClass} style={{ color: loop ? accent : undefined, borderRadius: 0 }} title="Loop (L)">
            <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 2l2.5 2.5L11 7" />
              <path d="M2.5 8.5v-1A2.5 2.5 0 015 5h8.5" />
              <path d="M5 14L2.5 11.5 5 9" />
              <path d="M13.5 7.5v1A2.5 2.5 0 0111 11H2.5" />
            </svg>
          </button>
          {hasRange && (
            <button onClick={onClearRange} className={iconBtnClass} style={{ color: "var(--cc-text-tertiary, #52525b)", borderRadius: 0 }} title="Clear range">
              <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          )}
        </div>

        <div className="flex-1" />

        {/* Speed */}
        <div className="flex items-center rounded-md overflow-hidden"
          style={{ background: "var(--cc-bg-tertiary, #27272a)" }}>
          {SPEED_OPTIONS.map((speed) => (
            <button
              key={speed}
              onClick={() => onRateChange(speed)}
              className="h-7 px-2 text-[11px] transition-colors"
              style={{
                background: playbackRate === speed ? accent : "transparent",
                color: playbackRate === speed ? "white" : undefined,
              }}
            >
              {speed}×
            </button>
          ))}
        </div>

        {/* Fullscreen */}
        <button onClick={() => playerRef.current?.requestFullscreen()} className={iconBtnClass} title="Fullscreen">
          <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" />
          </svg>
        </button>
      </div>
    </div>
  );
}

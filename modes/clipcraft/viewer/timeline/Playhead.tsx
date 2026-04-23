/**
 * Playhead — draggable orange playhead line + handle over the track area.
 *
 * Ported from `modes/clipcraft-legacy/viewer/timeline/Playhead.tsx`. The
 * legacy file was already purely prop-driven (`onSeek` callback, no reducer
 * dispatch), so this is a near-verbatim copy. The prop contract is
 * documented explicitly here for the @pneuma-craft port — `globalTime` +
 * `duration` come from `usePlayback()`, `pixelsPerSecond` + `scrollLeft`
 * from `useTimelineZoom`, and `onSeek` wires to `usePlayback().seek`.
 *
 * Pointer-events note: the outer container is `pointerEvents: "none"` so it
 * doesn't swallow clicks destined for TrackRow/ClipStrip underneath. The
 * two interactive hit regions — the vertical line and the drag handle —
 * opt back in with `pointerEvents: "auto"` on their own inline styles. The
 * tooltip stays `"none"`. Timeline's overlay wrapper is therefore a plain
 * pass-through.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { theme } from "../theme/tokens.js";

interface PlayheadProps {
  globalTime: number;
  duration: number;
  pixelsPerSecond: number;
  scrollLeft: number;
  trackAreaHeight: number;
  onSeek: (time: number) => void;
}

function formatTimeMs(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${ms}`;
}

export function Playhead({
  globalTime,
  duration,
  pixelsPerSecond,
  scrollLeft,
  trackAreaHeight,
  onSeek,
}: PlayheadProps) {
  const [dragging, setDragging] = useState(false);
  const [dragTime, setDragTime] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const displayTime = dragging ? dragTime : globalTime;
  const x = displayTime * pixelsPerSecond - scrollLeft;

  const xToTime = useCallback(
    (clientX: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return 0;
      const localX = clientX - rect.left;
      return Math.max(0, Math.min(duration, (localX + scrollLeft) / pixelsPerSecond));
    },
    [scrollLeft, pixelsPerSecond, duration],
  );

  // Click on track area to jump
  const handleAreaClick = useCallback(
    (e: React.MouseEvent) => {
      // Only handle clicks directly on the container, not on the playhead handle
      if ((e.target as HTMLElement).dataset.playhead) return;
      const t = xToTime(e.clientX);
      onSeek(t);
    },
    [xToTime, onSeek],
  );

  // Drag
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragging(true);
      setDragTime(displayTime);
    },
    [displayTime],
  );

  useEffect(() => {
    if (!dragging) return;

    const handleMove = (e: MouseEvent) => {
      const t = xToTime(e.clientX);
      setDragTime(t);
      onSeek(t);
    };

    const handleUp = () => {
      setDragging(false);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [dragging, xToTime, onSeek]);

  return (
    <div
      ref={containerRef}
      onClick={handleAreaClick}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        cursor: "pointer",
        zIndex: 10,
        pointerEvents: "none",
      }}
    >
      {/* Vertical line — purely visual; clicks must fall through to the
          clip underneath. Only the handle (below) is interactive. */}
      <div
        style={{
          position: "absolute",
          left: x,
          top: 0,
          width: 1,
          height: trackAreaHeight,
          marginLeft: -0.5,
          background: theme.color.playhead,
          pointerEvents: "none",
          transition: dragging ? "none" : "left 100ms linear",
          willChange: "left",
        }}
      />
      {/* Handle (triangle + rect) */}
      <div
        data-playhead="true"
        onMouseDown={handleMouseDown}
        style={{
          position: "absolute",
          left: x,
          top: -2,
          transform: "translateX(-50%)",
          cursor: dragging ? "grabbing" : "grab",
          pointerEvents: "auto",
          zIndex: 11,
          transition: dragging ? "none" : "left 100ms linear",
          willChange: "left",
        }}
      >
        <svg width="12" height="16" viewBox="0 0 12 16" aria-hidden="true">
          <path d="M0 0h12v10l-6 6-6-6z" fill={theme.color.playhead} />
        </svg>
      </div>
      {/* Time tooltip when dragging */}
      {dragging && (
        <div
          style={{
            position: "absolute",
            left: x,
            top: -26,
            transform: "translateX(-50%)",
            background: theme.color.surface3,
            border: `1px solid ${theme.color.playhead}`,
            color: theme.color.ink0,
            fontFamily: theme.font.numeric,
            fontVariantNumeric: "tabular-nums",
            fontSize: theme.text.xs,
            fontWeight: theme.text.weightSemibold,
            letterSpacing: theme.text.trackingBase,
            padding: `2px ${theme.space.space2}px`,
            borderRadius: theme.radius.sm,
            whiteSpace: "nowrap",
            pointerEvents: "none",
          }}
        >
          {formatTimeMs(dragTime)}
        </div>
      )}
    </div>
  );
}

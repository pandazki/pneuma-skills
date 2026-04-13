/**
 * Playhead — draggable orange playhead line + handle over the track area.
 *
 * Ported from `modes/clipcraft-legacy/viewer/timeline/Playhead.tsx`. The
 * legacy file was already purely prop-driven (`onSeek` callback, no reducer
 * dispatch), so this is a near-verbatim copy. The prop contract is
 * documented explicitly here for the @pneuma-craft port — `globalTime` +
 * `duration` come from `usePlayback()`, `pixelsPerSecond` + `scrollLeft`
 * from `useTimelineZoom`, and `onSeek` wires to `usePlayback().seek`.
 */
import { useCallback, useEffect, useRef, useState } from "react";

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

  const visible = x >= -10 && x <= (containerRef.current?.offsetWidth ?? 9999) + 10;

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
      }}
    >
      {visible && (
        <>
          {/* Vertical line — CSS transition for smooth playback */}
          <div
            style={{
              position: "absolute",
              left: x,
              top: 0,
              width: 2,
              height: trackAreaHeight,
              marginLeft: -1,
              background: "#f97316",
              borderRadius: 1,
              boxShadow: "0 0 6px rgba(249, 115, 22, 0.5)",
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
              zIndex: 11,
              transition: dragging ? "none" : "left 100ms linear",
              willChange: "left",
            }}
          >
            <svg width="12" height="16" viewBox="0 0 12 16">
              <path d="M0 0h12v10l-6 6-6-6z" fill="#f97316" />
            </svg>
          </div>
          {/* Time tooltip when dragging */}
          {dragging && (
            <div
              style={{
                position: "absolute",
                left: x,
                top: -24,
                transform: "translateX(-50%)",
                background: "#f97316",
                color: "#fff",
                fontSize: 10,
                fontWeight: 600,
                padding: "2px 6px",
                borderRadius: 3,
                whiteSpace: "nowrap",
                pointerEvents: "none",
              }}
            >
              {formatTimeMs(dragTime)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

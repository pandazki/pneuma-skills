import { useCallback, useEffect, useRef, useState } from "react";
import type { TimelineZoom } from "./hooks/useTimelineZoom.js";
import { theme } from "../theme/tokens.js";

interface Props {
  zoom: TimelineZoom;
  duration: number;
  currentTime: number;
}

/**
 * Thin minimap + horizontal scrollbar at the bottom of the timeline.
 *
 * Two modes:
 * 1. When the composition content is wider than the visible viewport
 *    (user zoomed in), the bar shows a draggable accent thumb that
 *    maps to the current scroll window.
 * 2. When content fits the viewport, the thumb fills the bar flat —
 *    we keep the playhead indicator visible so the user can ALWAYS
 *    see where the playhead is.
 */
export function TimelineMinimap({ zoom, duration, currentTime }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false);
  const [dragging, setDragging] = useState(false);

  const { contentWidth, viewportWidth, scrollLeft, scrollMin, scrollMax, scrollTo } = zoom;
  const scrollRange = Math.max(1, scrollMax - scrollMin);

  const handleBarClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const clickPct = (e.clientX - rect.left) / rect.width;
      const targetFraction = Math.max(0, Math.min(1, clickPct));
      const targetScroll = scrollMin + targetFraction * scrollRange;
      scrollTo(targetScroll);
    },
    [scrollMin, scrollRange, scrollTo],
  );

  const handleThumbDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      setDragging(true);
      const startX = e.clientX;
      const startScroll = scrollLeft;
      const trackWidth = trackRef.current?.getBoundingClientRect().width ?? 1;

      const onMove = (mv: MouseEvent) => {
        const dx = mv.clientX - startX;
        const deltaScroll = (dx / trackWidth) * scrollRange;
        const target = Math.max(scrollMin, Math.min(scrollMax, startScroll + deltaScroll));
        scrollTo(target);
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        setDragging(false);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [scrollLeft, scrollMin, scrollMax, scrollRange, scrollTo],
  );

  useEffect(() => {
    if (!dragging) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDragging(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dragging]);

  const needsScroll =
    contentWidth > 0 && viewportWidth > 0 && contentWidth > viewportWidth;
  const scrollFraction = needsScroll
    ? Math.max(0, Math.min(1, (scrollLeft - scrollMin) / scrollRange))
    : 0;
  const thumbWidthPct = needsScroll
    ? Math.max(8, Math.min(100, (viewportWidth / contentWidth) * 100))
    : 100;
  const thumbLeftPct = scrollFraction * (100 - thumbWidthPct);
  const playheadPct =
    duration > 0 ? Math.max(0, Math.min(1, currentTime / duration)) * 100 : 0;
  const thumbActive = needsScroll && (hover || dragging);

  return (
    <div
      style={{
        padding: `${theme.space.space1}px 0 ${theme.space.space1}px`,
        userSelect: "none",
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div
        ref={trackRef}
        onClick={needsScroll ? handleBarClick : undefined}
        style={{
          position: "relative",
          height: 6,
          background: theme.color.surface2,
          border: `1px solid ${theme.color.borderWeak}`,
          borderRadius: theme.radius.sm,
          cursor: needsScroll ? "pointer" : "default",
          overflow: "hidden",
        }}
      >
        {/* Playhead indicator */}
        <div
          style={{
            position: "absolute",
            left: `calc(${playheadPct}% - 1px)`,
            top: 0,
            bottom: 0,
            width: 2,
            background: theme.color.playhead,
            pointerEvents: "none",
            zIndex: 2,
          }}
        />
        {/* Viewport thumb — draggable when there's content to scroll. */}
        <div
          onMouseDown={needsScroll ? handleThumbDown : undefined}
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${thumbLeftPct}%`,
            width: `${thumbWidthPct}%`,
            background: needsScroll
              ? thumbActive
                ? theme.color.accentBorder
                : theme.color.accentSoft
              : theme.color.surface3,
            borderRadius: theme.radius.sm,
            cursor: needsScroll ? (dragging ? "grabbing" : "grab") : "default",
            transition: dragging
              ? "none"
              : `background ${theme.duration.quick}ms ${theme.easing.out}`,
            pointerEvents: needsScroll ? "auto" : "none",
          }}
        />
      </div>
    </div>
  );
}

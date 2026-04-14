import { useCallback, useEffect, useRef, useState } from "react";
import type { TimelineZoom } from "./hooks/useTimelineZoom.js";

interface Props {
  zoom: TimelineZoom;
  duration: number;
  currentTime: number;
}

/**
 * Thin minimap + horizontal scrollbar at the bottom of the timeline.
 *
 * - Shows the visible viewport as a rounded "thumb" inside a full-width
 *   bar representing the entire composition.
 * - Drag the thumb to pan the timeline (`zoom.scrollTo`).
 * - Click anywhere on the bar (outside the thumb) to jump-scroll there.
 * - Tiny orange dot inside the bar marks the current playhead position.
 * - Auto-hides when the content already fits the viewport (no zoom).
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

  // Hide when composition fits viewport — render a fixed-height spacer so
  // layout doesn't shift when zoom changes the visibility.
  if (contentWidth <= 0 || viewportWidth <= 0 || contentWidth <= viewportWidth) {
    return <div style={{ height: 12 }} />;
  }

  // Thumb width = (viewport / content) of the bar width.
  const scrollFraction = Math.max(0, Math.min(1, (scrollLeft - scrollMin) / scrollRange));
  const thumbWidthPct = Math.max(8, Math.min(100, (viewportWidth / contentWidth) * 100));
  const thumbLeftPct = scrollFraction * (100 - thumbWidthPct);
  const playheadPct = duration > 0 ? Math.max(0, Math.min(1, currentTime / duration)) * 100 : 0;
  const thumbActive = hover || dragging;

  return (
    <div
      style={{
        padding: "2px 0 4px",
        userSelect: "none",
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div
        ref={trackRef}
        onClick={handleBarClick}
        style={{
          position: "relative",
          height: 6,
          background: "rgba(255,255,255,0.04)",
          borderRadius: 3,
          cursor: "pointer",
          overflow: "hidden",
        }}
      >
        {/* Subtle inner gradient to suggest the full timeline span */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.0))",
            pointerEvents: "none",
          }}
        />
        {/* Playhead indicator */}
        <div
          style={{
            position: "absolute",
            left: `calc(${playheadPct}% - 1px)`,
            top: 0,
            bottom: 0,
            width: 2,
            background: "rgba(249,115,22,0.85)",
            borderRadius: 1,
            pointerEvents: "none",
            boxShadow: "0 0 4px rgba(249,115,22,0.6)",
          }}
        />
        {/* Viewport thumb */}
        <div
          onMouseDown={handleThumbDown}
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${thumbLeftPct}%`,
            width: `${thumbWidthPct}%`,
            background: thumbActive
              ? "rgba(249,115,22,0.55)"
              : "rgba(249,115,22,0.32)",
            borderRadius: 3,
            cursor: dragging ? "grabbing" : "grab",
            boxShadow: thumbActive
              ? "0 0 8px rgba(249,115,22,0.45)"
              : "0 0 0 1px rgba(255,255,255,0.04) inset",
            transition: dragging ? "none" : "background 120ms ease",
          }}
        />
      </div>
    </div>
  );
}

/**
 * Timeline zoom + scroll state hook.
 *
 * Ported from `modes/clipcraft-legacy/viewer/timeline/hooks/useTimelineZoom.ts`.
 *
 * Port rationale: the legacy hook read/wrote `timelineZoom` through the
 * ClipCraft reducer so the collapsed timeline and 3D overview could share
 * state. In the @pneuma-craft port we don't have that reducer — zoom and
 * scroll are UI-only, don't need to survive reload, and match every other
 * editor in the runtime. So we replace the reducer with plain `useState`.
 * Math, clamps, wheel + ResizeObserver behavior are otherwise identical.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface TimelineZoom {
  pixelsPerSecond: number;
  scrollLeft: number;
  totalWidth: number;
  viewportWidth: number;
  timeToX: (time: number) => number;
  xToTime: (x: number) => number;
  zoomIn: () => void;
  zoomOut: () => void;
  setZoom: (pps: number) => void;
  scrollTo: (x: number) => void;
}

const ZOOM_STEP = 1.3;
const ABSOLUTE_MAX_PPS = 300;
const ABSOLUTE_MIN_PPS = 5;

export function useTimelineZoom(
  duration: number,
  containerRef: React.RefObject<HTMLElement | null>,
): TimelineZoom {
  const [pixelsPerSecond, setPixelsPerSecond] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);

  const dur = Math.max(duration, 0.1);
  const minPPS = Math.max(
    ABSOLUTE_MIN_PPS,
    viewportWidth > 0 ? (viewportWidth * 0.5) / dur : ABSOLUTE_MIN_PPS,
  );
  const maxPPS = ABSOLUTE_MAX_PPS;

  const contentWidth = dur * pixelsPerSecond;
  const totalWidth = Math.max(contentWidth + viewportWidth, viewportWidth);
  const scrollMin = -(viewportWidth / 4);
  const scrollMax = contentWidth - (viewportWidth * 3) / 4;

  // Observe container width + auto-fit on first render
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const obs = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setViewportWidth(w);
      // Auto-fit on first render (pps === 0)
      if (pixelsPerSecond === 0 && dur > 0 && w > 0) {
        const fitPPS = Math.max(minPPS, Math.min(maxPPS, w / dur));
        setPixelsPerSecond(fitPPS);
        setScrollLeft(0);
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [containerRef, dur, pixelsPerSecond, minPPS, maxPPS]);

  const setZoom = useCallback(
    (pps: number) => {
      const clamped = Math.max(minPPS, Math.min(maxPPS, pps));
      if (pixelsPerSecond <= 0) {
        setPixelsPerSecond(clamped);
        setScrollLeft(0);
        return;
      }
      // Zoom around viewport center
      const centerTime = (scrollLeft + viewportWidth / 2) / pixelsPerSecond;
      const newScrollLeft = centerTime * clamped - viewportWidth / 2;
      setPixelsPerSecond(clamped);
      setScrollLeft(newScrollLeft);
    },
    [minPPS, maxPPS, scrollLeft, viewportWidth, pixelsPerSecond],
  );

  const doScrollTo = useCallback(
    (x: number) => {
      const clamped = Math.max(scrollMin, Math.min(x, scrollMax));
      setScrollLeft(clamped);
    },
    [scrollMin, scrollMax],
  );

  const zoomIn = useCallback(() => {
    setZoom(pixelsPerSecond * ZOOM_STEP);
  }, [pixelsPerSecond, setZoom]);

  const zoomOut = useCallback(() => {
    setZoom(pixelsPerSecond / ZOOM_STEP);
  }, [pixelsPerSecond, setZoom]);

  const timeToX = useCallback(
    (time: number) => time * pixelsPerSecond - scrollLeft,
    [pixelsPerSecond, scrollLeft],
  );

  const xToTime = useCallback(
    (x: number) => (x + scrollLeft) / pixelsPerSecond,
    [pixelsPerSecond, scrollLeft],
  );

  // Wheel handler — use a stable ref for latest state, re-bind when element changes
  const stateRef = useRef({ pixelsPerSecond, scrollLeft, minPPS, maxPPS, scrollMin, scrollMax });
  stateRef.current = { pixelsPerSecond, scrollLeft, minPPS, maxPPS, scrollMin, scrollMax };
  const boundElRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (el === boundElRef.current) return;

    if (boundElRef.current && (boundElRef.current as any).__wheelHandler) {
      boundElRef.current.removeEventListener(
        "wheel",
        (boundElRef.current as any).__wheelHandler,
      );
    }

    if (!el) {
      boundElRef.current = null;
      return;
    }

    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const s = stateRef.current;
      if (e.ctrlKey || e.metaKey) {
        const factor = e.deltaY > 0 ? 1 / ZOOM_STEP : ZOOM_STEP;
        const newPPS = Math.max(s.minPPS, Math.min(s.maxPPS, s.pixelsPerSecond * factor));
        // Zoom around viewport center: keep the center time point stationary
        const rect = el.getBoundingClientRect();
        const centerX = rect.width / 2;
        const centerTime =
          s.pixelsPerSecond > 0 ? (s.scrollLeft + centerX) / s.pixelsPerSecond : 0;
        const newScrollLeft = centerTime * newPPS - centerX;
        setPixelsPerSecond(newPPS);
        setScrollLeft(newScrollLeft);
      } else {
        const dx = e.deltaX + e.deltaY;
        const newSL = Math.max(s.scrollMin, Math.min(s.scrollLeft + dx, s.scrollMax));
        setScrollLeft(newSL);
      }
    };
    el.addEventListener("wheel", handler, { passive: false });
    (el as any).__wheelHandler = handler;
    boundElRef.current = el;

    return () => {
      el.removeEventListener("wheel", handler);
      (el as any).__wheelHandler = null;
      boundElRef.current = null;
    };
  });

  return useMemo(
    () => ({
      pixelsPerSecond,
      scrollLeft,
      totalWidth,
      viewportWidth,
      timeToX,
      xToTime,
      zoomIn,
      zoomOut,
      setZoom,
      scrollTo: doScrollTo,
    }),
    [
      pixelsPerSecond,
      scrollLeft,
      totalWidth,
      viewportWidth,
      timeToX,
      xToTime,
      zoomIn,
      zoomOut,
      setZoom,
      doScrollTo,
    ],
  );
}

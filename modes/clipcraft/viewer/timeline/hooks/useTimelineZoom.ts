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
  /** Pixel width of the actual content (composition.duration * pps). */
  contentWidth: number;
  /** Min/max for scrollLeft — used by the minimap to compute drag bounds. */
  scrollMin: number;
  scrollMax: number;
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

  // Observe container width + auto-fit once per mount (re-fit when duration changes)
  const didAutoFitRef = useRef(false);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const obs = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setViewportWidth(w);
      // Auto-fit only once — zoom changes must not tear down the observer
      if (!didAutoFitRef.current && dur > 0 && w > 0) {
        const fitMinPPS = Math.max(ABSOLUTE_MIN_PPS, (w * 0.5) / dur);
        const fitPPS = Math.max(fitMinPPS, Math.min(ABSOLUTE_MAX_PPS, w / dur));
        setPixelsPerSecond(fitPPS);
        setScrollLeft(0);
        didAutoFitRef.current = true;
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [containerRef, dur]);

  // Functional setter — reads latest committed state via the updater, so
  // rapid synchronous clicks accumulate instead of all stomping on the same
  // pre-click value. Pair of setPixelsPerSecond + nested setScrollLeft keeps
  // the zoom centered on the viewport midpoint per legacy behavior.
  const applyZoomFactor = useCallback(
    (factor: number) => {
      setPixelsPerSecond((prevPps) => {
        if (prevPps <= 0) return prevPps; // not yet auto-fit
        const clamped = Math.max(minPPS, Math.min(maxPPS, prevPps * factor));
        setScrollLeft((prevSL) => {
          const centerTime = (prevSL + viewportWidth / 2) / prevPps;
          return centerTime * clamped - viewportWidth / 2;
        });
        return clamped;
      });
    },
    [minPPS, maxPPS, viewportWidth],
  );

  const setZoom = useCallback(
    (pps: number) => {
      setPixelsPerSecond((prevPps) => {
        const clamped = Math.max(minPPS, Math.min(maxPPS, pps));
        if (prevPps <= 0) {
          setScrollLeft(0);
          return clamped;
        }
        setScrollLeft((prevSL) => {
          const centerTime = (prevSL + viewportWidth / 2) / prevPps;
          return centerTime * clamped - viewportWidth / 2;
        });
        return clamped;
      });
    },
    [minPPS, maxPPS, viewportWidth],
  );

  const doScrollTo = useCallback(
    (x: number) => {
      const clamped = Math.max(scrollMin, Math.min(x, scrollMax));
      setScrollLeft(clamped);
    },
    [scrollMin, scrollMax],
  );

  const zoomIn = useCallback(() => applyZoomFactor(ZOOM_STEP), [applyZoomFactor]);
  const zoomOut = useCallback(() => applyZoomFactor(1 / ZOOM_STEP), [applyZoomFactor]);

  const timeToX = useCallback(
    (time: number) => time * pixelsPerSecond - scrollLeft,
    [pixelsPerSecond, scrollLeft],
  );

  const xToTime = useCallback(
    (x: number) => (x + scrollLeft) / pixelsPerSecond,
    [pixelsPerSecond, scrollLeft],
  );

  // Wheel handler — use a stable ref for latest state, bind once per element
  const stateRef = useRef({ pixelsPerSecond, scrollLeft, minPPS, maxPPS, scrollMin, scrollMax });
  stateRef.current = { pixelsPerSecond, scrollLeft, minPPS, maxPPS, scrollMin, scrollMax };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

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

    return () => {
      el.removeEventListener("wheel", handler);
    };
    // dur is in the deps so this effect re-runs once Timeline's early-return
    // ("no composition loaded") releases and the JSX with ref={containerRef}
    // is mounted for real. Without it, the listener would attach against a
    // null ref and never re-bind once the composition arrives.
  }, [containerRef, dur]);

  return useMemo(
    () => ({
      pixelsPerSecond,
      scrollLeft,
      totalWidth,
      viewportWidth,
      contentWidth,
      scrollMin,
      scrollMax,
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
      contentWidth,
      scrollMin,
      scrollMax,
      timeToX,
      xToTime,
      zoomIn,
      zoomOut,
      setZoom,
      doScrollTo,
    ],
  );
}

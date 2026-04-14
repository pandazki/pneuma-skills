import { useCallback, useEffect, useRef, useState } from "react";
import type { Track, CompositionCommand } from "@pneuma-craft/timeline";
import type { Actor, CoreCommand } from "@pneuma-craft/core";
import { useComposition, usePlayback } from "@pneuma-craft/react";
import { collectSnapPoints, snapToNearest } from "../snapPoints.js";

type Dispatch = (
  actor: Actor,
  cmd: CoreCommand | CompositionCommand,
) => unknown;

const MIN_DURATION = 0.1;
const SNAP_PX = 5;

interface ResizeState {
  clipId: string;
  edge: "left" | "right";
  startMouseX: number;
  originalStartTime: number;
  originalDuration: number;
  originalInPoint: number;
  originalOutPoint: number;
  displayStartTime: number;
  displayDuration: number;
  displayInPoint: number;
  displayOutPoint: number;
  snapTime: number | null;
}

export interface UseClipResize {
  handleResizeStart: (
    clipId: string,
    edge: "left" | "right",
    mouseX: number,
  ) => void;
  displayStartFor: (clipId: string) => number | null;
  displayDurationFor: (clipId: string) => number | null;
  /** When a resize is mid-drag and the edge has snapped to another
   *  clip / the playhead / t=0, this returns the snap time so the
   *  caller can render a vertical guide line. */
  resizeSnapTime: number | null;
}

/**
 * Edge-drag resize for a single clip. Not rippled — other clips stay put;
 * a resize that would overlap a neighbor is just clamped by the neighbor's
 * edge on release.
 */
export function useClipResize(
  track: Track,
  pixelsPerSecond: number,
  dispatch: Dispatch,
): UseClipResize {
  const composition = useComposition();
  const playback = usePlayback();
  const [state, setState] = useState<ResizeState | null>(null);
  const stateRef = useRef<ResizeState | null>(null);
  const clipsRef = useRef(track.clips);
  clipsRef.current = track.clips;
  const ppsRef = useRef(pixelsPerSecond);
  ppsRef.current = pixelsPerSecond;
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  const compositionRef = useRef(composition);
  compositionRef.current = composition;
  const playheadRef = useRef(playback.currentTime);
  playheadRef.current = playback.currentTime;

  const handleResizeStart = useCallback(
    (clipId: string, edge: "left" | "right", mouseX: number) => {
      const clip = clipsRef.current.find((c) => c.id === clipId);
      if (!clip) return;
      const initial: ResizeState = {
        clipId,
        edge,
        startMouseX: mouseX,
        originalStartTime: clip.startTime,
        originalDuration: clip.duration,
        originalInPoint: clip.inPoint,
        originalOutPoint: clip.outPoint,
        displayStartTime: clip.startTime,
        displayDuration: clip.duration,
        displayInPoint: clip.inPoint,
        displayOutPoint: clip.outPoint,
        snapTime: null,
      };
      stateRef.current = initial;
      setState(initial);
    },
    [],
  );

  useEffect(() => {
    if (!state) return;

    const onMove = (ev: MouseEvent) => {
      const s = stateRef.current;
      const pps = ppsRef.current;
      if (!s || pps <= 0) return;
      const deltaT = (ev.clientX - s.startMouseX) / pps;

      // Policy: resize is an INWARD-ONLY trim. A clip can never grow
      // past the bounds it had when the drag started (the asset
      // duration headroom isn't cheaply available from the clip+track
      // alone, and exposing more content would require re-stretching
      // the filmstrip which is visually misleading). To re-expand a
      // trim, undo and re-do.
      let displayStartTime = s.originalStartTime;
      let displayDuration = s.originalDuration;
      let displayInPoint = s.originalInPoint;
      let displayOutPoint = s.originalOutPoint;

      if (s.edge === "left") {
        // Anchor right edge: startTime + duration == originalStartTime + originalDuration.
        // Only allow inward drag: newStart must be >= originalStartTime
        // (can't extend leftward past where the edge was when drag started).
        let newStart = Math.max(s.originalStartTime, s.originalStartTime + deltaT);
        // Clamp so duration stays >= MIN_DURATION
        const rightEdge = s.originalStartTime + s.originalDuration;
        if (rightEdge - newStart < MIN_DURATION) {
          newStart = rightEdge - MIN_DURATION;
        }
        const inShift = newStart - s.originalStartTime;
        // Clamp inPoint >= 0 (also redundant with inward-only rule above).
        const newInPoint = Math.max(0, s.originalInPoint + inShift);
        const effectiveInShift = newInPoint - s.originalInPoint;
        displayInPoint = newInPoint;
        displayStartTime = s.originalStartTime + effectiveInShift;
        displayDuration = rightEdge - displayStartTime;
      } else {
        // Right edge: only allow inward drag (shrink).
        // newDuration must be <= originalDuration (can't extend rightward).
        let newDuration = Math.min(
          s.originalDuration,
          Math.max(MIN_DURATION, s.originalDuration + deltaT),
        );
        displayDuration = newDuration;
        displayOutPoint = s.originalInPoint + newDuration;
      }

      // Cross-track snap. Snap whichever edge is being dragged to a
      // nearby point (any clip edge on any track, playhead, or t=0).
      const points = collectSnapPoints(
        compositionRef.current,
        new Set([s.clipId]),
        playheadRef.current,
      );
      const threshold = SNAP_PX / pps;
      let snapTime: number | null = null;
      if (s.edge === "left") {
        const snap = snapToNearest(displayStartTime, points, threshold);
        if (snap.snappedTo !== null) {
          const rightEdge = s.originalStartTime + s.originalDuration;
          // Apply snap — but still respect the inward-only + min-duration rules.
          let snappedStart = Math.max(s.originalStartTime, snap.time);
          if (rightEdge - snappedStart < MIN_DURATION) {
            snappedStart = rightEdge - MIN_DURATION;
          }
          const shift = snappedStart - s.originalStartTime;
          const snappedInPoint = Math.max(0, s.originalInPoint + shift);
          const effectiveShift = snappedInPoint - s.originalInPoint;
          displayInPoint = snappedInPoint;
          displayStartTime = s.originalStartTime + effectiveShift;
          displayDuration = rightEdge - displayStartTime;
          snapTime = snap.snappedTo;
        }
      } else {
        const endCandidate = displayStartTime + displayDuration;
        const snap = snapToNearest(endCandidate, points, threshold);
        if (snap.snappedTo !== null) {
          let snappedEnd = snap.time;
          // Clamp by the max (originalStartTime + originalDuration) — can't extend.
          const maxEnd = s.originalStartTime + s.originalDuration;
          if (snappedEnd > maxEnd) snappedEnd = maxEnd;
          const snappedDur = Math.max(MIN_DURATION, snappedEnd - displayStartTime);
          displayDuration = snappedDur;
          displayOutPoint = s.originalInPoint + snappedDur;
          snapTime = snap.snappedTo;
        }
      }

      const next: ResizeState = {
        ...s,
        displayStartTime,
        displayDuration,
        displayInPoint,
        displayOutPoint,
        snapTime,
      };
      stateRef.current = next;
      setState(next);
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      const s = stateRef.current;
      if (s) {
        const changedStart = Math.abs(s.displayStartTime - s.originalStartTime) > 1e-6;
        const changedDuration = Math.abs(s.displayDuration - s.originalDuration) > 1e-6;
        if (changedStart || changedDuration) {
          // Trim command carries the new in/out + duration
          dispatchRef.current("human", {
            type: "composition:trim-clip",
            clipId: s.clipId,
            inPoint: s.displayInPoint,
            outPoint: s.displayOutPoint,
            duration: s.displayDuration,
          });
          // If the start shifted (left-edge resize), also move-clip so
          // downstream state (and autosave serializer) reflects the new start.
          if (changedStart) {
            dispatchRef.current("human", {
              type: "composition:move-clip",
              clipId: s.clipId,
              startTime: s.displayStartTime,
            });
          }
        }
      }
      stateRef.current = null;
      setState(null);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.clipId, state?.edge]);

  const displayStartFor = useCallback(
    (clipId: string): number | null => {
      if (!state || state.clipId !== clipId) return null;
      return state.displayStartTime;
    },
    [state],
  );

  const displayDurationFor = useCallback(
    (clipId: string): number | null => {
      if (!state || state.clipId !== clipId) return null;
      return state.displayDuration;
    },
    [state],
  );

  return {
    handleResizeStart,
    displayStartFor,
    displayDurationFor,
    resizeSnapTime: state?.snapTime ?? null,
  };
}

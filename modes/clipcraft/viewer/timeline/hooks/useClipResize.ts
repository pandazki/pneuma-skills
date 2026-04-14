import { useCallback, useEffect, useRef, useState } from "react";
import type { Track, CompositionCommand } from "@pneuma-craft/timeline";
import type { Actor, CoreCommand } from "@pneuma-craft/core";

type Dispatch = (
  actor: Actor,
  cmd: CoreCommand | CompositionCommand,
) => unknown;

const MIN_DURATION = 0.1;

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
}

export interface UseClipResize {
  handleResizeStart: (
    clipId: string,
    edge: "left" | "right",
    mouseX: number,
  ) => void;
  displayStartFor: (clipId: string) => number | null;
  displayDurationFor: (clipId: string) => number | null;
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
  const [state, setState] = useState<ResizeState | null>(null);
  const stateRef = useRef<ResizeState | null>(null);
  const clipsRef = useRef(track.clips);
  clipsRef.current = track.clips;
  const ppsRef = useRef(pixelsPerSecond);
  ppsRef.current = pixelsPerSecond;
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

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

      let displayStartTime = s.originalStartTime;
      let displayDuration = s.originalDuration;
      let displayInPoint = s.originalInPoint;
      let displayOutPoint = s.originalOutPoint;

      if (s.edge === "left") {
        // Anchor right edge: startTime + duration == originalStartTime + originalDuration.
        let newStart = Math.max(0, s.originalStartTime + deltaT);
        // clamp so duration stays >= MIN_DURATION
        const rightEdge = s.originalStartTime + s.originalDuration;
        if (rightEdge - newStart < MIN_DURATION) {
          newStart = rightEdge - MIN_DURATION;
        }
        const inShift = newStart - s.originalStartTime;
        // Clamp inPoint >= 0.
        const newInPoint = Math.max(0, s.originalInPoint + inShift);
        // Recompute startTime if inPoint was clamped
        const effectiveInShift = newInPoint - s.originalInPoint;
        displayInPoint = newInPoint;
        displayStartTime = s.originalStartTime + effectiveInShift;
        displayDuration = rightEdge - displayStartTime;
      } else {
        // Right edge: anchor startTime + inPoint; grow/shrink duration + outPoint.
        let newDuration = Math.max(MIN_DURATION, s.originalDuration + deltaT);
        displayDuration = newDuration;
        displayOutPoint = s.originalInPoint + newDuration;
      }

      const next: ResizeState = {
        ...s,
        displayStartTime,
        displayDuration,
        displayInPoint,
        displayOutPoint,
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

  return { handleResizeStart, displayStartFor, displayDurationFor };
}

import { useCallback, useEffect, useRef, useState } from "react";
import type { Track, CompositionCommand } from "@pneuma-craft/timeline";
import type { Actor, CoreCommand } from "@pneuma-craft/core";
import {
  useComposition,
  usePlayback,
  usePneumaCraftStore,
} from "@pneuma-craft/react";
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
  /** Full asset duration in seconds. Infinity if unknown. Used as
   *  the upper bound for right-edge trim and for left-edge inPoint. */
  assetDuration: number;
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
  const coreState = usePneumaCraftStore((s) => s.coreState);
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
  const registryRef = useRef(coreState.registry);
  registryRef.current = coreState.registry;

  const handleResizeStart = useCallback(
    (clipId: string, edge: "left" | "right", mouseX: number) => {
      const clip = clipsRef.current.find((c) => c.id === clipId);
      if (!clip) return;
      // Look up the clip's asset metadata for the full duration.
      // Infinity means "unknown" → resize won't clamp by asset, only
      // by the current committed outPoint.
      const asset = registryRef.current.get(clip.assetId);
      const metaDuration =
        (asset?.metadata as { duration?: number } | undefined)?.duration;
      const assetDuration =
        typeof metaDuration === "number" && metaDuration > 0
          ? metaDuration
          : Infinity;
      const initial: ResizeState = {
        clipId,
        edge,
        startMouseX: mouseX,
        originalStartTime: clip.startTime,
        originalDuration: clip.duration,
        originalInPoint: clip.inPoint,
        originalOutPoint: clip.outPoint,
        assetDuration,
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

      // Policy: trim bounds are [0, asset duration]. Both edges can
      // pull back OUT to the full asset length if the clip was
      // previously trimmed — this matches Premiere/CapCut behaviour.
      // A fresh clip at 1:1 with its asset can't extend further.
      let displayStartTime = s.originalStartTime;
      let displayDuration = s.originalDuration;
      let displayInPoint = s.originalInPoint;
      let displayOutPoint = s.originalOutPoint;

      if (s.edge === "left") {
        // Anchor right edge: `rightEdge` stays fixed.
        // newInPoint ∈ [0, rightEdgeInAsset - MIN_DURATION]
        // where rightEdgeInAsset = originalInPoint + originalDuration
        //                        = originalOutPoint.
        const rightEdgeTimeline = s.originalStartTime + s.originalDuration;
        const newInPointCandidate = s.originalInPoint + deltaT;
        const maxInPoint = Math.max(0, s.originalOutPoint - MIN_DURATION);
        const clampedInPoint = Math.max(0, Math.min(maxInPoint, newInPointCandidate));
        const inShift = clampedInPoint - s.originalInPoint;
        displayInPoint = clampedInPoint;
        displayStartTime = s.originalStartTime + inShift;
        displayDuration = rightEdgeTimeline - displayStartTime;
      } else {
        // Right edge: anchor inPoint. newOutPoint ∈ [inPoint + MIN, assetDuration].
        const newOutPointCandidate = s.originalOutPoint + deltaT;
        const maxOutPoint = s.assetDuration;
        const minOutPoint = s.originalInPoint + MIN_DURATION;
        const clampedOutPoint = Math.max(
          minOutPoint,
          Math.min(maxOutPoint, newOutPointCandidate),
        );
        displayOutPoint = clampedOutPoint;
        displayDuration = clampedOutPoint - s.originalInPoint;
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
          const rightEdgeTimeline = s.originalStartTime + s.originalDuration;
          // Convert snap target back into an inPoint candidate then clamp.
          const shift = snap.time - s.originalStartTime;
          const inPointCandidate = s.originalInPoint + shift;
          const maxInPoint = Math.max(0, s.originalOutPoint - MIN_DURATION);
          const clampedInPoint = Math.max(0, Math.min(maxInPoint, inPointCandidate));
          const effectiveShift = clampedInPoint - s.originalInPoint;
          displayInPoint = clampedInPoint;
          displayStartTime = s.originalStartTime + effectiveShift;
          displayDuration = rightEdgeTimeline - displayStartTime;
          snapTime = snap.snappedTo;
        }
      } else {
        const endCandidate = displayStartTime + displayDuration;
        const snap = snapToNearest(endCandidate, points, threshold);
        if (snap.snappedTo !== null) {
          const outPointCandidate =
            s.originalInPoint + (snap.time - s.originalStartTime);
          const maxOutPoint = s.assetDuration;
          const minOutPoint = s.originalInPoint + MIN_DURATION;
          const clampedOutPoint = Math.max(
            minOutPoint,
            Math.min(maxOutPoint, outPointCandidate),
          );
          displayOutPoint = clampedOutPoint;
          displayDuration = clampedOutPoint - s.originalInPoint;
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

import { useCallback } from "react";
import { useComposition, usePlayback } from "@pneuma-craft/react";
import type { Clip } from "@pneuma-craft/timeline";
import { collectSnapPoints, snapToNearest } from "../snapPoints.js";

const SPLIT_SNAP_PX = 5;

/**
 * Helper used by each track's onMouseMove / onMouseEnter in split
 * tool mode. Takes the raw local cursor X within a clip, applies
 * magnetic snap (cross-track edges, playhead, t=0), and returns the
 * SNAPPED local X so the caller can:
 *   1. pass it to tool.setHover() — the dashed vertical guide line
 *      rendered by ClipToolOverlay will lock onto the snap target.
 *   2. seek the playback engine to the matching absolute time for
 *      the preview frame.
 *
 * If no point is within threshold, the original raw X is returned.
 */
export function useSplitHoverSnap() {
  const composition = useComposition();
  const playback = usePlayback();
  return useCallback(
    (clip: Clip, rawLocalPx: number, pixelsPerSecond: number): number => {
      if (pixelsPerSecond <= 0) return rawLocalPx;
      const absoluteTime = clip.startTime + rawLocalPx / pixelsPerSecond;
      const points = collectSnapPoints(
        composition,
        new Set([clip.id]),
        playback.currentTime,
      );
      const snap = snapToNearest(
        absoluteTime,
        points,
        SPLIT_SNAP_PX / pixelsPerSecond,
      );
      if (snap.snappedTo === null) return rawLocalPx;
      const snappedLocal = (snap.time - clip.startTime) * pixelsPerSecond;
      // Stay inside the clip's X range so the overlay guide never
      // overshoots the clip box.
      const maxLocal = clip.duration * pixelsPerSecond;
      return Math.max(0, Math.min(maxLocal, snappedLocal));
    },
    [composition, playback],
  );
}

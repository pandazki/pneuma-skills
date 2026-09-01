import type { Composition } from "@pneuma-craft/timeline";
import { collectSnapPoints, snapToNearest } from "./snapPoints.js";

/**
 * Same magnetic radius the clip drag / resize / split tool use, so the
 * playhead feels like the rest of the editor rather than the one cursor
 * that ignores geometry.
 */
export const PLAYHEAD_SNAP_PX = 5;

/** The playhead snaps to boundaries, never to a clip's identity. */
const NO_EXCLUDED_CLIPS: ReadonlySet<string> = new Set();

export interface PlayheadSnapResult {
  /** The time to seek to — the snap target, or the input unchanged. */
  time: number;
  /** The locked-onto boundary, or null when nothing was in range. */
  snappedTo: number | null;
}

/**
 * Magnetically pull a candidate playhead time onto the nearest clip
 * boundary (any track), or t=0, within `PLAYHEAD_SNAP_PX` on screen.
 *
 * `enabled: false` (Shift held) returns the raw time — the
 * Premiere / CapCut convention for "I really do mean this frame".
 *
 * NaN is passed as the playhead position on purpose: `collectSnapPoints`
 * only contributes a playhead point when the value is finite, and the
 * playhead must not snap to where it already is.
 */
export function snapPlayheadTime(
  composition: Composition | null,
  time: number,
  pixelsPerSecond: number,
  enabled: boolean,
): PlayheadSnapResult {
  if (!enabled || !(pixelsPerSecond > 0)) return { time, snappedTo: null };
  const points = collectSnapPoints(composition, NO_EXCLUDED_CLIPS, Number.NaN);
  return snapToNearest(time, points, PLAYHEAD_SNAP_PX / pixelsPerSecond);
}

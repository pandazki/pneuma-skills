import type { Composition } from "@pneuma-craft/timeline";

/**
 * A single candidate time that the drag / resize / split tool may
 * snap to. The `label` is opaque (used for debugging / tests) but
 * the time is what matters.
 */
export interface SnapPoint {
  time: number;
  label: string;
}

/**
 * Collect all the "interesting" times a user might want to snap to:
 * - composition start (t=0)
 * - the current playhead position
 * - every clip's startTime and endTime, across EVERY track except
 *   the one(s) excluded (typically the clip being dragged or
 *   resized so it doesn't snap to its own current edge)
 *
 * Cheap enough to recompute on every mousemove — O(total clip count).
 */
export function collectSnapPoints(
  composition: Composition | null,
  excludeClipIds: ReadonlySet<string>,
  playheadTime: number,
): SnapPoint[] {
  const points: SnapPoint[] = [{ time: 0, label: "start" }];
  if (Number.isFinite(playheadTime) && playheadTime >= 0) {
    points.push({ time: playheadTime, label: "playhead" });
  }
  if (!composition) return points;
  for (const track of composition.tracks) {
    for (const clip of track.clips) {
      if (excludeClipIds.has(clip.id)) continue;
      points.push({ time: clip.startTime, label: `${clip.id}:start` });
      points.push({ time: clip.startTime + clip.duration, label: `${clip.id}:end` });
    }
  }
  return points;
}

/**
 * Snap `candidate` to the nearest SnapPoint within `threshold` seconds.
 * Returns the adjusted time and which point it locked onto (or null if
 * no point was close enough). Ties break by first-found (stable, since
 * the list is ordered by collector insertion).
 */
export function snapToNearest(
  candidate: number,
  points: readonly SnapPoint[],
  threshold: number,
): { time: number; snappedTo: number | null } {
  let bestDelta = threshold;
  let best: SnapPoint | null = null;
  for (const p of points) {
    const d = Math.abs(candidate - p.time);
    if (d < bestDelta) {
      bestDelta = d;
      best = p;
    }
  }
  if (best === null) return { time: candidate, snappedTo: null };
  return { time: best.time, snappedTo: best.time };
}

/**
 * Snap a dragged clip's candidate startTime. The clip's start edge OR
 * end edge (whichever is closer) can lock onto a SnapPoint. Returns
 * the adjusted start and the snap line world-time for the UI guide.
 */
export function snapDraggedStartToPoints(
  candidateStart: number,
  draggedDuration: number,
  points: readonly SnapPoint[],
  threshold: number,
): { start: number; snapTime: number | null } {
  let start = Math.max(0, candidateStart);
  const end = start + draggedDuration;
  let snapTime: number | null = null;
  let bestDelta = threshold;

  for (const p of points) {
    const startDelta = Math.abs(start - p.time);
    if (startDelta < bestDelta) {
      bestDelta = startDelta;
      start = p.time;
      snapTime = p.time;
    }
    const endDelta = Math.abs(end - p.time);
    if (endDelta < bestDelta) {
      bestDelta = endDelta;
      start = p.time - draggedDuration;
      snapTime = p.time;
    }
  }

  return { start: Math.max(0, start), snapTime };
}

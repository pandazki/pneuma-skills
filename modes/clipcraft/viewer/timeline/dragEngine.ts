// Pure helpers for the timeline drag/snap/ripple engine.
//
// Copied verbatim from @pneuma-craft/react-ui/src/timeline/timeline-track.tsx
// (commit-pinned to whatever is current on pneuma-craft-headless-stable
// main). We deliberately do NOT import react-ui as a dep — the upstream
// component is coupled to its own CSS and store shape, and we only want
// the math. Keep the algorithm in sync by re-copying when upstream changes.

import type { Clip } from "@pneuma-craft/timeline";

export interface DragState {
  clipId: string;
  startMouseX: number;
  startClipTime: number;
  positions: Map<string, number>;
  snapTime: number | null;
}

/**
 * Compute preview positions for all clips when `draggedClipId` is placed
 * at `draggedNewStart`. The dragged clip's position is pinned; other clips
 * are pushed forward if they overlap with any earlier clip.
 *
 * Copied verbatim from react-ui.
 */
export function computeRipplePreview(
  clips: readonly Clip[],
  draggedClipId: string,
  draggedNewStart: number,
): Map<string, number> {
  const result = new Map<string, number>();
  const dragged = clips.find((c) => c.id === draggedClipId);
  if (!dragged) return result;

  result.set(draggedClipId, draggedNewStart);

  const others = clips
    .filter((c) => c.id !== draggedClipId)
    .map((c) => ({ id: c.id, start: c.startTime, duration: c.duration }))
    .sort((a, b) => a.start - b.start);

  const draggedEnd = draggedNewStart + dragged.duration;

  for (const c of others) {
    const cEnd = c.start + c.duration;
    if (c.start < draggedEnd && cEnd > draggedNewStart) {
      c.start = draggedEnd;
    }
    result.set(c.id, c.start);
  }

  const all = clips
    .map((c) => ({
      id: c.id,
      start: result.get(c.id)!,
      duration: c.duration,
      pinned: c.id === draggedClipId,
    }))
    .sort((a, b) => a.start - b.start);

  for (let i = 1; i < all.length; i++) {
    const prevEnd = all[i - 1].start + all[i - 1].duration;
    if (all[i].start < prevEnd) {
      if (all[i].pinned) continue;
      all[i].start = prevEnd;
      result.set(all[i].id, all[i].start);
    }
  }

  return result;
}

/**
 * Given a free-drag candidate `newStart`, snap it to the nearest neighbor
 * edge (or 0) within `snapThresholdSeconds`. Returns the adjusted start
 * and the world-time of the snap line (null if no snap fired).
 *
 * Copied verbatim from react-ui (inlined from the mousemove handler).
 */
export function snapDraggedStart(
  clips: readonly Clip[],
  draggedClipId: string,
  candidateStart: number,
  snapThresholdSeconds: number,
): { start: number; snapTime: number | null } {
  const dragged = clips.find((c) => c.id === draggedClipId);
  if (!dragged) return { start: candidateStart, snapTime: null };

  let newStart = Math.max(0, candidateStart);
  const newEnd = newStart + dragged.duration;
  let snappedTime: number | null = null;

  for (const c of clips) {
    if (c.id === draggedClipId) continue;
    if (Math.abs(newStart - c.startTime) < snapThresholdSeconds) {
      newStart = c.startTime;
      snappedTime = c.startTime;
      break;
    }
    if (Math.abs(newStart - (c.startTime + c.duration)) < snapThresholdSeconds) {
      newStart = c.startTime + c.duration;
      snappedTime = c.startTime + c.duration;
      break;
    }
    if (Math.abs(newEnd - c.startTime) < snapThresholdSeconds) {
      newStart = c.startTime - dragged.duration;
      snappedTime = c.startTime;
      break;
    }
    if (Math.abs(newEnd - (c.startTime + c.duration)) < snapThresholdSeconds) {
      newStart = c.startTime + c.duration - dragged.duration;
      snappedTime = c.startTime + c.duration;
      break;
    }
  }
  if (snappedTime === null && Math.abs(newStart) < snapThresholdSeconds) {
    newStart = 0;
    snappedTime = 0;
  }
  newStart = Math.max(0, newStart);
  return { start: newStart, snapTime: snappedTime };
}

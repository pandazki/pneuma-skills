import type { Track } from "@pneuma-craft/timeline";

type TrackKind = Track["type"];

// ─────────────────────────────────────────────────────────────────────────────
// ClipCraft track-layer policy
// ─────────────────────────────────────────────────────────────────────────────
//
// This is the mode's opinion on "where a new track should go". Craft
// itself is neutral — `composition:add-track` always appends to
// `tracks[]` and `tracks[]` data order is "later index = rendered on
// top". The Timeline renders reversed so visual top = stack top.
//
// ClipCraft's policy, from the top of the visual stack to the bottom:
//
//     subtitle   (top of stack, covers everything)
//     video      (middle, the main image bed)
//     audio      (bottom, no visible contribution to the stack)
//
// When the user adds a new track of kind K, we want it to become the
// TOP of K's group (just above existing tracks of the same kind in
// the visual stack). If no track of K exists yet, we insert it into
// the canonical audio < video < subtitle ordering so the layout
// doesn't grow in a random direction.
//
// All math is expressed in data indices (`tracks[]`). The Timeline's
// visual reversal is handled separately in Timeline.tsx; this helper
// doesn't care about visual order.

/** Data-order priority used when a kind has no existing tracks.
 *  Larger = higher in the stack, larger data index, visually higher. */
const PRIORITY: Record<TrackKind, number> = {
  audio: 0,
  video: 1,
  subtitle: 2,
};

/**
 * Compute the data-order `tracks[]` index where a new track of kind
 * `kind` should be inserted so it becomes the top of its kind group.
 *
 * Rules:
 * 1. If one or more tracks of `kind` already exist, insert just AFTER
 *    the last one in data order → the new track becomes the highest
 *    data index among its kind, which is the top of the kind's
 *    sub-stack, which is the visual top of the kind's group.
 * 2. Otherwise, insert at the position that preserves
 *    `audio < video < subtitle` in data order — specifically, just
 *    before the first existing track of higher priority.
 * 3. If no higher-priority tracks exist either, append at the end.
 */
export function computeTrackInsertIdx(
  tracks: readonly Track[],
  kind: TrackKind,
): number {
  // Rule 1 — scan from end to find the last track of the same kind.
  for (let i = tracks.length - 1; i >= 0; i--) {
    if (tracks[i].type === kind) return i + 1;
  }
  // Rule 2 — no existing track of this kind. Walk left-to-right and
  // insert before the first higher-priority track.
  const newPriority = PRIORITY[kind];
  for (let i = 0; i < tracks.length; i++) {
    if (PRIORITY[tracks[i].type] > newPriority) return i;
  }
  // Rule 3 — nothing higher; append.
  return tracks.length;
}

/** Build a semantic track id like `track-video-a8f2e` so the agent +
 *  the reader can eyeball the type at a glance. UUID suffix keeps
 *  collisions unlikely without making the id unreadable. */
export function generateTrackId(kind: TrackKind): string {
  const suffix = crypto.randomUUID().slice(0, 5);
  return `track-${kind}-${suffix}`;
}

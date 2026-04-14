import type { Composition, CompositionCommand } from "@pneuma-craft/timeline";

/**
 * Ripple-delete a clip: remove it, and shift every later clip in the
 * same track left by the removed clip's duration so the downstream
 * content closes up.
 *
 * Returns the command list in the order it must be dispatched:
 *   1. composition:remove-clip { clipId }
 *   2. composition:move-clip  { clipId: later.id, startTime: later.startTime - removed.duration }
 *
 * Caller dispatches each command through `dispatch("human", cmd)`.
 */
export function buildRippleDeleteCommands(
  composition: Composition,
  clipId: string,
): CompositionCommand[] {
  const track = composition.tracks.find((t) =>
    t.clips.some((c) => c.id === clipId),
  );
  if (!track) return [];
  const removed = track.clips.find((c) => c.id === clipId);
  if (!removed) return [];

  const out: CompositionCommand[] = [
    { type: "composition:remove-clip", clipId },
  ];

  const later = track.clips.filter((c) => c.startTime > removed.startTime);
  for (const c of later) {
    const newStart = Math.max(0, c.startTime - removed.duration);
    if (Math.abs(newStart - c.startTime) < 1e-6) continue;
    out.push({
      type: "composition:move-clip",
      clipId: c.id,
      startTime: newStart,
    });
  }
  return out;
}

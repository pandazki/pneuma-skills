import type { Composition, CompositionCommand } from "@pneuma-craft/timeline";

/**
 * For each track, walk clips in startTime order and emit move-clip
 * commands that re-pack them against 0 (first clip) and each previous
 * clip's end (subsequent). Skips no-op moves.
 *
 * Returns the command list; the caller is responsible for dispatching them
 * in order so craft's undo manager groups them as consecutive events.
 */
export function buildCollapseGapsCommands(
  composition: Composition,
): CompositionCommand[] {
  const out: CompositionCommand[] = [];
  for (const track of composition.tracks) {
    const sorted = [...track.clips].sort((a, b) => a.startTime - b.startTime);
    let cursor = 0;
    for (const clip of sorted) {
      if (Math.abs(clip.startTime - cursor) > 1e-6) {
        out.push({
          type: "composition:move-clip",
          clipId: clip.id,
          startTime: cursor,
        });
      }
      cursor += clip.duration;
    }
  }
  return out;
}

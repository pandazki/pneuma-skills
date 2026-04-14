// TEMP stub — fully implemented in Task 3.
import type { Track } from "@pneuma-craft/timeline";

export interface UseClipResize {
  handleResizeStart: (clipId: string, edge: "left" | "right", mouseX: number) => void;
  displayStartFor: (clipId: string) => number | null;
  displayDurationFor: (clipId: string) => number | null;
}

export function useClipResize(
  _track: Track,
  _pixelsPerSecond: number,
  _dispatch: unknown,
): UseClipResize {
  return {
    handleResizeStart: () => {},
    displayStartFor: () => null,
    displayDurationFor: () => null,
  };
}

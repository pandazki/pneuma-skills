import { useMemo } from "react";
import { useComposition, usePlayback } from "@pneuma-craft/react";
import type { Clip } from "@pneuma-craft/timeline";

export function useActiveSubtitle(): Clip | null {
  const composition = useComposition();
  const { currentTime } = usePlayback();
  return useMemo(() => {
    if (!composition) return null;
    for (const track of composition.tracks) {
      if (track.type !== "subtitle") continue;
      for (const clip of track.clips) {
        const end = clip.startTime + clip.duration;
        if (currentTime >= clip.startTime && currentTime < end) {
          return clip;
        }
      }
    }
    return null;
  }, [composition, currentTime]);
}

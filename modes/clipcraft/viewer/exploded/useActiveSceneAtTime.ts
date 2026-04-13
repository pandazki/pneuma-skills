import { useMemo } from "react";
import { useComposition } from "@pneuma-craft/react";
import type { Clip } from "@pneuma-craft/timeline";
import { useScenes } from "../scenes/SceneContext.js";
import { resolveScene } from "../scenes/useSceneResolver.js";
import type { ProjectScene } from "../../persistence.js";

/**
 * Returns the scene whose member-clip time envelope contains `globalTime`,
 * or null when no scene covers the playhead.
 *
 * Uses the pure `resolveScene` helper instead of `useSceneResolver` — the
 * resolver is a hook and cannot be called inside a loop, so we inline the
 * envelope computation over the flat clip list.
 */
export function useActiveSceneAtTime(globalTime: number): ProjectScene | null {
  const scenes = useScenes();
  const composition = useComposition();

  return useMemo(() => {
    const allClips: Clip[] = [];
    for (const track of composition?.tracks ?? []) {
      for (const clip of track.clips) allClips.push(clip);
    }
    for (const scene of scenes) {
      const env = resolveScene(scene, allClips);
      if (env.duration <= 0) continue;
      if (globalTime >= env.startTime && globalTime < env.startTime + env.duration) {
        return scene;
      }
    }
    return null;
  }, [scenes, composition, globalTime]);
}

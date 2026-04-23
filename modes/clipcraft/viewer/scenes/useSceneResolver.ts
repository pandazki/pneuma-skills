import { useMemo } from "react";
import { useComposition } from "@pneuma-craft/react";
import type { Clip } from "@pneuma-craft/timeline";
import { useScenes } from "./SceneContext.js";
import type { ProjectScene } from "../../persistence.js";

export interface ResolvedScene {
  scene: ProjectScene;
  clips: Clip[];
  memberAssetIds: string[];
  startTime: number;
  endTime: number;
  duration: number;
  missingClipIds: string[];
}

/**
 * Pure helper — resolves a scene against a flat clip list.
 * Exported so tests can exercise the logic without mounting a React tree.
 */
export function resolveScene(
  scene: ProjectScene,
  allClips: Clip[],
): ResolvedScene {
  const byId = new Map(allClips.map((c) => [c.id, c] as const));
  const foundClips: Clip[] = [];
  const missingClipIds: string[] = [];
  for (const id of scene.memberClipIds) {
    const c = byId.get(id);
    if (c) foundClips.push(c);
    else missingClipIds.push(id);
  }
  let startTime = Infinity;
  let endTime = 0;
  for (const clip of foundClips) {
    if (clip.startTime < startTime) startTime = clip.startTime;
    const end = clip.startTime + clip.duration;
    if (end > endTime) endTime = end;
  }
  if (!Number.isFinite(startTime)) startTime = 0;
  return {
    scene,
    clips: foundClips,
    memberAssetIds: [...scene.memberAssetIds],
    startTime,
    endTime,
    duration: Math.max(0, endTime - startTime),
    missingClipIds,
  };
}

/**
 * Resolve a scene id to its concrete clip set and time envelope.
 *
 * The envelope is inclusive of all referenced clips regardless of track —
 * a scene can span multiple tracks (e.g. a video clip and its subtitle).
 * When a scene references a clip that doesn't exist in the composition,
 * it is listed in `missingClipIds` and silently excluded from the envelope.
 * Callers can ignore `missingClipIds` in the happy path.
 */
export function useSceneResolver(sceneId: string | null): ResolvedScene | null {
  const composition = useComposition();
  const scenes = useScenes();

  return useMemo(() => {
    if (!sceneId) return null;
    const scene = scenes.find((s) => s.id === sceneId);
    if (!scene) return null;
    const allClips: Clip[] = [];
    for (const track of composition?.tracks ?? []) {
      for (const clip of track.clips) allClips.push(clip);
    }
    return resolveScene(scene, allClips);
  }, [sceneId, scenes, composition]);
}

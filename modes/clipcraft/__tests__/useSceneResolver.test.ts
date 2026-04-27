import { describe, expect, it } from "bun:test";
import type { Clip } from "@pneuma-craft/timeline";
import { resolveScene } from "../viewer/scenes/useSceneResolver.js";
import type { ProjectScene } from "../persistence.js";

const clip = (id: string, startTime: number, duration: number): Clip => ({
  id,
  assetId: `asset-${id}`,
  trackId: "track-1",
  startTime,
  duration,
  inPoint: 0,
  outPoint: duration,
}) as Clip;

describe("resolveScene", () => {
  const clips: Clip[] = [clip("a", 0, 5), clip("b", 5, 3), clip("c", 10, 2)];

  it("resolves member clips and computes envelope", () => {
    const scene: ProjectScene = {
      id: "s1",
      order: 0,
      title: "t",
      memberClipIds: ["a", "b"],
      memberAssetIds: ["asset-a", "asset-b"],
    };
    const r = resolveScene(scene, clips);
    expect(r.clips.map((c) => c.id)).toEqual(["a", "b"]);
    expect(r.startTime).toBe(0);
    expect(r.endTime).toBe(8);
    expect(r.duration).toBe(8);
    expect(r.missingClipIds).toEqual([]);
  });

  it("tracks missing clip ids without throwing", () => {
    const scene: ProjectScene = {
      id: "s2",
      order: 0,
      title: "t",
      memberClipIds: ["a", "ghost"],
      memberAssetIds: [],
    };
    const r = resolveScene(scene, clips);
    expect(r.missingClipIds).toEqual(["ghost"]);
    expect(r.clips.map((c) => c.id)).toEqual(["a"]);
    expect(r.endTime).toBe(5);
  });

  it("empty scene yields 0-duration envelope", () => {
    const scene: ProjectScene = {
      id: "s3",
      order: 0,
      title: "t",
      memberClipIds: [],
      memberAssetIds: [],
    };
    const r = resolveScene(scene, clips);
    expect(r.startTime).toBe(0);
    expect(r.endTime).toBe(0);
    expect(r.duration).toBe(0);
  });
});

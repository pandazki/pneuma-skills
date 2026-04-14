import { describe, test, expect } from "bun:test";
import type { Composition } from "@pneuma-craft/timeline";
import { buildRippleDeleteCommands } from "../rippleDelete.js";

function comp(
  clips: { id: string; startTime: number; duration: number }[],
): Composition {
  return {
    id: "c1",
    name: "test",
    duration: 100,
    tracks: [
      {
        id: "t1",
        type: "video",
        name: "v",
        clips: clips.map((c) => ({
          id: c.id,
          trackId: "t1",
          assetId: `a-${c.id}`,
          startTime: c.startTime,
          duration: c.duration,
          inPoint: 0,
          outPoint: c.duration,
        })),
        muted: false,
        locked: false,
        visible: true,
      },
    ],
    settings: { width: 1920, height: 1080, fps: 30, sampleRate: 48000, channels: 2 },
  } as unknown as Composition;
}

describe("buildRippleDeleteCommands", () => {
  test("removes the target and shifts all later clips left", () => {
    const c = comp([
      { id: "a", startTime: 0, duration: 2 },
      { id: "b", startTime: 2, duration: 3 },
      { id: "c", startTime: 5, duration: 1 },
    ]);
    const cmds = buildRippleDeleteCommands(c, "b");
    expect(cmds[0]).toMatchObject({ type: "composition:remove-clip", clipId: "b" });
    // clip c was at 5, shift left by b's duration 3 → 2
    expect(cmds[1]).toMatchObject({
      type: "composition:move-clip",
      clipId: "c",
      startTime: 2,
    });
    expect(cmds.length).toBe(2);
  });

  test("only emits remove-clip when there's nothing to shift", () => {
    const c = comp([
      { id: "a", startTime: 0, duration: 2 },
      { id: "b", startTime: 2, duration: 3 },
    ]);
    const cmds = buildRippleDeleteCommands(c, "b");
    expect(cmds.length).toBe(1);
    expect(cmds[0]).toMatchObject({ type: "composition:remove-clip", clipId: "b" });
  });

  test("returns empty when the clip id is unknown", () => {
    const c = comp([{ id: "a", startTime: 0, duration: 2 }]);
    expect(buildRippleDeleteCommands(c, "missing")).toEqual([]);
  });

  test("does not emit move-clip for earlier clips in the same track", () => {
    const c = comp([
      { id: "a", startTime: 0, duration: 2 },
      { id: "b", startTime: 5, duration: 1 },
    ]);
    const cmds = buildRippleDeleteCommands(c, "b");
    expect(cmds.length).toBe(1);
  });
});

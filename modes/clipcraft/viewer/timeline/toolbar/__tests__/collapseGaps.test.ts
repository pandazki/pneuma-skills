import { describe, test, expect } from "bun:test";
import type { Composition } from "@pneuma-craft/timeline";
import { buildCollapseGapsCommands } from "../collapseGaps.js";

function comp(clips: { id: string; startTime: number; duration: number }[]): Composition {
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
    settings: {
      width: 1920,
      height: 1080,
      fps: 30,
      sampleRate: 48000,
      channels: 2,
    },
  } as unknown as Composition;
}

describe("buildCollapseGapsCommands", () => {
  test("packs clips with gaps against each other", () => {
    const c = comp([
      { id: "a", startTime: 0, duration: 2 },
      { id: "b", startTime: 5, duration: 3 },
      { id: "c", startTime: 10, duration: 1 },
    ]);
    const cmds = buildCollapseGapsCommands(c);
    expect(cmds.length).toBe(2);
    expect(cmds[0]).toMatchObject({ type: "composition:move-clip", clipId: "b", startTime: 2 });
    expect(cmds[1]).toMatchObject({ type: "composition:move-clip", clipId: "c", startTime: 5 });
  });

  test("emits no commands when clips are already packed", () => {
    const c = comp([
      { id: "a", startTime: 0, duration: 2 },
      { id: "b", startTime: 2, duration: 3 },
    ]);
    const cmds = buildCollapseGapsCommands(c);
    expect(cmds.length).toBe(0);
  });

  test("handles an empty track without emitting commands", () => {
    const c = comp([]);
    expect(buildCollapseGapsCommands(c).length).toBe(0);
  });
});

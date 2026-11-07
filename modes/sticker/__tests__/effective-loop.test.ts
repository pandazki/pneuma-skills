/**
 * The loop that ships: a take's frames as the exporter keeps them
 * (`sticker-media.mjs::exportSticker` → `keptIndices(count, keepFrames)`,
 * each kept frame at its recorded delay). Every place the viewer plays a
 * sticker plays this loop, so the user never watches a jump the exports cut.
 */

import { describe, expect, test } from "bun:test";

import { effectiveLoop } from "../viewer/view-model.js";

describe("effectiveLoop", () => {
  test("without keepFrames: every frame, at its recorded delay", () => {
    expect(effectiveLoop(null, 4, [120, 120, 80, 200], 100)).toEqual({ order: [0, 1, 2, 3], delays: [120, 120, 80, 200], trimmed: false, outOfRange: null });
  });

  test("keepFrames: only the kept frames, in order, each at its own recorded delay", () => {
    const delays = Array.from({ length: 16 }, (_, i) => 100 + i);
    expect(effectiveLoop([7, 8, 9, 10, 11, 12, 13, 14, 15], 16, delays, 120)).toEqual({
      order: [7, 8, 9, 10, 11, 12, 13, 14, 15],
      delays: [107, 108, 109, 110, 111, 112, 113, 114, 115],
      trimmed: true,
      outOfRange: null,
    });
  });

  test("delays that do not match the frame count are not trusted: the pack's frame time is", () => {
    expect(effectiveLoop([1, 2], 4, [120, 120], 90)).toEqual({ order: [1, 2], delays: [90, 90], trimmed: true, outOfRange: null });
    expect(effectiveLoop(null, 2, null, 90).delays).toEqual([90, 90]);
  });

  test("a kept frame the take does not have: the whole take plays, and the frame is named", () => {
    // The exporter refuses this take (keptIndices throws); showing a
    // trimmed guess would be a loop that never ships.
    expect(effectiveLoop([10, 14, 20], 16, null, 120)).toEqual({
      order: Array.from({ length: 16 }, (_, i) => i),
      delays: Array(16).fill(120),
      trimmed: false,
      outOfRange: 20,
    });
  });
});

/**
 * gif-frames.mjs — the frame-count rule `set-gif` lands a GIF take by and
 * `from-gif` cuts it by. The end-to-end agreement (both commands, a stubbed
 * ffprobe) is in gif-source.test.ts behind the media tier; this pins the
 * rule itself in the routine run.
 */

import { describe, expect, test } from "bun:test";

import { gifDelaysFromProbe } from "../skill/scripts/gif-frames.mjs";

describe("gifDelaysFromProbe", () => {
  test("every packet is a frame: an unreadable or zero delay takes the median and is named", () => {
    expect(gifDelaysFromProbe("0.090000\nN/A\n0.090000,\n0.000000\n0.120000\n")).toEqual({
      delaysMs: [90, 90, 90, 90, 120],
      unreadable: [1, 3],
      fallbackMs: 90,
    });
  });

  test("blank lines are not frames; no packets is no frames", () => {
    expect(gifDelaysFromProbe("\n0.1\n\n0.1\n").delaysMs).toEqual([100, 100]);
    expect(gifDelaysFromProbe("")).toEqual({ delaysMs: [], unreadable: [], fallbackMs: null });
  });

  test("a GIF with no readable delay at all is refused rather than given made-up times", () => {
    expect(() => gifDelaysFromProbe("N/A\nN/A\n")).toThrow("no frame delay");
  });
});

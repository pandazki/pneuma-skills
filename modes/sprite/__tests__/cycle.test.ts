/**
 * cycle.mjs — the repetition analysis `contact` and `loop` read (ported from
 * aldegad/sprite-gen), pinned as a module on synthetic feature sequences.
 *
 * Each "frame" here is a short feature vector rather than a picture: the
 * analysis only ever sees `D`, the mean absolute difference of two vectors,
 * so a few components chosen per case make every property exact — a period,
 * a half period that repeats as well, a drift, an action that leaves and
 * returns. The same behaviours on real ffmpeg clips are pinned in
 * `sprite-sheet.test.ts` ("contact" and "loop").
 */

import { describe, expect, test } from "bun:test";

import {
  GAIT_FLOORS, SEAM_FLOOR, detectCycle, detectOneShots, distanceMatrix, frameDistance, frameMass,
  periodicityFloor, premultiplied, rankWindows, seamCloses, seamLimit, thumbSize,
} from "../skill/scripts/cycle.mjs";

const FPS = 24;
/** The window `contact` uses: 0.4–2.5 s, with half a second of context. */
const windowFor = (n: number) => ({
  minLen: Math.ceil(0.4 * FPS),
  maxLen: Math.min(Math.floor(2.5 * FPS), n - Math.max(8, Math.ceil(FPS / 2))),
});

const sequence = (n: number, frame: (i: number) => number[]) =>
  Array.from({ length: n }, (_, i) => Float32Array.from(frame(i)));

/** A deterministic stand-in for noise: the classic shader hash, 0..1. */
const hash = (i: number) => {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

const analyse = (frames: Float32Array[], gait: "walk" | "run" | null = null) => {
  const n = frames.length;
  return detectCycle(distanceMatrix(frames), n, { ...windowFor(n), gait, fps: FPS });
};

describe("cycle.mjs — the measure", () => {
  test("premultiplied colour: a transparent pixel is nothing, whatever it carries", () => {
    const features = premultiplied(Uint8Array.from([255, 0, 0, 0, 255, 255, 255, 255, 200, 100, 0, 128]));
    expect([...features.slice(0, 4)]).toEqual([0, 0, 0, 0]);
    expect([...features.slice(4, 8)]).toEqual([1, 1, 1, 1]);
    expect(features[8]).toBeCloseTo((200 / 255) * (128 / 255), 6);
    expect(features[11]).toBeCloseTo(128 / 255, 6);
    expect(frameMass(features)).toBeGreaterThan(0);
  });

  test("D is the mean absolute difference, and the matrix is symmetric", () => {
    const a = Float32Array.from([0, 0.5, 1, 1]);
    const b = Float32Array.from([1, 0.5, 0, 1]);
    expect(frameDistance(a, b)).toBeCloseTo(0.5, 6);
    const D = distanceMatrix([a, b, a]);
    expect(D[0 * 3 + 1]).toBeCloseTo(0.5, 6);
    expect(D[1 * 3 + 0]).toBeCloseTo(0.5, 6);
    expect(D[0 * 3 + 2]).toBe(0);
  });

  test("thumbnails fit the longest edge in 96 px and never enlarge", () => {
    expect(thumbSize(640, 640)).toEqual({ width: 96, height: 96 });
    expect(thumbSize(588, 716)).toEqual({ width: 79, height: 96 });
    expect(thumbSize(64, 64)).toEqual({ width: 64, height: 64 });
  });
});

describe("cycle.mjs — does a wrap close?", () => {
  test("two steps, or the noise floor when that is larger", () => {
    expect(SEAM_FLOOR).toBe(0.005);
    expect(seamLimit(0)).toBe(0.005);
    expect(seamLimit(0.0004)).toBe(0.005);
    expect(seamLimit(0.004)).toBeCloseTo(0.008, 9);
    expect(seamLimit(Number.NaN)).toBe(0.005);
    // tanka's idle, measured: a wrap of 0.0021 against a step of 0.0004 is
    // five steps — and re-render noise, so it closes.
    expect(seamCloses(0.0021, 0.0004)).toBe(true);
    // A blink at the wrap of a still loop does not.
    expect(seamCloses(0.0205, 0)).toBe(false);
    expect(seamCloses(0.009, 0.004)).toBe(false);
  });
});

describe("cycle.mjs — is there a cycle?", () => {
  test("an exact repeat is the shortest dip, and is not called ambiguous", () => {
    // Every multiple of the period dips to 0; the shortest is the period, and
    // a near-exact repeat is not a half stride.
    const frames = sequence(96, (i) => [0.5 + 0.4 * Math.sin((2 * Math.PI * i) / 12), 0.5 + 0.4 * Math.cos((2 * Math.PI * i) / 12)]);
    const cycle = analyse(frames);
    expect(cycle.verdict).toBe("periodic");
    expect(cycle.period).toBe(12);
    expect(cycle.periodicity).toBeGreaterThan(0.9);
    expect(cycle.ambiguous).toBeNull();
    expect(cycle.windows.length).toBeGreaterThan(0);
    for (const w of cycle.windows) expect([11, 12, 13]).toContain(w.length);
  });

  test("near and far legs differing only in colour: the outline halves the stride, colour does not", () => {
    // Two legs swinging in antiphase over a 24-frame stride. As positions
    // alone (sorted, so which leg is which is lost — an outline) the picture
    // repeats every step; as colours (leg A, leg B) only every stride.
    const legA = (i: number) => 0.5 + 0.3 * Math.sin((2 * Math.PI * i) / 24);
    const legB = (i: number) => 0.5 - 0.3 * Math.sin((2 * Math.PI * i) / 24);
    const outline = sequence(96, (i) => [Math.min(legA(i), legB(i)), Math.max(legA(i), legB(i))]);
    const colour = sequence(96, (i) => [legA(i), legB(i)]);
    expect(analyse(outline).period).toBe(12);
    const cycle = analyse(colour);
    expect(cycle.verdict).toBe("periodic");
    expect(cycle.period).toBe(24);
    expect(cycle.ambiguous).toBeNull();
  });

  describe("half a stride", () => {
    // Legs that read alike (the step repeats) plus something that never
    // repeats (a fly, texture): both P and 2P are real, inexact, comparable.
    const walker = (n: number) => sequence(n, (i) => [
      0.5 + 0.3 * Math.abs(Math.sin((2 * Math.PI * i) / 24)),
      0.5 + 0.3 * Math.abs(Math.cos((2 * Math.PI * i) / 24)),
      0.3 * hash(i),
    ]);

    test("without a gait, the short period stays first and both lengths are named", () => {
      const cycle = analyse(walker(96));
      expect(cycle.verdict).toBe("periodic");
      expect(cycle.period).toBe(12);
      expect(cycle.ambiguous).not.toBeNull();
      expect(cycle.ambiguous!.short).toBe(12);
      expect(cycle.ambiguous!.long).toBe(24);
      expect(cycle.ambiguous!.depthRatio!).toBeLessThanOrEqual(1.25);
      // The alternative length is on the table, not only the short one.
      const lengths = cycle.windows.map((w) => w.length);
      expect(lengths.some((l) => Math.abs(l - 12) <= 1)).toBe(true);
      expect(lengths.some((l) => Math.abs(l - 24) <= 1)).toBe(true);
    });

    test("--gait walk: a period under the floor is one step, so the stride is taken", () => {
      expect(Math.round(GAIT_FLOORS.walk * FPS)).toBeGreaterThan(12);
      const cycle = analyse(walker(96), "walk");
      expect(cycle.verdict).toBe("periodic");
      expect(cycle.period).toBe(24);
      expect(cycle.guard).toMatchObject({ applied: true, from: 12, to: 24 });
    });

    test("--gait walk on a clip that holds only a step: no cycle, half a stride", () => {
      // 30 frames: room to see the 12-frame step repeat, none to see 24.
      const cycle = analyse(walker(30), "walk");
      expect(cycle.verdict).toBe("none");
      expect(cycle.reason).toBe("half-stride");
      expect(cycle.guard).toMatchObject({ applied: false, below: 12 });
      expect(cycle.windows).toEqual([]);
    });
  });

  test("frames that drift steadily apart have no cycle — not the window floor", () => {
    // sprite-gen falls back to the whole window here and returns its floor.
    const frames = sequence(96, (i) => [i / 96, 1 - i / 96]);
    const cycle = analyse(frames);
    expect(cycle.verdict).toBe("none");
    expect(cycle.reason).toBe("no-dip");
    expect(cycle.windows).toEqual([]);
  });

  test("a dip that barely stands out of the noise is a flat profile", () => {
    // Texture noise over many values, the way a thumbnail averages it, and a
    // periodic component far too small to call the clip a cycle.
    const frames = sequence(96, (i) => [
      0.5 + 0.02 * Math.sin((2 * Math.PI * i) / 12),
      ...Array.from({ length: 256 }, (_, k) => hash(i * 257 + k)),
    ]);
    const cycle = analyse(frames);
    expect(cycle.verdict).toBe("none");
    expect(cycle.reason).toBe("flat");
    // The dip is found (within a frame of it), and then refused as too shallow.
    expect([11, 12, 13]).toContain(cycle.period!);
    expect(cycle.periodicity!).toBeLessThan(cycle.periodicityMin!);
    expect(cycle.windows).toEqual([]);
  });

  test("less than a whole second period to compare against asks for a deeper dip", () => {
    expect(periodicityFloor(96, 24)).toBeCloseTo(0.15, 9);
    expect(periodicityFloor(40, 30)).toBeCloseTo(0.15 + 0.85 * (1 - 10 / 30), 9);
    expect(periodicityFloor(30, 30)).toBeCloseTo(1, 9);
  });

  test("a held pose repeats perfectly and is never offered as a cut", () => {
    // 48 frames of a held pose, then a 12-frame cycle.
    const frames = sequence(120, (i) => (i < 48
      ? [0.5, 0.9]
      : [0.5 + 0.4 * Math.sin((2 * Math.PI * (i - 48)) / 12), 0.5 + 0.4 * Math.cos((2 * Math.PI * (i - 48)) / 12)]));
    const n = frames.length;
    const D = distanceMatrix(frames);
    const adjacent = Array.from({ length: n - 1 }, (_, i) => D[i * n + i + 1]);
    const moving = [...adjacent].sort((a, b) => a - b)[Math.floor(adjacent.length / 2)];
    const ranked = rankWindows(D, n, { lengths: [12], adjacent, minStep: 0.25 * moving });
    expect(ranked.length).toBeGreaterThan(0);
    for (const w of ranked) expect(w.start + w.length).toBeGreaterThan(48);
    expect(ranked[0].start).toBeGreaterThanOrEqual(40);
  });
});

describe("cycle.mjs — one performed action", () => {
  /** Rest with a little texture noise, and a smooth departure and return. */
  const clip = (actions: [number, number][], n: number) => sequence(n, (i) => {
    let lift = 0;
    for (const [from, to] of actions) {
      if (i >= from && i <= to) lift = Math.sin((Math.PI * (i - from)) / (to - from));
    }
    return [0.2 + 0.6 * lift, 0.5, 0.01 * hash(i)];
  });
  const shots = (frames: Float32Array[]) =>
    detectOneShots(distanceMatrix(frames), frames.length, frames.map(frameMass));

  test("rest → action → rest is found, with rest observed on both sides", () => {
    const found = shots(clip([[30, 54]], 96));
    expect(found).toHaveLength(1);
    const [shot] = found;
    expect(shot.start).toBeLessThan(30);
    expect(shot.end).toBeGreaterThan(54);
    expect(shot.excursion[0]).toBeGreaterThanOrEqual(30);
    expect(shot.excursion[1]).toBeLessThanOrEqual(54);
    expect(shot.excursion[0] - shot.start).toBeGreaterThanOrEqual(2);
    expect(shot.end - shot.excursion[1]).toBeGreaterThanOrEqual(2);
    expect(shot.peak).toBeGreaterThanOrEqual(40);
    expect(shot.peak).toBeLessThanOrEqual(44);
  });

  test("the strike performed twice in a 4 s clip comes back as two windows", () => {
    const found = shots(clip([[12, 34], [56, 78]], 96)).sort((a, b) => a.start - b.start);
    expect(found).toHaveLength(2);
    expect(found[0].end).toBeLessThanOrEqual(found[1].start);
    expect(found[0].excursion[1]).toBeLessThanOrEqual(34);
    expect(found[1].excursion[0]).toBeGreaterThanOrEqual(56);
  });

  test("an action cut off by the clip's first frame is not padded into one", () => {
    expect(shots(clip([[-10, 20]], 96))).toEqual([]);
  });

  test("a clip that never leaves its rest pose has none", () => {
    expect(shots(clip([], 96))).toEqual([]);
  });
});

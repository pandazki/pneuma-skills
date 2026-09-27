/**
 * The three zero-dependency modules behind alignment and framing, pinned as
 * modules: `drift.mjs` (trend / body alignment and the head-band drift),
 * `frame-steps.mjs` (near-duplicates and row-boundary jumps) and `canvas.mjs`
 * (the room a motion needs around its still).
 *
 * No ffmpeg: every image here is an RGBA buffer drawn in memory, so this file
 * runs everywhere the routine suite does. The CLI halves (`align --x-from
 * trend|body`, `inspect`, `flatten --room`, `from-video --body-height`) are
 * pinned end to end in `sprite-sheet-alignment.test.ts`.
 *
 * The drift and canvas cases reuse aldegad/sprite-gen's own fixtures and
 * expected numbers (tests/video/test_body_anchor.py,
 * test_gait_guard_anchor_wide.py) — the ports were checked against the
 * upstream Python on those inputs, value for value, before these were written.
 */

import { describe, expect, test } from "bun:test";

import {
  bodyWrapOffset,
  headOffsets,
  headProfile,
  massCenterX,
  rampShifts,
  roundHalfEven,
  swayAboutTrend,
  trendReference,
  type Box,
  type RgbaImage,
} from "../skill/scripts/drift.mjs";
import { DUPLICATE_STEP, judgeSteps, stepThumb, thumbDiff } from "../skill/scripts/frame-steps.mjs";
import { roomCanvas } from "../skill/scripts/canvas.mjs";

// ── In-memory drawing ───────────────────────────────────────────────────────

function blank(width: number, height: number): RgbaImage {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

function fill(image: RgbaImage, x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number]) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (x < 0 || x >= image.width || y < 0 || y >= image.height) continue;
      image.data.set([...rgb, 255], (y * image.width + x) * 4);
    }
  }
}

function bboxOf(image: RgbaImage, threshold = 16): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (image.data[(y * image.width + x) * 4 + 3] < threshold) continue;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
  }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** This pipeline's foot line: mean x (pixel centres) of the bottom 10 % of the box. */
function feetX(image: RgbaImage, box: Box): number {
  const band = Math.max(1, Math.round(box.h * 0.1));
  let sum = 0, n = 0;
  for (let y = box.y + box.h - band; y < box.y + box.h; y++) {
    for (let x = box.x; x < box.x + box.w; x++) {
      if (image.data[(y * image.width + x) * 4 + 3] < 16) continue;
      sum += x + 0.5; n++;
    }
  }
  return sum / n;
}

/** Upstream's `_walker`: a head and torso at column x, one leg at x + leg. */
function upstreamWalker(x: number, leg: number): RgbaImage {
  const image = blank(160, 160);
  fill(image, x + 10, 20, x + 30, 40, [200, 120, 60]);
  fill(image, x, 40, x + 40, 110, [60, 90, 200]);
  fill(image, x + leg, 110, x + leg + 10, 150, [30, 30, 30]);
  return image;
}

const upstreamCycle = (drift: number, n = 12) =>
  Array.from({ length: n }, (_, k) => upstreamWalker(40 + roundHalfEven((drift * k) / n), (k * 3) % 30));

/**
 * Upstream's `_lifting_walker`: a body that only drifts while its legs take
 * turns — each half period one leg stands on the floor and the other is
 * lifted clear of the lowest rows, so the floor band's x jumps from foot to
 * foot every step though the body never moves.
 */
function liftingWalker(n: number, driftPerFrame = 0, period = 12): Array<{ image: RgbaImage; bodyX: number }> {
  return Array.from({ length: n }, (_, t) => {
    const image = blank(220, 64);
    const cx = 60 + t * driftPerFrame;
    fill(image, roundHalfEven(cx) - 6, 10, roundHalfEven(cx) + 6, 40, [200, 60, 60]);
    const stride = roundHalfEven(14 * Math.sin((2 * Math.PI * t) / period));
    for (const sign of [1, -1]) {
      const legX = roundHalfEven(cx + sign * stride);
      const lifted = sign * stride < 0;
      fill(image, legX - 3, 40, legX + 3, lifted ? 50 : 58, [60, 60, 200]);
    }
    return { image, bodyX: roundHalfEven(cx) };
  });
}

/** Shift a copy of `image` right by dx (zero-filled). */
function shifted(image: RgbaImage, dx: number): RgbaImage {
  const out = blank(image.width, image.height);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const sx = x - dx;
      if (sx < 0 || sx >= image.width) continue;
      const from = (y * image.width + sx) * 4;
      out.data.set(image.data.subarray(from, from + 4), (y * image.width + x) * 4);
    }
  }
  return out;
}

const range = (values: number[]) => Math.max(...values) - Math.min(...values);

// ── drift.mjs ───────────────────────────────────────────────────────────────

describe("drift.mjs", () => {
  test("rounds half to even, like the Python it was ported from", () => {
    expect([0.5, 1.5, 2.5, -0.5, -1.5, 4.5, 4.51, 3.49].map(roundHalfEven)).toEqual([0, 2, 2, 0, -2, 4, 5, 3]);
  });

  describe("body: one wrap measurement, spread as a ramp", () => {
    test("reads the body, not the leg (upstream: -6 or -5 for a 6 px drift)", () => {
      // The leg alone moved 33 px between the first and the last frame; the
      // body moved 5-6. Upstream's Python returns -6 on this fixture.
      const frames = upstreamCycle(6);
      expect(bodyWrapOffset(frames[0], frames[frames.length - 1], { threshold: 8 })).toBe(-6);
    });

    test("matches upstream's offsets and ramps value for value", () => {
      // Measured with the upstream Python on the same drawings, 2026-09-27.
      const upstream: Record<number, { dx: number; ramp: number[] }> = {
        0: { dx: 0, ramp: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
        6: { dx: -6, ramp: [0, 0, -1, -2, -2, -2, -3, -4, -4, -4, -5, -6] },
        [-9]: { dx: 8, ramp: [0, 1, 1, 2, 3, 3, 4, 5, 5, 6, 7, 7] },
        17: { dx: -16, ramp: [0, -1, -3, -4, -5, -7, -8, -9, -11, -12, -13, -15] },
      };
      for (const [drift, want] of Object.entries(upstream)) {
        const frames = upstreamCycle(Number(drift));
        const dx = bodyWrapOffset(frames[0], frames[frames.length - 1], { threshold: 8 });
        expect({ drift, dx, ramp: rampShifts(frames.length, dx) }).toEqual({ drift, dx: want.dx, ramp: want.ramp });
      }
    });

    test("after the ramp the last frame's body sits over the first's", () => {
      const frames = upstreamCycle(6);
      const dx = bodyWrapOffset(frames[0], frames[frames.length - 1], { threshold: 8 });
      const shifts = rampShifts(frames.length, dx);
      const ramped = frames.map((f, k) => shifted(f, shifts[k]));
      expect(shifts[0]).toBe(0);
      expect(Math.abs(bodyWrapOffset(ramped[0], ramped[ramped.length - 1], { threshold: 8 }))).toBeLessThanOrEqual(1);
    });

    test("a single frame or a zero offset ramps nothing", () => {
      expect(rampShifts(1, 12)).toEqual([0]);
      expect(rampShifts(4, 0)).toEqual([0, 0, 0, 0]);
    });
  });

  describe("trend: remove the straight drift, keep the step", () => {
    const place = (walker: ReturnType<typeof liftingWalker>, refs: Array<number | null>) =>
      walker.map((w, i) => w.bodyX - refs[i]!);

    test("a body that stands still does not lurch — and a per-frame foot pin does", () => {
      const walker = liftingWalker(24);
      const boxes = walker.map((w) => bboxOf(w.image));
      const feet = walker.map((w, i) => feetX(w.image, boxes[i]));
      const fit = trendReference(feet, walker.map((w, i) => massCenterX(w.image, boxes[i], 16)));
      // Where the body lands once each frame's reference is on one point.
      expect(range(place(walker, fit.ref))).toBeLessThanOrEqual(1.5);
      expect(fit.driftPx).toBeLessThanOrEqual(2); // nothing moved, nothing removed
      expect(fit.footSwayPx).toBeGreaterThanOrEqual(10); // the planted foot does move — reported, kept
      // The pin upstream retired: the body lurches by about the stride (the
      // planted foot sits 0-14 px ahead of the hip here).
      expect(range(place(walker, feet))).toBeGreaterThanOrEqual(12);
    });

    test("removes a drift and keeps the step", () => {
      const walker = liftingWalker(24, 1.5);
      const boxes = walker.map((w) => bboxOf(w.image));
      const fit = trendReference(
        walker.map((w, i) => feetX(w.image, boxes[i])),
        walker.map((w, i) => massCenterX(w.image, boxes[i], 16)),
      );
      expect(range(place(walker, fit.ref))).toBeLessThanOrEqual(1.5);
      expect(fit.driftPx).toBeGreaterThanOrEqual(30); // 23 frames × 1.5 px of authored drift
      expect(fit.driftPx).toBeLessThanOrEqual(40);
    });

    test("an empty frame gets no reference and does not bend the line", () => {
      const fit = trendReference([10, null, 14, 16], [10, null, 14, 16]);
      expect(fit.ref[1]).toBeNull();
      expect(fit.slope).toBeCloseTo(2, 9);
      expect(fit.ref.filter((r) => r !== null).map((r) => Math.round(r! * 1000) / 1000)).toEqual([10, 14, 16]);
    });
  });

  describe("head offsets: the drift no alignment pins", () => {
    test("follow a head and torso that move, whatever the legs do", () => {
      const moves = [0, 3, -5, 12, 7];
      const frames = moves.map((dx, k) => upstreamWalker(40 + dx, (k * 11) % 30));
      const profiles = frames.map((f) => headProfile(f, bboxOf(f), { threshold: 16 }));
      const offsets = headOffsets(profiles, 160);
      offsets.forEach((offset, k) => expect({ k, offset: Math.round(offset!) }).toEqual({ k, offset: moves[k] }));
    });

    test("an empty frame has no offset, and the first drawn frame is the reference", () => {
      const a = upstreamWalker(40, 0);
      const profiles = [null, headProfile(a, bboxOf(a), { threshold: 16 }), headProfile(shifted(a, 4), bboxOf(shifted(a, 4)), { threshold: 16 })];
      const offsets = headOffsets(profiles, 160);
      expect(offsets[0]).toBeNull();
      expect(offsets[1]).toBe(0);
      expect(Math.round(offsets[2]!)).toBe(4);
    });

    test("sway about the trend takes the straight drift out and nothing else", () => {
      expect(swayAboutTrend([0, 2, 4, 6, 8])).toBeCloseTo(0, 9);
      // 0, 0, 8, 6 about their line: residuals 0.4, −2.2, 3.2, −1.4 → √4.3
      expect(swayAboutTrend([0, 0, 8, 6])).toBeCloseTo(Math.sqrt(4.3), 9);
      expect(swayAboutTrend([3, null, 3])).toBe(0);
      expect(swayAboutTrend([5])).toBe(0);
    });
  });
});

// ── frame-steps.mjs ─────────────────────────────────────────────────────────

describe("frame-steps.mjs", () => {
  test("the same frame is a step of 0, a one-pixel nudge is not", () => {
    const a = upstreamWalker(40, 0);
    expect(thumbDiff(stepThumb(a), stepThumb(a))).toBe(0);
    const nudged = thumbDiff(stepThumb(a), stepThumb(shifted(a, 1)));
    expect(nudged).toBeGreaterThan(0);
    expect(nudged).toBeLessThan(0.05);
  });

  test("a transparent pixel's leftover colour counts for nothing", () => {
    const a = upstreamWalker(40, 0);
    const b = upstreamWalker(40, 0);
    // Paint colour under alpha 0 — what a colorkey leaves behind.
    for (let i = 0; i < b.data.length; i += 4) if (b.data[i + 3] === 0) b.data.set([0, 255, 0, 0], i);
    expect(thumbDiff(stepThumb(a), stepThumb(b))).toBe(0);
  });

  test("a frame smaller than the thumbnail is upsampled, not dropped", () => {
    const small = blank(20, 10);
    fill(small, 0, 0, 20, 10, [255, 255, 255]);
    const thumb = stepThumb(small);
    expect(Math.round(thumb[3])).toBe(255);
    expect(Math.round(thumb[thumb.length - 1])).toBe(255);
  });

  // The Lumi idle 4×4 the seed ships, as `inspect` measures it (2026-09-27):
  // smooth inside each row, jumping where rows 1→2 and 2→3 hand over.
  const LUMI_IDLE = [0.0146, 0.0139, 0.008, 0.0511, 0.0159, 0.0102, 0.0099, 0.0411,
    0.0122, 0.0092, 0.0084, 0.0184, 0.0102, 0.0092, 0.008];
  const LUMI_IDLE_WRAP = 0.0147;
  // The Lumi attack 4×4: windup, overhead, strike, recovery, one row each.
  const LUMI_ATTACK = [0.0721, 0.0553, 0.0328, 0.0948, 0.0703, 0.0693, 0.0432, 0.1017,
    0.0297, 0.0873, 0.0949, 0.1399, 0.0435, 0.0517, 0.041];

  const pairs = (list: Array<{ from: number; to: number }>) => list.map((p) => [p.from, p.to]);

  test("Lumi idle: two row boundaries jump, the holds are near-duplicates", () => {
    const judged = judgeSteps(LUMI_IDLE, { wrap: LUMI_IDLE_WRAP, cols: 4, count: 16 });
    expect(pairs(judged.rowJumps)).toEqual([[3, 4], [7, 8]]);
    expect(pairs(judged.nearDuplicates)).toEqual([[2, 3], [6, 7], [9, 10], [10, 11], [13, 14], [14, 15]]);
    expect(judged.inRowMedian).toBeCloseTo(0.01005, 5);
  });

  test("Lumi attack: phase-per-row boundaries are not jumps", () => {
    const judged = judgeSteps(LUMI_ATTACK, { wrap: null, cols: 4, count: 16 });
    expect(judged.rowJumps).toEqual([]);
    expect(judged.nearDuplicates).toEqual([]);
  });

  test("without a grid, or with rows too short to be sequences, no boundary is judged", () => {
    expect(judgeSteps(LUMI_IDLE, { wrap: LUMI_IDLE_WRAP, cols: null, count: 16 }).rowJumps).toEqual([]);
    expect(judgeSteps([0.01, 0.2, 0.01], { cols: 2, count: 4 }).rowJumps).toEqual([]);
  });

  test("the wrap of a looping sheet is a row boundary too", () => {
    const steps = [0.02, 0.02, 0.2, 0.02, 0.02];
    const judged = judgeSteps(steps, { wrap: 0.2, cols: 3, count: 6 });
    expect(pairs(judged.rowJumps)).toEqual([[2, 3], [5, 0]]);
  });

  test("a boundary nobody could see is not a jump, however large the ratio", () => {
    const steps = [0.001, 0.001, 0.008, 0.001, 0.001];
    const judged = judgeSteps(steps, { cols: 3, count: 6 });
    expect(judged.rowJumps).toEqual([]);
    expect(judged.nearDuplicates.length).toBe(5);
  });

  test("a pair with an empty frame has no step and is never a duplicate", () => {
    const judged = judgeSteps([null, 0.0001], { count: 3 });
    expect(pairs(judged.nearDuplicates)).toEqual([[1, 2]]);
    expect(DUPLICATE_STEP).toBe(0.01);
  });
});

// ── canvas.mjs ──────────────────────────────────────────────────────────────

describe("canvas.mjs", () => {
  // Upstream `pad_canvas` on blank stills of these sizes, 2026-09-27 (168 of
  // 168 cases identical; these are a representative handful).
  const UPSTREAM = [
    { still: [416, 506], room: "square", canvas: [506, 506], offset: [45, 0] },
    { still: [416, 506], room: "tall", canvas: [575, 767], offset: [79, 261] },
    { still: [416, 506], room: "wide", canvas: [1383, 778], offset: [277, 272] },
    { still: [416, 506], room: "wide", facing: "left", canvas: [1383, 778], offset: [690, 272] },
    { still: [500, 300], room: "tall", canvas: [500, 667], offset: [0, 367] },
    { still: [101, 77], room: "wide", headroom: 0, lead: 0.3, trail: 0, canvas: [144, 81], offset: [0, 4] },
    { still: [333, 999], room: "wide", headroom: 0.2, lead: 0.1, trail: 0.1, canvas: [2220, 1249], offset: [222, 250] },
  ] as const;

  test("places the still exactly where upstream's pad_canvas does", () => {
    for (const c of UPSTREAM) {
      const got = roomCanvas(
        { width: c.still[0], height: c.still[1] },
        {
          room: c.room,
          facing: "facing" in c ? c.facing : "right",
          headroom: "headroom" in c ? c.headroom : undefined,
          lead: "lead" in c ? c.lead : undefined,
          trail: "trail" in c ? c.trail : undefined,
        },
      );
      expect({ c, canvas: [got.canvas.width, got.canvas.height], offset: [got.offset.x, got.offset.y] })
        .toEqual({ c, canvas: [...c.canvas], offset: [...c.offset] });
    }
  });

  test("never scales the still, and stands it on the bottom edge", () => {
    for (const room of ["square", "tall", "wide"] as const) {
      const got = roomCanvas({ width: 272, height: 262 }, { room });
      expect(got.canvas.width).toBeGreaterThanOrEqual(272);
      expect(got.canvas.height).toBeGreaterThanOrEqual(262);
      expect(got.offset.y + 262).toBe(got.canvas.height);
      expect(got.offset.x + 272).toBeLessThanOrEqual(got.canvas.width);
    }
  });

  test("the room in front follows the facing: a left-facer's trail is on the right", () => {
    const right = roomCanvas({ width: 272, height: 262 }, { room: "wide", facing: "right" });
    const left = roomCanvas({ width: 272, height: 262 }, { room: "wide", facing: "left" });
    expect(right.offset.x).toBe(Math.round(right.canvas.width * 0.2)); // 20 % behind, on the left
    expect(left.canvas.width - left.offset.x - 272).toBe(right.offset.x); // …mirrored
  });

  test("refuses fractions that cannot make a canvas", () => {
    expect(() => roomCanvas({ width: 10, height: 10 }, { room: "tall", headroom: 0.9 })).toThrow("[0, 0.9)");
    expect(() => roomCanvas({ width: 10, height: 10 }, { room: "wide", lead: 0.5, trail: 0.4 })).toThrow("below 0.9");
    expect(() => roomCanvas({ width: 10, height: 10 }, { room: "wide", lead: -0.1 })).toThrow("[0, 0.9)");
    // @ts-expect-error — a shape the module does not know
    expect(() => roomCanvas({ width: 10, height: 10 }, { room: "round" })).toThrow("room: expected");
    // @ts-expect-error — a facing the module does not know
    expect(() => roomCanvas({ width: 10, height: 10 }, { room: "wide", facing: "front" })).toThrow("facing: expected left or right, got 'front'");
    // @ts-expect-error — nor a missing one passed explicitly
    expect(() => roomCanvas({ width: 10, height: 10 }, { room: "square", facing: null })).toThrow("facing: expected");
  });
});

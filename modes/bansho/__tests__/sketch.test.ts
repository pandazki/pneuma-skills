/**
 * Hand-drawn sketch geometry (T3) — determinism + shape contracts.
 *
 * The sketch layer generates SINGLE drawable paths (one `M`, drivable by
 * dashoffset or clip) with seeded pseudo-random jitter. Determinism is a
 * product requirement, not a nicety: `Math.random()` would make lines jump
 * on every scrub-back (the prototype pinned mulberry32 for exactly this).
 */

import { describe, expect, test } from "bun:test";

import {
  highlighterShape,
  jitterEllipse,
  jitterLine,
  mulberry32,
  sketchPath,
} from "../engine/sketch/index.js";

/** Parse every coordinate pair out of a path string (M/Q/L arguments). */
function pathPoints(d: string): Array<[number, number]> {
  const nums = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  const pts: Array<[number, number]> = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i]!, nums[i + 1]!]);
  return pts;
}

describe("mulberry32 — seeded pseudo-random (determinism)", () => {
  test("same seed → identical sequence; different seed → different", () => {
    const a = mulberry32(0x5eed);
    const b = mulberry32(0x5eed);
    const c = mulberry32(0x5eee);
    const seqA = Array.from({ length: 32 }, () => a());
    const seqB = Array.from({ length: 32 }, () => b());
    const seqC = Array.from({ length: 32 }, () => c());
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual(seqC);
  });

  test("output stays in [0, 1)", () => {
    const rnd = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const v = rnd();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("sketchPath — point list → single quadratic-bezier path", () => {
  const pts: Array<[number, number]> = [
    [0, 0],
    [50, 10],
    [100, 0],
  ];

  test("single subpath: one M, then only Q commands (dashoffset-drivable)", () => {
    const d = sketchPath(pts, mulberry32(1), 1.5);
    expect(d.match(/M/g)).toHaveLength(1);
    expect(d.startsWith("M ")).toBe(true);
    expect(d.match(/Q/g)).toHaveLength(pts.length - 1);
    expect(d).not.toMatch(/[CLAZz]/); // no other command sneaks in
  });

  test("deterministic for a given seed", () => {
    expect(sketchPath(pts, mulberry32(7), 1.5)).toBe(
      sketchPath(pts, mulberry32(7), 1.5),
    );
    expect(sketchPath(pts, mulberry32(7), 1.5)).not.toBe(
      sketchPath(pts, mulberry32(8), 1.5),
    );
  });

  test("passes through every input point (jitter rides the CONTROL points)", () => {
    const d = sketchPath(pts, mulberry32(3), 2);
    const got = pathPoints(d);
    // M point + per-Q (control, end): end points are the input points.
    expect(got[0]).toEqual([0, 0]);
    expect(got[2]).toEqual([50, 10]);
    expect(got[4]).toEqual([100, 0]);
  });
});

describe("jitterLine — segmented line with edge-damped endpoint jitter", () => {
  test("endpoints stay near the requested line ends (edge factor 0.3)", () => {
    const amp = 1.5;
    const d = jitterLine(0, 0, 200, 0, mulberry32(11), amp);
    const got = pathPoints(d);
    const first = got[0]!;
    const last = got[got.length - 1]!;
    // Edge jitter is amp * 2 * 0.3 max on each axis.
    expect(Math.abs(first[0] - 0)).toBeLessThanOrEqual(amp * 0.6 + 1e-9);
    expect(Math.abs(first[1] - 0)).toBeLessThanOrEqual(amp * 0.6 + 1e-9);
    expect(Math.abs(last[0] - 200)).toBeLessThanOrEqual(amp * 0.6 + 1e-9);
    expect(Math.abs(last[1] - 0)).toBeLessThanOrEqual(amp * 0.6 + 1e-9);
  });

  test("segment density grows with length (~1 per 46px, min 2)", () => {
    const short = jitterLine(0, 0, 10, 0, mulberry32(1), 1);
    const long = jitterLine(0, 0, 460, 0, mulberry32(1), 1);
    expect(short.match(/Q/g)!.length).toBe(2);
    expect(long.match(/Q/g)!.length).toBe(10);
  });
});

describe("jitterEllipse — polar sampling with radius wobble + overlap close", () => {
  test("stays a bounded single stroke around the center", () => {
    const rx = 60;
    const ry = 16;
    const d = jitterEllipse(100, 50, rx, ry, mulberry32(5), 2.4);
    expect(d.match(/M/g)).toHaveLength(1);
    for (const [x, y] of pathPoints(d)) {
      // radius wobble ±5% + point jitter ±amp/2 + control jitter margin
      expect(Math.abs(x - 100)).toBeLessThanOrEqual(rx * 1.05 + 2.4 * 2);
      expect(Math.abs(y - 50)).toBeLessThanOrEqual(ry * 1.05 + 2.4 * 2);
    }
  });

  test("overlaps its own start (n+2 samples close the loop like a real pen)", () => {
    const d = jitterEllipse(0, 0, 30, 10, mulberry32(9), 2);
    // 16 segments + 2 overlap suffix → 18 quadratic segments after M.
    expect(d.match(/Q/g)!.length).toBe(18);
  });
});

describe("highlighterShape — a FILLED shape, not a uniform stroke (G8-I)", () => {
  const h = 26;
  const d = highlighterShape(0, 200, 50, h, mulberry32(0xb005));

  test("closed single-subpath fill outline (ends with Z, one M)", () => {
    expect(d.trim().endsWith("Z")).toBe(true);
    expect(d.match(/M/g)).toHaveLength(1);
  });

  test("envelope: narrow entry → full belly → tapered exit (正弦包络 ^0.34)", () => {
    const thicknessNear = (targetX: number): number => {
      const ys = pathPoints(d)
        .filter(([x]) => Math.abs(x - targetX) < 12)
        .map(([, y]) => y);
      return Math.max(...ys) - Math.min(...ys);
    };
    const entry = thicknessNear(0);
    const belly = thicknessNear(100);
    const exit = thicknessNear(200);
    expect(belly).toBeGreaterThan(entry);
    expect(belly).toBeGreaterThan(exit);
    // The belly approaches (but never exceeds) the ink budget around h.
    expect(belly).toBeGreaterThan(h * 0.6);
  });

  test("total vertical extent stays within the ink height budget (G8-G feeds h)", () => {
    const ys = pathPoints(d).map(([, y]) => y);
    const extent = Math.max(...ys) - Math.min(...ys);
    // belly ≈ 0.92h plus lift/tilt/edge wobble — bounded well under 1.5h.
    expect(extent).toBeLessThan(h * 1.5);
  });

  test("deterministic per seed", () => {
    expect(highlighterShape(0, 200, 50, h, mulberry32(1))).toBe(
      highlighterShape(0, 200, 50, h, mulberry32(1)),
    );
  });
});

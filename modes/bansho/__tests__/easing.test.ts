/**
 * G9 easing character table + G8-H strict monotonicity (T3).
 *
 * Every pen has its own speed personality (linear progress reads as fake),
 * and every easing MUST be strictly monotonically increasing — otherwise
 * scrubbing backwards makes the pen un-draw incorrectly. The prototype
 * validated monotonicity with 150-point sampling; the review bar keeps that
 * density and requires ALL SIX pens covered.
 */

import { describe, expect, test } from "bun:test";

import { Ease } from "../engine/easing.js";

const SAMPLES = 150;

/** All six pens of the G9 table — the complete set, none skipped. */
const PENS = [
  "write", // 写字 1-(1-p)^1.75
  "swipe", // 荧光笔 1-(1-p)^2.9
  "circle", // 圈 ease-in-out quadratic
  "strike", // 划掉 1-(1-p)^3.4
  "steady", // 立骨架 first 14% covers 6%, then ^0.88
  "trace", // 数据曲线 5 segments, each 1-(1-f)^1.9
] as const;

describe("G9 — easing character table", () => {
  test("the table has exactly the six prototype pens", () => {
    expect(Object.keys(Ease).sort()).toEqual([...PENS].sort());
  });

  for (const pen of PENS) {
    test(`${pen}: strictly monotonically increasing over ${SAMPLES} samples (G8-H)`, () => {
      const e = Ease[pen];
      let prev = e(0);
      for (let i = 1; i <= SAMPLES; i++) {
        const p = i / SAMPLES;
        const v = e(p);
        expect(v).toBeGreaterThan(prev);
        prev = v;
      }
    });

    test(`${pen}: maps 0 → 0 and 1 → 1 exactly`, () => {
      const e = Ease[pen];
      expect(e(0)).toBe(0);
      expect(e(1)).toBe(1);
      // Interior stays inside (0, 1) — clip/dashoffset math depends on it.
      for (const p of [0.01, 0.25, 0.5, 0.75, 0.99]) {
        const v = e(p);
        expect(v).toBeGreaterThan(0);
        expect(v).toBeLessThan(1);
      }
    });
  }

  test("write: pen lands moving (fast start, slow finish)", () => {
    // 1-(1-p)^1.75 — early progress outruns linear, late progress lags.
    expect(Ease.write(0.2)).toBeGreaterThan(0.2);
    expect(Ease.write(0.5)).toBeGreaterThan(0.5);
  });

  test("swipe outruns write early (唰一下)", () => {
    expect(Ease.swipe(0.2)).toBeGreaterThan(Ease.write(0.2));
  });

  test("strike is the most violent of the sweep pens", () => {
    expect(Ease.strike(0.2)).toBeGreaterThan(Ease.swipe(0.2));
  });

  test("circle: slow start, fastest mid, slow close (ease-in-out quadratic)", () => {
    expect(Ease.circle(0.1)).toBeLessThan(0.1);
    expect(Ease.circle(0.5)).toBeCloseTo(0.5, 10);
    expect(Ease.circle(0.9)).toBeGreaterThan(0.9);
  });

  test("steady: the first 14% of time covers exactly 6% of the line (落笔先顿)", () => {
    expect(Ease.steady(0.14)).toBeCloseTo(0.06, 10);
    expect(Ease.steady(0.07)).toBeCloseTo(0.03, 10);
  });

  test("steady: continuous across the 14% pause boundary", () => {
    const eps = 1e-6;
    expect(Ease.steady(0.14 + eps) - Ease.steady(0.14 - eps)).toBeLessThan(1e-3);
  });

  test("trace: 5 segments, each segment boundary lands on i/5 (手跟着数字爬)", () => {
    for (let i = 0; i <= 5; i++) {
      expect(Ease.trace(i / 5)).toBeCloseTo(i / 5, 10);
    }
    // Within a segment the hand surges ahead (each 1-(1-f)^1.9 is convex-up).
    expect(Ease.trace(0.1)).toBeGreaterThan(0.1);
    expect(Ease.trace(0.3)).toBeGreaterThan(0.3);
  });

  test("trace: dense sampling stays strictly monotone across segment seams", () => {
    let prev = Ease.trace(0);
    for (let i = 1; i <= 600; i++) {
      const v = Ease.trace(i / 600);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });
});

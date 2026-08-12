/**
 * G9 — the pen-character easing table (prototype-measured, T3).
 *
 * Layering (G2): engine core — zero imports, no DOM, no clock.
 *
 * Every pen has its own speed personality; linear progress reads as fake
 * ("过于线性、没有手写的不匀速和顿挫"). HARD CONSTRAINT (G8-H): every
 * function here is STRICTLY monotonically increasing on [0, 1] — otherwise
 * scrubbing backwards makes the picture run in reverse incorrectly. The
 * automated 150-sample monotonicity assertion in `__tests__/easing.test.ts`
 * covers all six pens; extend it before adding a seventh.
 */

/** A pen easing: strictly monotone [0,1] → [0,1], 0 ↦ 0, 1 ↦ 1. */
export type Easing = (p: number) => number;

export const Ease = {
  /** 写字 — the pen lands already moving, eases out at the stroke's end. */
  write: (p: number): number => 1 - Math.pow(1 - p, 1.75),

  /** 荧光笔 — one fast sweep with a flicked tail. */
  swipe: (p: number): number => 1 - Math.pow(1 - p, 2.9),

  /** 圈 — slow wind-up, fastest mid-arc, slow close (ease-in-out quad). */
  circle: (p: number): number =>
    p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2,

  /** 划掉 — hard, fast, in one go. */
  strike: (p: number): number => 1 - Math.pow(1 - p, 3.4),

  /** 立骨架 — the pen hesitates first (14% of time covers 6%), then pulls
   *  through to the end (`^0.88`). */
  steady: (p: number): number =>
    p < 0.14 ? (p / 0.14) * 0.06 : 0.06 + Math.pow((p - 0.14) / 0.86, 0.88) * 0.94,

  /** 数据曲线 — the hand climbs with the numbers: five segments, each with
   *  its own `1-(1-f)^1.9` surge (the 顿挫 lives at the seams). */
  trace: (p: number): number => {
    const SEGS = 5;
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    const s = p * SEGS;
    const i = Math.floor(s);
    const f = s - i;
    return (i + (1 - Math.pow(1 - f, 1.9))) / SEGS;
  },
} as const satisfies Record<string, Easing>;

export type PenName = keyof typeof Ease;

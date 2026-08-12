/**
 * 瑕疵 (W3) — the imperfection layer. The last piece of 极致的手写感.
 *
 * The product owner's requirement, §5.3: 「除了流程，我觉得影响真实感的，是瑕疵。
 * 例如粉笔随机周边的点击，没有那么干净的黑板。书写区域的四边形随机旋转和形变
 * （我们写字有时也会斜）。这些程度都可以配置，调成 0 就是干干净净的状态。」
 *
 * Layering (G2): engine core — the only import is the sibling PRNG, which
 * is the point: this reuses `sketch/`'s seeding rather than minting a
 * second determinism story. Same content, same marks, every reload and
 * every export; `Math.random()` is as banned here as it is there (an
 * unseeded tilt would make the whole board twitch on every scrub-back, and
 * it would break video export and every screenshot gate at once).
 *
 * THE ARCHITECTURAL RULE THIS MODULE EXISTS TO KEEP: everything here is
 * PAINT-TIME. It produces numbers that only ever reach CSS `transform` and
 * `opacity` — never a width, never a height, never a margin. A rotated box
 * occupies its unrotated slot, so a block that leans costs nothing in
 * `naturalDuration`, nothing in wrap decisions, nothing in the reconcile
 * hash, and the layout baseline stays byte-identical with the knob ON.
 * That is not a convenience: it is what makes the feature safe to ship on
 * a fold whose canonical values are load-bearing for timing and R8.
 *
 * The knob (`--bansho-flaw`, a content set's own `theme.css` token) is a
 * MULTIPLIER over the amplitudes below: 0 is a perfectly clean board (and
 * the host then emits no transform at all — structural absence, not
 * `rotate(0deg)`), 1 is the tuned default, 3 is the exaggerated look used
 * to see what the knob is actually doing.
 */

import { mulberry32, type Rand } from "./sketch/index.js";

/**
 * Amplitudes at knob = 1, in degrees / px.
 *
 * TUNED BY EYE, at the scale the reader actually looks at (see
 * harness/screenshots/w3-flaw/). The first draft was 1.7x smaller and it
 * failed the only test that matters: on a four-board wall pulled back to
 * z = 0.4 — a real reading pose, not a stress case — a 0.34deg lean is
 * simply not there, and the board still read as typeset. These numbers are
 * that draft scaled until the wall reads as written by a person AND a
 * single board at z = 1 still reads as tidy. Above roughly 2x this the
 * board stops looking like a person and starts looking like a bug, which
 * is what the 3 leg of the comparison is for.
 *
 * The ratios are the design: the block carries about half a degree of lean
 * and a hair less shear, sits two or three px off where the ruler put it,
 * and each word inside it drifts about two px off the line. Neighbours may
 * kiss slightly at the extremes; on a real board they do.
 */
export const FLAW_AMP = {
  /** Per-block rotation — 我们写字有时也会斜. */
  blockRotate: 0.58,
  /** Per-block shear — the 四边形形变 half of the same sentence. */
  blockSkew: 0.44,
  /** Per-block placement slop: a hand does not start on the margin twice. */
  blockShiftX: 2.7,
  blockShiftY: 1.9,
  /** Per-word baseline drift — a hand does not track a ruler. */
  wordDrift: 2.1,
  /** Per-word rotation. Deliberately small: words are short levers. */
  wordRotate: 0.94,
} as const;

/** The largest knob the host will honour — past this it is not a board. */
export const FLAW_MAX = 6;

/** Clamp an authored `--bansho-flaw` to the honoured range; NaN reads 0. */
export function clampFlaw(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value > FLAW_MAX ? FLAW_MAX : value;
}

/** How one written block sits on the board, relative to where it was laid. */
export interface BlockFlaw {
  /** deg */ rotate: number;
  /** deg */ skewX: number;
  /** px */ shiftX: number;
  /** px */ shiftY: number;
}

/** How one word sits on its line. */
export interface WordFlaw {
  /** px */ drift: number;
  /** deg */ rotate: number;
}

/** Symmetric draw in [-amp, amp], quantised so the stamped string is
 *  byte-stable across runs (a CSS number is compared as text downstream). */
const swing = (rnd: Rand, amp: number): number =>
  Math.round((rnd() * 2 - 1) * amp * 1000) / 1000;

/**
 * One block's imperfection, from its CONTENT seed (`contentSeed(step)`) —
 * never from its position. A streaming append mints fresh Step objects at
 * shifted offsets (§7 R1/R4); identical content must keep byte-identical
 * lean or every line already on the board visibly twitches on each append.
 * The same trade `contentSeed` documents applies: two identical blocks
 * lean identically, which is invisible at this amplitude.
 */
export function blockFlaw(seed: number, knob: number): BlockFlaw {
  const k = clampFlaw(knob);
  if (k === 0) return ZERO_BLOCK;
  // A stream of its own, offset from the seed the ink already spends, so a
  // block's lean and its underline's wobble are not the same draw twice.
  const rnd = mulberry32((seed ^ 0x5f3a7c11) >>> 0);
  return {
    rotate: swing(rnd, FLAW_AMP.blockRotate * k),
    skewX: swing(rnd, FLAW_AMP.blockSkew * k),
    shiftX: swing(rnd, FLAW_AMP.blockShiftX * k),
    shiftY: swing(rnd, FLAW_AMP.blockShiftY * k),
  };
}

/**
 * A fresh per-word stream for one block. The caller walks its own words in
 * DOM order and pulls one `wordFlaw` each, so a word's drift depends on
 * the block's content and on the word's place in it — and on nothing else,
 * which is what keeps a re-mount identical.
 */
export function wordStream(seed: number): Rand {
  return mulberry32((seed ^ 0x27d4eb2f) >>> 0);
}

/** The next word's drift off this block's stream. */
export function wordFlaw(rnd: Rand, knob: number): WordFlaw {
  const k = clampFlaw(knob);
  if (k === 0) return ZERO_WORD;
  return {
    drift: swing(rnd, FLAW_AMP.wordDrift * k),
    rotate: swing(rnd, FLAW_AMP.wordRotate * k),
  };
}

const ZERO_BLOCK: BlockFlaw = Object.freeze({
  rotate: 0,
  skewX: 0,
  shiftX: 0,
  shiftY: 0,
});
const ZERO_WORD: WordFlaw = Object.freeze({ drift: 0, rotate: 0 });

/**
 * The custom properties the stylesheet's ONE transform rule reads. Written
 * as properties rather than as a finished `transform` string on purpose:
 * the rule is gated by a single attribute on the board surface, so lifting
 * the whole layer for a measurement is one DOM write instead of N, and a
 * stale property on a reused node is inert the moment the gate is off.
 */
export const FLAW_VARS = {
  rotate: "--bansho-flaw-rot",
  skewX: "--bansho-flaw-skew",
  shiftX: "--bansho-flaw-dx",
  shiftY: "--bansho-flaw-dy",
  wordDrift: "--bansho-flaw-wy",
  wordRotate: "--bansho-flaw-wr",
} as const;

/** The gate: `data-bansho-flawed` on `.bansho-board-surface`. */
export const FLAW_FLAG = "banshoFlawed";
/** The knob a content set's `theme.css` owns. */
export const FLAW_KNOB_PROP = "--bansho-flaw";

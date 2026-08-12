/**
 * 瑕疵 (W3) — the imperfection layer's teeth.
 *
 * Two properties carry the whole feature and both are pinned here:
 *
 *   1. **0 is inert, and inert by CONSTRUCTION.** Not "produces zeros" —
 *      the stylesheet gates every rule behind `data-bansho-flawed`, which
 *      the host only ever sets above zero, so a clean board carries no
 *      transform at all. A `rotate(0deg)` would still mint a stacking
 *      context and a containing block, and "provably inert" has to mean
 *      the property is absent.
 *   2. **Everything is paint-time, so the layer must be liftable in one
 *      write.** `withFlawSuspended` is what lets the funnel measure a dead
 *      flat board; without it a lean inflates every box's measured height
 *      and the fold grows the board (V1.5's parallax bug, second edition).
 *
 * The byte-level proof that canonical layout does not move lives in
 * harness/layout-baseline/README.md (the W3 section) — it needs a browser.
 * These are the arithmetic and the structural guards.
 */

import { describe, expect, test } from "bun:test";
import {
  blockFlaw,
  clampFlaw,
  FLAW_AMP,
  FLAW_FLAG,
  FLAW_MAX,
  FLAW_VARS,
  wordFlaw,
  wordStream,
} from "../engine/flaw.js";
import { boardRects, withFlawSuspended } from "../viewer/stage-measure.js";
import { BOARD_BASE_CSS } from "../viewer/board-css.js";

const SEED = 0x9e3779b9;

describe("clampFlaw — an authored token is never trusted", () => {
  test("0, negatives and NaN all read as a perfectly clean board", () => {
    expect(clampFlaw(0)).toBe(0);
    expect(clampFlaw(-3)).toBe(0);
    expect(clampFlaw(Number.NaN)).toBe(0);
    // getPropertyValue on an undeclared custom property returns "", and
    // parseFloat("") is NaN — the commonest way this arrives.
    expect(clampFlaw(Number.parseFloat(""))).toBe(0);
  });

  test("an absurd knob is capped rather than honoured", () => {
    expect(clampFlaw(999)).toBe(FLAW_MAX);
    expect(clampFlaw(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("knob 0 draws nothing", () => {
  test("every block and word component is exactly zero", () => {
    const b = blockFlaw(SEED, 0);
    expect([b.rotate, b.skewX, b.shiftX, b.shiftY]).toEqual([0, 0, 0, 0]);
    const w = wordFlaw(wordStream(SEED), 0);
    expect([w.drift, w.rotate]).toEqual([0, 0]);
  });
});

describe("content-seeded, never random", () => {
  test("the same seed and knob reproduce byte-identical numbers", () => {
    expect(blockFlaw(SEED, 1)).toEqual(blockFlaw(SEED, 1));
    const a = wordStream(SEED);
    const b = wordStream(SEED);
    for (let i = 0; i < 8; i++) {
      expect(wordFlaw(a, 1)).toEqual(wordFlaw(b, 1));
    }
  });

  test("different content leans differently", () => {
    expect(blockFlaw(SEED, 1)).not.toEqual(blockFlaw(SEED + 1, 1));
  });

  test("a word's drift depends on its place in its block", () => {
    const rnd = wordStream(SEED);
    const first = wordFlaw(rnd, 1);
    const second = wordFlaw(rnd, 1);
    expect(first).not.toEqual(second);
  });

  test("the block stream and the word stream are not the same draw twice", () => {
    const block = blockFlaw(SEED, 1);
    const word = wordFlaw(wordStream(SEED), 1);
    expect(word.drift).not.toBe(block.shiftY);
  });
});

describe("the knob is a multiplier, and it bounds the amplitude", () => {
  test("no component ever exceeds its amplitude x knob", () => {
    for (const knob of [0.25, 1, 2, 3, FLAW_MAX]) {
      for (let seed = 0; seed < 400; seed++) {
        const b = blockFlaw(seed * 2654435761, knob);
        expect(Math.abs(b.rotate)).toBeLessThanOrEqual(
          FLAW_AMP.blockRotate * knob,
        );
        expect(Math.abs(b.skewX)).toBeLessThanOrEqual(FLAW_AMP.blockSkew * knob);
        expect(Math.abs(b.shiftX)).toBeLessThanOrEqual(
          FLAW_AMP.blockShiftX * knob,
        );
        expect(Math.abs(b.shiftY)).toBeLessThanOrEqual(
          FLAW_AMP.blockShiftY * knob,
        );
      }
      const rnd = wordStream(SEED);
      for (let i = 0; i < 400; i++) {
        const w = wordFlaw(rnd, knob);
        expect(Math.abs(w.drift)).toBeLessThanOrEqual(FLAW_AMP.wordDrift * knob);
        expect(Math.abs(w.rotate)).toBeLessThanOrEqual(
          FLAW_AMP.wordRotate * knob,
        );
      }
    }
  });

  test("a bigger knob leans the SAME block further, in the same direction", () => {
    const one = blockFlaw(SEED, 1);
    const three = blockFlaw(SEED, 3);
    expect(Math.sign(three.rotate)).toBe(Math.sign(one.rotate));
    expect(Math.abs(three.rotate)).toBeCloseTo(Math.abs(one.rotate) * 3, 2);
  });

  test("a knob past the cap behaves exactly like the cap", () => {
    expect(blockFlaw(SEED, 99)).toEqual(blockFlaw(SEED, FLAW_MAX));
  });
});

describe("withFlawSuspended — the layer lifts in ONE write", () => {
  const surface = (): { dataset: Record<string, string | undefined> } => ({
    dataset: { [FLAW_FLAG]: "" },
  });

  test("the gate is gone during the read and back afterwards", () => {
    const s = surface();
    const seen = withFlawSuspended(s, () => s.dataset[FLAW_FLAG]);
    expect(seen).toBeUndefined();
    expect(s.dataset[FLAW_FLAG]).toBe("");
  });

  test("a throwing read must not leave the board stuck clean", () => {
    const s = surface();
    expect(() =>
      withFlawSuspended(s, () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(s.dataset[FLAW_FLAG]).toBe("");
  });

  test("a clean board (or no surface at all) is a no-op", () => {
    const clean: { dataset: Record<string, string | undefined> } = {
      dataset: {},
    };
    expect(withFlawSuspended(clean, () => 7)).toBe(7);
    expect(clean.dataset[FLAW_FLAG]).toBeUndefined();
    expect(withFlawSuspended(null, () => 7)).toBe(7);
    expect(withFlawSuspended(undefined, () => 7)).toBe(7);
  });

  test("boardRects lifts the layer for the WHOLE batch, not per rect", () => {
    const s = surface();
    const gateSeen: Array<string | undefined> = [];
    const reader = (
      left: number,
      top: number,
    ): { getBoundingClientRect: () => DOMRectLike } => ({
      getBoundingClientRect: () => {
        gateSeen.push(s.dataset[FLAW_FLAG]);
        return {
          left,
          top,
          right: left + 10,
          bottom: top + 10,
          width: 10,
          height: 10,
        };
      },
    });
    const base = { ...reader(0, 0), offsetWidth: 10 };
    boardRects(base, [reader(5, 5), reader(20, 20)], null, s);
    // base + both targets, every one of them read with the layer down.
    expect(gateSeen).toEqual([undefined, undefined, undefined]);
    expect(s.dataset[FLAW_FLAG]).toBe("");
  });
});

interface DOMRectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

describe("the stylesheet keeps 0 inert BY CONSTRUCTION", () => {
  /**
   * The whole "clean must be byte-identical to today" promise rests on
   * this: at knob 0 the host never sets the gate, so if every rule that
   * can move or tint a pixel is behind the gate, a clean board provably
   * renders as it did before this feature existed. A rule that escaped the
   * gate would move ink at knob 0 and no unit test elsewhere would see it.
   */
  const RULE_START = /^\.bansho[^\s{]*/gm;

  test("every rule mentioning a flaw variable is gated on data-bansho-flawed", () => {
    const blocks = BOARD_BASE_CSS.split("}");
    for (const block of blocks) {
      const usesFlaw = Object.values(FLAW_VARS).some((v) => block.includes(v));
      if (!usesFlaw) continue;
      const selector = block.slice(block.lastIndexOf("*/") + 1);
      expect(selector).toContain("[data-bansho-flawed]");
    }
    RULE_START.lastIndex = 0;
  });

  test("the dust layer is gated too, and cannot intercept a pointer", () => {
    const dust = BOARD_BASE_CSS.split("}").find((b) =>
      b.includes("data:image/svg+xml"),
    );
    expect(dust).toBeDefined();
    expect(dust!).toContain("[data-bansho-flawed]");
    expect(dust!).toContain("pointer-events: none");
    // Scaled by the knob as well as gated: a board at 0.2 is barely dusty.
    expect(dust!).toContain("var(--bansho-flaw, 0)");
  });

  test("the knob has a default so a board with no theme.css still has a hand", () => {
    expect(BOARD_BASE_CSS).toContain("--bansho-flaw: 1;");
  });
});

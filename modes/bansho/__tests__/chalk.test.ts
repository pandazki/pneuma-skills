/**
 * Chalk (W9) — the two chalk effects' contract, pinned.
 *
 * Three claims carry the whole feature and each gets teeth here:
 *
 *  1. A PAPER BOARD IS BYTE-IDENTICAL TO TODAY. `--bansho-chalk: 0` (or
 *     absent) means the eraser writes exactly what it wrote before W9 —
 *     one property, `clipPath` — and every chalk stylesheet rule is gated
 *     on the surface attribute, so no rule can match. (The untouched
 *     erase-replay suite passing is the other half of this pin.)
 *
 *  2. DETERMINISM. Every "random" quantity is seeded from the erase's own
 *     identity; the emitted mask URIs and position strings are byte-stable
 *     across builds — which is what keeps the two-width gate a byte
 *     comparison with chalk on, and keeps a scrubbed erase leaving the
 *     same smear forever.
 *
 *  3. THE CHALK WIPE'S CHANNEL IS DISJOINT AND SELF-REMOVING. It writes
 *     the mask family + pointerEvents + its own wiping marker on its own
 *     wrapper, never anything a reveal strategy owns; p = 0 removes every
 *     trace; the terminal state is the residue, not exact hiding.
 */

import { describe, expect, test } from "bun:test";

import {
  CHALK_FLAG,
  CHALK_INK_FILTER_ID,
  chalkWipeAssets,
  chalkWipeStyleAt,
  readChalk,
  WIPING_FLAG,
} from "../engine/chalk.js";
import { easeEraser, eraserReveal } from "../engine/factories/eraser.js";
import type { EraseWipeSurface, Revealable } from "../engine/types.js";
import { CHALK_EFFECT_CSS, CHALK_FILTER_DEFS_SVG } from "../viewer/chalk-css.js";

/** A chalk-capable fake wrapper: records every style write and the dataset. */
const fakeWrapper = () => {
  const writes: string[] = [];
  const style = new Proxy({} as Record<string, string>, {
    set(target, prop, value) {
      writes.push(String(prop));
      target[String(prop)] = String(value);
      return true;
    },
  });
  const dataset: Record<string, string | undefined> = {};
  return {
    el: { style, dataset } as unknown as EraseWipeSurface,
    style: style as Record<string, string>,
    dataset,
    writes,
  };
};

const OPTS = { duration: 1, srcSpan: { start: 42, end: 48 }, seed: 42 };

describe("readChalk — the one theme token, read and nothing else", () => {
  test("1 and numeric-positive values are chalk; 0, junk and absence are paper", () => {
    expect(readChalk("1")).toBe(true);
    expect(readChalk(" 1")).toBe(true);
    expect(readChalk("1.0")).toBe(true);
    expect(readChalk("0")).toBe(false);
    expect(readChalk("")).toBe(false);
    expect(readChalk("on")).toBe(false);
    expect(readChalk("-1")).toBe(false);
  });
});

describe("chalkWipeAssets — seeded, byte-stable, knob-ridden", () => {
  test("same (seed, knob) → byte-identical URIs; the smear never dances", () => {
    const a = chalkWipeAssets(42, 1);
    const b = chalkWipeAssets(42, 1);
    expect(a.front).toBe(b.front);
    expect(a.residue).toBe(b.residue);
  });

  test("different erase identities leave different smears", () => {
    const a = chalkWipeAssets(42, 1);
    const b = chalkWipeAssets(43, 1);
    expect(a.front).not.toBe(b.front);
    expect(a.residue).not.toBe(b.residue);
  });

  test("the knob scales residue density, not the front's shape", () => {
    const k1 = chalkWipeAssets(7, 1);
    const k3 = chalkWipeAssets(7, 3);
    expect(k1.front).toBe(k3.front); // the hand is the hand
    expect(k1.residue).not.toBe(k3.residue); // the mess rides the knob
  });

  test("both assets are self-contained data URIs (no document coupling)", () => {
    const { front, residue } = chalkWipeAssets(1, 1);
    for (const uri of [front, residue]) {
      expect(uri.startsWith("data:image/svg+xml,")).toBe(true);
      expect(uri).not.toContain("Math.random");
    }
    // The front's turbulence seed is seeded — an integer attribute.
    expect(decodeURIComponent(front)).toMatch(/seed="\d+"/);
  });
});

describe("chalkWipeStyleAt — a pure function of eased progress", () => {
  const assets = chalkWipeAssets(42, 1);

  test("e <= 0 removes the wipe's own state entirely (null)", () => {
    expect(chalkWipeStyleAt(0, assets)).toBeNull();
    expect(chalkWipeStyleAt(-0.1, assets)).toBeNull();
  });

  test("e >= 1 parks the front fully off — the terminal state IS the residue", () => {
    const s = chalkWipeStyleAt(1, assets)!;
    expect(s.maskPosition).toBe("0.00% 0%, 0% 0%");
    expect(s.maskImage).toContain(assets.residue);
  });

  test("the front position is monotone in e and byte-stable at every e", () => {
    let prev = 101;
    for (let k = 1; k <= 60; k++) {
      const e = k / 60;
      const s = chalkWipeStyleAt(e, assets)!;
      const x = Number.parseFloat(s.maskPosition);
      expect(x).toBeLessThanOrEqual(prev);
      prev = x;
      expect(chalkWipeStyleAt(e, assets)).toEqual(s); // same e, same bytes
    }
  });

  test("in-state style always carries the full record, pointerEvents included", () => {
    const s = chalkWipeStyleAt(0.5, assets)!;
    expect(s.maskSize).toBe("300% 100%, 100% 100%");
    expect(s.maskRepeat).toBe("no-repeat, no-repeat");
    expect(s.pointerEvents).toBe("none");
    expect(s.maskImage).toContain(assets.front);
    expect(s.maskImage).toContain(assets.residue);
  });
});

describe("the chalk-flavoured eraser unit", () => {
  test("writes EXACTLY the mask family + pointerEvents — never clipPath", () => {
    const w = fakeWrapper();
    const unit = eraserReveal(
      { resolve: () => w.el },
      { ...OPTS, chalk: { knob: 1 } },
    );
    for (const p of [0.25, 0.5, 0.75, 1, 0.5]) unit.seek(p);
    expect(new Set(w.writes)).toEqual(
      new Set([
        "maskImage",
        "maskSize",
        "maskRepeat",
        "maskPosition",
        "pointerEvents",
      ]),
    );
  });

  test("marks its wrapper as wiping while it holds state, and unmarks at 0", () => {
    const w = fakeWrapper();
    const unit = eraserReveal(
      { resolve: () => w.el },
      { ...OPTS, chalk: { knob: 1 } },
    );
    unit.seek(0.5);
    expect(w.dataset[WIPING_FLAG]).toBe("");
    unit.seek(1);
    expect(w.dataset[WIPING_FLAG]).toBe("");
    unit.seek(0);
    expect(WIPING_FLAG in w.dataset).toBe(false);
  });

  test("p = 0 removes every trace; scrub-back shows clean standing text", () => {
    const w = fakeWrapper();
    const unit = eraserReveal(
      { resolve: () => w.el },
      { ...OPTS, chalk: { knob: 1 } },
    );
    unit.seek(1);
    expect(w.style.maskImage).not.toBe("");
    unit.seek(0);
    expect(w.style.maskImage).toBe("");
    expect(w.style.maskSize).toBe("");
    expect(w.style.maskRepeat).toBe("");
    expect(w.style.maskPosition).toBe("");
    expect(w.style.pointerEvents).toBe("");
  });

  test("terminal state leaves the residue standing — an erase is not exact hiding", () => {
    const w = fakeWrapper();
    const unit = eraserReveal(
      { resolve: () => w.el },
      { ...OPTS, chalk: { knob: 1 } },
    );
    unit.seek(1);
    expect(w.style.maskPosition).toBe("0.00% 0%, 0% 0%");
    expect(w.style.maskImage).toContain("data:image/svg+xml");
    expect(w.style.clipPath ?? "").toBe(""); // the ghost is masked, never clipped
  });

  test("scrub purity: any query order lands on the same wrapper state", () => {
    const w1 = fakeWrapper();
    const w2 = fakeWrapper();
    const mk = (el: EraseWipeSurface): Revealable =>
      eraserReveal({ resolve: () => el }, { ...OPTS, chalk: { knob: 1 } });
    const a = mk(w1.el);
    for (const p of [0, 1, 0.3, 0.9, 0.37]) a.seek(p);
    mk(w2.el).seek(0.37);
    expect(w1.style.maskPosition).toBe(w2.style.maskPosition);
    expect(w1.style.maskImage).toBe(w2.style.maskImage);
  });

  test("a re-minted wrapper is re-stamped at the same progress (the rebuild contract)", () => {
    const w1 = fakeWrapper();
    let current = w1.el;
    const unit = eraserReveal(
      { resolve: () => current },
      { ...OPTS, chalk: { knob: 1 } },
    );
    unit.seek(0.6);
    const w2 = fakeWrapper();
    current = w2.el; // the host re-minted the wrapper
    unit.seek(0.6); // post-rebuild seek(playhead)
    expect(w2.style.maskPosition).toBe(w1.style.maskPosition);
  });

  test("an unresolvable target is a quiet no-op, never a throw", () => {
    const unit = eraserReveal(
      { resolve: () => null },
      { ...OPTS, chalk: { knob: 1 } },
    );
    expect(() => {
      unit.seek(0.5);
      unit.seek(1);
    }).not.toThrow();
  });

  test("knob 0 falls back to the legacy hard-edge sweep — flaw 0 is a clean board", () => {
    const w = fakeWrapper();
    const unit = eraserReveal(
      { resolve: () => w.el },
      { ...OPTS, chalk: { knob: 0 } },
    );
    unit.seek(0.5);
    unit.seek(1);
    expect(new Set(w.writes)).toEqual(new Set(["clipPath"]));
    expect(w.style.clipPath).toBe("inset(0 0 0 100%)");
  });

  test("chalk absent (a paper board) writes exactly what pre-W9 wrote", () => {
    const w = fakeWrapper();
    const unit = eraserReveal({ resolve: () => w.el }, OPTS);
    for (const p of [0.25, 1, 0]) unit.seek(p);
    expect(new Set(w.writes)).toEqual(new Set(["clipPath"]));
  });

  test("the eased front matches the legacy hand (one easing, one eraser)", () => {
    // The chalk front's position derives from easeEraser — the same curve
    // the clip sweep drives with, so a theme flip cannot change the FEEL
    // of an erase, only its edge.
    const assets = chalkWipeAssets(42, 1);
    const s = chalkWipeStyleAt(easeEraser(0.4), assets)!;
    expect(Number.parseFloat(s.maskPosition)).toBeCloseTo(
      100 * (1 - easeEraser(0.4)),
      1,
    );
  });
});

describe("the chalk stylesheet — every rule gated on the surface attribute", () => {
  const rules = (
    CHALK_EFFECT_CSS.match(/(^|\})\s*([^{}]+)\{/g) ?? []
  ).map((m) => m.replace(/^\}?\s*/, "").replace(/\{$/, "").trim());

  test("no selector can match without data-bansho-chalk on the surface", () => {
    expect(rules.length).toBeGreaterThan(0);
    for (const sel of rules) {
      expect(sel).toContain("[data-bansho-chalk]");
    }
  });

  test("the ink texture rides the 瑕疵 gate too — flaw 0 keeps typeset edges", () => {
    for (const sel of rules) {
      if (sel.includes(CHALK_INK_FILTER_ID)) continue;
      if (!sel.includes(".bansho-w") && !sel.includes("path")) continue;
      if (sel.includes("[data-bansho-wiping]")) continue; // the lift rule
      expect(sel).toContain("[data-bansho-flawed]");
    }
  });

  test("marker bands stay crisp: no chalk rule reaches the fill layers", () => {
    expect(CHALK_EFFECT_CSS).not.toContain("bansho-ink-under");
    expect(CHALK_EFFECT_CSS).not.toContain("bansho-backref-under");
  });

  test("the wiping wrapper lifts the per-word filter (the measured budget fix)", () => {
    expect(CHALK_EFFECT_CSS).toContain("[data-bansho-wiping]");
    expect(CHALK_EFFECT_CSS).toContain("filter: none");
  });

  test("the filter def is same-document SVG with the id the rules reference", () => {
    expect(CHALK_FILTER_DEFS_SVG).toContain(`id="${CHALK_INK_FILTER_ID}"`);
    expect(CHALK_EFFECT_CSS).toContain(`url(#${CHALK_INK_FILTER_ID})`);
    // Paint-time only: displacement, never a geometry-affecting primitive.
    expect(CHALK_FILTER_DEFS_SVG).toContain("feDisplacementMap");
  });

  test("dataset keys match the attribute selectors (the gate cannot dangle)", () => {
    // data-bansho-chalk ↔ banshoChalk, data-bansho-wiping ↔ banshoWiping.
    expect(CHALK_FLAG).toBe("banshoChalk");
    expect(WIPING_FLAG).toBe("banshoWiping");
  });
});

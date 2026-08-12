/**
 * The hand takes the formula (T3 / G7) — `factories/math.ts`.
 *
 * The bug this file pins, measured live on the fourier board before the
 * fix: the math host inherited the board's handwriting stack correctly
 * (`getComputedStyle(host).fontFamily` = the `--hand` stack), but every
 * MathML leaf under it computed `font-family: math` — Chromium's UA sheet
 * carries `math { font-family: math }`, which resolves to the platform's
 * OpenType MATH font (Latin Modern Math / STIX Two / Cambria Math). The
 * formula therefore rendered letterpress-perfect two lines under
 * handwritten prose: 「太工整了。。完全没有手写板书的感觉」.
 *
 * The second half of the cause is the one a naive `font-family` override
 * fails on, and it fails SILENTLY (the G8-A shape): the UA sheet also
 * carries `mi { text-transform: math-auto }`, which maps a single-letter
 * identifier onto the Mathematical Italic block (`T` → U+1D447). No
 * handwriting face covers U+1D400–U+1D7FF, so per-glyph fallback would
 * quietly re-typeset every variable in a math font while the computed
 * `font-family` read back as the hand. Both halves are pinned here.
 *
 * DOM host: happy-dom — no layout engine, so client rects are zeros. That
 * is deliberate coverage, not a gap: it is exactly the degradation path
 * the drawn fraction bar must fail closed on (no measurement → the UA bar
 * stays, never a barless fraction). Measured-geometry behaviour is pinned
 * through stubbed rects, and the browser truth is the G7 visual pass.
 */

import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

import { DEFAULT_DURATIONS } from "../engine/duration.js";
import { factoryFor } from "../engine/factories/index.js";
import {
  buildMathNode,
  drawHandFractionBars,
  handStrokes,
  MATH_HAND,
  tightenPrefixOperators,
} from "../engine/factories/math.js";

/**
 * The rotation range the OLD independent per-leaf draw was allowed, degrees
 * peak-to-peak. Kept as a literal so the regression it caused stays legible
 * in the assertions below: two adjacent glyphs could differ by the whole
 * 5.2°, which is what made a `(` stop matching its `)`.
 */
const MATH_JITTER_LEGACY_ROT = 5.2;
import { mulberry32 } from "../engine/sketch/index.js";
import { probeEnvCaps } from "../engine/factories/env.js";
import type { MeasureContext, Step } from "../engine/types.js";

const makeDoc = (): Document => {
  const win = new Window();
  return win.document as unknown as Document;
};

const tokens = (host: Element): HTMLElement[] =>
  Array.from(host.querySelectorAll("mi, mn, mo, mtext, ms")) as HTMLElement[];

/** `translate(dx, dy) rotate(r)` → the three numbers, or null. */
const readJitter = (
  transform: string,
): { dx: number; dy: number; rot: number } | null => {
  const m = transform.match(
    /^translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)\s*rotate\((-?[\d.]+)deg\)$/,
  );
  return m
    ? { dx: Number(m[1]), dy: Number(m[2]), rot: Number(m[3]) }
    : null;
};

// ── The typeface: the UA's math font must lose ──────────────────────────────

describe("the hand takes the formula — UA math typography is overridden", () => {
  test("the <math> element carries font-family: inherit (beats the UA sheet)", () => {
    const doc = makeDoc();
    for (const display of [true, false]) {
      const host = buildMathNode(doc, "E = mc^2", display);
      const math = host.querySelector("math") as HTMLElement | null;
      expect(math).not.toBeNull();
      // `inherit`, never a named face and never `var(--hand)`: §6.3 makes
      // the stack the SEED's property, so the engine must not learn the
      // token's name. Inheriting hands the decision back to `.bansho-board`.
      expect(math!.style.fontFamily).toBe("inherit");
    }
  });

  test("every <mi> gets text-transform: none — no U+1D44x substitution", () => {
    const doc = makeDoc();
    const host = buildMathNode(doc, "X(f) = \\int x(t)\\, dt", true);
    const mis = Array.from(host.querySelectorAll("mi")) as HTMLElement[];
    expect(mis.length).toBeGreaterThan(2);
    for (const mi of mis) expect(mi.style.textTransform).toBe("none");
  });

  test("a KaTeX failure still yields a node — the walk never throws", () => {
    const doc = makeDoc();
    // `\nonexistentmacro` is a parse error; `throwOnError: false` renders
    // KaTeX's own error markup, which has no <math> child at all.
    const host = buildMathNode(doc, "\\nonexistentmacro{", true);
    expect(host).toBeTruthy();
    expect(host.style.clipPath).toBe("inset(0 100% 0 0)");
  });
});

// ── The glyph the hand cannot write ─────────────────────────────────────────

/**
 * W4b root cause A, measured on the live bayes board (2026-08-12, dark
 * theme, `--hand: "Chalkboard SE", "HanziPen SC", …`) with CDP's
 * `CSS.getPlatformFontsForNode` — the one instrument that names the face
 * the rasterizer actually picked:
 *
 * | leaf | codepoint | face used | box @42px |
 * |---|---|---|---|
 * | `P` `(` `D` `+` `)` `=` | ASCII | Chalkboard SE | 13–27 × 22–40 |
 * | `∣` (`\mid`) | U+2223 | **HanziPen SC** | **43 × 46** |
 *
 * Corroborated against the cmap tables themselves: U+2223 is absent from
 * BOTH Chalkboard SE (1056 cps) and Bradley Hand (1505 cps), while U+007C
 * is present in both. So every conditional probability on every board drew
 * its bar in a Chinese handwriting face at a FULL-WIDTH CJK advance —
 * hairline where its neighbours are chalk, and sitting in a 43px slot that
 * reads as two spaces with a stray stroke in the middle. Nothing reported
 * it: this is the G8-A shape (`document.fonts.check` and the computed
 * `font-family` both read back clean).
 *
 * The fix is a same-mark substitution, never a probe: a probe-gated rewrite
 * would make one TeX string render differently per machine, and the export
 * gate depends on it not doing that.
 */
describe("glyphs the hand cannot write are swapped for the same mark", () => {
  const codepointsIn = (host: Element): Set<string> => {
    const seen = new Set<string>();
    for (const leaf of tokens(host)) {
      for (const ch of leaf.textContent ?? "") seen.add(ch);
    }
    return seen;
  };

  test("U+2223 DIVIDES becomes U+007C — the bar joins the letters' face", () => {
    const doc = makeDoc();
    const host = buildMathNode(doc, "P(D \\mid +) = P(+ \\mid D)", true);
    const cps = codepointsIn(host);
    expect(cps.has("∣")).toBe(false);
    expect(cps.has("|")).toBe(true);
    // Both bars, not just the first one the walk happens to reach.
    const bars = tokens(host).filter((l) => l.textContent === "|");
    expect(bars.length).toBe(2);
  });

  test("a substituted operator is pinned non-stretchy", () => {
    const doc = makeDoc();
    // The first `\mid` shares an <mrow> with the <mfrac>. `|` is a fence in
    // the MathML operator dictionary, and a stretchy one there would grow
    // to the fraction's full height — that would be a genuine mis-render
    // introduced while fixing a cosmetic one. Pin it shut.
    const host = buildMathNode(
      doc,
      "P(D \\mid +) = \\frac{P(+ \\mid D)\\,P(D)}{P(+)}",
      true,
    );
    const bars = tokens(host).filter((l) => l.textContent === "|");
    expect(bars.length).toBe(2);
    for (const bar of bars) expect(bar.getAttribute("stretchy")).toBe("false");
  });

  test("U+2212 MINUS SIGN becomes the hand's own dash", () => {
    const doc = makeDoc();
    // Chalkboard SE has no U+2212 either (cmap-verified), so every
    // subtraction on the dark board was drawn by a fallback face too.
    const host = buildMathNode(doc, "a - b = c", true);
    const cps = codepointsIn(host);
    expect(cps.has("−")).toBe(false);
    expect(cps.has("-")).toBe(true);
  });

  test("a SIZING fence keeps its own glyph — the math face has it properly", () => {
    const doc = makeDoc();
    // `\left| x \right|` renders as <mo fence="true">∣</mo>, and a sizing
    // fence is the one leaf deliberately left in `font-family: math` — a
    // face that covers U+2223 at the right size and grows with its content.
    // Rewriting it would hand a stretchable delimiter to a font with no
    // size variants, which is the collision the fence exemption exists to
    // prevent.
    const host = buildMathNode(doc, "\\left| \\frac{a}{b} \\right| = 1", true);
    const fences = tokens(host).filter(
      (l) => l.getAttribute("fence") === "true",
    );
    expect(fences.length).toBeGreaterThan(0);
    for (const f of fences) {
      expect(f.textContent).toBe("∣");
      expect(f.style.fontFamily).toBe("math");
    }
  });

  test("a glyph with no same-mark equivalent is left alone, not faked", () => {
    const doc = makeDoc();
    // U+2225 PARALLEL TO is absent from both hand faces AND from every
    // covered candidate (U+2016 is absent too, cmap-verified). There is no
    // honest substitution, so the board keeps the true character and takes
    // the fallback rather than printing a different symbol.
    const host = buildMathNode(doc, "x \\parallel y", true);
    expect(codepointsIn(host).has("∥")).toBe(true);
  });
});

// ── The wobble: ONE hand writing ONE expression ─────────────────────────────

/**
 * W4b root cause B. The old pass gave every token leaf an INDEPENDENT
 * `translate(dx, dy) rotate(r)` out of the shared stream — measured on the
 * bayes board, 39 atoms carrying 39 uncorrelated transforms, with a rotation
 * budget of ±2.6° each. On prose independent drift reads as a hand; inside a
 * formula it reads as broken, because a formula's alignment IS its meaning:
 * a `(` at +2.6° beside its `)` at −2.6° is not a pair any more, and a bar
 * displaced away from what it separates is not a conditional any more.
 *
 * So the perturbation became CORRELATED: one seeded slant every glyph shares
 * (that is the "one hand"), plus a smooth low-frequency field in leaf order
 * (that is the drift a wrist has). Neighbours now move TOGETHER. The tests
 * below pin the correlation, not the numbers — the budget can be retuned,
 * the relationships cannot be broken.
 */
describe("per-glyph hand — correlated, not independent", () => {
  test("token leaves carry a translate+rotate transform", () => {
    const doc = makeDoc();
    const host = buildMathNode(doc, "a^2 + b^2 = c^2", true);
    const leaves = tokens(host);
    expect(leaves.length).toBeGreaterThan(5);
    const jittered = leaves.filter((l) => readJitter(l.style.transform));
    expect(jittered.length).toBe(leaves.length);
  });

  test("amplitudes stay inside the declared budget", () => {
    const doc = makeDoc();
    // A formula wide enough to walk deep into the PRNG stream.
    const host = buildMathNode(
      doc,
      "\\frac{\\partial f}{\\partial x} = \\lim_{h \\to 0} \\frac{f(x+h) - f(x)}{h}",
      true,
    );
    const leaves = tokens(host);
    expect(leaves.length).toBeGreaterThan(10);
    const cap = MATH_HAND.slant / 2 + MATH_HAND.rot / 2 + 1e-6;
    for (const leaf of leaves) {
      const j = readJitter(leaf.style.transform);
      if (!j) continue;
      expect(Math.abs(j.dx)).toBeLessThanOrEqual(MATH_HAND.dx / 2 + 1e-6);
      expect(Math.abs(j.dy)).toBeLessThanOrEqual(MATH_HAND.dy / 2 + 1e-6);
      expect(Math.abs(j.rot)).toBeLessThanOrEqual(cap);
    }
  });

  test("the whole expression leans ONE way — the slant is shared", () => {
    const doc = makeDoc();
    const host = buildMathNode(
      doc,
      "P(D \\mid +) = \\frac{P(+ \\mid D)\\,P(D)}{P(+)}",
      true,
    );
    const rots = tokens(host)
      .map((l) => readJitter(l.style.transform))
      .filter((j): j is NonNullable<typeof j> => j !== null)
      .map((j) => j.rot);
    expect(rots.length).toBeGreaterThan(15);
    // The SPREAD is the residual budget alone. Under the old independent
    // draw this was the full ±2.6° range (5.2° spread) on this very
    // formula; a shared slant means the whole expression sits inside one
    // narrow band of angles instead.
    const spread = Math.max(...rots) - Math.min(...rots);
    expect(spread).toBeLessThanOrEqual(MATH_HAND.rot + 1e-6);
    expect(spread).toBeLessThan(MATH_JITTER_LEGACY_ROT / 2);
  });

  test("neighbouring glyphs move TOGETHER, not independently", () => {
    const doc = makeDoc();
    const host = buildMathNode(
      doc,
      "P(D \\mid +) = \\frac{P(+ \\mid D)\\,P(D)}{P(+)}",
      true,
    );
    const js = tokens(host)
      .map((l) => readJitter(l.style.transform))
      .filter((j): j is NonNullable<typeof j> => j !== null);
    expect(js.length).toBeGreaterThan(15);
    for (let i = 1; i < js.length; i++) {
      // Adjacent leaves are adjacent marks: `(` and what it opens, a bar
      // and what it separates. Their relative displacement is what the
      // reader sees as "the notation still holds", so it is bounded well
      // under a tenth of the old independent worst case.
      expect(Math.abs(js[i]!.dy - js[i - 1]!.dy)).toBeLessThan(0.3);
      expect(Math.abs(js[i]!.dx - js[i - 1]!.dx)).toBeLessThan(0.2);
      expect(Math.abs(js[i]!.rot - js[i - 1]!.rot)).toBeLessThan(0.2);
    }
  });

  test("a matched pair a few glyphs apart still matches", () => {
    const doc = makeDoc();
    const host = buildMathNode(doc, "P(D \\mid +) = P(+ \\mid D)", true);
    const js = tokens(host)
      .map((l) => readJitter(l.style.transform))
      .filter((j): j is NonNullable<typeof j> => j !== null);
    // `(` and `)` in `P(D | +)` sit four leaves apart; the old draw could
    // put 5.2° and 2.2px between them.
    for (let i = 0; i + 4 < js.length; i++) {
      expect(Math.abs(js[i + 4]!.dy - js[i]!.dy)).toBeLessThan(1);
      expect(Math.abs(js[i + 4]!.rot - js[i]!.rot)).toBeLessThan(0.7);
    }
  });

  test("the stroke field costs a FIXED number of draws, whatever the length", () => {
    // The wobble and the fraction bar under it share ONE stream, and the
    // bar is drawn after the wobble. If the wobble consumed one draw per
    // leaf, the bar's geometry would depend on how many glyphs happened to
    // precede it — the same fraction would get a different bar in a longer
    // formula. Drawing the whole field from a fixed handful of parameters
    // is what makes "one stream, one hand" true rather than decorative.
    const counted = (n: number): number => {
      let draws = 0;
      const rnd = mulberry32(99);
      handStrokes(n, () => {
        draws++;
        return rnd();
      });
      return draws;
    };
    expect(counted(3)).toBe(counted(40));
    expect(counted(0)).toBe(counted(40));
  });

  test("the field is a pure function of index — same seed, same strokes", () => {
    const a = handStrokes(12, mulberry32(5));
    const b = handStrokes(12, mulberry32(5));
    expect(a).toEqual(b);
    const c = handStrokes(12, mulberry32(6));
    expect(c).not.toEqual(a);
  });

  test("a sizing fence keeps the math face, upright — the one typeset thing", () => {
    const doc = makeDoc();
    // `\left( … \right)` renders as <mo fence="true"> and grows by swapping
    // in the size variants an OpenType MATH table carries. No handwriting
    // face has one, so under `inherit` alone the delimiter stayed
    // glyph-sized and collided with the fraction it was supposed to wrap —
    // a wrong formula, not a hand. It keeps `math`, and stays upright: a
    // rotated stretched delimiter reads as broken glass.
    const host = buildMathNode(doc, "P\\left(\\frac{a}{b}\\right) = 1", true);
    const mos = Array.from(host.querySelectorAll("mo")) as HTMLElement[];
    const fences = mos.filter(
      (o) =>
        o.getAttribute("fence") === "true" ||
        o.getAttribute("stretchy") === "true",
    );
    expect(fences.length).toBeGreaterThan(0);
    for (const f of fences) {
      expect(f.style.transform).toBe("");
      expect(f.style.fontFamily).toBe("math");
    }
    // Everything that is NOT a sizing delimiter still takes the hand — a
    // plain `(` (stretchy="false") must never be exempted with them.
    const plain = mos.filter((o) => o.getAttribute("stretchy") === "false");
    for (const p of plain) expect(p.style.fontFamily).toBe("");
  });

  test("jitter is TRANSFORM-only — it can never move the layout", () => {
    const doc = makeDoc();
    const host = buildMathNode(doc, "\\sum_{i=1}^{n} a_i = \\sqrt{x^2+y^2}", true);
    // A transform is paint-time; anything in this list is layout-time and
    // would rewrite every downstream step rect (the layout-baseline A/B is
    // the instrument that would catch it — after the fact).
    const banned = [
      "width",
      "height",
      "margin",
      "marginTop",
      "marginLeft",
      "padding",
      "fontSize",
      "lineHeight",
      "position",
      "top",
      "left",
      "verticalAlign",
      "display",
    ] as const;
    for (const leaf of tokens(host)) {
      for (const prop of banned) {
        expect(leaf.style[prop as "width"]).toBe("");
      }
    }
  });

  test("determinism: same TeX → byte-identical jitter; different TeX → different", () => {
    const doc = makeDoc();
    const tex = "\\int_0^T \\sin(2\\pi f t)\\, dt = 0";
    const read = (h: Element): string =>
      tokens(h)
        .map((l) => l.style.transform)
        .join("|");
    const a = read(buildMathNode(doc, tex, true));
    const b = read(buildMathNode(doc, tex, true));
    // A streaming re-parse mints fresh Step objects at shifted offsets; a
    // formula already on the board must not re-wobble when the next line
    // lands (§7 R1). Content-derived seed, exactly like `contentSeed`.
    expect(a).toBe(b);
    const c = read(buildMathNode(doc, "\\int_0^T \\cos(2\\pi f t)\\, dt = 0", true));
    expect(c).not.toBe(a);
  });

  test("the block factory's node carries the same hand", () => {
    const doc = makeDoc();
    const step: Step = {
      kind: "math",
      tex: "E = mc^2",
      srcSpan: { start: 0, end: 10 },
    };
    const ctx: MeasureContext = {
      durations: DEFAULT_DURATIONS,
      document: doc,
      measureHost: doc.createElement("div"),
      env: probeEnvCaps(doc),
      container: () => undefined,
    };
    doc.body.appendChild(ctx.measureHost);
    const built = factoryFor("math")!.build(step, ctx);
    const math = built.node.querySelector("math") as HTMLElement;
    expect(math.style.fontFamily).toBe("inherit");
    expect(tokens(built.node).length).toBeGreaterThan(2);
  });
});

// ── The fraction bar: drawn, and fail-closed when it cannot be ──────────────

describe("the fraction bar is a drawn stroke", () => {
  test("no layout → the UA bar stays and nothing is drawn (fail closed)", () => {
    const doc = makeDoc();
    const measureHost = doc.createElement("div");
    doc.body.appendChild(measureHost);
    const host = buildMathNode(doc, "\\frac{a}{b}", true, measureHost);
    const frac = host.querySelector("mfrac")!;
    // happy-dom has no layout engine: every rect is zeros. A barless
    // fraction is worse than a mechanically straight one, so the zeroing
    // of `linethickness` must be gated on a bar having actually been drawn.
    expect(frac.getAttribute("linethickness")).toBeNull();
    expect(host.querySelectorAll("svg path").length).toBe(0);
  });

  test("measured geometry → one jittered path per bar, UA bar switched off", () => {
    const doc = makeDoc();
    const host = buildMathNode(doc, "\\frac{a}{b} + \\frac{c}{d}", true);
    stubRects(host);
    const drawn = drawHandFractionBars(doc, host, mulberry32(7));
    expect(drawn).toBe(2);
    const paths = Array.from(host.querySelectorAll("svg path"));
    expect(paths.length).toBe(2);
    for (const frac of Array.from(host.querySelectorAll("mfrac"))) {
      expect(frac.getAttribute("linethickness")).toBe("0");
    }
    for (const p of paths) {
      const d = p.getAttribute("d")!;
      // One drawable stroke, single `M` — the sketch-layer contract every
      // hand line on this board keeps.
      expect(d.startsWith("M ")).toBe(true);
      expect(d.match(/M /g)!.length).toBe(1);
      // It has to WOBBLE: a straight run of identical y's is the typeset
      // bar with extra steps.
      const ys = Array.from(d.matchAll(/[MQ] [-\d.]+ ([-\d.]+)/g)).map((m) =>
        Number(m[1]),
      );
      expect(new Set(ys).size).toBeGreaterThan(1);
      // G8-D — the pen colour rides element.style, never an attribute.
      expect(p.getAttribute("stroke")).toBeNull();
      expect((p as unknown as HTMLElement).style.stroke).toContain("--board-fg");
    }
  });

  test("the overlay lives INSIDE the clipped host — the wipe still owns it", () => {
    const doc = makeDoc();
    const host = buildMathNode(doc, "\\frac{a}{b}", true);
    stubRects(host);
    drawHandFractionBars(doc, host, mulberry32(3));
    const svg = host.querySelector("svg")!;
    // clip-path on the host clips every descendant, positioned or not — so
    // an overlay mounted here is revealed by the SAME left→right sweep as
    // the glyphs, with no second beat and no schedule change.
    expect(svg.parentElement).toBe(host as unknown as HTMLElement);
    expect(host.style.clipPath).toBe("inset(0 100% 0 0)");
    // Positioned host = the overlay's containing block; `position: relative`
    // with z-index:auto mints NO stacking context (backref mount contract).
    expect(host.style.position).toBe("relative");
    expect(host.style.zIndex).toBe("");
  });

  test("a \\binom's already-barless mfrac is left alone", () => {
    const doc = makeDoc();
    const host = buildMathNode(doc, "\\binom{n}{k}", true);
    // KaTeX writes the unit — `linethickness="0px"`, not `"0"`. A string
    // compare against `"0"` would have drawn a bar through a binomial
    // coefficient, which is a different expression.
    expect(host.querySelector("mfrac")!.getAttribute("linethickness")).toBe("0px");
    stubRects(host);
    const drawn = drawHandFractionBars(doc, host, mulberry32(11));
    expect(drawn).toBe(0);
    expect(host.querySelectorAll("svg path").length).toBe(0);
    expect(host.querySelector("mfrac")!.getAttribute("linethickness")).toBe("0px");
  });

  test("determinism: same TeX → byte-identical bar geometry", () => {
    const doc = makeDoc();
    const build = (): string => {
      const h = buildMathNode(doc, "\\frac{x+1}{y-1}", true);
      stubRects(h);
      drawHandFractionBars(doc, h, mulberry32(21));
      return h.querySelector("svg path")!.getAttribute("d")!;
    };
    expect(build()).toBe(build());
  });
});

// ── The air around a unary plus (W4c §3) ────────────────────────────────────

/**
 * Chromium's MathML operator dictionary is keyed by CHARACTER, so `+` is
 * spaced as infix wherever it stands — `P(+)` rendered `P( + )` with a full
 * thick space on each side, where TeX sets an operator with no left operand
 * tight. The classifier below is a LOCAL read of one sibling, deliberately:
 * the two cases a naive "previous sibling is another operator" rule gets
 * wrong — `(a+b) - c` and `n! + m` — would space a genuinely infix operator
 * tight, which is a worse defect than the one being fixed. Both are pinned
 * here in the negative direction.
 */
describe("an operator with no left operand is set tight", () => {
  const spacingOf = (
    tex: string,
    pick: (mos: Element[]) => Element | undefined,
  ): { lspace: string | null; rspace: string | null } => {
    const host = buildMathNode(makeDoc(), tex, true);
    const target = pick(Array.from(host.querySelectorAll("mo")));
    expect(target).toBeDefined();
    return {
      lspace: target!.getAttribute("lspace"),
      rspace: target!.getAttribute("rspace"),
    };
  };
  const first = (text: string) => (mos: Element[]) =>
    mos.find((m) => m.textContent === text);
  const last = (text: string) => (mos: Element[]) =>
    mos.filter((m) => m.textContent === text).at(-1);

  const TIGHT = { lspace: "0", rspace: "0" };
  const UNTOUCHED = { lspace: null, rspace: null };

  test("after an opening fence: P(+)", () => {
    expect(spacingOf("P(+)", first("+"))).toEqual(TIGHT);
  });

  test("after a relation — the substituted \\mid: P(D \\mid +)", () => {
    expect(spacingOf("P(D \\mid +)", first("+"))).toEqual(TIGHT);
  });

  test("first child of its row: -x, and inside an exponent: x^{-2}", () => {
    // KaTeX emits U+2212 MINUS SIGN; the hand rewrite has already turned it
    // into U+002D by the time the classifier reads it, which is why
    // `UNARY_CAPABLE` carries both spellings.
    expect(spacingOf("-x", first("-"))).toEqual(TIGHT);
    expect(spacingOf("x^{-2}", first("-"))).toEqual(TIGHT);
  });

  test("after another prefix/infix operator: a - -b, x = +1", () => {
    expect(spacingOf("a - -b", last("-"))).toEqual(TIGHT);
    expect(spacingOf("x = +1", first("+"))).toEqual(TIGHT);
  });

  test("after a separator: f(a, -b)", () => {
    expect(spacingOf("f(a, -b)", first("-"))).toEqual(TIGHT);
  });

  test("after an UNAMBIGUOUS sizing fence: \\left( +b \\right)", () => {
    expect(spacingOf("\\left( +b \\right)", first("+"))).toEqual(TIGHT);
  });

  // ── and the cases that must NOT be touched ────────────────────────────────

  test("a genuine infix operator keeps its spacing: a + b", () => {
    expect(spacingOf("a + b", first("+"))).toEqual(UNTOUCHED);
  });

  test("after a CLOSING fence it is infix: (a+b) - c", () => {
    expect(spacingOf("(a+b) - c", first("-"))).toEqual(UNTOUCHED);
  });

  test("after a POSTFIX mark it is infix: n! + m", () => {
    expect(spacingOf("n! + m", first("+"))).toEqual(UNTOUCHED);
  });

  test("after a complete non-mo operand it is infix: \\frac{a}{b} + c", () => {
    expect(spacingOf("\\frac{a}{b} + c", first("+"))).toEqual(UNTOUCHED);
  });

  test("an AMBIGUOUS sizing fence answers 'operand present' — the safe side", () => {
    // KaTeX marks `\left|` and `\right|` identically (`<mo fence="true">|`),
    // so the side cannot be read locally. Spacing `\left|x\right| + y` tight
    // would be wrong; leaving one prefix operator looking as it does today
    // is not.
    expect(spacingOf("\\left| x \\right| + y", last("+"))).toEqual(UNTOUCHED);
  });

  test("relations and products are never eligible at all", () => {
    // The set is `+ − - ± ∓`. `=` cannot be prefix in any notation, so no
    // reading of the tree can reach it.
    expect(spacingOf("a = b", first("="))).toEqual(UNTOUCHED);
    expect(spacingOf("(a) \\cdot b", first("·"))).toEqual(UNTOUCHED);
  });

  test("the pass reports how many it set, and is idempotent", () => {
    const host = buildMathNode(makeDoc(), "P(+) - Q(+)", true);
    // Both `+` are already tight from the build; re-running finds the same
    // two and changes nothing else.
    expect(tightenPrefixOperators(host)).toBe(2);
    expect(
      Array.from(host.querySelectorAll("mo")).filter(
        (m) => m.getAttribute("lspace") === "0",
      ).length,
    ).toBe(2);
  });

  test("a KaTeX parse error leaves the pass with nothing to do", () => {
    const host = buildMathNode(makeDoc(), "\\frac{", true);
    expect(() => tightenPrefixOperators(host)).not.toThrow();
  });
});

/**
 * happy-dom reports every rect as zeros. Give the host, its fractions and
 * their children a plausible measured layout so the drawn-bar path can be
 * exercised without a browser: host 240×90 at the origin, each fraction a
 * 60px-wide column with a 10px gap between numerator and denominator.
 */
function stubRects(host: Element): void {
  const rect = (
    left: number,
    top: number,
    width: number,
    height: number,
  ): DOMRect =>
    ({
      x: left,
      y: top,
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      toJSON: () => ({}),
    }) as DOMRect;
  const set = (node: Element, r: DOMRect): void => {
    (node as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect =
      () => r;
  };
  set(host, rect(0, 0, 240, 90));
  const fracs = Array.from(host.querySelectorAll("mfrac"));
  fracs.forEach((frac, i) => {
    const x = 10 + i * 90;
    set(frac, rect(x, 10, 60, 70));
    const num = frac.children[0];
    const den = frac.children[1];
    if (num) set(num, rect(x + 5, 10, 50, 30));
    if (den) set(den, rect(x + 5, 50, 50, 30));
  });
}

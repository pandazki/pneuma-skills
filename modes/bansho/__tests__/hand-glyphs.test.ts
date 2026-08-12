/**
 * The hand's glyph table (W4c) — `engine/factories/hand-glyphs.ts`, plus the
 * two places that write it: prose text and MathML token leaves.
 *
 * The defect this pins, measured on the live dark board (Chrome 151, stack
 * `"Chalkboard SE", "HanziPen SC", "Bradley Hand", "Segoe Print", cursive`,
 * faces' cmap tables parsed off disk and `CSS.getPlatformFontsForNode`
 * naming the rasterizer's choice):
 *
 *   ⋅ U+22C5  in NEITHER Chalkboard SE nor Bradley Hand → HanziPen SC
 *   ∣ U+2223  in NEITHER                                → HanziPen SC, 0.06 ink fill
 *   − U+2212  Bradley only                              → HanziPen SC
 *   · U+00B7  in ALL THREE                              → the hand itself
 *
 * so a `⋅` typed in a sentence and a `\cdot` inside `$…$` both came out of
 * a Chinese handwriting face while everything around them was chalk. The
 * table is shared between the two writers for exactly that reason: they are
 * the same mark on the same board.
 *
 * DOM host: happy-dom — no layout engine. That is enough here, because
 * every claim below is about characters and tree structure, never about
 * pixels; the pixel truth is the visual pass in
 * `harness/screenshots/w4c-glyphs/`.
 */

import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

import { DEFAULT_DURATIONS } from "../engine/duration.js";
import {
  FALLBACK_GLYPH_LIST_CAP,
  factoryFor,
  glyphsFallingBack,
} from "../engine/factories/index.js";
import {
  HAND_SUBSTITUTIONS,
  hasHandSubstitution,
  substituteHandGlyphs,
} from "../engine/factories/hand-glyphs.js";
import { buildMathNode } from "../engine/factories/math.js";
import type { MeasureContext, Step } from "../engine/types.js";

const makeDoc = (): Document => {
  const win = new Window();
  return win.document as unknown as Document;
};

const ctxFor = (doc: Document): MeasureContext => ({
  document: doc,
  measureHost: doc.body as unknown as Element,
  durations: DEFAULT_DURATIONS,
  env: { handwritingFontActive: true, strokeFontCovers: () => false },
  container: () => undefined,
});

const proseStep = (text: string): Step =>
  ({
    kind: "prose",
    ref: { stepIndex: 0 },
    srcSpan: { start: 0, end: text.length },
    inline: [
      { kind: "text", text, srcSpan: { start: 0, end: text.length } },
    ],
  }) as unknown as Step;

const buildProse = (text: string): Element =>
  factoryFor("prose")!.build(proseStep(text), ctxFor(makeDoc())).node;

describe("the table itself", () => {
  test("every entry is 1:1 in UTF-16 code units", () => {
    // prose.ts writes the SUBSTITUTED text into the DOM while advancing
    // `plainCursor` (and the §4.3 align spacer that rides it) over the
    // ORIGINAL. A length-changing entry would slide the column silently.
    expect(HAND_SUBSTITUTIONS.size).toBeGreaterThan(0);
    for (const [from, to] of HAND_SUBSTITUTIONS) {
      expect(to.length).toBe(from.length);
      expect(from.length).toBe(1);
    }
  });

  test("no entry maps a character to itself, or to another key", () => {
    for (const [from, to] of HAND_SUBSTITUTIONS) {
      expect(to).not.toBe(from);
      // A target that is itself substitutable would make the rewrite
      // order-dependent — and `String.replace` does not re-scan, so the
      // board would keep a glyph the hand cannot form.
      expect(HAND_SUBSTITUTIONS.has(to)).toBe(false);
    }
  });

  test("the three measured glyphs are in it, mapped to the same mark", () => {
    expect(HAND_SUBSTITUTIONS.get("∣")).toBe("|"); // DIVIDES
    expect(HAND_SUBSTITUTIONS.get("−")).toBe("-"); // MINUS SIGN
    expect(HAND_SUBSTITUTIONS.get("⋅")).toBe("·"); // DOT OPERATOR
  });

  test("a glyph with no honest equivalent is NOT in it", () => {
    // ∥ U+2225 and its only candidate U+2016 are in neither hand face; ⋯
    // U+22EF sits on the midline where … U+2026 sits on the baseline (in
    // TeX, `\cdots` vs `\ldots`). Printing a different mark would be a lie
    // about the mathematics, which is worse than an ugly glyph — those
    // stay, and the §6.4-A chip names them instead.
    for (const ch of ["∥", "⋯", "→", "←", "×"]) {
      expect(HAND_SUBSTITUTIONS.has(ch)).toBe(false);
      expect(substituteHandGlyphs(`a${ch}b`)).toBe(`a${ch}b`);
    }
  });

  test("substitution is unconditional — no probe, no environment", () => {
    // Determinism: one document must render the same on every machine, so
    // the rewrite may never consult a runtime coverage probe. The signature
    // is the guard — the function takes a string and nothing else.
    expect(substituteHandGlyphs.length).toBe(1);
    expect(substituteHandGlyphs("a ∣ b")).toBe("a | b");
  });

  test("the test regex and the replace regex are not the same object", () => {
    // A `g` regex carries `lastIndex` across calls; sharing one between the
    // probe and the rewrite makes every second call on the same text miss.
    const text = "P(D ∣ +)";
    expect(hasHandSubstitution(text)).toBe(true);
    expect(hasHandSubstitution(text)).toBe(true);
    expect(substituteHandGlyphs(text)).toBe("P(D | +)");
    expect(substituteHandGlyphs(text)).toBe("P(D | +)");
  });

  test("text with nothing to rewrite comes back as the same string", () => {
    const plain = "一句话：先验 × 似然 → 后验";
    expect(substituteHandGlyphs(plain)).toBe(plain);
  });
});

describe("prose writes the substituted mark, and keeps the source's offsets", () => {
  test("a typed dot operator is written as a middle dot", () => {
    const node = buildProse("功率 = 力 ⋅ 速度");
    expect(node.textContent).toContain("·");
    expect(node.textContent).not.toContain("⋅");
  });

  test("a typed DIVIDES and MINUS are written as the hand's own marks", () => {
    const node = buildProse("P(A ∣ B), −5 度");
    expect(node.textContent).toContain("|");
    expect(node.textContent).toContain("-5");
    expect(node.textContent).not.toContain("∣");
    expect(node.textContent).not.toContain("−");
  });

  test("an arrow is left exactly as the author wrote it", () => {
    // No arrow codepoint exists in either hand face, and `->` is two
    // codepoints and a different mark. Measured: `→` renders from HanziPen
    // SC — a face the board itself declares — filling 0.90 of its advance,
    // where `∣` filled 0.06. The advance was never the defect.
    const line = "先验 × 似然 → 后验";
    expect(buildProse(line).textContent).toContain("→");
  });

  test("the substituted span is still keyed by its SOURCE span", () => {
    // The rewrite touches the DOM only. Plan↔DOM lookup, the 禁则 glue
    // verdict and `plainCursor` all read the original text, so a document
    // whose glyphs changed keeps every offset it had.
    const text = "a ⋅ b";
    const doc = makeDoc();
    const built = factoryFor("prose")!.build(proseStep(text), ctxFor(doc));
    const spans = Array.from(built.node.querySelectorAll(".bansho-w"));
    expect(spans.length).toBeGreaterThan(0);
    expect(built.node.textContent).toContain("·");
    // Every planned unit found its DOM target — a drift would have degraded
    // to an inert revealable with duration 0 and no node.
    expect(built.revealables.length).toBeGreaterThan(0);
    for (const r of built.revealables) expect(r.naturalDuration).toBeGreaterThan(0);
  });

  test("a mark inside emphasis is rewritten too", () => {
    const doc = makeDoc();
    const step = {
      kind: "prose",
      ref: { stepIndex: 0 },
      srcSpan: { start: 0, end: 9 },
      inline: [
        {
          kind: "em",
          text: "a ⋅ b",
          srcSpan: { start: 0, end: 9 },
          textSpan: { start: 2, end: 7 },
        },
      ],
    } as unknown as Step;
    const node = factoryFor("prose")!.build(step, ctxFor(doc)).node;
    expect(node.textContent).toContain("·");
    expect(node.textContent).not.toContain("⋅");
  });
});

// ── The chip's payload: name the characters, never just "fallback" ─────────

/**
 * The blind trial (findings §2.1) lost a cold author to a chip that would
 * not say WHICH characters: their `theme.css` had dropped `HanziPen SC`, so
 * every Chinese glyph on the board came out of 苹方, and `document.fonts.check`
 * answered `true` for every family they asked about — the G8-A lie, which
 * is about the family and never about the glyph.
 *
 * The instrument is `probeEnvCaps`'s, narrowed to one character at a time
 * and tightened to EXACT width equality, because a single glyph's advance is
 * a small number: measured on the live board, Chalkboard SE's `A` (25.81px)
 * and 苹方's (26.28px) sit inside the stack probe's 0.5px tolerance, while at
 * exact equality the shipped stacks name `⋯` and `⊂` alone and the blind
 * trial's stack names every CJK character plus both arrows.
 */
describe("the §6.4-A chip names the characters that fell back", () => {
  /** `widthOf(font, text)` — the fake canvas both arguments reach. */
  const fakeDoc = (widthOf: (font: string, text: string) => number): Document =>
    ({
      createElement: () => ({
        getContext: () => {
          const g = {
            font: "",
            measureText: (s: string) => ({ width: widthOf(g.font, s) }),
          };
          return g;
        },
      }),
    }) as unknown as Document;

  /** A hand face draws CJK at 1.03em; the fallback draws it at exactly 1em. */
  const HAND_ONLY = new Set([..."板书手写字宽验证样本一二三"]);
  const boardLike = (font: string, ch: string): number =>
    font.includes("HanziPen") && HAND_ONLY.has(ch) ? 28.84 : 28;

  test("a character no declared stack can draw is named", () => {
    const missing = glyphsFallingBack(fakeDoc(boardLike), "板书 → 验", {
      stacks: [`"HanziPen SC", cursive`],
    });
    // 板书验 are drawn by the hand (1.03em); `→` measures exactly the
    // fallback's width, so the hand is not drawing it.
    expect(missing).toEqual(["→"]);
  });

  test("the blind trial's stack names every character it cannot draw", () => {
    const missing = glyphsFallingBack(fakeDoc(boardLike), "板书手写", {
      stacks: [`"Bradley Hand", "Chalkboard SE", cursive`],
    });
    expect(missing).toEqual(["板", "书", "手", "写"]);
  });

  test("a healthy board names nothing", () => {
    expect(
      glyphsFallingBack(fakeDoc(boardLike), "板书手写", {
        stacks: [`"HanziPen SC", cursive`],
      }),
    ).toEqual([]);
  });

  test("a stack that degrades in only ONE theme still names the character", () => {
    // `EnvCaps` is session-fixed and the reader can flip the theme at any
    // moment, so both declared variants have to hold now.
    expect(
      glyphsFallingBack(fakeDoc(boardLike), "板", {
        stacks: [`"HanziPen SC", cursive`, `"Bradley Hand", cursive`],
      }),
    ).toEqual(["板"]);
  });

  test("each character is named once, in first-appearance order", () => {
    expect(
      glyphsFallingBack(fakeDoc(boardLike), "→ 板 ← → ←", {
        stacks: [`"HanziPen SC", cursive`],
      }),
    ).toEqual(["→", "←"]);
  });

  test("whitespace is never named — it has no glyph to fall back", () => {
    expect(
      glyphsFallingBack(fakeDoc(boardLike), " \t\n板书", {
        stacks: [`"HanziPen SC", cursive`],
      }),
    ).toEqual([]);
  });

  test("nothing declared, or no canvas → says nothing rather than guessing", () => {
    expect(glyphsFallingBack(fakeDoc(boardLike), "板书", { stacks: [] })).toEqual([]);
    const noCanvas = {
      createElement: () => ({ getContext: () => null }),
    } as unknown as Document;
    expect(glyphsFallingBack(noCanvas, "板书", { stacks: [`"X"`] })).toEqual([]);
    expect(glyphsFallingBack(fakeDoc(boardLike), "", { stacks: [`"X"`] })).toEqual([]);
  });

  test("astral characters are one name, not two broken halves", () => {
    // `for…of` over a string walks code points; a surrogate-pair character
    // named as two lone surrogates would be unreadable in the chip.
    const missing = glyphsFallingBack(fakeDoc(boardLike), "𝄞", {
      stacks: [`"HanziPen SC", cursive`],
    });
    expect(missing).toEqual(["𝄞"]);
  });

  test("the cap the chip lists before it starts counting is a real number", () => {
    expect(FALLBACK_GLYPH_LIST_CAP).toBeGreaterThan(0);
  });
});

describe("math and prose agree — one table, two writers", () => {
  test("\\cdot is written as the same mark prose writes", () => {
    const doc = makeDoc();
    const host = buildMathNode(doc, "a \\cdot b", true);
    expect(host.textContent).toContain("·");
    expect(host.textContent).not.toContain("⋅");
    expect(buildProse("a ⋅ b").textContent).toContain("·");
  });

  test("a substituted <mo> is still pinned stretchy=false", () => {
    const doc = makeDoc();
    const host = buildMathNode(doc, "a \\cdot b", true);
    const mo = Array.from(host.querySelectorAll("mo")).find(
      (n) => n.textContent === "·",
    );
    expect(mo).toBeDefined();
    expect(mo!.getAttribute("stretchy")).toBe("false");
  });
});

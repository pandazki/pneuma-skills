/**
 * The glyphs a handwriting board cannot form, and the same marks it can.
 *
 * One table, two call sites — `math.ts` rewrites MathML token leaves,
 * `prose.ts` rewrites written text. They must agree: a `\cdot` inside `$…$`
 * and a `⋅` typed in a sentence are the same mark on the same board, and a
 * board that drew them in two different faces would be lying about one of
 * them. The knowledge lives here rather than in either consumer for exactly
 * that reason.
 *
 * ─── How this was measured (2026-08-12, macOS 26, Chrome 151) ─────────────
 *
 * Two instruments, because a font-family check answers about the FAMILY and
 * never about the GLYPH (the G8-A trap: `document.fonts.check` and the
 * computed `font-family` both read back perfectly clean while a glyph is
 * quietly drawn by something else):
 *
 *  1. The faces' own `cmap` tables, parsed off disk — Chalkboard SE (1056
 *     codepoints), Bradley Hand (1505), HanziPen SC (29184). These are the
 *     three real faces the shipped `--hand` stacks name.
 *  2. CDP `CSS.getPlatformFontsForNode` on the live board, which names the
 *     face the rasterizer actually chose, plus `measureText`'s advance and
 *     `actualBoundingBox*` ink extents at 40px.
 *
 * The sweep, on the dark stack `"Chalkboard SE", "HanziPen SC", "Bradley
 * Hand", "Segoe Print", cursive` (light swaps the first two):
 *
 * | glyph | in Chalkboard / Bradley | drawn by | advance | ink | fill |
 * |---|---|---|---|---|---|
 * | `∣` U+2223 | no / no | HanziPen SC | 41.2 | 2.3 | **0.06** |
 * | `⋅` U+22C5 | no / no | HanziPen SC | 12.6 | 4.4 | 0.35 |
 * | `−` U+2212 | no / yes | HanziPen SC | 32.0 | 27.8 | 0.87 |
 * | `→` U+2192 | no / no | HanziPen SC | 41.2 | 37.2 | **0.90** |
 * | `∥` U+2225 | no / no | HanziPen SC | 41.2 | 21.2 | 0.52 |
 * | `⋯` U+22EF | no / no | **Kaiti SC** | 40.0 | 30.8 | 0.77 |
 * | `×` U+00D7 | no / yes | HanziPen SC | 20.6 | 16.5 | 0.80 |
 *
 * `fill` = ink ÷ advance, and it is the number that separates a defect from
 * a taste: `∣` puts a 2.3px hairline in a 41.2px full-width CJK slot, which
 * is what made every conditional probability on every board look broken.
 * `→` fills 0.90 of the same slot — a properly drawn full-width arrow, in a
 * face the board itself declares, beside CJK neighbours that are drawn at
 * exactly that width by exactly that face. Same face, same advance, opposite
 * verdict. The advance was never the defect; the emptiness was.
 *
 * ─── The three outcomes, and which glyph got which ───────────────────────
 *
 * SUBSTITUTE — the table below. A same-mark codepoint that BOTH hand faces
 * carry (verified in the cmap tables: U+007C, U+002D and U+00B7 are in
 * Chalkboard SE, Bradley Hand and HanziPen SC alike).
 *
 * LEAVE, AND SAY SO — `→ ← ↑ ↓` have no arrow anywhere in either hand face,
 * so there is nothing honest to swap to (`->` is two codepoints and a
 * different mark); they render from HanziPen SC at 0.90 fill and read as
 * drawn. `∥ U+2225` has no equivalent either (U+2016 is in neither face).
 * `⋯ U+22EF` falls all the way out of the declared stack to Kaiti SC, and
 * its only candidate `…` U+2026 sits on the baseline where `⋯` sits on the
 * midline — in TeX that is the difference between `\ldots` and `\cdots`, so
 * printing one for the other would be a lie about the mathematics. `×` is
 * absent from Chalkboard SE with no substitute of its own (`x` is a letter,
 * not a multiplication sign) and renders at 0.80 fill. The board's §6.4-A
 * chip names whatever a given board's own text cannot form
 * (`factories/env.ts::glyphsFallingBack`), so "leave it" never means
 * "say nothing".
 *
 * NEVER PROBE AT RUNTIME — the substitution is unconditional. A coverage
 * probe would make one TeX string, one sentence, render differently from
 * machine to machine, and export determinism is not for sale for a cosmetic
 * gain of zero: the two characters are the same mark everywhere.
 */

/**
 * Glyph → the same mark in a codepoint every hand face carries.
 *
 * Every entry MUST be 1:1 in UTF-16 code units. `prose.ts` tracks source
 * offsets (`plainCursor`, the §4.3 align spacer) against the ORIGINAL text
 * while writing the substituted text into the DOM, and `inference.ts` plans
 * durations off source spans — a length-changing entry would silently slide
 * both. `__tests__/hand-glyphs.test.ts` pins it over the whole table.
 */
export const HAND_SUBSTITUTIONS: ReadonlyMap<string, string> = new Map([
  ["∣", "|"], // U+2223 DIVIDES        → U+007C VERTICAL LINE
  ["−", "-"], // U+2212 MINUS SIGN     → U+002D HYPHEN-MINUS
  ["⋅", "·"], // U+22C5 DOT OPERATOR   → U+00B7 MIDDLE DOT
]);

/**
 * A character class over every key of the table. Two objects on purpose: a
 * `g` regex carries `lastIndex` across calls, so the one used to TEST must
 * not be the one used to REPLACE — sharing them makes every second probe on
 * the same text answer `false`.
 */
const SUBSTITUTION_CLASS = `[${[...HAND_SUBSTITUTIONS.keys()].join("")}]`;
const HAS_SUBSTITUTION = new RegExp(SUBSTITUTION_CLASS);
const ALL_SUBSTITUTIONS = new RegExp(SUBSTITUTION_CLASS, "g");

/**
 * Rewrite every substitutable glyph in `text`. Returns the SAME string
 * object when nothing matches — one regex test, no allocation, which is
 * what the overwhelming majority of calls do (this runs per segment span
 * and per gap text node of every written line).
 */
export function substituteHandGlyphs(text: string): string {
  if (!HAS_SUBSTITUTION.test(text)) return text;
  return text.replace(ALL_SUBSTITUTIONS, (ch) => HAND_SUBSTITUTIONS.get(ch) ?? ch);
}

/** Does `text` carry anything the table rewrites? */
export function hasHandSubstitution(text: string): boolean {
  return HAS_SUBSTITUTION.test(text);
}

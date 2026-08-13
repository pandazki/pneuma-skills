/**
 * Math factory (T3) — KaTeX as a PARSER ONLY, `output: "mathml"`.
 *
 * D5 boundary: this file is the ONLY module in the whole engine allowed to
 * import an external package. KaTeX's HTML output (a pile of absolutely
 * positioned spans) is deliberately not used — MathML is a real element
 * tree the browser renders natively (MathML Core: Chromium 109+ / Safari /
 * Firefox), and a `clip-path` left→right wipe reveals it in exactly the
 * order a hand writes a formula out.
 *
 * Choosing MathML costs one thing, and this file pays it: the UA stylesheet
 * owns math typography. `math { font-family: math }` re-points every leaf at
 * the platform's OpenType MATH face (Latin Modern Math / STIX Two / Cambria
 * Math) no matter what the board declared, and `mi { text-transform:
 * math-auto }` re-maps single-letter identifiers onto the Mathematical
 * Italic block (`T` → U+1D447) that no handwriting face covers. Left alone,
 * a formula renders letterpress-perfect two lines under handwritten prose —
 * 「太工整了。。完全没有手写板书的感觉」. `handwriteMathTree` below takes both
 * back; `drawHandFractionBars` takes back the one line the UA still paints.
 */

import katex from "katex";

import { Ease } from "../easing.js";
import { planStepUnits } from "../inference.js";
import { jitterLine, mulberry32, type Rand } from "../sketch/index.js";
import { clipWipe } from "../strategies/wipe.js";
import type { RevealableFactory } from "../types.js";
import { hasHandSubstitution, substituteHandGlyphs } from "./hand-glyphs.js";
import { el, fnv1a, inertRevealable, type StyledElement } from "./svg.js";

/** MathML token elements — the leaves that actually carry ink. */
const TOKEN_SELECTOR = "mi, mn, mo, mtext, ms";

/**
 * A delimiter the author asked to be SIZED to its content — KaTeX renders
 * `\left(` / `\right)` as `<mo fence="true">`, and an explicitly stretchy
 * operator as `stretchy="true"`. (A plain `(` carries `stretchy="false"`
 * and is an ordinary glyph.)
 */
const isSizingFence = (node: Element): boolean =>
  node.localName === "mo" &&
  (node.getAttribute("fence") === "true" ||
    node.getAttribute("stretchy") === "true");

/**
 * Operators TeX sets TIGHT when they have no left operand — the only ones
 * whose spacing this file is allowed to touch. Chromium's MathML operator
 * dictionary gives each of them infix spacing unconditionally
 * (0.222em on both sides at these sizes), because the dictionary is keyed
 * by character and knows nothing about position; TeX decides prefix vs
 * infix from the atom to the left. `P(+)` is the visible cost: the `+` sat
 * in `P( + )` with a full thick space on each side.
 *
 * The set is deliberately tiny. `=`, `×`, `⋅` and every relation can never
 * be prefix, so they are never eligible and a formula like `a = b` cannot
 * be reached by this pass at all. Both `−` U+2212 and `-` U+002D are
 * listed because the substitution above rewrites one into the other, and
 * the classifier must not depend on which pass ran first.
 */
const UNARY_CAPABLE = new Set(["+", "−", "-", "±", "∓"]);

/**
 * `<mo>` texts that unambiguously OPEN — nothing to their left belongs to
 * the operator that follows them.
 */
const OPENING_MARKS = new Set(["(", "[", "{", "⟨", "⌈", "⌊", "⟦", "（", "「", "【", "〈"]);

/**
 * `<mo>` texts that unambiguously CLOSE, plus the postfix marks. Both leave
 * a complete operand behind them, so an operator following one of these is
 * genuinely INFIX and must keep its spacing: `(a+b) - c` and `n! + m` are
 * the two cases a naive "previous sibling is another operator" rule gets
 * wrong, and spacing those tight would be a worse defect than the one this
 * pass exists to fix.
 */
const CLOSING_MARKS = new Set([")", "]", "}", "⟩", "⌉", "⌋", "⟧", "）", "」", "】", "〉"]);
const POSTFIX_MARKS = new Set(["!", "‼", "′", "″", "‴", "°", "%", "‰", "*"]);

/**
 * The hand's budget for ONE expression, in CSS px / degrees peak-to-peak.
 *
 * `slant` is drawn ONCE per formula and added to every glyph: that shared
 * lean is the whole claim that one hand wrote one thing. `dx` / `dy` / `rot`
 * are the residual on top of it, and they are drawn from a SMOOTH field in
 * leaf order (see `handStrokes`) rather than independently — neighbours
 * move together, so a `(` still matches its `)`, a bar still sits between
 * the things it separates, and a numerator still stands over its
 * denominator.
 *
 * The predecessor drew each leaf's own `(rnd() - 0.5) × range` with
 * `rot: 5.2`, which let two adjacent glyphs differ by the full 5.2°.
 * Measured on the bayes board: 39 atoms, 39 uncorrelated transforms — on
 * prose that reads as a hand, inside a formula it reads as broken, because
 * a formula's alignment carries its meaning.
 *
 * Deliberately small in Y — the host's own `clip-path: inset(...)` clips at
 * its border box, so a glyph pushed far enough out of the box loses its top
 * or bottom to the reveal window.
 */
export const MATH_HAND = {
  /** One lean for the whole expression. */
  slant: 1.8,
  /** Residual rotation around that lean, per glyph. */
  rot: 0.9,
  /** Baseline undulation. */
  dy: 1.3,
  /** Horizontal drift. */
  dx: 0.9,
} as const;

/**
 * Wavelengths of the residual field, in TOKEN LEAVES. Mutually prime-ish so
 * the three components never line up into a visible repeat, and all long
 * enough that a matched pair a few glyphs apart stays matched: the largest
 * step two NEIGHBOURS can take apart is `amplitude × 2sin(π / period)`,
 * which at these numbers is 0.20px of Y and 0.15° of rotation — against the
 * 2.2px and 5.2° the independent draw allowed.
 */
const HAND_PERIOD = { dx: 23, dy: 17, rot: 19 } as const;

const TAU = Math.PI * 2;

/** One leaf's paint-time displacement. */
export interface HandStroke {
  readonly dx: number;
  readonly dy: number;
  readonly rot: number;
}

/**
 * The hand's displacement field for `count` token leaves in reading order.
 *
 * FOUR draws, always — never one per leaf. The wobble and the fraction bar
 * beneath it share one PRNG stream (see `buildMathNode`), so a per-leaf draw
 * would make the bar's geometry depend on how many glyphs happened to
 * precede it: the same fraction would get a different bar inside a longer
 * expression. A fixed parameter count is what makes "one stream, one hand"
 * structurally true instead of merely stated.
 *
 * Pure, and pure of the DOM: the correlation properties this file exists to
 * hold are provable here without a layout engine.
 */
export function handStrokes(count: number, rnd: Rand): HandStroke[] {
  const slant = (rnd() - 0.5) * MATH_HAND.slant;
  const phaseDx = rnd() * TAU;
  const phaseDy = rnd() * TAU;
  const phaseRot = rnd() * TAU;
  const strokes: HandStroke[] = [];
  for (let i = 0; i < count; i++) {
    strokes.push({
      dx:
        Math.sin(phaseDx + (TAU * i) / HAND_PERIOD.dx) * (MATH_HAND.dx / 2),
      dy:
        Math.sin(phaseDy + (TAU * i) / HAND_PERIOD.dy) * (MATH_HAND.dy / 2),
      rot:
        slant +
        Math.sin(phaseRot + (TAU * i) / HAND_PERIOD.rot) *
          (MATH_HAND.rot / 2),
    });
  }
  return strokes;
}

/**
 * Render TeX to a MathML-bearing host element. Never throws: KaTeX parse
 * errors surface as KaTeX's own error markup (`throwOnError: false`), and
 * anything harder degrades to the visible TeX source plus a
 * `data-bansho-math-error` attribute — the viewer badges it, the board
 * survives (R6 blast-radius discipline, no silent failure).
 *
 * `measureHost` is the §5.2 measurement seam (`MeasureContext.measureHost`):
 * supply it and the fraction bars are DRAWN instead of ruled. It is optional
 * because the inline `$…$` call site (prose factory) builds a math host as
 * one run inside a larger paragraph node and has no box of its own to
 * measure yet; inline math therefore keeps the UA's ruled bar. That is a
 * boundary, not an oversight — see `drawHandFractionBars`.
 */
export function buildMathNode(
  doc: Document,
  tex: string,
  display: boolean,
  measureHost?: Element,
): StyledElement {
  const host = doc.createElement(display ? "div" : "span") as StyledElement;
  host.className = display
    ? "bansho-math bansho-math-block"
    : "bansho-math bansho-math-inline";
  // The clipped box must HUG the formula, in both forms — the wipe window
  // is a percentage of THIS element, so any slack around the glyphs is dead
  // air the pen spends writing nothing. Measured on the T5 tech-zh board
  // before this line existed: a `$$…$$` host was 994px wide (block-level
  // `<math display="block">` fills its line) around a 229px formula, so the
  // sweep spent 38% of the beat left of the first glyph and 38% right of
  // the last, and the formula visibly wrote during ~18% of its own reveal.
  // The inline form was already immune — hence `inline-block` here first.
  // Geometry belongs to the engine (it sets `clipPath` two lines down);
  // keeping it inline-style also puts it out of reach of a seed's theme.css.
  host.style.display = display ? "block" : "inline-block";
  if (display) host.style.width = "fit-content";
  // §7 R1 — unrevealed is the DEFAULT state, set at creation: if the
  // plan↔DOM mirror drifts and this host's unit degrades to inert, the
  // formula fails CLOSED (stays clipped) instead of painting at t=0.
  host.style.clipPath = "inset(0 100% 0 0)";
  try {
    host.innerHTML = katex.renderToString(tex, {
      output: "mathml",
      throwOnError: false,
      displayMode: display,
    });
  } catch (err) {
    host.textContent = display ? `$$${tex}$$` : `$${tex}$`;
    host.setAttribute(
      "data-bansho-math-error",
      err instanceof Error ? err.message : String(err),
    );
  }
  // Content-derived seed, exactly like `contentSeed` (svg.ts) — a streaming
  // re-parse mints fresh Step objects at shifted offsets (§7 R1/R4), and a
  // formula already on the board must not re-wobble when the next line
  // lands. Both passes share ONE stream: the wobble and the bar under it
  // are one hand writing one formula.
  const rnd = mulberry32(fnv1a(`math\x00${tex}`));
  handwriteMathTree(host, rnd);
  if (measureHost) {
    // Layout is only readable while the node is in a styled, laid-out
    // container. The measure host is style-complete (`.bansho-board`
    // typography) and the formula's own box is parent-width-independent —
    // `width: fit-content` and MathML never wraps — so what is measured
    // here is what will be mounted.
    measureHost.appendChild(host);
    try {
      drawHandFractionBars(doc, host, rnd);
    } finally {
      measureHost.removeChild(host);
    }
  }
  return host;
}

/**
 * Take math typography back from the UA sheet, then let the hand shake.
 *
 * Two writes carry the typeface, and BOTH are load-bearing:
 *  - `font-family: inherit` on `<math>` beats `math { font-family: math }`
 *    (inline style outranks the UA sheet) and propagates to every leaf.
 *    `inherit`, never a named face and never `var(--hand)`: §6.3 makes the
 *    stack the SEED's property, so the engine must not learn the token's
 *    name — inheriting hands the decision back to `.bansho-board`.
 *  - `text-transform: none` on `<mi>` disarms the UA's `math-auto`, which
 *    would otherwise re-map `T` to U+1D447 (MATHEMATICAL ITALIC CAPITAL T).
 *    No handwriting face covers U+1D400–U+1D7FF, so per-glyph fallback
 *    would quietly re-typeset every variable in a math font while the
 *    computed `font-family` read back as the hand — the G8-A failure shape:
 *    a font that is not the font you asked for, with nothing to show for it.
 *    The cost is that variables come out UPRIGHT rather than italic, which
 *    is what a hand at a blackboard actually writes.
 *
 * A third write carries the glyphs the hand cannot form at all
 * (`HAND_SUBSTITUTIONS`, hand-glyphs.ts): the same mark, in a codepoint the
 * face covers. Only a NON-fence leaf is rewritten — a sizing delimiter
 * keeps `∣` because the math face it is handed below covers it properly and
 * grows it with its content, which is the whole reason that exemption
 * exists.
 *
 * A fourth takes back the one thing MathML spaces wrong: an operator with
 * no left operand (`tightenPrefixOperators`). It runs over the finished
 * tree, after the rewrite, so it classifies the characters that will be
 * drawn.
 *
 * Then the wobble: `translate` + `rotate` per token leaf, seeded, off ONE
 * correlated field (`handStrokes`) rather than an independent draw per
 * glyph. Transform is paint-time by construction, so this pass cannot move
 * a single box — every downstream step rect, every ink measurement and the
 * layout-baseline A/B are untouched by it.
 *
 * A stretched fence (`\left( … \right)` → `<mo fence="true">`) is skipped:
 * it is ONE tall drawn gesture spanning the whole expression, and a tilted
 * one reads as broken glass rather than as a hand.
 */
function handwriteMathTree(host: Element, rnd: Rand): void {
  const math = host.querySelector("math") as StyledElement | null;
  if (!math) return; // KaTeX's error markup — nothing to re-hand.
  math.style.fontFamily = "inherit";
  const leaves = Array.from(host.querySelectorAll(TOKEN_SELECTOR));
  // Drawn BEFORE the walk and sized to every leaf, fences included, so the
  // stream position after this call depends on nothing but the formula's
  // length — and a leaf's stroke is its reading-order index, which is what
  // makes the field smooth along the line the eye follows.
  const strokes = handStrokes(leaves.length, rnd);
  leaves.forEach((node, i) => {
    const leaf = node as StyledElement;
    if (leaf.localName === "mi") leaf.style.textTransform = "none";
    if (isSizingFence(leaf)) {
      // A sizing delimiter is the ONE thing deliberately left typeset, and
      // it needs its own face back to do its job: a delimiter grows by
      // swapping in the size variants / assembly parts an OpenType MATH
      // table carries, and no handwriting face has one. Under `inherit`
      // alone, `\left(` around a fraction stayed glyph-sized and collided
      // with the numerator (measured on the G7 board) — a wrong formula,
      // not a hand. `\left`/`\right` is exactly the author saying "size
      // this to the content", so the sizing font answers; a plain `(`
      // carries no fence attribute and takes the hand like everything else.
      // Not tilted either: it is one tall drawn gesture, and rotating a
      // stretched delimiter reads as broken glass.
      leaf.style.fontFamily = "math";
      return;
    }
    substituteLeafGlyphs(leaf);
    const stroke = strokes[i]!;
    leaf.style.transform =
      `translate(${stroke.dx.toFixed(2)}px, ${stroke.dy.toFixed(2)}px) ` +
      `rotate(${stroke.rot.toFixed(2)}deg)`;
  });
  // Last, and over the whole tree: the classifier reads the character that
  // will actually be drawn, and it reads siblings the walk above may have
  // rewritten.
  tightenPrefixOperators(host);
}

/**
 * Swap any glyph in `HAND_SUBSTITUTIONS` (hand-glyphs.ts — shared with the
 * prose factory, because a `\cdot` and a typed `⋅` are the same mark on the
 * same board) for the codepoint the hand covers. No-op for the overwhelming
 * majority of leaves — one regex test against the text, no allocation
 * unless something matches.
 *
 * A rewritten `<mo>` is pinned `stretchy="false"`. `|` is a fence in the
 * MathML operator dictionary while `∣` is a relation, and the first `\mid`
 * of `P(D \mid +) = \frac{…}{…}` shares its `<mrow>` with the `<mfrac>` —
 * a stretchy `|` there can grow to the fraction's full height, which would
 * be a genuine mis-render introduced while fixing a cosmetic one. The
 * substitution must never change what the notation says.
 */
function substituteLeafGlyphs(leaf: StyledElement): void {
  const text = leaf.textContent;
  if (text === null || !hasHandSubstitution(text)) return;
  leaf.textContent = substituteHandGlyphs(text);
  if (leaf.localName === "mo") leaf.setAttribute("stretchy", "false");
}

/**
 * Does the `<mo>` to the left of `node` leave a complete operand behind it?
 *
 * A LOCAL read of the tree, and nothing more — this is not TeX's mu-skip
 * inference and does not try to be. Three questions, all answerable from
 * one sibling:
 *
 *  - Nothing to the left at all (first child of its `<mrow>`, of an
 *    `<msup>`'s exponent row, of anything) → no operand. `-x`, `x^{-2}`.
 *  - The left sibling is not an `<mo>` (an `<mi>`, `<mn>`, `<mfrac>`,
 *    `<msqrt>`, `<mrow>`, an `<mspace>` from `\,`) → there IS an operand,
 *    and the operator is genuinely infix. `a + b`, `\frac{a}{b} + c`.
 *  - The left sibling IS an `<mo>` → the character decides. An opener
 *    leaves nothing (`P(+)`, `[-1, 1]`); a closer or a postfix mark leaves
 *    a finished operand (`(a+b) - c`, `n! + m`); anything else — a
 *    relation, an infix operator, a separator — leaves nothing
 *    (`P(D ∣ +)`, `x = +1`, `f(a, -b)`, `a - -b`).
 *
 * A SIZING fence whose character is ambiguous is the one case that cannot
 * be read locally: KaTeX marks both `\left|` and `\right|` as
 * `<mo fence="true">|</mo>` with no side attribute, so `\left|x\right| + y`
 * and `\left| +x \right|` are indistinguishable here. That case answers
 * "operand present" — the safe direction, which keeps a genuine infix
 * operator spaced and at worst leaves one prefix operator looking as it
 * does today. Unambiguous fences (`(`, `)`) are read by character, so
 * `\left( +b \right)` is still handled.
 */
function hasLeftOperand(node: Element): boolean {
  const prev = node.previousElementSibling;
  if (!prev) return false;
  if (prev.localName !== "mo") return true;
  const text = (prev.textContent ?? "").trim();
  if (OPENING_MARKS.has(text)) return false;
  if (CLOSING_MARKS.has(text) || POSTFIX_MARKS.has(text)) return true;
  return isSizingFence(prev);
}

/**
 * Set every prefix operator's spacing tight, and report how many were set.
 *
 * Chromium's operator dictionary spaces `+` as infix wherever it appears,
 * so `P(+)` renders `P( + )` with a thick space on each side — TeX sets an
 * operator with no left operand as an Ord atom, i.e. tight on both sides.
 * `lspace`/`rspace` on the `<mo>` are the MathML Core knobs for exactly
 * this, and they are attributes on the element the tree already has, so
 * this pass moves no box it does not own.
 *
 * Runs AFTER `substituteLeafGlyphs` so the character it classifies is the
 * character that will be drawn; `UNARY_CAPABLE` carries both spellings of
 * minus anyway, so the pass is order-independent by construction rather
 * than by convention.
 */
export function tightenPrefixOperators(host: Element): number {
  let tightened = 0;
  for (const node of Array.from(host.querySelectorAll("mo"))) {
    if (!UNARY_CAPABLE.has((node.textContent ?? "").trim())) continue;
    if (hasLeftOperand(node)) continue;
    node.setAttribute("lspace", "0");
    node.setAttribute("rspace", "0");
    tightened++;
  }
  return tightened;
}

/** How far past the fraction the pen runs at each end, px (clamped). */
const BAR_OVERSHOOT = 3;

/**
 * Does an `mfrac`'s `linethickness` already mean "no bar"? The unit is the
 * author's choice — KaTeX writes `0px` for `\binom`, hand-written MathML
 * may write a bare `0` — so the numeric part is what decides.
 */
const isBarless = (value: string | null): boolean =>
  value !== null && /^0*(?:\.0*)?[a-z%]*$/i.test(value.trim());

/**
 * Replace every ruled fraction bar with a drawn one, and report how many
 * were drawn.
 *
 * The UA's `mfrac` bar is the one mechanically straight, uniformly thick,
 * perfectly horizontal line left on a board where the heading baseline, the
 * aside's margin bar, the `---` rule and every ink gesture are pulled by
 * `jitterLine` — the same objection `rule.ts` records against a CSS border.
 * `linethickness="0"` switches the ruled bar off; one jittered path in an
 * overlay inside the host takes its place, with a small overshoot at each
 * end because a hand crossing a fraction does not stop on the millimetre.
 *
 * It FAILS CLOSED, in this order: measure, draw, and only then zero the
 * attribute. Without a layout engine (happy-dom, an unmounted host) every
 * rect is zeros, nothing is drawn and the ruled bar survives — a straight
 * bar is a blemish, a missing one is a wrong formula.
 *
 * The overlay is a child of the clipped host on purpose: `clip-path` clips
 * every descendant, positioned or not, so the bar is revealed by the SAME
 * left→right sweep as the glyphs around it — no second beat, no schedule
 * change, no risk to the reveal order MathML was chosen for.
 */
export function drawHandFractionBars(
  doc: Document,
  host: StyledElement,
  rnd: Rand,
): number {
  const box = host.getBoundingClientRect();
  if (!(box.width > 0) || !(box.height > 0)) return 0;
  let svg: StyledElement | null = null;
  let drawn = 0;
  for (const frac of Array.from(host.querySelectorAll("mfrac"))) {
    // `\binom` and friends ship barless already (KaTeX writes `0px`, not
    // `0`) — leave them barless.
    if (isBarless(frac.getAttribute("linethickness"))) continue;
    const num = frac.children[0];
    const den = frac.children[1];
    if (!num || !den) continue;
    const fb = frac.getBoundingClientRect();
    const nb = num.getBoundingClientRect();
    const db = den.getBoundingClientRect();
    const gap = db.top - nb.bottom;
    if (!(fb.width > 0) || !(gap > 0)) continue;
    // The bar rides the math axis, which with a ruled bar sits at the
    // middle of the numerator↔denominator gap. Zeroing the thickness moves
    // that gap by hundredths of a px (measured on the live board), so
    // measuring BEFORE the switch-off is exact enough to draw into.
    const y = (nb.bottom + db.top) / 2 - box.top;
    const over = Math.min(BAR_OVERSHOOT, fb.width * 0.08);
    const x0 = Math.max(0, fb.left - box.left - over);
    const x1 = Math.min(box.width, fb.right - box.left + over);
    if (!(x1 - x0 > 1)) continue;
    const amp = Math.min(1.3, Math.max(0.5, (x1 - x0) * 0.02));
    if (!svg) {
      // `position: relative` (never a z-index) makes the host the overlay's
      // containing block WITHOUT minting a stacking context — the backref
      // mount contract that every step node keeps.
      host.style.position = "relative";
      svg = el(doc, "svg", { viewBox: `0 0 ${box.width} ${box.height}` });
      svg.style.position = "absolute";
      svg.style.left = "0";
      svg.style.top = "0";
      svg.style.width = "100%";
      svg.style.height = "100%";
      svg.style.overflow = "visible";
      svg.style.pointerEvents = "none";
      host.appendChild(svg);
    }
    const path = el(
      doc,
      "path",
      { d: jitterLine(x0, y, x1, y, rnd, amp) },
      {
        fill: "none",
        // G8-D — a `var()` on an SVG presentation attribute is dropped in
        // silence; the pen colour rides element.style or it does not ride.
        stroke: "var(--board-fg, currentColor)",
        strokeWidth: `${Math.min(3.4, Math.max(1.6, gap * 0.32)).toFixed(2)}px`,
        strokeLinecap: "round",
      },
    );
    svg.appendChild(path);
    frac.setAttribute("linethickness", "0");
    drawn++;
  }
  return drawn;
}

/** Block-level `$$…$$` — one formula, one left→right wipe beat. */
export const mathFactory: RevealableFactory = {
  kind: "math",
  build(step, ctx) {
    const units = planStepUnits(step, ctx.durations);
    const tex = step.kind === "math" ? step.tex : "";
    const node = buildMathNode(ctx.document, tex, true, ctx.measureHost);
    const revealables = units.map((unit) =>
      unit.kind === "math"
        ? clipWipe(node, {
            duration: unit.duration,
            srcSpan: unit.srcSpan,
            ease: Ease.write,
            side: "ltr",
          })
        : inertRevealable(unit),
    );
    return { node, revealables };
  },
};

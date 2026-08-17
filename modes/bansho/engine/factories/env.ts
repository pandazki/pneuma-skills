/**
 * EnvCaps probe (T3) — session-fixed capability detection for RevealKind
 * negotiation (§5.2).
 *
 * G8-A — font activation MUST be verified by canvas width measurement.
 * `document.fonts.check()` returns true for ANY system font name, present
 * or not, and cannot be trusted: `Hannotate SC` silently falls back to
 * PingFang (identical measured width = not rendering), and the handwriting
 * texture quietly disappears. A candidate is ACTIVE only when its measured
 * width differs from the known fallback's.
 *
 * Call once per session AFTER `document.fonts.ready`; the result must stay
 * constant for the session (scrub/export determinism depends on it).
 *
 * TODO(§5.2): `MeasureContext.env` has no factory consumers yet — see the
 * TODO on that field (engine/types.ts) for the wiring plan (T4 host probe,
 * Hershey-gated chart-mark stroke, §6.4-A degradation warning).
 */

import type { EnvCaps } from "../types.js";

export interface ProbeOptions {
  /** The handwriting candidate. Default `HanziPen SC` (翩翩体) — NOT
   *  `Hannotate SC`, which silently falls back to 苹方 (§6.4-A). Used only
   *  when no declared stack can be read off the document. */
  candidate?: string;
  /** A font known to be the fallback the candidate would collapse into. */
  knownFallback?: string;
  /** CJK-bearing sample — Latin-only text cannot expose a CJK fallback. */
  sample?: string;
  /**
   * The family lists to measure, verbatim CSS `font-family` syntax. Supply
   * this to bypass the DOM read (tests, or a host that already knows the
   * board's stack). Empty array = "measure nothing declared", which falls
   * back to `candidate`.
   */
  stacks?: readonly string[];
}

/**
 * Theme variants to probe under. `BoardCanvas` renders
 * `data-bansho-theme={theme}` with `theme: "light" | "dark"`
 * (ViewerPreviewProps) — the attribute is ALWAYS present, so both values
 * must be measured and the attribute-less state must NOT be: probing it
 * measures a DOM state the board is never in, and a seed that scopes its
 * light override as `[data-bansho-theme="light"]` (the natural mirror of
 * the dark rule) would escape the check entirely. Base-selector
 * declarations still resolve under either attribute value, so nothing is
 * lost by never probing bare.
 */
const THEME_VARIANTS = ["light", "dark"] as const;

/**
 * The board's DECLARED handwriting stacks — the computed `--hand` of a
 * `.bansho-board-surface` probe element, one per theme variant.
 *
 * §6.3 makes the stack the SEED's property (`theme.css` overrides
 * `BOARD_BASE_CSS`), so measuring a hardcoded face answers the wrong
 * question in both directions: a seed that legitimately picks another
 * handwriting face raises a false §6.4-A chip, and a seed whose stack
 * contains no handwriting face at all gets a clean bill of health — which
 * is exactly the silent degradation the chip exists to catch.
 *
 * Both variants are measured because `EnvCaps` is session-fixed (§5.2):
 * the probe cannot re-run when the user flips the theme, so a stack that
 * only degrades in the other theme has to be caught now. Returns `[]` when
 * the document cannot be measured (no styles attached, non-DOM host).
 */
export function readHandStacks(doc: Document): string[] {
  const body = doc.body;
  if (!body || typeof doc.createElement !== "function") return [];
  const view = doc.defaultView;
  if (!view || typeof view.getComputedStyle !== "function") return [];
  const probe = doc.createElement("div");
  probe.className = "bansho-board-surface";
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  body.appendChild(probe);
  try {
    const stacks: string[] = [];
    for (const variant of THEME_VARIANTS) {
      probe.setAttribute("data-bansho-theme", variant);
      const hand = view.getComputedStyle(probe).getPropertyValue("--hand").trim();
      if (hand && !stacks.includes(hand)) stacks.push(hand);
    }
    return stacks;
  } finally {
    body.removeChild(probe);
  }
}

const INACTIVE: EnvCaps = {
  handwritingFontActive: false,
  // The vendored Hershey single-line font ships in a later task; until it
  // does, no text can negotiate the stroke reveal (wipe is the fallback).
  strokeFontCovers: () => false,
};

// ── THE INSTRUMENT: compare the INK, never the advance ─────────────────────
//
// Every probe below asks one question — "did naming this family change what
// gets DRAWN?" — and for a long time answered it by comparing advance
// widths. That is sound for Latin and structurally impossible for CJK: Han
// glyphs are FULL-WIDTH, exactly 1 em, in essentially every CJK face. It is
// the script's convention, not a coincidence, so two different Chinese faces
// do not merely risk measuring the same, they measure the same by
// construction.
//
// Measured on the live board (2026-08-17, Chrome 151, `slate-cursive`):
// `CSS.getPlatformFontsForNode` on the real ink node named `Xingkai SC`
// (`STXingkaiSC-Light`, installed as an optional macOS font asset) drawing
// every character — while the width probe reported it missing, the picker
// warned "not on this machine: Xingkai SC", and the §6.4-A chip named all
// 312 Chinese characters of the lecture as having fallen back. Three
// warnings, all false, about a board rendering exactly what it promised.
// `"Xingkai SC", monospace` and `monospace` both measure 4 × 34 = 136px for
// 板书手写; their rasters share not one byte.
//
// So the instrument is a raster: draw the sample twice and compare the alpha
// channel. Different faces draw different ink, and the ink is the question.

/**
 * The three generic families every engine resolves to a real, and mutually
 * different, face. Asking "is X installed?" is really asking "does naming X
 * in front of a sentinel change what gets drawn?", and one sentinel is not
 * enough: a face can coincide with `monospace`'s ink on a sample that
 * exercises none of their differences, and on a machine where it does, a
 * single-sentinel probe declares an installed face missing. Three disagree
 * far more reliably than one.
 */
const SENTINELS = ["monospace", "serif", "sans-serif"] as const;

/** The type size every probe measures at. */
const PROBE_PX = 28;
/** Canvas box per glyph, in em — generous enough for any face's advance. */
const BOX_W_EM = 1.6;
const BOX_H_EM = 2.2;
/** Baseline offset, in em. Comfortably below any hand face's ascent. */
const BASELINE_EM = 1.6;
/** Never allocate wider than this, whatever the sample. */
const MAX_BOX_W = 2048;
/**
 * Two glyphs — one Han, one Latin — drawn under a generic that always
 * resolves. Used only to ask the canvas whether it is an instrument at all.
 */
const SELF_CHECK = "A板";

/** What a face drew, reduced to something comparable. */
interface Mark {
  /** A hash of the alpha channel. Equal keys = byte-identical ink. */
  readonly key: string;
  /** Non-transparent pixels. Zero means nothing was drawn at all. */
  readonly ink: number;
}

interface Raster {
  /** Draw `sample` under the CSS family list `families` and sign the ink. */
  mark(families: string, sample: string): Mark;
}

/** Code points, not UTF-16 units — an astral glyph is one box, not two. */
const glyphCount = (sample: string): number => [...sample].length;

/**
 * A canvas sized for `glyphs` characters, or `null` when this host has no
 * usable instrument.
 *
 * Two things disqualify a canvas, and BOTH have to answer "unknown" rather
 * than "the face is missing":
 *
 *  ⋅ it draws nothing (happy-dom, jsdom, a locked-down browser) — every
 *    signature would then be identical and every family would read as
 *    absent, which is an invention, not a measurement;
 *  ⋅ it answers differently twice. A browser defending against canvas
 *    fingerprinting perturbs readback, and a probe that believed the noise
 *    would report every family on earth as PRESENT — the wrong failure
 *    direction for a warning (see `familyAvailable`).
 *
 * `willReadFrequently` matters: `glyphsFallingBack` reads back three times
 * per distinct character of the board, and a GPU-backed canvas pays a
 * readback stall on each one.
 */
function rasterFor(doc: Document, glyphs: number): Raster | null {
  if (typeof doc.createElement !== "function") return null;
  const canvas = doc.createElement("canvas") as HTMLCanvasElement;
  const g =
    typeof canvas.getContext === "function"
      ? canvas.getContext("2d", { willReadFrequently: true })
      : null;
  if (!g || typeof g.fillText !== "function" || typeof g.getImageData !== "function")
    return null;
  const w = Math.min(
    MAX_BOX_W,
    Math.ceil(Math.max(1, glyphs) * PROBE_PX * BOX_W_EM) + 8,
  );
  const h = Math.ceil(PROBE_PX * BOX_H_EM);
  canvas.width = w;
  canvas.height = h;
  const baseline = Math.round(PROBE_PX * BASELINE_EM);
  const mark = (families: string, sample: string): Mark => {
    g.clearRect(0, 0, w, h);
    g.font = `${PROBE_PX}px ${families}`;
    // `alphabetic` on purpose: `top` positions the run by the PRIMARY
    // family's ascent, so the same ink drawn through two different stacks
    // lands at two different heights and every comparison reports a
    // difference that is not there.
    g.textBaseline = "alphabetic";
    g.fillStyle = "#000";
    g.fillText(sample, 2, baseline);
    const data = g.getImageData(0, 0, w, h).data;
    let hash = 2166136261;
    let ink = 0;
    for (let i = 3; i < data.length; i += 4) {
      const alpha = data[i]!;
      hash = Math.imul(hash ^ alpha, 16777619);
      if (alpha !== 0) ink += 1;
    }
    return { key: (hash >>> 0).toString(36), ink };
  };
  const first = mark("serif", SELF_CHECK);
  if (first.ink === 0) return null;
  if (mark("serif", SELF_CHECK).key !== first.key) return null;
  return { mark };
}

/** A family name safe to drop inside a quoted CSS `font-family` entry. */
const quoted = (family: string): string => `"${family.replace(/["\\]/g, "")}"`;

/**
 * `familyAvailable`, once a raster already exists — the shared half, so a
 * caller measuring several families pays for one canvas.
 */
function availableWith(
  r: Raster,
  family: string,
  sample: string,
): boolean | null {
  let drewSomething = false;
  for (const sentinel of SENTINELS) {
    const alone = r.mark(sentinel, sample);
    // A sample this sentinel cannot draw at all carries no evidence either
    // way; another sentinel may still be able to.
    if (alone.ink === 0) continue;
    drewSomething = true;
    if (r.mark(`${quoted(family)}, ${sentinel}`, sample).key !== alone.key)
      return true;
  }
  return drewSomething ? false : null;
}

/**
 * Probe the environment. Degrades to inactive when canvas is unavailable.
 *
 * Measures the board's DECLARED `--hand` stacks (see `readHandStacks`), not
 * a hardcoded face — and reports active only when EVERY declared stack
 * draws the sample as something OTHER than the known fallback. That is the
 * exact (and the whole) claim a single-fallback comparison can establish:
 * it catches the G8-A trap (a stack whose first resolvable face IS the
 * fallback — Hannotate SC collapsing into PingFang, or a seed stack with no
 * handwriting face before the fallback), but it can NOT prove the resolved
 * face is a handwriting face — `"Times New Roman", serif` draws differently
 * from PingFang and passes. Falls back to the `candidate` face when nothing
 * is declared (a document with no board styles attached — the harness, unit
 * tests).
 *
 * Compares the RASTER, not the advance: a CJK hand and the CJK fallback are
 * both full-width, so the widths this used to compare were equal on a board
 * whose hand was drawing perfectly (see the instrument block above).
 */
export function probeEnvCaps(doc: Document, opts?: ProbeOptions): EnvCaps {
  const candidate = opts?.candidate ?? "HanziPen SC";
  const fallback = opts?.knownFallback ?? "PingFang SC";
  const sample = opts?.sample ?? "板书手写字宽验证样本";
  try {
    const r = rasterFor(doc, glyphCount(sample));
    if (!r) return INACTIVE;
    const declared = opts?.stacks ?? readHandStacks(doc);
    // `font` takes a family LIST — a declared stack goes in verbatim; a
    // bare family name is quoted here (quoting a whole list would make it
    // one bogus family and every measurement would collapse to fallback).
    const measured = declared.length > 0 ? declared : [quoted(candidate)];
    const fallbackMark = r.mark(quoted(fallback), sample);
    const active = measured.every(
      (stack) => r.mark(stack, sample).key !== fallbackMark.key,
    );
    return { handwritingFontActive: active, strokeFontCovers: () => false };
  } catch {
    return INACTIVE;
  }
}

/**
 * Is this family actually on this machine — measured, never asked.
 *
 * `document.fonts.check()` CANNOT answer this and is the trap that gave this
 * project G8-A: it returns `true` for any family name the fallback can draw,
 * so `check("Hannotate SC")` says yes on a Mac that has no such font and
 * renders every character in 苹方. There is no flag or option that fixes it —
 * the API answers a different question than the one being asked.
 *
 * What CAN answer it is the raster comparison above, narrowed to one family:
 * draw `sample` under `"<family>", <sentinel>` and under `<sentinel>` alone.
 * If the family is absent both are the sentinel's ink and are byte-identical;
 * if it is present it draws the sample and the two part. Any one sentinel
 * disagreeing is enough.
 *
 * It compares INK rather than advance width for the reason the instrument
 * block above records in full: for CJK the advance carries no identity at
 * all — Han is full-width in every CJK face — and the width version of this
 * function reported `Xingkai SC` missing on a board it was visibly drawing.
 *
 * `sample` must be script-appropriate — measuring a CJK face with Latin text
 * asks whether the FALLBACK draws Latin, which it does, and the probe would
 * report a missing face as present.
 *
 * Returns `null`, not `false`, when the instrument itself is unavailable (no
 * canvas, a canvas that draws nothing, a canvas whose readback is perturbed
 * — see `rasterFor`). A caller must show that as "unknown": claiming a face
 * is missing on no evidence is the same class of lie as claiming it is
 * present.
 *
 * WHAT IT CANNOT SAY: a family that draws `sample` pixel-for-pixel as all
 * three sentinels do reads as absent — i.e. a family that IS one of the
 * platform's generic faces. The failure direction is the safe one: it
 * under-claims availability, so the picker warns about a face that would in
 * fact have rendered rather than promising one that would not.
 */
export function familyAvailable(
  doc: Document,
  family: string,
  sample: string,
): boolean | null {
  try {
    const r = rasterFor(doc, glyphCount(sample));
    if (!r) return null;
    return availableWith(r, family, sample);
  } catch {
    return null;
  }
}

/**
 * Which of `candidates` is REALLY drawing `sample` under the declared
 * `stack` — the answer to "so what replaced the missing face?".
 *
 * The cheap version of this is to walk the stack and name the first family
 * that is installed. That is an inference from the declared order, and the
 * declared order is exactly what was wrong the last two times: it says
 * nothing about coverage (a Latin hand leads `slate-cursive` and draws no
 * Han at all) and nothing about a webfont that has not arrived. So this
 * MEASURES instead: draw the whole stack, draw each candidate alone, and
 * name the candidate whose ink is byte-identical to the stack's. That is
 * the same claim `CSS.getPlatformFontsForNode` makes, reachable from inside
 * the page.
 *
 * A candidate must independently pass `availableWith` before its raster is
 * even compared. Without that gate a family NOBODY has could be credited
 * with the drawing: named alone it renders in the platform's own face, and
 * on a stack that also fell through to that face the two rasters would
 * match.
 *
 * `null` means "no face this stack names is drawing it" — the generic tail
 * or the platform's own fallback won — and equally means "no instrument".
 * Both are honest as "we cannot name it"; neither may be shown as a face.
 */
export function drawnFamily(
  doc: Document,
  stack: string,
  sample: string,
  candidates: readonly string[],
): string | null {
  try {
    const r = rasterFor(doc, glyphCount(sample));
    if (!r) return null;
    const target = r.mark(stack, sample);
    if (target.ink === 0) return null;
    for (const family of candidates) {
      if (availableWith(r, family, sample) !== true) continue;
      if (r.mark(quoted(family), sample).key === target.key) return family;
    }
    return null;
  } catch {
    return null;
  }
}

/** How many characters the chip names before it starts counting. */
export const FALLBACK_GLYPH_LIST_CAP = 8;

/**
 * Whitespace carries no glyph, so it can never fall back and must never be
 * named. Nothing else is filtered: the dialect's own syntax (`@turn`, `##`,
 * `((…))`) is all ASCII, which every real handwriting face covers, so it is
 * silent on any working stack — and on a stack that genuinely cannot draw
 * `#`, saying so is the point.
 */
const BLANK = /\s/;

/**
 * Which of `text`'s characters the board's declared handwriting stacks
 * cannot draw — the §6.4-A chip's payload.
 *
 * WHY PER CODEPOINT. The blind trial (2026-08-11 findings §2.1) watched a
 * cold author lose an afternoon to this exact chip: their `theme.css` had
 * dropped `HanziPen SC`, so every Chinese character on their board was
 * drawn by 苹方 while the chip said only "handwriting font fallback". They
 * reached for `document.fonts.check`, got `true` for every family they
 * asked about — the G8-A lie, which answers about the FAMILY and never
 * about the GLYPH — and gave up. A chip that names 板 书 手 写 answers the
 * question they actually had ("what is missing?") in one glance.
 *
 * THE INSTRUMENT is `probeEnvCaps`'s, narrowed from a ten-character sample
 * to one character: a glyph whose INK under the declared stack is
 * byte-identical to the known fallback's is being drawn by the fallback.
 *
 * It used to compare advance widths, and on a CJK board that could only ever
 * be wrong: Han is full-width in every CJK face, so a hand that was drawing
 * beautifully measured exactly what 苹方 measures. Measured 2026-08-17 on the
 * `slate-cursive` board — `CSS.getPlatformFontsForNode` naming `Xingkai SC`
 * on the ink node while this function named all 312 Chinese characters of
 * the lecture. A chip that cries wolf over an entire board is worse than no
 * chip: it teaches the author to stop reading it, and the one time it is
 * right they will not.
 *
 * WHAT IT CANNOT SAY, and this is the same boundary `probeEnvCaps` records:
 * a comparison against ONE fallback face only catches glyphs that land on
 * THAT face. A character drawn by some third face (`⋯` resolves to Kaiti SC
 * here) is missed. The chip therefore under-reports and never over-reports,
 * which is the right direction for a warning that asks a human to go
 * looking.
 *
 * Cost is bounded by the board's DISTINCT characters, not its length, and
 * the caller re-runs it only when that set or the stylesheet changes.
 */
export function glyphsFallingBack(
  doc: Document,
  text: string,
  opts?: ProbeOptions,
): string[] {
  if (!text) return [];
  const fallback = opts?.knownFallback ?? "PingFang SC";
  try {
    const declared = opts?.stacks ?? readHandStacks(doc);
    if (declared.length === 0) return [];
    const r = rasterFor(doc, 1);
    if (!r) return [];
    const fallbackFamily = quoted(fallback);
    const seen = new Set<string>();
    const missing: string[] = [];
    for (const ch of text) {
      if (seen.has(ch) || BLANK.test(ch)) continue;
      seen.add(ch);
      const fallbackMark = r.mark(fallbackFamily, ch);
      // A character the fallback itself draws as nothing (a zero-width
      // joiner, a format control) has no ink to compare and no reader to
      // disappoint — the old width instrument flagged every one of them.
      if (fallbackMark.ink === 0) continue;
      // EVERY declared stack must be able to draw it: `EnvCaps` is
      // session-fixed and the reader can flip the theme at any moment, so a
      // character that only degrades in the other theme still has to be
      // named now (same reasoning as `THEME_VARIANTS` above).
      if (declared.some((stack) => r.mark(stack, ch).key === fallbackMark.key)) {
        missing.push(ch);
      }
    }
    return missing;
  } catch {
    return [];
  }
}

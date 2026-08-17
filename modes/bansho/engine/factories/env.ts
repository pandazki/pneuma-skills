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

/**
 * Probe the environment. Degrades to inactive when canvas is unavailable.
 *
 * Measures the board's DECLARED `--hand` stacks (see `readHandStacks`), not
 * a hardcoded face — and reports active only when EVERY declared stack
 * measures a width DIFFERENT from the known fallback's. That is the exact
 * (and the whole) claim a single-fallback width comparison can establish:
 * it catches the G8-A trap (a stack whose first resolvable face IS the
 * fallback — Hannotate SC collapsing into PingFang, or a seed stack with no
 * handwriting face before the fallback), but it can NOT prove the resolved
 * face is a handwriting face — `"Times New Roman", serif` measures
 * different from PingFang and passes. Falls back to the `candidate` face
 * when nothing is declared (a document with no board styles attached — the
 * harness, unit tests).
 */
export function probeEnvCaps(doc: Document, opts?: ProbeOptions): EnvCaps {
  const candidate = opts?.candidate ?? "HanziPen SC";
  const fallback = opts?.knownFallback ?? "PingFang SC";
  const sample = opts?.sample ?? "板书手写字宽验证样本";
  try {
    const canvas = doc.createElement("canvas") as HTMLCanvasElement;
    const g =
      typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;
    if (!g || typeof g.measureText !== "function") return INACTIVE;
    // `font` takes a family LIST — a declared stack goes in verbatim; a
    // bare family name is quoted here (quoting a whole list would make it
    // one bogus family and every measurement would collapse to fallback).
    const widthIn = (families: string): number => {
      g.font = `28px ${families}`;
      return g.measureText(sample).width;
    };
    const declared = opts?.stacks ?? readHandStacks(doc);
    const measured = declared.length > 0 ? declared : [`'${candidate}'`];
    const fallbackWidth = widthIn(`'${fallback}'`);
    const active = measured.every(
      (stack) => Math.abs(widthIn(stack) - fallbackWidth) > 0.5,
    );
    return { handwritingFontActive: active, strokeFontCovers: () => false };
  } catch {
    return INACTIVE;
  }
}

/**
 * The three generic families every engine resolves to a real, and mutually
 * different, face. Asking "is X installed?" is really asking "does naming X
 * in front of a sentinel change what gets drawn?", and one sentinel is not
 * enough: a face can coincide with `monospace`'s advances by accident, and
 * on a machine where it does, a single-sentinel probe declares an installed
 * face missing. Three disagree far more reliably than one.
 */
const SENTINELS = ["monospace", "serif", "sans-serif"] as const;

/**
 * Is this family actually on this machine — measured, never asked.
 *
 * `document.fonts.check()` CANNOT answer this and is the trap that gave this
 * project G8-A: it returns `true` for any family name the fallback can draw,
 * so `check("Hannotate SC")` says yes on a Mac that has no such font and
 * renders every character in 苹方. The same lie put a font nobody has at the
 * top of a ranking on 2026-08-17. There is no flag or option that fixes it —
 * the API answers a different question than the one being asked.
 *
 * What CAN answer it is a width comparison, which is `probeEnvCaps`'s
 * instrument narrowed to one family: measure `sample` under `"<family>",
 * <sentinel>` and under `<sentinel>` alone. If the family is absent both
 * measurements are the sentinel's and are equal; if it is present it draws
 * the sample and the widths part. Any one sentinel disagreeing is enough.
 *
 * `sample` must be script-appropriate — measuring a CJK face with Latin text
 * asks whether the FALLBACK draws Latin, which it does, and the probe would
 * report a missing face as present.
 *
 * Returns `null`, not `false`, when the instrument itself is unavailable (no
 * canvas — a non-DOM host, a locked-down browser). A caller must show that
 * as "unknown": claiming a face is missing on no evidence is the same class
 * of lie as claiming it is present.
 *
 * WHAT IT CANNOT SAY: a family whose advances match all three sentinels
 * within half a pixel over the whole sample reads as absent. For the
 * handwriting faces this mode ships that is not a realistic collision, and
 * the failure direction is the safe one — it under-claims availability, so
 * the picker warns about a face that would in fact have rendered rather than
 * promising one that would not.
 */
export function familyAvailable(
  doc: Document,
  family: string,
  sample: string,
): boolean | null {
  try {
    const canvas = doc.createElement("canvas") as HTMLCanvasElement;
    const g =
      typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;
    if (!g || typeof g.measureText !== "function") return null;
    const widthIn = (families: string): number => {
      g.font = `28px ${families}`;
      return g.measureText(sample).width;
    };
    // A host that measures every string to zero (happy-dom, jsdom) has no
    // instrument either — reporting `false` there would be an invention.
    if (SENTINELS.every((s) => widthIn(s) === 0)) return null;
    const escaped = family.replace(/["\\]/g, "");
    return SENTINELS.some(
      (sentinel) =>
        Math.abs(widthIn(`"${escaped}", ${sentinel}`) - widthIn(sentinel)) > 0.5,
    );
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
 * to one character: a glyph whose advance under the declared stack is
 * EXACTLY the known fallback's is being drawn by the fallback. Exact
 * equality, not the stack probe's 0.5px tolerance — one glyph's advance is
 * a small number and neighbouring faces tie within half a pixel all the
 * time (measured 2026-08-12: at 0.5px, Chalkboard SE's `A` and 苹方's `A`
 * are indistinguishable; at exact equality the shipped stacks flag `⋯` and
 * `⊂` and nothing else, both of them genuinely absent from all three hand
 * faces, while the blind trial's stack flags every CJK character and both
 * arrows).
 *
 * WHAT IT CANNOT SAY, and this is the same boundary `probeEnvCaps` records:
 * a comparison against ONE fallback face only catches glyphs that land on
 * THAT face. A character drawn by some third face (`⋯` resolves to Kaiti SC
 * here) is caught only when its advance happens to coincide. The chip
 * therefore under-reports and never over-reports, which is the right
 * direction for a warning that asks a human to go looking.
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
    const canvas = doc.createElement("canvas") as HTMLCanvasElement;
    const g =
      typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;
    if (!g || typeof g.measureText !== "function") return [];
    const widthIn = (families: string, ch: string): number => {
      g.font = `28px ${families}`;
      return g.measureText(ch).width;
    };
    const declared = opts?.stacks ?? readHandStacks(doc);
    if (declared.length === 0) return [];
    const seen = new Set<string>();
    const missing: string[] = [];
    for (const ch of text) {
      if (seen.has(ch) || BLANK.test(ch)) continue;
      seen.add(ch);
      const fallbackWidth = widthIn(`'${fallback}'`, ch);
      // EVERY declared stack must be able to draw it: `EnvCaps` is
      // session-fixed and the reader can flip the theme at any moment, so a
      // character that only degrades in the other theme still has to be
      // named now (same reasoning as `THEME_VARIANTS` above).
      if (declared.some((stack) => widthIn(stack, ch) === fallbackWidth)) {
        missing.push(ch);
      }
    }
    return missing;
  } catch {
    return [];
  }
}

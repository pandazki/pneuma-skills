/**
 * Chalk (W9) — the two chalk effects' pure core: the hand-wipe erase's
 * seeded mask assets and the constants the chalk gate hangs on.
 *
 * THE SEAM (themes ↔ effects, settled before either half started): one
 * token, `--bansho-chalk: 0 | 1`, declared by a theme on
 * `.bansho-board-surface`. 1 means "this board is chalk on slate" — the
 * chalk-edge ink texture and the hand-wipe erase residue exist only there.
 * 0 (the default) is ink on paper and must stay byte-identical to the
 * board of before this module existed: no texture, no residue, no new
 * style write anywhere. This module reads NOTHING about themes beyond that
 * one number; the theme half defines it and never touches an effect.
 *
 * Layering (G2): engine core — imports only sibling engine modules
 * (`sketch` for the PRNG, `flaw` for the knob clamp). Everything here is
 * PAINT-TIME, the same safety argument the 瑕疵 layer makes: masks and
 * filters do not move a pixel of layout (`offset*` and rect geometry are
 * untouched), so nothing below can reach `naturalDuration`, a wrap
 * decision, the reconcile hash or the two-width byte gate.
 *
 * DETERMINISM (non-negotiable): every "random" quantity — the wipe front's
 * ragged edge, the residue streaks the cloth did not take — is seeded from
 * the erase's own identity (the seed the eraser already carries), drawn
 * through the same `mulberry32` the ink spends, and quantised to fixed
 * decimals so the emitted strings are byte-stable. `seek(p)` stays a pure
 * function of progress: scrub back and forth and the same erase leaves the
 * same smear, forever. `Math.random()` is as banned here as everywhere
 * else in the engine.
 *
 * WHY MASKS AND NOT GRADIENTS-ON-THE-ELEMENT: the prototype composed the
 * wipe front and the residue out of stacked CSS radial/linear gradients
 * and it did not converge — the front over-erased and the residue smeared
 * over text the cloth had not reached. Here both are IMAGES (data-URI
 * SVGs, rasterised once by the browser) on the wrapper's two mask layers:
 * layer 1 is the moving front (3x the element wide — transparent third,
 * ragged arc band, opaque third — swept by `mask-position` alone), layer 2
 * is the static residue streak field. `mask-composite`'s initial value is
 * `add`, so visible = "ahead of the front" OR "what the cloth missed";
 * ahead of the front the residue adds to alpha 1 and clamps — it can
 * never smear text that has not been wiped. The residue is the run's OWN
 * glyphs at streak alpha — information, not decoration: it says something
 * was here.
 */

import { clampFlaw } from "./flaw.js";
import { mulberry32 } from "./sketch/index.js";

/** The theme token this half reads, and nothing else about themes. */
export const CHALK_KNOB_PROP = "--bansho-chalk";

/** The gate: `data-bansho-chalk` on `.bansho-board-surface` (dataset key).
 *  Same shape as `FLAW_FLAG`: stamped by the host when the token is on,
 *  and every effect rule in `chalk-css.ts` matches only under it. */
export const CHALK_FLAG = "banshoChalk";

/** The eraser's own in-flight marker on ITS wrapper (dataset key), set
 *  while its wipe holds any state (p > 0). It exists for one measured
 *  reason: re-masking a wrapper whose words each carry a displacement
 *  filter re-runs every one of those filters per frame — measured
 *  2026-08-17, p95 41 ms / 29 frames over 33 ms, a failed budget. With the
 *  per-word texture lifted for exactly the wiping wrapper the same sweep
 *  holds max 28 ms / 0 over 33. A standing closed run (p = 0) keeps its
 *  texture; the attribute mirrors p, so scrubbing back restores it. */
export const WIPING_FLAG = "banshoWiping";

/** The in-document SVG filter id the ink-texture rules reference. A CSS
 *  `filter: url(#…)` resolves same-document fragments only, so the def is
 *  DOM (see `viewer/chalk-css.ts`), unlike the mask images below which are
 *  self-contained data URIs. */
export const CHALK_INK_FILTER_ID = "bansho-chalk-ink";

/** Is the board chalk, per the computed value of `--bansho-chalk`?
 *  The contract says 0 | 1; reading numerically keeps "1" / " 1" / "1.0"
 *  honest and everything else (unset, junk) safely paper. */
export function readChalk(computed: string): boolean {
  const n = Number.parseFloat(computed);
  return Number.isFinite(n) && n > 0;
}

/**
 * The wipe's two mask images, built ONCE per erase unit from the erase's
 * own seed. `knob` is the 瑕疵 knob (`--bansho-flaw`) — the effects ride
 * the existing imperfection family rather than minting a parallel one:
 * residue density scales with it, and at 0 the caller must not be here at
 * all (a clean board erases with the legacy hard edge; enforced by the
 * eraser, asserted here).
 */
export interface ChalkWipeAssets {
  /** Layer 1 — the moving front. 3x the element wide: transparent third,
   *  ragged arc band, opaque third. Only its `mask-position` ever moves. */
  front: string;
  /** Layer 2 — the residue streak field, static at 100% 100%. */
  residue: string;
}

/** Quantise for byte-stable emitted strings (CSS compares text). */
const q = (n: number, d = 2): string => n.toFixed(d);

/** Percent-encode an SVG document for a `url("data:image/svg+xml,…")`. */
const svgUri = (svg: string): string =>
  `data:image/svg+xml,${encodeURIComponent(svg).replace(/%20/g, " ")}`;

/**
 * The front band's geometry, in the image's own units (viewBox 300x100,
 * `preserveAspectRatio="none"`; 100 units of x = one element width).
 *
 * The band lives at x ∈ [140, 160] — about a fifth of a panel of grey —
 * and its leading edge is a shallow ARC: a hand pivots at the elbow, so
 * the alpha ramp is a radial gradient whose centre sits far off-left
 * (userSpaceOnUse), making every iso-alpha line a circle of large radius.
 * Chalk goes grey before it goes: the ramp holds a mid-alpha plateau
 * before committing to opaque. Turbulence displacement roughens the whole
 * band — the ragged edge — and a plain rect continues the opaque side so
 * displacement can never eat into what the cloth has not reached.
 */
const FRONT_ARC_RADIUS = 360;
const FRONT_BAND_START = 140;
const FRONT_BAND_END = 160;

function frontSvg(rnd: () => number): string {
  const seed = Math.floor(rnd() * 9973) + 1; // feTurbulence wants an int
  const cy = q(38 + rnd() * 24, 1); // where the elbow's arc bulges
  const cx = q(FRONT_BAND_START - FRONT_ARC_RADIUS, 1);
  const r = q(FRONT_ARC_RADIUS + (FRONT_BAND_END - FRONT_BAND_START), 1);
  const o0 = q(FRONT_ARC_RADIUS / (FRONT_ARC_RADIUS + 20), 4);
  const o1 = q((FRONT_ARC_RADIUS + 7) / (FRONT_ARC_RADIUS + 20), 4);
  const o2 = q((FRONT_ARC_RADIUS + 14) / (FRONT_ARC_RADIUS + 20), 4);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100" preserveAspectRatio="none">` +
    `<defs>` +
    `<radialGradient id="g" gradientUnits="userSpaceOnUse" cx="${cx}" cy="${cy}" r="${r}">` +
    `<stop offset="0" stop-color="#000" stop-opacity="0"/>` +
    `<stop offset="${o0}" stop-color="#000" stop-opacity="0"/>` +
    `<stop offset="${o1}" stop-color="#000" stop-opacity="0.34"/>` +
    `<stop offset="${o2}" stop-color="#000" stop-opacity="0.62"/>` +
    `<stop offset="1" stop-color="#000" stop-opacity="1"/>` +
    `</radialGradient>` +
    `<filter id="r" x="-8%" y="-8%" width="116%" height="116%">` +
    `<feTurbulence type="fractalNoise" baseFrequency="0.02 0.31" numOctaves="2" seed="${seed}"/>` +
    `<feDisplacementMap in="SourceGraphic" scale="13" xChannelSelector="R" yChannelSelector="G"/>` +
    `</filter>` +
    `</defs>` +
    // The band, displaced (ragged); y bleeds past the box so displacement
    // never uncovers a clean strip at the edges.
    `<rect x="120" y="-6" width="44" height="112" fill="url(#g)" filter="url(#r)"/>` +
    // The opaque side, NOT displaced: what the cloth has not reached is
    // untouched by construction, which is the over-erase failure closed.
    `<rect x="${FRONT_BAND_END}" y="0" width="${300 - FRONT_BAND_END}" height="100" fill="#000"/>` +
    `</svg>`
  );
}

/** Residue streak field: the horizontal bands a cloth misses, plus a faint
 *  overall haze so the ghost is not strictly striped. Density and alpha
 *  ride the 瑕疵 knob (clamped to 2 — past that residue reads as unerased). */
function residueSvg(rnd: () => number, knob: number): string {
  const k = Math.min(clampFlaw(knob), 2);
  const seed = Math.floor(rnd() * 9973) + 1;
  const bands: string[] = [];
  const count = 7 + Math.floor(rnd() * 3);
  for (let i = 0; i < count; i++) {
    const y = q(rnd() * 96, 1);
    const h = q(1.5 + rnd() * 5, 1);
    const a = q((0.05 + rnd() * 0.1) * k, 3);
    bands.push(`<rect x="0" y="${y}" width="100" height="${h}" fill="#000" fill-opacity="${a}"/>`);
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none">` +
    `<defs><filter id="s" x="-6%" y="-6%" width="112%" height="112%">` +
    `<feTurbulence type="fractalNoise" baseFrequency="0.06 0.42" numOctaves="2" seed="${seed}"/>` +
    `<feDisplacementMap in="SourceGraphic" scale="3.5" xChannelSelector="R" yChannelSelector="G"/>` +
    `</filter></defs>` +
    `<rect x="0" y="0" width="100" height="100" fill="#000" fill-opacity="${q(0.028 * k, 3)}"/>` +
    `<g filter="url(#s)">${bands.join("")}</g>` +
    `</svg>`
  );
}

/**
 * Build both mask images for one erase. Same (seed, knob) → byte-identical
 * URIs, on every machine, at every window width — which is what lets the
 * two-width gate stay a byte comparison with the chalk board on.
 */
export function chalkWipeAssets(seed: number, knob: number): ChalkWipeAssets {
  // A stream of its own, offset from the front-jitter seed the legacy
  // sweep spends, so turning chalk on does not replay the polygon's draws.
  const rnd = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  return {
    front: svgUri(frontSvg(rnd)),
    residue: svgUri(residueSvg(rnd, knob)),
  };
}

/** The style record a chalk wipe writes per seek — the eraser's whole
 *  visual state, all on its own wrapper (G8-L's one-element rule kept). */
export interface ChalkWipeStyle {
  maskImage: string;
  maskSize: string;
  maskRepeat: string;
  maskPosition: string;
  /** Masks, unlike clip-path, do not trim hit-testing: without this the
   *  erased board would leave a full-panel click shield over the pointing
   *  seam. Applied while the wipe holds any state. */
  pointerEvents: string;
}

/**
 * The wipe's style at EASED progress `e` (the eraser owns the easing so
 * there is exactly one hand). `null` at e <= 0 — the wipe removes its own
 * state entirely, matching the legacy sweep's `""`. At e >= 1 the front
 * sits fully off (position 0%) and only the residue layer remains: the
 * terminal state of a chalk erase IS the smear.
 *
 * mask-position arithmetic (3x-wide image at `mask-size: 300% 100%`): at
 * X% the viewport shows image units [2X, 2X + 100], so 100% shows the
 * opaque third, 50% centres the band, 0% shows the transparent third —
 * position = 100·(1 − e) sweeps the front left → right. Strings are
 * quantised; same e, byte-identical style, forever.
 */
export function chalkWipeStyleAt(
  e: number,
  assets: ChalkWipeAssets,
): ChalkWipeStyle | null {
  if (e <= 0) return null;
  const x = e >= 1 ? 0 : 100 * (1 - e);
  return {
    maskImage: `url("${assets.front}"), url("${assets.residue}")`,
    maskSize: "300% 100%, 100% 100%",
    maskRepeat: "no-repeat, no-repeat",
    maskPosition: `${q(x)}% 0%, 0% 0%`,
    pointerEvents: "none",
  };
}

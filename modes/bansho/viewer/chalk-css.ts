/**
 * Chalk effect stylesheet (W9) — the ink texture's CSS half, injected by
 * BanshoPreview as its own <style> tag beside the base sheet.
 *
 * A SEPARATE FILE FROM board-css.ts ON PURPOSE: every rule here is an
 * EFFECT gated on the chalk seam, while board-css.ts is the board's look —
 * and the gating claim ("a paper board is byte-identical to today") is
 * pinned by a scan over exactly this string (chalk.test.ts): every
 * selector must contain `[data-bansho-chalk]`, the attribute the host
 * stamps only when the theme's `--bansho-chalk` token is 1.
 *
 * WHY AN ATTRIBUTE GATE AND NOT `calc(var(--bansho-chalk) * …)`: a
 * `filter` cannot be multiplied away — `url(#…)` either applies (and
 * costs a raster pass, and mints a stacking context) or does not exist.
 * The 瑕疵 layer's `data-bansho-flawed` is the precedent: gate by
 * attribute, and 0 is a structural absence rather than a zeroed effect.
 *
 * SCOPING (each choice measured or inherited from a measured one):
 *
 *  - THE PEN'S INK GETS TEXTURE, THE MARKER BANDS DO NOT. Texture lands on
 *    the written word boxes (`.bansho-w`) and on stroked gesture paths
 *    (the over overlays + the bullet) — never on the fill layers
 *    (`.bansho-ink-under` / `.bansho-backref-under`), which hold the
 *    highlighter bands whose edges the prototype's block-level filter
 *    chewed. The under/over split is structural (z 0 / z 2, ink.ts), so
 *    the exclusion is a selector, not a judgment call per mark.
 *
 *  - PER WORD, NOT PER BLOCK. Small filter regions re-raster only the
 *    word whose reveal is moving; measured 2026-08-17 while streaming:
 *    baseline median 8.3 ms / p95 9.2 / 0 over 33; per-word filter
 *    median 8.3 / p95 9.3 / 0 over 33 (per-block was worse-tailed:
 *    max 18 vs 16). A word span minting a stacking context is safe where
 *    a step minting one is not — the flaw layer's `.bansho-w` transform
 *    already crossed that bridge, inside `.bansho-text`'s own context.
 *
 *  - SCOPED TO `[data-bansho-box="1"]`, the flaw layer's own scoping: the
 *    notes projection and the measure host never carry the flag, so a
 *    ruler never rasterises through a filter (paint-only either way, but
 *    structural absence beats care), and the unboxed backref fallback
 *    path keeps its stacking guarantees.
 *
 *  - RIDES `[data-bansho-flawed]` — the 瑕疵 family, not a parallel knob:
 *    `--bansho-flaw: 0` is a machine's board even when it is slate
 *    (themes.md pins that reading), so the texture gate is chalk AND
 *    flawed. Amplitude is fixed at the knob-1 tuning; an SVG filter's
 *    displacement scale cannot read a CSS variable, and re-stamping defs
 *    per knob value buys nothing visible at this amplitude.
 *
 *  - THE WIPING LIFT IS A MEASURED BUDGET FIX, not styling: re-masking a
 *    wrapper whose N words each carry a displacement filter re-runs all N
 *    filters per frame — p95 41 ms, 29 frames over 33 (failed budget).
 *    Lifting the filter inside exactly the wrapper whose wipe is holding
 *    state (`data-bansho-wiping`, written by the eraser) returns the
 *    sweep to max 28 ms / 0 over 33. The lift out-specifies the apply
 *    rules (6 class-level selectors vs 5), so order cannot decide it.
 */

import { CHALK_INK_FILTER_ID } from "../engine/chalk.js";

export const CHALK_EFFECT_CSS = `
.bansho-board-surface[data-bansho-chalk][data-bansho-flawed]
  [data-bansho-box="1"] .bansho-w {
  filter: url(#${CHALK_INK_FILTER_ID});
}
.bansho-board-surface[data-bansho-chalk][data-bansho-flawed]
  [data-bansho-box="1"]
  :is(.bansho-ink-over, .bansho-backref-over, .bansho-bullet) path {
  filter: url(#${CHALK_INK_FILTER_ID});
}
.bansho-board-surface[data-bansho-chalk][data-bansho-flawed]
  .bansho-erased-run[data-bansho-wiping] .bansho-w {
  filter: none;
}
.bansho-board-surface[data-bansho-chalk][data-bansho-flawed]
  .bansho-erased-run[data-bansho-wiping]
  :is(.bansho-ink-over, .bansho-backref-over, .bansho-bullet) path {
  filter: none;
}
`;

/**
 * The in-document filter def the rules above reference. A CSS
 * `filter: url(#id)` resolves SAME-DOCUMENT fragments only (a data URI or
 * cross-file reference silently does nothing), so unlike the wipe's mask
 * images this must be DOM — BanshoPreview injects it, hidden, beside the
 * stylesheet. Inert while nothing references it: a zero-sized <svg> def
 * paints nothing and costs nothing on a paper board.
 *
 * The turbulence seed is a CONSTANT, and that is deliberate determinism,
 * not an oversight: the noise field is anchored to each filtered word's
 * own region, so two same-sized words share an (invisible, ~2.5px) grain
 * — the same trade `contentSeed` documents for identical blocks. A
 * per-word seed would need a def per word for nothing the eye can find.
 */
export const CHALK_FILTER_DEFS_SVG =
  `<svg width="0" height="0" aria-hidden="true" style="position:absolute">` +
  `<filter id="${CHALK_INK_FILTER_ID}" x="-15%" y="-15%" width="130%" height="130%">` +
  `<feTurbulence type="fractalNoise" baseFrequency="0.74" numOctaves="2" seed="7" result="n"/>` +
  `<feDisplacementMap in="SourceGraphic" in2="n" scale="2.4" xChannelSelector="R" yChannelSelector="G"/>` +
  `</filter>` +
  `</svg>`;

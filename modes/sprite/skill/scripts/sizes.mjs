/**
 * sizes.mjs — is the character one size across its motions?
 *
 * `inspect.scaleDrift` answers that question inside ONE motion (the spread of
 * its frames' heights). Across motions nothing did, and a blind trial (G-4dir,
 * 2026-09-27) claimed "sizes differ at most 2.8 % across the set" from the
 * largest within-motion scaleDrift while its front walk stood 479 px and its
 * right walk 457 px — 4.8 % apart, which reads as the character shrinking as
 * it turns. `sprite-sheet.mjs sizes` measures every ready sprite motion's
 * frames and this module turns the heights into the comparison.
 *
 * A motion's size is the height it stands at, times its atlas scale — the
 * height it ships at. A looping motion stands at the median of its frames'
 * solid-alpha bbox heights (a raised arm in a few frames does not move it); a
 * one-shot (an attack, a jump) starts from the character's rest pose and
 * spends most of its frames crouched or stretched, so it stands at its first
 * frame. Pure and zero-dependency.
 */

/** Motions whose shipped standing heights differ by more than this share of
 *  the shorter are warned about. Measured 2026-09-27 (`sizes` on the blind
 *  trials' characters): Kagari idle 247 / walk 246.25 / attack (first frame)
 *  246 px — 0.4 %; the Lumi seed, shipped as one character, idle 234.5 /
 *  attack 227 px — 3.3 %; the G-4dir granny, whose reviewer saw her change
 *  size as she turned, walk-front 480 / walk-right 456.5 px — 5.1 %. The bar
 *  sits between the last two. */
export const SIZE_SPREAD_WARN = 0.035;

/** Median of a non-empty list (the mean of the middle two for an even one). */
export function medianOf(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * One motion's heights (px per frame, null for an empty frame) as its size:
 * `standing` (the median for a loop, the first frame for a one-shot — `from`
 * says which), and `shipped` = standing × the atlas scale.
 */
export function motionSize(heights, { scale = 1, loop = true } = {}) {
  const present = heights.filter((h) => typeof h === "number" && h > 0);
  if (!present.length) return null;
  const median = medianOf(present);
  const first = typeof heights[0] === "number" && heights[0] > 0 ? heights[0] : null;
  const fromFirst = loop === false && first !== null;
  const standing = fromFirst ? first : median;
  const round2 = (v) => Math.round(v * 100) / 100;
  return {
    standing: round2(standing),
    from: fromFirst ? "first" : "median",
    median: round2(median),
    min: Math.min(...present),
    max: Math.max(...present),
    first,
    scale,
    shipped: round2(standing * scale),
  };
}

/**
 * The comparison across motions: `{ spread, tallest, shortest, reference,
 * scaleToMatch }` over the motions that have a size. `spread` is
 * (tallest − shortest) / shortest of the shipped standing heights;
 * `reference` is their median, and `scaleToMatch[id]` what a motion's shipped
 * height would be multiplied by to meet it.
 */
export function sizeSpread(sizes) {
  const measured = sizes.filter((s) => s.size);
  if (measured.length < 2) return null;
  let tallest = measured[0];
  let shortest = measured[0];
  for (const entry of measured) {
    if (entry.size.shipped > tallest.size.shipped) tallest = entry;
    if (entry.size.shipped < shortest.size.shipped) shortest = entry;
  }
  const reference = medianOf(measured.map((s) => s.size.shipped));
  const spread = (tallest.size.shipped - shortest.size.shipped) / shortest.size.shipped;
  const round4 = (v) => Math.round(v * 10000) / 10000;
  return {
    spread: round4(spread),
    tallest: tallest.id,
    shortest: shortest.id,
    reference: Math.round(reference * 100) / 100,
    scaleToMatch: Object.fromEntries(measured.map((s) => [s.id, round4(reference / s.size.shipped)])),
  };
}

/**
 * The sentence for a spread over the bar, or null. `block` is the step a
 * height moves in as shipped (one logical pixel of pixel art, 0 otherwise):
 * each of two heights is off its true value by up to a block, so two motions
 * within two blocks are as close as the lattice can say, whatever share of a
 * 26-pixel slime that is (the G-pixel slime: idle median 26.5, jump's first
 * frame 25).
 */
export function sizeWarning(sizes, comparison, { bar = SIZE_SPREAD_WARN, block = 0, picture = "sizes.png" } = {}) {
  if (!comparison || comparison.spread <= bar) return null;
  const by = new Map(sizes.map((s) => [s.id, s.size]));
  const tall = by.get(comparison.tallest);
  const short = by.get(comparison.shortest);
  if (tall.shipped - short.shipped <= 2 * block) return null;
  const how = (size) => (size.from === "first" ? "its first frame" : "the median frame");
  return `${comparison.tallest} stands ${tall.shipped} px (${how(tall)}) and ${comparison.shortest} ${short.shipped} px (${how(short)}), as shipped — ${(comparison.spread * 100).toFixed(1)} % apart, over the ${(bar * 100).toFixed(1)} % a switch between them hides: the character changes size between these motions. Look at ${picture} before calling the set one size`;
}

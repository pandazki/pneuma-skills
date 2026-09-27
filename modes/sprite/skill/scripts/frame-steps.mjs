/**
 * frame-steps.mjs — how much a motion changes from one frame to the next,
 * for `inspect`.
 *
 * Two failures a sheet model makes that no geometry number sees:
 *
 *   - it draws the same pose twice in a row, so the animation hitches on a
 *     held frame (an adjacent near-duplicate);
 *   - it draws each ROW of a grid as its own little sequence, so the motion
 *     is smooth inside a row and jumps where one row hands over to the next
 *     (a row-boundary jump). Measured on the Lumi seed idle: in-row steps
 *     0.007–0.016, the boundaries 0.040 and 0.048.
 *
 * The step is the mean absolute RGBA difference of two frames at 64 × 64,
 * 0..1 — the measure aldegad/sprite-gen's `qa/inspect.py` scores "motion
 * presence" with. Inspired by aldegad/sprite-gen sprite_gen/qa/inspect.py
 * (`_motion_presence`) and qa/score.py: their row-level signal, judged here
 * per pair and per row boundary.
 *
 * Pure and zero-dependency: images are `{ width, height, data }` RGBA buffers.
 */

/** Side of the square thumbnail two frames are compared at. */
export const STEP_THUMB = 64;
/**
 * A step under this is two frames a viewer cannot tell apart: upstream's
 * `DEFAULT_MOTION_MIN`, which it holds a whole row's mean step to.
 */
export const DUPLICATE_STEP = 0.01;
/**
 * A row boundary whose step is more than this many times the in-row median —
 * and more than every in-row step, and visible at all (over DUPLICATE_STEP) —
 * is a jump between two separately drawn sequences. Measured 2026-09-27 on
 * the Lumi seed sheets (see `references/pipeline.md`, Measured): the idle's
 * two jumping boundaries sit at 4.0× and 5.0× its in-row median and its third,
 * smooth one at 1.8×; the attack's largest boundary — windup, overhead,
 * strike and recovery each drawn as one row — at 2.6×.
 */
export const BOUNDARY_STEP_RATIO = 3;
/**
 * A row needs at least this many frames to be a sequence of its own; with
 * two, each row has a single in-row step and "the in-row median" is just the
 * other rows' one step each.
 */
export const MIN_ROW_FRAMES = 3;

/**
 * Area-average an RGBA image down to STEP_THUMB², in premultiplied alpha,
 * then back to straight RGBA — so a transparent pixel's leftover colour counts
 * for nothing and the numbers compare with upstream's (Pillow resizes RGBA
 * premultiplied too). Returns STEP_THUMB² × 4 floats in 0..255.
 */
export function stepThumb(image, size = STEP_THUMB) {
  const { width, height, data } = image;
  // Per-axis box weights: source pixel p covers [p, p+1), output bin b covers
  // [b·scale, (b+1)·scale); the weight is their overlap, in source pixels.
  // Downscaling, a pixel lands in one or two bins; upscaling (a frame under
  // 64 px), in several.
  const spans = (from, to) => {
    const scale = from / to;
    const out = [];
    for (let p = 0; p < from; p++) {
      const bins = [];
      for (let b = Math.floor(p / scale); b < to && b * scale < p + 1; b++) {
        const overlap = Math.min(p + 1, (b + 1) * scale) - Math.max(p, b * scale);
        if (overlap > 0) bins.push([b, overlap]);
      }
      out.push(bins);
    }
    return { out, scale };
  };
  const xs = spans(width, size);
  const ys = spans(height, size);
  const acc = new Float64Array(size * size * 4);
  for (let y = 0; y < height; y++) {
    for (const [by, wy] of ys.out[y]) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const a = data[i + 3];
        if (a === 0) continue;
        const f = a / 255;
        for (const [bx, wx] of xs.out[x]) {
          const w = wy * wx;
          const o = (by * size + bx) * 4;
          acc[o] += data[i] * f * w;
          acc[o + 1] += data[i + 1] * f * w;
          acc[o + 2] += data[i + 2] * f * w;
          acc[o + 3] += a * w;
        }
      }
    }
  }
  const area = xs.scale * ys.scale;
  const thumb = new Float64Array(size * size * 4);
  for (let o = 0; o < acc.length; o += 4) {
    const alpha = acc[o + 3] / area;
    thumb[o + 3] = alpha;
    if (alpha <= 0) continue;
    const f = alpha / 255;
    thumb[o] = acc[o] / area / f;
    thumb[o + 1] = acc[o + 1] / area / f;
    thumb[o + 2] = acc[o + 2] / area / f;
  }
  return thumb;
}

/** Mean absolute difference of two thumbnails over all four channels, 0..1. */
export function thumbDiff(a, b) {
  let total = 0;
  for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]);
  return total / (a.length * 255);
}

/** Median of a non-empty list. */
function median(values) {
  const sorted = [...values].sort((x, y) => x - y);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Judge a motion's steps.
 *
 * `steps[k]` is the step from frame k to k+1 (null when either is empty);
 * `wrap` the step from the last frame back to the first, or null when the
 * motion does not loop. `cols` is the grid the frames were sliced from, when
 * they were: frame k+1 starting a row (a multiple of `cols`) makes step k a
 * row boundary, and so does the wrap of a looping sheet.
 *
 * Returns the pairs that are near-duplicates, the boundaries that jump, and
 * the in-row median the jumps were judged against.
 */
export function judgeSteps(steps, { wrap = null, cols = null, count, duplicateStep = DUPLICATE_STEP, ratio = BOUNDARY_STEP_RATIO } = {}) {
  const pairs = steps.map((step, k) => ({ from: k, to: k + 1, step }));
  if (wrap !== null && count > 2) pairs.push({ from: count - 1, to: 0, step: wrap });
  const measured = pairs.filter((p) => p.step !== null);
  const nearDuplicates = measured.filter((p) => p.step < duplicateStep);

  let rowJumps = [];
  let inRowMedian = null;
  const rowed = cols !== null && cols >= MIN_ROW_FRAMES && count > cols;
  if (rowed) {
    const isBoundary = (p) => p.to % cols === 0;
    const inRow = measured.filter((p) => !isBoundary(p));
    if (inRow.length) {
      inRowMedian = median(inRow.map((p) => p.step));
      const inRowMax = Math.max(...inRow.map((p) => p.step));
      rowJumps = measured.filter((p) => isBoundary(p)
        && p.step > ratio * inRowMedian && p.step > inRowMax && p.step >= duplicateStep);
    }
  }
  return { nearDuplicates, rowJumps, inRowMedian };
}

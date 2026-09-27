/**
 * drift.mjs — where the body is, frame to frame, for `align` and `inspect`.
 *
 * `align --x-from feet` pins each frame's own foot line. On a clip whose
 * character walks, one foot is always lifted, so the foot band holds the
 * planted foot alone — and that foot slides back under the body through the
 * whole stance, then swaps for the other one. Pinning it moves the BODY by
 * about a stride every step: the "lurch" aldegad/sprite-gen retired its own
 * per-frame foot pin over. Two ways out, both ported here:
 *
 *   - `trend`: a clip drifts slowly, a gait is periodic. Fit one straight
 *     line to the body's centre across the frames and remove only that line;
 *     every frame then stands on the mean foot line riding the drift, and the
 *     step itself is left alone.
 *   - `body`: register the last frame's head and torso against the first's
 *     (one measurement, whole pixels) and spread that offset as a ramp over
 *     the frames, so the cycle ends where it started. Never per frame: fitting
 *     every frame turns a head bob into a full-body shiver.
 *
 * And one measurement that does not come from the alignment it judges:
 * `headOffsets` registers each frame's head-and-torso band against the first
 * frame's. `bodyDrift` is the feet-centre spread, which is ~0 by construction
 * after a feet pin; the upper body is what visibly lurches when the feet were
 * pinned, and what stays put when the drift was removed properly.
 *
 * Pure and zero-dependency: images are `{ width, height, data }` RGBA buffers
 * (what `sprite-sheet.mjs` decodes), boxes are `{ x, y, w, h }`.
 */

/** Band of the frame's box, from its top, that `body` registers: head and
 *  torso, not the legs (mid-stride at both ends) or the tail. */
export const BODY_REGISTER_BAND = 0.6;
/** Whole pixels either side the last frame is searched against the first. */
export const BODY_REGISTER_SEARCH = 24;
/** Horizontal strips the head band is binned into for `headOffsets`. */
export const HEAD_STRIPS = 8;
/** `headOffsets` searches this share of the frame width either side: a
 *  stride-sized lurch has to be inside the window to be measured at all. */
export const HEAD_SEARCH_FRACTION = 0.25;

/**
 * Python's `round`: half to even. The ported ramps and canvases round the way
 * upstream does, so the same inputs give the same whole pixels here as there
 * (`Math.round(4.5)` is 5, Python's `round(4.5)` is 4).
 */
export function roundHalfEven(value) {
  const floor = Math.floor(value);
  const diff = value - floor;
  const rounded = diff > 0.5 ? floor + 1 : diff < 0.5 ? floor : floor % 2 === 0 ? floor : floor + 1;
  // Python's int(round(-0.2)) is 0; JavaScript's would be -0, which prints
  // as 0 but is not `Object.is` 0 — and a shift is a whole pixel count.
  return rounded === 0 ? 0 : rounded;
}

/**
 * Mean x of every opaque pixel inside `bbox` — the whole body's mass, which a
 * gait swings far less than it swings the foot line. Pixel centres, like
 * `feetCenterX`.
 *
 * Ported from aldegad/sprite-gen (Apache-2.0) sprite_gen/video/loop.py@fbd1a08:
 * `body_centre`. Changes: the caller's alpha threshold (16 in this pipeline)
 * instead of a fixed 8; pixel-centre coordinates.
 */
export function massCenterX(image, bbox, threshold) {
  let sum = 0, count = 0;
  for (let y = bbox.y; y < bbox.y + bbox.h; y++) {
    const row = y * image.width;
    for (let x = bbox.x; x < bbox.x + bbox.w; x++) {
      if (image.data[(row + x) * 4 + 3] < threshold) continue;
      sum += x + 0.5;
      count++;
    }
  }
  return count ? sum / count : bbox.x + bbox.w / 2;
}

/** Least-squares slope of `values[i]` over `i`, skipping nulls. */
function slopeOver(values) {
  const points = values.map((v, t) => [t, v]).filter(([, v]) => v !== null);
  if (points.length < 2) return 0;
  const n = points.length;
  const mt = points.reduce((s, [t]) => s + t, 0) / n;
  const mv = points.reduce((s, [, v]) => s + v, 0) / n;
  let num = 0, den = 0;
  for (const [t, v] of points) {
    num += (t - mt) * (v - mv);
    den += (t - mt) ** 2;
  }
  return den > 0 ? num / den : 0;
}

/**
 * The spread (population std-dev) of `values` about their least-squares line
 * over the index — the wobble once a slow, straight drift is taken out.
 * Nulls are skipped; fewer than two values spread by 0.
 */
export function swayAboutTrend(values) {
  const slope = slopeOver(values);
  const residual = values.map((v, t) => (v === null ? null : v - slope * t)).filter((v) => v !== null);
  if (residual.length < 2) return 0;
  const mean = residual.reduce((a, b) => a + b, 0) / residual.length;
  return Math.sqrt(residual.reduce((a, v) => a + (v - mean) ** 2, 0) / residual.length);
}

/**
 * Per-frame x reference for `align --x-from trend`.
 *
 * Drift is a slow translation; a gait is periodic. The frames hold whole
 * steps, so a straight line fitted to the body's centre across them carries
 * the drift and not the step. Only that line is removed: the reference is the
 * mean foot line riding the drift, so every frame keeps the offset it was
 * filmed with, minus the slide.
 *
 * Returns `ref[i]` (null for an empty frame), the fitted slope in px per
 * frame, `driftPx` — the slide removed across the frames — and `footSwayPx`,
 * how far the foot line moves inside the gait once the drift is gone (kept as
 * filmed; it is the step).
 *
 * Ported from aldegad/sprite-gen (Apache-2.0) sprite_gen/video/loop.py@fbd1a08:
 * `drift_reference`. Changes: the foot line is this pipeline's `feetX` (the
 * bottom 10 % of the box rather than 8 %); empty frames are skipped by the fit
 * and get no reference.
 */
export function trendReference(feetX, massX) {
  const slope = slopeOver(massX);
  const residual = feetX.map((f, t) => (f === null ? null : f - slope * t));
  const present = residual.filter((r) => r !== null);
  const level = present.length ? present.reduce((a, b) => a + b, 0) / present.length : 0;
  const ref = feetX.map((f, t) => (f === null ? null : level + slope * t));
  const n = feetX.length;
  return {
    ref,
    slope,
    driftPx: Math.abs(slope * (n - 1)),
    footSwayPx: present.length ? Math.max(...present) - Math.min(...present) : 0,
  };
}

/**
 * Horizontal offset, in whole pixels, that best lays the LAST frame's head and
 * torso over the FIRST's.
 *
 * A gait clip drifts a few pixels over one cycle, and the last-to-first wrap
 * shows that drift as a sideways jump. The legs are mid-stride and the tail
 * mid-swing at both ends, so they cannot say where the body is; the top
 * `band` of the first frame's box can. The cost is the mean absolute RGBA
 * difference over that region; ties go to the most negative offset.
 *
 * Ported from aldegad/sprite-gen (Apache-2.0) sprite_gen/video/loop.py@fbd1a08:
 * `body_wrap_offset` (BODY_ANCHOR_BAND 0.6, BODY_ANCHOR_SEARCH 24). Changes:
 * the shifted frame is zero-filled at the edge instead of wrapping round
 * (`np.roll`); the mask uses the caller's alpha threshold.
 */
export function bodyWrapOffset(first, last, { threshold, band = BODY_REGISTER_BAND, search = BODY_REGISTER_SEARCH }) {
  if (first.width !== last.width || first.height !== last.height) {
    throw new Error(`bodyWrapOffset: frames differ in size (${first.width}x${first.height} vs ${last.width}x${last.height})`);
  }
  const { width, height } = first;
  let top = height, bottom = -1, left = width, right = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (first.data[(y * width + x) * 4 + 3] < threshold) continue;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }
  if (bottom < 0) return 0;
  // Upstream's slice: rows top .. top + max(1, int((bottom - top) * band)).
  const rows = Math.max(1, Math.trunc((bottom - top) * band));
  const cost = (dx) => {
    let total = 0;
    for (let y = top; y < top + rows; y++) {
      for (let x = left; x <= right; x++) {
        const a = (y * width + x) * 4;
        const sx = x - dx;
        const inside = sx >= 0 && sx < width;
        const b = (y * width + sx) * 4;
        for (let c = 0; c < 4; c++) {
          total += Math.abs(first.data[a + c] - (inside ? last.data[b + c] : 0));
        }
      }
    }
    return total;
  };
  let best = -search;
  let bestCost = cost(-search);
  for (let dx = -search + 1; dx <= search; dx++) {
    const c = cost(dx);
    if (c < bestCost) { best = dx; bestCost = c; }
  }
  return best;
}

/**
 * The ramp that spreads a wrap offset across the cycle: frame k moves by
 * round(dx · k / L), so the cycle's end returns to its start one frame's worth
 * of drift at a time instead of in one jump at the wrap.
 *
 * Ported from aldegad/sprite-gen (Apache-2.0) sprite_gen/video/loop.py@fbd1a08:
 * `ramp_frames`. Changes: returns the shifts rather than shifted images —
 * `align` folds them into the placement it already does.
 */
export function rampShifts(count, dx) {
  return Array.from({ length: count }, (_, k) => (count < 2 || dx === 0 ? 0 : roundHalfEven((dx * k) / count)));
}

/**
 * The head-and-torso band of one frame as HEAD_STRIPS column profiles: the
 * top `band` of its own box, cut into horizontal strips, each summed down to
 * one alpha value per column. Cheap (width × strips numbers) and still 2-D
 * enough that a head moving over a torso is not mistaken for a torso moving.
 */
export function headProfile(image, bbox, { threshold, band = BODY_REGISTER_BAND, strips = HEAD_STRIPS }) {
  const { width, data } = image;
  const profile = new Float64Array(strips * width);
  if (!bbox) return profile;
  const rows = Math.max(1, Math.round(bbox.h * band));
  for (let r = 0; r < rows; r++) {
    const y = bbox.y + r;
    const strip = Math.min(strips - 1, Math.floor((r * strips) / rows));
    const base = strip * width;
    const row = y * width;
    for (let x = bbox.x; x < bbox.x + bbox.w; x++) {
      const a = data[(row + x) * 4 + 3];
      if (a < threshold) continue;
      profile[base + x] += a / 255;
    }
  }
  return profile;
}

/**
 * Where frame `profile` sits relative to `reference`, in px (positive: to the
 * right): the shift with the highest normalised cross-correlation over the
 * strips, refined to sub-pixel with a parabola through the peak and its two
 * neighbours. Null when either band is empty.
 */
export function profileOffset(reference, profile, width, { search, strips = HEAD_STRIPS }) {
  let na = 0, nb = 0;
  for (let i = 0; i < reference.length; i++) {
    na += reference[i] * reference[i];
    nb += profile[i] * profile[i];
  }
  if (na === 0 || nb === 0) return null;
  const norm = Math.sqrt(na * nb);
  const score = (d) => {
    let sum = 0;
    for (let s = 0; s < strips; s++) {
      const base = s * width;
      const x0 = Math.max(0, -d);
      const x1 = Math.min(width, width - d);
      for (let x = x0; x < x1; x++) sum += reference[base + x] * profile[base + x + d];
    }
    return sum / norm;
  };
  const scores = new Map();
  let best = 0;
  let bestScore = -Infinity;
  for (let d = -search; d <= search; d++) {
    const s = score(d);
    scores.set(d, s);
    if (s > bestScore) { best = d; bestScore = s; }
  }
  const left = scores.get(best - 1);
  const right = scores.get(best + 1);
  if (left === undefined || right === undefined) return best;
  const curve = left - 2 * bestScore + right;
  return curve < 0 ? best + (0.5 * (left - right)) / curve : best;
}

/**
 * Each frame's head-and-torso x, relative to the first non-empty frame's, in
 * px. `profiles[i]` is `headProfile` of frame i (or null for an empty frame);
 * all frames share one width, which aligned frames do.
 *
 * Inspired by aldegad/sprite-gen sprite_gen/video/loop.py `body_wrap_offset`
 * (register the head and torso, not the feet): the same region, measured on
 * every frame against the first, as a judge rather than a correction.
 */
export function headOffsets(profiles, width, { search = Math.max(1, Math.round(width * HEAD_SEARCH_FRACTION)), strips = HEAD_STRIPS } = {}) {
  const refIndex = profiles.findIndex((p) => p !== null);
  if (refIndex < 0) return profiles.map(() => null);
  const reference = profiles[refIndex];
  return profiles.map((p, i) => {
    if (p === null) return null;
    if (i === refIndex) return 0;
    return profileOffset(reference, p, width, { search, strips });
  });
}

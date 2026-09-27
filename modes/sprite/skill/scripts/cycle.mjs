/**
 * cycle.mjs — what a clip's frames say about repetition.
 *
 * Four questions, one measure:
 *
 * - **Is there a cycle, and how long is it?** The whole-clip lag profile
 *   `P[L] = mean_j D(j, j+L)`: a cycle of L frames makes every frame look like
 *   the one L frames later, so the profile dips at L (and at 2L, 3L…). The
 *   period is the SHORTEST dip about as deep as the deepest one, and it has to
 *   sit clearly below the profile's mean or there is no cycle at all.
 * - **Is it half a cycle?** A walk whose near and far legs look alike repeats
 *   every STEP in pixels, and a stride is two steps. When the doubled period
 *   repeats about as well, the answer is ambiguous and is said so, with both
 *   lengths, instead of silently taking the half.
 * - **Is it one performed action?** Seedance's minimum is 4 s, so a strike or
 *   a hop comes back as rest → action → rest, often twice. Such a window has
 *   no period; it has a departure from a rest pose and an observed return.
 * - **Does a wrap close?** The last frame against the first, judged against
 *   the clip's own step — with an absolute noise floor under it, because a
 *   near-still clip moves so little per frame that re-render noise at the
 *   wrap reads as several steps.
 *
 * The measure is `D`: the mean absolute difference of two frames as
 * premultiplied RGBA thumbnails. Colour, not only the outline — a silhouette
 * cannot tell the near leg from the far one, and it cannot see a blink.
 *
 * Pure analysis: frames come in as RGBA bytes already decoded (by
 * `sprite-sheet.mjs`, which owns ffmpeg); nothing here spawns or writes.
 *
 * Ported from aldegad/sprite-gen (Apache-2.0) sprite_gen/video/loop.py@fbd1a08;
 * each function names what it took and what changed. Node built-ins only.
 */

/** Longest edge of an analysis thumbnail, px. `loop.py:44` ANALYSIS_SIZE. */
export const CYCLE_THUMB = 96;

/** A wrap closes at up to this many normal steps. `loop.py:48` SEAM_RATIO_MAX. */
export const SEAM_STEP_LIMIT = 2;

/**
 * The wrap distance that always closes, whatever the step: re-render noise.
 * `loop.py:65` PIN_NOISE_MAX — "a re-rendered first frame is never
 * byte-identical to its source; on the analysis thumbnail it lands within
 * this of it, well under one frame of visible motion". In `D` units (mean
 * |Δ| of premultiplied RGBA over the whole frame), so it is only meaningful
 * next to a `D` step.
 */
export const SEAM_FLOOR = 0.005;

/** The period is the shortest dip within this fraction of the deepest. */
export const PERIOD_TOLERANCE = 0.15;
/** The period must dip this far below the profile mean. `loop.py:50`. */
export const PERIODICITY_MIN = 0.15;
/** A doubled period "repeats about as well" within this. `loop.py:74`. */
export const DOUBLE_TOLERANCE = 0.25;
/** Frames either side of 2P the gait guard searches. `loop.py:75`. */
export const DOUBLE_SEARCH = 3;
/** A repeat this small against a step is exact — not ambiguous. `loop.py:76`. */
export const NEAR_EXACT_STEP_FRACTION = 0.1;
/** Seconds under which a gait's period is one step, not a stride. `loop.py:132-133`. */
export const GAIT_FLOORS = { walk: 0.6, run: 0.35 };

/** Candidate windows reported per cycle: the best cut is a measurement, the
 *  right one a judgement, so the caller gets alternatives. */
export const MAX_CYCLE_WINDOWS = 3;
/** A window whose mean step is under this share of the clip's median step is
 *  a held pose, and a held pose repeats perfectly and says nothing. */
export const HOLD_STEP_FRACTION = 0.25;

// One-shot acceptance, `loop.py:53-66`.
export const ONE_SHOT_MIN_CONTRAST = 3;
export const ONE_SHOT_MIN_MOVED = 0.4;
export const ONE_SHOT_MIN_COHERENCE = 3;
export const ONE_SHOT_MIN_ACTIVE = 4;
export const ONE_SHOT_PAD = 2;
export const ONE_SHOT_MIN_LEN = 4;
/** One-shots reported. A 4–15 s clip holds a handful of strikes at most. */
export const MAX_ONE_SHOTS = 4;

// ---------------------------------------------------------------------------
// The measure
// ---------------------------------------------------------------------------

/**
 * The thumbnail size a `width` × `height` frame is analysed at: its longest
 * edge at CYCLE_THUMB, never enlarged.
 *
 * Ported from aldegad/sprite-gen (Apache-2.0) sprite_gen/video/loop.py@fbd1a08:
 * `_small_features` (`Image.thumbnail((96, 96))`). Changes: ffmpeg
 * `scale=…:flags=area` does the shrinking instead of PIL.
 */
export function thumbSize(width, height) {
  const scale = Math.min(1, CYCLE_THUMB / Math.max(1, width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * One frame's features: its RGBA bytes premultiplied and scaled to 0..1, so a
 * transparent pixel contributes nothing whatever colour it carries.
 *
 * Ported from aldegad/sprite-gen (Apache-2.0) sprite_gen/video/loop.py@fbd1a08:
 * `_small_features`. Changes: none beyond the language.
 */
export function premultiplied(rgba) {
  const out = new Float32Array(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3] / 255;
    out[i] = (rgba[i] / 255) * a;
    out[i + 1] = (rgba[i + 1] / 255) * a;
    out[i + 2] = (rgba[i + 2] / 255) * a;
    out[i + 3] = a;
  }
  return out;
}

/**
 * `D`: the mean absolute difference of two feature vectors, 0 (the same
 * picture) … 1. Averaged over the WHOLE frame, not over the subject, which is
 * why SEAM_FLOOR is a statement about frames the size of a clip.
 *
 * Ported from aldegad/sprite-gen (Apache-2.0) sprite_gen/video/loop.py@fbd1a08:
 * `distance_matrix` (`np.abs(flat - flat[i]).mean(axis=1)`).
 */
export function frameDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / Math.max(1, a.length);
}

/**
 * How much subject a frame holds, on D's scale: the mean of its features.
 *
 * Ported from aldegad/sprite-gen (Apache-2.0) sprite_gen/video/loop.py@fbd1a08:
 * `frame_masses`.
 */
export function frameMass(a) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i];
  return sum / Math.max(1, a.length);
}

/** Every pair's D, as a flat n×n Float32Array (row i, column j at i*n+j). */
export function distanceMatrix(features) {
  const n = features.length;
  const D = new Float32Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = frameDistance(features[i], features[j]);
      D[i * n + j] = d;
      D[j * n + i] = d;
    }
  }
  return D;
}

/** D between consecutive frames: the clip's own step, frame by frame. */
export function adjacentSteps(features) {
  const steps = [];
  for (let i = 0; i + 1 < features.length; i++) steps.push(frameDistance(features[i], features[i + 1]));
  return steps;
}

// ---------------------------------------------------------------------------
// Does a wrap close?
// ---------------------------------------------------------------------------

/**
 * The largest wrap distance that still closes, for a clip whose step is
 * `step`: `SEAM_STEP_LIMIT` steps, or the noise floor, whichever is larger.
 *
 * Ported from aldegad/sprite-gen (Apache-2.0) sprite_gen/video/loop.py@fbd1a08:
 * `pinned_cycle` (`pin_tolerance = max(seam_max * inner, PIN_NOISE_MAX)`,
 * `:447`). Changes: applied to every loop's wrap and every `--seam-fill auto`
 * decision, not only to a pinned clip; `step` is the caller's (a median for
 * `loop`, not upstream's mean). Not applied to a transition's joins, which
 * compare two renders in silhouette units (`JOIN_STEPS`, sprite-sheet.mjs).
 *
 * Measured 2026-09-27 on tanka's ten 60 fps VEED loops: without the floor
 * `--seam-fill auto` fired on six of them at wraps of 0.002–0.003 (a mean
 * 0.6–0.9 % of full scale per channel inside a subject covering 35 % of the
 * frame; the pictures are the same pose) against steps of 0.0003–0.0009, and
 * `reading` warned "does not close" after four in-betweens —
 * `references/video-preview.md`, "Measured: cycle analysis".
 */
export function seamLimit(step) {
  const relative = Number.isFinite(step) && step > 0 ? SEAM_STEP_LIMIT * step : 0;
  return Math.max(relative, SEAM_FLOOR);
}

/** Whether a wrap of `seam` closes against a step of `step`. */
export function seamCloses(seam, step) {
  return seam <= seamLimit(step);
}

// ---------------------------------------------------------------------------
// Is there a cycle?
// ---------------------------------------------------------------------------

const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

/** Median of a numeric array, without sorting the caller's copy. */
export function median(values) {
  if (!values.length) return 0;
  const sorted = Float64Array.from(values).sort();
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * How deep a dip has to be to count, for a period of `period` frames in a
 * clip of `n`: 15 % below the profile mean when the clip holds a whole second
 * period to compare against, rising linearly towards 100 % as the comparison
 * shrinks — two lucky pairs cannot prove a repeat.
 *
 * Ported from aldegad/sprite-gen (Apache-2.0) sprite_gen/video/loop.py@fbd1a08:
 * `periodicity_floor`. Changes: applied to every lag (upstream: attack only),
 * because our window is 0.4–2.5 s for every clip rather than capped at half
 * the clip, so a long period in a short clip is compared on a partial repeat.
 */
export function periodicityFloor(n, period) {
  const coverage = Math.min(1, Math.max(0, n - period) / period);
  return PERIODICITY_MIN + (1 - PERIODICITY_MIN) * (1 - coverage);
}

/**
 * The quarter-cycle either side of a cut, against the same poses one period
 * later — whether the region around the cut repeats, not only the two frames
 * at it. Normalised by the window's step.
 *
 * Ported from aldegad/sprite-gen (Apache-2.0) sprite_gen/video/loop.py@fbd1a08:
 * `_repeat_context` (v2.5.1).
 */
function repeatContext(D, n, start, length, step) {
  const radius = Math.max(1, Math.floor(length / 4));
  const first = Math.max(0, start - radius);
  const stop = Math.min(n - length, start + radius + 1);
  let sum = 0;
  let count = 0;
  for (let j = first; j < stop; j++) { sum += D[j * n + j + length]; count++; }
  const error = count ? sum / count : Infinity;
  return { error, overStep: step > 0 ? error / step : Infinity };
}

/**
 * The windows of `lengths` frames, ranked by how their wrap plays: the step
 * from the last displayed frame back to the first against the window's own
 * mean step, penalised symmetrically in log space — a wrap much smaller than
 * a step is a stall, a much larger one a snap — plus how well the
 * quarter-cycle either side of the cut repeats one period later.
 *
 * Ported from aldegad/sprite-gen (Apache-2.0) sprite_gen/video/loop.py@fbd1a08:
 * `detect_cycle` start ranking (v2.5.0 wrap score, v2.5.1 repeat context).
 * Changes: the repeat-context term applies to every clip by default
 * (upstream: gaits only), because nothing here knows the motion's kind —
 * measured on tanka's celebrate (three hops, then idle), wrap-only ranking put
 * first a cut whose next frame is 3.4 steps from its first, where the clip
 * stops hopping; with the context term the first cut repeats within 0.2 of a
 * step. A window must MOVE — its mean step at least HOLD_STEP_FRACTION of the
 * clip's median step (`contact`'s earlier rule: a held pose repeats perfectly
 * and would otherwise place a cycle inside a closing hold). Every candidate is
 * returned, sorted, so the caller can offer alternatives.
 */
export function rankWindows(D, n, { lengths, adjacent, context: withContext = true, minStep = 0 }) {
  const windows = [];
  for (const length of lengths) {
    if (length < 2) continue;
    for (let i = 0; i + length < n; i++) {
      let inner = 0;
      for (let k = i; k < i + length - 1; k++) inner += adjacent[k];
      inner /= length - 1;
      if (!(inner > 0) || inner < minStep) continue;
      const wrap = D[(i + length - 1) * n + i];
      const ratio = wrap / inner;
      let score = ratio > 0 ? Math.abs(Math.log(ratio)) : Infinity;
      let context = null;
      if (withContext) {
        context = repeatContext(D, n, i, length, inner);
        score += context.overStep;
      }
      windows.push({
        start: i, length, wrap, step: inner, ratio,
        repeat: D[i * n + i + length], score, context,
      });
    }
  }
  // Stable: equal scores keep upstream's order (length, then start).
  return windows.sort((a, b) => a.score - b.score);
}

/**
 * Up to `max` windows from a ranked list whose starts are at least `spacing`
 * frames apart — distinct cuts rather than the same cut shifted by a frame.
 */
function distinctWindows(ranked, max, spacing) {
  const picked = [];
  for (const w of ranked) {
    if (picked.length >= max) break;
    if (picked.some((p) => Math.abs(p.start - w.start) < spacing)) continue;
    picked.push(w);
  }
  return picked;
}

/**
 * The cycle a clip repeats, or the reason it has none.
 *
 * `D` is the flat n×n distance matrix; `minLen` / `maxLen` bound the period
 * in frames; `gait` ("walk" | "run" | null) turns on the gait floor.
 *
 * Returns `{ verdict: "periodic" | "none", reason, period, periodicity,
 * periodicityMin, profileMean, minima, ambiguous, guard, windows }` with every
 * length in FRAMES — the caller owns the frame rate.
 *
 * Ported from aldegad/sprite-gen (Apache-2.0) sprite_gen/video/loop.py@fbd1a08:
 * `detect_cycle` (`:192-313`) — the global profile, the shortest dip within
 * 15 % of the deepest, the periodicity gate, the gait half-period guard
 * (CHANGELOG v2.5.5) and the ambiguous-harmonic check (v2.5.0).
 * Changes:
 * - the window is the caller's, 0.4–2.5 s for every clip (upstream's per-state
 *   walk window, 0.5–1.6 s, refuses tanka's 1.875 s front-facing stride);
 * - the profile averages every pair, not every other one;
 * - a profile with no local minimum inside the window has no cycle (upstream
 *   falls back to the whole window, which on a steadily drifting clip — every
 *   tanka first-last idle — returns the window floor as a "period");
 * - without `gait`, an ambiguous harmonic is FLAGGED (`ambiguous`, the short
 *   period kept first) rather than taken: nothing here knows the clip is a
 *   gait, and taking 2P on a bounce would halve its frames per cycle;
 * - with `gait`, upstream's behaviour: a period under the floor is doubled
 *   when 2P repeats within 25 %, else refused as a half stride; an ambiguous
 *   harmonic above the floor takes 2P and is still flagged.
 */
export function detectCycle(D, n, { minLen, maxLen, gait = null, fps = null }) {
  const adjacent = [];
  for (let i = 0; i + 1 < n; i++) adjacent.push(D[i * n + i + 1]);
  const none = (reason, extra = {}) => ({
    verdict: "none", reason, period: null, periodicity: null, periodicityMin: null,
    profileMean: null, minima: [], ambiguous: null, guard: null, windows: [], ...extra,
  });

  const hi = Math.min(maxLen, n - 2);
  if (minLen < 2 || hi < minLen) return none("window");

  // The profile runs one lag either side of the window so a dip AT either
  // edge is still a local minimum.
  const from = Math.max(2, Math.floor(minLen / 2));
  const to = Math.min(hi + 1, n - 1);
  const profile = new Map();
  for (let L = from; L <= to; L++) {
    let sum = 0;
    for (let j = 0; j + L < n; j++) sum += D[j * n + j + L];
    profile.set(L, sum / (n - L));
  }
  const P = (L) => profile.get(L);
  const profileMean = mean([...profile.values()]);

  const minima = [];
  for (let L = minLen; L <= hi; L++) {
    if (!profile.has(L - 1) || !profile.has(L + 1)) continue;
    if (P(L) <= P(L - 1) && P(L) <= P(L + 1)) minima.push(L);
  }
  const minimaReport = [...minima].sort((a, b) => P(a) - P(b)).slice(0, 6).map((L) => [L, P(L)]);
  if (!minima.length) return none("no-dip", { profileMean, minima: minimaReport });

  const deepest = Math.min(...minima.map(P));
  let period = Math.min(...minima.filter((L) => P(L) <= deepest * (1 + PERIOD_TOLERANCE) + 1e-4));
  let guard = null;
  let ambiguous = null;

  const gaitFloor = gait && GAIT_FLOORS[gait] && fps ? Math.round(GAIT_FLOORS[gait] * fps) : null;
  if (gaitFloor !== null && period < gaitFloor) {
    // Upstream `loop.py:218-248`: a period under the floor is one step. The
    // full stride is the profile's own minimum near 2P, within ±3 frames.
    let doubles = minima.filter((L) => Math.abs(L - 2 * period) <= DOUBLE_SEARCH && L <= hi);
    if (!doubles.length) doubles = [2 * period - 1, 2 * period, 2 * period + 1].filter((L) => profile.has(L) && L <= hi);
    const L2 = doubles.length ? doubles.reduce((a, b) => (P(b) < P(a) ? b : a)) : null;
    const depthRatio = L2 !== null && P(period) > 0 ? P(L2) / P(period) : null;
    if (L2 !== null && P(L2) <= P(period) * (1 + DOUBLE_TOLERANCE) + 1e-4) {
      guard = { applied: true, from: period, to: L2, gaitFloor, depthRatio };
      period = L2;
    } else {
      return none("half-stride", {
        profileMean, minima: minimaReport,
        guard: { applied: false, below: period, gaitFloor, double: L2, depthRatio },
      });
    }
  }

  // The ambiguous harmonic, `loop.py:254-279`: a dip at ~2P about as deep as
  // P's, unless P's repeat is near-exact (then P really is the period).
  if (!guard) {
    const ordinary = mean(adjacent);
    const repeatOverStep = ordinary > 0 ? P(period) / ordinary : Infinity;
    const doubles = minima.filter((L) => Math.abs(L - 2 * period) <= 1);
    if (doubles.length && repeatOverStep > NEAR_EXACT_STEP_FRACTION) {
      const L2 = doubles.reduce((a, b) => (P(b) < P(a) ? b : a));
      if (P(L2) <= P(period) * (1 + DOUBLE_TOLERANCE) + 1e-4
          && profileMean > 0 && (profileMean - P(L2)) / profileMean >= PERIODICITY_MIN) {
        ambiguous = {
          short: period, long: L2,
          depthRatio: P(period) > 0 ? P(L2) / P(period) : null,
          repeatOverStep,
        };
        if (gaitFloor !== null) period = L2;
      }
    }
  }

  const periodicity = profileMean > 0 ? (profileMean - P(period)) / profileMean : 0;
  const periodicityMin = periodicityFloor(n, period);
  const base = {
    period, periodicity, periodicityMin, profileMean, minima: minimaReport, ambiguous, guard,
  };
  // No cycle is no ambiguity about its length: a refused period keeps its
  // numbers (for the sentence) but never offers two readings of nothing.
  if (periodicity < periodicityMin) return { ...none("flat"), ...base, ambiguous: null, verdict: "none", reason: "flat" };

  // --- where to cut it ---------------------------------------------------
  const minStep = HOLD_STEP_FRACTION * median(adjacent);
  const around = (L) => [L - 1, L, L + 1].filter((l) => l >= minLen && l <= hi);
  const ranked = rankWindows(D, n, { lengths: around(period), adjacent, minStep });
  const spacing = Math.max(1, Math.round(period / 4));
  let windows;
  if (ambiguous) {
    // Both lengths on the table: the chosen one's best cuts, and the other
    // length's best cut as the alternative a person should look at.
    const other = period === ambiguous.short ? ambiguous.long : ambiguous.short;
    const alt = rankWindows(D, n, { lengths: around(other), adjacent, minStep });
    windows = [...distinctWindows(ranked, MAX_CYCLE_WINDOWS - 1, spacing), ...alt.slice(0, 1)];
  } else {
    windows = distinctWindows(ranked, MAX_CYCLE_WINDOWS, spacing);
  }
  if (!windows.length) return { ...none("held"), ...base, ambiguous: null, verdict: "none", reason: "held" };
  return { verdict: "periodic", reason: null, ...base, windows };
}

// ---------------------------------------------------------------------------
// Is it one performed action?
// ---------------------------------------------------------------------------

/** k-th smallest of a Float64Array, in place (quickselect). */
function select(values, k) {
  let lo = 0;
  let hi = values.length - 1;
  while (lo < hi) {
    const pivot = values[(lo + hi) >> 1];
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (values[i] < pivot) i++;
      while (values[j] > pivot) j--;
      if (i <= j) { const t = values[i]; values[i] = values[j]; values[j] = t; i++; j--; }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else return values[k];
  }
  return values[k];
}

function medianOf(values, scratch) {
  scratch.set(values);
  const n = values.length;
  const mid = n >> 1;
  if (n % 2) return select(scratch, mid);
  const upper = select(scratch, mid);
  let lower = -Infinity;
  for (let i = 0; i < mid; i++) if (scratch[i] > lower) lower = scratch[i];
  return (lower + upper) / 2;
}

/**
 * Every window where the clip leaves a rest pose and comes back to it:
 * rest → action → rest, with the rest OBSERVED on both sides.
 *
 * For each pair of close endpoint poses (`start`, `end`), `e` is each frame's
 * distance from the pair; the peak of `e` inside the window is the action,
 * and the pair qualifies when their own distance is at most a quarter of the
 * departure. The action is admitted by contrast (the peak ≥ 3 MADs above the
 * clip's typical `e`) or by moved mass (the departure ≥ 0.4 of the subject's
 * pixel mass); its active run must span ≥ 4 frames with ≥ 2 rest frames
 * inside the window on each side — an action clipped by the clip's first or
 * last frame is never padded into one — and the departure must exceed three
 * ordinary steps, which is what separates a strike from jitter.
 *
 * Ported from aldegad/sprite-gen (Apache-2.0) sprite_gen/video/loop.py@fbd1a08:
 * `detect_one_shot` (`:335-411`). Changes: every non-overlapping accepted
 * window is returned (strongest first, each the shortest cut holding ≥ 95 %
 * of its own strongest departure), because a 4 s Seedance clip routinely
 * performs the strike twice; upstream returns only the strongest.
 */
export function detectOneShots(D, n, masses, { maxLen = n } = {}) {
  if (n < ONE_SHOT_MIN_LEN) return [];
  const adjacent = new Float64Array(Math.max(0, n - 1));
  for (let i = 0; i + 1 < n; i++) adjacent[i] = D[i * n + i + 1];
  const prefix = new Float64Array(n);
  for (let i = 1; i < n; i++) prefix[i] = prefix[i - 1] + adjacent[i - 1];
  const e = new Float64Array(n);
  const scratch = new Float64Array(n);
  const deviation = new Float64Array(n);
  const candidates = [];

  for (let start = 0; start + ONE_SHOT_MIN_LEN <= n; start++) {
    for (let end = start + ONE_SHOT_MIN_LEN - 1; end < Math.min(n, start + maxLen); end++) {
      const seam = D[start * n + end];
      // The peak first, over the window only: most pairs fail here and never
      // pay for the whole-clip median below.
      let peak = -Infinity;
      let peakAt = start;
      for (let k = start; k <= end; k++) {
        const v = (D[start * n + k] + D[end * n + k]) / 2;
        if (v > peak) { peak = v; peakAt = k; }
      }
      const departure = peak - seam / 2;
      if (departure <= 0 || seam > departure * 0.25) continue;

      for (let k = 0; k < n; k++) e[k] = (D[start * n + k] + D[end * n + k]) / 2;
      const med = medianOf(e, scratch);
      for (let k = 0; k < n; k++) deviation[k] = Math.abs(e[k] - med);
      const mad = medianOf(deviation, scratch) || 1e-6;
      const contrast = (peak - med) / mad;
      const mass = masses ? (masses[start] + masses[end]) / 2 : 0;
      const moved = mass > 0 ? departure / mass : null;
      let rule;
      let threshold;
      if (contrast >= ONE_SHOT_MIN_CONTRAST) {
        rule = "contrast";
        threshold = med + ONE_SHOT_MIN_CONTRAST * mad;
      } else if (moved !== null && moved >= ONE_SHOT_MIN_MOVED) {
        rule = "moved";
        threshold = seam / 2 + 0.5 * departure;
      } else continue;
      if (!(e[peakAt] > threshold)) continue;
      let a = peakAt;
      let b = peakAt;
      while (a > 0 && e[a - 1] > threshold) a--;
      while (b + 1 < n && e[b + 1] > threshold) b++;
      if (b - a + 1 < ONE_SHOT_MIN_ACTIVE) continue;
      if (!(start <= a - ONE_SHOT_PAD && end >= b + ONE_SHOT_PAD)) continue;
      const inner = (prefix[end] - prefix[start]) / (end - start);
      if (!(inner > 0) || departure < ONE_SHOT_MIN_COHERENCE * inner) continue;
      candidates.push({
        start, end, length: end - start + 1, seam, step: inner, ratio: seam / inner,
        peak: peakAt, excursion: [a, b], departure,
        excursionOverStep: departure / inner, rule,
        contrast, moved,
      });
    }
  }

  const picked = [];
  let remaining = candidates;
  while (remaining.length && picked.length < MAX_ONE_SHOTS) {
    const strongest = Math.max(...remaining.map((c) => c.departure));
    const eligible = remaining.filter((c) => c.departure >= strongest * 0.95);
    const best = eligible.reduce((x, y) => (
      y.length < x.length || (y.length === x.length && (y.ratio < x.ratio || (y.ratio === x.ratio && y.start < x.start))) ? y : x
    ));
    picked.push(best);
    // Windows may share a rest frame, never an action frame.
    remaining = remaining.filter((c) => c.end <= best.start || c.start >= best.end);
  }
  return picked;
}

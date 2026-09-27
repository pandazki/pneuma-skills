/**
 * pixel-lattice.mjs — snap generated "pixel art" onto the pixel grid it was
 * meant to have.
 *
 * An image model asked for pixel art draws blocks that are not whole pixels
 * wide (17.24 px, not 17), wobble inside one frame, carry anti-aliased edges
 * and soft alpha, and change size from frame to frame. Scaling such a sheet by
 * a fixed factor with nearest-neighbour — what this mode did before — cuts
 * through block centres wherever the real pitch is not the factor, so blocks
 * are doubled or dropped and the soft edge stays soft.
 *
 * The lattice here measures the grid instead, per frame and per axis, holds
 * every frame of one generation to that measurement, and collapses each block
 * to one logical pixel:
 *
 *   tighten to the solid-alpha bbox -> detect pitch per axis (2–48 px,
 *   sub-pixel) -> cross-frame median (collapsed values dropped; a frame keeps
 *   its own pitch only within 10 %) -> measured phase (8 x 8 search on cell
 *   uniformity) -> cut lines snapped to colour boundaries (never closer than
 *   0.6 pitch) -> one dominant colour per block, biased toward dark detail ->
 *   binary alpha -> one palette for the whole run (pinned to a file) ->
 *   optional outline darkening.
 *
 * Pure computation on `{ width, height, data }` RGBA buffers plus the palette
 * file's read/write; decoding and encoding stay in `sprite-sheet.mjs`, which
 * owns every image on disk. Node built-ins only.
 *
 * Ported from aldegad/sprite-gen (Apache-2.0) sprite_gen/frames/extract.py@fbd1a08
 * (the "Backbone Lattice", docs/pixel-unfake.md): `_edge_histograms`,
 * `detect_pixel_pitch`, `_axis_int_score`, `_axis_int_seed`, `_axis_refine`,
 * `detect_pixel_grid`, `_grid_score_edges`, `_best_phase`,
 * `resolve_frame_pitch`, `_grid_edges`, `_dominant_block_color`,
 * `solid_alpha_bbox`/`tighten_components`, `_boundary_mass`,
 * `refine_edges_to_boundaries`, `snap_by_edges`, `build_shared_palette`,
 * `apply_palette`, `enforce_outline`, the palette lock, and the consensus /
 * outlier orchestration of `_snap_strip`. Same constants, same integer
 * arithmetic and tie-breaking, so the same input gives the same logical
 * pixels. Changes: re-expressed over flat RGBA buffers; the pose component
 * extraction, `arbitrate_pitch` (a warning that duplicates the run-length
 * crosscheck), `conform_row_logical` (a physical-cell cap this pipeline does
 * not have — `align` sizes the cell to the sprite) and `register_row_frames`
 * (upper-body registration; `align` places the frames here) are not ported;
 * the palette lock stores `#rrggbb` strings rather than RGB triples.
 *
 * The run-length estimator (`estimatePixelGridRunlen`) and its crosscheck are
 * upstream's port of perfectpixel-studio: see that function's header.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** Largest block the detector looks for, in source pixels. */
export const MAX_PITCH = 48;
/** A frame's own pitch is trusted within this ratio of the consensus; outside
 *  it is a harmonic or a collapse and the consensus is used instead. */
export const PITCH_FAMILY_RATIO = 1.1;
/** Per-frame pitches below this share of the largest are collapsed detections
 *  (a divisor of the true pitch) and do not vote in the consensus. */
export const COLLAPSE_FLOOR = 0.6;
/** Colours in the run-wide palette. 24 starved rare saturated accents
 *  (upstream measured a gold hair tie at ΔRGB 59 at 24, 5.5 at 48). */
export const DEFAULT_PALETTE_SIZE = 48;
/** Share of its own colour a silhouette-edge pixel keeps under `--outline`
 *  is 1 − this. */
export const DEFAULT_OUTLINE_STRENGTH = 0.62;
/** The opaque/transparent cut of every step here, as upstream uses it. */
const SOLID_ALPHA = 128;
/** What `pixel` writes into its output directory. */
export const PIXEL_RECORD = "pixel.json";
/** The palette lock's `kind`. */
export const PALETTE_KIND = "pneuma-sprite-palette";

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Python's `round()`: half to even. The ported constants were tuned with it,
 *  and `Math.round` breaks the tie the other way (2.5 -> 3, Python 2). */
export function pyRound(x) {
  const f = Math.floor(x);
  const d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

/** Python's `%` for floats: the result has the divisor's sign. */
function pyMod(a, b) {
  const r = a % b;
  return r !== 0 && (r < 0) !== (b < 0) ? r + b : r;
}

function sum(values) {
  let s = 0;
  for (const v of values) s += v;
  return s;
}

/** A fresh transparent RGBA image. */
export function blankImage(width, height) {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

/** Copy a rectangle out of an image (no bounds clamping — callers pass a box
 *  inside the image). */
export function cropImage(image, x, y, w, h) {
  const out = blankImage(w, h);
  for (let row = 0; row < h; row++) {
    const from = ((y + row) * image.width + x) * 4;
    out.data.set(image.data.subarray(from, from + w * 4), row * w * 4);
  }
  return out;
}

/** Bbox of the pixels whose alpha is at least `min` — `{ x, y, w, h }` or null. */
export function alphaBbox(image, min) {
  const { width, height, data } = image;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] < min) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * The content box the grid is measured on: the SOLID-alpha bbox (α ≥ 128),
 * falling back to any alpha only when nothing is solid.
 *
 * Upstream regressions this carries (`solid_alpha_bbox`, `tighten_components`):
 * cutting the grid from a padded component let phase noise snap the lead to 0
 * and grow a ghost row under the feet (2026-07-14); cutting it from the
 * any-alpha bbox let the sub-128 anti-aliased fringe widen the box by a block
 * and every cell sampled across two real blocks (2026-07-17, 141 of 150
 * frames 1–4 px too wide).
 */
export function solidBbox(image) {
  return alphaBbox(image, SOLID_ALPHA) ?? alphaBbox(image, 1);
}

// ---------------------------------------------------------------------------
// Pitch detection
// ---------------------------------------------------------------------------

/**
 * Colour-transition counts indexed by x (vertical edges, `col`) and by y
 * (horizontal edges, `row`), sampling every other line. An anti-aliased ramp
 * still registers next to the true block boundary, so the boundary position
 * survives the blur.
 */
export function edgeHistograms(image) {
  const { width, height, data } = image;
  const col = new Array(width).fill(0);
  const row = new Array(height).fill(0);
  const diff = (i, j) => Math.abs(data[i] - data[j]) + Math.abs(data[i + 1] - data[j + 1])
    + Math.abs(data[i + 2] - data[j + 2]) + Math.abs(data[i + 3] - data[j + 3]);
  for (let y = 0; y < height; y += 2) {
    for (let x = 1; x < width; x++) {
      const i = (y * width + x) * 4;
      if (diff(i, i - 4) > 96) col[x]++;
    }
  }
  for (let x = 0; x < width; x += 2) {
    for (let y = 1; y < height; y++) {
      const i = (y * width + x) * 4;
      if (diff(i, i - width * 4) > 96) row[y]++;
    }
  }
  return { col, row };
}

/**
 * Score of integer pitch `p` on one axis: the share of edges within ±w of a
 * grid line, minus the share chance would put there (|residues| / p). The
 * window is the same for every p and residues are counted as a SET, never
 * twice — opening the window only for p ≥ 8 made the true pitch lose to its
 * half at k = 8, 10, 12, 14 (upstream's ground-truth test).
 */
export function axisIntScore(edges, p, w = 1) {
  const total = sum(edges) || 1;
  const residueSums = new Array(p).fill(0);
  for (let x = 0; x < edges.length; x++) residueSums[x % p] += edges[x];
  let best = 0;
  for (let phase = 0; phase < p; phase++) {
    const residues = new Set();
    for (let offset = -w; offset <= w; offset++) residues.add(pyMod(phase + offset, p));
    let hit = 0;
    for (const r of residues) hit += residueSums[r];
    const score = hit / total - residues.size / p;
    if (score > best) best = score;
  }
  return best;
}

/**
 * Whole-pixel block pitch of an image, or 1 when no candidate scores above
 * 0.2 — "no grid", observable, never a guess. Divisors of the true pitch lose
 * on their own: their chance term |residues|/p is larger.
 */
export function detectPixelPitch(image, maxPitch = MAX_PITCH, histograms = edgeHistograms(image)) {
  const { col, row } = histograms;
  let bestPitch = 1, bestScore = 0.2;
  for (let p = 2; p <= maxPitch; p++) {
    const score = axisIntScore(col, p) + axisIntScore(row, p);
    if (score > bestScore) {
      bestPitch = p;
      bestScore = score;
    }
  }
  return bestPitch;
}

/** One axis's own integer seed (threshold 0.1), or 1. */
export function axisIntSeed(edges, maxPitch = MAX_PITCH) {
  let bestPitch = 1, bestScore = 0.1;
  for (let p = 2; p <= maxPitch; p++) {
    const score = axisIntScore(edges, p);
    if (score > bestScore) {
      bestPitch = p;
      bestScore = score;
    }
  }
  return bestPitch;
}

/**
 * Best phase and its score for a FRACTIONAL pitch: the edges folded into a
 * histogram of `pitch / binStep` bins and a ±w window slid around it. The
 * returned phase is the edge-weighted centroid of the winning window (its
 * geometric centre sat half a window off on a perfectly aligned grid).
 * Rounding the pitch to an integer instead accumulates 0.24 px per block —
 * 5.5 px across 23 blocks, a cut through the middle of a block.
 */
export function axisRefine(edges, pitch, w = 1.0, binStep = 0.25) {
  const total = sum(edges) || 1;
  const bins = Math.max(4, Math.trunc(pyRound(pitch / binStep)));
  const hist = new Array(bins).fill(0);
  for (let x = 0; x < edges.length; x++) {
    if (edges[x]) hist[Math.trunc(((x % pitch) / pitch) * bins) % bins] += edges[x];
  }
  const span = Math.min(bins, Math.max(1, Math.trunc(pyRound(((2 * w) / pitch) * bins)) + 1));
  const chance = Math.min(1.0, span / bins);
  const doubled = hist.concat(hist);
  let window = 0;
  for (let k = 0; k < span; k++) window += doubled[k];
  let bestScore = window / total - chance;
  let bestBin = 0;
  for (let start = 1; start < bins; start++) {
    window += doubled[start + span - 1] - doubled[start - 1];
    const score = window / total - chance;
    if (score > bestScore) {
      bestScore = score;
      bestBin = start;
    }
  }
  let weight = 0;
  for (let k = 0; k < span; k++) weight += doubled[bestBin + k];
  let centre;
  if (weight) {
    let moment = 0;
    for (let k = 0; k < span; k++) moment += (bestBin + k) * doubled[bestBin + k];
    centre = moment / weight;
  } else {
    centre = bestBin + (span - 1) / 2.0;
  }
  return { score: bestScore, phase: (pyMod(centre, bins) / bins) * pitch };
}

/** ±0.75 px around each seed, in 0.02 px steps: `round(0.75 / 0.02)` = 38. */
const REFINE_SPAN = pyRound(0.75 / 0.02);
const REFINE_STEP = 0.02;

/**
 * The pixel grid of one image: `{ pitch: {x, y}, phase: {x, y} }`, all
 * fractional, or pitch {1, 1} when there is no confident grid.
 *
 * Per axis, because a non-uniformly rescaled generation has different block
 * widths on the two axes (upstream measured 30.38 x 30.92; one pitch forced on
 * both aligned 11.7 % of the edges on one axis, 75.7 % per axis). Seeds are
 * the axis's own integer seed, the combined seed, and their halves and thirds
 * (an integer seed can land on a multiple: 16.5 -> 33). An axis more than
 * 1.5x the other has collapsed onto a divisor (a raised-arm pose with few
 * vertical edges read 3 for a true 9) and takes the axis with more edges.
 */
export function detectPixelGrid(image, maxPitch = MAX_PITCH) {
  const histograms = edgeHistograms(image);
  const combined = detectPixelPitch(image, maxPitch, histograms);
  if (combined <= 1) return { pitch: { x: 1, y: 1 }, phase: { x: 0, y: 0 } };
  const { col, row } = histograms;

  const refine = (edges) => {
    const axisSeed = axisIntSeed(edges, maxPitch);
    const candidates = new Set([axisSeed, combined].filter((s) => s >= 2));
    if (!candidates.size) return { pitch: 1, phase: 0 };
    const seedSet = new Set(candidates);
    for (const s of candidates) for (const d of [2, 3]) if (s / d >= 2.0) seedSet.add(s / d);
    const seeds = [...seedSet].sort((a, b) => a - b);
    let best = { score: -1.0, pitch: Math.max(...candidates), phase: 0.0 };
    for (const centre of seeds) {
      for (let i = -REFINE_SPAN; i <= REFINE_SPAN; i++) {
        const pitch = centre + i * REFINE_STEP;
        if (pitch < 2.0 || pitch > maxPitch) continue;
        const { score, phase } = axisRefine(edges, pitch);
        if (score > best.score + 1e-9) best = { score, pitch, phase };
      }
    }
    return { pitch: best.pitch, phase: best.phase };
  };

  const x = refine(col);
  const y = refine(row);
  let px = x.pitch, py = y.pitch;
  const lo = Math.min(px, py), hi = Math.max(px, py);
  if (lo >= 2.0 && hi / lo > 1.5) {
    if (sum(col) >= sum(row)) py = px;
    else px = py;
  }
  return { pitch: { x: px, y: py }, phase: { x: x.phase, y: y.phase } };
}

// --- run-length second opinion ----------------------------------------------

const RUNLEN_ALPHA_THRESHOLD = 10;
const RUNLEN_RGB_TOLERANCE = 12;
const RUNLEN_MIN_RUNS = 32;
const RUNLEN_MODE_SHARE = 0.5;

function runlenAxis(image, horizontal, cap) {
  const { width, height, data } = image;
  const outer = horizontal ? height : width;
  const inner = horizontal ? width : height;
  const at = (i, o) => (horizontal ? (o * width + i) * 4 : (i * width + o) * 4);
  const hist = new Array(cap + 2).fill(0);
  for (let o = 0; o < outer; o += 2) {
    let prev = at(0, o);
    let run = 1;
    for (let i = 1; i < inner; i++) {
      const cur = at(i, o);
      const ca = data[cur + 3], pa = data[prev + 3];
      const same = (ca <= RUNLEN_ALPHA_THRESHOLD && pa <= RUNLEN_ALPHA_THRESHOLD)
        || (ca > RUNLEN_ALPHA_THRESHOLD && pa > RUNLEN_ALPHA_THRESHOLD
          && Math.abs(data[cur] - data[prev]) <= RUNLEN_RGB_TOLERANCE
          && Math.abs(data[cur + 1] - data[prev + 1]) <= RUNLEN_RGB_TOLERANCE
          && Math.abs(data[cur + 2] - data[prev + 2]) <= RUNLEN_RGB_TOLERANCE);
      if (same) {
        run++;
      } else {
        if (run >= 2 && run <= cap) hist[run]++;
        run = 1;
      }
      prev = cur;
    }
    if (run >= 2 && run <= cap) hist[run]++;
  }
  if (sum(hist) < RUNLEN_MIN_RUNS) return 1.0;
  const weighted = hist.map((count, length) => count * length);
  let mode = 2;
  for (let l = 3; l <= cap; l++) if (weighted[l] > weighted[mode]) mode = l;
  const lo = Math.max(2, mode - 1), hi = Math.min(cap, mode + 1);
  let window = 0;
  for (let l = lo; l <= hi; l++) window += weighted[l];
  if (!weighted[mode]) return 1.0;
  // A mode's harmonics (k·mode ± k) support it — neighbouring logical pixels
  // of one colour make 2·mode and 3·mode runs. Mass scattered outside the
  // family is no block structure at all.
  let family = 0;
  for (let k = 1; k < Math.trunc(cap / mode) + 2; k++) {
    const centre = k * mode;
    for (let l = Math.max(2, centre - k); l <= Math.min(cap, centre + k); l++) family += weighted[l];
  }
  if (family < sum(weighted) * RUNLEN_MODE_SHARE) return 1.0;
  let moment = 0;
  for (let l = lo; l <= hi; l++) moment += l * weighted[l];
  return moment / window;
}

/**
 * A second, independent pitch estimate per axis from same-colour run lengths
 * — used only to WARN when the grid detector disagrees, never to snap.
 *
 * Ported from aldegad/sprite-gen (Apache-2.0) sprite_gen/frames/extract.py@fbd1a08
 * `estimate_pixel_grid_runlen`, itself a port of the unfake same-colour
 * run-length mode block-size estimation from perfectpixel-studio
 * (https://github.com/gykim80/perfectpixel-studio, internal/sprite/pixelize.go),
 * Copyright Andrew Kim (gykim80), MIT License. Changes: none beyond the JS.
 */
export function estimatePixelGridRunlen(image, maxPitch = MAX_PITCH) {
  const { width, height } = image;
  if (width < 32 || height < 32) return { x: 1.0, y: 1.0 };
  const cap = Math.min(maxPitch, Math.trunc(Math.min(width, height) / 8));
  if (cap < 2) return { x: 1.0, y: 1.0 };
  return { x: runlenAxis(image, true, cap), y: runlenAxis(image, false, cap) };
}

/**
 * Sentences for a grid pitch the run-length estimate contradicts. Run lengths
 * only ever UNDER-estimate (anti-aliasing eats both ends of a run), which
 * shapes each rule: a run-length pitch well above the grid's is a divisor
 * misdetection; a grid pitch well above the run-length one (after 3 px of
 * slack) a harmonic; and a y/x ratio that disagrees by more than
 * max(2 %, 0.7 / pitch) one axis collapsing onto the other.
 * Ported from upstream `crosscheck_pitch_runlen` (same thresholds).
 */
export function crosscheckPitchRunlen(grid, runlen, axisTolerance = 0.12, ratioTolerance = 0.02) {
  const notes = [];
  for (const axis of ["x", "y"]) {
    const g = grid[axis], r = runlen[axis];
    if (g < 2.0 || r < 2.0) continue;
    if (r - g > Math.max(axisTolerance * g, 2.0)) {
      notes.push(`pitch crosscheck: run-length mode estimates ${axis}=${r.toFixed(2)} but grid detection returned ${axis}=${g.toFixed(2)} — likely a divisor misdetection`);
    } else if (g - r > axisTolerance * g + 3.0) {
      notes.push(`pitch crosscheck: run-length mode estimates ${axis}=${r.toFixed(2)} but grid detection returned ${axis}=${g.toFixed(2)} — likely a multiple/harmonic misdetection`);
    }
  }
  if (Math.min(grid.x, grid.y, runlen.x, runlen.y) >= 2.0) {
    const gridRatio = grid.y / grid.x;
    const runlenRatio = runlen.y / runlen.x;
    const drift = Math.abs(runlenRatio / gridRatio - 1.0);
    if (drift > Math.max(ratioTolerance, 0.7 / Math.min(grid.x, grid.y))) {
      notes.push(`pitch crosscheck: axis ratio y/x disagrees — run-length ${runlenRatio.toFixed(3)} vs grid ${gridRatio.toFixed(3)} (${(drift * 100).toFixed(1)}%); one axis may have collapsed to the other`);
    }
  }
  return notes;
}

// ---------------------------------------------------------------------------
// The grid: pitch per frame, consensus, phase, cut lines
// ---------------------------------------------------------------------------

/**
 * Median of the confident per-frame pitches on one axis, after dropping the
 * collapsed ones (below 60 % of the largest — half of one six-frame run read
 * 3.00 for a true pitch and dragged the median to 5.00). Upstream's upper
 * median (`trusted[len // 2]`), not the mean of the middle pair. Returns
 * `{ value, dropped }`, value 1 when no frame was confident.
 */
export function consensusPitch(values) {
  const confident = values.filter((v) => v >= 2.0).sort((a, b) => a - b);
  if (!confident.length) return { value: 1, dropped: 0, floor: null };
  const ceiling = confident[confident.length - 1];
  const floor = ceiling * COLLAPSE_FLOOR;
  const trusted = confident.filter((v) => v >= floor);
  return { value: trusted[trusted.length >> 1], dropped: confident.length - trusted.length, floor };
}

/**
 * The pitch a frame is cut at. Its own measurement is the truth — forcing the
 * consensus on a frame whose true pitch is 4 % off accumulates across the
 * width and cut an eye in half — but only within the consensus's pitch family
 * (ratio 1.1 on either axis): outside it the frame read a harmonic or a
 * collapse, and trusting that once turned a whole row into specks.
 * Returns `{ pitch, outlier }`.
 */
export function resolveFramePitch(own, consensus) {
  if (Math.min(consensus.x, consensus.y) < 2.0) return { pitch: own, outlier: false };
  const ratio = Math.max(own.x / consensus.x, consensus.x / own.x, own.y / consensus.y, consensus.y / own.y);
  return ratio > PITCH_FAMILY_RATIO ? { pitch: consensus, outlier: true } : { pitch: own, outlier: false };
}

/**
 * Whole-pixel cut positions for a fractional pitch along `length`.
 *
 * When the body is within a quarter block of a whole number of blocks it is
 * divided evenly (absorbing 16.00 measured as 15.96); otherwise the lines sit
 * at `lead + i·pitch` and the last cell takes the remainder — dividing an
 * 849 px body (27.46 blocks) evenly stretched every cell by 0.52 px and slid
 * half a block by the far edge (upstream v1.56.2). A lead under a quarter or
 * over three quarters of a block is phase noise and snaps to 0: the content
 * box already starts on a block boundary.
 */
export function gridEdges(length, pitch, offset) {
  if (pitch <= 1.0) return [0, length];
  const rawLead = pyMod(offset, pitch);
  const lead = rawLead < pitch * 0.25 || rawLead > pitch * 0.75 ? 0 : Math.trunc(pyRound(rawLead));
  const body = length - lead;
  if (body <= 0) return [0, length];
  const ratio = body / pitch;
  const cells = Math.max(1, Math.trunc(pyRound(ratio)));
  const integral = Math.abs(ratio - cells) <= 0.25;
  const edges = lead === 0 ? [0] : [0, lead];
  for (let i = 1; i < cells; i++) {
    const e = lead + Math.trunc(pyRound(integral ? (body * i) / cells : i * pitch));
    if (edges[edges.length - 1] < e && e < length) edges.push(e);
  }
  if (edges[edges.length - 1] !== length) edges.push(length);
  return edges;
}

function opaqueMask(image) {
  const { width, height, data } = image;
  const mask = new Uint8Array(width * height);
  for (let p = 0; p < mask.length; p++) mask[p] = data[p * 4 + 3] >= SOLID_ALPHA ? 1 : 0;
  return mask;
}

/**
 * Mean absolute colour deviation inside the cells of one grid hypothesis,
 * opaque pixels only, weighted by cell size — lower is a truer grid.
 *
 * Upstream's exact integer form: for a channel with sum s over n pixels and
 * C/S the count/sum of values ≤ ⌊s/n⌋, n·Σ|v − m| = 2·(s·C − n·S), so a
 * cell contributes 2·t/n with t an exact integer. Same summation order, same
 * value to the last bit — `bestPhase`'s argmin is what the snap uses.
 */
export function gridScore(image, mask, xs, ys) {
  const { width, height, data } = image;
  let totalDev = 0, totalN = 0;
  for (let yi = 0; yi < ys.length - 1; yi++) {
    const y0 = ys[yi], y1 = Math.min(ys[yi + 1], height);
    for (let xi = 0; xi < xs.length - 1; xi++) {
      const x0 = Math.min(xs[xi], width), x1 = Math.min(xs[xi + 1], width);
      let n = 0, s0 = 0, s1 = 0, s2 = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const p = y * width + x;
          if (!mask[p]) continue;
          const i = p * 4;
          n++;
          s0 += data[i];
          s1 += data[i + 1];
          s2 += data[i + 2];
        }
      }
      if (n < 2) continue;
      const m0 = Math.floor(s0 / n), m1 = Math.floor(s1 / n), m2 = Math.floor(s2 / n);
      let c0 = 0, c1 = 0, c2 = 0, l0 = 0, l1 = 0, l2 = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const p = y * width + x;
          if (!mask[p]) continue;
          const i = p * 4;
          const r = data[i], g = data[i + 1], b = data[i + 2];
          if (r <= m0) { c0++; l0 += r; }
          if (g <= m1) { c1++; l1 += g; }
          if (b <= m2) { c2++; l2 += b; }
        }
      }
      const t = (s0 * c0 - n * l0) + (s1 * c1 - n * l1) + (s2 * c2 - n * l2);
      totalDev += (2 * t) / n;
      totalN += n;
    }
  }
  return totalN ? totalDev / totalN : 1e9;
}

/**
 * The phase whose cells are most uniform at a fixed pitch, searched over
 * 8 x 8 offsets per axis. MEASURED, not taken from the detector's edge
 * histogram: that phase can sit pitch/2 off (13.00 px pitch: 2.02 vs 8.12),
 * outside the ±pitch/3 the cut-line snap can recover, and a character's eye
 * went from four rows to three. Pitch is fixed here, so the uniformity
 * score's bias toward coarse grids plays no part.
 */
export function bestPhase(image, pitch, mask = opaqueMask(image)) {
  const steps = 8;
  let best = { x: 0, y: 0 };
  let bestScore = null;
  const cache = new Map();
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < steps; j++) {
      const phase = { x: (pitch.x * i) / steps, y: (pitch.y * j) / steps };
      const xs = gridEdges(image.width, pitch.x, phase.x);
      const ys = gridEdges(image.height, pitch.y, phase.y);
      // Distinct phases often round to the same whole-pixel lines; the score
      // of a line set is a pure function of it.
      const key = `${xs.join(",")}|${ys.join(",")}`;
      let score = cache.get(key);
      if (score === undefined) {
        score = gridScore(image, mask, xs, ys);
        cache.set(key, score);
      }
      if (bestScore === null || score < bestScore) {
        bestScore = score;
        best = phase;
      }
    }
  }
  return best;
}

/** Per-axis colour/alpha boundary mass — the evidence a cut line snaps to.
 *  `col[x]` counts transitions between x−1 and x, on every row. */
export function boundaryMass(image) {
  const { width, height, data } = image;
  const col = new Array(Math.max(1, width)).fill(0);
  const row = new Array(Math.max(1, height)).fill(0);
  const differs = (i, j) => {
    const ao = data[i + 3] >= SOLID_ALPHA, bo = data[j + 3] >= SOLID_ALPHA;
    if (ao !== bo) return true;
    return ao && bo
      && Math.abs(data[i] - data[j]) + Math.abs(data[i + 1] - data[j + 1]) + Math.abs(data[i + 2] - data[j + 2]) > 48;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width - 1; x++) {
      const i = (y * width + x) * 4;
      if (differs(i, i + 4)) col[x + 1]++;
    }
  }
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height - 1; y++) {
      const i = (y * width + x) * 4;
      if (differs(i, i + width * 4)) row[y + 1]++;
    }
  }
  return { col, row };
}

/**
 * Move each interior cut line to the strongest colour boundary within
 * ±pitch/3 of it — a model's blocks wobble locally, and an evenly spaced cut
 * spills the edge of one block into the next (ghost pixels under an eye, one
 * pixel under the feet). The sliver guard: no two lines closer than 0.6·pitch
 * (2 px below pitch 3.3). An absolute 2 px floor let a boundary pair 5 px
 * apart pull two neighbouring lines together and sample one source band twice
 * — a chin line doubled, an eye flipped colour (upstream 2026-07-24).
 */
export function refineEdgesToBoundaries(image, xs, ys, pitch, mass = boundaryMass(image)) {
  const snap = (edges, profile, pitchAxis, limit) => {
    if (edges.length < 3) return edges;
    const out = [...edges];
    const window = Math.max(1, Math.trunc(pitchAxis / 3));
    const minGap = Math.max(2, Math.trunc(pyRound(pitchAxis * 0.6)));
    for (let i = 1; i < out.length - 1; i++) {
      const e = edges[i];
      const lo = Math.max(out[i - 1] + minGap, e - window);
      const hi = Math.min(edges[i + 1] - minGap, e + window, limit - 1);
      if (hi < lo) continue;
      let best = lo;
      const at = (pos) => (pos < profile.length ? profile[pos] : 0);
      for (let pos = lo + 1; pos <= hi; pos++) if (at(pos) > at(best)) best = pos;
      if (at(best) > 0) out[i] = best;
    }
    for (let i = 1; i < out.length; i++) if (out[i] <= out[i - 1]) return [...edges];
    return out;
  };
  return {
    xs: snap(xs, mass.col, pitch.x, image.width),
    ys: snap(ys, mass.row, pitch.y, image.height),
  };
}

const luma = (r, g, b) => r * 299 + g * 587 + b * 114;

/**
 * One colour for one block: a two-cluster k-means (seeded at the darkest and
 * lightest pixel, three rounds, integer centroids) and the larger cluster's
 * mean. With `detailBias` a near-black minority wins instead — share ≥ 40 %,
 * luma < 70, at least 50 darker than the other cluster — so eyes and 1 px
 * outlines survive the vote.
 *
 * `pixels` is a flat list of RGB triples [r, g, b, r, g, b, …] in block order.
 */
export function dominantBlockColor(pixels, detailBias = false) {
  const n = pixels.length / 3;
  if (n === 1) return [pixels[0], pixels[1], pixels[2]];
  let lo = 0, hi = 0;
  for (let k = 1; k < n; k++) {
    const l = luma(pixels[3 * k], pixels[3 * k + 1], pixels[3 * k + 2]);
    if (l < luma(pixels[3 * lo], pixels[3 * lo + 1], pixels[3 * lo + 2])) lo = k;
    if (l > luma(pixels[3 * hi], pixels[3 * hi + 1], pixels[3 * hi + 2])) hi = k;
  }
  const centroids = [
    [pixels[3 * lo], pixels[3 * lo + 1], pixels[3 * lo + 2]],
    [pixels[3 * hi], pixels[3 * hi + 1], pixels[3 * hi + 2]],
  ];
  const assign = new Uint8Array(n);
  for (let round = 0; round < 3; round++) {
    const [c0, c1] = centroids;
    for (let k = 0; k < n; k++) {
      const r = pixels[3 * k], g = pixels[3 * k + 1], b = pixels[3 * k + 2];
      const d0 = (r - c0[0]) ** 2 + (g - c0[1]) ** 2 + (b - c0[2]) ** 2;
      const d1 = (r - c1[0]) ** 2 + (g - c1[1]) ** 2 + (b - c1[2]) ** 2;
      assign[k] = d0 <= d1 ? 0 : 1;
    }
    for (const cluster of [0, 1]) {
      let s0 = 0, s1 = 0, s2 = 0, count = 0;
      for (let k = 0; k < n; k++) {
        if (assign[k] !== cluster) continue;
        s0 += pixels[3 * k];
        s1 += pixels[3 * k + 1];
        s2 += pixels[3 * k + 2];
        count++;
      }
      if (count) centroids[cluster] = [Math.floor(s0 / count), Math.floor(s1 / count), Math.floor(s2 / count)];
    }
  }
  let ones = 0;
  for (let k = 0; k < n; k++) ones += assign[k];
  let dominant = n - ones >= ones ? 0 : 1;
  if (detailBias) {
    const l0 = luma(...centroids[0]), l1 = luma(...centroids[1]);
    const darker = l0 <= l1 ? 0 : 1;
    const share = (darker === 1 ? ones : n - ones) / n;
    const dl = luma(...centroids[darker]), ll = luma(...centroids[1 - darker]);
    if (darker !== dominant && share >= 0.40 && dl < 70000 && ll - dl > 50000) dominant = darker;
  }
  let s0 = 0, s1 = 0, s2 = 0, count = 0;
  for (let k = 0; k < n; k++) {
    if (assign[k] !== dominant) continue;
    s0 += pixels[3 * k];
    s1 += pixels[3 * k + 1];
    s2 += pixels[3 * k + 2];
    count++;
  }
  return [Math.floor(s0 / count), Math.floor(s1 / count), Math.floor(s2 / count)];
}

/**
 * Collapse each block between the cut lines to one logical pixel: transparent
 * unless at least half the block is solid, then the block's dominant colour at
 * full alpha. The output's alpha is binary by construction.
 */
export function snapByEdges(image, xs, ys, detailBias = false) {
  const { width, data } = image;
  const out = blankImage(xs.length - 1, ys.length - 1);
  for (let oy = 0; oy < ys.length - 1; oy++) {
    for (let ox = 0; ox < xs.length - 1; ox++) {
      const opaque = [];
      let total = 0;
      for (let y = ys[oy]; y < ys[oy + 1]; y++) {
        for (let x = xs[ox]; x < xs[ox + 1]; x++) {
          total++;
          const i = (y * width + x) * 4;
          if (data[i + 3] >= SOLID_ALPHA) opaque.push(data[i], data[i + 1], data[i + 2]);
        }
      }
      if ((opaque.length / 3) * 2 < total) continue;
      const [r, g, b] = dominantBlockColor(opaque, detailBias);
      const o = (oy * out.width + ox) * 4;
      out.data[o] = r;
      out.data[o + 1] = g;
      out.data[o + 2] = b;
      out.data[o + 3] = 255;
    }
  }
  return out;
}

/** Snap at a known pitch and phase, optionally pulling the cut lines onto
 *  colour boundaries — the whole per-frame snap once the pitch is decided. */
export function snapGrid(image, pitch, phase, { refine = true, detailBias = true } = {}) {
  let xs = gridEdges(image.width, pitch.x, phase.x);
  let ys = gridEdges(image.height, pitch.y, phase.y);
  if (refine) ({ xs, ys } = refineEdgesToBoundaries(image, xs, ys, pitch));
  return { logical: snapByEdges(image, xs, ys, detailBias), xs, ys };
}

// ---------------------------------------------------------------------------
// One generation's frames
// ---------------------------------------------------------------------------

/**
 * Snap every frame of one generation onto its lattice.
 *
 * `images` are the frames (cells), in order; an empty one stays empty.
 * Returns per frame `{ logical, box, own, pitch, source, phase, xs, ys }`
 * (`box` the solid bbox the grid was cut from, in the frame's coordinates;
 * `source` "own" | "consensus" | "outlier" | "empty"), the consensus pitch, and
 * the warnings — every fallback is said, none is silent. Throws nothing: a
 * generation where no frame shows a grid comes back with `consensus` {1, 1}
 * and the caller decides.
 */
export function latticeFrames(images, { detailBias = true, pitchHint = null, maxPitch = MAX_PITCH } = {}) {
  const warnings = [];
  const tight = images.map((image) => {
    const box = solidBbox(image);
    return box ? { box, image: cropImage(image, box.x, box.y, box.w, box.h) } : null;
  });
  const grids = tight.map((t) => (t ? detectPixelGrid(t.image, maxPitch) : null));

  const axisConsensus = (axis) => {
    const { value, dropped, floor } = consensusPitch(grids.filter(Boolean).map((g) => g.pitch[axis]));
    if (dropped) warnings.push(`dropped ${dropped} collapsed per-frame ${axis} pitch(es) below ${floor.toFixed(2)}`);
    if (value >= 2) return value;
    if (pitchHint !== null && pitchHint >= 2) {
      warnings.push(`${axis} pitch from --pitch-hint ${pitchHint} (every per-frame detection was inconclusive)`);
      return pitchHint;
    }
    return 1;
  };
  const consensus = { x: axisConsensus("x"), y: axisConsensus("y") };

  // The second opinion: warnings only, the snap never reads it.
  const runlens = tight.map((t) => (t ? estimatePixelGridRunlen(t.image, maxPitch) : null)).filter(Boolean);
  const runlenAxis = (axis) => {
    const confident = runlens.map((r) => r[axis]).filter((v) => v >= 2.0).sort((a, b) => a - b);
    return confident.length ? confident[confident.length >> 1] : 1.0;
  };
  const runlen = { x: runlenAxis("x"), y: runlenAxis("y") };
  warnings.push(...crosscheckPitchRunlen(consensus, runlen));

  const frames = tight.map((t, index) => {
    const tag = `frame ${String(index).padStart(2, "0")}`;
    if (!t) return { index, logical: null, box: null, own: null, pitch: null, source: "empty" };
    const own = grids[index].pitch;
    let pitch;
    let source;
    if (Math.min(own.x, own.y) >= 2.0) {
      const resolved = resolveFramePitch(own, consensus);
      pitch = resolved.pitch;
      source = resolved.outlier ? "outlier" : "own";
      if (resolved.outlier) {
        warnings.push(`${tag}: own pitch ${own.x.toFixed(2)}x${own.y.toFixed(2)} is outside the consensus pitch family ${consensus.x.toFixed(2)}x${consensus.y.toFixed(2)} — a harmonic or collapsed reading; snapped at the consensus`);
      }
    } else if (Math.min(consensus.x, consensus.y) >= 2.0) {
      pitch = consensus;
      source = "consensus";
      warnings.push(`${tag}: pitch detection inconclusive — snapped at the consensus ${consensus.x.toFixed(2)}x${consensus.y.toFixed(2)}`);
    } else {
      return { index, logical: null, box: t.box, own, pitch: null, source: "none" };
    }
    const phase = bestPhase(t.image, pitch);
    const { logical, xs, ys } = snapGrid(t.image, pitch, phase, { detailBias });
    return { index, logical, box: t.box, own, pitch, source, phase, xs, ys };
  });

  return { frames, consensus, runlen, warnings };
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

/**
 * One median-cut palette over every solid pixel of every frame — shared, so a
 * colour does not flicker between frames and the character keeps its
 * identity colours. Repeatedly splits the box with the widest channel range
 * at its median; `size` 48 (upstream raised it from 24, which lost a 0.2 %
 * gold accent). Returns `[[r, g, b], …]`.
 */
export function buildSharedPalette(frames, size = DEFAULT_PALETTE_SIZE) {
  const colors = [];
  for (const frame of frames) {
    const { data } = frame;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] >= SOLID_ALPHA) colors.push([data[i], data[i + 1], data[i + 2]]);
    }
  }
  if (!colors.length) return [];
  const widest = (box) => {
    let bestRange = -1, bestChannel = 0;
    for (let channel = 0; channel < 3; channel++) {
      let lo = 255, hi = 0;
      for (const c of box) {
        if (c[channel] < lo) lo = c[channel];
        if (c[channel] > hi) hi = c[channel];
      }
      if (hi - lo > bestRange) {
        bestRange = hi - lo;
        bestChannel = channel;
      }
    }
    return { spread: bestRange, channel: bestChannel };
  };
  const boxes = [colors];
  while (boxes.length < size) {
    let best = null;
    for (let index = 0; index < boxes.length; index++) {
      const box = boxes[index];
      if (box.length < 2) continue;
      const { spread, channel } = widest(box);
      if (spread > 0 && (best === null || spread > best.spread)) best = { spread, channel, index };
    }
    if (best === null) break;
    const [box] = boxes.splice(best.index, 1);
    // Array#sort is stable, as Python's is — equal keys keep their order.
    box.sort((a, b) => a[best.channel] - b[best.channel]);
    const mid = box.length >> 1;
    boxes.push(box.slice(0, mid), box.slice(mid));
  }
  return boxes.filter((box) => box.length).map((box) => {
    const s = [0, 0, 0];
    for (const c of box) {
      s[0] += c[0];
      s[1] += c[1];
      s[2] += c[2];
    }
    return s.map((v) => Math.floor(v / box.length));
  });
}

/** Map every solid pixel to its nearest palette colour (squared RGB distance,
 *  first on a tie), every other pixel to transparent black. In place. */
export function applyPalette(image, palette) {
  if (!palette.length) return image;
  const { data } = image;
  const cache = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < SOLID_ALPHA) {
      data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 0;
      continue;
    }
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    let color = cache.get(key);
    if (!color) {
      let bestD = Infinity;
      for (const c of palette) {
        const d = (c[0] - data[i]) ** 2 + (c[1] - data[i + 1]) ** 2 + (c[2] - data[i + 2]) ** 2;
        if (d < bestD) {
          bestD = d;
          color = c;
        }
      }
      cache.set(key, color);
    }
    data[i] = color[0];
    data[i + 1] = color[1];
    data[i + 2] = color[2];
    data[i + 3] = 255;
  }
  return image;
}

/**
 * Darken every silhouette-edge pixel (a solid pixel with a transparent or
 * out-of-bounds 4-neighbour) to (1 − strength) of its own colour — a uniform
 * 1 logical-pixel outline where the downscale left the source's thin one in
 * patches. In place.
 */
export function enforceOutline(image, strength = DEFAULT_OUTLINE_STRENGTH) {
  const { width, height, data } = image;
  const solid = (x, y) => x >= 0 && y >= 0 && x < width && y < height && data[(y * width + x) * 4 + 3] >= SOLID_ALPHA;
  const boundary = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!solid(x, y)) continue;
      if (!solid(x - 1, y) || !solid(x + 1, y) || !solid(x, y - 1) || !solid(x, y + 1)) boundary.push((y * width + x) * 4);
    }
  }
  const keep = 1.0 - strength;
  for (const i of boundary) {
    data[i] = Math.trunc(data[i] * keep);
    data[i + 1] = Math.trunc(data[i + 1] * keep);
    data[i + 2] = Math.trunc(data[i + 2] * keep);
    data[i + 3] = 255;
  }
  return image;
}

export const hexColor = (c) => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

function parseHex(value) {
  const m = /^#([0-9a-fA-F]{6})$/.exec(String(value));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * The pinned palette at `path`, or null when there is none. A file that is
 * there and unreadable is an error, never a silent rebuild: the whole point of
 * pinning is that re-running cannot move the colours.
 */
export function loadPalette(path) {
  const file = resolve(path);
  if (!existsSync(file)) return null;
  let doc;
  try {
    doc = JSON.parse(readFileSync(file, "utf-8"));
  } catch (error) {
    throw new Error(`${file} is not valid JSON (${error.message}) — fix it, delete it, or pass --repalette`);
  }
  const colors = Array.isArray(doc?.colors) ? doc.colors.map(parseHex) : null;
  if (!colors || !colors.length || colors.some((c) => c === null)) {
    throw new Error(`${file} is not a palette (needs a non-empty colors list of #rrggbb) — fix it, delete it, or pass --repalette`);
  }
  return { file, colors, source: typeof doc.source === "string" ? doc.source : null };
}

/** Write a palette atomically (scratch file + rename). */
export function writePalette(path, colors, source) {
  const file = resolve(path);
  mkdirSync(dirname(file), { recursive: true });
  const scratch = `${file}.tmp`;
  try {
    writeFileSync(scratch, `${JSON.stringify({
      kind: PALETTE_KIND,
      version: 1,
      source,
      colors: colors.map(hexColor),
    }, null, 2)}\n`);
    renameSync(scratch, file);
  } finally {
    if (existsSync(scratch)) rmSync(scratch, { force: true });
  }
  return file;
}

// ---------------------------------------------------------------------------
// Placement and checks
// ---------------------------------------------------------------------------

/** Integer nearest-neighbour upscale — every logical pixel becomes an n x n
 *  block, nothing in between. */
export function upscale(image, n) {
  if (n === 1) return image;
  const out = blankImage(image.width * n, image.height * n);
  for (let y = 0; y < out.height; y++) {
    const sy = Math.floor(y / n);
    for (let x = 0; x < out.width; x++) {
      const s = (sy * image.width + Math.floor(x / n)) * 4;
      out.data.set(image.data.subarray(s, s + 4), (y * out.width + x) * 4);
    }
  }
  return out;
}

/** Paste `sprite` into `canvas` at whole-pixel (x, y), clipping at the edges. */
export function paste(canvas, sprite, x, y) {
  for (let row = 0; row < sprite.height; row++) {
    const ty = y + row;
    if (ty < 0 || ty >= canvas.height) continue;
    for (let col = 0; col < sprite.width; col++) {
      const tx = x + col;
      if (tx < 0 || tx >= canvas.width) continue;
      const s = (row * sprite.width + col) * 4;
      canvas.data.set(sprite.data.subarray(s, s + 4), (ty * canvas.width + tx) * 4);
    }
  }
  return canvas;
}

/**
 * Whether an image is still on its lattice: alpha only 0 or 255, every n x n
 * block anchored at the image origin one colour, and (given a palette) every
 * solid colour a palette colour. `offGrid` counts blocks with more than one
 * RGBA value; `offPalette` distinct solid colours not in the palette.
 */
export function latticeCheck(image, n = 1, palette = null) {
  const { width, height, data } = image;
  let softAlpha = 0;
  const colors = new Set();
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a !== 0 && a !== 255) softAlpha++;
    if (a >= SOLID_ALPHA) colors.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
  }
  let offGrid = 0;
  if (n > 1) {
    for (let by = 0; by < height; by += n) {
      for (let bx = 0; bx < width; bx += n) {
        const first = (by * width + bx) * 4;
        let uniform = true;
        for (let y = by; y < Math.min(by + n, height) && uniform; y++) {
          for (let x = bx; x < Math.min(bx + n, width); x++) {
            const i = (y * width + x) * 4;
            // Two transparent pixels are the same pixel whatever RGB they hide.
            if (data[i + 3] === 0 && data[first + 3] === 0) continue;
            if (data[i] !== data[first] || data[i + 1] !== data[first + 1]
              || data[i + 2] !== data[first + 2] || data[i + 3] !== data[first + 3]) {
              uniform = false;
              break;
            }
          }
        }
        if (!uniform) offGrid++;
      }
    }
  }
  let offPalette = 0;
  if (palette) {
    const known = new Set(palette.map((c) => (c[0] << 16) | (c[1] << 8) | c[2]));
    for (const c of colors) if (!known.has(c)) offPalette++;
  }
  return { softAlpha, offGrid, offPalette, colors: colors.size };
}

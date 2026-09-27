/**
 * breathe.mjs — a breathing idle from one still, with no model call.
 *
 * The body below the neck swells and settles on a travelling wave while the
 * head rides on top as one rigid block and the soles stay where they stand.
 * Where the head ends is measured, not declared: the anatomy pass finds the
 * body axis, the neck (the most prominent narrowing of the width profile),
 * a mirror-symmetric pair of eyes when the face sits on the body, and
 * whatever reaches sideways far past the torso (an arm, a wing, a held
 * lantern) so it is pushed rather than stretched.
 *
 * Two ways to move the pixels, one deformation field:
 *
 *   pixel  — the whole-pixel bake: rows are duplicated or dropped, columns
 *            remapped, and a final pass thins a doubled dark outline back to
 *            1 px. Every output pixel is a source pixel, so pixel art stays
 *            on its grid.
 *   smooth — for anti-aliased art: the same field resampled continuously
 *            (area-weighted, premultiplied alpha), so a cloak's diagonal edge
 *            does not step. The head is translated by a WHOLE number of
 *            pixels — the stretch below it absorbs the fraction — so it is
 *            pixel-identical in every frame, and nothing is thinned.
 *
 * Pure module: RGBA buffers in, RGBA buffers out, Node built-ins only.
 * `sprite-sheet.mjs breathe` decodes the still, writes the frames and prints
 * the report.
 *
 * Ported from aldegad/sprite-gen (Apache-2.0)
 * sprite_gen/effects/anatomy.py@fbd1a08: the silhouette anatomy (alpha
 * centroid axis, the axis-run width profile, neck bottleneck by prominence
 * with the shoulder-gradient fallback, the symmetric dark eye pair, the rigid
 * row, torso and maximum half-widths, the manual overrides), and
 * sprite_gen/effects/breathe.py@fbd1a08: the wave 0.86·sin2πt + 0.14·sin4πt,
 * the foot ramp × rigid taper envelope normalised to depth × (height − neck),
 * the appendage protection ramp, the per-row strain cap, the phase pattern,
 * the whole-pixel warp with its outline preservation, and the 1 px outline
 * thinning (also mirrored in sprite_gen/serve/curator/src/breathe.js).
 * Helpers from sprite_gen/frames/extract.py (solid_alpha_bbox) and
 * sprite_gen/frames/segment.py (mask_components, smooth_profile).
 * Changes: re-expressed in JS over raw RGBA; the envelope's sum mirrors
 * CPython ≥ 3.12's compensated float `sum` so the whole-pixel bake matches
 * the Python bake bit for bit; the canvas GROWS (and says so) instead of
 * refusing when the stretch would leave it; the sidecar / curator plumbing
 * (frozen anatomy, fingerprints, depth_x) is not ported; our default depth
 * is 0.02, not 0.06. Ours, not upstream's: the `smooth` mode, the
 * image-coordinate overrides, the per-frame head check and the warning for a
 * prop that crosses the rigid row.
 */

/** A refusal this module knows how to phrase. The CLI prints its message. */
export class BreatheError extends Error {}

export const BREATHE_MODES = ["smooth", "pixel"];

// --- anatomy constants (anatomy.py) ----------------------------------------
/** Alpha at or above this is "solid": the silhouette the anatomy measures. */
export const ALPHA_SOLID = 128;
/** Something reaches sideways (an appendage) when the widest half-width is
 *  at least this many torso half-widths. */
export const APPENDAGE_RATIO = 1.3;
/** A width-profile minimum is a neck when its prominence reaches this share of
 *  the widest row. */
export const BOTTLENECK_PROMINENCE = 0.06;
const EYE_MAX_EXTENT = 0.2;
const EYE_ASPECT = [0.4, 2.5];
const EYE_MIN_AREA = 0.002;
const EYE_MAX_AREA = 0.06;
const EYE_TOP_LIMIT = 0.65;
const DARK_QUANTILE = 0.3;

// --- deformation constants (breathe.py) -------------------------------------
/** Half-width of the ramp that fades the deformation to zero at the rigid
 *  row, as a share of the content height. The ramp is what hides the seam. */
export const TAPER = 0.055;
/** The bottom share (of the deformable height) over which the deformation
 *  rises from zero, so the feet never lift. */
export const FOOT = 0.28;
/** Largest per-row strain the field may reach; past it the bake is refused. */
export const MAX_ROW_STRAIN = 0.25;
/** Travelling-wave delay (share of a breath): the upper body rises a beat
 *  after the lower, so the head arrives late. */
export const DEFAULT_LAG = 0.1;
/** Frames one breath needs before it reads as breathing and not a twitch. */
export const SMOOTH_CYCLE_FRAMES = 6;
/**
 * Our default depth, NOT upstream's 0.06: their constant was tuned on 32–64 px
 * pixel art, where 6 % is one or two pixels. Measured on the Lumi seed (a
 * 233 px anti-aliased chibi, 2026-09-27): 0.05 swings the height 227–240 px
 * and the head −7…+6 px, which reads as bouncing; 0.02 keeps 230–236 px.
 */
export const DEFAULT_BREATHE_DEPTH = 0.02;
/** Default frames for one breath: upstream's tempo (six frames at 4 fps, 1.5 s
 *  a breath) at the 8 fps our previews play — twice the frames, same breath. */
export const FRAMES_PER_BREATH = 12;
/** The rate a breathe plays at: FRAMES_PER_BREATH frames make one 1.5 s
 *  breath at 8 fps — upstream's tempo, measured on Lumi (T6). The one
 *  authority: `sprite-sheet.mjs breathe` defaults `--fps` to it, and
 *  `sprite-project.mjs add-motion --source breathe` records it until the run
 *  lands with the rate it really has. */
export const BREATHE_FPS = 8;
/** Depth and lag bounds (upstream's curation schema bounds). */
export const DEPTH_MIN = 0.005;
export const DEPTH_MAX = 0.2;
export const LAG_MAX = 0.45;
/** A pixel darker than this (Rec. 601 luma) is outline for the thinning pass. */
const OUTLINE_LUMA = 60;

// ---------------------------------------------------------------------------
// Small numerics
// ---------------------------------------------------------------------------

/** One breath: a sine with a little second harmonic, so the inhale peaks. */
export function wave(t) {
  return 0.86 * Math.sin(2 * Math.PI * t) + 0.14 * Math.sin(4 * Math.PI * t);
}

export function smoothstep(a, b, x) {
  if (b <= a) return x >= b ? 1 : 0;
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
}

/**
 * CPython's `sum()` over floats (3.12+): Neumaier-compensated. The envelope
 * normalisation is a float sum, and the whole-pixel bake rounds row heights
 * built on it — a plain left-to-right sum differs in the last bits (270 of
 * 426 rigid rows on the Lumi stills) and can move a duplicated row. Mirrored
 * so `pixel` matches upstream's bake exactly.
 */
function pySum(values) {
  let total = 0;
  let c = 0;
  for (const x of values) {
    const t = total + x;
    if (Math.abs(total) >= Math.abs(x)) c += (total - t) + x;
    else c += (x - t) + total;
    total = t;
  }
  return c && Number.isFinite(c) ? total + c : total;
}

/** Python's `round()` on a float: halves go to the even neighbour. */
function pyRound(x) {
  const f = Math.floor(x);
  const diff = x - f;
  if (diff < 0.5) return f;
  if (diff > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

// ---------------------------------------------------------------------------
// Anatomy (anatomy.py)
// ---------------------------------------------------------------------------

/** Bounding box of the pixels with alpha ≥ `threshold`, end-exclusive, or null. */
export function solidBox(image, threshold = ALPHA_SOLID) {
  const { width, height, data } = image;
  let x0 = width, y0 = height, x1 = 0, y1 = 0;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (data[(row + x) * 4 + 3] < threshold) continue;
      if (x < x0) x0 = x;
      if (x + 1 > x1) x1 = x + 1;
      if (y < y0) y0 = y;
      if (y + 1 > y1) y1 = y + 1;
    }
  }
  return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null;
}

const solidAt = (image, x, y) => image.data[(y * image.width + x) * 4 + 3] >= ALPHA_SOLID;

/** The body axis: the x centroid of the solid pixels, box-relative, floored. */
function axisCentroid(image, box) {
  let total = 0, acc = 0;
  for (let y = box.y0; y < box.y1; y++) {
    for (let x = box.x0; x < box.x1; x++) {
      if (!solidAt(image, x, y)) continue;
      acc += x - box.x0;
      total++;
    }
  }
  return Math.floor(acc / Math.max(1, total));
}

/**
 * Per row, the width of the solid run through the axis (or through the
 * solid pixel nearest it). A wing held away from the body is a separate run
 * and so never counts as the body's width.
 */
function widthProfile(image, box, cx) {
  const width = box.x1 - box.x0;
  const out = [];
  for (let y = box.y0; y < box.y1; y++) {
    let seed = null;
    if (solidAt(image, box.x0 + cx, y)) {
      seed = cx;
    } else {
      for (let i = 0; i < width; i++) {
        if (solidAt(image, box.x0 + i, y) && (seed === null || Math.abs(i - cx) < Math.abs(seed - cx))) seed = i;
      }
    }
    if (seed === null) {
      out.push(0);
      continue;
    }
    let lo = seed;
    while (lo > 0 && solidAt(image, box.x0 + lo - 1, y)) lo--;
    let hi = seed;
    while (hi < width - 1 && solidAt(image, box.x0 + hi + 1, y)) hi++;
    out.push(hi - lo + 1);
  }
  return out;
}

/** Box moving average, the window clamped at both ends. */
function smoothProfile(profile, window) {
  if (window < 1 || !profile.length) return profile;
  const half = window >> 1;
  const n = profile.length;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n - 1, i + half);
    let sum = 0;
    for (let k = lo; k <= hi; k++) sum += profile[k];
    out[i] = sum / (hi - lo + 1);
  }
  return out;
}

/** Local minima and their prominence: the lower of the two maxima either side,
 *  minus the minimum. A staircase dip is shallow; a neck is not. */
function bottleneckProminences(profile) {
  const n = profile.length;
  if (n < 3) return [];
  const before = new Array(n);
  const after = new Array(n);
  let m = -Infinity;
  for (let i = 0; i < n; i++) { before[i] = m; m = Math.max(m, profile[i]); }
  m = -Infinity;
  for (let i = n - 1; i >= 0; i--) { after[i] = m; m = Math.max(m, profile[i]); }
  const out = [];
  for (let i = 1; i < n - 1; i++) {
    if (profile[i] > profile[i - 1] || profile[i] > profile[i + 1]) continue;
    out.push([i, Math.min(before[i], after[i]) - profile[i]]);
  }
  return out;
}

function bestBottleneck(profile, u0, u1) {
  const n = profile.length;
  const lo = Math.trunc(n * u0), hi = Math.trunc(n * u1);
  const peak = n ? Math.max(...profile) : 0;
  let best = null;
  for (const [i, p] of bottleneckProminences(profile)) {
    if (i < lo || i >= hi) continue;
    if (best === null || p > best[1]) best = [i, p];
  }
  if (best === null) return null;
  return best[1] >= BOTTLENECK_PROMINENCE * peak ? best[0] : null;
}

/** The row where the silhouette widens fastest going down: the shoulder line
 *  of a body with no neck. A marker that there is no neck, not a neck. */
function steepestWidening(profile, u0, u1) {
  const n = profile.length;
  const lo = Math.max(1, Math.trunc(n * u0));
  const hi = Math.min(n, Math.max(2, Math.trunc(n * u1)));
  let best = lo, bestValue = -Infinity;
  for (let i = lo; i < hi; i++) {
    const value = profile[i] - profile[i - 1];
    if (value > bestValue) { best = i; bestValue = value; }
  }
  return best;
}

function detectNeck(profile) {
  const n = profile.length;
  const smooth = smoothProfile(profile, 2 * Math.max(1, Math.floor(n / 40)) + 1);
  const row = bestBottleneck(smooth, 0.05, 0.7);
  if (row !== null) return [row, "bottleneck"];
  return [steepestWidening(smooth, 0.05, 0.6), "shoulder-gradient"];
}

/** 4-connected components of a boolean mask, as end-exclusive boxes, seeds
 *  in index order; components outside [minArea, maxArea] are left out. */
function maskComponents(mask, w, h, minArea, maxArea) {
  const visited = new Uint8Array(mask.length);
  const stack = new Int32Array(mask.length);
  const boxes = [];
  for (let seed = 0; seed < mask.length; seed++) {
    if (!mask[seed] || visited[seed]) continue;
    let top = 0;
    stack[top++] = seed;
    visited[seed] = 1;
    let minx = Infinity, miny = Infinity, maxx = -1, maxy = -1, area = 0;
    while (top > 0) {
      const cur = stack[--top];
      area++;
      const x = cur % w;
      const y = (cur - x) / w;
      if (x < minx) minx = x;
      if (x > maxx) maxx = x;
      if (y < miny) miny = y;
      if (y > maxy) maxy = y;
      const push = (q) => { if (mask[q] && !visited[q]) { visited[q] = 1; stack[top++] = q; } };
      if (x > 0) push(cur - 1);
      if (x < w - 1) push(cur + 1);
      if (y > 0) push(cur - w);
      if (y < h - 1) push(cur + w);
    }
    if (area >= minArea && (maxArea === null || area <= maxArea)) boxes.push([minx, miny, maxx + 1, maxy + 1]);
  }
  return boxes;
}

/**
 * The face's rows, from a mirror-symmetric pair of small, compact dark blobs
 * straddling the axis — both conditions at once, or an outline (dark) or a
 * pair of arms (symmetric) would qualify. Null when there is no such pair;
 * anime eyes with highlights and lashes usually are not one.
 */
function detectFace(image, box, cx) {
  const w = box.x1 - box.x0, h = box.y1 - box.y0;
  const { data, width } = image;
  const lums = new Float64Array(w * h);
  const solid = new Uint8Array(w * h);
  let area = 0, lo = Infinity, hi = -Infinity;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const p = ((box.y0 + j) * width + box.x0 + i) * 4;
      if (data[p + 3] < ALPHA_SOLID) continue;
      const v = luma(data[p], data[p + 1], data[p + 2]);
      lums[j * w + i] = v;
      solid[j * w + i] = 1;
      area++;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  if (!area) return null;
  const threshold = lo + DARK_QUANTILE * (hi - lo);
  const mask = new Uint8Array(w * h);
  for (let k = 0; k < w * h; k++) mask[k] = solid[k] && lums[k] <= threshold ? 1 : 0;

  const blobs = [];
  for (const [bx0, by0, bx1, by1] of maskComponents(mask, w, h,
    Math.max(4, Math.trunc(EYE_MIN_AREA * area)), Math.trunc(EYE_MAX_AREA * area))) {
    const bw = bx1 - bx0, bh = by1 - by0;
    if (bh > EYE_MAX_EXTENT * h || bw > EYE_MAX_EXTENT * w) continue;
    if (!(EYE_ASPECT[0] <= bw / bh && bw / bh <= EYE_ASPECT[1])) continue;
    if (by0 > EYE_TOP_LIMIT * h) continue;
    blobs.push([bx0, by0, bx1, by1, bw * bh]);
  }

  let best = null;
  for (let i = 0; i < blobs.length; i++) {
    const a = blobs[i];
    for (let k = i + 1; k < blobs.length; k++) {
      const b = blobs[k];
      const amid = (a[0] + a[2]) / 2, bmid = (b[0] + b[2]) / 2;
      const da = amid - cx, db = bmid - cx;
      // The eyes sit on EITHER side of the axis; without this one eye pairs
      // with a mouth on the axis and the face reaches down past the mouth.
      if (da * db >= 0 || Math.min(Math.abs(da), Math.abs(db)) < 0.05 * w) continue;
      if (Math.abs((amid + bmid) / 2 - cx) > 0.08 * w) continue;
      if (Math.abs(amid - bmid) < 0.1 * w) continue;
      if (Math.max(a[4], b[4]) > 2.5 * Math.min(a[4], b[4])) continue;
      if (Math.min(a[3], b[3]) < Math.max(a[1], b[1])) continue;
      const score = [a[4] + b[4], -Math.abs(da + db)];
      if (best === null || score[0] > best.score[0] || (score[0] === best.score[0] && score[1] > best.score[1])) {
        best = { score, top: Math.min(a[1], b[1]), bottom: Math.max(a[3], b[3]) - 1 };
      }
    }
  }
  if (best === null) return null;
  // Room below the eyes for the mouth: an expression breaks when the mouth
  // moves and the eyes do not.
  return [best.top, Math.min(h - 1, best.bottom + Math.max(1, pyRound((best.bottom - best.top) * 0.7)))];
}

/** (median torso half-width over the deformable rows, widest half-width
 *  there) — their ratio is how much reaches sideways. */
function torsoMetrics(image, box, cx, profile, rowLo, rowHi) {
  const band = [];
  for (let r = Math.max(0, rowLo); r < Math.min(profile.length, rowHi); r++) if (profile[r]) band.push(profile[r]);
  band.sort((a, b) => a - b);
  const torso = band.length ? Math.floor(band[band.length >> 1] / 2) : Math.floor((box.x1 - box.x0) / 4);
  let maxHalf = 0;
  for (let j = Math.max(0, rowLo); j < Math.min(box.y1 - box.y0, rowHi); j++) {
    for (let i = 0; i < box.x1 - box.x0; i++) {
      if (solidAt(image, box.x0 + i, box.y0 + j)) maxHalf = Math.max(maxHalf, Math.abs(i - cx));
    }
  }
  return [Math.max(1, torso), Math.max(1, maxHalf)];
}

/**
 * The anatomy of one still — every row and column relative to its solid
 * bounding box (`box`), the way upstream's sidecar records it. Overrides
 * replace the detected value (detection still runs, and the replaced value is
 * named in a warning); out-of-range overrides are refused, never clamped.
 */
export function analyzeAnatomy(image, { rigidRow = null, axisX = null, torsoHalf = null } = {}) {
  const box = solidBox(image);
  if (!box) throw new BreatheError(`no solid content (alpha >= ${ALPHA_SOLID}) to measure`);
  const w = box.x1 - box.x0, h = box.y1 - box.y0;
  if (w < 4 || h < 8) throw new BreatheError(`the solid content is ${w}x${h} px — too small to breathe`);
  const autoCx = axisCentroid(image, box);
  let cx = autoCx;
  if (axisX !== null) {
    if (!Number.isInteger(axisX) || axisX < 0 || axisX >= w) throw new BreatheError(`axis ${axisX} is outside the content width 0..${w - 1}`);
    cx = axisX;
  }
  const profile = widthProfile(image, box, cx);
  const [neckRow, neckSource] = detectNeck(profile);
  const face = detectFace(image, box, cx);

  const warnings = [];
  if (axisX !== null && axisX !== autoCx) warnings.push(`axis-x-override: auto ${autoCx} -> manual ${axisX}`);
  let rigid = Math.max(neckRow, face ? face[1] + 1 : 0);
  rigid = Math.min(rigid, Math.trunc(h * 0.8));
  const autoRigid = rigid;
  let rigidSource = face && face[1] + 1 > neckRow ? "face" : "neck";
  if (rigidRow !== null) {
    if (!Number.isInteger(rigidRow) || rigidRow <= 0 || rigidRow >= h) throw new BreatheError(`rigid row ${rigidRow} is outside the content height 1..${h - 1}`);
    if (rigidRow !== rigid) warnings.push(`rigid-row-override: auto ${rigid} -> manual ${rigidRow}`);
    rigid = rigidRow;
    rigidSource = "manual";
  }
  // The amplitude is normalised to the neck only when the neck is real: a
  // slime's monotone profile has none, and (height − that row) would be many
  // times the rows that actually deform.
  const basisRow = neckSource === "bottleneck" ? neckRow : rigid;
  if (neckSource !== "bottleneck") warnings.push(`neck-absent: no bottleneck in the width profile; fell back to the shoulder gradient (the amplitude is normalised to the rigid row ${rigid})`);
  if (!face) warnings.push("face-absent: no mirror-symmetric eye pair; the rigid row comes from the neck alone");

  let [torso, maxHalf] = torsoMetrics(image, box, cx, profile, rigid, h);
  const autoTorso = torso;
  let torsoSource = "auto";
  if (torsoHalf !== null) {
    if (!Number.isInteger(torsoHalf) || torsoHalf < 1 || torsoHalf > w) throw new BreatheError(`torso half-width ${torsoHalf} is outside 1..${w}`);
    if (torsoHalf !== torso) warnings.push(`torso-half-override: auto ${torso} -> manual ${torsoHalf}`);
    torso = torsoHalf;
    torsoSource = "manual";
  }
  return {
    box, width: w, height: h, axisX: cx, neckRow, neckSource, rigidRow: rigid, rigidSource, basisRow,
    torsoHalf: torso, maxHalf, torsoSource, face: face ? { top: face[0], bottom: face[1] } : null, warnings,
    // What detection said before any override, so a report can show both.
    auto: { axisX: autoCx, rigidRow: autoRigid, torsoHalf: autoTorso },
  };
}

/** The anatomy's warnings, with every row and column said in the still's
 *  pixel coordinates — the ones the CLI's overrides take. */
function imageWarnings(anat) {
  const { x0, y0 } = anat.box;
  return anat.warnings.map((w) => {
    if (w.startsWith("axis-x-override:")) return `axis-x-override: detected x=${x0 + anat.auto.axisX} -> manual x=${x0 + anat.axisX}`;
    if (w.startsWith("rigid-row-override:")) return `rigid-row-override: detected y=${y0 + anat.auto.rigidRow} -> manual y=${y0 + anat.rigidRow}`;
    if (w.startsWith("torso-half-override:")) return `torso-half-override: detected ${anat.auto.torsoHalf}px -> manual ${anat.torsoHalf}px`;
    if (w.startsWith("neck-absent:")) return `neck-absent: no bottleneck in the width profile; fell back to the shoulder gradient (the amplitude is normalised to the rigid row y=${y0 + anat.rigidRow})`;
    return w;
  });
}

export const hasAppendage = (anat) => anat.maxHalf >= APPENDAGE_RATIO * anat.torsoHalf;
/** The rigid row as a height fraction measured from the soles (0) to the crown (1). */
export const rigidU = (anat) => 1 - anat.rigidRow / Math.max(1, anat.height - 1);
const basisRows = (anat) => Math.max(1, anat.height - anat.basisRow);
/** u of content row j: 1 at the crown, 0 at the soles. */
const rowU = (anat, j) => 1 - j / Math.max(1, anat.height - 1);

// ---------------------------------------------------------------------------
// The deformation field (breathe.py)
// ---------------------------------------------------------------------------

/**
 * env(u) = foot ramp × (1 − rigid taper), and the factor that makes the total
 * stretch depth × (height − basis row) whatever the taper and ramp eat — so a
 * depth means the same on every character.
 */
export function envelope(anat) {
  const height = anat.height;
  const ru = rigidU(anat);
  const band = Math.max(1.5, TAPER * height) / Math.max(1, height);
  const footTop = FOOT * ru;
  const env = (u) => smoothstep(0, footTop, u) * (1 - smoothstep(ru - band, ru + band, u));
  const values = [];
  for (let j = 0; j < height; j++) values.push(env(j / Math.max(1, height - 1)));
  const total = pySum(values);
  return { env, norm: total > 1e-6 ? basisRows(anat) / total : 0, ru };
}

/**
 * p(x) in [0, 1]: 1 where a column is beside the body rather than of it, and
 * is pushed outward instead of stretched. Auto: only when something really
 * reaches sideways, ramping from 1.15 torso half-widths to 0.95 of the widest.
 * Manual torso: always on, ramping over 2 px past the given half-width.
 */
export function protect(anat) {
  const cx = anat.axisX;
  if (anat.torsoSource === "manual") {
    const t0 = anat.torsoHalf;
    const t1 = t0 + 2;
    return (x) => smoothstep(t0, t1, Math.abs(x - cx));
  }
  if (!hasAppendage(anat)) return () => 0;
  const t0 = anat.torsoHalf * 1.15;
  const t1 = Math.max(t0 + 1, anat.maxHalf * 0.95);
  return (x) => smoothstep(t0, t1, Math.abs(x - cx));
}

/** The largest strain one row reaches at `depth` — checked against
 *  MAX_ROW_STRAIN before anything is drawn. */
export function rowStrain(anat, depth) {
  const { env, norm } = envelope(anat);
  let peak = 0;
  for (let j = 0; j < anat.height; j++) peak = Math.max(peak, env(j / Math.max(1, anat.height - 1)));
  return depth * norm * peak;
}

/** Phases in [0, 1) for `count` frames holding `breaths` whole breaths. The
 *  integer remainder comes first, so equal phases are equal doubles. */
export function breathePhases(count, breaths) {
  return Array.from({ length: count }, (_, i) => ((i * breaths) % count) / count);
}

function gainAt(anat, field, depth, lag, t) {
  const { env, norm, ru } = field;
  return (u) => {
    const e = env(u);
    if (e <= 0) return 0;
    return depth * norm * wave(t - lag * Math.min(1, u / Math.max(1e-6, ru))) * e;
  };
}

/** Content rows from the crown down whose deformation is exactly zero: the
 *  block that is translated, never resampled. */
export function rigidRows(anat) {
  const { env } = envelope(anat);
  let j = 0;
  while (j < anat.height && env(rowU(anat, j)) === 0) j++;
  return j;
}

// ---------------------------------------------------------------------------
// pixel: the whole-pixel bake (breathe.py `_warp`, `_thin_outline_1px`)
// ---------------------------------------------------------------------------

function blank(width, height) {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

/**
 * One phase, whole pixels only: each content row is written 0, 1 or 2 times
 * (the rounded running height), each output column takes one source column
 * (the monotone integral of the row's density about the body axis). The
 * canvas is the input's; the caller pads it so nothing can leave.
 */
export function warpPixel(image, anat, { depth, lag, phase }) {
  const { box } = anat;
  const width = box.x1 - box.x0, height = box.y1 - box.y0;
  const W = image.width, H = image.height;
  const src = image.data;
  const anchorX = box.x0 + anat.axisX;
  const baseline = box.y1;
  const field = envelope(anat);
  const pOf = protect(anat);
  const gain = gainAt(anat, field, depth, lag, phase);

  const heights = new Float64Array(height);
  let acc = 0;
  for (let j = 0; j < height; j++) {
    const g = gain(rowU(anat, j));
    acc += g === 0 ? 1 : 1 / (1 + g);
    heights[j] = acc;
  }
  const total = Math.max(1, Math.floor(acc + 0.5));

  const out = blank(W, H);
  const dst = out.data;
  const srcAlpha = (i, j) => src[((box.y0 + j) * W + box.x0 + i) * 4 + 3];
  let yCursor = baseline - total;
  let prev = 0;
  let clipped = 0;
  let deformed = false;
  for (let j = 0; j < height; j++) {
    const cur = Math.floor(heights[j] + 0.5);
    const reps = Math.max(0, cur - prev);
    prev = cur;
    if (reps === 0) continue;
    const g = gain(rowU(anat, j));
    if (reps !== 1) deformed = true;
    let rowMap;
    if (g === 0) {
      rowMap = Array.from({ length: width }, (_, i) => [box.x0 + i, i]);
    } else {
      deformed = true;
      const edge = [0];
      for (let i = 0; i < width; i++) edge.push(edge[i] + Math.max(0.05, 1 + g * (1 - pOf(i))));
      const origin = edge[anat.axisX];
      const lo = Math.floor(edge[0] - origin + 0.5);
      const hi = Math.floor(edge[width] - origin + 0.5);
      rowMap = [];
      let i = 0;
      for (let ox = lo; ox < hi; ox++) {
        while (i < width - 1 && edge[i + 1] - origin <= ox) i++;
        rowMap.push([anchorX + ox, i]);
      }
      // Outline preservation: a squeezed row can lose its end columns — the
      // 1 px outline — so the outermost opaque output pixels are pinned to
      // the row's outermost opaque source columns.
      let opLo = -1, opHi = -1;
      for (let k = 0; k < width; k++) if (srcAlpha(k, j)) { if (opLo < 0) opLo = k; opHi = k; }
      if (opHi >= 0 && rowMap.length) {
        for (let k = rowMap.length - 1; k >= 0; k--) if (srcAlpha(rowMap[k][1], j)) { rowMap[k] = [rowMap[k][0], opHi]; break; }
        for (let k = 0; k < rowMap.length; k++) if (srcAlpha(rowMap[k][1], j)) { rowMap[k] = [rowMap[k][0], opLo]; break; }
      }
    }
    for (let r = 0; r < reps; r++) {
      const yy = yCursor + r;
      for (const [ox, si] of rowMap) {
        const s = ((box.y0 + j) * W + box.x0 + si) * 4;
        if (!src[s + 3]) continue;
        if (yy < 0 || yy >= H || ox < 0 || ox >= W) { clipped++; continue; }
        const d = (yy * W + ox) * 4;
        dst[d] = src[s]; dst[d + 1] = src[s + 1]; dst[d + 2] = src[s + 2]; dst[d + 3] = src[s + 3];
      }
    }
    yCursor += reps;
  }
  if (deformed) thinOutline(out);
  return { image: out, clipped, deformed, headOffset: height - total };
}

/** Repeat the thinning pass to a fixed point: removing one protrusion can
 *  expose the next. Every pass only removes or recolours opaque pixels, so it
 *  ends; the cap is a tripwire, not a budget. */
export function thinOutline(image) {
  for (let pass = 0; pass < 10_000; pass++) {
    if (!thinOutlinePass(image)) return;
  }
  throw new BreatheError("internal: outline thinning did not converge");
}

/**
 * One pass normalising a warp-doubled silhouette outline back to 1 px on the
 * INNER line: at a row or column end, dark-dark-interior drops the outer dark
 * pixel; a lone dark end pixel 1 px outside both neighbouring rows' ends is
 * dropped and its colour painted one pixel in. A drop that would expose
 * interior colour at the edge or punch a hole in a dark line is withdrawn, to
 * a fixed point. Reads a snapshot, writes once: order-independent.
 */
function thinOutlinePass(image) {
  const { width: w, height: h } = image;
  const snap = Uint8Array.from(image.data);
  const op = (x, y) => x >= 0 && x < w && y >= 0 && y < h && snap[(y * w + x) * 4 + 3] !== 0;
  const dark = (x, y) => {
    if (!op(x, y)) return false;
    const i = (y * w + x) * 4;
    return luma(snap[i], snap[i + 1], snap[i + 2]) < OUTLINE_LUMA;
  };
  // Keys sort like upstream's (x, y) tuples.
  const key = (x, y) => x * h + y;
  const cand = new Map();
  for (let x = 0; x < w; x++) {
    let t0 = -1, b0 = -1;
    for (let y = 0; y < h; y++) if (op(x, y)) { if (t0 < 0) t0 = y; b0 = y; }
    if (t0 < 0) continue;
    if (t0 + 2 <= b0 && dark(x, t0) && dark(x, t0 + 1) && op(x, t0 + 2) && !dark(x, t0 + 2)) cand.set(key(x, t0), "v");
    if (b0 - 2 >= t0 && dark(x, b0) && dark(x, b0 - 1) && op(x, b0 - 2) && !dark(x, b0 - 2)) cand.set(key(x, b0), "v");
  }
  const put = (x, y, axis) => { const k = key(x, y); if (!cand.has(k)) cand.set(k, axis); };
  const rowLo = new Map();
  const rowHi = new Map();
  for (let y = 0; y < h; y++) {
    let l0 = -1, r0 = -1;
    for (let x = 0; x < w; x++) if (op(x, y)) { if (l0 < 0) l0 = x; r0 = x; }
    if (l0 < 0) continue;
    rowLo.set(y, l0);
    rowHi.set(y, r0);
    if (l0 + 2 <= r0 && dark(l0, y) && dark(l0 + 1, y) && op(l0 + 2, y) && !dark(l0 + 2, y)) put(l0, y, "h");
    if (r0 - 2 >= l0 && dark(r0, y) && dark(r0 - 1, y) && op(r0 - 2, y) && !dark(r0 - 2, y)) put(r0, y, "h");
  }
  const moves = new Map();
  for (const y of [...rowLo.keys()].sort((a, b) => a - b)) {
    const m = rowLo.get(y);
    const upLo = rowLo.get(y - 1), dnLo = rowLo.get(y + 1);
    if (upLo !== undefined && dnLo !== undefined && Math.min(upLo, dnLo) - m === 1 && dark(m, y) && op(m + 1, y)) {
      put(m, y, "h");
      if (!dark(m + 1, y)) moves.set(key(m + 1, y), (y * w + m) * 4);
    }
    const r = rowHi.get(y);
    const upHi = rowHi.get(y - 1), dnHi = rowHi.get(y + 1);
    if (upHi !== undefined && dnHi !== undefined && r - Math.max(upHi, dnHi) === 1 && dark(r, y) && op(r - 1, y)) {
      put(r, y, "h");
      if (!dark(r - 1, y)) moves.set(key(r - 1, y), (y * w + r) * 4);
    }
  }
  const drop = new Set(cand.keys());
  let changed = true;
  while (changed) {
    changed = false;
    for (const k of [...drop].sort((a, b) => a - b)) {
      const x = Math.floor(k / h), y = k - x * h;
      const neigh = cand.get(k) === "h" ? [[x, y - 1], [x, y + 1]] : [[x - 1, y], [x + 1, y]];
      let keptDark = 0;
      let ok = true;
      for (const [nx, ny] of neigh) {
        if (!op(nx, ny) || drop.has(key(nx, ny))) continue;
        if (dark(nx, ny)) keptDark++;
        else { ok = false; break; }
      }
      if (!ok || keptDark >= 2) { drop.delete(k); changed = true; break; }
    }
  }
  const data = image.data;
  for (const k of drop) {
    const x = Math.floor(k / h), y = k - x * h;
    data.fill(0, (y * w + x) * 4, (y * w + x) * 4 + 4);
  }
  let applied = drop.size;
  for (const [k, from] of moves) {
    if (drop.has(k)) continue;
    const x = Math.floor(k / h), y = k - x * h;
    const d = (y * w + x) * 4;
    data[d] = snap[from]; data[d + 1] = snap[from + 1]; data[d + 2] = snap[from + 2]; data[d + 3] = snap[from + 3];
    applied++;
  }
  return applied;
}

// ---------------------------------------------------------------------------
// smooth: the same field, resampled continuously
// ---------------------------------------------------------------------------

/**
 * Area-resample one line: source cell i covers [edges[i], edges[i+1]) of the
 * output line, and every output pixel is the coverage-weighted sum of the
 * cells over it. A cell that lands exactly on a pixel copies it; a stretched
 * or squeezed one spreads over its neighbours with an anti-aliased end.
 * `src`/`dst` are premultiplied RGBA floats; `stride` steps between cells.
 */
function resampleLine(src, srcOffset, stride, count, edges, dst, dstOffset, dstCount) {
  for (let i = 0; i < count; i++) {
    const s = srcOffset + i * stride;
    if (src[s + 3] === 0) continue;
    const a = edges[i], b = edges[i + 1];
    let p = Math.floor(a);
    while (p < b) {
      const overlap = Math.min(b, p + 1) - Math.max(a, p);
      if (overlap > 0 && p >= 0 && p < dstCount) {
        const d = dstOffset + p * stride;
        dst[d] += src[s] * overlap;
        dst[d + 1] += src[s + 1] * overlap;
        dst[d + 2] += src[s + 2] * overlap;
        dst[d + 3] += src[s + 3] * overlap;
      } else if (overlap > 0) {
        throw new BreatheError("internal: smooth warp left the working canvas");
      }
      p++;
    }
  }
}

/**
 * One phase, continuously: each row is first stretched horizontally about
 * the body axis (the axis column's centre is the fixed point; columns
 * outside the solid box are carried with its edges, never stretched), then every
 * column is resampled vertically. The vertical change is scaled so the head
 * moves by a whole number of pixels (`headOffset`); rows with zero strain
 * keep integer edges and are therefore copied, not interpolated. The soles'
 * row and everything below it is never moved.
 */
export function warpSmooth(image, anat, { depth, lag, phase }) {
  const { box } = anat;
  const W = image.width, H = image.height;
  const field = envelope(anat);
  const pOf = protect(anat);
  const gain = gainAt(anat, field, depth, lag, phase);

  // Premultiplied float copy of the canvas.
  const pre = new Float64Array(W * H * 4);
  for (let k = 0; k < W * H; k++) {
    const a = image.data[k * 4 + 3];
    if (!a) continue;
    pre[k * 4] = (image.data[k * 4] * a) / 255;
    pre[k * 4 + 1] = (image.data[k * 4 + 1] * a) / 255;
    pre[k * 4 + 2] = (image.data[k * 4 + 2] * a) / 255;
    pre[k * 4 + 3] = a;
  }

  // Horizontal pass, row by row, in place into `mid`.
  const gains = new Float64Array(H);
  for (let y = 0; y < H; y++) gains[y] = gain(rowU(anat, y - box.y0));
  const mid = new Float64Array(W * H * 4);
  const edges = new Float64Array(W + 1);
  const axisCentre = box.x0 + anat.axisX + 0.5;
  let deformed = false;
  for (let y = 0; y < H; y++) {
    const g = gains[y];
    if (g === 0) {
      mid.set(pre.subarray(y * W * 4, (y + 1) * W * 4), y * W * 4);
      continue;
    }
    deformed = true;
    // Only the body is stretched. Columns outside the solid box — a faint
    // speck, a stray anti-aliased pixel — ride with the box's edge: stretched
    // about the axis, a speck 600 px out moved by 600·g and left the working
    // canvas (R2-3); at depth 0.05 one drifted 27 px frame to frame.
    const dens = (x) => (x < box.x0 || x >= box.x1 ? 1 : Math.max(0.05, 1 + g * (1 - pOf(x - box.x0))));
    const axisCol = box.x0 + anat.axisX;
    edges[axisCol] = axisCentre - dens(axisCol) / 2;
    edges[axisCol + 1] = axisCentre + dens(axisCol) / 2;
    for (let x = axisCol + 1; x < W; x++) edges[x + 1] = edges[x] + dens(x);
    for (let x = axisCol - 1; x >= 0; x--) edges[x] = edges[x + 1] - dens(x);
    resampleLine(pre, y * W * 4, 4, W, edges, mid, y * W * 4, W);
  }

  // Vertical pass. Row densities, then the whole-pixel head offset.
  const dens = new Float64Array(H);
  let delta = 0;
  for (let y = 0; y < H; y++) {
    const g = gains[y];
    dens[y] = g === 0 ? 1 : 1 / (1 + g);
    delta += dens[y] - 1;
  }
  const lift = Math.round(delta);
  const scale = Math.abs(delta) > 1e-12 ? lift / delta : 0;
  let first = -1, last = -1;
  for (let y = 0; y < H; y++) {
    if (dens[y] === 1) continue;
    dens[y] = 1 + (dens[y] - 1) * scale;
    if (first < 0) first = y;
    last = y;
  }
  const yEdges = new Float64Array(H + 1);
  for (let y = 0; y <= H; y++) yEdges[y] = y;
  if (first >= 0 && lift !== 0) {
    deformed = true;
    for (let y = 0; y <= first; y++) yEdges[y] = y - lift;
    for (let y = first; y <= last; y++) yEdges[y + 1] = yEdges[y] + dens[y];
    // The running sum lands on last + 1 up to rounding; pin it so the soles
    // are exactly where they were.
    yEdges[last + 1] = last + 1;
  }
  const outF = new Float64Array(W * H * 4);
  for (let x = 0; x < W; x++) resampleLine(mid, x * 4, W * 4, H, yEdges, outF, x * 4, H);

  const out = blank(W, H);
  for (let k = 0; k < W * H; k++) {
    const A = outF[k * 4 + 3];
    const a = Math.min(255, Math.round(A));
    if (a <= 0) continue;
    const f = 255 / A;
    out.data[k * 4] = Math.min(255, Math.max(0, Math.round(outF[k * 4] * f)));
    out.data[k * 4 + 1] = Math.min(255, Math.max(0, Math.round(outF[k * 4 + 1] * f)));
    out.data[k * 4 + 2] = Math.min(255, Math.max(0, Math.round(outF[k * 4 + 2] * f)));
    out.data[k * 4 + 3] = a;
  }
  return { image: out, clipped: 0, deformed, headOffset: -lift };
}

// ---------------------------------------------------------------------------
// The bake
// ---------------------------------------------------------------------------

function padImage(image, margin) {
  const W = image.width + 2 * margin, H = image.height + 2 * margin;
  const out = blank(W, H);
  for (let y = 0; y < image.height; y++) {
    out.data.set(image.data.subarray(y * image.width * 4, (y + 1) * image.width * 4), ((y + margin) * W + margin) * 4);
  }
  return out;
}

function cropImage(image, x0, y0, w, h) {
  const out = blank(w, h);
  for (let y = 0; y < h; y++) {
    out.data.set(image.data.subarray(((y0 + y) * image.width + x0) * 4, ((y0 + y) * image.width + x0 + w) * 4), y * w * 4);
  }
  return out;
}

/** Bounding box of every pixel with any alpha, end-exclusive, or null. */
function inkBox(image) {
  return solidBox(image, 1);
}

/** Visible pixels that differ between two same-size regions (alpha 0 is
 *  alpha 0 whatever colour it carries). */
function regionDiff(a, ax, ay, b, bx, by, w, h) {
  let diff = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inA = ax + x >= 0 && ax + x < a.width && ay + y >= 0 && ay + y < a.height;
      const inB = bx + x >= 0 && bx + x < b.width && by + y >= 0 && by + y < b.height;
      const pa = inA ? ((ay + y) * a.width + ax + x) * 4 : -1;
      const pb = inB ? ((by + y) * b.width + bx + x) * 4 : -1;
      const alphaA = pa < 0 ? 0 : a.data[pa + 3];
      const alphaB = pb < 0 ? 0 : b.data[pb + 3];
      if (alphaA === 0 && alphaB === 0) continue;
      if (alphaA !== alphaB || a.data[pa] !== b.data[pb] || a.data[pa + 1] !== b.data[pb + 1] || a.data[pa + 2] !== b.data[pb + 2]) diff++;
    }
  }
  return diff;
}

/**
 * Something beside the body that crosses the rigid row: above the row it
 * rides with the head, below it is pushed and stretched with the body, so a
 * held or floating prop there shears (measured on the Lumi idle still at
 * depth 0.02: the lantern's lower half swings ±1.2 px against its top).
 * Returns the columns it occupies at the row and how far down it reaches
 * (image coordinates), or null. Only for a DETECTED appendage: with a
 * manual torso band everything outside the band is pushed by request, and
 * the body's own edge would be flagged.
 */
export function straddlingProp(image, anat) {
  if (anat.torsoSource === "manual" || !hasAppendage(anat)) return null;
  const p = protect(anat);
  const { box } = anat;
  const w = anat.width;
  const beside = (i) => p(i) >= 0.5;
  const y = box.y0 + anat.rigidRow;
  const seeds = [];
  for (let i = 0; i < w; i++) {
    if (beside(i) && solidAt(image, box.x0 + i, y - 1) && solidAt(image, box.x0 + i, y)) seeds.push(i);
  }
  if (!seeds.length) return null;
  // How far the crossing object reaches down, following solid pixels in any
  // column the ramp touches at all (past 1.15 torso half-widths), so the flood
  // never walks into the torso.
  const reach = (i) => p(i) > 0;
  const seen = new Uint8Array(w * anat.height);
  const stack = seeds.map((i) => [i, anat.rigidRow]);
  for (const [i, j] of stack) seen[j * w + i] = 1;
  let bottom = anat.rigidRow;
  while (stack.length) {
    const [i, j] = stack.pop();
    if (j > bottom) bottom = j;
    for (const [ni, nj] of [[i - 1, j], [i + 1, j], [i, j + 1]]) {
      if (ni < 0 || ni >= w || nj >= anat.height || seen[nj * w + ni]) continue;
      if (!reach(ni) || !solidAt(image, box.x0 + ni, box.y0 + nj)) continue;
      seen[nj * w + ni] = 1;
      stack.push([ni, nj]);
    }
  }
  return { x0: box.x0 + seeds[0], x1: box.x0 + seeds[seeds.length - 1], y, bottom: box.y0 + bottom };
}

/** Share of the visible pixels that are partly transparent: ~0 for pixel
 *  art, several percent for anti-aliased art. */
export function partialAlphaShare(image) {
  let visible = 0, partial = 0;
  for (let k = 3; k < image.data.length; k += 4) {
    const a = image.data[k];
    if (!a) continue;
    visible++;
    if (a < 255) partial++;
  }
  return visible ? partial / visible : 0;
}

/** Partly transparent share above which a still is anti-aliased art. */
export const ANTIALIASED_SHARE = 0.02;

/**
 * Bake `frames` breathing frames from one still.
 *
 * Overrides are in the still's pixel coordinates: `rigidY` (the first row
 * that deforms is below it), `axisX` (the body axis column), `torsoHalf`
 * (px). The canvas is the still's, grown only as far as the stretch needs;
 * `canvas.grew` says by how much on each side.
 */
export function bakeBreathe(image, {
  frames, breaths = 1, depth, lag = DEFAULT_LAG, mode, rigidY = null, axisX = null, torsoHalf = null,
}) {
  if (!BREATHE_MODES.includes(mode)) throw new BreatheError(`mode must be one of ${BREATHE_MODES.join(", ")}, got '${mode}'`);
  if (!Number.isInteger(breaths) || breaths < 1) throw new BreatheError(`breaths must be an integer >= 1, got ${breaths}`);
  if (!Number.isInteger(frames) || frames < 2 * breaths) throw new BreatheError(`frames must be an integer >= 2 per breath (${2 * breaths}), got ${frames}`);
  if (!(depth >= DEPTH_MIN && depth <= DEPTH_MAX)) throw new BreatheError(`depth must be within ${DEPTH_MIN}..${DEPTH_MAX}, got ${depth}`);
  if (!(lag >= 0 && lag <= LAG_MAX)) throw new BreatheError(`lag must be within 0..${LAG_MAX}, got ${lag}`);

  const box = solidBox(image);
  if (!box) throw new BreatheError(`the still has no solid content (alpha >= ${ALPHA_SOLID})`);
  const overrides = {};
  if (rigidY !== null) {
    if (!Number.isInteger(rigidY) || rigidY <= box.y0 || rigidY >= box.y1) throw new BreatheError(`--rigid-row ${rigidY} must be a row inside the character, ${box.y0 + 1}..${box.y1 - 1}`);
    overrides.rigidRow = rigidY - box.y0;
  }
  if (axisX !== null) {
    if (!Number.isInteger(axisX) || axisX < box.x0 || axisX >= box.x1) throw new BreatheError(`--axis ${axisX} must be a column inside the character, ${box.x0}..${box.x1 - 1}`);
    overrides.axisX = axisX - box.x0;
  }
  if (torsoHalf !== null) overrides.torsoHalf = torsoHalf;
  const anat = analyzeAnatomy(image, overrides);

  const strain = rowStrain(anat, depth);
  if (strain > MAX_ROW_STRAIN) {
    throw new BreatheError(`depth ${depth} strains one row by ${strain.toFixed(3)}, over the ${MAX_ROW_STRAIN} cap — the deformable band is too short (rigid row ${box.y0 + anat.rigidRow} of ${box.y0}..${box.y1}). Lower --depth or move --rigid-row up.`);
  }

  // Room for the stretch: no row grows past 1/(1 − cap), no row widens past
  // 1 + cap, so a third of the content size on every side cannot be left.
  const margin = Math.ceil(0.34 * Math.max(anat.width, anat.height)) + 2;
  const padded = padImage(image, margin);
  const pAnat = { ...anat, box: { x0: box.x0 + margin, y0: box.y0 + margin, x1: box.x1 + margin, y1: box.y1 + margin } };
  const phases = breathePhases(frames, breaths);
  const warp = mode === "pixel" ? warpPixel : warpSmooth;
  const warped = phases.map((phase) => warp(padded, pAnat, { depth, lag, phase }));
  const clipped = warped.reduce((n, w) => n + w.clipped, 0);
  if (clipped) throw new BreatheError(`internal: ${clipped} pixels left the padded canvas`);

  // Crop to the still's canvas, grown to whatever the frames reach.
  let ux0 = margin, uy0 = margin, ux1 = margin + image.width, uy1 = margin + image.height;
  for (const { image: frame } of warped) {
    const ink = inkBox(frame);
    if (!ink) continue;
    ux0 = Math.min(ux0, ink.x0); uy0 = Math.min(uy0, ink.y0);
    ux1 = Math.max(ux1, ink.x1); uy1 = Math.max(uy1, ink.y1);
  }
  const grew = { left: margin - ux0, top: margin - uy0, right: ux1 - margin - image.width, bottom: uy1 - margin - image.height };
  const cw = ux1 - ux0, ch = uy1 - uy0;
  const out = warped.map(({ image: frame }) => cropImage(frame, ux0, uy0, cw, ch));

  // Per-frame facts, in the output canvas: the solid height, where the head
  // went, and whether the head block really is the still's head moved.
  const head = rigidRows(anat);
  const shift = { x: grew.left, y: grew.top };
  const perFrame = out.map((frame, i) => {
    const b = solidBox(frame);
    const offset = warped[i].headOffset;
    const headDiff = head > 0
      ? regionDiff(frame, box.x0 + shift.x, box.y0 + shift.y + offset, image, box.x0, box.y0, anat.width, head)
      : null;
    return {
      index: i,
      phase: phases[i],
      height: b ? b.y1 - b.y0 : 0,
      top: b ? b.y0 : null,
      bottom: b ? b.y1 : null,
      headOffset: offset,
      headDiffPx: headDiff,
    };
  });

  const warnings = imageWarnings(anat);
  if (Math.floor(frames / breaths) < SMOOTH_CYCLE_FRAMES) {
    warnings.push(`${frames} frames for ${breaths} breath${breaths > 1 ? "s" : ""} is under ${SMOOTH_CYCLE_FRAMES} a breath — it reads as a twitch, not breathing`);
  }
  const partial = partialAlphaShare(image);
  let fringeDropped = 0;
  if (mode === "pixel") {
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const a = image.data[(y * image.width + x) * 4 + 3];
        if (a && (x < box.x0 || x >= box.x1 || y < box.y0 || y >= box.y1)) fringeDropped++;
      }
    }
    if (partial > ANTIALIASED_SHARE) {
      warnings.push(`the still is anti-aliased (${(100 * partial).toFixed(1)}% of its visible pixels are partly transparent): pixel mode duplicates whole rows, thins dark outlines and drops ${fringeDropped} edge pixels outside the solid box — --mode smooth is made for this art`);
    }
  }
  const prop = straddlingProp(image, anat);
  if (prop) {
    warnings.push(`something beside the body (x ${prop.x0}..${prop.x1}) crosses the rigid row y=${prop.y}: above it rides with the head, below it is pushed and stretched with the body, so a prop there shears — if it is one object, --rigid-row ${prop.bottom + 1} keeps it whole (it reaches down to y=${prop.bottom})`);
  }
  const bottoms = new Set(perFrame.map((f) => f.bottom));
  if (bottoms.size > 1) warnings.push(`internal: the soles moved (${[...bottoms].join(", ")})`);
  // A breath is mostly the head rising and falling. On a small still at a low
  // depth the whole lift rounds to under half a pixel, and the frames only
  // widen and narrow — a breath nobody sees as one. Said, with the numbers.
  const heights = new Set(perFrame.map((f) => f.height));
  if (perFrame.every((f) => f.headOffset === 0) && heights.size === 1) {
    // The bake scales the total stretch to depth × (height − basis row).
    const rows = basisRows(anat);
    warnings.push(`the head never moves: at depth ${depth} this ${anat.height} px tall character lifts by ${(depth * rows).toFixed(2)} px at most, which rounds to 0 — the frames only widen and narrow. Raise --depth (the head starts to move at about ${Math.min(DEPTH_MAX, 0.5 / rows).toFixed(3)}) or breathe a larger still`);
  }

  return {
    frames: out,
    canvas: { width: cw, height: ch, grew },
    anatomy: anat,
    rigidRows: head,
    phases,
    strain,
    perFrame,
    partialAlphaShare: partial,
    fringeDropped,
    straddle: prop,
    warnings,
  };
}

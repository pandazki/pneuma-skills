/**
 * sheet-segment.mjs — find the poses on a generated sheet by where the ink
 * is, not by where the grid says it should be.
 *
 * `slice` cuts an R x C sheet at multiples of its cell size. An image model
 * asked for a grid does not always draw one: a GPT Image 4x4 attack sheet
 * (2048 px, 512 px cells) had its blank bands between rows at y = 547, 1031
 * and 1533, so the first row's boots crossed y = 512 and eight cells came
 * out clipped. This module locates each pose from the alpha itself — the
 * blank bands between rows, then between the poses of each row — and gives
 * every pose all of its own ink and none of its neighbours'.
 *
 * Ported from aldegad/sprite-gen (Apache-2.0)
 * sprite_gen/frames/segment.py@fbd1a08: the alpha projection profile, its box
 * smoothing, content runs, the minor-run drop, prominence peaks, the DP
 * optimal n-cut (`Σ P[cut] + λ·(width − ideal)²`), the strip segmentation
 * with its forced recovery, and the gutter-centre boundaries, with the same
 * constants. Upstream itself ported that code from gykim80/perfectpixel-studio
 * internal/sprite/segment.go (MIT License, Copyright Andrew Kim (gykim80)).
 * Changes: applied twice — to rows over the whole sheet, then to columns
 * inside each row band — instead of to one strip; the profile sums the alpha
 * of pixels at or above the alpha threshold (the one every other measure in
 * sprite-sheet.mjs uses), not of every non-zero pixel; a segmentation that
 * cannot produce the expected count returns null with the natural count
 * rather than printing and leaving the strip untouched; a one-peak run wider
 * than 1.45 median runs is read as two poses only when the plain reading
 * falls short of the expected count (a lunge with a sword out is that wide).
 *
 * Inspired by aldegad/sprite-gen sprite_gen/frames/slice_sheet.py@fbd1a08:
 * whole-sheet connected components assigned to a cell by centroid, a
 * component spanning more than 1.5 cells split at the cell borders and
 * re-labelled inside each cell, small border-touching fragments dropped as a
 * neighbour's debris. Changes: the cells are the ones the projection found,
 * not the nominal grid's; a component is also split when a quarter of it
 * lies in another cell (two poses drawn touching); nothing is rescaled — each
 * pose keeps the position it was drawn at relative to the grid cell it was
 * asked to fill, and the output cell grows to hold whatever crosses the grid
 * lines.
 *
 * Pure and zero-dependency (no ffmpeg): `sprite-sheet.mjs slice --auto` and
 * `run` decode the sheet, call `locatePoses` + `layoutPoses` + `cutPoses`,
 * and write the cells.
 */

/** Components spanning more than this many cells on either axis are two or
 *  more poses fused through touching props: split at the cell lines
 *  (upstream `MERGED_SPAN_FACTOR`). */
export const MERGED_SPAN_FACTOR = 1.5;
/** A component with at least this share of its ink in a cell other than its
 *  centroid's is shared between two poses, and is split at the cell lines
 *  too. A pose's own overflow — boots across a grid line, a sword tip — is a
 *  small part of its figure; two poses drawn touching split about evenly. */
export const SHARED_FRACTION = 0.25;
/** A fragment of a split component smaller than this share of its cell's
 *  main figure, touching a cell line, is the neighbour's overhang and is
 *  dropped (upstream `DEFAULT_DEBRIS_FRACTION`). */
export const DEBRIS_FRACTION = 0.3;
/** Empty pixels kept between a pose and the edge of its output cell where the
 *  pose reaches the nominal grid line, so a whole pose never reads as a
 *  clipped one. */
export const CELL_MARGIN = 4;
/** How far (px, 8-neighbour steps) an edge pixel under the alpha threshold
 *  follows the pose whose solid ink it touches, instead of its cell. */
const FRINGE_REACH = 2;

/**
 * Connected components of the alpha mask at `threshold`, 4-connectivity, one
 * iterative pass (a recursive fill blows the stack on a large silhouette).
 * 4-connectivity on purpose: 8-connectivity welds a fragment to a body
 * through one diagonally touching pixel. `labels[p]` is the component id or
 * -1; each component carries its area, bbox and pixel-centre sums.
 */
export function alphaComponents(image, threshold) {
  const { width, height, data } = image;
  const count = width * height;
  const labels = new Int32Array(count).fill(-1);
  const stack = new Int32Array(count);
  const components = [];

  for (let seed = 0; seed < count; seed++) {
    if (labels[seed] !== -1 || data[seed * 4 + 3] < threshold) continue;
    const id = components.length;
    let top = 0;
    stack[top++] = seed;
    labels[seed] = id;
    let area = 0, x0 = width, y0 = height, x1 = -1, y1 = -1, sumX = 0, sumY = 0;
    while (top > 0) {
      const p = stack[--top];
      const x = p % width;
      const y = (p - x) / width;
      area++;
      sumX += x;
      sumY += y;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      const push = (q) => {
        if (labels[q] !== -1 || data[q * 4 + 3] < threshold) return;
        labels[q] = id;
        stack[top++] = q;
      };
      if (x > 0) push(p - 1);
      if (x < width - 1) push(p + 1);
      if (y > 0) push(p - width);
      if (y < height - 1) push(p + width);
    }
    components.push({ id, area, sumX, sumY, bbox: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } });
  }
  return { labels, components };
}

// ---------------------------------------------------------------------------
// The projection segmentation (ported, see the header)
// ---------------------------------------------------------------------------

/**
 * Alpha mass along one axis of a rectangle: `axis "x"` sums each column of
 * rows y0..y1-1, `axis "y"` each row of columns x0..x1-1. Pixels under the
 * threshold add nothing.
 */
export function projectAlpha(image, axis, { x0 = 0, x1 = image.width, y0 = 0, y1 = image.height } = {}, threshold = 1) {
  const { width, data } = image;
  const profile = new Float64Array(axis === "x" ? x1 - x0 : y1 - y0);
  for (let y = y0; y < y1; y++) {
    const row = y * width;
    for (let x = x0; x < x1; x++) {
      const a = data[(row + x) * 4 + 3];
      if (a < threshold) continue;
      profile[axis === "x" ? x - x0 : y - y0] += a;
    }
  }
  return profile;
}

/** Box moving average (compression noise, hairline gaps). */
export function smoothProfile(profile, window) {
  if (window < 1 || !profile.length) return Float64Array.from(profile);
  const length = profile.length;
  const half = Math.floor(window / 2);
  const prefix = new Float64Array(length + 1);
  for (let i = 0; i < length; i++) prefix[i + 1] = prefix[i] + profile[i];
  const output = new Float64Array(length);
  for (let i = 0; i < length; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(length - 1, i + half);
    output[i] = (prefix[hi + 1] - prefix[lo]) / (hi - lo + 1);
  }
  return output;
}

/** Runs [start, end) where the profile exceeds eps; narrow or low runs are litter. */
export function contentRuns(profile, eps, peakMin, minWidth) {
  const runs = [];
  let i = 0;
  const length = profile.length;
  while (i < length) {
    if (profile[i] <= eps) { i++; continue; }
    let j = i;
    let peak = 0;
    while (j < length && profile[j] > eps) {
      if (profile[j] > peak) peak = profile[j];
      j++;
    }
    if (j - i >= minWidth && peak >= peakMin) runs.push([i, j]);
    i = j;
  }
  return runs;
}

export function runMass(profile, [start, end]) {
  let sum = 0;
  for (let i = start; i < Math.min(end, profile.length); i++) sum += profile[i];
  return sum;
}

/** Drop runs under `fraction` of the heaviest run's mass (far residue, specks). */
export function dropMinorRuns(profile, runs, fraction) {
  if (runs.length <= 1) return runs;
  const masses = runs.map((run) => runMass(profile, run));
  const threshold = Math.max(...masses) * fraction;
  return runs.filter((_, i) => masses[i] >= threshold);
}

/** The runs' median width — upstream's `widths[len // 2]`, the upper median. */
export function medianRunWidth(runs) {
  if (!runs.length) return 0;
  const widths = runs.map(([s, e]) => e - s).sort((a, b) => a - b);
  return widths[Math.floor(widths.length / 2)];
}

/**
 * Strong peaks (= poses) in [start, end): local maxima of at least 45 % of the
 * run's maximum whose valley toward every higher peak drops below 62 % of
 * their own height.
 */
export function posePeaks(profile, start, end) {
  if (end - start < 3) return [Math.floor((start + end) / 2)];
  let runMax = 0;
  for (let x = start; x < end; x++) if (profile[x] > runMax) runMax = profile[x];
  if (runMax <= 0) return [Math.floor((start + end) / 2)];
  const candidates = [];
  for (let x = start + 1; x < end - 1; x++) {
    if (profile[x] >= profile[x - 1] && profile[x] > profile[x + 1] && profile[x] >= 0.45 * runMax) candidates.push(x);
  }
  if (!candidates.length) return [Math.floor((start + end) / 2)];
  const keep = [];
  for (const peak of candidates) {
    let prominent = true;
    for (const other of candidates) {
      if (other === peak || profile[other] < profile[peak]) continue;
      const [lo, hi] = peak < other ? [peak, other] : [other, peak];
      let valley = Infinity;
      for (let x = lo; x <= hi; x++) if (profile[x] < valley) valley = profile[x];
      if (valley > 0.62 * profile[peak]) { prominent = false; break; }
    }
    if (prominent) keep.push(peak);
  }
  return keep.length ? keep : [candidates[0]];
}

/**
 * The count-1 cut positions that divide [x0, x1) into exactly `count`
 * segments at the least ink, each near the ideal width: cost
 * `Σ P[cut] + 0.0015·(width − ideal)²`, every segment at least 45 % of the
 * ideal. Null when the range cannot hold that many.
 */
export function dpNCut(profile, x0, x1, count) {
  if (count <= 1 || x1 - x0 < count) return null;
  const width = x1 - x0;
  const ideal = width / count;
  const minWidth = Math.max(2, Math.floor(ideal * 0.45));
  const lam = 0.0015;
  const INF = 1e18;
  const cuts = count - 1;
  const cost = Array.from({ length: cuts + 1 }, () => new Float64Array(x1 + 1).fill(INF));
  const previous = Array.from({ length: cuts + 1 }, () => new Int32Array(x1 + 1).fill(-1));
  cost[0][x0] = 0;
  for (let k = 1; k <= cuts; k++) {
    const lo = x0 + (k - 1) * minWidth;
    const prior = cost[k - 1];
    const row = cost[k];
    const back = previous[k];
    for (let x = x0 + k * minWidth; x <= x1 - (cuts - k + 1) * minWidth; x++) {
      let best = INF;
      let bestPrevious = -1;
      const mass = profile[x];
      for (let xp = lo; xp <= x - minWidth; xp++) {
        const base = prior[xp];
        if (base >= 1e17) continue;
        const deviation = (x - xp) - ideal;
        const candidate = base + mass + lam * deviation * deviation;
        if (candidate < best) { best = candidate; bestPrevious = xp; }
      }
      row[x] = best;
      back[x] = bestPrevious;
    }
  }
  let bestEnd = -1;
  let bestCost = INF;
  for (let x = x0 + cuts * minWidth; x <= x1 - minWidth; x++) {
    const deviation = (x1 - x) - ideal;
    const candidate = cost[cuts][x] + lam * deviation * deviation;
    if (candidate < bestCost) { bestCost = candidate; bestEnd = x; }
  }
  if (bestEnd < 0) return null;
  const output = new Array(cuts);
  let x = bestEnd;
  for (let k = cuts; k >= 1; k--) {
    output[k - 1] = x;
    x = previous[k][x];
    if (x < 0) return null;
  }
  return output;
}

/** [start, end) into `count` segments at the DP cuts (even thirds if it fails). */
export function splitRange(profile, start, end, count) {
  if (count <= 1 || end - start < count) return [[start, end]];
  const cuts = dpNCut(profile, start, end, count);
  if (cuts && cuts.length === count - 1) {
    const spans = [];
    let anchor = start;
    for (const cut of cuts) { spans.push([anchor, cut]); anchor = cut; }
    spans.push([anchor, end]);
    return spans;
  }
  return Array.from({ length: count }, (_, i) => [
    start + Math.floor(((end - start) * i) / count),
    start + Math.floor(((end - start) * (i + 1)) / count),
  ]);
}

/**
 * Segment one raw profile into `expected` segments: `{ segments, natural,
 * forced }`. `natural` is how many poses the blank bands and peaks say there
 * are; when that is not `expected`, the whole range is cut into `expected` by
 * the DP (`forced: true`) — upstream's defence against poses drawn touching.
 */
export function segmentProfile(raw, expected) {
  const width = raw.length;
  if (width === 0 || expected < 1) return { segments: [], natural: 0, forced: false };
  const profile = smoothProfile(raw, Math.max(3, Math.floor(width / 220)));
  let peakMax = 0;
  for (const v of profile) if (v > peakMax) peakMax = v;
  if (peakMax <= 0) return { segments: [], natural: 0, forced: false, profile };
  const eps = 0.045 * peakMax;
  const peakMin = 0.18 * peakMax;
  const minRun = Math.max(4, Math.floor(width / 100));
  const runs = dropMinorRuns(profile, contentRuns(profile, eps, peakMin, minRun), 0.2);
  if (!runs.length) return { segments: [], natural: 0, forced: false, profile };

  // Peaks say WHERE to cut a run, its width says HOW MANY poses it holds: a
  // kick's torso and leg make two peaks in one pose-wide run.
  const med = medianRunWidth(runs);
  const widthTotal = runs.reduce((sum, [s, e]) => sum + (e - s), 0);
  const build = (doubleWide) => {
    const out = [];
    for (const [start, end] of runs) {
      let peakCount = posePeaks(profile, start, end).length;
      if (runs.length > 1 && med > 0) {
        const maxByWidth = Math.max(1, Math.floor((end - start) / med + 0.5));
        if (peakCount > maxByWidth) peakCount = maxByWidth;
        if (doubleWide && peakCount === 1 && end - start > med * 1.45) peakCount = 2;
      }
      if (peakCount <= 1) out.push([start, end]);
      else out.push(...splitRange(profile, start, end, peakCount));
    }
    return out;
  };
  // Upstream reads a one-peak run over 1.45 median widths as two poses drawn
  // touching. On a grid row the count is known, and a lunge with its sword
  // out is that wide on its own (the Kagari attack sheet: 374 px against a
  // 257 px median), so the doubling is only tried when the plain reading
  // falls short of the count.
  let segments = build(false);
  if (segments.length !== expected) segments = build(true);
  const natural = segments.length;
  let forced = false;
  if (natural !== expected && widthTotal / expected >= 16 && Math.floor(width / expected) >= 16) {
    segments = splitRange(profile, 0, width, expected);
    forced = true;
  }
  return { segments, natural, forced, profile };
}

/**
 * The `expected - 1` cut positions that tile the whole range — the centre of
 * each gap between segments, or the DP cut where two segments share an edge —
 * or `cuts: null` when the segmentation did not produce `expected` segments.
 */
export function segmentBoundaries(raw, expected) {
  const { segments, natural, forced } = segmentProfile(raw, expected);
  if (segments.length !== expected) return { cuts: null, natural, forced, segments };
  const cuts = [];
  for (let i = 1; i < segments.length; i++) cuts.push(Math.floor((segments[i - 1][1] + segments[i][0]) / 2));
  const bad = cuts.some((cut, i) => cut <= 0 || cut >= raw.length || (i > 0 && cut <= cuts[i - 1]));
  return bad ? { cuts: null, natural, forced, segments } : { cuts, natural, forced, segments };
}

// ---------------------------------------------------------------------------
// Poses on a grid sheet
// ---------------------------------------------------------------------------

/** Index of the span [edges[i], edges[i+1]) holding v. */
function spanOf(edges, v) {
  let i = 0;
  while (i < edges.length - 2 && v >= edges[i + 1]) i++;
  return i;
}

/**
 * Locate the rows x cols poses of a sheet.
 *
 * Rows first, on the sheet's row profile; then, inside each row's band, the
 * poses of that row on its column profile. The cuts tile the sheet into one
 * region per pose. Every connected component of ink goes, whole, to the
 * region its centroid is in — so boots that cross a grid line stay with
 * their body — unless it spans more than MERGED_SPAN_FACTOR nominal cells or
 * has SHARED_FRACTION of itself in another region: then it is two poses
 * drawn touching, and it is split at the region lines, each piece
 * re-labelled inside its region and a small piece touching the line dropped
 * as the neighbour's overhang. Ink under the alpha threshold follows the
 * pose whose solid ink it touches (up to FRINGE_REACH px), else its region.
 *
 * Returns null fields and `failed` when the rows or a row's poses cannot be
 * found as asked; otherwise `owner` (pose index per pixel, -1 = nobody),
 * the cut lines, per-pose boxes and flags, and the counts it found on its
 * own (`natural`) with whether it had to force them.
 */
export function locatePoses(image, { rows, cols, threshold, cell }) {
  const { width, height, data } = image;
  const rowCut = segmentBoundaries(projectAlpha(image, "y", {}, threshold), rows);
  const result = {
    rows: { natural: rowCut.natural, forced: rowCut.forced, cuts: rowCut.cuts },
    cols: [],
    failed: null,
  };
  if (rows > 1 && !rowCut.cuts) {
    result.failed = `found ${rowCut.natural} row(s) of poses where ${rows} were asked, and could not cut ${rows} out of the ink`;
    return result;
  }
  const rowEdges = [0, ...(rows > 1 ? rowCut.cuts : []), height];
  const colEdges = [];
  for (let r = 0; r < rows; r++) {
    const band = { y0: rowEdges[r], y1: rowEdges[r + 1] };
    const colCut = segmentBoundaries(projectAlpha(image, "x", band, threshold), cols);
    result.cols.push({ natural: colCut.natural, forced: colCut.forced, cuts: colCut.cuts });
    if (cols > 1 && !colCut.cuts) {
      result.failed = `row ${r}: found ${colCut.natural} pose(s) where ${cols} were asked, and could not cut ${cols} out of the ink`;
      return result;
    }
    colEdges.push([0, ...(cols > 1 ? colCut.cuts : []), width]);
  }
  if (rows === 1) result.rows.cuts = [];
  const regionOf = (x, y) => {
    const r = spanOf(rowEdges, y);
    return r * cols + spanOf(colEdges[r], x);
  };
  const regionBox = (index) => {
    const r = Math.floor(index / cols);
    const c = index % cols;
    return { x0: colEdges[r][c], x1: colEdges[r][c + 1], y0: rowEdges[r], y1: rowEdges[r + 1] };
  };

  const { labels, components } = alphaComponents(image, threshold);
  const count = width * height;
  const owner = new Int32Array(count).fill(-1);
  const poses = Array.from({ length: rows * cols }, (_, index) => ({ index, row: Math.floor(index / cols), col: index % cols, cut: false }));

  // Which region each pixel of a component lies in, tallied per component.
  const shares = components.map(() => new Map());
  for (let p = 0; p < count; p++) {
    const id = labels[p];
    if (id < 0) continue;
    const x = p % width;
    const region = regionOf(x, (p - x) / width);
    const tally = shares[id];
    tally.set(region, (tally.get(region) ?? 0) + 1);
  }
  const split = new Set();
  const home = new Int32Array(components.length);
  for (const c of components) {
    home[c.id] = regionOf(c.sumX / c.area, c.sumY / c.area);
    const spansCells = c.bbox.w > cell.width * MERGED_SPAN_FACTOR || c.bbox.h > cell.height * MERGED_SPAN_FACTOR;
    let outside = 0;
    for (const [region, n] of shares[c.id]) if (region !== home[c.id]) outside = Math.max(outside, n);
    if (spansCells || outside >= SHARED_FRACTION * c.area) split.add(c.id);
  }

  // Whole components go home; split ones are handed out piece by piece below.
  for (let p = 0; p < count; p++) {
    const id = labels[p];
    if (id >= 0 && !split.has(id)) owner[p] = home[id];
  }
  if (split.size) {
    // Re-label the split components' pixels inside each region: a piece is
    // one 4-connected run of a split component's pixels within one region.
    const pieceOf = new Int32Array(count).fill(-1);
    const pieces = [];
    const stack = new Int32Array(count);
    for (let seed = 0; seed < count; seed++) {
      if (pieceOf[seed] !== -1 || labels[seed] < 0 || !split.has(labels[seed])) continue;
      const sx = seed % width;
      const region = regionOf(sx, (seed - sx) / width);
      const box = regionBox(region);
      const id = pieces.length;
      let top = 0;
      stack[top++] = seed;
      pieceOf[seed] = id;
      let area = 0;
      let touchesLine = false;
      while (top > 0) {
        const p = stack[--top];
        const x = p % width;
        const y = (p - x) / width;
        area++;
        // A piece reaching its region's line where another region continues
        // (not the sheet's own edge) was cut off a larger figure there.
        if ((x === box.x0 && box.x0 > 0) || (x === box.x1 - 1 && box.x1 < width)
          || (y === box.y0 && box.y0 > 0) || (y === box.y1 - 1 && box.y1 < height)) touchesLine = true;
        const push = (q, qx, qy) => {
          if (qx < box.x0 || qx >= box.x1 || qy < box.y0 || qy >= box.y1) return;
          if (pieceOf[q] !== -1 || labels[q] < 0 || !split.has(labels[q])) return;
          pieceOf[q] = id;
          stack[top++] = q;
        };
        if (x > 0) push(p - 1, x - 1, y);
        if (x < width - 1) push(p + 1, x + 1, y);
        if (y > 0) push(p - width, x, y - 1);
        if (y < height - 1) push(p + width, x, y + 1);
      }
      pieces.push({ id, region, area, touchesLine });
    }
    // The region's main figure, for the debris rule: its largest whole
    // component or piece.
    const mainArea = new Float64Array(rows * cols);
    for (const c of components) if (!split.has(c.id)) mainArea[home[c.id]] = Math.max(mainArea[home[c.id]], c.area);
    for (const piece of pieces) mainArea[piece.region] = Math.max(mainArea[piece.region], piece.area);
    const dropped = new Set();
    for (const piece of pieces) {
      if (piece.touchesLine && piece.area < DEBRIS_FRACTION * mainArea[piece.region]) dropped.add(piece.id);
      else if (piece.touchesLine) poses[piece.region].cut = true;
    }
    for (let p = 0; p < count; p++) {
      const piece = pieceOf[p];
      if (piece >= 0 && !dropped.has(piece)) owner[p] = pieces[piece].region;
    }
  }

  // Soft edge under the threshold: follows the solid ink it borders, so a
  // pose's anti-aliased rim is not left behind where it crosses a line.
  const pending = [];
  for (let p = 0; p < count; p++) if (owner[p] < 0 && labels[p] < 0 && data[p * 4 + 3] > 0) pending.push(p);
  let open = pending;
  for (let step = 0; step < FRINGE_REACH && open.length; step++) {
    const claims = [];
    const next = [];
    for (const p of open) {
      const x = p % width;
      const y = (p - x) / width;
      let found = -1;
      for (let dy = -1; dy <= 1 && found < 0; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const qx = x + dx;
          const qy = y + dy;
          if ((dx || dy) && qx >= 0 && qx < width && qy >= 0 && qy < height && owner[qy * width + qx] >= 0) {
            found = owner[qy * width + qx];
            break;
          }
        }
      }
      if (found >= 0) claims.push([p, found]);
      else next.push(p);
    }
    for (const [p, pose] of claims) owner[p] = pose;
    open = next;
  }
  // Faint pixels nowhere near a pose (keyer haze) stay with their region; a
  // dropped debris piece stays dropped, and so does the haze around it.
  for (const p of open) {
    const x = p % width;
    const y = (p - x) / width;
    let nearDropped = false;
    for (let dy = -1; dy <= 1 && !nearDropped; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const qx = x + dx;
        const qy = y + dy;
        if (qx >= 0 && qx < width && qy >= 0 && qy < height && labels[qy * width + qx] >= 0 && owner[qy * width + qx] < 0) {
          nearDropped = true;
          break;
        }
      }
    }
    if (!nearDropped) owner[p] = regionOf(x, y);
  }

  // Per-pose boxes over everything it owns, and over its solid ink.
  for (const pose of poses) {
    pose.box = null;
    pose.ink = null;
    pose.edge = false;
  }
  const grow = (box, x, y) => (box
    ? { x0: Math.min(box.x0, x), y0: Math.min(box.y0, y), x1: Math.max(box.x1, x + 1), y1: Math.max(box.y1, y + 1) }
    : { x0: x, y0: y, x1: x + 1, y1: y + 1 });
  for (let p = 0; p < count; p++) {
    const pose = owner[p];
    if (pose < 0) continue;
    const x = p % width;
    const y = (p - x) / width;
    const target = poses[pose];
    target.box = grow(target.box, x, y);
    if (data[p * 4 + 3] >= threshold) target.ink = grow(target.ink, x, y);
  }
  for (const pose of poses) {
    // Solid ink on the sheet's own edge was drawn off the image: clipped by
    // the model, not by the cut.
    const ink = pose.ink;
    pose.edge = Boolean(ink) && (ink.x0 === 0 || ink.y0 === 0 || ink.x1 === width || ink.y1 === height);
    pose.region = regionBox(pose.index);
  }
  result.rows.cuts = rows > 1 ? rowCut.cuts : [];
  result.cols = result.cols.map((c) => ({ ...c, cuts: cols > 1 ? c.cuts : [] }));
  result.owner = owner;
  result.poses = poses;
  return result;
}

/**
 * Where each located pose goes in one uniform output cell.
 *
 * A pose keeps the position it was drawn at relative to the nominal grid
 * cell it was asked to fill (row r, column c of the R x C grid the sheet was
 * requested as — `origin(r, c)`), exactly as a fixed slice would have placed
 * it; the output cell is the nominal cell grown, on each side, as far as any
 * pose reaches past it plus CELL_MARGIN. On a sheet whose poses all sit inside
 * their nominal cells nothing grows and every pose lands where `slice` put
 * it. Returns the cell size, how far it grew on each side (`grew`), and each
 * pose's offset from sheet to cell coordinates.
 */
export function layoutPoses(poses, { cell, origin, margin = CELL_MARGIN }) {
  let left = 0, top = 0, right = cell.width, bottom = cell.height;
  for (const pose of poses) {
    if (!pose.box) continue;
    const o = origin(pose.row, pose.col);
    const x0 = pose.box.x0 - o.x;
    const y0 = pose.box.y0 - o.y;
    const x1 = pose.box.x1 - o.x;
    const y1 = pose.box.y1 - o.y;
    // Grown only where a pose comes within the margin of (or past) the line.
    if (x0 < margin) left = Math.min(left, x0 - margin);
    if (y0 < margin) top = Math.min(top, y0 - margin);
    if (x1 > cell.width - margin) right = Math.max(right, x1 + margin);
    if (y1 > cell.height - margin) bottom = Math.max(bottom, y1 + margin);
  }
  const size = { width: right - left, height: bottom - top };
  const placements = poses.map((pose) => {
    const o = origin(pose.row, pose.col);
    // Sheet (x, y) lands at cell (x - o.x - left, y - o.y - top).
    return { index: pose.index, dx: 0 - o.x - left, dy: 0 - o.y - top };
  });
  // `0 - v`, not `-v`: a side that did not grow is 0, never -0.
  return { cell: size, grew: { left: 0 - left, top: 0 - top, right: right - cell.width, bottom: bottom - cell.height }, placements };
}

/** One RGBA buffer per pose: only the pixels it owns, at its placement. */
export function cutPoses(image, located, layout) {
  const { width, data } = image;
  const { owner } = located;
  const { cell } = layout;
  return located.poses.map((pose, i) => {
    const out = new Uint8Array(cell.width * cell.height * 4);
    const { dx, dy } = layout.placements[i];
    if (pose.box) {
      for (let y = pose.box.y0; y < pose.box.y1; y++) {
        const ty = y + dy;
        if (ty < 0 || ty >= cell.height) continue;
        for (let x = pose.box.x0; x < pose.box.x1; x++) {
          const p = y * width + x;
          if (owner[p] !== pose.index) continue;
          const tx = x + dx;
          if (tx < 0 || tx >= cell.width) continue;
          const t = (ty * cell.width + tx) * 4;
          out[t] = data[p * 4];
          out[t + 1] = data[p * 4 + 1];
          out[t + 2] = data[p * 4 + 2];
          out[t + 3] = data[p * 4 + 3];
        }
      }
    }
    return { index: pose.index, width: cell.width, height: cell.height, data: Buffer.from(out.buffer) };
  });
}

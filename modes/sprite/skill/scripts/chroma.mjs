/**
 * chroma.mjs — keying a chroma plate out of a frame by UN-MIXING it.
 *
 * ffmpeg's `colorkey` answers one question per pixel — how far is this colour
 * from the plate — and turns the answer into alpha. It never changes RGB, so an
 * anti-aliased edge pixel that is half subject and half green keeps all of its
 * green and is merely made half transparent: `(0,145,0)` survives at α≈148
 * still pure green, the 1 px dark-green rim `from-video` has always shipped.
 * The loop path's `despill` afterwards takes the green out by pulling the
 * channel down, which turns that same pixel black — the loop's dark rim.
 *
 * A pixel on the edge is a MIX: `observed = (1−k)·subject + k·plate`. How much
 * plate it holds (`k`) can be read off how far it leans toward the plate's hue,
 * and once `k` is known both halves come back: the subject's colour
 * `(observed − k·plate) / (1 − k)` and its coverage `α·(1 − k)`. That is this
 * module. Pure JS on RGBA buffers `{ width, height, data }`, Node built-ins
 * only, no ffmpeg: `sprite-sheet.mjs` decodes and encodes, this decides pixels.
 *
 * Ported from aldegad/sprite-gen (Apache-2.0)
 * sprite_gen/frames/extract.py@fbd1a08: `remove_chroma_background` (hard cut,
 * soft-alpha un-mix of the fringe within `unmix_reach` of the keyed region,
 * trapped-spill despill of small tinted clusters), `despill_color` /
 * `unmix_key_blend` (the blend model), `detect_background_key_rgb` (the plate
 * as painted: the mode of 8-wide RGB bins over the corner patches and the
 * border), with its constants — fringe radius 180, fringe delta 18, un-mix
 * reach 4, in-band un-mix depth 2, spill cluster ≤ max(32, 0.5 % of the
 * subject) with a tint > 40.
 * Changes: (1) the hard cut is ONE ball around the measured plate — the colour
 * the clip actually carries — with the radius our `--similarity` names
 * (0.22 × 255√3 ≈ 97 against upstream's 96), where upstream cuts a ball around
 * the requested pure key plus a connectivity-gated ball around the painted
 * one; our `--key auto` never had a requested key, and upstream's border
 * signature (unkeyed channels < 64) rejects broadcast green `(0,177,64)`
 * outright. (2) Which channels are "the key" comes from the plate's own hue
 * (`plateSplit`), not from a requested `#00FF00` / `#FF00FF`. (3) The plate is
 * measured over several frames of a clip, not one still. (4) Blends are
 * CLASSIFIED — and trapped spill found and corrected — by channel excess,
 * upstream's opt-in `spill_require_hue` rule (with its `chroma_groups` gain
 * bound), instead of the mean-channel tint: the tint axis reads yellow and
 * gold as leaning green, and on tanka's yellow fur that painted a pale
 * translucent ring around every ear. `k` is still read off the linear tint.
 * (5) JS rounds halves up where Python rounds them to even: ±1 on exact ties.
 *
 * `keyResidue` is inspired by aldegad/sprite-gen
 * sprite_gen/frames/check_visible_magenta.py (count the visible key-coloured
 * pixels an output still carries) with upstream's visible-residue bar from
 * extract.py (`_SPILL_MIN_TINT`: every keyed channel clears every other by
 * more than 40). `plateProximity` is inspired by sprite_gen/gen/prepare.py
 * (`choose_chroma_key`: a key must clear every subject pixel by the erase
 * radius; speckles — fewer than 3 of 8 neighbours within 40 — do not count).
 */

/** Soft-alpha un-mix: key-tinted pixels this far (Chebyshev px) from the keyed
 *  region are separated into colour + partial alpha. */
export const UNMIX_REACH = 4;
/** In-band blends (close to the plate colour) are un-mixed only this near. */
const IN_BAND_UNMIX_DEPTH = 2;
/** Distance to the plate below which a tinted pixel is an "in-band" blend. */
const FRINGE_RADIUS = 180;
/** Tint below which a pixel is subject and never touched. */
const FRINGE_DELTA = 18;
/** A trapped-spill cluster needs one pixel tinted past this to be treated;
 *  also the visible-residue bar `keyResidue` counts with. */
export const RESIDUE_TINT = 40;
/** A tinted cluster larger than this share of the subject is material, not spill. */
const SPILL_MAX_FRACTION = 0.005;
const SPILL_MIN_CLUSTER = 32;
/** Corner patch side = frame side / 5, the border one pixel wide. */
const CORNER_DIV = 5;
/** RGB histogram bin width 8: the mode bin, never a mean, picks the plate. */
const BIN_SHIFT = 3;
/** A colour whose unkeyed channels exceed this share of its dimmest keyed
 *  channel has no hue a key can lean on (a grey, a cream, a pastel). */
const PLATE_UNKEYED_RATIO = 0.5;
/** Keyed channels of a chroma plate have to be at least this lit. */
const PLATE_MIN_LIT = 64;
/** `plateProximity`'s speckle rule: a subject pixel counts when at least this
 *  many of its 8 neighbours are subject pixels within SPECKLE_TOLERANCE. */
const SPECKLE_MIN_SIMILAR = 3;
const SPECKLE_TOLERANCE = 40;
/** ffmpeg `colorkey` measures distance as a fraction of the RGB cube diagonal. */
export const RGB_DIAGONAL = 255 * Math.sqrt(3);

const KEYED = 0;
const SUBJECT = 1;
const IN_BAND = 2;
const OUT_OF_BAND = 3;
const UNSEEN = 255;

/** `--similarity` (colorkey's fraction of the cube diagonal) as an RGB radius. */
export function keyRadius(similarity) {
  return similarity * RGB_DIAGONAL;
}

export function parseHex(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

export function toHex([r, g, b]) {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Which channels a plate colour saturates and which it leaves dark — the axis
 * every tint is measured on — or null for a plate with no hue to lean on.
 *
 * Keyed channels are those at or above the midpoint of the colour's own range;
 * the plate is a chroma plate when every keyed channel is lit (≥ 64) and every
 * other channel sits at most half as high as the dimmest keyed one. Green
 * `#00f003`, broadcast green `#00b140`, Grok's magenta `#d82e93` and a blue
 * screen all qualify; a white, cream or grey plate (`#ece9e1`) does not, and
 * the caller keeps `colorkey` for it — there is no hue for a blend to lean
 * toward, so un-mixing has nothing to measure.
 */
export function plateSplit(color) {
  const max = Math.max(...color);
  const min = Math.min(...color);
  if (max === min) return null;
  const mid = (max + min) / 2;
  const keyed = [];
  const unkeyed = [];
  for (let c = 0; c < 3; c++) (color[c] >= mid ? keyed : unkeyed).push(c);
  const keyedMin = Math.min(...keyed.map((c) => color[c]));
  const unkeyedMax = Math.max(...unkeyed.map((c) => color[c]));
  if (keyedMin < PLATE_MIN_LIT || unkeyedMax > keyedMin * PLATE_UNKEYED_RATIO) return null;
  return { keyed, unkeyed };
}

/** Linear tint weights: tint = Σ w·channel = mean(keyed) − mean(unkeyed). */
function tintWeights(split) {
  const w = [0, 0, 0];
  for (const c of split.keyed) w[c] = 1 / split.keyed.length;
  for (const c of split.unkeyed) w[c] = -1 / split.unkeyed.length;
  return w;
}

/** min(keyed channels) − max(unkeyed channels) of the pixel at byte offset
 *  `i`: the key's HUE, which a yellow or a cyan does not have under a green
 *  key even though its mean leans green. A split has one or two channels on
 *  each side, so reading the first and last of each covers both cases without
 *  building anything per pixel — this runs on every pixel of every frame. */
function excessAt(split) {
  const k0 = split.keyed[0], k1 = split.keyed[split.keyed.length - 1];
  const u0 = split.unkeyed[0], u1 = split.unkeyed[split.unkeyed.length - 1];
  return (data, i) => {
    const a = data[i + k0], b = data[i + k1], c = data[i + u0], d = data[i + u1];
    return (a < b ? a : b) - (c > d ? c : d);
  };
}

/**
 * Every opaque pixel of the corner patches (side/5 square) and the one-pixel
 * border, appended as packed 0xRRGGBB to `into`.
 */
export function borderSamples(image, into = []) {
  const { width, height, data } = image;
  let cw = Math.floor(width / CORNER_DIV);
  let ch = Math.floor(height / CORNER_DIV);
  if (cw < 2) cw = width;
  if (ch < 2) ch = height;
  for (let y = 0; y < height; y++) {
    const cornerRow = y < ch || y >= height - ch;
    const fullRow = y === 0 || y === height - 1;
    for (let x = 0; x < width; x++) {
      const inside = fullRow || x === 0 || x === width - 1
        || (cornerRow && (x < cw || x >= width - cw));
      if (!inside) continue;
      const i = (y * width + x) * 4;
      if (data[i + 3] === 0) continue;
      into.push((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    }
  }
  return into;
}

/** The mean colour of the most populated 8-wide RGB bin — the plate as it was
 *  painted, never dragged toward a fringe or a corner the subject reaches. */
function modeColor(samples) {
  const bits = 8 - BIN_SHIFT;
  const bins = 1 << (3 * bits);
  const counts = new Uint32Array(bins);
  const sums = new Float64Array(bins * 3);
  for (const s of samples) {
    const r = s >> 16, g = (s >> 8) & 255, b = s & 255;
    const slot = ((r >> BIN_SHIFT) << (2 * bits)) | ((g >> BIN_SHIFT) << bits) | (b >> BIN_SHIFT);
    counts[slot]++;
    sums[slot * 3] += r;
    sums[slot * 3 + 1] += g;
    sums[slot * 3 + 2] += b;
  }
  let best = 0;
  for (let s = 1; s < bins; s++) if (counts[s] > counts[best]) best = s;
  const n = counts[best];
  return [0, 1, 2].map((c) => Math.floor(sums[best * 3 + c] / n));
}

/**
 * What the plate is: the colour to key, and — when it is a chroma plate —
 * the tint axis the un-mix reads blends on.
 *
 * `key` "auto" measures it over every frame handed in (the caller hands in
 * several frames of a clip, so a subject crossing one corner, or a plate that
 * drifts, cannot decide it alone); an explicit `[r,g,b]` is taken at its word.
 * `plateShare` is the fraction of border samples within the key radius of the
 * plate: well under one says the border is not one flat colour.
 */
export function measurePlate(frames, { key = "auto", radius }) {
  const samples = [];
  for (const frame of frames) borderSamples(frame, samples);
  let painted;
  if (key === "auto") {
    if (!samples.length) return null;
    painted = modeColor(samples);
  } else {
    painted = key.slice(0, 3);
  }
  let near = 0;
  const r2 = radius * radius;
  for (const s of samples) {
    const dr = (s >> 16) - painted[0], dg = ((s >> 8) & 255) - painted[1], db = (s & 255) - painted[2];
    if (dr * dr + dg * dg + db * db <= r2) near++;
  }
  const split = plateSplit(painted);
  const plate = {
    painted,
    hex: toHex(painted),
    plateShare: samples.length ? near / samples.length : 0,
    samples: samples.length,
    chroma: Boolean(split),
  };
  if (!split) return plate;
  const weights = tintWeights(split);
  const keyTint = weights[0] * painted[0] + weights[1] * painted[1] + weights[2] * painted[2];
  return { ...plate, split, weights, keyTint };
}

/** The plate description a known key colour implies — what `keyResidue` and
 *  `plateProximity` need when there is a colour but no frames to measure. */
export function plateOf(color) {
  const painted = typeof color === "string" ? parseHex(color) : color;
  const split = plateSplit(painted);
  if (!split) return { painted, hex: toHex(painted), chroma: false };
  const weights = tintWeights(split);
  const keyTint = weights[0] * painted[0] + weights[1] * painted[1] + weights[2] * painted[2];
  return { painted, hex: toHex(painted), chroma: true, split, weights, keyTint };
}

/**
 * Per-pixel working arrays, kept between calls. A clip is keyed frame after
 * frame at one size, and allocating ~4.5 MB of typed arrays per 640² frame
 * made the collector — not the keying — the cost (2–4 ms of work measured at
 * 5–29 ms a frame). Callers are synchronous, so one set is enough; each pass
 * re-initialises what it reads.
 */
let scratch = null;
function scratchFor(n) {
  if (!scratch || scratch.n < n) {
    scratch = {
      n,
      cls: new Uint8Array(n),
      depth: new Uint8Array(n),
      tints: new Float32Array(n),
      candidate: new Uint8Array(n),
      stack: new Int32Array(n),
    };
  }
  return scratch;
}

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

/**
 * Key a chroma plate out of `image`, in place. Returns what each pass did.
 *
 * 1. Hard cut: every pixel within `radius` of the plate (and every pixel that
 *    was already transparent) goes to (0,0,0,0).
 * 2. Classify the rest once, on the source colours: SUBJECT (tint under 18 —
 *    never touched), IN_BAND blend (tinted, within 180 of the plate) or
 *    OUT_OF_BAND blend (tinted, further).
 * 3. Un-mix: a blend within `unmixReach` px of the keyed region (in-band
 *    ones only within 2 px) becomes `(obs − k·plate)/(1 − k)` at alpha
 *    `α·(1 − k)`, `k = tint / plateTint`. Deeper key-tinted material is left
 *    exactly as it was.
 * 4. Trapped spill: among the pixels still tinted, an 8-connected cluster no
 *    larger than max(32, 0.5 % of the subject) holding one pixel tinted past
 *    40 is spill painted INTO the subject; its colour is un-mixed, its alpha
 *    kept (it sits inside opaque subject — partial alpha would punch holes).
 *    A larger cluster is the character's own key-coloured material.
 *
 * "Tinted" is channel excess — every keyed channel above every other — so a
 * gold or yellow edge under a green key is subject, not a blend.
 *
 * Each pass is its own function: one long function with four hot loops is
 * what JavaScriptCore (the test runner's engine) compiled slowly and
 * erratically, 3–28 ms for the same 640² frame, where node ran it in 2–6.
 */
export function keyFrame(image, plate, { radius, unmixReach = UNMIX_REACH, spill = true } = {}) {
  if (!plate?.chroma) throw new Error("keyFrame: the plate has no chroma hue — key it with colorkey");
  const n = image.width * image.height;
  const work = scratchFor(n);
  const keyed = cutAndClassify(image, plate, radius, work.cls, work.depth);
  const stats = { keyed, unmixed: 0, erased: 0, despilled: 0, spillClusters: 0 };
  if (keyed === 0 || plate.keyTint <= 0) return stats;
  if (unmixReach > 0) unmixFringe(image, plate, unmixReach, work, stats);
  if (spill) despillClusters(image, plate, keyed, work, stats);
  return stats;
}

/** Passes 1 + 2: zero what the plate owns, classify everything else, and
 *  seed the depth map pass 3 grows (0 on the keyed region, unseen elsewhere). */
function cutAndClassify(image, plate, radius, cls, depth) {
  const { width, height, data } = image;
  const n = width * height;
  const [pr, pg, pb] = plate.painted;
  const excess = excessAt(plate.split);
  const r2 = radius * radius;
  const f2 = FRINGE_RADIUS * FRINGE_RADIUS;
  let keyed = 0;
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const dr = r - pr, dg = g - pg, db = b - pb;
    const d2 = dr * dr + dg * dg + db * db;
    if (data[i + 3] === 0 || d2 <= r2) {
      cls[p] = KEYED;
      depth[p] = 0;
      keyed++;
      data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 0;
      continue;
    }
    depth[p] = UNSEEN;
    cls[p] = excess(data, i) < FRINGE_DELTA ? SUBJECT : d2 <= f2 ? IN_BAND : OUT_OF_BAND;
  }
  return keyed;
}

/** The pixels at Chebyshev distance 1 from the keyed region. */
function firstRing(width, height, depth) {
  const ring = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (depth[p] === 0) continue;
      const y0 = y > 0 ? y - 1 : y, y1 = y < height - 1 ? y + 1 : y;
      const x0 = x > 0 ? x - 1 : x, x1 = x < width - 1 ? x + 1 : x;
      let touches = false;
      for (let yy = y0; yy <= y1 && !touches; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          if (depth[yy * width + xx] === 0) { touches = true; break; }
        }
      }
      if (touches) { depth[p] = 1; ring.push(p); }
    }
  }
  return ring;
}

/** The unseen pixels next to `ring`, marked at depth `d`. */
function nextRing(width, height, depth, ring, d) {
  const next = [];
  for (const p of ring) {
    const x = p % width;
    const y = (p - x) / width;
    const y0 = y > 0 ? y - 1 : y, y1 = y < height - 1 ? y + 1 : y;
    const x0 = x > 0 ? x - 1 : x, x1 = x < width - 1 ? x + 1 : x;
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const q = yy * width + xx;
        if (depth[q] !== UNSEEN) continue;
        depth[q] = d;
        next.push(q);
      }
    }
  }
  return next;
}

/** Pass 3: separate every blend near the keyed region into colour + coverage. */
function unmixFringe(image, plate, reach, work, stats) {
  const { width, height, data } = image;
  const { cls, depth } = work;
  const [pr, pg, pb] = plate.painted;
  const [wr, wg, wb] = plate.weights;
  const keyTint = plate.keyTint;
  let ring = firstRing(width, height, depth);
  for (let d = 1; d <= reach && ring.length; d++) {
    for (const p of ring) {
      const c = cls[p];
      if (!(c === OUT_OF_BAND || (c === IN_BAND && d <= IN_BAND_UNMIX_DEPTH))) continue;
      const i = p * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      // k from the LINEAR tint: channel excess decides whether a pixel is a
      // blend, but it is not linear in the mix and cannot say how much of one.
      const k = Math.min((wr * r + wg * g + wb * b) / keyTint, 1);
      const coverage = 1 - k;
      const alpha = Math.min(255, Math.round(data[i + 3] * coverage));
      if (coverage <= 0 || alpha <= 0) {
        data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 0;
        stats.erased++;
        continue;
      }
      data[i] = clamp255((r - k * pr) / coverage);
      data[i + 1] = clamp255((g - k * pg) / coverage);
      data[i + 2] = clamp255((b - k * pb) / coverage);
      data[i + 3] = alpha;
      stats.unmixed++;
    }
    if (d < reach) ring = nextRing(width, height, depth, ring, d + 1);
  }
}

/** Pass 4: small tinted clusters inside the subject lose the plate's colour. */
function despillClusters(image, plate, keyed, work, stats) {
  const { width, height, data } = image;
  const n = width * height;
  const [pr, pg, pb] = plate.painted;
  const [wr, wg, wb] = plate.weights;
  const keyTint = plate.keyTint;
  const excess = excessAt(plate.split);
  const limit = Math.max(SPILL_MIN_CLUSTER, Math.round((n - keyed) * SPILL_MAX_FRACTION));
  const { tints, candidate, stack } = work;
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    candidate[p] = 0;
    if (data[i + 3] === 0) continue;
    const t = excess(data, i);
    if (t >= FRINGE_DELTA) { candidate[p] = 1; tints[p] = t; }
  }
  // The correction keeps the channel differences INSIDE each group
  // (upstream's `chroma_groups`): hue decided this pixel is spill, and a
  // slightly impure plate must not manufacture a second cast in it.
  const groups = [plate.split.keyed, plate.split.unkeyed];
  const out = [0, 0, 0];
  const obs = [0, 0, 0];
  const cluster = [];
  for (let seed = 0; seed < n; seed++) {
    if (candidate[seed] !== 1) continue;
    let top = 0;
    stack[top++] = seed;
    candidate[seed] = 2;
    cluster.length = 0;
    let peak = -Infinity;
    while (top > 0) {
      const p = stack[--top];
      cluster.push(p);
      if (tints[p] > peak) peak = tints[p];
      const x = p % width;
      const y = (p - x) / width;
      const y0 = y > 0 ? y - 1 : y, y1 = y < height - 1 ? y + 1 : y;
      const x0 = x > 0 ? x - 1 : x, x1 = x < width - 1 ? x + 1 : x;
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          const q = yy * width + xx;
          if (candidate[q] !== 1) continue;
          candidate[q] = 2;
          stack[top++] = q;
        }
      }
    }
    if (cluster.length > limit || peak <= RESIDUE_TINT) continue;
    stats.spillClusters++;
    for (const p of cluster) {
      const i = p * 4;
      const o0 = data[i], o1 = data[i + 1], o2 = data[i + 2];
      // How much plate: the linear tint, never the (nonlinear) excess.
      const k = Math.min((wr * o0 + wg * o1 + wb * o2) / keyTint, 1);
      const coverage = 1 - k;
      if (coverage <= 0) continue;
      out[0] = (o0 - k * pr) / coverage;
      out[1] = (o1 - k * pg) / coverage;
      out[2] = (o2 - k * pb) / coverage;
      obs[0] = o0; obs[1] = o1; obs[2] = o2;
      for (const channels of groups) {
        let mean = 0, observed = 0;
        for (const c of channels) { mean += out[c]; observed += obs[c]; }
        mean /= channels.length;
        observed /= channels.length;
        for (const c of channels) out[c] = mean + obs[c] - observed;
      }
      data[i] = clamp255(out[0]);
      data[i + 1] = clamp255(out[1]);
      data[i + 2] = clamp255(out[2]);
      stats.despilled++;
    }
  }
}

/**
 * How much of the plate a keyed frame still shows: visible pixels (alpha at
 * or above `threshold`) whose every keyed channel clears every other channel
 * by more than 40 — the plate's hue, not a leaning — and the same count over
 * the partially transparent pixels, which is where a fringe lives.
 *
 * Counts, not fractions, so a caller pools them over a clip. A frame keyed
 * off a plate with no hue has nothing to count: null.
 */
export function keyResidue(image, plate, threshold) {
  if (!plate?.chroma) return null;
  const { data } = image;
  const excess = excessAt(plate.split);
  let visible = 0, tinted = 0, partial = 0, partialTinted = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < threshold) continue;
    visible++;
    const hit = excess(data, i) > RESIDUE_TINT;
    if (hit) tinted++;
    if (a < 255) {
      partial++;
      if (hit) partialTinted++;
    }
  }
  return { visible, tinted, partial, partialTinted };
}

/** Pool `keyResidue` counts: the fraction of visible pixels still carrying the
 *  plate, and of partially transparent ones. Null when nothing was counted. */
export function poolResidue(counts) {
  const live = counts.filter(Boolean);
  if (!live.length) return null;
  const sum = (key) => live.reduce((s, c) => s + c[key], 0);
  const visible = sum("visible");
  const partial = sum("partial");
  return {
    visible: visible ? sum("tinted") / visible : 0,
    edge: partial ? sum("partialTinted") / partial : 0,
  };
}

/**
 * Subject pixels a plate would key away: pixels at or above `threshold` whose
 * colour sits within `radius` of `color`, not counting speckles (a pixel needs
 * three of its eight neighbours to be subject pixels within 40 of it).
 * `nearest` is the subject colour closest to the plate.
 */
export function plateProximity(image, color, { radius, threshold }) {
  const { width, height, data } = image;
  const [pr, pg, pb] = color;
  const r2 = radius * radius;
  const t2 = SPECKLE_TOLERANCE * SPECKLE_TOLERANCE;
  let subject = 0, within = 0, best = Infinity, nearest = null;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] < threshold) continue;
      subject++;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const dr = r - pr, dg = g - pg, db = b - pb;
      const d2 = dr * dr + dg * dg + db * db;
      if (d2 > r2 && d2 >= best) continue;
      let similar = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if ((dx === 0 && dy === 0) || xx < 0 || xx >= width) continue;
          const j = (yy * width + xx) * 4;
          if (data[j + 3] < threshold) continue;
          const er = data[j] - r, eg = data[j + 1] - g, eb = data[j + 2] - b;
          if (er * er + eg * eg + eb * eb <= t2) similar++;
        }
      }
      if (similar < SPECKLE_MIN_SIMILAR) continue;
      if (d2 <= r2) within++;
      if (d2 < best) { best = d2; nearest = [r, g, b]; }
    }
  }
  return {
    subject,
    within,
    fraction: subject ? within / subject : 0,
    minDistance: nearest ? Math.sqrt(best) : null,
    nearest: nearest ? toHex(nearest) : null,
  };
}

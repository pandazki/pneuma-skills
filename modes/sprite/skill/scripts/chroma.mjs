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
/**
 * The local un-mix (ours): a pixel near the cut is read against the subject
 * colours deeper in, within this Chebyshev radius, rather than against the
 * plate's hue alone. Channel excess cannot see a blend of a warm or saturated
 * subject with green — orange hair at 30 % plate is `(139,148,42)`, whose
 * green clears its red by 9 — and the fox of the 2026-09-27 route-G trial
 * shipped a yellow-green halo on every hair, ear and tail edge that way.
 */
const LOCAL_RADIUS = 3;
/** Pixels this far (Chebyshev px) from the cut are read against the local
 *  subject; a codec's 4:2:0 chroma smears an edge over about two. */
const LOCAL_DEPTH = 3;
/** A local explanation with less plate than this is the subject's own
 *  shading, and is left alone. */
const LOCAL_K_MIN = 0.1;
/** How far off the subject–plate plane a blend may sit: an absolute codec
 *  allowance plus a share of the plate it holds. */
const LOCAL_RES_ABS = 10;
const LOCAL_RES_REL = 0.15;
/** How much brighter or darker than a candidate the subject under a blend may
 *  be: shading and lineart, not another material. */
const LOCAL_SHADE_MIN = 0.25;
const LOCAL_SHADE_MAX = 1.4;
/** A candidate this dark (|F|² under 64) or this close to the plate's own
 *  direction (sin² of the angle under 0.05) spans no usable plane with it. */
const LOCAL_MIN_NORM = 64;
const LOCAL_MIN_SIN2 = 0.05;
/** The subject palette a strand is read against: 16-level RGB bins holding
 *  at least 0.2 % (and 8 pixels) of the interior, the most populated 48. */
const PALETTE_MIN_SHARE = 0.002;
const PALETTE_MIN_COUNT = 8;
const PALETTE_MAX = 48;
/**
 * A shadow painted ON the plate — Seedance draws a dark-green one under the
 * feet, ~105 from the plate (outside the 0.22 radius) — is the plate at a
 * fraction `f` of its brightness: `obs ≈ f·plate`. Pixels that are, connected
 * to the cut, go with it; the ones touching the subject stay for the un-mix
 * (a blend of the subject with the shadow). A shade darker than SHADE_MIN is
 * a dark outline's blend as much as a shadow, and is left to the un-mix.
 * SHADE_TOL is the distance off the plate's own direction allowed, as a share
 * of the shade's length (≈ 11°): the trial's shadow measured within 0.1–0.2.
 */
const SHADE_MIN = 0.25;
const SHADE_TOL = 0.2;
/** `keyResidue` counts an edge pixel whose local explanation holds at least
 *  this much plate: a fringe the eye sees on a dark background. */
const RESIDUE_BLEND = 0.2;
/** Only an edge pixel at least this opaque can be a fringe: one the keyer
 *  gave partial coverage was un-mixed, and what is left in it (a clipped
 *  channel, a local cast of the plate) is second order. */
const FRINGE_MIN_ALPHA = 250;
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

/**
 * Raw RGBA the un-mixing keyer may stage on disk for one clip window. `loop`
 * and `transition` decode the window once, raw, and key it in bounded
 * batches from that file: 300 frames at 640² are 491 MB, a 400-frame 4K
 * window 13 GB (R1-4). Past the budget — or past the free space beside the
 * output, less a margin — the run is refused before a byte is decoded.
 */
export const MAX_UNMIX_STAGE_BYTES = 4 * 1024 ** 3;
export const UNMIX_STAGE_MARGIN = 512 * 1024 ** 2;

/** Why a window of `frames` at `width`×`height` cannot be staged for the
 *  un-mix (`freeBytes` null when unknown), or null when it can. */
export function unmixStageRefusal({ frames, width, height, freeBytes = null }) {
  const bytes = frames * width * height * 4;
  const gb = (v) => `${(v / 1024 ** 3).toFixed(1)} GB`;
  const what = `the window is up to ${frames} frames of ${width}x${height}: ${gb(bytes)} of raw frames staged on disk for --keyer unmix`;
  const fix = "narrow the window (--trim-start/--trim-end), or key with --keyer colorkey, which writes compressed frames";
  if (bytes > MAX_UNMIX_STAGE_BYTES) return `${what}, over its ${gb(MAX_UNMIX_STAGE_BYTES)} budget — ${fix}`;
  if (freeBytes !== null && bytes + UNMIX_STAGE_MARGIN > freeBytes) return `${what}, and ${gb(freeBytes)} is free there — free some space, or ${fix}`;
  return null;
}

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
 * 2. Plate shade: pixels that are the plate darkened (`obs ≈ f·plate`,
 *    f ≥ 0.25) and connected to the cut — a shadow painted on the floor —
 *    go too, except the ones touching the subject, which pass 4 reads as
 *    blends.
 * 3. Classify the rest once, on the source colours: SUBJECT (tint under 18),
 *    IN_BAND blend (tinted, within 180 of the plate) or OUT_OF_BAND blend
 *    (tinted, further).
 * 4. Un-mix, from the deepest ring out to the cut: a pixel within 2 px of the
 *    cut is first read against the subject colours deeper in (the local
 *    un-mix): when one of them, moved toward the plate by `k ≥ 0.1`, explains
 *    it, it becomes `(obs − k·plate)/(1 − k)` at alpha `α·(1 − k)` — whatever
 *    its class. Otherwise a blend within `unmixReach` px (in-band ones only
 *    within 2) is un-mixed with `k = tint / plateTint`. Deeper key-tinted
 *    material is left exactly as it was.
 * 5. Trapped spill: among the pixels still tinted, an 8-connected cluster no
 *    larger than max(32, 0.5 % of the subject) holding one pixel tinted past
 *    40 is spill painted INTO the subject; its colour is un-mixed, its alpha
 *    kept (it sits inside opaque subject — partial alpha would punch holes).
 *    A larger cluster is the character's own key-coloured material.
 *
 * "Tinted" is channel excess — every keyed channel above every other — so a
 * gold or yellow edge under a green key is subject, not a blend, unless the
 * local un-mix finds the subject colour it is a blend OF.
 *
 * Each pass is its own function: one long function with four hot loops is
 * what JavaScriptCore (the test runner's engine) compiled slowly and
 * erratically, 3–28 ms for the same 640² frame, where node ran it in 2–6.
 */
export function keyFrame(image, plate, { radius, unmixReach = UNMIX_REACH, spill = true, shade = true } = {}) {
  if (!plate?.chroma) throw new Error("keyFrame: the plate has no chroma hue — key it with colorkey");
  const n = image.width * image.height;
  const work = scratchFor(n);
  let keyed = cutAndClassify(image, plate, radius, work.cls, work.depth);
  const stats = { keyed, shaded: 0, unmixed: 0, localUnmixed: 0, erased: 0, despilled: 0, spillClusters: 0 };
  if (keyed === 0 || plate.keyTint <= 0) return stats;
  if (shade) {
    stats.shaded = cutShade(image, plate, work);
    keyed += stats.shaded;
    stats.keyed = keyed;
  }
  if (unmixReach > 0) unmixFringe(image, plate, unmixReach, work, stats);
  if (spill) despillClusters(image, plate, keyed, work, stats);
  return stats;
}

/** Passes 1 + 3: zero what the plate owns, classify everything else, and
 *  seed the depth map pass 4 grows (0 on the keyed region, unseen elsewhere). */
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

/**
 * Pass 2: the plate in shadow. A pixel is a shade when it lies along the
 * plate's own direction — `f = obs·P / P·P` at least SHADE_MIN and the rest
 * `|obs − f·P|` within SHADE_TOL·f·|P| — and it is cut when it is connected
 * to the keyed region through shades AND none of its 8 neighbours is subject
 * (a pixel next to the subject is a blend of subject and shadow, and the
 * un-mix owns it). Returns the pixels cut.
 */
function cutShade(image, plate, work) {
  const { width, height, data } = image;
  const n = width * height;
  const { cls, depth, candidate, stack } = work;
  const [pr, pg, pb] = plate.painted;
  const pp = pr * pr + pg * pg + pb * pb;
  const tol2 = SHADE_TOL * SHADE_TOL * pp;
  let top = 0;
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    candidate[p] = 0;
    if (cls[p] === KEYED) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const f = (r * pr + g * pg + b * pb) / pp;
    if (f < SHADE_MIN || f > 1.2) continue;
    const er = r - f * pr, eg = g - f * pg, eb = b - f * pb;
    const e2 = er * er + eg * eg + eb * eb;
    if (e2 <= tol2 * f * f) candidate[p] = 1;
    else if (e2 <= 4 * tol2 * f * f) candidate[p] = 4;
  }
  // Flood from the cut through shades (2 = reached), with hysteresis: a
  // pixel up to twice as far off the plate's direction joins only next to a
  // reached one. A codec's 4:2:0 chroma leaves every other pixel of a real
  // shadow just outside the strict test, and those would otherwise survive
  // as a dotted band of dark translucent pixels.
  for (let p = 0; p < n; p++) {
    if (candidate[p] !== 1 || !touches(width, height, depth, p, 0)) continue;
    candidate[p] = 2;
    stack[top++] = p;
  }
  const reached = [];
  while (top > 0) {
    const p = stack[--top];
    reached.push(p);
    const x = p % width;
    const y = (p - x) / width;
    const y0 = y > 0 ? y - 1 : y, y1 = y < height - 1 ? y + 1 : y;
    const x0 = x > 0 ? x - 1 : x, x1 = x < width - 1 ? x + 1 : x;
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const q = yy * width + xx;
        const c = candidate[q];
        if (c !== 1 && c !== 4) continue;
        candidate[q] = 2;
        stack[top++] = q;
      }
    }
  }
  // Cut the reached shades no subject pixel touches; decide on the whole
  // region first, so cutting one pixel never changes its neighbour's answer.
  const cut = [];
  for (const p of reached) {
    const x = p % width;
    const y = (p - x) / width;
    const y0 = y > 0 ? y - 1 : y, y1 = y < height - 1 ? y + 1 : y;
    const x0 = x > 0 ? x - 1 : x, x1 = x < width - 1 ? x + 1 : x;
    let nearSubject = false;
    for (let yy = y0; yy <= y1 && !nearSubject; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const q = yy * width + xx;
        if (cls[q] !== KEYED && candidate[q] !== 2) { nearSubject = true; break; }
      }
    }
    if (!nearSubject) cut.push(p);
  }
  for (const p of cut) {
    const i = p * 4;
    cls[p] = KEYED;
    depth[p] = 0;
    data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 0;
  }
  return cut.length;
}

/** Whether any 8-neighbour of `p` sits at depth `d`. */
function touches(width, height, depth, p, d) {
  const x = p % width;
  const y = (p - x) / width;
  const y0 = y > 0 ? y - 1 : y, y1 = y < height - 1 ? y + 1 : y;
  const x0 = x > 0 ? x - 1 : x, x1 = x < width - 1 ? x + 1 : x;
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      if (depth[yy * width + xx] === d) return true;
    }
  }
  return false;
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

/** What `fitBlend` found for the last candidate it accepted: the plate share. */
let fitK = 0;

/**
 * Explain `obs` as `a·F + k·P` — the subject colour F, lit a little brighter
 * or darker (`s = a/(1−k)` within LOCAL_SHADE), covering `1 − k` of the pixel
 * over the plate P — by least squares. Returns the squared residual left off
 * that plane (Infinity when F cannot explain the pixel: too dark, along the
 * plate's own direction, a shade out of range, or all plate) and leaves `k`
 * in `fitK`. Under a green plate the plane says: the pixel's red and blue are
 * a scaled copy of the subject's, and its green exceeds what that scale
 * explains. A dark edge that is lineart, orange and plate at once fits it; a
 * rim light or a yellow material (red kept, blue changed) does not.
 */
function fitBlend(o0, o1, o2, f0, f1, f2, pr, pg, pb, pp, po) {
  const ff = f0 * f0 + f1 * f1 + f2 * f2;
  if (ff < LOCAL_MIN_NORM) return Infinity;
  const fp = f0 * pr + f1 * pg + f2 * pb;
  const det = ff * pp - fp * fp;
  if (det < LOCAL_MIN_SIN2 * ff * pp) return Infinity;
  const fo = f0 * o0 + f1 * o1 + f2 * o2;
  let a = (fo * pp - fp * po) / det;
  let k = (ff * po - fp * fo) / det;
  if (k < 0) { k = 0; a = fo / ff; }
  if (k >= 1) return Infinity;
  const shade = a / (1 - k);
  if (shade < LOCAL_SHADE_MIN || shade > LOCAL_SHADE_MAX) return Infinity;
  const e0 = o0 - a * f0 - k * pr, e1 = o1 - a * f1 - k * pg, e2 = o2 - a * f2 - k * pb;
  fitK = k;
  return e0 * e0 + e1 * e1 + e2 * e2;
}

/** `localShare`'s answers besides a plate share: nothing explains the pixel,
 *  or the subject beside it does with no plate to speak of. */
const UNEXPLAINED = -1;
const SUBJECT_ITSELF = -2;

/** The residual allowed for a blend holding `k` of a plate of norm² `pp`. */
function blendTolerance(k, pp) {
  const tol = LOCAL_RES_ABS + LOCAL_RES_REL * k * Math.sqrt(pp);
  return tol * tol;
}

/**
 * The plate share of pixel `p` (at depth `d`) read against the subject
 * around it: every pixel within LOCAL_RADIUS that is deeper than `d` and has
 * no key hue (excess under 18) is a candidate subject colour for `fitBlend`,
 * and the one with the smallest residual wins — a deeper pixel of the same
 * colour wins with k = 0, which is how a yellow edge next to yellow fur stays
 * exactly as drawn. Returns its `k` when that is at least `kMin` and the
 * residual within LOCAL_RES_ABS + LOCAL_RES_REL·k·|P|; SUBJECT_ITSELF when the
 * winner is the subject with less plate than `kMin`; UNEXPLAINED otherwise.
 */
function localShare(data, width, height, depth, p, d, plate, excess, kMin) {
  const [pr, pg, pb] = plate.painted;
  const pp = pr * pr + pg * pg + pb * pb;
  const x = p % width;
  const y = (p - x) / width;
  const i = p * 4;
  const o0 = data[i], o1 = data[i + 1], o2 = data[i + 2];
  const po = pr * o0 + pg * o1 + pb * o2;
  const y0 = y > LOCAL_RADIUS ? y - LOCAL_RADIUS : 0, y1 = y + LOCAL_RADIUS < height ? y + LOCAL_RADIUS : height - 1;
  const x0 = x > LOCAL_RADIUS ? x - LOCAL_RADIUS : 0, x1 = x + LOCAL_RADIUS < width ? x + LOCAL_RADIUS : width - 1;
  let best = Infinity, bestK = 0;
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      const q = yy * width + xx;
      if (depth[q] <= d) continue;
      const j = q * 4;
      if (data[j + 3] === 0 || excess(data, j) >= FRINGE_DELTA) continue;
      const res = fitBlend(o0, o1, o2, data[j], data[j + 1], data[j + 2], pr, pg, pb, pp, po);
      if (res < best) { best = res; bestK = fitK; }
    }
  }
  return judgeFit(best, bestK, kMin, pp);
}

function judgeFit(best, bestK, kMin, pp) {
  if (best === Infinity || best > blendTolerance(bestK, pp)) return UNEXPLAINED;
  return bestK < kMin ? SUBJECT_ITSELF : bestK;
}

/**
 * The subject's own colours, for the pixels no deeper neighbour explains: a
 * hair strand one or two pixels wide is all edge, with nothing deeper beside
 * it, but its colour is the hair's. The mean colour of every 16-level RGB bin
 * holding at least 0.2 % of the interior pixels — deeper than `minDepth`, at
 * least `minAlpha` opaque, with no key hue — most populated first, at most
 * PALETTE_MAX of them, as a flat [r, g, b, …] array.
 */
function subjectPalette(data, n, depth, minDepth, minAlpha, excess) {
  const counts = new Uint32Array(4096);
  const sums = new Float64Array(4096 * 3);
  let interior = 0;
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    if (depth[p] <= minDepth || data[i + 3] < minAlpha || excess(data, i) >= FRINGE_DELTA) continue;
    const slot = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    counts[slot]++;
    sums[slot * 3] += data[i]; sums[slot * 3 + 1] += data[i + 1]; sums[slot * 3 + 2] += data[i + 2];
    interior++;
  }
  const floor = Math.max(PALETTE_MIN_COUNT, interior * PALETTE_MIN_SHARE);
  const slots = [];
  for (let slot = 0; slot < 4096; slot++) if (counts[slot] >= floor) slots.push(slot);
  slots.sort((a, b) => counts[b] - counts[a]);
  const colors = new Float64Array(Math.min(slots.length, PALETTE_MAX) * 3);
  for (let k = 0; k < colors.length / 3; k++) {
    const slot = slots[k];
    for (let c = 0; c < 3; c++) colors[k * 3 + c] = sums[slot * 3 + c] / counts[slot];
  }
  return colors;
}

/** The plate share of pixel `p` read against the subject's palette, with the
 *  same verdicts as `localShare`. */
function paletteShare(data, p, plate, palette, kMin) {
  const [pr, pg, pb] = plate.painted;
  const pp = pr * pr + pg * pg + pb * pb;
  const i = p * 4;
  const o0 = data[i], o1 = data[i + 1], o2 = data[i + 2];
  const po = pr * o0 + pg * o1 + pb * o2;
  let best = Infinity, bestK = 0;
  for (let c = 0; c < palette.length; c += 3) {
    const res = fitBlend(o0, o1, o2, palette[c], palette[c + 1], palette[c + 2], pr, pg, pb, pp, po);
    if (res < best) { best = res; bestK = fitK; }
  }
  return judgeFit(best, bestK, kMin, pp);
}

/**
 * Pass 4: separate every blend near the keyed region into colour + coverage,
 * from the deepest ring out, so a pixel is read against deeper pixels the
 * pass has already cleaned. A pixel within LOCAL_DEPTH that no deeper
 * neighbour explains is read against the subject's palette.
 */
function unmixFringe(image, plate, reach, work, stats) {
  const { width, height, data } = image;
  const { cls, depth } = work;
  const [pr, pg, pb] = plate.painted;
  const [wr, wg, wb] = plate.weights;
  const keyTint = plate.keyTint;
  const excess = excessAt(plate.split);
  const rings = [firstRing(width, height, depth)];
  const deepest = Math.max(reach, LOCAL_DEPTH);
  for (let d = 1; d < deepest && rings[d - 1].length; d++) rings.push(nextRing(width, height, depth, rings[d - 1], d + 1));
  const palette = subjectPalette(data, width * height, depth, deepest, 1, excess);
  for (let d = rings.length; d >= 1; d--) {
    for (const p of rings[d - 1]) {
      const c = cls[p];
      let k = UNEXPLAINED;
      if (d <= LOCAL_DEPTH) {
        k = localShare(data, width, height, depth, p, d, plate, excess, LOCAL_K_MIN);
        if (k === UNEXPLAINED && c === SUBJECT) k = paletteShare(data, p, plate, palette, LOCAL_K_MIN);
      }
      const local = k >= 0;
      if (!local) {
        if (d > reach || !(c === OUT_OF_BAND || (c === IN_BAND && d <= IN_BAND_UNMIX_DEPTH))) continue;
        const i = p * 4;
        // k from the LINEAR tint: channel excess decides whether a pixel is a
        // blend, but it is not linear in the mix and cannot say how much of one.
        k = Math.min((wr * data[i] + wg * data[i + 1] + wb * data[i + 2]) / keyTint, 1);
      }
      const i = p * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
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
      if (local) stats.localUnmixed++;
    }
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
 * by more than 40 — the plate's hue, not a leaning — plus, as `fringe`, the
 * opaque pixels within two of the transparent region that are not that but
 * are the subject deeper in (or, for a strand with nothing deeper, a colour
 * of the subject's palette) moved at least a fifth of the way to the plate
 * (the local un-mix's own reading, see `localShare`): a yellow-green rim on
 * orange hair, a teal one on blue cloth, which a hue test cannot see.
 * `partialTinted` counts the tinted pixels among the partially transparent
 * ones, which is where a colorkey fringe lives.
 *
 * Counts, not fractions, so a caller pools them over a clip. A frame keyed
 * off a plate with no hue has nothing to count: null.
 */
export function keyResidue(image, plate, threshold) {
  if (!plate?.chroma) return null;
  const { width, height, data } = image;
  const n = width * height;
  const excess = excessAt(plate.split);
  const work = scratchFor(n);
  const { depth, candidate } = work;
  let visible = 0, tinted = 0;
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    candidate[p] = 0;
    if (data[i + 3] < threshold) { depth[p] = 0; continue; }
    depth[p] = UNSEEN;
    visible++;
    if (excess(data, i) > RESIDUE_TINT) { tinted++; candidate[p] = 1; }
  }
  let fringe = 0, edge = 0;
  let ring = firstRing(width, height, depth);
  const rings = [ring];
  if (ring.length) rings.push(nextRing(width, height, depth, ring, 2));
  const palette = subjectPalette(data, n, depth, 2, FRINGE_MIN_ALPHA, excess);
  for (let d = 1; d <= rings.length; d++) {
    edge += rings[d - 1].length;
    for (const p of rings[d - 1]) {
      // A keyer that gave a pixel partial coverage separated the plate from
      // it; the fringe is the edge left OPAQUE with the plate still in it.
      if (candidate[p] === 1 || data[p * 4 + 3] < FRINGE_MIN_ALPHA) continue;
      let k = localShare(data, width, height, depth, p, d, plate, excess, RESIDUE_BLEND);
      if (k === UNEXPLAINED && excess(data, p * 4) < FRINGE_DELTA) k = paletteShare(data, p, plate, palette, RESIDUE_BLEND);
      if (k < 0) continue;
      candidate[p] = 1;
      fringe++;
    }
  }
  let partial = 0, partialTinted = 0;
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const a = data[i + 3];
    if (a < threshold || a === 255) continue;
    partial++;
    if (candidate[p] === 1) partialTinted++;
  }
  return { visible, tinted, fringe, edge, partial, partialTinted };
}

/** Pool `keyResidue` counts: the fraction of visible pixels still carrying the
 *  plate (its hue, or a fringe's blend of it), of partially transparent ones,
 *  and of the two-pixel edge band that is a fringe. Null when nothing was
 *  counted. */
export function poolResidue(counts) {
  const live = counts.filter(Boolean);
  if (!live.length) return null;
  const sum = (key) => live.reduce((s, c) => s + (c[key] ?? 0), 0);
  const visible = sum("visible");
  const partial = sum("partial");
  const edge = sum("edge");
  return {
    visible: visible ? (sum("tinted") + sum("fringe")) / visible : 0,
    edge: partial ? sum("partialTinted") / partial : 0,
    fringe: edge ? sum("fringe") / edge : 0,
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

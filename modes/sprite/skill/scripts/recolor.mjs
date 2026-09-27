/**
 * recolor.mjs — colourways of a pixel-art character: a palette swap baked
 * into new files, never a tint applied at run time.
 *
 * A pixel-art character here is quantised to ONE pinned palette
 * (`pixel-lattice.mjs`, `character.pixel.palette`), so every visible pixel is
 * one of a few dozen exact colours and "the red team" is a map from some of
 * them to others. The swap is exact by default: a pixel changes only when its
 * RGB equals a source colour. A tolerance is opt-in, per colourway: a pixel
 * within that Chebyshev distance of a source takes the target of the NEAREST
 * source (squared RGB distance; a tie goes to the earlier map entry).
 *
 * Nothing is left behind silently. Every bake counts how many pixels each map
 * entry replaced, names the entries that never matched (a typo, or a colour of
 * another palette), and names and counts the colours the map did not cover —
 * left exactly as they were.
 *
 * Same pixels in, same pixels out: integer arithmetic only, alpha and every
 * pixel at or below the opaque floor untouched, so a variant has the geometry
 * of the frames it came from. Pure computation on `{ width, height, data }`
 * RGBA buffers and plain objects — no Node built-ins, so the viewer's loader
 * and `sprite-project.mjs` read the colourway rules from here too. Decoding,
 * encoding and packing stay in `sprite-sheet.mjs`, which owns every image on
 * disk; `project.json` is written only by `sprite-project.mjs`.
 *
 * Ported from aldegad/sprite-gen (Apache-2.0) sprite_gen/effects/recolor.py@fbd1a08:
 * the exact and tolerance bakes (`_bake_variant_exact`,
 * `_bake_variant_tolerance`), the opaque floor (alpha > 8), the per-variant
 * report (hits per entry, unused sources, passthrough colours by frequency then
 * hex, capped at 64 with the cap announced) and the spec checks (unique names,
 * non-empty maps, a source mapped twice refused). Changes: re-expressed per
 * pixel over flat RGBA buffers with the colour lookup cached; the tolerance
 * belongs to each colourway (upstream: one `match` + `tolerance` per spec —
 * here an absent or 0 tolerance IS exact, so the two cannot contradict); map
 * keys must carry the `#` (a bare `123456` is an integer-like key whose place
 * in a JS object's order would move a tolerance tie); names are slugs, because
 * they name files and asset ids; the bake runs over a motion's frames (which
 * `sprite-sheet.mjs` then packs) and the report sums over the frames of a
 * motion and of a character. Ours: the draft is read off the character's
 * pinned palette and the colours its frames really use (upstream drafts one
 * sheet's histogram), with a swatch sheet that marks where each colour is.
 */

/** A recolor map's `kind`: the file `recolor-palette` drafts and `recolor --map` reads. */
export const RECOLOR_KIND = "pneuma-sprite-recolor";
export const RECOLOR_VERSION = 1;
/** Opaque enough to be the character, as upstream (and its GIF step) count it:
 *  alpha above 8. Below it a pixel keeps its RGB and is nobody's target. */
export const ALPHA_THRESHOLD = 8;
/** The uncovered-colour list stops here and says how many it left out, so
 *  "nothing left over" and "capped at 64 of 900" never read the same. */
export const UNCOVERED_CAP = 64;
/** The widest tolerance there is: a Chebyshev distance on 0–255 channels. */
export const MAX_TOLERANCE = 255;
/** A colourway's name names files (`variants/<name>/`) and asset ids. */
export const MAX_VARIANT_NAME = 32;
export const VARIANT_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** `motions/<id>/variants/<name>/` holds a colourway's frames, sheet, atlas and preview. */
export const VARIANTS_DIRNAME = "variants";
/** Where `recolor-palette` drafts the map, in the character directory; the
 *  swatch sheet goes beside it as `<name>-swatches.png`. */
export const RECOLOR_FILENAME = "recolor.json";

/** A refusal this module phrases; `sprite-sheet.mjs` turns it into `ERROR:`. */
export class RecolorError extends Error {}

function refuse(message) {
  throw new RecolorError(message);
}

const pack = (r, g, b) => (r << 16) | (g << 8) | b;
const packedHex = (value) => `#${value.toString(16).padStart(6, "0")}`;

/** `#rrggbb` (either case) as `[r, g, b]`, or null for anything else. */
export function parseHexColor(value) {
  const m = typeof value === "string" ? /^#([0-9a-fA-F]{6})$/.exec(value.trim()) : null;
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** `[r, g, b]` as lower-case `#rrggbb`. */
export const formatHex = (rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/** Why a string is not a colourway name, or null when it is one. */
export function variantNameProblem(name) {
  if (typeof name !== "string" || !name) return "a colourway needs a name";
  if (name.length > MAX_VARIANT_NAME) return `'${name}' is longer than ${MAX_VARIANT_NAME} characters`;
  if (!VARIANT_NAME_RE.test(name)) {
    return `'${name}' is not a name files can carry — lower-case letters, digits and single hyphens (red-team)`;
  }
  return null;
}

/**
 * One colourway, checked whole: `{ name, map, tolerance? }`, the map's colours
 * lower-cased and kept in the order given — the order a tolerance tie goes by.
 * A tolerance of 0 is exact and is not written; `where` names the entry in
 * every refusal.
 */
export function checkVariant(raw, where = "colourway") {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) refuse(`${where}: expected { "name": …, "map": { "#rrggbb": "#rrggbb" } }`);
  const nameProblem = variantNameProblem(raw.name);
  if (nameProblem) refuse(`${where}: ${nameProblem}`);
  const label = `${where} '${raw.name}'`;
  if (!raw.map || typeof raw.map !== "object" || Array.isArray(raw.map)) {
    refuse(`${label}: 'map' must be an object of "#rrggbb": "#rrggbb" — the colours to change and what they become`);
  }
  const entries = Object.entries(raw.map);
  if (!entries.length) refuse(`${label} has an empty map — name the colours to change ("#3050a0": "#a03030")`);
  const map = {};
  for (const [from, to] of entries) {
    const source = parseHexColor(from);
    const target = parseHexColor(to);
    if (!source) refuse(`${label}: '${from}' is not a #rrggbb colour`);
    if (!target) refuse(`${label}: '${from}' maps to '${to}', which is not a #rrggbb colour`);
    const key = formatHex(source);
    if (key in map) refuse(`${label}: ${key} is mapped twice`);
    map[key] = formatHex(target);
  }
  const tolerance = raw.tolerance === undefined ? 0 : raw.tolerance;
  if (!Number.isInteger(tolerance) || tolerance < 0 || tolerance > MAX_TOLERANCE) {
    refuse(`${label}: tolerance must be a whole number from 0 (exact) to ${MAX_TOLERANCE}, got ${JSON.stringify(raw.tolerance)}`);
  }
  return { name: raw.name, map, ...(tolerance ? { tolerance } : {}) };
}

/**
 * The colourways of a recolor map document (`kind: "pneuma-sprite-recolor"`),
 * checked: at least one, names unique. Every other key (`colors`, `help`, the
 * draft's reading) is the agent's scaffolding and is ignored.
 */
export function parseRecolorMap(doc, where = "recolor map") {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) refuse(`${where}: not a JSON object`);
  if (doc.kind !== RECOLOR_KIND) {
    refuse(`${where}: not a recolor map (kind must be "${RECOLOR_KIND}", got ${JSON.stringify(doc.kind)}) — draft one with recolor-palette`);
  }
  if (!Array.isArray(doc.variants) || !doc.variants.length) {
    refuse(`${where} has no colourways — add { "name": "red-team", "map": { "#rrggbb": "#rrggbb" } } entries to "variants"`);
  }
  const variants = doc.variants.map((raw, i) => checkVariant(raw, `${where}: variants[${i}]`));
  const seen = new Set();
  for (const v of variants) {
    if (seen.has(v.name)) refuse(`${where}: two colourways are named '${v.name}'`);
    seen.add(v.name);
  }
  return variants;
}

/**
 * The same swap: same name, same tolerance, the same entries in the same
 * order. Order counts because a tolerance tie goes to the earlier entry; an
 * exact map that was only reordered reads as changed, which costs one free
 * re-bake and never ships the wrong colours.
 */
export function sameVariant(a, b) {
  return a.name === b.name
    && (a.tolerance ?? 0) === (b.tolerance ?? 0)
    && JSON.stringify(Object.entries(a.map)) === JSON.stringify(Object.entries(b.map));
}

/**
 * The running count of one colourway's bake: pixels per map entry and the
 * colours no entry covered. One tally can be fed many frames (a motion's) and
 * several can be merged (a character's).
 */
export function newTally(variant) {
  const pairs = Object.entries(variant.map).map(([from, to]) => ({ from, to, src: parseHexColor(from), tgt: parseHexColor(to) }));
  return { variant, pairs, hits: new Array(pairs.length).fill(0), uncovered: new Map() };
}

/** Upstream's tolerance rule for one colour: the nearest source within the
 *  Chebyshev window, strict-less so the earlier entry keeps a tie. -1 if none. */
function nearestWithin(r, g, b, pairs, tolerance) {
  let best = -1;
  let bestDistance = Infinity;
  for (let j = 0; j < pairs.length; j++) {
    const [sr, sg, sb] = pairs[j].src;
    const dr = Math.abs(r - sr);
    const dg = Math.abs(g - sg);
    const db = Math.abs(b - sb);
    if (dr > tolerance || dg > tolerance || db > tolerance) continue;
    const distance = dr * dr + dg * dg + db * db;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = j;
    }
  }
  return best;
}

/**
 * One image recoloured into a new buffer — the input is not touched. Only the
 * RGB of pixels above the opaque floor that a map entry covers changes; alpha
 * and every other byte are copied. Counts go into `tally`.
 */
export function recolorImage(image, tally, alphaThreshold = ALPHA_THRESHOLD) {
  const { data } = image;
  const out = new Uint8Array(data);
  const tolerance = tally.variant.tolerance ?? 0;
  const exact = new Map(tally.pairs.map((p, i) => [pack(...p.src), i]));
  const nearest = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] <= alphaThreshold) continue;
    const key = pack(data[i], data[i + 1], data[i + 2]);
    let index;
    if (tolerance === 0) {
      index = exact.get(key) ?? -1;
    } else {
      index = nearest.get(key);
      if (index === undefined) {
        index = nearestWithin(data[i], data[i + 1], data[i + 2], tally.pairs, tolerance);
        nearest.set(key, index);
      }
    }
    if (index < 0) {
      tally.uncovered.set(key, (tally.uncovered.get(key) ?? 0) + 1);
      continue;
    }
    tally.hits[index]++;
    const [r, g, b] = tally.pairs[index].tgt;
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
  }
  return { width: image.width, height: image.height, data: out };
}

/** Several tallies of ONE colourway (a character's motions) as one. */
export function mergeTallies(tallies) {
  if (!tallies.length) refuse("internal: nothing to merge");
  const merged = newTally(tallies[0].variant);
  for (const tally of tallies) {
    if (!sameVariant(tally.variant, merged.variant)) refuse("internal: merging two different colourways");
    tally.hits.forEach((n, i) => {
      merged.hits[i] += n;
    });
    for (const [key, n] of tally.uncovered) merged.uncovered.set(key, (merged.uncovered.get(key) ?? 0) + n);
  }
  return merged;
}

/**
 * What a bake did, said whole: pixels swapped in all, per entry (sorted by
 * source), the entries that matched nothing, and the colours left as they
 * were — the most used first (then by hex), at most `UNCOVERED_CAP` named and
 * the rest counted in `truncated`.
 */
export function tallyReport(tally) {
  const substitutions = tally.pairs
    .map((p, i) => ({ from: p.from, to: p.to, pixels: tally.hits[i] }))
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  const left = [...tally.uncovered].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const top = left.slice(0, UNCOVERED_CAP).map(([key, pixels]) => ({ hex: packedHex(key), pixels }));
  return {
    name: tally.variant.name,
    ...(tally.variant.tolerance ? { tolerance: tally.variant.tolerance } : {}),
    substituted: tally.hits.reduce((a, b) => a + b, 0),
    substitutions,
    unmatched: substitutions.filter((s) => s.pixels === 0).map(({ from, to }) => ({ from, to })),
    uncovered: {
      pixels: left.reduce((a, [, n]) => a + n, 0),
      colors: left.length,
      top,
      ...(left.length > top.length ? { truncated: left.length - top.length } : {}),
    },
  };
}

/** Opaque colours → pixels over some images, added into `into`. */
export function countColors(images, into = new Map(), alphaThreshold = ALPHA_THRESHOLD) {
  for (const { data } of images) {
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] <= alphaThreshold) continue;
      const key = pack(data[i], data[i + 1], data[i + 2]);
      into.set(key, (into.get(key) ?? 0) + 1);
    }
  }
  return into;
}

/** The colours of `counts` that are not in `palette` (`[[r, g, b], …]`):
 *  `{ colors, pixels }`. */
export function offPalette(counts, palette) {
  const known = new Set(palette.map((c) => pack(...c)));
  let colors = 0;
  let pixels = 0;
  for (const [key, n] of counts) {
    if (known.has(key)) continue;
    colors++;
    pixels += n;
  }
  return { colors, pixels };
}

/**
 * The map `recolor-palette` drafts for the agent to fill in: every colour the
 * character's frames use, most used first (then by hex — a total order, so a
 * re-draft is the same file), each with its pixel count, its share, whether
 * the pinned palette has it, and its cell on the swatch sheet; then the
 * palette's colours no frame uses (`pixels: 0`). One colourway is left with an
 * empty map, which `recolor` refuses until it names something. `swatches`
 * names the swatch sheet the numbers refer to.
 */
export function draftRecolorMap({ palette, paletteColors, counts, character, swatches = null }) {
  const inPalette = new Set(paletteColors.map((c) => pack(...c)));
  const used = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const total = used.reduce((a, [, n]) => a + n, 0);
  const unused = [...inPalette].filter((key) => !counts.has(key)).sort((a, b) => a - b);
  return {
    kind: RECOLOR_KIND,
    version: RECOLOR_VERSION,
    character,
    palette,
    ...(swatches ? { swatches } : {}),
    help: "Name each colourway and map only the colours it changes: { \"name\": \"red-team\", \"map\": { \"#3050a0\": \"#a03030\" } }. A colour's `swatch` is its numbered cell on the swatch sheet, where its pixels are marked. Every other colour stays as it is. Add \"tolerance\": N only for soft-edged art.",
    colors: [
      ...used.map(([key, pixels], i) => ({
        hex: packedHex(key),
        pixels,
        share: total ? Math.round((pixels / total) * 1e4) / 1e4 : 0,
        ...(inPalette.has(key) ? {} : { inPalette: false }),
        swatch: i + 1,
      })),
      ...unused.map((key) => ({ hex: packedHex(key), pixels: 0 })),
    ],
    variants: [{ name: "variant-1", map: {} }],
  };
}

// ---------------------------------------------------------------------------
// The swatch sheet: where each colour is
// ---------------------------------------------------------------------------

/** Digits 0–9 as 3 x 5 bitmaps, row by row. */
const DIGITS = [
  "111101101101111", "010110010010111", "111001111100111", "111001111001111", "101101111001001",
  "111100111001111", "111100111101111", "111001001001001", "111101111101111", "111101111001111",
];
/** Candidate marks, the one farthest from every colour on the sheet wins. */
const MARKS = [[255, 0, 255], [0, 229, 255], [0, 255, 0], [255, 234, 0]];
const SHEET_BG = [255, 255, 255];

function fill(image, x, y, w, h, [r, g, b]) {
  for (let yy = Math.max(0, y); yy < Math.min(image.height, y + h); yy++) {
    for (let xx = Math.max(0, x); xx < Math.min(image.width, x + w); xx++) {
      const i = (yy * image.width + xx) * 4;
      image.data[i] = r;
      image.data[i + 1] = g;
      image.data[i + 2] = b;
      image.data[i + 3] = 255;
    }
  }
}

function drawNumber(image, n, x, y, scale, color) {
  let cx = x;
  for (const ch of String(n)) {
    const bits = DIGITS[Number(ch)];
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 3; col++) {
        if (bits[row * 3 + col] === "1") fill(image, cx + col * scale, y + row * scale, scale, scale, color);
      }
    }
    cx += 4 * scale;
  }
}

/** The opaque bbox of an image, or null. */
function opaqueBox({ width, height, data }, alphaThreshold) {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] <= alphaThreshold) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * A picture of where each colour is, for an agent choosing what to swap: one
 * numbered cell per entry (`{ rgb, image }`, the image being the frame that
 * uses the colour most), the frame drawn faded and the colour's pixels in a
 * mark colour none of the colours is near; beside the number, a square of the
 * colour itself. Cells are one size (the largest sprite, scaled by a whole
 * number to about `cellHeight`), `cols` to a row.
 */
export function swatchSheet(entries, { cellHeight = 144, cols = 8, alphaThreshold = ALPHA_THRESHOLD } = {}) {
  if (!entries.length) refuse("internal: no colours to draw");
  const boxes = entries.map((e) => opaqueBox(e.image, alphaThreshold));
  const maxW = Math.max(1, ...boxes.map((b) => (b ? b.w : 1)));
  const maxH = Math.max(1, ...boxes.map((b) => (b ? b.h : 1)));
  const s = Math.max(1, Math.min(8, Math.floor(cellHeight / maxH)));
  const digit = 2;
  const label = 5 * digit + 6;
  const pad = 4;
  const cellW = Math.max(maxW * s, 12 + 4 * digit * String(entries.length).length + 8) + 2 * pad;
  const cellH = label + maxH * s + 2 * pad;
  const columns = Math.min(cols, entries.length);
  const rows = Math.ceil(entries.length / columns);
  const sheet = { width: columns * cellW, height: rows * cellH, data: new Uint8Array(columns * cellW * rows * cellH * 4) };
  fill(sheet, 0, 0, sheet.width, sheet.height, SHEET_BG);

  const distance = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  const mark = MARKS
    .map((m) => ({ m, near: Math.min(...entries.map((e) => distance(m, e.rgb))) }))
    .sort((a, b) => b.near - a.near)[0].m;

  entries.forEach((entry, n) => {
    const ox = (n % columns) * cellW;
    const oy = Math.floor(n / columns) * cellH;
    // Grid lines, so a cell reads as one.
    fill(sheet, ox, oy + cellH - 1, cellW, 1, [220, 220, 220]);
    fill(sheet, ox + cellW - 1, oy, 1, cellH, [220, 220, 220]);
    // The colour itself, bordered, then its number.
    fill(sheet, ox + pad, oy + pad, 12, 12, [0, 0, 0]);
    fill(sheet, ox + pad + 1, oy + pad + 1, 10, 10, entry.rgb);
    drawNumber(sheet, n + 1, ox + pad + 16, oy + pad + 1, digit, [0, 0, 0]);
    const box = boxes[n];
    if (!box) return;
    const { image } = entry;
    const target = pack(...entry.rgb);
    const left = ox + pad + Math.floor((maxW - box.w) * s / 2);
    const top = oy + label + pad + (maxH - box.h) * s;
    for (let y = 0; y < box.h; y++) {
      for (let x = 0; x < box.w; x++) {
        const i = ((box.y + y) * image.width + box.x + x) * 4;
        if (image.data[i + 3] <= alphaThreshold) continue;
        const rgb = [image.data[i], image.data[i + 1], image.data[i + 2]];
        // The rest of the sprite faded toward white, so the mark is what the eye finds.
        const color = pack(...rgb) === target ? mark : rgb.map((v) => Math.round(v + (255 - v) * 0.6));
        fill(sheet, left + x * s, top + y * s, s, s, color);
      }
    }
  });
  return { image: sheet, mark: formatHex(mark), cell: { width: cellW, height: cellH }, scale: s };
}

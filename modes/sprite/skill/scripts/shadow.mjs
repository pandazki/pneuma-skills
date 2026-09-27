/**
 * shadow.mjs — a ground shadow cast from a sprite's own silhouette.
 *
 * Ported from aldegad/sprite-gen (Apache-2.0) sprite_gen/effects/shadow.py@fbd1a08:
 * the alpha silhouette projected about the stationary foot anchor —
 * x' = x + shear·(y − ay), y' = ay + squash·(y − ay) — sampled through the
 * inverse map with Pillow's bicubic kernel, blurred, and multiplied by the
 * opacity last; the canvas bounds come from the whole image rectangle (never a
 * per-frame alpha box, so every frame of a motion gets the same canvas) plus
 * ceil(4·blur) + 3 px of margin; the defaults squash 0.25, shear 0.8,
 * opacity 0.4, blur 3 and colour (20, 15, 30), and the parameter ranges.
 * Changes: plain JS over a decoded RGBA buffer instead of Pillow; the blur is
 * a true separable Gaussian (σ = blur) where Pillow approximates one with
 * three extended box passes; a transparent source is read as zero outside its
 * edges instead of padding it by 2 px; compositing the shadow under the sprite
 * (`withShadow`) is ours — upstream publishes the shadow on its own.
 *
 * Positive shear throws the shadow to the LEFT of the feet (light from the
 * upper right); squash is how long it is against the figure's height.
 *
 * No dependencies beyond `drift.mjs`'s rounding, no I/O: pixels in, pixels
 * out. `sprite-sheet.mjs export --shadow` decodes and encodes around it.
 */

import { roundHalfEven } from "./drift.mjs";

/** Upstream's defaults, unchanged. */
export const SHADOW_DEFAULTS = Object.freeze({
  squash: 0.25,
  shear: 0.8,
  opacity: 0.4,
  blur: 3,
  color: Object.freeze([20, 15, 30]),
});

/** Upstream's ranges: [low, high] per parameter. */
export const SHADOW_RANGES = Object.freeze({
  squash: [0.001, 1],
  shear: [-16, 16],
  opacity: [0, 1],
  blur: [0, 128],
});

const MAX_DIMENSION = 65_536;
const MAX_PIXELS = 16_777_216;

/**
 * The options, completed with the defaults and checked against the ranges.
 * Throws a `RangeError` naming the parameter; the CLI turns it into `ERROR:`.
 */
export function shadowOptions(given = {}) {
  const out = {};
  for (const name of ["squash", "shear", "opacity", "blur"]) {
    const value = given[name] ?? SHADOW_DEFAULTS[name];
    const [low, high] = SHADOW_RANGES[name];
    if (typeof value !== "number" || !Number.isFinite(value) || value < low || value > high) {
      throw new RangeError(`shadow ${name}: expected a number from ${low} to ${high}, got ${String(value)}`);
    }
    out[name] = value;
  }
  const color = given.color ?? SHADOW_DEFAULTS.color;
  if (!Array.isArray(color) || color.length !== 3 || color.some((c) => !Number.isInteger(c) || c < 0 || c > 255)) {
    throw new RangeError(`shadow color: expected three whole numbers from 0 to 255, got ${JSON.stringify(color)}`);
  }
  out.color = [...color];
  return out;
}

function checkSize(width, height) {
  if (!(width > 0 && height > 0) || Math.max(width, height) > MAX_DIMENSION || width * height > MAX_PIXELS) {
    throw new RangeError(`shadow canvas ${width}x${height} is past the supported size (sides ≤ ${MAX_DIMENSION}, ≤ ${MAX_PIXELS} pixels)`);
  }
}

/**
 * Where the shadow of a `width`×`height` image about `anchor` lands, in that
 * image's pixel coordinates: the canvas rectangle `{ left, top, width, height }`
 * and the anchor inside it. Depends only on the size, the anchor and the
 * options — every frame of one motion gets the same answer.
 */
export function shadowGeometry(width, height, anchor, options) {
  checkSize(width, height);
  const { squash, shear, blur } = options;
  const { x: ax, y: ay } = anchor;
  if (!Number.isFinite(ax) || !Number.isFinite(ay)) throw new RangeError("shadow anchor: expected two finite pixel coordinates");
  // The whole rectangle, two pixels past each edge (the bicubic kernel's
  // reach), plus the anchor itself so an anchor outside the frame still fits.
  const xs = [ax];
  const ys = [ay];
  for (const y of [-2, height + 2]) {
    ys.push(ay + squash * (y - ay));
    for (const x of [-2, width + 2]) xs.push(x + shear * (y - ay));
  }
  const padding = Math.ceil(4 * blur) + 3;
  const left = Math.floor(Math.min(...xs)) - padding;
  const top = Math.floor(Math.min(...ys)) - padding;
  const right = Math.ceil(Math.max(...xs)) + padding;
  const bottom = Math.ceil(Math.max(...ys)) + padding;
  checkSize(right - left, bottom - top);
  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
    anchor: { x: ax - left, y: ay - top },
  };
}

/** Pillow's bicubic step (libImaging/Geometry.c `BICUBIC`), so the port samples
 *  the silhouette the way upstream's `Image.transform(..., BICUBIC)` does. */
function cubic(v1, v2, v3, v4, d) {
  const p2 = -v1 + v3;
  const p3 = 2 * (v1 - v2) + v3 - v4;
  const p4 = -v1 + v2 - v3 + v4;
  return v2 + d * (p2 + d * (p3 + d * p4));
}

/** Separable Gaussian, σ = `sigma`, over a Float32 plane in place. */
function gaussianBlur(plane, width, height, sigma) {
  if (!(sigma > 0)) return plane;
  const radius = Math.max(1, Math.ceil(3 * sigma));
  const kernel = new Float32Array(2 * radius + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + radius] = w;
    sum += w;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
  const tmp = new Float32Array(plane.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let acc = 0;
      const k0 = Math.max(-radius, -x);
      const k1 = Math.min(radius, width - 1 - x);
      for (let k = k0; k <= k1; k++) acc += plane[row + x + k] * kernel[k + radius];
      tmp[row + x] = acc;
    }
  }
  for (let y = 0; y < height; y++) {
    const k0 = Math.max(-radius, -y);
    const k1 = Math.min(radius, height - 1 - y);
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = k0; k <= k1; k++) acc += tmp[(y + k) * width + x] * kernel[k + radius];
      plane[y * width + x] = acc;
    }
  }
  return plane;
}

/**
 * The shadow of one RGBA image (`{ width, height, data }`, straight alpha)
 * about `anchor` (pixels): a new RGBA image in the shadow's colour, and the
 * anchor inside it. Place that anchor on the sprite's own anchor.
 * The source is not modified.
 */
export function projectShadow(image, anchor, given = {}) {
  const options = shadowOptions(given);
  const geometry = shadowGeometry(image.width, image.height, anchor, options);
  const { width, height, left, top } = geometry;
  const { squash, shear, opacity, blur, color } = options;
  const ay = anchor.y;
  const src = image.data;
  const sw = image.width;
  const sh = image.height;
  const alphaAt = (x, y) => (x < 0 || y < 0 || x >= sw || y >= sh ? 0 : src[(y * sw + x) * 4 + 3]);

  // The rows of the canvas a source row can reach: everything else is zero,
  // and skipping it is most of the canvas (squash 0.25 keeps a quarter).
  const yTop = Math.max(0, Math.floor(ay + squash * (-2 - ay)) - top - 1);
  const yBottom = Math.min(height - 1, Math.ceil(ay + squash * (sh + 2 - ay)) - top + 1);

  const plane = new Float32Array(width * height);
  for (let Y = yTop; Y <= yBottom; Y++) {
    // Inverse map at the pixel centre, in edge-based source coordinates.
    const sy = ay + (Y + 0.5 + top - ay) / squash;
    const v = sy - 0.5;
    const y0 = Math.floor(v);
    const dy = v - y0;
    if (y0 + 2 < 0 || y0 - 1 >= sh) continue;
    const xShift = left - shear * (Y + 0.5 + top - ay) / squash;
    for (let X = 0; X < width; X++) {
      const u = X + 0.5 + xShift - 0.5;
      const x0 = Math.floor(u);
      if (x0 + 2 < 0 || x0 - 1 >= sw) continue;
      const dx = u - x0;
      const r1 = cubic(alphaAt(x0 - 1, y0 - 1), alphaAt(x0, y0 - 1), alphaAt(x0 + 1, y0 - 1), alphaAt(x0 + 2, y0 - 1), dx);
      const r2 = cubic(alphaAt(x0 - 1, y0), alphaAt(x0, y0), alphaAt(x0 + 1, y0), alphaAt(x0 + 2, y0), dx);
      const r3 = cubic(alphaAt(x0 - 1, y0 + 1), alphaAt(x0, y0 + 1), alphaAt(x0 + 1, y0 + 1), alphaAt(x0 + 2, y0 + 1), dx);
      const r4 = cubic(alphaAt(x0 - 1, y0 + 2), alphaAt(x0, y0 + 2), alphaAt(x0 + 1, y0 + 2), alphaAt(x0 + 2, y0 + 2), dx);
      const value = cubic(r1, r2, r3, r4, dy);
      // Pillow's 8-bit sampler clips and truncates.
      plane[Y * width + X] = value <= 0 ? 0 : value >= 255 ? 255 : Math.trunc(value);
    }
  }
  gaussianBlur(plane, width, height, blur);

  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < plane.length; i++) {
    const o = i * 4;
    data[o] = color[0];
    data[o + 1] = color[1];
    data[o + 2] = color[2];
    // Opacity last, on the 8-bit blurred alpha, as upstream's lookup table
    // (`round(value * opacity)`, Python's round: halves to even — at opacity
    // 0.5 every odd alpha is a tie, and Math.round lifted each by one).
    const a = Math.min(255, Math.max(0, Math.round(plane[i])));
    data[o + 3] = roundHalfEven(a * opacity);
  }
  return { width, height, data, anchor: geometry.anchor };
}

/** `src` drawn over `dst` at (dx, dy), straight alpha, in place. */
export function drawOver(dst, src, dx, dy) {
  for (let y = 0; y < src.height; y++) {
    const ty = y + dy;
    if (ty < 0 || ty >= dst.height) continue;
    for (let x = 0; x < src.width; x++) {
      const tx = x + dx;
      if (tx < 0 || tx >= dst.width) continue;
      const s = (y * src.width + x) * 4;
      const sa = src.data[s + 3];
      if (sa === 0) continue;
      const d = (ty * dst.width + tx) * 4;
      const da = dst.data[d + 3];
      if (sa === 255 || da === 0) {
        dst.data[d] = src.data[s];
        dst.data[d + 1] = src.data[s + 1];
        dst.data[d + 2] = src.data[s + 2];
        dst.data[d + 3] = sa;
        continue;
      }
      const a = sa / 255;
      const b = (da / 255) * (1 - a);
      const out = a + b;
      for (let c = 0; c < 3; c++) {
        dst.data[d + c] = Math.round((src.data[s + c] * a + dst.data[d + c] * b) / out);
      }
      dst.data[d + 3] = Math.round(out * 255);
    }
  }
  return dst;
}

/**
 * The canvas a frame and its shadow share: the union of the frame
 * `[0, width) × [0, height)` and the shadow's rectangle, with where the frame
 * sits in it. Same for every frame of a motion.
 */
export function shadowCanvas(width, height, anchor, given = {}) {
  const options = shadowOptions(given);
  const geometry = shadowGeometry(width, height, anchor, options);
  const x0 = Math.min(0, geometry.left);
  const y0 = Math.min(0, geometry.top);
  const x1 = Math.max(width, geometry.left + geometry.width);
  const y1 = Math.max(height, geometry.top + geometry.height);
  return {
    width: x1 - x0,
    height: y1 - y0,
    /** Where the frame's top-left lands on the canvas. */
    frame: { x: -x0, y: -y0 },
    /** Where the shadow's top-left lands on the canvas. */
    shadow: { x: geometry.left - x0, y: geometry.top - y0 },
    /** The foot anchor on the canvas. */
    anchor: { x: anchor.x - x0, y: anchor.y - y0 },
  };
}

/**
 * One frame with its shadow under it, on the canvas `shadowCanvas` names.
 * The frame's own pixels are drawn last and unchanged.
 */
export function withShadow(image, anchor, given = {}) {
  const canvas = shadowCanvas(image.width, image.height, anchor, given);
  const out = { width: canvas.width, height: canvas.height, data: Buffer.alloc(canvas.width * canvas.height * 4) };
  const shadow = projectShadow(image, anchor, given);
  drawOver(out, shadow, canvas.shadow.x, canvas.shadow.y);
  drawOver(out, image, canvas.frame.x, canvas.frame.y);
  return { ...out, anchor: canvas.anchor, frame: canvas.frame };
}

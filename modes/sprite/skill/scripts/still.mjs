/**
 * still.mjs — the one picture a breathe is made from, at the size it plays.
 *
 * Route A ("bring my picture to life") starts from whatever the user uploaded:
 * a 1024×1536 illustration whose character fills a third of the canvas, a
 * phone photo of a drawing, a cut-out with a stray speck in a corner. The
 * breathe bake keeps the still's canvas (`--x-from cell` then keeps every
 * frame where it stands), so an untrimmed upload becomes a 1024-px-wide cell
 * around a 400-px character, and a 1300-px character becomes a 1300-px sprite
 * nobody ships. `fitStill` trims the cut-out to its content plus a margin and
 * brings the character's larger side down to a limit, BEFORE the still is
 * registered — so the reference in the rail is exactly the picture the frames
 * were warped from, and every coordinate the breathe report prints (the rigid
 * row, the axis) is a pixel of that file.
 *
 * Downscaling is area-weighted in premultiplied alpha: a background remover
 * leaves the original background's colour under alpha 0, and resampling
 * straight RGB would bleed it into the edge as a halo. Pixel art is never
 * resampled (the caller says so): it is trimmed only.
 *
 * Pure module: RGBA buffers in, RGBA buffers out, Node built-ins only.
 * `sprite-sheet.mjs fit` decodes, cleans, measures, writes and reports.
 */

/** The character's larger side after `fit`, in px. With the default pad and a
 *  breathe's stretch (a few px at depth 0.02) the breathing cell stays within
 *  512 px, the size route A promises. */
export const DEFAULT_FIT_MAX = 480;
/** Transparent margin around the character, in px of the fitted still. */
export const DEFAULT_FIT_PAD = 8;

/** A refusal this module knows how to phrase. The CLI prints its message. */
export class StillError extends Error {}

function blank(width, height) {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

/** A copy of `image` inside `box` ({x, y, w, h}, end-exclusive by w/h). */
export function cropRgba(image, box) {
  const out = blank(box.w, box.h);
  for (let y = 0; y < box.h; y++) {
    const from = ((box.y + y) * image.width + box.x) * 4;
    out.data.set(image.data.subarray(from, from + box.w * 4), y * box.w * 4);
  }
  return out;
}

/** `image` centred in `pad` px of transparency on every side. */
export function padRgba(image, pad) {
  const out = blank(image.width + 2 * pad, image.height + 2 * pad);
  for (let y = 0; y < image.height; y++) {
    out.data.set(image.data.subarray(y * image.width * 4, (y + 1) * image.width * 4), ((y + pad) * out.width + pad) * 4);
  }
  return out;
}

/**
 * Area-resample one axis of a premultiplied float image. Source cell i covers
 * [i·s, (i+1)·s) of the output axis (s = outCount / inCount), and every output
 * pixel is the coverage-weighted sum of the cells over it — for a reduction
 * the weights of one output pixel sum to 1, so it is the mean of the area it
 * covers.
 */
function resampleAxis(src, width, height, outCount, horizontal) {
  const inCount = horizontal ? width : height;
  const s = outCount / inCount;
  const outW = horizontal ? outCount : width;
  const outH = horizontal ? height : outCount;
  const dst = new Float64Array(outW * outH * 4);
  const lines = horizontal ? height : width;
  for (let line = 0; line < lines; line++) {
    for (let i = 0; i < inCount; i++) {
      const si = horizontal ? (line * width + i) * 4 : (i * width + line) * 4;
      if (src[si + 3] === 0) continue;
      const a = i * s, b = (i + 1) * s;
      for (let p = Math.floor(a); p < b && p < outCount; p++) {
        const overlap = Math.min(b, p + 1) - Math.max(a, p);
        if (overlap <= 0) continue;
        const di = horizontal ? (line * outW + p) * 4 : (p * outW + line) * 4;
        dst[di] += src[si] * overlap;
        dst[di + 1] += src[si + 1] * overlap;
        dst[di + 2] += src[si + 2] * overlap;
        dst[di + 3] += src[si + 3] * overlap;
      }
    }
  }
  return dst;
}

/**
 * `image` reduced to `width`×`height` by area averaging in premultiplied
 * alpha. Only reductions: an enlargement would invent pixels, which is not
 * what fitting a still is for.
 */
export function downscaleArea(image, width, height) {
  if (!(Number.isInteger(width) && Number.isInteger(height) && width >= 1 && height >= 1)) {
    throw new StillError(`target size must be whole pixels >= 1, got ${width}x${height}`);
  }
  if (width > image.width || height > image.height) {
    throw new StillError(`downscaleArea only reduces: ${image.width}x${image.height} → ${width}x${height}`);
  }
  const n = image.width * image.height;
  const pre = new Float64Array(n * 4);
  for (let k = 0; k < n; k++) {
    const a = image.data[k * 4 + 3];
    if (!a) continue;
    pre[k * 4] = (image.data[k * 4] * a) / 255;
    pre[k * 4 + 1] = (image.data[k * 4 + 1] * a) / 255;
    pre[k * 4 + 2] = (image.data[k * 4 + 2] * a) / 255;
    pre[k * 4 + 3] = a;
  }
  const across = resampleAxis(pre, image.width, image.height, width, true);
  const down = resampleAxis(across, width, image.height, height, false);
  const out = blank(width, height);
  const clamp = (v) => (v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v));
  for (let k = 0; k < width * height; k++) {
    const a = down[k * 4 + 3];
    const alpha = clamp(a);
    // Colour under alpha 0 stays 0: nothing to bleed the next time anything
    // rescales this picture.
    if (!alpha) continue;
    out.data[k * 4] = clamp((down[k * 4] * 255) / a);
    out.data[k * 4 + 1] = clamp((down[k * 4 + 1] * 255) / a);
    out.data[k * 4 + 2] = clamp((down[k * 4 + 2] * 255) / a);
    out.data[k * 4 + 3] = alpha;
  }
  return out;
}

/**
 * The still, trimmed to `box` (the character, measured by the caller) plus
 * `pad`, with the character's larger side brought down to `max` when it is
 * longer and `resample` allows it. Never enlarges.
 *
 * Returns the image, the factor it was resampled by (1 = not resampled), the
 * factor it WOULD have needed (`needed`, < 1 when the character is over `max`)
 * and the character's size in the fitted still.
 */
export function fitStill(image, { box, max = DEFAULT_FIT_MAX, pad = DEFAULT_FIT_PAD, resample = true }) {
  if (!box || box.w < 1 || box.h < 1) throw new StillError("nothing visible to fit");
  if (!(Number.isInteger(max) && max >= 8)) throw new StillError(`max must be a whole number of px >= 8, got ${max}`);
  if (!(Number.isInteger(pad) && pad >= 0)) throw new StillError(`pad must be a whole number of px >= 0, got ${pad}`);
  const longest = Math.max(box.w, box.h);
  const needed = longest > max ? max / longest : 1;
  const scale = resample ? needed : 1;
  const crop = cropRgba(image, box);
  const character = scale < 1
    ? downscaleArea(crop, Math.max(1, Math.round(box.w * scale)), Math.max(1, Math.round(box.h * scale)))
    : crop;
  return {
    image: padRgba(character, pad),
    scale,
    needed,
    character: { width: character.width, height: character.height },
  };
}

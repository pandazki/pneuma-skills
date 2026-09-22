#!/usr/bin/env node
/**
 * Synthetic sprite-sheet builder for the pipeline tests.
 *
 * Zero fixtures on disk: every sheet the suite needs is drawn by ffmpeg at
 * test time, so the repo carries no binary blobs and the tests exercise the
 * same decode path as production.
 *
 * ffmpeg gotcha this file exists to encode: `drawbox` alpha-blends by
 * default and leaves the *alpha* plane untouched, so drawing an opaque box
 * onto `color=black@0` yields a fully transparent image. `replace=1` is what
 * makes drawbox overwrite colour AND alpha. Without it the whole fixture is
 * invisible and every bbox assertion reads "empty frame".
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

/** Cell offsets of the drawn square, in cell-local pixels, per grid cell. */
export const SQUARE = { w: 30, h: 30 };
export const CELL_OFFSETS = [
  { x: 10, y: 20, color: "red" },
  { x: 10, y: 24, color: "orange" },
  { x: 18, y: 24, color: "blue" },
  { x: 16, y: 28, color: "purple" },
];

function drawboxes({ cell, cols, filled, squares = CELL_OFFSETS }) {
  return filled
    .map((index) => {
      const square = squares[index % squares.length];
      const col = index % cols;
      const row = Math.floor(index / cols);
      const x = col * cell + square.x;
      const y = row * cell + square.y;
      return `drawbox=x=${x}:y=${y}:w=${SQUARE.w}:h=${SQUARE.h}:color=${square.color}@1:t=fill:replace=1`;
    })
    .join(",");
}

/**
 * Build an N x M sheet. `background` is any ffmpeg colour expression;
 * `black@0` yields a transparent sheet, `0x00b140` an opaque green one.
 * `cells` selects which grid cells get a square (default: all).
 */
export function buildSheet(outPath, {
  cell = 64,
  rows = 2,
  cols = 2,
  background = "black@0",
  cells = null,
  extras = [],
  squares = CELL_OFFSETS,
} = {}) {
  const total = rows * cols;
  const filled = cells ?? Array.from({ length: total }, (_, i) => i);
  const boxes = drawboxes({ cell, cols, filled, squares });
  // Extra boxes in cell-local coordinates — a stray limb that widens one
  // frame's bbox without moving the body, which is what --smooth is for.
  const extraBoxes = extras
    .map(({ index, x, y, w, h, color = "white" }) => {
      const px = (index % cols) * cell + x;
      const py = Math.floor(index / cols) * cell + y;
      return `drawbox=x=${px}:y=${py}:w=${w}:h=${h}:color=${color}@1:t=fill:replace=1`;
    })
    .join(",");
  const chain = [`color=c=${background}:s=${cols * cell}x${rows * cell}`, "format=rgba", boxes, extraBoxes]
    .filter(Boolean)
    .join(",");
  mkdirSync(dirname(outPath), { recursive: true });
  const r = spawnSync(
    "ffmpeg",
    ["-v", "error", "-y", "-f", "lavfi", "-i", chain, "-frames:v", "1", "-pix_fmt", "rgba", "--", outPath],
    { encoding: "utf-8" },
  );
  if (r.status !== 0) {
    throw new Error(`fixture ffmpeg failed: ${r.stderr ?? r.error?.message ?? "unknown"}`);
  }
  return outPath;
}

/**
 * Decode any image to RGBA and hand back the raw buffer plus its size — the
 * one decode `readBbox` and `readColorBbox` both measure on.
 */
function decode(path) {
  const probe = spawnSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", path],
    { encoding: "utf-8" },
  );
  if (probe.status !== 0) throw new Error(`ffprobe failed for ${path}`);
  const [width, height] = String(probe.stdout).trim().split(",").map(Number);
  const r = spawnSync(
    "ffmpeg",
    ["-v", "error", "-i", path, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "-"],
    { maxBuffer: 256 * 1024 * 1024 },
  );
  if (r.status !== 0) throw new Error(`ffmpeg decode failed for ${path}`);
  return { width, height, data: r.stdout };
}

/** Bbox of every pixel a predicate accepts, in the script's own convention. */
function bboxWhere({ width, height, data }, accept) {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1, count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (!accept(data[i], data[i + 1], data[i + 2], data[i + 3])) continue;
      count++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return {
    width,
    height,
    coverage: count / (width * height),
    bbox: count ? { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } : null,
  };
}

/** Decode any image to RGBA and report its alpha bbox — the tests' eyes. */
export function readBbox(path, threshold = 16) {
  return bboxWhere(decode(path), (_r, _g, _b, a) => a >= threshold);
}

/**
 * The bbox of one exact colour. A prop-carrying fixture draws the body and the
 * prop in different colours, so this measures where the BODY ended up without
 * the test having to re-implement the feet-band arithmetic it is checking —
 * which would only prove the script agrees with itself.
 */
export function readColorBbox(path, hex, threshold = 16) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) throw new Error(`readColorBbox: expected #rrggbb, got '${hex}'`);
  const [wr, wg, wb] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  return bboxWhere(decode(path), (r, g, b, a) => a >= threshold && r === wr && g === wg && b === wb);
}

/**
 * What colour survives *under* the alpha, and what survives above it.
 *
 * `readBbox` cannot see this: it reads the alpha plane and nothing else, which
 * is exactly the blind spot the defect lived in — ffmpeg's `colorkey` writes
 * alpha and leaves the plate's RGB in place, so a keyed sheet measures
 * perfectly while still carrying a full green plate for any bilinear resize or
 * alpha-ignoring importer to bleed back out.
 *
 * `hiddenColors` is the distinct `r,g,b` of every pixel BELOW the threshold —
 * `["0,0,0"]` is the only acceptable answer for a keyed image, and the green
 * shows up by name when it is not. `opaqueBlack` is the counterpart guard: a
 * fix that zeroed too much would erase the character and leave this non-zero.
 */
export function alphaColorAudit(path, threshold = 16) {
  const { width, height, data } = decode(path);
  const hiddenColors = new Set();
  let hidden = 0;
  let opaque = 0;
  let opaqueBlack = 0;
  for (let i = 0; i < width * height * 4; i += 4) {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    if (data[i + 3] >= threshold) {
      opaque++;
      if (r === 0 && g === 0 && b === 0) opaqueBlack++;
      continue;
    }
    hidden++;
    hiddenColors.add(`${r},${g},${b}`);
  }
  return { width, height, hidden, opaque, opaqueBlack, hiddenColors: [...hiddenColors].sort() };
}

/**
 * A short clip of one square breathing up and down on a chroma-green plate —
 * the video fixture `from-video` samples and `contact` reads the rhythm of.
 *
 * Encoded h264 / yuv420p on purpose: chroma subsampling and quantisation mean
 * the green that comes back off the decoder is never exactly the green that
 * went in, which is the whole reason the video keyer needs a wider similarity
 * than a flat generated sheet does.
 *
 * The box is moved by `overlay`, not by `drawbox`. That is the second ffmpeg
 * gotcha this file exists to encode: **`drawbox` evaluates its `x`/`y`
 * expressions once, at config time** (measured on ffmpeg 8.0 — every frame of
 * a `drawbox=y=17+8*sin(2*PI*t)` clip came back byte-identical, max
 * consecutive delta 0 over 20 frames). The clip looked like it was breathing
 * and was in fact a still image, which no `from-video` assertion could see.
 * `overlay` defaults to `eval=frame`, so its `y` really is a function of `t`.
 *
 * `amplitude` is the sine's half-travel in px and `holdSeconds` is how long
 * the opening pose is held before it starts — the two knobs `contact`'s
 * still-start and loop detection are measured against.
 */
export function buildClip(outPath, {
  width = 64,
  height = 64,
  seconds = 2,
  fps = 10,
  background = "0x00b140",
  box = { x: 22, y: 17, w: 20, h: 20, color: "red" },
  amplitude = 2,
  holdSeconds = 0,
} = {}) {
  // A comma inside a filter option value has to be escaped, or the filtergraph
  // parser reads it as the start of the next filter.
  const sine = `${box.y}+${amplitude}*sin(2*PI*(t-${holdSeconds}))`;
  const y = holdSeconds > 0
    ? `if(gte(t\\,${holdSeconds})\\,${sine}\\,${box.y})`
    : `${box.y}+${amplitude}*sin(2*PI*t)`;
  const chain = [
    `color=c=${background}:s=${width}x${height}:d=${seconds}:r=${fps}[bg]`,
    `color=c=${box.color}:s=${box.w}x${box.h}:d=${seconds}:r=${fps}[box]`,
    `[bg][box]overlay=x=${box.x}:y=${y}`,
  ].join(";");
  mkdirSync(dirname(outPath), { recursive: true });
  const r = spawnSync(
    "ffmpeg",
    ["-v", "error", "-y", "-f", "lavfi", "-i", chain,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", "--", outPath],
    { encoding: "utf-8" },
  );
  if (r.status !== 0) {
    throw new Error(`fixture ffmpeg failed: ${r.stderr ?? r.error?.message ?? "unknown"}`);
  }
  return outPath;
}

/** Encoders `buildExprClip` can write, by name. */
export const CLIP_ENCODERS = {
  /** What a model returns: 8-bit, no alpha, chroma-subsampled. */
  h264: ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-an"],
  /** What a matting endpoint returns: an alpha plane in the clip itself. */
  prores4444: ["-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", "-an"],
};

/**
 * A clip of one box whose position is any expression in `t`.
 *
 * `buildClip` is the breathing fixture the sampling commands are pinned on;
 * this is its general form, for the loop cases that need a named number of
 * frames (the 24 fps / 122-frame clip whose last PTS is 121/24), a motion that
 * freezes, a motion that never returns, or a clip that carries its own alpha.
 *
 * The box is moved by `overlay`, never by `drawbox`: drawbox evaluates its
 * `x`/`y` once at config time, so a "moving" drawbox fixture is a still image
 * with a duration (see `buildClip`). Commas inside an expression are escaped
 * here, so a caller writes `if(lt(t,0.5),24,40)` as it would read it.
 */
export function buildExprClip(outPath, {
  width = 64,
  height = 64,
  fps = 24,
  frames = 24,
  background = "0x00b140",
  box = { w: 16, h: 16, color: "red" },
  x = "24",
  y = "24",
  encode = "h264",
} = {}) {
  const seconds = frames / fps;
  const esc = (value) => String(value).replace(/,/g, "\\,");
  const chain = [
    `color=c=${background}:s=${width}x${height}:d=${seconds}:r=${fps},format=rgba[bg]`,
    `color=c=${box.color}:s=${box.w}x${box.h}:d=${seconds}:r=${fps},format=rgba[box]`,
    `[bg][box]overlay=x=${esc(x)}:y=${esc(y)}:format=auto`,
  ].join(";");
  mkdirSync(dirname(outPath), { recursive: true });
  const r = spawnSync(
    "ffmpeg",
    ["-v", "error", "-y", "-f", "lavfi", "-i", chain, ...CLIP_ENCODERS[encode], "--", outPath],
    { encoding: "utf-8" },
  );
  if (r.status !== 0) {
    throw new Error(`fixture ffmpeg failed: ${r.stderr ?? r.error?.message ?? "unknown"}`);
  }
  return outPath;
}

/**
 * Max |Δ| between consecutive frames of a clip, as 0..255 luma at a small
 * analysis size.
 *
 * The judgement the drawbox gotcha earned: any fixture that argues "every
 * frame is different" gets measured once before anything is asserted on it.
 * A silent still image is what made the first video suite pass for a release.
 */
export function clipFrameDeltas(path, width = 48) {
  const probe = spawnSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", path],
    { encoding: "utf-8" },
  );
  if (probe.status !== 0) throw new Error(`ffprobe failed for ${path}`);
  const [w, h] = String(probe.stdout).trim().split(",").map(Number);
  const height = Math.max(2, 2 * Math.round((h * width) / w / 2));
  const r = spawnSync(
    "ffmpeg",
    ["-v", "error", "-i", path, "-vf", `scale=${width}:${height}`, "-f", "rawvideo", "-pix_fmt", "gray", "-"],
    { maxBuffer: 256 * 1024 * 1024 },
  );
  if (r.status !== 0) throw new Error(`ffmpeg decode failed for ${path}`);
  const frameBytes = width * height;
  const count = Math.floor(r.stdout.length / frameBytes);
  const deltas = [];
  for (let i = 0; i + 1 < count; i++) {
    let max = 0;
    for (let p = 0; p < frameBytes; p++) {
      const d = Math.abs(r.stdout[i * frameBytes + p] - r.stdout[(i + 1) * frameBytes + p]);
      if (d > max) max = d;
    }
    deltas.push(max);
  }
  return deltas;
}

/**
 * A clip of pure temporal noise — the one fixture whose FRAMES ARE BIG.
 *
 * Every other clip here draws a flat plate with a box on it, which a PNG
 * encoder compresses to a few kilobytes however large the canvas is. The
 * export-size warnings are about deliverables a browser has to download or
 * parse, and nothing made of flat colour ever reaches that size: 15 frames of
 * 600x512 noise come back as ~900 KB of PNG each, which is what puts a Lottie
 * and an APNG over their limits without a 400-frame run.
 */
export function buildNoiseClip(outPath, {
  width = 600,
  height = 512,
  fps = 24,
  frames = 15,
  level = 100,
} = {}) {
  mkdirSync(dirname(outPath), { recursive: true });
  const chain = [
    `color=c=0x808080:s=${width}x${height}:d=${frames / fps}:r=${fps}`,
    `noise=alls=${level}:allf=t+u`,
    "format=yuv420p",
  ].join(",");
  const r = spawnSync(
    "ffmpeg",
    ["-v", "error", "-y", "-f", "lavfi", "-i", chain,
      "-c:v", "libx264", "-crf", "10", "-pix_fmt", "yuv420p", "--", outPath],
    { encoding: "utf-8" },
  );
  if (r.status !== 0) {
    throw new Error(`fixture ffmpeg failed: ${r.stderr ?? r.error?.message ?? "unknown"}`);
  }
  return outPath;
}

/**
 * Where the subject sits in each frame of a clip: the mean x of every pixel
 * that is not the plate, in analysis pixels, one number per frame.
 *
 * `retime` claims to replay a clip's own frames in the order it was handed.
 * H.264 is lossy, so a written frame cannot be compared byte for byte with
 * the source frame it came from — but WHERE the moving thing is survives a
 * re-encode, and on a fixture that sweeps steadily across the plate that
 * position identifies the frame. `null` for a frame with nothing off the
 * plate at all.
 */
export function clipBoxCentres(path, { width = 64, tolerance = 24 } = {}) {
  const probe = spawnSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", path],
    { encoding: "utf-8" },
  );
  if (probe.status !== 0) throw new Error(`ffprobe failed for ${path}`);
  const [w, h] = String(probe.stdout).trim().split(",").map(Number);
  const height = Math.max(2, 2 * Math.round((h * width) / w / 2));
  const r = spawnSync(
    "ffmpeg",
    ["-v", "error", "-i", path, "-vf", `scale=${width}:${height}`, "-f", "rawvideo", "-pix_fmt", "gray", "-"],
    { maxBuffer: 256 * 1024 * 1024 },
  );
  if (r.status !== 0) throw new Error(`ffmpeg decode failed for ${path}`);
  const frameBytes = width * height;
  const count = Math.floor(r.stdout.length / frameBytes);
  const centres = [];
  for (let f = 0; f < count; f++) {
    const base = f * frameBytes;
    // The top-left pixel is the plate: every fixture here paints one, and the
    // box never reaches the corner.
    const plate = r.stdout[base];
    let sum = 0;
    let seen = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (Math.abs(r.stdout[base + y * width + x] - plate) <= tolerance) continue;
        sum += x;
        seen++;
      }
    }
    centres.push(seen ? sum / seen : null);
  }
  return centres;
}

/**
 * Luminance of the partially transparent pixels: the fringe, measured.
 *
 * A soft edge scaled in STRAIGHT alpha is averaged with whatever RGB sits
 * under the transparent pixel beside it — black, once the plate has been
 * zeroed — so a white subject comes back with a grey rim. Scaled
 * premultiplied, the transparent neighbour contributes nothing and the rim
 * keeps the subject's own colour. `min` is what tells the two apart.
 */
export function edgeLuma(path, { min = 16, max = 250 } = {}) {
  const { width, height, data } = decode(path);
  let count = 0;
  let lowest = 255;
  let sum = 0;
  for (let i = 0; i < width * height * 4; i += 4) {
    const a = data[i + 3];
    if (a < min || a >= max) continue;
    const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    count++;
    sum += luma;
    if (luma < lowest) lowest = luma;
  }
  return { count, min: count ? Math.round(lowest) : null, mean: count ? Math.round(sum / count) : null };
}

/**
 * How far apart two frames' silhouettes are, on the scale `loop` reports its
 * seam and step on: the alpha that changed over the alpha that is there —
 * 0 for the same pose, 1 for no overlap at all.
 *
 * Written out here rather than imported from the script, so the suite measures
 * the wrap with its own ruler; a helper shared with `sprite-sheet.mjs` could
 * only prove the script agrees with itself. Full 8-bit alpha rather than a
 * threshold, because a synthesised in-between is largely made of partial alpha.
 */
export function silhouetteDiff(pathA, pathB) {
  const a = decode(pathA);
  const b = decode(pathB);
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`silhouetteDiff: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  }
  let delta = 0;
  let union = 0;
  for (let i = 3; i < a.data.length; i += 4) {
    const x = a.data[i];
    const y = b.data[i];
    delta += Math.abs(x - y);
    union += Math.max(x, y);
  }
  return delta / Math.max(1, union);
}

/**
 * The frame-by-frame structure of an animated WebP, read out of its RIFF
 * container.
 *
 * ffmpeg cannot decode an animated WebP and libwebp is not a dependency of
 * this repo, so "does this animation ghost" has to be answered structurally.
 * Every ANMF carries the rectangle it paints plus the two bits that decide
 * what a compositing decoder does with the canvas the frame before it left
 * behind: `blend` (0 = alpha-blend onto that canvas, 1 = overwrite it) and
 * `dispose` (0 = keep the canvas, 1 = clear this frame's rect afterwards).
 */
export function webpAnimation(path) {
  const buf = readFileSync(path);
  if (buf.subarray(0, 4).toString("latin1") !== "RIFF" || buf.subarray(8, 12).toString("latin1") !== "WEBP") {
    throw new Error(`webpAnimation: ${path} is not a RIFF/WEBP file`);
  }
  const end = Math.min(buf.length, 8 + buf.readUInt32LE(4));
  const u24 = (at) => buf[at] | (buf[at + 1] << 8) | (buf[at + 2] << 16);
  const frames = [];
  let loops = null;
  let declaresAlpha = false;
  let canvas = null;
  for (let p = 12; p + 8 <= end;) {
    const id = buf.subarray(p, p + 4).toString("latin1");
    const size = buf.readUInt32LE(p + 4);
    const body = p + 8;
    // VP8X: 1 flags byte (alpha is bit 4), 3 reserved, then canvas size - 1.
    if (id === "VP8X") {
      declaresAlpha = ((buf[body] >> 4) & 1) === 1;
      canvas = { width: u24(body + 4) + 1, height: u24(body + 7) + 1 };
    }
    // ANIM: 4 bytes background colour, then the loop count.
    if (id === "ANIM") loops = buf.readUInt16LE(body + 4);
    if (id === "ANMF") {
      // x/y are stored in units of 2px and the sizes as size - 1.
      frames.push({
        x: u24(body) * 2, y: u24(body + 3) * 2, w: u24(body + 6) + 1, h: u24(body + 9) + 1,
        durationMs: u24(body + 12),
        blend: (buf[body + 15] >> 1) & 1,
        dispose: buf[body + 15] & 1,
      });
    }
    p = body + size + (size % 2);
  }
  return { canvas, declaresAlpha, loops, frames };
}

/**
 * Frames written the way the STILL `libwebp` encoder writes them: the whole
 * canvas, alpha-blended onto whatever the frame before it left there, with
 * nothing disposed in between. That is the shape that ghosts — a transparent
 * pixel of frame i keeps showing frame i-1's subject — and it is what ffmpeg's
 * `libwebp` + webp muxer produces for every frame of an animation.
 *
 * Deliberately narrow: `libwebp_anim` also emits blended frames, but always as
 * a sub-rectangle chosen so the composited canvas equals the frame it was
 * given, and no structural rule can re-derive that reasoning from the
 * container. What CAN be said is that a full-canvas blend over an uncleared
 * canvas carries no such guarantee, and that a sub-rectangle is something only
 * the animation encoder ever writes.
 */
export function webpStackedFrames(path) {
  const { canvas, frames } = webpAnimation(path);
  const stacked = [];
  for (let i = 1; i < frames.length; i++) {
    const cur = frames[i];
    const full = !canvas
      || (cur.x === 0 && cur.y === 0 && cur.w >= canvas.width && cur.h >= canvas.height);
    if (full && cur.blend === 0 && frames[i - 1].dispose === 0) stacked.push(i);
  }
  return stacked;
}

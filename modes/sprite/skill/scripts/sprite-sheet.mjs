#!/usr/bin/env node
/**
 * sprite-sheet.mjs — the deterministic half of the sprite pipeline.
 *
 * A generated sheet (an N x M grid of poses drawn on one image) goes in;
 * aligned frames, a packed atlas, an animated preview and an inspection
 * report come out. Nothing here talks to a model — every step is ffmpeg plus
 * bbox arithmetic, so the same sheet always yields the same frames.
 *
 * Zero npm dependencies: Node built-ins only, ffmpeg/ffprobe on PATH. Pixels
 * are read by decoding to `rawvideo`/`rgba` on stdout and doing the alpha
 * maths in JS; every image is written by an ffmpeg filter chain.
 *
 * Subcommands: probe, key, flatten, slice, align, pack, gif, inspect, run.
 * `--json` prints exactly one JSON object on stdout; progress goes to stderr.
 */

import { spawnSync } from "node:child_process";
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync,
  rmSync, statSync, unlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

const DEFAULT_THRESHOLD = 16;
const DEFAULT_PAD = 8;
const DEFAULT_SIMILARITY = 0.12;
const DEFAULT_BLEND = 0.05;
const CORNER_PATCH = 8;
/** A frame index is two digits, so a motion tops out at 100 frames. */
const MAX_FRAMES = 100;
/** Decoding a sheet costs w*h*4 bytes in one Buffer; refuse the absurd. */
const MAX_RAW_BYTES = 512 * 1024 * 1024;
/** A sheet whose alpha is this dense is background-opaque for keying purposes. */
const OPAQUE_COVERAGE = 0.99;
/** Warning lists are truncated so a broken sheet cannot flood the agent. */
const MAX_LISTED = 6;

const SUBCOMMANDS = ["probe", "key", "flatten", "slice", "align", "pack", "gif", "inspect", "run"];

const USAGE = `Usage: sprite-sheet.mjs <subcommand> [options]

Deterministic sprite-sheet pipeline (ffmpeg only, no model calls).
Every subcommand accepts --json (one JSON object on stdout) and --help.

  probe <image> [--threshold 16]
      Report { width, height, hasAlpha, alphaCoverage, cornerColor }.

  key <image> --out <png> [--color auto|#rrggbb] [--similarity ${DEFAULT_SIMILARITY}] [--blend ${DEFAULT_BLEND}]
      Chroma-key a background colour away. 'auto' uses the corner colour.

  flatten <image> --out <png> [--bg #ffffff]
      Composite onto a solid colour (for video models that mishandle alpha).

  slice <sheet> --rows R --cols C --out <dir> [--margin 0] [--gutter 0]
      Cut the grid into <dir>/NN.png, row-major. Non-integer cells are
      floored and reported (exact:false + remainder).

  align <framesDir> --out <dir> [--anchor bottom|center] [--cell auto|WxH]
        [--pad ${DEFAULT_PAD}] [--smooth] [--threshold ${DEFAULT_THRESHOLD}]
      Re-place every frame so its anchor lands on the same point.
      bottom: bbox bottom-centre; center: bbox centre. --smooth replaces each
      anchor x with the 3-frame median so a one-frame bbox wobble (a stray
      arm) does not shove the whole body sideways; with --anchor center the
      same median is applied to y.

  pack <framesDir> --out <sheet.png> --atlas <atlas.json> --name <motionId>
       --fps N [--loop] [--anchor bottom|center] [--cols C] [--scale 1] [--nearest]
      Row-major atlas image + TexturePacker-JSON-hash-compatible atlas.json.

  gif <framesDir> --out <preview.gif> --fps N [--loop|--no-loop]
      [--webp <preview.webp>] [--width W]
      Palette GIF with a reserved transparent entry; optional animated WebP.

  inspect <motionDir> [--anchor bottom|center] [--cells <dir>] [--threshold ${DEFAULT_THRESHOLD}]
      Frame count, cell, per-frame bboxes, anchor drift, max jump, scale
      drift, empty frames and human warnings. Writes <motionDir>/inspect.json.
      --cells points at the pre-align grid cells so "leaves its grid cell"
      can be judged on the raw crop rather than the padded frame.

  run <sheet-raw> --rows R --cols C --out <motionDir> --name <motionId> --fps N
      [--loop] [--anchor bottom|center] [--key auto|#rrggbb|none] [--cell auto|WxH]
      [--pad ${DEFAULT_PAD}] [--smooth] [--scale 1] [--nearest] [--margin 0] [--gutter 0]
      [--width W] [--no-webp] [--threshold ${DEFAULT_THRESHOLD}]
      probe -> key (only when the sheet is opaque) -> slice -> align -> pack
      -> gif (+webp) -> inspect. The input sheet is copied, never moved.

Exit code 0 on success, 1 on failure with a one-line ERROR: on stderr.`;

// ---------------------------------------------------------------------------
// Process plumbing
// ---------------------------------------------------------------------------

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

let toolsChecked = false;
function ensureTools() {
  if (toolsChecked) return;
  for (const bin of ["ffmpeg", "ffprobe"]) {
    const probe = spawnSync(bin, ["-version"], { stdio: "ignore" });
    if (probe.error || probe.status !== 0) {
      fail(`${bin} not found on PATH. Install ffmpeg (brew install ffmpeg).`);
    }
  }
  toolsChecked = true;
}

function ffmpeg(args, label) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { encoding: "utf-8" });
  if (r.error) fail(`${label}: could not run ffmpeg (${r.error.message})`);
  if (r.status !== 0) fail(`${label}: ffmpeg failed\n${(r.stderr || "").trim()}`);
}

/**
 * Render through a scratch file next to the destination and rename, so a
 * reader never sees a half-encoded image. The scratch keeps the final
 * extension because ffmpeg picks its muxer from it.
 */
function ffmpegTo(outPath, buildArgs, label) {
  const out = resolve(outPath);
  mkdirSync(dirname(out), { recursive: true });
  const scratch = join(dirname(out), `.${basename(out, extname(out))}.tmp${extname(out)}`);
  try {
    ffmpeg([...buildArgs(scratch), "--", scratch], label);
    renameSync(scratch, out);
  } finally {
    if (existsSync(scratch)) rmSync(scratch, { force: true });
  }
  return out;
}

function writeJsonFile(outPath, value) {
  const out = resolve(outPath);
  mkdirSync(dirname(out), { recursive: true });
  const scratch = `${out}.tmp`;
  writeFileSync(scratch, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(scratch, out);
  return out;
}

// ---------------------------------------------------------------------------
// Pixels
// ---------------------------------------------------------------------------

function probeSize(path) {
  const r = spawnSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", path],
    { encoding: "utf-8" },
  );
  if (r.error || r.status !== 0) fail(`ffprobe failed for ${path}: ${(r.stderr || "").trim()}`);
  const [width, height] = String(r.stdout).trim().split(",").map(Number);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    fail(`ffprobe returned bad dimensions for ${path}: '${String(r.stdout).trim()}'`);
  }
  return { width, height };
}

/** Decode the first frame of any image to a raw RGBA buffer. */
function readRgba(path) {
  if (!existsSync(path)) fail(`file not found: ${path}`);
  const { width, height } = probeSize(path);
  const bytes = width * height * 4;
  if (bytes > MAX_RAW_BYTES) {
    fail(`${path} is ${width}x${height} — ${(bytes / 1e6).toFixed(0)} MB decoded, over the ${MAX_RAW_BYTES / 1e6} MB limit`);
  }
  const r = spawnSync(
    "ffmpeg",
    ["-v", "error", "-i", path, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "-"],
    { maxBuffer: MAX_RAW_BYTES },
  );
  if (r.error) fail(`could not decode ${path} (${r.error.message})`);
  if (r.status !== 0) fail(`could not decode ${path}\n${(r.stderr || "").toString().trim()}`);
  if (!r.stdout || r.stdout.length < bytes) {
    fail(`decoded ${path} to ${r.stdout ? r.stdout.length : 0} bytes, expected ${bytes}`);
  }
  return { width, height, data: r.stdout.subarray(0, bytes) };
}

function computeBbox(image, threshold) {
  const { width, height, data } = image;
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1, count = 0;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (data[(row + x) * 4 + 3] < threshold) continue;
      count++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return {
    coverage: count / (width * height),
    bbox: count ? { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } : null,
  };
}

function hasAlpha(image) {
  const { data } = image;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function toHex(r, g, b) {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Per-channel median over the four corner patches. A median (not a mean)
 * because one corner may contain the drawing; three clean corners still win.
 */
function cornerColor(image) {
  const { width, height, data } = image;
  const pw = Math.max(1, Math.min(CORNER_PATCH, width >> 1 || 1));
  const ph = Math.max(1, Math.min(CORNER_PATCH, height >> 1 || 1));
  const reds = [], greens = [], blues = [];
  for (const [ox, oy] of [[0, 0], [width - pw, 0], [0, height - ph], [width - pw, height - ph]]) {
    for (let y = oy; y < oy + ph; y++) {
      for (let x = ox; x < ox + pw; x++) {
        const i = (y * width + x) * 4;
        reds.push(data[i]); greens.push(data[i + 1]); blues.push(data[i + 2]);
      }
    }
  }
  return toHex(median(reds), median(greens), median(blues));
}

function normalizeColor(value, flag) {
  const text = String(value).trim();
  if (/^#[0-9a-fA-F]{6}$/.test(text)) return text.toLowerCase();
  if (/^0x[0-9a-fA-F]{6}$/.test(text)) return `#${text.slice(2).toLowerCase()}`;
  fail(`${flag}: expected #rrggbb, got '${value}'`);
}

// ---------------------------------------------------------------------------
// Frame directories
// ---------------------------------------------------------------------------

const FRAME_RE = /^(\d{2})\.png$/;

function listFrames(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) fail(`frames directory not found: ${dir}`);
  const entries = readdirSync(dir)
    .map((name) => ({ name, match: FRAME_RE.exec(name) }))
    .filter((e) => e.match)
    .map((e) => ({ index: Number(e.match[1]), path: join(dir, e.name) }))
    .sort((a, b) => a.index - b.index);
  if (!entries.length) fail(`no NN.png frames in ${dir}`);
  entries.forEach((entry, i) => {
    if (entry.index !== i) fail(`frames in ${dir} are not contiguous from 00 (found ${basename(entry.path)} at position ${i})`);
  });
  return entries;
}

const frameName = (index) => `${String(index).padStart(2, "0")}.png`;

/** A frames dir is rewritten wholesale — a shorter motion must not inherit
 *  the tail of a longer one. */
function resetFramesDir(dir) {
  mkdirSync(dir, { recursive: true });
  for (const name of readdirSync(dir)) {
    if (FRAME_RE.test(name)) unlinkSync(join(dir, name));
  }
}

function listAndTruncate(items, render) {
  const shown = items.slice(0, MAX_LISTED).map(render);
  if (items.length > MAX_LISTED) shown.push(`…and ${items.length - MAX_LISTED} more`);
  return shown;
}

// ---------------------------------------------------------------------------
// Steps — each returns the JSON its subcommand prints, and each is reused by `run`
// ---------------------------------------------------------------------------

function stepProbe(input, threshold) {
  const image = readRgba(input);
  const { coverage } = computeBbox(image, threshold);
  return {
    input: resolve(input),
    width: image.width,
    height: image.height,
    hasAlpha: hasAlpha(image),
    alphaCoverage: round(coverage, 4),
    cornerColor: cornerColor(image),
  };
}

function stepKey(input, { out, color, similarity, blend, threshold }) {
  const resolved = color === "auto" ? stepProbe(input, threshold).cornerColor : normalizeColor(color, "--color");
  const output = ffmpegTo(out, () => [
    "-i", resolve(input),
    "-vf", `colorkey=${resolved}:${similarity}:${blend},format=rgba`,
    "-frames:v", "1", "-pix_fmt", "rgba",
  ], "key");
  const after = stepProbe(output, threshold);
  return {
    input: resolve(input),
    output,
    color: resolved,
    similarity,
    blend,
    width: after.width,
    height: after.height,
    alphaCoverage: after.alphaCoverage,
  };
}

function stepFlatten(input, { out, bg }) {
  const color = normalizeColor(bg, "--bg");
  const { width, height } = probeSize(resolve(input));
  const output = ffmpegTo(out, () => [
    "-i", resolve(input),
    "-f", "lavfi", "-i", `color=c=${color}:s=${width}x${height}`,
    "-filter_complex", "[1:v][0:v]overlay=0:0:format=auto,format=rgb24",
    "-frames:v", "1",
  ], "flatten");
  return { input: resolve(input), output, bg: color, width, height };
}

function stepSlice(sheet, { rows, cols, out, margin, gutter }) {
  const input = resolve(sheet);
  const { width, height } = probeSize(input);
  const cellW = Math.floor((width - 2 * margin - (cols - 1) * gutter) / cols);
  const cellH = Math.floor((height - 2 * margin - (rows - 1) * gutter) / rows);
  if (cellW <= 0 || cellH <= 0) {
    fail(`a ${cols}x${rows} grid with margin ${margin} and gutter ${gutter} leaves no room in a ${width}x${height} sheet`);
  }
  if (rows * cols > MAX_FRAMES) fail(`${rows}x${cols} is ${rows * cols} frames — the limit is ${MAX_FRAMES}`);

  const remainder = {
    x: width - (2 * margin + (cols - 1) * gutter + cols * cellW),
    y: height - (2 * margin + (rows - 1) * gutter + rows * cellH),
  };
  const dir = resolve(out);
  resetFramesDir(dir);

  const frames = [];
  const boxes = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const index = row * cols + col;
      const x = margin + col * (cellW + gutter);
      const y = margin + row * (cellH + gutter);
      boxes.push({ index, x, y });
      frames.push(ffmpegTo(join(dir, frameName(index)), () => [
        "-i", input,
        "-vf", `crop=${cellW}:${cellH}:${x}:${y}`,
        "-frames:v", "1", "-pix_fmt", "rgba",
      ], `slice cell ${index}`));
    }
  }
  return {
    sheet: input,
    outDir: dir,
    rows, cols, margin, gutter,
    cell: { width: cellW, height: cellH },
    exact: remainder.x === 0 && remainder.y === 0,
    remainder,
    cells: boxes,
    frames,
  };
}

function parseCell(value) {
  if (!value || value === "auto") return null;
  const m = /^(\d+)x(\d+)$/.exec(String(value).trim());
  if (!m) fail(`--cell: expected auto or WxH, got '${value}'`);
  return { width: Number(m[1]), height: Number(m[2]) };
}

/** Anchor of a bbox in its own frame's coordinates. */
function anchorOf(bbox, anchor) {
  return {
    x: bbox.x + bbox.w / 2,
    y: anchor === "center" ? bbox.y + bbox.h / 2 : bbox.y + bbox.h,
  };
}

/**
 * 3-frame median with the edges clamped (the first and last value repeat).
 * Shrinking the window at the ends instead would make it a 2-value median —
 * i.e. an average — which reintroduces exactly the jitter being filtered out.
 */
function median3(values, i) {
  const at = (k) => values[Math.min(Math.max(k, 0), values.length - 1)];
  return median([at(i - 1), at(i), at(i + 1)]);
}

/**
 * Re-place every frame so its anchor lands on one fixed point in a uniform
 * cell. `bboxes` may be supplied by a caller that already decoded the source
 * (see `run`), which saves one decode per frame.
 */
function stepAlign(framesDir, { out, anchor, cell, pad, smooth, threshold, bboxes: given }) {
  const entries = listFrames(resolve(framesDir));
  const bboxes = given ?? entries.map((entry) => computeBbox(readRgba(entry.path), threshold).bbox);
  if (bboxes.length !== entries.length) fail("internal: bbox count does not match frame count");

  const filled = bboxes.filter(Boolean);
  if (!filled.length) fail(`every frame in ${framesDir} is empty above alpha threshold ${threshold}`);

  let cellSize = cell;
  if (!cellSize) {
    const even = (n) => (n % 2 ? n + 1 : n);
    cellSize = {
      width: even(Math.max(...filled.map((b) => b.w)) + 2 * pad),
      height: even(Math.max(...filled.map((b) => b.h)) + 2 * pad),
    };
  }

  for (const [i, box] of bboxes.entries()) {
    if (!box) continue;
    if (box.w > cellSize.width || box.h > cellSize.height) {
      fail(`frame ${frameName(i).slice(0, 2)} needs at least ${box.w}x${box.h} but the cell is ${cellSize.width}x${cellSize.height} — raise --pad or set --cell`);
    }
  }

  // Smoothing works on the *source* anchor, so a one-frame bbox wobble stops
  // shoving the body; the frame keeps its own offset from the smoothed anchor.
  const anchorsX = bboxes.map((b) => (b ? anchorOf(b, anchor).x : null));
  const anchorsY = bboxes.map((b) => (b ? anchorOf(b, anchor).y : null));
  let targetsX = anchorsX;
  let targetsY = anchorsY;
  if (smooth) {
    const xs = anchorsX.map((v) => v ?? 0);
    targetsX = anchorsX.map((v, i) => (v === null ? null : median3(xs, i)));
    if (anchor === "center") {
      const ys = anchorsY.map((v) => v ?? 0);
      targetsY = anchorsY.map((v, i) => (v === null ? null : median3(ys, i)));
    }
  }

  const target = {
    x: cellSize.width / 2,
    y: anchor === "center" ? cellSize.height / 2 : cellSize.height - pad,
  };

  const dir = resolve(out);
  resetFramesDir(dir);

  const emptyFrames = [];
  const warnings = [];
  const clamped = [];
  const frames = [];

  for (const [i, entry] of entries.entries()) {
    const box = bboxes[i];
    const outPath = join(dir, frameName(i));
    if (!box) {
      emptyFrames.push(i);
      // `format=rgba` has to live INSIDE the lavfi graph: as a separate -vf
      // step the colour source negotiates an alpha-less format first and the
      // "transparent" frame comes out opaque black (measured, ffmpeg 8.0).
      ffmpegTo(outPath, () => [
        "-f", "lavfi", "-i", `color=c=black@0:s=${cellSize.width}x${cellSize.height},format=rgba`,
        "-frames:v", "1", "-pix_fmt", "rgba",
      ], `align frame ${i}`);
      frames.push({ index: i, path: outPath, bbox: null, offset: null, empty: true });
      continue;
    }
    // Where the anchor sits inside the crop, after optional smoothing.
    const localX = targetsX[i] - box.x;
    const localY = (anchor === "center" ? targetsY[i] : anchorOf(box, anchor).y) - box.y;
    let offsetX = Math.round(target.x - localX);
    let offsetY = Math.round(target.y - localY);
    const clampedX = Math.min(Math.max(offsetX, 0), cellSize.width - box.w);
    const clampedY = Math.min(Math.max(offsetY, 0), cellSize.height - box.h);
    if (clampedX !== offsetX || clampedY !== offsetY) clamped.push(i);
    offsetX = clampedX;
    offsetY = clampedY;

    ffmpegTo(outPath, () => [
      "-i", entry.path,
      "-vf", `crop=${box.w}:${box.h}:${box.x}:${box.y},pad=${cellSize.width}:${cellSize.height}:${offsetX}:${offsetY}:black@0`,
      "-frames:v", "1", "-pix_fmt", "rgba",
    ], `align frame ${i}`);
    frames.push({
      index: i,
      path: outPath,
      bbox: { x: offsetX, y: offsetY, w: box.w, h: box.h },
      offset: { x: offsetX, y: offsetY },
      empty: false,
    });
  }

  if (emptyFrames.length) {
    warnings.push(...listAndTruncate(emptyFrames, (i) => `frame ${String(i).padStart(2, "0")} is empty`));
  }
  if (clamped.length) {
    warnings.push(...listAndTruncate(clamped, (i) => `frame ${String(i).padStart(2, "0")} was clamped to stay inside the cell`));
  }

  return {
    inDir: resolve(framesDir),
    outDir: dir,
    anchor, pad, smooth,
    cell: cellSize,
    frames,
    emptyFrames,
    warnings,
  };
}

function stepPack(framesDir, { out, atlas, name, fps, loop, anchor, cols, scale, nearest }) {
  const entries = listFrames(resolve(framesDir));
  const { width, height } = probeSize(entries[0].path);
  for (const entry of entries) {
    const size = probeSize(entry.path);
    if (size.width !== width || size.height !== height) {
      fail(`frames are not uniform: ${basename(entries[0].path)} is ${width}x${height} but ${basename(entry.path)} is ${size.width}x${size.height} — run align first`);
    }
  }

  const cellW = Math.max(1, Math.round(width * scale));
  const cellH = Math.max(1, Math.round(height * scale));
  const columns = cols ?? Math.ceil(Math.sqrt(entries.length));
  const rows = Math.ceil(entries.length / columns);

  const chain = [];
  if (scale !== 1) chain.push(`scale=${cellW}:${cellH}${nearest ? ":flags=neighbor" : ""}`);
  // tile's default padding colour is opaque black; an unfilled slot in the
  // last row would become a black square without color=black@0.
  chain.push(`tile=${columns}x${rows}:color=black@0`);

  const sheetPath = ffmpegTo(out, () => [
    "-start_number", "0",
    "-i", join(resolve(framesDir), "%02d.png"),
    "-vf", chain.join(","),
    "-frames:v", "1", "-pix_fmt", "rgba",
  ], "pack");

  const duration = Math.round(1000 / fps);
  const pivot = anchor === "center" ? { x: 0.5, y: 0.5 } : { x: 0.5, y: 1 };
  const frames = {};
  const order = [];
  for (let i = 0; i < entries.length; i++) {
    const key = `${name}_${String(i).padStart(2, "0")}`;
    order.push(key);
    frames[key] = {
      frame: { x: (i % columns) * cellW, y: Math.floor(i / columns) * cellH, w: cellW, h: cellH },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: cellW, h: cellH },
      sourceSize: { w: cellW, h: cellH },
      pivot,
      duration,
    };
  }
  const size = { w: columns * cellW, h: rows * cellH };
  const atlasDoc = {
    meta: {
      app: "pneuma-sprite",
      version: 1,
      image: basename(sheetPath),
      size,
      scale,
      fps,
      loop,
      anchor,
    },
    frames,
    animations: { [name]: order },
  };
  const atlasPath = writeJsonFile(atlas, atlasDoc);

  return {
    framesDir: resolve(framesDir),
    sheet: sheetPath,
    atlas: atlasPath,
    name, fps, loop, anchor, scale,
    grid: { rows, cols: columns },
    cell: { width: cellW, height: cellH },
    size,
    frameCount: entries.length,
  };
}

function hasLibwebp() {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-encoders"], { encoding: "utf-8" });
  return r.status === 0 && String(r.stdout).includes("libwebp");
}

function stepGif(framesDir, { out, fps, loop, webp, width }) {
  const dir = resolve(framesDir);
  const entries = listFrames(dir);
  const source = probeSize(entries[0].path);
  const outWidth = width ?? source.width;
  const outHeight = width ? Math.max(1, Math.round((source.height * width) / source.width)) : source.height;
  const pattern = join(dir, "%02d.png");
  const scaleStep = width ? `scale=${outWidth}:${outHeight}:flags=neighbor,` : "";
  const warnings = [];

  const gifPath = ffmpegTo(out, () => [
    "-framerate", String(fps),
    "-start_number", "0",
    "-i", pattern,
    "-filter_complex",
    `[0:v]${scaleStep}split[a][b];[a]palettegen=reserve_transparent=1:stats_mode=full[p];[b][p]paletteuse=alpha_threshold=128:dither=sierra2_4a`,
    "-loop", loop ? "0" : "-1",
  ], "gif");

  let webpPath;
  if (webp) {
    if (hasLibwebp()) {
      webpPath = ffmpegTo(webp, () => [
        "-framerate", String(fps),
        "-start_number", "0",
        "-i", pattern,
        ...(width ? ["-vf", `scale=${outWidth}:${outHeight}:flags=neighbor`] : []),
        "-c:v", "libwebp", "-pix_fmt", "yuva420p", "-q:v", "85",
        "-loop", loop ? "0" : "1",
      ], "webp");
    } else {
      warnings.push("libwebp encoder is not available in this ffmpeg build — skipped the WebP preview");
    }
  }

  return {
    framesDir: dir,
    gif: gifPath,
    ...(webpPath ? { webp: webpPath } : {}),
    fps, loop,
    width: outWidth,
    height: outHeight,
    frameCount: entries.length,
    warnings,
  };
}

function round(value, digits) {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function stdDev(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length);
}

/**
 * Read a finished motion and say what is wrong with it in sentences a human
 * (and the agent talking to one) can act on.
 */
function stepInspect(motionDir, { anchor, threshold, cellsDir, write = true }) {
  const dir = resolve(motionDir);
  const framesDir = existsSync(join(dir, "frames")) ? join(dir, "frames") : dir;
  const entries = listFrames(framesDir);

  const measured = entries.map((entry) => {
    const image = readRgba(entry.path);
    const { bbox, coverage } = computeBbox(image, threshold);
    return { index: entry.index, path: entry.path, width: image.width, height: image.height, bbox, coverage };
  });

  const cellW = measured[0].width;
  const cellH = measured[0].height;
  const nonUniform = measured.filter((f) => f.width !== cellW || f.height !== cellH);

  const anchors = measured.map((f) => (f.bbox ? anchorOf(f.bbox, anchor) : null));
  const present = anchors.filter(Boolean);
  const anchorDrift = {
    x: round(stdDev(present.map((a) => a.x)), 3),
    y: round(stdDev(present.map((a) => a.y)), 3),
  };

  let maxJump = 0;
  let jumpPair = null;
  for (let i = 1; i < anchors.length; i++) {
    if (!anchors[i] || !anchors[i - 1]) continue;
    const d = Math.hypot(anchors[i].x - anchors[i - 1].x, anchors[i].y - anchors[i - 1].y);
    if (d > maxJump) { maxJump = d; jumpPair = [i - 1, i]; }
  }

  const heights = measured.filter((f) => f.bbox).map((f) => f.bbox.h);
  const meanHeight = heights.length ? heights.reduce((a, b) => a + b, 0) / heights.length : 0;
  const scaleDrift = meanHeight > 0 ? round((Math.max(...heights) - Math.min(...heights)) / meanHeight, 4) : 0;

  const emptyFrames = measured.filter((f) => !f.bbox).map((f) => f.index);
  const nearlyEmpty = measured.filter((f) => f.bbox && f.coverage < 0.02).map((f) => f.index);

  // "Leaves its grid cell" is a statement about the raw crop: judge it on the
  // pre-align cells when the caller has them, never on a padded frame.
  const clipSource = cellsDir
    ? listFrames(resolve(cellsDir)).map((entry) => {
        const image = readRgba(entry.path);
        return { index: entry.index, width: image.width, height: image.height, ...computeBbox(image, threshold) };
      })
    : measured;
  const clipped = clipSource
    .filter((f) => f.bbox && (f.bbox.x === 0 || f.bbox.y === 0 || f.bbox.x + f.bbox.w === f.width || f.bbox.y + f.bbox.h === f.height))
    .map((f) => f.index);

  const pad = (i) => String(i).padStart(2, "0");
  const warnings = [];
  if (nonUniform.length) {
    warnings.push(`frames are not a uniform cell — ${pad(nonUniform[0].index)} is ${nonUniform[0].width}x${nonUniform[0].height}, expected ${cellW}x${cellH}`);
  }
  warnings.push(...listAndTruncate(emptyFrames, (i) => `frame ${pad(i)} is empty`));
  warnings.push(...listAndTruncate(nearlyEmpty, (i) => `frame ${pad(i)} is nearly empty`));
  if (jumpPair && maxJump > 0.08 * cellW) {
    warnings.push(`anchor jumps between frames ${pad(jumpPair[0])} and ${pad(jumpPair[1])}`);
  }
  if (scaleDrift > 0.15) {
    warnings.push("character scale varies across frames — regenerate with a fixed-scale instruction");
  }
  warnings.push(...listAndTruncate(clipped, (i) => `cell ${pad(i)} is clipped — the drawing leaves its grid cell`));

  const summary = {
    frameCount: measured.length,
    cell: { width: cellW, height: cellH },
    anchorDrift,
    maxJump: round(maxJump, 3),
    scaleDrift,
    emptyFrames,
    warnings,
  };
  const report = {
    ...summary,
    motionDir: dir,
    framesDir,
    anchor,
    frames: measured.map((f) => ({
      index: f.index,
      bbox: f.bbox,
      coverage: round(f.coverage, 4),
      anchor: f.bbox ? { x: round(anchorOf(f.bbox, anchor).x, 2), y: round(anchorOf(f.bbox, anchor).y, 2) } : null,
    })),
  };
  if (write) report.inspect = writeJsonFile(join(dir, "inspect.json"), report);
  return { summary, report };
}

function stepRun(sheetRaw, options) {
  const input = resolve(sheetRaw);
  if (!existsSync(input)) fail(`file not found: ${input}`);
  const motionDir = resolve(options.out);
  mkdirSync(motionDir, { recursive: true });

  const sheetRawPath = join(motionDir, "sheet-raw.png");
  if (input !== sheetRawPath) copyFileSync(input, sheetRawPath);

  const probe = stepProbe(sheetRawPath, options.threshold);
  const warnings = [];

  // Key only when the background really is opaque; a sheet that already has
  // alpha is left exactly as generated.
  let sheetAlpha;
  let keyColor;
  const opaque = !probe.hasAlpha || probe.alphaCoverage >= OPAQUE_COVERAGE;
  if (options.key !== "none" && opaque) {
    const keyed = stepKey(sheetRawPath, {
      out: join(motionDir, "sheet-alpha.png"),
      color: options.key,
      similarity: options.similarity,
      blend: options.blend,
      threshold: options.threshold,
    });
    sheetAlpha = keyed.output;
    keyColor = keyed.color;
    if (keyed.alphaCoverage > 0.9) {
      warnings.push(`keying ${keyed.color} left ${(keyed.alphaCoverage * 100).toFixed(0)}% of the sheet opaque — check the background colour`);
    }
  }

  const source = sheetAlpha ?? sheetRawPath;
  const scratch = mkdtempSync(join(tmpdir(), "sprite-cells-"));
  try {
    const sliced = stepSlice(source, {
      rows: options.rows, cols: options.cols, out: scratch,
      margin: options.margin, gutter: options.gutter,
    });

    // One decode of the source covers every cell's bbox: slicing is a pure
    // crop, so a cell's pixels are the sheet's pixels.
    const sheetImage = readRgba(source);
    const bboxes = sliced.cells.map((cell) => {
      const local = computeBbox({
        width: sliced.cell.width,
        height: sliced.cell.height,
        data: cropBuffer(sheetImage, cell.x, cell.y, sliced.cell.width, sliced.cell.height),
      }, options.threshold);
      return local.bbox;
    });

    const aligned = stepAlign(scratch, {
      out: join(motionDir, "frames"),
      anchor: options.anchor,
      cell: options.cell,
      pad: options.pad,
      smooth: options.smooth,
      threshold: options.threshold,
      bboxes,
    });
    warnings.push(...aligned.warnings);

    const packed = stepPack(join(motionDir, "frames"), {
      out: join(motionDir, "sheet.png"),
      atlas: join(motionDir, "atlas.json"),
      name: options.name,
      fps: options.fps,
      loop: options.loop,
      anchor: options.anchor,
      cols: options.cols,
      scale: options.scale,
      nearest: options.nearest,
    });

    const preview = stepGif(join(motionDir, "frames"), {
      out: join(motionDir, "preview.gif"),
      fps: options.fps,
      loop: options.loop,
      webp: options.webp ? join(motionDir, "preview.webp") : null,
      width: options.width,
    });
    warnings.push(...preview.warnings);

    const { summary } = stepInspect(motionDir, {
      anchor: options.anchor,
      threshold: options.threshold,
      cellsDir: scratch,
    });
    warnings.push(...summary.warnings.filter((w) => !warnings.includes(w)));

    return {
      motionDir,
      name: options.name,
      grid: { rows: options.rows, cols: options.cols },
      sheetRaw: sheetRawPath,
      ...(sheetAlpha ? { sheetAlpha } : {}),
      keyed: Boolean(sheetAlpha),
      ...(keyColor ? { keyColor } : {}),
      frames: aligned.frames.map((f) => f.path),
      sheet: packed.sheet,
      atlas: packed.atlas,
      gif: preview.gif,
      ...(preview.webp ? { webp: preview.webp } : {}),
      inspect: summary,
      cell: aligned.cell,
      fps: options.fps,
      loop: options.loop,
      anchor: options.anchor,
      scale: options.scale,
      warnings,
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Copy a w*h RGBA window out of a decoded image without re-decoding it. */
function cropBuffer(image, x, y, w, h) {
  const out = Buffer.allocUnsafe(w * h * 4);
  for (let row = 0; row < h; row++) {
    const src = ((y + row) * image.width + x) * 4;
    image.data.copy(out, row * w * 4, src, src + w * 4);
  }
  return out;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const COMMON = { json: { type: "boolean", default: false }, help: { type: "boolean", short: "h", default: false } };

const OPTIONS = {
  probe: { threshold: { type: "string" } },
  key: {
    out: { type: "string" }, color: { type: "string" }, similarity: { type: "string" },
    blend: { type: "string" }, threshold: { type: "string" },
  },
  flatten: { out: { type: "string" }, bg: { type: "string" } },
  slice: {
    rows: { type: "string" }, cols: { type: "string" }, out: { type: "string" },
    margin: { type: "string" }, gutter: { type: "string" },
  },
  align: {
    out: { type: "string" }, anchor: { type: "string" }, cell: { type: "string" },
    pad: { type: "string" }, smooth: { type: "boolean", default: false }, threshold: { type: "string" },
  },
  pack: {
    out: { type: "string" }, atlas: { type: "string" }, name: { type: "string" }, fps: { type: "string" },
    loop: { type: "boolean", default: false }, "no-loop": { type: "boolean", default: false },
    anchor: { type: "string" }, cols: { type: "string" }, scale: { type: "string" },
    nearest: { type: "boolean", default: false },
  },
  gif: {
    out: { type: "string" }, fps: { type: "string" }, loop: { type: "boolean", default: false },
    "no-loop": { type: "boolean", default: false }, webp: { type: "string" }, width: { type: "string" },
  },
  inspect: { anchor: { type: "string" }, threshold: { type: "string" }, cells: { type: "string" } },
  run: {
    rows: { type: "string" }, cols: { type: "string" }, out: { type: "string" }, name: { type: "string" },
    fps: { type: "string" }, loop: { type: "boolean", default: false }, "no-loop": { type: "boolean", default: false },
    anchor: { type: "string" }, key: { type: "string" }, cell: { type: "string" }, pad: { type: "string" },
    smooth: { type: "boolean", default: false }, scale: { type: "string" }, nearest: { type: "boolean", default: false },
    margin: { type: "string" }, gutter: { type: "string" }, width: { type: "string" },
    "no-webp": { type: "boolean", default: false }, threshold: { type: "string" },
    similarity: { type: "string" }, blend: { type: "string" },
  },
};

function num(value, flag, { integer = false, min = -Infinity, fallback } = {}) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || (integer && !Number.isInteger(parsed)) || parsed < min) {
    fail(`${flag}: expected ${integer ? "an integer" : "a number"} >= ${min}, got '${value}'`);
  }
  return parsed;
}

function requireFlag(value, flag) {
  if (value === undefined || value === "") fail(`${flag} is required`);
  return value;
}

function requirePositional(positionals, label) {
  if (!positionals.length) fail(`${label} is required`);
  if (positionals.length > 1) fail(`unexpected extra argument '${positionals[1]}'`);
  return positionals[0];
}

function pickAnchor(value) {
  const anchor = value ?? "bottom";
  if (anchor !== "bottom" && anchor !== "center") fail(`--anchor: expected bottom or center, got '${value}'`);
  return anchor;
}

function pickLoop(values, fallback = false) {
  if (values.loop && values["no-loop"]) fail("--loop and --no-loop are mutually exclusive");
  if (values.loop) return true;
  if (values["no-loop"]) return false;
  return fallback;
}

function emit(values, payload, humanLines) {
  if (values.json) {
    console.log(JSON.stringify(payload));
  } else {
    console.log(humanLines.join("\n"));
  }
}

function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv[0] === "--help" || argv[0] === "-h") {
    console.log(USAGE);
    process.exit(0);
  }
  const command = argv[0];
  if (!SUBCOMMANDS.includes(command)) {
    console.error(`ERROR: unknown subcommand '${command}'. Expected one of: ${SUBCOMMANDS.join(", ")}`);
    console.error(USAGE);
    process.exit(1);
  }

  let parsed;
  try {
    parsed = parseArgs({
      args: argv.slice(1),
      options: { ...COMMON, ...OPTIONS[command] },
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    fail(`${command}: ${error.message}`);
  }
  const { values, positionals } = parsed;
  if (values.help) {
    console.log(USAGE);
    process.exit(0);
  }

  ensureTools();
  const threshold = num(values.threshold, "--threshold", { integer: true, min: 0, fallback: DEFAULT_THRESHOLD });

  switch (command) {
    case "probe": {
      const out = stepProbe(requirePositional(positionals, "<image>"), threshold);
      emit(values, out, [
        `${out.width}x${out.height}  alpha=${out.hasAlpha ? "yes" : "no"}  coverage=${(out.alphaCoverage * 100).toFixed(1)}%  corner=${out.cornerColor}`,
      ]);
      break;
    }
    case "key": {
      const out = stepKey(requirePositional(positionals, "<image>"), {
        out: requireFlag(values.out, "--out"),
        color: values.color ?? "auto",
        similarity: num(values.similarity, "--similarity", { min: 0, fallback: DEFAULT_SIMILARITY }),
        blend: num(values.blend, "--blend", { min: 0, fallback: DEFAULT_BLEND }),
        threshold,
      });
      emit(values, out, [`keyed ${out.color} → ${out.output} (coverage now ${(out.alphaCoverage * 100).toFixed(1)}%)`]);
      break;
    }
    case "flatten": {
      const out = stepFlatten(requirePositional(positionals, "<image>"), {
        out: requireFlag(values.out, "--out"),
        bg: values.bg ?? "#ffffff",
      });
      emit(values, out, [`flattened onto ${out.bg} → ${out.output}`]);
      break;
    }
    case "slice": {
      const out = stepSlice(requirePositional(positionals, "<sheet>"), {
        rows: num(requireFlag(values.rows, "--rows"), "--rows", { integer: true, min: 1 }),
        cols: num(requireFlag(values.cols, "--cols"), "--cols", { integer: true, min: 1 }),
        out: requireFlag(values.out, "--out"),
        margin: num(values.margin, "--margin", { integer: true, min: 0, fallback: 0 }),
        gutter: num(values.gutter, "--gutter", { integer: true, min: 0, fallback: 0 }),
      });
      emit(values, out, [
        `sliced ${out.rows}x${out.cols} into ${out.frames.length} cells of ${out.cell.width}x${out.cell.height}${out.exact ? "" : ` (floored, ${out.remainder.x}x${out.remainder.y} px left over)`}`,
      ]);
      break;
    }
    case "align": {
      const out = stepAlign(requirePositional(positionals, "<framesDir>"), {
        out: requireFlag(values.out, "--out"),
        anchor: pickAnchor(values.anchor),
        cell: parseCell(values.cell),
        pad: num(values.pad, "--pad", { integer: true, min: 0, fallback: DEFAULT_PAD }),
        smooth: values.smooth,
        threshold,
      });
      emit(values, out, [
        `aligned ${out.frames.length} frames on a ${out.cell.width}x${out.cell.height} cell (${out.anchor})`,
        ...out.warnings,
      ]);
      break;
    }
    case "pack": {
      const out = stepPack(requirePositional(positionals, "<framesDir>"), {
        out: requireFlag(values.out, "--out"),
        atlas: requireFlag(values.atlas, "--atlas"),
        name: requireFlag(values.name, "--name"),
        fps: num(requireFlag(values.fps, "--fps"), "--fps", { min: 1 }),
        loop: pickLoop(values),
        anchor: pickAnchor(values.anchor),
        cols: values.cols === undefined ? null : num(values.cols, "--cols", { integer: true, min: 1 }),
        scale: num(values.scale, "--scale", { min: 0.01, fallback: 1 }),
        nearest: values.nearest,
      });
      emit(values, out, [`packed ${out.frameCount} frames into ${out.size.w}x${out.size.h} → ${out.sheet}`]);
      break;
    }
    case "gif": {
      const out = stepGif(requirePositional(positionals, "<framesDir>"), {
        out: requireFlag(values.out, "--out"),
        fps: num(requireFlag(values.fps, "--fps"), "--fps", { min: 1 }),
        loop: pickLoop(values),
        webp: values.webp ?? null,
        width: values.width === undefined ? null : num(values.width, "--width", { integer: true, min: 1 }),
      });
      emit(values, out, [`wrote ${out.gif}${out.webp ? ` and ${out.webp}` : ""}`, ...out.warnings]);
      break;
    }
    case "inspect": {
      const { report } = stepInspect(requirePositional(positionals, "<motionDir>"), {
        anchor: pickAnchor(values.anchor),
        threshold,
        cellsDir: values.cells ?? null,
      });
      emit(values, report, [
        `${report.frameCount} frames of ${report.cell.width}x${report.cell.height}, drift ${report.anchorDrift.x}/${report.anchorDrift.y}px, max jump ${report.maxJump}px, scale drift ${report.scaleDrift}`,
        ...(report.warnings.length ? report.warnings : ["no warnings"]),
      ]);
      break;
    }
    case "run": {
      const key = values.key ?? "auto";
      if (key !== "auto" && key !== "none") normalizeColor(key, "--key");
      const out = stepRun(requirePositional(positionals, "<sheet-raw>"), {
        rows: num(requireFlag(values.rows, "--rows"), "--rows", { integer: true, min: 1 }),
        cols: num(requireFlag(values.cols, "--cols"), "--cols", { integer: true, min: 1 }),
        out: requireFlag(values.out, "--out"),
        name: requireFlag(values.name, "--name"),
        fps: num(requireFlag(values.fps, "--fps"), "--fps", { min: 1 }),
        loop: pickLoop(values),
        anchor: pickAnchor(values.anchor),
        key,
        cell: parseCell(values.cell),
        pad: num(values.pad, "--pad", { integer: true, min: 0, fallback: DEFAULT_PAD }),
        smooth: values.smooth,
        scale: num(values.scale, "--scale", { min: 0.01, fallback: 1 }),
        nearest: values.nearest,
        margin: num(values.margin, "--margin", { integer: true, min: 0, fallback: 0 }),
        gutter: num(values.gutter, "--gutter", { integer: true, min: 0, fallback: 0 }),
        width: values.width === undefined ? null : num(values.width, "--width", { integer: true, min: 1 }),
        webp: !values["no-webp"],
        threshold,
        similarity: num(values.similarity, "--similarity", { min: 0, fallback: DEFAULT_SIMILARITY }),
        blend: num(values.blend, "--blend", { min: 0, fallback: DEFAULT_BLEND }),
      });
      emit(values, out, [
        `${out.name}: ${out.frames.length} frames of ${out.cell.width}x${out.cell.height} → ${out.motionDir}`,
        ...(out.warnings.length ? out.warnings : ["no warnings"]),
      ]);
      break;
    }
    default:
      fail(`unhandled subcommand '${command}'`);
  }
}

main();

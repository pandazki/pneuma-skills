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
  copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync,
  rmSync, statSync, unlinkSync, writeFileSync,
} from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
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
/** Keying that leaves this much of the sheet opaque did not find a background. */
const KEYED_OPAQUE_ALERT = 0.9;
/** A frame drawn on less than this fraction of its cell is "nearly empty". */
const NEARLY_EMPTY_COVERAGE = 0.02;
/** An anchor moving more than this fraction of the cell width between two
 *  consecutive frames reads as a jump, not as motion. */
const MAX_JUMP_FRACTION = 0.08;
/** Relative spread of bbox heights above which the character is being drawn at
 *  different scales from frame to frame. */
const MAX_SCALE_DRIFT = 0.15;
/** Warning lists are truncated so a broken sheet cannot flood the agent. */
const MAX_LISTED = 6;
/** Pre-align grid cells `run` leaves next to `frames/`: what `inspect` judges
 *  "leaves its grid cell" on, and what re-aligning a motion re-reads. */
const CELLS_DIRNAME = "cells";
/** What `align` leaves in the frames dir so `pack` can declare the pivot it
 *  actually used instead of guessing the cell edge. */
const ALIGN_RECORD = "align.json";

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
      Records the point it used in <dir>/${ALIGN_RECORD}, so pack declares
      that pivot instead of assuming the cell edge.

  pack <framesDir> --out <sheet.png> --atlas <atlas.json> --name <motionId>
       --fps N [--loop] [--anchor bottom|center] [--cols C] [--scale 1] [--nearest]
      Row-major atlas image + TexturePacker-JSON-hash-compatible atlas.json.
      The pivot is the anchor point <framesDir>/${ALIGN_RECORD} recorded (also
      copied into meta.anchorPoint in pixels, scaled with --scale); frames
      aligned elsewhere fall back to {0.5,1} / {0.5,0.5} with a note on stderr.

  gif <framesDir> --out <preview.gif> --fps N [--loop|--no-loop]
      [--webp <preview.webp>] [--width W]
      Palette GIF with a reserved transparent entry; optional animated WebP.

  inspect <motionDir> [--anchor bottom|center] [--cells <dir>] [--threshold ${DEFAULT_THRESHOLD}]
      Frame count, cell, per-frame bboxes, anchor drift, max jump, scale
      drift, empty frames and human warnings. Writes <motionDir>/inspect.json.
      --cells points at the pre-align grid cells so "leaves its grid cell"
      can be judged on the raw crop rather than the padded frame; it defaults
      to <motionDir>/${CELLS_DIRNAME} when 'run' left that directory there.

  run <sheet-raw> --rows R --cols C --out <motionDir> --name <motionId> --fps N
      [--alpha <png>] [--force] [--loop] [--anchor bottom|center]
      [--key auto|#rrggbb|none] [--cell auto|WxH]
      [--pad ${DEFAULT_PAD}] [--smooth] [--scale 1] [--nearest] [--margin 0] [--gutter 0]
      [--width W] [--no-webp] [--threshold ${DEFAULT_THRESHOLD}]
      probe -> key (only when the sheet is opaque) -> slice -> align -> pack
      -> gif (+webp) -> inspect. An outside sheet is copied in, never moved.
      The pre-align cells are kept as <motionDir>/${CELLS_DIRNAME}/NN.png so the
      report can be reproduced and the alignment redone without re-slicing.

      <motionDir>/sheet-raw.png is the only copy of what the model drew, so it
      is never overwritten by accident:
        - a sheet from OUTSIDE <motionDir> is copied to sheet-raw.png; when a
          different sheet-raw.png is already there, --force is required
          (a regeneration is the legitimate case, and says so).
        - <motionDir>/sheet-raw.png itself is used where it lies.
        - <motionDir>/sheet-alpha.png itself is used as the already-keyed
          sheet: no probe, no key, sheet-raw.png untouched.
        - any OTHER file inside <motionDir> is refused.
      --alpha <png> names an already-keyed sheet (e.g. from
      remove-background.mjs) at any path: it is copied to
      <motionDir>/sheet-alpha.png and sliced instead of keying.

Exit code 0 on success, 1 on failure with a one-line ERROR: on stderr.`;

// ---------------------------------------------------------------------------
// Process plumbing
// ---------------------------------------------------------------------------

/** A refusal this script knows how to phrase, as opposed to a crash. */
class SpriteSheetError extends Error {}

/**
 * Refuse the current command. This THROWS rather than calling `process.exit`:
 * exiting from inside a step skips every enclosing `finally`, which used to
 * leave scratch directories and half-written `.tmp` renders on disk after each
 * failure. `main` is the single place that turns the throw into `ERROR:` + 1.
 */
function fail(message) {
  throw new SpriteSheetError(message);
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
  // Same shape as sprite-project.mjs::saveProject: a serialize or rename that
  // throws must not leave `atlas.json.tmp` sitting next to the real file,
  // where the next reader has to guess whether it is a leftover or a write in
  // flight. The rename itself is what makes the write atomic.
  try {
    writeFileSync(scratch, `${JSON.stringify(value, null, 2)}\n`);
    renameSync(scratch, out);
  } finally {
    if (existsSync(scratch)) rmSync(scratch, { force: true });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pixels
// ---------------------------------------------------------------------------

function probeSize(path, label) {
  const step = label ? `${label}: ` : "";
  const r = spawnSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", path],
    { encoding: "utf-8" },
  );
  if (r.error || r.status !== 0) fail(`${step}ffprobe failed for ${path}: ${(r.stderr || "").trim()}`);
  const [width, height] = String(r.stdout).trim().split(",").map(Number);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    fail(`${step}ffprobe returned bad dimensions for ${path}: '${String(r.stdout).trim()}' — the file is not a decodable image`);
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
    ["-v", "error", "-y", "-i", path, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "-"],
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
 *  the tail of a longer one, and the align record goes with the frames it
 *  describes: one left behind by a half-finished align would tell `pack`
 *  where an anchor sat in frames that no longer exist. */
function resetFramesDir(dir) {
  mkdirSync(dir, { recursive: true });
  for (const name of readdirSync(dir)) {
    if (FRAME_RE.test(name) || name === ALIGN_RECORD) unlinkSync(join(dir, name));
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

  // Where the anchor landed is a measurement, and only this step has it: with
  // --pad 8 a bottom-anchored character's feet sit 8px above the cell floor,
  // so an atlas that assumed the cell edge would hover it over the ground in
  // any engine that pivots on atlas.json. Written next to the frames it
  // describes, so a frames dir carries its own anchor wherever it is copied.
  const record = writeJsonFile(join(dir, ALIGN_RECORD), {
    anchor,
    cell: cellSize,
    pad,
    anchorPoint: { x: target.x, y: target.y },
    smooth,
  });

  return {
    inDir: resolve(framesDir),
    outDir: dir,
    anchor, pad, smooth,
    cell: cellSize,
    anchorPoint: { x: target.x, y: target.y },
    alignRecord: record,
    frames,
    emptyFrames,
    warnings,
  };
}

/**
 * Probe every frame and return the cell they all share.
 *
 * This is the gate in front of any encoder that reads the whole `%02d.png`
 * sequence: ffmpeg's image2 demuxer skips a frame it cannot decode and still
 * exits 0, so without this an undecodable or odd-sized PNG turns into a
 * preview that is silently one frame short of what the JSON claims. ffprobe
 * reports 0x0 for such a file, which `probeSize` already refuses by name.
 */
function uniformCell(entries, label) {
  const first = probeSize(entries[0].path, label);
  for (const entry of entries) {
    const size = probeSize(entry.path, label);
    if (size.width !== first.width || size.height !== first.height) {
      fail(`${label}: frames are not uniform: ${basename(entries[0].path)} is ${first.width}x${first.height} but ${basename(entry.path)} is ${size.width}x${size.height} — run align first`);
    }
  }
  return first;
}

/** Frames actually present in an encoded animation, or null when the format
 *  cannot be counted (ffprobe cannot read animated WebP at all). */
function countEncodedFrames(path) {
  const r = spawnSync(
    "ffprobe",
    ["-v", "error", "-count_frames", "-select_streams", "v:0",
      "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", path],
    { encoding: "utf-8" },
  );
  if (r.error || r.status !== 0) return null;
  const count = Number(String(r.stdout).trim());
  return Number.isInteger(count) && count > 0 ? count : null;
}

/**
 * The anchor point `align` measured for these frames, or null when nothing
 * measured them.
 *
 * A frames dir that never went through `align` is a legitimate input (frames
 * drawn or aligned elsewhere), so a missing record is not a failure — but a
 * record that is there and unreadable is: silently falling back would hand the
 * caller a pivot that contradicts the file sitting next to the frames.
 */
function readAlignRecord(framesDir) {
  const path = join(resolve(framesDir), ALIGN_RECORD);
  if (!existsSync(path)) return null;
  let doc;
  try {
    doc = JSON.parse(readFileSync(path, "utf-8"));
  } catch (error) {
    fail(`${path} is not valid JSON (${error.message}) — delete it or re-run align`);
  }
  const finite = (v) => typeof v === "number" && Number.isFinite(v);
  const ok = doc && finite(doc.anchorPoint?.x) && finite(doc.anchorPoint?.y)
    && finite(doc.cell?.width) && finite(doc.cell?.height)
    && (doc.anchor === "bottom" || doc.anchor === "center");
  if (!ok) fail(`${path} is not an align record (needs anchor, cell and anchorPoint) — delete it or re-run align`);
  return {
    anchor: doc.anchor,
    cell: { width: doc.cell.width, height: doc.cell.height },
    anchorPoint: { x: doc.anchorPoint.x, y: doc.anchorPoint.y },
  };
}

/**
 * The pivot the atlas declares, and the pixel point it came from.
 *
 * `align` puts a bottom anchor at `H - pad`, not at `H`: with the old fixed
 * {0.5, 1} an engine pivoting on atlas.json floated the character `pad` pixels
 * above the ground. So the recorded point wins — but only when the record
 * describes THESE frames under THIS anchor. Every other case falls back to the
 * old default and says on stderr which one it was, because a pivot that is
 * assumed rather than measured must be distinguishable from one that is.
 */
function resolvePivot(framesDir, { anchor, width, height }) {
  const fallbackPivot = anchor === "center" ? { x: 0.5, y: 0.5 } : { x: 0.5, y: 1 };
  const fallback = (reason) => {
    console.error(`note: ${reason} — the atlas pivot falls back to the ${anchor} default {${fallbackPivot.x}, ${fallbackPivot.y}}`);
    return { pivot: fallbackPivot, anchorPoint: null };
  };

  const record = readAlignRecord(framesDir);
  if (!record) {
    return fallback(`no ${ALIGN_RECORD} in ${resolve(framesDir)}, so nothing recorded where the anchor landed`);
  }
  if (record.cell.width !== width || record.cell.height !== height) {
    return fallback(`${ALIGN_RECORD} describes a ${record.cell.width}x${record.cell.height} cell but these frames are ${width}x${height}`);
  }
  if (record.anchor !== anchor) {
    return fallback(`these frames were aligned on '${record.anchor}' but --anchor ${anchor} was given`);
  }
  return {
    pivot: { x: round(record.anchorPoint.x / width, 4), y: round(record.anchorPoint.y / height, 4) },
    anchorPoint: record.anchorPoint,
  };
}

function stepPack(framesDir, { out, atlas, name, fps, loop, anchor, cols, scale, nearest }) {
  const entries = listFrames(resolve(framesDir));
  const { width, height } = uniformCell(entries, "pack");
  const { pivot, anchorPoint } = resolvePivot(framesDir, { anchor, width, height });

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
  // The normalized pivot is a ratio and survives --scale untouched; the pixel
  // point rides the same resize the cells did.
  const scaledAnchor = anchorPoint
    ? { x: round(anchorPoint.x * scale, 4), y: round(anchorPoint.y * scale, 4) }
    : null;
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
      // Present only when `align` measured it: an absent key says "this pivot
      // is the anchor's default, not a measurement".
      ...(scaledAnchor ? { anchorPoint: scaledAnchor } : {}),
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
    pivot,
    ...(scaledAnchor ? { anchorPoint: scaledAnchor } : {}),
    grid: { rows, cols: columns },
    cell: { width: cellW, height: cellH },
    size,
    frameCount: entries.length,
  };
}

function hasLibwebp() {
  const r = spawnSync("ffmpeg", ["-v", "error", "-hide_banner", "-encoders"], { encoding: "utf-8" });
  return r.status === 0 && String(r.stdout).includes("libwebp");
}

function stepGif(framesDir, { out, fps, loop, webp, width }) {
  const dir = resolve(framesDir);
  const entries = listFrames(dir);
  const source = uniformCell(entries, "gif");
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

  // The probe above rejects a frame ffprobe cannot measure; this catches the
  // rest — a file whose header reads but whose pixels do not decode is dropped
  // by the encoder without a word.
  const encoded = countEncodedFrames(gifPath);
  if (encoded !== null && encoded !== entries.length) {
    fail(`gif: ${gifPath} holds ${encoded} of the ${entries.length} frames in ${dir} — a frame could not be decoded`);
  }

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
function stepInspect(motionDir, { anchor, threshold, cellsDir, cellBoxes, write = true }) {
  const dir = resolve(motionDir);
  const framesDir = existsSync(join(dir, "frames")) ? join(dir, "frames") : dir;
  const entries = listFrames(framesDir);
  // `run` leaves the pre-align cells beside the frames, so a plain
  // `inspect <motionDir>` reproduces the clipping report `run` printed
  // instead of quietly judging it on the padded frames.
  const cells = cellsDir ?? (existsSync(join(dir, CELLS_DIRNAME)) ? join(dir, CELLS_DIRNAME) : null);

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
  const nearlyEmpty = measured.filter((f) => f.bbox && f.coverage < NEARLY_EMPTY_COVERAGE).map((f) => f.index);

  // "Leaves its grid cell" is a statement about the raw crop: judge it on the
  // pre-align cells when the caller has them, never on a padded frame.
  // `cellBoxes` lets a caller that already measured those cells (see `run`,
  // which gets all of them out of one decode of the sheet) skip the re-decode.
  const clipSource = cellBoxes ?? (cells
    ? listFrames(resolve(cells)).map((entry) => {
        const image = readRgba(entry.path);
        return { index: entry.index, width: image.width, height: image.height, ...computeBbox(image, threshold) };
      })
    : measured);
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
  if (jumpPair && maxJump > MAX_JUMP_FRACTION * cellW) {
    warnings.push(`anchor jumps between frames ${pad(jumpPair[0])} and ${pad(jumpPair[1])}`);
  }
  if (scaleDrift > MAX_SCALE_DRIFT) {
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
  // The point `align` put the anchor on, when these very frames carry it: the
  // viewer draws its pivot guide there, and the atlas declares the same point.
  const record = readAlignRecord(framesDir);
  const measuredAnchor = record && record.anchor === anchor
    && record.cell.width === cellW && record.cell.height === cellH
    ? record.anchorPoint
    : null;

  const report = {
    ...summary,
    motionDir: dir,
    framesDir,
    ...(cells ? { cellsDir: resolve(cells) } : {}),
    anchor,
    ...(measuredAnchor ? { anchorPoint: measuredAnchor } : {}),
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

/** True when `target` sits anywhere in the subtree rooted at `dir`. */
function isInside(dir, target) {
  const rel = relative(dir, target);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/** Byte-for-byte equality — the question `run` asks before replacing a sheet.
 *  Size first, so two differently sized sheets never get fully read. */
function sameBytes(a, b) {
  if (statSync(a).size !== statSync(b).size) return false;
  return readFileSync(a).equals(readFileSync(b));
}

/**
 * Decide which sheets this run works from, without ever destroying the raw one.
 *
 * `<motionDir>/sheet-raw.png` is the only copy of what the model drew. `run`
 * used to copy its input there unconditionally, so the documented keying
 * detour — key `sheet-raw.png` into `sheet-alpha.png`, then
 * `run <motionDir>/sheet-alpha.png --out <motionDir>` — silently replaced the
 * un-keyed original with the keyed sheet, and `<motion>-sheet-raw` ended up
 * pointing at a keyed file. Placement now decides:
 *   - inside <motionDir>: only sheet-raw.png (used as-is) and sheet-alpha.png
 *     (used as the already-keyed sheet); anything else is refused.
 *   - outside: copied in, but a *different* existing raw sheet is replaced
 *     only with --force.
 * Returns the raw sheet actually on disk (null when there is none) and the
 * already-keyed sheet, if one was provided rather than keyed here.
 */
function resolveRunSheets(input, motionDir, { alpha, force }) {
  const sheetRawPath = join(motionDir, "sheet-raw.png");
  const sheetAlphaPath = join(motionDir, "sheet-alpha.png");

  const alphaInput = alpha ? resolve(alpha) : null;
  if (alphaInput && !existsSync(alphaInput)) fail(`--alpha: file not found: ${alphaInput}`);

  const inPlaceAlpha = input === sheetAlphaPath;
  /** Neither in-place name: this sheet has to be copied in to be used. */
  const fromElsewhere = !inPlaceAlpha && input !== sheetRawPath;
  const identicalRaw = fromElsewhere && existsSync(sheetRawPath) && sameBytes(input, sheetRawPath);

  // Validate before touching anything, so a refusal leaves the directory
  // exactly as it was found.
  if (inPlaceAlpha && alphaInput && alphaInput !== input) {
    fail(`--alpha ${alphaInput} contradicts the input sheet ${input}: pass the already-keyed sheet once, either as the positional argument or as --alpha.`);
  }
  if (fromElsewhere) {
    if (isInside(motionDir, input)) {
      fail(`${input} is inside --out ${motionDir}: only sheet-raw.png and sheet-alpha.png can be used in place. Keep the sheet outside the motion directory, or pass an already-keyed sheet with --alpha.`);
    }
    if (existsSync(sheetRawPath) && !identicalRaw && !force) {
      fail(`${sheetRawPath} already holds a different sheet. Pass --force to replace the previous raw sheet, or point --out at another motion directory.`);
    }
  }

  // An identical raw sheet is left alone: re-running from the same source must
  // not rewrite the file, and `input` may even be a link to it.
  if (fromElsewhere && !identicalRaw) copyFileSync(input, sheetRawPath);
  if (alphaInput && alphaInput !== sheetAlphaPath) copyFileSync(alphaInput, sheetAlphaPath);

  const rawOnDisk = existsSync(sheetRawPath) ? sheetRawPath : null;
  if (!rawOnDisk) {
    // Only reachable through the in-place alpha form. Say it out loud rather
    // than emitting a sheetRaw path that is not there.
    console.error(`note: no sheet-raw.png in ${motionDir} — this run records only the alpha sheet`);
  }
  return {
    sheetRawPath: rawOnDisk,
    providedAlpha: (alphaInput || inPlaceAlpha) ? sheetAlphaPath : null,
  };
}

function stepRun(sheetRaw, options) {
  const input = resolve(sheetRaw);
  if (!existsSync(input)) fail(`file not found: ${input}`);
  const motionDir = resolve(options.out);
  mkdirSync(motionDir, { recursive: true });

  const { sheetRawPath, providedAlpha } = resolveRunSheets(input, motionDir, options);

  const warnings = [];

  // Key only when the background really is opaque; a sheet that already has
  // alpha is left exactly as generated, and a sheet keyed elsewhere is taken
  // at its word (no probe, no key).
  let sheetAlpha = providedAlpha;
  let keyedHere = null;
  let keyColor;
  if (!providedAlpha) {
    const probe = stepProbe(sheetRawPath, options.threshold);
    const opaque = !probe.hasAlpha || probe.alphaCoverage >= OPAQUE_COVERAGE;
    if (options.key !== "none" && opaque) {
      const keyed = stepKey(sheetRawPath, {
        out: join(motionDir, "sheet-alpha.png"),
        color: options.key,
        similarity: options.similarity,
        blend: options.blend,
        threshold: options.threshold,
      });
      keyedHere = keyed.output;
      sheetAlpha = keyed.output;
      keyColor = keyed.color;
      if (keyed.alphaCoverage > KEYED_OPAQUE_ALERT) {
        warnings.push(`keying ${keyed.color} left ${(keyed.alphaCoverage * 100).toFixed(0)}% of the sheet opaque — check the background colour`);
      }
    }
  }

  const source = sheetAlpha ?? sheetRawPath;
  // The cells stay next to the frames rather than in a temp dir that dies with
  // the process: they are what `inspect` judges "leaves its grid cell" on, and
  // what `align <motionDir>/cells --out <motionDir>/frames` re-reads when only
  // the alignment has to be redone. `resetFramesDir` keeps them in step with
  // the frames, so a shorter re-run cannot leave a stale tail.
  const cellsDir = join(motionDir, CELLS_DIRNAME);
  const sliced = stepSlice(source, {
    rows: options.rows, cols: options.cols, out: cellsDir,
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

  const aligned = stepAlign(cellsDir, {
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
    cellsDir,
    cellBoxes: bboxes.map((bbox, index) => ({
      index, width: sliced.cell.width, height: sliced.cell.height, bbox,
    })),
  });
  warnings.push(...summary.warnings.filter((w) => !warnings.includes(w)));

  return {
    motionDir,
    name: options.name,
    grid: { rows: options.rows, cols: options.cols },
    ...(sheetRawPath ? { sheetRaw: sheetRawPath } : {}),
    ...(sheetAlpha ? { sheetAlpha } : {}),
    ...(providedAlpha ? { alphaSource: "provided" } : {}),
    keyed: Boolean(keyedHere),
    ...(keyColor ? { keyColor } : {}),
    cells: cellsDir,
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
    alpha: { type: "string" }, force: { type: "boolean", default: false },
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
        `aligned ${out.frames.length} frames on a ${out.cell.width}x${out.cell.height} cell (${out.anchor} anchor at ${out.anchorPoint.x},${out.anchorPoint.y})`,
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
      emit(values, out, [
        `packed ${out.frameCount} frames into ${out.size.w}x${out.size.h} → ${out.sheet} (pivot ${out.pivot.x},${out.pivot.y})`,
      ]);
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
        alpha: values.alpha ?? null,
        force: values.force,
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

try {
  main();
} catch (error) {
  if (error instanceof SpriteSheetError) {
    console.error(`ERROR: ${error.message}`);
  } else {
    // A crash is still a one-line ERROR: first, so the agent reads the same
    // shape either way; the stack follows for whoever has to fix it.
    console.error(`ERROR: unexpected failure: ${error?.message ?? error}`);
    if (error?.stack) console.error(error.stack);
  }
  process.exit(1);
}

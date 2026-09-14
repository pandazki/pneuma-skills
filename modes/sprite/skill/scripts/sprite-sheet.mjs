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
 * Subcommands: probe, key, flatten, slice, align, pack, gif, inspect, run,
 * contact, from-video.
 * `--json` prints exactly one JSON object on stdout; progress goes to stderr.
 */

import { spawnSync } from "node:child_process";
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync,
  rmSync, statSync, unlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
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
/** The bottom slice of the bbox that counts as "the feet" — the part of the
 *  drawing that stands on the ground, as opposed to the part that waves a
 *  prop around. 10% of the bbox height, so it scales with the character. */
const FEET_BAND = 0.1;
/** Feet wandering more than this fraction of the cell width across the frames
 *  is a body that visibly slides sideways during playback, not animation. */
const MAX_BODY_DRIFT_FRACTION = 0.05;
/** Where `align` may take each frame's x from. */
const X_FROM_MODES = ["feet", "bbox", "cell"];
/** Relative spread of bbox heights above which the character is being drawn at
 *  different scales from frame to frame. */
const MAX_SCALE_DRIFT = 0.15;
/** Warning lists are truncated so a broken sheet cannot flood the agent. */
const MAX_LISTED = 6;
/** A connected alpha blob smaller than this share of the largest one is a
 *  candidate for removal. Anything bigger is part of the design — a lantern
 *  held away from the body, a detached weapon — and is never dropped, wherever
 *  it sits. Measured against the BODY, not the cell, so the rule scales with
 *  the character rather than with the resolution it was drawn at. */
const CLEAN_KEEP_RATIO = 0.02;
/** Cleaning that takes more than this share of a cell's ink is worth a
 *  sentence: at that point the sheet is the thing to look at, not the cleaner.
 *  The denominator is the cell's OPAQUE pixels, not its area — 5% of a mostly
 *  empty cell is a threshold nothing could ever cross. */
const CLEAN_ALERT_FRACTION = 0.05;
/**
 * Colorkey similarity for frames sampled out of a video, against
 * DEFAULT_SIMILARITY for a generated sheet.
 *
 * A sheet's plate is one exact colour in every pixel; a 480p h264 clip's
 * "solid" green is not — chroma subsampling, quantisation and the model's own
 * lighting spread it over a range. Measured on the validation clip
 * (Seedance 2.5, 480p, chroma green): see `references/video-preview.md`.
 */
const DEFAULT_VIDEO_SIMILARITY = 0.22;
/** How far short of the clip's end the last sample is pulled, so a timestamp
 *  that lands exactly on the duration still decodes a frame. */
const SAMPLE_TAIL = 0.001;

// --- contact: looking at a clip before sampling it -------------------------
/** Stills on a contact sheet, unless --count / --every say otherwise. */
const DEFAULT_CONTACT_COUNT = 24;
const DEFAULT_CONTACT_COLS = 8;
const DEFAULT_CONTACT_WIDTH = 160;
/** Gutter between tiles, and the neutral grey behind them. Grey rather than
 *  black or white so neither a dark silhouette nor a blown-out highlight
 *  disappears into the background of the picture. */
const CONTACT_GUTTER = 2;
const CONTACT_BACKGROUND = "0x808080";
/** A contact sheet past this many stills is a wall of thumbnails nobody can
 *  read, and a --every of the wrong order of magnitude produces it instantly. */
const MAX_CONTACT_STILLS = 200;
/** Width the silhouettes are compared at. The question is "did the pose
 *  change", which survives a 96px raster; the answer costs one byte per pixel
 *  per analysed frame, so this is what keeps a minute of video in memory. */
const ANALYSIS_WIDTH = 96;
/** Frames per second the analysis looks at. A gait cycle is ~1s, so 12
 *  samples of it is plenty, and a 60fps clip costs no more than a 24fps one. */
const MAX_ANALYSIS_FPS = 12;
/** Seconds of the trimmed window that get analysed. Past this the answer stops
 *  being about one motion, and the D^2 loop search stops being cheap. */
const MAX_ANALYSIS_SECONDS = 60;
/** Fraction of the combined ink that has to change before two silhouettes are
 *  different poses rather than the same pose plus codec noise. */
const STILL_DIFF = 0.05;
/** A loop window has to move at least this much somewhere inside it, or a
 *  stretch of held pose would score a perfect seam and win. */
const LOOP_MOTION_DIFF = 0.25;
/** Period range a walk / idle cycle is looked for in, in seconds. */
const LOOP_PERIOD_MIN = 0.4;
const LOOP_PERIOD_MAX = 2.5;
/** Loop candidates reported. Three, because the best seam is a measurement
 *  and the right cycle is a judgement — the agent needs alternatives. */
const MAX_LOOPS = 3;
/** Pre-align grid cells `run` leaves next to `frames/`: what `inspect` judges
 *  "leaves its grid cell" on, and what re-aligning a motion re-reads. */
const CELLS_DIRNAME = "cells";
/** What `align` leaves in the frames dir so `pack` can declare the pivot it
 *  actually used instead of guessing the cell edge. */
const ALIGN_RECORD = "align.json";

const SUBCOMMANDS = [
  "probe", "key", "flatten", "slice", "clean", "align", "pack", "gif",
  "inspect", "run", "contact", "from-video",
];

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

  clean <cellsDir> --out <dir> [--threshold ${DEFAULT_THRESHOLD}]
      Drop what is not the character out of every cell: keep the largest
      connected alpha blob plus anything at least ${CLEAN_KEEP_RATIO * 100}% of its area (a
      detached accessory is design), and remove the rest only where it
      touches a cell border or floats above the head / below the feet —
      i.e. a neighbouring cell's overspill and stray specks, never a prop
      the character is holding. Reports cleaned[] and warns on any cell that
      lost more than ${CLEAN_ALERT_FRACTION * 100}% of its ink. --out may be the input directory.

  align <framesDir> --out <dir> [--anchor bottom|center] [--x-from feet|bbox|cell]
        [--cell auto|WxH] [--pad ${DEFAULT_PAD}] [--smooth] [--threshold ${DEFAULT_THRESHOLD}]
      Re-place every frame so its anchor lands on the same point.
      y: bbox bottom (bottom) or bbox centre (center).
      x: --x-from feet (default) takes the mean x of the alpha pixels in the
      bottom ${FEET_BAND * 100}% of the bbox — where the character STANDS, so a prop
      swinging sideways no longer drags the body the other way; bbox takes the
      bbox centre (what --anchor center always uses, feet being no reference
      for an airborne pose); cell keeps the offset the drawing had inside its
      grid cell, i.e. no horizontal re-placement at all.
      --smooth replaces each frame's x with the 3-frame median so a one-frame
      wobble does not shove the body sideways; with --anchor center the same
      median is applied to y.
      Records the point and the x mode it used in <dir>/${ALIGN_RECORD}, so
      pack declares that pivot instead of assuming the cell edge.

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
      Frame count, cell, per-frame bboxes, anchor drift, body drift, max jump,
      scale drift, empty frames and human warnings. Writes
      <motionDir>/inspect.json.
      --cells points at the pre-align grid cells so "leaves its grid cell"
      can be judged on the raw crop rather than the padded frame; it defaults
      to <motionDir>/${CELLS_DIRNAME} when 'run' left that directory there.

  run <sheet-raw> --rows R --cols C --out <motionDir> --name <motionId> --fps N
      [--alpha <png>] [--force] [--loop] [--anchor bottom|center]
      [--x-from feet|bbox|cell] [--key auto|#rrggbb|none] [--cell auto|WxH]
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
      Cleaning runs by default; --no-clean skips it.

  contact <clip> --out <png> [--count ${DEFAULT_CONTACT_COUNT} | --every s] [--cols ${DEFAULT_CONTACT_COLS}] [--width ${DEFAULT_CONTACT_WIDTH}]
      [--trim-start s] [--trim-end s] [--key auto|#rrggbb|none]
      [--similarity ${DEFAULT_VIDEO_SIMILARITY}] [--blend ${DEFAULT_BLEND}] [--threshold ${DEFAULT_THRESHOLD}]
      Look at a clip before sampling it. Writes ONE contact sheet: --count
      stills spaced evenly across the (trimmed) clip (both ends included), or
      one still every --every seconds from the trim start — the two are
      mutually exclusive. Each still is --width px wide, timestamp burnt into
      its corner, tiled --cols per row with a ${CONTACT_GUTTER}px grey gutter.
      Also reports, from a deterministic silhouette analysis (no model):
        stillStart / stillEnd — when the opening pose breaks and the closing
          hold begins, i.e. the dead frames at either end;
        loops[] — the best ${MAX_LOOPS} windows between ${LOOP_PERIOD_MIN}s and ${LOOP_PERIOD_MAX}s whose ends match,
          each with its seam (how different the two ends are) and step (how
          much a frame moves inside it): seam << step is a clean cycle;
        profile.deltas — the frame-to-frame change series, the clip's rhythm.
      The contact sheet is a working file for your eyes, not an asset: the
      stills live in a temp dir that is removed, and nothing is written to a
      motion directory or to project.json.

  from-video <clip> --out <motionDir> --name <motionId> --frames N | --at t1,t2,…
      [--fps N] [--loop|--no-loop] [--anchor bottom|center]
      [--x-from feet|bbox|cell] [--key auto|#rrggbb|none]
      [--trim-start s] [--trim-end s] [--no-clean] [--cell auto|WxH]
      [--pad ${DEFAULT_PAD}] [--smooth] [--scale 1] [--nearest] [--width W] [--no-webp]
      [--cols C] [--similarity ${DEFAULT_VIDEO_SIMILARITY}] [--blend ${DEFAULT_BLEND}] [--threshold ${DEFAULT_THRESHOLD}]
      The video source: sample -> key -> clean -> align -> pack -> gif (+webp)
      -> inspect. There is no sheet — --frames frames are cut evenly out of
      the (trimmed) clip into <motionDir>/${CELLS_DIRNAME}/NN.png and the rest of the
      chain is the one 'run' drives.
      --key auto takes the median of frame 00's four corner patches (the
      chroma green, when the clip was shot as instructed) and keys every
      frame with it, at a wider default similarity than a generated sheet
      needs because a codec's "solid" green is a range.
      --trim-start / --trim-end are TIMESTAMPS in seconds, like ffmpeg's
      -ss / -to; --trim-end defaults to the clip's duration.
      --loop stops one step short of the end (frame 00 already holds the
      closing pose); --no-loop samples both ends.
      --fps defaults to frames / trimmed duration, so the preview plays at
      the speed the clip was shot at.
      --at names the sample times yourself — a comma-separated list of
      seconds, repeatable, 2 to ${MAX_FRAMES} strictly increasing entries inside the
      clip (run 'contact' first to find them). It replaces the even schedule
      and so excludes --frames, --trim-start and --trim-end; with --at,
      --loop/--no-loop only decide the gif and the atlas, not the sampling.
      --fps then defaults to the mean sampling rate, (N-1) / (last - first).
      The JSON says which schedule ran: "even" or "explicit".
      The clip is only read: it is never copied or moved into <motionDir>.

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

/** `input`, when given, is fed to ffmpeg's stdin — the only way raw pixels
 *  computed here become a PNG. stdin is never inherited either way. */
function ffmpeg(args, label, input) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], {
    ...(input === undefined ? {} : { input, maxBuffer: MAX_RAW_BYTES }),
    encoding: "utf-8",
  });
  if (r.error) fail(`${label}: could not run ffmpeg (${r.error.message})`);
  if (r.status !== 0) fail(`${label}: ffmpeg failed\n${(r.stderr || "").trim()}`);
}

/**
 * Render through a scratch file next to the destination and rename, so a
 * reader never sees a half-encoded image. The scratch keeps the final
 * extension because ffmpeg picks its muxer from it.
 */
function ffmpegTo(outPath, buildArgs, label, input) {
  const out = resolve(outPath);
  mkdirSync(dirname(out), { recursive: true });
  const scratch = join(dirname(out), `.${basename(out, extname(out))}.tmp${extname(out)}`);
  try {
    ffmpeg([...buildArgs(scratch), "--", scratch], label, input);
    renameSync(scratch, out);
  } finally {
    if (existsSync(scratch)) rmSync(scratch, { force: true });
  }
  return out;
}

/** Encode a decoded RGBA image back to a PNG. The inverse of `readRgba`, and
 *  the only way a buffer this script edited in memory reaches disk. */
function writeRgbaPng(outPath, image, label) {
  return ffmpegTo(outPath, () => [
    "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${image.width}x${image.height}`, "-i", "-",
    "-frames:v", "1", "-pix_fmt", "rgba",
  ], label, image.data);
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

/**
 * Mean x of the alpha pixels in the bottom FEET_BAND of the bbox: where the
 * character stands, as opposed to where its silhouette happens to be centred.
 *
 * The mean, not the midpoint of the extent, because the two disagree exactly
 * when it matters. Measured on the Lumi attack sheet, the lantern sweeps down
 * past the front foot in frames 09-11 and enters the band: the extent midpoint
 * jumps 14 px on frame 10 and back again (it only takes ONE pixel at the new
 * edge), while the mass-weighted mean moves ~2 px, because the lantern's few
 * hundred pixels cannot outvote the body's thousand. Frame-to-frame, the mean
 * is the smoother of the two on that fixture (max step 35 px vs 36.5 px, and
 * no spurious 14/-22 px spike), so it is the one the body is pinned by.
 *
 * A non-null bbox always has at least one pixel in its bottom row, so the
 * fallback is unreachable in practice; it is there so a threshold change can
 * never turn this into a NaN that silently poisons every offset.
 */
function feetCenterX(image, bbox, threshold) {
  const bandHeight = Math.max(1, Math.round(bbox.h * FEET_BAND));
  const top = bbox.y + bbox.h - bandHeight;
  let sum = 0, count = 0;
  for (let y = top; y < bbox.y + bbox.h; y++) {
    const row = y * image.width;
    for (let x = bbox.x; x < bbox.x + bbox.w; x++) {
      if (image.data[(row + x) * 4 + 3] < threshold) continue;
      // Pixel centres, so a solid run x0..x1 averages to the same
      // half-integer `anchorOf` calls the bbox centre.
      sum += x + 0.5;
      count++;
    }
  }
  return count ? sum / count : bbox.x + bbox.w / 2;
}

/**
 * Everything one decode of a frame can say about its geometry. `align` and
 * `inspect` both need bbox AND feet, and `run` gets all of them out of a
 * single decode of the sheet — so the pass that reads the pixels answers
 * every question at once instead of being run twice.
 */
function measureFrame(image, threshold) {
  const { bbox, coverage } = computeBbox(image, threshold);
  return { bbox, coverage, feetX: bbox ? feetCenterX(image, bbox, threshold) : null };
}

/**
 * Connected components of the alpha mask, 4-connectivity, one pass.
 *
 * 4-connectivity on purpose: 8-connectivity welds a fragment to the body
 * through a single diagonally touching pixel, which is exactly the kind of
 * accident this is meant to survive. The flood is iterative — a 512px cell is
 * a quarter-million pixels and a recursive fill blows the stack on a large
 * silhouette.
 */
function alphaComponents(image, threshold) {
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
    let area = 0, x0 = width, y0 = height, x1 = -1, y1 = -1;
    while (top > 0) {
      const p = stack[--top];
      const x = p % width;
      const y = (p - x) / width;
      area++;
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
    components.push({ id, area, bbox: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } });
  }
  return { labels, components };
}

/**
 * Erase what is not the character from one cell, in place.
 *
 * The keep rule, in the order it is asked:
 *   1. the largest blob is the character;
 *   2. anything at least CLEAN_KEEP_RATIO of it is design — a lantern held at
 *      arm's length, a thrown weapon, a detached shadow the artist drew;
 *   3. of what is left, only blobs that TOUCH A CELL BORDER (the neighbouring
 *      cell bleeding in) or float clear above the head / below the feet
 *      (specks) are dropped. A small blob beside the body — a hand, a
 *      separated hair strand — is kept, because at that size and position it
 *      is far more likely to be the drawing than litter.
 *
 * Dropping is all four bytes, not just alpha: a transparent pixel that still
 * carries colour bleeds back the moment anything rescales the cell.
 */
function cleanCell(image, threshold) {
  const { width, height, data } = image;
  const { labels, components } = alphaComponents(image, threshold);
  const ink = components.reduce((sum, c) => sum + c.area, 0);
  if (components.length < 2) return { removedComponents: 0, removedPixels: 0, ink };

  const main = components.reduce((best, c) => (c.area > best.area ? c : best), components[0]);
  const mainTop = main.bbox.y;
  const mainBottom = main.bbox.y + main.bbox.h - 1;
  const drop = new Set();
  let removedPixels = 0;
  for (const c of components) {
    if (c.id === main.id) continue;
    if (c.area >= CLEAN_KEEP_RATIO * main.area) continue;
    const touchesBorder = c.bbox.x === 0 || c.bbox.y === 0
      || c.bbox.x + c.bbox.w === width || c.bbox.y + c.bbox.h === height;
    const above = c.bbox.y + c.bbox.h - 1 < mainTop;
    const below = c.bbox.y > mainBottom;
    if (!touchesBorder && !above && !below) continue;
    drop.add(c.id);
    removedPixels += c.area;
  }
  if (!drop.size) return { removedComponents: 0, removedPixels: 0, ink };

  for (let p = 0; p < width * height; p++) {
    if (!drop.has(labels[p])) continue;
    data.fill(0, p * 4, p * 4 + 4);
  }
  return { removedComponents: drop.size, removedPixels, ink };
}

/** The JSON half of cleaning: what came off each cell, and the cells where
 *  enough came off that the sheet itself deserves a look. */
function cleanSummary(stats) {
  const cleaned = [];
  const warnings = [];
  for (const stat of stats) {
    if (!stat.removedComponents) continue;
    cleaned.push({
      cell: stat.index,
      removedComponents: stat.removedComponents,
      removedPixels: stat.removedPixels,
    });
    if (stat.ink > 0 && stat.removedPixels > CLEAN_ALERT_FRACTION * stat.ink) {
      warnings.push(`cell ${String(stat.index).padStart(2, "0")} lost ${(100 * stat.removedPixels / stat.ink).toFixed(0)}% to cleaning — check the sheet`);
    }
  }
  return { cleaned, warnings };
}

/**
 * Erase the colour under every pixel the key made transparent. Returns how
 * many pixels were touched.
 *
 * ffmpeg's `colorkey` writes the ALPHA plane and leaves RGB exactly as it
 * was, so a keyed sheet is the character floating on a full green plate that
 * happens to be invisible — `colorkey` by name and by behaviour. Everything
 * that respects alpha sees nothing wrong, and everything that does not sees
 * the plate: a bilinear `scale` mixes those hidden greens into every edge, and
 * an alpha-ignoring consumer (an engine importing the sheet as RGB, a
 * thumbnailer) gets the plate back whole. The first packed video-sourced sheet
 * came out solid green for exactly this reason.
 *
 * The rule is `cleanCell`'s, applied to the keyer: transparency is all four
 * bytes, not just the fourth. The cut is the same alpha threshold the rest of
 * the script measures with — below it a pixel is not the character, so its
 * colour is the background's and has no business travelling.
 */
function zeroKeyedRgb(image, threshold) {
  const { data } = image;
  let zeroed = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] >= threshold) continue;
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0) continue;
    data[i] = 0;
    data[i + 1] = 0;
    data[i + 2] = 0;
    zeroed++;
  }
  return zeroed;
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
  // The keyed sheet is what `slice`, `align` and `pack` all copy pixels from,
  // so the plate has to go here — at the one point where it is created — not
  // at each of the places it would otherwise resurface. This costs no extra
  // decode: the coverage this step reports is measured on the same buffer.
  const keyed = readRgba(output);
  if (zeroKeyedRgb(keyed, threshold)) writeRgbaPng(output, keyed, "key");
  const { coverage } = computeBbox(keyed, threshold);
  return {
    input: resolve(input),
    output,
    color: resolved,
    similarity,
    blend,
    width: keyed.width,
    height: keyed.height,
    alphaCoverage: round(coverage, 4),
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

/**
 * Clean a directory of cells into another (or over itself).
 *
 * `run` and `from-video` do not come through here: they already hold each
 * cell's pixels, so they call `cleanCell` in their own loop and skip a second
 * decode. This is the standalone form — for cells sliced by hand, or for a
 * re-clean at a different threshold.
 */
function stepClean(cellsDir, { out, threshold }) {
  const inDir = resolve(cellsDir);
  const outDir = resolve(out);
  const entries = listFrames(inDir);
  // Writing into a different directory replaces its whole contents; writing
  // over the input must not delete the files still to be read.
  const inPlace = inDir === outDir;
  if (!inPlace) resetFramesDir(outDir);

  const stats = [];
  const frames = [];
  for (const entry of entries) {
    const image = readRgba(entry.path);
    const result = cleanCell(image, threshold);
    stats.push({ index: entry.index, ...result });
    const target = join(outDir, frameName(entry.index));
    // In place, an untouched cell is left exactly as it was found — a re-encode
    // would rewrite bytes nothing asked to change.
    if (result.removedPixels || !inPlace) writeRgbaPng(target, image, `clean cell ${entry.index}`);
    frames.push(target);
  }

  return { inDir, outDir, threshold, frames, ...cleanSummary(stats) };
}

function parseCell(value) {
  if (!value || value === "auto") return null;
  const m = /^(\d+)x(\d+)$/.exec(String(value).trim());
  if (!m) fail(`--cell: expected auto or WxH, got '${value}'`);
  return { width: Number(m[1]), height: Number(m[2]) };
}

/**
 * Width of the grid cell the source frames were cut from — the reference
 * `--x-from cell` measures against, and the one mode that needs it. `run`
 * already knows it (it did the slicing) and hands it in; a bare `align` probes
 * for it. Only the width is checked: x is all this mode derives, so frames of
 * differing heights are none of its business.
 */
function sourceCellWidth(entries, given) {
  if (given) return given.width;
  const first = probeSize(entries[0].path, "align");
  for (const entry of entries) {
    const size = probeSize(entry.path, "align");
    if (size.width !== first.width) {
      fail(`--x-from cell needs frames cut from one grid, but ${basename(entries[0].path)} is ${first.width}px wide and ${basename(entry.path)} is ${size.width}px — align these on --x-from feet or bbox instead`);
    }
  }
  return first.width;
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
 * cell. `measures` may be supplied by a caller that already decoded the source
 * (see `run`), which saves one decode per frame.
 */
function stepAlign(framesDir, { out, anchor, cell, pad, smooth, threshold, xFrom, measures: given, sourceCell }) {
  const entries = listFrames(resolve(framesDir));
  const measures = given ?? entries.map((entry) => measureFrame(readRgba(entry.path), threshold));
  if (measures.length !== entries.length) fail("internal: measurement count does not match frame count");
  const bboxes = measures.map((m) => m.bbox);

  const filled = bboxes.filter(Boolean);
  if (!filled.length) fail(`every frame in ${framesDir} is empty above alpha threshold ${threshold}`);

  // A center anchor is for poses with no feet on the ground, so its x has
  // always been the bbox centre and stays there: the `feet` default resolves
  // to `bbox` under it. What gets recorded and returned is what it resolved
  // to, never what was asked for — a record that claimed `feet` while the
  // pixels came from the bbox would be the silent kind of wrong.
  const xMode = anchor === "center" && xFrom === "feet" ? "bbox" : xFrom;
  const sourceWidth = xMode === "cell" ? sourceCellWidth(entries, sourceCell) : null;

  // Smoothing works on the *source* anchor, so a one-frame bbox wobble stops
  // shoving the body; the frame keeps its own offset from the smoothed anchor.
  const anchorsX = measures.map((m) => {
    if (!m.bbox) return null;
    // `cell`: every frame's reference is the same point of the same grid cell,
    // so the difference between two frames' offsets survives untouched — the
    // drawing is only moved vertically.
    if (xMode === "cell") return sourceWidth / 2;
    if (xMode === "feet") return m.feetX;
    return anchorOf(m.bbox, anchor).x;
  });
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

  // Sizing comes AFTER the anchor is known, because the anchor is what the
  // cell has to be big enough around. `max bbox width + 2·pad` was only ever
  // right while x came from the bbox centre; take x from the feet and the
  // drawing reaches further to one side than the other, so that width clamps
  // every frame against the cell edge — which puts the body back exactly where
  // it was shoved before (measured on the Lumi idle sheet: all 16 frames
  // clamped, feet landing 2px off the anchor and still drifting).
  //
  // So: how far does the drawing reach from its anchor, left or right, in the
  // worst frame — doubled, because the anchor stays in the middle of the cell
  // and the pivot stays {0.5, …}. For `bbox` this is identical to the old
  // formula (the reach is half the bbox either way); for `feet` it widens the
  // cell by however lopsided the pose is around the feet.
  let cellSize = cell;
  if (!cellSize) {
    const even = (n) => (n % 2 ? n + 1 : n);
    const reach = bboxes.map((b, i) => (b
      ? Math.max(targetsX[i] - b.x, b.x + b.w - targetsX[i])
      : 0));
    cellSize = {
      // In `cell` mode the drawing keeps the offset it had inside its grid
      // cell, so that grid cell IS the natural width: anything else would
      // shift exactly the offsets the mode exists to preserve.
      width: xMode === "cell"
        ? even(sourceWidth)
        : even(2 * Math.ceil(Math.max(...reach)) + 2 * pad),
      height: even(Math.max(...filled.map((b) => b.h)) + 2 * pad),
    };
  }

  for (const [i, box] of bboxes.entries()) {
    if (!box) continue;
    if (box.w > cellSize.width || box.h > cellSize.height) {
      fail(`frame ${frameName(i).slice(0, 2)} needs at least ${box.w}x${box.h} but the cell is ${cellSize.width}x${cellSize.height} — raise --pad or set --cell`);
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
    // Which x these frames were pinned by. `pack` does not need it, but the
    // next person asking "why does the body sit off-centre" does, and so does
    // anyone re-running align from the same cells.
    xFrom: xMode,
  });

  return {
    inDir: resolve(framesDir),
    outDir: dir,
    anchor, pad, smooth,
    xFrom: xMode,
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
    return {
      index: entry.index, path: entry.path,
      width: image.width, height: image.height,
      ...measureFrame(image, threshold),
    };
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

  // Where the character STANDS, frame to frame. `anchorDrift` measures the
  // silhouette, and a prop that swings sideways moves the silhouette without
  // moving the body — which is precisely how a bbox-centred alignment used to
  // pay for a lantern by shoving the body the other way. Reported for both
  // anchors: an airborne pose is aligned on its bbox centre, and this is then
  // the number that says whether the body slid while it was in the air.
  const feetX = measured.map((f) => f.feetX).filter((v) => v !== null);
  const bodyDrift = round(stdDev(feetX), 3);

  let maxJump = 0;
  let jumpPair = null;
  // The same walk over the feet. It is never reported — `maxJump` keeps its
  // definition — it only decides whether a moving anchor is worth a sentence:
  // with x taken from the feet a swinging prop moves the silhouette in every
  // frame BY DESIGN, and calling that a jump would tell the agent to go and
  // "fix" the one thing that is right. A character that genuinely lurches
  // takes its feet with it.
  let bodyJump = 0;
  for (let i = 1; i < anchors.length; i++) {
    if (!anchors[i] || !anchors[i - 1]) continue;
    const d = Math.hypot(anchors[i].x - anchors[i - 1].x, anchors[i].y - anchors[i - 1].y);
    if (d > maxJump) { maxJump = d; jumpPair = [i - 1, i]; }
    const feet = Math.abs(measured[i].feetX - measured[i - 1].feetX);
    if (feet > bodyJump) bodyJump = feet;
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
  if (jumpPair && maxJump > MAX_JUMP_FRACTION * cellW && bodyJump > MAX_JUMP_FRACTION * cellW) {
    warnings.push(`anchor jumps between frames ${pad(jumpPair[0])} and ${pad(jumpPair[1])}`);
  }
  if (bodyDrift > MAX_BODY_DRIFT_FRACTION * cellW) {
    warnings.push("body drifts sideways between frames — re-run align with --x-from feet/cell");
  }
  if (scaleDrift > MAX_SCALE_DRIFT) {
    warnings.push("character scale varies across frames — regenerate with a fixed-scale instruction");
  }
  warnings.push(...listAndTruncate(clipped, (i) => `cell ${pad(i)} is clipped — the drawing leaves its grid cell`));

  // The point `align` put the anchor on, when these very frames carry it: the
  // viewer draws its pivot guide there, and the atlas declares the same point.
  // It belongs to the SUMMARY, not just the fat report: `run` embeds the
  // summary as its `inspect` block and `register-run` copies that block into
  // project.json, which is the only thing the viewer reads. Left out of the
  // summary, the measurement stops at the report nobody downstream consumes.
  const record = readAlignRecord(framesDir);
  const measuredAnchor = record && record.anchor === anchor
    && record.cell.width === cellW && record.cell.height === cellH
    ? record.anchorPoint
    : null;

  const summary = {
    frameCount: measured.length,
    cell: { width: cellW, height: cellH },
    ...(measuredAnchor ? { anchorPoint: measuredAnchor } : {}),
    anchorDrift,
    bodyDrift,
    maxJump: round(maxJump, 3),
    scaleDrift,
    emptyFrames,
    warnings,
  };

  const report = {
    ...summary,
    motionDir: dir,
    framesDir,
    ...(cells ? { cellsDir: resolve(cells) } : {}),
    anchor,
    frames: measured.map((f) => ({
      index: f.index,
      bbox: f.bbox,
      coverage: round(f.coverage, 4),
      anchor: f.bbox ? { x: round(anchorOf(f.bbox, anchor).x, 2), y: round(anchorOf(f.bbox, anchor).y, 2) } : null,
      // Per frame, so "the body drifts" names the frame it drifts on — the
      // summary metric alone cannot.
      feetX: f.feetX === null ? null : round(f.feetX, 2),
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

/**
 * The half of the pipeline that does not care where the cells came from:
 * align -> pack -> gif (+webp) -> inspect. `run` cuts them out of a sheet,
 * `from-video` samples them out of a clip; past this point they are the same
 * N pictures, and both emit the same JSON because both ran this.
 *
 * `warnings` is the caller's list, appended to in the order the steps ran —
 * inspect's are added last and only when they are not already there.
 */
function finishMotion(motionDir, cellsDir, options, { measures, sourceCell, warnings }) {
  const framesDir = join(motionDir, "frames");
  const aligned = stepAlign(cellsDir, {
    out: framesDir,
    anchor: options.anchor,
    cell: options.cell,
    pad: options.pad,
    smooth: options.smooth,
    threshold: options.threshold,
    xFrom: options.xFrom,
    measures,
    sourceCell,
  });
  warnings.push(...aligned.warnings);

  const packed = stepPack(framesDir, {
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

  const preview = stepGif(framesDir, {
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
    cellBoxes: measures.map((m, index) => ({
      index, width: sourceCell.width, height: sourceCell.height, bbox: m.bbox,
    })),
  });
  warnings.push(...summary.warnings.filter((w) => !warnings.includes(w)));

  return { aligned, packed, preview, summary };
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
  // crop, so a cell's pixels are the sheet's pixels. Cleaning rides the same
  // pass — the cell is already in hand, and what it removes has to be gone
  // before the bbox that positions the frame is measured.
  const sheetImage = readRgba(source);
  const cleanStats = [];
  const measures = [];
  for (const cell of sliced.cells) {
    const image = {
      width: sliced.cell.width,
      height: sliced.cell.height,
      data: cropBuffer(sheetImage, cell.x, cell.y, sliced.cell.width, sliced.cell.height),
    };
    if (options.clean) {
      const result = cleanCell(image, options.threshold);
      cleanStats.push({ index: cell.index, ...result });
      if (result.removedPixels) {
        writeRgbaPng(join(cellsDir, frameName(cell.index)), image, `clean cell ${cell.index}`);
      }
    }
    measures.push(measureFrame(image, options.threshold));
  }
  const cleaned = options.clean ? cleanSummary(cleanStats) : null;
  if (cleaned) warnings.push(...cleaned.warnings);

  const { aligned, packed, preview, summary } = finishMotion(motionDir, cellsDir, options, {
    measures, sourceCell: sliced.cell, warnings,
  });

  return {
    motionDir,
    name: options.name,
    grid: { rows: options.rows, cols: options.cols },
    ...(sheetRawPath ? { sheetRaw: sheetRawPath } : {}),
    ...(sheetAlpha ? { sheetAlpha } : {}),
    ...(providedAlpha ? { alphaSource: "provided" } : {}),
    keyed: Boolean(keyedHere),
    ...(keyColor ? { keyColor } : {}),
    ...(cleaned ? { cleaned: cleaned.cleaned } : {}),
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
    xFrom: aligned.xFrom,
    scale: options.scale,
    warnings,
  };
}

/** Seconds of playable video, straight out of the container. */
function probeDuration(path, label) {
  const r = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", path],
    { encoding: "utf-8" },
  );
  if (r.error || r.status !== 0) fail(`${label}: ffprobe failed for ${path}: ${(r.stderr || "").trim()}`);
  const duration = Number(String(r.stdout).trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    fail(`${label}: ${path} reports no duration ('${String(r.stdout).trim()}') — is it a video file?`);
  }
  return duration;
}

/**
 * Timestamp of the last frame that can still be seeked to.
 *
 * `-ss T` selects the first frame at or AFTER T, so a sample time past the
 * last frame's presentation time yields no frame at all — and ffmpeg exits 0
 * while doing it, so the symptom is a missing file rather than an error. The
 * container's `duration` is not that time: a 2.0s clip at 10fps has its last
 * frame at 1.9s, and a duration that is not a whole number of frames puts it
 * further back still.
 */
/**
 * The video stream's own rate and frame count, or null for whichever of the
 * two the container does not carry. Both `probeLastFrameTime` (which needs the
 * rate to place the last seekable frame) and `contact` (which reports the rate
 * and derives its analysis rate from it) ask the same one question, so they
 * ask it in the same place.
 */
function probeVideoStream(path) {
  const r = spawnSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=nb_frames,r_frame_rate",
      "-of", "default=noprint_wrappers=1", path],
    { encoding: "utf-8" },
  );
  const fields = {};
  if (!r.error && r.status === 0) {
    for (const line of String(r.stdout).trim().split("\n")) {
      const eq = line.indexOf("=");
      if (eq > 0) fields[line.slice(0, eq)] = line.slice(eq + 1);
    }
  }
  const [numerator, denominator] = String(fields.r_frame_rate ?? "").split("/").map(Number);
  const frames = Number(fields.nb_frames);
  return {
    fps: numerator > 0 && denominator > 0 ? numerator / denominator : null,
    frames: Number.isFinite(frames) && frames > 0 ? frames : null,
  };
}

function probeLastFrameTime(path, duration) {
  const { fps, frames } = probeVideoStream(path);
  if (fps && frames !== null && frames > 1) return (frames - 1) / fps;
  if (fps) return Math.max(0, duration - 1 / fps);
  // Nothing measurable (a stream with neither count nor rate): 50 ms is longer
  // than one frame at any rate a clip is shot at.
  return Math.max(0, duration - 0.05);
}

/**
 * Where in the clip each frame is taken from.
 *
 * A looping motion stops one step short of the end: the closing pose is the
 * opening pose, and sampling both would put the same picture in frame 00 and
 * frame N-1 — a visible stutter at the seam. A one-shot motion has to show
 * where it ended up, so it samples both ends, clamped to `last` so the final
 * timestamp still names a frame that exists.
 */
function sampleTimes({ start, end, frames, loop, last }) {
  const span = end - start;
  const step = loop ? span / frames : span / Math.max(1, frames - 1);
  return Array.from({ length: frames }, (_, i) => round(Math.min(start + i * step, last), 3));
}

/**
 * One timestamp every `every` seconds from the window's start, both ends
 * included, the last one clamped to `last` the same way the even schedule
 * clamps its own — `--every 0.5` on a 3s clip means seven stills, and the
 * seventh has to name a frame that exists.
 */
function everyTimes({ start, end, every, last }) {
  // The epsilon is for the step that divides the window exactly: 6 * 0.5 is
  // 2.9999999999999996, and without it the last still silently disappears.
  const steps = Math.floor((end - start) / every + 1e-9);
  return Array.from({ length: steps + 1 }, (_, i) => round(Math.min(start + i * every, last), 3));
}

/**
 * The window a clip command works on, and the refusals that go with it.
 * `contact` and `from-video` take the same two trim flags and have to mean
 * exactly the same thing by them, down to the sentence they refuse with.
 *
 * `end` is NOT clamped to the duration here: the callers that need it clamped
 * clamp it, and the ones that report the window the user asked for do not.
 */
function clipWindow(input, { trimStart, trimEnd, label }) {
  const duration = probeDuration(input, label);
  const start = trimStart ?? 0;
  const end = trimEnd ?? duration;
  if (end > duration + SAMPLE_TAIL) {
    fail(`--trim-end ${end}s is past the end of a ${round(duration, 3)}s clip`);
  }
  if (!(end - start > SAMPLE_TAIL)) {
    fail(`--trim-start ${start}s and --trim-end ${round(end, 3)}s leave nothing to sample`);
  }
  const last = Math.min(end - SAMPLE_TAIL, probeLastFrameTime(input, duration));
  if (start > last) {
    fail(`--trim-start ${start}s is past the last frame of a ${round(duration, 3)}s clip`);
  }
  return { duration, start, end, last };
}

/** Even height for a target width, keeping the source aspect. Even because
 *  every encoder downstream of this wants it and nothing wants it odd. */
function scaledHeight(source, width) {
  return Math.max(2, 2 * Math.round((source.height * width) / source.width / 2));
}

/**
 * How much of the combined ink changed between two silhouettes: 0 is the same
 * pose, 1 is no overlap at all.
 *
 * The denominator is the UNION of the two masks, not the frame: a character
 * that fills a tenth of a 16:9 plate would otherwise score ten times smaller
 * than the same motion shot in close-up, and every threshold on this page
 * would have to be re-tuned per clip. Alpha is compared at full 8-bit depth
 * rather than thresholded, so an edge sliding by half a pixel registers as
 * half a pixel of change instead of as nothing or as everything.
 */
function maskDiff(a, b) {
  let delta = 0;
  let union = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x > y) { delta += x - y; union += x; } else { delta += y - x; union += y; }
  }
  return delta / Math.max(1, union);
}

/**
 * Re-base a luma frame on its own background, so an un-keyed clip can be
 * compared by the same rule a keyed one is.
 *
 * `maskDiff` divides by the combined INK, which on an alpha mask is the
 * character (the plate is 0) and on raw luma is the whole frame (a green plate
 * is ~104 everywhere). Measured on the 3s fixture: the same box moving 5px
 * scored 0.33 on the alpha mask and 0.026 on raw luma — under the 0.05 still
 * threshold, so `--key none` confidently reported "the clip never moves" about
 * a clip that plainly does. Subtracting the median (the plate, whatever colour
 * it is) puts the background back at 0 and restores the scale. Only the
 * un-keyed path needs this: an alpha mask already has a zero background, and
 * a character covering more than half the frame would have its own median
 * subtracted and come out inside-out.
 */
function subtractBackground(mask) {
  const histogram = new Uint32Array(256);
  for (let i = 0; i < mask.length; i++) histogram[mask[i]]++;
  const half = mask.length >> 1;
  let seen = 0;
  let median = 0;
  for (let v = 0; v < 256; v++) {
    seen += histogram[v];
    if (seen > half) { median = v; break; }
  }
  const out = Buffer.allocUnsafe(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = Math.abs(mask[i] - median);
  return out;
}

/**
 * Decode the trimmed window to one gray silhouette per analysed frame, in a
 * single ffmpeg pass.
 *
 * One pass, not one spawn per frame: the analysis looks at up to 12 frames a
 * second, and paying a process for each of them would cost more than the
 * decode. The frames come back as raw bytes with no container, so the buffer
 * splits into fixed-size masks by arithmetic — which is why the scale is
 * pinned to an exact WxH here rather than left to ffmpeg's `-2`.
 */
function decodeMasks(input, { start, span, key, similarity, blend, fps, size }) {
  const height = scaledHeight(size, ANALYSIS_WIDTH);
  // `fps` first so the decimation happens before the per-pixel work, and the
  // key before `alphaextract` because the alpha plane IS the silhouette.
  // Without a key there is no alpha, so the luma stands in: it says less about
  // the character, but it says it about the same frames.
  const chain = [`fps=${fps}`];
  if (key) chain.push(`colorkey=${key}:${similarity}:${blend}`, "format=rgba", "alphaextract");
  else chain.push("format=gray");
  chain.push(`scale=${ANALYSIS_WIDTH}:${height}`);

  const r = spawnSync("ffmpeg", [
    "-v", "error", "-ss", String(start), "-t", String(span), "-i", input,
    "-vf", chain.join(","), "-f", "rawvideo", "-pix_fmt", "gray", "-",
  ], { maxBuffer: MAX_RAW_BYTES });
  if (r.error) fail(`contact: could not decode ${input} (${r.error.message})`);
  if (r.status !== 0) fail(`contact: could not decode ${input}\n${String(r.stderr ?? "").trim()}`);

  const frameBytes = ANALYSIS_WIDTH * height;
  const count = Math.floor((r.stdout?.length ?? 0) / frameBytes);
  if (count < 2) {
    fail(`contact: ${round(span, 3)}s from ${round(start, 3)}s of ${input} decoded to ${count} analysis frame(s) — nothing to compare`);
  }
  const masks = Array.from({ length: count }, (_, i) => r.stdout.subarray(i * frameBytes, (i + 1) * frameBytes));
  return key ? masks : masks.map(subtractBackground);
}

/**
 * What the silhouette series says about the clip: where the opening pose
 * breaks, where the closing hold begins, and which windows close on
 * themselves.
 *
 * The loop search is O(n · maxPeriod) diffs, not O(n²): a cycle longer than
 * LOOP_PERIOD_MAX is not a cycle anyone would sample as one motion, so the
 * inner loop stops there, and the "does this window actually move" test is a
 * running prefix max of the diffs it already computed rather than a second
 * sweep.
 */
function readMotion(masks, { fps, start }) {
  const n = masks.length;
  const at = (i) => round(start + i / fps, 3);

  const deltas = [];
  for (let i = 0; i + 1 < n; i++) deltas.push(maskDiff(masks[i], masks[i + 1]));

  let startIndex = -1;
  for (let i = 1; i < n; i++) {
    if (maskDiff(masks[0], masks[i]) > STILL_DIFF) { startIndex = i; break; }
  }
  // The last frame that still differs from the final pose: everything after it
  // is the closing hold.
  let endIndex = -1;
  for (let j = n - 2; j >= 0; j--) {
    if (maskDiff(masks[n - 1], masks[j]) > STILL_DIFF) { endIndex = j; break; }
  }

  const loops = [];
  if (startIndex >= 0) {
    const kMin = Math.max(1, Math.ceil(LOOP_PERIOD_MIN * fps));
    const kMax = Math.floor(LOOP_PERIOD_MAX * fps);
    const cumulative = [0];
    for (const d of deltas) cumulative.push(cumulative[cumulative.length - 1] + d);
    for (let i = startIndex; i < n; i++) {
      let motion = 0;
      for (let k = 1; k <= kMax && i + k < n; k++) {
        const seam = maskDiff(masks[i], masks[i + k]);
        // `motion` is the largest departure from the start pose STRICTLY
        // inside the window — a stretch of held pose has a perfect seam and
        // would otherwise win every time.
        if (k >= kMin && motion >= LOOP_MOTION_DIFF) {
          loops.push({
            start: at(i),
            end: at(i + k),
            period: round(k / fps, 3),
            seam: round(seam, 4),
            step: round((cumulative[i + k] - cumulative[i]) / k, 4),
          });
        }
        if (seam > motion) motion = seam;
      }
    }
    // Seam decides; the rest of the ordering is spelt out rather than left to
    // insertion order, because ties are not rare. A silhouette diff cannot see
    // DIRECTION, so any motion that retraces its own path — a breath, a
    // pendulum, a bounce — scores a perfect seam on its half-period as well as
    // on its period, and a perfectly cyclic clip scores one on every multiple.
    // Among equals, take the window that starts earliest (it sits right after
    // the opening hold, where the motion actually begins) and then the
    // shortest one.
    loops.sort((a, b) => a.seam - b.seam || a.start - b.start || a.period - b.period);
    loops.length = Math.min(loops.length, MAX_LOOPS);
  }

  return {
    stillStart: startIndex < 0 ? null : at(startIndex),
    stillEnd: endIndex < 0 ? null : at(endIndex),
    loops,
    // 2 dp: this series is read, not computed on — it is the rhythm of the
    // clip at a glance, and four decimals of codec noise only hide it.
    deltas: deltas.map((d) => round(d, 2)),
  };
}

/**
 * Look at a clip before sampling it.
 *
 * A motion sampled from a clip is only as good as the window it came from,
 * and until this existed the agent had no way to see the clip at all — it
 * sampled N frames evenly across whatever it was handed and found out
 * afterwards that two of them were the same opening pose. So: one picture of
 * the whole clip, plus the three numbers that decide the window (where the
 * opening hold ends, where the closing hold starts, which stretch loops).
 *
 * Nothing here is an asset. The stills are extracted into a temp directory
 * that is removed on the way out, success or failure; the only file that
 * survives is the contact sheet the caller named, and no motion directory or
 * project.json is touched.
 */
function stepContact(clip, options) {
  const input = resolve(clip);
  if (!existsSync(input)) fail(`file not found: ${input}`);

  const { duration, start, end, last } = clipWindow(input, { ...options, label: "contact" });
  const windowEnd = Math.min(end, duration);
  const size = probeSize(input, "contact");
  const stream = probeVideoStream(input);
  const warnings = [];

  let times;
  if (options.every === null) {
    times = sampleTimes({ start, end: windowEnd, frames: options.count, loop: false, last });
  } else {
    // `--count` is capped where it is parsed; `--every` cannot be, because how
    // many stills it asks for depends on the clip it is pointed at.
    times = everyTimes({ start, end: windowEnd, every: options.every, last });
    if (times.length > MAX_CONTACT_STILLS) {
      fail(`--every ${options.every}s over a ${round(windowEnd - start, 3)}s window is ${times.length} stills — the limit is ${MAX_CONTACT_STILLS}`);
    }
  }

  const cols = options.cols;
  const rows = Math.ceil(times.length / cols);
  const tileWidth = options.width;
  const tileHeight = scaledHeight(size, tileWidth);
  const fontSize = Math.max(8, Math.round(tileWidth / 10));

  const stillsDir = mkdtempSync(join(tmpdir(), "sprite-contact-"));
  let outPath;
  let keyColor = null;
  let motion;
  let coverage;
  try {
    // The key colour is read off a RAW frame, not off a scaled and stamped
    // still: the corner patches this measures are exactly where the timestamp
    // box goes.
    if (options.key === "auto") {
      const frame = ffmpegTo(join(stillsDir, "key.png"), () => [
        "-ss", String(times[0]), "-i", input, "-frames:v", "1", "-pix_fmt", "rgba",
      ], "contact key frame");
      keyColor = stepProbe(frame, options.threshold).cornerColor;
    } else if (options.key !== "none") {
      keyColor = normalizeColor(options.key, "--key");
    }

    // The numbers before the picture, so a window this cannot analyse leaves
    // no half-answer on disk: either both halves are there or the command
    // refused and wrote nothing.
    const analysisFps = Math.min(stream.fps ?? MAX_ANALYSIS_FPS, MAX_ANALYSIS_FPS);
    let span = windowEnd - start;
    if (span > MAX_ANALYSIS_SECONDS) {
      warnings.push(`the window is ${round(span, 3)}s — only its first ${MAX_ANALYSIS_SECONDS}s were analysed`);
      span = MAX_ANALYSIS_SECONDS;
    }
    const masks = decodeMasks(input, {
      start, span, key: keyColor, similarity: options.similarity, blend: options.blend,
      fps: analysisFps, size,
    });
    motion = { fps: analysisFps, ...readMotion(masks, { fps: analysisFps, start }) };
    if (motion.stillStart === null) warnings.push("the clip never moves");

    let opaque = 0;
    for (const mask of masks) {
      for (let i = 0; i < mask.length; i++) if (mask[i] >= options.threshold) opaque++;
    }
    coverage = opaque / (masks.length * masks[0].length);
    if (keyColor && coverage > KEYED_OPAQUE_ALERT) {
      warnings.push(`keying ${keyColor} left ${(coverage * 100).toFixed(0)}% of each frame opaque — was the clip shot on a flat chroma background?`);
    }

    const stamp = (t) => `drawtext=text='${t.toFixed(3)}s':x=2:y=2:fontsize=${fontSize}:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=2`;
    const extractStill = (t, index, labelled) => ffmpegTo(
      join(stillsDir, `${String(index).padStart(3, "0")}.png`),
      () => [
        "-ss", String(t), "-i", input, "-frames:v", "1",
        "-vf", [`scale=${tileWidth}:${tileHeight}`, ...(labelled ? [stamp(t)] : [])].join(","),
        "-pix_fmt", "rgb24",
      ],
      `contact still ${index}`,
    );

    // Some ffmpeg builds ship without drawtext, and others ship it without a
    // font to draw with. A label is worth a retry; it is never worth the
    // command, so the first still decides for all of them and the retry
    // proves the failure was the label rather than the seek.
    let labelled = true;
    try {
      extractStill(times[0], 0, true);
    } catch (error) {
      if (!(error instanceof SpriteSheetError)) throw error;
      extractStill(times[0], 0, false);
      labelled = false;
      warnings.push("ffmpeg's drawtext filter could not run here (missing, or no font to draw with) — the tiles carry no timestamps");
    }
    for (let i = 1; i < times.length; i++) extractStill(times[i], i, labelled);

    outPath = ffmpegTo(options.out, () => [
      "-framerate", "1", "-start_number", "0", "-i", join(stillsDir, "%03d.png"),
      "-vf", `tile=${cols}x${rows}:padding=${CONTACT_GUTTER}:color=${CONTACT_BACKGROUND}`,
      "-frames:v", "1", "-pix_fmt", "rgb24",
    ], "contact");
  } finally {
    rmSync(stillsDir, { recursive: true, force: true });
  }

  return {
    clip: input,
    out: outPath,
    duration: round(duration, 3),
    fps: stream.fps === null ? null : round(stream.fps, 3),
    trim: { start: round(start, 3), end: round(windowEnd, 3) },
    tiles: times.map((t, index) => ({
      index, t, row: Math.floor(index / cols), col: index % cols,
    })),
    grid: { rows, cols },
    tile: { width: tileWidth, height: tileHeight },
    ...(keyColor ? { keyColor } : {}),
    alphaCoverage: round(coverage, 4),
    stillStart: motion.stillStart,
    stillEnd: motion.stillEnd,
    loops: motion.loops,
    profile: { fps: motion.fps, start: round(start, 3), deltas: motion.deltas },
    warnings,
  };
}

/**
 * The video source: sample the clip into cells, key the plate off every one of
 * them, then hand the cells to the same chain `run` drives.
 *
 * The clip is read and never written: it is a registered asset in its own
 * right (`sprite-project.mjs add-video`), and `register-run` hangs each
 * frame's provenance off it, so moving or rewriting it here would cut the
 * frames loose from what they were sampled out of.
 */
function stepFromVideo(clip, options) {
  const input = resolve(clip);
  if (!existsSync(input)) fail(`file not found: ${input}`);
  const motionDir = resolve(options.out);
  mkdirSync(motionDir, { recursive: true });

  const window = clipWindow(input, { ...options, label: "from-video" });
  const { duration, last } = window;

  // Two schedules, one chain. Everything past this block is identical either
  // way — `sampledAt[i]` is still where frame i came from, and `register-run`
  // still reads it as that frame's provenance.
  let times;
  let start;
  let end;
  let fps;
  const schedule = options.at ? "explicit" : "even";
  if (options.at) {
    for (const t of options.at) {
      if (t > last) {
        fail(`--at: ${t}s is past the last frame of a ${round(duration, 3)}s clip`);
      }
    }
    times = options.at.map((t) => round(Math.min(t, last), 3));
    // Strictly increasing was checked on what was typed; this checks what
    // survived the millisecond rounding, because two times a microsecond apart
    // name one frame and would leave the mean rate dividing by zero.
    for (let i = 1; i < times.length; i++) {
      if (times[i] <= times[i - 1]) {
        fail(`--at: ${options.at[i]}s and ${options.at[i - 1]}s are the same frame to the millisecond`);
      }
    }
    start = times[0];
    end = times[times.length - 1];
    // The mean sampling rate: N frames spread over N-1 intervals. Hand-picked
    // times are rarely evenly spaced, so this is the honest average rather
    // than a rate any one pair of frames was taken at. Unlike the even
    // schedule it is NOT floored at 1 — two frames a minute apart really are a
    // 0.033 fps motion — only at the resolution of the rounding, so a wide
    // enough span cannot round the frame rate to zero.
    fps = options.fps ?? Math.max(0.001, round((times.length - 1) / (end - start), 3));
  } else {
    start = window.start;
    end = window.end;
    times = sampleTimes({
      start, end: Math.min(end, duration), frames: options.frames, loop: options.loop, last,
    });
    // Sampling N frames across D seconds and then playing them at N/D fps is
    // the clip at its own speed; any other fps is a deliberate slow-down.
    fps = options.fps ?? Math.max(1, round(options.frames / (end - start), 3));
  }

  const cellsDir = join(motionDir, CELLS_DIRNAME);
  resetFramesDir(cellsDir);
  const warnings = [];

  // ffmpeg writes nothing and still exits 0 when a seek lands past the last
  // frame, so a missing file here is turned into the sentence that names why.
  const extract = (time, index, filter) => {
    try {
      return ffmpegTo(join(cellsDir, frameName(index)), () => [
        "-ss", String(time), "-i", input, "-frames:v", "1",
        ...(filter ? ["-vf", filter] : []),
        "-pix_fmt", "rgba",
      ], `from-video frame ${index}`);
    } catch (error) {
      if (error instanceof SpriteSheetError) throw error;
      fail(`from-video: no frame at ${time}s of a ${round(duration, 3)}s clip (${error.message})`);
    }
  };

  // The key colour is read off the first sampled frame, un-keyed — the clip's
  // own idea of the chroma plate, codec drift included, rather than the ideal
  // green the prompt asked for.
  let keyColor;
  let filter = null;
  if (options.key !== "none") {
    extract(times[0], 0, null);
    const probe = stepProbe(join(cellsDir, frameName(0)), options.threshold);
    keyColor = options.key === "auto" ? probe.cornerColor : normalizeColor(options.key, "--key");
    filter = `colorkey=${keyColor}:${options.similarity}:${options.blend},format=rgba`;
  }

  for (const [index, time] of times.entries()) extract(time, index, filter);

  const source = probeSize(join(cellsDir, frameName(0)), "from-video");
  const cleanStats = [];
  const measures = [];
  const coverages = [];
  for (let index = 0; index < times.length; index++) {
    const path = join(cellsDir, frameName(index));
    const image = readRgba(path);
    let rewrite = false;
    if (options.clean) {
      const result = cleanCell(image, options.threshold);
      cleanStats.push({ index, ...result });
      if (result.removedPixels) rewrite = true;
    }
    // Here the key ran inside the extraction filter, so there is no keyed
    // sheet to fix once — every frame carries its own plate under the alpha,
    // and this loop is the pass that already has the pixels in hand.
    if (keyColor && zeroKeyedRgb(image, options.threshold)) rewrite = true;
    if (rewrite) writeRgbaPng(path, image, `from-video cell ${index}`);
    const measure = measureFrame(image, options.threshold);
    measures.push(measure);
    coverages.push(measure.coverage);
  }
  const cleaned = options.clean ? cleanSummary(cleanStats) : null;
  if (cleaned) warnings.push(...cleaned.warnings);

  // A plate the key did not find leaves every frame opaque, and the aligner
  // would then dutifully centre a full-bleed rectangle in every cell.
  const meanCoverage = coverages.reduce((a, b) => a + b, 0) / coverages.length;
  if (keyColor && meanCoverage > KEYED_OPAQUE_ALERT) {
    warnings.push(`keying ${keyColor} left ${(meanCoverage * 100).toFixed(0)}% of each frame opaque — was the clip shot on a flat chroma background?`);
  }

  const { aligned, packed, preview, summary } = finishMotion(motionDir, cellsDir, { ...options, fps }, {
    measures, sourceCell: source, warnings,
  });

  return {
    motionDir,
    name: options.name,
    source: "video",
    video: input,
    sampledAt: times,
    schedule,
    trim: { start: round(start, 3), end: round(Math.min(end, duration), 3) },
    duration: round(duration, 3),
    grid: packed.grid,
    keyed: Boolean(keyColor),
    ...(keyColor ? { keyColor } : {}),
    alphaCoverage: round(meanCoverage, 4),
    ...(cleaned ? { cleaned: cleaned.cleaned } : {}),
    cells: cellsDir,
    frames: aligned.frames.map((f) => f.path),
    sheet: packed.sheet,
    atlas: packed.atlas,
    gif: preview.gif,
    ...(preview.webp ? { webp: preview.webp } : {}),
    inspect: summary,
    cell: aligned.cell,
    fps,
    loop: options.loop,
    anchor: options.anchor,
    xFrom: aligned.xFrom,
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
  clean: { out: { type: "string" }, threshold: { type: "string" } },
  align: {
    out: { type: "string" }, anchor: { type: "string" }, "x-from": { type: "string" },
    cell: { type: "string" },
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
    anchor: { type: "string" }, "x-from": { type: "string" },
    key: { type: "string" }, cell: { type: "string" }, pad: { type: "string" },
    smooth: { type: "boolean", default: false }, scale: { type: "string" }, nearest: { type: "boolean", default: false },
    margin: { type: "string" }, gutter: { type: "string" }, width: { type: "string" },
    "no-webp": { type: "boolean", default: false }, threshold: { type: "string" },
    similarity: { type: "string" }, blend: { type: "string" },
    "no-clean": { type: "boolean", default: false },
  },
  contact: {
    out: { type: "string" }, count: { type: "string" }, every: { type: "string" },
    cols: { type: "string" }, width: { type: "string" },
    "trim-start": { type: "string" }, "trim-end": { type: "string" },
    key: { type: "string" }, similarity: { type: "string" }, blend: { type: "string" },
    threshold: { type: "string" },
  },
  "from-video": {
    out: { type: "string" }, name: { type: "string" }, frames: { type: "string" },
    at: { type: "string", multiple: true },
    fps: { type: "string" }, loop: { type: "boolean", default: false },
    "no-loop": { type: "boolean", default: false },
    anchor: { type: "string" }, "x-from": { type: "string" }, key: { type: "string" },
    "trim-start": { type: "string" }, "trim-end": { type: "string" },
    cell: { type: "string" }, pad: { type: "string" },
    smooth: { type: "boolean", default: false }, scale: { type: "string" },
    nearest: { type: "boolean", default: false }, cols: { type: "string" },
    width: { type: "string" }, "no-webp": { type: "boolean", default: false },
    threshold: { type: "string" }, similarity: { type: "string" }, blend: { type: "string" },
    "no-clean": { type: "boolean", default: false },
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

function pickXFrom(value) {
  const xFrom = value ?? "feet";
  if (!X_FROM_MODES.includes(xFrom)) {
    fail(`--x-from: expected ${X_FROM_MODES.join(", ")}, got '${value}'`);
  }
  return xFrom;
}

/**
 * The `--at` list: comma-separated, repeatable, flattened the same way
 * `sprite-project.mjs::parseInputs` flattens `--from`, so
 * `--at 0.2,0.7 --at 1.2` and `--at 0.2,0.7,1.2` are the same request.
 *
 * Everything checkable without the clip is checked here; "past the last
 * frame" needs the clip and is checked where the clip is probed.
 */
function parseSampleTimes(raw) {
  const times = raw
    .flatMap((value) => String(value).split(","))
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => num(v, "--at", { min: 0 }));
  if (times.length < 2) {
    fail(`--at: a motion needs at least 2 times, got ${times.length}`);
  }
  if (times.length > MAX_FRAMES) {
    fail(`--at lists ${times.length} times, over the ${MAX_FRAMES}-frame limit (frame files are two digits)`);
  }
  for (let i = 1; i < times.length; i++) {
    if (times[i] <= times[i - 1]) {
      fail(`--at: times must increase (${times[i]} after ${times[i - 1]})`);
    }
  }
  return times;
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
    case "clean": {
      const out = stepClean(requirePositional(positionals, "<cellsDir>"), {
        out: requireFlag(values.out, "--out"),
        threshold,
      });
      emit(values, out, [
        out.cleaned.length
          ? `cleaned ${out.cleaned.length} of ${out.frames.length} cells (${out.cleaned.reduce((n, c) => n + c.removedPixels, 0)} px removed)`
          : `nothing to clean in ${out.frames.length} cells`,
        ...out.warnings,
      ]);
      break;
    }
    case "align": {
      const out = stepAlign(requirePositional(positionals, "<framesDir>"), {
        out: requireFlag(values.out, "--out"),
        anchor: pickAnchor(values.anchor),
        xFrom: pickXFrom(values["x-from"]),
        cell: parseCell(values.cell),
        pad: num(values.pad, "--pad", { integer: true, min: 0, fallback: DEFAULT_PAD }),
        smooth: values.smooth,
        threshold,
      });
      emit(values, out, [
        `aligned ${out.frames.length} frames on a ${out.cell.width}x${out.cell.height} cell (${out.anchor} anchor at ${out.anchorPoint.x},${out.anchorPoint.y}, x from ${out.xFrom})`,
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
        `${report.frameCount} frames of ${report.cell.width}x${report.cell.height}, anchor drift ${report.anchorDrift.x}/${report.anchorDrift.y}px, body drift ${report.bodyDrift}px, max jump ${report.maxJump}px, scale drift ${report.scaleDrift}`,
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
        xFrom: pickXFrom(values["x-from"]),
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
        clean: !values["no-clean"],
      });
      emit(values, out, [
        `${out.name}: ${out.frames.length} frames of ${out.cell.width}x${out.cell.height} → ${out.motionDir}`,
        ...(out.warnings.length ? out.warnings : ["no warnings"]),
      ]);
      break;
    }
    case "contact": {
      const key = values.key ?? "auto";
      if (key !== "auto" && key !== "none") normalizeColor(key, "--key");
      if (values.count !== undefined && values.every !== undefined) {
        fail("--count and --every are two ways to space the stills — pass one");
      }
      const every = values.every === undefined ? null : num(values.every, "--every", { min: 0 });
      if (every !== null && every <= 0) fail(`--every: expected a number > 0, got '${values.every}'`);
      const count = num(values.count, "--count", { integer: true, min: 2, fallback: DEFAULT_CONTACT_COUNT });
      if (count > MAX_CONTACT_STILLS) {
        fail(`--count ${count} is over the ${MAX_CONTACT_STILLS}-still limit — a contact sheet is for reading`);
      }
      const out = stepContact(requirePositional(positionals, "<clip>"), {
        out: requireFlag(values.out, "--out"),
        count,
        every,
        cols: num(values.cols, "--cols", { integer: true, min: 1, fallback: DEFAULT_CONTACT_COLS }),
        width: num(values.width, "--width", { integer: true, min: 16, fallback: DEFAULT_CONTACT_WIDTH }),
        trimStart: num(values["trim-start"], "--trim-start", { min: 0, fallback: null }),
        trimEnd: num(values["trim-end"], "--trim-end", { min: 0, fallback: null }),
        key,
        similarity: num(values.similarity, "--similarity", { min: 0, fallback: DEFAULT_VIDEO_SIMILARITY }),
        blend: num(values.blend, "--blend", { min: 0, fallback: DEFAULT_BLEND }),
        threshold,
      });
      const best = out.loops[0];
      emit(values, out, [
        `${out.tiles.length} stills of ${basename(out.clip)} → ${out.out}`,
        out.stillStart === null
          ? "never moves"
          : `opening pose holds until ${out.stillStart}s`,
        best
          ? `best loop ${best.start}–${best.end}s (period ${best.period}s, seam ${best.seam} vs step ${best.step})`
          : "no loop window found",
        ...out.warnings,
      ]);
      break;
    }
    case "from-video": {
      const key = values.key ?? "auto";
      if (key !== "auto" && key !== "none") normalizeColor(key, "--key");
      const at = values.at === undefined ? null : parseSampleTimes(values.at);
      if (at) {
        for (const flag of ["frames", "trim-start", "trim-end"]) {
          if (values[flag] !== undefined) {
            fail(`--at and --${flag} are two ways to say which frames — pass one`);
          }
        }
      }
      const frames = at
        ? at.length
        : num(requireFlag(values.frames, "--frames"), "--frames", { integer: true, min: 2 });
      if (frames > MAX_FRAMES) fail(`--frames ${frames} is over the ${MAX_FRAMES}-frame limit (frame files are two digits)`);
      const trimStart = num(values["trim-start"], "--trim-start", { min: 0, fallback: null });
      const trimEnd = num(values["trim-end"], "--trim-end", { min: 0, fallback: null });
      const out = stepFromVideo(requirePositional(positionals, "<clip>"), {
        out: requireFlag(values.out, "--out"),
        name: requireFlag(values.name, "--name"),
        frames,
        at,
        fps: values.fps === undefined ? null : num(values.fps, "--fps", { min: 1 }),
        loop: pickLoop(values),
        anchor: pickAnchor(values.anchor),
        xFrom: pickXFrom(values["x-from"]),
        key,
        trimStart,
        trimEnd,
        cell: parseCell(values.cell),
        pad: num(values.pad, "--pad", { integer: true, min: 0, fallback: DEFAULT_PAD }),
        smooth: values.smooth,
        scale: num(values.scale, "--scale", { min: 0.01, fallback: 1 }),
        nearest: values.nearest,
        cols: values.cols === undefined ? null : num(values.cols, "--cols", { integer: true, min: 1 }),
        width: values.width === undefined ? null : num(values.width, "--width", { integer: true, min: 1 }),
        webp: !values["no-webp"],
        threshold,
        similarity: num(values.similarity, "--similarity", { min: 0, fallback: DEFAULT_VIDEO_SIMILARITY }),
        blend: num(values.blend, "--blend", { min: 0, fallback: DEFAULT_BLEND }),
        clean: !values["no-clean"],
      });
      emit(values, out, [
        `${out.name}: ${out.frames.length} frames of ${out.cell.width}x${out.cell.height} sampled from ${basename(out.video)} at ${out.fps}fps → ${out.motionDir}`,
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

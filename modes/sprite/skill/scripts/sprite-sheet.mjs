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
 * contact, from-video, retime, loop, export, rive.
 *
 * `export` and `rive` hand a FINISHED motion over in somebody else's format
 * (video, a frame animation, a `.riv`). They read the character's
 * project.json to learn which frames are the motion's and whether it is
 * ready, and never write it — registering what they made is
 * `sprite-project.mjs register-export`.
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

import { RIVE_MOTION_INPUT, riveDefaultMotion, riveHub, writeRiv } from "./rive.mjs";
import {
  RIVE_DECODE_LIMIT_BYTES, RIVE_DECODE_WARN_BYTES, RIVE_LOOP_FPS, RIVE_LOOP_MAX_SIZE, RIVE_PIXEL_ART_STYLE, riveDefaultImages,
  riveDecodeWarning, riveMB, rivePlan, riveReverseIsCurrent,
} from "./rive-plan.mjs";
import { zipStore } from "./zip.mjs";

const DEFAULT_THRESHOLD = 16;
const DEFAULT_PAD = 8;
const DEFAULT_SIMILARITY = 0.12;
const DEFAULT_BLEND = 0.05;
const CORNER_PATCH = 8;
/** A frame index is two digits, so a motion tops out at 100 frames. */
const MAX_FRAMES = 100;
/** A loop motion numbers its frames with three digits and keeps every frame of
 *  the window, so it needs its own, higher ceiling: 400 covers 5 s at 60 fps
 *  and still bounds the decode, the Lottie payload and the temp directory. */
const MAX_LOOP_FRAMES = 400;
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
// --- loop: a seamless transparent animation for a UI ------------------------
/** Deliverables `loop` can write, and the default set. */
const LOOP_FORMATS = ["webp", "apng", "webm", "lottie"];
/** A frame that moves less than this share of the median step is a held pose,
 *  not a frame of animation. Relative to the clip's OWN rhythm and nothing
 *  else: an absolute floor under it (there was a 0.005 one) is a number tuned
 *  on one clip deciding what "held" means on every other. Measured
 *  2026-09-22 on the reference flame, whose keyed-alpha median step is 0.0043:
 *  the floor dropped 12 leading and 1 trailing frame of a clip that holds
 *  nothing. A clip whose silhouette never moves has median 0, so nothing is
 *  dropped — which is the honest answer, and the step and seam it then
 *  reports (both 0) say plainly that there was no motion to trim. */
const HOLD_STEP_FRACTION = 0.25;
/** A seam worth more than this many normal steps is a loop that does not
 *  close: the last frame visibly snaps back to the first. */
const SEAM_STEP_LIMIT = 2;
/** A transition's end joins a loop's frame 0 when their gap is at most this
 *  many of its median steps — the rule a loop's seam is held to. */
const JOIN_STEPS = SEAM_STEP_LIMIT;
/** Most in-betweens `--seam-fill auto` will synthesise at the wrap. Four,
 *  because past that the wrap is no longer a seam to smooth but a chunk of
 *  motion nobody shot, and inventing it silently is worse than the tick. */
const MAX_AUTO_SEAM_FILL = 4;
/** Under this many frames a "loop" is a slideshow. */
const MIN_LOOP_FRAMES = 8;
/** A Lottie past this is too much JSON to hand a browser; --width is the fix. */
const MAX_LOTTIE_BYTES = 8 * 1024 * 1024;
/** An APNG past this is a page asset nobody will wait for. Its own constant
 *  rather than a shared one: the Lottie's cost is parsing base64 and the
 *  APNG's is the download, and the two numbers are free to move apart. The
 *  Kiki trial shipped a 33 MB APNG with nothing said about it. */
const MAX_APNG_BYTES = 8 * 1024 * 1024;
/**
 * What `--width` falls back to when it is not given and the frames are bigger.
 *
 * A clip's own size is almost never the size a UI renders at, and the cost of
 * assuming it is not a slightly-too-big picture: the Kiki trial cut 532px
 * frames and landed a 45 MB Lottie and a 33 MB APNG, of which exactly one
 * export (the WebM) was shippable. 512 is two retina-doubled 256px icons and
 * a size every export survives; it is a DEFAULT, announced on stderr and
 * recorded as `widthDefaulted`, never a limit — `--width 1024` is obeyed.
 */
const DEFAULT_LOOP_WIDTH = 512;

// --- retime: the clip's own frames, in another order ------------------------
/** Frames `retime` will decode out of one clip. A Seedance plate is 5–10s at
 *  24fps; 600 is 25 seconds of it, and past that the PNG sequence on disk is
 *  the problem rather than the reorder. */
const MAX_RETIME_SOURCE_FRAMES = 600;
/** Near-lossless: the retimed plate is an intermediate that interpolation and
 *  matting both read afterwards, so it must not add artefacts of its own. */
const RETIME_CRF = 12;
/** How different two channels have to be before a plate counts as a chroma
 *  screen with a spill hue to remove. A neutral grey plate has none, and
 *  running `despill` on it would tint the subject for no reason. */
const DESPILL_DOMINANCE = 24;

/** Pre-align grid cells `run` leaves next to `frames/`: what `inspect` judges
 *  "leaves its grid cell" on, and what re-aligning a motion re-reads. */
const CELLS_DIRNAME = "cells";
/** What `align` leaves in the frames dir so `pack` can declare the pivot it
 *  actually used instead of guessing the cell edge. */
const ALIGN_RECORD = "align.json";

// --- export / rive: a finished motion, handed over --------------------------
/** What `export --format` makes, in the order the Export tab lists them. */
const EXPORT_FORMATS = ["mp4", "mov", "webm", "apng", "lottie", "png-seq"];
/** The formats that are video: they repeat, pad to even sides, and are
 *  probed after encoding. The frame animations play the frames once and let
 *  the file's own loop flag (or the player) decide the rest. */
const VIDEO_EXPORTS = new Set(["mp4", "mov", "webm"]);
/** A looping motion's clip repeats until it lasts at least this long: a 0.5 s
 *  idle handed to an editor as a 0.5 s clip is a blink nobody can place. */
const EXPORT_MIN_SECONDS = 3;
/** MP4 has no alpha, so it is flattened onto this unless `--bg` says. */
const DEFAULT_EXPORT_BG = "#ffffff";
/** `motions/<id>/exports/` for a motion, `<character>/exports/` for the .riv. */
const EXPORTS_DIRNAME = "exports";
/** How `rive --images` embeds each frame: WebP (lossy at q85, several times
 *  smaller), lossless WebP (every visible pixel exact — pixel art's default)
 *  or PNG. Every Rive runtime decodes all three. */
const RIVE_IMAGES = ["webp", "webp-lossless", "png"];
/** What the codec is called once ffprobe reads the file back. */
const EXPORT_CODECS = { mp4: "h264", mov: "prores", webm: "vp9" };

const SUBCOMMANDS = [
  "probe", "key", "flatten", "slice", "clean", "align", "pack", "gif",
  "inspect", "run", "contact", "from-video", "retime", "loop", "transition", "lineup", "export", "rive",
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

  retime <clip> --keep <ranges> --out <mp4> [--fps N]
      Replay a clip's OWN frames in another order: an apex hold cut short, a
      beat repeated, a second blink dropped. <ranges> is a comma list of
      inclusive frame indices in the order they should play, repeats allowed
      — '2-40,41-60,2-40' is three ranges and 81 frames. Nothing is invented:
      the frames are decoded once and written back at the clip's own rate (or
      --fps) as an opaque H.264 mp4 (yuv420p, crf ${RETIME_CRF}).
      This belongs on the PLATE clip, BEFORE matting and before interpolation,
      so a clip that already carries alpha is refused by name.
      The JSON reports firstIs / lastIs — which source frames now sit at the
      wrap. After a retime the loop no longer closes by construction, and
      'loop' has to measure the seam again.

  loop <clip> --out <motionDir> --name <motionId>
      [--trim-start s] [--trim-end s] [--key auto|#rrggbb|none|alpha]
      [--similarity ${DEFAULT_VIDEO_SIMILARITY}] [--blend ${DEFAULT_BLEND}] [--despill|--no-despill]
      [--trim-holds|--no-trim-holds] [--seam-fill auto|none|N]
      [--crop union|none] [--pad ${DEFAULT_PAD}] [--width W]
      [--fps N] [--formats ${LOOP_FORMATS.join(",")}] [--threshold ${DEFAULT_THRESHOLD}]
      A seamless transparent animation for a UI, not an atlas for an engine.
      EVERY frame of the (trimmed) window is decoded in ONE pass — no
      per-frame seeking, no even sampling — keyed, cropped and written to
      <motionDir>/frames/NNN.png (three digits, up to ${MAX_LOOP_FRAMES}), then exported
      as loop.webp / loop.apng / loop.webm / loop.json (Lottie image
      sequence). The frames are NOT aligned or cleaned: in a loop the
      movement is the content, so a bobbing icon has to keep bobbing.
      --key auto measures frame 0's corner plate and colorkeys it; alpha
      decodes the clip's OWN alpha (a VEED webm, a Bria ProRes 4444 mov);
      none leaves the frames opaque and says so.
      --despill (default on when keying a green or blue plate) takes the
      plate's spill hue off the silhouette AFTER the key — despilling first
      moves the plate off the colour the key was told to look for, and the
      key then matches nothing. A neutral plate has no spill hue, so despill
      is skipped there whatever the flag says.
      --trim-holds (default on) drops the closing frames that have frozen
      back onto the first frame, and the opening frames that have not moved
      yet (keeping the last frame of the freeze).
      --seam-fill auto (default) interpolates in-betweens into the wrap from
      the last frame back to the first — the one transition the model never
      drew — when the seam is worth more than ${SEAM_STEP_LIMIT} normal steps: ${MAX_AUTO_SEAM_FILL} at most,
      enough to bring the wrap back to about one step. The loop gets that
      many frames longer, their sampledAt is null, and the reported seam
      becomes the worst step across the filled wrap. N forces a count,
      none exports the wrap exactly as it was shot.
      --crop union crops every frame to one rect — the union of the kept
      frames' alpha bboxes plus --pad — so relative motion is preserved.
      --width scales in PREMULTIPLIED alpha, so soft edges do not darken.
      Omitted, a frame wider than ${DEFAULT_LOOP_WIDTH}px is capped at ${DEFAULT_LOOP_WIDTH} with one line on
      stderr and widthDefaulted: true in the report — the clip's own size is
      almost never the size the UI renders at, and an uncapped one lands as a
      Lottie nobody can ship.
      --fps N interpolates the PLATE frames to N fps with minterpolate,
      wrapped around the loop; refused with --key alpha, because
      interpolation belongs before matting (see interpolate-video.mjs).
      Reports seam (how far the last frame is from the first), step (the
      median frame-to-frame change) and maxStep: seam << step is a loop that
      closes. Writes <motionDir>/inspect.json in the loop shape.

  transition <clip> --character <dir> --from <loopId> --to <loopId>
      [--out <motionDir>] [--name <id>] [--duration s]
      [--trim-start s] [--trim-end s] [--key alpha|auto|#rrggbb]
      [--similarity ${DEFAULT_VIDEO_SIMILARITY}] [--blend ${DEFAULT_BLEND}] [--despill|--no-despill]
      [--trim-holds|--no-trim-holds] [--crop union|none] [--pad ${DEFAULT_PAD}] [--width W]
      [--threshold ${DEFAULT_THRESHOLD}]
  transition --reverse-of <transitionId> --character <dir> [--out <motionDir>] [--name <id>]
      The take between two loops: cut like 'loop' (one decode, keyed or with
      its own matte, one union crop, one width, crop and scale recorded so
      the frames sit in clip coordinates), but it plays once: no seam, the
      holds a first-last take leaves at BOTH ends collapsed to one frame each
      (--no-trim-holds keeps them), and --duration s retimes it to the length
      it should play by even sampling that keeps the first and last frame (a
      4 s take played in 1.2 s). Never stretched: a --duration longer than
      the movement keeps every frame and says so.
      Measures whether it LANDS: startGap is its first frame against
      --from's frame 0, endGap its last against --to's, as silhouette
      distance in clip coordinates, against its own median step. At most
      ${JOIN_STEPS} steps joins; more is a warning naming the end.
      Written to <character>/motions/<from>-to-<to>/frames/NNN.png with an
      inspect.json; --json is what register-run takes.
      --reverse-of plays a REGISTERED transition backwards as the way back,
      free: its frames copied in reverse order, its crop, scale and rate, and
      its own ends measured against the loops it now joins.

  lineup <characterDir> [--hub <loopId>] [--out <png>]
      Look before spending: every ready loop's frame 0 beside the hub's, at
      their clips' scale and placed in clip coordinates on one baseline,
      written to <character>/lineup.png (labelled with the motion ids). The
      JSON gives, per loop, its clip scale (recorded or measured), its poseGap
      to the hub (alpha IoU in clip coordinates and the mean colour difference
      inside the union), the frame of the loop closest to the hub pose, the
      transitions already registered for the pair, and a suggestion — direct
      or transition — with the threshold it used.

  export <motionDir> --format mp4|mov|webm|apng|lottie|png-seq
      [--bg #rrggbb] [--repeat N] [--scale N]
      One READY motion (status in project.json, frames as registered) in a
      format somebody else's tool reads. Written to
      <motionDir>/exports/<id>.<ext> (png-seq: <id>-frames.zip), encoded to a
      scratch file and renamed only after it checks out.
        mp4      H.264 yuv420p, flattened onto --bg (default ${DEFAULT_EXPORT_BG}).
        mov      ProRes 4444 with alpha, for editing software.
        webm     VP9 with alpha.
        apng     every frame once; loops forever when the motion loops.
        lottie   the loop writer's raster image sequence.
        png-seq  a stored zip of the frames plus animation.json (fps, loop,
                 pivot, anchorPoint, per-frame file and duration).
      A sprite motion plays its aligned frames at the ATLAS fps and pivot; a
      loop plays its frames at its own fps.
      --repeat N (video only) plays the motion N times. Default: a looping
      motion repeats until the clip lasts at least ${EXPORT_MIN_SECONDS} s, a one-shot plays
      once; the report says which (repeatDefaulted).
      --scale N is an integer, default 1, always nearest-neighbour.
      Video sides are padded to even with transparency (right and bottom).
      Every video is probed after encoding — codec, alpha where claimed,
      frame count = frames x repeat, duration — and refused if it is not.
      --bg on mov/webm/apng/lottie/png-seq and --repeat on a frame animation
      are reported as ignored, never applied.
      What a motion already ships is refused with the file it already is:
      a sprite motion's GIF / WebP / sheet + atlas, a loop's WebP / APNG /
      WebM / Lottie. A loop is never a GIF or an atlas.

  rive <characterDir> [--motions id,id,…] [--include-loops] [--hub <loopId>]
      [--fps N] [--max-size N] [--filter auto|smooth|nearest]
      [--images webp|webp-lossless|png]
      The whole character as <characterDir>/exports/<character>.riv. By
      default every READY sprite motion goes in; loops go in when asked:
      --include-loops (every ready motion, transitions included), or
      --motions, which names exactly which motions go in and in what order.
      A transition goes in only with both loops it joins; a reverse whose
      source is in the file shows the source's images backwards and embeds
      nothing (unless the source was cut again after it was made — said).
      Every runtime decodes every embedded frame when the file loads, so a
      loop is resampled and downscaled: --fps (loops default ${RIVE_LOOP_FPS}) keeps
      round(duration x fps) frames at floor(i x count / kept) — evenly spread,
      still seamless — and --max-size (loops default ${RIVE_LOOP_MAX_SIZE}) shrinks them
      by ONE factor so the largest fits that longest edge. A transition is
      sampled with the loops and keeps its first and last frame. A sprite
      motion keeps its atlas fps and size unless --fps / --max-size is given
      (a one-shot then keeps its last frame). Nothing is ever sped up or
      enlarged. --filter auto (default) downscales nearest-neighbour when
      character.style says pixel art, smooth otherwise.
      With two loops or transitions or more, each is first divided by its
      scale against its clip (inspect.scale, recorded by loop and transition;
      measured off the clip for a loop cut earlier, with a warning when it
      cannot be) so the character is one size in every state, and placed at
      its clip's coordinates.
      Each frame is pinned to one point of the artboard: a sprite motion by
      its atlas pivot, a placed loop or transition by that clip point, any
      other where its first frame's feet stand.
      The state machine ("State Machine 1"): a number input 'motion' names
      the loop to be in (the mapping is in the report; it starts on the hub),
      and a trigger play_<id> per one-shot. The hub is --hub, else the looping
      idle, else the first loop. A loop leaves only at the end of its cycle;
      from loop C toward T it takes C→T's transition if there is one, else
      C→hub's, else hub→T's, else cuts; a transition's end branches on
      'motion' the same way. A one-shot plays from any state and cuts back to
      the loop 'motion' names. The report spells out every route
      (stateMachine.routes, worst-case seconds), each loop's wait
      (stateMachine.waits), and every direct cut with its poseGap measured
      on the frames as drawn (stateMachine.cuts).
      estimatedDecodeBytes (frames x w x h x 4, after resampling, shared
      images once) is reported per motion and in total: over 128 MB warns,
      over 768 MB is refused with nothing written.
      The frames are RASTER: the file plays in every Rive runtime but cannot
      be reopened in the Rive editor. --images webp (the default) embeds each
      frame as a lossy WebP at quality 85, several times smaller than PNG;
      webp-lossless keeps every visible pixel exact and is the default when
      character.style says pixel art (the reading --filter auto uses); png
      embeds PNG. Every Rive runtime decodes all three. With no --images and an
      ffmpeg without libwebp, the frames go in as PNG and the report warns; a
      WebP format asked for by name on such an ffmpeg is refused.

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

/**
 * A frame file is `NN.png` (a sprite motion) or `NNN.png` (a loop motion,
 * which keeps every frame of its window). Both are read by the same walk, and the
 * contiguity check below is what stops a directory holding both conventions
 * at once from being read as one sequence — `00.png` and `000.png` would
 * both claim index 0.
 */
const FRAME_RE = /^(\d{2,3})\.png$/;

function listFrames(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) fail(`frames directory not found: ${dir}`);
  const entries = readdirSync(dir)
    .map((name) => ({ name, match: FRAME_RE.exec(name) }))
    .filter((e) => e.match)
    .map((e) => ({ index: Number(e.match[1]), path: join(dir, e.name) }))
    .sort((a, b) => a.index - b.index);
  if (!entries.length) fail(`no NN.png or NNN.png frames in ${dir}`);
  entries.forEach((entry, i) => {
    if (entry.index !== i) fail(`frames in ${dir} are not contiguous from 00 (found ${basename(entry.path)} at position ${i})`);
  });
  return entries;
}

const frameName = (index) => `${String(index).padStart(2, "0")}.png`;
/** A loop motion's frame file. Three digits, always — a sequence that mixed
 *  widths would demux as two different `%0Nd` patterns. */
const loopFrameName = (index) => `${String(index).padStart(3, "0")}.png`;

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

/**
 * Which encoders and decoders this ffmpeg build actually has, read once.
 *
 * An export whose encoder is missing is a warning, not a failure — a build
 * without libvpx still produces the WebP and the APNG — so every encoder is
 * asked for by name before it is used. The names are matched exactly: a
 * substring test for `libwebp` would also accept a build that carries only
 * the STILL encoder, which is not the one an animation needs (`hasLibwebp`).
 */
const codecTables = new Map();
function codecNames(kind) {
  if (!codecTables.has(kind)) {
    const r = spawnSync("ffmpeg", ["-v", "error", "-hide_banner", `-${kind}`], { encoding: "utf-8" });
    const names = new Set();
    if (r.status === 0) {
      for (const line of String(r.stdout).split("\n")) {
        const m = /^\s*[A-Z.]{6}\s+(\S+)/.exec(line);
        if (m && m[1] !== "=") names.add(m[1]);
      }
    }
    codecTables.set(kind, names);
  }
  return codecTables.get(kind);
}
const hasEncoder = (name) => codecNames("encoders").has(name);
const hasDecoder = (name) => codecNames("decoders").has(name);

/**
 * `libwebp_anim`, NOT `libwebp` — the difference is whether the animation
 * ghosts.
 *
 * ffmpeg's still `libwebp` encoder hands the webp muxer one full-canvas image
 * per frame and the muxer writes every ANMF with blend = ALPHA-BLEND and
 * dispose = none. A compositing decoder — libwebp's own WebPAnimDecoder,
 * every browser — therefore paints frame i on TOP of the canvas frame i-1
 * left behind, and a transparent pixel of frame i shows the older silhouette
 * through. `libwebp_anim` drives libwebp's WebPAnimEncoder, which writes each
 * frame as a sub-rectangle with the blend/dispose pair that makes the
 * composited canvas equal the frame it was given.
 *
 * Measured 2026-09-22, ffmpeg 8.0, on the 119 keyed flame frames of the loop
 * trial (512x596) and on this suite's 24-frame orbit fixture, decoded back
 * through libwebp's animation decoder and compared with the source PNGs:
 *
 *   encoder        worst mean |alpha - source|   max   size
 *   libwebp        12.73 (flame) / 73.93 (orbit) 255    3421390 B
 *   libwebp_anim    0.037 (flame) /  0.00 (orbit)  1    3307530 B
 *
 * so the animated encoder is also 3% smaller and no slower (4.4s vs 4.6s).
 */
const hasLibwebp = () => hasEncoder("libwebp_anim");

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
        "-c:v", "libwebp_anim", "-pix_fmt", "yuva420p", "-q:v", "85",
        "-loop", loop ? "0" : "1",
      ], "webp");
    } else {
      warnings.push("libwebp_anim encoder is not available in this ffmpeg build — skipped the WebP preview");
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

/**
 * …which is why the clamp lands HALF A FRAME BEFORE that presentation time,
 * not on it.
 *
 * `-ss T` takes the first frame at or after T, so backing off half a period
 * still selects the last frame — it just addresses it from a timestamp that
 * survives being written down. Landing on the PTS itself does not, twice over
 * (measured on a 24 fps, 122-frame clip, ffmpeg 8.0):
 *   - `(frames - 1) / fps` = 121/24 is 5.041666666666667 as a double, which is
 *     strictly GREATER than the exact 121/24 the container stores, so ffmpeg
 *     already looks past the last frame;
 *   - every caller rounds its timestamps to 3 dp before handing them to
 *     ffmpeg, and 5.041667 rounds to 5.042 — well past it. `contact` then
 *     crashed with `ENOENT … rename …/.023.tmp.png`, because ffmpeg writes no
 *     file and still exits 0.
 * Half a frame is 0.0208 s at 24 fps and survives that rounding with room to
 * spare at any frame rate a clip is shot at.
 */
function probeLastFrameTime(path, duration) {
  const { fps, frames } = probeVideoStream(path);
  if (fps && frames !== null && frames > 1) return Math.max(0, (frames - 1.5) / fps);
  if (fps) return Math.max(0, duration - 1.5 / fps);
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

// ---------------------------------------------------------------------------
// retime — a clip's own frames, in another order
// ---------------------------------------------------------------------------

/**
 * `2-40,41-60,2-40` → `[[2,40],[41,60],[2,40]]`.
 *
 * Inclusive, ordered, repeats allowed: the list IS the playback order, which
 * is what lets one take become "breathe, blink, breathe again". Everything
 * checkable without the clip is checked here; "past the last frame" needs the
 * clip and is checked where it is decoded.
 */
function parseKeepRanges(raw) {
  const parts = String(raw).split(",").map((value) => value.trim()).filter(Boolean);
  if (!parts.length) {
    fail("--keep: expected inclusive frame ranges in playback order, e.g. 2-40,60-66,2-40");
  }
  return parts.map((part) => {
    const match = /^(\d+)-(\d+)$/.exec(part);
    if (!match) {
      fail(`--keep: '${part}' is not a frame range — write each one as <first>-<last>, e.g. 2-40 (a single frame is 40-40)`);
    }
    const from = Number(match[1]);
    const to = Number(match[2]);
    if (to < from) {
      fail(`--keep: '${part}' runs backwards — a range plays forwards, so write ${to}-${from} if that is the stretch you meant`);
    }
    return [from, to];
  });
}

/**
 * Replay a clip's own frames in a given order, as an opaque H.264 plate.
 *
 * This is the step the Kiki trial had to improvise with `ffmpeg concat` and
 * then could not record: two Seedance takes both froze for 1.5–2s at the
 * inhale apex and blinked twice, which no prompt wording fixed and a $1.10
 * re-shoot did not either. Cutting the freeze and dropping the second blink
 * is free, deterministic, and invents no pixel — every written frame is a
 * frame the model really drew.
 *
 * It runs on the PLATE, before matting and before interpolation, for the same
 * reason `loop --fps` does: those steps read pixels, and re-encoding a matte
 * to yuv420p would throw its alpha away. A clip that already carries one is
 * refused by name rather than silently flattened.
 *
 * What it does NOT preserve is the first-last guarantee: after a reorder the
 * frames at the wrap are whichever ones the ranges put there, so `firstIs` /
 * `lastIs` are reported and `loop`'s measured seam becomes the only proof
 * that the cycle still closes.
 */
function stepRetime(clip, options) {
  const input = resolve(clip);
  if (!existsSync(input)) fail(`file not found: ${input}`);
  const out = resolve(options.out);
  if (extname(out).toLowerCase() !== ".mp4") {
    fail(`--out: expected an .mp4 path — a retimed plate is opaque H.264, which is what the interpolation and matting steps take (got '${options.out}')`);
  }

  const stream = probeVideoStream(input);
  const fps = round(options.fps ?? stream.fps ?? 0, 3);
  if (!fps) {
    fail(`retime: ${input} reports no frame rate, so there is nothing to replay it at — pass --fps N`);
  }
  const size = probeSize(input, "retime");
  if (size.width % 2 || size.height % 2) {
    fail(`retime: ${input} is ${size.width}x${size.height} and H.264 needs even sides — crop or scale the clip before reordering it`);
  }

  // Beside the output, not in tmpdir: a PNG sequence of a plate clip is the
  // same order of magnitude as the clip itself, and it belongs on whichever
  // disk is about to hold the result. Removed on the way out either way.
  const work = join(dirname(out), `.retime-work-${basename(out, extname(out))}`);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });

  try {
    // Alpha in means this is not a plate. Same guard, same reason and nearly
    // the same sentence as `loop --fps`: the step belongs earlier in the chain.
    const probe = ffmpegTo(join(work, "alpha.png"), () => [
      ...alphaDecodeArgs(input), "-i", input, "-frames:v", "1", "-pix_fmt", "rgba",
    ], "retime alpha probe");
    if (hasAlpha(readRgba(probe))) {
      fail(`retime: ${input} carries its own alpha, so it has already been matted. Reorder the PLATE clip it was made from and matte the result — a retime re-encodes to opaque H.264 and would drop the matte.`);
    }

    const srcDir = join(work, "src");
    mkdirSync(srcDir, { recursive: true });
    ffmpeg([
      "-i", input, "-vf", "format=rgb24",
      "-frames:v", String(MAX_RETIME_SOURCE_FRAMES + 1),
      "-start_number", "0", "--", join(srcDir, "%03d.png"),
    ], "retime decode");
    const sourceFrames = sequenceCount(srcDir, "retime");
    if (sourceFrames > MAX_RETIME_SOURCE_FRAMES) {
      fail(`retime: ${input} is over ${MAX_RETIME_SOURCE_FRAMES} frames — trim it before reordering it`);
    }
    if (sourceFrames < 2) {
      fail(`retime: ${input} decoded to ${sourceFrames} frame(s) — there is no order to change`);
    }

    // Naming a frame the clip does not have is the easy way to silently ship
    // a shorter loop than was asked for, so it is an error and not a clamp.
    for (const [from, to] of options.keep) {
      if (to >= sourceFrames) {
        fail(`--keep ${from}-${to}: the clip has ${sourceFrames} frames (0-${sourceFrames - 1})`);
      }
    }
    const written = options.keep.reduce((sum, [from, to]) => sum + (to - from + 1), 0);
    if (written < 2) {
      fail(`--keep: ${written} frame is not a clip — name at least two frames of playback`);
    }
    if (written > MAX_LOOP_FRAMES) {
      fail(`--keep: ${written} frames is over the ${MAX_LOOP_FRAMES}-frame limit a loop is cut under — drop a range or shorten one`);
    }

    const orderDir = join(work, "order");
    mkdirSync(orderDir, { recursive: true });
    let index = 0;
    for (const [from, to] of options.keep) {
      for (let i = from; i <= to; i++) {
        copyFileSync(join(srcDir, loopFrameName(i)), join(orderDir, loopFrameName(index)));
        index++;
      }
    }

    ffmpegTo(out, () => [
      "-framerate", String(fps), "-start_number", "0", "-i", join(orderDir, "%03d.png"),
      "-frames:v", String(written), "-c:v", "libx264", "-pix_fmt", "yuv420p",
      "-crf", String(RETIME_CRF),
    ], "retime encode");

    return {
      kind: "retime",
      source: input,
      out,
      fps,
      keep: options.keep,
      frames: written,
      sourceFrames,
      duration: round(written / fps, 3),
      // Which source frames now sit at the wrap. A first-last clip closed
      // because both ends were the same generated image; after a reorder that
      // is only true when the ranges put it back, and the skill reads these
      // two numbers to say which case it is looking at.
      firstIs: options.keep[0][0],
      lastIs: options.keep[options.keep.length - 1][1],
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// loop — every frame of a closed window, as a transparent animation for a UI
// ---------------------------------------------------------------------------

/**
 * Decoder flags a clip needs before its alpha survives the decode.
 *
 * ffmpeg's native `vp9` decoder ignores the alpha a WebM carries as block
 * side-data, so a VEED matte comes back fully opaque and every frame of the
 * "transparent" loop is an opaque rectangle. `libvpx-vp9` reads it. ProRes
 * 4444 and every pix_fmt with an alpha plane need nothing special, and the
 * `--key alpha` probe measures the first frame either way, so a build without
 * libvpx refuses with "the clip carries no matte" rather than silently
 * producing 400 opaque frames.
 */
function alphaDecodeArgs(input) {
  const r = spawnSync("ffprobe", [
    "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name",
    "-of", "default=noprint_wrappers=1:nokey=1", input,
  ], { encoding: "utf-8" });
  const codec = r.error || r.status !== 0 ? null : String(r.stdout).trim();
  if (codec === "vp9" && hasDecoder("libvpx-vp9")) return ["-c:v", "libvpx-vp9"];
  return [];
}

/**
 * The screen type `despill` should strip, or null when there is nothing to
 * strip. A chroma plate is a hue; a neutral grey plate (the reference clip's)
 * is not, and despilling it would tint the subject for no reason.
 */
function despillType(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  if (g > r + DESPILL_DOMINANCE && g > b + DESPILL_DOMINANCE) return "green";
  if (b > r + DESPILL_DOMINANCE && b > g + DESPILL_DOMINANCE) return "blue";
  return null;
}

/**
 * The key chain, in the one order that works: **key first, despill second**.
 *
 * Measured on a Seedance 480p flame clip (plate `#01f209`, 640²), ffmpeg 8.0:
 * `despill=type=green,colorkey=0x01f209:0.22:0.05` leaves the whole plate
 * OPAQUE and near-black, because despill has already moved the plate off the
 * colour the key was told to look for. The other way round —
 * `colorkey=…,despill=type=green:mix=0.6:expand=0.5` — removes the plate AND
 * takes the bright-green rim off the silhouette; plain `colorkey` leaves a
 * visible 1–2 px green fringe at 640², which is not acceptable for a UI icon
 * seen at 1:1. `despill` does not touch alpha unless asked to (`alpha=false`
 * is its default), so running it after the key cannot undo the matte.
 */
function loopKeyChain(keyColor, { similarity, blend, despill }) {
  const chain = [];
  if (keyColor) chain.push(`colorkey=${keyColor}:${similarity}:${blend}`);
  chain.push("format=rgba");
  const type = keyColor && despill ? despillType(keyColor) : null;
  if (type) chain.push(`despill=type=${type}:mix=0.6:expand=0.5`);
  return { chain, despill: type };
}

/** Bbox and coverage of one 8-bit gray plane inside a bigger buffer. */
function grayBbox(buffer, offset, width, height, threshold) {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1, count = 0;
  for (let y = 0; y < height; y++) {
    const row = offset + y * width;
    for (let x = 0; x < width; x++) {
      if (buffer[row + x] < threshold) continue;
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

/** How many `NNN.png` a working directory holds, refusing a gap. */
function sequenceCount(dir, label) {
  const names = readdirSync(dir).filter((name) => /^\d{3}\.png$/.test(name)).sort();
  names.forEach((name, i) => {
    if (Number(name.slice(0, 3)) !== i) {
      fail(`${label}: ${dir} is not a contiguous 000.png sequence (found ${name} at position ${i})`);
    }
  });
  return names.length;
}

/**
 * One silhouette per decoded frame, in one pass over the sequence.
 *
 * The masks are read off the DECODED FRAMES rather than off the clip a second
 * time, so mask i is frame i by construction — the hold trimming and the seam
 * both index into this list and into the frames that get written, and a
 * resampling difference between two decodes would silently misalign them.
 */
function decodeLoopMasks(dir, count, size, alphaBased, label, start = 0) {
  const height = scaledHeight(size, ANALYSIS_WIDTH);
  const chain = alphaBased
    ? ["alphaextract", `scale=${ANALYSIS_WIDTH}:${height}`]
    : ["format=gray", `scale=${ANALYSIS_WIDTH}:${height}`];
  const r = spawnSync("ffmpeg", [
    "-v", "error", "-start_number", String(start), "-i", join(dir, "%03d.png"),
    "-frames:v", String(count),
    "-vf", chain.join(","), "-f", "rawvideo", "-pix_fmt", "gray", "-",
  ], { maxBuffer: MAX_RAW_BYTES });
  if (r.error) fail(`${label}: could not analyse the decoded frames (${r.error.message})`);
  if (r.status !== 0) fail(`${label}: could not analyse the decoded frames\n${String(r.stderr ?? "").trim()}`);
  const frameBytes = ANALYSIS_WIDTH * height;
  const got = Math.floor((r.stdout?.length ?? 0) / frameBytes);
  if (got !== count) {
    fail(`${label}: ${count} frames were decoded but ${got} could be analysed — one of them does not decode`);
  }
  const masks = Array.from({ length: got }, (_, i) => r.stdout.subarray(i * frameBytes, (i + 1) * frameBytes));
  return alphaBased ? masks : masks.map(subtractBackground);
}

/**
 * Full-resolution alpha bbox and coverage of every kept frame, read in batches.
 *
 * Batched rather than in one pass because the crop rect has to be exact — a
 * downscaled bbox would either clip the subject or pad it by a guess — and one
 * pass over 400 frames of 1440² alpha is 830 MB in a single Buffer. The batch
 * is sized so no spawn ever buffers more than a quarter of MAX_RAW_BYTES.
 */
function loopFrameBoxes(dir, first, count, size, threshold, label) {
  const frameBytes = size.width * size.height;
  const batch = Math.max(1, Math.floor(MAX_RAW_BYTES / 4 / frameBytes));
  const boxes = [];
  for (let done = 0; done < count; done += batch) {
    const take = Math.min(batch, count - done);
    const r = spawnSync("ffmpeg", [
      "-v", "error", "-start_number", String(first + done), "-i", join(dir, "%03d.png"),
      "-frames:v", String(take), "-vf", "alphaextract",
      "-f", "rawvideo", "-pix_fmt", "gray", "-",
    ], { maxBuffer: MAX_RAW_BYTES });
    if (r.error) fail(`${label}: could not measure the decoded frames (${r.error.message})`);
    if (r.status !== 0) fail(`${label}: could not measure the decoded frames\n${String(r.stderr ?? "").trim()}`);
    if ((r.stdout?.length ?? 0) < take * frameBytes) {
      fail(`${label}: frames ${first + done}..${first + done + take - 1} measured ${r.stdout?.length ?? 0} bytes, expected ${take * frameBytes}`);
    }
    for (let i = 0; i < take; i++) {
      boxes.push(grayBbox(r.stdout, i * frameBytes, size.width, size.height, threshold));
    }
  }
  return boxes;
}

/**
 * Which frames of the window are animation and which are a held pose.
 *
 * `HOLD = 0.25 · median step` — a quarter of a normal frame's change, in this
 * clip's own units and no one else's. Trailing frames go while the last one
 * has frozen back onto the first (a Seedance first-last clip closes on a
 * duplicate of the keyframe); leading frames go while nothing has moved yet,
 * and the LAST frame of that freeze is kept, because it is the pose the loop
 * starts from.
 */
function holdWindow(masks, steps, hold) {
  let first = 0;
  let last = masks.length - 1;
  while (last > first && maskDiff(masks[0], masks[last]) < hold) last--;
  while (first < last && steps[first] < hold) first++;
  return { first, last };
}

function trimHolds(masks, enabled) {
  const steps = [];
  for (let i = 0; i + 1 < masks.length; i++) steps.push(maskDiff(masks[i], masks[i + 1]));
  const hold = HOLD_STEP_FRACTION * median(steps);
  if (!enabled) return { first: 0, last: masks.length - 1, steps };
  return { ...holdWindow(masks, steps, hold), steps };
}

/**
 * How many in-betweens to synthesise at the wrap, given the seam and the step.
 *
 * `auto` fills only a seam the eye can already see — over `SEAM_STEP_LIMIT`
 * steps, the same line the warning is drawn at — and fills it just enough to
 * bring the wrap back to about one step: a seam of `k` steps needs `k - 1`
 * frames in the gap, capped at `MAX_AUTO_SEAM_FILL`. A clip whose median step
 * is 0 (nothing moves) has no scale to measure a seam against, so it gets
 * nothing. An explicit count is obeyed as given — that is what it is for.
 */
function planSeamFill(request, seam, step) {
  if (request === "none") return 0;
  if (request !== "auto") return request;
  if (!(step > 0) || seam <= SEAM_STEP_LIMIT * step) return 0;
  return Math.min(MAX_AUTO_SEAM_FILL, Math.ceil(seam / step) - 1);
}

/**
 * The in-betweens for the one transition the model never drew.
 *
 * A first-last clip closes on its keyframe, so every step inside the window
 * was rendered — except the wrap from the last frame back to the first, which
 * exists only because we play it in a ring. Measured 2026-09-22 on the trial
 * flame (VEED matte, `--key alpha`): a 0.0429 seam against a 0.0131 median
 * step, i.e. a one-frame tick every cycle.
 *
 * FOUR frames go in, not two — `[last-1, last, first, first+1]`. `minterpolate`
 * is bidirectional: it needs a real frame on each side of every in-between,
 * and the two outer frames are what give the wrap the same motion vectors the
 * rest of the loop was interpolated with. At `fps · (fills + 1)` an output
 * frame lands on input `k` exactly at index `k · (fills + 1)` (measured), so
 * `last` is output `fills + 1`, `first` is output `2·(fills + 1)`, and the
 * frames STRICTLY between them are `fills + 2 … 2·fills + 1`.
 *
 * Interpolated in `yuva444p`, i.e. the RGBA frames directly, alpha included:
 * `minterpolate` accepts that format natively (it converts anything else to
 * it — `format=gbrap` shows up as an auto-inserted `gbrap → yuva444p` scale),
 * so the premultiply / alphamerge detour is not needed. The RGBA → yuva444p →
 * RGBA round trip costs mean |ΔRGB| 0.249 (max 2) and mean |Δalpha| 0.031
 * (max 1) on a real keyed flame frame. Working on the already-keyed frames is
 * also what makes this work the same way for a keyed plate and for `--key
 * alpha`: by this point both are the same RGBA sequence.
 */
function fillSeamFrames(srcDir, work, { first, last, fills, fps }) {
  const ringDir = join(work, "seam");
  const outDir = join(work, "seam-fill");
  for (const dir of [ringDir, outDir]) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
  }
  // `Math.max` / `Math.min` for the two-frame loop, where `last - 1` is
  // `first` and `first + 1` is `last`: the ring is then [f, l, f, l], which is
  // still a real frame on both sides of the wrap.
  const ring = [Math.max(first, last - 1), last, first, Math.min(last, first + 1)];
  ring.forEach((index, i) => {
    copyFileSync(join(srcDir, loopFrameName(index)), join(ringDir, loopFrameName(i)));
  });

  ffmpeg([
    "-framerate", String(fps), "-start_number", "0", "-i", join(ringDir, "%03d.png"),
    "-vf", `format=yuva444p,minterpolate=fps=${fps * (fills + 1)}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,format=rgba`,
    "-frames:v", String(2 * fills + 2),
    "-start_number", "0", "-pix_fmt", "rgba", "--", join(outDir, "%03d.png"),
  ], "loop seam fill");

  // Straight into the source sequence, right after the last kept frame: the
  // crop/scale pass reads ONE contiguous `%03d.png` run, and whatever sits at
  // those indices is a frame hold trimming already dropped.
  for (let i = 0; i < fills; i++) {
    const from = join(outDir, loopFrameName(fills + 2 + i));
    if (!existsSync(from)) {
      fail(`--seam-fill ${fills}: minterpolate returned no in-between for the wrap (expected ${2 * fills + 2} frames at ${fps * (fills + 1)}fps, got ${sequenceCount(outDir, "loop")}). Pass --seam-fill none to export the wrap as shot.`);
    }
    copyFileSync(from, join(srcDir, loopFrameName(last + 1 + i)));
  }
}

/**
 * A Lottie image sequence: one embedded PNG per frame, one image layer per
 * frame, each visible for exactly its own frame.
 *
 * Plain Lottie JSON with base64 assets rather than a `.lottie` zip, because
 * lottie-web and every dotLottie player read this shape with no extra writer
 * and no extra file to serve. One writer for both callers — a loop's four
 * exports and a sprite motion's on-demand `export --format lottie` — so the
 * two Lottie files this mode makes cannot drift into two shapes. `framePaths`
 * is the sequence in playback order; each layer is named after its file.
 */
function lottieSequence(framePaths, { fps, name, cell }) {
  const assets = [];
  const layers = [];
  for (let i = 0; i < framePaths.length; i++) {
    const id = `img_${i}`;
    const png = readFileSync(framePaths[i]).toString("base64");
    assets.push({ id, w: cell.width, h: cell.height, u: "", p: `data:image/png;base64,${png}`, e: 1 });
    layers.push({
      ddd: 0, ind: i + 1, ty: 2, nm: `${name}_${basename(framePaths[i], ".png")}`, refId: id, sr: 1,
      ks: {
        o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [0, 0, 0] },
        a: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [100, 100, 100] },
      },
      ao: 0, ip: i, op: i + 1, st: 0, bm: 0,
    });
  }
  return {
    v: "5.7.4", fr: fps, ip: 0, op: framePaths.length,
    w: cell.width, h: cell.height, nm: name, ddd: 0,
    assets, layers,
  };
}

/**
 * The four deliverables. A missing encoder is a warning, never a failure: a
 * build without libvpx still owes the caller its WebP, its APNG and its
 * Lottie, and saying which one is missing is more use than refusing all four.
 */
function writeLoopExports(motionDir, framesDir, { fps, formats, name, cell, frameCount, askedWidth = null }) {
  const paths = {};
  const warnings = [];
  // A deliverable this run is not producing must not survive from the last
  // one: it would sit next to frames it no longer describes, which is the
  // same trap `resetFramesDir` exists to close for the frames themselves.
  for (const format of LOOP_FORMATS) {
    if (formats.includes(format)) continue;
    rmSync(join(motionDir, format === "lottie" ? "loop.json" : `loop.${format}`), { force: true });
  }
  const input = ["-framerate", String(fps), "-start_number", "0", "-i", join(framesDir, "%03d.png")];
  const missing = (file, encoder) =>
    warnings.push(`this ffmpeg build has no ${encoder} encoder — skipped ${file}`);

  if (formats.includes("webp")) {
    // The `gif` step's webp args, minus `flags=neighbor`: a 3D icon is not
    // pixel art, and the frames were already scaled to their final size.
    // `libwebp_anim` rather than `libwebp` — see `hasLibwebp`; the still
    // encoder's output ghosts every previous frame through the transparency.
    if (hasLibwebp()) {
      paths.webp = ffmpegTo(join(motionDir, "loop.webp"), () => [
        ...input, "-c:v", "libwebp_anim", "-pix_fmt", "yuva420p", "-q:v", "85", "-loop", "0",
      ], "loop webp");
    } else missing("loop.webp", "libwebp_anim");
  }
  if (formats.includes("apng")) {
    if (hasEncoder("apng")) {
      paths.apng = ffmpegTo(join(motionDir, "loop.apng"), () => [
        ...input, "-f", "apng", "-plays", "0", "-pred", "mixed", "-pix_fmt", "rgba",
      ], "loop apng");
    } else missing("loop.apng", "apng");
  }
  if (formats.includes("webm")) {
    // `-auto-alt-ref 0` is not a quality knob here: libvpx-vp9 refuses to
    // carry an alpha plane with alt-ref frames enabled.
    if (hasEncoder("libvpx-vp9")) {
      paths.webm = ffmpegTo(join(motionDir, "loop.webm"), () => [
        ...input, "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p",
        "-auto-alt-ref", "0", "-b:v", "0", "-crf", "30", "-row-mt", "1",
      ], "loop webm");
    } else missing("loop.webm", "libvpx-vp9");
  }
  if (formats.includes("lottie")) {
    paths.lottie = writeJsonFile(
      join(motionDir, "loop.json"),
      lottieSequence(
        Array.from({ length: frameCount }, (_, i) => join(framesDir, loopFrameName(i))),
        { fps, name, cell },
      ),
    );
  }

  const sizes = {};
  for (const [format, path] of Object.entries(paths)) sizes[format] = statSync(path).size;

  // What to DO about a deliverable nobody can ship depends on what was
  // already asked for. "Pass --width to shrink the frames" is the right
  // sentence when the flag was omitted and the frames came out at the clip's
  // own size; said to a caller who passed `--width 512` it is advice they
  // have already taken, and the trial agent that read it could only
  // acknowledge the warning and move on. With a width on record the honest
  // options are a smaller one or a format that does not grow with the
  // picture — the WebM was 0.55 MB where the Lottie was 45.
  const advice = (tail) => (askedWidth === null
    ? `pass --width to shrink the frames ${tail}`
    : `already at --width ${askedWidth}; halve it, or ship loop.webm instead`);
  if (sizes.lottie > MAX_LOTTIE_BYTES) {
    warnings.push(`loop.json is ${(sizes.lottie / 1e6).toFixed(1)} MB of base64 PNG — ${advice("before a browser has to parse it")}`);
  }
  if (sizes.apng > MAX_APNG_BYTES) {
    warnings.push(`loop.apng is ${(sizes.apng / 1e6).toFixed(1)} MB — ${advice("before a page has to download it")}`);
  }
  return { paths, sizes, warnings };
}

/**
 * Erase the colour under every transparent pixel of the written frames — the
 * loop's form of `zeroKeyedRgb`, applied where the sprite path applies it.
 *
 * It cannot be done before the scale, because the scale is what creates the
 * problem: `premultiply → scale → unpremultiply` divides the resampled colour
 * back out by a resampled alpha, so an edge pixel that lands on alpha 1 comes
 * out at FULL brightness. Measured on the reference flame at --width 512:
 * 395 pixels below the alpha threshold carried colour, up to 255 — a bright
 * one-pixel rim for anything that ignores alpha, and the same bleed the packed
 * sheet once showed as solid green.
 *
 * Batched raw rgba in, one PNG sequence out per batch: two ffmpeg spawns for a
 * 109-frame loop instead of two per frame, and no batch ever buffers more than
 * half of MAX_RAW_BYTES.
 */
function zeroLoopFrames(framesDir, count, cell, threshold) {
  const frameBytes = cell.width * cell.height * 4;
  const batch = Math.max(1, Math.floor(MAX_RAW_BYTES / 2 / frameBytes));
  let zeroed = 0;
  for (let done = 0; done < count; done += batch) {
    const take = Math.min(batch, count - done);
    const r = spawnSync("ffmpeg", [
      "-v", "error", "-start_number", String(done), "-i", join(framesDir, "%03d.png"),
      "-frames:v", String(take), "-f", "rawvideo", "-pix_fmt", "rgba", "-",
    ], { maxBuffer: MAX_RAW_BYTES });
    if (r.error) fail(`loop: could not re-read the written frames (${r.error.message})`);
    if (r.status !== 0) fail(`loop: could not re-read the written frames\n${String(r.stderr ?? "").trim()}`);
    const wanted = take * frameBytes;
    if ((r.stdout?.length ?? 0) < wanted) {
      fail(`loop: frames ${done}..${done + take - 1} re-read as ${r.stdout?.length ?? 0} bytes, expected ${wanted}`);
    }
    const data = r.stdout.subarray(0, wanted);
    let touched = 0;
    for (let i = 0; i < wanted; i += 4) {
      if (data[i + 3] >= threshold) continue;
      if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0) continue;
      data[i] = 0; data[i + 1] = 0; data[i + 2] = 0;
      touched++;
    }
    if (!touched) continue;
    zeroed += touched;
    ffmpeg([
      "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${cell.width}x${cell.height}`, "-i", "-",
      "-frames:v", String(take), "-pix_fmt", "rgba",
      "-start_number", String(done), "--", join(framesDir, "%03d.png"),
    ], "loop frames", data);
  }
  return zeroed;
}

/** Crop rect with even sides, which is what yuva420p and every scaler want. */
function evenRect(rect, size) {
  const maxW = size.width - (size.width % 2);
  const maxH = size.height - (size.height % 2);
  const w = Math.max(2, Math.min(maxW, rect.w + (rect.w % 2)));
  const h = Math.max(2, Math.min(maxH, rect.h + (rect.h % 2)));
  return { x: Math.max(0, Math.min(rect.x, size.width - w)), y: Math.max(0, Math.min(rect.y, size.height - h)), w, h };
}

/**
 * What a clip is before a frame is decoded: the window, its size and rate,
 * how its transparency is got — the checks `loop` and `transition` share, so
 * both refuse the same impossible request with the same sentence.
 */
function prepareClip(input, options, label) {
  const { duration, start, end } = clipWindow(input, { ...options, label });
  const windowEnd = Math.min(end, duration);
  const span = windowEnd - start;
  const size = probeSize(input, label);
  const stream = probeVideoStream(input);

  const alphaSource = options.key === "alpha";
  const keying = options.key !== "none" && !alphaSource;
  // Asked once: the probe and the decode have to agree on the decoder, or the
  // probe would clear a clip whose alpha the decode then drops.
  const decodeArgs = alphaSource ? alphaDecodeArgs(input) : [];
  if (options.fps !== null) {
    if (alphaSource) {
      fail("--fps interpolates the plate, and --key alpha says the clip has already been matted. Interpolate FIRST (interpolate-video.mjs --target-fps N), then matte the result and run loop --key alpha on that.");
    }
    if (!stream.fps) {
      fail(`--fps: ${input} reports no frame rate, so there is nothing to interpolate from`);
    }
  }
  const plannedFps = options.fps ?? stream.fps;
  if (plannedFps) {
    const estimate = Math.ceil(span * plannedFps);
    if (estimate > MAX_LOOP_FRAMES) {
      fail(`a ${round(span, 3)}s window at ${round(plannedFps, 3)}fps is about ${estimate} frames — the limit is ${MAX_LOOP_FRAMES}. Narrow the window with --trim-start/--trim-end, or lower --fps.`);
    }
  }

  return { start, windowEnd, span, size, stream, alphaSource, keying, decodeArgs };
}

/**
 * Decode a clip's window into `<work>/src/%03d.png` in one pass, keyed to
 * transparency (or with its own matte, `--key alpha`), and — `loop --fps`
 * only — interpolated on the plate first. Shared by `loop` and `transition`.
 */
function decodeClipFrames(input, prep, options, work, label) {
  const { start, span, size, stream, alphaSource, keying, decodeArgs } = prep;
  // --- 1. what the plate is ---------------------------------------------
  let keyColor = null;
  if (keying) {
    if (options.key === "auto") {
      // Off a RAW frame at the window start, like `contact`: the clip's own
      // idea of the plate, codec drift included.
      const frame = ffmpegTo(join(work, "key.png"), () => [
        "-ss", String(round(start, 3)), "-i", input, "-frames:v", "1", "-pix_fmt", "rgba",
      ], `${label} key frame`);
      keyColor = stepProbe(frame, options.threshold).cornerColor;
    } else {
      keyColor = normalizeColor(options.key, "--key");
    }
  }
  if (alphaSource) {
    const probe = ffmpegTo(join(work, "alpha.png"), () => [
      "-ss", String(round(start, 3)), ...decodeArgs, "-i", input,
      "-frames:v", "1", "-pix_fmt", "rgba",
    ], `${label} alpha probe`);
    if (!hasAlpha(readRgba(probe))) {
      fail(`--key alpha: the first frame of ${input} is fully opaque, so the clip carries no matte. Matte it first (remove-video-background.mjs), or key its plate here with --key auto or --key #rrggbb.`);
    }
  }
  const { chain: keyChain, despill } = loopKeyChain(keyColor, options);

  // --- 2. decode the whole window in one pass ----------------------------
  const srcDir = join(work, "src");
  mkdirSync(srcDir, { recursive: true });
  let frameFps;
  if (options.fps === null) {
    ffmpeg([
      "-ss", String(start), "-t", String(span), ...decodeArgs,
      "-i", input, "-vf", keyChain.join(","),
      "-frames:v", String(MAX_LOOP_FRAMES + 1),
      "-start_number", "0", "-pix_fmt", "rgba", "--", join(srcDir, "%03d.png"),
    ], `${label} decode`);
    frameFps = stream.fps;
  } else {
    // --- 3. interpolate, on the PLATE, wrapped around the loop -----------
    // minterpolate estimates motion on a yuv plate; in-betweens synthesised
    // from two already-keyed frames would smear the matte instead. The extra
    // copy of frame 0 at the end is what makes the in-betweens between the
    // last frame and the first real frames rather than a cut.
    const plateDir = join(work, "plate");
    mkdirSync(plateDir, { recursive: true });
    ffmpeg([
      "-ss", String(start), "-t", String(span), "-i", input,
      "-vf", "format=rgb24", "-frames:v", String(MAX_LOOP_FRAMES + 1),
      "-start_number", "0", "--", join(plateDir, "%03d.png"),
    ], `${label} plate decode`);
    const plateCount = sequenceCount(plateDir, label);
    if (plateCount < 2) {
      fail(`${label}: ${round(span, 3)}s from ${round(start, 3)}s of ${input} decoded to ${plateCount} frame(s) — nothing to interpolate`);
    }
    // TWO copies, not one. `minterpolate` cannot extrapolate past its last
    // input: 25 frames in at 24 fps came back as 47 at 48 fps, covering
    // exactly the original 0..23/24 and none of the wrap (measured, ffmpeg
    // 8.0). It needs a real frame on BOTH sides of every in-between, so the
    // window is followed by frames 0 and 1 of itself — the loop continuing —
    // and the in-betweens that carry the last frame back into the first are
    // then interpolated from real neighbours like every other one.
    copyFileSync(join(plateDir, loopFrameName(0)), join(plateDir, loopFrameName(plateCount)));
    copyFileSync(join(plateDir, loopFrameName(1)), join(plateDir, loopFrameName(plateCount + 1)));

    const interpDir = join(work, "interp");
    mkdirSync(interpDir, { recursive: true });
    ffmpeg([
      "-framerate", String(stream.fps), "-start_number", "0", "-i", join(plateDir, "%03d.png"),
      "-vf", `format=yuv420p,minterpolate=fps=${options.fps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1`,
      "-start_number", "0", "--", join(interpDir, "%03d.png"),
    ], `${label} interpolate`);

    // Everything from the appended copy onwards is dropped; the in-betweens
    // that lead INTO it are the wrap and are kept.
    const produced = sequenceCount(interpDir, label);
    const keep = Math.min(Math.round((options.fps * plateCount) / stream.fps), produced);
    if (keep < 2) fail(`--fps ${options.fps}: interpolating a ${round(span, 3)}s window produced ${keep} frame(s)`);
    if (keep > MAX_LOOP_FRAMES) {
      fail(`--fps ${options.fps} over a ${round(span, 3)}s window is ${keep} frames — the limit is ${MAX_LOOP_FRAMES}`);
    }
    ffmpeg([
      "-framerate", String(options.fps), "-start_number", "0", "-i", join(interpDir, "%03d.png"),
      "-frames:v", String(keep), "-vf", keyChain.join(","),
      "-start_number", "0", "-pix_fmt", "rgba", "--", join(srcDir, "%03d.png"),
    ], `${label} key`);
    frameFps = options.fps;
  }

  const decoded = sequenceCount(srcDir, label);
  if (decoded > MAX_LOOP_FRAMES) {
    fail(`the window decoded to more than ${MAX_LOOP_FRAMES} frames — narrow it with --trim-start/--trim-end`);
  }
  if (decoded < 2) {
    fail(`${label}: ${round(span, 3)}s from ${round(start, 3)}s of ${input} decoded to ${decoded} frame(s) — a loop needs at least two`);
  }
  const fps = round(frameFps ?? decoded / span, 3);
  return { keyColor, despill, srcDir, decoded, fps };
}

/**
 * Crop `count` decoded frames from `first` to ONE union rect, scale them to
 * the width, write them to `framesDir` as `%03d.png` with the transparent
 * pixels zeroed, and say where they sit in the clip (`crop`, `scale`).
 * Shared by `loop` and `transition`, so a transition's frames sit in clip
 * coordinates exactly the way a loop's do.
 */
function cutClipFrames(srcDir, first, count, size, options, framesDir, { keyed, label }) {
  // --- 6. crop and scale -------------------------------------------------
  const boxes = keyed
    ? loopFrameBoxes(srcDir, first, count, size, options.threshold, label)
    : Array.from({ length: count }, () => ({
      coverage: 1, bbox: { x: 0, y: 0, w: size.width, h: size.height },
    }));
  const emptyFrames = boxes.map((b, i) => (b.bbox ? -1 : i)).filter((i) => i >= 0);
  const alphaCoverage = round(boxes.reduce((sum, b) => sum + b.coverage, 0) / count, 4);

  let crop = { x: 0, y: 0, w: size.width, h: size.height };
  if (options.crop === "union") {
    const filled = boxes.map((b) => b.bbox).filter(Boolean);
    if (!filled.length) {
      fail(`every frame is empty above alpha threshold ${options.threshold} — check --key, --similarity and --blend against what 'contact' showed`);
    }
    // ONE rect for every frame, so what moves inside it keeps moving: a
    // per-frame crop would silently re-centre the subject and flatten the
    // very motion the loop exists to show.
    const x0 = Math.max(0, Math.min(...filled.map((b) => b.x)) - options.pad);
    const y0 = Math.max(0, Math.min(...filled.map((b) => b.y)) - options.pad);
    const x1 = Math.min(size.width, Math.max(...filled.map((b) => b.x + b.w)) + options.pad);
    const y1 = Math.min(size.height, Math.max(...filled.map((b) => b.y + b.h)) + options.pad);
    crop = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  crop = evenRect(crop, size);

  // No `--width` and a frame bigger than a UI ever asks for: cap it, and
  // say so. The clip's own size is not a decision anybody made — the Kiki
  // trial cut 532px frames because the flag was omitted and shipped a 45 MB
  // Lottie. One line on stderr and one flag in the report, so the choice is
  // visible and overridable rather than silently inherited from the codec.
  const widthDefaulted = options.width === null && crop.w > DEFAULT_LOOP_WIDTH;
  if (widthDefaulted) {
    console.error(`no --width given: frames capped at ${DEFAULT_LOOP_WIDTH} px (source ${crop.w} px); pass --width to choose`);
  }
  const targetWidth = widthDefaulted ? DEFAULT_LOOP_WIDTH : options.width;

  const outWidth = targetWidth === null ? crop.w : Math.max(2, 2 * Math.round(targetWidth / 2));
  const outHeight = targetWidth === null
    ? crop.h
    : scaledHeight({ width: crop.w, height: crop.h }, outWidth);

  // premultiply → scale → unpremultiply. Scaling straight alpha mixes every
  // edge pixel with whatever RGB sits under the transparent pixel beside it
  // — the plate on a keyed frame, black on a zeroed one, a dark halo either
  // way. Premultiplied, a transparent pixel contributes nothing, so the edge
  // keeps the subject's own colour and only its alpha falls off.
  //
  // 8-bit, and `area` in both directions. A kernel with NEGATIVE LOBES rings
  // a premultiplied matte into black at the silhouette, which is the dark
  // fringe this whole detour exists to avoid; `area` has none (a box filter
  // going down, plain linear going up). Measured on the reference flame at
  // ffmpeg 8.0, counting the partially transparent pixels whose luminance is
  // under 40 — 1160x1432 down to 512: lanczos 123, bicubic 5, area 0;
  // 484x566 up to 512: lanczos 46, spline 40, bicubic 28, area 0. Also 8-bit
  // rather than rgba64: a 16-bit alpha of 1..256 comes back as 8-bit 0 while
  // `unpremultiply` has already divided its colour back up to full
  // brightness, which left 997 transparent pixels carrying up to 255.
  const chain = [`crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`, "premultiply=inplace=1"];
  if (outWidth !== crop.w || outHeight !== crop.h) {
    chain.push(`scale=${outWidth}:${outHeight}:flags=area`);
  }
  chain.push("unpremultiply=inplace=1");

  resetFramesDir(framesDir);
  ffmpeg([
    "-start_number", String(first), "-i", join(srcDir, "%03d.png"),
    "-frames:v", String(count), "-vf", chain.join(","),
    "-start_number", "0", "-pix_fmt", "rgba", "--", join(framesDir, "%03d.png"),
  ], `${label} frames`);
  const written = sequenceCount(framesDir, label);
  if (written !== count) {
    fail(`${label}: wrote ${written} of ${count} frames into ${framesDir} — a frame could not be re-encoded`);
  }
  const cell = { width: outWidth, height: outHeight };
  zeroLoopFrames(framesDir, count, cell, options.threshold);
  // What maps a frame back onto its clip: frame px = (clip px − crop.xy) ×
  // scale. Every loop is cut to its OWN union box and then scaled to one
  // width, so two loops of one character come out at different scales —
  // tanka's ten were drawn at 1.03-1.42× their clips — and anything that
  // plays them together (the .riv) has to undo that to keep the character
  // one size, and to put each where it stood in its clip. One number: the
  // width ratio, which the height ratio matches to the even-pixel rounding.
  const clipScale = round(outWidth / crop.w, 4);
  return { crop, cell, clipScale, emptyFrames, alphaCoverage, widthDefaulted, outWidth };
}

/**
 * A loop motion: every frame of a window that closes on itself, keyed to
 * transparency and exported in the four shapes a UI can play.
 *
 * Nothing here aligns, cleans or packs. A sprite motion is a grid of poses an
 * engine indexes into, so its frames are pinned to a common anchor; a loop is
 * a film of one moving thing, so moving it back to an anchor would take the
 * movement out. The clip is only read — like `from-video`, it is a registered
 * asset in its own right and is never copied into the motion directory.
 */
function stepLoop(clip, options) {
  const input = resolve(clip);
  if (!existsSync(input)) fail(`file not found: ${input}`);
  const motionDir = resolve(options.out);
  mkdirSync(motionDir, { recursive: true });

  const prep = prepareClip(input, options, "loop");
  const { start, windowEnd, span, size, alphaSource, keying } = prep;

  const framesDir = join(motionDir, "frames");
  // The working frames live under the motion directory, not in tmpdir: they
  // are the same order of magnitude as the clip, and a rename into `frames/`
  // has to stay on one filesystem. Removed on the way out, success or failure.
  const work = join(motionDir, ".loop-work");
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });

  try {
    const { keyColor, despill, srcDir, decoded, fps } = decodeClipFrames(input, prep, options, work, "loop");

    // --- 4. holds, and 5. the seam ----------------------------------------
    const masks = decodeLoopMasks(srcDir, decoded, size, keying || alphaSource, "loop");
    const { first, last, steps } = trimHolds(masks, options.trimHolds);
    const shot = last - first + 1;
    if (shot < 2) {
      fail(`--trim-holds left ${shot} of ${decoded} frames — the clip holds one pose throughout. Pass --no-trim-holds to keep every frame, or shoot a clip that moves.`);
    }
    const kept = steps.slice(first, last);
    const step = round(median(kept), 4);
    const maxStep = round(Math.max(...kept), 4);
    const dropped = { leading: first, trailing: decoded - 1 - last };
    let seam = round(maskDiff(masks[last], masks[first]), 4);

    // --- 5b. fill the seam -------------------------------------------------
    // Before the crop, so the in-betweens are inside the union bbox and go
    // through the same scale and the same alpha zeroing as every other frame.
    const seamFill = planSeamFill(options.seamFill, seam, step);
    if (shot + seamFill > MAX_LOOP_FRAMES) {
      fail(`--seam-fill ${seamFill} on top of ${shot} frames is over the ${MAX_LOOP_FRAMES} frame limit — narrow the window with --trim-start/--trim-end, or pass --seam-fill none`);
    }
    if (seamFill > 0) {
      fillSeamFrames(srcDir, work, { first, last, fills: seamFill, fps });
      // The seam is now the WORST step across the wrap, not the gap it used to
      // be: an in-between that lands badly must not be able to hide behind the
      // two ends having been brought closer together.
      const wrap = [masks[last], ...decodeLoopMasks(srcDir, seamFill, size, keying || alphaSource, "loop", last + 1), masks[first]];
      let worst = 0;
      for (let i = 0; i + 1 < wrap.length; i++) worst = Math.max(worst, maskDiff(wrap[i], wrap[i + 1]));
      seam = round(worst, 4);
    }
    const count = shot + seamFill;

    const warnings = [];
    if (seam > SEAM_STEP_LIMIT * step) {
      warnings.push(seamFill > 0
        ? `the loop does not close — even with ${seamFill} interpolated frame(s) at the wrap the worst step there is ${seam} against a normal step of ${step}; shoot again with the same image at both ends, or pass --trim-start/--trim-end from the contact sheet`
        : `the loop does not close — the last frame is ${seam} from the first against a normal step of ${step}; shoot again with the same image at both ends, or pass --trim-start/--trim-end from the contact sheet`);
    }

    // --- 6. crop and scale -------------------------------------------------
    const { crop, cell, clipScale, emptyFrames, alphaCoverage, widthDefaulted } = cutClipFrames(
      srcDir, first, count, size, options, framesDir, { keyed: keying || alphaSource, label: "loop" },
    );

    // --- 7. the deliverables ----------------------------------------------
    const { paths, sizes, warnings: exportWarnings } = writeLoopExports(motionDir, framesDir, {
      fps, formats: options.formats, name: options.name, cell, frameCount: count,
      // The width the CALLER asked for, not the one that landed: "pass
      // --width" is dead advice to someone who already did.
      askedWidth: options.width,
    });

    if (keyColor && alphaCoverage > KEYED_OPAQUE_ALERT) {
      warnings.push(`keying ${keyColor} left ${(alphaCoverage * 100).toFixed(0)}% of each frame opaque — was the clip shot on a flat chroma background?`);
    }
    if (options.key === "none") {
      warnings.push("--key none: the frames are opaque, so the loop has no transparency to composite over a UI");
    }
    warnings.push(...listAndTruncate(emptyFrames, (i) => `frame ${loopFrameName(i).slice(0, 3)} is empty`));
    if (count < MIN_LOOP_FRAMES) {
      warnings.push(`${count} frames is a slideshow, not a loop — shoot a longer clip, widen the window, or raise --fps`);
    }
    warnings.push(...exportWarnings);

    // --- 8. the report ----------------------------------------------------
    // No anchorDrift / bodyDrift / maxJump / scaleDrift: a loop is not judged
    // on them, and a number nobody judges is noise in the agent's context.
    const inspect = {
      kind: "loop",
      frameCount: count,
      cell,
      crop,
      scale: clipScale,
      // Present only when the cap really fired: `false` on every run that
      // passed `--width` would read as a statement about a default that was
      // never consulted.
      ...(widthDefaulted ? { widthDefaulted: true } : {}),
      fps,
      duration: round(count / fps, 3),
      seam,
      step,
      maxStep,
      alphaCoverage,
      ...(keyColor ? { keyColor } : {}),
      emptyFrames,
      dropped,
      seamFill,
      exports: sizes,
      warnings,
    };
    writeJsonFile(join(motionDir, "inspect.json"), inspect);

    // --- 9. the run summary `register-run` consumes ------------------------
    // `null` for a filled frame: it has a place in the loop but no source
    // timestamp, and a made-up one would put a frame the clip never contained
    // on a provenance edge as if it had been sampled from it.
    const sampledAt = Array.from({ length: count }, (_, i) => (
      i < shot ? round(start + (first + i) / fps, 3) : null
    ));
    return {
      kind: "loop",
      source: "video",
      video: input,
      motionDir,
      name: options.name,
      frames: Array.from({ length: count }, (_, i) => join(framesDir, loopFrameName(i))),
      sampledAt,
      fps,
      duration: round(count / fps, 3),
      trim: { start: round(start, 3), end: round(windowEnd, 3) },
      dropped,
      seamFill,
      ...(keyColor ? { keyColor } : {}),
      ...(despill ? { despill } : {}),
      alphaCoverage,
      cell,
      crop,
      scale: clipScale,
      ...(widthDefaulted ? { widthDefaulted: true } : {}),
      ...(paths.webp ? { webp: paths.webp } : {}),
      ...(paths.apng ? { apng: paths.apng } : {}),
      ...(paths.webm ? { webm: paths.webm } : {}),
      ...(paths.lottie ? { lottie: paths.lottie } : {}),
      inspect,
      warnings,
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * `transition <clip> --character <dir> --from A --to B`: the take between two
 * loops, cut the way `loop` cuts a clip — one decode, keyed or with its own
 * matte, one union crop, one width — so its frames sit in clip coordinates
 * exactly as the loops' do. What differs is what a transition is: it plays
 * once, so there is no seam to measure or fill; the holds a first-last model
 * leaves at both ends are collapsed to one frame each; `--duration` retimes
 * it to the length it should play by even sampling that keeps the first and
 * the last frame; and it is judged on whether its ends LAND — `startGap`
 * against A's frame 0 and `endGap` against B's, against its own median step.
 */
function stepTransition(clip, options) {
  const label = "transition";
  const character = readCharacterProject(options.character, label);
  const ends = transitionEnds(character, options.from, options.to, label);
  if (options.key === "none") fail(`${label}: --key none leaves no alpha, and a transition is placed and measured by its alpha — use --key alpha (a matted take) or --key auto`);
  const input = resolve(clip);
  if (!existsSync(input)) fail(`file not found: ${input}`);
  const name = options.name ?? `${ends.from.id}-to-${ends.to.id}`;
  const motionDir = resolve(options.out ?? join(character.dir, "motions", name));
  mkdirSync(motionDir, { recursive: true });
  const prep = prepareClip(input, { ...options, fps: null }, label);
  const { start, windowEnd, size } = prep;
  const framesDir = join(motionDir, "frames");
  const work = join(motionDir, ".transition-work");
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });

  try {
    const { keyColor, despill, srcDir, decoded, fps } = decodeClipFrames(input, prep, { ...options, fps: null }, work, label);
    const warnings = [];

    // --- holds at both ends, collapsed to one frame each ------------------
    const masks = decodeLoopMasks(srcDir, decoded, size, true, label);
    const steps = [];
    for (let i = 0; i + 1 < masks.length; i++) steps.push(maskDiff(masks[i], masks[i + 1]));
    const { first, last } = options.trimHolds ? transitionHolds(steps) : { first: 0, last: decoded - 1 };
    const moving = last - first + 1;
    if (moving < 2) {
      fail(`${label}: --trim-holds left ${moving} of ${decoded} frames — the take holds one pose throughout. Pass --no-trim-holds to keep every frame, or shoot a take that moves.`);
    }

    // --- retime to the length it should play -------------------------------
    let picked = Array.from({ length: moving }, (_, i) => first + i);
    let retime = null;
    if (options.duration !== null) {
      const target = Math.max(2, Math.round(options.duration * fps));
      if (target < moving) {
        picked = Array.from({ length: target }, (_, i) => first + Math.round((i * (moving - 1)) / (target - 1)));
        retime = { from: moving, to: target };
      } else if (target > moving) {
        warnings.push(`--duration ${options.duration}: the take moves for only ${moving} frames (${round(moving / fps, 3)}s) — every frame is kept; a transition is never stretched`);
      }
    }
    const pickedDir = join(work, "picked");
    mkdirSync(pickedDir, { recursive: true });
    picked.forEach((index, i) => copyFileSync(join(srcDir, loopFrameName(index)), join(pickedDir, loopFrameName(i))));
    const count = picked.length;

    // --- crop and scale, as `loop` does ------------------------------------
    const { crop, cell, clipScale, emptyFrames, alphaCoverage, widthDefaulted } = cutClipFrames(
      pickedDir, 0, count, size, options, framesDir, { keyed: true, label },
    );
    warnings.push(...listAndTruncate(emptyFrames, (i) => `frame ${loopFrameName(i).slice(0, 3)} is empty`));

    // --- does it land? -----------------------------------------------------
    const placement = { origin: { x: crop.x, y: crop.y }, scale: clipScale };
    const joins = transitionJoins(character, ends, framesDir, count, cell, placement, work, label);
    warnings.push(...joins.warnings);

    const inspect = {
      kind: "transition",
      from: ends.from.id,
      to: ends.to.id,
      frameCount: count,
      cell,
      crop,
      scale: clipScale,
      ...(widthDefaulted ? { widthDefaulted: true } : {}),
      fps,
      duration: round(count / fps, 3),
      step: joins.step,
      ...(joins.startGap === null ? {} : { startGap: joins.startGap }),
      ...(joins.endGap === null ? {} : { endGap: joins.endGap }),
      alphaCoverage,
      ...(keyColor ? { keyColor } : {}),
      emptyFrames,
      dropped: { leading: first, trailing: decoded - 1 - last },
      ...(retime ? { retime } : {}),
      warnings,
    };
    writeJsonFile(join(motionDir, "inspect.json"), inspect);
    return {
      kind: "transition",
      source: "video",
      video: input,
      from: ends.from.id,
      to: ends.to.id,
      motionDir,
      name,
      frames: Array.from({ length: count }, (_, i) => join(framesDir, loopFrameName(i))),
      sampledAt: picked.map((index) => round(start + index / fps, 3)),
      fps,
      duration: round(count / fps, 3),
      trim: { start: round(start, 3), end: round(windowEnd, 3) },
      dropped: inspect.dropped,
      ...(retime ? { retime } : {}),
      ...(keyColor ? { keyColor } : {}),
      ...(despill ? { despill } : {}),
      alphaCoverage,
      cell,
      crop,
      scale: clipScale,
      ...(widthDefaulted ? { widthDefaulted: true } : {}),
      inspect,
      warnings,
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * `transition --reverse-of <id> --character <dir>`: the way back, free — the
 * registered frames of A → B, copied in reverse order as B → A. The copy is
 * what the viewer and a per-motion export play; the `.riv` reuses the
 * source's images when both are in the file. Its crop, scale and rate are
 * the source's, and its ends are measured again against B and A, because
 * "reversed, so it lands" is exactly the kind of claim that is checked here.
 */
function stepReverseTransition(options) {
  const label = "transition";
  const character = readCharacterProject(options.character, label);
  const source = character.doc.sprite.motions.find((m) => m && m.id === options.reverseOf);
  if (!source) fail(`${label}: --reverse-of: no motion '${options.reverseOf}' in ${character.dir}/project.json`);
  if (source.kind !== "transition") fail(`${label}: --reverse-of: '${source.id}' is not a transition`);
  if (!Array.isArray(source.frames) || !source.frames.length) {
    fail(`${label}: --reverse-of: ${source.id} has no registered frames — cut it and register it first`);
  }
  const clip = recordedLoopClip(source);
  if (!clip?.origin) fail(`${label}: --reverse-of: ${source.id} has no recorded crop and scale — cut it again with 'transition'`);
  const ends = transitionEnds(character, source.to, source.from, label);
  const frames = registeredFrames(character, source, label);
  const name = options.name ?? `${ends.from.id}-to-${ends.to.id}`;
  const motionDir = resolve(options.out ?? join(character.dir, "motions", name));
  const framesDir = join(motionDir, "frames");
  resetFramesDir(framesDir);
  const count = frames.paths.length;
  frames.paths.forEach((path, i) => copyFileSync(path, join(framesDir, loopFrameName(count - 1 - i))));
  const cell = probeSize(frames.paths[0], label);
  const fps = Number(source.fps) > 0 ? Number(source.fps) : fail(`${label}: --reverse-of: ${source.id} has no usable fps`);
  const work = mkdtempSync(join(tmpdir(), "sprite-reverse-"));
  try {
    const placement = { origin: clip.origin, scale: clip.scale };
    const joins = transitionJoins(character, ends, framesDir, count, cell, placement, work, label);
    const crop = source.inspect?.crop;
    const inspect = {
      kind: "transition",
      from: ends.from.id,
      to: ends.to.id,
      reverseOf: source.id,
      frameCount: count,
      cell,
      crop,
      scale: clip.scale,
      fps,
      duration: round(count / fps, 3),
      step: joins.step,
      ...(joins.startGap === null ? {} : { startGap: joins.startGap }),
      ...(joins.endGap === null ? {} : { endGap: joins.endGap }),
      ...(Number.isFinite(source.inspect?.alphaCoverage) ? { alphaCoverage: source.inspect.alphaCoverage } : {}),
      emptyFrames: [],
      warnings: joins.warnings,
    };
    writeJsonFile(join(motionDir, "inspect.json"), inspect);
    return {
      kind: "transition",
      source: "reverse",
      reverseOf: source.id,
      from: ends.from.id,
      to: ends.to.id,
      motionDir,
      name,
      frames: Array.from({ length: count }, (_, i) => join(framesDir, loopFrameName(i))),
      fps,
      duration: inspect.duration,
      cell,
      crop,
      scale: clip.scale,
      inspect,
      warnings: joins.warnings,
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
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
// Exports — a finished motion in the shape somebody else's tool reads
// ---------------------------------------------------------------------------

/** The file a motion export lands in, inside `motions/<id>/exports/`. */
function exportFileName(motionId, format) {
  if (format === "png-seq") return `${motionId}-frames.zip`;
  return `${motionId}.${format === "lottie" ? "json" : format}`;
}

/**
 * Render into a scratch file beside the destination, let `render` check it,
 * and rename only if it returns. `ffmpegTo` renames whatever ffmpeg wrote;
 * an export is probed first, so a file that is not what it claims to be never
 * takes the real name — not even for a moment.
 */
function renderVerified(outPath, render) {
  const out = resolve(outPath);
  mkdirSync(dirname(out), { recursive: true });
  const scratch = join(dirname(out), `.${basename(out, extname(out))}.tmp${extname(out)}`);
  try {
    const result = render(scratch);
    renameSync(scratch, out);
    return result;
  } finally {
    if (existsSync(scratch)) rmSync(scratch, { force: true });
  }
}

/** Write bytes through a scratch file beside the destination, then rename —
 *  the same guarantee `ffmpegTo` and `writeJsonFile` give. */
function writeBytesAtomic(outPath, bytes) {
  const out = resolve(outPath);
  mkdirSync(dirname(out), { recursive: true });
  const scratch = join(dirname(out), `.${basename(out)}.tmp`);
  try {
    writeFileSync(scratch, bytes);
    renameSync(scratch, out);
  } finally {
    if (existsSync(scratch)) rmSync(scratch, { force: true });
  }
  return out;
}

/**
 * A character's project.json, READ-ONLY.
 *
 * `sprite-project.mjs` stays the only writer; the exports read it because
 * "only a finished motion can be exported" and "which frames are this
 * motion's" are both facts that live there and nowhere else.
 */
function readCharacterProject(characterDir, label) {
  const dir = resolve(characterDir);
  const path = join(dir, "project.json");
  if (!existsSync(path)) {
    fail(`${label}: no project.json in ${dir} — exports are made from a character that sprite-project.mjs has registered`);
  }
  let doc;
  try {
    doc = JSON.parse(readFileSync(path, "utf-8"));
  } catch (error) {
    fail(`${label}: ${path} is not valid JSON (${error.message})`);
  }
  if (!doc || !doc.sprite || !Array.isArray(doc.sprite.motions)) {
    fail(`${label}: ${path} has no sprite sidecar — is ${dir} a sprite character?`);
  }
  const assets = new Map();
  for (const asset of Array.isArray(doc.assets) ? doc.assets : []) {
    if (asset && typeof asset.id === "string") assets.set(asset.id, asset);
  }
  return {
    dir,
    doc,
    assets,
    /** The content-set name — what the .riv and its asset id are named after. */
    id: basename(dir),
    name: String(doc.sprite.character?.name || basename(dir)),
  };
}

/** The file behind an asset id, or null when the project carries no such asset. */
function assetFile(character, assetId) {
  const uri = assetId ? character.assets.get(assetId)?.uri : null;
  return typeof uri === "string" && uri ? join(character.dir, uri) : null;
}

/**
 * The motion's REGISTERED frames, checked against the directory they sit in.
 *
 * An export is provenance: `register-export` hangs it off these frame assets.
 * A frames directory a later run rewrote but nobody registered would export
 * pictures that project.json does not describe, so the two must agree — same
 * files, same order — or the export is refused with the command that fixes it.
 */
function registeredFrames(character, motion, label) {
  const ids = Array.isArray(motion.frames) ? motion.frames : [];
  if (!ids.length) fail(`${label}: motion '${motion.id}' has no registered frames`);
  const paths = ids.map((id) => {
    const path = assetFile(character, id);
    if (!path) fail(`${label}: motion '${motion.id}' names frame asset '${id}', which project.json does not carry — re-run register-run`);
    return resolve(path);
  });
  const dir = dirname(paths[0]);
  const onDisk = listFrames(dir);
  const same = onDisk.length === paths.length && onDisk.every((entry, i) => resolve(entry.path) === paths[i]);
  if (!same) {
    fail(`${label}: ${dir} holds ${onDisk.length} frames but project.json registers ${paths.length} for '${motion.id}' — register the run that wrote them (sprite-project.mjs register-run) before exporting`);
  }
  return { dir, paths, digits: basename(paths[0], ".png").length };
}

/**
 * A sprite motion's timing and pivot, off its atlas — the file a game engine
 * reads, and so the authority on fps, loop and where each frame is pinned.
 */
function readAtlasFacts(character, motion, frameCount, label) {
  const path = assetFile(character, motion.atlas);
  if (!path || !existsSync(path)) {
    fail(`${label}: motion '${motion.id}' has no atlas.json on disk — re-run its pipeline and register-run`);
  }
  let atlas;
  try {
    atlas = JSON.parse(readFileSync(path, "utf-8"));
  } catch (error) {
    fail(`${label}: ${path} is not valid JSON (${error.message})`);
  }
  const frames = atlas?.frames && typeof atlas.frames === "object" ? atlas.frames : {};
  const keys = Array.isArray(atlas?.animations?.[motion.id]) ? atlas.animations[motion.id] : Object.keys(frames);
  if (keys.length !== frameCount) {
    fail(`${label}: ${path} lists ${keys.length} frames but '${motion.id}' registers ${frameCount} — re-pack and register-run before exporting`);
  }
  const fps = Number(atlas?.meta?.fps);
  if (!(fps > 0)) fail(`${label}: ${path} has no usable meta.fps`);
  const finite = (v) => typeof v === "number" && Number.isFinite(v);
  const perFrame = keys.map((key) => {
    const frame = frames[key];
    if (!frame || !finite(frame.pivot?.x) || !finite(frame.pivot?.y)) {
      fail(`${label}: ${path} has no pivot for frame '${key}'`);
    }
    return {
      pivot: { x: frame.pivot.x, y: frame.pivot.y },
      duration: finite(frame.duration) && frame.duration > 0 ? frame.duration : Math.round(1000 / fps),
    };
  });
  const point = atlas?.meta?.anchorPoint;
  return {
    fps,
    loop: atlas?.meta?.loop === true,
    perFrame,
    anchorPoint: point && finite(point.x) && finite(point.y) ? { x: point.x, y: point.y } : null,
  };
}

/**
 * Where a motion already ships in `format`, or null when it does not.
 *
 * The Export tab lists these as ready and `export` never makes them again:
 * two files for one deliverable is two things to keep in step. The answer is
 * the registered file, so the refusal can say where it is.
 */
function shippedAs(character, motion, format) {
  const loop = motion.kind === "loop";
  const slot = (id, fallback) => {
    const path = assetFile(character, id);
    return path ? relative(character.dir, path).split("\\").join("/") : fallback;
  };
  if (format === "gif" && !loop && motion.gif) return slot(motion.gif, "preview.gif");
  if (format === "webp" && motion.webp) return slot(motion.webp, loop ? "loop.webp" : "preview.webp");
  if ((format === "sheet" || format === "atlas") && !loop && motion.sheet) {
    return `${slot(motion.sheet, "sheet.png")} + ${slot(motion.atlas, "atlas.json")}`;
  }
  if (loop && ["apng", "webm", "lottie"].includes(format) && motion.exports?.[format] === `${motion.id}-${format}`) {
    return slot(motion.exports[format], format === "lottie" ? "loop.json" : `loop.${format}`);
  }
  return null;
}

/** Why a format is not offered for a motion at all, or null when it is. */
function notOffered(motion, format) {
  if (motion.kind === "transition") {
    if (format === "gif") {
      return "a transition is not exported as GIF: GIF has 1-bit alpha, and a transition is cut from a matted clip — use APNG, WebM or MOV";
    }
    if (format === "sheet" || format === "atlas") {
      return "a transition has no sprite sheet or atlas — its frames are a sequence (export --format png-seq)";
    }
    return null;
  }
  if (motion.kind !== "loop") return null;
  if (format === "gif") {
    return "a loop is not exported as GIF: GIF has 1-bit alpha and a loop has hundreds of frames — use its WebP or APNG";
  }
  if (format === "sheet" || format === "atlas") {
    return "a loop has no sprite sheet or atlas — its frames are a sequence (export --format png-seq)";
  }
  return null;
}

/** ffprobe's reading of an encoded video: the independent check on the file. */
function probeEncoded(path) {
  const r = spawnSync("ffprobe", [
    "-v", "error", "-count_frames", "-select_streams", "v:0",
    "-show_entries", "stream=codec_name,pix_fmt,width,height,nb_read_frames:stream_tags=alpha_mode:format=duration",
    "-of", "json", path,
  ], { encoding: "utf-8" });
  if (r.error || r.status !== 0) return null;
  try {
    const doc = JSON.parse(r.stdout);
    const stream = doc.streams?.[0] ?? {};
    return {
      codec: stream.codec_name ?? null,
      pixFmt: stream.pix_fmt ?? null,
      width: Number(stream.width),
      height: Number(stream.height),
      frames: Number(stream.nb_read_frames),
      alphaMode: stream.tags?.alpha_mode ?? null,
      duration: Number(doc.format?.duration),
    };
  } catch {
    return null;
  }
}

/** Scale every frame by an integer, nearest-neighbour, into `work`. Pixel art
 *  and hard alpha edges survive a nearest scale; they do not survive bilinear. */
function stageScaledFrames(frames, scale, work) {
  const pattern = `%0${frames.digits}d.png`;
  ffmpeg([
    "-start_number", "0", "-i", join(frames.dir, pattern), "-frames:v", String(frames.paths.length),
    "-vf", `scale=iw*${scale}:ih*${scale}:flags=neighbor`, "-pix_fmt", "rgba",
    "-start_number", "0", "--", join(work, pattern),
  ], "export scale");
  return { dir: work, paths: frames.paths.map((path) => join(work, basename(path))), digits: frames.digits };
}

/**
 * `export <motionDir> --format …`: one finished motion, one file.
 *
 * Frames come from project.json (the registered sequence), timing from the
 * atlas for a sprite motion and from the motion itself for a loop. Every
 * refusal happens before anything is written; the file is encoded to a
 * scratch path, checked with ffprobe where it is a video, and only then
 * renamed into `exports/`.
 */
function stepExport(motionDir, options) {
  const label = "export";
  const dir = resolve(motionDir);
  const motionId = basename(dir);
  const character = readCharacterProject(dirname(dirname(dir)), label);
  const motion = character.doc.sprite.motions.find((m) => m && m.id === motionId);
  if (!motion) {
    const known = character.doc.sprite.motions.map((m) => m?.id).filter(Boolean).join(", ") || "none";
    fail(`${label}: no motion '${motionId}' in ${character.dir}/project.json (known: ${known})`);
  }

  const { format } = options;
  const already = shippedAs(character, motion, format);
  if (already) {
    fail(`${label}: '${motion.id}' already ships as ${format}: ${already} — nothing to export; hand over that file`);
  }
  const refused = notOffered(motion, format);
  if (refused) fail(`${label}: ${refused}`);
  if (!EXPORT_FORMATS.includes(format)) {
    fail(`${label}: --format expected one of ${EXPORT_FORMATS.join(", ")}, got '${format}'`);
  }
  if (motion.status !== "ready") {
    fail(`${label}: motion '${motion.id}' is not ready (status: ${motion.status ?? "none"}) — only a finished motion can be exported`);
  }

  // A loop and a transition are cut from clips: their frames play at the
  // motion's own rate, with no atlas. A transition plays once.
  const motionKind = motion.kind === "loop" || motion.kind === "transition" ? motion.kind : "sprite";
  const frames = registeredFrames(character, motion, label);
  const count = frames.paths.length;
  const facts = motionKind !== "sprite"
    ? {
      fps: Number(motion.fps) > 0 ? Number(motion.fps) : fail(`${label}: ${motionKind} '${motion.id}' has no usable fps`),
      loop: motionKind === "loop" && motion.loop !== false,
      perFrame: null,
      anchorPoint: null,
    }
    : readAtlasFacts(character, motion, count, label);
  const { fps } = facts;
  const video = VIDEO_EXPORTS.has(format);
  const warnings = [];
  const notes = [];

  // What the flags mean for THIS format. A flag that does nothing here is
  // said out loud rather than silently dropped: the caller asked for it.
  let repeat = null;
  let repeatDefaulted = false;
  if (video) {
    if (options.repeat !== null) repeat = options.repeat;
    else {
      repeatDefaulted = true;
      repeat = facts.loop ? Math.max(1, Math.ceil(EXPORT_MIN_SECONDS / (count / fps) - 1e-9)) : 1;
    }
  } else if (options.repeat !== null) {
    warnings.push(`--repeat ${options.repeat} ignored: ${format} plays the frames once and loops by its own flag — only mp4, mov and webm repeat`);
  }
  let background = null;
  if (format === "mp4") {
    background = options.bg ?? DEFAULT_EXPORT_BG;
    notes.push(`MP4 has no alpha: the frames are flattened onto ${background}`);
  } else if (options.bg !== null) {
    warnings.push(`--bg ${options.bg} ignored: ${format} keeps its transparency, so there is nothing to flatten onto a colour — only mp4 takes a background`);
  }
  const encoder = { mp4: "libx264", mov: "prores_ks", webm: "libvpx-vp9", apng: "apng" }[format];
  if (encoder && !hasEncoder(encoder)) {
    fail(`${label}: this ffmpeg build has no ${encoder} encoder, which ${format} needs`);
  }

  const first = probeSize(frames.paths[0], label);
  const scale = options.scale;
  const width = first.width * scale;
  const height = first.height * scale;
  const out = join(dir, EXPORTS_DIRNAME, exportFileName(motion.id, format));
  const work = scale !== 1 ? mkdtempSync(join(tmpdir(), "sprite-export-")) : null;
  const report = {
    kind: "export",
    character: character.dir,
    motion: motion.id,
    motionKind,
    format,
    out,
    frames: frames.paths,
    frameCount: count,
    fps,
    loop: facts.loop,
    scale,
    width,
    height,
    repeat,
    ...(video ? { repeatDefaulted } : {}),
    background,
  };

  try {
    const source = work ? stageScaledFrames(frames, scale, work) : frames;
    const input = ["-framerate", String(fps), "-start_number", "0", "-i", join(source.dir, `%0${source.digits}d.png`)];

    if (video) {
      // H.264 4:2:0 needs even sides (and VP9's 4:2:0 alpha does too); one
      // transparent column / row on the right / bottom moves no pivot.
      const padded = { width: width % 2, height: height % 2 };
      const W = width + padded.width;
      const H = height + padded.height;
      const chain = [];
      if (repeat > 1) chain.push(`loop=loop=${repeat - 1}:size=${count}:start=0`);
      if (padded.width || padded.height) chain.push(`pad=${W}:${H}:0:0:color=black@0`);
      let args;
      if (format === "mp4") {
        const graph = [
          `[0:v]${[...chain, "format=rgba"].join(",")}[fg]`,
          `color=c=0x${background.slice(1)}:s=${W}x${H}:r=${fps},format=rgba[bg]`,
          "[bg][fg]overlay=shortest=1:format=auto,format=yuv420p[v]",
        ].join(";");
        args = [...input, "-filter_complex", graph, "-map", "[v]",
          "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart"];
      } else if (format === "mov") {
        args = [...input, ...(chain.length ? ["-vf", chain.join(",")] : []),
          "-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", "-vendor", "apl0"];
      } else {
        // `-auto-alt-ref 0` is required: libvpx-vp9 will not carry an alpha
        // plane with alt-ref frames on (the same flags `loop.webm` uses).
        args = [...input, ...(chain.length ? ["-vf", chain.join(",")] : []),
          "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-auto-alt-ref", "0", "-b:v", "0", "-crf", "30", "-row-mt", "1"];
      }
      const expectedFrames = count * repeat;
      const expectedDuration = expectedFrames / fps;
      const probe = renderVerified(out, (scratch) => {
        ffmpeg([...args, "--", scratch], `export ${format}`);
        const probe = probeEncoded(scratch);
        const problems = [];
        if (!probe) problems.push("ffprobe cannot read it");
        else {
          if (probe.codec !== EXPORT_CODECS[format]) problems.push(`codec ${probe.codec}, expected ${EXPORT_CODECS[format]}`);
          if (format === "mp4" && probe.pixFmt !== "yuv420p") problems.push(`pixel format ${probe.pixFmt}, expected yuv420p`);
          if (format === "mov" && !/^yuva/.test(String(probe.pixFmt))) problems.push(`pixel format ${probe.pixFmt} has no alpha`);
          if (format === "webm" && probe.alphaMode !== "1") problems.push("no alpha_mode=1 — the alpha plane was dropped");
          if (probe.frames !== expectedFrames) problems.push(`${probe.frames} frames, expected ${expectedFrames} (${count} × ${repeat})`);
          if (!(Math.abs(probe.duration - expectedDuration) <= 1.5 / fps + 0.05)) {
            problems.push(`duration ${probe.duration}s, expected ${round(expectedDuration, 3)}s`);
          }
        }
        if (problems.length) fail(`${label}: the ${format} did not come out as encoded — ${problems.join("; ")}`);
        return probe;
      });
      Object.assign(report, {
        width: W,
        height: H,
        padded,
        duration: round(probe.duration, 3),
        probe: {
          codec: probe.codec,
          pixFmt: probe.pixFmt,
          alpha: format === "mov" ? true : format === "webm",
          frames: probe.frames,
          duration: round(probe.duration, 3),
        },
      });
      if (repeat > 1) notes.push(`${count} frames played ${repeat} times: ${round(expectedDuration, 2)} s`);
    } else if (format === "apng") {
      const encoded = renderVerified(out, (scratch) => {
        ffmpeg([...input, "-f", "apng", "-plays", facts.loop ? "0" : "1", "-pred", "mixed", "-pix_fmt", "rgba",
          "--", scratch], "export apng");
        const found = countEncodedFrames(scratch);
        if (found !== count) fail(`${label}: the APNG holds ${found ?? "no"} frames, expected ${count} — a frame did not encode`);
        return found;
      });
      Object.assign(report, { duration: round(count / fps, 3), probe: { codec: "apng", frames: encoded, alpha: true } });
    } else if (format === "lottie") {
      writeJsonFile(out, lottieSequence(source.paths, { fps, name: motion.id, cell: { width, height } }));
      Object.assign(report, { duration: round(count / fps, 3) });
    } else {
      const animation = {
        app: "pneuma-sprite",
        version: 1,
        name: motion.id,
        kind: motionKind,
        fps,
        loop: facts.loop,
        size: { w: width, h: height },
        scale,
        // A loop is not stood on a floor — it has no pivot, and null says so
        // rather than inventing the cell centre.
        pivot: facts.perFrame ? facts.perFrame[0].pivot : null,
        anchorPoint: facts.anchorPoint
          ? { x: round(facts.anchorPoint.x * scale, 4), y: round(facts.anchorPoint.y * scale, 4) }
          : null,
        frames: source.paths.map((path, i) => ({
          file: basename(path),
          duration: facts.perFrame ? facts.perFrame[i].duration : Math.round(1000 / fps),
        })),
      };
      const entries = [
        { name: `${motion.id}/animation.json`, data: Buffer.from(`${JSON.stringify(animation, null, 2)}\n`) },
        ...source.paths.map((path) => ({ name: `${motion.id}/${basename(path)}`, data: readFileSync(path) })),
      ];
      writeBytesAtomic(out, zipStore(entries));
      Object.assign(report, { duration: round(count / fps, 3), entries: entries.length });
    }
  } finally {
    if (work) rmSync(work, { recursive: true, force: true });
  }

  report.size = statSync(out).size;
  report.notes = notes;
  report.warnings = warnings;
  return report;
}

/** Encode one frame as a still WebP for `rive --images webp|webp-lossless`.
 *  `libwebp` (the still encoder) is right here: this is one picture, not an
 *  animation. Lossless has to be `bgra`: with `-lossless 1` on `yuva420p`
 *  ffmpeg still subsamples the colour first, and the pixels are not exact. */
function stillWebp(path, work, index, lossless) {
  const out = join(work, `${String(index).padStart(4, "0")}.webp`);
  ffmpeg(["-i", path, "-frames:v", "1", "-c:v", "libwebp",
    ...(lossless ? ["-lossless", "1", "-pix_fmt", "bgra"] : ["-lossless", "0", "-q:v", "85", "-pix_fmt", "yuva420p"]),
    "--", out], "rive webp");
  return readFileSync(out);
}

/** The downscale for a character's style: pixel art (`RIVE_PIXEL_ART_STYLE`,
 *  read from `character.style`) keeps hard pixels only through
 *  nearest-neighbour; everything else — painted, plush, 3D — goes through the
 *  filter the loop pipeline measured for alpha edges. */
const RIVE_FILTERS = ["auto", "smooth", "nearest"];

/**
 * premultiply → area → unpremultiply, the chain `loop` scales with, and for
 * the reason measured there: scaling straight alpha drags whatever RGB sits
 * under a transparent pixel into the silhouette's edge (a dark fringe), and a
 * kernel with negative lobes rings a premultiplied matte into black. `area`
 * has none; going down it is a box filter, the average a painted edge wants.
 */
function riveScaleChain(width, height, filter) {
  return filter === "nearest"
    ? [`scale=${width}:${height}:flags=neighbor`]
    : ["premultiply=inplace=1", `scale=${width}:${height}:flags=area`, "unpremultiply=inplace=1"];
}

/**
 * Where a loop stands. A loop has no atlas pivot — its frames are the clip's,
 * unaligned, because the movement is the content — so it is pinned where its
 * FIRST frame stands: the mean x of the feet (the same `feetCenterX` that
 * `align` and `inspect` use) and the bottom of the figure. Frame 0 is the pose
 * the loop starts and ends on, so every loop of a character switches in from
 * the same footing. The frame's bottom-centre would move a body that is not
 * centred in its crop: tanka's wave stands 36 px left of its frame centre.
 */
function loopAnchor(path) {
  const image = readRgba(path);
  const { bbox, feetX } = measureFrame(image, DEFAULT_THRESHOLD);
  return bbox
    ? { x: feetX, y: bbox.y + bbox.h, from: "feet" }
    : { x: image.width / 2, y: image.height, from: "frame" };
}

/**
 * How a loop's frames sit in the clip they were cut from: frame px =
 * (clip px − origin) × scale.
 *
 * `loop` cuts every clip to its OWN union box and scales that box to one
 * width, so one character comes out at a different scale in each loop —
 * tanka's ten at 1.03-1.42× their clips, a 38% spread — and at a different
 * offset. The clips agree with each other (same camera, same figure), so
 * dividing each loop back to its clip's scale is what keeps the character
 * one size across loops, and the origin is what puts each where it stood.
 *
 * Recorded by `loop` since it learned to (`inspect.crop` / `inspect.scale`,
 * copied into the sidecar by `register-run`). For a loop cut before that,
 * `measureLoopClip` recovers both off the clip. Null when neither is known.
 */
function recordedLoopClip(motion) {
  const inspect = motion.inspect && typeof motion.inspect === "object" ? motion.inspect : {};
  const scale = Number(inspect.scale);
  if (!(Number.isFinite(scale) && scale > 0)) return null;
  const crop = inspect.crop && typeof inspect.crop === "object" ? inspect.crop : null;
  const origin = crop && Number.isFinite(crop.x) && Number.isFinite(crop.y) ? { x: crop.x, y: crop.y } : null;
  return { scale, origin, from: "recorded" };
}

/** What an earlier export MEASURED for a loop cut before `loop` recorded its
 *  crop — `motion.clip`, written by `register-export` — or null. Reused
 *  rather than measured again, so the file and the Export tab's quote come
 *  from the same numbers. */
function storedLoopClip(motion) {
  const clip = motion.clip && typeof motion.clip === "object" ? motion.clip : null;
  const scale = Number(clip?.scale);
  if (!clip || clip.from !== "measured" || !(Number.isFinite(scale) && scale > 0)) return null;
  const origin = clip.origin && Number.isFinite(clip.origin.x) && Number.isFinite(clip.origin.y)
    ? { x: clip.origin.x, y: clip.origin.y }
    : null;
  return { scale, origin, from: "measured" };
}

/** Frames of the loop compared against the clip — about five, spread across it. */
const CLIP_SAMPLES = 5;
/** Per-frame scales farther apart than this, as a share of their median, are
 *  not one crop-and-scale of that clip. tanka's ten loops: 0.11-0.64%. */
const CLIP_SCALE_SPREAD = 0.03;
/** The same for the origin, in clip px: 3 px, or 1% of the clip's long edge.
 *  tanka's ten: 0.5-1.3 px on 640 px clips. */
const clipOriginSpread = (image) => Math.max(3, 0.01 * Math.max(image.width, image.height));
/** Half coverage: where an edge stays when it is resampled. A low threshold
 *  counts the blur the loop's own scaling added — measured on a 1.85×
 *  upscale, 16 read the body 0.4% taller than it was cut, and on tanka's
 *  wave a stray speck moved one frame's box by 4 px. */
const CLIP_MEASURE_THRESHOLD = 128;
/** Seeks land this far before a frame's timestamp, so a time rounded to the
 *  millisecond still decodes that frame and not the one after it. */
const CLIP_SEEK_LEAD = 0.004;

/**
 * A loop's scale and origin against its clip, measured: for about five of its
 * frames, the same moment of the clip is decoded and the two alpha boxes
 * compared — heights for the scale (frame h / clip h), then the box corner
 * for the origin (clip xy − frame xy / scale). Medians, so one frame whose
 * box a stray speck moved does not decide it.
 *
 * Everything comes from project.json: each registered frame's `derive` edge
 * names the clip asset (a path inside the character) and the second it was
 * sampled at. `run.json` is not read — its paths are absolute and can point
 * at the project the character was copied from.
 *
 * Nothing is guessed: `{ reason }` when the scale cannot be had, and the
 * origin comes back null with `originReason` when only it disagrees.
 */
function measureLoopClip(character, motion, paths, work) {
  const edges = new Map();
  for (const edge of Array.isArray(character.doc.provenance) ? character.doc.provenance : []) {
    if (edge && typeof edge.toAssetId === "string") edges.set(edge.toAssetId, edge);
  }
  const timed = [];
  (Array.isArray(motion.frames) ? motion.frames : []).forEach((id, index) => {
    const edge = edges.get(id);
    const params = edge?.operation?.params;
    if (params?.step === "from-video" && Number.isFinite(params.t) && typeof edge.fromAssetId === "string") {
      timed.push({ index, t: params.t, clipId: edge.fromAssetId });
    }
  });
  if (!timed.length) return { reason: "its frames carry no clip timestamps to measure against" };
  const clipId = timed[0].clipId;
  const uri = character.assets.get(clipId)?.uri;
  if (typeof uri !== "string" || !uri) return { reason: `its clip ${clipId} is not in project.json` };
  const clipPath = resolve(character.dir, uri);
  const inside = relative(character.dir, clipPath);
  if (!inside || inside.startsWith("..") || isAbsolute(inside)) return { reason: `its clip ${uri} is outside the character folder` };
  if (!existsSync(clipPath)) return { reason: `${uri} is not on disk` };

  const decodeArgs = alphaDecodeArgs(clipPath);
  const count = Math.min(CLIP_SAMPLES, timed.length);
  const picks = Array.from({ length: count }, (_, n) => timed[Math.floor(((n + 0.5) * timed.length) / count)]);
  const samples = [];
  let clipImage = null;
  for (const [n, pick] of picks.entries()) {
    const out = join(work, `clip-${motion.id}-${n}.png`);
    const r = spawnSync("ffmpeg", [
      "-v", "error", "-y", "-ss", String(Math.max(0, pick.t - CLIP_SEEK_LEAD)), ...decodeArgs, "-i", clipPath,
      "-frames:v", "1", "-pix_fmt", "rgba", "--", out,
    ]);
    if (r.error || r.status !== 0 || !existsSync(out)) return { reason: `${uri} could not be decoded at ${pick.t}s` };
    clipImage = readRgba(out);
    if (!hasAlpha(clipImage)) return { reason: `${uri} is opaque, so there is no figure to measure the frames against` };
    const clipBox = computeBbox(clipImage, CLIP_MEASURE_THRESHOLD).bbox;
    const frameBox = computeBbox(readRgba(paths[pick.index]), CLIP_MEASURE_THRESHOLD).bbox;
    if (!clipBox || !frameBox) return { reason: `frame ${pick.index} or ${uri} at ${pick.t}s is empty` };
    samples.push({ clipBox, frameBox });
  }

  const scales = samples.map((s) => s.frameBox.h / s.clipBox.h);
  const scale = median(scales);
  const low = Math.min(...scales);
  const high = Math.max(...scales);
  if (high - low > CLIP_SCALE_SPREAD * scale) {
    return { reason: `its frames are ${round(low, 3)}-${round(high, 3)}× ${uri} from frame to frame, not one crop and scale of it` };
  }
  const xs = samples.map((s) => s.clipBox.x - s.frameBox.x / scale);
  const ys = samples.map((s) => s.clipBox.y - s.frameBox.y / scale);
  const tolerance = clipOriginSpread(clipImage);
  const spread = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const clip = { scale: round(scale, 4), origin: null, from: "measured" };
  if (spread > tolerance) {
    return { clip, originReason: `where its frames sit in ${uri} varies by ${round(spread, 1)} px from frame to frame` };
  }
  clip.origin = { x: round(median(xs), 2), y: round(median(ys), 2) };
  return { clip };
}

// ---------------------------------------------------------------------------
// Poses in clip coordinates
// ---------------------------------------------------------------------------

/**
 * Every clip of one character agrees with the others — same camera, same
 * figure — so a pose from any of them can be compared with a pose from any
 * other once each frame is put back where its clip had it: clip px = origin +
 * frame px / scale (`loop` and `transition` record both; see
 * `recordedLoopClip`). A comparison is drawn on a small canvas over the clip
 * rect the two frames cover, at one analysis scale, premultiplied RGBA.
 */

/** The longest edge, in px, a pose comparison is drawn at. */
const POSE_CANVAS = 192;

/** The clip rect a frame of `size` covers when placed by `placement`. */
function clipExtent(size, placement) {
  return {
    x0: placement.origin.x,
    y0: placement.origin.y,
    x1: placement.origin.x + size.width / placement.scale,
    y1: placement.origin.y + size.height / placement.scale,
  };
}

function unionExtent(extents) {
  return {
    x0: Math.min(...extents.map((e) => e.x0)),
    y0: Math.min(...extents.map((e) => e.y0)),
    x1: Math.max(...extents.map((e) => e.x1)),
    y1: Math.max(...extents.map((e) => e.y1)),
  };
}

/** The analysis scale (canvas px per clip px) that draws `extent` at POSE_CANVAS. */
function poseScale(extent) {
  return POSE_CANVAS / Math.max(1, extent.x1 - extent.x0, extent.y1 - extent.y0);
}

/** The size a frame of `size` is decoded at on a canvas of scale `s`. */
function poseSize(size, placement, s) {
  return {
    width: Math.max(1, Math.round((size.width * s) / placement.scale)),
    height: Math.max(1, Math.round((size.height * s) / placement.scale)),
  };
}

/** premultiply → area → raw RGBA: colour weighted by coverage, so an edge
 *  pixel counts as much as it covers. */
const POSE_CHAIN = (size) => `format=rgba,premultiply=inplace=1,scale=${size.width}:${size.height}:flags=area,format=rgba`;

/** One image, decoded at `size`. */
function poseImage(path, size, label) {
  const r = spawnSync("ffmpeg", [
    "-v", "error", "-i", path, "-frames:v", "1", "-vf", POSE_CHAIN(size), "-f", "rawvideo", "-pix_fmt", "rgba", "-",
  ], { maxBuffer: MAX_RAW_BYTES });
  const bytes = size.width * size.height * 4;
  if (r.error || r.status !== 0 || !r.stdout || r.stdout.length < bytes) {
    fail(`${label}: could not decode ${path} for a pose comparison${r.stderr ? `\n${String(r.stderr).trim()}` : ""}`);
  }
  return r.stdout.subarray(0, bytes);
}

/** `count` numbered frames (`%0<digits>d.png` from 0) of a folder, decoded at `size` in one pass. */
function poseSequence(dir, digits, count, size, label) {
  const r = spawnSync("ffmpeg", [
    "-v", "error", "-start_number", "0", "-i", join(dir, `%0${digits}d.png`), "-frames:v", String(count),
    "-vf", POSE_CHAIN(size), "-f", "rawvideo", "-pix_fmt", "rgba", "-",
  ], { maxBuffer: MAX_RAW_BYTES });
  const bytes = size.width * size.height * 4;
  const got = r.stdout ? Math.floor(r.stdout.length / bytes) : 0;
  if (r.error || r.status !== 0 || got !== count) {
    fail(`${label}: could not decode ${count} frames of ${dir} for a pose comparison (got ${got})`);
  }
  return Array.from({ length: count }, (_, i) => r.stdout.subarray(i * bytes, (i + 1) * bytes));
}

/**
 * A decoded frame put onto a canvas over `extent` at scale `s`, where its
 * clip placement puts it — bilinear, so a placement between canvas pixels
 * lands between them instead of snapping.
 */
function poseCanvas(extent, s, pixels, size, decoded, placement) {
  const width = Math.max(1, Math.ceil((extent.x1 - extent.x0) * s));
  const height = Math.max(1, Math.ceil((extent.y1 - extent.y0) * s));
  const data = new Float32Array(width * height * 4);
  const originX = (placement.origin.x - extent.x0) * s;
  const originY = (placement.origin.y - extent.y0) * s;
  const stepX = (size.width / placement.scale) * s / decoded.width;
  const stepY = (size.height / placement.scale) * s / decoded.height;
  for (let j = 0; j < decoded.height; j++) {
    const ty = originY + j * stepY;
    const y0 = Math.floor(ty);
    const fy = ty - y0;
    for (let i = 0; i < decoded.width; i++) {
      const src = (j * decoded.width + i) * 4;
      const alpha = pixels[src + 3];
      if (alpha === 0) continue;
      const tx = originX + i * stepX;
      const x0 = Math.floor(tx);
      const fx = tx - x0;
      for (const [dx, dy, weight] of [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]]) {
        const x = x0 + dx;
        const y = y0 + dy;
        if (weight === 0 || x < 0 || y < 0 || x >= width || y >= height) continue;
        const dst = (y * width + x) * 4;
        data[dst] += pixels[src] * weight;
        data[dst + 1] += pixels[src + 1] * weight;
        data[dst + 2] += pixels[src + 2] * weight;
        data[dst + 3] += alpha * weight;
      }
    }
  }
  return { width, height, data };
}

/**
 * How far apart two poses on one canvas are.
 *
 * `iou` is the soft alpha overlap (Σ min / Σ max) and `gap` = 1 − iou, the
 * silhouette distance `loop` measures its `step` and `seam` in. `rgb` is the
 * mean |Δ| of the premultiplied colour inside the union, 0..1. `chroma` is
 * the mean |Δ| of chromaticity (each channel over their sum, 0..2) where BOTH
 * are opaque: it ignores shading and fur texture, which differ between any
 * two independently generated keyframes, and keeps where the cream arms lie
 * across the purple body and whether a mug is in hand — the pose inside the
 * silhouette. Measured on tanka: `rgb` put coffee (mug in hand, 0.139) nearer
 * idle than walk (0.146); `chroma` puts it at 0.098 against walk's 0.070.
 */
function poseDiff(a, b) {
  let low = 0;
  let high = 0;
  let colour = 0;
  let inside = 0;
  let chroma = 0;
  let both = 0;
  for (let p = 0; p < a.data.length; p += 4) {
    const alphaA = a.data[p + 3];
    const alphaB = b.data[p + 3];
    low += Math.min(alphaA, alphaB);
    high += Math.max(alphaA, alphaB);
    if (alphaA >= 128 || alphaB >= 128) {
      colour += (Math.abs(a.data[p] - b.data[p]) + Math.abs(a.data[p + 1] - b.data[p + 1]) + Math.abs(a.data[p + 2] - b.data[p + 2])) / 3;
      inside++;
    }
    if (alphaA >= 200 && alphaB >= 200) {
      const sumA = Math.max(1, a.data[p] + a.data[p + 1] + a.data[p + 2]);
      const sumB = Math.max(1, b.data[p] + b.data[p + 1] + b.data[p + 2]);
      for (let c = 0; c < 3; c++) chroma += Math.abs(a.data[p + c] / sumA - b.data[p + c] / sumB);
      both++;
    }
  }
  const iou = high > 0 ? low / high : 1;
  return {
    iou: round(iou, 4),
    gap: round(1 - iou, 4),
    rgb: inside ? round(colour / inside / 255, 4) : 0,
    chroma: both ? round(chroma / both, 4) : null,
  };
}

/**
 * A motion's frames placed in clip coordinates: a loop's recorded, stored or
 * measured scale and origin (`recordedLoopClip` → `storedLoopClip` →
 * `measureLoopClip`), a transition's recorded crop. `placement` is null, with
 * the reason, when the motion cannot be placed.
 */
function motionPlacement(character, motion, frames, work) {
  let clip = recordedLoopClip(motion) ?? (motion.kind === "loop" ? storedLoopClip(motion) : null);
  let reason = null;
  if (!clip && motion.kind === "loop") {
    const measured = measureLoopClip(character, motion, frames.paths, work);
    if (measured.reason) reason = measured.reason;
    else {
      clip = measured.clip;
      if (!clip.origin) reason = measured.originReason;
    }
  } else if (!clip) {
    reason = "it has no recorded crop and scale";
  } else if (!clip.origin) {
    reason = "where it stood in its clip was not recorded";
  }
  return {
    clip,
    placement: clip?.origin ? { origin: clip.origin, scale: clip.scale } : null,
    reason,
  };
}

/** One frame as a pose over `extent`. */
function framePose(path, placement, extent, s, label) {
  const size = probeSize(path, label);
  const decoded = poseSize(size, placement, s);
  return poseCanvas(extent, s, poseImage(path, decoded, label), size, decoded, placement);
}

/**
 * A transition's joins, measured: its median `step`, and how far its first
 * frame is from `from`'s frame 0 (`startGap`) and its last from `to`'s
 * (`endGap`), in clip coordinates at one analysis scale. A gap of at most
 * JOIN_STEPS steps joins; a larger one is a warning naming the end.
 */
function transitionJoins(character, ends, framesDir, count, cell, placement, work, label) {
  const own = clipExtent(cell, placement);
  const s = poseScale(own);
  const decoded = poseSize(cell, placement, s);
  const poses = poseSequence(framesDir, 3, count, decoded, label)
    .map((pixels) => poseCanvas(own, s, pixels, cell, decoded, placement));
  const steps = [];
  for (let i = 0; i + 1 < poses.length; i++) steps.push(poseDiff(poses[i], poses[i + 1]).gap);
  const step = round(median(steps), 4);
  const warnings = [];
  const gaps = {};
  for (const [end, loop, index] of [["start", ends.from, 0], ["end", ends.to, count - 1]]) {
    const frames = registeredFrames(character, loop, label);
    const where = motionPlacement(character, loop, frames, work);
    const key = `${end}Gap`;
    if (!where.placement) {
      gaps[key] = null;
      warnings.push(`${key} not measured: ${loop.id}'s place in its clip is unknown — ${where.reason}`);
      continue;
    }
    const loopSize = probeSize(frames.paths[0], label);
    const extent = unionExtent([own, clipExtent(loopSize, where.placement)]);
    const mine = framePose(join(framesDir, loopFrameName(index)), placement, extent, s, label);
    const theirs = framePose(frames.paths[0], where.placement, extent, s, label);
    const gap = poseDiff(mine, theirs).gap;
    gaps[key] = gap;
    if (gap > JOIN_STEPS * step) {
      warnings.push(end === "start"
        ? `the start does not join ${loop.id}'s frame 0: startGap ${gap} against a step of ${step} (at most ${round(JOIN_STEPS * step, 4)} joins) — the take did not begin on ${loop.id}'s keyframe; shoot it again from that image, or cut later with --trim-start`
        : `the end does not land on ${loop.id}'s frame 0: endGap ${gap} against a step of ${step} (at most ${round(JOIN_STEPS * step, 4)} joins) — the take did not finish on ${loop.id}'s keyframe; shoot it again with that image as the end frame, or cut earlier with --trim-end`);
    }
  }
  return { step, startGap: gaps.startGap, endGap: gaps.endGap, warnings };
}

/** The two loops a transition joins, checked: both ready loops of this
 *  character, and not the same one. */
function transitionEnds(character, from, to, label) {
  const find = (id, flag) => {
    const motion = character.doc.sprite.motions.find((m) => m && m.id === id);
    if (!motion) fail(`${label}: ${flag}: no motion '${id}' in ${character.dir}/project.json (known: ${character.doc.sprite.motions.map((m) => m.id).join(", ") || "none"})`);
    if (motion.kind !== "loop") fail(`${label}: ${flag}: '${id}' is not a loop — a transition joins two loops' frame 0s`);
    if (motion.status !== "ready") fail(`${label}: ${flag}: '${id}' is not ready — a transition lands on a loop's registered frame 0`);
    return motion;
  };
  if (from === to) fail(`${label}: --to: a transition from '${from}' to itself joins nothing`);
  return { from: find(from, "--from"), to: find(to, "--to") };
}

/** A transition's holds: leading frames that are the first pose and trailing
 *  frames that are the last, collapsed to one of each. Measured against the
 *  upper quartile of the steps, because a first-last take can spend half its
 *  length holding and the median step is then a hold. */
function transitionHolds(steps) {
  const sorted = [...steps].sort((a, b) => a - b);
  const moving = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.75))] ?? 0;
  const hold = HOLD_STEP_FRACTION * moving;
  let first = 0;
  let last = steps.length;
  while (first < last && steps[first] < hold) first++;
  while (last > first && steps[last - 1] < hold) last--;
  return { first, last };
}

/**
 * When a loop's frame 0 is close enough to the hub's to cut between them,
 * measured on poses in clip coordinates: the silhouettes overlap by at least
 * LINEUP_DIRECT_IOU and the pose inside them differs by at most
 * LINEUP_DIRECT_CHROMA (see `poseDiff`). Calibrated on tanka (2026-09-24),
 * where walk is the only standing pose near idle: walk iou 0.876 / chroma
 * 0.070; the nearest refused are thinking (iou 0.857, a hand at the chin) and
 * coffee (chroma 0.098, a mug in hand) — `pipeline.md`, "lineup".
 */
const LINEUP_DIRECT_IOU = 0.87;
const LINEUP_DIRECT_CHROMA = 0.085;
/** How tall a panel of lineup.png is drawn, in px. */
const LINEUP_PANEL_HEIGHT = 360;
const LINEUP_BACKGROUND = [39, 39, 42];
const LINEUP_BASELINE = [249, 115, 22];

/**
 * `lineup <characterDir> [--hub id]`: look before spending on transitions.
 * Every ready loop's frame 0 beside the hub's, each where its clip put it,
 * as numbers (the pose gap to the hub, and the frame of the loop that comes
 * closest to it) and as `lineup.png`. Writes nothing to project.json.
 */
function stepLineup(characterDir, { hub: hubId, out }) {
  const label = "lineup";
  const character = readCharacterProject(characterDir, label);
  const loops = character.doc.sprite.motions.filter((m) => m && m.kind === "loop" && m.status === "ready" && m.loop !== false);
  if (!loops.length) fail(`${label}: ${character.name} has no ready loop to line up`);
  let hub;
  if (hubId !== null) {
    hub = loops.find((m) => m.id === hubId);
    if (!hub) fail(`${label}: --hub: '${hubId}' is not a ready loop (ready loops: ${loops.map((m) => m.id).join(", ")})`);
  } else {
    // The hub a .riv of these loops would route through (`riveHub`).
    hub = loops[riveHub(loops.map((m) => ({ id: m.id, loop: true, kind: "loop" })))];
  }
  const ordered = [hub, ...loops.filter((m) => m !== hub)];
  const warnings = [];
  const work = mkdtempSync(join(tmpdir(), "sprite-lineup-"));
  try {
    const entries = ordered.map((motion) => {
      const frames = registeredFrames(character, motion, label);
      const where = motionPlacement(character, motion, frames, work);
      return { motion, frames, where, size: probeSize(frames.paths[0], label) };
    });
    const hubEntry = entries[0];
    if (!hubEntry.where.placement) {
      fail(`${label}: the hub '${hub.id}' cannot be placed in clip coordinates — ${hubEntry.where.reason}`);
    }
    const placed = entries.filter((entry) => entry.where.placement);
    for (const entry of entries) {
      if (!entry.where.placement) warnings.push(`${entry.motion.id}: not compared — ${entry.where.reason}`);
    }
    const extent = unionExtent(placed.map((entry) => clipExtent(entry.size, entry.where.placement)));
    const s = poseScale(extent);
    const hubPose = framePose(hubEntry.frames.paths[0], hubEntry.where.placement, extent, s, label);

    const motions = entries.map((entry) => {
      const { motion, where } = entry;
      const base = {
        id: motion.id,
        ...(entry === hubEntry ? { hub: true } : {}),
        scale: where.clip ? round(where.clip.scale, 4) : null,
        scaleFrom: where.clip?.from ?? null,
        origin: where.placement?.origin ?? null,
      };
      if (entry === hubEntry) return base;
      const transitions = character.doc.sprite.motions
        .filter((m) => m && m.kind === "transition" && m.status === "ready"
          && ((m.from === hub.id && m.to === motion.id) || (m.from === motion.id && m.to === hub.id)))
        .map((m) => m.id);
      if (!where.placement) return { ...base, poseGap: null, closestFrame: null, transitions, suggestion: null };
      const poseGap = poseDiff(framePose(entry.frames.paths[0], where.placement, extent, s, label), hubPose);
      // Every frame of the loop against the hub pose: the one a cut could
      // leave from with the smallest jump. Data only — `rive` leaves a loop
      // at its cycle end, which is frame 0.
      const decoded = poseSize(entry.size, where.placement, s);
      let closestFrame = null;
      poseSequence(entry.frames.dir, entry.frames.digits, entry.frames.paths.length, decoded, label).forEach((pixels, index) => {
        const diff = poseDiff(poseCanvas(extent, s, pixels, entry.size, decoded, where.placement), hubPose);
        if (!closestFrame || diff.gap < closestFrame.gap) closestFrame = { index, ...diff };
      });
      const suggestion = poseGap.iou >= LINEUP_DIRECT_IOU && poseGap.chroma !== null && poseGap.chroma <= LINEUP_DIRECT_CHROMA
        ? "direct"
        : "transition";
      return { ...base, poseGap, closestFrame, transitions, suggestion };
    });

    const outPath = resolve(out ?? join(character.dir, "lineup.png"));
    const drawn = drawLineup(entries, hubEntry, extent, outPath, label);
    if (!drawn.labelled) warnings.push("ffmpeg's drawtext filter could not run here (missing, or no font to draw with) — lineup.png carries no labels; its panels are in the order of `motions`");
    return {
      kind: "lineup",
      character: character.dir,
      out: outPath,
      hub: hub.id,
      threshold: {
        iou: LINEUP_DIRECT_IOU,
        chroma: LINEUP_DIRECT_CHROMA,
        rule: `direct when poseGap.iou ≥ ${LINEUP_DIRECT_IOU} and poseGap.chroma ≤ ${LINEUP_DIRECT_CHROMA}; otherwise transition`,
      },
      analysisScale: round(s, 4),
      motions,
      warnings,
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * lineup.png: one panel per loop over the same clip rect, each frame 0 where
 * its clip put it at one display scale, on a dark plate, with the hub's
 * floor drawn across every panel and the motion id under each.
 */
function drawLineup(entries, hubEntry, extent, outPath, label) {
  const d = LINEUP_PANEL_HEIGHT / Math.max(1, extent.y1 - extent.y0);
  const panelW = Math.max(1, Math.ceil((extent.x1 - extent.x0) * d));
  const panelH = Math.max(1, Math.ceil((extent.y1 - extent.y0) * d));
  const gutter = 16;
  const band = 28;
  const width = entries.length * panelW + (entries.length + 1) * gutter;
  const height = panelH + 2 * gutter + band;
  const data = Buffer.alloc(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    data[p * 4] = LINEUP_BACKGROUND[0] - 12;
    data[p * 4 + 1] = LINEUP_BACKGROUND[1] - 12;
    data[p * 4 + 2] = LINEUP_BACKGROUND[2] - 12;
    data[p * 4 + 3] = 255;
  }
  const hubFeet = loopAnchor(hubEntry.frames.paths[0]);
  const baseline = Math.round((hubEntry.where.placement.origin.y + hubFeet.y / hubEntry.where.placement.scale - extent.y0) * d);
  entries.forEach((entry, n) => {
    const left = gutter + n * (panelW + gutter);
    let pose = null;
    if (entry.where.placement) {
      const decoded = poseSize(entry.size, entry.where.placement, d);
      pose = poseCanvas(extent, d, poseImage(entry.frames.paths[0], decoded, label), entry.size, decoded, entry.where.placement);
    }
    for (let y = 0; y < panelH; y++) {
      for (let x = 0; x < panelW; x++) {
        const dst = ((gutter + y) * width + left + x) * 4;
        const src = pose && x < pose.width && y < pose.height ? (y * pose.width + x) * 4 : -1;
        const alpha = src >= 0 ? Math.min(255, pose.data[src + 3]) / 255 : 0;
        for (let c = 0; c < 3; c++) {
          const own = src >= 0 ? Math.min(255, pose.data[src + c]) : 0;
          data[dst + c] = Math.round(own + LINEUP_BACKGROUND[c] * (1 - alpha));
        }
        if (y === baseline) {
          for (let c = 0; c < 3; c++) data[dst + c] = Math.round(data[dst + c] * 0.4 + LINEUP_BASELINE[c] * 0.6);
        }
      }
    }
  });
  const plain = join(dirname(outPath), `.${basename(outPath, ".png")}.plain.png`);
  writeRgbaPng(plain, { width, height, data }, `${label} image`);
  const labels = entries.map((entry, n) => {
    const text = entry.motion.id.replace(/[^A-Za-z0-9_.-]/g, "_");
    return `drawtext=text='${text}':x=${gutter + n * (panelW + gutter) + 4}:y=${gutter + panelH + 6}:fontsize=16:fontcolor=white`;
  });
  try {
    ffmpegTo(outPath, () => ["-i", plain, "-frames:v", "1", "-vf", labels.join(","), "-pix_fmt", "rgb24"], `${label} labels`);
    return { labelled: true };
  } catch (error) {
    if (!(error instanceof SpriteSheetError)) throw error;
    renameSync(plain, outPath);
    return { labelled: false };
  } finally {
    rmSync(plain, { force: true });
  }
}

/**
 * `rive <characterDir>`: the whole character as one `.riv`.
 *
 * By default every READY sprite motion goes in, in rail order. Loops go in
 * when asked — `--include-loops`, or by name with `--motions` — resampled and
 * downscaled by `rive-plan.mjs`, because every runtime decodes every embedded
 * frame when the file loads and a loop is cut at its clip's rate and width.
 * A transition goes in with the two loops it joins, never without them, and
 * a reverse whose source is in the file is drawn from the source's images.
 * With two clip motions or more, each loop and transition is divided by its
 * scale against its clip and placed at its clip's coordinates
 * (`recordedLoopClip`, `measureLoopClip`), so the character is one size in
 * every state and stands where each clip put it. Each frame is pinned by its
 * pivot to one shared point of the artboard: the atlas pivot for a sprite
 * motion, that clip point for a placed loop or transition, the first frame's
 * feet for one whose place is unknown. The memory is counted from the plan
 * before a frame is scaled, and a file past `RIVE_DECODE_LIMIT_BYTES` is
 * refused with nothing written.
 *
 * The state machine routes (`riveStateMachine` in rive.mjs): the number
 * input `motion` names the loop to be in, and the machine changes state only
 * at a loop's cycle end or a clip's last frame, through the hub (`--hub`,
 * else the looping idle) when no clip joins two loops. Every direct cut in the
 * file is reported with its pose gap, measured on the frames as the file
 * shows them.
 */
function stepRive(characterDir, { images: askedImages = null, motions: named, includeLoops, fps, maxSize, filter, hub: hubId = null }) {
  const label = "rive";
  const character = readCharacterProject(characterDir, label);
  const all = character.doc.sprite.motions.filter((m) => m && typeof m.id === "string");
  const isLoop = (motion) => motion.kind === "loop";
  const isTransition = (motion) => motion.kind === "transition";
  const kindOf = (motion) => (isLoop(motion) ? "loop" : isTransition(motion) ? "transition" : "sprite");
  const loopFps = fps ?? RIVE_LOOP_FPS;
  const loopMax = maxSize ?? RIVE_LOOP_MAX_SIZE;
  const included = [];
  const excluded = [];
  const warnings = [];

  if (named) {
    if (includeLoops) warnings.push("--include-loops ignored: --motions names every motion that goes in");
    const seen = new Set();
    for (const id of named) {
      if (seen.has(id)) fail(`${label}: --motions names '${id}' twice`);
      seen.add(id);
      const motion = all.find((m) => m.id === id);
      if (!motion) fail(`${label}: no motion '${id}' in ${character.dir}/project.json (known: ${all.map((m) => m.id).join(", ") || "none"})`);
      if (motion.status !== "ready") {
        fail(`${label}: '${id}' is not ready (${motion.status ?? "no status"}) — only a finished motion goes into a .riv`);
      }
      included.push(motion);
    }
    for (const motion of included.filter(isTransition)) {
      for (const end of [motion.from, motion.to]) {
        if (!included.some((m) => m.id === end)) {
          fail(`${label}: ${motion.id} joins '${end}', which --motions leaves out — a transition goes in with both of the loops it joins: add ${end}, or leave ${motion.id} out`);
        }
      }
    }
    for (const motion of all) {
      if (!seen.has(motion.id)) excluded.push({ motion: motion.id, reason: "not named in --motions" });
    }
  } else {
    for (const motion of all) {
      if (isLoop(motion) && !includeLoops) {
        excluded.push({
          motion: motion.id,
          reason: `a loop — left out unless asked for: --include-loops, or --motions ${motion.id}; it goes in resampled to ${loopFps} fps with a longest edge of ${loopMax} px`,
        });
      } else if (isTransition(motion) && !includeLoops) {
        excluded.push({ motion: motion.id, reason: "a transition — it goes in with the loops it joins: --include-loops" });
      } else if (motion.status !== "ready") {
        excluded.push({ motion: motion.id, reason: `not ready (${motion.status ?? "no status"}) — only a finished motion goes in` });
      } else {
        included.push(motion);
      }
    }
    // A transition lands on two loops; without both it has nowhere to go.
    for (const motion of included.filter(isTransition)) {
      const missing = [motion.from, motion.to].filter((end) => !included.some((m) => m.id === end && isLoop(m)));
      if (!missing.length) continue;
      included.splice(included.indexOf(motion), 1);
      excluded.push({
        motion: motion.id,
        reason: `joins ${missing.join(" and ")}, which ${missing.length === 1 ? "is" : "are"} not going in — a transition goes in with both of its loops`,
      });
    }
    if (!included.length) {
      const loops = all.filter((m) => isLoop(m) && m.status === "ready").map((m) => m.id);
      if (loops.length && !includeLoops) {
        fail(`${label}: ${character.name} has no finished sprite motion, only loop${loops.length === 1 ? "" : "s"} (${loops.join(", ")}) — loops go into a .riv when asked: pass --include-loops, or --motions ${loops.join(",")}. Each is resampled to ${loopFps} fps with a longest edge of ${loopMax} px (--fps, --max-size), because every Rive runtime decodes every embedded frame when the file loads.`);
      }
      fail(`${label}: ${character.name} has no finished motion to put in a .riv — finish one first`);
    }
  }
  if (hubId !== null && !included.some((m) => m.id === hubId && isLoop(m))) {
    const loops = included.filter(isLoop).map((m) => m.id);
    fail(`${label}: --hub: '${hubId}' is not a loop in this file (loops in it: ${loops.join(", ") || "none"}) — the hub is the loop every route passes through`);
  }
  // WebP unless asked otherwise — lossless for pixel art, by the reading of
  // the style `--filter auto` uses. An ffmpeg without libwebp cannot write
  // either: asked for by name, that is refused; by default, the file is still
  // worth making as PNG, larger, and the report says why.
  const style = String(character.doc.sprite.character?.style ?? "");
  let images = askedImages ?? riveDefaultImages(style);
  if (images !== "png" && !hasEncoder("libwebp")) {
    if (askedImages) {
      fail(`${label}: --images ${askedImages} needs ffmpeg's libwebp encoder, which this build does not have — use --images png`);
    }
    const wanted = images === "webp-lossless" ? "lossless WebP" : "WebP";
    images = "png";
    warnings.push(`This ffmpeg has no libwebp encoder, so the frames went in as PNG instead of the default ${wanted} — lossless, but larger; an ffmpeg built with libwebp makes the smaller file`);
  }

  // What every motion is, as registered: its frames, its rate, its size.
  const sources = included.map((motion) => {
    const frames = registeredFrames(character, motion, label);
    const kind = kindOf(motion);
    const facts = kind === "sprite"
      ? readAtlasFacts(character, motion, frames.paths.length, label)
      : {
        fps: Number(motion.fps) > 0 ? Number(motion.fps) : fail(`${label}: ${kind} '${motion.id}' has no usable fps`),
        // A transition plays once, whatever its record says.
        loop: kind === "loop" && motion.loop !== false,
        perFrame: null,
      };
    return { motion, frames, facts, size: probeSize(frames.paths[0], label), kind, clip: null };
  });
  const graphMotions = sources.map((source) => ({
    id: source.motion.id,
    loop: source.facts.loop,
    kind: source.kind,
    ...(source.kind === "transition" ? { from: source.motion.from, to: source.motion.to } : {}),
  }));

  const work = mkdtempSync(join(tmpdir(), "sprite-rive-"));
  try {
    // Where each loop and transition sits in its clip (see
    // `recordedLoopClip`). Two of them or more only: one has no sibling to be
    // matched against, and its size and place come out the same either way.
    // A loop cut before `loop` recorded it is measured — a handful of decoded
    // frames — and one that cannot be measured is said so and drawn the way
    // it always was. A transition always records its crop.
    const clipSources = sources.filter((source) => source.kind !== "sprite");
    for (const source of clipSources) {
      const id = source.motion.id;
      source.clip = recordedLoopClip(source.motion) ?? (source.kind === "loop" ? storedLoopClip(source.motion) : null);
      if (clipSources.length < 2) continue;
      if (source.clip) {
        if (!source.clip.origin) warnings.push(`${id}: where it stood in its clip is not known — stood on its feet instead`);
        continue;
      }
      if (source.kind === "transition") {
        warnings.push(`${id}: its crop and scale were not recorded — drawn as it was cut and stood on its feet, so it may not line up with the loops it joins; cut it again with 'transition'`);
        continue;
      }
      const measured = measureLoopClip(character, source.motion, source.frames.paths, work);
      if (measured.reason) {
        warnings.push(`${id}: its scale against its clip is unknown — ${measured.reason}; drawn as it was cut and stood on its feet, so it may not match the other loops in size or place`);
        continue;
      }
      source.clip = measured.clip;
      if (measured.originReason) warnings.push(`${id}: where it stood in its clip is unknown — ${measured.originReason}; stood on its feet instead`);
    }

    // A reverse whose source is in the file shows the source's images
    // backwards — unless the source was cut again after it was made.
    const edges = new Map();
    for (const edge of Array.isArray(character.doc.provenance) ? character.doc.provenance : []) {
      if (edge && typeof edge.toAssetId === "string") edges.set(edge.toAssetId, edge);
    }
    const lookup = { edgeOf: (id) => edges.get(id), createdAt: (id) => character.assets.get(id)?.createdAt };
    const reverseOf = new Map();
    for (const source of sources.filter((s) => s.kind === "transition" && typeof s.motion.reverseOf === "string")) {
      const origin = sources.find((s) => s.motion.id === source.motion.reverseOf);
      if (!origin) continue;
      if (riveReverseIsCurrent(source.motion, origin.motion, lookup)) {
        reverseOf.set(source.motion.id, origin.motion.id);
      } else {
        warnings.push(`${source.motion.id} plays an earlier cut of ${origin.motion.id} backwards — it goes in with its own frames; cut it again with 'sprite-sheet.mjs transition --reverse-of ${origin.motion.id} --character <dir>' and register it to draw it from ${origin.motion.id}'s images`);
      }
    }

    const plan = rivePlan(sources.map((source) => ({
      id: source.motion.id,
      kind: source.kind,
      loop: source.facts.loop,
      fps: source.facts.fps,
      frames: source.frames.paths.length,
      width: source.size.width,
      height: source.size.height,
      ...(source.clip ? { clipScale: source.clip.scale } : {}),
      ...(reverseOf.has(source.motion.id) ? { reverseOf: reverseOf.get(source.motion.id) } : {}),
    })), { fps, maxSize });

    // Refused on the arithmetic, before a frame is scaled or a byte written.
    if (plan.decodeBytes > RIVE_DECODE_LIMIT_BYTES) {
      const each = plan.motions
        .filter((m) => !m.shares)
        .map((m) => `${m.id} ${m.frames} × ${m.width}×${m.height} = ${riveMB(m.decodeBytes)} MB`)
        .join(", ");
      fail(`${label}: this .riv would take about ${riveMB(plan.decodeBytes)} MB of memory once opened (${each}) — over the ${riveMB(RIVE_DECODE_LIMIT_BYTES)} MB a Rive runtime can be asked to decode up front. Lower --fps (loops now ${plan.settings.loop.fps}) or --max-size (loops now ${plan.settings.loop.maxSize} px), or pass fewer motions with --motions.`);
    }
    if (plan.decodeBytes > RIVE_DECODE_WARN_BYTES) warnings.push(riveDecodeWarning(plan.decodeBytes));

    // The loops and transitions whose place in the clip is known are drawn
    // in CLIP coordinates: a point of the clip lands on the same point of the
    // artboard in every one of them. That point is the hub's feet — or the
    // resting motion's, or the first placed loop's — so the sprite motions
    // and anything stood on its own feet stand where the reference does.
    const hubIndex = riveHub(graphMotions, hubId);
    const resting = sources[hubIndex !== -1 ? hubIndex : riveDefaultMotion(graphMotions)];
    const placed = clipSources.filter((source) => source.clip?.origin);
    const reference = placed.includes(resting) ? resting : (placed.find((source) => source.kind === "loop") ?? placed[0]);
    let clipPoint = null;
    if (reference) {
      const feet = loopAnchor(reference.frames.paths[0]);
      clipPoint = {
        x: reference.clip.origin.x + feet.x / reference.clip.scale,
        y: reference.clip.origin.y + feet.y / reference.clip.scale,
      };
    }

    const scaleFilter = filter === "auto" ? (RIVE_PIXEL_ART_STYLE.test(style) ? "nearest" : "smooth") : filter;
    let encoded = 0;
    const own = sources.map((source, k) => {
      const planned = plan.motions[k];
      if (planned.shares) return { planned, source, shown: null, frames: null, loopPoint: null };
      const picked = planned.indices.map((i) => source.frames.paths[i]);
      let paths = picked;
      if (planned.scale !== 1) {
        // The kept frames as one numbered run, then one ffmpeg pass.
        const staged = join(work, `m${k}`);
        const scaled = join(work, `m${k}-scaled`);
        mkdirSync(staged, { recursive: true });
        mkdirSync(scaled, { recursive: true });
        picked.forEach((path, i) => copyFileSync(path, join(staged, `${String(i).padStart(4, "0")}.png`)));
        ffmpeg([
          "-start_number", "0", "-i", join(staged, "%04d.png"), "-frames:v", String(picked.length),
          "-vf", riveScaleChain(planned.width, planned.height, scaleFilter).join(","),
          "-pix_fmt", "rgba", "-start_number", "0", "--", join(scaled, "%04d.png"),
        ], `rive scale ${planned.id}`);
        paths = picked.map((_, i) => join(scaled, `${String(i).padStart(4, "0")}.png`));
        const written = paths.filter((path) => existsSync(path)).length;
        if (written !== paths.length) fail(`${label}: scaling '${planned.id}' wrote ${written} of ${paths.length} frames`);
      }

      // The pivot as a fraction of the frame survives any scale; in pixels it
      // is that fraction of the frame the .riv embeds. A loop or transition
      // placed in clip coordinates pins the clip point every one of them
      // shares: (point − origin) × scale in its own frame pixels, inside the
      // frame or not.
      const loopPoint = source.kind === "sprite"
        ? null
        : clipPoint && source.clip?.origin
          ? {
            x: (clipPoint.x - source.clip.origin.x) * source.clip.scale,
            y: (clipPoint.y - source.clip.origin.y) * source.clip.scale,
            from: "clip",
          }
          : loopAnchor(source.frames.paths[0]);
      const fraction = (i) => source.kind !== "sprite"
        ? { x: loopPoint.x / source.size.width, y: loopPoint.y / source.size.height }
        : source.facts.perFrame[planned.indices[i]].pivot;
      const shown = paths.map((path, i) => {
        const pivot = fraction(i);
        return { path, width: planned.width, height: planned.height, pivot: { x: pivot.x * planned.width, y: pivot.y * planned.height } };
      });
      const frames = shown.map((frame) => ({
        bytes: images === "png" ? readFileSync(frame.path) : stillWebp(frame.path, work, encoded++, images === "webp-lossless"),
        width: frame.width,
        height: frame.height,
        pivot: frame.pivot,
        ext: images === "png" ? "png" : "webp",
      }));
      return { planned, source, shown, frames, loopPoint };
    });
    // A shared motion shows its source's embedded frames, backwards: its
    // frame r is the source's planned frame K − 1 − r.
    const byId = new Map(own.map((entry) => [entry.planned.id, entry]));
    for (const entry of own) {
      if (!entry.planned.shares) continue;
      const from = byId.get(entry.planned.shares);
      const count = entry.planned.frames;
      entry.shown = Array.from({ length: count }, (_, r) => from.shown[count - 1 - r]);
      entry.frames = Array.from({ length: count }, (_, r) => ({ shared: { motion: from.planned.id, index: count - 1 - r } }));
      entry.loopPoint = from.loopPoint;
    }

    // One artboard every frame fits on with its pivot at the same point: as
    // far left of that point as any frame reaches, as far right, and so on.
    let left = 0;
    let right = 0;
    let top = 0;
    let bottom = 0;
    for (const { shown } of own) {
      for (const frame of shown) {
        left = Math.max(left, frame.pivot.x);
        right = Math.max(right, frame.width - frame.pivot.x);
        top = Math.max(top, frame.pivot.y);
        bottom = Math.max(bottom, frame.height - frame.pivot.y);
      }
    }
    const anchor = { x: Math.ceil(left - 1e-6), y: Math.ceil(top - 1e-6) };
    const artboard = {
      name: character.name,
      width: anchor.x + Math.ceil(right - 1e-6),
      height: anchor.y + Math.ceil(bottom - 1e-6),
    };
    const written = writeRiv({
      artboard,
      anchor,
      hub: hubId,
      motions: own.map(({ planned, source, frames }, k) => ({
        ...graphMotions[k],
        fps: planned.fps,
        loop: planned.loop,
        frames,
      })),
    });
    const out = writeBytesAtomic(join(character.dir, EXPORTS_DIRNAME, `${character.id}.riv`), written.bytes);

    // Every direct cut, measured where the file makes it: the last frame of
    // what is left against the first of what comes next, each where the
    // artboard draws it, in the same 1 − IoU a transition's joins are read in.
    const shownOf = new Map(own.map((entry) => [entry.planned.id, entry.shown]));
    const onArtboard = (frame) => ({ origin: { x: anchor.x - frame.pivot.x, y: anchor.y - frame.pivot.y }, scale: 1 });
    const cuts = written.stateMachine.cuts.map((cut) => {
      if (cut.from === null) return { ...cut, poseGap: null };
      const last = shownOf.get(cut.from).at(-1);
      const first = shownOf.get(cut.to)[0];
      const extent = unionExtent([last, first].map((frame) => clipExtent(frame, onArtboard(frame))));
      const s = poseScale(extent);
      return {
        ...cut,
        poseGap: poseDiff(
          framePose(last.path, onArtboard(last), extent, s, label),
          framePose(first.path, onArtboard(first), extent, s, label),
        ),
      };
    });

    const notes = [
      "The frames are raster images, not vector shapes: the .riv plays in every Rive runtime, but it is a runtime file and cannot be reopened in the Rive editor.",
    ];
    for (const { planned } of own) {
      const { source } = planned;
      if (planned.shares) {
        notes.push(`${planned.id}: ${planned.shares}'s ${planned.frames} images played backwards — nothing more embedded`);
        continue;
      }
      if (planned.frames === source.frames && planned.scale === 1) continue;
      notes.push(`${planned.id}: ${source.frames} frames at ${source.fps} fps, ${source.width}×${source.height} → ${planned.frames} frames at ${planned.fps} fps, ${planned.width}×${planned.height} in the .riv`);
    }
    if (placed.length > 1) {
      const factor = round(placed[0].clip.scale * plan.motions[sources.indexOf(placed[0])].scale, 4);
      notes.push(`${placed.map((source) => source.motion.id).join(", ")} are drawn at one scale — ${factor} px per pixel of their clips — and placed where their clips put them, around ${reference.motion.id}'s feet.`);
    }
    const machine = written.stateMachine;
    if (machine.waits.length > 1) {
      const longest = machine.waits.reduce((a, b) => (b.seconds > a.seconds ? b : a));
      notes.push(`Leaving a loop waits for the end of its cycle: set '${RIVE_MOTION_INPUT}' and the loop plays out the cycle it is in before anything moves — up to ${longest.seconds}s from ${longest.motion} (every loop's wait is in stateMachine.waits). Routes go through ${machine.hub} unless a transition joins two loops directly.`);
      const measured = cuts.filter((cut) => cut.poseGap);
      if (measured.length) {
        const worst = measured.reduce((a, b) => (b.poseGap.gap > a.poseGap.gap ? b : a));
        notes.push(`${measured.length} direct cut${measured.length === 1 ? "" : "s"} where no transition joins the poses, the largest poseGap ${worst.poseGap.gap} (${worst.from} → ${worst.to}) — each is in stateMachine.cuts; a transition clip between those loops removes it.`);
      } else {
        notes.push("Every route between loops goes through a transition clip: no direct cut between loops.");
      }
    }
    if (images === "webp-lossless") {
      notes.push(`The frames are embedded as lossless WebP — every visible pixel exactly as drawn${askedImages ? "" : ", the default for pixel art (character.style)"}; --images webp makes a smaller, lossy file.`);
    }
    if (images === "webp") {
      notes.push("The frames are embedded as WebP, lossy at quality 85 — several times smaller than PNG, and decoded by every Rive runtime (the native ones share rive-runtime's own WebP decoder); --images png embeds them lossless.");
    }
    return {
      kind: "rive",
      character: character.dir,
      name: character.name,
      out,
      size: statSync(out).size,
      images,
      artboard: { ...artboard, anchor },
      resample: {
        loop: plan.settings.loop,
        sprite: plan.settings.sprite,
        filter: scaleFilter,
        filterFrom: filter === "auto" ? "style" : "flag",
      },
      motions: own.map(({ planned, source, shown, loopPoint }, i) => ({
        id: planned.id,
        kind: planned.kind,
        loop: planned.loop,
        ...(source.kind === "transition" ? { from: source.motion.from, to: source.motion.to } : {}),
        ...(planned.shares ? { shares: planned.shares } : {}),
        source: planned.source,
        frames: planned.frames,
        fps: planned.fps,
        width: planned.width,
        height: planned.height,
        scale: round(planned.scale, 4),
        // A loop's or transition's scale and place in its clip, and where
        // they came from; null when not known (or, alone, not needed).
        ...(source.kind !== "sprite" ? { clip: source.clip } : {}),
        ...(planned.frames === planned.source.frames ? {} : { indices: planned.indices }),
        timelineFps: written.animations[i].fps,
        seconds: written.animations[i].seconds,
        anchor: {
          x: round(shown[0].pivot.x, 2),
          y: round(shown[0].pivot.y, 2),
          from: source.kind !== "sprite" ? loopPoint.from : "atlas",
        },
        estimatedDecodeBytes: planned.decodeBytes,
      })),
      // What the file was made FROM: every registered frame of every motion in
      // it. Registration checks these against project.json and hangs the
      // .riv off them; `frameCount` is what the file embeds.
      frames: sources.flatMap((source) => source.frames.paths),
      frameCount: plan.motions.reduce((sum, m) => sum + (m.shares ? 0 : m.frames), 0),
      estimatedDecodeBytes: plan.decodeBytes,
      stateMachine: { ...machine, cuts },
      excluded,
      notes,
      warnings,
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
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
  retime: {
    keep: { type: "string" }, out: { type: "string" }, fps: { type: "string" },
  },
  loop: {
    out: { type: "string" }, name: { type: "string" },
    "trim-start": { type: "string" }, "trim-end": { type: "string" },
    key: { type: "string" }, similarity: { type: "string" }, blend: { type: "string" },
    despill: { type: "boolean", default: false }, "no-despill": { type: "boolean", default: false },
    "trim-holds": { type: "boolean", default: false }, "no-trim-holds": { type: "boolean", default: false },
    "seam-fill": { type: "string" },
    crop: { type: "string" }, pad: { type: "string" }, width: { type: "string" },
    fps: { type: "string" }, formats: { type: "string" }, threshold: { type: "string" },
  },
  transition: {
    character: { type: "string" }, from: { type: "string" }, to: { type: "string" },
    out: { type: "string" }, name: { type: "string" }, duration: { type: "string" },
    "reverse-of": { type: "string" },
    "trim-start": { type: "string" }, "trim-end": { type: "string" },
    key: { type: "string" }, similarity: { type: "string" }, blend: { type: "string" },
    despill: { type: "boolean", default: false }, "no-despill": { type: "boolean", default: false },
    "trim-holds": { type: "boolean", default: false }, "no-trim-holds": { type: "boolean", default: false },
    crop: { type: "string" }, pad: { type: "string" }, width: { type: "string" }, threshold: { type: "string" },
  },
  lineup: { hub: { type: "string" }, out: { type: "string" } },
  export: {
    format: { type: "string" }, bg: { type: "string" }, repeat: { type: "string" }, scale: { type: "string" },
  },
  rive: {
    images: { type: "string" }, motions: { type: "string" }, "include-loops": { type: "boolean", default: false },
    fps: { type: "string" }, "max-size": { type: "string" }, filter: { type: "string" }, hub: { type: "string" },
  },
};

/** `--seam-fill auto|none|<N>` — "auto", "none", or how many in-betweens. */
function pickSeamFill(value) {
  if (value === undefined || value === "auto") return "auto";
  if (value === "none") return "none";
  return num(value, "--seam-fill", { integer: true, min: 0 });
}

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

/** A transition's report, said for a person. */
function transitionLines(out) {
  const { step, startGap, endGap } = out.inspect;
  const said = (gap, end) => (gap === undefined ? `${end} not measured` : `${end}Gap ${gap}${gap > JOIN_STEPS * step ? " — does not land" : " — joins"}`);
  return [
    `${out.name}: ${out.from} → ${out.to}${out.reverseOf ? ` (${out.reverseOf} backwards)` : ""}, ${out.frames.length} frames of ${out.cell.width}x${out.cell.height} at ${out.fps}fps (${out.duration}s) → ${out.motionDir}`,
    `step ${step}; ${said(startGap, "start")}; ${said(endGap, "end")}`,
    ...(out.warnings.length ? out.warnings : ["no warnings"]),
  ];
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

/** A `--flag` / `--no-flag` pair whose default is ON. */
function pickToggle(values, flag, fallback) {
  if (values[flag] && values[`no-${flag}`]) fail(`--${flag} and --no-${flag} are mutually exclusive`);
  if (values[flag]) return true;
  if (values[`no-${flag}`]) return false;
  return fallback;
}

/** `--formats webp,apng` — the same comma-or-repeat flattening `--at` uses. */
function parseFormats(raw) {
  if (raw === undefined) return [...LOOP_FORMATS];
  const asked = String(raw).split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);
  if (!asked.length) fail(`--formats: expected some of ${LOOP_FORMATS.join(", ")}, got '${raw}'`);
  for (const format of asked) {
    if (!LOOP_FORMATS.includes(format)) {
      fail(`--formats: expected some of ${LOOP_FORMATS.join(", ")}, got '${format}'`);
    }
  }
  // Written in the canonical order whatever order they were asked in, so the
  // JSON key order does not depend on how the flag was typed.
  return LOOP_FORMATS.filter((format) => asked.includes(format));
}

/** `--bg`: a `#rrggbb`, lowercased. Words like `white` are refused rather than
 *  guessed at — the colour lands in the file and in the report verbatim. */
function exportColor(value) {
  const color = String(value).trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(color)) fail(`--bg: expected a #rrggbb colour, got '${value}'`);
  return color;
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
    case "retime": {
      const out = stepRetime(requirePositional(positionals, "<clip>"), {
        keep: parseKeepRanges(requireFlag(values.keep, "--keep")),
        out: requireFlag(values.out, "--out"),
        fps: values.fps === undefined ? null : num(values.fps, "--fps", { min: 1 }),
      });
      emit(values, out, [
        `${basename(out.out)}: ${out.frames} frames at ${out.fps} fps (${out.duration}s) replayed from ${out.sourceFrames} frames of ${basename(out.source)}`,
        `kept ${out.keep.map(([from, to]) => `${from}-${to}`).join(", ")} — the wrap is now source frame ${out.lastIs} back to ${out.firstIs}, so measure the seam again with 'loop'`,
      ]);
      break;
    }
    case "loop": {
      const key = values.key ?? "auto";
      if (key !== "auto" && key !== "none" && key !== "alpha") normalizeColor(key, "--key");
      const crop = values.crop ?? "union";
      if (crop !== "union" && crop !== "none") fail(`--crop: expected union or none, got '${values.crop}'`);
      const out = stepLoop(requirePositional(positionals, "<clip>"), {
        out: requireFlag(values.out, "--out"),
        name: requireFlag(values.name, "--name"),
        trimStart: num(values["trim-start"], "--trim-start", { min: 0, fallback: null }),
        trimEnd: num(values["trim-end"], "--trim-end", { min: 0, fallback: null }),
        key,
        similarity: num(values.similarity, "--similarity", { min: 0, fallback: DEFAULT_VIDEO_SIMILARITY }),
        blend: num(values.blend, "--blend", { min: 0, fallback: DEFAULT_BLEND }),
        despill: pickToggle(values, "despill", true),
        trimHolds: pickToggle(values, "trim-holds", true),
        seamFill: pickSeamFill(values["seam-fill"]),
        crop,
        pad: num(values.pad, "--pad", { integer: true, min: 0, fallback: DEFAULT_PAD }),
        width: values.width === undefined ? null : num(values.width, "--width", { integer: true, min: 2 }),
        fps: values.fps === undefined ? null : num(values.fps, "--fps", { min: 1 }),
        formats: parseFormats(values.formats),
        threshold,
      });
      emit(values, out, [
        `${out.name}: ${out.frames.length} frames of ${out.cell.width}x${out.cell.height} at ${out.fps}fps (${out.duration}s) from ${basename(out.video)} → ${out.motionDir}`,
        `seam ${out.inspect.seam} vs step ${out.inspect.step} (max ${out.inspect.maxStep}), dropped ${out.dropped.leading} leading / ${out.dropped.trailing} trailing, seam-fill ${out.seamFill}`,
        ...Object.entries(out.inspect.exports).map(([format, bytes]) => `${format} ${(bytes / 1e6).toFixed(2)} MB`),
        ...(out.warnings.length ? out.warnings : ["no warnings"]),
      ]);
      break;
    }
    case "transition": {
      const character = requireFlag(values.character, "--character");
      if (values["reverse-of"] !== undefined) {
        if (positionals.length) fail("--reverse-of takes no clip: the way back is the registered frames played backwards");
        const out = stepReverseTransition({ character, reverseOf: values["reverse-of"], out: values.out, name: values.name });
        emit(values, out, transitionLines(out));
        break;
      }
      const key = values.key ?? "alpha";
      if (key !== "auto" && key !== "none" && key !== "alpha") normalizeColor(key, "--key");
      const crop = values.crop ?? "union";
      if (crop !== "union" && crop !== "none") fail(`--crop: expected union or none, got '${values.crop}'`);
      const out = stepTransition(requirePositional(positionals, "<clip>"), {
        character,
        from: requireFlag(values.from, "--from"),
        to: requireFlag(values.to, "--to"),
        out: values.out,
        name: values.name,
        duration: values.duration === undefined ? null : num(values.duration, "--duration", { min: 0.05 }),
        trimStart: num(values["trim-start"], "--trim-start", { min: 0, fallback: null }),
        trimEnd: num(values["trim-end"], "--trim-end", { min: 0, fallback: null }),
        key,
        similarity: num(values.similarity, "--similarity", { min: 0, fallback: DEFAULT_VIDEO_SIMILARITY }),
        blend: num(values.blend, "--blend", { min: 0, fallback: DEFAULT_BLEND }),
        despill: pickToggle(values, "despill", true),
        trimHolds: pickToggle(values, "trim-holds", true),
        crop,
        pad: num(values.pad, "--pad", { integer: true, min: 0, fallback: DEFAULT_PAD }),
        width: values.width === undefined ? null : num(values.width, "--width", { integer: true, min: 2 }),
        threshold,
      });
      emit(values, out, transitionLines(out));
      break;
    }
    case "lineup": {
      const out = stepLineup(requirePositional(positionals, "<characterDir>"), {
        hub: values.hub ?? null, out: values.out,
      });
      emit(values, out, [
        `${basename(out.out)}: hub ${out.hub} · ${out.threshold.rule}`,
        ...out.motions.filter((m) => !m.hub).map((m) => (m.poseGap
          ? `  ${m.id}: iou ${m.poseGap.iou}, chroma ${m.poseGap.chroma}, rgb ${m.poseGap.rgb} → ${m.suggestion}${m.transitions.length ? ` (registered: ${m.transitions.join(", ")})` : ""}; closest frame ${m.closestFrame.index} (iou ${m.closestFrame.iou})`
          : `  ${m.id}: not compared`)),
        ...out.warnings,
      ]);
      break;
    }
    case "export": {
      const format = String(requireFlag(values.format, "--format")).toLowerCase();
      const out = stepExport(requirePositional(positionals, "<motionDir>"), {
        format,
        bg: values.bg === undefined ? null : exportColor(values.bg),
        repeat: values.repeat === undefined ? null : num(values.repeat, "--repeat", { integer: true, min: 1 }),
        scale: num(values.scale, "--scale", { integer: true, min: 1, fallback: 1 }),
      });
      emit(values, out, [
        `${basename(out.out)} · ${out.frameCount} frames at ${out.fps} fps, ${out.loop ? "loops" : "plays once"}${out.repeat > 1 ? `, played ${out.repeat}× (${out.duration} s)` : ""} · ${out.width}×${out.height} · ${(out.size / 1e6).toFixed(2)} MB → ${out.out}`,
        ...out.notes,
        ...out.warnings,
      ]);
      break;
    }
    case "rive": {
      const images = values.images ?? null;
      if (images !== null && !RIVE_IMAGES.includes(images)) fail(`--images: expected ${RIVE_IMAGES.join(" or ")}, got '${values.images}'`);
      const filter = values.filter ?? "auto";
      if (!RIVE_FILTERS.includes(filter)) fail(`--filter: expected ${RIVE_FILTERS.join(", ")}, got '${values.filter}'`);
      let fps = null;
      if (values.fps !== undefined) {
        fps = Number(values.fps);
        if (!(Number.isFinite(fps) && fps > 0 && fps <= 120)) fail(`--fps: expected a rate above 0 and at most 120, got '${values.fps}'`);
      }
      let maxSize = null;
      if (values["max-size"] !== undefined) {
        maxSize = Number(values["max-size"]);
        if (!(Number.isInteger(maxSize) && maxSize >= 8)) fail(`--max-size: expected a whole number of pixels, at least 8, got '${values["max-size"]}'`);
      }
      let motions = null;
      if (values.motions !== undefined) {
        motions = values.motions.split(",").map((id) => id.trim()).filter(Boolean);
        if (!motions.length) fail("--motions: expected motion ids separated by commas, e.g. --motions idle,wave");
      }
      const out = stepRive(requirePositional(positionals, "<characterDir>"), {
        images, motions, includeLoops: values["include-loops"], fps, maxSize, filter, hub: values.hub ?? null,
      });
      const machine = out.stateMachine;
      const number = machine.inputs.find((input) => input.type === "number");
      const triggers = machine.inputs.filter((input) => input.type === "trigger").map((input) => input.name);
      const gapOf = new Map(machine.cuts.map((cut) => [`${cut.from}>${cut.to}`, cut.poseGap?.gap]));
      emit(values, out, [
        `${basename(out.out)} · ${out.motions.map((m) => m.id).join(", ")} · ${out.frameCount} ${out.images} frames on a ${out.artboard.width}×${out.artboard.height} artboard · ${(out.size / 1e6).toFixed(2)} MB → ${out.out}`,
        ...out.motions.map((m) => `  ${m.id} (${m.kind}): ${m.shares ? `${m.shares}'s images backwards` : `${m.frames} frames at ${m.fps} fps, ${m.width}×${m.height} — ${riveMB(m.estimatedDecodeBytes)} MB decoded`}`),
        `state machine "${machine.name}", resting in ${machine.defaultMotion}${machine.hub ? ` (the hub)` : ""}`,
        ...(number ? [`  number '${number.name}': ${number.values.map((v) => `${v.value} = ${v.motion}`).join(", ")}`] : []),
        ...(triggers.length ? [`  triggers: ${triggers.join(", ")}`] : []),
        ...machine.routes.map((route) => `  ${route.from} → ${route.to}: ${route.steps.map((step) => step.transition
          ? `transition ${step.transition}`
          : `direct cut (poseGap ${gapOf.get(`${step.cut.from}>${step.cut.to}`)})`).join(", then ")} · up to ${route.seconds}s`),
        `decodes to about ${riveMB(out.estimatedDecodeBytes)} MB when loaded`,
        ...out.excluded.map((entry) => `left out ${entry.motion}: ${entry.reason}`),
        ...out.notes,
        ...out.warnings,
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

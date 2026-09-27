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
 * contact, from-video, retime, loop, export, rive, fit, breathe, pixel, mirror,
 * recolor, recolor-palette.
 *
 * `pixel` (and `run --pixel`) snaps generated pixel art onto the pixel grid
 * it was drawn on; the lattice itself lives in `pixel-lattice.mjs`.
 * `recolor` bakes a pixel-art character's colourways from its pinned
 * palette; the swap and its report live in `recolor.mjs`.
 *
 * `mirror` flips a side view into the other side; which motions flip and
 * where the anchor lands are `mirror.mjs`'s rules.
 *
 * `export` and `rive` hand a FINISHED motion over in somebody else's format
 * (video, a frame animation, an Aseprite sheet, a `.riv`). They read the character's
 * project.json to learn which frames are the motion's and whether it is
 * ready, and never write it — registering what they made is
 * `sprite-project.mjs register-export`.
 * `--json` prints exactly one JSON object on stdout; progress goes to stderr.
 */

import { spawnSync } from "node:child_process";
import {
  closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync,
  renameSync, rmSync, statSync, unlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  keyFrame, keyRadius, keyResidue, measurePlate, plateOf, plateProximity, poolResidue,
} from "./chroma.mjs";

import { asepriteDocument, gridLayout, stackLayout } from "./aseprite.mjs";
import { RIVE_MOTION_INPUT, riveDefaultMotion, riveHub, writeRiv } from "./rive.mjs";
import {
  RIVE_DECODE_LIMIT_BYTES, RIVE_DECODE_WARN_BYTES, RIVE_LOOP_FPS, RIVE_LOOP_MAX_SIZE, riveDefaultImages,
  riveDecodeWarning, riveIsPixelArt, riveMB, riveMirrorIsCurrent, rivePlan, riveReverseIsCurrent,
} from "./rive-plan.mjs";
import { SHADOW_DEFAULTS, SHADOW_RANGES, projectShadow, shadowCanvas, withShadow } from "./shadow.mjs";
import { zipStore } from "./zip.mjs";
import {
  BREATHE_FPS, BREATHE_MODES, BreatheError, DEFAULT_BREATHE_DEPTH, DEFAULT_LAG, FRAMES_PER_BREATH, bakeBreathe,
  hasAppendage,
} from "./breathe.mjs";
import { DEFAULT_FIT_MAX, DEFAULT_FIT_PAD, StillError, cropRgba, fitStill, padRgba } from "./still.mjs";
import {
  GAIT_FLOORS, SEAM_FLOOR, SEAM_STEP_LIMIT, adjacentSteps, detectCycle, detectOneShots, distanceMatrix,
  frameDistance, frameMass, premultiplied, seamLimit, thumbSize,
} from "./cycle.mjs";
import {
  BODY_REGISTER_BAND, BODY_REGISTER_SEARCH, bodyWrapOffset, headOffsets, headProfile, massCenterX,
  rampShifts, swayAboutTrend, trendReference,
} from "./drift.mjs";
import { BOUNDARY_STEP_RATIO, DUPLICATE_STEP, judgeSteps, stepThumb, thumbDiff } from "./frame-steps.mjs";
import { ROOM_DEFAULTS, ROOM_SHAPES, roomCanvas } from "./canvas.mjs";
import {
  RECOLOR_FILENAME, RecolorError, VARIANTS_DIRNAME, checkVariant, countColors, draftRecolorMap, mergeTallies, newTally,
  offPalette, parseHexColor, parseRecolorMap, recolorImage, swatchSheet, tallyReport,
} from "./recolor.mjs";
import {
  DEFAULT_OUTLINE_STRENGTH, DEFAULT_PALETTE_SIZE, MAX_PITCH, PIXEL_RECORD, applyPalette, blankImage,
  buildSharedPalette, enforceOutline, heightCheck, heightPitch, HEIGHT_MISMATCH_RATIO, latticeCheck, latticeFrames, loadPalette,
  paste as pasteImage, upscale, writePalette,
} from "./pixel-lattice.mjs";
import { DEFAULT_SAFE_MARGIN_RATIO, guideGeometry, guideRaster } from "./sheet-prompt.mjs";
import { MIRRORED, asymmetry, atlasLayout, mirrorAnchorRecord, mirrorRefusal } from "./mirror.mjs";

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
/** The frames' head drift over the source's own (drift removed) by more than
 *  this factor — and by more than ADDED_SWAY_FRACTION of the cell width — is
 *  sway the alignment put there. Measured 2026-09-27, feet-pinned walks: the
 *  Lumi side-view clip 9.7× (+6.7 px, 2.0 % of its cell), a pixel knight
 *  walk sheet 7.4× (+9.2 px, 3.3 %), the synthetic walker 44×. Every
 *  alignment that kept or reduced its source's motion (Lumi sheets and clips,
 *  tanka, the knight on cell/trend/body/bbox) stayed under one of the two
 *  bars: at most 1.8×, and at most +0.95 % of the cell. */
const ADDED_SWAY_RATIO = 2;
const ADDED_SWAY_FRACTION = 0.01;
/** A head band spreading less than this share of the cell width is standing
 *  still — the feet can sweep a stride under it and the body has not moved. */
const STEADY_HEAD_FRACTION = 0.01;
/** Where `align` may take each frame's x from. `trend` and `body` read every
 *  frame in one shared coordinate system (a clip's frames, one grid's cells)
 *  and keep the placement it was filmed with, minus the drift. */
const X_FROM_MODES = ["feet", "bbox", "cell", "trend", "body"];
/** The x modes that keep the source placement, so the frames must share one
 *  coordinate system: cut from one grid, or out of one clip. */
const SOURCE_PLACED = new Set(["cell", "trend", "body"]);
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

// --- keying: which keyer decides the pixels -----------------------------------
/**
 * `unmix` (chroma.mjs) separates every edge pixel into the subject's colour
 * and its coverage; `colorkey` is ffmpeg's alpha-only key (plus `despill` in
 * the loop path). `unmix` is the default because it won on both grounds the
 * switch was judged on (2026-09-27, `references/pipeline.md` → Measured):
 * a synthetic ground truth through x264, and tanka's ten Seedance loops.
 * A plate with no hue (white, cream, grey) has nothing to un-mix, and is keyed
 * with `colorkey` whatever the flag says — the report's `keyer` says which ran.
 */
const KEYERS = ["unmix", "colorkey"];
const DEFAULT_KEYER = "unmix";
/** Frames of a clip the plate colour is measured on, spread across the window. */
const PLATE_SAMPLE_FRAMES = 8;
/** Share of the visible pixels still carrying the plate's hue above which the
 *  cut is worth a look. tanka's colorkey cuts measured 1.2–1.6 %, the un-mixed
 *  ones 0.00 %; a translucent effect over the plate reads here as well. */
const KEY_RESIDUE_WARN = 0.005;
/** Share of the two-pixel edge band that is a fringe — the subject still
 *  blended with the plate at full opacity, which no hue test sees — above
 *  which the edge is worth a look. The route-G fox's walk, keyed before the
 *  local un-mix (2026-09-27), measured 0.023–0.025 with keyResidue 0 at
 *  --similarity 0.3; tanka's ten loops and the fox through the local
 *  un-mix measure 0. */
const KEY_FRINGE_WARN = 0.01;

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
/** Frame rate `contact` falls back to when the clip does not report one, and
 *  the lowest it thins a long window to. A gait cycle is ~1 s, so 12 samples
 *  of it still resolve the period to a twelfth of a second. */
const MIN_ANALYSIS_FPS = 12;
/**
 * Frames `contact` analyses at most. The cycle analysis compares every frame
 * with every other (the whole-clip lag profile and the one-shot search both
 * need whole rows of that matrix), which in Bun costs ~0.75 s per 240 frames
 * of 96 px thumbnails and grows with the square: 480 is 20 s at 24 fps or 8 s
 * at 60 fps at the clip's own rate, ~3 s of compute. A longer window is thinned
 * to fit, down to MIN_ANALYSIS_FPS.
 */
const MAX_CYCLE_FRAMES = 480;
/** Seconds of the trimmed window that get analysed: MAX_CYCLE_FRAMES at
 *  MIN_ANALYSIS_FPS. Past this the answer stops being about one motion. */
const MAX_ANALYSIS_SECONDS = MAX_CYCLE_FRAMES / MIN_ANALYSIS_FPS;
/** Fraction of the combined ink that has to change before two silhouettes are
 *  different poses rather than the same pose plus codec noise. */
const STILL_DIFF = 0.05;
/** Period range a walk / idle cycle is looked for in, in seconds. Ours, not
 *  upstream's per-state windows: sprite-gen's walk window (0.5–1.6 s) refuses
 *  tanka's front-facing waddle, whose stride is 1.875 s. */
const LOOP_PERIOD_MIN = 0.4;
const LOOP_PERIOD_MAX = 2.5;
/** What `contact --gait` accepts: the gaits that have a floor. */
const GAIT_KINDS = Object.keys(GAIT_FLOORS);
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
/**
 * A transition's end joins a loop's frame 0 when their gap is at most this
 * many of its median steps — the factor a loop's seam is held to.
 *
 * Deliberately WITHOUT the loop's colour measure and noise floor
 * (`seamLimit`, cycle.mjs): a join compares two independently rendered clips,
 * not one clip with itself. Measured 2026-09-27 on tanka-connect's four
 * transitions: premultiplied colour put `idle-to-reading`'s end at 0.0154
 * against a limit of 0.0135 — "does not land" — where the two frames are the
 * same pose and differ only in fur texture and the tablet's shading; the
 * silhouette gap (0.0083 against 0.0194) joins, as the eye does. And the
 * 0.005 floor is in colour units, which do not transfer to a silhouette gap:
 * cross-clip silhouette noise there measured 0.007–0.018.
 */
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
/** What `slice` leaves next to the cells: the grid they were cut from, so
 *  `inspect` can tell a row boundary from an ordinary step. */
const SLICE_RECORD = "slice.json";
/** What `breathe` leaves next to its frames: that they were warped out of one
 *  still, so `inspect` does not read the whole-pixel head's planned holds as
 *  a model repeating a drawing. */
const BREATHE_RECORD = "breathe.json";

// --- pixel: generated pixel art snapped onto its lattice ---------------------
/** `run --pixel` leaves the lattice frames here, between `cells/` and
 *  `frames/`: what `align` re-reads when only the alignment is redone. */
const PIXEL_DIRNAME = "pixel";
/** The palette `run --pixel` pins in the motion directory. */
const PALETTE_FILENAME = "palette.json";
/** Largest whole-number upscale `pixel --scale` takes. */
const MAX_PIXEL_SCALE = 16;
/** A pinned palette whose nearest colour is further than this (RGB distance)
 *  from one of this generation's colours was pinned for other art — a new
 *  prop's colour, another character — and quietly recolours it. */
const PALETTE_FAR = 48;

// --- export / rive: a finished motion, handed over --------------------------
/** What `export --format` makes, in the order the Export tab lists them. */
const EXPORT_FORMATS = ["mp4", "mov", "webm", "apng", "lottie", "png-seq", "aseprite"];
/** The one format `export <characterDir>` makes: every sprite motion on one
 *  sheet. (The character's `.riv` is `rive`.) */
const CHARACTER_EXPORT_FORMATS = ["aseprite"];
/** A sheet side past this will not load as one texture everywhere: 4096 is
 *  the MAX_TEXTURE_SIZE WebGL implementations can be relied on for, and many
 *  phones stop there. Said, not refused — desktop GPUs take 16384. */
const ENGINE_TEXTURE_SIDE = 4096;
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
  "guide",
  "probe", "key", "flatten", "slice", "clean", "align", "pack", "gif",
  "inspect", "run", "contact", "from-video", "retime", "loop", "transition", "lineup", "export", "rive",
  "fit", "breathe", "pixel",
  "mirror", "recolor", "recolor-palette",
];

const USAGE = `Usage: sprite-sheet.mjs <subcommand> [options]

Deterministic sprite-sheet pipeline (ffmpeg only, no model calls).
Every subcommand accepts --json (one JSON object on stdout) and --help.

  guide --rows R --cols C --cell WxH --out <png> [--margin ${DEFAULT_SAFE_MARGIN_RATIO}]
      Draw the layout guide sent with a sheet prompt, at the sheet's own
      size (C x W by R x H): a light grey canvas, a dark box on every cell,
      a blue box on its safe area (inset --margin of the cell, floored) and
      a centre line. --cell is the GENERATION cell ('sheet-prompt --json'
      reports it with the call). A working file, not an asset.

  probe <image> [--threshold 16]
      Report { width, height, hasAlpha, alphaCoverage, cornerColor }.

  key <image> --out <png> [--color auto|#rrggbb] [--similarity ${DEFAULT_SIMILARITY}] [--blend ${DEFAULT_BLEND}]
      [--keyer unmix|colorkey]
      Chroma-key a background colour away. 'auto' measures the plate on the
      border (unmix) or takes the corner colour (colorkey).
      --keyer unmix (default) un-mixes every edge pixel into the subject's
      colour and coverage (chroma.mjs); colorkey is ffmpeg's alpha-only key.
      A plate with no hue (white, cream, grey) is keyed with colorkey either
      way; the JSON's 'keyer' says which ran, and keyResidue what it left.

  flatten <image> --out <png> [--bg #ffffff] [--similarity ${DEFAULT_VIDEO_SIMILARITY}]
        [--room tall|wide|square [--headroom f] [--lead f] [--trail f] [--facing left|right]]
      Composite onto a solid colour (for video models that mishandle alpha).
      First checks the subject against the plate: any subject pixel within
      the video key radius (--similarity) of --bg is reported in plateCheck
      and warned about — keying the clip later would cut it out.
      --room pads the picture into the canvas its motion needs first, because
      an image-to-video model keeps the input's framing: square squares it off;
      tall is 3:4 with ${ROOM_DEFAULTS.tall.headroom * 100}% of the height empty above (a jump); wide
      is 16:9 with ${ROOM_DEFAULTS.wide.headroom * 100}% above, ${ROOM_DEFAULTS.wide.lead * 100}% of the width in front and ${ROOM_DEFAULTS.wide.trail * 100}% behind (an
      attack; a wave or a cheer is --headroom 0 --lead 0.3 --trail 0).
      --headroom / --lead / --trail override those fractions (each in [0, 0.9),
      lead + trail < 0.9). Front is the facing side: --facing, else the
      character's facing from the nearest sprite project.json above the image,
      else right (the report says which). The picture is never scaled and
      stands on the canvas's bottom edge.

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

  align <framesDir> --out <dir> [--anchor bottom|center] [--x-from feet|bbox|cell|trend|body]
        [--cell auto|WxH] [--pad ${DEFAULT_PAD}] [--smooth] [--threshold ${DEFAULT_THRESHOLD}]
      Re-place every frame so its anchor lands on the same point.
      y: bbox bottom (bottom) or bbox centre (center).
      x: --x-from feet (default) takes the mean x of the alpha pixels in the
      bottom ${FEET_BAND * 100}% of the bbox — where the character STANDS, so a prop
      swinging sideways no longer drags the body the other way; bbox takes the
      bbox centre (what --anchor center always uses, feet being no reference
      for an airborne pose); cell keeps the offset the drawing had inside its
      grid cell, i.e. no horizontal re-placement at all.
      trend and body are for frames out of ONE clip (or one grid): they keep
      the placement the frames were filmed with and take out only the drift,
      so a walk's planted foot is not pinned (pinning it lurches the body by
      about a stride every step). trend fits a straight line to the body's
      mass centre across the frames and removes it; body registers the last
      frame's head and torso (top ${BODY_REGISTER_BAND * 100}% of its box) against the first's,
      +/-${BODY_REGISTER_SEARCH} px, and ramps that offset across the frames. Either way
      the anchor lands on the mean foot line, and the record carries what was
      removed (drift.driftPx / drift.wrapDx).
      --smooth replaces each frame's x with the 3-frame median so a one-frame
      wobble does not shove the body sideways; with --anchor center the same
      median is applied to y.
      Records the point and the x mode it used in <dir>/${ALIGN_RECORD}, so
      pack declares that pivot instead of assuming the cell edge.
      Frames written by 'pixel' (a ${PIXEL_RECORD} next to them) are placed on
      whole multiples of their scale N — offsets, pad and cell — so every
      block stays on the cell's N-grid; the record travels into ${ALIGN_RECORD}.

  pack <framesDir> --out <sheet.png> --atlas <atlas.json> --name <motionId>
       --fps N [--loop] [--anchor bottom|center] [--cols C] [--scale 1] [--nearest]
      Row-major atlas image + TexturePacker-JSON-hash-compatible atlas.json.
      The pivot is the anchor point <framesDir>/${ALIGN_RECORD} recorded (also
      copied into meta.anchorPoint in pixels, scaled with --scale); frames
      aligned elsewhere fall back to {0.5,1} / {0.5,0.5} with a note on stderr.

  gif <framesDir> --out <preview.gif> --fps N [--loop|--no-loop]
      [--webp <preview.webp>] [--width W]
      Palette GIF with a reserved transparent entry; optional animated WebP.

  inspect <motionDir> [--anchor bottom|center] [--cells <dir>] [--key #rrggbb] [--threshold ${DEFAULT_THRESHOLD}]
      Frame count, cell, per-frame bboxes, anchor drift, body drift (the feet),
      head drift (the head-and-torso band registered against frame 00 — what
      a feet-pinned walk lurches with), max jump, scale drift, empty frames,
      near-duplicate neighbours (step under ${DUPLICATE_STEP}: the mean RGBA difference
      at 64x64), row-boundary jumps (a grid's boundary step over ${BOUNDARY_STEP_RATIO}x its
      in-row median — the grid comes from <cells>/${SLICE_RECORD}, which slice
      writes), keyResidue and human warnings. Writes <motionDir>/inspect.json.
      keyResidue is the share of visible pixels still carrying the plate —
      its hue, or an opaque edge pixel that is the colour beside it blended
      with the plate — for a motion keyed off a hued plate: --key names the
      plate, else the keyColor the last inspect.json recorded; warns above
      ${KEY_RESIDUE_WARN}. keyFringe is the share of the 2 px edge that is such a
      blend; warns above ${KEY_FRINGE_WARN}.
      --cells points at the pre-align grid cells so "leaves its grid cell"
      can be judged on the raw crop rather than the padded frame; it defaults
      to <motionDir>/${CELLS_DIRNAME} when 'run' left that directory there.
      Frames that went through 'pixel' also get pixel: { pitch, scale, held,
      palette } — held is false (with a warning) when a frame has soft alpha,
      a block off the N-grid, or a colour outside the pinned palette.

  run <sheet-raw> --rows R --cols C --out <motionDir> --name <motionId> --fps N
      [--alpha <png>] [--force] [--loop] [--anchor bottom|center]
      [--x-from feet|bbox|cell|trend|body] [--key auto|#rrggbb|none] [--keyer unmix|colorkey] [--cell auto|WxH]
      [--pad ${DEFAULT_PAD}] [--smooth] [--scale 1] [--nearest] [--margin 0] [--gutter 0]
      [--width W] [--no-webp] [--threshold ${DEFAULT_THRESHOLD}]
      [--pixel [--palette <file>] [--repalette] [--palette-size ${DEFAULT_PALETTE_SIZE}] [--pitch-hint N]
               [--logical-height H] [--outline] [--outline-strength ${DEFAULT_OUTLINE_STRENGTH}] [--no-detail-bias]]
      probe -> key (only when the sheet is opaque) -> slice -> align -> pack
      -> gif (+webp) -> inspect. An outside sheet is copied in, never moved.
      --pixel adds the 'pixel' step between the cells and align: the lattice
      frames go to <motionDir>/${PIXEL_DIRNAME}/, the palette is pinned at
      <motionDir>/${PALETTE_FILENAME} (or --palette), and --scale becomes the
      whole-number upscale of the lattice (default 1: one pixel per logical
      pixel) instead of the atlas resize. The frames are held to the
      character's declared height (character.pixel.logicalHeight, or
      --logical-height H): see 'pixel'.
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

  pixel <framesDir> --out <dir> [--palette <file>] [--repalette]
      [--palette-size ${DEFAULT_PALETTE_SIZE}] [--scale 1] [--pitch-hint N] [--logical-height H] [--outline]
      [--outline-strength ${DEFAULT_OUTLINE_STRENGTH}] [--no-detail-bias] [--threshold ${DEFAULT_THRESHOLD}]
      Snap generated pixel art onto the pixel grid it was drawn on. Per
      frame: the pitch is measured on each axis (2-${MAX_PITCH} px, sub-pixel) on the
      solid-alpha bbox; the frames' median is the consensus (collapsed
      readings below 60% of the largest dropped); a frame keeps its own
      pitch only within 10% of the consensus; the phase is the most uniform
      of 8x8 offsets; each cut line moves onto the nearest colour boundary
      (never closer than 0.6 pitch to the next); each block becomes one
      logical pixel of its dominant colour (dark detail wins a close vote
      unless --no-detail-bias), alpha 0 or 255.
      One palette of at most --palette-size colours is built over all the
      frames and PINNED to --palette (default <dir>/${PALETTE_FILENAME}): when that
      file exists it is used as it is, so a re-run cannot move the colours
      and a later motion passing the same file gets the same ones;
      --repalette rebuilds it. --outline darkens every silhouette-edge pixel
      to (1 - strength) of its colour.
      Writes <dir>/NN.png — every frame on one canvas of logical pixels,
      placed where it sat in its cell, upscaled by --scale N (whole number,
      nearest) — and <dir>/${PIXEL_RECORD} (pitch per frame, consensus, palette).
      'align' reads that record and places the frames on whole multiples of
      N; 'inspect' then reports the pitch and whether the lattice held.
      Refuses when fewer than half the frames read a grid on their own, and
      says what the frames suggest; --pitch-hint N (the block width in source
      pixels, confirmed by looking) then stands in for the consensus: a frame
      keeps its own reading within 10% of N and is cut at N otherwise.
      --logical-height H is the figure's declared height in logical pixels.
      With no --pitch-hint and too few frames reading a grid, the pitch that
      makes the frames H tall stands in for the hint when the frames' own
      loose readings (pooled pitch, same-colour runs) are within 25% of it;
      otherwise the refusal names it. After the snap the frames' median
      height is compared with H (5%, at least 1 px): a miss is a warning —
      blocks are never merged to reach it. Recorded as logicalHeight
      { declared, measured, range, honoured, pitchFrom } in ${PIXEL_RECORD}.

  recolor-palette <characterDir|motionDir> [--out <map.json>] [--force]
      Draft a recolor map for a pixel-art character (character.pixel with a
      pinned palette; anything else is refused, saying why). Lists every
      colour its ready sprite motions' frames use — most used first, with
      pixels, share, inPalette: false for one the pinned palette lacks — then
      the palette's unused colours, and one colourway with an empty map to
      fill in. Writes <characterDir>/${RECOLOR_FILENAME} (or --out; an existing
      file only with --force) and <name>-swatches.png beside it: one numbered
      cell per colour, its pixels marked on the frame that uses it most.

  recolor <characterDir|motionDir> [--map <map.json>] [--variant name,…]
      Bake colourways of a pixel-art character: every ready sprite motion,
      or the one named. Colourways come from --map ({ kind:
      "pneuma-sprite-recolor", variants: [{ name, map: { "#src": "#dst" },
      tolerance? }] }), else from the ones the character recorded
      (character.pixel.variants) — what re-bakes a motion made again.
      --variant narrows to the names given. Exact by default: a pixel changes
      only when its RGB is a source; tolerance N (1-255, per colourway) takes
      a pixel within that Chebyshev distance to the nearest source's target.
      Alpha, and every pixel with alpha 8 or less, is untouched. Per motion
      and colourway writes motions/<id>/${VARIANTS_DIRNAME}/<name>/frames/NN.png, then
      sheet.png + atlas.json (pack, the motion's own layout and pivot) and
      preview.gif. The report per colourway, per motion and summed: pixels
      swapped per entry, unmatched entries (warned) and the colours left
      as they were (uncovered, the 64 most used named). Register it with
      sprite-project.mjs register-recolor --report -.

  contact <clip> --out <png> [--count ${DEFAULT_CONTACT_COUNT} | --every s] [--cols ${DEFAULT_CONTACT_COLS}] [--width ${DEFAULT_CONTACT_WIDTH}]
      [--trim-start s] [--trim-end s] [--key auto|#rrggbb|none] [--gait walk|run]
      [--similarity ${DEFAULT_VIDEO_SIMILARITY}] [--blend ${DEFAULT_BLEND}] [--threshold ${DEFAULT_THRESHOLD}]
      Look at a clip before sampling it. Writes ONE contact sheet: --count
      stills spaced evenly across the (trimmed) clip (both ends included), or
      one still every --every seconds from the trim start — the two are
      mutually exclusive. Each still is --width px wide, timestamp burnt into
      its corner, tiled --cols per row with a ${CONTACT_GUTTER}px grey gutter.
      Also reports, from a deterministic analysis (no model) of every frame at
      the clip's own rate (thinned past ${MAX_CYCLE_FRAMES} frames):
        stillStart / stillEnd — when the opening pose breaks and the closing
          hold begins, i.e. the dead frames at either end (silhouettes);
        cycle — whether the clip repeats (premultiplied colour, so a near leg
          and a far leg, or an open and a closed eye, are different): the
          period is the shortest dip of the whole-clip lag profile between
          ${LOOP_PERIOD_MIN}s and ${LOOP_PERIOD_MAX}s within 15% of the deepest, and it must sit 15%
          below the profile mean (more when the clip holds less than two
          periods) or verdict is "none" with a reason and a warning;
          ambiguous names both lengths when twice the period repeats about
          as well — half a stride, maybe;
        loops[] — up to 3 windows of that period (plus the other length when
          ambiguous), each with its seam (how different the two ends are),
          step (how much a frame moves inside it) and wrap (the step the loop
          plays from its last frame back to its first); empty with no cycle;
        oneShots[] — rest -> action -> rest windows with an observed return,
          one per strike or hop;
        profile.deltas — the frame-to-frame change series, the clip's rhythm.
      --gait walk|run holds the period to the gait's floor (${GAIT_FLOORS.walk}s / ${GAIT_FLOORS.run}s): a
      shorter one is one step, so the doubled period is taken when it repeats
      within 25%, and the verdict is "none" (half a stride) when it does not.
      The contact sheet is a working file for your eyes, not an asset: the
      stills live in a temp dir that is removed, and nothing is written to a
      motion directory or to project.json.

  from-video <clip> --out <motionDir> --name <motionId> --frames N | --at t1,t2,…
      [--fps N] [--loop|--no-loop] [--anchor bottom|center] [--body-height N]
      [--x-from feet|bbox|cell|trend|body] [--key auto|#rrggbb|none]
      [--trim-start s] [--trim-end s] [--no-clean] [--cell auto|WxH]
      [--pad ${DEFAULT_PAD}] [--smooth] [--scale 1] [--nearest] [--width W] [--no-webp]
      [--cols C] [--similarity ${DEFAULT_VIDEO_SIMILARITY}] [--blend ${DEFAULT_BLEND}] [--threshold ${DEFAULT_THRESHOLD}]
      [--keyer unmix|colorkey]
      The video source: sample -> key -> clean -> align -> pack -> gif (+webp)
      -> inspect. There is no sheet — --frames frames are cut evenly out of
      the (trimmed) clip into <motionDir>/${CELLS_DIRNAME}/NN.png and the rest of the
      chain is the one 'run' drives.
      --key auto measures the plate (the chroma green, when the clip was
      shot as instructed) and keys every frame with it, at a wider default
      similarity than a generated sheet needs because a codec's "solid"
      green is a range. --keyer unmix (default) measures it on the border of
      ${PLATE_SAMPLE_FRAMES} sampled frames and un-mixes the edge; colorkey takes the median of
      frame 00's corner patches and keys alpha only (it leaves a 1 px green
      rim). A plate with no hue is keyed with colorkey either way.
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
      --body-height N scales every sampled frame so the subject in the clip's
      FIRST frame (t = 0, the still every clip starts from) stands N px tall:
      the same N across a character's clips gives it one size in every motion.
      Up or down (up is warned); premultiplied; needs a keyed clip.
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
      [--trim-start s] [--trim-end s] [--key auto|#rrggbb|none|alpha] [--keyer unmix|colorkey]
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
      --key auto measures the plate and keys it; alpha decodes the clip's
      OWN alpha (a VEED webm, a Bria ProRes 4444 mov); none leaves the
      frames opaque and says so.
      --keyer unmix (default) measures the plate on ${PLATE_SAMPLE_FRAMES} frames spread over
      the window and un-mixes every edge pixel into colour + coverage — no
      rim and no despill. colorkey is the previous chain: frame 0's corner
      colour, ffmpeg colorkey, then --despill. A plate with no hue is keyed
      with colorkey either way.
      --despill (colorkey only; default on when keying a green or blue
      plate) takes the plate's spill hue off the silhouette AFTER the key.
      It also takes a fifth of the green out of every neutral pixel —
      white comes out (255,204,255) — which is why unmix replaced it.
      --trim-holds (default on) drops the closing frames that have frozen
      back onto the first frame, and the opening frames that have not moved
      yet (keeping the last frame of the freeze).
      --seam-fill auto (default) interpolates in-betweens into the wrap from
      the last frame back to the first — the one transition the model never
      drew — when the seam is worth more than ${SEAM_STEP_LIMIT} normal steps AND more than
      the ${SEAM_FLOOR} noise floor: ${MAX_AUTO_SEAM_FILL} at most,
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
      median frame-to-frame change) and maxStep, all as the mean difference
      of premultiplied RGBA thumbnails, so a blink at the wrap counts; and
      seamLimit, the bar the seam was judged against: max(${SEAM_STEP_LIMIT} x step, ${SEAM_FLOOR}).
      Writes <motionDir>/inspect.json in the loop shape.

  transition <clip> --character <dir> --from <loopId> --to <loopId>
      [--out <motionDir>] [--name <id>] [--duration s]
      [--trim-start s] [--trim-end s] [--key alpha|auto|#rrggbb] [--keyer unmix|colorkey]
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

  mirror <character>/motions/<of> --name <id> [--out <character>/motions/<id>] [--force]
      The other side of a side view, free: <of>'s REGISTERED frames flipped
      left to right (a lossless pixel reorder), then pack -> gif (+webp) ->
      inspect exactly as 'run' finishes a sheet — same fps, loop, anchor,
      scale and columns as <of>'s atlas. The anchor x becomes cell width - x
      (align.json and the atlas pivot); <of>'s pre-align cells are flipped
      beside the frames when it kept them. <of> must be a ready sprite motion
      facing left or right, not a loop, a transition or itself a mirror.
      Refused when character.asymmetric is set — the sentence is said back,
      because a flip moves exactly that to the wrong side — unless --force,
      which keeps the sentence in the warnings and says force: true in the
      summary (register-run refuses an asymmetric mirror without it). --out
      defaults to <character>/motions/<id>. --json is what register-run
      takes (source: "mirror", mirrorOf).

  lineup <characterDir> [--hub <loopId>] [--out <png>]
      Look before spending: every ready loop's frame 0 beside the hub's, at
      their clips' scale and placed in clip coordinates on one baseline,
      written to <character>/lineup.png (labelled with the motion ids). The
      JSON gives, per loop, its clip scale (recorded or measured), its poseGap
      to the hub (alpha IoU in clip coordinates and the mean colour difference
      inside the union), the frame of the loop closest to the hub pose, the
      transitions already registered for the pair, and a suggestion — direct
      or transition — with the threshold it used.

  export <motionDir> --format mp4|mov|webm|apng|lottie|png-seq|aseprite
      [--bg #rrggbb] [--repeat N] [--scale N] [--shadow [shadow flags]]
  export <characterDir> --format aseprite [--scale N] [--shadow [shadow flags]]
      One READY motion (status in project.json, frames as registered) in a
      format somebody else's tool reads. Written to
      <motionDir>/exports/<id>.<ext> (png-seq: <id>-frames.zip, aseprite:
      <id>-aseprite.zip), encoded to a scratch file and renamed only after it
      checks out.
        mp4      H.264 yuv420p, flattened onto --bg (default ${DEFAULT_EXPORT_BG}).
        mov      ProRes 4444 with alpha, for editing software.
        webm     VP9 with alpha.
        apng     every frame once; loops forever when the motion loops.
        lottie   the loop writer's raster image sequence.
        png-seq  a stored zip of the frames plus animation.json (fps, loop,
                 pivot, anchorPoint, per-frame file and duration).
        aseprite a stored zip of <id>.png (the motion's packed sheet, byte for
                 byte) and <id>.json in Aseprite's JSON-hash shape: frames
                 keyed "0"…"N-1", each with its rect, its duration (ms) and
                 its anchor; meta.frameTags names the motion — what Phaser's
                 load.aseprite + anims.createFromAseprite read. A sprite
                 motion only: a loop has no sheet.
      Given the CHARACTER directory, aseprite puts every ready sprite motion
      on one sheet (their packed sheets stacked, rects offset), a frame tag
      each, as <characterDir>/exports/<character>-aseprite.zip; loops,
      transitions and unfinished motions are left out and listed (excluded).
      A sprite motion plays its aligned frames at the ATLAS fps and pivot; a
      loop plays its frames at its own fps.
      --shadow casts a ground shadow from the silhouette about the foot (the
      atlas pivot; a loop's first frame's feet): into the frames of mp4 / mov
      / webm, whose canvas grows to hold it; beside an aseprite export as a
      sheet of its own (<id>-shadow.png/.json, tags <motion>-shadow, each frame
      anchored on the same foot). Ignored, and said, on other formats.
      Tune it with --shadow-squash (${SHADOW_DEFAULTS.squash}, ${SHADOW_RANGES.squash.join("–")}),
      --shadow-shear (${SHADOW_DEFAULTS.shear}, ${SHADOW_RANGES.shear.join("–")}; positive falls left; a
      negative value is written --shadow-shear=-0.5), --shadow-opacity
      (${SHADOW_DEFAULTS.opacity}), --shadow-blur (${SHADOW_DEFAULTS.blur} px) and --shadow-color (#${SHADOW_DEFAULTS.color.map((c) => c.toString(16).padStart(2, "0")).join("")}).
      --repeat N (video only) plays the motion N times. Default: a looping
      motion repeats until the clip lasts at least ${EXPORT_MIN_SECONDS} s, a one-shot plays
      once; the report says which (repeatDefaulted).
      --scale N is an integer, default 1, always nearest-neighbour.
      Video sides are padded to even with transparency (right and bottom).
      Every video is probed after encoding — codec, alpha where claimed,
      frame count = frames x repeat, duration — and refused if it is not.
      --bg on mov/webm/apng/lottie/png-seq/aseprite and --repeat on a frame
      animation are reported as ignored, never applied.
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
      enlarged. --filter auto (default) downscales nearest-neighbour for a
      pixel-art character (character.pixel, else character.style says so),
      smooth otherwise.
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
      webp-lossless keeps every visible pixel exact and is the default for a
      pixel-art character (the reading --filter auto uses); png
      embeds PNG. Every Rive runtime decodes all three. With no --images and an
      ffmpeg without libwebp, the frames go in as PNG and the report warns; a
      WebP format asked for by name on such an ffmpeg is refused.

  fit <image> --out <png> [--max ${DEFAULT_FIT_MAX}] [--pad ${DEFAULT_FIT_PAD}] [--threshold ${DEFAULT_THRESHOLD}]
      The still a breathe is made from, at the size it plays: a cut-out
      (transparent background) trimmed to the character plus --pad px, with
      the character's larger side brought down to --max px (area-averaged in
      premultiplied alpha, so the removed background cannot bleed into the
      edge). Never enlarges. Specks the background remover left clear of the
      body are dropped first, as 'run' cleans a cell. Pixel art (the nearest
      character's pixel spec or style, as 'breathe' reads it) is trimmed only,
      never resampled. An image with no transparent background is refused —
      cut it out first. --out may be the input. Reports the size, the box it
      kept (in the input's pixels), the scale, and a warning when the
      character touches an edge of the image (part of it may be cut off).

  breathe <still> --out <framesDir> [--frames N] [--depth ${DEFAULT_BREATHE_DEPTH}] [--breaths 1]
      [--mode smooth|pixel] [--rigid-row y] [--axis x] [--torso halfWidth]
  breathe <still> --out <motionDir> --name <motionId> [--fps ${BREATHE_FPS}] [--pad ${DEFAULT_PAD}]
      [--width W] [--no-webp] [the flags above]
      A breathing idle from ONE still, no model call: the body below the neck
      swells and settles on a travelling wave, the head rides on top as one
      rigid block, the soles never move, and whatever reaches far past the
      torso (an arm, a wing, a held lantern) is pushed, not stretched.
      Writes <framesDir>/NN.png — --frames (default ${FRAMES_PER_BREATH} x --breaths) frames
      holding --breaths whole breaths — on the still's canvas, grown only as
      far as the stretch needs (canvas.grew). The frames then go through
      align (--x-from cell keeps them where they stand), pack, gif and
      inspect like any other.
      --depth is the total stretch as a share of the body below the neck.
      --mode pixel moves whole pixels (rows duplicated or dropped, columns
      remapped, the dark outline thinned back to 1px): pixel art stays on its
      grid. --mode smooth resamples the same field continuously in
      premultiplied alpha for anti-aliased art, and moves the head by whole
      pixels so it stays identical to the still. Without --mode the
      character decides (character.pixel, else its style: pixel art → pixel,
      anything else → smooth), from the nearest project.json above --out,
      the still or the working directory; with no character it is required.
      The anatomy is detected and printed so you can check it against the
      still: body axis x, neck y, the rigid row y (nothing above it deforms),
      a face if a symmetric eye pair was found, the torso half-width and
      whether something reaches sideways. Override in the still's pixel
      coordinates: --rigid-row y, --axis x, --torso halfWidth.
      Reports per frame its solid height, head offset (negative = up) and
      how many head pixels differ from the still (0 = identical).
      With --name it is the whole motion in one command, the way 'run' is for
      a sheet: --out is the MOTION directory, the bake lands in
      <motionDir>/cells (cropped to what the frames reach, plus --pad), and
      align (--x-from cell), pack, gif (+webp) and inspect follow at --fps
      (default ${BREATHE_FPS}; ${FRAMES_PER_BREATH} frames a breath is 1.5 s). The JSON is the run
      summary 'sprite-project.mjs register-run' takes: a sprite run plus
      source "breathe", still (the path breathed) and breathe { depth,
      breaths, lag, mode, anatomy: { rigidRow, axisX, from, torsoHalf? } }
      — the record a re-run with one parameter changed starts from. The
      detector's warnings that ask for a decision (a prop across the rigid
      row, pixel mode on anti-aliased art, too few frames a breath) join
      inspect.warnings, where the stage shows them.

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
  return {
    bbox,
    coverage,
    feetX: bbox ? feetCenterX(image, bbox, threshold) : null,
    // The whole body's mass: what `--x-from trend` fits its drift line to.
    massX: bbox ? massCenterX(image, bbox, threshold) : null,
    // The head-and-torso band, as column profiles: what `inspect` registers
    // frame against frame for `headDrift`, on the frames and on their cells.
    head: bbox ? headProfile(image, bbox, { threshold }) : null,
  };
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
// Keying — which keyer runs, the plate it runs on, and what it left behind
// ---------------------------------------------------------------------------

/**
 * The keyer that actually runs. `unmix` needs a plate with a hue to lean on;
 * `plate` is what a raw frame (or the colour `--key` names) says the plate
 * is, and a white, cream or grey one is keyed with `colorkey` instead — said
 * on stderr, and in the report's `keyer`, never silently. A border with no
 * opaque pixel to measure (null) is keyed with `colorkey` too.
 */
function resolveKeyer(requested, plate, label) {
  if (requested !== "unmix") return "colorkey";
  if (plate?.chroma) return "unmix";
  console.error(plate
    ? `${label}: the plate ${plate.hex} has no hue to un-mix — keyed with colorkey`
    : `${label}: no opaque border pixel to measure the plate on — keyed with colorkey`);
  return "colorkey";
}

/** The plate `--key` (`key --color`) names: measured over `frames` (a clip's
 *  spread, or the one sheet) when it says auto, taken at its word when it is
 *  a colour. */
function keyPlate(frames, key, similarity, flag = "--key") {
  return key === "auto"
    ? measurePlate(frames, { key: "auto", radius: keyRadius(similarity) })
    : plateOf(normalizeColor(key, flag));
}

/** `count` indices spread evenly over `0..total-1`, both ends included. */
function spreadIndices(total, count) {
  if (total <= count) return Array.from({ length: total }, (_, i) => i);
  return Array.from({ length: count }, (_, k) => Math.round((k * (total - 1)) / (count - 1)));
}

/**
 * `keyResidue` pooled over frames, as the numbers a report carries: the
 * visible share (the one judged) and the partially transparent share. Null
 * when there is no key colour or it has no hue — absent, never a 0.
 */
function residueOf(counts) {
  const pooled = poolResidue(counts);
  return pooled
    ? { keyResidue: round(pooled.visible, 4), keyResidueEdge: round(pooled.edge, 4), keyFringe: round(pooled.fringe, 4) }
    : null;
}

function residueWarning(residue, hex) {
  if (!residue) return null;
  if (residue.keyResidue > KEY_RESIDUE_WARN) {
    return `keyResidue ${residue.keyResidue}: ${(residue.keyResidue * 100).toFixed(1)}% of the visible pixels still carry the plate (${hex}) — its hue, or a fringe of it at the edge; a fringe the key left, a shadow on the floor, or colour the character really has. Look at an edge and under the feet at 4x on a dark background; a --keyer colorkey cut leaves a fringe, --keyer unmix takes it out`;
  }
  if (residue.keyFringe > KEY_FRINGE_WARN) {
    return `keyFringe ${residue.keyFringe}: ${(residue.keyFringe * 100).toFixed(1)}% of the edge is the character still blended with the plate (${hex}) at full opacity — a yellow-green rim on warm colours, a teal one on blue. Look at an edge at 4x on a dark background; --keyer unmix reads each edge pixel against the colour beside it and takes it out, a wider --similarity does not`;
  }
  return null;
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
    if (FRAME_RE.test(name) || name === ALIGN_RECORD || name === SLICE_RECORD || name === BREATHE_RECORD) unlinkSync(join(dir, name));
  }
}

/**
 * The grid a cells directory was sliced from, or null when nothing sliced it
 * (a clip's samples, cells cut by hand). Same discipline as `readAlignRecord`:
 * absent is an answer, a record that is there and unreadable is an error.
 */
function readSliceRecord(cellsDir) {
  const path = join(resolve(cellsDir), SLICE_RECORD);
  if (!existsSync(path)) return null;
  let doc;
  try {
    doc = JSON.parse(readFileSync(path, "utf-8"));
  } catch (error) {
    fail(`${path} is not valid JSON (${error.message}) — delete it or re-run slice`);
  }
  const whole = (v) => Number.isInteger(v) && v >= 1;
  if (!doc || !whole(doc.rows) || !whole(doc.cols)) {
    fail(`${path} is not a slice record (needs whole rows and cols) — delete it or re-run slice`);
  }
  return { rows: doc.rows, cols: doc.cols };
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

function stepKey(input, { out, color, similarity, blend, threshold, keyer: requested = DEFAULT_KEYER }) {
  const source = readRgba(resolve(input));
  const colorkeyColor = color === "auto" ? cornerColor(source) : normalizeColor(color, "--color");
  const plate = requested === "unmix" ? keyPlate([source], color, similarity, "--color") : null;
  const keyer = resolveKeyer(requested, plate, "key");
  let output;
  let keyed;
  let resolved;
  if (keyer === "unmix") {
    keyed = source;
    keyFrame(keyed, plate, { radius: keyRadius(similarity) });
    zeroKeyedRgb(keyed, threshold);
    output = writeRgbaPng(out, keyed, "key");
    resolved = plate.hex;
  } else {
    output = ffmpegTo(out, () => [
      "-i", resolve(input),
      "-vf", `colorkey=${colorkeyColor}:${similarity}:${blend},format=rgba`,
      "-frames:v", "1", "-pix_fmt", "rgba",
    ], "key");
    // The keyed sheet is what `slice`, `align` and `pack` all copy pixels from,
    // so the plate has to go here — at the one point where it is created — not
    // at each of the places it would otherwise resurface. This costs no extra
    // decode: the coverage this step reports is measured on the same buffer.
    keyed = readRgba(output);
    if (zeroKeyedRgb(keyed, threshold)) writeRgbaPng(output, keyed, "key");
    resolved = colorkeyColor;
  }
  const { coverage } = computeBbox(keyed, threshold);
  const residue = residueOf([keyResidue(keyed, plateOf(resolved), threshold)]);
  const warning = residueWarning(residue, resolved);
  return {
    input: resolve(input),
    output,
    color: resolved,
    keyer,
    similarity,
    // colorkey's softness; the un-mixing keyer has none to report.
    ...(keyer === "colorkey" ? { blend } : {}),
    width: keyed.width,
    height: keyed.height,
    alphaCoverage: round(coverage, 4),
    ...(residue ?? {}),
    warnings: warning ? [warning] : [],
  };
}

/**
 * Which way the character faces, for a wide room's lead and trail: `--facing`
 * when given, else `sprite.character.facing` from the nearest character
 * project.json above the input (a frame or a ref lives a few directories
 * below it), else right. The report says which, so a room built on the
 * default is never mistaken for one built on the character.
 */
function flattenFacing(input, given) {
  if (given) return { facing: given, facingFrom: "flag" };
  let dir = dirname(resolve(input));
  for (let depth = 0; depth < 5; depth++) {
    const path = join(dir, "project.json");
    if (existsSync(path)) {
      let doc = null;
      try {
        doc = JSON.parse(readFileSync(path, "utf-8"));
      } catch (error) {
        fail(`flatten: ${path} is not valid JSON (${error.message}) — pass --facing left|right`);
      }
      const facing = doc?.sprite?.character?.facing;
      if (doc?.sprite) {
        return facing === "left" || facing === "right"
          ? { facing, facingFrom: path }
          : { facing: "right", facingFrom: "default" };
      }
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return { facing: "right", facingFrom: "default" };
}

/**
 * Composite onto a solid colour — and first, say which of the subject's own
 * pixels that colour would take with it. A frame flattened onto a chroma
 * plate comes back from the video model to be keyed at the video radius, and
 * every subject pixel inside that radius goes with the plate, wherever it
 * sits: a green gem on green, a white collar on a white plate. Measured on the
 * subject before the plate is painted, when the alpha still says which pixel
 * is which. An image with no transparency has no subject to tell apart, so it
 * is not judged.
 *
 * With `room`, the picture is padded into the canvas its motion needs before
 * it is painted. An image-to-video model keeps the input's framing (Seedance:
 * 416×506 in, 588×716 out, `--aspect-ratio` refused on i2v), so a jump or a
 * swing that leaves the first frame's frame is clipped whatever the prompt
 * says; the room has to be in the still. The still is never scaled and stands
 * on the canvas's bottom edge (see `canvas.mjs`). The plate check reads the
 * picture itself, so the room around it changes nothing there.
 */
function stepFlatten(input, { out, bg, similarity, threshold, room = null, headroom, lead, trail, facing: givenFacing }) {
  const color = normalizeColor(bg, "--bg");
  const source = resolve(input);
  const image = readRgba(source);
  const size = { width: image.width, height: image.height };
  const alpha = hasAlpha(image);
  const warnings = [];
  let plateCheck = null;
  if (alpha) {
    const radius = keyRadius(similarity);
    const near = plateProximity(image, plateOf(color).painted, { radius, threshold });
    plateCheck = {
      radius: round(radius, 1),
      subjectPixels: near.subject,
      within: near.within,
      fraction: round(near.fraction, 4),
      minDistance: near.minDistance === null ? null : round(near.minDistance, 1),
      nearest: near.nearest,
    };
    if (near.within > 0) {
      warnings.push(`${near.within} subject px (${(near.fraction * 100).toFixed(2)}%) sit within the key radius of ${color} (${round(radius, 1)}; nearest ${near.nearest}, ${round(near.minDistance, 1)} away) — keying the clip will cut them out with the plate. Flatten onto a plate further from the character's colours`);
    }
  }
  let placed = null;
  let facing = null;
  if (room) {
    facing = flattenFacing(source, givenFacing);
    try {
      placed = roomCanvas(size, { room, headroom, lead, trail, facing: facing.facing });
    } catch (error) {
      fail(`flatten: ${error.message}`);
    }
    // Padding an opaque picture paints --bg around a background of its own:
    // the model is then handed a rectangle, not a character on a plate.
    if (!alpha) {
      warnings.push(`${basename(source)} has no transparency — the room is painted ${color} around its own background; flatten a cut-out (an existing motion's frames/00.png) instead`);
    }
  }
  const canvas = placed ? placed.canvas : size;
  const offset = placed ? placed.offset : { x: 0, y: 0 };
  const output = ffmpegTo(out, () => [
    "-i", source,
    "-f", "lavfi", "-i", `color=c=${color}:s=${canvas.width}x${canvas.height}`,
    "-filter_complex", `[1:v][0:v]overlay=${offset.x}:${offset.y}:format=auto,format=rgb24`,
    "-frames:v", "1",
  ], "flatten");
  return {
    input: source,
    output,
    bg: color,
    width: canvas.width,
    height: canvas.height,
    ...(plateCheck ? { plateCheck } : {}),
    ...(placed ? {
      room: {
        shape: placed.room,
        still: size,
        offset: placed.offset,
        headroom: placed.headroom,
        lead: placed.lead,
        trail: placed.trail,
        facing: placed.facing,
        facingFrom: facing.facingFrom,
      },
    } : {}),
    warnings,
  };
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
  // The grid travels with its cells: a sheet model that draws each row as its
  // own little sequence jumps where one row hands over to the next, and only
  // this step knows where those boundaries are.
  const record = writeJsonFile(join(dir, SLICE_RECORD), {
    rows, cols, cell: { width: cellW, height: cellH }, margin, gutter,
  });
  return {
    sheet: input,
    outDir: dir,
    rows, cols, margin, gutter,
    cell: { width: cellW, height: cellH },
    sliceRecord: record,
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
  if (!inPlace) {
    resetFramesDir(outDir);
    // Cleaned cells are still the grid's cells (or the breathe's frames):
    // the record of what made them goes with them.
    for (const name of [SLICE_RECORD, BREATHE_RECORD]) {
      const record = join(inDir, name);
      if (existsSync(record)) copyFileSync(record, join(outDir, name));
    }
  }

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

/**
 * Snap a directory of frames (cells) onto their pixel lattice — see
 * `pixel-lattice.mjs` for the method and its provenance.
 *
 * Every frame lands on ONE canvas of logical pixels, at the logical position
 * it sat at in its cell (so `align --x-from cell` still means something), and
 * is upscaled by the whole number `scale`. The palette is pinned: an existing
 * `palette` file is used as it is and only `repalette` rebuilds it.
 *
 * `images` may be passed by a caller that already holds the decoded frames
 * (`run`), in the order of the directory's frames. Returns the step's JSON plus
 * `measures` of the written frames, for an `align` that follows.
 */
function stepPixel(framesDir, {
  out, palette, repalette, paletteSize, scale, pitchHint, outline, outlineStrength, detailBias, threshold, images: given,
  logicalHeight = null,
}) {
  const inDir = resolve(framesDir);
  const outDir = resolve(out);
  if (inDir === outDir) {
    fail(`pixel: --out ${outDir} is the input directory — the frames there are what a re-run snaps again, so write the lattice frames somewhere else`);
  }
  const entries = listFrames(inDir);
  const images = given ?? entries.map((entry) => readRgba(entry.path));
  if (images.length !== entries.length) fail("internal: pixel image count does not match frame count");

  let lattice = latticeFrames(images, { detailBias, pitchHint });
  if (!lattice.nonEmpty) fail(`pixel: every frame in ${inDir} is empty`);
  // A generation is cut on its frames' agreement; when fewer than half of
  // them read a grid at all, that agreement is one or two frames' opinion.
  // Measured on a real GPT-Image walk: 1 of 8 frames read 4.00 for 8 px
  // blocks, and cutting on it made every frame twice too fine. Refuse and
  // say what the frames suggest — the block size is a thing a person (or the
  // agent) confirms by looking, and --pitch-hint is how it is said.
  // A declared height (character.pixel.logicalHeight, --logical-height) can
  // stand in for that look: the pitch that makes these frames that tall,
  // taken only when the frames' own loose readings back it (`heightPitch`).
  const thin = pitchHint === null && lattice.confident * 2 < lattice.nonEmpty;
  const byHeight = thin && logicalHeight ? heightPitch(lattice, logicalHeight) : null;
  const heightNotes = [];
  if (byHeight?.backed) {
    const said = byHeight.readings.map((r) => `${r.what} ${r.pitch.toFixed(1)}`).join(", ");
    heightNotes.push(`pitch detection was inconclusive (${lattice.confident} of ${lattice.nonEmpty} frames read a grid) — cut at ${byHeight.pitch.toFixed(2)} px, the block size at which these frames (${byHeight.source} px tall) are the declared ${logicalHeight} logical px; the frames' own readings back it (${said}). If the blocks are not about that wide at 8x, pass --pitch-hint N`);
    lattice = latticeFrames(images, { detailBias, pitchHint: byHeight.pitch, hintLabel: `the declared height's pitch ${byHeight.pitch.toFixed(2)}` });
  } else if (thin) {
    const readings = lattice.frames
      .filter((f) => f.own && Math.min(f.own.x, f.own.y) >= 2)
      .slice(0, 3)
      .map((f) => `frame ${frameName(f.index).slice(0, -4)}: ${f.own.x.toFixed(2)}x${f.own.y.toFixed(2)}`);
    const { pooled, runlen } = lattice;
    const suggest = [
      pooled && pooled.pitch >= 2 ? `together the frames score best at ${pooled.pitch} px (${pooled.score.toFixed(3)}; one frame needs 0.2)` : null,
      Math.min(runlen.x, runlen.y) >= 2 ? `same-colour runs measure ${runlen.x.toFixed(1)}x${runlen.y.toFixed(1)} px (they read short at soft edges)` : null,
    ].filter(Boolean);
    const declared = byHeight
      ? ` The declared height (${logicalHeight} logical px) would mean ${byHeight.pitch.toFixed(2)} px blocks for frames ${byHeight.source} px tall, which the frames do not back — the sheet was probably drawn at another height.`
      : "";
    fail(`pixel: only ${lattice.confident} of ${lattice.nonEmpty} frames in ${inDir} read a pixel grid on their own${readings.length ? ` (${readings.join("; ")})` : ""} — too few to cut a whole generation on.${suggest.length ? ` ${suggest.join("; ")}.` : ""}${declared} Look at a frame at 8x and pass --pitch-hint N, the block width in source pixels (or this is not pixel art)`);
  }
  // A lattice the frames' own evidence contradicts is not cut as it is. With a
  // declared height, a snap 1.5x or more off it is a divisor or a multiple of
  // the blocks: cut at the height's pitch when the frames' readings back it,
  // refuse when they do not. Without one, a consensus the same-colour runs
  // call a divisor has nothing to choose the multiple by: refuse.
  let switched = false;
  if (pitchHint === null && !byHeight?.backed) {
    const first = logicalHeight ? heightCheck(lattice.frames, logicalHeight) : null;
    const off = first ? Math.max(first.measured / logicalHeight, logicalHeight / first.measured) : 1;
    const measuredAt = `${lattice.consensus.x.toFixed(2)}x${lattice.consensus.y.toFixed(2)}`;
    const runs = `${lattice.runlen.x.toFixed(1)}x${lattice.runlen.y.toFixed(1)}`;
    if (off >= HEIGHT_MISMATCH_RATIO) {
      const implied = heightPitch(lattice, logicalHeight);
      const said = implied.readings.map((r) => `${r.what} ${r.pitch.toFixed(1)}`).join(", ") || "none";
      if (!implied.backed) {
        fail(`pixel: cut at the pitch the frames read (${measuredAt} px), these frames come out ${first.measured} logical px tall — ${off.toFixed(1)}x the declared ${logicalHeight} — and the pitch that would make them ${logicalHeight} tall (${implied.pitch.toFixed(2)} px for ${implied.source} px) is not what their own readings say (${said}). Nothing was written. Look at a frame at 8x: pass --pitch-hint N with the block width in source pixels, or declare the height the sheet was drawn at (sprite-project.mjs set-character --pixel H)`);
      }
      heightNotes.push(`the pitch the frames read (${measuredAt} px) made them ${first.measured} logical px tall, ${off.toFixed(1)}x the declared ${logicalHeight} — a divisor or a multiple of the blocks; cut at ${implied.pitch.toFixed(2)} px instead, the block size at which these frames (${implied.source} px tall) are the declared height, which their own readings back (${said}). If the blocks are not about that wide at 8x, pass --pitch-hint N`);
      lattice = latticeFrames(images, { detailBias, pitchHint: implied.pitch, hintLabel: `the declared height's pitch ${implied.pitch.toFixed(2)}` });
      switched = true;
    } else if (!logicalHeight && (lattice.divisorSuspect.x || lattice.divisorSuspect.y)) {
      fail(`pixel: most frames read a ${measuredAt} px grid, but same-colour runs measure ${runs} px — the reading is a divisor of the real block size, and nothing says which multiple (no --pitch-hint, no declared height). Nothing was written. Look at a frame at 8x and pass --pitch-hint N (the runs suggest about ${Math.round((lattice.runlen.x + lattice.runlen.y) / 2)}), or declare the figure's height in logical pixels (--logical-height H, or sprite-project.mjs set-character --pixel H)`);
    }
  }
  const { consensus } = lattice;
  const warnings = [...heightNotes, ...lattice.warnings];
  // The height the frames came out at, against the declared one. The lattice
  // never cuts a drawing to a height it was not drawn at — that merges blocks
  // — so a miss is said with the numbers to act on.
  const height = logicalHeight ? heightCheck(lattice.frames, logicalHeight) : null;
  if (height && !height.honoured) {
    const implied = heightPitch(lattice, logicalHeight);
    warnings.push(`logical height: these frames snap to ${height.measured} logical px tall (${height.range[0]}–${height.range[1]}) at pitch ${consensus.x.toFixed(2)}x${consensus.y.toFixed(2)}, and the character is declared ${logicalHeight}. The lattice keeps the blocks the sheet was drawn with — cutting ${logicalHeight} rows out of ${implied.source} px would merge them. Regenerate the sheet with the figure ${logicalHeight} blocks tall; pass --pitch-hint ${implied.pitch.toFixed(1)} only if its blocks really are that wide at 8x; or, if ${height.measured} is right, declare it (sprite-project.mjs set-character --pixel ${height.measured}) so later motions are held to it`);
  }
  const heightRecord = height
    ? { ...height, pitchFrom: pitchHint !== null ? "hint" : byHeight?.backed || switched ? "height" : "measured" }
    : null;

  // One palette for every frame, pinned to disk. A file that is there wins
  // over whatever these frames would build — that is what pinning means — and
  // one that is there but unreadable stops the step rather than being
  // silently replaced.
  const paletteFile = resolve(palette);
  let pinned = null;
  if (!repalette) {
    try {
      pinned = loadPalette(paletteFile);
    } catch (error) {
      fail(`pixel: --palette ${error.message}`);
    }
  }
  const logicals = lattice.frames.map((f) => f.logical).filter(Boolean);
  const colors = pinned ? pinned.colors : buildSharedPalette(logicals, paletteSize);
  if (!pinned) writePalette(paletteFile, colors, `built from ${logicals.length} frame(s) of ${inDir}`);
  if (pinned) {
    // How far this generation's colours sit from the pinned ones, before
    // they are mapped: a large gap is a palette pinned for other art.
    let far = 0;
    const seen = new Set();
    for (const image of logicals) {
      const { data } = image;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] !== 255) continue;
        const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
        if (seen.has(key)) continue;
        seen.add(key);
        let best = Infinity;
        for (const c of colors) best = Math.min(best, (c[0] - data[i]) ** 2 + (c[1] - data[i + 1]) ** 2 + (c[2] - data[i + 2]) ** 2);
        if (Math.sqrt(best) > PALETTE_FAR) far++;
      }
    }
    if (far) {
      warnings.push(`${far} colour(s) of these frames are more than ${PALETTE_FAR} from every colour of the pinned palette ${paletteFile} — they are recoloured to the nearest one; --repalette rebuilds the palette from these frames`);
    }
  }
  for (const image of logicals) {
    applyPalette(image, colors);
    if (outline) enforceOutline(image, outlineStrength);
  }

  // The canvas: every frame's logical sprite where it sat in its cell. The
  // cell measured in logical pixels at the consensus pitch, grown to whatever
  // a frame needs — a frame is never clipped to make the canvas tidy.
  const cellW = Math.max(...images.map((image) => image.width));
  const cellH = Math.max(...images.map((image) => image.height));
  const placed = lattice.frames.map((f) => (f.logical
    ? { x: Math.round(f.box.x / f.pitch.x), y: Math.round(f.box.y / f.pitch.y) }
    : null));
  let logicalW = Math.max(1, Math.round(cellW / consensus.x));
  let logicalH = Math.max(1, Math.round(cellH / consensus.y));
  for (const [i, f] of lattice.frames.entries()) {
    if (!f.logical) continue;
    logicalW = Math.max(logicalW, placed[i].x + f.logical.width);
    logicalH = Math.max(logicalH, placed[i].y + f.logical.height);
  }

  resetFramesDir(outDir);
  const frames = [];
  const measures = [];
  for (const [i, entry] of entries.entries()) {
    const f = lattice.frames[i];
    const canvas = blankImage(logicalW, logicalH);
    if (f.logical) pasteImage(canvas, f.logical, placed[i].x, placed[i].y);
    const image = upscale(canvas, scale);
    const target = join(outDir, basename(entry.path));
    writeRgbaPng(target, image, `pixel frame ${i}`);
    frames.push(target);
    measures.push(measureFrame(image, threshold));
  }

  const round3 = (v) => round(v, 3);
  const pitchOf = (p) => (p ? { x: round3(p.x), y: round3(p.y) } : null);
  const perFrame = lattice.frames.map((f, i) => ({
    index: f.index,
    source: f.source,
    own: pitchOf(f.own && Math.min(f.own.x, f.own.y) >= 2 ? f.own : null),
    pitch: pitchOf(f.pitch),
    ...(f.logical ? { logical: { width: f.logical.width, height: f.logical.height }, at: placed[i] } : {}),
  }));
  const paletteReport = {
    file: paletteFile,
    colors: colors.length,
    pinned: Boolean(pinned),
  };
  const record = writeJsonFile(join(outDir, PIXEL_RECORD), {
    kind: "pneuma-sprite-pixel",
    version: 1,
    source: inDir,
    scale,
    pitch: pitchOf(consensus),
    runlen: pitchOf(lattice.runlen),
    logicalCell: { width: logicalW, height: logicalH },
    cell: { width: logicalW * scale, height: logicalH * scale },
    palette: paletteReport,
    detailBias,
    outline: outline ? outlineStrength : null,
    ...(heightRecord ? { logicalHeight: heightRecord } : {}),
    frames: perFrame,
    warnings,
  });

  return {
    inDir,
    outDir,
    scale,
    pitch: pitchOf(consensus),
    logicalCell: { width: logicalW, height: logicalH },
    cell: { width: logicalW * scale, height: logicalH * scale },
    palette: paletteReport,
    outline: outline ? outlineStrength : null,
    ...(heightRecord ? { logicalHeight: heightRecord } : {}),
    frames,
    perFrame,
    record,
    measures,
    warnings,
  };
}

/**
 * The lattice facts `pixel` left next to these frames — its own record, or
 * the copy `align` carried into its record — or null when these frames never
 * went through `pixel`. As with the align record, absent is legitimate and
 * malformed is an error.
 */
function readPixelRecord(framesDir) {
  const path = join(resolve(framesDir), PIXEL_RECORD);
  if (!existsSync(path)) return null;
  let doc;
  try {
    doc = JSON.parse(readFileSync(path, "utf-8"));
  } catch (error) {
    fail(`${path} is not valid JSON (${error.message}) — delete it or re-run pixel`);
  }
  return pixelFacts(doc, path);
}

/** The part of a pixel record `align` and `inspect` rely on, validated. */
function pixelFacts(doc, where) {
  const finite = (v) => typeof v === "number" && Number.isFinite(v);
  const ok = doc && Number.isInteger(doc.scale) && doc.scale >= 1
    && finite(doc.pitch?.x) && finite(doc.pitch?.y);
  if (!ok) fail(`${where} is not a pixel record (needs a whole-number scale and a pitch) — delete it or re-run pixel`);
  // `pixel.json` carries the palette as { file, … }; the copy in align.json
  // is these facts themselves, palette as a path. Both read the same.
  const palette = typeof doc.palette === "string" ? doc.palette
    : typeof doc.palette?.file === "string" ? doc.palette.file : null;
  return {
    scale: doc.scale,
    pitch: { x: doc.pitch.x, y: doc.pitch.y },
    palette,
    outline: finite(doc.outline) ? doc.outline : null,
  };
}

// --- recolor: colourways of a pixel-art character ---------------------------
//
// The swap itself, its report and its rules live in `recolor.mjs`; this is
// the part that reads frames and writes files. Each colourway of a motion
// lands in `motions/<id>/variants/<name>/`: its frames, then the sheet, atlas
// and preview made from them by the same `pack` and `gif` the motion's run
// used — so the atlas is the motion's own, byte for byte, but for the image.
// `sprite-project.mjs register-recolor` records what was made.

/** Why recolor is offered for pixel art only, said whenever it is refused. */
const RECOLOR_PIXEL_ONLY = "recolor swaps exact colours, which works on art made of a few exact colours — a pixel-art character quantised to its one pinned palette. Painted, anti-aliased art is not: each frame of the seed character Lumi carries about 250 colours, and the 64 most used cover 53–55 % of its visible pixels, so a map would leave most edges in the old colours";

/** A refusal `recolor.mjs` phrased, turned into this script's own. */
function recolorRule(fn) {
  try {
    return fn();
  } catch (error) {
    if (error instanceof RecolorError) fail(error.message);
    throw error;
  }
}

/**
 * What a recolor works on — a character directory, or one of its
 * `motions/<id>` — with its pinned palette; refused, saying why, for a
 * character that is not pixel art or has nothing pinned yet.
 */
function recolorSubject(target, label) {
  const dir = resolve(target);
  const isCharacter = existsSync(join(dir, "project.json"));
  if (!isCharacter && basename(dirname(dir)) !== "motions") {
    fail(`${label}: ${dir} is neither a character directory nor one of its motions/<id>`);
  }
  const character = readCharacterProject(isCharacter ? dir : dirname(dirname(dir)), label);
  const pixel = character.doc.sprite.character?.pixel;
  if (!pixel || !(Number(pixel.logicalHeight) > 0)) {
    fail(`${label}: ${character.name} is not pixel art (no character.pixel) — ${RECOLOR_PIXEL_ONLY}. Pixel art is declared with sprite-project.mjs set-character --pixel <height> and made with run --pixel`);
  }
  const paletteFile = typeof pixel.palette === "string" ? assetFile(character, pixel.palette) : null;
  if (!paletteFile) {
    fail(`${label}: ${character.name} has no pinned palette yet — ${RECOLOR_PIXEL_ONLY}. Make a motion with run --pixel and register it (register-run pins the palette), then recolor`);
  }
  let palette;
  try {
    palette = loadPalette(paletteFile);
  } catch (error) {
    fail(`${label}: the pinned palette ${error.message}`);
  }
  if (!palette) fail(`${label}: the pinned palette ${pixel.palette} (${paletteFile}) is not on disk — restore it`);
  return { character, pixel, palette, motionId: isCharacter ? null : basename(dir) };
}

/**
 * The motions a recolor covers: the one named, which must be a ready sprite
 * motion with its sheet; or every such motion of the character, the others
 * listed with the reason they were left out.
 */
function recolorMotions(character, motionId, label) {
  const motions = character.doc.sprite.motions.filter((m) => m && typeof m.id === "string");
  const leftOut = (m) => (m.kind === "loop" || m.kind === "transition"
    ? `a ${m.kind} — cut from a clip, never snapped to the palette or packed on a sheet`
    : m.status !== "ready"
      ? `not ready (${m.status ?? "no status"})`
      : !m.sheet || !m.atlas ? "no packed sheet and atlas registered" : null);
  if (motionId !== null) {
    const motion = motions.find((m) => m.id === motionId);
    if (!motion) fail(`${label}: no motion '${motionId}' in ${character.dir}/project.json (known: ${motions.map((m) => m.id).join(", ") || "none"})`);
    const why = leftOut(motion);
    if (why) fail(`${label}: cannot recolor '${motion.id}': ${why}`);
    return { included: [motion], skipped: [] };
  }
  const included = motions.filter((m) => !leftOut(m));
  const skipped = motions.filter((m) => leftOut(m)).map((m) => ({ motion: m.id, reason: leftOut(m) }));
  if (!included.length) {
    fail(`${label}: ${character.name} has no ready sprite motion to recolor${skipped.length ? ` (${skipped.map((s) => `${s.motion}: ${s.reason}`).join("; ")})` : ""}`);
  }
  return { included, skipped };
}

/**
 * The colourways to bake: those of `--map` (a file `recolor-palette`
 * drafted and the agent filled in), else the ones the character recorded
 * (`character.pixel.variants`) — which is how a motion made again gets its
 * colourways back. `--variant` narrows either to the names given.
 */
function recolorVariants(subject, { map, only }, label) {
  let variants;
  let from = null;
  if (map) {
    from = resolve(map);
    if (!existsSync(from)) fail(`${label}: --map ${from} not found — draft one with recolor-palette`);
    let doc;
    try {
      doc = JSON.parse(readFileSync(from, "utf-8"));
    } catch (error) {
      fail(`${label}: --map ${from} is not valid JSON (${error.message})`);
    }
    variants = recolorRule(() => parseRecolorMap(doc, `--map ${from}`));
  } else {
    const recorded = Array.isArray(subject.pixel.variants) ? subject.pixel.variants : [];
    if (!recorded.length) {
      fail(`${label}: ${subject.character.name} has no colourways yet — draft a map with recolor-palette, fill it in, and pass it with --map`);
    }
    variants = recolorRule(() => recorded.map((v, i) => checkVariant(v, `character.pixel.variants[${i}]`)));
  }
  if (only) {
    const unknown = only.filter((name) => !variants.some((v) => v.name === name));
    if (unknown.length) fail(`${label}: --variant ${unknown.join(", ")}: no such colourway (${variants.map((v) => v.name).join(", ")})`);
    variants = variants.filter((v) => only.includes(v.name));
  }
  return { variants, from };
}

function stepRecolor(target, options) {
  const label = "recolor";
  const subject = recolorSubject(target, label);
  const { character, palette } = subject;
  const { variants, from } = recolorVariants(subject, options, label);
  const { included, skipped } = recolorMotions(character, subject.motionId, label);
  const warnings = [];
  const tallies = new Map(variants.map((v) => [v.name, []]));

  const motions = included.map((motion) => {
    const frames = registeredFrames(character, motion, label);
    const facts = readAtlasFacts(character, motion, frames.paths.length, label);
    const meta = JSON.parse(readFileSync(facts.path, "utf-8")).meta ?? {};
    const anchor = meta.anchor === "center" || meta.anchor === "bottom" ? meta.anchor : (motion.anchor ?? "bottom");
    const cols = facts.sheetSize && facts.perFrame[0].rect ? Math.round(facts.sheetSize.w / facts.perFrame[0].rect.w) : undefined;
    const images = frames.paths.map((path) => readRgba(path));
    // Colours the palette does not have: an outline darkened after it
    // (run --pixel --outline) is expected; anything else means frames that
    // were never quantised to it, which an exact map mostly misses.
    const off = offPalette(countColors(images), palette.colors);
    const outlined = readAlignRecord(frames.dir)?.pixel?.outline ?? null;
    if (off.colors && outlined === null) {
      warnings.push(`${motion.id}: ${off.colors} colour(s) (${off.pixels} px) are not in the pinned palette — its frames were not all quantised to it (run --pixel), so an exact map misses them; they are counted as uncovered`);
    }
    const motionDir = join(character.dir, "motions", motion.id);
    const alignRecord = join(frames.dir, ALIGN_RECORD);
    const baked = variants.map((variant) => {
      const tally = newTally(variant);
      const dir = join(motionDir, VARIANTS_DIRNAME, variant.name);
      const framesDir = join(dir, "frames");
      resetFramesDir(framesDir);
      const written = images.map((image, i) => writeRgbaPng(
        join(framesDir, basename(frames.paths[i])), recolorImage(image, tally), `recolor ${motion.id} ${variant.name} frame ${i}`,
      ));
      // Same pixels, same places: the motion's align record describes these
      // frames too, and `pack` declares the same pivot from it.
      if (existsSync(alignRecord)) copyFileSync(alignRecord, join(framesDir, ALIGN_RECORD));
      const packed = stepPack(framesDir, {
        out: join(dir, "sheet.png"), atlas: join(dir, "atlas.json"), name: motion.id,
        fps: facts.fps, loop: facts.loop, anchor, cols, scale: facts.scale, nearest: true,
      });
      // A GIF preview only: a lossy WebP would smear the very colours this is about.
      const preview = stepGif(framesDir, { out: join(dir, "preview.gif"), fps: facts.fps, loop: facts.loop, webp: null, width: null });
      warnings.push(...preview.warnings);
      tallies.get(variant.name).push(tally);
      return { ...tallyReport(tally), dir, frames: written, sheet: packed.sheet, atlas: packed.atlas, gif: preview.gif };
    });
    return { id: motion.id, frames: frames.paths, ...(off.colors ? { offPalette: off } : {}), variants: baked };
  });

  // The whole bake per colourway: an entry is unmatched only when no motion used it.
  const summary = variants.map((variant) => tallyReport(mergeTallies(tallies.get(variant.name))));
  for (const s of summary) {
    if (s.unmatched.length) {
      warnings.push(`${s.name}: ${s.unmatched.map((u) => `${u.from} → ${u.to}`).join(", ")} matched no pixel of ${motions.length === 1 ? motions[0].id : "any motion"} — a typo, or a colour these frames do not use (recolor-palette lists the ones they do)`);
    }
  }
  return {
    kind: "recolor",
    character: character.dir,
    name: character.name,
    palette: { id: subject.pixel.palette, file: palette.file, colors: palette.colors.length },
    // Where the colourways came from: the --map file, or null for the ones
    // the character recorded. `variants` is what register-recolor records.
    map: from,
    variants,
    motions,
    skipped,
    summary,
    warnings,
  };
}

/**
 * Draft a recolor map from the character's pinned palette and the colours
 * its frames really use, plus the swatch sheet that shows where each is.
 * Never over a map that is already there (it may hold colourways) unless
 * `--force`.
 */
function stepRecolorPalette(target, { out, force }) {
  const label = "recolor-palette";
  const subject = recolorSubject(target, label);
  const { character, palette } = subject;
  const { included, skipped } = recolorMotions(character, subject.motionId, label);
  const outPath = resolve(out ?? join(character.dir, RECOLOR_FILENAME));
  if (existsSync(outPath) && !force) {
    fail(`${label}: ${outPath} is already there and may hold colourways — pass --force to draft over it, or --out another file`);
  }
  const counts = new Map();
  // Each colour's cell shows the frame that uses it most.
  const bestFrame = new Map();
  for (const motion of included) {
    for (const path of registeredFrames(character, motion, label).paths) {
      const image = readRgba(path);
      for (const [key, n] of countColors([image])) {
        counts.set(key, (counts.get(key) ?? 0) + n);
        if ((bestFrame.get(key)?.n ?? 0) < n) bestFrame.set(key, { n, image });
      }
    }
  }
  const swatchPath = join(dirname(outPath), `${basename(outPath, extname(outPath))}-swatches.png`);
  const draft = recolorRule(() => draftRecolorMap({
    palette: subject.pixel.palette, paletteColors: palette.colors, counts, character: character.name,
    swatches: basename(swatchPath),
  }));
  const drawn = draft.colors.filter((c) => c.swatch);
  const sheet = recolorRule(() => swatchSheet(drawn.map((c) => ({
    rgb: parseHexColor(c.hex), image: bestFrame.get(parseInt(c.hex.slice(1), 16)).image,
  }))));
  writeRgbaPng(swatchPath, sheet.image, "recolor swatches");
  writeJsonFile(outPath, draft);
  const off = drawn.filter((c) => c.inPalette === false).length;
  return {
    kind: "recolor-palette",
    character: character.dir,
    name: character.name,
    palette: { id: subject.pixel.palette, file: palette.file, colors: palette.colors.length },
    out: outPath,
    swatches: swatchPath,
    mark: sheet.mark,
    motions: included.map((m) => m.id),
    skipped,
    colors: drawn.length,
    unused: draft.colors.length - drawn.length,
    offPalette: off,
    warnings: off ? [`${off} of the colours in use are not in the pinned palette (inPalette: false) — an outline darkened after it, or frames not quantised to it`] : [],
  };
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
function sourceCellWidth(entries, given, xMode) {
  if (given) return given.width;
  const first = probeSize(entries[0].path, "align");
  for (const entry of entries) {
    const size = probeSize(entry.path, "align");
    if (size.width !== first.width) {
      fail(`--x-from ${xMode} needs frames cut from one grid or one clip, but ${basename(entries[0].path)} is ${first.width}px wide and ${basename(entry.path)} is ${size.width}px — align these on --x-from feet or bbox instead`);
    }
  }
  return first.width;
}

/**
 * Where `trend` and `body` take each frame's x from, in the frames' shared
 * source coordinates — both keep the placement the frames were filmed (or
 * drawn) with and take out only the drift, so the constant they add is the
 * mean foot line, which is where the anchor then lands.
 *
 * `trend` fits one line to the body's mass centre and removes it (see
 * `drift.mjs::trendReference`). `body` measures the last frame's head and
 * torso against the first's once and ramps that offset across the frames
 * (`bodyWrapOffset` + `rampShifts`): shifting frame k right by s_k is the
 * same as its anchor sitting s_k further left.
 */
function driftAnchors(entries, measures, xMode, threshold) {
  const feetX = measures.map((m) => m.feetX);
  if (xMode === "trend") {
    const fit = trendReference(feetX, measures.map((m) => m.massX));
    return {
      anchorsX: fit.ref,
      record: {
        slope: round(fit.slope, 4),
        driftPx: round(fit.driftPx, 2),
        footSwayPx: round(fit.footSwayPx, 2),
      },
    };
  }
  const present = measures.map((m, i) => (m.bbox ? i : -1)).filter((i) => i >= 0);
  const first = readRgba(entries[present[0]].path);
  const last = readRgba(entries[present[present.length - 1]].path);
  if (first.height !== last.height) {
    fail(`--x-from body registers the last frame on the first, but ${basename(entries[present[0]].path)} is ${first.height}px tall and ${basename(entries[present[present.length - 1]].path)} is ${last.height}px — use --x-from trend`);
  }
  const wrapDx = present.length > 1 ? bodyWrapOffset(first, last, { threshold }) : 0;
  const shifts = rampShifts(entries.length, wrapDx);
  const level = present.reduce((sum, i) => sum + feetX[i] + shifts[i], 0) / present.length;
  return {
    anchorsX: measures.map((m, i) => (m.bbox ? level - shifts[i] : null)),
    record: { wrapDx, band: BODY_REGISTER_BAND, search: BODY_REGISTER_SEARCH, shifts },
  };
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
function stepAlign(framesDir, { out, anchor, cell, pad: askedPad, smooth, threshold, xFrom, measures: given, sourceCell }) {
  const entries = listFrames(resolve(framesDir));
  // Frames `pixel` wrote are N x N blocks of logical pixels. Every offset,
  // the pad and the cell are then whole multiples of N, so a block never
  // straddles the cell's N-grid and the atlas divides back to logical pixels
  // exactly. N = 1 is the plain case and changes nothing.
  const pixel = readPixelRecord(framesDir);
  const grid = pixel ? pixel.scale : 1;
  const pad = Math.ceil(askedPad / grid) * grid;
  if (cell && grid > 1 && (cell.width % grid || cell.height % grid)) {
    fail(`--cell ${cell.width}x${cell.height}: these frames are pixel art at ${grid}x (${PIXEL_RECORD}), so the cell must be a multiple of ${grid} on both sides`);
  }
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
  const sourceWidth = SOURCE_PLACED.has(xMode) ? sourceCellWidth(entries, sourceCell, xMode) : null;
  const drift = xMode === "trend" || xMode === "body" ? driftAnchors(entries, measures, xMode, threshold) : null;

  // Smoothing works on the *source* anchor, so a one-frame bbox wobble stops
  // shoving the body; the frame keeps its own offset from the smoothed anchor.
  const anchorsX = drift ? drift.anchorsX : measures.map((m) => {
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
    // Even, so the anchor sits on a whole pixel in the middle — and for pixel
    // frames also a multiple of the block, so it sits on a block boundary.
    const unit = grid % 2 ? 2 * grid : grid;
    const even = (n) => Math.ceil(n / unit) * unit;
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
    let offsetX = grid * Math.round((target.x - localX) / grid);
    let offsetY = grid * Math.round((target.y - localY) / grid);
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
    // What `trend` / `body` measured and removed — the drift is a fact about
    // the source, and it is only known here.
    ...(drift ? { drift: drift.record } : {}),
    // The lattice these frames carry, travelling with them so `inspect` can
    // check it held without knowing where `pixel` wrote.
    ...(pixel ? { pixel } : {}),
  });

  return {
    inDir: resolve(framesDir),
    outDir: dir,
    anchor, pad, smooth,
    xFrom: xMode,
    ...(drift ? { drift: drift.record } : {}),
    ...(pixel ? { pixel } : {}),
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
    // Records from before the field existed were all feet/bbox/cell alignments.
    xFrom: X_FROM_MODES.includes(doc.xFrom) ? doc.xFrom : null,
    ...(doc.pixel ? { pixel: pixelFacts(doc.pixel, `${path} (pixel)`) } : {}),
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
      // The same point under the key PixiJS 8 reads — its Spritesheet parser
      // takes `defaultAnchor: data.anchor` and never looks at `pivot`, so a
      // pivot-only atlas stands every frame on its top-left corner there.
      // Phaser reads `anchor || pivot`; `pivot` stays for existing readers.
      anchor: { ...pivot },
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

/** The `keyColor` the motion's last `inspect.json` recorded, or null. */
function previousKeyColor(dir) {
  try {
    const value = JSON.parse(readFileSync(join(dir, "inspect.json"), "utf-8")).keyColor;
    return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** True when the frames do not all share one width. */
function nonUniformWidth(measured) {
  return measured.some((f) => f.width !== measured[0].width);
}

/**
 * Whether the motion loops, as its atlas declares it — the fact that decides
 * whether last-to-first is a step `inspect` judges. Null when there is no
 * atlas yet (frames aligned by hand, not packed): then nothing is assumed.
 */
function readAtlasLoop(motionDir) {
  const path = join(motionDir, "atlas.json");
  if (!existsSync(path)) return null;
  let doc;
  try {
    doc = JSON.parse(readFileSync(path, "utf-8"));
  } catch (error) {
    fail(`${path} is not valid JSON (${error.message}) — re-run pack`);
  }
  return typeof doc?.meta?.loop === "boolean" ? doc.meta.loop : null;
}

/**
 * Read a finished motion and say what is wrong with it in sentences a human
 * (and the agent talking to one) can act on.
 */
function stepInspect(motionDir, { anchor, threshold, cellsDir, cellBoxes, write = true, keyColor, extraWarnings = [] }) {
  const dir = resolve(motionDir);
  const framesDir = existsSync(join(dir, "frames")) ? join(dir, "frames") : dir;
  const entries = listFrames(framesDir);
  // `run` leaves the pre-align cells beside the frames, so a plain
  // `inspect <motionDir>` reproduces the clipping report `run` printed
  // instead of quietly judging it on the padded frames.
  const cells = cellsDir ?? (existsSync(join(dir, CELLS_DIRNAME)) ? join(dir, CELLS_DIRNAME) : null);
  // The plate these frames were keyed off, for `keyResidue`: what the caller
  // keyed with (null: nothing was keyed), or — a plain `inspect`, which was
  // not there — what the last report recorded.
  const key = keyColor === undefined ? previousKeyColor(dir) : keyColor;
  const plate = key ? plateOf(key) : null;
  const residueCounts = [];

  // Frames that went through `pixel` are checked against their lattice in the
  // same decode: binary alpha, every block one colour on the N-grid, every
  // colour a palette colour (unless --outline darkened the edge on purpose).
  const pixel = readAlignRecord(framesDir)?.pixel ?? readPixelRecord(framesDir);
  let paletteColors = null;
  if (pixel?.palette && pixel.outline === null) {
    try {
      paletteColors = loadPalette(pixel.palette)?.colors ?? null;
    } catch (error) {
      fail(`inspect: ${error.message}`);
    }
  }

  const measured = entries.map((entry) => {
    const image = readRgba(entry.path);
    if (plate?.chroma) residueCounts.push(keyResidue(image, plate, threshold));
    const geometry = measureFrame(image, threshold);
    return {
      index: entry.index, path: entry.path,
      width: image.width, height: image.height,
      ...geometry,
      // Read off the decode already in hand, so the frame is never decoded
      // twice: the 64² thumbnail the step between frames is measured on.
      thumb: stepThumb(image),
      ...(pixel ? { lattice: latticeCheck(image, pixel.scale, paletteColors) } : {}),
    };
  });
  const residue = residueOf(residueCounts);

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

  // Where the head and torso sit, frame to frame, against the first frame's —
  // measured on a region no alignment pins. `bodyDrift` is the spread of the
  // very line `--x-from feet` pins, so after that alignment it reads ~0
  // whatever the body did; a walk whose feet were pinned lurches by the
  // stride, and it is the upper body that shows it. Frames of one width only:
  // a non-uniform set has no shared x to compare.
  const headX = nonUniformWidth(measured)
    ? measured.map(() => null)
    : headOffsets(measured.map((f) => f.head), measured[0].width);
  const headDrift = round(stdDev(headX.filter((v) => v !== null)), 3);

  // The step from each frame to the next, and — for a looping motion — from
  // the last back to the first. A pair with an empty frame has no step: the
  // empty frame is its own warning.
  const stepBetween = (a, b) => (a.bbox && b.bbox ? thumbDiff(a.thumb, b.thumb) : null);
  const steps = measured.slice(1).map((f, k) => stepBetween(measured[k], f));
  const loop = readAtlasLoop(dir);
  const wrap = loop && measured.length > 2 ? stepBetween(measured[measured.length - 1], measured[0]) : null;
  const grid = cells ? readSliceRecord(cells) : null;
  const judged = judgeSteps(steps, {
    wrap, count: measured.length, cols: grid && grid.cols * grid.rows === measured.length ? grid.cols : null,
  });

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
        return { index: entry.index, width: image.width, height: image.height, ...measureFrame(image, threshold) };
      })
    : measured);

  // The same head band on the SOURCE — the cells, in the coordinates the clip
  // was filmed (or the grid drawn) in — with the slow straight-line drift
  // taken out: the sway the motion itself has. An alignment may remove drift;
  // it should not add sway. A feet pin on a walk does exactly that: measured
  // 2026-09-27, the Lumi side walk goes from 0.77 px as filmed to 7.45 px
  // after `--x-from feet` (0.97 px after `trend`); see ADDED_SWAY_RATIO.
  // Frames that went through `pixel` are in logical pixels × scale while the
  // cells are in source pixels, `pitch` of them per logical pixel: the source
  // number is said in frame pixels, or a pitch-8 sheet's source sway would
  // read 8× the frames' and hide exactly the sway this compares.
  const sourceToFrame = pixel ? pixel.scale / pixel.pitch.x : 1;
  const sourceHeadDrift = clipSource !== measured && !nonUniformWidth(clipSource)
    && clipSource.every((c) => c.head !== undefined)
    ? round(swayAboutTrend(headOffsets(clipSource.map((c) => c.head), clipSource[0].width)) * sourceToFrame, 3)
    : null;
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
  // A wide foot spread is a sliding BODY only when the upper body goes with
  // it. In a walk the foot line sweeps a stride under a head that stays put —
  // that is the step — and telling the agent to pin the feet would bring back
  // the lurch. So the warning needs the head to move too, and it never speaks
  // for `trend` / `body`, which keep the foot line as filmed by design.
  const record = readAlignRecord(framesDir);
  const keepsFootLine = record && (record.xFrom === "trend" || record.xFrom === "body");
  const headMoves = headDrift > STEADY_HEAD_FRACTION * cellW;
  if (!keepsFootLine && headMoves && bodyDrift > MAX_BODY_DRIFT_FRACTION * cellW) {
    warnings.push("body drifts sideways between frames — re-run align with --x-from feet/cell");
  }
  if (sourceHeadDrift !== null && headDrift > ADDED_SWAY_RATIO * sourceHeadDrift
    && headDrift - sourceHeadDrift > ADDED_SWAY_FRACTION * cellW) {
    warnings.push(`head sways ${headDrift} px across the frames but ${sourceHeadDrift} px in the source once its slow drift is removed — the alignment added sway (a pinned stepping foot) or kept the drift; re-align from cells/ with --x-from trend (or cell, the placement as drawn)`);
  }
  if (scaleDrift > MAX_SCALE_DRIFT) {
    warnings.push("character scale varies across frames — regenerate with a fixed-scale instruction");
  }
  warnings.push(...listAndTruncate(clipped, (i) => `cell ${pad(i)} is clipped — the drawing leaves its grid cell`));
  // One sentence per kind, naming every pair: six lines for one gentle idle
  // would bury the warnings that are not about holds.
  const pairsText = (pairs) => listAndTruncate(pairs, (p) => `${pad(p.from)}→${pad(p.to)}`).join(", ");
  // A breathe moves its head by whole pixels, so at each turn of the breath
  // two neighbours can share the head's row and differ by a sub-pixel warp of
  // the body alone (Lumi at depth 0.02, 16 frames: 4 such pairs, steps
  // 0.001–0.002 between steps of 0.010–0.013). That hold is the method, not
  // a drawing the model repeated: the pairs stay in `nearDuplicates`, the
  // sentence — whose fixes are resampling and redrawing — is not said.
  const breathed = [cells, framesDir].some((d) => d && existsSync(join(resolve(d), BREATHE_RECORD)));
  if (judged.nearDuplicates.length && !breathed) {
    warnings.push(`near-duplicate frames ${pairsText(judged.nearDuplicates)} (step under ${DUPLICATE_STEP}) — the animation holds there; fine for a held idle, a hitch in a stroke or a step`);
  }
  if (judged.rowJumps.length) {
    warnings.push(`row boundaries jump: ${pairsText(judged.rowJumps)} (step ${judged.rowJumps.map((p) => round(p.step, 3)).join(", ")} against an in-row median of ${round(judged.inRowMedian, 3)}) — the sheet's rows were drawn as separate sequences`);
  }
  const residueNote = residueWarning(residue, key);
  if (residueNote) warnings.push(residueNote);
  // What the caller knows about these frames that the pixels cannot say — a
  // breathe's detector on the still they were warped from. In the summary,
  // because that is what register-run copies and the stage shows.
  for (const warning of extraWarnings) if (!warnings.includes(warning)) warnings.push(warning);

  let pixelSummary = null;
  if (pixel) {
    const framesWith = (key) => measured.filter((f) => f.lattice[key] > 0).map((f) => f.index);
    const softAlphaFrames = framesWith("softAlpha");
    const offGridFrames = framesWith("offGrid");
    const offPaletteFrames = paletteColors ? framesWith("offPalette") : [];
    const held = !softAlphaFrames.length && !offGridFrames.length && !offPaletteFrames.length;
    const list = (indices) => indices.slice(0, MAX_LISTED).map(pad).join(", ") + (indices.length > MAX_LISTED ? ", …" : "");
    if (softAlphaFrames.length) {
      warnings.push(`pixel lattice broken: frame(s) ${list(softAlphaFrames)} have soft alpha — they were not made by pixel, or were resampled after it`);
    }
    if (offGridFrames.length) {
      warnings.push(`pixel lattice broken: frame(s) ${list(offGridFrames)} have blocks off the ${pixel.scale}x grid — re-align from the ${PIXEL_DIRNAME}/ frames, not from ${CELLS_DIRNAME}/`);
    }
    if (offPaletteFrames.length) {
      warnings.push(`pixel lattice broken: frame(s) ${list(offPaletteFrames)} use colours outside the palette ${pixel.palette} — was it rebuilt after these frames were made?`);
    }
    pixelSummary = {
      pitch: pixel.pitch,
      scale: pixel.scale,
      held,
      palette: pixel.palette,
      paletteChecked: Boolean(paletteColors),
      ...(softAlphaFrames.length ? { softAlphaFrames } : {}),
      ...(offGridFrames.length ? { offGridFrames } : {}),
      ...(offPaletteFrames.length ? { offPaletteFrames } : {}),
    };
  }

  // The point `align` put the anchor on, when these very frames carry it: the
  // viewer draws its pivot guide there, and the atlas declares the same point.
  // It belongs to the SUMMARY, not just the fat report: `run` embeds the
  // summary as its `inspect` block and `register-run` copies that block into
  // project.json, which is the only thing the viewer reads. Left out of the
  // summary, the measurement stops at the report nobody downstream consumes.
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
    headDrift,
    ...(sourceHeadDrift === null ? {} : { sourceHeadDrift }),
    maxJump: round(maxJump, 3),
    scaleDrift,
    emptyFrames,
    nearDuplicates: judged.nearDuplicates.map((p) => [p.from, p.to]),
    rowJumps: judged.rowJumps.map((p) => [p.from, p.to]),
    // Present only when a hued plate was keyed: 0 is the best reading there
    // is, and a white-plate or matted motion has no residue to speak of.
    ...(residue ? { keyResidue: residue.keyResidue } : {}),
    warnings,
    // Present only for frames that went through `pixel`: the pitch it found
    // and whether the lattice survived everything after it.
    ...(pixelSummary ? { pixel: pixelSummary } : {}),
  };

  const report = {
    ...summary,
    motionDir: dir,
    framesDir,
    ...(cells ? { cellsDir: resolve(cells) } : {}),
    ...(key ? { keyColor: key } : {}),
    ...(residue ? { keyResidueEdge: residue.keyResidueEdge, keyFringe: residue.keyFringe } : {}),
    anchor,
    frames: measured.map((f, i) => ({
      index: f.index,
      bbox: f.bbox,
      coverage: round(f.coverage, 4),
      anchor: f.bbox ? { x: round(anchorOf(f.bbox, anchor).x, 2), y: round(anchorOf(f.bbox, anchor).y, 2) } : null,
      // Per frame, so "the body drifts" names the frame it drifts on — the
      // summary metric alone cannot.
      feetX: f.feetX === null ? null : round(f.feetX, 2),
      headX: headX[i] === null ? null : round(headX[i], 2),
      // The step from this frame to the next (the last frame: to the first
      // when the motion loops, else null).
      step: i < steps.length ? (steps[i] === null ? null : round(steps[i], 4)) : (wrap === null ? null : round(wrap, 4)),
    })),
    ...(grid ? { grid } : {}),
    loop,
    ...(judged.inRowMedian === null ? {} : { inRowMedianStep: round(judged.inRowMedian, 4) }),
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
function finishMotion(motionDir, cellsDir, options, { measures, sourceCell, warnings, lattice = null }) {
  const framesDir = join(motionDir, "frames");
  // With a lattice step in between, align reads ITS frames (and the pixel
  // record next to them); the clipping verdict below stays on the raw cells.
  const aligned = stepAlign(lattice ? lattice.outDir : cellsDir, {
    out: framesDir,
    anchor: options.anchor,
    cell: options.cell,
    pad: options.pad,
    smooth: options.smooth,
    threshold: options.threshold,
    xFrom: options.xFrom,
    measures: lattice ? lattice.measures : measures,
    sourceCell: lattice ? lattice.cell : sourceCell,
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
    // A lattice already applied the whole-number scale; resampling the atlas
    // again could only take it off the grid.
    scale: lattice ? 1 : options.scale,
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
    keyColor: options.keyColor ?? null,
    extraWarnings: options.extraWarnings,
    cellsDir,
    cellBoxes: measures.map((m, index) => ({
      index, width: sourceCell.width, height: sourceCell.height, bbox: m.bbox, head: m.head,
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
  let keyer;
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
        keyer: options.keyer,
      });
      keyedHere = keyed.output;
      sheetAlpha = keyed.output;
      keyColor = keyed.color;
      keyer = keyed.keyer;
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
  const cellImages = [];
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
    cellImages.push(image);
  }
  const cleaned = options.clean ? cleanSummary(cleanStats) : null;
  if (cleaned) warnings.push(...cleaned.warnings);

  // Pixel art: snap the cleaned cells onto their lattice before anything
  // places them. The cells stay what they are — the source a re-run snaps.
  let lattice = null;
  const character = characterOfMotion(motionDir);
  if (options.pixel) {
    const palette = runPalette(motionDir, character, options);
    lattice = stepPixel(cellsDir, {
      out: join(motionDir, PIXEL_DIRNAME),
      palette: palette.file,
      repalette: options.repalette,
      paletteSize: options.paletteSize,
      scale: options.scale,
      pitchHint: options.pitchHint,
      outline: options.outline,
      outlineStrength: options.outlineStrength,
      detailBias: options.detailBias,
      threshold: options.threshold,
      images: cellImages,
      // Every pixel run of a character is held to its declared height.
      logicalHeight: options.logicalHeight ?? declaredPixelHeight(character),
    });
    lattice.palette = { ...lattice.palette, from: palette.from };
    warnings.push(...lattice.warnings);
  } else {
    const hint = pixelStyleHint(character);
    if (hint) warnings.push(hint);
  }

  const { aligned, packed, preview, summary } = finishMotion(motionDir, cellsDir, { ...options, keyColor: keyColor ?? null }, {
    measures, sourceCell: sliced.cell, warnings, lattice,
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
    ...(keyer ? { keyer } : {}),
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
    ...(aligned.drift ? { drift: aligned.drift } : {}),
    scale: options.scale,
    ...(lattice ? {
      pixel: {
        dir: lattice.outDir,
        scale: lattice.scale,
        pitch: lattice.pitch,
        logicalCell: lattice.logicalCell,
        palette: lattice.palette,
        outline: lattice.outline,
        ...(lattice.logicalHeight ? { logicalHeight: lattice.logicalHeight } : {}),
        record: lattice.record,
      },
    } : {}),
    warnings,
  };
}

/**
 * The character a motion directory belongs to — `<character>/motions/<id>` —
 * read only: `{ dir, doc }`, or null when the directory is not in one or its
 * project.json is missing or unreadable. What is read from it is a default
 * or a suggestion, never a write, and `register-run` is where a broken
 * project.json is reported.
 */
function characterOfMotion(motionDir) {
  if (basename(dirname(motionDir)) !== "motions") return null;
  const dir = dirname(dirname(motionDir));
  const path = join(dir, "project.json");
  if (!existsSync(path)) return null;
  try {
    const doc = JSON.parse(readFileSync(path, "utf-8"));
    return doc?.sprite?.character ? { dir, doc } : null;
  } catch {
    return null;
  }
}

/**
 * The palette `run --pixel` quantises to. `--palette` when named. Otherwise
 * the palette pinned on the character (`character.pixel.palette`, the asset
 * `register-run` pinned from the first pixel run) — every motion of a pixel
 * character shares one palette so colours do not flicker between them, and
 * `register-run` refuses a run quantised to another. `--repalette` does not
 * rebuild the pinned file in another motion's directory: it builds this
 * motion's own, which `register-run` then asks to `--repin`. With nothing
 * pinned yet, the motion's own `palette.json`.
 */
function runPalette(motionDir, character, options) {
  if (options.palette) return { file: resolve(options.palette), from: "flag" };
  const own = { file: join(motionDir, PALETTE_FILENAME), from: "motion" };
  if (options.repalette || !character) return own;
  const id = character.doc.sprite.character.pixel?.palette;
  if (typeof id !== "string" || !id) return own;
  const asset = (character.doc.assets ?? []).find((a) => a.id === id);
  if (!asset || typeof asset.uri !== "string") return own;
  const file = resolve(character.dir, asset.uri);
  if (!existsSync(file)) {
    fail(`run --pixel: the palette pinned for this character (${id}, ${asset.uri}) is not on disk — restore it, or pass --repalette to build one from these frames (register-run then needs --repin)`);
  }
  return { file, from: "character" };
}

/** `character.pixel.logicalHeight`, or null: the height every pixel run of
 *  the character is held to. */
function declaredPixelHeight(character) {
  const height = Number(character?.doc.sprite.character.pixel?.logicalHeight);
  return Number.isInteger(height) && height > 0 ? height : null;
}

/**
 * A sentence for a `run` without `--pixel` on a pixel-art character — by the
 * reading `rive --filter auto` uses: `character.pixel`, else the style
 * sentence (`riveIsPixelArt`) — or null.
 */
function pixelStyleHint(character) {
  if (!character) return null;
  const spec = character.doc.sprite.character;
  if (!riveIsPixelArt(spec)) return null;
  const said = spec.pixel && Number(spec.pixel.logicalHeight) > 0
    ? `character.pixel says pixel art (${spec.pixel.logicalHeight} logical px tall)`
    : `character.style says pixel art ("${spec.style}")`;
  return `${said} — run --pixel snaps the frames onto their pixel lattice (one pixel per block, binary alpha, one pinned palette); this run kept the drawn edges as they are`;
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
 * Decode the trimmed window to one RGBA thumbnail per analysed frame, in a
 * single ffmpeg pass: the cycle analysis reads their premultiplied colour,
 * and the silhouette readings (`stillStart`, `stillEnd`, `profile.deltas`)
 * read their alpha.
 *
 * One pass, not one spawn per frame: the analysis looks at every frame of a
 * 24 fps clip, and paying a process for each of them would cost more than the
 * decode. The frames come back as raw bytes with no container, so the buffer
 * splits into fixed-size thumbnails by arithmetic — which is why the scale is
 * pinned to an exact WxH here rather than left to ffmpeg's `-2`.
 */
function decodeThumbs(input, { start, span, key, similarity, blend, fps, size }) {
  const thumb = thumbSize(size.width, size.height);
  // `fps` first so the decimation happens before the per-pixel work, and the
  // key before the scale so the alpha IS the silhouette. Without a key every
  // pixel is opaque and the plate is part of the picture — constant, so it
  // adds nothing to a difference.
  const chain = [`fps=${fps}`];
  if (key) chain.push(`colorkey=${key}:${similarity}:${blend}`);
  chain.push("format=rgba", `scale=${thumb.width}:${thumb.height}:flags=area`);

  const r = spawnSync("ffmpeg", [
    "-v", "error", "-ss", String(start), "-t", String(span), "-i", input,
    "-vf", chain.join(","), "-f", "rawvideo", "-pix_fmt", "rgba", "-",
  ], { maxBuffer: MAX_RAW_BYTES });
  if (r.error) fail(`contact: could not decode ${input} (${r.error.message})`);
  if (r.status !== 0) fail(`contact: could not decode ${input}\n${String(r.stderr ?? "").trim()}`);

  const frameBytes = thumb.width * thumb.height * 4;
  const count = Math.floor((r.stdout?.length ?? 0) / frameBytes);
  if (count < 2) {
    fail(`contact: ${round(span, 3)}s from ${round(start, 3)}s of ${input} decoded to ${count} analysis frame(s) — nothing to compare`);
  }
  const thumbs = Array.from({ length: count }, (_, i) => r.stdout.subarray(i * frameBytes, (i + 1) * frameBytes));
  return { thumbs, masks: thumbs.map((rgba) => silhouetteOf(rgba, Boolean(key))) };
}

/**
 * One gray silhouette out of an RGBA thumbnail: its alpha, or — for a clip
 * that was not keyed — its luma re-based on its own background (see
 * `subtractBackground`), which is what `--key none` has always compared.
 */
function silhouetteOf(rgba, keyed) {
  const mask = Buffer.allocUnsafe(rgba.length >> 2);
  for (let p = 0, i = 0; p < rgba.length; p += 4, i++) {
    mask[i] = keyed ? rgba[p + 3] : Math.round(0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2]);
  }
  return keyed ? mask : subtractBackground(mask);
}

/**
 * What the silhouette series says about the clip's ends: where the opening
 * pose breaks and where the closing hold begins, plus the frame-to-frame
 * rhythm. Which windows repeat is the colour analysis's question
 * (`readCycle`), not this one's.
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

  return {
    stillStart: startIndex < 0 ? null : at(startIndex),
    stillEnd: endIndex < 0 ? null : at(endIndex),
    // 2 dp: this series is read, not computed on — it is the rhythm of the
    // clip at a glance, and four decimals of codec noise only hide it.
    deltas: deltas.map((d) => round(d, 2)),
  };
}

/** Why a clip has no cycle, said for a person. */
const NO_CYCLE_REASONS = {
  still: "the clip never moves",
  window: `the window is too short to see a ${LOOP_PERIOD_MIN}–${LOOP_PERIOD_MAX}s cycle repeat`,
  "no-dip": `nothing in it repeats at a lag between ${LOOP_PERIOD_MIN}s and ${LOOP_PERIOD_MAX}s`,
  flat: "the lag profile is flat",
  "half-stride": "the only repeat is one step",
  held: "every repeating window is a held pose",
};

/**
 * Which windows of the clip repeat, or — when none does — which are one
 * performed action: the colour analysis `cycle.mjs` ports from sprite-gen,
 * in seconds.
 *
 * `loops[]` keeps its old shape (`start`, `end`, `period`, `seam`, `step`),
 * now read off premultiplied RGBA at the analysed rate: `seam` is still "how
 * different the two ends are" (the start against the frame one period later,
 * 0 for a perfect cycle) and `step` the window's mean frame-to-frame change.
 * `wrap` is new: the step the loop actually plays from its last frame back
 * to its first. `ambiguous` is `null` unless the doubled period repeats
 * about as well, and then carries both lengths.
 */
function readCycle(thumbs, { fps, start, moves, gait }) {
  const at = (i) => round(start + i / fps, 3);
  const seconds = (frames) => round(frames / fps, 3);
  const features = thumbs.map(premultiplied);
  const n = features.length;
  const D = distanceMatrix(features);

  const minLen = Math.max(2, Math.ceil(LOOP_PERIOD_MIN * fps));
  // Room to compare against: at least half a second (and eight frames) of the
  // clip past the longest period, the way sprite-gen bounds its action window.
  const context = Math.max(8, Math.ceil(fps / 2));
  const maxLen = Math.min(Math.floor(LOOP_PERIOD_MAX * fps), n - context);
  const found = moves
    ? detectCycle(D, n, { minLen, maxLen, gait, fps })
    : { verdict: "none", reason: "still", period: null, periodicity: null, periodicityMin: null, minima: [], ambiguous: null, guard: null, windows: [] };

  const ambiguous = found.ambiguous
    ? {
      periods: [seconds(found.ambiguous.short), seconds(found.ambiguous.long)],
      depthRatio: found.ambiguous.depthRatio === null ? null : round(found.ambiguous.depthRatio, 3),
    }
    : null;
  const loops = found.verdict === "periodic"
    ? found.windows.map((w) => ({
      start: at(w.start),
      end: at(w.start + w.length),
      period: seconds(w.length),
      seam: round(w.repeat, 4),
      step: round(w.step, 4),
      wrap: round(w.wrap, 4),
      ambiguous,
    }))
    : [];

  const guard = found.guard;
  const cycle = {
    verdict: found.verdict,
    reason: found.reason,
    period: found.period === null ? null : seconds(found.period),
    periodicity: found.periodicity === null ? null : round(found.periodicity, 3),
    periodicityMin: found.periodicityMin === null ? null : round(found.periodicityMin, 3),
    ambiguous,
    ...(gait ? {
      gait: {
        kind: gait,
        floor: GAIT_FLOORS[gait],
        doubled: guard?.applied ? { from: seconds(guard.from), to: seconds(guard.to) } : null,
      },
    } : {}),
    // The profile's deepest dips, `[period s, D]`: where else the clip nearly
    // repeats, for a person deciding between two readings.
    minima: found.minima.map(([L, value]) => [seconds(L), round(value, 4)]),
  };
  if (found.verdict === "none" && found.reason !== "still") {
    const detail = found.reason === "flat"
      ? ` (periodicity ${cycle.periodicity}, needs ${cycle.periodicityMin})`
      : found.reason === "half-stride"
        ? ` (${seconds(guard.below)}s, under the ${gait} floor of ${GAIT_FLOORS[gait]}s, and nothing near twice that repeats within 25 % of it) — the clip shows half a stride`
        : "";
    cycle.sentence = `no cycle: ${NO_CYCLE_REASONS[found.reason]}${detail}`;
  }

  // Only when nothing repeats — sprite-gen's order (`loop.py:854-863`): the
  // one-shot reading is the failover for a clip the period reading refused.
  // Run on a clip that DOES repeat, a stride's own excursion passes it
  // (measured on tanka's walk: a "one-shot" 1.375–3.167 s by moved mass).
  const oneShots = (found.verdict === "none" && moves ? detectOneShots(D, n, features.map(frameMass)) : [])
    .sort((a, b) => a.start - b.start)
    .map((shot) => ({
      start: at(shot.start),
      end: at(shot.end),
      action: { start: at(shot.excursion[0]), end: at(shot.excursion[1]) },
      peak: at(shot.peak),
      departure: round(shot.departure, 4),
      seam: round(shot.seam, 4),
      step: round(shot.step, 4),
      rule: shot.rule,
    }));
  return { cycle, loops, oneShots };
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
    let span = windowEnd - start;
    if (span > MAX_ANALYSIS_SECONDS) {
      warnings.push(`the window is ${round(span, 3)}s — only its first ${MAX_ANALYSIS_SECONDS}s were analysed`);
      span = MAX_ANALYSIS_SECONDS;
    }
    // The clip's own rate: a period is only as precise as the frames it is
    // counted in, and 12 fps quantised every period to a twelfth of a second.
    // A window too long for MAX_CYCLE_FRAMES at that rate is thinned to fit.
    const analysisFps = round(Math.min(
      stream.fps ?? MIN_ANALYSIS_FPS,
      Math.max(MIN_ANALYSIS_FPS, MAX_CYCLE_FRAMES / span),
    ), 3);
    const { thumbs, masks } = decodeThumbs(input, {
      start, span, key: keyColor, similarity: options.similarity, blend: options.blend,
      fps: analysisFps, size,
    });
    motion = { fps: analysisFps, ...readMotion(masks, { fps: analysisFps, start }) };
    if (motion.stillStart === null) warnings.push("the clip never moves");
    Object.assign(motion, readCycle(thumbs, {
      fps: analysisFps, start, moves: motion.stillStart !== null, gait: options.gait,
    }));
    if (motion.cycle.sentence) warnings.push(motion.cycle.sentence);
    if (motion.cycle.verdict === "periodic" && motion.cycle.ambiguous) {
      const [short, long] = motion.cycle.ambiguous.periods;
      warnings.push(`the cycle is ambiguous: ${long}s repeats about as well as ${short}s — a walk whose near and far legs read alike repeats every step, and a stride is two; look at both windows on the contact sheet${options.gait ? "" : ", or pass --gait walk|run if this is a gait"}`);
    }

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
    cycle: (({ sentence, ...cycle }) => cycle)(motion.cycle),
    oneShots: motion.oneShots,
    profile: { fps: motion.fps, start: round(start, 3), deltas: motion.deltas },
    warnings,
  };
}

/**
 * The subject's height, in clip pixels, in the clip's first frame (t = 0):
 * keyed with the clip's own key — the colorkey `filter` in the decode, or the
 * un-mixing keyer on the raw frame with `plate` — the plate's colour zeroed
 * and, when the run cleans, its specks dropped, exactly as a sampled cell
 * would be, so the number is measured on the same kind of picture the cells
 * are.
 */
function standingHeight(input, { filter, plate, radius }, options) {
  const work = mkdtempSync(join(tmpdir(), "sprite-standing-"));
  try {
    const path = join(work, "first.png");
    ffmpeg(["-ss", "0", "-i", input, "-frames:v", "1", ...(filter ? ["-vf", filter] : []), "-pix_fmt", "rgba", "--", path], "from-video first frame");
    if (!existsSync(path)) fail(`from-video: could not decode the first frame of ${input} to measure --body-height on`);
    const image = readRgba(path);
    if (plate) keyFrame(image, plate, { radius });
    zeroKeyedRgb(image, options.threshold);
    if (options.clean) cleanCell(image, options.threshold);
    const { bbox } = computeBbox(image, options.threshold);
    if (!bbox) fail(`from-video: the clip's first frame has no subject above alpha ${options.threshold} to measure --body-height on — check --key against what 'contact' showed`);
    return bbox.h;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
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
  // green the prompt asked for. The un-mixing keyer measures it again over a
  // spread of the sampled frames once they are all out.
  let keyColor;
  let keyer = null;
  let plate = null;
  let filter = null;
  let firstPlate = null;
  if (options.key !== "none") {
    extract(times[0], 0, null);
    const first = readRgba(join(cellsDir, frameName(0)));
    keyColor = options.key === "auto" ? cornerColor(first) : normalizeColor(options.key, "--key");
    firstPlate = options.keyer === "unmix" ? keyPlate([first], options.key, options.similarity) : null;
    keyer = resolveKeyer(options.keyer, firstPlate, "from-video");
    if (keyer === "colorkey") filter = `colorkey=${keyColor}:${options.similarity}:${options.blend},format=rgba`;
  }
  const radius = keyRadius(options.similarity);

  // One character, one size across its motions: every image-to-video clip
  // starts from the same still, so the subject's height in the clip's FIRST
  // frame is the same standing pose in every state, and scaling it to one
  // target gives every motion the same character. The tallest frame would not
  // do — an attack's windup lifts the weapon over the head.
  //
  // Inspired by aldegad/sprite-gen sprite_gen/video/loop.py `--body-height`
  // (`first_frame_height`, `build_strip`): measured on the clip's first frame,
  // a target in both directions (a downward-only clamp left a 200 px source
  // asked for 300 at 200). Changes: applied to the sampled cells, before
  // cleaning and alignment, instead of to a finished strip.
  let bodyHeight = null;
  let rescale = null;
  if (options.bodyHeight) {
    if (!keyer) fail("--body-height measures the subject against its plate: it needs a keyed clip, not --key none");
    // The un-mixing keyer measures its plate over a spread of the samples,
    // which do not exist yet; frame 0's plate — the one that chose the keyer —
    // keys the standing frame.
    const measured = standingHeight(input, { filter, plate: keyer === "unmix" ? firstPlate : null, radius }, options);
    const scale = options.bodyHeight / measured;
    const size = probeSize(join(cellsDir, frameName(0)), "from-video");
    const width = Math.max(1, Math.round(size.width * scale));
    const height = Math.max(1, Math.round(size.height * scale));
    rescale = `scale=${width}:${height}:flags=area`;
    bodyHeight = { target: options.bodyHeight, measured, scale: round(scale, 4), frame: { width, height } };
    if (scale > 1) {
      warnings.push(`--body-height ${options.bodyHeight} scales this clip UP ×${round(scale, 2)} (the subject stands ${measured} px in its first frame) — the frames are softer than the clip; shoot it at a higher resolution or frame it tighter`);
    }
  }
  // Where the resize goes in the decode. A colorkey cut is keyed first and
  // scaled premultiplied, so the plate under zero alpha cannot bleed into the
  // edge. The un-mixing keyer runs on the raw frame after the decode, so the
  // raw frame is scaled: area-averaging mixes subject and plate at the edge
  // the way the camera already did, which is exactly what un-mixing inverts.
  const sampleFilter = (keyFilter) => {
    if (!rescale) return keyFilter;
    return keyFilter ? `${keyFilter},premultiply=inplace=1,${rescale},unpremultiply=inplace=1` : rescale;
  };

  // `unmix` extracts every sample raw and keys it in the pass below, which
  // already has each frame's pixels in hand.
  for (const [index, time] of times.entries()) extract(time, index, sampleFilter(filter));
  if (keyer === "unmix") {
    plate = keyPlate(
      spreadIndices(times.length, PLATE_SAMPLE_FRAMES).map((i) => readRgba(join(cellsDir, frameName(i)))),
      options.key, options.similarity,
    );
    if (plate?.chroma) {
      keyColor = plate.hex;
    } else {
      // Frame 0 had a hue and the spread does not: the colorkey the plate
      // gets anyway, on frame 0's colour, as if unmix had never been asked.
      keyer = resolveKeyer("unmix", plate, "from-video");
      filter = `colorkey=${keyColor}:${options.similarity}:${options.blend},format=rgba`;
      for (const [index, time] of times.entries()) extract(time, index, sampleFilter(filter));
    }
  }

  const source = probeSize(join(cellsDir, frameName(0)), "from-video");
  const cleanStats = [];
  const measures = [];
  const coverages = [];
  for (let index = 0; index < times.length; index++) {
    const path = join(cellsDir, frameName(index));
    const image = readRgba(path);
    let rewrite = false;
    if (keyer === "unmix") {
      keyFrame(image, plate, { radius });
      rewrite = true;
    }
    if (options.clean) {
      const result = cleanCell(image, options.threshold);
      cleanStats.push({ index, ...result });
      if (result.removedPixels) rewrite = true;
    }
    // Here the key ran inside the extraction filter (or just above), so there
    // is no keyed sheet to fix once — every frame carries its own plate under
    // the alpha, and this loop is the pass that already has the pixels in hand.
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

  const { aligned, packed, preview, summary } = finishMotion(motionDir, cellsDir, { ...options, fps, keyColor: keyColor ?? null }, {
    measures, sourceCell: source, warnings,
  });

  return {
    motionDir,
    name: options.name,
    source: "video",
    video: input,
    sampledAt: times,
    schedule,
    ...(bodyHeight ? { bodyHeight } : {}),
    trim: { start: round(start, 3), end: round(Math.min(end, duration), 3) },
    duration: round(duration, 3),
    grid: packed.grid,
    keyed: Boolean(keyColor),
    ...(keyColor ? { keyColor } : {}),
    ...(keyer ? { keyer } : {}),
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
    ...(aligned.drift ? { drift: aligned.drift } : {}),
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
 * One silhouette and one colour thumbnail per decoded frame, in one pass over
 * the sequence.
 *
 * Both are read off the DECODED FRAMES rather than off the clip a second
 * time, so thumbnail i is frame i by construction — the hold trimming and the
 * seam both index into these lists and into the frames that get written, and
 * a resampling difference between two decodes would silently misalign them.
 * The silhouettes decide the holds (their thresholds were set on
 * silhouettes); the premultiplied colour decides the seam, so a blink or a
 * swapped leg at the wrap counts (`cycle.mjs`).
 */
function decodeLoopFrames(dir, count, size, alphaBased, label, start = 0) {
  const thumb = thumbSize(size.width, size.height);
  const r = spawnSync("ffmpeg", [
    "-v", "error", "-start_number", String(start), "-i", join(dir, "%03d.png"),
    "-frames:v", String(count),
    "-vf", `format=rgba,scale=${thumb.width}:${thumb.height}:flags=area`,
    "-f", "rawvideo", "-pix_fmt", "rgba", "-",
  ], { maxBuffer: MAX_RAW_BYTES });
  if (r.error) fail(`${label}: could not analyse the decoded frames (${r.error.message})`);
  if (r.status !== 0) fail(`${label}: could not analyse the decoded frames\n${String(r.stderr ?? "").trim()}`);
  const frameBytes = thumb.width * thumb.height * 4;
  const got = Math.floor((r.stdout?.length ?? 0) / frameBytes);
  if (got !== count) {
    fail(`${label}: ${count} frames were decoded but ${got} could be analysed — one of them does not decode`);
  }
  const thumbs = Array.from({ length: got }, (_, i) => r.stdout.subarray(i * frameBytes, (i + 1) * frameBytes));
  return { masks: thumbs.map((rgba) => silhouetteOf(rgba, alphaBased)), thumbs };
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
 * `auto` fills only a seam the eye can already see — past `seamLimit(step)`,
 * the same line the warning is drawn at: `SEAM_STEP_LIMIT` steps, or the
 * noise floor `SEAM_FLOOR` when that is larger — and fills it just enough to
 * bring the wrap back to about one step: a seam of `k` steps needs `k - 1`
 * frames in the gap, capped at `MAX_AUTO_SEAM_FILL`. The floor is what keeps
 * a near-still loop from being "fixed": tanka's idle wraps at 0.002 against a
 * step of 0.0004 — five steps, and re-render noise — and used to get four
 * interpolated frames it never needed. A clip whose median step is 0
 * (nothing moves) has no scale to measure a seam against, so it gets nothing.
 * An explicit count is obeyed as given — that is what it is for.
 */
function planSeamFill(request, seam, step) {
  if (request === "none") return 0;
  if (request !== "auto") return request;
  if (!(step > 0) || seam <= seamLimit(step)) return 0;
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
function zeroLoopFrames(framesDir, count, cell, threshold, plate = null) {
  const frameBytes = cell.width * cell.height * 4;
  const batch = Math.max(1, Math.floor(MAX_RAW_BYTES / 2 / frameBytes));
  let zeroed = 0;
  // The same pass reads every written frame, so it is where `keyResidue` is
  // measured: on the pixels the loop ships, after the crop and the scale.
  const residue = [];
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
    if (plate?.chroma) {
      for (let k = 0; k < take; k++) {
        residue.push(keyResidue({ width: cell.width, height: cell.height, data: data.subarray(k * frameBytes, (k + 1) * frameBytes) }, plate, threshold));
      }
    }
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
  return { zeroed, residue: residueOf(residue) };
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
 * Key a raw rgba plate sequence (`<work>/plate.rgba`, W×H×4 bytes a frame)
 * with the un-mixing keyer into `outDir/%03d.png`, and delete the raw file.
 *
 * The plate is measured first over PLATE_SAMPLE_FRAMES frames spread across
 * the window (`--key auto`; a colour is taken at its word). Frames are then
 * read one at a time from the file, keyed and zeroed in memory, and encoded
 * in batches of at most half of MAX_RAW_BYTES — one ffmpeg spawn per batch,
 * as `zeroLoopFrames` does, so a 300-frame window never sits in memory whole.
 * Returns the plate; a plate that turns out to have no hue is returned
 * unused, for the caller to key with colorkey.
 */
function unmixRawSequence(rawPath, size, outDir, options, label) {
  const { width, height } = size;
  const frameBytes = width * height * 4;
  const count = Math.floor(statSync(rawPath).size / frameBytes);
  if (count > MAX_LOOP_FRAMES) {
    fail(`the window decoded to more than ${MAX_LOOP_FRAMES} frames — narrow it with --trim-start/--trim-end`);
  }
  const fd = openSync(rawPath, "r");
  try {
    // Straight into the buffer the batch is encoded from: no conversion pass.
    const readFrame = (index, into) => {
      if (readSync(fd, into, 0, frameBytes, index * frameBytes) !== frameBytes) {
        fail(`${label}: frame ${index} of the decoded window is short`);
      }
      return { width, height, data: into };
    };
    const plate = count
      ? keyPlate(spreadIndices(count, PLATE_SAMPLE_FRAMES).map((i) => readFrame(i, Buffer.allocUnsafe(frameBytes))), options.key, options.similarity)
      : null;
    if (!plate?.chroma) return plate;
    const radius = keyRadius(options.similarity);
    const batch = Math.max(1, Math.floor(MAX_RAW_BYTES / 2 / frameBytes));
    for (let done = 0; done < count; done += batch) {
      const take = Math.min(batch, count - done);
      const out = Buffer.allocUnsafe(take * frameBytes);
      for (let k = 0; k < take; k++) {
        const image = readFrame(done + k, out.subarray(k * frameBytes, (k + 1) * frameBytes));
        keyFrame(image, plate, { radius });
        zeroKeyedRgb(image, options.threshold);
      }
      ffmpeg([
        "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${width}x${height}`, "-i", "-",
        "-frames:v", String(take), "-pix_fmt", "rgba",
        "-start_number", String(done), "--", join(outDir, "%03d.png"),
      ], `${label} key`, out);
    }
    return plate;
  } finally {
    closeSync(fd);
    rmSync(rawPath, { force: true });
  }
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
  let keyer = null;
  if (keying) {
    let first = null;
    if (options.key === "auto") {
      // Off a RAW frame at the window start, like `contact`: the clip's own
      // idea of the plate, codec drift included.
      const frame = ffmpegTo(join(work, "key.png"), () => [
        "-ss", String(round(start, 3)), "-i", input, "-frames:v", "1", "-pix_fmt", "rgba",
      ], `${label} key frame`);
      first = readRgba(frame);
      keyColor = cornerColor(first);
    } else {
      keyColor = normalizeColor(options.key, "--key");
    }
    keyer = resolveKeyer(
      options.keyer,
      options.keyer === "unmix" ? keyPlate(first ? [first] : [], options.key, options.similarity) : null,
      label,
    );
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

  // --- 2. where the frames come from: the window, or its interpolation ---
  const srcDir = join(work, "src");
  mkdirSync(srcDir, { recursive: true });
  let source;
  let limit;
  let frameFps;
  if (options.fps === null) {
    source = ["-ss", String(start), "-t", String(span), ...decodeArgs, "-i", input];
    limit = MAX_LOOP_FRAMES + 1;
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
    source = ["-framerate", String(options.fps), "-start_number", "0", "-i", join(interpDir, "%03d.png")];
    limit = keep;
    frameFps = options.fps;
  }

  // --- 4. key: one ffmpeg pass (colorkey), or raw frames un-mixed in JS ----
  const decodeKeyed = (color) => {
    const { chain, despill: type } = loopKeyChain(color, options);
    ffmpeg([
      ...source, "-vf", chain.join(","), "-frames:v", String(limit),
      "-start_number", "0", "-pix_fmt", "rgba", "--", join(srcDir, "%03d.png"),
    ], `${label} decode`);
    return type;
  };
  let despill = null;
  if (keyer === "unmix") {
    const raw = join(work, "plate.rgba");
    ffmpeg([...source, "-frames:v", String(limit), "-f", "rawvideo", "-pix_fmt", "rgba", "--", raw], `${label} decode`);
    const plate = unmixRawSequence(raw, size, srcDir, options, label);
    if (plate?.chroma) {
      keyColor = plate.hex;
    } else {
      // Frame 0 had a hue and the window does not: colorkey, on frame 0's colour.
      keyer = resolveKeyer("unmix", plate, label);
      despill = decodeKeyed(keyColor);
    }
  } else {
    despill = decodeKeyed(keyColor);
  }

  const decoded = sequenceCount(srcDir, label);
  if (decoded > MAX_LOOP_FRAMES) {
    fail(`the window decoded to more than ${MAX_LOOP_FRAMES} frames — narrow it with --trim-start/--trim-end`);
  }
  if (decoded < 2) {
    fail(`${label}: ${round(span, 3)}s from ${round(start, 3)}s of ${input} decoded to ${decoded} frame(s) — a loop needs at least two`);
  }
  const fps = round(frameFps ?? decoded / span, 3);
  return { keyColor, keyer, despill, srcDir, decoded, fps };
}

/**
 * Crop `count` decoded frames from `first` to ONE union rect, scale them to
 * the width, write them to `framesDir` as `%03d.png` with the transparent
 * pixels zeroed, and say where they sit in the clip (`crop`, `scale`).
 * Shared by `loop` and `transition`, so a transition's frames sit in clip
 * coordinates exactly the way a loop's do.
 */
function cutClipFrames(srcDir, first, count, size, options, framesDir, { keyed, label, keyColor = null }) {
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
  const { residue } = zeroLoopFrames(framesDir, count, cell, options.threshold, keyColor ? plateOf(keyColor) : null);
  // What maps a frame back onto its clip: frame px = (clip px − crop.xy) ×
  // scale. Every loop is cut to its OWN union box and then scaled to one
  // width, so two loops of one character come out at different scales —
  // tanka's ten were drawn at 1.03-1.42× their clips — and anything that
  // plays them together (the .riv) has to undo that to keep the character
  // one size, and to put each where it stood in its clip. One number: the
  // width ratio, which the height ratio matches to the even-pixel rounding.
  const clipScale = round(outWidth / crop.w, 4);
  return { crop, cell, clipScale, emptyFrames, alphaCoverage, widthDefaulted, outWidth, residue };
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
    const { keyColor, keyer, despill, srcDir, decoded, fps } = decodeClipFrames(input, prep, options, work, "loop");

    // --- 4. holds, and 5. the seam ----------------------------------------
    // Holds on the silhouettes; seam and step on premultiplied colour, the
    // one measure `cycle.mjs` judges every wrap in.
    const { masks, thumbs } = decodeLoopFrames(srcDir, decoded, size, keying || alphaSource, "loop");
    const features = thumbs.map(premultiplied);
    const { first, last } = trimHolds(masks, options.trimHolds);
    const shot = last - first + 1;
    if (shot < 2) {
      fail(`--trim-holds left ${shot} of ${decoded} frames — the clip holds one pose throughout. Pass --no-trim-holds to keep every frame, or shoot a clip that moves.`);
    }
    const kept = adjacentSteps(features).slice(first, last);
    const step = round(median(kept), 4);
    const maxStep = round(Math.max(...kept), 4);
    const dropped = { leading: first, trailing: decoded - 1 - last };
    let seam = round(frameDistance(features[last], features[first]), 4);

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
      const filled = decodeLoopFrames(srcDir, seamFill, size, keying || alphaSource, "loop", last + 1).thumbs.map(premultiplied);
      seam = round(Math.max(...adjacentSteps([features[last], ...filled, features[first]])), 4);
    }
    const count = shot + seamFill;

    const warnings = [];
    const limit = round(seamLimit(step), 4);
    if (seam > limit) {
      warnings.push(seamFill > 0
        ? `the loop does not close — even with ${seamFill} interpolated frame(s) at the wrap the worst step there is ${seam} against a normal step of ${step} (it closes at ${limit}); shoot again with the same image at both ends, or pass --trim-start/--trim-end from the contact sheet`
        : `the loop does not close — the last frame is ${seam} from the first against a normal step of ${step} (it closes at ${limit}); shoot again with the same image at both ends, or pass --trim-start/--trim-end from the contact sheet`);
    }

    // --- 6. crop and scale -------------------------------------------------
    const { crop, cell, clipScale, emptyFrames, alphaCoverage, widthDefaulted, residue } = cutClipFrames(
      srcDir, first, count, size, options, framesDir, { keyed: keying || alphaSource, label: "loop", keyColor },
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
    const residueNote = residueWarning(residue, keyColor);
    if (residueNote) warnings.push(residueNote);
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
      // The bar `seam` was judged against — max(2·step, the noise floor) — so
      // the viewer and `sprite-project.mjs` read the verdict this run gave
      // instead of re-deriving a rule that has since moved.
      seamLimit: limit,
      alphaCoverage,
      ...(keyColor ? { keyColor } : {}),
      ...(residue ? residue : {}),
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
      ...(keyer ? { keyer } : {}),
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
    const { keyColor, keyer, despill, srcDir, decoded, fps } = decodeClipFrames(input, prep, { ...options, fps: null }, work, label);
    const warnings = [];

    // --- holds at both ends, collapsed to one frame each ------------------
    const { masks } = decodeLoopFrames(srcDir, decoded, size, true, label);
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
    const { crop, cell, clipScale, emptyFrames, alphaCoverage, widthDefaulted, residue } = cutClipFrames(
      pickedDir, 0, count, size, options, framesDir, { keyed: true, label, keyColor },
    );
    warnings.push(...listAndTruncate(emptyFrames, (i) => `frame ${loopFrameName(i).slice(0, 3)} is empty`));
    const residueNote = residueWarning(residue, keyColor);
    if (residueNote) warnings.push(residueNote);

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
      ...(residue ? residue : {}),
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
      ...(keyer ? { keyer } : {}),
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

/**
 * `paths` flipped left to right into `outDir` as 0-based numbered PNGs
 * (`digits` wide), in one ffmpeg pass. `hflip` only reorders pixels, so every
 * RGBA value survives exactly. Staged in a scratch directory inside `outDir`
 * and renamed into place, so nobody reads half a set; the frames must share
 * one size, as a motion's do.
 */
function flipImages(paths, outDir, digits, label) {
  mkdirSync(outDir, { recursive: true });
  const scratch = mkdtempSync(join(outDir, ".flip-"));
  try {
    const staged = join(scratch, "in");
    const flipped = join(scratch, "out");
    mkdirSync(staged);
    mkdirSync(flipped);
    const seq = (i) => `${String(i).padStart(4, "0")}.png`;
    paths.forEach((path, i) => copyFileSync(path, join(staged, seq(i))));
    ffmpeg([
      "-start_number", "0", "-i", join(staged, "%04d.png"), "-frames:v", String(paths.length),
      "-vf", "hflip", "-pix_fmt", "rgba", "-start_number", "0", "--", join(flipped, "%04d.png"),
    ], `${label} flip`);
    const written = paths.filter((_, i) => existsSync(join(flipped, seq(i)))).length;
    if (written !== paths.length) fail(`${label}: flipping wrote ${written} of ${paths.length} frames`);
    return paths.map((_, i) => {
      const to = join(outDir, `${String(i).padStart(digits, "0")}.png`);
      renameSync(join(flipped, seq(i)), to);
      return to;
    });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * The other side of a registered side-view motion, free: its frames flipped
 * left to right, then packed, previewed and inspected the way `run` finishes a
 * sheet, with the timing, anchor, scale and columns of the source's atlas.
 * What it prints is a sprite run summary plus `source: "mirror"` and
 * `mirrorOf`, which `register-run` takes. The rules — which motions flip, the
 * asymmetric gate, where the anchor lands — are `mirror.mjs`'s.
 */
function stepMirror(sourceDir, options) {
  const label = "mirror";
  const dir = resolve(sourceDir);
  const ofId = basename(dir);
  const character = readCharacterProject(dirname(dirname(dir)), label);
  const source = character.doc.sprite.motions.find((m) => m && m.id === ofId);
  if (!source) {
    const known = character.doc.sprite.motions.map((m) => m?.id).filter(Boolean).join(", ") || "none";
    fail(`${label}: no motion '${ofId}' in ${character.dir}/project.json (known: ${known})`);
  }
  const refused = mirrorRefusal(source);
  if (refused) fail(`${label}: ${refused}`);
  const { name } = options;
  const facing = MIRRORED[source.direction];
  if (name === ofId) fail(`${label}: --name ${name} is the motion being flipped — a mirror is a motion of its own, named for the side it faces (<state>-${facing})`);
  const motionDir = resolve(options.out ?? join(character.dir, "motions", name));
  const frames = registeredFrames(character, source, label);
  if (motionDir === dir || motionDir === dirname(frames.dir)) {
    fail(`${label}: --out ${motionDir} is where ${ofId}'s frames live — the mirror would overwrite the frames it flips`);
  }

  const warnings = [];
  const sentence = asymmetry(character.doc.sprite.character);
  if (sentence) {
    if (!options.force) {
      fail(`${label}: ${character.name} is asymmetric: "${sentence}" — flipping ${ofId} puts that on the wrong side in every frame. Generate ${name} from its own ${facing} anchor instead (references/prompting.md, "Direction anchors"), or pass --force if the flipped result is acceptable.`);
    }
    warnings.push(`flipped although ${character.name} is asymmetric: "${sentence}" — every frame now has it on the other side; look at ${name} on the stage before calling it done`);
  }

  const facts = readAtlasFacts(character, source, frames.paths.length, label);
  const sourceAtlas = JSON.parse(readFileSync(assetFile(character, source.atlas), "utf-8"));
  const layout = atlasLayout(sourceAtlas);
  const anchor = layout.anchor ?? (source.anchor === "center" ? "center" : "bottom");
  const scale = layout.scale ?? 1;
  // A scaled atlas of pixel art was packed nearest-neighbour; the atlas does
  // not say which filter it used, so the character's own reading decides.
  const nearest = scale !== 1 && riveIsPixelArt(character.doc.sprite.character);

  // The frames and, when the source kept them, its pre-align cells: `inspect`
  // judges "leaves its grid cell" on the cells, and a flip preserves which
  // edge a drawing touches. A cells directory left by an earlier run of this
  // motion describes other frames, so it goes.
  mkdirSync(motionDir, { recursive: true });
  const framesDir = join(motionDir, "frames");
  resetFramesDir(framesDir);
  const flipped = flipImages(frames.paths, framesDir, 2, label);
  const record = readAlignRecord(frames.dir)
    ? JSON.parse(readFileSync(join(frames.dir, ALIGN_RECORD), "utf-8"))
    : null;
  const flippedRecord = mirrorAnchorRecord({
    record, atlas: sourceAtlas, cell: probeSize(flipped[0], label), anchor, mirrorOf: source.id,
  });
  if (flippedRecord) writeJsonFile(join(framesDir, ALIGN_RECORD), flippedRecord);
  const sourceCells = join(dirname(frames.dir), CELLS_DIRNAME);
  const cellsDir = join(motionDir, CELLS_DIRNAME);
  const cellCount = existsSync(sourceCells) ? readdirSync(sourceCells).filter((f) => FRAME_RE.test(f)).length : 0;
  let cells = null;
  if (existsSync(cellsDir)) {
    resetFramesDir(cellsDir);
    if (!readdirSync(cellsDir).length) rmSync(cellsDir, { recursive: true, force: true });
  }
  if (cellCount === flipped.length) {
    flipImages(listFrames(sourceCells).map((entry) => entry.path), cellsDir, 2, label);
    cells = cellsDir;
  }
  // What made the source's cells travels with their flip, as `clean` carries
  // it: the grid they were sliced from (so `inspect` tells a row boundary
  // from an ordinary step) and a breathe's record (so the whole-pixel head's
  // planned holds are not read as a model repeating a drawing). A flip
  // changes neither. Without flipped cells, a breathe's record goes beside
  // the frames, where `inspect` also looks.
  const carry = (fromDir, toDir, names) => {
    for (const name of names) {
      const path = join(fromDir, name);
      if (existsSync(path)) copyFileSync(path, join(toDir, name));
    }
  };
  if (cells) carry(sourceCells, cellsDir, [SLICE_RECORD, BREATHE_RECORD]);
  else carry(sourceCells, framesDir, [BREATHE_RECORD]);
  carry(frames.dir, framesDir, [BREATHE_RECORD]);

  const packed = stepPack(framesDir, {
    out: join(motionDir, "sheet.png"),
    atlas: join(motionDir, "atlas.json"),
    name,
    fps: facts.fps,
    loop: facts.loop,
    anchor,
    cols: layout.cols,
    scale,
    nearest,
  });
  const preview = stepGif(framesDir, {
    out: join(motionDir, "preview.gif"),
    fps: facts.fps,
    loop: facts.loop,
    webp: join(motionDir, "preview.webp"),
    width: null,
  });
  warnings.push(...preview.warnings);
  const { summary } = stepInspect(motionDir, { anchor, threshold: options.threshold, cellsDir: cells });
  warnings.push(...summary.warnings.filter((w) => !warnings.includes(w)));

  return {
    motionDir,
    name,
    source: "mirror",
    mirrorOf: source.id,
    direction: facing,
    ...(cells ? { cells } : {}),
    frames: flipped,
    sheet: packed.sheet,
    atlas: packed.atlas,
    gif: preview.gif,
    ...(preview.webp ? { webp: preview.webp } : {}),
    inspect: summary,
    cell: probeSize(flipped[0], label),
    fps: facts.fps,
    loop: facts.loop,
    anchor,
    scale,
    ...(scale !== 1 ? { nearest } : {}),
    pivot: packed.pivot,
    ...(packed.anchorPoint ? { anchorPoint: packed.anchorPoint } : {}),
    ...(sentence ? { asymmetric: sentence } : {}),
    // `register-run` refuses a mirror of an asymmetric character unless the
    // summary says the flip was forced, so the lock cannot be bypassed by
    // registering a hand-made summary; this is where it is said.
    ...(options.force ? { force: true } : {}),
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
// Exports — a finished motion in the shape somebody else's tool reads
// ---------------------------------------------------------------------------

/** The file a motion export lands in, inside `motions/<id>/exports/`. */
function exportFileName(motionId, format) {
  if (format === "png-seq") return `${motionId}-frames.zip`;
  if (format === "aseprite") return `${motionId}-aseprite.zip`;
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
    const r = frame.frame;
    return {
      pivot: { x: frame.pivot.x, y: frame.pivot.y },
      duration: finite(frame.duration) && frame.duration > 0 ? frame.duration : Math.round(1000 / fps),
      // Where the frame sits in the packed sheet — what the Aseprite export
      // re-describes. Null when the atlas does not say; only that export needs it.
      rect: r && [r.x, r.y, r.w, r.h].every((v) => Number.isInteger(v) && v >= 0) && r.w > 0 && r.h > 0
        ? { x: r.x, y: r.y, w: r.w, h: r.h }
        : null,
    };
  });
  const point = atlas?.meta?.anchorPoint;
  const size = atlas?.meta?.size;
  return {
    path,
    fps,
    loop: atlas?.meta?.loop === true,
    perFrame,
    anchorPoint: point && finite(point.x) && finite(point.y) ? { x: point.x, y: point.y } : null,
    /** `pack --scale`: the cells' size against the aligned frames. */
    scale: finite(atlas?.meta?.scale) && atlas.meta.scale > 0 ? atlas.meta.scale : 1,
    sheetSize: size && Number.isInteger(size.w) && Number.isInteger(size.h) ? { w: size.w, h: size.h } : null,
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
    if (format === "sheet" || format === "atlas" || format === "aseprite") {
      return "a transition has no sprite sheet or atlas — its frames are a sequence (export --format png-seq)";
    }
    return null;
  }
  if (motion.kind !== "loop") return null;
  if (format === "gif") {
    return "a loop is not exported as GIF: GIF has 1-bit alpha and a loop has hundreds of frames — use its WebP or APNG";
  }
  if (format === "sheet" || format === "atlas" || format === "aseprite") {
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
 *
 * Given a CHARACTER directory (it holds the project.json) instead, the one
 * format that describes a whole character on one sheet — Aseprite — is
 * `stepExportCharacter`'s.
 */
function stepExport(target, options) {
  const label = "export";
  const dir = resolve(target);
  if (existsSync(join(dir, "project.json"))) {
    if (!CHARACTER_EXPORT_FORMATS.includes(options.format)) {
      fail(`${label}: ${dir} is a character — a whole character is exported only as --format ${CHARACTER_EXPORT_FORMATS.join(", ")}; one motion is 'export ${join(dir, "motions", "<id>")} --format ${options.format}', and the .riv is 'rive ${dir}'`);
    }
    return stepExportCharacter(dir, options);
  }
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
    // A loop's own WebM is its deliverable and keeps its asset: a shadowed one
    // cannot take its place, so the shadow goes into another video format.
    if (options.shadow && VIDEO_EXPORTS.has(format)) {
      fail(`${label}: '${motion.id}' already ships as ${format}: ${already}, without a shadow — a shadowed video of it is --format mov (keeps the alpha) or mp4`);
    }
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
  // A shadow is cast INTO a video's frames; an engine gets it as a sheet of
  // its own beside the Aseprite one, to place under the sprite itself. Any
  // other format would have to grow its frames around a shadow nobody asked
  // the engine or page to expect.
  const shadow = video || format === "aseprite" ? options.shadow : null;
  if (options.shadow && !shadow) {
    warnings.push(`--shadow ignored: ${format} is handed over as the frames are — mp4, mov and webm cast the shadow into the frames, and aseprite ships it as a sheet of its own`);
  }
  const encoder = { mp4: "libx264", mov: "prores_ks", webm: "libvpx-vp9", apng: "apng" }[format];
  if (encoder && !hasEncoder(encoder)) {
    fail(`${label}: this ffmpeg build has no ${encoder} encoder, which ${format} needs`);
  }

  const first = probeSize(frames.paths[0], label);
  const scale = options.scale;
  let width = first.width * scale;
  let height = first.height * scale;
  const out = join(dir, EXPORTS_DIRNAME, exportFileName(motion.id, format));
  const work = mkdtempSync(join(tmpdir(), "sprite-export-"));
  const report = {
    kind: "export",
    // One motion; `export <characterDir>` reports "character".
    scope: "motion",
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
    shadow: null,
  };

  try {
    let source = scale !== 1 && format !== "aseprite" ? stageScaledFrames(frames, scale, workDir(work, "scaled")) : frames;
    if (video && shadow) {
      // Where the feet are: the atlas pivot a sprite motion is pinned by; a
      // loop or transition has none, so its first frame's feet — the same
      // point the .riv stands it on.
      const pivot = facts.perFrame?.[0]?.pivot;
      const anchor = pivot
        ? { x: pivot.x * width, y: pivot.y * height, from: "atlas" }
        : loopAnchor(source.paths[0]);
      const cast = stageShadowFrames(source, { width, height }, anchor, shadow, workDir(work, "shadow"), label);
      source = cast.frames;
      width = cast.canvas.width;
      height = cast.canvas.height;
      report.shadow = {
        ...shadowRecord(shadow),
        // The foot in the video's frame: the canvas grew around the shadow.
        anchor: { x: round(cast.canvas.anchor.x, 2), y: round(cast.canvas.anchor.y, 2) },
        from: anchor.from,
      };
      notes.push(`Shadow cast from the silhouette about the ${anchor.from === "atlas" ? "atlas pivot" : "first frame's feet"}; the frame grew to ${width}×${height} to hold it, with the figure at (${cast.canvas.frame.x}, ${cast.canvas.frame.y})`);
    }
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
    } else if (format === "aseprite") {
      const built = asepriteBundle(character, [{ motion, facts }], { name: motion.id, scale, shadow, work, label });
      writeBytesAtomic(out, zipStore(built.entries));
      Object.assign(report, {
        duration: round(count / fps, 3),
        sheet: built.sheet,
        tags: built.tags,
        shadow: built.shadow,
        entries: built.entries.length,
      });
      notes.push(...built.notes);
      warnings.push(...built.warnings);
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
    rmSync(work, { recursive: true, force: true });
  }

  report.size = statSync(out).size;
  report.notes = notes;
  report.warnings = warnings;
  return report;
}

/** A fresh subdirectory of an export's scratch space. */
function workDir(work, name) {
  const dir = join(work, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** The shadow's settings as a report and project.json carry them. */
function shadowRecord(shadow) {
  return {
    squash: shadow.squash,
    shear: shadow.shear,
    opacity: shadow.opacity,
    blur: shadow.blur,
    color: toHex(...shadow.color),
  };
}

/**
 * Every frame with its shadow under it (`shadow.mjs` `withShadow`), written
 * as the same numbered PNGs into `outDir`, all on one canvas: the geometry
 * depends on the frame size and the anchor alone. Decoded and encoded in
 * batches — a loop is 400 frames, and one Buffer of them all would not fit.
 */
function stageShadowFrames(source, size, anchor, shadow, outDir, label) {
  const foot = { x: anchor.x, y: anchor.y };
  const canvas = shadowCanvas(size.width, size.height, foot, shadow);
  const pattern = `%0${source.digits}d.png`;
  const frameBytes = size.width * size.height * 4;
  const outBytes = canvas.width * canvas.height * 4;
  const batch = Math.max(1, Math.floor(MAX_RAW_BYTES / 4 / Math.max(frameBytes, outBytes)));
  const count = source.paths.length;
  for (let start = 0; start < count; start += batch) {
    const n = Math.min(batch, count - start);
    const r = spawnSync("ffmpeg", [
      "-v", "error", "-start_number", String(start), "-i", join(source.dir, pattern), "-frames:v", String(n),
      "-f", "rawvideo", "-pix_fmt", "rgba", "-",
    ], { maxBuffer: MAX_RAW_BYTES });
    const got = r.stdout ? Math.floor(r.stdout.length / frameBytes) : 0;
    if (r.error || r.status !== 0 || got !== n) {
      fail(`${label}: could not decode frames ${start}–${start + n - 1} for the shadow (got ${got})${r.stderr ? `\n${String(r.stderr).trim()}` : ""}`);
    }
    const composed = Buffer.alloc(n * outBytes);
    for (let i = 0; i < n; i++) {
      const frame = { width: size.width, height: size.height, data: r.stdout.subarray(i * frameBytes, (i + 1) * frameBytes) };
      withShadow(frame, foot, shadow).data.copy(composed, i * outBytes);
    }
    ffmpeg([
      "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${canvas.width}x${canvas.height}`, "-i", "-",
      "-frames:v", String(n), "-pix_fmt", "rgba", "-start_number", String(start), "--", join(outDir, pattern),
    ], `${label} shadow`, composed);
  }
  return {
    frames: { dir: outDir, paths: source.paths.map((path) => join(outDir, basename(path))), digits: source.digits },
    canvas,
  };
}

/** An integer nearest-neighbour enlargement of a decoded image; 1 returns it. */
function enlargeNearest(image, factor) {
  if (factor === 1) return image;
  const width = image.width * factor;
  const height = image.height * factor;
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy = Math.floor(y / factor);
    for (let x = 0; x < width; x++) {
      const s = (sy * image.width + Math.floor(x / factor)) * 4;
      image.data.copy(data, (y * width + x) * 4, s, s + 4);
    }
  }
  return { width, height, data };
}

/** Copy `src` into `dst` at (x, y), replacing what is there. */
function blitRgba(dst, src, x, y) {
  for (let row = 0; row < src.height; row++) {
    src.data.copy(dst.data, ((y + row) * dst.width + x) * 4, row * src.width * 4, (row + 1) * src.width * 4);
  }
}

/** A blank RGBA image, refused past what one Buffer is allowed to hold. */
function blankRgba(width, height, what, label) {
  const bytes = width * height * 4;
  if (bytes > MAX_RAW_BYTES) {
    fail(`${label}: ${what} would be ${width}x${height} — ${(bytes / 1e6).toFixed(0)} MB, over the ${MAX_RAW_BYTES / 1e6} MB limit; export fewer motions or re-pack them smaller`);
  }
  return { width, height, data: Buffer.alloc(bytes) };
}

const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

/**
 * The files an Aseprite export zips: `<name>/<name>.png` and
 * `<name>/<name>.json` (`aseprite.mjs`), and with `shadow`, the same pair for
 * a shadow sheet — `<name>-shadow.png` / `.json`, frame for frame with the
 * sprite, each frame anchored on the same foot, its tags named
 * `<motion>-shadow` so they do not collide with the motion's own in an
 * engine whose animation names are global (Phaser's).
 *
 * Each part is a READY sprite motion with its atlas facts. Its packed
 * `sheet.png` is re-described, not re-drawn: the rects, durations and pivots
 * are the atlas's, and one motion at --scale 1 ships its sheet byte for
 * byte. Several motions stack their sheets top to bottom; --scale enlarges
 * every sheet nearest-neighbour and its rects with it.
 */
function asepriteBundle(character, parts, { name, scale, shadow, work, label }) {
  const warnings = [];
  const notes = [];
  const sheets = parts.map(({ motion, facts }) => {
    const path = assetFile(character, motion.sheet);
    if (!path || !existsSync(path)) fail(`${label}: motion '${motion.id}' has no sheet.png on disk — re-run its pipeline and register-run`);
    const size = probeSize(path, label);
    const said = facts.sheetSize;
    if (!said || said.w !== size.width || said.h !== size.height) {
      fail(`${label}: ${path} is ${size.width}x${size.height} but its atlas describes ${said ? `a ${said.w}x${said.h} sheet` : "no sheet size"} — re-pack and register-run before exporting`);
    }
    facts.perFrame.forEach((frame, i) => {
      const r = frame.rect;
      if (!r || r.x + r.w > size.width || r.y + r.h > size.height) {
        fail(`${label}: ${facts.path}: frame ${i} ${r ? "lies outside" : "has no rect in"} the ${size.width}x${size.height} sheet — re-pack and register-run before exporting`);
      }
    });
    return { path, width: size.width * scale, height: size.height * scale };
  });
  const layout = stackLayout(sheets);
  const verbatim = parts.length === 1 && scale === 1;
  const images = !verbatim || shadow ? sheets.map((sheet) => enlargeNearest(readRgba(sheet.path), scale)) : null;

  let png;
  if (verbatim) png = readFileSync(sheets[0].path);
  else {
    const whole = blankRgba(layout.width, layout.height, "the sheet", label);
    images.forEach((image, i) => blitRgba(whole, image, layout.offsets[i].x, layout.offsets[i].y));
    png = readFileSync(writeRgbaPng(join(work, `${name}.png`), whole, `${label} aseprite`));
  }
  const doc = asepriteDocument({
    image: `${name}.png`,
    size: { w: layout.width, h: layout.height },
    tags: parts.map(({ motion, facts }, i) => ({
      name: motion.id,
      frames: facts.perFrame.map((frame) => ({
        rect: {
          x: frame.rect.x * scale + layout.offsets[i].x,
          y: frame.rect.y * scale + layout.offsets[i].y,
          w: frame.rect.w * scale,
          h: frame.rect.h * scale,
        },
        duration: frame.duration,
        anchor: frame.pivot,
      })),
    })),
  });
  const entries = [
    { name: `${name}/${name}.png`, data: png },
    { name: `${name}/${name}.json`, data: jsonBytes(doc) },
  ];
  const tooBig = (size, what) => {
    if (Math.max(size.width, size.height) > ENGINE_TEXTURE_SIDE) {
      warnings.push(`${what} is ${size.width}×${size.height}: past ${ENGINE_TEXTURE_SIDE} px on a side, many phones and some WebGL contexts cannot load it as one texture — export fewer motions, or re-pack them with pack --scale`);
    }
  };
  tooBig(layout, "the sheet");

  let shadowReport = null;
  if (shadow) {
    const casts = parts.map(({ motion, facts }, i) => {
      const shadows = facts.perFrame.map((frame) => {
        const r = { x: frame.rect.x * scale, y: frame.rect.y * scale, w: frame.rect.w * scale, h: frame.rect.h * scale };
        const cell = { width: r.w, height: r.h, data: cropBuffer(images[i], r.x, r.y, r.w, r.h) };
        return projectShadow(cell, { x: frame.pivot.x * r.w, y: frame.pivot.y * r.h }, shadow);
      });
      const grid = gridLayout(shadows.length, {
        width: Math.max(...shadows.map((c) => c.width)),
        height: Math.max(...shadows.map((c) => c.height)),
      });
      return { motion, facts, shadows, grid };
    });
    const stack = stackLayout(casts.map(({ grid }) => grid));
    const sheet = blankRgba(stack.width, stack.height, "the shadow sheet", label);
    const shadowDoc = asepriteDocument({
      image: `${name}-shadow.png`,
      size: { w: stack.width, h: stack.height },
      tags: casts.map(({ motion, facts, shadows, grid }, i) => ({
        name: `${motion.id}-shadow`,
        frames: shadows.map((cast, k) => {
          const x = grid.rects[k].x + stack.offsets[i].x;
          const y = grid.rects[k].y + stack.offsets[i].y;
          blitRgba(sheet, cast, x, y);
          return {
            rect: { x, y, w: cast.width, h: cast.height },
            duration: facts.perFrame[k].duration,
            anchor: { x: round(cast.anchor.x / cast.width, 4), y: round(cast.anchor.y / cast.height, 4) },
          };
        }),
      })),
    });
    entries.push(
      { name: `${name}/${name}-shadow.png`, data: readFileSync(writeRgbaPng(join(work, `${name}-shadow.png`), sheet, `${label} shadow`)) },
      { name: `${name}/${name}-shadow.json`, data: jsonBytes(shadowDoc) },
    );
    tooBig(stack, "the shadow sheet");
    shadowReport = { ...shadowRecord(shadow), from: "atlas", sheet: { w: stack.width, h: stack.height } };
    notes.push(`The shadow is a sheet of its own (${name}-shadow.png, tags ${casts.map(({ motion }) => `${motion.id}-shadow`).join(", ")}): play it under the sprite at the same position and frame — each shadow frame is anchored on the same foot.`);
  }
  return {
    entries,
    sheet: { w: layout.width, h: layout.height },
    tags: doc.meta.frameTags.map(({ name: tag, from, to }) => ({ name: tag, from, to })),
    shadow: shadowReport,
    notes,
    warnings,
  };
}

/**
 * `export <characterDir> --format aseprite`: the whole character on one
 * sheet, one frame tag per motion — what Phaser's `createFromAseprite` builds
 * every animation of the character from in one call.
 *
 * Every READY sprite motion goes in, in rail order; a loop or transition is a
 * sequence, never packed, and is left out with the reason (as `rive` leaves
 * loops out unless asked). Like `rive` it reads project.json and never writes
 * it: `register-export` files the zip on the character
 * (`sprite.exports.aseprite`), hung off every frame it holds.
 */
function stepExportCharacter(characterDir, options) {
  const label = "export";
  const character = readCharacterProject(characterDir, label);
  const { format, scale, shadow } = options;
  const warnings = [];
  if (options.repeat !== null) warnings.push(`--repeat ${options.repeat} ignored: a sheet's tags play by their frames' durations — only mp4, mov and webm repeat`);
  if (options.bg !== null) warnings.push(`--bg ${options.bg} ignored: the sheet keeps its transparency — only mp4 takes a background`);

  const included = [];
  const excluded = [];
  for (const motion of character.doc.sprite.motions.filter((m) => m && typeof m.id === "string")) {
    if (motion.kind === "loop" || motion.kind === "transition") {
      excluded.push({ motion: motion.id, reason: `a ${motion.kind} — its frames are a sequence, never packed on a sheet; hand it over as --format png-seq, or in the .riv (rive --include-loops)` });
    } else if (motion.status !== "ready") {
      excluded.push({ motion: motion.id, reason: `not ready (${motion.status ?? "no status"}) — only a finished motion goes on the sheet` });
    } else {
      included.push(motion);
    }
  }
  if (!included.length) {
    fail(`${label}: ${character.name} has no finished sprite motion to put on a sheet${excluded.length ? ` (${excluded.map((e) => `${e.motion}: ${e.reason}`).join("; ")})` : ""}`);
  }
  const parts = included.map((motion) => {
    const frames = registeredFrames(character, motion, label);
    return { motion, frames, facts: readAtlasFacts(character, motion, frames.paths.length, label) };
  });
  if (new Set(parts.map(({ facts }) => facts.scale)).size > 1) {
    warnings.push(`the motions were packed at different scales (${parts.map(({ motion, facts }) => `${motion.id} ${facts.scale}`).join(", ")}), so the character is not one size across its tags — re-pack them at one --scale`);
  }

  const out = join(character.dir, EXPORTS_DIRNAME, `${character.id}-aseprite.zip`);
  const work = mkdtempSync(join(tmpdir(), "sprite-export-"));
  try {
    const built = asepriteBundle(character, parts, { name: character.id, scale, shadow, work, label });
    writeBytesAtomic(out, zipStore(built.entries));
    return {
      kind: "export",
      scope: "character",
      character: character.dir,
      name: character.name,
      format,
      out,
      motions: parts.map(({ motion, facts, frames }, i) => ({
        id: motion.id,
        frames: frames.paths.length,
        fps: facts.fps,
        loop: facts.loop,
        from: built.tags[i].from,
        to: built.tags[i].to,
        atlasScale: facts.scale,
      })),
      excluded,
      // What the file was made FROM: every registered frame of every motion
      // on it — what register-export checks and hangs it off.
      frames: parts.flatMap(({ frames }) => frames.paths),
      frameCount: parts.reduce((sum, { frames }) => sum + frames.paths.length, 0),
      scale,
      sheet: built.sheet,
      tags: built.tags,
      shadow: built.shadow,
      entries: built.entries.length,
      size: statSync(out).size,
      notes: built.notes,
      warnings: [...warnings, ...built.warnings],
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
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

/** The downscale for a character's style: pixel art (`riveIsPixelArt`:
 *  `character.pixel`, else `character.style`) keeps hard pixels only through
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
  // WebP unless asked otherwise — lossless for pixel art, by the reading
  // `--filter auto` uses: `character.pixel` first, the style sentence for a
  // character that has none (`riveIsPixelArt`), the same reading the viewer's
  // Export tab makes. An ffmpeg without libwebp cannot write either: asked
  // for by name, that is refused; by default, the file is still worth making
  // as PNG, larger, and the report says why.
  const spec = character.doc.sprite.character ?? null;
  const pixelArt = riveIsPixelArt(spec);
  let images = askedImages ?? riveDefaultImages(spec);
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
    // A mirror whose source is in the file shows the source's images flipped
    // — unless the source was run again after it was mirrored.
    const mirrorOf = new Map();
    for (const source of sources.filter((s) => s.kind === "sprite" && s.motion.source === "mirror" && typeof s.motion.mirrorOf === "string")) {
      const origin = sources.find((s) => s.motion.id === source.motion.mirrorOf);
      if (!origin) continue;
      if (riveMirrorIsCurrent(source.motion, origin.motion, lookup)) {
        mirrorOf.set(source.motion.id, origin.motion.id);
      } else {
        warnings.push(`${source.motion.id} flips an earlier run of ${origin.motion.id} — it goes in with its own frames; mirror it again ('sprite-sheet.mjs mirror') and register it to draw it from ${origin.motion.id}'s images`);
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
      ...(mirrorOf.has(source.motion.id) ? { mirrorOf: mirrorOf.get(source.motion.id) } : {}),
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

    const scaleFilter = filter === "auto" ? (pixelArt ? "nearest" : "smooth") : filter;
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
    // A shared motion shows its source's embedded frames: a reverse's frame r
    // is the source's planned frame K − 1 − r, a mirror's frame i the
    // source's frame i flipped (`sharedFrames`). A flipped frame is measured
    // as the file draws it — the pixels flipped, the pivot at width − x.
    const byId = new Map(own.map((entry) => [entry.planned.id, entry]));
    for (const entry of own) {
      const { shares, mirrored, sharedFrames } = entry.planned;
      if (!shares) continue;
      const from = byId.get(shares);
      let shown = from.shown;
      if (mirrored) {
        const paths = flipImages(from.shown.map((frame) => frame.path), join(work, `flip-${entry.planned.id}`), 4, label);
        shown = from.shown.map((frame, i) => ({ ...frame, path: paths[i], pivot: { x: frame.width - frame.pivot.x, y: frame.pivot.y } }));
      }
      entry.shown = sharedFrames.map((k) => shown[k]);
      entry.frames = sharedFrames.map((k) => ({ shared: { motion: from.planned.id, index: k, ...(mirrored ? { flip: true } : {}) } }));
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
        notes.push(`${planned.id}: ${planned.shares}'s ${planned.frames} images ${planned.mirrored ? "flipped" : "played backwards"} — nothing more embedded`);
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
      notes.push(`The frames are embedded as lossless WebP — every visible pixel exactly as drawn${askedImages ? "" : `, the default for pixel art (${spec?.pixel && Number(spec.pixel.logicalHeight) > 0 ? "character.pixel" : "character.style"})`}; --images webp makes a smaller, lossy file.`);
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
        ...(planned.mirrored ? { mirrored: true } : {}),
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
// breathe: a breathing idle from one still (breathe.mjs does the pixels)
// ---------------------------------------------------------------------------

/**
 * The sprite character above `start`, if any: the nearest ancestor holding a
 * project.json with a sprite sidecar. Only read, for whether it is pixel art
 * (`character.pixel`, then `character.style` — `riveIsPixelArt`, the one
 * authority). A project.json that does not parse is said, not skipped in
 * silence.
 */
function findCharacterAbove(start, notes) {
  let dir = resolve(start);
  for (let depth = 0; depth < 8; depth++) {
    const path = join(dir, "project.json");
    if (existsSync(path)) {
      try {
        const doc = JSON.parse(readFileSync(path, "utf-8"));
        if (doc?.sprite?.character) {
          const { style, pixel } = doc.sprite.character;
          return { dir, style: String(style ?? ""), ...(pixel && typeof pixel === "object" ? { pixel } : {}) };
        }
      } catch (error) {
        notes.push(`could not read ${path} (${error.message}) — not used to pick --mode`);
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** The character above --out, else above the input, else above the working
 *  directory — where `breathe` and `fit` look for it. */
function characterNear(out, input, notes) {
  return findCharacterAbove(dirname(resolve(out)), notes)
    ?? findCharacterAbove(dirname(resolve(input)), notes)
    ?? findCharacterAbove(process.cwd(), notes);
}

/** Where the character reads "pixel art" from, said the way a note names it. */
const pixelArtSource = (character) =>
  (character?.pixel && Number(character.pixel.logicalHeight) > 0 ? "character.pixel" : "character.style");

/**
 * Which way to move the pixels. `--mode` wins; otherwise the character
 * decides (pixel art → the whole-pixel bake, anything else → smooth), looked
 * up above --out, then above the still, then above the working directory.
 * With neither, the choice is refused rather than guessed: the two modes are
 * wrong for each other's art.
 */
function resolveBreatheMode(asked, { out, still, notes }) {
  const character = characterNear(out, still, notes);
  // `character.pixel` is the one authority for pixel art; a character
  // without it is read off its style sentence (`riveIsPixelArt`).
  const pixelArt = character ? riveIsPixelArt(character) : null;
  const from = pixelArtSource(character);
  if (asked) {
    if (!BREATHE_MODES.includes(asked)) fail(`--mode: expected ${BREATHE_MODES.join(" or ")}, got '${asked}'`);
    if (pixelArt === true && asked === "smooth") notes.push(`${from} says pixel art, but --mode smooth resamples off the pixel grid`);
    if (pixelArt === false && asked === "pixel") notes.push(`${from} does not say pixel art, but --mode pixel moves whole pixels`);
    return { mode: asked, modeFrom: "--mode", character };
  }
  if (!character) {
    fail("breathe: --mode is required when no sprite character (project.json) is found above --out, the still or the working directory — smooth for anti-aliased art, pixel for pixel art");
  }
  return { mode: pixelArt ? "pixel" : "smooth", modeFrom: from, character };
}

/** The edges of the picture its visible pixels touch — where a character
 *  that was cropped by its own image is cut off. */
function edgesTouched(image, threshold) {
  const { bbox } = computeBbox(image, threshold);
  if (!bbox) return [];
  return [
    bbox.y === 0 && "top",
    bbox.y + bbox.h === image.height && "bottom",
    bbox.x === 0 && "left",
    bbox.x + bbox.w === image.width && "right",
  ].filter(Boolean);
}

function stepBreathe(still, options) {
  return bakeStill(still, options).report;
}

/**
 * The bake itself: frames written to `out` (NN.png), the report, and the
 * frames still in hand for a caller that goes on to cut the motion.
 */
function bakeStill(still, { out, frames, depth, breaths, mode: askedMode, rigidY, axisX, torsoHalf, crop = null }) {
  const input = resolve(still);
  const framesDir = resolve(out);
  // resetFramesDir clears NN.png here; a still that IS one of those files
  // would be deleted by the command that reads it.
  if (dirname(input) === framesDir && FRAME_RE.test(basename(input))) {
    fail(`breathe: the still ${input} is a frame in --out, which breathe rewrites — copy the still out first or pick another --out`);
  }
  if (frames > MAX_FRAMES) fail(`--frames ${frames} is over the ${MAX_FRAMES}-frame limit (frame files are two digits)`);
  const notes = [];
  const { mode, modeFrom, character } = resolveBreatheMode(askedMode, { out: framesDir, still: input, notes });
  const image = readRgba(input);

  let baked;
  try {
    baked = bakeBreathe(image, { frames, breaths, depth, mode, rigidY, axisX, torsoHalf });
  } catch (error) {
    if (error instanceof BreatheError) fail(`breathe: ${error.message}`);
    throw error;
  }

  // The motion form trims every frame to what the frames reach plus a pad:
  // one rectangle for all of them, so nothing moves relative to anything.
  const images = crop ? cropToReach(baked.frames, crop.pad) : baked.frames;
  resetFramesDir(framesDir);
  const paths = images.map((frame, i) => writeRgbaPng(join(framesDir, frameName(i)), frame, `breathe frame ${i}`));
  // The frames say what made them, the way cells carry their grid: `inspect`
  // reads this to keep a breathe's planned holds out of its warnings.
  const record = writeJsonFile(join(framesDir, BREATHE_RECORD), {
    kind: "pneuma-sprite-breathe", version: 1, still: input, frames: paths.length, breaths, depth, mode,
  });

  // The anatomy is reported in the STILL's pixel coordinates — the ones
  // --rigid-row / --axis take back. The frames' canvas may have grown up and
  // left by canvas.grew; that offset is the only difference.
  const a = baked.anatomy;
  const { x0, y0 } = a.box;
  const heights = baked.perFrame.map((f) => f.height);
  const offsets = baked.perFrame.map((f) => f.headOffset);
  const identical = baked.perFrame.filter((f) => f.headDiffPx === 0).length;
  if (baked.rigidRows > 0 && identical < baked.perFrame.length) {
    baked.warnings.push(`the head block differs from the still in ${baked.perFrame.length - identical} of ${baked.perFrame.length} frames (up to ${Math.max(...baked.perFrame.map((f) => f.headDiffPx ?? 0))} px)${mode === "pixel" ? " — the outline thinning runs over the whole frame" : ""}`);
  }
  const report = {
    input,
    framesDir,
    frames: paths,
    frameCount: paths.length,
    breatheRecord: record,
    breaths,
    depth,
    lag: DEFAULT_LAG,
    mode,
    modeFrom,
    character: character ? { dir: character.dir, style: character.style } : null,
    canvas: baked.canvas,
    anatomy: {
      box: { x: x0, y: y0, w: a.width, h: a.height },
      axisX: x0 + a.axisX,
      neckY: y0 + a.neckRow,
      neckSource: a.neckSource,
      rigidY: y0 + a.rigidRow,
      rigidSource: a.rigidSource,
      basisY: y0 + a.basisRow,
      rigidRows: baked.rigidRows,
      torsoHalf: a.torsoHalf,
      torsoSource: a.torsoSource,
      maxHalf: a.maxHalf,
      appendage: hasAppendage(a),
      face: a.face ? { top: y0 + a.face.top, bottom: y0 + a.face.bottom } : null,
      straddle: baked.straddle,
    },
    strain: round(baked.strain, 4),
    height: { still: a.height, min: Math.min(...heights), max: Math.max(...heights) },
    headOffset: { min: Math.min(...offsets), max: Math.max(...offsets) },
    headIdenticalFrames: baked.rigidRows > 0 ? identical : null,
    perFrame: baked.perFrame.map((f, i) => ({
      index: f.index, file: basename(paths[i]), phase: round(f.phase, 4),
      height: f.height, headOffset: f.headOffset, headDiffPx: f.headDiffPx,
    })),
    notes,
    warnings: baked.warnings,
  };
  return { report, image, images, anatomy: a, overridden: { rigidY: rigidY !== null, axisX: axisX !== null, torsoHalf: torsoHalf !== null } };
}

/**
 * Every frame cut to the one rectangle all of them reach (any alpha), plus
 * `pad` px of transparency on every side. The bake keeps the still's canvas —
 * an untrimmed upload's whole width — and grows it only where the stretch
 * needs; this is what makes the motion's cell the character plus a pad
 * whatever the still's framing, and keeps the ink off the cell edge, where
 * `inspect` would read it as a drawing that left its grid cell.
 */
function cropToReach(frames, pad) {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (const frame of frames) {
    const { bbox } = computeBbox(frame, 1);
    if (!bbox) continue;
    x0 = Math.min(x0, bbox.x); y0 = Math.min(y0, bbox.y);
    x1 = Math.max(x1, bbox.x + bbox.w); y1 = Math.max(y1, bbox.y + bbox.h);
  }
  if (x1 < 0) return frames;
  const box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  return frames.map((frame) => padRgba(cropRgba(frame, box), pad));
}

/**
 * Warnings of the bake that ask for a decision, as opposed to notes on how
 * the anatomy was read. Upstream's detector tags its notes (`face-absent:`,
 * `neck-absent:`, `*-override:`); an untagged warning — a prop across the
 * rigid row, pixel mode on anti-aliased art, too few frames a breath, the
 * soles moving — is one the user may have to choose on, so it goes where the
 * stage shows warnings. The head check is a note in pixel mode, where the
 * outline thinning is expected to touch the head.
 */
const BREATHE_NOTE_TAGS = ["face-absent:", "neck-absent:", "axis-x-override:", "rigid-row-override:", "torso-half-override:"];
function splitBreatheWarnings(report) {
  const decide = [];
  const notes = [];
  for (const warning of report.warnings) {
    const tagged = BREATHE_NOTE_TAGS.some((tag) => warning.startsWith(tag));
    const expectedHead = report.mode === "pixel" && warning.startsWith("the head block differs");
    (tagged || expectedHead ? notes : decide).push(warning);
  }
  return { decide, notes };
}

/**
 * breathe --name: the whole motion from one still, the way `run` is for a
 * sheet — bake into <motionDir>/cells, then the same align/pack/gif/inspect
 * half every source ends with. The JSON is the run summary `register-run`
 * takes for a breathe.
 */
function stepBreatheRun(still, options) {
  const input = resolve(still);
  if (!existsSync(input)) fail(`file not found: ${input}`);
  const motionDir = resolve(options.out);
  const cellsDir = join(motionDir, CELLS_DIRNAME);
  const framesDir = join(motionDir, "frames");
  // Both directories are cleared before anything is written into them.
  if ([cellsDir, framesDir].includes(dirname(input)) && FRAME_RE.test(basename(input))) {
    fail(`breathe: the still ${input} is a frame of ${motionDir}, which this run rewrites — copy it out and register the copy as a reference (add-ref --derived-from <frame id>), then breathe that`);
  }
  mkdirSync(motionDir, { recursive: true });
  const { report, image: stillImage, images, anatomy, overridden } = bakeStill(input, {
    out: cellsDir,
    frames: options.frames,
    depth: options.depth,
    breaths: options.breaths,
    mode: options.mode,
    rigidY: options.rigidY,
    axisX: options.axisX,
    torsoHalf: options.torsoHalf,
    crop: { pad: options.pad },
  });
  const { decide, notes } = splitBreatheWarnings(report);
  const cut = edgesTouched(stillImage, options.threshold);
  if (cut.length) {
    decide.push(`the character touches the ${cut.join(" and ")} edge${cut.length > 1 ? "s" : ""} of the still — part of it may be cut off there; look at ${basename(input)}`);
  }

  // The cells are in hand: measured here, not decoded again.
  const measures = images.map((frame) => measureFrame(frame, options.threshold));
  const sourceCell = { width: images[0].width, height: images[0].height };
  const warnings = [];
  const { aligned, packed, preview, summary } = finishMotion(motionDir, cellsDir, {
    name: options.name,
    fps: options.fps,
    loop: true,
    anchor: "bottom",
    xFrom: "cell",
    cell: null,
    pad: options.pad,
    smooth: false,
    threshold: options.threshold,
    cols: null,
    scale: 1,
    nearest: report.mode === "pixel",
    webp: options.webp,
    width: options.width,
    keyColor: null,
    extraWarnings: decide,
  }, { measures, sourceCell, warnings });

  const anyOverride = overridden.rigidY || overridden.axisX || overridden.torsoHalf;
  return {
    ...report,
    motionDir,
    name: options.name,
    source: "breathe",
    still: input,
    breathe: {
      depth: report.depth,
      breaths: report.breaths,
      lag: report.lag,
      mode: report.mode,
      // In the still's pixels — what --rigid-row / --axis / --torso take back.
      anatomy: {
        rigidRow: report.anatomy.rigidY,
        axisX: report.anatomy.axisX,
        from: anyOverride ? "override" : "detected",
        // A manual torso band changes what is pushed rather than stretched,
        // so a re-run has to be told it again; a detected one is found again.
        ...(overridden.torsoHalf ? { torsoHalf: anatomy.torsoHalf } : {}),
      },
    },
    grid: packed.grid,
    cells: cellsDir,
    framesDir,
    frames: aligned.frames.map((f) => f.path),
    sheet: packed.sheet,
    atlas: packed.atlas,
    gif: preview.gif,
    ...(preview.webp ? { webp: preview.webp } : {}),
    inspect: summary,
    cell: aligned.cell,
    fps: options.fps,
    loop: true,
    anchor: "bottom",
    xFrom: aligned.xFrom,
    scale: 1,
    notes: [...report.notes, ...notes],
    warnings,
  };
}

/**
 * fit: a cut-out trimmed to the character plus a pad and brought down to the
 * size it plays at (`still.mjs`), so the reference registered for a breathe is
 * the very picture its frames are warped from.
 */
function stepFit(inputRaw, { out, max, pad, threshold }) {
  const input = resolve(inputRaw);
  if (!existsSync(input)) fail(`file not found: ${input}`);
  const output = resolve(out);
  if (extname(output).toLowerCase() !== ".png") fail(`--out must be a .png path (got ${out}) — it has to carry alpha`);
  const image = readRgba(input);
  const measured = computeBbox(image, threshold);
  if (!measured.bbox) fail(`fit: nothing in ${input} is visible above alpha ${threshold}`);
  if (measured.coverage >= OPAQUE_COVERAGE) {
    fail(`fit: ${basename(input)} has no transparent background (${(measured.coverage * 100).toFixed(1)}% opaque) — cut the character out first: remove-background.mjs for a busy or photographic background, 'key' for a flat plate`);
  }
  const notes = [];
  const warnings = [];
  const cleaned = cleanCell(image, threshold);
  const { bbox } = computeBbox(image, threshold);
  const cut = edgesTouched(image, threshold);
  if (cut.length) {
    warnings.push(`the character touches the ${cut.join(" and ")} edge${cut.length > 1 ? "s" : ""} of the image — part of it may be cut off there; look before breathing it`);
  }
  const character = characterNear(output, input, notes);
  const pixelArt = character ? riveIsPixelArt(character) : false;
  let fitted;
  try {
    fitted = fitStill(image, { box: bbox, max, pad, resample: !pixelArt });
  } catch (error) {
    if (error instanceof StillError) fail(`fit: ${error.message}`);
    throw error;
  }
  if (pixelArt && fitted.needed < 1) {
    notes.push(`${pixelArtSource(character)} says pixel art, which is never resampled here: the character stays ${bbox.w}x${bbox.h} (over --max ${max})`);
  }
  mkdirSync(dirname(output), { recursive: true });
  writeRgbaPng(output, fitted.image, "fit");
  return {
    input,
    output,
    width: fitted.image.width,
    height: fitted.image.height,
    box: bbox,
    character: fitted.character,
    scale: round(fitted.scale, 4),
    pad,
    max,
    pixelArt,
    ...(cleaned.removedComponents ? { cleaned: { removedComponents: cleaned.removedComponents, removedPixels: cleaned.removedPixels } } : {}),
    notes,
    warnings,
  };
}

/** The anatomy, said the way you would check it against the still. */
function breatheLines(out) {
  const a = out.anatomy;
  const g = out.canvas.grew;
  const grew = [g.left && `left ${g.left}`, g.top && `top ${g.top}`, g.right && `right ${g.right}`].filter(Boolean);
  const signed = (v) => (v > 0 ? `+${v}` : String(v));
  return [
    `breathe: ${out.frameCount} frames, ${out.breaths} breath${out.breaths > 1 ? "s" : ""}, depth ${out.depth}, ${out.mode} (${out.modeFrom}) → ${out.framesDir}`,
    `anatomy: body axis x=${a.axisX} · neck y=${a.neckY} (${a.neckSource}) · rigid y=${a.rigidY} (${a.rigidSource}) · face ${a.face ? `y=${a.face.top}..${a.face.bottom}` : "not found"} · torso half-width ${a.torsoHalf}px, widest ${a.maxHalf}px${a.appendage ? " (reaches sideways: pushed, not stretched)" : ""}`,
    `height ${out.height.still}px → ${out.height.min}..${out.height.max}px · head offset ${signed(out.headOffset.min)}..${signed(out.headOffset.max)}px${out.headIdenticalFrames === null ? "" : ` · head identical to the still in ${out.headIdenticalFrames}/${out.frameCount} frames`}`,
    `canvas ${out.canvas.width}x${out.canvas.height}${grew.length ? ` (grew ${grew.join(", ")} px to fit the stretch)` : ""}`,
    ...out.notes,
    ...(out.warnings.length ? out.warnings : ["no warnings"]),
  ];
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const COMMON = { json: { type: "boolean", default: false }, help: { type: "boolean", short: "h", default: false } };

/** The lattice flags `pixel` and `run --pixel` share. */
function pixelOptions() {
  return {
    palette: { type: "string" }, repalette: { type: "boolean", default: false },
    "palette-size": { type: "string" }, "pitch-hint": { type: "string" },
    outline: { type: "boolean", default: false }, "outline-strength": { type: "string" },
    "no-detail-bias": { type: "boolean", default: false }, "logical-height": { type: "string" },
  };
}

const OPTIONS = {
  breathe: {
    out: { type: "string" }, frames: { type: "string" }, depth: { type: "string" }, breaths: { type: "string" },
    mode: { type: "string" }, "rigid-row": { type: "string" }, axis: { type: "string" }, torso: { type: "string" },
    name: { type: "string" }, fps: { type: "string" }, pad: { type: "string" }, width: { type: "string" },
    "no-webp": { type: "boolean", default: false }, threshold: { type: "string" },
  },
  guide: { rows: { type: "string" }, cols: { type: "string" }, cell: { type: "string" }, out: { type: "string" }, margin: { type: "string" } },
  fit: { out: { type: "string" }, max: { type: "string" }, pad: { type: "string" }, threshold: { type: "string" } },
  probe: { threshold: { type: "string" } },
  key: {
    out: { type: "string" }, color: { type: "string" }, similarity: { type: "string" },
    blend: { type: "string" }, threshold: { type: "string" }, keyer: { type: "string" },
  },
  flatten: {
    out: { type: "string" }, bg: { type: "string" }, similarity: { type: "string" }, threshold: { type: "string" },
    room: { type: "string" }, headroom: { type: "string" }, lead: { type: "string" }, trail: { type: "string" },
    facing: { type: "string" },
  },
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
  inspect: { anchor: { type: "string" }, threshold: { type: "string" }, cells: { type: "string" }, key: { type: "string" } },
  run: {
    rows: { type: "string" }, cols: { type: "string" }, out: { type: "string" }, name: { type: "string" },
    alpha: { type: "string" }, force: { type: "boolean", default: false },
    fps: { type: "string" }, loop: { type: "boolean", default: false }, "no-loop": { type: "boolean", default: false },
    anchor: { type: "string" }, "x-from": { type: "string" },
    key: { type: "string" }, cell: { type: "string" }, pad: { type: "string" },
    smooth: { type: "boolean", default: false }, scale: { type: "string" }, nearest: { type: "boolean", default: false },
    margin: { type: "string" }, gutter: { type: "string" }, width: { type: "string" },
    "no-webp": { type: "boolean", default: false }, threshold: { type: "string" },
    similarity: { type: "string" }, blend: { type: "string" }, keyer: { type: "string" },
    "no-clean": { type: "boolean", default: false },
    pixel: { type: "boolean", default: false },
    ...pixelOptions(),
  },
  pixel: {
    out: { type: "string" }, scale: { type: "string" }, threshold: { type: "string" },
    ...pixelOptions(),
  },
  recolor: { map: { type: "string" }, variant: { type: "string" } },
  "recolor-palette": { out: { type: "string" }, force: { type: "boolean", default: false } },
  contact: {
    out: { type: "string" }, count: { type: "string" }, every: { type: "string" },
    cols: { type: "string" }, width: { type: "string" },
    "trim-start": { type: "string" }, "trim-end": { type: "string" },
    key: { type: "string" }, similarity: { type: "string" }, blend: { type: "string" },
    threshold: { type: "string" }, gait: { type: "string" },
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
    keyer: { type: "string" },
    "no-clean": { type: "boolean", default: false }, "body-height": { type: "string" },
  },
  retime: {
    keep: { type: "string" }, out: { type: "string" }, fps: { type: "string" },
  },
  loop: {
    out: { type: "string" }, name: { type: "string" },
    "trim-start": { type: "string" }, "trim-end": { type: "string" },
    key: { type: "string" }, similarity: { type: "string" }, blend: { type: "string" },
    despill: { type: "boolean", default: false }, "no-despill": { type: "boolean", default: false },
    keyer: { type: "string" },
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
    keyer: { type: "string" },
    "trim-holds": { type: "boolean", default: false }, "no-trim-holds": { type: "boolean", default: false },
    crop: { type: "string" }, pad: { type: "string" }, width: { type: "string" }, threshold: { type: "string" },
  },
  lineup: { hub: { type: "string" }, out: { type: "string" } },
  export: {
    format: { type: "string" }, bg: { type: "string" }, repeat: { type: "string" }, scale: { type: "string" },
    shadow: { type: "boolean", default: false },
    "shadow-squash": { type: "string" }, "shadow-shear": { type: "string" }, "shadow-opacity": { type: "string" },
    "shadow-blur": { type: "string" }, "shadow-color": { type: "string" },
  },
  rive: {
    images: { type: "string" }, motions: { type: "string" }, "include-loops": { type: "boolean", default: false },
    fps: { type: "string" }, "max-size": { type: "string" }, filter: { type: "string" }, hub: { type: "string" },
  },
  mirror: { name: { type: "string" }, out: { type: "string" }, force: { type: "boolean", default: false } },
};

/** `--keyer unmix|colorkey`. */
function pickKeyer(value) {
  if (value === undefined) return DEFAULT_KEYER;
  if (!KEYERS.includes(value)) fail(`--keyer: expected ${KEYERS.join(" or ")}, got '${value}'`);
  return value;
}

/** --blend and --despill tune ffmpeg's colorkey chain; the un-mixing keyer has
 *  no use for either. Said on stderr rather than dropped in silence — they
 *  still apply when the plate turns out to have no hue and colorkey runs. */
function noteUnmixIgnores(values, label) {
  if (pickKeyer(values.keyer) !== "unmix") return;
  const given = [values.blend !== undefined && "--blend", values.despill === true && "--despill"].filter(Boolean);
  if (!given.length) return;
  console.error(`${label}: ${given.join(" and ")} ${given.length > 1 ? "tune" : "tunes"} the colorkey chain and --keyer unmix ignores ${given.length > 1 ? "them" : "it"} — used only if the plate has no hue and colorkey runs instead`);
}

/** A report's `keyResidue`, said the way a human line says it. */
function residueLine(report) {
  return typeof report.keyResidue === "number"
    ? [`keyResidue ${report.keyResidue} (visible pixels carrying the plate${typeof report.keyResidueEdge === "number" ? `; ${report.keyResidueEdge} of the soft edge` : ""}${typeof report.keyFringe === "number" ? `; fringe ${report.keyFringe} of the edge` : ""})`]
    : [];
}

/** `--gait walk|run`, or null: which gait floor `contact` holds a period to. */
function pickGait(value) {
  if (value === undefined) return null;
  if (!GAIT_KINDS.includes(value)) fail(`--gait: expected ${GAIT_KINDS.join(" or ")}, got '${value}'`);
  return value;
}

/** The lattice flags, parsed once for `pixel` and `run --pixel`. `--scale`
 *  there is a whole-number upscale: pixel art is never resampled by a
 *  fraction. `--outline-strength` alone turns the outline on. */
function pickPixelOptions(values) {
  const scale = num(values.scale, "--scale", { fallback: 1 });
  if (!Number.isInteger(scale) || scale < 1 || scale > MAX_PIXEL_SCALE) {
    fail(`--scale: pixel art scales by a whole number from 1 to ${MAX_PIXEL_SCALE}, got '${values.scale}'`);
  }
  const outlineStrength = num(values["outline-strength"], "--outline-strength", { min: 0, fallback: DEFAULT_OUTLINE_STRENGTH });
  if (outlineStrength > 1) fail(`--outline-strength: expected a number from 0 to 1, got '${values["outline-strength"]}'`);
  const paletteSize = num(values["palette-size"], "--palette-size", { integer: true, min: 2, fallback: DEFAULT_PALETTE_SIZE });
  if (paletteSize > 256) fail(`--palette-size: expected at most 256 colours, got ${paletteSize}`);
  return {
    scale,
    palette: values.palette ?? null,
    repalette: values.repalette,
    paletteSize,
    pitchHint: values["pitch-hint"] === undefined ? null : num(values["pitch-hint"], "--pitch-hint", { min: 2 }),
    logicalHeight: values["logical-height"] === undefined ? null : num(values["logical-height"], "--logical-height", { integer: true, min: 1 }),
    outline: values.outline || values["outline-strength"] !== undefined,
    outlineStrength,
    detailBias: !values["no-detail-bias"],
  };
}

/** One line per pixel step, for the human output. */
function pixelLines(out) {
  const own = out.perFrame.filter((f) => f.source === "own").length;
  const height = out.logicalHeight;
  return [
    `pixel: ${out.frames.length} frames at pitch ${out.pitch.x}x${out.pitch.y} (${own} on their own pitch) → ${out.logicalCell.width}x${out.logicalCell.height} logical px x${out.scale} → ${out.outDir}`,
    `palette: ${out.palette.colors} colours ${out.palette.pinned ? "from the pinned" : "built and pinned to"} ${out.palette.file}`,
    ...(height ? [`height: ${height.measured} logical px, declared ${height.declared} — ${height.honoured ? "held" : "MISSED"}`] : []),
  ];
}

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
    ...residueLine(out.inspect),
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
function exportColor(value, flag = "--bg") {
  const color = String(value).trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(color)) fail(`${flag}: expected a #rrggbb colour, got '${value}'`);
  return color;
}

/**
 * `--shadow` and its tuning flags → the options `shadow.mjs` takes, or null.
 * A tuning flag without `--shadow` is refused rather than read as "yes": the
 * shadow changes the size of the file, which nobody should get by accident.
 */
function pickShadow(values) {
  const tuned = ["squash", "shear", "opacity", "blur", "color"].filter((name) => values[`shadow-${name}`] !== undefined);
  if (!values.shadow) {
    if (tuned.length) fail(`--shadow-${tuned[0]} tunes the shadow — pass --shadow with it`);
    return null;
  }
  const options = { ...SHADOW_DEFAULTS, color: [...SHADOW_DEFAULTS.color] };
  for (const name of ["squash", "shear", "opacity", "blur"]) {
    const raw = values[`shadow-${name}`];
    if (raw === undefined) continue;
    const [low, high] = SHADOW_RANGES[name];
    const value = Number(raw);
    if (!Number.isFinite(value) || value < low || value > high) {
      fail(`--shadow-${name}: expected a number from ${low} to ${high}, got '${raw}'`);
    }
    options[name] = value;
  }
  if (values["shadow-color"] !== undefined) {
    const hex = exportColor(values["shadow-color"], "--shadow-color");
    options.color = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  }
  return options;
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
    case "guide": {
      if (positionals.length) fail(`guide: unexpected argument '${positionals[0]}' — the grid comes from --rows, --cols and --cell`);
      const cell = parseCell(requireFlag(values.cell, "--cell"));
      if (!cell) fail("--cell: the guide needs the generation cell in pixels, WxH");
      let geometry;
      try {
        geometry = guideGeometry({
          rows: num(requireFlag(values.rows, "--rows"), "--rows", { integer: true, min: 1 }),
          cols: num(requireFlag(values.cols, "--cols"), "--cols", { integer: true, min: 1 }),
          cell,
          margin: num(values.margin, "--margin", { min: 0, fallback: DEFAULT_SAFE_MARGIN_RATIO }),
        });
      } catch (error) {
        fail(error.message);
      }
      const output = writeRgbaPng(requireFlag(values.out, "--out"), guideRaster(geometry), "guide");
      const { rows, cols, width, height, safeMargin } = geometry;
      emit(values, { output, rows, cols, cell, safeMargin, width, height }, [
        `guide ${cols}x${rows} of ${cell.width}x${cell.height} (safe inset ${safeMargin.x}x${safeMargin.y}) → ${output} (${width}x${height})`,
      ]);
      break;
    }
    case "probe": {
      const out = stepProbe(requirePositional(positionals, "<image>"), threshold);
      emit(values, out, [
        `${out.width}x${out.height}  alpha=${out.hasAlpha ? "yes" : "no"}  coverage=${(out.alphaCoverage * 100).toFixed(1)}%  corner=${out.cornerColor}`,
      ]);
      break;
    }
    case "key": {
      noteUnmixIgnores(values, "key");
      const out = stepKey(requirePositional(positionals, "<image>"), {
        out: requireFlag(values.out, "--out"),
        color: values.color ?? "auto",
        similarity: num(values.similarity, "--similarity", { min: 0, fallback: DEFAULT_SIMILARITY }),
        blend: num(values.blend, "--blend", { min: 0, fallback: DEFAULT_BLEND }),
        threshold,
        keyer: pickKeyer(values.keyer),
      });
      emit(values, out, [
        `keyed ${out.color} with ${out.keyer} → ${out.output} (coverage now ${(out.alphaCoverage * 100).toFixed(1)}%)`,
        ...residueLine(out),
        ...out.warnings,
      ]);
      break;
    }
    case "flatten": {
      const room = values.room ?? null;
      if (room !== null && !ROOM_SHAPES.includes(room)) {
        fail(`--room: expected ${ROOM_SHAPES.join(", ")}, got '${room}'`);
      }
      // A fraction that shapes nothing is refused rather than ignored: the
      // caller asked for room the canvas would silently not have.
      for (const flag of ["headroom", "lead", "trail", "facing"]) {
        if (values[flag] !== undefined && room === null) fail(`--${flag} shapes a room: pass --room tall|wide|square with it`);
      }
      for (const flag of ["lead", "trail"]) {
        if (values[flag] !== undefined && room !== "wide") fail(`--${flag} only shapes a wide room (--room wide)`);
      }
      if (values.headroom !== undefined && room === "square") fail("--headroom has no effect on a square room — use --room tall or wide");
      if (values.facing !== undefined && values.facing !== "left" && values.facing !== "right") {
        fail(`--facing: expected left or right, got '${values.facing}'`);
      }
      const fraction = (flag) => num(values[flag], `--${flag}`, { min: 0, fallback: undefined });
      const out = stepFlatten(requirePositional(positionals, "<image>"), {
        out: requireFlag(values.out, "--out"),
        bg: values.bg ?? "#ffffff",
        similarity: num(values.similarity, "--similarity", { min: 0, fallback: DEFAULT_VIDEO_SIMILARITY }),
        threshold,
        room,
        headroom: fraction("headroom"),
        lead: fraction("lead"),
        trail: fraction("trail"),
        facing: values.facing ?? null,
      });
      emit(values, out, [
        out.room
          ? `flattened onto ${out.bg} in a ${out.room.shape} room ${out.width}x${out.height} (still at ${out.room.offset.x},${out.room.offset.y}, facing ${out.room.facing}) → ${out.output}`
          : `flattened onto ${out.bg} → ${out.output}`,
        ...out.warnings,
      ]);
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
        // Absent: whatever the motion's last report recorded (undefined).
        ...(values.key === undefined ? {} : { keyColor: normalizeColor(values.key, "--key") }),
      });
      emit(values, report, [
        `${report.frameCount} frames of ${report.cell.width}x${report.cell.height}, anchor drift ${report.anchorDrift.x}/${report.anchorDrift.y}px, body drift ${report.bodyDrift}px, head drift ${report.headDrift}px, max jump ${report.maxJump}px, scale drift ${report.scaleDrift}`,
        ...residueLine(report),
        ...(report.pixel ? [`pixel art at pitch ${report.pixel.pitch.x}x${report.pixel.pitch.y}, ${report.pixel.scale}x — lattice ${report.pixel.held ? "held" : "broken"}`] : []),
        ...(report.warnings.length ? report.warnings : ["no warnings"]),
      ]);
      break;
    }
    case "pixel": {
      const outDir = requireFlag(values.out, "--out");
      const picked = pickPixelOptions(values);
      const { measures, ...out } = stepPixel(requirePositional(positionals, "<framesDir>"), {
        ...picked,
        out: outDir,
        palette: picked.palette ?? join(resolve(outDir), PALETTE_FILENAME),
        threshold,
      });
      emit(values, out, [...pixelLines(out), ...(out.warnings.length ? out.warnings : ["no warnings"])]);
      break;
    }
    case "recolor": {
      const only = values.variant === undefined ? null : values.variant.split(",").map((n) => n.trim()).filter(Boolean);
      if (only && !only.length) fail("--variant: expected colourway names separated by commas, e.g. --variant red-team,blue-team");
      const out = stepRecolor(requirePositional(positionals, "<characterDir|motionDir>"), { map: values.map ?? null, only });
      const n = (v) => v.toLocaleString("en-US");
      emit(values, out, [
        `recolor: ${out.variants.length} colourway(s) × ${out.motions.length} motion(s) of ${out.name} → motions/<id>/${VARIANTS_DIRNAME}/<name>/`,
        ...out.summary.map((s) => `  ${s.name}${s.tolerance ? ` (tolerance ${s.tolerance})` : ""}: ${n(s.substituted)} px swapped by ${s.substitutions.length - s.unmatched.length} of ${s.substitutions.length} entries; ${s.uncovered.colors} colour(s), ${n(s.uncovered.pixels)} px left as they were`),
        ...out.skipped.map((s) => `  left out ${s.motion}: ${s.reason}`),
        ...(out.warnings.length ? out.warnings : ["no warnings"]),
      ]);
      break;
    }
    case "recolor-palette": {
      const out = stepRecolorPalette(requirePositional(positionals, "<characterDir|motionDir>"), { out: values.out ?? null, force: values.force });
      emit(values, out, [
        `recolor-palette: ${out.colors} colour(s) in use across ${out.motions.join(", ")} (+${out.unused} unused in the palette) → ${out.out}`,
        `swatches: ${out.swatches} (each colour's pixels marked in ${out.mark})`,
        ...out.skipped.map((s) => `  left out ${s.motion}: ${s.reason}`),
        ...out.warnings,
      ]);
      break;
    }
    case "run": {
      const key = values.key ?? "auto";
      if (key !== "auto" && key !== "none") normalizeColor(key, "--key");
      const latticeFlags = ["palette", "repalette", "palette-size", "pitch-hint", "outline", "outline-strength", "no-detail-bias", "logical-height"]
        .filter((flag) => values[flag] !== undefined && values[flag] !== false);
      if (!values.pixel && latticeFlags.length) fail(`--${latticeFlags[0]} belongs to the pixel lattice — add --pixel`);
      const picked = values.pixel ? pickPixelOptions(values) : null;
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
        scale: picked ? picked.scale : num(values.scale, "--scale", { min: 0.01, fallback: 1 }),
        nearest: values.nearest,
        margin: num(values.margin, "--margin", { integer: true, min: 0, fallback: 0 }),
        gutter: num(values.gutter, "--gutter", { integer: true, min: 0, fallback: 0 }),
        width: values.width === undefined ? null : num(values.width, "--width", { integer: true, min: 1 }),
        webp: !values["no-webp"],
        threshold,
        similarity: num(values.similarity, "--similarity", { min: 0, fallback: DEFAULT_SIMILARITY }),
        blend: num(values.blend, "--blend", { min: 0, fallback: DEFAULT_BLEND }),
        keyer: pickKeyer(values.keyer),
        clean: !values["no-clean"],
        pixel: values.pixel,
        // The lattice flags; `palette` stays null unless named, and `run`
        // then pins <motionDir>/palette.json.
        ...(picked ?? {}),
      });
      const pixelLine = out.pixel
        ? [`pixel: pitch ${out.pixel.pitch.x}x${out.pixel.pitch.y}, ${out.pixel.logicalCell.width}x${out.pixel.logicalCell.height} logical px x${out.pixel.scale}, ${out.pixel.palette.colors} colours (${out.pixel.palette.pinned ? "pinned" : "built"}: ${out.pixel.palette.file})${out.inspect.pixel ? ` — lattice ${out.inspect.pixel.held ? "held" : "BROKEN"}` : ""}${out.pixel.logicalHeight ? `; ${out.pixel.logicalHeight.measured} px tall, declared ${out.pixel.logicalHeight.declared}${out.pixel.logicalHeight.honoured ? "" : " (MISSED)"}` : ""}`]
        : [];
      emit(values, out, [
        `${out.name}: ${out.frames.length} frames of ${out.cell.width}x${out.cell.height} → ${out.motionDir}`,
        ...residueLine(out.inspect),
        ...pixelLine,
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
        gait: pickGait(values.gait),
      });
      const best = out.loops[0];
      emit(values, out, [
        `${out.tiles.length} stills of ${basename(out.clip)} → ${out.out}`,
        out.stillStart === null
          ? "never moves"
          : `opening pose holds until ${out.stillStart}s`,
        best
          ? `best loop ${best.start}–${best.end}s (period ${best.period}s, periodicity ${out.cycle.periodicity}, seam ${best.seam} vs step ${best.step})`
          : "no loop window found",
        ...out.oneShots.map((shot) => `one-shot ${shot.start}–${shot.end}s: rest → action ${shot.action.start}–${shot.action.end}s → rest`),
        ...out.warnings,
      ]);
      break;
    }
    case "from-video": {
      noteUnmixIgnores(values, "from-video");
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
        keyer: pickKeyer(values.keyer),
        clean: !values["no-clean"],
        bodyHeight: values["body-height"] === undefined
          ? null
          : num(values["body-height"], "--body-height", { integer: true, min: 1 }),
      });
      emit(values, out, [
        `${out.name}: ${out.frames.length} frames of ${out.cell.width}x${out.cell.height} sampled from ${basename(out.video)} at ${out.fps}fps → ${out.motionDir}`,
        ...residueLine(out.inspect),
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
      noteUnmixIgnores(values, "loop");
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
        keyer: pickKeyer(values.keyer),
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
        ...residueLine(out.inspect),
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
      noteUnmixIgnores(values, "transition");
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
        keyer: pickKeyer(values.keyer),
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
      const out = stepExport(requirePositional(positionals, "<motionDir|characterDir>"), {
        format,
        bg: values.bg === undefined ? null : exportColor(values.bg),
        repeat: values.repeat === undefined ? null : num(values.repeat, "--repeat", { integer: true, min: 1 }),
        scale: num(values.scale, "--scale", { integer: true, min: 1, fallback: 1 }),
        shadow: pickShadow(values),
      });
      const mb = `${(out.size / 1e6).toFixed(2)} MB`;
      emit(values, out, [
        out.scope === "character"
          ? `${basename(out.out)} · ${out.motions.map((m) => `${m.id} ${m.from}–${m.to}`).join(", ")} · ${out.frameCount} frames on a ${out.sheet.w}×${out.sheet.h} sheet · ${mb} → ${out.out}`
          : `${basename(out.out)} · ${out.frameCount} frames at ${out.fps} fps, ${out.loop ? "loops" : "plays once"}${out.repeat > 1 ? `, played ${out.repeat}× (${out.duration} s)` : ""} · ${out.width}×${out.height} · ${mb} → ${out.out}`,
        ...(out.excluded ?? []).map((entry) => `left out ${entry.motion}: ${entry.reason}`),
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
        ...out.motions.map((m) => `  ${m.id} (${m.kind}): ${m.shares ? `${m.shares}'s images ${m.mirrored ? "flipped" : "backwards"}` : `${m.frames} frames at ${m.fps} fps, ${m.width}×${m.height} — ${riveMB(m.estimatedDecodeBytes)} MB decoded`}`),
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
    case "breathe": {
      const breaths = num(values.breaths, "--breaths", { integer: true, min: 1, fallback: 1 });
      const intOrNull = (value, flag, min) => (value === undefined ? null : num(value, flag, { integer: true, min }));
      const still = requirePositional(positionals, "<still>");
      const bake = {
        out: requireFlag(values.out, "--out"),
        breaths,
        frames: num(values.frames, "--frames", { integer: true, min: 2, fallback: FRAMES_PER_BREATH * breaths }),
        depth: num(values.depth, "--depth", { min: 0, fallback: DEFAULT_BREATHE_DEPTH }),
        mode: values.mode ?? null,
        rigidY: intOrNull(values["rigid-row"], "--rigid-row", 0),
        axisX: intOrNull(values.axis, "--axis", 0),
        torsoHalf: intOrNull(values.torso, "--torso", 1),
      };
      if (values.name === undefined) {
        // The frames-only form writes NN.png into --out and nothing else; the
        // motion's flags would be silently ignored there.
        const stray = ["fps", "pad", "width", "no-webp"].filter((flag) => values[flag] !== undefined && values[flag] !== false);
        if (stray.length) fail(`${stray.map((f) => `--${f}`).join(", ")} cut${stray.length > 1 ? "" : "s"} a motion — pass --name <motionId> (and --out <motionDir>) for the whole motion`);
        const out = stepBreathe(still, bake);
        emit(values, out, breatheLines(out));
        break;
      }
      const out = stepBreatheRun(still, {
        ...bake,
        name: values.name,
        fps: num(values.fps, "--fps", { min: 1, fallback: BREATHE_FPS }),
        pad: num(values.pad, "--pad", { integer: true, min: 0, fallback: DEFAULT_PAD }),
        width: values.width === undefined ? null : num(values.width, "--width", { integer: true, min: 1 }),
        webp: !values["no-webp"],
        threshold,
      });
      emit(values, out, [
        `${out.name}: ${out.frames.length} frames of ${out.cell.width}x${out.cell.height} breathed from ${basename(out.still)} at ${out.fps}fps → ${out.motionDir}`,
        ...breatheLines(out).slice(1, 3),
        ...out.notes,
        ...(out.warnings.length ? out.warnings : ["no warnings"]),
      ]);
      break;
    }
    case "fit": {
      const out = stepFit(requirePositional(positionals, "<image>"), {
        out: requireFlag(values.out, "--out"),
        max: num(values.max, "--max", { integer: true, min: 8, fallback: DEFAULT_FIT_MAX }),
        pad: num(values.pad, "--pad", { integer: true, min: 0, fallback: DEFAULT_FIT_PAD }),
        threshold,
      });
      emit(values, out, [
        `${out.width}x${out.height} → ${out.output} (character ${out.character.width}x${out.character.height}${out.scale < 1 ? `, scaled ×${out.scale}` : ""}, kept x ${out.box.x}..${out.box.x + out.box.w - 1}, y ${out.box.y}..${out.box.y + out.box.h - 1} of the input)`,
        ...(out.cleaned ? [`dropped ${out.cleaned.removedComponents} speck${out.cleaned.removedComponents > 1 ? "s" : ""} (${out.cleaned.removedPixels} px) clear of the body`] : []),
        ...out.notes,
        ...(out.warnings.length ? out.warnings : ["no warnings"]),
      ]);
      break;
    }
    case "mirror": {
      const out = stepMirror(requirePositional(positionals, "<character>/motions/<motionId>"), {
        name: requireFlag(values.name, "--name"),
        out: values.out,
        force: values.force,
        threshold,
      });
      emit(values, out, [
        `${out.name}: ${out.frames.length} frames of ${out.cell.width}x${out.cell.height}, ${out.mirrorOf} flipped to face ${out.direction} (pivot ${out.pivot.x},${out.pivot.y}) → ${out.motionDir}`,
        ...(out.warnings.length ? out.warnings : ["no warnings"]),
        `register it: sprite-project.mjs register-run --dir <character> --motion ${out.name} --run <this --json>`,
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

#!/usr/bin/env node
/**
 * sprite-project.mjs — the only writer of a character's `project.json`.
 *
 * The file is a `pneuma-craft/project/v1` project (assets + provenance +
 * an empty composition) with a `sprite` sidecar. Every mutation goes through
 * this script so ids, provenance edges and motion state stay consistent; the
 * agent never hand-edits the JSON, and the viewer only ever reads it.
 *
 * Zero npm dependencies: Node built-ins plus ffprobe for asset dimensions.
 * Writes are atomic (scratch file + rename) and every command validates the
 * whole document before it is written, so a rejected command leaves the
 * previous project untouched.
 *
 * Subcommands: init, set-character, add-ref, add-motion, set-motion,
 * sheet-prompt, set-sheet, set-keyframe, register-run, register-export,
 * register-recolor, add-video, set-video, remove-motion, show.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync,
  realpathSync, renameSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";

import {
  GUIDE_DEFAULT, RECOMMENDED_FRAMES, SHEET_FRAME_COUNTS, SHEET_STATES, buildSheetPrompt, sheetGrid,
} from "./sheet-prompt.mjs";
// A breathe's default rate — the rate `add-motion --source breathe` records
// until the run lands with its own (one authority, shared with sprite-sheet.mjs).
import { BREATHE_FPS } from "./breathe.mjs";
// The colourway rules — one authority, shared with sprite-sheet.mjs (which
// bakes them) and the viewer's loader (which reads them back).
import { RecolorError, checkVariant, sameVariant, variantNameProblem } from "./recolor.mjs";

const SCHEMA = "pneuma-craft/project/v1";
const TOOL = "sprite-sheet.mjs";
const DEFAULT_CELL = { width: 256, height: 256 };
const DEFAULT_FPS = 8;

/** `anchor` is one single-pose image facing one direction (`--direction`),
 *  one per direction; the character's direction set is read off them. */
const REF_ROLES = ["turnaround", "portrait", "expression", "anchor", "custom"];
const MOTION_STATUSES = ["planned", "generating", "processing", "ready", "failed"];
const VIDEO_STATUSES = ["generating", "ready", "failed"];
/** Models that MAKE a clip out of images and a prompt. */
const VIDEO_MODELS = ["seedance-2.5", "h3-max"];
const VIDEO_MODES = ["i2v", "first-last", "r2v"];
/** Models that make a clip out of ANOTHER clip: video matting (veed, its
 *  green-screen endpoint veed-gs, bria) and frame interpolation (topaz,
 *  rife). They generate nothing of their own, so they live in their own
 *  list — `--mode i2v --model veed` is not a take anybody can shoot, and
 *  refusing it here is cheaper than explaining it. `veed-gs` and `rife` are
 *  names of their own because each is a different endpoint at a different
 *  price: recording one under its sibling's name would name a model nobody
 *  called. */
const DERIVE_VIDEO_MODELS = ["veed", "veed-gs", "bria", "topaz", "rife", "ffmpeg"];
/** What a derived clip had done to it. `retime` replays the parent's own
 *  frames in another order — a hold cut short, a beat repeated — and invents
 *  no pixel, which is why it is its own op with `ffmpeg` as its only model: a
 *  reorder filed as an `interpolate` claims a paid endpoint ran that did not. */
const VIDEO_OPS = ["matte", "interpolate", "retime"];
const ANCHORS = ["bottom", "center"];
/** Who invents a loop's in-between frames, as recorded in the brief.
 *  `none` keeps the clip's own rate. */
const LOOP_INTERPOLATORS = ["topaz", "rife", "ffmpeg", "none"];
/** The interpolators that aim at a FIXED 60 fps (`interpolate-video.mjs`'s
 *  default target, and `loop --fps 60`). RIFE multiplies the clip's own rate
 *  instead, so the arithmetic below does not apply to it. */
const SIXTY_FPS_INTERPOLATORS = ["topaz", "ffmpeg"];
/** `sprite-sheet.mjs`'s own MAX_LOOP_FRAMES, duplicated because these two
 *  scripts are standalone zero-dependency files installed side by side with
 *  no module between them. A loop's frame files are three digits and the
 *  pipeline refuses more; knowing the number here is what lets the brief warn
 *  about a duration BEFORE the clip is paid for instead of after. */
const MAX_LOOP_FRAMES = 400;
/** The rates an interpolator is actually asked for, high to low — the answer
 *  to "what fits under the ceiling" has to be one somebody would type. */
const LOOP_TARGET_FPS = [60, 48, 30, 24];
/** What a motion is FOR. Absent means a sprite motion — an atlas for a game
 *  engine. A `loop` is a seamless transparent animation for a UI: no sheet,
 *  no atlas, no GIF, and three-digit frame ids because one closed cycle at
 *  full rate is 96–400 frames, not 8–16. */
const MOTION_KINDS = ["loop", "transition"];
/** How a motion's frames were obtained. Absent means "sheet" — every motion
 *  made before the video source existed. `breathe` frames are warps of one
 *  still; `mirror` frames are another motion's flipped left↔right. Both are
 *  recorded by register-run from the run that made them. */
const MOTION_SOURCES = ["sheet", "video", "breathe", "mirror"];
const FACINGS = ["left", "right"];
/** What the user is making — the route. Recorded so a later session does
 *  not ask again; absent means nobody recorded one. */
const PURPOSES = ["game", "loop", "mascot", "animate"];
/** The directions a motion or an anchor faces. `domain.ts`'s DIRECTIONS is
 *  the same list; these two scripts carry their own copies because they are
 *  standalone files. */
const DIRECTIONS = ["front", "back", "left", "right"];
/** The one flip `mirror` makes: a side view into the other side. */
const MIRRORED = { left: "right", right: "left" };
const BREATHE_MODES = ["smooth", "pixel"];

const SUBCOMMANDS = [
  "init", "set-character", "add-ref", "add-motion", "set-motion", "sheet-prompt", "set-sheet", "set-keyframe",
  "register-run", "register-export", "register-recolor", "add-video", "set-video", "remove-motion", "show",
];

/**
 * What `sprite-sheet.mjs export --format` makes, and how each lands as a craft
 * asset. The craft type union is video | image | audio | text and has no
 * archive or runtime-bundle member, so the PNG-sequence zip (and, below, the
 * `.riv`) is filed as the image sequence it holds, with `container` in its
 * metadata saying what the file actually is.
 */
const EXPORT_SPECS = {
  mp4: { type: "video" },
  mov: { type: "video" },
  webm: { type: "video" },
  apng: { type: "image" },
  lottie: { type: "text" },
  "png-seq": { type: "image", container: "zip" },
  // The sheet and its Aseprite JSON (and a shadow pair), zipped.
  aseprite: { type: "image", container: "zip" },
};

/** The exports that belong to the whole character, by `sprite.exports` key:
 *  the `.riv` (`rive`) and the Aseprite sheet of every sprite motion
 *  (`export <characterDir> --format aseprite`). Each is the asset
 *  `<character>-export-<key>`, hung off every frame it holds, with the
 *  motions it holds in its edge's `params.motions`. */
const CHARACTER_EXPORTS = ["riv", "aseprite"];

/** The asset id of a motion's on-demand export. The loop's own exports keep
 *  the ids `register-run` gives them (`<motion>-apng`, …). */
const exportAssetId = (motionId, format) => `${motionId}-export-${format}`;

/**
 * The four frontend-ready exports of a loop run, in the order the panel lists
 * them. `probe` says how the asset is measured; every one of them also carries
 * `metadata.size` in bytes, because the Loop tab prints "1.8 MB" beside a
 * download link and the viewer reads project.json and nothing else.
 */
const LOOP_EXPORTS = [
  { key: "webp", suffix: "webp", type: "image", probe: "image", label: "loop (webp)" },
  { key: "apng", suffix: "apng", type: "image", probe: "image", label: "loop (apng)" },
  { key: "webm", suffix: "webm", type: "video", probe: "video", label: "loop (webm)" },
  { key: "lottie", suffix: "lottie", type: "text", probe: "none", label: "loop (lottie)" },
];

const USAGE = `Usage: sprite-project.mjs <subcommand> [--dir <characterDir>] [options]

The only writer of a character's project.json (craft project file + sprite
sidecar). --dir defaults to the current directory. --json prints one JSON
object on stdout; --at <ms> pins every timestamp (tests and replays).

  init --name <Name> [--description ""] [--style ""] [--cell 256x256]
       [--facing left|right] [--purpose ${PURPOSES.join("|")}]
       [--asymmetric "<sentence>"] [--pixel <height> [--colors N]] [--force]
      Create project.json, creating --dir first if it does not exist yet.
      Refuses to clobber an existing project without --force.
      --purpose records what the user is making (character.purpose): a game
      character, a UI loop, a mascot for an app, or a picture brought to life.
      --asymmetric is one sentence naming what must never flip ("the sword is
      in the right hand"); it stops a mirror and guards every built prompt.
      --pixel declares pixel art (character.pixel.logicalHeight, the
      character's height in logical pixels); --colors the palette size.

  set-character [--description] [--style] [--facing left|right]
                [--purpose ${PURPOSES.join("|")}] [--asymmetric "<sentence>"]
                [--pixel <height>] [--colors N] [--no-pixel]
                [--remove-variant <name,…>]
      Change the character after init; only the flags given change.
      --asymmetric "" takes the sentence back. --no-pixel says the character
      is not pixel art after all: character.pixel goes, and a pinned palette
      and every colourway's files are unregistered (the files stay on disk).
      --remove-variant drops colourways: their record and every motion's
      files for them (unregistered; the files stay on disk).

  add-ref --id <refId> --file <path> --role ${REF_ROLES.join("|")}
          [--direction ${DIRECTIONS.join("|")}] [--label <text>]
          [--prompt <text>] [--model <name>] [--from <assetId,…>]
          [--uploaded | --derived-from <refId|assetId> [--op <word>]]
      Register an identity reference as asset ref-<refId>. Re-adding the same
      id replaces the asset and its edge, whatever type that edge had.
      By default the image was generated here: a 'generate' edge carrying
      --model / --prompt / --from.
      --uploaded says the user brought this file: an 'upload' edge by the
      human, with no parent and no params. It refuses --model / --prompt /
      --from, because none of them happened.
      --derived-from says you cut or cleaned this image out of another
      registered reference — or any registered asset, such as a frame: a
      'derive' edge from it, with params.op (--op, a single word, default
      'crop').
      --role anchor is one single-pose image facing one way, and needs
      --direction; there is one anchor per direction (re-register that id to
      replace it). No other role takes a --direction.

  add-motion --id <motionId> --label <text> --rows R --cols C --fps N
             [--kind ${MOTION_KINDS.join("|")}] [--loop|--no-loop]
             [--anchor ${ANCHORS.join("|")}] [--prompt <text>]
             [--status ${MOTION_STATUSES.join("|")}] [--source ${MOTION_SOURCES.join("|")}]
             [--direction ${DIRECTIONS.join("|")}]
  add-motion --kind transition --from <loopId> --to <loopId> [--id] [--label]
      --source records how the frames will be obtained (a generated sheet, a
      sampled video clip, a breathe of one still, a mirror of another motion)
      before anything is generated. Omitted means sheet; register-run
      corrects it from the run that lands. --source breathe makes --rows /
      --cols and --fps optional (1x1 at 8 fps until the run lands): a
      breathe is drawn on no grid and timed by its run, and register-run
      takes the grid and the fps from it.
      --direction is the way the motion faces; name it <state>-<direction>
      (walk-left) so every export carries the direction in its keys.
      --kind loop declares a seamless transparent animation for a UI instead
      of a sprite atlas: --rows/--cols become optional (a loop has no grid,
      so they default to 1x1), --source defaults to video, and playback loops
      unless --no-loop says otherwise.
      --kind transition declares the clip between two loops for the .riv: it
      starts on --from's frame 0 and ends on --to's. Both must be loops of
      this character, not the same one, and the pair must not have a
      transition yet. The id defaults to <from>-to-<to> and the label to
      "<From label> → <To label>"; it plays once at 24 fps, from a clip.

  set-motion --motion <motionId> [--label] [--fps] [--loop|--no-loop] [--anchor]
             [--prompt [--prompt-parts '<json>']] [--status] [--notes]
             [--direction ${DIRECTIONS.join("|")}]
             [--ack-warnings "<reason>"] [--clear-ack]
             [--brief-duration <s>] [--brief-width <px>]
             [--brief-interpolator ${LOOP_INTERPOLATORS.join("|")}] [--brief-budget <usd>]
      --prompt alone records a prompt written by hand, and drops any recorded
      prompt parts. --prompt-parts records how code built the --prompt given
      with it: {"builder","action","guards":[…],"guide"?:{rows,cols,cell:
      {width,height},safeMargin:{x,y}}} (what sheet-prompt writes).
      --direction on a mirror must stay the opposite of its source's.
      --ack-warnings accepts the motion's remaining inspect warnings with a
      one-sentence reason the user reads on the stage; the numbers stay
      visible. --clear-ack takes it back. Re-registering a run drops the
      acknowledgement with the measurement it covered.
      --brief-* records what the user answered before anything was paid for:
      the cycle length, the width the UI renders it at, who invents the
      in-between frames, and (optionally) the dollar ceiling. The first call
      needs the first three together; later calls may change any one. Only a
      --kind loop motion has a brief, and 'add-video' refuses a generated clip
      on a loop that has none. A duration whose 60fps frame count is over
      ${MAX_LOOP_FRAMES} is warned about here, naming the rate that fits.
      A transition's brief is --brief-duration (how long it plays in the
      .riv) and --brief-budget, both on the first call; width and
      interpolator do not apply. 'add-video' refuses a generated clip on a
      transition without one.

  sheet-prompt --motion <motionId> --action "<the phase plan, by cell>"
               [--frames ${SHEET_FRAME_COUNTS.join("|")}] [--state ${[...SHEET_STATES, "generic"].join("|")}]
               [--guide | --no-guide]
      Build the sheet prompt in code and record it: motion.prompt is the
      text, motion.promptParts how it was built. You write the action — the
      view if it matters, the phases by cell, the secondary motion, the
      blink; the code writes the rest in the grammar of prompting.md: the
      character's style sentence verbatim, the grid and the image size, the
      safe margin, identity over motion, the facing (the motion's direction,
      else the character's), the asymmetry lock, pixel art, the guards for
      the motion's state, the loop closure and the white plate. Printed on
      stdout (the prompt alone; --json adds imageSize, attach and guide).
      --frames redraws the motion's grid for that many frames (8 → 4
      columns × 2 rows). --state overrides the state read off the motion's
      id and label (unknown → generic). --guide adds the layout guide:
      the prompt names it as the last attached image, and the output says
      the 'sprite-sheet.mjs guide' call that draws it. Default: ${GUIDE_DEFAULT ? "on" : "off"}.
      Refused on a loop, a transition, a breathe or a mirror motion.

  set-sheet --motion <motionId> --file <path> [--from <assetId,…>] [--model]
            [--prompt] [--background <text>] [--status ${MOTION_STATUSES.join("|")}]
      Register the generated sheet as <motion>-sheet-raw (id stays stable
      across regenerations). Motion status defaults to processing.
      Call it twice per sheet: '--status generating' BEFORE the image call
      reserves the asset with empty metadata and no file on disk, so the
      stage shows a placeholder; calling it again once the file has landed
      measures it and flips the same asset to ready. A missing file under any
      other status is an error.

  set-keyframe --motion <motionId> --file <path> [--alpha <path>] [--model]
               [--prompt] [--from <assetId,…>] [--status ${MOTION_STATUSES.join("|")}]
      The loop-motion mirror of set-sheet: registers the generated keyframe as
      <motion>-keyframe (the image the clip starts AND ends on), and with
      --alpha its cut-out as <motion>-keyframe-alpha, derived from it.
      '--status generating' is the same placeholder leg set-sheet has; the
      closing call needs only --file (and --alpha), because an omitted
      --model / --prompt / --from KEEPS what the reserving call recorded
      rather than blanking it. Once --alpha has reserved the cut-out, a
      closing call without --alpha is refused: the stage prefers the cut-out,
      so leaving it a placeholder leaves a broken image on screen.
      Refused on a motion that is not --kind loop.

  register-export --report <export.json|->
      Register what 'sprite-sheet.mjs export' or 'rive' just wrote, from its
      --json report (piped: 'sprite-sheet.mjs export … --json |
      sprite-project.mjs register-export --dir <character> --report -').
      A motion export becomes <motion>-export-<format> (mp4, mov, webm, apng,
      lottie, png-seq, aseprite) with a 'derive' edge from every frame it was
      made of and motion.exports[format] naming it; a shadow it cast is
      metadata.shadow { squash, shear, opacity, blur, color }. The character's
      Aseprite sheet (export <characterDir> --format aseprite) becomes
      <character>-export-aseprite, named by sprite.exports.aseprite, derived
      from every frame on it, its motions and tags in params. The
      character's .riv becomes
      <character>-export-riv, derived from every frame of every motion in it
      (loops and transitions included), named by sprite.exports.riv; its
      metadata.frames is what it embeds (a shared reverse embeds nothing),
      metadata.motionCount and transitionCount what it holds, its edge's
      params.sampled the rate and size each motion plays at, and
      params.stateMachine what drives it: { name, hub, number: { name,
      default, values: [{ value, motion }] }, triggers: [{ name, motion }] }.
      A loop the export measured against its clip (no inspect.scale) gets
      motion.clip = { scale, origin, from: "measured" }, which the next
      export and the Export tab's quote reuse. Each carries metadata.size. The report's frames must
      be the ones registered now, and a format the motion already ships (a
      loop's own WebM, APNG or Lottie) is refused. Re-registering replaces the
      asset in place. A later register-run or remove-motion retires the
      exports cut from the frames it replaces, and the .riv and Aseprite
      sheet that held them — the files stay on disk; export again.

  register-recolor --report <recolor.json|->
      Register what 'sprite-sheet.mjs recolor' baked, from its --json report
      (piped: 'sprite-sheet.mjs recolor … --json | sprite-project.mjs
      register-recolor --dir <character> --report -'). The colourways
      ({ name, map, tolerance? }) are recorded once, on the character
      (character.pixel.variants: a changed one replaces its record in place,
      a new one is appended); each motion's sheet, atlas and preview become
      <motion>-variant-<name>-sheet / -atlas / -gif, the sheet and preview
      derived from the motion's frames (step "recolor"), named by
      motion.variants[name]. The report's frames must be the ones registered
      now. A colourway whose map changed unregisters the files other motions
      baked with the old one. A later register-run of a motion unregisters
      its colourway files (bake them again — recolor without --map uses the
      recorded colourways); show lists the ready motions missing one.

  register-run --motion <motionId> --run <run.json|-> [--video <videoId>] [--repin] [--at <ms>]
      Consume a 'sprite-sheet.mjs run' summary: registers sheet-alpha (when
      keyed), every frame, the packed sheet, the atlas, the GIF and the WebP,
      wires their provenance, copies the inspect summary into the motion and
      sets it ready. Re-registering rewrites those assets in place and drops
      only what the previous run left over (the tail of a longer motion), so
      a video keeps the frame it was generated from. The run's intermediate
      'cells' are not registered.
      A 'from-video' summary (source: "video") derives every frame from the
      CLIP instead of a sheet, with params.frameIndex and params.t seconds,
      and sets motion.source = "video". The clip must already be a registered
      video asset (add-video); --video names which one when there is more
      than one, and the newest is used with a note when there is not.
      A 'loop' summary (kind: "loop") has no sheet, atlas or GIF and is not
      asked for one: it registers three-digit frames, the WebP, the APNG, the
      WebM and the Lottie (each with its size in bytes), sets motion.kind =
      "loop", motion.exports, a 1x1 grid and the run's fps, and copies the
      loop's seam / step / alpha coverage into the inspect summary.
      A 'transition' summary (kind: "transition") goes on a transition motion
      with the same from/to: frames only, its crop, scale, step, startGap and
      endGap copied into the inspect summary. A reverse (source: "reverse")
      checks its reverseOf — a transition the other way with as many frames —
      derives frame i from that transition's frame n − 1 − i and sets
      motion.reverseOf. Cutting a transition again retires its exports and
      the .riv that held it, and notes any reverse made from the old cut.
      Any run drops a loop's measured clip record (motion.clip).
      A breathe summary (source: "breathe", from 'sprite-sheet.mjs breathe
      --name') names the still it warped ('still', a path) and 'breathe'
      { depth, breaths, lag, mode, depthX?, anatomy? { rigidRow, axisX, from,
      torsoHalf? } }: the still must already be a registered reference
      (add-ref --uploaded; a cut-out: --derived-from <ref> --op key; a frame
      becomes one with add-ref --derived-from <frame id>), every frame
      derives from it, motion.breathe records the parameters, and the
      motion's grid and fps become the run's (it was drawn on no grid).
      Re-registering after a re-run with other parameters replaces the
      frames and the record in place. A mirror summary (source: "mirror")
      names 'mirrorOf', a
      ready left- or right-facing sprite motion with as many frames: frame i
      derives from its frame i, motion.mirrorOf is set and motion.direction
      becomes the other side. It is refused on a motion another mirror is
      made from, and on an asymmetric character unless the summary carries
      force: true (sprite-sheet.mjs mirror --force). A later run of either
      shape's opposite drops the record. Re-running a motion notes each
      mirror made from it.
      A run carrying 'pixel': { palette: { file, colors } } (what run --pixel
      writes; a bare path is accepted too) pins that palette on a pixel-art
      character as <character>-palette (character.pixel.palette), derived
      from this run's frames — once: a later run quantised to a different
      palette, or to the pinned file after its bytes changed, is refused
      unless --repin, which re-pins it and warns that the other motions were
      quantised to the old one.

  add-video --motion <motionId> --file <path> --model ${VIDEO_MODELS.join("|")}
            --mode ${VIDEO_MODES.join("|")} [--from <assetId,…>] [--prompt]
            [--duration <seconds>] [--status ${VIDEO_STATUSES.join("|")}]
  add-video --motion <motionId> --file <path> --derived-from <videoId>
            --op ${VIDEO_OPS.join("|")} --model ${DERIVE_VIDEO_MODELS.join("|")}
            [--duration <seconds>] [--status ${VIDEO_STATUSES.join("|")}]
      --derived-from registers a clip made out of an earlier clip of the same
      motion — a matte (transparent), an interpolation (more frames), or a
      retime (the same frames in another order, --model ffmpeg). It
      writes a 'derive' edge from that clip and refuses --mode / --prompt /
      --from, because nothing here was shot: its history is the take it came
      from. Its --status defaults to 'ready', not 'generating': the script
      that made it has already written the file, so there is no wait to show.
      A shot clip still defaults to 'generating'. register-run --video then
      names which clip the frames were cut from.
  set-video --motion <motionId> --video <videoId|assetId>
            --status ${VIDEO_STATUSES.join("|")} [--notes <text>]
      --notes lands on the motion (the failure reason a human reads).

  remove-motion --motion <motionId>
      Drop the motion, its assets and its edges. Files on disk are left
      alone; their paths are printed as orphanedPaths. A loop that a
      transition joins is refused until the transition is removed.

  show [--motion <motionId>]
      Compact summary for the agent. Lists stale mirrors — a mirror whose
      source was registered again after it, or is gone (staleMirrors) — and
      the ready sprite motions missing a recorded colourway (variantsMissing).

Exit code 0 on success, 1 on failure with a one-line ERROR: on stderr.`;

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function projectPath(dir) {
  return join(resolve(dir), "project.json");
}

function loadProject(dir) {
  const path = projectPath(dir);
  if (!existsSync(path)) {
    fail(`no project.json in ${resolve(dir)} — run 'sprite-project.mjs init --name <Name>' first`);
  }
  let doc;
  try {
    doc = JSON.parse(readFileSync(path, "utf-8"));
  } catch (error) {
    fail(`${path} is not valid JSON: ${error.message}`);
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) fail(`${path} is not a JSON object`);
  if (!doc.sprite || typeof doc.sprite !== "object") fail(`${path} has no 'sprite' sidecar — is this a sprite character?`);
  doc.assets ??= [];
  doc.provenance ??= [];
  doc.sprite.refs ??= [];
  doc.sprite.motions ??= [];
  return doc;
}

const ASSET_KEYS = ["id", "type", "uri", "name", "metadata", "createdAt", "status", "tags"];
const MOTION_KEYS = [
  "id", "label", "direction", "prompt", "promptParts", "kind", "brief", "grid", "fps", "loop", "anchor", "status",
  "notes", "source", "mirrorOf", "breathe",
  "keyframe", "keyframeAlpha", "sheetRaw", "sheetAlpha", "sheet", "atlas", "frames",
  "gif", "webp", "exports", "variants", "videos", "inspect",
];
/** A 0.4.x character's keys come first, in the order `init` has always
 *  written them, so an older file is rewritten byte for byte. */
const CHARACTER_KEYS = ["name", "description", "style", "cell", "facing", "purpose", "pixel", "asymmetric"];

/** Rebuild an object with a fixed key order so project.json diffs stay stable
 *  no matter which command touched it. Unknown keys are appended, never lost. */
function orderKeys(value, keys) {
  const out = {};
  for (const key of keys) if (value[key] !== undefined) out[key] = value[key];
  for (const key of Object.keys(value)) if (out[key] === undefined && value[key] !== undefined) out[key] = value[key];
  return out;
}

function saveProject(dir, doc) {
  doc.assets = doc.assets.map((asset) => orderKeys(asset, ASSET_KEYS));
  doc.sprite.motions = doc.sprite.motions.map((motion) => orderKeys(motion, MOTION_KEYS));
  if (doc.sprite.character && typeof doc.sprite.character === "object") {
    doc.sprite.character = orderKeys(doc.sprite.character, CHARACTER_KEYS);
  }

  const ids = new Set();
  for (const asset of doc.assets) {
    if (!asset.id) fail("internal: an asset has no id");
    if (ids.has(asset.id)) fail(`duplicate asset id '${asset.id}' — refusing to write`);
    ids.add(asset.id);
  }
  for (const edge of doc.provenance) {
    if (!ids.has(edge.toAssetId)) fail(`provenance edge points at unknown asset '${edge.toAssetId}' — refusing to write`);
    if (edge.fromAssetId !== null && !ids.has(edge.fromAssetId)) {
      fail(`provenance edge comes from unknown asset '${edge.fromAssetId}' — refusing to write`);
    }
  }

  const path = projectPath(dir);
  const scratch = `${path}.tmp`;
  // The scratch file is cleaned up whichever way this goes, and a filesystem
  // fault leaves as a one-line `ERROR:` like every other refusal here: the
  // agent reads stderr, and a raw Node stack is not something it can act on.
  // Reaching this point means the document already validated, so the message
  // says the disk said no — not that the command was wrong.
  try {
    try {
      writeFileSync(scratch, `${JSON.stringify(doc, null, 2)}\n`);
      renameSync(scratch, path);
    } finally {
      if (existsSync(scratch)) rmSync(scratch, { force: true });
    }
  } catch (error) {
    fail(`cannot write ${path}: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Paths and media
// ---------------------------------------------------------------------------

function realOr(path) {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/**
 * Every asset uri is relative to the character directory. A run summary may
 * carry absolute paths (that is what `sprite-sheet.mjs run` emits) or
 * workspace-relative ones; both land on the same uri, and anything outside
 * the character directory is refused rather than silently rewritten.
 */
function toUri(dir, path, label) {
  const root = realOr(resolve(dir));
  const absolute = isAbsolute(path) ? realOr(path) : realOr(join(root, path));
  const rel = relative(root, absolute);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    fail(`${label}: ${path} is outside the character directory ${root}`);
  }
  return rel.split(sep).join("/");
}

function requireFile(dir, uri, label) {
  const path = join(resolve(dir), uri);
  if (!existsSync(path)) fail(`${label}: file not found: ${path}`);
  return path;
}

function ffprobeEntries(path, entries) {
  const r = spawnSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", entries, "-of", "default=noprint_wrappers=1", path],
    { encoding: "utf-8" },
  );
  if (r.error || r.status !== 0) return null;
  const out = {};
  for (const line of String(r.stdout).trim().split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) out[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return out;
}

/**
 * Canvas size of a WebP, read straight out of the RIFF header.
 *
 * ffprobe (tested on ffmpeg 8.0) cannot measure an ANIMATED WebP at all: it
 * skips the ANIM/ANMF chunks, says "image data not found" and reports 0x0 —
 * which is exactly what `sprite-sheet.mjs run` produces for `preview.webp`,
 * so the default run -> register-run chain used to fail on every motion. The
 * header is a fixed layout and cheaper than a decode, so it is parsed here.
 * Returns null for anything that is not a WebP shape this understands.
 */
function webpCanvasSize(path) {
  const head = Buffer.alloc(30);
  let read = 0;
  try {
    const fd = openSync(path, "r");
    try {
      read = readSync(fd, head, 0, head.length, 0);
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
  if (read < 16) return null;
  if (head.toString("latin1", 0, 4) !== "RIFF" || head.toString("latin1", 8, 12) !== "WEBP") return null;

  const fourcc = head.toString("latin1", 12, 16);
  // Extended (the only form an animation can take): 24-bit canvas size, each
  // stored as value-1, at bytes 24..29.
  if (fourcc === "VP8X" && read >= 30) {
    return { width: head.readUIntLE(24, 3) + 1, height: head.readUIntLE(27, 3) + 1 };
  }
  // Simple lossy: a VP8 keyframe header behind the 3-byte start code.
  if (fourcc === "VP8 " && read >= 30) {
    if (head[23] !== 0x9d || head[24] !== 0x01 || head[25] !== 0x2a) return null;
    return { width: head.readUInt16LE(26) & 0x3fff, height: head.readUInt16LE(28) & 0x3fff };
  }
  // Simple lossless: 14 bits of width-1 then 14 bits of height-1.
  if (fourcc === "VP8L" && read >= 25 && head[20] === 0x2f) {
    const bits = head.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  return null;
}

/**
 * Dimensions of an image asset. `fallback` (the run summary's cell) is used
 * only when neither the WebP header nor ffprobe can answer, and saying so on
 * stderr is part of the deal — a guessed size must never look measured.
 */
function imageMetadata(path, label, fallback) {
  const fromHeader = webpCanvasSize(path);
  if (fromHeader) return fromHeader;

  const probed = ffprobeEntries(path, "stream=width,height");
  const width = Number(probed?.width);
  const height = Number(probed?.height);
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return { width, height };
  }
  if (fallback && Number.isFinite(fallback.width) && Number.isFinite(fallback.height)) {
    console.error(`WARN: ${label}: could not measure ${path} — using the run's cell ${fallback.width}x${fallback.height}`);
    return { width: fallback.width, height: fallback.height };
  }
  fail(`${label}: ffprobe could not read the dimensions of ${path} (is ffprobe installed and the file a real image?)`);
}

/** Video metadata is best effort: a clip may still be downloading when the
 *  agent registers it, and a missing duration must not lose the asset. */
function videoMetadata(path) {
  if (!existsSync(path)) return { metadata: {}, warning: `${path} does not exist yet — registered without dimensions` };
  const probed = ffprobeEntries(path, "stream=width,height,r_frame_rate:format=duration");
  const width = Number(probed?.width);
  const height = Number(probed?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return { metadata: {}, warning: `ffprobe could not read ${basename(path)} — registered without dimensions` };
  }
  const metadata = { width, height };
  const duration = Number(probed?.duration);
  if (Number.isFinite(duration) && duration > 0) metadata.duration = Math.round(duration * 1000) / 1000;
  const [num, den] = String(probed?.r_frame_rate ?? "").split("/").map(Number);
  if (Number.isFinite(num) && Number.isFinite(den) && den > 0) metadata.fps = Math.round((num / den) * 1000) / 1000;
  return { metadata, warning: null };
}

// ---------------------------------------------------------------------------
// Document helpers
// ---------------------------------------------------------------------------

/**
 * Which ref or motion an existing asset id belongs to, read off the sidecar
 * rather than stored on the asset — the craft `Asset` shape stays untouched.
 * Returns null for an id nothing claims (an orphan a previous run left).
 */
function assetOwner(doc, id) {
  const ref = doc.sprite.refs.find((r) => r.asset === id);
  if (ref) return `ref '${ref.id}'`;
  if (CHARACTER_EXPORTS.some((key) => doc.sprite.exports?.[key] === id)) return CHARACTER_OWNER;
  if (doc.sprite.character?.pixel?.palette === id) return CHARACTER_OWNER;
  for (const motion of doc.sprite.motions) {
    const exports = motion.exports && typeof motion.exports === "object" ? motion.exports : {};
    const slots = [
      motion.sheetRaw, motion.sheetAlpha, motion.sheet, motion.atlas, motion.gif, motion.webp,
      motion.keyframe, motion.keyframeAlpha, ...Object.values(exports), ...variantAssetIds(motion),
    ];
    if (slots.includes(id)
      || (motion.frames ?? []).includes(id)
      || (motion.videos ?? []).some((v) => v.asset === id)) {
      return `motion '${motion.id}'`;
    }
  }
  return null;
}

/** The owner of an asset that belongs to the whole character (its `.riv`,
 *  its Aseprite sheet). */
const CHARACTER_OWNER = "the character";

/**
 * The character's exports that hold `motionId`'s frames — read off the edge
 * `register-export` wrote (`params.motions`). One made from frames that are
 * about to be replaced or removed would be offered as current.
 */
function characterExportsHolding(doc, motionId) {
  return CHARACTER_EXPORTS.map((key) => doc.sprite.exports?.[key]).filter((id) => {
    if (!id) return false;
    const motions = doc.provenance.find((e) => e.toAssetId === id)?.operation?.params?.motions;
    return Array.isArray(motions) && motions.includes(motionId);
  });
}

/** Take character exports off the sidecar once their assets are gone. */
function retireCharacterExports(doc, ids) {
  if (!doc.sprite.exports) return;
  for (const key of CHARACTER_EXPORTS) {
    if (ids.includes(doc.sprite.exports[key])) delete doc.sprite.exports[key];
  }
  if (!Object.keys(doc.sprite.exports).length) delete doc.sprite.exports;
}

/**
 * Write an asset, replacing an existing one IN PLACE so re-registering a
 * motion does not shuffle the file (a re-run must be a no-op diff).
 *
 * `owner` is the ref or motion the caller is writing on behalf of. Ids are
 * derived from names — a motion called `ref` and a reference called
 * `sheet-raw` both spell `ref-sheet-raw` — so an upsert that would move an
 * asset from one owner to the other is refused instead of silently winning.
 */
function upsertAsset(doc, asset, owner) {
  const index = doc.assets.findIndex((a) => a.id === asset.id);
  if (index === -1) {
    doc.assets.push(asset);
    return;
  }
  const current = assetOwner(doc, asset.id);
  if (owner && current && current !== owner) {
    fail(`asset '${asset.id}' already belongs to ${current}; ${owner} cannot take it over — rename one of them`);
  }
  doc.assets[index] = asset;
}

/** One edge per asset, kept at the position the asset first took. */
function setEdge(doc, edge) {
  const index = doc.provenance.findIndex((e) => e.toAssetId === edge.toAssetId);
  if (index === -1) {
    doc.provenance.push(edge);
    return;
  }
  doc.provenance[index] = edge;
  doc.provenance = doc.provenance.filter((e, i) => i === index || e.toAssetId !== edge.toAssetId);
}

function dropAssets(doc, ids) {
  const set = new Set(ids);
  doc.assets = doc.assets.filter((a) => !set.has(a.id));
  doc.provenance = doc.provenance.filter((e) => !set.has(e.toAssetId));
  // A surviving edge must never point at a removed parent — neither as its
  // parent nor in the fan-in list behind it (a palette pinned from a motion's
  // frames outlives that motion). The list keeps `operation`'s shape: the
  // parent is its first surviving entry, and one entry is no list.
  doc.provenance = doc.provenance.map((e) => {
    const inputs = e.operation?.params?.inputs;
    if (Array.isArray(inputs) && inputs.some((id) => set.has(id))) {
      const kept = inputs.filter((id) => !set.has(id));
      const params = { ...e.operation.params };
      if (kept.length > 1) params.inputs = kept;
      else delete params.inputs;
      const operation = { ...e.operation };
      if (Object.keys(params).length) operation.params = params;
      else delete operation.params;
      return { ...e, fromAssetId: kept[0] ?? null, operation };
    }
    return e.fromAssetId && set.has(e.fromAssetId) ? { ...e, fromAssetId: null } : e;
  });
}

/**
 * craft edges are single-parent, so a fan-in step names its first input as
 * the parent and lists the whole set in params.inputs. A single input is
 * fully described by fromAssetId and carries no list.
 *
 * `actor` is the agent for everything this pipeline makes. The one exception
 * is a reference the user brought in: a human made that file, and an `upload`
 * edge claiming the agent did would be the same lie as a model name nobody
 * called.
 */
function operation(type, timestamp, params, inputs, actor = "agent") {
  const merged = { ...params };
  if (inputs && inputs.length > 1) merged.inputs = inputs;
  for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key];
  const op = { type, actor, timestamp };
  if (Object.keys(merged).length) op.params = merged;
  return op;
}

function edge(toAssetId, inputs, op) {
  return { toAssetId, fromAssetId: inputs && inputs.length ? inputs[0] : null, operation: op };
}

/**
 * The `generate` edge for an asset that is registered TWICE — reserved before
 * the image call, measured after it — merged with the one already on file.
 *
 * `--model` and `--prompt` are known at the reserving call and nowhere after
 * it: the closing call carries the file that landed, not the prompt that was
 * sent. Rebuilding the edge from bare flags therefore wrote `params: {}` over
 * a real model and prompt (measured on the trial project, where the keyframe's
 * edge came out empty), and dropped the parent with them. So an absent flag
 * KEEPS what the earlier call recorded; a present one replaces it. An edge
 * that is not a `generate` — there is none today, but a hand-edited file can
 * carry one — is replaced outright rather than half-merged.
 */
function keptGenerateEdge(doc, assetId, values, inputs, now) {
  const previous = doc.provenance.find((e) => e.toAssetId === assetId);
  const kept = previous?.operation?.type === "generate" ? previous : null;
  const keptParams = kept?.operation?.params ?? {};
  const keptInputs = !kept
    ? []
    : Array.isArray(keptParams.inputs)
      ? keptParams.inputs
      : kept.fromAssetId
        ? [kept.fromAssetId]
        : [];
  const merged = values.from === undefined ? keptInputs : inputs;
  return edge(assetId, merged, operation("generate", now, {
    model: values.model ?? keptParams.model,
    prompt: values.prompt ?? keptParams.prompt,
  }, merged));
}

function findMotion(doc, id, flag = "--motion") {
  const motion = doc.sprite.motions.find((m) => m.id === id);
  if (!motion) {
    const known = doc.sprite.motions.map((m) => m.id).join(", ") || "none";
    fail(`${flag}: no motion '${id}' in this character (known motions: ${known})`);
  }
  return motion;
}

/** Flags that only describe an image this pipeline generated. */
const GENERATE_ONLY = [["--model", "model"], ["--prompt", "prompt"], ["--from", "from"]];

/**
 * The provenance edge `add-ref` writes, which is the only thing the three
 * origins disagree about — the asset entry is identical for all of them.
 *
 * A reference the user drew has no model and no prompt, and a pose cropped out
 * of a design sheet has neither either: its history is the sheet. Recording
 * those as `generate` edges is what forced the agent to either invent a model
 * name or skip registration entirely, so the flags of one origin are refused
 * by name for the others rather than quietly ignored.
 */
function refEdge(doc, values, id, now) {
  const assetId = `ref-${id}`;
  const derivedFrom = values["derived-from"];

  if (values.uploaded && derivedFrom !== undefined) {
    fail("--uploaded and --derived-from are mutually exclusive: the file was either brought in by the user or cut out of a registered reference");
  }
  if (values.op !== undefined && derivedFrom === undefined) {
    fail("--op: only --derived-from records an operation — there is nothing to have cropped without it");
  }

  if (values.uploaded) {
    for (const [flag, key] of GENERATE_ONLY) {
      if (values[key] !== undefined) fail(`--uploaded: a user-supplied image has no ${flag} — nothing here generated it`);
    }
    return edge(assetId, [], operation("upload", now, {}, [], "human"));
  }

  if (derivedFrom !== undefined) {
    for (const [flag, key] of GENERATE_ONLY) {
      if (values[key] !== undefined) fail(`--derived-from: an image cut out of another reference has no ${flag} — its source is the reference it came from`);
    }
    // A reference, by ref id (`turnaround`) or asset id (`ref-turnaround`) —
    // `--from` speaks asset ids, so both spellings reach this — or any
    // registered asset: an anchor is as often cut out of a frame as out of a
    // design sheet. Unknown lists the refs it knows.
    const sourceRef = doc.sprite.refs.find((r) => r.id === derivedFrom) ?? doc.sprite.refs.find((r) => r.asset === derivedFrom);
    const sourceAsset = sourceRef?.asset ?? (doc.assets.some((a) => a.id === derivedFrom) ? derivedFrom : null);
    if (!sourceAsset) {
      const known = doc.sprite.refs.map((r) => r.id).join(", ") || "none";
      fail(`--derived-from: no reference or asset '${derivedFrom}' in this character (known refs: ${known}; any asset id, such as a frame, is accepted too)`);
    }
    // A self-parent is a cycle the graph cannot mean anything by, and it is an
    // easy typo when re-registering the same id.
    if (sourceAsset === assetId) fail(`--derived-from: reference '${id}' cannot be derived from itself`);
    const op = values.op === undefined ? "crop" : String(values.op).trim();
    if (!op) fail("--op: expected a single word such as crop or cleanup");
    return edge(assetId, [sourceAsset], operation("derive", now, { op }));
  }

  const inputs = parseInputs(doc, values.from, "--from");
  return edge(assetId, inputs, operation("generate", now, {
    model: values.model, prompt: values.prompt,
  }, inputs));
}

/** How a reference came to be, read off its edge. `show` reports it because
 *  whether an image was drawn here or brought in by the user decides what the
 *  agent may regenerate. A ref with no edge at all is `unknown` — the honest
 *  answer for a hand-written or half-migrated project.json. */
const EDGE_ORIGINS = new Map([["generate", "generated"], ["upload", "uploaded"], ["derive", "derived"]]);

function refOrigin(doc, assetId) {
  const found = doc.provenance.find((e) => e.toAssetId === assetId);
  // A Map, not an object literal: the type comes out of a file on disk, and
  // an inherited key like `constructor` must answer `unknown` like any other
  // operation this mode does not write.
  return EDGE_ORIGINS.get(found?.operation?.type) ?? "unknown";
}

function parseInputs(doc, raw, flag) {
  if (!raw) return [];
  const ids = raw.flatMap((value) => String(value).split(",")).map((v) => v.trim()).filter(Boolean);
  for (const id of ids) {
    if (!doc.assets.some((a) => a.id === id)) fail(`${flag}: unknown asset '${id}'`);
  }
  return ids;
}

function parseCell(value, flag) {
  const m = /^(\d+)x(\d+)$/.exec(String(value).trim());
  if (!m) fail(`${flag}: expected WxH, got '${value}'`);
  return { width: Number(m[1]), height: Number(m[2]) };
}

function aspectRatio(width, height) {
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const d = gcd(width, height) || 1;
  return `${width / d}:${height / d}`;
}

function titleCase(id) {
  return String(id).split(/[-_\s]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

function oneOf(value, allowed, flag) {
  if (!allowed.includes(value)) fail(`${flag}: expected one of ${allowed.join(", ")}, got '${value}'`);
  return value;
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

/** `bounce-frame-07`, or `flame-frame-096` for a loop — one closed cycle at
 *  full rate runs past 99 frames, and a two-digit id would sort `100` next to
 *  `10`. The width is the RUN's, not the index's, so a 40-frame loop still
 *  spells `000`: a motion whose ids changed width halfway through would be
 *  two naming schemes in one folder. */
const frameAssetId = (motionId, index, digits = 2) =>
  `${motionId}-frame-${String(index).padStart(digits, "0")}`;

/** Size on disk in bytes, or undefined when the file cannot be stat'd. The
 *  panel prints it beside each loop export; a missing number is a link
 *  without a size, never a size of 0. */
function fileSize(path) {
  try {
    const size = statSync(path).size;
    return Number.isFinite(size) ? size : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Ids a `run` owns and therefore replaces wholesale. Matching is exact, never
 * by prefix: motions 'walk' and 'walk-fast' must not claim each other's
 * assets, and `<m>-sheet-raw` belongs to set-sheet, not to a run.
 *
 * An id that spells like this motion's but is claimed by a ref or another
 * motion is left out: the naming collision is refused loudly by `upsertAsset`
 * rather than resolved by quietly deleting somebody else's asset first.
 */
function runOwnedIds(doc, motionId) {
  const framePrefix = `${motionId}-frame-`;
  const owned = new Set([
    `${motionId}-sheet-alpha`, `${motionId}-sheet`, `${motionId}-atlas`,
    `${motionId}-gif`, `${motionId}-webp`,
    // A loop run's own deliverables. They are owned by the run for the same
    // reason the GIF is: re-running the loop rewrites all four, and a stale
    // export left behind would be offered for download as if it were current.
    `${motionId}-apng`, `${motionId}-webm`, `${motionId}-lottie`,
    // Every on-demand export. A run replaces the frames they were cut from,
    // and nothing rebuilds them, so a new run retires them all — an export
    // in project.json always describes the frames registered now.
    ...Object.keys(EXPORT_SPECS).map((format) => exportAssetId(motionId, format)),
    // Every colourway's files, for the same reason: they were baked from
    // the frames a run replaces.
    ...variantAssetIds(doc.sprite.motions.find((m) => m.id === motionId)),
  ]);
  const mine = `motion '${motionId}'`;
  return doc.assets
    .map((a) => a.id)
    .filter((id) => owned.has(id) || (id.startsWith(framePrefix) && /^\d{2,3}$/.test(id.slice(framePrefix.length))))
    .filter((id) => {
      const holder = assetOwner(doc, id);
      return holder === null || holder === mine;
    });
}

/** A `{ x, y }` in cell pixels, or undefined for anything else. The viewer
 *  draws its pivot guide on this point, so a half-written or hand-edited one
 *  must not travel: absent is a state it renders correctly, `{0, undefined}`
 *  is a guide in the corner that looks like a measurement. */
function anchorPoint(value) {
  if (!value || typeof value !== "object") return undefined;
  const { x, y } = value;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
}

/** A finite number, or undefined. The optional inspect numbers get the same
 *  treatment as the anchor point: a report that never carried `bodyDrift`
 *  (or carried a broken one) must arrive at the viewer as *absent*, because
 *  the plausible default — 0 — is exactly the reading a perfectly still body
 *  produces, and the row would show a measurement nobody made. */
function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** The InspectSummary the sidecar carries — picked field by field, never
 *  spread, so a richer inspect report (per-frame bboxes, absolute paths)
 *  cannot leak into project.json.
 *
 *  Picking by name is also why every field this report gains has to be added
 *  HERE as well: `inspect` measured `bodyDrift` and wrote it into
 *  `inspect.json` for a round before this copy learned to carry it, and the
 *  viewer — which reads project.json and nothing else — showed a blank row
 *  the whole time.
 *
 *  `anchorPoint` and `bodyDrift` are the optional members: the first is where
 *  `align` actually put the anchor inside the cell, and the viewer renders
 *  from project.json alone, so without this copy the stage has no way to learn
 *  where the feet are and falls back to the cell edge — which with any `--pad`
 *  floats the sprite above its own guide. Absent stays absent; the fallback is
 *  the viewer's call, not a default invented here. */
function inspectSummary(value) {
  if (!value || typeof value !== "object") return undefined;
  const point = anchorPoint(value.anchorPoint);
  const bodyDrift = finiteNumber(value.bodyDrift);
  // The head-and-torso spread: judged on a region no alignment pins, so it
  // still reads a lurch after `--x-from feet` has zeroed `bodyDrift`.
  const headDrift = finiteNumber(value.headDrift);
  // …and the same spread on the source cells, drift removed: the bar the
  // frames' number is judged against.
  const sourceHeadDrift = finiteNumber(value.sourceHeadDrift);
  // Frame pairs the step check named. An empty list is a result ("checked,
  // none"), so it travels; a missing one stays missing.
  const nearDuplicates = framePairs(value.nearDuplicates);
  const rowJumps = framePairs(value.rowJumps);
  // A loop reports these three and none of the anchor numbers; a sheet run
  // reports the anchor numbers and none of these. Picking by name means each
  // shape carries exactly what it measured, and the missing half stays
  // missing instead of arriving as a confident 0.
  const seam = finiteNumber(value.seam);
  const step = finiteNumber(value.step);
  // The bar `loop` judged the seam against (max(2·step, noise floor)); absent
  // on a loop cut before it was recorded, and readers then use 2·step.
  const seamLimit = finiteNumber(value.seamLimit);
  // How many in-between frames `--seam-fill` inserted at the wrap. 0 is a
  // real reading — the loop closed on its own — so the same finite-or-absent
  // rule applies: absent means the report predates the flag.
  const seamFill = finiteNumber(value.seamFill);
  const alphaCoverage = finiteNumber(value.alphaCoverage);
  // The share of visible pixels still carrying the plate's hue — 0 is the
  // clean cut, so finite-or-absent like its neighbours; absent when nothing
  // hued was keyed.
  const keyResidue = finiteNumber(value.keyResidue);
  // Where a loop's frames sit in their clip: frame px = (clip px − crop.xy) ×
  // scale. The .riv needs both to draw every loop at one size and in the
  // place it stood; absent on a run from before `loop` recorded them, and
  // then the export measures them itself rather than trusting a default.
  const crop = clipRect(value.crop);
  const scale = finiteNumber(value.scale);
  // A transition's two joins, in the units of `step`.
  const startGap = finiteNumber(value.startGap);
  const endGap = finiteNumber(value.endGap);
  return {
    frameCount: value.frameCount,
    cell: value.cell,
    ...(point ? { anchorPoint: point } : {}),
    anchorDrift: value.anchorDrift,
    // `=== undefined`, not truthiness: 0 is the drift a well-aligned motion
    // has, and dropping it would hide the best result the pipeline can give.
    ...(bodyDrift === undefined ? {} : { bodyDrift }),
    ...(headDrift === undefined ? {} : { headDrift }),
    ...(sourceHeadDrift === undefined ? {} : { sourceHeadDrift }),
    ...(nearDuplicates ? { nearDuplicates } : {}),
    ...(rowJumps ? { rowJumps } : {}),
    maxJump: value.maxJump,
    scaleDrift: value.scaleDrift,
    emptyFrames: value.emptyFrames ?? [],
    warnings: value.warnings ?? [],
    ...(seam === undefined ? {} : { seam }),
    ...(step === undefined ? {} : { step }),
    ...(seamLimit === undefined ? {} : { seamLimit }),
    ...(seamFill === undefined ? {} : { seamFill }),
    ...(alphaCoverage === undefined ? {} : { alphaCoverage }),
    ...(keyResidue === undefined ? {} : { keyResidue }),
    ...(startGap === undefined ? {} : { startGap }),
    ...(endGap === undefined ? {} : { endGap }),
    ...(crop ? { crop } : {}),
    ...(scale > 0 ? { scale } : {}),
  };
}

/** `[[from, to], …]` frame-index pairs, well-formed entries only, or
 *  undefined when the value is not a list at all. */
function framePairs(value) {
  if (!Array.isArray(value)) return undefined;
  const index = (n) => Number.isInteger(n) && n >= 0;
  return value
    .filter((pair) => Array.isArray(pair) && pair.length === 2 && index(pair[0]) && index(pair[1]))
    .map(([from, to]) => [from, to]);
}

/** `{ x, y, w, h }` in whole clip pixels, with a real width and height — or
 *  undefined, never half a rect. */
function clipRect(value) {
  if (!value || typeof value !== "object") return undefined;
  const [x, y, w, h] = ["x", "y", "w", "h"].map((key) => finiteNumber(value[key]));
  return [x, y, w, h].every((n) => n !== undefined) && w > 0 && h > 0 ? { x, y, w, h } : undefined;
}

/** Four decimals — the scale the loop's seam and step are reported at. */
const round4 = (value) => Math.round(value * 1e4) / 1e4;

/** A handful of names, said the way a person says them: "a and b", "a, b and
 *  c". Three unanswered questions joined by "and" twice read like a stutter. */
const listOf = (names) => names.length <= 2
  ? names.join(" and ")
  : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/**
 * The motion's brief, if it is a whole one.
 *
 * `set-motion` only ever writes all of it at once, but `project.json` is a
 * file: a half-written record arrives from a hand edit or a turn that stopped
 * mid-way, and the paid-clip gate used to open on the word `brief` alone — a
 * `{ "duration": 4 }` bought a clip and printed "undefinedpx" afterwards. All
 * four answers or none, which is the rule `domain.ts` already applies to the
 * document the viewer reads (`parseLoopBrief`) and `references/project-json.md`
 * states; this is the same rule in the one place the money is spent.
 *
 * `{ brief }` when the record answers everything, `{ missing }` naming what it
 * leaves unanswered, `{}` when there is no record — a brief nobody has written
 * yet and a brief written wrong need different sentences.
 */
function readBrief(motion) {
  const raw = motion?.brief;
  if (!raw || typeof raw !== "object") return {};
  const duration = finiteNumber(raw.duration);
  const width = finiteNumber(raw.width);
  const recordedAt = typeof raw.recordedAt === "string" && raw.recordedAt.trim() !== ""
    ? raw.recordedAt
    : undefined;
  const missing = [
    duration === undefined || duration <= 0 ? "--brief-duration" : null,
    width === undefined || width <= 0 ? "--brief-width" : null,
    LOOP_INTERPOLATORS.includes(raw.interpolator) ? null : "--brief-interpolator",
    // Not a flag anybody types — `set-motion` stamps it — but a brief with no
    // hour on it was not recorded by this command, and the rest of it is
    // whatever was typed into the file by hand.
    recordedAt === undefined ? "recordedAt" : null,
  ].filter(Boolean);
  if (missing.length) return { missing };
  const budgetUsd = finiteNumber(raw.budgetUsd);
  return {
    brief: {
      duration,
      width,
      interpolator: raw.interpolator,
      ...(budgetUsd === undefined || budgetUsd < 0 ? {} : { budgetUsd }),
      recordedAt,
    },
  };
}

/** The brief, as one line for `show` — the cheapest place a later turn can
 *  read what it is working to. */
function briefLine(brief) {
  const budget = brief.budgetUsd === undefined ? "" : `, budget $${brief.budgetUsd}`;
  return `  brief: ${brief.duration}s, ${brief.width}px, interpolator ${brief.interpolator}${budget} (recorded ${brief.recordedAt})`;
}

/**
 * Record the loop interview's answers on the motion, or refuse.
 *
 * The three required answers are recorded TOGETHER the first time and singly
 * afterwards, because that is how the conversation goes: one message asks all
 * of them, and a later turn narrows one of them ("make it 256 after all").
 * Writing a partial first brief would be worse than writing none — `add-video`
 * opens on the brief's existence, so half a brief opens the gate on answers
 * nobody gave.
 *
 * Returns the stderr lines the caller should print. The 400-frame ceiling is
 * a WARNING and not a refusal: a 7s loop at 48 fps is a perfectly good loop,
 * and the point is that the user finds out before the clip is paid for
 * instead of after (measured on the Kiki trial: two clips, then the discovery).
 */
/**
 * A new `--kind transition` motion: the clip that carries the character from
 * one loop's frame 0 to another's. Both ends must be loops of this character,
 * different ones, and a pair is joined once — a second transition for the
 * same pair would leave the `.riv` two routes and no way to say which.
 */
function transitionMotion(doc, values) {
  const from = requireFlag(values.from, "--from");
  const to = requireFlag(values.to, "--to");
  const loopEnd = (id, flag) => {
    const motion = doc.sprite.motions.find((m) => m.id === id);
    if (!motion) {
      fail(`${flag}: no motion '${id}' (known: ${doc.sprite.motions.map((m) => m.id).join(", ") || "none"})`);
    }
    if (motion.kind !== "loop") {
      fail(`${flag}: '${id}' is not a loop — a transition joins two loops' frame 0s in clip coordinates, and a sprite motion has neither`);
    }
    return motion;
  };
  const a = loopEnd(from, "--from");
  const b = loopEnd(to, "--to");
  if (from === to) fail(`--to: a transition from '${from}' to itself joins nothing — a loop already returns to its own frame 0`);
  const existing = doc.sprite.motions.find((m) => m.kind === "transition" && m.from === from && m.to === to);
  if (existing) fail(`--from/--to: ${existing.id} already goes from ${from} to ${to} — cut it again with register-run instead`);
  const id = values.id ?? `${from}-to-${to}`;
  if (doc.sprite.motions.some((m) => m.id === id)) {
    fail(`--id: motion '${id}' already exists — use set-motion to change it`);
  }
  if (values.rows !== undefined || values.cols !== undefined) fail("--rows/--cols: a transition is a sequence, not a grid");
  return {
    id,
    label: values.label ?? `${a.label ?? a.id} → ${b.label ?? b.id}`,
    prompt: values.prompt ?? "",
    kind: "transition",
    from,
    to,
    grid: { rows: 1, cols: 1 },
    // The take's own rate until the cut says otherwise (register-run writes
    // the run's fps); a transition plays once.
    fps: values.fps === undefined ? 24 : num(values.fps, "--fps", { min: 1 }),
    loop: false,
    anchor: oneOf(values.anchor ?? "bottom", ANCHORS, "--anchor"),
    status: oneOf(values.status ?? "planned", MOTION_STATUSES, "--status"),
    source: "video",
    frames: [],
    videos: [],
  };
}

/**
 * A transition's interview: how long it should PLAY — a 4 s take is retimed
 * to it — and the dollar ceiling for its take. Both answers the first time;
 * either may change later. A loop's width and interpolator are refused by
 * name: the transition is cut at the width its loops were, and a Rive file
 * resamples it to 24 fps, so there is nothing to interpolate.
 */
function setTransitionBrief(motion, values, now) {
  if (values["brief-width"] !== undefined || values["brief-interpolator"] !== undefined) {
    fail(`--brief-width/--brief-interpolator: '${motion.id}' is a transition — those are a loop's answers; a transition's brief is --brief-duration (how long it plays) and --brief-budget`);
  }
  const current = readTransitionBrief(motion).brief ?? {};
  const duration = values["brief-duration"] === undefined
    ? current.duration
    : num(values["brief-duration"], "--brief-duration", { min: 0.1 });
  const budgetUsd = values["brief-budget"] === undefined
    ? current.budgetUsd
    : num(values["brief-budget"], "--brief-budget", { min: 0 });
  const missing = [
    duration === undefined ? "--brief-duration" : null,
    budgetUsd === undefined ? "--brief-budget" : null,
  ].filter(Boolean);
  if (missing.length) {
    fail(`--brief-*: transition '${motion.id}' has no brief yet, so the first one needs ${listOf(missing)} as well — how long it plays and what its take may cost are recorded together`);
  }
  motion.brief = { duration, budgetUsd, recordedAt: new Date(now).toISOString() };
  return [];
}

/** A transition's whole brief, or which answers it is missing. */
function readTransitionBrief(motion) {
  const raw = motion?.brief;
  if (!raw || typeof raw !== "object") return { missing: ["--brief-duration", "--brief-budget"] };
  const duration = finiteNumber(raw.duration);
  const budgetUsd = finiteNumber(raw.budgetUsd);
  const missing = [
    duration === undefined || duration <= 0 ? "--brief-duration" : null,
    budgetUsd === undefined || budgetUsd < 0 ? "--brief-budget" : null,
  ].filter(Boolean);
  if (missing.length || typeof raw.recordedAt !== "string") return { missing };
  return { brief: { duration, budgetUsd, recordedAt: raw.recordedAt } };
}

function setLoopBrief(motion, values, now) {
  const given = {
    duration: values["brief-duration"],
    width: values["brief-width"],
    interpolator: values["brief-interpolator"],
    budget: values["brief-budget"],
  };
  if (Object.values(given).every((value) => value === undefined)) return [];
  if (motion.kind === "transition") return setTransitionBrief(motion, values, now);
  if (motion.kind !== "loop") {
    fail(`--brief-*: '${motion.id}' is not a loop motion — the brief is a loop's interview (cycle length, UI width, interpolator), and a sheet motion answers none of it. Use add-motion --kind loop for a UI loop.`);
  }

  // Only a WHOLE brief is something to change one answer of. A half-written
  // record is no brief, so completing it from the outside is completing
  // nothing: the three answers are asked again, together.
  const current = readBrief(motion).brief ?? {};
  const duration = given.duration === undefined
    ? finiteNumber(current.duration)
    : num(given.duration, "--brief-duration", { min: 0.1 });
  const width = given.width === undefined
    ? finiteNumber(current.width)
    : num(given.width, "--brief-width", { integer: true, min: 1 });
  const interpolator = given.interpolator === undefined
    ? (LOOP_INTERPOLATORS.includes(current.interpolator) ? current.interpolator : undefined)
    : oneOf(given.interpolator, LOOP_INTERPOLATORS, "--brief-interpolator");

  const missing = [
    duration === undefined ? "--brief-duration" : null,
    width === undefined ? "--brief-width" : null,
    interpolator === undefined ? "--brief-interpolator" : null,
  ].filter(Boolean);
  if (missing.length) {
    fail(`--brief-*: motion '${motion.id}' has no brief yet, so the first one needs ${listOf(missing)} as well — the three answers are recorded together, and any one of them can be changed later`);
  }

  const budgetUsd = given.budget === undefined
    ? finiteNumber(current.budgetUsd)
    : num(given.budget, "--brief-budget", { min: 0 });

  motion.brief = {
    duration,
    width,
    interpolator,
    ...(budgetUsd === undefined ? {} : { budgetUsd }),
    recordedAt: new Date(now).toISOString(),
  };

  // `duration × fps ≤ 400`, checked against the rate the chosen interpolator
  // aims at. RIFE multiplies the clip's own rate and `none` changes nothing,
  // so neither has a 60 to be measured against here.
  if (!SIXTY_FPS_INTERPOLATORS.includes(interpolator)) return [];
  const atSixty = Math.ceil(duration * 60);
  if (atSixty <= MAX_LOOP_FRAMES) return [];
  const fits = LOOP_TARGET_FPS.find((fps) => Math.ceil(duration * fps) <= MAX_LOOP_FRAMES);
  return [fits === undefined
    ? `WARN: a ${duration}s loop is over the ${MAX_LOOP_FRAMES}-frame limit at every rate down to ${LOOP_TARGET_FPS[LOOP_TARGET_FPS.length - 1]}fps (${Math.ceil(duration * LOOP_TARGET_FPS[LOOP_TARGET_FPS.length - 1])} frames) — shorten the loop before shooting it`
    : `WARN: a ${duration}s loop at 60fps is ${atSixty} frames and the limit is ${MAX_LOOP_FRAMES} — interpolate to ${fits}fps instead (--target-fps ${fits}), or shorten the loop. Say which before the clip is shot.`];
}

// ---------------------------------------------------------------------------
// 0.5.0 sidecar: route, pixel spec, asymmetry, directions, breathe, mirror,
// recorded prompt parts. Each is optional and absent in a 0.4.x file; the
// shapes are the ones `domain.ts` parses and `references/project-json.md`
// documents.
// ---------------------------------------------------------------------------

/**
 * Apply the character flags `init` and `set-character` share: --purpose,
 * --asymmetric, --pixel, --colors (and set-character's --no-pixel). Returns
 * the stderr notes the caller prints after the write.
 *
 * `pixel` is rebuilt rather than patched so its keys stay in one order
 * (`logicalHeight`, `palette`, `colors`) whichever flag changed.
 */
function applyCharacterFlags(doc, character, values) {
  const notes = [];
  if (values["remove-variant"] !== undefined) {
    if (values["no-pixel"]) fail("--remove-variant: --no-pixel already removes every colourway — pass one of them");
    const names = String(values["remove-variant"]).split(",").map((n) => n.trim()).filter(Boolean);
    const recorded = recordedVariants(character);
    const unknown = names.filter((name) => !recorded.some((v) => v.name === name));
    if (!names.length || unknown.length) {
      fail(`--remove-variant: ${unknown.length ? `no colourway ${unknown.join(", ")}` : "name a colourway"} (${recorded.map((v) => v.name).join(", ") || "this character has none"})`);
    }
    notes.push(...retireVariants(doc, names, "it was removed"));
    const kept = recorded.filter((v) => !names.includes(v.name));
    if (kept.length) character.pixel.variants = kept;
    else delete character.pixel.variants;
  }
  if (values.purpose !== undefined) character.purpose = oneOf(values.purpose, PURPOSES, "--purpose");
  if (values.asymmetric !== undefined) {
    const sentence = String(values.asymmetric).trim();
    // An empty sentence takes the lock back: nothing is side-specific now.
    if (sentence) character.asymmetric = sentence;
    else delete character.asymmetric;
  }
  if (values["no-pixel"]) {
    if (values.pixel !== undefined || values.colors !== undefined) {
      fail("--no-pixel: says the character is not pixel art — it cannot be given with --pixel or --colors");
    }
    const paletteId = character.pixel?.palette;
    const palette = paletteId ? doc.assets.find((a) => a.id === paletteId) : null;
    if (palette) {
      dropAssets(doc, [palette.id]);
      notes.push(`note: unregistered ${palette.id} with the pixel spec — the file stays on disk: ${palette.uri}`);
    }
    // Colourways are pixel art's too.
    notes.push(...retireVariants(doc, null, "the character is no longer pixel art"));
    delete character.pixel;
    return notes;
  }
  if (values.pixel === undefined && values.colors === undefined) return notes;
  const current = character.pixel && typeof character.pixel === "object" ? character.pixel : null;
  const logicalHeight = values.pixel === undefined
    ? finiteNumber(current?.logicalHeight)
    : num(values.pixel, "--pixel", { integer: true, min: 1 });
  if (logicalHeight === undefined) {
    fail("--colors: only a pixel-art character has a palette — declare it with --pixel <height in logical pixels> as well");
  }
  const colors = values.colors === undefined
    ? finiteNumber(current?.colors)
    : num(values.colors, "--colors", { integer: true, min: 2 });
  if (colors !== undefined && colors > 256) fail(`--colors: a palette of at most 256 colours, got ${colors}`);
  character.pixel = {
    logicalHeight,
    ...(typeof current?.palette === "string" && current.palette ? { palette: current.palette } : {}),
    ...(colors === undefined ? {} : { colors }),
    ...(recordedVariants(character).length ? { variants: recordedVariants(character) } : {}),
  };
  return notes;
}

/** `--direction`, checked, or undefined when the flag was not given. */
function directionFlag(values) {
  return values.direction === undefined ? undefined : oneOf(values.direction, DIRECTIONS, "--direction");
}

/**
 * The prompt parts `set-motion --prompt-parts` (and `sheet-prompt`) record,
 * checked whole: a builder version, the action verbatim, the clause ids, and
 * optionally the layout guide's geometry. The same rule `domain.ts` loads
 * them by — a record that could not rebuild its text is refused here rather
 * than written for the viewer to drop.
 */
function promptPartsRecord(raw, flag) {
  let parts = raw;
  if (typeof raw === "string") {
    try {
      parts = JSON.parse(raw);
    } catch (error) {
      fail(`${flag}: not valid JSON (${error.message})`);
    }
  }
  if (!parts || typeof parts !== "object" || Array.isArray(parts)) fail(`${flag}: expected a JSON object`);
  const text = (value) => (typeof value === "string" && value.trim() !== "" ? value : undefined);
  const builder = text(parts.builder);
  const action = text(parts.action);
  const guards = Array.isArray(parts.guards) && parts.guards.every((g) => typeof g === "string") ? [...parts.guards] : undefined;
  const missing = [
    builder ? null : "builder (the code version, e.g. sheet-prompt/1)",
    action ? null : "action (the agent's words, verbatim)",
    guards ? null : "guards (an array of clause ids)",
  ].filter(Boolean);
  if (missing.length) fail(`${flag}: missing or malformed ${listOf(missing)}`);
  let guide;
  if (parts.guide !== undefined) {
    const g = parts.guide;
    const whole = (value) => Number.isInteger(value) && value > 0;
    const margin = (value) => Number.isFinite(value) && value >= 0;
    if (!g || typeof g !== "object" || !whole(g.rows) || !whole(g.cols)
      || !whole(g.cell?.width) || !whole(g.cell?.height)
      || !margin(g.safeMargin?.x) || !margin(g.safeMargin?.y)) {
      fail(`${flag}: guide must be { rows, cols, cell: { width, height }, safeMargin: { x, y } } — rows, cols and the cell in whole numbers above 0, the safe margin in pixels at or above 0 (fractions allowed)`);
    }
    guide = {
      rows: g.rows, cols: g.cols,
      cell: { width: g.cell.width, height: g.cell.height },
      safeMargin: { x: g.safeMargin.x, y: g.safeMargin.y },
    };
  }
  return { builder, action, guards, ...(guide ? { guide } : {}) };
}

/**
 * Record a prompt code built, with the parts it was built from — the writer
 * `sheet-prompt` calls, and `set-motion --prompt-parts` exposes. Both go on
 * together or not at all: parts beside a prompt they did not build would
 * make a hand-edited prompt look reproducible.
 */
function recordPromptParts(motion, parts, prompt) {
  if (typeof prompt !== "string" || prompt.trim() === "") {
    fail("--prompt-parts: record the prompt they built with them (--prompt)");
  }
  motion.prompt = prompt;
  motion.promptParts = promptPartsRecord(parts, "--prompt-parts");
}

/**
 * A run's `breathe` block, checked whole, or a refusal naming what it lacks.
 * The record is what a re-run with one parameter changed starts from, so a
 * half of it is refused rather than stored.
 */
function breatheRecord(raw, stillId) {
  if (!raw || typeof raw !== "object") {
    fail("--run: a breathe summary carries no 'breathe' block — is this 'sprite-sheet.mjs breathe --json' output?");
  }
  const depth = finiteNumber(raw.depth);
  const breaths = finiteNumber(raw.breaths);
  const lag = finiteNumber(raw.lag);
  const missing = [
    depth !== undefined && depth >= 0 ? null : "depth",
    breaths !== undefined && Number.isInteger(breaths) && breaths >= 1 ? null : "breaths",
    lag !== undefined ? null : "lag",
    BREATHE_MODES.includes(raw.mode) ? null : "mode",
  ].filter(Boolean);
  if (missing.length) fail(`--run: the breathe block is missing or has a malformed ${listOf(missing)}`);
  const depthX = finiteNumber(raw.depthX);
  const a = raw.anatomy;
  const torsoHalf = a && typeof a === "object" ? finiteNumber(a.torsoHalf) : undefined;
  const anatomy = a && typeof a === "object"
    && finiteNumber(a.rigidRow) !== undefined && finiteNumber(a.axisX) !== undefined
    && (a.from === "detected" || a.from === "override")
    ? {
      rigidRow: a.rigidRow,
      axisX: a.axisX,
      from: a.from,
      // Only a manual torso band is recorded: it changes what is pushed
      // rather than stretched, so a re-run has to be given it again.
      ...(torsoHalf !== undefined && torsoHalf >= 1 ? { torsoHalf } : {}),
    }
    : undefined;
  return {
    still: stillId,
    depth,
    ...(depthX !== undefined && depthX >= 0 ? { depthX } : {}),
    breaths,
    lag,
    mode: raw.mode,
    ...(anatomy ? { anatomy } : {}),
  };
}

/**
 * The motion a mirror run flips, checked the way a reverse's source is: a
 * ready sprite motion of this character facing left or right, with as many
 * registered frames as the run, and not itself a mirror. Returns the source
 * and the direction the mirror faces.
 */
function mirrorSource(doc, motion, run) {
  const id = run.mirrorOf;
  if (typeof id !== "string" || !id) fail("--run: a mirror summary names no 'mirrorOf' — is this 'sprite-sheet.mjs mirror --json' output?");
  const source = doc.sprite.motions.find((m) => m.id === id);
  if (!source) fail(`--run: mirrorOf '${id}' is not a motion of this character (known: ${doc.sprite.motions.map((m) => m.id).join(", ") || "none"})`);
  if (source.id === motion.id) fail(`--run: '${motion.id}' cannot be a mirror of itself`);
  if (source.kind === "loop" || source.kind === "transition") {
    fail(`--run: mirrorOf '${id}' is a ${source.kind} — loops and transitions are not mirrored`);
  }
  if (source.source === "mirror") {
    fail(`--run: mirrorOf '${id}' is itself a mirror of ${source.mirrorOf ?? "another motion"} — mirror that one instead`);
  }
  if (source.status !== "ready") fail(`--run: mirrorOf '${id}' is ${source.status}, not ready — finish it before mirroring it`);
  // The target is itself flipped by another mirror: turning it into a mirror
  // would make that one a mirror of a mirror — the source's side flipped
  // twice, under a record that says once.
  const flippedFrom = doc.sprite.motions.filter((m) => m.id !== motion.id && m.source === "mirror" && m.mirrorOf === motion.id);
  if (flippedFrom.length) {
    fail(`--run: '${motion.id}' is the source of ${flippedFrom.map((m) => m.id).join(", ")} — a mirror of it would then mirror a mirror. Register this run on a motion no mirror is made from, or re-register ${flippedFrom.length === 1 ? "that mirror" : "those mirrors"} from ${id} directly`);
  }
  // An asymmetric character does not flip: its sentence names what a mirror
  // would put on the wrong side. `sprite-sheet.mjs mirror` refuses it unless
  // --force and then says so in the summary; a summary without that is
  // refused here too, so the lock cannot be bypassed by hand.
  const asymmetric = doc.sprite.character?.asymmetric;
  if (asymmetric && run.force !== true) {
    fail(`--run: ${doc.sprite.character.name} is asymmetric ("${asymmetric}") — a mirror would put that on the wrong side. Generate ${motion.id} instead, or mirror with --force if the flip is acceptable (the summary then carries force: true)`);
  }
  const facing = MIRRORED[source.direction];
  if (!facing) {
    fail(source.direction
      ? `--run: mirrorOf '${id}' faces ${source.direction} — a mirror flips one side into the other; a ${source.direction} view flipped is still ${source.direction} with its hands swapped`
      : `--run: mirrorOf '${id}' has no direction — say which side it faces first: set-motion --motion ${id} --direction left|right`);
  }
  if (motion.direction && motion.direction !== facing) {
    fail(`--run: '${motion.id}' faces ${motion.direction}, but a mirror of ${id} (${source.direction}) faces ${facing}`);
  }
  if ((source.frames ?? []).length !== run.frames.length) {
    fail(`--run: mirrorOf ${id} has ${(source.frames ?? []).length} registered frames and this run ${run.frames.length} — mirror it again from ${id} as it is registered now`);
  }
  return { source, facing };
}

/**
 * Why a mirror no longer shows its source flipped, or null when it does.
 *
 * Frame ids are reused when a motion is run again, so matching ids prove
 * nothing; time does, the way `riveReverseIsCurrent` decides it for a
 * reverse: frame i of the mirror was derived (`step: "mirror"`) from frame i
 * of the source, and a source registered again since then has newer frames
 * than that edge.
 */
function mirrorStaleness(doc, mirror) {
  const source = doc.sprite.motions.find((m) => m.id === mirror.mirrorOf);
  if (!source) return `its source '${mirror.mirrorOf}' is gone`;
  const frames = mirror.frames ?? [];
  const sourceFrames = source.frames ?? [];
  if (frames.length !== sourceFrames.length) {
    return `${source.id} has ${sourceFrames.length} frames and this mirror ${frames.length}`;
  }
  const current = frames.every((id, i) => {
    const found = doc.provenance.find((e) => e.toAssetId === id);
    const made = Number(found?.operation?.timestamp);
    const shot = Number(doc.assets.find((a) => a.id === sourceFrames[i])?.createdAt);
    return found?.fromAssetId === sourceFrames[i]
      && found.operation?.params?.step === "mirror"
      && Number.isFinite(made) && Number.isFinite(shot) && shot <= made;
  });
  return current ? null : `${source.id} was registered again after it was mirrored`;
}

/** Every mirror that no longer shows its source, with the reason. */
function staleMirrors(doc) {
  return doc.sprite.motions
    .filter((m) => m.source === "mirror" && typeof m.mirrorOf === "string" && m.mirrorOf)
    .map((m) => ({ id: m.id, mirrorOf: m.mirrorOf, reason: mirrorStaleness(doc, m) }))
    .filter((m) => m.reason !== null);
}

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

/**
 * Pin the palette a pixel run was quantised to, once per character.
 *
 * The palette is per character because it exists to stop colour flicker
 * BETWEEN motions as much as between frames. The first pixel run pins it as
 * `<character>-palette`, derived from that run's frames; a later run
 * quantised to the same file (same uri, same bytes) changes nothing, and one
 * quantised to a different palette is refused unless `--repin`. Returns the
 * stderr lines the caller prints after the write.
 */
function pinPalette(doc, dir, motion, run, frameIds, repin, now) {
  const report = run.pixel;
  if (!report || typeof report !== "object" || report.palette === undefined) return [];
  // `run --pixel` reports the palette as `{ file, colors, pinned }`; a bare
  // path (with `colors` beside it) is the short form a hand-made summary
  // may use. Both name one file.
  const given = report.palette;
  const path = typeof given === "string" ? given : given && typeof given === "object" ? given.file : undefined;
  if (typeof path !== "string" || !path) {
    fail("--run: pixel.palette names no file — expected { file, colors } (what 'sprite-sheet.mjs run --pixel' writes) or a path");
  }
  const character = doc.sprite.character;
  if (!character.pixel || !(Number(character.pixel.logicalHeight) > 0)) {
    fail(`--run: this run was quantised to a pixel palette, but ${character.name} is not declared pixel art — declare it first: set-character --pixel <height in logical pixels>`);
  }
  const uri = toUri(dir, path, "--run pixel.palette");
  const file = requireFile(dir, uri, "--run pixel.palette");
  const hash = sha256(file);
  const pinned = character.pixel.palette ? doc.assets.find((a) => a.id === character.pixel.palette) : null;
  if (pinned && pinned.uri === uri && pinned.metadata?.sha256 === hash) return [];
  if (pinned && !repin) {
    // The same file with other bytes: the pinned palette itself was rebuilt
    // (`--repalette`, or a hand edit). There is no "pinned palette" left to
    // re-run against — only pinning the file as it is now.
    fail(pinned.uri === uri
      ? `--run: ${uri} is the palette pinned for ${character.name}, but the file changed since it was pinned — the motions quantised to it before no longer match it. Pass --repin to pin it as it is now (then run those motions again), or restore the file.`
      : `--run: this run was quantised to ${uri}, not to the palette pinned for ${character.name} (${pinned.uri}) — every motion of a pixel character shares one palette so colours do not flicker between them. Re-run it against the pinned palette (run --pixel uses it when --palette is not given), or pass --repin to pin this one instead.`);
  }
  const id = `${basename(resolve(dir))}-palette`;
  const colors = finiteNumber(typeof given === "object" && given.colors !== undefined ? given.colors : report.colors);
  const counted = Number.isInteger(colors) && colors > 0 ? colors : undefined;
  upsertAsset(doc, {
    id, type: "text", uri, name: `${character.name} palette`,
    metadata: {
      ...(counted === undefined ? {} : { colors: counted }),
      ...(fileSize(file) === undefined ? {} : { size: fileSize(file) }),
      sha256: hash,
    },
    createdAt: now, status: "ready",
  }, CHARACTER_OWNER);
  setEdge(doc, edge(id, frameIds, operation("derive", now, {
    tool: TOOL, step: "palette", motion: motion.id, colors: counted,
  }, frameIds)));
  const variants = recordedVariants(character);
  character.pixel = {
    logicalHeight: character.pixel.logicalHeight,
    palette: id,
    ...(counted !== undefined ? { colors: counted } : character.pixel.colors !== undefined ? { colors: character.pixel.colors } : {}),
    ...(variants.length ? { variants } : {}),
  };
  if (!pinned) return [];
  const others = doc.sprite.motions.filter((m) => m.id !== motion.id && m.status === "ready").map((m) => m.id);
  return [`re-pinned ${id} to ${uri}${others.length ? ` — ${listOf(others)} ${others.length === 1 ? "was" : "were"} quantised to the old palette; run ${others.length === 1 ? "it" : "them"} again to match` : ""}${variants.length ? `; the colourways (${listOf(variants.map((v) => v.name))}) map the old palette's colours — draft a new map (recolor-palette) and check each one's report` : ""}`];
}

// ---------------------------------------------------------------------------
// Colourways (recolor)
// ---------------------------------------------------------------------------
//
// A colourway is recorded ONCE, on the character: `character.pixel.variants`
// = [{ name, map, tolerance? }] — the swap, so a motion made again can be
// re-baked with it and a later session knows what "red-team" means. Each
// motion names only the files its bake left: `motion.variants[name] = { sheet,
// atlas, gif }`, asset ids `<motion>-variant-<name>-sheet|atlas|gif`, derived
// from the motion's frames. The rules for a colourway are `recolor.mjs`'s.

const variantAssetId = (motionId, name, part) => `${motionId}-variant-${name}-${part}`;

/** The asset ids a motion's colourway files are registered under. */
function variantAssetIds(motion) {
  const variants = motion?.variants && typeof motion.variants === "object" ? motion.variants : {};
  return Object.values(variants).flatMap((files) => [files?.sheet, files?.atlas, files?.gif].filter((id) => typeof id === "string"));
}

/** The character's colourways as recorded, or []. */
function recordedVariants(character) {
  const variants = character?.pixel?.variants;
  return Array.isArray(variants) ? variants : [];
}

/**
 * Unregister colourway files — of the `names` given, or every one when null —
 * from every motion (or only `motions`), the files staying on disk. Returns
 * the stderr notes, one per motion, saying `why`.
 */
function retireVariants(doc, names, why, motions = doc.sprite.motions) {
  const notes = [];
  for (const motion of motions) {
    const variants = motion.variants && typeof motion.variants === "object" ? motion.variants : null;
    if (!variants) continue;
    const gone = Object.keys(variants).filter((name) => names === null || names.includes(name));
    if (!gone.length) continue;
    const ids = gone.flatMap((name) => variantAssetIds({ variants: { [name]: variants[name] } }));
    const uris = doc.assets.filter((a) => ids.includes(a.id)).map((a) => a.uri);
    dropAssets(doc, ids);
    for (const name of gone) delete variants[name];
    if (!Object.keys(variants).length) delete motion.variants;
    notes.push(`note: unregistered ${motion.id}'s ${listOf(gone)} colourway files — ${why}${uris.length ? ` (the files stay on disk: ${uris.join(", ")})` : ""}`);
  }
  return notes;
}

/** The ready sprite motions missing a recorded colourway: `[{ motion, variants }]`. */
function variantsMissing(doc) {
  const names = recordedVariants(doc.sprite.character).map((v) => v.name);
  if (!names.length) return [];
  return doc.sprite.motions
    .filter((m) => !m.kind && m.status === "ready" && m.sheet)
    .map((m) => ({ motion: m.id, variants: names.filter((name) => !m.variants?.[name]) }))
    .filter((m) => m.variants.length);
}

/** The `--json` report of `sprite-sheet.mjs recolor`, from a file or stdin. */
function readRecolorReport(source) {
  const text = source === "-" ? readFileSync(0, "utf-8") : (() => {
    const path = resolve(source);
    if (!existsSync(path)) fail(`--report: file not found: ${path}`);
    return readFileSync(path, "utf-8");
  })();
  if (!text.trim()) {
    fail("--report: the report is empty — recolor printed nothing on stdout, which means it failed; its ERROR: line above says why, and nothing was registered");
  }
  let report;
  try {
    report = JSON.parse(text);
  } catch (error) {
    fail(`--report: not valid JSON (${error.message}) — pass the --json output of sprite-sheet.mjs recolor`);
  }
  if (!report || report.kind !== "recolor") {
    fail(`--report: expected the --json report of sprite-sheet.mjs recolor (kind recolor), got kind '${report?.kind}'`);
  }
  if (!Array.isArray(report.variants) || !report.variants.length) fail("--report: the report names no colourways");
  if (!Array.isArray(report.motions) || !report.motions.length) fail("--report: the report lists no motions");
  return report;
}

/** A colourway rule of `recolor.mjs`, refused as this script refuses. */
function variantRule(fn) {
  try {
    return fn();
  } catch (error) {
    if (error instanceof RecolorError) fail(error.message);
    throw error;
  }
}

/**
 * `register-recolor`: record the colourways the bake used on the character
 * and each motion's files for them. A colourway whose swap changed retires
 * the files other motions made with the old one — they would be offered as
 * that colourway while showing the old colours.
 */
function registerRecolor(doc, dir, report, now) {
  const character = doc.sprite.character;
  const pixel = character.pixel;
  if (!pixel || !(Number(pixel.logicalHeight) > 0) || !pixel.palette) {
    fail(`--report: ${character.name} is not ${pixel ? "palette-pinned" : "pixel art"} — colourways belong to a pixel-art character with a pinned palette`);
  }
  if (report.palette?.id !== undefined && report.palette.id !== pixel.palette) {
    fail(`--report: this bake read the palette ${report.palette.id}, but ${character.name}'s pinned palette is ${pixel.palette} — recolor again`);
  }
  const variants = variantRule(() => report.variants.map((v, i) => checkVariant(v, `--report variants[${i}]`)));
  const names = variants.map((v) => v.name);
  if (new Set(names).size !== names.length) fail("--report: two colourways share a name");
  const recorded = recordedVariants(character);
  const changed = variants.filter((v) => {
    const old = recorded.find((r) => r.name === v.name);
    return old && !sameVariant(old, v);
  }).map((v) => v.name);
  const inReport = new Set(report.motions.map((m) => String(m?.id)));
  const notes = retireVariants(doc, changed, "they were baked with the old map; recolor them again",
    doc.sprite.motions.filter((m) => !inReport.has(m.id)));
  /** Metadata with the file's size, when it can be read. */
  const sized = (metadata, file) => {
    const size = fileSize(file);
    return size === undefined ? metadata : { ...metadata, size };
  };

  const registered = report.motions.map((entry) => {
    const motion = findMotion(doc, String(entry?.id), "--report motion");
    if (motion.kind || motion.status !== "ready") {
      fail(`--report: '${motion.id}' is ${motion.kind ? `a ${motion.kind}` : `not ready (${motion.status})`} — only a ready sprite motion has colourways`);
    }
    const expected = frameUris(doc, motion.frames ?? []);
    const got = (Array.isArray(entry.frames) ? entry.frames : []).map((path) => toUri(dir, String(path), "--report frames"));
    if (got.length !== expected.length || got.some((u, i) => u !== expected[i])) {
      fail(`--report: '${motion.id}' was recoloured from ${got.length} frames that are not the ones registered for it (${expected.length}) — recolor it again from the motion as it is registered now`);
    }
    const owner = `motion '${motion.id}'`;
    const files = {};
    for (const baked of Array.isArray(entry.variants) ? entry.variants : []) {
      const variant = variants.find((v) => v.name === baked?.name);
      if (!variant) fail(`--report: '${motion.id}' carries a colourway '${baked?.name}' the report does not define`);
      const label = `--report ${motion.id} ${variant.name}`;
      const uriOf = (key) => {
        if (typeof baked[key] !== "string") fail(`${label}: no '${key}' — is this 'sprite-sheet.mjs recolor --json' output?`);
        const uri = toUri(dir, baked[key], `${label} ${key}`);
        return { uri, file: requireFile(dir, uri, `${label} ${key}`) };
      };
      const sheet = uriOf("sheet");
      const atlas = uriOf("atlas");
      const gif = uriOf("gif");
      const ids = { sheet: variantAssetId(motion.id, variant.name, "sheet"), atlas: variantAssetId(motion.id, variant.name, "atlas"), gif: variantAssetId(motion.id, variant.name, "gif") };
      const counts = {
        substituted: reported(baked.substituted),
        unmatched: Array.isArray(baked.unmatched) ? baked.unmatched.length : undefined,
        uncovered: reported(baked.uncovered?.colors),
      };
      for (const key of Object.keys(counts)) if (counts[key] === undefined) delete counts[key];
      upsertAsset(doc, {
        id: ids.sheet, type: "image", uri: sheet.uri, name: `${motion.id} atlas image (${variant.name})`,
        metadata: sized({ ...imageMetadata(sheet.file, `${label} sheet`), ...counts }, sheet.file),
        createdAt: now, status: "ready",
      }, owner);
      const params = { tool: TOOL, step: "recolor", variant: variant.name, tolerance: variant.tolerance };
      setEdge(doc, edge(ids.sheet, motion.frames, operation("derive", now, params, motion.frames)));
      upsertAsset(doc, {
        id: ids.atlas, type: "text", uri: atlas.uri, name: `${motion.id} atlas (${variant.name})`,
        metadata: sized({}, atlas.file), createdAt: now, status: "ready",
      }, owner);
      setEdge(doc, edge(ids.atlas, [ids.sheet], operation("derive", now, { tool: TOOL, step: "pack" })));
      upsertAsset(doc, {
        id: ids.gif, type: "image", uri: gif.uri, name: `${motion.id} preview (${variant.name})`,
        metadata: sized({ ...imageMetadata(gif.file, `${label} gif`), ...(motion.fps ? { fps: motion.fps } : {}) }, gif.file),
        createdAt: now, status: "ready",
      }, owner);
      setEdge(doc, edge(ids.gif, motion.frames, operation("derive", now, params, motion.frames)));
      files[variant.name] = ids;
    }
    motion.variants = { ...(motion.variants ?? {}), ...files };
    return { id: motion.id, variants: files };
  });

  // The colourways, recorded once: a changed one replaces its record in
  // place, a new one is appended.
  const merged = [
    ...recorded.map((r) => variants.find((v) => v.name === r.name) ?? r),
    ...variants.filter((v) => !recorded.some((r) => r.name === v.name)),
  ];
  character.pixel = { ...pixel, variants: merged };
  return { variants: merged.map((v) => v.name), motions: registered, notes };
}

/**
 * One motion, said out loud for the agent.
 *
 * A loop is described by different facts than a sprite motion: nobody cares
 * about its grid, and the two numbers that decide whether the workflow
 * succeeded — does the last frame return to the first — have nowhere else to
 * be read. Derived clips get their parent printed beside them, because
 * "video-2" alone cannot tell you it is the matte of video-1.
 */
function motionLines(motion, doc) {
  const frameCount = motion.frames?.length ?? 0;
  const lines = [];
  if (motion.kind === "transition") {
    lines.push(`${motion.id} (${motion.label}) — transition ${motion.from} → ${motion.to}${motion.reverseOf ? `, ${motion.reverseOf} played backwards` : ""}, ${motion.status}, ${frameCount} frames @ ${motion.fps}fps`);
    const { brief } = readTransitionBrief(motion);
    if (!motion.reverseOf) {
      lines.push(brief
        ? `  brief: plays ${brief.duration}s, budget $${brief.budgetUsd}`
        : "  brief: none — ask the user before the take (set-motion --brief-duration <s> --brief-budget <usd>)");
    }
    const step = motion.inspect?.step;
    for (const [end, gap, loop] of [["start", motion.inspect?.startGap, motion.from], ["end", motion.inspect?.endGap, motion.to]]) {
      if (Number.isFinite(gap) && Number.isFinite(step)) {
        lines.push(`  ${end}Gap ${round4(gap)} vs step ${round4(step)} (limit ${round4(2 * step)}) — ${gap > 2 * step ? `does not land on ${loop}'s frame 0` : "joins"}`);
      }
    }
  } else if (motion.kind === "loop") {
    lines.push(`${motion.id} (${motion.label}) — loop, ${motion.status}, ${frameCount} frames @ ${motion.fps}fps`);
    // The brief first: it is what everything below is judged against, and a
    // loop that has none cannot be shot yet. A half-written one is none, and
    // says so rather than printing "undefinedpx" as if it were an answer.
    const { brief, missing } = readBrief(motion);
    lines.push(brief ? briefLine(brief) : missing
      ? `  brief: incomplete, missing ${listOf(missing)} — re-record it before the clip (set-motion --brief-duration … --brief-width … --brief-interpolator …)`
      : "  brief: none — ask the user before the clip (set-motion --brief-duration … --brief-width … --brief-interpolator …)");
    const seam = motion.inspect?.seam;
    const step = motion.inspect?.step;
    if (Number.isFinite(seam) && Number.isFinite(step)) {
      // The bar the run recorded, or — on a loop cut before it did — the
      // 2·step rule that run used.
      const limit = Number.isFinite(motion.inspect?.seamLimit) ? motion.inspect.seamLimit : 2 * step;
      lines.push(`  seam ${round4(seam)} vs step ${round4(step)} (limit ${round4(limit)}) — ${seam > limit ? "does not close" : "closes"}`);
    }
    const exports = motion.exports ?? {};
    const present = [
      motion.webp ? "webp" : null, exports.apng ? "apng" : null,
      exports.webm ? "webm" : null, exports.lottie ? "lottie" : null,
      ...Object.keys(exports).filter((format) => !["apng", "webm", "lottie"].includes(format)),
    ].filter(Boolean);
    lines.push(`  exports: ${present.join(", ") || "none yet"}`);
  } else {
    lines.push(`${motion.id} (${motion.label}) — ${motion.status}, ${motion.grid.rows}x${motion.grid.cols} @ ${motion.fps}fps, ${frameCount} frames`);
    if (motion.source === "breathe" && motion.breathe) {
      const b = motion.breathe;
      // The path too: a re-run passes the still again, and the id alone
      // would send the agent to look it up.
      const stillUri = doc?.assets.find((asset) => asset.id === b.still)?.uri;
      lines.push(`  breathe of ${b.still}${stillUri ? ` (${stillUri})` : ""}: depth ${b.depth}${b.depthX === undefined ? "" : ` (x ${b.depthX})`}, ${b.breaths} breath${b.breaths === 1 ? "" : "s"}, lag ${b.lag}, ${b.mode}${b.anatomy ? `, rigid row ${b.anatomy.rigidRow}, axis ${b.anatomy.axisX}${b.anatomy.torsoHalf === undefined ? "" : `, torso ${b.anatomy.torsoHalf}`} (${b.anatomy.from})` : ""}`);
    } else if (motion.source === "mirror" && motion.mirrorOf) {
      lines.push(`  mirror of ${motion.mirrorOf}`);
    }
    const exported = Object.keys(motion.exports ?? {});
    if (exported.length) lines.push(`  exports: ${exported.join(", ")}`);
    const colourways = Object.keys(motion.variants ?? {});
    if (colourways.length) lines.push(`  colourways: ${colourways.join(", ")}`);
  }
  if (motion.direction) lines.push(`  faces ${motion.direction}`);
  if (motion.promptParts) {
    lines.push(`  prompt built by ${motion.promptParts.builder}${motion.promptParts.guards.length ? ` (guards: ${motion.promptParts.guards.join(", ")})` : ""}`);
  }
  for (const video of motion.videos ?? []) {
    lines.push(video.derivedFrom
      ? `  ${video.id} ← ${video.derivedFrom} (${video.op}, ${video.model}) — ${video.status}`
      : `  ${video.id} (${video.model}, ${video.mode}) — ${video.status}`);
  }
  return lines;
}

function summarize(doc, dir) {
  const stale = staleMirrors(doc);
  const missing = variantsMissing(doc);
  return {
    dir: resolve(dir),
    title: doc.title,
    character: doc.sprite.character,
    refs: doc.sprite.refs.map((ref) => ({
      id: ref.id,
      role: ref.role,
      ...(ref.direction ? { direction: ref.direction } : {}),
      origin: refOrigin(doc, ref.asset),
      label: ref.label,
      uri: doc.assets.find((a) => a.id === ref.asset)?.uri ?? null,
    })),
    motions: doc.sprite.motions.map(compactMotion),
    ...(doc.sprite.exports && Object.keys(doc.sprite.exports).length ? { exports: doc.sprite.exports } : {}),
    // Only when there is one: a 0.4.x summary stays byte-for-byte what it was.
    ...(stale.length ? { staleMirrors: stale } : {}),
    ...(missing.length ? { variantsMissing: missing } : {}),
  };
}

function compactMotion(motion) {
  const { brief } = readBrief(motion);
  return {
    id: motion.id,
    label: motion.label,
    // Absent for a sprite motion, so the JSON summary of the motions this
    // mode has always made is byte-for-byte what it was. (`show`'s HUMAN
    // line is not: its grid column is padded to seven so `loop` can stand
    // where `4x4` does, which moves the columns after it.)
    ...(motion.kind ? { kind: motion.kind } : {}),
    // The 0.5.0 fields follow the same rule: only when the motion has them.
    ...(motion.direction ? { direction: motion.direction } : {}),
    ...(motion.source === "breathe" || motion.source === "mirror" ? { source: motion.source } : {}),
    ...(motion.source === "mirror" && motion.mirrorOf ? { mirrorOf: motion.mirrorOf } : {}),
    ...(motion.variants && Object.keys(motion.variants).length ? { variants: Object.keys(motion.variants) } : {}),
    // Loop motions only, and only once recorded WHOLE — the same rule `kind`
    // follows, so a sprite motion's summary is byte-for-byte what it was, and
    // the summary never hands a later turn half an answer to work to.
    ...(brief ? { brief } : {}),
    status: motion.status,
    grid: motion.grid,
    fps: motion.fps,
    loop: motion.loop,
    anchor: motion.anchor,
    frameCount: motion.frames?.length ?? 0,
    videoCount: motion.videos?.length ?? 0,
    warnings: motion.inspect?.warnings ?? [],
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const COMMON = {
  dir: { type: "string" },
  at: { type: "string" },
  json: { type: "boolean", default: false },
  help: { type: "boolean", short: "h", default: false },
};

const OPTIONS = {
  init: {
    name: { type: "string" }, description: { type: "string" }, style: { type: "string" },
    cell: { type: "string" }, facing: { type: "string" }, force: { type: "boolean", default: false },
    purpose: { type: "string" }, asymmetric: { type: "string" }, pixel: { type: "string" }, colors: { type: "string" },
  },
  "set-character": {
    description: { type: "string" }, style: { type: "string" }, facing: { type: "string" },
    purpose: { type: "string" }, asymmetric: { type: "string" }, pixel: { type: "string" }, colors: { type: "string" },
    "no-pixel": { type: "boolean", default: false }, "remove-variant": { type: "string" },
  },
  "add-ref": {
    id: { type: "string" }, file: { type: "string" }, role: { type: "string" }, label: { type: "string" },
    direction: { type: "string" },
    prompt: { type: "string" }, model: { type: "string" }, from: { type: "string", multiple: true },
    uploaded: { type: "boolean", default: false }, "derived-from": { type: "string" }, op: { type: "string" },
  },
  "add-motion": {
    id: { type: "string" }, label: { type: "string" }, rows: { type: "string" }, cols: { type: "string" },
    fps: { type: "string" }, loop: { type: "boolean", default: false }, "no-loop": { type: "boolean", default: false },
    anchor: { type: "string" }, prompt: { type: "string" }, status: { type: "string" },
    source: { type: "string" }, kind: { type: "string" }, from: { type: "string" }, to: { type: "string" },
    direction: { type: "string" },
  },
  "set-motion": {
    motion: { type: "string" }, label: { type: "string" }, fps: { type: "string" },
    loop: { type: "boolean", default: false }, "no-loop": { type: "boolean", default: false },
    anchor: { type: "string" }, prompt: { type: "string" }, status: { type: "string" }, notes: { type: "string" },
    "ack-warnings": { type: "string" }, "clear-ack": { type: "boolean", default: false },
    "brief-duration": { type: "string" }, "brief-width": { type: "string" },
    "brief-interpolator": { type: "string" }, "brief-budget": { type: "string" },
    direction: { type: "string" }, "prompt-parts": { type: "string" },
  },
  "sheet-prompt": {
    motion: { type: "string" }, action: { type: "string" }, frames: { type: "string" }, state: { type: "string" },
    guide: { type: "boolean", default: false }, "no-guide": { type: "boolean", default: false },
  },
  "set-sheet": {
    motion: { type: "string" }, file: { type: "string" }, from: { type: "string", multiple: true },
    model: { type: "string" }, prompt: { type: "string" }, background: { type: "string" }, status: { type: "string" },
  },
  "set-keyframe": {
    motion: { type: "string" }, file: { type: "string" }, alpha: { type: "string" },
    from: { type: "string", multiple: true }, model: { type: "string" }, prompt: { type: "string" },
    status: { type: "string" },
  },
  "register-run": {
    motion: { type: "string" }, run: { type: "string" }, video: { type: "string" },
    repin: { type: "boolean", default: false },
  },
  "register-export": { report: { type: "string" } },
  "register-recolor": { report: { type: "string" } },
  "add-video": {
    motion: { type: "string" }, file: { type: "string" }, model: { type: "string" }, mode: { type: "string" },
    from: { type: "string", multiple: true }, prompt: { type: "string" }, duration: { type: "string" },
    status: { type: "string" }, "derived-from": { type: "string" }, op: { type: "string" },
  },
  "set-video": {
    motion: { type: "string" }, video: { type: "string" }, status: { type: "string" }, notes: { type: "string" },
  },
  "remove-motion": { motion: { type: "string" } },
  show: { motion: { type: "string" } },
};

function emit(values, payload, humanLines) {
  if (values.json) console.log(JSON.stringify(payload));
  else console.log(humanLines.join("\n"));
}

function readRunSummary(source) {
  const text = source === "-" ? readFileSync(0, "utf-8") : (() => {
    const path = resolve(source);
    if (!existsSync(path)) fail(`--run: file not found: ${path}`);
    return readFileSync(path, "utf-8");
  })();
  // A run that FAILED prints its `ERROR:` on stderr and nothing on stdout, so
  // the piped form (`breathe --name … --json | register-run --run -`) hands
  // this command an empty summary — said as such, not as a JSON syntax error.
  if (!text.trim()) {
    fail("--run: the run summary is empty — the command that should have written it printed nothing, which means it failed; its ERROR: line says why, and nothing was registered");
  }
  let run;
  try {
    run = JSON.parse(text);
  } catch (error) {
    fail(`--run: not valid JSON (${error.message})`);
  }
  // A loop run produces no sheet, no atlas and no GIF — asking it for them
  // would make the whole `loop` subcommand unregisterable. A sprite run is
  // still required to carry all four: a `run` summary missing its atlas is a
  // half-finished pipeline, not a new shape.
  const loopRun = run.kind === "loop" || run.kind === "transition";
  const command = run.kind === "transition" ? "transition" : loopRun ? "loop" : "run";
  for (const key of loopRun ? ["frames"] : ["frames", "sheet", "atlas", "gif"]) {
    if (run[key] === undefined) fail(`--run: the run summary has no '${key}' — is this 'sprite-sheet.mjs ${command} --json' output?`);
  }
  if (!Array.isArray(run.frames) || !run.frames.length) fail("--run: 'frames' must be a non-empty array");
  return run;
}

/**
 * The `--json` report of `sprite-sheet.mjs export` or `rive`, from a file or
 * stdin. An export that FAILED prints its `ERROR:` on stderr and nothing on
 * stdout, so the documented pipe hands this command an empty report — which
 * is said as such, pointing at the line that explains it.
 */
function readExportReport(source) {
  const text = source === "-" ? readFileSync(0, "utf-8") : (() => {
    const path = resolve(source);
    if (!existsSync(path)) fail(`--report: file not found: ${path}`);
    return readFileSync(path, "utf-8");
  })();
  if (!text.trim()) {
    fail("--report: the report is empty — the export printed nothing on stdout, which means it failed; its ERROR: line above says why, and nothing was registered");
  }
  let report;
  try {
    report = JSON.parse(text);
  } catch (error) {
    fail(`--report: not valid JSON (${error.message}) — pass the --json output of sprite-sheet.mjs export or rive`);
  }
  if (!report || (report.kind !== "export" && report.kind !== "rive")) {
    fail(`--report: expected the --json report of sprite-sheet.mjs export or rive (kind export or rive), got kind '${report?.kind}'`);
  }
  if (typeof report.out !== "string" || !report.out) fail("--report: the report names no output file ('out')");
  if (!Array.isArray(report.frames) || !report.frames.length) fail("--report: the report lists no frames");
  return report;
}

/** The uris of a list of frame asset ids, as project.json records them. */
function frameUris(doc, ids) {
  return ids.map((id) => doc.assets.find((a) => a.id === id)?.uri ?? null);
}

/** A number the report carried, or undefined — metadata keeps only real readings. */
const reported = (value) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

/**
 * `<motion>-export-<format>`: one file `sprite-sheet.mjs export` made from a
 * ready motion. Its parent is every frame it was made of — which must be the
 * frames registered NOW, or the edge would describe pictures the file does
 * not contain.
 */
function registerMotionExport(doc, dir, report, now) {
  const motion = findMotion(doc, String(report.motion), "--report motion");
  const format = String(report.format);
  const spec = EXPORT_SPECS[format];
  if (!spec) fail(`--report: format '${format}' is not one export writes (${Object.keys(EXPORT_SPECS).join(", ")})`);
  const id = exportAssetId(motion.id, format);
  const current = motion.exports?.[format];
  if (current && current !== id) {
    fail(`--report: ${motion.id} already ships ${format} as ${current} — that file is the deliverable; nothing to register`);
  }
  const uri = toUri(dir, report.out, "--report out");
  const file = requireFile(dir, uri, "--report out");

  const expected = frameUris(doc, motion.frames ?? []);
  const got = report.frames.map((path) => toUri(dir, String(path), "--report frames"));
  if (got.length !== expected.length || got.some((u, i) => u !== expected[i])) {
    fail(`--report: the export was made from ${got.length} frames that are not the frames registered for '${motion.id}' (${expected.length}) — export it again from the motion as it is registered now`);
  }

  const size = fileSize(file);
  const metadata = {
    width: reported(report.width),
    height: reported(report.height),
    fps: reported(report.fps),
    duration: reported(report.duration),
    frames: reported(report.frameCount),
    repeat: reported(report.repeat),
    scale: reported(report.scale),
    ...(typeof report.background === "string" ? { background: report.background } : {}),
    ...(shadowSettings(report.shadow) ? { shadow: shadowSettings(report.shadow) } : {}),
    ...(spec.container ? { container: spec.container } : {}),
    size,
  };
  for (const key of Object.keys(metadata)) if (metadata[key] === undefined) delete metadata[key];

  upsertAsset(doc, {
    id, type: spec.type, uri, name: `${motion.id} export (${format})`,
    metadata, createdAt: now, status: "ready",
  }, `motion '${motion.id}'`);
  setEdge(doc, edge(id, motion.frames, operation("derive", now, {
    tool: TOOL,
    step: "export",
    format,
    repeat: reported(report.repeat),
    scale: reported(report.scale),
    background: typeof report.background === "string" ? report.background : undefined,
    shadow: shadowSettings(report.shadow),
  }, motion.frames)));
  motion.exports = { ...(motion.exports ?? {}), [format]: id };
  return { motion: motion.id, format, asset: id, uri, metadata };
}

/** The shadow a report says it cast — the settings, not where it landed —
 *  or undefined when it cast none. */
function shadowSettings(value) {
  if (!value || typeof value !== "object") return undefined;
  const settings = {
    squash: finiteNumber(value.squash),
    shear: finiteNumber(value.shear),
    opacity: finiteNumber(value.opacity),
    blur: finiteNumber(value.blur),
    color: typeof value.color === "string" && /^#[0-9a-f]{6}$/.test(value.color) ? value.color : undefined,
  };
  return Object.values(settings).every((v) => v !== undefined) ? settings : undefined;
}

/**
 * The frames a character-wide export was made from, checked against the
 * frames registered NOW for the motions it names — or refused, because the
 * edge would describe pictures the file does not contain.
 */
function characterExportFrames(doc, dir, report, again) {
  const motionIds = Array.isArray(report.motions) ? report.motions.map((m) => String(m?.id ?? m)) : [];
  if (!motionIds.length) fail("--report: the report lists no motions");
  const motions = motionIds.map((motionId) => {
    const motion = findMotion(doc, motionId, "--report motions");
    if (motion.status !== "ready") fail(`--report: '${motionId}' is not ready (${motion.status})`);
    return motion;
  });
  const frameIds = motions.flatMap((motion) => motion.frames ?? []);
  const expected = frameUris(doc, frameIds);
  const got = report.frames.map((path) => toUri(dir, String(path), "--report frames"));
  if (got.length !== expected.length || got.some((u, i) => u !== expected[i])) {
    fail(`--report: the file holds ${got.length} frames that are not the frames registered for ${motionIds.join(", ")} (${expected.length}) — ${again}`);
  }
  return { motionIds, motions, frameIds };
}

/**
 * `<character>-export-aseprite`: every sprite motion of the character on one
 * sheet, one frame tag each (`sprite-sheet.mjs export <characterDir> --format
 * aseprite`). Filed like the `.riv`: on the character (`sprite.exports
 * .aseprite`), hung off every frame on the sheet, its motions in
 * `params.motions` so a later register-run or remove-motion retires it.
 */
function registerCharacterAseprite(doc, dir, report, now) {
  const character = basename(resolve(dir));
  const id = `${character}-export-aseprite`;
  const uri = toUri(dir, report.out, "--report out");
  const file = requireFile(dir, uri, "--report out");
  const { motionIds, motions, frameIds } = characterExportFrames(doc, dir, report, "export it again");
  const shadow = shadowSettings(report.shadow);
  const metadata = {
    width: reported(report.sheet?.w),
    height: reported(report.sheet?.h),
    frames: reported(report.frameCount) ?? frameIds.length,
    motionCount: motions.length,
    scale: reported(report.scale),
    ...(shadow ? { shadow } : {}),
    container: "zip",
    size: fileSize(file),
  };
  for (const key of Object.keys(metadata)) if (metadata[key] === undefined) delete metadata[key];
  upsertAsset(doc, {
    id, type: "image", uri, name: `${doc.sprite.character?.name ?? character} (aseprite)`,
    metadata, createdAt: now, status: "ready",
  }, CHARACTER_OWNER);
  const tags = (Array.isArray(report.tags) ? report.tags : [])
    .filter((t) => t && typeof t.name === "string" && Number.isInteger(t.from) && Number.isInteger(t.to))
    .map((t) => ({ name: t.name, from: t.from, to: t.to }));
  setEdge(doc, edge(id, frameIds, operation("derive", now, {
    tool: TOOL,
    step: "export",
    format: "aseprite",
    scale: reported(report.scale),
    shadow,
    motions: motionIds,
    ...(tags.length ? { tags } : {}),
  }, frameIds)));
  doc.sprite.exports = { ...(doc.sprite.exports ?? {}), aseprite: id };
  return { format: "aseprite", scope: "character", asset: id, uri, motions: motionIds, metadata };
}

/**
 * `<character>-export-riv`: the whole character as one `.riv`. It belongs to
 * the character, not to a motion (`sprite.exports.riv`), and hangs off every
 * frame it embeds; `params.motions` is what a later `register-run` or
 * `remove-motion` reads to know the file no longer describes the frames.
 */
function registerRiv(doc, dir, report, now) {
  const character = basename(resolve(dir));
  const id = `${character}-export-riv`;
  const uri = toUri(dir, report.out, "--report out");
  const file = requireFile(dir, uri, "--report out");
  const { motionIds, motions, frameIds } = characterExportFrames(doc, dir, report, "run rive again");

  const metadata = {
    width: reported(report.artboard?.width),
    height: reported(report.artboard?.height),
    // What the file EMBEDS — a loop goes in resampled, so this can be far
    // fewer than the frames it was made from (those are the edge's inputs).
    frames: reported(report.frameCount) ?? frameIds.length,
    // Motions a user plays; the clips between loops are counted apart.
    motionCount: motions.filter((m) => m.kind !== "transition").length,
    transitionCount: motions.filter((m) => m.kind === "transition").length,
    images: ["webp", "webp-lossless", "png"].includes(report.images) ? report.images : "png",
    estimatedDecodeBytes: reported(report.estimatedDecodeBytes),
    container: "riv",
    size: fileSize(file),
  };
  for (const key of Object.keys(metadata)) if (metadata[key] === undefined) delete metadata[key];

  upsertAsset(doc, {
    id, type: "image", uri, name: `${doc.sprite.character?.name ?? character} (rive)`,
    metadata, createdAt: now, status: "ready",
  }, CHARACTER_OWNER);
  // Each motion as the file plays it — the rate and size it was resampled
  // to — so nobody reads the source frames' 60 fps and 512 px into the .riv.
  const sampled = (Array.isArray(report.motions) ? report.motions : [])
    .filter((m) => m && typeof m === "object")
    .map((m) => ({
      motion: String(m.id),
      frames: reported(m.frames),
      fps: reported(m.fps),
      width: reported(m.width),
      height: reported(m.height),
    }));
  setEdge(doc, edge(id, frameIds, operation("derive", now, {
    tool: TOOL,
    step: "rive",
    images: metadata.images,
    motions: motionIds,
    ...(sampled.length ? { sampled } : {}),
    stateMachine: riveMachineRecord(report.stateMachine),
  }, frameIds)));
  doc.sprite.exports = { ...(doc.sprite.exports ?? {}), riv: id };

  // What `rive` measured for a loop cut before `loop` recorded its crop: kept
  // on the motion, so the Export tab quotes the plan the script follows (it
  // cannot decode a clip) and the next export reuses it. A recorded crop and
  // scale win and are never overwritten; an unknown one erases nothing.
  const measured = [];
  for (const entry of Array.isArray(report.motions) ? report.motions : []) {
    const clip = measuredClip(entry?.clip);
    if (!clip) continue;
    const motion = motions.find((m) => m.id === String(entry.id));
    if (!motion || motion.kind !== "loop" || finiteNumber(motion.inspect?.scale) > 0) continue;
    motion.clip = clip;
    measured.push(motion.id);
  }
  return { format: "riv", asset: id, uri, motions: motionIds, metadata, ...(measured.length ? { measured } : {}) };
}

/**
 * What a developer — and the viewer's Rive preview — drives the file with:
 * the machine's name, the hub, the number input and what each of its values
 * means, and the one-shot triggers. Taken from the report's inputs; nothing
 * the report does not state is invented. Undefined when the report names no
 * machine.
 */
function riveMachineRecord(machine) {
  if (!machine || typeof machine !== "object" || typeof machine.name !== "string") return undefined;
  const inputs = Array.isArray(machine.inputs) ? machine.inputs.filter((i) => i && typeof i.name === "string") : [];
  const number = inputs.find((i) => i.type === "number");
  return {
    name: machine.name,
    hub: typeof machine.hub === "string" ? machine.hub : null,
    number: number
      ? {
        name: number.name,
        default: finiteNumber(number.default) ?? 0,
        values: (Array.isArray(number.values) ? number.values : [])
          .filter((v) => v && typeof v.motion === "string" && finiteNumber(v.value) !== undefined)
          .map((v) => ({ value: finiteNumber(v.value), motion: v.motion })),
      }
      : null,
    triggers: inputs
      .filter((i) => i.type === "trigger" && typeof i.motion === "string")
      .map((i) => ({ name: i.name, motion: i.motion })),
  };
}

/** A measured `{ scale, origin, from: "measured" }` off a rive report, or
 *  undefined — never a partial record. */
function measuredClip(value) {
  if (!value || typeof value !== "object" || value.from !== "measured") return undefined;
  const scale = finiteNumber(value.scale);
  if (!(scale > 0)) return undefined;
  const x = finiteNumber(value.origin?.x);
  const y = finiteNumber(value.origin?.y);
  return { scale, origin: x !== undefined && y !== undefined ? { x, y } : null, from: "measured" };
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
      allowPositionals: false,
      strict: true,
    });
  } catch (error) {
    fail(`${command}: ${error.message}`);
  }
  const values = parsed.values;
  if (values.help) {
    console.log(USAGE);
    process.exit(0);
  }

  const dir = resolve(values.dir ?? process.cwd());
  const now = values.at === undefined
    ? Date.now()
    : num(values.at, "--at", { integer: true, min: 0 });

  const loop = (fallback) => {
    if (values.loop && values["no-loop"]) fail("--loop and --no-loop are mutually exclusive");
    if (values.loop) return true;
    if (values["no-loop"]) return false;
    return fallback;
  };

  switch (command) {
    case "init": {
      const name = requireFlag(values.name, "--name");
      const path = projectPath(dir);
      if (existsSync(path) && !values.force) fail(`${path} already exists — pass --force to overwrite it`);
      // `init` is the first command of a character, so the character directory
      // is routinely still an idea. Creating it here is the whole reason this
      // subcommand can be the first thing an agent runs; every other
      // subcommand loads an existing project and so cannot reach a missing
      // directory.
      try {
        mkdirSync(dir, { recursive: true });
      } catch (error) {
        fail(`--dir: cannot create the character directory ${dir}: ${error.message}`);
      }
      const cell = values.cell ? parseCell(values.cell, "--cell") : { ...DEFAULT_CELL };
      const facing = oneOf(values.facing ?? "right", FACINGS, "--facing");
      const doc = {
        $schema: SCHEMA,
        title: name,
        composition: {
          settings: {
            width: cell.width,
            height: cell.height,
            fps: DEFAULT_FPS,
            aspectRatio: aspectRatio(cell.width, cell.height),
          },
          tracks: [],
          transitions: [],
        },
        assets: [],
        provenance: [],
        sprite: {
          version: 1,
          character: {
            name,
            description: values.description ?? "",
            style: values.style ?? "",
            cell,
            facing,
          },
          refs: [],
          motions: [],
        },
      };
      const notes = applyCharacterFlags(doc, doc.sprite.character, values);
      saveProject(dir, doc);
      const summary = summarize(doc, dir);
      emit(values, summary, [`created ${path} for ${name} (${cell.width}x${cell.height})`]);
      for (const note of notes) console.error(note);
      break;
    }

    case "set-character": {
      // The first writer of description / style / facing after init, and the
      // writer of the 0.5.0 route, pixel spec and asymmetry lock. Only the
      // flags given change; everything else is left as it is.
      const doc = loadProject(dir);
      const character = doc.sprite.character && typeof doc.sprite.character === "object"
        ? doc.sprite.character
        : fail("the 'sprite' sidecar has no character");
      if (values.description !== undefined) character.description = values.description;
      if (values.style !== undefined) character.style = values.style;
      if (values.facing !== undefined) character.facing = oneOf(values.facing, FACINGS, "--facing");
      const notes = applyCharacterFlags(doc, character, values);
      saveProject(dir, doc);
      emit(values, doc.sprite.character, [
        `${character.name}: ${[
          character.purpose ? `purpose ${character.purpose}` : null,
          character.facing ? `facing ${character.facing}` : null,
          character.pixel ? `pixel art, ${character.pixel.logicalHeight} px tall${character.pixel.colors ? `, ${character.pixel.colors} colours` : ""}${character.pixel.palette ? " (palette pinned)" : ""}` : null,
          character.asymmetric ? `asymmetric: ${character.asymmetric}` : null,
        ].filter(Boolean).join(" · ") || "updated"}`,
      ]);
      for (const note of notes) console.error(note);
      break;
    }

    case "add-ref": {
      const doc = loadProject(dir);
      const id = requireFlag(values.id, "--id");
      const role = oneOf(requireFlag(values.role, "--role"), REF_ROLES, "--role");
      const uri = toUri(dir, requireFlag(values.file, "--file"), "--file");
      const file = requireFile(dir, uri, "--file");
      const label = values.label ?? titleCase(id);
      const assetId = `ref-${id}`;
      // An anchor is one pose facing one way, and the character's direction
      // set is read off the anchors — so it needs its direction, holds it
      // alone, and no other role carries one.
      const direction = directionFlag(values);
      if (role === "anchor") {
        if (direction === undefined) fail(`--direction: an anchor faces one direction — pass --direction ${DIRECTIONS.join("|")}`);
        const taken = doc.sprite.refs.find((r) => r.id !== id && r.role === "anchor" && r.direction === direction);
        if (taken) fail(`--direction: '${taken.id}' is already the ${direction} anchor — there is one anchor per direction; re-register --id ${taken.id} to replace it`);
      } else if (direction !== undefined) {
        fail(`--direction: only an anchor faces one direction (--role anchor) — a ${role} is not one pose`);
      }
      // Every origin refusal lives in here, so building the edge first means a
      // rejected flag combination exits before the document is touched at all.
      const provenance = refEdge(doc, values, id, now);

      upsertAsset(doc, {
        id: assetId, type: "image", uri, name: label,
        metadata: imageMetadata(file, "--file"),
        createdAt: now, status: "ready", tags: ["ref"],
      }, `ref '${id}'`);
      setEdge(doc, provenance);

      const existing = doc.sprite.refs.findIndex((r) => r.id === id);
      const entry = { id, asset: assetId, role, label, ...(role === "anchor" ? { direction } : {}) };
      if (existing === -1) doc.sprite.refs.push(entry);
      else doc.sprite.refs[existing] = entry;

      saveProject(dir, doc);
      emit(values, summarize(doc, dir), [`registered ${assetId} → ${uri}`]);
      break;
    }

    case "add-motion": {
      const doc = loadProject(dir);
      const kind = values.kind === undefined
        ? undefined
        : oneOf(values.kind, MOTION_KINDS, "--kind");
      if (kind === "transition") {
        if (values.direction !== undefined) fail("--direction: a transition joins two loops and faces whatever they face — it takes no direction of its own");
        const motion = transitionMotion(doc, values);
        doc.sprite.motions.push(motion);
        saveProject(dir, doc);
        emit(values, motion, [`added transition ${motion.id} (${motion.from} → ${motion.to})`]);
        break;
      }
      if (values.from !== undefined || values.to !== undefined) {
        fail("--from / --to: only a --kind transition goes from one loop to another");
      }
      const direction = directionFlag(values);
      const id = requireFlag(values.id, "--id");
      if (doc.sprite.motions.some((m) => m.id === id)) {
        fail(`--id: motion '${id}' already exists — use set-motion to change it`);
      }
      // A loop has no grid — its frames are a sequence, not cells of a sheet —
      // so the two flags a sprite motion cannot do without become optional and
      // land on the 1x1 that `register-run` will confirm. A breathe has no
      // generated sheet either: its grid is the atlas `breathe --name` packs,
      // which register-run writes when the frames land. Everything else about
      // a sprite motion is untouched.
      const isLoop = kind === "loop";
      const gridFromRun = isLoop || values.source === "breathe";
      const gridSide = (flag, raw) => (gridFromRun
        ? num(raw, flag, { integer: true, min: 1, fallback: 1 })
        : num(requireFlag(raw, flag), flag, { integer: true, min: 1 }));
      const motion = {
        id,
        label: values.label ?? titleCase(id),
        ...(direction ? { direction } : {}),
        prompt: values.prompt ?? "",
        ...(kind ? { kind } : {}),
        grid: {
          rows: gridSide("--rows", values.rows),
          cols: gridSide("--cols", values.cols),
        },
        // A breathe is timed by its run as well (`breathe --fps`), and
        // register-run takes the rate from it; until then it reads as the
        // rate a breathe plays at by default.
        fps: values.source === "breathe"
          ? num(values.fps, "--fps", { min: 1, fallback: BREATHE_FPS })
          : num(requireFlag(values.fps, "--fps"), "--fps", { min: 1 }),
        // A loop that plays once is a contradiction in terms, so that is the
        // default here — --no-loop can still say otherwise.
        loop: loop(isLoop),
        anchor: oneOf(values.anchor ?? "bottom", ANCHORS, "--anchor"),
        status: oneOf(values.status ?? "planned", MOTION_STATUSES, "--status"),
        // Absent is the honest default: it means "sheet", and every motion
        // made before the video source existed says nothing at all. A loop is
        // the exception — its frames can only come from a clip.
        ...(values.source === undefined
          ? (isLoop ? { source: "video" } : {})
          : { source: oneOf(values.source, MOTION_SOURCES, "--source") }),
        frames: [],
        videos: [],
      };
      doc.sprite.motions.push(motion);
      saveProject(dir, doc);
      emit(values, motion, [`added motion ${id} (${motion.grid.rows}x${motion.grid.cols} @ ${motion.fps}fps)`]);
      break;
    }

    case "set-motion": {
      const doc = loadProject(dir);
      const motion = findMotion(doc, requireFlag(values.motion, "--motion"));
      if (values.label !== undefined) motion.label = values.label;
      if (values.fps !== undefined) motion.fps = num(values.fps, "--fps", { min: 1 });
      motion.loop = loop(motion.loop);
      if (values.anchor !== undefined) motion.anchor = oneOf(values.anchor, ANCHORS, "--anchor");
      // A prompt and the parts that built it travel together: parts with the
      // prompt they built (what `sheet-prompt` records), or a prompt alone —
      // written by hand, so any parts on file no longer describe it.
      if (values["prompt-parts"] !== undefined) {
        recordPromptParts(motion, values["prompt-parts"], values.prompt);
      } else if (values.prompt !== undefined) {
        motion.prompt = values.prompt;
        delete motion.promptParts;
      }
      if (values.status !== undefined) motion.status = oneOf(values.status, MOTION_STATUSES, "--status");
      if (values.notes !== undefined) motion.notes = values.notes;
      const directionNotes = [];
      const direction = directionFlag(values);
      if (direction !== undefined) {
        // A mirror faces the other side from its source, by construction.
        const source = motion.source === "mirror" ? doc.sprite.motions.find((m) => m.id === motion.mirrorOf) : null;
        if (source && MIRRORED[source.direction] && MIRRORED[source.direction] !== direction) {
          fail(`--direction: '${motion.id}' is a mirror of ${source.id}, which faces ${source.direction} — it faces ${MIRRORED[source.direction]}`);
        }
        if (motion.direction !== direction) {
          for (const mirror of doc.sprite.motions.filter((m) => m.source === "mirror" && m.mirrorOf === motion.id)) {
            directionNotes.push(`note: ${mirror.id} mirrors ${motion.id} and faces ${mirror.direction ?? "no direction"} — check it still faces the other side`);
          }
        }
        motion.direction = direction;
      }

      // Acknowledging warnings is a statement about a measurement, so it can
      // only be made when there is one, and it has to carry the sentence the
      // user reads next to the dimmed badge — an empty reason would dim the
      // warning and explain nothing.
      if (values["ack-warnings"] !== undefined && values["clear-ack"]) {
        fail("--ack-warnings and --clear-ack are mutually exclusive");
      }
      if (values["ack-warnings"] !== undefined) {
        const reason = String(values["ack-warnings"]).trim();
        if (!reason) fail("--ack-warnings: a reason is required — the user reads it on the stage");
        if (!motion.inspect) {
          fail(`--ack-warnings: motion '${motion.id}' has no inspect report to acknowledge — run register-run first`);
        }
        motion.inspect = { ...motion.inspect, acknowledged: { reason, at: now } };
      }
      if (values["clear-ack"] && motion.inspect) delete motion.inspect.acknowledged;

      // The interview's answers. They are the one thing on a motion that is
      // not the agent's to decide — a loop's size, its length and who invents
      // its in-betweens are the user's money — and `add-video` refuses the
      // paid clip until they are here.
      const briefLines = setLoopBrief(motion, values, now);

      saveProject(dir, doc);
      emit(values, motion, [`${motion.id}: ${motion.status}, ${motion.fps}fps, loop=${motion.loop}`]);
      // After the write, and on stderr: every caller of this command passes
      // --json, so a line routed through `emit` would be swallowed by it.
      for (const line of [...briefLines, ...directionNotes]) console.error(line);
      break;
    }

    case "sheet-prompt": {
      const doc = loadProject(dir);
      const motion = findMotion(doc, requireFlag(values.motion, "--motion"));
      if (motion.kind === "loop" || motion.kind === "transition") {
        fail(`sheet-prompt: '${motion.id}' is a ${motion.kind} — its frames come from a clip, and there is no grid to draw`);
      }
      if (motion.source === "breathe" || motion.source === "mirror") {
        fail(`sheet-prompt: '${motion.id}' is a ${motion.source} motion — its frames are made from ${motion.source === "mirror" ? "another motion's frames" : "one still"}, not drawn from a prompt`);
      }
      const action = requireFlag(values.action, "--action");
      if (values.guide && values["no-guide"]) fail("--guide and --no-guide are mutually exclusive");
      const guide = values.guide ? true : values["no-guide"] ? false : GUIDE_DEFAULT;
      const state = values.state === undefined ? undefined : oneOf(values.state, [...SHEET_STATES, "generic"], "--state");
      let grid = motion.grid;
      if (values.frames !== undefined) {
        const frames = num(values.frames, "--frames", { integer: true, min: 1 });
        try {
          grid = sheetGrid(frames);
        } catch (error) {
          fail(error.message);
        }
      }
      let built;
      try {
        built = buildSheetPrompt({
          character: doc.sprite.character, motion: { ...motion, grid }, refs: doc.sprite.refs, action, state, guide,
        });
      } catch (error) {
        fail(`sheet-prompt: ${error.message}`);
      }
      const frameCount = grid.rows * grid.cols;
      const notes = [];
      // The grid the prompt draws is the grid `run --rows --cols` slices, so
      // the two change together.
      if (grid.rows !== motion.grid.rows || grid.cols !== motion.grid.cols) {
        if (motion.frames?.length) {
          notes.push(`note: ${motion.id} is now ${grid.cols} columns × ${grid.rows} rows; its ${motion.frames.length} registered frames are from the old ${motion.grid.cols} × ${motion.grid.rows} sheet until the next run`);
        }
        motion.grid = { rows: grid.rows, cols: grid.cols };
      }
      const recommended = RECOMMENDED_FRAMES[built.state];
      if (recommended && recommended !== frameCount) {
        notes.push(`note: ${built.state} reads best at ${recommended} frames (${sheetGrid(recommended).cols} columns × ${sheetGrid(recommended).rows} rows), measured — this sheet has ${frameCount}; --frames ${recommended} redraws it (references/prompting.md)`);
      }
      if (!doc.sprite.character.description?.trim()) {
        notes.push("note: the character has no description — the references carry the identity alone (set-character --description)");
      }
      if (motion.source === "video") {
        notes.push(`note: ${motion.id} was declared --source video; register-run records sheet when this sheet's frames land`);
      }
      recordPromptParts(motion, built.parts, built.prompt);
      saveProject(dir, doc);

      // Workspace-relative, the way the image call wants its paths: the
      // --dir as given, then the uri.
      const onDisk = (uri) => (values.dir === undefined ? uri : join(values.dir, uri));
      const guideOut = onDisk(`motions/${motion.id}/layout-guide.png`);
      const attach = [
        ...built.attach.map((refId) => {
          const ref = doc.sprite.refs.find((r) => r.id === refId);
          return onDisk(doc.assets.find((a) => a.id === ref.asset)?.uri ?? `refs/${refId}.png`);
        }),
        ...(guide ? [guideOut] : []),
      ];
      const { geometry } = built;
      const cell = `${geometry.cell.width}x${geometry.cell.height}`;
      const payload = {
        motion: motion.id,
        state: built.state,
        frames: frameCount,
        grid: motion.grid,
        imageSize: geometry.imageSize,
        cell: geometry.cell,
        safeMargin: geometry.safeMargin,
        prompt: built.prompt,
        promptParts: motion.promptParts,
        attach,
        guide: guide ? { out: guideOut, rows: geometry.rows, cols: geometry.cols, cell } : null,
        notes,
      };
      emit(values, payload, [built.prompt]);
      if (!values.json) {
        console.error(`recorded ${built.parts.builder} on ${motion.id}: ${frameCount} frames as ${geometry.cols} columns × ${geometry.rows} rows, state ${built.state}; guards ${built.parts.guards.join(", ")}`);
        console.error(`image: --image-size ${geometry.imageSize}; attach in this order: ${attach.join(", ") || "(no references registered)"}`);
        if (guide) console.error(`guide: sprite-sheet.mjs guide --rows ${geometry.rows} --cols ${geometry.cols} --cell ${cell} --out ${guideOut}`);
        for (const note of notes) console.error(note);
      }
      break;
    }

    case "set-sheet": {
      const doc = loadProject(dir);
      const motion = findMotion(doc, requireFlag(values.motion, "--motion"));
      const uri = toUri(dir, requireFlag(values.file, "--file"), "--file");
      const status = oneOf(values.status ?? "processing", MOTION_STATUSES, "--status");
      const inputs = parseInputs(doc, values.from, "--from");
      const assetId = `${motion.id}-sheet-raw`;

      // `--status generating` is the placeholder leg: it is called BEFORE the
      // image model runs, so the stage can show "generating" instead of
      // nothing, and the file it names does not exist yet by definition.
      // Every other status claims the sheet is on disk, so a missing file
      // stays the hard error it always was.
      const placeholder = status === "generating";
      const file = placeholder ? null : requireFile(dir, uri, "--file");

      upsertAsset(doc, {
        id: assetId, type: "image", uri, name: `${motion.id} sheet (raw)`,
        metadata: placeholder ? {} : imageMetadata(file, "--file"),
        createdAt: now, status: placeholder ? "generating" : "ready",
      }, `motion '${motion.id}'`);
      setEdge(doc, edge(assetId, inputs, operation("generate", now, {
        model: values.model, prompt: values.prompt, background: values.background,
      }, inputs)));

      motion.sheetRaw = assetId;
      motion.status = status;
      saveProject(dir, doc);
      emit(values, motion, [placeholder
        ? `${motion.id}: reserved ${assetId} for ${uri} (generating — measured once the file lands)`
        : `${motion.id}: sheet ${uri} registered as ${assetId} (${motion.status})`]);
      break;
    }

    case "set-keyframe": {
      const doc = loadProject(dir);
      const motion = findMotion(doc, requireFlag(values.motion, "--motion"));
      // A keyframe is the image a loop clip starts AND ends on; a sprite
      // motion has no such thing, and letting the id through would put an
      // asset nothing renders into the file.
      if (motion.kind !== "loop") {
        fail(`--motion: '${motion.id}' is not a loop motion — a keyframe is the image a loop clip starts and ends on. Use set-sheet for a sprite motion, or add-motion --kind loop for a new loop.`);
      }
      const uri = toUri(dir, requireFlag(values.file, "--file"), "--file");
      const status = oneOf(values.status ?? "processing", MOTION_STATUSES, "--status");
      const inputs = parseInputs(doc, values.from, "--from");
      const owner = `motion '${motion.id}'`;
      const assetId = `${motion.id}-keyframe`;

      // The same placeholder leg set-sheet has: called BEFORE the image model
      // runs so the stage can show the motion as generating, and the file it
      // names does not exist yet by definition.
      const placeholder = status === "generating";
      const file = placeholder ? null : requireFile(dir, uri, "--file");

      const alphaAssetId = `${motion.id}-keyframe-alpha`;
      // The cut-out is reserved by the same placeholder leg as the keyframe,
      // and only a later `--alpha` measures it. A closing call that leaves it
      // reserved leaves the STAGE pointing at it — `resolveFrameSource`
      // prefers `keyframeAlpha` over `keyframe` — so the loop would show a
      // broken image until the run lands. Say which flag fixes it instead.
      if (values.alpha === undefined) {
        const reserved = doc.assets.find((a) => a.id === alphaAssetId);
        if (reserved?.status === "generating") {
          fail(`reserved ${alphaAssetId} is still a placeholder — pass --alpha <path> so it can be measured (the stage shows it instead of the keyframe)`);
        }
      }

      upsertAsset(doc, {
        id: assetId, type: "image", uri, name: `${motion.id} keyframe`,
        metadata: placeholder ? {} : imageMetadata(file, "--file"),
        createdAt: now, status: placeholder ? "generating" : "ready",
      }, owner);
      setEdge(doc, keptGenerateEdge(doc, assetId, values, inputs, now));
      motion.keyframe = assetId;

      let alphaId;
      if (values.alpha !== undefined) {
        alphaId = alphaAssetId;
        const alphaUri = toUri(dir, values.alpha, "--alpha");
        const alphaFile = placeholder ? null : requireFile(dir, alphaUri, "--alpha");
        upsertAsset(doc, {
          id: alphaId, type: "image", uri: alphaUri, name: `${motion.id} keyframe (alpha)`,
          metadata: placeholder ? {} : imageMetadata(alphaFile, "--alpha"),
          createdAt: now, status: placeholder ? "generating" : "ready",
        }, owner);
        // Cut out of the keyframe, by whatever removed its background — the
        // step is named, the tool is not, because this script did not run it.
        setEdge(doc, edge(alphaId, [assetId], operation("derive", now, { step: "key" })));
        motion.keyframeAlpha = alphaId;
      }

      motion.status = status;
      saveProject(dir, doc);
      emit(values, motion, [placeholder
        ? `${motion.id}: reserved ${assetId} for ${uri} (generating — measured once the file lands)`
        : `${motion.id}: keyframe ${uri} registered as ${assetId}${alphaId ? ` (+ ${alphaId})` : ""} (${motion.status})`]);
      break;
    }

    case "register-run": {
      const doc = loadProject(dir);
      const motion = findMotion(doc, requireFlag(values.motion, "--motion"));
      const run = readRunSummary(requireFlag(values.run, "--run"));
      const owner = `motion '${motion.id}'`;
      // A transition's cut goes onto a transition, and only there: its frames
      // are the clip between two loops, and the ends it claims are checked.
      const transitionRun = run.kind === "transition";
      let reverseSource = null;
      if (transitionRun || motion.kind === "transition") {
        if (!transitionRun) fail(`--motion: '${motion.id}' is a transition — register the output of 'sprite-sheet.mjs transition' on it`);
        if (motion.kind !== "transition") fail(`--motion: '${motion.id}' is not a transition — add one with add-motion --kind transition --from <loop> --to <loop>`);
        if (run.from !== motion.from || run.to !== motion.to) {
          fail(`--run: this cut goes from ${run.from} to ${run.to}, but ${motion.id} goes from ${motion.from} to ${motion.to}`);
        }
        if (run.source === "reverse") {
          reverseSource = doc.sprite.motions.find((m) => m.id === run.reverseOf);
          if (!reverseSource || reverseSource.kind !== "transition") {
            fail(`--run: reverseOf '${run.reverseOf}' is not a transition of this character`);
          }
          if (reverseSource.from !== motion.to || reverseSource.to !== motion.from) {
            fail(`--run: reverseOf ${reverseSource.id} goes from ${reverseSource.from} to ${reverseSource.to} — played backwards it is not ${motion.from} → ${motion.to}`);
          }
          if ((reverseSource.frames ?? []).length !== run.frames.length) {
            fail(`--run: reverseOf ${reverseSource.id} has ${(reverseSource.frames ?? []).length} registered frames and this cut ${run.frames.length} — cut it again with --reverse-of ${reverseSource.id}`);
          }
        }
      }
      // A breathe is warped out of one still and a mirror is another motion
      // flipped: both are sprite runs, and each names what it was made from,
      // which must already be in this character — the way a from-video run
      // needs its clip registered first.
      const breatheRun = run.source === "breathe";
      const mirrorRun = run.source === "mirror";
      if ((breatheRun || mirrorRun) && run.kind !== undefined) {
        fail(`--run: a ${run.source} summary is a sprite run — it has no kind '${run.kind}'`);
      }
      let stillId = null;
      if (breatheRun) {
        if (typeof run.still !== "string" || !run.still) {
          fail("--run: a breathe summary names no 'still' — is this 'sprite-sheet.mjs breathe --json' output?");
        }
        const stillUri = toUri(dir, run.still, "--run still");
        // A reference's asset first: one file can be registered twice (a ref
        // over a frame's own file), and the ref is the one that is a still.
        const refAssets = new Set(doc.sprite.refs.map((r) => r.asset));
        const named = doc.assets.filter((a) => a.uri === stillUri);
        const still = named.find((a) => refAssets.has(a.id)) ?? named[0];
        if (!still) {
          fail(`--run: the still ${stillUri} is not registered — register it first: add-ref --dir <character> --id <id> --file ${stillUri} --role custom --uploaded (a cut-out of a registered ref: --derived-from <ref> --op key)`);
        }
        // Only a reference is a still. A motion's frame is replaced or removed
        // with its motion (a re-run, remove-motion), which would leave
        // `breathe.still` naming an asset that is gone, and a preview GIF or a
        // sheet is not one picture of the character at all. A frame worth
        // breathing becomes a reference first — its own file under refs/,
        // derived from the frame, which then outlives the motion.
        if (!refAssets.has(still.id)) {
          const frameOf = doc.sprite.motions.find((m) => (m.frames ?? []).includes(still.id));
          fail(frameOf
            ? `--run: the still ${stillUri} is ${still.id}, a frame of ${frameOf.id} — a still must be a reference, which outlives the motion: copy the frame under refs/ and register it with add-ref --dir <character> --id <id> --file refs/<name>.png --role custom --derived-from ${still.id}, then breathe that file`
            : `--run: the still ${stillUri} is ${still.id}, which is not a reference — breathe a reference (add-ref) or a frame registered as one (add-ref --derived-from <frame id>)`);
        }
        stillId = still.id;
      }
      const breathe = breatheRun ? breatheRecord(run.breathe, stillId) : null;
      const mirror = mirrorRun ? mirrorSource(doc, motion, run) : null;

      const cell = run.cell && Number.isFinite(Number(run.cell.width)) && Number.isFinite(Number(run.cell.height))
        ? { width: Number(run.cell.width), height: Number(run.cell.height) }
        : null;

      // Ids this run is about to write. They are NOT dropped first: dropping
      // an id rewrites every surviving edge that pointed at it to null, which
      // used to cut each video loose from the frame it was generated from on
      // the second register-run. Only the previous run's leftovers — the tail
      // of a longer motion — are really removed, and `upsertAsset` replaces
      // the rest in place so a re-run is a no-op diff.
      // A loop run brings a different set of deliverables — no sheet, no
      // atlas, no GIF, three extra exports — and three-digit frame ids.
      const loopRun = run.kind === "loop" || transitionRun;
      const digits = loopRun ? 3 : 2;
      const rebuilt = new Set([
        ...run.frames.map((_, index) => frameAssetId(motion.id, index, digits)),
        ...(run.sheet ? [`${motion.id}-sheet`] : []),
        ...(run.atlas ? [`${motion.id}-atlas`] : []),
        ...(run.gif ? [`${motion.id}-gif`] : []),
        ...(run.sheetAlpha ? [`${motion.id}-sheet-alpha`] : []),
        ...LOOP_EXPORTS.filter((spec) => run[spec.key]).map((spec) => `${motion.id}-${spec.suffix}`),
      ]);
      const leftover = runOwnedIds(doc, motion.id).filter((id) => !rebuilt.has(id));
      // The exports cut from the frames this run replaces — the motion's own
      // and the character's .riv when it holds this motion — go with them.
      // Said on stderr, because the file stays on disk and the user may have
      // shipped it already.
      const staleWhole = characterExportsHolding(doc, motion.id);
      const onDemand = new Set(Object.keys(EXPORT_SPECS).map((format) => exportAssetId(motion.id, format)));
      const retiredExports = doc.assets
        .filter((a) => (onDemand.has(a.id) && leftover.includes(a.id)) || staleWhole.includes(a.id))
        .map((a) => ({ id: a.id, uri: a.uri }));
      dropAssets(doc, [...leftover, ...staleWhole]);
      retireCharacterExports(doc, staleWhole);

      const sheetRawId = motion.sheetRaw && doc.assets.some((a) => a.id === motion.sheetRaw) ? motion.sheetRaw : null;

      // A `from-video` run has no sheet anywhere in its history: the frames
      // were cut out of a clip, and that clip is an asset of its own. The
      // parent has to be the clip or the provenance graph tells a story that
      // never happened — and it is not derivable from the run summary, which
      // knows a path and not an asset id.
      const fromVideo = run.source === "video";
      let videoAssetId = null;
      if (fromVideo) {
        const videos = motion.videos ?? [];
        if (!videos.length) {
          fail(`--run says these frames were sampled from a video, but motion '${motion.id}' has no video asset. Register the clip first: add-video --dir <character> --motion ${motion.id} --file ${run.video ? toUri(dir, run.video, "--run video") : `motions/${motion.id}/video-<model>-1.mp4`} --model <model> --mode <mode> (it becomes ${motion.id}-video-1).`);
        }
        if (values.video !== undefined) {
          const chosen = videos.find((v) => v.id === values.video || v.asset === values.video);
          if (!chosen) {
            fail(`--video: no video '${values.video}' on motion '${motion.id}' (known: ${videos.map((v) => v.id).join(", ")})`);
          }
          videoAssetId = chosen.asset;
        } else {
          const newest = videos[videos.length - 1];
          videoAssetId = newest.asset;
          console.error(`note: no --video given — hanging the frames off '${newest.id}' (${videoAssetId}), the newest clip on this motion`);
        }
        // Naming the wrong clip is silent corruption: the frames would claim
        // to come from a take they were never sampled from.
        if (run.video) {
          const sampledFrom = toUri(dir, run.video, "--run video");
          const asset = doc.assets.find((a) => a.id === videoAssetId);
          if (asset && asset.uri !== sampledFrom) {
            fail(`--run was sampled from ${sampledFrom} but ${videoAssetId} is ${asset.uri} — pass --video <id> for the clip these frames came from`);
          }
        }
      }

      let sheetAlphaId;
      if (run.sheetAlpha) {
        sheetAlphaId = `${motion.id}-sheet-alpha`;
        const uri = toUri(dir, run.sheetAlpha, "--run sheetAlpha");
        upsertAsset(doc, {
          id: sheetAlphaId, type: "image", uri, name: `${motion.id} sheet (alpha)`,
          metadata: imageMetadata(requireFile(dir, uri, "--run sheetAlpha"), "--run sheetAlpha"),
          createdAt: now, status: "ready",
        }, owner);
        setEdge(doc, edge(sheetAlphaId, sheetRawId ? [sheetRawId] : [], operation("derive", now, {
          tool: TOOL, step: "key", color: run.keyColor,
        })));
      }

      const sourceId = sheetAlphaId ?? sheetRawId;
      const frameIds = run.frames.map((path, index) => {
        const id = frameAssetId(motion.id, index, digits);
        const uri = toUri(dir, path, "--run frames");
        upsertAsset(doc, {
          id, type: "image", uri, name: `${motion.id} frame ${String(index).padStart(digits, "0")}`,
          metadata: imageMetadata(requireFile(dir, uri, "--run frames"), "--run frames"),
          createdAt: now, status: "ready",
        }, owner);
        const sampledAt = Array.isArray(run.sampledAt) ? run.sampledAt[index] : undefined;
        if (reverseSource) {
          // A reverse is the source transition's frames played backwards:
          // frame i IS source frame n − 1 − i, and says so.
          const sourceFrame = reverseSource.frames.length - 1 - index;
          setEdge(doc, edge(id, [reverseSource.frames[sourceFrame]], operation("derive", now, {
            tool: TOOL, step: "reverse", frameIndex: index, sourceFrame,
          })));
          return id;
        }
        if (breathe) {
          // Every frame is a warp of the one still: single parent, the
          // parameters that made it.
          setEdge(doc, edge(id, [stillId], operation("derive", now, {
            tool: TOOL, step: "breathe", frameIndex: index,
            depth: breathe.depth, depthX: breathe.depthX, breaths: breathe.breaths, lag: breathe.lag, mode: breathe.mode,
          })));
          return id;
        }
        if (mirror) {
          // Frame i IS the source's frame i, flipped.
          setEdge(doc, edge(id, [mirror.source.frames[index]], operation("derive", now, {
            tool: TOOL, step: "mirror", frameIndex: index,
          })));
          return id;
        }
        const parents = fromVideo ? [videoAssetId] : (sourceId ? [sourceId] : []);
        setEdge(doc, edge(id, parents, operation("derive", now, fromVideo
          ? { tool: TOOL, step: "from-video", frameIndex: index, t: Number.isFinite(sampledAt) ? sampledAt : undefined }
          : { tool: TOOL, step: "run", cell: index })));
        return id;
      });
      // A pixel run's palette, pinned on the character once.
      const paletteWarnings = pinPalette(doc, dir, motion, run, frameIds, values.repin, now);

      // The packed trio. A loop run carries none of them (readRunSummary does
      // not ask it to), and a slot whose asset this run did not rebuild has
      // just been dropped — so the sidecar must stop naming it rather than
      // point at an id that is no longer in the file.
      let sheetId;
      if (run.sheet) {
        sheetId = `${motion.id}-sheet`;
        const sheetUri = toUri(dir, run.sheet, "--run sheet");
        upsertAsset(doc, {
          id: sheetId, type: "image", uri: sheetUri, name: `${motion.id} atlas image`,
          metadata: imageMetadata(requireFile(dir, sheetUri, "--run sheet"), "--run sheet"),
          createdAt: now, status: "ready",
        }, owner);
        setEdge(doc, edge(sheetId, frameIds, operation("derive", now, { tool: TOOL, step: "pack" }, frameIds)));
      }

      let atlasId;
      if (run.atlas) {
        atlasId = `${motion.id}-atlas`;
        const atlasUri = toUri(dir, run.atlas, "--run atlas");
        requireFile(dir, atlasUri, "--run atlas");
        upsertAsset(doc, {
          id: atlasId, type: "text", uri: atlasUri, name: `${motion.id} atlas`,
          metadata: {}, createdAt: now, status: "ready",
        }, owner);
        setEdge(doc, edge(atlasId, sheetId ? [sheetId] : [], operation("derive", now, { tool: TOOL, step: "pack" })));
      }

      let gifId;
      if (run.gif) {
        gifId = `${motion.id}-gif`;
        const gifUri = toUri(dir, run.gif, "--run gif");
        upsertAsset(doc, {
          id: gifId, type: "image", uri: gifUri,
          name: `${motion.id} preview`,
          metadata: { ...imageMetadata(requireFile(dir, gifUri, "--run gif"), "--run gif", cell), ...(run.fps ? { fps: run.fps } : {}) },
          createdAt: now, status: "ready",
        }, owner);
        setEdge(doc, edge(gifId, frameIds, operation("derive", now, { tool: TOOL, step: "gif" }, frameIds)));
      }

      let webpId;
      if (run.webp && !loopRun) {
        webpId = `${motion.id}-webp`;
        const webpUri = toUri(dir, run.webp, "--run webp");
        upsertAsset(doc, {
          id: webpId, type: "image", uri: webpUri, name: `${motion.id} preview (webp)`,
          metadata: { ...imageMetadata(requireFile(dir, webpUri, "--run webp"), "--run webp", cell), ...(run.fps ? { fps: run.fps } : {}) },
          createdAt: now, status: "ready",
        }, owner);
        setEdge(doc, edge(webpId, frameIds, operation("derive", now, { tool: TOOL, step: "gif" }, frameIds)));
      }

      // A loop's four exports. They are what the workflow is FOR — the files a
      // UI actually embeds — so each one is registered with its size in bytes
      // and hangs off the frame sequence it was encoded from. An encoder the
      // machine did not have leaves its key off the summary (`loop` warns);
      // the export is simply not there, which is what the panel renders.
      const exportIds = {};
      if (loopRun) {
        for (const spec of LOOP_EXPORTS) {
          const path = run[spec.key];
          if (!path) continue;
          const label = `--run ${spec.key}`;
          const exportUri = toUri(dir, path, label);
          const exportFile = requireFile(dir, exportUri, label);
          const id = `${motion.id}-${spec.suffix}`;
          // `videoMetadata` is best-effort and says so in `warning` — without
          // ffprobe the WebM is registered with no dimensions at all, and
          // ffprobe writes nothing to stderr of its own. Dropping that
          // warning made the empty metadata silent. It goes to STDERR, where
          // `imageMetadata`'s own fallback warning already goes two lines
          // above: every caller of this command passes `--json`, and a line
          // routed through `emit` would be swallowed by exactly that flag.
          let measured;
          if (spec.probe === "image") {
            measured = imageMetadata(exportFile, label, cell);
          } else if (spec.probe === "video") {
            const probed = videoMetadata(exportFile);
            if (probed.warning) console.error(`WARN: ${probed.warning}`);
            measured = probed.metadata;
          } else {
            measured = {};
          }
          upsertAsset(doc, {
            id, type: spec.type, uri: exportUri, name: `${motion.id} ${spec.label}`,
            metadata: {
              ...measured,
              ...(run.fps ? { fps: run.fps } : {}),
              ...(fileSize(exportFile) === undefined ? {} : { size: fileSize(exportFile) }),
            },
            createdAt: now, status: "ready",
          }, owner);
          setEdge(doc, edge(id, frameIds, operation("derive", now, { tool: TOOL, step: "loop" }, frameIds)));
          exportIds[spec.key] = id;
        }
        webpId = exportIds.webp;
      }

      if (sheetAlphaId) motion.sheetAlpha = sheetAlphaId; else delete motion.sheetAlpha;
      motion.frames = frameIds;
      if (sheetId) motion.sheet = sheetId; else delete motion.sheet;
      if (atlasId) motion.atlas = atlasId; else delete motion.atlas;
      if (gifId) motion.gif = gifId; else delete motion.gif;
      if (webpId) motion.webp = webpId; else delete motion.webp;

      // What this motion IS, corrected from the run the same way `source` is:
      // the files on disk are the answer, not what somebody declared before
      // anything was generated.
      if (transitionRun) {
        // A transition keeps what it is; the cut brings its rate. It ships no
        // files of its own — an export is asked for, like a sprite motion's.
        motion.grid = { rows: 1, cols: 1 };
        const fps = Number(run.fps);
        if (Number.isFinite(fps) && fps > 0) motion.fps = fps;
        motion.loop = false;
        delete motion.exports;
        if (reverseSource) motion.reverseOf = reverseSource.id;
        else delete motion.reverseOf;
      } else if (loopRun) {
        motion.kind = "loop";
        // A loop has no grid, and interpolation changes the frame rate — the
        // run knows both, and the rail and the stage read them from here.
        motion.grid = { rows: 1, cols: 1 };
        const fps = Number(run.fps);
        if (Number.isFinite(fps) && fps > 0) motion.fps = fps;
        const exports = {
          ...(exportIds.apng ? { apng: exportIds.apng } : {}),
          ...(exportIds.webm ? { webm: exportIds.webm } : {}),
          ...(exportIds.lottie ? { lottie: exportIds.lottie } : {}),
        };
        if (Object.keys(exports).length) motion.exports = exports;
        else delete motion.exports;
      } else {
        // A sheet run over a motion someone declared a loop produced a sprite
        // atlas; the sidecar has to say so. Either way every export this
        // motion had was cut from the frames just replaced, and was retired
        // above with its asset.
        if (motion.kind === "loop") delete motion.kind;
        delete motion.exports;
        // A breathe was drawn on no grid and at no declared rate: the atlas it
        // packed IS its grid, and the rate its breath was timed at is the one
        // its GIF and atlas durations carry. A re-run with more frames or
        // another --fps must not leave the stage reading the old layout.
        if (breathe) {
          const rows = Number(run.grid?.rows);
          const cols = Number(run.grid?.cols);
          if (Number.isInteger(rows) && rows >= 1 && Number.isInteger(cols) && cols >= 1) motion.grid = { rows, cols };
          const fps = Number(run.fps);
          if (Number.isFinite(fps) && fps > 0) motion.fps = fps;
          motion.loop = true;
        }
      }
      // The sidecar says how these frames were obtained, and it is corrected
      // in both directions: a sheet run over a motion someone declared `video`
      // is still a sheet's frames. `sheet` stays unwritten when nothing ever
      // claimed otherwise, because absent already means sheet.
      if (fromVideo || transitionRun) motion.source = "video";
      else if (breatheRun) motion.source = "breathe";
      else if (mirrorRun) motion.source = "mirror";
      else if (motion.source !== undefined && motion.source !== "sheet") motion.source = "sheet";
      // Each source's record goes with the frames it describes: a run of any
      // other shape drops it, as it drops a loop's clip record.
      if (breathe) motion.breathe = breathe;
      else delete motion.breathe;
      if (mirror) {
        motion.mirrorOf = mirror.source.id;
        motion.direction = mirror.facing;
      } else {
        delete motion.mirrorOf;
      }
      // A prompt `sheet-prompt` built is the sheet this motion was going to be
      // drawn from. A breathe or a mirror is drawn from no prompt, so the
      // code-built text goes with the parts that built it — the agent's
      // context would otherwise carry a sheet prompt for frames no sheet
      // made. A prompt written by hand (no parts) stays: it is the agent's
      // words, not a record of how the frames were made.
      if ((breatheRun || mirrorRun) && motion.promptParts) {
        delete motion.promptParts;
        motion.prompt = "";
      }
      // A fresh measurement is not the one that was acknowledged, so the
      // acknowledgement goes with the numbers it covered.
      const summary = inspectSummary(run.inspect);
      if (summary) motion.inspect = summary;
      // A measured clip scale and place were measurements of the frames this
      // run replaces; the new run records its own (or the next export
      // measures again).
      delete motion.clip;
      // The colourways were baked from the frames this run replaced: their
      // files went with the leftovers above, and the record goes with them.
      const rebake = Object.keys(motion.variants ?? {});
      delete motion.variants;
      motion.status = "ready";

      // What the user asked for against what landed. The frames are already
      // cut by the time anyone can measure this, so it is a warning and not a
      // refusal — but it is the difference between a 512px loop for a hero
      // and the 532px one the Kiki trial shipped with a 45 MB Lottie, and
      // nothing else in the chain compares the two numbers. Two pixels of
      // slack, because the crop rect is rounded to even sides.
      const warnings = [...paletteWarnings];
      const briefWidth = loopRun ? readBrief(motion).brief?.width : undefined;
      const cutWidth = finiteNumber(motion.inspect?.cell?.width);
      if (briefWidth !== undefined && cutWidth !== undefined && Math.abs(cutWidth - briefWidth) > 2) {
        warnings.push(`frames are ${cutWidth} px wide but the brief said ${briefWidth} — pass --width to loop`);
      }

      saveProject(dir, doc);
      // The motion, plus what this registration noticed. `warnings` is only
      // there when there is something to say: the payload is the motion, and
      // an always-present empty array would read as a field of it.
      //
      // Once per channel. This comparison goes to stderr for a human and to
      // the payload's own `warnings` for `--json`; it is deliberately NOT
      // copied into the stdout lines, nor into `motion.inspect.warnings` —
      // that list is the MEASUREMENT of the frames, which is what the viewer
      // shows and what `set-motion --ack-warnings` accepts, and this is a
      // comparison against the brief instead.
      emit(values, warnings.length ? { ...motion, warnings } : motion, [
        loopRun
          ? `${motion.id}: ${frameIds.length} loop frames cut from ${videoAssetId} @ ${motion.fps}fps, ${Object.keys(exportIds).join(" + ") || "no exports"} registered (ready)`
          : `${motion.id}: ${frameIds.length} frames${fromVideo ? ` sampled from ${videoAssetId}` : breathe ? ` warped from ${stillId}` : mirror ? ` flipped from ${mirror.source.id}` : ""}, atlas + preview registered (ready)`,
        ...(motion.inspect?.warnings ?? []),
      ]);
      for (const warning of warnings) console.error(`WARN: ${warning}`);
      for (const retired of retiredExports) {
        console.error(`note: retired ${retired.id} — it was cut from the frames this run replaced; re-export it (the file stays on disk: ${retired.uri})`);
      }
      // A reverse is a copy of these frames played backwards: it now plays
      // the old cut. Said, not undone — its frames are still a transition.
      for (const reverse of doc.sprite.motions.filter((m) => m.reverseOf === motion.id)) {
        console.error(`note: ${reverse.id} plays the frames this run replaced backwards — cut it again with 'sprite-sheet.mjs transition --reverse-of ${motion.id}' and register it`);
      }
      if (rebake.length) {
        console.error(`note: retired ${motion.id}'s ${listOf(rebake)} colourway files — they were baked from the frames this run replaced; bake them again with the recorded colourways: sprite-sheet.mjs recolor <character>/motions/${motion.id} --json | sprite-project.mjs register-recolor --dir <character> --report -`);
      }
      // The same for a mirror: its frames are the old ones flipped. Said, not
      // undone — `show` lists it as stale until it is mirrored again.
      for (const flipped of doc.sprite.motions.filter((m) => m.source === "mirror" && m.mirrorOf === motion.id)) {
        // Its colourways were baked from its own (old) frames and stay until
        // those are replaced: registering the new mirror retires them.
        const colourways = Object.keys(flipped.variants ?? {});
        console.error(`note: ${flipped.id} mirrors the frames this run replaced — mirror it again from motions/${motion.id} ('sprite-sheet.mjs mirror') and register it${colourways.length ? `, then recolor it (its ${listOf(colourways)} colourway files go with its old frames)` : ""}`);
      }
      break;
    }

    case "register-export": {
      const doc = loadProject(dir);
      const report = readExportReport(requireFlag(values.report, "--report"));
      const registered = report.kind === "rive"
        ? registerRiv(doc, dir, report, now)
        : report.scope === "character"
          ? registerCharacterAseprite(doc, dir, report, now)
          : registerMotionExport(doc, dir, report, now);
      saveProject(dir, doc);
      emit(values, registered, [
        `${registered.asset} → ${registered.uri} (${registered.metadata.size ?? "?"} bytes) registered`,
      ]);
      break;
    }

    case "register-recolor": {
      const doc = loadProject(dir);
      const report = readRecolorReport(requireFlag(values.report, "--report"));
      const registered = registerRecolor(doc, dir, report, now);
      saveProject(dir, doc);
      const { notes, ...payload } = registered;
      emit(values, payload, [
        `colourways: ${payload.variants.join(", ")}`,
        ...payload.motions.map((m) => `  ${m.id}: ${Object.keys(m.variants).join(", ")} registered (sheet + atlas + preview)`),
      ]);
      for (const note of notes) console.error(note);
      break;
    }

    case "add-video": {
      const doc = loadProject(dir);
      const motion = findMotion(doc, requireFlag(values.motion, "--motion"));
      const uri = toUri(dir, requireFlag(values.file, "--file"), "--file");
      const derivedFrom = values["derived-from"];
      // The gate the loop workflow's first step exists for. A GENERATED clip
      // on a loop is the moment this workflow starts spending — about a
      // dollar a take — and its duration, its width and its frame rate are
      // all the user's decisions. Prose in the skill did not hold: a trial
      // agent skipped the interview and spent $2.61 on a loop twice as long
      // as the UI wanted. A DERIVED clip is exempt because that money is
      // already gone: refusing to record it would only lose its provenance.
      if (motion.kind === "transition" && derivedFrom === undefined && !readTransitionBrief(motion).brief) {
        fail(`add-video: transition '${motion.id}' has no brief — record the user's answers first: set-motion --brief-duration <seconds it plays> --brief-budget <usd>`);
      }
      if (motion.kind === "loop" && derivedFrom === undefined) {
        const { brief, missing } = readBrief(motion);
        if (!brief) {
          const record = "record the user's answers first: set-motion --brief-duration … --brief-width … --brief-interpolator …";
          fail(missing
            ? `add-video: loop '${motion.id}' has an incomplete brief, missing ${listOf(missing)} — ${record}`
            : `add-video: loop '${motion.id}' has no brief — ${record}`);
        }
      }
      // The two legs are registered at opposite ends of their wait. A SHOT
      // clip is booked before the model runs, so the stage can show a chip
      // for the seven minutes it takes — its file does not exist yet, and
      // `generating` is the truth. A DERIVED clip is the other way round:
      // `remove-video-background.mjs` / `interpolate-video.mjs` have already
      // written the file by the time there is anything to register, so
      // `generating` would describe a wait that is over (measured on the
      // trial project: three derived clips sat at `generating` with their
      // files on disk). It is measured here instead; `--status` overrides.
      const status = oneOf(
        values.status ?? (derivedFrom === undefined ? "generating" : "ready"),
        VIDEO_STATUSES,
        "--status",
      );
      const duration = num(values.duration, "--duration", { min: 0 });

      motion.videos ??= [];
      const used = new Set(motion.videos.map((v) => v.id));
      let n = 1;
      while (used.has(`video-${n}`) || doc.assets.some((a) => a.id === `${motion.id}-video-${n}`)) n++;
      const assetId = `${motion.id}-video-${n}`;
      const videoId = `video-${n}`;

      // The two origins a clip can have. A matte or an interpolation was not
      // SHOT: it has no mode, no prompt and no reference images, and its
      // history is the take it was made out of. Refusing those flags by name
      // is the same deal `add-ref --derived-from` makes, for the same reason —
      // a `generate` edge naming a model nobody prompted is a lie the graph
      // cannot be talked out of later. Everything is validated before the
      // document is touched, so a rejected combination writes nothing.
      let entry;
      let provenance;
      let note;
      if (derivedFrom !== undefined) {
        for (const [flag, key] of [["--mode", "mode"], ["--prompt", "prompt"], ["--from", "from"]]) {
          if (values[key] !== undefined) {
            fail(`--derived-from: a clip made out of another clip has no ${flag} — its source is the take it came from`);
          }
        }
        const op = oneOf(requireFlag(values.op, "--op"), VIDEO_OPS, "--op");
        const model = oneOf(requireFlag(values.model, "--model"), DERIVE_VIDEO_MODELS, "--model");
        const parent = motion.videos.find((v) => v.id === derivedFrom || v.asset === derivedFrom);
        if (!parent) {
          const known = motion.videos.map((v) => v.id).join(", ") || "none";
          fail(`--derived-from: no video '${derivedFrom}' on motion '${motion.id}' (known: ${known})`);
        }
        entry = { id: videoId, asset: assetId, model, mode: "derived", prompt: "", status, derivedFrom: parent.id, op };
        provenance = edge(assetId, [parent.asset], operation("derive", now, { op, model, duration }));
        note = `${op}, ${model}, from ${parent.id}`;
      } else {
        if (values.op !== undefined) {
          fail("--op: only --derived-from records an operation — a clip that was shot has a --mode, not an op");
        }
        const model = oneOf(requireFlag(values.model, "--model"), VIDEO_MODELS, "--model");
        const mode = oneOf(requireFlag(values.mode, "--mode"), VIDEO_MODES, "--mode");
        const inputs = parseInputs(doc, values.from, "--from");
        entry = { id: videoId, asset: assetId, model, mode, prompt: values.prompt ?? "", status };
        provenance = edge(assetId, inputs, operation("generate", now, {
          model, mode, prompt: values.prompt, duration,
        }, inputs));
        note = `${model}, ${mode}`;
      }

      const probed = videoMetadata(join(dir, uri));
      const metadata = { ...probed.metadata };
      if (duration !== undefined) metadata.duration = duration;

      upsertAsset(doc, {
        id: assetId, type: "video", uri,
        name: `${motion.id} video ${n} (${entry.op ? `${entry.op}, ` : ""}${entry.model})`,
        metadata, createdAt: now, status,
      }, `motion '${motion.id}'`);
      setEdge(doc, provenance);

      motion.videos.push(entry);
      saveProject(dir, doc);
      emit(values, motion, [
        `${motion.id}: registered ${assetId} (${note}, ${status})`,
        ...(probed.warning ? [`WARN: ${probed.warning}`] : []),
      ]);
      break;
    }

    case "set-video": {
      const doc = loadProject(dir);
      const motion = findMotion(doc, requireFlag(values.motion, "--motion"));
      const key = requireFlag(values.video, "--video");
      const video = (motion.videos ?? []).find((v) => v.id === key || v.asset === key);
      if (!video) {
        const known = (motion.videos ?? []).map((v) => v.id).join(", ") || "none";
        fail(`--video: no video '${key}' on motion '${motion.id}' (known: ${known})`);
      }
      video.status = oneOf(requireFlag(values.status, "--status"), VIDEO_STATUSES, "--status");
      if (values.notes !== undefined) motion.notes = values.notes;

      const asset = doc.assets.find((a) => a.id === video.asset);
      const warnings = [];
      if (asset) {
        asset.status = video.status;
        if (video.status === "ready") {
          const probed = videoMetadata(join(dir, asset.uri));
          if (probed.warning) warnings.push(probed.warning);
          asset.metadata = { ...asset.metadata, ...probed.metadata };
        }
      }
      saveProject(dir, doc);
      emit(values, motion, [`${motion.id}: ${video.id} → ${video.status}`, ...warnings.map((w) => `WARN: ${w}`)]);
      break;
    }

    case "remove-motion": {
      const doc = loadProject(dir);
      const motion = findMotion(doc, requireFlag(values.motion, "--motion"));
      const joined = doc.sprite.motions.filter((m) => m.kind === "transition" && (m.from === motion.id || m.to === motion.id));
      if (joined.length) {
        fail(`remove-motion: ${joined.map((m) => m.id).join(", ")} ${joined.length === 1 ? "joins" : "join"} '${motion.id}' — remove ${joined.length === 1 ? "it" : "them"} first, or the character keeps a transition to nowhere`);
      }
      const staleWhole = characterExportsHolding(doc, motion.id);
      const owned = new Set([
        `${motion.id}-sheet-raw`,
        `${motion.id}-keyframe`, `${motion.id}-keyframe-alpha`,
        ...runOwnedIds(doc, motion.id),
        ...(motion.videos ?? []).map((v) => v.asset),
        // The character's .riv and Aseprite sheet hold this motion's frames;
        // without them they no longer describe the character.
        ...staleWhole,
      ]);
      const ids = doc.assets.map((a) => a.id).filter((id) => owned.has(id));
      const orphanedPaths = doc.assets.filter((a) => ids.includes(a.id)).map((a) => a.uri);
      dropAssets(doc, ids);
      retireCharacterExports(doc, staleWhole);
      doc.sprite.motions = doc.sprite.motions.filter((m) => m.id !== motion.id);
      saveProject(dir, doc);
      const payload = { motion: motion.id, removedAssets: ids, orphanedPaths };
      emit(values, payload, [
        `removed motion ${motion.id} (${ids.length} assets)`,
        ...(orphanedPaths.length ? [`files left on disk: ${orphanedPaths.join(", ")}`] : []),
      ]);
      // A mirror of it keeps its own frames — they are real files — but no
      // longer has a source to be mirrored again from.
      for (const flipped of doc.sprite.motions.filter((m) => m.source === "mirror" && m.mirrorOf === motion.id)) {
        console.error(`note: ${flipped.id} was a mirror of ${motion.id}; its frames stay, but there is nothing to mirror it from again`);
      }
      break;
    }

    case "show": {
      const doc = loadProject(dir);
      if (values.motion !== undefined) {
        const motion = findMotion(doc, values.motion);
        const stale = motion.source === "mirror" && motion.mirrorOf ? mirrorStaleness(doc, motion) : null;
        const payload = {
          ...compactMotion(motion),
          prompt: motion.prompt,
          ...(motion.promptParts ? { promptParts: motion.promptParts } : {}),
          ...(motion.breathe ? { breathe: motion.breathe } : {}),
          ...(stale ? { stale } : {}),
          notes: motion.notes,
          ...(motion.keyframe ? { keyframe: motion.keyframe } : {}),
          ...(motion.keyframeAlpha ? { keyframeAlpha: motion.keyframeAlpha } : {}),
          ...(motion.webp ? { webp: motion.webp } : {}),
          ...(motion.exports ? { exports: motion.exports } : {}),
          videos: (motion.videos ?? []).map((v) => ({
            id: v.id, model: v.model, mode: v.mode, status: v.status,
            ...(v.derivedFrom ? { derivedFrom: v.derivedFrom } : {}),
            ...(v.op ? { op: v.op } : {}),
          })),
          inspect: motion.inspect,
        };
        emit(values, payload, [
          ...motionLines(motion, doc),
          ...(stale ? [`  stale: ${stale} — mirror it again and register it`] : []),
          ...(motion.inspect?.warnings ?? []),
        ]);
        break;
      }
      const summary = summarize(doc, dir);
      const whole = CHARACTER_EXPORTS
        .map((key) => [key, doc.assets.find((a) => a.id === summary.exports?.[key])?.uri])
        .filter(([, uri]) => uri);
      emit(values, summary, [
        `${summary.title} — ${summary.refs.length} refs, ${summary.motions.length} motions`,
        ...whole.map(([key, uri]) => `  exported: ${key} (${uri})`),
        ...summary.motions.map((m) => `  ${m.id.padEnd(12)} ${m.status.padEnd(10)} ${m.kind === "loop" ? "loop".padEnd(7) : `${m.grid.rows}x${m.grid.cols}`.padEnd(7)} @ ${m.fps}fps  ${m.frameCount} frames${m.warnings.length ? `  (${m.warnings.length} warnings)` : ""}`),
        ...(summary.staleMirrors ?? []).map((m) => `  stale mirror: ${m.id} (of ${m.mirrorOf}) — ${m.reason}; mirror it again and register it`),
        ...(recordedVariants(doc.sprite.character).length ? [`  colourways: ${recordedVariants(doc.sprite.character).map((v) => v.name).join(", ")}`] : []),
        ...(summary.variantsMissing ?? []).map((m) => `  missing colourway: ${m.motion} has no ${m.variants.join(", ")} — recolor it (sprite-sheet.mjs recolor <character>/motions/${m.motion}) and register-recolor`),
      ]);
      break;
    }

    default:
      fail(`unhandled subcommand '${command}'`);
  }
}

// Every known failure already leaves through `fail`. This catches the ones
// nobody predicted, and only the system errors among them: an unanticipated
// EACCES/ENOSPC is a state the agent can act on and gets the one-line
// `ERROR:` contract, while a genuine bug in this script keeps its stack —
// turning a TypeError into a tidy sentence would hide it from whoever has to
// fix it.
try {
  main();
} catch (error) {
  if (!error?.syscall) throw error;
  fail(`${error.message || error.code || "filesystem error"}`);
}

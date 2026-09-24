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
 * Subcommands: init, add-ref, add-motion, set-motion, set-sheet,
 * set-keyframe, register-run, register-export, add-video, set-video,
 * remove-motion, show.
 */

import { spawnSync } from "node:child_process";
import {
  closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync,
  realpathSync, renameSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";

const SCHEMA = "pneuma-craft/project/v1";
const TOOL = "sprite-sheet.mjs";
const DEFAULT_CELL = { width: 256, height: 256 };
const DEFAULT_FPS = 8;

const REF_ROLES = ["turnaround", "portrait", "expression", "custom"];
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
 *  made before the video source existed. */
const MOTION_SOURCES = ["sheet", "video"];
const FACINGS = ["left", "right"];

const SUBCOMMANDS = [
  "init", "add-ref", "add-motion", "set-motion", "set-sheet", "set-keyframe",
  "register-run", "register-export", "add-video", "set-video", "remove-motion", "show",
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
};

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
       [--facing left|right] [--force]
      Create project.json, creating --dir first if it does not exist yet.
      Refuses to clobber an existing project without --force.

  add-ref --id <refId> --file <path> --role ${REF_ROLES.join("|")}
          [--label <text>] [--prompt <text>] [--model <name>] [--from <assetId,…>]
          [--uploaded | --derived-from <refId> [--op <word>]]
      Register an identity reference as asset ref-<refId>. Re-adding the same
      id replaces the asset and its edge, whatever type that edge had.
      By default the image was generated here: a 'generate' edge carrying
      --model / --prompt / --from.
      --uploaded says the user brought this file: an 'upload' edge by the
      human, with no parent and no params. It refuses --model / --prompt /
      --from, because none of them happened.
      --derived-from says you cut or cleaned this image out of another
      registered reference: a 'derive' edge from that ref, with params.op
      (--op, a single word, default 'crop').

  add-motion --id <motionId> --label <text> --rows R --cols C --fps N
             [--kind ${MOTION_KINDS.join("|")}] [--loop|--no-loop]
             [--anchor ${ANCHORS.join("|")}] [--prompt <text>]
             [--status ${MOTION_STATUSES.join("|")}] [--source ${MOTION_SOURCES.join("|")}]
  add-motion --kind transition --from <loopId> --to <loopId> [--id] [--label]
      --source records how the frames will be obtained (a generated sheet or
      a sampled video clip) before anything is generated. Omitted means sheet.
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
             [--prompt] [--status] [--notes]
             [--ack-warnings "<reason>"] [--clear-ack]
             [--brief-duration <s>] [--brief-width <px>]
             [--brief-interpolator ${LOOP_INTERPOLATORS.join("|")}] [--brief-budget <usd>]
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
      lottie, png-seq) with a 'derive' edge from every frame it was made of
      and motion.exports[format] naming it; the character's .riv becomes
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
      exports cut from the frames it replaces, and the .riv that held them —
      the files stay on disk; export again.

  register-run --motion <motionId> --run <run.json|-> [--video <videoId>] [--at <ms>]
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
      Compact summary for the agent.

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
  "id", "label", "prompt", "kind", "brief", "grid", "fps", "loop", "anchor", "status", "notes", "source",
  "keyframe", "keyframeAlpha", "sheetRaw", "sheetAlpha", "sheet", "atlas", "frames",
  "gif", "webp", "exports", "videos", "inspect",
];

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
  if (doc.sprite.exports?.riv === id) return CHARACTER_OWNER;
  for (const motion of doc.sprite.motions) {
    const exports = motion.exports && typeof motion.exports === "object" ? motion.exports : {};
    const slots = [
      motion.sheetRaw, motion.sheetAlpha, motion.sheet, motion.atlas, motion.gif, motion.webp,
      motion.keyframe, motion.keyframeAlpha, ...Object.values(exports),
    ];
    if (slots.includes(id)
      || (motion.frames ?? []).includes(id)
      || (motion.videos ?? []).some((v) => v.asset === id)) {
      return `motion '${motion.id}'`;
    }
  }
  return null;
}

/** The owner of an asset that belongs to the whole character (its `.riv`). */
const CHARACTER_OWNER = "the character";

/**
 * The character's `.riv`, when it holds `motionId`'s frames — read off the
 * edge `register-export` wrote (`params.motions`). A `.riv` made from frames
 * that are about to be replaced or removed would be offered as current.
 */
function rivHolding(doc, motionId) {
  const id = doc.sprite.exports?.riv;
  if (!id) return null;
  const motions = doc.provenance.find((e) => e.toAssetId === id)?.operation?.params?.motions;
  return Array.isArray(motions) && motions.includes(motionId) ? id : null;
}

/** Take the `.riv` off the sidecar once its asset is gone. */
function retireRiv(doc) {
  if (!doc.sprite.exports) return;
  delete doc.sprite.exports.riv;
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
  // A surviving edge must never point at a removed parent.
  doc.provenance = doc.provenance.map((e) => (e.fromAssetId && set.has(e.fromAssetId) ? { ...e, fromAssetId: null } : e));
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

/** The sidecar entry for a reference, by ref id (`turnaround`) or by its
 *  asset id (`ref-turnaround`) — `--from` speaks asset ids, so both spellings
 *  reach this and neither should be a puzzle. Unknown lists what it knows,
 *  the way `findMotion` does. */
function findRef(doc, key, flag) {
  const ref = doc.sprite.refs.find((r) => r.id === key) ?? doc.sprite.refs.find((r) => r.asset === key);
  if (!ref) {
    const known = doc.sprite.refs.map((r) => r.id).join(", ") || "none";
    fail(`${flag}: no reference '${key}' in this character (known refs: ${known})`);
  }
  return ref;
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
    const source = findRef(doc, derivedFrom, "--derived-from");
    // A self-parent is a cycle the graph cannot mean anything by, and it is an
    // easy typo when re-registering the same id.
    if (source.asset === assetId) fail(`--derived-from: reference '${id}' cannot be derived from itself`);
    const op = values.op === undefined ? "crop" : String(values.op).trim();
    if (!op) fail("--op: expected a single word such as crop or cleanup");
    return edge(assetId, [source.asset], operation("derive", now, { op }));
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
  // A loop reports these three and none of the anchor numbers; a sheet run
  // reports the anchor numbers and none of these. Picking by name means each
  // shape carries exactly what it measured, and the missing half stays
  // missing instead of arriving as a confident 0.
  const seam = finiteNumber(value.seam);
  const step = finiteNumber(value.step);
  // How many in-between frames `--seam-fill` inserted at the wrap. 0 is a
  // real reading — the loop closed on its own — so the same finite-or-absent
  // rule applies: absent means the report predates the flag.
  const seamFill = finiteNumber(value.seamFill);
  const alphaCoverage = finiteNumber(value.alphaCoverage);
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
    maxJump: value.maxJump,
    scaleDrift: value.scaleDrift,
    emptyFrames: value.emptyFrames ?? [],
    warnings: value.warnings ?? [],
    ...(seam === undefined ? {} : { seam }),
    ...(step === undefined ? {} : { step }),
    ...(seamFill === undefined ? {} : { seamFill }),
    ...(alphaCoverage === undefined ? {} : { alphaCoverage }),
    ...(startGap === undefined ? {} : { startGap }),
    ...(endGap === undefined ? {} : { endGap }),
    ...(crop ? { crop } : {}),
    ...(scale > 0 ? { scale } : {}),
  };
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

/**
 * One motion, said out loud for the agent.
 *
 * A loop is described by different facts than a sprite motion: nobody cares
 * about its grid, and the two numbers that decide whether the workflow
 * succeeded — does the last frame return to the first — have nowhere else to
 * be read. Derived clips get their parent printed beside them, because
 * "video-2" alone cannot tell you it is the matte of video-1.
 */
function motionLines(motion) {
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
      lines.push(`  seam ${round4(seam)} vs step ${round4(step)} (limit ${round4(2 * step)}) — ${seam > 2 * step ? "does not close" : "closes"}`);
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
    const exported = Object.keys(motion.exports ?? {});
    if (exported.length) lines.push(`  exports: ${exported.join(", ")}`);
  }
  for (const video of motion.videos ?? []) {
    lines.push(video.derivedFrom
      ? `  ${video.id} ← ${video.derivedFrom} (${video.op}, ${video.model}) — ${video.status}`
      : `  ${video.id} (${video.model}, ${video.mode}) — ${video.status}`);
  }
  return lines;
}

function summarize(doc, dir) {
  return {
    dir: resolve(dir),
    title: doc.title,
    character: doc.sprite.character,
    refs: doc.sprite.refs.map((ref) => ({
      id: ref.id,
      role: ref.role,
      origin: refOrigin(doc, ref.asset),
      label: ref.label,
      uri: doc.assets.find((a) => a.id === ref.asset)?.uri ?? null,
    })),
    motions: doc.sprite.motions.map(compactMotion),
    ...(doc.sprite.exports && Object.keys(doc.sprite.exports).length ? { exports: doc.sprite.exports } : {}),
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
  },
  "add-ref": {
    id: { type: "string" }, file: { type: "string" }, role: { type: "string" }, label: { type: "string" },
    prompt: { type: "string" }, model: { type: "string" }, from: { type: "string", multiple: true },
    uploaded: { type: "boolean", default: false }, "derived-from": { type: "string" }, op: { type: "string" },
  },
  "add-motion": {
    id: { type: "string" }, label: { type: "string" }, rows: { type: "string" }, cols: { type: "string" },
    fps: { type: "string" }, loop: { type: "boolean", default: false }, "no-loop": { type: "boolean", default: false },
    anchor: { type: "string" }, prompt: { type: "string" }, status: { type: "string" },
    source: { type: "string" }, kind: { type: "string" }, from: { type: "string" }, to: { type: "string" },
  },
  "set-motion": {
    motion: { type: "string" }, label: { type: "string" }, fps: { type: "string" },
    loop: { type: "boolean", default: false }, "no-loop": { type: "boolean", default: false },
    anchor: { type: "string" }, prompt: { type: "string" }, status: { type: "string" }, notes: { type: "string" },
    "ack-warnings": { type: "string" }, "clear-ack": { type: "boolean", default: false },
    "brief-duration": { type: "string" }, "brief-width": { type: "string" },
    "brief-interpolator": { type: "string" }, "brief-budget": { type: "string" },
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
  "register-run": { motion: { type: "string" }, run: { type: "string" }, video: { type: "string" } },
  "register-export": { report: { type: "string" } },
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
  }, motion.frames)));
  motion.exports = { ...(motion.exports ?? {}), [format]: id };
  return { motion: motion.id, format, asset: id, uri, metadata };
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
  const motionIds = Array.isArray(report.motions) ? report.motions.map((m) => String(m?.id ?? m)) : [];
  if (!motionIds.length) fail("--report: the .riv report lists no motions");
  const motions = motionIds.map((motionId) => {
    const motion = findMotion(doc, motionId, "--report motions");
    if (motion.status !== "ready") fail(`--report: '${motionId}' is not ready (${motion.status})`);
    return motion;
  });
  const frameIds = motions.flatMap((motion) => motion.frames ?? []);
  const expected = frameUris(doc, frameIds);
  const got = report.frames.map((path) => toUri(dir, String(path), "--report frames"));
  if (got.length !== expected.length || got.some((u, i) => u !== expected[i])) {
    fail(`--report: the .riv holds ${got.length} frames that are not the frames registered for ${motionIds.join(", ")} (${expected.length}) — run rive again`);
  }

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
      saveProject(dir, doc);
      const summary = summarize(doc, dir);
      emit(values, summary, [`created ${path} for ${name} (${cell.width}x${cell.height})`]);
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
      const entry = { id, asset: assetId, role, label };
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
        const motion = transitionMotion(doc, values);
        doc.sprite.motions.push(motion);
        saveProject(dir, doc);
        emit(values, motion, [`added transition ${motion.id} (${motion.from} → ${motion.to})`]);
        break;
      }
      if (values.from !== undefined || values.to !== undefined) {
        fail("--from / --to: only a --kind transition goes from one loop to another");
      }
      const id = requireFlag(values.id, "--id");
      if (doc.sprite.motions.some((m) => m.id === id)) {
        fail(`--id: motion '${id}' already exists — use set-motion to change it`);
      }
      // A loop has no grid — its frames are a sequence, not cells of a sheet —
      // so the two flags a sprite motion cannot do without become optional and
      // land on the 1x1 that `register-run` will confirm. Everything else about
      // a sprite motion is untouched.
      const isLoop = kind === "loop";
      const gridSide = (flag, raw) => (isLoop
        ? num(raw, flag, { integer: true, min: 1, fallback: 1 })
        : num(requireFlag(raw, flag), flag, { integer: true, min: 1 }));
      const motion = {
        id,
        label: values.label ?? titleCase(id),
        prompt: values.prompt ?? "",
        ...(kind ? { kind } : {}),
        grid: {
          rows: gridSide("--rows", values.rows),
          cols: gridSide("--cols", values.cols),
        },
        fps: num(requireFlag(values.fps, "--fps"), "--fps", { min: 1 }),
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
      if (values.prompt !== undefined) motion.prompt = values.prompt;
      if (values.status !== undefined) motion.status = oneOf(values.status, MOTION_STATUSES, "--status");
      if (values.notes !== undefined) motion.notes = values.notes;

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
      for (const line of briefLines) console.error(line);
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
      const staleRiv = rivHolding(doc, motion.id);
      const onDemand = new Set(Object.keys(EXPORT_SPECS).map((format) => exportAssetId(motion.id, format)));
      const retiredExports = doc.assets
        .filter((a) => (onDemand.has(a.id) && leftover.includes(a.id)) || a.id === staleRiv)
        .map((a) => ({ id: a.id, uri: a.uri }));
      dropAssets(doc, [...leftover, ...(staleRiv ? [staleRiv] : [])]);
      if (staleRiv) retireRiv(doc);

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
        const parents = fromVideo ? [videoAssetId] : (sourceId ? [sourceId] : []);
        setEdge(doc, edge(id, parents, operation("derive", now, fromVideo
          ? { tool: TOOL, step: "from-video", frameIndex: index, t: Number.isFinite(sampledAt) ? sampledAt : undefined }
          : { tool: TOOL, step: "run", cell: index })));
        return id;
      });

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
      }
      // The sidecar says how these frames were obtained, and it is corrected
      // in both directions: a sheet run over a motion someone declared `video`
      // is still a sheet's frames. `sheet` stays unwritten when nothing ever
      // claimed otherwise, because absent already means sheet.
      if (fromVideo || transitionRun) motion.source = "video";
      else if (motion.source === "video") motion.source = "sheet";
      // A fresh measurement is not the one that was acknowledged, so the
      // acknowledgement goes with the numbers it covered.
      const summary = inspectSummary(run.inspect);
      if (summary) motion.inspect = summary;
      // A measured clip scale and place were measurements of the frames this
      // run replaces; the new run records its own (or the next export
      // measures again).
      delete motion.clip;
      motion.status = "ready";

      // What the user asked for against what landed. The frames are already
      // cut by the time anyone can measure this, so it is a warning and not a
      // refusal — but it is the difference between a 512px loop for a hero
      // and the 532px one the Kiki trial shipped with a 45 MB Lottie, and
      // nothing else in the chain compares the two numbers. Two pixels of
      // slack, because the crop rect is rounded to even sides.
      const warnings = [];
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
          : `${motion.id}: ${frameIds.length} frames${fromVideo ? ` sampled from ${videoAssetId}` : ""}, atlas + preview registered (ready)`,
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
      break;
    }

    case "register-export": {
      const doc = loadProject(dir);
      const report = readExportReport(requireFlag(values.report, "--report"));
      const registered = report.kind === "rive"
        ? registerRiv(doc, dir, report, now)
        : registerMotionExport(doc, dir, report, now);
      saveProject(dir, doc);
      emit(values, registered, [
        `${registered.asset} → ${registered.uri} (${registered.metadata.size ?? "?"} bytes) registered`,
      ]);
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
      const staleRiv = rivHolding(doc, motion.id);
      const owned = new Set([
        `${motion.id}-sheet-raw`,
        `${motion.id}-keyframe`, `${motion.id}-keyframe-alpha`,
        ...runOwnedIds(doc, motion.id),
        ...(motion.videos ?? []).map((v) => v.asset),
        // The character's .riv holds this motion's frames; without them it
        // no longer describes the character.
        ...(staleRiv ? [staleRiv] : []),
      ]);
      const ids = doc.assets.map((a) => a.id).filter((id) => owned.has(id));
      const orphanedPaths = doc.assets.filter((a) => ids.includes(a.id)).map((a) => a.uri);
      dropAssets(doc, ids);
      if (staleRiv) retireRiv(doc);
      doc.sprite.motions = doc.sprite.motions.filter((m) => m.id !== motion.id);
      saveProject(dir, doc);
      const payload = { motion: motion.id, removedAssets: ids, orphanedPaths };
      emit(values, payload, [
        `removed motion ${motion.id} (${ids.length} assets)`,
        ...(orphanedPaths.length ? [`files left on disk: ${orphanedPaths.join(", ")}`] : []),
      ]);
      break;
    }

    case "show": {
      const doc = loadProject(dir);
      if (values.motion !== undefined) {
        const motion = findMotion(doc, values.motion);
        const payload = {
          ...compactMotion(motion),
          prompt: motion.prompt,
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
          ...motionLines(motion),
          ...(motion.inspect?.warnings ?? []),
        ]);
        break;
      }
      const summary = summarize(doc, dir);
      const rivUri = summary.exports?.riv ? doc.assets.find((a) => a.id === summary.exports.riv)?.uri : null;
      emit(values, summary, [
        `${summary.title} — ${summary.refs.length} refs, ${summary.motions.length} motions`,
        ...(rivUri ? [`  exported: riv (${rivUri})`] : []),
        ...summary.motions.map((m) => `  ${m.id.padEnd(12)} ${m.status.padEnd(10)} ${m.kind === "loop" ? "loop".padEnd(7) : `${m.grid.rows}x${m.grid.cols}`.padEnd(7)} @ ${m.fps}fps  ${m.frameCount} frames${m.warnings.length ? `  (${m.warnings.length} warnings)` : ""}`),
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

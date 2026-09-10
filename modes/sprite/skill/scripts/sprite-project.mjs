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
 * register-run, add-video, set-video, remove-motion, show.
 */

import { spawnSync } from "node:child_process";
import {
  closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync,
  realpathSync, renameSync, rmSync, writeFileSync,
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
const VIDEO_MODELS = ["seedance-2.5", "h3-max"];
const VIDEO_MODES = ["i2v", "first-last", "r2v"];
const ANCHORS = ["bottom", "center"];
/** How a motion's frames were obtained. Absent means "sheet" — every motion
 *  made before the video source existed. */
const MOTION_SOURCES = ["sheet", "video"];
const FACINGS = ["left", "right"];

const SUBCOMMANDS = [
  "init", "add-ref", "add-motion", "set-motion", "set-sheet",
  "register-run", "add-video", "set-video", "remove-motion", "show",
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
      Register an identity reference as asset ref-<refId>. Re-adding the same
      id replaces the asset and its edge.

  add-motion --id <motionId> --label <text> --rows R --cols C --fps N
             [--loop|--no-loop] [--anchor ${ANCHORS.join("|")}] [--prompt <text>]
             [--status ${MOTION_STATUSES.join("|")}] [--source ${MOTION_SOURCES.join("|")}]
      --source records how the frames will be obtained (a generated sheet or
      a sampled video clip) before anything is generated. Omitted means sheet.

  set-motion --motion <motionId> [--label] [--fps] [--loop|--no-loop] [--anchor]
             [--prompt] [--status] [--notes]
             [--ack-warnings "<reason>"] [--clear-ack]
      --ack-warnings accepts the motion's remaining inspect warnings with a
      one-sentence reason the user reads on the stage; the numbers stay
      visible. --clear-ack takes it back. Re-registering a run drops the
      acknowledgement with the measurement it covered.

  set-sheet --motion <motionId> --file <path> [--from <assetId,…>] [--model]
            [--prompt] [--background <text>] [--status ${MOTION_STATUSES.join("|")}]
      Register the generated sheet as <motion>-sheet-raw (id stays stable
      across regenerations). Motion status defaults to processing.
      Call it twice per sheet: '--status generating' BEFORE the image call
      reserves the asset with empty metadata and no file on disk, so the
      stage shows a placeholder; calling it again once the file has landed
      measures it and flips the same asset to ready. A missing file under any
      other status is an error.

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

  add-video --motion <motionId> --file <path> --model ${VIDEO_MODELS.join("|")}
            --mode ${VIDEO_MODES.join("|")} [--from <assetId,…>] [--prompt]
            [--duration <seconds>] [--status ${VIDEO_STATUSES.join("|")}]
  set-video --motion <motionId> --video <videoId|assetId>
            --status ${VIDEO_STATUSES.join("|")} [--notes <text>]
      --notes lands on the motion (the failure reason a human reads).

  remove-motion --motion <motionId>
      Drop the motion, its assets and its edges. Files on disk are left
      alone; their paths are printed as orphanedPaths.

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
  "id", "label", "prompt", "grid", "fps", "loop", "anchor", "status", "notes", "source",
  "sheetRaw", "sheetAlpha", "sheet", "atlas", "frames", "gif", "webp", "videos", "inspect",
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
  for (const motion of doc.sprite.motions) {
    const slots = [motion.sheetRaw, motion.sheetAlpha, motion.sheet, motion.atlas, motion.gif, motion.webp];
    if (slots.includes(id)
      || (motion.frames ?? []).includes(id)
      || (motion.videos ?? []).some((v) => v.asset === id)) {
      return `motion '${motion.id}'`;
    }
  }
  return null;
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
 */
function operation(type, timestamp, params, inputs) {
  const merged = { ...params };
  if (inputs && inputs.length > 1) merged.inputs = inputs;
  for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key];
  const op = { type, actor: "agent", timestamp };
  if (Object.keys(merged).length) op.params = merged;
  return op;
}

function edge(toAssetId, inputs, op) {
  return { toAssetId, fromAssetId: inputs && inputs.length ? inputs[0] : null, operation: op };
}

function findMotion(doc, id, flag = "--motion") {
  const motion = doc.sprite.motions.find((m) => m.id === id);
  if (!motion) {
    const known = doc.sprite.motions.map((m) => m.id).join(", ") || "none";
    fail(`${flag}: no motion '${id}' in this character (known motions: ${known})`);
  }
  return motion;
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

const frameAssetId = (motionId, index) => `${motionId}-frame-${String(index).padStart(2, "0")}`;

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
  ]);
  const mine = `motion '${motionId}'`;
  return doc.assets
    .map((a) => a.id)
    .filter((id) => owned.has(id) || (id.startsWith(framePrefix) && /^\d{2}$/.test(id.slice(framePrefix.length))))
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
  };
}

function summarize(doc, dir) {
  return {
    dir: resolve(dir),
    title: doc.title,
    character: doc.sprite.character,
    refs: doc.sprite.refs.map((ref) => ({
      id: ref.id,
      role: ref.role,
      label: ref.label,
      uri: doc.assets.find((a) => a.id === ref.asset)?.uri ?? null,
    })),
    motions: doc.sprite.motions.map(compactMotion),
  };
}

function compactMotion(motion) {
  return {
    id: motion.id,
    label: motion.label,
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
  },
  "add-motion": {
    id: { type: "string" }, label: { type: "string" }, rows: { type: "string" }, cols: { type: "string" },
    fps: { type: "string" }, loop: { type: "boolean", default: false }, "no-loop": { type: "boolean", default: false },
    anchor: { type: "string" }, prompt: { type: "string" }, status: { type: "string" },
    source: { type: "string" },
  },
  "set-motion": {
    motion: { type: "string" }, label: { type: "string" }, fps: { type: "string" },
    loop: { type: "boolean", default: false }, "no-loop": { type: "boolean", default: false },
    anchor: { type: "string" }, prompt: { type: "string" }, status: { type: "string" }, notes: { type: "string" },
    "ack-warnings": { type: "string" }, "clear-ack": { type: "boolean", default: false },
  },
  "set-sheet": {
    motion: { type: "string" }, file: { type: "string" }, from: { type: "string", multiple: true },
    model: { type: "string" }, prompt: { type: "string" }, background: { type: "string" }, status: { type: "string" },
  },
  "register-run": { motion: { type: "string" }, run: { type: "string" }, video: { type: "string" } },
  "add-video": {
    motion: { type: "string" }, file: { type: "string" }, model: { type: "string" }, mode: { type: "string" },
    from: { type: "string", multiple: true }, prompt: { type: "string" }, duration: { type: "string" },
    status: { type: "string" },
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
  for (const key of ["frames", "sheet", "atlas", "gif"]) {
    if (run[key] === undefined) fail(`--run: the run summary has no '${key}' — is this 'sprite-sheet.mjs run --json' output?`);
  }
  if (!Array.isArray(run.frames) || !run.frames.length) fail("--run: 'frames' must be a non-empty array");
  return run;
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
      const inputs = parseInputs(doc, values.from, "--from");
      const label = values.label ?? titleCase(id);
      const assetId = `ref-${id}`;

      upsertAsset(doc, {
        id: assetId, type: "image", uri, name: label,
        metadata: imageMetadata(file, "--file"),
        createdAt: now, status: "ready", tags: ["ref"],
      }, `ref '${id}'`);
      setEdge(doc, edge(assetId, inputs, operation("generate", now, {
        model: values.model, prompt: values.prompt,
      }, inputs)));

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
      const id = requireFlag(values.id, "--id");
      if (doc.sprite.motions.some((m) => m.id === id)) {
        fail(`--id: motion '${id}' already exists — use set-motion to change it`);
      }
      const motion = {
        id,
        label: values.label ?? titleCase(id),
        prompt: values.prompt ?? "",
        grid: {
          rows: num(requireFlag(values.rows, "--rows"), "--rows", { integer: true, min: 1 }),
          cols: num(requireFlag(values.cols, "--cols"), "--cols", { integer: true, min: 1 }),
        },
        fps: num(requireFlag(values.fps, "--fps"), "--fps", { min: 1 }),
        loop: loop(false),
        anchor: oneOf(values.anchor ?? "bottom", ANCHORS, "--anchor"),
        status: oneOf(values.status ?? "planned", MOTION_STATUSES, "--status"),
        // Absent is the honest default: it means "sheet", and every motion
        // made before the video source existed says nothing at all.
        ...(values.source === undefined
          ? {}
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

      saveProject(dir, doc);
      emit(values, motion, [`${motion.id}: ${motion.status}, ${motion.fps}fps, loop=${motion.loop}`]);
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

    case "register-run": {
      const doc = loadProject(dir);
      const motion = findMotion(doc, requireFlag(values.motion, "--motion"));
      const run = readRunSummary(requireFlag(values.run, "--run"));
      const owner = `motion '${motion.id}'`;
      const cell = run.cell && Number.isFinite(Number(run.cell.width)) && Number.isFinite(Number(run.cell.height))
        ? { width: Number(run.cell.width), height: Number(run.cell.height) }
        : null;

      // Ids this run is about to write. They are NOT dropped first: dropping
      // an id rewrites every surviving edge that pointed at it to null, which
      // used to cut each video loose from the frame it was generated from on
      // the second register-run. Only the previous run's leftovers — the tail
      // of a longer motion — are really removed, and `upsertAsset` replaces
      // the rest in place so a re-run is a no-op diff.
      const rebuilt = new Set([
        ...run.frames.map((_, index) => frameAssetId(motion.id, index)),
        `${motion.id}-sheet`, `${motion.id}-atlas`, `${motion.id}-gif`,
        ...(run.sheetAlpha ? [`${motion.id}-sheet-alpha`] : []),
        ...(run.webp ? [`${motion.id}-webp`] : []),
      ]);
      dropAssets(doc, runOwnedIds(doc, motion.id).filter((id) => !rebuilt.has(id)));

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
        const id = frameAssetId(motion.id, index);
        const uri = toUri(dir, path, "--run frames");
        upsertAsset(doc, {
          id, type: "image", uri, name: `${motion.id} frame ${String(index).padStart(2, "0")}`,
          metadata: imageMetadata(requireFile(dir, uri, "--run frames"), "--run frames"),
          createdAt: now, status: "ready",
        }, owner);
        const sampledAt = Array.isArray(run.sampledAt) ? run.sampledAt[index] : undefined;
        const parents = fromVideo ? [videoAssetId] : (sourceId ? [sourceId] : []);
        setEdge(doc, edge(id, parents, operation("derive", now, fromVideo
          ? { tool: TOOL, step: "from-video", frameIndex: index, t: Number.isFinite(sampledAt) ? sampledAt : undefined }
          : { tool: TOOL, step: "run", cell: index })));
        return id;
      });

      const sheetId = `${motion.id}-sheet`;
      const sheetUri = toUri(dir, run.sheet, "--run sheet");
      upsertAsset(doc, {
        id: sheetId, type: "image", uri: sheetUri, name: `${motion.id} atlas image`,
        metadata: imageMetadata(requireFile(dir, sheetUri, "--run sheet"), "--run sheet"),
        createdAt: now, status: "ready",
      }, owner);
      setEdge(doc, edge(sheetId, frameIds, operation("derive", now, { tool: TOOL, step: "pack" }, frameIds)));

      const atlasId = `${motion.id}-atlas`;
      const atlasUri = toUri(dir, run.atlas, "--run atlas");
      requireFile(dir, atlasUri, "--run atlas");
      upsertAsset(doc, {
        id: atlasId, type: "text", uri: atlasUri, name: `${motion.id} atlas`,
        metadata: {}, createdAt: now, status: "ready",
      }, owner);
      setEdge(doc, edge(atlasId, [sheetId], operation("derive", now, { tool: TOOL, step: "pack" })));

      const gifId = `${motion.id}-gif`;
      const gifUri = toUri(dir, run.gif, "--run gif");
      upsertAsset(doc, {
        id: gifId, type: "image", uri: gifUri,
        name: `${motion.id} preview`,
        metadata: { ...imageMetadata(requireFile(dir, gifUri, "--run gif"), "--run gif", cell), ...(run.fps ? { fps: run.fps } : {}) },
        createdAt: now, status: "ready",
      }, owner);
      setEdge(doc, edge(gifId, frameIds, operation("derive", now, { tool: TOOL, step: "gif" }, frameIds)));

      let webpId;
      if (run.webp) {
        webpId = `${motion.id}-webp`;
        const webpUri = toUri(dir, run.webp, "--run webp");
        upsertAsset(doc, {
          id: webpId, type: "image", uri: webpUri, name: `${motion.id} preview (webp)`,
          metadata: { ...imageMetadata(requireFile(dir, webpUri, "--run webp"), "--run webp", cell), ...(run.fps ? { fps: run.fps } : {}) },
          createdAt: now, status: "ready",
        }, owner);
        setEdge(doc, edge(webpId, frameIds, operation("derive", now, { tool: TOOL, step: "gif" }, frameIds)));
      }

      if (sheetAlphaId) motion.sheetAlpha = sheetAlphaId; else delete motion.sheetAlpha;
      motion.frames = frameIds;
      motion.sheet = sheetId;
      motion.atlas = atlasId;
      motion.gif = gifId;
      if (webpId) motion.webp = webpId; else delete motion.webp;
      // The sidecar says how these frames were obtained, and it is corrected
      // in both directions: a sheet run over a motion someone declared `video`
      // is still a sheet's frames. `sheet` stays unwritten when nothing ever
      // claimed otherwise, because absent already means sheet.
      if (fromVideo) motion.source = "video";
      else if (motion.source === "video") motion.source = "sheet";
      // A fresh measurement is not the one that was acknowledged, so the
      // acknowledgement goes with the numbers it covered.
      const summary = inspectSummary(run.inspect);
      if (summary) motion.inspect = summary;
      motion.status = "ready";

      saveProject(dir, doc);
      emit(values, motion, [
        `${motion.id}: ${frameIds.length} frames${fromVideo ? ` sampled from ${videoAssetId}` : ""}, atlas + preview registered (ready)`,
        ...(motion.inspect?.warnings ?? []),
      ]);
      break;
    }

    case "add-video": {
      const doc = loadProject(dir);
      const motion = findMotion(doc, requireFlag(values.motion, "--motion"));
      const uri = toUri(dir, requireFlag(values.file, "--file"), "--file");
      const model = oneOf(requireFlag(values.model, "--model"), VIDEO_MODELS, "--model");
      const mode = oneOf(requireFlag(values.mode, "--mode"), VIDEO_MODES, "--mode");
      const status = oneOf(values.status ?? "generating", VIDEO_STATUSES, "--status");
      const inputs = parseInputs(doc, values.from, "--from");
      const duration = num(values.duration, "--duration", { min: 0 });

      motion.videos ??= [];
      const used = new Set(motion.videos.map((v) => v.id));
      let n = 1;
      while (used.has(`video-${n}`) || doc.assets.some((a) => a.id === `${motion.id}-video-${n}`)) n++;
      const assetId = `${motion.id}-video-${n}`;

      const probed = videoMetadata(join(dir, uri));
      const metadata = { ...probed.metadata };
      if (duration !== undefined) metadata.duration = duration;

      upsertAsset(doc, {
        id: assetId, type: "video", uri, name: `${motion.id} video ${n} (${model})`,
        metadata, createdAt: now, status,
      }, `motion '${motion.id}'`);
      setEdge(doc, edge(assetId, inputs, operation("generate", now, {
        model, mode, prompt: values.prompt, duration,
      }, inputs)));

      motion.videos.push({ id: `video-${n}`, asset: assetId, model, mode, prompt: values.prompt ?? "", status });
      saveProject(dir, doc);
      emit(values, motion, [
        `${motion.id}: registered ${assetId} (${model}, ${mode}, ${status})`,
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
      const owned = new Set([
        `${motion.id}-sheet-raw`,
        ...runOwnedIds(doc, motion.id),
        ...(motion.videos ?? []).map((v) => v.asset),
      ]);
      const ids = doc.assets.map((a) => a.id).filter((id) => owned.has(id));
      const orphanedPaths = doc.assets.filter((a) => ids.includes(a.id)).map((a) => a.uri);
      dropAssets(doc, ids);
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
        const payload = { ...compactMotion(motion), prompt: motion.prompt, notes: motion.notes, inspect: motion.inspect };
        emit(values, payload, [
          `${motion.id} (${motion.label}) — ${motion.status}, ${motion.grid.rows}x${motion.grid.cols} @ ${motion.fps}fps, ${payload.frameCount} frames`,
          ...(motion.inspect?.warnings ?? []),
        ]);
        break;
      }
      const summary = summarize(doc, dir);
      emit(values, summary, [
        `${summary.title} — ${summary.refs.length} refs, ${summary.motions.length} motions`,
        ...summary.motions.map((m) => `  ${m.id.padEnd(12)} ${m.status.padEnd(10)} ${m.grid.rows}x${m.grid.cols} @ ${m.fps}fps  ${m.frameCount} frames${m.warnings.length ? `  (${m.warnings.length} warnings)` : ""}`),
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

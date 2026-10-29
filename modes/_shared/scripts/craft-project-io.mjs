#!/usr/bin/env node
/**
 * craft-project-io.mjs — the writer of a `pneuma-craft/project/v1` file:
 * atomic load/save, media probing, `runRegistered` (record a paid call before
 * it leaves, then land or fail it), and the CLI an agent drives.
 *
 * The rules live in the pure `craft-project.mjs`; this module adds the disk
 * and the process. Node built-ins plus ffprobe, no npm dependencies. Every
 * write validates the whole document first and replaces the file atomically,
 * so a refused command leaves the previous project untouched and a viewer
 * never reads a torn file. Reference: docs/reference/craft-project-file.md.
 *
 * Failure convention (sprite-project.mjs): `loadProject`, `saveProject` and
 * every CLI refusal print one `ERROR: <message>` line to stderr and exit 1.
 *
 * Usage: see USAGE below, or `craft-project-io.mjs --help`.
 */

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, renameSync, rmSync, writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import {
  ASSET_TYPES, COST_BASES, BILLINGS, OPERATION_TYPES, ACTORS,
  emptyProject, failAsset, landAsset, orderCraftKeys, readProjectFile, reserveAsset, statusOf, summarizeCosts,
  transition, validateProjectFile, dropAssets,
} from "./craft-project.mjs";
// The one authority for "this request provably never reached the provider".
import { neverReached as falNeverReached } from "./fal-queue.mjs";

const USAGE = `Usage: craft-project-io.mjs <command> --path <project.json> [options]

Commands:
  init      --title <t> --sidecar-key <k> [--width <n>] [--height <n>] [--fps <n>] [--aspect <w:h>] [--force]
  validate  [--sidecar-key <k>]                     exit 1 with the named violation
  reserve   --id <id> --type image|video|audio|text --name <n> --op generate|derive|upload|select|composite
            [--uri <rel>] [--from <id,...>] [--model <m>] [--prompt <p>] [--provider <p>]
            [--params-json '<json object>'] [--cost-usd <n> --cost-basis estimate|table [--cost-note <t>]]
            [--generating] [--actor agent|human] [--force]
  land      --id <id> [--file <abs|rel>] [--request-id <id>]
            [--cost-usd <n> --cost-basis reported|estimate|table [--cost-note <t>]]
  fail      --id <id> --reason "<text>" --billing none|unknown [--request-id <id>]
  drop      --id <id,...>
  show      [--id <id>]
  cost

Every command: --path <project.json> (required), --json (stdout carries one
object), --at <ms> (pin the timestamp), --sidecar-key <k> (refuse a file
without that sidecar; required for init).

reserve is saved BEFORE the call leaves; land probes the file and marks it
ready; fail records { reason, at, billing }. --billing none only when the
request provably never left this machine; anything else is unknown.`;

const SUBCOMMANDS = ["init", "validate", "reserve", "land", "fail", "drop", "show", "cost"];
/** The operations a reservation can record (`import` is clipcraft's legacy root). */
const RESERVE_OPS = OPERATION_TYPES.filter((type) => type !== "import");

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Read and validate a project file. A missing file, bad JSON or any
 * violation exits with one `ERROR:` line. With `sidecarKey`, a file without
 * that key is refused: it is some other mode's project.
 */
export function loadProject(path, { sidecarKey } = {}) {
  const absolute = resolve(path);
  if (!existsSync(absolute)) {
    fail(`no project file at ${absolute} — create it with 'craft-project-io.mjs init --path ${absolute} --title <t> --sidecar-key <k>'`);
  }
  let raw;
  try {
    raw = readFileSync(absolute, "utf-8");
  } catch (error) {
    fail(`cannot read ${absolute}: ${errorMessage(error)}`);
  }
  const result = readProjectFile(raw, { sidecarKey });
  if (!result.ok) fail(`${absolute}: ${result.error}`);
  return result.value;
}

/**
 * Validate, order the craft keys, write a scratch file beside `path` and
 * rename it over `path`. The scratch file is removed whichever way this goes;
 * a filesystem fault leaves as a one-line `ERROR:`. The scratch name is
 * unique per call, so two processes saving at once cannot write into each
 * other's scratch file (the later rename wins; that is a lost update, not a
 * torn file). Returns the document as written.
 */
export function saveProject(path, doc) {
  const absolute = resolve(path);
  const checked = validateProjectFile(doc);
  if (!checked.ok) fail(`refusing to write ${absolute}: ${checked.error}`);
  const ordered = orderCraftKeys(doc);
  const scratch = `${absolute}.${process.pid}-${randomBytes(4).toString("hex")}.tmp`;
  try {
    try {
      writeFileSync(scratch, `${JSON.stringify(ordered, null, 2)}\n`);
      renameSync(scratch, absolute);
    } finally {
      if (existsSync(scratch)) rmSync(scratch, { force: true });
    }
  } catch (error) {
    fail(`cannot write ${absolute}: ${errorMessage(error)}`);
  }
  return ordered;
}

/**
 * The canonical path of `path`. A path that does not exist yet (a planned
 * uri) resolves through its nearest existing ancestor, so `/var/…` and
 * `/private/var/…` on macOS still compare equal.
 */
function realOr(path) {
  const absolute = resolve(path);
  const missing = [];
  for (let current = absolute; ; current = dirname(current)) {
    try {
      return join(realpathSync(current), ...missing.reverse());
    } catch {
      if (dirname(current) === current) return absolute;
      missing.push(basename(current));
    }
  }
}

/**
 * The asset uri for a file: relative to the project file's directory, with
 * `/` separators. An absolute path or one relative to that directory both
 * land on the same uri; anything outside it is refused (throws).
 */
export function toProjectUri(projectPath, file, label = "file") {
  if (typeof file !== "string" || !file) throw new Error(`${label}: a path is required`);
  const root = realOr(dirname(resolve(projectPath)));
  const absolute = isAbsolute(file) ? realOr(file) : realOr(join(root, file));
  const rel = relative(root, absolute);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`${label}: ${file} is outside the project directory ${root}`);
  }
  return rel.split(sep).join("/");
}

// ---------------------------------------------------------------------------
// Media probing (sprite-project.mjs, extended to audio)
// ---------------------------------------------------------------------------

function ffprobeEntries(path, entries, stream = "v:0") {
  const r = spawnSync(
    "ffprobe",
    ["-v", "error", "-select_streams", stream, "-show_entries", entries, "-of", "default=noprint_wrappers=1", path],
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
 * skips the ANIM/ANMF chunks and reports 0x0. The header is a fixed layout and
 * cheaper than a decode. Returns null for anything that is not a WebP shape
 * this understands. (sprite-project.mjs `webpCanvasSize`, verbatim.)
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
  if (fourcc === "VP8X" && read >= 30) {
    return { width: head.readUIntLE(24, 3) + 1, height: head.readUIntLE(27, 3) + 1 };
  }
  if (fourcc === "VP8 " && read >= 30) {
    if (head[23] !== 0x9d || head[24] !== 0x01 || head[25] !== 0x2a) return null;
    return { width: head.readUInt16LE(26) & 0x3fff, height: head.readUInt16LE(28) & 0x3fff };
  }
  if (fourcc === "VP8L" && read >= 25 && head[20] === 0x2f) {
    const bits = head.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  return null;
}

function positive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Measure a landed file for its asset type.
 *   - image: WebP header, else ffprobe; unmeasurable THROWS — a ready image
 *     is measured or it is not ready;
 *   - video: width, height, duration, fps — best effort, with a named
 *     warning when ffprobe cannot read it;
 *   - audio: duration, sampleRate, channels — best effort, with a warning;
 *   - text: nothing to measure.
 * A missing file throws for every type: landing means the file exists.
 *
 * @returns {{ metadata: Record<string, number>, warning: string | null }}
 */
export function probeMedia(path, type) {
  if (!ASSET_TYPES.includes(type)) throw new Error(`cannot probe an asset of type '${type}'`);
  if (!existsSync(path)) throw new Error(`file not found: ${path}`);
  if (type === "text") return { metadata: {}, warning: null };

  if (type === "image") {
    const fromHeader = webpCanvasSize(path);
    if (fromHeader) return { metadata: fromHeader, warning: null };
    const probed = ffprobeEntries(path, "stream=width,height");
    const width = positive(probed?.width);
    const height = positive(probed?.height);
    if (width && height) return { metadata: { width, height }, warning: null };
    throw new Error(`ffprobe could not read the dimensions of ${path} (is ffprobe installed and the file a real image?)`);
  }

  if (type === "video") {
    const probed = ffprobeEntries(path, "stream=width,height,r_frame_rate:format=duration");
    const width = positive(probed?.width);
    const height = positive(probed?.height);
    if (!width || !height) {
      return { metadata: {}, warning: `ffprobe could not read ${basename(path)} — registered without dimensions` };
    }
    const metadata = { width, height };
    const duration = positive(probed?.duration);
    if (duration) metadata.duration = Math.round(duration * 1000) / 1000;
    const [num, den] = String(probed?.r_frame_rate ?? "").split("/").map(Number);
    if (Number.isFinite(num) && Number.isFinite(den) && den > 0 && num > 0) metadata.fps = Math.round((num / den) * 1000) / 1000;
    return { metadata, warning: null };
  }

  const probed = ffprobeEntries(path, "stream=sample_rate,channels:format=duration", "a:0");
  const duration = positive(probed?.duration);
  if (!duration) return { metadata: {}, warning: `ffprobe could not read ${basename(path)} — registered without a duration` };
  const metadata = { duration: Math.round(duration * 1000) / 1000 };
  const sampleRate = positive(probed?.sample_rate);
  if (sampleRate) metadata.sampleRate = sampleRate;
  const channels = positive(probed?.channels);
  if (channels) metadata.channels = channels;
  return { metadata, warning: null };
}

/**
 * Land `id` in `doc` from a file on disk: resolve the uri, refuse a move the
 * lifecycle does not allow BEFORE probing, measure, then `landAsset`. Throws.
 * `file` defaults to the reservation's planned uri.
 */
function landFromFile(projectPath, doc, { id, file, requestId, cost }, now) {
  const asset = doc.assets.find((a) => a.id === id);
  if (!asset) throw new Error(`no asset '${id}' — reserve it first`);
  transition(asset, "ready");
  const source = file ?? (asset.uri || null);
  if (!source) throw new Error(`'${id}' was reserved without a planned uri — pass the landed file (--file)`);
  const uri = toProjectUri(projectPath, source, "--file");
  const { metadata, warning } = probeMedia(join(dirname(resolve(projectPath)), uri), asset.type);
  const record = landAsset(doc, { id, uri, metadata, requestId, cost }, now);
  return { ...record, warning };
}

// ---------------------------------------------------------------------------
// runRegistered — record before send, then land or fail
// ---------------------------------------------------------------------------

const UNKNOWABLE = "whether it had already been billed is not knowable from here";

/**
 * Run one paid call with its record on disk the whole time:
 *
 *   1. reserve (`generating` unless `reserve.generating === false`) and save —
 *      BEFORE `call` runs; a refused reservation exits with `ERROR:` and
 *      nothing is sent;
 *   2. `call({ signal, asset, edge })` with an AbortSignal that SIGINT /
 *      SIGTERM fire (a second signal exits 130 at once);
 *   3. on success, land the returned `file` (default: the planned uri) with
 *      its `requestId` and `cost`; a file that cannot be landed is recorded
 *      as a failure with billing `unknown`, since the call itself completed;
 *   4. on a throw, record the failure: billing `none` only when
 *      `neverReached(error)` proves the request never left, otherwise
 *      `unknown`; an abort says it was cancelled and that billing is not
 *      knowable. `error.requestId` (fal-queue) is recorded when present.
 *
 * `updateSidecar(doc, phase)` runs inside each load→save, so a mode's sidecar
 * pointer moves in the same atomic write as the asset. A throw from it at the
 * reserve phase refuses the reservation; at land/fail the craft record is
 * still saved without the sidecar change, and the outcome says so.
 *
 * Returns the outcome; the caller decides the exit (`exitCode`).
 */
export async function runRegistered({
  path,
  sidecarKey,
  reserve,
  call,
  neverReached = falNeverReached,
  updateSidecar,
  signal: outerSignal,
  handleSignals = true,
  now = Date.now,
  onNote = (message) => console.error(message),
}) {
  if (typeof call !== "function") fail("runRegistered: call must be a function");
  const projectPath = resolve(path);

  // 1. Reserve and save before anything leaves.
  const doc = loadProject(projectPath, { sidecarKey });
  let reserved;
  try {
    reserved = reserveAsset(doc, { generating: true, ...reserve }, now());
    updateSidecar?.(doc, "reserve");
  } catch (error) {
    fail(`cannot reserve '${reserve?.id}': ${errorMessage(error)}`);
  }
  saveProject(projectPath, doc);
  const id = reserved.asset.id;

  // 2. Call, with interrupts turned into an abort.
  const controller = new AbortController();
  const handlers = new Map();
  let interruptedBy = null;
  if (handleSignals) {
    for (const name of ["SIGINT", "SIGTERM"]) {
      const handler = () => {
        if (interruptedBy) process.exit(130);
        interruptedBy = name;
        controller.abort(new DOMException(`received ${name}`, "AbortError"));
      };
      handlers.set(name, handler);
      process.on(name, handler);
    }
  }
  const signal = outerSignal ? AbortSignal.any([controller.signal, outerSignal]) : controller.signal;

  const record = (apply, phase) => {
    let current = loadProject(projectPath, { sidecarKey });
    const outcome = apply(current);
    let sidecarError = null;
    if (updateSidecar) {
      try {
        updateSidecar(current, phase);
      } catch (error) {
        sidecarError = errorMessage(error);
        onNote(`WARN: the sidecar update after ${phase} of '${id}' failed (${sidecarError}) — the asset is recorded; the sidecar was left as it was`);
        current = loadProject(projectPath, { sidecarKey });
        Object.assign(outcome, apply(current));
      }
    }
    saveProject(projectPath, current);
    return { ...outcome, sidecarError };
  };

  const failed = (reason, billing, requestId, error) => {
    const outcome = record((current) => failAsset(current, { id, reason, billing, requestId }, now()), "fail");
    return {
      ok: false, asset: outcome.asset, edge: outcome.edge, error, reason, billing,
      interrupted: interruptedBy, exitCode: interruptedBy ? 130 : 1, sidecarError: outcome.sidecarError,
    };
  };

  try {
    let result;
    try {
      result = await call({ signal, asset: reserved.asset, edge: reserved.edge });
    } catch (error) {
      const aborted = interruptedBy !== null || signal.aborted || error?.name === "AbortError";
      const requestId = typeof error?.requestId === "string" && error.requestId ? error.requestId : undefined;
      if (aborted) {
        return failed(`${interruptedBy ?? "aborted"} — the request was cancelled; ${UNKNOWABLE}`, "unknown", requestId, error);
      }
      const billing = neverReached(error) ? "none" : "unknown";
      return failed(errorMessage(error).slice(0, 500) || "the call failed without a message", billing, requestId, error);
    }

    const requestId = typeof result?.requestId === "string" && result.requestId ? result.requestId : undefined;
    try {
      const outcome = record(
        (current) => landFromFile(projectPath, current, { id, file: result?.file, requestId, cost: result?.cost }, now()),
        "land",
      );
      if (outcome.warning) onNote(`WARN: ${id}: ${outcome.warning}`);
      return {
        ok: true, asset: outcome.asset, edge: outcome.edge, result, warning: outcome.warning ?? null,
        sidecarError: outcome.sidecarError,
      };
    } catch (error) {
      return failed(`the call returned but its file could not be registered: ${errorMessage(error)}`.slice(0, 500), "unknown", requestId, error);
    }
  } finally {
    for (const [name, handler] of handlers) process.off(name, handler);
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const COMMON = {
  path: { type: "string" },
  at: { type: "string" },
  json: { type: "boolean", default: false },
  "sidecar-key": { type: "string" },
  help: { type: "boolean", short: "h", default: false },
};

const COST_FLAGS = { "cost-usd": { type: "string" }, "cost-basis": { type: "string" }, "cost-note": { type: "string" } };

const OPTIONS = {
  init: {
    title: { type: "string" }, width: { type: "string" }, height: { type: "string" }, fps: { type: "string" },
    aspect: { type: "string" }, force: { type: "boolean", default: false },
  },
  validate: {},
  reserve: {
    id: { type: "string" }, type: { type: "string" }, name: { type: "string" }, uri: { type: "string" },
    op: { type: "string" }, from: { type: "string", multiple: true }, model: { type: "string" },
    prompt: { type: "string" }, provider: { type: "string" }, "params-json": { type: "string" },
    generating: { type: "boolean", default: false }, actor: { type: "string" }, force: { type: "boolean", default: false },
    ...COST_FLAGS,
  },
  land: { id: { type: "string" }, file: { type: "string" }, "request-id": { type: "string" }, ...COST_FLAGS },
  fail: { id: { type: "string" }, reason: { type: "string" }, billing: { type: "string" }, "request-id": { type: "string" } },
  drop: { id: { type: "string", multiple: true } },
  show: { id: { type: "string" } },
  cost: {},
};

function requireFlag(value, flag) {
  if (value === undefined || value === "") fail(`${flag} is required`);
  return value;
}

function oneOf(value, allowed, flag) {
  if (!allowed.includes(value)) fail(`${flag}: expected one of ${allowed.join(", ")}, got '${value}'`);
  return value;
}

function num(value, flag, { integer = false, min = -Infinity } = {}) {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (value === "" || !Number.isFinite(parsed) || (integer && !Number.isInteger(parsed)) || parsed < min) {
    fail(`${flag}: expected ${integer ? "an integer" : "a number"} >= ${min}, got '${value}'`);
  }
  return parsed;
}

function idList(raw) {
  return (raw ?? []).flatMap((value) => String(value).split(",")).map((v) => v.trim()).filter(Boolean);
}

function costFlags(values, allowed) {
  const usd = values["cost-usd"];
  const basis = values["cost-basis"];
  if (usd === undefined && basis === undefined) {
    if (values["cost-note"] !== undefined) fail("--cost-note: only with --cost-usd and --cost-basis");
    return undefined;
  }
  if (usd === undefined) fail("--cost-basis: pass the number too (--cost-usd)");
  if (basis === undefined) fail(`--cost-usd: say where the number came from (--cost-basis ${allowed.join("|")})`);
  const cost = { usd: num(usd, "--cost-usd", { min: 0 }), basis: oneOf(basis, allowed, "--cost-basis") };
  if (values["cost-note"] !== undefined) cost.note = values["cost-note"];
  return cost;
}

function emit(values, payload, humanLines) {
  if (values.json) console.log(JSON.stringify(payload));
  else console.log(humanLines.join("\n"));
}

function guard(fn) {
  try {
    return fn();
  } catch (error) {
    return fail(errorMessage(error));
  }
}

function money(usd) {
  return `$${usd.toFixed(usd < 1 ? 4 : 2)}`;
}

/** Run one CLI command. Refusals exit 1 with `ERROR:`; success returns. */
export function main(argv = process.argv.slice(2)) {
  if (!argv.length || argv[0] === "--help" || argv[0] === "-h") {
    console.log(USAGE);
    return;
  }
  const command = argv[0];
  if (!SUBCOMMANDS.includes(command)) {
    console.error(`ERROR: unknown command '${command}'. Expected one of: ${SUBCOMMANDS.join(", ")}`);
    console.error(USAGE);
    process.exit(1);
  }
  let parsed;
  try {
    parsed = parseArgs({ args: argv.slice(1), options: { ...COMMON, ...OPTIONS[command] }, allowPositionals: false, strict: true });
  } catch (error) {
    fail(`${command}: ${errorMessage(error)}`);
  }
  const values = parsed.values;
  if (values.help) {
    console.log(USAGE);
    return;
  }

  const path = resolve(requireFlag(values.path, "--path"));
  const sidecarKey = values["sidecar-key"];
  const now = values.at === undefined ? Date.now() : num(values.at, "--at", { integer: true, min: 0 });

  switch (command) {
    case "init": {
      const title = requireFlag(values.title, "--title");
      const key = requireFlag(sidecarKey, "--sidecar-key");
      if (existsSync(path) && !values.force) fail(`${path} already exists — pass --force to overwrite it`);
      const doc = guard(() => emptyProject({
        title,
        sidecarKey: key,
        settings: {
          width: num(values.width, "--width", { min: 1 }),
          height: num(values.height, "--height", { min: 1 }),
          fps: num(values.fps, "--fps", { min: 1 }),
          aspectRatio: values.aspect,
        },
      }));
      try {
        mkdirSync(dirname(path), { recursive: true });
      } catch (error) {
        fail(`--path: cannot create ${dirname(path)}: ${errorMessage(error)}`);
      }
      saveProject(path, doc);
      const s = doc.composition.settings;
      emit(values, { path, title, sidecarKey: key, settings: s },
        [`created ${path} (${s.width}x${s.height}, ${s.fps} fps, ${s.aspectRatio}; sidecar '${key}')`]);
      return;
    }

    case "validate": {
      const doc = loadProject(path, { sidecarKey });
      emit(values, { ok: true, path, assets: doc.assets.length, provenance: doc.provenance.length },
        [`valid: ${path} — ${doc.assets.length} assets, ${doc.provenance.length} edges`]);
      return;
    }

    case "reserve": {
      const doc = loadProject(path, { sidecarKey });
      const id = requireFlag(values.id, "--id");
      const type = oneOf(requireFlag(values.type, "--type"), ASSET_TYPES, "--type");
      const op = oneOf(requireFlag(values.op, "--op"), RESERVE_OPS, "--op");
      const name = requireFlag(values.name, "--name");
      const actor = values.actor === undefined ? undefined : oneOf(values.actor, ACTORS, "--actor");
      const uri = values.uri === undefined ? undefined : guard(() => toProjectUri(path, values.uri, "--uri"));
      let params;
      if (values["params-json"] !== undefined) {
        try {
          params = JSON.parse(values["params-json"]);
        } catch (error) {
          fail(`--params-json: not valid JSON: ${errorMessage(error)}`);
        }
        if (typeof params !== "object" || params === null || Array.isArray(params)) fail("--params-json: expected a JSON object");
      }
      const from = values.from === undefined ? undefined : idList(values.from);
      const cost = costFlags(values, ["estimate", "table"]);
      const recorded = guard(() => reserveAsset(doc, {
        id, type, name, op, uri, from, actor, params, cost,
        model: values.model, prompt: values.prompt, provider: values.provider,
        generating: values.generating, force: values.force,
      }, now));
      saveProject(path, doc);
      emit(values, recorded, [
        `reserved ${id} (${recorded.asset.status}) → ${recorded.asset.uri || "no uri yet"}`
        + (cost ? ` — ${cost.basis} ${money(cost.usd)}` : ""),
      ]);
      return;
    }

    case "land": {
      const doc = loadProject(path, { sidecarKey });
      const id = requireFlag(values.id, "--id");
      const cost = costFlags(values, COST_BASES);
      const recorded = guard(() => landFromFile(path, doc, { id, file: values.file, requestId: values["request-id"], cost }, now));
      saveProject(path, doc);
      const { asset, edge, warning } = recorded;
      const size = asset.metadata.width ? ` (${asset.metadata.width}x${asset.metadata.height})` : "";
      emit(values, { asset, edge, warning }, [`landed ${id} → ${asset.uri}${size}`]);
      if (warning) console.error(`WARN: ${id}: ${warning}`);
      return;
    }

    case "fail": {
      const doc = loadProject(path, { sidecarKey });
      const id = requireFlag(values.id, "--id");
      const reason = requireFlag(values.reason, "--reason");
      const billing = oneOf(requireFlag(values.billing, "--billing"), BILLINGS, "--billing");
      const recorded = guard(() => failAsset(doc, { id, reason, billing, requestId: values["request-id"] }, now));
      saveProject(path, doc);
      emit(values, recorded, [`failed ${id} (billing ${billing}): ${reason}`]);
      return;
    }

    case "drop": {
      const doc = loadProject(path, { sidecarKey });
      const ids = idList(values.id);
      if (!ids.length) fail("--id is required");
      const unknown = ids.filter((id) => !doc.assets.some((a) => a.id === id));
      if (unknown.length) fail(`--id: no asset ${unknown.map((id) => `'${id}'`).join(", ")} in this project`);
      dropAssets(doc, ids);
      saveProject(path, doc);
      emit(values, { dropped: ids }, [`dropped ${ids.join(", ")} (the sidecar is the mode's to update)`]);
      return;
    }

    case "show": {
      const doc = loadProject(path, { sidecarKey });
      if (values.id !== undefined) {
        const asset = doc.assets.find((a) => a.id === values.id);
        if (!asset) fail(`--id: no asset '${values.id}' in this project`);
        const edge = doc.provenance.find((e) => e.toAssetId === values.id) ?? null;
        emit(values, { asset, edge }, [JSON.stringify({ asset, edge }, null, 2)]);
        return;
      }
      const byStatus = { pending: 0, generating: 0, ready: 0, failed: 0 };
      for (const asset of doc.assets) byStatus[statusOf(asset)] += 1;
      const assets = doc.assets.map((a) => ({ id: a.id, type: a.type, status: statusOf(a), uri: a.uri }));
      emit(values, { path, title: doc.title, assets, byStatus }, [
        `${doc.title} — ${doc.assets.length} assets (${Object.entries(byStatus).filter(([, n]) => n).map(([s, n]) => `${n} ${s}`).join(", ") || "none"})`,
        ...assets.map((a) => `  ${a.id}  ${a.type}  ${a.status}  ${a.uri || "-"}`),
      ]);
      return;
    }

    case "cost": {
      const doc = loadProject(path, { sidecarKey });
      const summary = summarizeCosts(doc);
      const parts = COST_BASES.filter((b) => summary.byBasis[b]).map((b) => `${b} ${money(summary.byBasis[b])}`);
      emit(values, summary, [
        `total ${money(summary.total)}${parts.length ? ` (${parts.join(", ")})` : ""} over ${summary.calls} call(s), ${summary.priced} priced`,
        ...(summary.unpriced.length ? [`unpriced (not free): ${summary.unpriced.join(", ")}`] : []),
        ...(summary.uncertain.length ? [`failed, billing unknown: ${summary.uncertain.join(", ")}`] : []),
        ...(summary.notBilled.length ? [`failed before sending (not billed): ${summary.notBilled.join(", ")}`] : []),
        ...(summary.inFlight.length ? [`in flight: ${summary.inFlight.join(", ")}`] : []),
      ]);
      return;
    }
  }
}

const isMain = import.meta.main ?? (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url));
if (isMain) main();

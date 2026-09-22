#!/usr/bin/env node
/**
 * previz.mjs — the only writer of `backlot.json` and every `shot.json`.
 *
 * The practice this mode automates is: block the shot in 3D first, then let a
 * video model paint the look on top of it. That practice has exactly two
 * places where an agent's judgement is worth paying for — the shot plan and
 * the Blender scene — and a long tail of steps that must be identical every
 * time: frame arithmetic, encoding, probing, the acceptance record, the
 * take-policy gate, the price of a paid job. This script owns the tail.
 *
 * Contract:
 *  - every subcommand prints EXACTLY ONE JSON object on stdout and exits 0;
 *  - progress, warnings and every line ffmpeg or Blender printed go to stderr;
 *  - a refusal prints one `ERROR: …` line on stderr and exits non-zero,
 *    leaving the shot exactly as it was. `generate` is the one exception: a
 *    take whose request already left this machine is RECORDED before the
 *    process exits non-zero, and its object is printed, because a paid job
 *    that nobody wrote down is the worst outcome available here.
 *  - `--json` is accepted everywhere and is already the default.
 *
 * The agent authors prose (`shot-plan.md`, `prompts.md`, `comparison.md`) and
 * the Blender script (`greybox/scene.py`). The viewer only reads. Nothing but
 * this script writes the two JSON files.
 *
 * Zero npm dependencies: Node 20+ built-ins, plus the external tools it
 * reports on — Blender, ffmpeg, ffprobe — and fal.ai for a take.
 */

import { spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import {
  evenlySpacedTimes,
  evenSize,
  firstFrameFrom,
  frameAtTime,
  gridFor,
  hasDrawtext,
  lastFrameBefore,
  parseProbe,
  parseRange,
  parseSceneCuts,
  parseTimeList,
  pngSize,
  previewSize,
  probeMismatches,
  snapSeconds,
  stamp,
  stripFrames,
  timeOfFrame,
} from "./media.mjs";
import { PRICED_RESOLUTIONS, PRICES, priceTake, summarizeTakeCosts } from "./prices.mjs";
import {
  findProjectRoot,
  gateRefusal,
  lastJsonObject,
  projectGate,
  PROJECT_FILE,
  projectPathOf,
  readManifest,
  relFromProject,
  runNodeScript,
  sharedScript,
  SHOT_FILE,
  shotPathOf,
  styleKeyframe,
} from "./project.mjs";
import {
  checkTargets,
  CHECK_STATUSES,
  computeStuck,
  CONDITIONINGS,
  conditioningOf,
  DEFAULT_SPEC,
  ENTRIES,
  hasSpokenLine,
  LINE_KINDS,
  makeContinuity,
  makeSpec,
  makeTrim,
  newShot,
  nextStage,
  nextTakeId,
  normalizeShot,
  parsePromptPack,
  parsePromptTimeline,
  parseSize,
  PROMPT_TEMPLATE_BODY,
  recordCheck,
  seedChecklist,
  shotStatus,
  slugId,
  spokenLines,
  summarizeChecks,
  takePolicy,
  timelineProblems,
  transcriptCoverage,
  usesGreybox,
  validateBeats,
  validateLines,
  validatePromptRefs,
  validateReferenceAssignments,
} from "./shot.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT_DIR = join(HERE, "blender");
const STARTER_DIR = join(HERE, "scene-starter");

const SUBCOMMANDS = [
  "doctor", "meta", "beats", "board", "lines", "vo", "reference", "render",
  "anchor", "lineup", "sheet", "compare", "check", "checklist",
  "prompt-skeleton", "generate", "select", "status",
];

/** Moved to `backlot.mjs` when the shot grew a film around it. A refusal
 *  that names the new command costs one round trip; a second writer of
 *  `backlot.json` costs a corrupted film. */
const MOVED = {
  init: 'backlot.mjs init <project> --title "…" --logline "…"',
  shot: 'backlot.mjs shot add <project> <id> --title "…"',
};

const DEFAULT_RENDER_TIMEOUT_S = 900;
const KILL_GRACE_MS = 5000;
/** A contact sheet tile, in pixels wide. Big enough to see a hand on a
 *  button, small enough that a 48-frame strip is still an openable PNG. */
const TILE_WIDTH = 480;

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

function fail(message, code = 1) {
  process.stderr.write(`ERROR: ${message}\n`);
  process.exit(code);
}

function note(message) {
  process.stderr.write(`${message}\n`);
}

function emit(payload) {
  process.stdout.write(`${JSON.stringify({ ok: true, ...payload }, null, 2)}\n`);
  return 0;
}

/** Absolute, relative to the CURRENT directory — this script never cds. */
function resolveInput(path) {
  return isAbsolute(path) ? path : resolve(process.cwd(), path);
}

function relPath(dir, absolute) {
  return relative(dir, absolute).split(sep).join("/");
}

function readJson(path, label) {
  let text;
  try {
    text = readFileSync(path, "utf-8");
  } catch (error) {
    fail(`${label}: cannot read ${path} (${error.message})`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`${label}: ${path} is not valid JSON (${error.message})`);
  }
}

/** Scratch + rename: the viewer polls these files while a render runs, so it
 *  must never observe a half-written one. The scratch name carries the pid
 *  because a `check` and a landing take can be two processes writing the same
 *  file within the same millisecond. */
function writeJsonAtomic(path, value) {
  const scratch = `${path}.${process.pid}.tmp`;
  mkdirSync(dirname(path), { recursive: true });
  try {
    writeFileSync(scratch, `${JSON.stringify(value, null, 2)}\n`);
    renameSync(scratch, path);
  } catch (error) {
    try { rmSync(scratch, { force: true }); } catch { /* never created */ }
    fail(`cannot write ${path}: ${error.message}`);
  }
}

const SHOT_KEYS = [
  "version", "id", "title", "scene", "characters", "set", "entry", "conditioning",
  "spec", "assumptions", "beats", "trim", "continuity", "board", "anchors", "lines",
  "reference", "greybox", "checks", "stuck", "prompt", "takes",
];

function inKeyOrder(value, keys) {
  const ordered = {};
  for (const key of keys) if (value[key] !== undefined) ordered[key] = value[key];
  for (const key of Object.keys(value)) if (ordered[key] === undefined) ordered[key] = value[key];
  return ordered;
}

function projectPath(dir) {
  return projectPathOf(dir);
}

function shotPath(dir) {
  return shotPathOf(dir);
}

/** The project a shot belongs to, with its defaults filled in. Read-only
 *  here: `backlot.mjs` is the only writer of `backlot.json`. */
function loadProject(dir) {
  let doc;
  try {
    doc = readManifest(dir);
  } catch (error) {
    return fail(error.message);
  }
  doc.defaults = { ...DEFAULT_SPEC, ...(doc.defaults ?? {}) };
  return doc;
}

function loadShot(dir) {
  const path = shotPath(dir);
  if (!existsSync(path)) fail(`no ${SHOT_FILE} in ${dir} — is that a shot directory? (backlot.mjs shot add <project> <id> --title "…")`);
  try {
    return normalizeShot(readJson(path, SHOT_FILE));
  } catch (error) {
    return fail(`${path}: ${error.message}`);
  }
}

function saveShot(dir, shot) {
  shot.stuck = computeStuck(shot.checks ?? []);
  writeJsonAtomic(shotPath(dir), inKeyOrder(shot, SHOT_KEYS));
  return shot;
}

/**
 * Write one command's delta into whatever `shot.json` says RIGHT NOW.
 *
 * No command may hold shot state across a long external call. Blender runs
 * for minutes and a fal take for five; an agent records checks and looks at
 * sheets in that window, and writing back the copy this process read at
 * startup silently erases them — a `check --status pass` that answered `ok`
 * mid-generation, gone the moment the take landed.
 *
 * So: re-read, apply only this command's own fields, save. `apply` receives
 * the fresh document and may `fail()`; nothing is written when it does.
 */
function commitShot(dir, apply) {
  const fresh = loadShot(dir);
  const result = apply(fresh);
  saveShot(dir, fresh);
  return { shot: fresh, result };
}

function nowStamp(opts) {
  if (opts.now === undefined) return new Date().toISOString();
  const parsed = Date.parse(opts.now);
  if (!Number.isFinite(parsed)) fail(`--now must be an ISO-8601 timestamp, got "${opts.now}"`);
  return new Date(parsed).toISOString();
}

// ---------------------------------------------------------------------------
// Finding the tools
// ---------------------------------------------------------------------------

function isFile(path) {
  try { return statSync(path).isFile(); } catch { return false; }
}

function pathCandidates(executable) {
  const name = process.platform === "win32" ? `${executable}.exe` : executable;
  const extra = process.platform === "darwin" ? ["/opt/homebrew/bin", "/usr/local/bin"] : ["/usr/bin", "/usr/local/bin"];
  return [...(process.env.PATH ?? "").split(delimiter), ...extra]
    .filter(Boolean)
    .map((dir) => join(dir, name))
    .filter(isFile);
}

const VERSION_PATTERN = {
  blender: /Blender\s+(\d+\.\d+(?:\.\d+)?)/,
  ffmpeg: /ffmpeg version (\S+)/,
  ffprobe: /ffprobe version (\S+)/,
};

/** Ask a candidate what it is. A path that exists proves nothing: a stale
 *  symlink, a wrapper script and a half-installed app bundle all exist. */
function probeVersion(candidate, pattern) {
  const result = spawnSync(candidate, ["--version"], { encoding: "utf-8", timeout: 20_000 });
  if (result.error) return { ok: false, reason: result.error.message };
  const text = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const match = pattern.exec(text);
  if (!match) return { ok: false, reason: `--version did not identify it (${JSON.stringify(text.split("\n")[0]?.slice(0, 100) ?? "")})` };
  return { ok: true, version: match[1] };
}

/**
 * Where Blender installs itself when nobody put it on PATH — the normal case
 * on macOS and Windows, where the installer never touches PATH.
 * `PREVIZ_BLENDER_APP_PATHS` replaces the list, which is how a test can assert
 * "nothing found" on a machine that does have Blender.
 */
function blenderPlatformCandidates() {
  const override = process.env.PREVIZ_BLENDER_APP_PATHS;
  if (override !== undefined) return override.split(delimiter).filter(Boolean);
  if (process.platform === "darwin") {
    return [
      "/Applications/Blender.app/Contents/MacOS/Blender",
      join(homedir(), "Applications/Blender.app/Contents/MacOS/Blender"),
    ];
  }
  if (process.platform === "win32") {
    const found = [];
    for (const root of [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]].filter(Boolean)) {
      const foundation = join(root, "Blender Foundation");
      if (!existsSync(foundation)) continue;
      for (const entry of safeReaddir(foundation)) found.push(join(foundation, entry, "blender.exe"));
    }
    return found;
  }
  return ["/usr/bin/blender", "/snap/bin/blender", "/opt/blender/blender"];
}

/** Newest-looking install first, so a machine with two Blenders picks the
 *  later one rather than whichever the filesystem listed first. */
function safeReaddir(dir) {
  try { return readdirSync(dir).sort().reverse(); } catch { return []; }
}

/**
 * `--blender` / `$BLENDER_PATH` → PATH → the platform's install locations.
 * Every step is recorded, including the skipped ones, so `doctor` can show
 * the whole search rather than a bare "not found".
 */
function resolveBlender(flagPath) {
  const steps = [];
  const tryCandidate = (source, candidate) => {
    if (!candidate) return null;
    const expanded = isAbsolute(candidate) ? candidate : resolve(candidate);
    if (!isFile(expanded)) {
      steps.push({ source, candidate: expanded, status: "missing" });
      return null;
    }
    const probe = probeVersion(expanded, VERSION_PATTERN.blender);
    if (!probe.ok) {
      steps.push({ source, candidate: expanded, status: "not-blender", reason: probe.reason });
      return null;
    }
    steps.push({ source, candidate: expanded, status: "ok", version: probe.version });
    return { found: true, path: expanded, version: probe.version, source, steps };
  };

  if (flagPath) {
    const hit = tryCandidate("flag", flagPath);
    if (hit) return hit;
    const last = steps[steps.length - 1];
    // An explicit --blender that does not work is a refusal, not a reason to
    // silently render with some other Blender the machine happens to have.
    fail(`--blender ${flagPath} is not a working Blender (${last.status}${last.reason ? `: ${last.reason}` : ""})`);
  } else {
    steps.push({ source: "flag", candidate: null, status: "not-given" });
  }
  if (process.env.BLENDER_PATH) {
    const hit = tryCandidate("env", process.env.BLENDER_PATH);
    if (hit) return hit;
  } else {
    steps.push({ source: "env", candidate: null, status: "not-set" });
  }
  const onPath = pathCandidates("blender");
  if (!onPath.length) steps.push({ source: "path", candidate: null, status: "not-on-path" });
  for (const candidate of onPath) {
    const hit = tryCandidate("path", candidate);
    if (hit) return hit;
  }
  const platform = blenderPlatformCandidates();
  if (!platform.length) steps.push({ source: "platform", candidate: null, status: "no-candidates" });
  for (const candidate of platform) {
    const hit = tryCandidate("platform", candidate);
    if (hit) return hit;
  }
  return { found: false, path: null, version: null, source: null, steps };
}

function requireBlender(flagPath) {
  const found = resolveBlender(flagPath);
  if (!found.found) {
    const looked = found.steps.filter((step) => step.candidate).map((step) => `  ${step.source}: ${step.candidate} (${step.status})`).join("\n");
    fail(`no Blender found. Install it, or point --blender / $BLENDER_PATH at it.${looked ? `\nLooked at:\n${looked}` : ""}`);
  }
  return found;
}

const toolCache = new Map();

/** ffmpeg / ffprobe: `$FFMPEG_PATH` / `$FFPROBE_PATH` first, then PATH. */
function resolveTool(name) {
  if (toolCache.has(name)) return toolCache.get(name);
  const pattern = VERSION_PATTERN[name] ?? new RegExp(`${name} version (\\S+)`);
  const candidates = [process.env[`${name.toUpperCase()}_PATH`], ...pathCandidates(name)].filter(Boolean);
  let answer = { found: false, path: null, version: null };
  for (const candidate of candidates) {
    if (!isFile(candidate)) continue;
    const probe = probeVersion(candidate, pattern);
    if (!probe.ok) continue;
    answer = { found: true, path: candidate, version: probe.version };
    break;
  }
  toolCache.set(name, answer);
  return answer;
}

function requireTool(name) {
  const tool = resolveTool(name);
  if (!tool.found) fail(`${name} not found on PATH (nor at $${name.toUpperCase()}_PATH) — install ffmpeg and try again`);
  return tool;
}

/** Whether a fal key is reachable. The key itself is never read into a
 *  printable place and never appears in any output of this script. */
async function falKeyPresent() {
  if (process.env.FAL_KEY) return { present: true, source: "FAL_KEY" };
  try {
    const shared = await importShared();
    return { present: Boolean(shared.loadFalKey()), source: shared.loadFalKey() ? ".env" : null };
  } catch {
    return { present: false, source: null };
  }
}

/**
 * The shared Seedance script.
 *
 * An installed session keeps shared scripts beside this CLI (the manifest
 * lists `seedance-video.mjs` and `fal-queue.mjs` in `skill.sharedScripts`); a
 * source checkout resolves the same modules from `modes/_shared/scripts/`.
 * Exported so a test can pin which copy it would exercise.
 *
 * `PREVIZ_SEEDANCE_MODULE` replaces it with a local module: it is how the
 * concurrency tests run a take that "takes minutes" without sending anything
 * to fal, and every run that uses it says so on stderr — a clip made by
 * something other than Seedance must never be mistaken for one that was.
 */
const installedShared = new URL("./seedance-video.mjs", import.meta.url);
export const SEEDANCE_URL = process.env.PREVIZ_SEEDANCE_MODULE
  ? pathToFileURL(resolveInput(process.env.PREVIZ_SEEDANCE_MODULE)).href
  : existsSync(installedShared)
    ? installedShared.href
    : new URL("../../../_shared/scripts/seedance-video.mjs", import.meta.url).href;

const installedQueue = new URL("./fal-queue.mjs", import.meta.url);
export const FAL_QUEUE_URL = existsSync(installedQueue)
  ? installedQueue.href
  : new URL("../../../_shared/scripts/fal-queue.mjs", import.meta.url).href;

async function importShared() {
  if (process.env.PREVIZ_SEEDANCE_MODULE) {
    note(`WARN: PREVIZ_SEEDANCE_MODULE is set — takes come from ${SEEDANCE_URL}, not from Seedance`);
  }
  const [seedance, queue] = await Promise.all([import(SEEDANCE_URL), import(FAL_QUEUE_URL)]);
  return { generateSeedanceVideo: seedance.generateSeedanceVideo, SEEDANCE_MODEL: seedance.SEEDANCE_MODEL, loadFalKey: queue.loadFalKey };
}

// ---------------------------------------------------------------------------
// Running the tools
// ---------------------------------------------------------------------------

/** One ffmpeg/ffprobe pass. Short, bounded, and its output is data. */
function runTool(path, args, { timeoutMs = 180_000, label = basename(path) } = {}) {
  const result = spawnSync(path, args, { encoding: "utf-8", timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
  if (result.error) return { code: 127, stdout: "", stderr: result.error.message, label };
  return { code: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "", label };
}

function runToolOrFail(path, args, options = {}) {
  const result = runTool(path, args, options);
  if (result.code !== 0) {
    fail(`${result.label} failed (exit ${result.code}):\n${tail(result.stderr)}\ncommand: ${basename(path)} ${args.join(" ")}`);
  }
  return result;
}

function tail(text, lines = 20) {
  return String(text ?? "").split("\n").filter(Boolean).slice(-lines).join("\n");
}

/** Prefix whole lines, holding the tail until its newline arrives. */
function linePrefixer(prefix, write) {
  let pending = "";
  return {
    push(chunk) {
      pending += chunk;
      const parts = pending.split("\n");
      pending = parts.pop() ?? "";
      for (const line of parts) write(`${prefix}${line}\n`);
    },
    flush() {
      if (pending) { write(`${prefix}${pending}\n`); pending = ""; }
    },
  };
}

/**
 * Run one scene script under headless Blender.
 *
 * `--factory-startup` keeps a developer's add-ons, themes and unit settings
 * out of the result: the same scene.py must render the same way on every
 * machine. `--python-expr` runs before `--python` (Blender executes them in
 * command-line order) and is the only way to put the kit on `sys.path` —
 * Blender's embedded Python ignores $PYTHONPATH unless started with
 * `--python-use-system-env`, which would drag in exactly what
 * `--factory-startup` is here to keep out. `dont_write_bytecode` stops the
 * first `import previz_kit` from dropping a `__pycache__/` into the installed
 * skill directory.
 */
function runBlenderScene({ blender, script, args, timeoutMs }) {
  return new Promise((done) => {
    const setup = `import sys; sys.dont_write_bytecode = True; sys.path.insert(0, ${JSON.stringify(KIT_DIR)})`;
    const argv = ["--background", "--factory-startup", "--python-expr", setup, "--python", script, "--", ...args];
    const started = Date.now();
    const child = spawn(blender, argv, { stdio: ["ignore", "pipe", "pipe"] });
    const collected = { stdout: "", stderr: "" };
    let timedOut = false;
    const out = linePrefixer("[blender] ", (line) => process.stderr.write(line));

    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (chunk) => { collected.stdout += chunk; out.push(chunk); });
    child.stderr.on("data", (chunk) => { collected.stderr += chunk; out.push(chunk); });

    let killer = null;
    const timer = setTimeout(() => {
      timedOut = true;
      process.stderr.write(`[blender] timed out after ${Math.round(timeoutMs / 1000)}s — sending SIGTERM\n`);
      child.kill("SIGTERM");
      killer = setTimeout(() => { process.stderr.write("[blender] still running — SIGKILL\n"); child.kill("SIGKILL"); }, KILL_GRACE_MS);
    }, timeoutMs);

    const finish = (code) => {
      clearTimeout(timer);
      if (killer) clearTimeout(killer);
      out.flush();
      done({ code, timedOut, ...collected, durationMs: Date.now() - started });
    };
    child.on("error", (error) => { collected.stderr += `\n${error.message}`; finish(127); });
    child.on("close", (code) => finish(code === null ? (timedOut ? 124 : 1) : code));
  });
}

/** Pull the kit's one-line `[previz] summary {...}` out of the Blender log. */
function parseKitSummary(text) {
  const marker = "[previz] summary ";
  const line = String(text ?? "").split("\n").filter((entry) => entry.includes(marker)).pop();
  if (!line) return null;
  try { return JSON.parse(line.slice(line.indexOf(marker) + marker.length)); } catch { return null; }
}

// ---------------------------------------------------------------------------
// ffprobe / ffmpeg work
// ---------------------------------------------------------------------------

function probeVideo(file, { counted = true } = {}) {
  const ffprobe = requireTool("ffprobe");
  const args = ["-v", "error", "-print_format", "json", "-show_streams", "-show_format"];
  if (counted) args.push("-count_frames");
  args.push(file);
  const result = runToolOrFail(ffprobe.path, args, { label: "ffprobe" });
  let doc;
  try { doc = JSON.parse(result.stdout); } catch (error) { return fail(`ffprobe did not print JSON for ${file}: ${error.message}`); }
  const bytes = existsSync(file) ? statSync(file).size : null;
  const probe = parseProbe(doc, { bytes });
  if (!probe) fail(`${file} carries no video stream`);
  return probe;
}

/** A full decode of the encoded file: a container that opens is not a file
 *  that plays, and the greybox is what the paid model will be shown. */
function decodeCheck(file) {
  const ffmpeg = requireTool("ffmpeg");
  const result = runTool(ffmpeg.path, ["-v", "error", "-i", file, "-f", "null", "-"], { label: "ffmpeg decode check" });
  if (result.code !== 0 || result.stderr.trim()) {
    fail(`the encoded file does not decode cleanly: ${file}\n${tail(result.stderr)}`);
  }
}

let drawtextAnswer = null;

function drawtextSupported() {
  if (drawtextAnswer !== null) return drawtextAnswer;
  const ffmpeg = resolveTool("ffmpeg");
  if (!ffmpeg.found) { drawtextAnswer = { ok: false, reason: "ffmpeg not found" }; return drawtextAnswer; }
  const listing = runTool(ffmpeg.path, ["-v", "quiet", "-filters"], { label: "ffmpeg -filters" });
  drawtextAnswer = hasDrawtext(listing.stdout)
    ? { ok: true, reason: null }
    : { ok: false, reason: "this ffmpeg build has no drawtext filter (built without libfreetype) — tiles are unlabelled" };
  return drawtextAnswer;
}

const FONT_CANDIDATES = [
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  "/System/Library/Fonts/Helvetica.ttc",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/TTF/DejaVuSans.ttf",
  "C:/Windows/Fonts/arial.ttf",
];

function fontFile() {
  return FONT_CANDIDATES.find(isFile) ?? null;
}

/**
 * ffmpeg filter-syntax escaping for ONE EXPRESSION BODY.
 *
 * A comma separates filters in a graph, so a comma inside `eq(n,3)` has to
 * carry a backslash even inside quotes. Applying this to a whole filtergraph
 * escapes the separators as well and the graph stops parsing, so every call
 * below wraps exactly the expression and nothing around it.
 */
function escapeExpr(expression) {
  return String(expression).replace(/,/g, "\\,");
}

function escapeText(text) {
  return String(text).replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\u2019").replace(/%/g, "\\%");
}

/**
 * Extract the listed 1-based frames from a clip in ONE decode pass.
 *
 * `select='eq(n\,3)+eq(n\,10)'` sums to non-zero on either frame, which is
 * how ffmpeg spells "or" here, and `-fps_mode passthrough` stops it from
 * duplicating frames to keep a constant rate. Output numbering follows the
 * selection order, so the frames go in ascending.
 *
 * `width: null` keeps the source resolution — a frame that is about to be a
 * REFERENCE for a paid job (the hand-off frame, an anchor's composition)
 * must not be handed over at contact-sheet size.
 */
function extractFrames(file, frames, outDir, { width = TILE_WIDTH } = {}) {
  const ffmpeg = requireTool("ffmpeg");
  mkdirSync(outDir, { recursive: true });
  const ordered = [...new Set(frames)].sort((a, b) => a - b);
  const select = ordered.map((frame) => `eq(n\\,${frame - 1})`).join("+");
  const filter = [`select='${select}'`, ...(width ? [`scale=${width}:-2:flags=bicubic`] : [])].join(",");
  runToolOrFail(
    ffmpeg.path,
    ["-y", "-v", "error", "-i", file, "-vf", filter, "-fps_mode", "passthrough", "-frames:v", String(ordered.length), join(outDir, "tile_%03d.png")],
    { label: "ffmpeg frame extract" },
  );
  return ordered.map((frame, index) => ({ frame, path: join(outDir, `tile_${String(index + 1).padStart(3, "0")}.png`) }));
}

/**
 * ONE frame of a clip, at its own resolution, landed at `outPath`.
 *
 * `scratchIn` is the directory the scratch is cut in — this shot's, whatever
 * clip the frame came from, because a hand-off reads the shot BEFORE it and
 * must not leave scratch behind in somebody else's directory.
 */
function extractOneFrame(scratchIn, file, frame, outPath, { width = null, scratch = "frame" } = {}) {
  const work = scratchDir(scratchIn, scratch);
  try {
    const [tile] = extractFrames(file, [frame], work, { width });
    if (!tile || !existsSync(tile.path)) fail(`ffmpeg produced no frame ${frame} of ${file}`);
    mkdirSync(dirname(outPath), { recursive: true });
    copyFileSync(tile.path, outPath);
    return outPath;
  } finally {
    dropScratch(scratchIn);
  }
}

/** Burn the timestamp into a tile. Returns false when this ffmpeg cannot —
 *  the caller drops labels for the whole sheet and says so in its JSON. */
function labelTile(path, text) {
  const support = drawtextSupported();
  if (!support.ok) return false;
  const ffmpeg = requireTool("ffmpeg");
  const font = fontFile();
  const draw = [
    `text='${escapeText(text)}'`,
    font ? `fontfile='${escapeText(font)}'` : "",
    "fontsize=22",
    "fontcolor=white",
    "box=1",
    "boxcolor=0x000000@0.66",
    "boxborderw=8",
    "x=10",
    "y=h-th-10",
  ].filter(Boolean).join(":");
  const staged = `${path}.labelled.png`;
  const result = runTool(ffmpeg.path, ["-y", "-v", "error", "-i", path, "-vf", `drawtext=${draw}`, "-frames:v", "1", staged], { label: "ffmpeg drawtext" });
  if (result.code !== 0 || !existsSync(staged)) {
    drawtextAnswer = { ok: false, reason: `drawtext failed on this build: ${tail(result.stderr, 2) || "no output"}` };
    try { rmSync(staged, { force: true }); } catch { /* never created */ }
    return false;
  }
  renameSync(staged, path);
  return true;
}

/**
 * Lay out one directory of `tile_%03d.png` in a grid.
 *
 * The tiles all share a width by construction (the extract pass scaled them),
 * and ffmpeg's `tile` flushes a partial grid at end of input, so a sheet
 * whose count does not fill the last row still comes out.
 */
function tileInto(tileDir, outPath, { cols, rows }) {
  const ffmpeg = requireTool("ffmpeg");
  mkdirSync(dirname(outPath), { recursive: true });
  runToolOrFail(
    ffmpeg.path,
    ["-y", "-v", "error", "-framerate", "1", "-start_number", "1", "-i", join(tileDir, "tile_%03d.png"),
      "-vf", `tile=${cols}x${rows}:padding=6:margin=6:color=0x111113`,
      "-frames:v", "1", outPath],
    { label: "ffmpeg tile" },
  );
  return outPath;
}

function scratchDir(dir, name) {
  const path = join(dir, ".previz-scratch", name);
  rmSync(path, { recursive: true, force: true });
  mkdirSync(path, { recursive: true });
  return path;
}

function dropScratch(dir) {
  rmSync(join(dir, ".previz-scratch"), { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Lanes
// ---------------------------------------------------------------------------

/** Which file a lane name plays, and what to call it in a report. */
function laneFile(dir, shot, lane) {
  const greybox = shot.greybox ?? {};
  if (lane === "greybox") {
    const record = greybox.final ?? greybox.preview;
    // A free shot is not conditioned on a block, so "compare it with the
    // greybox" is a question about a file that was never meant to exist.
    // Say that, rather than sending the agent off to render one.
    if (!record && !usesGreybox(shot)) {
      fail(
        "this shot is conditioned FREE: no greybox was sent to the model and none has been rendered, so there is " +
          "nothing to compare the take against. The plan's beats are the reference — look at the take itself " +
          "('previz.mjs sheet <shot-dir> --lane <take> --strip <from>,<to>'). Render one with 'previz.mjs render " +
          "<shot-dir>' only if you want the reel to show a stand-in.",
      );
    }
    if (!record) fail("the greybox has never been rendered — run 'previz.mjs render <shot-dir> --preview'");
    return { lane, file: join(dir, record.file), rel: record.file, probe: record.probe, label: greybox.final ? "greybox" : "greybox (preview)" };
  }
  if (lane === "preview") {
    if (!greybox.preview) fail("there is no greybox preview — run 'previz.mjs render <shot-dir> --preview'");
    return { lane, file: join(dir, greybox.preview.file), rel: greybox.preview.file, probe: greybox.preview.probe, label: "greybox preview" };
  }
  if (lane === "reference") {
    if (!shot.reference?.file) fail("this shot has no reference segment — run 'previz.mjs reference <shot-dir> <video>'");
    return { lane, file: join(dir, shot.reference.file), rel: shot.reference.file, probe: shot.reference.probe, label: "reference" };
  }
  const take = (shot.takes ?? []).find((entry) => entry.id === lane);
  if (!take) fail(`unknown lane "${lane}" (expected greybox, preview, reference, or a take id: ${(shot.takes ?? []).map((t) => t.id).join(", ") || "none recorded"})`);
  if (take.status !== "done" || !take.file) fail(`${lane} is "${take.status}" and has no file to look at`);
  return { lane, file: join(dir, take.file), rel: take.file, probe: take.probe, label: lane };
}

/** The fps and frame count a lane is measured in: its probe if it has one,
 *  otherwise the shot spec. */
function laneClock(shot, lane) {
  const fps = lane.probe?.fps ?? shot.spec.fps;
  const frames = lane.probe?.frames ?? shot.spec.frames;
  return { fps, frames };
}

// ---------------------------------------------------------------------------
// doctor
// ---------------------------------------------------------------------------

async function cmdDoctor(opts) {
  const blender = resolveBlender(undefined);
  const ffmpeg = resolveTool("ffmpeg");
  const ffprobe = resolveTool("ffprobe");
  const fal = await falKeyPresent();
  const drawtext = ffmpeg.found ? drawtextSupported() : { ok: false, reason: "ffmpeg not found" };

  // The scripts this mode SPAWNS by name. A missing one is a stage that
  // cannot run, and it is better said here than at the moment somebody is
  // about to pay for it.
  const shared = Object.fromEntries(
    [
      ["generate-tts.mjs", "BACKLOT_TTS_MODULE"],
      ["generate-bgm.mjs", "BACKLOT_BGM_MODULE"],
      ["transcribe.mjs", "BACKLOT_TRANSCRIBE_MODULE"],
      ["generate_image.mjs", "BACKLOT_IMAGE_MODULE"],
      ["seedance-video.mjs", "PREVIZ_SEEDANCE_MODULE"],
    ].map(([name, envVar]) => {
      const found = sharedScript(name, envVar);
      return [name, { found: Boolean(found.path), path: found.path, source: found.source, overridden: found.overridden }];
    }),
  );
  for (const [name, entry] of Object.entries(shared)) {
    if (!entry.found) {
      note(`WARN: ${name} is not installed beside this skill — the stage that runs it is closed`);
    } else if (entry.overridden) {
      note(`WARN: ${entry.source} is set — ${name} comes from ${entry.path}, not from the shared script`);
    }
  }

  const stages = {
    plan: { open: true, needs: [] },
    greybox: { open: blender.found && ffmpeg.found && ffprobe.found, needs: [...(blender.found ? [] : ["blender"]), ...(ffmpeg.found ? [] : ["ffmpeg"]), ...(ffprobe.found ? [] : ["ffprobe"])] },
    sheets: { open: ffmpeg.found, needs: ffmpeg.found ? [] : ["ffmpeg"] },
    anchor: {
      open: ffmpeg.found && shared["generate_image.mjs"].found,
      needs: [...(ffmpeg.found ? [] : ["ffmpeg"]), ...(shared["generate_image.mjs"].found ? [] : ["generate_image.mjs"])],
    },
    take: { open: fal.present && ffprobe.found, needs: [...(fal.present ? [] : ["FAL_KEY"]), ...(ffprobe.found ? [] : ["ffprobe"])] },
    voice: {
      open: fal.present && shared["generate-tts.mjs"].found,
      needs: [...(fal.present ? [] : ["FAL_KEY"]), ...(shared["generate-tts.mjs"].found ? [] : ["generate-tts.mjs"])],
    },
    music: {
      open: shared["generate-bgm.mjs"].found,
      needs: shared["generate-bgm.mjs"].found ? [] : ["generate-bgm.mjs"],
    },
    cut: { open: ffmpeg.found && ffprobe.found, needs: [...(ffmpeg.found ? [] : ["ffmpeg"]), ...(ffprobe.found ? [] : ["ffprobe"])] },
  };
  const blocked = Object.entries(stages).filter(([, stage]) => !stage.open);
  for (const [name, stage] of blocked) note(`WARN: stage "${name}" is blocked — missing ${stage.needs.join(", ")}`);
  if (!fal.present) {
    note("NOTE: no fal key. Plan, greybox, .blend/.glb and the prompt pack all still work; say so instead of calling a greybox a film.");
  }

  return emit({
    command: "doctor",
    blender: { found: blender.found, path: blender.path, version: blender.version, source: blender.source, steps: opts.verbose ? blender.steps : undefined },
    ffmpeg: { found: ffmpeg.found, path: ffmpeg.path, version: ffmpeg.version, drawtext: drawtext.ok, drawtextNote: drawtext.reason },
    ffprobe: { found: ffprobe.found, path: ffprobe.path, version: ffprobe.version },
    falKey: { present: fal.present, source: fal.source },
    shared,
    kit: { dir: KIT_DIR, present: existsSync(join(KIT_DIR, "previz_kit.py")) },
    starter: { dir: STARTER_DIR, present: existsSync(join(STARTER_DIR, "scene.py")) },
    stages,
    ready: stages.greybox.open,
    prices: PRICES,
  });
}

// ---------------------------------------------------------------------------
// Scaffolding a shot — called by `backlot.mjs shot add`
// ---------------------------------------------------------------------------

function specFromOpts(opts, defaults) {
  const size = opts.size ? parseSize(opts.size) : {};
  try {
    return makeSpec({ seconds: opts.seconds, fps: opts.fps, ...size }, defaults);
  } catch (error) {
    return fail(error.message);
  }
}

const SHOT_PLAN_TEMPLATE = (shot) => `# ${shot.title}

<!-- The shot plan. Everything the greybox and the prompt are built from.
     Keep it short and specific; a beat nobody can see in the render is a
     beat nobody can check. -->

## Spec

${shot.spec.seconds} s · ${shot.spec.fps} fps · ${shot.spec.width}x${shot.spec.height} · ${shot.spec.frames} frames

## Assumptions

- (anything the user did not say that you decided anyway)

## Space

- (the room, the props, where the subject enters and where it stops — in metres)

## Beats

| from | to | kind | beat | caused by |
|---|---|---|---|---|
| 0 | 0.5 | hold | ... | |

Load this timeline into shot.json with:

    previz.mjs beats <shot-dir> --set beats.json

## Camera

- (lens, where it starts, where it ends, when it settles)
`;

const PROMPTS_TEMPLATE = (shot) => `# Prompt pack — ${shot.title}

The greybox MP4 is attached to the paid job as the video reference, and the
prompt addresses it as **@Video1** — the syntax Seedance documents.
\`previz.mjs generate\` reads the FIRST fenced block tagged \`prompt\` below.
It refuses a prompt that never mentions @Video1, one that names a reference
index it did not attach, and one that leaves an ATTACHED reference without a
job ("@Image2 = the keeper's appearance only"). The other references it
attaches, in order: the 'first' key frame, this shot's other key frames, its
character sheets and its set concept, the hand-off frame last, then @Audio1…
the voice sample of each character with a spoken line.

Do not write this block from memory — run

    previz.mjs prompt-skeleton <shot-dir> --write

and fill in \`prompts.skeleton.md\`: it carries THIS shot's indices, its beats
as a contiguous time-coded timeline, its lines and its hand-off, in the block
order \`references/prompting.md\` documents. There is no word limit; carry the
design whole and cut vagueness, not length.

\`\`\`prompt
${PROMPT_TEMPLATE_BODY}
\`\`\`

## Look notes

- (what the greybox stands for: materials, light, time of day)

## Negative

- (what the model keeps adding that this shot must not have)
`;

/**
 * Scaffold `shots/<id>/` and write its first `shot.json`.
 *
 * Exported because `backlot.mjs shot add` is the command an agent runs — the
 * film's shot ORDER is `backlot.json`'s, and that file has one writer. The
 * bytes of `shot.json` still come from here, so the two scripts cannot grow
 * two ideas of what a new shot is. The caller registers the id afterwards;
 * this function never touches `backlot.json`.
 *
 * Refuses (through `fail`, exiting non-zero) an id that already exists, a
 * fractional frame count, an unknown entry kind, or a missing starter scene.
 */
export function createShot(projectDir, idArg, opts = {}) {
  const project = loadProject(projectDir);
  let id;
  try { id = slugId(idArg, "shot id"); } catch (error) { return fail(error.message); }
  const dir = join(projectDir, "shots", id);
  if (existsSync(shotPath(dir))) fail(`${shotPath(dir)} already exists`);

  const spec = specFromOpts(opts, project.defaults);
  const entry = opts.entry ?? "original";
  if (!ENTRIES.includes(entry)) fail(`--entry must be one of ${ENTRIES.join("|")} (got: ${entry})`);
  const assumptions = [];
  if (opts.seconds === undefined && opts.fps === undefined && opts.size === undefined) {
    assumptions.push(`${spec.seconds} s / ${spec.fps} fps / ${spec.width}x${spec.height} are the project defaults — the user gave none`);
  }

  let shot;
  try {
    shot = newShot({
      id,
      title: opts.title ?? id,
      entry,
      spec,
      assumptions,
      scene: opts.scene ?? null,
      characters: opts.characters ?? [],
      set: opts.set ?? null,
    });
  } catch (error) { return fail(error.message); }
  const seeded = seedChecklist(shot);

  mkdirSync(join(dir, "greybox"), { recursive: true });
  mkdirSync(join(dir, "takes"), { recursive: true });
  mkdirSync(join(dir, "compare"), { recursive: true });
  if (entry === "recreate") mkdirSync(join(dir, "reference"), { recursive: true });

  const starter = join(STARTER_DIR, "scene.py");
  if (!existsSync(starter)) fail(`the scene starter is missing: ${starter}`);
  const scenePath = join(dir, "greybox", "scene.py");
  copyFileSync(starter, scenePath);
  // The starter is written for the default 8 s / 24 fps shot; retune its
  // setup() call so the very first render matches THIS shot's spec.
  const scene = readFileSync(scenePath, "utf-8").replace(
    /pv\.setup\([^)]*\)/,
    `pv.setup(seconds=${spec.seconds}, fps=${spec.fps}, width=${spec.width}, height=${spec.height})`,
  );
  writeFileSync(scenePath, scene);

  writeFileSync(join(dir, "shot-plan.md"), SHOT_PLAN_TEMPLATE(shot));
  writeFileSync(join(dir, "prompts.md"), PROMPTS_TEMPLATE(shot));
  writeFileSync(join(dir, "comparison.md"), `# Comparison — ${shot.title}\n\n<!-- What you saw when you looked at the sheets. -->\n`);
  saveShot(dir, shot);

  return {
    dir,
    id,
    file: relPath(dir, shotPath(dir)),
    spec,
    entry,
    scene: shot.scene,
    characters: shot.characters,
    set: shot.set,
    seededChecks: seeded.length,
    wrote: ["shot.json", "shot-plan.md", "prompts.md", "comparison.md", "greybox/scene.py"],
    next: nextStage(shot),
  };
}

// ---------------------------------------------------------------------------
// meta — where this shot sits in the film
// ---------------------------------------------------------------------------

/** `--characters kai,clerk` → ["kai", "clerk"]; "" clears the list. */
function parseIdList(value, label) {
  const parts = String(value)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.map((part) => {
    try { return slugId(part, label); } catch (error) { return fail(error.message); }
  });
}

/** Warn — never refuse — about ids the bible does not carry yet. The bible
 *  can be written after the shot list, and a refusal here would force an
 *  order the creator did not ask for. `generate` reports the same gap again
 *  at the moment it would actually cost something. */
function warnUnknownIds(projectRoot, { scene = null, characters = [], set = null }) {
  if (!projectRoot) return [];
  let manifest;
  try { manifest = readManifest(projectRoot); } catch { return []; }
  const unknown = [];
  if (scene && !manifest.scenes.some((entry) => entry && entry.id === scene)) unknown.push(`scene "${scene}"`);
  for (const id of characters) {
    if (!manifest.characters.includes(id)) unknown.push(`character "${id}"`);
  }
  if (set && !manifest.sets.includes(set)) unknown.push(`set "${set}"`);
  for (const item of unknown) {
    note(`WARN: ${item} is not in ${PROJECT_FILE} yet — add it with backlot.mjs, or the take will be generated without that reference`);
  }
  return unknown;
}

function cmdMeta(dir, opts) {
  const touchesTrim = opts["trim-in"] !== undefined || opts["trim-out"] !== undefined || opts["no-trim"];
  const touchesContinuity =
    opts["continues-from"] !== undefined || opts.entry !== undefined || opts.exit !== undefined || opts["no-continuity"];
  const touchesConditioning = opts.conditioning !== undefined;
  if (
    opts.scene === undefined && opts.characters === undefined && opts.set === undefined
    && !touchesTrim && !touchesContinuity && !touchesConditioning
  ) {
    fail(
      'meta needs at least one of --scene <id>, --characters <a,b>, --set <id>, --conditioning greybox|free|hybrid, ' +
        '--trim-in/--trim-out, --no-trim, --continues-from <shot> --entry "…" --exit "…", --no-continuity ' +
        '(pass "" to clear an id)',
    );
  }
  if (touchesConditioning && !CONDITIONINGS.includes(opts.conditioning)) {
    fail(
      `--conditioning must be one of ${CONDITIONINGS.join("|")} (got: ${opts.conditioning}) — ` +
        "greybox sends the block as @Video1, free sends no video at all (the sheets and the style frame are the whole " +
        "reference set), hybrid sends the block and lets the body and the camera move inside it",
    );
  }
  if (opts["no-trim"] && (opts["trim-in"] !== undefined || opts["trim-out"] !== undefined)) {
    fail("--no-trim clears the trim; pass it alone, or give --trim-in/--trim-out instead");
  }
  if (opts["no-continuity"] && (opts["continues-from"] !== undefined || opts.entry !== undefined || opts.exit !== undefined)) {
    fail("--no-continuity drops the hand-off; pass it alone, or give --continues-from/--entry/--exit instead");
  }
  if (opts["continues-from"] === "") {
    fail('--continues-from needs the id of an earlier shot; pass --no-continuity to drop the hand-off instead of clearing it');
  }
  const projectRoot = findProjectRoot(dir);
  // The film's shot ORDER is what "earlier" means, and `backlot.json` has one
  // writer — this is a read.
  let order = null;
  if (opts["continues-from"] !== undefined) {
    const root = requireProjectRoot(dir, "a hand-off");
    try {
      order = readManifest(root).shots.map(String);
    } catch (error) {
      return fail(error.message);
    }
  }
  const { shot, result } = commitShot(dir, (fresh) => {
    const changed = { dropped: [], seeded: [] };
    if (touchesConditioning) {
      fresh.conditioning = opts.conditioning;
      if (opts.conditioning === "free") {
        // A greybox check nobody has answered, about a greybox this shot
        // will never send, is not a record — it is a question that no
        // longer applies, and leaving it would sit `unverified` in every
        // report for ever. Anything ANYBODY LOOKED AT stays: a recorded
        // verdict is history, and history is not deleted by a decision.
        const stays = (check) =>
          check.target !== "greybox"
          || check.status !== "unverified"
          || check.revision != null
          || (Array.isArray(check.history) && check.history.length > 0);
        changed.dropped = (fresh.checks ?? []).filter((check) => !stays(check)).map((check) => check.id);
        fresh.checks = (fresh.checks ?? []).filter(stays);
      } else {
        // …and back again: a shot that is blocked once more owes the
        // acceptance list it was going to be judged by.
        changed.seeded = seedChecklist(fresh);
      }
    }
    if (opts.scene !== undefined) fresh.scene = opts.scene === "" ? null : slugId(opts.scene, "--scene");
    if (opts.characters !== undefined) fresh.characters = opts.characters === "" ? [] : parseIdList(opts.characters, "--characters");
    if (opts.set !== undefined) fresh.set = opts.set === "" ? null : slugId(opts.set, "--set");
    if (opts["no-continuity"]) {
      fresh.continuity = null;
    } else if (touchesContinuity) {
      const current = fresh.continuity ?? { from: null, entry: null, exit: null };
      try {
        fresh.continuity = makeContinuity(
          {
            from: opts["continues-from"] === undefined ? current.from : opts["continues-from"],
            entry: opts.entry === undefined ? current.entry : opts.entry,
            exit: opts.exit === undefined ? current.exit : opts.exit,
          },
          { id: fresh.id, order },
        );
      } catch (error) {
        fail(error.message);
      }
    }
    if (opts["no-trim"]) {
      fresh.trim = null;
      return changed;
    }
    if (opts["trim-in"] === undefined && opts["trim-out"] === undefined) return changed;
    // One flag alone edits the range that is there, starting from the whole
    // shot: `--trim-out 1.6` on an untrimmed shot means 0 .. 1.6.
    const current = fresh.trim ?? { in: 0, out: fresh.spec?.seconds };
    try {
      fresh.trim = makeTrim(
        {
          in: opts["trim-in"] === undefined ? current.in : Number(opts["trim-in"]),
          out: opts["trim-out"] === undefined ? current.out : Number(opts["trim-out"]),
        },
        fresh.spec,
      );
    } catch (error) { fail(error.message); }
    return changed;
  });
  const unknown = warnUnknownIds(projectRoot, { scene: shot.scene, characters: shot.characters, set: shot.set });
  if (touchesConditioning) {
    const conditioning = conditioningOf(shot);
    if (conditioning === "free") {
      note(
        "[previz] this shot is FREE: no greybox is sent — the references are the character sheets and the film's " +
          "style frame, the first image is @Image1, and the prompt carries the action itself. 'generate' no longer " +
          "waits for a greybox or its checks (the previz-stage approval is still the gate), and 'take-motion' / " +
          "'take-camera' are judged against the PLAN. A greybox rendered anyway is for the reel and is not sent.",
      );
      if (result.dropped.length) {
        note(
          `[previz] dropped ${result.dropped.length} unanswered greybox check(s) (${result.dropped.join(", ")}) — ` +
            "nobody had looked at them and there will be no greybox to look at. Anything with a recorded verdict was kept.",
        );
      }
      const recorded = summarizeChecks(shot, "greybox");
      if (recorded.total > 0) {
        note(
          `NOTE: ${recorded.total} answered greybox check(s) are still on this shot's record (${recorded.pass} pass, ` +
            `${recorded.fail} fail) — they are history now, not a gate`,
        );
      }
    } else if (conditioning === "hybrid") {
      note(
        "[previz] this shot is HYBRID: the greybox is sent as @Video1 for the positions and the camera path, and the " +
          "pack says the body action and the camera speed may vary inside it. Everything the greybox rules require — " +
          "a final render at the current revision, its checks — still applies.",
      );
    } else {
      note("[previz] this shot is conditioned on its greybox: @Video1 is the layout, the timing and the camera move.");
    }
    if (result.seeded.length) {
      note(`[previz] seeded ${result.seeded.length} acceptance check(s) this conditioning asks for: ${result.seeded.join(", ")}`);
    }
  }
  if (shot.trim) {
    const outside = (shot.lines ?? []).filter((line) => line?.at != null && (line.at < shot.trim.in - 1e-6 || line.at > shot.trim.out + 1e-6));
    note(
      `[previz] the cut uses ${shot.trim.in}–${shot.trim.out} s of this shot (${round4(shot.trim.out - shot.trim.in)} s of film); ` +
        "the greybox, the take and the beats still run on the shot's own clock",
    );
    for (const line of outside) {
      note(`WARN: line "${line.id}" lands at ${line.at} s, outside the trim — it will be dropped from the cut`);
    }
  }
  if (touchesContinuity) {
    if (shot.continuity?.from) {
      note(
        `[previz] this shot continues "${shot.continuity.from}": it is generated AFTER that shot has a selected take, ` +
          "'generate' cuts that take's last used frame into takes/handoff-in.png for 'compare --handoff', and every take " +
          "carries the 'take-handoff' check. The frame is NOT sent to the model — the join travels as the --entry/--exit " +
          "text in the pack — unless 'generate --with-handoff' asks for it",
      );
    } else if (shot.continuity?.exit) {
      note("[previz] no hand-off — this shot is generated alone; its --exit is recorded for a later shot to continue from");
    } else {
      note("[previz] the hand-off is gone — this shot is generated alone again");
    }
  }
  return emit({
    command: "meta",
    dir,
    scene: shot.scene,
    characters: shot.characters,
    set: shot.set,
    conditioning: conditioningOf(shot),
    // What changing the conditioning did to the acceptance record, so a
    // report can say it rather than the agent having to diff the file.
    droppedChecks: result?.dropped ?? [],
    seededChecks: result?.seeded ?? [],
    trim: shot.trim,
    continuity: shot.continuity,
    unknown,
    next: nextStage(shot, promptState(dir, shot)),
  });
}

function round4(value) {
  return Math.round(Number(value) * 10000) / 10000;
}

// ---------------------------------------------------------------------------
// beats / checklist / check / select
// ---------------------------------------------------------------------------

function cmdBeats(dir, opts) {
  const shot = loadShot(dir);
  if (!opts.set) fail("beats needs --set <file.json> (or '-' to read stdin)");
  const text = opts.set === "-" ? readFileSync(0, "utf-8") : readFileSync(resolveInput(opts.set), "utf-8");
  let parsed;
  try { parsed = JSON.parse(text); } catch (error) { return fail(`--set: not valid JSON (${error.message})`); }
  const list = Array.isArray(parsed) ? parsed : parsed?.beats;
  let beats;
  try { beats = validateBeats(list, shot.spec); } catch (error) { return fail(error.message); }
  shot.beats = beats;
  saveShot(dir, shot);
  return emit({ command: "beats", dir, count: beats.length, beats, next: nextStage(shot, promptState(dir, shot)) });
}

function cmdChecklist(dir) {
  const shot = loadShot(dir);
  const added = seedChecklist(shot);
  saveShot(dir, shot);
  return emit({
    command: "checklist",
    dir,
    added,
    checks: shot.checks.map((check) => ({ id: check.id, target: check.target, status: check.status, revision: check.revision })),
    byTarget: Object.fromEntries(checkTargets(shot).map((target) => [target, summarizeChecks(shot, target)])),
  });
}

function cmdCheck(dir, opts, now) {
  const shot = loadShot(dir);
  if (!opts.id) fail("check needs --id <check>");
  if (!opts.status) fail(`check needs --status ${CHECK_STATUSES.join("|")}`);
  let range = null;
  if (opts.range) {
    try { range = parseRange(opts.range, "--range"); } catch (error) { return fail(error.message); }
    if (range[1] > shot.spec.seconds + 1e-6) fail(`--range ${opts.range} runs past the shot's ${shot.spec.seconds} s`);
  }
  let record;
  try {
    record = recordCheck(shot, {
      id: opts.id, status: opts.status, target: opts.target ?? "greybox",
      range, note: opts.note ?? "", at: now, label: opts.label ?? null,
    });
  } catch (error) { return fail(error.message); }
  saveShot(dir, shot);

  const target = record.target;
  const summary = summarizeChecks(shot, target);
  if (shot.stuck.includes(record.id)) {
    note(`WARN: "${record.id}" has now failed on two revisions of ${target} — stop re-rendering. Save this version, write down what you tried, and report.`);
  }
  return emit({
    command: "check", dir, check: record, summary, stuck: shot.stuck,
    next: nextStage(shot, promptState(dir, shot)),
  });
}

function cmdSelect(dir, takeId) {
  const shot = loadShot(dir);
  if (!takeId) fail("select needs a take id: previz.mjs select <shot-dir> take-01");
  const take = (shot.takes ?? []).find((entry) => entry.id === takeId);
  if (!take) fail(`no take "${takeId}" on this shot (${(shot.takes ?? []).map((t) => t.id).join(", ") || "none recorded"})`);
  if (take.status !== "done") fail(`${takeId} is "${take.status}" — only a finished take can be the one this shot delivers`);
  const summary = summarizeChecks(shot, takeId);
  if (summary.fail > 0) fail(`${takeId} has failing checks (${summary.failIds.join(", ")}) — a shot does not deliver a take that failed acceptance`);
  if (summary.unverified > 0) {
    note(`WARN: ${takeId} still has unverified checks (${summary.unverifiedIds.join(", ")}) — selecting it does not make them pass.`);
  }
  for (const entry of shot.takes) entry.selected = entry.id === takeId;
  saveShot(dir, shot);
  return emit({ command: "select", dir, selected: takeId, checks: summary, next: nextStage(shot, promptState(dir, shot)) });
}

// ---------------------------------------------------------------------------
// The gate, the cost record, and the media a shot registers
// ---------------------------------------------------------------------------

/** The film this shot belongs to. A paid shot command is gated on the
 *  project's approvals, so a shot with no film above it is a refusal — not
 *  a shot that spends unsupervised. */
function requireProjectRoot(dir, why) {
  const root = findProjectRoot(dir);
  if (!root) {
    fail(`no ${PROJECT_FILE} above ${dir} — ${why} is gated on the film's approvals, and this shot has no film`);
  }
  return root;
}

/** Refuse a paid command whose gate is not open, with the gate's own reason
 *  and the two ways past it. Returns the manifest for the caller to reuse. */
function requireGate(command, projectRoot) {
  const gate = projectGate(command, projectRoot);
  if (!gate.ok) fail(`refusing to spend on "${command}":\n${gateRefusal(gate, projectRoot)}`);
  return gate;
}

const COST_BASES = ["table", "reported", "estimate"];

/**
 * The `{ usd, basis }` a paid record carries, or null when the caller
 * recorded no price.
 *
 * `--cost-basis` is REQUIRED beside `--cost-usd`: where a number came from
 * is part of the number. Guessing a default would turn somebody's estimate
 * into a vendor's report at the next reader.
 */
function costFromOpts(opts, label) {
  if (opts["cost-usd"] === undefined) {
    note(`NOTE: no price recorded for this ${label} — pass --cost-usd <n> --cost-basis ${COST_BASES.join("|")} and the Cost view can total it`);
    return null;
  }
  const usd = Number(opts["cost-usd"]);
  if (!Number.isFinite(usd) || usd < 0) fail(`--cost-usd must be a non-negative number of dollars (got: ${opts["cost-usd"]})`);
  const basis = opts["cost-basis"];
  if (!basis) fail(`--cost-usd needs --cost-basis ${COST_BASES.join("|")} — "reported" is the vendor's own usage.cost, "table" a published price, "estimate" your arithmetic`);
  if (!COST_BASES.includes(basis)) fail(`--cost-basis must be one of ${COST_BASES.join("|")} (got: ${basis})`);
  return { usd: Math.round(usd * 10000) / 10000, basis };
}

/** A generated still, checked and copied into the place its record names.
 *  Refuses anything that is not a readable PNG: the record says `.png`, and
 *  a JPEG wearing that name is a reference the viewer cannot draw. */
function adoptPng(source, destination, label) {
  const from = resolveInput(source);
  if (!existsSync(from)) fail(`${label}: no such file: ${from}`);
  const size = pngSize(readFileSync(from));
  if (!size) fail(`${label}: ${from} is not a readable PNG — generate_image.mjs writes PNG by default (--output-format png)`);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(from, destination);
  return size;
}

/** Seconds of an audio (or video) file, measured. Returns null when ffprobe
 *  cannot say — the record then carries null rather than a guess. */
function probeSeconds(file) {
  const ffprobe = requireTool("ffprobe");
  const result = runTool(
    ffprobe.path,
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file],
    { label: "ffprobe" },
  );
  if (result.code !== 0) return null;
  let doc;
  try { doc = JSON.parse(result.stdout); } catch { return null; }
  const fromFormat = Number(doc?.format?.duration);
  if (Number.isFinite(fromFormat) && fromFormat > 0) return Math.round(fromFormat * 10000) / 10000;
  for (const stream of Array.isArray(doc?.streams) ? doc.streams : []) {
    const seconds = Number(stream?.duration);
    if (Number.isFinite(seconds) && seconds > 0) return Math.round(seconds * 10000) / 10000;
  }
  return null;
}

/** One shared script, resolved and announced. A run that came from an
 *  override says so on stderr: a file made by something other than the
 *  vendor must never be mistaken for one that was. */
function requireSharedScript(name, envVar, why) {
  const found = sharedScript(name, envVar);
  if (!found.path) {
    fail(`${name} is not installed beside this skill and is not in the source checkout — ${why} needs it (add it to the mode's skill.sharedScripts)`);
  }
  if (found.overridden) note(`WARN: ${envVar} is set — ${name} comes from ${found.path}, not from the shared script`);
  return found.path;
}

// ---------------------------------------------------------------------------
// board / lines / vo
// ---------------------------------------------------------------------------

/**
 * LEGACY. Register a drawn board frame against the shot.
 *
 * The flow does not produce one any more: round 3 (2026-09-21) proved that
 * storyboard frames drawn from the text before the greybox exists contradict
 * each other — no shared space, no shared camera — and the greybox could not
 * satisfy them. The picture now comes from the greybox (`previz.mjs anchor`).
 * This command stays so a film shot under the old order can still be read and
 * re-registered; a shot with a key frame never sends its board to a take.
 */
function cmdBoard(dir, opts, now) {
  const shot = loadShot(dir);
  note("NOTE: 'board' is legacy and is not part of the flow — the pictures come from the greybox now (previz.mjs anchor <shot-dir>)");
  if (!opts.file) fail('board needs --file <png> (generate it with generate_image.mjs, then register it here)');
  if (!opts.prompt) fail('board needs --prompt "<the prompt the frame was made from>" — a frame nobody can regenerate is a frame nobody can fix');
  const projectRoot = requireProjectRoot(dir, "registering a board frame");
  requireGate("board", projectRoot);

  const revision = Number(shot.board?.revision ?? 0) + 1;
  adoptPng(opts.file, join(dir, "board.png"), "--file");
  const refs = opts.refs
    ? String(opts.refs).split(",").map((part) => part.trim()).filter(Boolean).map((part) => {
        const absolute = resolveInput(part);
        return existsSync(absolute) ? relFromProject(projectRoot, absolute) : part;
      })
    : [];
  const cost = costFromOpts(opts, "board frame");
  // Epoch milliseconds, as `backlot.json`'s approvals and `cut/edl.json`
  // spell a time; the ISO strings in this file belong to the render and
  // check records that predate the film around them.
  const record = { file: "board.png", revision, prompt: String(opts.prompt), refs, at: Date.parse(now), cost };

  const { shot: saved } = commitShot(dir, (fresh) => { fresh.board = record; });
  return emit({ command: "board", dir, board: record, next: nextStage(saved, promptState(dir, saved)) });
}

function readLineSpec(value) {
  const text = value === "-"
    ? readFileSync(0, "utf-8")
    : String(value).trim().startsWith("[")
      ? String(value)
      : readFileSync(resolveInput(value), "utf-8");
  try {
    return JSON.parse(text);
  } catch (error) {
    return fail(`--set: not valid JSON (${error.message}) — pass a JSON array inline, a file path, or '-' for stdin`);
  }
}

function cmdLines(dir, opts) {
  const shot = loadShot(dir);
  if (!opts.set) fail(`lines needs --set '<json array>' — each line is { id, speaker, kind: ${LINE_KINDS.join("|")}, text, at }`);
  const parsed = readLineSpec(opts.set);
  const list = Array.isArray(parsed) ? parsed : parsed?.lines;
  // Validate against the copy read at startup FIRST, so a bad list is
  // refused without touching the file at all.
  try {
    validateLines(list, shot.spec, shot.lines ?? []);
  } catch (error) { return fail(error.message); }

  let result;
  const { shot: saved } = commitShot(dir, (fresh) => {
    // Then re-validate against what is on disk NOW: a `vo` that landed
    // while this command was being typed recorded a file, and the list this
    // process read at startup would drop it.
    result = validateLines(list, fresh.spec, fresh.lines ?? []);
    fresh.lines = result.lines;
  });
  for (const id of result.stale) {
    note(`WARN: line "${id}" changed its text — the recording it had no longer says it and was unlinked (its cost stays on the record). Re-run 'previz.mjs vo <shot-dir> ${id}'.`);
  }
  const spoken = spokenLines(saved);
  if (spoken.length) {
    note(`NOTE: ${spoken.length} line(s) are SPOKEN on screen — the take carries the text and the speaker's voice sample, and 'take-lines' is checked against a transcript. Voice-over is a separate kind.`);
  }
  return emit({
    command: "lines",
    dir,
    count: saved.lines.length,
    lines: saved.lines,
    kept: result.kept,
    stale: result.stale,
    spoken: spoken.map((line) => line.id),
    next: nextStage(saved, promptState(dir, saved)),
  });
}

/**
 * The voice a character speaks in, out of the bible. Read-only: the bible is
 * `backlot.mjs`'s to write, and a shot command that "fixed" a character's
 * voice would change every other shot that speaks it.
 */
function bibleVoice(projectRoot, speaker) {
  if (!projectRoot || !speaker) return null;
  const path = join(projectRoot, "bible", "characters", speaker, "character.json");
  if (!existsSync(path)) return null;
  try {
    const doc = JSON.parse(readFileSync(path, "utf-8"));
    return doc && typeof doc === "object" && doc.voice && typeof doc.voice === "object" ? doc.voice : null;
  } catch {
    return null;
  }
}

function cmdVo(dir, lineId, opts, now) {
  const shot = loadShot(dir);
  if (!lineId) fail("vo needs a line id: previz.mjs vo <shot-dir> l2");
  const line = (shot.lines ?? []).find((entry) => entry.id === lineId);
  if (!line) fail(`no line "${lineId}" on this shot (${(shot.lines ?? []).map((l) => l.id).join(", ") || "none recorded"}) — load them with 'previz.mjs lines --set'`);
  if (line.kind !== "vo") {
    fail(
      `line "${lineId}" is SPOKEN on screen, not voice-over — the video model renders it and the take is checked against a transcript. ` +
        "Laying a TTS file over a mouth the model animated is the lip-sync failure the two kinds exist to avoid.",
    );
  }
  const projectRoot = requireProjectRoot(dir, "a voice-over line");
  requireGate("vo", projectRoot);

  const voice = bibleVoice(projectRoot, line.speaker);
  const model = opts.model ?? voice?.model ?? null;
  const voiceId = opts.voice ?? voice?.voiceId ?? null;
  const style = opts.style ?? voice?.style ?? null;
  if (!opts.voice && voiceId) note(`[previz] ${line.speaker}'s recorded voice (${voiceId}${model ? ` on ${model}` : ""}) — --voice overrides it`);

  const script = requireSharedScript("generate-tts.mjs", "BACKLOT_TTS_MODULE", "a voice-over line");
  const rel = `sound/${lineId}.mp3`;
  const output = join(dir, rel);
  mkdirSync(dirname(output), { recursive: true });
  const args = ["--text", line.text, "--output", output, "--json"];
  if (model) args.push("--model", model);
  if (voiceId) args.push("--voice", voiceId);
  if (style) args.push("--style", style);

  note(`[previz] synthesizing ${lineId} (${line.text.length} chars) — the request is leaving now`);
  const run = runNodeScript(script, args);
  if (run.code !== 0 || !existsSync(output)) {
    fail(`generate-tts.mjs failed (exit ${run.code}):\n${tail(run.stderr)}`);
  }
  const reported = lastJsonObject(run.stdout);
  const seconds = Number.isFinite(Number(reported?.seconds))
    ? Math.round(Number(reported.seconds) * 10000) / 10000
    : probeSeconds(output);
  if (seconds === null) note("WARN: neither the TTS script nor ffprobe could measure this clip — the cut cannot place a line whose length is unknown");
  const cost = costFromOpts(opts, "voice-over line");

  const { shot: saved } = commitShot(dir, (fresh) => {
    const current = (fresh.lines ?? []).find((entry) => entry.id === lineId);
    if (!current) fail(`line "${lineId}" is no longer in ${relPath(dir, shotPath(dir))} — the audio is at ${rel}; re-load the lines and run vo again`);
    current.file = rel;
    current.seconds = seconds;
    current.cost = cost;
    current.voice = { model, voiceId, style };
    // `at` is WHERE the line lands in the shot, in seconds; when it was
    // recorded is a different fact and gets its own field.
    current.recordedAt = Date.parse(now);
  });
  return emit({
    command: "vo",
    dir,
    line: (saved.lines ?? []).find((entry) => entry.id === lineId),
    file: rel,
    seconds,
    cost,
    next: nextStage(saved, promptState(dir, saved)),
  });
}

// ---------------------------------------------------------------------------
// render
// ---------------------------------------------------------------------------

async function cmdRender(dir, opts) {
  const shot = loadShot(dir);
  const spec = shot.spec;
  // What this render was validated against. Blender runs for minutes; the
  // record it produces is only true of the shot it started from.
  const baseRevision = Number(shot.greybox?.revision ?? 0);
  const baseSpec = JSON.stringify(spec);
  const scene = join(dir, shot.greybox.script ?? "greybox/scene.py");
  if (!existsSync(scene)) fail(`no scene script at ${scene}`);
  const blender = requireBlender(opts.blender);
  requireTool("ffmpeg");
  requireTool("ffprobe");

  const preview = Boolean(opts.preview);
  const scale = preview ? 0.5 : 1;
  const expectSize = preview ? previewSize(spec.width, spec.height) : evenSize(spec.width, spec.height);
  const timeoutMs = Math.max(30, Number(opts.timeout ?? DEFAULT_RENDER_TIMEOUT_S)) * 1000;

  const framesDir = join(dir, "greybox", "frames");
  rmSync(framesDir, { recursive: true, force: true });
  mkdirSync(framesDir, { recursive: true });

  const args = [
    "--out", framesDir,
    "--scale", String(scale),
    "--expect-frames", String(spec.frames),
    "--expect-fps", String(spec.fps),
    "--expect-width", String(spec.width),
    "--expect-height", String(spec.height),
    "--blend", join(dir, "greybox", "scene.blend"),
    "--glb", join(dir, "greybox", "scene.glb"),
    "--meta", join(dir, "greybox", "scene.meta.json"),
  ];
  note(`[previz] rendering ${spec.frames} frames at ${Math.round(spec.width * scale)}x${Math.round(spec.height * scale)} (${preview ? "preview" : "final"})`);
  const run = await runBlenderScene({ blender: blender.path, script: scene, args, timeoutMs });
  if (run.code !== 0) {
    fail(
      run.timedOut
        ? `Blender did not finish ${scene} within ${Math.round(timeoutMs / 1000)}s — raise --timeout or simplify the scene`
        : `Blender exited ${run.code} running ${scene}. The last lines of its log are above; the kit refuses with an ERROR: line.`,
    );
  }
  const summary = parseKitSummary(run.stdout);

  const pngs = readdirSync(framesDir).filter((name) => /^f_\d+\.png$/.test(name)).sort();
  if (pngs.length !== spec.frames) {
    fail(`the render left ${pngs.length} PNG frames in ${framesDir}, the spec says ${spec.frames} — the scene's frame range disagrees with shot.json`);
  }
  const firstSize = pngSize(readFileSync(join(framesDir, pngs[0])));
  if (!firstSize) fail(`${join(framesDir, pngs[0])} is not a readable PNG`);
  const even = evenSize(firstSize.width, firstSize.height);
  if (even.width !== expectSize.width || even.height !== expectSize.height) {
    fail(`the render is ${firstSize.width}x${firstSize.height}, this shot expects ${expectSize.width}x${expectSize.height} — the scene overrode the runner's size`);
  }

  // The sidecar is checked BEFORE anything is committed: a meta that
  // disagrees with the spec means the scene is not the shot, and a scene
  // that is not the shot must not leave an MP4 behind for a take to be
  // conditioned on.
  const wrote = {
    blend: existsSync(join(dir, "greybox", "scene.blend")),
    glb: existsSync(join(dir, "greybox", "scene.glb")),
    meta: existsSync(join(dir, "greybox", "scene.meta.json")),
  };
  let meta = null;
  if (wrote.meta) {
    meta = readJson(join(dir, "greybox", "scene.meta.json"), "scene.meta.json");
    if (meta.frames !== spec.frames || meta.fps !== spec.fps) {
      fail(`greybox/scene.meta.json says ${meta.frames} frames at ${meta.fps} fps, the spec says ${spec.frames} at ${spec.fps}`);
    }
  }

  const outRel = preview ? "greybox/preview.mp4" : "greybox/greybox.mp4";
  const outFile = join(dir, outRel);
  const staged = join(dir, "greybox", `.${preview ? "preview" : "greybox"}.staging.mp4`);
  const ffmpeg = requireTool("ffmpeg");
  const filters = [];
  if (firstSize.width !== even.width || firstSize.height !== even.height) {
    note(`[previz] cropping ${firstSize.width}x${firstSize.height} to ${even.width}x${even.height} — yuv420p needs even dimensions`);
    filters.push(`crop=${even.width}:${even.height}:0:0`);
  }
  const encodeArgs = [
    "-y", "-v", "error",
    "-framerate", String(spec.fps),
    "-start_number", "1",
    "-i", join(framesDir, "f_%04d.png"),
    ...(filters.length ? ["-vf", filters.join(",")] : []),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-movflags", "+faststart",
    staged,
  ];
  runToolOrFail(ffmpeg.path, encodeArgs, { label: "ffmpeg encode", timeoutMs });
  decodeCheck(staged);
  const probe = probeVideo(staged);
  const problems = probeMismatches(probe, { frames: spec.frames, fps: spec.fps, width: even.width, height: even.height });
  if (problems.length) {
    rmSync(staged, { force: true });
    fail(`the encoded greybox does not match the shot spec and was discarded:\n  - ${problems.join("\n  - ")}`);
  }
  // Nothing on disk has been replaced yet. Before the MP4 lands, check that
  // the shot this render was validated against is still the shot on disk: a
  // render that finished second must not overwrite the one that finished
  // first, and a spec somebody adopted while Blender ran makes these frames
  // frames of a shot that no longer exists.
  const drift = renderDrift(loadShot(dir), { baseRevision, baseSpec });
  if (drift) {
    rmSync(staged, { force: true });
    fail(`${drift}. This encode was discarded and ${outRel} was left alone; nothing was written to shot.json. The frames are still in ${relPath(dir, framesDir)} — render again against the current shot.`);
  }
  renameSync(staged, outFile);

  const record = {
    file: outRel,
    revision: baseRevision + 1,
    scale,
    probe,
    renderedAt: new Date().toISOString(),
    renderSeconds: Math.round(run.durationMs / 100) / 10,
  };

  // The sheet the acceptance list is read from, written every render so the
  // one on disk always belongs to the revision shot.json names.
  const sheet = writeSheet(dir, {
    file: outFile,
    times: evenlySpacedTimes({ frames: spec.frames, fps: spec.fps, count: 6 }),
    fps: spec.fps,
    frames: spec.frames,
    outPath: join(dir, "greybox", "sheet.png"),
    scratch: "render-sheet",
  });

  // Re-read: a check recorded while Blender ran belongs to the record, and
  // only the greybox fields below are this command's to write.
  const { shot: saved } = commitShot(dir, (fresh) => {
    const late = renderDrift(fresh, { baseRevision, baseSpec });
    if (late) fail(`${late}. ${outRel} on disk is now this render's, but shot.json was left alone — render again against the current shot.`);
    fresh.greybox.revision = baseRevision + 1;
    if (preview) fresh.greybox.preview = record; else fresh.greybox.final = record;
  });

  // The PNG sequence exists so a long render can be resumed and the encode
  // reproduced. Once the MP4 is encoded, decoded and probed it has done its
  // job, and 192 frames of 720p is 163 MB per shot. A render that FAILED
  // never reaches here — its frames are exactly what somebody needs.
  const keepFrames = Boolean(opts["keep-frames"]);
  if (!keepFrames) {
    rmSync(framesDir, { recursive: true, force: true });
    note(`[previz] removed ${pngs.length} scratch frames from ${relPath(dir, framesDir)} (--keep-frames keeps them)`);
  }

  return emit({
    command: "render",
    dir,
    preview,
    revision: saved.greybox.revision,
    file: outRel,
    probe,
    renderSeconds: record.renderSeconds,
    frames: { rendered: pngs.length, kept: keepFrames, dir: keepFrames ? relPath(dir, framesDir) : null },
    wrote,
    meta,
    kit: summary,
    sheet: relPath(dir, sheet.path),
    sheetLabels: sheet.labels,
    next: nextStage(saved, promptState(dir, saved)),
  });
}

/** Why the shot on disk is no longer the one this render was validated
 *  against, or null when it still is. */
function renderDrift(current, { baseRevision, baseSpec }) {
  const revision = Number(current.greybox?.revision ?? 0);
  if (revision !== baseRevision) {
    return `the greybox revision moved from ${baseRevision} to ${revision} while Blender ran — another render finished first`;
  }
  if (JSON.stringify(current.spec) !== baseSpec) {
    return `the shot spec changed while Blender ran (${describeSpec(JSON.parse(baseSpec))} → ${describeSpec(current.spec)}) — these frames were rendered and checked against the old one`;
  }
  return null;
}

function describeSpec(spec) {
  return `${spec.seconds}s/${spec.fps}fps/${spec.width}x${spec.height}`;
}

// ---------------------------------------------------------------------------
// sheet / compare
// ---------------------------------------------------------------------------

/** One contact sheet, tiles labelled with their timestamp when this ffmpeg
 *  can draw text. Returns the path and whether the labels are there. */
function writeSheet(dir, { file, times, fps, frames, outPath, scratch }) {
  const work = scratchDir(dir, scratch);
  try {
    const wanted = times.map((t) => ({ t, frame: frameAtTime(t, fps, frames) }));
    const extracted = extractFrames(file, wanted.map((entry) => entry.frame), work);
    let labels = true;
    for (const tile of extracted) {
      const at = wanted.find((entry) => entry.frame === tile.frame) ?? { t: timeOfFrame(tile.frame, fps) };
      if (!labelTile(tile.path, `${stamp(at.t)}  f ${tile.frame}/${frames}`)) { labels = false; break; }
    }
    if (!labels) for (const tile of extracted) rmSync(`${tile.path}.labelled.png`, { force: true });
    const grid = gridFor(extracted.length);
    tileInto(work, outPath, grid);
    return { path: outPath, labels, tiles: extracted.length, grid, times: wanted };
  } finally {
    dropScratch(dir);
  }
}

function cmdSheet(dir, opts) {
  const shot = loadShot(dir);
  const lane = laneFile(dir, shot, opts.lane ?? "greybox");
  const clock = laneClock(shot, lane);
  requireTool("ffmpeg");

  let times;
  let mode;
  if (opts.strip) {
    let range;
    try { range = parseRange(opts.strip, "--strip"); } catch (error) { return fail(error.message); }
    let list;
    try { list = stripFrames(range[0], range[1], clock.fps, clock.frames); } catch (error) { return fail(error.message); }
    times = list.map((frame) => timeOfFrame(frame, clock.fps));
    mode = "strip";
  } else if (opts.at) {
    try { times = parseTimeList(opts.at, "--at"); } catch (error) { return fail(error.message); }
    mode = "at";
  } else {
    times = evenlySpacedTimes({ frames: clock.frames, fps: clock.fps, count: Number(opts.count ?? 6) });
    mode = "even";
  }

  const outPath = opts.out
    ? resolveInput(opts.out)
    : join(dir, lane.lane === "greybox" || lane.lane === "preview" ? "greybox" : lane.lane === "reference" ? "reference" : "compare", `sheet${mode === "strip" ? `-strip-${times[0].toFixed(2)}-${times[times.length - 1].toFixed(2)}` : mode === "at" ? "-at" : ""}.png`);
  const sheet = writeSheet(dir, { file: lane.file, times, fps: clock.fps, frames: clock.frames, outPath, scratch: "sheet" });
  if (!sheet.labels) note(`NOTE: ${drawtextSupported().reason} — the sheet has no timestamps burnt in.`);

  return emit({
    command: "sheet", dir, lane: lane.lane, laneLabel: lane.label, source: lane.rel,
    mode, tiles: sheet.tiles, grid: sheet.grid, labels: sheet.labels,
    labelNote: sheet.labels ? null : drawtextSupported().reason,
    frames: sheet.times.map((entry) => entry.frame),
    times: sheet.times.map((entry) => Math.round(entry.t * 10000) / 10000),
    file: relPath(dir, sheet.path),
  });
}

/**
 * The joint of two shots, as one picture: the previous shot's last used
 * frame beside the first frame this take opens on.
 *
 * `take-handoff` is a question about two frames, and the only honest way to
 * answer it is to look at them together. The left frame is the one the take
 * was actually CONDITIONED on when the record says so (`take.handoff`), and
 * the shot's current continuity otherwise — a re-selected previous take must
 * not quietly redraw the evidence for a take that never saw it.
 */
function cmdCompareHandoff(dir, opts) {
  const shot = loadShot(dir);
  const projectRoot = requireProjectRoot(dir, "a hand-off comparison");
  const ffmpeg = requireTool("ffmpeg");

  const takes = shot.takes ?? [];
  const wanted = opts.take
    ? takes.find((entry) => entry.id === opts.take)
    : (takes.find((entry) => entry.selected === true) ?? [...takes].reverse().find((entry) => entry.status === "done"));
  if (!wanted) {
    fail(
      opts.take
        ? `no take "${opts.take}" on this shot (${takes.map((t) => t.id).join(", ") || "none recorded"})`
        : `this shot has no finished take to compare (${takes.map((t) => `${t.id} (${t.status})`).join(", ") || "none recorded"})`,
    );
  }
  if (wanted.status !== "done" || !wanted.file) fail(`${wanted.id} is "${wanted.status}" and has no file to look at`);
  const takeFile = join(dir, wanted.file);
  if (!existsSync(takeFile)) fail(`${wanted.file} is recorded on ${wanted.id} but missing from disk`);

  // The left half is cut from THIS take's own record — the shot, the take and
  // the frame it was conditioned on — into a file of its own under the take's
  // QA directory. `takes/handoff-in.png` is one path per shot and the next
  // take overwrites it, so reading it back would eventually answer
  // `take-handoff` with a frame this take never saw.
  const recorded = wanted.handoff && typeof wanted.handoff === "object" ? wanted.handoff : null;
  const qaDir = join(dir, "takes", "qa", wanted.id);
  let left = null;
  let leftLabel = "";
  let source = null;
  if (recorded) {
    const peerTakeFile = recorded.source ? join(projectRoot, ...String(recorded.source).split("/")) : null;
    if (peerTakeFile && existsSync(peerTakeFile) && Number.isFinite(Number(recorded.frame))) {
      source = `takes/qa/${wanted.id}/handoff-out.png`;
      left = extractOneFrame(dir, peerTakeFile, Number(recorded.frame), join(dir, source), { width: null, scratch: "handoff-out" });
    } else if (recorded.file && existsSync(join(dir, recorded.file))) {
      // The clip it came from is gone; the frame that was attached is not.
      note(`NOTE: ${recorded.source ?? "the previous take"} is no longer on disk — the left frame is the PNG ${wanted.id} was given`);
      left = join(dir, recorded.file);
      source = recorded.file;
    } else {
      fail(`${wanted.id} was conditioned on frame ${recorded.frame} of ${recorded.source}, and neither that clip nor ${recorded.file} is on disk`);
    }
    leftLabel = `${recorded.from ?? "previous"} ${recorded.take ?? ""} out ${stamp(recorded.at ?? 0)}`.replace(/\s+/g, " ").trim();
  } else {
    // A take generated with --no-handoff, or one that predates the record:
    // the pair is drawn against what this shot SAYS it continues now, and
    // says so.
    if (!shot.continuity?.from) {
      fail(
        `${wanted.id} carries no hand-off frame and this shot continues nothing — there is no pair to compare. ` +
          'Declare one with \'previz.mjs meta <shot-dir> --continues-from <shot> --entry "…" --exit "…"\'.',
      );
    }
    if (wanted.handoff === "skipped") {
      note(`NOTE: ${wanted.id} was generated with --no-handoff — the left frame is the one this shot SHOULD have continued, not one it was shown`);
    }
    const resolved = resolveHandoff(dir, shot, projectRoot, { skip: false });
    left = resolved.file;
    leftLabel = `${resolved.from} ${resolved.take} out ${stamp(resolved.at)}`;
    source = resolved.rel;
  }
  mkdirSync(qaDir, { recursive: true });

  // The take's own clock: what it MEASURED, falling back to the spec it was
  // ordered at.
  const fps = Number(wanted.probe?.fps) || shot.spec.fps;
  const frames = Number(wanted.probe?.frames) || shot.spec.frames;
  const inSeconds = shot.trim?.in != null ? Number(shot.trim.in) : 0;
  const inFrame = firstFrameFrom(inSeconds, fps, frames);
  const inAt = round4(timeOfFrame(inFrame, fps));

  const work = scratchDir(dir, "handoff-compare");
  try {
    const [tile] = extractFrames(takeFile, [inFrame], join(work, "in"), { width: null });
    const leftSize = pngSize(readFileSync(left));
    if (!leftSize) fail(`${source} is not a readable PNG — re-cut it with 'previz.mjs generate', or delete it and generate again`);
    // Labelling writes on the file, and the left one is a RECORDED reference
    // — what the take was made from. Label the copy.
    const leftCopy = copyInto(left, join(work, "out.png"));
    const labelled = labelTile(leftCopy, leftLabel);
    const labels = labelTile(tile.path, `${wanted.id} in ${stamp(inAt)}  f ${inFrame}/${frames}`) && labelled;
    const outPath = opts.out ? resolveInput(opts.out) : join(dir, "takes", "qa", wanted.id, "handoff.png");
    mkdirSync(dirname(outPath), { recursive: true });
    const scaled = `scale=${leftSize.width}:${leftSize.height}`;
    runToolOrFail(
      ffmpeg.path,
      ["-y", "-v", "error", "-i", leftCopy, "-i", tile.path,
        "-filter_complex", `[0:v]${scaled}[a];[1:v]${scaled}[b];[a][b]hstack=inputs=2`,
        "-frames:v", "1", outPath],
      { label: "ffmpeg handoff pair" },
    );
    if (!labels) note(`NOTE: ${drawtextSupported().reason} — the pair has no labels burnt in.`);
    const size = pngSize(readFileSync(outPath));
    return emit({
      command: "compare",
      dir,
      mode: "handoff",
      take: wanted.id,
      from: recorded?.from ?? shot.continuity?.from ?? null,
      out: { file: source, label: leftLabel, at: recorded?.at ?? null, frame: recorded?.frame ?? null, recorded: Boolean(recorded) },
      in: { file: wanted.file, frame: inFrame, at: inAt, trimmed: shot.trim ?? null },
      tile: leftSize,
      size,
      labels,
      labelNote: labels ? null : drawtextSupported().reason,
      entry: shot.continuity?.entry ?? null,
      file: relPath(dir, outPath),
    });
  } finally {
    dropScratch(dir);
  }
}

/** Copy into the scratch so labelling never writes on a recorded reference —
 *  `takes/handoff-in.png` is what a take was made from. */
function copyInto(from, to) {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  return to;
}

function cmdCompare(dir, opts) {
  if (opts.handoff) return cmdCompareHandoff(dir, opts);
  const shot = loadShot(dir);
  const a = laneFile(dir, shot, opts.a ?? "greybox");
  if (!opts.b) fail("compare needs --b <reference|take-01|greybox>, or --handoff for the joint with the shot before it");
  const b = laneFile(dir, shot, opts.b);
  const clock = laneClock(shot, a);
  const clockB = laneClock(shot, b);
  const ffmpeg = requireTool("ffmpeg");

  let times;
  if (opts.at) {
    try { times = parseTimeList(opts.at, "--at"); } catch (error) { return fail(error.message); }
  } else {
    times = evenlySpacedTimes({ frames: clock.frames, fps: clock.fps, count: Number(opts.count ?? 6) });
  }

  const work = scratchDir(dir, "compare");
  let outPath;
  let labels = true;
  try {
    const framesA = times.map((t) => frameAtTime(t, clock.fps, clock.frames));
    const framesB = times.map((t) => frameAtTime(t, clockB.fps, clockB.frames));
    const tilesA = extractFrames(a.file, framesA, join(work, "a"));
    const tilesB = extractFrames(b.file, framesB, join(work, "b"));
    // Different sizes are scaled to one width; the pair is then stacked (or
    // averaged, for silhouette matching) at exactly that size.
    const sizeA = pngSize(readFileSync(tilesA[0].path));
    const pairDir = join(work, "pairs");
    mkdirSync(pairDir, { recursive: true });
    const blend = Boolean(opts.blend);
    for (let index = 0; index < times.length; index += 1) {
      const left = tilesA[Math.min(index, tilesA.length - 1)].path;
      const right = tilesB[Math.min(index, tilesB.length - 1)].path;
      const scaled = `scale=${sizeA.width}:${sizeA.height}`;
      const graph = blend
        ? `[0:v]${scaled},format=rgba[a];[1:v]${scaled},format=rgba[b];[a][b]blend=all_mode=average`
        : `[0:v]${scaled}[a];[1:v]${scaled}[b];[a][b]vstack=inputs=2`;
      const pair = join(pairDir, `tile_${String(index + 1).padStart(3, "0")}.png`);
      runToolOrFail(ffmpeg.path, ["-y", "-v", "error", "-i", left, "-i", right, "-filter_complex", graph, "-frames:v", "1", pair], { label: "ffmpeg compare pair" });
      if (labels && !labelTile(pair, `${stamp(times[index])}  ${a.label} ${blend ? "x" : "/"} ${b.label}`)) labels = false;
    }
    const grid = gridFor(times.length);
    outPath = opts.out ? resolveInput(opts.out) : join(dir, "compare", `${a.lane}-vs-${b.lane}${blend ? "-blend" : ""}.png`);
    tileInto(pairDir, outPath, grid);
    if (!labels) note(`NOTE: ${drawtextSupported().reason} — the comparison has no timestamps burnt in.`);
    return emit({
      command: "compare", dir,
      a: { lane: a.lane, file: a.rel, frames: framesA },
      b: { lane: b.lane, file: b.rel, frames: framesB },
      mode: blend ? "blend" : "stacked",
      times: times.map((t) => Math.round(t * 10000) / 10000),
      grid, labels, labelNote: labels ? null : drawtextSupported().reason,
      file: relPath(dir, outPath),
    });
  } finally {
    dropScratch(dir);
  }
}

// ---------------------------------------------------------------------------
// anchor / lineup — the picture before the video
// ---------------------------------------------------------------------------

/** How tall each panel of a lineup is. Three 16:9 panels at this height is a
 *  ~1920 px PNG: one screen, and every face still readable. */
const LINEUP_HEIGHT = 360;

/** The aspect ratios GPT Image accepts (mirrors `generate_image.mjs`'s
 *  `IMAGE_ASPECTS`; that module may not be installed when this runs). */
const IMAGE_ASPECTS = ["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"];

/** The listed aspect closest to the shot's own frame. An anchor in the wrong
 *  shape fights the composition it was made to hold. */
function nearestAspect(width, height) {
  const target = Number(width) / Number(height);
  if (!Number.isFinite(target) || target <= 0) return "16:9";
  let best = IMAGE_ASPECTS[1];
  let bestGap = Infinity;
  for (const aspect of IMAGE_ASPECTS) {
    const [w, h] = aspect.split(":").map(Number);
    const gap = Math.abs(w / h - target);
    if (gap < bestGap) { best = aspect; bestGap = gap; }
  }
  return best;
}

/** The greybox lane an anchor and a lineup read: the final render when there
 *  is one, otherwise the preview, and a named refusal when there is neither. */
function greyboxLane(dir, shot, { finalOnly = false } = {}) {
  const greybox = shot.greybox ?? {};
  const record = finalOnly ? greybox.final : (greybox.final ?? greybox.preview);
  if (!record) {
    fail(
      finalOnly
        ? "there is no FINAL greybox — an anchor frame is made from the render the take will be conditioned on ('previz.mjs render <shot-dir>')"
        : "the greybox has never been rendered — run 'previz.mjs render <shot-dir> --preview'",
    );
  }
  const file = join(dir, record.file);
  if (!existsSync(file)) fail(`shot.json names ${record.file} as the greybox but the file is gone — re-render`);
  const fps = Number(record.probe?.fps) || shot.spec.fps;
  const frames = Number(record.probe?.frames) || shot.spec.frames;
  return { record, file, rel: record.file, fps, frames };
}

/**
 * The prompt a key frame is made from, when the agent gives none.
 *
 * THE PICTURE COMES FROM THE GREYBOX. Round 3 (2026-09-21) drew a storyboard
 * frame per shot from the text before anything was blocked, and the eight
 * pictures shared no space and no camera — the greybox could not satisfy any
 * of them. So this prompt splits the job by authority and says so in the
 * order the image model reads: image 1 (the greybox frame) owns composition,
 * framing, who stands where and how big they are; the sheets and the concept
 * own appearance and nothing else; the film's style reference, when the
 * project has one, owns the rendering idiom.
 */
function anchorPrompt(shot, projectRoot, at, { styleRef = false } = {}) {
  const covering = (shot.beats ?? []).filter((beat) => at >= beat.from - 1e-6 && at <= beat.to + 1e-6);
  const beats = (covering.length ? covering : (shot.beats ?? []).slice(0, 1))
    .map((beat) => beat.detail || beat.label)
    .filter(Boolean);
  const people = (shot.characters ?? []).map((id) => {
    const record = readBibleRecord(projectRoot, "characters", id);
    return { id, name: record?.name || id, look: record?.look ?? "" };
  });
  const setRecord = shot.set ? readBibleRecord(projectRoot, "sets", shot.set) : null;
  const setName = setRecord?.name || shot.set;

  const lines = [
    `One finished film frame: ${shot.title}, at ${round4(at)} s.`,
    "",
    "IMAGE 1 IS THE GREYBOX FRAME OF THIS EXACT MOMENT, and it is the composition. Keep its framing, its camera angle, " +
      "its lens and its distance; keep every character in the position, the facing and the size in frame that it gives them. " +
      "Its grey shapes are PLACEHOLDERS, not the look — render them as the real people and the real set, staged exactly as they stand there. " +
      "Do not re-stage, do not re-frame, do not move the camera, do not add or remove anybody.",
  ];
  if (people.length) {
    lines.push(
      `Appearance comes ONLY from the character sheets: ${people.map((person) => person.name).join(" and ")}, ` +
        "face, hair, wardrobe and props as the sheets show them, in the greybox's positions — never in the sheets' poses or framing.",
    );
  }
  if (setName) lines.push(`The set's structure is the greybox's; take ONLY ${setName}'s materials, colours and light direction from its concept frame.`);
  if (beats.length) lines.push(`What is happening in this frame: ${beats.join("; ")}.`);
  const looks = [setRecord?.look, ...people.map((person) => person.look)].filter(Boolean);
  if (looks.length) lines.push(`Look: ${looks.join(" ")}`);
  if (styleRef) {
    lines.push(
      "THE LAST REFERENCE IMAGE IS THE FILM'S STYLE REFERENCE: match its rendering idiom, palette, light quality and finish, " +
        "and take nothing else from it — not its composition, not its characters, not its place.",
    );
  }
  lines.push("Cinematic light, no text, no captions, no watermark, no split screen, no collage, no extra frames.");
  return lines.join("\n");
}

/**
 * Render a KEY FRAME: the picture of this shot, and the storyboard.
 *
 * It is made from the greybox, never beside it. The greybox is the one place
 * the film's space, staging and camera exist, so an image model is handed
 * that exact frame for the composition and the bible for the appearance; the
 * result is what the creator reviews in the lineup and what the take carries
 * as `@Image1`. An image model takes direction about camera and composition
 * that a video model will not, which is why the picture is settled here,
 * while it still costs cents.
 */
function cmdAnchor(dir, opts, now) {
  const shot = loadShot(dir);
  let id;
  try { id = slugId(opts.id ?? "first", "--id"); } catch (error) { return fail(error.message); }
  const at = opts.at === undefined ? 0 : Number(opts.at);
  if (!Number.isFinite(at) || at < 0 || at > shot.spec.seconds + 1e-6) {
    fail(`--at must be a second inside this shot's ${shot.spec.seconds} s (got: ${opts.at})`);
  }
  const projectRoot = requireProjectRoot(dir, "an anchor frame");
  requireGate("anchor", projectRoot);
  const greybox = greyboxLane(dir, shot, { finalOnly: true });
  requireTool("ffmpeg");

  // The composition reference: this shot's own greybox, at that second.
  const frame = frameAtTime(at, greybox.fps, greybox.frames);
  const compositionRel = `anchors/${id}.greybox.png`;
  extractOneFrame(dir, greybox.file, frame, join(dir, compositionRel), { width: null, scratch: "anchor" });

  // In the order the image model reads them, by authority: the composition
  // first (the greybox frame), then appearance — the people and the place —
  // then the film's style reference last, if the project registered one.
  // The board is NOT here: a drawing made before the greybox is a second
  // composition for the same second, and the picture comes from the greybox.
  const references = [join(dir, compositionRel)];
  for (const character of shot.characters ?? []) {
    const record = readBibleRecord(projectRoot, "characters", character);
    const sheet = record?.sheet?.file ? join(projectRoot, "bible", "characters", character, record.sheet.file) : null;
    if (sheet && existsSync(sheet)) references.push(sheet);
    else note(`WARN: character "${character}" has no sheet in the bible — the key frame invents their look`);
  }
  if (shot.set) {
    const record = readBibleRecord(projectRoot, "sets", shot.set);
    const concept = record?.concept?.file ? join(projectRoot, "bible", "sets", shot.set, record.concept.file) : null;
    if (concept && existsSync(concept)) references.push(concept);
    // A set concept is optional — a place may be carried by the words in its
    // bible record, which `anchorPrompt` puts in the prompt's "Look:" line.
    else if (String(record?.look || record?.description || "").trim()) {
      note(`[previz] set "${shot.set}" has no concept frame — the place comes from the words in its bible record`);
    } else {
      note(`WARN: set "${shot.set}" has neither a concept frame nor a written look — the key frame invents the place`);
    }
  }
  const style = styleKeyframe(projectRoot);
  if (style && !style.path) {
    note(`WARN: backlot.json names ${style.rel} as the film's style reference but the file is gone — the key frame goes without it`);
  }
  const styleFile = style?.path ?? null;
  if (styleFile) references.push(styleFile);

  if (opts.prompt !== undefined && opts["prompt-file"] !== undefined) {
    fail("--prompt and --prompt-file are two prompts for one frame — pass whichever one you mean");
  }
  if (opts["prompt-file"] !== undefined && !existsSync(resolveInput(opts["prompt-file"]))) {
    fail(`--prompt-file: no such file: ${resolveInput(opts["prompt-file"])}`);
  }
  const prompt = opts["prompt-file"]
    ? readFileSync(resolveInput(opts["prompt-file"]), "utf-8").trim()
    : (opts.prompt ?? anchorPrompt(shot, projectRoot, at, { styleRef: Boolean(styleFile) }));
  if (!prompt) fail("the prompt is empty — a key frame is made from a prompt somebody can read afterwards");

  const script = requireSharedScript("generate_image.mjs", "BACKLOT_IMAGE_MODULE", "an anchor frame");
  const outDir = join(dir, "anchors");
  mkdirSync(outDir, { recursive: true });
  const args = [
    prompt,
    "--output-dir", outDir,
    "--filename-prefix", id,
    "--output-format", "png",
    "--aspect-ratio", opts["aspect-ratio"] ?? nearestAspect(shot.spec.width, shot.spec.height),
    ...(opts.quality ? ["--quality", opts.quality] : []),
    ...references.flatMap((file) => ["--image-urls", file]),
  ];
  note(`[previz] key frame "${id}" at ${round4(at)} s — greybox frame ${frame}/${greybox.frames} plus ${references.length - 1} appearance reference(s)${styleFile ? " (the last one is the film's style reference)" : ""}; the request is leaving now`);
  const run = runNodeScript(script, args);
  const reported = run.code === 0 ? lastJsonObject(run.stdout) : null;
  const produced = Array.isArray(reported?.files) ? reported.files[0] : null;
  if (run.code !== 0 || !produced || !existsSync(produced)) {
    fail(`generate_image.mjs failed (exit ${run.code}):\n${tail(run.stderr)}`);
  }

  // Record what came back, not what was ordered: a provider that ignored
  // --output-format leaves a JPEG, and a record that says otherwise is a
  // reference nobody can open.
  const size = pngSize(readFileSync(produced));
  const extension = size ? "png" : (/\.([A-Za-z0-9]+)$/.exec(produced)?.[1] ?? "png").toLowerCase();
  if (!size) note(`WARN: the image came back as .${extension}, not PNG — it is recorded under that name`);
  const rel = `anchors/${id}.${extension}`;
  if (resolve(produced) !== resolve(join(dir, rel))) {
    copyFileSync(produced, join(dir, rel));
    rmSync(produced, { force: true });
  }

  // The vendor's own number when it reports one; anything else is labelled
  // for what it is.
  const usd = Number(reported?.usage?.cost);
  const cost = Number.isFinite(usd) && usd >= 0 ? { usd: round4(usd), basis: "reported" } : costFromOpts(opts, "anchor frame");

  let record;
  const { shot: saved } = commitShot(dir, (fresh) => {
    const anchors = Array.isArray(fresh.anchors) ? fresh.anchors : [];
    const previous = anchors.find((entry) => entry && entry.id === id);
    record = {
      id,
      at: round4(at),
      file: rel,
      revision: Number(previous?.revision ?? 0) + 1,
      prompt,
      refs: references.map((file) => relFromProject(projectRoot, file)),
      greybox: { file: compositionRel, source: greybox.rel, revision: Number(fresh.greybox?.revision ?? 0), frame },
      model: reported?.model ?? null,
      cost,
      createdAt: Date.parse(now),
    };
    fresh.anchors = [...anchors.filter((entry) => !entry || entry.id !== id), record].filter(Boolean);
  });
  note(`[previz] key frame "${id}" revision ${record.revision} → ${rel}. Look at it beside the greybox it was rendered from: previz.mjs lineup <shot-dir>`);
  return emit({
    command: "anchor",
    dir,
    anchor: record,
    anchors: saved.anchors.map((entry) => ({ id: entry.id, at: entry.at, revision: entry.revision, file: entry.file })),
    size,
    next: nextStage(saved, promptState(dir, saved)),
  });
}

/**
 * The joint review, as one picture: the key frames | the greybox frames they
 * were rendered from — and a legacy board last, when an old film has one.
 *
 * This is what the creator looks at before any video is bought. The order is
 * the order the pictures were made in now: the greybox fixes the space and
 * the camera, the key frame is that exact second in the film's look, and the
 * only question the previz gate asks is whether they are the same picture.
 * The shot's beats are written underneath.
 */
function cmdLineup(dir, opts) {
  const shot = loadShot(dir);
  const ffmpeg = requireTool("ffmpeg");
  const recorded = (shot.anchors ?? []).filter((entry) => entry && entry.file);
  let shown = [];
  if (opts.id !== undefined) {
    let wanted;
    try { wanted = slugId(opts.id, "--id"); } catch (error) { return fail(error.message); }
    const one = anchorById(shot, wanted);
    if (!one || !one.file) {
      fail(`no key frame "${wanted}" on this shot (${recorded.map((entry) => entry.id).join(", ") || "none recorded"})`);
    }
    shown = [one];
  } else {
    // `first` leads — it is the frame the take opens on — and the rest follow
    // in the order they were written.
    const lead = anchorById(shot, "first");
    shown = [...(lead && lead.file ? [lead] : []), ...recorded.filter((entry) => entry.id !== "first")];
  }
  shown = shown.filter((entry) => existsSync(join(dir, entry.file)));

  const secondOf = (value, flag) => {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > shot.spec.seconds + 1e-6) {
      fail(`${flag} must be a second inside this shot's ${shot.spec.seconds} s (got: ${value})`);
    }
    return seconds;
  };
  // One greybox frame per key frame, at that key frame's own second, so each
  // pair can be read across. `--at` overrides them all with one moment.
  const seconds = opts.at !== undefined
    ? [secondOf(opts.at, "--at")]
    : (shown.length ? [...new Set(shown.map((entry) => secondOf(entry.at ?? 0, "the key frame's recorded second")))] : [0]);
  const at = seconds[0];
  const greybox = greyboxLane(dir, shot);
  const frames = seconds.map((second) => frameAtTime(second, greybox.fps, greybox.frames));
  const frame = frames[0];

  const panels = [];
  const missing = [];
  for (const entry of shown) {
    panels.push({
      kind: "anchor",
      file: join(dir, entry.file),
      label: `key frame ${entry.id} · rev ${entry.revision ?? 1} · ${stamp(entry.at ?? 0)}`,
    });
  }
  if (shown.length === 0) missing.push("anchor");

  const work = scratchDir(dir, "lineup");
  try {
    // `extractFrames` dedupes and sorts, so the second a tile shows is looked
    // up by its frame number rather than by position — two key frames close
    // enough to share a frame share a tile, and neither is mislabelled.
    const secondOfFrame = new Map();
    for (const [index, number] of frames.entries()) {
      if (!secondOfFrame.has(number)) secondOfFrame.set(number, seconds[index]);
    }
    const tiles = extractFrames(greybox.file, frames, join(work, "greybox"), { width: null });
    for (const tile of tiles) {
      const second = secondOfFrame.get(tile.frame) ?? 0;
      panels.push({
        kind: "greybox",
        file: tile.path,
        label: `greybox · ${stamp(second)} · f ${tile.frame}/${greybox.frames}`,
      });
    }
    // A board is a legacy picture — drawn before the greybox existed, on a
    // film shot under the old order. It is shown last and never expected.
    const boardFile = shot.board?.file ? join(dir, shot.board.file) : null;
    if (boardFile && existsSync(boardFile)) {
      panels.push({ kind: "board", file: boardFile, label: `board (legacy) · rev ${shot.board.revision ?? 1}` });
    } else if (shot.board?.file) {
      note(`NOTE: this shot records ${shot.board.file} but the file is gone — the lineup shows what exists`);
    }
    if (missing.includes("anchor")) {
      note("NOTE: this shot has no key frame yet — the lineup shows the greybox alone (previz.mjs anchor <shot-dir>)");
    }

    // Label the COPIES: the key frame and the board are records.
    let labels = true;
    const staged = panels.map((panel, index) => {
      const path = copyInto(panel.file, join(work, `panel_${index}.png`));
      if (labels && !labelTile(path, panel.label)) labels = false;
      return path;
    });

    const footer = (shot.beats ?? []).map((beat) => `${round4(beat.from)}–${round4(beat.to)} ${beat.label}`).join("  ·  ").slice(0, 220);
    const scale = staged.map((_, index) => `[${index}:v]scale=-2:${LINEUP_HEIGHT}[p${index}]`).join(";");
    const joined = staged.length > 1
      ? `${scale};${staged.map((_, index) => `[p${index}]`).join("")}hstack=inputs=${staged.length}[row]`
      : `${scale};[p0]null[row]`;
    const font = fontFile();
    const canLabel = drawtextSupported().ok && Boolean(footer);
    const graph = canLabel
      ? `${joined};[row]pad=iw:ih+44:0:0:color=0x111113,drawtext=text='${escapeText(footer)}'${font ? `:fontfile='${escapeText(font)}'` : ""}:fontsize=20:fontcolor=white:x=12:y=h-32[out]`
      : `${joined};[row]null[out]`;
    const outPath = opts.out ? resolveInput(opts.out) : join(dir, "lineup.png");
    mkdirSync(dirname(outPath), { recursive: true });
    runToolOrFail(
      ffmpeg.path,
      ["-y", "-v", "error", ...staged.flatMap((path) => ["-i", path]), "-filter_complex", graph, "-map", "[out]", "-frames:v", "1", outPath],
      { label: "ffmpeg lineup" },
    );
    if (!labels || !canLabel) note(`NOTE: ${drawtextSupported().reason ?? "there are no beats to write under the panels"} — the lineup is unlabelled.`);
    return emit({
      command: "lineup",
      dir,
      panels: panels.map((panel) => ({ kind: panel.kind, label: panel.label })),
      missing,
      at: round4(at),
      frame,
      greybox: tiles.map((tile) => ({ at: round4(secondOfFrame.get(tile.frame) ?? 0), frame: tile.frame })),
      beats: (shot.beats ?? []).map((beat) => ({ id: beat.id, label: beat.label, from: beat.from, to: beat.to, detail: beat.detail ?? null })),
      continuity: shot.continuity ?? null,
      height: LINEUP_HEIGHT,
      size: pngSize(readFileSync(outPath)),
      labels: labels && canLabel,
      file: relPath(dir, outPath),
    });
  } finally {
    dropScratch(dir);
  }
}

// ---------------------------------------------------------------------------
// reference
// ---------------------------------------------------------------------------

function cmdReference(dir, videoArg, opts) {
  const shot = loadShot(dir);
  if (!videoArg) fail("reference needs a video: previz.mjs reference <shot-dir> <video> [--in s --out s]");
  const source = resolveInput(videoArg);
  if (!existsSync(source)) fail(`no such file: ${source}`);
  const ffmpeg = requireTool("ffmpeg");
  requireTool("ffprobe");

  const sourceProbe = probeVideo(source, { counted: false });
  const inSeconds = opts.in === undefined ? 0 : Number(opts.in);
  if (!Number.isFinite(inSeconds) || inSeconds < 0) fail(`--in must be a non-negative number of seconds (got: ${opts.in})`);
  const sourceSeconds = sourceProbe.seconds ?? 0;
  const outSeconds = opts.out === undefined ? sourceSeconds : Number(opts.out);
  if (!Number.isFinite(outSeconds) || outSeconds <= inSeconds) fail(`--out must be later than --in (${inSeconds} .. ${outSeconds})`);

  const fps = opts["adopt-spec"] ? (sourceProbe.fps ?? shot.spec.fps) : shot.spec.fps;
  const snapped = snapSeconds(Math.min(outSeconds, sourceSeconds || outSeconds) - inSeconds, fps);
  const even = evenSize(sourceProbe.width ?? shot.spec.width, sourceProbe.height ?? shot.spec.height);

  mkdirSync(join(dir, "reference", "frames"), { recursive: true });
  const outRel = "reference/source.mp4";
  const outFile = join(dir, outRel);
  const staged = join(dir, "reference", ".source.staging.mp4");
  note(`[previz] trimming ${snapped.seconds} s (${snapped.frames} frames at ${fps} fps) from ${basename(source)}`);
  runToolOrFail(
    ffmpeg.path,
    ["-y", "-v", "error", "-ss", String(inSeconds), "-i", source, "-t", String(snapped.seconds),
      "-vf", `scale=${even.width}:${even.height},fps=${fps}`,
      "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-movflags", "+faststart", staged],
    { label: "ffmpeg trim" },
  );
  decodeCheck(staged);
  const probe = probeVideo(staged);
  renameSync(staged, outFile);

  // Cuts: showinfo prints one line per frame the scene score jumped at.
  const cutRun = runTool(ffmpeg.path, ["-v", "info", "-i", outFile, "-vf", `select='${escapeExpr("gt(scene,0.35)")}',showinfo`, "-fps_mode", "passthrough", "-f", "null", "-"], { label: "ffmpeg scene detect" });
  const cuts = cutRun.code === 0 ? parseSceneCuts(cutRun.stderr) : [];
  if (cutRun.code !== 0) note("WARN: scene detection failed — cuts are reported as none found, which is not the same as none present");
  if (cuts.length) note(`WARN: ${cuts.length} cut(s) detected at ${cuts.join(", ")} s — a shot is ONE continuous take; trim to a single one`);

  const probeFrames = probe.frames ?? snapped.frames;
  const times = evenlySpacedTimes({ frames: probeFrames, fps: probe.fps ?? fps, count: Number(opts.count ?? 9) });
  const work = scratchDir(dir, "reference");
  const kept = [];
  try {
    const wanted = times.map((t) => frameAtTime(t, probe.fps ?? fps, probeFrames));
    const extracted = extractFrames(outFile, wanted, work, { width: TILE_WIDTH });
    for (const tile of extracted) {
      const keep = join(dir, "reference", "frames", `f_${String(tile.frame).padStart(4, "0")}.png`);
      copyFileSync(tile.path, keep);
      kept.push(`reference/frames/${basename(keep)}`);
    }
  } finally {
    dropScratch(dir);
  }
  const sheet = writeSheet(dir, {
    file: outFile, times, fps: probe.fps ?? fps, frames: probeFrames,
    outPath: join(dir, "reference", "sheet.png"), scratch: "reference-sheet",
  });

  const reference = {
    file: outRel,
    sourceName: basename(source),
    in: Math.round(inSeconds * 10000) / 10000,
    out: Math.round((inSeconds + snapped.seconds) * 10000) / 10000,
    probe,
    cuts,
    sheet: "reference/sheet.png",
    frames: kept,
    adoptedSpec: false,
  };

  let adopted = null;
  if (opts["adopt-spec"]) {
    try {
      adopted = makeSpec({
        seconds: probe.seconds ?? snapped.seconds,
        fps: Math.round(probe.fps ?? fps),
        width: probe.width ?? even.width,
        height: probe.height ?? even.height,
      });
      reference.adoptedSpec = true;
    } catch (error) {
      return fail(`--adopt-spec: ${error.message}`);
    }
  }

  // Trimming, cut detection and the sheet are minutes of ffmpeg; write the
  // reference block (and, when asked, the spec) into the shot as it is now.
  const { shot: saved } = commitShot(dir, (fresh) => {
    fresh.reference = reference;
    if (!adopted) return;
    fresh.spec = adopted;
    fresh.assumptions = [
      ...(fresh.assumptions ?? []).filter((line) => !line.startsWith("spec adopted from the reference")),
      `spec adopted from the reference ${basename(source)}: ${adopted.seconds} s / ${adopted.fps} fps / ${adopted.width}x${adopted.height} (${adopted.frames} frames)`,
    ];
    const past = (fresh.beats ?? []).filter((beat) => beat.to > adopted.seconds + 1e-6);
    if (past.length) note(`WARN: ${past.length} beat(s) now run past the adopted ${adopted.seconds} s — re-load the timeline with 'beats --set'`);
  });

  return emit({
    command: "reference", dir, source, file: outRel, probe, cuts,
    trimmed: { in: reference.in, out: reference.out, seconds: snapped.seconds, frames: snapped.frames, fps },
    frames: kept, sheet: "reference/sheet.png", sheetLabels: sheet.labels,
    adoptedSpec: adopted, spec: saved.spec,
    next: nextStage(saved, promptState(dir, saved)),
  });
}

// ---------------------------------------------------------------------------
// generate
// ---------------------------------------------------------------------------

function promptState(dir, shot) {
  const file = join(dir, shot.prompt?.file ?? "prompts.md");
  if (!existsSync(file)) return { promptOk: false, promptReason: `${relPath(dir, file)} does not exist`, refs: null };
  // A free shot attaches no video, so a pack that never says `@Video1` is
  // the correct pack — the requirement follows the conditioning.
  const parsed = parsePromptPack(readFileSync(file, "utf-8"), { requireVideo: usesGreybox(shot) });
  return { promptOk: parsed.ok, promptReason: parsed.reason, prompt: parsed.prompt, refs: parsed.refs };
}

/** `@Image2` — how the prompt addresses one attached reference. */
function refTag(ref) {
  return `@${ref.kind.charAt(0).toUpperCase()}${ref.kind.slice(1)}${ref.index}`;
}

/** "@Video1 greybox/greybox.mp4 (greybox), @Image1 …" — what actually went
 *  with the job, in the words the prompt addresses them by, and what each
 *  one is there to hold. */
function describeRefs(refs) {
  if (!refs.length) return "nothing";
  return refs.map((ref) => `${refTag(ref)} ${ref.file}${ref.role ? ` (${ref.role})` : ""}`).join(", ");
}

/**
 * Write what a take became into the record that is on disk NOW.
 *
 * A take takes minutes; an agent records checks and renders in that window,
 * and `generate` writing back the document it read at submit time erases
 * them. Only the one take record — matched by id — is this command's to
 * write. A take record that is no longer there is not re-appended: somebody
 * else owns that file's shape now, and a paid job is too important to
 * resurrect into a document this process no longer understands.
 */
function mergeTake(dir, takeId, patch, { seed = false } = {}) {
  const fresh = loadShot(dir);
  const entry = (fresh.takes ?? []).find((item) => item.id === takeId);
  if (!entry) {
    return { ok: false, reason: `${takeId} is no longer in ${relPath(dir, shotPath(dir))} — something else rewrote the takes list while the job ran` };
  }
  Object.assign(entry, patch);
  const seeded = seed ? seedChecklist(fresh) : [];
  saveShot(dir, fresh);
  return { ok: true, shot: fresh, take: entry, seeded };
}

/** A take whose record vanished mid-flight. The job left this machine and may
 *  have been billed, so it is printed in full and dropped next to its prompt
 *  rather than written into a takes list this process cannot reconcile. */
function orphanTake(dir, take, reason) {
  const rescue = join(dir, "takes", `${take.id}.orphan.json`);
  let kept = null;
  // Not writeJsonAtomic: that exits the process on failure, and the record
  // printed below is the last copy of a job that may have been billed.
  try {
    mkdirSync(dirname(rescue), { recursive: true });
    writeFileSync(rescue, `${JSON.stringify(take, null, 2)}\n`);
    kept = relPath(dir, rescue);
  } catch (error) {
    note(`WARN: could not write ${rescue} (${error.message}) — the take record exists only on stdout`);
  }
  process.stdout.write(`${JSON.stringify({ ok: false, command: "generate", dir, take, orphanFile: kept, error: reason }, null, 2)}\n`);
  process.stderr.write(`ERROR: ${reason}. The take is NOT in shot.json; its record is above${kept ? ` and in ${kept}` : ""} — reconcile it by hand before generating again.\n`);
  return 1;
}

/** The anchor frame with this id, or null. `first` is the opening frame and
 *  the one `generate` leads with. */
function anchorById(shot, id) {
  return (shot.anchors ?? []).find((entry) => entry && entry.id === id) ?? null;
}

/**
 * Everything the paid job is conditioned on besides the prompt, gathered from
 * the film rather than from the agent's memory.
 *
 * THE ORDER IS THE ADDRESSING, and this function is its single authority:
 * `generate` attaches what it returns and `prompt-skeleton` writes the
 * assignment sentences from the same list, so the pack and the job can never
 * name different pictures.
 *
 *   @Video1   the final greybox — layout, positions, timing, camera, and
 *             ONLY when the shot is conditioned on one (`greybox`, `hybrid`);
 *             a `free` shot attaches no video at all and its first image is
 *             `@Image1`,
 *   @Image…   this shot's character sheets, in bible order, so two shots
 *             with the same cast address the same character at the same
 *             index,
 *   @Image…   the film's ONE style key frame (`backlot.mjs style`),
 *   @Audio1…  the voice sample of each character with a spoken line.
 *
 * FEWER PICTURES, AND ONLY ONE OF THEM IS A COMPOSITION. Three acceptance
 * rounds (2026-09-21) added a picture beside the greybox each time — a
 * storyboard drawing, then a key frame rendered from the greybox, then a set
 * concept — and every one of them brought its own framing and fought the
 * greybox for it. The upstream practice this mode reproduces never had them:
 * the greybox is the only picture of layout, behaviour and camera; the words
 * carry the look; a key frame is a weak fallback for a model that takes no
 * video reference at all ("仅支持图片时导出关键帧并明确这是弱约束",
 * `upstream/.../references/video-generation.md`). So a sheet says a face and
 * the style frame says an idiom — and nothing else has a composition of its
 * own.
 *
 * THE HAND-OFF FRAME IS THE SAME ARGUMENT, and it took a whole film to see
 * it. Eight 720p takes (round 3's night run, 2026-09-21): every shot that
 * carried a hand-off frame inherited the PREVIOUS shot's camera, not its own
 * greybox's — s02 kept s01's high viewpoint over its designed low angle, s04
 * and s05 kept s03's over-the-shoulder framing over the side two-shot and the
 * profile close-up. The shots generated without one followed their greybox.
 * A hand-off is a picture with a composition, so it fights @Video1 exactly
 * like a board does. Continuity travels as WORDS instead — the pack's
 * 第一帧/最后一帧 lines — and the frame is opt-in (`--with-handoff`).
 *
 * The key frames, a legacy board, the set concept and the hand-off frame are
 * therefore OPT-IN (`generate --with-anchors` / `--with-board` /
 * `--with-concept` / `--with-handoff`). The set's appearance travels as TEXT,
 * out of its bible record and into the pack's global block.
 *
 * A reference the bible does not have yet is reported, not invented. `plan`
 * carries the display names the skeleton needs; `refs` is the record shape
 * that goes onto the take — `{ kind, index, file, role }`.
 */
/**
 * A `free` shot is the round-3 verdict in the reference list: eight
 * consistent shots and no 亮点, because a block a pawn cannot act in
 * constrains the body in proportion to its displacement. Shot free — the
 * same exchange, the sheets, the style frame and a prompt written for the
 * action — came back with the first 亮点 of the project. So the video
 * reference is a per-shot decision, and `free` means the first image is
 * `@Image1`.
 */
function planReferences(
  dir,
  shot,
  projectRoot,
  { greyboxFile = null, handoff = null, withAnchors = false, withBoard = false, withConcept = false, withHandoff = false } = {},
) {
  const plan = [];
  const videos = [];
  const images = [];
  const audios = [];
  const warnings = [];
  const rel = (absolute) => (projectRoot ? relFromProject(projectRoot, absolute) : absolute);
  const attach = (kind, absolute, role, name = null) => {
    const bucket = kind === "video" ? videos : kind === "image" ? images : audios;
    bucket.push(absolute);
    plan.push({ kind, index: bucket.length, file: rel(absolute), role, name });
  };

  // The block, when this shot is conditioned on one. `free` sends none, and
  // then every index below moves up by one — which is exactly why the
  // skeleton and `generate` read the list from this one function.
  if (usesGreybox(shot) && greyboxFile) attach("video", greyboxFile, "greybox");

  // OPT-IN, and never by default: a key frame has a composition of its own,
  // and a second composition of the same second is what a model averages.
  let attachedAnchors = 0;
  if (withAnchors) {
    const anchors = (shot.anchors ?? []).filter((entry) => entry && entry.file);
    const leadAnchor = anchorById(shot, "first");
    const attachAnchor = (record) => {
      const file = join(dir, record.file);
      if (!existsSync(file)) {
        warnings.push(`key frame "${record.id}" is recorded as ${record.file} but the file is gone — the take goes without it`);
        return;
      }
      attachedAnchors += 1;
      attach("image", file, `anchor:${record.id}`, record.id);
    };
    if (leadAnchor && leadAnchor.file) attachAnchor(leadAnchor);
    for (const record of anchors) {
      if (record.id === "first") continue;
      attachAnchor(record);
    }
    if (attachedAnchors === 0) {
      warnings.push("--with-anchors was asked for and this shot has no key frame on disk — the take goes with the greybox alone");
    }
  }

  // Compatibility only, and opt-in too: a film shot before the key frames
  // existed may still have a drawing. Boards are not drawn any more.
  if (withBoard) {
    const boardFile = shot.board?.file ? join(dir, shot.board.file) : null;
    if (boardFile && existsSync(boardFile)) {
      attach("image", boardFile, "board");
      if (attachedAnchors > 0) {
        warnings.push("this take carries a legacy board AND a key frame — two compositions of the same second, which the model averages; send one of them");
      }
    } else if (shot.board?.file) {
      warnings.push(`the board frame ${shot.board.file} is recorded but missing from disk — the take goes without it`);
    } else {
      warnings.push("--with-board was asked for and this shot has no board — boards are not drawn any more (the greybox is the composition)");
    }
  }

  let manifest = null;
  if (projectRoot) {
    try { manifest = readManifest(projectRoot); } catch { manifest = null; }
  }
  // Bible order, so two shots that carry the same cast address the same
  // character at the same index.
  const wanted = shot.characters ?? [];
  const inBible = (manifest?.characters ?? []).filter((id) => wanted.includes(id));
  const ordered = [...inBible, ...wanted.filter((id) => !inBible.includes(id))];
  for (const id of ordered) {
    const record = readBibleRecord(projectRoot, "characters", id);
    const file = record?.sheet?.file ? join(projectRoot, "bible", "characters", id, record.sheet.file) : null;
    if (!file || !existsSync(file)) {
      warnings.push(`character "${id}" has no sheet in the bible — the take goes without their look`);
      continue;
    }
    attach("image", file, `character:${id}`, record?.name || id);
  }
  // The set travels as WORDS by default (its bible `look`, carried into the
  // pack's global block): a concept frame is a wide establishing picture with
  // a camera of its own, and the camera is the greybox's.
  if (withConcept && shot.set) {
    const record = readBibleRecord(projectRoot, "sets", shot.set);
    const file = record?.concept?.file ? join(projectRoot, "bible", "sets", shot.set, record.concept.file) : null;
    if (file && existsSync(file)) {
      attach("image", file, `set:${shot.set}`, record?.name || shot.set);
    } else {
      warnings.push(`--with-concept was asked for and set "${shot.set}" has no concept frame in the bible — the take goes without it`);
    }
  }

  // The film's ONE style key frame: how this film is rendered, and nothing
  // about what is in the frame. It is what carries the look now that no
  // other picture is allowed a composition.
  const style = projectRoot ? styleKeyframe(projectRoot) : null;
  if (style && style.path) {
    attach("image", style.path, "style");
  } else if (style) {
    warnings.push(`backlot.json names ${style.rel} as the film's style reference but the file is gone — the take goes without the one picture that says how this film is rendered`);
  } else {
    warnings.push("this film has no style key frame — the take is told its look in words only. Register one with 'backlot.mjs style <project> --keyframe <png>'");
  }

  // The frame this shot opens on — OPT-IN, and LAST when it is asked for:
  // it is the most specific instruction the job carries, and adherence decays
  // with position. Off by default because it brought the previous shot's
  // CAMERA with it in every continuing shot of the eight-take run; the entry
  // sentence says the same thing without a composition.
  if (withHandoff) {
    if (handoff && handoff.file) {
      attach("image", handoff.file, "handoff", handoff.from ?? null);
    } else {
      warnings.push(
        "--with-handoff was asked for and this shot continues nothing — there is no frame to hand over " +
          "(declare it with 'previz.mjs meta <shot-dir> --continues-from <shot> --entry \"…\" --exit \"…\"')",
      );
    }
  }

  // One sample per SPEAKER, in the order their first line is spoken.
  const speakers = [];
  for (const line of spokenLines(shot)) {
    if (line.speaker && !speakers.includes(line.speaker)) speakers.push(line.speaker);
  }
  for (const speaker of speakers) {
    const record = readBibleRecord(projectRoot, "characters", speaker);
    const sample = record?.voice?.sample?.file
      ? join(projectRoot, "bible", "characters", speaker, record.voice.sample.file)
      : null;
    if (!sample || !existsSync(sample)) {
      warnings.push(`"${speaker}" speaks on screen but has no voice sample in the bible — the model picks a voice of its own`);
      continue;
    }
    attach("audio", sample, `voice:${speaker}`, record?.name || speaker);
  }

  return { plan, refs: plan.map(({ kind, index, file, role }) => ({ kind, index, file, role })), videos, images, audios, warnings };
}

/** Another shot of the same film, read-only. `previz.mjs` writes exactly one
 *  `shot.json` per run — the one it was pointed at. */
function readPeerShot(projectRoot, id, why) {
  const dir = join(projectRoot, "shots", id);
  const path = shotPathOf(dir);
  if (!existsSync(path)) {
    fail(`${why}: there is no ${relFromProject(projectRoot, path)} — "${id}" is named as an earlier shot but has no shot directory`);
  }
  try {
    return { dir, shot: normalizeShot(readJson(path, `shots/${id}/shot.json`)) };
  } catch (error) {
    return fail(`${path}: ${error.message}`);
  }
}

/** The take a shot DELIVERS, or null. Only a selected, finished take with a
 *  file counts: that is the one that reaches the cut. */
function deliveredTake(shot) {
  const take = (shot.takes ?? []).find((entry) => entry?.selected === true);
  return take && take.status === "done" && take.file ? take : null;
}

/**
 * Cut the frame this shot OPENS on out of the shot it continues.
 *
 * The frame is the last one of the previous shot that reaches the FILM — its
 * trim's `out`, not its render's end — because that is the picture the
 * audience sees immediately before this shot starts. It is written to
 * `takes/handoff-in.png`.
 *
 * IT IS NOT SENT TO THE MODEL unless `--with-handoff` asks for it: the frame
 * carried the previous shot's camera into every continuing shot of the
 * eight-take run (2026-09-21 night). Cut anyway, because it is the evidence
 * `take-handoff` is answered from (`compare --handoff`), and because the
 * ORDER OF SHOOTING is the other half of the hand-off: a shot that claims
 * one continuous action still waits for the shot it continues.
 *
 * Refuses when the previous shot has no selected take: a hand-off from a take
 * nobody chose is a hand-off from a frame that will not be in the film.
 * `--no-handoff` overrides that, and the take records that it did.
 */
function resolveHandoff(dir, shot, projectRoot, { skip = false, attached = false } = {}) {
  const from = shot.continuity?.from ?? null;
  if (!from) {
    if (skip) note("NOTE: --no-handoff does nothing here — this shot declares no continuity, so no frame was going to be handed over");
    return null;
  }
  if (skip) {
    note(
      `WARN: --no-handoff — this shot says it continues "${from}", and the take is being generated OUT OF ORDER: ` +
        "that shot's frame is not cut at all. It is recorded on the take as skipped, 'take-handoff' still has to be " +
        "answered by eye, and there is no recorded out-frame for 'compare --handoff' to judge it against.",
    );
    return { skipped: true, from };
  }

  const { dir: peerDir, shot: peer } = readPeerShot(projectRoot, from, "hand-off");
  const take = deliveredTake(peer);
  if (!take) {
    const recorded = (peer.takes ?? []).map((entry) => `${entry.id} (${entry.status}${entry.selected ? ", selected" : ""})`);
    fail(
      `this shot continues "${from}", and "${from}" has no selected take — the hand-off frame is the last frame of the take ` +
        `that actually reaches the cut, so there has to be one. Takes on "${from}": ${recorded.join(", ") || "none"}.\n` +
        `  - previz.mjs select ${peerDir} <take>   (once its checks pass)\n` +
        "  - or previz.mjs generate <shot-dir> --no-handoff   (generates without that frame and records it on the take)",
    );
  }
  const source = join(peerDir, take.file);
  if (!existsSync(source)) {
    fail(`"${from}" delivers ${take.id}, but ${relFromProject(projectRoot, source)} is gone — re-generate that shot, or pass --no-handoff`);
  }

  const probe = Number.isFinite(Number(take.probe?.fps)) && Number.isFinite(Number(take.probe?.frames))
    ? take.probe
    : probeVideo(source);
  const fps = Number(probe.fps) || peer.spec?.fps || shot.spec.fps;
  const frames = Number(probe.frames) || peer.spec?.frames || null;
  if (!frames) fail(`ffprobe could not count the frames of ${relFromProject(projectRoot, source)} — the hand-off frame cannot be cut from a clip of unknown length`);
  const end = peer.trim?.out != null ? Number(peer.trim.out) : (probe.seconds ?? frames / fps);
  const frame = lastFrameBefore(end, fps, frames);
  const at = round4(timeOfFrame(frame, fps));

  const rel = "takes/handoff-in.png";
  const file = join(dir, rel);
  extractOneFrame(dir, source, frame, file, { width: null, scratch: "handoff" });
  note(
    `[previz] hand-off: frame ${frame}/${frames} of ${from}/${take.id} (${stamp(at)}${peer.trim ? `, the last frame its trim uses` : ""}) ` +
      `→ ${rel}` +
      (attached
        ? ", attached as the LAST image reference (--with-handoff)"
        : " — NOT sent to the model: continuity travels as the pack's 第一帧/最后一帧 text, and this frame is what " +
          "'compare --handoff' answers 'take-handoff' from. '--with-handoff' attaches it as well."),
  );
  return {
    from,
    take: take.id,
    source: relFromProject(projectRoot, source),
    frame,
    at,
    trimmed: peer.trim ? { in: peer.trim.in, out: peer.trim.out } : null,
    file,
    rel,
  };
}

/**
 * The hand-off as a take records it and a report prints it: `"skipped"`, the
 * frame it was measured against, or null when the shot continues nothing.
 *
 * `attached` is the part a reader cannot recover afterwards: the frame is cut
 * for `compare --handoff` either way, and whether the MODEL was shown it is
 * what decides how a `take-handoff` pass may be read. A record written before
 * `--with-handoff` existed has no field and was attached.
 */
function handoffRecord(handoff, attached = false) {
  if (!handoff) return null;
  if (handoff.skipped) return "skipped";
  return {
    from: handoff.from,
    take: handoff.take,
    source: handoff.source,
    frame: handoff.frame,
    at: handoff.at,
    trimmed: handoff.trimmed,
    file: handoff.rel,
    attached: Boolean(attached),
  };
}

function readBibleRecord(projectRoot, family, id) {
  if (!projectRoot || !id) return null;
  const path = join(projectRoot, "bible", family, id, family === "characters" ? "character.json" : "set.json");
  if (!existsSync(path)) return null;
  try {
    const doc = JSON.parse(readFileSync(path, "utf-8"));
    return doc && typeof doc === "object" && !Array.isArray(doc) ? doc : null;
  } catch {
    return null;
  }
}

/**
 * Transcribe the take that landed and answer `take-lines` from what it
 * actually says.
 *
 * Runs after the money is spent, so nothing here may lose the take: every
 * failure ends as `unverified` with the reason in the note, never as a
 * thrown error over a recorded take.
 */
function verifySpokenLines(dir, shot, take, now) {
  const lines = spokenLines(shot);
  if (lines.length === 0) return null;
  const file = join(dir, take.file);
  const transcriptRel = `takes/${take.id}.transcript.json`;
  let status = "unverified";
  let note_ = "";
  let coverage = null;
  let transcript = null;

  const script = sharedScript("transcribe.mjs", "BACKLOT_TRANSCRIBE_MODULE");
  if (!script.path) {
    note_ = "transcribe.mjs is not installed beside this skill — the spoken lines were not verified";
  } else {
    if (script.overridden) note(`WARN: BACKLOT_TRANSCRIBE_MODULE is set — the transcript comes from ${script.path}, not from transcribe.mjs`);
    // Transcribe in the film's language: left to detect, wizper returned an
    // English rendering of Chinese lines and every spoken line read as
    // missing (trial 4, 2026-09-22).
    const language = filmLanguage(findProjectRoot(dir));
    const run = runNodeScript(script.path, ["--input", file, "--language", language, "--json"], { timeoutMs: 600_000 });
    const reported = run.code === 0 ? lastJsonObject(run.stdout) : null;
    if (run.code !== 0 || typeof reported?.text !== "string") {
      note_ = `transcription failed (exit ${run.code}): ${tail(run.stderr, 3) || "no transcript"}`;
    } else {
      transcript = reported;
      coverage = transcriptCoverage(reported.text, lines);
      status = coverage.ok ? "pass" : "fail";
      note_ = coverage.ok
        ? `every spoken line is in the transcript (${lines.length})`
        : `missing from the transcript: ${coverage.missing.map((entry) => `"${entry.text}"`).join(", ")} — what it said: "${String(reported.text).slice(0, 200)}"`;
    }
  }

  if (transcript) {
    try {
      writeJsonAtomic(join(dir, transcriptRel), {
        take: take.id,
        at: now,
        lines: lines.map((line) => ({ id: line.id, speaker: line.speaker, text: line.text })),
        missing: coverage?.missing ?? [],
        text: transcript.text,
        chunks: transcript.chunks ?? [],
      });
    } catch (error) {
      note(`WARN: could not write ${transcriptRel} (${error.message}) — the verdict below is recorded, its evidence is not`);
    }
  }
  if (status !== "pass") note(`WARN: take-lines is "${status}" on ${take.id} — ${note_}`);

  const { shot: saved } = commitShot(dir, (fresh) => {
    seedChecklist(fresh);
    recordCheck(fresh, { id: "take-lines", status, target: take.id, note: note_, at: now });
  });
  return { status, note: note_, file: transcript ? transcriptRel : null, missing: coverage?.missing ?? [], shot: saved };
}

// ---------------------------------------------------------------------------
// prompt-skeleton — the pack, with this shot's own indices (v3)
// ---------------------------------------------------------------------------

/** Seconds as a prompt writes them: one decimal for a whole number, so a
 *  timeline reads `0.0–0.5` rather than `0–0.5`. */
function sec(value) {
  const n = round4(Number(value));
  return Number.isInteger(n) ? n.toFixed(1) : String(n);
}

/** A DURATION as a sentence says it: "6 秒", not "6.0 秒". */
function dur(value) {
  return String(round4(Number(value)));
}

const CJK_CHAR = /[㐀-䶿一-鿿぀-ヿ가-힯]/g;
const LATIN_CHAR = /[A-Za-z]/g;

/**
 * Chinese or English scaffolding, decided by the FILM and not by a flag.
 *
 * Seedance is a ByteDance model and reads Chinese natively; a Chinese film
 * whose prompt is scaffolded in English makes the creator read a pack in a
 * language their film is not in. The vote is taken over `screenplay.md` and
 * `idea.md` — a CJK character carries about as much as three Latin letters,
 * so that is the weight used — and falls back to the film's title and
 * logline for a project that has neither file yet.
 */
function filmLanguage(projectRoot) {
  let sample = "";
  if (projectRoot) {
    for (const rel of ["screenplay.md", "idea.md"]) {
      const file = join(projectRoot, rel);
      if (!existsSync(file)) continue;
      try { sample += `${readFileSync(file, "utf-8")}\n`; } catch { /* unreadable is not CJK evidence */ }
    }
    if (!sample.trim()) {
      try {
        const manifest = readManifest(projectRoot);
        sample = `${manifest.title ?? ""} ${manifest.logline ?? ""}`;
      } catch { /* no manifest — English is the safe default */ }
    }
  }
  const cjk = (sample.match(CJK_CHAR) ?? []).length;
  const latin = (sample.match(LATIN_CHAR) ?? []).length;
  return cjk > 0 && cjk * 3 >= latin ? "zh" : "en";
}

/** The aspect ratio Seedance names, nearest to what this shot renders. */
const SEEDANCE_ASPECTS = [[21, 9], [16, 9], [4, 3], [1, 1], [3, 4], [9, 16]];
function aspectLabel(spec) {
  const ratio = Number(spec?.width) / Number(spec?.height);
  if (!Number.isFinite(ratio) || ratio <= 0) return "16:9";
  let best = [16, 9];
  let bestError = Infinity;
  for (const [w, h] of SEEDANCE_ASPECTS) {
    const error = Math.abs(Math.log(ratio / (w / h)));
    if (error < bestError) { bestError = error; best = [w, h]; }
  }
  return `${best[0]}:${best[1]}`;
}

/**
 * How many timeline segments a clip of this length may carry.
 *
 * One segment, one main event: a segment that walks, changes location and
 * explodes is a segment the model rushes or drops. At the 4–8 s the mode
 * works in this is a segment every 1–1.3 s (4 s → 4, 6 s → 5, 8 s → 6), and
 * it is capped at 7 because past that a long clip loses the identity of its
 * people and its rhythm — the creator's own number for 30 s is 5–7.
 */
function segmentBudget(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.max(1, Math.min(7, Math.round(2 + n / 2)));
}

/**
 * The beats as a CONTIGUOUS, non-overlapping partition of the whole clip.
 *
 * Three rules, each paid for by a take:
 *
 * 1. The camera beat is not a segment. It is one move over the whole clip and
 *    it is said once, in the global block; written per segment it reads as
 *    several moves and the model resolves that by cutting.
 * 2. No gaps and no overlaps. Every second of the clip is rendered whether or
 *    not the pack describes it, so a gap is a second the model invents, and
 *    an overlap is two instructions for the same second.
 * 3. Never more than the budget above, and a merge CONCATENATES the designed
 *    details rather than shortening them — the merge moves boundaries, it
 *    does not delete design.
 */
function planSegments(shot) {
  const seconds = Number(shot.spec?.seconds) || 0;
  const clamp = (value) => Math.min(Math.max(round4(Number(value) || 0), 0), seconds);
  const beats = (shot.beats ?? [])
    .filter((beat) => beat && beat.kind !== "camera")
    .map((beat) => ({ ...beat, from: clamp(beat.from), to: clamp(beat.to) }))
    .sort((a, b) => a.from - b.from || a.to - b.to);
  const budget = segmentBudget(seconds);
  if (!beats.length) return { segments: [{ from: 0, to: seconds, beats: [] }], budget, merged: 0, beats: 0 };

  // The partition: each designed beat owns the clock from where it starts to
  // where the next one starts. A gap between two beats belongs to the earlier
  // one (something is happening there, and it is that beat settling); an
  // overlap is cut at the later beat's start.
  const bounds = [0];
  for (let index = 1; index < beats.length; index += 1) {
    bounds.push(Math.min(Math.max(beats[index].from, bounds[index - 1]), seconds));
  }
  bounds.push(seconds);
  let segments = beats.map((beat, index) => ({ from: bounds[index], to: bounds[index + 1], beats: [beat] }));

  const join = (index) => {
    segments.splice(index, 2, {
      from: segments[index].from,
      to: segments[index + 1].to,
      beats: [...segments[index].beats, ...segments[index + 1].beats],
    });
  };
  // A zero-length segment is two beats sharing a second; the clock cannot
  // show them apart, so the pack should not pretend it can.
  for (let index = 0; index + 1 < segments.length;) {
    if (segments[index].to - segments[index].from < 1e-6) join(index);
    else index += 1;
  }
  const designed = segments.length;
  while (segments.length > budget) {
    let at = 0;
    let span = Infinity;
    for (let index = 0; index + 1 < segments.length; index += 1) {
      const combined = segments[index + 1].to - segments[index].from;
      if (combined < span - 1e-9) { span = combined; at = index; }
    }
    join(at);
  }
  return { segments, budget, merged: designed - segments.length, beats: beats.length };
}

/** Does this text already say what the segment's own scaffolding would ask
 *  for? A designed detail that names the shot size, the light or the body
 *  does not need a placeholder telling the agent to add one. */
const SAYS_SHOT_SIZE = /全景|中景|近景|特写|远景|过肩|大景|中全|wide|medium shot|close-?up|long shot|two-?shot|establishing|over-the-shoulder/i;
const SAYS_LOOK = /材质|质感|光|影|色|布|纱|金属|石|木|尘|烟|雾|texture|material|light|shadow|colou?r|dust|smoke|fabric|cloth|metal|stone|wood|grain|glow/i;
const SAYS_BODY = /步|走|跑|跳|跃|落|手|臂|腿|膝|肩|指|头|转身|呼吸|表情|眼|脸|姿|站|蹲|step|walk|run|leap|jump|land|hand|arm|leg|knee|shoulder|finger|head|turn|breath|face|eyes|stance|crouch|rise|grip|weight/i;
/** The camera vocabulary, for the "two moves in one segment" warning. Each
 *  entry is one MOVE; two of them in one line is the contradiction the model
 *  resolves by cutting. */
const CAMERA_MOVES = [
  /推近|推进|推镜/, /拉远|拉镜/, /摇镜|横摇|摇到/, /平移|横移|移镜/, /跟拍|跟随/, /环绕|绕拍/, /升镜|上升|升起/, /降镜|下降/, /变焦|变形焦|推拉变焦/, /俯拍|仰拍/,
  /\bdolly\b/i, /\bpan(?:s|ning)?\b/i, /\btilt(?:s|ing)?\b/i, /\btrack(?:s|ing)?\b/i, /\borbit(?:s|ing)?\b/i, /\bcrane\b/i, /\bpush(?:es|ing)? in\b/i, /\bpull(?:s|ing)? (?:out|back)\b/i, /\bzoom(?:s|ing)?\b/i, /\bhandheld\b/i,
];

/** The shared scaffolding of a v3 pack, in the two languages the mode writes.
 *  Kept in one table so the Chinese and the English pack can be read against
 *  each other in one screen — they have to say the same thing. */
const PACK_TEXT = {
  zh: {
    replace:
      "以 @Video1 为空间、站位与机位的参考：几何占位体按下列对应关系就是这些人物，严格继承其摄影机运动、景别、整体位置、空间关系与运动路径。几何体只表示位置和移动方向，不提供肢体参考。",
    mapping: "【素材映射】",
    brief: "【一句话成片】",
    global: "【全局设定】",
    timeline: "【时间戳分镜】",
    locks: "【全局锁】",
    greybox:
      "只参考运镜、构图、切点、主体轨迹、相对比例与遮挡关系；不要继承灰白材质、空场景、几何体外形与 Viewport 叠加物。",
    todoRef: "<TODO: 这一张只提供什么，不提供什么>",
    // The geography line's own two fixed words: the label 【全局设定】 hangs
    // the sentence on, and the placeholder a landmark with a colour outside
    // the palette leaves behind.
    geography: "地理",
    todoColour: "<TODO: 颜色>",
    firstFrame: "第一帧",
    lastFrame: "最后一帧",
    todoEntry: "<TODO: 第一帧上有什么——每个人的位置、朝向、手里的东西、彼此的距离>",
    todoExit: "<TODO: 最后半秒停在什么状态——下一镜要从这里接>",
    todoStyle: "<TODO: 风格一句话，例如「写实东方电影感，变形宽银幕，细腻胶片颗粒，浅景深」>",
    todoSet: "<TODO: 这个地方长什么样——材质、颜色、尺度与陈设，写在 bible 的 set 记录里>",
    todoStyleShort: "<TODO: 风格>",
    todoSubject: "<TODO: 这一镜一句话讲什么>",
    todoLight: "<TODO: 光源方向、时间与色温；白模那层平光不算数>",
    todoLightFree: "<TODO: 光源方向、时间与色温>",
    todoEnd: "<TODO: 这一下运镜停在什么画面上>",
    todoSize: "<TODO: 景别>",
    todoFrame: "<TODO: 构图>",
    todoGrow: "<TODO: 这一段的材质与光影怎么长出来>",
    todoBody: "<TODO: 肢体怎么自然化——真实的步子与重心，不是滑行>",
    todoBeat: "<TODO: 这一段发生了什么，写成看得见的动作与后果>",
    // A free shot has no block to be "naturalised" away from: what the
    // segment still owes is the verbs — of the body and of the camera.
    todoBodyFree: "<TODO: 这一段身体与镜头的动作动词——蹬、转、落、停、跟、甩，以及重量与惯性>",
    todoRoom: "<TODO: 这一场专属的禁止项，例如多余的武器、道具或动物>",
    todoActions: "<TODO: 这一镜真正发生的动作，例如「起跳、落地卸力、站定对峙」>",
    todoAmbience: "<TODO: 两三种这一镜真的会响的环境声>",
    todoEffects: "<TODO: 这一下该有的音效>",
  },
  en: {
    replace:
      "Replace the geometric placeholders in @Video1 with the subjects they map to, strictly inheriting the camera move, the shot sizes, the cut points, the overall positions, the spatial relationships and the motion paths. The blocks carry position and direction of travel only; they are not a body reference.",
    mapping: "【References】",
    brief: "【One-line brief】",
    global: "【Global】",
    timeline: "【Timeline】",
    locks: "【Locks】",
    greybox:
      "use only the camera move, the framing, the cut points, the subjects' paths, the relative scale and what occludes what; do not inherit the grey surfacing, the empty set, the block shapes or any viewport overlay.",
    todoRef: "<TODO: what this reference is for, and what it is not for>",
    geography: "Geography",
    todoColour: "<TODO: colour>",
    firstFrame: "First frame",
    lastFrame: "Last frame",
    todoEntry: "<TODO: what is on screen in frame 1 — each body's position, facing, what is in their hands, the distance between them>",
    todoExit: "<TODO: what the last half second settles on — the next shot is cut from here>",
    todoStyle: "<TODO: the look in one phrase, e.g. \"realistic cinematic, anamorphic widescreen, fine film grain, shallow depth of field\">",
    todoSet: "<TODO: what this place looks like — materials, colours, scale and dressing; write it into the set's bible record>",
    todoStyleShort: "<TODO: the look>",
    todoSubject: "<TODO: what this one shot is about, in one line>",
    todoLight: "<TODO: the light — direction, time of day, colour temperature; the greybox's flat studio light does not count>",
    todoLightFree: "<TODO: the light — direction, time of day, colour temperature>",
    todoEnd: "<TODO: the frame this move settles on>",
    todoSize: "<TODO: shot size>",
    todoFrame: "<TODO: composition>",
    todoGrow: "<TODO: how the materials and the light grow in over this segment>",
    todoBody: "<TODO: how the body becomes natural — real steps and real weight, not a sliding block>",
    todoBeat: "<TODO: what happens here, as visible action with a physical consequence>",
    todoBodyFree: "<TODO: the body and camera verbs of this segment — push, turn, land, stop, follow, whip — with their weight and inertia>",
    todoRoom: "<TODO: what this shot in particular must not contain — an extra weapon, prop or animal>",
    todoActions: "<TODO: the actions this shot really contains, e.g. \"the leap, the landing, the settle\">",
    todoAmbience: "<TODO: the two or three sounds this shot actually makes>",
    todoEffects: "<TODO: the effects this moment needs>",
  },
};

/** The colour names the pack says out loud, in the two languages it writes.
 *  `previz_kit.LANDMARK_PALETTE` is the authority for which eight exist; this
 *  is only how each one is SPELLED to the model. */
const COLOUR_WORDS = {
  zh: { red: "红", blue: "蓝", yellow: "黄", green: "绿", magenta: "品红", cyan: "青", orange: "橙", purple: "紫", white: "白", grey: "灰", dark: "深灰" },
  en: { red: "red", blue: "blue", yellow: "yellow", green: "green", magenta: "magenta", cyan: "cyan", orange: "orange", purple: "purple", white: "white", grey: "grey", dark: "dark grey" },
};

/**
 * What the greybox's sidecar says about the picture the take will carry.
 *
 * `subjects` names the pawns, `landmarks` says what each colour in the frame
 * MEANS, and `subjectsDetail` says which colour each pawn is and what is
 * standing behind it at the first and last frame. One reader, so the mapping
 * lines and the geography sentence can never disagree with each other.
 */
function greyboxMeta(dir, shot) {
  const empty = { present: false, subjects: [], landmarks: [], subjectsDetail: [] };
  const file = join(dir, shot.greybox?.meta ?? "greybox/scene.meta.json");
  if (!existsSync(file)) return empty;
  try {
    const meta = JSON.parse(readFileSync(file, "utf-8"));
    return {
      present: true,
      subjects: Array.isArray(meta?.subjects) ? meta.subjects.map((name) => String(name)) : [],
      landmarks: Array.isArray(meta?.landmarks) ? meta.landmarks.filter((entry) => entry && typeof entry === "object") : [],
      subjectsDetail: Array.isArray(meta?.subjects_detail) ? meta.subjects_detail.filter((entry) => entry && typeof entry === "object") : [],
    };
  } catch {
    return empty;
  }
}

/** A landmark's prose name — what `landmark(..., label=...)` was given, or
 *  its id when nobody wrote one. */
function landmarkLabel(entry) {
  const label = String(entry?.label ?? "").trim();
  return label || String(entry?.name ?? "");
}

/**
 * The job one attached reference is there to do — POSITIVE SCOPE AND EXPLICIT
 * EXCLUSION, in the sentence the model reads.
 *
 * The ROLE decides it, so the skeleton and `generate` can never describe the
 * same picture differently. Every line starts with the tag and a colon: that
 * is what `validateReferenceAssignments` reads, and a reference nobody gave a
 * job to is averaged into the shot with its own light and framing.
 */
function assignmentFor(ref, shot, language = "en", context = {}) {
  const L = PACK_TEXT[language] ?? PACK_TEXT.en;
  const zh = language === "zh";
  const tag = refTag(ref);
  const role = String(ref.role ?? "");
  const lead = `${tag}${zh ? "：" : ": "}`;
  // A free shot has no block to point at, so no line may send the model
  // looking for one: the sheet is a face, the set is a sentence, and the
  // camera is words.
  const blocked = usesGreybox(shot);
  if (role === "greybox") return `${lead}${L.greybox}`;
  if (role === "anchor:first") {
    // The key frame IS this shot's storyboard, rendered from the same
    // greybox frame @Video1 opens on — so it agrees with the blocking by
    // construction and may be trusted for the opening composition. What it
    // cannot say is how the shot moves: that is the timeline's.
    return zh
      ? `${lead}本镜的分镜稿，由 @Video1 的第一帧渲染而来：只参考开场的构图、机位、人物位置与整体画风，不用它当成全程动作——动作照时间戳与白模。`
      : `${lead}this shot's storyboard, rendered from @Video1's own opening frame: use the opening composition, the camera, where each person stands and the overall style — not the motion, which follows the timeline and the greybox.`;
  }
  if (role.startsWith("anchor:")) {
    const record = anchorById(shot, role.slice("anchor:".length));
    const at = sec(record?.at ?? 0);
    return zh
      ? `${lead}第 ${at} 秒的分镜稿：只参考那一刻的光线、色调与质感，不用它的构图。`
      : `${lead}the key frame at ${at} s: use only the light, the palette and the surfaces of that moment — not its composition.`;
  }
  if (role === "board") {
    // Only a film shot before the key frames existed still carries one.
    return zh
      ? `${lead}只参考开场构图与画面意图（旧版分镜稿），不用它的笔触与画质。`
      : `${lead}use only the opening composition and the intent of the frame (a legacy storyboard drawing) — not its brushwork or its resolution.`;
  }
  if (role.startsWith("character:")) {
    const id = role.slice("character:".length);
    const name = ref.name ?? id;
    if (!blocked) {
      return zh
        ? `${lead}这是${name}，只参考这张的脸型、发型、服装与配饰，不用它的姿势、构图与背景。`
        : `${lead}this is ${name}; use only this sheet's face, hair, clothing and accessories — not its pose, its framing or its background.`;
    }
    const pawn = context.pawns?.[id] ?? null;
    // The pawn's COLOUR is a fact the greybox already recorded, so the
    // skeleton fills it instead of asking the agent to go and look at a
    // frame — which is what left `<TODO: 它的颜色…>` vague in trial 4. Only
    // the position is still a placeholder, because only the picture knows it.
    const colour = pawn ? (context.pawnColours?.[id] ?? null) : null;
    const painted = zh
      ? (colour ? `白模中名为「${pawn}」的${colour}色体块就是${name}，` : `白模中名为「${pawn}」的体块（<TODO: 它的颜色与第 1 帧位置>）就是${name}，`)
      : (colour ? `the ${colour} block named "${pawn}" in the greybox is ${name}; ` : `the block named "${pawn}" in the greybox (<TODO: its colour and where it stands at frame 1>) is ${name}; `);
    const block = zh
      ? (pawn ? painted : `白模中的 <TODO: 哪一个体块——颜色与第 1 帧位置> 就是${name}，`)
      : (pawn ? painted : `<TODO: which block — its colour and where it stands at frame 1> in the greybox is ${name}; `);
    return zh
      ? `${lead}${block}只参考这张的脸型、发型、服装与配饰，不用背景。`
      : `${lead}${block}use only this sheet's face, hair, clothing and accessories — not its background.`;
  }
  if (role.startsWith("set:")) {
    const name = ref.name ?? role.slice("set:".length);
    if (!blocked) {
      return zh
        ? `${lead}只参考这张里${name}的材质、色调与光线方向，不用图中人物，也不用它的构图与机位。`
        : `${lead}use only this frame's materials, palette and light direction for the ${name} — not the people in it, and not its composition or camera.`;
    }
    return zh
      ? `${lead}场景结构以白模空间为准，只参考这张里${name}的材质、色调与光线方向，不用图中人物，也不用它的构图。`
      : `${lead}the set's structure comes from the greybox space; use only this frame's materials, palette and light direction for the ${name} — not the people in it, and not its composition.`;
  }
  if (role === "style") {
    // The film's one style picture. It says HOW the film is drawn and
    // nothing about what is in the frame — the moment it is allowed a
    // composition it is competing with @Video1.
    return zh
      ? `${lead}全片画风参考，只参考画风、线条与上色方式，不参考构图与人物。`
      : `${lead}the film's style reference: use only the rendering idiom, the line and the colouring — not its composition and not the people in it.`;
  }
  if (role === "handoff") {
    // Only on a job asked for it by name (`--with-handoff`). The exclusion
    // carries the camera now: the frame's own viewpoint is the thing it
    // smuggled into three shots of the eight-take run.
    const from = ref.name ?? shot.continuity?.from ?? "?";
    const camera = zh
      ? (blocked ? "（那些以 @Video1 为准）" : "（本镜的机位由下面的文字决定）")
      : (blocked ? " (those are @Video1's)" : " (this shot's camera is the one the text below describes)");
    return zh
      ? `${lead}只参考上一镜（${from}）结束时每个人的位置、朝向与手里的东西，本镜第一帧从这里接上；不用它的机位、景别与构图${camera}，也不用它的画质瑕疵。`
      : `${lead}use only where everybody stands, which way they face and what is in their hands at the end of the previous shot (${from}) — this shot's frame 1 continues from exactly that. Not its camera position, shot size or framing${camera}, and not its compression artefacts.`;
  }
  if (role.startsWith("voice:")) {
    const name = ref.name ?? role.slice("voice:".length);
    return zh
      ? `${lead}只参考${name}的音色与语速，不用其中的内容与环境声。`
      : `${lead}use only ${name}'s timbre and pace — not the words in it or the room it was recorded in.`;
  }
  return `${lead}${L.todoRef}`;
}

/**
 * The prompt pack v3, built mechanically from the shot.
 *
 * The block order is the doctrine in `references/prompting.md`, and it is the
 * order the creator's own Seedance template uses:
 *
 *   the replacement sentence → 【素材映射】 → 【一句话成片】 → 【全局设定】
 *   → 【时间戳分镜】 → 声音 → the "regenerate naturally" line → 【全局锁】
 *
 * Front-loaded because adherence decays with position: what may not be
 * negotiated (what each reference is for, and that the grey surfacing is not
 * the look) is first, and the prohibitions are last where a negative belongs.
 *
 * Everything here is already written down somewhere — the references
 * `generate` will attach, the beats and their designed detail, the spoken
 * lines and their seconds, the trim, the hand-off. **The detail is carried
 * whole.** There is no word budget: a cap copied from text-to-video guides is
 * what made the first acceptance run delete the design.
 *
 * A `free` shot is the same pack with the greybox taken out of it: no
 * replacement sentence, no `@Video1` line, no 按白模路线, no 白模 in the
 * locks — and a camera that is allowed to move with the action, which is
 * the whole reason the shot was taken out of the block. A `hybrid` shot is
 * the greybox pack plus the sentence that lets the body and the camera
 * accelerate inside the given layout.
 */
function buildSkeleton(dir, shot, projectRoot, attachments = {}) {
  const greybox = shot.greybox ?? {};
  const conditioning = conditioningOf(shot);
  const free = conditioning === "free";
  const hybrid = conditioning === "hybrid";
  const greyboxRel = greybox.final?.file ?? greybox.preview?.file ?? "greybox/greybox.mp4";
  const handoff = shot.continuity?.from
    ? { from: shot.continuity.from, file: join(dir, "takes", "handoff-in.png") }
    : null;
  const planned = planReferences(dir, shot, projectRoot, { greyboxFile: join(dir, greyboxRel), handoff, ...attachments });
  const warnings = [...planned.warnings];
  if (!free && !greybox.final) warnings.push("there is no final greybox yet — @Video1 is the file 'generate' will attach once there is one");
  // Whether continuity reaches the model as a PICTURE or as WORDS. Read off
  // the plan rather than the flag, so the pack can never describe an
  // attachment the job will not make.
  const handoffAttached = planned.plan.some((ref) => ref.role === "handoff");

  const language = filmLanguage(projectRoot);
  const L = PACK_TEXT[language];
  const zh = language === "zh";
  const seconds = Number(shot.spec?.seconds) || 0;

  // The pawn names the greybox actually carries, matched to the bible ids, so
  // a mapping line can point at a block rather than at a colour nobody wrote
  // down — and the colour the kit painted that block, so the line does not
  // leave the agent to go and read it off a frame.
  const { present, subjects, landmarks, subjectsDetail } = greyboxMeta(dir, shot);
  const words = COLOUR_WORDS[language] ?? COLOUR_WORDS.en;
  const pawns = {};
  const pawnColours = {};
  for (const id of shot.characters ?? []) {
    const match = subjects.find((name) => name.toLowerCase() === String(id).toLowerCase())
      ?? subjects.find((name) => name.toLowerCase().includes(String(id).toLowerCase()));
    if (!match) continue;
    pawns[id] = match;
    const detail = subjectsDetail.find((entry) => String(entry?.name ?? "") === match);
    const word = words[String(detail?.color ?? "")];
    if (word) pawnColours[id] = word;
  }
  // A blocked shot whose RENDERED greybox names no places is a take the
  // model will geography for itself, one invention per shot. Said here rather
  // than left to a reviewer, because the pack looks complete without it. A
  // shot not rendered yet already carries the "no final greybox" warning.
  if (!free && present && landmarks.length === 0) {
    warnings.push(
      "the greybox declares no landmarks — nothing in @Video1 tells the model what is behind whom; " +
        "declare them with previz_kit.landmark(...) and re-render",
    );
  }
  for (const entry of landmarks) {
    if (String(entry?.color ?? "") !== "custom") continue;
    warnings.push(
      `landmark "${entry?.name}" was given a colour of its own rather than a palette one, so the pack names it ` +
        "by a placeholder — use a palette colour (previz_kit.LANDMARK_PALETTE) so the prompt can say which block it is",
    );
  }

  const body = [];
  // 1 — the replacement instruction, before anything else. A free shot has
  // no placeholders to replace, and its opening is the film sentence.
  if (!free) {
    body.push(L.replace);
    body.push("");
  }

  // 【一句话成片】: the whole clip in one sentence, so the model knows what it
  // is making before it is told the seconds. On a free shot this is the
  // OPENING — subject and motion first is the vendor's own advice, and there
  // is no replacement sentence in front of it any more.
  const aspect = aspectLabel(shot.spec);
  let filmTitle = "";
  if (projectRoot) {
    try { filmTitle = String(readManifest(projectRoot).title ?? ""); } catch { filmTitle = ""; }
  }
  const brief = [
    L.brief,
    free
      ? (zh
          ? `${filmTitle ? `《${filmTitle}》· ` : ""}${shot.title}：${L.todoStyleShort}的 ${dur(seconds)} 秒、${aspect} 成片——${L.todoSubject}。`
          : `${filmTitle ? `"${filmTitle}" — ` : ""}${shot.title}: a ${dur(seconds)} s, ${aspect} film in ${L.todoStyleShort} — ${L.todoSubject}.`)
      : (zh
          ? `${filmTitle ? `《${filmTitle}》· ` : ""}${shot.title}：把白模渲染成${L.todoStyleShort}的 ${dur(seconds)} 秒、${aspect} 成片——${L.todoSubject}。`
          : `${filmTitle ? `"${filmTitle}" — ` : ""}${shot.title}: render the greybox as a ${dur(seconds)} s, ${aspect} film in ${L.todoStyleShort} — ${L.todoSubject}.`),
    "",
  ];
  if (free) body.push(...brief);

  // 2 — 【素材映射】: one line per attached reference, in the order and at the
  // indices `generate` will attach them, each with its scope AND its exclusion.
  // A free shot with no sheets and no style frame carries nothing, and an
  // empty block is a heading the model has to interpret — so it is left out
  // and the missing style frame is already a warning.
  if (planned.plan.length > 0) {
    body.push(L.mapping);
    for (const ref of planned.plan) {
      body.push(assignmentFor(ref, shot, language, { pawns, pawnColours }));
      // WHAT EACH COLOUR IN @Video1 MEANS, directly under the line that says
      // what @Video1 is for. Without these the model sees coloured lumps and
      // decides per take which one is the shop — seven takes of one street in
      // trial 4 disagreed about exactly that.
      if (free || ref.role !== "greybox") continue;
      for (const entry of landmarks) {
        const colour = String(entry?.color ?? "");
        const word = colour === "custom" ? null : words[colour];
        const said = word ?? L.todoColour;
        body.push(zh
          ? `@Video1 中的${said}体块 = ${landmarkLabel(entry)}。`
          : `The ${said} block in @Video1 is the ${landmarkLabel(entry)}.`);
      }
    }
    body.push("");
  }

  if (!free) body.push(...brief);

  // 4 — 【全局设定】: style, light and THE ONE CAMERA MOVE. The camera beat's
  // designed sentence is carried here in full; it is not a timeline line,
  // because a move written per segment reads as several moves.
  const cameraBeats = (shot.beats ?? []).filter((beat) => beat && beat.kind === "camera");
  const move = cameraBeats[0] ?? null;
  const cameraSentence = move
    ? (move.detail
        ? String(move.detail).trim()
        : (zh ? `${move.label}（${sec(move.from)}–${sec(move.to)} 秒）——${L.todoEnd}` : `${move.label} (${sec(move.from)}–${sec(move.to)} s) — ${L.todoEnd}`))
    : L.todoEnd;
  body.push(L.global);
  body.push(zh ? `风格：${L.todoStyle}。` : `Style: ${L.todoStyle}.`);
  // THE SET IS WORDS. Its structure is the greybox's; what it is made of,
  // what colour it is and what the light does to it come out of the bible
  // record as text, because a concept frame is a wide establishing picture
  // with a camera of its own and the camera is @Video1's.
  const setRecord = shot.set && projectRoot ? readBibleRecord(projectRoot, "sets", shot.set) : null;
  if (shot.set) {
    const setName = setRecord?.name || shot.set;
    const written = String(setRecord?.look || setRecord?.description || "").trim();
    const described = written || L.todoSet;
    // With a block, the structure of the place is @Video1's and only its
    // materials are words. Free, the sentence is the whole place.
    body.push(
      zh
        ? `场景：${setName}——${described.replace(/[。.]+$/, "")}。${free ? "" : "空间结构以 @Video1 为准。"}`.trimEnd()
        : `Set: ${setName} — ${described.replace(/[.]+$/, "")}.${free ? "" : " The spatial structure is @Video1's."}`,
    );
    if (!written) {
      warnings.push(
        `set "${shot.set}" has no written look in the bible — the set now reaches the model as TEXT only, so write it ` +
          `('backlot.mjs set set <project> ${shot.set} --look "…"') instead of leaving the placeholder in the pack`,
      );
    }
  }
  // GEOGRAPHY, said in words, from what the greybox already measured. The
  // block says where everything is; this says which of it is behind whom, so
  // the model cannot put the shop behind a character the shop is in front of
  // — and names the places that are NOT in the picture, which is what it
  // otherwise paints in anyway.
  if (!free && landmarks.length > 0) {
    const labelOf = (name) => {
      const entry = landmarks.find((item) => String(item?.name ?? "") === String(name));
      return entry ? landmarkLabel(entry) : String(name);
    };
    const names = zh ? (list) => list.map(labelOf).join("、") : (list) => list.map((n) => `the ${labelOf(n)}`).join(" and ");
    // The name the rest of the pack calls this person by — the bible name
    // where the pawn is a character, the pawn's own name otherwise.
    const displayOf = (subject) => {
      const id = Object.keys(pawns).find((key) => pawns[key] === subject);
      if (!id) return subject;
      // The bible, not the plan: a character whose sheet is missing is still
      // called by their name in every other line of this pack.
      const record = projectRoot ? readBibleRecord(projectRoot, "characters", id) : null;
      return String(record?.name || id);
    };
    const clauses = [];
    for (const entry of subjectsDetail) {
      const behind = entry?.behind;
      if (!behind || typeof behind !== "object") continue;
      const first = Array.isArray(behind.first) ? behind.first : [];
      const last = Array.isArray(behind.last) ? behind.last : [];
      if (first.length === 0 && last.length === 0) continue;
      const who = displayOf(String(entry.name ?? ""));
      if (first.length === 0) {
        // Nothing behind them as the clip opens, something by the end — a
        // walk into a place, said as the arrival it is.
        clauses.push(zh ? `${who}结束时身后是${names(last)}` : `by the end, behind ${who} is ${names(last)}`);
        continue;
      }
      const moved = last.join("\u0000") !== first.join("\u0000");
      const tail = !moved
        ? ""
        : zh
          ? (last.length ? `（结束时身后是${names(last)}）` : "（结束时身后什么也没有）")
          : (last.length ? ` (by the end, behind ${who} is ${names(last)})` : ` (by the end nothing is behind ${who})`);
      clauses.push(zh ? `${who}身后是${names(first)}${tail}` : `behind ${who} is ${names(first)}${tail}`);
    }
    const absent = landmarks
      .filter((entry) => entry?.in_frame && entry.in_frame.first === false && entry.in_frame.last === false)
      .map((entry) => String(entry.name ?? ""));
    if (absent.length > 0) {
      clauses.push(zh
        ? `画面里没有${names(absent)}`
        : `${names(absent)} ${absent.length > 1 ? "are" : "is"} not in frame`);
    }
    if (clauses.length > 0) {
      body.push(zh ? `${L.geography}：${clauses.join("；")}。` : `${L.geography}: ${clauses.join("; ")}.`);
    }
  }
  const todoLight = free ? L.todoLightFree : L.todoLight;
  body.push(zh ? `光线：${todoLight}。` : `Light: ${todoLight}.`);
  const stop = (text) => (zh ? (/[。.!?！？]$/.test(text) ? "" : "。") : (/[.!?]$/.test(text) ? "" : "."));
  if (free) {
    // THE POINT OF A FREE SHOT. Locked to a block, a pawn's body moves in
    // proportion to its displacement and the camera cannot accelerate; the
    // round-3 film was consistent and had no 亮点. Here the camera is words,
    // and it is allowed to chase the action.
    body.push(
      zh
        ? `运镜总原则：镜头由文字决定——${cameraSentence}${stop(cameraSentence)}`
        : `Camera: the camera is described here in words — ${cameraSentence}${stop(cameraSentence)}`,
    );
    body.push(zh
      ? "镜头随动作运动，允许加速与减速，最快处进入慢动作；全片一镜到底，不切、不加转场。"
      : "The camera moves with the action and may accelerate and decelerate; at the fastest moment it may fall into slow motion. One continuous take: no cut and no transition.");
  } else {
    body.push(
      zh
        ? `运镜总原则：一镜到底，只有一个运镜动作——${cameraSentence}${stop(cameraSentence)}`
        : `Camera: one continuous take, one move and no more — ${cameraSentence}${stop(cameraSentence)}`,
    );
    body.push(zh
      ? "镜头轨迹、机位与景别严格照 @Video1，全片不切、不加转场。"
      : "The camera path, the camera position and the shot sizes are @Video1's exactly; no cut and no transition.");
    // HYBRID: the block gives the geography, not the performance. Without
    // this sentence the model reads a pawn's even displacement as the
    // tempo of the body and the camera, which is what made round 3 stiff.
    if (hybrid) {
      body.push(zh
        ? "在白模给定的位置与机位路径内，允许身体动作与镜头速度有动态变化。"
        : "Within the positions and the camera path the greybox gives, the body action and the camera speed may vary dynamically.");
    }
  }
  // A continuing shot is the one place a model has a SECOND camera to copy:
  // the shot before it. Said in the global block because that is where the
  // camera is decided, and only when the pack carries the join as words —
  // with the frame attached, its own assignment line says the same thing.
  if (shot.continuity?.from && !handoffAttached) {
    body.push(zh
      ? (free
          ? "机位与景别按本镜上面写的运镜，不沿用上一镜的机位。"
          : "机位与景别以本镜白模 @Video1 为准，不沿用上一镜的机位。")
      : (free
          ? "The camera position and the shot size are the ones described above for this shot; do not carry over the previous shot's camera."
          : "The camera position and the shot size are this shot's own greybox @Video1; do not carry over the previous shot's camera."));
  }
  if (cameraBeats.length > 1) {
    warnings.push(
      `this shot has ${cameraBeats.length} camera beats (${cameraBeats.map((beat) => beat.id).join(", ")}) — one clip holds ONE move; ` +
        "the skeleton carries the first and leaves the rest to the cut",
    );
  }
  body.push("");

  // 5 — 【时间戳分镜】: a contiguous partition of the whole clip, every segment
  // one main event, each carrying its designed detail WHOLE.
  const plan = planSegments(shot);
  const trim = shot.trim
    ? (zh ? `成片只用 ${sec(shot.trim.in)}–${sec(shot.trim.out)} 秒，其余秒数照样会生成，也要有交代`
          : `the cut uses ${sec(shot.trim.in)}–${sec(shot.trim.out)} s; the rest is still rendered and still needs directing`)
    : (zh ? "整条都进成片" : "the whole clip reaches the cut");
  body.push(
    zh
      ? (free
          ? `${L.timeline}（共 ${dur(seconds)} 秒，严格按这些秒数演出；${trim}）`
          : `${L.timeline}（严格对齐白模秒数：共 ${dur(seconds)} 秒；${trim}）`)
      : (free
          ? `${L.timeline} (${dur(seconds)} s in total, played to these seconds exactly; ${trim})`
          : `${L.timeline} (locked to the greybox clock: ${dur(seconds)} s in total; ${trim})`),
  );
  // 第一帧: the entry state — and, when the model is NOT shown the frame it
  // continues, the sentence that has to carry the join on its own.
  const entryText = shot.continuity?.entry ?? L.todoEntry;
  const entryLead = shot.continuity?.from && !handoffAttached
    ? (zh ? `承接上一镜（${shot.continuity.from}）的结束状态：` : `continuing from the end of the previous shot (${shot.continuity.from}): `)
    : "";
  body.push(`${L.firstFrame}${zh ? "：" : ": "}${entryLead}${entryText}`);
  const spoken = spokenLines(shot).filter((line) => line.at != null);
  // A second on a boundary belongs to the LATER segment; a second at the very
  // end of the clip belongs to the last one, which has nowhere to hand it on.
  const holdsSecond = (segment, at, isLast) =>
    at >= segment.from - 1e-6 && (at < segment.to - 1e-6 || (isLast && at <= segment.to + 1e-6));
  for (const [index, segment] of plan.segments.entries()) {
    const pieces = [];
    const details = [];
    for (const beat of segment.beats) {
      if (beat.detail && String(beat.detail).trim()) details.push(String(beat.detail).trim());
      else details.push(zh ? `${beat.label}——${L.todoBeat}` : `${beat.label} — ${L.todoBeat}`);
    }
    if (!details.length) {
      details.push(zh
        ? "<TODO: 先把 beats 装进来——previz.mjs beats <shot-dir> --set beats.json>"
        : "<TODO: load the beats first — previz.mjs beats <shot-dir> --set beats.json>");
    }
    // The sentence-final stop goes: the detail is one clause of a longer line
    // now, and "…streaming behind.；按白模路线" is not a sentence.
    const designed = details.map((text) => text.replace(/[。.]+$/, "")).join(zh ? "；" : " ");
    // 景别 and 构图 are named on every line: v2's lines carried neither, and a
    // line with no shot size is a line the model frames however it likes.
    const opening = SAYS_SHOT_SIZE.test(designed) ? L.todoFrame : `${L.todoSize}${zh ? "，" : ", "}${L.todoFrame}`;
    pieces.push(opening);
    pieces.push(designed);
    // The greybox's own two lies, closed per segment: grey surfacing, and a
    // block that slides instead of walking. A free shot has neither — there
    // is no path to follow and nothing grey to disinherit, so the segment
    // owes its verbs instead.
    const kind = segment.beats[0]?.kind ?? "action";
    if (!free) {
      pieces.push(zh
        ? (kind === "hold" ? "按白模站位" : kind === "trigger" ? "按白模时机" : "按白模路线与时机")
        : (kind === "hold" ? "hold the greybox's position" : kind === "trigger" ? "at the greybox's moment" : "follow the greybox's path and timing"));
    }
    if (!SAYS_LOOK.test(designed)) pieces.push(L.todoGrow);
    if (!SAYS_BODY.test(designed)) pieces.push(free ? L.todoBodyFree : L.todoBody);
    // A line spoken on screen is quoted at its second, inside the segment that
    // holds that second — the partition stays contiguous.
    for (const line of spoken) {
      const at = Number(line.at);
      if (!holdsSecond(segment, at, index === plan.segments.length - 1)) continue;
      pieces.push(zh
        ? `第 ${sec(at)} 秒${line.speaker}开口说："${line.text}"`
        : `at ${sec(at)} s ${line.speaker} says "${line.text}"`);
    }
    body.push(`${sec(segment.from)}–${sec(segment.to)}${zh ? "秒：" : "s: "}${pieces.join(zh ? "；" : "; ")}${zh ? "。" : "."}`);
  }
  body.push(`${L.lastFrame}${zh ? "：" : ": "}${shot.continuity?.exit ?? L.todoExit}`);
  // A detail written in the other language is carried through as it stands —
  // translating is the agent's call, and the trap is translating by
  // shortening. Say it once, not once per beat.
  const details = (shot.beats ?? []).map((beat) => String(beat?.detail ?? "")).join(" ");
  const detailIsCjk = (details.match(CJK_CHAR) ?? []).length * 3 >= (details.match(LATIN_CHAR) ?? []).length;
  if (details.trim() && detailIsCjk !== zh) {
    warnings.push(
      `this film's pack is scaffolded in ${zh ? "Chinese" : "English"} and the beat details are written in ${detailIsCjk ? "Chinese" : "English"} — ` +
        "translate each one IN FULL where it sits, keeping every designed picture; shortening a detail to translate it is the design deleted",
    );
  }
  if (plan.merged > 0) {
    warnings.push(
      `${plan.beats} designed beats were merged into ${plan.segments.length} timeline segments (a ${dur(seconds)} s clip holds at most ${plan.budget}) — ` +
        "every detail is still there, only the boundaries moved; one main event per segment is what keeps the model from rushing or dropping one",
    );
  }
  body.push("");

  // 6 — sound. Named sounds, and no score: the cut lays one, and two pieces of
  // music in one film is a re-shot.
  const voiceOver = (shot.lines ?? []).filter((line) => line && line.kind === "vo");
  const dialogue = hasSpokenLine(shot)
    ? (zh ? "见时间戳，由模型在画面里念出" : "as timed above, spoken on screen by the model")
    : (zh ? "无" : "none");
  body.push(
    zh
      ? `声音：环境声 ${L.todoAmbience}；对白 ${dialogue}；音效 ${L.todoEffects}。不要配乐——配乐在成片阶段统一铺。${voiceOver.length ? "旁白也不在这一条里。" : ""}`
      : `Sound: ambience ${L.todoAmbience}; dialogue ${dialogue}; effects ${L.todoEffects}. No music — the score is laid under the whole film in the cut.${voiceOver.length ? " The voice-over is not in this take either." : ""}`,
  );
  body.push("");

  // 7 — regenerate the movement rather than transfer it. With no block to
  // transfer from, the sentence asks for the weight instead.
  body.push(
    free
      ? (zh
          ? `重新生成自然的${L.todoActions}，动作有真实的重量、惯性与速度变化。`
          : `Regenerate natural ${L.todoActions}, with real weight, inertia and changes of speed.`)
      : (zh
          ? `重新生成自然的${L.todoActions}，不迁移方块滑行或机械摆动。`
          : `Regenerate natural ${L.todoActions}; do not carry over block sliding or mechanical swing.`),
  );
  body.push("");

  // 8 — 【全局锁】, LAST: negatives belong at the end, and this block is what
  // disinherits the greybox itself.
  const cast = (shot.characters ?? []).map((id) => {
    const record = projectRoot ? readBibleRecord(projectRoot, "characters", id) : null;
    return record?.name || id;
  });
  body.push(L.locks);
  // The greybox-specific locks only exist because a greybox was sent: a free
  // pack that forbids 白模方块 is telling the model about a file it never
  // saw, and a lock nobody can break is noise in the one block that has to
  // still be in the model's attention when it renders.
  body.push(free
    ? (zh
        ? "不增加画面里没有说到的人物与道具，不删除说到的。"
        : "Add no person or prop the pack has not named, and remove none that it has.")
    : (zh
        ? "不新增不删除物体，不改镜头轨迹，不保留白模质感。"
        : "Add no object and remove none; do not change the camera path; keep none of the greybox's grey surfacing."));
  body.push(zh
    ? `${cast.length ? `画面里只有 ${cast.length} 个人：${cast.join("、")}；` : ""}${L.todoRoom}。`
    : `${cast.length ? `Only ${cast.length} ${cast.length === 1 ? "person is" : "people are"} in frame: ${cast.join(", ")}. ` : ""}${L.todoRoom}.`);
  body.push(free
    ? (zh
        ? "禁止：刚性滑行、塑料皮肤、变脸、额外人物、字幕、自带 BGM、突然跳切、人物变形。"
        : "Forbidden: rigid sliding, plastic skin, face drift, extra people, on-screen text, built-in music, a sudden cut, deformed bodies.")
    : (zh
        ? "禁止：白模方块、刚性滑行、塑料皮肤、变脸、额外人物、字幕、自带 BGM、突然跳切、人物变形、坐标轴、视锥体。"
        : "Forbidden: greybox blocks, rigid sliding, plastic skin, face drift, extra people, on-screen text, built-in music, a sudden cut, deformed bodies, coordinate axes, view frustums."));

  const markdown = [
    `# Prompt skeleton — ${shot.title}`,
    "",
    "Written by `previz.mjs prompt-skeleton` from this shot's own record: the",
    "reference lines are exactly what `generate` will attach, in the same order",
    "and at the same indices; the timeline is this shot's beats, whole, on",
    free ? "the plan's clock." : "the greybox's clock.",
    free
      ? "This shot is conditioned **free**: no greybox is sent, so the pack has no @Video1 line and the camera is the words below."
      : hybrid
        ? "This shot is conditioned **hybrid**: the greybox gives the positions and the camera path, and the pack says the body and the camera may move inside it."
        : "This shot is conditioned on its **greybox**: @Video1 is the layout, the timing and the camera move.",
    "Fill the `<TODO: …>` slots in place, then copy the block",
    "into the fenced prompt block of `prompts.md` — that file is the one",
    "`generate` reads.",
    "",
    "```prompt",
    ...body,
    "```",
    "",
    "**There is no word limit.** Seedance documents none, and the pack has to",
    free
      ? "carry the whole designed beat — here it is the only thing that says what happens."
      : "carry the whole designed beat plus everything the greybox cannot show.",
    "What is capped is vagueness, not length: one main event per segment, one",
    "camera move for the clip, visible details instead of adjectives, and the",
    "prohibitions last. See `references/prompting.md`.",
    "",
  ].join("\n");

  return {
    markdown,
    body: body.join("\n"),
    refs: planned.refs,
    warnings,
    conditioning,
    language,
    // The greybox facts the pack was written FROM, so a reader of the JSON
    // can check the mapping lines and the geography sentence against the
    // sidecar rather than against the prose.
    landmarks,
    subjectsDetail,
    segments: plan.segments.map((segment) => ({ from: round4(segment.from), to: round4(segment.to), beats: segment.beats.map((beat) => beat.id) })),
    merged: plan.merged,
    maxSegments: plan.budget,
  };
}

/** The opt-in pictures, read the same way by `prompt-skeleton` and
 *  `generate` — the pack has to be written for the job that will run. */
function attachmentOpts(opts) {
  return {
    withAnchors: Boolean(opts["with-anchors"]),
    withBoard: Boolean(opts["with-board"]),
    withConcept: Boolean(opts["with-concept"]),
    withHandoff: Boolean(opts["with-handoff"]),
  };
}

function cmdPromptSkeleton(dir, opts) {
  const shot = loadShot(dir);
  const projectRoot = findProjectRoot(dir);
  const attachments = attachmentOpts(opts);
  const skeleton = buildSkeleton(dir, shot, projectRoot, attachments);
  for (const warning of skeleton.warnings) note(`WARN: ${warning}`);

  let wrote = null;
  if (opts.write) {
    // NEVER prompts.md: that file is the agent's, and a take is made from
    // what is in it. The skeleton lands beside it and is copied in by hand.
    wrote = "prompts.skeleton.md";
    writeFileSync(join(dir, wrote), skeleton.markdown);
    note(`[previz] wrote ${wrote} — fill its \`\`\`prompt block and copy it into prompts.md (never overwritten by this command)`);
  } else {
    note("[previz] the skeleton is the `skeleton` field below; --write puts it in prompts.skeleton.md");
  }
  return emit({
    command: "prompt-skeleton",
    dir,
    file: wrote,
    conditioning: skeleton.conditioning,
    language: skeleton.language,
    // What this pack was written FOR: a pack scaffolded without the opt-in
    // pictures does not assign them, and `generate` would refuse the job
    // that carries them. Said out loud so the two commands stay paired.
    attachments,
    refs: skeleton.refs,
    segments: skeleton.segments,
    maxSegments: skeleton.maxSegments,
    merged: skeleton.merged,
    continuity: shot.continuity ?? null,
    // What @Video1 says, in the sidecar's own words: which colour is which
    // place, and who is standing in front of what at each end of the clip.
    landmarks: skeleton.landmarks,
    subjectsDetail: skeleton.subjectsDetail,
    warnings: skeleton.warnings,
    skeleton: skeleton.markdown,
  });
}

// ---------------------------------------------------------------------------
// What a finished pack is checked for, before a request is paid for
// ---------------------------------------------------------------------------

/** A v3 timeline line: `0–6秒：…`, `0.0–6.0s: …`, or a moment, `5.2秒：…`.
 *  `parsePromptTimeline` in `shot.mjs` owns the older `Seconds a–b:` spelling
 *  and is asked first, so one line is never counted twice. */
const PACK_RANGE = /^(\d+(?:\.\d+)?)\s*(?:[–—~-]|\.\.|to)\s*(\d+(?:\.\d+)?)\s*(?:秒|s|sec|secs|seconds?)\s*[:：]/i;
const PACK_MOMENT = /^(\d+(?:\.\d+)?)\s*(?:秒|s|sec|secs|seconds?)\s*[:：]/i;

function parsePackTimeline(text) {
  const rows = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const legacy = parsePromptTimeline(raw);
    if (legacy.length) { rows.push(legacy[0]); continue; }
    const line = raw.trim();
    const range = PACK_RANGE.exec(line);
    if (range) { rows.push({ from: Number(range[1]), to: Number(range[2]), line }); continue; }
    const moment = PACK_MOMENT.exec(line);
    if (moment) rows.push({ from: Number(moment[1]), to: Number(moment[1]), line });
  }
  return rows;
}

/** Text as coverage can be measured over it: every CJK character is a unit,
 *  every run of letters or digits is a unit. One rule for both languages,
 *  because a pack is written in one of them and a beat's detail may still be
 *  in the other. */
function packTokens(text) {
  return String(text ?? "").toLowerCase().match(/[㐀-䶿一-鿿぀-ヿ가-힯]|[a-z0-9]+/g) ?? [];
}

/** How much of `detail` survives in `line`, 0…1. */
function detailCoverage(detail, line) {
  const wanted = new Set(packTokens(detail));
  if (!wanted.size) return 1;
  const have = new Set(packTokens(line));
  let hit = 0;
  for (const token of wanted) if (have.has(token)) hit += 1;
  return hit / wanted.size;
}

/** How many DIFFERENT camera moves one line names. Two is the contradiction
 *  the model resolves by cutting. */
function cameraMovesIn(line) {
  return CAMERA_MOVES.filter((pattern) => pattern.test(line)).length;
}

/**
 * Everything worth saying about a finished pack that the reference and
 * timeline-range checks do not already say. All WARNINGS: the mode owns what
 * a take is conditioned on, not how a sentence is phrased, and an agent with
 * a reason to write the pack differently should not have to fight the script
 * for it. A silent omission, though, is exactly what the first acceptance run
 * paid for.
 */
function packProblems(prompt, shot, timeline) {
  const problems = [];
  const text = String(prompt ?? "");

  // The clock, as a partition: a gap is a second nobody directed and the model
  // fills it; an overlap is two instructions for the same second.
  for (let index = 1; index < timeline.length; index += 1) {
    const previous = timeline[index - 1];
    const row = timeline[index];
    const where = `"${String(row.line).slice(0, 40)}"`;
    if (row.from > previous.to + 1e-6) {
      problems.push(`the timeline leaves ${round4(previous.to)}–${round4(row.from)} s undirected before ${where} — every second is rendered, so a gap is a second the model invents`);
    } else if (row.from < previous.to - 1e-6 && row.from >= previous.from - 1e-6) {
      problems.push(`the timeline overlaps at ${where}: the line before it runs to ${round4(previous.to)} s — one second, one instruction`);
    }
  }
  const seconds = Number(shot.spec?.seconds);
  if (timeline.length && Number.isFinite(seconds)) {
    const first = timeline[0];
    const last = timeline[timeline.length - 1];
    if (first.from > 1e-6) {
      problems.push(`the timeline starts at ${round4(first.from)} s — seconds 0–${round4(first.from)} are rendered too, and nothing directs them`);
    }
    if (last.to < seconds - 1e-6) {
      problems.push(`the timeline stops at ${round4(last.to)} s but the clip is ${seconds} s — the tail is rendered, and nothing directs it`);
    }
  }
  for (const row of timeline) {
    if (cameraMovesIn(row.line) > 1) {
      problems.push(`the timeline line "${String(row.line).slice(0, 40)}" names more than one camera move — one clip holds ONE move, said once in the global block; the model resolves two by cutting`);
    }
  }

  // The design, carried forward — or deleted. This is the check the second
  // acceptance run needed: the beats were designed, and the pack shortened
  // them into clauses.
  for (const beat of shot.beats ?? []) {
    if (!beat || !beat.detail || !String(beat.detail).trim()) continue;
    const detail = String(beat.detail).trim();
    if (beat.kind === "camera") {
      if (detailCoverage(detail, text) < 0.5) {
        problems.push(`the camera beat "${beat.id}" was designed as "${detail.slice(0, 50)}…" and the pack does not carry it — the move belongs in the global block, whole`);
      }
      continue;
    }
    const best = timeline.reduce((score, row) => Math.max(score, detailCoverage(detail, row.line)), 0);
    if (best < 0.5) {
      problems.push(`beat "${beat.id}" was designed as "${detail.slice(0, 50)}…" and no timeline line carries it — the prompt is the design carried forward, and a shortened detail is design deleted (fix the design with 'beats --set', not by cutting it here)`);
    }
  }

  // The two blocks the greybox itself makes necessary.
  if (!/【全局锁】|【\s*locks\s*】/i.test(text)) {
    problems.push("the pack has no 【全局锁】 / 【Locks】 block — that is where the prohibitions belong, last (and, on a blocked shot, where the greybox is disinherited: no added or removed objects, no changed camera path, none of its grey surfacing)");
  }
  // Any line that addresses the greybox may carry the exclusion — the pack
  // usually says it twice, in the replacement sentence and in the assignment.
  // A free shot attaches no greybox, so there is no line to carry it and
  // nothing grey to inherit.
  if (usesGreybox(shot)) {
    const videoLines = text.split(/\r?\n/).filter((line) => /@Video1|\[Video1\]/.test(line)).join("\n");
    if (!/不要|不用|不参考|不继承|不保留|不提供|不复制|不迁移|\bnot\b|\bnever\b|\bno\b|\bexclude/i.test(videoLines)) {
      problems.push("the @Video1 line says what to take from the greybox but not what to leave — say it excludes the grey material, the empty set, the block shapes and the viewport overlays, or the model paints grey");
    }
  }
  return problems;
}

async function cmdGenerate(dir, opts, now) {
  const shot = loadShot(dir);
  const resolution = opts.resolution ?? "480p";
  if (!PRICED_RESOLUTIONS.includes(resolution)) {
    fail(`--resolution must be one of ${PRICED_RESOLUTIONS.join("|")} (got: ${resolution}) — this mode will not start a paid job at a price it cannot state`);
  }
  const policy = takePolicy(shot, {
    fix: opts.fix ?? null,
    userApproved: Boolean(opts["user-approved"]),
    allowFailing: opts["allow-failing"] ?? null,
  });
  if (!policy.ok) fail(`refusing to start a paid take:\n  - ${policy.errors.join("\n  - ")}`);

  const prompt = promptState(dir, shot);
  if (!prompt.promptOk) fail(`${relPath(dir, join(dir, shot.prompt?.file ?? "prompts.md"))}: ${prompt.promptReason}`);

  // THE VIDEO REFERENCE IS A PER-SHOT DECISION. A `free` shot sends none:
  // no file is required, `refSeconds` is 0, and the job is priced on the
  // dearer no-reference row because fal bills a reference clip's duration
  // alongside the output's and there is no reference here.
  const conditioning = conditioningOf(shot);
  const blocked = conditioning !== "free";
  const greyboxRel = blocked ? shot.greybox.final.file : null;
  const greyboxFile = greyboxRel ? join(dir, greyboxRel) : null;
  if (blocked && !existsSync(greyboxFile)) fail(`shot.json names ${greyboxRel} as the final greybox but the file is gone — re-render`);
  const refSeconds = blocked ? (shot.greybox.final.probe?.seconds ?? shot.spec.seconds) : 0;
  if (!blocked && shot.greybox?.final?.file) {
    note(
      `[previz] this shot is conditioned FREE: ${shot.greybox.final.file} exists but is NOT sent — it is the reel's ` +
        "stand-in. The references are the sheets and the style frame, and the first image is @Image1.",
    );
  }

  // The film's own gate: a take is the expensive half of the mode, and the
  // creator has to have approved the previz stage (or opened the gates) for
  // it to run. Checked before the price, so an estimate is refused too —
  // "what would it cost" is asked at exactly the moment this matters.
  const projectRoot = requireProjectRoot(dir, "a paid take");
  requireGate("generate", projectRoot);

  // Everything the job carries besides the prompt, gathered from the film.
  // The default is the greybox, the sheets, the style frame and the voices —
  // every picture with a composition of its own is an explicit `--with-…`.
  const attachments = attachmentOpts(opts);
  if (attachments.withHandoff && opts["no-handoff"]) {
    fail("--with-handoff and --no-handoff ask for opposite things: one attaches the previous shot's frame, the other does not even cut it");
  }

  // The frame this shot opens on, when it says it continues another. Cut
  // before anything is priced: a hand-off that cannot be cut is a refusal,
  // not a take that quietly starts somewhere else. It is only SENT with
  // --with-handoff; without it the frame is the evidence `take-handoff` is
  // answered from, and the join travels as the pack's entry/exit text.
  const handoff = resolveHandoff(dir, shot, projectRoot, {
    skip: Boolean(opts["no-handoff"]),
    attached: attachments.withHandoff,
  });
  const references = planReferences(dir, shot, projectRoot, {
    greyboxFile,
    handoff: handoff && !handoff.skipped ? handoff : null,
    ...attachments,
  });
  // What the take records: the frame it was measured against, and whether the
  // model was shown it.
  const handoffAttached = references.refs.some((ref) => ref.role === "handoff");
  const handoffRecorded = handoffRecord(handoff, handoffAttached);
  for (const warning of references.warnings) note(`WARN: ${warning}`);
  const attached = { video: references.videos.length, image: references.images.length, audio: references.audios.length };
  const refCheck = validatePromptRefs(prompt.refs, attached);
  if (!refCheck.ok) {
    fail(
      `the prompt pack addresses a reference this shot did not attach:\n  - ${refCheck.errors.join("\n  - ")}\n` +
        `Attached: ${describeRefs(references.refs)}. Fix prompts.md, or give the shot the reference it names ` +
        "(previz.mjs meta --characters/--set, previz.mjs anchor, backlot.mjs character voice).",
    );
  }
  // …and the other half of the same rule: a reference that was attached and
  // never given a job bleeds its own lighting and framing into the shot.
  const assignments = validateReferenceAssignments(prompt.prompt, attached);
  if (!assignments.ok) {
    fail(
      `the prompt pack leaves an attached reference unassigned:\n  - ${assignments.errors.join("\n  - ")}\n` +
        `Attached: ${describeRefs(references.refs)}.\n` +
        "Run 'previz.mjs prompt-skeleton <shot-dir> --write' for the assignment lines with this shot's own indices.",
    );
  }
  if (prompt.refs?.legacy?.length) {
    note(`WARN: prompts.md still addresses ${prompt.refs.legacy.join(", ")} — Seedance documents @Video1/@Image1/@Audio1; the bracket form is read as the same reference but will stop being accepted`);
  }
  // A time-coded timeline is the vendor's own advice and this mode's beats
  // are already that timeline. Whether it AGREES with the shot's clock, its
  // partition, its design and its camera is worth saying; none of it is worth
  // refusing a take over — see `packProblems`.
  const timeline = parsePackTimeline(prompt.prompt);
  const timelineWarnings = [
    ...timelineProblems(timeline, shot.spec),
    ...packProblems(prompt.prompt, shot, timeline),
  ];
  // A skeleton that was pasted in and not filled would be sent as it is, and
  // paid for. Said out loud rather than refused: the phrase is the skeleton's,
  // not a rule about how a prompt may be written.
  const placeholders = [...String(prompt.prompt).matchAll(/<TODO[^>]*>/g)].map((match) => match[0]);
  if (placeholders.length) {
    timelineWarnings.push(
      `the prompt still carries ${placeholders.length} unfilled skeleton placeholder(s), starting with "${placeholders[0].slice(0, 60)}" — ` +
        "the model is sent exactly this text",
    );
  }
  for (const warning of timelineWarnings) note(`WARN: ${warning}`);

  // A shot with a line spoken on screen has to come back with sound, or the
  // transcript check has nothing to listen to.
  const spoken = hasSpokenLine(shot);
  const wantAudio = Boolean(opts.audio) || spoken;
  if (spoken && !opts.audio) note(`[previz] ${spokenLines(shot).length} line(s) are spoken on screen — generating WITH audio so take-lines can be checked`);

  const wantedSeconds = opts.seconds === undefined ? Math.round(shot.spec.seconds) : Number(opts.seconds);
  if (!Number.isInteger(wantedSeconds) || wantedSeconds < 4 || wantedSeconds > 30) {
    fail(`--seconds must be a whole number from 4 to 30 (got: ${opts.seconds ?? wantedSeconds}) — Seedance bills and renders in whole seconds`);
  }
  if (Math.abs(wantedSeconds - shot.spec.seconds) > 0.5) {
    note(`WARN: the take is ${wantedSeconds} s but the shot spec is ${shot.spec.seconds} s — the take will not line up with the greybox on the shared clock`);
  }

  let price;
  try { price = priceTake({ seconds: wantedSeconds, refSeconds, resolution }); } catch (error) { return fail(error.message); }
  // The shared table prices the OUTPUT and the video reference's duration.
  // It says nothing about what a still, a voice sample or generated audio
  // adds, and inventing a number would be worse than saying so: the record
  // stays the table's, and the gap is reported.
  const extraRefs = references.images.length + references.audios.length;
  const priceNote = extraRefs > 0 || wantAudio
    ? `the price table covers the output${blocked ? " and the video reference" : " (this shot sends no video reference)"}; this job also carries ${references.images.length} image and ${references.audios.length} audio reference(s)${wantAudio ? " with audio generation on" : ""}, which the table does not price — the recorded cost is the table's figure, not a bill`
    : null;
  if (priceNote) note(`NOTE: ${priceNote}`);

  const takeId = policy.takeId;
  if (opts.estimate) {
    return emit({
      command: "generate", dir, estimate: true, wouldBe: takeId,
      model: "bytedance/seedance-2.5", endpoint: "reference", resolution, conditioning,
      seconds: wantedSeconds, refSeconds, greybox: greyboxRel, greyboxRevision: shot.greybox.revision,
      cost: price, prices: PRICES, promptChars: prompt.prompt.length,
      refs: references.refs, attachments, audio: wantAudio, priceNote,
      handoff: handoffRecorded,
      timeline: timeline.map((row) => ({ from: row.from, to: row.to })),
      warnings: [
        ...(policy.unverifiedChecks.length ? [`${policy.unverifiedChecks.length} greybox check(s) are still unverified: ${policy.unverifiedChecks.join(", ")}`] : []),
        ...references.warnings,
        ...timelineWarnings,
        ...(priceNote ? [priceNote] : []),
      ],
    });
  }

  // The clip is probed the moment it lands. Without ffprobe the job would be
  // paid for and then left "submitted" with no file on record — refuse here,
  // before anything is billed.
  requireTool("ffprobe");

  const fal = await falKeyPresent();
  if (!fal.present) {
    fail(
      "no fal key (FAL_KEY in the environment or a .env) — this is a reported gap, not a failure of the shot.\n" +
        "Deliver the plan, the greybox MP4, scene.blend/scene.glb and the prompt pack, and say the take was not generated.",
    );
  }

  // The exact prompt that reached fal, saved BEFORE the request, next to the
  // take it belongs to: a prompt pack edited after the fact must not be able
  // to rewrite what a take was made from.
  const promptRel = `takes/${takeId}.prompt.txt`;
  mkdirSync(join(dir, "takes"), { recursive: true });
  writeFileSync(join(dir, promptRel), `${prompt.prompt}\n`);

  const take = {
    id: takeId,
    status: "submitted",
    model: "bytedance/seedance-2.5",
    endpoint: "reference",
    resolution,
    // How this take was conditioned, on the take rather than only on the
    // shot: the shot's decision can change afterwards, and what a take was
    // made from must stay readable from the take.
    conditioning,
    seconds: wantedSeconds,
    refSeconds: Math.round(refSeconds * 10000) / 10000,
    greyboxRevision: shot.greybox.revision,
    requestId: null,
    file: null,
    promptFile: promptRel,
    probe: null,
    cost: { usd: price.usd, basis: price.basis, estimate: true, ...(priceNote ? { note: priceNote } : {}) },
    // What the job was conditioned on, recorded BEFORE the request: a bible
    // edited afterwards must not be able to rewrite what a take saw.
    refs: references.refs,
    // "skipped" and `attached: false` are facts about this take, not about
    // the shot: the shot still says it continues another one, and
    // `take-handoff` is still asked either way.
    ...(handoff ? { handoff: handoffRecorded } : {}),
    audio: wantAudio,
    submittedAt: now,
    finishedAt: null,
    fix: opts.fix ?? null,
    allowFailing: policy.allowFailing,
    selected: false,
    note: "",
  };
  shot.takes.push(take);
  saveShot(dir, shot);
  note(`[previz] ${takeId} recorded as submitted (estimated ${PRICES.currency} ${price.usd} — ${price.basis}); sending the request now`);

  const { generateSeedanceVideo, SEEDANCE_MODEL, loadFalKey } = await importShared();
  const apiKey = loadFalKey();
  const takeRel = `takes/${takeId}.mp4`;
  const controller = new AbortController();
  const handlers = new Map();
  let interruptedBy = null;
  for (const signal of ["SIGINT", "SIGTERM"]) {
    const handler = () => {
      if (interruptedBy) process.exit(130);
      interruptedBy = signal;
      controller.abort(new DOMException(`received ${signal}`, "AbortError"));
    };
    handlers.set(signal, handler);
    process.on(signal, handler);
  }

  try {
    const result = await generateSeedanceVideo({
      prompt: prompt.prompt,
      output: join(dir, takeRel),
      apiKey,
      endpoint: "reference",
      refVideos: references.videos,
      refImages: references.images,
      refAudios: references.audios,
      duration: String(wantedSeconds),
      resolution,
      // A greybox has no sound design, and a silent previz take is looked at
      // rather than listened to. `--audio` turns fal's default back on, and
      // a spoken line turns it on by itself.
      audio: wantAudio,
      signal: controller.signal,
      deadlineMs: Math.max(60, Number(opts.timeout ?? 1800)) * 1000,
    });
    const probe = probeVideo(join(dir, takeRel));
    const landed = {
      status: "done",
      file: takeRel,
      requestId: result.request_id ?? null,
      url: result.url ?? null,
      model: SEEDANCE_MODEL ?? take.model,
      finishedAt: new Date().toISOString(),
      probe,
      note: "",
    };
    if (probe.height && resolution && Number(String(resolution).replace("p", "")) !== probe.height) {
      landed.note = `fal delivered ${probe.width}x${probe.height}; asked for ${resolution}`;
      note(`WARN: ${landed.note} — this take is what the probe says it is, not what was ordered`);
    }
    const merged = mergeTake(dir, takeId, landed, { seed: true });
    if (!merged.ok) return orphanTake(dir, { ...take, ...landed }, merged.reason);
    // The take is on record; everything below is evidence, and a failure to
    // gather it leaves the take alone.
    let lines = null;
    try {
      lines = verifySpokenLines(dir, merged.shot, merged.take, now);
    } catch (error) {
      note(`WARN: the spoken-line check could not run (${error instanceof Error ? error.message : String(error)}) — take-lines stays unverified`);
    }
    const after = lines?.shot ?? merged.shot;
    if (handoff) {
      note(
        `[previz] look at the hand-off before accepting ${takeId}: previz.mjs compare <shot-dir> --handoff --take ${takeId}` +
          (handoffAttached ? "" : " — this take was NOT shown that frame; the join was asked for in words, and this is where you find out whether it landed"),
      );
    }
    return emit({
      command: "generate", dir, take: merged.take, cost: merged.take.cost, seededChecks: merged.seeded.length,
      refs: references.refs,
      handoff: handoffRecorded,
      lines: lines ? { status: lines.status, note: lines.note, transcript: lines.file, missing: lines.missing } : null,
      next: nextStage(after, promptState(dir, after)),
    });
  } catch (error) {
    const landed = {
      status: "failed",
      finishedAt: new Date().toISOString(),
      note: interruptedBy || error?.name === "AbortError"
        ? `${interruptedBy ?? "interrupted"} — the fal.ai job was cancelled remotely; whether it had already been billed is not knowable from here`
        : String(error?.message ?? error).slice(0, 500),
    };
    const merged = mergeTake(dir, takeId, landed);
    if (!merged.ok) return orphanTake(dir, { ...take, ...landed }, merged.reason);
    process.stdout.write(`${JSON.stringify({ ok: false, command: "generate", dir, take: merged.take, error: landed.note }, null, 2)}\n`);
    process.stderr.write(`ERROR: ${takeId} failed: ${landed.note}\n`);
    return interruptedBy ? 130 : 1;
  } finally {
    for (const [signal, handler] of handlers) process.off(signal, handler);
  }
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

function statusOfShot(dir, shot) {
  const prompt = promptState(dir, shot);
  const greybox = shot.greybox ?? {};
  const files = {
    script: existsSync(join(dir, greybox.script ?? "greybox/scene.py")),
    blend: existsSync(join(dir, greybox.blend ?? "greybox/scene.blend")),
    glb: existsSync(join(dir, greybox.glb ?? "greybox/scene.glb")),
    meta: existsSync(join(dir, greybox.meta ?? "greybox/scene.meta.json")),
    sheet: existsSync(join(dir, greybox.sheet ?? "greybox/sheet.png")),
    preview: Boolean(greybox.preview && existsSync(join(dir, greybox.preview.file))),
    final: Boolean(greybox.final && existsSync(join(dir, greybox.final.file))),
  };
  return {
    dir,
    ...shotStatus(shot, {
      promptOk: prompt.promptOk,
      promptReason: prompt.promptReason,
      costs: summarizeTakeCosts(shot.takes ?? []),
      files,
    }),
  };
}

function cmdStatus(dir) {
  if (existsSync(shotPath(dir))) {
    const shot = loadShot(dir);
    const status = statusOfShot(dir, shot);
    if (status.stuck.length) note(`WARN: stuck — ${status.stuck.join(", ")} failed on two revisions. Save this version and report instead of re-rendering.`);
    return emit({ command: "status", kind: "shot", ...status });
  }
  // The film's status is the stage rail, the gates and the cost by stage —
  // none of which this script can see. One report, one owner.
  if (existsSync(projectPath(dir))) {
    fail(`${dir} is a film, not a shot — run 'backlot.mjs status ${dir}' for the stages, the gates and the cost, or point this at a shot directory`);
  }
  fail(`${dir} holds neither ${PROJECT_FILE} nor ${SHOT_FILE}`);
}

// ---------------------------------------------------------------------------
// Usage and argv
// ---------------------------------------------------------------------------

const USAGE = `Usage: previz.mjs <subcommand> <shot-dir> [options]

The only writer of <project>/shots/<id>/shot.json. The film around it —
backlot.json, the bible, the sound and the cut — belongs to backlot.mjs, and
'backlot.mjs init' / 'backlot.mjs shot add' are what create a project and a
shot. The agent writes the prose (shot-plan.md, prompts.md, comparison.md)
and the Blender scene (greybox/scene.py); the viewer only reads. Directories
are absolute or relative to the CURRENT directory — this script never cds.

Every subcommand prints ONE JSON object on stdout and exits 0. A refusal
prints one "ERROR: …" line on stderr and exits non-zero, leaving the shot
exactly as it was; progress and every line ffmpeg or Blender printed go to
stderr. --json is accepted everywhere and is already the default.

  doctor [--verbose]
      Blender (path, version), ffmpeg, ffprobe, whether a fal key is
      reachable (never printed), and which stages that leaves open.

  meta <shot-dir> --conditioning ${CONDITIONINGS.join("|")}
      HOW THIS SHOT IS CONDITIONED, decided per shot in the plan. Default
      'greybox' (and what a shot written before this field is read as).
        greybox  the block is @Video1: space, geography, or a camera move
                 the model cannot do alone — the orbit, the crane, the
                 dolly zoom, the geometric "one inch"
        free     no @Video1 at all: the references are the character sheets
                 and the film's style frame, the first image is @Image1,
                 and the prompt is written for the action itself. No
                 greybox is required and its checks are not asked for; the
                 gate is still the film's previz approval. A greybox may
                 still be rendered for the reel — it is not sent
        hybrid   @Video1 for the positions and the camera path, plus a
                 sentence allowing dynamic body action and camera speed
                 inside it. Everything the greybox rules require applies
      Eight locked-off shots came back consistent and with no 亮点
      (2026-09-21); the same exchange shot free came back with one. Fight
      and charm beats are free or hybrid; space and camera moves are the
      block's.

  meta <shot-dir> [--scene sc1] [--characters kai,clerk] [--set store]
       [--trim-in 0.4 --trim-out 1.6] [--no-trim]
      Where this shot sits in the film: its scene, the bible characters in
      it, and the place it happens. 'generate' reads them to attach the
      right sheets and voices. Pass "" to clear one. An id the bible does
      not carry yet is a warning, not a refusal — the bible can come later.
      --trim-in/--trim-out name the sub-range of this shot the CUT uses, in
      seconds on the shot's own clock (0 <= in < out <= the spec's seconds).
      Everything else — the greybox, the take, the beats, a line's second —
      still runs on that clock; only the film sees less of it. A collage of
      one strike from three angles is three 4 s takes and three ~1.2 s
      segments. One flag alone edits the range that is there; --no-trim
      clears it and the whole shot reaches the film again.

  meta <shot-dir> --continues-from <shot> --entry "…" --exit "…"
  meta <shot-dir> --exit "…"        |  meta <shot-dir> --no-continuity
      The HAND-OFF, and it is opt-in. A shot with a continuity block is
      saying "this is one continuous action, seen from a new camera": the
      shot it names must be EARLIER in backlot.json's order and must have a
      selected take by the time this one is generated, --entry is the frame
      this shot opens on and --exit how it ends. Then 'generate' cuts that
      shot's last used frame into takes/handoff-in.png and every take carries
      the 'take-handoff' check.
      THE JOIN TRAVELS AS WORDS: --entry and --exit become the pack's
      第一帧 / 最后一帧 lines, and the frame itself is NOT sent to the model
      unless 'generate --with-handoff' asks for it — it carried the previous
      shot's camera into every continuing shot of the eight-take run.
      Say nothing for a cut that exists to BREAK continuity — an ellipsis, a
      jump cut, a montage, a deliberate mismatch. --exit alone is allowed on
      any shot: it is how a shot tells the next one where it ended.
      --no-continuity drops the block.

  board <shot-dir> --file <frame.png> --prompt "<what it was made from>"
        [--refs a.png,b.png] [--cost-usd 0.13 --cost-basis reported]
      LEGACY — NOT PART OF THE FLOW. Boards drawn from the text before the
      greybox existed contradicted each other and the greybox could not
      satisfy them, so the pictures come from the greybox now: block the
      shot, then 'previz.mjs anchor <shot-dir>'. This registers a board on a
      film shot under the old order; a shot that has a key frame never sends
      its board to a take. Gated: the bible must be approved.

  lines <shot-dir> --set '<json array>'
      What is said in this shot. Each line is
        { id, speaker, kind: ${LINE_KINDS.join("|")}, text, at }
      A "spoken" line is rendered BY THE VIDEO MODEL — the take carries the
      text and the speaker's voice sample, and 'take-lines' is checked
      against a transcript. A "vo" line is TTS the cut mixes in. A line
      whose text is unchanged keeps its recording; a line whose text changed
      loses it (the audio says something else now) and says so.

  vo <shot-dir> <line-id> [--model --voice --style]
     [--cost-usd 0.01 --cost-basis table]
      Synthesize ONE voice-over line through generate-tts.mjs into
      sound/<line>.mp3 and record its file, measured length and cost. The
      voice defaults to the speaker's recorded voice in the bible. Refuses a
      line that is spoken on screen. Gated: takes must be approved.

  beats <shot-dir> --set <file.json|->
      Replace the beat list. Each beat is
        { id, label, from, to, kind: action|trigger|camera|hold,
          causedBy?, detail? }
      'label' is short — it is what a rail, a sheet and a beat row show.
      'detail' is the DESIGNED picture of the beat, written at the boards
      stage before the greybox exists: the body action, the expression, the
      wardrobe and material, the physical consequence, the tempo word. The
      greybox is built from it and can only carry its geometry and its
      clock; 'prompt-skeleton' hands the same sentence back to the video
      model as that beat's timeline line, at the greybox's seconds.
      Validated: inside [0, seconds]; to >= from; ids unique; a causedBy
      that exists, is not itself, starts no later than its effect, and does
      not run in a circle. Every problem is reported at once.

  reference <shot-dir> <video> [--in s] [--out s] [--adopt-spec] [--count 9]
      Probe the video, trim [in, out) to reference/source.mp4 (re-encoded,
      even dimensions, silent), detect cuts (a shot is ONE take — cuts are
      reported loudly), extract evenly spaced frames and write
      reference/sheet.png. --adopt-spec copies the segment's fps/size and its
      duration — rounded to a whole number of frames — into the shot spec.

  render <shot-dir> [--preview] [--keep-frames] [--timeout ${DEFAULT_RENDER_TIMEOUT_S}]
         [--blender <path>]
      Run greybox/scene.py in headless Blender with the kit on sys.path, then
      PNG sequence -> H.264 yuv420p MP4 (crf 18, faststart) -> full decode
      check -> ffprobe, and record what ffprobe measured. Also writes
      scene.blend, scene.glb, scene.meta.json and greybox/sheet.png, and
      bumps greybox.revision.
      Refuses — and discards the encode — when the frame count, fps or size
      disagrees with the spec, or when another render or an adopted spec
      moved the shot while Blender ran. --preview renders at 50 % into
      greybox/preview.mp4 and skips nothing else; a normal render writes
      greybox/greybox.mp4.
      greybox/frames/ is scratch: cleared before the render, and DELETED
      after the MP4 encodes, decodes and probes clean (192 frames of 720p is
      ~163 MB). --keep-frames keeps them; a render that failed always does.

  anchor <shot-dir> [--at 0] [--id first] [--prompt "…" | --prompt-file <f>]
         [--aspect-ratio 16:9] [--quality high] [--cost-usd --cost-basis]
      OPTIONAL — A PICTURE FOR THE CREATOR, not a reference the take receives
      unless 'generate --with-anchors'. Cuts the FINAL greybox's frame at --at
      and hands it to generate_image.mjs as the composition, the camera and
      the staging, together with this shot's character sheets, its set concept
      when it has one, and the film's style reference ('backlot.mjs style')
      for the idiom. Use it to SEE what a shot will look like before buying
      the video; a key frame sent to the take is a second composition beside
      @Video1, which is the thing three acceptance rounds could not make the
      greybox win. Records anchors/<id>.png with its prompt, its references
      and what it cost; re-running an id bumps its revision. Paid. Gated: the
      bible must be approved, and there must be a final greybox to render
      from. The price comes from the vendor's own usage.cost when it reports
      one.

  lineup <shot-dir> [--at s] [--id first] [--out <path.png>]
      OPTIONAL, and free: the key frames beside the greybox frames they were
      rendered from, with the beats written underneath — a picture for the
      creator, not a reference the take receives. Every key frame gets its own
      greybox frame at its own second unless --at names one moment for all of
      them; a legacy board is shown last. Whatever is missing is left out and
      named.

  prompt-skeleton <shot-dir> [--write]
                  [--with-anchors] [--with-board] [--with-concept]
                  [--with-handoff]
      The prompt pack v3, built from this shot, in the block order
      'references/prompting.md' documents:
        the replacement sentence (the greybox's blocks become the subjects,
        its camera and paths are inherited, its materials are not)
        【素材映射】 one line per reference 'generate' WILL attach, same
                     order and indices, each with its scope AND its exclusion
        【一句话成片】 the clip in one sentence, with its seconds and aspect
        【全局设定】 style, light, and THE ONE camera move, whole
        【时间戳分镜】 a contiguous partition of the clip — no gaps, no
                      overlaps, one main event per segment, each carrying
                      its beat's designed detail in full, opening on 第一帧
                      (which carries the join when the frame is not attached)
        声音         named sounds, and no music (the cut lays the score)
        【全局锁】   last: nothing added or removed, the camera path
                      unchanged, none of the greybox's grey surfacing
      A 'free' shot gets the same pack with the greybox taken out of it:
      no replacement sentence, the 成片 sentence as the opening, 素材映射
      with the sheets and the style frame only, a camera that is words and
      may move with the action, no 按白模路线 in the timeline, and locks
      with no 白模 in them. A 'hybrid' shot keeps the greybox pack and adds
      the sentence that lets the body and the camera move inside the block.
      Chinese scaffolding for a film written in CJK, English otherwise —
      read off screenplay.md/idea.md. There is NO word budget. Prints the
      text in the JSON's 'skeleton' field; --write puts it in
      prompts.skeleton.md. It NEVER writes prompts.md — copy the filled
      block in yourself.
      The --with-… flags mean the same here as on 'generate', and they have
      to MATCH it: the pack assigns exactly the references the job attaches.

  sheet <shot-dir> [--lane greybox|preview|reference|take-01] [--at 0.5,3.8,…]
        [--strip from,to] [--count 6] [--out <path.png>]
      A contact sheet at named seconds, or a STRIP of every consecutive frame
      in a range — jitter and foot slide only exist between neighbours. Tiles
      carry their timestamp and frame number when this ffmpeg has drawtext;
      when it does not, the sheet is built without labels and says so.

  compare <shot-dir> --a greybox --b reference|take-01 [--at …] [--blend]
          [--count 6] [--out <path.png>]
      The two lanes at the same timestamps, stacked, or 50 % averaged for
      silhouette matching. Different sizes are scaled to a common width.

  compare <shot-dir> --handoff [--take take-01] [--out <path.png>]
      The JOINT: the previous shot's last used frame beside the first frame
      this take opens on, side by side and labelled, at
      takes/qa/<take>/handoff.png. That picture is how 'take-handoff' is
      answered. The left frame is the one the take was actually conditioned
      on when its record says so, not whatever the previous shot delivers
      now.

  check <shot-dir> --id <check> --status ${CHECK_STATUSES.join("|")}
        [--target greybox|take-01] [--range a,b] [--note "<what you saw>"]
      Record ONE acceptance check against the target's current revision. The
      previous state moves into history. A check that failed on the last two
      distinct revisions of its target lands in "stuck": save that version,
      write down what you tried, and report — do not render again.

  checklist <shot-dir>
      Seed the standard checks (also done by 'shot' and after a take finishes)
      as unverified. Never touches a check somebody already recorded.

  generate <shot-dir> [--resolution ${PRICED_RESOLUTIONS.join("|")}] [--seconds n]
           [--fix "<what this take changes>"] [--user-approved]
           [--allow-failing "<why a failing greybox is acceptable>"]
           [--estimate] [--audio] [--no-handoff] [--timeout 1800]
           [--with-anchors] [--with-board] [--with-concept] [--with-handoff]
      Seedance 2.5 reference-to-video, conditioned on everything this shot
      has, in the order the prompt addresses it by:
        @Video1  the FINAL greybox — the ONLY picture of layout, behaviour
                 and camera. NOT on a shot conditioned 'free': it sends no
                 video, needs no greybox and no greybox checks, is priced
                 on the no-reference row, and its first image is @Image1
        @Image…  this shot's character sheets, in bible order
        @Image…  the film's style key frame ('backlot.mjs style --keyframe')
        @Audio1… the voice sample of each character with a spoken line
      OPT-IN, and off by default because each brings a composition of its own
      and fights @Video1 for it: --with-anchors (this shot's key frames,
      leading the images), --with-board (a legacy drawing), --with-concept
      (the set concept) and --with-handoff (takes/handoff-in.png, LAST). The
      set's appearance travels as TEXT, from its bible 'look' into the pack's
      global block, and the join travels as the 第一帧 / 最后一帧 lines: eight
      720p takes (2026-09-21) showed every shot handed the previous frame
      inheriting ITS camera instead of its own greybox's.
      The prompt is the first fenced \`prompt\` block of prompts.md; it must
      address @Video1, every attached reference must be GIVEN A JOB there
      ("@Image2 = the keeper's appearance only"), and a pack that names a
      reference index nothing was attached at is REFUSED before the request
      ([Video1] is read as @Video1 and warned about; '@Image3：' with a
      full-width colon assigns exactly like '@Image3:').
      WARNED about, never refused — read them, they are the shape of a pack
      that came back wrong before: a timeline that runs past the shot, goes
      backwards, leaves a gap or overlaps itself; a segment naming two camera
      moves; a beat whose designed 'detail' no timeline line carries any
      more; a missing 【全局锁】/【Locks】 block; an @Video1 line that says
      what to take from the greybox but not what to leave.
      'previz.mjs prompt-skeleton' writes the pack with this shot's own
      indices and none of those faults.
      A shot that declares continuity refuses while the shot it continues has
      no selected take — contiguous shots are shot in order — and cuts that
      take's last used frame into takes/handoff-in.png for 'compare --handoff'
      whether or not the model is shown it (the take records
      handoff.attached). --no-handoff generates out of order, cuts nothing and
      records "skipped"; --with-handoff attaches the frame as the last image.
      Refuses: while the film's previz stage is not approved (backlot.mjs
      approve / gates open); without a final greybox at the current
      revision; while a greybox check is failing (unless --allow-failing
      "<reason>"); a second take without --fix; a third or later without
      --user-approved as well. On a 'free' shot the two greybox refusals do
      not apply — there is no greybox in the job to be stale or to fail.
      --estimate prices the job, lists what would be attached, and stops.
      Otherwise the take is recorded "submitted" — with the exact prompt
      saved to takes/<id>.prompt.txt and the references it carries — BEFORE
      the request leaves, and ends "done" (file, probe, request id, cost,
      timestamps) or "failed" (reason). A shot with a spoken line is
      generated WITH audio and transcribed when it lands: the transcript is
      stored at takes/<id>.transcript.json and 'take-lines' passes only if
      every line is in it. The key is never printed.

  select <shot-dir> <take>
      Mark the take this shot delivers. Refuses a take that is not done or
      that has a failing check.

  status <shot-dir>
      Spec, beats, greybox (revision and which renders exist), the acceptance
      record grouped by target with unverified counted APART from fail, stuck,
      takes, costs (per take and total, labelled an estimate) and "next" — the
      first open stage of:
        reference (recreate only) -> plan -> greybox-preview -> checks ->
        final-render -> prompt -> take -> take-checks -> select
      A 'free' shot skips the three greybox rungs: plan is followed by
      prompt, because no block is sent.
      Never writes, always exits 0. It is a report, not a gate. Pointed at a
      film it says so: the stage rail is 'backlot.mjs status'.
      There is no key-frame step in that walk: 'anchor' and 'lineup' are
      optional pictures for the creator, not rungs of the pipeline.

Frame arithmetic, everywhere: frames = seconds x fps, numbered 1..frames.
Prices (fal list, ${PRICES.asOf}), per billed second. With a video reference its
duration is billed alongside the output's: 480p $${PRICES.seedance.withReference["480p"]}, 720p $${PRICES.seedance.withReference["720p"]}. A 'free'
shot sends none and is billed on the dearer row, output seconds only:
480p $${PRICES.seedance.withoutReference["480p"]}, 720p $${PRICES.seedance.withoutReference["720p"]}.`;

const OPTIONS = {
  help: { type: "boolean", short: "h" },
  json: { type: "boolean" },
  now: { type: "string" },
  verbose: { type: "boolean" },
  title: { type: "string" },
  seconds: { type: "string" },
  fps: { type: "string" },
  size: { type: "string" },
  entry: { type: "string" },
  set: { type: "string" },
  in: { type: "string" },
  out: { type: "string" },
  "adopt-spec": { type: "boolean" },
  count: { type: "string" },
  preview: { type: "boolean" },
  "keep-frames": { type: "boolean" },
  timeout: { type: "string" },
  blender: { type: "string" },
  lane: { type: "string" },
  at: { type: "string" },
  strip: { type: "string" },
  a: { type: "string" },
  b: { type: "string" },
  blend: { type: "boolean" },
  id: { type: "string" },
  status: { type: "string" },
  target: { type: "string" },
  range: { type: "string" },
  note: { type: "string" },
  label: { type: "string" },
  resolution: { type: "string" },
  fix: { type: "string" },
  "user-approved": { type: "boolean" },
  "allow-failing": { type: "string" },
  estimate: { type: "boolean" },
  audio: { type: "boolean" },
  "with-anchors": { type: "boolean" },
  "with-board": { type: "boolean" },
  "with-concept": { type: "boolean" },
  "with-handoff": { type: "boolean" },
  scene: { type: "string" },
  characters: { type: "string" },
  conditioning: { type: "string" },
  "trim-in": { type: "string" },
  "trim-out": { type: "string" },
  "no-trim": { type: "boolean" },
  "continues-from": { type: "string" },
  exit: { type: "string" },
  "no-continuity": { type: "boolean" },
  "no-handoff": { type: "boolean" },
  handoff: { type: "boolean" },
  take: { type: "string" },
  write: { type: "boolean" },
  file: { type: "string" },
  prompt: { type: "string" },
  "prompt-file": { type: "string" },
  "aspect-ratio": { type: "string" },
  quality: { type: "string" },
  refs: { type: "string" },
  model: { type: "string" },
  voice: { type: "string" },
  style: { type: "string" },
  "cost-usd": { type: "string" },
  "cost-basis": { type: "string" },
};

export async function main(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  } catch (error) {
    fail(`${error.message}\n\n${USAGE}`);
  }
  const opts = parsed.values;
  const [subcommand, first, second] = parsed.positionals;

  if (opts.help || (!subcommand && argv.length === 0)) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (MOVED[subcommand]) {
    fail(`'previz.mjs ${subcommand}' moved to backlot.mjs — the film's manifest has one writer. Use: ${MOVED[subcommand]}`);
  }
  if (!SUBCOMMANDS.includes(subcommand)) {
    fail(`unknown subcommand "${subcommand ?? ""}" (expected: ${SUBCOMMANDS.join(", ")})\n\n${USAGE}`);
  }
  const now = nowStamp(opts);
  if (subcommand === "doctor") return cmdDoctor(opts);
  if (!first) fail(`${subcommand} needs a directory: previz.mjs ${subcommand} <dir> …`);
  const dir = resolveInput(first);

  switch (subcommand) {
    case "meta": return cmdMeta(dir, opts);
    case "board": return cmdBoard(dir, opts, now);
    case "lines": return cmdLines(dir, opts);
    case "vo": return cmdVo(dir, second, opts, now);
    case "beats": return cmdBeats(dir, opts);
    case "reference": return cmdReference(dir, second, opts);
    case "render": return cmdRender(dir, opts);
    case "anchor": return cmdAnchor(dir, opts, now);
    case "lineup": return cmdLineup(dir, opts);
    case "sheet": return cmdSheet(dir, opts);
    case "compare": return cmdCompare(dir, opts);
    case "check": return cmdCheck(dir, opts, now);
    case "checklist": return cmdChecklist(dir);
    case "prompt-skeleton": return cmdPromptSkeleton(dir, opts);
    case "generate": return cmdGenerate(dir, opts, now);
    case "select": return cmdSelect(dir, second);
    case "status": return cmdStatus(dir);
    default: return fail(`unhandled subcommand "${subcommand}"`);
  }
}

function isEntryPoint() {
  const entry = process.argv[1] ? resolve(process.argv[1]) : "";
  return entry === fileURLToPath(import.meta.url);
}

if (isEntryPoint()) {
  try {
    process.exitCode = await main();
  } catch (error) {
    process.stderr.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

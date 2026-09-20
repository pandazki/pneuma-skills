#!/usr/bin/env node
/**
 * previz.mjs — the only writer of `previz.json` and every `shot.json`.
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
  frameAtTime,
  gridFor,
  hasDrawtext,
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
  checkTargets,
  CHECK_STATUSES,
  computeStuck,
  DEFAULT_SPEC,
  ENTRIES,
  makeSpec,
  newProject,
  newShot,
  nextStage,
  nextTakeId,
  normalizeShot,
  parsePromptPack,
  parseSize,
  PROMPT_TEMPLATE_BODY,
  recordCheck,
  seedChecklist,
  shotStatus,
  slugId,
  summarizeChecks,
  takePolicy,
  validateBeats,
} from "./shot.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT_DIR = join(HERE, "blender");
const STARTER_DIR = join(HERE, "scene-starter");

const PROJECT_FILE = "previz.json";
const SHOT_FILE = "shot.json";

const SUBCOMMANDS = [
  "doctor", "init", "shot", "beats", "reference", "render",
  "sheet", "compare", "check", "checklist", "generate", "select", "status",
];

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

const SHOT_KEYS = ["version", "id", "title", "entry", "spec", "assumptions", "beats", "reference", "greybox", "checks", "stuck", "prompt", "takes"];

function inKeyOrder(value, keys) {
  const ordered = {};
  for (const key of keys) if (value[key] !== undefined) ordered[key] = value[key];
  for (const key of Object.keys(value)) if (ordered[key] === undefined) ordered[key] = value[key];
  return ordered;
}

function projectPath(dir) {
  return join(dir, PROJECT_FILE);
}

function shotPath(dir) {
  return join(dir, SHOT_FILE);
}

function loadProject(dir) {
  const path = projectPath(dir);
  if (!existsSync(path)) fail(`no ${PROJECT_FILE} in ${dir} — run 'previz.mjs init <project> --title "…"' first`);
  const doc = readJson(path, PROJECT_FILE);
  doc.shots = Array.isArray(doc.shots) ? doc.shots : [];
  doc.defaults = { ...DEFAULT_SPEC, ...(doc.defaults ?? {}) };
  return doc;
}

function loadShot(dir) {
  const path = shotPath(dir);
  if (!existsSync(path)) fail(`no ${SHOT_FILE} in ${dir} — is that a shot directory? (previz.mjs shot <project> <id> --title "…")`);
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
 */
function extractFrames(file, frames, outDir, { width = TILE_WIDTH } = {}) {
  const ffmpeg = requireTool("ffmpeg");
  mkdirSync(outDir, { recursive: true });
  const ordered = [...new Set(frames)].sort((a, b) => a - b);
  const select = ordered.map((frame) => `eq(n\\,${frame - 1})`).join("+");
  const filter = `select='${select}',scale=${width}:-2:flags=bicubic`;
  runToolOrFail(
    ffmpeg.path,
    ["-y", "-v", "error", "-i", file, "-vf", filter, "-fps_mode", "passthrough", "-frames:v", String(ordered.length), join(outDir, "tile_%03d.png")],
    { label: "ffmpeg frame extract" },
  );
  return ordered.map((frame, index) => ({ frame, path: join(outDir, `tile_${String(index + 1).padStart(3, "0")}.png`) }));
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

  const stages = {
    plan: { open: true, needs: [] },
    greybox: { open: blender.found && ffmpeg.found && ffprobe.found, needs: [...(blender.found ? [] : ["blender"]), ...(ffmpeg.found ? [] : ["ffmpeg"]), ...(ffprobe.found ? [] : ["ffprobe"])] },
    sheets: { open: ffmpeg.found, needs: ffmpeg.found ? [] : ["ffmpeg"] },
    take: { open: fal.present && ffprobe.found, needs: [...(fal.present ? [] : ["FAL_KEY"]), ...(ffprobe.found ? [] : ["ffprobe"])] },
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
    kit: { dir: KIT_DIR, present: existsSync(join(KIT_DIR, "previz_kit.py")) },
    starter: { dir: STARTER_DIR, present: existsSync(join(STARTER_DIR, "scene.py")) },
    stages,
    ready: stages.greybox.open,
    prices: PRICES,
  });
}

// ---------------------------------------------------------------------------
// init / shot
// ---------------------------------------------------------------------------

function specFromOpts(opts, defaults) {
  const size = opts.size ? parseSize(opts.size) : {};
  try {
    return makeSpec({ seconds: opts.seconds, fps: opts.fps, ...size }, defaults);
  } catch (error) {
    return fail(error.message);
  }
}

function cmdInit(dir, opts) {
  if (existsSync(projectPath(dir))) fail(`${projectPath(dir)} already exists — pick another directory`);
  const spec = specFromOpts(opts, DEFAULT_SPEC);
  const project = newProject({ title: opts.title ?? basename(dir), defaults: spec });
  mkdirSync(join(dir, "shots"), { recursive: true });
  writeJsonAtomic(projectPath(dir), project);
  return emit({ command: "init", dir, file: relPath(dir, projectPath(dir)), project });
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
prompt addresses it as **[Video1]**. \`previz.mjs generate\` reads the FIRST
fenced block tagged \`prompt\` below and refuses a prompt that never mentions
[Video1].

\`\`\`prompt
${PROMPT_TEMPLATE_BODY}
\`\`\`

## Look notes

- (what the greybox stands for: materials, light, time of day)

## Negative

- (what the model keeps adding that this shot must not have)
`;

function cmdShot(projectDir, idArg, opts) {
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
  try { shot = newShot({ id, title: opts.title ?? id, entry, spec, assumptions }); } catch (error) { return fail(error.message); }
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

  if (!project.shots.includes(id)) {
    project.shots.push(id);
    writeJsonAtomic(projectPath(projectDir), project);
  }

  return emit({
    command: "shot",
    dir,
    id,
    file: relPath(dir, shotPath(dir)),
    spec,
    entry,
    seededChecks: seeded.length,
    wrote: ["shot.json", "shot-plan.md", "prompts.md", "comparison.md", "greybox/scene.py"],
    next: nextStage(shot),
  });
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

function cmdCompare(dir, opts) {
  const shot = loadShot(dir);
  const a = laneFile(dir, shot, opts.a ?? "greybox");
  if (!opts.b) fail("compare needs --b <reference|take-01|greybox>");
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
  if (!existsSync(file)) return { promptOk: false, promptReason: `${relPath(dir, file)} does not exist` };
  const parsed = parsePromptPack(readFileSync(file, "utf-8"));
  return { promptOk: parsed.ok, promptReason: parsed.reason, prompt: parsed.prompt };
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

  const greyboxRel = shot.greybox.final.file;
  const greyboxFile = join(dir, greyboxRel);
  if (!existsSync(greyboxFile)) fail(`shot.json names ${greyboxRel} as the final greybox but the file is gone — re-render`);
  const refSeconds = shot.greybox.final.probe?.seconds ?? shot.spec.seconds;

  const wantedSeconds = opts.seconds === undefined ? Math.round(shot.spec.seconds) : Number(opts.seconds);
  if (!Number.isInteger(wantedSeconds) || wantedSeconds < 4 || wantedSeconds > 30) {
    fail(`--seconds must be a whole number from 4 to 30 (got: ${opts.seconds ?? wantedSeconds}) — Seedance bills and renders in whole seconds`);
  }
  if (Math.abs(wantedSeconds - shot.spec.seconds) > 0.5) {
    note(`WARN: the take is ${wantedSeconds} s but the shot spec is ${shot.spec.seconds} s — the take will not line up with the greybox on the shared clock`);
  }

  let price;
  try { price = priceTake({ seconds: wantedSeconds, refSeconds, resolution }); } catch (error) { return fail(error.message); }

  const takeId = policy.takeId;
  if (opts.estimate) {
    return emit({
      command: "generate", dir, estimate: true, wouldBe: takeId,
      model: "bytedance/seedance-2.5", endpoint: "reference", resolution,
      seconds: wantedSeconds, refSeconds, greybox: greyboxRel, greyboxRevision: shot.greybox.revision,
      cost: price, prices: PRICES, promptChars: prompt.prompt.length,
      warnings: policy.unverifiedChecks.length ? [`${policy.unverifiedChecks.length} greybox check(s) are still unverified: ${policy.unverifiedChecks.join(", ")}`] : [],
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
    seconds: wantedSeconds,
    refSeconds: Math.round(refSeconds * 10000) / 10000,
    greyboxRevision: shot.greybox.revision,
    requestId: null,
    file: null,
    promptFile: promptRel,
    probe: null,
    cost: { usd: price.usd, basis: price.basis, estimate: true },
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
      refVideos: [greyboxFile],
      duration: String(wantedSeconds),
      resolution,
      // A greybox has no sound design, and a previz take is looked at rather
      // than listened to. `--audio` turns fal's default back on.
      audio: Boolean(opts.audio),
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
    return emit({
      command: "generate", dir, take: merged.take, cost: merged.take.cost, seededChecks: merged.seeded.length,
      next: nextStage(merged.shot, promptState(dir, merged.shot)),
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
  if (!existsSync(projectPath(dir))) fail(`${dir} holds neither ${PROJECT_FILE} nor ${SHOT_FILE}`);
  const project = loadProject(dir);
  const shots = [];
  for (const id of project.shots) {
    const shotDir = join(dir, "shots", id);
    if (!existsSync(shotPath(shotDir))) {
      shots.push({ id, dir: shotDir, missing: true });
      continue;
    }
    shots.push(statusOfShot(shotDir, loadShot(shotDir)));
  }
  const allTakes = shots.flatMap((entry) => entry.takes ?? []);
  const open = shots.find((entry) => entry.next?.stage);
  return emit({
    command: "status",
    kind: "project",
    dir,
    title: project.title,
    defaults: project.defaults,
    shots,
    stuck: shots.flatMap((entry) => (entry.stuck ?? []).map((id) => `${entry.id}:${id}`)),
    costs: summarizeTakeCosts(allTakes),
    next: open ? { shot: open.id, ...open.next } : { shot: null, stage: null, reason: "every shot is delivered", command: null },
  });
}

// ---------------------------------------------------------------------------
// Usage and argv
// ---------------------------------------------------------------------------

const USAGE = `Usage: previz.mjs <subcommand> [<dir> …] [options]

The only writer of <project>/previz.json and <project>/shots/<id>/shot.json.
The agent writes the prose (shot-plan.md, prompts.md, comparison.md) and the
Blender scene (greybox/scene.py); the viewer only reads. Directories are
absolute or relative to the CURRENT directory — this script never cds.

Every subcommand prints ONE JSON object on stdout and exits 0. A refusal
prints one "ERROR: …" line on stderr and exits non-zero, leaving the shot
exactly as it was; progress and every line ffmpeg or Blender printed go to
stderr. --json is accepted everywhere and is already the default.

  doctor [--verbose]
      Blender (path, version), ffmpeg, ffprobe, whether a fal key is
      reachable (never printed), and which stages that leaves open.

  init <project> [--title "<name>"] [--seconds 8] [--fps 24] [--size 1280x720]
      Write previz.json and shots/. The spec here is the default every shot
      starts from. Refuses a directory that already has a previz.json.

  shot <project> <id> --title "<what happens>" [--entry original|recreate]
       [--seconds --fps --size]
      Scaffold shots/<id>/: shot.json (with the standard acceptance list
      seeded as unverified), shot-plan.md, prompts.md, comparison.md, and a
      greybox/scene.py starter that ALREADY RENDERS — so 'render --preview'
      succeeds before you have written a line of it.
      Refuses a duration whose seconds x fps is not a whole frame count.

  beats <shot-dir> --set <file.json|->
      Replace the beat list. Each beat is
        { id, label, from, to, kind: action|trigger|camera|hold, causedBy? }
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
           [--estimate] [--audio] [--timeout 1800]
      Seedance 2.5 reference-to-video with the FINAL greybox as [Video1] and
      the first fenced \`prompt\` block of prompts.md as the prompt.
      Refuses: without a final greybox at the current revision; while a
      greybox check is failing (unless --allow-failing "<reason>"); a second
      take without --fix; a third or later without --user-approved as well.
      --estimate prices the job and stops. Otherwise the take is recorded
      "submitted" — with the exact prompt saved to takes/<id>.prompt.txt —
      BEFORE the request leaves, and ends "done" (file, probe, request id,
      cost, timestamps) or "failed" (reason). The key is never printed.

  select <shot-dir> <take>
      Mark the take this shot delivers. Refuses a take that is not done or
      that has a failing check.

  status <project|shot-dir>
      Spec, beats, greybox (revision and which renders exist), the acceptance
      record grouped by target with unverified counted APART from fail, stuck,
      takes, costs (per take and total, labelled an estimate) and "next" — the
      first open stage of:
        reference (recreate only) -> plan -> greybox-preview -> checks ->
        final-render -> prompt -> take -> take-checks -> select
      Never writes, always exits 0. It is a report, not a gate.

Frame arithmetic, everywhere: frames = seconds x fps, numbered 1..frames.
Prices (fal list, ${PRICES.asOf}), per billed second, reference duration billed
alongside the output's: 480p $${PRICES.seedance.withReference["480p"]}, 720p $${PRICES.seedance.withReference["720p"]}.`;

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
  if (!SUBCOMMANDS.includes(subcommand)) {
    fail(`unknown subcommand "${subcommand ?? ""}" (expected: ${SUBCOMMANDS.join(", ")})\n\n${USAGE}`);
  }
  const now = nowStamp(opts);
  if (subcommand === "doctor") return cmdDoctor(opts);
  if (!first) fail(`${subcommand} needs a directory: previz.mjs ${subcommand} <dir> …`);
  const dir = resolveInput(first);

  switch (subcommand) {
    case "init": return cmdInit(dir, opts);
    case "shot": return cmdShot(dir, second, opts);
    case "beats": return cmdBeats(dir, opts);
    case "reference": return cmdReference(dir, second, opts);
    case "render": return cmdRender(dir, opts);
    case "sheet": return cmdSheet(dir, opts);
    case "compare": return cmdCompare(dir, opts);
    case "check": return cmdCheck(dir, opts, now);
    case "checklist": return cmdChecklist(dir);
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

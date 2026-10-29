#!/usr/bin/env node
/**
 * series.mjs — the anime-series workbench CLI.
 *
 * Three files, three kinds of writer:
 *   bible.json                    human + agent text (the viewer writes it too);
 *                                 this CLI offers helpers and re-reads before every write
 *   episodes/<id>/episode.json    human + agent text (same)
 *   project.json                  craft assets + provenance + the `series` sidecar —
 *                                 machine state; THIS CLI IS ITS ONLY WRITER
 *                                 (through craft-project-io.mjs, atomic replace)
 *
 * The rules (timing, hashing, locks, staleness, picks) live in
 * `series-state.mjs`, shared with the viewer; prompt assembly in
 * `prompts.mjs`; geometry in `grid.mjs`; ffmpeg steps in `media.mjs`.
 *
 * Every paid call goes through `runRegistered`: reserved on disk before the
 * request leaves, then landed or failed — never silently absent. `--dry-run`
 * prints the exact request and spends nothing.
 *
 * The commands port the jobs of ai-anime-series's MIT scripts ((c) 2026
 * 硅基废话 / 10291124jcjc-dotcom; the licence text is in
 * LICENSE-ai-anime-series.txt beside this file): `make_prompts.py`,
 * `grid.py`, `review_clip.py`, `compile.py`, `setup_check.py`. The method's
 * docs upstream are CC BY-NC 4.0 and are not copied (NOTICE.md in the mode's
 * source).
 *
 * Node built-ins plus ffmpeg/ffprobe; no npm dependencies.
 */

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { IMAGE_ASPECTS, REFERENCE_ASPECT, assumedVideoSize, cellRect, nearestAspect, referenceAspectOutside } from "./grid.mjs";
import * as media from "./media.mjs";
import { JIMENG_MAX_REFS, SEEDANCE_MAX_REFS, assemblePanel, assemblePart, assemblePatch, bibleLang, defaultContinuity, jimengSheet, lineupPrompt, sheetPrompt } from "./prompts.mjs";
import * as S from "./series-state.mjs";

export const SIDECAR_KEY = "series";
const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Output and failure
// ---------------------------------------------------------------------------

class CliError extends Error {}

function fail(message) {
  throw new CliError(message);
}

function note(message) {
  process.stderr.write(`${message}\n`);
}

function emit(v, payload, lines) {
  if (v.json) process.stdout.write(`${JSON.stringify(payload)}\n`);
  else process.stdout.write(`${lines.filter((l) => l !== null && l !== undefined).join("\n")}\n`);
}

const errorMessage = (error) => (error instanceof Error ? error.message : String(error));
const round4 = (x) => Math.round(x * 10000) / 10000;
const money = (usd) => (usd === null || usd === undefined ? "unpriced" : `$${usd.toFixed(usd < 1 ? 4 : 2)}`);
/** A cost for display: never "$0.0000" for something that has no number. */
const priced = (cost) => (cost && Number.isFinite(cost.usd) ? `≈ ${money(cost.usd)} (${cost.basis})` : "unpriced");

// ---------------------------------------------------------------------------
// Shared scripts: installed beside this CLI, or the source checkout
// ---------------------------------------------------------------------------

/**
 * An installed session keeps shared scripts beside this file (the manifest
 * lists them in `skill.sharedScripts`); a source checkout resolves them from
 * `modes/_shared/scripts/`.
 */
export function sharedScriptUrl(name) {
  const installed = join(HERE, name);
  if (existsSync(installed)) return pathToFileURL(installed).href;
  const source = join(HERE, "..", "..", "..", "_shared", "scripts", name);
  if (existsSync(source)) return pathToFileURL(source).href;
  return null;
}

async function importShared(name, why) {
  const url = sharedScriptUrl(name);
  if (!url) fail(`${name} is not installed beside this skill and is not in the source checkout — ${why} needs it (add it to the mode's skill.sharedScripts)`);
  return import(url);
}

let craftCache = null;
async function craftModules() {
  if (!craftCache) {
    const [craft, io] = await Promise.all([
      importShared("craft-project.mjs", "every project.json read"),
      importShared("craft-project-io.mjs", "every project.json write"),
    ]);
    craftCache = { craft, io };
  }
  return craftCache;
}

/**
 * The generation adapters. `ANIME_SERIES_GENERATORS` replaces the generate
 * functions (and the key lookups) with a local module — how the tests run
 * the whole path without a network. Every run that uses it says so: a file
 * made by something other than the provider must never pass for one that
 * was. Request builders always come from the real scripts, so a dry run
 * shows exactly what would be sent.
 *
 * `resumeSeedanceVideo` lands a Seedance job fal already accepted, by its
 * recorded request id: the same download, remux and cost path as a fresh
 * render, with the queue runner attached to the old job instead of
 * submitting a new one.
 */
async function generators() {
  const [image, seedance, queue] = await Promise.all([
    importShared("generate_image.mjs", "image generation"),
    importShared("seedance-video.mjs", "video generation"),
    importShared("fal-queue.mjs", "video generation"),
  ]);
  let mock = {};
  const override = process.env.ANIME_SERIES_GENERATORS;
  if (override) {
    mock = await import(pathToFileURL(resolve(override)).href);
    note(`WARN: ANIME_SERIES_GENERATORS is set — generations come from ${override}, not from the providers`);
  }
  return {
    generateImage: mock.generateImage ?? image.generateImage,
    buildImageRequest: image.buildImageRequest,
    resolveImageModel: image.resolveImageModel,
    imageKey: mock.imageKey ?? (() => image.loadEnvKeys().OPENROUTER_API_KEY ?? null),
    generateSeedanceVideo: mock.generateSeedanceVideo ?? seedance.generateSeedanceVideo,
    resumeSeedanceVideo: mock.resumeSeedanceVideo
      ?? ((options) => seedance.generateSeedanceVideo(options, { runJob: (job) => queue.runFalJob({ ...job, requestId: options.requestId }) })),
    toQueueUrl: queue.toQueueUrl,
    buildSeedanceRequest: seedance.buildSeedanceRequest,
    seedanceCost: seedance.seedanceCost,
    seedanceModel: seedance.SEEDANCE_MODEL,
    seedanceAspects: seedance.ASPECT_RATIOS,
    falKey: mock.falKey ?? (() => queue.loadFalKey() ?? null),
  };
}

// ---------------------------------------------------------------------------
// Workspace files
// ---------------------------------------------------------------------------

function workspace(v) {
  const root = resolve(v.dir ?? process.cwd());
  return {
    root,
    bible: join(root, "bible.json"),
    project: join(root, "project.json"),
    episodes: join(root, "episodes"),
    rel: (abs) => relative(root, abs).split(sep).join("/"),
    abs: (rel) => join(root, rel),
  };
}

function readJson(path, label) {
  if (!existsSync(path)) fail(`no ${label} at ${path} — run 'series.mjs init' first`);
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch (error) {
    fail(`${path} is not valid JSON: ${errorMessage(error)}`);
  }
}

/** Write JSON through a scratch file and a rename, so no reader sees a torn file. */
function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const scratch = `${path}.${process.pid}-${Math.random().toString(16).slice(2)}.tmp`;
  try {
    writeFileSync(scratch, `${JSON.stringify(value, null, 2)}\n`);
    renameSync(scratch, path);
  } finally {
    rmSync(scratch, { force: true });
  }
}

/** bible.json with list defaults for reading (the file itself is not rewritten). */
function loadBible(ws) {
  const raw = readJson(ws.bible, "bible.json");
  const problems = S.checkBible(raw);
  if (problems.length) fail(`bible.json is malformed:\n- ${problems.join("\n- ")}`);
  return { ratio: "16:9", dialogue: false, style: "", sheetStyle: "", title: "", ...raw, characters: raw.characters ?? [], groups: raw.groups ?? [], scenes: raw.scenes ?? [], locks: raw.locks ?? [] };
}

/** Re-read bible.json, let `mutate` change it, check it, write it back. */
function updateBible(ws, mutate) {
  const raw = readJson(ws.bible, "bible.json");
  const out = mutate(raw) ?? raw;
  const problems = S.checkBible(out);
  if (problems.length) fail(`refusing to write bible.json:\n- ${problems.join("\n- ")}`);
  writeJsonAtomic(ws.bible, out);
  return out;
}

function episodePath(ws, id) {
  return join(ws.episodes, id, "episode.json");
}

function listEpisodeIds(ws) {
  if (!existsSync(ws.episodes)) return [];
  return readdirSync(ws.episodes, { withFileTypes: true })
    .filter((d) => d.isDirectory() && S.EPISODE_ID_RE.test(d.name) && existsSync(episodePath(ws, d.name)))
    .map((d) => d.name)
    .sort();
}

function checkEpisodeId(id) {
  if (!S.EPISODE_ID_RE.test(String(id ?? ""))) fail(`--episode must look like ep01 (got: ${id})`);
  return id;
}

function loadEpisode(ws, id, bible) {
  checkEpisodeId(id);
  const raw = readJson(episodePath(ws, id), `episodes/${id}/episode.json`);
  const problems = S.checkEpisodeFile(raw, bible);
  if (problems.length) fail(`episodes/${id}/episode.json is malformed:\n- ${problems.join("\n- ")}`);
  return { groups: [], scene: null, time: "", continuity: [], log: null, picks: {}, ...raw, id };
}

function updateEpisode(ws, id, bible, mutate) {
  const path = episodePath(ws, id);
  const raw = readJson(path, `episodes/${id}/episode.json`);
  const out = mutate(raw) ?? raw;
  delete out.id;
  const problems = S.checkEpisodeFile(out, bible);
  if (problems.length) fail(`refusing to write episodes/${id}/episode.json:\n- ${problems.join("\n- ")}`);
  writeJsonAtomic(path, out);
  return { ...out, id };
}

function emptySidecar() {
  return { schema: 1, sheets: {}, episodes: {}, compilations: [], lineups: [] };
}

/** The sidecar with every container present (this CLI is its only writer). */
function sidecar(doc) {
  const s = doc[SIDECAR_KEY];
  s.schema ??= 1;
  s.sheets ??= {};
  s.episodes ??= {};
  s.compilations ??= [];
  s.lineups ??= [];
  return s;
}

function sheetSlot(doc, key) {
  const s = sidecar(doc);
  s.sheets[key] ??= { candidates: [], compares: [] };
  return s.sheets[key];
}

function episodeSlots(doc, id) {
  const s = sidecar(doc);
  s.episodes[id] ??= { parts: {}, prompts: {}, finals: [] };
  s.episodes[id].parts ??= {};
  s.episodes[id].prompts ??= {};
  s.episodes[id].finals ??= [];
  return s.episodes[id];
}

function partSlots(doc, epId, partId) {
  const ep = episodeSlots(doc, epId);
  ep.parts[partId] ??= { boards: [], panels: [], takes: [], patches: [], reviews: [], checks: {} };
  const p = ep.parts[partId];
  for (const key of ["boards", "panels", "takes", "patches", "reviews"]) p[key] ??= [];
  p.checks ??= {};
  return p;
}

async function loadDoc(ws) {
  const { io } = await craftModules();
  if (!existsSync(ws.project)) fail(`no project.json in ${ws.root} — run 'series.mjs init' first`);
  const doc = io.loadProject(ws.project, { sidecarKey: SIDECAR_KEY });
  sidecar(doc);
  return doc;
}

async function saveDoc(ws, doc) {
  const { io } = await craftModules();
  io.saveProject(ws.project, doc);
}

/** `(assetId) => status` with craft's rule (absent status is ready). */
function statusLookup(doc, craft) {
  const byId = new Map(doc.assets.map((a) => [a.id, a]));
  return (id) => {
    const asset = byId.get(id);
    return asset ? craft.statusOf(asset) : undefined;
  };
}

function assetById(doc, id) {
  return doc.assets.find((a) => a.id === id) ?? null;
}

function edgeOf(doc, id) {
  return doc.provenance.find((e) => e.toAssetId === id) ?? null;
}

function assetFile(ws, doc, id) {
  const asset = assetById(doc, id);
  if (!asset || !asset.uri) fail(`asset '${id}' has no file`);
  return ws.abs(asset.uri);
}

/** The next free `<prefix><n>` (failed and pending ids are never reused). */
function nextId(doc, prefix) {
  let max = 0;
  const re = new RegExp(`^${prefix.replace(/[-]/g, "\\-")}(\\d+)$`);
  for (const asset of doc.assets) {
    const m = re.exec(asset.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${max + 1}`;
}

const KIND_PREFIX = { character: "char", group: "group", scene: "scene" };

/** Picked, ready sheets per entity. A pick that is not ready is reported, not used. */
function sheetResolver(bible, statusOf, warnings = []) {
  return (kind, id) => {
    const entity = S.findEntity(bible, kind, id);
    const sheet = entity?.sheet;
    if (!sheet) return null;
    if (statusOf(sheet) !== "ready") {
      warnings.push(`${kind} "${id}" picks sheet '${sheet}', which is ${statusOf(sheet) ?? "not in project.json"} — not used`);
      return null;
    }
    return sheet;
  };
}

function nowFrom(v) {
  if (v.at === undefined) return Date.now;
  const at = Number(v.at);
  if (!Number.isFinite(at)) fail(`--at must be epoch milliseconds (got: ${v.at})`);
  return () => at;
}

function partsOf(episode, v, { single = false } = {}) {
  const ids = episode.parts.map((p) => p.id);
  if (v.part) {
    const id = String(v.part).toUpperCase();
    if (!ids.includes(id)) fail(`episode ${episode.id} has no part ${id} (parts: ${ids.join(", ") || "none"})`);
    return [id];
  }
  if (single && ids.length > 1) fail(`episode ${episode.id} has ${ids.length} parts — say which with --part ${ids.join("|")}`);
  if (!ids.length) fail(`episode ${episode.id} has no shots yet`);
  return single ? [ids[0]] : ids;
}

function requireTiming(episode) {
  const { errors, warnings } = S.checkEpisode(episode);
  if (errors.length) fail(`episode ${episode.id} breaks the timing rules:\n- ${errors.map((e) => e.message).join("\n- ")}`);
  for (const w of warnings) note(`WARN: ${w.message}`);
}

function effectiveBoard(doc, statusOf, episode, partId) {
  const slots = partSlots(doc, episode.id, partId);
  return S.effectivePick(episode.picks?.storyboard?.[partId], slots.boards.map((b) => b.asset), statusOf);
}

function effectiveTake(doc, statusOf, episode, partId) {
  const slots = partSlots(doc, episode.id, partId);
  return S.effectivePick(episode.picks?.take?.[partId], slots.takes.map((t) => t.asset), statusOf);
}

function listFlag(values) {
  return (values ?? []).flatMap((value) => String(value).split(",")).map((s) => s.trim()).filter(Boolean);
}

function parseBool(value, flag) {
  if (value === undefined) return undefined;
  if (/^(true|yes|1|on)$/i.test(value)) return true;
  if (/^(false|no|0|off)$/i.test(value)) return false;
  fail(`${flag} must be true or false (got: ${value})`);
}

function parseNumber(value, flag, { integer = false, min = -Infinity } = {}) {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (value === "" || !Number.isFinite(n) || (integer && !Number.isInteger(n)) || n < min) fail(`${flag} must be ${integer ? "an integer" : "a number"} ≥ ${min} (got: ${value})`);
  return n;
}

function parseRange(value, flag = "--shots") {
  const m = /^(\d+)(?:-(\d+))?$/.exec(String(value ?? ""));
  if (!m) fail(`${flag} must look like 5-6 or 7 (got: ${value})`);
  const a = Number(m[1]);
  const b = Number(m[2] ?? m[1]);
  if (a < 1) fail(`${flag} ${value}: shots are numbered from 1`);
  if (b < a) fail(`${flag} ${value}: the end comes before the start`);
  return [a, b];
}

/** A copy of an uploaded file at its slot path (kept in place when it already is there). */
function placeUpload(ws, source, relTarget) {
  const abs = resolve(source);
  if (!existsSync(abs)) fail(`--upload: ${source} does not exist`);
  const target = ws.abs(relTarget);
  if (resolve(target) !== abs) {
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(abs, target);
  }
  return relTarget;
}

function extOf(file, fallback) {
  const ext = extname(file).toLowerCase();
  return ext || fallback;
}

/**
 * The warning for an uploaded reference image (a sheet, a storyboard) whose
 * width-to-height falls outside REFERENCE_ASPECT, or null. The file is
 * registered either way: the limit is the Jimeng canvas's, and Seedance's
 * is only reported to be the same.
 */
function referenceAspectWarning(landed, uri, fix) {
  const width = Number(landed?.asset?.metadata?.width);
  const height = Number(landed?.asset?.metadata?.height);
  const aspect = referenceAspectOutside(width, height);
  if (aspect === null) return null;
  return `${uri} is ${width}×${height} (${aspect.toFixed(2)} wide to 1 high); a reference image must stay within ${REFERENCE_ASPECT.min}–${REFERENCE_ASPECT.max} — the Jimeng canvas refuses anything outside that, and Seedance's limit is reported to be the same (not verified on fal). ${fix}`;
}

/** Register a local (unpaid) file in one load→save: derive, composite or upload. */
async function registerLocal(ws, spec, mutateSidecar, now) {
  const { craft, io } = await craftModules();
  const doc = await loadDoc(ws);
  const records = [];
  for (const one of Array.isArray(spec) ? spec : [spec]) {
    craft.reserveAsset(doc, { ...one, generating: false }, now());
    const { metadata, warning } = io.probeMedia(ws.abs(one.uri), one.type);
    if (warning) note(`WARN: ${one.id}: ${warning}`);
    records.push(craft.landAsset(doc, { id: one.id, uri: one.uri, metadata }, now()));
  }
  mutateSidecar?.(doc);
  await saveDoc(ws, doc);
  return records;
}

// ---------------------------------------------------------------------------
// Paid calls
// ---------------------------------------------------------------------------

/**
 * Add a fresh generation's slot record inside the reservation's own write.
 * The id was chosen from an earlier read; if another run took it meanwhile,
 * refuse — runRegistered then sends nothing — rather than overwrite that
 * run's in-flight reservation.
 */
function claimSlot(list, assetId, record) {
  if (list.some((r) => r.asset === assetId)) throw new Error(`'${assetId}' was taken by another run in the meantime — nothing was sent; run the command again`);
  list.push(record);
}

function reportedCost(usage) {
  const usd = Number(usage?.cost);
  return Number.isFinite(usd) && usd >= 0 ? { usd: round4(usd), basis: "reported", note: "OpenRouter usage.cost for this call" } : undefined;
}

/**
 * What a high-quality GPT Image 2.5 image cost on OpenRouter in the seed
 * rounds (2026-10, `usage.cost` per call): ≈ $0.055 for a 1:1 image with
 * either model, $0.034–0.05 for 16:9 (more with references, which add input
 * tokens). Used only until this project has reported prices of its own.
 */
const IMAGE_PRICE_TABLE = Object.freeze({
  "openai/gpt-image-2.5-flare": 0.055,
  "openai/gpt-image-2.5-sunburst": 0.055,
});

/**
 * A labelled estimate for one image call: the median of reported calls of
 * the same model in this project, else the seed rounds' table price for a
 * high-quality image, else null (unpriced — never free).
 */
function imageCost(doc, model, quality = "high") {
  const own = imageEstimate(doc, model);
  if (own) return own;
  const usd = IMAGE_PRICE_TABLE[model];
  if (usd === undefined || quality !== "high") return null;
  return { usd, basis: "table", note: `seed-round OpenRouter price for one high-quality ${model.split("/").pop()} image — no reported price in this project yet` };
}

/**
 * The image model for a call that attaches references: the one asked for,
 * else Sunburst when there are references (generate_image.mjs recommends it
 * for multi-reference work; the board must keep identities), else Flare.
 * Returned with the reason, which every command prints.
 */
function chosenImageModel(gen, v, referenceCount) {
  if (v.model) return { model: gen.resolveImageModel(v.model), why: `--model ${v.model}` };
  return referenceCount > 0
    ? { model: gen.resolveImageModel("sunburst"), why: `default with ${referenceCount} reference image(s); --model flare for the general model` }
    : { model: gen.resolveImageModel("flare"), why: "default without references" };
}

/** A labelled estimate for one image call: the median of reported calls of the same model here, or null. */
function imageEstimate(doc, model) {
  const costs = doc.provenance
    .map((e) => e.operation?.params)
    .filter((p) => p?.provider === "openrouter" && p?.model === model && p?.cost?.basis === "reported" && Number.isFinite(p.cost.usd))
    .map((p) => p.cost.usd)
    .sort((a, b) => a - b);
  if (!costs.length) return null;
  const mid = costs.length % 2 ? costs[(costs.length - 1) / 2] : (costs[costs.length / 2 - 1] + costs[costs.length / 2]) / 2;
  return { usd: round4(mid), basis: "estimate", note: `median of ${costs.length} reported ${model} call(s) in this project` };
}

function videoEstimate(gen, { resolution, ratio, seconds }) {
  const size = assumedVideoSize(resolution, ratio);
  const cost = gen.seedanceCost({ ...size, duration: seconds, resolution });
  return { usd: cost.usd, basis: "estimate", note: `fal's published Seedance 2.5 formula before delivery, assuming ${size.width}×${size.height} × ${seconds} s at ${resolution}` };
}

function deliveredVideoCost(result) {
  const cost = result?.cost;
  if (!cost || !Number.isFinite(cost.usd)) return undefined;
  return { usd: cost.usd, basis: "estimate", note: `fal's published formula on the delivered clip (${cost.width}×${cost.height}, ${cost.duration} s) — not an invoice` };
}

/**
 * The request body with each inlined file shown by name instead of base64.
 * Files are matched by position (the builders inline them in the order
 * given), never by content: two identical images are still two references.
 */
function elide(body, files) {
  let k = 0;
  return JSON.parse(JSON.stringify(body, (key, value) => {
    if (typeof value === "string" && value.startsWith("data:")) {
      const name = files[k]?.name ?? "?";
      k += 1;
      return `<inlined file ${name} (${value.length} chars of data URI)>`;
    }
    return value;
  }));
}

function imageAspect(ratio) {
  return IMAGE_ASPECTS.includes(ratio) ? ratio : nearestAspect(...ratio.split(":").map(Number));
}

/**
 * One registered paid call. Returns a row for the command's output; a failed
 * or interrupted call is reported and sets the process exit code.
 */
async function runPaid(ws, now, { reserve, call, updateSidecar }) {
  const { io } = await craftModules();
  const outcome = await io.runRegistered({ path: ws.project, sidecarKey: SIDECAR_KEY, reserve, call, updateSidecar, now });
  const cost = outcome.edge?.operation?.params?.cost ?? null;
  if (outcome.ok) {
    return { id: outcome.asset.id, status: "ready", uri: outcome.asset.uri, cost, warning: outcome.warning, sidecarError: outcome.sidecarError, ok: true };
  }
  note(`ERROR: ${outcome.asset.id} failed: ${outcome.reason} (billing: ${outcome.billing})`);
  process.exitCode = outcome.exitCode;
  return { id: outcome.asset.id, status: "failed", reason: outcome.reason, billing: outcome.billing, cost, interrupted: outcome.interrupted, ok: false, exitCode: outcome.exitCode };
}

function paidLines(rows) {
  return rows.map((r) => r.ok
    ? `  ${r.id} ready → ${r.uri} (${money(r.cost?.usd ?? null)}${r.cost ? `, ${r.cost.basis}` : ""})${r.warning ? ` WARN: ${r.warning}` : ""}`
    : `  ${r.id} FAILED — ${r.reason} (billing ${r.billing})`);
}

function noKey(kind, jimengHint) {
  return `no ${kind} key found (${kind === "fal" ? "FAL_KEY" : "OPENROUTER_API_KEY"} in the environment or a .env) — nothing was sent. Without a key: ${jimengHint}`;
}

/**
 * ffmpeg and ffprobe on PATH, and whether this ffmpeg has drawtext. Reported
 * by init and status, the earliest point a missing tool can be named: the
 * commands that need them (check-sheets, redo-panel, review-episode, final,
 * compile-season) otherwise refuse only when they are reached, after the
 * first paid sheets.
 */
function toolReport() {
  const ffmpeg = media.hasTool("ffmpeg");
  const ffprobe = media.hasTool("ffprobe");
  return { ffmpeg, ffprobe, drawtext: ffmpeg && media.hasDrawtext() };
}

const FFMPEG_INSTALL = "macOS: brew install ffmpeg · Windows: winget install Gyan.FFmpeg · Debian/Ubuntu: sudo apt install ffmpeg";

function toolLine(tools) {
  const missing = ["ffmpeg", "ffprobe"].filter((tool) => !tools[tool]);
  if (missing.length) return `ffmpeg/ffprobe: MISSING ${missing.join(" and ")} — check-sheets, redo-panel, review-episode, frames, final and compile-season need both (${FFMPEG_INSTALL})`;
  return `ffmpeg/ffprobe: found${tools.drawtext ? "" : " · no drawtext (ffmpeg built without libfreetype): frame and compare-image labels are left off, and compile-season --titles is refused"}`;
}

// ---------------------------------------------------------------------------
// init / bible
// ---------------------------------------------------------------------------

/**
 * A series ratio must be one Seedance 2.5 renders: clips are the point, and
 * a ratio it refuses would only fail at the first paid video call.
 */
async function checkRatio(ratio) {
  const seedance = await importShared("seedance-video.mjs", "the ratio check");
  const allowed = seedance.ASPECT_RATIOS.filter((r) => r !== "auto");
  if (!allowed.includes(ratio)) fail(`--ratio must be one Seedance 2.5 renders: ${allowed.join(", ")} (got: ${ratio})`);
  assumedVideoSize("480p", ratio);
  return ratio;
}

async function cmdInit(v) {
  const ws = workspace(v);
  mkdirSync(join(ws.root, "refs"), { recursive: true });
  mkdirSync(ws.episodes, { recursive: true });
  const created = [];
  const kept = [];
  const ratio = await checkRatio(v.ratio ?? "16:9");
  if (!existsSync(ws.bible)) {
    writeJsonAtomic(ws.bible, {
      title: v.title ?? "Untitled series", ratio, dialogue: false, style: "", sheetStyle: "",
      characters: [], groups: [], scenes: [], locks: [],
    });
    created.push("bible.json");
  } else kept.push("bible.json");
  const { craft, io } = await craftModules();
  if (existsSync(ws.project)) {
    io.loadProject(ws.project, { sidecarKey: SIDECAR_KEY }); // refuses another mode's project
    kept.push("project.json");
  } else {
    const bible = loadBible(ws);
    const size = assumedVideoSize("480p", bible.ratio);
    const doc = craft.emptyProject({
      title: bible.title || v.title || "Untitled series",
      settings: { ...size, fps: 24, aspectRatio: bible.ratio },
      sidecarKey: SIDECAR_KEY,
      sidecar: emptySidecar(),
    });
    io.saveProject(ws.project, doc);
    created.push("project.json");
  }
  const tools = toolReport();
  emit(v, { command: "init", dir: ws.root, created, kept, tools }, [
    `series workspace: ${ws.root}`,
    created.length ? `created: ${created.join(", ")}` : null,
    kept.length ? `kept: ${kept.join(", ")}` : null,
    toolLine(tools),
  ]);
}

function lockSummary(bible) {
  const states = S.lockStates(bible);
  const edited = Object.entries(states).filter(([, s]) => s.state === "edited").map(([k, s]) => `${k} (${s.changed.join(", ")})`);
  return { version: S.bibleVersion(bible), edited, states };
}

async function cmdSetSeries(v) {
  const ws = workspace(v);
  if (v.ratio !== undefined) await checkRatio(v.ratio);
  if (v.lang !== undefined && ![...S.BIBLE_LANGS, "auto"].includes(v.lang)) fail(`--lang must be ${S.BIBLE_LANGS.join(", ")} or auto (got: ${v.lang})`);
  const out = updateBible(ws, (b) => {
    if (v.title !== undefined) b.title = v.title;
    if (v.ratio !== undefined) b.ratio = v.ratio;
    if (v.lang !== undefined) {
      if (v.lang === "auto") delete b.lang;
      else b.lang = v.lang;
    }
    if (v.dialogue !== undefined) b.dialogue = parseBool(v.dialogue, "--dialogue");
    if (v.style !== undefined) b.style = v.style;
    if (v["sheet-style"] !== undefined) b.sheetStyle = v["sheet-style"];
  });
  const bible = loadBible(ws);
  const locks = lockSummary(bible);
  emit(v, { command: "set-series", bible: out, version: locks.version, edited: locks.edited, lang: bibleLang(bible) }, [
    `bible.json updated (version ${locks.version}${locks.edited.length ? `; edited since lock: ${locks.edited.join("; ")}` : ""}; prompt scaffolding: ${bibleLang(bible)}${bible.lang ? "" : ", from the bible's text"})`,
  ]);
}

/** Which flags each `set-<kind>` takes beyond --name and --look. */
const ENTITY_FLAGS = Object.freeze({
  character: ["ability", "personality", "markings", "palette", "expression", "pose", "alias", "not-name"],
  group: ["leader", "markings", "palette", "pose", "alias", "not-name"],
  scene: ["time", "rules"],
});
const ENTITY_FLAG_FIELDS = Object.freeze({
  ability: "ability", personality: "personality", markings: "markings", palette: "palette",
  expression: "expressions", pose: "poses", leader: "leader", time: "time", rules: "rules",
  alias: "aliases", "not-name": "notNames",
});

/** `--palette #abc` (a list) or `--palette body=#abc` (label → colour), repeatable. */
function parsePalette(values) {
  const items = values.map((x) => x.trim()).filter(Boolean);
  if (!items.length) return [];
  const labelled = items.filter((x) => x.includes("="));
  if (labelled.length && labelled.length !== items.length) fail("--palette: use either colours or label=colour for every entry, not both");
  if (!labelled.length) return items;
  return Object.fromEntries(items.map((x) => {
    const at = x.indexOf("=");
    return [x.slice(0, at).trim(), x.slice(at + 1).trim()];
  }));
}

function makeSetEntity(kind) {
  const listName = { character: "characters", group: "groups", scene: "scenes" }[kind];
  return async (v) => {
    const ws = workspace(v);
    const id = v.id;
    if (!S.ENTITY_ID_RE.test(String(id ?? ""))) fail(`--id must match ${S.ENTITY_ID_RE} (got: ${id})`);
    let created = false;
    updateBible(ws, (b) => {
      b[listName] ??= [];
      let entity = b[listName].find((e) => e.id === id);
      if (!entity) {
        created = true;
        entity = kind === "character"
          ? { id, name: id, look: "", ability: "", personality: "", palette: [], expressions: [], poses: [], sheet: null }
          : { id, name: id, look: "", sheet: null };
        b[listName].push(entity);
      }
      const allowed = ENTITY_FLAGS[kind];
      const stray = Object.keys(ENTITY_FLAG_FIELDS).filter((flag) => v[flag] !== undefined && !allowed.includes(flag));
      if (stray.length) fail(`set-${kind} does not take ${stray.map((f) => `--${f}`).join(", ")} (it takes ${["--name", "--look", ...allowed.map((f) => `--${f}`)].join(", ")})`);
      if (v.name !== undefined) entity.name = v.name;
      if (v.look !== undefined) entity.look = v.look;
      for (const flag of allowed) {
        if (v[flag] === undefined) continue;
        const field = ENTITY_FLAG_FIELDS[flag];
        if (flag === "palette") entity.palette = parsePalette(v.palette);
        else if (Array.isArray(v[flag])) entity[field] = v[flag].map((x) => x.trim()).filter(Boolean);
        else if (v[flag] === "" && ["markings", "leader", "time", "rules"].includes(flag)) delete entity[field];
        else entity[field] = v[flag];
      }
    });
    const bible = loadBible(ws);
    const entity = S.findEntity(bible, kind, id);
    const state = S.lockStates(bible)[S.entityKey(kind, id)];
    emit(v, { command: `set-${kind}`, created, [kind]: entity, lock: state }, [
      `${created ? "added" : "updated"} ${kind} "${id}" (${state.state}${state.changed.length ? `: ${state.changed.join(", ")}` : ""})`,
    ]);
  };
}

async function cmdLock(v) {
  const ws = workspace(v);
  const bible = loadBible(ws);
  const latest = S.latestLock(bible);
  const states = S.lockStates(bible);
  const unchanged = latest && Object.values(states).every((s) => s.state === "locked");
  if (unchanged) {
    emit(v, { command: "lock", version: latest.version, changed: false }, [`nothing changed since v${latest.version} — no new lock`]);
    return;
  }
  const at = new Date(nowFrom(v)()).toISOString();
  let lock;
  updateBible(ws, (b) => {
    lock = S.lockEntry({ ...bible, ...b, characters: b.characters ?? [], groups: b.groups ?? [], scenes: b.scenes ?? [], locks: b.locks ?? [] }, at);
    b.locks = [...(b.locks ?? []), lock];
  });
  emit(v, { command: "lock", version: lock.version, at, changed: true }, [`locked the bible as v${lock.version} (${at})`]);
}

async function cmdPick(v) {
  const ws = workspace(v);
  const { craft } = await craftModules();
  const bible = loadBible(ws);
  const doc = await loadDoc(ws);
  const statusOf = statusLookup(doc, craft);
  // With --episode, --character names a cast member (accept-drift), not a sheet pick.
  const kind = v.episode ? null : v.character ? "character" : v.group ? "group" : v.scene ? "scene" : null;
  if (kind) {
    const id = v[kind];
    if (!S.findEntity(bible, kind, id)) fail(`no ${kind} "${id}" in bible.json`);
    if (v.sheet === undefined) fail("pick --" + kind + " needs --sheet <asset id> (or --sheet none)");
    const sheet = v.sheet === "none" ? null : v.sheet;
    if (sheet) {
      if (statusOf(sheet) !== "ready") fail(`'${sheet}' is ${statusOf(sheet) ?? "not in project.json"} — only a ready sheet can be picked`);
      const candidates = sheetSlot(doc, S.entityKey(kind, id)).candidates.map((c) => c.asset);
      if (!candidates.includes(sheet)) fail(`'${sheet}' is not a sheet candidate of ${kind} "${id}" (candidates: ${candidates.join(", ") || "none"})`);
    }
    const listName = { character: "characters", group: "groups", scene: "scenes" }[kind];
    updateBible(ws, (b) => {
      b[listName].find((e) => e.id === id).sheet = sheet;
    });
    emit(v, { command: "pick", [kind]: id, sheet }, [`${kind} "${id}" now uses ${sheet ?? "no sheet"}`]);
    return;
  }
  if (!v.episode) fail("pick needs --character/--group/--scene <id> --sheet <asset>, or --episode <id> with --storyboard/--take/--accept-drift/--acknowledge");
  const episode = loadEpisode(ws, v.episode, bible);
  if (v.acknowledge) {
    const version = S.bibleVersion(bible);
    updateEpisode(ws, episode.id, bible, (e) => {
      e.picks ??= {};
      e.picks.acknowledgedBibleVersion = version;
    });
    emit(v, { command: "pick", episode: episode.id, acknowledgedBibleVersion: version }, [`${episode.id}: acknowledged bible v${version}`]);
    return;
  }
  const [partId] = partsOf(episode, v, { single: true });
  const slots = partSlots(doc, episode.id, partId);
  if (v.storyboard || v.take) {
    const field = v.storyboard ? "storyboard" : "take";
    const asset = v.storyboard ?? v.take;
    const pool = (field === "storyboard" ? slots.boards : slots.takes).map((r) => r.asset);
    if (!pool.includes(asset)) fail(`'${asset}' is not a ${field} of ${episode.id} part ${partId} (have: ${pool.join(", ") || "none"})`);
    if (statusOf(asset) !== "ready") fail(`'${asset}' is ${statusOf(asset)} — only a ready ${field} can be picked`);
    updateEpisode(ws, episode.id, bible, (e) => {
      e.picks ??= {};
      e.picks[field] = { ...(e.picks[field] ?? {}), [partId]: asset };
    });
    emit(v, { command: "pick", episode: episode.id, part: partId, [field]: asset }, [`${episode.id} part ${partId} now uses ${field} ${asset}`]);
    return;
  }
  if (v["accept-drift"]) {
    const shot = parseNumber(v.shot, "--shot", { integer: true, min: 1 });
    const characters = cellKeysOf(v, episode);
    if (!shot || !characters.length) fail("--accept-drift needs --shot <n> and --character <id> (or --group <id>)");
    const take = verdictSource(doc, statusOf, episode, partId, shot, v.take);
    for (const character of characters) {
      const verdict = slots.checks?.[take]?.[String(shot)]?.[character]?.verdict;
      if (verdict !== "drift") fail(`shot ${shot} × ${character} on ${take} is ${verdict ?? "unverified"}, not a drift — nothing to accept`);
    }
    updateEpisode(ws, episode.id, bible, (e) => {
      e.picks ??= {};
      const list = e.picks.acceptedDrift ?? [];
      for (const character of characters) {
        if (!list.some((d) => d.take === take && d.shot === shot && d.character === character)) list.push({ take, shot, character });
      }
      e.picks.acceptedDrift = list;
    });
    emit(v, { command: "pick", episode: episode.id, part: partId, acceptedDrift: { take, shot, characters } }, [`${episode.id}: accepted the drift of ${characters.join(", ")} in shot ${shot} of ${take}`]);
    return;
  }
  fail("pick --episode needs --storyboard <asset>, --take <asset>, --accept-drift, or --acknowledge");
}

// ---------------------------------------------------------------------------
// Episodes
// ---------------------------------------------------------------------------

/** Shots from a file or stdin: a list of shots, a list of lists, or { parts }. */
function readShots(source) {
  const text = source === "-" ? readFileSync(0, "utf-8") : (() => {
    if (!existsSync(resolve(source))) fail(`--shots-file: ${source} does not exist`);
    return readFileSync(resolve(source), "utf-8");
  })();
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    fail(`--shots-file is not valid JSON: ${errorMessage(error)}`);
  }
  let parts;
  if (Array.isArray(data) && data.every((x) => Array.isArray(x))) parts = data.map((shots) => ({ shots }));
  else if (Array.isArray(data) && data.every((x) => x && Array.isArray(x.shots))) parts = data;
  else if (Array.isArray(data)) parts = [{ shots: data }];
  else if (data && Array.isArray(data.parts)) parts = data.parts;
  else fail("--shots-file must hold a list of shots, a list of lists, or { parts: [{ shots }] }");
  return parts.map((part, k) => ({
    id: S.PART_IDS[k],
    shots: part.shots.map((shot) => {
      const out = { dur: Number(shot.dur), desc: String(shot.desc ?? "") };
      out.sfx = String(shot.sfx ?? "");
      if (shot.sketch) out.sketch = String(shot.sketch);
      return out;
    }),
  }));
}

function applyEpisodeFlags(e, v) {
  if (v.title !== undefined) e.title = v.title;
  if (v.duration !== undefined) e.duration = parseNumber(v.duration, "--duration", { min: 1 });
  if (v.cast !== undefined) e.cast = listFlag([v.cast]);
  if (v.groups !== undefined) e.groups = listFlag([v.groups]);
  if (v.scene !== undefined) e.scene = v.scene === "" || v.scene === "none" ? null : v.scene;
  if (v.time !== undefined) e.time = v.time;
  if (v.continuity) e.continuity = v.continuity.map((line) => line.trim()).filter(Boolean);
  if (v["shots-file"] !== undefined) e.parts = readShots(v["shots-file"]);
}

function timingReport(episode) {
  const report = S.checkEpisode(episode);
  if (episode.parts.length && report.errors.length) {
    fail(`refusing to write: the shot list breaks the timing rules:\n- ${report.errors.map((e) => e.message).join("\n- ")}`);
  }
  for (const w of report.warnings) note(`WARN: ${w.message}`);
  return report;
}

async function cmdAddEpisode(v) {
  const ws = workspace(v);
  const bible = loadBible(ws);
  const ids = listEpisodeIds(ws);
  const id = v.episode ?? `ep${String((ids.map((x) => Number(x.slice(2))).reduce((a, b) => Math.max(a, b), 0)) + 1).padStart(2, "0")}`;
  checkEpisodeId(id);
  if (existsSync(episodePath(ws, id)) && !v.force) fail(`episodes/${id}/episode.json already exists — edit it with set-episode / set-shot, or pass --force to replace it`);
  // The method's two continuity lines unless the episode names its own
  // (`--continuity ""` writes none): without them a clip's shots do not
  // pick up each other's action.
  const e = { title: v.title ?? "", duration: 30, cast: [], groups: [], scene: null, time: "", continuity: defaultContinuity(bible), parts: [], log: null, picks: {} };
  applyEpisodeFlags(e, v);
  const problems = S.checkEpisodeFile(e, bible);
  if (problems.length) fail(`refusing to write episodes/${id}/episode.json:\n- ${problems.join("\n- ")}`);
  const report = timingReport({ ...e, id });
  writeJsonAtomic(episodePath(ws, id), e);
  const per = S.partSeconds(e);
  emit(v, { command: "add-episode", episode: id, file: ws.rel(episodePath(ws, id)), parts: e.parts.length, warnings: report.warnings }, [
    `added ${id} "${e.title}" — ${e.duration} s, ${e.parts.length ? `${e.parts.length} part(s) of ${S.fmtSeconds(per)} s, ${e.parts.map((p) => `${p.shots.length} shots`).join(" + ")}` : "no shots yet (draft)"}`,
  ]);
}

async function cmdSetEpisode(v) {
  const ws = workspace(v);
  const bible = loadBible(ws);
  const id = checkEpisodeId(v.episode);
  let report;
  const out = updateEpisode(ws, id, bible, (e) => {
    applyEpisodeFlags(e, v);
    report = timingReport({ ...e, id });
  });
  emit(v, { command: "set-episode", episode: id, warnings: report.warnings, parts: out.parts.length }, [`updated ${id}`]);
}

async function cmdSetShot(v) {
  const ws = workspace(v);
  const bible = loadBible(ws);
  const episode = loadEpisode(ws, v.episode, bible);
  const [partId] = partsOf(episode, v, { single: true });
  const shot = parseNumber(v.shot, "--shot", { integer: true, min: 1 });
  if (!shot) fail("set-shot needs --shot <n>");
  let durations;
  let report;
  updateEpisode(ws, episode.id, bible, (e) => {
    const part = e.parts.find((p) => p.id === partId);
    if (!part?.shots?.[shot - 1]) fail(`part ${partId} has no shot ${shot}`);
    if (v.dur !== undefined) part.shots = S.rebalance(part.shots, shot - 1, parseNumber(v.dur, "--dur", { min: 0 }), v.from ?? "both");
    const target = part.shots[shot - 1];
    if (v.desc !== undefined) target.desc = v.desc;
    if (v.sfx !== undefined) target.sfx = v.sfx;
    if (v.sketch !== undefined) {
      if (v.sketch === "") delete target.sketch;
      else target.sketch = v.sketch;
    }
    durations = part.shots.map((s) => s.dur);
    report = timingReport({ ...e, id: episode.id });
  });
  emit(v, { command: "set-shot", episode: episode.id, part: partId, shot, durations, warnings: report.warnings }, [
    `${episode.id} part ${partId} shot ${shot} updated; durations: ${durations.map(S.fmtSeconds).join(" · ")}`,
  ]);
}

async function cmdLog(v) {
  const ws = workspace(v);
  const bible = loadBible(ws);
  const id = checkEpisodeId(v.episode);
  const out = updateEpisode(ws, id, bible, (e) => {
    const log = { ...(e.log ?? {}) };
    if (v.goal !== undefined) log.goal = v.goal;
    if (v.location !== undefined) log.location = v.location;
    if (v.used) log.abilities = v.used;
    if (v.ending !== undefined) log.ending = v.ending;
    e.log = log;
  });
  emit(v, { command: "log", episode: id, log: out.log }, [`${id} log: ${JSON.stringify(out.log)}`]);
}

async function cmdIdeasContext(v) {
  const ws = workspace(v);
  const bible = loadBible(ws);
  const episodes = listEpisodeIds(ws).map((id) => loadEpisode(ws, id, bible));
  const ideas = S.usedIdeas(bible, episodes);
  const unlogged = episodes.filter((e) => !ideas.episodes.some((r) => r.episode === e.id)).map((e) => e.id);
  emit(v, { command: "ideas-context", ...ideas, unlogged }, [
    `already made (${ideas.episodes.length} logged episode(s)):`,
    ...ideas.episodes.map((r) => `  ${r.episode} "${r.title}" — place: ${r.location || "?"} · goal: ${r.goal || "?"} · abilities: ${r.abilities.join("; ") || "?"} · ending: ${r.ending || "?"}`),
    `used places: ${ideas.locations.join("; ") || "none"}`,
    `used goals: ${ideas.goals.join("; ") || "none"}`,
    `used abilities: ${ideas.abilities.join("; ") || "none"}`,
    `used endings: ${ideas.endings.join("; ") || "none"}`,
    unlogged.length ? `not logged yet: ${unlogged.join(", ")} (series.mjs log --episode <id> --goal … --used … --ending …)` : null,
  ]);
}

// ---------------------------------------------------------------------------
// prompts / estimate
// ---------------------------------------------------------------------------

function entityTargets(bible, v) {
  if (v.character) return [["character", v.character]];
  if (v.group) return [["group", v.group]];
  if (v.scene) return [["scene", v.scene]];
  return [
    ...bible.characters.map((c) => ["character", c.id]),
    ...bible.groups.map((g) => ["group", g.id]),
    ...bible.scenes.map((s) => ["scene", s.id]),
  ];
}

async function cmdPrompts(v) {
  const ws = workspace(v);
  const bible = loadBible(ws);
  const target = v.target ?? "seedance";
  if (!["seedance", "jimeng", "all"].includes(target)) fail(`--target must be seedance, jimeng or all (got: ${target})`);
  if (v.sheets || !v.episode) {
    const { craft } = await craftModules();
    const statusOf = existsSync(ws.project) ? statusLookup(await loadDoc(ws), craft) : () => undefined;
    const styleRefs = castStyleRefs(bible, statusOf);
    const sheets = entityTargets(bible, v).map(([kind, id]) => {
      const sheet = sheetPrompt(bible, kind, id, { styleReferences: kind === "scene" ? styleRefs.length : 0 });
      return { ...sheet, styleRefs: kind === "scene" ? styleRefs : [], jimeng: jimengSheet(sheet) };
    });
    if (v.write) {
      for (const s of sheets) {
        writeFileSync(join(mkdirOut(ws.root, "prompts"), `sheet-${s.kind}-${s.id}.txt`), `${s.jimeng}\n`);
      }
    }
    emit(v, { command: "prompts", sheets }, sheets.flatMap((s) => [`== ${s.kind} ${s.id} sheet (${s.aspectRatio})`, target === "jimeng" ? s.jimeng : s.prompt, ""]));
    return;
  }
  const { craft } = await craftModules();
  const episode = loadEpisode(ws, v.episode, bible);
  const doc = existsSync(ws.project) ? await loadDoc(ws) : null;
  const statusOf = doc ? statusLookup(doc, craft) : () => undefined;
  const warnings = [];
  const sheetOf = sheetResolver(bible, statusOf, warnings);
  const lang = bibleLang(bible);
  if (v.shot !== undefined) {
    // One panel's redraw prompt, for the copy-paste route: the canvas line
    // lists the board node first, then the sheets, in the prompt's numbering.
    // Not recorded: redo-panel records what it actually sends or registers.
    if (v.shots) fail("--shot (one panel) and --shots (a re-shoot span) do not go together");
    const [partId] = partsOf(episode, v, { single: true });
    const part = episode.parts.find((p) => p.id === partId);
    const shot = parseNumber(v.shot, "--shot", { integer: true, min: 1 });
    if (!shot || shot > part.shots.length) fail(`--shot must be 1–${part.shots.length}`);
    const board = doc ? effectiveBoard(doc, statusOf, episode, partId).asset : null;
    if (!board) fail(`${episode.id} part ${partId} has no ready storyboard to redraw a panel of — draw one first (prompts --episode ${episode.id} --target jimeng, then shoot-board --upload)`);
    const boardFile = assetById(doc, board)?.uri ?? board;
    const panel = assemblePanel(bible, episode, partId, shot, { sheetOf, board, boardFile });
    for (const w of warnings) note(`WARN: ${w}`);
    if (v.write) {
      const dir = mkdirOut(ws.root, join("episodes", episode.id, "prompts"));
      const tag = `${partId.toLowerCase()}-${shot}`;
      writeFileSync(join(dir, `panel-${tag}.txt`), `${panel.prompt}\n`);
      writeFileSync(join(dir, `jimeng-panel-${tag}.txt`), `${panel.jimeng.panel}\n`);
    }
    emit(v, { command: "prompts", episode: episode.id, lang, panel, warnings }, [
      `== ${episode.id} part ${partId} panel ${shot} · ${panel.aspectRatio} · scaffolding ${lang} · image 1 is ${boardFile}, the style reference; the sheets follow`,
      ...(target !== "jimeng" ? ["-- panel (image model)", panel.prompt, ""] : []),
      ...(target !== "seedance" ? ["-- Jimeng panel", panel.jimeng.panel, ""] : []),
    ]);
    return;
  }
  if (v.shots) {
    // A re-shoot's prompts, Seedance and Jimeng, for the copy-paste route.
    // Not recorded: patch-range records what it actually sends.
    const [partId] = partsOf(episode, v, { single: true });
    const [a, b] = parseRange(v.shots);
    const board = doc ? effectiveBoard(doc, statusOf, episode, partId).asset : null;
    const patch = assemblePatch(bible, episode, partId, a, b, { sheetOf, board, limit: SEEDANCE_MAX_REFS });
    for (const w of [...warnings, ...patch.warnings]) note(`WARN: ${w}`);
    // The splice check patch-range makes, here too: on the copy-paste route
    // this is the last step before the user renders the span elsewhere.
    const take = doc ? effectiveTake(doc, statusOf, episode, partId).asset : null;
    const takeLine = take && statusOf(take) === "ready" ? takeTimeline(doc, episode, partId, take) : null;
    const ends = takeLine && takeLine.length === episode.parts.find((p) => p.id === partId).shots.length
      ? spliceEndCheck(ws, doc, statusOf, episode, partId, take, [takeLine[a - 1].start, takeLine[b - 1].end], [a, b])
      : { uncut: null, warnings: [] };
    for (const w of ends.warnings) note(`WARN: ${w}`);
    if (v.write) {
      const dir = mkdirOut(ws.root, join("episodes", episode.id, "prompts"));
      const tag = `${partId.toLowerCase()}-${a}-${b}`;
      writeFileSync(join(dir, `patch-${tag}.txt`), `${patch.video.prompt}\n`);
      writeFileSync(join(dir, `jimeng-patch-${tag}.txt`), `${patch.jimeng.video}\n`);
    }
    emit(v, { command: "prompts", episode: episode.id, lang, patch, warnings: [...warnings, ...ends.warnings], uncutEnds: ends.uncut }, [
      `== ${episode.id} part ${partId} re-shoot of shots ${a}–${b} · covers ${patch.plan.covered.join("–")} · ${patch.plan.requestSeconds} s requested · scaffolding ${lang}`,
      ...patch.warnings.map((w) => `WARN: ${w}`),
      ...(target !== "jimeng" ? ["-- video (Seedance 2.5 reference-to-video)", patch.video.prompt, ""] : []),
      ...(target !== "seedance" ? ["-- Jimeng video", patch.jimeng.video, ""] : []),
    ]);
    return;
  }
  const parts = partsOf(episode, v).map((partId) => {
    const board = doc ? effectiveBoard(doc, statusOf, episode, partId).asset : null;
    return assemblePart(bible, episode, partId, { sheetOf, board, limit: SEEDANCE_MAX_REFS });
  });
  for (const w of warnings) note(`WARN: ${w}`);
  // The sidecar keeps the assembled text so the viewer shows what will be
  // sent. Saved only when it changed: printing prompts is a read.
  let recorded = [];
  if (doc) {
    const at = nowFrom(v)();
    const fresh = await loadDoc(ws);
    const slots = episodeSlots(fresh, episode.id);
    for (const p of parts) {
      const part = episode.parts.find((x) => x.id === p.part);
      const record = {
        basis: S.shotBasis(bible, episode),
        boardShots: S.boardShotHashes(part),
        clipShots: S.clipShotHashes(part),
        setup: S.setupHash(episode),
        refs: p.refs,
        storyboard: p.storyboard.prompt,
        video: p.video.prompt,
        jimeng: p.jimeng,
      };
      const { at: _was, ...previous } = slots.prompts[p.part] ?? {};
      if (S.canonicalJson(previous) === S.canonicalJson(record)) continue;
      slots.prompts[p.part] = { at, ...record };
      recorded.push(p.part);
    }
    if (recorded.length) await saveDoc(ws, fresh);
  }
  if (v.write) {
    const dir = mkdirOut(ws.root, join("episodes", episode.id, "prompts"));
    for (const p of parts) {
      const tag = p.part.toLowerCase();
      writeFileSync(join(dir, `storyboard-${tag}.txt`), `${p.storyboard.prompt}\n`);
      writeFileSync(join(dir, `video-${tag}.txt`), `${p.video.prompt}\n`);
      writeFileSync(join(dir, `jimeng-storyboard-${tag}.txt`), `${p.jimeng.storyboard}\n`);
      writeFileSync(join(dir, `jimeng-video-${tag}.txt`), `${p.jimeng.video}\n`);
    }
  }
  emit(v, { command: "prompts", episode: episode.id, lang, parts, warnings, recorded }, [
    ...parts.flatMap((p) => [
      `== ${episode.id} part ${p.part} · ${p.shots} shots · ${p.grid.rows}×${p.grid.cols} · ${S.fmtSeconds(p.seconds)} s · scaffolding ${lang} · refs: ${p.refs.map((r) => `@Image${r.n} ${r.name}${r.asset ? "" : " (not drawn yet)"}`).join(", ")}${p.textOnly.length ? ` · text only: ${p.textOnly.map((t) => t.name).join(", ")}` : ""}`,
      ...p.warnings.map((w) => `WARN: ${w}`),
      ...(target !== "jimeng" ? ["-- storyboard (image model)", p.storyboard.prompt, "", "-- video (Seedance 2.5 reference-to-video)", p.video.prompt, ""] : []),
      ...(target !== "seedance" ? ["-- Jimeng storyboard", p.jimeng.storyboard, "", "-- Jimeng video", p.jimeng.video, ""] : []),
    ]),
    doc ? (recorded.length ? `recorded for the viewer: part ${recorded.join(", ")}` : "the viewer already shows these prompts — project.json not written") : null,
  ]);
}

function mkdirOut(root, rel) {
  const dir = join(root, rel);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function cmdEstimate(v) {
  const ws = workspace(v);
  const { craft } = await craftModules();
  const bible = loadBible(ws);
  const doc = await loadDoc(ws);
  const statusOf = statusLookup(doc, craft);
  const gen = await generators();
  const quality = v.quality ?? "high";
  const resolution = v.resolution ?? "480p";
  const rows = [];
  // Each image row is priced for the model the paid command would use with
  // the same flags — the references decide the default, as they do there.
  const imageRow = (what, references, count = 1) => {
    const { model, why } = chosenImageModel(gen, v, references);
    const cost = imageCost(doc, model, quality);
    return {
      what: `${what}${count > 1 ? ` × ${count}` : ""} (${model.split("/").pop()}, ${why})`,
      usd: cost ? round4(cost.usd * count) : null,
      basis: cost?.basis ?? null,
      note: cost?.note ?? `no reported ${model} price in this project and no table price for quality ${quality} — unpriced, never free`,
    };
  };
  if (v.sheets) {
    const count = parseNumber(v.count, "--count", { integer: true, min: 1 }) ?? 2;
    const styleRefs = castStyleRefs(bible, statusOf).length;
    // make-sheets' model rule: flare unless --model (scene style references do not switch it).
    for (const [kind, id] of entityTargets(bible, v)) {
      const model = gen.resolveImageModel(v.model ?? "flare");
      const cost = imageCost(doc, model, quality);
      rows.push({
        what: `${kind} ${id} sheet × ${count} (${model.split("/").pop()}${kind === "scene" && styleRefs ? `, ${styleRefs} style reference(s)` : ""})`,
        usd: cost ? round4(cost.usd * count) : null, basis: cost?.basis ?? null,
        note: cost?.note ?? `no reported ${model} price in this project — unpriced, never free`,
      });
    }
  }
  if (v.episode) {
    const episode = loadEpisode(ws, v.episode, bible);
    requireTiming(episode);
    const sheetOf = sheetResolver(bible, statusOf, []);
    for (const partId of partsOf(episode, v)) {
      const what = v.what ?? "all";
      if (!["all", "board", "video", "panel"].includes(what)) fail(`--what must be all, board, panel or video (got: ${what})`);
      if (v.shots) {
        const [a, b] = parseRange(v.shots);
        const plan = S.patchPlan(episode.parts.find((p) => p.id === partId).shots, a, b);
        const est = videoEstimate(gen, { resolution, ratio: bible.ratio, seconds: plan.requestSeconds });
        rows.push({ what: `${episode.id} part ${partId} patch ${a}–${b} (${plan.requestSeconds} s)`, ...est });
        continue;
      }
      const references = assemblePart(bible, episode, partId, { sheetOf }).storyboard.refs.length;
      if (what === "all" || what === "board") rows.push(imageRow(`${episode.id} part ${partId} storyboard`, references));
      if (what === "panel") rows.push(imageRow(`${episode.id} part ${partId} one redrawn panel`, references));
      if (what === "all" || what === "video") {
        const seconds = S.partSeconds(episode);
        rows.push({ what: `${episode.id} part ${partId} video ${seconds} s ${resolution}`, ...videoEstimate(gen, { resolution, ratio: bible.ratio, seconds }) });
      }
    }
  }
  if (v.lineup) {
    const sheets = lineupSheets(bible, statusOf, v);
    rows.push(imageRow(`lineup of ${sheets.map((x) => x.name).join(", ")}`, sheets.length));
  }
  if (!rows.length) fail("estimate needs --episode <id> (optionally --part, --what all|board|panel|video, --shots a-b), --sheets, or --lineup");
  const pricedRows = rows.filter((r) => r.usd !== null);
  const total = pricedRows.length ? round4(pricedRows.reduce((sum, r) => sum + r.usd, 0)) : null;
  const unpriced = rows.filter((r) => r.usd === null).map((r) => r.what);
  emit(v, { command: "estimate", rows, total, unpriced, currency: "USD" }, [
    ...rows.map((r) => `  ${r.what}: ${r.usd === null ? "unpriced" : `≈ ${money(r.usd)}`} — ${r.note}`),
    total === null
      ? `total: unpriced (${unpriced.length} call(s) without a price — never free)`
      : `total ≈ ${money(total)} (estimates, not invoices)${unpriced.length ? `; plus ${unpriced.length} unpriced call(s)` : ""}`,
  ]);
}

// ---------------------------------------------------------------------------
// status / validate
// ---------------------------------------------------------------------------

function episodeReport(doc, statusOf, bible, episode) {
  const slots = episodeSlots(doc, episode.id);
  const timing = S.checkEpisode(episode);
  const stage = S.episodeStage(episode, slots, statusOf);
  const parts = episode.parts.map((part) => {
    const ps = partSlots(doc, episode.id, part.id);
    const board = effectiveBoard(doc, statusOf, episode, part.id);
    const take = effectiveTake(doc, statusOf, episode, part.id);
    const boardRecord = ps.boards.find((b) => b.asset === board.asset);
    const takeRecord = ps.takes.find((t) => t.asset === take.asset);
    const cells = take.asset ? S.partCells(episode, part.id, ps, take.asset, statusOf, episode.picks?.acceptedDrift ?? [], { bible }) : [];
    const count = (verdict) => cells.filter((c) => c.verdict === verdict).length;
    const nameOf = (c) => S.findEntity(bible, c.kind, c.id)?.name ?? c.id;
    const timeline = S.shotTimeline(part.shots);
    return {
      part: part.id,
      shots: part.shots.length,
      board: board.asset,
      boardPicked: board.picked,
      boardStaleShots: boardRecord ? S.staleShots(boardRecord.shots, S.boardShotHashes(part)) : [],
      take: take.asset,
      takePicked: take.picked,
      // A shot an applied patch re-shot is current (cutStaleShots, as the viewer reads it).
      takeStaleShots: takeRecord ? S.cutStaleShots(takeRecord, ps, statusOf, S.clipShotHashes(part)) : [],
      takeSetupChanged: takeRecord ? takeRecord.setup !== S.setupHash(episode) : false,
      takeBoardChanged: takeRecord ? takeRecord.board !== board.asset : false,
      bible: takeRecord ? S.bibleFlag(bible, takeRecord.basis, episode.picks?.acknowledgedBibleVersion ?? null) : null,
      checks: { ok: count("ok"), drift: count("drift"), absent: count("absent"), unverified: count("unverified"), accepted: cells.filter((c) => c.accepted).length },
      drift: cells.filter((c) => c.verdict === "drift" && !c.accepted).map((c) => ({ shot: c.shot, character: c.character, name: nameOf(c), note: c.note, source: c.source })),
      // Absent from a shot whose words name it: a lost beat, not a pass.
      lost: cells.filter((c) => c.verdict === "absent" && c.expected).map((c) => ({ shot: c.shot, character: c.character, name: nameOf(c), note: c.note, source: c.source })),
      shotRows: part.shots.map((shot, i) => ({
        shot: i + 1,
        start: timeline[i].start,
        end: timeline[i].end,
        desc: shot.desc,
        cells: cells.filter((c) => c.shot === i + 1).map((c) => ({ character: c.character, name: nameOf(c), verdict: c.verdict, accepted: c.accepted, expected: c.expected, note: c.note, source: c.source })),
      })),
      reviewed: take.asset ? ps.reviews.some((r) => r.take === take.asset && statusOf(r.asset) === "ready") : false,
      patches: ps.patches.map((p) => ({ asset: p.asset, status: statusOf(p.asset), shots: p.shots, take: p.take })),
      busy: [...ps.boards, ...ps.panels, ...ps.takes, ...ps.patches].filter((r) => ["pending", "generating"].includes(statusOf(r.asset))).map((r) => r.asset),
    };
  });
  const finals = slots.finals.filter((f) => statusOf(f.asset) === "ready");
  return {
    episode: episode.id,
    title: episode.title,
    duration: episode.duration,
    stage: stage.stage,
    busy: stage.busy,
    unverified: stage.unverified,
    finalReady: stage.finalReady,
    timing: { errors: timing.errors.map((e) => e.message), warnings: timing.warnings.map((w) => w.message) },
    parts,
    final: finals.length ? finals[finals.length - 1].asset : null,
    logged: Boolean(episode.log && (episode.log.goal || episode.log.ending)),
  };
}

async function cmdStatus(v) {
  const ws = workspace(v);
  const { craft } = await craftModules();
  const bible = loadBible(ws);
  const doc = await loadDoc(ws);
  const statusOf = statusLookup(doc, craft);
  const locks = lockSummary(bible);
  const entities = S.bibleEntities(bible).filter((e) => e.kind !== "style").map((e) => {
    const slot = sidecar(doc).sheets[e.key] ?? { candidates: [], compares: [] };
    const picked = e.entity.sheet ?? null;
    const pickedRecord = slot.candidates.find((c) => c.asset === picked);
    return {
      key: e.key,
      name: e.name,
      lock: locks.states[e.key],
      sheet: picked,
      sheetStatus: picked ? statusOf(picked) ?? "missing" : null,
      sheetPredatesText: pickedRecord ? S.basisChanges(bible, pickedRecord.basis).map((c) => `${c.key}: ${c.fields.join(", ")}`) : [],
      candidates: slot.candidates.map((c) => ({ asset: c.asset, status: statusOf(c.asset), verdict: c.check?.verdict ?? "unverified" })),
    };
  });
  const episodeIds = v.episode ? [checkEpisodeId(v.episode)] : listEpisodeIds(ws);
  const episodes = episodeIds.map((id) => episodeReport(doc, statusOf, bible, loadEpisode(ws, id, bible)));
  const cost = craft.summarizeCosts(doc);
  const failed = doc.assets.filter((a) => craft.statusOf(a) === "failed").map((a) => ({ id: a.id, reason: edgeOf(doc, a.id)?.operation?.params?.failure?.reason ?? "", billing: edgeOf(doc, a.id)?.operation?.params?.failure?.billing ?? null }));
  const lineups = sidecar(doc).lineups.map((l) => ({ ...l, status: statusOf(l.asset) ?? "missing" }));
  const tools = toolReport();
  const payload = { command: "status", title: bible.title, lang: bibleLang(bible), bibleVersion: locks.version, edited: locks.edited, entities, lineups, episodes, cost: { total: cost.total, calls: cost.calls, unpriced: cost.unpriced, uncertain: cost.uncertain, reconciled: cost.reconciled, inFlight: cost.inFlight }, failed, tools };
  const lines = [
    `${bible.title || "(untitled)"} · bible v${locks.version}${locks.edited.length ? ` · edited since lock: ${locks.edited.join("; ")}` : ""} · ≈ ${money(cost.total)} over ${cost.calls} call(s)${cost.unpriced.length ? ` · ${cost.unpriced.length} unpriced` : ""}${cost.uncertain.length ? ` · ${cost.uncertain.length} failed with unknown billing` : ""}${cost.reconciled.length ? ` · ${cost.reconciled.length} landed by request id (counted once)` : ""}${cost.inFlight.length ? ` · in flight: ${cost.inFlight.join(", ")}` : ""}`,
    toolLine(tools),
    ...(v.episode ? [] : entities).map((e) => `  ${e.key} "${e.name}" — ${e.lock.state}${e.lock.changed.length ? ` (${e.lock.changed.join(", ")})` : ""} · sheet ${e.sheet ?? "none"}${e.sheetStatus && e.sheetStatus !== "ready" ? ` [${e.sheetStatus}]` : ""}${e.candidates.length ? ` · candidates: ${e.candidates.map((c) => `${c.asset} ${c.status}/${c.verdict}`).join(", ")}` : ""}${e.sheetPredatesText.length ? ` · sheet predates: ${e.sheetPredatesText.join("; ")}` : ""}`),
  ];
  if (lineups.length && !v.episode) lines.push(`  lineups: ${lineups.map((l) => `${l.asset} (${l.characters.map((id) => S.findEntity(bible, "character", id)?.name ?? id).join(" · ")}) ${l.status}`).join("; ")}`);
  for (const ep of episodes) {
    const notDone = ep.finalReady && ep.stage !== "done" ? ` (final built, not done: ${ep.unverified} check(s) unverified)` : "";
    lines.push(`${ep.episode} "${ep.title}" ${ep.duration} s — ${ep.stage}${notDone}${ep.busy ? " (generating)" : ""}${ep.final ? ` · final ${ep.final}` : ""}${ep.logged ? "" : " · not logged"}`);
    for (const e of ep.timing.errors) lines.push(`    ERROR ${e}`);
    for (const w of ep.timing.warnings) lines.push(`    warn ${w}`);
    for (const p of ep.parts) {
      lines.push(`    part ${p.part}: board ${p.board ?? "none"}${p.board && !p.boardPicked ? " (newest, not picked)" : ""}${p.boardStaleShots.length ? ` · board predates shots ${p.boardStaleShots.join(",")}` : ""} · take ${p.take ?? "none"}${p.take && !p.takePicked ? " (newest, not picked)" : ""}${p.takeStaleShots.length ? ` · not re-shot: ${p.takeStaleShots.join(",")}` : ""}${p.takeSetupChanged ? " · setup changed since take" : ""}${p.takeBoardChanged ? " · board changed since take" : ""}`);
      if (p.bible?.stale) lines.push(`      shot under bible v${p.bible.shotUnder}; now v${p.bible.latest}: ${p.bible.changes.map((c) => `${c.name} (${c.fields.join(", ")})`).join("; ")}`);
      if (p.take) lines.push(`      checks: ${p.checks.ok} ok · ${p.checks.drift} drift${p.checks.accepted ? ` (${p.checks.accepted} accepted)` : ""} · ${p.checks.absent} absent · ${p.checks.unverified} unverified${p.reviewed ? "" : " · no contact sheet yet"}${p.drift.length ? ` · ${p.drift.map((d) => `shot ${d.shot} ${d.name}: ${d.note}`).join("; ")}` : ""}`);
      if (p.lost.length) lines.push(`      lost beats (absent where the shot's words name them): ${p.lost.map((d) => `shot ${d.shot} ${d.name}`).join("; ")}`);
      if (p.busy.length) lines.push(`      generating: ${p.busy.join(", ")}`);
      if (v.episode) {
        for (const row of p.shotRows) {
          const cells = row.cells.map((c) => `${c.name}${c.expected ? "*" : ""} ${c.accepted ? "drift (accepted)" : c.verdict}${c.source !== p.take ? ` [${c.source}]` : ""}`).join(" · ");
          const stale = [p.boardStaleShots.includes(row.shot) ? "board predates" : null, p.takeStaleShots.includes(row.shot) ? "not re-shot" : null].filter(Boolean).join(", ");
          lines.push(`      ${String(row.shot).padStart(2)} ${S.fmtSeconds(row.start)}–${S.fmtSeconds(row.end)}s  ${row.desc.length > 70 ? `${row.desc.slice(0, 69)}…` : row.desc}${stale ? `  (${stale})` : ""}`);
          if (p.take) lines.push(`           ${cells}`);
        }
        if (p.take) lines.push("      (* the shot's words name them; [asset] a shot judged on the patch spliced over it)");
      }
    }
  }
  if (failed.length) lines.push(`failed: ${failed.map((f) => `${f.id} (${f.billing ?? "?"}: ${f.reason})`).join("; ")} — series.mjs retry --asset <id>`);
  emit(v, payload, lines);
}

async function cmdValidate(v) {
  const ws = workspace(v);
  const problems = [];
  const raw = readJson(ws.bible, "bible.json");
  problems.push(...S.checkBible(raw).map((p) => `bible.json: ${p}`));
  const bible = problems.length ? null : loadBible(ws);
  for (const id of listEpisodeIds(ws)) {
    let episode;
    try {
      episode = JSON.parse(readFileSync(episodePath(ws, id), "utf-8"));
    } catch (error) {
      problems.push(`episodes/${id}/episode.json: not valid JSON (${errorMessage(error)})`);
      continue;
    }
    const fileProblems = S.checkEpisodeFile(episode, bible);
    problems.push(...fileProblems.map((p) => `episodes/${id}/episode.json: ${p}`));
    if (!fileProblems.length && episode.parts.length) problems.push(...S.checkEpisode(episode).errors.map((e) => `episodes/${id}/episode.json: ${e.message}`));
  }
  if (existsSync(ws.project)) {
    const doc = await loadDoc(ws);
    const ids = new Set(doc.assets.map((a) => a.id));
    const walk = (value, where) => {
      if (Array.isArray(value)) value.forEach((x, i) => walk(x, `${where}[${i}]`));
      else if (value && typeof value === "object") {
        for (const [k, x] of Object.entries(value)) {
          if ((k === "asset" || k === "take" || k === "board" || k === "result") && typeof x === "string" && !ids.has(x)) problems.push(`project.json series${where}.${k}: unknown asset '${x}'`);
          else walk(x, `${where}.${k}`);
        }
      }
    };
    walk(sidecar(doc), "");
    if (bible) {
      for (const e of S.bibleEntities(bible)) if (e.entity.sheet && !ids.has(e.entity.sheet)) problems.push(`bible.json ${e.key}.sheet: unknown asset '${e.entity.sheet}'`);
    }
  } else problems.push("project.json: missing — run 'series.mjs init'");
  emit(v, { command: "validate", ok: !problems.length, problems }, problems.length ? problems.map((p) => `PROBLEM ${p}`) : ["ok"]);
  if (problems.length) process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// make-sheets / check-sheets
// ---------------------------------------------------------------------------

async function cmdMakeSheets(v) {
  const ws = workspace(v);
  const now = nowFrom(v);
  const bible = loadBible(ws);
  let targets;
  if (v.missing) {
    targets = bible.characters.filter((c) => !c.sheet).map((c) => ["character", c.id]);
    if (!targets.length) fail("every character already has a picked sheet");
  } else {
    const kind = v.character ? "character" : v.group ? "group" : v.scene ? "scene" : null;
    if (!kind) fail("make-sheets needs --character <id>, --group <id>, --scene <id>, or --missing");
    targets = [[kind, v[kind]]];
  }
  if (v.upload) {
    if (targets.length !== 1) fail("--upload registers one image for one entity");
    const [kind, id] = targets[0];
    const entity = S.findEntity(bible, kind, id);
    if (!entity) fail(`no ${kind} "${id}" in bible.json`);
    const doc = await loadDoc(ws);
    const assetId = nextId(doc, `${KIND_PREFIX[kind]}-${id}-sheet-`);
    const uri = placeUpload(ws, v.upload, `refs/${assetId}${extOf(v.upload, ".png")}`);
    const basis = S.sheetBasis(bible, kind, id);
    const [landed] = await registerLocal(ws, { id: assetId, type: "image", name: `${entity.name} design sheet`, op: "upload", uri, params: { slot: { command: "make-sheets", kind, entity: id } } }, (d) => {
      sheetSlot(d, S.entityKey(kind, id)).candidates.push({ asset: assetId, basis });
    }, now);
    const aspectWarning = referenceAspectWarning(landed, uri, "Lay it out again in rows (a four-view turnaround as two rows of two) and upload that instead.");
    if (aspectWarning) note(`WARN: ${aspectWarning}`);
    const picked = v.pick || !entity.sheet;
    if (picked) pickSheet(ws, kind, id, assetId);
    emit(v, { command: "make-sheets", uploaded: assetId, uri, picked, warnings: aspectWarning ? [aspectWarning] : [] }, [`registered ${uri} as ${assetId}${picked ? ` and picked it for ${kind} "${id}"` : ` (candidate; pick it with: series.mjs pick --${kind} ${id} --sheet ${assetId})`}`]);
    return;
  }
  const count = parseNumber(v.count, "--count", { integer: true, min: 1 }) ?? 2;
  if (v.pick && count !== 1) fail("--pick needs --count 1: with several candidates the human picks");
  const gen = await generators();
  const model = gen.resolveImageModel(v.model ?? "flare");
  const quality = v.quality ?? "high";
  const doc = await loadDoc(ws);
  const statusOf = statusLookup(doc, (await craftModules()).craft);
  const plan = targets.map(([kind, id]) => {
    // A scene is drawn after the cast: the picked character sheets go along
    // as style-only references (text-only scene sheets came out photoreal).
    const styleRefs = kind === "scene" ? castStyleRefs(bible, statusOf) : [];
    if (kind === "scene" && !styleRefs.length) note(`WARN: no character has a picked, ready sheet — scene "${id}" is drawn from text only; scene sheets match the cast better once the cast sheets are picked`);
    const sheet = sheetPrompt(bible, kind, id, { styleReferences: styleRefs.length });
    return { kind, id, sheet, styleRefs, aspectRatio: imageAspect(v.aspect ?? sheet.aspectRatio) };
  });
  if (v["dry-run"]) {
    const estimate = imageCost(doc, model, quality);
    const requests = plan.map((p) => {
      const files = p.styleRefs.map((id) => assetFile(ws, doc, id));
      const body = gen.buildImageRequest({ prompt: p.sheet.prompt, model, numImages: 1, aspectRatio: p.aspectRatio, quality, imageUrls: files });
      const inlined = (body.input_references ?? []).map((r, i) => ({ uri: r.image_url.url, name: ws.rel(files[i]) }));
      return {
        entity: `${p.kind}:${p.id}`, count, provider: "openrouter", body: elide(body, inlined),
        cost: estimate ?? { usd: null, basis: null, note: "unpriced — OpenRouter reports the cost after the call" },
      };
    });
    emit(v, { command: "make-sheets", dryRun: true, requests }, [`dry run — nothing sent, nothing recorded`, ...requests.map((r) => `${r.entity} × ${count}: ${JSON.stringify(r.body)} · ${priced(r.cost)} each`)]);
    return;
  }
  const apiKey = gen.imageKey();
  if (!apiKey) fail(noKey("OpenRouter", "series.mjs prompts --sheets --target jimeng, then series.mjs make-sheets --<kind> <id> --upload <file>"));
  const rows = [];
  for (const p of plan) {
    const entity = S.findEntity(bible, p.kind, p.id);
    const basis = S.sheetBasis(bible, p.kind, p.id);
    const files = p.styleRefs.map((id) => assetFile(ws, doc, id));
    for (let i = 0; i < count; i += 1) {
      const fresh = await loadDoc(ws);
      const assetId = nextId(fresh, `${KIND_PREFIX[p.kind]}-${p.id}-sheet-`);
      const aspectRatio = p.aspectRatio;
      const row = await runPaid(ws, now, {
        reserve: {
          id: assetId, type: "image", name: `${entity.name} design sheet`, op: "generate", uri: `refs/${assetId}.png`,
          ...(p.styleRefs.length ? { from: p.styleRefs } : {}),
          model, prompt: p.sheet.prompt, provider: "openrouter",
          params: { slot: { command: "make-sheets", kind: p.kind, entity: p.id }, request: { aspectRatio, quality } },
          ...(imageCost(fresh, model, quality) ? { cost: imageCost(fresh, model, quality) } : {}),
        },
        call: async ({ signal }) => {
          const out = await gen.generateImage({ prompt: p.sheet.prompt, model, numImages: 1, aspectRatio, quality, imageUrls: files, apiKey, outputDir: join(ws.root, "refs"), filenamePrefix: assetId, signal });
          return { file: out.files[0], cost: reportedCost(out.usage) };
        },
        updateSidecar: (d, phase) => {
          if (phase !== "reserve") return;
          const slot = sheetSlot(d, S.entityKey(p.kind, p.id));
          claimSlot(slot.candidates, assetId, { asset: assetId, basis });
        },
      });
      rows.push({ entity: `${p.kind}:${p.id}`, ...row });
      if (!row.ok) break;
    }
    if (rows.some((r) => !r.ok)) break;
  }
  if (v.pick && rows.length === 1 && rows[0].ok) pickSheet(ws, targets[0][0], targets[0][1], rows[0].id);
  emit(v, { command: "make-sheets", results: rows }, [
    `design sheets:`,
    ...paidLines(rows),
    rows.every((r) => r.ok) ? `look at them with: series.mjs check-sheets --${targets[0][0]} ${targets[0][1]}` : null,
  ]);
}

/** Picked, ready character sheets — the style references for a scene sheet. */
function castStyleRefs(bible, statusOf) {
  return bible.characters.map((c) => c.sheet).filter((sheet) => sheet && statusOf(sheet) === "ready");
}

function pickSheet(ws, kind, id, assetId) {
  const listName = { character: "characters", group: "groups", scene: "scenes" }[kind];
  updateBible(ws, (b) => {
    b[listName].find((e) => e.id === id).sheet = assetId;
  });
}

async function cmdCheckSheets(v) {
  const ws = workspace(v);
  const now = nowFrom(v);
  const { craft } = await craftModules();
  const bible = loadBible(ws);
  const kind = v.character ? "character" : v.group ? "group" : v.scene ? "scene" : null;
  if (!kind) fail("check-sheets needs --character <id>, --group <id> or --scene <id>");
  const id = v[kind];
  const entity = S.findEntity(bible, kind, id);
  if (!entity) fail(`no ${kind} "${id}" in bible.json`);
  const doc = await loadDoc(ws);
  const statusOf = statusLookup(doc, craft);
  const slot = sheetSlot(doc, S.entityKey(kind, id));
  const ready = slot.candidates.filter((c) => statusOf(c.asset) === "ready");
  if (!ready.length) fail(`${kind} "${id}" has no ready sheet candidate — series.mjs make-sheets --${kind} ${id}`);
  const files = ready.map((c) => assetFile(ws, doc, c.asset));
  const first = media.probe(files[0]);
  const tileH = 360;
  const tileW = Math.round((tileH * (first.width || 16)) / (first.height || 9) / 2) * 2;
  const compareId = nextId(doc, `${KIND_PREFIX[kind]}-${id}-compare-`);
  const uri = `refs/compare/${compareId}.jpg`;
  const font = media.findFont(v.font);
  const { labelled } = media.tileRow({ images: files, labels: ready.map((c, i) => `${i + 1} ${c.asset}`), out: ws.abs(uri), tileW, tileH, font });
  await registerLocal(ws, { id: compareId, type: "image", name: `${entity.name} sheet candidates`, op: "derive", uri, from: ready.map((c) => c.asset), params: { op: "compare-sheets", entity: S.entityKey(kind, id) } }, (d) => {
    sheetSlot(d, S.entityKey(kind, id)).compares.push(compareId);
  }, now);
  const lines = [
    `compare image: ${uri} (${ready.length} candidate(s), left to right${labelled ? ", numbered" : ""})`,
    `the bible says ${entity.name}: ${entity.look}`,
    ...ready.map((c, i) => `  ${i + 1}. ${c.asset} — ${c.check ? `${c.check.verdict}: ${c.check.note}` : "unverified"}`),
    `check: the turnaround agrees front/side/back, no extra or fused limbs, and it matches the written look. Record each verdict:`,
    `  series.mjs verdict --sheet <asset> --verdict ok|drift --note "…"`,
  ];
  emit(v, { command: "check-sheets", entity: S.entityKey(kind, id), compare: { id: compareId, uri }, look: entity.look, candidates: ready.map((c) => ({ asset: c.asset, uri: assetById(doc, c.asset).uri, check: c.check ?? null })) }, lines);
}

// ---------------------------------------------------------------------------
// lineup
// ---------------------------------------------------------------------------

/** The characters a lineup compares: `--character a,b` or every one with a picked, ready sheet. */
function lineupSheets(bible, statusOf, v) {
  const ids = v.character ? listFlag([v.character]) : bible.characters.filter((c) => c.sheet && statusOf(c.sheet) === "ready").map((c) => c.id);
  const out = ids.map((id) => {
    const c = S.findEntity(bible, "character", id);
    if (!c) fail(`no character "${id}" in bible.json`);
    if (!c.sheet || statusOf(c.sheet) !== "ready") fail(`character "${id}" has no picked, ready sheet — a lineup compares picked sheets`);
    return { id, name: c.name, look: c.look, sheet: c.sheet };
  });
  if (out.length < 2) fail("a lineup needs two or more characters with picked, ready sheets (--character a,b)");
  return out;
}

/**
 * Two or more picked sheets drawn side by side at one scale, as one image:
 * the cheap check (one image call) that identities and the size relation
 * hold when the sheets are used together, before a clip is paid for.
 */
async function cmdLineup(v) {
  const ws = workspace(v);
  const now = nowFrom(v);
  const { craft } = await craftModules();
  const bible = loadBible(ws);
  const doc = await loadDoc(ws);
  const statusOf = statusLookup(doc, craft);
  const cast = lineupSheets(bible, statusOf, v);
  const prompt = lineupPrompt(bible, cast);
  const sheets = cast.map((c) => c.sheet);
  const assetId = nextId(doc, "lineup-");
  const slot = { asset: assetId, characters: cast.map((c) => c.id), sheets };
  if (v.upload) {
    const uri = placeUpload(ws, v.upload, `refs/${assetId}${extOf(v.upload, ".png")}`);
    await registerLocal(ws, { id: assetId, type: "image", name: `lineup ${cast.map((c) => c.name).join(" · ")}`, op: "upload", uri, from: sheets, params: { slot: { command: "lineup" } } }, (d) => {
      sidecar(d).lineups.push(slot);
    }, now);
    emit(v, { command: "lineup", uploaded: assetId, uri, prompt }, [`registered ${uri} as ${assetId}`]);
    return;
  }
  const gen = await generators();
  const { model, why } = chosenImageModel(gen, v, sheets.length);
  const quality = v.quality ?? "high";
  const aspectRatio = imageAspect(v.aspect ?? "16:9");
  const files = sheets.map((id) => assetFile(ws, doc, id));
  const cost = imageCost(doc, model, quality);
  if (v["dry-run"]) {
    const body = gen.buildImageRequest({ prompt, model, numImages: 1, aspectRatio, quality, imageUrls: files });
    const inlined = (body.input_references ?? []).map((r, i) => ({ uri: r.image_url.url, name: ws.rel(files[i]) }));
    emit(v, { command: "lineup", dryRun: true, request: { provider: "openrouter", model, why, body: elide(body, inlined) }, cost }, ["dry run — nothing sent, nothing recorded", `${model} (${why}) · ${priced(cost)}`, JSON.stringify(elide(body, inlined), null, 2)]);
    return;
  }
  const apiKey = gen.imageKey();
  if (!apiKey) fail(noKey("OpenRouter", `series.mjs lineup --dry-run shows the prompt; draw it in Jimeng with the sheets selected, then series.mjs lineup --upload <file>`));
  note(`[series] lineup model: ${model} (${why})`);
  const row = await runPaid(ws, now, {
    reserve: {
      id: assetId, type: "image", name: `lineup ${cast.map((c) => c.name).join(" · ")}`, op: "generate", uri: `refs/${assetId}.png`, from: sheets,
      model, prompt, provider: "openrouter",
      params: { slot: { command: "lineup" }, request: { aspectRatio, quality } },
      ...(cost ? { cost } : {}),
    },
    call: async ({ signal }) => {
      const out = await gen.generateImage({ prompt, model, numImages: 1, aspectRatio, quality, imageUrls: files, apiKey, outputDir: join(ws.root, "refs"), filenamePrefix: assetId, signal });
      return { file: out.files[0], cost: reportedCost(out.usage) };
    },
    updateSidecar: (d, phase) => {
      if (phase !== "reserve") return;
      claimSlot(sidecar(d).lineups, assetId, slot);
    },
  });
  emit(v, { command: "lineup", result: row, characters: slot.characters }, [
    ...paidLines([row]),
    row.ok ? "open it: same material and roundness, every sheet's features, and the sizes the looks give (who is taller, wider). A wrong lineup is fixed in the sheets or the looks, before any clip." : null,
  ]);
}

// ---------------------------------------------------------------------------
// shoot-board / redo-panel
// ---------------------------------------------------------------------------

async function cmdShootBoard(v) {
  const ws = workspace(v);
  const now = nowFrom(v);
  const { craft } = await craftModules();
  const bible = loadBible(ws);
  const episode = loadEpisode(ws, v.episode, bible);
  requireTiming(episode);
  const doc = await loadDoc(ws);
  const statusOf = statusLookup(doc, craft);
  const warnings = [];
  const sheetOf = sheetResolver(bible, statusOf, warnings);
  const partIds = partsOf(episode, v, v.upload ? { single: true } : {});
  const plan = partIds.map((partId) => ({ partId, part: episode.parts.find((p) => p.id === partId), a: assemblePart(bible, episode, partId, { sheetOf }) }));
  for (const w of warnings) note(`WARN: ${w}`);
  for (const p of plan) if (p.a.textOnly.some((t) => t.kind === "character")) note(`WARN: part ${p.partId}: ${p.a.textOnly.filter((t) => t.kind === "character").map((t) => t.name).join(", ")} ha${p.a.textOnly.length > 1 ? "ve" : "s"} no picked sheet — drawn from text only`);
  const record = (p, asset) => ({ asset, basis: S.shotBasis(bible, episode), shots: S.boardShotHashes(p.part), refs: p.a.storyboard.refs });
  if (v.upload) {
    const p = plan[0];
    const assetId = nextId(doc, `${episode.id}-${p.partId.toLowerCase()}-board-`);
    const n = assetId.split("-").pop();
    const uri = placeUpload(ws, v.upload, `episodes/${episode.id}/boards/${p.partId.toLowerCase()}-${n}${extOf(v.upload, ".png")}`);
    const [landed] = await registerLocal(ws, { id: assetId, type: "image", name: `${episode.id} part ${p.partId} storyboard`, op: "upload", uri, from: p.a.storyboard.refs, params: { slot: { command: "shoot-board", episode: episode.id, part: p.partId } } }, (d) => {
      partSlots(d, episode.id, p.partId).boards.push(record(p, assetId));
    }, now);
    const aspectWarning = referenceAspectWarning(landed, uri, `Draw the storyboard again at the series ratio (${bible.ratio}) and upload that instead.`);
    if (aspectWarning) note(`WARN: ${aspectWarning}`);
    emit(v, { command: "shoot-board", uploaded: assetId, uri, warnings: aspectWarning ? [aspectWarning] : [] }, [`registered ${uri} as ${assetId} (${episode.id} part ${p.partId})`]);
    return;
  }
  const gen = await generators();
  const { model, why } = chosenImageModel(gen, v, Math.max(...plan.map((p) => p.a.storyboard.refs.length)));
  const quality = v.quality ?? "high";
  const aspectRatio = imageAspect(bible.ratio);
  const count = parseNumber(v.count, "--count", { integer: true, min: 1 }) ?? 1;
  note(`[series] storyboard model: ${model} (${why})`);
  if (v["dry-run"]) {
    const requests = plan.map((p) => {
      const files = p.a.storyboard.refs.map((id) => assetFile(ws, doc, id));
      const body = gen.buildImageRequest({ prompt: p.a.storyboard.prompt, model, numImages: 1, aspectRatio, quality, imageUrls: files });
      const inlined = (body.input_references ?? []).map((r, i) => ({ uri: r.image_url.url, name: ws.rel(files[i]) }));
      return { part: p.partId, count, provider: "openrouter", model, why, body: elide(body, inlined), cost: imageCost(doc, model, quality) ?? { usd: null, basis: null, note: "unpriced — OpenRouter reports the cost after the call" } };
    });
    emit(v, { command: "shoot-board", dryRun: true, requests }, ["dry run — nothing sent, nothing recorded", ...requests.map((r) => `part ${r.part} × ${count} · ${r.model} (${r.why}) · ${priced(r.cost)} each\n${JSON.stringify(r.body, null, 2)}`)]);
    return;
  }
  const apiKey = gen.imageKey();
  if (!apiKey) fail(noKey("OpenRouter", `series.mjs prompts --episode ${episode.id} --target jimeng, then series.mjs shoot-board --episode ${episode.id} --part <P> --upload <file>`));
  const rows = [];
  outer: for (const p of plan) {
    const files = p.a.storyboard.refs.map((id) => assetFile(ws, doc, id));
    for (let i = 0; i < count; i += 1) {
      const fresh = await loadDoc(ws);
      const assetId = nextId(fresh, `${episode.id}-${p.partId.toLowerCase()}-board-`);
      const prefix = `${p.partId.toLowerCase()}-${assetId.split("-").pop()}`;
      const row = await runPaid(ws, now, {
        reserve: {
          id: assetId, type: "image", name: `${episode.id} part ${p.partId} storyboard`, op: "generate",
          uri: `episodes/${episode.id}/boards/${prefix}.png`, from: p.a.storyboard.refs,
          model, prompt: p.a.storyboard.prompt, provider: "openrouter",
          params: { slot: { command: "shoot-board", episode: episode.id, part: p.partId }, request: { aspectRatio, quality } },
          ...(imageCost(fresh, model, quality) ? { cost: imageCost(fresh, model, quality) } : {}),
        },
        call: async ({ signal }) => {
          const out = await gen.generateImage({ prompt: p.a.storyboard.prompt, model, numImages: 1, aspectRatio, quality, imageUrls: files, apiKey, outputDir: join(ws.root, "episodes", episode.id, "boards"), filenamePrefix: prefix, signal });
          return { file: out.files[0], cost: reportedCost(out.usage) };
        },
        updateSidecar: (d, phase) => {
          if (phase !== "reserve") return;
          const slots = partSlots(d, episode.id, p.partId);
          claimSlot(slots.boards, assetId, record(p, assetId));
        },
      });
      rows.push({ part: p.partId, ...row });
      if (!row.ok) break outer;
    }
  }
  emit(v, { command: "shoot-board", episode: episode.id, results: rows }, [`${episode.id} storyboards:`, ...paidLines(rows)]);
}

/** Composite a landed panel into its base board; registers and records the new board. */
async function compositePanelInto(ws, now, { episode, partId, panelId, baseBoard, shot, bible }) {
  const { craft } = await craftModules();
  const doc = await loadDoc(ws);
  const base = assetById(doc, baseBoard);
  const boardFile = ws.abs(base.uri);
  const width = Number(base.metadata?.width) || media.probe(boardFile).width;
  const height = Number(base.metadata?.height) || media.probe(boardFile).height;
  const part = episode.parts.find((p) => p.id === partId);
  const { rows, cols } = S.gridOf(part.shots.length);
  const rect = cellRect(width, height, rows, cols, shot);
  const newId = nextId(doc, `${episode.id}-${partId.toLowerCase()}-board-`);
  const uri = `episodes/${episode.id}/boards/${partId.toLowerCase()}-${newId.split("-").pop()}.png`;
  media.compositePanel({ board: boardFile, panel: assetFile(ws, doc, panelId), rect, out: ws.abs(uri) });
  const baseRecord = partSlots(doc, episode.id, partId).boards.find((b) => b.asset === baseBoard);
  const shots = [...(baseRecord?.shots ?? S.boardShotHashes(part))];
  shots[shot - 1] = S.boardShotHash(part.shots[shot - 1]);
  await registerLocal(ws, { id: newId, type: "image", name: `${episode.id} part ${partId} storyboard (panel ${shot} redrawn)`, op: "composite", uri, from: [baseBoard, panelId], params: { op: "replace-panel", shot, rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h } } }, (d) => {
    const slots = partSlots(d, episode.id, partId);
    slots.boards.push({ asset: newId, basis: baseRecord?.basis ?? S.shotBasis(bible, episode), shots, refs: baseRecord?.refs ?? [], from: { board: baseBoard, panel: panelId, shot } });
    const panel = slots.panels.find((x) => x.asset === panelId);
    if (panel) panel.result = newId;
  }, now);
  // A redrawn panel of the PICKED board replaces that pick; with no pick the newest board is in effect anyway.
  const fresh = JSON.parse(readFileSync(episodePath(ws, episode.id), "utf-8"));
  if (fresh.picks?.storyboard?.[partId] === baseBoard) {
    updateEpisode(ws, episode.id, bible, (e) => {
      e.picks.storyboard[partId] = newId;
    });
  }
  void craft;
  return { id: newId, uri };
}

async function cmdRedoPanel(v) {
  const ws = workspace(v);
  const now = nowFrom(v);
  const { craft } = await craftModules();
  const bible = loadBible(ws);
  const episode = loadEpisode(ws, v.episode, bible);
  requireTiming(episode);
  const [partId] = partsOf(episode, v, { single: true });
  const part = episode.parts.find((p) => p.id === partId);
  const shot = parseNumber(v.shot, "--shot", { integer: true, min: 1 });
  if (!shot || shot > part.shots.length) fail(`--shot must be 1–${part.shots.length}`);
  const doc = await loadDoc(ws);
  const statusOf = statusLookup(doc, craft);
  const base = effectiveBoard(doc, statusOf, episode, partId).asset;
  if (!base) fail(`${episode.id} part ${partId} has no ready storyboard to redraw a panel of — series.mjs shoot-board first`);
  if (!media.hasTool("ffmpeg") || !media.hasTool("ffprobe")) fail("redo-panel composites the panel into the board with ffmpeg, which is not on PATH — nothing was sent");
  const warnings = [];
  // The board the panel goes back into rides along first, as its style
  // reference: line weight, framing scale and the way numbers are marked.
  const panel = assemblePanel(bible, episode, partId, shot, { sheetOf: sheetResolver(bible, statusOf, warnings), board: base });
  for (const w of warnings) note(`WARN: ${w}`);
  note(`[series] panel ${shot}: ${base} goes along as image 1, the style reference; the sheets follow`);
  const aspectRatio = panel.aspectRatio;
  const panelId = nextId(doc, `${episode.id}-${partId.toLowerCase()}-panel-${shot}-`);
  const prefix = `${partId.toLowerCase()}-${shot}-${panelId.split("-").pop()}`;
  const record = { shot, asset: panelId, board: base, result: null };
  let row;
  if (v.upload) {
    const uri = placeUpload(ws, v.upload, `episodes/${episode.id}/panels/${prefix}${extOf(v.upload, ".png")}`);
    await registerLocal(ws, { id: panelId, type: "image", name: `${episode.id} part ${partId} panel ${shot}`, op: "upload", uri, from: panel.refs, params: { slot: { command: "redo-panel", episode: episode.id, part: partId, shot } } }, (d) => {
      partSlots(d, episode.id, partId).panels.push(record);
    }, now);
    row = { id: panelId, ok: true, status: "ready", uri, cost: null };
  } else {
    const gen = await generators();
    const { model, why } = chosenImageModel(gen, v, panel.refs.length);
    const quality = v.quality ?? "high";
    const files = panel.refs.map((id) => assetFile(ws, doc, id));
    note(`[series] panel model: ${model} (${why})`);
    if (v["dry-run"]) {
      const body = gen.buildImageRequest({ prompt: panel.prompt, model, numImages: 1, aspectRatio, quality, imageUrls: files });
      const inlined = (body.input_references ?? []).map((r, i) => ({ uri: r.image_url.url, name: ws.rel(files[i]) }));
      const cost = imageCost(doc, model, quality);
      emit(v, { command: "redo-panel", dryRun: true, request: { provider: "openrouter", model, why, body: elide(body, inlined) }, cost, composite: { board: base, shot } }, ["dry run — nothing sent, nothing recorded", `${model} (${why}) · ${priced(cost)}`, JSON.stringify(elide(body, inlined), null, 2), `then composited into ${base} at panel ${shot}`]);
      return;
    }
    const apiKey = gen.imageKey();
    if (!apiKey) fail(noKey("OpenRouter", `series.mjs prompts --episode ${episode.id} --part ${partId} --shot ${shot} --target jimeng prints the panel prompt with its canvas line (the board node first, then the sheets); draw it in Jimeng, then series.mjs redo-panel --episode ${episode.id} --part ${partId} --shot ${shot} --upload <file>`));
    row = await runPaid(ws, now, {
      reserve: {
        id: panelId, type: "image", name: `${episode.id} part ${partId} panel ${shot}`, op: "generate",
        uri: `episodes/${episode.id}/panels/${prefix}.png`, from: panel.refs, model, prompt: panel.prompt, provider: "openrouter",
        params: { slot: { command: "redo-panel", episode: episode.id, part: partId, shot }, request: { aspectRatio, quality } },
        ...(imageCost(doc, model, quality) ? { cost: imageCost(doc, model, quality) } : {}),
      },
      call: async ({ signal }) => {
        const out = await gen.generateImage({ prompt: panel.prompt, model, numImages: 1, aspectRatio, quality, imageUrls: files, apiKey, outputDir: join(ws.root, "episodes", episode.id, "panels"), filenamePrefix: prefix, signal });
        return { file: out.files[0], cost: reportedCost(out.usage) };
      },
      updateSidecar: (d, phase) => {
        if (phase !== "reserve") return;
        const slots = partSlots(d, episode.id, partId);
        claimSlot(slots.panels, panelId, record);
      },
    });
  }
  let board = null;
  if (row.ok) board = await compositePanelInto(ws, now, { episode, partId, panelId, baseBoard: base, shot, bible });
  emit(v, { command: "redo-panel", episode: episode.id, part: partId, shot, panel: row, board }, [
    ...paidLines([row]),
    board ? `composited into ${board.id} → ${board.uri} (from ${base})` : null,
    // The copy-paste route: the clip is made on the canvas from the board
    // node the user selects, and the canvas still holds the old one.
    board && v.upload ? `on the Jimeng canvas: drag ${board.uri} in as a node and select it for the clip, not the old storyboard` : null,
  ]);
}

// ---------------------------------------------------------------------------
// shoot-video / patch-range
// ---------------------------------------------------------------------------

function videoRefs(ws, doc, refs) {
  return refs.map((r) => ({ ...r, file: assetFile(ws, doc, r.asset) }));
}

function requireCastSheets(assembled) {
  const missing = assembled.textOnly.filter((t) => t.kind === "character");
  if (missing.length) {
    fail(`${missing.map((m) => m.name).join(", ")} ha${missing.length > 1 ? "ve" : "s"} no picked, ready design sheet — a clip needs every cast member's sheet as its identity reference. series.mjs make-sheets --character <id>, then series.mjs pick --character <id> --sheet <asset>`);
  }
}

function seedanceOptions(v, bible, gen) {
  const resolution = v.resolution ?? "480p";
  if (!gen.seedanceAspects.includes(bible.ratio)) fail(`Seedance 2.5 does not render ${bible.ratio}; use one of ${gen.seedanceAspects.join(", ")} in bible.json ratio`);
  const seed = v.seed === undefined ? undefined : parseNumber(v.seed, "--seed", { integer: true });
  return { resolution, aspectRatio: bible.ratio, audio: !v["no-audio"], seed, deadlineMs: (parseNumber(v["deadline-s"], "--deadline-s", { min: 60 }) ?? 1800) * 1000 };
}

async function cmdShootVideo(v) {
  const ws = workspace(v);
  const now = nowFrom(v);
  const { craft } = await craftModules();
  const bible = loadBible(ws);
  const episode = loadEpisode(ws, v.episode, bible);
  requireTiming(episode);
  const doc = await loadDoc(ws);
  const statusOf = statusLookup(doc, craft);
  const warnings = [];
  const sheetOf = sheetResolver(bible, statusOf, warnings);
  const partIds = partsOf(episode, v, v.upload ? { single: true } : {});
  const plan = partIds.map((partId) => {
    const board = effectiveBoard(doc, statusOf, episode, partId).asset;
    if (!board) fail(`${episode.id} part ${partId} has no ready storyboard — series.mjs shoot-board --episode ${episode.id} --part ${partId}`);
    const a = assemblePart(bible, episode, partId, { sheetOf, board, limit: SEEDANCE_MAX_REFS });
    if (!v.upload) requireCastSheets(a);
    return { partId, part: episode.parts.find((p) => p.id === partId), board, a };
  });
  for (const w of warnings) note(`WARN: ${w}`);
  const record = (p, asset, extra) => ({
    asset, board: p.board, refs: p.a.refs.map((r) => r.asset), basis: S.shotBasis(bible, episode),
    shots: S.clipShotHashes(p.part), durs: p.part.shots.map((s) => s.dur), setup: S.setupHash(episode), ...extra,
  });
  if (v.upload) {
    const p = plan[0];
    const assetId = nextId(doc, `${episode.id}-${p.partId.toLowerCase()}-take-`);
    const uri = placeUpload(ws, v.upload, `episodes/${episode.id}/takes/${p.partId.toLowerCase()}-${assetId.split("-").pop()}${extOf(v.upload, ".mp4")}`);
    await registerLocal(ws, { id: assetId, type: "video", name: `${episode.id} part ${p.partId} take`, op: "upload", uri, from: p.a.refs.map((r) => r.asset).filter(Boolean), params: { slot: { command: "shoot-video", episode: episode.id, part: p.partId } } }, (d) => {
      partSlots(d, episode.id, p.partId).takes.push(record(p, assetId, { resolution: "uploaded", seconds: p.a.seconds }));
    }, now);
    emit(v, { command: "shoot-video", uploaded: assetId, uri }, [`registered ${uri} as ${assetId} (${episode.id} part ${p.partId}); next: series.mjs review-episode --episode ${episode.id}`]);
    return;
  }
  const gen = await generators();
  const opts = seedanceOptions(v, bible, gen);
  if (v["dry-run"]) {
    const requests = plan.map((p) => {
      const refs = videoRefs(ws, doc, p.a.refs);
      const req = gen.buildSeedanceRequest({ prompt: p.a.video.prompt, endpoint: "reference", refImages: refs.map((r) => r.file), duration: String(p.a.seconds), resolution: opts.resolution, aspectRatio: opts.aspectRatio, audio: opts.audio, seed: opts.seed });
      const inlined = (req.body.image_urls ?? []).map((uri, i) => ({ uri, name: `@Image${refs[i].n} ${ws.rel(refs[i].file)}` }));
      // The queue endpoint is where the request actually goes (fal-queue.mjs).
      return { part: p.partId, provider: "fal", url: gen.toQueueUrl(req.url), body: elide(req.body, inlined), cost: videoEstimate(gen, { resolution: opts.resolution, ratio: bible.ratio, seconds: p.a.seconds }) };
    });
    emit(v, { command: "shoot-video", dryRun: true, requests }, ["dry run — nothing sent, nothing recorded", ...requests.map((r) => `part ${r.part}: POST ${r.url} (queued, then polled)\n${JSON.stringify(r.body, null, 2)}\ncost ≈ ${money(r.cost.usd)} (${r.cost.note})`)]);
    return;
  }
  const apiKey = gen.falKey();
  if (!apiKey) fail(noKey("fal", `series.mjs prompts --episode ${episode.id} --target jimeng, render in Jimeng, then series.mjs shoot-video --episode ${episode.id} --part <P> --upload <file>`));
  const rows = [];
  for (const p of plan) {
    const fresh = await loadDoc(ws);
    const assetId = nextId(fresh, `${episode.id}-${p.partId.toLowerCase()}-take-`);
    const uri = `episodes/${episode.id}/takes/${p.partId.toLowerCase()}-${assetId.split("-").pop()}.mp4`;
    const refs = videoRefs(ws, fresh, p.a.refs);
    const estimate = videoEstimate(gen, { resolution: opts.resolution, ratio: bible.ratio, seconds: p.a.seconds });
    note(`[series] ${assetId}: ${p.a.seconds} s at ${opts.resolution}, ${refs.length} reference image(s), ≈ ${money(estimate.usd)} (estimate) — recording before sending`);
    const row = await runPaid(ws, now, {
      reserve: {
        id: assetId, type: "video", name: `${episode.id} part ${p.partId} take`, op: "generate", uri,
        from: refs.map((r) => r.asset), model: gen.seedanceModel, prompt: p.a.video.prompt, provider: "fal",
        params: { slot: { command: "shoot-video", episode: episode.id, part: p.partId }, request: { endpoint: "reference", duration: p.a.seconds, resolution: opts.resolution, aspectRatio: opts.aspectRatio, audio: opts.audio, ...(opts.seed !== undefined ? { seed: opts.seed } : {}) }, bibleVersion: S.bibleVersion(bible) },
        cost: estimate,
      },
      call: async ({ signal }) => {
        const result = await gen.generateSeedanceVideo({ prompt: p.a.video.prompt, output: ws.abs(uri), apiKey, endpoint: "reference", refImages: refs.map((r) => r.file), duration: String(p.a.seconds), resolution: opts.resolution, aspectRatio: opts.aspectRatio, audio: opts.audio, seed: opts.seed, signal, deadlineMs: opts.deadlineMs });
        return { file: result.path, requestId: result.request_id, cost: deliveredVideoCost(result) };
      },
      updateSidecar: (d, phase) => {
        if (phase !== "reserve") return;
        const slots = partSlots(d, episode.id, p.partId);
        claimSlot(slots.takes, assetId, record(p, assetId, { resolution: opts.resolution, seconds: p.a.seconds }));
      },
    });
    rows.push({ part: p.partId, ...row });
    if (!row.ok) break;
  }
  emit(v, { command: "shoot-video", episode: episode.id, results: rows }, [
    `${episode.id} takes:`,
    ...paidLines(rows),
    rows.every((r) => r.ok) ? `next: series.mjs review-episode --episode ${episode.id}` : null,
  ]);
}

async function cmdPatchRange(v) {
  const ws = workspace(v);
  const now = nowFrom(v);
  const { craft } = await craftModules();
  const bible = loadBible(ws);
  const episode = loadEpisode(ws, v.episode, bible);
  requireTiming(episode);
  const [partId] = partsOf(episode, v, { single: true });
  const part = episode.parts.find((p) => p.id === partId);
  const [a, b] = parseRange(v.shots);
  const doc = await loadDoc(ws);
  const statusOf = statusLookup(doc, craft);
  const take = v.take ?? effectiveTake(doc, statusOf, episode, partId).asset;
  if (!take || statusOf(take) !== "ready") fail(`${episode.id} part ${partId} has no ready take to patch — series.mjs shoot-video first`);
  const board = effectiveBoard(doc, statusOf, episode, partId).asset;
  if (!board) fail(`${episode.id} part ${partId} has no ready storyboard`);
  const warnings = [];
  const patch = assemblePatch(bible, episode, partId, a, b, { sheetOf: sheetResolver(bible, statusOf, warnings), board, limit: SEEDANCE_MAX_REFS });
  for (const w of [...warnings, ...patch.warnings]) note(`WARN: ${w}`);
  const plan = patch.plan;
  // What is cut out is measured on the TAKE's clock (the durations it was
  // shot with); what goes in is a–b as the shot list stands now. They differ
  // after a duration drag, and the cut then runs longer or shorter — said, not hidden.
  const takeLine = takeTimeline(doc, episode, partId, take);
  if (takeLine.length !== part.shots.length) fail(`${take} was shot with ${takeLine.length} shots and the part now has ${part.shots.length} — re-shoot the part instead of patching it`);
  const span = [takeLine[a - 1].start, takeLine[b - 1].end];
  const ends = spliceEndCheck(ws, doc, statusOf, episode, partId, take, span, [a, b]);
  for (const w of ends.warnings) note(`WARN: ${w}`);
  const length = Math.round((plan.span[1] - plan.span[0]) * 10) / 10;
  const delta = Math.round((length - (span[1] - span[0])) * 10) / 10;
  if (delta !== 0) note(`WARN: in ${take} shots ${a}–${b} last ${S.fmtSeconds(span[1] - span[0])} s; the shot list now gives them ${S.fmtSeconds(length)} s — the patched cut runs ${S.fmtSeconds(Math.abs(delta))} s ${delta > 0 ? "longer" : "shorter"}`);
  const assetId = nextId(doc, `${episode.id}-${partId.toLowerCase()}-patch-${a}-${b}-`);
  const uri = `episodes/${episode.id}/patches/${partId.toLowerCase()}-${a}-${b}-${assetId.split("-").pop()}.mp4`;
  const record = { asset: assetId, take, shots: plan.shots, covered: plan.covered, durs: part.shots.slice(plan.covered[0] - 1, plan.covered[1]).map((s) => s.dur), span, offset: plan.offset, length, seconds: plan.seconds, requestSeconds: plan.requestSeconds, board, refs: patch.refs.map((r) => r.asset), basis: S.shotBasis(bible, episode), shotHashes: S.clipShotHashes(part) };
  let row;
  if (v.upload) {
    const placed = placeUpload(ws, v.upload, uri.replace(/\.mp4$/, extOf(v.upload, ".mp4")));
    await registerLocal(ws, { id: assetId, type: "video", name: `${episode.id} part ${partId} patch ${a}–${b}`, op: "upload", uri: placed, from: [take], params: { slot: { command: "patch-range", episode: episode.id, part: partId, shots: [a, b] } } }, (d) => {
      partSlots(d, episode.id, partId).patches.push(record);
    }, now);
    row = { id: assetId, ok: true, status: "ready", uri: placed, cost: null };
  } else {
    requireCastSheets({ textOnly: refsTextOnly(patch, episode, bible) });
    const gen = await generators();
    const opts = seedanceOptions(v, bible, gen);
    const refs = videoRefs(ws, doc, patch.refs);
    const estimate = videoEstimate(gen, { resolution: opts.resolution, ratio: bible.ratio, seconds: plan.requestSeconds });
    if (v["dry-run"]) {
      const req = gen.buildSeedanceRequest({ prompt: patch.video.prompt, endpoint: "reference", refImages: refs.map((r) => r.file), duration: String(plan.requestSeconds), resolution: opts.resolution, aspectRatio: opts.aspectRatio, audio: opts.audio, seed: opts.seed });
      const inlined = (req.body.image_urls ?? []).map((u, i) => ({ uri: u, name: `@Image${refs[i].n} ${ws.rel(refs[i].file)}` }));
      emit(v, { command: "patch-range", dryRun: true, plan, span, length, uncutEnds: ends.uncut, request: { provider: "fal", url: gen.toQueueUrl(req.url), body: elide(req.body, inlined) }, cost: estimate }, ["dry run — nothing sent, nothing recorded", `replaces ${S.fmtSeconds(span[0])}–${S.fmtSeconds(span[1])} s of ${take}`, `POST ${gen.toQueueUrl(req.url)} (queued, then polled)`, JSON.stringify(elide(req.body, inlined), null, 2), `cost ≈ ${money(estimate.usd)} (${estimate.note})`, `the Jimeng form of this prompt: series.mjs prompts --episode ${episode.id} --part ${partId} --shots ${a}-${b} --target jimeng`]);
      return;
    }
    const apiKey = gen.falKey();
    if (!apiKey) fail(noKey("fal", `series.mjs prompts --episode ${episode.id} --part ${partId} --shots ${a}-${b} --target jimeng prints the prompt; render it in Jimeng, then series.mjs patch-range --episode ${episode.id} --part ${partId} --shots ${a}-${b} --upload <file>`));
    row = await runPaid(ws, now, {
      reserve: {
        id: assetId, type: "video", name: `${episode.id} part ${partId} patch ${a}–${b}`, op: "generate", uri,
        from: refs.map((r) => r.asset), model: gen.seedanceModel, prompt: patch.video.prompt, provider: "fal",
        params: { slot: { command: "patch-range", episode: episode.id, part: partId, shots: [a, b] }, request: { endpoint: "reference", duration: plan.requestSeconds, resolution: opts.resolution, aspectRatio: opts.aspectRatio, audio: opts.audio, ...(opts.seed !== undefined ? { seed: opts.seed } : {}) }, bibleVersion: S.bibleVersion(bible), patches: take },
        cost: estimate,
      },
      call: async ({ signal }) => {
        const result = await gen.generateSeedanceVideo({ prompt: patch.video.prompt, output: ws.abs(uri), apiKey, endpoint: "reference", refImages: refs.map((r) => r.file), duration: String(plan.requestSeconds), resolution: opts.resolution, aspectRatio: opts.aspectRatio, audio: opts.audio, seed: opts.seed, signal, deadlineMs: opts.deadlineMs });
        return { file: result.path, requestId: result.request_id, cost: deliveredVideoCost(result) };
      },
      updateSidecar: (d, phase) => {
        if (phase !== "reserve") return;
        const slots = partSlots(d, episode.id, partId);
        claimSlot(slots.patches, assetId, record);
      },
    });
  }
  let final = null;
  if (row.ok) final = await maybeFinal(ws, now, v);
  emit(v, { command: "patch-range", episode: episode.id, part: partId, plan, span, length, uncutEnds: ends.uncut, patch: row, final }, [
    ...paidLines([row]),
    row.ok ? `splices into ${take} at ${S.fmtSeconds(span[0])}–${S.fmtSeconds(span[1])} s${plan.extended ? ` (the patch covers shots ${plan.covered[0]}–${plan.covered[1]}; only ${a}–${b} is used)` : ""}` : null,
    final?.id ? `${final.unchanged ? "final unchanged" : "new final"}: ${final.id} → ${final.uri}` : final?.skipped ? `final not rebuilt: ${final.skipped}` : null,
    final?.stage ? stageLine(episode.id, final.stage) : null,
  ]);
}

/** Shot boundaries of a take on its own clock: the durations it was shot with. */
function takeTimeline(doc, episode, partId, take) {
  const part = episode.parts.find((p) => p.id === partId);
  const takeRecord = partSlots(doc, episode.id, partId).takes.find((t) => t.asset === take);
  return S.shotTimeline((takeRecord?.durs ?? part.shots.map((s) => s.dur)).map((dur) => ({ dur })));
}

/**
 * Where a clip cuts, on its own clock: the cuts its latest ready contact
 * sheet recorded, else detected now with ffmpeg. Throws when neither works.
 */
function clipCuts(ws, doc, statusOf, slots, assetId) {
  const reviewed = [...slots.reviews].reverse().find((r) => r.take === assetId && statusOf(r.asset) === "ready" && Array.isArray(r.cuts));
  if (reviewed) return reviewed.cuts;
  return media.sceneCuts(assetFile(ws, doc, assetId));
}

/**
 * The ends of shots a–b (`span`, on the take's clock) with no cut in the
 * take within SNAP_S, and a warning for each, before a patch is made. A
 * splice is clean only where the take already cuts: `final` snaps each
 * splice point to a cut within SNAP_S and otherwise splices at the planned
 * second, which inside one continuous shot (a tracking shot, merged panels)
 * shows as a jump. A take whose cuts cannot be read is said, not passed over.
 */
function spliceEndCheck(ws, doc, statusOf, episode, partId, take, span, [a, b]) {
  let cuts;
  try {
    cuts = clipCuts(ws, doc, statusOf, partSlots(doc, episode.id, partId), take);
  } catch (error) {
    return { uncut: null, warnings: [`could not read where ${take} cuts (${errorMessage(error).split("\n")[0]}) — before splicing, check with review-episode that shots ${a}–${b} start and end on a cut`] };
  }
  const length = Number(assetById(doc, take)?.metadata?.duration) || null;
  const uncut = S.uncutSpliceEnds(span, cuts, length);
  return {
    uncut,
    warnings: uncut.map((t) => `${take} has no cut within ${S.SNAP_S} s of ${S.fmtSeconds(t)} s, where shots ${a}–${b} ${t === span[0] ? "start" : "end"}: the splice would fall inside one continuous shot and show as a jump — widen the span to the nearest cut (review-episode lists the cuts) or re-shoot the part`),
  };
}

function refsTextOnly(patch, episode, bible) {
  const drawn = new Set(patch.refs.filter((r) => r.kind === "character").map((r) => r.id));
  return episode.cast.filter((id) => !drawn.has(id)).map((id) => ({ kind: "character", id, name: S.findEntity(bible, "character", id)?.name ?? id }));
}

/**
 * Rebuild the final after a patch lands. The patch is already recorded; a
 * final that cannot be built now is reported (and rebuilt later with
 * `final`), never allowed to turn the landed patch into a failed command.
 */
async function maybeFinal(ws, now, v) {
  if (!media.hasTool("ffmpeg") || !media.hasTool("ffprobe")) return { skipped: "ffmpeg is not on PATH" };
  try {
    return await buildFinal(ws, now, v);
  } catch (error) {
    note(`WARN: the final was not rebuilt: ${errorMessage(error)}`);
    return { skipped: errorMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// review-episode / verdict
// ---------------------------------------------------------------------------

/** Cast members and groups of an episode, with their picked, ready sheet (or null). */
function episodeEntities(bible, episode, statusOf) {
  const one = (kind, id) => {
    const entity = S.findEntity(bible, kind, id);
    const sheet = entity?.sheet && statusOf(entity.sheet) === "ready" ? entity.sheet : null;
    return { kind, id, key: S.cellKey(kind, id), name: entity?.name ?? id, entity, sheet };
  };
  return [...episode.cast.map((id) => one("character", id)), ...(episode.groups ?? []).map((id) => one("group", id))];
}

/**
 * The clip a review or a verdict is about: `--take <asset>` when given (a
 * take of the part, or one of its patches), else the take in effect.
 */
function clipOf(doc, statusOf, episode, partId, asked) {
  const slots = partSlots(doc, episode.id, partId);
  const id = asked ?? effectiveTake(doc, statusOf, episode, partId).asset;
  if (!id) return null;
  const patch = slots.patches.find((p) => p.asset === id) ?? null;
  const take = slots.takes.find((t) => t.asset === id) ?? null;
  if (!patch && !take) fail(`'${id}' is not a take or a patch of ${episode.id} part ${partId}`);
  return { id, patch, take };
}

/**
 * The shots a clip shows, on its own clock: a take, all of them with the
 * durations it was shot with; a patch, the shots it splices back (the
 * neighbours it borrowed to reach 4 s are rendered but never shown).
 */
function clipShots(part, clip) {
  if (clip.patch) {
    const [lo, hi] = clip.patch.covered;
    const durs = clip.patch.durs ?? part.shots.slice(lo - 1, hi).map((x) => x.dur);
    return S.shotTimeline(durs.map((dur) => ({ dur }))).map((e, i) => ({ ...e, shot: lo + i }))
      .filter((e) => e.shot >= clip.patch.shots[0] && e.shot <= clip.patch.shots[1]);
  }
  return S.shotTimeline((clip.take?.durs ?? part.shots.map((x) => x.dur)).map((dur) => ({ dur })));
}

/**
 * `count` seconds evenly inside one shot's span (the middle of each of
 * `count` equal slices), to the hundredth, never past the clip's last frame.
 * No frame straddles a cut. review-episode and frames sample the same way,
 * so `frames --count 3` shows the contact strip's seconds at full size.
 */
function sampleTimes(entry, count, length) {
  return Array.from({ length: count }, (_, i) => Math.min(length - 0.05, Math.round((entry.start + (entry.dur * (i + 0.5)) / count) * 100) / 100));
}

async function cmdReviewEpisode(v) {
  const ws = workspace(v);
  const now = nowFrom(v);
  const { craft } = await craftModules();
  const bible = loadBible(ws);
  const episode = loadEpisode(ws, v.episode, bible);
  const doc = await loadDoc(ws);
  const statusOf = statusLookup(doc, craft);
  const frames = parseNumber(v.frames, "--frames", { integer: true, min: 1 }) ?? 3;
  const font = media.findFont(v.font);
  const out = [];
  const lines = [];
  const who = episodeEntities(bible, episode, statusOf);
  const withSheet = who.filter((w) => w.sheet);
  for (const partId of partsOf(episode, v, v.take ? { single: true } : {})) {
    const part = episode.parts.find((p) => p.id === partId);
    const clip = clipOf(doc, statusOf, episode, partId, v.take);
    if (!clip || statusOf(clip.id) !== "ready") fail(`${episode.id} part ${partId} has no ready take to review`);
    const timeline = clipShots(part, clip);
    const file = assetFile(ws, doc, clip.id);
    const info = media.probe(file);
    if (!info.width || !info.duration) fail(`cannot read ${file}`);
    const reviewId = nextId(doc, `${episode.id}-${partId.toLowerCase()}-review-`);
    const dir = `episodes/${episode.id}/review/${partId.toLowerCase()}-${reviewId.split("-").pop()}`;
    const work = mkdtempSync(join(tmpdir(), "anime-series-review-"));
    // One row per shot, its frames taken inside the shot's span on the clip's
    // own clock, where upstream's review_clip.py takes a frame every 0.5 s in
    // rows of eight: a row is then exactly one shot's verdict cells, and no
    // frame straddles a cut. The cost is density — at the default 3 frames,
    // about one a second — so fast action wants --frames 5 or more.
    // Frames large enough to judge a face; the sheets once, larger, on top of
    // the overview (the viewer shows the sheet beside each shot's frames).
    const tileH = 240;
    const tileW = Math.round((tileH * info.width) / info.height / 2) * 2;
    const strips = [];
    let sheetsRow = null;
    try {
      if (withSheet.length) {
        sheetsRow = `${dir}/sheets.jpg`;
        media.tileRow({ images: withSheet.map((w) => assetFile(ws, doc, w.sheet)), labels: withSheet.map((w) => w.name), out: ws.abs(sheetsRow), tileW: 640, tileH: 360, font });
      }
      for (const entry of timeline) {
        const times = sampleTimes(entry, frames, info.duration);
        const framePaths = times.map((t, i) => media.sampleFrame(file, t, join(work, `s${entry.shot}-${i}.png`), tileH));
        const uri = `${dir}/shot-${String(entry.shot).padStart(2, "0")}.jpg`;
        media.tileRow({ images: framePaths, labels: times.map((t) => `shot ${entry.shot} · ${t.toFixed(1)}s`), out: ws.abs(uri), tileW, tileH, font });
        strips.push({ shot: entry.shot, uri, times, id: `${reviewId}-shot-${entry.shot}` });
      }
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
    const overview = `${dir}/overview.jpg`;
    media.stackRows([...(sheetsRow ? [ws.abs(sheetsRow)] : []), ...strips.map((x) => ws.abs(x.uri))], ws.abs(overview));
    let cuts = [];
    try {
      cuts = media.sceneCuts(file);
    } catch (error) {
      note(`WARN: scene-cut detection failed (${errorMessage(error)}) — cuts left empty`);
    }
    const inputs = [clip.id, ...withSheet.map((w) => w.sheet)];
    const sheetsId = sheetsRow ? `${reviewId}-sheets` : null;
    await registerLocal(ws, [
      { id: reviewId, type: "image", name: `${episode.id} part ${partId} contact sheet`, op: "derive", uri: overview, from: inputs, params: { op: "contact-sheet", frames, take: clip.id } },
      ...(sheetsRow ? [{ id: sheetsId, type: "image", name: `${episode.id} sheets for review`, op: "derive", uri: sheetsRow, from: withSheet.map((w) => w.sheet), params: { op: "review-sheets" } }] : []),
      ...strips.map((x) => ({ id: x.id, type: "image", name: `${episode.id} part ${partId} shot ${x.shot} frames`, op: "derive", uri: x.uri, from: [clip.id], params: { op: "contact-strip", shot: x.shot, times: x.times, take: clip.id } })),
    ], (d) => {
      partSlots(d, episode.id, partId).reviews.push({ asset: reviewId, take: clip.id, sheets: sheetsId, strips: strips.map((x) => ({ shot: x.shot, asset: x.id, times: x.times })), cuts });
    }, now);
    const boundaries = timeline.slice(1).map((t) => t.start);
    const expect = timeline.map((entry) => ({
      shot: entry.shot,
      named: who.filter((w) => S.expectedIn(part.shots[entry.shot - 1], w.entity ?? { id: w.id })).map((w) => w.key),
    }));
    out.push({ part: partId, take: clip.id, patch: Boolean(clip.patch), review: reviewId, overview, sheets: withSheet.map((w) => w.sheet), sheetsRow, strips: strips.map((x) => ({ shot: x.shot, asset: x.id, uri: x.uri, times: x.times })), cuts, expectedCuts: boundaries, expect, duration: info.duration, size: `${info.width}×${info.height}`, audio: info.audio });
    const nameOf = (key) => who.find((w) => w.key === key)?.name ?? key;
    lines.push(
      `${episode.id} part ${partId} · ${clip.patch ? `patch ${clip.id} (shots ${clip.patch.shots.join("–")})` : clip.id} · ${info.duration.toFixed(1)} s · ${info.width}×${info.height} · ${info.audio ? "with" : "NO"} audio`,
      `  contact sheet: ${overview} (${withSheet.length ? `${withSheet.map((w) => w.name).join(", ")} sheet(s) on top, then ` : ""}one row of ${frames} frames per shot)`,
      `  scene cuts at ${cuts.map((c) => c.toFixed(1)).join(", ") || "none"} — ${timeline.length} shot(s) here (boundaries at ${boundaries.map(S.fmtSeconds).join(", ") || "none"}); far fewer cuts means shots were merged or skipped`,
      ...expect.map((e) => `  shot ${e.shot}: the words name ${e.named.length ? e.named.map(nameOf).join(", ") : "nobody by name"} — judge ${who.map((w) => w.name).join(", ")}`),
    );
  }
  lines.push("record every shot × cast member and group: series.mjs verdict --episode <id> --shot <n|a-b> --character <id>[,…] | --group <id> --verdict ok|drift|absent --note \"…\" (absent: not in the frames; where the words name them, a lost beat. Unjudged stays unverified, and the episode is not done until none is)");
  emit(v, { command: "review-episode", episode: episode.id, reviews: out }, lines);
}

/** Most frames one `frames` run takes: a 2 s shot at 24 is every other frame of a 24 fps take. */
const FRAMES_MAX = 24;

/**
 * `--crop x,y,w,h` as fractions of the frame (0–1), or null. Fractions, not
 * pixels: they read off a picture of any size and hold for 480p and 720p.
 */
function parseCrop(value) {
  if (value === undefined) return null;
  const parts = String(value).split(",").map((s) => s.trim());
  const nums = parts.map(Number);
  if (parts.length !== 4 || parts.some((s) => s === "") || nums.some((n) => !Number.isFinite(n))) fail(`--crop must be four fractions of the frame, x,y,w,h — e.g. 0,0.4,0.4,0.6 is the left 40 % from 40 % down (got: ${value})`);
  const [x, y, w, h] = nums;
  if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1.0001 || y + h > 1.0001) fail(`--crop ${value}: x and y start at 0 or more, w and h are above 0, and the box stays inside the frame (x + w ≤ 1, y + h ≤ 1)`);
  return { x, y, w, h };
}

/** Furthest a close-up is enlarged: past this a crop is only blur. */
const CLOSEUP_MAX_SCALE = 4;

/**
 * A fractional box in even pixels of a `width` × `height` frame (even, so
 * 4:2:0 chroma crops exactly), and the size it is enlarged to: as large as
 * fits in the frame's own size, at most CLOSEUP_MAX_SCALE, never shrunk.
 */
function cropPixels(box, width, height) {
  const even = (n) => Math.round(n / 2) * 2;
  const w = Math.max(2, Math.min(even(box.w * width), width - (width % 2)));
  const h = Math.max(2, Math.min(even(box.h * height), height - (height % 2)));
  const x = Math.max(0, Math.min(even(box.x * width), width - w));
  const y = Math.max(0, Math.min(even(box.y * height), height - h));
  const scale = Math.max(1, Math.min(CLOSEUP_MAX_SCALE, width / w, height / h));
  return { crop: { x, y, w, h }, size: { w: Math.max(2, even(w * scale)), h: Math.max(2, even(h * scale)) }, scale };
}

/**
 * More frames of one shot, at the clip's own size, or a closer look at part
 * of them — for when the contact strip is not enough to judge. The frames
 * come from the clip the shot is judged on (the patch spliced over it, else
 * the take in effect; `--take` names another), inside the shot's span on
 * that clip's clock. They land under episodes/<id>/review/ and are recorded
 * as free derive assets: the chat and the viewer can show them, and nothing
 * the verdicts or the splices read (the contact sheets) changes.
 */
async function cmdFrames(v) {
  const ws = workspace(v);
  const now = nowFrom(v);
  const { craft } = await craftModules();
  const bible = loadBible(ws);
  const episode = loadEpisode(ws, v.episode, bible);
  const [partId] = partsOf(episode, v, { single: true });
  const part = episode.parts.find((p) => p.id === partId);
  if (v.shot === undefined) fail("frames needs --shot <n>: the frames come from inside one shot");
  const shot = parseNumber(v.shot, "--shot", { integer: true, min: 1 });
  if (shot > part.shots.length) fail(`--shot must be within 1–${part.shots.length}`);
  if (v.count !== undefined && v.seconds !== undefined) fail("--count and --seconds do not go together: --count spreads frames over the shot, --seconds names them");
  const count = parseNumber(v.count, "--count", { integer: true, min: 1 }) ?? 6;
  if (count > FRAMES_MAX) fail(`--count is at most ${FRAMES_MAX} (got: ${count})`);
  const asked = v.seconds === undefined ? null : listFlag([v.seconds]).map((s) => parseNumber(s, "--seconds", { min: 0 }));
  if (asked && !asked.length) fail("--seconds needs one or more seconds, e.g. --seconds 12.4,13.8");
  if (asked && asked.length > FRAMES_MAX) fail(`--seconds names at most ${FRAMES_MAX} frames (got: ${asked.length})`);
  const box = parseCrop(v.crop);
  const doc = await loadDoc(ws);
  const statusOf = statusLookup(doc, craft);
  const clip = clipOf(doc, statusOf, episode, partId, verdictSource(doc, statusOf, episode, partId, shot, v.take));
  if (statusOf(clip.id) !== "ready") fail(`${clip.id} is ${statusOf(clip.id) ?? "missing"}, not ready — there are no frames to take yet`);
  const entry = clipShots(part, clip).find((e) => e.shot === shot);
  const span = `${S.fmtSeconds(entry.start)}–${S.fmtSeconds(entry.end)} s`;
  for (const t of asked ?? []) {
    if (t < entry.start || t >= entry.end) fail(`--seconds ${t}: shot ${shot} runs ${span} on ${clip.id}'s own clock (the seconds its contact strip labels) — name seconds inside it`);
  }
  if (!media.hasTool("ffmpeg") || !media.hasTool("ffprobe")) fail(`frames needs ffmpeg and ffprobe on PATH (${FFMPEG_INSTALL})`);
  const file = assetFile(ws, doc, clip.id);
  const info = media.probe(file);
  if (!info.width || !info.height || !info.duration) fail(`cannot read ${file}`);
  const times = asked ? asked.map((t) => Math.min(info.duration - 0.05, t)) : sampleTimes(entry, count, info.duration);
  const close = box ? cropPixels(box, info.width, info.height) : null;
  // One run, one folder: <part>-frames-<n>; the assets are <ep>-<part>-frames-<n>-<k>.
  const prefix = `${episode.id}-${partId.toLowerCase()}-frames-`;
  const runRe = new RegExp(`^${prefix}(\\d+)-\\d+$`);
  let n = 1 + Math.max(0, ...doc.assets.map((a) => Number(runRe.exec(a.id)?.[1] ?? 0)));
  while (existsSync(ws.abs(`episodes/${episode.id}/review/${partId.toLowerCase()}-frames-${n}`))) n += 1;
  const dir = `episodes/${episode.id}/review/${partId.toLowerCase()}-frames-${n}`;
  const shotTag = `shot-${String(shot).padStart(2, "0")}`;
  const made = times.map((t, i) => ({ id: `${prefix}${n}-${i + 1}`, time: t, uri: `${dir}/${shotTag}-${t.toFixed(2)}s${close ? "-closeup" : ""}.jpg` }));
  try {
    for (const m of made) media.grabFrame(file, m.time, ws.abs(m.uri), close ?? {});
  } catch (error) {
    rmSync(ws.abs(dir), { recursive: true, force: true });
    throw error;
  }
  const cropParam = box ? [box.x, box.y, box.w, box.h] : null;
  await registerLocal(ws, made.map((m) => ({
    id: m.id,
    type: "image",
    name: `${episode.id} part ${partId} shot ${shot} at ${m.time.toFixed(2)} s${close ? " (close-up)" : ""}`,
    op: "derive",
    uri: m.uri,
    from: [clip.id],
    params: { op: "frame", shot, time: m.time, take: clip.id, ...(cropParam ? { crop: cropParam } : {}) },
  })), null, now);
  const which = clip.patch ? `the patch spliced over shot ${shot}` : v.take ? "the take named" : "the take in effect";
  const lines = [
    `${episode.id} part ${partId} shot ${shot} · ${clip.id} (${which}) · ${span} on its clock · ${info.width}×${info.height}`,
    ...(close ? [`  close-up of x ${Math.round(box.x * 100)}–${Math.round((box.x + box.w) * 100)} %, y ${Math.round(box.y * 100)}–${Math.round((box.y + box.h) * 100)} % (${close.crop.w}×${close.crop.h} px)${close.scale > 1 ? `, enlarged ${close.scale.toFixed(1)}× to ${close.size.w}×${close.size.h} — bigger pixels, not more detail` : ", at its own size"}`] : []),
    ...made.map((m) => `  ${m.uri}  ${m.time.toFixed(2)} s`),
    `open each one (the chat shows them as well); record what you judge with series.mjs verdict --episode ${episode.id} --shot ${shot} …`,
  ];
  emit(v, {
    command: "frames",
    episode: episode.id,
    part: partId,
    shot,
    take: clip.id,
    patch: Boolean(clip.patch),
    span: [entry.start, entry.end],
    size: `${info.width}×${info.height}`,
    crop: cropParam,
    closeup: close ? { pixels: close.crop, size: close.size } : null,
    frames: made.map((m) => ({ asset: m.id, uri: m.uri, time: m.time })),
  }, lines);
}

/** The cell keys a verdict or an accepted drift names: `--character a,b` and `--group g`. */
function cellKeysOf(v, episode) {
  const characters = listFlag([v.character ?? ""]);
  const groups = listFlag([v.group ?? ""]);
  for (const c of characters) if (!episode.cast.includes(c)) fail(`"${c}" is not in ${episode.id}'s cast (${episode.cast.join(", ")})`);
  for (const g of groups) if (!(episode.groups ?? []).includes(g)) fail(`"${g}" is not one of ${episode.id}'s groups (${(episode.groups ?? []).join(", ") || "none"})`);
  return [...characters, ...groups.map((g) => S.cellKey("group", g))];
}

/**
 * Which clip a shot's verdict belongs to: the asked `--take` (a take or a
 * patch), else whatever the cut in effect shows for that shot — the applied
 * patch spliced over it, or the take.
 */
function verdictSource(doc, statusOf, episode, partId, shot, asked) {
  if (asked) {
    const clip = clipOf(doc, statusOf, episode, partId, asked);
    if (clip.patch && (shot < clip.patch.shots[0] || shot > clip.patch.shots[1])) fail(`patch ${clip.id} splices shots ${clip.patch.shots.join("–")} only — shot ${shot} is judged on the take`);
    return clip.id;
  }
  const take = effectiveTake(doc, statusOf, episode, partId).asset;
  if (!take) fail(`${episode.id} part ${partId} has no take`);
  const { kept } = S.appliedPatches(partSlots(doc, episode.id, partId), take, statusOf);
  return kept.find((p) => shot >= p.shots[0] && shot <= p.shots[1])?.asset ?? take;
}

async function cmdVerdict(v) {
  const ws = workspace(v);
  const now = nowFrom(v);
  const verdict = v.verdict;
  const noteText = v.note ?? "";
  const { craft } = await craftModules();
  if (v.sheet) {
    if (!S.SHEET_VERDICTS.includes(verdict)) fail(`a sheet --verdict must be one of ${S.SHEET_VERDICTS.join(", ")} (got: ${verdict})`);
    if (verdict === "drift" && !noteText.trim()) fail("a drift verdict needs --note saying what is wrong");
    const doc = await loadDoc(ws);
    const hit = Object.entries(sidecar(doc).sheets).find(([, slot]) => slot.candidates.some((c) => c.asset === v.sheet));
    if (!hit) fail(`'${v.sheet}' is not a sheet candidate of any bible entity`);
    hit[1].candidates.find((c) => c.asset === v.sheet).check = { verdict, note: noteText, at: now() };
    await saveDoc(ws, doc);
    emit(v, { command: "verdict", sheet: v.sheet, entity: hit[0], verdict, note: noteText }, [`${v.sheet} (${hit[0]}): ${verdict}${noteText ? ` — ${noteText}` : ""}`]);
    return;
  }
  if (!S.VERDICTS.includes(verdict)) fail(`--verdict must be one of ${S.VERDICTS.join(", ")} (got: ${verdict})`);
  if (verdict === "drift" && !noteText.trim()) fail("a drift verdict needs --note saying what is wrong");
  const bible = loadBible(ws);
  const episode = loadEpisode(ws, v.episode, bible);
  const [partId] = partsOf(episode, v, { single: true });
  const part = episode.parts.find((p) => p.id === partId);
  if (v.shot === undefined) fail("verdict needs --shot <n> or --shot a-b");
  const [a, b] = parseRange(v.shot, "--shot");
  if (b > part.shots.length) fail(`--shot must be within 1–${part.shots.length}`);
  const keys = cellKeysOf(v, episode);
  if (!keys.length) fail("verdict needs --character <id>[,…] and/or --group <id>[,…]");
  const doc = await loadDoc(ws);
  const statusOf = statusLookup(doc, craft);
  const slots = partSlots(doc, episode.id, partId);
  const recorded = [];
  const missingFrames = new Set();
  for (let shot = a; shot <= b; shot += 1) {
    const source = verdictSource(doc, statusOf, episode, partId, shot, v.take);
    const review = [...slots.reviews].reverse().find((r) => r.take === source);
    const frame = review?.strips.find((x) => x.shot === shot)?.asset ?? null;
    if (!frame) missingFrames.add(source);
    slots.checks[source] ??= {};
    slots.checks[source][String(shot)] ??= {};
    for (const key of keys) slots.checks[source][String(shot)][key] = { verdict, note: noteText, frame, at: now() };
    recorded.push({ shot, source, frame });
  }
  for (const source of missingFrames) note(`WARN: no contact sheet of ${source} for these shots yet — the verdict is recorded without the frames it was made from (series.mjs review-episode --episode ${episode.id} --take ${source})`);
  await saveDoc(ws, doc);
  const sources = [...new Set(recorded.map((r) => r.source))];
  emit(v, { command: "verdict", episode: episode.id, part: partId, take: sources.length === 1 ? sources[0] : null, shots: recorded, characters: keys, verdict, note: noteText }, [
    `${episode.id} shot${a === b ? ` ${a}` : `s ${a}–${b}`} × ${keys.join(", ")}: ${verdict}${noteText ? ` — ${noteText}` : ""} (on ${sources.join(", ")})`,
  ]);
}

// ---------------------------------------------------------------------------
// final / compile-season
// ---------------------------------------------------------------------------

/**
 * Build the episode's final from the takes in effect and their applied
 * patches. Idempotent: when the latest ready final was built from exactly
 * these takes and patches it is returned as it is (`unchanged: true`) and
 * nothing is written — assets never change once ready, so equal ids are
 * equal inputs. `force` rebuilds anyway.
 */
async function buildFinal(ws, now, v, { force = false } = {}) {
  const { craft } = await craftModules();
  const bible = loadBible(ws);
  const episode = loadEpisode(ws, v.episode, bible);
  const doc = await loadDoc(ws);
  const statusOf = statusLookup(doc, craft);
  const per = S.partSeconds(episode);
  const parts = [];
  const takes = {};
  const used = [];
  const splices = [];
  const partSpans = [];
  // Positions are on the OUTPUT clock: a patch whose length differs from the
  // span it replaces shifts everything after it.
  //
  // Splice points are planned on shot boundaries, but the model cuts where
  // it cuts (23.63 s for a shot planned at 24): each interior point moves to
  // a scene cut detected in that clip within SNAP_S, so neither the old
  // shot nor the patch's neighbour leaks a sliver into the cut. A clip's
  // cuts come from its latest contact sheet, else are detected here.
  const cutsCache = new Map();
  const cutsOf = (assetId, slots) => {
    if (cutsCache.has(assetId)) return cutsCache.get(assetId);
    let cuts;
    try {
      cuts = clipCuts(ws, doc, statusOf, slots, assetId);
    } catch (error) {
      note(`WARN: scene cuts of ${assetId} could not be read (${errorMessage(error)}) — its splice points stay where the shot list puts them`);
      cuts = [];
    }
    cutsCache.set(assetId, cuts);
    return cuts;
  };
  const durationOf = (assetId) => Number(assetById(doc, assetId)?.metadata?.duration) || media.probe(assetFile(ws, doc, assetId)).duration || null;
  const snapWindow = ([a, b], cuts, length) => {
    const interior = (t) => t > 0.05 && (length === null || t < length - 0.05);
    const a2 = interior(a) ? S.snapToCut(a, cuts) : a;
    const b2 = interior(b) ? S.snapToCut(b, cuts) : b;
    return b2 - a2 > 0.1 ? [round4(a2), round4(b2)] : [a, b];
  };
  let clock = 0;
  episode.parts.forEach((part) => {
    const take = effectiveTake(doc, statusOf, episode, part.id).asset;
    if (!take) fail(`${episode.id} part ${part.id} has no ready take — a final needs every part`);
    const slots = partSlots(doc, episode.id, part.id);
    const { kept, dropped } = S.appliedPatches(slots, take, statusOf);
    for (const d of dropped) note(`WARN: ${d.asset} overlaps a newer patch on ${take} — not applied`);
    takes[part.id] = take;
    const file = assetFile(ws, doc, take);
    const takeSeconds = durationOf(take) || per;
    const start = clock;
    let shift = 0;
    const edits = [];
    for (const p of kept) {
      const plannedLength = p.length ?? p.span[1] - p.span[0];
      const planned = { take: [p.span[0], p.span[1]], patch: [p.offset ?? 0, round4((p.offset ?? 0) + plannedLength)] };
      const snapped = {
        take: snapWindow(planned.take, cutsOf(take, slots), takeSeconds),
        patch: snapWindow(planned.patch, cutsOf(p.asset, slots), durationOf(p.asset)),
      };
      const length = round4(snapped.patch[1] - snapped.patch[0]);
      used.push(p.asset);
      splices.push({ part: part.id, shots: p.shots, at: [round4(start + snapped.take[0] + shift), round4(start + snapped.take[0] + shift + length)], patch: p.asset, planned, snapped });
      shift += length - (snapped.take[1] - snapped.take[0]);
      edits.push({ start: snapped.take[0], end: snapped.take[1], patch: assetFile(ws, doc, p.asset), offset: snapped.patch[0], length });
      const moved = planned.take.some((x, i) => x !== snapped.take[i]) || planned.patch.some((x, i) => x !== snapped.patch[i]);
      if (moved) note(`[series] ${p.asset}: splice moved to the clips' own cuts — take ${planned.take.map(S.fmtSeconds).join("–")} → ${snapped.take.join("–")} s, patch ${planned.patch.map(S.fmtSeconds).join("–")} → ${snapped.patch.join("–")} s`);
    }
    clock = start + takeSeconds + shift;
    partSpans.push({ part: part.id, take, at: [round4(start), round4(clock)] });
    parts.push({ file, edits });
  });
  const stage = () => S.episodeStage(episode, episodeSlots(doc, episode.id), statusOf);
  const latest = [...episodeSlots(doc, episode.id).finals].reverse().find((f) => statusOf(f.asset) === "ready");
  const same = latest
    && episode.parts.every((part) => latest.takes?.[part.id] === takes[part.id])
    && S.canonicalJson(latest.patches ?? []) === S.canonicalJson(used);
  if (same && !force) {
    return { id: latest.asset, uri: assetById(doc, latest.asset).uri, takes, patches: used, splices: latest.splices ?? splices, unchanged: true, stage: stage() };
  }
  const finalId = nextId(doc, `${episode.id}-final-`);
  const uri = `episodes/${episode.id}/final-${finalId.split("-").pop()}.mp4`;
  media.assembleCut(parts, ws.abs(uri));
  const inputs = [...Object.values(takes), ...used];
  await registerLocal(ws, { id: finalId, type: "video", name: `${episode.id} final`, op: "composite", uri, from: inputs, params: { op: "final", edits: splices.map((s) => ({ part: s.part, replace: s.at, with: s.patch })) } }, (d) => {
    episodeSlots(d, episode.id).finals.push({ asset: finalId, takes, patches: used, parts: partSpans, splices });
    for (const part of episode.parts) {
      for (const patch of partSlots(d, episode.id, part.id).patches) patch.applied = used.includes(patch.asset);
    }
  }, now);
  const after = await loadDoc(ws);
  return { id: finalId, uri, takes, patches: used, splices, unchanged: false, stage: S.episodeStage(episode, episodeSlots(after, episode.id), statusLookup(after, craft)) };
}

/** The line that says whether a built final makes the episode done. */
function stageLine(id, stage) {
  if (stage.stage === "done") return `${id} is done: every shot × cast / group cell has a verdict`;
  if (stage.finalReady && stage.unverified) return `${id} is NOT done: ${stage.unverified} check(s) unverified — review-episode, then verdict each shot × cast / group cell (patched shots on their patch)`;
  return `${id} stage: ${stage.stage}`;
}

async function cmdFinal(v) {
  const ws = workspace(v);
  const now = nowFrom(v);
  checkEpisodeId(v.episode);
  if (!media.hasTool("ffmpeg") || !media.hasTool("ffprobe")) fail("final needs ffmpeg and ffprobe on PATH");
  const result = await buildFinal(ws, now, v, { force: v.force });
  emit(v, { command: "final", episode: v.episode, final: result }, [
    result.unchanged
      ? `${v.episode} final: ${result.id} → ${result.uri} (unchanged: built from these takes and patches already; --force rebuilds)`
      : `${v.episode} final: ${result.id} → ${result.uri}`,
    result.splices.length ? `splices: ${result.splices.map((s) => `${s.patch} at ${S.fmtSeconds(s.at[0])}–${S.fmtSeconds(s.at[1])} s`).join("; ")}` : "no patches applied",
    stageLine(v.episode, result.stage),
  ]);
}

async function cmdCompileSeason(v) {
  const ws = workspace(v);
  const now = nowFrom(v);
  if (!media.hasTool("ffmpeg") || !media.hasTool("ffprobe")) fail("compile-season needs ffmpeg and ffprobe on PATH");
  const { craft } = await craftModules();
  const bible = loadBible(ws);
  const doc = await loadDoc(ws);
  const statusOf = statusLookup(doc, craft);
  const ids = v.episodes ? listFlag([v.episodes]) : listEpisodeIds(ws);
  const chosen = [];
  for (const id of ids) {
    const episode = loadEpisode(ws, id, bible);
    const finals = episodeSlots(doc, id).finals.filter((f) => statusOf(f.asset) === "ready");
    if (!finals.length) {
      if (v.episodes) fail(`${id} has no ready final — series.mjs final --episode ${id}`);
      continue;
    }
    const latest = finals[finals.length - 1];
    const current = episode.parts.every((p) => latest.takes?.[p.id] === effectiveTake(doc, statusOf, episode, p.id).asset);
    if (!current) note(`WARN: ${id}'s latest final was built from other takes than the ones in effect — compiled anyway; rebuild with series.mjs final --episode ${id}`);
    chosen.push({ episode, final: latest.asset });
  }
  if (!chosen.length) fail("no episode has a ready final yet");
  const format = v["title-format"] ?? "{title}";
  const titles = v.titles ? chosen.map((c, i) => format.replaceAll("{n}", String(i + 1)).replaceAll("{id}", c.episode.id).replaceAll("{title}", c.episode.title || c.episode.id)) : [];
  const font = v.titles ? media.findFont(v.font) : null;
  if (v.titles && !font) note("WARN: no font file found for title cards — ffmpeg's default font may lack CJK glyphs (pass --font <file>)");
  const compId = nextId(doc, "season-");
  const uri = `season/${compId}.mp4`;
  mkdirSync(ws.abs("season"), { recursive: true });
  media.compileEpisodes(chosen.map((c) => assetFile(ws, doc, c.final)), ws.abs(uri), { titles, font });
  await registerLocal(ws, { id: compId, type: "video", name: `${bible.title || "season"} compilation`, op: "composite", uri, from: chosen.map((c) => c.final), params: { op: "compile", titles } }, (d) => {
    sidecar(d).compilations.push({ asset: compId, episodes: chosen.map((c) => c.episode.id), titles: Boolean(v.titles) });
  }, now);
  emit(v, { command: "compile-season", compilation: { id: compId, uri, episodes: chosen.map((c) => c.episode.id), titles } }, [`season: ${compId} → ${uri} (${chosen.map((c) => c.episode.id).join(", ")})`]);
}

// ---------------------------------------------------------------------------
// retry
// ---------------------------------------------------------------------------

/**
 * Retry a failed generation, without paying twice for one that may have
 * finished. A fal render that failed with billing unknown and a recorded
 * request id (a wait that timed out, an interrupt) is first LANDED: fal is
 * asked about that request and its clip downloaded when it finished — no
 * new render is sent. Only `--resubmit` sends the recorded request again,
 * as a new paid call, and says what the earlier one may already have cost.
 * Every other failure is re-sent as recorded, with the same warning when
 * its billing is unknown.
 */
async function cmdRetry(v) {
  const ws = workspace(v);
  const now = nowFrom(v);
  const { craft } = await craftModules();
  const doc = await loadDoc(ws);
  if (!v.asset) {
    const failed = doc.assets.filter((a) => craft.statusOf(a) === "failed").map((a) => {
      const p = edgeOf(doc, a.id)?.operation?.params ?? {};
      return { id: a.id, slot: p.slot ?? null, reason: p.failure?.reason ?? "", billing: p.failure?.billing ?? null, requestId: p.requestId ?? null };
    });
    emit(v, { command: "retry", failed }, failed.length
      ? [...failed.map((f) => `  ${f.id} — ${f.reason} (billing ${f.billing}${f.requestId ? `; fal request ${f.requestId} — retry lands it first` : ""})`), "retry one with: series.mjs retry --asset <id> [--resubmit]"]
      : ["no failed generations"]);
    return;
  }
  const asset = assetById(doc, v.asset);
  if (!asset) fail(`no asset '${v.asset}'`);
  const status = craft.statusOf(asset);
  if (status === "ready") fail(`'${asset.id}' is ready — nothing to retry`);
  if (status !== "failed" && !v.force) fail(`'${asset.id}' is ${status} — it may still be in flight in another process; pass --force only if you know it is not`);
  const edge = edgeOf(doc, asset.id);
  const p = edge?.operation?.params ?? {};
  if (edge?.operation?.type !== "generate" || !p.provider) fail(`'${asset.id}' is not a generation (${edge?.operation?.type ?? "no edge"}) — rerun the command that made it`);
  const inputs = craft.edgeInputs(edge);
  const files = inputs.map((id) => assetFile(ws, doc, id));
  const extra = Object.fromEntries(Object.entries(p).filter(([k]) => !craft.RESERVED_PARAM_KEYS.includes(k) && k !== "earlier" && k !== "retry"));
  const request = p.request ?? {};
  const gen = await generators();
  const billing = p.failure?.billing ?? null;
  const requestId = typeof p.requestId === "string" && p.requestId ? p.requestId : null;
  const earlierCost = p.cost && Number.isFinite(p.cost.usd) ? p.cost : null;
  const attach = p.provider === "fal" && billing === "unknown" && requestId !== null && !v.resubmit;
  const mode = attach ? "attach" : v.resubmit ? "resubmit" : "resend";
  if (v.resubmit && p.provider !== "fal") fail("--resubmit is for fal renders with a recorded request; other retries re-send as recorded");
  const reserve = {
    id: asset.id, type: asset.type, name: asset.name, op: "generate", uri: asset.uri || "", from: inputs, model: p.model, prompt: p.prompt, provider: p.provider,
    params: { ...extra, retry: mode },
    ...(p.cost && p.cost.basis !== "reported" ? { cost: { ...p.cost } } : {}),
  };
  const deadlineMs = (parseNumber(v["deadline-s"], "--deadline-s", { min: 60 }) ?? 1800) * 1000;
  let call;
  if (p.provider === "openrouter") {
    const apiKey = gen.imageKey();
    if (!apiKey) fail(noKey("OpenRouter", "re-run the step by hand and register it with --upload"));
    const target = ws.abs(asset.uri || `refs/${asset.id}.png`);
    call = async ({ signal }) => {
      const out = await gen.generateImage({ prompt: p.prompt, model: p.model, numImages: 1, aspectRatio: request.aspectRatio, quality: request.quality, imageUrls: files, apiKey, outputDir: dirname(target), filenamePrefix: target.slice(dirname(target).length + 1).replace(/\.[^.]+$/, ""), signal });
      return { file: out.files[0], cost: reportedCost(out.usage) };
    };
  } else if (p.provider === "fal") {
    const apiKey = gen.falKey();
    if (!apiKey) fail(noKey("fal", "re-run the step by hand and register it with --upload"));
    const options = { prompt: p.prompt, output: ws.abs(asset.uri), apiKey, endpoint: request.endpoint ?? "reference", refImages: files, duration: String(request.duration), resolution: request.resolution, aspectRatio: request.aspectRatio, audio: request.audio !== false, seed: request.seed, deadlineMs };
    call = attach
      ? async ({ signal }) => {
        const result = await gen.resumeSeedanceVideo({ ...options, requestId, signal });
        return { file: result.path, requestId: result.request_id ?? requestId, cost: deliveredVideoCost(result) };
      }
      : async ({ signal }) => {
        const result = await gen.generateSeedanceVideo({ ...options, signal });
        return { file: result.path, requestId: result.request_id, cost: deliveredVideoCost(result) };
      };
  } else fail(`'${asset.id}' was made by provider '${p.provider}', which retry does not know`);
  const uncertain = billing === "unknown"
    ? `the earlier call's billing is unknown${earlierCost ? ` (it was estimated at ${money(earlierCost.usd)})` : ""}${requestId ? ` — fal request ${requestId}` : ""}`
    : null;
  if (v["dry-run"]) {
    emit(v, { command: "retry", dryRun: true, mode, requestId, reserve: { ...reserve, prompt: `${String(p.prompt).slice(0, 80)}…` }, inputs }, [
      attach
        ? `dry run — would ask fal about request ${requestId} and land ${asset.id} if it finished; no new render is sent`
        : `dry run — would re-send ${asset.id} (${p.provider} ${p.model}) with ${inputs.length} reference(s) as a NEW paid call; nothing sent`,
      !attach && uncertain ? `WARN: ${uncertain}; sending again may pay twice` : null,
    ]);
    return;
  }
  if (attach) note(`[series] ${asset.id}: asking fal about request ${requestId} first, waiting up to ${deadlineMs / 1000} s (--deadline-s) — no new render is sent (series.mjs retry --asset ${asset.id} --resubmit sends a new one)`);
  else if (uncertain) note(`WARN: ${asset.id}: ${uncertain}; this retry is a NEW paid call and may pay twice`);
  const row = await runPaid(ws, now, { reserve, call });
  if (!row.ok && attach) {
    note(`fal request ${requestId} could not be landed. Its billing is still unknown. To send the request again as a new paid render${earlierCost ? ` (≈ ${money(earlierCost.usd)} more)` : ""}: series.mjs retry --asset ${asset.id} --resubmit`);
  }
  let followUp = null;
  if (row.ok && p.slot?.command === "redo-panel") {
    const bible = loadBible(ws);
    const episode = loadEpisode(ws, p.slot.episode, bible);
    const panel = partSlots(await loadDoc(ws), episode.id, p.slot.part).panels.find((x) => x.asset === asset.id);
    if (panel) followUp = await compositePanelInto(ws, now, { episode, partId: p.slot.part, panelId: asset.id, baseBoard: panel.board, shot: panel.shot, bible });
  } else if (row.ok && p.slot?.command === "patch-range") {
    followUp = await maybeFinal(ws, now, { ...v, episode: p.slot.episode });
  }
  emit(v, { command: "retry", mode, requestId: attach ? requestId : null, result: row, followUp }, [
    attach && row.ok ? `${asset.id}: landed fal request ${requestId} — no new render was sent` : null,
    ...paidLines([row]),
    followUp?.id ? `then: ${followUp.id} → ${followUp.uri}${followUp.unchanged ? " (unchanged)" : ""}` : followUp?.skipped ? `final not rebuilt: ${followUp.skipped}` : null,
  ]);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/**
 * Per-command usage, in the order `--help` lists them. `series.mjs <command>
 * --help` prints one entry; `--help` alone prints every entry under its
 * group. Each entry lists every flag the command accepts.
 */
const COMMAND_HELP = [
  ["Setup and bible", [
    ["init", "[--title <t>] [--ratio 16:9]", "create bible.json, project.json, refs/, episodes/ (keeps files that exist) and say whether ffmpeg/ffprobe are installed. --ratio must be one Seedance 2.5 renders: 21:9, 16:9, 4:3, 1:1, 3:4, 9:16"],
    ["set-series", "[--title] [--ratio] [--dialogue true|false] [--style] [--sheet-style] [--lang en|zh|auto]", "the style card. --lang pins the prompt scaffolding language; auto (default) follows the bible's text"],
    ["set-character", "--id <id> [--name] [--look] [--ability] [--personality] [--markings <text>]\n                 [--palette <css>|<label>=<css>]… [--expression <e>]… [--pose <p>]… [--alias <word>]… [--not-name <word>]…", "add or amend a character; a repeated flag replaces the whole list; --markings \"\" removes it. --alias / --not-name only steer which shots are expected to show it (\"光\" is not in \"冷蓝光\")"],
    ["set-group", "--id <id> [--name] [--look] [--leader <text>] [--markings <text>]\n                 [--palette <css>|<label>=<css>]… [--pose <p>]… [--alias <word>]… [--not-name <word>]…", "add or amend a group (a swarm, a gang); --leader \"\" removes it. A group with a leader is also named by the role word (leader, 头目)"],
    ["set-scene", "--id <id> [--name] [--look] [--time <time of day>] [--rules <text>]", "add or amend a scene. --rules: short constraints every image and clip of the set must keep (\"the clock face has no numbers\"), sent with the scene sheet, every board and panel, and every clip"],
    ["lock", "", "append the next bible version to bible.json locks[] (no new lock when nothing changed)"],
    ["pick", "--character|--group|--scene <id> --sheet <asset|none>\n                 --episode <id> [--part P] --storyboard <asset> | --take <asset>\n                 --episode <id> [--part P] --accept-drift --shot <n> --character <id>[,…] | --group <id> [--take <take|patch>]\n                 --episode <id> --acknowledge", "sheet picks, the board or take in use, a kept drift (on the clip the shot is judged on), quieting the bible flag"],
  ]],
  ["Episodes", [
    ["add-episode", "[--episode epNN] --title <t> [--duration 30] [--cast a,b] [--groups g] [--scene s] [--time <t>]\n                 [--continuity <line>]… [--shots-file <json|->] [--force]", "write a new episode. Without --continuity it gets the method's two lines (each shot picks up the last one's action; one running direction), in the bible's language; --continuity \"\" writes none"],
    ["set-episode", "--episode <id> [same flags as add-episode]", "change the setup or replace the shot list"],
    ["set-shot", "--episode <id> [--part P] --shot <n> [--desc] [--sfx] [--sketch] [--dur <s> [--from both|next|prev]]", "change one shot; neighbours absorb a duration change; --sketch \"\" removes the sketch"],
    ["log", "--episode <id> [--goal] [--used <ability>]… [--ending] [--location]", "record what a finished episode used"],
    ["ideas-context", "", "what has been made already: places, goals, abilities, endings"],
  ]],
  ["Prompts and money", [
    ["prompts", "--episode <id> [--part P] [--target seedance|jimeng|all] [--write]\n                 --episode <id> [--part P] --shots a-b [--target seedance|jimeng|all] [--write]\n                 --episode <id> [--part P] --shot <n> [--target seedance|jimeng|all] [--write]\n                 --sheets [--character|--group|--scene <id>] [--target jimeng] [--write]", "print prompts exactly as they will be sent, in the bible's language. An episode's prompts are recorded in project.json for the viewer only when they changed (otherwise nothing is written); --shots prints a re-shoot's prompts (Seedance and Jimeng) and warns when an end of the span is not on a cut the take has; --shot prints one panel's redraw prompt, its Jimeng form listing the board node first, then the sheets; neither records anything. --write also saves .txt files"],
    ["estimate", "--episode <id> [--part P] [--what all|board|panel|video] [--shots a-b] [--resolution 480p]\n                 [--model flare|sunburst] [--quality high]\n                 --sheets [--character|--group|--scene <id>] [--count 2] [--model] [--quality]\n                 --lineup [--character a,b] [--model] [--quality]", "price what a paid command would send, with the model it would use (boards, panels and lineups: Sunburst when references are attached). Images: this project's reported median, else the seed rounds' table price; never \"$0\" for an unpriced call"],
    ["status", "[--episode <id>]", "the whole series and whether ffmpeg/ffprobe are installed; with --episode, that episode shot by shot: timing, staleness and every cell's verdict"],
    ["validate", "", "check bible.json, every episode.json and the sidecar"],
  ]],
  ["Making (paid unless --upload; all take --dry-run)", [
    ["make-sheets", "--character|--group|--scene <id> | --missing   [--count 2] [--model flare|sunburst] [--quality high]\n                 [--aspect 1:1] [--pick]  |  --upload <file> [--pick]", "sheet candidates (Flare unless --model); a scene takes the picked character sheets along as style references"],
    ["check-sheets", "--character|--group|--scene <id> [--font <file>]", "side-by-side compare image of the ready candidates (ffmpeg)"],
    ["lineup", "[--character a,b,…] [--model] [--quality high] [--aspect 16:9] | --upload <file>", "two or more picked sheets drawn side by side at one scale — the cheap check before a clip (default: every character with a picked sheet; Sunburst)"],
    ["shoot-board", "--episode <id> [--part P] [--count 1] [--model flare|sunburst] [--quality high] | --part P --upload <file>", "one black-and-white storyboard per part, sheets attached (Sunburst by default when references are attached)"],
    ["redo-panel", "--episode <id> [--part P] --shot <n> [--model] [--quality high] | --upload <file>", "redraw one panel and composite it into a new board (ffmpeg). The board in effect goes along as image 1, the style reference, then the sheets; same model rule as shoot-board"],
    ["shoot-video", "--episode <id> [--part P] [--resolution 480p] [--seed n] [--no-audio] [--deadline-s 1800] | --part P --upload <file>", "one Seedance 2.5 take per part. --deadline-s: how long to wait for fal before giving up (the job is cancelled; billing then unknown)"],
    ["patch-range", "--episode <id> [--part P] --shots a-b [--take <asset>] [--resolution] [--seed n] [--no-audio] [--deadline-s 1800] | --upload <file>", "re-shoot shots a–b of the take (at least 4 s are rendered); warns when an end of a–b has no cut in the take within 0.5 s (the splice would show as a jump); when it lands the final is rebuilt (patch-range finalises)"],
    ["retry", "[--asset <id>] [--resubmit] [--deadline-s 1800] [--force]", "list failed generations, or retry one. A fal render with a recorded request id is LANDED first (fal is asked about that request; no new render); --resubmit sends it again as a new paid call. Other failures are re-sent as recorded"],
  ]],
  ["Checking and finishing (ffmpeg)", [
    ["review-episode", "--episode <id> [--part P] [--take <take|patch>] [--frames 3] [--font <file>]", "contact sheets: the cast and group sheets once on top, then one row of frames per shot; with a patch, its spliced shots. Lists who each shot's words name"],
    ["frames", "--episode <id> [--part P] --shot <n> [--count 6 | --seconds <s>[,<s>…]] [--crop x,y,w,h] [--take <take|patch>]", "free: more frames of one shot at the clip's own size, or a closer look (--crop: a box in fractions of the frame, enlarged up to 4×), from the clip the shot is judged on, into episodes/<id>/review/<part>-frames-<n>/ (recorded as derive assets). --seconds are on that clip's own clock, inside the shot"],
    ["verdict", "--sheet <asset> --verdict ok|drift|unverified [--note]\n                 --episode <id> [--part P] [--take <take|patch>] --shot <n|a-b> --character <id>[,…] | --group <id>[,…]\n                 --verdict ok|drift|absent|unverified [--note]", "record a check. absent: not in the frames (a lost beat where the shot's words name them). A shot spliced from a patch is judged on the patch unless --take says otherwise"],
    ["final", "--episode <id> [--force]", "concat the parts' takes and splice their applied patches; each interior splice point moves to a scene cut detected within 0.5 s (both are recorded). With the same takes and patches as the latest final it makes no new file (--force rebuilds). Done only when every shot × cast / group cell has a verdict"],
    ["compile-season", "[--episodes ep01,ep02] [--titles] [--title-format \"{n}. {title}\"] [--font <file>]", "join the latest finals, optionally behind title cards"],
  ]],
];

const COMMON_HELP = `Common: --dir <workspace> (default: cwd) · --json prints one object on stdout · --at <epoch ms> pins timestamps.
Generation adapters: OPENROUTER_API_KEY (images), FAL_KEY (Seedance 2.5 video). Run "series.mjs <command> --help" for one command.`;

const helpEntry = ([name, usage, what]) => `  ${name.padEnd(15)}${usage}${what ? `\n                 ${what}` : ""}`;

export const HELP = `Usage: series.mjs <command> [--dir <workspace>] [--json] [options]

Files: bible.json and episodes/<id>/episode.json are text you and the viewer
edit (these commands are helpers); project.json is machine state written only
here. Paid commands record before sending and take --dry-run.

${COMMAND_HELP.map(([group, entries]) => `${group}\n${entries.map(helpEntry).join("\n")}`).join("\n\n")}

${COMMON_HELP}`;

/** One command's usage, or null for an unknown command. */
export function commandHelp(command) {
  for (const [, entries] of COMMAND_HELP) {
    const entry = entries.find(([name]) => name === command);
    if (entry) return `Usage: series.mjs ${command} ${entry[1]}\n\n${entry[2]}\n\n${COMMON_HELP}`;
  }
  return null;
}

const OPTIONS = {
  dir: { type: "string" }, json: { type: "boolean", default: false }, at: { type: "string" },
  "dry-run": { type: "boolean", default: false }, force: { type: "boolean", default: false },
  help: { type: "boolean", short: "h", default: false },
  title: { type: "string" }, ratio: { type: "string" }, dialogue: { type: "string" }, style: { type: "string" }, "sheet-style": { type: "string" }, lang: { type: "string" },
  id: { type: "string" }, name: { type: "string" }, look: { type: "string" }, ability: { type: "string" }, personality: { type: "string" },
  markings: { type: "string" }, leader: { type: "string" }, rules: { type: "string" },
  alias: { type: "string", multiple: true }, "not-name": { type: "string", multiple: true },
  palette: { type: "string", multiple: true }, expression: { type: "string", multiple: true }, pose: { type: "string", multiple: true },
  character: { type: "string" }, group: { type: "string" }, scene: { type: "string" }, sheet: { type: "string" },
  episode: { type: "string" }, part: { type: "string" }, shot: { type: "string" }, shots: { type: "string" },
  storyboard: { type: "string" }, take: { type: "string" }, "accept-drift": { type: "boolean", default: false }, acknowledge: { type: "boolean", default: false },
  duration: { type: "string" }, cast: { type: "string" }, groups: { type: "string" }, time: { type: "string" },
  continuity: { type: "string", multiple: true }, "shots-file": { type: "string" },
  desc: { type: "string" }, sfx: { type: "string" }, sketch: { type: "string" }, dur: { type: "string" }, from: { type: "string" },
  goal: { type: "string" }, location: { type: "string" }, ending: { type: "string" }, used: { type: "string", multiple: true },
  write: { type: "boolean", default: false }, target: { type: "string" }, sheets: { type: "boolean", default: false }, lineup: { type: "boolean", default: false },
  resolution: { type: "string" }, what: { type: "string" }, count: { type: "string" }, model: { type: "string" }, quality: { type: "string" },
  upload: { type: "string" }, pick: { type: "boolean", default: false }, missing: { type: "boolean", default: false },
  frames: { type: "string" }, seconds: { type: "string" }, crop: { type: "string" }, verdict: { type: "string" }, note: { type: "string" }, asset: { type: "string" }, resubmit: { type: "boolean", default: false },
  episodes: { type: "string" }, titles: { type: "boolean", default: false }, "title-format": { type: "string" }, font: { type: "string" },
  seed: { type: "string" }, "no-audio": { type: "boolean", default: false }, "deadline-s": { type: "string" },
  aspect: { type: "string" },
};

const COMMANDS = {
  init: cmdInit,
  "set-series": cmdSetSeries,
  "set-character": makeSetEntity("character"),
  "set-group": makeSetEntity("group"),
  "set-scene": makeSetEntity("scene"),
  lock: cmdLock,
  pick: cmdPick,
  "add-episode": cmdAddEpisode,
  "set-episode": cmdSetEpisode,
  "set-shot": cmdSetShot,
  log: cmdLog,
  "ideas-context": cmdIdeasContext,
  prompts: cmdPrompts,
  estimate: cmdEstimate,
  status: cmdStatus,
  validate: cmdValidate,
  "make-sheets": cmdMakeSheets,
  "check-sheets": cmdCheckSheets,
  lineup: cmdLineup,
  "shoot-board": cmdShootBoard,
  "redo-panel": cmdRedoPanel,
  "shoot-video": cmdShootVideo,
  "patch-range": cmdPatchRange,
  "review-episode": cmdReviewEpisode,
  frames: cmdFrames,
  verdict: cmdVerdict,
  final: cmdFinal,
  "compile-season": cmdCompileSeason,
  retry: cmdRetry,
};

export async function main(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (error) {
    process.stderr.write(`ERROR: ${errorMessage(error)}\n`);
    return 1;
  }
  const { values, positionals } = parsed;
  const command = positionals[0];
  if (values.help && command && COMMANDS[command]) {
    process.stderr.write(`${commandHelp(command)}\n`);
    return 0;
  }
  if (values.help || !command) {
    process.stderr.write(`${HELP}\n`);
    return values.help ? 0 : 1;
  }
  const handler = COMMANDS[command];
  if (!handler) {
    process.stderr.write(`ERROR: unknown command '${command}' — series.mjs --help lists them\n`);
    return 1;
  }
  if (positionals.length > 1) {
    process.stderr.write(`ERROR: unexpected argument '${positionals[1]}'\n`);
    return 1;
  }
  try {
    await handler(values);
    return process.exitCode ?? 0;
  } catch (error) {
    process.stderr.write(`ERROR: ${errorMessage(error)}\n`);
    return 1;
  }
}

function isMain() {
  if (typeof import.meta.main === "boolean") return import.meta.main;
  const entry = process.argv[1] ? resolve(process.argv[1]) : null;
  return entry !== null && fileURLToPath(import.meta.url) === entry;
}

if (isMain()) {
  process.exitCode = await main();
}

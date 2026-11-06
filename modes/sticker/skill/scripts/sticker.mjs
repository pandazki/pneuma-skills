#!/usr/bin/env node
/**
 * sticker.mjs — the sticker-pack workbench CLI.
 *
 * Two files, two kinds of writer:
 *   pack.json      the pack — text and the person's decisions (character
 *                  anchor, picked takes, keepFrames, picked art, listing).
 *                  The agent edits it; the viewer writes it. THIS CLI ONLY
 *                  READS IT.
 *   project.json   the craft project: every media file as an asset with
 *                  provenance and cost, plus the `sticker` sidecar of
 *                  measurements. THIS CLI IS ITS ONLY WRITER (through
 *                  craft-project-io.mjs, atomic replace).
 *
 * The rules (prompts, staleness, platform profiles, checks, next step) live
 * in `sticker-state.mjs`, shared with the viewer; ffmpeg steps in
 * `sticker-media.mjs`. Every paid call goes through `runRegistered`:
 * reserved on disk before the request leaves, then landed or failed. Paid
 * commands refuse without `rights` in pack.json, say their cost before and
 * after, and never retry a call that may have been billed. A generated file
 * is never overwritten: a new take is a new file.
 *
 * Node built-ins plus ffmpeg/ffprobe; no npm dependencies.
 */

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import * as media from "./sticker-media.mjs";
import * as S from "./sticker-state.mjs";

const { importShared } = media;

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
const money = (usd) => (usd === null || usd === undefined || !Number.isFinite(usd) ? "unpriced" : `$${usd.toFixed(usd < 1 ? 3 : 2)}`);
const kb = (n) => `${Math.round(n / 1000)} KB`;

// ---------------------------------------------------------------------------
// Shared scripts and generators
// ---------------------------------------------------------------------------

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
 * The generation adapters. `STICKER_GENERATORS` replaces the generate
 * functions (and the key lookups) with a local module — how the tests run
 * the whole path without a network. Every run that uses it says so.
 * Request builders always come from the real scripts, so a dry run shows
 * exactly what would be sent.
 */
let generatorCache = null;
async function generators() {
  if (generatorCache) return generatorCache;
  const [gif, image, queue] = await Promise.all([
    importShared("generate_gif.mjs", "sticker takes"),
    importShared("generate_image.mjs", "character and art images"),
    importShared("fal-queue.mjs", "sticker takes"),
  ]);
  let mock = {};
  const override = process.env.STICKER_GENERATORS;
  if (override) {
    mock = await import(pathToFileURL(resolve(override)).href);
    note(`WARN: STICKER_GENERATORS is set — generations come from ${override}, not from the providers`);
  }
  generatorCache = {
    generateGif: mock.generateGif ?? gif.generateGif,
    buildGifRequest: gif.buildGifRequest,
    gifModelId: gif.gifModelId,
    generateImage: mock.generateImage ?? image.generateImage,
    buildImageRequest: image.buildImageRequest,
    resolveImageModel: image.resolveImageModel,
    falKey: mock.falKey ?? (() => queue.loadFalKey() ?? null),
    imageKey: mock.imageKey ?? (() => image.loadEnvKeys().OPENROUTER_API_KEY ?? null),
    writeNewFile: queue.writeNewFile,
  };
  return generatorCache;
}

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

function workspace(v) {
  const root = resolve(v.dir ?? process.cwd());
  return {
    root,
    pack: join(root, "pack.json"),
    project: join(root, "project.json"),
    rel: (abs) => relative(root, abs).split(sep).join("/"),
    abs: (rel) => join(root, rel),
  };
}

const PACK_HINT = `pack.json holds { version: 1, rights, platforms, character: { description, style, anchor }, motion, listing, stickers: [{ id, word, caption, emoji, action, take, keepFrames }], art }`;

function loadPack(ws) {
  if (!existsSync(ws.pack)) fail(`no pack.json in ${ws.root} — write one first (${PACK_HINT})`);
  const parsed = S.parsePack(readFileSync(ws.pack, "utf-8"));
  if (!parsed.ok) fail(`pack.json is invalid:\n- ${parsed.errors.map((e) => e.message).join("\n- ")}`);
  for (const w of parsed.warnings) note(`WARN: pack.json: ${w}`);
  return parsed.pack;
}

async function loadProjectOrNull(ws) {
  if (!existsSync(ws.project)) return null;
  const { io } = await craftModules();
  return io.loadProject(ws.project, { sidecarKey: S.SIDECAR_KEY });
}

function packTitle(pack) {
  return pack.listing.wechat?.name || pack.listing.telegram?.title || pack.listing.line?.title || "Sticker pack";
}

/** project.json, created on first write (sticker.mjs is its only writer). */
async function ensureProject(ws, pack) {
  const { craft, io } = await craftModules();
  if (!existsSync(ws.project)) {
    io.saveProject(ws.project, craft.emptyProject({
      title: packTitle(pack),
      settings: { width: pack.motion.size, height: pack.motion.size, fps: Math.max(1, Math.round(1000 / pack.motion.frameMs)) },
      sidecarKey: S.SIDECAR_KEY,
      sidecar: { schema: S.SIDECAR_SCHEMA, measures: {}, archives: {} },
    }));
  }
  return io.loadProject(ws.project, { sidecarKey: S.SIDECAR_KEY });
}

/**
 * Before every save: drop sidecar records the project no longer backs
 * (`S.pruneSidecar` — a craft `drop` leaves them). Returns what went.
 */
function tidy(doc) {
  const { sidecar: kept, dropped } = S.pruneSidecar(doc);
  doc[S.SIDECAR_KEY] = kept;
  if (dropped.measures.length || dropped.archives.length) {
    note(`project.json: dropped the records of files it no longer holds — ${[
      dropped.measures.length ? `${dropped.measures.length} measurement(s)` : null,
      dropped.archives.length ? `archive record(s) of ${dropped.archives.join(", ")}` : null,
    ].filter(Boolean).join(", ")}`);
  }
  return dropped;
}

/** The sidecar with every container present (this CLI is its only writer). */
function sidecar(doc) {
  const s = doc[S.SIDECAR_KEY];
  s.schema ??= S.SIDECAR_SCHEMA;
  s.measures ??= {};
  s.archives ??= {};
  return s;
}

function assetById(doc, id) {
  return doc?.assets.find((a) => a.id === id) ?? null;
}

function nowFrom(v) {
  if (v.at === undefined) return Date.now;
  const at = Number(v.at);
  if (!Number.isFinite(at)) fail(`--at must be epoch milliseconds (got: ${v.at})`);
  return () => at;
}

function listFlag(value) {
  return String(value ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

function parseNumber(value, flag, { integer = false, min = -Infinity, max = Infinity } = {}) {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (value === "" || !Number.isFinite(n) || (integer && !Number.isInteger(n)) || n < min || n > max) fail(`${flag} must be ${integer ? "an integer" : "a number"} from ${min} to ${max} (got: ${value})`);
  return n;
}

/** The next free number for an id family, also skipping files already on disk. */
function nextFree(doc, prefix, fileFor) {
  let n = S.nextNumber(doc, prefix);
  while (fileFor && existsSync(fileFor(n))) n += 1;
  return n;
}

function requireRights(pack, what) {
  if (!pack.rights) {
    fail(`rights is not recorded in pack.json — ${what} is a paid step and refuses without it. Record rights: { basis: ${S.RIGHTS_BASES.join(" | ")}, note, confirmedAt: "YYYY-MM-DD" } once the user has confirmed who the character belongs to.`);
  }
}

function requireAnchor(ws, pack, doc) {
  const state = S.anchorState(pack, doc);
  if (!state.ready) fail(`${state.reason} — the anchor is the reference every take is drawn from. Make or import a character (sticker.mjs character / import --character) and set character.anchor in pack.json.`);
  return { id: state.anchor, file: ws.abs(assetById(doc, state.anchor).uri) };
}

function noKey(kind) {
  return kind === "fal"
    ? "no fal key (FAL_KEY in the environment or a .env) — nothing was sent. Without it: sticker.mjs prompts prints each sticker's prompt; make the GIF in ChatGPT with the anchor image attached, then sticker.mjs import --sticker <id> --file <gif>."
    : "no OpenRouter key (OPENROUTER_API_KEY in the environment or a .env) — nothing was sent. Without it: sticker.mjs prompts --character / --art prints the prompts; make the image elsewhere, then sticker.mjs import --character | --art <kind> --file <image>.";
}

// ---------------------------------------------------------------------------
// Costs
// ---------------------------------------------------------------------------

function gifEstimate() {
  return { usd: S.ESTIMATES.gifUsd, basis: "estimate", note: `planning estimate ($${S.ESTIMATES.gifRangeUsd[0]}–${S.ESTIMATES.gifRangeUsd[1]} per GIF): fal reports no usage for GPT Image 2.6 GIF jobs — not an invoice` };
}

/** The median of this project's reported OpenRouter prices for `model`, else the table price for a high-quality image. */
function imageEstimate(doc, model, quality) {
  const reported = (doc?.provenance ?? [])
    .map((e) => e.operation?.params)
    .filter((p) => p?.provider === "openrouter" && p?.model === model && p?.cost?.basis === "reported" && Number.isFinite(p.cost.usd))
    .map((p) => p.cost.usd)
    .sort((a, b) => a - b);
  if (reported.length) {
    const m = reported.length % 2 ? reported[(reported.length - 1) / 2] : (reported[reported.length / 2 - 1] + reported[reported.length / 2]) / 2;
    return { usd: round4(m), basis: "estimate", note: `median of ${reported.length} reported ${model} call(s) in this project` };
  }
  if (quality !== "high") return null;
  return { usd: S.ESTIMATES.imageUsd, basis: "table", note: "OpenRouter price of one high-quality GPT Image 2.6 image from earlier seed rounds — no reported price in this project yet" };
}

function reportedCost(usage) {
  const usd = Number(usage?.cost);
  return Number.isFinite(usd) && usd >= 0 ? { usd: round4(usd), basis: "reported", note: "OpenRouter usage.cost for this call" } : undefined;
}

function costText(cost) {
  return cost && Number.isFinite(cost.usd) ? `≈ ${money(cost.usd)} (${cost.basis})` : "unpriced";
}

async function projectCostLine(ws) {
  if (!existsSync(ws.project)) return "project: no calls yet";
  const { craft, io } = await craftModules();
  const c = craft.summarizeCosts(io.loadProject(ws.project, { sidecarKey: S.SIDECAR_KEY }));
  const extra = [
    c.unpriced.length ? `${c.unpriced.length} unpriced` : null,
    c.uncertain.length ? `${c.uncertain.length} failed with billing unknown` : null,
    c.inFlight.length ? `${c.inFlight.length} in flight` : null,
  ].filter(Boolean);
  return `project total ≈ ${money(c.total)} over ${c.calls} call(s)${extra.length ? ` (${extra.join(", ")})` : ""}`;
}

/**
 * One cancellation for a whole paid command. The first SIGINT / SIGTERM
 * aborts every call in flight (runRegistered records each as failed, billing
 * unknown) and nothing new is reserved or sent after it; a second signal
 * exits 130 at once. runRegistered's own per-call handlers are off
 * (`handleSignals: false`), so this scope keeps that contract: per-call
 * handlers would be gone between calls, and a fresh call would start with a
 * fresh signal.
 */
function interruptScope() {
  const controller = new AbortController();
  let by = null;
  const handlers = ["SIGINT", "SIGTERM"].map((name) => {
    const handler = () => {
      if (by) process.exit(130);
      by = name;
      note(`${name}: cancelling the calls in flight; nothing new is sent (a second ${name} exits at once)`);
      controller.abort(new DOMException(`received ${name}`, "AbortError"));
    };
    process.on(name, handler);
    return [name, handler];
  });
  return {
    signal: controller.signal,
    get by() {
      return by;
    },
    dispose() {
      for (const [name, handler] of handlers) process.off(name, handler);
    },
  };
}

/** After an interrupt: say what was cancelled and what never started, and exit 130. */
function reportInterrupt(scope, rows, notStarted) {
  if (!scope.by) return null;
  process.exitCode = 130;
  const cancelled = rows.filter((r) => r && !r.ok && r.interrupted).map((r) => r.id);
  const line = `interrupted by ${scope.by}: ${cancelled.length ? `${cancelled.join(", ")} cancelled — recorded as failed, billing unknown (it may have been charged)` : "nothing was in flight"}; ${notStarted}`;
  note(line);
  return line;
}

/**
 * One registered paid call under the command's interrupt scope. Returns a
 * row; a failed or interrupted call is reported and sets the exit code.
 */
async function runPaid(ws, now, scope, { reserve, call, updateSidecar }) {
  const { io } = await craftModules();
  const started = Date.now();
  const outcome = await io.runRegistered({
    path: ws.project, sidecarKey: S.SIDECAR_KEY, reserve, call, now,
    signal: scope.signal, handleSignals: false,
    updateSidecar: (d, phase) => {
      updateSidecar?.(d, phase);
      tidy(d);
    },
  });
  const seconds = Math.round((Date.now() - started) / 100) / 10;
  const cost = outcome.edge?.operation?.params?.cost ?? null;
  if (outcome.ok) {
    note(`cost: ${outcome.asset.id} ${costText(cost)}${cost?.note ? ` — ${cost.note}` : ""}`);
    return { id: outcome.asset.id, ok: true, status: "ready", uri: outcome.asset.uri, cost, seconds, warning: outcome.warning, sidecarError: outcome.sidecarError };
  }
  const interrupted = scope.by ?? outcome.interrupted ?? null;
  const exitCode = interrupted ? 130 : outcome.exitCode;
  note(`ERROR: ${outcome.asset.id} failed: ${outcome.reason} (billing: ${outcome.billing})`);
  note(`cost: ${outcome.asset.id} ${outcome.billing === "none" ? "not billed (the request never left)" : `${costText(cost)} — may have been billed`}`);
  process.exitCode = Math.max(process.exitCode ?? 0, exitCode);
  return { id: outcome.asset.id, ok: false, status: "failed", reason: outcome.reason, billing: outcome.billing, cost, seconds, interrupted, exitCode };
}

/**
 * Run `tasks` with at most `limit` in flight; a failure does not stop the
 * others. Once `signal` aborts, nothing more is dequeued: a task that never
 * started leaves `undefined` in its slot.
 */
async function pool(tasks, limit, signal) {
  const results = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length && !signal?.aborted) {
      const i = next;
      next += 1;
      results[i] = await tasks[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

function paidLines(rows) {
  return rows.map((r) => (r.ok
    ? `  ${r.id} ready → ${r.uri} · ${r.seconds} s · ${costText(r.cost)}${r.detail ? ` · ${r.detail}` : ""}${r.warning ? ` · WARN: ${r.warning}` : ""}`
    : `  ${r.id} FAILED after ${r.seconds} s — ${r.reason} (billing ${r.billing})`));
}

// ---------------------------------------------------------------------------
// Registering local files (uploads, measurements)
// ---------------------------------------------------------------------------

function extOf(file, fallback) {
  return extname(file).toLowerCase() || fallback;
}

/** Place a copy of `source` at `relTarget`, never over an existing file. */
async function placeCopy(ws, source, relTarget) {
  const abs = resolve(source);
  if (!existsSync(abs) || !statSync(abs).isFile()) fail(`--file: ${source} does not exist`);
  const { writeNewFile } = await generators();
  try {
    writeNewFile(ws.abs(relTarget), readFileSync(abs));
  } catch (error) {
    fail(`could not place ${source} at ${relTarget}: ${errorMessage(error)}`);
  }
  return relTarget;
}

/** Reserve + probe + land one local file, and run `mutate` in the same write. */
async function registerLocal(ws, pack, spec, now, mutate) {
  const { craft, io } = await craftModules();
  await ensureProject(ws, pack);
  const doc = io.loadProject(ws.project, { sidecarKey: S.SIDECAR_KEY });
  craft.reserveAsset(doc, { ...spec, generating: false }, now());
  const { metadata, warning } = io.probeMedia(ws.abs(spec.uri), spec.type);
  if (warning) note(`WARN: ${spec.id}: ${warning}`);
  const record = craft.landAsset(doc, { id: spec.id, uri: spec.uri, metadata }, now());
  mutate?.(doc, record);
  tidy(doc);
  io.saveProject(ws.project, doc);
  return record;
}

/** A take's measurement: full when ffmpeg can decode it, structural otherwise. */
function measureTakeSafely(abs) {
  try {
    const { measure, note: why } = media.measureTake(abs);
    if (why) note(`WARN: ${why}`);
    return measure;
  } catch (error) {
    note(`WARN: ${basename(abs)}: the pixel measurement failed (${errorMessage(error)}) — recorded from the file's structure only`);
    return media.measureTake(abs, { pixels: false }).measure;
  }
}

function measureStillSafely(abs) {
  if (!media.hasTool("ffprobe") || !media.hasTool("ffmpeg")) return null;
  try {
    return media.measureStill(abs);
  } catch (error) {
    note(`WARN: ${basename(abs)}: not measured (${errorMessage(error)})`);
    return null;
  }
}

function takeDetail(m) {
  if (!m) return null;
  return `${m.frames} frames ${m.width}×${m.height} · ${kb(m.bytes)}${m.alpha ? ` · ${m.alpha.semi === 0 ? "1-bit alpha" : `${Math.round(m.alpha.semi * 1000) / 10}% semi-transparent`}` : ""}`;
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

function keyReport(gen) {
  return { fal: Boolean(gen.falKey()), openrouter: Boolean(gen.imageKey()) };
}

function keyLine(keys) {
  const missing = [];
  if (!keys.fal) missing.push("FAL_KEY missing: sticker takes cannot be generated here (prompts + import still work)");
  if (!keys.openrouter) missing.push("OPENROUTER_API_KEY missing: character and art cannot be generated here (prompts + import still work)");
  return missing.length ? `keys: ${missing.join("; ")}` : "keys: fal and OpenRouter found";
}

function toolLine() {
  const missing = ["ffmpeg", "ffprobe"].filter((t) => !media.hasTool(t));
  return missing.length ? `ffmpeg/ffprobe: MISSING ${missing.join(" and ")} — landing, inspect and export need them (macOS: brew install ffmpeg)` : "ffmpeg/ffprobe: found";
}

async function cmdStatus(v) {
  const ws = workspace(v);
  const pack = loadPack(ws);
  const doc = await loadProjectOrNull(ws);
  const gen = await generators();
  const keys = keyReport(gen);
  const states = S.stickerStates(pack, doc);
  const anchor = S.anchorState(pack, doc);
  const exports = Object.fromEntries(pack.platforms.map((p) => [p, S.exportState(pack, doc, p)]));
  const checks = Object.fromEntries(pack.platforms.map((p) => [p, S.tally(S.checkPack(pack, doc, p))]));
  const next = S.nextStep(pack, doc);
  let costs = null;
  if (doc) {
    const { craft } = await craftModules();
    const c = craft.summarizeCosts(doc);
    costs = { total: c.total, calls: c.calls, unpriced: c.unpriced, uncertain: c.uncertain, inFlight: c.inFlight };
  }
  const needed = neededArt(pack);
  const art = needed.map((kind) => {
    const candidates = S.artAssets(doc, kind);
    return { kind, picked: pack.art[kind] ?? null, ready: candidates.filter((a) => S.assetStatus(a) === "ready").map((a) => a.id) };
  });
  const payload = {
    command: "status",
    rights: pack.rights,
    platforms: pack.platforms,
    keys,
    tools: { ffmpeg: media.hasTool("ffmpeg"), ffprobe: media.hasTool("ffprobe") },
    anchor,
    stickers: states.map((s) => ({ id: s.id, status: s.status, reason: s.reason, picked: s.picked, takes: s.takes })),
    art,
    exports: Object.fromEntries(Object.entries(exports).map(([p, e]) => [p, { items: e.items.map((i) => ({ deliverable: i.deliverable, state: i.state, reason: i.reason })), archive: e.archive.state }])),
    checks,
    costs,
    next,
  };
  const word = (s) => pack.stickers.find((x) => x.id === s.id);
  emit(v, payload, [
    `pack: ${packTitle(pack)} · ${pack.stickers.length} sticker(s) · ${pack.platforms.join(", ")}`,
    `rights: ${pack.rights ? `${pack.rights.basis}, confirmed ${pack.rights.confirmedAt}` : "NOT RECORDED — paid steps refuse until rights is in pack.json"}`,
    keyLine(keys),
    toolLine(),
    `character: ${anchor.ready ? `anchor ${anchor.anchor}` : anchor.reason}`,
    "stickers:",
    ...states.map((s) => `  ${s.id} ${word(s).word || "—"}${word(s).caption && word(s).caption !== word(s).word ? ` "${word(s).caption}"` : ""} · ${s.status}${s.picked ? ` (${s.picked})` : ""}${s.reason && s.status !== "ready" ? ` — ${s.reason}` : ""}`),
    needed.length ? `art: ${art.map((a) => `${a.kind} ${a.picked ? `picked ${a.picked}` : a.ready.length ? `${a.ready.length} to pick` : "none"}`).join(" · ")}` : null,
    ...pack.platforms.map((p) => {
      const e = exports[p];
      const count = (state) => e.items.filter((i) => i.state === state).length;
      return `${S.PLATFORM_PROFILES[p].label}: exports ${count("current")} current, ${count("stale")} stale, ${count("missing")} missing, ${count("blocked")} blocked · archive ${e.archive.state} · checks ${checks[p].pass} pass / ${checks[p].warn} warn / ${checks[p].fail} fail`;
    }),
    costs ? `cost: ${await projectCostLine(ws)}` : "cost: no calls yet",
    `next: ${next.line}${next.command ? ` → ${next.command}` : ""}`,
  ]);
}

// ---------------------------------------------------------------------------
// quote
// ---------------------------------------------------------------------------

/** Art kinds the chosen platforms derive deliverables from. */
function neededArt(pack) {
  const kinds = new Set();
  for (const platform of pack.platforms) {
    for (const item of S.platformDeliverables(pack, platform)) if (item.kind === "art") kinds.add(item.art);
  }
  return S.ART_KINDS.filter((k) => kinds.has(k));
}

/** gen's targets: `S.genTargets` (shared with quote and nextStep), with the stickers and their states. */
function stickerTargets(pack, doc, v) {
  let plan;
  try {
    plan = S.genTargets(pack, doc, { only: listFlag(v.only), redo: Boolean(v.redo) });
  } catch (error) {
    fail(errorMessage(error));
  }
  const targets = plan.targets.map((t) => ({ sticker: pack.stickers.find((s) => s.id === t.id), state: S.stickerState(pack, doc, t.id) }));
  return { targets, skipped: plan.skipped, uncertain: plan.uncertain };
}

/** One line for the stickers a plain gen leaves because their last call may have been billed. */
function uncertainLine(uncertain) {
  if (!uncertain.length) return null;
  const ids = uncertain.map((u) => u.id).join(",");
  return `not sent again: ${uncertain.map((u) => `${u.id} (${u.take} failed, billing unknown: ${u.reason})`).join("; ")} — it may have been charged. Retry only with the user's yes: sticker.mjs gen --only ${ids} (or --redo)`;
}

function artTargets(pack, doc, v) {
  const only = listFlag(v.only);
  for (const k of only) if (!S.ART_KINDS.includes(k)) fail(`--only: '${k}' is not an art kind (${S.ART_KINDS.join(", ")})`);
  const kinds = only.length ? only : neededArt(pack);
  const out = [];
  const skipped = [];
  for (const kind of kinds) {
    const ready = S.artAssets(doc, kind).filter((a) => S.assetStatus(a) === "ready");
    if (v.redo || !ready.length) out.push(kind);
    else skipped.push({ kind, ready: ready.map((a) => a.id) });
  }
  return { kinds: out, skipped };
}

function wallSeconds(count, perCall, concurrency) {
  return Math.ceil(count / Math.max(1, concurrency)) * perCall;
}

async function cmdQuote(v) {
  const ws = workspace(v);
  const pack = loadPack(ws);
  const doc = await loadProjectOrNull(ws);
  const gen = await generators();
  const concurrency = parseNumber(v.concurrency, "--concurrency", { integer: true, min: 1, max: 8 }) ?? 4;
  const quality = v.quality ?? "high";
  const model = gen.resolveImageModel(v.model ?? "flare");
  const lines = [];
  const items = [];
  if (v.character) {
    const count = parseNumber(v.count, "--count", { integer: true, min: 1, max: 4 }) ?? 1;
    const est = imageEstimate(doc, model, quality);
    items.push({ step: "character", count, each: est, seconds: S.ESTIMATES.imageSeconds });
    lines.push(`character: ${count} image(s) × ${costText(est)} · ${S.ESTIMATES.imageSeconds[0]}–${S.ESTIMATES.imageSeconds[1]} s each (OpenRouter, ${model})`);
  } else if (v.art) {
    const { kinds, skipped } = artTargets(pack, doc, v);
    const est = imageEstimate(doc, model, quality);
    items.push({ step: "art", count: kinds.length, kinds, each: est, seconds: S.ESTIMATES.imageSeconds });
    lines.push(`art: ${kinds.length ? kinds.join(", ") : "nothing missing"} — ${kinds.length} image(s) × ${costText(est)} · ${S.ESTIMATES.imageSeconds[0]}–${S.ESTIMATES.imageSeconds[1]} s each (OpenRouter, ${model})${skipped.length ? ` · already made: ${skipped.map((s) => s.kind).join(", ")}` : ""}`);
  } else {
    const { targets, skipped, uncertain } = stickerTargets(pack, doc, v);
    const est = gifEstimate();
    const m = pack.motion;
    items.push({ step: "stickers", count: targets.length, stickers: targets.map((t) => t.sticker.id), uncertain, each: est, seconds: S.ESTIMATES.gifSeconds });
    lines.push(`stickers: ${targets.length ? targets.map((t) => t.sticker.id).join(", ") : "nothing missing"} — ${targets.length} GIF take(s) of ${m.frames} × ${m.size}² at ${m.frameMs} ms × ${costText(est)}; range $${S.ESTIMATES.gifRangeUsd[0]}–${S.ESTIMATES.gifRangeUsd[1]} each`);
    if (targets.length) lines.push(`time: ≈ ${S.ESTIMATES.gifSeconds} s per take, ${concurrency} at a time → ≈ ${wallSeconds(targets.length, S.ESTIMATES.gifSeconds, concurrency)} s`);
    if (skipped.length) lines.push(`skipped (already have takes; --redo re-rolls): ${skipped.map((s) => `${s.id} ${s.status}`).join(", ")}`);
    if (uncertain.length) lines.push(uncertainLine(uncertain));
  }
  const total = items.reduce((sum, i) => sum + (Number.isFinite(i.each?.usd) ? i.each.usd * i.count : 0), 0);
  const unpriced = items.some((i) => i.count && !Number.isFinite(i.each?.usd));
  lines.push(`total: ≈ ${money(round4(total))}${unpriced ? " plus unpriced calls" : ""} — nothing is sent by quote${pack.rights ? "" : " · NOTE: rights is not recorded, so the paid commands will refuse"}`);
  emit(v, { command: "quote", items, totalUsd: round4(total), unpriced, rights: Boolean(pack.rights) }, lines);
}

// ---------------------------------------------------------------------------
// prompts
// ---------------------------------------------------------------------------

async function cmdPrompts(v) {
  const ws = workspace(v);
  const pack = loadPack(ws);
  const doc = await loadProjectOrNull(ws);
  const anchor = S.anchorState(pack, doc);
  const anchorFile = anchor.ready ? assetById(doc, anchor.anchor).uri : null;
  const payload = { command: "prompts" };
  const lines = [];
  if (v.character) {
    const sources = S.characterAssets(doc).sources.filter((a) => S.assetStatus(a) === "ready");
    const prompt = S.characterPrompt(pack, { fromImage: sources.length > 0 });
    payload.character = { prompt, attach: sources.map((a) => a.uri), background: "transparent", import: "sticker.mjs import --character --file <image>" };
    lines.push("character:", `  attach: ${sources.length ? sources.map((a) => a.uri).join(", ") : "nothing (designed from the description)"}`, `  prompt: ${prompt}`, "  then: sticker.mjs import --character --file <image>");
  } else if (v.art) {
    const only = listFlag(v.only);
    const kinds = only.length ? only : neededArt(pack);
    payload.art = kinds.map((kind) => ({ kind, ...S.artPrompt(pack, kind), attach: anchorFile, import: `sticker.mjs import --art ${kind} --file <image>` }));
    for (const a of payload.art) lines.push(`${a.kind} (${a.aspectRatio}, ${a.background}):`, `  attach: ${anchorFile ?? "the character anchor (none picked yet)"}`, `  prompt: ${a.prompt}`, `  then: ${a.import}`);
  } else {
    const only = listFlag(v.only);
    for (const id of only) if (!pack.stickers.some((s) => s.id === id)) fail(`--only: no sticker '${id}' in pack.json`);
    const request = S.stickerRequest(pack);
    payload.request = request;
    payload.attach = anchorFile;
    payload.stickers = pack.stickers.filter((s) => !only.length || only.includes(s.id)).map((s) => ({
      id: s.id, word: s.word, caption: s.caption, prompt: S.stickerPrompt(pack, s), import: `sticker.mjs import --sticker ${s.id} --file <gif>`,
    }));
    lines.push(
      `every take: ${request.frames} frames of ${request.size}×${request.size} at ${request.frameMs} ms, ${request.background} background, attach ${anchorFile ?? "the character anchor (none picked yet)"}`,
      ...payload.stickers.flatMap((s) => [`${s.id} ${s.word}:`, `  ${s.prompt}`, `  then: ${s.import}`]),
    );
  }
  emit(v, payload, lines);
}

// ---------------------------------------------------------------------------
// character
// ---------------------------------------------------------------------------

/** A source image for the character: an existing `character-source-<n>` id, or a file registered as one. */
async function characterSource(ws, pack, now, from) {
  const existing = await loadProjectOrNull(ws);
  if (/^character-source-\d+$/.test(from)) {
    const asset = assetById(existing, from);
    if (S.assetStatus(asset) !== "ready") fail(`--from ${from} is ${S.assetStatus(asset) ?? "not in project.json"}`);
    return asset;
  }
  const doc = existing ?? await ensureProject(ws, pack);
  const n = nextFree(doc, "character-source-", (k) => ws.abs(S.paths.characterSource(k, extOf(from, ".png"))));
  const id = S.ids.characterSource(n);
  const uri = await placeCopy(ws, from, S.paths.characterSource(n, extOf(from, ".png")));
  const record = await registerLocal(ws, pack, { id, type: "image", name: `Character source ${n}`, op: "upload", uri, params: { file: basename(from) } }, now);
  note(`registered ${uri} as ${id} (upload)`);
  return record.asset;
}

async function cmdCharacter(v) {
  const ws = workspace(v);
  const now = nowFrom(v);
  const pack = loadPack(ws);
  const gen = await generators();
  const count = parseNumber(v.count, "--count", { integer: true, min: 1, max: 4 }) ?? 1;
  const model = gen.resolveImageModel(v.model ?? "flare");
  const quality = v.quality ?? "high";
  if (!v.from && !pack.character.description.trim()) fail("character needs --from <image> (the user's photo or drawing) or character.description in pack.json to design from");
  requireRights(pack, "character");
  const fromImage = Boolean(v.from);
  const prompt = S.characterPrompt(pack, { fromImage });
  if (v["dry-run"]) {
    const body = gen.buildImageRequest({ prompt, model, numImages: 1, aspectRatio: "1:1", quality, background: "transparent", imageUrls: [] });
    emit(v, { command: "character", dryRun: true, count, body: { ...body, ...(fromImage ? { input_references: [`<${v.from}>`] } : {}) }, cost: imageEstimate(await loadProjectOrNull(ws), model, quality) }, [
      "dry run — nothing sent, nothing recorded",
      `${count} × ${JSON.stringify({ ...body, ...(fromImage ? { input_references: [`<${v.from}>`] } : {}) })}`,
    ]);
    return;
  }
  const apiKey = gen.imageKey();
  if (!apiKey) fail(noKey("openrouter"));
  const source = fromImage ? await characterSource(ws, pack, now, v.from) : null;
  await ensureProject(ws, pack);
  const rows = [];
  const scope = interruptScope();
  try {
    for (let i = 0; i < count && !scope.signal.aborted; i += 1) {
      rows.push(await characterCandidate(ws, now, scope, gen, { source, model, quality, prompt, apiKey }));
    }
  } finally {
    scope.dispose();
  }
  const notStarted = count - rows.length;
  const stopped = reportInterrupt(scope, rows, `${notStarted} candidate(s) never started (nothing sent)`);
  const lines = ["character candidates:", ...paidLines(rows), stopped];
  if (rows.some((r) => r.ok)) lines.push(`next: look at them, then set character.anchor in pack.json (e.g. "${rows.find((r) => r.ok).id}")`);
  lines.push(`cost: ${await projectCostLine(ws)}`);
  emit(v, { command: "character", source: source?.id ?? null, results: rows, interrupted: scope.by, notStarted }, lines);
}

/** One character candidate: the next free id, generated and registered. */
async function characterCandidate(ws, now, scope, gen, { source, model, quality, prompt, apiKey }) {
  const doc = await loadProjectOrNull(ws);
  const n = nextFree(doc, "character-", (k) => ws.abs(S.paths.character(k)));
  const id = S.ids.character(n);
  const planned = S.paths.character(n);
  let measured = null;
  return runPaid(ws, now, scope, {
    reserve: {
      id, type: "image", name: `Character ${n}`, op: "generate", uri: planned,
      ...(source ? { from: [source.id] } : {}),
      model, prompt, provider: "openrouter",
      params: { request: { aspectRatio: "1:1", quality, background: "transparent" } },
      ...(imageEstimate(doc, model, quality) ? { cost: imageEstimate(doc, model, quality) } : {}),
    },
    call: async ({ signal }) => {
      const out = await generateImageInto(ws, gen, {
        prompt, model, quality, aspectRatio: "1:1", background: "transparent", apiKey, signal,
        imageUrls: source ? [ws.abs(source.uri)] : [],
      }, (ext) => S.paths.character(n, ext));
      measured = measureStillSafely(ws.abs(out.rel));
      return { file: ws.abs(out.rel), cost: reportedCost(out.usage) };
    },
    updateSidecar: (d, phase) => {
      if (phase === "land" && measured) sidecar(d).measures[id] = { ...measured, at: now() };
    },
  });
}

/**
 * One OpenRouter image, written beside nothing: generated into a scratch
 * directory, then placed at its slot path with no-clobber semantics, named
 * by the format that actually came back.
 */
async function generateImageInto(ws, gen, options, pathFor) {
  const scratch = mkdtempSync(join(tmpdir(), "sticker-image-"));
  try {
    const out = await gen.generateImage({ ...options, numImages: 1, outputFormat: "png", outputDir: scratch, filenamePrefix: "image" });
    const file = out.files?.[0];
    if (!file || !existsSync(file)) throw new Error("the image call returned no file");
    const rel = pathFor(extOf(file, ".png") === ".jpeg" ? ".jpg" : extOf(file, ".png"));
    gen.writeNewFile(ws.abs(rel), readFileSync(file));
    if (options.background === "transparent" && out.hasAlpha === false) note(`WARN: ${rel} came back without an alpha channel although transparent was asked for`);
    return { rel, usage: out.usage };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// gen
// ---------------------------------------------------------------------------

/**
 * Mark an in-flight take failed so a new one can start (`gen --redo`): the
 * earlier request's outcome and billing are unknown, and stay counted.
 */
async function supersede(ws, now, takeIds) {
  if (!takeIds.length) return;
  const { craft, io } = await craftModules();
  const doc = io.loadProject(ws.project, { sidecarKey: S.SIDECAR_KEY });
  for (const id of takeIds) {
    craft.failAsset(doc, { id, reason: "superseded by gen --redo while still in flight — whether its request ran or was billed is not on record", billing: "unknown" }, now());
    note(`WARN: ${id} was still in flight; recorded as failed (billing unknown) and superseded`);
  }
  tidy(doc);
  io.saveProject(ws.project, doc);
}

async function cmdGen(v) {
  if (v.art) return cmdGenArt(v);
  const ws = workspace(v);
  const now = nowFrom(v);
  const pack = loadPack(ws);
  requireRights(pack, "gen");
  const gen = await generators();
  const concurrency = parseNumber(v.concurrency, "--concurrency", { integer: true, min: 1, max: 8 }) ?? 4;
  const deadlineMs = (parseNumber(v["deadline-s"], "--deadline-s", { min: 30, max: 3600 }) ?? 600) * 1000;
  let doc = await loadProjectOrNull(ws);
  const anchor = requireAnchor(ws, pack, doc);
  const { targets, skipped, uncertain } = stickerTargets(pack, doc, v);
  for (const s of skipped) note(`skip ${s.id}: ${s.status}${s.status === "generating" ? " (another take is in flight; --redo supersedes it)" : " — already has takes; --redo re-rolls"}`);
  if (uncertain.length) note(uncertainLine(uncertain));
  if (!targets.length) {
    emit(v, { command: "gen", results: [], skipped, uncertain }, [uncertain.length
      ? `nothing generated — ${uncertain.map((u) => u.id).join(", ")} may already have been charged; see above`
      : "nothing to generate — every chosen sticker already has takes (--redo re-rolls)"]);
    return;
  }
  const request = S.stickerRequest(pack);
  const gifOptions = (sticker, output) => ({
    prompt: S.stickerPrompt(pack, sticker), output, model: request.model, imageUrls: [anchor.file],
    frameCount: request.frames, frameDurationMs: request.frameMs, imageSize: `${request.size}x${request.size}`,
    quality: request.quality, background: request.background,
  });
  // Every refusal that needs no key and no network comes first (fal's limits, the prompt length).
  for (const t of targets) gen.buildGifRequest({ ...gifOptions(t.sticker, join(tmpdir(), `sticker-check-${process.pid}-${t.sticker.id}.gif`)) });
  if (v["dry-run"]) {
    const requests = targets.map((t) => {
      const r = gen.buildGifRequest(gifOptions(t.sticker, join(tmpdir(), `sticker-dry-${process.pid}.gif`)));
      return { sticker: t.sticker.id, url: r.url, model: r.model, body: { ...r.body, image_urls: [`<${ws.rel(anchor.file)}>`] }, cost: gifEstimate() };
    });
    emit(v, { command: "gen", dryRun: true, requests }, ["dry run — nothing sent, nothing recorded", ...requests.map((r) => `${r.sticker}: ${r.url} ${JSON.stringify(r.body)} · ${costText(r.cost)}`)]);
    return;
  }
  const apiKey = gen.falKey();
  if (!apiKey) fail(noKey("fal"));
  doc = await ensureProject(ws, pack);
  if (v.redo) await supersede(ws, now, targets.flatMap((t) => t.state.inFlight));
  note(`gen: ${targets.length} take(s), ${Math.min(concurrency, targets.length)} at a time · each ${costText(gifEstimate())} · ≈ ${S.ESTIMATES.gifSeconds} s each`);

  // Ids are claimed up front, in pack order, against one read.
  doc = await loadProjectOrNull(ws);
  const plan = targets.map(({ sticker }) => {
    const n = nextFree(doc, `${sticker.id}-take-`, (k) => ws.abs(S.paths.take(sticker.id, k)));
    return { sticker, n, id: S.ids.take(sticker.id, n), uri: S.paths.take(sticker.id, n) };
  });
  const scope = interruptScope();
  const tasks = plan.map((p) => async () => {
    let measured = null;
    const options = gifOptions(p.sticker, ws.abs(p.uri));
    const row = await runPaid(ws, now, scope, {
      reserve: {
        id: p.id, type: "image", name: `${p.sticker.id} ${p.sticker.word || ""} take ${p.n}`.replace(/\s+/g, " ").trim(), op: "generate", uri: p.uri,
        from: [anchor.id], model: gen.gifModelId(request.model), prompt: options.prompt, provider: "fal",
        params: { sticker: p.sticker.id, request, promptInputs: S.stickerPromptInputs(pack, p.sticker) },
        cost: gifEstimate(),
      },
      call: async ({ signal }) => {
        mkdirSync(dirname(ws.abs(p.uri)), { recursive: true });
        const result = await gen.generateGif({ ...options, apiKey, signal, deadlineMs, onStatus: ({ status }) => note(`[${p.id}] fal ${status}`) });
        measured = measureTakeSafely(ws.abs(p.uri));
        return { file: ws.abs(p.uri), requestId: result.requestId };
      },
      updateSidecar: (d, phase) => {
        if (phase === "land" && measured) sidecar(d).measures[p.id] = { ...measured, at: now() };
      },
    });
    return { sticker: p.sticker.id, ...row, detail: takeDetail(measured) };
  });
  let ran;
  try {
    ran = await pool(tasks, concurrency, scope.signal);
  } finally {
    scope.dispose();
  }
  const rows = ran.filter(Boolean);
  const notStarted = plan.filter((_, i) => !ran[i]).map((p) => p.sticker.id);
  const stopped = reportInterrupt(scope, rows, notStarted.length ? `never started (nothing sent): ${notStarted.join(", ")}` : "every take had started");
  const landed = rows.filter((r) => r.ok).length;
  const after = await loadProjectOrNull(ws);
  const next = S.nextStep(pack, after);
  emit(v, { command: "gen", results: rows, skipped, uncertain, interrupted: scope.by, notStarted, next }, [
    `takes: ${landed} of ${rows.length} landed`,
    ...paidLines(rows),
    stopped,
    `cost: this run ${rows.length} call(s) ≈ ${money(round4(rows.reduce((s, r) => s + (r.billing === "none" ? 0 : r.cost?.usd ?? 0), 0)))} (estimate — fal reports no usage for GIF jobs) · ${await projectCostLine(ws)}`,
    `look before picking: sticker.mjs inspect <id> · next: ${next.line}`,
  ]);
}

async function cmdGenArt(v) {
  const ws = workspace(v);
  const now = nowFrom(v);
  const pack = loadPack(ws);
  requireRights(pack, "gen --art");
  const gen = await generators();
  const model = gen.resolveImageModel(v.model ?? "flare");
  const quality = v.quality ?? "high";
  const concurrency = parseNumber(v.concurrency, "--concurrency", { integer: true, min: 1, max: 8 }) ?? 4;
  let doc = await loadProjectOrNull(ws);
  const anchor = requireAnchor(ws, pack, doc);
  const { kinds, skipped } = artTargets(pack, doc, v);
  for (const s of skipped) note(`skip ${s.kind}: already made (${s.ready.join(", ")}); --redo makes another`);
  if (!kinds.length) {
    emit(v, { command: "gen", art: true, results: [], skipped }, ["nothing to generate — every needed art kind has a ready candidate (--redo makes another)"]);
    return;
  }
  if (v["dry-run"]) {
    const requests = kinds.map((kind) => {
      const a = S.artPrompt(pack, kind);
      const body = gen.buildImageRequest({ prompt: a.prompt, model, numImages: 1, aspectRatio: a.aspectRatio, quality, background: a.background, imageUrls: [] });
      return { kind, body: { ...body, input_references: [`<${ws.rel(anchor.file)}>`] }, cost: imageEstimate(doc, model, quality) };
    });
    emit(v, { command: "gen", art: true, dryRun: true, requests }, ["dry run — nothing sent, nothing recorded", ...requests.map((r) => `${r.kind}: ${JSON.stringify(r.body)} · ${costText(r.cost)}`)]);
    return;
  }
  const apiKey = gen.imageKey();
  if (!apiKey) fail(noKey("openrouter"));
  doc = await ensureProject(ws, pack);
  const plan = kinds.map((kind) => {
    const n = nextFree(doc, `art-${kind}-`, (k) => ws.abs(S.paths.art(kind, k)));
    return { kind, n, id: S.ids.art(kind, n), uri: S.paths.art(kind, n), ...S.artPrompt(pack, kind) };
  });
  const scope = interruptScope();
  const tasks = plan.map((p) => async () => {
    let measured = null;
    const estimate = imageEstimate(doc, model, quality);
    const row = await runPaid(ws, now, scope, {
      reserve: {
        id: p.id, type: "image", name: `${p.kind} art ${p.n}`, op: "generate", uri: p.uri, from: [anchor.id],
        model, prompt: p.prompt, provider: "openrouter",
        params: { art: p.kind, request: { aspectRatio: p.aspectRatio, quality, background: p.background } },
        ...(estimate ? { cost: estimate } : {}),
      },
      call: async ({ signal }) => {
        const out = await generateImageInto(ws, gen, { prompt: p.prompt, model, quality, aspectRatio: p.aspectRatio, background: p.background, apiKey, signal, imageUrls: [anchor.file] }, (ext) => S.paths.art(p.kind, p.n, ext));
        measured = measureStillSafely(ws.abs(out.rel));
        return { file: ws.abs(out.rel), cost: reportedCost(out.usage) };
      },
      updateSidecar: (d, phase) => {
        if (phase === "land" && measured) sidecar(d).measures[p.id] = { ...measured, at: now() };
      },
    });
    return { kind: p.kind, ...row };
  });
  let ran;
  try {
    ran = await pool(tasks, concurrency, scope.signal);
  } finally {
    scope.dispose();
  }
  const rows = ran.filter(Boolean);
  const notStarted = plan.filter((_, i) => !ran[i]).map((p) => p.kind);
  const stopped = reportInterrupt(scope, rows, notStarted.length ? `never started (nothing sent): ${notStarted.join(", ")}` : "every image had started");
  emit(v, { command: "gen", art: true, results: rows, skipped, interrupted: scope.by, notStarted }, [
    "art:",
    ...paidLines(rows),
    stopped,
    rows.some((r) => r.ok) ? "next: look at them, then set art.<kind> in pack.json to the one to use" : null,
    `cost: ${await projectCostLine(ws)}`,
  ]);
}

// ---------------------------------------------------------------------------
// import
// ---------------------------------------------------------------------------

async function cmdImport(v) {
  const ws = workspace(v);
  const now = nowFrom(v);
  const pack = loadPack(ws);
  if (!v.file) fail("import needs --file <path>");
  const chosen = [v.sticker ? "sticker" : null, v.art ? "art" : null, v.character ? "character" : null, v.source ? "source" : null].filter(Boolean);
  if (chosen.length !== 1) fail("import takes exactly one of --sticker <id>, --art <kind>, --character, --source");
  const doc = await ensureProject(ws, pack);

  if (v.sticker) {
    const sticker = pack.stickers.find((s) => s.id === v.sticker);
    if (!sticker) fail(`--sticker: no sticker '${v.sticker}' in pack.json`);
    let info;
    try {
      info = media.readGifInfo(readFileSync(resolve(v.file)));
    } catch (error) {
      fail(`--file ${v.file} is not a usable GIF: ${errorMessage(error)}`);
    }
    if (info.frames < 2) fail(`--file ${v.file} holds ${info.frames} frame — a sticker take is animated`);
    const n = nextFree(doc, `${sticker.id}-take-`, (k) => ws.abs(S.paths.take(sticker.id, k)));
    const id = S.ids.take(sticker.id, n);
    const uri = await placeCopy(ws, v.file, S.paths.take(sticker.id, n));
    const measured = measureTakeSafely(ws.abs(uri));
    const anchor = pack.character.anchor && S.assetStatus(assetById(doc, pack.character.anchor)) === "ready" ? pack.character.anchor : null;
    await registerLocal(ws, pack, {
      id, type: "image", name: `${sticker.id} ${sticker.word || ""} take ${n}`.replace(/\s+/g, " ").trim(), op: "upload", uri,
      ...(anchor ? { from: [anchor] } : {}),
      prompt: S.stickerPrompt(pack, sticker),
      params: { sticker: sticker.id, request: { ...S.stickerRequest(pack), frames: info.frames }, promptInputs: S.stickerPromptInputs(pack, sticker), file: basename(v.file) },
    }, now, (d) => {
      sidecar(d).measures[id] = { ...measured, at: now() };
    });
    if (info.frames !== pack.motion.frames) note(`WARN: ${id} has ${info.frames} frames; pack motion asks for ${pack.motion.frames} — recorded as it is`);
    emit(v, { command: "import", id, uri, measure: measured }, [`registered ${uri} as ${id} (upload by human) · ${takeDetail(measured)}`, `pick it with stickers[].take = "${id}" in pack.json`]);
    return;
  }

  if (v.art) {
    if (!S.ART_KINDS.includes(v.art)) fail(`--art must be one of ${S.ART_KINDS.join(", ")} (got: ${v.art})`);
    const ext = extOf(v.file, ".png");
    const n = nextFree(doc, `art-${v.art}-`, (k) => ws.abs(S.paths.art(v.art, k, ext)));
    const id = S.ids.art(v.art, n);
    const uri = await placeCopy(ws, v.file, S.paths.art(v.art, n, ext));
    const measured = measureStillSafely(ws.abs(uri));
    await registerLocal(ws, pack, { id, type: "image", name: `${v.art} art ${n}`, op: "upload", uri, params: { art: v.art, file: basename(v.file) } }, now, (d) => {
      if (measured) sidecar(d).measures[id] = { ...measured, at: now() };
    });
    emit(v, { command: "import", id, uri }, [`registered ${uri} as ${id} (upload by human)`, `pick it with art.${v.art} = "${id}" in pack.json`]);
    return;
  }

  if (v.source) {
    const asset = await characterSource(ws, pack, now, v.file);
    emit(v, { command: "import", id: asset.id, uri: asset.uri }, [`source ${asset.id} → ${asset.uri}; make the character from it with: sticker.mjs character --from ${asset.id}`]);
    return;
  }

  const ext = extOf(v.file, ".png");
  const n = nextFree(doc, "character-", (k) => ws.abs(S.paths.character(k, ext)));
  const id = S.ids.character(n);
  const uri = await placeCopy(ws, v.file, S.paths.character(n, ext));
  const measured = measureStillSafely(ws.abs(uri));
  await registerLocal(ws, pack, { id, type: "image", name: `Character ${n}`, op: "upload", uri, params: { file: basename(v.file) } }, now, (d) => {
    if (measured) sidecar(d).measures[id] = { ...measured, at: now() };
  });
  emit(v, { command: "import", id, uri }, [`registered ${uri} as ${id} (upload by human)`, `use it with character.anchor = "${id}" in pack.json`]);
}

// ---------------------------------------------------------------------------
// inspect
// ---------------------------------------------------------------------------

async function cmdInspect(v, sidArg) {
  const ws = workspace(v);
  const pack = loadPack(ws);
  const doc = await loadProjectOrNull(ws);
  const sid = sidArg ?? v.sticker;
  if (!sid) fail("inspect needs a sticker id: sticker.mjs inspect s01 [--take s01-take-2]");
  if (!pack.stickers.some((s) => s.id === sid)) fail(`no sticker '${sid}' in pack.json`);
  const state = S.stickerState(pack, doc, sid);
  const takeId = v.take ?? state.effective ?? state.ready.at(-1);
  if (!takeId) fail(`${sid} has no ready take to inspect (${state.status})`);
  if (!takeId.startsWith(`${sid}-take-`)) fail(`--take ${takeId} is not a take of ${sid}`);
  const asset = assetById(doc, takeId);
  if (!asset?.uri || !existsSync(ws.abs(asset.uri))) fail(`${takeId} has no file on disk`);
  const file = ws.abs(asset.uri);
  const { measure } = media.measureTake(file);
  const out = S.paths.inspect(takeId);
  const sheet = media.contactSheet(file, ws.abs(out));
  const staleness = S.takeStaleness(pack, doc, takeId);
  const m = measure;
  const mo = m.motion;
  emit(v, { command: "inspect", sticker: sid, take: takeId, picked: state.picked === takeId, contactSheet: out, sheet, measure, stale: staleness }, [
    `${takeId}${state.picked === takeId ? " (picked)" : ""} · ${m.frames} frames ${m.width}×${m.height} · ${m.delaysMs.every((d) => d === m.delaysMs[0]) ? `${m.delaysMs[0]} ms each` : `delays ${m.delaysMs.join("/")} ms`} = ${(m.durationMs / 1000).toFixed(2)} s · ${kb(m.bytes)} · ${m.loopCount === 0 ? "loops forever" : m.loopCount === null ? "plays once" : `loops ${m.loopCount}×`}`,
    `alpha: ${Math.round(m.alpha.clear * 100)}% clear, ${m.alpha.semi === 0 ? "no semi-transparent pixels (1-bit)" : `${(m.alpha.semi * 100).toFixed(1)}% semi-transparent`}, corners ${m.alpha.cornersClear ? "clear" : "NOT clear"}`,
    `motion: mean step ${mo.mean} · loop seam ${mo.seam}${mo.seamRatio !== null ? ` (${mo.seamRatio}× the median step${mo.seamRatio > 2 ? " — the loop jumps" : ""})` : ""} · ground drift ${mo.groundDrift} px · size drift ${Math.round(mo.sizeDrift * 100)}%${mo.emptyFrames.length ? ` · EMPTY frames ${mo.emptyFrames.join(", ")}` : ""}${m.identical ? " · every frame identical" : ""}`,
    `first frame: ${Math.round(m.firstFrameCoverage * 100)}% of the median figure size (LINE shows it as the store still)`,
    staleness.stale ? `stale: ${staleness.reasons.join("; ")}` : "matches pack.json",
    `contact sheet (light and dark plates): ${out} — look at it`,
  ]);
}

// ---------------------------------------------------------------------------
// export
// ---------------------------------------------------------------------------

/** Files an export of `platform` may have written: removed when no deliverable claims them. */
function ownedExportFile(name) {
  return /^\d{2,3}\.(gif|webm|png)$/.test(name) || /^(cover|icon|banner|reward-guide|reward-thanks|thumb|main|tab)\.(png|jpg)$/.test(name);
}

function listingText(pack, platform) {
  const l = pack.listing[platform] ?? {};
  const profile = S.PLATFORM_PROFILES[platform];
  const items = S.platformDeliverables(pack, platform).filter((i) => i.kind === "sticker");
  const lines = [`# ${profile.label} listing`, ""];
  for (const [field, spec] of Object.entries(profile.text)) lines.push(`- ${spec.label}: ${l[field] ?? ""}`);
  lines.push("");
  if (platform === "wechat") {
    lines.push("## 含义词", "");
    items.forEach((i) => lines.push(`- ${i.name}.${i.ext}: ${pack.stickers.find((s) => s.id === i.sticker).word}`));
  } else if (platform === "telegram") {
    lines.push("## Emoji", "");
    items.forEach((i) => lines.push(`- ${i.name}.${i.ext}: ${pack.stickers.find((s) => s.id === i.sticker).emoji}`));
  } else {
    lines.push("## Stickers", "");
    items.forEach((i) => {
      const s = pack.stickers.find((x) => x.id === i.sticker);
      lines.push(`- ${i.name}.${i.ext}: ${s.caption || s.word}`);
    });
  }
  lines.push("");
  return lines.join("\n");
}

async function cmdExport(v) {
  const ws = workspace(v);
  const now = nowFrom(v);
  const pack = loadPack(ws);
  if (!media.hasTool("ffmpeg") || !media.hasTool("ffprobe")) fail(toolLine());
  const platforms = !v.platform || v.platform === "all" ? pack.platforms : [v.platform];
  for (const p of platforms) if (!S.PLATFORMS.includes(p)) fail(`--platform must be ${S.PLATFORMS.join(", ")} or all (got: ${p})`);
  await ensureProject(ws, pack);
  const sources = new Map();
  const frameSource = (asset) => {
    if (!sources.has(asset.id)) sources.set(asset.id, media.readGifFrames(ws.abs(asset.uri)));
    return sources.get(asset.id);
  };
  const report = {};
  for (const platform of platforms) {
    const profile = S.PLATFORM_PROFILES[platform];
    const doc0 = await loadProjectOrNull(ws);
    const state = S.exportState(pack, doc0, platform);
    const dir = S.paths.exportDir(platform);
    const made = [];
    const rows = [];
    for (const item of state.items) {
      const onDisk = item.file && existsSync(ws.abs(item.file)) && statSync(ws.abs(item.file)).size === item.measure?.bytes;
      if (item.state === "blocked") {
        rows.push({ deliverable: item.deliverable, state: "blocked", reason: item.reason, optional: Boolean(item.optional) });
        continue;
      }
      if (item.state === "current" && onDisk) {
        rows.push({ deliverable: item.deliverable, state: "current", file: item.file });
        continue;
      }
      const source = S.deliverableSource(pack, doc0, item).asset;
      const sticker = item.sticker ? pack.stickers.find((s) => s.id === item.sticker) : null;
      let out;
      try {
        if (item.kind === "sticker") out = media.exportSticker(platform, frameSource(source), sticker.keepFrames);
        else if (item.kind === "main") out = media.exportLineMain(frameSource(source), sticker.keepFrames);
        else out = media.exportStill(profile.deliverables[item.deliverable], ws.abs(source.uri));
      } catch (error) {
        rows.push({ deliverable: item.deliverable, state: "error", reason: errorMessage(error) });
        process.exitCode = 1;
        continue;
      }
      const rel = `${dir}/${item.name}.${out.ext}`;
      media.writeAtomic(ws.abs(rel), out.bytes);
      made.push({ item, rel, source, measure: { ...out.measure, key: item.key, at: now() } });
      if (!out.measure.fit.ok) {
        process.exitCode = 1;
        note(`ERROR: ${rel} is ${kb(out.measure.bytes)} after every size setting — over the ${profile.label} limit; it is kept for a look and the check fails it`);
      }
      rows.push({ deliverable: item.deliverable, state: "exported", file: rel, bytes: out.measure.bytes, fit: out.measure.fit });
    }

    // Record what was made, in one fresh read → write.
    const { craft, io } = await craftModules();
    const doc = io.loadProject(ws.project, { sidecarKey: S.SIDECAR_KEY });
    const sc = sidecar(doc);
    for (const m of made) {
      const type = m.rel.endsWith(".webm") ? "video" : "image";
      craft.reserveAsset(doc, {
        id: m.item.assetId, type, name: `${profile.label} ${m.item.kind === "sticker" ? `${m.item.name} (${m.item.sticker})` : m.item.deliverable}`,
        op: "derive", uri: m.rel, from: [m.source.id], force: true, generating: false,
        params: { op: "export", platform, deliverable: m.item.deliverable, recipe: S.EXPORT_RECIPES[platform] },
      }, now());
      const { metadata, warning } = io.probeMedia(ws.abs(m.rel), type);
      if (warning) note(`WARN: ${m.item.assetId}: ${warning}`);
      craft.landAsset(doc, { id: m.item.assetId, uri: m.rel, metadata }, now());
      sc.measures[m.item.assetId] = m.measure;
    }
    // Exports of stickers no longer in the pack go from the record.
    const live = new Set(S.platformDeliverables(pack, platform).map((i) => i.assetId));
    const gone = doc.assets.filter((a) => a.id.startsWith(`${platform}-`) && !live.has(a.id)).map((a) => a.id);
    for (const id of gone) delete sc.measures[id];
    if (gone.length) craft.dropAssets(doc, gone);
    // Then every file in the export directory that no live export claims goes:
    // a dropped sticker's, or a renumbered one's old name. Deleting only now —
    // after every file is written — keeps a renumbered sticker's new file
    // (it may have the name a dropped one had).
    const claimed = new Set(doc.assets.filter((a) => a.id.startsWith(`${platform}-`)).map((a) => basename(a.uri)));
    if (existsSync(ws.abs(dir))) {
      for (const name of readdirSync(ws.abs(dir))) if (ownedExportFile(name) && !claimed.has(name)) rmSync(ws.abs(`${dir}/${name}`), { force: true });
    }
    // The listing text.
    const listingRel = S.paths.listing(platform);
    const text = listingText(pack, platform);
    if (!existsSync(ws.abs(listingRel)) || readFileSync(ws.abs(listingRel), "utf-8") !== text) media.writeAtomic(ws.abs(listingRel), text);
    // The archive: every required deliverable, current.
    const after = S.exportState(pack, doc, platform);
    let archiveRow;
    if (after.archive.state === "blocked") {
      archiveRow = { state: "blocked", reason: "not every deliverable is exported and current" };
    } else {
      const archiveRel = S.paths.archive(platform);
      const members = after.items.filter((i) => i.state === "current");
      const existing = sc.archives[platform];
      if (existing?.key === after.archive.key && existsSync(ws.abs(archiveRel)) && statSync(ws.abs(archiveRel)).size === existing.bytes) {
        archiveRow = { state: "current", file: archiveRel };
      } else {
        const bytes = media.archive(members.map((i) => ({ name: basename(i.file), data: readFileSync(ws.abs(i.file)) })));
        media.writeAtomic(ws.abs(archiveRel), bytes);
        sc.archives[platform] = { uri: archiveRel, bytes: bytes.length, entries: members.map((i) => basename(i.file)), key: after.archive.key, at: now() };
        archiveRow = { state: "exported", file: archiveRel, bytes: bytes.length };
      }
    }
    const pruned = tidy(doc);
    if (made.length || gone.length || archiveRow.state === "exported" || pruned.measures.length || pruned.archives.length) io.saveProject(ws.project, doc);
    report[platform] = { items: rows, archive: archiveRow, removed: gone };
  }
  const lines = [];
  for (const [platform, r] of Object.entries(report)) {
    lines.push(`${S.PLATFORM_PROFILES[platform].label}:`);
    for (const row of r.items) {
      if (row.state === "exported") lines.push(`  ${row.deliverable} → ${row.file} · ${kb(row.bytes)}${row.fit ? ` · ${Object.entries(row.fit).filter(([k]) => k !== "ok").map(([k, val]) => `${k} ${val}`).join(", ")}` : ""}${row.fit?.ok === false ? " · OVER THE LIMIT" : ""}`);
      else if (row.state === "current") lines.push(`  ${row.deliverable} current (${row.file})`);
      else if (row.state === "blocked") lines.push(`  ${row.deliverable} ${row.optional ? "skipped (optional)" : "BLOCKED"} — ${row.reason}`);
      else lines.push(`  ${row.deliverable} ERROR — ${row.reason}`);
    }
    if (r.removed.length) lines.push(`  removed: ${r.removed.join(", ")}`);
    lines.push(`  archive: ${r.archive.state === "blocked" ? `not built — ${r.archive.reason}` : `${r.archive.file}${r.archive.bytes ? ` · ${kb(r.archive.bytes)}` : " (current)"}`}`);
  }
  lines.push(`check with: sticker.mjs check${platforms.length === 1 ? ` --platform ${platforms[0]}` : ""}`);
  emit(v, { command: "export", platforms: report }, lines);
}

// ---------------------------------------------------------------------------
// check
// ---------------------------------------------------------------------------

async function cmdCheck(v) {
  const ws = workspace(v);
  const pack = loadPack(ws);
  const doc = await loadProjectOrNull(ws);
  const platforms = !v.platform || v.platform === "all" ? pack.platforms : [v.platform];
  for (const p of platforms) if (!S.PLATFORMS.includes(p)) fail(`--platform must be ${S.PLATFORMS.join(", ")} or all (got: ${p})`);
  const out = {};
  const lines = [];
  const mark = { pass: "PASS", warn: "WARN", fail: "FAIL" };
  // The files the record vouches for must still be the files on disk.
  const disk = [];
  for (const platform of platforms) {
    const rows = S.checkPack(pack, doc, platform);
    const tally = S.tally(rows);
    for (const item of S.exportState(pack, doc, platform).items) {
      if (item.state === "current" && (!existsSync(ws.abs(item.file)) || statSync(ws.abs(item.file)).size !== item.measure.bytes)) disk.push(item.file);
    }
    out[platform] = { rows, tally };
    lines.push(`${S.PLATFORM_PROFILES[platform].label} (rules checked ${S.PLATFORM_PROFILES[platform].checked}): ${tally.pass} pass · ${tally.warn} warn · ${tally.fail} fail`);
    for (const r of rows) lines.push(`  ${mark[r.level]}  ${r.label}: ${r.detail}`);
  }
  for (const file of disk) note(`WARN: ${file} is missing or changed on disk since it was exported — run sticker.mjs export again`);
  const failed = Object.values(out).some((o) => o.tally.fail > 0) || disk.length > 0;
  if (failed) process.exitCode = 1;
  emit(v, { command: "check", platforms: out, diskMismatch: disk }, lines);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const COMMAND_HELP = [
  ["status", "", "the pack, keys, tools, every sticker's status, exports, checks, cost and the next step"],
  ["quote", "[--only s01,s03] [--redo] | --art [--only portrait,head] | --character [--count 1]", "what the paid command would send and cost, before it is sent (nothing is sent)"],
  ["character", "[--from <image|character-source-n>] [--count 1] [--model flare|sunburst] [--quality high] [--dry-run]", "character candidates (OpenRouter, transparent PNG) from the user's photo or image, or from character.description. Paid; refuses without rights"],
  ["gen", "[--only s01,s03] [--redo] [--concurrency 4] [--deadline-s 600] [--dry-run]\n                 --art [--only portrait,head] [--redo] [--model] [--quality high] [--dry-run]", "sticker takes (fal GPT Image 2.6 GIF from the anchor) for stickers with no take, or a new take each with --redo; --art makes the art the chosen platforms need. Paid; refuses without rights; a failure does not stop the others; nothing is retried"],
  ["prompts", "[--only s01,…] | --art [--only kinds] | --character", "the exact prompts, for making the files elsewhere (ChatGPT) and importing them"],
  ["import", "--sticker <id> --file <gif> | --art <kind> --file <image> | --character --file <image> | --source --file <photo>", "register a file the user brought (upload by human); a take records the current prompt and anchor"],
  ["inspect", "<sticker id> [--take <id>]", "contact sheet of a take on the light and dark chat plates (inspect/<take>-contact.png) and its loop seam, motion and alpha numbers"],
  ["export", "[--platform wechat|telegram|line|all]", "derive every platform's files from the picked takes and art (ffmpeg), record their measurements, write the listing text and the upload zip. Deterministic: current files are left alone"],
  ["check", "[--platform wechat|telegram|line|all]", "the platform checklist (the viewer shows the same rows); exits 1 when a row fails"],
];

const COMMON_HELP = `Common: --dir <workspace> (default: cwd) · --json prints one object on stdout · --at <epoch ms> pins timestamps.
Keys: FAL_KEY (sticker takes), OPENROUTER_API_KEY (character and art). Run "sticker.mjs <command> --help" for one command.`;

const helpEntry = ([name, usage, what]) => `  ${name.padEnd(10)}${usage}${what ? `\n             ${what}` : ""}`;

export const HELP = `Usage: sticker.mjs <command> [--dir <workspace>] [--json] [options]

pack.json is the pack (you and the viewer edit it; this CLI only reads it);
project.json is machine state written only here. Paid commands refuse
without rights in pack.json, record before sending and print a cost line.

${COMMAND_HELP.map(helpEntry).join("\n")}

${COMMON_HELP}`;

export function commandHelp(command) {
  const entry = COMMAND_HELP.find(([name]) => name === command);
  return entry ? `Usage: sticker.mjs ${command} ${entry[1]}\n\n${entry[2]}\n\n${COMMON_HELP}` : null;
}

const OPTIONS = {
  dir: { type: "string" }, json: { type: "boolean", default: false }, at: { type: "string" },
  help: { type: "boolean", short: "h", default: false }, "dry-run": { type: "boolean", default: false },
  only: { type: "string" }, redo: { type: "boolean", default: false }, art: { type: "string" }, character: { type: "boolean", default: false },
  source: { type: "boolean", default: false }, sticker: { type: "string" }, file: { type: "string" }, take: { type: "string" },
  from: { type: "string" }, count: { type: "string" }, model: { type: "string" }, quality: { type: "string" },
  concurrency: { type: "string" }, "deadline-s": { type: "string" }, platform: { type: "string" },
};

const COMMANDS = {
  status: cmdStatus,
  quote: cmdQuote,
  character: cmdCharacter,
  gen: cmdGen,
  prompts: cmdPrompts,
  import: cmdImport,
  inspect: cmdInspect,
  export: cmdExport,
  check: cmdCheck,
};

/** `--art` is a flag on gen / quote / prompts and takes a kind on import. */
function normalizeArtFlag(argv) {
  const out = [...argv];
  if (out.includes("import")) return out;
  for (let i = 0; i < out.length; i += 1) {
    if (out[i] === "--art" && (i + 1 >= out.length || out[i + 1].startsWith("-"))) out.splice(i + 1, 0, "true");
  }
  return out;
}

export async function main(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseArgs({ args: normalizeArtFlag(argv), options: OPTIONS, allowPositionals: true, strict: true });
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
    process.stderr.write(`ERROR: unknown command '${command}' — sticker.mjs --help lists them\n`);
    return 1;
  }
  const extra = command === "inspect" ? positionals.slice(2) : positionals.slice(1);
  if (extra.length) {
    process.stderr.write(`ERROR: unexpected argument '${extra[0]}'\n`);
    return 1;
  }
  if (command !== "import" && values.art !== undefined && values.art !== "true") {
    // `gen --art portrait` reads as a kind: point at --only.
    process.stderr.write(`ERROR: --art takes no value here; choose kinds with --only ${values.art}\n`);
    return 1;
  }
  if (command !== "import" && values.art === "true") values.art = true;
  try {
    await handler(values, positionals[1]);
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

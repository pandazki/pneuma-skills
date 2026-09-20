#!/usr/bin/env node
/**
 * backlot.mjs — the film, and the gate in front of every paid stage.
 *
 * A short film moves through eight stages in a fixed order — idea, script,
 * bible, boards, previz, takes, sound, cut — and each one leaves a file the
 * creator can read. This script is the only writer of the four files that
 * describe the film as a whole:
 *
 *   backlot.json              the manifest: defaults, gates, approvals,
 *                             scenes, the cast, the places, the shot order
 *   bible/**\/*.json           characters and sets, with their look and voice
 *   sound/sound.json          the music bed
 *   cut/edl.json              the edit list of the last cut
 *
 * `previz.mjs` remains the only writer of `shots/<id>/shot.json` — a shot's
 * own machine state — and the agent writes the prose and the Blender script.
 * The viewer writes nothing: approving a stage is a COMMAND to the agent,
 * which runs `approve` here.
 *
 * The gate is the reason this script exists. A stage's status is derived
 * from its files (`stage-state.mjs`), an approval is the creator's recorded
 * verdict on one exact version of them, and a paid command refuses while the
 * stage it depends on is not approved — unless the creator has said, in so
 * many words, to run through (`gates open`). Image generation is not wrapped
 * here (the agent runs `generate_image.mjs` itself and registers the result),
 * so `backlot.mjs gate <command>` exists to be asked BEFORE the spend.
 *
 * Contract, the same as previz.mjs:
 *  - every subcommand prints EXACTLY ONE JSON object on stdout and exits 0;
 *  - progress, warnings and every line ffmpeg printed go to stderr;
 *  - a refusal prints one `ERROR: …` line on stderr and exits non-zero,
 *    leaving the film exactly as it was;
 *  - `--json` is accepted everywhere and is already the default.
 *
 * Zero npm dependencies: Node 20+ built-ins, the shared scripts it runs as
 * child processes, and ffmpeg/ffprobe for the cut.
 */

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { costLines, costOfStage, summarizeCost } from "./cost.mjs";
import { parseProbe, pngSize } from "./media.mjs";
import { createShot } from "./previz.mjs";
import {
  gateRefusal,
  lastJsonObject,
  parseJsonObject,
  PROJECT_FILE,
  projectGate,
  projectPathOf,
  readManifest,
  readProjectTexts,
  relFromProject,
  runNodeScript,
  sharedScript,
  shotPathOf,
} from "./project.mjs";
import { DEFAULT_SPEC, makeSpec, newProject, normalizeShot, parseSize, slugId } from "./shot.mjs";
import { GATES, hashStage, isStage, STAGES, stageStatus, stageStatuses } from "./stage-state.mjs";

const SUBCOMMANDS = [
  "init", "status", "approve", "gates", "gate", "scene", "shot",
  "character", "set", "music", "cut", "cost",
];

/** The three provenances a recorded price may have. Never guessed. */
const COST_BASES = ["table", "reported", "estimate"];

/** What the cut lays the music under the dialogue at, and how long it takes
 *  to leave. Both are overridable; these are the defaults a mix starts from. */
const MUSIC_GAIN_DB = -18;
const MUSIC_FADE_OUT_S = 2;

const BGM_MODEL = "google/lyria-3-pro-preview";

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

/** Scratch + rename: the viewer polls these files, so it must never observe
 *  a half-written one. The scratch name carries the pid because two commands
 *  can touch the same file within one millisecond. */
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

const MANIFEST_KEYS = ["version", "title", "logline", "defaults", "gates", "approvals", "scenes", "characters", "sets", "shots"];

function inKeyOrder(value, keys) {
  const ordered = {};
  for (const key of keys) if (value[key] !== undefined) ordered[key] = value[key];
  for (const key of Object.keys(value)) if (ordered[key] === undefined) ordered[key] = value[key];
  return ordered;
}

function loadManifest(dir) {
  try {
    return readManifest(dir);
  } catch (error) {
    return fail(error.message);
  }
}

/**
 * Write one command's delta into whatever `backlot.json` says RIGHT NOW.
 *
 * The same discipline `previz.mjs commitShot` follows, for the same reason:
 * a music job or a cut runs for minutes, the agent registers a character or
 * approves a stage in that window, and writing back the document this
 * process read at startup silently erases it.
 */
function commitProject(dir, apply) {
  const fresh = loadManifest(dir);
  const result = apply(fresh);
  writeJsonAtomic(projectPathOf(dir), inKeyOrder(fresh, MANIFEST_KEYS));
  return { manifest: fresh, result };
}

/** `--now` is accepted everywhere so a test can pin a timestamp; approvals
 *  and records are stamped in epoch milliseconds, as `backlot.json` spells
 *  them. */
function nowMs(opts) {
  if (opts.now === undefined) return Date.now();
  const parsed = /^\d+$/.test(String(opts.now)) ? Number(opts.now) : Date.parse(opts.now);
  if (!Number.isFinite(parsed)) fail(`--now must be an ISO-8601 timestamp or epoch milliseconds, got "${opts.now}"`);
  return parsed;
}

function requireProject(dir) {
  if (!existsSync(projectPathOf(dir))) {
    fail(`no ${PROJECT_FILE} in ${dir} — run 'backlot.mjs init ${dir} --title "…" --logline "…"' first`);
  }
  return dir;
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

/** Refuse a paid command whose gate is closed, with the gate's own reason
 *  verbatim and the two ways past it. */
function requireGate(command, dir) {
  const gate = projectGate(command, dir);
  if (!gate.ok) fail(`refusing to spend on "${command}":\n${gateRefusal(gate, dir)}`);
  return gate;
}

function cmdGate(dir, command) {
  requireProject(dir);
  if (!command) fail(`gate needs a command: backlot.mjs gate <project> ${Object.keys(GATES).join("|")}`);
  const gate = projectGate(command, dir);
  const payload = {
    command: "gate",
    dir,
    gated: command,
    stage: gate.stage,
    status: gate.status,
    gates: gate.manifest?.gates === "open" ? "open" : "closed",
    reason: gate.reason,
  };
  if (gate.ok) {
    return emit({ ...payload, allowed: true, note: gate.stage === null ? `"${command}" needs no approval` : null });
  }
  // A refusal still prints its object: an agent that parses stdout should
  // not have to parse stderr to learn which stage is waiting.
  process.stdout.write(`${JSON.stringify({ ok: false, allowed: false, ...payload }, null, 2)}\n`);
  process.stderr.write(`ERROR: ${gateRefusal(gate, dir)}\n`);
  return 1;
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

function specFromOpts(opts, defaults) {
  const size = opts.size ? parseSize(opts.size) : {};
  const width = opts.width === undefined ? size.width : Number(opts.width);
  const height = opts.height === undefined ? size.height : Number(opts.height);
  try {
    return makeSpec({ seconds: opts.seconds, fps: opts.fps, width, height }, defaults);
  } catch (error) {
    return fail(error.message);
  }
}

function cmdInit(dir, opts) {
  if (existsSync(projectPathOf(dir))) fail(`${projectPathOf(dir)} already exists — pick another directory`);
  if (!opts.title) fail('init needs --title "<the film\'s name>"');
  if (!opts.logline) {
    fail('init needs --logline "<one sentence: who wants what, and what is in the way>" — the whole film is built from it');
  }
  const spec = specFromOpts(opts, DEFAULT_SPEC);
  const project = newProject({ title: opts.title, logline: opts.logline, defaults: spec });
  mkdirSync(join(dir, "shots"), { recursive: true });
  writeJsonAtomic(projectPathOf(dir), project);
  note("[backlot] gates are CLOSED — every paid stage waits for 'backlot.mjs approve <stage>' until the creator says to run through");
  return emit({
    command: "init",
    dir,
    file: relPath(dir, projectPathOf(dir)),
    project,
    stages: stageStatuses(readProjectTexts(dir), project.approvals),
    next: { stage: "idea", reason: "nothing has been written yet", command: `write ${join(dir, "idea.md")}` },
  });
}

// ---------------------------------------------------------------------------
// status / approve / gates
// ---------------------------------------------------------------------------

/** One shot, as the film's report sees it: enough to draw the strip, never
 *  the whole shot document. `previz.mjs status <shot-dir>` is the detail. */
function shotSummary(dir, id) {
  const shotDir = join(dir, "shots", id);
  const path = shotPathOf(shotDir);
  if (!existsSync(path)) return { id, dir: shotDir, missing: true };
  let shot;
  try {
    shot = normalizeShot(JSON.parse(readFileSync(path, "utf-8")));
  } catch (error) {
    return { id, dir: shotDir, unreadable: error.message };
  }
  const takes = shot.takes ?? [];
  const selected = takes.find((take) => take.selected === true) ?? null;
  const checks = shot.checks ?? [];
  const failing = checks.filter((check) => check.status === "fail").map((check) => `${check.target}:${check.id}`);
  return {
    id,
    dir: shotDir,
    title: shot.title ?? id,
    scene: shot.scene ?? null,
    characters: shot.characters ?? [],
    set: shot.set ?? null,
    seconds: shot.spec?.seconds ?? null,
    board: shot.board ? { file: shot.board.file, revision: shot.board.revision } : null,
    greybox: {
      revision: Number(shot.greybox?.revision ?? 0),
      final: shot.greybox?.final?.file ?? null,
    },
    takes: takes.map((take) => ({ id: take.id, status: take.status, selected: Boolean(take.selected) })),
    selected: selected?.id ?? null,
    lines: (shot.lines ?? []).map((line) => ({ id: line.id, kind: line.kind, speaker: line.speaker, at: line.at, file: line.file ?? null })),
    failingChecks: failing,
    stuck: shot.stuck ?? [],
  };
}

/** The first stage that is not approved — where the film actually is. */
function nextOpenStage(statuses, gates) {
  const open = statuses.find((entry) => entry.status !== "approved");
  if (!open) return { stage: null, status: null, reason: "every stage is approved — the film is done", command: null };
  const command = open.status === "empty"
    ? STAGE_HINTS[open.stage]
    : `backlot.mjs approve <project> ${open.stage}`;
  const reason = open.status === "empty"
    ? `nothing defines "${open.stage}" yet`
    : open.status === "changed"
      ? `"${open.stage}" changed after it was approved — show the creator the new version`
      : `"${open.stage}" is drafted and waiting for the creator`;
  return { stage: open.stage, status: open.status, reason, command, gates };
}

const STAGE_HINTS = {
  idea: "write idea.md",
  script: "write screenplay.md, then backlot.mjs scene add",
  bible: "backlot.mjs character add / set add, then generate_image.mjs and character look / set look",
  boards: "backlot.mjs shot add, then generate_image.mjs and previz.mjs board",
  previz: "write greybox/scene.py, then previz.mjs render / check",
  takes: "previz.mjs generate, then previz.mjs check / select",
  sound: "previz.mjs vo and backlot.mjs music",
  cut: "backlot.mjs cut --reel, then --final",
};

function cmdStatus(dir) {
  requireProject(dir);
  const manifest = loadManifest(dir);
  const texts = readProjectTexts(dir);
  const lines = costLines(texts);
  const statuses = STAGES.map((stage) => {
    const status = stageStatus(stage, texts, manifest.approvals);
    const approval = manifest.approvals?.[stage] ?? null;
    return {
      stage,
      status,
      approvedAt: approval && Number.isFinite(Number(approval.at)) ? Number(approval.at) : null,
      hash: hashStage(stage, texts),
      approvedHash: approval?.hash ?? null,
      usd: costOfStage(lines, stage),
    };
  });
  const shots = manifest.shots.map((id) => shotSummary(dir, id));
  const changed = statuses.filter((entry) => entry.status === "changed").map((entry) => entry.stage);
  if (changed.length) note(`WARN: ${changed.join(", ")} changed after approval — the creator has not seen the current version`);
  if (manifest.gates === "open") note("WARN: gates are OPEN — paid commands do not wait for approval in this project");

  return emit({
    command: "status",
    kind: "project",
    dir,
    title: manifest.title,
    logline: manifest.logline,
    defaults: manifest.defaults,
    gates: manifest.gates,
    stages: statuses,
    scenes: manifest.scenes,
    characters: manifest.characters.map((id) => bibleSummary(dir, "characters", id)),
    sets: manifest.sets.map((id) => bibleSummary(dir, "sets", id)),
    shots,
    sound: parseJsonObject(texts["sound/sound.json"]),
    cut: parseJsonObject(texts["cut/edl.json"]),
    cost: summarizeCost(lines),
    stuck: shots.flatMap((shot) => (shot.stuck ?? []).map((id) => `${shot.id}:${id}`)),
    next: nextOpenStage(statuses, manifest.gates),
  });
}

function bibleSummary(dir, family, id) {
  const record = readBible(dir, family, id);
  if (!record) return { id, missing: true };
  return family === "characters"
    ? {
        id,
        name: record.name ?? id,
        description: record.description ?? "",
        sheet: record.sheet ? { file: record.sheet.file, revision: record.sheet.revision } : null,
        voice: record.voice ? { model: record.voice.model, voiceId: record.voice.voiceId, sample: record.voice.sample?.file ?? null } : null,
      }
    : {
        id,
        name: record.name ?? id,
        description: record.description ?? "",
        concept: record.concept ? { file: record.concept.file, revision: record.concept.revision } : null,
      };
}

function cmdApprove(dir, stage, opts) {
  requireProject(dir);
  if (!stage) fail(`approve needs a stage: backlot.mjs approve <project> ${STAGES.join("|")}`);
  if (!isStage(stage)) fail(`unknown stage "${stage}" (expected: ${STAGES.join(", ")})`);
  const texts = readProjectTexts(dir);
  const hash = hashStage(stage, texts);
  if (hash === null) {
    fail(
      `cannot approve "${stage}": the stage is empty — nothing defines it yet (${STAGE_HINTS[stage]}). ` +
        "An approval of nothing would open the gate behind it.",
    );
  }
  const at = nowMs(opts);
  const before = stageStatus(stage, texts, loadManifest(dir).approvals);

  const { manifest } = commitProject(dir, (fresh) => {
    const approval = { at, hash };
    if (opts.note) approval.note = String(opts.note);
    fresh.approvals = { ...(fresh.approvals ?? {}), [stage]: approval };
  });
  const after = stageStatus(stage, readProjectTexts(dir), manifest.approvals);
  const opened = Object.entries(GATES).filter(([, needs]) => needs === stage).map(([command]) => command);
  if (opened.length) note(`[backlot] "${stage}" is approved — ${opened.join(", ")} may now spend`);

  return emit({
    command: "approve",
    dir,
    stage,
    was: before,
    status: after,
    approval: manifest.approvals[stage],
    opens: opened,
    stages: stageStatuses(readProjectTexts(dir), manifest.approvals),
  });
}

function cmdGates(dir, mode) {
  requireProject(dir);
  if (mode !== "open" && mode !== "closed") fail(`gates takes open|closed (got: ${mode ?? ""})`);
  const { manifest } = commitProject(dir, (fresh) => { fresh.gates = mode; });
  if (mode === "open") {
    note(
      "WARN: gates are now OPEN — every paid command runs without waiting for an approval. " +
        "Only do this when the creator has said to run through; close them again with 'gates closed'.",
    );
  }
  return emit({ command: "gates", dir, gates: manifest.gates });
}

// ---------------------------------------------------------------------------
// scene
// ---------------------------------------------------------------------------

function cmdScene(action, dir, opts) {
  requireProject(dir);
  if (!opts.id) fail(`scene ${action} needs --id <sc1>`);
  let id;
  try { id = slugId(opts.id, "--id"); } catch (error) { return fail(error.message); }

  if (action === "add") {
    const existing = loadManifest(dir).scenes.find((scene) => scene && scene.id === id);
    if (existing) fail(`scene "${id}" already exists — edit it with 'backlot.mjs scene set ${dir} --id ${id} …'`);
    if (!opts.heading) fail('scene add needs --heading "INT. 便利店 — 夜"');
    const { manifest } = commitProject(dir, (fresh) => {
      const number = opts.number === undefined ? fresh.scenes.length + 1 : Number(opts.number);
      if (!Number.isInteger(number) || number < 1) fail(`--number must be a whole number from 1 (got: ${opts.number})`);
      fresh.scenes.push({ id, number, heading: String(opts.heading), summary: String(opts.summary ?? "") });
      fresh.scenes.sort((a, b) => Number(a.number ?? 0) - Number(b.number ?? 0));
    });
    return emit({ command: "scene add", dir, scene: manifest.scenes.find((scene) => scene.id === id), scenes: manifest.scenes });
  }

  const { manifest } = commitProject(dir, (fresh) => {
    const scene = fresh.scenes.find((entry) => entry && entry.id === id);
    if (!scene) fail(`no scene "${id}" (${fresh.scenes.map((s) => s.id).join(", ") || "none"}) — add it with 'scene add'`);
    if (opts.number !== undefined) {
      const number = Number(opts.number);
      if (!Number.isInteger(number) || number < 1) fail(`--number must be a whole number from 1 (got: ${opts.number})`);
      scene.number = number;
    }
    if (opts.heading !== undefined) scene.heading = String(opts.heading);
    if (opts.summary !== undefined) scene.summary = String(opts.summary);
    fresh.scenes.sort((a, b) => Number(a.number ?? 0) - Number(b.number ?? 0));
  });
  return emit({ command: "scene set", dir, scene: manifest.scenes.find((scene) => scene.id === id), scenes: manifest.scenes });
}

// ---------------------------------------------------------------------------
// shot add — the order lives here, the shot file is previz.mjs's
// ---------------------------------------------------------------------------

function parseIdList(value, label) {
  return String(value)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      try { return slugId(part, label); } catch (error) { return fail(error.message); }
    });
}

function cmdShotAdd(dir, idArg, opts) {
  requireProject(dir);
  if (!idArg) fail('shot add needs an id: backlot.mjs shot add <project> s01-enter --title "…"');
  if (!opts.title) fail('shot add needs --title "<what happens in this shot>"');
  const manifest = loadManifest(dir);
  const scene = opts.scene ? slugId(opts.scene, "--scene") : null;
  if (scene && !manifest.scenes.some((entry) => entry && entry.id === scene)) {
    fail(`no scene "${scene}" in this film (${manifest.scenes.map((s) => s.id).join(", ") || "none"}) — add it with 'backlot.mjs scene add'`);
  }
  const characters = opts.characters ? parseIdList(opts.characters, "--characters") : [];
  const set = opts.set ? slugId(opts.set, "--set") : null;
  for (const id of characters) {
    if (!manifest.characters.includes(id)) note(`WARN: character "${id}" is not in the bible yet — add it before the take, or it goes without their sheet`);
  }
  if (set && !manifest.sets.includes(set)) note(`WARN: set "${set}" is not in the bible yet — add it before the take, or it goes without the concept frame`);

  // `previz.mjs` writes shot.json (it owns that file); the ORDER is this
  // file's, and it is written after the directory exists so a failed
  // scaffold never leaves a registered shot with nothing behind it.
  const made = createShot(dir, idArg, {
    title: opts.title,
    entry: opts.entry,
    seconds: opts.seconds,
    fps: opts.fps,
    size: opts.size,
    scene,
    characters,
    set,
  });
  const { manifest: saved } = commitProject(dir, (fresh) => {
    if (!fresh.shots.includes(made.id)) fresh.shots.push(made.id);
  });
  return emit({ command: "shot add", dir, ...made, shots: saved.shots });
}

// ---------------------------------------------------------------------------
// bible — characters and sets
// ---------------------------------------------------------------------------

const FAMILIES = {
  characters: { file: "character.json", media: "sheet", mediaFile: "sheet.png", word: "character" },
  sets: { file: "set.json", media: "concept", mediaFile: "concept.png", word: "set" },
};

function bibleDir(dir, family, id) {
  return join(dir, "bible", family, id);
}

function biblePath(dir, family, id) {
  return join(bibleDir(dir, family, id), FAMILIES[family].file);
}

function readBible(dir, family, id) {
  const path = biblePath(dir, family, id);
  if (!existsSync(path)) return null;
  try {
    const doc = JSON.parse(readFileSync(path, "utf-8"));
    return doc && typeof doc === "object" && !Array.isArray(doc) ? doc : null;
  } catch (error) {
    return fail(`${path} is not valid JSON (${error.message})`);
  }
}

/** Re-read, apply, write — the bible record equivalent of `commitShot`. */
function commitBible(dir, family, id, apply) {
  const fresh = readBible(dir, family, id);
  if (!fresh) fail(`no ${FAMILIES[family].word} "${id}" in the bible — add it with 'backlot.mjs ${FAMILIES[family].word} add ${dir} ${id} --name "…"'`);
  apply(fresh);
  writeJsonAtomic(biblePath(dir, family, id), fresh);
  return fresh;
}

function cmdBibleAdd(family, dir, idArg, opts) {
  requireProject(dir);
  const word = FAMILIES[family].word;
  if (!idArg) fail(`${word} add needs an id: backlot.mjs ${word} add <project> <id> --name "…"`);
  let id;
  try { id = slugId(idArg, `${word} id`); } catch (error) { return fail(error.message); }
  if (!opts.name) fail(`${word} add needs --name "<what the creator calls them>"`);
  if (existsSync(biblePath(dir, family, id))) {
    fail(`${word} "${id}" is already in the bible — edit it with 'backlot.mjs ${word} set ${dir} ${id} …'`);
  }
  const record = {
    version: 1,
    id,
    name: String(opts.name),
    description: String(opts.description ?? ""),
    look: String(opts.look ?? ""),
    ...(family === "characters" ? { sheet: null, voice: null } : { concept: null }),
  };
  writeJsonAtomic(biblePath(dir, family, id), record);
  const { manifest } = commitProject(dir, (fresh) => {
    const list = family === "characters" ? fresh.characters : fresh.sets;
    if (!list.includes(id)) list.push(id);
  });
  return emit({
    command: `${word} add`,
    dir,
    id,
    file: relFromProject(dir, biblePath(dir, family, id)),
    record,
    order: family === "characters" ? manifest.characters : manifest.sets,
  });
}

function cmdBibleSet(family, dir, idArg, opts) {
  requireProject(dir);
  const word = FAMILIES[family].word;
  if (!idArg) fail(`${word} set needs an id`);
  const id = slugId(idArg, `${word} id`);
  if (opts.name === undefined && opts.description === undefined && opts.look === undefined) {
    fail(`${word} set needs at least one of --name, --description, --look`);
  }
  const record = commitBible(dir, family, id, (fresh) => {
    if (opts.name !== undefined) fresh.name = String(opts.name);
    if (opts.description !== undefined) fresh.description = String(opts.description);
    if (opts.look !== undefined) fresh.look = String(opts.look);
  });
  return emit({ command: `${word} set`, dir, id, record });
}

/** `{ usd, basis }` for a paid record, or null. `--cost-basis` is required
 *  beside `--cost-usd`: where a number came from is part of the number. */
function costFromOpts(opts, label) {
  if (opts["cost-usd"] === undefined) {
    note(`NOTE: no price recorded for this ${label} — pass --cost-usd <n> --cost-basis ${COST_BASES.join("|")} and 'backlot.mjs cost' can total it`);
    return null;
  }
  const usd = Number(opts["cost-usd"]);
  if (!Number.isFinite(usd) || usd < 0) fail(`--cost-usd must be a non-negative number of dollars (got: ${opts["cost-usd"]})`);
  const basis = opts["cost-basis"];
  if (!basis) fail(`--cost-usd needs --cost-basis ${COST_BASES.join("|")} — "reported" is the vendor's own usage.cost, "table" a published price, "estimate" your arithmetic`);
  if (!COST_BASES.includes(basis)) fail(`--cost-basis must be one of ${COST_BASES.join("|")} (got: ${basis})`);
  return { usd: Math.round(usd * 10000) / 10000, basis };
}

/**
 * Register a generated still as this character's sheet or this set's
 * concept frame.
 *
 * Generation itself is NOT wrapped: the agent runs `generate_image.mjs`,
 * looks at what came back, and registers the one it wants. The gate is still
 * enforced here — and because registering happens AFTER the spend, the skill
 * tells the agent to ask `backlot.mjs gate bible-image` first.
 */
function cmdBibleLook(family, dir, idArg, opts) {
  requireProject(dir);
  const word = FAMILIES[family].word;
  if (!idArg) fail(`${word} look needs an id`);
  const id = slugId(idArg, `${word} id`);
  if (!opts.file) fail(`${word} look needs --file <image.png> (generate it with generate_image.mjs, then register it here)`);
  if (!opts.prompt) fail(`${word} look needs --prompt "<the prompt it was made from>" — a look nobody can regenerate is a look nobody can fix`);
  if (!readBible(dir, family, id)) {
    fail(`no ${word} "${id}" in the bible — add it with 'backlot.mjs ${word} add ${dir} ${id} --name "…"'`);
  }
  requireGate("bible-image", dir);

  const source = resolveInput(opts.file);
  if (!existsSync(source)) fail(`--file: no such file: ${source}`);
  const size = pngSize(readFileSync(source));
  if (!size) fail(`--file: ${source} is not a readable PNG — generate_image.mjs writes PNG by default (--output-format png)`);
  const destination = join(bibleDir(dir, family, id), FAMILIES[family].mediaFile);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
  if (opts.move) {
    try { rmSync(source, { force: true }); } catch (error) { note(`WARN: could not remove ${source} (${error.message}) — the registered copy is fine`); }
  }

  const key = FAMILIES[family].media;
  const cost = costFromOpts(opts, `${word} look`);
  const at = nowMs(opts);
  const record = commitBible(dir, family, id, (fresh) => {
    const revision = Number(fresh[key]?.revision ?? 0) + 1;
    fresh.look = String(opts.prompt);
    fresh[key] = {
      file: FAMILIES[family].mediaFile,
      revision,
      prompt: String(opts.prompt),
      width: size.width,
      height: size.height,
      at,
      cost,
    };
  });
  return emit({
    command: `${word} look`,
    dir,
    id,
    file: relFromProject(dir, destination),
    revision: record[key].revision,
    size,
    cost,
    record,
  });
}

/** One shared script, resolved and announced — a clip made by something
 *  other than the vendor must never be mistaken for one that was. */
function requireSharedScript(name, envVar, why) {
  const found = sharedScript(name, envVar);
  if (!found.path) {
    fail(`${name} is not installed beside this skill and is not in the source checkout — ${why} needs it (add it to the mode's skill.sharedScripts)`);
  }
  if (found.overridden) note(`WARN: ${envVar} is set — ${name} comes from ${found.path}, not from the shared script`);
  return found.path;
}

/**
 * Give a character a voice, and record the sample it is proven by.
 *
 * The sample is not decoration: it is the `@AudioN` reference a take carries
 * when this character speaks on screen, and the voice a `vo` line defaults
 * to. One recorded voice per character keeps both of those consistent across
 * every shot.
 */
function cmdCharacterVoice(dir, idArg, opts) {
  requireProject(dir);
  if (!idArg) fail("character voice needs an id");
  const id = slugId(idArg, "character id");
  const record = readBible(dir, "characters", id);
  if (!record) fail(`no character "${id}" in the bible — add it with 'backlot.mjs character add ${dir} ${id} --name "…"'`);
  const text = opts.text ?? record.voice?.sample?.text;
  if (!text) fail('character voice needs --text "<a line in their voice>" — the sample is what the take and the cut are conditioned on');
  requireGate("voice", dir);

  const script = requireSharedScript("generate-tts.mjs", "BACKLOT_TTS_MODULE", "a voice sample");
  const output = join(bibleDir(dir, "characters", id), "voice.mp3");
  mkdirSync(dirname(output), { recursive: true });
  const args = ["--text", String(text), "--output", output, "--json"];
  if (opts.model) args.push("--model", opts.model);
  if (opts.voice) args.push("--voice", opts.voice);
  if (opts.style) args.push("--style", opts.style);
  if (opts.language) args.push("--language", opts.language);

  note(`[backlot] synthesizing ${id}'s voice sample — the request is leaving now`);
  const run = runNodeScript(script, args);
  if (run.code !== 0 || !existsSync(output)) fail(`generate-tts.mjs failed (exit ${run.code}):\n${tail(run.stderr)}`);
  const reported = lastJsonObject(run.stdout);
  const seconds = Number.isFinite(Number(reported?.seconds))
    ? Math.round(Number(reported.seconds) * 10000) / 10000
    : probeSeconds(output);
  const cost = costFromOpts(opts, "voice sample");
  const at = nowMs(opts);

  const saved = commitBible(dir, "characters", id, (fresh) => {
    fresh.voice = {
      model: opts.model ?? fresh.voice?.model ?? null,
      voiceId: opts.voice ?? fresh.voice?.voiceId ?? null,
      style: opts.style ?? fresh.voice?.style ?? null,
      language: opts.language ?? fresh.voice?.language ?? null,
      sample: { file: "voice.mp3", text: String(text), seconds, at, cost },
    };
  });
  return emit({
    command: "character voice",
    dir,
    id,
    file: relFromProject(dir, output),
    voice: saved.voice,
    seconds,
    cost,
  });
}

// ---------------------------------------------------------------------------
// music
// ---------------------------------------------------------------------------

function cmdMusic(dir, opts) {
  requireProject(dir);
  if (!opts.prompt) fail('music needs --prompt "<the brief: instruments, tempo, what the scene feels like>"');
  requireGate("music", dir);
  // Measured before anything is paid for: a bed whose length nobody can
  // measure cannot be laid under a cut.
  requireTool("ffprobe");

  const script = requireSharedScript("generate-bgm.mjs", "BACKLOT_BGM_MODULE", "the music bed");
  const output = join(dir, "sound", "music.mp3");
  mkdirSync(dirname(output), { recursive: true });
  const args = ["--prompt", String(opts.prompt), "--output", output];
  if (opts.seconds !== undefined) args.push("--duration", String(opts.seconds));

  note("[backlot] generating the music bed — the request is leaving now");
  const run = runNodeScript(script, args);
  if (run.code !== 0 || !existsSync(output)) fail(`generate-bgm.mjs failed (exit ${run.code}):\n${tail(run.stderr)}`);
  const seconds = probeSeconds(output);
  if (seconds === null) note("WARN: ffprobe could not measure the bed — the cut will still lay it under, trimmed to the film's length");
  const cost = costFromOpts(opts, "music bed");
  const at = nowMs(opts);

  const record = {
    version: 1,
    music: {
      file: "music.mp3",
      prompt: String(opts.prompt),
      model: opts.model ?? BGM_MODEL,
      requestedSeconds: opts.seconds === undefined ? null : Number(opts.seconds),
      seconds,
      at,
      cost,
    },
  };
  writeJsonAtomic(join(dir, "sound", "sound.json"), record);
  if (opts.seconds !== undefined && seconds !== null && Math.abs(seconds - Number(opts.seconds)) > 2) {
    note(`WARN: asked for ~${opts.seconds} s and got ${seconds} s — Lyria has no duration parameter, the ask is only a hint in the prompt; the cut trims and fades it`);
  }
  return emit({ command: "music", dir, file: "sound/music.mp3", seconds, cost, sound: record });
}

// ---------------------------------------------------------------------------
// The tools the cut needs
// ---------------------------------------------------------------------------

function isFile(path) {
  try { return statSync(path).isFile(); } catch { return false; }
}

function pathCandidates(executable) {
  const name = process.platform === "win32" ? `${executable}.exe` : executable;
  const extra = process.platform === "darwin" ? ["/opt/homebrew/bin", "/usr/local/bin"] : ["/usr/bin", "/usr/local/bin"];
  return [...(process.env.PATH ?? "").split(delimiter), ...extra]
    .filter(Boolean)
    .map((entry) => join(entry, name))
    .filter(isFile);
}

const toolCache = new Map();

function resolveTool(name) {
  if (toolCache.has(name)) return toolCache.get(name);
  const candidates = [process.env[`${name.toUpperCase()}_PATH`], ...pathCandidates(name)].filter(Boolean);
  let answer = { found: false, path: null, version: null };
  for (const candidate of candidates) {
    if (!isFile(candidate)) continue;
    const probe = spawnSync(candidate, ["-version"], { encoding: "utf-8", timeout: 20_000 });
    const text = `${probe.stdout ?? ""}${probe.stderr ?? ""}`;
    const match = new RegExp(`${name} version (\\S+)`).exec(text);
    if (!match) continue;
    answer = { found: true, path: candidate, version: match[1] };
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

function runTool(path, args, { timeoutMs = 600_000, label = basename(path) } = {}) {
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

/** The whole ffprobe reading of a file: streams, format and (for video) the
 *  counted frames the record stores. */
function probeMedia(file, { counted = false } = {}) {
  const ffprobe = requireTool("ffprobe");
  const args = ["-v", "error", "-print_format", "json", "-show_streams", "-show_format"];
  if (counted) args.push("-count_frames");
  args.push(file);
  const result = runTool(ffprobe.path, args, { label: "ffprobe" });
  if (result.code !== 0) return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

function probeSeconds(file) {
  const doc = probeMedia(file);
  const fromFormat = Number(doc?.format?.duration);
  if (Number.isFinite(fromFormat) && fromFormat > 0) return Math.round(fromFormat * 10000) / 10000;
  for (const stream of Array.isArray(doc?.streams) ? doc.streams : []) {
    const seconds = Number(stream?.duration);
    if (Number.isFinite(seconds) && seconds > 0) return Math.round(seconds * 10000) / 10000;
  }
  return null;
}

function hasAudioStream(file) {
  const doc = probeMedia(file);
  return (Array.isArray(doc?.streams) ? doc.streams : []).some((stream) => stream?.codec_type === "audio");
}

/**
 * How long a normalized segment is ON THE FILM'S CLOCK — counted frames over
 * the film's frame rate, not the container's duration field.
 *
 * A trim of 0.4–1.6 s at 24 fps is 28.8 frames, and ffmpeg emits 28: the
 * container still says 1.2 s, so a cut built from container durations drifts
 * a frame per trimmed segment and every voice-over after it lands late.
 * Frames are what the concat actually contains, so frames are what the edit
 * list is measured in.
 */
function segmentSeconds(file, fps) {
  const probe = parseProbe(probeMedia(file, { counted: true }) ?? {});
  if (probe?.frames && fps) return round4(probe.frames / fps);
  return probeSeconds(file) ?? 0;
}

// ---------------------------------------------------------------------------
// cut
// ---------------------------------------------------------------------------

/**
 * Which file stands for each shot, in the film's order.
 *
 * A `--final` refuses while any shot lacks a selected, finished take: a cut
 * with a grey box in it is a REEL, and calling it a final is the one thing
 * the edit list exists to prevent. A `--reel` falls back to the greybox and
 * labels that segment `greybox`, so the strip shows which seconds are still
 * stand-ins.
 */
function planSegments(dir, manifest, kind) {
  const segments = [];
  const missing = [];
  for (const id of manifest.shots) {
    const shotDir = join(dir, "shots", id);
    const path = shotPathOf(shotDir);
    if (!existsSync(path)) {
      missing.push(`${id}: no shot.json`);
      continue;
    }
    let shot;
    try {
      shot = normalizeShot(JSON.parse(readFileSync(path, "utf-8")));
    } catch (error) {
      missing.push(`${id}: shot.json is unreadable (${error.message})`);
      continue;
    }
    // The sub-range of the shot's clock that reaches the film. It applies to
    // whichever source stands in for the shot — a take and its greybox are
    // the same seconds of the same shot.
    const trim = shot.trim && Number.isFinite(Number(shot.trim.in)) && Number.isFinite(Number(shot.trim.out))
      ? { in: Number(shot.trim.in), out: Number(shot.trim.out) }
      : null;
    const common = { shot: id, shotDir, lines: shot.lines ?? [], trim, shotSeconds: shot.spec?.seconds ?? null };

    const selected = (shot.takes ?? []).find((take) => take.selected === true && take.status === "done" && take.file);
    const takeFile = selected ? join(shotDir, selected.file) : null;
    if (takeFile && existsSync(takeFile)) {
      segments.push({ ...common, source: selected.id, file: takeFile, rel: relFromProject(dir, takeFile), silent: false });
      continue;
    }
    if (kind === "final") {
      missing.push(selected ? `${id}: ${selected.id} is selected but ${selected.file} is gone` : `${id}: no selected take`);
      continue;
    }
    const greybox = shot.greybox?.final?.file ? join(shotDir, shot.greybox.final.file) : null;
    if (greybox && existsSync(greybox)) {
      // A greybox has no sound design; the reel keeps it silent rather than
      // pretending the stand-in carries ambience.
      segments.push({ ...common, source: "greybox", file: greybox, rel: relFromProject(dir, greybox), silent: true });
      continue;
    }
    missing.push(`${id}: neither a selected take nor a final greybox`);
  }
  return { segments, missing };
}

/**
 * Normalize one source to the film's spec: the trimmed range, letterboxed to
 * the frame, converted to its fps, with an audio track even when it is
 * silence — a concat of streams that do not match drops the ones that
 * differ.
 *
 * The trim is done in the FILTER graph (`trim` + `setpts`), not with `-ss`:
 * input seeking answers to keyframes and to two different meanings depending
 * on where the flag sits, and a segment that is a tenth of a second off is a
 * collage that no longer cuts on the strike.
 */
function normalizeSegment(ffmpeg, segment, spec, output) {
  const silent = segment.silent || !hasAudioStream(segment.file);
  const trim = segment.trim;
  const seconds = trim ? round4(trim.out - trim.in) : null;
  const args = ["-y", "-v", "error"];
  if (silent) args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
  args.push("-i", segment.file);

  const video = [
    ...(trim ? [`trim=start=${trim.in}:end=${trim.out}`, "setpts=PTS-STARTPTS"] : []),
    `scale=${spec.width}:${spec.height}:force_original_aspect_ratio=decrease`,
    `pad=${spec.width}:${spec.height}:(ow-iw)/2:(oh-ih)/2:color=black`,
    `fps=${spec.fps}`,
    "setsar=1",
  ].join(",");
  // Silence is generated, so it is trimmed to the length rather than out of
  // a range; `-shortest` still ends an untrimmed one with its picture.
  const audio = [
    ...(silent
      ? (seconds === null ? [] : [`atrim=0:${seconds}`])
      : (trim ? [`atrim=start=${trim.in}:end=${trim.out}`] : [])),
    "asetpts=N/SR/TB",
    "aresample=48000",
    "aformat=sample_fmts=fltp:channel_layouts=stereo",
  ].join(",");
  const vIn = silent ? "[1:v:0]" : "[0:v:0]";
  const aIn = "[0:a:0]";

  args.push(
    "-filter_complex", `${vIn}${video}[v];${aIn}${audio}[a]`,
    "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18",
    "-c:a", "aac", "-ar", "48000", "-ac", "2", "-b:a", "192k",
    "-shortest",
    output,
  );
  runToolOrFail(ffmpeg.path, args, { label: `ffmpeg segment ${segment.shot}` });
  return output;
}

function cmdCut(dir, opts) {
  requireProject(dir);
  const kind = opts.final ? "final" : "reel";
  if (opts.final && opts.reel) fail("cut takes --reel or --final, not both");
  if (!opts.final && !opts.reel) fail("cut needs --reel (greybox stands in for a missing take) or --final (every shot delivers its selected take)");
  const manifest = loadManifest(dir);
  if (manifest.shots.length === 0) fail("this film has no shots yet — add them with 'backlot.mjs shot add'");
  if (kind === "final") requireGate("cut-final", dir);

  const ffmpeg = requireTool("ffmpeg");
  requireTool("ffprobe");
  const spec = { ...DEFAULT_SPEC, ...(manifest.defaults ?? {}) };

  const { segments, missing } = planSegments(dir, manifest, kind);
  if (missing.length) {
    fail(
      kind === "final"
        ? `refusing to call this a final: ${missing.length} shot(s) do not deliver a selected take:\n  - ${missing.join("\n  - ")}\n` +
            "Select the take each one delivers (previz.mjs select), or build a reel with --reel."
        : `nothing to cut for ${missing.length} shot(s):\n  - ${missing.join("\n  - ")}\n` +
            "Render their greybox (previz.mjs render) or generate a take first.",
    );
  }

  const work = join(dir, "cut", ".work");
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const fileName = kind === "final" ? "final.mp4" : "reel.mp4";
  const output = join(dir, "cut", fileName);
  const staged = join(work, fileName);

  try {
    // 1. Every segment to the same spec, measured afterwards — the offsets
    //    in the edit list are of the file that was actually built.
    let offset = 0;
    const edl = [];
    const listLines = [];
    segments.forEach((segment, index) => {
      const normalized = join(work, `seg_${String(index + 1).padStart(3, "0")}.mp4`);
      const range = segment.trim ? ` [${segment.trim.in}–${segment.trim.out} s of the shot]` : "";
      note(`[backlot] ${segment.shot}: ${segment.source}${range} → ${spec.width}x${spec.height} @ ${spec.fps}`);
      normalizeSegment(ffmpeg, segment, spec, normalized);
      const seconds = segmentSeconds(normalized, spec.fps);
      // `in`/`out` are the shot-clock range this segment shows; `seconds` is
      // what the encoded file actually measures, so the viewer can seek by
      // the edit list and still trust the film's own length.
      const from = segment.trim ? round4(segment.trim.in) : 0;
      edl.push({
        shot: segment.shot,
        source: segment.source,
        offset: round4(offset),
        seconds: round4(seconds),
        in: from,
        out: segment.trim ? round4(segment.trim.out) : round4(from + seconds),
      });
      offset += seconds;
      listLines.push(`file '${normalized.replace(/'/g, "'\\''")}'`);
    });
    const filmSeconds = round4(offset);

    // 2. Concat, re-encoded: the segments already agree, and a stream copy
    //    across files that were encoded separately is how a cut ends up with
    //    a frozen frame at every join.
    const listFile = join(work, "segments.txt");
    writeFileSync(listFile, `${listLines.join("\n")}\n`);
    const concat = join(work, "concat.mp4");
    runToolOrFail(
      ffmpeg.path,
      ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", listFile,
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18",
        "-c:a", "aac", "-ar", "48000", "-ac", "2", "-b:a", "192k",
        "-movflags", "+faststart", concat],
      { label: "ffmpeg concat" },
    );

    // 3. The mix: take audio stays as ambience, voice-over lands at its own
    //    second of the film, music sits under everything and fades out.
    const gainDb = opts["music-db"] === undefined ? MUSIC_GAIN_DB : Number(opts["music-db"]);
    if (!Number.isFinite(gainDb)) fail(`--music-db must be a number of decibels (got: ${opts["music-db"]})`);
    const fadeOut = opts["music-fade"] === undefined ? MUSIC_FADE_OUT_S : Number(opts["music-fade"]);
    if (!Number.isFinite(fadeOut) || fadeOut < 0) fail(`--music-fade must be a non-negative number of seconds (got: ${opts["music-fade"]})`);

    const voiceOvers = [];
    const droppedVo = [];
    segments.forEach((segment, index) => {
      for (const line of segment.lines) {
        if (!line || line.kind !== "vo" || !line.file) continue;
        const file = join(segment.shotDir, line.file);
        if (!existsSync(file)) {
          note(`WARN: ${segment.shot}/${line.id} names ${line.file} but the file is gone — the cut goes without that line`);
          droppedVo.push({ shot: segment.shot, line: line.id, reason: `${line.file} is missing` });
          continue;
        }
        const at = Number(line.at ?? 0);
        const shotAt = Number.isFinite(at) ? at : 0;
        // `at` is a second on the SHOT's clock. A trimmed shot shows only
        // part of that clock, and a line spoken outside the part that
        // reaches the film has nowhere to land.
        const { in: from, out: to } = edl[index];
        if (shotAt < from - 1e-6 || shotAt > to + 1e-6) {
          const reason = `it is spoken at ${round4(shotAt)} s of the shot, outside the ${from}–${to} s the cut uses`;
          note(`WARN: ${segment.shot}/${line.id} is dropped from this cut — ${reason}`);
          droppedVo.push({ shot: segment.shot, line: line.id, at: round4(shotAt), reason });
          continue;
        }
        const start = edl[index].offset + (shotAt - from);
        if (start > filmSeconds) {
          const reason = `it would land at ${round4(start)} s, past the ${filmSeconds} s film`;
          note(`WARN: ${segment.shot}/${line.id} is dropped from this cut — ${reason}`);
          droppedVo.push({ shot: segment.shot, line: line.id, at: round4(shotAt), reason });
          continue;
        }
        voiceOvers.push({ shot: segment.shot, line: line.id, at: round4(shotAt), start: round4(start), file, rel: relFromProject(dir, file) });
      }
    });

    const soundDoc = parseJsonObject(readIfExists(join(dir, "sound", "sound.json")));
    const musicFile = soundDoc?.music?.file ? join(dir, "sound", soundDoc.music.file) : null;
    const music = musicFile && existsSync(musicFile)
      ? { file: relFromProject(dir, musicFile), path: musicFile, gainDb: round4(gainDb), fadeOutSeconds: round4(Math.min(fadeOut, filmSeconds)) }
      : null;
    if (soundDoc?.music?.file && !music) note(`WARN: sound.json names ${soundDoc.music.file} but the file is gone — the cut has no music`);
    if (music && music.fadeOutSeconds > filmSeconds / 2) {
      note(`WARN: a ${music.fadeOutSeconds} s fade-out on a ${filmSeconds} s film ramps the bed down across ${Math.round((music.fadeOutSeconds / filmSeconds) * 100)} % of it — pass --music-fade <shorter> if the music should hold`);
    }

    if (voiceOvers.length === 0 && !music) {
      copyFileSync(concat, staged);
    } else {
      const inputs = ["-i", concat];
      const graph = [];
      const mixed = ["[0:a]"];
      voiceOvers.forEach((entry, index) => {
        inputs.push("-i", entry.file);
        const label = `vo${index}`;
        graph.push(
          `[${index + 1}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,` +
            `adelay=${Math.round(entry.start * 1000)}:all=1[${label}]`,
        );
        mixed.push(`[${label}]`);
      });
      if (music) {
        const index = inputs.filter((value) => value === "-i").length;
        inputs.push("-i", music.path);
        const fadeStart = Math.max(0, filmSeconds - music.fadeOutSeconds);
        graph.push(
          `[${index}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,` +
            `atrim=0:${filmSeconds},asetpts=N/SR/TB,` +
            `volume=${music.gainDb}dB,afade=t=out:st=${fadeStart}:d=${music.fadeOutSeconds}[music]`,
        );
        mixed.push("[music]");
      }
      // `duration=first` keeps the mix exactly as long as the picture, and
      // `normalize=0` stops amix from quietly ducking the take audio every
      // time another input starts.
      graph.push(`${mixed.join("")}amix=inputs=${mixed.length}:duration=first:dropout_transition=0:normalize=0[aout]`);
      runToolOrFail(
        ffmpeg.path,
        ["-y", "-v", "error", ...inputs, "-filter_complex", graph.join(";"),
          "-map", "0:v:0", "-map", "[aout]",
          "-c:v", "copy", "-c:a", "aac", "-ar", "48000", "-ac", "2", "-b:a", "192k",
          "-movflags", "+faststart", staged],
        { label: "ffmpeg mix" },
      );
    }

    // 4. Probe what was actually built, then land it.
    const probeDoc = probeMedia(staged, { counted: true });
    const probe = probeDoc ? parseProbe(probeDoc, { bytes: existsSync(staged) ? statSync(staged).size : null }) : null;
    if (!probe) fail(`the cut was encoded but ffprobe cannot read it: ${staged}`);
    mkdirSync(dirname(output), { recursive: true });
    renameSync(staged, output);

    // 5. The edit list LAST: it describes a file that exists.
    const edlDoc = {
      version: 1,
      kind,
      file: fileName,
      seconds: probe.seconds ?? filmSeconds,
      builtAt: nowMs(opts),
      probe,
      segments: edl,
      vo: voiceOvers.map((entry) => ({ shot: entry.shot, line: entry.line, at: entry.at, start: entry.start, file: entry.rel })),
      // A line that was recorded and did NOT reach the film is part of the
      // honest projection: it is in the edit list as dropped, with why.
      droppedVo,
      music: music ? { file: music.file, gainDb: music.gainDb, fadeOutSeconds: music.fadeOutSeconds } : null,
    };
    writeJsonAtomic(join(dir, "cut", "edl.json"), edlDoc);

    const standIns = edl.filter((entry) => entry.source === "greybox").map((entry) => entry.shot);
    if (standIns.length) {
      note(`NOTE: ${standIns.length} segment(s) are greybox stand-ins (${standIns.join(", ")}) — this is a REEL, never call it the film`);
    }
    return emit({
      command: "cut",
      dir,
      kind,
      file: `cut/${fileName}`,
      seconds: edlDoc.seconds,
      probe,
      segments: edl,
      standIns,
      trimmed: segments.filter((segment) => segment.trim).map((segment) => segment.shot),
      vo: edlDoc.vo,
      droppedVo,
      music: edlDoc.music,
      edl: "cut/edl.json",
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function readIfExists(path) {
  return existsSync(path) ? readFileSync(path, "utf-8") : null;
}

function round4(value) {
  return Math.round(Number(value) * 10000) / 10000;
}

// ---------------------------------------------------------------------------
// cost
// ---------------------------------------------------------------------------

function cmdCost(dir) {
  requireProject(dir);
  const lines = costLines(readProjectTexts(dir));
  const summary = summarizeCost(lines);
  if (summary.unpriced.length) {
    note(`NOTE: ${summary.unpriced.length} paid call(s) carry no price — they are listed as unpriced, never as free`);
  }
  return emit({ command: "cost", dir, ...summary, lines });
}

// ---------------------------------------------------------------------------
// Usage and argv
// ---------------------------------------------------------------------------

const USAGE = `Usage: backlot.mjs <subcommand> [<args>] [options]

The only writer of <project>/backlot.json, bible/**/*.json, sound/sound.json
and cut/edl.json. Shots belong to previz.mjs, the prose and the Blender
script belong to the agent, and the viewer only reads. Directories are
absolute or relative to the CURRENT directory — this script never cds.

Every subcommand prints ONE JSON object on stdout and exits 0. A refusal
prints one "ERROR: …" line on stderr and exits non-zero, leaving the film
exactly as it was; progress and every line ffmpeg printed go to stderr.

THE GATE. A film moves through eight stages — ${STAGES.join(", ")} —
and a stage is empty, draft, approved or changed (approved once, then its
files moved). A paid command refuses while the stage it depends on is not
approved:
${Object.entries(GATES).map(([command, stage]) => `  ${command.padEnd(12)} needs "${stage}" approved`).join("\n")}
'gates open' satisfies every gate at once and is ONLY for a creator who has
said to run through. Image generation is not wrapped by this script — ask
'backlot.mjs gate bible-image' BEFORE you spend, then register the result.

  init <project> --title "<name>" --logline "<one sentence>"
       [--seconds 8] [--fps 24] [--width 1280] [--height 720]
      Write backlot.json and shots/. The spec is the default every shot and
      the cut use. Gates start closed.

  status <project>
      Every stage with its status, what it has cost and when it was
      approved; the gates; the scenes, the bible, the shots with their
      takes and lines; the sound and the last cut; and the first open
      stage. Never writes. The shot-level report is 'previz.mjs status'.

  approve <project> <stage> [--note "<what the creator said>"]
      Record the creator's approval of this stage together with a hash of
      the files that define it. When those files change afterwards the
      stage reads "changed" and the gate closes again. Refuses an empty
      stage.

  gates <project> open|closed
      Open every gate at once, or close them again.

  gate <project> <${Object.keys(GATES).join("|")}>
      May that command spend right now? Exit 0 with the answer, or exit 1
      with the reason and the stage that is waiting. Ask this BEFORE
      running generate_image.mjs — this script does not wrap it.

  scene add <project> --id sc1 --heading "INT. 便利店 — 夜" [--number 1]
            [--summary "…"]
  scene set <project> --id sc1 [--number --heading --summary]
      The screenplay's scenes, in the order the film plays them.

  shot add <project> <id> --title "<what happens>" [--scene sc1]
           [--characters kai,clerk] [--set store] [--entry original|recreate]
           [--seconds --fps --size 1280x720]
      Append the shot to the film's order and scaffold shots/<id>/ through
      previz.mjs: shot.json with the acceptance list seeded, shot-plan.md,
      prompts.md, comparison.md and a greybox/scene.py that already renders.

  character add <project> <id> --name "…" [--description "…"] [--look "…"]
  character set <project> <id> [--name --description --look]
  character look <project> <id> --file <sheet.png> --prompt "…"
                 [--cost-usd 0.13 --cost-basis reported] [--move]
  character voice <project> <id> --text "<a line in their voice>"
                  [--model --voice --style --language]
                  [--cost-usd --cost-basis]
  set add|set|look <project> <id> …        (a "set" is a place)
      The bible. 'look' registers a frame you generated with
      generate_image.mjs (gated: the script must be approved) and bumps its
      revision; 'voice' synthesizes the sample a take is conditioned on
      (gated: the script must be approved).

  music <project> --prompt "<the brief>" [--seconds 30]
        [--cost-usd --cost-basis]
      Generate the music bed through generate-bgm.mjs into sound/music.mp3
      and record it in sound/sound.json with its measured length. Lyria has
      no duration parameter — --seconds is a hint in the prompt, and the cut
      trims and fades the bed to the film. Gated: takes must be approved.

  cut <project> --reel | --final [--music-db=${MUSIC_GAIN_DB}] [--music-fade ${MUSIC_FADE_OUT_S}]
      Assemble the film: every shot in order, cut to the range its shot's
      trim names ('previz.mjs meta --trim-in/--trim-out'; the whole shot
      when it has none), scaled and frame-rate matched to the project spec,
      concatenated with a re-encode; take audio kept as ambience, voice-over
      placed at its second of the film, music laid under at ${MUSIC_GAIN_DB} dB with a
      ${MUSIC_FADE_OUT_S} s fade-out. Writes cut/reel.mp4 or cut/final.mp4, probes it, and
      writes cut/edl.json LAST — each segment with the shot-clock in/out it
      shows. A voice-over spoken outside its shot's trim is DROPPED and
      listed, with the reason, in the report and the edit list. A negative
      decibel value needs the '=' spelling: --music-db=-22.
      --reel stands the greybox in for any shot without a selected take and
      labels those segments; --final REFUSES while any shot lacks one.
      Gated (--final only): sound must be approved.

  cost <project>
      Every paid call the files record — sheets, voices, boards, takes,
      voice-over, music — totalled by stage and by kind. There is no ledger:
      each number is read off the artefact it paid for, and a call with no
      recorded price is listed as unpriced, never as free.

Every price is a list price or a vendor's own report, never a bill.`;

const OPTIONS = {
  help: { type: "boolean", short: "h" },
  json: { type: "boolean" },
  now: { type: "string" },
  title: { type: "string" },
  logline: { type: "string" },
  seconds: { type: "string" },
  fps: { type: "string" },
  width: { type: "string" },
  height: { type: "string" },
  size: { type: "string" },
  entry: { type: "string" },
  id: { type: "string" },
  number: { type: "string" },
  heading: { type: "string" },
  summary: { type: "string" },
  scene: { type: "string" },
  characters: { type: "string" },
  set: { type: "string" },
  name: { type: "string" },
  description: { type: "string" },
  look: { type: "string" },
  file: { type: "string" },
  move: { type: "boolean" },
  prompt: { type: "string" },
  text: { type: "string" },
  model: { type: "string" },
  voice: { type: "string" },
  style: { type: "string" },
  language: { type: "string" },
  note: { type: "string" },
  "cost-usd": { type: "string" },
  "cost-basis": { type: "string" },
  reel: { type: "boolean" },
  final: { type: "boolean" },
  "music-db": { type: "string" },
  "music-fade": { type: "string" },
};

/** Groups take an ACTION before the project directory: `scene add <dir>`,
 *  `character look <dir> <id>`. Everything else takes the directory first. */
const GROUPS = {
  scene: ["add", "set"],
  shot: ["add"],
  character: ["add", "set", "look", "voice"],
  set: ["add", "set", "look"],
};

export async function main(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  } catch (error) {
    fail(`${error.message}\n\n${USAGE}`);
  }
  const opts = parsed.values;
  const [subcommand, second, third, fourth] = parsed.positionals;

  if (opts.help || (!subcommand && argv.length === 0)) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (!SUBCOMMANDS.includes(subcommand)) {
    fail(`unknown subcommand "${subcommand ?? ""}" (expected: ${SUBCOMMANDS.join(", ")})\n\n${USAGE}`);
  }

  if (GROUPS[subcommand]) {
    const action = second;
    if (!GROUPS[subcommand].includes(action)) {
      fail(`${subcommand} takes ${GROUPS[subcommand].join("|")} (got: ${action ?? ""}) — e.g. 'backlot.mjs ${subcommand} ${GROUPS[subcommand][0]} <project> …'`);
    }
    if (!third) fail(`${subcommand} ${action} needs a project directory: backlot.mjs ${subcommand} ${action} <project> …`);
    const dir = resolveInput(third);
    switch (subcommand) {
      case "scene": return cmdScene(action, dir, opts);
      case "shot": return cmdShotAdd(dir, fourth, opts);
      case "character":
        if (action === "add") return cmdBibleAdd("characters", dir, fourth, opts);
        if (action === "set") return cmdBibleSet("characters", dir, fourth, opts);
        if (action === "look") return cmdBibleLook("characters", dir, fourth, opts);
        return cmdCharacterVoice(dir, fourth, opts);
      case "set":
        if (action === "add") return cmdBibleAdd("sets", dir, fourth, opts);
        if (action === "set") return cmdBibleSet("sets", dir, fourth, opts);
        return cmdBibleLook("sets", dir, fourth, opts);
      default: return fail(`unhandled group "${subcommand}"`);
    }
  }

  if (!second) fail(`${subcommand} needs a project directory: backlot.mjs ${subcommand} <project> …`);
  const dir = resolveInput(second);
  switch (subcommand) {
    case "init": return cmdInit(dir, opts);
    case "status": return cmdStatus(dir);
    case "approve": return cmdApprove(dir, third, opts);
    case "gates": return cmdGates(dir, third);
    case "gate": return cmdGate(dir, third);
    case "music": return cmdMusic(dir, opts);
    case "cut": return cmdCut(dir, opts);
    case "cost": return cmdCost(dir);
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

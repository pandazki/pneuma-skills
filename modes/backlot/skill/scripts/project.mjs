/**
 * project.mjs — the film's project, as BOTH scripts have to read it.
 *
 * `backlot.mjs` owns `backlot.json`; `previz.mjs` owns every `shot.json`.
 * They still have to agree on three things, and a second copy of any of them
 * is a place where the two scripts can quietly disagree about whether money
 * may be spent:
 *
 *  1. WHERE the project is — a shot directory knows its film by walking up
 *     to the nearest `backlot.json`;
 *  2. WHAT the stage machine reads — one `texts` map, built the same way for
 *     `stage-state.mjs` here and for `domain.ts` in the browser;
 *  3. WHETHER a paid command may run — one `gateCheck`, one refusal
 *     sentence, one hint.
 *
 * It also resolves the shared scripts (`generate-tts.mjs`, `generate-bgm.mjs`,
 * `transcribe.mjs`) the same way `previz.mjs` resolves Seedance: the copy
 * installed beside this CLI first, the source checkout second, and an
 * env override that every run announces on stderr — a file made by something
 * other than the vendor must never be mistaken for one that was.
 *
 * I/O lives here; nothing in this module exits the process. Callers turn a
 * thrown error into their own one-line refusal.
 */

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { gateCheck } from "./stage-state.mjs";

export const PROJECT_FILE = "backlot.json";
export const SHOT_FILE = "shot.json";

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Where things are
// ---------------------------------------------------------------------------

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function subdirectories(path) {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

export function projectPathOf(dir) {
  return join(dir, PROJECT_FILE);
}

export function shotPathOf(dir) {
  return join(dir, SHOT_FILE);
}

/**
 * The nearest directory at or above `start` that holds a `backlot.json`,
 * or null. This is how a shot command finds the film it is gated on; a
 * shot directory is always `<project>/shots/<id>`.
 */
export function findProjectRoot(start) {
  let dir = isAbsolute(start) ? start : resolve(start);
  for (;;) {
    if (isFile(join(dir, PROJECT_FILE))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** A path as the project files spell it: relative, forward slashes. */
export function relFromProject(projectDir, absolute) {
  return relative(projectDir, absolute).split(sep).join("/");
}

function projectFile(projectDir, rel) {
  return join(projectDir, ...String(rel).split("/"));
}

// ---------------------------------------------------------------------------
// The texts a stage is derived from
// ---------------------------------------------------------------------------

/**
 * Every TEXT file that can define a stage, keyed by its project-relative
 * path — exactly the map `stage-state.mjs` documents and `domain.ts` builds
 * from the viewer's file list.
 *
 * Media never enters it: a media file's identity is the `{ file, revision }`
 * record the JSON beside it carries. Directories are listed rather than read
 * from `backlot.json`'s arrays, so a shot or a character that exists on disk
 * but was never registered still counts as content — the alternative is a
 * stage that reads `approved` because the thing that changed was invisible.
 */
export function readProjectTexts(dir) {
  const texts = {};
  const put = (rel) => {
    const path = projectFile(dir, rel);
    if (isFile(path)) texts[rel] = readFileSync(path, "utf-8");
  };
  put(PROJECT_FILE);
  put("idea.md");
  put("screenplay.md");
  put("sound/sound.json");
  put("cut/edl.json");
  for (const id of subdirectories(join(dir, "bible", "characters"))) put(`bible/characters/${id}/character.json`);
  for (const id of subdirectories(join(dir, "bible", "sets"))) put(`bible/sets/${id}/set.json`);
  for (const id of subdirectories(join(dir, "shots"))) put(`shots/${id}/shot.json`);
  return texts;
}

/** Parsed JSON, or null for anything that is not a JSON object. */
export function parseJsonObject(text) {
  if (typeof text !== "string") return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * The project manifest, normalized enough that every caller can read its
 * arrays without repeating the same three guards. Throws when the file is
 * missing or unparsable — a film whose manifest cannot be read must not be
 * treated as a film with no shots.
 */
export function readManifest(dir) {
  const path = projectPathOf(dir);
  if (!isFile(path)) {
    throw new Error(`no ${PROJECT_FILE} in ${dir} — run 'backlot.mjs init <project> --title "…" --logline "…"' first`);
  }
  let doc;
  try {
    doc = JSON.parse(readFileSync(path, "utf-8"));
  } catch (error) {
    throw new Error(`${path} is not valid JSON (${error.message})`);
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new Error(`${path} is not a JSON object`);
  return normalizeManifest(doc);
}

function normalizeManifest(doc) {
  const manifest = { ...doc };
  manifest.version = manifest.version ?? 1;
  manifest.title = manifest.title ?? "";
  manifest.logline = manifest.logline ?? "";
  manifest.gates = manifest.gates === "open" ? "open" : "closed";
  manifest.approvals = manifest.approvals && typeof manifest.approvals === "object" && !Array.isArray(manifest.approvals)
    ? manifest.approvals
    : {};
  for (const key of ["scenes", "characters", "sets", "shots"]) {
    manifest[key] = Array.isArray(manifest[key]) ? manifest[key] : [];
  }
  return manifest;
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

/**
 * May `command` spend, in the project at `projectDir`?
 *
 * One reading of the files, one verdict, for both scripts. `texts` and
 * `manifest` come back with it so a caller that is about to write does not
 * read the same eight files twice.
 */
export function projectGate(command, projectDir) {
  const texts = readProjectTexts(projectDir);
  const manifest = parseJsonObject(texts[PROJECT_FILE]);
  return { ...gateCheck(command, texts, manifest), texts, manifest };
}

/**
 * The refusal an agent reads: the gate's own reason VERBATIM, then the two
 * ways past it. Approval is the creator's; open gates are the creator's too.
 */
export function gateRefusal(result, projectDir) {
  const where = projectDir ?? "<project>";
  return (
    `${result.reason}\n` +
    `  - show the creator the stage, then: backlot.mjs approve ${where} ${result.stage}\n` +
    `  - or, only if they said to run through: backlot.mjs gates ${where} open`
  );
}

// ---------------------------------------------------------------------------
// The shared scripts
// ---------------------------------------------------------------------------

/**
 * Where a shared script lives right now.
 *
 * An installed session keeps the shared scripts beside this CLI (the manifest
 * lists them in `skill.sharedScripts`); a source checkout resolves them from
 * `modes/_shared/scripts/`. `overrideEnv` names the environment variable that
 * replaces it — that is how a test exercises the whole command without
 * sending anything to a vendor, and every run that uses one says so.
 */
export function sharedScript(name, overrideEnv) {
  const override = overrideEnv ? process.env[overrideEnv] : undefined;
  if (override) {
    return { path: isAbsolute(override) ? override : resolve(process.cwd(), override), source: overrideEnv, overridden: true };
  }
  const installed = join(HERE, name);
  if (isFile(installed)) return { path: installed, source: "installed", overridden: false };
  const checkout = resolve(HERE, "..", "..", "..", "_shared", "scripts", name);
  if (isFile(checkout)) return { path: checkout, source: "checkout", overridden: false };
  return { path: null, source: null, overridden: false };
}

/**
 * Run one shared script as a child `node` process and hand back what it
 * printed. The environment is inherited, so the key discovery those scripts
 * document (`FAL_KEY` / `OPENROUTER_API_KEY`, then the skill's `.env`) is
 * exactly the one the agent gets when it runs them by hand. No key is ever
 * read into this process, and none appears in any output.
 */
export function runNodeScript(path, args, { timeoutMs = 900_000 } = {}) {
  const result = spawnSync(process.execPath, [path, ...args], {
    encoding: "utf-8",
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) return { code: 127, stdout: "", stderr: result.error.message, timedOut: result.error.code === "ETIMEDOUT" };
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    timedOut: result.signal === "SIGTERM" && result.status === null,
  };
}

/** The LAST JSON object a script printed on stdout, or null. */
export function lastJsonObject(stdout) {
  const lines = String(stdout ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const parsed = parseJsonObject(lines[index]);
    if (parsed) return parsed;
  }
  // A pretty-printed object spans lines; try the whole stream once.
  return parseJsonObject(String(stdout ?? "").trim());
}


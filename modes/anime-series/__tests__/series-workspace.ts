/**
 * A series in mid-season for the viewer-side tests, made the way a real one
 * is: the shipped seed, taken back to the moment before anything was shot
 * (`plannedSeed`), copied to a temp dir and driven through series.mjs with
 * generation mocked (scripts-mock-generators.mjs, no network, no ffmpeg).
 * The viewer reads it through the same text files the server's snapshot
 * would carry.
 *
 * After `buildSeriesWorkspace()`:
 *   ep01 (30 s)  two storyboards (board-1, board-2), one take; checks on it:
 *                shot 1 guang+niuma ok, shot 2 guang absent, shot 7 niuma
 *                drift. Then niuma's look changed and the bible re-locked
 *                as v2, so ep01 is "shot under v1".
 *   ep02 (60 s)  two parts of nine shots, one storyboard each, no take.
 *   A lineup of the picked character sheets.
 */

import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ViewerFileContent } from "../../../core/types/viewer-contract.js";
import { dropAssets, failAsset, orderCraftKeys, readProjectFile, reserveAsset, validateProjectFile } from "../../_shared/scripts/craft-project.mjs";
import type { SeriesSidecar } from "../skill/scripts/series-state.mjs";

const SERIES = join(import.meta.dir, "..", "skill", "scripts", "series.mjs");
const MOCK = join(import.meta.dir, "scripts-mock-generators.mjs");
export const SEED_DIR = join(import.meta.dir, "..", "seed", "guang-niuma");
export const T0 = 1793300000000;

const made: string[] = [];

export function cleanupWorkspaces(): void {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

function cli(dir: string, argv: string[]): void {
  const r = Bun.spawnSync([process.execPath, SERIES, ...argv, "--dir", dir], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ANIME_SERIES_GENERATORS: MOCK, MOCK_LOG: "", MOCK_FAIL: "", MOCK_NO_KEYS: "", MOCK_REAL_MEDIA: "" },
  });
  if (r.exitCode !== 0) throw new Error(`series.mjs ${argv.join(" ")} failed (${r.exitCode}):\n${r.stderr.toString()}`);
}

/**
 * The shipped seed as a new series stands before its first shoot: the locked
 * bible, every design sheet candidate with its check, and each episode's
 * written shot list. The seed itself is a finished run (ep01 boarded, shot,
 * checked, patched and spliced); these tests shoot ep01 themselves, so every
 * asset that is not a sheet candidate is dropped through craft's rules, the
 * sidecar slots that pointed at them are emptied, their files are removed,
 * and the episodes' picks (pointers into the dropped assets) are cleared.
 * The episodes' text — shots, continuity, log — stays as the seed wrote it.
 */
function plannedSeed(dir: string): void {
  const projectPath = join(dir, "project.json");
  const parsed = readProjectFile<{ series: SeriesSidecar }>(readFileSync(projectPath, "utf-8"), { sidecarKey: "series" });
  if (!parsed.ok) throw new Error(`shipped seed project.json: ${parsed.error}`);
  const doc = parsed.value;
  const sheets = new Set(Object.values(doc.series.sheets).flatMap((slot) => slot.candidates.map((c) => c.asset)));
  const shot = doc.assets.filter((a) => !sheets.has(a.id));
  dropAssets(doc, shot.map((a) => a.id));
  doc.series = { ...doc.series, episodes: {}, lineups: [], compilations: [] };
  const checked = validateProjectFile(doc, { sidecarKey: "series" });
  if (!checked.ok) throw new Error(`planned seed project.json: ${checked.error}`);
  writeFileSync(projectPath, `${JSON.stringify(orderCraftKeys(checked.value), null, 2)}\n`);
  for (const asset of shot) if (asset.uri) rmSync(join(dir, asset.uri), { force: true });

  const episodes = join(dir, "episodes");
  for (const id of existsSync(episodes) ? readdirSync(episodes) : []) {
    const path = join(episodes, id, "episode.json");
    if (!existsSync(path)) continue;
    const episode = JSON.parse(readFileSync(path, "utf-8"));
    writeFileSync(path, `${JSON.stringify({ ...episode, picks: {} }, null, 2)}\n`);
  }
}

export function buildSeriesWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "anime-series-viewer-"));
  made.push(dir);
  cpSync(SEED_DIR, dir, { recursive: true });
  plannedSeed(dir);
  let t = T0;
  const at = () => String((t += 60_000));
  cli(dir, ["shoot-board", "--episode", "ep01", "--at", at()]);
  cli(dir, ["shoot-board", "--episode", "ep01", "--at", at()]);
  cli(dir, ["shoot-video", "--episode", "ep01", "--at", at()]);
  cli(dir, ["verdict", "--episode", "ep01", "--shot", "1", "--character", "guang,niuma", "--verdict", "ok", "--at", at()]);
  cli(dir, ["verdict", "--episode", "ep01", "--shot", "2", "--character", "guang", "--verdict", "absent", "--at", at()]);
  cli(dir, ["verdict", "--episode", "ep01", "--shot", "7", "--character", "niuma", "--verdict", "drift", "--note", "right horn missing", "--at", at()]);

  const ep01 = JSON.parse(readFileSync(join(dir, "episodes", "ep01", "episode.json"), "utf-8"));
  const shots = ep01.parts[0].shots;
  writeFileSync(join(dir, "two-parts.json"), JSON.stringify([shots, shots]));
  cli(dir, ["add-episode", "--episode", "ep02", "--title", "Two parts", "--duration", "60", "--cast", "guang,niuma", "--scene", "office-night", "--time", "night", "--shots-file", join(dir, "two-parts.json"), "--at", at()]);
  cli(dir, ["shoot-board", "--episode", "ep02", "--at", at()]);
  cli(dir, ["lineup", "--at", at()]);

  const bible = JSON.parse(readFileSync(join(dir, "bible.json"), "utf-8"));
  const niuma = bible.characters.find((c: { id: string }) => c.id === "niuma");
  cli(dir, ["set-character", "--id", "niuma", "--look", `${niuma.look}; one horn chipped`, "--at", at()]);
  cli(dir, ["lock", "--at", at()]);
  return dir;
}

/** The text files the viewer's watchPatterns select, as the snapshot carries them. */
export function readSeriesFiles(dir: string): ViewerFileContent[] {
  const files: ViewerFileContent[] = [];
  for (const name of ["bible.json", "project.json"]) {
    const path = join(dir, name);
    if (existsSync(path)) files.push({ path: name, content: readFileSync(path, "utf-8") });
  }
  const episodes = join(dir, "episodes");
  if (existsSync(episodes)) {
    for (const id of readdirSync(episodes).sort()) {
      const path = join(episodes, id, "episode.json");
      if (existsSync(path)) files.push({ path: `episodes/${id}/episode.json`, content: readFileSync(path, "utf-8") });
    }
  }
  return files;
}

export function withFile(files: ViewerFileContent[], path: string, content: string): ViewerFileContent[] {
  const rest = files.filter((f) => f.path !== path);
  return [...rest, { path, content }];
}

/** The asset id `withFailedTake` adds. */
export const FAILED_TAKE = "ep01-a-take-failed";

/**
 * The shipped seed with a second ep01 take that failed after it was sent:
 * reserved and failed through craft's own writers, billing `unknown` — the
 * state a provider disconnect leaves. Text files only; nothing is fetched.
 */
export function withFailedTake(files: ViewerFileContent[], reason = "provider disconnected after submission"): ViewerFileContent[] {
  const project = files.find((f) => f.path === "project.json");
  if (!project) throw new Error("no project.json");
  const doc = JSON.parse(project.content);
  const part = doc.series.episodes.ep01.parts.A;
  const take = structuredClone(part.takes[0]);
  reserveAsset(
    doc,
    {
      id: FAILED_TAKE,
      type: "video",
      name: "ep01 part A take",
      op: "generate",
      from: take.refs,
      model: "bytedance/seedance-2.5",
      provider: "fal",
      prompt: "test fixture",
      cost: { usd: 6.1887, basis: "estimate" },
      generating: true,
      params: { slot: { command: "shoot-video", episode: "ep01", part: "A" }, request: { duration: 30, resolution: "480p" } },
    },
    T0,
  );
  part.takes.push({ ...take, asset: FAILED_TAKE });
  failAsset(doc, { id: FAILED_TAKE, reason, billing: "unknown" }, T0 + 60_000);
  return withFile(files, "project.json", `${JSON.stringify(doc, null, 2)}\n`);
}

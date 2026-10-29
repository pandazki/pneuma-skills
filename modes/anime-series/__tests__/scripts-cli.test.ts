/**
 * series.mjs as a real process, on a temp workspace, with generation mocked
 * (ANIME_SERIES_GENERATORS → scripts-mock-generators.mjs; no network).
 *
 * The cheap tier needs no ffmpeg: mocked images are WebP headers the craft
 * prober reads directly, mocked clips are placeholder bytes that land with a
 * named warning. The ffmpeg steps (compare image, panel composite, contact
 * sheets, final, season) run in the media tier on real ffmpeg-drawn files.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { announceMediaTierSkip, mediaTierEnabled } from "../../../core/__tests__/test-tier.js";
import { summarizeCosts } from "../../_shared/scripts/craft-project.mjs";
import type { Bible, EpisodeFile, SeriesSidecar } from "../skill/scripts/series-state.mjs";

const SERIES = join(import.meta.dir, "..", "skill", "scripts", "series.mjs");
const MOCK = join(import.meta.dir, "scripts-mock-generators.mjs");
const T0 = 1793000000000;

const SHOTS = [
  { dur: 3, desc: "wide: Lamp eyes the clock, Ox already packed", sfx: "ticking" },
  { dur: 3, desc: "the sticky notes peel off the wall", sfx: "rustle" },
  { dur: 3, desc: "Lamp stretches its arm across the desks", sfx: "creak", sketch: "Lamp's arm over the desks" },
  { dur: 3, desc: "the notes stick Lamp's arm to a desk", sfx: "splat" },
  { dur: 4, desc: "Ox charges with Lamp on its back", sfx: "drum roll" },
  { dur: 3, desc: "Ox bursts through the swarm", sfx: "paper burst" },
  { dur: 3, desc: "the door is locked", sfx: "rattle" },
  { dur: 4, desc: "six o'clock, the door opens, both fall through", sfx: "bell" },
  { dur: 4, desc: "freeze: a blank note lands on Ox's face", sfx: "whistle" },
];

const dirs: string[] = [];
function fresh(prefix = "anime-series-cli-") {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

interface Run { code: number; out: string; err: string }

function run(dir: string, argv: string[], env: Record<string, string> = {}): Run {
  const r = Bun.spawnSync([process.execPath, SERIES, ...argv, "--dir", dir], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ANIME_SERIES_GENERATORS: MOCK, MOCK_LOG: join(dir, ".mock-log.jsonl"), MOCK_FAIL: "", MOCK_NO_KEYS: "", MOCK_REAL_MEDIA: "", ...env },
  });
  return { code: r.exitCode ?? -1, out: r.stdout.toString(), err: r.stderr.toString() };
}

function ok(dir: string, argv: string[], env: Record<string, string> = {}) {
  const r = run(dir, [...argv, "--json", "--at", String(T0)], env);
  if (r.code !== 0) throw new Error(`series ${argv.join(" ")} failed (${r.code}):\n${r.err}`);
  return JSON.parse(r.out);
}

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf-8"));

/** A VP8X WebP header — what a human-made image looks like to the prober, without ffmpeg. */
function webpHeader(width: number, height: number) {
  const b = Buffer.alloc(30);
  b.write("RIFF", 0, "latin1");
  b.writeUInt32LE(22, 4);
  b.write("WEBPVP8X", 8, "latin1");
  b.writeUInt32LE(10, 16);
  b.writeUIntLE(width - 1, 24, 3);
  b.writeUIntLE(height - 1, 27, 3);
  return b;
}
const project = (dir: string) => readJson(join(dir, "project.json"));
const sidecarOf = (dir: string): SeriesSidecar => project(dir).series;
const bibleOf = (dir: string): Bible => readJson(join(dir, "bible.json"));
const episodeOf = (dir: string, id = "ep01"): EpisodeFile => readJson(join(dir, "episodes", id, "episode.json"));
const assetOf = (dir: string, id: string) => project(dir).assets.find((a: { id: string }) => a.id === id);
const edgeOf = (dir: string, id: string) => project(dir).provenance.find((e: { toAssetId: string }) => e.toAssetId === id);
const mockLog = (dir: string) => existsSync(join(dir, ".mock-log.jsonl"))
  ? readFileSync(join(dir, ".mock-log.jsonl"), "utf-8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
  : [];

/** A workspace with the bible written and ep01 planned (no paid calls yet). */
function seedText(dir: string, extraEnv: Record<string, string> = {}) {
  ok(dir, ["init", "--title", "Lamp and Ox"], extraEnv);
  ok(dir, ["set-series", "--style", "Soft 3D animated look.", "--sheet-style", "Soft 3D sheet on white."], extraEnv);
  ok(dir, ["set-character", "--id", "lamp", "--name", "Lamp", "--look", "a small desk lamp with a brass shade", "--ability", "bends its arm to any length", "--palette", "#d4a017", "--pose", "standing", "--pose", "arm stretched across a desk"], extraEnv);
  ok(dir, ["set-character", "--id", "ox", "--name", "Ox", "--look", "a stout ox in a blue tie"], extraEnv);
  ok(dir, ["set-group", "--id", "notes", "--name", "Sticky Notes", "--look", "yellow sticky notes that flap like birds"], extraEnv);
  ok(dir, ["set-scene", "--id", "office", "--name", "open-plan office", "--look", "rows of desks at dusk"], extraEnv);
  writeFileSync(join(dir, "shots.json"), JSON.stringify(SHOTS));
  ok(dir, ["add-episode", "--title", "Clock Out", "--cast", "lamp,ox", "--groups", "notes", "--scene", "office", "--time", "dusk", "--continuity", "runs go left to right", "--shots-file", join(dir, "shots.json")], extraEnv);
}

/** …plus both cast sheets made (lamp: 2 candidates, picked #2; ox: 1, picked) and the bible locked as v1. */
function seedSheets(dir: string, extraEnv: Record<string, string> = {}) {
  seedText(dir, extraEnv);
  ok(dir, ["make-sheets", "--character", "lamp"], extraEnv);
  ok(dir, ["make-sheets", "--character", "ox", "--count", "1", "--pick"], extraEnv);
  ok(dir, ["pick", "--character", "lamp", "--sheet", "char-lamp-sheet-2"], extraEnv);
  ok(dir, ["lock"], extraEnv);
}

let sheetsTemplate = "";
function withSheets() {
  if (!sheetsTemplate) {
    sheetsTemplate = fresh("anime-series-template-");
    seedSheets(sheetsTemplate);
  }
  const dir = fresh();
  cpSync(sheetsTemplate, dir, { recursive: true });
  rmSync(join(dir, ".mock-log.jsonl"), { force: true });
  return dir;
}

describe("series.mjs CLI", () => {
  test("--help lists every command; unknown commands and flags are refused", () => {
    const help = Bun.spawnSync([process.execPath, SERIES, "--help"], { stderr: "pipe" });
    expect(help.exitCode).toBe(0);
    const text = help.stderr.toString();
    for (const command of ["init", "set-series", "set-character", "set-group", "set-scene", "lock", "pick", "add-episode", "set-episode", "set-shot", "log", "ideas-context", "prompts", "estimate", "status", "validate", "make-sheets", "check-sheets", "shoot-board", "redo-panel", "shoot-video", "patch-range", "retry", "review-episode", "frames", "verdict", "final", "compile-season"]) {
      expect(text).toContain(`  ${command}`);
    }
    const dir = fresh();
    expect(run(dir, ["fly"]).err).toContain("unknown command 'fly'");
    expect(run(dir, ["status", "--wings"]).code).toBe(1);
  });

  test("init → bible → episode writes the three files in their documented shapes", () => {
    const dir = fresh();
    seedText(dir);
    const bible = bibleOf(dir);
    expect(bible.title).toBe("Lamp and Ox");
    expect(bible.characters.map((c) => c.id)).toEqual(["lamp", "ox"]);
    expect(bible.characters[0]).toMatchObject({ name: "Lamp", ability: "bends its arm to any length", palette: ["#d4a017"], poses: ["standing", "arm stretched across a desk"], sheet: null });
    expect(bible.locks).toEqual([]);
    const episode = episodeOf(dir);
    expect(Object.keys(episode)).toEqual(["title", "duration", "cast", "groups", "scene", "time", "continuity", "parts", "log", "picks"]);
    expect(episode.parts).toHaveLength(1);
    expect(episode.parts[0].id).toBe("A");
    expect(episode.parts[0].shots[2]).toEqual({ dur: 3, desc: "Lamp stretches its arm across the desks", sfx: "creak", sketch: "Lamp's arm over the desks" });
    const doc = project(dir);
    expect(doc.$schema).toBe("pneuma-craft/project/v1");
    expect(doc.series).toEqual({ schema: 1, sheets: {}, episodes: {}, compilations: [], lineups: [] });
    expect(ok(dir, ["validate"]).ok).toBe(true);
  });

  test("an episode that breaks the timing rules is refused before it is written", () => {
    const dir = fresh();
    seedText(dir);
    writeFileSync(join(dir, "bad.json"), JSON.stringify([{ dur: 1.5, desc: "too fast" }, { dur: 13.5, desc: "rest" }]));
    const r = run(dir, ["add-episode", "--episode", "ep02", "--title", "Bad", "--duration", "15", "--cast", "lamp", "--shots-file", join(dir, "bad.json")]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("at least 2 s");
    expect(existsSync(join(dir, "episodes", "ep02", "episode.json"))).toBe(false);
    const unknown = run(dir, ["add-episode", "--episode", "ep03", "--title", "Who", "--cast", "goose"]);
    expect(unknown.err).toContain('cast "goose" is not a character in bible.json');
  });

  test("set-shot rebalances the neighbours, keeps the total, and refuses what cannot fit", () => {
    const dir = fresh();
    seedText(dir);
    const out = ok(dir, ["set-shot", "--episode", "ep01", "--shot", "5", "--dur", "5"]);
    expect(out.durations).toEqual([3, 3, 3, 2.5, 5, 2.5, 3, 4, 4]);
    expect(episodeOf(dir).parts[0].shots.reduce((s, x) => s + x.dur, 0)).toBe(30);
    const tooLong = run(dir, ["set-shot", "--episode", "ep01", "--shot", "5", "--dur", "8"]);
    expect(tooLong.code).toBe(1);
    expect(tooLong.err).toContain("can grow to at most");
    expect(episodeOf(dir).parts[0].shots[4].dur).toBe(5);
  });

  test("make-sheets reserves, lands and records each candidate; nothing is auto-picked from several", () => {
    const dir = fresh();
    seedText(dir);
    const out = ok(dir, ["make-sheets", "--character", "lamp"]);
    expect(out.results.map((r: { id: string; status: string }) => [r.id, r.status])).toEqual([["char-lamp-sheet-1", "ready"], ["char-lamp-sheet-2", "ready"]]);
    expect(sidecarOf(dir).sheets["character:lamp"].candidates.map((c) => c.asset)).toEqual(["char-lamp-sheet-1", "char-lamp-sheet-2"]);
    expect(bibleOf(dir).characters[0].sheet).toBeNull();
    const edge = edgeOf(dir, "char-lamp-sheet-1");
    expect(edge.operation.type).toBe("generate");
    expect(edge.operation.params).toMatchObject({ provider: "openrouter", model: "openai/gpt-image-2.5-flare", cost: { usd: 0.05, basis: "reported" } });
    expect(edge.operation.params.prompt).toContain('the name "Lamp" written in the top-left corner');
    expect(assetOf(dir, "char-lamp-sheet-1")).toMatchObject({ status: "ready", uri: "refs/char-lamp-sheet-1.webp", metadata: { width: 1024, height: 1024 } });
    // A pick must name a ready candidate of that entity.
    expect(run(dir, ["pick", "--character", "ox", "--sheet", "char-lamp-sheet-1"]).err).toContain("is not a sheet candidate of character \"ox\"");
  });

  test("a dry run prints the exact request with files named, and writes nothing", () => {
    const dir = withSheets();
    ok(dir, ["shoot-board", "--episode", "ep01"]);
    const before = readFileSync(join(dir, "project.json"), "utf-8");
    const out = ok(dir, ["shoot-video", "--episode", "ep01", "--dry-run"]);
    expect(readFileSync(join(dir, "project.json"), "utf-8")).toBe(before);
    expect(mockLog(dir).filter((l: { kind: string }) => l.kind === "video")).toEqual([]);
    const [request] = out.requests;
    // Where the request actually goes: fal's queue (fal-queue.mjs), not the synchronous host.
    expect(request.url).toBe("https://queue.fal.run/bytedance/seedance-2.5/reference-to-video");
    expect(request.body.image_urls).toEqual([
      expect.stringContaining("@Image1 refs/char-lamp-sheet-2.webp"),
      expect.stringContaining("@Image2 refs/char-ox-sheet-1.webp"),
      expect.stringContaining("@Image3 episodes/ep01/boards/a-1.webp"),
    ]);
    expect(request.body).toMatchObject({ duration: "30", resolution: "480p", aspect_ratio: "16:9", generate_audio: true });
    expect(request.body.prompt.startsWith("Make an animated video from the storyboard @Image3.")).toBe(true);
    expect(request.cost).toMatchObject({ usd: 6.168, basis: "estimate" });
  });

  test("shoot-board → shoot-video: references in method order, the take records what it was made under", () => {
    const dir = withSheets();
    ok(dir, ["shoot-board", "--episode", "ep01"]);
    const board = sidecarOf(dir).episodes.ep01.parts.A!.boards[0];
    expect(board.asset).toBe("ep01-a-board-1");
    expect(board.refs).toEqual(["char-lamp-sheet-2", "char-ox-sheet-1"]);
    expect(board.basis.version).toBe(1);
    expect(board.shots).toHaveLength(9);
    const shot = ok(dir, ["shoot-video", "--episode", "ep01"]);
    expect(shot.results[0]).toMatchObject({ id: "ep01-a-take-1", status: "ready" });
    expect(shot.results[0].warning).toContain("ffprobe could not read");
    const video = mockLog(dir).find((l: { kind: string }) => l.kind === "video");
    expect(video.refImages.map((f: string) => f.split("/").slice(-2).join("/"))).toEqual(["refs/char-lamp-sheet-2.webp", "refs/char-ox-sheet-1.webp", "boards/a-1.webp"]);
    expect(video).toMatchObject({ duration: "30", resolution: "480p", aspectRatio: "16:9" });
    expect(video.prompt.split("\n").at(-1)).toBe("No text, subtitles, captions or logos anywhere in the frame.");
    const take = sidecarOf(dir).episodes.ep01.parts.A!.takes[0];
    expect(take).toMatchObject({ asset: "ep01-a-take-1", board: "ep01-a-board-1", refs: ["char-lamp-sheet-2", "char-ox-sheet-1", "ep01-a-board-1"], resolution: "480p", seconds: 30 });
    expect(take.basis.version).toBe(1);
    expect(take.durs).toEqual(SHOTS.map((s) => s.dur));
    const edge = edgeOf(dir, "ep01-a-take-1");
    expect(edge.fromAssetId).toBe("char-lamp-sheet-2");
    expect(edge.operation.params.inputs).toEqual(["char-lamp-sheet-2", "char-ox-sheet-1", "ep01-a-board-1"]);
    expect(edge.operation.params).toMatchObject({ provider: "fal", model: "bytedance/seedance-2.5", requestId: "mock-request-1", bibleVersion: 1 });
    // The pre-flight estimate is replaced by the formula on the delivered clip — still labelled an estimate.
    expect(edge.operation.params.cost).toMatchObject({ usd: 0.4242, basis: "estimate" });
    expect(edge.operation.params.cost.note).toContain("delivered clip");
    const status = ok(dir, ["status"]);
    expect(status.episodes[0]).toMatchObject({ stage: "shot", busy: false });
    // 9 shots × (2 cast + 1 group): nothing is judged yet.
    expect(status.episodes[0].parts[0].checks).toEqual({ ok: 0, drift: 0, absent: 0, unverified: 27, accepted: 0 });
  });

  test("a clip is refused, before anything is recorded, when a cast member has no picked sheet", () => {
    const dir = fresh();
    seedText(dir);
    ok(dir, ["make-sheets", "--character", "lamp", "--count", "1", "--pick"]);
    ok(dir, ["shoot-board", "--episode", "ep01"]);
    const assets = project(dir).assets.length;
    const r = run(dir, ["shoot-video", "--episode", "ep01"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("Ox has no picked, ready design sheet");
    expect(project(dir).assets).toHaveLength(assets);
  });

  test("no key: nothing is reserved, and the message names the Jimeng route", () => {
    const dir = withSheets();
    const r = run(dir, ["shoot-board", "--episode", "ep01"], { MOCK_NO_KEYS: "1" });
    expect(r.code).toBe(1);
    expect(r.err).toContain("nothing was sent");
    expect(r.err).toContain("--target jimeng");
    expect(sidecarOf(dir).episodes).toEqual({});
  });

  test("a bible edit flags the take only after it is locked, names the field, and an acknowledgement quiets it", () => {
    const dir = withSheets();
    ok(dir, ["shoot-board", "--episode", "ep01"]);
    ok(dir, ["shoot-video", "--episode", "ep01"]);
    ok(dir, ["set-character", "--id", "ox", "--look", "a stout ox, both horns whole"]);
    expect(ok(dir, ["status"]).episodes[0].parts[0].bible.stale).toBe(false);
    ok(dir, ["set-character", "--id", "lamp", "--personality", "calmer now"]);
    ok(dir, ["lock"]);
    const flag = ok(dir, ["status"]).episodes[0].parts[0].bible;
    expect(flag).toMatchObject({ stale: true, shotUnder: 1, latest: 2 });
    expect(flag.changes).toEqual([{ key: "character:ox", name: "Ox", fields: ["look"] }]);
    ok(dir, ["pick", "--episode", "ep01", "--acknowledge"]);
    expect(episodeOf(dir).picks?.acknowledgedBibleVersion).toBe(2);
    expect(ok(dir, ["status"]).episodes[0].parts[0].bible).toMatchObject({ stale: false, acknowledged: true });
  });

  test("an upstream failure is recorded with unknown billing; a refused socket with none; retry re-sends as recorded", () => {
    const dir = withSheets();
    ok(dir, ["shoot-board", "--episode", "ep01"]);
    const failed = run(dir, ["shoot-video", "--episode", "ep01", "--json", "--at", String(T0)], { MOCK_FAIL: "video" });
    expect(failed.code).toBe(1);
    expect(assetOf(dir, "ep01-a-take-1").status).toBe("failed");
    expect(edgeOf(dir, "ep01-a-take-1").operation.params.failure).toMatchObject({ billing: "unknown", reason: "mock upstream error: video provider returned 500" });
    // The slot record exists from the reservation on: the viewer can show the failed take.
    expect(sidecarOf(dir).episodes.ep01.parts.A!.takes.map((t) => t.asset)).toEqual(["ep01-a-take-1"]);

    const refused = run(dir, ["shoot-board", "--episode", "ep01"], { MOCK_FAIL: "refused" });
    expect(refused.code).toBe(1);
    expect(edgeOf(dir, "ep01-a-board-2").operation.params.failure.billing).toBe("none");

    const listed = ok(dir, ["retry"]);
    expect(listed.failed.map((f: { id: string }) => f.id).sort()).toEqual(["ep01-a-board-2", "ep01-a-take-1"]);
    const retried = ok(dir, ["retry", "--asset", "ep01-a-take-1"]);
    expect(retried.result).toMatchObject({ id: "ep01-a-take-1", status: "ready" });
    const params = edgeOf(dir, "ep01-a-take-1").operation.params;
    expect(params.earlier).toHaveLength(1);
    expect(params.earlier[0]).toMatchObject({ status: "failed", failure: { billing: "unknown" } });
    const video = mockLog(dir).filter((l: { kind: string }) => l.kind === "video");
    expect(video).toHaveLength(2);
    expect(video[1].prompt).toBe(video[0].prompt);
    expect(video[1].refImages).toEqual(video[0].refImages);
    const cost = summarizeCosts(project(dir));
    // The failed first attempt may still have been billed: it stays uncertain after the retry lands.
    expect(cost.uncertain).toEqual(["ep01-a-take-1#1"]);
    expect(cost.notBilled).toContain("ep01-a-board-2");
    expect(cost.lines.filter((l) => l.assetId === "ep01-a-take-1")).toHaveLength(2);
    expect(sidecarOf(dir).episodes.ep01.parts.A!.takes).toHaveLength(1);
  });

  test("an interrupt mid-render records the take as failed with unknown billing and exits 130", async () => {
    const dir = withSheets();
    ok(dir, ["shoot-board", "--episode", "ep01"]);
    const child = Bun.spawn([process.execPath, SERIES, "shoot-video", "--episode", "ep01", "--dir", dir], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, ANIME_SERIES_GENERATORS: MOCK, MOCK_SLEEP_MS: "20000", MOCK_FAIL: "", MOCK_NO_KEYS: "", MOCK_REAL_MEDIA: "" },
    });
    // The reservation is on disk before the request is "sent".
    const deadline = Date.now() + 10_000;
    while (assetOf(dir, "ep01-a-take-1")?.status !== "generating") {
      if (Date.now() > deadline) throw new Error("the take was never reserved");
      await Bun.sleep(50);
    }
    child.kill("SIGINT");
    expect(await child.exited).toBe(130);
    expect(assetOf(dir, "ep01-a-take-1").status).toBe("failed");
    const failure = edgeOf(dir, "ep01-a-take-1").operation.params.failure;
    expect(failure.billing).toBe("unknown");
    expect(failure.reason).toContain("whether it had already been billed is not knowable");
  }, 20_000);

  test("uploads: a human sheet is picked when none is, a Jimeng board is registered, neither is priced", () => {
    const dir = fresh();
    seedText(dir);
    const image = join(dir, "from-jimeng.webp");
    writeFileSync(image, webpHeader(1536, 864));
    const sheet = ok(dir, ["make-sheets", "--character", "lamp", "--upload", image]);
    expect(sheet).toMatchObject({ uploaded: "char-lamp-sheet-1", picked: true });
    expect(bibleOf(dir).characters[0].sheet).toBe("char-lamp-sheet-1");
    expect(edgeOf(dir, "char-lamp-sheet-1").operation).toMatchObject({ type: "upload", actor: "human" });
    ok(dir, ["make-sheets", "--character", "ox", "--upload", image]);
    const board = ok(dir, ["shoot-board", "--episode", "ep01", "--upload", image]);
    expect(board.uploaded).toBe("ep01-a-board-1");
    expect(sidecarOf(dir).episodes.ep01.parts.A!.boards[0].refs).toEqual(["char-lamp-sheet-1", "char-ox-sheet-1"]);
    expect(summarizeCosts(project(dir)).calls).toBe(0);
    expect(mockLog(dir)).toEqual([]);
  });

  test("prompts are stored in the sidecar for the viewer and written for copy-paste on request", () => {
    const dir = withSheets();
    const out = ok(dir, ["prompts", "--episode", "ep01", "--write"]);
    expect(out.parts[0].refs.map((r: { name: string }) => r.name)).toEqual(["Lamp", "Ox", "storyboard"]);
    const stored = sidecarOf(dir).episodes.ep01.prompts.A!;
    expect(stored.video).toBe(out.parts[0].video.prompt);
    expect(stored.jimeng.video.split("\n")[0]).toContain("@图1 Lamp sheet, @图2 Ox sheet, @图3 storyboard");
    expect(stored.basis.version).toBe(1);
    expect(stored.clipShots).toHaveLength(9);
    expect(readFileSync(join(dir, "episodes", "ep01", "prompts", "video-a.txt"), "utf-8")).toBe(`${stored.video}\n`);
  });

  test("estimate prices the video by fal's formula and each image for the model the command would use", () => {
    const dir = fresh();
    seedText(dir);
    // No sheets yet: the board would be drawn without references, by Flare, at the seed rounds' table price.
    const out = ok(dir, ["estimate", "--episode", "ep01"]);
    expect(out.rows[0]).toMatchObject({ what: "ep01 part A storyboard (gpt-image-2.5-flare, default without references)", usd: 0.055, basis: "table" });
    expect(out.rows[1]).toMatchObject({ what: "ep01 part A video 30 s 480p", usd: 6.168, basis: "estimate" });
    expect(out.unpriced).toEqual([]);
    const patch = ok(dir, ["estimate", "--episode", "ep01", "--shots", "6-6"]);
    expect(patch.rows[0].what).toBe("ep01 part A patch 6–6 (6 s)");
    // A quality the table does not cover is unpriced, and the total says so instead of "$0".
    const low = run(dir, ["estimate", "--episode", "ep01", "--what", "board", "--quality", "low"]);
    expect(low.out).toContain("total: unpriced");
    expect(low.out).not.toContain("$0.0000");

    // With sheets attached the board is Sunburst, priced from this project's reported calls.
    const sheets = withSheets();
    const board = ok(sheets, ["estimate", "--episode", "ep01", "--what", "board"]);
    expect(board.rows[0].what).toBe("ep01 part A storyboard (gpt-image-2.5-sunburst, default with 2 reference image(s); --model flare for the general model)");
    expect(board.rows[0]).toMatchObject({ usd: 0.055, basis: "table" });
    expect(ok(sheets, ["estimate", "--episode", "ep01", "--what", "board", "--model", "flare"]).rows[0]).toMatchObject({ usd: 0.05, basis: "estimate" });
  });

  test("verdicts, accepted drift and the derived record", () => {
    const dir = withSheets();
    ok(dir, ["shoot-board", "--episode", "ep01"]);
    ok(dir, ["shoot-video", "--episode", "ep01"]);
    expect(run(dir, ["verdict", "--episode", "ep01", "--shot", "7", "--character", "ox", "--verdict", "drift"]).err).toContain("needs --note");
    expect(run(dir, ["pick", "--episode", "ep01", "--accept-drift", "--shot", "7", "--character", "ox"]).err).toContain("not a drift");
    ok(dir, ["verdict", "--episode", "ep01", "--shot", "7", "--character", "ox", "--verdict", "drift", "--note", "right horn missing"]);
    ok(dir, ["verdict", "--episode", "ep01", "--shot", "1", "--character", "lamp,ox", "--verdict", "ok"]);
    expect(sidecarOf(dir).episodes.ep01.parts.A!.checks["ep01-a-take-1"]["7"].ox).toMatchObject({ verdict: "drift", note: "right horn missing", frame: null });
    ok(dir, ["pick", "--episode", "ep01", "--accept-drift", "--shot", "7", "--character", "ox"]);
    expect(episodeOf(dir).picks?.acceptedDrift).toEqual([{ take: "ep01-a-take-1", shot: 7, character: "ox" }]);
    expect(ok(dir, ["status"]).episodes[0].parts[0].checks).toEqual({ ok: 2, drift: 1, absent: 0, unverified: 24, accepted: 1 });
    ok(dir, ["verdict", "--sheet", "char-lamp-sheet-1", "--verdict", "drift", "--note", "back view flips the shade"]);
    expect(sidecarOf(dir).sheets["character:lamp"].candidates[0].check).toMatchObject({ verdict: "drift", note: "back view flips the shade" });
    ok(dir, ["log", "--episode", "ep01", "--goal", "leave at six", "--used", "Ox carries Lamp", "--ending", "a blank note on the face"]);
    const ideas = ok(dir, ["ideas-context"]);
    expect(ideas.episodes).toEqual([{ episode: "ep01", title: "Clock Out", location: "open-plan office", goal: "leave at six", abilities: ["Ox carries Lamp"], ending: "a blank note on the face" }]);
  });

  test("validate names a hand-broken episode and a dangling sheet pick", () => {
    const dir = withSheets();
    const path = join(dir, "episodes", "ep01", "episode.json");
    const episode = readJson(path);
    episode.parts[0].shots[0].dur = "three";
    writeFileSync(path, JSON.stringify(episode));
    const bible = readJson(join(dir, "bible.json"));
    bible.characters[1].sheet = "char-ox-sheet-9";
    writeFileSync(join(dir, "bible.json"), JSON.stringify(bible));
    const r = run(dir, ["validate", "--json"]);
    expect(r.code).toBe(1);
    const problems = JSON.parse(r.out).problems.join("\n");
    expect(problems).toContain("episodes/ep01/episode.json: parts[0].shots[0] must be { dur: number, desc: string, sfx?, sketch? }");
    expect(problems).toContain("bible.json character:ox.sheet: unknown asset 'char-ox-sheet-9'");
  });
});

describe("series.mjs CLI — review findings", () => {
  test("prompts records for the viewer only when the text changed; a re-run writes nothing", () => {
    const dir = withSheets();
    const first = ok(dir, ["prompts", "--episode", "ep01"]);
    expect(first.recorded).toEqual(["A"]);
    const before = readFileSync(join(dir, "project.json"), "utf-8");
    const again = ok(dir, ["prompts", "--episode", "ep01"]);
    expect(again.recorded).toEqual([]);
    expect(readFileSync(join(dir, "project.json"), "utf-8")).toBe(before);
    ok(dir, ["set-shot", "--episode", "ep01", "--shot", "2", "--desc", "the notes peel off and stare"]);
    expect(ok(dir, ["prompts", "--episode", "ep01"]).recorded).toEqual(["A"]);
  });

  test("a re-shoot's Jimeng prompt is printed without recording anything", () => {
    const dir = withSheets();
    ok(dir, ["shoot-board", "--episode", "ep01"]);
    const before = readFileSync(join(dir, "project.json"), "utf-8");
    const out = ok(dir, ["prompts", "--episode", "ep01", "--shots", "6-6", "--target", "jimeng", "--write"]);
    expect(out.patch.plan.covered).toEqual([6, 7]);
    expect(out.patch.jimeng.video.split("\n")[0]).toContain("| re-shoot part A shots 6–7]");
    expect(readFileSync(join(dir, "project.json"), "utf-8")).toBe(before);
    expect(readFileSync(join(dir, "episodes", "ep01", "prompts", "jimeng-patch-a-6-6.txt"), "utf-8")).toBe(`${out.patch.jimeng.video}\n`);
  });

  test("a timed-out render with a recorded request is landed by retry, not sent again, and counted once", () => {
    const dir = withSheets();
    ok(dir, ["shoot-board", "--episode", "ep01"]);
    const timedOut = run(dir, ["shoot-video", "--episode", "ep01", "--json", "--at", String(T0)], { MOCK_FAIL: "timeout" });
    expect(timedOut.code).toBe(1);
    expect(edgeOf(dir, "ep01-a-take-1").operation.params).toMatchObject({ requestId: "mock-request-1", failure: { billing: "unknown" } });
    expect(ok(dir, ["retry"]).failed[0]).toMatchObject({ id: "ep01-a-take-1", requestId: "mock-request-1" });
    const dry = ok(dir, ["retry", "--asset", "ep01-a-take-1", "--dry-run"]);
    expect(dry).toMatchObject({ mode: "attach", requestId: "mock-request-1" });

    const landed = ok(dir, ["retry", "--asset", "ep01-a-take-1"]);
    expect(landed).toMatchObject({ mode: "attach", requestId: "mock-request-1", result: { id: "ep01-a-take-1", status: "ready" } });
    const calls = mockLog(dir).map((l: { kind: string }) => l.kind);
    expect(calls.filter((k: string) => k === "video")).toHaveLength(1); // only the first, timed-out render
    expect(calls.filter((k: string) => k === "resume")).toHaveLength(1);
    expect(mockLog(dir).find((l: { kind: string }) => l.kind === "resume").requestId).toBe("mock-request-1");
    const params = edgeOf(dir, "ep01-a-take-1").operation.params;
    expect(params).toMatchObject({ requestId: "mock-request-1", retry: "attach" });
    const cost = summarizeCosts(project(dir));
    expect(cost.reconciled).toEqual(["ep01-a-take-1#1"]);
    expect(cost.uncertain).toEqual([]);
    expect(cost.lines.filter((l) => l.assetId === "ep01-a-take-1" && !l.sameCallAsLater).map((l) => l.usd)).toEqual([0.4242]);
  });

  test("a recorded request that cannot be landed asks for --resubmit, which sends a new render and says it may pay twice", () => {
    const dir = withSheets();
    ok(dir, ["shoot-board", "--episode", "ep01"]);
    run(dir, ["shoot-video", "--episode", "ep01"], { MOCK_FAIL: "timeout" });
    const lost = run(dir, ["retry", "--asset", "ep01-a-take-1", "--json", "--at", String(T0)], { MOCK_RESUME_FAIL: "1" });
    expect(lost.code).toBe(1);
    expect(lost.err).toContain("--resubmit");
    expect(mockLog(dir).filter((l: { kind: string }) => l.kind === "video")).toHaveLength(1);
    const resent = run(dir, ["retry", "--asset", "ep01-a-take-1", "--resubmit", "--json", "--at", String(T0)]);
    expect(resent.code).toBe(0);
    expect(resent.err).toContain("may pay twice");
    expect(JSON.parse(resent.out)).toMatchObject({ mode: "resubmit", result: { status: "ready" } });
    expect(mockLog(dir).filter((l: { kind: string }) => l.kind === "video")).toHaveLength(2);
  });

  test("the storyboard defaults to Sunburst once references are attached, and its dry run is priced", () => {
    const dir = withSheets();
    const dry = run(dir, ["shoot-board", "--episode", "ep01", "--dry-run", "--json"]);
    expect(dry.err).toContain("storyboard model: openai/gpt-image-2.5-sunburst (default with 2 reference image(s)");
    const [request] = JSON.parse(dry.out).requests;
    expect(request).toMatchObject({ model: "openai/gpt-image-2.5-sunburst", cost: { usd: 0.055, basis: "table" } });
    expect(request.body.model).toBe("openai/gpt-image-2.5-sunburst");
    ok(dir, ["shoot-board", "--episode", "ep01", "--model", "flare"]);
    expect(mockLog(dir).at(-1)).toMatchObject({ kind: "image", model: "openai/gpt-image-2.5-flare" });
  });

  test("add-episode writes the method's continuity lines unless told otherwise", () => {
    const dir = fresh();
    seedText(dir);
    ok(dir, ["add-episode", "--episode", "ep02", "--title", "Default", "--cast", "lamp"]);
    expect(episodeOf(dir, "ep02").continuity).toEqual(["every shot picks up the motion where the previous shot left it", "every run crosses the frame the same way, left to right"]);
    ok(dir, ["add-episode", "--episode", "ep03", "--title", "None", "--cast", "lamp", "--continuity", ""]);
    expect(episodeOf(dir, "ep03").continuity).toEqual([]);
    ok(dir, ["set-series", "--lang", "zh"]);
    ok(dir, ["add-episode", "--episode", "ep04", "--title", "Zh", "--cast", "lamp"]);
    expect(episodeOf(dir, "ep04").continuity?.[0]).toBe("每一镜都从上一镜停下的那个动作接着演");
    expect(ok(dir, ["prompts", "--episode", "ep01"]).lang).toBe("zh");
    expect(run(dir, ["set-series", "--lang", "fr"]).err).toContain("--lang must be en, zh or auto");
    ok(dir, ["set-series", "--lang", "auto"]);
    expect(bibleOf(dir)).not.toHaveProperty("lang");
  });

  test("every bible field has a flag; a flag that does not fit the card is refused", () => {
    const dir = fresh();
    seedText(dir);
    ok(dir, ["set-group", "--id", "notes", "--leader", "one red note, URGENT on it", "--markings", "URGENT on the red note", "--pose", "stuck flat", "--pose", "swarming in", "--palette", "note=#fcd05b", "--palette", "leader=#fc6260"]);
    expect(bibleOf(dir).groups[0]).toMatchObject({ leader: "one red note, URGENT on it", markings: "URGENT on the red note", poses: ["stuck flat", "swarming in"], palette: { note: "#fcd05b", leader: "#fc6260" } });
    ok(dir, ["set-scene", "--id", "office", "--time", "late night"]);
    expect(bibleOf(dir).scenes[0].time).toBe("late night");
    ok(dir, ["set-character", "--id", "ox", "--markings", "the ox head on the badge"]);
    expect(bibleOf(dir).characters[1].markings).toBe("the ox head on the badge");
    ok(dir, ["set-character", "--id", "ox", "--markings", ""]);
    expect(bibleOf(dir).characters[1]).not.toHaveProperty("markings");
    expect(run(dir, ["set-scene", "--id", "office", "--leader", "x"]).err).toContain("set-scene does not take --leader");
    expect(run(dir, ["set-group", "--id", "notes", "--palette", "#fff", "--palette", "a=#000"]).err).toContain("either colours or label=colour");
  });

  test("a ratio Seedance cannot render is refused up front", () => {
    const dir = fresh();
    const r = run(dir, ["init", "--ratio", "3:2"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("--ratio must be one Seedance 2.5 renders: 21:9, 16:9, 4:3, 1:1, 3:4, 9:16");
    expect(existsSync(join(dir, "bible.json"))).toBe(false);
    ok(dir, ["init"]);
    expect(run(dir, ["set-series", "--ratio", "2:3"]).code).toBe(1);
    expect(bibleOf(dir).ratio).toBe("16:9");
  });

  test("per-command help lists every flag the command takes", () => {
    const help = (args: string[]) => Bun.spawnSync([process.execPath, SERIES, ...args], { stderr: "pipe" }).stderr.toString();
    const all = help(["--help"]);
    for (const flag of ["--deadline-s", "--resubmit", "--lang", "--leader", "--markings", "lineup"]) expect(all).toContain(flag);
    const verdict = help(["verdict", "--help"]);
    expect(verdict.startsWith("Usage: series.mjs verdict ")).toBe(true);
    expect(verdict).toContain("--group <id>");
    expect(verdict).toContain("absent");
    expect(verdict).not.toContain("compile-season");
    expect(help(["shoot-board", "--help"])).toContain("--quality high");
    expect(help(["review-episode", "--help"])).toContain("--font <file>");
    const frames = help(["frames", "--help"]);
    for (const flag of ["--shot <n>", "--count 6", "--seconds <s>", "--crop x,y,w,h", "--take <take|patch>"]) expect(frames).toContain(flag);
    expect(help(["estimate", "--help"])).toContain("--model flare|sunburst");
  });

  test("verdicts: absent, groups, shot ranges; a lost beat is named", () => {
    const dir = withSheets();
    ok(dir, ["shoot-board", "--episode", "ep01"]);
    ok(dir, ["shoot-video", "--episode", "ep01"]);
    const range = ok(dir, ["verdict", "--episode", "ep01", "--shot", "1-9", "--group", "notes", "--verdict", "absent"]);
    expect(range.shots).toHaveLength(9);
    expect(sidecarOf(dir).episodes.ep01.parts.A!.checks["ep01-a-take-1"]["4"]["group:notes"]).toMatchObject({ verdict: "absent" });
    // Shot 1's words name Lamp: marking it absent is a lost beat, not a pass.
    ok(dir, ["verdict", "--episode", "ep01", "--shot", "1", "--character", "lamp", "--verdict", "absent"]);
    const part = ok(dir, ["status", "--episode", "ep01"]).episodes[0].parts[0];
    expect(part.checks).toEqual({ ok: 0, drift: 0, absent: 10, unverified: 17, accepted: 0 });
    // Shot 2 says "the sticky notes": the group marked absent there is a lost beat too.
    expect(part.lost).toEqual([
      { shot: 1, character: "lamp", name: "Lamp", note: "", source: "ep01-a-take-1" },
      { shot: 2, character: "group:notes", name: "Sticky Notes", note: "", source: "ep01-a-take-1" },
    ]);
    expect(part.shotRows[0].cells.find((c: { character: string }) => c.character === "lamp")).toMatchObject({ verdict: "absent", expected: true });
    const text = run(dir, ["status", "--episode", "ep01"]).out;
    expect(text).toContain("lost beats (absent where the shot's words name them): shot 1 Lamp; shot 2 Sticky Notes");
    expect(text).toContain(" 1 0–3s  wide: Lamp eyes the clock, Ox already packed");
    expect(run(dir, ["verdict", "--episode", "ep01", "--shot", "2", "--group", "goose", "--verdict", "ok"]).err).toContain('"goose" is not one of ep01\'s groups');
    expect(run(dir, ["verdict", "--sheet", "char-lamp-sheet-1", "--verdict", "absent"]).err).toContain("a sheet --verdict must be one of ok, drift, unverified");
  });

  test("a shot spliced from a patch is judged on the patch: the take's drift stops counting once the patch is ok", () => {
    const dir = withSheets();
    ok(dir, ["shoot-board", "--episode", "ep01"]);
    ok(dir, ["shoot-video", "--episode", "ep01"]);
    ok(dir, ["verdict", "--episode", "ep01", "--shot", "7", "--character", "ox", "--verdict", "drift", "--note", "horn missing"]);
    const clip = join(dir, "patch.mp4");
    writeFileSync(clip, "placeholder patch");
    ok(dir, ["patch-range", "--episode", "ep01", "--shots", "7-7", "--upload", clip]);
    const patch = "ep01-a-patch-7-7-1";
    // The patch's shot 7 is unjudged until someone looks at it.
    let cell = ok(dir, ["status", "--episode", "ep01"]).episodes[0].parts[0].shotRows[6].cells.find((c: { character: string }) => c.character === "ox");
    expect(cell).toMatchObject({ verdict: "unverified", source: patch });
    const verdict = ok(dir, ["verdict", "--episode", "ep01", "--shot", "7", "--character", "ox", "--verdict", "ok", "--note", "fixed"]);
    expect(verdict.take).toBe(patch);
    cell = ok(dir, ["status", "--episode", "ep01"]).episodes[0].parts[0].shotRows[6].cells.find((c: { character: string }) => c.character === "ox");
    expect(cell).toMatchObject({ verdict: "ok", source: patch });
    expect(sidecarOf(dir).episodes.ep01.parts.A!.checks["ep01-a-take-1"]["7"].ox.verdict).toBe("drift");
    expect(run(dir, ["verdict", "--episode", "ep01", "--take", patch, "--shot", "3", "--character", "ox", "--verdict", "ok"]).err).toContain("splices shots 7–7 only");
    expect(sidecarOf(dir).episodes.ep01.parts.A!.patches[0].durs).toEqual([3, 4]);
  });

  test("a shot re-shot by an applied patch is no longer 'not re-shot'", () => {
    const dir = withSheets();
    ok(dir, ["shoot-board", "--episode", "ep01"]);
    ok(dir, ["shoot-video", "--episode", "ep01"]);
    ok(dir, ["set-shot", "--episode", "ep01", "--shot", "8", "--desc", "six o'clock: the lights go out and Lamp lights the clock"]);
    expect(ok(dir, ["status"]).episodes[0].parts[0].takeStaleShots).toEqual([8]);
    const clip = join(dir, "patch.mp4");
    writeFileSync(clip, "placeholder patch");
    ok(dir, ["patch-range", "--episode", "ep01", "--shots", "8-8", "--upload", clip]);
    expect(ok(dir, ["status"]).episodes[0].parts[0].takeStaleShots).toEqual([]);
    expect(run(dir, ["status", "--episode", "ep01"]).out).not.toContain("not re-shot");
    // Edited again after the patch: stale again.
    ok(dir, ["set-shot", "--episode", "ep01", "--shot", "8", "--sfx", "a softer bell"]);
    expect(ok(dir, ["status"]).episodes[0].parts[0].takeStaleShots).toEqual([8]);
  });

  test("scene rules, aliases and exclusions have flags", () => {
    const dir = fresh();
    seedText(dir);
    ok(dir, ["set-scene", "--id", "office", "--rules", "the clock face has no numbers"]);
    expect(bibleOf(dir).scenes[0].rules).toBe("the clock face has no numbers");
    expect(ok(dir, ["prompts", "--episode", "ep01"]).parts[0].storyboard.prompt).toContain("Set rules: the clock face has no numbers.");
    ok(dir, ["set-group", "--id", "notes", "--alias", "the notes", "--alias", "the swarm", "--not-name", "notebook"]);
    expect(bibleOf(dir).groups[0]).toMatchObject({ aliases: ["the notes", "the swarm"], notNames: ["notebook"] });
    expect(run(dir, ["set-scene", "--id", "office", "--alias", "x"]).err).toContain("set-scene does not take --alias");
    expect(ok(dir, ["validate"]).ok).toBe(true);
  });

  test("lineup draws the picked sheets side by side, registered and priced", () => {
    const dir = withSheets();
    expect(ok(dir, ["estimate", "--lineup"]).rows[0]).toMatchObject({ what: "lineup of Lamp, Ox (gpt-image-2.5-sunburst, default with 2 reference image(s); --model flare for the general model)", usd: 0.055, basis: "table" });
    const out = ok(dir, ["lineup"]);
    expect(out.result).toMatchObject({ id: "lineup-1", status: "ready" });
    const call = mockLog(dir).at(-1);
    expect(call).toMatchObject({ kind: "image", model: "openai/gpt-image-2.5-sunburst", aspectRatio: "16:9" });
    expect(call.imageUrls.map((f: string) => f.split("/").pop())).toEqual(["char-lamp-sheet-2.webp", "char-ox-sheet-1.webp"]);
    expect(call.prompt.startsWith("Character lineup: reference image 1 is Lamp, reference image 2 is Ox.")).toBe(true);
    expect(sidecarOf(dir).lineups).toEqual([{ asset: "lineup-1", characters: ["lamp", "ox"], sheets: ["char-lamp-sheet-2", "char-ox-sheet-1"] }]);
    expect(edgeOf(dir, "lineup-1").operation.params.inputs).toEqual(["char-lamp-sheet-2", "char-ox-sheet-1"]);
    expect(run(dir, ["lineup", "--character", "lamp"]).err).toContain("two or more characters");
    expect(ok(dir, ["validate"]).ok).toBe(true);
  });
});

describe("series.mjs CLI — upstream fidelity", () => {
  test("prompts --shot gives one panel's Jimeng form, board node first, and records nothing", () => {
    const dir = withSheets();
    expect(run(dir, ["prompts", "--episode", "ep01", "--shot", "5", "--target", "jimeng"]).err).toContain("has no ready storyboard to redraw a panel of");
    ok(dir, ["shoot-board", "--episode", "ep01"]);
    const boardUri = assetOf(dir, "ep01-a-board-1").uri;
    const before = readFileSync(join(dir, "project.json"), "utf-8");
    const out = ok(dir, ["prompts", "--episode", "ep01", "--shot", "5", "--target", "jimeng", "--write"]);
    const [head, cut] = out.panel.jimeng.panel.split("\n");
    expect(head).toContain(`select these nodes in this order: @图1 storyboard (${boardUri}), @图2 Lamp sheet, @图3 Ox sheet |`);
    expect(head).toContain("register it: series.mjs redo-panel --episode ep01 --part A --shot 5 --upload <file>");
    expect(cut).toBe("———— copy everything below this line ————");
    expect(out.panel.refs).toEqual(["ep01-a-board-1", "char-lamp-sheet-2", "char-ox-sheet-1"]);
    expect(out.panel.prompt.split("\n")[1]).toStartWith("Image 1 is the current storyboard:");
    expect(readFileSync(join(dir, "project.json"), "utf-8")).toBe(before);
    expect(readFileSync(join(dir, "episodes", "ep01", "prompts", "jimeng-panel-a-5.txt"), "utf-8")).toBe(`${out.panel.jimeng.panel}\n`);
    expect(readFileSync(join(dir, "episodes", "ep01", "prompts", "panel-a-5.txt"), "utf-8")).toBe(`${out.panel.prompt}\n`);
    expect(run(dir, ["prompts", "--episode", "ep01", "--shot", "5", "--shots", "5-6"]).err).toContain("do not go together");
    expect(run(dir, ["prompts", "--episode", "ep01", "--shot", "10"]).err).toContain("--shot must be 1–9");
  });

  test("an uploaded sheet or board outside 0.4–2.5 wide to 1 high is registered with a warning", () => {
    const dir = fresh();
    seedText(dir);
    const wide = join(dir, "turnaround.webp");
    writeFileSync(wide, webpHeader(3200, 800));
    const r = run(dir, ["make-sheets", "--character", "lamp", "--upload", wide, "--json"]);
    expect(r.code).toBe(0);
    const sheet = JSON.parse(r.out);
    expect(sheet.uploaded).toBe("char-lamp-sheet-1");
    expect(sheet.warnings).toHaveLength(1);
    expect(sheet.warnings[0]).toContain("3200×800 (4.00 wide to 1 high)");
    expect(r.err).toContain("WARN: refs/char-lamp-sheet-1.webp is 3200×800");
    expect(r.err).toContain("two rows of two");
    const fine = join(dir, "sheet.webp");
    writeFileSync(fine, webpHeader(1536, 864));
    expect(ok(dir, ["make-sheets", "--character", "ox", "--upload", fine]).warnings).toEqual([]);
    const tall = join(dir, "board.webp");
    writeFileSync(tall, webpHeader(800, 2400));
    const board = JSON.parse(run(dir, ["shoot-board", "--episode", "ep01", "--upload", tall, "--json"]).out);
    expect(board.uploaded).toBe("ep01-a-board-1");
    expect(board.warnings[0]).toContain("Draw the storyboard again at the series ratio (16:9)");
  });

  test("init and status say up front when ffmpeg and ffprobe are missing, with the install line", () => {
    const dir = fresh();
    // A PATH with nothing on it: no ffmpeg, no ffprobe.
    const bare = { PATH: fresh("anime-series-bare-path-") };
    const init = run(dir, ["init", "--title", "Lamp and Ox"], bare);
    expect(init.code).toBe(0);
    expect(init.out).toContain("ffmpeg/ffprobe: MISSING ffmpeg and ffprobe");
    expect(init.out).toContain("brew install ffmpeg");
    expect(init.out).toContain("winget install Gyan.FFmpeg");
    const status = run(dir, ["status", "--json"], bare);
    expect(JSON.parse(status.out).tools).toEqual({ ffmpeg: false, ffprobe: false, drawtext: false });
    expect(run(dir, ["status"], bare).out).toContain("ffmpeg/ffprobe: MISSING");
  });

  test("a patch on a take whose cuts cannot be read says so instead of passing it over", () => {
    const dir = withSheets();
    ok(dir, ["shoot-board", "--episode", "ep01"]);
    ok(dir, ["shoot-video", "--episode", "ep01"]);
    // Mocked takes are placeholder bytes: neither a contact sheet nor ffmpeg can say where they cut.
    const clip = join(dir, "patch.mp4");
    writeFileSync(clip, "placeholder patch");
    const r = run(dir, ["patch-range", "--episode", "ep01", "--shots", "7-7", "--upload", clip, "--json", "--at", String(T0)]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out).uncutEnds).toBeNull();
    expect(r.err).toContain("WARN: could not read where ep01-a-take-1 cuts");
    expect(r.err).toContain("check with review-episode that shots 7–7 start and end on a cut");
  });
});

describe("series.mjs CLI — frames (a closer look, inside the workspace)", () => {
  // Live ep02 review (Codex e2e, 2026-10-29): the contact strip was not enough
  // to judge 牛马, so the agent ran ffmpeg by hand into /tmp; the chat could
  // not show those files (403: outside the workspace) and nothing recorded them.
  test("frames refuses what it cannot take before anything is written", () => {
    const dir = withSheets();
    ok(dir, ["shoot-board", "--episode", "ep01"]);
    expect(run(dir, ["frames", "--episode", "ep01", "--shot", "1"]).err).toContain("ep01 part A has no take");
    ok(dir, ["shoot-video", "--episode", "ep01"]);
    const before = readFileSync(join(dir, "project.json"), "utf-8");
    const refused = (args: string[], env: Record<string, string> = {}) => {
      const r = run(dir, ["frames", "--episode", "ep01", ...args], env);
      expect(r.code).toBe(1);
      return r.err;
    };
    expect(refused([])).toContain("frames needs --shot <n>");
    expect(refused(["--shot", "10"])).toContain("--shot must be within 1–9");
    expect(refused(["--shot", "2", "--count", "3", "--seconds", "4"])).toContain("--count and --seconds do not go together");
    expect(refused(["--shot", "2", "--count", "25"])).toContain("--count is at most 24");
    // Seconds are on the clip's own clock and must fall inside the shot: shot 2 is 3–6 s.
    expect(refused(["--shot", "2", "--seconds", "4,6"])).toContain("--seconds 6: shot 2 runs 3–6 s on ep01-a-take-1's own clock");
    expect(refused(["--shot", "2", "--crop", "0.2,0.3"])).toContain("--crop must be four fractions of the frame");
    expect(refused(["--shot", "2", "--crop", "0.6,0,0.5,1"])).toContain("the box stays inside the frame");
    expect(refused(["--shot", "2", "--take", "ep01-a-take-9"])).toContain("'ep01-a-take-9' is not a take or a patch of ep01 part A");
    // Valid arguments without ffmpeg: said up front, with the install line.
    const bare = refused(["--shot", "2"], { PATH: fresh("anime-series-bare-path-") });
    expect(bare).toContain("frames needs ffmpeg and ffprobe on PATH");
    expect(bare).toContain("brew install ffmpeg");
    expect(readFileSync(join(dir, "project.json"), "utf-8")).toBe(before);
    expect(existsSync(join(dir, "episodes", "ep01", "review"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Media tier: the ffmpeg steps on real files
// ---------------------------------------------------------------------------

const MEDIA = mediaTierEnabled("anime-series");
announceMediaTierSkip("anime-series", "series.mjs ffmpeg steps (compare, panel composite, review, frames, final, season)");
const HAS_FFMPEG = MEDIA
  && spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0
  && spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0;
if (MEDIA && !HAS_FFMPEG) console.warn("(skip) modes/anime-series series.mjs media steps — ffmpeg/ffprobe not on PATH");

const REAL = { MOCK_REAL_MEDIA: "1" };

function pixel(file: string, x: number, y: number) {
  // RGB before the crop: a 1×1 crop of a 4:2:0 picture (a JPEG frame) rounds to nothing.
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-vf", `format=rgb24,crop=1:1:${x}:${y}`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  return [...r.stdout];
}

function duration(file: string) {
  return Number(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf-8" }).stdout);
}

describe.skipIf(!HAS_FFMPEG)("series.mjs media steps", () => {
  let dir = "";
  beforeAll(() => {
    dir = fresh("anime-series-media-");
    seedSheets(dir, REAL);
    ok(dir, ["shoot-board", "--episode", "ep01"], REAL);
  });

  test("status reports ffmpeg and ffprobe as found", () => {
    expect(ok(dir, ["status"], REAL).tools).toMatchObject({ ffmpeg: true, ffprobe: true });
  });

  test("check-sheets builds one compare image of the candidates", () => {
    const out = ok(dir, ["check-sheets", "--character", "lamp"], REAL);
    expect(out.compare.uri).toBe("refs/compare/char-lamp-compare-1.jpg");
    expect(edgeOf(dir, "char-lamp-compare-1").operation).toMatchObject({ type: "derive", params: { op: "compare-sheets", inputs: ["char-lamp-sheet-1", "char-lamp-sheet-2"] } });
    expect(sidecarOf(dir).sheets["character:lamp"].compares).toEqual(["char-lamp-compare-1"]);
  }, 30_000);

  test("redo-panel redraws one cell and composites it into a new board, leaving the rest", () => {
    const panelFile = join(dir, "red.png");
    spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=640x360", "-frames:v", "1", panelFile]);
    const out = ok(dir, ["redo-panel", "--episode", "ep01", "--shot", "5", "--upload", panelFile], REAL);
    expect(out.board.id).toBe("ep01-a-board-2");
    const board = join(dir, out.board.uri);
    // Mock boards are flat grey 1536×864: cell 5 (row 2, col 2) is 512..1024 × 288..576.
    // Colour conversion rounds a little; red vs grey is what matters.
    const [r, g, b] = pixel(board, 768, 432);
    expect(r).toBeGreaterThan(240);
    expect(Math.max(g, b)).toBeLessThan(16);
    const grey = pixel(board, 100, 100);
    expect(grey.every((c) => Math.abs(c - 128) <= 3)).toBe(true);
    // The neighbouring cell (shot 6, right of it) is untouched.
    expect(pixel(board, 1280, 432).every((c) => Math.abs(c - 128) <= 3)).toBe(true);
    const record = sidecarOf(dir).episodes.ep01.parts.A!;
    expect(record.panels[0]).toMatchObject({ shot: 5, board: "ep01-a-board-1", result: "ep01-a-board-2" });
    expect(record.boards[1].from).toEqual({ board: "ep01-a-board-1", panel: "ep01-a-panel-5-1", shot: 5 });
    expect(edgeOf(dir, "ep01-a-board-2").operation).toMatchObject({ type: "composite", params: { op: "replace-panel", shot: 5 } });
  }, 30_000);

  test("a generated panel sends the board it goes back into as image 1, then the sheets", () => {
    // Live Ep01: a panel drawn from the sheets alone came back in another hand
    // (circled number, lighter pencil, wider framing) than the board around it.
    rmSync(join(dir, ".mock-log.jsonl"), { force: true });
    // The newest ready board is the one in effect (no board is picked here).
    const base = sidecarOf(dir).episodes.ep01.parts.A!.boards.at(-1)!.asset;
    const out = ok(dir, ["redo-panel", "--episode", "ep01", "--shot", "6"], REAL);
    const [call] = mockLog(dir).filter((c: { kind: string }) => c.kind === "image");
    expect(call.imageUrls[0]).toBe(join(dir, assetOf(dir, base).uri));
    expect(call.imageUrls.length).toBeGreaterThan(1);
    expect(call.prompt.split("\n")[1]).toStartWith("Image 1 is the current storyboard:");
    const panel = sidecarOf(dir).episodes.ep01.parts.A!.panels.at(-1)!;
    expect(panel).toMatchObject({ shot: 6, board: base, result: out.board.id });
    // Craft edges are single-parent: the first input is the edge's parent.
    expect(edgeOf(dir, panel.asset).fromAssetId).toBe(base);
  }, 30_000);

  test("review-episode samples every shot inside its span; the sheets sit once on top of the overview", () => {
    ok(dir, ["shoot-video", "--episode", "ep01"], REAL);
    const out = ok(dir, ["review-episode", "--episode", "ep01"], REAL);
    const [review] = out.reviews;
    expect(review.strips).toHaveLength(9);
    expect(review.sheetsRow).toMatch(/\/sheets\.jpg$/);
    // A shot row is frames only (the viewer shows the sheet beside it); the sheets row is larger.
    const strip = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", join(dir, review.strips[0].uri)], { encoding: "utf-8" }).stdout.trim();
    expect(strip).toBe("1278,240");
    const overview = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", join(dir, review.overview)], { encoding: "utf-8" }).stdout.trim();
    expect(overview).toBe(`1280,${360 + 9 * 240}`);
    expect(review.expect[0]).toEqual({ shot: 1, named: ["lamp", "ox"] });
    expect(review.strips[0].times).toEqual([0.5, 1.5, 2.5]);
    expect(review.strips[4].times[0]).toBeGreaterThanOrEqual(12);
    expect(review.strips[4].times[2]).toBeLessThan(16);
    expect(review.sheets).toEqual(["char-lamp-sheet-2", "char-ox-sheet-1"]);
    expect(edgeOf(dir, review.review).operation).toMatchObject({ type: "derive", params: { op: "contact-sheet", inputs: ["ep01-a-take-1", "char-lamp-sheet-2", "char-ox-sheet-1"] } });
    ok(dir, ["verdict", "--episode", "ep01", "--shot", "3", "--character", "lamp", "--verdict", "ok"], REAL);
    expect(sidecarOf(dir).episodes.ep01.parts.A!.checks["ep01-a-take-1"]["3"].lamp.frame).toBe(`${review.review}-shot-3`);
    expect(ok(dir, ["status"], REAL).episodes[0].stage).toBe("reviewed");
  }, 60_000);

  test("patch-range splices shots back into a rebuilt final; the season compiles behind title cards", () => {
    const out = ok(dir, ["patch-range", "--episode", "ep01", "--shots", "6-6"], REAL);
    expect(out.plan.covered).toEqual([6, 7]);
    expect(out.span).toEqual([16, 19]);
    expect(out.final.id).toBe("ep01-final-1");
    // Built, but not done: most cells are unjudged, and shot 6 now shows the patch.
    expect(out.final.stage).toMatchObject({ stage: "reviewed", finalReady: true });
    const final = sidecarOf(dir).episodes.ep01.finals[0];
    // testsrc has no hard cuts: the splice stays where the shot list puts it.
    expect(final.splices).toEqual([{ part: "A", shots: [6, 6], at: [16, 19], patch: "ep01-a-patch-6-6-1", planned: { take: [16, 19], patch: [0, 3] }, snapped: { take: [16, 19], patch: [0, 3] } }]);
    expect(final.takes).toEqual({ A: "ep01-a-take-1" });
    expect(Math.abs(duration(join(dir, "episodes", "ep01", "final-1.mp4")) - 30)).toBeLessThan(0.15);
    expect(sidecarOf(dir).episodes.ep01.parts.A!.patches[0].applied).toBe(true);
    expect(ok(dir, ["status"], REAL).episodes[0].stage).toBe("reviewed");
    // The patch gets its own contact sheet: only the shot it splices back.
    const patchReview = ok(dir, ["review-episode", "--episode", "ep01", "--take", "ep01-a-patch-6-6-1"], REAL).reviews[0];
    expect(patchReview).toMatchObject({ take: "ep01-a-patch-6-6-1", patch: true });
    expect(patchReview.strips.map((x: { shot: number }) => x.shot)).toEqual([6]);
    ok(dir, ["verdict", "--episode", "ep01", "--shot", "1-9", "--character", "lamp,ox", "--verdict", "ok"], REAL);
    ok(dir, ["verdict", "--episode", "ep01", "--shot", "1-9", "--group", "notes", "--verdict", "absent"], REAL);
    const checks = sidecarOf(dir).episodes.ep01.parts.A!.checks;
    expect(checks["ep01-a-patch-6-6-1"]["6"].lamp).toMatchObject({ verdict: "ok", frame: `${patchReview.review}-shot-6` });
    expect(ok(dir, ["status"], REAL).episodes[0].stage).toBe("done");
    // Nothing changed: final makes no new file; --force does.
    const again = ok(dir, ["final", "--episode", "ep01"], REAL);
    expect(again.final).toMatchObject({ id: "ep01-final-1", unchanged: true, stage: { stage: "done" } });
    expect(project(dir).assets.filter((a: { id: string }) => a.id.startsWith("ep01-final-")).map((a: { id: string }) => a.id)).toEqual(["ep01-final-1"]);
    expect(ok(dir, ["final", "--episode", "ep01", "--force"], REAL).final).toMatchObject({ id: "ep01-final-2", unchanged: false });
    const season = ok(dir, ["compile-season", "--titles"], REAL);
    expect(season.compilation).toMatchObject({ id: "season-1", episodes: ["ep01"], titles: ["Clock Out"] });
    expect(Math.abs(duration(join(dir, "season", "season-1.mp4")) - 31.5)).toBeLessThan(0.2);
  }, 120_000);

  test("a splice meets the cut the take really has, within half a second, and records both", () => {
    const ws = fresh("anime-series-snap-");
    seedText(ws, REAL);
    const image = join(ws, "sheet.webp");
    writeFileSync(image, webpHeader(1536, 864));
    ok(ws, ["shoot-board", "--episode", "ep01", "--upload", image], REAL);
    // The model cut to shot 6 at 15.7 s, not at the planned 16 s.
    const take = join(ws, "take.mp4");
    const made = spawnSync("ffmpeg", [
      "-v", "error", "-y",
      "-f", "lavfi", "-i", "color=c=red:s=320x180:r=24:d=15.7",
      "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=24:d=14.3",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=30",
      "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]", "-map", "[v]", "-map", "2:a",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", take,
    ]);
    expect(made.status).toBe(0);
    ok(ws, ["shoot-video", "--episode", "ep01", "--upload", take], REAL);
    const patch = join(ws, "patch.mp4");
    spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=green:s=320x180:r=24:d=6", "-c:v", "libx264", "-pix_fmt", "yuv420p", patch]);
    // Shot 6 starts on the take's cut (15.7 s, within 0.5 s of 16) but ends
    // at 19 s inside one continuous shot: both the Jimeng prompt and the
    // patch say so before anything is spliced.
    const prompts = run(ws, ["prompts", "--episode", "ep01", "--shots", "6-6", "--target", "jimeng", "--json"], REAL);
    expect(JSON.parse(prompts.out).uncutEnds).toEqual([19]);
    expect(prompts.err).toContain("ep01-a-take-1 has no cut within 0.5 s of 19 s, where shots 6–6 end");
    const patched = run(ws, ["patch-range", "--episode", "ep01", "--shots", "6-6", "--upload", patch, "--json", "--at", String(T0)], REAL);
    expect(patched.code).toBe(0);
    expect(patched.err).toContain("WARN: ep01-a-take-1 has no cut within 0.5 s of 19 s, where shots 6–6 end");
    const out = JSON.parse(patched.out);
    expect(out.uncutEnds).toEqual([19]);
    const [splice] = sidecarOf(ws).episodes.ep01.finals[0].splices;
    expect(out.final.id).toBe("ep01-final-1");
    expect(splice.planned).toEqual({ take: [16, 19], patch: [0, 3] });
    expect(splice.snapped!.take[0]).toBeCloseTo(15.7, 1);
    expect(splice.snapped!.take[1]).toBe(19);
    expect(splice.snapped!.patch).toEqual([0, 3]);
    const finalFile = join(ws, "episodes", "ep01", "final-1.mp4");
    expect(Math.abs(duration(finalFile) - (30 - (19 - 15.7) + 3))).toBeLessThan(0.15);
    // Just after the real cut the final shows the patch, not the take's old shot 6.
    const frame = join(ws, "at-15_8.png");
    spawnSync("ffmpeg", ["-v", "error", "-y", "-ss", "15.8", "-i", finalFile, "-frames:v", "1", frame]);
    const [r, g, b] = pixel(frame, 160, 90);
    expect(g).toBeGreaterThan(100);
    expect(Math.max(r, b)).toBeLessThan(60);
  }, 120_000);
});

describe.skipIf(!HAS_FFMPEG)("series.mjs frames on real clips", () => {
  // The take: red until 16 s (shot 6 starts there), blue after, a white box in
  // the top-left quarter throughout. The patch over shot 6: green for its 3 s
  // of shot 6, then yellow for the shot 7 it borrowed and never shows.
  let ws = "";
  const size = (file: string) => spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", file], { encoding: "utf-8" }).stdout.trim();
  const isColour = (file: string, x: number, y: number, want: "red" | "blue" | "green" | "white") => {
    const [r, g, b] = pixel(file, x, y);
    if (want === "white") return Math.min(r, g, b) > 220;
    // lavfi's "green" is #008000, red and blue are full.
    const hi = { red: r, green: g, blue: b }[want];
    const others = { red: [g, b], green: [r, b], blue: [r, g] }[want];
    return hi! > 100 && Math.max(...others!) < 70;
  };
  beforeAll(() => {
    ws = fresh("anime-series-frames-");
    seedText(ws, REAL);
    const image = join(ws, "sheet.webp");
    writeFileSync(image, webpHeader(1536, 864));
    ok(ws, ["shoot-board", "--episode", "ep01", "--upload", image], REAL);
    const take = join(ws, "take.mp4");
    const made = spawnSync("ffmpeg", [
      "-v", "error", "-y",
      "-f", "lavfi", "-i", "color=c=red:s=320x180:r=24:d=16",
      "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=24:d=14",
      "-f", "lavfi", "-i", "color=c=white:s=160x90:r=24:d=30",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=30",
      "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[bg];[bg][2:v]overlay=0:0[v]", "-map", "[v]", "-map", "3:a",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", take,
    ]);
    if (made.status !== 0) throw new Error(`fixture take: ${made.stderr}`);
    ok(ws, ["shoot-video", "--episode", "ep01", "--upload", take], REAL);
  });

  test("frames sample one shot of the take at its own size, inside the workspace, recorded as free derive assets", () => {
    const out = ok(ws, ["frames", "--episode", "ep01", "--shot", "1", "--count", "3"], REAL);
    expect(out).toMatchObject({ take: "ep01-a-take-1", patch: false, span: [0, 3], size: "320×180", crop: null });
    // --count 3 is the contact strip's seconds for that shot, at full size.
    expect(out.frames.map((f: { time: number }) => f.time)).toEqual([0.5, 1.5, 2.5]);
    expect(out.frames.map((f: { uri: string }) => f.uri)).toEqual([0.5, 1.5, 2.5].map((t) => `episodes/ep01/review/a-frames-1/shot-01-${t.toFixed(2)}s.jpg`));
    const first = join(ws, out.frames[0].uri);
    expect(size(first)).toBe("320,180");
    expect(isColour(first, 240, 135, "red")).toBe(true);
    expect(isColour(first, 40, 20, "white")).toBe(true);
    expect(assetOf(ws, "ep01-a-frames-1-1")).toMatchObject({ type: "image", status: "ready", uri: out.frames[0].uri });
    expect(edgeOf(ws, "ep01-a-frames-1-1")).toMatchObject({ fromAssetId: "ep01-a-take-1", operation: { type: "derive", params: { op: "frame", shot: 1, time: 0.5, take: "ep01-a-take-1" } } });
    // Seconds named on the take's clock: 17.5 s is inside shot 6, after the cut to blue.
    const named = ok(ws, ["frames", "--episode", "ep01", "--shot", "6", "--seconds", "17.5"], REAL);
    expect(named.frames).toEqual([{ asset: "ep01-a-frames-2-1", uri: "episodes/ep01/review/a-frames-2/shot-06-17.50s.jpg", time: 17.5 }]);
    expect(isColour(join(ws, named.frames[0].uri), 240, 135, "blue")).toBe(true);
    // Free: no cost on the record; the contact sheet of record (what verdicts and splices read) is untouched.
    expect(edgeOf(ws, "ep01-a-frames-1-1").operation.params.cost).toBeUndefined();
    expect(sidecarOf(ws).episodes.ep01.parts.A!.reviews).toEqual([]);
    expect(ok(ws, ["validate"], REAL).ok).toBe(true);
  }, 60_000);

  test("--crop keeps a box of the frame and enlarges it to fit the frame, up to the frame's own size", () => {
    const quarter = ok(ws, ["frames", "--episode", "ep01", "--shot", "1", "--seconds", "1", "--crop", "0,0,0.5,0.5"], REAL);
    expect(quarter.closeup).toEqual({ pixels: { x: 0, y: 0, w: 160, h: 90 }, size: { w: 320, h: 180 } });
    const file = join(ws, quarter.frames[0].uri);
    expect(quarter.frames[0].uri).toEndWith("shot-01-1.00s-closeup.jpg");
    expect(size(file)).toBe("320,180");
    for (const [x, y] of [[20, 20], [160, 90], [300, 160]]) expect(isColour(file, x!, y!, "white")).toBe(true);
    expect(edgeOf(ws, quarter.frames[0].asset).operation.params).toMatchObject({ op: "frame", crop: [0, 0, 0.5, 0.5] });
    // A tall box already as high as the frame stays at its own size.
    const right = ok(ws, ["frames", "--episode", "ep01", "--shot", "1", "--seconds", "1", "--crop", "0.5,0,0.5,1"], REAL);
    expect(right.closeup).toEqual({ pixels: { x: 160, y: 0, w: 160, h: 180 }, size: { w: 160, h: 180 } });
    expect(isColour(join(ws, right.frames[0].uri), 80, 90, "red")).toBe(true);
  }, 60_000);

  test("a shot spliced from a patch is sampled on the patch, on the patch's own clock; --take reaches the take", () => {
    const patch = join(ws, "patch.mp4");
    const made = spawnSync("ffmpeg", [
      "-v", "error", "-y",
      "-f", "lavfi", "-i", "color=c=green:s=320x180:r=24:d=3",
      "-f", "lavfi", "-i", "color=c=yellow:s=320x180:r=24:d=3",
      "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]", "-map", "[v]", "-c:v", "libx264", "-pix_fmt", "yuv420p", patch,
    ]);
    expect(made.status).toBe(0);
    ok(ws, ["patch-range", "--episode", "ep01", "--shots", "6-6", "--upload", patch], REAL);
    const id = "ep01-a-patch-6-6-1";
    const onPatch = ok(ws, ["frames", "--episode", "ep01", "--shot", "6", "--count", "2"], REAL);
    expect(onPatch).toMatchObject({ take: id, patch: true, span: [0, 3] });
    expect(onPatch.frames.map((f: { time: number }) => f.time)).toEqual([0.75, 2.25]);
    for (const f of onPatch.frames) expect(isColour(join(ws, f.uri), 240, 135, "green")).toBe(true);
    expect(edgeOf(ws, onPatch.frames[0].asset).fromAssetId).toBe(id);
    // The take is still reachable by name, on its own clock (shot 6 is 16–19 s there).
    const onTake = ok(ws, ["frames", "--episode", "ep01", "--shot", "6", "--count", "1", "--take", "ep01-a-take-1"], REAL);
    expect(onTake).toMatchObject({ take: "ep01-a-take-1", patch: false, span: [16, 19] });
    expect(isColour(join(ws, onTake.frames[0].uri), 240, 135, "blue")).toBe(true);
    // The patch splices shot 6 only: shot 7 is sampled on the take, never the borrowed yellow.
    const next = ok(ws, ["frames", "--episode", "ep01", "--shot", "7", "--count", "1"], REAL);
    expect(next).toMatchObject({ take: "ep01-a-take-1", patch: false, span: [19, 22] });
    expect(isColour(join(ws, next.frames[0].uri), 240, 135, "blue")).toBe(true);
  }, 120_000);
});

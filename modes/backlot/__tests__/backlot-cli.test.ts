/**
 * `backlot.mjs`, pinned as a real artefact.
 *
 * The script is SPAWNED as a process with a pinned cwd, never imported: its
 * contract with the agent is argv in, one JSON object out, an exit code, and
 * the bytes it leaves on disk. Testing it any other way would pin something
 * the agent never sees.
 *
 * What is exercised here is the film level — the manifest, the approvals and
 * the gate in front of every paid command, the bible, the sound, and the
 * cut. The paid vendors are replaced through the script's own seams
 * (`BACKLOT_TTS_MODULE`, `BACKLOT_BGM_MODULE`), which write real audio with
 * ffmpeg, so the argv this script builds and the files it records are the
 * real ones and nothing is sent anywhere. The cut's fixtures are ffmpeg
 * `lavfi` sources, as in `previz-cli.test.ts`.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPTS = join(import.meta.dir, "..", "skill", "scripts");
const BACKLOT = join(SCRIPTS, "backlot.mjs");
const PREVIZ = join(SCRIPTS, "previz.mjs");

const HAS_FFMPEG =
  Bun.spawnSync(["ffmpeg", "-version"], { stdout: "ignore", stderr: "ignore" }).exitCode === 0 &&
  Bun.spawnSync(["ffprobe", "-version"], { stdout: "ignore", stderr: "ignore" }).exitCode === 0;

const workspaces: string[] = [];
afterAll(() => {
  for (const dir of workspaces) rmSync(dir, { recursive: true, force: true });
});

/** `realpathSync` because macOS resolves /var to /private/var for a child
 *  process's cwd — without it every absolute path the script prints would
 *  disagree with the one the test built. */
function workspace(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "backlot-")));
  workspaces.push(dir);
  return dir;
}

function run(cwd: string, argv: string[], env?: Record<string, string>) {
  const result = Bun.spawnSync([process.execPath, BACKLOT, ...argv], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    ...(env ? { env: { ...process.env, ...env } } : {}),
  });
  return { code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString() };
}

function json(cwd: string, argv: string[], env?: Record<string, string>): Record<string, any> {
  const result = run(cwd, argv, env);
  if (result.code !== 0) throw new Error(`backlot.mjs ${argv.join(" ")} failed (${result.code}):\n${result.err}`);
  return JSON.parse(result.out);
}

function previz(cwd: string, argv: string[], env?: Record<string, string>) {
  const result = Bun.spawnSync([process.execPath, PREVIZ, ...argv], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    ...(env ? { env: { ...process.env, ...env } } : {}),
  });
  return { code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString() };
}

/** `previz.mjs` is the only writer of shot.json, so the film-level tests
 *  that need a shot fact set it the way an agent would. */
function previzJson(cwd: string, argv: string[]): Record<string, any> {
  const result = previz(cwd, argv);
  if (result.code !== 0) throw new Error(`previz.mjs ${argv.join(" ")} failed (${result.code}):\n${result.err}`);
  return JSON.parse(result.out);
}

const manifestOf = (cwd: string, project = "film") =>
  JSON.parse(readFileSync(join(cwd, project, "backlot.json"), "utf-8"));

const shotOf = (cwd: string, id: string, project = "film") =>
  JSON.parse(readFileSync(join(cwd, project, "shots", id, "shot.json"), "utf-8"));

/** A film with one scene, scaffolded exactly as an agent would. */
function film(cwd: string, extra: string[] = []) {
  json(cwd, ["init", "film", "--title", "Last Customer", "--logline", "A clerk waits out the last hour", ...extra]);
  writeFileSync(join(cwd, "film", "idea.md"), "# Idea\n\nA clerk waits.\n");
  writeFileSync(join(cwd, "film", "screenplay.md"), "# Screenplay\n\nINT. 便利店 — 夜\n");
  json(cwd, ["scene", "add", "film", "--id", "sc1", "--heading", "INT. 便利店 — 夜", "--summary", "one customer"]);
}

/** A real PNG, because `look` refuses anything that is not one. */
function fixturePng(cwd: string, name = "sheet.png"): string {
  const path = join(cwd, name);
  const made = Bun.spawnSync([
    "ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=slategray:s=64x64:d=1", "-frames:v", "1", path,
  ]);
  if (made.exitCode !== 0) throw new Error(`could not build the fixture PNG: ${made.stderr.toString()}`);
  return path;
}

/** A real MP4 of `seconds`, silent unless a tone is asked for. */
function fixtureMp4(path: string, { seconds = 1, tone = false, size = "64x64" } = {}): string {
  const args = ["-y", "-v", "error", "-f", "lavfi", "-i", `testsrc=size=${size}:rate=24:duration=${seconds}`];
  if (tone) args.push("-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`);
  args.push("-c:v", "libx264", "-pix_fmt", "yuv420p");
  if (tone) args.push("-c:a", "aac", "-shortest");
  args.push(path);
  const made = Bun.spawnSync(["ffmpeg", ...args]);
  if (made.exitCode !== 0) throw new Error(`could not build the fixture MP4: ${made.stderr.toString()}`);
  return path;
}

/**
 * The injected vendors. Each writes what the real script writes and prints
 * what the real script prints — the argv, the files and the records are
 * exercised for real; only the network is gone.
 */
const FAKE_TTS = `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
const { values } = parseArgs({ options: {
  text: { type: "string" }, output: { type: "string" }, model: { type: "string" },
  voice: { type: "string" }, style: { type: "string" }, language: { type: "string" }, json: { type: "boolean" },
} });
writeFileSync(process.env.FAKE_TTS_ARGV, JSON.stringify(values) + "\\n", { flag: "a" });
const seconds = Math.max(1, Math.round((values.text ?? "").length / 4));
const made = spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=520:duration=" + seconds, "-ac", "2", "-ar", "48000", values.output], { encoding: "utf-8" });
if (made.status !== 0) { console.error(made.stderr); process.exit(1); }
console.log(JSON.stringify({ path: values.output, seconds }));
`;

const FAKE_BGM = `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
const { values } = parseArgs({ options: { prompt: { type: "string" }, output: { type: "string" }, duration: { type: "string" }, model: { type: "string" } } });
writeFileSync(process.env.FAKE_BGM_ARGV, JSON.stringify(values) + "\\n", { flag: "a" });
const made = spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=180:duration=" + (values.duration ?? 3), "-ac", "2", "-ar", "48000", values.output], { encoding: "utf-8" });
if (made.status !== 0) { console.error(made.stderr); process.exit(1); }
console.log(values.output);
`;

function vendors(cwd: string) {
  const tts = join(cwd, "fake-tts.mjs");
  const bgm = join(cwd, "fake-bgm.mjs");
  writeFileSync(tts, FAKE_TTS);
  writeFileSync(bgm, FAKE_BGM);
  return {
    BACKLOT_TTS_MODULE: tts,
    BACKLOT_BGM_MODULE: bgm,
    FAKE_TTS_ARGV: join(cwd, "tts-argv.jsonl"),
    FAKE_BGM_ARGV: join(cwd, "bgm-argv.jsonl"),
  };
}

const argvOf = (path: string) => readFileSync(path, "utf-8").trim().split("\n").map((line) => JSON.parse(line));

describe("init", () => {
  test("writes the film's manifest with the gates closed and nothing approved", () => {
    const cwd = workspace();
    const init = json(cwd, [
      "init", "film", "--title", "Last Customer", "--logline", "A clerk waits out the last hour",
      "--seconds", "6", "--fps", "24", "--width", "640", "--height", "360",
    ]);
    expect(init.project).toEqual({
      version: 1,
      title: "Last Customer",
      logline: "A clerk waits out the last hour",
      defaults: { seconds: 6, fps: 24, width: 640, height: 360 },
      gates: "closed",
      approvals: {},
      scenes: [],
      characters: [],
      sets: [],
      shots: [],
    });
    expect(existsSync(join(cwd, "film", "shots"))).toBe(true);
    expect(init.next.stage).toBe("idea");
    expect(init.stages.map((entry: any) => entry.status)).toEqual(Array(8).fill("empty"));
  });

  test("refuses a second init, a film with no logline, and a fractional frame count", () => {
    const cwd = workspace();
    json(cwd, ["init", "film", "--title", "A", "--logline", "B"]);
    expect(run(cwd, ["init", "film", "--title", "A", "--logline", "B"]).err).toContain("already exists");
    expect(run(cwd, ["init", "other", "--title", "A"]).err).toContain("--logline");
    expect(run(cwd, ["init", "other", "--title", "A", "--logline", "B", "--seconds", "7.9"]).err).toContain("not whole");
    expect(existsSync(join(cwd, "other"))).toBe(false);
  });
});

describe("approve and the gates", () => {
  test("an empty stage cannot be approved — an approval of nothing opens the gate behind it", () => {
    const cwd = workspace();
    json(cwd, ["init", "film", "--title", "A", "--logline", "B"]);
    const refused = run(cwd, ["approve", "film", "script"]);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("the stage is empty");
    expect(manifestOf(cwd).approvals).toEqual({});
  });

  test("an unknown stage is refused by name", () => {
    const cwd = workspace();
    film(cwd);
    expect(run(cwd, ["approve", "film", "everything"]).err).toContain('unknown stage "everything"');
  });

  test("approval records the hash of what was seen, and an edit afterwards reads as changed", () => {
    const cwd = workspace();
    film(cwd);
    const approved = json(cwd, ["approve", "film", "script", "--now", "1758380000000", "--note", "ship it"]);
    expect(approved.was).toBe("draft");
    expect(approved.status).toBe("approved");
    expect(approved.approval).toMatchObject({ at: 1758380000000, note: "ship it" });
    expect(approved.approval.hash).toMatch(/^[0-9a-f]{8}$/);
    expect(approved.opens).toEqual(["bible-image", "voice"]);

    writeFileSync(join(cwd, "film", "screenplay.md"), "# Screenplay\n\nEXT. 停车场 — 夜\n");
    const after = json(cwd, ["status", "film"]).stages.find((entry: any) => entry.stage === "script");
    expect(after.status).toBe("changed");
    // Re-approving the version the creator has now seen closes it again,
    // with a NEW hash.
    const again = json(cwd, ["approve", "film", "script", "--now", "1758390000000"]);
    expect(again.was).toBe("changed");
    expect(again.status).toBe("approved");
    expect(again.approval.hash).not.toBe(approved.approval.hash);
  });

  test("`gate` answers before the spend, and says which stage is waiting", () => {
    const cwd = workspace();
    film(cwd);
    const refused = run(cwd, ["gate", "film", "bible-image"]);
    expect(refused.code).toBe(1);
    expect(JSON.parse(refused.out)).toMatchObject({ ok: false, allowed: false, stage: "script", status: "draft" });
    expect(refused.err).toContain('stage "script" is draft');
    // The refusal names both ways past it, verbatim.
    expect(refused.err).toContain("backlot.mjs approve");
    expect(refused.err).toContain("gates");

    json(cwd, ["approve", "film", "script"]);
    const allowed = json(cwd, ["gate", "film", "bible-image"]);
    expect(allowed).toMatchObject({ allowed: true, stage: "script", status: "approved" });
    // Free work is allowed without any approval at all.
    expect(json(cwd, ["gate", "film", "render"])).toMatchObject({ allowed: true, stage: null });
  });

  test("open gates satisfy every gate, and say so loudly", () => {
    const cwd = workspace();
    film(cwd);
    const opened = run(cwd, ["gates", "film", "open"]);
    expect(JSON.parse(opened.out).gates).toBe("open");
    expect(opened.err).toContain("gates are now OPEN");
    expect(json(cwd, ["gate", "film", "cut-final"]).allowed).toBe(true);
    // …and status keeps saying it, because it changes what every other
    // command will do.
    expect(run(cwd, ["status", "film"]).err).toContain("gates are OPEN");
    json(cwd, ["gates", "film", "closed"]);
    expect(run(cwd, ["gate", "film", "cut-final"]).code).toBe(1);
    expect(run(cwd, ["gates", "film", "ajar"]).err).toContain("open|closed");
  });
});

describe("scenes and shots", () => {
  test("scenes are numbered, kept in order, and edited by id", () => {
    const cwd = workspace();
    film(cwd);
    json(cwd, ["scene", "add", "film", "--id", "sc3", "--number", "3", "--heading", "EXT. 停车场"]);
    const added = json(cwd, ["scene", "add", "film", "--id", "sc2", "--number", "2", "--heading", "INT. 后仓"]);
    expect(added.scenes.map((scene: any) => scene.id)).toEqual(["sc1", "sc2", "sc3"]);
    expect(run(cwd, ["scene", "add", "film", "--id", "sc1", "--heading", "again"]).err).toContain("already exists");

    const edited = json(cwd, ["scene", "set", "film", "--id", "sc2", "--summary", "he counts the till"]);
    expect(edited.scene).toMatchObject({ id: "sc2", number: 2, summary: "he counts the till" });
    expect(run(cwd, ["scene", "set", "film", "--id", "sc9", "--summary", "x"]).err).toContain('no scene "sc9"');
  });

  test("shot add writes the film's order and scaffolds the shot through previz.mjs", () => {
    const cwd = workspace();
    film(cwd);
    const made = json(cwd, [
      "shot", "add", "film", "S01 Enter", "--title", "He comes in out of the rain",
      "--scene", "sc1", "--characters", "kai,clerk", "--set", "store",
    ]);
    expect(made.id).toBe("s01-enter");
    expect(made.shots).toEqual(["s01-enter"]);
    expect(manifestOf(cwd).shots).toEqual(["s01-enter"]);
    for (const file of ["shot.json", "shot-plan.md", "prompts.md", "comparison.md", "greybox/scene.py"]) {
      expect(existsSync(join(cwd, "film", "shots", "s01-enter", file))).toBe(true);
    }
    const shot = shotOf(cwd, "s01-enter");
    expect(shot).toMatchObject({ scene: "sc1", characters: ["kai", "clerk"], set: "store", board: null, lines: [] });
    expect(shot.checks).toHaveLength(8);
    // The bible does not have them yet: a warning, never a refusal — the
    // bible can be written after the shot list.
    expect(run(cwd, ["shot", "add", "film", "s02", "--title", "Two", "--characters", "ghost"]).err).toContain(
      'character "ghost" is not in the bible yet',
    );
  });

  test("a shot in a scene that does not exist is refused, and nothing is scaffolded", () => {
    const cwd = workspace();
    film(cwd);
    const refused = run(cwd, ["shot", "add", "film", "s09", "--title", "Nine", "--scene", "sc9"]);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain('no scene "sc9"');
    expect(existsSync(join(cwd, "film", "shots", "s09"))).toBe(false);
    expect(manifestOf(cwd).shots).toEqual([]);
    // Twice is refused too, and the order is not duplicated.
    json(cwd, ["shot", "add", "film", "s01", "--title", "One"]);
    expect(run(cwd, ["shot", "add", "film", "s01", "--title", "One again"]).err).toContain("already exists");
    expect(manifestOf(cwd).shots).toEqual(["s01"]);
  });

  test("the film's spec is the default every shot starts from", () => {
    const cwd = workspace();
    json(cwd, ["init", "film", "--title", "A", "--logline", "B", "--seconds", "6", "--width", "854", "--height", "480"]);
    const made = json(cwd, ["shot", "add", "film", "s01", "--title", "One"]);
    expect(made.spec).toEqual({ seconds: 6, fps: 24, width: 854, height: 480, frames: 144 });
    const scene = readFileSync(join(cwd, "film", "shots", "s01", "greybox", "scene.py"), "utf-8");
    expect(scene).toContain("pv.setup(seconds=6, fps=24, width=854, height=480)");
  });
});

describe("the bible", () => {
  test.skipIf(!HAS_FFMPEG)("a look is refused while the script is unapproved, and registered once it is", () => {
    const cwd = workspace();
    film(cwd);
    json(cwd, ["character", "add", "film", "kai", "--name", "小凯", "--description", "a tired clerk"]);
    const png = fixturePng(cwd);

    const refused = run(cwd, ["character", "look", "film", "kai", "--file", png, "--prompt", "three-quarter sheet"]);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain('stage "script" is draft');
    expect(existsSync(join(cwd, "film", "bible", "characters", "kai", "sheet.png"))).toBe(false);

    json(cwd, ["approve", "film", "script"]);
    const registered = json(cwd, [
      "character", "look", "film", "kai", "--file", png, "--prompt", "three-quarter sheet, neutral background",
      "--cost-usd", "0.13", "--cost-basis", "reported",
    ]);
    expect(registered.file).toBe("bible/characters/kai/sheet.png");
    expect(registered.revision).toBe(1);
    expect(registered.record.sheet).toMatchObject({
      file: "sheet.png",
      revision: 1,
      prompt: "three-quarter sheet, neutral background",
      cost: { usd: 0.13, basis: "reported" },
    });
    // A second frame is a new REVISION of the same filename — that record,
    // not the bytes, is what the stage hash sees.
    expect(json(cwd, ["character", "look", "film", "kai", "--file", png, "--prompt", "again"]).revision).toBe(2);
  });

  test.skipIf(!HAS_FFMPEG)("a price with no stated provenance is refused, and so is a file that is not a PNG", () => {
    const cwd = workspace();
    film(cwd);
    json(cwd, ["approve", "film", "script"]);
    json(cwd, ["character", "add", "film", "kai", "--name", "小凯"]);
    const png = fixturePng(cwd);
    expect(run(cwd, ["character", "look", "film", "kai", "--file", png, "--prompt", "x", "--cost-usd", "0.13"]).err)
      .toContain("--cost-basis");
    expect(run(cwd, ["character", "look", "film", "kai", "--file", png, "--prompt", "x", "--cost-usd", "0.13", "--cost-basis", "vibes"]).err)
      .toContain("must be one of table|reported|estimate");
    writeFileSync(join(cwd, "not.png"), "this is not a png");
    expect(run(cwd, ["character", "look", "film", "kai", "--file", join(cwd, "not.png"), "--prompt", "x"]).err)
      .toContain("not a readable PNG");
    // An unpriced call is recorded anyway, and says it was not priced.
    const free = run(cwd, ["character", "look", "film", "kai", "--file", png, "--prompt", "x"]);
    expect(free.code).toBe(0);
    expect(free.err).toContain("no price recorded");
    expect(JSON.parse(free.out).record.sheet.cost).toBeNull();
  });

  test("a look on a character the bible does not carry is refused by name", () => {
    const cwd = workspace();
    film(cwd);
    json(cwd, ["approve", "film", "script"]);
    expect(run(cwd, ["character", "look", "film", "ghost", "--file", "x.png", "--prompt", "y"]).err)
      .toContain('no character "ghost" in the bible');
    expect(run(cwd, ["character", "add", "film", "kai"]).err).toContain("--name");
  });

  test.skipIf(!HAS_FFMPEG)("a voice sample is synthesized, measured and recorded against the character", () => {
    const cwd = workspace();
    film(cwd);
    json(cwd, ["approve", "film", "script"]);
    json(cwd, ["character", "add", "film", "kai", "--name", "小凯"]);
    const env = vendors(cwd);

    const refusedFirst = run(workspaceWithoutApproval(), ["character", "voice", "film", "kai", "--text", "hello"], env);
    expect(refusedFirst.code).toBe(1);

    const made = json(cwd, [
      "character", "voice", "film", "kai", "--text", "还开着吗？我找个东西。",
      "--model", "seed-speech", "--voice", "vienna_mixed_en_zh", "--style", "tired",
      "--cost-usd", "0.01", "--cost-basis", "table",
    ], env);
    expect(made.file).toBe("bible/characters/kai/voice.mp3");
    expect(existsSync(join(cwd, "film", "bible", "characters", "kai", "voice.mp3"))).toBe(true);
    expect(made.voice).toMatchObject({ model: "seed-speech", voiceId: "vienna_mixed_en_zh", style: "tired" });
    expect(made.voice.sample).toMatchObject({ file: "voice.mp3", text: "还开着吗？我找个东西。", cost: { usd: 0.01, basis: "table" } });
    expect(made.seconds).toBeGreaterThan(0);
    // The vendor was handed exactly what the record says.
    expect(argvOf(env.FAKE_TTS_ARGV)[0]).toMatchObject({
      text: "还开着吗？我找个东西。",
      model: "seed-speech",
      voice: "vienna_mixed_en_zh",
      style: "tired",
      json: true,
    });
    // …and the run announced that the voice did not come from the vendor.
    expect(run(cwd, ["character", "voice", "film", "kai", "--text", "again"], env).err).toContain("BACKLOT_TTS_MODULE is set");
  });

  /** A second film whose script is NOT approved, for the refusal above. */
  function workspaceWithoutApproval(): string {
    const cwd = workspace();
    film(cwd);
    json(cwd, ["character", "add", "film", "kai", "--name", "小凯"]);
    return cwd;
  }

  test.skipIf(!HAS_FFMPEG)("sets are places, with a concept frame of their own", () => {
    const cwd = workspace();
    film(cwd);
    json(cwd, ["approve", "film", "script"]);
    json(cwd, ["set", "add", "film", "store", "--name", "便利店", "--description", "fluorescent, 3 a.m."]);
    const look = json(cwd, ["set", "look", "film", "store", "--file", fixturePng(cwd), "--prompt", "wide establishing frame"]);
    expect(look.file).toBe("bible/sets/store/concept.png");
    expect(look.record.concept).toMatchObject({ file: "concept.png", revision: 1 });
    const edited = json(cwd, ["set", "set", "film", "store", "--description", "and the rain outside"]);
    expect(edited.record.description).toBe("and the rain outside");
    expect(manifestOf(cwd).sets).toEqual(["store"]);
  });
});

describe("music", () => {
  test.skipIf(!HAS_FFMPEG)("waits for the takes, then records the bed it measured", () => {
    const cwd = workspace();
    film(cwd);
    const env = vendors(cwd);
    const refused = run(cwd, ["music", "film", "--prompt", "drums and guqin"], env);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain('stage "takes" is empty');
    expect(existsSync(join(cwd, "film", "sound", "music.mp3"))).toBe(false);

    json(cwd, ["gates", "film", "open"]);
    const made = json(cwd, ["music", "film", "--prompt", "drums and guqin, sparse", "--seconds", "3", "--cost-usd", "0.4", "--cost-basis", "reported"], env);
    expect(made.file).toBe("sound/music.mp3");
    expect(made.seconds).toBeGreaterThan(2);
    expect(made.sound.music).toMatchObject({
      file: "music.mp3",
      prompt: "drums and guqin, sparse",
      model: "google/lyria-3-pro-preview",
      requestedSeconds: 3,
      cost: { usd: 0.4, basis: "reported" },
    });
    expect(JSON.parse(readFileSync(join(cwd, "film", "sound", "sound.json"), "utf-8")).music.file).toBe("music.mp3");
    // The duration ask travels as the hint the vendor actually takes.
    expect(argvOf(env.FAKE_BGM_ARGV)[0]).toMatchObject({ prompt: "drums and guqin, sparse", duration: "3" });
  });
});

/** A film with one shot that has a greybox, and optionally a selected take. */
function withShot(cwd: string, { take = false, vo = false, anchor = false } = {}) {
  film(cwd);
  json(cwd, ["shot", "add", "film", "s01", "--title", "He comes in", "--scene", "sc1"]);
  const shotDir = join(cwd, "film", "shots", "s01");
  fixtureMp4(join(shotDir, "greybox", "greybox.mp4"), { seconds: 1 });
  const shot = shotOf(cwd, "s01");
  shot.greybox.revision = 1;
  shot.greybox.final = { file: "greybox/greybox.mp4", revision: 1, scale: 1, probe: null, renderedAt: null, renderSeconds: 1 };
  if (take) {
    fixtureMp4(join(shotDir, "takes", "take-01.mp4"), { seconds: 1, tone: true });
    shot.takes = [{
      id: "take-01", status: "done", file: "takes/take-01.mp4", selected: true,
      cost: { usd: 2.1168, basis: "(8 s out + 8 s ref) x $0.1323/s at 480p", estimate: true },
      submittedAt: "2026-09-20T10:20:00.000Z",
    }];
  }
  if (anchor) {
    // The anchor frame `previz.mjs anchor` records: a paid image beside the
    // greybox it was composed from.
    mkdirSync(join(shotDir, "anchors"), { recursive: true });
    fixturePng(shotDir, join("anchors", "first.png"));
    shot.anchors = [{
      id: "first",
      at: 0,
      file: "anchors/first.png",
      revision: 1,
      prompt: "the doorway, cold blue",
      refs: ["shots/s01/anchors/first.greybox.png"],
      greybox: { file: "anchors/first.greybox.png", source: "greybox/greybox.mp4", revision: 1, frame: 1 },
      model: "openai/gpt-image-2.5-sunburst",
      cost: { usd: 0.1904, basis: "reported" },
      createdAt: 1758380500000,
    }];
  }
  if (vo) {
    shot.lines = [{ id: "l2", speaker: "narrator", kind: "vo", text: "凌晨三点。", at: 0.2, file: "sound/l2.mp3", seconds: 1, cost: { usd: 0.01, basis: "table" }, recordedAt: 1758380000000 }];
    mkdirSync(join(shotDir, "sound"), { recursive: true });
    const made = Bun.spawnSync(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=700:duration=1", "-ac", "2", "-ar", "48000", join(shotDir, "sound", "l2.mp3")]);
    if (made.exitCode !== 0) throw new Error(made.stderr.toString());
  }
  writeFileSync(join(shotDir, "shot.json"), `${JSON.stringify(shot, null, 2)}\n`);
  return shotDir;
}

describe("cut", () => {
  test.skipIf(!HAS_FFMPEG)("a reel stands the greybox in, labels it, and writes the edit list last", () => {
    const cwd = workspace();
    withShot(cwd);
    const cut = json(cwd, ["cut", "film", "--reel", "--now", "1758380000000"]);
    expect(cut.kind).toBe("reel");
    expect(cut.file).toBe("cut/reel.mp4");
    expect(cut.standIns).toEqual(["s01"]);
    // An untrimmed segment records the whole range it showed.
    expect(cut.segments).toEqual([{ shot: "s01", source: "greybox", offset: 0, seconds: 1, in: 0, out: 1 }]);
    expect(cut.probe).toMatchObject({ width: 1280, height: 720, fps: 24 });
    expect(existsSync(join(cwd, "film", "cut", "reel.mp4"))).toBe(true);

    const edl = JSON.parse(readFileSync(join(cwd, "film", "cut", "edl.json"), "utf-8"));
    expect(edl).toMatchObject({ version: 1, kind: "reel", file: "reel.mp4", builtAt: 1758380000000, music: null, vo: [] });
    expect(edl.probe.frames).toBe(24);
    // The scratch the encode used is gone.
    expect(existsSync(join(cwd, "film", "cut", ".work"))).toBe(false);
  });

  test.skipIf(!HAS_FFMPEG)("a final refuses while any shot lacks a selected take, and names them", () => {
    const cwd = workspace();
    withShot(cwd);
    json(cwd, ["gates", "film", "open"]);
    const refused = run(cwd, ["cut", "film", "--final"]);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("refusing to call this a final");
    expect(refused.err).toContain("s01: no selected take");
    expect(existsSync(join(cwd, "film", "cut", "final.mp4"))).toBe(false);
    // …and the reel that DOES exist is not touched by the refusal.
    expect(existsSync(join(cwd, "film", "cut", "edl.json"))).toBe(false);
  });

  test.skipIf(!HAS_FFMPEG)("a final is gated on sound, then assembles the selected takes with the voice-over and the bed", () => {
    const cwd = workspace();
    const shotDir = withShot(cwd, { take: true, vo: true });
    const env = vendors(cwd);

    const gated = run(cwd, ["cut", "film", "--final"]);
    expect(gated.code).toBe(1);
    expect(gated.err).toContain('stage "sound"');

    json(cwd, ["gates", "film", "open"]);
    json(cwd, ["music", "film", "--prompt", "drums", "--seconds", "2"], env);
    // A negative decibel needs the '=' spelling; parseArgs cannot tell
    // "-20" from another flag, and says so with that hint.
    expect(run(cwd, ["cut", "film", "--final", "--music-db", "-20"]).err).toContain("--music-db=-XYZ");
    const cut = json(cwd, ["cut", "film", "--final", "--music-db=-20", "--music-fade", "0.4"]);
    expect(cut.kind).toBe("final");
    expect(cut.standIns).toEqual([]);
    expect(cut.segments).toEqual([{ shot: "s01", source: "take-01", offset: 0, seconds: 1, in: 0, out: 1 }]);
    expect(cut.vo).toEqual([{ shot: "s01", line: "l2", at: 0.2, start: 0.2, file: "shots/s01/sound/l2.mp3" }]);
    expect(cut.music).toEqual({ file: "sound/music.mp3", gainDb: -20, fadeOutSeconds: 0.4 });

    const file = join(cwd, "film", "cut", "final.mp4");
    expect(existsSync(file)).toBe(true);
    // The cut carries sound: the take's own audio, the voice-over and the
    // bed are all in one track, and a silent file would prove the mix was
    // dropped on the floor.
    const probe = Bun.spawnSync(["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_name", "-of", "csv=p=0", file]);
    expect(probe.stdout.toString().trim()).toBe("aac");
    expect(volumeDb(file)).toBeGreaterThan(-60);
    expect(shotDir.endsWith("s01")).toBe(true);
  });

  test.skipIf(!HAS_FFMPEG)("two shots of different size, rate and sound become one film on one clock", () => {
    // The case the offsets exist for: a 2 s take at 160x120 with sound, then
    // a 1 s greybox at 640x360 at 30 fps with none. Both are matched to the
    // film's spec, the second starts where the first ends, and its
    // voice-over lands at offset + at — not at its second of the SHOT.
    const cwd = workspace();
    json(cwd, ["init", "film", "--title", "Two", "--logline", "x", "--seconds", "2", "--width", "320", "--height", "180"]);
    json(cwd, ["gates", "film", "open"]);
    for (const id of ["a", "b"]) json(cwd, ["shot", "add", "film", id, "--title", id.toUpperCase()]);

    fixtureMp4(join(cwd, "film", "shots", "a", "takes", "take-01.mp4"), { seconds: 2, tone: true, size: "160x120" });
    const withTake = shotOf(cwd, "a");
    withTake.takes = [{ id: "take-01", status: "done", file: "takes/take-01.mp4", selected: true, cost: null }];
    writeFileSync(join(cwd, "film", "shots", "a", "shot.json"), `${JSON.stringify(withTake, null, 2)}\n`);

    const greybox = join(cwd, "film", "shots", "b", "greybox", "greybox.mp4");
    const made = Bun.spawnSync([
      "ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "smptebars=size=640x360:rate=30:duration=1",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", greybox,
    ]);
    if (made.exitCode !== 0) throw new Error(made.stderr.toString());
    mkdirSync(join(cwd, "film", "shots", "b", "sound"), { recursive: true });
    const line = Bun.spawnSync(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=900:duration=0.5", "-ac", "2", "-ar", "48000", join(cwd, "film", "shots", "b", "sound", "l1.mp3")]);
    if (line.exitCode !== 0) throw new Error(line.stderr.toString());
    const withGreybox = shotOf(cwd, "b");
    withGreybox.greybox.revision = 1;
    withGreybox.greybox.final = { file: "greybox/greybox.mp4", revision: 1, probe: null };
    withGreybox.lines = [{ id: "l1", speaker: "narrator", kind: "vo", text: "x", at: 0.3, file: "sound/l1.mp3", seconds: 0.5, cost: null }];
    writeFileSync(join(cwd, "film", "shots", "b", "shot.json"), `${JSON.stringify(withGreybox, null, 2)}\n`);

    const cut = json(cwd, ["cut", "film", "--reel"]);
    expect(cut.segments).toEqual([
      { shot: "a", source: "take-01", offset: 0, seconds: 2, in: 0, out: 2 },
      { shot: "b", source: "greybox", offset: 2, seconds: 1, in: 0, out: 1 },
    ]);
    expect(cut.vo).toEqual([{ shot: "b", line: "l1", at: 0.3, start: 2.3, file: "shots/b/sound/l1.mp3" }]);
    expect(cut.probe).toMatchObject({ width: 320, height: 180, fps: 24 });
    const file = join(cwd, "film", "cut", "reel.mp4");
    // The take's own sound is there, the greybox stand-in is silent, and the
    // voice-over is audible where the edit list says it is.
    expect(volumeDb(file, 0.5, 0.25)).toBeGreaterThan(-35);
    expect(volumeDb(file, 2.0, 0.25)).toBeLessThan(-35);
    expect(volumeDb(file, 2.4, 0.25)).toBeGreaterThan(-35);
  });

  test.skipIf(!HAS_FFMPEG)("a trimmed shot contributes only its range, and the segments add up to the film", () => {
    // The case trims exist for: a collage of one strike from two angles is
    // two takes of Seedance's four-second floor and two ~1 s segments.
    const cwd = workspace();
    json(cwd, ["init", "film", "--title", "Collage", "--logline", "one strike, three angles", "--seconds", "4", "--width", "320", "--height", "180"]);
    json(cwd, ["gates", "film", "open"]);
    // `a` is a trimmed GREYBOX stand-in (silent), `b` a trimmed take (with
    // sound): the trim has to hold on both paths, and the reel must not
    // pretend the stand-in carries ambience.
    json(cwd, ["shot", "add", "film", "a", "--title", "a"]);
    fixtureMp4(join(cwd, "film", "shots", "a", "greybox", "greybox.mp4"), { seconds: 4, size: "200x200" });
    const a = shotOf(cwd, "a");
    a.greybox.revision = 1;
    a.greybox.final = { file: "greybox/greybox.mp4", revision: 1, probe: null };
    writeFileSync(join(cwd, "film", "shots", "a", "shot.json"), `${JSON.stringify(a, null, 2)}\n`);

    json(cwd, ["shot", "add", "film", "b", "--title", "b"]);
    fixtureMp4(join(cwd, "film", "shots", "b", "takes", "take-01.mp4"), { seconds: 4, tone: true, size: "160x120" });
    const take = shotOf(cwd, "b");
    take.takes = [{ id: "take-01", status: "done", file: "takes/take-01.mp4", selected: true, cost: null }];
    writeFileSync(join(cwd, "film", "shots", "b", "shot.json"), `${JSON.stringify(take, null, 2)}\n`);
    // A voice-over inside b's range, and one outside it.
    const bDir = join(cwd, "film", "shots", "b");
    mkdirSync(join(bDir, "sound"), { recursive: true });
    for (const id of ["l1", "l2"]) {
      const made = Bun.spawnSync(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=900:duration=0.4", "-ac", "2", "-ar", "48000", join(bDir, "sound", `${id}.mp3`)]);
      if (made.exitCode !== 0) throw new Error(made.stderr.toString());
    }
    const b = shotOf(cwd, "b");
    b.lines = [
      { id: "l1", speaker: "n", kind: "vo", text: "inside", at: 2.6, file: "sound/l1.mp3", seconds: 0.4, cost: null },
      { id: "l2", speaker: "n", kind: "vo", text: "outside", at: 0.5, file: "sound/l2.mp3", seconds: 0.4, cost: null },
    ];
    writeFileSync(join(bDir, "shot.json"), `${JSON.stringify(b, null, 2)}\n`);

    previzJson(cwd, ["meta", "film/shots/a", "--trim-in", "0.4", "--trim-out", "1.6"]);
    previzJson(cwd, ["meta", "film/shots/b", "--trim-in", "2", "--trim-out", "3"]);

    const result = run(cwd, ["cut", "film", "--reel"]);
    expect(result.code).toBe(0);
    const cut = JSON.parse(result.out);
    expect(cut.trimmed).toEqual(["a", "b"]);
    expect(cut.standIns).toEqual(["a"]);
    expect(cut.segments.map((s: any) => [s.shot, s.source, s.in, s.out])).toEqual([
      ["a", "greybox", 0.4, 1.6],
      ["b", "take-01", 2, 3],
    ]);
    // Each segment is measured in FRAMES of the film's clock (0.4–1.6 s at
    // 24 fps is 28.8 frames and ffmpeg emits 28), and the segments add up
    // to the film exactly — otherwise every voice-over after a trimmed
    // shot lands a frame late.
    const sum = cut.segments.reduce((total: number, segment: any) => total + segment.seconds, 0);
    expect(Number(sum.toFixed(4))).toBe(cut.seconds);
    expect(cut.probe.frames).toBe(Math.round(cut.seconds * 24));
    expect(cut.segments[1].offset).toBe(cut.segments[0].seconds);

    // The line inside the range is placed relative to the trim: 2.6 s of
    // the shot is 0.6 s into b's segment.
    expect(cut.vo).toEqual([
      { shot: "b", line: "l1", at: 2.6, start: Number((cut.segments[1].offset + 0.6).toFixed(4)), file: "shots/b/sound/l1.mp3" },
    ]);
    // The one outside it is DROPPED, with the reason, in the report, in the
    // edit list, and on stderr.
    expect(cut.droppedVo).toEqual([
      { shot: "b", line: "l2", at: 0.5, reason: "it is spoken at 0.5 s of the shot, outside the 2–3 s the cut uses" },
    ]);
    expect(result.err).toContain("b/l2 is dropped from this cut");
    const edl = JSON.parse(readFileSync(join(cwd, "film", "cut", "edl.json"), "utf-8"));
    expect(edl.segments[0]).toMatchObject({ in: 0.4, out: 1.6 });
    expect(edl.droppedVo).toHaveLength(1);

    // And what is on screen is the trimmed range: the film is far shorter
    // than the four-second sources it was cut from. The stand-in's window
    // is silent, the take's is not.
    const reel = join(cwd, "film", "cut", "reel.mp4");
    expect(cut.seconds).toBeLessThan(2.3);
    expect(volumeDb(reel, 0.3, 0.3)).toBeLessThan(-60);
    expect(volumeDb(reel, cut.segments[1].offset + 0.2, 0.3)).toBeGreaterThan(-45);
  });

  test.skipIf(!HAS_FFMPEG)("an untrimmed shot still records the whole range it showed", () => {
    const cwd = workspace();
    withShot(cwd);
    const cut = json(cwd, ["cut", "film", "--reel"]);
    expect(cut.trimmed).toEqual([]);
    expect(cut.segments[0]).toMatchObject({ in: 0, out: cut.segments[0].seconds });
    expect(cut.droppedVo).toEqual([]);
  });

  test.skipIf(!HAS_FFMPEG)("a voice-over whose file is gone is reported, and the cut goes on without it", () => {
    const cwd = workspace();
    const shotDir = withShot(cwd, { vo: true });
    rmSync(join(shotDir, "sound", "l2.mp3"), { force: true });
    const result = run(cwd, ["cut", "film", "--reel"]);
    expect(result.code).toBe(0);
    expect(result.err).toContain("but the file is gone");
    expect(JSON.parse(result.out).vo).toEqual([]);
  });

  test("cut refuses without a kind, with both kinds, and with no shots at all", () => {
    const cwd = workspace();
    film(cwd);
    expect(run(cwd, ["cut", "film"]).err).toContain("--reel");
    expect(run(cwd, ["cut", "film", "--reel", "--final"]).err).toContain("not both");
    expect(run(cwd, ["cut", "film", "--reel"]).err).toContain("no shots yet");
  });
});

/** The mean volume ffmpeg measures over a file, or over a window of it. A
 *  silent window reads around -91 dB; anything audible is far above -35. */
function volumeDb(file: string, from?: number, seconds?: number): number {
  const window = from === undefined ? [] : ["-ss", String(from), ...(seconds === undefined ? [] : ["-t", String(seconds)])];
  const result = Bun.spawnSync(["ffmpeg", "-hide_banner", ...window, "-i", file, "-vn", "-af", "volumedetect", "-f", "null", "-"]);
  const match = /mean_volume:\s*(-?[\d.]+) dB/.exec(result.stderr.toString());
  return match ? Number(match[1]) : -Infinity;
}

describe("cost", () => {
  test.skipIf(!HAS_FFMPEG)("totals what the artefacts themselves record, by stage, and names what is unpriced", () => {
    const cwd = workspace();
    withShot(cwd, { take: true, vo: true, anchor: true });
    const env = vendors(cwd);
    json(cwd, ["gates", "film", "open"]);
    json(cwd, ["character", "add", "film", "kai", "--name", "小凯"]);
    json(cwd, ["character", "look", "film", "kai", "--file", fixturePng(cwd), "--prompt", "sheet", "--cost-usd", "0.13", "--cost-basis", "reported"]);
    json(cwd, ["set", "add", "film", "store", "--name", "便利店"]);
    json(cwd, ["set", "look", "film", "store", "--file", fixturePng(cwd, "concept.png"), "--prompt", "wide"]);
    json(cwd, ["music", "film", "--prompt", "drums", "--seconds", "2", "--cost-usd", "0.4", "--cost-basis", "reported"], env);

    const cost = json(cwd, ["cost", "film"]);
    // The anchor frame is a paid image of the PREVIZ stage — the picture the
    // creator approves there — and it is counted where it was spent.
    expect(cost.byStage).toEqual({ bible: 0.13, previz: 0.1904, takes: 2.1168, sound: 0.41 });
    expect(cost.byKind).toEqual({ image: 0.3204, take: 2.1168, tts: 0.01, music: 0.4 });
    expect(cost.total).toBeCloseTo(0.13 + 0.1904 + 2.1168 + 0.01 + 0.4, 4);
    expect(cost.estimate).toBe(true);
    // The set concept was registered without a price: listed as unpriced,
    // never folded into the total as zero.
    expect(cost.unpriced).toEqual(["bible/sets/store/concept.png"]);
    expect(cost.priced).toBe(cost.count - 1);
    const takeLine = cost.lines.find((line: any) => line.kind === "take");
    expect(takeLine).toMatchObject({ stage: "takes", label: "s01 — take-01", ref: "shots/s01/takes/take-01.mp4" });
    const anchorLine = cost.lines.find((line: any) => line.ref === "shots/s01/anchors/first.png");
    expect(anchorLine).toMatchObject({
      stage: "previz",
      kind: "image",
      label: "s01 — anchor first",
      usd: 0.1904,
      source: "reported",
      at: 1758380500000,
    });
    // …and the lines stay in stage order, so previz sits between the bible
    // and the takes.
    expect(cost.lines.map((line: any) => line.stage)).toEqual([...cost.lines.map((line: any) => line.stage)].sort(
      (a: string, b: string) => ["bible", "boards", "previz", "takes", "sound"].indexOf(a) - ["bible", "boards", "previz", "takes", "sound"].indexOf(b),
    ));
  });
});

describe("status", () => {
  test.skipIf(!HAS_FFMPEG)("reports every stage, its cost and the first one still open", () => {
    const cwd = workspace();
    withShot(cwd, { take: true });
    json(cwd, ["approve", "film", "idea"]);
    const status = json(cwd, ["status", "film"]);
    expect(status.kind).toBe("project");
    expect(status.title).toBe("Last Customer");
    expect(status.gates).toBe("closed");
    expect(status.stages.map((entry: any) => entry.stage)).toEqual([
      "idea", "script", "bible", "boards", "previz", "takes", "sound", "cut",
    ]);
    expect(status.stages.find((entry: any) => entry.stage === "idea")).toMatchObject({ status: "approved" });
    expect(status.stages.find((entry: any) => entry.stage === "takes")).toMatchObject({ status: "draft", usd: 2.1168 });
    expect(status.next).toMatchObject({ stage: "script", status: "draft" });
    expect(status.shots[0]).toMatchObject({ id: "s01", selected: "take-01", greybox: { revision: 1 } });
    expect(status.cost.total).toBeCloseTo(2.1168, 4);
    // status never writes.
    const before = readFileSync(join(cwd, "film", "backlot.json"), "utf-8");
    json(cwd, ["status", "film"]);
    expect(readFileSync(join(cwd, "film", "backlot.json"), "utf-8")).toBe(before);
  });

  test("a directory with no film is a named refusal", () => {
    const cwd = workspace();
    expect(run(cwd, ["status", "."]).err).toContain("no backlot.json");
    expect(run(cwd, ["status", "."]).code).toBe(1);
  });
});

describe("the argv contract", () => {
  test("an unknown subcommand, a missing directory and --help are all explicit", () => {
    const cwd = workspace();
    expect(run(cwd, ["shoot-everything"]).code).toBe(1);
    expect(run(cwd, ["shoot-everything"]).err).toContain("unknown subcommand");
    expect(run(cwd, ["status"]).err).toContain("status needs a project directory");
    expect(run(cwd, ["character", "sing", "film", "kai"]).err).toContain("character takes add|set|look|voice");
    const help = run(cwd, ["--help"]);
    expect(help.code).toBe(0);
    expect(help.out).toContain("Usage: backlot.mjs <subcommand>");
    expect(help.out).toContain("THE GATE");
  });

  test("previz.mjs sends init and shot here, and this script sends the film's status back", () => {
    const cwd = workspace();
    film(cwd);
    const moved = previz(cwd, ["init", "other", "--title", "A"]);
    expect(moved.code).toBe(1);
    expect(moved.err).toContain("backlot.mjs init");
    const movedShot = previz(cwd, ["shot", "film", "s01", "--title", "A"]);
    expect(movedShot.err).toContain("backlot.mjs shot add");
    // …and the other direction: a film is not a shot report.
    const delegated = previz(cwd, ["status", "film"]);
    expect(delegated.code).toBe(1);
    expect(delegated.err).toContain("backlot.mjs status");
  });
});

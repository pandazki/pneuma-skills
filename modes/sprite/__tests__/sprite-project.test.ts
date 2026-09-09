/**
 * sprite-project.mjs — the only writer of a character's `project.json`,
 * pinned as a real process.
 *
 * The spine of the suite is a round trip: `init → add-ref → add-motion →
 * set-sheet → register-run` must reproduce the design spec's canonical
 * fixture (see `fixtures/pipeline/README.md` for the two deliberate
 * differences). Asset metadata comes from ffprobe, so the whole file skips
 * with a named reason when ffmpeg is missing.
 *
 * The seeded character is built ONCE per variant (with and without a WebP
 * preview) and copied per test — a `cpSync` of a handful of small files
 * instead of a second full `sprite-sheet run`, which is ~30 ffmpeg spawns.
 */

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildSheet } from "./fixtures/pipeline/make-sheet.mjs";

const FIXTURES = join(import.meta.dir, "fixtures", "pipeline");
const PROJECT = join(import.meta.dir, "..", "skill", "scripts", "sprite-project.mjs");
const SHEET = join(import.meta.dir, "..", "skill", "scripts", "sprite-sheet.mjs");

const HAS_FFMPEG =
  spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0 &&
  spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0;

if (!HAS_FFMPEG) {
  console.warn("(skip) modes/sprite sprite-project.mjs suite — ffmpeg/ffprobe not on PATH");
}

const HAS_LIBWEBP = HAS_FFMPEG &&
  spawnSync("ffmpeg", ["-hide_banner", "-encoders"], { encoding: "utf-8" }).stdout?.includes("libwebp") === true;

const T0 = 1757400000000;
const T1 = 1757400001000;
const T2 = 1757400002000;

const workspaces: string[] = [];

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), "sprite-project-"));
  workspaces.push(dir);
  return dir;
}

function run(script: string, argv: string[], stdin?: string) {
  const r = Bun.spawnSync([process.execPath, script, ...argv], {
    cwd: import.meta.dir,
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
}

function project(dir: string, ...argv: string[]) {
  return run(PROJECT, [argv[0], "--dir", dir, ...argv.slice(1)]);
}

function projectJson(dir: string, ...argv: string[]) {
  const r = project(dir, ...argv, "--json");
  if (r.code !== 0) throw new Error(`sprite-project ${argv[0]} failed (${r.code}):\n${r.err}`);
  return JSON.parse(r.out);
}

const readProject = (dir: string) => JSON.parse(readFileSync(join(dir, "project.json"), "utf-8"));

/**
 * The canonical `mini` character, built once per variant: real files on disk
 * (so ffprobe reports the fixture's dimensions) produced by the real sheet
 * pipeline, plus the command sequence up to but not including `register-run`.
 */
const templates = new Map<string, { dir: string; runText: string }>();

function template(webp: boolean) {
  const key = webp ? "webp" : "no-webp";
  const cached = templates.get(key);
  if (cached) return cached;

  const dir = fresh();
  buildSheet(join(dir, "refs", "portrait.png"), { cell: 256, rows: 1, cols: 1 });
  const raw = buildSheet(join(dir, "raw.png"));
  const sheetRun = run(SHEET, [
    "run", raw, "--rows", "2", "--cols", "2",
    "--out", join(dir, "motions", "bounce"),
    "--name", "bounce", "--fps", "8", "--loop", "--cell", "64x64",
    ...(webp ? [] : ["--no-webp"]), "--json",
  ]);
  if (sheetRun.code !== 0) throw new Error(`sprite-sheet run failed:\n${sheetRun.err}`);
  rmSync(raw);

  projectJson(dir, "init", "--name", "Mini", "--description", "A test blob.",
    "--style", "flat vector blob, thick outline", "--cell", "64x64", "--facing", "right");
  projectJson(dir, "add-ref", "--id", "portrait", "--file", "refs/portrait.png", "--role", "portrait",
    "--label", "Portrait", "--prompt", "portrait of Mini", "--model", "openai/gpt-image-2.5-sunburst",
    "--at", String(T0));
  projectJson(dir, "add-motion", "--id", "bounce", "--label", "Bounce", "--rows", "2", "--cols", "2",
    "--fps", "8", "--loop", "--anchor", "bottom", "--prompt", "2x2 bounce sheet");
  projectJson(dir, "set-sheet", "--motion", "bounce", "--file", "motions/bounce/sheet-raw.png",
    "--from", "ref-portrait", "--model", "openai/gpt-image-2.5-flare", "--prompt", "2x2 bounce sheet",
    "--background", "transparent", "--at", String(T1));

  const built = { dir, runText: sheetRun.out };
  templates.set(key, built);
  return built;
}

/** A private copy of the seeded character, with the run summary's absolute
 *  paths rewritten to point at it. */
function seedMini({ webp = false } = {}) {
  const source = template(webp);
  const dir = fresh();
  cpSync(source.dir, dir, { recursive: true });
  return { dir, realRun: JSON.parse(source.runText.replaceAll(source.dir, dir)) };
}

describe.skipIf(!HAS_FFMPEG)("sprite-project.mjs", () => {
  test("--help exits 0 and lists every subcommand", () => {
    const r = run(PROJECT, ["--help"]);
    expect(r.code).toBe(0);
    for (const cmd of [
      "init", "add-ref", "add-motion", "set-motion", "set-sheet",
      "register-run", "add-video", "set-video", "remove-motion", "show",
    ]) {
      expect(r.out + r.err).toContain(cmd);
    }
  });

  test("an unknown subcommand fails loudly", () => {
    const r = run(PROJECT, ["frobnicate"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("ERROR:");
  });

  describe("init", () => {
    test("writes the craft project skeleton with a sprite sidecar", () => {
      const dir = fresh();
      const out = projectJson(dir, "init", "--name", "Lumi");
      expect(out.title).toBe("Lumi");
      const doc = readProject(dir);
      expect(doc.$schema).toBe("pneuma-craft/project/v1");
      expect(doc.composition).toEqual({
        settings: { width: 256, height: 256, fps: 8, aspectRatio: "1:1" },
        tracks: [],
        transitions: [],
      });
      expect(doc.assets).toEqual([]);
      expect(doc.provenance).toEqual([]);
      expect(doc.sprite).toEqual({
        version: 1,
        character: { name: "Lumi", description: "", style: "", cell: { width: 256, height: 256 }, facing: "right" },
        refs: [],
        motions: [],
      });
    });

    test("derives a reduced aspect ratio from a non-square cell", () => {
      const dir = fresh();
      projectJson(dir, "init", "--name", "Wide", "--cell", "192x108");
      expect(readProject(dir).composition.settings.aspectRatio).toBe("16:9");
    });

    test("refuses to clobber an existing project without --force", () => {
      const dir = fresh();
      projectJson(dir, "init", "--name", "Lumi");
      const again = project(dir, "init", "--name", "Other", "--json");
      expect(again.code).toBe(1);
      expect(again.err).toMatch(/already exists/);
      expect(readProject(dir).title).toBe("Lumi");
      expect(projectJson(dir, "init", "--name", "Other", "--force").title).toBe("Other");
    });

    test("every other subcommand refuses to run without a project", () => {
      const dir = fresh();
      const r = project(dir, "show", "--json");
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/project\.json/);
    });

    test("creates the character directory when it does not exist yet", () => {
      // The first command of a new character runs in a workspace where the
      // character directory is still an idea. It used to die on a raw ENOENT
      // from writeFileSync, so `init` had to be preceded by a mkdir nobody
      // documented. Nested, because `<workspace>/<character>` is one level in
      // the workspace and the agent may be pointed deeper.
      const dir = join(fresh(), "lumi", "nested");
      expect(existsSync(dir)).toBe(false);
      expect(projectJson(dir, "init", "--name", "Lumi").title).toBe("Lumi");
      expect(readProject(dir).sprite.character.name).toBe("Lumi");
    });

    test("a character directory that cannot be created is one ERROR line", () => {
      // A regular file where the directory should go: mkdir -p fails with
      // ENOTDIR whoever you are, so this pins the message shape without
      // depending on file permissions (root ignores those).
      const workspace = fresh();
      writeFileSync(join(workspace, "blocker"), "not a directory\n");
      const r = project(join(workspace, "blocker", "lumi"), "init", "--name", "Lumi", "--json");
      expect(r.code).toBe(1);
      expect(r.err.startsWith("ERROR: ")).toBe(true);
      expect(r.err.trimEnd().split("\n")).toHaveLength(1);
      expect(r.err).not.toMatch(/^\s+at /m); // no stack frames
    });

    test("a project.json that cannot be written is one ERROR line, and no litter", () => {
      // The directory exists and is fine; the write is what fails. A
      // directory named project.json makes the rename fail deterministically,
      // which is the saveProject leg — the scratch file must still be gone.
      const dir = fresh();
      mkdirSync(join(dir, "project.json"));
      const r = project(dir, "init", "--name", "Lumi", "--force", "--json");
      expect(r.code).toBe(1);
      expect(r.err.startsWith("ERROR: ")).toBe(true);
      expect(r.err.trimEnd().split("\n")).toHaveLength(1);
      expect(r.err).not.toMatch(/^\s+at /m);
      expect(readdirSync(dir).filter((f) => f.includes("tmp"))).toEqual([]);
    });
  });

  describe("round trip", () => {
    test("init → add-ref → add-motion → set-sheet → register-run reproduces the canonical fixture", () => {
      const { dir } = seedMini();
      projectJson(dir, "register-run", "--motion", "bounce",
        "--run", join(FIXTURES, "bounce-run.json"), "--at", String(T2));

      const expected = JSON.parse(readFileSync(join(FIXTURES, "expected-project.json"), "utf-8"));
      expect(readProject(dir)).toEqual(expected);
      // the write is atomic — no .tmp litter survives
      expect(readdirSync(dir).filter((f) => f.includes("tmp"))).toEqual([]);
    });

    test("register-run consumes a real `sprite-sheet run` summary from stdin", () => {
      const { dir, realRun } = seedMini();
      const r = run(PROJECT, ["register-run", "--dir", dir, "--motion", "bounce", "--run", "-", "--json"],
        JSON.stringify(realRun));
      expect(r.code).toBe(0);
      const motion = JSON.parse(r.out);
      expect(motion.status).toBe("ready");
      expect(motion.frames).toEqual([
        "bounce-frame-00", "bounce-frame-01", "bounce-frame-02", "bounce-frame-03",
      ]);
      expect(motion.inspect).toEqual({
        frameCount: 4,
        cell: { width: 64, height: 64 },
        // Where `align` actually put the feet: the default `--pad 8` holds
        // them 8px off the cell floor. The viewer renders from project.json
        // alone, so if this does not make the trip its pivot guide has to
        // guess the cell edge and the sprite floats above its own ground line.
        anchorPoint: { x: 32, y: 56 },
        anchorDrift: { x: 0, y: 0 },
        maxJump: 0,
        scaleDrift: 0,
        emptyFrames: [],
        warnings: [],
      });
      // absolute paths from a real run become workspace-relative uris
      const doc = readProject(dir);
      expect(doc.assets.find((a: any) => a.id === "bounce-frame-00").uri).toBe("motions/bounce/frames/00.png");

      // `run` reports its pre-align cells; they are intermediate files and
      // must not become assets of their own.
      expect(realRun.cells).toBe(join(dir, "motions", "bounce", "cells"));
      expect(doc.assets.some((a: any) => a.uri.includes("cells/"))).toBe(false);
      expect(motion.cells).toBeUndefined();
    });

    test("a run summary pointing outside the character dir is refused", () => {
      const { dir, realRun } = seedMini();
      const r = run(PROJECT, ["register-run", "--dir", dir, "--motion", "bounce", "--run", "-", "--json"],
        JSON.stringify({ ...realRun, gif: "/etc/hosts" }));
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/outside/);
    });
  });

  describe("the WebP preview", () => {
    test.skipIf(!HAS_LIBWEBP)("an animated preview.webp is registered with its real canvas size", () => {
      const { dir, realRun } = seedMini({ webp: true });
      const webpPath = join(dir, "motions", "bounce", "preview.webp");
      expect(realRun.webp).toBe(webpPath);

      // Why this needs its own reader: ffprobe (ffmpeg 8.0) skips the ANIM /
      // ANMF chunks of an animated WebP and reports 0x0, which used to make
      // the default run → register-run chain fail on every motion.
      const probed = spawnSync("ffprobe",
        ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", webpPath],
        { encoding: "utf-8" });
      expect(probed.stdout.trim()).toBe("0,0");

      const motion = JSON.parse(run(PROJECT,
        ["register-run", "--dir", dir, "--motion", "bounce", "--run", "-", "--json", "--at", String(T2)],
        JSON.stringify(realRun)).out);
      expect(motion.webp).toBe("bounce-webp");

      const asset = readProject(dir).assets.find((a: any) => a.id === "bounce-webp");
      expect(asset.uri).toBe("motions/bounce/preview.webp");
      expect(asset.metadata).toEqual({ width: 64, height: 64, fps: 8 });
    });

    test("a run without a WebP registers no WebP asset", () => {
      const { dir, realRun } = seedMini();
      expect(realRun.webp).toBeUndefined();
      const motion = JSON.parse(run(PROJECT,
        ["register-run", "--dir", dir, "--motion", "bounce", "--run", "-", "--json"],
        JSON.stringify(realRun)).out);
      expect(motion.webp).toBeUndefined();
      expect(readProject(dir).assets.some((a: any) => a.id === "bounce-webp")).toBe(false);
    });

    test("an unreadable preview falls back to the run's cell and says so", () => {
      const { dir, realRun } = seedMini();
      const webpPath = join(dir, "motions", "bounce", "preview.webp");
      writeFileSync(webpPath, "neither a RIFF header nor anything ffprobe can read");

      const r = run(PROJECT, ["register-run", "--dir", dir, "--motion", "bounce", "--run", "-", "--json"],
        JSON.stringify({ ...realRun, webp: webpPath }));
      expect(r.code).toBe(0);
      expect(r.err).toMatch(/WARN: .*could not measure .*using the run's cell 64x64/);
      const asset = readProject(dir).assets.find((a: any) => a.id === "bounce-webp");
      expect(asset.metadata).toEqual({ width: 64, height: 64, fps: 8 });
    });
  });

  describe("register-run idempotence", () => {
    test("re-running leaves no orphan assets or edges", () => {
      const { dir } = seedMini();
      const args = ["register-run", "--motion", "bounce", "--run", join(FIXTURES, "bounce-run.json"), "--at", String(T2)];
      projectJson(dir, ...args);
      const first = readProject(dir);
      projectJson(dir, ...args);
      const second = readProject(dir);
      expect(second).toEqual(first);

      const ids = new Set(second.assets.map((a: any) => a.id));
      expect(ids.size).toBe(second.assets.length);
      for (const edge of second.provenance) {
        expect(ids.has(edge.toAssetId)).toBe(true);
        if (edge.fromAssetId !== null) expect(ids.has(edge.fromAssetId)).toBe(true);
      }
    });

    test("a re-run keeps every video's parent frame and does not reshuffle the file", () => {
      const { dir } = seedMini();
      const args = ["register-run", "--motion", "bounce", "--run", join(FIXTURES, "bounce-run.json"), "--at", String(T2)];
      projectJson(dir, ...args);
      for (const n of [1, 2]) writeFileSync(join(dir, "motions", "bounce", `video-seedance-${n}.mp4`), "");
      // one single-parent i2v clip and one two-input first-last clip: the
      // i2v edge carries no params.inputs, so nulling its fromAssetId would
      // lose the link to frame 00 for good.
      projectJson(dir, "add-video", "--motion", "bounce", "--file", "motions/bounce/video-seedance-1.mp4",
        "--model", "seedance-2.5", "--mode", "i2v", "--from", "bounce-frame-00", "--at", String(T2));
      projectJson(dir, "add-video", "--motion", "bounce", "--file", "motions/bounce/video-seedance-2.mp4",
        "--model", "h3-max", "--mode", "first-last", "--from", "bounce-frame-00,bounce-frame-03", "--at", String(T2));

      const before = readFileSync(join(dir, "project.json"), "utf-8");
      projectJson(dir, ...args);
      const after = readFileSync(join(dir, "project.json"), "utf-8");

      // byte-identical: no nulled parents, no assets migrating to the head
      expect(after).toBe(before);
      const edges = JSON.parse(after).provenance;
      expect(edges.find((e: any) => e.toAssetId === "bounce-video-1").fromAssetId).toBe("bounce-frame-00");
      expect(edges.find((e: any) => e.toAssetId === "bounce-video-2").fromAssetId).toBe("bounce-frame-00");
      expect(JSON.parse(after).assets.map((a: any) => a.id).slice(-2))
        .toEqual(["bounce-video-1", "bounce-video-2"]);
    });

    test("a shorter motion drops the stale frame assets, edges and ids", () => {
      const { dir } = seedMini();
      projectJson(dir, "register-run", "--motion", "bounce",
        "--run", join(FIXTURES, "bounce-run.json"), "--at", String(T2));

      const shorter = {
        ...JSON.parse(readFileSync(join(FIXTURES, "bounce-run.json"), "utf-8")),
        frames: ["motions/bounce/frames/00.png", "motions/bounce/frames/01.png"],
      };
      shorter.inspect = { ...shorter.inspect, frameCount: 2 };
      writeFileSync(join(dir, "short-run.json"), JSON.stringify(shorter));
      const motion = projectJson(dir, "register-run", "--motion", "bounce",
        "--run", join(dir, "short-run.json"), "--at", String(T2));

      expect(motion.frames).toEqual(["bounce-frame-00", "bounce-frame-01"]);
      const doc = readProject(dir);
      const ids = doc.assets.map((a: any) => a.id);
      expect(ids).not.toContain("bounce-frame-02");
      expect(ids).not.toContain("bounce-frame-03");
      expect(doc.provenance.some((e: any) => e.toAssetId === "bounce-frame-03")).toBe(false);
      expect(doc.provenance.find((e: any) => e.toAssetId === "bounce-sheet").operation.params.inputs)
        .toEqual(["bounce-frame-00", "bounce-frame-01"]);
    });

    test("a run with no measured anchor point leaves the sidecar without one", () => {
      // The canonical fixture's inspect block predates `align.json`. Absence
      // has to survive as absence: the viewer reads a missing key as "nobody
      // measured this" and falls back, which is a different — and honest —
      // picture from a point invented here.
      const { dir } = seedMini();
      const motion = projectJson(dir, "register-run", "--motion", "bounce",
        "--run", join(FIXTURES, "bounce-run.json"), "--at", String(T2));
      expect(motion.inspect.anchorPoint).toBeUndefined();
      expect("anchorPoint" in motion.inspect).toBe(false);
      expect(readProject(dir).sprite.motions[0].inspect.anchorPoint).toBeUndefined();
    });

    test("re-registering the same run leaves project.json byte-identical", () => {
      // The anchor point rides in an optional key, and an optional key is the
      // easy way to make an idempotent command stop being idempotent.
      const { dir, realRun } = seedMini();
      writeFileSync(join(dir, "run.json"), JSON.stringify(realRun));
      projectJson(dir, "register-run", "--motion", "bounce", "--run", join(dir, "run.json"), "--at", String(T2));
      const before = readFileSync(join(dir, "project.json"), "utf-8");
      projectJson(dir, "register-run", "--motion", "bounce", "--run", join(dir, "run.json"), "--at", String(T2));
      expect(readFileSync(join(dir, "project.json"), "utf-8")).toBe(before);
      expect(JSON.parse(before).sprite.motions[0].inspect.anchorPoint).toEqual({ x: 32, y: 56 });
    });

    test("a malformed anchor point is dropped, not carried into the sidecar", () => {
      // A half-written or hand-edited point would be drawn as a guide with no
      // hint that it is nonsense — the viewer cannot tell 0 from measured-0.
      const { dir, realRun } = seedMini();
      for (const broken of [{ x: 32 }, { x: "32", y: "56" }, { x: 32, y: null }, [32, 56], "32,56"]) {
        const payload = { ...realRun, inspect: { ...realRun.inspect, anchorPoint: broken } };
        writeFileSync(join(dir, "broken-run.json"), JSON.stringify(payload));
        const motion = projectJson(dir, "register-run", "--motion", "bounce",
          "--run", join(dir, "broken-run.json"), "--at", String(T2));
        expect({ broken, got: motion.inspect.anchorPoint }).toEqual({ broken, got: undefined });
      }
    });
  });

  describe("set-sheet", () => {
    test("re-running keeps the asset id stable and replaces its edge", () => {
      const { dir } = seedMini();
      projectJson(dir, "set-sheet", "--motion", "bounce", "--file", "motions/bounce/sheet-raw.png",
        "--from", "ref-portrait", "--model", "openai/gpt-image-2.5-flare", "--prompt", "take two", "--at", String(T2));
      const doc = readProject(dir);
      expect(doc.assets.filter((a: any) => a.id === "bounce-sheet-raw")).toHaveLength(1);
      const edges = doc.provenance.filter((e: any) => e.toAssetId === "bounce-sheet-raw");
      expect(edges).toHaveLength(1);
      expect(edges[0].operation.params.prompt).toBe("take two");
      expect(doc.sprite.motions[0].status).toBe("processing");
    });

    test("params.inputs appears only on genuine fan-in", () => {
      const { dir } = seedMini();
      // one reference: fromAssetId says everything, so no inputs list
      const single = readProject(dir).provenance.find((e: any) => e.toAssetId === "bounce-sheet-raw");
      expect(single.fromAssetId).toBe("ref-portrait");
      expect(single.operation.params.inputs).toBeUndefined();

      buildSheet(join(dir, "refs", "turnaround.png"), { cell: 256, rows: 1, cols: 1 });
      projectJson(dir, "add-ref", "--id", "turnaround", "--file", "refs/turnaround.png", "--role", "turnaround");
      projectJson(dir, "set-sheet", "--motion", "bounce", "--file", "motions/bounce/sheet-raw.png",
        "--from", "ref-portrait,ref-turnaround", "--at", String(T2));

      // two references: the first is the edge parent, the whole set is listed
      const fanIn = readProject(dir).provenance.find((e: any) => e.toAssetId === "bounce-sheet-raw");
      expect(fanIn.fromAssetId).toBe("ref-portrait");
      expect(fanIn.operation.params.inputs).toEqual(["ref-portrait", "ref-turnaround"]);
    });

    test("an unknown --from asset is rejected", () => {
      const { dir } = seedMini();
      const r = project(dir, "set-sheet", "--motion", "bounce", "--file", "motions/bounce/sheet-raw.png",
        "--from", "ref-nope", "--json");
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/ref-nope/);
    });

    test("a missing file is rejected before anything is written", () => {
      const { dir } = seedMini();
      const before = readProject(dir);
      const r = project(dir, "set-sheet", "--motion", "bounce", "--file", "motions/bounce/nope.png", "--json");
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/not found/);
      expect(readProject(dir)).toEqual(before);
    });

    test("--status generating registers the placeholder before the file exists", () => {
      // Workflow B runs `set-sheet … --status generating` BEFORE the image
      // call so the stage shows a placeholder while the model draws. The file
      // is by definition not there yet; refusing it made the documented order
      // impossible to follow.
      const { dir } = seedMini();
      projectJson(dir, "add-motion", "--id", "walk", "--label", "Walk",
        "--rows", "2", "--cols", "2", "--fps", "10");
      expect(existsSync(join(dir, "motions", "walk", "sheet-raw.png"))).toBe(false);

      const motion = projectJson(dir, "set-sheet", "--motion", "walk",
        "--file", "motions/walk/sheet-raw.png", "--from", "ref-portrait",
        "--model", "openai/gpt-image-2.5-flare", "--prompt", "2x2 walk sheet",
        "--background", "transparent", "--status", "generating", "--at", String(T2));

      expect(motion).toMatchObject({ status: "generating", sheetRaw: "walk-sheet-raw" });
      const doc = readProject(dir);
      const asset = doc.assets.find((a: any) => a.id === "walk-sheet-raw");
      expect(asset).toMatchObject({
        type: "image",
        uri: "motions/walk/sheet-raw.png",
        status: "generating",
        metadata: {},
      });
      // The edge is written now, not deferred: the prompt and model that are
      // about to produce the file are known here and nowhere later.
      const edge = doc.provenance.find((e: any) => e.toAssetId === "walk-sheet-raw");
      expect(edge.fromAssetId).toBe("ref-portrait");
      expect(edge.operation).toMatchObject({
        type: "generate",
        params: { model: "openai/gpt-image-2.5-flare", prompt: "2x2 walk sheet", background: "transparent" },
      });
    });

    test("the second set-sheet upgrades the placeholder in place once the file lands", () => {
      const { dir } = seedMini();
      projectJson(dir, "add-motion", "--id", "walk", "--label", "Walk",
        "--rows", "2", "--cols", "2", "--fps", "10");
      projectJson(dir, "set-sheet", "--motion", "walk", "--file", "motions/walk/sheet-raw.png",
        "--from", "ref-portrait", "--prompt", "2x2 walk sheet", "--status", "generating", "--at", String(T1));

      buildSheet(join(dir, "motions", "walk", "sheet-raw.png"), { cell: 64, rows: 2, cols: 2 });
      const motion = projectJson(dir, "set-sheet", "--motion", "walk", "--file", "motions/walk/sheet-raw.png",
        "--from", "ref-portrait", "--prompt", "2x2 walk sheet", "--at", String(T2));

      expect(motion.status).toBe("processing");
      const doc = readProject(dir);
      // one asset, one edge — the placeholder was replaced, not duplicated
      expect(doc.assets.filter((a: any) => a.id === "walk-sheet-raw")).toHaveLength(1);
      expect(doc.provenance.filter((e: any) => e.toAssetId === "walk-sheet-raw")).toHaveLength(1);
      const asset = doc.assets.find((a: any) => a.id === "walk-sheet-raw");
      expect(asset.status).toBe("ready");
      expect(asset.metadata).toEqual({ width: 128, height: 128 });
      expect(asset.uri).toBe("motions/walk/sheet-raw.png");
    });

    test("a missing file is still rejected under any other status", () => {
      // Only `generating` means "not written yet". `processing` claims the
      // sheet is in the pipeline, and a pipeline over a file that does not
      // exist is the failure this check is for.
      const { dir } = seedMini();
      projectJson(dir, "add-motion", "--id", "walk", "--label", "Walk",
        "--rows", "2", "--cols", "2", "--fps", "10");
      const before = readProject(dir);

      const r = project(dir, "set-sheet", "--motion", "walk", "--file", "motions/walk/sheet-raw.png",
        "--status", "processing", "--json");
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/not found/);
      expect(readProject(dir)).toEqual(before);
    });
  });

  describe("asset ownership", () => {
    test("a motion cannot take over an id a reference already owns", () => {
      const dir = fresh();
      // asset ids are spelled from names, so the reference `sheet-raw` and a
      // motion called `ref` both want `ref-sheet-raw`.
      buildSheet(join(dir, "refs", "sheet-raw.png"), { cell: 64, rows: 1, cols: 1 });
      projectJson(dir, "init", "--name", "Clash", "--cell", "64x64");
      projectJson(dir, "add-ref", "--id", "sheet-raw", "--file", "refs/sheet-raw.png", "--role", "custom",
        "--at", String(T0));
      projectJson(dir, "add-motion", "--id", "ref", "--label", "Ref", "--rows", "1", "--cols", "1", "--fps", "8");
      const before = readProject(dir);

      const r = project(dir, "set-sheet", "--motion", "ref", "--file", "refs/sheet-raw.png", "--json");
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/ref-sheet-raw.*belongs to ref 'sheet-raw'/);
      expect(readProject(dir)).toEqual(before);
    });

    test("re-registering the same reference is not a takeover", () => {
      const { dir } = seedMini();
      const again = projectJson(dir, "add-ref", "--id", "portrait", "--file", "refs/portrait.png",
        "--role", "turnaround", "--at", String(T0));
      expect(again.refs).toEqual([{ id: "portrait", role: "turnaround", label: "Portrait", uri: "refs/portrait.png" }]);
    });
  });

  describe("motions", () => {
    test("add-motion refuses a duplicate id and set-motion patches in place", () => {
      const { dir } = seedMini();
      const dup = project(dir, "add-motion", "--id", "bounce", "--label", "Again",
        "--rows", "2", "--cols", "2", "--fps", "8", "--json");
      expect(dup.code).toBe(1);
      expect(dup.err).toMatch(/already exists/);

      const patched = projectJson(dir, "set-motion", "--motion", "bounce", "--fps", "12",
        "--no-loop", "--status", "failed", "--notes", "hands drift");
      expect(patched).toMatchObject({ fps: 12, loop: false, status: "failed", notes: "hands drift", label: "Bounce" });
    });

    test("remove-motion strips assets, edges and reports the orphaned files", () => {
      const { dir } = seedMini();
      projectJson(dir, "register-run", "--motion", "bounce",
        "--run", join(FIXTURES, "bounce-run.json"), "--at", String(T2));
      const out = projectJson(dir, "remove-motion", "--motion", "bounce");

      expect(out.removedAssets).toContain("bounce-frame-00");
      expect(out.orphanedPaths).toContain("motions/bounce/preview.gif");
      const doc = readProject(dir);
      expect(doc.sprite.motions).toEqual([]);
      expect(doc.assets.map((a: any) => a.id)).toEqual(["ref-portrait"]);
      expect(doc.provenance.map((e: any) => e.toAssetId)).toEqual(["ref-portrait"]);
      // the files themselves are left alone
      expect(existsSync(join(dir, "motions", "bounce", "preview.gif"))).toBe(true);
    });

    test("an unknown motion is named in the error", () => {
      const { dir } = seedMini();
      const r = project(dir, "set-motion", "--motion", "walk", "--fps", "12", "--json");
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/walk/);
    });
  });

  describe("videos", () => {
    test("add-video numbers from 1 and set-video flips the status", () => {
      const { dir } = seedMini();
      projectJson(dir, "register-run", "--motion", "bounce",
        "--run", join(FIXTURES, "bounce-run.json"), "--at", String(T2));
      mkdirSync(join(dir, "motions", "bounce"), { recursive: true });
      for (const n of [1, 2]) {
        writeFileSync(join(dir, "motions", "bounce", `video-seedance-${n}.mp4`), "");
      }

      const first = projectJson(dir, "add-video", "--motion", "bounce",
        "--file", "motions/bounce/video-seedance-1.mp4", "--model", "seedance-2.5", "--mode", "i2v",
        "--from", "bounce-frame-00", "--prompt", "a hop", "--duration", "4", "--at", String(T2));
      expect(first.videos).toEqual([
        { id: "video-1", asset: "bounce-video-1", model: "seedance-2.5", mode: "i2v", prompt: "a hop", status: "generating" },
      ]);

      const second = projectJson(dir, "add-video", "--motion", "bounce",
        "--file", "motions/bounce/video-seedance-2.mp4", "--model", "h3-max", "--mode", "first-last",
        "--from", "bounce-frame-00,bounce-frame-03", "--at", String(T2));
      expect(second.videos.map((v: any) => v.id)).toEqual(["video-1", "video-2"]);

      const edge = readProject(dir).provenance.find((e: any) => e.toAssetId === "bounce-video-2");
      expect(edge.fromAssetId).toBe("bounce-frame-00");
      expect(edge.operation.params.inputs).toEqual(["bounce-frame-00", "bounce-frame-03"]);

      const done = projectJson(dir, "set-video", "--motion", "bounce", "--video", "video-1", "--status", "ready");
      expect(done.videos[0].status).toBe("ready");
      expect(readProject(dir).assets.find((a: any) => a.id === "bounce-video-1").status).toBe("ready");

      const failed = projectJson(dir, "set-video", "--motion", "bounce", "--video", "bounce-video-2",
        "--status", "failed", "--notes", "fal 504");
      expect(failed.videos[1].status).toBe("failed");
      expect(failed.notes).toBe("fal 504");
    });
  });

  describe("show", () => {
    test("summarises the character, refs and motions", () => {
      const { dir } = seedMini();
      projectJson(dir, "register-run", "--motion", "bounce",
        "--run", join(FIXTURES, "bounce-run.json"), "--at", String(T2));
      const out = projectJson(dir, "show");
      expect(out.character.name).toBe("Mini");
      expect(out.refs).toEqual([{ id: "portrait", role: "portrait", label: "Portrait", uri: "refs/portrait.png" }]);
      expect(out.motions).toEqual([{
        id: "bounce",
        label: "Bounce",
        status: "ready",
        grid: { rows: 2, cols: 2 },
        fps: 8,
        loop: true,
        anchor: "bottom",
        frameCount: 4,
        videoCount: 0,
        warnings: [],
      }]);

      const single = projectJson(dir, "show", "--motion", "bounce");
      expect(single.id).toBe("bounce");

      const human = project(dir, "show");
      expect(human.code).toBe(0);
      expect(human.out).toContain("bounce");
    });
  });

  test("unknown top-level fields survive a mutation", () => {
    const { dir } = seedMini();
    const doc = readProject(dir);
    doc.futureField = { keep: "me" };
    writeFileSync(join(dir, "project.json"), JSON.stringify(doc, null, 2));
    projectJson(dir, "set-motion", "--motion", "bounce", "--fps", "10");
    expect(readProject(dir).futureField).toEqual({ keep: "me" });
  });

  test("cleanup", () => {
    templates.clear();
    for (const dir of workspaces.splice(0)) rmSync(dir, { recursive: true, force: true });
    expect(workspaces).toHaveLength(0);
  });
});

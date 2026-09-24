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
import { basename, join } from "node:path";

import { buildSheet } from "./fixtures/pipeline/make-sheet.mjs";

const FIXTURES = join(import.meta.dir, "fixtures", "pipeline");
const LOOP_FIXTURE = join(import.meta.dir, "fixtures", "loop");
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
      "init", "add-ref", "add-motion", "set-motion", "set-sheet", "set-keyframe",
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
        // The feet-centre std-dev `inspect` measures. It is picked by name
        // like every other field here, which is how it spent a round being
        // measured, written to inspect.json, and never reaching the sidecar
        // the viewer actually reads — a blank body-drift row on a motion the
        // pipeline had a perfect number for. 0 is that perfect number, and
        // the reason the pick tests `=== undefined` rather than truthiness.
        bodyDrift: 0,
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

    test("a run with no body drift, or a broken one, leaves the sidecar without it", () => {
      // Same discipline as the anchor point, for the same reason: 0 is what a
      // perfectly aligned motion measures, so a default of 0 would show the
      // viewer the best possible reading for a motion nobody measured. The
      // canonical `bounce-run.json` predates the field entirely.
      const { dir, realRun } = seedMini();
      const motion = projectJson(dir, "register-run", "--motion", "bounce",
        "--run", join(FIXTURES, "bounce-run.json"), "--at", String(T2));
      expect("bodyDrift" in motion.inspect).toBe(false);
      expect("bodyDrift" in readProject(dir).sprite.motions[0].inspect).toBe(false);

      for (const broken of ["0.199", null, {}, [0.199], Number.POSITIVE_INFINITY]) {
        // JSON has no NaN/Infinity, so Infinity serializes to null — which is
        // precisely the shape a hand-edited report arrives in.
        const payload = { ...realRun, inspect: { ...realRun.inspect, bodyDrift: broken } };
        writeFileSync(join(dir, "broken-drift.json"), JSON.stringify(payload));
        const got = projectJson(dir, "register-run", "--motion", "bounce",
          "--run", join(dir, "broken-drift.json"), "--at", String(T2));
        expect({ broken, present: "bodyDrift" in got.inspect }).toEqual({ broken, present: false });
      }
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
      expect(again.refs).toEqual([
        { id: "portrait", role: "turnaround", origin: "generated", label: "Portrait", uri: "refs/portrait.png" },
      ]);
    });
  });

  /**
   * A reference the user brought, and one the agent cut out of it. Both are
   * registered by the same `add-ref`, and the only difference that reaches
   * project.json is the provenance edge — which is the point: the asset entry
   * must not learn to lie about a model nobody called.
   */
  describe("references that were not generated here", () => {
    /** A ref-sized image on disk, ready to register, returning its uri. */
    function refFile(dir: string, name: string) {
      buildSheet(join(dir, "refs", `${name}.png`), { cell: 256, rows: 1, cols: 1 });
      return `refs/${name}.png`;
    }

    test("--uploaded writes an upload edge by a human, with no parent and no params", () => {
      const { dir } = seedMini();
      const uri = refFile(dir, "design-sheet");
      projectJson(dir, "add-ref", "--id", "design-sheet", "--file", uri, "--role", "turnaround",
        "--label", "Design sheet", "--uploaded", "--at", String(T2));

      const doc = readProject(dir);
      expect(doc.provenance.filter((e: any) => e.toAssetId === "ref-design-sheet")).toEqual([{
        toAssetId: "ref-design-sheet",
        fromAssetId: null,
        operation: { type: "upload", actor: "human", timestamp: T2 },
      }]);
      // the asset entry is the one every reference gets — measured, ready, tagged
      expect(doc.assets.find((a: any) => a.id === "ref-design-sheet")).toEqual({
        id: "ref-design-sheet", type: "image", uri, name: "Design sheet",
        metadata: { width: 256, height: 256 },
        createdAt: T2, status: "ready", tags: ["ref"],
      });
      expect(doc.sprite.refs).toContainEqual({
        id: "design-sheet", asset: "ref-design-sheet", role: "turnaround", label: "Design sheet",
      });

      const refs = projectJson(dir, "show").refs;
      expect(refs.find((r: any) => r.id === "design-sheet").origin).toBe("uploaded");
      // and the generated one next to it still says so
      expect(refs.find((r: any) => r.id === "portrait").origin).toBe("generated");
    });

    test("--derived-from hangs the pose off the reference it was cut out of", () => {
      const { dir } = seedMini();
      projectJson(dir, "add-ref", "--id", "turnaround", "--file", refFile(dir, "turnaround"),
        "--role", "turnaround", "--uploaded", "--at", String(T1));
      projectJson(dir, "add-ref", "--id", "pose-a", "--file", refFile(dir, "pose-a"),
        "--role", "custom", "--derived-from", "turnaround", "--op", "crop", "--at", String(T2));

      expect(readProject(dir).provenance.filter((e: any) => e.toAssetId === "ref-pose-a")).toEqual([{
        toAssetId: "ref-pose-a",
        fromAssetId: "ref-turnaround",
        // one parent, so no params.inputs — fromAssetId already says everything
        operation: { type: "derive", actor: "agent", timestamp: T2, params: { op: "crop" } },
      }]);
      expect(projectJson(dir, "show").refs.find((r: any) => r.id === "pose-a").origin).toBe("derived");
    });

    test("--op defaults to crop and takes any word", () => {
      const { dir } = seedMini();
      projectJson(dir, "add-ref", "--id", "pose-a", "--file", refFile(dir, "pose-a"),
        "--role", "custom", "--derived-from", "portrait", "--at", String(T2));
      projectJson(dir, "add-ref", "--id", "pose-b", "--file", refFile(dir, "pose-b"),
        "--role", "custom", "--derived-from", "portrait", "--op", "cleanup", "--at", String(T2));

      const params = (id: string) =>
        readProject(dir).provenance.find((e: any) => e.toAssetId === id).operation.params;
      expect(params("ref-pose-a")).toEqual({ op: "crop" });
      expect(params("ref-pose-b")).toEqual({ op: "cleanup" });
    });

    test("an unknown --derived-from is refused with the references it does know", () => {
      const { dir } = seedMini();
      const before = readProject(dir);
      const r = project(dir, "add-ref", "--id", "pose-a", "--file", refFile(dir, "pose-a"),
        "--role", "custom", "--derived-from", "turnaround", "--json");
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/--derived-from.*turnaround.*portrait/);
      expect(readProject(dir)).toEqual(before);
    });

    // Each of these names both flags in the refusal, because the agent has to
    // learn which half of the command it should drop.
    const refusals: Array<[string, string[], RegExp]> = [
      ["--uploaded --model", ["--uploaded", "--model", "openai/gpt-image-2.5-sunburst"], /--uploaded.*--model/],
      ["--uploaded --prompt", ["--uploaded", "--prompt", "a design sheet"], /--uploaded.*--prompt/],
      ["--uploaded --from", ["--uploaded", "--from", "ref-portrait"], /--uploaded.*--from/],
      ["--uploaded --derived-from", ["--uploaded", "--derived-from", "portrait"], /--uploaded.*--derived-from/],
      ["--derived-from --prompt", ["--derived-from", "portrait", "--prompt", "a pose"], /--derived-from.*--prompt/],
      ["--derived-from --model", ["--derived-from", "portrait", "--model", "openai/gpt-image-2.5-sunburst"], /--derived-from.*--model/],
      ["--derived-from --from", ["--derived-from", "portrait", "--from", "ref-portrait"], /--derived-from.*--from/],
      ["--op without --derived-from", ["--op", "crop"], /--op.*--derived-from/],
    ];

    for (const [name, extra, message] of refusals) {
      test(`${name} is refused by name and nothing is written`, () => {
        const { dir } = seedMini();
        const before = readProject(dir);
        const r = project(dir, "add-ref", "--id", "pose-a", "--file", refFile(dir, "pose-a"),
          "--role", "custom", ...extra, "--json");
        expect(r.code).toBe(1);
        expect(r.err).toMatch(message);
        expect(readProject(dir)).toEqual(before);
      });
    }

    test("re-registering an id replaces the edge whatever its type", () => {
      const { dir } = seedMini();
      const uri = refFile(dir, "pose-a");
      const edges = () => readProject(dir).provenance.filter((e: any) => e.toAssetId === "ref-pose-a");

      projectJson(dir, "add-ref", "--id", "pose-a", "--file", uri, "--role", "custom",
        "--model", "openai/gpt-image-2.5-sunburst", "--prompt", "a first pass", "--at", String(T1));
      expect(edges()).toHaveLength(1);

      projectJson(dir, "add-ref", "--id", "pose-a", "--file", uri, "--role", "custom",
        "--uploaded", "--at", String(T2));
      expect(edges()).toHaveLength(1);
      expect(edges()[0].operation).toEqual({ type: "upload", actor: "human", timestamp: T2 });

      projectJson(dir, "add-ref", "--id", "pose-a", "--file", uri, "--role", "custom",
        "--derived-from", "portrait", "--at", String(T2));
      expect(edges()).toHaveLength(1);
      expect(edges()[0]).toEqual({
        toAssetId: "ref-pose-a",
        fromAssetId: "ref-portrait",
        operation: { type: "derive", actor: "agent", timestamp: T2, params: { op: "crop" } },
      });

      projectJson(dir, "add-ref", "--id", "pose-a", "--file", uri, "--role", "custom",
        "--model", "openai/gpt-image-2.5-sunburst", "--at", String(T2));
      expect(edges()).toHaveLength(1);
      expect(edges()[0].operation.type).toBe("generate");

      // one asset and one sidecar entry throughout
      const doc = readProject(dir);
      expect(doc.assets.filter((a: any) => a.id === "ref-pose-a")).toHaveLength(1);
      expect(doc.sprite.refs.filter((r: any) => r.id === "pose-a")).toHaveLength(1);
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

  describe("the video source", () => {
    /** The seeded character with its clip registered, plus a run summary in
     *  `from-video`'s shape pointing at the same files the sheet run produced
     *  (the frames are the frames whichever way they were cut). */
    /** register-run driven over stdin, so a synthesised run summary never has
     *  to hit disk. */
    function registerRun(dir: string, summary: unknown, extra: string[] = []) {
      return run(PROJECT, ["register-run", "--dir", dir, "--motion", "bounce", "--run", "-", ...extra, "--json"],
        JSON.stringify(summary));
    }

    function seedVideoMotion() {
      const { dir, realRun } = seedMini();
      writeFileSync(join(dir, "motions", "bounce", "video-seedance-1.mp4"), "");
      projectJson(dir, "add-video", "--motion", "bounce", "--file", "motions/bounce/video-seedance-1.mp4",
        "--model", "seedance-2.5", "--mode", "i2v", "--prompt", "one idle loop on green",
        "--at", String(T2));
      const run = {
        ...realRun,
        source: "video",
        video: join(dir, "motions", "bounce", "video-seedance-1.mp4"),
        sampledAt: [0, 0.25, 0.5, 0.75],
      };
      delete (run as { sheetAlpha?: string }).sheetAlpha;
      return { dir, run };
    }

    test("register-run hangs the frames off the video asset and stamps the source", () => {
      const { dir, run } = seedVideoMotion();
      const r = registerRun(dir, run);
      expect(r.code).toBe(0);
      const motion = JSON.parse(r.out);
      expect(motion.source).toBe("video");
      expect(motion.status).toBe("ready");

      // Every frame derives from the CLIP, not from a sheet that never
      // existed, and carries where in the clip it was cut from.
      const edges = readProject(dir).provenance;
      const first = edges.find((e: any) => e.toAssetId === "bounce-frame-00");
      expect(first.fromAssetId).toBe("bounce-video-1");
      expect(first.operation.params).toEqual({
        tool: "sprite-sheet.mjs", step: "from-video", frameIndex: 0, t: 0,
      });
      expect(edges.find((e: any) => e.toAssetId === "bounce-frame-03").operation.params.t).toBe(0.75);
      // The clip itself keeps its own generate edge — registering the frames
      // must not re-parent it.
      expect(edges.find((e: any) => e.toAssetId === "bounce-video-1").operation.type).toBe("generate");
    });

    test("--video names which clip when a motion has more than one", () => {
      const { dir, run } = seedVideoMotion();
      writeFileSync(join(dir, "motions", "bounce", "video-seedance-2.mp4"), "");
      projectJson(dir, "add-video", "--motion", "bounce", "--file", "motions/bounce/video-seedance-2.mp4",
        "--model", "seedance-2.5", "--mode", "i2v", "--at", String(T2));

      // Without --video the newest clip is used, and it says so rather than
      // picking one silently.
      const inferred = registerRun(dir, { ...run, video: join(dir, "motions", "bounce", "video-seedance-2.mp4") });
      expect(inferred.code).toBe(0);
      expect(inferred.err).toContain("bounce-video-2");
      expect(readProject(dir).provenance.find((e: any) => e.toAssetId === "bounce-frame-00").fromAssetId)
        .toBe("bounce-video-2");

      const chosen = registerRun(dir, run, ["--video", "video-1"]);
      expect(chosen.code).toBe(0);
      expect(readProject(dir).provenance.find((e: any) => e.toAssetId === "bounce-frame-00").fromAssetId)
        .toBe("bounce-video-1");
    });

    test("a run whose clip is not the named asset is refused, not mis-parented", () => {
      const { dir, run } = seedVideoMotion();
      writeFileSync(join(dir, "motions", "bounce", "video-seedance-2.mp4"), "");
      projectJson(dir, "add-video", "--motion", "bounce", "--file", "motions/bounce/video-seedance-2.mp4",
        "--model", "seedance-2.5", "--mode", "i2v", "--at", String(T2));

      const r = registerRun(dir, run, ["--video", "video-2"]);
      expect(r.code).toBe(1);
      expect(r.err).toContain("video-seedance-1.mp4");
      expect(r.err).toContain("video-seedance-2.mp4");
    });

    test("a video run with no registered clip names the command that fixes it", () => {
      const { dir, realRun } = seedMini();
      const r = registerRun(dir, { ...realRun, source: "video", video: "motions/bounce/video-seedance-1.mp4" });
      expect(r.code).toBe(1);
      expect(r.err).toContain("add-video");
      expect(r.err).toContain("bounce");
    });

    test("add-motion --source records the choice before anything is generated", () => {
      const { dir } = seedMini();
      const motion = projectJson(dir, "add-motion", "--id", "walk", "--label", "Walk",
        "--rows", "4", "--cols", "4", "--fps", "8", "--source", "video");
      expect(motion.source).toBe("video");
      expect(projectJson(dir, "add-motion", "--id", "wave", "--label", "Wave",
        "--rows", "2", "--cols", "2", "--fps", "8").source).toBeUndefined();
    });

    test("a sheet run over a motion declared video corrects the source", () => {
      const { dir } = seedMini();
      // The motion was declared a video motion before anything was generated.
      const doc = readProject(dir);
      doc.sprite.motions[0].source = "video";
      writeFileSync(join(dir, "project.json"), JSON.stringify(doc, null, 2));

      projectJson(dir, "register-run", "--motion", "bounce",
        "--run", join(FIXTURES, "bounce-run.json"), "--at", String(T2));
      // The frames on disk came from a sheet; the sidecar has to say so.
      expect(readProject(dir).sprite.motions[0].source).toBe("sheet");
    });
  });

  describe("acknowledged warnings", () => {
    test("--ack-warnings records the reason the user reads, --clear-ack takes it back", () => {
      const { dir } = seedMini();
      projectJson(dir, "register-run", "--motion", "bounce",
        "--run", join(FIXTURES, "bounce-run.json"), "--at", String(T2));

      const acked = projectJson(dir, "set-motion", "--motion", "bounce",
        "--ack-warnings", "the lantern swings out of the bbox by design", "--at", String(T2));
      expect(acked.inspect.acknowledged).toEqual({
        reason: "the lantern swings out of the bbox by design",
        at: T2,
      });
      // The numbers stay: acknowledging dims the badge, it does not erase the
      // measurement.
      expect(acked.inspect.scaleDrift).toBe(0.02);

      const cleared = projectJson(dir, "set-motion", "--motion", "bounce", "--clear-ack");
      expect(cleared.inspect.acknowledged).toBeUndefined();
    });

    test("a motion with no inspect report cannot be acknowledged", () => {
      const { dir } = seedMini();
      const r = project(dir, "set-motion", "--motion", "bounce", "--ack-warnings", "looks fine");
      expect(r.code).toBe(1);
      expect(r.err).toContain("register-run");
    });

    test("an empty reason is refused — the acknowledgement IS the reason", () => {
      const { dir } = seedMini();
      projectJson(dir, "register-run", "--motion", "bounce",
        "--run", join(FIXTURES, "bounce-run.json"), "--at", String(T2));
      const r = project(dir, "set-motion", "--motion", "bounce", "--ack-warnings", "   ");
      expect(r.code).toBe(1);
      expect(r.err).toContain("--ack-warnings");
    });

    test("re-registering a run drops the acknowledgement with the numbers it covered", () => {
      const { dir } = seedMini();
      const args = ["register-run", "--motion", "bounce", "--run", join(FIXTURES, "bounce-run.json"), "--at", String(T2)];
      projectJson(dir, ...args);
      projectJson(dir, "set-motion", "--motion", "bounce", "--ack-warnings", "fine for now", "--at", String(T2));
      projectJson(dir, ...args);
      // A fresh measurement is not the one that was accepted.
      expect(readProject(dir).sprite.motions[0].inspect.acknowledged).toBeUndefined();
    });
  });

  describe("show", () => {
    test("summarises the character, refs and motions", () => {
      const { dir } = seedMini();
      projectJson(dir, "register-run", "--motion", "bounce",
        "--run", join(FIXTURES, "bounce-run.json"), "--at", String(T2));
      const out = projectJson(dir, "show");
      expect(out.character.name).toBe("Mini");
      expect(out.refs).toEqual([
        { id: "portrait", role: "portrait", origin: "generated", label: "Portrait", uri: "refs/portrait.png" },
      ]);
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

  /**
   * The loop workflow, end to end on real bytes.
   *
   * A loop motion is the same character's OTHER deliverable: a seamless
   * transparent animation for a UI instead of an atlas for a game engine. It
   * has no sheet, no atlas and no GIF — so every assertion here is about a
   * shape `register-run` used to refuse outright — plus four exports, a
   * keyframe pair, three-digit frame ids and the two numbers that say whether
   * the loop closes.
   *
   * `fixtures/loop/` is the `sprite-sheet.mjs loop --json` contract written
   * by hand (see its README): 12 real frames, four real encodes, and a run
   * summary whose paths are workspace-relative.
   */
  describe("loop motions", () => {
    /** The seeded character with a `flame` loop motion whose files are on
     *  disk under `motions/flame`, plus its run summary.
     *
     *  The brief is part of the seed because the scripts now gate the paid
     *  clip on it: `--brief-width 64` is the fixture's own cell, so nothing
     *  here trips the width warning by accident. `brief: false` is for the
     *  cases that are ABOUT the gate. */
    function seedLoop({ clip = true, brief = true } = {}) {
      const { dir } = seedMini();
      cpSync(LOOP_FIXTURE, join(dir, "motions", "flame"), { recursive: true });
      projectJson(dir, "add-motion", "--id", "flame", "--label", "Flame",
        "--kind", "loop", "--fps", "12", "--prompt", "a clay flame swaying");
      if (brief) {
        projectJson(dir, "set-motion", "--motion", "flame", "--brief-duration", "1",
          "--brief-width", "64", "--brief-interpolator", "none", "--at", String(T1));
      }
      if (clip) {
        projectJson(dir, "add-video", "--motion", "flame",
          "--file", "motions/flame/video-seedance-1.mp4",
          "--model", "seedance-2.5", "--mode", "first-last",
          "--prompt", "the flame sways and returns", "--status", "ready", "--at", String(T2));
      }
      const run = JSON.parse(readFileSync(join(LOOP_FIXTURE, "run.json"), "utf-8"));
      return { dir, run };
    }

    const registerLoop = (dir: string, summary: unknown, extra: string[] = []) =>
      run(PROJECT, ["register-run", "--dir", dir, "--motion", "flame", "--run", "-",
        ...extra, "--json", "--at", String(T2)], JSON.stringify(summary));

    test("add-motion --kind loop needs no grid and shoots video by default", () => {
      const { dir } = seedMini();
      const motion = projectJson(dir, "add-motion", "--id", "flame", "--label", "Flame",
        "--kind", "loop", "--fps", "24");
      // A loop has no grid: the frames are a sequence, not cells of a sheet.
      expect(motion).toMatchObject({
        kind: "loop",
        grid: { rows: 1, cols: 1 },
        fps: 24,
        source: "video",
        // A loop that plays once is a contradiction in terms.
        loop: true,
        status: "planned",
      });

      // A sprite motion is untouched — same required flags, same silence about
      // both `kind` and `source`.
      const sprite = projectJson(dir, "add-motion", "--id", "walk", "--label", "Walk",
        "--rows", "2", "--cols", "4", "--fps", "10");
      expect("kind" in sprite).toBe(false);
      expect("source" in sprite).toBe(false);
      expect(sprite.loop).toBe(false);
      const missingGrid = project(dir, "add-motion", "--id", "run", "--fps", "8", "--json");
      expect(missingGrid.code).toBe(1);
      expect(missingGrid.err).toMatch(/--rows/);

      // An explicit grid on a loop is still honoured, and an unknown kind is
      // refused rather than travelling as a word nothing renders.
      expect(projectJson(dir, "add-motion", "--id", "spin", "--kind", "loop",
        "--rows", "1", "--cols", "1", "--fps", "24", "--source", "sheet").source).toBe("sheet");
      const bogus = project(dir, "add-motion", "--id", "bad", "--kind", "cycle", "--fps", "8", "--json");
      expect(bogus.code).toBe(1);
      expect(bogus.err).toMatch(/--kind/);
    });

    test("set-motion records the interview's answers, and only on a loop", () => {
      const { dir } = seedLoop({ clip: false, brief: false });
      const motion = projectJson(dir, "set-motion", "--motion", "flame",
        "--brief-duration", "4", "--brief-width", "512",
        "--brief-interpolator", "topaz", "--brief-budget", "3", "--at", String(T1));

      expect(motion.brief).toEqual({
        duration: 4, width: 512, interpolator: "topaz", budgetUsd: 3,
        recordedAt: new Date(T1).toISOString(),
      });
      expect(readProject(dir).sprite.motions[1].brief.width).toBe(512);

      // A later call may change any ONE of them — the user narrows the width
      // after seeing the first take, and the other answers stand.
      const narrowed = projectJson(dir, "set-motion", "--motion", "flame",
        "--brief-width", "256", "--at", String(T2));
      expect(narrowed.brief).toEqual({
        duration: 4, width: 256, interpolator: "topaz", budgetUsd: 3,
        recordedAt: new Date(T2).toISOString(),
      });

      // …but the FIRST one needs all three: a half-recorded brief would open
      // the gate on answers nobody gave.
      const { dir: bare } = seedLoop({ clip: false, brief: false });
      const partial = project(bare, "set-motion", "--motion", "flame",
        "--brief-duration", "4", "--json");
      expect(partial.code).toBe(1);
      expect(partial.err).toMatch(/--brief-width.*--brief-interpolator/);
      expect("brief" in readProject(bare).sprite.motions[1]).toBe(false);

      // An interpolator nobody can run is refused by name, like every other
      // enumerated flag here.
      const bogus = project(bare, "set-motion", "--motion", "flame",
        "--brief-duration", "4", "--brief-width", "512",
        "--brief-interpolator", "topaz-2", "--json");
      expect(bogus.code).toBe(1);
      expect(bogus.err).toMatch(/--brief-interpolator/);

      // A sprite motion has no brief to record: its frames are drawn, not
      // shot, and none of the three answers describes anything it does.
      const sprite = project(dir, "set-motion", "--motion", "bounce",
        "--brief-duration", "4", "--brief-width", "512",
        "--brief-interpolator", "topaz", "--json");
      expect(sprite.code).toBe(1);
      expect(sprite.err).toMatch(/not a loop motion/);
    });

    test("the 400-frame ceiling is warned about at brief time, not after the clip", () => {
      const { dir } = seedLoop({ clip: false, brief: false });
      // The Kiki trial decided on a two-beat 7.4s loop, then discovered that
      // 60 fps did not fit and dropped to 48 — after both clips were paid
      // for. Topaz and the ffmpeg path both target 60, so the arithmetic is
      // knowable the moment the duration is recorded.
      const long = project(dir, "set-motion", "--motion", "flame",
        "--brief-duration", "7.4", "--brief-width", "512",
        "--brief-interpolator", "topaz", "--json");
      expect(long.code).toBe(0);
      expect(long.err).toContain("400");
      expect(long.err).toContain("--target-fps 48");
      // A warning, not a refusal: 48 fps may be exactly what the user wants.
      expect(JSON.parse(long.out).brief.duration).toBe(7.4);

      // Under the ceiling, nothing is said.
      const short = project(dir, "set-motion", "--motion", "flame",
        "--brief-duration", "4", "--json");
      expect(short.code).toBe(0);
      expect(short.err).toBe("");

      // RIFE doubles the clip's own rate rather than targeting 60, and
      // `none` interpolates nothing at all — neither gets the 60 fps warning.
      const rife = project(dir, "set-motion", "--motion", "flame",
        "--brief-duration", "7.4", "--brief-interpolator", "rife", "--json");
      expect(rife.code).toBe(0);
      expect(rife.err).toBe("");
    });

    test("a loop's first paid clip is refused until the brief is on file", () => {
      const { dir } = seedLoop({ clip: false, brief: false });
      writeFileSync(join(dir, "motions", "flame", "video-seedance-1.mp4"), "");
      const before = readProject(dir);

      const refused = project(dir, "add-video", "--motion", "flame",
        "--file", "motions/flame/video-seedance-1.mp4",
        "--model", "seedance-2.5", "--mode", "first-last", "--json");
      expect(refused.code).toBe(1);
      expect(refused.err).toContain("add-video: loop 'flame' has no brief");
      expect(refused.err).toContain("set-motion --brief-duration");
      // Nothing was written, so the next call starts from the same document.
      expect(readProject(dir)).toEqual(before);

      // With the brief recorded, the same call goes through.
      projectJson(dir, "set-motion", "--motion", "flame", "--brief-duration", "4",
        "--brief-width", "512", "--brief-interpolator", "topaz", "--at", String(T1));
      const shot = projectJson(dir, "add-video", "--motion", "flame",
        "--file", "motions/flame/video-seedance-1.mp4",
        "--model", "seedance-2.5", "--mode", "first-last", "--at", String(T2));
      expect(shot.videos[0].id).toBe("video-1");

      // A sprite motion never needed one.
      const sprite = projectJson(dir, "add-video", "--motion", "bounce",
        "--file", "motions/flame/video-seedance-1.mp4",
        "--model", "seedance-2.5", "--mode", "i2v", "--at", String(T2));
      expect(sprite.videos[0].id).toBe("video-1");
    });

    test("half a brief is no brief — the gate does not open on the word alone", () => {
      // `set-motion` writes all of it at once, but `project.json` is a file:
      // this is what a hand edit or a turn that stopped mid-way leaves, and
      // the gate used to open on the key's presence. A `{ "duration": 4 }`
      // bought the clip and then printed "undefinedpx" on `show`.
      const { dir } = seedLoop({ clip: false, brief: false });
      writeFileSync(join(dir, "motions", "flame", "video-seedance-1.mp4"), "");
      const doc = readProject(dir);
      doc.sprite.motions[1].brief = { duration: 4 };
      writeFileSync(join(dir, "project.json"), JSON.stringify(doc, null, 2) + "\n");

      const refused = project(dir, "add-video", "--motion", "flame",
        "--file", "motions/flame/video-seedance-1.mp4",
        "--model", "seedance-2.5", "--mode", "first-last", "--json");
      expect(refused.code).toBe(1);
      // It names what is missing: "record the answers" is not actionable when
      // the agent believes it already did.
      expect(refused.err).toContain(
        "add-video: loop 'flame' has an incomplete brief, missing --brief-width, --brief-interpolator and recordedAt",
      );

      // `show` says the same thing rather than reading half of it out loud.
      const human = project(dir, "show", "--motion", "flame");
      expect(human.out).toContain("brief: incomplete, missing --brief-width, --brief-interpolator and recordedAt");
      expect(human.out).not.toContain("undefined");
      // …and the JSON summaries carry no brief at all — the same all-or-nothing
      // rule the viewer's loader applies to the document it reads.
      expect("brief" in projectJson(dir, "show", "--motion", "flame")).toBe(false);
      expect("brief" in projectJson(dir, "show").motions[1]).toBe(false);

      // Completing it one flag at a time is completing nothing: there is no
      // brief to change an answer of, so all three are asked again.
      const patch = project(dir, "set-motion", "--motion", "flame", "--brief-width", "512", "--json");
      expect(patch.code).toBe(1);
      expect(patch.err).toMatch(/--brief-duration.*--brief-interpolator/);

      // Recorded whole, the same call goes through.
      projectJson(dir, "set-motion", "--motion", "flame", "--brief-duration", "4",
        "--brief-width", "512", "--brief-interpolator", "topaz", "--at", String(T1));
      expect(projectJson(dir, "add-video", "--motion", "flame",
        "--file", "motions/flame/video-seedance-1.mp4",
        "--model", "seedance-2.5", "--mode", "first-last", "--at", String(T2)).videos[0].id).toBe("video-1");
    });

    test("a derived clip needs no brief — that money is already spent", () => {
      // The gate is about the first paid RENDER. A matte or a retime of a clip
      // that already exists cannot be talked out of having happened, and
      // refusing to record it would only lose its provenance. A loop built
      // before the brief existed is the same case, so the brief is stripped
      // back out of the file rather than never written.
      const { dir } = seedLoop();
      const doc = readProject(dir);
      delete doc.sprite.motions[1].brief;
      writeFileSync(join(dir, "project.json"), JSON.stringify(doc, null, 2) + "\n");
      writeFileSync(join(dir, "motions", "flame", "video-veed-2.webm"), "");
      const derived = projectJson(dir, "add-video", "--motion", "flame",
        "--file", "motions/flame/video-veed-2.webm", "--derived-from", "video-1",
        "--op", "matte", "--model", "veed", "--at", String(T2));
      expect(derived.videos[1]).toMatchObject({ id: "video-2", op: "matte" });
    });

    test("a retime is a first-class derived clip, by ffmpeg", () => {
      // The Kiki trial reordered a plate clip with ffmpeg concat and had to
      // file the result as `interpolate/topaz` — a model nobody called.
      const { dir } = seedLoop();
      writeFileSync(join(dir, "motions", "flame", "video-retime-2.mp4"), "");
      const motion = projectJson(dir, "add-video", "--motion", "flame",
        "--file", "motions/flame/video-retime-2.mp4", "--derived-from", "video-1",
        "--op", "retime", "--model", "ffmpeg", "--at", String(T2));

      expect(motion.videos[1]).toEqual({
        id: "video-2", asset: "flame-video-2", model: "ffmpeg", mode: "derived",
        prompt: "", status: "ready", derivedFrom: "video-1", op: "retime",
      });
      expect(readProject(dir).provenance.find((e: any) => e.toAssetId === "flame-video-2"))
        .toEqual({
          toAssetId: "flame-video-2",
          fromAssetId: "flame-video-1",
          operation: { type: "derive", actor: "agent", timestamp: T2, params: { op: "retime", model: "ffmpeg" } },
        });

      // `show` prints it like any other derived clip.
      expect(project(dir, "show", "--motion", "flame").out)
        .toContain("video-2 ← video-1 (retime, ffmpeg)");

      // ffmpeg reorders frames; it does not shoot, matte or interpolate.
      const shooting = project(dir, "add-video", "--motion", "flame",
        "--file", "motions/flame/video-retime-2.mp4",
        "--model", "ffmpeg", "--mode", "i2v", "--json");
      expect(shooting.code).toBe(1);
      expect(shooting.err).toMatch(/--model/);
    });

    test("a loop cut from a retimed clip hangs off that clip like any other", () => {
      // A retime is one more link in the chain — nothing about `register-run`
      // needs to know which op made the clip it sampled.
      const { dir, run: summary } = seedLoop();
      writeFileSync(join(dir, "motions", "flame", "video-retime-2.mp4"), "");
      projectJson(dir, "add-video", "--motion", "flame",
        "--file", "motions/flame/video-retime-2.mp4", "--derived-from", "video-1",
        "--op", "retime", "--model", "ffmpeg", "--at", String(T2));

      const r = registerLoop(dir, { ...summary, video: "motions/flame/video-retime-2.mp4" },
        ["--video", "video-2"]);
      expect(r.code).toBe(0);
      expect(readProject(dir).provenance.find((e: any) => e.toAssetId === "flame-frame-000").fromAssetId)
        .toBe("flame-video-2");
      expect(JSON.parse(r.out).status).toBe("ready");
    });

    test("register-run says so when the frames are not the width the brief asked for", () => {
      const { dir, run: summary } = seedLoop();
      // The brief says 64 px (the fixture's own cell), so the honest run is
      // quiet.
      const quiet = registerLoop(dir, summary);
      expect(quiet.code).toBe(0);
      expect(quiet.err).not.toContain("the brief said");
      expect("warnings" in JSON.parse(quiet.out)).toBe(false);

      // Now ask for a width the run did not deliver. This is exactly the Kiki
      // failure: no `--width` on `loop`, so 532 px of frames landed for a UI
      // that wanted 512 — and a 45 MB Lottie with them.
      projectJson(dir, "set-motion", "--motion", "flame", "--brief-width", "512", "--at", String(T2));
      const r = registerLoop(dir, summary);
      expect(r.code).toBe(0);
      expect(r.err).toContain("frames are 64 px wide but the brief said 512 — pass --width to loop");
      expect(JSON.parse(r.out).warnings)
        .toContain("frames are 64 px wide but the brief said 512 — pass --width to loop");
      // Once per channel, and not in the measurement: `inspect.warnings` is
      // what the viewer shows and what `--ack-warnings` accepts, and this is a
      // comparison against the brief, not something measured in the frames.
      expect(JSON.parse(r.out).inspect.warnings.join(" ")).not.toContain("the brief said");
      expect(readProject(dir).sprite.motions[1].inspect.warnings.join(" ")).not.toContain("the brief said");

      // A human reads it once too: stdout carries the registration, stderr the
      // warning. The same sentence twice in one command reads as two problems.
      const forHumans = run(PROJECT, ["register-run", "--dir", dir, "--motion", "flame",
        "--run", "-", "--at", String(T2)], JSON.stringify(summary));
      expect(forHumans.code).toBe(0);
      expect(forHumans.err).toContain("WARN: frames are 64 px wide but the brief said 512");
      expect(forHumans.out).not.toContain("the brief said");

      // Two pixels of rounding (an even-sided crop) is not a mismatch.
      projectJson(dir, "set-motion", "--motion", "flame", "--brief-width", "66", "--at", String(T2));
      expect(registerLoop(dir, summary).err).not.toContain("the brief said");
    });

    test("set-keyframe registers the keyframe and its cut-out, and only on a loop", () => {
      const { dir } = seedLoop({ clip: false });
      const motion = projectJson(dir, "set-keyframe", "--motion", "flame",
        "--file", "motions/flame/keyframe.png", "--alpha", "motions/flame/keyframe-alpha.png",
        "--from", "ref-portrait", "--model", "openai/gpt-image-2.5-flare",
        "--prompt", "a clay flame, white plate", "--at", String(T2));

      expect(motion).toMatchObject({
        keyframe: "flame-keyframe",
        keyframeAlpha: "flame-keyframe-alpha",
        status: "processing",
      });
      const doc = readProject(dir);
      const asset = (id: string) => doc.assets.find((a: any) => a.id === id);
      expect(asset("flame-keyframe")).toMatchObject({
        type: "image", uri: "motions/flame/keyframe.png",
        metadata: { width: 64, height: 72 }, status: "ready",
      });
      expect(asset("flame-keyframe-alpha").metadata).toEqual({ width: 64, height: 72 });

      const edges = doc.provenance;
      expect(edges.find((e: any) => e.toAssetId === "flame-keyframe")).toMatchObject({
        fromAssetId: "ref-portrait",
        operation: { type: "generate", params: { model: "openai/gpt-image-2.5-flare" } },
      });
      // The cut-out is the keyframe with its background gone — a derive edge
      // off the image it came from, not a second generation.
      expect(edges.find((e: any) => e.toAssetId === "flame-keyframe-alpha")).toEqual({
        toAssetId: "flame-keyframe-alpha",
        fromAssetId: "flame-keyframe",
        operation: { type: "derive", actor: "agent", timestamp: T2, params: { step: "key" } },
      });

      // A sprite motion has no such thing, and says so instead of writing an
      // asset nothing renders.
      const refused = project(dir, "set-keyframe", "--motion", "bounce",
        "--file", "motions/flame/keyframe.png", "--json");
      expect(refused.code).toBe(1);
      expect(refused.err).toMatch(/not a loop motion/);
      expect(readProject(dir).sprite.motions[0].keyframe).toBeUndefined();
    });

    test("set-keyframe --status generating reserves the pair before either file exists", () => {
      const { dir } = seedMini();
      projectJson(dir, "add-motion", "--id", "spark", "--kind", "loop", "--fps", "24");
      expect(existsSync(join(dir, "motions", "spark", "keyframe.png"))).toBe(false);

      const motion = projectJson(dir, "set-keyframe", "--motion", "spark",
        "--file", "motions/spark/keyframe.png", "--alpha", "motions/spark/keyframe-alpha.png",
        "--prompt", "a spark", "--status", "generating", "--at", String(T1));
      expect(motion.status).toBe("generating");
      const asset = (id: string) => readProject(dir).assets.find((a: any) => a.id === id);
      expect(asset("spark-keyframe")).toMatchObject({ status: "generating", metadata: {} });
      expect(asset("spark-keyframe-alpha")).toMatchObject({ status: "generating", metadata: {} });

      // Every other status claims the file is there, so a missing one is the
      // hard error it is for set-sheet.
      const early = project(dir, "set-keyframe", "--motion", "spark",
        "--file", "motions/spark/keyframe.png", "--json");
      expect(early.code).toBe(1);
      expect(early.err).toMatch(/not found/);
    });

    test("the closing set-keyframe keeps the model and prompt the first one recorded", () => {
      const { dir } = seedLoop({ clip: false });
      projectJson(dir, "set-keyframe", "--motion", "flame",
        "--file", "motions/flame/keyframe.png", "--alpha", "motions/flame/keyframe-alpha.png",
        "--from", "ref-portrait", "--model", "openai/gpt-image-2.5-flare",
        "--prompt", "a clay flame, white plate", "--status", "generating", "--at", String(T1));

      // The closing call carries the FILE that landed, not the prompt that was
      // sent — those are known at the first call and nowhere afterwards.
      // Rebuilding the edge from bare flags wrote `params: {}` over them.
      projectJson(dir, "set-keyframe", "--motion", "flame",
        "--file", "motions/flame/keyframe.png",
        "--alpha", "motions/flame/keyframe-alpha.png", "--at", String(T2));
      const edge = readProject(dir).provenance.find((e: any) => e.toAssetId === "flame-keyframe");
      expect(edge).toMatchObject({
        fromAssetId: "ref-portrait",
        operation: {
          type: "generate",
          timestamp: T2,
          params: { model: "openai/gpt-image-2.5-flare", prompt: "a clay flame, white plate" },
        },
      });

      // A flag that IS passed replaces its own field and leaves the rest.
      projectJson(dir, "set-keyframe", "--motion", "flame",
        "--file", "motions/flame/keyframe.png",
        "--alpha", "motions/flame/keyframe-alpha.png",
        "--prompt", "a clay flame, redrawn", "--at", String(T2));
      expect(readProject(dir).provenance
        .find((e: any) => e.toAssetId === "flame-keyframe").operation.params).toEqual({
        model: "openai/gpt-image-2.5-flare", prompt: "a clay flame, redrawn",
      });
    });

    test("a closing set-keyframe may not strand the reserved cut-out", () => {
      const { dir } = seedLoop({ clip: false });
      projectJson(dir, "set-keyframe", "--motion", "flame",
        "--file", "motions/flame/keyframe.png", "--alpha", "motions/flame/keyframe-alpha.png",
        "--model", "openai/gpt-image-2.5-flare", "--status", "generating", "--at", String(T1));

      // The stage prefers the cut-out over the keyframe, so leaving it a
      // placeholder leaves a broken image on screen until the run lands.
      const before = readProject(dir);
      const stranded = project(dir, "set-keyframe", "--motion", "flame",
        "--file", "motions/flame/keyframe.png", "--json", "--at", String(T2));
      expect(stranded.code).toBe(1);
      expect(stranded.err).toMatch(/flame-keyframe-alpha is still a placeholder.*--alpha/);
      expect(readProject(dir)).toEqual(before);

      // With --alpha it measures both and the refusal is gone for good.
      projectJson(dir, "set-keyframe", "--motion", "flame",
        "--file", "motions/flame/keyframe.png",
        "--alpha", "motions/flame/keyframe-alpha.png", "--at", String(T2));
      expect(projectJson(dir, "set-keyframe", "--motion", "flame",
        "--file", "motions/flame/keyframe.png", "--at", String(T2)).keyframeAlpha)
        .toBe("flame-keyframe-alpha");
    });

    test("add-video --derived-from hangs a matte off the clip it was made from", () => {
      const { dir } = seedLoop();
      writeFileSync(join(dir, "motions", "flame", "video-veed-2.webm"), "");
      const motion = projectJson(dir, "add-video", "--motion", "flame",
        "--file", "motions/flame/video-veed-2.webm", "--derived-from", "video-1",
        "--op", "matte", "--model", "veed", "--status", "ready", "--at", String(T2));

      expect(motion.videos[1]).toEqual({
        id: "video-2", asset: "flame-video-2", model: "veed", mode: "derived",
        prompt: "", status: "ready", derivedFrom: "video-1", op: "matte",
      });
      expect(readProject(dir).provenance.find((e: any) => e.toAssetId === "flame-video-2")).toEqual({
        toAssetId: "flame-video-2",
        fromAssetId: "flame-video-1",
        operation: { type: "derive", actor: "agent", timestamp: T2, params: { op: "matte", model: "veed" } },
      });

      // Interpolation is the other op, and it can chain off the same take.
      writeFileSync(join(dir, "motions", "flame", "video-topaz-3.mp4"), "");
      const chained = projectJson(dir, "add-video", "--motion", "flame",
        "--file", "motions/flame/video-topaz-3.mp4", "--derived-from", "flame-video-1",
        "--op", "interpolate", "--model", "topaz", "--at", String(T2));
      expect(chained.videos[2]).toMatchObject({
        id: "video-3", model: "topaz", op: "interpolate", derivedFrom: "video-1",
      });

      // `show` says whose matte it is — "video-2" alone cannot.
      const human = project(dir, "show", "--motion", "flame");
      expect(human.out).toContain("video-2 ← video-1 (matte, veed)");
      expect(projectJson(dir, "show", "--motion", "flame").videos[1]).toMatchObject({
        derivedFrom: "video-1", op: "matte",
      });
    });

    test("a derived clip is registered after it exists, so it lands ready", () => {
      const { dir } = seedLoop();
      writeFileSync(join(dir, "motions", "flame", "video-veed-2.webm"), "");
      // No --status: the matting script had already written this file before
      // there was anything to register, so `generating` would describe a wait
      // that is over. A SHOT clip is the other way round and keeps its own
      // default — it is booked before the model runs.
      const derived = projectJson(dir, "add-video", "--motion", "flame",
        "--file", "motions/flame/video-veed-2.webm", "--derived-from", "video-1",
        "--op", "matte", "--model", "veed", "--at", String(T2));
      expect(derived.videos[1]).toMatchObject({ id: "video-2", status: "ready" });
      expect(readProject(dir).assets.find((a: any) => a.id === "flame-video-2").status)
        .toBe("ready");

      writeFileSync(join(dir, "motions", "flame", "video-seedance-4.mp4"), "");
      const shot = projectJson(dir, "add-video", "--motion", "flame",
        "--file", "motions/flame/video-seedance-4.mp4",
        "--model", "seedance-2.5", "--mode", "i2v", "--at", String(T2));
      expect(shot.videos[2].status).toBe("generating");

      // `--status` still overrides — a matte that came back broken is failed.
      writeFileSync(join(dir, "motions", "flame", "video-veed-5.webm"), "");
      const failed = projectJson(dir, "add-video", "--motion", "flame",
        "--file", "motions/flame/video-veed-5.webm", "--derived-from", "video-1",
        "--op", "matte", "--model", "veed", "--status", "failed", "--at", String(T2));
      expect(failed.videos[3].status).toBe("failed");
    });

    test("every endpoint that can make a clip out of a clip can be recorded as one", () => {
      const { dir } = seedLoop();
      // The bookkeeping has to be able to name the endpoint that really ran.
      // A `veed-gs` matte recorded as `veed`, or a RIFE retime as `topaz`,
      // is a model nobody called — and the price and the parameters differ.
      const derived: Array<[string, string]> = [
        ["veed", "matte"], ["veed-gs", "matte"], ["bria", "matte"],
        ["topaz", "interpolate"], ["rife", "interpolate"],
        ["ffmpeg", "retime"],
      ];
      for (const [model, op] of derived) {
        const file = `motions/flame/video-${model}.mp4`;
        writeFileSync(join(dir, file), "");
        const motion = projectJson(dir, "add-video", "--motion", "flame",
          "--file", file, "--derived-from", "video-1",
          "--op", op, "--model", model, "--at", String(T2));
        expect(motion.videos.at(-1)).toMatchObject({ model, op, mode: "derived" });
      }
      const unknown = project(dir, "add-video", "--motion", "flame",
        "--file", "motions/flame/video-veed.mp4", "--derived-from", "video-1",
        "--op", "matte", "--model", "rmbg", "--json");
      expect(unknown.code).toBe(1);
      expect(unknown.err).toMatch(/--model/);
    });

    // Nothing here was SHOT, so each of these flags is refused by name rather
    // than quietly recorded as a generation nobody ran.
    const derivedRefusals: Array<[string, string[], RegExp]> = [
      ["--mode", ["--mode", "i2v"], /--derived-from.*--mode/],
      ["--prompt", ["--prompt", "a flame"], /--derived-from.*--prompt/],
      ["--from", ["--from", "bounce-frame-00"], /--derived-from.*--from/],
    ];
    for (const [name, extra, message] of derivedRefusals) {
      test(`add-video --derived-from ${name} is refused and nothing is written`, () => {
        const { dir } = seedLoop();
        writeFileSync(join(dir, "motions", "flame", "video-veed-2.webm"), "");
        const before = readProject(dir);
        const r = project(dir, "add-video", "--motion", "flame",
          "--file", "motions/flame/video-veed-2.webm", "--derived-from", "video-1",
          "--op", "matte", "--model", "veed", ...extra, "--json");
        expect(r.code).toBe(1);
        expect(r.err).toMatch(message);
        expect(readProject(dir)).toEqual(before);
      });
    }

    test("a matting model cannot be asked to shoot, and a shoot has no --op", () => {
      const { dir } = seedLoop();
      writeFileSync(join(dir, "motions", "flame", "video-2.mp4"), "");
      const shooting = project(dir, "add-video", "--motion", "flame",
        "--file", "motions/flame/video-2.mp4", "--model", "veed", "--mode", "i2v", "--json");
      expect(shooting.code).toBe(1);
      expect(shooting.err).toMatch(/--model/);

      const opWithoutParent = project(dir, "add-video", "--motion", "flame",
        "--file", "motions/flame/video-2.mp4", "--model", "seedance-2.5",
        "--mode", "i2v", "--op", "matte", "--json");
      expect(opWithoutParent.code).toBe(1);
      expect(opWithoutParent.err).toMatch(/--op.*--derived-from/);

      const unknownParent = project(dir, "add-video", "--motion", "flame",
        "--file", "motions/flame/video-2.mp4", "--derived-from", "video-9",
        "--op", "matte", "--model", "bria", "--json");
      expect(unknownParent.code).toBe(1);
      expect(unknownParent.err).toMatch(/video-9.*video-1/);
    });

    test("register-run takes a loop summary with no sheet, atlas or GIF", () => {
      const { dir, run: summary } = seedLoop();
      const r = registerLoop(dir, summary);
      expect(r.code).toBe(0);
      const motion = JSON.parse(r.out);

      expect(motion).toMatchObject({
        kind: "loop",
        source: "video",
        status: "ready",
        // Interpolation changes the frame rate, so the run's fps wins.
        fps: 12,
        grid: { rows: 1, cols: 1 },
        exports: { apng: "flame-apng", webm: "flame-webm", lottie: "flame-lottie" },
        webp: "flame-webp",
      });
      // Three digits: one closed cycle at full rate runs past 99 frames.
      expect(motion.frames).toEqual(
        Array.from({ length: 12 }, (_, i) => `flame-frame-${String(i).padStart(3, "0")}`),
      );
      // No atlas exists, and the sidecar does not claim one.
      for (const key of ["sheet", "atlas", "gif", "sheetRaw"]) {
        expect({ key, present: key in motion }).toEqual({ key, present: false });
      }

      // The loop's own numbers, and none of the anchor ones it never measured.
      expect(motion.inspect).toMatchObject({
        frameCount: 12,
        cell: { width: 64, height: 72 },
        seam: 0.0065,
        step: 0.02,
        alphaCoverage: 0.31,
        warnings: [],
      });
      expect("anchorPoint" in motion.inspect).toBe(false);
      expect("bodyDrift" in motion.inspect).toBe(false);
    });

    test("a loop's crop and clip scale go into the sidecar, and a run without them carries neither", () => {
      // The .riv and the Export tab read the sidecar: without the scale each
      // loop was drawn at against its clip, they cannot keep the character
      // one size across loops, nor put each where it stood in its clip.
      const { dir, run: summary } = seedLoop();
      const recorded = { ...summary, inspect: { ...summary.inspect, crop: { x: 12, y: 4, w: 64, h: 72 }, scale: 1 } };
      const motion = JSON.parse(registerLoop(dir, recorded).out);
      expect(motion.inspect).toMatchObject({ crop: { x: 12, y: 4, w: 64, h: 72 }, scale: 1 });

      // A run from before the fields existed: absent, never a made-up 1.
      const legacy = JSON.parse(registerLoop(dir, summary).out);
      expect({ crop: "crop" in legacy.inspect, scale: "scale" in legacy.inspect }).toEqual({ crop: false, scale: false });

      // Half a rect or a scale that is not a positive number is no record.
      const broken = { ...summary, inspect: { ...summary.inspect, crop: { x: 12, y: 4, w: 64 }, scale: 0 } };
      const dropped = JSON.parse(registerLoop(dir, broken).out);
      expect({ crop: "crop" in dropped.inspect, scale: "scale" in dropped.inspect }).toEqual({ crop: false, scale: false });
    });

    test("every export is registered with its size in bytes", () => {
      const { dir, run: summary } = seedLoop();
      registerLoop(dir, summary);
      const assets = readProject(dir).assets;
      const asset = (id: string) => assets.find((a: any) => a.id === id);

      const onDisk = (name: string) =>
        readFileSync(join(dir, "motions", "flame", name)).byteLength;

      // The size is measured off the FILE, not copied out of the report — the
      // panel prints it beside a download link, and a stale number there is a
      // promise about bytes nobody has.
      expect(asset("flame-webp")).toMatchObject({
        type: "image", uri: "motions/flame/loop.webp",
        metadata: { width: 64, height: 72, fps: 12, size: onDisk("loop.webp") },
      });
      expect(asset("flame-apng")).toMatchObject({
        type: "image", metadata: { width: 64, height: 72, fps: 12, size: onDisk("loop.apng") },
      });
      expect(asset("flame-webm")).toMatchObject({
        type: "video", metadata: { width: 64, height: 72, fps: 12, size: onDisk("loop.webm") },
      });
      expect(asset("flame-lottie")).toMatchObject({
        type: "text", uri: "motions/flame/loop.json",
        metadata: { fps: 12, size: onDisk("loop.json") },
      });

      // Each one was encoded from the frame sequence, and says so.
      const edge = readProject(dir).provenance.find((e: any) => e.toAssetId === "flame-webm");
      expect(edge.fromAssetId).toBe("flame-frame-000");
      expect(edge.operation.params).toMatchObject({ tool: "sprite-sheet.mjs", step: "loop" });
      expect(edge.operation.params.inputs).toHaveLength(12);
    });

    test("a WebM nobody could measure says so instead of losing its dimensions", () => {
      const { dir, run: summary } = seedLoop();
      // Exactly what a machine without ffprobe produces for every export:
      // `videoMetadata` answers `{}` plus a warning, and dropping that
      // warning was what made the empty metadata silent.
      writeFileSync(join(dir, "motions", "flame", "loop.webm"), "not a matroska file");
      const r = registerLoop(dir, summary);
      expect(r.code).toBe(0);
      expect(r.out + r.err).toMatch(/WARN: ffprobe could not read loop\.webm/);
      const asset = readProject(dir).assets.find((a: any) => a.id === "flame-webm");
      // The size still lands — that one is a stat, not a probe.
      expect(asset.metadata).toEqual({ fps: 12, size: "not a matroska file".length });
      expect(asset.status).toBe("ready");
    });

    test("the seam frames the wrap needed travel into the sidecar", () => {
      const { dir, run: summary } = seedLoop();
      // `--seam-fill auto` inserts N in-betweens at the wrap and reports how
      // many; the panel says so beside the frame count, which is no longer
      // the clip's own. 0 is a real reading (the loop closed by itself).
      const filled = { ...summary, inspect: { ...summary.inspect, seamFill: 3 } };
      expect(JSON.parse(registerLoop(dir, filled).out).inspect.seamFill).toBe(3);

      const closed = { ...summary, inspect: { ...summary.inspect, seamFill: 0 } };
      expect(JSON.parse(registerLoop(dir, closed).out).inspect.seamFill).toBe(0);

      // A report that never carried the number leaves the key off entirely —
      // absent is "nobody measured", and the viewer renders that correctly.
      // The fixture mirrors what `loop --json` emits today (`seamFill: 0`),
      // so the older shape is built by removing the key, not by trusting it.
      const { seamFill: _measured, ...inspectWithoutFill } = summary.inspect;
      const older = JSON.parse(registerLoop(dir, { ...summary, inspect: inspectWithoutFill }).out);
      expect("seamFill" in older.inspect).toBe(false);

      // And a broken one is dropped rather than carried as NaN.
      const broken = { ...summary, inspect: { ...summary.inspect, seamFill: "three" } };
      expect("seamFill" in JSON.parse(registerLoop(dir, broken).out).inspect).toBe(false);
    });

    test("the frames are cut from the clip, with the timestamp of each one", () => {
      const { dir, run: summary } = seedLoop();
      registerLoop(dir, summary);
      const edges = readProject(dir).provenance;
      const first = edges.find((e: any) => e.toAssetId === "flame-frame-000");
      expect(first.fromAssetId).toBe("flame-video-1");
      expect(first.operation.params).toEqual({
        tool: "sprite-sheet.mjs", step: "from-video", frameIndex: 0, t: 0,
      });
      expect(edges.find((e: any) => e.toAssetId === "flame-frame-011").operation.params.t)
        .toBeCloseTo(11 / 12, 3);

      // A frame `--seam-fill` invented at the wrap was sampled from nothing,
      // so the run reports `sampledAt: null` for it. It must arrive as an
      // ABSENT `t`, never as 0 — which is the timestamp of frame 000.
      const filled = JSON.parse(readFileSync(join(LOOP_FIXTURE, "run.json"), "utf-8"));
      filled.sampledAt[11] = null;
      registerLoop(dir, filled);
      const wrap = readProject(dir).provenance
        .find((e: any) => e.toAssetId === "flame-frame-011");
      expect("t" in wrap.operation.params).toBe(false);
      expect(wrap.operation.params).toEqual({
        tool: "sprite-sheet.mjs", step: "from-video", frameIndex: 11,
      });
      // The clip keeps its own generate edge.
      expect(edges.find((e: any) => e.toAssetId === "flame-video-1").operation.type).toBe("generate");
    });

    test("a loop cut from a derived clip names that clip", () => {
      // The whole point of --derived-from: the frames of a matted loop came
      // out of the MATTE, not out of the take it was made from.
      const { dir, run: summary } = seedLoop();
      cpSync(join(LOOP_FIXTURE, "loop.webm"), join(dir, "motions", "flame", "video-veed-2.webm"));
      projectJson(dir, "add-video", "--motion", "flame", "--file", "motions/flame/video-veed-2.webm",
        "--derived-from", "video-1", "--op", "matte", "--model", "veed", "--status", "ready", "--at", String(T2));

      const matted = { ...summary, video: "motions/flame/video-veed-2.webm" };
      const r = registerLoop(dir, matted, ["--video", "video-2"]);
      expect(r.code).toBe(0);
      expect(readProject(dir).provenance.find((e: any) => e.toAssetId === "flame-frame-000").fromAssetId)
        .toBe("flame-video-2");

      // And naming the wrong one is still refused rather than mis-parented.
      const wrong = registerLoop(dir, matted, ["--video", "video-1"]);
      expect(wrong.code).toBe(1);
      expect(wrong.err).toContain("video-veed-2.webm");
    });

    test("re-registering a loop run leaves project.json byte-identical", () => {
      const { dir, run: summary } = seedLoop();
      registerLoop(dir, summary);
      const before = readFileSync(join(dir, "project.json"), "utf-8");
      registerLoop(dir, summary);
      expect(readFileSync(join(dir, "project.json"), "utf-8")).toBe(before);
    });

    test("a shorter re-run drops the stale three-digit frames", () => {
      const { dir, run: summary } = seedLoop();
      registerLoop(dir, summary);
      const shorter = {
        ...summary,
        frames: summary.frames.slice(0, 4),
        sampledAt: summary.sampledAt.slice(0, 4),
        inspect: { ...summary.inspect, frameCount: 4 },
      };
      const motion = JSON.parse(registerLoop(dir, shorter).out);
      expect(motion.frames).toHaveLength(4);
      const ids = readProject(dir).assets.map((a: any) => a.id);
      expect(ids).toContain("flame-frame-003");
      expect(ids).not.toContain("flame-frame-004");
      expect(ids).not.toContain("flame-frame-011");
      // The exports survive — they are rebuilt in place, not orphaned.
      expect(ids).toContain("flame-lottie");
    });

    test("a loop run still needs its clip registered, and says which command", () => {
      const { dir, run: summary } = seedLoop({ clip: false });
      const r = registerLoop(dir, summary);
      expect(r.code).toBe(1);
      expect(r.err).toContain("add-video");
      expect(r.err).toContain("flame");
    });

    test("a summary with neither frames nor a shape names the subcommand", () => {
      const { dir } = seedLoop();
      const r = registerLoop(dir, { kind: "loop", source: "video" });
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/frames/);
      expect(r.err).toContain("loop");
      // A sprite run is still held to all four keys.
      const sheetish = run(PROJECT, ["register-run", "--dir", dir, "--motion", "bounce", "--run", "-", "--json"],
        JSON.stringify({ frames: ["motions/bounce/frames/00.png"] }));
      expect(sheetish.code).toBe(1);
      expect(sheetish.err).toMatch(/'sheet'/);
    });

    test("show and remove-motion know what a loop is made of", () => {
      const { dir, run: summary } = seedLoop();
      projectJson(dir, "set-keyframe", "--motion", "flame", "--file", "motions/flame/keyframe.png",
        "--alpha", "motions/flame/keyframe-alpha.png", "--at", String(T2));
      registerLoop(dir, summary);

      const human = project(dir, "show", "--motion", "flame");
      expect(human.out).toContain("loop");
      expect(human.out).toContain("seam 0.0065 vs step 0.02");
      expect(human.out).toContain("closes");
      expect(human.out).toContain("webp, apng, webm, lottie");
      // The brief is what the next turn has to work to, so `show` — the
      // cheapest way to re-orient — says it out loud.
      expect(human.out).toContain("brief: 1s, 64px, interpolator none");

      const single = projectJson(dir, "show", "--motion", "flame");
      expect(single.kind).toBe("loop");
      expect(single.brief).toMatchObject({ duration: 1, width: 64, interpolator: "none" });
      expect(single.exports).toEqual({ apng: "flame-apng", webm: "flame-webm", lottie: "flame-lottie" });
      expect(single.keyframe).toBe("flame-keyframe");
      // A sprite motion in the same character says nothing about a kind.
      expect(projectJson(dir, "show").motions.find((m: any) => m.id === "bounce").kind)
        .toBeUndefined();

      // Removing the motion takes the keyframe pair and all four exports with
      // it — every id this motion owns, or the next character-wide check trips
      // over an asset nothing claims.
      const removed = projectJson(dir, "remove-motion", "--motion", "flame");
      for (const id of [
        "flame-keyframe", "flame-keyframe-alpha", "flame-frame-000", "flame-webp",
        "flame-apng", "flame-webm", "flame-lottie", "flame-video-1",
      ]) {
        expect({ id, removed: removed.removedAssets.includes(id) }).toEqual({ id, removed: true });
      }
      expect(readProject(dir).assets.some((a: any) => a.id.startsWith("flame-"))).toBe(false);
    });

    test("a sheet run over a motion declared a loop corrects the kind", () => {
      // The same discipline `source` has: the files on disk are the answer,
      // not what somebody declared before anything was generated.
      const { dir, run: summary } = seedLoop();
      registerLoop(dir, summary);
      expect(readProject(dir).sprite.motions[1].kind).toBe("loop");

      const sheetRun = JSON.parse(readFileSync(join(FIXTURES, "bounce-run.json"), "utf-8"));
      // point it at the bounce files, which really are on disk here
      const r = run(PROJECT, ["register-run", "--dir", dir, "--motion", "flame", "--run", "-", "--json"],
        JSON.stringify(sheetRun));
      expect(r.code).toBe(0);
      const motion = JSON.parse(r.out);
      expect("kind" in motion).toBe(false);
      expect("exports" in motion).toBe(false);
      expect(motion.sheet).toBe("flame-sheet");
      expect(readProject(dir).assets.some((a: any) => a.id === "flame-lottie")).toBe(false);
    });
  });

  describe("exports", () => {
    /** The seeded character with `bounce` registered from its real run. */
    function seedReady() {
      const { dir, realRun } = seedMini();
      const r = run(PROJECT, ["register-run", "--dir", dir, "--motion", "bounce", "--run", "-", "--json",
        "--at", String(T1)], JSON.stringify(realRun));
      if (r.code !== 0) throw new Error(r.err);
      return { dir, realRun };
    }

    /** What `sprite-sheet.mjs export … --json` / `rive … --json` printed. */
    function sheetJson(...argv: string[]) {
      const r = run(SHEET, [...argv, "--json"]);
      if (r.code !== 0) throw new Error(`sprite-sheet ${argv[0]} failed:\n${r.err}`);
      return JSON.parse(r.out);
    }
    const exportOf = (dir: string, motion: string, ...flags: string[]) =>
      sheetJson("export", join(dir, "motions", motion), ...flags);

    const register = (dir: string, report: unknown, at = T2) =>
      run(PROJECT, ["register-export", "--dir", dir, "--report", "-", "--json", "--at", String(at)],
        JSON.stringify(report));

    const asset = (dir: string, id: string) => readProject(dir).assets.find((a: any) => a.id === id);
    const edgeTo = (dir: string, id: string) => readProject(dir).provenance.find((e: any) => e.toAssetId === id);
    const motionOf = (dir: string, id: string) => readProject(dir).sprite.motions.find((m: any) => m.id === id);
    const BOUNCE_FRAMES = ["bounce-frame-00", "bounce-frame-01", "bounce-frame-02", "bounce-frame-03"];
    const EXPORT_TIMEOUT_MS = 30_000;

    test("a video export is registered with its size, its timing and its frames", () => {
      const { dir } = seedReady();
      const report = exportOf(dir, "bounce", "--format", "mp4");
      const r = register(dir, report);
      expect(r.code).toBe(0);
      const payload = JSON.parse(r.out);
      expect(payload).toMatchObject({ motion: "bounce", format: "mp4", asset: "bounce-export-mp4" });

      expect(asset(dir, "bounce-export-mp4")).toEqual({
        id: "bounce-export-mp4",
        type: "video",
        uri: "motions/bounce/exports/bounce.mp4",
        name: "bounce export (mp4)",
        metadata: {
          width: 64, height: 64, fps: 8, duration: 3, frames: 4, repeat: 6, scale: 1,
          background: "#ffffff",
          size: readFileSync(join(dir, "motions", "bounce", "exports", "bounce.mp4")).byteLength,
        },
        createdAt: T2,
        status: "ready",
      });
      // Made from the registered frames, all four of them.
      const edge = edgeTo(dir, "bounce-export-mp4");
      expect(edge.fromAssetId).toBe("bounce-frame-00");
      expect(edge.operation).toMatchObject({ type: "derive", actor: "agent", timestamp: T2 });
      expect(edge.operation.params).toEqual({
        tool: "sprite-sheet.mjs", step: "export", format: "mp4", repeat: 6, scale: 1,
        background: "#ffffff", inputs: BOUNCE_FRAMES,
      });
      expect(motionOf(dir, "bounce").exports).toEqual({ mp4: "bounce-export-mp4" });
    }, EXPORT_TIMEOUT_MS);

    test("each format lands under its own id, with the craft type that fits it", () => {
      const { dir } = seedReady();
      for (const format of ["apng", "lottie", "png-seq"]) {
        expect(register(dir, exportOf(dir, "bounce", "--format", format)).code).toBe(0);
      }
      expect(asset(dir, "bounce-export-apng")).toMatchObject({ type: "image", uri: "motions/bounce/exports/bounce.apng" });
      expect(asset(dir, "bounce-export-lottie")).toMatchObject({ type: "text", uri: "motions/bounce/exports/bounce.json" });
      // The craft type union has no archive; the zip is filed as the image
      // sequence it holds, and `container` says what the file really is.
      expect(asset(dir, "bounce-export-png-seq")).toMatchObject({
        type: "image",
        uri: "motions/bounce/exports/bounce-frames.zip",
        metadata: { container: "zip", frames: 4, fps: 8 },
      });
      expect(motionOf(dir, "bounce").exports).toEqual({
        apng: "bounce-export-apng", lottie: "bounce-export-lottie", "png-seq": "bounce-export-png-seq",
      });
    }, EXPORT_TIMEOUT_MS);

    test("re-exporting replaces the asset in place, and the same report twice is a no-op", () => {
      const { dir } = seedReady();
      const first = exportOf(dir, "bounce", "--format", "apng");
      register(dir, first);
      const once = readFileSync(join(dir, "project.json"), "utf-8");
      register(dir, first);
      expect(readFileSync(join(dir, "project.json"), "utf-8")).toBe(once);

      const again = exportOf(dir, "bounce", "--format", "mp4", "--repeat", "2");
      register(dir, again, T2 + 1);
      register(dir, exportOf(dir, "bounce", "--format", "mp4", "--repeat", "3"), T2 + 2);
      const doc = readProject(dir);
      expect(doc.assets.filter((a: any) => a.id === "bounce-export-mp4")).toHaveLength(1);
      expect(doc.provenance.filter((e: any) => e.toAssetId === "bounce-export-mp4")).toHaveLength(1);
      expect(asset(dir, "bounce-export-mp4").metadata.repeat).toBe(3);
    }, EXPORT_TIMEOUT_MS);

    test("a lossless .riv says so in the sidecar", () => {
      const { dir } = seedReady();
      const report = sheetJson("rive", dir, "--images", "webp-lossless");
      expect(report.images).toBe("webp-lossless");
      expect(register(dir, report).code).toBe(0);
      expect(asset(dir, `${basename(dir)}-export-riv`).metadata.images).toBe("webp-lossless");
    }, EXPORT_TIMEOUT_MS);

    test("the character's .riv is registered on the character, off every frame it holds", () => {
      const { dir } = seedReady();
      const report = sheetJson("rive", dir);
      // The format is the script's to choose (WebP unless this ffmpeg has no libwebp); the sidecar records it.
      expect(["webp", "png"]).toContain(report.images);
      const r = register(dir, report);
      expect(r.code).toBe(0);
      const id = `${basename(dir)}-export-riv`;
      expect(JSON.parse(r.out)).toMatchObject({ asset: id, format: "riv" });
      expect(asset(dir, id)).toMatchObject({
        type: "image",
        uri: `exports/${basename(dir)}.riv`,
        metadata: {
          container: "riv", frames: 4, motionCount: 1, transitionCount: 0, images: report.images,
          width: report.artboard.width, height: report.artboard.height,
          estimatedDecodeBytes: 4 * 64 * 64 * 4,
          size: readFileSync(report.out).byteLength,
        },
      });
      const edge = edgeTo(dir, id);
      expect(edge.fromAssetId).toBe("bounce-frame-00");
      expect(edge.operation.params).toEqual({
        tool: "sprite-sheet.mjs", step: "rive", images: report.images, motions: ["bounce"],
        sampled: [{ motion: "bounce", frames: 4, fps: 8, width: 64, height: 64 }],
        // What drives the file: bounce loops, so the number names it.
        stateMachine: {
          name: "State Machine 1",
          hub: "bounce",
          number: { name: "motion", default: 0, values: [{ value: 0, motion: "bounce" }] },
          triggers: [],
        },
        inputs: BOUNCE_FRAMES,
      });
      expect(readProject(dir).sprite.exports).toEqual({ riv: id });
    }, EXPORT_TIMEOUT_MS);

    /** `seedReady` plus the `flame` loop from the fixture, registered. */
    function withFlame() {
      const seeded = seedReady();
      const { dir } = seeded;
      cpSync(LOOP_FIXTURE, join(dir, "motions", "flame"), { recursive: true });
      projectJson(dir, "add-motion", "--id", "flame", "--label", "Flame", "--kind", "loop", "--fps", "12");
      projectJson(dir, "set-motion", "--motion", "flame", "--brief-duration", "1", "--brief-width", "64",
        "--brief-interpolator", "none");
      projectJson(dir, "add-video", "--motion", "flame", "--file", "motions/flame/video-seedance-1.mp4",
        "--model", "seedance-2.5", "--mode", "first-last", "--status", "ready");
      const loopRun = readFileSync(join(LOOP_FIXTURE, "run.json"), "utf-8");
      const r = run(PROJECT, ["register-run", "--dir", dir, "--motion", "flame", "--run", "-", "--json"], loopRun);
      if (r.code !== 0) throw new Error(r.err);
      return { ...seeded, loopRun };
    }

    test("a resampled loop goes into the .riv: made from all its frames, recorded at the rate it plays", () => {
      const { dir } = withFlame();
      const report = sheetJson("rive", dir, "--motions", "flame,bounce", "--fps", "6", "--max-size", "36");
      const r = register(dir, report);
      expect(r.code).toBe(0);
      const id = `${basename(dir)}-export-riv`;
      // `frames` is what the file embeds — 6 of flame's 12 and 3 of bounce's
      // 4 at 6 fps — and the edge hangs off every frame it was made FROM.
      expect(asset(dir, id).metadata).toMatchObject({ frames: 6 + 3, motionCount: 2 });
      const flameFrames = motionOf(dir, "flame").frames;
      const edge = edgeTo(dir, id);
      expect(edge.fromAssetId).toBe(flameFrames[0]);
      expect(edge.operation.params.inputs).toEqual([...flameFrames, ...BOUNCE_FRAMES]);
      expect(edge.operation.params.motions).toEqual(["flame", "bounce"]);
      expect(edge.operation.params.sampled).toEqual([
        { motion: "flame", frames: 6, fps: 6, width: 32, height: 36 },
        { motion: "bounce", frames: 3, fps: 6, width: 36, height: 36 },
      ]);
    }, EXPORT_TIMEOUT_MS);

    test("a loop's measured clip scale and place go onto the motion, where the viewer reads them", () => {
      // A loop cut before `loop` recorded its crop is measured by `rive` off
      // the clip. The Export tab cannot decode a clip, so without this record
      // it quoted the frames as cut while the file held them divided back to
      // the clip's scale — two numbers for one file.
      const { dir, loopRun } = withFlame();
      const report = sheetJson("rive", dir, "--include-loops");
      const flame = report.motions.find((m: any) => m.id === "flame");
      flame.clip = { scale: 1.25, origin: { x: 3, y: 4 }, from: "measured" };
      expect(register(dir, report).code).toBe(0);
      expect(motionOf(dir, "flame").clip).toEqual({ scale: 1.25, origin: { x: 3, y: 4 }, from: "measured" });

      // A clip scale the file could not learn is no record, and does not
      // erase one that is there.
      flame.clip = null;
      expect(register(dir, report).code).toBe(0);
      expect(motionOf(dir, "flame").clip).toEqual({ scale: 1.25, origin: { x: 3, y: 4 }, from: "measured" });

      // A new cut replaces the frames the measurement was of: it goes.
      const r = run(PROJECT, ["register-run", "--dir", dir, "--motion", "flame", "--run", "-", "--json"], loopRun);
      expect(r.code).toBe(0);
      expect("clip" in motionOf(dir, "flame")).toBe(false);
    }, EXPORT_TIMEOUT_MS);

    test("a recorded crop and scale win: a measured record is never written over them", () => {
      const { dir, loopRun } = withFlame();
      const summary = JSON.parse(loopRun);
      summary.inspect = { ...summary.inspect, crop: { x: 0, y: 0, w: 64, h: 72 }, scale: 1 };
      expect(run(PROJECT, ["register-run", "--dir", dir, "--motion", "flame", "--run", "-", "--json"],
        JSON.stringify(summary)).code).toBe(0);
      const report = sheetJson("rive", dir, "--include-loops");
      report.motions.find((m: any) => m.id === "flame").clip = { scale: 2, origin: { x: 1, y: 1 }, from: "measured" };
      expect(register(dir, report).code).toBe(0);
      expect("clip" in motionOf(dir, "flame")).toBe(false);
    }, EXPORT_TIMEOUT_MS);

    test("a new cut of a loop retires the .riv that holds it", () => {
      const { dir, loopRun } = withFlame();
      expect(register(dir, sheetJson("rive", dir, "--include-loops")).code).toBe(0);
      const r = run(PROJECT, ["register-run", "--dir", dir, "--motion", "flame", "--run", "-", "--json"], loopRun);
      expect(r.code).toBe(0);
      expect(readProject(dir).sprite.exports).toBeUndefined();
      expect(r.err).toMatch(/retired .*-export-riv/);
    }, EXPORT_TIMEOUT_MS);

    test("new frames retire the exports cut from the old ones, and say so", () => {
      const { dir, realRun } = seedReady();
      register(dir, exportOf(dir, "bounce", "--format", "apng"));
      register(dir, sheetJson("rive", dir));
      const riv = `${basename(dir)}-export-riv`;

      const r = run(PROJECT, ["register-run", "--dir", dir, "--motion", "bounce", "--run", "-", "--json"],
        JSON.stringify(realRun));
      expect(r.code).toBe(0);
      // An export in project.json describes the frames that are registered
      // NOW; one cut from the previous frames would be offered as current.
      const doc = readProject(dir);
      expect(doc.assets.some((a: any) => a.id === "bounce-export-apng" || a.id === riv)).toBe(false);
      expect(doc.provenance.some((e: any) => e.toAssetId === "bounce-export-apng" || e.toAssetId === riv)).toBe(false);
      expect("exports" in motionOf(dir, "bounce")).toBe(false);
      expect("exports" in doc.sprite).toBe(false);
      expect(r.err).toMatch(/bounce-export-apng/);
      expect(r.err).toMatch(/re-export/);
      // The files are the user's; only the registration goes.
      expect(existsSync(join(dir, "motions", "bounce", "exports", "bounce.apng"))).toBe(true);
    }, EXPORT_TIMEOUT_MS);

    test("remove-motion takes its exports, and the .riv that holds it, along", () => {
      const { dir } = seedReady();
      register(dir, exportOf(dir, "bounce", "--format", "apng"));
      register(dir, sheetJson("rive", dir));
      const removed = projectJson(dir, "remove-motion", "--motion", "bounce");
      expect(removed.removedAssets).toContain("bounce-export-apng");
      expect(removed.removedAssets).toContain(`${basename(dir)}-export-riv`);
      expect(removed.orphanedPaths).toContain("motions/bounce/exports/bounce.apng");
      expect(readProject(dir).sprite.exports).toBeUndefined();
    }, EXPORT_TIMEOUT_MS);

    test("a report that does not describe this character's registered frames is refused", () => {
      const { dir } = seedReady();
      const report = exportOf(dir, "bounce", "--format", "apng");
      const before = readFileSync(join(dir, "project.json"), "utf-8");
      const cases: Array<[unknown, RegExp]> = [
        [{ ...report, frames: report.frames.slice(1) }, /not the frames registered/],
        [{ ...report, motion: "walk" }, /no motion 'walk'/],
        [{ ...report, format: "gif" }, /format/],
        [{ ...report, out: "/etc/hosts" }, /outside/],
        [{ ...report, kind: "run" }, /export or rive/],
      ];
      for (const [bad, message] of cases) {
        const r = register(dir, bad);
        expect(r.code).toBe(1);
        expect(r.err).toMatch(message);
      }
      // An export that failed prints nothing on stdout, so the pipe hands
      // this command an empty report — which must say where to look.
      const empty = run(PROJECT, ["register-export", "--dir", dir, "--report", "-", "--json"], "");
      expect(empty.code).toBe(1);
      expect(empty.err).toMatch(/empty.*export.*ERROR/);
      expect(readFileSync(join(dir, "project.json"), "utf-8")).toBe(before);
    }, EXPORT_TIMEOUT_MS);

    test("a loop keeps its own exports and gains the new ones beside them", () => {
      const { dir } = seedReady();
      cpSync(LOOP_FIXTURE, join(dir, "motions", "flame"), { recursive: true });
      projectJson(dir, "add-motion", "--id", "flame", "--label", "Flame", "--kind", "loop", "--fps", "12");
      projectJson(dir, "set-motion", "--motion", "flame", "--brief-duration", "1", "--brief-width", "64",
        "--brief-interpolator", "none");
      projectJson(dir, "add-video", "--motion", "flame", "--file", "motions/flame/video-seedance-1.mp4",
        "--model", "seedance-2.5", "--mode", "first-last", "--status", "ready");
      const loopRun = readFileSync(join(LOOP_FIXTURE, "run.json"), "utf-8");
      expect(run(PROJECT, ["register-run", "--dir", dir, "--motion", "flame", "--run", "-", "--json"], loopRun).code).toBe(0);

      // A 0.3.x loop: exports are the three the loop run wrote, by asset id.
      expect(motionOf(dir, "flame").exports).toEqual({ apng: "flame-apng", webm: "flame-webm", lottie: "flame-lottie" });
      expect(register(dir, exportOf(dir, "flame", "--format", "png-seq")).code).toBe(0);
      expect(motionOf(dir, "flame").exports).toEqual({
        apng: "flame-apng", webm: "flame-webm", lottie: "flame-lottie", "png-seq": "flame-export-png-seq",
      });
      // The loop's own WebM is not something an export may replace.
      const clash = register(dir, { ...exportOf(dir, "bounce", "--format", "webm"), motion: "flame" });
      expect(clash.code).toBe(1);
      expect(clash.err).toMatch(/flame already ships webm as flame-webm/);

      // A new cut of the loop keeps the loop's exports and retires the rest.
      expect(run(PROJECT, ["register-run", "--dir", dir, "--motion", "flame", "--run", "-", "--json"], loopRun).code).toBe(0);
      expect(motionOf(dir, "flame").exports).toEqual({ apng: "flame-apng", webm: "flame-webm", lottie: "flame-lottie" });
    }, EXPORT_TIMEOUT_MS);

    test("show says what a motion and the character have been exported as", () => {
      const { dir } = seedReady();
      register(dir, exportOf(dir, "bounce", "--format", "apng"));
      register(dir, sheetJson("rive", dir));
      expect(projectJson(dir, "show", "--motion", "bounce").exports).toEqual({ apng: "bounce-export-apng" });
      const summary = projectJson(dir, "show");
      expect(summary.exports).toEqual({ riv: `${basename(dir)}-export-riv` });
      const human = project(dir, "show");
      expect(human.out).toMatch(/exported: .*riv/);
      const single = project(dir, "show", "--motion", "bounce");
      expect(single.out).toMatch(/exports: apng/);
    }, EXPORT_TIMEOUT_MS);
  });

  describe("transitions", () => {
    /**
     * Two registered loops — `flame` and `ember`, both cut from the loop
     * fixture — with keyframes, so a transition between them has two ends
     * and two keyframes to grow out of.
     */
    function seedTwoLoops() {
      const { dir } = seedMini();
      for (const id of ["flame", "ember"]) {
        cpSync(LOOP_FIXTURE, join(dir, "motions", id), { recursive: true });
        projectJson(dir, "add-motion", "--id", id, "--label", id === "flame" ? "Flame" : "Ember", "--kind", "loop", "--fps", "12");
        projectJson(dir, "set-motion", "--motion", id, "--brief-duration", "1", "--brief-width", "64",
          "--brief-interpolator", "none");
        projectJson(dir, "set-keyframe", "--motion", id, "--file", `motions/${id}/keyframe.png`,
          "--alpha", `motions/${id}/keyframe-alpha.png`, "--status", "ready");
        projectJson(dir, "add-video", "--motion", id, "--file", `motions/${id}/video-seedance-1.mp4`,
          "--model", "seedance-2.5", "--mode", "first-last", "--status", "ready");
        const summary = readFileSync(join(LOOP_FIXTURE, "run.json"), "utf-8").replaceAll("motions/flame", `motions/${id}`);
        const r = run(PROJECT, ["register-run", "--dir", dir, "--motion", id, "--run", "-", "--json"], summary);
        if (r.code !== 0) throw new Error(r.err);
      }
      return dir;
    }

    /** A `transition --json` summary, shaped as `sprite-sheet.mjs` prints it,
     *  over the loop fixture's frames copied into the transition's folder. */
    function transitionRun(dir: string, id: string, from: string, to: string, extra: Record<string, unknown> = {}) {
      const frames = join(dir, "motions", id, "frames");
      mkdirSync(frames, { recursive: true });
      const paths = Array.from({ length: 6 }, (_, i) => {
        const name = `${String(i).padStart(3, "0")}.png`;
        cpSync(join(LOOP_FIXTURE, "frames", `${String(i * 2).padStart(3, "0")}.png`), join(frames, name));
        return `motions/${id}/frames/${name}`;
      });
      return {
        kind: "transition", source: "video", video: `motions/${id}/video-veed-2.webm`,
        from, to, motionDir: `motions/${id}`, name: id, frames: paths,
        sampledAt: [0, 0.2, 0.4, 0.6, 0.8, 1], fps: 6, duration: 1,
        cell: { width: 64, height: 72 }, crop: { x: 0, y: 0, w: 64, h: 72 }, scale: 1,
        inspect: {
          kind: "transition", frameCount: 6, cell: { width: 64, height: 72 }, crop: { x: 0, y: 0, w: 64, h: 72 },
          scale: 1, fps: 6, step: 0.05, startGap: 0.02, endGap: 0.3, alphaCoverage: 0.3, emptyFrames: [],
          warnings: ["the end does not land: 0.3 from ember's frame 0 against a step of 0.05"],
        },
        warnings: [],
        ...extra,
      };
    }
    const registerTransition = (dir: string, motion: string, summary: unknown) =>
      run(PROJECT, ["register-run", "--dir", dir, "--motion", motion, "--run", "-", "--json"], JSON.stringify(summary));

    test("add-motion --kind transition joins two loops, named after them", () => {
      const dir = seedTwoLoops();
      const motion = projectJson(dir, "add-motion", "--kind", "transition", "--from", "flame", "--to", "ember");
      expect(motion).toMatchObject({
        id: "flame-to-ember", kind: "transition", from: "flame", to: "ember", label: "Flame → Ember",
        loop: false, grid: { rows: 1, cols: 1 }, source: "video", status: "planned",
      });
      // A transition plays at the take's rate unless told otherwise.
      expect(motion.fps).toBe(24);
    });

    test("add-motion --kind transition refuses a pair it cannot join, by name", () => {
      const dir = seedTwoLoops();
      projectJson(dir, "add-motion", "--kind", "transition", "--from", "flame", "--to", "ember");
      const cases: Array<[string[], RegExp]> = [
        [["--from", "flame"], /--to/],
        [["--from", "smoke", "--to", "ember"], /no motion 'smoke'/],
        [["--from", "flame", "--to", "flame"], /flame.*itself/],
        [["--from", "flame", "--to", "ember", "--id", "again"], /flame-to-ember already goes from flame to ember/],
        [["--from", "bounce", "--to", "ember"], /'bounce' is not a loop/],
      ];
      for (const [flags, message] of cases) {
        const r = run(PROJECT, ["add-motion", "--dir", dir, "--kind", "transition", ...flags, "--json"]);
        expect({ flags, code: r.code, matches: message.test(r.err) }).toEqual({ flags, code: 1, matches: true });
      }
      // The reverse pair is a different transition.
      expect(projectJson(dir, "add-motion", "--kind", "transition", "--from", "ember", "--to", "flame").id).toBe("ember-to-flame");
    });

    test("its brief is the playback length and the budget; its clip grows out of both keyframes", () => {
      const dir = seedTwoLoops();
      projectJson(dir, "add-motion", "--kind", "transition", "--from", "flame", "--to", "ember");
      const noBrief = run(PROJECT, ["add-video", "--dir", dir, "--motion", "flame-to-ember", "--file",
        "motions/flame/video-seedance-1.mp4", "--model", "seedance-2.5", "--mode", "first-last", "--json"]);
      expect(noBrief.code).toBe(1);
      expect(noBrief.err).toMatch(/transition 'flame-to-ember' has no brief.*--brief-duration.*--brief-budget/);

      const half = run(PROJECT, ["set-motion", "--dir", dir, "--motion", "flame-to-ember", "--brief-duration", "1.2", "--json"]);
      expect(half.code).toBe(1);
      expect(half.err).toMatch(/--brief-budget/);
      const loopOnly = run(PROJECT, ["set-motion", "--dir", dir, "--motion", "flame-to-ember", "--brief-width", "64", "--json"]);
      expect(loopOnly.code).toBe(1);
      expect(loopOnly.err).toMatch(/--brief-width.*loop/);

      const briefed = projectJson(dir, "set-motion", "--motion", "flame-to-ember", "--brief-duration", "1.2", "--brief-budget", "1.5");
      expect(briefed.brief).toMatchObject({ duration: 1.2, budgetUsd: 1.5 });

      mkdirSync(join(dir, "motions", "flame-to-ember"), { recursive: true });
      cpSync(join(dir, "motions", "flame", "video-seedance-1.mp4"), join(dir, "motions", "flame-to-ember", "video-seedance-1.mp4"));
      projectJson(dir, "add-video", "--motion", "flame-to-ember", "--file", "motions/flame-to-ember/video-seedance-1.mp4",
        "--model", "seedance-2.5", "--mode", "first-last", "--from", "flame-keyframe-alpha,ember-keyframe-alpha",
        "--status", "ready");
      const edge = readProject(dir).provenance.find((e: any) => e.toAssetId === "flame-to-ember-video-1");
      expect(edge.fromAssetId).toBe("flame-keyframe-alpha");
      expect(edge.operation.params.inputs).toEqual(["flame-keyframe-alpha", "ember-keyframe-alpha"]);
    });

    test("register-run takes a transition's frames, its crop and its gaps, and no exports", () => {
      const dir = seedTwoLoops();
      projectJson(dir, "add-motion", "--kind", "transition", "--from", "flame", "--to", "ember");
      projectJson(dir, "set-motion", "--motion", "flame-to-ember", "--brief-duration", "1", "--brief-budget", "1.2");
      mkdirSync(join(dir, "motions", "flame-to-ember"), { recursive: true });
      cpSync(join(dir, "motions", "flame", "video-seedance-1.mp4"), join(dir, "motions", "flame-to-ember", "video-veed-2.webm"));
      projectJson(dir, "add-video", "--motion", "flame-to-ember", "--file", "motions/flame-to-ember/video-veed-2.webm",
        "--model", "seedance-2.5", "--mode", "first-last", "--status", "ready");

      // The ends the summary claims must be the motion's.
      const wrongEnds = registerTransition(dir, "flame-to-ember", transitionRun(dir, "flame-to-ember", "ember", "flame"));
      expect(wrongEnds.code).toBe(1);
      expect(wrongEnds.err).toMatch(/goes from ember to flame.*flame-to-ember goes from flame to ember/);
      const onLoop = registerTransition(dir, "flame", transitionRun(dir, "flame-to-ember", "flame", "ember"));
      expect(onLoop.code).toBe(1);
      expect(onLoop.err).toMatch(/'flame' is not a transition/);

      const r = registerTransition(dir, "flame-to-ember", transitionRun(dir, "flame-to-ember", "flame", "ember"));
      expect(r.code).toBe(0);
      const motion = JSON.parse(r.out);
      expect(motion).toMatchObject({
        kind: "transition", from: "flame", to: "ember", loop: false, fps: 6, status: "ready",
        frames: Array.from({ length: 6 }, (_, i) => `flame-to-ember-frame-${String(i).padStart(3, "0")}`),
      });
      expect(motion.inspect).toMatchObject({ startGap: 0.02, endGap: 0.3, step: 0.05, scale: 1, crop: { x: 0, y: 0, w: 64, h: 72 } });
      expect(motion.inspect.warnings[0]).toMatch(/does not land/);
      expect("exports" in motion).toBe(false);
      const edge = readProject(dir).provenance.find((e: any) => e.toAssetId === "flame-to-ember-frame-005");
      expect(edge.fromAssetId).toBe("flame-to-ember-video-1");
      expect(edge.operation.params).toMatchObject({ step: "from-video", frameIndex: 5, t: 1 });
    });

    test("a reverse is registered with its source, and each frame derives from the source frame it plays", () => {
      const dir = seedTwoLoops();
      projectJson(dir, "add-motion", "--kind", "transition", "--from", "flame", "--to", "ember");
      projectJson(dir, "set-motion", "--motion", "flame-to-ember", "--brief-duration", "1", "--brief-budget", "1.2");
      mkdirSync(join(dir, "motions", "flame-to-ember"), { recursive: true });
      cpSync(join(dir, "motions", "flame", "video-seedance-1.mp4"), join(dir, "motions", "flame-to-ember", "video-veed-2.webm"));
      projectJson(dir, "add-video", "--motion", "flame-to-ember", "--file", "motions/flame-to-ember/video-veed-2.webm",
        "--model", "seedance-2.5", "--mode", "first-last", "--status", "ready");
      expect(registerTransition(dir, "flame-to-ember", transitionRun(dir, "flame-to-ember", "flame", "ember")).code).toBe(0);

      projectJson(dir, "add-motion", "--kind", "transition", "--from", "ember", "--to", "flame");
      const reverse = transitionRun(dir, "ember-to-flame", "ember", "flame", {
        source: "reverse", reverseOf: "flame-to-ember", video: undefined, sampledAt: undefined,
      });
      // Only a transition with the ends swapped can be played backwards into this one.
      const wrong = registerTransition(dir, "ember-to-flame", { ...reverse, reverseOf: "flame" });
      expect(wrong.code).toBe(1);
      expect(wrong.err).toMatch(/reverseOf.*'flame' is not a transition/);

      const r = registerTransition(dir, "ember-to-flame", reverse);
      expect(r.code).toBe(0);
      const motion = JSON.parse(r.out);
      expect(motion).toMatchObject({ kind: "transition", from: "ember", to: "flame", reverseOf: "flame-to-ember", status: "ready" });
      // Needs no brief and no clip: it cost nothing.
      expect(motion.videos).toEqual([]);
      const doc = readProject(dir);
      const first = doc.provenance.find((e: any) => e.toAssetId === "ember-to-flame-frame-000");
      expect(first.fromAssetId).toBe("flame-to-ember-frame-005");
      expect(first.operation.params).toMatchObject({ step: "reverse", frameIndex: 0, sourceFrame: 5 });
      const last = doc.provenance.find((e: any) => e.toAssetId === "ember-to-flame-frame-005");
      expect(last.fromAssetId).toBe("flame-to-ember-frame-000");
    });

    test("a new cut of a transition retires the .riv holding it, and says its reverse is stale", () => {
      const dir = seedTwoLoops();
      projectJson(dir, "add-motion", "--kind", "transition", "--from", "flame", "--to", "ember");
      projectJson(dir, "set-motion", "--motion", "flame-to-ember", "--brief-duration", "1", "--brief-budget", "1.2");
      mkdirSync(join(dir, "motions", "flame-to-ember"), { recursive: true });
      cpSync(join(dir, "motions", "flame", "video-seedance-1.mp4"), join(dir, "motions", "flame-to-ember", "video-veed-2.webm"));
      projectJson(dir, "add-video", "--motion", "flame-to-ember", "--file", "motions/flame-to-ember/video-veed-2.webm",
        "--model", "seedance-2.5", "--mode", "first-last", "--status", "ready");
      const cut = transitionRun(dir, "flame-to-ember", "flame", "ember");
      expect(registerTransition(dir, "flame-to-ember", cut).code).toBe(0);
      projectJson(dir, "add-motion", "--kind", "transition", "--from", "ember", "--to", "flame");
      expect(registerTransition(dir, "ember-to-flame", transitionRun(dir, "ember-to-flame", "ember", "flame", {
        source: "reverse", reverseOf: "flame-to-ember", video: undefined,
      })).code).toBe(0);

      // A .riv that holds the transition, registered as the rive step would.
      const doc = readProject(dir);
      const rivFrames = doc.sprite.motions.find((m: any) => m.id === "flame-to-ember").frames;
      doc.assets.push({ id: `${basename(dir)}-export-riv`, type: "image", uri: "exports/x.riv", name: "x", metadata: {}, createdAt: 1, status: "ready" });
      doc.provenance.push({ toAssetId: `${basename(dir)}-export-riv`, fromAssetId: rivFrames[0], operation: { type: "derive", actor: "agent", timestamp: 1, params: { step: "rive", motions: ["flame", "ember", "flame-to-ember"] } } });
      doc.sprite.exports = { riv: `${basename(dir)}-export-riv` };
      writeFileSync(join(dir, "project.json"), JSON.stringify(doc));

      const r = registerTransition(dir, "flame-to-ember", cut);
      expect(r.code).toBe(0);
      expect(readProject(dir).sprite.exports).toBeUndefined();
      expect(r.err).toMatch(/retired .*-export-riv/);
      expect(r.err).toMatch(/ember-to-flame plays the frames this run replaced.*--reverse-of flame-to-ember/);
    });

    test("a loop a transition joins cannot be removed from under it", () => {
      const dir = seedTwoLoops();
      projectJson(dir, "add-motion", "--kind", "transition", "--from", "flame", "--to", "ember");
      const r = run(PROJECT, ["remove-motion", "--dir", dir, "--motion", "ember", "--json"]);
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/flame-to-ember.*remove it first/);
      projectJson(dir, "remove-motion", "--motion", "flame-to-ember");
      projectJson(dir, "remove-motion", "--motion", "ember");
    });
  });

  test("cleanup", () => {
    templates.clear();
    for (const dir of workspaces.splice(0)) rmSync(dir, { recursive: true, force: true });
    expect(workspaces).toHaveLength(0);
  });
});

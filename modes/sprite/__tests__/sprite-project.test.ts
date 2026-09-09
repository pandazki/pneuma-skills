/**
 * sprite-project.mjs — the only writer of a character's `project.json`,
 * pinned as a real process.
 *
 * The spine of the suite is a round trip: `init → add-ref → add-motion →
 * set-sheet → register-run` must reproduce the design spec's canonical
 * fixture (see `fixtures/pipeline/README.md` for the two deliberate
 * differences). Asset metadata comes from ffprobe, so the whole file skips
 * with a named reason when ffmpeg is missing.
 */

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
 * The canonical `mini` character: real files on disk (so ffprobe reports the
 * fixture's dimensions) produced by the real sheet pipeline, plus the command
 * sequence up to but not including `register-run`.
 */
function seedMini() {
  const dir = fresh();
  buildSheet(join(dir, "refs", "portrait.png"), { cell: 256, rows: 1, cols: 1 });
  const raw = buildSheet(join(dir, "raw.png"));
  const sheetRun = run(SHEET, [
    "run", raw, "--rows", "2", "--cols", "2",
    "--out", join(dir, "motions", "bounce"),
    "--name", "bounce", "--fps", "8", "--loop", "--cell", "64x64", "--no-webp", "--json",
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

  return { dir, realRun: JSON.parse(sheetRun.out) };
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
  });

  describe("round trip", () => {
    test("init → add-ref → add-motion → set-sheet → register-run reproduces the canonical fixture", () => {
      const { dir } = seedMini();
      projectJson(dir, "register-run", "--motion", "bounce",
        "--run", join(FIXTURES, "bounce-run.json"), "--at", String(T2));

      const expected = JSON.parse(readFileSync(join(FIXTURES, "expected-project.json"), "utf-8"));
      expect(readProject(dir)).toEqual(expected);
    });

    test("the write is atomic — no .tmp litter survives", () => {
      const { dir } = seedMini();
      projectJson(dir, "register-run", "--motion", "bounce",
        "--run", join(FIXTURES, "bounce-run.json"), "--at", String(T2));
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
        anchorDrift: { x: 0, y: 0 },
        maxJump: 0,
        scaleDrift: 0,
        emptyFrames: [],
        warnings: [],
      });
      // absolute paths from a real run become workspace-relative uris
      const doc = readProject(dir);
      expect(doc.assets.find((a: any) => a.id === "bounce-frame-00").uri).toBe("motions/bounce/frames/00.png");
    });

    test("a run summary pointing outside the character dir is refused", () => {
      const { dir, realRun } = seedMini();
      const r = run(PROJECT, ["register-run", "--dir", dir, "--motion", "bounce", "--run", "-", "--json"],
        JSON.stringify({ ...realRun, gif: "/etc/hosts" }));
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/outside/);
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

    test("lists every input on a multi-reference sheet, first one as the edge parent", () => {
      const { dir } = seedMini();
      buildSheet(join(dir, "refs", "turnaround.png"), { cell: 256, rows: 1, cols: 1 });
      projectJson(dir, "add-ref", "--id", "turnaround", "--file", "refs/turnaround.png", "--role", "turnaround");
      projectJson(dir, "set-sheet", "--motion", "bounce", "--file", "motions/bounce/sheet-raw.png",
        "--from", "ref-portrait,ref-turnaround", "--at", String(T2));
      const edge = readProject(dir).provenance.find((e: any) => e.toAssetId === "bounce-sheet-raw");
      expect(edge.fromAssetId).toBe("ref-portrait");
      expect(edge.operation.params.inputs).toEqual(["ref-portrait", "ref-turnaround"]);
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
    for (const dir of workspaces.splice(0)) rmSync(dir, { recursive: true, force: true });
    expect(workspaces).toHaveLength(0);
  });
});

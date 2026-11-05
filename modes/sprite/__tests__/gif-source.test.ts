/**
 * The GIF frame source: `sprite-sheet.mjs from-gif`, the clip commands'
 * refusal of a GIF, and the registration sequence `sprite-project.mjs
 * set-gif` (reserve → land | fail) → `from-gif` → `register-run`.
 *
 * The fixture GIF is drawn by ffmpeg at test time: twelve frames of a box
 * walking right 5 px a frame on a transparent canvas, 90 ms each. ffmpeg's GIF
 * encoder stores every frame after the first as a sub-rectangle with
 * disposal, so the decode has to composite, and ffprobe reads this file's
 * frame rate as 89/4 (22.25 fps) — the same misreading the 2026-11-05 GPT
 * Image 2.6 GIF got, which made `from-video` sample one drawing seven times.
 *
 * Media tier: ffmpeg/ffprobe, gated like the rest of this mode's pipeline
 * suites; every fixture is built in `beforeAll`.
 */

import { announceMediaTierSkip, mediaTierEnabled } from "../../../core/__tests__/test-tier.js";
import { beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SHEET = join(import.meta.dir, "..", "skill", "scripts", "sprite-sheet.mjs");
const PROJECT = join(import.meta.dir, "..", "skill", "scripts", "sprite-project.mjs");

const MEDIA_TIER = mediaTierEnabled("sprite");
announceMediaTierSkip("sprite", "sprite GIF source tests");
const HAS_FFMPEG = MEDIA_TIER &&
  spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0 &&
  spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0;
if (MEDIA_TIER && !HAS_FFMPEG) console.warn("(skip) modes/sprite GIF source suite — ffmpeg/ffprobe not on PATH");

const FRAMES = 12;
const W = 112;
const H = 96;

function sh(args: string[]) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { encoding: "utf-8" });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);
}

/** Leftmost and rightmost opaque column of an RGBA image file, and its alpha values. */
function columns(path: string) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", path, "-f", "rawvideo", "-pix_fmt", "rgba", "-"], { maxBuffer: 64 * 1024 * 1024 });
  const b = r.stdout as Buffer;
  const width = Number(spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=width", "-of", "csv=p=0", path], { encoding: "utf-8" }).stdout.trim());
  let min = Infinity;
  let max = -Infinity;
  const alphas = new Set<number>();
  for (let p = 3; p < b.length; p += 4) {
    alphas.add(b[p]);
    if (b[p] >= 128) {
      const x = ((p - 3) / 4) % width;
      min = Math.min(min, x);
      max = Math.max(max, x);
    }
  }
  return { min, max, alphas: [...alphas].sort((a, z) => a - z) };
}

let root = "";
let gif = "";
let opaqueGif = "";
let sourceMinX: number[] = [];

beforeAll(() => {
  if (!HAS_FFMPEG) return;
  root = mkdtempSync(join(tmpdir(), "sprite-gif-"));
  const src = join(root, "src");
  mkdirSync(src);
  for (let i = 0; i < FRAMES; i++) {
    const x = 8 + i * 5;
    sh([
      "-f", "lavfi", "-i", `color=c=0x00000000:s=${W}x${H},format=rgba`,
      "-f", "lavfi", "-i", "color=c=0xd03030:s=24x72,format=rgba",
      "-f", "lavfi", "-i", "color=c=0x203080:s=16x16,format=rgba",
      "-filter_complex", `[0][1]overlay=x=${x}:y=16[a];[a][2]overlay=x=${x + 4}:y=20,format=rgba`,
      "-frames:v", "1", join(src, `${String(i).padStart(2, "0")}.png`),
    ]);
  }
  sourceMinX = Array.from({ length: FRAMES }, (_, i) => columns(join(src, `${String(i).padStart(2, "0")}.png`)).min);
  gif = join(root, "walk.gif");
  sh(["-framerate", "100/9", "-i", join(src, "%02d.png"),
    "-filter_complex", "split[a][b];[a]palettegen=reserve_transparent=1[p];[b][p]paletteuse=alpha_threshold=128", gif]);
  opaqueGif = join(root, "opaque.gif");
  sh(["-framerate", "10", "-i", join(src, "%02d.png"), "-vf", "format=rgb24,split[a][b];[a]palettegen[p];[b][p]paletteuse", opaqueGif]);
});

function run(script: string, argv: string[], stdin?: string, cwd = import.meta.dir) {
  const r = Bun.spawnSync([process.execPath, script, ...argv], {
    cwd,
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
}

describe.skipIf(!HAS_FFMPEG)("sprite-sheet.mjs from-gif", () => {
  test("the fixture reproduces the misread: ffprobe guesses 89/4 fps for a 90 ms GIF", () => {
    const rate = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate", "-of", "csv=p=0", gif], { encoding: "utf-8" });
    expect(rate.stdout.trim()).toBe("89/4");
  });

  test("every frame once, in order, with its own 1-bit alpha; the rate is the GIF's own", () => {
    const out = join(root, "m-every");
    const r = run(SHEET, ["from-gif", gif, "--out", out, "--name", "walk", "--loop", "--json"]);
    expect(r.code).toBe(0);
    const summary = JSON.parse(r.out);
    expect(summary.source).toBe("gif");
    expect(summary.sourceGif).toBe(gif);
    expect(summary.gif).toBe(join(out, "preview.gif"));
    expect(summary.frameCount).toBe(FRAMES);
    expect(summary.frames).toHaveLength(FRAMES);
    expect(summary.delaysMs).toEqual(Array(FRAMES).fill(90));
    expect(summary.fps).toBe(11.111);
    expect(summary.duration).toBe(1.08);
    expect(summary.keyed).toBe(false);
    // The drawn placement is kept: the GIF's frames share one canvas.
    expect(summary.xFrom).toBe("cell");
    // Each cell is the GIF's frame i, composited from its sub-rectangle.
    for (let i = 0; i < FRAMES; i++) {
      const cell = columns(join(out, "cells", `${String(i).padStart(2, "0")}.png`));
      expect(cell.min).toBe(sourceMinX[i]);
      expect(cell.alphas).toEqual([0, 255]);
    }
    const atlas = JSON.parse(readFileSync(summary.atlas, "utf-8"));
    expect(Object.keys(atlas.frames)).toHaveLength(FRAMES);
  });

  test("--fps overrides the GIF's rate; the frames stay all of them", () => {
    const summary = JSON.parse(run(SHEET, ["from-gif", gif, "--out", join(root, "m-fps"), "--name", "walk", "--fps", "6", "--json"]).out);
    expect(summary.fps).toBe(6);
    expect(summary.frameCount).toBe(FRAMES);
  });

  test("a GIF with no transparent background is refused, not keyed", () => {
    const r = run(SHEET, ["from-gif", opaqueGif, "--out", join(root, "m-opaque"), "--name", "walk"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("no transparent background");
  });

  test("every clip command refuses a GIF and points to from-gif", () => {
    const cases: string[][] = [
      ["from-video", gif, "--out", join(root, "v"), "--name", "v", "--frames", "12"],
      ["from-video", gif, "--out", join(root, "v"), "--name", "v", "--at", "0,0.495,0.99"],
      ["contact", gif, "--out", join(root, "contact.png")],
      ["loop", gif, "--out", join(root, "l"), "--name", "l"],
      ["retime", gif, "--keep", "0-5", "--out", join(root, "r.mp4")],
    ];
    for (const argv of cases) {
      const r = run(SHEET, argv);
      expect(r.code).toBe(1);
      expect(r.err).toContain("is a GIF");
      expect(r.err).toContain("from-gif");
    }
    // A video named .gif is still a video, and a GIF named .mp4 still a GIF.
    const disguised = join(root, "walk.mp4");
    copyFileSync(gif, disguised);
    expect(run(SHEET, ["from-video", disguised, "--out", join(root, "v2"), "--name", "v", "--frames", "4"]).err).toContain("is a GIF");
  });
});

describe.skipIf(!HAS_FFMPEG)("set-gif → from-gif → register-run", () => {
  /** A character with one reference and a planned GIF motion, in a workspace. */
  function workspace() {
    const ws = mkdtempSync(join(tmpdir(), "sprite-gif-ws-"));
    const dir = join(ws, "blob");
    const ok = (r: ReturnType<typeof run>) => {
      if (r.code !== 0) throw new Error(r.err);
      return r;
    };
    ok(run(PROJECT, ["init", "--dir", dir, "--name", "Blob", "--style", "Flat vector blob, thick outline", "--description", "A red box.", "--cell", "64x64"]));
    mkdirSync(join(dir, "refs"), { recursive: true });
    cpSync(join(root, "src", "00.png"), join(dir, "refs", "turnaround.png"));
    ok(run(PROJECT, ["add-ref", "--dir", dir, "--id", "turnaround", "--file", "refs/turnaround.png", "--role", "turnaround", "--model", "openai/gpt-image-2.6-flare", "--prompt", "a red box"]));
    ok(run(PROJECT, ["add-motion", "--dir", dir, "--id", "walk", "--label", "Walk", "--source", "gif", "--fps", "11", "--loop"]));
    ok(run(PROJECT, ["gif-prompt", "--dir", dir, "--motion", "walk", "--action", "The box steps right.", "--frames", String(FRAMES)]));
    return { ws, dir };
  }
  const read = (dir: string) => JSON.parse(readFileSync(join(dir, "project.json"), "utf-8"));
  const reserve = (ws: string) => run(PROJECT, ["set-gif", "--dir", "blob", "--motion", "walk", "--status", "generating",
    "--file", "motions/walk/gif-raw.gif", "--from", "ref-turnaround", "--model", "openai/gpt-image-2.6-flare", "--prompt", "the recorded prompt"], undefined, ws);
  /** What generate_gif.mjs prints with --json, for the GIF it wrote. */
  const report = (frames = FRAMES) => JSON.stringify({
    backend: "fal", model: "openai/gpt-image-2.6-flare", endpoint: "https://fal.run/openai/gpt-image-2.6/flare/edit",
    requestId: "req-gif-7", files: ["blob/motions/walk/gif-raw.gif"], frameCount: frames, frameDurationMs: 90,
  });
  const land = (ws: string, frames = FRAMES) => {
    mkdirSync(join(ws, "blob", "motions", "walk"), { recursive: true });
    copyFileSync(gif, join(ws, "blob", "motions", "walk", "gif-raw.gif"));
    return run(PROJECT, ["set-gif", "--dir", "blob", "--motion", "walk", "--report", "-"], report(frames), ws);
  };

  test("the GIF is recorded before the call, landed with its request, and every frame hangs off it", () => {
    const { ws, dir } = workspace();
    expect(reserve(ws).code).toBe(0);
    let doc = read(dir);
    expect(doc.assets.find((a: { id: string }) => a.id === "walk-gif-raw")).toMatchObject({ status: "generating", uri: "motions/walk/gif-raw.gif", metadata: {} });
    expect(doc.sprite.motions[0]).toMatchObject({ status: "generating", gifRaw: "walk-gif-raw" });

    // Frames cut before the GIF landed have nothing on record to come from.
    mkdirSync(join(dir, "motions", "walk"), { recursive: true });
    copyFileSync(gif, join(dir, "motions", "walk", "gif-raw.gif"));
    const early = run(SHEET, ["from-gif", "blob/motions/walk/gif-raw.gif", "--out", "blob/motions/walk", "--name", "walk", "--loop", "--json"], undefined, ws);
    expect(run(PROJECT, ["register-run", "--dir", "blob", "--motion", "walk", "--run", "-"], early.out, ws).err).toContain("land it first");

    const landed = land(ws);
    expect(landed.code).toBe(0);
    doc = read(dir);
    const asset = doc.assets.find((a: { id: string }) => a.id === "walk-gif-raw");
    expect(asset).toMatchObject({ status: "ready", metadata: { width: W, height: H, frames: FRAMES, frameDurationMs: 90, duration: 1.08 } });
    const gifEdge = doc.provenance.find((e: { toAssetId: string }) => e.toAssetId === "walk-gif-raw");
    expect(gifEdge.fromAssetId).toBe("ref-turnaround");
    expect(gifEdge.operation).toMatchObject({ type: "generate", params: { model: "openai/gpt-image-2.6-flare", prompt: "the recorded prompt", provider: "fal", requestId: "req-gif-7" } });
    expect(doc.sprite.motions[0].status).toBe("processing");

    const cut = run(SHEET, ["from-gif", "blob/motions/walk/gif-raw.gif", "--out", "blob/motions/walk", "--name", "walk", "--loop", "--json"], undefined, ws);
    expect(cut.code).toBe(0);
    const registered = run(PROJECT, ["register-run", "--dir", "blob", "--motion", "walk", "--run", "-"], cut.out, ws);
    expect(registered.code).toBe(0);
    doc = read(dir);
    const motion = doc.sprite.motions[0];
    expect(motion).toMatchObject({ source: "gif", status: "ready", fps: 11.111, grid: { rows: 3, cols: 4 }, gifRaw: "walk-gif-raw" });
    expect(motion.frames).toHaveLength(FRAMES);
    expect(motion.promptParts.builder).toBe("gif-prompt/1");
    for (let i = 0; i < FRAMES; i++) {
      const frameEdge = doc.provenance.find((e: { toAssetId: string }) => e.toAssetId === `walk-frame-${String(i).padStart(2, "0")}`);
      expect(frameEdge.fromAssetId).toBe("walk-gif-raw");
      expect(frameEdge.operation.params).toEqual({ tool: "sprite-sheet.mjs", step: "from-gif", frameIndex: i });
    }
    const shown = run(PROJECT, ["show", "--dir", "blob", "--motion", "walk"], undefined, ws).out;
    expect(shown).toContain("GIF walk-gif-raw (motions/walk/gif-raw.gif) — ready, 12 frames × 90 ms");
    expect(shown).toContain("request req-gif-7");
    expect(JSON.parse(run(PROJECT, ["show", "--dir", "blob", "--json"], undefined, ws).out).motions[0].source).toBe("gif");

    // remove-motion takes the GIF with it.
    const removed = JSON.parse(run(PROJECT, ["remove-motion", "--dir", "blob", "--motion", "walk", "--json"], undefined, ws).out);
    expect(removed.removedAssets).toContain("walk-gif-raw");
  });

  test("landing is refused without a reservation, for another file, or for another frame count", () => {
    const { ws, dir } = workspace();
    const before = readFileSync(join(dir, "project.json"), "utf-8");
    expect(land(ws).err).toContain("reserve it BEFORE the paid call");
    expect(readFileSync(join(dir, "project.json"), "utf-8")).toBe(before);

    expect(reserve(ws).code).toBe(0);
    const short = land(ws, 9);
    expect(short.code).toBe(1);
    expect(short.err).toContain("--report says 9 frames but motions/walk/gif-raw.gif holds 12");
    const elsewhere = run(PROJECT, ["set-gif", "--dir", "blob", "--motion", "walk", "--report", "-"],
      report().replace("blob/motions/walk/gif-raw.gif", "blob/other.gif"), ws);
    expect(elsewhere.err).toContain("was reserved for motions/walk/gif-raw.gif");
  });

  test("a failed call is recorded with its reason and request, and has no frames to register", () => {
    const { ws, dir } = workspace();
    expect(reserve(ws).code).toBe(0);
    const failed = run(PROJECT, ["set-gif", "--dir", "blob", "--motion", "walk", "--status", "failed",
      "--notes", "fal downstream_service_error", "--request-id", "req-500"], undefined, ws);
    expect(failed.code).toBe(0);
    const doc = read(dir);
    expect(doc.assets.find((a: { id: string }) => a.id === "walk-gif-raw").status).toBe("failed");
    const params = doc.provenance.find((e: { toAssetId: string }) => e.toAssetId === "walk-gif-raw").operation.params;
    expect(params).toMatchObject({ model: "openai/gpt-image-2.6-flare", prompt: "the recorded prompt", requestId: "req-500" });
    expect(params.failure).toMatchObject({ reason: "fal downstream_service_error", billing: "unknown" });
    expect(doc.sprite.motions[0]).toMatchObject({ status: "failed", notes: "fal downstream_service_error" });

    // A new take reserves the same asset again.
    expect(reserve(ws).code).toBe(0);
    expect(read(dir).assets.find((a: { id: string }) => a.id === "walk-gif-raw").status).toBe("generating");
  });

  test("a GIF the user brought is an upload by the human", () => {
    const { ws, dir } = workspace();
    mkdirSync(join(dir, "motions", "walk"), { recursive: true });
    copyFileSync(gif, join(dir, "motions", "walk", "upload.gif"));
    expect(run(PROJECT, ["set-gif", "--dir", "blob", "--motion", "walk", "--uploaded", "--file", "motions/walk/upload.gif", "--model", "x"], undefined, ws).err)
      .toContain("was not generated here");
    expect(run(PROJECT, ["set-gif", "--dir", "blob", "--motion", "walk", "--uploaded", "--file", "motions/walk/upload.gif"], undefined, ws).code).toBe(0);
    const edge = read(dir).provenance.find((e: { toAssetId: string }) => e.toAssetId === "walk-gif-raw");
    expect(edge).toMatchObject({ fromAssetId: null, operation: { type: "upload", actor: "human" } });
  });
});

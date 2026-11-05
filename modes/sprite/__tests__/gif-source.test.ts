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
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

function run(script: string, argv: string[], stdin?: string, cwd = import.meta.dir, env?: Record<string, string | undefined>) {
  const r = Bun.spawnSync([process.execPath, script, ...argv], {
    cwd,
    ...(env ? { env } : {}),
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
    return { ws, dir };
  }
  const read = (dir: string) => JSON.parse(readFileSync(join(dir, "project.json"), "utf-8"));
  const assetOf = (dir: string, id: string) => read(dir).assets.find((a: { id: string }) => a.id === id);
  const edgeOf = (dir: string, id: string) => read(dir).provenance.find((e: { toAssetId: string }) => e.toAssetId === id);
  /** What gif-prompt prints as --output, from the workspace (where both commands run). */
  const nextOutput = (ws: string) => {
    const r = run(PROJECT, ["gif-prompt", "--dir", "blob", "--motion", "walk", "--action", "The box steps right.", "--frames", String(FRAMES), "--json"], undefined, ws);
    if (r.code !== 0) throw new Error(r.err);
    return JSON.parse(r.out).output as string;
  };
  /** The character-relative uri of a workspace path `blob/…`. */
  const uriOf = (path: string) => path.replace(/^blob\//, "");
  const reserve = (ws: string, file = "motions/walk/gif-raw-1.gif", extra: string[] = []) => run(PROJECT, ["set-gif", "--dir", "blob", "--motion", "walk", "--status", "generating",
    "--file", file, "--from", "ref-turnaround", "--model", "openai/gpt-image-2.6-flare", "--prompt", "the recorded prompt", ...extra], undefined, ws);
  /** What generate_gif.mjs prints with --json, for the GIF it wrote. */
  const report = (frames = FRAMES, file = "motions/walk/gif-raw-1.gif", requestId = "req-gif-7") => JSON.stringify({
    backend: "fal", model: "openai/gpt-image-2.6-flare", endpoint: "https://fal.run/openai/gpt-image-2.6/flare/edit",
    requestId, files: [`blob/${file}`], frameCount: frames, frameDurationMs: 90,
  });
  const land = (ws: string, frames = FRAMES, file = "motions/walk/gif-raw-1.gif", requestId = "req-gif-7") => {
    mkdirSync(join(ws, "blob", "motions", "walk"), { recursive: true });
    copyFileSync(gif, join(ws, "blob", file));
    return run(PROJECT, ["set-gif", "--dir", "blob", "--motion", "walk", "--report", "-"], report(frames, file, requestId), ws);
  };
  const cutAndRegister = (ws: string, file: string) => {
    const cut = run(SHEET, ["from-gif", `blob/${file}`, "--out", "blob/motions/walk", "--name", "walk", "--loop", "--json"], undefined, ws);
    if (cut.code !== 0) throw new Error(cut.err);
    return run(PROJECT, ["register-run", "--dir", "blob", "--motion", "walk", "--run", "-"], cut.out, ws);
  };
  const frameParents = (dir: string) => Array.from({ length: FRAMES }, (_, i) => edgeOf(dir, `walk-frame-${String(i).padStart(2, "0")}`)?.fromAssetId);

  test("the GIF is recorded before the call, landed with its request, and every frame hangs off it", () => {
    const { ws, dir } = workspace();
    expect(nextOutput(ws)).toBe("blob/motions/walk/gif-raw-1.gif");
    expect(reserve(ws).code).toBe(0);
    let doc = read(dir);
    expect(assetOf(dir, "walk-gif-raw-1")).toMatchObject({ status: "generating", uri: "motions/walk/gif-raw-1.gif", metadata: {} });
    expect(doc.sprite.motions[0]).toMatchObject({ status: "generating", gifRaw: "walk-gif-raw-1" });

    // Frames cut before the GIF landed have nothing on record to come from.
    mkdirSync(join(dir, "motions", "walk"), { recursive: true });
    copyFileSync(gif, join(dir, "motions", "walk", "gif-raw-1.gif"));
    const early = run(SHEET, ["from-gif", "blob/motions/walk/gif-raw-1.gif", "--out", "blob/motions/walk", "--name", "walk", "--loop", "--json"], undefined, ws);
    expect(run(PROJECT, ["register-run", "--dir", "blob", "--motion", "walk", "--run", "-"], early.out, ws).err).toContain("land it first");

    const landed = land(ws);
    expect(landed.code).toBe(0);
    doc = read(dir);
    expect(assetOf(dir, "walk-gif-raw-1")).toMatchObject({ status: "ready", metadata: { width: W, height: H, frames: FRAMES, frameDurationMs: 90, duration: 1.08 } });
    const gifEdge = edgeOf(dir, "walk-gif-raw-1");
    expect(gifEdge.fromAssetId).toBe("ref-turnaround");
    expect(gifEdge.operation).toMatchObject({ type: "generate", params: { model: "openai/gpt-image-2.6-flare", prompt: "the recorded prompt", provider: "fal", requestId: "req-gif-7" } });
    expect(doc.sprite.motions[0].status).toBe("processing");

    const registered = cutAndRegister(ws, "motions/walk/gif-raw-1.gif");
    expect(registered.code).toBe(0);
    doc = read(dir);
    const motion = doc.sprite.motions[0];
    expect(motion).toMatchObject({ source: "gif", status: "ready", fps: 11.111, grid: { rows: 3, cols: 4 }, gifRaw: "walk-gif-raw-1" });
    expect(motion.frames).toHaveLength(FRAMES);
    for (let i = 0; i < FRAMES; i++) {
      const frameEdge = edgeOf(dir, `walk-frame-${String(i).padStart(2, "0")}`);
      expect(frameEdge.fromAssetId).toBe("walk-gif-raw-1");
      expect(frameEdge.operation.params).toEqual({ tool: "sprite-sheet.mjs", step: "from-gif", frameIndex: i });
    }
    const shown = run(PROJECT, ["show", "--dir", "blob", "--motion", "walk"], undefined, ws).out;
    expect(shown).toContain("GIF walk-gif-raw-1 (motions/walk/gif-raw-1.gif) — ready, 12 frames × 90 ms");
    expect(shown).toContain("request req-gif-7");
    expect(JSON.parse(run(PROJECT, ["show", "--dir", "blob", "--json"], undefined, ws).out).motions[0].source).toBe("gif");
  });

  test("landing is refused without a reservation, for another file, or for another frame count", () => {
    const { ws, dir } = workspace();
    const before = readFileSync(join(dir, "project.json"), "utf-8");
    expect(land(ws).err).toContain("reserve it BEFORE the paid call");
    expect(readFileSync(join(dir, "project.json"), "utf-8")).toBe(before);
    rmSync(join(dir, "motions", "walk", "gif-raw-1.gif"));

    expect(reserve(ws).code).toBe(0);
    const short = land(ws, 9);
    expect(short.code).toBe(1);
    expect(short.err).toContain("--report says 9 frames but motions/walk/gif-raw-1.gif holds 12");
    const elsewhere = run(PROJECT, ["set-gif", "--dir", "blob", "--motion", "walk", "--report", "-"],
      report().replace("blob/motions/walk/gif-raw-1.gif", "blob/other.gif"), ws);
    expect(elsewhere.err).toContain("was reserved for motions/walk/gif-raw-1.gif");
  });

  test("a failed call is recorded with its reason and request, and has no frames to register", () => {
    const { ws, dir } = workspace();
    expect(reserve(ws).code).toBe(0);
    const failed = run(PROJECT, ["set-gif", "--dir", "blob", "--motion", "walk", "--status", "failed",
      "--notes", "fal downstream_service_error", "--request-id", "req-500"], undefined, ws);
    expect(failed.code).toBe(0);
    const doc = read(dir);
    expect(assetOf(dir, "walk-gif-raw-1").status).toBe("failed");
    const params = edgeOf(dir, "walk-gif-raw-1").operation.params;
    expect(params).toMatchObject({ model: "openai/gpt-image-2.6-flare", prompt: "the recorded prompt", requestId: "req-500" });
    expect(params.failure).toMatchObject({ reason: "fal downstream_service_error", billing: "unknown" });
    expect(doc.sprite.motions[0]).toMatchObject({ status: "failed", notes: "fal downstream_service_error" });
  });

  test("a retake is a new take: the earlier GIF, its request and the frames cut from it stay exactly as they were", () => {
    const { ws, dir } = workspace();
    // Take 1 lands and its frames are cut.
    expect(reserve(ws, uriOf(nextOutput(ws))).code).toBe(0);
    expect(land(ws).code).toBe(0);
    expect(cutAndRegister(ws, "motions/walk/gif-raw-1.gif").code).toBe(0);
    const take1 = { asset: assetOf(dir, "walk-gif-raw-1"), edge: edgeOf(dir, "walk-gif-raw-1") };

    // A retake names a new file: the printed path is free, the paid one stays.
    const second = uriOf(nextOutput(ws));
    expect(second).toBe("motions/walk/gif-raw-2.gif");
    const reuse = reserve(ws, "motions/walk/gif-raw-1.gif");
    expect(reuse.code).toBe(1);
    expect(reuse.err).toContain("motions/walk/gif-raw-2.gif");
    expect(reserve(ws, second).code).toBe(0);
    expect(read(dir).sprite.motions[0].gifRaw).toBe("walk-gif-raw-2");
    expect(assetOf(dir, "walk-gif-raw-2")).toMatchObject({ status: "generating", uri: second });
    // Take 1's record is untouched, and the frames still name it — not a
    // record that now describes take 2.
    expect(assetOf(dir, "walk-gif-raw-1")).toEqual(take1.asset);
    expect(edgeOf(dir, "walk-gif-raw-1")).toEqual(take1.edge);
    expect(frameParents(dir)).toEqual(Array(FRAMES).fill("walk-gif-raw-1"));

    // Take 2 fails; take 3 is reserved; take 2 keeps its request and failure.
    expect(run(PROJECT, ["set-gif", "--dir", "blob", "--motion", "walk", "--status", "failed",
      "--notes", "fal downstream_service_error", "--request-id", "req-500"], undefined, ws).code).toBe(0);
    const third = uriOf(nextOutput(ws));
    expect(third).toBe("motions/walk/gif-raw-3.gif");
    expect(reserve(ws, third).code).toBe(0);
    expect(assetOf(dir, "walk-gif-raw-2").status).toBe("failed");
    expect(edgeOf(dir, "walk-gif-raw-2").operation.params).toMatchObject({ requestId: "req-500", failure: { reason: "fal downstream_service_error", billing: "unknown" } });
    expect(frameParents(dir)).toEqual(Array(FRAMES).fill("walk-gif-raw-1"));

    // Take 3 lands and is cut: now the frames name take 3.
    expect(land(ws, FRAMES, third, "req-gif-9").code).toBe(0);
    expect(cutAndRegister(ws, third).code).toBe(0);
    expect(frameParents(dir)).toEqual(Array(FRAMES).fill("walk-gif-raw-3"));
    const shown = run(PROJECT, ["show", "--dir", "blob", "--motion", "walk"], undefined, ws).out;
    expect(shown).toContain("GIF walk-gif-raw-3 (motions/walk/gif-raw-3.gif) — ready");
    expect(shown).toContain("earlier GIF walk-gif-raw-1 (motions/walk/gif-raw-1.gif) — ready");
    expect(shown).toContain("earlier GIF walk-gif-raw-2 (motions/walk/gif-raw-2.gif) — failed, request req-500: fal downstream_service_error");

    // remove-motion takes every take with it (the files stay).
    const removed = JSON.parse(run(PROJECT, ["remove-motion", "--dir", "blob", "--motion", "walk", "--json"], undefined, ws).out);
    expect(removed.removedAssets).toEqual(expect.arrayContaining(["walk-gif-raw-1", "walk-gif-raw-2", "walk-gif-raw-3"]));
    expect(read(dir).assets.filter((a: { id: string }) => a.id.startsWith("walk-"))).toEqual([]);
  });

  test("a take still generating is not abandoned silently: a new one needs --supersede, which records it as unknown", () => {
    const { ws, dir } = workspace();
    expect(reserve(ws).code).toBe(0);
    const before = readFileSync(join(dir, "project.json"), "utf-8");
    const refused = reserve(ws, "motions/walk/gif-raw-2.gif");
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("walk-gif-raw-1");
    expect(refused.err).toContain("still generating");
    expect(refused.err).toContain("billed");
    expect(refused.err).toContain("--supersede");
    expect(readFileSync(join(dir, "project.json"), "utf-8")).toBe(before);
    // --supersede is for a take in flight only.
    expect(run(PROJECT, ["set-gif", "--dir", "blob", "--motion", "walk", "--status", "failed", "--notes", "x", "--supersede", "y"], undefined, ws).code).toBe(1);

    const superseded = reserve(ws, "motions/walk/gif-raw-2.gif", ["--supersede", "the generate call was killed before it printed a request id"]);
    expect(superseded.code).toBe(0);
    expect(assetOf(dir, "walk-gif-raw-1").status).toBe("failed");
    const failure = edgeOf(dir, "walk-gif-raw-1").operation.params.failure;
    expect(failure.billing).toBe("unknown");
    expect(failure.reason).toContain("outcome was never recorded");
    expect(failure.reason).toContain("the generate call was killed before it printed a request id");
    expect(assetOf(dir, "walk-gif-raw-2").status).toBe("generating");
    expect(read(dir).sprite.motions[0].gifRaw).toBe("walk-gif-raw-2");
    // With nothing in flight, --supersede is refused rather than ignored.
    expect(run(PROJECT, ["set-gif", "--dir", "blob", "--motion", "walk", "--status", "failed", "--notes", "x"], undefined, ws).code).toBe(0);
    expect(reserve(ws, "motions/walk/gif-raw-3.gif", ["--supersede", "nothing to supersede"]).err).toContain("--supersede");
  });

  test("the prompt a take in flight is landed against is not rewritten: gif-prompt refuses, or --supersede records that take", () => {
    const replan = (ws: string, extra: string[] = []) => run(PROJECT, ["gif-prompt", "--dir", "blob", "--motion", "walk",
      "--action", "The box steps right, slower.", "--frames", "8", ...extra], undefined, ws);
    // Take 1 is planned at the fixture's 12 frames and reserved; a retake is
    // planned at 8 while it is still generating.
    const { ws, dir } = workspace();
    expect(reserve(ws, uriOf(nextOutput(ws))).code).toBe(0);
    const before = readFileSync(join(dir, "project.json"), "utf-8");
    const refused = replan(ws);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("walk-gif-raw-1");
    expect(refused.err).toContain("still generating");
    expect(refused.err).toContain("set-gif --report");
    expect(refused.err).toContain("--supersede");
    expect(readFileSync(join(dir, "project.json"), "utf-8")).toBe(before);
    // Take 1's correct GIF still lands against the 12 frames it was asked for.
    expect(land(ws).code).toBe(0);
    expect(assetOf(dir, "walk-gif-raw-1").status).toBe("ready");
    // Once it has landed, the retake's prompt is written as usual.
    expect(replan(ws).code).toBe(0);

    // --supersede on gif-prompt records the take in flight as failed, its
    // outcome and billing unknown; the reservation then needs no override.
    const second = workspace();
    expect(reserve(second.ws, uriOf(nextOutput(second.ws))).code).toBe(0);
    const superseding = replan(second.ws, ["--supersede", "the generate call was killed before it printed a request id", "--json"]);
    expect(superseding.code).toBe(0);
    expect(JSON.parse(superseding.out).output).toBe("blob/motions/walk/gif-raw-2.gif");
    expect(assetOf(second.dir, "walk-gif-raw-1").status).toBe("failed");
    const failure = edgeOf(second.dir, "walk-gif-raw-1").operation.params.failure;
    expect(failure.billing).toBe("unknown");
    expect(failure.reason).toContain("outcome was never recorded");
    expect(failure.reason).toContain("killed before it printed a request id");
    expect(read(second.dir).sprite.motions[0].status).toBe("failed");
    expect(read(second.dir).sprite.motions[0].promptParts.guards[0]).toBe("frames:8");
    expect(reserve(second.ws, "motions/walk/gif-raw-2.gif").code).toBe(0);
    // With nothing in flight, gif-prompt's --supersede is refused rather than ignored.
    expect(run(PROJECT, ["set-gif", "--dir", "blob", "--motion", "walk", "--status", "failed", "--notes", "x"], undefined, second.ws).code).toBe(0);
    const idle = replan(second.ws, ["--supersede", "nothing to supersede"]);
    expect(idle.code).toBe(1);
    expect(idle.err).toContain("only a take still generating is superseded");
  });

  test("a superseded take's GIF that arrives later becomes a new take; the superseded record stays as it was", () => {
    const { ws, dir } = workspace();
    expect(reserve(ws).code).toBe(0);
    expect(reserve(ws, "motions/walk/gif-raw-2.gif", ["--supersede", "the generate call was killed before it printed a request id"]).code).toBe(0);
    expect(run(PROJECT, ["set-gif", "--dir", "blob", "--motion", "walk", "--status", "failed", "--notes", "fal downstream_service_error"], undefined, ws).code).toBe(0);
    const take1 = { asset: assetOf(dir, "walk-gif-raw-1"), edge: edgeOf(dir, "walk-gif-raw-1") };
    expect(take1.edge.operation.params.failure.billing).toBe("unknown");

    // Take 1's call ran after all: its GIF turns up at the file it reserved.
    mkdirSync(join(dir, "motions", "walk"), { recursive: true });
    copyFileSync(gif, join(dir, "motions", "walk", "gif-raw-1.gif"));
    // --report lands only the current take, and the superseded one's file is its own.
    expect(run(PROJECT, ["set-gif", "--dir", "blob", "--motion", "walk", "--report", "-"], report(FRAMES, "motions/walk/gif-raw-1.gif"), ws).code).toBe(1);
    const refused = run(PROJECT, ["set-gif", "--dir", "blob", "--motion", "walk", "--uploaded", "--file", "motions/walk/gif-raw-1.gif"], undefined, ws);
    expect(refused.code).toBe(1);
    // The refusal says exactly how to record the bytes as a new take.
    expect(refused.err).toContain("cp blob/motions/walk/gif-raw-1.gif blob/motions/walk/gif-raw-3.gif");
    expect(refused.err).toContain("set-gif --dir blob --motion walk --uploaded --file motions/walk/gif-raw-3.gif");

    copyFileSync(join(dir, "motions", "walk", "gif-raw-1.gif"), join(dir, "motions", "walk", "gif-raw-3.gif"));
    expect(run(PROJECT, ["set-gif", "--dir", "blob", "--motion", "walk", "--uploaded", "--file", "motions/walk/gif-raw-3.gif"], undefined, ws).code).toBe(0);
    expect(read(dir).sprite.motions[0].gifRaw).toBe("walk-gif-raw-3");
    expect(assetOf(dir, "walk-gif-raw-3")).toMatchObject({ status: "ready", uri: "motions/walk/gif-raw-3.gif", metadata: { frames: FRAMES } });
    expect(edgeOf(dir, "walk-gif-raw-3")).toMatchObject({ fromAssetId: null, operation: { type: "upload", actor: "human" } });
    // The superseded take is still failed, billing unknown, exactly as recorded.
    expect(assetOf(dir, "walk-gif-raw-1")).toEqual(take1.asset);
    expect(edgeOf(dir, "walk-gif-raw-1")).toEqual(take1.edge);

    expect(cutAndRegister(ws, "motions/walk/gif-raw-3.gif").code).toBe(0);
    expect(frameParents(dir)).toEqual(Array(FRAMES).fill("walk-gif-raw-3"));
    expect(nextOutput(ws)).toBe("blob/motions/walk/gif-raw-4.gif");
  });

  test("landing and cutting count the same frames when ffprobe cannot read one frame's delay", () => {
    // ffprobe 8.0 fills in a delay for every real GIF tried (zero, missing
    // and truncated ones alike), so the unreadable packet is a stub: the
    // real ffprobe, with the second packet's duration reported as N/A.
    const { ws, dir } = workspace();
    const bin = join(ws, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "ffprobe"), `#!/bin/sh
out=$("$REAL_FFPROBE" "$@") || exit $?
case "$*" in
  *packet=duration_time*) printf '%s\\n' "$out" | awk 'NR == 2 { print "N/A"; next } { print }' ;;
  *) printf '%s\\n' "$out" ;;
esac
`, { mode: 0o755 });
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, REAL_FFPROBE: Bun.which("ffprobe")! };
    const probed = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "packet=duration_time", "-of", "csv=p=0", gif], { encoding: "utf-8", env });
    expect(probed.stdout.trim().split("\n")[1]).toBe("N/A");

    expect(reserve(ws).code).toBe(0);
    mkdirSync(join(dir, "motions", "walk"), { recursive: true });
    copyFileSync(gif, join(dir, "motions", "walk", "gif-raw-1.gif"));
    const landed = run(PROJECT, ["set-gif", "--dir", "blob", "--motion", "walk", "--report", "-"], report(), ws, env);
    expect(landed.err).toBe("");
    expect(landed.code).toBe(0);
    expect(assetOf(dir, "walk-gif-raw-1").metadata.frames).toBe(FRAMES);

    const cut = run(SHEET, ["from-gif", "blob/motions/walk/gif-raw-1.gif", "--out", "blob/motions/walk", "--name", "walk", "--loop", "--json"], undefined, ws, env);
    expect(cut.code).toBe(0);
    const summary = JSON.parse(cut.out);
    expect(summary.frameCount).toBe(FRAMES);
    expect(summary.delaysMs).toEqual(Array(FRAMES).fill(90));
    expect(summary.warnings.join("\n")).toContain("frame(s) 01 of the GIF carry no readable delay");
    expect(run(PROJECT, ["register-run", "--dir", "blob", "--motion", "walk", "--run", "-"], cut.out, ws, env).code).toBe(0);
    expect(read(dir).sprite.motions[0].frames).toHaveLength(FRAMES);
  });

  test("a GIF the user brought is an upload by the human", () => {
    const { ws, dir } = workspace();
    mkdirSync(join(dir, "motions", "walk"), { recursive: true });
    copyFileSync(gif, join(dir, "motions", "walk", "upload.gif"));
    expect(run(PROJECT, ["set-gif", "--dir", "blob", "--motion", "walk", "--uploaded", "--file", "motions/walk/upload.gif", "--model", "x"], undefined, ws).err)
      .toContain("was not generated here");
    expect(run(PROJECT, ["set-gif", "--dir", "blob", "--motion", "walk", "--uploaded", "--file", "motions/walk/upload.gif"], undefined, ws).code).toBe(0);
    expect(read(dir).sprite.motions[0].gifRaw).toBe("walk-gif-raw-1");
    expect(edgeOf(dir, "walk-gif-raw-1")).toMatchObject({ fromAssetId: null, operation: { type: "upload", actor: "human" } });
    // The same file is not registered as a second take.
    expect(run(PROJECT, ["set-gif", "--dir", "blob", "--motion", "walk", "--uploaded", "--file", "motions/walk/upload.gif"], undefined, ws).code).toBe(1);
  });
});

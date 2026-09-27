/**
 * Alignment and framing, end to end through the real script: `align
 * --x-from trend|body`, the head-band drift and the step checks `inspect`
 * reports, `flatten --room`, and `from-video --body-height`.
 *
 * Its own file so the long `sprite-sheet.test.ts` is not the only place these
 * land. Every fixture is drawn by ffmpeg at test time; the file skips with a
 * named reason when ffmpeg is missing. The pure maths behind these commands is
 * pinned without ffmpeg in `alignment-modules.test.ts`.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildClip, buildSheet, buildWalkerClip, clipFrameDeltas, readBbox, readColorBbox,
} from "./fixtures/pipeline/make-sheet.mjs";
import { roomCanvas } from "../skill/scripts/canvas.mjs";

const SCRIPT = join(import.meta.dir, "..", "skill", "scripts", "sprite-sheet.mjs");

const HAS_FFMPEG =
  spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0 &&
  spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0;
if (!HAS_FFMPEG) console.warn("(skip) modes/sprite alignment suite — ffmpeg/ffprobe not on PATH");

function run(...argv: string[]) {
  const r = Bun.spawnSync([process.execPath, SCRIPT, ...argv], { cwd: import.meta.dir, stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
}

function runJson(...argv: string[]) {
  const r = run(...argv, "--json");
  if (r.code !== 0) throw new Error(`sprite-sheet ${argv[0]} failed (${r.code}):\n${r.err}`);
  return JSON.parse(r.out);
}

const workspaces: string[] = [];
function fresh() {
  const dir = mkdtempSync(join(tmpdir(), "sprite-align-"));
  workspaces.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of workspaces.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Every case here spawns ffmpeg a few dozen times; the walker cases sample
 *  and re-align a 16-frame clip. Bun's 5 s default is not a budget for that. */
const SLOW = 60_000;

/** Decode any image to RGBA with ffmpeg — the test's own reader. */
function decode(path: string) {
  const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", path], { encoding: "utf-8" });
  const [width, height] = String(probe.stdout).trim().split(",").map(Number);
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", path, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "-"], { maxBuffer: 64 * 1024 * 1024 });
  return { width, height, data: r.stdout as Buffer };
}

/**
 * The ground truth: mean x of the walker's torso (its red, 0xe04040) in each
 * aligned frame. Independent of every measure the script reports.
 */
function torsoXs(framesDir: string): number[] {
  return readdirSync(framesDir).filter((n) => /^\d{2}\.png$/.test(n)).sort().map((name) => {
    const { width, height, data } = decode(join(framesDir, name));
    let sum = 0, n = 0;
    for (let i = 0; i < width * height; i++) {
      const o = i * 4;
      if (data[o + 3] >= 128 && data[o] > 180 && data[o + 1] < 110 && data[o + 2] < 110) { sum += (i % width) + 0.5; n++; }
    }
    return sum / n;
  });
}

const range = (values: number[]) => Math.max(...values) - Math.min(...values);

describe.skipIf(!HAS_FFMPEG)("alignment and framing", () => {
  // ── One walker clip, sampled once, aligned three ways ────────────────────
  //
  // Side view, walking in place at 1 s per cycle with an 8 px/s slide across
  // the canvas: the planted foot sweeps a whole stride under the hip every
  // step while the other one is lifted clear of the ground line.
  let walkerRoot: string | null = null;
  function walker() {
    if (walkerRoot) return walkerRoot;
    walkerRoot = fresh();
    const clip = buildWalkerClip(join(walkerRoot, "walk.mp4"), { drift: 8 });
    // Measured before anything is asserted on it: a fixture whose frames do
    // not differ proves nothing (the drawbox lesson).
    expect(Math.min(...clipFrameDeltas(clip))).toBeGreaterThan(0);
    runJson("from-video", clip, "--out", join(walkerRoot, "feet"), "--name", "walk", "--frames", "16", "--loop");
    return walkerRoot;
  }

  test("a per-frame foot pin lurches the body, and inspect says so from the head band", () => {
    const root = walker();
    const report = runJson("inspect", join(root, "feet"));
    // The alignment's own number cannot see it: the feet ARE the pinned line.
    expect(report.bodyDrift).toBeLessThan(1);
    // The body really lurches — about the 28 px stride, sampled 8 per cycle.
    expect(range(torsoXs(join(root, "feet", "frames")))).toBeGreaterThanOrEqual(15);
    // The head band reads it, against a source that barely sways once its
    // slide is taken out.
    expect(report.headDrift).toBeGreaterThan(5);
    expect(report.sourceHeadDrift).toBeLessThan(1);
    expect(report.warnings.some((w: string) => w.startsWith("head sways") && w.includes("--x-from trend"))).toBe(true);
    expect(report.frames.every((f: { headX: number | null }) => typeof f.headX === "number")).toBe(true);
  }, SLOW);

  test("--x-from trend keeps the step and takes out only the slide", () => {
    const root = walker();
    const motion = join(root, "trend");
    cpSync(join(root, "feet"), motion, { recursive: true });
    const aligned = runJson("align", join(motion, "cells"), "--out", join(motion, "frames"), "--x-from", "trend");
    expect(aligned.xFrom).toBe("trend");
    // 8 px/s over the 1.875 s the 16 samples span.
    expect(aligned.drift.driftPx).toBeGreaterThan(12);
    expect(aligned.drift.driftPx).toBeLessThan(18);
    expect(aligned.drift.footSwayPx).toBeGreaterThan(15); // the step, kept
    const record = JSON.parse(readFileSync(join(motion, "frames", "align.json"), "utf-8"));
    expect(record.xFrom).toBe("trend");
    expect(record.drift).toEqual(aligned.drift);

    expect(range(torsoXs(join(motion, "frames")))).toBeLessThanOrEqual(2);
    const report = runJson("inspect", motion);
    expect(report.headDrift).toBeLessThan(1.5);
    // The foot line sweeps a stride BY DESIGN here, so the feet spread is not
    // a fault — telling the agent to pin the feet would bring the lurch back.
    expect(report.bodyDrift).toBeGreaterThan(0.05 * report.cell.width);
    expect(report.warnings).toEqual([]);
  }, SLOW);

  test("--x-from body ramps one head-and-torso offset across the cycle", () => {
    const root = walker();
    const motion = join(root, "body");
    cpSync(join(root, "feet"), motion, { recursive: true });
    const aligned = runJson("align", join(motion, "cells"), "--out", join(motion, "frames"), "--x-from", "body");
    expect(aligned.xFrom).toBe("body");
    // The last sample sits ~14 px right of the first; the ramp walks it back.
    expect(aligned.drift.wrapDx).toBeLessThanOrEqual(-12);
    expect(aligned.drift.wrapDx).toBeGreaterThanOrEqual(-17);
    expect(aligned.drift.shifts).toHaveLength(16);
    expect(aligned.drift.shifts[0]).toBe(0);
    expect(range(torsoXs(join(motion, "frames")))).toBeLessThanOrEqual(2);
  }, SLOW);

  test("trend and body refuse frames that do not share one coordinate system", () => {
    const ws = fresh();
    const dir = join(ws, "mixed");
    mkdirSync(dir);
    buildSheet(join(dir, "00.png"), { rows: 1, cols: 1, cell: 64 });
    buildSheet(join(dir, "01.png"), { rows: 1, cols: 1, cell: 80 });
    for (const mode of ["trend", "body"]) {
      const r = run("align", dir, "--out", join(ws, `out-${mode}`), "--x-from", mode);
      expect(r.code).toBe(1);
      expect(r.err).toContain(`--x-from ${mode} needs frames cut from one grid or one clip`);
    }
  }, SLOW);

  // ── The step checks ───────────────────────────────────────────────────────

  /**
   * A 2 × 3 sheet whose rows are two separately drawn sequences: three reds a
   * shade apart, then three blues — and the blue row repeats a drawing.
   */
  function rowSheet(path: string) {
    const at = (color: string) => ({ x: 17, y: 17, color });
    return buildSheet(path, {
      rows: 2, cols: 3, cell: 64,
      squares: [at("0xa02020"), at("0xd02020"), at("0xff2020"), at("0x2020a0"), at("0x2020a0"), at("0x2020ff")],
    });
  }

  test("inspect names a sheet's jumping row boundaries and its held frames, from the grid slice records", () => {
    const ws = fresh();
    const motion = join(ws, "motions", "idle");
    const out = runJson("run", rowSheet(join(ws, "rows.png")), "--rows", "2", "--cols", "3",
      "--out", motion, "--name", "idle", "--fps", "8", "--loop");
    expect(JSON.parse(readFileSync(join(motion, "cells", "slice.json"), "utf-8"))).toMatchObject({ rows: 2, cols: 3 });
    // Red to blue at the row boundary, and blue back to red at the wrap.
    expect(out.inspect.rowJumps).toEqual([[2, 3], [5, 0]]);
    // Frames 03 and 04 are the same drawing.
    expect(out.inspect.nearDuplicates).toEqual([[3, 4]]);
    expect(out.inspect.warnings).toContain(
      "near-duplicate frames 03→04 (step under 0.01) — the animation holds there; fine for a held idle, a hitch in a stroke or a step",
    );
    expect(out.inspect.warnings.some((w: string) => w.startsWith("row boundaries jump: 02→03, 05→00"))).toBe(true);

    // The report carries each frame's step to the next, and a plain inspect
    // reproduces the run's verdict (the grid comes from the cells, not the run).
    const report = runJson("inspect", motion);
    expect(report.rowJumps).toEqual(out.inspect.rowJumps);
    expect(report.grid).toEqual({ rows: 2, cols: 3 });
    expect(report.loop).toBe(true);
    expect(report.frames[3].step).toBe(0);
    expect(report.frames[5].step).toBeGreaterThan(0.1); // the wrap, 05 → 00
  }, SLOW);

  test("a clip's samples are not a grid: from-video clears a stale slice record", () => {
    const ws = fresh();
    const motion = join(ws, "motions", "idle");
    runJson("run", rowSheet(join(ws, "rows.png")), "--rows", "2", "--cols", "3", "--out", motion, "--name", "idle", "--fps", "8");
    expect(existsSync(join(motion, "cells", "slice.json"))).toBe(true);
    const clip = buildClip(join(ws, "hop.mp4"));
    const out = runJson("from-video", clip, "--out", motion, "--name", "idle", "--frames", "6");
    expect(existsSync(join(motion, "cells", "slice.json"))).toBe(false);
    expect(out.inspect.rowJumps).toEqual([]);
  }, SLOW);

  // ── flatten --room ────────────────────────────────────────────────────────

  /** A 64×64 transparent frame with a 30×30 red square at (10, 20). */
  function frame(path: string) {
    return buildSheet(path, { rows: 1, cols: 1, cell: 64 });
  }

  test("--room pads the still where canvas.mjs says and stands it on the bottom edge", () => {
    const ws = fresh();
    const still = frame(join(ws, "00.png"));
    for (const room of ["square", "tall", "wide"] as const) {
      const out = runJson("flatten", still, "--out", join(ws, `${room}.png`), "--bg", "#00ff00", "--room", room, "--facing", "right");
      const want = roomCanvas({ width: 64, height: 64 }, { room, facing: "right" });
      expect({ room, w: out.width, h: out.height, offset: out.room.offset })
        .toEqual({ room, w: want.canvas.width, h: want.canvas.height, offset: want.offset });
      expect(out.room.facingFrom).toBe("flag");
      const probed = readBbox(join(ws, `${room}.png`));
      expect({ w: probed.width, h: probed.height }).toEqual({ w: want.canvas.width, h: want.canvas.height });
      // The drawing itself moved by exactly the offset, unscaled.
      expect(readColorBbox(join(ws, `${room}.png`), "#ff0000").bbox)
        .toEqual({ x: want.offset.x + 10, y: want.offset.y + 20, w: 30, h: 30 });
    }
  }, SLOW);

  test("the room in front follows the character's facing from its project.json", () => {
    const ws = fresh();
    const character = join(ws, "lumi");
    mkdirSync(join(character, "motions", "attack", "frames"), { recursive: true });
    writeFileSync(join(character, "project.json"), JSON.stringify({
      sprite: { character: { name: "Lumi", facing: "left" }, motions: [] },
    }));
    const still = frame(join(character, "motions", "attack", "frames", "00.png"));
    const out = runJson("flatten", still, "--out", join(ws, "wide.png"), "--bg", "#00ff00", "--room", "wide");
    const left = roomCanvas({ width: 64, height: 64 }, { room: "wide", facing: "left" });
    expect(out.room.facing).toBe("left");
    expect(out.room.facingFrom).toBe(join(character, "project.json"));
    expect(out.room.offset).toEqual(left.offset);
    // …and a still with no character above it says it assumed.
    const loose = runJson("flatten", frame(join(ws, "loose.png")), "--out", join(ws, "loose-wide.png"), "--room", "wide");
    expect({ facing: loose.room.facing, from: loose.room.facingFrom }).toEqual({ facing: "right", from: "default" });
  }, SLOW);

  test("a fraction that shapes nothing is refused, and an opaque still is warned about", () => {
    const ws = fresh();
    const still = frame(join(ws, "00.png"));
    const refusals: Array<[string[], string]> = [
      [["--lead", "0.3"], "--lead shapes a room"],
      [["--room", "tall", "--lead", "0.3"], "--lead only shapes a wide room"],
      [["--room", "square", "--headroom", "0.2"], "--headroom has no effect on a square room"],
      [["--room", "round"], "--room: expected square, tall, wide"],
      [["--room", "wide", "--lead", "0.5", "--trail", "0.5"], "--lead + --trail must stay below 0.9"],
      [["--room", "wide", "--facing", "up"], "--facing: expected left or right"],
    ];
    for (const [flags, message] of refusals) {
      const r = run("flatten", still, "--out", join(ws, "x.png"), ...flags);
      expect({ flags, code: r.code, said: r.err.includes(message) }).toEqual({ flags, code: 1, said: true });
    }
    const opaque = buildSheet(join(ws, "opaque.png"), { rows: 1, cols: 1, cell: 64, background: "0xffffff" });
    const out = runJson("flatten", opaque, "--out", join(ws, "o.png"), "--room", "tall");
    expect(out.warnings[0]).toContain("has no transparency");
    // Without --room nothing changes: same size, no room block.
    const plain = runJson("flatten", still, "--out", join(ws, "plain.png"));
    expect({ w: plain.width, h: plain.height, room: plain.room }).toEqual({ w: 64, h: 64, room: undefined });
  }, SLOW);

  // ── from-video --body-height ─────────────────────────────────────────────

  test("--body-height scales the samples so the first frame's subject stands N px tall", () => {
    const ws = fresh();
    // A 20×20 box on green, 64×64: it stands ~20 px in the clip's first frame.
    const clip = buildClip(join(ws, "box.mp4"));
    const out = runJson("from-video", clip, "--out", join(ws, "m"), "--name", "m", "--frames", "4", "--body-height", "40");
    expect(out.bodyHeight.target).toBe(40);
    expect(out.bodyHeight.measured).toBeGreaterThanOrEqual(19);
    expect(out.bodyHeight.measured).toBeLessThanOrEqual(23);
    expect(out.bodyHeight.scale).toBeCloseTo(40 / out.bodyHeight.measured, 3);
    expect(readBbox(join(ws, "m", "cells", "00.png")).width).toBe(out.bodyHeight.frame.width);
    const report = JSON.parse(readFileSync(join(ws, "m", "inspect.json"), "utf-8"));
    expect(Math.abs(report.frames[0].bbox.h - 40)).toBeLessThanOrEqual(2);
    // Up is allowed — a target is a size, not a cap — and said out loud.
    expect(out.warnings.some((w: string) => w.includes("scales this clip UP"))).toBe(true);

    const r = run("from-video", clip, "--out", join(ws, "n"), "--name", "n", "--frames", "4", "--body-height", "40", "--key", "none");
    expect(r.code).toBe(1);
    expect(r.err).toContain("--body-height measures the subject against its plate");
  }, SLOW);
});

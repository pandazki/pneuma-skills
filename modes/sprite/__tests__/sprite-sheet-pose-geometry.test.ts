/**
 * Where a pose is, how high it stands, and whether a character is one size —
 * end to end through the real scripts:
 *
 * - `slice --auto` and `run`'s fallback to it when the fixed grid cuts
 *   through a pose (the Kagari attack sheet's boots crossed y = 512);
 * - `align` / `run` / `from-video --y-from cell`, which keeps a jump's drawn
 *   or filmed height instead of standing every frame on the ground;
 * - `inspect`'s head-sway bar and advice on pixel frames, `align`'s refusal
 *   to drop a lattice, `headDrift` absent when unmeasurable;
 * - `mirror`'s summary grid, key colour and pack filter;
 * - `sizes`, the cross-motion size comparison;
 * - `flatten --facing` on a room that has no front.
 *
 * Every fixture is drawn by ffmpeg at test time; the file skips with a named
 * reason when ffmpeg is missing. The pure halves are pinned in
 * `pose-geometry-modules.test.ts`.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildExprClip, readBbox } from "./fixtures/pipeline/make-sheet.mjs";

const SCRIPT = join(import.meta.dir, "..", "skill", "scripts", "sprite-sheet.mjs");
const PROJECT = join(import.meta.dir, "..", "skill", "scripts", "sprite-project.mjs");

const HAS_FFMPEG =
  spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0 &&
  spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0;
if (!HAS_FFMPEG) console.warn("(skip) modes/sprite pose-geometry suite — ffmpeg/ffprobe not on PATH");

/** Each case spawns ffmpeg a few dozen times; 5 s is not a budget for that. */
const SLOW = 60_000;

function run(...argv: string[]) {
  const r = Bun.spawnSync([process.execPath, SCRIPT, ...argv], { cwd: import.meta.dir, stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
}

function runJson(...argv: string[]) {
  const r = run(...argv, "--json");
  if (r.code !== 0) throw new Error(`sprite-sheet ${argv[0]} failed (${r.code}):\n${r.err}`);
  return JSON.parse(r.out);
}

function projectCmd(dir: string, ...argv: string[]) {
  const r = Bun.spawnSync([process.execPath, PROJECT, argv[0], "--dir", dir, ...argv.slice(1), "--json"], {
    cwd: import.meta.dir, stdout: "pipe", stderr: "pipe",
  });
  if (r.exitCode !== 0) throw new Error(`sprite-project ${argv[0]} failed (${r.exitCode}):\n${r.stderr.toString()}`);
  return JSON.parse(r.stdout.toString());
}

const workspaces: string[] = [];
function fresh() {
  const dir = mkdtempSync(join(tmpdir(), "sprite-pose-"));
  workspaces.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of workspaces.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type Box = { x: number; y: number; w: number; h: number; color?: string };

/** A transparent PNG with opaque boxes (drawbox with replace=1 writes alpha). */
function drawPng(path: string, width: number, height: number, boxes: Box[], background = "black@0") {
  const draws = boxes.map((b) => `drawbox=x=${b.x}:y=${b.y}:w=${b.w}:h=${b.h}:color=${b.color ?? "red"}@1:t=fill:replace=1`);
  const chain = [`color=c=${background}:s=${width}x${height}`, "format=rgba", ...draws].join(",");
  mkdirSync(join(path, ".."), { recursive: true });
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", chain, "-frames:v", "1", "-pix_fmt", "rgba", "--", path], { encoding: "utf-8" });
  if (r.status !== 0) throw new Error(`fixture ffmpeg failed: ${r.stderr}`);
  return path;
}

/** One figure per cell of a `cols`-wide grid of 64 px cells: a body box plus
 *  whatever `extra` adds, placed in sheet coordinates. */
function gridSheet(path: string, rows: number, cols: number, figures: Box[][]) {
  return drawPng(path, cols * 64, rows * 64, figures.flat());
}

const pngBytes = (path: string) => readFileSync(path);

describe.skipIf(!HAS_FFMPEG)("pose geometry", () => {
  // ── slice --auto and run's fallback ──────────────────────────────────────
  //
  // 2x2 sheet of 64 px cells. Pose 00's boots run 7 px past y = 64 into the
  // cell below; the pose there starts at y = 84, so a blank band separates
  // the rows — just not at the grid line.
  const crossing = (dir: string) => gridSheet(join(dir, "crossing.png"), 2, 2, [
    [{ x: 20, y: 10, w: 24, h: 50 }, { x: 22, y: 60, w: 20, h: 11, color: "blue" }],
    [{ x: 84, y: 10, w: 24, h: 50 }],
    [{ x: 20, y: 84, w: 24, h: 40 }],
    [{ x: 84, y: 84, w: 24, h: 40 }],
  ]);

  describe("slicing by the poses' ink", () => {
    test("run cuts the fixed grid, sees a pose continue across a line, and slices by ink instead", () => {
      const ws = fresh();
      const sheet = crossing(ws);
      const motion = join(ws, "motions", "attack");
      const out = runJson("run", sheet, "--rows", "2", "--cols", "2", "--out", motion, "--name", "attack", "--fps", "8", "--no-loop");
      // Cell 00 loses its boots to the line; cell 02 is handed them.
      expect(out.slice).toMatchObject({ mode: "auto", reason: "grid-clipped", gridClipped: [0, 2], forced: { rows: false, cols: [false, false] } });
      expect(out.slice.cuts.rows[0]).toBeGreaterThan(71);
      expect(out.slice.cuts.rows[0]).toBeLessThan(84);
      // The whole pose made it into cell 00, and nothing clipped it.
      expect(out.inspect.warnings.filter((w: string) => w.includes("clipped"))).toEqual([]);
      expect(readBbox(join(motion, "cells", "00.png")).bbox).toMatchObject({ y: 10, h: 61 });
      expect(out.warnings.some((w: string) => w.startsWith("the fixed 2x2 grid cut through cell(s) 00, 02"))).toBe(true);
      // …and cell 02 now holds only its own pose.
      expect(readBbox(join(motion, "cells", "02.png")).bbox).toMatchObject({ y: 84 - 64, h: 40 });
      // What the model drew is untouched: the cells were cut from it.
      expect(pngBytes(join(motion, "sheet-raw.png")).equals(pngBytes(sheet))).toBe(true);
      const record = JSON.parse(readFileSync(join(motion, "cells", "slice.json"), "utf-8"));
      expect(record).toMatchObject({ rows: 2, cols: 2, auto: { reason: "grid-clipped", clipped: [] } });
      expect(record.auto.poses[0].box).toEqual({ x: 20, y: 10, w: 24, h: 61 });
    }, SLOW);

    test("--no-auto-slice keeps the fixed cut, and says what it clips", () => {
      const ws = fresh();
      const out = runJson("run", crossing(ws), "--rows", "2", "--cols", "2", "--out", join(ws, "m"), "--name", "m",
        "--fps", "8", "--no-auto-slice");
      expect("slice" in out).toBe(false);
      expect(out.inspect.warnings).toContain("cell 00 is clipped — the drawing leaves its grid cell");
    }, SLOW);

    test("a drawing that only touches a grid line from inside is not cut, and keeps the fixed grid", () => {
      const ws = fresh();
      // Cell 01's square starts exactly at x = 64; nothing of it lies left of the line.
      const sheet = gridSheet(join(ws, "touch.png"), 1, 2, [[{ x: 20, y: 10, w: 20, h: 40 }], [{ x: 64, y: 10, w: 20, h: 40 }]]);
      const out = runJson("run", sheet, "--rows", "1", "--cols", "2", "--out", join(ws, "m"), "--name", "m", "--fps", "8");
      expect("slice" in out).toBe(false);
      expect(out.warnings.some((w: string) => w.includes("grid cut through"))).toBe(false);
    }, SLOW);

    test("slice --auto writes the record; a pose drawn off the sheet is still reported clipped", () => {
      const ws = fresh();
      const sheet = gridSheet(join(ws, "edge.png"), 1, 2, [[{ x: 0, y: 10, w: 30, h: 40 }], [{ x: 84, y: 10, w: 24, h: 40 }]]);
      const cells = join(ws, "cells");
      const out = runJson("slice", sheet, "--rows", "1", "--cols", "2", "--out", cells, "--auto");
      expect(out).toMatchObject({ mode: "auto", rows: 1, cols: 2, auto: { reason: "asked", clipped: [{ index: 0, why: "sheet-edge" }] } });
      expect("images" in out).toBe(false);
      // The cells judged as their own frames: clipping comes from the record.
      const report = runJson("inspect", cells, "--cells", cells);
      expect(report.warnings).toContain("cell 00 is clipped — the drawing runs off the edge of the sheet");
      // --threshold means something only to the auto slicer.
      const refused = run("slice", sheet, "--rows", "1", "--cols", "2", "--out", join(ws, "c2"), "--threshold", "8", "--json");
      expect(refused.code).toBe(1);
      expect(refused.err).toMatch(/--threshold decides which pixels are ink for --auto/);
    }, SLOW);
  });

  // ── --y-from cell ────────────────────────────────────────────────────────

  describe("keeping a jump's height", () => {
    // 1x4 of 64 px cells: the same 20x20 body standing on y = 56, then drawn
    // 10 and 30 px higher, then back down.
    const jumpSheet = (dir: string) => gridSheet(join(dir, "jump.png"), 1, 4, [
      [{ x: 22, y: 36, w: 20, h: 20 }], [{ x: 86, y: 26, w: 20, h: 20 }],
      [{ x: 150, y: 6, w: 20, h: 20 }], [{ x: 214, y: 36, w: 20, h: 20 }],
    ]);

    test("by default every frame stands on the anchor; --y-from cell keeps each frame's lift", () => {
      const ws = fresh();
      const sheet = jumpSheet(ws);
      const flat = runJson("run", sheet, "--rows", "1", "--cols", "4", "--out", join(ws, "flat"), "--name", "jump", "--fps", "8", "--pad", "4");
      expect("lift" in flat).toBe(false);
      expect(flat.inspect.anchorDrift.y).toBe(0);

      const kept = runJson("run", sheet, "--rows", "1", "--cols", "4", "--out", join(ws, "kept"), "--name", "jump", "--fps", "8",
        "--pad", "4", "--y-from", "cell");
      expect(kept.yFrom).toBe("cell");
      expect(kept.lift).toEqual([0, 10, 30, 0]);
      expect(kept.inspect.lift).toEqual([0, 10, 30, 0]);
      // Tall enough for the apex: the body plus its highest lift, padded.
      expect(kept.cell.height).toBeGreaterThanOrEqual(20 + 30 + 2 * 4);
      for (const [i, lift] of [0, 10, 30, 0].entries()) {
        const box = readBbox(join(ws, "kept", "frames", `0${i}.png`)).bbox!;
        expect(kept.inspect.anchorPoint.y - (box.y + box.h)).toBe(lift);
      }
      const align = JSON.parse(readFileSync(join(ws, "kept", "frames", "align.json"), "utf-8"));
      expect(align).toMatchObject({ yFrom: "cell", lift: [0, 10, 30, 0] });
      expect(kept.warnings.some((w: string) => w.startsWith("--y-from cell"))).toBe(false);
    }, SLOW);

    test("a centre anchor is refused; frames that never leave the ground are said", () => {
      const ws = fresh();
      const refused = run("run", jumpSheet(ws), "--rows", "1", "--cols", "4", "--out", join(ws, "c"), "--name", "j", "--fps", "8",
        "--anchor", "center", "--y-from", "cell", "--json");
      expect(refused.code).toBe(1);
      expect(refused.err).toMatch(/--y-from cell keeps each frame's height above the ground/);

      const grounded = gridSheet(join(ws, "grounded.png"), 1, 2, [[{ x: 22, y: 36, w: 20, h: 20 }], [{ x: 86, y: 36, w: 20, h: 20 }]]);
      const out = runJson("run", grounded, "--rows", "1", "--cols", "2", "--out", join(ws, "g"), "--name", "g", "--fps", "8", "--y-from", "cell");
      expect(out.lift).toEqual([0, 0]);
      expect(out.warnings.some((w: string) => w.startsWith("--y-from cell: no frame stands more than"))).toBe(true);
    }, SLOW);

    test("a grid row that never comes down to the others' ground is named", () => {
      const ws = fresh();
      // Row 0 stands on y = 56; row 1's frames are both 20 px higher in their cells.
      const sheet = gridSheet(join(ws, "rows.png"), 2, 2, [
        [{ x: 22, y: 36, w: 20, h: 20 }], [{ x: 86, y: 26, w: 20, h: 20 }],
        [{ x: 22, y: 80, w: 20, h: 20 }], [{ x: 86, y: 80, w: 20, h: 20 }],
      ]);
      const out = runJson("run", sheet, "--rows", "2", "--cols", "2", "--out", join(ws, "m"), "--name", "m", "--fps", "8", "--y-from", "cell");
      expect(out.lift).toEqual([0, 10, 20, 20]);
      expect(out.warnings.some((w: string) => w.includes("row 1 (frames 02–03) never comes down to the ground"))).toBe(true);
    }, SLOW);

    test("from-video --y-from cell keeps the clip's own heights on a locked camera", () => {
      const ws = fresh();
      // The box leaves the ground at t = 0.25 s, peaks 30 px up at 0.5 s, lands at 0.75 s.
      const clip = buildExprClip(join(ws, "hop.mp4"), {
        width: 64, height: 96, fps: 24, frames: 25, box: { w: 16, h: 16, color: "red" },
        x: "24", y: "if(lt(t,0.25),70,if(gt(t,0.75),70,70-30*sin(PI*(t-0.25)/0.5)))",
      });
      const out = runJson("from-video", clip, "--out", join(ws, "hop"), "--name", "hop", "--at", "0,0.5,0.95", "--no-loop",
        "--x-from", "cell", "--y-from", "clip");
      // `clip` is `cell` by the name a clip's frames go by.
      expect(out.yFrom).toBe("cell");
      expect(out.lift[0]).toBe(0);
      expect(out.lift[2]).toBeLessThanOrEqual(1);
      expect(out.lift[1]).toBeGreaterThanOrEqual(28);
      expect(out.lift[1]).toBeLessThanOrEqual(32);
      expect(out.cell.height).toBeGreaterThanOrEqual(16 + out.lift[1]);
    }, SLOW);
  });

  // ── inspect and align on pixel frames ────────────────────────────────────

  describe("head sway, pixel frames and the lattice", () => {
    /**
     * A motion dir by hand: cells/ hold a 12x24 figure standing still at
     * x = 16; frames/ hold the same figure shifted right by `shifts[i]` px, on
     * the same 44 px cell, with an align record claiming `xFrom` and (when
     * `pixel`) a 1x lattice.
     */
    function swayMotion(dir: string, shifts: number[], { xFrom, pixel }: { xFrom: string; pixel: boolean }) {
      for (const [i, dx] of shifts.entries()) {
        drawPng(join(dir, "cells", `0${i}.png`), 44, 44, [{ x: 16, y: 8, w: 12, h: 30 }]);
        drawPng(join(dir, "frames", `0${i}.png`), 44, 44, [{ x: 16 + dx, y: 8, w: 12, h: 30 }]);
      }
      writeFileSync(join(dir, "frames", "align.json"), JSON.stringify({
        anchor: "bottom", cell: { width: 44, height: 44 }, pad: 6, anchorPoint: { x: 22, y: 38 }, smooth: false, xFrom,
        ...(pixel ? { pixel: { scale: 1, pitch: { x: 1, y: 1 }, palette: null, outline: null } } : {}),
      }));
      return dir;
    }

    test("on pixel frames the bar is one block: half-pixel sway is the snap, not the alignment", () => {
      const ws = fresh();
      // Head offsets 0,1,0,1: a spread of 0.5 px, over the 1 % bar (0.44 px on
      // 44 px cells) but under one block.
      const report = runJson("inspect", swayMotion(join(ws, "m"), [0, 1, 0, 1], { xFrom: "trend", pixel: true }));
      expect(report.headDrift).toBe(0.5);
      expect(report.warnings.some((w: string) => w.startsWith("head sways"))).toBe(false);
      // The same frames without a lattice are judged on the 1 % bar.
      const smooth = runJson("inspect", swayMotion(join(ws, "s"), [0, 1, 0, 1], { xFrom: "trend", pixel: false }));
      expect(smooth.warnings.some((w: string) => w.startsWith("head sways"))).toBe(true);
    }, SLOW);

    test("the advice names pixel/ for a lattice and never the x mode already used", () => {
      const ws = fresh();
      const pixel = runJson("inspect", swayMotion(join(ws, "p"), [0, 3, 0, 3], { xFrom: "trend", pixel: true }));
      const said = pixel.warnings.find((w: string) => w.startsWith("head sways"));
      expect(said).toContain("the alignment (--x-from trend)");
      expect(said).toContain("re-align from pixel/ with --x-from cell (the placement as drawn)");
      expect(said).not.toContain("--x-from trend (");
      const cell = runJson("inspect", swayMotion(join(ws, "c"), [0, 3, 0, 3], { xFrom: "cell", pixel: false }));
      expect(cell.warnings.find((w: string) => w.startsWith("head sways"))).toMatch(/re-align from cells\/ with --x-from trend$/);
    }, SLOW);

    test("align refuses to drop a lattice by aligning un-snapped frames over it, unless --force", () => {
      const ws = fresh();
      const dir = swayMotion(join(ws, "m"), [0, 0], { xFrom: "feet", pixel: true });
      mkdirSync(join(dir, "pixel"));
      writeFileSync(join(dir, "pixel", "pixel.json"), JSON.stringify({ scale: 1, pitch: { x: 1, y: 1 } }));
      const refused = run("align", join(dir, "cells"), "--out", join(dir, "frames"), "--json");
      expect(refused.code).toBe(1);
      expect(refused.err).toContain("holds pixel-art frames snapped to a 1x lattice");
      expect(refused.err).toContain(`Align from ${join(dir, "pixel")} instead`);
      // Nothing was touched.
      expect(JSON.parse(readFileSync(join(dir, "frames", "align.json"), "utf-8")).pixel).toBeTruthy();
      const forced = runJson("align", join(dir, "cells"), "--out", join(dir, "frames"), "--force");
      expect(forced.warnings[0]).toMatch(/^replaced pixel-art frames \(a 1x lattice\)/);
      expect(JSON.parse(readFileSync(join(dir, "frames", "align.json"), "utf-8")).pixel).toBeUndefined();
    }, SLOW);

    test("headDrift is absent, not 0, when the frames cannot be compared", () => {
      const ws = fresh();
      const dir = join(ws, "m");
      drawPng(join(dir, "frames", "00.png"), 44, 44, [{ x: 16, y: 8, w: 12, h: 30 }]);
      drawPng(join(dir, "frames", "01.png"), 48, 44, [{ x: 16, y: 8, w: 12, h: 30 }]);
      const report = runJson("inspect", dir);
      expect("headDrift" in report).toBe(false);
      expect(run("inspect", dir).out).toContain("head drift n/a");
    }, SLOW);
  });

  // ── mirror ───────────────────────────────────────────────────────────────

  describe("mirror summary", () => {
    /** walk-right from a green-plate sheet packed at 2x nearest, registered. */
    function character(dir: string) {
      const sheet = drawPng(join(dir, "..", `${Math.random().toString(36).slice(2)}.png`), 128, 64,
        [{ x: 20, y: 17, w: 20, h: 30 }, { x: 84, y: 17, w: 20, h: 30 }, { x: 104, y: 20, w: 8, h: 6, color: "white" }], "0x00b140");
      const summary = runJson("run", sheet, "--rows", "1", "--cols", "2", "--out", join(dir, "motions", "walk-right"),
        "--name", "walk-right", "--fps", "8", "--loop", "--no-webp", "--scale", "2", "--nearest");
      writeFileSync(join(dir, "run.json"), JSON.stringify(summary));
      projectCmd(dir, "init", "--name", "Pip", "--cell", "64x64", "--facing", "right");
      projectCmd(dir, "add-motion", "--id", "walk-right", "--rows", "1", "--cols", "2", "--fps", "8", "--loop", "--direction", "right");
      projectCmd(dir, "register-run", "--motion", "walk-right", "--run", join(dir, "run.json"), "--at", "1000");
      projectCmd(dir, "add-motion", "--id", "walk-left", "--rows", "1", "--cols", "2", "--fps", "8", "--loop",
        "--source", "mirror", "--direction", "left");
      return summary;
    }

    test("carries the grid it packed, the source's plate, and repacks with the source's filter", () => {
      const dir = join(fresh(), "pip");
      const source = character(dir);
      expect(source.keyColor).toBeTruthy();
      const sourceAtlas = JSON.parse(readFileSync(join(dir, "motions", "walk-right", "atlas.json"), "utf-8"));
      expect(sourceAtlas.meta).toMatchObject({ scale: 2, filter: "nearest" });
      // A stale report in the mirror's directory must not lend its plate.
      mkdirSync(join(dir, "motions", "walk-left"), { recursive: true });
      writeFileSync(join(dir, "motions", "walk-left", "inspect.json"), JSON.stringify({ keyColor: "#ff00ff" }));

      const json = runJson("mirror", join(dir, "motions", "walk-right"), "--name", "walk-left");
      expect(json).toMatchObject({ grid: { rows: 1, cols: 2 }, fps: 8, loop: true, anchor: "bottom", scale: 2, nearest: true });
      expect(typeof json.inspect.keyResidue).toBe("number");
      const report = JSON.parse(readFileSync(join(dir, "motions", "walk-left", "inspect.json"), "utf-8"));
      expect(report.keyColor).toBe(source.keyColor);
      const atlas = JSON.parse(readFileSync(join(dir, "motions", "walk-left", "atlas.json"), "utf-8"));
      expect(atlas.meta.filter).toBe("nearest");
    }, SLOW);
  });

  // ── sizes ────────────────────────────────────────────────────────────────

  describe("sizes", () => {
    function twoMotions(dir: string, heights: [number, number]) {
      projectCmd(dir, "init", "--name", "Pip", "--cell", "64x64", "--facing", "right");
      for (const [i, id] of ["idle", "walk"].entries()) {
        const h = heights[i];
        const sheet = drawPng(join(dir, "..", `${id}-${h}.png`), 128, 64, [
          { x: 20, y: 60 - h, w: 20, h }, { x: 84, y: 60 - h, w: 20, h },
        ]);
        const summary = runJson("run", sheet, "--rows", "1", "--cols", "2", "--out", join(dir, "motions", id),
          "--name", id, "--fps", "8", "--loop", "--no-webp");
        writeFileSync(join(dir, `${id}.json`), JSON.stringify(summary));
        projectCmd(dir, "add-motion", "--id", id, "--rows", "1", "--cols", "2", "--fps", "8", "--loop");
        projectCmd(dir, "register-run", "--motion", id, "--run", join(dir, `${id}.json`), "--at", String(1000 + i));
      }
    }

    test("names the tallest and shortest motion when they differ past the bar, and draws them", () => {
      const dir = join(fresh(), "pip");
      twoMotions(dir, [50, 46]);
      const out = runJson("sizes", dir, "--out", join(dir, "..", "sizes.png"));
      expect(out.motions.map((m: { id: string; height: { shipped: number } }) => [m.id, m.height.shipped])).toEqual([["idle", 50], ["walk", 46]]);
      expect(out).toMatchObject({ tallest: "idle", shortest: "walk", reference: 48 });
      expect(out.spread).toBeCloseTo(4 / 46, 4);
      expect(out.warnings[0]).toContain("idle stands 50 px");
      expect(existsSync(join(dir, "..", "sizes.png"))).toBe(true);
      // Nothing was written into the character's record.
      expect(existsSync(join(dir, "sizes.png"))).toBe(false);
    }, SLOW);

    test("says nothing within the bar, and refuses a comparison of one", () => {
      const dir = join(fresh(), "pip");
      twoMotions(dir, [50, 49]);
      const out = runJson("sizes", dir);
      expect(out.warnings).toEqual([]);
      expect(existsSync(join(dir, "sizes.png"))).toBe(true);
      const one = run("sizes", dir, "--motions", "idle", "--json");
      expect(one.code).toBe(1);
      expect(one.err).toMatch(/--motions: name at least two motions/);
    }, SLOW);
  });

  // ── flatten ──────────────────────────────────────────────────────────────

  test("flatten says --facing places nothing in a tall or square room, and the help prints whole percentages", () => {
    const ws = fresh();
    const still = drawPng(join(ws, "still.png"), 40, 60, [{ x: 10, y: 10, w: 20, h: 50 }]);
    const out = runJson("flatten", still, "--out", join(ws, "flat.png"), "--room", "tall", "--facing", "left");
    expect(out.warnings).toContain("--facing left places only a wide room (the lead goes in front); a tall room centres the picture, so it was not used");
    const wide = runJson("flatten", still, "--out", join(ws, "wide.png"), "--room", "wide", "--facing", "left");
    expect(wide.warnings.some((w: string) => w.startsWith("--facing"))).toBe(false);
    const help = run("--help").out;
    expect(help).toContain("28% of the width in front");
    expect(help).not.toMatch(/\d\.\d{6,}%/);
  }, SLOW);
});

/**
 * sprite-sheet.mjs — the deterministic half of the sprite pipeline, pinned as
 * a real process (that is how the agent calls it).
 *
 * Every fixture is drawn by ffmpeg at test time (see
 * `fixtures/pipeline/make-sheet.mjs`); nothing binary is committed. The whole
 * file skips with a named reason when ffmpeg is missing — the routine suite
 * must stay green on a machine without it.
 */

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildSheet, readBbox } from "./fixtures/pipeline/make-sheet.mjs";

const SCRIPT = join(import.meta.dir, "..", "skill", "scripts", "sprite-sheet.mjs");

const HAS_FFMPEG =
  spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0 &&
  spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0;

if (!HAS_FFMPEG) {
  console.warn("(skip) modes/sprite sprite-sheet.mjs suite — ffmpeg/ffprobe not on PATH");
}

const HAS_LIBWEBP = HAS_FFMPEG &&
  spawnSync("ffmpeg", ["-hide_banner", "-encoders"], { encoding: "utf-8" }).stdout?.includes("libwebp") === true;

function run(...argv: string[]) {
  const r = Bun.spawnSync([process.execPath, SCRIPT, ...argv], {
    cwd: import.meta.dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
}

function runJson(...argv: string[]) {
  const r = run(...argv, "--json");
  if (r.code !== 0) throw new Error(`sprite-sheet ${argv[0]} failed (${r.code}):\n${r.err}`);
  return JSON.parse(r.out);
}

const workspaces: string[] = [];
function fresh() {
  const dir = mkdtempSync(join(tmpdir(), "sprite-sheet-"));
  workspaces.push(dir);
  return dir;
}

function cleanupAll() {
  for (const dir of workspaces.splice(0)) rmSync(dir, { recursive: true, force: true });
}

describe.skipIf(!HAS_FFMPEG)("sprite-sheet.mjs", () => {
  test("--help exits 0 and lists every subcommand", () => {
    const r = run("--help");
    expect(r.code).toBe(0);
    for (const cmd of ["probe", "key", "flatten", "slice", "align", "pack", "gif", "inspect", "run"]) {
      expect(r.out + r.err).toContain(cmd);
    }
  });

  test("an unknown subcommand fails loudly", () => {
    const r = run("frobnicate");
    expect(r.code).toBe(1);
    expect(r.err).toContain("ERROR:");
  });

  describe("probe", () => {
    test("reports alpha on a transparent sheet", () => {
      const ws = fresh();
      const sheet = buildSheet(join(ws, "sheet.png"));
      const out = runJson("probe", sheet);
      expect(out.width).toBe(128);
      expect(out.height).toBe(128);
      expect(out.hasAlpha).toBe(true);
      // four 30x30 squares in a 128x128 sheet
      expect(out.alphaCoverage).toBeCloseTo(3600 / 16384, 4);
      expect(out.cornerColor).toMatch(/^#[0-9a-f]{6}$/);
    });

    test("reports an opaque sheet as fully covered with its corner colour", () => {
      const ws = fresh();
      const sheet = buildSheet(join(ws, "green.png"), { background: "0x00b140" });
      const out = runJson("probe", sheet);
      expect(out.hasAlpha).toBe(false);
      expect(out.alphaCoverage).toBe(1);
      expect(out.cornerColor).toBe("#00b140");
    });
  });

  describe("key", () => {
    test("turns an opaque green background transparent", () => {
      const ws = fresh();
      const sheet = buildSheet(join(ws, "green.png"), { background: "0x00b140" });
      const before = runJson("probe", sheet);
      expect(before.alphaCoverage).toBe(1);

      const out = runJson("key", sheet, "--out", join(ws, "sheet-alpha.png"), "--color", "auto");
      expect(out.color).toBe("#00b140");
      expect(out.alphaCoverage).toBeLessThan(0.5);
      expect(readBbox(join(ws, "sheet-alpha.png")).coverage).toBeCloseTo(3600 / 16384, 3);
    });

    test("accepts an explicit key colour", () => {
      const ws = fresh();
      const sheet = buildSheet(join(ws, "green.png"), { background: "0x00b140" });
      const out = runJson("key", sheet, "--out", join(ws, "keyed.png"), "--color", "#00b140");
      expect(out.color).toBe("#00b140");
      expect(out.alphaCoverage).toBeLessThan(0.5);
    });
  });

  describe("flatten", () => {
    test("composites a transparent sheet onto a solid colour", () => {
      const ws = fresh();
      const sheet = buildSheet(join(ws, "sheet.png"));
      const out = runJson("flatten", sheet, "--out", join(ws, "flat.png"), "--bg", "#ffffff");
      expect(out.output).toContain("flat.png");
      expect(readBbox(join(ws, "flat.png")).coverage).toBe(1);
    });
  });

  describe("slice", () => {
    test("yields four 64x64 RGBA cells row-major", () => {
      const ws = fresh();
      const sheet = buildSheet(join(ws, "sheet.png"));
      const out = runJson("slice", sheet, "--rows", "2", "--cols", "2", "--out", join(ws, "cells"));
      expect(out.cell).toEqual({ width: 64, height: 64 });
      expect(out.exact).toBe(true);
      expect(out.frames).toHaveLength(4);
      expect(readdirSync(join(ws, "cells")).sort()).toEqual(["00.png", "01.png", "02.png", "03.png"]);
      // row-major: cell 0 keeps the top-left square at its cell-local offset
      expect(readBbox(join(ws, "cells", "00.png"))).toMatchObject({
        width: 64,
        height: 64,
        bbox: { x: 10, y: 20, w: 30, h: 30 },
      });
      expect(readBbox(join(ws, "cells", "03.png")).bbox).toEqual({ x: 16, y: 28, w: 30, h: 30 });
    });

    test("reports a floored, inexact cell size instead of silently rounding", () => {
      const ws = fresh();
      const sheet = buildSheet(join(ws, "sheet.png"));
      const out = runJson("slice", sheet, "--rows", "2", "--cols", "3", "--out", join(ws, "cells3"));
      expect(out.cell.width).toBe(42); // floor(128 / 3)
      expect(out.exact).toBe(false);
      expect(out.remainder).toEqual({ x: 2, y: 0 });
    });
  });

  describe("align", () => {
    test("bottom anchor lands every frame on the same point", () => {
      const ws = fresh();
      const sheet = buildSheet(join(ws, "sheet.png"));
      runJson("slice", sheet, "--rows", "2", "--cols", "2", "--out", join(ws, "cells"));
      const out = runJson("align", join(ws, "cells"), "--out", join(ws, "frames"), "--anchor", "bottom", "--pad", "8");

      expect(out.cell).toEqual({ width: 46, height: 46 }); // 30 + 2*8, made even
      expect(out.frames).toHaveLength(4);
      expect(out.emptyFrames).toEqual([]);

      const anchors = ["00", "01", "02", "03"].map((n) => {
        const { bbox, width, height } = readBbox(join(ws, "frames", `${n}.png`));
        expect(width).toBe(46);
        expect(height).toBe(46);
        return { x: bbox!.x + bbox!.w / 2, y: bbox!.y + bbox!.h };
      });
      for (const a of anchors) expect(a).toEqual(anchors[0]);
      expect(anchors[0]).toEqual({ x: 23, y: 38 }); // centred, sitting `pad` above the floor
    });

    test("center anchor centres the bbox in the cell", () => {
      const ws = fresh();
      const sheet = buildSheet(join(ws, "sheet.png"));
      runJson("slice", sheet, "--rows", "2", "--cols", "2", "--out", join(ws, "cells"));
      runJson("align", join(ws, "cells"), "--out", join(ws, "frames"), "--anchor", "center", "--pad", "8");
      for (const n of ["00", "01", "02", "03"]) {
        expect(readBbox(join(ws, "frames", `${n}.png`)).bbox).toEqual({ x: 8, y: 8, w: 30, h: 30 });
      }
    });

    test("an empty cell becomes a transparent frame and is reported", () => {
      const ws = fresh();
      const sheet = buildSheet(join(ws, "gap.png"), { cells: [0, 1, 3] });
      runJson("slice", sheet, "--rows", "2", "--cols", "2", "--out", join(ws, "cells"));
      const out = runJson("align", join(ws, "cells"), "--out", join(ws, "frames"));
      expect(out.emptyFrames).toEqual([2]);
      expect(readBbox(join(ws, "frames", "02.png")).bbox).toBeNull();
      expect(out.warnings.join(" ")).toContain("frame 02 is empty");
    });

    test("--smooth keeps the body still when one frame's bbox grows a stray limb", () => {
      const ws = fresh();
      // Three identical bodies; frame 01 also has a small limb sticking out to
      // the right, which widens its bbox and drags its centre with it.
      const sheet = buildSheet(join(ws, "limb.png"), {
        rows: 1, cols: 3,
        squares: [{ x: 17, y: 17, color: "red" }],
        extras: [{ index: 1, x: 53, y: 20, w: 6, h: 6 }],
      });
      runJson("slice", sheet, "--rows", "1", "--cols", "3", "--out", join(ws, "cells"));

      runJson("align", join(ws, "cells"), "--out", join(ws, "plain"), "--pad", "8");
      const plain = ["00", "01", "02"].map((n) => readBbox(join(ws, "plain", `${n}.png`)).bbox!.x);
      // bbox-centred alignment shoves the body sideways on the odd frame
      expect(plain[0]).toBe(14);
      expect(plain[1]).toBe(8);
      expect(plain[2]).toBe(14);

      runJson("align", join(ws, "cells"), "--out", join(ws, "smoothed"), "--pad", "8", "--smooth");
      const smoothed = ["00", "01", "02"].map((n) => readBbox(join(ws, "smoothed", `${n}.png`)).bbox!.x);
      expect(smoothed).toEqual([14, 14, 14]);
    });

    test("an explicit cell smaller than the artwork fails with the required size", () => {
      const ws = fresh();
      const sheet = buildSheet(join(ws, "sheet.png"));
      runJson("slice", sheet, "--rows", "2", "--cols", "2", "--out", join(ws, "cells"));
      const r = run("align", join(ws, "cells"), "--out", join(ws, "frames"), "--cell", "16x16", "--json");
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/ERROR: .*30x30/);
    });
  });

  describe("pack", () => {
    test("writes a packed sheet and a schema-shaped atlas", () => {
      const ws = fresh();
      const sheet = buildSheet(join(ws, "sheet.png"));
      runJson("slice", sheet, "--rows", "2", "--cols", "2", "--out", join(ws, "cells"));
      runJson("align", join(ws, "cells"), "--out", join(ws, "frames"), "--pad", "17"); // 30 + 34 = 64px cell

      const out = runJson(
        "pack", join(ws, "frames"),
        "--out", join(ws, "sheet-packed.png"),
        "--atlas", join(ws, "atlas.json"),
        "--name", "bounce", "--fps", "8", "--loop", "--cols", "2",
      );
      expect(out.size).toEqual({ w: 128, h: 128 });
      expect(readBbox(join(ws, "sheet-packed.png"))).toMatchObject({ width: 128, height: 128 });

      const atlas = JSON.parse(readFileSync(join(ws, "atlas.json"), "utf-8"));
      expect(atlas.meta).toEqual({
        app: "pneuma-sprite",
        version: 1,
        image: "sheet-packed.png",
        size: { w: 128, h: 128 },
        scale: 1,
        fps: 8,
        loop: true,
        anchor: "bottom",
      });
      expect(Object.keys(atlas.frames)).toEqual(["bounce_00", "bounce_01", "bounce_02", "bounce_03"]);
      expect(atlas.frames.bounce_00).toEqual({
        frame: { x: 0, y: 0, w: 64, h: 64 },
        rotated: false,
        trimmed: false,
        spriteSourceSize: { x: 0, y: 0, w: 64, h: 64 },
        sourceSize: { w: 64, h: 64 },
        pivot: { x: 0.5, y: 1 },
        duration: 125,
      });
      expect(atlas.frames.bounce_03.frame).toEqual({ x: 64, y: 64, w: 64, h: 64 });
      expect(atlas.animations).toEqual({ bounce: ["bounce_00", "bounce_01", "bounce_02", "bounce_03"] });
    });

    test("the packed sheet keeps the transparent gutter of an unfilled cell", () => {
      const ws = fresh();
      const sheet = buildSheet(join(ws, "sheet.png"), { rows: 1, cols: 3 });
      runJson("slice", sheet, "--rows", "1", "--cols", "3", "--out", join(ws, "cells"));
      runJson("align", join(ws, "cells"), "--out", join(ws, "frames"), "--pad", "17");
      const out = runJson(
        "pack", join(ws, "frames"),
        "--out", join(ws, "packed.png"), "--atlas", join(ws, "atlas.json"),
        "--name", "walk", "--fps", "12", "--cols", "2",
      );
      // 3 frames at 2 columns => 2 rows, the fourth slot must stay transparent
      expect(out.size).toEqual({ w: 128, h: 128 });
      const packed = readBbox(join(ws, "packed.png"));
      expect(packed.coverage).toBeCloseTo((3 * 900) / (128 * 128), 3);
      const atlas = JSON.parse(readFileSync(join(ws, "atlas.json"), "utf-8"));
      expect(atlas.meta.loop).toBe(false);
      expect(atlas.frames.walk_00.duration).toBe(83); // round(1000/12)
      expect(atlas.frames.walk_00.pivot).toEqual({ x: 0.5, y: 1 });
    });

    test("--scale --nearest resizes every cell before packing", () => {
      const ws = fresh();
      const sheet = buildSheet(join(ws, "sheet.png"));
      runJson("slice", sheet, "--rows", "2", "--cols", "2", "--out", join(ws, "cells"));
      runJson("align", join(ws, "cells"), "--out", join(ws, "frames"), "--pad", "17");
      const out = runJson(
        "pack", join(ws, "frames"),
        "--out", join(ws, "packed.png"), "--atlas", join(ws, "atlas.json"),
        "--name", "bounce", "--fps", "8", "--cols", "2", "--scale", "0.5", "--nearest",
      );
      expect(out.size).toEqual({ w: 64, h: 64 });
      const atlas = JSON.parse(readFileSync(join(ws, "atlas.json"), "utf-8"));
      expect(atlas.meta.scale).toBe(0.5);
      expect(atlas.frames.bounce_00.frame).toEqual({ x: 0, y: 0, w: 32, h: 32 });
      expect(atlas.frames.bounce_00.sourceSize).toEqual({ w: 32, h: 32 });
    });
  });

  describe("gif", () => {
    test("writes a looping GIF that keeps the transparent background", () => {
      const ws = fresh();
      const sheet = buildSheet(join(ws, "sheet.png"));
      runJson("slice", sheet, "--rows", "2", "--cols", "2", "--out", join(ws, "cells"));
      runJson("align", join(ws, "cells"), "--out", join(ws, "frames"), "--pad", "17");

      const out = runJson("gif", join(ws, "frames"), "--out", join(ws, "preview.gif"), "--fps", "8", "--loop");
      expect(out.frameCount).toBe(4);
      expect(out.loop).toBe(true);
      const bytes = readFileSync(join(ws, "preview.gif"));
      expect(bytes.subarray(0, 6).toString("latin1")).toBe("GIF89a");
      // the palette chain must reserve a transparent entry
      expect(readBbox(join(ws, "preview.gif")).coverage).toBeLessThan(0.5);
    });

    test.skipIf(!HAS_LIBWEBP)("writes an animated WebP with an alpha channel", () => {
      const ws = fresh();
      const sheet = buildSheet(join(ws, "sheet.png"));
      runJson("slice", sheet, "--rows", "2", "--cols", "2", "--out", join(ws, "cells"));
      runJson("align", join(ws, "cells"), "--out", join(ws, "frames"), "--pad", "17");
      const out = runJson(
        "gif", join(ws, "frames"), "--out", join(ws, "preview.gif"),
        "--fps", "8", "--loop", "--webp", join(ws, "preview.webp"),
      );
      expect(out.webp).toContain("preview.webp");
      const bytes = readFileSync(join(ws, "preview.webp"));
      expect(bytes.subarray(0, 4).toString("latin1")).toBe("RIFF");
      expect(bytes.subarray(8, 12).toString("latin1")).toBe("WEBP");
      // VP8X flag byte: 0x10 = alpha, 0x02 = animation
      const flags = bytes[20]!;
      expect(flags & 0x10).toBe(0x10);
      expect(flags & 0x02).toBe(0x02);
    });

    test("--width rescales the preview", () => {
      const ws = fresh();
      const sheet = buildSheet(join(ws, "sheet.png"));
      runJson("slice", sheet, "--rows", "2", "--cols", "2", "--out", join(ws, "cells"));
      runJson("align", join(ws, "cells"), "--out", join(ws, "frames"), "--pad", "17");
      const out = runJson(
        "gif", join(ws, "frames"), "--out", join(ws, "small.gif"),
        "--fps", "8", "--no-loop", "--width", "32",
      );
      expect(out.loop).toBe(false);
      expect(out.width).toBe(32);
      expect(readBbox(join(ws, "small.gif")).width).toBe(32);
    });
  });

  describe("inspect", () => {
    test("a clean aligned motion produces zero warnings", () => {
      const ws = fresh();
      const sheet = buildSheet(join(ws, "sheet.png"));
      runJson("slice", sheet, "--rows", "2", "--cols", "2", "--out", join(ws, "cells"));
      runJson("align", join(ws, "cells"), "--out", join(ws, "motion", "frames"), "--pad", "17");

      const out = runJson("inspect", join(ws, "motion"));
      expect(out.frameCount).toBe(4);
      expect(out.cell).toEqual({ width: 64, height: 64 });
      expect(out.anchorDrift).toEqual({ x: 0, y: 0 });
      expect(out.maxJump).toBe(0);
      expect(out.scaleDrift).toBe(0);
      expect(out.emptyFrames).toEqual([]);
      expect(out.warnings).toEqual([]);
      expect(out.frames).toHaveLength(4);
      expect(JSON.parse(readFileSync(join(ws, "motion", "inspect.json"), "utf-8")).frameCount).toBe(4);
    });

    test("flags an injected empty cell", () => {
      const ws = fresh();
      const sheet = buildSheet(join(ws, "gap.png"), { cells: [0, 1, 3] });
      runJson("slice", sheet, "--rows", "2", "--cols", "2", "--out", join(ws, "cells"));
      runJson("align", join(ws, "cells"), "--out", join(ws, "motion", "frames"), "--pad", "17");

      const out = runJson("inspect", join(ws, "motion"));
      expect(out.emptyFrames).toEqual([2]);
      expect(out.warnings.join(" ")).toContain("frame 02 is empty");
    });

    test("flags a cell whose drawing touches the grid edge", () => {
      const ws = fresh();
      const sheet = buildSheet(join(ws, "sheet.png"));
      runJson("slice", sheet, "--rows", "2", "--cols", "2", "--out", join(ws, "cells"));
      runJson("align", join(ws, "cells"), "--out", join(ws, "motion", "frames"), "--pad", "0");
      const out = runJson("inspect", join(ws, "motion"), "--cells", join(ws, "motion", "frames"));
      expect(out.warnings.join(" ")).toContain("clipped");
    });
  });

  describe("run", () => {
    test("drives probe → slice → align → pack → gif → inspect on a transparent sheet", () => {
      const ws = fresh();
      const raw = buildSheet(join(ws, "raw.png"));
      const motionDir = join(ws, "motions", "bounce");
      const out = runJson(
        "run", raw, "--rows", "2", "--cols", "2", "--out", motionDir,
        "--name", "bounce", "--fps", "8", "--loop", "--anchor", "bottom", "--pad", "17",
      );

      expect(out.motionDir).toBe(motionDir);
      expect(out.keyed).toBe(false);
      expect(out.sheetAlpha).toBeUndefined();
      expect(out.cell).toEqual({ width: 64, height: 64 });
      expect(out.frames).toHaveLength(4);
      expect(out.inspect).toEqual({
        frameCount: 4,
        cell: { width: 64, height: 64 },
        anchorDrift: { x: 0, y: 0 },
        maxJump: 0,
        scaleDrift: 0,
        emptyFrames: [],
        warnings: [],
      });

      // the input is copied, never moved
      expect(existsSync(raw)).toBe(true);
      expect(existsSync(join(motionDir, "sheet-raw.png"))).toBe(true);
      for (const rel of ["sheet.png", "atlas.json", "preview.gif", "inspect.json"]) {
        expect(existsSync(join(motionDir, rel))).toBe(true);
      }
      expect(readdirSync(join(motionDir, "frames")).sort()).toEqual(["00.png", "01.png", "02.png", "03.png"]);
      // no temp/scratch litter left behind
      expect(readdirSync(motionDir).filter((f) => f.includes("tmp"))).toEqual([]);
      const atlas = JSON.parse(readFileSync(join(motionDir, "atlas.json"), "utf-8"));
      expect(atlas.animations.bounce).toHaveLength(4);
      expect(atlas.meta.image).toBe("sheet.png");
    });

    test("keys an opaque sheet automatically and records sheet-alpha", () => {
      const ws = fresh();
      const raw = buildSheet(join(ws, "raw.png"), { background: "0x00b140" });
      const motionDir = join(ws, "motions", "bounce");
      const out = runJson(
        "run", raw, "--rows", "2", "--cols", "2", "--out", motionDir,
        "--name", "bounce", "--fps", "8", "--key", "auto", "--pad", "17",
      );
      expect(out.keyed).toBe(true);
      expect(out.keyColor).toBe("#00b140");
      expect(out.sheetAlpha).toBe(join(motionDir, "sheet-alpha.png"));
      expect(readBbox(join(motionDir, "sheet-alpha.png")).coverage).toBeLessThan(0.5);
      expect(out.inspect.emptyFrames).toEqual([]);
      expect(readBbox(join(motionDir, "frames", "00.png")).bbox).toEqual({ x: 17, y: 17, w: 30, h: 30 });
    });

    test("--key none leaves an opaque sheet alone", () => {
      const ws = fresh();
      const raw = buildSheet(join(ws, "raw.png"), { background: "0x00b140" });
      const motionDir = join(ws, "motions", "flat");
      const out = runJson(
        "run", raw, "--rows", "2", "--cols", "2", "--out", motionDir,
        "--name", "flat", "--fps", "8", "--key", "none",
      );
      expect(out.keyed).toBe(false);
      expect(existsSync(join(motionDir, "sheet-alpha.png"))).toBe(false);
      // an opaque cell fills its whole frame, so the aligned cell equals the slice
      expect(out.cell).toEqual({ width: 80, height: 80 });
    });

    test("is idempotent — a second run over the same motion dir replaces the frames", () => {
      const ws = fresh();
      const raw = buildSheet(join(ws, "raw.png"));
      const motionDir = join(ws, "motions", "bounce");
      const args = [
        "run", raw, "--rows", "2", "--cols", "2", "--out", motionDir,
        "--name", "bounce", "--fps", "8", "--pad", "17",
      ];
      runJson(...args);
      const second = runJson(...args);
      expect(second.frames).toHaveLength(4);
      expect(readdirSync(join(motionDir, "frames")).sort()).toEqual(["00.png", "01.png", "02.png", "03.png"]);
    });

    test("a shrinking frame count leaves no stale frame files", () => {
      const ws = fresh();
      const motionDir = join(ws, "motions", "bounce");
      runJson(
        "run", buildSheet(join(ws, "four.png")), "--rows", "2", "--cols", "2",
        "--out", motionDir, "--name", "bounce", "--fps", "8", "--pad", "17",
      );
      runJson(
        "run", buildSheet(join(ws, "two.png"), { rows: 1, cols: 2 }), "--rows", "1", "--cols", "2",
        "--out", motionDir, "--name", "bounce", "--fps", "8", "--pad", "17",
      );
      expect(readdirSync(join(motionDir, "frames")).sort()).toEqual(["00.png", "01.png"]);
    });
  });

  test("cleanup", () => {
    cleanupAll();
    expect(workspaces).toHaveLength(0);
  });
});

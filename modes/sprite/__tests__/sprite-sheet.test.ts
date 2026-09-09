/**
 * sprite-sheet.mjs — the deterministic half of the sprite pipeline, pinned as
 * a real process (that is how the agent calls it).
 *
 * Every fixture is drawn by ffmpeg at test time (see
 * `fixtures/pipeline/make-sheet.mjs`); nothing binary is committed. The whole
 * file skips with a named reason when ffmpeg is missing — the routine suite
 * must stay green on a machine without it.
 *
 * Each sheet, cell set and aligned frame set is built ONCE and copied into a
 * fresh workspace per test: an ffmpeg spawn costs ~40 ms and a `cpSync` of
 * four small PNGs costs nothing, so the read-only cases share pixels instead
 * of redrawing them. Only the cases that are *about* slicing, aligning or
 * `run` drive those steps themselves.
 */

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildSheet, readBbox } from "./fixtures/pipeline/make-sheet.mjs";
import type { BuildSheetOptions } from "./fixtures/pipeline/make-sheet.mjs";

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

// ---------------------------------------------------------------------------
// Shared, built-once fixtures
// ---------------------------------------------------------------------------

const built = new Map<string, string>();
let sharedRoot: string | null = null;

function shared(): string {
  if (!sharedRoot) sharedRoot = fresh();
  return sharedRoot;
}

/** A sheet drawn once and never written to again. */
function sheet(name: string, options?: BuildSheetOptions): string {
  const key = `sheet:${name}`;
  if (!built.has(key)) built.set(key, buildSheet(join(shared(), `${name}.png`), options));
  return built.get(key)!;
}

/** A directory of NN.png produced once by `make`, then copied per test. */
function stage(name: string, make: (out: string) => void): string {
  const key = `dir:${name}`;
  if (!built.has(key)) {
    const out = join(shared(), name);
    make(out);
    built.set(key, out);
  }
  return built.get(key)!;
}

const SHEETS = {
  /** 2x2, transparent, one 30x30 square per cell at a different offset. */
  plain: () => sheet("plain"),
  /** The same drawing on an opaque green background. */
  green: () => sheet("green", { background: "0x00b140" }),
  /** 2x2 with cell 02 left empty. */
  gap: () => sheet("gap", { cells: [0, 1, 3] }),
  /** 1x3, three identical bodies. */
  wide: () => sheet("wide", { rows: 1, cols: 3 }),
  /** 1x2 — the cheapest sheet that still has more than one frame. */
  pair: () => sheet("pair", { rows: 1, cols: 2 }),
  /** 1x3; frame 01 grows a stray limb that widens its bbox. */
  limb: () => sheet("limb", {
    rows: 1, cols: 3,
    squares: [{ x: 17, y: 17, color: "red" }],
    extras: [{ index: 1, x: 53, y: 20, w: 6, h: 6 }],
  }),
  /** 1x3 whose drawing sits in the cell corner (clipped) plus the stray limb. */
  clipped: () => sheet("clipped", {
    rows: 1, cols: 3,
    squares: [{ x: 0, y: 0, color: "red" }],
    extras: [{ index: 1, x: 53, y: 20, w: 6, h: 6 }],
  }),
};

const cellsOf = (name: keyof typeof SHEETS, rows: number, cols: number) =>
  stage(`cells-${name}`, (out) => {
    runJson("slice", SHEETS[name](), "--rows", String(rows), "--cols", String(cols), "--out", out);
  });

const framesOf = (name: keyof typeof SHEETS, rows: number, cols: number, pad: number) =>
  stage(`frames-${name}-${pad}`, (out) => {
    runJson("align", cellsOf(name, rows, cols), "--out", out, "--pad", String(pad));
  });

/** Copy a prepared frame set into a workspace under `<ws>/<name>`. */
function useFrames(ws: string, source: string, name = "frames"): string {
  const dest = join(ws, name);
  cpSync(source, dest, { recursive: true });
  return dest;
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
      const out = runJson("probe", SHEETS.plain());
      expect(out.width).toBe(128);
      expect(out.height).toBe(128);
      expect(out.hasAlpha).toBe(true);
      // four 30x30 squares in a 128x128 sheet
      expect(out.alphaCoverage).toBeCloseTo(3600 / 16384, 4);
      expect(out.cornerColor).toMatch(/^#[0-9a-f]{6}$/);
    });

    test("reports an opaque sheet as fully covered with its corner colour", () => {
      const out = runJson("probe", SHEETS.green());
      expect(out.hasAlpha).toBe(false);
      expect(out.alphaCoverage).toBe(1);
      expect(out.cornerColor).toBe("#00b140");
    });
  });

  describe("key", () => {
    test("turns an opaque green background transparent", () => {
      const ws = fresh();
      const before = runJson("probe", SHEETS.green());
      expect(before.alphaCoverage).toBe(1);

      const out = runJson("key", SHEETS.green(), "--out", join(ws, "sheet-alpha.png"), "--color", "auto");
      expect(out.color).toBe("#00b140");
      expect(out.alphaCoverage).toBeLessThan(0.5);
      expect(readBbox(join(ws, "sheet-alpha.png")).coverage).toBeCloseTo(3600 / 16384, 3);
    });

    test("accepts an explicit key colour", () => {
      const ws = fresh();
      const out = runJson("key", SHEETS.green(), "--out", join(ws, "keyed.png"), "--color", "#00b140");
      expect(out.color).toBe("#00b140");
      expect(out.alphaCoverage).toBeLessThan(0.5);
    });
  });

  describe("flatten", () => {
    test("composites a transparent sheet onto a solid colour", () => {
      const ws = fresh();
      const out = runJson("flatten", SHEETS.plain(), "--out", join(ws, "flat.png"), "--bg", "#ffffff");
      expect(out.output).toContain("flat.png");
      expect(readBbox(join(ws, "flat.png")).coverage).toBe(1);
    });
  });

  describe("slice", () => {
    test("yields four 64x64 RGBA cells row-major", () => {
      const ws = fresh();
      const out = runJson("slice", SHEETS.plain(), "--rows", "2", "--cols", "2", "--out", join(ws, "cells"));
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
      const out = runJson("slice", SHEETS.plain(), "--rows", "2", "--cols", "3", "--out", join(ws, "cells3"));
      expect(out.cell.width).toBe(42); // floor(128 / 3)
      expect(out.exact).toBe(false);
      expect(out.remainder).toEqual({ x: 2, y: 0 });
    });
  });

  describe("align", () => {
    test("bottom anchor lands every frame on the same point", () => {
      const ws = fresh();
      const out = runJson("align", cellsOf("plain", 2, 2), "--out", join(ws, "frames"), "--anchor", "bottom", "--pad", "8");

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
      runJson("align", cellsOf("plain", 2, 2), "--out", join(ws, "frames"), "--anchor", "center", "--pad", "8");
      for (const n of ["00", "01", "02", "03"]) {
        expect(readBbox(join(ws, "frames", `${n}.png`)).bbox).toEqual({ x: 8, y: 8, w: 30, h: 30 });
      }
    });

    test("an empty cell becomes a transparent frame and is reported", () => {
      const ws = fresh();
      const out = runJson("align", cellsOf("gap", 2, 2), "--out", join(ws, "frames"));
      expect(out.emptyFrames).toEqual([2]);
      expect(readBbox(join(ws, "frames", "02.png")).bbox).toBeNull();
      expect(out.warnings.join(" ")).toContain("frame 02 is empty");
    });

    test("--smooth keeps the body still when one frame's bbox grows a stray limb", () => {
      const ws = fresh();
      // Three identical bodies; frame 01 also has a small limb sticking out to
      // the right, which widens its bbox and drags its centre with it.
      const cells = cellsOf("limb", 1, 3);

      runJson("align", cells, "--out", join(ws, "plain"), "--pad", "8");
      const plain = ["00", "01", "02"].map((n) => readBbox(join(ws, "plain", `${n}.png`)).bbox!.x);
      // bbox-centred alignment shoves the body sideways on the odd frame
      expect(plain[0]).toBe(14);
      expect(plain[1]).toBe(8);
      expect(plain[2]).toBe(14);

      runJson("align", cells, "--out", join(ws, "smoothed"), "--pad", "8", "--smooth");
      const smoothed = ["00", "01", "02"].map((n) => readBbox(join(ws, "smoothed", `${n}.png`)).bbox!.x);
      expect(smoothed).toEqual([14, 14, 14]);
    });

    test("records the anchor point it used next to the frames", () => {
      const ws = fresh();
      const out = runJson("align", cellsOf("plain", 2, 2), "--out", join(ws, "frames"), "--pad", "8");

      // `pack` has no way to measure this itself — it sees uniform cells and
      // cannot tell padding from artwork — so align has to leave it behind.
      expect(out.anchorPoint).toEqual({ x: 23, y: 38 }); // W/2, H - pad
      expect(out.alignRecord).toBe(join(ws, "frames", "align.json"));
      expect(JSON.parse(readFileSync(join(ws, "frames", "align.json"), "utf-8"))).toEqual({
        anchor: "bottom",
        cell: { width: 46, height: 46 },
        pad: 8,
        anchorPoint: { x: 23, y: 38 },
        smooth: false,
      });
    });

    test("re-aligning the same directory replaces the record, never leaves a stale one", () => {
      const ws = fresh();
      const frames = join(ws, "frames");
      runJson("align", cellsOf("plain", 2, 2), "--out", frames, "--pad", "8");
      runJson("align", cellsOf("plain", 2, 2), "--out", frames, "--pad", "8", "--anchor", "center");

      const record = JSON.parse(readFileSync(join(frames, "align.json"), "utf-8"));
      expect(record.anchor).toBe("center");
      expect(record.anchorPoint).toEqual({ x: 23, y: 23 });
    });

    test("an explicit cell smaller than the artwork fails with the required size", () => {
      const ws = fresh();
      const r = run("align", cellsOf("plain", 2, 2), "--out", join(ws, "frames"), "--cell", "16x16", "--json");
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/ERROR: .*30x30/);
    });
  });

  describe("pack", () => {
    test("writes a packed sheet and a schema-shaped atlas", () => {
      const ws = fresh();
      const frames = useFrames(ws, framesOf("plain", 2, 2, 17)); // 30 + 34 = 64px cell

      const out = runJson(
        "pack", frames,
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
        // where `align --pad 17` actually put the feet in the 64px cell
        anchorPoint: { x: 32, y: 47 },
      });
      expect(Object.keys(atlas.frames)).toEqual(["bounce_00", "bounce_01", "bounce_02", "bounce_03"]);
      expect(atlas.frames.bounce_00).toEqual({
        frame: { x: 0, y: 0, w: 64, h: 64 },
        rotated: false,
        trimmed: false,
        spriteSourceSize: { x: 0, y: 0, w: 64, h: 64 },
        sourceSize: { w: 64, h: 64 },
        pivot: { x: 0.5, y: 0.7344 }, // 47 / 64, not the cell edge
        duration: 125,
      });
      expect(atlas.frames.bounce_03.frame).toEqual({ x: 64, y: 64, w: 64, h: 64 });
      expect(atlas.animations).toEqual({ bounce: ["bounce_00", "bounce_01", "bounce_02", "bounce_03"] });
    });

    test("the packed sheet keeps the transparent gutter of an unfilled cell", () => {
      const ws = fresh();
      const frames = useFrames(ws, framesOf("wide", 1, 3, 17));
      const out = runJson(
        "pack", frames,
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
      expect(atlas.frames.walk_00.pivot).toEqual({ x: 0.5, y: 0.7344 });
    });

    test("--scale --nearest resizes every cell before packing", () => {
      const ws = fresh();
      const frames = useFrames(ws, framesOf("plain", 2, 2, 17));
      const out = runJson(
        "pack", frames,
        "--out", join(ws, "packed.png"), "--atlas", join(ws, "atlas.json"),
        "--name", "bounce", "--fps", "8", "--cols", "2", "--scale", "0.5", "--nearest",
      );
      expect(out.size).toEqual({ w: 64, h: 64 });
      const atlas = JSON.parse(readFileSync(join(ws, "atlas.json"), "utf-8"));
      expect(atlas.meta.scale).toBe(0.5);
      expect(atlas.frames.bounce_00.frame).toEqual({ x: 0, y: 0, w: 32, h: 32 });
      expect(atlas.frames.bounce_00.sourceSize).toEqual({ w: 32, h: 32 });
      // The pivot is a ratio, so scaling the cells cannot move it; the pixel
      // anchor is a measurement in those cells, so it scales with them.
      expect(atlas.frames.bounce_00.pivot).toEqual({ x: 0.5, y: 0.7344 });
      expect(atlas.meta.anchorPoint).toEqual({ x: 16, y: 23.5 });
    });

    test("frames with no align.json fall back to the anchor default and say so", () => {
      const ws = fresh();
      const frames = useFrames(ws, framesOf("plain", 2, 2, 17));
      // Frames aligned by something other than this script are a legitimate
      // input — but then nothing measured where the anchor sits, and the
      // atlas must not pass the assumed pivot off as a measured one.
      rmSync(join(frames, "align.json"));

      const r = run(
        "pack", frames, "--out", join(ws, "packed.png"), "--atlas", join(ws, "atlas.json"),
        "--name", "bounce", "--fps", "8", "--cols", "2", "--json",
      );
      expect(r.code).toBe(0);
      expect(r.err).toContain("no align.json");
      expect(r.err).toContain("falls back to the bottom default {0.5, 1}");

      const atlas = JSON.parse(readFileSync(join(ws, "atlas.json"), "utf-8"));
      expect(atlas.frames.bounce_00.pivot).toEqual({ x: 0.5, y: 1 });
      // an absent key is how a consumer tells "assumed" from "measured"
      expect(atlas.meta.anchorPoint).toBeUndefined();
    });

    test("an align.json describing other frames is refused, not trusted", () => {
      const ws = fresh();
      const frames = useFrames(ws, framesOf("plain", 2, 2, 17));
      const record = JSON.parse(readFileSync(join(frames, "align.json"), "utf-8"));
      writeFileSync(
        join(frames, "align.json"),
        JSON.stringify({ ...record, cell: { width: 128, height: 128 }, anchorPoint: { x: 64, y: 120 } }),
      );

      const r = run(
        "pack", frames, "--out", join(ws, "packed.png"), "--atlas", join(ws, "atlas.json"),
        "--name", "bounce", "--fps", "8", "--cols", "2", "--json",
      );
      expect(r.code).toBe(0);
      expect(r.err).toContain("128x128 cell but these frames are 64x64");
      const atlas = JSON.parse(readFileSync(join(ws, "atlas.json"), "utf-8"));
      expect(atlas.frames.bounce_00.pivot).toEqual({ x: 0.5, y: 1 });
      expect(atlas.meta.anchorPoint).toBeUndefined();
    });

    test("an unreadable align.json stops the pack instead of silently guessing", () => {
      const ws = fresh();
      const frames = useFrames(ws, framesOf("plain", 2, 2, 17));
      writeFileSync(join(frames, "align.json"), "{ not json");

      const r = run(
        "pack", frames, "--out", join(ws, "packed.png"), "--atlas", join(ws, "atlas.json"),
        "--name", "bounce", "--fps", "8", "--json",
      );
      expect(r.code).toBe(1);
      expect(r.err).toContain("align.json");
      expect(r.err).toContain("re-run align");
    });

    test("a frame that cannot be decoded stops the pack instead of vanishing", () => {
      const ws = fresh();
      const frames = useFrames(ws, framesOf("plain", 2, 2, 17));
      writeFileSync(join(frames, "02.png"), "not a png at all");
      const r = run("pack", frames, "--out", join(ws, "packed.png"), "--atlas", join(ws, "atlas.json"),
        "--name", "bounce", "--fps", "8", "--json");
      expect(r.code).toBe(1);
      expect(r.err).toContain("pack:");
      expect(r.err).toContain("02.png");
    });
  });

  describe("gif", () => {
    test("writes a looping GIF that keeps the transparent background", () => {
      const ws = fresh();
      const frames = useFrames(ws, framesOf("plain", 2, 2, 17));

      const out = runJson("gif", frames, "--out", join(ws, "preview.gif"), "--fps", "8", "--loop");
      expect(out.frameCount).toBe(4);
      expect(out.loop).toBe(true);
      const bytes = readFileSync(join(ws, "preview.gif"));
      expect(bytes.subarray(0, 6).toString("latin1")).toBe("GIF89a");
      // the palette chain must reserve a transparent entry
      expect(readBbox(join(ws, "preview.gif")).coverage).toBeLessThan(0.5);
    });

    test.skipIf(!HAS_LIBWEBP)("writes an animated WebP with an alpha channel", () => {
      const ws = fresh();
      const frames = useFrames(ws, framesOf("plain", 2, 2, 17));
      const out = runJson(
        "gif", frames, "--out", join(ws, "preview.gif"),
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
      const frames = useFrames(ws, framesOf("plain", 2, 2, 17));
      const out = runJson(
        "gif", frames, "--out", join(ws, "small.gif"),
        "--fps", "8", "--no-loop", "--width", "32",
      );
      expect(out.loop).toBe(false);
      expect(out.width).toBe(32);
      expect(readBbox(join(ws, "small.gif")).width).toBe(32);
    });

    test("a frame that cannot be decoded is refused, not silently dropped", () => {
      const ws = fresh();
      const frames = useFrames(ws, framesOf("plain", 2, 2, 17));
      // ffmpeg's image2 demuxer skips an unreadable frame and still exits 0,
      // so without the probe this used to write a 3-frame GIF while the JSON
      // claimed 4.
      writeFileSync(join(frames, "02.png"), "not a png at all");
      const r = run("gif", frames, "--out", join(ws, "preview.gif"), "--fps", "8", "--loop", "--json");
      expect(r.code).toBe(1);
      expect(r.err).toContain("gif:");
      expect(r.err).toContain("02.png");
      expect(existsSync(join(ws, "preview.gif"))).toBe(false);
    });

    test("frames of different sizes are refused rather than quietly rescaled", () => {
      const ws = fresh();
      const frames = useFrames(ws, framesOf("plain", 2, 2, 17));
      cpSync(join(useFrames(ws, framesOf("plain", 2, 2, 8), "small"), "00.png"), join(frames, "02.png"));
      const r = run("gif", frames, "--out", join(ws, "preview.gif"), "--fps", "8", "--json");
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/gif: frames are not uniform/);
    });
  });

  describe("inspect", () => {
    test("a clean aligned motion produces zero warnings", () => {
      const ws = fresh();
      const motion = join(ws, "motion");
      useFrames(motion, framesOf("plain", 2, 2, 17));

      const out = runJson("inspect", motion);
      expect(out.frameCount).toBe(4);
      expect(out.cell).toEqual({ width: 64, height: 64 });
      expect(out.anchorDrift).toEqual({ x: 0, y: 0 });
      expect(out.maxJump).toBe(0);
      expect(out.scaleDrift).toBe(0);
      expect(out.emptyFrames).toEqual([]);
      expect(out.warnings).toEqual([]);
      expect(out.frames).toHaveLength(4);
      expect(JSON.parse(readFileSync(join(motion, "inspect.json"), "utf-8")).frameCount).toBe(4);
    });

    test("flags an injected empty cell", () => {
      const ws = fresh();
      const motion = join(ws, "motion");
      useFrames(motion, framesOf("gap", 2, 2, 17));

      const out = runJson("inspect", motion);
      expect(out.emptyFrames).toEqual([2]);
      expect(out.warnings.join(" ")).toContain("frame 02 is empty");
    });

    test("flags a cell whose drawing touches the grid edge", () => {
      const ws = fresh();
      const motion = join(ws, "motion");
      const frames = useFrames(motion, framesOf("plain", 2, 2, 0));
      const out = runJson("inspect", motion, "--cells", frames);
      expect(out.warnings.join(" ")).toContain("clipped");
    });

    test("a failed write leaves no .tmp beside the report", () => {
      // Every JSON here is written scratch-then-rename. When the rename is
      // the step that fails, the scratch must go with it: an `inspect.json.tmp`
      // left in the motion directory is indistinguishable from a write in
      // flight, and the next reader has to guess. A directory standing where
      // the file belongs is the cheapest deterministic rename failure.
      const ws = fresh();
      const motion = join(ws, "motion");
      useFrames(motion, framesOf("plain", 2, 2, 17));
      mkdirSync(join(motion, "inspect.json", "occupied"), { recursive: true });

      const r = run("inspect", motion, "--json");
      expect(r.code).toBe(1);
      expect(r.err).toContain("ERROR:");
      expect(existsSync(join(motion, "inspect.json.tmp"))).toBe(false);
    });
  });

  describe("run", () => {
    test("drives probe → slice → align → pack → gif → inspect on a transparent sheet", () => {
      const ws = fresh();
      const raw = SHEETS.plain();
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
      // the align record ships with the frames it describes
      expect(readdirSync(join(motionDir, "frames")).sort())
        .toEqual(["00.png", "01.png", "02.png", "03.png", "align.json"]);
      // no temp/scratch litter left behind
      expect(readdirSync(motionDir).filter((f) => f.includes("tmp"))).toEqual([]);
      const atlas = JSON.parse(readFileSync(join(motionDir, "atlas.json"), "utf-8"));
      expect(atlas.animations.bounce).toHaveLength(4);
      expect(atlas.meta.image).toBe("sheet.png");
    });

    test("the atlas pivot is the anchor point align used, not the cell edge", () => {
      const ws = fresh();
      const motionDir = join(ws, "motions", "bounce");
      const out = runJson(
        "run", SHEETS.plain(), "--rows", "2", "--cols", "2", "--out", motionDir,
        "--name", "bounce", "--fps", "8", "--pad", "8",
      );
      const { width: W, height: H } = out.cell;
      expect({ W, H }).toEqual({ W: 46, H: 46 });

      const atlas = JSON.parse(readFileSync(join(motionDir, "atlas.json"), "utf-8"));
      // `--pad 8` puts the feet 8px above the cell floor. A pivot of y = 1
      // would hover the character exactly that far above the ground in any
      // engine that pivots on atlas.json, and leave a visible gap under the
      // viewer's pivot guide.
      expect(atlas.meta.anchorPoint).toEqual({ x: W / 2, y: H - 8 });
      expect(atlas.frames.bounce_00.pivot.y).toBeCloseTo((H - 8) / H, 4);
      expect(atlas.frames.bounce_00.pivot).toEqual({ x: 0.5, y: 0.8261 });
      expect(atlas.frames.bounce_03.pivot).toEqual(atlas.frames.bounce_00.pivot);

      // The invariant the pivot guide draws: the declared point is where the
      // sprite's feet actually are in every aligned frame.
      for (const n of ["00", "01"]) {
        const { bbox } = readBbox(join(motionDir, "frames", `${n}.png`));
        expect(bbox!.y + bbox!.h).toBe(atlas.meta.anchorPoint.y);
        expect(bbox!.x + bbox!.w / 2).toBe(atlas.meta.anchorPoint.x);
      }

      // and `inspect` hands the viewer the same point
      expect(JSON.parse(readFileSync(join(motionDir, "inspect.json"), "utf-8")).anchorPoint)
        .toEqual({ x: W / 2, y: H - 8 });
    });

    test("--anchor center pivots on the cell centre", () => {
      const ws = fresh();
      const motionDir = join(ws, "motions", "float");
      const out = runJson(
        "run", SHEETS.plain(), "--rows", "2", "--cols", "2", "--out", motionDir,
        "--name", "float", "--fps", "8", "--pad", "8", "--anchor", "center",
      );
      expect(out.cell).toEqual({ width: 46, height: 46 });

      const atlas = JSON.parse(readFileSync(join(motionDir, "atlas.json"), "utf-8"));
      expect(atlas.meta.anchor).toBe("center");
      expect(atlas.meta.anchorPoint).toEqual({ x: 23, y: 23 });
      expect(atlas.frames.float_00.pivot).toEqual({ x: 0.5, y: 0.5 });

      const { bbox } = readBbox(join(motionDir, "frames", "00.png"));
      expect(bbox!.y + bbox!.h / 2).toBe(23);
      expect(bbox!.x + bbox!.w / 2).toBe(23);
    });

    test("keys an opaque sheet automatically and records sheet-alpha", () => {
      const ws = fresh();
      const motionDir = join(ws, "motions", "bounce");
      const out = runJson(
        "run", SHEETS.green(), "--rows", "2", "--cols", "2", "--out", motionDir,
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
      const motionDir = join(ws, "motions", "flat");
      const out = runJson(
        "run", SHEETS.green(), "--rows", "2", "--cols", "2", "--out", motionDir,
        "--name", "flat", "--fps", "8", "--key", "none",
      );
      expect(out.keyed).toBe(false);
      expect(existsSync(join(motionDir, "sheet-alpha.png"))).toBe(false);
      // an opaque cell fills its whole frame, so the aligned cell equals the slice
      expect(out.cell).toEqual({ width: 80, height: 80 });
    });

    test("is idempotent — a second run over the same motion dir replaces the frames", () => {
      const ws = fresh();
      const motionDir = join(ws, "motions", "bounce");
      const args = [
        "run", SHEETS.pair(), "--rows", "1", "--cols", "2", "--out", motionDir,
        "--name", "bounce", "--fps", "8", "--pad", "17",
      ];
      const first = runJson(...args);
      const second = runJson(...args);
      expect(second.frames).toEqual(first.frames);
      expect(readdirSync(join(motionDir, "frames")).sort()).toEqual(["00.png", "01.png", "align.json"]);
      expect(readdirSync(join(motionDir, "cells")).sort()).toEqual(["00.png", "01.png"]);
    });

    test("a shrinking frame count leaves no stale frame or cell files", () => {
      const ws = fresh();
      const motionDir = join(ws, "motions", "bounce");
      runJson(
        "run", SHEETS.plain(), "--rows", "2", "--cols", "2",
        "--out", motionDir, "--name", "bounce", "--fps", "8", "--pad", "17",
      );
      // A second, different sheet over the same motion: that is a regeneration,
      // and `run` only replaces the raw sheet when told to.
      runJson(
        "run", SHEETS.pair(), "--rows", "1", "--cols", "2", "--force",
        "--out", motionDir, "--name", "bounce", "--fps", "8", "--pad", "17",
      );
      expect(readdirSync(join(motionDir, "frames")).sort()).toEqual(["00.png", "01.png", "align.json"]);
      expect(readdirSync(join(motionDir, "cells")).sort()).toEqual(["00.png", "01.png"]);
    });

    test("keeps the pre-align cells so the report can be reproduced and the alignment redone", () => {
      const ws = fresh();
      const motionDir = join(ws, "motions", "clip");
      // The drawing sits in the cell corner (so every cell is clipped) and
      // frame 01 grows a limb that widens its bbox (so the anchors jump).
      const out = runJson(
        "run", SHEETS.clipped(), "--rows", "1", "--cols", "3", "--out", motionDir,
        "--name", "clip", "--fps", "8", "--pad", "8", "--smooth",
      );
      expect(out.cells).toBe(join(motionDir, "cells"));
      expect(readdirSync(join(motionDir, "cells")).sort()).toEqual(["00.png", "01.png", "02.png"]);
      expect(out.inspect.warnings).toEqual([
        "anchor jumps between frames 00 and 01",
        "cell 00 is clipped — the drawing leaves its grid cell",
        "cell 01 is clipped — the drawing leaves its grid cell",
        "cell 02 is clipped — the drawing leaves its grid cell",
      ]);

      // A plain `inspect <motionDir>` now says exactly what `run` said.
      const report = runJson("inspect", motionDir);
      expect(report.warnings).toEqual(out.inspect.warnings);
      expect(report.cellsDir).toBe(join(motionDir, "cells"));

      // The cells are also the input a fix-the-alignment pass re-reads.
      const realigned = runJson("align", join(motionDir, "cells"), "--out", join(ws, "again"), "--pad", "8", "--smooth");
      expect(realigned.cell).toEqual(out.cell);

      // Without them, the clipping verdict falls back to the padded frames and
      // names the wrong cells — which is why `run` stopped throwing them away.
      rmSync(join(motionDir, "cells"), { recursive: true, force: true });
      const blind = runJson("inspect", motionDir);
      expect(blind.cellsDir).toBeUndefined();
      expect(blind.warnings).not.toEqual(out.inspect.warnings);
    });

    describe("where the input sheet may live", () => {
      /** A motion directory holding a raw sheet and a differently drawn
       *  already-keyed sheet — the state a keying pass leaves behind, and the
       *  one where `run` used to copy the keyed sheet over the raw one. */
      function keyedMotion(ws: string): { motionDir: string; raw: Buffer } {
        const motionDir = join(ws, "motions", "idle");
        mkdirSync(motionDir, { recursive: true });
        cpSync(SHEETS.green(), join(motionDir, "sheet-raw.png"));
        cpSync(SHEETS.plain(), join(motionDir, "sheet-alpha.png"));
        return { motionDir, raw: readFileSync(join(motionDir, "sheet-raw.png")) };
      }

      test("an in-place sheet-alpha.png run keeps sheet-raw.png byte-identical and slices the alpha", () => {
        const ws = fresh();
        const { motionDir, raw } = keyedMotion(ws);
        const out = runJson(
          "run", join(motionDir, "sheet-alpha.png"), "--rows", "2", "--cols", "2",
          "--out", motionDir, "--name", "idle", "--fps", "8", "--pad", "17",
        );

        // The un-keyed original is still exactly what the model drew.
        expect(readFileSync(join(motionDir, "sheet-raw.png")).equals(raw)).toBe(true);
        expect(out.sheetRaw).toBe(join(motionDir, "sheet-raw.png"));
        expect(out.sheetAlpha).toBe(join(motionDir, "sheet-alpha.png"));
        expect(out.alphaSource).toBe("provided");
        expect(out.keyed).toBe(false);
        expect(out.keyColor).toBeUndefined();
        // The alpha sheet is what got sliced: keying the opaque green raw
        // sheet would have rewritten sheet-alpha.png first.
        expect(readFileSync(join(motionDir, "sheet-alpha.png")).equals(readFileSync(SHEETS.plain()))).toBe(true);
        expect(out.cell).toEqual({ width: 64, height: 64 });
        expect(readBbox(join(motionDir, "frames", "00.png")).bbox).toEqual({ x: 17, y: 17, w: 30, h: 30 });
      });

      test("an in-place alpha run with no raw sheet omits sheetRaw and says so on stderr", () => {
        const ws = fresh();
        const motionDir = join(ws, "motions", "idle");
        mkdirSync(motionDir, { recursive: true });
        cpSync(SHEETS.plain(), join(motionDir, "sheet-alpha.png"));

        const r = run(
          "run", join(motionDir, "sheet-alpha.png"), "--rows", "2", "--cols", "2",
          "--out", motionDir, "--name", "idle", "--fps", "8", "--pad", "17", "--json",
        );
        expect(r.code).toBe(0);
        const out = JSON.parse(r.out);
        expect(out.sheetRaw).toBeUndefined();
        expect(out.alphaSource).toBe("provided");
        // A missing raw sheet is reported, not invented.
        expect(existsSync(join(motionDir, "sheet-raw.png"))).toBe(false);
        expect(r.err).toContain("sheet-raw.png");
      });

      test("any other file inside --out is refused instead of overwriting the raw sheet", () => {
        const ws = fresh();
        const { motionDir, raw } = keyedMotion(ws);
        cpSync(SHEETS.pair(), join(motionDir, "sheet-fixed.png"));

        const r = run(
          "run", join(motionDir, "sheet-fixed.png"), "--rows", "1", "--cols", "2",
          "--out", motionDir, "--name", "idle", "--fps", "8", "--json",
        );
        expect(r.code).toBe(1);
        expect(r.err).toContain("sheet-raw.png");
        expect(r.err).toContain("sheet-alpha.png");
        expect(readFileSync(join(motionDir, "sheet-raw.png")).equals(raw)).toBe(true);
      });

      test("an outside sheet does not replace a different sheet-raw.png without --force", () => {
        const ws = fresh();
        const { motionDir, raw } = keyedMotion(ws);
        const args = [
          "run", SHEETS.pair(), "--rows", "1", "--cols", "2", "--out", motionDir,
          "--name", "idle", "--fps", "8", "--pad", "17",
        ];

        const refused = run(...args, "--json");
        expect(refused.code).toBe(1);
        expect(refused.err).toContain("--force");
        expect(readFileSync(join(motionDir, "sheet-raw.png")).equals(raw)).toBe(true);

        // A regeneration is the legitimate case, and it says so.
        const forced = runJson(...args, "--force");
        expect(forced.sheetRaw).toBe(join(motionDir, "sheet-raw.png"));
        expect(readFileSync(join(motionDir, "sheet-raw.png")).equals(readFileSync(SHEETS.pair()))).toBe(true);
        expect(forced.frames).toHaveLength(2);
      });

      test("--alpha copies an already-keyed sheet in and skips probing and keying", () => {
        const ws = fresh();
        const motionDir = join(ws, "motions", "idle");
        const out = runJson(
          "run", SHEETS.green(), "--alpha", SHEETS.plain(), "--rows", "2", "--cols", "2",
          "--out", motionDir, "--name", "idle", "--fps", "8", "--pad", "17",
        );

        expect(out.sheetRaw).toBe(join(motionDir, "sheet-raw.png"));
        expect(out.sheetAlpha).toBe(join(motionDir, "sheet-alpha.png"));
        expect(out.alphaSource).toBe("provided");
        expect(out.keyed).toBe(false);
        expect(out.keyColor).toBeUndefined();
        expect(readFileSync(join(motionDir, "sheet-raw.png")).equals(readFileSync(SHEETS.green()))).toBe(true);
        // Untouched bytes: an opaque raw sheet would otherwise have been keyed
        // straight over this file.
        expect(readFileSync(join(motionDir, "sheet-alpha.png")).equals(readFileSync(SHEETS.plain()))).toBe(true);
        expect(readBbox(join(motionDir, "frames", "00.png")).bbox).toEqual({ x: 17, y: 17, w: 30, h: 30 });
      });
    });

    test("a failing run cleans up after itself and reports one ERROR line", () => {
      const ws = fresh();
      const motionDir = join(ws, "motions", "bad");
      const before = readdirSync(tmpdir()).filter((f) => f.startsWith("sprite-cells-"));

      const r = run(
        "run", SHEETS.plain(), "--rows", "2", "--cols", "2", "--out", motionDir,
        "--name", "bad", "--fps", "8", "--cell", "10x10", "--json",
      );
      expect(r.code).toBe(1);
      // `fail()` throws and is caught once at the top: a single ERROR: line,
      // no stack trace, and every `finally` on the way out has run.
      expect(r.err.trim().split("\n")).toHaveLength(1);
      expect(r.err).toMatch(/^ERROR: /);
      expect(r.err).not.toMatch(/^\s+at /m);
      expect(readdirSync(tmpdir()).filter((f) => f.startsWith("sprite-cells-"))).toEqual(before);
      expect(readdirSync(motionDir).filter((f) => f.includes("tmp"))).toEqual([]);
    });
  });

  test("cleanup", () => {
    built.clear();
    sharedRoot = null;
    cleanupAll();
    expect(workspaces).toHaveLength(0);
  });
});

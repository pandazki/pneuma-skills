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
  chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  alphaColorAudit, buildClip, buildExprClip, buildNoiseClip, buildSheet, clipBoxCentres,
  clipFrameDeltas, edgeLuma, readBbox, readColorBbox, silhouetteDiff, webpAnimation,
  webpStackedFrames, CELL_OFFSETS,
} from "./fixtures/pipeline/make-sheet.mjs";
import type { BuildExprClipOptions, BuildSheetOptions } from "./fixtures/pipeline/make-sheet.mjs";
import { loadRoster } from "../domain.js";
import { exportRows, rivePlanFor } from "../viewer/panel.js";
import { decodeRiv, type RiveObject } from "./fixtures/exports/decode-riv.mjs";
import { readZip } from "./fixtures/exports/read-zip.mjs";

const SCRIPT = join(import.meta.dir, "..", "skill", "scripts", "sprite-sheet.mjs");
const PROJECT = join(import.meta.dir, "..", "skill", "scripts", "sprite-project.mjs");
const LOOP_FIXTURE = join(import.meta.dir, "fixtures", "loop");

const HAS_FFMPEG =
  spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0 &&
  spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0;

if (!HAS_FFMPEG) {
  console.warn("(skip) modes/sprite sprite-sheet.mjs suite — ffmpeg/ffprobe not on PATH");
}

/** `libwebp_anim`, not `libwebp`: the still encoder is what the WebP exports
 *  used to go through, and its animations ghost (see the WebP cases below). */
const HAS_LIBWEBP = HAS_FFMPEG &&
  spawnSync("ffmpeg", ["-hide_banner", "-encoders"], { encoding: "utf-8" }).stdout?.includes("libwebp_anim") === true;

/** The STILL encoder — what `rive` embeds each frame with. */
const HAS_LIBWEBP_STILL = HAS_FFMPEG &&
  / libwebp\s/.test(spawnSync("ffmpeg", ["-hide_banner", "-encoders"], { encoding: "utf-8" }).stdout ?? "");

/**
 * A PATH on which `ffmpeg` is this machine's ffmpeg, except that its encoder
 * list has no libwebp — an ffmpeg built without it, which is common enough
 * (a minimal static build) that `rive` has to decide what to do with one.
 */
function pathWithoutLibwebp(): { PATH: string; dir: string } {
  const real = Bun.which("ffmpeg");
  if (!real) throw new Error("ffmpeg is not on PATH");
  const dir = mkdtempSync(join(tmpdir(), "no-libwebp-"));
  const shim = join(dir, "ffmpeg");
  writeFileSync(
    shim,
    `#!/bin/sh\nfor a in "$@"; do\n  if [ "$a" = "-encoders" ]; then "${real}" "$@" | grep -v ' libwebp'; exit 0; fi\ndone\nexec "${real}" "$@"\n`,
  );
  chmodSync(shim, 0o755);
  return { PATH: `${dir}:${process.env.PATH ?? ""}`, dir };
}

function run(...argv: string[]) {
  return runWithEnv({}, ...argv);
}

function runWithEnv(env: Record<string, string>, ...argv: string[]) {
  const r = Bun.spawnSync([process.execPath, SCRIPT, ...argv], {
    cwd: import.meta.dir,
    stdout: "pipe",
    stderr: "pipe",
    ...(Object.keys(env).length ? { env: { ...process.env, ...env } } : {}),
  });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
}

/** The codec ffprobe finds in a container — the tests' independent answer to
 *  "is this really an APNG / a VP9 WebM". */
function codecOf(path: string): string | null {
  const r = spawnSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name", "-of", "csv=p=0", path],
    { encoding: "utf-8" },
  );
  return r.status === 0 ? String(r.stdout).trim() : null;
}

/** Frames ffprobe decodes out of an animation (APNG, GIF, a video). */
function countFrames(path: string): number {
  const r = spawnSync("ffprobe", [
    "-v", "error", "-count_frames", "-select_streams", "v:0",
    "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", path,
  ], { encoding: "utf-8" });
  return Number(String(r.stdout).trim());
}

/** `sprite-project.mjs <sub> --dir <dir> …`, the character's one writer. */
function projectCmd(dir: string, ...argv: string[]) {
  const r = Bun.spawnSync([process.execPath, PROJECT, argv[0], "--dir", dir, ...argv.slice(1), "--json"], {
    cwd: import.meta.dir, stdout: "pipe", stderr: "pipe",
  });
  if (r.exitCode !== 0) throw new Error(`sprite-project ${argv[0]} failed (${r.exitCode}):\n${r.stderr.toString()}`);
  return JSON.parse(r.stdout.toString());
}

function runJson(...argv: string[]) {
  const r = run(...argv, "--json");
  if (r.code !== 0) throw new Error(`sprite-sheet ${argv[0]} failed (${r.code}):\n${r.err}`);
  return JSON.parse(r.out);
}

/** An image file's pixels as RGBA, decoded by ffmpeg — the test's own reader. */
function readRgba(bytes: Buffer) {
  const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", "-i", "pipe:0"], {
    input: bytes, encoding: "utf-8",
  });
  const [width, height] = String(probe.stdout).trim().split(",").map(Number);
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", "pipe:0", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "-"], {
    input: bytes, maxBuffer: 64 * 1024 * 1024,
  });
  return { width, height, data: r.stdout as Buffer };
}

/**
 * Where a figure stands: the mean x of its alpha pixels (alpha ≥ 16) in the
 * bottom tenth of its bounding box, and the bottom edge of that box. Written
 * out here, apart from the script, as the definition the script must meet.
 */
function feetOf(image: { width: number; height: number; data: Buffer }) {
  let y0 = Infinity, y1 = -1, x0 = Infinity, x1 = -1;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (image.data[(y * image.width + x) * 4 + 3] < 16) continue;
      y0 = Math.min(y0, y); y1 = Math.max(y1, y); x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    }
  }
  const band = Math.max(1, Math.round((y1 - y0 + 1) * 0.1));
  let sum = 0, n = 0;
  for (let y = y1 + 1 - band; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (image.data[(y * image.width + x) * 4 + 3] < 16) continue;
      sum += x + 0.5; n++;
    }
  }
  return { x: sum / n, y: y1 + 1 };
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

/** The body square's colour, so `readColorBbox` can find the body under a
 *  differently coloured prop. */
const BODY_COLOR_NAME = "red";
const BODY_COLOR = "#ff0000";
/** Where the smoothed `limb` body lands. The cell is sized around the anchor
 *  the frames are actually pinned by, and smoothing moves that anchor off the
 *  bbox centre, so the cell is wider than `max bbox + 2·pad` — which is the
 *  point: a frame that no longer straddles its anchor must still fit without
 *  being clamped back to where it started. */
const SMOOTHED_LIMB_X = 20;

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
  /**
   * 1x4: the same body square in every cell, plus a prop bar that juts out to
   * the right in cells 01 and 03 — the umbrella / lantern / wrench case. The
   * prop never reaches the ground, so the feet do not move while the bbox
   * centre swings 7px; the body is drawn in a different colour so a test can
   * measure it without re-implementing the feet band it is checking.
   */
  prop: () => sheet("prop", {
    rows: 1, cols: 4,
    squares: [{ x: 17, y: 17, color: BODY_COLOR_NAME }],
    extras: [
      { index: 1, x: 47, y: 20, w: 14, h: 8, color: "white" },
      { index: 3, x: 47, y: 20, w: 14, h: 8, color: "white" },
    ],
  }),
  /**
   * The prop drawing on an OPAQUE GREEN plate, 1x2.
   *
   * The body and the bar are separate blobs, so the bbox `align` crops
   * contains keyed-out pixels — which is the whole point: a solid square's
   * bbox is all opaque, its aligned frame is transparent only where `pad`
   * put it, and green could never reach the packed sheet on such a fixture
   * however broken the keyer was. A real character is this shape, not that
   * one.
   */
  greenProp: () => sheet("green-prop", {
    rows: 1, cols: 2,
    background: "0x00b140",
    squares: [{ x: 17, y: 17, color: BODY_COLOR_NAME }],
    extras: [
      { index: 0, x: 47, y: 20, w: 14, h: 8, color: "white" },
      { index: 1, x: 47, y: 20, w: 14, h: 8, color: "white" },
    ],
  }),
  /** 1x3 whose drawing sits in the cell corner (clipped) plus the stray limb. */
  clipped: () => sheet("clipped", {
    rows: 1, cols: 3,
    squares: [{ x: 0, y: 0, color: "red" }],
    extras: [{ index: 1, x: 53, y: 20, w: 6, h: 6 }],
  }),
  /**
   * 1x2, the litter case `clean` exists for. Both cells hold the same 30x30
   * body (900 px, so the 2 % keep threshold is 18 px). Cell 00 also has a
   * 4x4 fragment jammed against the left cell border — the neighbouring
   * drawing bleeding in — and a 3x3 speck floating over the head. Cell 01 has
   * a 6x6 detached accessory that is neither: 36 px is over 2 % of the body,
   * so it is part of the design and must survive.
   */
  litter: () => sheet("litter", {
    rows: 1, cols: 2,
    squares: [{ x: 17, y: 17, color: BODY_COLOR_NAME }],
    extras: [
      { index: 0, x: 0, y: 30, w: 4, h: 4 },
      { index: 0, x: 25, y: 5, w: 3, h: 3 },
      { index: 1, x: 52, y: 25, w: 6, h: 6 },
    ],
  }),
  /** 1x1: the same body under six 4x4 specks, which together are ~10 % of the
   *  cell's ink — past the point where cleaning is worth a sentence. */
  speckled: () => sheet("speckled", {
    rows: 1, cols: 1,
    squares: [{ x: 17, y: 17, color: BODY_COLOR_NAME }],
    extras: [2, 8, 14, 20, 26, 32].map((x) => ({ index: 0, x, y: 5, w: 4, h: 4 })),
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
    for (const cmd of [
      "probe", "key", "flatten", "slice", "clean", "align", "pack", "gif",
      "inspect", "run", "contact", "from-video", "loop",
    ]) {
      expect(r.out + r.err).toContain(cmd);
    }
  });

  test("clean --help, contact --help, from-video --help and loop --help exit 0", () => {
    for (const cmd of ["clean", "contact", "from-video", "loop"]) {
      const r = run(cmd, "--help");
      expect({ cmd, code: r.code }).toEqual({ cmd, code: 0 });
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

    test("erases the plate it keyed out instead of hiding it under alpha", () => {
      // `colorkey` writes the alpha plane and nothing else, so a keyed sheet
      // measures perfectly (`readBbox` only reads alpha) while still carrying
      // the whole green plate underneath — which any bilinear resize bleeds
      // back into the fringe, and any alpha-ignoring importer shows whole.
      const ws = fresh();
      const keyed = join(ws, "sheet-alpha.png");
      runJson("key", SHEETS.green(), "--out", keyed, "--color", "auto");

      const audit = alphaColorAudit(keyed);
      expect(audit.hidden).toBeGreaterThan(0);
      expect(audit.hiddenColors).toEqual(["0,0,0"]);

      // …and the visible half is untouched: the bodies sit exactly where the
      // same drawing on a transparent plate has them, in their own colours.
      expect(audit.opaqueBlack).toBe(0);
      expect(readColorBbox(keyed, BODY_COLOR)).toEqual(
        readColorBbox(SHEETS.plain(), BODY_COLOR),
      );
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

  describe("clean", () => {
    /** Body 30x30 = 900 px; the fragment is 16 px and the speck 9 px. */
    const BODY = { x: 17, y: 17, w: 30, h: 30 };

    test("drops a border fragment and a floating speck, keeps the body to the pixel", () => {
      const ws = fresh();
      const out = runJson("clean", cellsOf("litter", 1, 2), "--out", join(ws, "clean"));

      expect(out.cleaned).toEqual([{ cell: 0, removedComponents: 2, removedPixels: 25 }]);
      expect(out.warnings).toEqual([]);

      // The body is not merely still there — it is byte-for-byte where it was.
      expect(readColorBbox(join(ws, "clean", "00.png"), BODY_COLOR).bbox).toEqual(BODY);
      // …and nothing else survives in that cell: the neighbour's fragment and
      // the speck over the head are both gone.
      expect(readBbox(join(ws, "clean", "00.png")).bbox).toEqual(BODY);
    });

    test("a detached accessory over 2% of the body is design, not litter", () => {
      const ws = fresh();
      runJson("clean", cellsOf("litter", 1, 2), "--out", join(ws, "clean"));
      // 6x6 = 36 px against a 900 px body, and it touches no cell border.
      expect(readBbox(join(ws, "clean", "01.png")).bbox).toEqual({ x: 17, y: 17, w: 41, h: 30 });
      expect(readColorBbox(join(ws, "clean", "01.png"), BODY_COLOR).bbox).toEqual(BODY);
    });

    test("leaves the source cells alone", () => {
      const ws = fresh();
      const cells = cellsOf("litter", 1, 2);
      const before = readFileSync(join(cells, "00.png"));
      runJson("clean", cells, "--out", join(ws, "clean"));
      expect(readFileSync(join(cells, "00.png")).equals(before)).toBe(true);
    });

    test("cleaning in place rewrites the cells it read", () => {
      const ws = fresh();
      const cells = useFrames(ws, cellsOf("litter", 1, 2), "cells");
      const out = runJson("clean", cells, "--out", cells);
      expect(out.cleaned).toHaveLength(1);
      expect(readBbox(join(cells, "00.png")).bbox).toEqual(BODY);
    });

    test("warns when a cell loses more than 5% of its ink", () => {
      const ws = fresh();
      const out = runJson("clean", cellsOf("speckled", 1, 1), "--out", join(ws, "clean"));
      expect(out.cleaned).toEqual([{ cell: 0, removedComponents: 6, removedPixels: 96 }]);
      // 96 of 996 opaque pixels — the sheet, not the cleaner, is the problem.
      expect(out.warnings).toEqual(["cell 00 lost 10% to cleaning — check the sheet"]);
    });

    test("an empty cell is a no-op, not a removal", () => {
      const ws = fresh();
      const out = runJson("clean", cellsOf("gap", 2, 2), "--out", join(ws, "clean"));
      expect(out.cleaned.map((c: { cell: number }) => c.cell)).not.toContain(2);
      expect(readBbox(join(ws, "clean", "02.png")).bbox).toBeNull();
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

      // Pinned to `--x-from bbox`, which is what this case has always been
      // about: the default now takes x from the feet, and a limb that never
      // reaches the ground cannot move those at all (see the --x-from cases
      // below). What --smooth is still for is a wobble in the anchor itself.
      runJson("align", cells, "--out", join(ws, "plain"), "--pad", "8", "--x-from", "bbox");
      const plain = ["00", "01", "02"].map((n) => readBbox(join(ws, "plain", `${n}.png`)).bbox!.x);
      // bbox-centred alignment shoves the body sideways on the odd frame
      expect(plain[0]).toBe(14);
      expect(plain[1]).toBe(8);
      expect(plain[2]).toBe(14);

      runJson("align", cells, "--out", join(ws, "smoothed"), "--pad", "8", "--x-from", "bbox", "--smooth");
      const smoothed = ["00", "01", "02"].map((n) => readBbox(join(ws, "smoothed", `${n}.png`)).bbox!.x);
      expect(smoothed).toEqual([SMOOTHED_LIMB_X, SMOOTHED_LIMB_X, SMOOTHED_LIMB_X]);
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
        // Which x the frames were pinned by, so "why is the body off-centre"
        // has an answer sitting next to them.
        xFrom: "feet",
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

    test("bottom anchor takes x from the feet, not from a prop-inflated bbox", () => {
      // A prop that juts sideways moves the bbox centre by half its reach
      // while the body has not moved at all — so pinning the bbox centre pays
      // for the prop by shoving the body the other way, and the character
      // splits sideways during playback. Measured on a real 4x4 attack sheet:
      // the feet swung 81 -> 134px across the frames while the bbox centre sat
      // still, an 18% of cell sideways jump.
      const ws = fresh();
      const cells = cellsOf("prop", 1, 4);
      const bodyX = (dir: string) => ["00", "01", "02", "03"]
        .map((n) => readColorBbox(join(dir, `${n}.png`), BODY_COLOR).bbox!.x);

      const feet = runJson("align", cells, "--out", join(ws, "feet"), "--pad", "8");
      expect(feet.xFrom).toBe("feet");
      expect(bodyX(join(ws, "feet"))).toEqual([22, 22, 22, 22]);

      // and the old behaviour is still one flag away — with the old jump
      const bbox = runJson("align", cells, "--out", join(ws, "bbox"), "--pad", "8", "--x-from", "bbox");
      expect(bbox.xFrom).toBe("bbox");
      expect(bodyX(join(ws, "bbox"))).toEqual([15, 8, 15, 8]);

      // Feet-pinned, the prop hangs off one side of the anchor, so the cell is
      // wider than the bbox mode's: sizing follows the anchor, and a cell that
      // did not would clamp the body straight back to where it started.
      expect(feet.cell).toEqual({ width: 74, height: 46 });
      expect(bbox.cell).toEqual({ width: 60, height: 46 });
      expect(feet.warnings).toEqual([]);
    });

    test("--x-from cell keeps the offset the model drew and only levels y", () => {
      // The escape hatch for a model that already places the body
      // consistently: nothing horizontal moves at all, so the four different
      // cell offsets of the `plain` squares survive exactly, while y is still
      // levelled onto one ground line.
      const ws = fresh();
      const out = runJson("align", cellsOf("plain", 2, 2), "--out", join(ws, "frames"), "--pad", "8", "--x-from", "cell");

      expect(out.xFrom).toBe("cell");
      // The source grid cell IS the cell here: trimming it would shift the
      // very offsets this mode exists to preserve.
      expect(out.cell).toEqual({ width: 64, height: 46 });
      const boxes = ["00", "01", "02", "03"].map((n) => readBbox(join(ws, "frames", `${n}.png`)).bbox!);
      expect(boxes.map((b) => b.x)).toEqual(CELL_OFFSETS.map((o) => o.x));
      expect(boxes.map((b) => b.y)).toEqual([8, 8, 8, 8]);
    });

    test("--anchor center keeps the bbox centre and records what it actually used", () => {
      const ws = fresh();
      // Feet are no reference for an airborne pose, so the `feet` default
      // resolves to the bbox centre under a center anchor — and the record
      // says `bbox`, never the mode that was asked for and not used.
      const centered = runJson("align", cellsOf("prop", 1, 4), "--out", join(ws, "center"), "--pad", "8", "--anchor", "center");
      expect(centered.xFrom).toBe("bbox");
      expect(JSON.parse(readFileSync(join(ws, "center", "align.json"), "utf-8")).xFrom).toBe("bbox");

      // `cell` is honoured under either anchor.
      const kept = runJson("align", cellsOf("prop", 1, 4), "--out", join(ws, "center-cell"), "--pad", "8", "--anchor", "center", "--x-from", "cell");
      expect(kept.xFrom).toBe("cell");
      expect(kept.cell.width).toBe(64);
    });

    test("an unknown --x-from is refused by name", () => {
      const ws = fresh();
      const r = run("align", cellsOf("plain", 2, 2), "--out", join(ws, "frames"), "--x-from", "middle", "--json");
      expect(r.code).toBe(1);
      expect(r.err).toContain("--x-from: expected feet, bbox, cell");
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

      // …and the frames do not pile up on one another. The sprite preview goes
      // through the same encoder the loop export does, and had the same defect:
      // see the loop case below for the measurement.
      expect(webpStackedFrames(join(ws, "preview.webp"))).toEqual([]);
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
      expect(out.bodyDrift).toBe(0);
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

    test("bodyDrift catches a body that slides while the anchor sits perfectly still", () => {
      const ws = fresh();
      const cells = cellsOf("prop", 1, 4);
      const feet = join(ws, "feet-motion");
      const bbox = join(ws, "bbox-motion");
      runJson("align", cells, "--out", join(feet, "frames"), "--pad", "8");
      runJson("align", cells, "--out", join(bbox, "frames"), "--pad", "8", "--x-from", "bbox");

      const drift = "body drifts sideways between frames — re-run align with --x-from feet/cell";

      const good = runJson("inspect", feet);
      expect(good.bodyDrift).toBe(0);
      expect(good.warnings).not.toContain(drift);

      const bad = runJson("inspect", bbox);
      // anchorDrift is a flat zero here — the bbox is pinned, which is exactly
      // why the old report could not see this defect at all. bodyDrift can.
      expect(bad.anchorDrift).toEqual({ x: 0, y: 0 });
      expect(bad.bodyDrift).toBe(3.5);
      expect(bad.warnings).toContain(drift);
      // and it names the frames, so the fix is not a guess
      expect(bad.frames.map((f: { feetX: number }) => f.feetX)).toEqual([30, 23, 30, 23]);
    });

    test("a body that really does lurch still trips the jump warning", () => {
      // The counterpart to the bodyDrift case: the jump warning is gated on
      // the feet, so it must still fire when the feet are what moved. The four
      // `plain` squares sit at four different x, and `--x-from cell` keeps
      // every one of them — 8px of lurch in a 64px cell.
      const ws = fresh();
      const motion = join(ws, "motion");
      runJson("align", cellsOf("plain", 2, 2), "--out", join(motion, "frames"), "--pad", "8", "--x-from", "cell");

      const out = runJson("inspect", motion);
      expect(out.maxJump).toBe(8);
      expect(out.warnings).toContain("anchor jumps between frames 01 and 02");
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
        // The summary — not just the fat report — carries the measured anchor
        // point, because THIS object is what `register-run` copies into
        // project.json and project.json is all the viewer ever reads. `--pad
        // 17` puts the feet 17px above the cell floor.
        anchorPoint: { x: 32, y: 47 },
        anchorDrift: { x: 0, y: 0 },
        bodyDrift: 0,
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

    test("the erased plate travels all the way to the packed sheet", () => {
      // `run` keys once and everything after it — slice, align, pack — only
      // copies those pixels, so fixing the keyer has to be enough. Measured
      // on the green PROP sheet, because it is the only green fixture whose
      // aligned frame contains keyed-out pixels at all (see `greenProp`).
      // `sheet.png` is the artifact the defect was first seen on: an engine
      // imports it, and a bilinear resize of it bleeds whatever hides under
      // the transparency back into every edge.
      const ws = fresh();
      const motionDir = join(ws, "motions", "prop");
      runJson(
        "run", SHEETS.greenProp(), "--rows", "1", "--cols", "2", "--out", motionDir,
        "--name", "prop", "--fps", "8", "--key", "auto",
      );

      for (const image of ["sheet-alpha.png", "cells/00.png", "frames/00.png", "sheet.png"]) {
        const audit = alphaColorAudit(join(motionDir, ...image.split("/")));
        expect({ image, hiddenColors: audit.hiddenColors }).toEqual({
          image,
          hiddenColors: ["0,0,0"],
        });
        // The drawing itself is untouched — a fix that zeroed too much would
        // satisfy the line above by erasing the character.
        expect({ image, opaqueBlack: audit.opaqueBlack }).toEqual({ image, opaqueBlack: 0 });
        expect(audit.opaque).toBeGreaterThan(0);
      }
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
      // The drawing sits in the cell corner, so every cell is clipped. Frame 01
      // also grows a limb that widens its bbox — which used to be listed here
      // as an anchor jump too. It is not one: x now comes from the feet, so
      // the body is pinned and only the silhouette moves, and the jump warning
      // asks the feet before it speaks (see the `--x-from cell` case below,
      // where a body that really does lurch still trips it).
      const out = runJson(
        "run", SHEETS.clipped(), "--rows", "1", "--cols", "3", "--out", motionDir,
        "--name", "clip", "--fps", "8", "--pad", "8", "--smooth",
      );
      expect(out.cells).toBe(join(motionDir, "cells"));
      expect(readdirSync(join(motionDir, "cells")).sort()).toEqual(["00.png", "01.png", "02.png"]);
      expect(out.inspect.warnings).toEqual([
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

    test("cleans the cells before aligning, and --no-clean leaves the litter in", () => {
      const ws = fresh();
      const args = ["run", SHEETS.litter(), "--rows", "1", "--cols", "2", "--name", "litter", "--fps", "8"] as const;

      const cleaned = runJson(...args, "--out", join(ws, "cleaned"));
      expect(cleaned.cleaned).toEqual([{ cell: 0, removedComponents: 2, removedPixels: 25 }]);
      // The fragment sat against the left cell border, so the un-cleaned cell
      // reads as "clipped" and drags the alignment 4 px to the left with it.
      expect(cleaned.inspect.warnings).toEqual([]);
      expect(readBbox(join(ws, "cleaned", "cells", "00.png")).bbox).toEqual({ x: 17, y: 17, w: 30, h: 30 });

      const dirty = runJson(...args, "--out", join(ws, "dirty"), "--no-clean");
      expect(dirty.cleaned).toBeUndefined();
      expect(readBbox(join(ws, "dirty", "cells", "00.png")).bbox).toEqual({ x: 0, y: 5, w: 47, h: 42 });
      expect(dirty.inspect.warnings).toContain("cell 00 is clipped — the drawing leaves its grid cell");
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

  describe("contact", () => {
    /**
     * A 3 s, 10 fps clip whose box holds the opening pose for 0.5 s and then
     * rides a 1 s sine — the two things `contact` claims to be able to read
     * back out of a clip it was never told anything about.
     */
    const holdClip = () => {
      const key = "clip:hold";
      if (!built.has(key)) {
        built.set(key, buildClip(join(shared(), "hold.mp4"), {
          seconds: 3, fps: 10, amplitude: 8, holdSeconds: 0.5,
        }));
      }
      return built.get(key)!;
    };

    /** The same clip with the sine flattened: a still image with a duration. */
    const stillClip = () => {
      const key = "clip:still";
      if (!built.has(key)) {
        built.set(key, buildClip(join(shared(), "still.mp4"), {
          seconds: 3, fps: 10, amplitude: 0,
        }));
      }
      return built.get(key)!;
    };

    test("tiles evenly spaced stills into one grid and says where each came from", () => {
      const ws = fresh();
      const out = join(ws, "contact.png");
      const json = runJson(
        "contact", holdClip(), "--out", out, "--count", "24", "--cols", "8", "--width", "40",
      );

      expect(json.clip).toBe(holdClip());
      expect(json.out).toBe(out);
      expect(json.tiles).toHaveLength(24);
      expect(json.grid).toEqual({ rows: 3, cols: 8 });
      // Both ends are in the picture, and the last one still names a frame
      // that exists.
      expect(json.tiles[0].t).toBe(0);
      expect(json.tiles[23].t).toBeLessThanOrEqual(json.duration);
      expect(json.tiles[23].t).toBeGreaterThan(2.8);
      expect(json.tiles[9]).toEqual({ index: 9, t: json.tiles[9].t, row: 1, col: 1 });
      expect(json.tiles[23]).toEqual({ index: 23, t: json.tiles[23].t, row: 2, col: 7 });

      // Measured off the written PNG, not off the JSON that claims it.
      const sheet = readBbox(out);
      expect(sheet.width).toBe(8 * json.tile.width + 7 * 2);
      expect(sheet.height).toBe(3 * json.tile.height + 2 * 2);
      expect(json.tile.width).toBe(40);
    });

    test("reads the opening hold, the closing hold and the loop out of the clip", () => {
      const ws = fresh();
      const json = runJson("contact", holdClip(), "--out", join(ws, "c.png"), "--count", "8");

      // The box does not move until 0.5 s.
      expect(json.stillStart).toBeGreaterThanOrEqual(0.4);
      expect(json.stillStart).toBeLessThanOrEqual(0.7);
      expect(json.stillEnd).not.toBeNull();

      // The sine's period is exactly 1 s, and a window one period long closes
      // on itself more tightly than two neighbouring frames differ.
      expect(json.loops.length).toBeGreaterThan(0);
      expect(json.loops[0].period).toBeGreaterThanOrEqual(0.9);
      expect(json.loops[0].period).toBeLessThanOrEqual(1.1);
      expect(json.loops[0].seam).toBeLessThan(json.loops[0].step);
      expect(json.loops.length).toBeLessThanOrEqual(3);

      // The rhythm, without a plot: flat through the hold, then moving.
      expect(json.profile.fps).toBe(10);
      expect(json.profile.start).toBe(0);
      expect(json.profile.deltas.slice(0, 4)).toEqual([0, 0, 0, 0]);
      expect(Math.max(...(json.profile.deltas as number[]))).toBeGreaterThan(0.1);

      expect(json.keyColor).toMatch(/^#[0-9a-f]{6}$/);
      expect(json.alphaCoverage).toBeGreaterThan(0);
      expect(json.alphaCoverage).toBeLessThan(0.5);
    });

    test("--every spaces the stills by seconds instead of by count", () => {
      const ws = fresh();
      const json = runJson("contact", holdClip(), "--out", join(ws, "e.png"), "--every", "0.5");
      expect(json.tiles).toHaveLength(7);
      expect(json.tiles.map((t: { t: number }) => t.t).slice(0, 6)).toEqual([0, 0.5, 1, 1.5, 2, 2.5]);
      // The step lands exactly on the duration, so the last one is pulled back
      // to the last frame that can be seeked to.
      expect(json.tiles[6].t).toBeGreaterThan(2.8);
      expect(json.tiles[6].t).toBeLessThanOrEqual(3);
    });

    test("--count and --every together are refused by name", () => {
      const ws = fresh();
      const r = run(
        "contact", holdClip(), "--out", join(ws, "x.png"),
        "--count", "8", "--every", "0.5", "--json",
      );
      expect(r.code).toBe(1);
      expect(r.err).toContain("--count");
      expect(r.err).toContain("--every");
    });

    test("a clip that never moves says so instead of inventing a loop", () => {
      const ws = fresh();
      const json = runJson("contact", stillClip(), "--out", join(ws, "s.png"), "--count", "6");
      expect(json.stillStart).toBeNull();
      expect(json.stillEnd).toBeNull();
      expect(json.loops).toEqual([]);
      expect(json.warnings.join(" ")).toContain("never moves");
    });

    test("--json is one object; the human form names the hold and the loop", () => {
      const ws = fresh();
      const asJson = run("contact", holdClip(), "--out", join(ws, "j.png"), "--count", "4", "--json");
      expect(asJson.code).toBe(0);
      expect(asJson.out.trim().split("\n")).toHaveLength(1);
      expect(() => JSON.parse(asJson.out)).not.toThrow();

      const human = run("contact", holdClip(), "--out", join(ws, "h.png"), "--count", "6");
      expect(human.code).toBe(0);
      expect(human.out).toContain("6 stills of");
      expect(human.out).toContain("opening pose holds until");
      expect(human.out).toContain("best loop ");
    });

    test("the stills are scratch: nothing is left behind in the temp directory", () => {
      // The command's temp root is this test's own directory, not the shared
      // one. Watching the shared `tmpdir()` for `sprite-contact-*` cannot
      // attribute what it sees: any other process running this suite — four
      // worktrees testing the same mode at once is the normal case here —
      // adds and removes those names while this test is between its two
      // samples, and a killed run leaves one behind for every later run to
      // trip over. (Measured 2026-09-22: the set came back with one name
      // swapped for another, from a run in a different checkout.) Owning the
      // directory makes the claim exact instead of statistical.
      const ws = fresh();
      const scratch = join(ws, "tmp");
      mkdirSync(scratch, { recursive: true });
      const r = runWithEnv({ TMPDIR: scratch }, "contact", holdClip(),
        "--out", join(ws, "t.png"), "--count", "4", "--json");
      expect(r.code).toBe(0);
      expect(readdirSync(scratch)).toEqual([]);
      // …and nothing was written next to the motion either: a contact sheet is
      // a working file, not an asset.
      expect(readdirSync(ws).sort()).toEqual(["t.png", "tmp"]);
    });
  });

  describe("from-video", () => {
    /** A 2 s, 10 fps green clip, drawn once like every other fixture. */
    const clip = () => {
      const key = "clip:hop";
      if (!built.has(key)) built.set(key, buildClip(join(shared(), "hop.mp4")));
      return built.get(key)!;
    };

    test("samples the clip evenly, keys the green plate and runs the whole chain", () => {
      const ws = fresh();
      const motionDir = join(ws, "motions", "hop");
      const out = runJson(
        "from-video", clip(), "--out", motionDir, "--name", "hop",
        "--frames", "4", "--loop",
      );

      // The run summary is `run`'s shape plus the video keys, so
      // `register-run` consumes it unchanged.
      expect(out.source).toBe("video");
      expect(out.video).toBe(clip());
      expect(out.sampledAt).toEqual([0, 0.5, 1, 1.5]);
      expect(out.schedule).toBe("even");
      expect(out.frames).toHaveLength(4);
      expect(out.motionDir).toBe(motionDir);
      expect(out.sheet).toBe(join(motionDir, "sheet.png"));
      expect(out.atlas).toBe(join(motionDir, "atlas.json"));
      expect(out.gif).toBe(join(motionDir, "preview.gif"));
      expect(out.inspect.frameCount).toBe(4);
      expect(out.xFrom).toBe("feet");
      // fps defaults to the sampling rate, so the preview plays at the speed
      // the clip was shot at: 4 frames across 2 s.
      expect(out.fps).toBe(2);

      // The green is gone: the square is ~400 of 4096 px.
      expect(out.keyed).toBe(true);
      expect(out.keyColor).toMatch(/^#[0-9a-f]{6}$/);
      const cell = readBbox(join(motionDir, "cells", "00.png"));
      expect(cell.coverage).toBeGreaterThan(0.07);
      expect(cell.coverage).toBeLessThan(0.16);
      expect(existsSync(join(motionDir, "inspect.json"))).toBe(true);
    });

    test("erases the plate out of every sampled frame, all the way to the sheet", () => {
      // Here the key runs inside the extraction filter, one plate per frame,
      // so there is no keyed sheet to fix once. The packed sheet is the one
      // the first real video motion showed as solid green: `--scale` mixes
      // the RGB under a transparent pixel straight back into its neighbours.
      const ws = fresh();
      const motionDir = join(ws, "erased");
      runJson(
        "from-video", clip(), "--out", motionDir, "--name", "hop",
        "--frames", "2", "--loop",
      );

      // The cells are where the plate enters — 23 distinct greens of h264
      // noise, before this fix. (The clip's body is one solid rectangle, so
      // its aligned frame is transparent only where `pad` put it; the
      // end-to-end claim is pinned on the `run` prop sheet instead.)
      for (const image of ["cells/00.png", "cells/01.png", "sheet.png"]) {
        const audit = alphaColorAudit(join(motionDir, ...image.split("/")));
        expect({ image, hiddenColors: audit.hiddenColors }).toEqual({
          image,
          hiddenColors: ["0,0,0"],
        });
        // The body is still there and still coloured — an over-eager fix that
        // zeroed the character would pass the assertion above and fail here.
        expect({ image, opaqueBlack: audit.opaqueBlack }).toEqual({ image, opaqueBlack: 0 });
        expect(audit.opaque).toBeGreaterThan(0);
      }
    });

    test("--no-loop samples both ends, --loop leaves the closing pose to frame 00", () => {
      const ws = fresh();
      const once = runJson(
        "from-video", clip(), "--out", join(ws, "once"), "--name", "hop",
        "--frames", "4", "--no-loop",
      );
      expect(once.sampledAt[0]).toBe(0);
      // A one-shot motion has to show where it ended up; a loop must not
      // sample the pose frame 00 already is. 1.85, not the last frame's own
      // 1.9: the clamp sits half a frame before that presentation time, which
      // still SELECTS the last frame (`-ss` takes the first frame at or after
      // it) from a timestamp that survives being rounded to milliseconds.
      expect(once.sampledAt[3]).toBe(1.85);
      expect(once.loop).toBe(false);
    });

    test("--trim-start and --trim-end window the clip", () => {
      const ws = fresh();
      const out = runJson(
        "from-video", clip(), "--out", join(ws, "trim"), "--name", "hop",
        "--frames", "2", "--loop", "--trim-start", "0.5", "--trim-end", "1.5",
      );
      expect(out.sampledAt).toEqual([0.5, 1]);
      expect(out.video).toBe(clip());
    });

    test("--key none leaves the plate opaque", () => {
      const ws = fresh();
      const motionDir = join(ws, "raw");
      const out = runJson(
        "from-video", clip(), "--out", motionDir, "--name", "hop",
        "--frames", "2", "--key", "none", "--cell", "64x64",
      );
      expect(out.keyed).toBe(false);
      expect(readBbox(join(motionDir, "cells", "00.png")).coverage).toBe(1);
    });

    test("cleans the sampled frames unless --no-clean says otherwise", () => {
      const ws = fresh();
      const out = runJson(
        "from-video", clip(), "--out", join(ws, "clean"), "--name", "hop", "--frames", "2",
      );
      expect(Array.isArray(out.cleaned)).toBe(true);
      const skipped = runJson(
        "from-video", clip(), "--out", join(ws, "dirty"), "--name", "hop",
        "--frames", "2", "--no-clean",
      );
      expect(skipped.cleaned).toBeUndefined();
    });

    test("a missing clip and an over-long sample are refused by name", () => {
      const ws = fresh();
      const missing = run("from-video", join(ws, "nope.mp4"), "--out", join(ws, "m"), "--name", "x", "--frames", "4", "--json");
      expect(missing.code).toBe(1);
      expect(missing.err).toContain("nope.mp4");

      const tooMany = run("from-video", clip(), "--out", join(ws, "big"), "--name", "x", "--frames", "101", "--json");
      expect(tooMany.code).toBe(1);
      expect(tooMany.err).toContain("100");
    });

    test("a trim window outside the clip is refused instead of sampling nothing", () => {
      const ws = fresh();
      const r = run(
        "from-video", clip(), "--out", join(ws, "bad"), "--name", "x", "--frames", "4",
        "--trim-start", "1.5", "--trim-end", "1.5", "--json",
      );
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/ERROR: /);
    });

    test("--at samples the times it is given and reports the mean rate", () => {
      const ws = fresh();
      const out = runJson(
        "from-video", clip(), "--out", join(ws, "at"), "--name", "hop",
        "--at", "0.2,0.7,1.2", "--no-loop",
      );
      expect(out.sampledAt).toEqual([0.2, 0.7, 1.2]);
      expect(out.frames).toHaveLength(3);
      expect(out.inspect.frameCount).toBe(3);
      // 3 frames across 1.0 s of clip: two intervals, so 2 fps.
      expect(out.fps).toBe(2);
      expect(out.trim).toEqual({ start: 0.2, end: 1.2 });
      expect(out.schedule).toBe("explicit");
      // Everything after sampling is the existing chain, so `register-run`
      // still finds what it reads.
      expect(out.source).toBe("video");
      expect(out.video).toBe(clip());
    });

    test("--at repeats and flattens, like every other list flag here", () => {
      const ws = fresh();
      const out = runJson(
        "from-video", clip(), "--out", join(ws, "at2"), "--name", "hop",
        "--at", "0.2", "--at", "0.7,1.1",
      );
      expect(out.sampledAt).toEqual([0.2, 0.7, 1.1]);
    });

    test("--at refuses by name what it cannot sample", () => {
      const ws = fresh();
      const cases: Array<{ args: string[]; names: string[] }> = [
        { args: ["--at", "0.2,0.7", "--frames", "4"], names: ["--at", "--frames"] },
        { args: ["--at", "0.2,0.7", "--trim-start", "0.1"], names: ["--at", "--trim-start"] },
        { args: ["--at", "0.2,0.7", "--trim-end", "1.5"], names: ["--at", "--trim-end"] },
        { args: ["--at", "1.2,0.7"], names: ["--at"] },
        { args: ["--at", "0.2,2.5"], names: ["--at"] },
        { args: ["--at", "0.5"], names: ["--at"] },
        {
          args: ["--at", Array.from({ length: 101 }, (_, i) => (i * 0.01).toFixed(2)).join(",")],
          names: ["--at", "100"],
        },
      ];
      for (const { args, names } of cases) {
        const r = run("from-video", clip(), "--out", join(ws, "no"), "--name", "x", ...args, "--json");
        expect({ args, code: r.code }).toEqual({ args, code: 1 });
        for (const name of names) {
          expect({ args, contains: r.err.includes(name) }).toEqual({ args, contains: true });
        }
      }
    });
  });

  describe("the last frame that can still be seeked to", () => {
    /**
     * 122 frames at 24 fps, so the last one presents at 121/24 = 5.041666…
     *
     * That number is where the clamp used to land, and it does not survive the
     * trip to ffmpeg: as a double it rounds UP past the frame it names, and
     * every caller rounds its timestamps to milliseconds on top of that, which
     * makes it 5.042. `-ss 5.041667` decodes the last frame; `-ss 5.042`
     * decodes nothing AND exits 0, so `contact` died renaming a still that was
     * never written (`ENOENT … .023.tmp.png`) and `from-video` refused a clip
     * it could perfectly well sample.
     */
    const longClip = () => {
      const key = "clip:last-frame";
      if (!built.has(key)) {
        built.set(key, buildExprClip(join(shared(), "last-frame.mp4"), {
          frames: 122, x: "24+8*sin(2*PI*t)", y: "24+8*cos(2*PI*t)",
        }));
      }
      return built.get(key)!;
    };

    test("contact tiles a clip whose last frame sits on a non-terminating decimal", () => {
      const ws = fresh();
      const out = join(ws, "contact.png");
      const json = runJson("contact", longClip(), "--out", out, "--count", "24", "--width", "40");
      expect(json.tiles).toHaveLength(24);
      expect(json.duration).toBeCloseTo(5.083, 2);
      // Strictly before the last frame's presentation time, and still inside
      // the last frame's own period, so it selects that frame.
      expect(json.tiles[23].t).toBeLessThan(5.041667);
      expect(json.tiles[23].t).toBeGreaterThan(5.041667 - 1 / 24);
      expect(existsSync(out)).toBe(true);
    });

    test("from-video samples the same clip all the way to its last frame", () => {
      const ws = fresh();
      const json = runJson(
        "from-video", longClip(), "--out", join(ws, "m"), "--name", "m",
        "--frames", "4", "--no-loop",
      );
      // (122 - 1.5) / 24, rounded to the millisecond every timestamp is.
      expect(json.sampledAt[3]).toBe(5.021);
      expect(json.frames).toHaveLength(4);
      for (const frame of json.frames) {
        expect({ frame, exists: existsSync(frame) }).toEqual({ frame, exists: true });
      }
    });
  });

  // -------------------------------------------------------------------------
  // loop — every frame of a closed window as a transparent UI animation
  // -------------------------------------------------------------------------

  describe("loop", () => {
    /** Built once, like every other fixture, and only ever read. */
    const clip = (key: string, name: string, options: BuildExprClipOptions) => {
      const id = `clip:${key}`;
      if (!built.has(id)) built.set(id, buildExprClip(join(shared(), name), options));
      return built.get(id)!;
    };

    /**
     * A 16x16 box orbiting once a second on a chroma plate, 24 frames at
     * 24 fps: a window that closes on itself, at constant speed so every step
     * is the same size and the seam is one of them.
     */
    const orbit = () => clip("orbit", "orbit.mp4", {
      x: "24+8*sin(2*PI*t)", y: "24+8*cos(2*PI*t)",
    });
    /** The same box, swinging out and back over half a second and then frozen
     *  on the opening pose for the other half — a first-last clip's duplicate
     *  closing keyframe, twelve times over. */
    const frozenTail = () => clip("frozen", "frozen.mp4", {
      x: "if(lt(t,0.5),24+24*sin(2*PI*t),24)",
    });
    /** A box that leaves and never comes back: the loop that does not close. */
    const sweep = () => clip("sweep", "sweep.mp4", { x: "8+40*t" });
    /** A box that never moves at all. Its silhouette step is 0 — far under the
     *  0.005 absolute floor the hold threshold used to carry — so it is the
     *  clip that tells which of the two rules decided what counts as held.
     *  Named `static`, not `still`: `contact` already owns `clip:still` and
     *  `shared()/still.mp4`, and both the memo key and the path are shared
     *  across the whole file, so the describe that ran first would have
     *  silently handed its own 3 s / 10 fps clip to the other. */
    const staticClip = () => clip("static", "static.mp4", { x: "24", y: "24" });
    /** A big WHITE box on green, 96x96: a bright subject whose edge shows a
     *  dark fringe the moment anything scales it in straight alpha. */
    const soft = () => clip("soft", "soft.mp4", {
      width: 96, height: 96, box: { w: 40, h: 40, color: "white" },
      x: "28+8*sin(2*PI*t)", y: "28+8*cos(2*PI*t)",
    });
    /** The same orbit shot with no plate at all, carried as ProRes 4444 alpha
     *  — what a matting endpoint hands back. */
    const matted = () => clip("matted", "matted.mov", {
      background: "black@0", encode: "prores4444",
      x: "24+8*sin(2*PI*t)", y: "24+8*cos(2*PI*t)",
    });
    /** 600 px across — wider than the 512 cap `--width` falls back to. */
    const wide = () => clip("wide", "wide.mp4", {
      width: 600, height: 512, box: { w: 64, h: 64, color: "red" },
      x: "268+8*sin(2*PI*t)", y: "224+8*cos(2*PI*t)",
    });
    /** The only fixture whose frames are BIG: 15 frames of temporal noise, so
     *  the Lottie and the APNG really go over their size limits. */
    const noisy = () => {
      const id = "clip:noise";
      if (!built.has(id)) built.set(id, buildNoiseClip(join(shared(), "noise.mp4")));
      return built.get(id)!;
    };

    /** Four encoders per run is most of this describe's wall time, so every
     *  case that is not about the deliverables asks for one of them. */
    const WEBP_ONLY = ["--formats", "webp"];

    /** The seam-fill cases each build a clip and drive two whole `loop` runs —
     *  3.2s measured when one of them pays for the fixtures cold, which leaves
     *  no headroom under bun's 5s default while the rest of the suite is
     *  competing for ffmpeg. Whichever case runs first pays; which one that is
     *  depends on the filter, so they all carry the same bound. */
    const SEAM_FILL_TIMEOUT_MS = 20_000;

    /** The two export-size cases each drive a whole `loop` over 15 frames of
     *  600x512 noise and write a 14 MB Lottie: ~4.5s measured per run, and
     *  the first of them pays for the fixture. */
    const EXPORT_SIZE_TIMEOUT_MS = 60_000;

    /** One `loop` per distinct set of flags, shared by the cases that only
     *  read its output — a run is ~30 ffmpeg spawns. */
    const runs = new Map<string, { dir: string; json: any }>();
    const loop = (key: string, source: string, extra: string[] = []) => {
      if (!runs.has(key)) {
        const dir = join(shared(), `loop-${key}`);
        runs.set(key, { dir, json: runJson("loop", source, "--out", dir, "--name", key, ...extra) });
      }
      return runs.get(key)!;
    };

    const frameNames = (dir: string) => readdirSync(join(dir, "frames")).sort();

    test("the fixtures really move — measured, not assumed", () => {
      // The drawbox gotcha: a filter whose x/y is evaluated once at config
      // time produces a still image with a duration, and every assertion
      // below would pass on it. `overlay` is used for exactly this reason,
      // and this is the measurement that proves it worked.
      for (const [name, path] of Object.entries({ orbit: orbit(), sweep: sweep(), matted: matted() })) {
        const deltas = clipFrameDeltas(path);
        expect({ name, frames: deltas.length + 1 }).toEqual({ name, frames: 24 });
        expect({ name, quietestStep: Math.min(...deltas) > 10 }).toEqual({ name, quietestStep: true });
      }
      // …and the frozen fixture is frozen where it claims to be: its last
      // eleven steps are zero, its first twelve are not.
      const frozen = clipFrameDeltas(frozenTail());
      expect(Math.max(...frozen.slice(0, 11))).toBeGreaterThan(10);
      expect(Math.max(...frozen.slice(12))).toBe(0);

      // The static fixture argues the opposite, so it gets the same
      // measurement: 24 frames and not one pixel of change anywhere.
      const staticDeltas = clipFrameDeltas(staticClip());
      expect(staticDeltas).toHaveLength(23);
      expect(Math.max(...staticDeltas)).toBe(0);
    });

    test("keeps every frame of the window, keys the plate and names where each came from", () => {
      const { dir, json } = loop("orbit", orbit());

      expect(json.kind).toBe("loop");
      expect(json.source).toBe("video");
      expect(json.video).toBe(orbit());
      expect(json.motionDir).toBe(dir);
      expect(json.name).toBe("orbit");
      // Every frame, not a sample of them: 24 in, 24 out.
      expect(json.frames).toHaveLength(24);
      expect(json.fps).toBe(24);
      expect(json.duration).toBe(1);
      expect(json.trim).toEqual({ start: 0, end: 1 });
      expect(json.dropped).toEqual({ leading: 0, trailing: 0 });
      expect(json.keyColor).toMatch(/^#[0-9a-f]{6}$/);
      expect(json.alphaCoverage).toBeGreaterThan(0.03);
      expect(json.alphaCoverage).toBeLessThan(0.2);
      expect(json.sampledAt.slice(0, 3)).toEqual([0, 0.042, 0.083]);
      expect(json.sampledAt).toHaveLength(24);

      // A loop is not a sprite: no sheet, no atlas, no gif, no cells.
      for (const absent of ["sheet", "atlas", "gif", "cells", "anchor", "xFrom"]) {
        expect({ absent, value: json[absent] }).toEqual({ absent, value: undefined });
      }

      // Three digits, contiguous from 000, and that is what the JSON names.
      expect(frameNames(dir)).toEqual(Array.from({ length: 24 }, (_, i) => `${String(i).padStart(3, "0")}.png`));
      expect(json.frames[0]).toBe(join(dir, "frames", "000.png"));
      expect(json.frames[23]).toBe(join(dir, "frames", "023.png"));
    });

    test("the report is the loop shape, on disk and in the run summary", () => {
      const { dir, json } = loop("orbit", orbit());
      const onDisk = JSON.parse(readFileSync(join(dir, "inspect.json"), "utf-8"));
      expect(onDisk).toEqual(json.inspect);

      expect(json.inspect.kind).toBe("loop");
      expect(json.inspect.frameCount).toBe(24);
      expect(json.inspect.cell).toEqual(json.cell);
      expect(json.inspect.fps).toBe(24);
      expect(json.inspect.duration).toBe(1);
      expect(json.inspect.emptyFrames).toEqual([]);
      expect(json.inspect.dropped).toEqual({ leading: 0, trailing: 0 });
      expect(json.inspect.seamFill).toBe(0);
      expect(json.seamFill).toBe(0);
      expect(json.inspect.warnings).toEqual(json.warnings);
      // The seam is one step of a constant-speed orbit, so it closes.
      expect(json.inspect.seam).toBeLessThan(2 * json.inspect.step);
      expect(json.inspect.maxStep).toBeGreaterThanOrEqual(json.inspect.step);
      expect(json.warnings).toEqual([]);

      // Nothing a loop is not judged on.
      for (const absent of ["anchorDrift", "bodyDrift", "maxJump", "scaleDrift", "anchorPoint"]) {
        expect({ absent, value: json.inspect[absent] }).toEqual({ absent, value: undefined });
      }
    });

    test("writes all four deliverables in the containers they claim", () => {
      const { dir, json } = loop("orbit", orbit());
      expect(json.webp).toBe(join(dir, "loop.webp"));
      expect(json.apng).toBe(join(dir, "loop.apng"));
      expect(json.webm).toBe(join(dir, "loop.webm"));
      expect(json.lottie).toBe(join(dir, "loop.json"));
      for (const path of [json.webp, json.apng, json.webm, json.lottie]) {
        expect({ path, exists: existsSync(path) }).toEqual({ path, exists: true });
      }
      expect(json.inspect.exports).toEqual({
        webp: statSync(json.webp).size,
        apng: statSync(json.apng).size,
        webm: statSync(json.webm).size,
        lottie: statSync(json.lottie).size,
      });

      // ffprobe reads the two it can read; it cannot read an animated WebP at
      // all, so that one is identified by its own container.
      expect(codecOf(json.apng)).toBe("apng");
      expect(codecOf(json.webm)).toBe("vp9");
      const webp = readFileSync(json.webp);
      expect(webp.subarray(0, 4).toString("latin1")).toBe("RIFF");
      expect(webp.subarray(8, 12).toString("latin1")).toBe("WEBP");
      // One ANMF per frame, the file declares transparency, and the loop count
      // is 0 = forever.
      const animation = webpAnimation(json.webp);
      expect(animation.frames).toHaveLength(24);
      expect(animation.loops).toBe(0);
      expect(animation.declaresAlpha).toBe(true);
    });

    test("the WebP shows each frame on its own, not stacked on the ones before", () => {
      const { json } = loop("orbit", orbit());

      // ffmpeg's still `libwebp` encoder — which this export used to go
      // through — hands the muxer one full-canvas image per frame, and every
      // ANMF comes out blended onto the canvas the frame before it left
      // behind, disposing nothing. A compositing decoder (libwebp's own
      // animation decoder, every browser) therefore paints frame i on TOP of
      // frame i-1, and the transparency of a UI loop shows the older
      // silhouettes through. Frames 000 and 012 of this orbit are disjoint —
      // the box is 16px and swings 16px — so the ghost is a second box.
      //
      // Measured 2026-09-22, ffmpeg 8.0, decoding both encodes back through
      // libwebp's animation decoder and diffing against the source PNGs:
      // libwebp's worst frame was 73.9 mean |alpha - source| (max 255) on this
      // fixture and 12.7 on the 119-frame trial flame; `libwebp_anim` scored
      // 0.0 and 0.037. That cannot be re-measured here — ffmpeg cannot read an
      // animated WebP and libwebp is not a dependency of this repo — so the
      // two halves of the difference are checked in the container instead.
      //
      // One: no frame is a full-canvas blend over a canvas nothing cleared.
      // That is the only shape ffmpeg's still encoder writes (23 of these 24
      // frames, and 118 of the flame's 119); `libwebp_anim` writes none.
      expect(webpStackedFrames(json.webp)).toEqual([]);

      // Two: some frame is a sub-rectangle of the canvas. Only libwebp's
      // animation encoder ever emits one, so this is the positive half — the
      // frame optimisation that makes the composited canvas equal the frame it
      // was handed really ran, rather than the export having quietly fallen
      // back to a chain of full-canvas images.
      const { canvas, frames } = webpAnimation(json.webp);
      expect(canvas).toEqual({ width: json.cell.width, height: json.cell.height });
      expect(frames.some((f) => f.w < canvas!.width || f.h < canvas!.height)).toBe(true);
    });

    test("the Lottie is an image sequence, one embedded PNG per frame", () => {
      const { json } = loop("orbit", orbit());
      const doc = JSON.parse(readFileSync(json.lottie, "utf-8"));
      expect(doc.v).toBe("5.7.4");
      expect(doc.fr).toBe(24);
      expect(doc.ip).toBe(0);
      expect(doc.op).toBe(24);
      expect({ w: doc.w, h: doc.h }).toEqual({ w: json.cell.width, h: json.cell.height });
      expect(doc.assets).toHaveLength(24);
      expect(doc.layers).toHaveLength(24);

      expect(doc.assets[0].id).toBe("img_0");
      expect(doc.assets[0].e).toBe(1);
      expect(doc.assets[0].p.startsWith("data:image/png;base64,")).toBe(true);
      // The asset really is that frame's PNG.
      expect(Buffer.from(doc.assets[5].p.split(",")[1], "base64"))
        .toEqual(readFileSync(join(json.motionDir, "frames", "005.png")));

      // Each layer is an image layer visible for exactly its own frame.
      expect(doc.layers[0]).toMatchObject({ ty: 2, ind: 1, refId: "img_0", ip: 0, op: 1, ao: 0, bm: 0, sr: 1 });
      expect(doc.layers[23]).toMatchObject({ ty: 2, ind: 24, refId: "img_23", ip: 23, op: 24 });
      expect(doc.layers[0].ks.o).toEqual({ a: 0, k: 100 });
      expect(doc.layers[0].ks.s).toEqual({ a: 0, k: [100, 100, 100] });
    });

    test("--trim-holds drops a frozen tail and leaves a clip that never holds alone", () => {
      const held = loop("frozen", frozenTail(), WEBP_ONLY).json;
      expect(held.dropped.trailing).toBeGreaterThan(0);
      expect(held.dropped.leading).toBe(0);
      expect(held.inspect.frameCount).toBe(24 - held.dropped.trailing);
      expect(held.frames).toHaveLength(held.inspect.frameCount);
      expect(frameNames(loop("frozen", frozenTail(), WEBP_ONLY).dir)).toHaveLength(held.inspect.frameCount);

      // The clip that moves from frame 1 and returns loses nothing.
      expect(loop("orbit", orbit()).json.dropped).toEqual({ leading: 0, trailing: 0 });

      // …and the trimming is a default, not a law.
      const kept = loop("frozen-kept", frozenTail(), ["--no-trim-holds", ...WEBP_ONLY]).json;
      expect(kept.dropped).toEqual({ leading: 0, trailing: 0 });
      expect(kept.inspect.frameCount).toBe(24);
    }, 20_000);

    test("what counts as a hold is this clip's own step, not an absolute floor", () => {
      // The threshold is `0.25 * median step` and nothing else. It used to be
      // floored at 0.005, which is a number measured on one clip deciding what
      // "held" means on every other: on the owner's reference flame — whose
      // colour moves far more than its outline, median silhouette step 0.0043
      // — that floor dropped 12 leading and 1 trailing frame of a clip that
      // holds nothing, and the relative rule keeps all 122 (seam 0.0036
      // against step 0.0043, measured 2026-09-22).
      //
      // This fixture is the extreme of that: a box that never moves at all, so
      // every step is 0. Under the floor every frame read as held and the run
      // was refused as "one pose throughout"; under the clip's own rule there
      // is no scale on which anything is held, so nothing is dropped and the
      // report says plainly that the loop has no motion in it.
      const { json } = loop("static", staticClip(), WEBP_ONLY);
      expect(json.dropped).toEqual({ leading: 0, trailing: 0 });
      expect(json.inspect.frameCount).toBe(24);
      expect(json.inspect.step).toBe(0);
      expect(json.inspect.maxStep).toBe(0);
      expect(json.inspect.seam).toBe(0);
      // A step of 0 gives the seam no scale to be judged against, so neither
      // the warning nor the fill may invent one.
      expect(json.inspect.seamFill).toBe(0);
      expect(json.warnings).toEqual([]);
    });

    test("a loop that does not close says so, with both numbers", () => {
      // --seam-fill none, because "did this clip close" is a question about
      // the frames the model drew; what the default then does about the answer
      // is the next case.
      const { json } = loop("sweep", sweep(), ["--seam-fill", "none", ...WEBP_ONLY]);
      expect(json.seamFill).toBe(0);
      expect(json.inspect.seam).toBeGreaterThan(2 * json.inspect.step);
      const seamWarning = json.warnings.find((w: string) => w.includes("does not close"));
      expect(seamWarning).toContain(String(json.inspect.seam));
      expect(seamWarning).toContain(String(json.inspect.step));
      expect(seamWarning).toContain("--trim-start");
      // The same sentence reaches the report the viewer reads.
      expect(json.inspect.warnings).toContain(seamWarning);
    });

    test("--seam-fill auto only fires on a seam worth seeing, and cannot launder one", () => {
      // The wrap from the last frame back to the first is the one transition
      // the model never drew, so above the same line the warning is drawn at
      // — two normal steps — the default interpolates in-betweens for it.
      // A constant-speed orbit's seam IS one of its steps, so it gets none.
      expect(loop("orbit", orbit()).json.seamFill).toBe(0);

      // The sweep never comes back: seam 1 (no overlap at all) against a 0.2
      // step, so `ceil(1 / 0.2) - 1` wants 4 and 4 is the cap. The wrap gets
      // shorter — 1 → 0.44 — and the loop four frames longer, but four
      // invented frames cannot turn a clip that was never shot as a loop into
      // one, so the warning has to survive, now saying what was tried.
      const { json } = loop("sweep-auto", sweep(), WEBP_ONLY);
      expect(json.seamFill).toBe(4);
      expect(json.inspect.seamFill).toBe(4);
      expect(json.inspect.frameCount).toBe(28);
      expect(json.inspect.seam).toBeLessThan(loop("sweep", sweep(), ["--seam-fill", "none", ...WEBP_ONLY]).json.inspect.seam);
      expect(json.inspect.seam).toBeGreaterThan(2 * json.inspect.step);
      expect(json.warnings.join(" ")).toContain("does not close");
      expect(json.warnings.join(" ")).toContain("4 interpolated frame(s)");
    }, SEAM_FILL_TIMEOUT_MS);

    test("--seam-fill N fills the wrap with frames that are between its two ends", () => {
      // Forced, on the matted clip, so this covers the alpha-carrying input as
      // well: by the time the wrap is filled both paths are the same RGBA
      // sequence, and `minterpolate` is run on it in yuva444p — alpha
      // included — rather than on a plate that no longer exists here.
      const plain = loop("matted", matted(), ["--key", "alpha", ...WEBP_ONLY]).json;
      const { dir, json } = loop("matted-fill", matted(), ["--key", "alpha", "--seam-fill", "2", ...WEBP_ONLY]);

      expect(plain.seamFill).toBe(0);
      expect(json.seamFill).toBe(2);
      expect(json.inspect.frameCount).toBe(26);
      expect(frameNames(dir)).toHaveLength(26);
      // The loop grows by exactly the frames that were added, at the same fps.
      expect(json.duration).toBe(1.083);
      expect(json.fps).toBe(24);
      // A filled frame has a place in the loop but no source timestamp.
      expect(json.sampledAt.slice(0, 24).every((t: unknown) => typeof t === "number")).toBe(true);
      expect(json.sampledAt.slice(24)).toEqual([null, null]);

      // The two new frames are really in the gap: each is much closer to the
      // end it sits beside than the two ends are to each other, and the wrap
      // the report now names is the worst step across them, not the gap.
      const frame = (name: string) => join(dir, "frames", name);
      const ends = silhouetteDiff(frame("023.png"), frame("000.png"));
      const toLast = silhouetteDiff(frame("023.png"), frame("024.png"));
      const toFirst = silhouetteDiff(frame("025.png"), frame("000.png"));
      expect(toLast).toBeLessThan(ends / 2);
      expect(toFirst).toBeLessThan(ends / 2);
      expect(toLast).toBeGreaterThan(0);
      expect(toFirst).toBeGreaterThan(0);
      expect(json.inspect.seam).toBeLessThan(plain.inspect.seam);
    }, SEAM_FILL_TIMEOUT_MS);

    test("--seam-fill none leaves the wrap as shot; N fills one auto would not", () => {
      // `none` on the clip whose seam auto WOULD have filled: 24 shot frames,
      // every one of them with the timestamp it came from.
      const raw = loop("sweep", sweep(), ["--seam-fill", "none", ...WEBP_ONLY]).json;
      expect(raw.seamFill).toBe(0);
      expect(raw.inspect.seamFill).toBe(0);
      expect(raw.inspect.frameCount).toBe(24);
      expect(raw.sampledAt.every((t: unknown) => typeof t === "number")).toBe(true);

      // …and a count on the clip auto leaves alone: an explicit number is what
      // the caller saw on the contact sheet, not something to second-guess.
      const forced = loop("orbit-fill", orbit(), ["--seam-fill", "2", ...WEBP_ONLY]).json;
      expect(forced.seamFill).toBe(2);
      expect(forced.inspect.seamFill).toBe(2);
      expect(forced.inspect.frameCount).toBe(26);
      expect(forced.duration).toBe(1.083);
      expect(forced.sampledAt.slice(24)).toEqual([null, null]);
    }, SEAM_FILL_TIMEOUT_MS);

    test("--key alpha decodes the clip's own matte instead of keying a plate", () => {
      const { dir, json } = loop("matted", matted(), ["--key", "alpha", ...WEBP_ONLY]);
      expect(json.keyColor).toBeUndefined();
      expect(json.inspect.keyColor).toBeUndefined();
      expect(json.inspect.frameCount).toBe(24);
      // A 16x16 box in a 64x64 frame, and nothing else opaque.
      expect(json.alphaCoverage).toBeCloseTo(256 / 4096, 3);
      const frame = readBbox(join(dir, "frames", "000.png"));
      expect(frame.bbox).not.toBeNull();
      expect(frame.coverage).toBeLessThan(0.5);
    });

    test("--key alpha on an opaque clip is refused by name instead of matting nothing", () => {
      const ws = fresh();
      const r = run("loop", orbit(), "--out", join(ws, "no"), "--name", "x", "--key", "alpha", "--json");
      expect(r.code).toBe(1);
      expect(r.err).toContain("fully opaque");
      expect(r.err).toContain("remove-video-background.mjs");
    });

    test("--fps is refused on an alpha clip and names the tool that does it first", () => {
      const ws = fresh();
      const r = run("loop", matted(), "--out", join(ws, "no"), "--name", "x",
        "--key", "alpha", "--fps", "48", "--json");
      expect(r.code).toBe(1);
      expect(r.err).toContain("interpolate-video.mjs");
    });

    test("--fps interpolates the plate and keeps the wrap smooth", () => {
      const { json } = loop("orbit48", orbit(), ["--fps", "48", ...WEBP_ONLY]);
      expect(json.fps).toBe(48);
      expect(json.inspect.frameCount).toBe(48);
      expect(json.duration).toBe(1);
      // i / N from the window start, per the contract.
      expect(json.sampledAt.slice(0, 3)).toEqual([0, 0.021, 0.042]);
      // The in-betweens that carry the last frame back into the first are
      // real frames, so the seam is still one step — without them it stayed
      // at the source clip's 0.36 against a 0.11 step.
      expect(json.inspect.seam).toBeLessThan(2 * json.inspect.step);
    });

    test("--crop union is one rect over every frame; --crop none and --pad say otherwise", () => {
      // The box is 16 wide and orbits +-8, so the union bbox is 32 px across;
      // --pad 8 on each side makes the cell 48.
      expect(loop("orbit", orbit()).json.cell).toEqual({ width: 48, height: 48 });
      expect(loop("orbit-pad0", orbit(), ["--pad", "0", ...WEBP_ONLY]).json.cell).toEqual({ width: 32, height: 32 });
      expect(loop("orbit-nocrop", orbit(), ["--crop", "none", ...WEBP_ONLY]).json.cell).toEqual({ width: 64, height: 64 });
    });

    test("the report records the rect it cut from the clip and the scale it drew that rect at", () => {
      // What maps a frame back onto its clip: frame px = (clip px − crop.xy)
      // × scale. Two loops of one character are cut to their own union boxes
      // and scaled to one width, so without this nobody downstream can tell
      // how large the character is in each, or where it stood in the clip.
      const orbitRun = loop("orbit", orbit());
      expect(orbitRun.json.crop).toEqual({ x: 8, y: 8, w: 48, h: 48 });
      expect(orbitRun.json.scale).toBe(1);
      const onDisk = JSON.parse(readFileSync(join(orbitRun.dir, "inspect.json"), "utf-8"));
      expect({ crop: onDisk.crop, scale: onDisk.scale }).toEqual({ crop: { x: 8, y: 8, w: 48, h: 48 }, scale: 1 });
      expect({ crop: orbitRun.json.inspect.crop, scale: orbitRun.json.inspect.scale })
        .toEqual({ crop: onDisk.crop, scale: onDisk.scale });

      // The 40 px box swings ±8 in a 96 px clip: union 20..76, pad 8 → 72 px,
      // drawn at 32 px wide.
      const scaled = loop("soft-32", soft(), ["--width", "32", ...WEBP_ONLY]).json;
      expect(scaled.crop).toEqual({ x: 12, y: 12, w: 72, h: 72 });
      expect(scaled.scale).toBe(0.4444);

      // --crop none keeps the whole clip, and says so the same way.
      const whole = loop("orbit-nocrop", orbit(), ["--crop", "none", ...WEBP_ONLY]).json;
      expect({ crop: whole.crop, scale: whole.scale }).toEqual({ crop: { x: 0, y: 0, w: 64, h: 64 }, scale: 1 });
    });

    test("--width scales in premultiplied alpha: no dark fringe, no colour under the transparency", () => {
      const scaled = loop("soft-32", soft(), ["--width", "32", ...WEBP_ONLY]).json;
      expect(scaled.cell).toEqual({ width: 32, height: 32 });

      // The plate never reaches a transparent pixel, at any scale.
      for (const index of ["000", "012"]) {
        const audit = alphaColorAudit(join(scaled.motionDir, "frames", `${index}.png`));
        expect({ index, hiddenColors: audit.hiddenColors }).toEqual({ index, hiddenColors: ["0,0,0"] });
      }

      // …and the edge of a WHITE subject stays white. Scaled in straight
      // alpha it would be averaged with the zeroed plate beside it and come
      // back grey, which is the dark fringe this is the test for.
      const edge = edgeLuma(join(scaled.motionDir, "frames", "000.png"));
      expect(edge.count).toBeGreaterThan(20);
      expect(edge.min).toBeGreaterThan(160);
    });

    test("--formats writes only what was asked for", () => {
      const { dir, json } = loop("orbit-webp", orbit(), ["--formats", "lottie,webp"]);
      expect(json.webp).toBe(join(dir, "loop.webp"));
      expect(json.lottie).toBe(join(dir, "loop.json"));
      expect(json.apng).toBeUndefined();
      expect(json.webm).toBeUndefined();
      expect(Object.keys(json.inspect.exports)).toEqual(["webp", "lottie"]);
      expect(existsSync(join(dir, "loop.apng"))).toBe(false);
      expect(existsSync(join(dir, "loop.webm"))).toBe(false);
    });

    test("--key none keeps the frames opaque and says that out loud", () => {
      const { json } = loop("orbit-raw", orbit(), ["--key", "none", "--formats", "webp"]);
      expect(json.keyColor).toBeUndefined();
      expect(json.alphaCoverage).toBe(1);
      expect(json.cell).toEqual({ width: 64, height: 64 });
      expect(json.warnings.join(" ")).toContain("opaque");
    });

    test("--json is one object; the human form names the seam and the exports", () => {
      const ws = fresh();
      const asJson = run("loop", orbit(), "--out", join(ws, "j"), "--name", "j",
        "--formats", "webp", "--json");
      expect(asJson.code).toBe(0);
      expect(asJson.out.trim().split("\n")).toHaveLength(1);
      expect(() => JSON.parse(asJson.out)).not.toThrow();

      const human = run("loop", orbit(), "--out", join(ws, "h"), "--name", "h", "--formats", "webp");
      expect(human.code).toBe(0);
      expect(human.out).toContain("24 frames of 48x48 at 24fps");
      expect(human.out).toContain("seam ");
      expect(human.out).toContain("dropped 0 leading / 0 trailing, seam-fill 0");
      expect(human.out).toContain("webp ");
    });

    test("refuses by name what it cannot do", () => {
      const ws = fresh();
      const cases: Array<{ args: string[]; names: string[] }> = [
        { args: [join(ws, "nope.mp4"), "--out", join(ws, "a"), "--name", "x"], names: ["nope.mp4"] },
        { args: [orbit(), "--name", "x"], names: ["--out"] },
        { args: [orbit(), "--out", join(ws, "b")], names: ["--name"] },
        { args: [orbit(), "--out", join(ws, "c"), "--name", "x", "--crop", "sideways"], names: ["--crop"] },
        { args: [orbit(), "--out", join(ws, "d"), "--name", "x", "--formats", "gif"], names: ["--formats", "gif"] },
        { args: [orbit(), "--out", join(ws, "e"), "--name", "x", "--key", "#zzzzzz"], names: ["--key"] },
        { args: [orbit(), "--out", join(ws, "f"), "--name", "x", "--trim-holds", "--no-trim-holds"], names: ["--trim-holds"] },
        { args: [orbit(), "--out", join(ws, "g"), "--name", "x", "--trim-start", "5"], names: ["--trim-start"] },
        { args: [orbit(), "--out", join(ws, "h"), "--name", "x", "--seam-fill", "some"], names: ["--seam-fill"] },
        { args: [orbit(), "--out", join(ws, "i"), "--name", "x", "--seam-fill=-1"], names: ["--seam-fill"] },
        // The fill is frames, and frames are capped like every other frame.
        { args: [orbit(), "--out", join(ws, "j"), "--name", "x", "--seam-fill", "400"], names: ["--seam-fill", "400"] },
      ];
      for (const { args, names } of cases) {
        const r = run("loop", ...args, "--json");
        expect({ args, code: r.code }).toEqual({ args, code: 1 });
        for (const name of names) {
          expect({ args, contains: r.err.includes(name) }).toEqual({ args, contains: true });
        }
      }
    });

    test("--width defaults to a 512 cap on a big frame, and says it chose", () => {
      // The Kiki loop was cut at the clip's own 532 px because nobody passed
      // --width, and its Lottie came out at 45 MB. The cap is a default, not a
      // rule: it says what it did and which flag overrides it.
      const ws = fresh();
      const dir = join(ws, "capped");
      const r = run("loop", wide(), "--out", dir, "--name", "w",
        "--crop", "none", "--formats", "webp", "--json");
      expect(r.code).toBe(0);
      const json = JSON.parse(r.out);
      expect(json.cell.width).toBe(512);
      expect(json.widthDefaulted).toBe(true);
      expect(json.inspect.widthDefaulted).toBe(true);
      expect(JSON.parse(readFileSync(join(dir, "inspect.json"), "utf-8")).widthDefaulted).toBe(true);
      expect(r.err).toContain("no --width given: frames capped at 512 px (source 600 px); pass --width to choose");

      // An explicit width is obeyed, above or below the cap, and nothing is
      // claimed about a default that did not happen.
      const asked = loop("wide-600", wide(), ["--crop", "none", "--width", "600", ...WEBP_ONLY]).json;
      expect(asked.cell.width).toBe(600);
      expect("widthDefaulted" in asked).toBe(false);
      expect("widthDefaulted" in asked.inspect).toBe(false);

      // A frame already under the cap is left alone and says nothing: the
      // 48 px orbit is not scaled up to 512.
      const small = run("loop", orbit(), "--out", join(ws, "small"), "--name", "s",
        ...WEBP_ONLY, "--json");
      expect(JSON.parse(small.out).cell.width).toBe(48);
      expect("widthDefaulted" in JSON.parse(small.out)).toBe(false);
      expect(small.err).not.toContain("--width");
    }, SEAM_FILL_TIMEOUT_MS);

    test("an export nobody can ship says what to do about it, given what was asked", () => {
      // Both halves of the Kiki complaint. Without --width the advice is to
      // pass it; WITH it, "pass --width to shrink" is dead advice — the answer
      // is a smaller number or a different format. The fixture is temporal
      // noise because that is the only thing here whose PNGs are big.
      const ws = fresh();
      const clip = noisy();
      // The fixture really is 15 distinct frames of noise, not one still —
      // measured at the clip's own width, because the 48px analysis every
      // other fixture uses averages noise back into a flat grey.
      const deltas = clipFrameDeltas(clip, 600);
      expect(deltas).toHaveLength(14);
      expect(Math.min(...deltas)).toBeGreaterThan(100);

      const defaulted = run("loop", clip, "--out", join(ws, "big"), "--name", "b",
        "--key", "none", "--crop", "none", "--seam-fill", "none",
        "--formats", "lottie,apng", "--json");
      expect(defaulted.code).toBe(0);
      const capped = JSON.parse(defaulted.out);
      expect(capped.cell.width).toBe(512);
      expect(capped.inspect.exports.lottie).toBeGreaterThan(8 * 1024 * 1024);
      expect(capped.inspect.exports.apng).toBeGreaterThan(8 * 1024 * 1024);
      const lottieWarning = capped.warnings.find((w: string) => w.startsWith("loop.json is"));
      const apngWarning = capped.warnings.find((w: string) => w.startsWith("loop.apng is"));
      expect(lottieWarning).toContain("pass --width to shrink the frames");
      expect(apngWarning).toContain("pass --width to shrink the frames");
      expect(capped.warnings.join(" ")).not.toContain("already at --width");

      const asked = run("loop", clip, "--out", join(ws, "asked"), "--name", "a",
        "--key", "none", "--crop", "none", "--seam-fill", "none",
        "--width", "512", "--formats", "lottie", "--json");
      expect(asked.code).toBe(0);
      const explicit = JSON.parse(asked.out);
      expect(explicit.cell.width).toBe(512);
      const asWarned = explicit.warnings.find((w: string) => w.startsWith("loop.json is"));
      expect(asWarned).toContain("already at --width 512; halve it, or ship loop.webm instead");
      expect(asWarned).not.toContain("pass --width");
    }, EXPORT_SIZE_TIMEOUT_MS);

    test("leaves no working directory behind, whether it finishes or fails", () => {
      const ws = fresh();
      const dir = join(ws, "clean");
      runJson("loop", orbit(), "--out", dir, "--name", "c", "--formats", "webp");
      expect(readdirSync(dir).sort()).toEqual(["frames", "inspect.json", "loop.webp"]);

      // …and a refusal raised INSIDE the run — the alpha probe is the first
      // thing the working directory exists for — sweeps up on the way out.
      const bad = join(ws, "bad");
      const r = run("loop", orbit(), "--out", bad, "--name", "b", "--key", "alpha", "--json");
      expect(r.code).toBe(1);
      expect(existsSync(join(bad, ".loop-work"))).toBe(false);
      expect(readdirSync(bad)).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Connected motions: the clip between two loops, and how the loops line up
  // -------------------------------------------------------------------------

  /**
   * Two loops and the clip between them — 192 px matted clips of one 24×96
   * body on one floor (y 72..168), the way every clip of one character
   * agrees:
   *   stand — sways ±6 px around x 84 (its frame 0 at 84), cut 96 px wide
   *   lean  — sways ±6 px around x 48 (its frame 0 at 48), cut 64 px wide
   *   the stand → lean take holds at 84 for 0.5 s, walks to 48 over 1 s and
   *   holds there for 0.5 s — 48 frames at 24 fps, the holds a first-last
   *   model leaves at both ends.
   * The loops are cut at different widths, so their frames sit at different
   * scales; only clip coordinates line them up.
   */
  const HOP_BODY = { w: 24, h: 96, color: "red" };
  const hopClip = (name: string, x: string, frames = 24) => {
    const key = `clip:hop-${name}`;
    if (!built.has(key)) {
      built.set(key, buildExprClip(join(shared(), `hop-${name}.mov`), {
        width: 192, height: 192, fps: 24, frames, background: "black@0", encode: "prores4444",
        box: HOP_BODY, x, y: "72",
      }));
    }
    return built.get(key)!;
  };
  const STAND_TO_LEAN = "if(lt(t,0.5),84,if(lt(t,1.5),84-36*(t-0.5),48))";
  /** The same walk that overshoots to x 30 and stays there: an end that does not land. */
  const STAND_OVERSHOOT = "if(lt(t,0.5),84,if(lt(t,1.5),84-54*(t-0.5),30))";

  const hops = () => stage("hops", (dir) => {
    projectCmd(dir, "init", "--name", "Hops", "--cell", "64x64");
    for (const [id, x, width] of [["stand", "84+6*sin(2*PI*t)", "96"], ["lean", "48+6*sin(2*PI*t)", "64"]] as const) {
      const motionDir = join(dir, "motions", id);
      mkdirSync(motionDir, { recursive: true });
      cpSync(hopClip(id, x), join(motionDir, "video-veed-1.mov"));
      const summary = runJson("loop", join(motionDir, "video-veed-1.mov"), "--out", motionDir, "--name", id,
        "--key", "alpha", "--width", width, "--formats", "apng", "--seam-fill", "none");
      writeFileSync(join(motionDir, "run.json"), JSON.stringify(summary));
      projectCmd(dir, "add-motion", "--id", id, "--label", id === "stand" ? "Stand" : "Lean", "--kind", "loop", "--fps", "24");
      projectCmd(dir, "set-motion", "--motion", id, "--brief-duration", "1", "--brief-width", width, "--brief-interpolator", "none");
      projectCmd(dir, "add-video", "--motion", id, "--file", `motions/${id}/video-veed-1.mov`,
        "--model", "seedance-2.5", "--mode", "first-last", "--status", "ready");
      projectCmd(dir, "register-run", "--motion", id, "--run", join(motionDir, "run.json"));
    }
    projectCmd(dir, "add-motion", "--kind", "transition", "--from", "stand", "--to", "lean");
    projectCmd(dir, "set-motion", "--motion", "stand-to-lean", "--brief-duration", "0.5", "--brief-budget", "1.2");
    mkdirSync(join(dir, "motions", "stand-to-lean"), { recursive: true });
    cpSync(hopClip("walk", STAND_TO_LEAN, 48), join(dir, "motions", "stand-to-lean", "video-veed-1.mov"));
    projectCmd(dir, "add-video", "--motion", "stand-to-lean", "--file", "motions/stand-to-lean/video-veed-1.mov",
      "--model", "seedance-2.5", "--mode", "first-last", "--status", "ready");
  });
  const useHops = () => {
    const dir = join(fresh(), "hops");
    cpSync(hops(), dir, { recursive: true });
    return dir;
  };
  const cutTransition = (dir: string, ...flags: string[]) =>
    runJson("transition", join(dir, "motions", "stand-to-lean", "video-veed-1.mov"), "--character", dir,
      "--from", "stand", "--to", "lean", "--key", "alpha", "--width", "80", ...flags);
  /** The alpha ≥ 128 box of a PNG on disk. */
  const boxOf = (path: string) => {
    const image = readRgba(readFileSync(path));
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        if (image.data[(y * image.width + x) * 4 + 3] < 128) continue;
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
    }
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  };

  describe("transition", () => {
    const TIMEOUT_MS = 60_000;

    test("cuts the clip between two loops: holds collapsed to one frame each, crop and scale recorded, both ends land", () => {
      const dir = useHops();
      const json = cutTransition(dir);
      expect(json).toMatchObject({ kind: "transition", source: "video", from: "stand", to: "lean", name: "stand-to-lean" });
      expect(json.motionDir).toBe(join(dir, "motions", "stand-to-lean"));
      // 13 frames hold at 84 and 12 at 48: one of each is kept, and the walk
      // between them — frames 12..36 of the take.
      expect(json.dropped).toEqual({ leading: 12, trailing: 11 });
      expect(json.frames).toHaveLength(25);
      expect(json.sampledAt[0]).toBe(0.5);
      expect(json.sampledAt.at(-1)).toBe(1.5);
      // The union of the walk (x 48..108) plus 8 px, drawn 80 px wide.
      expect(json.crop).toEqual({ x: 40, y: 64, w: 76, h: 112 });
      expect(json.scale).toBe(1.0526);
      expect(json.inspect).toMatchObject({ kind: "transition", frameCount: 25, crop: json.crop, scale: json.scale });
      const onDisk = JSON.parse(readFileSync(join(json.motionDir, "inspect.json"), "utf-8"));
      expect(onDisk.startGap).toBe(json.inspect.startGap);

      const { step, startGap, endGap } = json.inspect;
      expect(step).toBeGreaterThan(0);
      expect(startGap).toBeLessThanOrEqual(2 * step);
      expect(endGap).toBeLessThanOrEqual(2 * step);
      expect(json.warnings).toEqual([]);
      // Frame 0 is where stand's frame 0 stands in the clip: x 84, 44 px
      // into the crop, at 80/76.
      expect(Math.abs(boxOf(json.frames[0]).x - 44 * (80 / 76))).toBeLessThanOrEqual(1);
    }, TIMEOUT_MS);

    test("--duration retimes to the playback length by even sampling that keeps the first and the last frame", () => {
      const dir = useHops();
      const json = cutTransition(dir, "--duration", "0.5");
      expect(json.frames).toHaveLength(12);
      expect(json.retime).toEqual({ from: 25, to: 12 });
      expect(json.duration).toBe(0.5);
      expect(json.sampledAt[0]).toBe(0.5);
      expect(json.sampledAt.at(-1)).toBe(1.5);
      expect(json.inspect.endGap).toBeLessThanOrEqual(2 * json.inspect.step);
      // Longer than the walk is not stretched: every frame is kept, and said.
      const long = cutTransition(dir, "--duration", "3");
      expect(long.frames).toHaveLength(25);
      expect(long.warnings.join(" ")).toMatch(/--duration 3.*25 frames.*1\.042s/);
    }, TIMEOUT_MS);

    test("--no-trim-holds keeps the holds", () => {
      const dir = useHops();
      expect(cutTransition(dir, "--no-trim-holds").frames).toHaveLength(48);
    }, TIMEOUT_MS);

    test("an end that does not land is measured and said, not assumed", () => {
      const dir = useHops();
      const clip = join(dir, "motions", "stand-to-lean", "overshoot.mov");
      cpSync(hopClip("overshoot", STAND_OVERSHOOT, 48), clip);
      const json = runJson("transition", clip, "--character", dir, "--from", "stand", "--to", "lean",
        "--key", "alpha", "--width", "80");
      const { step, startGap, endGap } = json.inspect;
      expect(startGap).toBeLessThanOrEqual(2 * step);
      expect(endGap).toBeGreaterThan(2 * step);
      expect(json.warnings).toEqual([expect.stringMatching(/the end does not land on lean's frame 0/)]);
      expect(json.inspect.warnings).toEqual(json.warnings);
    }, TIMEOUT_MS);

    test("--reverse-of plays a registered transition backwards, free, and measures its own ends", () => {
      const dir = useHops();
      const cut = cutTransition(dir, "--duration", "0.5");
      writeFileSync(join(dir, "motions", "stand-to-lean", "run.json"), JSON.stringify(cut));
      projectCmd(dir, "register-run", "--motion", "stand-to-lean", "--run", join(dir, "motions", "stand-to-lean", "run.json"));

      const json = runJson("transition", "--reverse-of", "stand-to-lean", "--character", dir);
      expect(json).toMatchObject({ kind: "transition", source: "reverse", reverseOf: "stand-to-lean", from: "lean", to: "stand" });
      expect(json.motionDir).toBe(join(dir, "motions", "lean-to-stand"));
      expect(json.frames).toHaveLength(12);
      expect(readFileSync(json.frames[0])).toEqual(readFileSync(cut.frames[11]));
      expect(readFileSync(json.frames[11])).toEqual(readFileSync(cut.frames[0]));
      expect({ crop: json.crop, scale: json.scale, fps: json.fps }).toEqual({ crop: cut.crop, scale: cut.scale, fps: cut.fps });
      expect(json.inspect.startGap).toBeCloseTo(cut.inspect.endGap, 4);
      expect(json.inspect.endGap).toBeCloseTo(cut.inspect.startGap, 4);
      expect(json.warnings).toEqual([]);

      // …and it registers, with its source.
      projectCmd(dir, "add-motion", "--kind", "transition", "--from", "lean", "--to", "stand");
      writeFileSync(join(json.motionDir, "run.json"), JSON.stringify(json));
      const motion = projectCmd(dir, "register-run", "--motion", "lean-to-stand", "--run", join(json.motionDir, "run.json"));
      expect(motion).toMatchObject({ reverseOf: "stand-to-lean", status: "ready" });
    }, TIMEOUT_MS);

    test("a registered transition exports as a one-shot: plays once, no GIF, no atlas", () => {
      const dir = useHops();
      const cut = cutTransition(dir, "--duration", "0.5");
      writeFileSync(join(dir, "motions", "stand-to-lean", "run.json"), JSON.stringify(cut));
      projectCmd(dir, "register-run", "--motion", "stand-to-lean", "--run", join(dir, "motions", "stand-to-lean", "run.json"));
      const motionDir = join(dir, "motions", "stand-to-lean");
      const webm = runJson("export", motionDir, "--format", "webm");
      expect(webm).toMatchObject({ motionKind: "transition", loop: false, repeat: 1, repeatDefaulted: true, frameCount: 12, duration: 0.5 });
      const seq = runJson("export", motionDir, "--format", "png-seq");
      const manifest = JSON.parse(readZip(readFileSync(seq.out)).find((e) => e.name.endsWith("animation.json"))!.data.toString());
      expect(manifest).toMatchObject({ kind: "transition", loop: false, fps: 24 });
      for (const [format, message] of [["gif", /a transition is not exported as GIF/], ["sheet", /a transition has no sprite sheet/]] as const) {
        const r = run("export", motionDir, "--format", format, "--json");
        expect(r.code).toBe(1);
        expect(r.err).toMatch(message);
      }
    }, TIMEOUT_MS);

    test("refuses by name what it cannot cut", () => {
      const dir = useHops();
      const clip = join(dir, "motions", "stand-to-lean", "video-veed-1.mov");
      const cases: Array<[string[], RegExp]> = [
        [[clip, "--character", dir, "--to", "lean"], /--from/],
        [[clip, "--character", dir, "--from", "sit", "--to", "lean"], /no motion 'sit'/],
        [[clip, "--character", dir, "--from", "stand", "--to", "stand"], /stand.*itself/],
        [[clip, "--from", "stand", "--to", "lean"], /--character/],
        [["--reverse-of", "stand-to-lean", "--character", dir], /stand-to-lean has no registered frames/],
        [["--reverse-of", "stand", "--character", dir], /'stand' is not a transition/],
        [[clip, "--reverse-of", "stand-to-lean", "--character", dir], /--reverse-of takes no clip/],
      ];
      for (const [argv, message] of cases) {
        const r = run("transition", ...argv, "--json");
        expect({ argv: argv.slice(-4), code: r.code, matches: message.test(r.err), err: message.test(r.err) ? "" : r.err })
          .toEqual({ argv: argv.slice(-4), code: 1, matches: true, err: "" });
      }
    }, TIMEOUT_MS);
  });

  describe("lineup", () => {
    const TIMEOUT_MS = 60_000;

    /** hops, plus `twin`: stand's clip cut again at 48 px wide — the same
     *  pose at a different scale, which only clip coordinates can see. */
    const withTwin = () => {
      const dir = useHops();
      const motionDir = join(dir, "motions", "twin");
      mkdirSync(motionDir, { recursive: true });
      cpSync(hopClip("stand", "84+6*sin(2*PI*t)"), join(motionDir, "video-veed-1.mov"));
      const summary = runJson("loop", join(motionDir, "video-veed-1.mov"), "--out", motionDir, "--name", "twin",
        "--key", "alpha", "--width", "48", "--formats", "apng", "--seam-fill", "none");
      writeFileSync(join(motionDir, "run.json"), JSON.stringify(summary));
      projectCmd(dir, "add-motion", "--id", "twin", "--label", "Twin", "--kind", "loop", "--fps", "24");
      projectCmd(dir, "set-motion", "--motion", "twin", "--brief-duration", "1", "--brief-width", "48", "--brief-interpolator", "none");
      projectCmd(dir, "add-video", "--motion", "twin", "--file", "motions/twin/video-veed-1.mov",
        "--model", "seedance-2.5", "--mode", "first-last", "--status", "ready");
      projectCmd(dir, "register-run", "--motion", "twin", "--run", join(motionDir, "run.json"));
      return dir;
    };

    test("every loop's frame 0 beside the hub's, in clip coordinates, with a suggestion and the rule behind it", () => {
      const dir = withTwin();
      const json = runJson("lineup", dir);
      expect(json.kind).toBe("lineup");
      expect(json.hub).toBe("stand");
      expect(json.out).toBe(join(dir, "lineup.png"));
      expect(existsSync(json.out)).toBe(true);
      expect(json.threshold).toMatchObject({ iou: expect.any(Number), chroma: expect.any(Number) });
      expect(json.threshold.rule).toMatch(/direct when/);
      expect(json.motions.map((m: any) => m.id)).toEqual(["stand", "lean", "twin"]);
      const [stand, lean, twin] = json.motions;
      expect(stand).toMatchObject({ hub: true, scaleFrom: "recorded" });
      expect(stand.scale).toBeCloseTo(96 / 52, 3);
      // twin is stand's own pose drawn at half the size: in clip coordinates
      // it is the same pose, and nothing is between them.
      expect(twin.scale).toBeCloseTo(48 / 52, 2);
      expect(twin.poseGap.iou).toBeGreaterThan(0.9);
      expect(twin.suggestion).toBe("direct");
      expect(twin.closestFrame.index).toBe(0);
      // lean stands 36 px away: no overlap at all.
      expect(lean.poseGap.iou).toBeLessThan(0.05);
      expect(lean.suggestion).toBe("transition");
      expect(lean.transitions).toEqual([]);
      // lineup.png: three panels side by side, one per loop.
      const png = readRgba(readFileSync(json.out));
      expect(png.width).toBeGreaterThan(3 * 40);
    }, TIMEOUT_MS);

    test("names the transitions already registered for each pair, and takes --hub", () => {
      const dir = useHops();
      const cut = runJson("transition", join(dir, "motions", "stand-to-lean", "video-veed-1.mov"), "--character", dir,
        "--from", "stand", "--to", "lean", "--key", "alpha", "--width", "80");
      writeFileSync(join(dir, "motions", "stand-to-lean", "run.json"), JSON.stringify(cut));
      projectCmd(dir, "register-run", "--motion", "stand-to-lean", "--run", join(dir, "motions", "stand-to-lean", "run.json"));
      expect(runJson("lineup", dir).motions[1].transitions).toEqual(["stand-to-lean"]);
      const fromLean = runJson("lineup", dir, "--hub", "lean", "--out", join(dir, "..", "other.png"));
      expect(fromLean.hub).toBe("lean");
      expect(fromLean.motions.map((m: any) => m.id)).toEqual(["lean", "stand"]);
      expect(fromLean.motions[1].transitions).toEqual(["stand-to-lean"]);
      expect(existsSync(join(dir, "..", "other.png"))).toBe(true);
      const bad = run("lineup", dir, "--hub", "stand-to-lean", "--json");
      expect(bad.code).toBe(1);
      expect(bad.err).toMatch(/--hub.*'stand-to-lean' is not a ready loop/);
    }, TIMEOUT_MS);
  });

  describe("rive: connected motions", () => {
    const TIMEOUT_MS = 90_000;
    const reportPath = (dir: string, report: unknown) => {
      const path = join(dir, "..", `report-${Math.random().toString(36).slice(2)}.json`);
      writeFileSync(path, JSON.stringify(report));
      return path;
    };
    /** hops with stand-to-lean cut at 0.5 s and registered, and lean-to-stand
     *  made from it with --reverse-of and registered. */
    const connected = (...cutFlags: string[]) => {
      const dir = useHops();
      const cut = cutTransition(dir, "--duration", "0.5", ...cutFlags);
      projectCmd(dir, "register-run", "--motion", "stand-to-lean", "--run", reportPath(dir, cut));
      const reverse = runJson("transition", "--reverse-of", "stand-to-lean", "--character", dir);
      projectCmd(dir, "add-motion", "--kind", "transition", "--from", "lean", "--to", "stand");
      projectCmd(dir, "register-run", "--motion", "lean-to-stand", "--run", reportPath(dir, reverse));
      return { dir, cut, reverse };
    };
    const quote = (dir: string) => rivePlanFor(loadRoster([
      { path: "hops/project.json", content: readFileSync(join(dir, "project.json"), "utf-8") },
    ])!.byContentSet.hops)!;

    test("the loops and the clips between them: routed through the clips, the reverse drawn from its source's images", () => {
      const { dir, cut } = connected();
      const json = runJson("rive", dir, "--include-loops");
      expect(json.motions.map((m: any) => [m.id, m.kind])).toEqual([
        ["stand", "loop"], ["lean", "loop"], ["stand-to-lean", "transition"], ["lean-to-stand", "transition"],
      ]);
      const [stand, lean, into, back] = json.motions;
      // The clip plays once, placed in clip coordinates like the loops.
      expect(into).toMatchObject({ loop: false, frames: 12, clip: { from: "recorded", scale: cut.scale } });
      expect(into.anchor.from).toBe("clip");
      // The reverse embeds nothing: the source's images, backwards.
      expect(back).toMatchObject({ shares: "stand-to-lean", frames: 12, estimatedDecodeBytes: 0 });
      const riv = decodeRiv(readFileSync(json.out));
      const embedded = riv.objects.filter((o) => o.type === "ImageAsset").length;
      // Every frame of the three, less the ones that repeat one already in.
      expect(embedded).toBe(stand.frames + lean.frames + into.frames - json.dedupedFrames);
      expect(json.frameCount).toBe(embedded);
      expect(json.estimatedDecodeBytes).toBe(stand.estimatedDecodeBytes + lean.estimatedDecodeBytes + into.estimatedDecodeBytes);

      // The machine: stand is the hub, `motion` names the loop, and each way
      // between them goes through its clip — nothing cuts.
      const machine = json.stateMachine;
      expect(machine.hub).toBe("stand");
      expect(machine.inputs).toEqual([{
        name: "motion", type: "number", default: 0,
        values: [{ value: 0, motion: "stand" }, { value: 1, motion: "lean" }],
      }]);
      expect(machine.routes).toEqual([
        { from: "stand", to: "lean", steps: [{ transition: "stand-to-lean" }], seconds: 1.5 },
        { from: "lean", to: "stand", steps: [{ transition: "lean-to-stand" }], seconds: 1.5 },
      ]);
      expect(machine.cuts).toEqual([]);
      expect(machine.waits).toEqual([{ motion: "stand", seconds: 1 }, { motion: "lean", seconds: 1 }]);
      expect(json.notes.join(" ")).toMatch(/leaving a loop waits for the end of its cycle/i);

      // One authority for the memory: the Export tab quotes the same plan —
      // the frames at full size until an export has measured them trimmed…
      const planned = quote(dir);
      expect(planned.decodeBytes).toBe(json.untrimmedDecodeBytes);
      expect(planned.motions.map((m) => [m.id, m.frames, m.width, m.height, m.shares ?? null]))
        .toEqual(json.motions.map((m: any) => [m.id, m.frames, m.width, m.height, m.shares ?? null]));
      // …and, registered, what the script made: each motion's trimmed cost,
      // the reverse still free.
      projectCmd(dir, "register-export", "--report", reportPath(dir, json));
      const measured = quote(dir);
      expect(measured.decodeBytes).toBe(json.estimatedDecodeBytes);
      expect(measured.motions.map((m) => [m.id, m.trimmed, m.decodeBytes]))
        .toEqual(json.motions.map((m: any) => [m.id, true, m.estimatedDecodeBytes]));
      // The next export starts from that quote and comes out the same.
      const again = runJson("rive", dir, "--include-loops");
      expect(again.estimatedDecodeBytes).toBe(json.estimatedDecodeBytes);
      // The measurement is kept on each motion, with what it was measured at.
      const doc = JSON.parse(readFileSync(join(dir, "project.json"), "utf-8"));
      expect(doc.sprite.motions.find((m: any) => m.id === "stand").riveTrim).toMatchObject({ filter: "smooth", decodeBytes: json.motions[0].estimatedDecodeBytes });
    }, TIMEOUT_MS);

    test("two loops with nothing between them cut, and the cut is listed with its pose gap", () => {
      const dir = useHops();
      const json = runJson("rive", dir, "--include-loops");
      expect(json.motions.map((m: any) => m.id)).toEqual(["stand", "lean"]);
      // stand-to-lean has a clip but no frames: not ready, left out, said.
      expect(json.excluded).toContainEqual({ motion: "stand-to-lean", reason: expect.stringMatching(/not ready/) });
      expect(json.stateMachine.routes.map((r: any) => r.steps)).toEqual([
        [{ cut: { from: "stand", to: "lean" } }],
        [{ cut: { from: "lean", to: "stand" } }],
      ]);
      // lean stands 36 px from stand: the silhouettes barely meet.
      const cuts = json.stateMachine.cuts;
      expect(cuts.map((c: any) => [c.from, c.to])).toEqual([["stand", "lean"], ["lean", "stand"]]);
      for (const c of cuts) expect(c.poseGap.gap).toBeGreaterThan(0.9);
      expect(json.notes.join(" ")).toMatch(/2 direct cuts where no transition joins the poses, the largest poseGap (1|0\.9\d+) \(stand → lean\)/);
    }, TIMEOUT_MS);

    test("--hub names the loop routes pass through", () => {
      const { dir } = connected();
      const json = runJson("rive", dir, "--include-loops", "--hub", "lean");
      expect(json.stateMachine.hub).toBe("lean");
      expect(json.stateMachine.inputs[0].default).toBe(1);
      for (const [hub, message] of [["stand-to-lean", /--hub: 'stand-to-lean' is not a loop in this file/], ["sit", /--hub: 'sit' is not a loop in this file/]] as const) {
        const r = run("rive", dir, "--include-loops", "--hub", hub, "--json");
        expect(r.code).toBe(1);
        expect(r.err).toMatch(message);
      }
    }, TIMEOUT_MS);

    test("a transition goes in with both of the loops it joins, or not at all", () => {
      const { dir } = connected();
      const named = run("rive", dir, "--motions", "stand,stand-to-lean", "--json");
      expect(named.code).toBe(1);
      expect(named.err).toMatch(/stand-to-lean joins 'lean', which --motions leaves out/);
      const loopsOnly = runJson("rive", dir, "--motions", "stand,lean");
      expect(loopsOnly.excluded).toEqual([
        { motion: "stand-to-lean", reason: "not named in --motions" },
        { motion: "lean-to-stand", reason: "not named in --motions" },
      ]);
    }, TIMEOUT_MS);

    test("a reverse of an earlier cut keeps its own frames, and says so", () => {
      const { dir } = connected();
      // stand-to-lean cut again — the same 12 frames, drawn wider — after
      // lean-to-stand was made from the first cut.
      const again = cutTransition(dir, "--duration", "0.5", "--width", "96");
      projectCmd(dir, "register-run", "--motion", "stand-to-lean", "--run", reportPath(dir, again));
      const json = runJson("rive", dir, "--include-loops");
      const back = json.motions.find((m: any) => m.id === "lean-to-stand");
      expect(back.shares).toBeUndefined();
      expect(back.estimatedDecodeBytes).toBeGreaterThan(0);
      expect(json.warnings).toContainEqual(expect.stringMatching(
        /lean-to-stand plays an earlier cut of stand-to-lean backwards.*--reverse-of stand-to-lean/,
      ));
      // Unmeasured, the Export tab quotes the frames at full size; once the
      // export is registered, it quotes what the script made.
      expect(quote(dir).decodeBytes).toBe(json.untrimmedDecodeBytes);
      projectCmd(dir, "register-export", "--report", reportPath(dir, json));
      expect(quote(dir).decodeBytes).toBe(json.estimatedDecodeBytes);
    }, TIMEOUT_MS);

    test("registered, the .riv carries the machine a viewer drives, and a re-cut clip retires it", () => {
      const { dir } = connected();
      const json = runJson("rive", dir, "--include-loops");
      projectCmd(dir, "register-export", "--report", reportPath(dir, json));
      const doc = JSON.parse(readFileSync(join(dir, "project.json"), "utf-8"));
      const riv = doc.assets.find((a: any) => a.id === doc.sprite.exports.riv);
      expect(riv.metadata).toMatchObject({ motionCount: 2, transitionCount: 2 });
      // The inputs and what each value means ride on the file's edge, next
      // to the motions it holds — what the Rive preview builds its buttons from.
      const params = doc.provenance.find((e: any) => e.toAssetId === riv.id).operation.params;
      expect(params.stateMachine).toEqual({
        name: "State Machine 1",
        hub: "stand",
        number: { name: "motion", default: 0, values: [{ value: 0, motion: "stand" }, { value: 1, motion: "lean" }] },
        triggers: [],
      });
      // Cutting the clip again retires the file that holds it.
      const again = cutTransition(dir, "--duration", "0.5");
      projectCmd(dir, "register-run", "--motion", "stand-to-lean", "--run", reportPath(dir, again));
      const after = JSON.parse(readFileSync(join(dir, "project.json"), "utf-8"));
      expect(after.sprite.exports?.riv).toBeUndefined();
    }, TIMEOUT_MS);
  });

  describe("retime", () => {
    /**
     * A box sweeping steadily left to right over 24 frames: every frame sits
     * at its own x, so `clipBoxCentres` can say which source frame a written
     * frame is without comparing lossy bytes.
     */
    const sweep24 = () => {
      const id = "clip:retime-sweep";
      if (!built.has(id)) {
        built.set(id, buildExprClip(join(shared(), "retime-sweep.mp4"), {
          width: 96, height: 64, frames: 24, fps: 24,
          box: { w: 12, h: 12, color: "red" }, x: "4+3*t*24", y: "26",
        }));
      }
      return built.get(id)!;
    };
    /** What a matting endpoint hands back: alpha in the clip itself. */
    const mattedClip = () => {
      const id = "clip:retime-matted";
      if (!built.has(id)) {
        built.set(id, buildExprClip(join(shared(), "retime-matted.mov"), {
          width: 64, height: 64, background: "black@0", encode: "prores4444",
          x: "24+8*sin(2*PI*t)", y: "24",
        }));
      }
      return built.get(id)!;
    };

    test("replays the frames it was given, in the order it was given them", () => {
      const ws = fresh();
      const out = join(ws, "retimed.mp4");
      const json = runJson("retime", sweep24(), "--keep", "0-3,20-23,0-3", "--out", out);

      expect(json.kind).toBe("retime");
      expect(json.source).toBe(sweep24());
      expect(json.out).toBe(out);
      expect(json.sourceFrames).toBe(24);
      expect(json.frames).toBe(12);
      expect(json.fps).toBe(24);
      expect(json.duration).toBe(0.5);
      expect(json.keep).toEqual([[0, 3], [20, 23], [0, 3]]);
      // Which source frames sit at the wrap. After a retime the first and the
      // last frame are no longer the keyframe the clip was shot to return to,
      // and this is what the skill reads to say so.
      expect(json.firstIs).toBe(0);
      expect(json.lastIs).toBe(3);

      expect(existsSync(out)).toBe(true);
      expect(codecOf(out)).toBe("h264");

      // The written frames really are those frames, in that order: the box
      // sweeps, so its position names the source frame it came from.
      const centres = clipBoxCentres(out) as number[];
      expect(centres).toHaveLength(12);
      const head = centres.slice(0, 4);
      const middle = centres.slice(4, 8);
      const repeat = centres.slice(8, 12);
      // Ascending inside each kept range…
      for (const series of [head, middle, repeat]) {
        for (let i = 1; i < series.length; i++) expect(series[i]).toBeGreaterThan(series[i - 1]);
      }
      // …the second range is much further right than the first…
      expect(Math.min(...middle)).toBeGreaterThan(Math.max(...head) + 5);
      // …and the third is the first one over again, frame for frame.
      for (let i = 0; i < 4; i++) expect(repeat[i]).toBeCloseTo(head[i], 0);
    }, 20_000);

    test("--fps renames the rate the same frames play at", () => {
      const ws = fresh();
      const out = join(ws, "slow.mp4");
      const json = runJson("retime", sweep24(), "--keep", "0-11", "--out", out, "--fps", "12");
      expect(json.fps).toBe(12);
      expect(json.frames).toBe(12);
      expect(json.duration).toBe(1);
      expect(json.sourceFrames).toBe(24);
      // Same twelve pictures, half the rate.
      expect(clipBoxCentres(out)).toHaveLength(12);
    }, 20_000);

    test("refuses a matted clip and says where a retime belongs", () => {
      const ws = fresh();
      const r = run("retime", mattedClip(), "--keep", "0-5", "--out", join(ws, "no.mp4"), "--json");
      expect(r.code).toBe(1);
      // Same rule as `loop --fps`: a step that reads pixels runs on the PLATE,
      // before anything mattes it.
      expect(r.err).toContain("alpha");
      expect(r.err).toContain("matte");
      expect(existsSync(join(ws, "no.mp4"))).toBe(false);
    }, 20_000);

    test("refuses by name what it cannot do, and writes nothing when it does", () => {
      const ws = fresh();
      const out = join(ws, "nope.mp4");
      const cases: Array<{ args: string[]; names: string[] }> = [
        { args: [join(ws, "missing.mp4"), "--keep", "0-3", "--out", out], names: ["missing.mp4"] },
        { args: [sweep24(), "--out", out], names: ["--keep"] },
        { args: [sweep24(), "--keep", "0-3"], names: ["--out"] },
        { args: [sweep24(), "--keep", "0-3", "--out", join(ws, "out.webm")], names: ["--out", ".mp4"] },
        { args: [sweep24(), "--keep", "two to five", "--out", out], names: ["--keep"] },
        { args: [sweep24(), "--keep", "5-2", "--out", out], names: ["--keep", "5-2"] },
        // Past the end of the clip: naming a frame that does not exist is the
        // easiest way to silently ship a shorter loop than was asked for.
        { args: [sweep24(), "--keep", "20-30", "--out", out], names: ["30", "24"] },
        { args: [sweep24(), "--keep", "0-0", "--out", out], names: ["1"] },
        // The output is still a loop's input, so it is held to the same
        // 400-frame ceiling.
        { args: [sweep24(), "--keep", Array.from({ length: 20 }, () => "0-23").join(","), "--out", out], names: ["400"] },
      ];
      for (const { args, names } of cases) {
        const r = run("retime", ...args, "--json");
        expect({ args, code: r.code }).toEqual({ args, code: 1 });
        for (const name of names) {
          expect({ args, name, contains: r.err.includes(name) }).toEqual({ args, name, contains: true });
        }
      }
      expect(existsSync(out)).toBe(false);
    }, 20_000);

    test("--json is one object; the human form names the wrap it left behind", () => {
      const ws = fresh();
      const asJson = run("retime", sweep24(), "--keep", "0-5,10-15", "--out", join(ws, "j.mp4"), "--json");
      expect(asJson.code).toBe(0);
      expect(asJson.out.trim().split("\n")).toHaveLength(1);
      expect(() => JSON.parse(asJson.out)).not.toThrow();

      const human = run("retime", sweep24(), "--keep", "0-5,10-15", "--out", join(ws, "h.mp4"));
      expect(human.code).toBe(0);
      expect(human.out).toContain(
        "h.mp4: 12 frames at 24 fps (0.5s) replayed from 24 frames of retime-sweep.mp4",
      );
      // The sentence a retimed loop has to be re-measured on: which source
      // frames now sit at the wrap, said in words rather than as two numbers
      // a reader has to find in the line.
      expect(human.out).toContain(
        "kept 0-5, 10-15 — the wrap is now source frame 15 back to 0, so measure the seam again with 'loop'",
      );
    }, 20_000);

    test("leaves no working directory behind", () => {
      const ws = fresh();
      runJson("retime", sweep24(), "--keep", "0-3", "--out", join(ws, "clean.mp4"));
      expect(readdirSync(ws)).toEqual(["clean.mp4"]);
    }, 20_000);
  });

  // -------------------------------------------------------------------------
  // Exports: the formats a finished motion is handed over in, made on demand
  // -------------------------------------------------------------------------

  /**
   * One registered character, built once through the real scripts and copied
   * per test: two sprite motions whose frames differ in size and pivot
   * (`bounce` loops at 8 fps on 64x64; `hop` plays once at 10 fps on an odd
   * 63x61 cell, which H.264 cannot take as it is), the `flame` loop from
   * `fixtures/loop`, and `walk`, planned and never generated.
   */
  const character = () => stage("character-mini", (dir) => {
    for (const [id, fps, loopFlag, cell] of [
      ["bounce", "8", "--loop", "64x64"],
      ["hop", "10", "--no-loop", "63x61"],
    ] as const) {
      const summary = runJson("run", SHEETS.plain(), "--rows", "2", "--cols", "2",
        "--out", join(dir, "motions", id), "--name", id, "--fps", fps, loopFlag,
        "--cell", cell, "--no-webp");
      writeFileSync(join(dir, "motions", id, "run.json"), JSON.stringify(summary));
    }
    projectCmd(dir, "init", "--name", "Mini", "--cell", "64x64");
    projectCmd(dir, "add-motion", "--id", "bounce", "--label", "Bounce", "--rows", "2", "--cols", "2", "--fps", "8", "--loop");
    projectCmd(dir, "register-run", "--motion", "bounce", "--run", join(dir, "motions", "bounce", "run.json"));
    projectCmd(dir, "add-motion", "--id", "hop", "--label", "Hop", "--rows", "2", "--cols", "2", "--fps", "10", "--no-loop");
    projectCmd(dir, "register-run", "--motion", "hop", "--run", join(dir, "motions", "hop", "run.json"));

    cpSync(LOOP_FIXTURE, join(dir, "motions", "flame"), { recursive: true });
    projectCmd(dir, "add-motion", "--id", "flame", "--label", "Flame", "--kind", "loop", "--fps", "12");
    projectCmd(dir, "set-motion", "--motion", "flame", "--brief-duration", "1", "--brief-width", "64",
      "--brief-interpolator", "none");
    projectCmd(dir, "add-video", "--motion", "flame", "--file", "motions/flame/video-seedance-1.mp4",
      "--model", "seedance-2.5", "--mode", "first-last", "--status", "ready");
    projectCmd(dir, "register-run", "--motion", "flame", "--run", join(LOOP_FIXTURE, "run.json"));

    projectCmd(dir, "add-motion", "--id", "walk", "--label", "Walk", "--rows", "2", "--cols", "2", "--fps", "10",
      "--loop", "--status", "planned");
  });

  /** A private copy of the character, as `<ws>/mini`. */
  const useCharacter = () => {
    const dir = join(fresh(), "mini");
    cpSync(character(), dir, { recursive: true });
    return dir;
  };

  /** codec, pix_fmt, alpha_mode, decoded frame count and duration, as ffprobe
   *  reads them — the independent answer to "is this really what it says". */
  function probeVideo(path: string) {
    const r = spawnSync("ffprobe", [
      "-v", "error", "-count_frames", "-select_streams", "v:0",
      "-show_entries", "stream=codec_name,pix_fmt,width,height,nb_read_frames:stream_tags=alpha_mode:format=duration",
      "-of", "json", path,
    ], { encoding: "utf-8" });
    if (r.status !== 0) throw new Error(`ffprobe failed on ${path}: ${r.stderr}`);
    const doc = JSON.parse(r.stdout);
    const stream = doc.streams[0];
    return {
      codec: stream.codec_name as string,
      pixFmt: stream.pix_fmt as string,
      width: stream.width as number,
      height: stream.height as number,
      frames: Number(stream.nb_read_frames),
      alphaMode: stream.tags?.alpha_mode ?? null,
      duration: Number(doc.format.duration),
    };
  }

  /** RGB of one pixel of a video's first frame. */
  function firstFramePixel(path: string, x: number, y: number) {
    const { width } = probeVideo(path);
    const r = spawnSync("ffmpeg", ["-v", "error", "-i", path, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
    const at = (y * width + x) * 3;
    return [r.stdout[at], r.stdout[at + 1], r.stdout[at + 2]];
  }

  describe("export", () => {
    /** One export per distinct request, shared by the cases that only read it. */
    const exports = new Map<string, { dir: string; json: any }>();
    const exported = (key: string, motion: string, ...flags: string[]) => {
      if (!exports.has(key)) {
        const dir = useCharacter();
        exports.set(key, { dir, json: runJson("export", join(dir, "motions", motion), ...flags) });
      }
      return exports.get(key)!;
    };
    const EXPORT_TIMEOUT_MS = 30_000;

    test("mp4 flattens a looping motion onto white and repeats it to three seconds", () => {
      const { dir, json } = exported("bounce-mp4", "bounce", "--format", "mp4");
      expect(json.kind).toBe("export");
      expect(json.motion).toBe("bounce");
      expect(json.format).toBe("mp4");
      expect(json.out).toBe(join(dir, "motions", "bounce", "exports", "bounce.mp4"));
      // Four frames at 8 fps is half a second; the default repeat is the
      // smallest count that reaches 3 s, and the report says it chose it.
      expect(json).toMatchObject({ frameCount: 4, fps: 8, loop: true, repeat: 6, repeatDefaulted: true, background: "#ffffff" });
      const probe = probeVideo(json.out);
      expect(probe).toMatchObject({ codec: "h264", pixFmt: "yuv420p", width: 64, height: 64, frames: 24 });
      expect(probe.duration).toBeCloseTo(3, 1);
      // The report's own probe is the same reading, and its size is the file's.
      expect(json.probe).toMatchObject({ codec: "h264", pixFmt: "yuv420p", frames: 24, alpha: false });
      expect(json.size).toBe(statSync(json.out).size);
      // The transparent corner came out as the background colour.
      for (const channel of firstFramePixel(json.out, 1, 1)) expect(channel).toBeGreaterThan(245);
    }, EXPORT_TIMEOUT_MS);

    test("mp4 plays a one-shot once, pads an odd frame to even, and takes a background", () => {
      const { json } = exported("hop-mp4", "hop", "--format", "mp4", "--bg", "#000000");
      expect(json).toMatchObject({ frameCount: 4, fps: 10, loop: false, repeat: 1, repeatDefaulted: true, background: "#000000" });
      const probe = probeVideo(json.out);
      // 63x61 cannot be H.264 4:2:0; one transparent column and row make it so,
      // on the right and the bottom, where they move no pivot.
      expect({ width: probe.width, height: probe.height, frames: probe.frames }).toEqual({ width: 64, height: 62, frames: 4 });
      expect(json.padded).toEqual({ width: 1, height: 1 });
      for (const channel of firstFramePixel(json.out, 1, 1)) expect(channel).toBeLessThan(10);
    }, EXPORT_TIMEOUT_MS);

    test("--repeat and --scale are obeyed, nearest-neighbour", () => {
      const { json } = exported("bounce-mp4-x2", "bounce", "--format", "mp4", "--repeat", "2", "--scale", "2");
      expect(json).toMatchObject({ repeat: 2, repeatDefaulted: false, scale: 2 });
      const probe = probeVideo(json.out);
      expect({ width: probe.width, height: probe.height, frames: probe.frames }).toEqual({ width: 128, height: 128, frames: 8 });
      expect(probe.duration).toBeCloseTo(1, 1);
    }, EXPORT_TIMEOUT_MS);

    test("mov is ProRes 4444 with its alpha, and a --bg it cannot use is reported, not applied", () => {
      const { json } = exported("bounce-mov", "bounce", "--format", "mov", "--bg", "#ff0000");
      const probe = probeVideo(json.out);
      expect(json.out.endsWith(join("exports", "bounce.mov"))).toBe(true);
      expect(probe.codec).toBe("prores");
      expect(probe.pixFmt).toMatch(/^yuva444/);
      expect(probe.frames).toBe(24);
      expect(json.probe.alpha).toBe(true);
      expect(json.background).toBeNull();
      expect(json.warnings.join(" ")).toMatch(/--bg.*ignored.*keeps its transparency/);
    }, EXPORT_TIMEOUT_MS);

    test("webm is VP9 with an alpha channel, for a sprite motion", () => {
      const { json } = exported("hop-webm", "hop", "--format", "webm");
      const probe = probeVideo(json.out);
      expect(probe.codec).toBe("vp9");
      expect(probe.alphaMode).toBe("1");
      expect(probe.frames).toBe(4);
      expect({ width: probe.width, height: probe.height }).toEqual({ width: 64, height: 62 });
    }, EXPORT_TIMEOUT_MS);

    test("a loop's video repeats to three seconds at its own rate", () => {
      const { json } = exported("flame-mp4", "flame", "--format", "mp4");
      // 12 frames at 12 fps is one second: three plays.
      expect(json).toMatchObject({ motionKind: "loop", frameCount: 12, fps: 12, repeat: 3 });
      expect(json.out.endsWith(join("flame", "exports", "flame.mp4"))).toBe(true);
      expect(probeVideo(json.out)).toMatchObject({ codec: "h264", frames: 36, width: 64, height: 72 });
    }, EXPORT_TIMEOUT_MS);

    test("apng keeps every frame once, forever when the motion loops", () => {
      const { json } = exported("bounce-apng", "bounce", "--format", "apng");
      expect(json.out.endsWith(join("exports", "bounce.apng"))).toBe(true);
      expect(codecOf(json.out)).toBe("apng");
      expect(countFrames(json.out)).toBe(4);
      expect(json.repeat).toBeNull();
    }, EXPORT_TIMEOUT_MS);

    test("lottie is the loop writer's image sequence, over the motion's own frames", () => {
      const { dir, json } = exported("hop-lottie", "hop", "--format", "lottie");
      const doc = JSON.parse(readFileSync(json.out, "utf-8"));
      expect(json.out.endsWith(join("exports", "hop.json"))).toBe(true);
      expect({ v: doc.v, fr: doc.fr, ip: doc.ip, op: doc.op, w: doc.w, h: doc.h })
        .toEqual({ v: "5.7.4", fr: 10, ip: 0, op: 4, w: 63, h: 61 });
      expect(doc.assets).toHaveLength(4);
      expect(doc.layers).toHaveLength(4);
      expect(Buffer.from(doc.assets[2].p.split(",")[1], "base64"))
        .toEqual(readFileSync(join(dir, "motions", "hop", "frames", "02.png")));
      expect(doc.layers[3]).toMatchObject({ ty: 2, refId: "img_3", ip: 3, op: 4 });
    }, EXPORT_TIMEOUT_MS);

    test("png-seq is a stored zip of the frames plus animation.json", () => {
      const { dir, json } = exported("bounce-png-seq", "bounce", "--format", "png-seq");
      expect(json.out).toBe(join(dir, "motions", "bounce", "exports", "bounce-frames.zip"));
      const entries = readZip(readFileSync(json.out));
      expect(entries.map((e) => e.name)).toEqual([
        "bounce/animation.json", "bounce/00.png", "bounce/01.png", "bounce/02.png", "bounce/03.png",
      ]);
      // PNG is already compressed: every entry is stored, and each frame is
      // the registered file byte for byte.
      for (const entry of entries) expect(entry.method).toBe(0);
      expect(entries[2].data).toEqual(readFileSync(join(dir, "motions", "bounce", "frames", "01.png")));

      const animation = JSON.parse(entries[0].data.toString("utf8"));
      const atlas = JSON.parse(readFileSync(join(dir, "motions", "bounce", "atlas.json"), "utf-8"));
      expect(animation).toMatchObject({
        name: "bounce", kind: "sprite", fps: 8, loop: true,
        size: { w: 64, h: 64 },
        // The atlas pivot is the authority, in both of its spellings.
        pivot: atlas.frames.bounce_00.pivot,
        anchorPoint: atlas.meta.anchorPoint,
      });
      expect(animation.frames).toEqual([0, 1, 2, 3].map((i) => ({ file: `0${i}.png`, duration: 125 })));
    }, EXPORT_TIMEOUT_MS);

    test("png-seq of a loop has three-digit frames and no pivot", () => {
      const { json } = exported("flame-png-seq", "flame", "--format", "png-seq");
      const entries = readZip(readFileSync(json.out));
      expect(entries).toHaveLength(13);
      expect(entries[1].name).toBe("flame/000.png");
      const animation = JSON.parse(entries[0].data.toString("utf8"));
      expect(animation).toMatchObject({ name: "flame", kind: "loop", fps: 12, loop: true, pivot: null, anchorPoint: null });
      expect(animation.frames[11]).toEqual({ file: "011.png", duration: 83 });
    }, EXPORT_TIMEOUT_MS);

    test("the formats a loop already ships are refused and named, never duplicated", () => {
      const dir = useCharacter();
      for (const [format, existing] of [["webm", "loop.webm"], ["apng", "loop.apng"], ["lottie", "loop.json"]]) {
        const r = run("export", join(dir, "motions", "flame"), "--format", format, "--json");
        expect({ format, code: r.code }).toEqual({ format, code: 1 });
        expect(r.err).toContain(existing);
      }
      expect(existsSync(join(dir, "motions", "flame", "exports"))).toBe(false);
    });

    test("a format a sprite motion already has points at it", () => {
      const dir = useCharacter();
      const gif = run("export", join(dir, "motions", "bounce"), "--format", "gif", "--json");
      expect(gif.code).toBe(1);
      expect(gif.err).toContain("preview.gif");
    });

    test("refuses by name what it cannot do, and writes nothing when it does", () => {
      const dir = useCharacter();
      const cases: Array<[string[], RegExp]> = [
        [["export", join(dir, "motions", "walk"), "--format", "mp4"], /walk.*not ready.*planned/],
        [["export", join(dir, "motions", "bounce"), "--format", "avi"], /--format.*mp4, mov, webm, apng, lottie, png-seq/],
        [["export", join(dir, "motions", "bounce")], /--format is required/],
        [["export", join(dir, "motions", "bounce"), "--format", "mp4", "--scale", "1.5"], /--scale/],
        [["export", join(dir, "motions", "bounce"), "--format", "mp4", "--repeat", "0"], /--repeat/],
        [["export", join(dir, "motions", "bounce"), "--format", "mp4", "--bg", "white"], /--bg.*#rrggbb/],
        [["export", join(dir, "motions", "nope"), "--format", "mp4"], /no motion 'nope'/],
        [["export", join(fresh(), "motions", "bounce"), "--format", "mp4"], /project\.json/],
      ];
      for (const [argv, message] of cases) {
        const r = run(...argv, "--json");
        expect({ argv: argv.slice(2).join(" "), code: r.code }).toEqual({ argv: argv.slice(2).join(" "), code: 1 });
        expect(r.err).toMatch(/^ERROR: /);
        expect(r.err).toMatch(message);
        expect(r.out).toBe("");
      }
      for (const id of ["walk", "bounce"]) {
        expect({ id, exports: existsSync(join(dir, "motions", id, "exports")) }).toEqual({ id, exports: false });
      }
    });

    test("--repeat and --bg on a frame animation are reported as ignored", () => {
      const { json } = exported("bounce-apng-flags", "bounce", "--format", "apng", "--repeat", "3", "--bg", "#000000");
      expect(json.warnings.join(" ")).toMatch(/--repeat.*ignored/);
      expect(json.warnings.join(" ")).toMatch(/--bg.*ignored/);
    }, EXPORT_TIMEOUT_MS);

    test("re-exporting replaces the file and leaves no scratch behind", () => {
      const dir = useCharacter();
      const motionDir = join(dir, "motions", "hop");
      runJson("export", motionDir, "--format", "apng");
      const again = runJson("export", motionDir, "--format", "apng");
      expect(readdirSync(join(motionDir, "exports"))).toEqual(["hop.apng"]);
      expect(again.size).toBe(statSync(again.out).size);
    }, EXPORT_TIMEOUT_MS);

    test("the human form names the file, the repeat and the size", () => {
      const dir = useCharacter();
      const r = run("export", join(dir, "motions", "hop"), "--format", "webm");
      expect(r.code).toBe(0);
      expect(r.out).toMatch(/hop\.webm/);
      expect(r.out).toMatch(/plays once/);
    }, EXPORT_TIMEOUT_MS);
  });

  describe("rive", () => {
    const EXPORT_TIMEOUT_MS = 30_000;
    const rivRuns = new Map<string, { dir: string; json: any }>();
    const rived = (key: string, ...flags: string[]) => {
      if (!rivRuns.has(key)) {
        const dir = useCharacter();
        rivRuns.set(key, { dir, json: runJson("rive", dir, ...flags) });
      }
      return rivRuns.get(key)!;
    };
    const ofType = (objects: RiveObject[], type: string) => objects.filter((o) => o.type === type);
    /** What the file draws at each timeline key of `motion`: the Image the
     *  Solo shows, its pixels, and where its top-left corner lands on the
     *  artboard — in float32, the way `Image::draw` places it (position −
     *  size × origin; origin 0.5 when unwritten, the runtime's default). */
    const shownFrames = (json: any, motion: string) => {
      const { objects } = decodeRiv(readFileSync(json.out));
      const images = ofType(objects, "Image");
      const assets = ofType(objects, "ImageAsset");
      const contents = ofType(objects, "FileAssetContents");
      const start = objects.findIndex((o) => o.type === "LinearAnimation" && o.props.name === motion);
      expect(start).toBeGreaterThanOrEqual(0);
      const keys: number[] = [];
      for (let i = start + 1; i < objects.length && !["LinearAnimation", "StateMachine"].includes(objects[i].type); i++) {
        if (objects[i].type === "KeyFrameId") keys.push(objects[i].props.value as number);
      }
      const f = Math.fround;
      return keys.map((component) => {
        const p = images[component - 2].props as Record<string, any>;
        const size = assets[p.assetId].props as { width: number; height: number };
        return {
          name: String(p.name),
          rgba: readRgba(contents[p.assetId].props.bytes as Buffer),
          left: f(f(p.x) - f(size.width * f(p.originX ?? 0.5))),
          top: f(f(p.y) - f(size.height * f(p.originY ?? 0.5))),
        };
      });
    };
    /** Where the untrimmed file drew a full frame's top-left: the anchor less
     *  size × (pivot / size), in float32. */
    const fullEdge = (anchor: number, pivot: number, size: number) => {
      const f = Math.fround;
      return f(f(anchor) - f(size * f(pivot / size)));
    };
    /** `shown` draws exactly what the full frame drew, where it drew it: its
     *  corner sits a whole number of pixels into the full frame, its pixels
     *  are the full frame's there, and nothing visible of the full frame is
     *  left outside it. `slack`: how far off whole the offset may be — the
     *  float32 placement is exact, but a report rounds the pivot it states. */
    const expectDrawnAsFull = (
      shown: { rgba: { width: number; height: number; data: Buffer }; left: number; top: number },
      full: { width: number; height: number; data: Buffer },
      left: number,
      top: number,
      slack = 1e-4,
    ) => {
      // Nothing to draw on either side: where it is placed is moot.
      const visible = (data: Buffer) => data.some((v, i) => i % 4 === 3 && v > 0);
      if (!visible(full.data) && !visible(shown.rgba.data)) return;
      const dx = shown.left - left;
      const dy = shown.top - top;
      expect(Math.abs(dx - Math.round(dx))).toBeLessThan(slack);
      expect(Math.abs(dy - Math.round(dy))).toBeLessThan(slack);
      const ox = Math.round(dx);
      const oy = Math.round(dy);
      const { width: w, height: h, data } = shown.rgba;
      expect(ox >= 0 && oy >= 0 && ox + w <= full.width && oy + h <= full.height).toBe(true);
      let differing = 0;
      let lost = 0;
      for (let y = 0; y < full.height; y++) {
        for (let x = 0; x < full.width; x++) {
          const s = (y * full.width + x) * 4;
          if (x < ox || x >= ox + w || y < oy || y >= oy + h) {
            if (full.data[s + 3] !== 0) lost++;
            continue;
          }
          const t = ((y - oy) * w + (x - ox)) * 4;
          if (full.data[s + 3] !== data[t + 3]) differing++;
          else if (data[t + 3] > 0 && (full.data[s] !== data[t] || full.data[s + 1] !== data[t + 1] || full.data[s + 2] !== data[t + 2])) differing++;
        }
      }
      expect({ differing, lost }).toEqual({ differing: 0, lost: 0 });
    };
    /** A sprite motion at its atlas size, frame by frame: drawn as the
     *  registered frames were, each by its atlas pivot. */
    const expectSpriteDrawnAsRegistered = (dir: string, json: any, motion: string) => {
      const atlas = JSON.parse(readFileSync(join(dir, "motions", motion, "atlas.json"), "utf-8"));
      const names = Object.keys(atlas.frames);
      const shown = shownFrames(json, motion);
      expect(shown).toHaveLength(names.length);
      for (const [i, frame] of shown.entries()) {
        const full = readRgba(readFileSync(join(dir, "motions", motion, "frames", `${String(i).padStart(2, "0")}.png`)));
        const { pivot } = atlas.frames[names[i]];
        expectDrawnAsFull(
          frame, full,
          fullEdge(json.artboard.anchor.x, pivot.x * full.width, full.width),
          fullEdge(json.artboard.anchor.y, pivot.y * full.height, full.height),
        );
      }
    };
    /** Every embedded frame of `test` against `ref`'s: alpha the same
     *  everywhere, colour the same wherever a pixel is visible. */
    const expectSamePixels = (ref: any, test: any) => {
      const frames = (json: any) =>
        ofType(decodeRiv(readFileSync(json.out)).objects, "FileAssetContents").map((o) => readRgba(o.props.bytes as Buffer));
      const [a, b] = [frames(ref), frames(test)];
      expect(b.length).toBe(a.length);
      let differing = 0;
      for (const [i, { data }] of a.entries()) {
        const other = b[i].data;
        expect(other.length).toBe(data.length);
        for (let p = 0; p < data.length; p += 4) {
          if (data[p + 3] !== other[p + 3]) differing++;
          else if (data[p + 3] > 0 && (data[p] !== other[p] || data[p + 1] !== other[p + 1] || data[p + 2] !== other[p + 2])) differing++;
        }
      }
      expect(differing).toBe(0);
    };

    test("one .riv for the character, holding every ready sprite motion", () => {
      const { dir, json } = rived("png", "--images", "png");
      expect(json.kind).toBe("rive");
      expect(json.out).toBe(join(dir, "exports", "mini.riv"));
      expect(json.size).toBe(statSync(json.out).size);
      expect(json.motions.map((m: any) => m.id)).toEqual(["bounce", "hop"]);
      expect(json.frameCount).toBe(8);

      const riv = decodeRiv(readFileSync(json.out));
      expect(ofType(riv.objects, "Artboard")[0].props.name).toBe("Mini");
      expect(ofType(riv.objects, "Solo")).toHaveLength(1);
      expect(ofType(riv.objects, "Image")).toHaveLength(8);
      expect(ofType(riv.objects, "ImageAsset")).toHaveLength(8);
      // Each frame is embedded trimmed to its visible pixels and drawn
      // exactly where, and exactly as, the registered frame was.
      expectSpriteDrawnAsRegistered(dir, json, "hop");
      expect(ofType(riv.objects, "LinearAnimation").map((a) => a.props)).toEqual([
        { name: "bounce", fps: 8, duration: 4, loopValue: 1 },
        { name: "hop", fps: 10, duration: 4, loopValue: 0 },
      ]);
      // bounce loops, so `motion` names it; hop plays once, so it keeps a trigger.
      expect(ofType(riv.objects, "StateMachineNumber").map((n) => n.props)).toEqual([{ name: "motion", value: 0 }]);
      expect(ofType(riv.objects, "StateMachineTrigger").map((t) => t.props.name)).toEqual(["play_hop"]);
      expect(ofType(riv.objects, "AnimationState")).toHaveLength(2);
    }, EXPORT_TIMEOUT_MS);

    test("the report names the state machine a developer wires, and says the frames are raster", () => {
      const { json } = rived("png", "--images", "png");
      expect(json.stateMachine).toMatchObject({
        name: "State Machine 1",
        hub: "bounce",
        defaultMotion: "bounce",
        inputs: [
          { name: "motion", type: "number", default: 0, values: [{ value: 0, motion: "bounce" }] },
          { name: "play_hop", type: "trigger", motion: "hop" },
        ],
        // One loop, so no route between loops and nothing to wait for but its own cycle.
        routes: [],
        waits: [{ motion: "bounce", seconds: 0.5 }],
      });
      // A one-shot cuts in from wherever the character is and cuts back out
      // to the loop `motion` names: both are listed, the way out measured.
      expect(json.stateMachine.cuts.map((c: any) => [c.from, c.to])).toEqual([[null, "hop"], ["hop", "bounce"]]);
      expect(json.stateMachine.cuts[0].poseGap).toBeNull();
      expect(json.stateMachine.cuts[1].poseGap.gap).toBeGreaterThanOrEqual(0);
      expect(json.images).toBe("png");
      const notes = json.notes.join(" ");
      expect(notes).toMatch(/raster/);
      expect(notes).toMatch(/cannot be reopened in the Rive editor/);
    }, EXPORT_TIMEOUT_MS);

    test("by default loops and unfinished motions are left out, each with its reason", () => {
      const { json } = rived("png", "--images", "png");
      expect(json.excluded).toEqual([
        expect.objectContaining({ motion: "flame", reason: expect.stringMatching(/loop.*--include-loops.*--motions/) }),
        expect.objectContaining({ motion: "walk", reason: expect.stringMatching(/not ready.*planned/) }),
      ]);
    }, EXPORT_TIMEOUT_MS);

    test("every frame's atlas pivot lands on one point of the artboard", () => {
      const { dir, json } = rived("png", "--images", "png");
      const riv = decodeRiv(readFileSync(json.out));
      const [artboard] = ofType(riv.objects, "Artboard");
      expect({ width: artboard.props.width, height: artboard.props.height })
        .toEqual({ width: json.artboard.width, height: json.artboard.height });
      for (const motion of ["bounce", "hop"]) {
        // The full frame's pivot on the anchor, and each trimmed frame on the
        // spot its pixels had in it.
        expectSpriteDrawnAsRegistered(dir, json, motion);
        // …and every frame fits: nothing of it hangs off the artboard.
        for (const frame of shownFrames(json, motion)) {
          expect(frame.left).toBeGreaterThanOrEqual(-0.5);
          expect(frame.top).toBeGreaterThanOrEqual(-0.5);
          expect(frame.left + frame.rgba.width).toBeLessThanOrEqual(json.artboard.width + 0.5);
          expect(frame.top + frame.rgba.height).toBeLessThanOrEqual(json.artboard.height + 0.5);
        }
      }
    }, EXPORT_TIMEOUT_MS);

    test("a repeated frame is embedded once, and a frame with nothing visible is one transparent pixel", () => {
      const dir = useCharacter();
      const bounce = join(dir, "motions", "bounce");
      // bounce's frame 2 becomes frame 0 again, pivot and all.
      cpSync(join(bounce, "frames", "00.png"), join(bounce, "frames", "02.png"));
      const atlasPath = join(bounce, "atlas.json");
      const atlas = JSON.parse(readFileSync(atlasPath, "utf-8"));
      atlas.frames.bounce_02.pivot = atlas.frames.bounce_00.pivot;
      writeFileSync(atlasPath, JSON.stringify(atlas));
      // hop's frames 1 and 2: nothing visible at all.
      const hop = join(dir, "motions", "hop", "frames");
      const { width, height } = readRgba(readFileSync(join(hop, "01.png")));
      for (const name of ["01.png", "02.png"]) {
        const made = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=0x00000000:s=${width}x${height},format=rgba`,
          "-frames:v", "1", join(hop, name)]);
        expect(made.status).toBe(0);
      }
      const json = runJson("rive", dir, "--images", "png");
      expect({ deduped: json.dedupedFrames, empty: json.emptyFrames, embedded: json.frameCount }).toEqual({ deduped: 2, empty: 2, embedded: 6 });
      expect(json.motions.map((m: any) => [m.id, m.deduped, m.emptyFrames])).toEqual([["bounce", 1, 0], ["hop", 1, 2]]);
      const shownBounce = shownFrames(json, "bounce");
      expect(shownBounce[2].name).toBe(shownBounce[0].name);
      const shownHop = shownFrames(json, "hop");
      expect([shownHop[1].rgba.width, shownHop[1].rgba.height, shownHop[1].rgba.data[3]]).toEqual([1, 1, 0]);
      expect(shownHop[2].name).toBe(shownHop[1].name);
      // …and every frame still draws exactly what it did.
      expectSpriteDrawnAsRegistered(dir, json, "bounce");
      expectSpriteDrawnAsRegistered(dir, json, "hop");
      // The memory counts each image once: what the file embeds.
      const embedded = ofType(decodeRiv(readFileSync(json.out)).objects, "ImageAsset")
        .reduce((sum, a) => sum + (a.props.width as number) * (a.props.height as number) * 4, 0);
      expect(json.estimatedDecodeBytes).toBe(embedded);
      expect(json.notes.join(" ")).toMatch(/2 frames are the same picture in the same place/);
    }, EXPORT_TIMEOUT_MS);

    test("the memory it will cost is estimated from the frames", () => {
      const { json } = rived("png", "--images", "png");
      // The frames at full size are the most they can cost…
      expect(json.untrimmedDecodeBytes).toBe(4 * 64 * 64 * 4 + 4 * 63 * 61 * 4);
      // …and what the runtime decodes is what is embedded: each image once, trimmed.
      const riv = decodeRiv(readFileSync(json.out));
      const embedded = ofType(riv.objects, "ImageAsset")
        .reduce((sum, a) => sum + (a.props.width as number) * (a.props.height as number) * 4, 0);
      expect(json.estimatedDecodeBytes).toBe(embedded);
      expect(json.estimatedDecodeBytes).toBeLessThan(json.untrimmedDecodeBytes);
      expect(json.motions.map((m: any) => m.trim.decodeBytes)).toEqual(json.motions.map((m: any) => m.estimatedDecodeBytes));
      expect(json.notes.join(" ")).toMatch(/trimmed to its visible pixels.*nothing on screen changes/);
      expect(json.warnings).toEqual([]);
    }, EXPORT_TIMEOUT_MS);

    test("--images webp embeds WebP, lossy, and says --images png is the lossless one", () => {
      const { json } = rived("webp", "--images", "webp");
      expect(json.images).toBe("webp");
      const riv = decodeRiv(readFileSync(json.out));
      expect(ofType(riv.objects, "ImageAsset")[0].props.name).toBe("bounce_00.webp");
      const bytes = ofType(riv.objects, "FileAssetContents")[0].props.bytes as Buffer;
      expect(bytes.subarray(0, 4).toString("latin1")).toBe("RIFF");
      expect(bytes.subarray(8, 12).toString("latin1")).toBe("WEBP");
      const notes = json.notes.join(" ");
      expect(notes).toMatch(/WebP.*lossy.*quality 85/);
      expect(notes).toMatch(/--images png.*lossless/);
      // Nothing left over from when WebP was an unknown outside the web.
      expect(notes).not.toMatch(/not confirmed/);
    }, EXPORT_TIMEOUT_MS);

    test.if(HAS_LIBWEBP_STILL)("--images webp-lossless keeps every pixel, whatever the style", () => {
      const { json } = rived("lossless", "--images", "webp-lossless");
      expect(json.images).toBe("webp-lossless");
      expect(ofType(decodeRiv(readFileSync(json.out)).objects, "ImageAsset")[0].props.name).toBe("bounce_00.webp");
      expectSamePixels(rived("png", "--images", "png").json, json);
    }, EXPORT_TIMEOUT_MS);

    test.if(HAS_LIBWEBP_STILL)("with no --images the frames are WebP", () => {
      const { json } = rived("default");
      expect(json.images).toBe("webp");
      const riv = decodeRiv(readFileSync(json.out));
      expect(ofType(riv.objects, "ImageAsset").every((a) => String(a.props.name).endsWith(".webp"))).toBe(true);
      expect(json.warnings).toEqual([]);
    }, EXPORT_TIMEOUT_MS);

    test("an ffmpeg without libwebp: the default falls back to PNG and says so; --images webp refuses", () => {
      const dir = useCharacter();
      const { PATH, dir: shimDir } = pathWithoutLibwebp();
      try {
        const fallback = runWithEnv({ PATH }, "rive", dir, "--json");
        expect(fallback.code).toBe(0);
        const json = JSON.parse(fallback.out);
        expect(json.images).toBe("png");
        const riv = decodeRiv(readFileSync(json.out));
        expect(ofType(riv.objects, "ImageAsset")[0].props.name).toBe("bounce_00.png");
        expect(json.warnings.join(" ")).toMatch(/libwebp.*PNG/);

        const refused = runWithEnv({ PATH }, "rive", dir, "--images", "webp", "--json");
        expect(refused.code).toBe(1);
        expect(refused.err).toMatch(/^ERROR: rive: --images webp needs ffmpeg's libwebp encoder.*--images png/);
        const lossless = runWithEnv({ PATH }, "rive", dir, "--images", "webp-lossless", "--json");
        expect(lossless.code).toBe(1);
        expect(lossless.err).toMatch(/^ERROR: rive: --images webp-lossless needs ffmpeg's libwebp encoder/);
      } finally {
        rmSync(shimDir, { recursive: true, force: true });
      }
    }, EXPORT_TIMEOUT_MS);

    test("a character with only loops is told how to include them", () => {
      const dir = useCharacter();
      for (const id of ["bounce", "hop", "walk"]) projectCmd(dir, "remove-motion", "--motion", id);
      const r = run("rive", dir, "--json");
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/^ERROR: /);
      expect(r.err).toMatch(/only loop.*flame/);
      expect(r.err).toMatch(/--include-loops/);
      expect(r.err).toMatch(/--motions flame/);
      expect(r.err).toMatch(/24 fps/);
      expect(existsSync(join(dir, "exports"))).toBe(false);
      // …and asked, it makes one.
      const json = runJson("rive", dir, "--include-loops");
      expect(json.motions.map((m: any) => m.id)).toEqual(["flame"]);
      expect(json.stateMachine.defaultMotion).toBe("flame");
    }, EXPORT_TIMEOUT_MS);

    test("--include-loops adds every ready loop, in rail order, at no more than its own rate", () => {
      const { json } = rived("loops", "--include-loops");
      expect(json.motions.map((m: any) => m.id)).toEqual(["bounce", "hop", "flame"]);
      expect(json.excluded.map((e: any) => e.motion)).toEqual(["walk"]);
      const flame = json.motions.find((m: any) => m.id === "flame");
      // The fixture loop is 12 fps: the 24 fps default would only repeat its
      // frames, so it keeps its own; 64x72 is under the 320 px default.
      expect(flame).toMatchObject({
        kind: "loop",
        source: { frames: 12, fps: 12, width: 64, height: 72 },
        frames: 12,
        fps: 12,
        width: 64,
        height: 72,
        scale: 1,
        untrimmedDecodeBytes: 12 * 64 * 72 * 4,
      });
      expect(json.resample).toEqual({
        loop: { fps: 24, maxSize: 320 },
        sprite: { fps: null, maxSize: null },
        filter: "smooth",
        filterFrom: "style",
      });
      // What the file embeds: every frame, less the ones that repeat one already in.
      expect(json.frameCount).toBe(8 + 12 - json.dedupedFrames);
      expect(json.estimatedDecodeBytes).toBe(json.motions.reduce((sum: number, m: any) => sum + m.estimatedDecodeBytes, 0));
    }, EXPORT_TIMEOUT_MS);

    test("--motions picks the motions and their order; --fps resamples a loop evenly and it still closes", () => {
      const { dir, json } = rived("named", "--motions", "flame,hop", "--fps", "6", "--images", "png");
      expect(json.motions.map((m: any) => m.id)).toEqual(["flame", "hop"]);
      const [flame, hop] = json.motions;
      // round(12 frames × 6 / 12) = 6, taken at floor(i × 12 / 6): every other
      // frame, and the step from the last back to frame 0 is the same 2.
      expect(flame).toMatchObject({ frames: 6, fps: 6, indices: [0, 2, 4, 6, 8, 10] });
      // A one-shot keeps its last frame: round(4 × 6 / 10) = 2 → frames 0 and 3.
      expect(hop).toMatchObject({ frames: 2, fps: 6, indices: [0, 3] });

      const riv = decodeRiv(readFileSync(json.out));
      // The kept frames, each drawn as it was — a repeat shown from the image
      // already in; the loop stands on its feet.
      const shown = shownFrames(json, "flame");
      expect(shown).toHaveLength(6);
      for (const [i, index] of [0, 2, 4, 6, 8, 10].entries()) {
        const full = readRgba(readFileSync(join(dir, "motions", "flame", "frames", `${String(index).padStart(3, "0")}.png`)));
        expectDrawnAsFull(
          shown[i], full,
          fullEdge(json.artboard.anchor.x, flame.anchor.x, full.width),
          fullEdge(json.artboard.anchor.y, flame.anchor.y, full.height),
          0.02,
        );
      }
      expect(json.frameCount).toBe(ofType(riv.objects, "ImageAsset").length);
      expect(ofType(riv.objects, "LinearAnimation").map((a) => a.props)).toEqual([
        { name: "flame", fps: 6, duration: 6, loopValue: 1 },
        { name: "hop", fps: 6, duration: 2, loopValue: 0 },
      ]);
      // No idle here: the machine rests in the first loop, and the one-shot
      // returns to it.
      expect(json.stateMachine).toMatchObject({
        name: "State Machine 1",
        hub: "flame",
        defaultMotion: "flame",
        inputs: [
          { name: "motion", type: "number", default: 0, values: [{ value: 0, motion: "flame" }] },
          { name: "play_hop", type: "trigger", motion: "hop" },
        ],
      });
      const exits = ofType(riv.objects, "StateTransition").filter((t) => t.props.flags !== undefined);
      expect(exits).toEqual([expect.objectContaining({ props: { stateToId: 3, flags: 12, exitTime: 100 } })]);
      // The report's `frames` is what the file was made FROM — every frame of
      // both motions, which is what registration checks against project.json.
      expect(json.frames).toHaveLength(12 + 4);
    }, EXPORT_TIMEOUT_MS);

    test("--max-size shrinks a loop by one factor, and it still stands on its feet", () => {
      const { dir, json } = rived("small", "--motions", "flame", "--max-size", "36", "--images", "png");
      const [flame] = json.motions;
      expect(flame).toMatchObject({ width: 32, height: 36, scale: 0.5, untrimmedDecodeBytes: 12 * 32 * 36 * 4 });
      const riv = decodeRiv(readFileSync(json.out));
      // Every image is (a trim of) a 32x36 frame, drawn inside that frame's box.
      const assets = ofType(riv.objects, "ImageAsset");
      expect(assets.every((a) => (a.props.width as number) <= 32 && (a.props.height as number) <= 36)).toBe(true);
      for (const frame of shownFrames(json, "flame")) {
        const dx = frame.left - fullEdge(json.artboard.anchor.x, flame.anchor.x, 32);
        const dy = frame.top - fullEdge(json.artboard.anchor.y, flame.anchor.y, 36);
        expect(Math.abs(dx - Math.round(dx))).toBeLessThan(0.02);
        expect(Math.round(dx) >= 0 && Math.round(dx) + frame.rgba.width <= 32).toBe(true);
        expect(Math.round(dy) >= 0 && Math.round(dy) + frame.rgba.height <= 36).toBe(true);
      }

      // A loop has no atlas pivot: it stands where its first frame's feet are
      // (the same feet `align` and `inspect` measure), scaled with the frame.
      const source = readRgba(readFileSync(join(dir, "motions", "flame", "frames", "000.png")));
      const feet = feetOf(source);
      expect(flame.anchor.from).toBe("feet");
      expect(flame.anchor.x).toBeCloseTo(feet.x * 0.5, 2);
      expect(flame.anchor.y).toBeCloseTo(feet.y * 0.5, 2);
      // The feet on the anchor: the full frame's corner is the anchor less the feet.
      const [first] = shownFrames(json, "flame");
      expect(Math.abs(fullEdge(json.artboard.anchor.x, flame.anchor.x, 32) - (json.artboard.anchor.x - flame.anchor.x))).toBeLessThan(0.01);
      expect(first.left).toBeGreaterThanOrEqual(fullEdge(json.artboard.anchor.x, flame.anchor.x, 32) - 1e-4);
    }, EXPORT_TIMEOUT_MS);

    test("the downscale is smooth for painted styles and nearest-neighbour for pixel art", () => {
      // Every colour a visible pixel has (a fully transparent pixel draws nothing, whatever its RGB).
      const colours = (image: Buffer) => {
        const { data } = readRgba(image);
        const set = new Set<number>();
        for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 0) set.add(data.readUInt32BE(i));
        return set;
      };
      const smooth = rived("small", "--motions", "flame", "--max-size", "36", "--images", "png");
      const sourceColours = colours(readFileSync(join(smooth.dir, "motions", "flame", "frames", "000.png")));
      const firstFrame = (json: any) =>
        ofType(decodeRiv(readFileSync(json.out)).objects, "FileAssetContents")[0].props.bytes as Buffer;
      // Averaging makes colours the source never had.
      expect([...colours(firstFrame(smooth.json))].some((c) => !sourceColours.has(c))).toBe(true);

      const dir = useCharacter();
      const path = join(dir, "project.json");
      const doc = JSON.parse(readFileSync(path, "utf-8"));
      doc.sprite.character.style = "16-bit pixel art, crisp outline";
      writeFileSync(path, JSON.stringify(doc));
      const pixel = runJson("rive", dir, "--motions", "flame", "--max-size", "36");
      expect(pixel.resample).toMatchObject({ filter: "nearest", filterFrom: "style" });
      // The same reading of the style picks the encoding: pixel art goes in as
      // lossless WebP, so what nearest-neighbour kept is what the file holds.
      expect(pixel.images).toBe("webp-lossless");
      expect(pixel.notes.join(" ")).toMatch(/lossless WebP.*pixel art/);
      // Nearest-neighbour only ever copies a pixel that was there.
      expect([...colours(firstFrame(pixel))].every((c) => sourceColours.has(c))).toBe(true);
      // …and every frame is the PNG export's frame, pixel for pixel.
      const asPng = runJson("rive", dir, "--motions", "flame", "--max-size", "36", "--images", "png");
      expectSamePixels(asPng, pixel);

      const forced = runJson("rive", dir, "--motions", "flame", "--max-size", "36", "--filter", "smooth", "--images", "png");
      expect(forced.resample).toMatchObject({ filter: "smooth", filterFrom: "flag" });
    }, EXPORT_TIMEOUT_MS);

    test("the memory is counted after resampling; over 128 MB warns, over 768 MB refuses", () => {
      // 400 frames of 1024x1024, each a 1000 px square a pixel or more from
      // the last — all different and all but full, so neither trimming nor
      // deduplication makes the arithmetic small.
      const dir = join(fresh(), "big");
      const frames = join(dir, "motions", "huge", "frames");
      mkdirSync(frames, { recursive: true });
      const made = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i",
        "color=c=0x00000000:s=1048x1048:r=60,format=rgba,drawbox=x=24:y=24:w=1000:h=1000:color=red@1:t=fill:replace=1,crop=1024:1024:'mod(n,24)':'mod(floor(n/24),24)'",
        "-frames:v", "400", "-start_number", "0", join(frames, "%03d.png")]);
      expect(made.status).toBe(0);
      const assets = [];
      const ids = [];
      for (let i = 0; i < 400; i++) {
        const name = `${String(i).padStart(3, "0")}.png`;
        const id = `huge-frame-${String(i).padStart(3, "0")}`;
        ids.push(id);
        assets.push({ id, type: "image", uri: `motions/huge/frames/${name}`, name: id, metadata: { width: 1024, height: 1024 }, createdAt: 1, status: "ready" });
      }
      writeFileSync(join(dir, "project.json"), JSON.stringify({
        $schema: "pneuma-craft/project/v1", title: "Big", composition: null, assets, provenance: [],
        sprite: {
          version: 1,
          character: { name: "Big", description: "", style: "", cell: { width: 1024, height: 1024 } },
          refs: [],
          motions: [{ id: "huge", label: "Huge", prompt: "", kind: "loop", grid: { rows: 1, cols: 1 },
            fps: 60, loop: true, anchor: "bottom", status: "ready", source: "video", frames: ids, videos: [] }],
        },
      }));

      // At its own 60 fps and full size: 400 × 1024² × 4 = 1600 MB. Refused
      // before a single frame is read, with the three ways out.
      const refused = run("rive", dir, "--motions", "huge", "--fps", "60", "--max-size", "1024", "--json");
      expect(refused.code).toBe(1);
      expect(refused.out).toBe("");
      expect(refused.err).toMatch(/1600 MB/);
      expect(refused.err).toMatch(/768 MB/);
      expect(refused.err).toMatch(/--fps/);
      expect(refused.err).toMatch(/--max-size/);
      expect(refused.err).toMatch(/--motions/);
      expect(existsSync(join(dir, "exports"))).toBe(false);

      // At 24 fps: 160 frames, 640 MB at full size, about 612 MB trimmed —
      // made, with the warning, which counts what the file decodes.
      const heavy = runJson("rive", dir, "--motions", "huge", "--fps", "24", "--max-size", "1024", "--images", "png");
      expect(heavy.motions[0]).toMatchObject({ frames: 160, width: 1024, height: 1024 });
      expect(heavy.untrimmedDecodeBytes).toBe(160 * 1024 * 1024 * 4);
      expect(heavy.dedupedFrames).toBe(0);
      expect(heavy.estimatedDecodeBytes).toBeLessThan(heavy.untrimmedDecodeBytes);
      expect(heavy.warnings.join(" ")).toMatch(new RegExp(`about ${Math.round(heavy.estimatedDecodeBytes / 1024 / 1024)} MB`));

      // At the defaults: 24 fps and 320 px, about 63 MB and no warning.
      const light = runJson("rive", dir, "--motions", "huge", "--images", "png");
      expect(light.motions[0]).toMatchObject({ frames: 160, width: 320, height: 320 });
      expect(light.untrimmedDecodeBytes).toBe(160 * 320 * 320 * 4);
      expect(light.warnings).toEqual([]);

      // The Export tab quotes the same plan from project.json alone, before
      // anyone asks for the file: same rate, same size, and — nothing
      // measured yet — the memory at full size.
      const roster = loadRoster([{ path: "big/project.json", content: readFileSync(join(dir, "project.json"), "utf-8") }])!;
      const big = roster.byContentSet.big;
      const quoted = exportRows(big, big.sprite.motions[0], { canRequest: true, requests: new Map() })
        .find((row) => row.format === "riv")!;
      expect(quoted.rive).toMatchObject({
        decodeBytes: light.untrimmedDecodeBytes,
        loops: { fps: light.motions[0].fps, width: light.motions[0].width, height: light.motions[0].height },
        tooHeavy: false,
      });
    }, 60_000);

    describe("loops cut at different scales", () => {
      /**
       * Two loops of one body — 24×96 in a 192 px matted clip, feet on the
       * same floor — cut the way `loop` cuts every clip: to its own union box
       * plus 8 px, then scaled to 96 px wide. `sway` barely moves, so its box
       * is 52 px across and it is drawn 1.85× its clip; `stride` walks 96 px,
       * so its box is 128 px and it is drawn at 0.75×. Played as cut, sway's
       * body would stand 2.5× taller than stride's.
       *
       * The two frame 0s stand 36 clip px apart (box left 84 against 48) on
       * the same floor (y 168): where the clips put them.
       */
      const BODY = { w: 24, h: 96, color: "red" };
      const CLIPS = {
        sway: { x: "84+6*sin(2*PI*t)", left0: 84 },
        stride: { x: "48+48*sin(2*PI*t)", left0: 48 },
      } as const;
      const clipOf = (id: keyof typeof CLIPS) => {
        const key = `clip:duo-${id}`;
        if (!built.has(key)) {
          built.set(key, buildExprClip(join(shared(), `duo-${id}.mov`), {
            width: 192, height: 192, fps: 24, frames: 24, background: "black@0", encode: "prores4444",
            box: BODY, x: CLIPS[id].x, y: "72",
          }));
        }
        return built.get(key)!;
      };

      /** The character, built through the real scripts. `legacy` registers
       *  runs with the crop and scale taken out — a loop cut before `loop`
       *  recorded them — so the export has to measure them off the clip. */
      const duo = (legacy: boolean) => stage(`duo-${legacy ? "legacy" : "recorded"}`, (dir) => {
        projectCmd(dir, "init", "--name", "Duo", "--cell", "64x64");
        for (const id of ["sway", "stride"] as const) {
          const motionDir = join(dir, "motions", id);
          mkdirSync(motionDir, { recursive: true });
          const clip = join(motionDir, "video-veed-1.mov");
          cpSync(clipOf(id), clip);
          const summary = runJson("loop", clip, "--out", motionDir, "--name", id, "--key", "alpha",
            "--width", "96", "--formats", "apng", "--seam-fill", "none");
          if (legacy) {
            for (const record of [summary, summary.inspect]) {
              delete record.crop;
              delete record.scale;
            }
          }
          writeFileSync(join(motionDir, "run.json"), JSON.stringify(summary));
          projectCmd(dir, "add-motion", "--id", id, "--label", id, "--kind", "loop", "--fps", "24");
          projectCmd(dir, "set-motion", "--motion", id, "--brief-duration", "1", "--brief-width", "96",
            "--brief-interpolator", "none");
          projectCmd(dir, "add-video", "--motion", id, "--file", `motions/${id}/video-veed-1.mov`,
            "--model", "seedance-2.5", "--mode", "first-last", "--status", "ready");
          projectCmd(dir, "register-run", "--motion", id, "--run", join(motionDir, "run.json"));
        }
      });
      /** A report as a file, for `register-export --report <path>`. */
      const writeReport = (dir: string, report: unknown) => {
        const path = join(dir, "..", `report-${Math.random().toString(36).slice(2)}.json`);
        writeFileSync(path, JSON.stringify(report));
        return path;
      };
      const useDuo = (legacy: boolean) => {
        const dir = join(fresh(), "duo");
        cpSync(duo(legacy), dir, { recursive: true });
        return dir;
      };

      /** Where each motion's frame 0 draws its body on the artboard: the
       *  image's top-left is the anchor less origin × size, and the body is
       *  the half-coverage (alpha ≥ 128) box inside the image — the edge a
       *  resample keeps in place, where a low threshold would also count the
       *  blur two rounds of scaling leave around it. */
      const bodies = (json: any) => {
        const out: Record<string, { left: number; bottom: number; height: number }> = {};
        for (const motion of json.motions) {
          const [frame] = shownFrames(json, motion.id);
          const pixels = frame.rgba;
          let x0 = Infinity, y0 = Infinity, y1 = -1;
          for (let y = 0; y < pixels.height; y++) {
            for (let x = 0; x < pixels.width; x++) {
              if (pixels.data[(y * pixels.width + x) * 4 + 3] < 128) continue;
              x0 = Math.min(x0, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
            }
          }
          out[motion.id] = { left: frame.left + x0, bottom: frame.top + y1 + 1, height: y1 + 1 - y0 };
        }
        return out;
      };

      /** One body height, and each where its clip put it: 36 clip px apart
       *  at the shared factor, on one floor. */
      const expectOneCharacter = (json: any) => {
        const body = bodies(json);
        const factor = json.motions[0].scale * json.motions[0].clip.scale;
        expect(Math.abs(body.sway.height - body.stride.height)).toBeLessThanOrEqual(1);
        expect(body.sway.height).toBeCloseTo(BODY.h * factor, -0.5);
        expect(Math.abs(body.sway.bottom - body.stride.bottom)).toBeLessThanOrEqual(1);
        expect(body.sway.left - body.stride.left).toBeCloseTo((CLIPS.sway.left0 - CLIPS.stride.left0) * factor, -0.5);
      };

      test("recorded: each loop is divided by the scale it was cut at, and placed where its clip put it", () => {
        const dir = useDuo(false);
        const json = runJson("rive", dir, "--include-loops");
        const [sway, stride] = json.motions;
        expect(sway.clip).toEqual({ scale: 1.8462, origin: { x: 70, y: 64 }, from: "recorded" });
        expect(stride.clip).toEqual({ scale: 0.75, origin: { x: 0, y: 64 }, from: "recorded" });
        expect([sway.anchor.from, stride.anchor.from]).toEqual(["clip", "clip"]);
        // One factor in clip px (0.75, where stride's frames stay as cut):
        // sway comes down by 0.75 / 1.8462.
        expect(stride.scale).toBe(1);
        expect(sway.scale).toBeCloseTo(0.75 / 1.8462, 4);
        expectOneCharacter(json);
        expect(json.warnings).toEqual([]);

        // The Export tab quotes the same plan off project.json alone.
        const roster = loadRoster([{ path: "duo/project.json", content: readFileSync(join(dir, "project.json"), "utf-8") }])!;
        const character = roster.byContentSet.duo;
        const quoted = exportRows(character, character.sprite.motions[0], { canRequest: true, requests: new Map() })
          .find((row) => row.format === "riv")!;
        expect(quoted.rive).toMatchObject({
          // Nothing measured yet: the frames at full size.
          decodeBytes: json.untrimmedDecodeBytes,
          loops: {
            fps: 24,
            width: Math.max(...json.motions.map((m: any) => m.width)),
            height: Math.max(...json.motions.map((m: any) => m.height)),
          },
        });
      }, 60_000);

      test("not recorded: the scale and the origin are measured off the clip, to the same result", () => {
        const dir = useDuo(true);
        const project = JSON.parse(readFileSync(join(dir, "project.json"), "utf-8"));
        expect(project.sprite.motions.map((m: any) => "scale" in m.inspect)).toEqual([false, false]);

        const json = runJson("rive", dir, "--include-loops");
        const [sway, stride] = json.motions;
        expect(sway.clip.from).toBe("measured");
        expect(stride.clip.from).toBe("measured");
        // Heights of the same frame in the loop and in the clip: within 1% of
        // what `loop` would have recorded, and the rect's corner to a pixel.
        expect(Math.abs(sway.clip.scale / 1.8462 - 1)).toBeLessThan(0.01);
        expect(Math.abs(stride.clip.scale / 0.75 - 1)).toBeLessThan(0.01);
        expect(Math.abs(sway.clip.origin.x - 70)).toBeLessThanOrEqual(1);
        expect(Math.abs(sway.clip.origin.y - 64)).toBeLessThanOrEqual(1);
        expect(Math.abs(stride.clip.origin.x - 0)).toBeLessThanOrEqual(1);
        expect(Math.abs(stride.clip.origin.y - 64)).toBeLessThanOrEqual(1);
        expect([sway.anchor.from, stride.anchor.from]).toEqual(["clip", "clip"]);
        expectOneCharacter(json);
        expect(json.warnings).toEqual([]);
      }, 60_000);

      test("after the first export the Export tab quotes what the script makes: one authority for old loops", () => {
        const dir = useDuo(true);
        const quote = () => rivePlanFor(loadRoster([
          { path: "duo/project.json", content: readFileSync(join(dir, "project.json"), "utf-8") },
        ])!.byContentSet.duo)!;
        const json = runJson("rive", dir, "--include-loops");
        // Before: the panel cannot decode a clip, so it quotes the frames as
        // cut — a different file from the one the script makes.
        expect(quote().decodeBytes).not.toBe(json.estimatedDecodeBytes);

        const registered = projectCmd(dir, "register-export", "--report", writeReport(dir, json));
        expect(registered.measured).toEqual(["sway", "stride"]);
        const after = quote();
        expect(after.decodeBytes).toBe(json.estimatedDecodeBytes);
        expect(after.motions.map((m) => [m.id, m.width, m.height, m.frames]))
          .toEqual(json.motions.map((m: any) => [m.id, m.width, m.height, m.frames]));

        // The next export reuses the measurement instead of decoding again,
        // and comes out the same.
        const again = runJson("rive", dir, "--include-loops");
        expect(again.motions.map((m: any) => m.clip)).toEqual(json.motions.map((m: any) => m.clip));
        expect(again.estimatedDecodeBytes).toBe(json.estimatedDecodeBytes);
      }, 60_000);

      test("a clip that is not there is not guessed at: warned, and that loop is drawn as cut and stood on its feet", () => {
        const dir = useDuo(true);
        rmSync(join(dir, "motions", "stride", "video-veed-1.mov"));
        const json = runJson("rive", dir, "--include-loops");
        const [sway, stride] = json.motions;
        expect(sway.clip.from).toBe("measured");
        expect(stride.clip).toBeNull();
        expect(stride.anchor.from).toBe("feet");
        expect(json.warnings).toEqual([
          expect.stringMatching(/^stride: .*scale.*unknown.*motions\/stride\/video-veed-1\.mov.*not on disk.*as it was cut.*feet/),
        ]);
      }, 60_000);

      test("one loop has nothing to be matched against, so nothing is measured", () => {
        const dir = useDuo(true);
        rmSync(join(dir, "motions", "stride", "video-veed-1.mov"));
        const json = runJson("rive", dir, "--motions", "stride");
        expect(json.motions[0]).toMatchObject({ clip: null, anchor: { from: "feet" } });
        expect(json.warnings).toEqual([]);
      }, 60_000);
    });

    test("refuses by name what it cannot do", () => {
      const dir = useCharacter();
      const unknown = run("rive", dir, "--images", "gif", "--json");
      expect(unknown.code).toBe(1);
      expect(unknown.err).toMatch(/--images.*webp.*webp-lossless.*png/);
      for (const [flags, pattern] of [
        [["--motions", "flame,nope"], /no motion 'nope'.*bounce, hop, flame, walk/],
        [["--motions", "walk"], /'walk' is not ready.*planned/],
        [["--motions", "flame,flame"], /flame.*twice/],
        [["--fps", "0"], /--fps/],
        [["--max-size", "big"], /--max-size/],
        [["--filter", "lanczos"], /--filter.*auto.*smooth.*nearest/],
      ] as const) {
        const r = run("rive", dir, ...flags, "--json");
        expect({ flags, code: r.code, matches: pattern.test(r.err) }).toEqual({ flags, code: 1, matches: true });
      }
      const none = run("rive", fresh(), "--json");
      expect(none.code).toBe(1);
      expect(none.err).toMatch(/project\.json/);
      expect(existsSync(join(dir, "exports"))).toBe(false);
    });
  });

  test("cleanup", () => {
    built.clear();
    sharedRoot = null;
    cleanupAll();
    expect(workspaces).toHaveLength(0);
  });
});

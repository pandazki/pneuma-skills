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
  cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  alphaColorAudit, buildClip, buildExprClip, buildNoiseClip, buildSheet, clipBoxCentres,
  clipFrameDeltas, edgeLuma, readBbox, readColorBbox, silhouetteDiff, webpAnimation,
  webpStackedFrames, CELL_OFFSETS,
} from "./fixtures/pipeline/make-sheet.mjs";
import type { BuildExprClipOptions, BuildSheetOptions } from "./fixtures/pipeline/make-sheet.mjs";

const SCRIPT = join(import.meta.dir, "..", "skill", "scripts", "sprite-sheet.mjs");

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
    });

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

  test("cleanup", () => {
    built.clear();
    sharedRoot = null;
    cleanupAll();
    expect(workspaces).toHaveLength(0);
  });
});

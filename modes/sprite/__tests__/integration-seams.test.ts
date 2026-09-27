/**
 * Where this round's features meet, end to end through the real scripts.
 *
 * Each feature landed with its own suite (chroma, cycle, breathe, export,
 * alignment, pixel lattice, the 0.5.0 sidecar), each written against a branch
 * that did not have the others. These cases pin what only shows once they
 * share a pipeline:
 *
 *  - a breathe idle through align / pack / inspect — T4's near-duplicate
 *    check against T6's whole-pixel head;
 *  - a `run --pixel` motion — T2's atlas anchor, T4's head-band numbers
 *    (measured on source-resolution cells against lattice-resolution frames),
 *    T5's lattice report, and S's palette pinning through `register-run`;
 *  - `from-video` with T1's default un-mixing keyer, T4's `--x-from trend`
 *    and `--body-height` together.
 *
 * Every fixture is drawn at test time; the file skips with a named reason
 * when ffmpeg is missing.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { buildWalkerClip, readBbox } from "./fixtures/pipeline/make-sheet.mjs";
import { blank, logicalArt, paste, setPixel, upscaledFractional } from "./fixtures/pixel/lattice-art.mjs";
import { swayAboutTrend } from "../skill/scripts/drift.mjs";
import type { RgbaImage } from "../skill/scripts/pixel-lattice.mjs";

const SCRIPTS = join(import.meta.dir, "..", "skill", "scripts");
const SHEET = join(SCRIPTS, "sprite-sheet.mjs");
const PROJECT = join(SCRIPTS, "sprite-project.mjs");
const LUMI_IDLE_00 = join(import.meta.dir, "..", "seed", "lumi", "motions", "idle", "frames", "00.png");

const HAS_FFMPEG =
  spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0 &&
  spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0;
if (!HAS_FFMPEG) console.warn("(skip) modes/sprite integration seams — ffmpeg/ffprobe not on PATH");

function exec(script: string, argv: string[], input?: string) {
  const r = Bun.spawnSync([process.execPath, script, ...argv], {
    cwd: import.meta.dir, stdout: "pipe", stderr: "pipe", ...(input === undefined ? {} : { stdin: Buffer.from(input) }),
  });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
}
function sheet(...argv: string[]) {
  const r = exec(SHEET, [...argv, "--json"]);
  if (r.code !== 0) throw new Error(`sprite-sheet ${argv[0]} failed (${r.code}):\n${r.err}`);
  return JSON.parse(r.out);
}
function projectJson(dir: string, ...argv: string[]) {
  const r = exec(PROJECT, [argv[0], "--dir", dir, ...argv.slice(1), "--json"]);
  if (r.code !== 0) throw new Error(`sprite-project ${argv[0]} failed (${r.code}):\n${r.err}`);
  return JSON.parse(r.out);
}
const registerRun = (dir: string, motion: string, summary: unknown, ...more: string[]) =>
  exec(PROJECT, ["register-run", "--dir", dir, "--motion", motion, "--run", "-", "--json", ...more], JSON.stringify(summary));

const workspaces: string[] = [];
function fresh() {
  const dir = mkdtempSync(join(tmpdir(), "sprite-seams-"));
  workspaces.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of workspaces.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Each case spawns ffmpeg dozens of times; the machine may be shared. */
const SLOW = 120_000;

function writePng(path: string, image: RgbaImage) {
  mkdirSync(join(path, ".."), { recursive: true });
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${image.width}x${image.height}`, "-i", "-", "-frames:v", "1", path], { input: image.data });
  if (r.status !== 0) throw new Error(String(r.stderr));
}

describe.skipIf(!HAS_FFMPEG)("breathe x align / inspect", () => {
  test("a breathe idle lists its planned holds but is not told to redraw them", () => {
    const ws = fresh();
    const motion = join(ws, "idle");
    const cells = join(motion, "cells");
    const out = sheet("breathe", LUMI_IDLE_00, "--out", cells, "--frames", "16", "--depth", "0.02", "--mode", "smooth");
    expect(out.breatheRecord).toBe(join(cells, "breathe.json"));
    sheet("align", cells, "--out", join(motion, "frames"), "--x-from", "cell");
    sheet("pack", join(motion, "frames"), "--out", join(motion, "sheet.png"), "--atlas", join(motion, "atlas.json"),
      "--name", "idle", "--fps", "8", "--loop");
    const report = sheet("inspect", motion);
    // The head moves by whole pixels: 7 rows over 16 frames, so neighbours at
    // each turn of the breath share it (measured: 4 pairs on Lumi, 0.02).
    expect(report.nearDuplicates.length).toBeGreaterThan(0);
    expect(report.warnings.some((w: string) => w.startsWith("near-duplicate frames"))).toBe(false);
    expect(report.rowJumps).toEqual([]);

    // The same frames without the record are what a model could have drawn:
    // then the sentence is said.
    unlinkSync(join(cells, "breathe.json"));
    const bare = sheet("inspect", motion);
    expect(bare.nearDuplicates).toEqual(report.nearDuplicates);
    expect(bare.warnings.some((w: string) => w.startsWith("near-duplicate frames"))).toBe(true);
  }, SLOW);

  test("with no --mode, a character declared pixel art breathes in pixel mode whatever its style says", () => {
    const ws = fresh();
    const dir = join(ws, "plush");
    projectJson(dir, "init", "--name", "Plush", "--style", "soft plush render", "--pixel", "28");
    const out = sheet("breathe", LUMI_IDLE_00, "--out", join(dir, "motions", "idle", "cells"), "--frames", "8");
    expect({ mode: out.mode, modeFrom: out.modeFrom }).toEqual({ mode: "pixel", modeFrom: "character.pixel" });
  }, SLOW);
});

describe.skipIf(!HAS_FFMPEG)("run --pixel x anchor, head band, palette pinning", () => {
  const ART = logicalArt(20, 28, 11);
  const PITCHES = [13.1, 13.3, 12.9, 13.2];
  /** A 2x2 sheet with alpha; the sprite sits at a different x in each cell
   *  (0, 2, 4 and 1 blocks right), the placement `--x-from cell` keeps. */
  function pixelSheet(path: string) {
    const img = blank(840, 840);
    PITCHES.forEach((p, i) => {
      const cell = blank(420, 420);
      const sprite = upscaledFractional(ART, p);
      const x = 27 + Math.round([0, 2, 4, 1][i] * p);
      paste(cell, sprite, x, 21);
      for (let k = x; k < x + sprite.width; k++) setPixel(cell, k, 21 + sprite.height, [40, 40, 40, 100]);
      paste(img, cell, (i % 2) * 420, Math.floor(i / 2) * 420);
    });
    writePng(path, img);
    return path;
  }

  test("the atlas carries anchor, and the source head sway is said in frame pixels", () => {
    const ws = fresh();
    const src = pixelSheet(join(ws, "sheet.png"));
    const motion = join(ws, "char", "motions", "walk");
    const out = sheet("run", src, "--rows", "2", "--cols", "2", "--out", motion, "--name", "walk", "--fps", "8",
      "--loop", "--pixel", "--x-from", "cell", "--no-webp");
    // T5's lattice held, and T4's fields are all there beside it.
    expect(out.inspect.pixel).toMatchObject({ held: true, scale: 1 });
    expect(out.inspect).toHaveProperty("headDrift");
    expect(out.inspect).toHaveProperty("sourceHeadDrift");
    expect(Array.isArray(out.inspect.nearDuplicates)).toBe(true);
    expect(Array.isArray(out.inspect.rowJumps)).toBe(true);
    // T2: every frame declares `anchor` equal to its pivot, pixel runs too.
    const atlas = JSON.parse(readFileSync(join(motion, "atlas.json"), "utf-8"));
    for (const frame of Object.values(atlas.frames) as Array<{ anchor: unknown; pivot: unknown }>) {
      expect(frame.anchor).toEqual(frame.pivot);
    }
    // `cell` keeps the placement as drawn, so the frames' head band moves
    // exactly as the cells' did — in logical pixels here, source pixels
    // there. The source number is converted; unconverted it read ~13x.
    const report = JSON.parse(readFileSync(join(motion, "inspect.json"), "utf-8"));
    const framesSway = swayAboutTrend(report.frames.map((f: { headX: number }) => f.headX));
    expect(framesSway).toBeGreaterThan(0.3);
    expect(Math.abs(out.inspect.sourceHeadDrift - framesSway)).toBeLessThan(0.5);
    expect(out.inspect.warnings.some((w: string) => w.startsWith("head sways"))).toBe(false);
  }, SLOW);

  test("register-run pins what run --pixel wrote, and the next motion quantises to it by default", () => {
    const ws = fresh();
    const src = pixelSheet(join(ws, "sheet.png"));
    const dir = join(ws, "knight");
    projectJson(dir, "init", "--name", "Knight", "--purpose", "game", "--pixel", "28");
    const id = `${basename(dir)}-palette`;

    projectJson(dir, "add-motion", "--id", "walk", "--rows", "2", "--cols", "2", "--fps", "8");
    const walk = sheet("run", src, "--rows", "2", "--cols", "2", "--out", join(dir, "motions", "walk"), "--name", "walk",
      "--fps", "8", "--loop", "--pixel", "--no-webp");
    expect(walk.pixel.palette).toMatchObject({ pinned: false, from: "motion", file: join(dir, "motions", "walk", "palette.json") });
    const first = registerRun(dir, "walk", walk);
    expect(first.code).toBe(0);
    let doc = JSON.parse(readFileSync(join(dir, "project.json"), "utf-8"));
    expect(doc.sprite.character.pixel).toMatchObject({ logicalHeight: 28, palette: id, colors: walk.pixel.palette.colors });
    expect(doc.assets.find((a: { id: string }) => a.id === id).uri).toBe("motions/walk/palette.json");

    // A second motion: no --palette, and it lands on the pinned file.
    projectJson(dir, "add-motion", "--id", "hop", "--rows", "2", "--cols", "2", "--fps", "8");
    const hop = sheet("run", src, "--rows", "2", "--cols", "2", "--out", join(dir, "motions", "hop"), "--name", "hop",
      "--fps", "8", "--pixel", "--no-webp");
    expect(hop.pixel.palette).toMatchObject({ pinned: true, from: "character", file: join(dir, "motions", "walk", "palette.json") });
    expect(existsSync(join(dir, "motions", "hop", "palette.json"))).toBe(false);
    expect(registerRun(dir, "hop", hop).code).toBe(0);

    // --repalette builds the motion's own, never the pinned file; the
    // sidecar then asks for --repin.
    const pinnedBytes = readFileSync(join(dir, "motions", "walk", "palette.json"));
    const rebuilt = sheet("run", src, "--rows", "2", "--cols", "2", "--out", join(dir, "motions", "hop"), "--name", "hop",
      "--fps", "8", "--pixel", "--repalette", "--palette-size", "8", "--no-webp", "--force");
    expect(rebuilt.pixel.palette).toMatchObject({ pinned: false, from: "motion", file: join(dir, "motions", "hop", "palette.json") });
    expect(readFileSync(join(dir, "motions", "walk", "palette.json"))).toEqual(pinnedBytes);
    const refused = registerRun(dir, "hop", rebuilt);
    expect(refused.code).toBe(1);
    expect(refused.err).toMatch(/not to the palette pinned for Knight/);
    expect(registerRun(dir, "hop", rebuilt, "--repin").code).toBe(0);
    doc = JSON.parse(readFileSync(join(dir, "project.json"), "utf-8"));
    expect(doc.assets.find((a: { id: string }) => a.id === id).uri).toBe("motions/hop/palette.json");

    // A pinned palette whose file is gone is refused, not silently rebuilt.
    rmSync(join(dir, "motions", "hop", "palette.json"));
    const gone = exec(SHEET, ["run", src, "--rows", "2", "--cols", "2", "--out", join(dir, "motions", "walk"), "--name", "walk",
      "--fps", "8", "--pixel", "--no-webp", "--json"]);
    expect(gone.code).toBe(1);
    expect(gone.err).toMatch(/the palette pinned for this character .* is not on disk/);
  }, SLOW);

  test("a character declared pixel art is told about --pixel whatever its style says", () => {
    const ws = fresh();
    const src = pixelSheet(join(ws, "sheet.png"));
    const dir = join(ws, "plush");
    projectJson(dir, "init", "--name", "Plush", "--style", "soft plush render", "--pixel", "28");
    const plain = sheet("run", src, "--rows", "2", "--cols", "2", "--out", join(dir, "motions", "walk"), "--name", "walk",
      "--fps", "8", "--no-webp");
    expect(plain.warnings.some((w: string) => w.startsWith("character.pixel says pixel art (28 logical px tall) — run --pixel"))).toBe(true);
  }, SLOW);
});

describe.skipIf(!HAS_FFMPEG)("from-video: un-mixing keyer x --x-from trend x --body-height", () => {
  test("the three run together and each still does its part", () => {
    const ws = fresh();
    // A walker on a treadmill that also drifts right 12 px/s across the clip.
    const clip = buildWalkerClip(join(ws, "walk.mp4"), { drift: 12, seconds: 2 });
    const out = sheet("from-video", clip, "--out", join(ws, "walk"), "--name", "walk", "--frames", "8",
      "--x-from", "trend", "--body-height", "60");
    // T1: the default keyer ran (the plate has a hue).
    expect(out.keyer).toBe("unmix");
    // T4: the drift line was fitted and removed, and the record says so.
    expect(out.xFrom).toBe("trend");
    expect(out.drift).toHaveProperty("driftPx");
    // T4: one standing height — measured on the un-mixed first frame, then
    // every sample scaled by it.
    expect(out.bodyHeight.target).toBe(60);
    expect(out.bodyHeight.scale).toBeLessThan(1);
    expect(readBbox(join(ws, "walk", "cells", "00.png")).width).toBe(out.bodyHeight.frame.width);
    const report = JSON.parse(readFileSync(join(ws, "walk", "inspect.json"), "utf-8"));
    expect(Math.abs(report.frames[0].bbox.h - 60)).toBeLessThanOrEqual(2);
    // …and the un-mixed plate is gone from what was scaled.
    expect(out.inspect.keyResidue).toBeLessThan(0.005);

    // The colorkey path reaches the same height.
    const cut = sheet("from-video", clip, "--out", join(ws, "cut"), "--name", "cut", "--frames", "8",
      "--x-from", "trend", "--body-height", "60", "--keyer", "colorkey");
    expect(cut.keyer).toBe("colorkey");
    const cutReport = JSON.parse(readFileSync(join(ws, "cut", "inspect.json"), "utf-8"));
    expect(Math.abs(cutReport.frames[0].bbox.h - 60)).toBeLessThanOrEqual(2);
  }, 2 * SLOW);
});

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
 *    and `--body-height` together;
 *  - T8's `mirror` over a `run --pixel` motion (T5's lattice, S's pinned
 *    palette, T2's own-pack anchor) and over T10's one-command breathe
 *    (68fd3b6c's breathe record), and T10's `fit` / `breathe --name` on a
 *    character declared pixel art;
 *  - T11's colourways against T8's mirror (per motion: a mirror has none
 *    until it is recoloured), T10's breathe of a pixel still, T7's
 *    sheet-prompt and the declared height `run --pixel` reads, and a
 *    re-run of a mirrored, recoloured source.
 *
 * Every fixture is drawn at test time; the file skips with a named reason
 * when ffmpeg is missing.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { buildWalkerClip, readBbox } from "./fixtures/pipeline/make-sheet.mjs";
import { PALETTE, blank, logicalArt, paste, setPixel, upscaledFractional } from "./fixtures/pixel/lattice-art.mjs";
import { RECOLOR_KIND } from "../skill/scripts/recolor.mjs";
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

const ART = logicalArt(20, 28, 11);
const PITCHES = [13.1, 13.3, 12.9, 13.2];
/** A 2x2 pixel-art sheet with alpha; the sprite sits at a different x in each
 *  cell (0, 2, 4 and 1 blocks right), the placement `--x-from cell` keeps. */
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

describe.skipIf(!HAS_FFMPEG)("run --pixel x anchor, head band, palette pinning", () => {
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
    // inspect's lattice check lands in the sidecar too, less the palette's
    // absolute path (the character's pixel spec names the pinned palette).
    const { palette: palettePath, ...check } = walk.inspect.pixel;
    expect(palettePath).toBe(join(dir, "motions", "walk", "palette.json"));
    expect(check).toMatchObject({ scale: 1, held: true, paletteChecked: true });
    expect(doc.sprite.motions.find((m: { id: string }) => m.id === "walk").inspect.pixel).toEqual(check);

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

describe.skipIf(!HAS_FFMPEG)("mirror x pixel lattice, breathe --name, palette pinning", () => {
  const doc = (dir: string) => JSON.parse(readFileSync(join(dir, "project.json"), "utf-8"));
  const readJson = (path: string) => JSON.parse(readFileSync(path, "utf-8"));

  test("a pixel-art side view mirrors onto its own lattice, keeps the pinned palette, and packs its own anchor", () => {
    const ws = fresh();
    const src = pixelSheet(join(ws, "sheet.png"));
    const dir = join(ws, "knight");
    projectJson(dir, "init", "--name", "Knight", "--purpose", "game", "--pixel", "28", "--facing", "right");
    projectJson(dir, "add-motion", "--id", "walk-right", "--rows", "2", "--cols", "2", "--fps", "8", "--loop", "--direction", "right");
    const walk = sheet("run", src, "--rows", "2", "--cols", "2", "--out", join(dir, "motions", "walk-right"), "--name", "walk-right",
      "--fps", "8", "--loop", "--pixel", "--no-webp");
    expect(registerRun(dir, "walk-right", walk).code).toBe(0);
    const pinned = doc(dir);
    const palette = pinned.assets.find((a: { id: string }) => a.id === "knight-palette");
    expect(palette.uri).toBe("motions/walk-right/palette.json");

    projectJson(dir, "add-motion", "--id", "walk-left", "--rows", "2", "--cols", "2", "--fps", "8", "--loop",
      "--source", "mirror", "--direction", "left");
    const mirrored = sheet("mirror", join(dir, "motions", "walk-right"), "--name", "walk-left");
    // The lattice the source was snapped to travels with the flip, and the
    // flipped frames hold it: binary alpha, blocks on the grid, every colour
    // in the pinned palette.
    const record = readJson(join(dir, "motions", "walk-left", "frames", "align.json"));
    expect(record.pixel).toEqual(readJson(join(dir, "motions", "walk-right", "frames", "align.json")).pixel);
    expect(record.pixel.palette).toBe(join(dir, "motions", "walk-right", "palette.json"));
    expect(mirrored.inspect.pixel).toMatchObject({ held: true, scale: walk.inspect.pixel.scale });
    // The anchor comes from the mirror's own pack: the source's point at
    // width − x, and every frame's `anchor` is its own pivot.
    const right = readJson(join(dir, "motions", "walk-right", "atlas.json"));
    const left = readJson(join(dir, "motions", "walk-left", "atlas.json"));
    expect(left.meta.anchorPoint).toEqual({ x: mirrored.cell.width - right.meta.anchorPoint.x, y: right.meta.anchorPoint.y });
    for (const frame of Object.values(left.frames) as Array<{ anchor: unknown; pivot: unknown }>) {
      expect(frame.anchor).toEqual(frame.pivot);
    }
    // A flip adds no colour: the mirror registers and the pin is untouched.
    expect(registerRun(dir, "walk-left", mirrored).code).toBe(0);
    const after = doc(dir);
    expect(after.sprite.character.pixel).toEqual(pinned.sprite.character.pixel);
    expect(after.assets.find((a: { id: string }) => a.id === "knight-palette")).toEqual(palette);
  }, SLOW);

  test("a breathe made in one command keeps its planned holds out of the warnings, and so does its mirror", () => {
    const ws = fresh();
    const dir = join(ws, "lumi");
    projectJson(dir, "init", "--name", "Lumi", "--style", "Clean anime-chibi line art, flat colors", "--facing", "right");
    mkdirSync(join(dir, "refs"), { recursive: true });
    copyFileSync(LUMI_IDLE_00, join(dir, "refs", "still.png"));
    projectJson(dir, "add-ref", "--id", "still", "--file", "refs/still.png", "--role", "custom", "--uploaded");
    projectJson(dir, "add-motion", "--id", "idle-right", "--fps", "8", "--source", "breathe", "--direction", "right");
    const breathed = sheet("breathe", join(dir, "refs", "still.png"), "--out", join(dir, "motions", "idle-right"),
      "--name", "idle-right", "--frames", "16", "--depth", "0.02", "--no-webp");
    // The one-command form bakes into cells/, and its record lands there.
    expect(breathed.breatheRecord).toBe(join(dir, "motions", "idle-right", "cells", "breathe.json"));
    expect(breathed.inspect.nearDuplicates.length).toBeGreaterThan(0);
    expect(breathed.inspect.warnings.some((w: string) => w.startsWith("near-duplicate frames"))).toBe(false);
    expect(registerRun(dir, "idle-right", breathed).code).toBe(0);

    projectJson(dir, "add-motion", "--id", "idle-left", "--rows", "4", "--cols", "4", "--fps", "8", "--loop",
      "--source", "mirror", "--direction", "left");
    const mirrored = sheet("mirror", join(dir, "motions", "idle-right"), "--name", "idle-left");
    expect(existsSync(join(dir, "motions", "idle-left", "cells", "breathe.json"))).toBe(true);
    expect(mirrored.inspect.nearDuplicates.length).toBeGreaterThan(0);
    expect(mirrored.inspect.warnings.some((w: string) => w.startsWith("near-duplicate frames"))).toBe(false);
    expect(registerRun(dir, "idle-left", mirrored).code).toBe(0);
    expect(doc(dir).sprite.motions.find((m: { id: string }) => m.id === "idle-left"))
      .toMatchObject({ source: "mirror", mirrorOf: "idle-right", direction: "left", status: "ready" });
  }, SLOW);

  test("fit and breathe --name on a character declared pixel art keep whole pixels", () => {
    const ws = fresh();
    const dir = join(ws, "plush");
    projectJson(dir, "init", "--name", "Plush", "--style", "soft plush render", "--pixel", "28");
    const fitted = sheet("fit", LUMI_IDLE_00, "--out", join(dir, "refs", "still.png"), "--max", "100");
    // Trimmed, never resampled, and said so.
    expect(fitted).toMatchObject({ pixelArt: true, scale: 1 });
    expect(fitted.notes.join("\n")).toMatch(/character\.pixel says pixel art, which is never resampled/);
    const breathed = sheet("breathe", join(dir, "refs", "still.png"), "--out", join(dir, "motions", "idle"),
      "--name", "idle", "--frames", "8", "--no-webp");
    expect({ mode: breathed.mode, modeFrom: breathed.modeFrom, recorded: breathed.breathe.mode })
      .toEqual({ mode: "pixel", modeFrom: "character.pixel", recorded: "pixel" });
  }, SLOW);
});

describe.skipIf(!HAS_FFMPEG)("colourways x mirror, breathe, sheet-prompt", () => {
  const doc = (dir: string) => JSON.parse(readFileSync(join(dir, "project.json"), "utf-8"));
  const readJson = (path: string) => JSON.parse(readFileSync(path, "utf-8"));
  const hex = (c: number[]) => `#${c.slice(0, 3).map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  const BLUE = hex(PALETTE[2]);
  const registerRecolor = (dir: string, report: unknown) =>
    exec(PROJECT, ["register-recolor", "--dir", dir, "--report", "-", "--json"], JSON.stringify(report));
  const motionOf = (dir: string, id: string) => doc(dir).sprite.motions.find((m: { id: string }) => m.id === id);
  function decode(path: string): RgbaImage {
    const p = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", path], { encoding: "utf-8" });
    const [width, height] = String(p.stdout).trim().split(",").map(Number);
    const r = spawnSync("ffmpeg", ["-v", "error", "-i", path, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "-"], { maxBuffer: 1 << 28 });
    return { width, height, data: new Uint8Array(r.stdout.subarray(0, width * height * 4)) };
  }
  /** A pixel knight facing right with `walk-right` run --pixel, registered
   *  (palette pinned) and baked in one colourway, `red-team`. */
  function recolouredKnight() {
    const ws = fresh();
    const src = pixelSheet(join(ws, "sheet.png"));
    const dir = join(ws, "knight");
    projectJson(dir, "init", "--name", "Knight", "--purpose", "game", "--pixel", "28", "--facing", "right");
    projectJson(dir, "add-motion", "--id", "walk-right", "--rows", "2", "--cols", "2", "--fps", "8", "--loop", "--direction", "right");
    const walk = sheet("run", src, "--rows", "2", "--cols", "2", "--out", join(dir, "motions", "walk-right"), "--name", "walk-right",
      "--fps", "8", "--loop", "--pixel", "--no-webp");
    expect(registerRun(dir, "walk-right", walk).code).toBe(0);
    const map = join(ws, "map.json");
    writeFileSync(map, JSON.stringify({ kind: RECOLOR_KIND, version: 1, variants: [{ name: "red-team", map: { [BLUE]: "#b4285a" } }] }));
    const baked = sheet("recolor", join(dir, "motions", "walk-right"), "--map", map);
    expect(registerRecolor(dir, baked).code).toBe(0);
    return { ws, src, dir };
  }

  test("a mirror of a recoloured motion has no colourway until it is recoloured; its bake is the flip of the source's", () => {
    const { dir } = recolouredKnight();
    projectJson(dir, "add-motion", "--id", "walk-left", "--rows", "2", "--cols", "2", "--fps", "8", "--loop",
      "--source", "mirror", "--direction", "left");
    expect(registerRun(dir, "walk-left", sheet("mirror", join(dir, "motions", "walk-right"), "--name", "walk-left")).code).toBe(0);
    // Colourways are per motion: the flip carries none, and nothing claims one.
    expect(motionOf(dir, "walk-left").variants).toBeUndefined();
    expect(existsSync(join(dir, "motions", "walk-left", "variants"))).toBe(false);
    const shown = projectJson(dir, "show");
    expect(shown.variantsMissing).toEqual([{ motion: "walk-left", variants: ["red-team"] }]);
    expect(shown.motions.find((m: { id: string }) => m.id === "walk-left").variants).toBeUndefined();

    // Recoloured with the recorded colourway (no --map): the swap is per
    // pixel, so the mirror's colourway is the source's colourway flipped,
    // standing on the mirror's own pivot.
    const baked = sheet("recolor", join(dir, "motions", "walk-left"));
    expect(registerRecolor(dir, baked).code).toBe(0);
    expect(Object.keys(motionOf(dir, "walk-left").variants)).toEqual(["red-team"]);
    expect(projectJson(dir, "show").variantsMissing).toBeUndefined();
    const right = decode(join(dir, "motions", "walk-right", "variants", "red-team", "frames", "01.png"));
    const left = decode(join(dir, "motions", "walk-left", "variants", "red-team", "frames", "01.png"));
    expect([left.width, left.height]).toEqual([right.width, right.height]);
    let differing = 0;
    for (let y = 0; y < right.height; y++) {
      for (let x = 0; x < right.width; x++) {
        for (let c = 0; c < 4; c++) {
          if (right.data[(y * right.width + x) * 4 + c] !== left.data[(y * right.width + (right.width - 1 - x)) * 4 + c]) differing++;
        }
      }
    }
    expect(differing).toBe(0);
    expect(readJson(join(dir, "motions", "walk-left", "variants", "red-team", "atlas.json")).meta.anchorPoint)
      .toEqual(readJson(join(dir, "motions", "walk-left", "atlas.json")).meta.anchorPoint);
  }, 2 * SLOW);

  test("re-running a mirrored, recoloured source retires its colourways and notes the stale mirror, whose own stay", () => {
    const { src, dir } = recolouredKnight();
    projectJson(dir, "add-motion", "--id", "walk-left", "--rows", "2", "--cols", "2", "--fps", "8", "--loop",
      "--source", "mirror", "--direction", "left");
    expect(registerRun(dir, "walk-left", sheet("mirror", join(dir, "motions", "walk-right"), "--name", "walk-left")).code).toBe(0);
    expect(registerRecolor(dir, sheet("recolor", join(dir, "motions", "walk-left"))).code).toBe(0);

    const again = sheet("run", src, "--rows", "2", "--cols", "2", "--out", join(dir, "motions", "walk-right"), "--name", "walk-right",
      "--fps", "8", "--loop", "--pixel", "--no-webp");
    const r = registerRun(dir, "walk-right", again);
    expect(r.code).toBe(0);
    // Both said: the source's colourway files went with its frames, and the
    // mirror flips frames that are gone — and will need its colours again.
    expect(r.err).toMatch(/retired walk-right's red-team colourway files/);
    expect(r.err).toMatch(/walk-left mirrors the frames this run replaced .* then recolor it \(its red-team colourway files go with its old frames\)/);
    expect(motionOf(dir, "walk-right").variants).toBeUndefined();
    expect(doc(dir).assets.some((a: { id: string }) => a.id.startsWith("walk-right-variant-"))).toBe(false);
    // The mirror's colourway still describes the frames registered for it.
    expect(Object.keys(motionOf(dir, "walk-left").variants)).toEqual(["red-team"]);
    const shown = projectJson(dir, "show");
    expect(shown.staleMirrors.map((m: { id: string }) => m.id)).toEqual(["walk-left"]);
    expect(shown.variantsMissing).toEqual([{ motion: "walk-right", variants: ["red-team"] }]);

    // Mirrored again: its old colourway goes with its old frames.
    const mirrored = registerRun(dir, "walk-left", sheet("mirror", join(dir, "motions", "walk-right"), "--name", "walk-left"));
    expect(mirrored.code).toBe(0);
    expect(mirrored.err).toMatch(/retired walk-left's red-team colourway files/);
    expect(motionOf(dir, "walk-left").variants).toBeUndefined();
  }, 2 * SLOW);

  test("a breathe of a pixel still keeps to the pinned palette, so its colourway swaps it whole", () => {
    const { dir } = recolouredKnight();
    mkdirSync(join(dir, "refs"), { recursive: true });
    copyFileSync(join(dir, "motions", "walk-right", "frames", "00.png"), join(dir, "refs", "still.png"));
    projectJson(dir, "add-ref", "--id", "still", "--file", "refs/still.png", "--role", "custom", "--derived-from", "walk-right-frame-00");
    projectJson(dir, "add-motion", "--id", "idle", "--fps", "8", "--source", "breathe");
    const breathed = sheet("breathe", join(dir, "refs", "still.png"), "--out", join(dir, "motions", "idle"), "--name", "idle",
      "--frames", "12", "--no-webp");
    expect({ mode: breathed.mode, modeFrom: breathed.modeFrom }).toEqual({ mode: "pixel", modeFrom: "character.pixel" });
    expect(registerRun(dir, "idle", breathed).code).toBe(0);

    const baked = sheet("recolor", join(dir, "motions", "idle"));
    const idle = baked.motions[0];
    // Whole-pixel moves add no colour: nothing is off the pinned palette,
    // and the recorded colourway's blue is found and swapped.
    expect(idle.offPalette).toBeUndefined();
    expect(baked.warnings.filter((w: string) => w.includes("not in the pinned palette"))).toEqual([]);
    expect(idle.variants[0]).toMatchObject({ name: "red-team", unmatched: [] });
    expect(idle.variants[0].substituted).toBeGreaterThan(0);
    expect(idle.variants[0].frames).toHaveLength(12);
    expect(registerRecolor(dir, baked).code).toBe(0);
    expect(Object.keys(motionOf(dir, "idle").variants)).toEqual(["red-team"]);
  }, 2 * SLOW);

  test("sheet-prompt states the height run --pixel holds the frames to: one field, character.pixel.logicalHeight", () => {
    const ws = fresh();
    const src = pixelSheet(join(ws, "sheet.png"));
    const dir = join(ws, "knight");
    projectJson(dir, "init", "--name", "Knight", "--style", "16-bit pixel art, hard edges.", "--pixel", "28");
    projectJson(dir, "add-motion", "--id", "walk", "--rows", "2", "--cols", "2", "--fps", "8", "--loop");
    const built = projectJson(dir, "sheet-prompt", "--motion", "walk", "--action", "Contact, pass, contact, pass.");
    expect(built.promptParts.guards).toContain("pixel:28");
    expect(built.prompt).toContain("Pixel art, 28 logical pixels tall");
    const walk = sheet("run", src, "--rows", "2", "--cols", "2", "--out", join(dir, "motions", "walk"), "--name", "walk",
      "--fps", "8", "--loop", "--pixel", "--no-webp");
    expect(walk.pixel.logicalHeight).toMatchObject({ declared: 28, honoured: true });
    // Declared again at another height: both follow it.
    projectJson(dir, "set-character", "--pixel", "40");
    expect(projectJson(dir, "sheet-prompt", "--motion", "walk", "--action", "Contact, pass.").prompt).toContain("40 logical pixels tall");
    const missed = sheet("run", src, "--rows", "2", "--cols", "2", "--out", join(dir, "motions", "walk"), "--name", "walk",
      "--fps", "8", "--loop", "--pixel", "--no-webp");
    expect(missed.pixel.logicalHeight).toMatchObject({ declared: 40, honoured: false });
  }, 2 * SLOW);
});

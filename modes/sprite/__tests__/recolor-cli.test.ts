/**
 * Colourways and the declared pixel height, through the CLI.
 *
 * `recolor-palette` / `recolor` (sprite-sheet.mjs), `register-recolor` and
 * the colourway lifecycle (sprite-project.mjs), and `pixel` / `run --pixel`
 * holding frames to `character.pixel.logicalHeight`. The character is real:
 * a 2 x 2 sheet of generated-looking pixel art run through `run --pixel` and
 * registered, so the palette the colourways map from is one the lattice
 * pinned. The swap itself is pinned module-side in recolor.test.ts.
 *
 * Gated on ffmpeg, like every suite that writes images.
 */

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PALETTE, blank, logicalArt, noiseImage, paste, setPixel, upscaledFractional } from "./fixtures/pixel/lattice-art.mjs";
import { RECOLOR_KIND } from "../skill/scripts/recolor.mjs";
import type { RgbaImage } from "../skill/scripts/pixel-lattice.mjs";

const SHEET = join(import.meta.dir, "..", "skill", "scripts", "sprite-sheet.mjs");
const PROJECT = join(import.meta.dir, "..", "skill", "scripts", "sprite-project.mjs");
const HAS_FFMPEG =
  spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0 &&
  spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0;
if (!HAS_FFMPEG) console.warn("(skip) modes/sprite recolor CLI suite — ffmpeg/ffprobe not on PATH");

function cmd(script: string, argv: string[], stdin?: string) {
  const r = Bun.spawnSync([process.execPath, script, ...argv], {
    cwd: import.meta.dir, stdout: "pipe", stderr: "pipe", ...(stdin === undefined ? {} : { stdin: Buffer.from(stdin) }),
  });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
}
function json(script: string, argv: string[], stdin?: string) {
  const r = cmd(script, [...argv, "--json"], stdin);
  if (r.code !== 0) throw new Error(`${argv[0]} failed (${r.code}):\n${r.err}`);
  return JSON.parse(r.out);
}
const sheet = (...argv: string[]) => json(SHEET, argv);
const project = (...argv: string[]) => json(PROJECT, argv);

function writePng(path: string, image: RgbaImage) {
  mkdirSync(join(path, ".."), { recursive: true });
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${image.width}x${image.height}`, "-i", "-", "-frames:v", "1", path], { input: image.data });
  if (r.status !== 0) throw new Error(String(r.stderr));
}
function readPng(path: string): RgbaImage {
  const p = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", path], { encoding: "utf-8" });
  const [width, height] = String(p.stdout).trim().split(",").map(Number);
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", path, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "-"], { maxBuffer: 1 << 28 });
  return { width, height, data: new Uint8Array(r.stdout.subarray(0, width * height * 4)) };
}
const hex = (c: number[]) => `#${c.slice(0, 3).map((v) => v.toString(16).padStart(2, "0")).join("")}`;

const ART = logicalArt(20, 28, 11);
/** A keyed-looking cell: the art at a fractional pitch with a soft rim. */
function cellOf(pitch: number, { art = ART, size = 420, at = [27, 21] } = {}) {
  const sprite = upscaledFractional(art, pitch);
  const frame = blank(size, size);
  paste(frame, sprite, at[0], at[1]);
  for (let x = at[0]; x < at[0] + sprite.width; x++) setPixel(frame, x, at[1] + sprite.height, [40, 40, 40, 100]);
  return frame;
}
/** A 2 x 2 sheet already carrying alpha (so run keys nothing). */
function sheetPng(dir: string) {
  const img = blank(840, 840);
  [13.1, 13.3, 12.9, 13.2].map((p) => cellOf(p)).forEach((c, i) => paste(img, c, (i % 2) * 420, Math.floor(i / 2) * 420));
  const path = join(dir, "sheet.png");
  writePng(path, img);
  return path;
}

const BLUE = hex(PALETTE[2]); // #285ab4 — the art's one blue
const SKIN = hex(PALETTE[0]);

/**
 * A pixel-art character with ready pixel motions (`walk`, and `idle` when
 * asked), each run --pixel from the same sheet and registered — the first
 * run pins the palette.
 */
function pixelCharacter(dir: string, motions = ["walk"], height = 28) {
  const src = sheetPng(dir);
  const char = join(dir, "knight");
  project("init", "--dir", char, "--name", "Knight", "--pixel", String(height));
  for (const id of motions) {
    project("add-motion", "--dir", char, "--id", id, "--label", id, "--rows", "2", "--cols", "2", "--fps", "8", "--loop");
    const run = sheet("run", src, "--rows", "2", "--cols", "2", "--out", join(char, "motions", id), "--name", id, "--fps", "8", "--loop", "--pixel", "--no-webp");
    writeFileSync(join(dir, `${id}.run.json`), JSON.stringify(run));
    project("register-run", "--dir", char, "--motion", id, "--run", join(dir, `${id}.run.json`));
  }
  return { char, src };
}
function writeMap(path: string, variants: unknown[]) {
  writeFileSync(path, JSON.stringify({ kind: RECOLOR_KIND, version: 1, variants }));
  return path;
}
const doc = (char: string) => JSON.parse(readFileSync(join(char, "project.json"), "utf-8"));

const CLI_TIMEOUT = 120_000;
const workspace = () => mkdtempSync(join(tmpdir(), "sprite-recolor-"));

describe.skipIf(!HAS_FFMPEG)("recolor is for palette-pinned pixel art only", () => {
  test("a character that is not pixel art, or has nothing pinned, is refused with the reason", () => {
    const dir = workspace();
    try {
      const char = join(dir, "lumi");
      project("init", "--dir", char, "--name", "Lumi");
      const map = writeMap(join(dir, "map.json"), [{ name: "red-team", map: { [BLUE]: "#b4285a" } }]);
      const painted = cmd(SHEET, ["recolor", char, "--map", map]);
      expect(painted.code).toBe(1);
      expect(painted.err).toContain("Lumi is not pixel art");
      expect(painted.err).toContain("the 64 most used cover 53–55 %");
      expect(cmd(SHEET, ["recolor-palette", char]).err).toContain("not pixel art");
      project("set-character", "--dir", char, "--pixel", "28");
      const unpinned = cmd(SHEET, ["recolor", char, "--map", map]);
      expect(unpinned.err).toContain("has no pinned palette yet");
      expect(cmd(SHEET, ["recolor", join(dir, "nowhere"), "--map", map]).err).toContain("neither a character directory nor one of its motions");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, CLI_TIMEOUT);
});

describe.skipIf(!HAS_FFMPEG)("recolor-palette and recolor", () => {
  test("the draft lists the colours the frames use, most used first, beside a swatch sheet — and never over a map", () => {
    const dir = workspace();
    try {
      const { char } = pixelCharacter(dir);
      const out = sheet("recolor-palette", char);
      expect(out).toMatchObject({ out: join(char, "recolor.json"), swatches: join(char, "recolor-swatches.png"), motions: ["walk"] });
      const draft = JSON.parse(readFileSync(out.out, "utf-8"));
      expect(draft).toMatchObject({ kind: RECOLOR_KIND, palette: "knight-palette", swatches: "recolor-swatches.png", variants: [{ name: "variant-1", map: {} }] });
      const used = draft.colors.filter((c: { pixels: number }) => c.pixels > 0);
      // The art's six colours, every one in the pinned palette, counted in order.
      expect(used.map((c: { hex: string }) => c.hex).sort()).toEqual(PALETTE.map(hex).sort());
      expect(used.every((c: { inPalette?: boolean }) => c.inPalette === undefined)).toBe(true);
      for (let i = 1; i < used.length; i++) expect(used[i - 1].pixels).toBeGreaterThanOrEqual(used[i].pixels);
      expect(used.map((c: { swatch: number }) => c.swatch)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(existsSync(out.swatches)).toBe(true);
      // The draft is scaffolding: recolor refuses its empty colourway.
      expect(cmd(SHEET, ["recolor", char, "--map", out.out]).err).toContain("has an empty map");
      // A second draft would overwrite the colourways written into it.
      expect(cmd(SHEET, ["recolor-palette", char]).err).toContain("already there and may hold colourways");
      expect(sheet("recolor-palette", char, "--force").out).toBe(out.out);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, CLI_TIMEOUT);

  test("an exact swap changes only the mapped colour, keeps alpha and geometry, and reports what it did", () => {
    const dir = workspace();
    try {
      const { char } = pixelCharacter(dir);
      const map = writeMap(join(dir, "map.json"), [
        { name: "red-team", map: { [BLUE]: "#b4285a", "#285ab5": "#000000" } },
        { name: "pale", map: { [SKIN]: "#fff0e0" } },
      ]);
      const out = sheet("recolor", char, "--map", map);
      const motionDir = join(char, "motions", "walk");
      const [walk] = out.motions;
      expect(walk.id).toBe("walk");
      expect(walk.variants.map((v: { name: string }) => v.name)).toEqual(["red-team", "pale"]);
      const red = walk.variants[0];
      expect(red).toMatchObject({
        dir: join(motionDir, "variants", "red-team"),
        sheet: join(motionDir, "variants", "red-team", "sheet.png"),
        atlas: join(motionDir, "variants", "red-team", "atlas.json"),
        gif: join(motionDir, "variants", "red-team", "preview.gif"),
      });

      // Pixel for pixel: the blue became the target, nothing else moved.
      let blue = 0;
      for (const [i, base] of walk.frames.entries()) {
        const a = readPng(base);
        const b = readPng(red.frames[i]);
        expect([b.width, b.height]).toEqual([a.width, a.height]);
        for (let p = 0; p < a.data.length; p += 4) {
          expect(b.data[p + 3]).toBe(a.data[p + 3]);
          const was = hex([a.data[p], a.data[p + 1], a.data[p + 2]]);
          const now = hex([b.data[p], b.data[p + 1], b.data[p + 2]]);
          if (a.data[p + 3] > 8 && was === BLUE) {
            blue++;
            expect(now).toBe("#b4285a");
          } else {
            expect(now).toBe(was);
          }
        }
      }
      expect(blue).toBeGreaterThan(0);
      // The report: every blue pixel swapped, the typo named, the other five colours left and counted.
      expect(red.substituted).toBe(blue);
      expect(red.unmatched).toEqual([{ from: "#285ab5", to: "#000000" }]);
      expect(red.uncovered.colors).toBe(5);
      expect(out.summary[0]).toMatchObject({ name: "red-team", substituted: blue, unmatched: [{ from: "#285ab5", to: "#000000" }] });
      expect(out.warnings.some((w: string) => w.startsWith("red-team: #285ab5 → #000000 matched no pixel of walk"))).toBe(true);
      expect(out.variants).toEqual([
        { name: "red-team", map: { [BLUE]: "#b4285a", "#285ab5": "#000000" } },
        { name: "pale", map: { [SKIN]: "#fff0e0" } },
      ]);

      // Geometry is the motion's own: its atlas, byte for byte (meta.image is sheet.png in both).
      expect(readFileSync(red.atlas, "utf-8")).toBe(readFileSync(join(motionDir, "atlas.json"), "utf-8"));
      // Deterministic bytes: the same bake again writes the same files.
      const before = [red.sheet, red.gif, ...red.frames].map((p: string) => readFileSync(p));
      sheet("recolor", char, "--map", map, "--variant", "red-team");
      [red.sheet, red.gif, ...red.frames].forEach((p: string, i: number) => expect(readFileSync(p).equals(before[i])).toBe(true));

      // A tolerance takes a near colour to the nearest source's target.
      const near = writeMap(join(dir, "near.json"), [{ name: "near", tolerance: 3, map: { "#2a5cb6": "#b4285a" } }]);
      const tol = sheet("recolor", join(char, "motions", "walk"), "--map", near);
      expect(tol.motions[0].variants[0]).toMatchObject({ name: "near", tolerance: 3, substituted: blue, unmatched: [] });
      expect(cmd(SHEET, ["recolor", char, "--map", map, "--variant", "blue-team"]).err).toContain("--variant blue-team: no such colourway");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, CLI_TIMEOUT);
});

describe.skipIf(!HAS_FFMPEG)("register-recolor and the colourway lifecycle", () => {
  test("recorded once on the character, files per motion; a re-run retires a motion's files and the record re-bakes them", () => {
    const dir = workspace();
    try {
      const { char, src } = pixelCharacter(dir, ["walk", "idle"]);
      const map = writeMap(join(dir, "map.json"), [
        { name: "red-team", map: { [BLUE]: "#b4285a" } },
        { name: "blue-team", map: { [SKIN]: "#e0e8ff" } },
      ]);
      const baked = cmd(SHEET, ["recolor", char, "--map", map, "--json"]);
      const registered = json(PROJECT, ["register-recolor", "--dir", char, "--report", "-"], baked.out);
      expect(registered.variants).toEqual(["red-team", "blue-team"]);

      let d = doc(char);
      expect(d.sprite.character.pixel).toEqual({
        logicalHeight: 28, palette: "knight-palette", colors: expect.any(Number),
        variants: [{ name: "red-team", map: { [BLUE]: "#b4285a" } }, { name: "blue-team", map: { [SKIN]: "#e0e8ff" } }],
      });
      const walk = d.sprite.motions.find((m: { id: string }) => m.id === "walk");
      expect(walk.variants["red-team"]).toEqual({ sheet: "walk-variant-red-team-sheet", atlas: "walk-variant-red-team-atlas", gif: "walk-variant-red-team-gif" });
      const asset = (id: string) => d.assets.find((a: { id: string }) => a.id === id);
      expect(asset("walk-variant-red-team-sheet")).toMatchObject({ type: "image", uri: "motions/walk/variants/red-team/sheet.png", metadata: { substituted: expect.any(Number), unmatched: 0, uncovered: 5 } });
      expect(asset("walk-variant-red-team-atlas")).toMatchObject({ type: "text", uri: "motions/walk/variants/red-team/atlas.json" });
      const edge = d.provenance.find((e: { toAssetId: string }) => e.toAssetId === "walk-variant-red-team-sheet");
      expect(edge.fromAssetId).toBe("walk-frame-00");
      expect(edge.operation.params).toMatchObject({ step: "recolor", variant: "red-team", inputs: walk.frames });
      expect(project("show", "--dir", char).motions.find((m: { id: string }) => m.id === "walk").variants).toEqual(["red-team", "blue-team"]);

      // Re-running a motion retires its colourway files, and says so.
      const again = sheet("run", src, "--rows", "2", "--cols", "2", "--out", join(char, "motions", "walk"), "--name", "walk", "--fps", "8", "--loop", "--pixel", "--no-webp");
      writeFileSync(join(dir, "again.json"), JSON.stringify(again));
      const rerun = cmd(PROJECT, ["register-run", "--dir", char, "--motion", "walk", "--run", join(dir, "again.json")]);
      expect(rerun.err).toContain("retired walk's red-team and blue-team colourway files");
      d = doc(char);
      expect(d.sprite.motions.find((m: { id: string }) => m.id === "walk").variants).toBeUndefined();
      expect(d.assets.some((a: { id: string }) => a.id.startsWith("walk-variant-"))).toBe(false);
      expect(project("show", "--dir", char).variantsMissing).toEqual([{ motion: "walk", variants: ["red-team", "blue-team"] }]);

      // Without --map the recorded colourways are baked again.
      const rebaked = cmd(SHEET, ["recolor", join(char, "motions", "walk"), "--json"]);
      expect(JSON.parse(rebaked.out).map).toBeNull();
      json(PROJECT, ["register-recolor", "--dir", char, "--report", "-"], rebaked.out);
      expect(project("show", "--dir", char).variantsMissing).toBeUndefined();

      // A changed map for red-team, baked on walk only: idle's red-team was
      // made with the old one and is retired; its blue-team stays.
      const changed = writeMap(join(dir, "changed.json"), [{ name: "red-team", map: { [BLUE]: "#c03030" } }]);
      const bakedWalk = cmd(SHEET, ["recolor", join(char, "motions", "walk"), "--map", changed, "--json"]);
      const reg = cmd(PROJECT, ["register-recolor", "--dir", char, "--report", "-", "--json"], bakedWalk.out);
      expect(reg.code).toBe(0);
      expect(reg.err).toContain("unregistered idle's red-team colourway files — they were baked with the old map");
      d = doc(char);
      expect(d.sprite.character.pixel.variants.map((v: { name: string }) => v.name)).toEqual(["red-team", "blue-team"]);
      expect(d.sprite.character.pixel.variants[0].map).toEqual({ [BLUE]: "#c03030" });
      expect(Object.keys(d.sprite.motions.find((m: { id: string }) => m.id === "idle").variants)).toEqual(["blue-team"]);
      expect(project("show", "--dir", char).variantsMissing).toEqual([{ motion: "idle", variants: ["red-team"] }]);

      // A report whose frames are not the registered ones is refused.
      const stale = JSON.parse(bakedWalk.out);
      stale.motions[0].frames = stale.motions[0].frames.slice(1);
      expect(cmd(PROJECT, ["register-recolor", "--dir", char, "--report", "-"], JSON.stringify(stale)).err).toContain("not the ones registered for it");

      // --remove-variant drops a colourway and its files; --no-pixel drops them all.
      const removed = cmd(PROJECT, ["set-character", "--dir", char, "--remove-variant", "blue-team"]);
      expect(removed.code).toBe(0);
      d = doc(char);
      expect(d.sprite.character.pixel.variants.map((v: { name: string }) => v.name)).toEqual(["red-team"]);
      expect(d.assets.some((a: { id: string }) => a.id.includes("-variant-blue-team-"))).toBe(false);
      expect(cmd(PROJECT, ["set-character", "--dir", char, "--remove-variant", "green"]).err).toContain("no colourway green");
      cmd(PROJECT, ["set-character", "--dir", char, "--no-pixel"]);
      d = doc(char);
      expect(d.sprite.character.pixel).toBeUndefined();
      expect(d.assets.some((a: { id: string }) => a.id.includes("-variant-"))).toBe(false);
      expect(d.sprite.motions.every((m: { variants?: unknown }) => m.variants === undefined)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, CLI_TIMEOUT);
});

describe.skipIf(!HAS_FFMPEG)("the declared pixel height", () => {
  test("pixel --logical-height: frames that honour it are held, frames that miss it are said, never squashed", () => {
    const dir = workspace();
    try {
      [13.1, 13.3, 12.9, 13.2].forEach((p, i) => writePng(join(dir, "cells", `0${i}.png`), cellOf(p)));
      const held = sheet("pixel", join(dir, "cells"), "--out", join(dir, "px"), "--logical-height", "28");
      expect(held.logicalHeight).toEqual({ declared: 28, measured: 28, range: [28, 28], honoured: true, pitchFrom: "measured" });
      expect(held.warnings.some((w: string) => w.startsWith("logical height"))).toBe(false);
      expect(JSON.parse(readFileSync(join(dir, "px", "pixel.json"), "utf-8")).logicalHeight).toEqual(held.logicalHeight);

      const missed = sheet("pixel", join(dir, "cells"), "--out", join(dir, "px"), "--logical-height", "40");
      expect(missed.logicalHeight).toMatchObject({ declared: 40, measured: 28, honoured: false });
      // The frames keep their drawn blocks: the same 20 x 28 sprites as before.
      for (const f of missed.perFrame) expect(f.logical).toEqual({ width: 20, height: 28 });
      const said = missed.warnings.find((w: string) => w.startsWith("logical height"));
      expect(said).toContain("these frames snap to 28 logical px tall");
      expect(said).toContain("declare it (sprite-project.mjs set-character --pixel 28)");
      // Within 5 % (at least a pixel) is the height.
      expect(sheet("pixel", join(dir, "cells"), "--out", join(dir, "px"), "--logical-height", "29").logicalHeight.honoured).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, CLI_TIMEOUT);

  test("with too few frames reading a grid, the declared height's pitch stands in for --pitch-hint only when the frames back it", () => {
    const dir = workspace();
    try {
      // One frame reads its grid; two are noise the size of the sprite (264 x 370).
      writePng(join(dir, "cells", "00.png"), cellOf(13.2));
      for (const i of [1, 2]) {
        const cell = blank(420, 420);
        paste(cell, noiseImage(264, 370, 4 + i), 27, 21);
        writePng(join(dir, "cells", `0${i}.png`), cell);
      }
      const out = sheet("pixel", join(dir, "cells"), "--out", join(dir, "px"), "--logical-height", "28");
      expect(out.pitch.y).toBeCloseTo(370 / 28, 1);
      expect(out.perFrame.map((f: { source: string }) => f.source)).toEqual(["own", "consensus", "consensus"]);
      expect(out.logicalHeight).toMatchObject({ declared: 28, honoured: true, pitchFrom: "height" });
      expect(out.warnings[0]).toContain("cut at 13.21 px, the block size at which these frames (370 px tall) are the declared 28 logical px");
      expect(out.warnings.some((w: string) => w.includes("snapped at the declared height's pitch 13.21"))).toBe(true);

      // A height the frames do not back is not cut at: it is named in the refusal.
      const refused = cmd(SHEET, ["pixel", join(dir, "cells"), "--out", join(dir, "px"), "--logical-height", "18"]);
      expect(refused.code).toBe(1);
      expect(refused.err).toContain("The declared height (18 logical px) would mean 20.56 px blocks for frames 370 px tall, which the frames do not back");
      // An explicit hint is still the agent's reading, and wins.
      expect(sheet("pixel", join(dir, "cells"), "--out", join(dir, "px"), "--logical-height", "18", "--pitch-hint", "13").logicalHeight).toMatchObject({ pitchFrom: "hint", honoured: false });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, CLI_TIMEOUT);

  test("run --pixel holds every run of a character to character.pixel.logicalHeight", () => {
    const dir = workspace();
    try {
      const { char } = pixelCharacter(dir, ["walk"], 28);
      const walk = JSON.parse(readFileSync(join(dir, "walk.run.json"), "utf-8"));
      expect(walk.pixel.logicalHeight).toMatchObject({ declared: 28, measured: 28, honoured: true });
      project("set-character", "--dir", char, "--pixel", "40");
      const src = join(dir, "sheet.png");
      const idle = sheet("run", src, "--rows", "2", "--cols", "2", "--out", join(char, "motions", "idle"), "--name", "idle", "--fps", "8", "--pixel", "--no-webp");
      expect(idle.pixel.logicalHeight).toMatchObject({ declared: 40, measured: 28, honoured: false });
      expect(idle.warnings.some((w: string) => w.startsWith("logical height: these frames snap to 28"))).toBe(true);
      // --logical-height overrides the character's, and belongs to the lattice.
      expect(sheet("run", src, "--rows", "2", "--cols", "2", "--out", join(char, "motions", "idle"), "--name", "idle", "--fps", "8", "--pixel", "--no-webp", "--logical-height", "28").pixel.logicalHeight.honoured).toBe(true);
      expect(cmd(SHEET, ["run", src, "--rows", "2", "--cols", "2", "--out", join(char, "motions", "idle"), "--name", "idle", "--fps", "8", "--logical-height", "28"]).err).toContain("--logical-height belongs to the pixel lattice — add --pixel");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, CLI_TIMEOUT);
});

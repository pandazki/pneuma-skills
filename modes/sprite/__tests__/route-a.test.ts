/**
 * Route A — "bring my picture to life": one uploaded picture becomes a ready,
 * breathing idle with no model call past the cut-out.
 *
 * Three layers, each pinned where it lives:
 *   1. `still.mjs` — trimming a cut-out to the character plus a pad and
 *      bringing it down to the size it plays at, in premultiplied alpha.
 *   2. `sprite-sheet.mjs fit` and `breathe --name` — the still, then the whole
 *      motion in one command, whose JSON is the run summary register-run takes.
 *   3. The flow through `sprite-project.mjs`: upload → cut-out reference →
 *      breathe → register-run → a ready motion whose provenance reads
 *      frames ← alpha still ← upload; a re-run with other parameters replaces
 *      the frames and the record in place.
 *
 * Layers 2 and 3 need ffmpeg and skip without it, like every CLI suite here.
 */

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { analyzeAnatomy, type RgbaImage } from "../skill/scripts/breathe.mjs";
import { DEFAULT_FIT_MAX, StillError, downscaleArea, fitStill, padRgba } from "../skill/scripts/still.mjs";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function canvas(width: number, height: number): RgbaImage {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

const pixel = (image: RgbaImage, x: number, y: number) =>
  Array.from(image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4));

/**
 * An anti-aliased character (head, neck, widening body, two feet), supersampled
 * 4×4, drawn at `scale` and offset by (`ox`, `oy`) on a `w`×`h` canvas. With
 * `pole`, a thin prop stands beside the body across the neck — the shape the
 * breathe detector warns about (Lumi's lantern).
 */
function character({ w = 160, h = 220, ox = 20, oy = 25, scale = 1, pole = false } = {}): RgbaImage {
  const im = canvas(w, h);
  const s = scale;
  const shapes: Array<{ inside: (x: number, y: number) => boolean; c: [number, number, number] }> = [
    { inside: (x, y) => ((x - 60 * s) / (26 * s)) ** 2 + ((y - 42 * s) / (28 * s)) ** 2 <= 1, c: [236, 222, 200] },
    { inside: (x, y) => x >= 53 * s && x <= 67 * s && y >= 68 * s && y <= 80 * s, c: [236, 222, 200] },
    {
      inside: (x, y) => {
        const t = (y - 78 * s) / (70 * s);
        return y >= 78 * s && y <= 148 * s && Math.abs(x - 60 * s) <= (20 + 20 * t) * s;
      },
      c: [220, 200, 170],
    },
    { inside: (x, y) => y > 148 * s && y <= 160 * s && ((x >= 44 * s && x <= 54 * s) || (x >= 66 * s && x <= 76 * s)), c: [90, 60, 40] },
    ...(pole ? [{ inside: (x: number, y: number) => x >= 104 * s && x <= 110 * s && y >= 50 * s && y <= 120 * s, c: [200, 80, 40] as [number, number, number] }] : []),
  ];
  const S = 4;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let a = 0, r = 0, g = 0, b = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const px = x - ox + (sx + 0.5) / S, py = y - oy + (sy + 0.5) / S;
          let hit: [number, number, number] | null = null;
          for (const shape of shapes) if (shape.inside(px, py)) hit = shape.c;
          if (!hit) continue;
          a++; r += hit[0]; g += hit[1]; b += hit[2];
        }
      }
      if (!a) continue;
      im.data.set([Math.round(r / a), Math.round(g / a), Math.round(b / a), Math.round((255 * a) / (S * S))], (y * w + x) * 4);
    }
  }
  return im;
}

// ---------------------------------------------------------------------------
// 1. still.mjs
// ---------------------------------------------------------------------------

describe("still.mjs — the still at the size it plays", () => {
  test("trims to the character plus the pad, and never enlarges", () => {
    const image = character();
    const box = { x: 30, y: 40, w: 50, h: 90 };
    const fitted = fitStill(image, { box, max: 400, pad: 6 });
    expect(fitted.scale).toBe(1);
    expect(fitted.needed).toBe(1);
    expect([fitted.image.width, fitted.image.height]).toEqual([62, 102]);
    // The box's top-left pixel lands at (pad, pad), untouched.
    expect(pixel(fitted.image, 6, 6)).toEqual(pixel(image, 30, 40));
    // The pad is transparent, colour included.
    expect(pixel(fitted.image, 2, 2)).toEqual([0, 0, 0, 0]);
  });

  test("brings the larger side down to max, and says what it would have needed when it may not resample", () => {
    const image = character({ w: 320, h: 440, scale: 2, ox: 40, oy: 50 });
    const box = { x: 40, y: 50, w: 240, h: 330 };
    const fitted = fitStill(image, { box, max: 110, pad: 8 });
    expect(fitted.scale).toBeCloseTo(110 / 330, 6);
    expect(fitted.character).toEqual({ width: 80, height: 110 });
    expect([fitted.image.width, fitted.image.height]).toEqual([96, 126]);
    const kept = fitStill(image, { box, max: 110, pad: 8, resample: false });
    expect(kept.scale).toBe(1);
    expect(kept.needed).toBeCloseTo(110 / 330, 6);
    expect(kept.character).toEqual({ width: 240, height: 330 });
    expect(DEFAULT_FIT_MAX).toBe(480);
  });

  test("resamples in premultiplied alpha: colour under alpha 0 never bleeds into the edge", () => {
    // A red disc whose transparent surroundings carry pure green — what a
    // background remover can leave under alpha 0.
    const im = canvas(64, 64);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const d = Math.hypot(x + 0.5 - 32, y + 0.5 - 32);
        const a = Math.max(0, Math.min(1, 20 - d));
        im.data.set([a > 0 ? 220 : 0, a > 0 ? 0 : 255, 0, Math.round(255 * a)], (y * 64 + x) * 4);
      }
    }
    const small = downscaleArea(im, 21, 21);
    let visible = 0;
    for (let k = 0; k < 21 * 21; k++) {
      const [r, g, b, a] = small.data.subarray(k * 4, k * 4 + 4);
      if (!a) {
        expect([r, g, b]).toEqual([0, 0, 0]);
        continue;
      }
      visible++;
      expect({ k, g, b }).toEqual({ k, g: 0, b: 0 });
      expect(r).toBe(220);
    }
    expect(visible).toBeGreaterThan(100);
    // A reduction's weights sum to one: an opaque image stays opaque.
    const solid = padRgba(canvas(1, 1), 0);
    solid.data.set([10, 20, 30, 255]);
    expect(Array.from(downscaleArea({ width: 1, height: 1, data: solid.data }, 1, 1).data)).toEqual([10, 20, 30, 255]);
  });

  test("refuses to enlarge, an empty box, and a nonsense max", () => {
    expect(() => downscaleArea(canvas(10, 10), 20, 10)).toThrow(StillError);
    expect(() => fitStill(canvas(10, 10), { box: { x: 0, y: 0, w: 0, h: 5 } })).toThrow(/nothing visible/);
    expect(() => fitStill(canvas(10, 10), { box: { x: 0, y: 0, w: 5, h: 5 }, max: 2.5 })).toThrow(/max must be/);
  });
});

// ---------------------------------------------------------------------------
// 2–3. The CLIs, and the flow through project.json
// ---------------------------------------------------------------------------

const SCRIPTS = join(import.meta.dir, "..", "skill", "scripts");
const SHEET = join(SCRIPTS, "sprite-sheet.mjs");
const PROJECT = join(SCRIPTS, "sprite-project.mjs");
const HAS_FFMPEG =
  spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0 &&
  spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0;
if (!HAS_FFMPEG) console.warn("(skip) modes/sprite route A CLI — ffmpeg/ffprobe not on PATH");

/** Run a script with its cwd pinned (a Bun child reads the cwd's .env). */
function run(cwd: string, script: string, argv: string[], stdin?: string) {
  const r = Bun.spawnSync([process.execPath, script, ...argv], {
    cwd, stdout: "pipe", stderr: "pipe", ...(stdin === undefined ? {} : { stdin: Buffer.from(stdin) }),
  });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
}

function ok(cwd: string, script: string, argv: string[], stdin?: string) {
  const r = run(cwd, script, [...argv, "--json"], stdin);
  if (r.code !== 0) throw new Error(`${argv[0]} failed (${r.code}):\n${r.err}`);
  return { json: JSON.parse(r.out), raw: r.out, err: r.err };
}

function writePng(path: string, image: RgbaImage) {
  mkdirSync(join(path, ".."), { recursive: true });
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${image.width}x${image.height}`,
    "-i", "-", "-frames:v", "1", "-pix_fmt", "rgba", path], { input: image.data });
  if (r.status !== 0) throw new Error(`could not write ${path}: ${r.stderr}`);
}

function readPng(path: string): RgbaImage {
  const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", path], { encoding: "utf-8" });
  const [width, height] = String(probe.stdout).trim().split(",").map(Number);
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", path, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "-"], { maxBuffer: 1 << 28 });
  return { width, height, data: new Uint8Array(r.stdout) };
}

const readProject = (dir: string) => JSON.parse(readFileSync(join(dir, "project.json"), "utf-8"));
const edgeTo = (doc: any, id: string) => doc.provenance.find((e: any) => e.toAssetId === id);

describe.skipIf(!HAS_FFMPEG)("sprite-sheet.mjs fit", () => {
  const root = mkdtempSync(join(tmpdir(), "route-a-fit-"));

  test("trims a cut-out to the character plus the pad, drops a speck, and reports the box it kept", () => {
    const image = character({ w: 200, h: 240 });
    // A background remover's leftover, clear above the head.
    for (let y = 2; y < 5; y++) for (let x = 150; x < 153; x++) image.data.set([40, 40, 40, 255], (y * 200 + x) * 4);
    const input = join(root, "cut.png");
    writePng(input, image);
    const { json } = ok(root, SHEET, ["fit", input, "--out", join(root, "still.png"), "--pad", "8"]);
    expect(json.scale).toBe(1);
    expect(json.cleaned).toEqual({ removedComponents: 1, removedPixels: 9 });
    const out = readPng(join(root, "still.png"));
    expect([out.width, out.height]).toEqual([json.width, json.height]);
    expect([json.width, json.height]).toEqual([json.box.w + 16, json.box.h + 16]);
    // The character, not the speck, decides the box.
    expect(json.box.y).toBeGreaterThan(5);
    expect(json.warnings).toEqual([]);
  }, 30_000);

  test("brings a large character down to --max, in place when --out is the input", () => {
    const input = join(root, "big.png");
    writePng(input, character({ w: 360, h: 460, scale: 2.5, ox: 20, oy: 20 }));
    const { json } = ok(root, SHEET, ["fit", input, "--out", input, "--max", "120"]);
    expect(Math.max(json.character.width, json.character.height)).toBe(120);
    expect(json.scale).toBeLessThan(1);
    const out = readPng(input);
    expect(Math.max(out.width, out.height)).toBe(120 + 2 * 8);
  }, 30_000);

  test("refuses a picture with no transparent background, and warns about a character cut by its own edge", () => {
    const opaque = canvas(40, 40);
    opaque.data.fill(200);
    writePng(join(root, "opaque.png"), opaque);
    const refused = run(root, SHEET, ["fit", join(root, "opaque.png"), "--out", join(root, "o.png")]);
    expect(refused.code).toBe(1);
    expect(refused.err).toMatch(/no transparent background .* cut the character out first: remove-background\.mjs/);
    expect(existsSync(join(root, "o.png"))).toBe(false);

    // Feet running off the bottom of the picture.
    writePng(join(root, "cropped.png"), character({ w: 160, h: 170 }));
    const { json } = ok(root, SHEET, ["fit", join(root, "cropped.png"), "--out", join(root, "c.png")]);
    expect(json.warnings.join("\n")).toMatch(/touches the bottom edge of the image/);
  }, 30_000);

  test("pixel art is trimmed, never resampled, and says so", () => {
    const character_ = join(root, "pix");
    mkdirSync(join(character_, "refs"), { recursive: true });
    writeFileSync(join(character_, "project.json"), JSON.stringify({ sprite: { character: { name: "P", style: "", pixel: { logicalHeight: 32 } }, motions: [] } }));
    writePng(join(character_, "refs", "up.png"), character({ w: 320, h: 440, scale: 2, ox: 20, oy: 20 }));
    const { json } = ok(root, SHEET, ["fit", join(character_, "refs", "up.png"), "--out", join(character_, "refs", "still.png"), "--max", "100"]);
    expect(json.pixelArt).toBe(true);
    expect(json.scale).toBe(1);
    expect(json.notes.join("\n")).toMatch(/character\.pixel says pixel art, which is never resampled/);
  }, 30_000);

  test("cleanup", () => {
    rmSync(root, { recursive: true, force: true });
    expect(existsSync(root)).toBe(false);
  });
});

describe.skipIf(!HAS_FFMPEG)("sprite-sheet.mjs breathe --name", () => {
  const root = mkdtempSync(join(tmpdir(), "route-a-breathe-"));
  const still = join(root, "still.png");
  writePng(still, character({ pole: true }));

  test("cuts the whole motion and prints the run summary register-run takes", () => {
    const motionDir = join(root, "idle");
    const { json } = ok(root, SHEET, ["breathe", still, "--out", motionDir, "--name", "idle", "--mode", "smooth"]);
    const a = analyzeAnatomy(character({ pole: true }));
    expect(json.source).toBe("breathe");
    expect(json.still).toBe(still);
    expect(json.breathe).toEqual({
      depth: 0.02, breaths: 1, lag: 0.1, mode: "smooth",
      anatomy: { rigidRow: a.box.y0 + a.rigidRow, axisX: a.box.x0 + a.axisX, from: "detected" },
    });
    // A sprite run: frames, sheet, atlas, GIF (+webp), inspect — at 8 fps, looping.
    expect(json.frames).toHaveLength(12);
    expect(json.frames[0]).toBe(join(motionDir, "frames", "00.png"));
    for (const key of ["sheet", "atlas", "gif", "webp"]) expect(existsSync(json[key])).toBe(true);
    expect({ fps: json.fps, loop: json.loop, xFrom: json.xFrom, grid: json.grid }).toEqual({ fps: 8, loop: true, xFrom: "cell", grid: { rows: 3, cols: 4 } });
    // The cell is what the frames reach plus the pad, not the still's canvas.
    expect(json.cell.width).toBeLessThan(160);
    // The prop across the neck asks for a decision: it goes where the stage
    // shows warnings. How the anatomy was read is a note.
    expect(json.inspect.warnings.join("\n")).toMatch(/crosses the rigid row .* --rigid-row \d+ keeps it whole/);
    expect(json.inspect.warnings.join("\n")).not.toMatch(/face-absent/);
    expect(json.notes.join("\n")).toMatch(/face-absent/);
    expect(json.inspect.bodyDrift).toBeLessThan(0.5);
    expect(json.inspect.warnings.join("\n")).not.toMatch(/clipped/);
    // Written where a bare `inspect` finds it, with the same warnings.
    const onDisk = JSON.parse(readFileSync(join(motionDir, "inspect.json"), "utf-8"));
    expect(onDisk.warnings).toEqual(json.inspect.warnings);
  }, 60_000);

  test("the frames-only form is unchanged, and refuses the motion's flags without --name", () => {
    const stray = run(root, SHEET, ["breathe", still, "--out", join(root, "x", "cells"), "--mode", "smooth", "--fps", "10"]);
    expect(stray.code).toBe(1);
    expect(stray.err).toMatch(/--fps cuts a motion — pass --name <motionId>/);
    const bare = ok(root, SHEET, ["breathe", still, "--out", join(root, "x", "cells"), "--mode", "smooth"]).json;
    expect("source" in bare).toBe(false);
    expect(bare.frames[0]).toBe(join(root, "x", "cells", "00.png"));
  }, 30_000);

  test("refuses a still that is one of the frames the run rewrites", () => {
    const motionDir = join(root, "idle");
    const r = run(root, SHEET, ["breathe", join(motionDir, "frames", "00.png"), "--out", motionDir, "--name", "idle", "--mode", "smooth"]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/is a frame of .* which this run rewrites/);
    expect(existsSync(join(motionDir, "frames", "00.png"))).toBe(true);
  }, 30_000);

  test("cleanup", () => {
    rmSync(root, { recursive: true, force: true });
    expect(existsSync(root)).toBe(false);
  });
});

describe.skipIf(!HAS_FFMPEG)("route A through project.json", () => {
  const root = mkdtempSync(join(tmpdir(), "route-a-flow-"));
  const dir = join(root, "pip");
  const P = (...argv: string[]) => ok(root, PROJECT, [argv[0], "--dir", dir, ...argv.slice(1)]).json;
  /** `breathe --name … --json | register-run --run -`, the documented pipe. */
  const breatheAndRegister = (...flags: string[]) => {
    const breathe = ok(root, SHEET, ["breathe", join(dir, "refs", "still.png"), "--out", join(dir, "motions", "idle"), "--name", "idle", ...flags]);
    const registered = ok(root, PROJECT, ["register-run", "--dir", dir, "--motion", "idle", "--run", "-"], breathe.raw);
    return { run: breathe.json, motion: registered.json, err: registered.err };
  };

  test("upload → cut-out reference → breathe → a ready motion, frames ← alpha still ← upload", () => {
    P("init", "--name", "Pip", "--style", "Soft painted storybook art", "--purpose", "animate");
    // The upload, as the user brought it: a big canvas, the character small in it.
    writePng(join(dir, "refs", "upload.png"), character({ w: 400, h: 520, scale: 2.2, ox: 60, oy: 70 }));
    P("add-ref", "--id", "upload", "--file", "refs/upload.png", "--role", "custom", "--uploaded");
    const fitted = ok(root, SHEET, ["fit", join(dir, "refs", "upload.png"), "--out", join(dir, "refs", "still.png"), "--max", "200"]).json;
    expect(Math.max(fitted.character.width, fitted.character.height)).toBe(200);
    P("add-ref", "--id", "still", "--file", "refs/still.png", "--role", "custom", "--derived-from", "upload", "--op", "key");
    // A breathe is drawn on no grid and timed by its run: neither is asked for.
    const planned = P("add-motion", "--id", "idle", "--label", "Idle", "--source", "breathe");
    expect(planned.grid).toEqual({ rows: 1, cols: 1 });

    const { run: summary, motion } = breatheAndRegister();
    expect(motion).toMatchObject({ id: "idle", source: "breathe", status: "ready", fps: 8, loop: true, grid: summary.grid });
    expect(motion.frames).toEqual(Array.from({ length: 12 }, (_, i) => `idle-frame-${String(i).padStart(2, "0")}`));
    // The head-offset extremes the run reported at its top level ride along.
    // (Plain checks: Bun 1.4's toMatchObject writes asymmetric matchers into
    // the object it was given, and this one is compared again below.)
    const { min, max, travel, highest, lowest } = summary.headOffset;
    expect({ travel, highest: Array.isArray(highest), lowest: Array.isArray(lowest) }).toEqual({ travel: max - min, highest: true, lowest: true });
    expect(motion.breathe).toEqual({ still: "ref-still", ...summary.breathe, headOffset: summary.headOffset });
    expect(motion.inspect.cell).toEqual(summary.cell);

    const doc = readProject(dir);
    // frames ← alpha still ← upload, each edge saying what happened.
    const frameEdge = edgeTo(doc, "idle-frame-05");
    expect(frameEdge.fromAssetId).toBe("ref-still");
    expect(frameEdge.operation.params).toMatchObject({ tool: "sprite-sheet.mjs", step: "breathe", frameIndex: 5, depth: 0.02, breaths: 1, mode: "smooth" });
    const stillEdge = edgeTo(doc, "ref-still");
    expect(stillEdge.fromAssetId).toBe("ref-upload");
    expect(stillEdge.operation.type).toBe("derive");
    expect(stillEdge.operation.params).toMatchObject({ op: "key" });
    const uploadEdge = edgeTo(doc, "ref-upload");
    expect(uploadEdge.fromAssetId).toBeNull();
    expect(uploadEdge.operation).toMatchObject({ type: "upload", actor: "human" });
    // The packed trio hangs off the frames.
    expect(edgeTo(doc, "idle-gif").operation.params.inputs).toEqual(motion.frames);

    // `show` names the still by id and path, and the parameters to re-run from.
    const shown = run(root, PROJECT, ["show", "--dir", dir, "--motion", "idle"]);
    expect(shown.out).toContain(`breathe of ref-still (refs/still.png): depth 0.02, 1 breath, lag 0.1, smooth, rigid row ${summary.breathe.anatomy.rigidRow}, axis ${summary.breathe.anatomy.axisX} (detected)`);
    // …and how far the head rides, as `breathe` itself said it.
    const h = summary.headOffset;
    const signed = (v: number) => (v > 0 ? `+${v}` : String(v));
    expect(shown.out).toContain(`  head offset ${signed(h.min)}..${signed(h.max)}px (travel ${h.travel}px: highest in frame ${h.highest.join(", ")}, lowest in ${h.lowest.join(", ")})`);
  }, 90_000);

  test("a re-run with other parameters replaces the frames, the record, the grid and the rate in place", () => {
    const before = readProject(dir);
    const rigid = before.sprite.motions[0].breathe.anatomy.rigidRow;
    const { run: summary, motion } = breatheAndRegister("--depth", "0.03", "--frames", "8", "--fps", "6", "--rigid-row", String(rigid + 4), "--torso", "30");
    expect(motion.frames).toHaveLength(8);
    expect(motion.breathe).toEqual({
      still: "ref-still", depth: 0.03, breaths: 1, lag: 0.1, mode: "smooth",
      anatomy: { rigidRow: rigid + 4, axisX: summary.breathe.anatomy.axisX, from: "override", torsoHalf: 30 },
      headOffset: summary.headOffset,
    });
    expect({ grid: motion.grid, fps: motion.fps }).toEqual({ grid: { rows: 3, cols: 3 }, fps: 6 });

    const doc = readProject(dir);
    // The old tail is gone from the file and from disk; the rest was rewritten in place.
    expect(doc.assets.filter((a: any) => a.id.startsWith("idle-frame-")).map((a: any) => a.id)).toEqual(motion.frames);
    expect(readdirSync(join(dir, "motions", "idle", "frames")).filter((n) => /^\d\d\.png$/.test(n))).toHaveLength(8);
    expect(edgeTo(doc, "idle-frame-07").operation.params).toMatchObject({ depth: 0.03, frameIndex: 7 });
    expect(doc.assets.filter((a: any) => a.id === "idle-frame-00")).toHaveLength(1);
    // The still and the upload are untouched by the re-run.
    expect(edgeTo(doc, "ref-still").fromAssetId).toBe("ref-upload");
    expect(doc.sprite.motions).toHaveLength(1);
  }, 90_000);

  test("an empty summary (the breathe before the pipe failed) is said as such, and nothing changes", () => {
    const before = readFileSync(join(dir, "project.json"), "utf-8");
    const r = run(root, PROJECT, ["register-run", "--dir", dir, "--motion", "idle", "--run", "-"], "");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/the run summary is empty .* it failed/);
    expect(readFileSync(join(dir, "project.json"), "utf-8")).toBe(before);
  }, 30_000);

  test("cleanup", () => {
    rmSync(root, { recursive: true, force: true });
    expect(existsSync(root)).toBe(false);
  });
});

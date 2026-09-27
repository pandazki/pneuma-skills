/**
 * The un-mixing keyer as the agent meets it: `sprite-sheet.mjs` run as a real
 * process on clips and sheets drawn by ffmpeg at test time. Which keyer runs
 * (`--keyer unmix|colorkey`, and the fallback for a plate with no hue), what
 * the reports carry (`keyer`, `keyResidue`, the residue warning), where
 * `inspect` finds the plate it measures against, and `flatten`'s check of the
 * subject against the plate it is about to be painted on.
 *
 * The keyer's maths is pinned on synthetic buffers in `chroma.test.ts`; this
 * file only asks whether the pixels a user ships went through it. Skips with
 * a named reason when ffmpeg is missing.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "..", "skill", "scripts", "sprite-sheet.mjs");

const HAS_FFMPEG =
  spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0 &&
  spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0;
if (!HAS_FFMPEG) console.warn("(skip) modes/sprite chroma CLI suite — ffmpeg/ffprobe not on PATH");

const workspaces: string[] = [];
function fresh() {
  const dir = mkdtempSync(join(tmpdir(), "sprite-chroma-"));
  workspaces.push(dir);
  return dir;
}

function run(...argv: string[]) {
  const r = Bun.spawnSync([process.execPath, SCRIPT, ...argv], { stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
}

function runJson(...argv: string[]) {
  const r = run(...argv, "--json");
  if (r.code !== 0) throw new Error(`sprite-sheet ${argv[0]} exited ${r.code}\n${r.err}`);
  return { json: JSON.parse(r.out), err: r.err };
}

/** Render a lavfi graph to `out` (h264 yuv420p for .mp4, rgba for .png). */
function lavfi(out: string, graph: string) {
  const encode = out.endsWith(".mp4")
    ? ["-c:v", "libx264", "-pix_fmt", "yuv420p"]
    : ["-frames:v", "1", "-pix_fmt", "rgba"];
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", graph, ...encode, out], { encoding: "utf-8" });
  if (r.status !== 0) throw new Error(`fixture ffmpeg failed: ${r.stderr}`);
  return out;
}

function decode(path: string) {
  const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", path], { encoding: "utf-8" });
  const [width, height] = probe.stdout.trim().split(",").map(Number);
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", path, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "-"], { maxBuffer: 64 << 20 });
  return { width, height, data: r.stdout as Buffer };
}

/** Mean colour of the fully opaque pixels of one image. */
function opaqueMean(path: string) {
  const { data } = decode(path);
  let n = 0;
  const sum = [0, 0, 0];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] !== 255) continue;
    n++;
    for (let c = 0; c < 3; c++) sum[c] += data[i + c];
  }
  return sum.map((v) => v / n);
}

/** A white square on broadcast green whose edge is SOFT (a 1.5 px blur): the
 *  ramp of white-and-green blends a colorkey keeps half green. */
const softClip = (dir: string) => lavfi(join(dir, "soft.mp4"),
  "color=c=0x00b140:s=64x64:d=1:r=10[bg];color=c=white:s=24x24:d=1:r=10[box];"
  + "[bg][box]overlay=x=20:y='18+2*sin(2*PI*t)',gblur=sigma=1.5");

/** A sharp white square bobbing on broadcast green, 24 frames at 24 fps. */
const whiteLoopClip = (dir: string) => lavfi(join(dir, "white.mp4"),
  "color=c=0x00b140:s=64x64:d=1:r=24[bg];color=c=white:s=20x20:d=1:r=24[box];"
  + "[bg][box]overlay=x=22:y='20+4*sin(2*PI*t)'");

describe.skipIf(!HAS_FFMPEG)("sprite-sheet.mjs --keyer", () => {
  test("from-video: the soft edge colorkey leaves green comes out clean, and the report says which ran", () => {
    const ws = fresh();
    const clip = softClip(ws);
    const unmix = runJson("from-video", clip, "--out", join(ws, "unmix"), "--name", "hop", "--frames", "4", "--loop").json;
    const colorkey = runJson("from-video", clip, "--out", join(ws, "colorkey"), "--name", "hop", "--frames", "4", "--loop", "--keyer", "colorkey").json;

    expect(unmix.keyer).toBe("unmix");
    expect(colorkey.keyer).toBe("colorkey");
    // The plate measured over the samples, not the ideal green.
    expect(unmix.keyColor).toMatch(/^#0[01]b[01]4[01]$/);

    expect(unmix.inspect.keyResidue).toBe(0);
    expect(unmix.warnings.some((w: string) => w.startsWith("keyResidue"))).toBe(false);
    expect(colorkey.inspect.keyResidue).toBeGreaterThan(0.05);
    expect(colorkey.warnings.some((w: string) => w.startsWith(`keyResidue ${colorkey.inspect.keyResidue}`))).toBe(true);

    // The report on disk carries what `inspect` re-reads later.
    const report = JSON.parse(readFileSync(join(ws, "colorkey", "inspect.json"), "utf-8"));
    expect(report.keyColor).toBe(colorkey.keyColor);
    expect(report.keyResidue).toBe(colorkey.inspect.keyResidue);
    expect(typeof report.keyResidueEdge).toBe("number");

    // The shipped cells are keyed either way: no plate colour hides under alpha 0.
    const cell = decode(join(ws, "unmix", "cells", "00.png")).data;
    for (let i = 0; i < cell.length; i += 4) {
      if (cell[i + 3] >= 16) continue;
      expect([cell[i], cell[i + 1], cell[i + 2]]).toEqual([0, 0, 0]);
    }
  }, 30_000);

  test("loop: a white subject stays white — the colorkey chain's despill turned it pink", () => {
    const ws = fresh();
    const clip = whiteLoopClip(ws);
    const unmix = runJson("loop", clip, "--out", join(ws, "unmix"), "--name", "bob", "--formats", "webm").json;
    const colorkey = runJson("loop", clip, "--out", join(ws, "colorkey"), "--name", "bob", "--formats", "webm", "--keyer", "colorkey").json;

    expect(unmix.keyer).toBe("unmix");
    expect("despill" in unmix).toBe(false);
    expect(colorkey).toMatchObject({ keyer: "colorkey", despill: "green" });

    const [r, g, b] = opaqueMean(join(ws, "unmix", "frames", "005.png"));
    expect(Math.max(Math.abs(r - g), Math.abs(g - b))).toBeLessThan(8);
    expect(g).toBeGreaterThan(240);
    // ffmpeg 8.0 despill=type=green:mix=0.6:expand=0.5 maps white to
    // (255,204,255): a fifth of the green out of every neutral pixel.
    const [pr, pg] = opaqueMean(join(ws, "colorkey", "frames", "005.png"));
    expect(pr - pg).toBeGreaterThan(30);

    // keyResidue is measured on the frames the loop ships, both ways.
    expect(unmix.inspect.keyResidue).toBe(0);
    expect(typeof colorkey.inspect.keyResidue).toBe("number");
    const report = JSON.parse(readFileSync(join(ws, "unmix", "inspect.json"), "utf-8"));
    expect(report).toMatchObject({ keyColor: unmix.keyColor, keyResidue: 0 });
  }, 30_000);

  test("loop --fps: the interpolated plate is un-mixed too", () => {
    const ws = fresh();
    const out = runJson("loop", whiteLoopClip(ws), "--out", join(ws, "fps"), "--name", "bob",
      "--formats", "webm", "--fps", "48", "--seam-fill", "none").json;
    expect(out.keyer).toBe("unmix");
    expect(out.fps).toBe(48);
    expect(out.inspect.keyResidue).toBe(0);
    const [r, g] = opaqueMean(join(ws, "fps", "frames", "010.png"));
    expect(Math.abs(r - g)).toBeLessThan(8);
  }, 30_000);

  test("a plate with no hue is keyed with colorkey, said on stderr and in the report", () => {
    const ws = fresh();
    const clip = lavfi(join(ws, "cream.mp4"),
      "color=c=0xece9e1:s=64x64:d=1:r=10[bg];color=c=0x902020:s=20x20:d=1:r=10[box];[bg][box]overlay=x=22:y=22");
    const { json, err } = runJson("from-video", clip, "--out", join(ws, "m"), "--name", "m", "--frames", "2", "--loop");
    expect(json.keyer).toBe("colorkey");
    expect(err).toContain("has no hue to un-mix — keyed with colorkey");
    // No hue, nothing to count: absent, not a confident 0.
    expect("keyResidue" in json.inspect).toBe(false);
  }, 30_000);

  test("key: a green sheet is un-mixed, a white one falls back to colorkey", () => {
    const ws = fresh();
    const green = lavfi(join(ws, "green.png"),
      "color=c=0x00b140:s=64x64[bg];color=c=white:s=24x24[box];[bg][box]overlay=x=20:y=20,gblur=sigma=1.5");
    const unmix = runJson("key", green, "--out", join(ws, "green-unmix.png")).json;
    // The plate as the PNG carries it after lavfi's yuv round trip, measured.
    expect(unmix).toMatchObject({ keyer: "unmix", keyResidue: 0, warnings: [] });
    expect(unmix.color).toMatch(/^#00(ae|af|b0|b1)(3e|3f|40)$/);
    const colorkey = runJson("key", green, "--out", join(ws, "green-colorkey.png"), "--keyer", "colorkey").json;
    expect(colorkey.keyer).toBe("colorkey");
    expect(colorkey.keyResidue).toBeGreaterThan(0.005);
    expect(colorkey.warnings).toHaveLength(1);

    const white = lavfi(join(ws, "white.png"), "color=c=white:s=64x64[bg];color=c=0x902020:s=24x24[box];[bg][box]overlay=x=20:y=20");
    const { json, err } = runJson("key", white, "--out", join(ws, "white-keyed.png"));
    expect(json.keyer).toBe("colorkey");
    expect(err).toContain("no hue to un-mix");
    expect("keyResidue" in json).toBe(false);
  }, 30_000);

  test("inspect measures against the plate the motion was keyed off, or the one --key names", () => {
    const ws = fresh();
    const dir = join(ws, "m");
    const cut = runJson("from-video", softClip(ws), "--out", dir, "--name", "hop", "--frames", "4", "--loop", "--keyer", "colorkey").json;
    // A plain inspect re-reads the keyColor the last report recorded.
    const again = runJson("inspect", dir).json;
    expect(again.keyColor).toBe(cut.keyColor);
    expect(again.keyResidue).toBe(cut.inspect.keyResidue);
    expect(again.warnings.some((w: string) => w.startsWith("keyResidue"))).toBe(true);
    // A white plate has no hue: nothing measured, nothing warned.
    const white = runJson("inspect", dir, "--key", "#ffffff").json;
    expect("keyResidue" in white).toBe(false);
    expect(white.warnings.some((w: string) => w.startsWith("keyResidue"))).toBe(false);
  }, 30_000);

  test("--keyer is one of two names", () => {
    const ws = fresh();
    const r = run("key", lavfi(join(ws, "x.png"), "color=c=0x00b140:s=16x16"), "--out", join(ws, "y.png"), "--keyer", "vlahos");
    expect(r.code).toBe(1);
    expect(r.err).toContain("--keyer: expected unmix or colorkey, got 'vlahos'");
  });
});

describe.skipIf(!HAS_FFMPEG)("sprite-sheet.mjs flatten — the subject against the plate", () => {
  /** A crimson disc with a green gem, on transparency. */
  const subject = (dir: string) => lavfi(join(dir, "subject.png"),
    "color=c=black@0:s=48x48,format=rgba[bg];color=c=0xb01830:s=32x32,format=rgba[body];"
    + "color=c=0x1edc28:s=6x6,format=rgba[gem];[bg][body]overlay=8:8[a];[a][gem]overlay=20:20");

  test("warns when subject pixels sit inside the plate's key radius", () => {
    const ws = fresh();
    const out = runJson("flatten", subject(ws), "--out", join(ws, "flat.png"), "--bg", "#00ff00").json;
    expect(out.plateCheck).toMatchObject({ within: 36, subjectPixels: 32 * 32 });
    // The gem, give or take lavfi's yuv round trip on #1edc28.
    expect(out.plateCheck.nearest).toMatch(/^#1[c-f]d[b-e]2[6-9]$/);
    expect(out.plateCheck.minDistance).toBeLessThan(out.plateCheck.radius);
    expect(out.plateCheck.radius).toBeCloseTo(0.22 * 255 * Math.sqrt(3), 1);
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]).toContain("36 subject px");
    expect(existsSync(join(ws, "flat.png"))).toBe(true);
  });

  test("a plate the subject clears says nothing; an opaque image is not judged", () => {
    const ws = fresh();
    const far = runJson("flatten", subject(ws), "--out", join(ws, "flat.png"), "--bg", "#0000ff").json;
    expect(far.plateCheck.within).toBe(0);
    expect(far.warnings).toEqual([]);
    const opaque = lavfi(join(ws, "opaque.png"), "color=c=0x00ff00:s=16x16");
    const flat = runJson("flatten", opaque, "--out", join(ws, "o.png"), "--bg", "#00ff00").json;
    expect("plateCheck" in flat).toBe(false);
    expect(flat.warnings).toEqual([]);
  });
});

afterAll(() => {
  for (const dir of workspaces) rmSync(dir, { recursive: true, force: true });
});

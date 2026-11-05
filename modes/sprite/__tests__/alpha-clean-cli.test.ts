import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { announceMediaTierSkip, mediaTierEnabled } from "../../../core/__tests__/test-tier.js";
import { cleanAlphaHaze } from "../skill/scripts/alpha-clean.mjs";

const SCRIPT = join(import.meta.dir, "../skill/scripts/sprite-sheet.mjs");
announceMediaTierSkip("sprite", "alpha cleanup and animation diagnostics CLI");
const HAS_MEDIA = mediaTierEnabled("sprite") && spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0 && spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0;
const workspaces: string[] = [];
function fresh() { const path = mkdtempSync(join(tmpdir(), "sprite-alpha-quality-")); workspaces.push(path); return path; }
function run(...args: string[]) {
  const result = Bun.spawnSync([process.execPath, SCRIPT, ...args, "--json"], { stdout: "pipe", stderr: "pipe" });
  return { code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString() };
}
function ffmpeg(args: string[], input?: Uint8Array) {
  const result = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { input, maxBuffer: 64 << 20 });
  if (result.status !== 0) throw new Error(result.stderr.toString());
  return result.stdout;
}
function writePng(path: string, alphas: number[]) {
  ffmpeg(["-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${alphas.length}x1`, "-i", "-", "-frames:v", "1", path], Uint8Array.from(alphas.flatMap((a) => [35, 71, 159, a])));
}
function decode(path: string) { return ffmpeg(["-i", path, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "-"]); }
afterAll(() => { for (const path of workspaces) rmSync(path, { recursive: true, force: true }); });

describe.skipIf(!HAS_MEDIA)("alpha cleanup real CLI", () => {
  test("publishes isolated pixels and report, is immutable and idempotent, refuses overwrite", () => {
    const dir = fresh(); const source = join(dir, "source.png"); const out = join(dir, "cleaned");
    writePng(source, [8, 8, 254, 8, 8, 8]); const before = readFileSync(source);
    const result = run("alpha-clean", source, "--out", out, "--max-alpha", "15", "--keep-edge", "1");
    expect(result.code).toBe(0);
    const report = JSON.parse(result.out);
    expect(report.removedPixels).toBe(3);
    expect(readFileSync(source)).toEqual(before);
    const expected = cleanAlphaHaze({ width: 6, height: 1, data: decode(source) }, { maxAlpha: 15, keepEdge: 1 });
    expect(decode(join(out, "source.png"))).toEqual(Buffer.from(expected.image.data));
    expect(existsSync(join(out, "alpha-clean.json"))).toBe(true);
    expect(run("alpha-clean", source, "--out", out).code).toBe(1);
    const invalid = run("alpha-clean", source, "--out", join(dir, "invalid"), "--max-alpha", "255");
    expect(invalid.code).toBe(1);
    expect(invalid.err).toContain("--max-alpha: expected an integer between 0 and 254");
    expect(existsSync(join(dir, "invalid"))).toBe(false);
    const again = run("alpha-clean", join(out, "source.png"), "--out", join(dir, "again"), "--keep-edge", "1");
    expect(JSON.parse(again.out).removedPixels).toBe(0);
    expect(decode(join(dir, "again/source.png"))).toEqual(decode(join(out, "source.png")));
  });
  test("refuses overlaps, symlink aliases and partial publication on decode failure", () => {
    const dir = fresh(); const frames = join(dir, "frames"); mkdirSync(frames);
    writePng(join(frames, "00.png"), [8, 254, 8]);
    expect(run("alpha-clean", frames, "--out", join(frames, "child")).code).toBe(1);
    symlinkSync(frames, join(dir, "alias"));
    expect(run("alpha-clean", frames, "--out", join(dir, "alias/child")).code).toBe(1);
    symlinkSync(join(frames, "00.png"), join(frames, "01.png"));
    expect(run("alpha-clean", frames, "--out", join(dir, "alias-copy")).code).toBe(1);
    rmSync(join(frames, "01.png")); const corrupt = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
    writeFileSync(join(frames, "01.png"), corrupt);
    const result = run("alpha-clean", frames, "--out", join(dir, "failed"));
    expect(result.code).toBe(1);
    expect(existsSync(join(dir, "failed"))).toBe(false);
    expect(readdirSync(dir).filter((file) => file.startsWith(".alpha-clean-"))).toEqual([]);
    expect(readFileSync(join(frames, "01.png"))).toEqual(corrupt);
  });
  test("refuses animated PNG rather than flattening it to a still", () => {
    const dir = fresh(); const frames = join(dir, "frames"); mkdirSync(frames);
    writePng(join(frames, "00.png"), [254, 8]); writePng(join(frames, "01.png"), [8, 254]);
    const source = join(dir, "animated.png");
    ffmpeg(["-framerate", "2", "-i", join(frames, "%02d.png"), "-plays", "0", "-f", "apng", source]);
    const before = readFileSync(source);
    const result = run("alpha-clean", source, "--out", join(dir, "copy"));
    expect(result.code).toBe(1);
    expect(result.err).toContain("animated PNG is unsupported");
    expect(existsSync(join(dir, "copy"))).toBe(false);
    expect(readFileSync(source)).toEqual(before);
  });
  test("refuses 16-bit PNG rather than quantizing protected pixels", () => {
    const dir = fresh(); const source = join(dir, "source.png"); const high = join(dir, "high.png");
    writePng(source, [254, 8]);
    ffmpeg(["-i", source, "-pix_fmt", "rgba64be", "-frames:v", "1", high]);
    const before = readFileSync(high);
    expect(before[24]).toBe(16);
    const result = run("alpha-clean", high, "--out", join(dir, "copy"));
    expect(result.code).toBe(1);
    expect(result.err).toContain("16-bit PNG is unsupported");
    expect(existsSync(join(dir, "copy"))).toBe(false);
    expect(readFileSync(high)).toEqual(before);
  });
  test("inspect uses atlas durations and reports GIF packet delays without resampling", () => {
    const dir = fresh(); const frames = join(dir, "frames"); mkdirSync(frames);
    writePng(join(frames, "00.png"), [255, 255]); writePng(join(frames, "01.png"), [127, 127]); writePng(join(frames, "02.png"), [255, 255]);
    writeFileSync(join(dir, "atlas.json"), JSON.stringify({ meta: { loop: true }, frames: { a: { duration: 20 }, b: { duration: 150 }, c: { duration: 70 } }, animations: { cycle: ["a", "b", "c"] } }));
    const atlas = run("inspect", dir);
    expect(atlas.code).toBe(0);
    expect(JSON.parse(atlas.out).animation.timing).toEqual({ source: "atlas-frame-durations", durationsMs: [20, 150, 70], totalMs: 240 });
    const concat = join(dir, "list.txt");
    writeFileSync(concat, `file '${frames}/00.png'\nduration 0.04\nfile '${frames}/01.png'\nduration 0.12\nfile '${frames}/02.png'\nduration 0.08\nfile '${frames}/02.png'\n`);
    const gif = join(dir, "source.gif");
    ffmpeg(["-f", "concat", "-safe", "0", "-i", concat, "-fps_mode", "vfr", gif]);
    const before = readFileSync(gif);
    const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "packet=duration_time", "-of", "csv=p=0", gif], { encoding: "utf8" });
    const expected = probe.stdout.trim().split(/\s+/).map((value) => Number(value) * 1000);
    expect(new Set(expected).size).toBeGreaterThan(1);
    const result = run("inspect", gif);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out).animation.timing.durationsMs).toEqual(expected);
    expect(JSON.parse(result.out).animation.frameCount).toBe(expected.length);
    expect(readFileSync(gif)).toEqual(before);
  });
});

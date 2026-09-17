/**
 * texture.mjs — the PNG codec pinned directly, the subcommands pinned as a
 * real process, because that is how the agent calls them.
 *
 * Two surfaces, two styles. The codec is imported and exercised in-process:
 * its contract is "every filter, every non-palette colour type, 16-bit down
 * to 8, and a clear refusal for the two forms it does not read", and a
 * fixture encoder that can emit each of the five row filters is the only way
 * to reach those branches. Everything else runs through `Bun.spawnSync` in a
 * fresh working directory with RELATIVE paths, which is the contract the
 * skill relies on (the agent's cwd is the workspace, and the script never
 * changes directory).
 *
 * No fixture is committed: every PNG here is built in code by
 * `fixtures/texture/make-texture.ts`. Nothing in this file needs a network,
 * a GPU or an external binary, so none of it belongs in the live tier.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { decodePng, encodePng } from "../skill/scripts/texture.mjs";
import type { DecodedPng } from "../skill/scripts/texture.mjs";
import {
  corruptIdat,
  courseRgb,
  encodeFixturePng,
  expectedRgba,
  greyAlphaImage,
  greyImage,
  horizontalRampRgb,
  lowBitDepthPng,
  noisyRgba,
  palettePng,
  periodicRgb,
  rgb16Image,
  rgbImage,
  solidRgb,
  verticalRampRgb,
  writePngFile,
} from "./fixtures/texture/make-texture.js";
import type { PngFilter, RawImage } from "./fixtures/texture/make-texture.js";

const SCRIPT = join(import.meta.dir, "..", "skill", "scripts", "texture.mjs");

const workspaces: string[] = [];

function fresh(): string {
  // realpath: /var/folders/... is a symlink to /private/var/... on macOS, and
  // the script reports resolved paths in its refusals.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "lucid-texture-")));
  workspaces.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of workspaces.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Run {
  code: number | null;
  out: string;
  err: string;
}

function run(cwd: string, ...argv: string[]): Run {
  const result = Bun.spawnSync([process.execPath, SCRIPT, ...argv], { cwd, stdout: "pipe", stderr: "pipe" });
  return { code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString() };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function runJson(cwd: string, ...argv: string[]): any {
  const result = run(cwd, ...argv, "--json");
  if (result.code !== 0) throw new Error(`texture.mjs ${argv.join(" ")} failed (${result.code}):\n${result.err}`);
  return JSON.parse(result.out);
}

/** Write a fixture into the workspace and return the relative name. */
function put(dir: string, name: string, image: RawImage, filter: PngFilter = 0): string {
  writePngFile(join(dir, name), encodeFixturePng(image, { filter }));
  return name;
}

function readOut(dir: string, name: string): DecodedPng {
  return decodePng(readFileSync(join(dir, name)), name);
}

function pixel(image: DecodedPng, x: number, y: number): number[] {
  const p = (y * image.width + x) * 4;
  return [image.data[p], image.data[p + 1], image.data[p + 2], image.data[p + 3]];
}

/** Largest RGB step between columns x-1 and x, over the columns in [from, to]. */
function maxColumnStep(image: DecodedPng, from: number, to: number): number {
  let worst = 0;
  for (let x = Math.max(1, from); x <= Math.min(image.width - 1, to); x += 1) {
    for (let y = 0; y < image.height; y += 1) {
      for (let c = 0; c < 3; c += 1) {
        const a = (y * image.width + x - 1) * 4 + c;
        const b = (y * image.width + x) * 4 + c;
        worst = Math.max(worst, Math.abs(image.data[a] - image.data[b]));
      }
    }
  }
  return worst;
}

/** The same between rows y-1 and y, over the rows in [from, to]. */
function maxRowStep(image: DecodedPng, from: number, to: number): number {
  let worst = 0;
  for (let y = Math.max(1, from); y <= Math.min(image.height - 1, to); y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      for (let c = 0; c < 3; c += 1) {
        const a = ((y - 1) * image.width + x) * 4 + c;
        const b = (y * image.width + x) * 4 + c;
        worst = Math.max(worst, Math.abs(image.data[a] - image.data[b]));
      }
    }
  }
  return worst;
}

// ---------------------------------------------------------------------------

describe("texture.mjs — the PNG codec", () => {
  for (const filter of [0, 1, 2, 3, 4] as const) {
    test(`round-trips an RGBA image written with row filter ${filter}`, () => {
      const image = noisyRgba(7, 5);
      const decoded = decodePng(encodeFixturePng(image, { filter }), "fixture.png");
      expect(decoded.width).toBe(7);
      expect(decoded.height).toBe(5);
      expect(decoded.colorTypeName).toBe("rgba");
      expect(decoded.hasAlpha).toBe(true);
      expect(Array.from(decoded.data)).toEqual(Array.from(expectedRgba(image)));
    });
  }

  test("round-trips one image that cycles all five filters down its rows", () => {
    // Five filters in one stream is the case a per-image filter never covers:
    // every row's reconstruction depends on the previous row's output.
    const image = noisyRgba(9, 10);
    const decoded = decodePng(encodeFixturePng(image, { filter: "cycle" }), "cycle.png");
    expect(Array.from(decoded.data)).toEqual(Array.from(expectedRgba(image)));
  });

  test("greyscale, greyscale+alpha and RGB all arrive as RGBA with their source recorded", () => {
    const grey = greyImage(4, 3, (x, y) => (x * 40 + y * 7) % 256);
    const greyDecoded = decodePng(encodeFixturePng(grey, { filter: "cycle" }), "grey.png");
    expect(greyDecoded.colorType).toBe(0);
    expect(greyDecoded.hasAlpha).toBe(false);
    expect(Array.from(greyDecoded.data)).toEqual(Array.from(expectedRgba(grey)));

    const greyAlpha = greyAlphaImage(4, 3, (x, y) => [(x * 33) % 256, (y * 64) % 256]);
    const greyAlphaDecoded = decodePng(encodeFixturePng(greyAlpha, { filter: 4 }), "greya.png");
    expect(greyAlphaDecoded.colorTypeName).toBe("greyscale-alpha");
    expect(greyAlphaDecoded.hasAlpha).toBe(true);
    expect(Array.from(greyAlphaDecoded.data)).toEqual(Array.from(expectedRgba(greyAlpha)));

    const rgb = rgbImage(5, 2, (x, y) => [x * 20, y * 90, 255 - x * 10]);
    const rgbDecoded = decodePng(encodeFixturePng(rgb, { filter: 3 }), "rgb.png");
    expect(rgbDecoded.colorTypeName).toBe("rgb");
    expect(rgbDecoded.hasAlpha).toBe(false);
    expect(Array.from(rgbDecoded.data)).toEqual(Array.from(expectedRgba(rgb)));
  });

  test("16-bit samples are down-converted to their high byte", () => {
    // 0x1234 must become 0x12, not 0x34 and not a clamp to 255.
    const image = rgb16Image(3, 2, (x, y) => [0x1234 + x, 0xabcd - y, 0x00ff]);
    const decoded = decodePng(encodeFixturePng(image, { filter: 2 }), "deep.png");
    expect(decoded.bitDepth).toBe(16);
    expect(pixel(decoded, 0, 0)).toEqual([0x12, 0xab, 0x00, 255]);
    expect(Array.from(decoded.data)).toEqual(Array.from(expectedRgba(image)));
  });

  test("encodePng writes a PNG this decoder reads back byte for byte, RGB and RGBA", () => {
    const source = decodePng(encodeFixturePng(noisyRgba(6, 4), { filter: "cycle" }), "src.png");

    const rgba = decodePng(encodePng({ ...source, alpha: true }), "rgba.png");
    expect(rgba.colorType).toBe(6);
    expect(Array.from(rgba.data)).toEqual(Array.from(source.data));

    const rgb = decodePng(encodePng({ ...source, alpha: false }), "rgb.png");
    expect(rgb.colorType).toBe(2);
    for (let i = 0; i < source.width * source.height; i += 1) {
      expect([rgb.data[i * 4], rgb.data[i * 4 + 1], rgb.data[i * 4 + 2], rgb.data[i * 4 + 3]]).toEqual([
        source.data[i * 4], source.data[i * 4 + 1], source.data[i * 4 + 2], 255,
      ]);
    }
  });

  test("palette, interlaced, low bit depth, JPEG and a bad CRC are each refused by name", () => {
    expect(() => decodePng(palettePng(), "p.png")).toThrow(/palette PNG \(colour type 3\)/);
    expect(() => decodePng(encodeFixturePng(noisyRgba(4, 4), { interlace: true }), "i.png")).toThrow(/interlaced \(Adam7\)/);
    expect(() => decodePng(lowBitDepthPng(), "l.png")).toThrow(/4-bit greyscale/);
    expect(() => decodePng(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]), "j.png")).toThrow(/is a JPEG, not a PNG/);
    expect(() => decodePng(corruptIdat(encodeFixturePng(noisyRgba(4, 4))), "c.png")).toThrow(/corrupt 'IDAT' chunk/);
    expect(() => decodePng(Buffer.from("not a png at all"), "n.png")).toThrow(/does not start with the PNG signature/);
  });
});

// ---------------------------------------------------------------------------

describe("texture.mjs info", () => {
  test("reports the header, the file size and the tile estimate in one call", () => {
    const dir = fresh();
    const name = put(dir, "albedo.png", periodicRgb(64, 64), "cycle");
    const report = runJson(dir, "info", name);
    expect(report.ok).toBe(true);
    expect(report).toMatchObject({
      command: "info",
      width: 64,
      height: 64,
      bitDepth: 8,
      colorType: 2,
      colorTypeName: "rgb",
      hasAlpha: false,
      tileable: true,
    });
    expect(report.bytes).toBe(readFileSync(join(dir, name)).length);
  });
});

// ---------------------------------------------------------------------------

describe("texture.mjs normal", () => {
  test("a flat albedo derives the flat normal, exactly (128, 128, 255)", () => {
    const dir = fresh();
    put(dir, "flat.png", solidRgb(16, 16, [180, 90, 40]));
    const report = runJson(dir, "normal", "flat.png", "out/normal.png");
    expect(report.output).toBe("out/normal.png");
    const normal = readOut(dir, "out/normal.png");
    expect(normal.width).toBe(16);
    expect(normal.height).toBe(16);
    expect(normal.colorTypeName).toBe("rgb");
    for (let y = 0; y < normal.height; y += 1) {
      for (let x = 0; x < normal.width; x += 1) expect(pixel(normal, x, y)).toEqual([128, 128, 255, 255]);
    }
    expect(report.relief).toBe(0);
    expect(report.warnings[0]).toContain("this albedo is flat");
  });

  test("an albedo brightening to the right tilts the normal left: R below 128, G untouched", () => {
    const dir = fresh();
    put(dir, "ramp.png", horizontalRampRgb(32, 8));
    const report = runJson(dir, "normal", "ramp.png", "normal.png");
    expect(report.convention).toBe("opengl");
    const normal = readOut(dir, "normal.png");
    // Interior only: the slope is sampled with wrap, so the two border columns
    // legitimately see the far edge of the ramp.
    for (let x = 4; x < 28; x += 1) {
      const [r, g, b] = pixel(normal, x, 4);
      expect(r).toBeLessThan(128);
      expect(g).toBe(128);
      expect(b).toBeGreaterThan(200);
    }
    expect(report.relief).toBeGreaterThan(1);
    expect(report.warnings).toEqual([]);
  });

  test("--strength scales the slope, so the deviation grows with it", () => {
    const dir = fresh();
    put(dir, "ramp.png", horizontalRampRgb(32, 8));
    runJson(dir, "normal", "ramp.png", "weak.png", "--strength", "1");
    runJson(dir, "normal", "ramp.png", "strong.png", "--strength", "6");
    const weak = pixel(readOut(dir, "weak.png"), 16, 4)[0];
    const strong = pixel(readOut(dir, "strong.png"), 16, 4)[0];
    expect(strong).toBeLessThan(weak);
    expect(weak).toBeLessThan(128);
  });

  test("a negative --strength inverts the relief, for pale mortar and white grout", () => {
    // "Bright is high" is a guess about the surface, and it is wrong whenever
    // the light part is the recessed one. Negating the slope is the whole fix,
    // so the map must come out mirrored about 128 rather than merely weaker.
    const dir = fresh();
    put(dir, "ramp.png", horizontalRampRgb(32, 8));
    const report = runJson(dir, "normal", "ramp.png", "up.png", "--strength", "2");
    const inverted = runJson(dir, "normal", "ramp.png", "down.png", "--strength=-2");
    expect(report.strength).toBe(2);
    expect(inverted.strength).toBe(-2);

    // A bare '--strength -2' is what an agent writes first; parseArgs alone
    // would refuse it as ambiguous, so the scripts join the number onto the
    // option before parsing (argv.mjs) and both spellings mean the same thing.
    const spaced = runJson(dir, "normal", "ramp.png", "spaced.png", "--strength", "-2");
    expect(spaced.strength).toBe(-2);
    const up = readOut(dir, "up.png");
    const down = readOut(dir, "down.png");
    for (let x = 4; x < 28; x += 1) {
      const raised = pixel(up, x, 4)[0];
      const recessed = pixel(down, x, 4)[0];
      expect(raised).toBeLessThan(128);
      expect(recessed).toBeGreaterThan(128);
      expect(Math.abs(raised + recessed - 255)).toBeLessThanOrEqual(1);
      // Z is unchanged: the same relief, facing the other way.
      expect(pixel(down, x, 4)[2]).toBe(pixel(up, x, 4)[2]);
    }
  });

  test("a downward-brightening albedo puts G above 128, and --invert-y flips it", () => {
    const dir = fresh();
    put(dir, "vramp.png", verticalRampRgb(8, 32));
    runJson(dir, "normal", "vramp.png", "gl.png");
    const directx = runJson(dir, "normal", "vramp.png", "dx.png", "--invert-y");
    expect(directx.convention).toBe("directx");

    const gl = readOut(dir, "gl.png");
    const dx = readOut(dir, "dx.png");
    for (let y = 4; y < 28; y += 1) {
      const [glR, glG] = pixel(gl, 4, y);
      const [dxR, dxG] = pixel(dx, 4, y);
      expect(glR).toBe(128);
      expect(dxR).toBe(128);
      expect(glG).toBeGreaterThan(128);
      expect(dxG).toBeLessThan(128);
      // The two conventions are the same map with the green channel mirrored.
      expect(Math.abs(glG + dxG - 255)).toBeLessThanOrEqual(1);
    }
  });

  test("--blur 0 keeps single-pixel detail that the default blur removes", () => {
    const dir = fresh();
    // One bright pixel in a dark field: after a radius-1 box blur its slope is
    // spread over its neighbours, so the peak's own gradient softens.
    put(dir, "dot.png", rgbImage(16, 16, (x, y) => (x === 8 && y === 8 ? [255, 255, 255] : [20, 20, 20])));
    runJson(dir, "normal", "dot.png", "sharp.png", "--blur", "0");
    runJson(dir, "normal", "dot.png", "soft.png", "--blur", "2");
    const sharp = Math.abs(pixel(readOut(dir, "sharp.png"), 7, 8)[0] - 128);
    const soft = Math.abs(pixel(readOut(dir, "soft.png"), 7, 8)[0] - 128);
    expect(sharp).toBeGreaterThan(soft);
  });

  test("slopes are sampled with wrap, so the last column sees the first", () => {
    // The documented promise is that a seamless albedo gives a seamless normal
    // map. A clamped sampler would read the edge pixel as its own neighbour and
    // report no slope there at all — exactly 128 — so this is the assertion
    // that tells the two samplers apart. --blur 0 keeps the arithmetic exact.
    const dir = fresh();
    put(dir, "stripe.png", rgbImage(16, 4, (x) => (x === 0 ? [255, 255, 255] : [20, 20, 20])));
    runJson(dir, "normal", "stripe.png", "stripe-n.png", "--blur", "0");
    const stripe = readOut(dir, "stripe-n.png");
    expect(pixel(stripe, 15, 2)[0]).toBeLessThan(100);
    expect(pixel(stripe, 1, 2)[0]).toBeGreaterThan(156);

    put(dir, "band.png", rgbImage(4, 16, (_x, y) => (y === 0 ? [255, 255, 255] : [20, 20, 20])));
    runJson(dir, "normal", "band.png", "band-n.png", "--blur", "0");
    const band = readOut(dir, "band-n.png");
    expect(pixel(band, 2, 15)[1]).toBeGreaterThan(156);
    expect(pixel(band, 2, 1)[1]).toBeLessThan(100);
  });

  test("a tileable albedo derives a tileable normal map", () => {
    const dir = fresh();
    put(dir, "sine.png", periodicRgb(64, 64));
    expect(runJson(dir, "tile-check", "sine.png").tileable).toBe(true);
    runJson(dir, "normal", "sine.png", "sine-n.png");
    expect(runJson(dir, "tile-check", "sine-n.png").tileable).toBe(true);
  });

  test("a blur radius past the documented ceiling is refused, not silently clamped", () => {
    const dir = fresh();
    put(dir, "flat.png", solidRgb(8, 8, [100, 100, 100]));
    const result = run(dir, "normal", "flat.png", "out.png", "--blur", "40");
    expect(result.code).toBe(1);
    expect(result.err).toContain("--blur must be between 0 and 16");
  });
});

// ---------------------------------------------------------------------------

describe("texture.mjs roughness", () => {
  test("every output value stays inside --min and --max", () => {
    const dir = fresh();
    put(dir, "noise.png", noisyRgba(24, 24), "cycle");
    const report = runJson(dir, "roughness", "noise.png", "rough.png", "--min", "0.4", "--max", "0.6");
    const rough = readOut(dir, "rough.png");
    const floor = Math.round(0.4 * 255);
    const ceiling = Math.round(0.6 * 255);
    for (let i = 0; i < rough.width * rough.height; i += 1) {
      const p = i * 4;
      expect(rough.data[p]).toBeGreaterThanOrEqual(floor);
      expect(rough.data[p]).toBeLessThanOrEqual(ceiling);
      // Greyscale written as RGB with equal channels, ready for pack-orm.
      expect(rough.data[p + 1]).toBe(rough.data[p]);
      expect(rough.data[p + 2]).toBe(rough.data[p]);
    }
    expect(report.stats.min).toBeGreaterThanOrEqual(0.4);
    expect(report.stats.max).toBeLessThanOrEqual(0.6);
  });

  test("dark is rougher than bright by default, and --invert turns that around", () => {
    const dir = fresh();
    put(dir, "black.png", solidRgb(8, 8, [0, 0, 0]));
    put(dir, "white.png", solidRgb(8, 8, [255, 255, 255]));
    runJson(dir, "roughness", "black.png", "black-r.png");
    runJson(dir, "roughness", "white.png", "white-r.png");
    // 0.35 + 0.6 * (0.65 * 1) = 0.74 against the bare --min for white.
    expect(pixel(readOut(dir, "black-r.png"), 4, 4)[0]).toBe(189);
    expect(pixel(readOut(dir, "white-r.png"), 4, 4)[0]).toBe(89);

    runJson(dir, "roughness", "black.png", "black-i.png", "--invert");
    runJson(dir, "roughness", "white.png", "white-i.png", "--invert");
    expect(pixel(readOut(dir, "black-i.png"), 4, 4)[0]).toBeLessThan(pixel(readOut(dir, "white-i.png"), 4, 4)[0]);
  });

  test("local contrast raises roughness at the same luminance", () => {
    const dir = fresh();
    const mid = 128;
    put(dir, "flat.png", solidRgb(16, 16, [mid, mid, mid]));
    // A checkerboard with the same mean luminance, but busy.
    put(dir, "busy.png", rgbImage(16, 16, (x, y) => ((x + y) % 2 ? [mid + 60, mid + 60, mid + 60] : [mid - 60, mid - 60, mid - 60])));
    const flat = runJson(dir, "roughness", "flat.png", "flat-r.png");
    const busy = runJson(dir, "roughness", "busy.png", "busy-r.png");
    expect(busy.stats.mean).toBeGreaterThan(flat.stats.mean);
  });

  test("--min at or above --max is refused", () => {
    const dir = fresh();
    put(dir, "a.png", solidRgb(4, 4, [10, 10, 10]));
    const result = run(dir, "roughness", "a.png", "out.png", "--min", "0.8", "--max", "0.4");
    expect(result.code).toBe(1);
    expect(result.err).toContain("--min 0.8 must be below --max 0.4");
  });
});

// ---------------------------------------------------------------------------

describe("texture.mjs tile-check", () => {
  test("a genuinely periodic texture scores about one neighbouring step and passes", () => {
    const dir = fresh();
    put(dir, "sine.png", periodicRgb(64, 64));
    const report = runJson(dir, "tile-check", "sine.png");
    expect(report.tileable).toBe(true);
    expect(report.threshold).toBe(2);
    // Not 0: the seam of this fixture sits at the steepest part of the wave,
    // so it is an ordinary step — which is exactly what the ratio measures.
    expect(report.seamScore).toBeGreaterThan(0.5);
    expect(report.seamScore).toBeLessThanOrEqual(2);
    expect(report.advice).toContain("tile it");
  });

  test("a ramp does not tile, and the left-right pair is named as the bad one", () => {
    const dir = fresh();
    put(dir, "ramp.png", horizontalRampRgb(64, 64));
    const report = runJson(dir, "tile-check", "ramp.png");
    expect(report.tileable).toBe(false);
    expect(report.worstEdge).toBe("left-right");
    // The seam is the full range against a one-step interior gradient.
    expect(report.seamScore).toBeGreaterThan(20);
    expect(report.vertical.score).toBe(0);
    expect(report.advice).toContain("make-tileable");
  });

  test("a vertical ramp names the top-bottom pair instead", () => {
    const dir = fresh();
    put(dir, "vramp.png", verticalRampRgb(64, 64));
    const report = runJson(dir, "tile-check", "vramp.png");
    expect(report.tileable).toBe(false);
    expect(report.worstEdge).toBe("top-bottom");
  });

  test("a correctly-wrapping brick pattern is flagged, but flagged as structured", () => {
    // The honest limit of a mean-relative score. These courses divide the
    // height exactly, so the top/bottom wrap is correct — yet the texture is
    // flat between its mortar lines, so the mean interior step is small and the
    // score goes over the threshold. The threshold stays strict; what saves the
    // agent is `structured` and the advice, because running make-tileable here
    // would cut the bond pattern in half.
    const dir = fresh();
    put(dir, "brick.png", courseRgb(64, 64, 16, 2));
    const report = runJson(dir, "tile-check", "brick.png");
    expect(report.tileable).toBe(false);
    expect(report.worstEdge).toBe("top-bottom");
    expect(report.structured).toBe(true);
    // The seam step is no bigger than the mortar boundaries inside the image.
    expect(report.vertical.edgeDiff).toBeLessThanOrEqual(report.vertical.interiorMax);
    expect(report.vertical.interiorMax).toBeGreaterThan(report.vertical.interiorGradient * 3);
    expect(report.advice).toContain("brick course");
    expect(report.advice).not.toContain("run 'make-tileable");
  });

  test("a ramp is not structured — nothing inside it is as big as its seam", () => {
    const dir = fresh();
    put(dir, "ramp.png", horizontalRampRgb(64, 64));
    const report = runJson(dir, "tile-check", "ramp.png");
    expect(report.structured).toBe(false);
    expect(report.horizontal.withinStructure).toBe(false);
    expect(report.advice).toContain("make-tileable");
  });

  test("a flat image scores zero rather than dividing zero by zero", () => {
    const dir = fresh();
    put(dir, "flat.png", solidRgb(32, 32, [200, 120, 60]));
    const report = runJson(dir, "tile-check", "flat.png");
    expect(report.seamScore).toBe(0);
    expect(report.tileable).toBe(true);
    expect(report.worstEdge).toBe("none");
  });
});

// ---------------------------------------------------------------------------

describe("texture.mjs make-tileable", () => {
  test("it turns a ramp into something that wraps, and says so with a number", () => {
    const dir = fresh();
    put(dir, "ramp.png", horizontalRampRgb(64, 64));
    const report = runJson(dir, "make-tileable", "ramp.png", "fixed.png");
    expect(report.before.tileable).toBe(false);
    expect(report.after.tileable).toBe(true);
    expect(report.after.seamScore).toBeLessThan(report.before.seamScore);
    expect(report.offset).toEqual({ x: 32, y: 32 });
    expect(report.blendPixels.x).toBeGreaterThan(0);

    const fixed = readOut(dir, "fixed.png");
    expect([fixed.width, fixed.height]).toEqual([64, 64]);
    // The report's own claim, re-measured through the other subcommand.
    const check = runJson(dir, "tile-check", "fixed.png");
    expect(check.seamScore).toBe(report.after.seamScore);
    expect(check.tileable).toBe(true);
  });

  test("it warns when it is asked to 'fix' a structured texture", () => {
    const dir = fresh();
    put(dir, "brick.png", courseRgb(64, 64, 16, 2));
    const report = runJson(dir, "make-tileable", "brick.png", "brick-offset.png");
    expect(report.before.structured).toBe(true);
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]).toContain("cuts a brick or plank pattern");
    // Still does the work it was asked to do; the warning is not a refusal.
    expect(readOut(dir, "brick-offset.png").width).toBe(64);

    put(dir, "ramp.png", horizontalRampRgb(64, 64));
    expect(runJson(dir, "make-tileable", "ramp.png", "ramp-fixed.png").warnings).toEqual([]);
  });

  test("it objects when the source already tiles, and still does the work", () => {
    const dir = fresh();
    put(dir, "sine.png", periodicRgb(64, 64));
    const report = runJson(dir, "make-tileable", "sine.png", "sine-offset.png");
    expect(report.before.tileable).toBe(true);
    expect(report.warnings[0]).toContain("already tiles");
    expect(readOut(dir, "sine-offset.png").width).toBe(64);
  });

  test("'structured' qualifies a failure only; a passing texture does not carry it", () => {
    const dir = fresh();
    put(dir, "sine.png", periodicRgb(64, 64));
    const passing = runJson(dir, "tile-check", "sine.png");
    expect(passing.tileable).toBe(true);
    expect(passing.structured).toBe(false);
    // The raw per-axis measurement is still there for anyone who wants it.
    expect(passing.horizontal.withinStructure).toBe(true);
  });

  test("--blend 0 does the offset only, and still closes the border", () => {
    const dir = fresh();
    put(dir, "ramp.png", horizontalRampRgb(64, 16));
    const report = runJson(dir, "make-tileable", "ramp.png", "offset.png", "--blend", "0");
    expect(report.blendPixels).toEqual({ x: 0, y: 0 });
    expect(report.after.tileable).toBe(true);
    // A pure wrap-offset moves pixels and invents none of them.
    const source = readOut(dir, "ramp.png");
    const moved = readOut(dir, "offset.png");
    expect(pixel(moved, 0, 0)).toEqual(pixel(source, 32, 8));
  });

  test("the cross-fade closes the interior seam the offset leaves behind, on both axes", () => {
    // tile-check cannot see this break: the offset moved it into the middle of
    // the picture, where it is nobody's edge. It is still the thing a person
    // sees, so it is measured here directly, as the largest neighbouring step
    // inside the cross-fade band.
    const dir = fresh();
    put(dir, "h.png", horizontalRampRgb(64, 64));
    put(dir, "v.png", verticalRampRgb(64, 64));

    const rawH = runJson(dir, "make-tileable", "h.png", "h-raw.png", "--blend", "0");
    const fadedH = runJson(dir, "make-tileable", "h.png", "h-faded.png");
    expect(rawH.seam.x).toBe(32);
    expect(fadedH.blendPixels.x).toBe(4);
    const bandH: [number, number] = [fadedH.seam.x - fadedH.blendPixels.x, fadedH.seam.x + fadedH.blendPixels.x];
    expect(maxColumnStep(readOut(dir, "h-raw.png"), ...bandH)).toBeGreaterThan(200);
    expect(maxColumnStep(readOut(dir, "h-faded.png"), ...bandH)).toBeLessThan(60);
    // On the seam itself the two sides become the same average, exactly.
    expect(maxColumnStep(readOut(dir, "h-faded.png"), fadedH.seam.x, fadedH.seam.x)).toBe(0);

    const rawV = runJson(dir, "make-tileable", "v.png", "v-raw.png", "--blend", "0");
    const fadedV = runJson(dir, "make-tileable", "v.png", "v-faded.png");
    const bandV: [number, number] = [fadedV.seam.y - fadedV.blendPixels.y, fadedV.seam.y + fadedV.blendPixels.y];
    expect(maxRowStep(readOut(dir, "v-raw.png"), ...bandV)).toBeGreaterThan(200);
    expect(maxRowStep(readOut(dir, "v-faded.png"), ...bandV)).toBeLessThan(60);
    expect(maxRowStep(readOut(dir, "v-faded.png"), fadedV.seam.y, fadedV.seam.y)).toBe(0);
  });

  test("the fade stays inside its band and leaves the rest of the image alone", () => {
    const dir = fresh();
    put(dir, "ramp.png", horizontalRampRgb(64, 16));
    const report = runJson(dir, "make-tileable", "ramp.png", "faded.png");
    const raw = runJson(dir, "make-tileable", "ramp.png", "raw.png", "--blend", "0");
    expect(raw.blendPixels.x).toBe(0);
    const faded = readOut(dir, "faded.png");
    const offsetOnly = readOut(dir, "raw.png");
    for (let x = 0; x < 64; x += 1) {
      const inBand = x >= report.seam.x - report.blendPixels.x && x < report.seam.x + report.blendPixels.x;
      if (inBand) continue;
      expect(pixel(faded, x, 8)).toEqual(pixel(offsetOnly, x, 8));
    }
  });

  test("the cross-fade band scales with --blend", () => {
    const dir = fresh();
    put(dir, "ramp.png", horizontalRampRgb(100, 100));
    expect(runJson(dir, "make-tileable", "ramp.png", "a.png", "--blend", "0.1").blendPixels.x).toBe(5);
    expect(runJson(dir, "make-tileable", "ramp.png", "b.png", "--blend", "0.4").blendPixels.x).toBe(20);
  });
});

// ---------------------------------------------------------------------------

describe("texture.mjs resize", () => {
  test("halving the long edge halves both dimensions and averages the pixels", () => {
    const dir = fresh();
    put(dir, "big.png", noisyRgba(256, 256), "cycle");
    const report = runJson(dir, "resize", "big.png", "small.png", "--size", "128");
    expect(report.from).toEqual({ width: 256, height: 256 });
    expect(report.to).toEqual({ width: 128, height: 128 });
    expect(report.warnings).toEqual([]);
    const small = readOut(dir, "small.png");
    expect([small.width, small.height]).toEqual([128, 128]);
    // Alpha came in, so alpha goes out.
    expect(small.hasAlpha).toBe(true);
  });

  test("a 2x2 block of known colours averages into one pixel", () => {
    const dir = fresh();
    put(dir, "quad.png", rgbImage(2, 2, (x, y) => (x === 0 && y === 0 ? [0, 0, 0] : [100, 200, 60])));
    runJson(dir, "resize", "quad.png", "one.png", "--size", "1");
    // (0 + 100 * 3) / 4 = 75, (0 + 200 * 3) / 4 = 150, (0 + 60 * 3) / 4 = 45.
    expect(pixel(readOut(dir, "one.png"), 0, 0)).toEqual([75, 150, 45, 255]);
  });

  test("a non-integer ratio weights each source pixel by the area it covers", () => {
    // 3 -> 2 puts the middle pixel half in each output pixel. Averaging the
    // covered pixels equally instead would read 45 and 165 here; only the area
    // weights give 30 and 190, and only a non-integer ratio can tell them apart.
    const dir = fresh();
    put(dir, "three.png", rgbImage(3, 1, (x) => [[0, 90, 240][x], [0, 90, 240][x], [0, 90, 240][x]]));
    const report = runJson(dir, "resize", "three.png", "two.png", "--size", "2");
    expect(report.to).toEqual({ width: 2, height: 1 });
    const two = readOut(dir, "two.png");
    expect(pixel(two, 0, 0)).toEqual([30, 30, 30, 255]);
    expect(pixel(two, 1, 0)).toEqual([190, 190, 190, 255]);
  });

  test("aspect is preserved off the long edge", () => {
    const dir = fresh();
    put(dir, "wide.png", noisyRgba(64, 32));
    const report = runJson(dir, "resize", "wide.png", "out.png", "--size", "32");
    expect(report.to).toEqual({ width: 32, height: 16 });
  });

  test("upscaling is refused, with the sizes named", () => {
    const dir = fresh();
    put(dir, "small.png", noisyRgba(64, 64));
    const result = run(dir, "resize", "small.png", "big.png", "--size", "128");
    expect(result.code).toBe(1);
    expect(result.err).toContain("refusing to upscale");
    expect(result.err).toContain("long edge 64");
    expect(result.err).toContain("--size is 128");
  });

  test("a non-power-of-two size is a warning in the report, not an error", () => {
    const dir = fresh();
    put(dir, "big.png", noisyRgba(200, 200));
    const report = runJson(dir, "resize", "big.png", "odd.png", "--size", "100");
    expect(report.ok).toBe(true);
    expect(report.to).toEqual({ width: 100, height: 100 });
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]).toContain("not a power of two");
  });
});

// ---------------------------------------------------------------------------

describe("texture.mjs pack-orm", () => {
  test("R is AO, G is roughness, B is metallic", () => {
    const dir = fresh();
    put(dir, "ao.png", solidRgb(8, 8, [40, 40, 40]));
    put(dir, "rough.png", solidRgb(8, 8, [200, 200, 200]));
    put(dir, "metal.png", solidRgb(8, 8, [10, 10, 10]));
    const report = runJson(dir, "pack-orm", "ao.png", "rough.png", "metal.png", "orm.png");
    expect(report.width).toBe(8);
    expect(report.channels.g).toContain("rough.png");
    const orm = readOut(dir, "orm.png");
    expect(orm.colorTypeName).toBe("rgb");
    expect(pixel(orm, 3, 5)).toEqual([40, 200, 10, 255]);
  });

  test("'-' substitutes the glTF defaults: no occlusion, dielectric", () => {
    const dir = fresh();
    put(dir, "rough.png", solidRgb(8, 8, [128, 128, 128]));
    const report = runJson(dir, "pack-orm", "-", "rough.png", "-", "orm.png");
    expect(report.ao).toBeNull();
    expect(report.metallic).toBeNull();
    expect(pixel(readOut(dir, "orm.png"), 0, 0)).toEqual([255, 128, 0, 255]);
  });

  test("a size mismatch is refused with both sizes named", () => {
    const dir = fresh();
    put(dir, "ao.png", solidRgb(4, 4, [40, 40, 40]));
    put(dir, "rough.png", solidRgb(8, 8, [200, 200, 200]));
    const result = run(dir, "pack-orm", "ao.png", "rough.png", "-", "orm.png");
    expect(result.code).toBe(1);
    expect(result.err).toContain("<ao> is 4x4 but <roughness> is 8x8");
  });

  test("roughness cannot be omitted", () => {
    const dir = fresh();
    const result = run(dir, "pack-orm", "-", "-", "-", "orm.png");
    expect(result.code).toBe(1);
    expect(result.err).toContain("<roughness.png> cannot be '-'");
  });
});

// ---------------------------------------------------------------------------

describe("texture.mjs — plumbing", () => {
  test("--help lists every subcommand and the numbers the maps depend on", () => {
    const result = run(fresh(), "--help");
    expect(result.code).toBe(0);
    expect(result.out).toContain("Usage: texture.mjs <subcommand>");
    for (const command of ["info", "normal", "roughness", "tile-check", "make-tileable", "resize", "pack-orm"]) {
      expect(result.out).toContain(`  ${command} `);
    }
    expect(result.out).toContain("(128, 128, 255)");
    expect(result.out).toContain("seamScore = meanAbsDiff(edge pair) / meanAbsDiff(interior neighbours)");
    expect(result.out).toContain("R = ambient occlusion, G = roughness, B = metallic");
    // The measured failure mode of the seam score, documented where it is used.
    expect(result.out).toContain("'structured'");
    expect(result.out).toContain("top/bottom step 79.1, mean interior");
  });

  test("an unknown subcommand exits 1 and names the ones that exist", () => {
    const result = run(fresh(), "denoise");
    expect(result.code).toBe(1);
    expect(result.err).toContain("unknown subcommand 'denoise'");
    expect(result.err).toContain("info, normal, roughness, tile-check, make-tileable, resize, pack-orm");
  });

  test("a missing file is refused by name", () => {
    const result = run(fresh(), "info", "nope.png");
    expect(result.code).toBe(1);
    expect(result.err).toContain("<png> does not exist: nope.png");
  });

  test("a file that is not a PNG is refused with what it actually is", () => {
    const dir = fresh();
    writeFileSync(join(dir, "notes.txt"), "this is not a texture\n");
    const result = run(dir, "normal", "notes.txt", "out.png");
    expect(result.code).toBe(1);
    expect(result.err).toContain("does not start with the PNG signature");
  });

  test("without --json the report is human lines, and stdout stays one JSON object with it", () => {
    const dir = fresh();
    put(dir, "flat.png", solidRgb(8, 8, [90, 90, 90]));
    const human = run(dir, "tile-check", "flat.png");
    expect(human.code).toBe(0);
    expect(human.out).toContain("seamScore 0");
    expect(() => JSON.parse(human.out)).toThrow();

    const json = run(dir, "tile-check", "flat.png", "--json");
    expect(json.out.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(json.out).ok).toBe(true);
  });
});

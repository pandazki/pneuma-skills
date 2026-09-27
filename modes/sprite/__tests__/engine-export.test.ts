/**
 * The two pure modules behind `export --format aseprite` and `export --shadow`:
 * `aseprite.mjs` (the sheet description engines build animations from) and
 * `shadow.mjs` (a ground shadow cast from the silhouette). No ffmpeg — pixels
 * are drawn in memory — so this file runs everywhere the routine suite does;
 * the CLI halves are pinned in `sprite-sheet.test.ts`.
 *
 * The shadow cases are ported from aldegad/sprite-gen (Apache-2.0)
 * tests/effects/test_shadow.py@fbd1a08: the foot anchor is a fixed point,
 * positive shear falls left, the canvas never crops, the identity projection
 * is the silhouette, opacity is monotonic, bad parameters are refused.
 *
 * What the engines read is pinned against their own source, quoted where it
 * is used: a field an engine does not read is ignored without a word, so the
 * only useful check is "the key the loader looks up is there".
 */

import { describe, expect, test } from "bun:test";

import { asepriteDocument, gridLayout, stackLayout } from "../skill/scripts/aseprite.mjs";
import {
  SHADOW_DEFAULTS,
  projectShadow,
  shadowCanvas,
  shadowGeometry,
  shadowOptions,
  withShadow,
  type ShadowImage,
} from "../skill/scripts/shadow.mjs";

// ── Pixels in memory ───────────────────────────────────────────────────────

function blank(width: number, height: number): ShadowImage {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

/** Fill the inclusive box [x0, x1] × [y0, y1]. */
function fill(image: ShadowImage, x0: number, y0: number, x1: number, y1: number, rgba: number[]) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) image.data.set(rgba, (y * image.width + x) * 4);
  }
  return image;
}

/** Upstream's `_silhouette`: a half-transparent 32×48 plate with an opaque bar. */
function silhouette(): ShadowImage {
  const image = fill(blank(32, 48), 0, 0, 31, 47, [220, 40, 170, 180]);
  return fill(image, 7, 8, 20, 37, [30, 240, 20, 255]);
}

const alphaOf = (image: ShadowImage, x: number, y: number) => image.data[(y * image.width + x) * 4 + 3];

/** Alpha-weighted centre, in pixel-centre coordinates. */
function centreOfAlpha(image: ShadowImage) {
  let sum = 0, sx = 0, sy = 0;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const a = alphaOf(image, x, y);
      sum += a; sx += a * (x + 0.5); sy += a * (y + 0.5);
    }
  }
  return { x: sx / sum, y: sy / sum };
}

/** Alpha placed in a 1024² world with its anchor at the centre (upstream's `_in_world`). */
function inWorld(image: ShadowImage, anchor: { x: number; y: number }) {
  const size = 1024;
  const out = new Uint8Array(size * size);
  const ox = Math.round(size / 2 - anchor.x);
  const oy = Math.round(size / 2 - anchor.y);
  expect(ox).toBeGreaterThanOrEqual(0);
  expect(oy).toBeGreaterThanOrEqual(0);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) out[(y + oy) * size + x + ox] = alphaOf(image, x, y);
  }
  return out;
}

function alphaBounds(image: ShadowImage) {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (!alphaOf(image, x, y)) continue;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

// ── shadow.mjs ─────────────────────────────────────────────────────────────

describe("shadow.mjs", () => {
  test("the defaults are upstream's", () => {
    expect(SHADOW_DEFAULTS).toEqual({ squash: 0.25, shear: 0.8, opacity: 0.4, blur: 3, color: [20, 15, 30] });
    expect(shadowOptions()).toEqual({ squash: 0.25, shear: 0.8, opacity: 0.4, blur: 3, color: [20, 15, 30] });
  });

  for (const shear of [-2, 0, 2]) {
    test(`the foot anchor is a fixed point (shear ${shear})`, () => {
      const image = fill(blank(40, 40), 17, 27, 23, 33, [255, 255, 255, 255]);
      const anchor = { x: 20.5, y: 30.5 };
      const shadow = projectShadow(image, anchor, { squash: 0.5, shear, opacity: 1, blur: 0 });
      const centre = centreOfAlpha(shadow);
      expect(Math.abs(centre.x - shadow.anchor.x)).toBeLessThan(0.6);
      expect(Math.abs(centre.y - shadow.anchor.y)).toBeLessThan(0.6);
    });
  }

  for (const shear of [-1, 1]) {
    test(`shear ${shear} throws the shadow ${shear > 0 ? "left" : "right"} of the feet`, () => {
      const image = fill(blank(40, 40), 17, 7, 22, 12, [255, 255, 255, 255]);
      const shadow = projectShadow(image, { x: 20, y: 40 }, { squash: 0.5, shear, opacity: 1, blur: 0 });
      const centre = centreOfAlpha(shadow);
      // The block's centre is 30 px above the feet: squash 0.5 lands it 15 px
      // up, and shear moves it 30·shear px sideways — left when positive.
      expect(Math.abs(centre.x - shadow.anchor.x - -30 * shear)).toBeLessThan(0.7);
      expect(Math.abs(centre.y - shadow.anchor.y - -15)).toBeLessThan(0.7);
    });
  }

  test("the canvas never crops, whatever the anchor, shear or blur", () => {
    const source = silhouette();
    for (const anchor of [{ x: 0, y: 0 }, { x: 0, y: 48 }, { x: 32, y: 48 }, { x: 7.5, y: 31.5 }]) {
      for (const shear of [-2, 2]) {
        for (const blur of [0, 3, 9]) {
          const options = { squash: 0.5, shear, opacity: 1, blur };
          const shadow = projectShadow(source, anchor, options);
          // More transparent source around it cannot reveal pixels the first
          // projection lost — which catches a clipped shear and a cut blur tail.
          const padded = blank(source.width + 160, source.height + 160);
          for (let y = 0; y < source.height; y++) {
            padded.data.set(source.data.subarray(y * source.width * 4, (y + 1) * source.width * 4), ((y + 80) * padded.width + 80) * 4);
          }
          const reference = projectShadow(padded, { x: anchor.x + 80, y: anchor.y + 80 }, options);
          const same = Buffer.from(inWorld(shadow, shadow.anchor)).equals(Buffer.from(inWorld(reference, reference.anchor)));
          expect({ anchor, shear, blur, same }).toEqual({ anchor, shear, blur, same: true });
          const bounds = alphaBounds(shadow)!;
          expect(bounds.x0).toBeGreaterThan(0);
          expect(bounds.y0).toBeGreaterThan(0);
          expect(bounds.x1).toBeLessThan(shadow.width);
          expect(bounds.y1).toBeLessThan(shadow.height);
        }
      }
    }
  });

  test("the identity projection is the silhouette, in the shadow's colour only", () => {
    const source = silhouette();
    const shadow = projectShadow(source, { x: 16, y: 48 }, { squash: 1, shear: 0, opacity: 1, blur: 0, color: [1, 2, 3] });
    const ox = shadow.anchor.x - 16;
    const oy = shadow.anchor.y - 48;
    for (let y = 0; y < source.height; y++) {
      for (let x = 0; x < source.width; x++) {
        expect(alphaOf(shadow, x + ox, y + oy)).toBe(alphaOf(source, x, y));
      }
    }
    for (let i = 0; i < shadow.data.length; i += 4) {
      expect([shadow.data[i], shadow.data[i + 1], shadow.data[i + 2]]).toEqual([1, 2, 3]);
    }
  });

  test("opacity scales the shadow monotonically and moves nothing", () => {
    const source = silhouette();
    const outputs = [0, 0.2, 0.4, 0.8, 1].map((opacity) => projectShadow(source, { x: 16, y: 48 }, { opacity }));
    expect(new Set(outputs.map((o) => `${o.width}x${o.height}@${o.anchor.x},${o.anchor.y}`)).size).toBe(1);
    const mass = (o: ShadowImage) => { let s = 0; for (let i = 3; i < o.data.length; i += 4) s += o.data[i]; return s; };
    expect(mass(outputs[0])).toBe(0);
    for (let k = 1; k < outputs.length; k++) {
      expect(mass(outputs[k])).toBeGreaterThan(mass(outputs[k - 1]));
      for (let i = 3; i < outputs[k].data.length; i += 4) {
        if (outputs[k].data[i] < outputs[k - 1].data[i]) throw new Error(`opacity step ${k} lowered alpha at ${i}`);
      }
    }
  });

  test("opacity rounds as upstream's lookup table does — halves to even", () => {
    // Every alpha 0..255 once, projected through the identity at opacity 0.5:
    // each odd alpha is a tie, and upstream's `round(value * opacity)` (Python)
    // sends it to the even neighbour.
    const ramp = blank(256, 1);
    for (let x = 0; x < 256; x++) ramp.data[x * 4 + 3] = x;
    const shadow = projectShadow(ramp, { x: 0, y: 1 }, { squash: 1, shear: 0, opacity: 0.5, blur: 0 });
    const ox = shadow.anchor.x;
    const oy = shadow.anchor.y - 1;
    const pyRound = (v: number) => { const f = Math.floor(v); const d = v - f; return d > 0.5 ? f + 1 : d < 0.5 ? f : f % 2 === 0 ? f : f + 1; };
    for (let a = 0; a < 256; a++) expect([a, alphaOf(shadow, a + ox, oy)]).toEqual([a, pyRound(a * 0.5)]);
    expect(alphaOf(shadow, 5 + ox, oy)).toBe(2); // Math.round said 3
  });

  test("the source is not modified", () => {
    const source = silhouette();
    const before = Buffer.from(source.data);
    projectShadow(source, { x: 16, y: 48 });
    expect(Buffer.from(source.data).equals(before)).toBe(true);
  });

  test("an empty silhouette casts nothing", () => {
    const shadow = projectShadow(blank(20, 30), { x: 10, y: 30 });
    expect(alphaBounds(shadow)).toBeNull();
    expect(Number.isFinite(shadow.anchor.x) && Number.isFinite(shadow.anchor.y)).toBe(true);
  });

  test("parameters outside upstream's ranges are refused by name", () => {
    const bad: Array<[string, unknown]> = [
      ["squash", 0], ["squash", -1], ["squash", 2], ["shear", 10000], ["shear", -10000],
      ["opacity", -0.1], ["opacity", 1.1], ["blur", -1], ["blur", 10000],
      ...["squash", "shear", "opacity", "blur"].flatMap((name) => [NaN, Infinity, -Infinity, true, "bad"].map((v) => [name, v] as [string, unknown])),
      ["color", [1, 2]], ["color", [-1, 2, 3]], ["color", [1, 2, 256]], ["color", [1, 2, 3.5]], ["color", "red"],
    ];
    for (const [name, value] of bad) {
      expect(() => projectShadow(silhouette(), { x: 16, y: 48 }, { [name]: value } as never)).toThrow(name);
    }
    expect(() => projectShadow(silhouette(), { x: NaN, y: 2 })).toThrow("anchor");
  });

  test("the geometry depends on the size and the anchor, never on the pixels", () => {
    const options = shadowOptions();
    const a = shadowGeometry(64, 96, { x: 32, y: 90 }, options);
    const empty = projectShadow(blank(64, 96), { x: 32, y: 90 });
    const full = projectShadow(fill(blank(64, 96), 0, 0, 63, 95, [9, 9, 9, 255]), { x: 32, y: 90 });
    expect({ w: empty.width, h: empty.height, anchor: empty.anchor }).toEqual({ w: a.width, h: a.height, anchor: a.anchor });
    expect({ w: full.width, h: full.height, anchor: full.anchor }).toEqual({ w: a.width, h: a.height, anchor: a.anchor });
  });

  test("withShadow puts the frame, unchanged, over its shadow on one canvas", () => {
    const frame = fill(blank(40, 60), 12, 10, 27, 55, [200, 30, 30, 255]);
    fill(frame, 10, 20, 11, 30, [0, 0, 255, 128]);
    const anchor = { x: 20, y: 56 };
    const out = withShadow(frame, anchor);
    const canvas = shadowCanvas(40, 60, anchor);
    expect({ w: out.width, h: out.height, frame: out.frame, anchor: out.anchor })
      .toEqual({ w: canvas.width, h: canvas.height, frame: canvas.frame, anchor: canvas.anchor });
    // The anchor rides with the frame: it is the same foot, moved by the margin.
    expect(out.anchor).toEqual({ x: anchor.x + out.frame.x, y: anchor.y + out.frame.y });
    // Every opaque frame pixel is exactly the frame's.
    for (let y = 10; y <= 55; y++) {
      for (let x = 12; x <= 27; x++) {
        const o = ((y + out.frame.y) * out.width + x + out.frame.x) * 4;
        expect([...out.data.subarray(o, o + 4)]).toEqual([200, 30, 30, 255]);
      }
    }
    // The shadow is there, left of the feet (positive shear), and dark.
    let shadowPixels = 0;
    for (let y = 0; y < out.height; y++) {
      for (let x = 0; x < out.frame.x; x++) {
        const o = (y * out.width + x) * 4;
        if (out.data[o + 3] > 0) {
          shadowPixels++;
          expect([out.data[o], out.data[o + 1], out.data[o + 2]]).toEqual([20, 15, 30]);
        }
      }
    }
    expect(shadowPixels).toBeGreaterThan(0);
    // The half-transparent patch is composited over whatever shadow lies under it.
    const p = ((25 + out.frame.y) * out.width + 10 + out.frame.x) * 4;
    expect(out.data[p + 3]).toBeGreaterThanOrEqual(128);
  });
});

// ── aseprite.mjs ───────────────────────────────────────────────────────────

describe("aseprite.mjs", () => {
  const cell = (x: number, y: number, w = 10, h = 20) => ({ x, y, w, h });
  const doc = asepriteDocument({
    image: "lumi.png",
    size: { w: 40, h: 60 },
    tags: [
      { name: "idle", frames: [0, 1, 2].map((i) => ({ rect: cell(i * 10, 0), duration: 125, anchor: { x: 0.5, y: 0.9 } })) },
      { name: "attack", frames: [0, 1].map((i) => ({ rect: cell(i * 12, 20, 12, 40), duration: 83.3, anchor: { x: 0.5, y: 0.95 } })) },
    ],
  });

  test("frames are keyed by their global playback index, tags cover global ranges", () => {
    expect(Object.keys(doc.frames)).toEqual(["0", "1", "2", "3", "4"]);
    expect(doc.meta.frameTags).toEqual([
      { name: "idle", from: 0, to: 2, direction: "forward" },
      { name: "attack", from: 3, to: 4, direction: "forward" },
    ]);
    expect(doc.meta).toMatchObject({ app: "pneuma-sprite", image: "lumi.png", format: "RGBA8888", size: { w: 40, h: 60 }, scale: "1" });
  });

  test("every frame carries its rect, its own duration in whole ms, and where it stands", () => {
    expect(doc.frames["3"]).toEqual({
      frame: { x: 0, y: 20, w: 12, h: 40 },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: 12, h: 40 },
      sourceSize: { w: 12, h: 40 },
      duration: 83,
      anchor: { x: 0.5, y: 0.95 },
      pivot: { x: 0.5, y: 0.95 },
    });
  });

  /**
   * Phaser 4.2.1 `AnimationManager#createFromAseprite` (src/animations/
   * AnimationManager.js:428-458): for each `meta.frameTags` entry it walks
   * `from..to`, looks each frame up as `frames[i.toString()]`, and reads its
   * `duration` — a frame missing under that key is silently dropped from the
   * animation. Replayed here over the document.
   */
  test("what Phaser's createFromAseprite looks up is there", () => {
    const built = doc.meta.frameTags.map((tag) => {
      const frames: Array<{ frame: string; duration: number }> = [];
      for (let i = tag.from; i <= tag.to; i++) {
        const found = doc.frames[i.toString()];
        if (found) frames.push({ frame: i.toString(), duration: found.duration });
      }
      return { key: tag.name, frames };
    });
    expect(built).toEqual([
      { key: "idle", frames: [{ frame: "0", duration: 125 }, { frame: "1", duration: 125 }, { frame: "2", duration: 125 }] },
      { key: "attack", frames: [{ frame: "3", duration: 83 }, { frame: "4", duration: 83 }] },
    ]);
  });

  /**
   * Phaser's hash parser (src/textures/parsers/JSONHash.js:80, Phaser 3.90 and
   * 4.2.1): `var pivot = src.anchor || src.pivot;` becomes the frame's custom
   * origin. PixiJS 8.21 (lib/spritesheet/Spritesheet.mjs:119):
   * `defaultAnchor: data.anchor`. Both are per frame.
   */
  test("the point each engine turns into the frame's origin is the anchor", () => {
    for (const frame of Object.values(doc.frames)) {
      const phaser = frame.anchor || frame.pivot;
      const pixi = frame.anchor;
      expect(phaser).toEqual(pixi);
    }
  });

  test("refuses what no engine could read", () => {
    expect(() => asepriteDocument({ image: "x.png", size: { w: 1, h: 1 }, tags: [] })).toThrow("no animations");
    expect(() => asepriteDocument({ image: "x.png", size: { w: 1, h: 1 }, tags: [{ name: "a", frames: [] }] })).toThrow("no frames");
    const one = { rect: cell(0, 0), duration: 100, anchor: { x: 0.5, y: 1 } };
    expect(() => asepriteDocument({ image: "x.png", size: { w: 1, h: 1 }, tags: [{ name: "a", frames: [one] }, { name: "a", frames: [one] }] }))
      .toThrow("two animations are named 'a'");
    expect(() => asepriteDocument({ image: "x.png", size: { w: 1, h: 1 }, tags: [{ name: "a", frames: [{ ...one, duration: 0 }] }] }))
      .toThrow("no duration");
    // A frame shorter than half a millisecond is still a frame: 1 ms, not 0.
    const brief = asepriteDocument({ image: "x.png", size: { w: 1, h: 1 }, tags: [{ name: "a", frames: [{ ...one, duration: 0.4 }] }] });
    expect(brief.frames["0"].duration).toBe(1);
  });

  test("sheets stack top to bottom, left-aligned", () => {
    expect(stackLayout([{ width: 744, height: 1008 }, { width: 1088, height: 786 }])).toEqual({
      width: 1088,
      height: 1794,
      offsets: [{ x: 0, y: 0 }, { x: 0, y: 1008 }],
    });
  });

  test("a grid is pack's near-square one", () => {
    const grid = gridLayout(11, { width: 30, height: 20 });
    expect({ width: grid.width, height: grid.height }).toEqual({ width: 120, height: 60 });
    expect(grid.rects[4]).toEqual({ x: 0, y: 20, w: 30, h: 20 });
    expect(grid.rects[10]).toEqual({ x: 60, y: 40, w: 30, h: 20 });
  });
});

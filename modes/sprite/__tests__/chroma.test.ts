/**
 * `chroma.mjs` — the un-mixing keyer, pinned on synthetic RGBA buffers whose
 * right answer is known by construction: a pixel that is half subject S and
 * half plate P is `0.5·S + 0.5·P`, and keying it has to give back S at half
 * coverage. No ffmpeg: the module is pure pixels in, pixels out, so this file
 * runs everywhere the routine suite does. The CLI wiring (which keyer runs,
 * what the reports carry) is pinned end to end in `sprite-sheet.test.ts`.
 *
 * The two defects the keyer exists to beat are pinned by value here, measured
 * on ffmpeg 8.0 when the port was made:
 *   - `colorkey` keeps RGB: a dark edge pixel `(0,145,0)` stays pure green at
 *     α≈148 — `from-video`'s 1 px green rim;
 *   - `despill=type=green:mix=0.6:expand=0.5` pulls a fifth of the green out
 *     of every neutral pixel: white → (255,204,255), skin and yellow → pink.
 */

import { describe, expect, test } from "bun:test";

import {
  keyFrame, keyRadius, keyResidue, measurePlate, plateOf, plateProximity, plateSplit, poolResidue,
  type Rgb, type RgbaImage,
} from "../skill/scripts/chroma.mjs";

const GREEN: Rgb = [0, 255, 0];
const RADIUS = keyRadius(0.22);

function canvas(width: number, height: number, fill: Rgb, alpha = 255): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill[0]; data[i + 1] = fill[1]; data[i + 2] = fill[2]; data[i + 3] = alpha;
  }
  return { width, height, data };
}

function paint(image: RgbaImage, x0: number, y0: number, w: number, h: number, color: Rgb, alpha = 255) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const i = (y * image.width + x) * 4;
      image.data[i] = color[0]; image.data[i + 1] = color[1]; image.data[i + 2] = color[2]; image.data[i + 3] = alpha;
    }
  }
}

function at(image: RgbaImage, x: number, y: number): number[] {
  const i = (y * image.width + x) * 4;
  return [...image.data.subarray(i, i + 4)];
}

const blend = (s: Rgb, p: Rgb, k: number): Rgb =>
  [0, 1, 2].map((c) => Math.round((1 - k) * s[c] + k * p[c])) as Rgb;

/** A 32×32 green plate with a 16×16 subject block of `fill` at (8,8), and the
 *  block's left column replaced by `edge` — the pixel next to the plate. */
function edgeScene(fill: Rgb, edge: Rgb) {
  const image = canvas(32, 32, GREEN);
  paint(image, 8, 8, 16, 16, fill);
  paint(image, 8, 8, 1, 16, edge);
  return image;
}

function keyed(image: RgbaImage, plateColor: Rgb = GREEN) {
  const stats = keyFrame(image, plateOf(plateColor), { radius: RADIUS });
  return { image, stats };
}

describe("plateSplit: which channels a plate saturates", () => {
  test("chroma plates, including the ones upstream's border rule refused", () => {
    expect(plateSplit([0, 240, 3])).toEqual({ keyed: [1], unkeyed: [0, 2] });
    // Broadcast green: its blue (64) fails upstream's "unkeyed < 64", and
    // the fixture clips in this suite are drawn on it.
    expect(plateSplit([0, 177, 64])).toEqual({ keyed: [1], unkeyed: [0, 2] });
    // Grok's magenta, measured by upstream: blue/red 0.68, two keyed channels.
    expect(plateSplit([216, 46, 147])).toEqual({ keyed: [0, 2], unkeyed: [1] });
    expect(plateSplit([20, 60, 230])).toEqual({ keyed: [2], unkeyed: [0, 1] });
  });

  test("a white, cream or grey plate has no hue to lean on", () => {
    for (const neutral of [[255, 255, 255], [236, 233, 225], [128, 128, 128], [150, 220, 150]]) {
      expect({ neutral, split: plateSplit(neutral) }).toEqual({ neutral, split: null });
    }
    expect(plateOf("#ece9e1").chroma).toBe(false);
    expect(() => keyFrame(canvas(4, 4, [236, 233, 225]), plateOf("#ece9e1"), { radius: RADIUS })).toThrow(/colorkey/);
  });
});

describe("measurePlate: the plate as the clip painted it", () => {
  test("the mode over several frames' borders, not one corner of frame 0", () => {
    const painted: Rgb = [8, 240, 13];
    const frames = Array.from({ length: 4 }, () => canvas(40, 40, painted));
    // Frame 0's top-left corner is all subject — a median of corner patches
    // on that frame alone would be pulled toward it; the mode is not.
    paint(frames[0], 0, 0, 12, 12, [200, 40, 60]);
    const plate = measurePlate(frames, { key: "auto", radius: RADIUS })!;
    expect(plate.painted).toEqual(painted);
    expect(plate.hex).toBe("#08f00d");
    expect(plate.chroma).toBe(true);
    expect(plate.plateShare).toBeGreaterThan(0.9);
    expect(plate.plateShare).toBeLessThan(1);
  });

  test("an explicit colour is taken at its word; no opaque border is no plate", () => {
    const frames = [canvas(20, 20, [8, 240, 13])];
    expect(measurePlate(frames, { key: [0, 255, 0], radius: RADIUS })!.painted).toEqual([0, 255, 0]);
    expect(measurePlate([canvas(20, 20, GREEN, 0)], { key: "auto", radius: RADIUS })).toBeNull();
  });
});

describe("keyFrame: hard cut, un-mix, spill", () => {
  test("a half-and-half edge pixel un-mixes back to the subject at half coverage", () => {
    const subject: Rgb = [160, 128, 96];
    const { image } = keyed(edgeScene(subject, blend(subject, GREEN, 0.5)));
    const [r, g, b, a] = at(image, 8, 12);
    // colorkey would have kept (80,192,48) — half green — at partial alpha.
    expect(Math.abs(r - subject[0])).toBeLessThanOrEqual(3);
    expect(Math.abs(g - subject[1])).toBeLessThanOrEqual(3);
    expect(Math.abs(b - subject[2])).toBeLessThanOrEqual(3);
    expect(Math.abs(a - 128)).toBeLessThanOrEqual(3);
    // The block's interior is subject and never touched.
    expect(at(image, 16, 16)).toEqual([...subject, 255]);
  });

  test("colorkey's dark-green rim pixel comes out as the ink it was, at the coverage it had", () => {
    // (0,145,0) next to the plate is ~43% black ink and ~57% plate. colorkey
    // leaves it pure green at α≈148; despill after it paints it (0,0,0) at
    // that same α — the colour is right only by accident, the coverage never
    // is. Un-mixed, it comes back as near-black ink at ~43 % coverage.
    const { image } = keyed(edgeScene([20, 16, 24], [0, 145, 0]));
    const [r, g, b, a] = at(image, 8, 12);
    expect(Math.max(r, g, b)).toBeLessThanOrEqual(8);
    expect(a).toBeGreaterThan(95);
    expect(a).toBeLessThan(125);
  });

  test("neutral, skin and yellow edges stay exactly as drawn — the despill defect", () => {
    // ffmpeg despill turned each of these pink or salmon; a gold or yellow
    // edge is also what upstream's mean-channel tint reads as a green blend.
    for (const color of [[255, 255, 255], [128, 128, 128], [240, 200, 170], [240, 215, 130], [212, 175, 55]] as Rgb[]) {
      const { image } = keyed(edgeScene(color, color));
      expect({ color, edge: at(image, 8, 12) }).toEqual({ color, edge: [...color, 255] });
    }
  });

  test("everything within the radius of the plate goes, all four bytes", () => {
    const image = canvas(16, 16, [10, 245, 12]);
    paint(image, 4, 4, 8, 8, [200, 30, 30]);
    const { stats } = keyed(image);
    expect(stats.keyed).toBe(16 * 16 - 64);
    expect(at(image, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(at(image, 15, 15)).toEqual([0, 0, 0, 0]);
    // Already-transparent input counts as keyed and is zeroed too.
    const ghost = canvas(8, 8, [200, 30, 30], 0);
    keyed(ghost);
    expect(at(ghost, 3, 3)).toEqual([0, 0, 0, 0]);
  });

  test("key-leaning material deeper than the fringe is the character's, and is left alone", () => {
    // Teal leans green (G above R and B) and sits inside 180 of the plate:
    // an in-band blend by class, so only its outer two pixels may be un-mixed.
    const teal: Rgb = [40, 140, 120];
    const image = canvas(32, 32, GREEN);
    paint(image, 4, 4, 24, 24, teal);
    keyed(image);
    expect(at(image, 16, 16)).toEqual([...teal, 255]);
    expect(at(image, 4 + 4, 16)).toEqual([...teal, 255]);
    // ...while the pixel on the plate is read as a blend and loses coverage.
    expect(at(image, 4, 16)[3]).toBeLessThan(255);
  });

  test("a small green cluster inside the subject is spill: recoloured, never made transparent", () => {
    const image = canvas(64, 64, GREEN);
    paint(image, 8, 8, 48, 48, [128, 128, 128]);
    paint(image, 30, 30, 3, 3, [60, 200, 60]);
    const { stats } = keyed(image);
    expect(stats.spillClusters).toBe(1);
    const [r, g, b, a] = at(image, 31, 31);
    expect(a).toBe(255);
    expect(g - Math.max(r, b)).toBeLessThanOrEqual(8);
  });

  test("a large green region inside the subject is material, not spill", () => {
    const image = canvas(64, 64, GREEN);
    paint(image, 8, 8, 48, 48, [128, 128, 128]);
    paint(image, 24, 24, 10, 10, [60, 200, 60]);
    const { stats } = keyed(image);
    expect(stats.spillClusters).toBe(0);
    expect(at(image, 28, 28)).toEqual([60, 200, 60, 255]);
  });

  test("the result does not depend on what the previous frame left in the working arrays", () => {
    const first = keyed(edgeScene([160, 128, 96], blend([160, 128, 96], GREEN, 0.5))).image;
    keyed(canvas(64, 64, [60, 200, 60]));
    const again = keyed(edgeScene([160, 128, 96], blend([160, 128, 96], GREEN, 0.5))).image;
    expect([...again.data]).toEqual([...first.data]);
  });
});

describe("keyResidue: what a cut still shows of the plate", () => {
  test("counts visible and soft-edge pixels with the plate's hue", () => {
    const plate = plateOf(GREEN);
    const image = canvas(10, 10, [0, 0, 0], 0);
    paint(image, 0, 0, 10, 5, [200, 60, 60]);          // 50 subject px
    paint(image, 0, 5, 4, 1, [0, 145, 0], 148);        // colorkey's rim: tinted, partial
    paint(image, 4, 5, 2, 1, [80, 192, 48], 177);      // an un-mixed-not blend: tinted, partial
    paint(image, 6, 5, 2, 1, [90, 110, 90], 200);      // leans green by 20: not the plate's hue
    paint(image, 8, 5, 2, 1, [0, 200, 0], 8);          // under the threshold: not visible
    const counts = keyResidue(image, plate, 16)!;
    expect(counts).toEqual({ visible: 58, tinted: 6, partial: 8, partialTinted: 6 });
    const pooled = poolResidue([counts, null, { visible: 42, tinted: 0, partial: 2, partialTinted: 0 }])!;
    expect(pooled.visible).toBeCloseTo(6 / 100, 10);
    expect(pooled.edge).toBeCloseTo(6 / 10, 10);
  });

  test("a plate with no hue has no residue to count", () => {
    expect(keyResidue(canvas(4, 4, [255, 255, 255]), plateOf("#ffffff"), 16)).toBeNull();
    expect(poolResidue([null, null])).toBeNull();
  });

  test("what the un-mix leaves is clean where colorkey's rim was not", () => {
    const plate = plateOf(GREEN);
    const scene = edgeScene([20, 16, 24], [0, 145, 0]);
    // colorkey, emulated: alpha only, RGB kept.
    const colorkeyed = edgeScene([20, 16, 24], [0, 145, 0]);
    paint(colorkeyed, 8, 8, 1, 16, [0, 145, 0], 148);
    for (let i = 0; i < colorkeyed.data.length; i += 4) {
      if (colorkeyed.data[i + 1] === 255 && colorkeyed.data[i] === 0) colorkeyed.data.fill(0, i, i + 4);
    }
    expect(keyResidue(colorkeyed, plate, 16)!.tinted).toBe(16);
    keyed(scene);
    expect(keyResidue(scene, plate, 16)!.tinted).toBe(0);
  });
});

describe("plateProximity: subject pixels a plate would take with it", () => {
  test("counts pixels inside the radius, not speckles, and names the nearest colour", () => {
    const image = canvas(24, 24, [0, 0, 0], 0);
    paint(image, 2, 2, 20, 20, [180, 60, 200]);
    paint(image, 6, 6, 4, 4, [30, 220, 40]);   // a green gem: 16 px within the key radius
    paint(image, 16, 16, 1, 1, [0, 255, 0]);   // one stray pixel: a speckle, not counted
    const near = plateProximity(image, GREEN, { radius: RADIUS, threshold: 16 });
    expect(near.subject).toBe(400);
    expect(near.within).toBe(16);
    expect(near.fraction).toBeCloseTo(16 / 400, 10);
    expect(near.nearest).toBe("#1edc28");
    expect(near.minDistance).toBeCloseTo(Math.hypot(30, 35, 40), 6);
  });

  test("a subject far from the plate clears it", () => {
    const image = canvas(12, 12, [0, 0, 0], 0);
    paint(image, 2, 2, 8, 8, [200, 40, 60]);
    const near = plateProximity(image, GREEN, { radius: RADIUS, threshold: 16 });
    expect(near.within).toBe(0);
    expect(near.minDistance).toBeGreaterThan(RADIUS);
  });
});

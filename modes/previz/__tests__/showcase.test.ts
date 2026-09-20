/**
 * The launcher gallery's own surface: `showcase.json` and the PNGs it names.
 *
 * The copy and the art are written in separate passes, and the launcher
 * serves `showcase/*` straight off disk — so a highlight naming a file nobody
 * ever captured is a 404 on a gallery card and nothing else reports it
 * (shape adapted from `modes/lucid/__tests__/registration.test.ts`).
 *
 * The size assertion is not decoration: the gallery lays these out in a 16:9
 * frame, so an image captured at a Retina scale factor (2752 × 1536) or at a
 * stray viewport ships heavier and lands cropped. Reading the PNG header is
 * enough to catch both without decoding the image.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SHOWCASE_DIR = join(import.meta.dir, "..", "showcase");
const showcase = JSON.parse(readFileSync(join(SHOWCASE_DIR, "showcase.json"), "utf-8"));

/** Width and height out of a PNG's IHDR, without decoding the pixels. */
function pngSize(file: string): { width: number; height: number } {
  const bytes = readFileSync(file);
  const signature = bytes.subarray(0, 8).toString("hex");
  expect(signature).toBe("89504e470d0a1a0a");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("showcase copy", () => {
  test("five highlights with localized titles and non-placeholder copy", () => {
    // Five, not three: what the model is conditioned on, the shared clock, the
    // 3D inspection, the acceptance record and the price are five independent
    // claims — none of them implies another.
    expect(showcase.hero).toBe("hero.png");
    expect(showcase.highlights).toHaveLength(5);
    expect(Object.keys(showcase.tagline).sort()).toEqual(["en", "ja", "zh-CN"]);
    for (const highlight of showcase.highlights) {
      expect(Object.keys(highlight.title).sort()).toEqual(["en", "ja", "zh-CN"]);
      expect(Object.keys(highlight.description).sort()).toEqual(["en", "ja", "zh-CN"]);
      expect(highlight.description.en.length).toBeGreaterThan(80);
      expect(highlight.media).toMatch(/^highlight-[\w-]+\.png$/);
      expect(highlight.mediaType).toBe("image");
      expect(JSON.stringify(highlight)).not.toContain("TODO");
    }
  });
});

describe("showcase art", () => {
  const referenced: string[] = [
    showcase.hero,
    ...showcase.highlights.map((h: { media: string }) => h.media),
  ];

  test("every referenced image is on disk", () => {
    const onDisk = new Set(readdirSync(SHOWCASE_DIR));
    expect(referenced.filter((media) => !onDisk.has(media))).toEqual([]);
  });

  test("every image is exactly 1376 × 768", () => {
    const sizes = referenced.map((media) => ({ media, ...pngSize(join(SHOWCASE_DIR, media)) }));
    expect(sizes).toEqual(referenced.map((media) => ({ media, width: 1376, height: 768 })));
  });

  test("the compositions that produced them are shipped beside them", () => {
    // `layout.html` + `preview.mjs` are how these are re-captured; losing them
    // turns the gallery into six PNGs nobody can reproduce or correct.
    const onDisk = new Set(readdirSync(SHOWCASE_DIR));
    expect(onDisk.has("layout.html")).toBe(true);
    expect(onDisk.has("preview.mjs")).toBe(true);
    expect(onDisk.has("README.md")).toBe(true);
  });
});

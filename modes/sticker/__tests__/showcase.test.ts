/**
 * The launcher gallery's own surface: `showcase.json` and the PNGs it names.
 *
 * The copy and the art are written in separate passes, and the launcher
 * serves `showcase/*` straight off disk — so a highlight naming a file nobody
 * ever drew is a 404 on a gallery card and nothing else reports it (shape
 * adapted from `modes/anime-series/__tests__/showcase.test.ts`).
 *
 * The size assertion is not decoration: the gallery lays these out in a 16:9
 * frame, so an image saved at a Retina scale factor (2752 × 1536) or at a
 * stray size ships heavier and lands cropped. Reading the PNG header is
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
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("showcase copy", () => {
  test("three highlights with localized titles and non-placeholder copy", () => {
    // Three: one character drawn into every sticker, judged on both chat
    // backgrounds, checked against each store's rules.
    expect(showcase.hero).toBe("hero.png");
    expect(showcase.highlights).toHaveLength(3);
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
  const referenced: string[] = [showcase.hero, ...showcase.highlights.map((h: { media: string }) => h.media)];

  test("every referenced image is on disk", () => {
    const onDisk = new Set(readdirSync(SHOWCASE_DIR));
    expect(referenced.filter((media) => !onDisk.has(media))).toEqual([]);
  });

  test("every image is exactly 1376 × 768", () => {
    const sizes = referenced.map((media) => ({ media, ...pngSize(join(SHOWCASE_DIR, media)) }));
    expect(sizes).toEqual(referenced.map((media) => ({ media, width: 1376, height: 768 })));
  });

  test("the prompt that drew each image is recorded beside it", () => {
    // These are generated mockups, so what has to survive is the recipe:
    // prompts.json holds the shared style, each image's prompt and the
    // references it was drawn from. Without it the gallery is four PNGs
    // nobody can redraw or correct.
    const prompts = JSON.parse(readFileSync(join(SHOWCASE_DIR, "prompts.json"), "utf-8"));
    expect(Object.keys(prompts.images).sort()).toEqual([...referenced].sort());
    for (const media of referenced) expect(prompts.images[media].prompt.length).toBeGreaterThan(40);
  });

  test("no unreferenced picture is left in the directory", () => {
    // The gallery is served off disk by name; an orphan is dead weight in
    // the mode's archive and a tempting wrong reference.
    const pngs = readdirSync(SHOWCASE_DIR).filter((f) => f.endsWith(".png"));
    expect(pngs.sort()).toEqual([...referenced].sort());
  });
});

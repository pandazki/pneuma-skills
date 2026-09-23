/**
 * The slide gallery ships four seeds inside the npm package: one English and one
 * Chinese deck, each in a dark and a light theme. These tests pin what makes them
 * complete, honest and small:
 *  - each seed resolves, has a thumbnail, and is a whole deck (manifest, theme,
 *    outline, every listed slide and nothing unlisted);
 *  - the dark and light seeds of a language differ only in theme.css;
 *  - every manifest title names what its slide actually shows;
 *  - every referenced asset ships, nothing unreferenced does, and images stay web-sized;
 *  - swatch labels printed from theme.css match the tokens they describe, and the
 *    muted text token keeps 4.5:1 on the surfaces small text sits on.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import manifest from "../manifest.js";
import { resolveSeedCatalog } from "../../../server/seed-installer.js";

const REPO = join(import.meta.dir, "../../..");
const MODE = join(import.meta.dir, "..");
const SEEDS: string[] = ["en-dark", "en-light", "zh-dark", "zh-light"];
const PAIRS: [string, string][] = [["en-dark", "en-light"], ["zh-dark", "zh-light"]];
/** Per-image and per-seed ceilings: the seeds ship in the npm package. */
const MAX_IMAGE_BYTES = 300 * 1024;
const MAX_SEED_BYTES = 400 * 1024;

const seedDir = (id: string) => join(MODE, "seed", id);
const walk = (dir: string, prefix = ""): string[] =>
  readdirSync(dir).flatMap((name) => {
    const abs = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    return statSync(abs).isDirectory() ? walk(abs, rel) : [rel];
  });
const read = (id: string, rel: string) => readFileSync(join(seedDir(id), rel), "utf-8");
const deck = (id: string) =>
  JSON.parse(read(id, "manifest.json")) as { title: string; slides: { file: string; title: string }[] };

/** Letters, digits and CJK only, lowercased, so punctuation and line breaks don't matter. */
const norm = (s: string) =>
  s
    .replace(/<br\s*\/?>/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z]+;/g, " ")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");

/** Text of the slide's headings plus its kicker / eyebrow line. */
const headline = (html: string) =>
  [...html.matchAll(/<(h1|h2)[^>]*>([\s\S]*?)<\/\1>|class="(?:kicker|eyebrow)"[^>]*>([\s\S]*?)<\/(?:div|p)>/g)]
    .map((m) => norm(m[2] ?? m[3] ?? ""))
    .join("|");

const tokens = (css: string) =>
  Object.fromEntries([...css.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

const luminance = (hex: string) => {
  const c = [0, 2, 4]
    .map((i) => parseInt(hex.replace("#", "").slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("slide seed gallery", () => {
  test("four seeds resolve to real directories with thumbnails", () => {
    const seeds = resolveSeedCatalog(manifest.init?.seedFiles, manifest.init?.seeds);
    expect(seeds.map((s) => s.id)).toEqual(SEEDS);
    for (const seed of seeds) {
      const key = seed.sourceKey as string;
      expect(statSync(join(REPO, key)).isDirectory()).toBe(true);
      expect(existsSync(join(MODE, "seed-gallery", seed.thumbnail!))).toBe(true);
    }
  });

  test.each(SEEDS)("%s is a complete deck: every listed slide, nothing unlisted", (id) => {
    for (const f of ["manifest.json", "theme.css", "design_outline.md"]) {
      expect(existsSync(join(seedDir(id), f))).toBe(true);
    }
    const listed = deck(id).slides.map((s) => s.file).sort();
    const shipped = walk(join(seedDir(id), "slides")).map((f) => `slides/${f}`).sort();
    expect(shipped).toEqual(listed);
    const allowed = new Set(["manifest.json", "theme.css", "design_outline.md"]);
    const stray = walk(seedDir(id)).filter(
      (f) => !allowed.has(f) && !f.startsWith("slides/") && !f.startsWith("assets/"),
    );
    expect(stray).toEqual([]);
  });

  test.each(PAIRS)("%s and %s differ only in theme.css", (dark, light) => {
    const files = (id: string) => walk(seedDir(id)).filter((f) => f !== "theme.css").sort();
    expect(files(light)).toEqual(files(dark));
    for (const f of files(dark)) {
      const same = readFileSync(join(seedDir(dark), f)).equals(readFileSync(join(seedDir(light), f)));
      expect({ file: f, same }).toEqual({ file: f, same: true });
    }
  });

  test.each(SEEDS)("%s manifest titles name what each slide shows", (id) => {
    for (const { file, title } of deck(id).slides) {
      const shown = headline(read(id, file));
      expect({ file, found: shown.includes(norm(title)) }).toEqual({ file, found: true });
    }
  });

  test.each(SEEDS)("%s ships every referenced asset, nothing unused, at web size", (id) => {
    const refs = new Set<string>();
    for (const { file } of deck(id).slides) {
      for (const m of read(id, file).matchAll(/(?:src="|url\(['"]?)(assets\/[^"')\s]+)/g)) refs.add(m[1]);
    }
    const shipped = existsSync(join(seedDir(id), "assets"))
      ? walk(join(seedDir(id), "assets")).map((f) => `assets/${f}`)
      : [];
    expect([...refs].filter((r) => !shipped.includes(r))).toEqual([]);
    expect(shipped.filter((s) => !refs.has(s))).toEqual([]);
    for (const a of shipped) {
      expect({ a, ok: statSync(join(seedDir(id), a)).size <= MAX_IMAGE_BYTES }).toEqual({ a, ok: true });
    }
    const total = walk(seedDir(id)).reduce((n, f) => n + statSync(join(seedDir(id), f)).size, 0);
    expect(total).toBeLessThanOrEqual(MAX_SEED_BYTES);
  });

  test.each(SEEDS)("%s theme labels match their tokens and muted text keeps 4.5:1", (id) => {
    const t = tokens(read(id, "theme.css"));
    const labels = Object.keys(t).filter((k) => k.startsWith("label-"));
    expect(labels.length).toBeGreaterThan(0);
    for (const k of labels) {
      const color = t[`color-${k.slice("label-".length)}`];
      expect({ k, label: t[k].replace(/"/g, "").toLowerCase() }).toEqual({ k, label: color?.toLowerCase() });
    }
    for (const bg of ["color-bg", "color-surface"]) {
      expect(contrast(t["color-muted"], t[bg])).toBeGreaterThanOrEqual(4.5);
    }
  });
});

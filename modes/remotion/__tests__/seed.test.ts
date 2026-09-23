/**
 * The remotion gallery seeds are compound: `seed/shared/` (project, assets, scenes) plus
 * one `seed/<locale>/` overlay that contributes only `src/locale.ts`. These tests pin the
 * invariants that make that composition a working project:
 *  - the manifest's two seeds resolve and point at real directories and thumbnails;
 *  - every asset a scene references ships in shared/public, and nothing else does;
 *  - each composed project compiles in the live-preview compiler (with the viewer's
 *    Babel transpiler), and Root.tsx's literal duration matches the scene timeline;
 *  - the mode-catalog pile is deterministic, settles, and every tile has copy in
 *    every locale.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import * as Babel from "@babel/standalone";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import * as remotion from "remotion";
import manifest from "../manifest.js";
import { resolveSeedCatalog } from "../../../server/seed-installer.js";
import { parseCompositions } from "../viewer/composition-parser.js";
import { buildModuleMap, setTranspiler } from "../viewer/remotion-compiler.js";
import { simulate } from "../seed/shared/src/physics.ts";
import type { SimSpec } from "../seed/shared/src/physics.ts";

const REPO = join(import.meta.dir, "../../..");
const MODE = join(import.meta.dir, "..");
const SHARED = join(MODE, "seed/shared");
const LOCALES = ["en", "zh"] as const;

const walk = (dir: string, prefix = ""): string[] =>
  readdirSync(dir).flatMap((name) => {
    const abs = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    return statSync(abs).isDirectory() ? walk(abs, rel) : [rel];
  });

/** shared + locale overlay, as the gallery applies them (later keys win). */
const compose = (locale: string) => {
  const files = new Map<string, string>();
  for (const root of [SHARED, join(MODE, "seed", locale)]) {
    for (const rel of walk(join(root, "src"))) files.set(`src/${rel}`, readFileSync(join(root, "src", rel), "utf-8"));
  }
  return files;
};

const compile = (locale: string) => {
  const files = compose(locale);
  const src = [...files].filter(([p]) => !p.endsWith("index.ts")).map(([path, content]) => ({ path, content }));
  const map = buildModuleMap(src, { remotion, react: React, "react/jsx-runtime": jsxRuntime });
  return { files, map };
};

describe("remotion seed gallery", () => {
  test("two compound seeds resolve, English first, with real sources and thumbnails", () => {
    const seeds = resolveSeedCatalog(manifest.init?.seedFiles, manifest.init?.seeds);
    expect(seeds.map((s) => s.id)).toEqual(["pneuma-intro-en", "pneuma-intro-zh"]);
    for (const seed of seeds) {
      const keys = Array.isArray(seed.sourceKey) ? seed.sourceKey : [seed.sourceKey];
      expect(keys[0]).toBe("modes/remotion/seed/shared/");
      for (const k of keys) expect(statSync(join(REPO, k)).isDirectory()).toBe(true);
      expect(existsSync(join(MODE, "seed-gallery", seed.thumbnail!))).toBe(true);
    }
  });

  test("locale overlays contribute only src/locale.ts", () => {
    for (const locale of LOCALES) expect(walk(join(MODE, "seed", locale))).toEqual(["src/locale.ts"]);
  });

  test("every staticFile() asset ships in shared/public, and nothing unused does", () => {
    const refs = new Set<string>();
    for (const rel of walk(join(SHARED, "src"))) {
      for (const m of readFileSync(join(SHARED, "src", rel), "utf-8").matchAll(/staticFile\("([^"]+)"\)/g)) refs.add(m[1]);
      // pillar images are named in a table and passed through staticFile(p.img)
      for (const m of readFileSync(join(SHARED, "src", rel), "utf-8").matchAll(/img: "([^"]+)"/g)) refs.add(m[1]);
    }
    const shipped = new Set(walk(join(SHARED, "public")));
    expect([...refs].filter((r) => !shipped.has(r))).toEqual([]);
    expect([...shipped].filter((s) => !refs.has(s))).toEqual([]);
  });
});

describe("composed projects in the live-preview compiler", () => {
  beforeAll(() => {
    // Same transpiler configuration as modes/remotion/viewer/use-remotion-compiler.ts.
    setTranspiler((source, filename) =>
      Babel.transform(source, { presets: ["react", "typescript"], filename, sourceType: "module" }).code ?? "",
    );
  });
  afterAll(() => {
    // Back to the module's default (Bun.Transpiler) for other test files.
    setTranspiler(null as unknown as Parameters<typeof setTranspiler>[0]);
  });

  for (const locale of LOCALES) {
    test(`${locale}: compiles without errors and Root's duration matches the timeline`, () => {
      const { files, map } = compile(locale);
      const errors = [...map].filter(([, exp]) => exp.__error).map(([p, exp]) => `${p}: ${exp.__error}`);
      expect(errors).toEqual([]);
      const intro = map.get("src/PneumaIntro.tsx")!;
      expect(typeof intro.PneumaIntro).toBe("function");
      const [comp] = parseCompositions(files.get("src/Root.tsx")!);
      expect(comp).toMatchObject({ id: "PneumaIntro", componentName: "PneumaIntro", fps: 30, width: 1280, height: 720 });
      expect(comp.durationInFrames).toBe(intro.PNEUMA_INTRO_DUR as number);
    });

    test(`${locale}: every mode tile has a label`, () => {
      const { map } = compile(locale);
      const tiles = map.get("src/SceneModes.tsx")!.TILES as { id: string; kind?: string }[];
      const labels = (map.get("src/locale.ts")!.T as { modes: { labels: Record<string, string> } }).modes.labels;
      expect(tiles.filter((t) => t.kind !== "yours" && !labels[t.id]).map((t) => t.id)).toEqual([]);
    });
  }

  test("locales carry the same copy keys", () => {
    const shape = (v: unknown): unknown =>
      Array.isArray(v) ? v.map(shape) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)])) : typeof v;
    const [en, zh] = LOCALES.map((l) => shape(compile(l).map.get("src/locale.ts")!.T));
    expect(zh).toEqual(en);
  });

  test("the mode-catalog pile is deterministic, stays in bounds and comes to rest", () => {
    const spec = compile("en").map.get("src/SceneModes.tsx")!.SPEC as SimSpec;
    const a = simulate(spec);
    const b = simulate(spec);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const last = a[a.length - 1];
    const tenBefore = a[a.length - 11];
    last.forEach((p, i) => {
      expect(p).not.toBeNull();
      const d = spec.drops[i];
      // resting on the shelf (top at y = 6.48) and between the side walls (x 0.8 … 12.0)
      expect(p!.y + Math.min(d.w, d.h) / 2).toBeLessThanOrEqual(6.48 + 0.02);
      expect(p!.x).toBeGreaterThan(0.8);
      expect(p!.x).toBeLessThan(12.0);
      const q = tenBefore[i]!;
      expect(Math.hypot(p!.x - q.x, p!.y - q.y)).toBeLessThan(0.005); // < 0.5 px over the last 10 frames
    });
  });
});

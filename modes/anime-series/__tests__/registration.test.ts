/**
 * The mode is registered where each consumer looks, and the manifest's
 * install surface matches what the scripts and the seed actually need.
 * Shape adapted from `modes/lucid/__tests__/registration.test.ts`.
 *
 * Not covered here: `skill/SKILL.md` invariants. The skill text is owned by
 * the skill's author, who pins it with the text.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { isCatalogMode, resolveCatalogMode } from "../../../core/mode-catalog.js";
import { listBuiltinModes } from "../../../core/mode-loader.js";
import { parseManifestTs } from "../../../core/utils/manifest-parser.js";
import manifest from "../manifest.js";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const MODE_DIR = join(REPO_ROOT, "modes", "anime-series");
const SHARED_DIR = join(REPO_ROOT, "modes", "_shared", "scripts");
const read = (path: string) => readFileSync(path, "utf-8");
const NAME = "anime-series";

describe("registration", () => {
  test("a catalog mode: resolved from its own directory, not a builtin", () => {
    expect(listBuiltinModes()).not.toContain(NAME);
    const bundled = (JSON.parse(read(join(REPO_ROOT, "modes", "distribution.json"))) as { bundled: string[] }).bundled;
    expect(bundled).not.toContain(NAME);
    expect(isCatalogMode(NAME)).toBe(true);
    expect(resolveCatalogMode(NAME)?.modeDir).toBe(MODE_DIR);
  });

  test("the launcher card reads: parsed manifest text and a showcase with a tagline", () => {
    const parsed = parseManifestTs(read(join(MODE_DIR, "manifest.ts")), "zh-CN");
    expect(parsed.name).toBe(NAME);
    expect(parsed.version).toBe(manifest.version);
    expect(parsed.displayName).toBe("动画单元剧");
    expect(parsed.icon).toContain("<svg");
    const showcase = JSON.parse(read(join(MODE_DIR, "showcase", "showcase.json")));
    expect(Object.keys(showcase.tagline).sort()).toEqual(["en", "ja", "zh-CN"]);
    expect(manifest.hidden).toBeUndefined();
  });

  test("both READMEs list it, credit upstream, and the zh row is Chinese", () => {
    expect(manifest.inspiredBy).toEqual({
      name: "10291124jcjc-dotcom/ai-anime-series",
      url: "https://github.com/10291124jcjc-dotcom/ai-anime-series",
    });
    for (const rel of ["README.md", "README.zh.md"]) {
      const text = read(join(REPO_ROOT, rel));
      const row = text.split("\n").find((l) => l.startsWith(`| **${NAME}**`)) ?? "";
      expect(row).toContain(manifest.inspiredBy!.url);
      expect(text.split("\n").some((l) => l.trimStart().startsWith(`${NAME} `))).toBe(true);
    }
    const zh = read(join(REPO_ROOT, "README.zh.md")).split("\n").find((l) => l.startsWith(`| **${NAME}**`))!;
    expect((zh.match(/[一-鿿]/g) ?? []).length).toBeGreaterThan(40);
  });

  test("manifest.ts carries no React", () => {
    const source = read(join(MODE_DIR, "manifest.ts"));
    expect(source).not.toMatch(/from\s+["']react/);
    expect(source).not.toMatch(/from\s+["']\.\/viewer\//);
  });
});

describe("the install surface", () => {
  /** Shared scripts reachable from the mode's scripts: `importShared("x")`, then each one's `./y` imports. */
  function sharedClosure(): string[] {
    const found = new Set<string>();
    const queue: string[] = [];
    const scriptsDir = join(MODE_DIR, "skill", "scripts");
    for (const file of readdirSync(scriptsDir).filter((f) => f.endsWith(".mjs"))) {
      for (const m of read(join(scriptsDir, file)).matchAll(/importShared\(\s*"([^"]+\.mjs)"/g)) queue.push(m[1]);
    }
    while (queue.length) {
      const name = queue.shift()!;
      if (found.has(name)) continue;
      found.add(name);
      for (const m of read(join(SHARED_DIR, name)).matchAll(/^import[^;]*?from\s+"\.\/([^"]+\.mjs)"/gms)) queue.push(m[1]);
    }
    return [...found].sort();
  }

  test("sharedScripts is exactly the transitive set the scripts import", () => {
    expect([...(manifest.skill.sharedScripts ?? [])].sort()).toEqual(sharedClosure());
  });

  test("API keys map to sensitive params", () => {
    expect(manifest.skill.envMapping).toEqual({ FAL_KEY: "falApiKey", OPENROUTER_API_KEY: "openrouterApiKey" });
    for (const name of ["falApiKey", "openrouterApiKey"]) {
      expect(manifest.init!.params!.find((p) => p.name === name)?.sensitive).toBe(true);
    }
  });

  test("the viewer watches text only; media comes from /content", () => {
    // A directory glob that matches images or clips would put them in the
    // file snapshot and every content_update.
    for (const pattern of manifest.viewer.watchPatterns) expect(pattern.endsWith(".json")).toBe(true);
    const spec = manifest.sources!.series;
    expect(spec.kind).toBe("aggregate-file");
    expect((spec.config as { patterns: string[] }).patterns).toEqual(manifest.viewer.watchPatterns);
  });

  test("every seed the launcher offers points at a directory that exists", () => {
    const seedFiles = manifest.init!.seedFiles as Record<string, string>;
    for (const seed of manifest.init!.seeds ?? []) {
      const from = Object.keys(seedFiles).find((k) => k === seed.sourceKey);
      expect(from).toBeDefined();
      const dir = join(REPO_ROOT, from!);
      expect(existsSync(join(dir, manifest.init!.contentCheckPattern!))).toBe(true);
    }
  });

  test("the seed ships no orphan media: every file but the three text kinds is a registered asset", () => {
    const seed = join(MODE_DIR, "seed", "guang-niuma");
    const project = JSON.parse(read(join(seed, "project.json")));
    const uris = new Set<string>(project.assets.map((a: { uri: string }) => a.uri));
    const text = (rel: string) => rel === "bible.json" || rel === "project.json" || /^episodes\/[^/]+\/episode\.json$/.test(rel);
    const files = (readdirSync(seed, { recursive: true, withFileTypes: true }) as Array<{ isFile(): boolean; name: string; parentPath: string }>)
      .filter((d) => d.isFile())
      .map((d) => relative(seed, join(d.parentPath, d.name)).split(sep).join("/"));
    expect(files.filter((rel) => !text(rel) && !uris.has(rel))).toEqual([]);
    expect([...uris].filter((uri) => !existsSync(join(seed, uri)))).toEqual([]);
    // Media is delivered as WebP / JPEG / MP4: a raw PNG is what the
    // generators write, ten times the size.
    expect([...uris].filter((uri) => !/\.(webp|jpg|mp4)$/.test(uri))).toEqual([]);
  });

  test("the seed stays inside its 8 MB budget", () => {
    // It ships in the mode's catalog archive, downloaded on first use.
    const seed = join(MODE_DIR, "seed");
    const bytes = (readdirSync(seed, { recursive: true, withFileTypes: true }) as Array<{ isFile(): boolean; name: string; parentPath: string }>)
      .filter((d) => d.isFile())
      .reduce((sum, d) => sum + statSync(join(d.parentPath, d.name)).size, 0);
    expect(bytes / 1_000_000).toBeLessThan(8);
  });
});

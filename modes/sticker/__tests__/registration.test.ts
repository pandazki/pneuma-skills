/**
 * The TASK-1 manifest: identity, the skill's install surface and the keys.
 * TASK-2 adds the viewer, sources and launcher registration and their tests.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import manifest from "../manifest.js";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const MODE_DIR = join(REPO_ROOT, "modes", "sticker");
const SHARED_DIR = join(REPO_ROOT, "modes", "_shared", "scripts");
const read = (path: string) => readFileSync(path, "utf-8");

describe("the sticker manifest", () => {
  test("identity from the brief; no React in manifest.ts", () => {
    expect(manifest.name).toBe("sticker");
    expect(manifest.displayName).toEqual({ en: "Sticker Pack", "zh-CN": "表情包", ja: "スタンプ" });
    expect(manifest.icon).toContain("currentColor");
    expect(manifest.skill.installName).toBe("pneuma-sticker");
    const source = read(join(MODE_DIR, "manifest.ts"));
    expect(source).not.toMatch(/from\s+["']react/);
    expect(source).not.toMatch(/from\s+["']\.\.\/_shared/);
  });

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
    expect(sharedClosure()).toEqual(["craft-project-io.mjs", "craft-project.mjs", "fal-queue.mjs", "generate_gif.mjs", "generate_image.mjs", "zip.mjs"]);
    expect([...(manifest.skill.sharedScripts ?? [])].sort()).toEqual(sharedClosure());
  });

  test("the mode's own scripts import each other and the shared ones only through importShared", () => {
    const scriptsDir = join(MODE_DIR, "skill", "scripts");
    for (const file of readdirSync(scriptsDir).filter((f) => f.endsWith(".mjs"))) {
      for (const m of read(join(scriptsDir, file)).matchAll(/^import[^;]*?from\s+"([^"]+)"/gms)) {
        const spec = m[1];
        expect({ file, spec, ok: spec.startsWith("node:") || /^\.\/sticker-[a-z]+\.mjs$/.test(spec) }).toEqual({ file, spec, ok: true });
      }
    }
  });

  test("both keys map to the scripts' variables; the viewer watches text only", () => {
    expect(manifest.skill.envMapping).toEqual({ FAL_KEY: "falApiKey", OPENROUTER_API_KEY: "openrouterApiKey" });
    expect(manifest.viewer.watchPatterns).toEqual(["pack.json", "project.json"]);
  });
});

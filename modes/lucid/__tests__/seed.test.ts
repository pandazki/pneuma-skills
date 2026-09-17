/**
 * The shipped seed is a real loop, and it stays runnable.
 *
 * `ember-abbey` is the output of the mode's own blind trial: a dreamed target,
 * three judged rounds and the scene built toward it. The tests below pin the
 * properties a user depends on the moment they click the seed card — the
 * manifest parses clean, every capture the rail shows is on disk, the scene
 * carries the SAME bridge the skill ships, and the vendored three.js is the
 * complete six-file set — plus a size guard, because the launcher ships every
 * seed inside the npm package.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import lucidManifest from "../manifest.js";
import { parseLoop } from "../domain.js";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const SEED_KEY = "modes/lucid/seed/ember-abbey/";
const SEED = join(REPO_ROOT, SEED_KEY);

function walk(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf-8" })
    .map((f) => join(dir, f))
    .filter((f) => statSync(f).isFile());
}

describe("seed registration", () => {
  test("the manifest maps the seed directory and offers one gallery card for it", () => {
    expect(lucidManifest.init?.seedFiles).toEqual({ [SEED_KEY]: "ember-abbey/" });
    const seeds = lucidManifest.init?.seeds ?? [];
    expect(seeds).toHaveLength(1);
    expect(seeds[0].sourceKey).toBe(SEED_KEY);
    expect(existsSync(join(REPO_ROOT, "modes/lucid/seed-gallery", seeds[0].thumbnail!))).toBe(true);
    for (const key of ["en", "zh-CN", "ja"]) {
      expect(typeof (seeds[0].displayName as Record<string, string>)[key]).toBe("string");
      expect(typeof (seeds[0].description as Record<string, string>)[key]).toBe("string");
    }
  });
});

describe("the seed loop", () => {
  const loop = parseLoop("ember-abbey", readFileSync(join(SEED, "lucid.json"), "utf-8"))!;

  test("parses with no warnings and no budget", () => {
    expect(loop).not.toBeNull();
    expect(loop.warnings).toEqual([]);
    expect(loop.budget).toBeNull();
    expect(loop.status).toBe("looping");
  });

  test("three judged rounds with an improving trend and the evaluation the script computed", () => {
    expect(loop.rounds).toHaveLength(3);
    expect(loop.rounds.every((r) => r.verdict !== null)).toBe(true);
    expect(loop.evaluation?.trend).toEqual([3.35, 4, 4.25]);
    expect(loop.evaluation?.exit).toBe("stall-approaching");
    expect(loop.rounds[2].kind).toBe("rethink");
  });

  test("every capture on the rail and the locked target are on disk", () => {
    expect(loop.target.path).toBe("target.png");
    expect(existsSync(join(SEED, "target.png"))).toBe(true);
    for (const round of loop.rounds) {
      expect(round.capture).not.toBeNull();
      expect(existsSync(join(SEED, round.capture!))).toBe(true);
    }
  });
});

describe("the seed scene", () => {
  test("loads the bridge first, then the importmap, then the module", () => {
    const html = readFileSync(join(SEED, "scene/index.html"), "utf-8");
    const bridge = html.indexOf("./lucid-bridge.js");
    const map = html.indexOf('"three": "./vendor/three.module.js"');
    const main = html.indexOf("./main.js");
    expect(bridge).toBeGreaterThan(-1);
    expect(map).toBeGreaterThan(bridge);
    expect(main).toBeGreaterThan(map);
  });

  test("carries the bridge the skill ships, byte for byte", () => {
    // A seed with a stale bridge would report rAF cadence as fps and answer
    // no `note` — and nothing else would say so.
    const shipped = readFileSync(join(REPO_ROOT, "modes/lucid/skill/scripts/lucid-bridge.js"));
    const seeded = readFileSync(join(SEED, "scene/lucid-bridge.js"));
    expect(seeded.equals(shipped)).toBe(true);
  });

  test("registers with the bridge and leaves no trial-only test hooks behind", () => {
    const main = readFileSync(join(SEED, "scene/main.js"), "utf-8");
    expect(main).toContain("window.lucid");
    expect(main).toContain("register(");
    expect(main).not.toContain("interaction-check");
  });

  test("vendors the complete three.js set from one release, post chain included", () => {
    const vendor = join(SEED, "scene/vendor");
    for (const rel of [
      "three.module.js",
      "three.core.js",
      "addons/loaders/GLTFLoader.js",
      "addons/controls/OrbitControls.js",
      "addons/utils/BufferGeometryUtils.js",
      "addons/utils/SkeletonUtils.js",
      "addons/postprocessing/Pass.js",
      "addons/postprocessing/MaskPass.js",
      "addons/postprocessing/EffectComposer.js",
      "addons/postprocessing/RenderPass.js",
      "addons/postprocessing/ShaderPass.js",
      "addons/postprocessing/UnrealBloomPass.js",
      "addons/postprocessing/OutputPass.js",
      "addons/shaders/CopyShader.js",
      "addons/shaders/LuminosityHighPassShader.js",
      "addons/shaders/OutputShader.js",
      "VERSION",
    ]) {
      expect({ rel, exists: existsSync(join(vendor, rel)) }).toEqual({ rel, exists: true });
    }
    expect(readFileSync(join(vendor, "VERSION"), "utf-8").trim()).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("seed size", () => {
  test("no single file over 1.5 MB and the whole seed under 8 MB", () => {
    // The launcher ships every seed inside the npm package, which sits near
    // its size ceiling; images here are downscaled and quantized on purpose.
    // The largest file is vendored `three.core.js` (~1.3 MB); everything else
    // stays well under a megabyte.
    const files = walk(SEED);
    let total = 0;
    for (const file of files) {
      const size = statSync(file).size;
      total += size;
      expect({ file: file.slice(SEED.length), under: size <= 1.5 * 1024 * 1024 }).toEqual({
        file: file.slice(SEED.length),
        under: true,
      });
    }
    expect(total).toBeLessThan(8 * 1024 * 1024);
  });
});

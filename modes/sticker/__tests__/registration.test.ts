/**
 * The manifest and where the mode is registered: identity, the skill's
 * install surface and the keys (TASK-1); the viewer contract, the source,
 * the launcher and seed card, and catalog registration (TASK-2).
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { isCatalogMode, resolveCatalogMode } from "../../../core/mode-catalog.js";
import { listBuiltinModes } from "../../../core/mode-loader.js";
import { parseManifestTs } from "../../../core/utils/manifest-parser.js";
import { loadPack, savePack } from "../domain.js";
import manifest from "../manifest.js";
import stickerMode from "../pneuma-mode.js";

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

describe("registration and the viewer contract", () => {
  test("a catalog mode: resolved from its own directory, not a builtin, not bundled", () => {
    expect(listBuiltinModes()).not.toContain("sticker");
    const bundled = (JSON.parse(read(join(REPO_ROOT, "modes", "distribution.json"))) as { bundled: string[] }).bundled;
    expect(bundled).not.toContain("sticker");
    expect(isCatalogMode("sticker")).toBe(true);
    expect(resolveCatalogMode("sticker")?.modeDir).toBe(MODE_DIR);
    expect(manifest.hidden).toBeUndefined();
  });

  test("the launcher card reads from the manifest text; version 0.1.0 has its changelog", () => {
    const parsed = parseManifestTs(read(join(MODE_DIR, "manifest.ts")), "zh-CN");
    expect(parsed.name).toBe("sticker");
    expect(parsed.displayName).toBe("表情包");
    expect(parsed.version).toBe("0.1.0");
    expect(parsed.icon).toContain("<svg");
    expect(manifest.changelog?.["0.1.0"]?.length).toBeGreaterThan(0);
    expect(manifest.supportedBackends).toEqual(["claude-code", "codex"]);
  });

  test("one aggregate source over pack.json + project.json, read and written by domain.ts", () => {
    const spec = manifest.sources!.pack;
    expect(spec.kind).toBe("aggregate-file");
    const config = spec.config as { patterns: string[]; load: unknown; save: unknown };
    expect(config.patterns).toEqual(manifest.viewer.watchPatterns);
    expect(config.load).toBe(loadPack);
    expect(config.save).toBe(savePack);
  });

  test("a single-pack workspace with no TopBar list; the binding mirrors the manifest", () => {
    const ws = manifest.viewerApi!.workspace!;
    expect(ws).toMatchObject({ type: "single", topBarNavigation: false, hasActiveFile: false });
    const bound = stickerMode.viewer.workspace!;
    expect(bound.type).toBe(ws.type);
    expect(bound.resolveItems?.([])).toEqual([]);
    expect(bound.createEmpty?.([])).toBeNull();
    expect(stickerMode.viewer.actions).toBe(manifest.viewerApi!.actions);
    expect(stickerMode.viewer.updateStrategy).toBe("incremental");
  });

  test("two agent actions, two user commands", () => {
    expect(manifest.viewerApi!.actions!.map((a) => [a.id, a.agentInvocable])).toEqual([
      ["navigate-to", true],
      ["set-view", true],
    ]);
    expect(manifest.viewerApi!.commands!.map((c) => c.id)).toEqual(["make-missing", "export-check"]);
    // The hint a user reads names no script, flag or file.
    for (const c of manifest.viewerApi!.commands!) expect(c.description).not.toMatch(/\.mjs|--|\.json/);
  });

  test("init: pack.json marks a workspace as started; both keys optional and sensitive, with flags both ways", () => {
    const init = manifest.init!;
    expect(init.contentCheckPattern).toBe("pack.json");
    for (const name of ["falApiKey", "openrouterApiKey"]) {
      const param = init.params!.find((p) => p.name === name)!;
      expect(param.sensitive).toBe(true);
      expect(param.defaultValue).toBe("");
    }
    expect(init.deriveParams!({ falApiKey: "k", openrouterApiKey: "" })).toMatchObject({
      stickersEnabled: "true",
      stickersDisabled: "",
      imagesEnabled: "",
      imagesDisabled: "true",
    });
  });

  test("the seed card points at its seedFiles entry, in three languages", () => {
    const init = manifest.init!;
    expect(init.seedFiles).toEqual({ "modes/sticker/seed/niuma/": "./" });
    const seed = init.seeds!.find((s) => s.id === "niuma")!;
    expect(seed.sourceKey).toBe("modes/sticker/seed/niuma/");
    for (const text of [seed.displayName, seed.description!]) {
      expect(Object.keys(text as Record<string, string>).sort()).toEqual(["en", "ja", "zh-CN"]);
    }
  });

  const seedDir = join(MODE_DIR, "seed", "niuma");
  test.skipIf(!existsSync(seedDir))("the seed directory holds a pack (lands with TASK-3)", () => {
    expect(existsSync(join(seedDir, manifest.init!.contentCheckPattern!))).toBe(true);
  });

  test("greeting and evolution are this mode's", () => {
    expect(manifest.agent?.greeting).toContain('skill="pneuma-sticker"');
    expect(manifest.agent?.greeting).toContain("fal key");
    expect(manifest.evolution?.directive).toContain("sticker packs");
    expect(manifest.skill.mdScene).toContain("pack.json");
  });
});

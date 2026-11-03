/**
 * Every catalog mode of this checkout has to start from its install root.
 *
 * A released package has no source for a catalog mode: it runs from
 * `~/.pneuma/catalog/<name>/modes/<name>/`, which holds the archive (the mode
 * directory plus the npm packages `publish-modes` vendored for its manifest)
 * and the installer's `modes/_shared/` mirror. The server imports manifest.ts
 * from there raw, so any import that resolves only inside the repository —
 * a relative path out of the mode, or a package found in the repository's
 * node_modules — breaks after release while every in-tree run passes. 3.60.3
 * shipped both: anime-series (`../_shared/scripts/craft-project.mjs`) failed
 * to launch, and wordtaste (`mdast-util-from-markdown`) launched only through
 * Bun's runtime auto-install.
 *
 * Each case builds that layout with the publisher's and the installer's own
 * functions, outside the repository, then imports the manifest. `bun test`
 * never auto-installs, so a package that was not vendored fails here. Only
 * module source is copied from the mode: the question is whether the import
 * graph resolves, and seeds would cost seconds.
 */

import { afterAll, describe, expect, it } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

import { mirrorSharedAssets } from "../../core/mode-catalog.js";
import { catalogModeNames, PROJECT_ROOT, vendorServerDependencies } from "../publish-modes.js";

const MODES_DIR = join(PROJECT_ROOT, "modes");
const CODE = new Set([".ts", ".tsx", ".mts", ".mjs", ".js", ".cjs", ".json"]);
const SKIP = new Set(["showcase", "harness", "__tests__", "node_modules", ".build"]);

const root = mkdtempSync(join(tmpdir(), "pneuma-catalog-layout-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function copyCode(src: string, dst: string): void {
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const from = join(src, entry.name);
    if (entry.isDirectory()) {
      copyCode(from, join(dst, entry.name));
    } else if (entry.isFile() && CODE.has(extname(entry.name))) {
      mkdirSync(dst, { recursive: true });
      copyFileSync(from, join(dst, entry.name));
    }
  }
}

describe("catalog modes start from their install root", () => {
  for (const name of catalogModeNames(MODES_DIR)) {
    it(`${name}: manifest.ts imports`, async () => {
      const installRoot = join(root, name);
      const modeDir = join(installRoot, "modes", name);
      copyCode(join(MODES_DIR, name), modeDir);
      await vendorServerDependencies(join(MODES_DIR, name), modeDir);
      mirrorSharedAssets(installRoot);

      const manifest = (await import(join(modeDir, "manifest.ts"))).default as { name?: string };
      expect(manifest.name).toBe(name);
    });
  }
});

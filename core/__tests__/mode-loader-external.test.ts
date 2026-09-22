/**
 * Mode Loader — External mode registration tests
 *
 * Validates registerExternalMode and loadModeManifest support for external modes.
 */

import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { registerExternalMode, loadModeManifest, listModes, listBuiltinModes } from "../mode-loader.js";

const TEST_MODE_PATH = resolve(dirname(import.meta.path), "fixtures/test-mode");
const PROJECT_ROOT = resolve(dirname(import.meta.path), "..", "..");

describe("registerExternalMode", () => {
  test("registered external mode appears in listModes()", () => {
    registerExternalMode("test-mode", TEST_MODE_PATH);
    const modes = listModes();
    expect(modes).toContain("test-mode");
    expect(modes).toContain("slide");
    expect(modes).toContain("webcraft");
  });

  test("listBuiltinModes() does not include external modes", () => {
    const builtins = listBuiltinModes();
    expect(builtins).toContain("slide");
    expect(builtins).toContain("webcraft");
    expect(builtins).not.toContain("test-mode");
  });

  test("loadModeManifest() works for registered external mode", async () => {
    registerExternalMode("test-mode", TEST_MODE_PATH);
    const manifest = await loadModeManifest("test-mode");
    expect(manifest.name).toBe("test-mode");
    expect(manifest.version).toBe("0.1.0");
    expect(manifest.displayName).toBe("Test Mode");
  });
});

describe("builtin registry", () => {
  /**
   * The builtin registry is what Vite follows into the app bundle, so it
   * decides what ships in `dist/`. `modes/distribution.json` decides what
   * ships in the npm package. If the two disagree, a released app either
   * carries a viewer it does not ship the source for (dead weight) or is
   * missing one it does (a mode that cannot load). `_shared` is bundled
   * assets, not a mode, so it is the one documented exception.
   */
  test("lists exactly the bundled modes from modes/distribution.json", () => {
    const { bundled } = JSON.parse(
      readFileSync(join(PROJECT_ROOT, "modes", "distribution.json"), "utf-8"),
    ) as { bundled: string[] };
    const expected = bundled.filter((name) => name !== "_shared").sort();
    expect(listBuiltinModes().sort()).toEqual(expected);
  });

  test("does not carry catalog modes — they load through registerExternalMode", () => {
    for (const catalogMode of ["doc", "draw", "sprite", "bansho", "wordtaste"]) {
      expect(listBuiltinModes()).not.toContain(catalogMode);
    }
  });
});

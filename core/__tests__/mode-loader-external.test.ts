/**
 * Mode Loader — External mode registration tests
 *
 * 验证 registerExternalMode 和 loadModeManifest 对外部 mode 的支持。
 */

import { describe, test, expect } from "bun:test";
import { resolve, dirname } from "node:path";
import { registerExternalMode, loadModeManifest, listModes, listBuiltinModes } from "../mode-loader.js";

const TEST_MODE_PATH = resolve(dirname(import.meta.path), "fixtures/test-mode");

describe("registerExternalMode", () => {
  test("registered external mode appears in listModes()", () => {
    registerExternalMode("test-mode", TEST_MODE_PATH);
    const modes = listModes();
    expect(modes).toContain("test-mode");
    expect(modes).toContain("doc");
    expect(modes).toContain("slide");
  });

  test("listBuiltinModes() does not include external modes", () => {
    const builtins = listBuiltinModes();
    expect(builtins).toContain("doc");
    expect(builtins).toContain("slide");
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

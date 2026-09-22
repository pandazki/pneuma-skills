/**
 * Tests for `core/local-modes.ts::enumerateLocalModes`. The function is
 * filesystem-driven; we point it at the live project root (which has every
 * builtin manifest on disk) and at a tmp home with controlled
 * ~/.pneuma/modes layouts to verify filtering + tagging.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import { tmpdir } from "node:os";

import { enumerateLocalModes } from "../local-modes.js";

const PROJECT_ROOT = resolvePath(import.meta.dir, "..", "..");

let tmpHome: string;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "pneuma-local-modes-"));
});

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
});

describe("enumerateLocalModes", () => {
  test("returns the known visible builtins, filters hidden ones", () => {
    const list = enumerateLocalModes({ projectRoot: PROJECT_ROOT, home: tmpHome });
    const names = list.map((m) => m.name);

    // Bundled and catalog modes alike are launchable locally — a handoff or
    // a /borrow may target either, and a catalog mode installs on launch.
    for (const expected of ["webcraft", "slide", "doc", "diagram", "draw", "illustrate"]) {
      expect(names).toContain(expected);
    }
    // Known internal/hidden builtins must be filtered.
    for (const hidden of ["evolve", "project-evolve", "project-onboard", "project-tidy"]) {
      expect(names).not.toContain(hidden);
    }
    // Builtins are always tagged correctly even if libraries leak in.
    // (Note: `listLibraries()` reads $HOME directly via os.homedir() and
    // ignores the `home` override, so library entries from the dev box's
    // real ~/.pneuma may surface in tests — acceptable; we just confirm
    // that the builtins themselves carry the right source tag.)
    for (const m of list) {
      if (["webcraft", "slide", "illustrate"].includes(m.name)) {
        expect(m.source).toBe("builtin");
      }
    }
  });

  test("tags catalog modes and says whether they are installed", () => {
    const list = enumerateLocalModes({ projectRoot: PROJECT_ROOT, home: tmpHome });
    const doc = list.find((m) => m.name === "doc");
    expect(doc?.source).toBe("catalog");
    // In this repo the source is in-tree, so it is installed with no
    // download and carries the path the launch will use.
    expect(doc?.installed).toBe(true);
    expect(doc?.path).toBe(join(PROJECT_ROOT, "modes", "doc"));
    // A catalog mode is still just a mode to the picker.
    expect(doc?.displayName?.length).toBeGreaterThan(0);
  });

  test("hidden catalog modes stay out of the picker", () => {
    const list = enumerateLocalModes({ projectRoot: PROJECT_ROOT, home: tmpHome });
    const names = list.map((m) => m.name);
    for (const hidden of ["evolve", "project-evolve", "project-onboard", "project-tidy"]) {
      expect(names).not.toContain(hidden);
    }
  });

  test("picks up a local mode under ~/.pneuma/modes/<name>/", () => {
    const localDir = join(tmpHome, ".pneuma", "modes", "alpha");
    mkdirSync(localDir, { recursive: true });
    writeFileSync(
      join(localDir, "manifest.ts"),
      `import type { ModeManifest } from "../../../core/types/mode-manifest.js";
const manifest: ModeManifest = {
  name: "alpha",
  displayName: "Alpha Mode",
  description: "A test local mode",
  version: "0.1.0",
  // … other required fields stubbed for the regex parser
} as ModeManifest;
export default manifest;`,
      "utf-8",
    );

    const list = enumerateLocalModes({ projectRoot: PROJECT_ROOT, home: tmpHome });
    const alpha = list.find((m) => m.name === "alpha");
    expect(alpha).toBeDefined();
    expect(alpha?.source).toBe("local");
    expect(alpha?.displayName).toBe("Alpha Mode");
    expect(alpha?.description).toBe("A test local mode");
    expect(alpha?.path).toBe(localDir);
  });

  test("ignores a local entry with manifest.hidden=true", () => {
    const hiddenDir = join(tmpHome, ".pneuma", "modes", "internal-helper");
    mkdirSync(hiddenDir, { recursive: true });
    writeFileSync(
      join(hiddenDir, "manifest.ts"),
      `const manifest = {
  name: "internal-helper",
  displayName: "Internal Helper",
  hidden: true,
};
export default manifest;`,
      "utf-8",
    );
    const list = enumerateLocalModes({ projectRoot: PROJECT_ROOT, home: tmpHome });
    expect(list.find((m) => m.name === "internal-helper")).toBeUndefined();
  });

  test("tolerates a malformed manifest by skipping (no throw)", () => {
    const dir = join(tmpHome, ".pneuma", "modes", "busted");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "manifest.ts"), "not really typescript {{}}", "utf-8");
    const list = enumerateLocalModes({ projectRoot: PROJECT_ROOT, home: tmpHome });
    // Regex extraction is permissive — the entry may surface with empty
    // displayName, OR be skipped. Either is acceptable as long as we don't
    // throw and other builtins still come through.
    expect(list.find((m) => m.name === "webcraft")).toBeDefined();
  });
});

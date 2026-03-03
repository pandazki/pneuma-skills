import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  getModeArchiveKey,
  getModeLatestKey,
  readAndValidateManifest,
} from "../mode-publish.js";

describe("getModeArchiveKey", () => {
  test("returns correct key pattern", () => {
    expect(getModeArchiveKey("quiz", "1.0.0")).toBe("modes/quiz/1.0.0.tar.gz");
  });

  test("handles hyphenated names", () => {
    expect(getModeArchiveKey("my-cool-mode", "2.3.1")).toBe("modes/my-cool-mode/2.3.1.tar.gz");
  });
});

describe("getModeLatestKey", () => {
  test("returns correct key pattern", () => {
    expect(getModeLatestKey("quiz")).toBe("modes/quiz/latest.json");
  });

  test("handles hyphenated names", () => {
    expect(getModeLatestKey("my-cool-mode")).toBe("modes/my-cool-mode/latest.json");
  });
});

describe("readAndValidateManifest", () => {
  const testDir = join(tmpdir(), `pneuma-test-${Date.now()}`);

  function setup(manifestContent: string) {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "manifest.ts"), manifestContent);
  }

  function cleanup() {
    try { rmSync(testDir, { recursive: true, force: true }); } catch {}
  }

  test("parses valid manifest", () => {
    setup(`
import type { ModeManifest } from "../../core/types/mode-manifest.js";

const manifest: ModeManifest = {
  name: "quiz",
  version: "1.0.0",
  displayName: "Quiz Mode",
  description: "Interactive quiz builder",
  skill: { sourceDir: "skill", installName: "pneuma-quiz", claudeMdSection: "" },
  viewer: { watchPatterns: ["**/*.json"] },
};

export default manifest;
    `);
    const result = readAndValidateManifest(testDir);
    expect(result.name).toBe("quiz");
    expect(result.version).toBe("1.0.0");
    expect(result.displayName).toBe("Quiz Mode");
    expect(result.description).toBe("Interactive quiz builder");
    cleanup();
  });

  test("throws on missing manifest.ts", () => {
    const emptyDir = join(tmpdir(), `pneuma-empty-${Date.now()}`);
    mkdirSync(emptyDir, { recursive: true });
    expect(() => readAndValidateManifest(emptyDir)).toThrow("manifest.ts not found");
    try { rmSync(emptyDir, { recursive: true, force: true }); } catch {}
  });

  test("throws on missing name", () => {
    setup(`
const manifest = {
  version: "1.0.0",
  displayName: "Test",
};
    `);
    expect(() => readAndValidateManifest(testDir)).toThrow("missing required field: name");
    cleanup();
  });

  test("throws on missing version", () => {
    setup(`
const manifest = {
  name: "test",
  displayName: "Test",
};
    `);
    expect(() => readAndValidateManifest(testDir)).toThrow("missing required field: version");
    cleanup();
  });

  test("throws on missing displayName", () => {
    setup(`
const manifest = {
  name: "test",
  version: "1.0.0",
};
    `);
    expect(() => readAndValidateManifest(testDir)).toThrow("missing required field: displayName");
    cleanup();
  });

  test("throws on invalid name (uppercase)", () => {
    setup(`
const manifest = {
  name: "MyMode",
  version: "1.0.0",
  displayName: "My Mode",
};
    `);
    expect(() => readAndValidateManifest(testDir)).toThrow("Invalid mode name");
    cleanup();
  });

  test("throws on invalid name (starts with number)", () => {
    setup(`
const manifest = {
  name: "3d-mode",
  version: "1.0.0",
  displayName: "3D Mode",
};
    `);
    expect(() => readAndValidateManifest(testDir)).toThrow("Invalid mode name");
    cleanup();
  });

  test("throws on invalid version (not semver)", () => {
    setup(`
const manifest = {
  name: "test",
  version: "1.0",
  displayName: "Test",
};
    `);
    expect(() => readAndValidateManifest(testDir)).toThrow("Invalid version");
    cleanup();
  });

  test("throws on pre-release version", () => {
    setup(`
const manifest = {
  name: "test",
  version: "1.0.0-beta.1",
  displayName: "Test",
};
    `);
    expect(() => readAndValidateManifest(testDir)).toThrow("Invalid version");
    cleanup();
  });

  test("accepts valid hyphenated name", () => {
    setup(`
const manifest = {
  name: "my-cool-mode",
  version: "2.0.0",
  displayName: "My Cool Mode",
};
    `);
    const result = readAndValidateManifest(testDir);
    expect(result.name).toBe("my-cool-mode");
    cleanup();
  });
});

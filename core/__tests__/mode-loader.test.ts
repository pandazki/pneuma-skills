/**
 * Mode Loader tests
 *
 * Validates mode loading mechanics:
 * - Successfully loads built-in modes
 * - Throws error for unknown modes
 * - Loaded modes conform to the ModeDefinition contract
 */

import { describe, test, expect } from "bun:test";
import type { ModeDefinition } from "../types/index.js";

// ── Mode Loader not yet implemented; using mocks to define expected behavior ──

/**
 * Mock mode loader — defines the expected behavior of loadMode.
 * Actual implementation is in core/mode-loader.ts (created during v1.0 code phase).
 */
const builtinModes: Record<string, ModeDefinition> = {};

function registerMockMode(name: string, mode: ModeDefinition) {
  builtinModes[name] = mode;
}

async function loadMode(name: string): Promise<ModeDefinition> {
  const mode = builtinModes[name];
  if (!mode) {
    const available = Object.keys(builtinModes).join(", ");
    throw new Error(`Unknown mode: "${name}". Available: ${available}`);
  }
  return mode;
}

function listModes(): string[] {
  return Object.keys(builtinModes);
}

// ── Helper: create minimal valid ModeDefinition ─────────────────────────────

function createMockModeDefinition(name: string): ModeDefinition {
  return {
    manifest: {
      name,
      version: "1.0.0",
      displayName: name.charAt(0).toUpperCase() + name.slice(1),
      description: `${name} mode`,
      skill: {
        sourceDir: "skill",
        installName: `pneuma-${name}`,
        claudeMdSection: `## ${name} mode`,
      },
      viewer: {
        watchPatterns: ["**/*"],
        ignorePatterns: ["node_modules/**"],
      },
    },
    viewer: {
      PreviewComponent: (() => null) as any,
      extractContext: () => "",
      updateStrategy: "full-reload",
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("loadMode", () => {
  test("loads a registered builtin mode", async () => {
    registerMockMode("doc", createMockModeDefinition("doc"));

    const mode = await loadMode("doc");
    expect(mode.manifest.name).toBe("doc");
    expect(mode.viewer).toBeDefined();
    expect(typeof mode.viewer.PreviewComponent).toBe("function");
  });

  test("throws for unknown mode with available modes listed", async () => {
    registerMockMode("doc", createMockModeDefinition("doc"));

    await expect(loadMode("unknown")).rejects.toThrow("Unknown mode");
    await expect(loadMode("unknown")).rejects.toThrow("doc");
  });

  test("loaded mode manifest has all required fields", async () => {
    registerMockMode("slide", createMockModeDefinition("slide"));

    const mode = await loadMode("slide");
    const m = mode.manifest;

    // Required fields
    expect(m.name).toBeTruthy();
    expect(m.version).toBeTruthy();
    expect(m.displayName).toBeTruthy();
    expect(m.description).toBeTruthy();
    expect(m.skill).toBeDefined();
    expect(m.skill.sourceDir).toBeTruthy();
    expect(m.skill.installName).toBeTruthy();
    expect(m.skill.claudeMdSection).toBeTruthy();
    expect(m.viewer).toBeDefined();
    expect(m.viewer.watchPatterns.length).toBeGreaterThan(0);
  });

  test("loaded mode viewer satisfies ViewerContract", async () => {
    registerMockMode("doc", createMockModeDefinition("doc"));

    const mode = await loadMode("doc");
    const v = mode.viewer;

    expect(typeof v.PreviewComponent).toBe("function");
    expect(typeof v.extractContext).toBe("function");
    expect(["full-reload", "incremental"]).toContain(v.updateStrategy);

    // extractContext returns string
    const result = v.extractContext(null, []);
    expect(typeof result).toBe("string");
  });
});

describe("listModes", () => {
  test("returns registered mode names", () => {
    // Already registered "doc" and "slide" from previous tests
    const modes = listModes();
    expect(modes).toContain("doc");
    expect(modes).toContain("slide");
  });
});

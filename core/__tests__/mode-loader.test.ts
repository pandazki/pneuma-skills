/**
 * Mode Loader 测试
 *
 * 验证 mode 加载机制：
 * - 加载内置 mode 成功
 * - 加载未知 mode 报错
 * - 加载的 mode 符合 ModeDefinition 契约
 */

import { describe, test, expect } from "bun:test";
import type { ModeDefinition } from "../types/index.js";

// ── Mode Loader 本身还未实现，这里用 mock 定义预期行为 ─────────────────────────

/**
 * Mock mode loader — 定义 loadMode 的预期行为。
 * 实际实现在 core/mode-loader.ts (v1.0 代码阶段创建)。
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

// ── 辅助：创建最小合法 ModeDefinition ────────────────────────────────────────

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

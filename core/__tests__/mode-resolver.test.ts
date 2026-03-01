/**
 * Mode Resolver 测试
 *
 * 验证 mode 来源解析:
 * - builtin mode 名称识别
 * - local path 解析 (绝对路径、相对路径、~ 展开)
 * - github 格式解析
 * - 错误处理
 */

import { describe, test, expect } from "bun:test";
import { parseModeSpecifier, isExternalMode, resolveMode } from "../mode-resolver.js";
import { homedir } from "node:os";
import { resolve, dirname, join } from "node:path";

describe("parseModeSpecifier", () => {
  // ── Builtin modes ──────────────────────────────────────────────────

  test("recognizes builtin mode: doc", () => {
    const result = parseModeSpecifier("doc");
    expect(result.type).toBe("builtin");
    expect(result.name).toBe("doc");
  });

  test("recognizes builtin mode: slide", () => {
    const result = parseModeSpecifier("slide");
    expect(result.type).toBe("builtin");
    expect(result.name).toBe("slide");
  });

  test("unknown plain name falls back to builtin (let mode-loader handle it)", () => {
    const result = parseModeSpecifier("mindmap");
    expect(result.type).toBe("builtin");
    expect(result.name).toBe("mindmap");
  });

  // ── Local paths ────────────────────────────────────────────────────

  test("parses absolute path as local mode", () => {
    const result = parseModeSpecifier("/home/user/my-mode");
    expect(result.type).toBe("local");
    expect(result.name).toBe("my-mode");
    expect(result.localPath).toBe("/home/user/my-mode");
  });

  test("parses relative path with ./ as local mode", () => {
    const result = parseModeSpecifier("./modes/custom");
    expect(result.type).toBe("local");
    expect(result.name).toBe("custom");
    expect(result.localPath).toBeTruthy();
  });

  test("parses relative path with ../ as local mode", () => {
    const result = parseModeSpecifier("../other-project/my-mode");
    expect(result.type).toBe("local");
    expect(result.name).toBe("my-mode");
    expect(result.localPath).toBeTruthy();
  });

  test("expands ~ to home directory", () => {
    const result = parseModeSpecifier("~/my-modes/custom");
    expect(result.type).toBe("local");
    expect(result.name).toBe("custom");
    expect(result.localPath).toStartWith(homedir());
  });

  // ── GitHub specifiers ──────────────────────────────────────────────

  test("parses github:user/repo", () => {
    const result = parseModeSpecifier("github:pandazki/pneuma-mode-canvas");
    expect(result.type).toBe("github");
    expect(result.name).toBe("pandazki-pneuma-mode-canvas");
    expect(result.github).toEqual({
      user: "pandazki",
      repo: "pneuma-mode-canvas",
      ref: "main",
    });
  });

  test("parses github:user/repo#branch", () => {
    const result = parseModeSpecifier("github:pandazki/my-mode#develop");
    expect(result.type).toBe("github");
    expect(result.name).toBe("pandazki-my-mode");
    expect(result.github).toEqual({
      user: "pandazki",
      repo: "my-mode",
      ref: "develop",
    });
  });

  test("parses github:user/repo#tag", () => {
    const result = parseModeSpecifier("github:user/repo#v1.0.0");
    expect(result.type).toBe("github");
    expect(result.github?.ref).toBe("v1.0.0");
  });

  test("throws for invalid github specifier (no repo)", () => {
    expect(() => parseModeSpecifier("github:user")).toThrow("Invalid GitHub mode specifier");
  });

  test("throws for invalid github specifier (empty user)", () => {
    expect(() => parseModeSpecifier("github:/repo")).toThrow("Invalid GitHub mode specifier");
  });
});

// ── resolveMode integration tests ─────────────────────────────────────

const PROJECT_ROOT = resolve(dirname(import.meta.path), "../..");

describe("resolveMode", () => {
  test("resolves builtin mode to modes/ directory", async () => {
    const result = await resolveMode("doc", PROJECT_ROOT);
    expect(result.type).toBe("builtin");
    expect(result.name).toBe("doc");
    expect(result.path).toBe(join(PROJECT_ROOT, "modes", "doc"));
  });

  test("resolves local path to absolute directory", async () => {
    const testModePath = resolve(dirname(import.meta.path), "fixtures/test-mode");
    const result = await resolveMode(testModePath, PROJECT_ROOT);
    expect(result.type).toBe("local");
    expect(result.name).toBe("test-mode");
    expect(result.path).toBe(testModePath);
  });

  test("throws for non-existent local path", async () => {
    await expect(resolveMode("/nonexistent/path/to/mode", PROJECT_ROOT)).rejects.toThrow(
      "Local mode directory not found",
    );
  });

  test("throws for local path without manifest", async () => {
    // Use a directory that exists but has no manifest.ts
    const tmpDir = resolve(dirname(import.meta.path), "fixtures");
    await expect(resolveMode(tmpDir, PROJECT_ROOT)).rejects.toThrow(
      "missing manifest.ts",
    );
  });
});

describe("isExternalMode", () => {
  test("builtin modes are not external", () => {
    expect(isExternalMode("doc")).toBe(false);
    expect(isExternalMode("slide")).toBe(false);
  });

  test("local paths are external", () => {
    expect(isExternalMode("/path/to/mode")).toBe(true);
    expect(isExternalMode("./my-mode")).toBe(true);
  });

  test("github specifiers are external", () => {
    expect(isExternalMode("github:user/repo")).toBe(true);
  });
});

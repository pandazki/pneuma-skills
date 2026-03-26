/**
 * ModeManifest contract tests
 *
 * Validates ModeManifest type constraints:
 * - Required field completeness
 * - Optional field default value semantics
 * - Business constraints on field values
 */

import { describe, test, expect } from "bun:test";
import type { ModeManifest, SkillConfig, ViewerConfig } from "../types/index.js";

// ── Helper: create minimal valid manifest ────────────────────────────────────

function createMinimalManifest(overrides?: Partial<ModeManifest>): ModeManifest {
  return {
    name: "test",
    version: "1.0.0",
    displayName: "Test Mode",
    description: "A test mode",
    skill: {
      sourceDir: "skill",
      installName: "pneuma-test",
      claudeMdSection: "## Test Mode\nYou are in test mode.",
    },
    viewer: {
      watchPatterns: ["**/*.txt"],
      ignorePatterns: ["node_modules/**"],
    },
    ...overrides,
  };
}

// ── ModeManifest required fields ─────────────────────────────────────────────

describe("ModeManifest required fields", () => {
  test("minimal manifest has all required fields", () => {
    const manifest = createMinimalManifest();
    expect(manifest.name).toBe("test");
    expect(manifest.version).toBe("1.0.0");
    expect(manifest.displayName).toBe("Test Mode");
    expect(manifest.description).toBe("A test mode");
    expect(manifest.skill).toBeDefined();
    expect(manifest.viewer).toBeDefined();
  });

  test("name should be a non-empty string", () => {
    const manifest = createMinimalManifest({ name: "doc" });
    expect(manifest.name.length).toBeGreaterThan(0);
  });

  test("version should follow semver format", () => {
    const manifest = createMinimalManifest({ version: "0.5.0" });
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});

// ── SkillConfig ──────────────────────────────────────────────────────────────

describe("SkillConfig", () => {
  test("sourceDir is relative path", () => {
    const skill: SkillConfig = {
      sourceDir: "skill",
      installName: "pneuma-doc",
      claudeMdSection: "## Doc Mode",
    };
    expect(skill.sourceDir).not.toMatch(/^\//); // not absolute
  });

  test("installName should not contain path separators", () => {
    const skill: SkillConfig = {
      sourceDir: "skill",
      installName: "pneuma-doc",
      claudeMdSection: "## Doc Mode",
    };
    expect(skill.installName).not.toMatch(/[\/\\]/);
  });

  test("claudeMdSection should not contain marker comments", () => {
    const skill: SkillConfig = {
      sourceDir: "skill",
      installName: "pneuma-doc",
      claudeMdSection: "## Doc Mode\nInstructions here.",
    };
    expect(skill.claudeMdSection).not.toContain("<!-- pneuma:start -->");
    expect(skill.claudeMdSection).not.toContain("<!-- pneuma:end -->");
  });
});

// ── ViewerConfig ─────────────────────────────────────────────────────────────

describe("ViewerConfig", () => {
  test("watchPatterns must have at least one entry", () => {
    const config: ViewerConfig = {
      watchPatterns: ["**/*.md"],
      ignorePatterns: [],
    };
    expect(config.watchPatterns.length).toBeGreaterThan(0);
  });

  test("ignorePatterns can be empty", () => {
    const config: ViewerConfig = {
      watchPatterns: ["**/*.html"],
      ignorePatterns: [],
    };
    expect(config.ignorePatterns).toEqual([]);
  });

  test("serveDir defaults to undefined (meaning workspace root)", () => {
    const config: ViewerConfig = {
      watchPatterns: ["**/*.md"],
      ignorePatterns: [],
    };
    expect(config.serveDir).toBeUndefined();
  });
});

// ── Optional fields ──────────────────────────────────────────────────────────

describe("ModeManifest optional fields", () => {
  test("agent is optional", () => {
    const manifest = createMinimalManifest();
    expect(manifest.agent).toBeUndefined();
  });

  test("agent.permissionMode defaults semantically to bypassPermissions", () => {
    const manifest = createMinimalManifest({
      agent: { permissionMode: "bypassPermissions" },
    });
    expect(manifest.agent?.permissionMode).toBe("bypassPermissions");
  });

  test("agent.greeting is optional", () => {
    const manifest = createMinimalManifest({ agent: {} });
    expect(manifest.agent?.greeting).toBeUndefined();
  });

  test("init is optional", () => {
    const manifest = createMinimalManifest();
    expect(manifest.init).toBeUndefined();
  });

  test("init.seedFiles maps target path to source path", () => {
    const manifest = createMinimalManifest({
      init: {
        contentCheckPattern: "**/*.md",
        seedFiles: { "README.md": "README.md" },
      },
    });
    expect(manifest.init?.seedFiles?.["README.md"]).toBe("README.md");
  });
});

// ── ProxyRoute ────────────────────────────────────────────────────────────────

describe("ProxyRoute", () => {
  test("manifest can declare proxy routes", () => {
    const manifest = createMinimalManifest({
      proxy: {
        github: {
          target: "https://api.github.com",
          headers: { Authorization: "Bearer {{GITHUB_TOKEN}}" },
          methods: ["GET", "POST"],
          description: "GitHub REST API",
        },
      },
    });
    expect(manifest.proxy?.github.target).toBe("https://api.github.com");
    expect(manifest.proxy?.github.methods).toEqual(["GET", "POST"]);
  });

  test("proxy is optional", () => {
    const manifest = createMinimalManifest();
    expect(manifest.proxy).toBeUndefined();
  });

  test("proxy route target must be a URL string", () => {
    const manifest = createMinimalManifest({
      proxy: {
        weather: { target: "https://wttr.in" },
      },
    });
    expect(manifest.proxy?.weather.target).toMatch(/^https?:\/\//);
  });

  test("methods defaults semantically to GET only", () => {
    const manifest = createMinimalManifest({
      proxy: {
        api: { target: "https://api.example.com" },
      },
    });
    expect(manifest.proxy?.api.methods).toBeUndefined();
    // Runtime should treat undefined as ["GET"]
  });
});

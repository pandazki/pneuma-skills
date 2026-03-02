/**
 * Skill installer tests
 *
 * Tests for applyTemplateParams() (pure function) and
 * installSkill() (filesystem — uses real temp directories).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { applyTemplateParams, installSkill, generateViewerApiSection } from "../skill-installer.js";
import type { SkillConfig, ViewerApiConfig } from "../../core/types/mode-manifest.js";

// ── applyTemplateParams (pure) ──────────────────────────────────────────────

describe("applyTemplateParams", () => {
  test("replaces simple {{key}} placeholder", () => {
    const result = applyTemplateParams("Hello {{name}}!", { name: "World" });
    expect(result).toBe("Hello World!");
  });

  test("replaces multiple occurrences of the same key", () => {
    const result = applyTemplateParams("{{x}} and {{x}}", { x: "A" });
    expect(result).toBe("A and A");
  });

  test("replaces multiple different keys", () => {
    const result = applyTemplateParams("{{a}}-{{b}}", { a: "1", b: "2" });
    expect(result).toBe("1-2");
  });

  test("handles numeric values", () => {
    const result = applyTemplateParams("width={{w}}", { w: 1920 });
    expect(result).toBe("width=1920");
  });

  test("keeps conditional block when value is truthy", () => {
    const result = applyTemplateParams(
      "before{{#apiKey}}KEY={{apiKey}}{{/apiKey}}after",
      { apiKey: "sk-123" },
    );
    expect(result).toBe("beforeKEY=sk-123after");
  });

  test("removes conditional block when value is undefined", () => {
    const result = applyTemplateParams(
      "before{{#apiKey}}KEY={{apiKey}}{{/apiKey}}after",
      {},
    );
    expect(result).toBe("beforeafter");
  });

  test("removes conditional block when value is empty string", () => {
    const result = applyTemplateParams(
      "before{{#apiKey}}KEY={{apiKey}}{{/apiKey}}after",
      { apiKey: "" },
    );
    expect(result).toBe("beforeafter");
  });

  test("removes conditional block when value is whitespace-only", () => {
    const result = applyTemplateParams(
      "before{{#key}}content{{/key}}after",
      { key: "   " },
    );
    expect(result).toBe("beforeafter");
  });

  test("handles nested simple replacements inside conditional blocks", () => {
    const result = applyTemplateParams(
      "{{#enabled}}url={{host}}:{{port}}{{/enabled}}",
      { enabled: "yes", host: "localhost", port: 3000 },
    );
    expect(result).toBe("url=localhost:3000");
  });

  test("handles multiple conditional blocks", () => {
    const result = applyTemplateParams(
      "{{#a}}A{{/a}}-{{#b}}B{{/b}}",
      { a: "yes", b: "" },
    );
    expect(result).toBe("A-");
  });

  test("no-op when no params match", () => {
    const input = "Hello {{name}}! {{#flag}}hidden{{/flag}}";
    const result = applyTemplateParams(input, {});
    expect(result).toBe("Hello {{name}}! ");
  });

  test("no-op when content has no placeholders", () => {
    const input = "plain text content";
    const result = applyTemplateParams(input, { key: "value" });
    expect(result).toBe("plain text content");
  });

  test("handles multiline conditional blocks", () => {
    const input = "start\n{{#key}}\nline1\nline2\n{{/key}}\nend";
    const result = applyTemplateParams(input, { key: "yes" });
    expect(result).toBe("start\n\nline1\nline2\n\nend");
  });

  test("removes multiline conditional block when falsy", () => {
    const input = "start\n{{#key}}\nline1\nline2\n{{/key}}\nend";
    const result = applyTemplateParams(input, {});
    expect(result).toBe("start\n\nend");
  });

  test("handles arithmetic expressions in replacement keys as literal text", () => {
    // applyTemplateParams does NOT evaluate arithmetic — it just replaces the key literally
    const result = applyTemplateParams("val={{slideWidth-128}}", { "slideWidth-128": "1792" });
    expect(result).toBe("val=1792");
  });
});

// ── installSkill (filesystem) ───────────────────────────────────────────────

describe("installSkill", () => {
  let tmpDir: string;
  let workspace: string;
  let modeSourceDir: string;

  beforeEach(() => {
    tmpDir = join(import.meta.dir, `.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    workspace = join(tmpDir, "workspace");
    modeSourceDir = join(tmpDir, "mode-pkg");

    // Create mode source with skill files
    mkdirSync(join(modeSourceDir, "skill"), { recursive: true });
    writeFileSync(join(modeSourceDir, "skill", "SKILL.md"), "# Skill\n\nWidth: {{width}}\n");
    writeFileSync(join(modeSourceDir, "skill", "helper.txt"), "helper content\n");

    // Create workspace
    mkdirSync(workspace, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const defaultSkillConfig: SkillConfig = {
    sourceDir: "skill",
    installName: "pneuma-test",
    claudeMdSection: "Use the test skill.",
  };

  test("copies skill files to .claude/skills/{installName}/", () => {
    installSkill(workspace, defaultSkillConfig, modeSourceDir);

    const skillDir = join(workspace, ".claude", "skills", "pneuma-test");
    expect(existsSync(join(skillDir, "SKILL.md"))).toBe(true);
    expect(existsSync(join(skillDir, "helper.txt"))).toBe(true);
  });

  test("applies template params to copied skill files", () => {
    installSkill(workspace, defaultSkillConfig, modeSourceDir, { width: 1920 });

    const content = readFileSync(
      join(workspace, ".claude", "skills", "pneuma-test", "SKILL.md"),
      "utf-8",
    );
    expect(content).toContain("Width: 1920");
    expect(content).not.toContain("{{width}}");
  });

  test("does not modify files without template extensions", () => {
    // Add a binary-like file
    writeFileSync(join(modeSourceDir, "skill", "image.png"), "binary-data");

    installSkill(workspace, defaultSkillConfig, modeSourceDir, { width: 1920 });

    const content = readFileSync(
      join(workspace, ".claude", "skills", "pneuma-test", "image.png"),
      "utf-8",
    );
    expect(content).toBe("binary-data");
  });

  test("generates .env from envMapping with non-empty values", () => {
    const config: SkillConfig = {
      ...defaultSkillConfig,
      envMapping: {
        API_KEY: "apiKey",
        SECRET: "secret",
      },
    };
    installSkill(workspace, config, modeSourceDir, { apiKey: "sk-123", secret: "" });

    const envPath = join(workspace, ".claude", "skills", "pneuma-test", ".env");
    expect(existsSync(envPath)).toBe(true);
    const envContent = readFileSync(envPath, "utf-8");
    expect(envContent).toContain("API_KEY=sk-123");
    expect(envContent).not.toContain("SECRET=");
  });

  test("does not generate .env when no non-empty values", () => {
    const config: SkillConfig = {
      ...defaultSkillConfig,
      envMapping: { KEY: "missing" },
    };
    installSkill(workspace, config, modeSourceDir, {});

    const envPath = join(workspace, ".claude", "skills", "pneuma-test", ".env");
    expect(existsSync(envPath)).toBe(false);
  });

  test("injects pneuma section into new CLAUDE.md", () => {
    installSkill(workspace, defaultSkillConfig, modeSourceDir);

    const content = readFileSync(join(workspace, "CLAUDE.md"), "utf-8");
    expect(content).toContain("<!-- pneuma:start -->");
    expect(content).toContain("Use the test skill.");
    expect(content).toContain("<!-- pneuma:end -->");
  });

  test("replaces existing pneuma section in CLAUDE.md", () => {
    writeFileSync(
      join(workspace, "CLAUDE.md"),
      "# Project\n\n<!-- pneuma:start -->\nold content\n<!-- pneuma:end -->\n\n# Other\n",
    );

    installSkill(workspace, defaultSkillConfig, modeSourceDir);

    const content = readFileSync(join(workspace, "CLAUDE.md"), "utf-8");
    expect(content).toContain("Use the test skill.");
    expect(content).not.toContain("old content");
    // Preserve surrounding content
    expect(content).toContain("# Project");
    expect(content).toContain("# Other");
  });

  test("appends pneuma section to existing CLAUDE.md without markers", () => {
    writeFileSync(join(workspace, "CLAUDE.md"), "# My Project\n");

    installSkill(workspace, defaultSkillConfig, modeSourceDir);

    const content = readFileSync(join(workspace, "CLAUDE.md"), "utf-8");
    expect(content).toStartWith("# My Project\n");
    expect(content).toContain("<!-- pneuma:start -->");
  });

  test("creates .gitignore with .pneuma/ entry", () => {
    installSkill(workspace, defaultSkillConfig, modeSourceDir);

    const content = readFileSync(join(workspace, ".gitignore"), "utf-8");
    expect(content).toContain(".pneuma/");
  });

  test("appends .pneuma/ to existing .gitignore without duplicating", () => {
    writeFileSync(join(workspace, ".gitignore"), "node_modules/\n");

    installSkill(workspace, defaultSkillConfig, modeSourceDir);

    const content = readFileSync(join(workspace, ".gitignore"), "utf-8");
    expect(content).toContain("node_modules/");
    expect(content).toContain(".pneuma/");
    // Should only appear once
    const matches = content.match(/\.pneuma\//g);
    expect(matches?.length).toBe(1);
  });

  test("does not duplicate .pneuma/ in .gitignore on re-install", () => {
    writeFileSync(join(workspace, ".gitignore"), ".pneuma/\n");

    installSkill(workspace, defaultSkillConfig, modeSourceDir);

    const content = readFileSync(join(workspace, ".gitignore"), "utf-8");
    const matches = content.match(/\.pneuma\//g);
    expect(matches?.length).toBe(1);
  });

  test("applies template params to claudeMdSection", () => {
    const config: SkillConfig = {
      ...defaultSkillConfig,
      claudeMdSection: "Canvas size: {{width}}x{{height}}",
    };
    installSkill(workspace, config, modeSourceDir, { width: 1920, height: 1080 });

    const content = readFileSync(join(workspace, "CLAUDE.md"), "utf-8");
    expect(content).toContain("Canvas size: 1920x1080");
  });

  test("injects viewer API section with independent markers", () => {
    const viewerApi: ViewerApiConfig = {
      workspace: { type: "manifest", multiFile: true, ordered: true, hasActiveFile: true, manifestFile: "manifest.json" },
      actions: [
        { id: "navigate-to", label: "Go to Slide", category: "navigate", agentInvocable: true,
          params: { file: { type: "string", description: "Slide file path", required: true } },
          description: "Navigate to a specific slide" },
      ],
    };
    installSkill(workspace, defaultSkillConfig, modeSourceDir, {}, viewerApi);

    const content = readFileSync(join(workspace, "CLAUDE.md"), "utf-8");
    // Skill section
    expect(content).toContain("<!-- pneuma:start -->");
    expect(content).toContain("<!-- pneuma:end -->");
    // Viewer API section (independent)
    expect(content).toContain("<!-- pneuma:viewer-api:start -->");
    expect(content).toContain("<!-- pneuma:viewer-api:end -->");
    expect(content).toContain("## Viewer API");
    expect(content).toContain("`navigate-to`");
    expect(content).toContain("manifest.json");
  });

  test("viewer API section is independent of skill section", () => {
    // First install with viewer API
    const viewerApi: ViewerApiConfig = {
      workspace: { type: "all", multiFile: true, ordered: false, hasActiveFile: false },
    };
    installSkill(workspace, defaultSkillConfig, modeSourceDir, {}, viewerApi);

    const content1 = readFileSync(join(workspace, "CLAUDE.md"), "utf-8");
    expect(content1).toContain("<!-- pneuma:viewer-api:start -->");

    // Re-install with different skill but same viewer
    const newSkillConfig: SkillConfig = {
      ...defaultSkillConfig,
      claudeMdSection: "New skill content!",
    };
    installSkill(workspace, newSkillConfig, modeSourceDir, {}, viewerApi);

    const content2 = readFileSync(join(workspace, "CLAUDE.md"), "utf-8");
    expect(content2).toContain("New skill content!");
    expect(content2).toContain("<!-- pneuma:viewer-api:start -->");
    // Both sections present
    expect(content2).toContain("<!-- pneuma:start -->");
  });

  test("no viewer API section when viewerApi is undefined", () => {
    installSkill(workspace, defaultSkillConfig, modeSourceDir);

    const content = readFileSync(join(workspace, "CLAUDE.md"), "utf-8");
    expect(content).not.toContain("<!-- pneuma:viewer-api:start -->");
  });
});

// ── generateViewerApiSection (pure) ────────────────────────────────────────

describe("generateViewerApiSection", () => {
  test("returns empty for undefined", () => {
    expect(generateViewerApiSection(undefined)).toBe("");
  });

  test("returns empty for empty viewerApi", () => {
    expect(generateViewerApiSection({})).toBe("");
  });

  test("includes workspace model description", () => {
    const result = generateViewerApiSection({
      workspace: { type: "manifest", multiFile: true, ordered: true, hasActiveFile: true, manifestFile: "manifest.json" },
    });
    expect(result).toContain("## Viewer API");
    expect(result).toContain("Type: manifest");
    expect(result).toContain("ordered");
    expect(result).toContain("manifest.json");
  });

  test("includes actions table", () => {
    const result = generateViewerApiSection({
      actions: [
        { id: "navigate-to", label: "Go", category: "navigate", agentInvocable: true,
          params: { file: { type: "string", description: "path", required: true } },
          description: "Navigate" },
        { id: "internal", label: "X", category: "custom", agentInvocable: false },
      ],
    });
    expect(result).toContain("`navigate-to`");
    // Non-agent-invocable actions should be filtered out
    expect(result).not.toContain("`internal`");
  });

  test("uses custom port", () => {
    const result = generateViewerApiSection({
      actions: [{ id: "test", label: "T", category: "custom", agentInvocable: true, description: "test" }],
    }, 9999);
    expect(result).toContain("localhost:9999");
  });

  test("workspace only (no actions)", () => {
    const result = generateViewerApiSection({
      workspace: { type: "single", multiFile: false, ordered: false, hasActiveFile: false },
    });
    expect(result).toContain("Type: single");
    expect(result).not.toContain("### Actions");
  });
});

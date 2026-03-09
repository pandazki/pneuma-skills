/**
 * End-to-end test: WebCraft Mode
 *
 * Verifies the full flow:
 * 1. Mode loading via manifest import
 * 2. Manifest validation (required fields, viewer actions, watch patterns)
 * 3. Skill installation (SKILL.md + 24 reference files)
 * 4. SKILL.md content (Impeccable principles, 17 commands, AI slop test)
 * 5. Reference file completeness (7 design + 17 command references)
 * 6. CLAUDE.md injection with pneuma markers
 * 7. Seed file (index.html) for empty workspaces
 * 8. Seed quality (OKLCH, fluid typography, semantic HTML, responsive, reduced motion)
 * 9. Viewer actions (all 17 Impeccable commands)
 * 10. Watch patterns (HTML, CSS, JS, images)
 * 11. Template placeholder resolution
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, readFileSync, existsSync, rmSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { installSkill } from "../skill-installer.js";

import webcraftManifest from "../../modes/webcraft/manifest.js";

const PROJECT_ROOT = join(import.meta.dir, "../..");
const TEST_DIR = join(import.meta.dir, ".tmp-webcraft-e2e");
const MODE_SOURCE_DIR = join(PROJECT_ROOT, "modes", "webcraft");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
});

function makeWorkspace(name: string): string {
  const ws = join(TEST_DIR, name);
  mkdirSync(ws, { recursive: true });
  return ws;
}

function installWebcraftSkill(ws: string): void {
  installSkill(ws, webcraftManifest.skill, MODE_SOURCE_DIR, {}, webcraftManifest.viewerApi);
}

// ── 1. Mode Loading ──────────────────────────────────────────────────────────

describe("mode loading", () => {
  it("webcraft manifest can be imported and has correct name", () => {
    expect(webcraftManifest).toBeDefined();
    expect(webcraftManifest.name).toBe("webcraft");
  });

  it("manifest exports a valid ModeManifest shape", () => {
    expect(typeof webcraftManifest.name).toBe("string");
    expect(typeof webcraftManifest.version).toBe("string");
    expect(typeof webcraftManifest.displayName).toBe("string");
    expect(typeof webcraftManifest.description).toBe("string");
    expect(webcraftManifest.skill).toBeDefined();
    expect(webcraftManifest.viewer).toBeDefined();
    expect(webcraftManifest.viewerApi).toBeDefined();
    expect(webcraftManifest.agent).toBeDefined();
    expect(webcraftManifest.init).toBeDefined();
  });
});

// ── 2. Manifest Validation ───────────────────────────────────────────────────

describe("manifest validation", () => {
  it("has all required top-level fields", () => {
    expect(webcraftManifest.name).toBe("webcraft");
    expect(webcraftManifest.version).toBe("1.0.0");
    expect(webcraftManifest.displayName).toBe("WebCraft");
    expect(webcraftManifest.description).toContain("Impeccable");
    expect(webcraftManifest.icon).toContain("<svg");
  });

  it("skill config has sourceDir and installName", () => {
    expect(webcraftManifest.skill.sourceDir).toBe("skill");
    expect(webcraftManifest.skill.installName).toBe("pneuma-webcraft");
    expect(webcraftManifest.skill.claudeMdSection).toContain("pneuma-webcraft");
  });

  it("agent config has permissionMode and greeting", () => {
    expect(webcraftManifest.agent.permissionMode).toBe("bypassPermissions");
    expect(webcraftManifest.agent.greeting).toContain("Impeccable");
  });

  it("init config has contentCheckPattern and seed files", () => {
    expect(webcraftManifest.init!.contentCheckPattern).toBe("**/manifest.json");
    expect(webcraftManifest.init!.seedFiles).toBeDefined();
    expect(webcraftManifest.init!.seedFiles!["modes/webcraft/seed/default/"]).toBe("default/");
  });

  it("evolution config has directive", () => {
    expect(webcraftManifest.evolution).toBeDefined();
    expect(webcraftManifest.evolution!.directive).toContain("design preferences");
  });
});

// ── 3. Skill Installation ────────────────────────────────────────────────────

describe("skill installation", () => {
  it("installs SKILL.md to .claude/skills/pneuma-webcraft/", () => {
    const ws = makeWorkspace("install-skill");
    installWebcraftSkill(ws);

    const skillMdPath = join(ws, ".claude", "skills", "pneuma-webcraft", "SKILL.md");
    expect(existsSync(skillMdPath)).toBe(true);
    const content = readFileSync(skillMdPath, "utf-8");
    expect(content.length).toBeGreaterThan(100);
  });

  it("installs all 24 reference files", () => {
    const ws = makeWorkspace("install-refs");
    installWebcraftSkill(ws);

    const refsDir = join(ws, ".claude", "skills", "pneuma-webcraft", "references");
    expect(existsSync(refsDir)).toBe(true);

    const files = readdirSync(refsDir).filter((f) => f.endsWith(".md"));
    expect(files.length).toBe(24);
  });

  it("creates CLAUDE.md in workspace root", () => {
    const ws = makeWorkspace("install-claude-md");
    installWebcraftSkill(ws);

    const claudeMdPath = join(ws, "CLAUDE.md");
    expect(existsSync(claudeMdPath)).toBe(true);
  });

  it("creates .gitignore with .pneuma/ entry", () => {
    const ws = makeWorkspace("install-gitignore");
    installWebcraftSkill(ws);

    const gitignorePath = join(ws, ".gitignore");
    expect(existsSync(gitignorePath)).toBe(true);
    const content = readFileSync(gitignorePath, "utf-8");
    expect(content).toContain(".pneuma/");
  });
});

// ── 4. Skill Content ─────────────────────────────────────────────────────────

describe("SKILL.md content", () => {
  it("has YAML frontmatter with name and description", () => {
    const ws = makeWorkspace("skill-content-fm");
    installWebcraftSkill(ws);

    const skillMd = readFileSync(join(ws, ".claude", "skills", "pneuma-webcraft", "SKILL.md"), "utf-8");
    expect(skillMd.startsWith("---\n")).toBe(true);
    expect(skillMd).toContain("name: pneuma-webcraft");
    expect(skillMd).toContain("description:");
  });

  it("contains Impeccable design principles sections", () => {
    const ws = makeWorkspace("skill-content-principles");
    installWebcraftSkill(ws);

    const skillMd = readFileSync(join(ws, ".claude", "skills", "pneuma-webcraft", "SKILL.md"), "utf-8");
    expect(skillMd).toContain("## Core Principles");
    expect(skillMd).toContain("### Design Direction");
    expect(skillMd).toContain("### Typography");
    expect(skillMd).toContain("### Color & Theme");
    expect(skillMd).toContain("### Layout & Space");
    expect(skillMd).toContain("### Motion");
    expect(skillMd).toContain("### Interaction");
    expect(skillMd).toContain("### Responsive");
    expect(skillMd).toContain("### UX Writing");
    expect(skillMd).toContain("### Visual Details");
    expect(skillMd).toContain("### Implementation Principles");
  });

  it("contains the AI Slop Test section", () => {
    const ws = makeWorkspace("skill-content-slop");
    installWebcraftSkill(ws);

    const skillMd = readFileSync(join(ws, ".claude", "skills", "pneuma-webcraft", "SKILL.md"), "utf-8");
    expect(skillMd).toContain("### The AI Slop Test");
    expect(skillMd).toContain("which AI made this");
  });

  it("lists all 17 Impeccable commands", () => {
    const ws = makeWorkspace("skill-content-cmds");
    installWebcraftSkill(ws);

    const skillMd = readFileSync(join(ws, ".claude", "skills", "pneuma-webcraft", "SKILL.md"), "utf-8");

    const expectedCommands = [
      "teach-impeccable",
      "audit",
      "critique",
      "normalize",
      "polish",
      "distill",
      "clarify",
      "optimize",
      "harden",
      "animate",
      "colorize",
      "bolder",
      "quieter",
      "delight",
      "extract",
      "adapt",
      "onboard",
    ];

    for (const cmd of expectedCommands) {
      expect(skillMd).toContain(`**${cmd}**`);
    }
    expect(expectedCommands.length).toBe(17);
  });

  it("contains command category sections", () => {
    const ws = makeWorkspace("skill-content-cats");
    installWebcraftSkill(ws);

    const skillMd = readFileSync(join(ws, ".claude", "skills", "pneuma-webcraft", "SKILL.md"), "utf-8");
    expect(skillMd).toContain("### Setup");
    expect(skillMd).toContain("### Review");
    expect(skillMd).toContain("### Refine");
    expect(skillMd).toContain("### Performance");
    expect(skillMd).toContain("### Style");
    expect(skillMd).toContain("### Architecture");
  });

  it("has command execution notes with placeholder replacement instructions", () => {
    const ws = makeWorkspace("skill-content-exec");
    installWebcraftSkill(ws);

    const skillMd = readFileSync(join(ws, ".claude", "skills", "pneuma-webcraft", "SKILL.md"), "utf-8");
    expect(skillMd).toContain("### Command Execution Notes");
    expect(skillMd).toContain("{{ask_instruction}}");
    expect(skillMd).toContain("{{config_file}}");
    expect(skillMd).toContain("{{model}}");
    expect(skillMd).toContain("{{available_commands}}");
  });
});

// ── 5. Reference File Completeness ───────────────────────────────────────────

describe("reference file completeness", () => {
  const designReferences = [
    "typography.md",
    "color-and-contrast.md",
    "spatial-design.md",
    "motion-design.md",
    "interaction-design.md",
    "responsive-design.md",
    "ux-writing.md",
  ];

  const commandReferences = [
    "cmd-teach-impeccable.md",
    "cmd-audit.md",
    "cmd-critique.md",
    "cmd-normalize.md",
    "cmd-polish.md",
    "cmd-distill.md",
    "cmd-clarify.md",
    "cmd-optimize.md",
    "cmd-harden.md",
    "cmd-animate.md",
    "cmd-colorize.md",
    "cmd-bolder.md",
    "cmd-quieter.md",
    "cmd-delight.md",
    "cmd-extract.md",
    "cmd-adapt.md",
    "cmd-onboard.md",
  ];

  it("has exactly 7 design reference files", () => {
    expect(designReferences.length).toBe(7);
  });

  it("has exactly 17 command reference files", () => {
    expect(commandReferences.length).toBe(17);
  });

  it("all 7 design references exist and have content", () => {
    const ws = makeWorkspace("refs-design");
    installWebcraftSkill(ws);

    const refsDir = join(ws, ".claude", "skills", "pneuma-webcraft", "references");
    for (const ref of designReferences) {
      const refPath = join(refsDir, ref);
      expect(existsSync(refPath)).toBe(true);
      const content = readFileSync(refPath, "utf-8");
      expect(content.length).toBeGreaterThan(50);
    }
  });

  it("all 17 command references exist and have content", () => {
    const ws = makeWorkspace("refs-commands");
    installWebcraftSkill(ws);

    const refsDir = join(ws, ".claude", "skills", "pneuma-webcraft", "references");
    for (const ref of commandReferences) {
      const refPath = join(refsDir, ref);
      expect(existsSync(refPath)).toBe(true);
      const content = readFileSync(refPath, "utf-8");
      expect(content.length).toBeGreaterThan(50);
    }
  });

  it("no extra unexpected files in references/", () => {
    const ws = makeWorkspace("refs-no-extra");
    installWebcraftSkill(ws);

    const refsDir = join(ws, ".claude", "skills", "pneuma-webcraft", "references");
    const allFiles = readdirSync(refsDir).filter((f) => f.endsWith(".md")).sort();
    const expectedFiles = [...designReferences, ...commandReferences].sort();
    expect(allFiles).toEqual(expectedFiles);
  });

  it("SKILL.md references all design reference files", () => {
    const ws = makeWorkspace("refs-links-design");
    installWebcraftSkill(ws);

    const skillMd = readFileSync(join(ws, ".claude", "skills", "pneuma-webcraft", "SKILL.md"), "utf-8");
    for (const ref of designReferences) {
      expect(skillMd).toContain(`references/${ref}`);
    }
  });

  it("SKILL.md references all command reference files", () => {
    const ws = makeWorkspace("refs-links-cmd");
    installWebcraftSkill(ws);

    const skillMd = readFileSync(join(ws, ".claude", "skills", "pneuma-webcraft", "SKILL.md"), "utf-8");
    for (const ref of commandReferences) {
      expect(skillMd).toContain(`references/${ref}`);
    }
  });
});

// ── 6. CLAUDE.md Injection ───────────────────────────────────────────────────

describe("CLAUDE.md injection", () => {
  it("contains pneuma markers wrapping the skill section", () => {
    const ws = makeWorkspace("claudemd-markers");
    installWebcraftSkill(ws);

    const claudeMd = readFileSync(join(ws, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toContain("<!-- pneuma:start -->");
    expect(claudeMd).toContain("<!-- pneuma:end -->");
  });

  it("contains viewer-api markers", () => {
    const ws = makeWorkspace("claudemd-viewer-api");
    installWebcraftSkill(ws);

    const claudeMd = readFileSync(join(ws, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toContain("<!-- pneuma:viewer-api:start -->");
    expect(claudeMd).toContain("<!-- pneuma:viewer-api:end -->");
  });

  it("directs agent to consult the pneuma-webcraft skill", () => {
    const ws = makeWorkspace("claudemd-consult");
    installWebcraftSkill(ws);

    const claudeMd = readFileSync(join(ws, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toContain("consult the `pneuma-webcraft` skill");
  });

  it("has Core Rules section in CLAUDE.md", () => {
    const ws = makeWorkspace("claudemd-rules");
    installWebcraftSkill(ws);

    const claudeMd = readFileSync(join(ws, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toContain("### Core Rules");
    expect(claudeMd).toContain("Impeccable.style design principles");
  });

  it("viewer-api section describes workspace type", () => {
    const ws = makeWorkspace("claudemd-ws-type");
    installWebcraftSkill(ws);

    const claudeMd = readFileSync(join(ws, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toContain("### Workspace");
    expect(claudeMd).toContain("Type: manifest (multi-file, active file tracking)");
  });

  it("pneuma section is properly ordered (start before end)", () => {
    const ws = makeWorkspace("claudemd-order");
    installWebcraftSkill(ws);

    const claudeMd = readFileSync(join(ws, "CLAUDE.md"), "utf-8");
    const pneumaStart = claudeMd.indexOf("<!-- pneuma:start -->");
    const pneumaEnd = claudeMd.indexOf("<!-- pneuma:end -->");
    const viewerStart = claudeMd.indexOf("<!-- pneuma:viewer-api:start -->");
    const viewerEnd = claudeMd.indexOf("<!-- pneuma:viewer-api:end -->");

    expect(pneumaStart).toBeGreaterThanOrEqual(0);
    expect(pneumaEnd).toBeGreaterThan(pneumaStart);
    expect(viewerStart).toBeGreaterThanOrEqual(0);
    expect(viewerEnd).toBeGreaterThan(viewerStart);
  });

  it("does not contain evolved section on fresh install", () => {
    const ws = makeWorkspace("claudemd-no-evolved");
    installWebcraftSkill(ws);

    const claudeMd = readFileSync(join(ws, "CLAUDE.md"), "utf-8");
    expect(claudeMd).not.toContain("<!-- pneuma:evolved:start -->");
    expect(claudeMd).not.toContain("<!-- pneuma:evolved:end -->");
  });
});

// ── 7. Seed File ─────────────────────────────────────────────────────────────

describe("seed file", () => {
  it("seed index.html exists in mode source", () => {
    const seedPath = join(MODE_SOURCE_DIR, "seed", "default", "index.html");
    expect(existsSync(seedPath)).toBe(true);
  });

  it("seed index.html is a complete HTML document", () => {
    const seedPath = join(MODE_SOURCE_DIR, "seed", "default", "index.html");
    const content = readFileSync(seedPath, "utf-8");
    expect(content).toContain("<!DOCTYPE html>");
    expect(content).toContain("<html");
    expect(content).toContain("</html>");
    expect(content).toContain("<head>");
    expect(content).toContain("<body>");
  });

  it("seed maps to default/ directory in workspace", () => {
    const seedFiles = webcraftManifest.init!.seedFiles!;
    const entries = Object.entries(seedFiles);
    expect(entries.length).toBe(1);
    expect(entries[0][0]).toBe("modes/webcraft/seed/default/");
    expect(entries[0][1]).toBe("default/");
  });
});

// ── 8. Seed Quality (Impeccable Principles) ─────────────────────────────────

describe("seed quality — Impeccable principles", () => {
  let seedHtml: string;

  beforeEach(() => {
    seedHtml = readFileSync(join(MODE_SOURCE_DIR, "seed", "default", "index.html"), "utf-8");
  });

  it("uses OKLCH color functions", () => {
    expect(seedHtml).toContain("oklch(");
  });

  it("uses fluid typography with clamp()", () => {
    expect(seedHtml).toContain("clamp(");
    // Font size should use fluid sizing
    expect(seedHtml).toMatch(/font-size:\s*clamp\(/);
  });

  it("uses semantic HTML elements", () => {
    expect(seedHtml).toContain("<header");
    expect(seedHtml).toContain("<nav");
    expect(seedHtml).toContain("<section");
    expect(seedHtml).toContain("<footer");
    expect(seedHtml).toContain('lang="en"');
  });

  it("is responsive with media queries", () => {
    expect(seedHtml).toContain("@media");
    expect(seedHtml).toContain("max-width:");
  });

  it("includes reduced motion support", () => {
    expect(seedHtml).toContain("prefers-reduced-motion");
  });

  it("does not use overused AI slop fonts (Inter, Roboto, Arial)", () => {
    // These fonts should not appear as primary font choices
    expect(seedHtml).not.toMatch(/font-family:.*\bInter\b/);
    expect(seedHtml).not.toMatch(/font-family:.*\bRoboto\b/);
    expect(seedHtml).not.toMatch(/font-family:.*\bArial\b/);
  });

  it("uses CSS custom properties for theming", () => {
    expect(seedHtml).toContain(":root {");
    expect(seedHtml).toContain("var(--");
  });

  it("uses fluid spacing with clamp()", () => {
    // Spacing tokens should use clamp for fluid scaling
    expect(seedHtml).toMatch(/--space-.*:\s*clamp\(/);
  });

  it("avoids pure black and pure white", () => {
    // In CSS custom property declarations, should not use #000 or #fff
    // (oklch equivalents are fine)
    const cssSection = seedHtml.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
    // Check that the design tokens don't use #000 or #fff
    expect(cssSection).not.toMatch(/:\s*#000\b/);
    expect(cssSection).not.toMatch(/:\s*#fff\b/);
  });

  it("has viewport meta tag for mobile", () => {
    expect(seedHtml).toContain('name="viewport"');
    expect(seedHtml).toContain("width=device-width");
  });

  it("uses distinctive font pairing (not system defaults)", () => {
    // Should load custom fonts
    expect(seedHtml).toContain("fonts.googleapis.com");
    // Should define display and body font families
    expect(seedHtml).toContain("--font-display:");
    expect(seedHtml).toContain("--font-body:");
  });
});

// ── 9. Viewer Actions ────────────────────────────────────────────────────────

describe("viewer actions", () => {
  const expectedCommandIds = [
    "teach-impeccable",
    "audit",
    "critique",
    "normalize",
    "polish",
    "distill",
    "clarify",
    "optimize",
    "harden",
    "animate",
    "colorize",
    "bolder",
    "quieter",
    "delight",
    "extract",
    "adapt",
    "onboard",
  ];

  it("defines exactly 17 viewer actions", () => {
    expect(webcraftManifest.viewerApi!.actions!.length).toBe(17);
  });

  it("all 17 Impeccable commands are defined as viewer actions", () => {
    const actionIds = webcraftManifest.viewerApi!.actions!.map((a) => a.id);
    for (const cmd of expectedCommandIds) {
      expect(actionIds).toContain(cmd);
    }
  });

  it("all actions have category 'custom'", () => {
    for (const action of webcraftManifest.viewerApi!.actions!) {
      expect(action.category).toBe("custom");
    }
  });

  it("all actions are not agent-invocable (user-triggered only)", () => {
    for (const action of webcraftManifest.viewerApi!.actions!) {
      expect(action.agentInvocable).toBe(false);
    }
  });

  it("all actions have a label and description", () => {
    for (const action of webcraftManifest.viewerApi!.actions!) {
      expect(action.label).toBeTruthy();
      expect(action.description).toBeTruthy();
      expect(action.label!.length).toBeGreaterThan(0);
      expect(action.description!.length).toBeGreaterThan(10);
    }
  });
});

// ── 10. Watch Patterns ───────────────────────────────────────────────────────

describe("watch patterns", () => {
  it("watches HTML files", () => {
    expect(webcraftManifest.viewer.watchPatterns).toContain("**/*.html");
  });

  it("watches CSS files", () => {
    expect(webcraftManifest.viewer.watchPatterns).toContain("**/*.css");
  });

  it("watches JavaScript files", () => {
    expect(webcraftManifest.viewer.watchPatterns).toContain("**/*.js");
  });

  it("watches TypeScript files", () => {
    expect(webcraftManifest.viewer.watchPatterns).toContain("**/*.ts");
    expect(webcraftManifest.viewer.watchPatterns).toContain("**/*.tsx");
  });

  it("watches image files (png, jpg, jpeg, gif, webp, svg)", () => {
    const patterns = webcraftManifest.viewer.watchPatterns!;
    expect(patterns).toContain("**/*.png");
    expect(patterns).toContain("**/*.jpg");
    expect(patterns).toContain("**/*.jpeg");
    expect(patterns).toContain("**/*.gif");
    expect(patterns).toContain("**/*.webp");
    expect(patterns).toContain("**/*.svg");
  });

  it("watches font files", () => {
    const patterns = webcraftManifest.viewer.watchPatterns!;
    expect(patterns).toContain("**/*.woff");
    expect(patterns).toContain("**/*.woff2");
  });

  it("ignores node_modules, .git, .claude, .pneuma", () => {
    const ignores = webcraftManifest.viewer.ignorePatterns!;
    expect(ignores).toContain("node_modules/**");
    expect(ignores).toContain(".git/**");
    expect(ignores).toContain(".claude/**");
    expect(ignores).toContain(".pneuma/**");
  });

  it("serves from workspace root", () => {
    expect(webcraftManifest.viewer.serveDir).toBe(".");
  });
});

// ── 11. Template Placeholder Resolution ──────────────────────────────────────

describe("template placeholder resolution", () => {
  it("SKILL.md contains template placeholders as replacement instructions (not unresolved)", () => {
    const ws = makeWorkspace("template-check");
    installWebcraftSkill(ws);

    const skillMd = readFileSync(join(ws, ".claude", "skills", "pneuma-webcraft", "SKILL.md"), "utf-8");

    // The SKILL.md intentionally contains {{model}}, {{config_file}}, {{ask_instruction}}
    // as instructions for runtime replacement when commands are executed.
    // These are NOT template params that should have been replaced during install.
    // Verify they appear in the "Command Execution Notes" section (instructional context).
    const execNotesSection = skillMd.split("### Command Execution Notes")[1];
    expect(execNotesSection).toBeDefined();
    expect(execNotesSection).toContain("{{model}}");
    expect(execNotesSection).toContain("{{config_file}}");
    expect(execNotesSection).toContain("{{ask_instruction}}");
    expect(execNotesSection).toContain("{{available_commands}}");
  });

  it("SKILL.md does not have unresolved install-time template params", () => {
    const ws = makeWorkspace("template-no-unresolved");
    installWebcraftSkill(ws);

    const skillMd = readFileSync(join(ws, ".claude", "skills", "pneuma-webcraft", "SKILL.md"), "utf-8");

    // The Command Execution Notes section intentionally documents runtime placeholders.
    // Remove that section and check the rest for any unexpected {{...}} patterns.
    const beforeExecNotes = skillMd.split("### Command Execution Notes")[0];

    // Should not contain install-time template params like {{slideWidth}}, {{modeName}}, etc.
    // But the design references section may contain markdown links with "references/" paths.
    // Check for any double-brace patterns that look like unresolved install-time templates.
    const unresolvedMatches = beforeExecNotes.match(/\{\{[a-zA-Z_]+\}\}/g) || [];
    expect(unresolvedMatches).toEqual([]);
  });

  it("reference files do not contain unresolved install-time template params", () => {
    const ws = makeWorkspace("template-refs-check");
    installWebcraftSkill(ws);

    const refsDir = join(ws, ".claude", "skills", "pneuma-webcraft", "references");
    const files = readdirSync(refsDir).filter((f) => f.endsWith(".md"));

    for (const file of files) {
      const content = readFileSync(join(refsDir, file), "utf-8");
      // Command references intentionally contain {{model}}, {{config_file}}, {{ask_instruction}},
      // {{available_commands}} as runtime placeholders for the agent to replace when executing commands.
      // These are documented in SKILL.md's "Command Execution Notes" section.
      // We verify that no OTHER unexpected template params exist.
      const allPlaceholders = content.match(/\{\{[a-zA-Z_]+\}\}/g) || [];
      const allowedRuntimePlaceholders = new Set([
        "{{model}}",
        "{{config_file}}",
        "{{ask_instruction}}",
        "{{available_commands}}",
      ]);
      const unexpected = allPlaceholders.filter((p) => !allowedRuntimePlaceholders.has(p));
      expect(unexpected).toEqual([]);
    }
  });

  it("CLAUDE.md does not contain unresolved template params", () => {
    const ws = makeWorkspace("template-claudemd");
    installWebcraftSkill(ws);

    const claudeMd = readFileSync(join(ws, "CLAUDE.md"), "utf-8");
    const unresolvedMatches = claudeMd.match(/\{\{[a-zA-Z_]+\}\}/g) || [];
    expect(unresolvedMatches).toEqual([]);
  });
});

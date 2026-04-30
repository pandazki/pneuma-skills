/**
 * End-to-end test: Skill Effectiveness Optimization
 *
 * Verifies the full flow:
 * 1. Skill installation produces correct CLAUDE.md with "Skill Reference" directive
 * 2. SKILL.md files have YAML frontmatter
 * 3. Evolution apply → CLAUDE.md gets "Learned Preferences" section
 * 4. Evolution rollback → CLAUDE.md restored
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, readFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { installSkill } from "../skill-installer.js";
import { saveProposal, applyProposal, rollbackProposal } from "../evolution-proposal.js";
import type { EvolutionProposal } from "../evolution-proposal.js";

// Import manifests
import docManifest from "../../modes/doc/manifest.js";
import drawManifest from "../../modes/draw/manifest.js";
import slideManifest from "../../modes/slide/manifest.js";
import modeMakerManifest from "../../modes/mode-maker/manifest.js";

const PROJECT_ROOT = join(import.meta.dir, "../..");
const TEST_DIR = join(import.meta.dir, ".tmp-e2e-skill-effectiveness");

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

// ── 1. Skill Installation: CLAUDE.md has skill consult directive + core rules ─

describe("skill installation → CLAUDE.md skill reference", () => {
  // Note: the "core rules" assertions were removed — mode-specific Core Rules
  // sections moved out of CLAUDE.md and now live exclusively in the mode's
  // SKILL.md (loaded via Claude Code progressive disclosure). The pneuma:start
  // block in CLAUDE.md is now a slim scene + pointer to the skill.

  it("doc mode: CLAUDE.md directs agent to consult skill", () => {
    const ws = makeWorkspace("doc-e2e");
    const modeSourceDir = join(PROJECT_ROOT, "modes", "doc");
    installSkill({
      workspace: ws,
      skillConfig: docManifest.skill,
      modeSourceDir,
      params: {},
      viewerApi: docManifest.viewerApi,
    });

    const claudeMd = readFileSync(join(ws, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toContain("`pneuma-doc` skill");
    expect(claudeMd).toContain("pull it in when you're about to act on a substantive task");
  });

  it("draw mode: CLAUDE.md directs agent to consult skill", () => {
    const ws = makeWorkspace("draw-e2e");
    const modeSourceDir = join(PROJECT_ROOT, "modes", "draw");
    installSkill({
      workspace: ws,
      skillConfig: drawManifest.skill,
      modeSourceDir,
      params: {},
      viewerApi: drawManifest.viewerApi,
    });

    const claudeMd = readFileSync(join(ws, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toContain("`pneuma-draw` skill");
    expect(claudeMd).toContain("pull it in when you're about to act on a substantive task");
  });

  it("slide mode: CLAUDE.md directs agent to consult skill", () => {
    const ws = makeWorkspace("slide-e2e");
    const modeSourceDir = join(PROJECT_ROOT, "modes", "slide");
    installSkill({
      workspace: ws,
      skillConfig: slideManifest.skill,
      modeSourceDir,
      params: { slideWidth: 1280, slideHeight: 720 },
      viewerApi: slideManifest.viewerApi,
    });

    const claudeMd = readFileSync(join(ws, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toContain("`pneuma-slide` skill");
    expect(claudeMd).toContain("pull it in when you're about to act on a substantive task");
  });

  it("mode-maker: CLAUDE.md directs agent to consult skill", () => {
    const ws = makeWorkspace("mode-maker-e2e");
    const modeSourceDir = join(PROJECT_ROOT, "modes", "mode-maker");
    installSkill({
      workspace: ws,
      skillConfig: modeMakerManifest.skill,
      modeSourceDir,
      params: {},
      viewerApi: modeMakerManifest.viewerApi,
    });

    const claudeMd = readFileSync(join(ws, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toContain("`pneuma-mode-maker` skill");
    expect(claudeMd).toContain("pull it in when you're about to act on a substantive task");
  });
});

// ── 2. SKILL.md files have YAML frontmatter ─────────────────────────────────

describe("SKILL.md YAML frontmatter", () => {
  it("doc SKILL.md has name and description frontmatter", () => {
    const ws = makeWorkspace("doc-fm");
    const modeSourceDir = join(PROJECT_ROOT, "modes", "doc");
    installSkill({
      workspace: ws,
      skillConfig: docManifest.skill,
      modeSourceDir,
      params: {},
      viewerApi: docManifest.viewerApi,
    });

    const skillMd = readFileSync(join(ws, ".claude", "skills", "pneuma-doc", "SKILL.md"), "utf-8");
    expect(skillMd.startsWith("---\n")).toBe(true);
    expect(skillMd).toContain("name: pneuma-doc");
    expect(skillMd).toContain("description:");
    // Verify content sections exist (trimmed: generic markdown knowledge removed)
    expect(skillMd).toContain("## Core Principles");
    expect(skillMd).toContain("## File Convention");
    expect(skillMd).toContain("## Editing Guidelines");
  });

  it("draw SKILL.md has name and description frontmatter", () => {
    const ws = makeWorkspace("draw-fm");
    const modeSourceDir = join(PROJECT_ROOT, "modes", "draw");
    installSkill({
      workspace: ws,
      skillConfig: drawManifest.skill,
      modeSourceDir,
      params: {},
      viewerApi: drawManifest.viewerApi,
    });

    const skillMd = readFileSync(join(ws, ".claude", "skills", "pneuma-draw", "SKILL.md"), "utf-8");
    expect(skillMd.startsWith("---\n")).toBe(true);
    expect(skillMd).toContain("name: pneuma-draw");
    expect(skillMd).toContain("description:");
    // Existing content preserved (JSON schema extracted to references/)
    expect(skillMd).toContain("## Element Types");
    expect(skillMd).toContain("## Binding");
  });

  it("slide SKILL.md already has frontmatter (unchanged)", () => {
    const ws = makeWorkspace("slide-fm");
    const modeSourceDir = join(PROJECT_ROOT, "modes", "slide");
    installSkill({
      workspace: ws,
      skillConfig: slideManifest.skill,
      modeSourceDir,
      params: { slideWidth: 1280, slideHeight: 720 },
      viewerApi: slideManifest.viewerApi,
    });

    const skillMd = readFileSync(join(ws, ".claude", "skills", "pneuma-slide", "SKILL.md"), "utf-8");
    expect(skillMd.startsWith("---\n")).toBe(true);
    expect(skillMd).toContain("name: pneuma-slide");
  });
});

// ── 3. Evolution apply → CLAUDE.md sync ─────────────────────────────────────

describe("evolution apply/rollback → CLAUDE.md sync (end-to-end)", () => {
  function setupEvolutionWorkspace(): string {
    const ws = makeWorkspace("evo-e2e");
    const modeSourceDir = join(PROJECT_ROOT, "modes", "slide");
    installSkill({
      workspace: ws,
      skillConfig: slideManifest.skill,
      modeSourceDir,
      params: { slideWidth: 1280, slideHeight: 720 },
      viewerApi: slideManifest.viewerApi,
    });
    return ws;
  }

  function makeEvoProposal(workspace: string): EvolutionProposal {
    return {
      id: "evo-e2e-001",
      createdAt: new Date().toISOString(),
      mode: "slide",
      workspace,
      status: "pending",
      summary: "Add image quality and theme selection preferences",
      changes: [
        {
          file: ".claude/skills/pneuma-slide/SKILL.md",
          action: "modify",
          description: "Add image quality hierarchy guidance",
          evidence: [{
            sessionFile: "session-1.jsonl",
            quote: "Use AI-generated raster images, not SVG",
            reasoning: "User prefers AI raster over SVG for visual fidelity",
          }],
          content: "## User Preferences\n<!-- evolved: 2026-03-06 -->\n\n- AI-generated raster preferred over SVG\n- Consider audience and medium when choosing themes\n",
          insertAt: "append",
        },
      ],
    };
  }

  it("full flow: install → apply → verify CLAUDE.md has evolved section → rollback → verify restored", () => {
    const ws = setupEvolutionWorkspace();

    // Capture original CLAUDE.md
    const originalClaudeMd = readFileSync(join(ws, "CLAUDE.md"), "utf-8");
    expect(originalClaudeMd).toContain("<!-- pneuma:start -->");
    expect(originalClaudeMd).toContain("<!-- pneuma:end -->");
    // pneuma:start now has a slim scene + pointer line that names the skill.
    expect(originalClaudeMd).toContain("`pneuma-slide` skill");
    expect(originalClaudeMd).not.toContain("<!-- pneuma:evolved:start -->");

    // Save and apply proposal
    const proposal = makeEvoProposal(ws);
    saveProposal(ws, proposal);
    const applyResult = applyProposal(ws, proposal.id);
    expect(applyResult.success).toBe(true);

    // Verify CLAUDE.md now has evolved section
    const appliedClaudeMd = readFileSync(join(ws, "CLAUDE.md"), "utf-8");
    expect(appliedClaudeMd).toContain("<!-- pneuma:evolved:start -->");
    expect(appliedClaudeMd).toContain("### Learned Preferences");
    expect(appliedClaudeMd).toContain("Add image quality hierarchy guidance");
    expect(appliedClaudeMd).toContain("<!-- pneuma:evolved:end -->");

    // Evolved section should be between pneuma:start and pneuma:end
    const evolvedStart = appliedClaudeMd.indexOf("<!-- pneuma:evolved:start -->");
    const pneumaStart = appliedClaudeMd.indexOf("<!-- pneuma:start -->");
    const pneumaEnd = appliedClaudeMd.indexOf("<!-- pneuma:end -->");
    expect(evolvedStart).toBeGreaterThan(pneumaStart);
    expect(evolvedStart).toBeLessThan(pneumaEnd);

    // The skill pointer should still be there
    expect(appliedClaudeMd).toContain("`pneuma-slide` skill");

    // Verify SKILL.md was also modified (the actual proposal changes)
    const skillMd = readFileSync(join(ws, ".claude", "skills", "pneuma-slide", "SKILL.md"), "utf-8");
    expect(skillMd).toContain("## User Preferences");
    expect(skillMd).toContain("AI-generated raster preferred over SVG");

    // Rollback
    const rollbackResult = rollbackProposal(ws, proposal.id);
    expect(rollbackResult.success).toBe(true);

    // Verify CLAUDE.md restored to original
    const restoredClaudeMd = readFileSync(join(ws, "CLAUDE.md"), "utf-8");
    expect(restoredClaudeMd).toBe(originalClaudeMd);
    expect(restoredClaudeMd).not.toContain("<!-- pneuma:evolved:start -->");

    // Verify SKILL.md also restored
    const restoredSkillMd = readFileSync(join(ws, ".claude", "skills", "pneuma-slide", "SKILL.md"), "utf-8");
    expect(restoredSkillMd).not.toContain("## User Preferences");
  });
});

// ── 4. Mode-maker seed template ─────────────────────────────────────────────

describe("mode-maker seed template", () => {
  it("seed SKILL.md has YAML frontmatter with TODO placeholders", () => {
    const seedSkill = readFileSync(join(PROJECT_ROOT, "modes", "mode-maker", "seed", "skill", "SKILL.md"), "utf-8");
    expect(seedSkill.startsWith("---\n")).toBe(true);
    expect(seedSkill).toContain("name: pneuma-{{modeName}}");
    expect(seedSkill).toContain("description:");
    expect(seedSkill).toContain("TODO:");
    expect(seedSkill).toContain("## Core Principles");
    expect(seedSkill).toContain("## File Convention");
    expect(seedSkill).toContain("## Workflow");
    expect(seedSkill).toContain("## Context Format");
  });

  it("seed manifest.ts has Skill Reference in claudeMdSection", () => {
    const seedManifest = readFileSync(join(PROJECT_ROOT, "modes", "mode-maker", "seed", "manifest.ts"), "utf-8");
    expect(seedManifest).toContain("### Skill Reference");
    expect(seedManifest).toContain("consult the");
    expect(seedManifest).toContain("pneuma-{{modeName}}");
    expect(seedManifest).toContain("### Core Rules");
  });

  it("mode-maker SKILL.md points to manifest reference for claudeMdSection guidance", () => {
    const mmSkill = readFileSync(join(PROJECT_ROOT, "modes", "mode-maker", "skill", "SKILL.md"), "utf-8");
    // claudeMdSection best practices moved to references/manifest-reference.md
    expect(mmSkill).toContain("references/manifest-reference.md");
    // The reference file should exist and contain the guidance
    const refFile = readFileSync(join(PROJECT_ROOT, "modes", "mode-maker", "skill", "references", "manifest-reference.md"), "utf-8");
    expect(refFile).toContain("claudeMdSection Best Practices");
    expect(refFile).toContain("Skill Reference");
    expect(refFile).toContain("hook");
  });
});

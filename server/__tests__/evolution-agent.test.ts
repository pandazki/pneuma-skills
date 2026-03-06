import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { buildEvolutionPrompt, buildDataSourceSection, DEFAULT_DIRECTIVE } from "../evolution-agent.js";
import type { ModeManifest } from "../../core/types/mode-manifest.js";

const TEST_DIR = join(import.meta.dir, ".tmp-evolution-agent-test");

function makeWorkspace(): string {
  const ws = join(TEST_DIR, `ws-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  mkdirSync(join(ws, ".claude", "skills", "pneuma-slide"), { recursive: true });
  writeFileSync(join(ws, ".claude", "skills", "pneuma-slide", "SKILL.md"), "# Slide Skill\n");
  writeFileSync(join(ws, "CLAUDE.md"), "# Project\n");
  return ws;
}

function makeManifest(overrides?: Partial<ModeManifest>): ModeManifest {
  return {
    name: "slide",
    displayName: "Slide Mode",
    version: "1.0.0",
    skill: {
      installName: "pneuma-slide",
      sourceDir: "skill/",
      claudeMdSection: "",
    },
    viewer: {
      watchPatterns: ["**/*.html"],
      workspace: { type: "all" },
    },
    ...overrides,
  } as ModeManifest;
}

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
});

describe("buildEvolutionPrompt", () => {
  it("includes system context", () => {
    const ws = makeWorkspace();
    const prompt = buildEvolutionPrompt({ workspace: ws, manifest: makeManifest() });
    expect(prompt).toContain("Pneuma Skill Evolution Agent");
    expect(prompt).toContain("Your Mission");
  });

  it("includes default directive when no evolution config", () => {
    const ws = makeWorkspace();
    const prompt = buildEvolutionPrompt({ workspace: ws, manifest: makeManifest() });
    expect(prompt).toContain("Evolution Directive");
    expect(prompt).toContain("Analyze the user's usage patterns");
  });

  it("uses custom directive from manifest", () => {
    const ws = makeWorkspace();
    const manifest = makeManifest({
      evolution: { directive: "Focus on slide design preferences" },
    });
    const prompt = buildEvolutionPrompt({ workspace: ws, manifest });
    expect(prompt).toContain("Focus on slide design preferences");
  });

  it("includes workspace info section", () => {
    const ws = makeWorkspace();
    const prompt = buildEvolutionPrompt({ workspace: ws, manifest: makeManifest() });
    expect(prompt).toContain("Workspace Info");
    expect(prompt).toContain(ws);
    expect(prompt).toContain("pneuma-slide");
    expect(prompt).toContain("Mode: slide");
  });

  it("includes data source section", () => {
    const ws = makeWorkspace();
    const prompt = buildEvolutionPrompt({ workspace: ws, manifest: makeManifest() });
    expect(prompt).toContain("Available Data Sources");
    expect(prompt).toContain("Primary: Workspace Conversation History");
    expect(prompt).toContain("Secondary: Global CC History");
  });

  it("includes current skill section", () => {
    const ws = makeWorkspace();
    const prompt = buildEvolutionPrompt({ workspace: ws, manifest: makeManifest() });
    expect(prompt).toContain("Current Skill Files");
    expect(prompt).toContain(".claude/skills/pneuma-slide");
    expect(prompt).toContain("CLAUDE.md");
  });

  it("includes output instructions with proposals directory", () => {
    const ws = makeWorkspace();
    const prompt = buildEvolutionPrompt({ workspace: ws, manifest: makeManifest() });
    expect(prompt).toContain("Output Instructions");
    expect(prompt).toContain(".pneuma/evolution/proposals");
    expect(prompt).toContain("mkdir -p");
    expect(prompt).toContain("evo-<timestamp>-<random8>");
  });

  it("includes proposal JSON schema", () => {
    const ws = makeWorkspace();
    const prompt = buildEvolutionPrompt({ workspace: ws, manifest: makeManifest() });
    expect(prompt).toContain('"status": "pending"');
    expect(prompt).toContain('"mode": "slide"');
    expect(prompt).toContain('"workspace":');
    expect(prompt).toContain('"changes"');
    expect(prompt).toContain('"evidence"');
  });

  it("includes instructions for insufficient evidence", () => {
    const ws = makeWorkspace();
    const prompt = buildEvolutionPrompt({ workspace: ws, manifest: makeManifest() });
    expect(prompt).toContain("insufficient evidence");
    expect(prompt).toContain('"changes": []');
  });

  it("includes post-proposal summary instructions", () => {
    const ws = makeWorkspace();
    const prompt = buildEvolutionPrompt({ workspace: ws, manifest: makeManifest() });
    expect(prompt).toContain("Evolution Dashboard");
  });

  it("tells agent to write files, not just output JSON", () => {
    const ws = makeWorkspace();
    const prompt = buildEvolutionPrompt({ workspace: ws, manifest: makeManifest() });
    expect(prompt).toContain("write a proposal JSON file to disk");
    // Should NOT contain the old "output a JSON proposal" language
    expect(prompt).not.toContain("output a JSON proposal inside a ```json code fence");
  });
});

describe("buildDataSourceSection", () => {
  it("handles missing CC history gracefully", () => {
    const ws = makeWorkspace();
    const manifest = makeManifest();
    const section = buildDataSourceSection(ws, manifest);
    expect(section).toContain("No history found");
    expect(section).toContain("primary source is empty");
  });
});

describe("DEFAULT_DIRECTIVE", () => {
  it("covers key analysis areas", () => {
    expect(DEFAULT_DIRECTIVE).toContain("corrects");
    expect(DEFAULT_DIRECTIVE).toContain("preference");
    expect(DEFAULT_DIRECTIVE).toContain("patterns");
  });
});

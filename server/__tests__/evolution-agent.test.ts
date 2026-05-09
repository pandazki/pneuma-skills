import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  buildEvolutionPrompt,
  buildEvolutionMetadata,
  buildDataSourceSection,
  DEFAULT_DIRECTIVE,
} from "../evolution-agent.js";
import type { ModeManifest } from "../../core/types/mode-manifest.js";

const TEST_DIR = join(import.meta.dir, ".tmp-evolution-agent-test");

function makeWorkspace(skillsRel: string = ".claude/skills"): string {
  const ws = join(TEST_DIR, `ws-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  const skillSegments = skillsRel.split("/");
  mkdirSync(join(ws, ...skillSegments, "pneuma-slide"), { recursive: true });
  writeFileSync(join(ws, ...skillSegments, "pneuma-slide", "SKILL.md"), "# Slide Skill\n");
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
  it("includes system context", async () => {
    const ws = makeWorkspace();
    const prompt = await buildEvolutionPrompt({ workspace: ws, manifest: makeManifest() });
    expect(prompt).toContain("Pneuma Skill Evolution Agent");
    expect(prompt).toContain("Your Mission");
  });

  it("includes default directive when no evolution config", async () => {
    const ws = makeWorkspace();
    const prompt = await buildEvolutionPrompt({ workspace: ws, manifest: makeManifest() });
    expect(prompt).toContain("Evolution Directive");
    expect(prompt).toContain("Analyze the user's usage patterns");
  });

  it("uses custom directive from manifest", async () => {
    const ws = makeWorkspace();
    const manifest = makeManifest({
      evolution: { directive: "Focus on slide design preferences" },
    });
    const prompt = await buildEvolutionPrompt({ workspace: ws, manifest });
    expect(prompt).toContain("Focus on slide design preferences");
  });

  it("includes workspace info section", async () => {
    const ws = makeWorkspace();
    const prompt = await buildEvolutionPrompt({ workspace: ws, manifest: makeManifest() });
    expect(prompt).toContain("Workspace Info");
    expect(prompt).toContain(ws);
    expect(prompt).toContain("pneuma-slide");
    expect(prompt).toContain("Mode: slide");
  });

  it("includes data source section", async () => {
    const ws = makeWorkspace();
    const prompt = await buildEvolutionPrompt({ workspace: ws, manifest: makeManifest() });
    expect(prompt).toContain("Available Data Sources");
    expect(prompt).toContain("Primary: Workspace Conversation History");
    expect(prompt).toContain("Secondary: Global CC History");
  });

  it("includes target skill section with embedded content", async () => {
    const ws = makeWorkspace();
    const prompt = await buildEvolutionPrompt({ workspace: ws, manifest: makeManifest() });
    expect(prompt).toContain("Target Skill — What You Are Evolving");
    expect(prompt).toContain(".claude/skills/pneuma-slide");
    // Embedded SKILL.md content
    expect(prompt).toContain("# Slide Skill");
    expect(prompt).toContain("Current SKILL.md Content");
  });

  it("includes output instructions with proposals directory", async () => {
    const ws = makeWorkspace();
    const prompt = await buildEvolutionPrompt({ workspace: ws, manifest: makeManifest() });
    expect(prompt).toContain("Output Instructions");
    expect(prompt).toContain(".pneuma/evolution/proposals");
    expect(prompt).toContain("mkdir -p");
    expect(prompt).toContain("evo-<timestamp>-<random8>");
  });

  it("includes proposal JSON schema", async () => {
    const ws = makeWorkspace();
    const prompt = await buildEvolutionPrompt({ workspace: ws, manifest: makeManifest() });
    expect(prompt).toContain('"status": "pending"');
    expect(prompt).toContain('"mode": "slide"');
    expect(prompt).toContain('"workspace":');
    expect(prompt).toContain('"changes"');
    expect(prompt).toContain('"evidence"');
  });

  it("includes instructions for insufficient evidence", async () => {
    const ws = makeWorkspace();
    const prompt = await buildEvolutionPrompt({ workspace: ws, manifest: makeManifest() });
    expect(prompt).toContain("insufficient evidence");
    expect(prompt).toContain('"changes": []');
  });

  it("includes post-proposal summary instructions", async () => {
    const ws = makeWorkspace();
    const prompt = await buildEvolutionPrompt({ workspace: ws, manifest: makeManifest() });
    expect(prompt).toContain("Evolution Dashboard");
  });

  it("tells agent to write files, not just output JSON", async () => {
    const ws = makeWorkspace();
    const prompt = await buildEvolutionPrompt({ workspace: ws, manifest: makeManifest() });
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

// ── Backend routing (Task 14) ───────────────────────────────────────────────
// Evolve supports claude-code + codex; the prompt + metadata must point at
// the active backend's installed skills directory (.claude/skills/ vs
// .agents/skills/) so proposal `file` paths resolve correctly when the
// apply route joins them to `workspace`.

describe("buildEvolutionPrompt — backend-routed paths", () => {
  it("claude-code: prompt references .claude/skills/<installName>", async () => {
    const ws = makeWorkspace(".claude/skills");
    const prompt = await buildEvolutionPrompt({
      workspace: ws,
      manifest: makeManifest(),
      backendType: "claude-code",
    });
    expect(prompt).toContain(".claude/skills/pneuma-slide/SKILL.md");
    // Scripts and skills root in the prose should also be claude-code shaped
    expect(prompt).toContain(".claude/skills/pneuma-evolve/scripts");
    // SYSTEM_CONTEXT prose mentions instructions file too
    expect(prompt).toContain("CLAUDE.md");
    // No codex paths leak in
    expect(prompt).not.toContain(".agents/skills/");
    expect(prompt).not.toContain("AGENTS.md");
  });

  it("codex: prompt references .agents/skills/<installName>", async () => {
    const ws = makeWorkspace(".agents/skills");
    const prompt = await buildEvolutionPrompt({
      workspace: ws,
      manifest: makeManifest(),
      backendType: "codex",
    });
    expect(prompt).toContain(".agents/skills/pneuma-slide/SKILL.md");
    expect(prompt).toContain(".agents/skills/pneuma-evolve/scripts");
    expect(prompt).toContain("AGENTS.md");
    // No claude-code paths leak in
    expect(prompt).not.toContain(".claude/skills/");
    expect(prompt).not.toContain("CLAUDE.md");
  });

  it("undefined backend falls back to claude-code conventions (legacy)", async () => {
    const ws = makeWorkspace(".claude/skills");
    const prompt = await buildEvolutionPrompt({
      workspace: ws,
      manifest: makeManifest(),
    });
    expect(prompt).toContain(".claude/skills/pneuma-slide/SKILL.md");
  });
});

describe("buildEvolutionMetadata — backend-routed skillDir", () => {
  it("claude-code: skillDir resolves under .claude/skills/", () => {
    const ws = makeWorkspace(".claude/skills");
    const meta = buildEvolutionMetadata({
      workspace: ws,
      manifest: makeManifest(),
      backendType: "claude-code",
    });
    expect(meta.skillDir).toBe(join(ws, ".claude", "skills", "pneuma-slide"));
  });

  it("codex: skillDir resolves under .agents/skills/", () => {
    const ws = makeWorkspace(".agents/skills");
    const meta = buildEvolutionMetadata({
      workspace: ws,
      manifest: makeManifest(),
      backendType: "codex",
    });
    expect(meta.skillDir).toBe(join(ws, ".agents", "skills", "pneuma-slide"));
  });
});

describe("evolve manifest — supportedBackends gate", () => {
  it("declares claude-code + codex; excludes kimi-cli", async () => {
    const { default: evolveManifest } = await import("../../modes/evolve/manifest.js");
    expect(evolveManifest.supportedBackends).toBeDefined();
    expect(evolveManifest.supportedBackends).toContain("claude-code");
    expect(evolveManifest.supportedBackends).toContain("codex");
    expect(evolveManifest.supportedBackends).not.toContain("kimi-cli");
  });
});

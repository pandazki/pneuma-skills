import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildEvolutionPrompt, collectProjectHistorySources } from "../evolution-agent.js";
import type { ModeManifest } from "../../core/types/mode-manifest.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pneuma-evol-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("collectProjectHistorySources", () => {
  test("returns history paths for each session in the project", async () => {
    await mkdir(join(dir, ".pneuma", "sessions", "s1"), { recursive: true });
    await mkdir(join(dir, ".pneuma", "sessions", "s2"), { recursive: true });
    await writeFile(join(dir, ".pneuma", "sessions", "s1", "history.json"), "[]");
    await writeFile(join(dir, ".pneuma", "sessions", "s2", "history.json"), "[]");

    const paths = await collectProjectHistorySources(dir);
    expect(paths).toHaveLength(2);
    expect(paths.every((p) => p.endsWith("history.json"))).toBe(true);
  });

  test("returns empty when no sessions", async () => {
    expect(await collectProjectHistorySources(dir)).toEqual([]);
  });

  test("skips session dirs without history.json", async () => {
    await mkdir(join(dir, ".pneuma", "sessions", "incomplete"), { recursive: true });
    await mkdir(join(dir, ".pneuma", "sessions", "ok"), { recursive: true });
    await writeFile(join(dir, ".pneuma", "sessions", "ok", "history.json"), "[]");
    const paths = await collectProjectHistorySources(dir);
    expect(paths).toHaveLength(1);
    expect(paths[0]).toContain("/ok/history.json");
  });
});

function makeWorkspace(parent: string): string {
  const ws = join(parent, "ws");
  mkdirSync(join(ws, ".claude", "skills", "pneuma-slide"), { recursive: true });
  writeFileSync(join(ws, ".claude", "skills", "pneuma-slide", "SKILL.md"), "# Slide Skill\n");
  return ws;
}

function makeManifest(): ModeManifest {
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
  } as ModeManifest;
}

describe("buildEvolutionPrompt project scope", () => {
  test("includes Project Scope section when PNEUMA_PROJECT_ROOT is set", async () => {
    const ws = makeWorkspace(dir);
    await mkdir(join(dir, ".pneuma", "sessions", "s1"), { recursive: true });
    await writeFile(join(dir, ".pneuma", "sessions", "s1", "history.json"), "[]");

    const oldEnv = process.env.PNEUMA_PROJECT_ROOT;
    process.env.PNEUMA_PROJECT_ROOT = dir;
    try {
      const prompt = await buildEvolutionPrompt({ workspace: ws, manifest: makeManifest() });
      expect(prompt).toContain("Project Scope");
      expect(prompt).toContain(dir);
      expect(prompt).toContain("history.json");
      expect(prompt).toContain(".pneuma/preferences/profile.md");
      expect(prompt).toContain(".pneuma/preferences/mode-{mode}.md");
    } finally {
      if (oldEnv !== undefined) process.env.PNEUMA_PROJECT_ROOT = oldEnv;
      else delete process.env.PNEUMA_PROJECT_ROOT;
    }
  });

  test("omits Project Scope section when PNEUMA_PROJECT_ROOT is not set", async () => {
    const ws = makeWorkspace(dir);
    const oldEnv = process.env.PNEUMA_PROJECT_ROOT;
    delete process.env.PNEUMA_PROJECT_ROOT;
    try {
      const prompt = await buildEvolutionPrompt({ workspace: ws, manifest: makeManifest() });
      expect(prompt).not.toContain("## Project Scope");
    } finally {
      if (oldEnv !== undefined) process.env.PNEUMA_PROJECT_ROOT = oldEnv;
    }
  });

  test("project section still rendered when no session histories exist yet", async () => {
    const ws = makeWorkspace(dir);
    const oldEnv = process.env.PNEUMA_PROJECT_ROOT;
    process.env.PNEUMA_PROJECT_ROOT = dir;
    try {
      const prompt = await buildEvolutionPrompt({ workspace: ws, manifest: makeManifest() });
      expect(prompt).toContain("Project Scope");
      expect(prompt).toContain("No per-session histories were found yet");
    } finally {
      if (oldEnv !== undefined) process.env.PNEUMA_PROJECT_ROOT = oldEnv;
      else delete process.env.PNEUMA_PROJECT_ROOT;
    }
  });
});

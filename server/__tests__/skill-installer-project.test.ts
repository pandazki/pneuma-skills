/**
 * Skill installer — project session install target tests.
 *
 * Verifies the `sessionDir` parameter on `installSkill()`. When provided,
 * `.claude/skills/<installName>/`, `.agents/skills/<installName>/`, and
 * the primary instructions file (CLAUDE.md / AGENTS.md) target `<sessionDir>/...`
 * instead of `<workspace>/...`. When omitted, behavior is identical to
 * the legacy single-arg form (quick sessions write at workspace root).
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { installSkill, resolvePluginSkillsBase } from "../skill-installer.js";
import type { SkillConfig } from "../../core/types/mode-manifest.js";
import { writeProjectManifest } from "../../core/project-loader.js";

let tmpDir: string;
let workspace: string;
let modeSourceDir: string;

const skillConfig: SkillConfig = {
  sourceDir: "skill",
  installName: "pneuma-test",
  claudeMdSection: "Use the test skill.",
};

beforeEach(() => {
  tmpDir = join(import.meta.dir, `.tmp-proj-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  workspace = join(tmpDir, "workspace");
  modeSourceDir = join(tmpDir, "mode-pkg");

  mkdirSync(join(modeSourceDir, "skill"), { recursive: true });
  writeFileSync(join(modeSourceDir, "skill", "SKILL.md"), "# Test Skill\n");

  mkdirSync(workspace, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("installSkill with sessionDir parameter", () => {
  test("when sessionDir is omitted, installs at workspace (legacy behavior)", () => {
    installSkill({ workspace, skillConfig, modeSourceDir });

    expect(existsSync(join(workspace, ".claude", "skills", "pneuma-test", "SKILL.md"))).toBe(true);
    expect(existsSync(join(workspace, "CLAUDE.md"))).toBe(true);
  });

  test("when sessionDir is provided, installs at sessionDir not workspace (claude-code)", () => {
    const sessionDir = join(workspace, ".pneuma", "sessions", "abc-123");
    mkdirSync(sessionDir, { recursive: true });

    installSkill({
      workspace,
      skillConfig,
      modeSourceDir,
      backendType: "claude-code",
      sessionDir,
    });

    // Skill files land in sessionDir
    expect(existsSync(join(sessionDir, ".claude", "skills", "pneuma-test", "SKILL.md"))).toBe(true);
    // Instructions file lands in sessionDir
    expect(existsSync(join(sessionDir, "CLAUDE.md"))).toBe(true);

    // Workspace root must NOT have any of these install artefacts
    expect(existsSync(join(workspace, ".claude", "skills", "pneuma-test"))).toBe(false);
    expect(existsSync(join(workspace, "CLAUDE.md"))).toBe(false);
  });

  test("when sessionDir is provided with codex backend, .agents/skills + AGENTS.md target sessionDir", () => {
    const sessionDir = join(workspace, ".pneuma", "sessions", "codex-1");
    mkdirSync(sessionDir, { recursive: true });

    installSkill({
      workspace,
      skillConfig,
      modeSourceDir,
      backendType: "codex",
      sessionDir,
    });

    expect(existsSync(join(sessionDir, ".agents", "skills", "pneuma-test", "SKILL.md"))).toBe(true);
    expect(existsSync(join(sessionDir, "AGENTS.md"))).toBe(true);

    // Workspace root must NOT have these
    expect(existsSync(join(workspace, ".agents", "skills", "pneuma-test"))).toBe(false);
    expect(existsSync(join(workspace, "AGENTS.md"))).toBe(false);
  });

  test("user-content paths (.gitignore) still target workspace when sessionDir is provided", () => {
    const sessionDir = join(workspace, ".pneuma", "sessions", "abc-123");
    mkdirSync(sessionDir, { recursive: true });

    installSkill({
      workspace,
      skillConfig,
      modeSourceDir,
      backendType: "claude-code",
      sessionDir,
    });

    // .gitignore is workspace-level project metadata — must remain at workspace root
    expect(existsSync(join(workspace, ".gitignore"))).toBe(true);
  });
});

describe("pneuma:project marker", () => {
  test("project session gets pneuma:project block with project info", async () => {
    const project = join(tmpDir, "proj-info");
    const sessionDir = join(project, ".pneuma", "sessions", "s1");
    mkdirSync(sessionDir, { recursive: true });
    await writeProjectManifest(project, {
      version: 1,
      name: "demo",
      displayName: "Demo Project",
      description: "Demo for tests",
      createdAt: 1,
    });

    installSkill({
      workspace: project,
      sessionDir,
      projectRoot: project,
      sessionId: "s1",
      skillConfig,
      modeSourceDir,
      backendType: "claude-code",
    });

    const claudeMd = await readFile(join(sessionDir, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toContain("<!-- pneuma:project:start -->");
    expect(claudeMd).toContain("<!-- pneuma:project:end -->");
    expect(claudeMd).toContain("Demo Project");
    expect(claudeMd).toContain("Demo for tests");
  });

  test("project session embeds project preferences critical block", async () => {
    const project = join(tmpDir, "proj-prefs");
    const sessionDir = join(project, ".pneuma", "sessions", "s2");
    mkdirSync(sessionDir, { recursive: true });
    await writeProjectManifest(project, {
      version: 1,
      name: "p",
      displayName: "P",
      createdAt: 1,
    });
    mkdirSync(join(project, ".pneuma", "preferences"), { recursive: true });
    writeFileSync(
      join(project, ".pneuma", "preferences", "profile.md"),
      "# Project Prefs\n\n<!-- pneuma-critical:start -->\n- 调性偏暖橙\n<!-- pneuma-critical:end -->\n"
    );

    installSkill({
      workspace: project,
      sessionDir,
      projectRoot: project,
      sessionId: "s2",
      skillConfig,
      modeSourceDir,
      backendType: "claude-code",
    });

    const claudeMd = await readFile(join(sessionDir, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toContain("调性偏暖橙");
  });

  test("quick session does NOT get pneuma:project block", async () => {
    installSkill({ workspace, skillConfig, modeSourceDir, backendType: "claude-code" });

    const claudeMd = await readFile(join(workspace, "CLAUDE.md"), "utf-8");
    expect(claudeMd).not.toContain("<!-- pneuma:project:start -->");
  });

  test("project session lists OTHER sessions but excludes self", async () => {
    const project = join(tmpDir, "proj-siblings");
    const ownSession = "s-self";
    const sessionDir = join(project, ".pneuma", "sessions", ownSession);
    mkdirSync(sessionDir, { recursive: true });

    // Two sibling sessions on disk: one is "self", others are "siblings"
    for (const id of [ownSession, "s-sibling-a", "s-sibling-b"]) {
      const dir = join(project, ".pneuma", "sessions", id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "session.json"),
        JSON.stringify({
          sessionId: id,
          mode: id === ownSession ? "doc" : "webcraft",
          backendType: "claude-code",
          createdAt: 1,
        })
      );
    }
    await writeProjectManifest(project, {
      version: 1,
      name: "p",
      displayName: "P",
      createdAt: 1,
    });

    installSkill({
      workspace: project,
      sessionDir,
      projectRoot: project,
      sessionId: ownSession,
      skillConfig,
      modeSourceDir,
      backendType: "claude-code",
    });

    const claudeMd = await readFile(join(sessionDir, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toContain("**Other sessions in this project**");
    expect(claudeMd).toContain("s-sibling-a");
    expect(claudeMd).toContain("s-sibling-b");
    // The current session must NOT appear in the "Other" list
    // (we look for the specific listing pattern, not just the id which appears in path)
    expect(claudeMd).not.toContain(`\`doc/${ownSession}\``);
  });
});

describe("pneuma:handoff marker", () => {
  test("injects pending handoff for current mode", async () => {
    const project = join(tmpDir, "proj-handoff");
    const sessionDir = join(project, ".pneuma", "sessions", "target-1");
    mkdirSync(sessionDir, { recursive: true });
    await writeProjectManifest(project, { version: 1, name: "p", displayName: "P", createdAt: 1 });
    const handoffsDir = join(project, ".pneuma", "handoffs");
    mkdirSync(handoffsDir, { recursive: true });
    writeFileSync(
      join(handoffsDir, "hf-1.md"),
      `---
handoff_id: hf-1
target_mode: test
target_session: auto
source_session: src-1
source_mode: doc
intent: Build the landing page
created_at: 2026-04-27T00:00:00Z
---

# Handoff body

Important content here.
`
    );

    installSkill({
      workspace: project,
      sessionDir,
      projectRoot: project,
      sessionId: "target-1",
      skillConfig,
      modeSourceDir,
      backendType: "claude-code",
    });

    const claudeMd = await readFile(join(sessionDir, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toContain("<!-- pneuma:handoff:start -->");
    expect(claudeMd).toContain("hf-1.md");
    expect(claudeMd).toContain("Build the landing page");
  });

  test("does NOT inject handoff for a different target_mode", async () => {
    const project = join(tmpDir, "proj-handoff-mismatch");
    const sessionDir = join(project, ".pneuma", "sessions", "t2");
    mkdirSync(sessionDir, { recursive: true });
    await writeProjectManifest(project, { version: 1, name: "p", displayName: "P", createdAt: 1 });
    const handoffsDir = join(project, ".pneuma", "handoffs");
    mkdirSync(handoffsDir, { recursive: true });
    writeFileSync(
      join(handoffsDir, "hf-2.md"),
      `---
handoff_id: hf-2
target_mode: webcraft
source_session: src
source_mode: doc
intent: x
created_at: 2026-04-27T00:00:00Z
---
body
`
    );

    installSkill({
      workspace: project,
      sessionDir,
      projectRoot: project,
      sessionId: "t2",
      skillConfig,
      modeSourceDir,
      backendType: "claude-code",
    });

    const claudeMd = await readFile(join(sessionDir, "CLAUDE.md"), "utf-8");
    expect(claudeMd).not.toContain("hf-2.md");
  });

  test("respects target_session when not 'auto'", async () => {
    const project = join(tmpDir, "proj-handoff-targeted");
    const sessionDir = join(project, ".pneuma", "sessions", "wrong-target");
    mkdirSync(sessionDir, { recursive: true });
    await writeProjectManifest(project, { version: 1, name: "p", displayName: "P", createdAt: 1 });
    const handoffsDir = join(project, ".pneuma", "handoffs");
    mkdirSync(handoffsDir, { recursive: true });
    writeFileSync(
      join(handoffsDir, "hf-3.md"),
      `---
handoff_id: hf-3
target_mode: test
target_session: specific-target
source_session: src
source_mode: doc
intent: x
created_at: 2026-04-27T00:00:00Z
---
body
`
    );

    installSkill({
      workspace: project,
      sessionDir,
      projectRoot: project,
      sessionId: "wrong-target",
      skillConfig,
      modeSourceDir,
      backendType: "claude-code",
    });

    const claudeMd = await readFile(join(sessionDir, "CLAUDE.md"), "utf-8");
    expect(claudeMd).not.toContain("hf-3.md");
  });

  test("matches target_mode even when written with quotes", async () => {
    const project = join(tmpDir, "proj-handoff-quoted");
    const sessionDir = join(project, ".pneuma", "sessions", "tq");
    mkdirSync(sessionDir, { recursive: true });
    await writeProjectManifest(project, { version: 1, name: "p", displayName: "P", createdAt: 1 });
    const handoffsDir = join(project, ".pneuma", "handoffs");
    mkdirSync(handoffsDir, { recursive: true });
    writeFileSync(
      join(handoffsDir, "hf-q.md"),
      `---
handoff_id: hf-q
target_mode: "test"
target_session: 'auto'
source_session: src
source_mode: doc
intent: x
created_at: 2026-04-27T00:00:00Z
---
body
`
    );

    installSkill({
      workspace: project,
      sessionDir,
      projectRoot: project,
      sessionId: "tq",
      skillConfig,
      modeSourceDir,
      backendType: "claude-code",
    });

    const claudeMd = await readFile(join(sessionDir, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toContain("hf-q.md");
  });
});

describe("resolvePluginSkillsBase (Fix 4 — plugin skills land in agent CWD)", () => {
  test("project session: routes to <sessionDir>/.claude/skills/", () => {
    const ws = "/tmp/proj-root";
    const sessionDir = "/tmp/proj-root/.pneuma/sessions/abc";
    expect(resolvePluginSkillsBase(ws, sessionDir, "claude-code")).toBe(
      "/tmp/proj-root/.pneuma/sessions/abc/.claude/skills",
    );
  });

  test("project session with codex backend: routes to <sessionDir>/.agents/skills/", () => {
    const ws = "/tmp/proj-root";
    const sessionDir = "/tmp/proj-root/.pneuma/sessions/abc";
    expect(resolvePluginSkillsBase(ws, sessionDir, "codex")).toBe(
      "/tmp/proj-root/.pneuma/sessions/abc/.agents/skills",
    );
  });

  test("quick session (no sessionDir): routes to <workspace>/.claude/skills/", () => {
    const ws = "/tmp/quick-ws";
    expect(resolvePluginSkillsBase(ws, undefined, "claude-code")).toBe(
      "/tmp/quick-ws/.claude/skills",
    );
  });

  test("quick session: never lands plugin skills under the workspace's project dir", () => {
    // Regression for Codex P2-4: project session's pluginSkillsRoot must NOT
    // collapse to the workspace root, otherwise the agent (whose CWD = the
    // session dir) won't see any of the plugin's `.claude/skills/` entries.
    const ws = "/tmp/proj-root";
    const sessionDir = "/tmp/proj-root/.pneuma/sessions/abc";
    const projectPath = resolvePluginSkillsBase(ws, sessionDir, "claude-code");
    expect(projectPath.startsWith(sessionDir + "/")).toBe(true);
    expect(projectPath).not.toBe(join(ws, ".claude/skills"));
  });
});

describe("pneuma-project shared skill", () => {
  test("installed in project sessions", async () => {
    const project = join(tmpDir, "proj-shared");
    const sessionDir = join(project, ".pneuma", "sessions", "s");
    mkdirSync(sessionDir, { recursive: true });
    await writeProjectManifest(project, { version: 1, name: "p", displayName: "P", createdAt: 1 });

    installSkill({
      workspace: project,
      sessionDir,
      projectRoot: project,
      sessionId: "s",
      skillConfig,
      modeSourceDir,
      backendType: "claude-code",
    });

    expect(existsSync(join(sessionDir, ".claude", "skills", "pneuma-project", "SKILL.md"))).toBe(true);
  });

  test("NOT installed in quick sessions", async () => {
    installSkill({ workspace, skillConfig, modeSourceDir, backendType: "claude-code" });

    expect(existsSync(join(workspace, ".claude", "skills", "pneuma-project"))).toBe(false);
  });

  test("installed under .agents/skills/ for codex backend", async () => {
    const project = join(tmpDir, "proj-shared-codex");
    const sessionDir = join(project, ".pneuma", "sessions", "s");
    mkdirSync(sessionDir, { recursive: true });
    await writeProjectManifest(project, { version: 1, name: "p", displayName: "P", createdAt: 1 });

    installSkill({
      workspace: project,
      sessionDir,
      projectRoot: project,
      sessionId: "s",
      skillConfig,
      modeSourceDir,
      backendType: "codex",
    });

    expect(existsSync(join(sessionDir, ".agents", "skills", "pneuma-project", "SKILL.md"))).toBe(true);
  });
});

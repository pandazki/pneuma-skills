/**
 * Tests for `core/agent-command-installer.ts`. The installer relies on
 * `~/.claude/commands/`, `~/.codex/prompts/`, and `~/.pneuma/agent-commands.json`
 * — all under `homedir()`. We point `HOME` at a tmpdir per-test so the
 * suite leaves the user's actual files untouched.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  install,
  uninstall,
  getStatus,
  getAllStatus,
  readState,
  setPromptDismissed,
  setAutoUpdate,
  runAutoUpdate,
  parseHeader,
  renderTemplate,
  getBackendDescriptor,
  type AgentCommandBackend,
} from "../agent-command-installer.js";

const TEMPLATE = `---
description: test
---

<!-- pneuma:agent-command version="{{pneumaVersion}}" backend="{{backendType}}" -->

Body with {{sourceAgent}} mention.
`;

let tmpHome: string;
let originalHome: string | undefined;

beforeEach(() => {
  originalHome = process.env.HOME;
  tmpHome = mkdtempSync(join(tmpdir(), "pneuma-agent-cmd-"));
  process.env.HOME = tmpHome;
});

afterEach(() => {
  process.env.HOME = originalHome;
  rmSync(tmpHome, { recursive: true, force: true });
});

describe("renderTemplate", () => {
  test("substitutes pneumaVersion and sourceAgent per backend", () => {
    const out = renderTemplate(TEMPLATE, {
      pneumaVersion: "9.9.9",
      backendType: "claude-code",
    });
    expect(out).toContain('version="9.9.9"');
    expect(out).toContain('backend="claude-code"');
    expect(out).toContain("claude-code mention");
  });
});

describe("parseHeader", () => {
  test("matches marker located below frontmatter", () => {
    const rendered = renderTemplate(TEMPLATE, { pneumaVersion: "1.2.3", backendType: "codex" });
    expect(parseHeader(rendered)).toEqual({ version: "1.2.3", backend: "codex" });
  });
  test("returns null for unrelated files", () => {
    expect(parseHeader("# Just markdown\n\nNo marker.\n")).toBeNull();
  });
});

describe("install + getStatus", () => {
  test("fresh install for claude-code writes the file and registry", () => {
    const result = install({
      backend: "claude-code",
      pneumaVersion: "3.9.1",
      template: TEMPLATE,
    });
    expect(result.ok).toBe(true);
    expect(result.reason).toBe("ok");
    const descriptor = getBackendDescriptor("claude-code");
    expect(existsSync(descriptor.file)).toBe(true);
    const content = readFileSync(descriptor.file, "utf-8");
    expect(content).toContain('version="3.9.1"');
    expect(content).toContain('backend="claude-code"');

    const status = getStatus("claude-code", "3.9.1");
    expect(status.installed).toBe(true);
    expect(status.fileVersion).toBe("3.9.1");
    expect(status.upToDate).toBe(true);
    expect(status.registryVersion).toBe("3.9.1");
  });

  test("fresh install for codex writes to ~/.codex/prompts/", () => {
    install({ backend: "codex", pneumaVersion: "3.9.1", template: TEMPLATE });
    const descriptor = getBackendDescriptor("codex");
    expect(descriptor.file).toBe(join(tmpHome, ".codex", "prompts", "handoff-pneuma.md"));
    expect(existsSync(descriptor.file)).toBe(true);
  });

  test("re-install across pneuma versions overwrites and reports previousVersion", () => {
    install({ backend: "claude-code", pneumaVersion: "3.9.0", template: TEMPLATE });
    const result = install({ backend: "claude-code", pneumaVersion: "3.9.1", template: TEMPLATE });
    expect(result.ok).toBe(true);
    expect(result.previousVersion).toBe("3.9.0");
    expect(result.newVersion).toBe("3.9.1");
  });

  test("refuses to clobber a user-authored file without --force", () => {
    const descriptor = getBackendDescriptor("claude-code");
    mkdirSync(descriptor.dir, { recursive: true });
    writeFileSync(descriptor.file, "# User wrote this\n", "utf-8");
    const result = install({
      backend: "claude-code",
      pneumaVersion: "3.9.1",
      template: TEMPLATE,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("conflict");
    // Status should report conflict.
    expect(getStatus("claude-code", "3.9.1").conflict).toBe(true);
  });

  test("--force overwrites a user-authored file", () => {
    const descriptor = getBackendDescriptor("claude-code");
    mkdirSync(descriptor.dir, { recursive: true });
    writeFileSync(descriptor.file, "# User wrote this\n", "utf-8");
    const result = install({
      backend: "claude-code",
      pneumaVersion: "3.9.1",
      template: TEMPLATE,
      force: true,
    });
    expect(result.ok).toBe(true);
    expect(readFileSync(descriptor.file, "utf-8")).toContain('version="3.9.1"');
  });
});

describe("uninstall", () => {
  test("removes file + registry record", () => {
    install({ backend: "codex", pneumaVersion: "3.9.1", template: TEMPLATE });
    const result = uninstall("codex");
    expect(result.ok).toBe(true);
    expect(result.removedVersion).toBe("3.9.1");
    expect(existsSync(getBackendDescriptor("codex").file)).toBe(false);
    expect(readState().installed.codex).toBeUndefined();
  });

  test("missing file is a soft no-op", () => {
    const result = uninstall("claude-code");
    expect(result.ok).toBe(true);
    expect(result.reason).toBe("missing");
  });

  test("refuses to delete a conflicting (un-marked) file without --force", () => {
    const descriptor = getBackendDescriptor("claude-code");
    mkdirSync(descriptor.dir, { recursive: true });
    writeFileSync(descriptor.file, "# User wrote this\n", "utf-8");
    const result = uninstall("claude-code");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("conflict");
    expect(existsSync(descriptor.file)).toBe(true);
  });
});

describe("registry flags", () => {
  test("setPromptDismissed persists", () => {
    expect(readState().promptDismissed).toBe(false);
    setPromptDismissed(true);
    expect(readState().promptDismissed).toBe(true);
  });
  test("setAutoUpdate persists; defaults to true on fresh state", () => {
    expect(readState().autoUpdate).toBe(true);
    setAutoUpdate(false);
    expect(readState().autoUpdate).toBe(false);
  });
});

describe("runAutoUpdate", () => {
  test("re-stamps only outdated installed entries; skips missing + up-to-date + conflict", () => {
    // claude-code: outdated → should update
    install({ backend: "claude-code", pneumaVersion: "3.9.0", template: TEMPLATE });
    // codex: up-to-date → should skip
    install({ backend: "codex", pneumaVersion: "3.9.1", template: TEMPLATE });

    const result = runAutoUpdate("3.9.1", TEMPLATE);
    expect(result.updated).toEqual(["claude-code"]);
    expect(result.skipped.find((s) => s.backend === "codex")?.reason).toBe("up-to-date");

    expect(getStatus("claude-code", "3.9.1").fileVersion).toBe("3.9.1");
  });

  test("respects autoUpdate=false (no-op)", () => {
    install({ backend: "claude-code", pneumaVersion: "3.9.0", template: TEMPLATE });
    setAutoUpdate(false);
    const result = runAutoUpdate("3.9.1", TEMPLATE);
    expect(result.updated).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(getStatus("claude-code", "3.9.1").fileVersion).toBe("3.9.0");
  });
});

describe("getAllStatus", () => {
  test("returns one entry per supported backend", () => {
    const all = getAllStatus("3.9.1");
    expect(all.map((s) => s.backend).sort()).toEqual(["claude-code", "codex"]);
    for (const s of all) {
      expect(s.installed).toBe(false);
      expect(s.upToDate).toBeUndefined();
    }
  });
});

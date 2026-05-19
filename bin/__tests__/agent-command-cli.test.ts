/**
 * Tests for `bin/agent-command-cli.ts` — the `pneuma agent-command` CLI.
 * Filesystem effects are confined to a tmp HOME and the bundled template
 * is swapped via the `loadTemplate` deps hook to keep tests fast +
 * deterministic.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  parseAgentCommandArgs,
  runAgentCommandCli,
} from "../agent-command-cli.js";

const TEMPLATE = `---
description: stub
---

<!-- pneuma:agent-command version="{{pneumaVersion}}" backend="{{backendType}}" -->

stub body
`;

interface CapturedIo {
  stdout: string[];
  stderr: string[];
}
function makeIo(): CapturedIo & { io: { stdout: (l: string) => void; stderr: (l: string) => void } } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, io: { stdout: (l) => stdout.push(l), stderr: (l) => stderr.push(l) } };
}

let originalHome: string | undefined;
let tmpHome: string;

beforeEach(() => {
  originalHome = process.env.HOME;
  tmpHome = mkdtempSync(join(tmpdir(), "pneuma-agent-cli-"));
  process.env.HOME = tmpHome;
});

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
  process.env.HOME = originalHome;
});

describe("parseAgentCommandArgs", () => {
  test("status with --backend all (default) + --json", () => {
    const out = parseAgentCommandArgs(["status", "--json"]);
    expect(out.sub).toBe("status");
    expect(out.backend).toBe("all");
    expect(out.json).toBe(true);
  });
  test("install --backend codex --force", () => {
    const out = parseAgentCommandArgs(["install", "--backend", "codex", "--force"]);
    expect(out.sub).toBe("install");
    expect(out.backend).toBe("codex");
    expect(out.force).toBe(true);
  });
  test("unknown subcommand falls back to help", () => {
    const out = parseAgentCommandArgs(["wat"]);
    expect(out.sub).toBe("help");
  });
});

describe("runAgentCommandCli", () => {
  test("status --json emits an array with both backends, not installed", async () => {
    const cap = makeIo();
    const code = await runAgentCommandCli(
      ["status", "--json"],
      { pneumaVersion: "9.9.9", loadTemplate: () => TEMPLATE },
      cap.io,
    );
    expect(code).toBe(0);
    const rows = JSON.parse(cap.stdout.join("\n"));
    expect(rows.map((r: { backend: string }) => r.backend).sort()).toEqual(["claude-code", "codex"]);
    expect(rows.every((r: { installed: boolean }) => r.installed === false)).toBe(true);
  });

  test("install --backend claude-code lands the file", async () => {
    const cap = makeIo();
    const code = await runAgentCommandCli(
      ["install", "--backend", "claude-code"],
      { pneumaVersion: "9.9.9", loadTemplate: () => TEMPLATE },
      cap.io,
    );
    expect(code).toBe(0);
    const path = join(tmpHome, ".claude", "commands", "handoff-pneuma.md");
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf-8")).toContain('version="9.9.9"');
  });

  test("install when blocked by conflict surfaces an error", async () => {
    // Plant a user file in the install location.
    const { mkdirSync, writeFileSync } = require("node:fs") as typeof import("node:fs");
    const dir = join(tmpHome, ".claude", "commands");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "handoff-pneuma.md"), "# user file\n", "utf-8");

    const cap = makeIo();
    const code = await runAgentCommandCli(
      ["install", "--backend", "claude-code"],
      { pneumaVersion: "9.9.9", loadTemplate: () => TEMPLATE },
      cap.io,
    );
    expect(code).toBe(1);
    expect(cap.stderr.join("\n")).toContain("conflict");
  });

  test("update on missing backend is a no-op (skip), not a failure", async () => {
    const cap = makeIo();
    const code = await runAgentCommandCli(
      ["update", "--backend", "codex", "--json"],
      { pneumaVersion: "9.9.9", loadTemplate: () => TEMPLATE },
      cap.io,
    );
    expect(code).toBe(0);
    const rows = JSON.parse(cap.stdout.join("\n"));
    expect(rows[0].skipped).toBe(true);
    expect(rows[0].reason).toBe("skipped-not-installed");
  });

  test("uninstall when nothing is installed reports 'missing'", async () => {
    const cap = makeIo();
    const code = await runAgentCommandCli(
      ["uninstall", "--backend", "all", "--json"],
      { pneumaVersion: "9.9.9", loadTemplate: () => TEMPLATE },
      cap.io,
    );
    expect(code).toBe(0);
    const rows = JSON.parse(cap.stdout.join("\n"));
    expect(rows.every((r: { ok: boolean; reason: string }) => r.ok && r.reason === "missing")).toBe(true);
  });
});

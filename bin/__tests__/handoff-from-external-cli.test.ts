/**
 * Tests for `bin/handoff-from-external-cli.ts`. The handler is pure (no
 * spawn) when `--dry-run` is set, so we exercise every code path that way.
 * The actual spawn is stubbed via the deps injection point so we can also
 * confirm the assembled argv without side effects.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import { tmpdir } from "node:os";

import {
  parseHandoffFromExternalArgs,
  runHandoffFromExternal,
} from "../handoff-from-external-cli.js";

const PROJECT_ROOT = resolvePath(import.meta.dir, "..", "..");

interface CapturedIo {
  stdout: string[];
  stderr: string[];
}

function makeIo(): CapturedIo & { io: { stdout: (l: string) => void; stderr: (l: string) => void } } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: { stdout: (l) => stdout.push(l), stderr: (l) => stderr.push(l) },
  };
}

let tmpCwd: string;
let originalHome: string | undefined;

beforeEach(() => {
  originalHome = process.env.HOME;
  tmpCwd = mkdtempSync(join(tmpdir(), "pneuma-h-ext-"));
  // tests touch ~/.pneuma/libraries during local-mode enumeration; isolate
  process.env.HOME = mkdtempSync(join(tmpdir(), "pneuma-home-"));
});

afterEach(() => {
  rmSync(tmpCwd, { recursive: true, force: true });
  if (process.env.HOME) rmSync(process.env.HOME, { recursive: true, force: true });
  process.env.HOME = originalHome;
});

describe("parseHandoffFromExternalArgs", () => {
  test("extracts core flags", () => {
    const out = parseHandoffFromExternalArgs([
      "--intent", "build a thing",
      "--mode", "webcraft",
      "--cwd", "/foo",
      "--source-agent", "claude-code",
      "--init-project",
      "--json",
    ]);
    expect(out.intent).toBe("build a thing");
    expect(out.mode).toBe("webcraft");
    expect(out.cwd).toBe("/foo");
    expect(out.sourceAgent).toBe("claude-code");
    expect(out.initProject).toBe(true);
    expect(out.json).toBe(true);
  });
  test("--quick maps to initProject=false", () => {
    const out = parseHandoffFromExternalArgs(["--quick"]);
    expect(out.initProject).toBe(false);
  });
  test("--help short-circuits", () => {
    expect(parseHandoffFromExternalArgs(["-h"]).help).toBe(true);
    expect(parseHandoffFromExternalArgs(["--help"]).help).toBe(true);
  });
});

describe("runHandoffFromExternal — validation", () => {
  test("missing --intent returns 2", async () => {
    const cap = makeIo();
    const code = await runHandoffFromExternal(
      ["--mode", "webcraft", "--cwd", tmpCwd, "--dry-run"],
      { projectRoot: PROJECT_ROOT },
      cap.io,
    );
    expect(code).toBe(2);
    expect(cap.stderr.join("\n")).toContain("Missing --intent");
  });

  test("missing --mode returns 2", async () => {
    const cap = makeIo();
    const code = await runHandoffFromExternal(
      ["--intent", "x", "--cwd", tmpCwd, "--dry-run"],
      { projectRoot: PROJECT_ROOT },
      cap.io,
    );
    expect(code).toBe(2);
    expect(cap.stderr.join("\n")).toContain("Missing --mode");
  });

  test("unknown mode returns 2 with helpful message", async () => {
    const cap = makeIo();
    const code = await runHandoffFromExternal(
      ["--intent", "x", "--mode", "nonexistent", "--cwd", tmpCwd, "--dry-run"],
      { projectRoot: PROJECT_ROOT },
      cap.io,
    );
    expect(code).toBe(2);
    expect(cap.stderr.join("\n")).toContain("Unknown mode: nonexistent");
  });

  test("nonexistent --cwd returns 2", async () => {
    const cap = makeIo();
    const code = await runHandoffFromExternal(
      ["--intent", "x", "--mode", "webcraft", "--cwd", "/definitely/does/not/exist/12345", "--dry-run"],
      { projectRoot: PROJECT_ROOT },
      cap.io,
    );
    expect(code).toBe(2);
    expect(cap.stderr.join("\n")).toContain("--cwd does not exist");
  });
});

describe("runHandoffFromExternal — dry-run staging", () => {
  test("project mode (default): writes project.json + inbound-handoff.json", async () => {
    const cap = makeIo();
    const code = await runHandoffFromExternal(
      [
        "--intent", "build a balance sheet view",
        "--mode", "webcraft",
        "--cwd", tmpCwd,
        "--source-agent", "claude-code",
        "--dry-run", "--json",
      ],
      { projectRoot: PROJECT_ROOT },
      cap.io,
    );
    expect(code).toBe(0);

    // project.json should exist now.
    const projectJson = join(tmpCwd, ".pneuma", "project.json");
    expect(existsSync(projectJson)).toBe(true);
    const manifest = JSON.parse(readFileSync(projectJson, "utf-8"));
    expect(manifest.version).toBe(1);

    // inbound-handoff.json under the new session dir.
    const result = JSON.parse(cap.stdout.join("\n"));
    expect(result.ok).toBe(true);
    expect(result.project).toBe(true);
    expect(existsSync(result.inboundFile)).toBe(true);
    const inbound = JSON.parse(readFileSync(result.inboundFile, "utf-8"));
    expect(inbound.intent).toBe("build a balance sheet view");
    expect(inbound.target_mode).toBe("webcraft");
    expect(inbound.source_session_id).toBe("external:claude-code");
    expect(inbound.target_session).toBe(result.sessionId);
  });

  test("--quick: no project.json, inbound at <workspace>/.pneuma/ (single nest)", async () => {
    const cap = makeIo();
    const code = await runHandoffFromExternal(
      [
        "--intent", "x", "--mode", "webcraft",
        "--cwd", tmpCwd, "--quick", "--dry-run", "--json",
      ],
      { projectRoot: PROJECT_ROOT },
      cap.io,
    );
    expect(code).toBe(0);
    expect(existsSync(join(tmpCwd, ".pneuma", "project.json"))).toBe(false);
    const result = JSON.parse(cap.stdout.join("\n"));
    expect(result.project).toBe(false);
    // Single nest — must match what readInboundHandoff(<sessionDir>) expects
    // for Quick mode, which is `<workspace>/.pneuma/inbound-handoff.json`
    // (Quick's sessionDir == workspace, see `resolveSessionPaths`).
    expect(result.inboundFile).toBe(join(tmpCwd, ".pneuma", "inbound-handoff.json"));
  });

  test("inbound path round-trips through readInboundHandoff for both kinds (regression for 3.10.8 double-nest bug)", async () => {
    const { readInboundHandoff } = await import("../../server/skill-installer.js");

    // --- Quick ---
    const quickCwd = mkdtempSync(join(tmpdir(), "pneuma-quick-rt-"));
    try {
      const cap = makeIo();
      const code = await runHandoffFromExternal(
        ["--intent", "ping", "--mode", "webcraft", "--cwd", quickCwd, "--quick", "--dry-run", "--json"],
        { projectRoot: PROJECT_ROOT },
        cap.io,
      );
      expect(code).toBe(0);
      // For Quick: `sessionDir == workspace` (see `bin/pneuma.ts` line 1944
      // `const sessionDir = startup.paths.sessionDir;` + comment at 1959).
      // readInboundHandoff(sessionDir) → reads `<workspace>/.pneuma/inbound-handoff.json`.
      const inbound = readInboundHandoff(quickCwd);
      expect(inbound).not.toBeNull();
      expect(inbound?.intent).toBe("ping");
    } finally {
      rmSync(quickCwd, { recursive: true, force: true });
    }

    // --- Project ---
    const projCwd = mkdtempSync(join(tmpdir(), "pneuma-proj-rt-"));
    try {
      const cap = makeIo();
      const code = await runHandoffFromExternal(
        ["--intent", "pong", "--mode", "webcraft", "--cwd", projCwd, "--init-project", "--dry-run", "--json"],
        { projectRoot: PROJECT_ROOT },
        cap.io,
      );
      expect(code).toBe(0);
      const result = JSON.parse(cap.stdout.join("\n"));
      const sessionDir = join(projCwd, ".pneuma", "sessions", result.sessionId);
      const inbound = readInboundHandoff(sessionDir);
      expect(inbound).not.toBeNull();
      expect(inbound?.intent).toBe("pong");
    } finally {
      rmSync(projCwd, { recursive: true, force: true });
    }
  });

  test("re-init on an existing project does not clobber existing manifest", async () => {
    // Run once to seed
    await runHandoffFromExternal(
      ["--intent", "first", "--mode", "webcraft", "--cwd", tmpCwd, "--dry-run", "--json"],
      { projectRoot: PROJECT_ROOT },
      makeIo().io,
    );
    const firstManifest = JSON.parse(readFileSync(join(tmpCwd, ".pneuma", "project.json"), "utf-8"));
    // Slight delay so timestamps would differ if overwritten
    await new Promise((r) => setTimeout(r, 5));
    await runHandoffFromExternal(
      ["--intent", "second", "--mode", "doc", "--cwd", tmpCwd, "--dry-run", "--json"],
      { projectRoot: PROJECT_ROOT },
      makeIo().io,
    );
    const secondManifest = JSON.parse(readFileSync(join(tmpCwd, ".pneuma", "project.json"), "utf-8"));
    expect(secondManifest.createdAt).toBe(firstManifest.createdAt);
  });
});

import { describe, expect, test } from "bun:test";
import {
  normalizePersistedSession,
  normalizeSessionRecord,
  parseCliArgs,
  resolveWorkspaceBackendType,
} from "../pneuma-cli-helpers.js";

describe("pneuma CLI helpers", () => {
  test("parseCliArgs uses the default backend when none is provided", () => {
    const parsed = parseCliArgs(["bun", "bin/pneuma.ts", "doc"], "/tmp/workspace");

    expect(parsed.mode).toBe("doc");
    expect(parsed.workspace).toBe("/tmp/workspace");
    expect(parsed.backendType).toBe("claude-code");
  });

  test("parseCliArgs parses --backend and launch flags", () => {
    const parsed = parseCliArgs(
      [
        "bun",
        "bin/pneuma.ts",
        "slide",
        "--workspace",
        "./demo",
        "--port",
        "19001",
        "--backend",
        "codex",
        "--no-open",
        "--no-prompt",
        "--skip-skill",
        "--debug",
        "--dev",
      ],
      "/tmp/base",
    );

    expect(parsed.mode).toBe("slide");
    expect(parsed.workspace).toBe("/tmp/base/demo");
    expect(parsed.port).toBe(19001);
    expect(parsed.backendType).toBe("codex");
    expect(parsed.noOpen).toBe(true);
    expect(parsed.noPrompt).toBe(true);
    expect(parsed.skipSkill).toBe(true);
    expect(parsed.debug).toBe(true);
    expect(parsed.forceDev).toBe(true);
  });

  test("parseCliArgs recognizes top-level help and version flags", () => {
    const helpParsed = parseCliArgs(["bun", "bin/pneuma.ts", "--help"], "/tmp/workspace");
    const versionParsed = parseCliArgs(["bun", "bin/pneuma.ts", "--version"], "/tmp/workspace");

    expect(helpParsed.showHelp).toBe(true);
    expect(helpParsed.showVersion).toBe(false);
    expect(helpParsed.mode).toBe("");

    expect(versionParsed.showVersion).toBe(true);
    expect(versionParsed.showHelp).toBe(false);
    expect(versionParsed.mode).toBe("");
  });

  test("normalizePersistedSession migrates cliSessionId and backfills backendType", () => {
    const session = normalizePersistedSession({
      sessionId: "browser-1",
      cliSessionId: "agent-legacy",
      mode: "doc",
      createdAt: 123,
    });

    expect(session.agentSessionId).toBe("agent-legacy");
    expect("cliSessionId" in session).toBe(false);
    expect(session.backendType).toBe("claude-code");
  });

  test("normalizeSessionRecord backfills backendType for legacy launcher records", () => {
    const record = normalizeSessionRecord({
      id: "/tmp/demo::doc",
      mode: "doc",
      displayName: "Doc",
      workspace: "/tmp/demo",
      lastAccessed: 1,
    });

    expect(record.backendType).toBe("claude-code");
  });

  test("resolveWorkspaceBackendType keeps the workspace-bound backend", () => {
    const resolved = resolveWorkspaceBackendType("claude-code", {
      backendType: "claude-code",
    });

    expect(resolved.backendType).toBe("claude-code");
    expect(resolved.mismatchMessage).toBeUndefined();
  });

  test("resolveWorkspaceBackendType rejects switching an existing workspace backend", () => {
    const resolved = resolveWorkspaceBackendType("codex", {
      backendType: "claude-code",
    });

    expect(resolved.backendType).toBe("claude-code");
    expect(resolved.mismatchMessage).toContain('Workspace is already bound to backend "claude-code".');
    expect(resolved.mismatchMessage).toContain("Launch with --backend claude-code");
  });

  test("resolveWorkspaceBackendType uses the requested backend for a new workspace", () => {
    const resolved = resolveWorkspaceBackendType("codex", null);

    expect(resolved).toEqual({ backendType: "codex" });
  });
});

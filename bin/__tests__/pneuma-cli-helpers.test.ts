import { describe, expect, test } from "bun:test";
import {
  normalizePersistedSession,
  normalizeSessionRecord,
  parseCliArgs,
  preserveRefinedSessionMeta,
  resolveWorkspaceBackendType,
  type PersistedSession,
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

  test("parseCliArgs parses --borrow into borrowId (the borrow target's provenance)", () => {
    const parsed = parseCliArgs(
      ["bun", "bin/pneuma.ts", "wordtaste", "--project", "/tmp/proj", "--session-id", "brw-1", "--borrow", "brw-1"],
      "/tmp/base",
    );
    expect(parsed.mode).toBe("wordtaste");
    expect(parsed.borrowId).toBe("brw-1");
  });

  test("parseCliArgs leaves borrowId empty for a normal (non-borrow) launch", () => {
    const parsed = parseCliArgs(["bun", "bin/pneuma.ts", "doc"], "/tmp/base");
    expect(parsed.borrowId).toBe("");
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

describe("preserveRefinedSessionMeta (refined title/summary survive a minimal save)", () => {
  const minimal = (): PersistedSession => ({
    sessionId: "s1",
    mode: "webcraft",
    backendType: "claude-code",
    createdAt: 100,
  });

  test("carries displayName / description / refinedAt from the prior session.json", () => {
    const out = preserveRefinedSessionMeta(minimal(), {
      displayName: "驱动数据协同进化",
      description: "整理材料成文档并重做一份汇报页",
      refinedAt: 1234,
    });
    expect(out.displayName).toBe("驱动数据协同进化");
    expect(out.description).toBe("整理材料成文档并重做一份汇报页");
    expect(out.refinedAt).toBe(1234);
    // The minimal fields are still written through.
    expect(out.sessionId).toBe("s1");
    expect(out.mode).toBe("webcraft");
  });

  test("no prior file → returns the incoming record untouched (fresh session)", () => {
    const incoming = minimal();
    expect(preserveRefinedSessionMeta(incoming, undefined)).toBe(incoming);
  });

  test("incoming explicit fields win over the prior file", () => {
    const out = preserveRefinedSessionMeta(
      { ...minimal(), displayName: "New title" },
      { displayName: "Old title", refinedAt: 1 },
    );
    expect(out.displayName).toBe("New title");
    // Absent incoming fields still fall back to prev.
    expect(out.refinedAt).toBe(1);
  });

  test("a prior file without refined meta adds nothing", () => {
    const out = preserveRefinedSessionMeta(minimal(), {
      sessionId: "s1",
      mode: "webcraft",
      backendType: "claude-code",
      createdAt: 100,
    });
    expect(out.displayName).toBeUndefined();
    expect(out.description).toBeUndefined();
    expect(out.refinedAt).toBeUndefined();
  });

  test("carries borrow provenance + internal flag from the prior session.json", () => {
    // A borrow sub-session is stamped { internal: true, borrow: {...} } at its
    // first save. On every later resume/launch the minimal record omits those,
    // so a naive overwrite would un-mark B and leak it back into user-facing
    // session lists (scanProjectSessions keys on exactly these fields). They
    // must survive the same way the refined trio does.
    const out = preserveRefinedSessionMeta(minimal(), {
      internal: true,
      borrow: { borrowId: "brw-1", hostSessionId: "A", role: "borrow-target" },
    });
    expect(out.internal).toBe(true);
    expect(out.borrow).toEqual({ borrowId: "brw-1", hostSessionId: "A", role: "borrow-target" });
    // The minimal fields are still written through.
    expect(out.sessionId).toBe("s1");
  });

  test("incoming borrow provenance wins over the prior file", () => {
    const out = preserveRefinedSessionMeta(
      { ...minimal(), internal: true, borrow: { borrowId: "new", hostSessionId: "A", role: "borrow-target" } },
      { internal: true, borrow: { borrowId: "old", hostSessionId: "A", role: "borrow-target" } },
    );
    expect(out.borrow).toEqual({ borrowId: "new", hostSessionId: "A", role: "borrow-target" });
  });

  test("a non-borrow session never gains an internal/borrow stamp from a clean prior file", () => {
    const out = preserveRefinedSessionMeta(minimal(), { displayName: "Doc" });
    expect(out.internal).toBeUndefined();
    expect(out.borrow).toBeUndefined();
  });
});

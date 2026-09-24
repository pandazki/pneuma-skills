import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import {
  normalizePersistedSession,
  normalizeSessionRecord,
  parseCliArgs,
  parseVitePort,
  preserveRefinedSessionMeta,
  resolveWorkspaceBackendType,
  startViteDev,
  startsOverPersistedSession,
  type PersistedSession,
} from "../pneuma-cli-helpers.js";
import { i18next } from "../i18n.js";

// `resolveWorkspaceBackendType` is asserted on its English message. `bin/i18n.ts`
// picks its language at import time from `~/.pneuma/settings.json` (`locale`),
// so pin English here and hand the developer's choice back afterwards.
const localeBeforeTests = i18next.language;
beforeAll(async () => {
  await i18next.changeLanguage("en");
});
afterAll(async () => {
  await i18next.changeLanguage(localeBeforeTests);
});

/**
 * A quick session's state directory is the workspace's single `.pneuma/`, so a
 * handoff into that workspace boots on top of whatever session was working
 * there. Continuing it would resume the previous mode's conversation inside
 * the new mode — nothing in the boot path compares modes, and nothing needs
 * to once the handoff itself answers the question.
 */
describe("startsOverPersistedSession", () => {
  test("a quick session with a handoff staged for it starts over", () => {
    expect(startsOverPersistedSession("quick", true)).toBe(true);
  });

  test("a quick session opened normally continues where it left off", () => {
    expect(startsOverPersistedSession("quick", false)).toBe(false);
  });

  test("a project session never starts over — it owns its own directory", () => {
    expect(startsOverPersistedSession("project", true)).toBe(false);
    expect(startsOverPersistedSession("project", false)).toBe(false);
  });
});

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

describe("parseVitePort (the ready line must name the port Vite actually took)", () => {
  // Captured verbatim from a real `bun run dev` where 17996-17998 were
  // already in use. The naive regex this replaced matched NOTHING here, so
  // the parser timed out and the ready line advertised 17996 — a port
  // serving a DIFFERENT session.
  const COLOURISED =
    "  \x1b[32m➜\x1b[39m  \x1b[1mLocal\x1b[22m:   \x1b[36mhttp://localhost:\x1b[1m17999\x1b[22m/\x1b[39m";

  test("reads the port through Vite's ANSI colouring", () => {
    expect(parseVitePort(COLOURISED)).toBe(17999);
  });

  test("still reads a plain, uncoloured banner", () => {
    expect(parseVitePort("  ➜  Local:   http://localhost:17996/")).toBe(17996);
  });

  test("reads an https banner and a non-localhost host", () => {
    expect(parseVitePort("  ➜  Local:   https://127.0.0.1:5173/")).toBe(5173);
  });

  test("is null on every line that is not the Local row", () => {
    for (const line of [
      "",
      "  ➜  Network: http://10.0.0.2:17999/",
      "  VITE v7.3.2  ready in 667 ms",
      "[projects-cache] revalidated /Users/x/Codes/plexus in 920ms",
      "Local: http://localhost:/",
    ]) {
      expect(parseVitePort(line)).toBeNull();
    }
  });

  test("refuses a port outside the legal range rather than reporting it", () => {
    expect(parseVitePort("  ➜  Local:   http://localhost:99999/")).toBeNull();
  });
});

describe("startViteDev (a dev server that never came up is a failure, not a URL)", () => {
  // Review finding (2026-09-24): the port promise only ever resolved — on
  // the Local line or, after 10 s, to the port it had asked for. A Vite that
  // exited at once (missing dependency, config error) still produced a ready
  // line pointing at nothing. `cmd` stands in for `bunx vite`.
  const fake = (script: string) => [process.execPath, "-e", script];
  const quiet = () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    return (): string[] => {
      const warned = warn.mock.calls.map((c) => String(c[0]));
      log.mockRestore();
      warn.mockRestore();
      return warned;
    };
  };

  test("rejects with the exit code and the output tail when Vite exits before reporting a port", async () => {
    const restore = quiet();
    try {
      const started = startViteDev({
        projectRoot: process.cwd(),
        port: 17996,
        env: { ...(process.env as Record<string, string>) },
        cmd: fake("console.log('loading config'); console.error('Error: Cannot find package vite'); process.exit(3)"),
        timeoutMs: 20_000,
      });
      await expect(started).rejects.toThrow(/exited with code 3[\s\S]*Cannot find package vite/);
    } finally {
      restore();
    }
  });

  test("resolves with the port from the Local line", async () => {
    const restore = quiet();
    try {
      const { proc, port } = await startViteDev({
        projectRoot: process.cwd(),
        port: 17996,
        env: { ...(process.env as Record<string, string>) },
        cmd: fake("console.log('  ➜  Local:   http://localhost:17999/'); setInterval(() => {}, 1000)"),
        timeoutMs: 20_000,
      });
      proc.kill();
      expect(port).toBe(17999);
    } finally {
      restore();
    }
  });

  test("a Vite still running at the timeout keeps the requested port, with a warning", async () => {
    const restore = quiet();
    let proc: ReturnType<typeof Bun.spawn> | null = null;
    try {
      const result = await startViteDev({
        projectRoot: process.cwd(),
        port: 17996,
        env: { ...(process.env as Record<string, string>) },
        cmd: fake("setInterval(() => {}, 1000)"),
        timeoutMs: 300,
      });
      proc = result.proc;
      expect(result.port).toBe(17996);
    } finally {
      proc?.kill();
      const warned = restore();
      expect(warned.some((m) => m.includes("17996"))).toBe(true);
    }
  });
});

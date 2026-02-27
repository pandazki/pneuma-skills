/**
 * AgentBackend 契约测试
 *
 * 验证 AgentBackend 接口约束：
 * - 生命周期管理 (launch/kill/getSession)
 * - 能力声明完整性
 * - 协议适配器契约
 *
 * 基于 Claude Code 作为事实标准设计。
 */

import { describe, test, expect } from "bun:test";
import type {
  AgentBackend,
  AgentSessionInfo,
  AgentLaunchOptions,
  AgentCapabilities,
  AgentProtocolAdapter,
} from "../types/index.js";

// ── Mock AgentBackend (模拟 ClaudeCodeBackend 的行为) ────────────────────────

function createMockBackend(): AgentBackend {
  const sessions = new Map<string, AgentSessionInfo>();
  const exitHandlers: ((sessionId: string, exitCode: number | null) => void)[] = [];

  return {
    name: "claude-code",

    capabilities: {
      streaming: true,
      resume: true,
      permissions: true,
      toolProgress: true,
      modelSwitch: true,
    },

    launch(options: AgentLaunchOptions): AgentSessionInfo {
      const sessionId = options.sessionId || `mock-${Date.now()}`;
      const info: AgentSessionInfo = {
        sessionId,
        agentSessionId: options.resumeSessionId,
        state: "starting",
        cwd: options.cwd,
        createdAt: Date.now(),
      };
      sessions.set(sessionId, info);
      return info;
    },

    getSession(sessionId: string) {
      return sessions.get(sessionId);
    },

    isAlive(sessionId: string) {
      const s = sessions.get(sessionId);
      return !!s && s.state !== "exited";
    },

    markConnected(sessionId: string) {
      const s = sessions.get(sessionId);
      if (s) s.state = "connected";
    },

    setAgentSessionId(sessionId: string, agentSessionId: string) {
      const s = sessions.get(sessionId);
      if (s) s.agentSessionId = agentSessionId;
    },

    async kill(sessionId: string) {
      const s = sessions.get(sessionId);
      if (!s) return false;
      s.state = "exited";
      s.exitCode = 0;
      for (const h of exitHandlers) {
        try { h(sessionId, 0); } catch {}
      }
      return true;
    },

    async killAll() {
      for (const id of sessions.keys()) {
        await this.kill(id);
      }
    },

    onSessionExited(cb) {
      exitHandlers.push(cb);
    },
  };
}

// ── AgentBackend 生命周期 ────────────────────────────────────────────────────

describe("AgentBackend lifecycle", () => {
  test("launch creates a session in starting state", () => {
    const backend = createMockBackend();
    const session = backend.launch({
      cwd: "/tmp/test",

    });

    expect(session.state).toBe("starting");
    expect(session.cwd).toBe("/tmp/test");
    expect(session.sessionId).toBeTruthy();
  });

  test("launch with sessionId reuses the given ID", () => {
    const backend = createMockBackend();
    const session = backend.launch({
      cwd: "/tmp/test",
      sessionId: "my-id",
    });

    expect(session.sessionId).toBe("my-id");
  });

  test("launch with resumeSessionId sets agentSessionId", () => {
    const backend = createMockBackend();
    const session = backend.launch({
      cwd: "/tmp/test",

      resumeSessionId: "cli-session-123",
    });

    expect(session.agentSessionId).toBe("cli-session-123");
  });

  test("markConnected transitions state", () => {
    const backend = createMockBackend();
    const session = backend.launch({
      cwd: "/tmp/test",

    });

    expect(session.state).toBe("starting");
    backend.markConnected(session.sessionId);
    expect(backend.getSession(session.sessionId)?.state).toBe("connected");
  });

  test("setAgentSessionId stores the agent internal ID", () => {
    const backend = createMockBackend();
    const session = backend.launch({
      cwd: "/tmp/test",

    });

    backend.setAgentSessionId(session.sessionId, "internal-456");
    expect(backend.getSession(session.sessionId)?.agentSessionId).toBe("internal-456");
  });

  test("isAlive returns true for non-exited sessions", () => {
    const backend = createMockBackend();
    const session = backend.launch({
      cwd: "/tmp/test",

    });

    expect(backend.isAlive(session.sessionId)).toBe(true);
  });

  test("kill transitions to exited and fires handler", async () => {
    const backend = createMockBackend();
    let exitedId = "";
    backend.onSessionExited((id) => { exitedId = id; });

    const session = backend.launch({
      cwd: "/tmp/test",
    });

    await backend.kill(session.sessionId);

    expect(backend.isAlive(session.sessionId)).toBe(false);
    expect(backend.getSession(session.sessionId)?.state).toBe("exited");
    expect(exitedId).toBe(session.sessionId);
  });

  test("kill returns false for unknown session", async () => {
    const backend = createMockBackend();
    expect(await backend.kill("nonexistent")).toBe(false);
  });

  test("killAll terminates all sessions", async () => {
    const backend = createMockBackend();
    const s1 = backend.launch({ cwd: "/tmp/1" });
    const s2 = backend.launch({ cwd: "/tmp/2" });

    expect(backend.isAlive(s1.sessionId)).toBe(true);
    expect(backend.isAlive(s2.sessionId)).toBe(true);

    await backend.killAll();

    expect(backend.isAlive(s1.sessionId)).toBe(false);
    expect(backend.isAlive(s2.sessionId)).toBe(false);
  });
});

// ── AgentCapabilities ────────────────────────────────────────────────────────

describe("AgentCapabilities", () => {
  test("Claude Code backend declares full capabilities", () => {
    const backend = createMockBackend();
    const caps = backend.capabilities;

    expect(caps.streaming).toBe(true);
    expect(caps.resume).toBe(true);
    expect(caps.permissions).toBe(true);
    expect(caps.toolProgress).toBe(true);
    expect(caps.modelSwitch).toBe(true);
  });

  test("capabilities shape has all required fields", () => {
    const caps: AgentCapabilities = {
      streaming: false,
      resume: false,
      permissions: false,
      toolProgress: false,
      modelSwitch: false,
    };

    // All fields are booleans
    for (const [key, value] of Object.entries(caps)) {
      expect(typeof value).toBe("boolean");
    }
    expect(Object.keys(caps)).toHaveLength(5);
  });
});

// ── AgentProtocolAdapter ─────────────────────────────────────────────────────

describe("AgentProtocolAdapter", () => {
  test("NDJSON adapter parses JSON lines", () => {
    const adapter: AgentProtocolAdapter = {
      parseIncoming(raw: string) {
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      },
      encodeOutgoing(msg: unknown) {
        return JSON.stringify(msg) + "\n";
      },
    };

    // Parse valid JSON
    const parsed = adapter.parseIncoming('{"type":"assistant","message":{}}');
    expect(parsed).toEqual({ type: "assistant", message: {} });

    // Parse invalid JSON returns null
    expect(adapter.parseIncoming("not json")).toBeNull();

    // Encode appends newline (NDJSON convention)
    const encoded = adapter.encodeOutgoing({ type: "user_message", content: "hello" });
    expect(encoded).toBe('{"type":"user_message","content":"hello"}\n');
    expect(encoded.endsWith("\n")).toBe(true);
  });

  test("adapter parseIncoming returns null for empty lines", () => {
    const adapter: AgentProtocolAdapter = {
      parseIncoming(raw: string) {
        const trimmed = raw.trim();
        if (!trimmed) return null;
        try { return JSON.parse(trimmed); } catch { return null; }
      },
      encodeOutgoing(msg: unknown) {
        return JSON.stringify(msg) + "\n";
      },
    };

    expect(adapter.parseIncoming("")).toBeNull();
    expect(adapter.parseIncoming("  \n  ")).toBeNull();
  });
});

// ── Backend name ─────────────────────────────────────────────────────────────

describe("AgentBackend identity", () => {
  test("name identifies the backend", () => {
    const backend = createMockBackend();
    expect(backend.name).toBe("claude-code");
    expect(typeof backend.name).toBe("string");
    expect(backend.name.length).toBeGreaterThan(0);
  });
});

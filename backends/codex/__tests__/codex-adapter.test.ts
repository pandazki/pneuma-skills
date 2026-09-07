import { describe, expect, test, mock, beforeEach } from "bun:test";
import { CodexAdapter, describeErrorNotification } from "../codex-adapter.js";
import type { ICodexTransport } from "../codex-adapter.js";
import type { BrowserIncomingMessage } from "../../../server/session-types.js";

/**
 * Creates a mock ICodexTransport that simulates the Codex app-server
 * JSON-RPC protocol for testing the CodexAdapter.
 */
function createMockTransport(): ICodexTransport & {
  _notificationHandler: ((method: string, params: Record<string, unknown>) => void) | null;
  _requestHandler: ((method: string, id: number, params: Record<string, unknown>) => void) | null;
  _callHistory: { method: string; params: Record<string, unknown> }[];
  _respondHistory: { id: number; result: unknown }[];
  _callResolver: Map<string, (result: unknown) => void>;
  simulateNotification: (method: string, params: Record<string, unknown>) => void;
  simulateRequest: (method: string, id: number, params: Record<string, unknown>) => void;
} {
  let notificationHandler: ((method: string, params: Record<string, unknown>) => void) | null = null;
  let requestHandler: ((method: string, id: number, params: Record<string, unknown>) => void) | null = null;
  const callHistory: { method: string; params: Record<string, unknown> }[] = [];
  const respondHistory: { id: number; result: unknown }[] = [];
  const callResolver = new Map<string, (result: unknown) => void>();

  return {
    _notificationHandler: null,
    _requestHandler: null,
    _callHistory: callHistory,
    _respondHistory: respondHistory,
    _callResolver: callResolver,

    async call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
      callHistory.push({ method, params });

      // Auto-resolve known init methods
      if (method === "initialize") {
        return { serverInfo: { name: "codex-test", version: "1.0.0" } };
      }
      if (method === "thread/start") {
        return { thread: { id: "thr_test" }, model: "o3-pro", model_provider: "openai" };
      }
      if (method === "thread/resume") {
        return { thread: { id: params.threadId || "thr_resumed" }, model: "o3-pro", model_provider: "openai" };
      }
      if (method === "turn/start") {
        return { turn: { id: "turn_1" } };
      }
      if (method === "turn/interrupt") {
        return {};
      }
      if (method === "turn/steer") {
        return { turnId: "turn_1" };
      }

      // For other methods, return a promise that can be resolved externally
      return new Promise((resolve) => {
        callResolver.set(method, resolve);
      });
    },

    async notify(method: string, params: Record<string, unknown> = {}): Promise<void> {
      callHistory.push({ method, params });
    },

    async respond(id: number, result: unknown): Promise<void> {
      respondHistory.push({ id, result });
    },

    onNotification(handler: (method: string, params: Record<string, unknown>) => void): void {
      notificationHandler = handler;
    },

    onRequest(handler: (method: string, id: number, params: Record<string, unknown>) => void): void {
      requestHandler = handler;
    },

    isConnected(): boolean {
      return true;
    },

    simulateNotification(method: string, params: Record<string, unknown>): void {
      notificationHandler?.(method, params);
    },

    simulateRequest(method: string, id: number, params: Record<string, unknown>): void {
      requestHandler?.(method, id, params);
    },
  };
}

/** Wait for initialization to complete. */
async function waitForInit(): Promise<void> {
  // The adapter initializes asynchronously — give it time
  await new Promise((r) => setTimeout(r, 50));
}

describe("CodexAdapter", () => {
  test("initializes with JSON-RPC handshake and thread start", async () => {
    const transport = createMockTransport();
    const messages: BrowserIncomingMessage[] = [];

    const adapter = new CodexAdapter(transport, "test-session", {
      model: "gpt-5.3-codex",
      cwd: "/tmp/test",
    });
    adapter.onBrowserMessage((msg) => messages.push(msg));

    await waitForInit();

    // Should have called: initialize, initialized (notify), thread/start
    const methods = transport._callHistory.map((c) => c.method);
    expect(methods).toContain("initialize");
    expect(methods).toContain("initialized");
    expect(methods).toContain("thread/start");

    // Should emit session_init
    const initMsg = messages.find((m) => m.type === "session_init");
    expect(initMsg).toBeDefined();
    if (initMsg?.type === "session_init") {
      expect(initMsg.session.backend_type).toBe("codex");
      // Model comes from thread/start response ("o3-pro"), not the option
      expect(initMsg.session.model).toBe("o3-pro");
    }
  });

  test("extracts model from thread/start response", async () => {
    const transport = createMockTransport();
    const messages: BrowserIncomingMessage[] = [];

    const adapter = new CodexAdapter(transport, "test-session", {
      cwd: "/tmp/test",
    });
    adapter.onBrowserMessage((msg) => messages.push(msg));
    await waitForInit();

    const initMsg = messages.find((m) => m.type === "session_init");
    expect(initMsg).toBeDefined();
    if (initMsg?.type === "session_init") {
      // Model should come from thread/start response, not the empty option
      expect(initMsg.session.model).toBe("o3-pro");
    }
  });

  test("reports thread ID via sessionMeta callback", async () => {
    const transport = createMockTransport();
    let reportedMeta: { cliSessionId?: string } | null = null;

    const adapter = new CodexAdapter(transport, "test-session", {
      model: "gpt-5.3-codex",
      cwd: "/tmp/test",
    });
    adapter.onSessionMeta((meta) => { reportedMeta = meta; });

    await waitForInit();

    expect(reportedMeta).toBeDefined();
    expect((reportedMeta as { cliSessionId?: string } | null)?.cliSessionId).toBe("thr_test");
  });

  test("sends user message as turn/start with typed input", async () => {
    const transport = createMockTransport();
    const adapter = new CodexAdapter(transport, "test-session", {
      model: "gpt-5.3-codex",
      cwd: "/tmp/test",
    });

    await waitForInit();

    adapter.sendBrowserMessage({
      type: "user_message",
      content: "Hello Codex",
    });

    // Wait for the async turn/start
    await new Promise((r) => setTimeout(r, 20));

    const turnCall = transport._callHistory.find((c) => c.method === "turn/start");
    expect(turnCall).toBeDefined();
    expect(turnCall?.params.threadId).toBe("thr_test");
    expect(turnCall?.params.input).toEqual([{ type: "text", text: "Hello Codex" }]);
  });

  test("steers an active turn with turn/steer without starting or interrupting a turn", async () => {
    const transport = createMockTransport();
    const adapter = new CodexAdapter(transport, "test-session", {
      model: "gpt-5.3-codex",
      cwd: "/tmp/test",
    });

    await waitForInit();
    adapter.sendBrowserMessage({ type: "user_message", content: "Draft the plan" });
    await new Promise((r) => setTimeout(r, 20));

    const before = transport._callHistory.length;
    await adapter.steerUserMessage("Focus on migration risk", [
      { media_type: "image/png", data: "aW1hZ2U=" },
    ]);

    const calls = transport._callHistory.slice(before);
    expect(calls).toEqual([
      {
        method: "turn/steer",
        params: {
          threadId: "thr_test",
          expectedTurnId: "turn_1",
          input: [
            { type: "image", url: "data:image/png;base64,aW1hZ2U=" },
            { type: "text", text: "Focus on migration risk" },
          ],
        },
      },
    ]);
    expect(calls.some((call) => call.method === "turn/start")).toBe(false);
    expect(calls.some((call) => call.method === "turn/interrupt")).toBe(false);
  });

  test("rejects steer when there is no active turn", async () => {
    const transport = createMockTransport();
    const adapter = new CodexAdapter(transport, "test-session", { cwd: "/tmp/test" });
    await waitForInit();

    expect(adapter.canSteer()).toBe(false);
    await expect(adapter.steerUserMessage("too early")).rejects.toThrow("No active Codex turn");
    expect(transport._callHistory.some((call) => call.method === "turn/steer")).toBe(false);
  });

  test("emits streaming text via item/agentMessage/delta", async () => {
    const transport = createMockTransport();
    const messages: BrowserIncomingMessage[] = [];

    const adapter = new CodexAdapter(transport, "test-session", {
      cwd: "/tmp/test",
    });
    adapter.onBrowserMessage((msg) => messages.push(msg));

    await waitForInit();

    // Simulate Codex streaming
    transport.simulateNotification("item/started", {
      item: { type: "agentMessage", id: "msg-1" },
    });
    transport.simulateNotification("item/agentMessage/delta", {
      itemId: "msg-1",
      delta: "Hello ",
    });
    transport.simulateNotification("item/agentMessage/delta", {
      itemId: "msg-1",
      delta: "world!",
    });

    // Should have stream_event messages
    const streamEvents = messages.filter((m) => m.type === "stream_event");
    expect(streamEvents.length).toBe(2);

    // Simulate completion
    transport.simulateNotification("item/completed", {
      item: { type: "agentMessage", id: "msg-1" },
    });

    // Should have flushed to an assistant message
    const assistantMsgs = messages.filter((m) => m.type === "assistant");
    expect(assistantMsgs.length).toBeGreaterThanOrEqual(1);
  });

  test("maps commandExecution to Bash tool_use", async () => {
    const transport = createMockTransport();
    const messages: BrowserIncomingMessage[] = [];

    const adapter = new CodexAdapter(transport, "test-session", {
      cwd: "/tmp/test",
    });
    adapter.onBrowserMessage((msg) => messages.push(msg));

    await waitForInit();

    // Simulate command execution
    transport.simulateNotification("item/started", {
      item: { type: "commandExecution", id: "cmd-1", command: "ls -la", status: "inProgress" },
    });
    transport.simulateNotification("item/completed", {
      item: { type: "commandExecution", id: "cmd-1", command: "ls -la", status: "completed", exitCode: 0 },
    });

    // Should have tool_use and tool_result messages
    const assistantMsgs = messages.filter((m) => m.type === "assistant");
    const hasToolUse = assistantMsgs.some((m) =>
      m.type === "assistant" && m.message?.content?.some((b: { type: string }) => b.type === "tool_use"),
    );
    const hasToolResult = assistantMsgs.some((m) =>
      m.type === "assistant" && m.message?.content?.some((b: { type: string }) => b.type === "tool_result"),
    );
    expect(hasToolUse).toBe(true);
    expect(hasToolResult).toBe(true);
  });

  test("maps fileChange to Edit tool_use", async () => {
    const transport = createMockTransport();
    const messages: BrowserIncomingMessage[] = [];

    const adapter = new CodexAdapter(transport, "test-session", {
      cwd: "/tmp/test",
    });
    adapter.onBrowserMessage((msg) => messages.push(msg));

    await waitForInit();

    transport.simulateNotification("item/started", {
      item: {
        type: "fileChange",
        id: "fc-1",
        changes: [{ path: "src/main.ts", kind: "modify", diff: "+new line" }],
        status: "inProgress",
      },
    });
    transport.simulateNotification("item/completed", {
      item: {
        type: "fileChange",
        id: "fc-1",
        changes: [{ path: "src/main.ts", kind: "modify", diff: "+new line" }],
        status: "completed",
      },
    });

    const assistantMsgs = messages.filter((m) => m.type === "assistant");
    const hasEditToolUse = assistantMsgs.some((m) =>
      m.type === "assistant" && m.message?.content?.some(
        (b: { type: string; name?: string }) => b.type === "tool_use" && b.name === "Edit",
      ),
    );
    expect(hasEditToolUse).toBe(true);
  });

  test("emits turn/completed as result message", async () => {
    const transport = createMockTransport();
    const messages: BrowserIncomingMessage[] = [];

    const adapter = new CodexAdapter(transport, "test-session", {
      cwd: "/tmp/test",
    });
    adapter.onBrowserMessage((msg) => messages.push(msg));

    await waitForInit();

    transport.simulateNotification("turn/completed", {
      status: "completed",
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    const resultMsgs = messages.filter((m) => m.type === "result");
    expect(resultMsgs.length).toBe(1);
    if (resultMsgs[0]?.type === "result") {
      expect(resultMsgs[0].data.subtype).toBe("success");
    }

    // Should also emit status_change to idle
    const statusMsgs = messages.filter((m) => m.type === "status_change");
    expect(statusMsgs.some((m) => m.type === "status_change" && m.status === "idle")).toBe(true);
  });

  test("handles approval requests and responses", async () => {
    const transport = createMockTransport();
    const messages: BrowserIncomingMessage[] = [];

    const adapter = new CodexAdapter(transport, "test-session", {
      cwd: "/tmp/test",
    });
    adapter.onBrowserMessage((msg) => messages.push(msg));

    await waitForInit();

    // Simulate approval request from Codex
    transport.simulateRequest("item/commandExecution/requestApproval", 42, {
      command: "rm -rf /tmp/test",
      itemId: "cmd-dangerous",
    });

    // Should emit permission_request
    const permMsgs = messages.filter((m) => m.type === "permission_request");
    expect(permMsgs.length).toBe(1);

    if (permMsgs[0]?.type === "permission_request") {
      const requestId = permMsgs[0].request.request_id;

      // Respond with allow
      adapter.sendBrowserMessage({
        type: "permission_response",
        request_id: requestId,
        behavior: "allow",
      });

      await new Promise((r) => setTimeout(r, 20));

      // Should have responded to the JSON-RPC request
      const response = transport._respondHistory.find((r) => r.id === 42);
      expect(response).toBeDefined();
      expect((response?.result as { decision: string })?.decision).toBe("approved");
    }
  });

  test("handles interrupt", async () => {
    const transport = createMockTransport();
    const adapter = new CodexAdapter(transport, "test-session", {
      cwd: "/tmp/test",
    });

    await waitForInit();

    // Start a turn first
    adapter.sendBrowserMessage({ type: "user_message", content: "do something" });
    await new Promise((r) => setTimeout(r, 20));

    // Send interrupt
    adapter.sendBrowserMessage({ type: "interrupt" });
    await new Promise((r) => setTimeout(r, 20));

    const interruptCall = transport._callHistory.find((c) => c.method === "turn/interrupt");
    expect(interruptCall).toBeDefined();
  });

  test("resumes existing thread when threadId is provided", async () => {
    const transport = createMockTransport();
    const adapter = new CodexAdapter(transport, "test-session", {
      cwd: "/tmp/test",
      threadId: "thr_existing_123",
    });

    await waitForInit();

    const resumeCall = transport._callHistory.find((c) => c.method === "thread/resume");
    expect(resumeCall).toBeDefined();
    expect(resumeCall?.params.threadId).toBe("thr_existing_123");

    // thread/start should NOT have been called
    const startCall = transport._callHistory.find((c) => c.method === "thread/start");
    expect(startCall).toBeUndefined();
  });

  test("reports server version in session_init", async () => {
    const transport = createMockTransport();
    const messages: BrowserIncomingMessage[] = [];

    const adapter = new CodexAdapter(transport, "test-session", { cwd: "/tmp/test" });
    adapter.onBrowserMessage((msg) => messages.push(msg));
    await waitForInit();

    const initMsg = messages.find((m) => m.type === "session_init");
    expect(initMsg).toBeDefined();
    if (initMsg?.type === "session_init") {
      expect(initMsg.session.agent_version).toBe("codex 1.0.0");
    }
  });

  test("tracks turn count and emits session_update on turn/completed", async () => {
    const transport = createMockTransport();
    const messages: BrowserIncomingMessage[] = [];

    const adapter = new CodexAdapter(transport, "test-session", { cwd: "/tmp/test" });
    adapter.onBrowserMessage((msg) => messages.push(msg));
    await waitForInit();

    // Complete two turns
    transport.simulateNotification("turn/completed", { status: "completed", usage: { inputTokens: 100, outputTokens: 50 } });
    transport.simulateNotification("turn/completed", { status: "completed", usage: { inputTokens: 200, outputTokens: 80 } });

    const updates = messages.filter((m) => m.type === "session_update");
    const lastUpdate = updates[updates.length - 1];
    expect(lastUpdate).toBeDefined();
    if (lastUpdate?.type === "session_update") {
      expect(lastUpdate.session.num_turns).toBe(2);
    }
  });

  test("handles token usage updates with model and cost", async () => {
    const transport = createMockTransport();
    const messages: BrowserIncomingMessage[] = [];

    const adapter = new CodexAdapter(transport, "test-session", { cwd: "/tmp/test" });
    adapter.onBrowserMessage((msg) => messages.push(msg));
    await waitForInit();

    transport.simulateNotification("thread/tokenUsage/updated", {
      inputTokens: 5000,
      outputTokens: 1000,
      modelContextWindow: 200000,
      costUsd: 0.035,
      model: "o3-pro",
    });

    const updates = messages.filter((m) => m.type === "session_update");
    const tokenUpdate = updates.find((m) =>
      m.type === "session_update" && m.session.total_cost_usd !== undefined,
    );
    expect(tokenUpdate).toBeDefined();
    if (tokenUpdate?.type === "session_update") {
      expect(tokenUpdate.session.total_cost_usd).toBe(0.035);
      expect(tokenUpdate.session.model).toBe("o3-pro");
      expect(tokenUpdate.session.context_used_percent).toBe(3); // (5000+1000)/200000 = 3%
    }
  });

  /**
   * These pin the v0.114+ `tokenUsage` shape, which shipped untested and let
   * the ctx gauge read a session-cumulative number: real sessions rendered
   * "ctx 5851%".
   */
  test("measures the context window against the last request, not the session total", async () => {
    const transport = createMockTransport();
    const messages: BrowserIncomingMessage[] = [];

    const adapter = new CodexAdapter(transport, "test-session", { cwd: "/tmp/test" });
    adapter.onBrowserMessage((msg) => messages.push(msg));
    await waitForInit();

    // Numbers taken verbatim from a real 194-turn codex rollout: `total` is
    // every request's prompt re-counted, `last` is what sits in the window.
    transport.simulateNotification("thread/tokenUsage/updated", {
      tokenUsage: {
        total: { inputTokens: 23_245_850, outputTokens: 74_081, totalTokens: 23_319_931 },
        last: { inputTokens: 125_962, outputTokens: 1_329, totalTokens: 127_291 },
        modelContextWindow: 258_400,
      },
    });

    const update = messages.findLast(
      (m) => m.type === "session_update" && m.session.context_used_percent !== undefined,
    );
    expect(update).toBeDefined();
    if (update?.type === "session_update") {
      expect(update.session.context_used_percent).toBe(49); // 127291/258400
    }
  });

  test("falls back to the session total before the first request completes", async () => {
    const transport = createMockTransport();
    const messages: BrowserIncomingMessage[] = [];

    const adapter = new CodexAdapter(transport, "test-session", { cwd: "/tmp/test" });
    adapter.onBrowserMessage((msg) => messages.push(msg));
    await waitForInit();

    // No `last` yet — on turn one `total` *is* the last request.
    transport.simulateNotification("thread/tokenUsage/updated", {
      tokenUsage: {
        total: { inputTokens: 20_000, outputTokens: 600, totalTokens: 20_600 },
        modelContextWindow: 200_000,
      },
    });

    const update = messages.findLast(
      (m) => m.type === "session_update" && m.session.context_used_percent !== undefined,
    );
    expect(update).toBeDefined();
    if (update?.type === "session_update") {
      expect(update.session.context_used_percent).toBe(10); // 20600/200000
    }
  });

  test("never reports more of the window than exists", async () => {
    const transport = createMockTransport();
    const messages: BrowserIncomingMessage[] = [];

    const adapter = new CodexAdapter(transport, "test-session", { cwd: "/tmp/test" });
    adapter.onBrowserMessage((msg) => messages.push(msg));
    await waitForInit();

    // A shape this adapter does not understand must degrade to a bounded
    // number, never to another 5851%.
    transport.simulateNotification("thread/tokenUsage/updated", {
      tokenUsage: {
        total: { inputTokens: 9_000_000, outputTokens: 500_000 },
        last: { inputTokens: 9_000_000, outputTokens: 500_000 },
        modelContextWindow: 200_000,
      },
    });

    const update = messages.findLast(
      (m) => m.type === "session_update" && m.session.context_used_percent !== undefined,
    );
    expect(update).toBeDefined();
    if (update?.type === "session_update") {
      expect(update.session.context_used_percent).toBe(100);
    }
  });

  test("handles thread/status/changed notifications", async () => {
    const transport = createMockTransport();
    const messages: BrowserIncomingMessage[] = [];

    const adapter = new CodexAdapter(transport, "test-session", { cwd: "/tmp/test" });
    adapter.onBrowserMessage((msg) => messages.push(msg));
    await waitForInit();

    transport.simulateNotification("thread/status/changed", { status: "running" });
    transport.simulateNotification("thread/status/changed", { status: "idle" });

    const statusMsgs = messages.filter((m) => m.type === "status_change");
    expect(statusMsgs.some((m) => m.type === "status_change" && m.status === "running")).toBe(true);
    expect(statusMsgs.some((m) => m.type === "status_change" && m.status === "idle")).toBe(true);
  });

  test("handles reasoning/thinking deltas", async () => {
    const transport = createMockTransport();
    const messages: BrowserIncomingMessage[] = [];

    const adapter = new CodexAdapter(transport, "test-session", { cwd: "/tmp/test" });
    adapter.onBrowserMessage((msg) => messages.push(msg));
    await waitForInit();

    transport.simulateNotification("item/started", { item: { type: "reasoning", id: "r-1" } });
    transport.simulateNotification("item/reasoning/textDelta", { delta: "Let me think..." });
    transport.simulateNotification("item/completed", { item: { type: "reasoning", id: "r-1" } });

    // Should have emitted thinking stream events
    const thinkingStreams = messages.filter((m) =>
      m.type === "stream_event" && (m as any).event?.delta?.type === "thinking_delta",
    );
    expect(thinkingStreams.length).toBe(1);

    // Should have flushed reasoning to an assistant message
    const assistantMsgs = messages.filter((m) => m.type === "assistant");
    const hasThinking = assistantMsgs.some((m) =>
      m.type === "assistant" && m.message?.content?.some((b: any) => b.type === "thinking"),
    );
    expect(hasThinking).toBe(true);
  });

  test("maps webSearch to WebSearch tool_use", async () => {
    const transport = createMockTransport();
    const messages: BrowserIncomingMessage[] = [];

    const adapter = new CodexAdapter(transport, "test-session", { cwd: "/tmp/test" });
    adapter.onBrowserMessage((msg) => messages.push(msg));
    await waitForInit();

    transport.simulateNotification("item/started", { item: { type: "webSearch", id: "ws-1", query: "bun test runner" } });
    transport.simulateNotification("item/completed", { item: { type: "webSearch", id: "ws-1", query: "bun test runner", output: "Found results" } });

    const assistantMsgs = messages.filter((m) => m.type === "assistant");
    const hasWebSearch = assistantMsgs.some((m) =>
      m.type === "assistant" && m.message?.content?.some(
        (b: { type: string; name?: string }) => b.type === "tool_use" && b.name === "WebSearch",
      ),
    );
    expect(hasWebSearch).toBe(true);
  });

  test("handles MCP tool call approval requests", async () => {
    const transport = createMockTransport();
    const messages: BrowserIncomingMessage[] = [];

    const adapter = new CodexAdapter(transport, "test-session", { cwd: "/tmp/test" });
    adapter.onBrowserMessage((msg) => messages.push(msg));
    await waitForInit();

    transport.simulateRequest("item/mcpToolCall/requestApproval", 99, {
      serverName: "my-server",
      toolName: "search",
      args: { query: "hello" },
      itemId: "mcp-1",
    });

    const permMsgs = messages.filter((m) => m.type === "permission_request");
    expect(permMsgs.length).toBe(1);
    if (permMsgs[0]?.type === "permission_request") {
      expect(permMsgs[0].request.tool_name).toBe("mcp:my-server:search");
    }
  });

  test("tracks lines added/removed from file changes", async () => {
    const transport = createMockTransport();
    const messages: BrowserIncomingMessage[] = [];

    const adapter = new CodexAdapter(transport, "test-session", { cwd: "/tmp/test" });
    adapter.onBrowserMessage((msg) => messages.push(msg));
    await waitForInit();

    transport.simulateNotification("item/started", {
      item: { type: "fileChange", id: "fc-1", changes: [{ path: "a.ts", kind: "modify", diff: "+line1\n+line2\n-old" }], status: "inProgress" },
    });
    transport.simulateNotification("item/completed", {
      item: { type: "fileChange", id: "fc-1", changes: [{ path: "a.ts", kind: "modify", diff: "+line1\n+line2\n-old" }], status: "completed" },
    });

    // Trigger turn/completed to flush stats
    transport.simulateNotification("turn/completed", { status: "completed", usage: {} });

    const updates = messages.filter((m) => m.type === "session_update");
    const linesUpdate = updates.find((m) =>
      m.type === "session_update" && (m.session.total_lines_added ?? 0) > 0,
    );
    expect(linesUpdate).toBeDefined();
    if (linesUpdate?.type === "session_update") {
      expect(linesUpdate.session.total_lines_added).toBe(2);
      expect(linesUpdate.session.total_lines_removed).toBe(1);
    }
  });

  test("handles contextCompaction item", async () => {
    const transport = createMockTransport();
    const messages: BrowserIncomingMessage[] = [];

    const adapter = new CodexAdapter(transport, "test-session", { cwd: "/tmp/test" });
    adapter.onBrowserMessage((msg) => messages.push(msg));
    await waitForInit();

    transport.simulateNotification("item/started", { item: { type: "contextCompaction", id: "cc-1" } });
    const compacting = messages.find((m) => m.type === "status_change" && m.status === "compacting");
    expect(compacting).toBeDefined();

    transport.simulateNotification("item/completed", { item: { type: "contextCompaction", id: "cc-1" } });
    const running = messages.filter((m) => m.type === "status_change").pop();
    expect(running?.type === "status_change" && running.status === "running").toBe(true);
  });

  test("maps bypassPermissions to never approval policy", async () => {
    const transport = createMockTransport();
    const adapter = new CodexAdapter(transport, "test-session", {
      cwd: "/tmp/test",
      approvalMode: "bypassPermissions",
    });

    await waitForInit();

    const threadCall = transport._callHistory.find((c) => c.method === "thread/start");
    expect(threadCall?.params.approvalPolicy).toBe("never");
    expect(threadCall?.params.sandbox).toBe("danger-full-access");
  });
  // ── /compact + compaction echo ────────────────────────────────────────────

  test("advertises compact as a builtin slash command, kept apart from skills", async () => {
    const transport = createMockTransport();
    const messages: BrowserIncomingMessage[] = [];
    const adapter = new CodexAdapter(transport, "test-session", { cwd: "/tmp/test" });
    adapter.onBrowserMessage((msg) => messages.push(msg));
    await waitForInit();

    const init = messages.find((m) => m.type === "session_init");
    expect(init?.type === "session_init" && init.session.slash_commands).toEqual(["compact"]);

    transport._callResolver.get("skills/list")?.({
      data: [{ cwd: "/tmp/test", skills: [{ name: "pneuma-doc", enabled: true }, { name: "off", enabled: false }], errors: [] }],
    });
    await new Promise((r) => setTimeout(r, 10));

    const update = messages
      .filter((m): m is Extract<BrowserIncomingMessage, { type: "session_update" }> => m.type === "session_update")
      .find((m) => Array.isArray(m.session.slash_commands));
    expect(update?.session.slash_commands).toEqual(["compact", "pneuma-doc"]);
    expect(update?.session.skills).toEqual(["pneuma-doc"]);
  });

  test("/compact calls thread/compact/start instead of turn/start and echoes a manual boundary once", async () => {
    const transport = createMockTransport();
    const messages: BrowserIncomingMessage[] = [];
    const adapter = new CodexAdapter(transport, "test-session", { cwd: "/tmp/test" });
    adapter.onBrowserMessage((msg) => messages.push(msg));
    await waitForInit();

    // Occupancy before the compaction — what the boundary reports as pre_tokens.
    transport.simulateNotification("thread/tokenUsage/updated", {
      tokenUsage: {
        total: { inputTokens: 900_000, outputTokens: 40_000, totalTokens: 940_000 },
        last: { inputTokens: 140_000, outputTokens: 2_000, totalTokens: 142_000 },
        modelContextWindow: 258_400,
      },
    });

    adapter.sendBrowserMessage({ type: "user_message", content: "  /Compact \n" });
    await new Promise((r) => setTimeout(r, 10));

    const compactCall = transport._callHistory.find((c) => c.method === "thread/compact/start");
    expect(compactCall?.params).toEqual({ threadId: "thr_test" });
    expect(transport._callHistory.some((c) => c.method === "turn/start")).toBe(false);
    transport._callResolver.get("thread/compact/start")?.({});

    // Codex runs the compaction as a turn of its own; v0.114+ reports it
    // both as an item and as thread/compacted.
    // Order as probed live on codex-cli 0.154: the token-usage update INSIDE
    // the compaction turn already carries the post-compaction occupancy.
    transport.simulateNotification("turn/started", { threadId: "thr_test", turn: { id: "turn_c" } });
    transport.simulateNotification("item/started", { item: { type: "contextCompaction", id: "cc-1" } });
    transport.simulateNotification("thread/tokenUsage/updated", {
      tokenUsage: {
        total: { inputTokens: 900_000, outputTokens: 40_000, totalTokens: 940_000 },
        last: { inputTokens: 0, outputTokens: 0, totalTokens: 5_750 },
        modelContextWindow: 258_400,
      },
    });
    transport.simulateNotification("item/completed", { item: { type: "contextCompaction", id: "cc-1" } });
    transport.simulateNotification("thread/compacted", { threadId: "thr_test", turnId: "turn_c" });
    transport.simulateNotification("turn/completed", { turn: { id: "turn_c", status: "completed" } });

    const boundaries = messages.filter(
      (m): m is Extract<BrowserIncomingMessage, { type: "system_event" }> =>
        m.type === "system_event" && m.event.subtype === "compact_boundary",
    );
    expect(boundaries).toHaveLength(1);
    const event = boundaries[0].event as { compact_metadata: { trigger: string; pre_tokens: number } };
    expect(event.compact_metadata.trigger).toBe("manual");
    expect(event.compact_metadata.pre_tokens).toBe(142_000);

    // The gauge keeps Codex's own post-compaction reading (5,750 / 258,400)
    // rather than being forced to 0 at the boundary; the turn still ends
    // with a result and the interrupt id came from `turn.id`.
    const gauge = messages
      .filter((m): m is Extract<BrowserIncomingMessage, { type: "session_update" }> => m.type === "session_update")
      .map((m) => m.session.context_used_percent)
      .filter((v): v is number => typeof v === "number")
      .pop();
    expect(gauge).toBeGreaterThan(0);
    expect(gauge).toBeLessThan(5);
    expect(messages.some((m) => m.type === "result")).toBe(true);
    const last = messages.filter((m) => m.type === "status_change").pop();
    expect(last?.type === "status_change" && last.status).toBe("idle");
  });

  test("/compact with a note stays prose — the RPC takes no focus instructions", async () => {
    const transport = createMockTransport();
    const adapter = new CodexAdapter(transport, "test-session", { cwd: "/tmp/test" });
    await waitForInit();

    adapter.sendBrowserMessage({ type: "user_message", content: "/compact keep the file list" });
    await new Promise((r) => setTimeout(r, 10));

    expect(transport._callHistory.some((c) => c.method === "thread/compact/start")).toBe(false);
    expect(transport._callHistory.some((c) => c.method === "turn/start")).toBe(true);
  });

  test("a rejected thread/compact/start unwinds the turn with an error result", async () => {
    const transport = createMockTransport();
    const messages: BrowserIncomingMessage[] = [];
    const adapter = new CodexAdapter(transport, "test-session", { cwd: "/tmp/test" });
    adapter.onBrowserMessage((msg) => messages.push(msg));
    await waitForInit();

    const originalCall = transport.call.bind(transport);
    transport.call = async (method: string, params: Record<string, unknown> = {}) => {
      if (method === "thread/compact/start") throw new Error("Method not found");
      return originalCall(method, params);
    };

    adapter.sendBrowserMessage({ type: "user_message", content: "/compact" });
    await new Promise((r) => setTimeout(r, 10));

    const error = messages.find((m) => m.type === "error");
    expect(error?.type === "error" && error.message).toContain("Method not found");
    const result = messages.find((m) => m.type === "result");
    expect(result?.type === "result" && result.data.is_error).toBe(true);
    const last = messages.filter((m) => m.type === "status_change").pop();
    expect(last?.type === "status_change" && last.status).toBe("idle");
  });

  test("an unprompted compaction echoes an auto boundary", async () => {
    const transport = createMockTransport();
    const messages: BrowserIncomingMessage[] = [];
    const adapter = new CodexAdapter(transport, "test-session", { cwd: "/tmp/test" });
    adapter.onBrowserMessage((msg) => messages.push(msg));
    await waitForInit();

    transport.simulateNotification("item/started", { item: { type: "contextCompaction", id: "cc-auto" } });
    transport.simulateNotification("item/completed", { item: { type: "contextCompaction", id: "cc-auto" } });

    const boundaries = messages.filter((m) => m.type === "system_event" && m.event.subtype === "compact_boundary");
    expect(boundaries).toHaveLength(1);
    const event = boundaries[0].type === "system_event" ? boundaries[0].event as { compact_metadata: { trigger: string } } : null;
    expect(event?.compact_metadata.trigger).toBe("auto");
  });

  test("thread/compacted on its own still echoes a boundary", async () => {
    const transport = createMockTransport();
    const messages: BrowserIncomingMessage[] = [];
    const adapter = new CodexAdapter(transport, "test-session", { cwd: "/tmp/test" });
    adapter.onBrowserMessage((msg) => messages.push(msg));
    await waitForInit();

    transport.simulateNotification("thread/compacted", { threadId: "thr_test", turnId: "turn_x" });

    const boundaries = messages.filter((m) => m.type === "system_event" && m.event.subtype === "compact_boundary");
    expect(boundaries).toHaveLength(1);
  });

  // ── error notifications ───────────────────────────────────────────────────

  test("surfaces the nested v2 error message instead of 'Unknown error'", async () => {
    const transport = createMockTransport();
    const messages: BrowserIncomingMessage[] = [];
    const adapter = new CodexAdapter(transport, "test-session", { cwd: "/tmp/test" });
    adapter.onBrowserMessage((msg) => messages.push(msg));
    await waitForInit();

    transport.simulateNotification("error", {
      threadId: "thr_test",
      turnId: "turn_1",
      error: { message: "stream disconnected before completion", codexErrorInfo: "responseStreamDisconnected" },
      willRetry: true,
    });
    transport.simulateNotification("error", {
      threadId: "thr_test",
      turnId: "turn_1",
      error: { message: "context window exceeded", codexErrorInfo: "contextWindowExceeded" },
      willRetry: false,
    });
    transport.simulateNotification("error", { message: "legacy top-level message" });

    const errors = messages
      .filter((m): m is Extract<BrowserIncomingMessage, { type: "error" }> => m.type === "error")
      .map((m) => m.message);
    expect(errors).toEqual([
      "stream disconnected before completion (retrying)",
      "context window exceeded",
      "legacy top-level message",
    ]);
    expect(errors.some((e) => e.includes("Unknown error"))).toBe(false);
  });

  test("describeErrorNotification reads every known payload shape", () => {
    expect(describeErrorNotification({ error: { message: "nested" }, willRetry: true }))
      .toEqual({ message: "nested", willRetry: true });
    expect(describeErrorNotification({ error: { message: "nested", additionalDetails: "stack…" } }))
      .toEqual({ message: "nested", willRetry: false, details: "stack…" });
    expect(describeErrorNotification({ message: "flat" }).message).toBe("flat");
    expect(describeErrorNotification({ msg: { message: "wrapped" } }).message).toBe("wrapped");
    const empty = describeErrorNotification({ threadId: "t", turnId: "u" });
    expect(empty.message).toContain("without a message");
    expect(empty.message).toContain("\"threadId\"");
  });
});

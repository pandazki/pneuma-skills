import { describe, expect, test, mock, beforeEach } from "bun:test";
import { CodexAdapter } from "../codex-adapter.js";
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

    get _notificationHandler_actual() {
      return notificationHandler;
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
    expect(reportedMeta?.cliSessionId).toBe("thr_test");
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
});

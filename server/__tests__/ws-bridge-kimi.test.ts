/**
 * Integration test for WsBridge ↔ KimiAdapter wiring. We instantiate a real
 * KimiAdapter on top of a FakeAcpServer (no actual kimi subprocess) and
 * verify the bridge:
 *   - tracks the session as kimi
 *   - routes browser-bound user messages to the adapter as ACP session/prompt
 *   - supports the permission round trip and set_model (ACP capabilities)
 *   - cleans up on closeSession
 */

import { describe, expect, it } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WsBridge } from "../ws-bridge.js";
import { KimiAdapter } from "../../backends/kimi-cli/kimi-adapter.js";
import {
  FAKE_SESSION_ID,
  FakeAcpServer,
  tick,
} from "../../backends/kimi-cli/__tests__/fake-acp-server.js";
import type { BrowserOutgoingMessage } from "../session-types.js";

function makeAdapter(sessionId = "s1") {
  const server = new FakeAcpServer();
  const adapter = new KimiAdapter({
    sessionId,
    stdin: server.stdin,
    stdout: server.stdout,
    killProcess: async () => {},
    cwd: "/tmp/kimi-bridge-test-ws",
  });
  return { adapter, server };
}

describe("WsBridge.attachKimiAdapter", () => {
  it("registers the session as kimi and reflects it in getActiveSessionId", () => {
    const bridge = new WsBridge();
    const { adapter } = makeAdapter("s1");

    bridge.attachKimiAdapter("s1", adapter);

    expect(bridge.isKimiSession("s1")).toBe(true);
    expect(bridge.isKimiSession("other")).toBe(false);
    expect(bridge.getActiveSessionId()).toBe("s1");

    const session = bridge.getSession("s1");
    expect(session?.state.backend_type).toBe("kimi-cli");
  });

  it("routes injectGreeting to the adapter as an ACP session/prompt", async () => {
    const bridge = new WsBridge();
    const { adapter, server } = makeAdapter("s1");
    bridge.attachKimiAdapter("s1", adapter);

    bridge.injectGreeting("s1", "hello kimi");

    // The greeting rides the ACP prompt turn — a JSON-RPC session/prompt
    // frame carrying the text as a prompt content block.
    const prompt = await server.waitForMethod("session/prompt");
    expect(prompt.raw.jsonrpc).toBe("2.0");
    expect(prompt.params).toEqual({
      sessionId: FAKE_SESSION_ID,
      prompt: [{ type: "text", text: "hello kimi" }],
    });
  });

  it("flushes pendingMessages onto the adapter when attached after queueing", async () => {
    const bridge = new WsBridge();
    // Pre-create the session and queue a message before the adapter exists.
    const session = bridge.getOrCreateSession("s1", "kimi-cli");
    session.pendingMessages.push(
      JSON.stringify({
        type: "user",
        message: { role: "user", content: "queued msg" },
        parent_tool_use_id: null,
        session_id: "",
      }),
    );

    const { adapter, server } = makeAdapter("s1");
    bridge.attachKimiAdapter("s1", adapter);

    expect(session.pendingMessages.length).toBe(0);
    const prompt = await server.waitForMethod("session/prompt");
    expect(prompt.params?.prompt).toEqual([{ type: "text", text: "queued msg" }]);
  });

  it("persists the agentSessionId learned from session/new via onCLISessionId", async () => {
    const bridge = new WsBridge();
    const learned: Array<{ sessionId: string; agentSessionId: string }> = [];
    bridge.onCLISessionIdReceived((sessionId, agentSessionId) => {
      learned.push({ sessionId, agentSessionId });
    });
    const { adapter, server } = makeAdapter("s1");
    bridge.attachKimiAdapter("s1", adapter);
    await server.waitForMethod("session/new");
    await tick();
    expect(learned).toEqual([{ sessionId: "s1", agentSessionId: FAKE_SESSION_ID }]);
  });

  it("routes permission_request → browser and permission_response → ACP outcome", async () => {
    const bridge = new WsBridge();
    const { adapter, server } = makeAdapter("s1");
    bridge.attachKimiAdapter("s1", adapter);
    const session = bridge.getSession("s1")!;

    // Agent starts a Write tool and asks permission.
    server.emitUpdate({
      sessionUpdate: "tool_call",
      toolCallId: "0:tool_perm",
      title: "Write",
      kind: "edit",
      status: "pending",
    });
    const rpcId = server.requestPermission({ toolCallId: "0:tool_perm", title: "Write" });
    await tick();

    expect(session.pendingPermissions.size).toBe(1);
    const [requestId, perm] = [...session.pendingPermissions.entries()][0];
    expect(perm.tool_name).toBe("Write");
    expect(perm.tool_use_id).toBe("0:tool_perm");

    // Browser allows → adapter answers the ACP request; pending map clears.
    (bridge as unknown as { routeBrowserMessage: (s: unknown, m: unknown) => void }).routeBrowserMessage(
      session,
      { type: "permission_response", request_id: requestId, behavior: "allow" },
    );
    const resp = await server.waitForFrame((f) => f.id === rpcId && f.method === undefined);
    expect(resp.result).toEqual({ outcome: { outcome: "selected", optionId: "approve_once" } });
    expect(session.pendingPermissions.size).toBe(0);
  });

  it("routes set_model to ACP session/set_model and updates session state", async () => {
    const bridge = new WsBridge();
    const { adapter, server } = makeAdapter("s1");
    bridge.attachKimiAdapter("s1", adapter);
    const session = bridge.getSession("s1")!;
    await server.waitForMethod("session/new");
    await tick();

    (bridge as unknown as { routeBrowserMessage: (s: unknown, m: unknown) => void }).routeBrowserMessage(
      session,
      { type: "set_model", model: "moonshot-cn/kimi-k2.6" },
    );
    const frame = await server.waitForFrame((f) => f.method === "session/set_model");
    expect(frame.params).toEqual({ sessionId: FAKE_SESSION_ID, modelId: "moonshot-cn/kimi-k2.6" });
    expect(session.state.model).toBe("moonshot-cn/kimi-k2.6");
  });

  it("routes interrupt to the ACP session/cancel notification", async () => {
    const bridge = new WsBridge();
    const { adapter, server } = makeAdapter("s1");
    bridge.attachKimiAdapter("s1", adapter);
    const session = bridge.getSession("s1")!;
    await server.waitForMethod("session/new");
    await tick();

    (bridge as unknown as { routeBrowserMessage: (s: unknown, m: unknown) => void }).routeBrowserMessage(
      session,
      { type: "interrupt" },
    );
    const cancel = await server.waitForFrame((f) => f.method === "session/cancel");
    expect(cancel.id).toBeUndefined(); // notification, not a request
    expect(cancel.params).toEqual({ sessionId: FAKE_SESSION_ID });
  });

  it("closeSession disconnects the adapter and removes it from the map", () => {
    const bridge = new WsBridge();
    const { adapter } = makeAdapter("s1");
    bridge.attachKimiAdapter("s1", adapter);

    bridge.closeSession("s1");

    expect(bridge.isKimiSession("s1")).toBe(false);
    expect(bridge.getSession("s1")).toBeUndefined();
  });

  /**
   * End-to-end: a browser `user_message` carrying a file attachment should
   * (1) land on disk under `<workspace>/.pneuma/uploads/`, and (2) reach
   * the adapter's prompt with an `<uploaded-files>` block referencing that
   * path. Until 3.13.x kimi+codex bridges silently dropped `msg.files`;
   * this test exercises the polymorphic prepare path that fixed it.
   */
  it("routes uploaded files through prepareIncomingUserMessage end-to-end", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "pneuma-kimi-upload-"));
    try {
      const bridge = new WsBridge();
      bridge.setWorkspace(workspace);
      const { adapter, server } = makeAdapter("s1");
      bridge.attachKimiAdapter("s1", adapter);

      const session = bridge.getSession("s1")!;
      const fileBody = "<html>hello</html>";
      const msg: BrowserOutgoingMessage = {
        type: "user_message",
        content: "what do you see?",
        files: [
          {
            name: "page.html",
            media_type: "text/html",
            data: Buffer.from(fileBody, "utf-8").toString("base64"),
            size: fileBody.length,
          },
        ],
      };
      // routeBrowserMessage is the entry from `handleBrowserMessage`; we
      // skip the WebSocket plumbing and call it directly.
      (bridge as unknown as { routeBrowserMessage: (s: unknown, m: unknown) => void }).routeBrowserMessage(session, msg);

      // 1. File landed on disk.
      const uploadsDir = join(workspace, ".pneuma", "uploads");
      const saved = readdirSync(uploadsDir);
      expect(saved.length).toBe(1);
      expect(saved[0]).toMatch(/page\.html$/);
      expect(readFileSync(join(uploadsDir, saved[0]), "utf-8")).toBe(fileBody);

      // 2. The ACP prompt received the enriched content.
      const prompt = await server.waitForMethod("session/prompt");
      const promptBlocks = prompt.params?.prompt as Array<{ type: string; text?: string }>;
      const text = promptBlocks.find((b) => b.type === "text")?.text ?? "";
      expect(text).toContain("<uploaded-files");
      expect(text).toContain("page.html");
      expect(text).toContain("what do you see?");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});

/**
 * Kimi Code 0.38.0 started reporting context-window occupancy and the active
 * ACP session mode. These pin the whole path: ACP frame → translator →
 * adapter → bridge → session state / result envelope.
 *
 * Captured `usage_update` frames: `{used: 36350, size: 1048576}` then
 * `{used: 36680, size: 1048576}` — and, crucially, they land AFTER the
 * `session/prompt` for that turn resolves. The turn-ordering test below
 * reproduces that order rather than a convenient one.
 */
describe("WsBridge + KimiAdapter — usage & mode (Kimi Code 0.38.0)", () => {
  function route(bridge: WsBridge, session: unknown, msg: BrowserOutgoingMessage): void {
    (bridge as unknown as { routeBrowserMessage: (s: unknown, m: unknown) => void })
      .routeBrowserMessage(session, msg);
  }

  it("turns usage_update into context_used_percent on the session state", async () => {
    const bridge = new WsBridge();
    const { adapter, server } = makeAdapter("s1");
    bridge.attachKimiAdapter("s1", adapter);
    const session = bridge.getSession("s1")!;
    await server.waitForMethod("session/new");
    await tick();

    expect(session.state.context_used_percent).toBe(0);

    server.emitUpdate({ sessionUpdate: "usage_update", used: 36350, size: 1048576 });
    await tick();
    expect(session.state.context_used_percent).toBe(3);

    server.emitUpdate({ sessionUpdate: "usage_update", used: 524288, size: 1048576 });
    await tick();
    expect(session.state.context_used_percent).toBe(50);
  });

  it("carries the latest usage snapshot on the result envelope (one-turn lag is real)", async () => {
    const bridge = new WsBridge();
    const { adapter, server } = makeAdapter("s1");
    bridge.attachKimiAdapter("s1", adapter);
    const session = bridge.getSession("s1")!;
    await server.waitForMethod("session/new");
    await tick();

    // Turn 1 — no usage frame has arrived yet, so the envelope reports zeros
    // rather than a fabricated number.
    route(bridge, session, { type: "user_message", content: "remember paprika" });
    await server.waitForMethod("session/prompt");
    server.resolvePrompt("end_turn");
    await tick();

    const results = () => session.messageHistory.filter((m) => m.type === "result");
    expect(results().length).toBe(1);
    const first = results()[0] as { data: { usage: Record<string, number> } };
    expect(first.data.usage).toEqual({
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    });

    // The agent reports the turn's occupancy AFTER the prompt resolved.
    server.emitUpdate({ sessionUpdate: "usage_update", used: 36350, size: 1048576 });
    await tick();

    // Turn 2 — the envelope carries the freshest snapshot Kimi has given us.
    route(bridge, session, { type: "user_message", content: "and now?" });
    await server.waitForFrame(
      (f) => f.method === "session/prompt" && (f.params?.prompt as { text?: string }[])?.[0]?.text === "and now?",
    );
    server.resolvePrompt("end_turn");
    await tick();

    expect(results().length).toBe(2);
    const second = results()[1] as { data: { usage: Record<string, number> } };
    expect(second.data.usage).toEqual({
      // `used` is cumulative context occupancy, not a per-turn input count —
      // documented as such in backends/kimi-cli/README.md.
      input_tokens: 36350,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    });
  });

  it("leaves per-message assistant envelopes at zero usage (turn-level surface only)", async () => {
    const bridge = new WsBridge();
    const { adapter, server } = makeAdapter("s1");
    bridge.attachKimiAdapter("s1", adapter);
    const session = bridge.getSession("s1")!;
    await server.waitForMethod("session/new");
    await tick();

    server.emitUpdate({ sessionUpdate: "usage_update", used: 36350, size: 1048576 });
    route(bridge, session, { type: "user_message", content: "hi" });
    await server.waitForMethod("session/prompt");
    server.emitUpdate({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "ok" } });
    server.resolvePrompt("end_turn");
    await tick();

    const assistant = session.messageHistory.find((m) => m.type === "assistant") as
      { message: { usage: Record<string, number> } } | undefined;
    expect(assistant).toBeDefined();
    expect(assistant!.message.usage).toEqual({
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    });
  });

  it("reflects the ACP session mode on session.state.permissionMode", async () => {
    const bridge = new WsBridge();
    const { adapter, server } = makeAdapter("s1");
    bridge.attachKimiAdapter("s1", adapter);
    const session = bridge.getSession("s1")!;
    await server.waitForMethod("session/new");
    await tick(8);

    // The adapter launches with Pneuma's default posture → ACP "yolo", and
    // the agent's `current_mode_update` answer is what lands in the state.
    expect(session.state.permissionMode).toBe("bypassPermissions");

    // A user flipping the mode inside kimi is reported the same way.
    server.emitUpdate({ sessionUpdate: "current_mode_update", currentModeId: "plan" });
    await tick();
    expect(session.state.permissionMode).toBe("plan");
  });
});

/**
 * KimiAdapter tests — driven against `FakeAcpServer` (canned JSON-RPC frames
 * captured from the real Kimi Code CLI 0.26.0). Covers the ACP handshake,
 * the async session-id acquisition (replay-on-subscribe survives from the
 * old adapter — the id is still learned asynchronously and late subscribers
 * must not miss it), prompt queueing, the permission round trip,
 * `session/cancel`, `session/set_model`, and resume.
 */

import { describe, expect, it } from "bun:test";
import { KimiAdapter, mapPermissionModeToAcp } from "../kimi-adapter.js";
import type { PneumaMessage } from "../protocol.js";
import { FAKE_SESSION_ID, FakeAcpServer, tick } from "./fake-acp-server.js";

function makeAdapter(opts?: {
  failResume?: boolean;
  resumeSessionId?: string;
  model?: string;
  permissionMode?: string;
}) {
  const server = new FakeAcpServer({ failResume: opts?.failResume });
  const adapter = new KimiAdapter({
    sessionId: "test-session",
    stdin: server.stdin,
    stdout: server.stdout,
    killProcess: async () => {},
    cwd: "/tmp/kimi-test-ws",
    resumeSessionId: opts?.resumeSessionId,
    model: opts?.model,
    permissionMode: opts?.permissionMode,
  });
  return { adapter, server };
}

describe("KimiAdapter — handshake", () => {
  it("runs initialize → session/new and fires onSessionId with the RPC-returned id", async () => {
    const { adapter, server } = makeAdapter();
    const ids: string[] = [];
    adapter.onSessionId((id) => ids.push(id));

    const init = await server.waitForMethod("initialize");
    expect(init.params).toMatchObject({
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    });
    const sessionNew = await server.waitForMethod("session/new");
    expect(sessionNew.params).toMatchObject({ cwd: "/tmp/kimi-test-ws", mcpServers: [] });

    await tick();
    expect(ids).toEqual([FAKE_SESSION_ID]);
  });

  it("replays the session id to late onSessionId subscribers (bridge attaches after launch)", async () => {
    const { adapter, server } = makeAdapter();
    await server.waitForMethod("session/new");
    await tick();

    // Subscribe AFTER the id already arrived — must fire immediately, once.
    const late: string[] = [];
    adapter.onSessionId((id) => late.push(id));
    expect(late).toEqual([FAKE_SESSION_ID]);
  });

  it("surfaces agent version via onMeta and the model list via onModels", async () => {
    const { adapter, server } = makeAdapter();
    const metas: { agentVersion: string }[] = [];
    const models: { current: string; available: { id: string; name?: string }[] }[] = [];
    adapter.onMeta((m) => metas.push(m));
    adapter.onModels((m) => models.push(m));

    await server.waitForMethod("session/new");
    await tick();

    expect(metas).toEqual([{ agentVersion: "Kimi Code CLI 0.26.0" }]);
    expect(models[0]).toEqual({
      current: "kimi-code/k3",
      available: [
        { id: "kimi-code/kimi-for-coding", name: "K2.7 Coding" },
        { id: "kimi-code/k3", name: "K3" },
      ],
    });
  });

  it("applies a launch-time model via session/set_model after setup", async () => {
    const { server } = makeAdapter({ model: "kimi-code/kimi-for-coding" });
    const setModel = await server.waitForMethod("session/set_model");
    expect(setModel.params).toEqual({
      sessionId: FAKE_SESSION_ID,
      modelId: "kimi-code/kimi-for-coding",
    });
  });

  it("defaults the permission posture to the ACP yolo mode (Pneuma production posture)", async () => {
    const { server } = makeAdapter();
    const setMode = await server.waitForMethod("session/set_mode");
    expect(setMode.params).toEqual({ sessionId: FAKE_SESSION_ID, modeId: "yolo" });
  });

  it('keeps the agent\'s "default" mode when permissionMode is "default" (real permission round trip)', async () => {
    const { server } = makeAdapter({ permissionMode: "default" });
    await server.waitForMethod("session/new");
    await tick(8);
    // Session starts in "default" — no redundant set_mode call.
    expect(server.frames.find((f) => f.method === "session/set_mode")).toBeUndefined();
  });
});

describe("mapPermissionModeToAcp", () => {
  it("maps Pneuma / Claude vocabulary onto ACP session modes", () => {
    expect(mapPermissionModeToAcp(undefined)).toBe("yolo");
    expect(mapPermissionModeToAcp("bypassPermissions")).toBe("yolo");
    expect(mapPermissionModeToAcp("acceptEdits")).toBe("auto");
    expect(mapPermissionModeToAcp("plan")).toBe("plan");
    expect(mapPermissionModeToAcp("default")).toBe("default");
    // Unknown values never silently escalate to auto-approval.
    expect(mapPermissionModeToAcp("something-new")).toBe("default");
  });
});

describe("KimiAdapter — prompt turns", () => {
  it("queues messages sent before the handshake finishes and sends them as session/prompt", async () => {
    const { adapter, server } = makeAdapter();
    // Send immediately — handshake responses haven't landed yet.
    adapter.sendUserMessage("hello kimi");

    const prompt = await server.waitForMethod("session/prompt");
    expect(prompt.params).toEqual({
      sessionId: FAKE_SESSION_ID,
      prompt: [{ type: "text", text: "hello kimi" }],
    });
  });

  it("serializes turns: the second prompt is sent only after the first resolves", async () => {
    const { adapter, server } = makeAdapter();
    await server.waitForMethod("session/new");
    await tick();

    adapter.sendUserMessage("turn one");
    adapter.sendUserMessage("turn two");
    await server.waitForMethod("session/prompt");
    await tick();
    expect(server.frames.filter((f) => f.method === "session/prompt")).toHaveLength(1);

    server.resolvePrompt("end_turn");
    await tick();
    const prompts = server.frames.filter((f) => f.method === "session/prompt");
    expect(prompts).toHaveLength(2);
    expect(prompts[1].params?.prompt).toEqual([{ type: "text", text: "turn two" }]);
  });

  it("fires onTurnEnded with the real stopReason when session/prompt resolves", async () => {
    const { adapter, server } = makeAdapter();
    const ends: { stopReason: string; isError: boolean }[] = [];
    adapter.onTurnEnded((e) => ends.push(e));
    adapter.sendUserMessage("hi");
    await server.waitForMethod("session/prompt");
    server.resolvePrompt("end_turn");
    await tick();
    expect(ends).toEqual([{ stopReason: "end_turn", isError: false }]);
  });

  it("attaches image content blocks when the agent declares promptCapabilities.image", async () => {
    const { adapter, server } = makeAdapter();
    await server.waitForMethod("session/new");
    await tick();
    adapter.sendUserMessage("what is this?", [{ media_type: "image/png", data: "aGVsbG8=" }]);
    const prompt = await server.waitForMethod("session/prompt");
    expect(prompt.params?.prompt).toEqual([
      { type: "text", text: "what is this?" },
      { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
    ]);
  });

  it("translates session/update notifications into onMessage / onStreamDelta events", async () => {
    const { adapter, server } = makeAdapter();
    const messages: PneumaMessage[] = [];
    const deltas: string[] = [];
    adapter.onMessage((m) => messages.push(m));
    adapter.onStreamDelta((d) => deltas.push(d.text));

    adapter.sendUserMessage("hi");
    await server.waitForMethod("session/prompt");
    server.emitUpdate({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hello " } });
    server.emitUpdate({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "there" } });
    server.resolvePrompt("end_turn");
    await tick();

    expect(deltas).toEqual(["Hello ", "there"]);
    expect(messages).toEqual([
      { type: "assistant", content: [{ type: "text", text: "Hello there" }] },
    ]);
  });
});

describe("KimiAdapter — permission round trip", () => {
  it("surfaces session/request_permission and answers with the selected optionId", async () => {
    const { adapter, server } = makeAdapter();
    const requests: { requestId: string; toolName: string; toolUseId: string }[] = [];
    adapter.onPermissionRequest((r) => requests.push(r));

    adapter.sendUserMessage("write something");
    await server.waitForMethod("session/prompt");
    // Real ordering: tool_call start (carrying the tool name) precedes the
    // permission request.
    server.emitUpdate({
      sessionUpdate: "tool_call",
      toolCallId: "0:tool_abc",
      title: "Write",
      kind: "edit",
      status: "pending",
    });
    const rpcId = server.requestPermission({
      toolCallId: "0:tool_abc",
      title: "Write",
      content: [{ type: "content", content: { type: "text", text: "Requesting approval to Writing out.txt" } }],
    });
    await tick();

    expect(requests).toHaveLength(1);
    expect(requests[0].toolName).toBe("Write");
    expect(requests[0].toolUseId).toBe("0:tool_abc");

    adapter.respondPermission(requests[0].requestId, "allow");
    const resp = await server.waitForFrame((f) => f.id === rpcId && f.method === undefined);
    expect(resp.result).toEqual({ outcome: { outcome: "selected", optionId: "approve_once" } });
  });

  it("maps allowAlways and deny onto the matching option kinds", async () => {
    const { adapter, server } = makeAdapter();
    const requests: { requestId: string }[] = [];
    adapter.onPermissionRequest((r) => requests.push(r));
    adapter.sendUserMessage("x");
    await server.waitForMethod("session/prompt");

    const id1 = server.requestPermission({ toolCallId: "t1", title: "Write" });
    const id2 = server.requestPermission({ toolCallId: "t2", title: "Bash" });
    await tick();
    adapter.respondPermission(requests[0].requestId, "allowAlways");
    adapter.respondPermission(requests[1].requestId, "deny");

    const r1 = await server.waitForFrame((f) => f.id === id1 && f.method === undefined);
    const r2 = await server.waitForFrame((f) => f.id === id2 && f.method === undefined);
    expect(r1.result).toEqual({ outcome: { outcome: "selected", optionId: "approve_always" } });
    expect(r2.result).toEqual({ outcome: { outcome: "selected", optionId: "reject" } });
  });

  it("interrupt() sends session/cancel and answers pending permissions as cancelled", async () => {
    const { adapter, server } = makeAdapter();
    const cancelled: string[] = [];
    const requests: { requestId: string }[] = [];
    adapter.onPermissionRequest((r) => requests.push(r));
    adapter.onPermissionCancelled((id) => cancelled.push(id));

    adapter.sendUserMessage("long task");
    await server.waitForMethod("session/prompt");
    const rpcId = server.requestPermission({ toolCallId: "t1", title: "Write" });
    await tick();

    adapter.interrupt();
    const cancelFrame = await server.waitForFrame(
      (f) => f.method === "session/cancel" && f.id === undefined,
      2_000,
      "session/cancel notification",
    );
    expect(cancelFrame.params).toEqual({ sessionId: FAKE_SESSION_ID });

    // ACP contract: a cancelling client answers pending permission requests
    // with the cancelled outcome — otherwise the turn deadlocks.
    const permResp = await server.waitForFrame((f) => f.id === rpcId && f.method === undefined);
    expect(permResp.result).toEqual({ outcome: { outcome: "cancelled" } });
    expect(cancelled).toEqual([requests[0].requestId]);

    // The turn then resolves with the real cancelled stopReason.
    const ends: { stopReason: string; isError: boolean }[] = [];
    adapter.onTurnEnded((e) => ends.push(e));
    server.resolvePrompt("cancelled");
    await tick();
    expect(ends).toEqual([{ stopReason: "cancelled", isError: false }]);
  });
});

describe("KimiAdapter — model switching", () => {
  it("setModel calls session/set_model with the session id", async () => {
    const { adapter, server } = makeAdapter();
    await server.waitForMethod("session/new");
    await tick();
    await adapter.setModel("moonshot-cn/kimi-k2.6");
    const frame = server.frames.find((f) => f.method === "session/set_model");
    expect(frame?.params).toEqual({ sessionId: FAKE_SESSION_ID, modelId: "moonshot-cn/kimi-k2.6" });
  });
});

describe("KimiAdapter — resume", () => {
  it("calls session/resume (not session/new) when resuming and fires onSessionId with the resumed id", async () => {
    const { adapter, server } = makeAdapter({ resumeSessionId: FAKE_SESSION_ID });
    const ids: string[] = [];
    adapter.onSessionId((id) => ids.push(id));
    const resume = await server.waitForMethod("session/resume");
    expect(resume.params).toEqual({ sessionId: FAKE_SESSION_ID, cwd: "/tmp/kimi-test-ws" });
    await tick();
    expect(server.frames.find((f) => f.method === "session/new")).toBeUndefined();
    expect(ids).toEqual([FAKE_SESSION_ID]);
  });

  it("falls back to session/new when session/resume fails (lost session)", async () => {
    const { adapter, server } = makeAdapter({
      resumeSessionId: "session_gone",
      failResume: true,
    });
    const ids: string[] = [];
    adapter.onSessionId((id) => ids.push(id));
    await server.waitForMethod("session/resume");
    await server.waitForMethod("session/new");
    await tick();
    expect(ids).toEqual([FAKE_SESSION_ID]);
  });
});

describe("KimiAdapter — disconnect", () => {
  it("fires onDisconnect once when the transport closes (process death)", async () => {
    const { adapter, server } = makeAdapter();
    let fires = 0;
    adapter.onDisconnect(() => fires++);
    await server.waitForMethod("session/new");
    server.close();
    await tick();
    expect(fires).toBe(1);
  });

  it("fails the in-flight turn when the transport dies mid-turn", async () => {
    const { adapter, server } = makeAdapter();
    const ends: { stopReason: string; isError: boolean }[] = [];
    const errors: string[] = [];
    adapter.onTurnEnded((e) => ends.push(e));
    adapter.onError((m) => errors.push(m));
    adapter.sendUserMessage("hi");
    await server.waitForMethod("session/prompt");
    server.close();
    await tick();
    expect(ends).toEqual([{ stopReason: "error", isError: true }]);
    expect(errors.length).toBeGreaterThan(0);
  });
});

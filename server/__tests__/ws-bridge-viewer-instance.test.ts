import { describe, expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { WsBridge } from "../ws-bridge.js";
import type { BrowserSocketData, SocketData } from "../ws-bridge-types.js";
import { sendViewerActionRequest } from "../ws-bridge-viewer.js";

function fixture() {
  const bridge = new WsBridge();
  const sid = crypto.randomUUID();
  const session = bridge.getOrCreateSession(sid);
  bridge.attachCLITransport(sid, { send: () => {}, close: () => {} });
  function tab() {
    const frames: Array<Record<string, any>> = [];
    const ws = {
      data: { kind: "browser", sessionId: sid } satisfies BrowserSocketData,
      send: (raw: string) => frames.push(JSON.parse(raw)),
    } as unknown as ServerWebSocket<SocketData>;
    bridge.handleBrowserOpen(ws, sid);
    const id = crypto.randomUUID();
    const send = (msg: unknown) => bridge.handleBrowserMessage(ws, JSON.stringify(msg));
    send({ type: "viewer_instance_register", viewer_instance_id: id });
    return { ws, id, frames, send, requests: () => frames.filter((f) => f.type === "viewer_action_request") };
  }
  const a = tab();
  const b = tab();
  function complete(uuid = crypto.randomUUID()) {
    bridge.broadcastToSession(sid, { type: "result", data: { uuid } } as never);
    return uuid;
  }
  return { bridge, sid, session, a, b, complete };
}

describe("private viewer action ownership", () => {
  test("a timed-out action rejects its queued work without dispatching an uncertain continuation", async () => {
    const { session, a } = fixture();
    const timeout = globalThis.setTimeout;
    const clear = globalThis.clearTimeout;
    const deadlines: Array<() => void> = [];
    globalThis.setTimeout = ((callback: () => void) => {
      deadlines.push(callback);
      return deadlines.length;
    }) as unknown as typeof setTimeout;
    globalThis.clearTimeout = (() => {}) as typeof clearTimeout;
    try {
      const first = sendViewerActionRequest(session, "capture", undefined, a.id).catch((error: Error) => error);
      const queued = sendViewerActionRequest(session, "navigate", undefined, a.id).catch((error: Error) => error);
      expect(deadlines).toHaveLength(1);
      deadlines[0]!();
      expect((await first as Error).message).toContain("execution may have occurred");
      expect((await queued as Error).message).toContain("execution may have occurred");
      expect(a.requests()).toHaveLength(1);
      expect(session.pendingViewerActions.size).toBe(0);
      expect((await sendViewerActionRequest(session, "capture", undefined, a.id)).success).toBe(false);
      a.send({ type: "viewer_instance_register", viewer_instance_id: a.id });
      expect(a.frames.at(-1)).toMatchObject({ success: false, message: expect.stringContaining("Reload viewer") });
      const freshId = crypto.randomUUID();
      a.send({ type: "viewer_instance_register", viewer_instance_id: freshId });
      expect(a.frames.at(-1)).toMatchObject({ success: true });
      const recovered = sendViewerActionRequest(session, "capture", undefined, freshId);
      const freshRequest = a.requests().at(-1)!;
      a.send({ type: "viewer_action_response", viewer_instance_id: a.id, request_id: freshRequest.request_id, result: { success: true } });
      expect(session.pendingViewerActions.size).toBe(1);
      a.send({ type: "viewer_action_response", viewer_instance_id: freshId, request_id: freshRequest.request_id, result: { success: true } });
      expect((await recovered).success).toBe(true);
    } finally {
      globalThis.setTimeout = timeout;
      globalThis.clearTimeout = clear;
    }
  });

  test("immutable publication capture refuses the scope without dispatching to a private mount", async () => {
    const { session, a } = fixture();
    const publicationReference = { projectId: "project", workspaceId: "source", roomId: "room", publicationRevision: 1, address: { file: "index.html" } };
    const result = await sendViewerActionRequest(session, "capture", { publicationReference }, a.id);
    expect(result).toMatchObject({ success: false, message: expect.stringContaining("Immutable publication capture is unsupported") });
    expect(a.requests()).toHaveLength(0); expect(session.pendingViewerActions.size).toBe(0);
    const newerReference = { ...publicationReference, publicationRevision: 42 };
    expect((await sendViewerActionRequest(session, "capture", { publicationReference: newerReference }, a.id)).success).toBe(false);
    expect(a.requests()).toHaveLength(0);
  });

  test("rejected and duplicate steers cannot retarget the active accepted turn", () => {
    const { session, a, b } = fixture();
    a.send({ type: "user_message", content: "active turn" });
    session.state.agent_capabilities.steer = false;
    b.send({ type: "steer_message", content: "rejected steer", client_msg_id: "failed-steer" });
    expect(session.viewerTurnTargets).toEqual([a.id]);
    session.state.agent_capabilities.steer = true;
    b.send({ type: "steer_message", content: "accepted steer", client_msg_id: "accepted-steer" });
    expect(session.viewerTurnTargets).toEqual([b.id]);
    a.send({ type: "steer_message", content: "duplicate steer", client_msg_id: "accepted-steer" });
    expect(session.viewerTurnTargets).toEqual([b.id]);
  });

  test("requests to one mount execute in order instead of replacing its in-flight action", async () => {
    const { session, a } = fixture();
    const first = sendViewerActionRequest(session, "navigate", { page: "index.html" }, a.id);
    const second = sendViewerActionRequest(session, "capture", undefined, a.id);
    expect(a.requests()).toHaveLength(1);
    const firstReq = a.requests()[0];
    a.send({ type: "viewer_action_response", viewer_instance_id: a.id, request_id: firstReq.request_id, result: { success: true } });
    await first;
    expect(a.requests()).toHaveLength(2);
    const next = a.requests()[1];
    a.send({ type: "viewer_action_response", viewer_instance_id: a.id, request_id: next.request_id, result: { success: true } });
    await second;
    expect(session.pendingViewerActions.size).toBe(0);
  });

  test("an agent-only greeting does not inherit the target of a later browser turn", () => {
    const { bridge, sid, session, b, complete } = fixture();
    bridge.injectGreeting(sid, "greeting");
    b.send({ type: "user_message", content: "queued after greeting" });
    expect(session.viewerTurnTargets).toEqual([null, b.id]);
    complete();
    expect(session.viewerTurnTargets).toEqual([b.id]);
  });

  test("explicit viewer notification retains the sending mount without selection creating agent input", () => {
    const { session, b } = fixture();
    b.send({ type: "viewer_notification", notification: { type: "request", message: "user asks here", severity: "warning" } });
    expect(session.viewerTurnTargets).toEqual([b.id]);
  });

  test("default dispatch reaches only the first registered private tab; another tab cannot answer", async () => {
    const { session, a, b } = fixture();
    const response = sendViewerActionRequest(session, "capture", undefined);
    const request = a.requests()[0];
    expect(a.requests()).toHaveLength(1);
    expect(b.requests()).toHaveLength(0);
    b.send({ type: "viewer_action_response", viewer_instance_id: a.id, request_id: request.request_id, result: { success: true, data: { wrong: true } } });
    expect(session.pendingViewerActions.size).toBe(1);
    a.send({ type: "viewer_action_response", viewer_instance_id: a.id, request_id: request.request_id, result: { success: true, data: { correct: true } } });
    expect(await response).toEqual({ success: true, data: { correct: true } });
    expect(session.pendingViewerActions.size).toBe(0);
  });

  test("queued turns keep their initiating tabs and duplicate completion never advances twice", async () => {
    const { session, a, b, complete } = fixture();
    b.send({ type: "user_message", content: "first turn" });
    a.send({ type: "user_message", content: "queued turn" });
    expect(session.viewerTurnTargets).toEqual([b.id, a.id]);
    const first = sendViewerActionRequest(session, "capture", undefined);
    expect(b.requests()).toHaveLength(1);
    expect(a.requests()).toHaveLength(0);
    const req = b.requests()[0];
    b.send({ type: "viewer_action_response", viewer_instance_id: b.id, request_id: req.request_id, result: { success: true } });
    await first;
    const uuid = complete();
    complete(uuid);
    expect(session.viewerTurnTargets).toEqual([a.id]);
    const next = sendViewerActionRequest(session, "capture", undefined);
    const nextReq = a.requests()[0];
    a.send({ type: "viewer_action_response", viewer_instance_id: a.id, request_id: nextReq.request_id, result: { success: true } });
    expect(await next).toEqual({ success: true });
    complete();
    expect(session.viewerTurnTargets).toEqual([]);
  });

  test("explicit target overrides the turn target and a missing target fails without broadcasting", async () => {
    const { bridge, session, a, b } = fixture();
    a.send({ type: "user_message", content: "from A" });
    const explicit = bridge.dispatchViewerAction("capture", undefined, b.id);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const req = b.requests()[0];
    expect(req).toBeDefined();
    expect(a.requests()).toHaveLength(0);
    b.send({ type: "viewer_action_response", viewer_instance_id: b.id, request_id: req.request_id, result: { success: true } });
    await explicit;
    expect((await sendViewerActionRequest(session, "capture", undefined, crypto.randomUUID())).success).toBe(false);
    expect(b.requests()).toHaveLength(1);
  });

  test("unmount cancels pending requests and its turn cannot silently move to another browser", async () => {
    const { session, a, b } = fixture();
    a.send({ type: "user_message", content: "from A" });
    const pending = sendViewerActionRequest(session, "capture", undefined);
    const cancelled = pending.catch((error: Error) => error);
    a.send({ type: "viewer_instance_unregister", viewer_instance_id: a.id });
    expect((await cancelled as Error).message).toContain("disconnected or unmounted");
    expect(session.pendingViewerActions.size).toBe(0);
    expect((await sendViewerActionRequest(session, "capture", undefined)).success).toBe(false);
    expect(b.requests()).toHaveLength(0);
  });

  test("registration replacement and disconnect cancel the old socket's ownership", async () => {
    const { bridge, session, a, b } = fixture();
    const pending = sendViewerActionRequest(session, "capture", undefined, b.id);
    const cancelled = pending.catch((error: Error) => error);
    b.send({ type: "viewer_instance_register", viewer_instance_id: crypto.randomUUID() });
    expect((await cancelled as Error).message).toContain("disconnected or unmounted");
    const pendingA = sendViewerActionRequest(session, "capture", undefined, a.id);
    const disconnected = pendingA.catch((error: Error) => error);
    bridge.handleBrowserClose(a.ws);
    expect((await disconnected as Error).message).toContain("disconnected or unmounted");
    expect(session.pendingViewerActions.size).toBe(0);
  });

  test("another socket cannot take an existing instance ID", () => {
    const { a, b } = fixture();
    b.send({ type: "viewer_instance_register", viewer_instance_id: a.id });
    expect(b.frames.at(-1)?.success).toBe(false);
    expect((b.ws.data as BrowserSocketData).viewerInstanceId).toBe(b.id);
  });
});

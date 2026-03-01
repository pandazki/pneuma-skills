/**
 * WS Bridge Browser tests
 *
 * Tests for handleSessionSubscribe, handleSessionAck, handlePermissionResponse.
 * Uses mock WebSocket objects and sendToBrowser/sendToCLI callbacks.
 */

import { describe, test, expect } from "bun:test";
import {
  handleSessionSubscribe,
  handleSessionAck,
  handlePermissionResponse,
} from "../ws-bridge-browser.js";
import { isHistoryBackedEvent } from "../ws-bridge-replay.js";
import { makeDefaultState } from "../ws-bridge-types.js";
import type { Session, BrowserSocketData, SocketData } from "../ws-bridge-types.js";
import type { BrowserIncomingMessage } from "../session-types.js";
import type { ServerWebSocket } from "bun";

function makeDefaultSession(id = "test-session"): Session {
  return {
    id,
    cliSocket: null,
    browserSockets: new Set(),
    state: makeDefaultState(id),
    pendingPermissions: new Map(),
    pendingControlRequests: new Map(),
    messageHistory: [],
    pendingMessages: [],
    nextEventSeq: 1,
    eventBuffer: [],
    lastAckSeq: 0,
    processedClientMessageIds: [],
    processedClientMessageIdSet: new Set(),
  };
}

/** Create a mock WebSocket with BrowserSocketData */
function makeMockWs(overrides?: Partial<BrowserSocketData>): ServerWebSocket<SocketData> {
  const data: BrowserSocketData = {
    kind: "browser",
    sessionId: "test-session",
    subscribed: false,
    lastAckSeq: 0,
    ...overrides,
  };
  return { data } as unknown as ServerWebSocket<SocketData>;
}

// ── handleSessionSubscribe ──────────────────────────────────────────────────

describe("handleSessionSubscribe", () => {
  test("no-op when ws is undefined", () => {
    const session = makeDefaultSession();
    const sent: BrowserIncomingMessage[] = [];

    handleSessionSubscribe(
      session,
      undefined,
      0,
      (_ws, msg) => { sent.push(msg); },
      isHistoryBackedEvent,
    );

    expect(sent).toHaveLength(0);
  });

  test("sets subscribed=true and lastAckSeq on socket data", () => {
    const session = makeDefaultSession();
    const ws = makeMockWs();

    handleSessionSubscribe(session, ws, 5, () => {}, isHistoryBackedEvent);

    const data = ws.data as BrowserSocketData;
    expect(data.subscribed).toBe(true);
    expect(data.lastAckSeq).toBe(5);
  });

  test("clamps lastSeq to 0 for negative values", () => {
    const session = makeDefaultSession();
    const ws = makeMockWs();

    handleSessionSubscribe(session, ws, -10, () => {}, isHistoryBackedEvent);

    expect((ws.data as BrowserSocketData).lastAckSeq).toBe(0);
  });

  test("clamps NaN to 0", () => {
    const session = makeDefaultSession();
    const ws = makeMockWs();

    handleSessionSubscribe(session, ws, NaN, () => {}, isHistoryBackedEvent);

    expect((ws.data as BrowserSocketData).lastAckSeq).toBe(0);
  });

  test("clamps Infinity to 0", () => {
    const session = makeDefaultSession();
    const ws = makeMockWs();

    handleSessionSubscribe(session, ws, Infinity, () => {}, isHistoryBackedEvent);

    expect((ws.data as BrowserSocketData).lastAckSeq).toBe(0);
  });

  test("replays missed events when no gap", () => {
    const session = makeDefaultSession();
    session.nextEventSeq = 4;
    session.eventBuffer = [
      { seq: 1, message: { type: "assistant" } as any },
      { seq: 2, message: { type: "result" } as any },
      { seq: 3, message: { type: "status_change" } as any },
    ];

    const ws = makeMockWs();
    const sent: BrowserIncomingMessage[] = [];

    handleSessionSubscribe(
      session, ws, 1,
      (_ws, msg) => { sent.push(msg); },
      isHistoryBackedEvent,
    );

    // Should send event_replay with events after seq 1, then status_change
    expect(sent.some(m => m.type === "event_replay")).toBe(true);
    expect(sent.some(m => m.type === "status_change")).toBe(true);
  });

  test("sends full history when gap detected", () => {
    const session = makeDefaultSession();
    session.nextEventSeq = 100;
    session.eventBuffer = [
      { seq: 90, message: { type: "assistant" } as any },
      { seq: 91, message: { type: "result" } as any },
    ];
    session.messageHistory = [
      { type: "user_message", content: "hello", timestamp: 1 },
    ] as BrowserIncomingMessage[];

    const ws = makeMockWs();
    const sent: BrowserIncomingMessage[] = [];

    handleSessionSubscribe(
      session, ws, 50, // gap: 50 < 90 - 1
      (_ws, msg) => { sent.push(msg); },
      isHistoryBackedEvent,
    );

    // Should send message_history first
    expect(sent[0].type).toBe("message_history");
    // Should end with status_change
    expect(sent[sent.length - 1].type).toBe("status_change");
  });

  test("does nothing when already up to date", () => {
    const session = makeDefaultSession();
    session.nextEventSeq = 5;
    session.eventBuffer = [
      { seq: 3, message: { type: "assistant" } as any },
      { seq: 4, message: { type: "result" } as any },
    ];

    const ws = makeMockWs();
    const sent: BrowserIncomingMessage[] = [];

    // lastSeq=4, nextEventSeq-1=4 → already caught up
    handleSessionSubscribe(
      session, ws, 4,
      (_ws, msg) => { sent.push(msg); },
      isHistoryBackedEvent,
    );

    expect(sent).toHaveLength(0);
  });

  test("does nothing when event buffer is empty", () => {
    const session = makeDefaultSession();
    const ws = makeMockWs();
    const sent: BrowserIncomingMessage[] = [];

    handleSessionSubscribe(
      session, ws, 0,
      (_ws, msg) => { sent.push(msg); },
      isHistoryBackedEvent,
    );

    expect(sent).toHaveLength(0);
  });

  test("infers idle status from result as last history message", () => {
    const session = makeDefaultSession();
    session.nextEventSeq = 3;
    session.eventBuffer = [
      { seq: 1, message: { type: "assistant" } as any },
      { seq: 2, message: { type: "result" } as any },
    ];
    session.messageHistory = [
      { type: "result" } as BrowserIncomingMessage,
    ];

    const ws = makeMockWs();
    const sent: BrowserIncomingMessage[] = [];

    handleSessionSubscribe(
      session, ws, 0,
      (_ws, msg) => { sent.push(msg); },
      isHistoryBackedEvent,
    );

    const statusMsg = sent.find(m => m.type === "status_change");
    expect(statusMsg).toBeTruthy();
    expect((statusMsg as any).status).toBe("idle");
  });
});

// ── handleSessionAck ────────────────────────────────────────────────────────

describe("handleSessionAck", () => {
  test("updates per-socket lastAckSeq", () => {
    const session = makeDefaultSession();
    const ws = makeMockWs({ lastAckSeq: 0 });

    handleSessionAck(session, ws, 5);

    expect((ws.data as BrowserSocketData).lastAckSeq).toBe(5);
  });

  test("updates session-level lastAckSeq when higher", () => {
    const session = makeDefaultSession();
    session.lastAckSeq = 3;

    handleSessionAck(session, undefined, 5);

    expect(session.lastAckSeq).toBe(5);
  });

  test("does not decrease session-level lastAckSeq", () => {
    const session = makeDefaultSession();
    session.lastAckSeq = 10;

    handleSessionAck(session, undefined, 5);

    expect(session.lastAckSeq).toBe(10);
  });

  test("does not decrease per-socket lastAckSeq", () => {
    const session = makeDefaultSession();
    const ws = makeMockWs({ lastAckSeq: 10 });

    handleSessionAck(session, ws, 5);

    expect((ws.data as BrowserSocketData).lastAckSeq).toBe(10);
  });

  test("handles NaN by normalizing to 0", () => {
    const session = makeDefaultSession();
    session.lastAckSeq = 5;

    handleSessionAck(session, undefined, NaN);

    // 0 is not > 5, so lastAckSeq stays at 5
    expect(session.lastAckSeq).toBe(5);
  });

  test("handles Infinity by normalizing to 0", () => {
    const session = makeDefaultSession();
    session.lastAckSeq = 5;

    handleSessionAck(session, undefined, Infinity);

    // Infinity is not finite → normalized to 0
    expect(session.lastAckSeq).toBe(5);
  });
});

// ── handlePermissionResponse ────────────────────────────────────────────────

describe("handlePermissionResponse", () => {
  test("sends allow response with updatedInput from message", () => {
    const session = makeDefaultSession();
    session.pendingPermissions.set("req-1", {
      request_id: "req-1",
      tool_name: "Write",
      input: { file_path: "/tmp/test" },
      tool_use_id: "tu-1",
      timestamp: Date.now(),
    });

    let sentNdjson = "";
    const sendToCLI = (_s: Session, ndjson: string) => { sentNdjson = ndjson; };

    handlePermissionResponse(
      session,
      {
        type: "permission_response",
        request_id: "req-1",
        behavior: "allow",
        updated_input: { file_path: "/tmp/modified" },
      },
      sendToCLI,
    );

    const parsed = JSON.parse(sentNdjson);
    expect(parsed.type).toBe("control_response");
    expect(parsed.response.subtype).toBe("success");
    expect(parsed.response.response.behavior).toBe("allow");
    expect(parsed.response.response.updatedInput.file_path).toBe("/tmp/modified");
  });

  test("uses pending input as fallback when updated_input is absent", () => {
    const session = makeDefaultSession();
    session.pendingPermissions.set("req-1", {
      request_id: "req-1",
      tool_name: "Write",
      input: { file_path: "/tmp/original" },
      tool_use_id: "tu-1",
      timestamp: Date.now(),
    });

    let sentNdjson = "";
    const sendToCLI = (_s: Session, ndjson: string) => { sentNdjson = ndjson; };

    handlePermissionResponse(
      session,
      {
        type: "permission_response",
        request_id: "req-1",
        behavior: "allow",
      },
      sendToCLI,
    );

    const parsed = JSON.parse(sentNdjson);
    expect(parsed.response.response.updatedInput.file_path).toBe("/tmp/original");
  });

  test("includes updatedPermissions when provided", () => {
    const session = makeDefaultSession();
    session.pendingPermissions.set("req-1", {
      request_id: "req-1",
      tool_name: "Bash",
      input: {},
      tool_use_id: "tu-1",
      timestamp: Date.now(),
    });

    let sentNdjson = "";
    const sendToCLI = (_s: Session, ndjson: string) => { sentNdjson = ndjson; };

    handlePermissionResponse(
      session,
      {
        type: "permission_response",
        request_id: "req-1",
        behavior: "allow",
        updated_permissions: [{ type: "addRules", rules: [{ toolName: "Bash" }], behavior: "allow", destination: "session" }],
      },
      sendToCLI,
    );

    const parsed = JSON.parse(sentNdjson);
    expect(parsed.response.response.updatedPermissions).toHaveLength(1);
  });

  test("sends deny response with default message", () => {
    const session = makeDefaultSession();
    session.pendingPermissions.set("req-1", {
      request_id: "req-1",
      tool_name: "Write",
      input: {},
      tool_use_id: "tu-1",
      timestamp: Date.now(),
    });

    let sentNdjson = "";
    const sendToCLI = (_s: Session, ndjson: string) => { sentNdjson = ndjson; };

    handlePermissionResponse(
      session,
      {
        type: "permission_response",
        request_id: "req-1",
        behavior: "deny",
      },
      sendToCLI,
    );

    const parsed = JSON.parse(sentNdjson);
    expect(parsed.response.response.behavior).toBe("deny");
    expect(parsed.response.response.message).toBe("Denied by user");
  });

  test("sends deny response with custom message", () => {
    const session = makeDefaultSession();
    session.pendingPermissions.set("req-1", {
      request_id: "req-1",
      tool_name: "Write",
      input: {},
      tool_use_id: "tu-1",
      timestamp: Date.now(),
    });

    let sentNdjson = "";
    const sendToCLI = (_s: Session, ndjson: string) => { sentNdjson = ndjson; };

    handlePermissionResponse(
      session,
      {
        type: "permission_response",
        request_id: "req-1",
        behavior: "deny",
        message: "Not allowed in this directory",
      },
      sendToCLI,
    );

    const parsed = JSON.parse(sentNdjson);
    expect(parsed.response.response.message).toBe("Not allowed in this directory");
  });

  test("removes pending permission after handling", () => {
    const session = makeDefaultSession();
    session.pendingPermissions.set("req-1", {
      request_id: "req-1",
      tool_name: "Write",
      input: {},
      tool_use_id: "tu-1",
      timestamp: Date.now(),
    });

    handlePermissionResponse(
      session,
      {
        type: "permission_response",
        request_id: "req-1",
        behavior: "allow",
      },
      () => {},
    );

    expect(session.pendingPermissions.has("req-1")).toBe(false);
  });

  test("handles unknown request_id without crashing", () => {
    const session = makeDefaultSession();
    let sentNdjson = "";
    const sendToCLI = (_s: Session, ndjson: string) => { sentNdjson = ndjson; };

    // Should not throw
    handlePermissionResponse(
      session,
      {
        type: "permission_response",
        request_id: "unknown",
        behavior: "allow",
      },
      sendToCLI,
    );

    // Still sends a response (with empty updatedInput)
    const parsed = JSON.parse(sentNdjson);
    expect(parsed.response.response.behavior).toBe("allow");
  });
});

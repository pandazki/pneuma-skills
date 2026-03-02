/**
 * WS Bridge Controls tests
 *
 * Tests for handleInterrupt, sendControlRequest, handleControlResponse.
 */

import { describe, test, expect } from "bun:test";
import {
  handleInterrupt,
  sendControlRequest,
  handleControlResponse,
} from "../ws-bridge-controls.js";
import { makeDefaultState } from "../ws-bridge-types.js";
import type { Session } from "../ws-bridge-types.js";
import type { CLIControlResponseMessage } from "../session-types.js";

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
    pendingViewerActions: new Map(),
  };
}

// ── handleInterrupt ─────────────────────────────────────────────────────────

describe("handleInterrupt", () => {
  test("sends control_request with interrupt subtype", () => {
    const session = makeDefaultSession();
    let sentNdjson = "";
    const sendToCLI = (_s: Session, ndjson: string) => { sentNdjson = ndjson; };

    handleInterrupt(session, sendToCLI);

    const parsed = JSON.parse(sentNdjson);
    expect(parsed.type).toBe("control_request");
    expect(parsed.request.subtype).toBe("interrupt");
    expect(parsed.request_id).toBeTruthy();
  });

  test("generates unique request_id each time", () => {
    const session = makeDefaultSession();
    const sentIds: string[] = [];
    const sendToCLI = (_s: Session, ndjson: string) => {
      sentIds.push(JSON.parse(ndjson).request_id);
    };

    handleInterrupt(session, sendToCLI);
    handleInterrupt(session, sendToCLI);

    expect(sentIds[0]).not.toBe(sentIds[1]);
  });
});

// ── sendControlRequest ──────────────────────────────────────────────────────

describe("sendControlRequest", () => {
  test("generates valid NDJSON with control_request type", () => {
    const session = makeDefaultSession();
    let sentNdjson = "";
    const sendToCLI = (_s: Session, ndjson: string) => { sentNdjson = ndjson; };

    sendControlRequest(session, { subtype: "set_model", model: "opus" }, sendToCLI);

    const parsed = JSON.parse(sentNdjson);
    expect(parsed.type).toBe("control_request");
    expect(parsed.request.subtype).toBe("set_model");
    expect(parsed.request.model).toBe("opus");
    expect(parsed.request_id).toBeTruthy();
  });

  test("tracks pending when onResponse is provided", () => {
    const session = makeDefaultSession();
    let sentNdjson = "";
    const sendToCLI = (_s: Session, ndjson: string) => { sentNdjson = ndjson; };

    const resolve = (_: unknown) => {};
    sendControlRequest(
      session,
      { subtype: "set_model" },
      sendToCLI,
      { subtype: "set_model", resolve },
    );

    const requestId = JSON.parse(sentNdjson).request_id;
    expect(session.pendingControlRequests.has(requestId)).toBe(true);
    expect(session.pendingControlRequests.get(requestId)!.subtype).toBe("set_model");
  });

  test("does not track pending when onResponse is not provided", () => {
    const session = makeDefaultSession();
    const sendToCLI = (_s: Session, _ndjson: string) => {};

    sendControlRequest(session, { subtype: "interrupt" }, sendToCLI);

    expect(session.pendingControlRequests.size).toBe(0);
  });
});

// ── handleControlResponse ───────────────────────────────────────────────────

describe("handleControlResponse", () => {
  test("resolves pending request on success", () => {
    const session = makeDefaultSession();
    let resolvedValue: unknown = null;
    const requestId = "req-123";

    session.pendingControlRequests.set(requestId, {
      subtype: "set_model",
      resolve: (v) => { resolvedValue = v; },
    });

    const msg: CLIControlResponseMessage = {
      type: "control_response",
      response: {
        subtype: "success",
        request_id: requestId,
        response: { model: "opus" },
      },
    };

    handleControlResponse(session, msg, () => {});

    expect(resolvedValue).toEqual({ model: "opus" });
    expect(session.pendingControlRequests.has(requestId)).toBe(false);
  });

  test("logs warning and does not resolve on error subtype", () => {
    const session = makeDefaultSession();
    let resolvedValue: unknown = "not-called";
    let warnMsg = "";
    const requestId = "req-456";

    session.pendingControlRequests.set(requestId, {
      subtype: "set_model",
      resolve: (v) => { resolvedValue = v; },
    });

    const msg: CLIControlResponseMessage = {
      type: "control_response",
      response: {
        subtype: "error",
        request_id: requestId,
        error: "model not found",
      },
    };

    handleControlResponse(session, msg, (m) => { warnMsg = m; });

    expect(resolvedValue).toBe("not-called");
    expect(warnMsg).toContain("set_model failed");
    expect(warnMsg).toContain("model not found");
    expect(session.pendingControlRequests.has(requestId)).toBe(false);
  });

  test("ignores unknown request_id silently", () => {
    const session = makeDefaultSession();

    const msg: CLIControlResponseMessage = {
      type: "control_response",
      response: {
        subtype: "success",
        request_id: "unknown-id",
        response: {},
      },
    };

    // Should not throw
    handleControlResponse(session, msg, () => {});
    expect(session.pendingControlRequests.size).toBe(0);
  });

  test("resolves with empty object when response field is undefined", () => {
    const session = makeDefaultSession();
    let resolvedValue: unknown = null;
    const requestId = "req-789";

    session.pendingControlRequests.set(requestId, {
      subtype: "test",
      resolve: (v) => { resolvedValue = v; },
    });

    const msg: CLIControlResponseMessage = {
      type: "control_response",
      response: {
        subtype: "success",
        request_id: requestId,
      },
    };

    handleControlResponse(session, msg, () => {});

    expect(resolvedValue).toEqual({});
  });
});

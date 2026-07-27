/**
 * WS Bridge model-discovery tests.
 *
 * The Claude Code CLI is the authority on which models it can switch to, and
 * the only route to that list is the `initialize` control request — its
 * response carries `models[]`, while `system.init` reports just the single
 * active model. Before this wiring the picker rendered a hardcoded manifest
 * constant that silently rotted (it still offered Opus 4.7 / Sonnet 4.6 long
 * after Opus 5 and Fable shipped).
 *
 * These are behavior tests through `WsBridge`'s public surface
 * (`attachCLITransport` + `feedCLIMessage`), exercising the real control
 * request/response pipeline rather than a private helper.
 */

import { describe, expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { WsBridge } from "../ws-bridge.js";
import type { BrowserSocketData, SocketData } from "../ws-bridge-types.js";

/** A stand-in browser socket so tests can drive the real `handleBrowserMessage` entry. */
function browserWs(sessionId: string): ServerWebSocket<SocketData> {
  return {
    data: {
      kind: "browser",
      sessionId,
      subscribed: false,
      lastAckSeq: 0,
    } satisfies BrowserSocketData,
    send: () => {},
  } as unknown as ServerWebSocket<SocketData>;
}

/** Attach a recording CLI transport so we can observe what reaches the agent. */
function attachRecordingCli(bridge: WsBridge, sessionId: string): string[] {
  const sent: string[] = [];
  bridge.attachCLITransport(sessionId, {
    send: (line) => sent.push(line),
    close: () => {},
  });
  return sent;
}

/** Pull the `initialize` control request the bridge fired on attach. */
function findInitializeRequest(sent: string[]): { request_id: string } | undefined {
  for (const line of sent) {
    const msg = JSON.parse(line) as {
      type?: string;
      request_id?: string;
      request?: { subtype?: string };
    };
    if (msg.type === "control_request" && msg.request?.subtype === "initialize") {
      return { request_id: msg.request_id! };
    }
  }
  return undefined;
}

/** The CLI's answer to an `initialize` control request. */
function initializeResponse(requestId: string, response: Record<string, unknown>): string {
  return JSON.stringify({
    type: "control_response",
    response: { subtype: "success", request_id: requestId, response },
  });
}

const LIVE_MODELS = [
  { value: "default", resolvedModel: "claude-opus-5[1m]", displayName: "Default (recommended)" },
  { value: "claude-fable-5[1m]", resolvedModel: "claude-fable-5", displayName: "Fable" },
  { value: "opus", resolvedModel: "claude-opus-5", displayName: "Opus" },
];

describe("model discovery via the initialize control request", () => {
  test("asks the CLI for its model list as soon as the transport attaches", () => {
    const bridge = new WsBridge();
    const sid = "session-models";
    bridge.getOrCreateSession(sid);

    const sent = attachRecordingCli(bridge, sid);

    expect(findInitializeRequest(sent)).toBeDefined();
  });

  test("publishes the CLI's list as available_models", () => {
    const bridge = new WsBridge();
    const sid = "session-models";
    const session = bridge.getOrCreateSession(sid);
    const sent = attachRecordingCli(bridge, sid);
    const req = findInitializeRequest(sent)!;

    bridge.feedCLIMessage(sid, initializeResponse(req.request_id, {
      commands: [],
      agents: [],
      models: LIVE_MODELS,
    }));

    expect(session.state.available_models).toEqual([
      { id: "default", name: "Default (recommended)", resolvedId: "claude-opus-5[1m]" },
      { id: "claude-fable-5[1m]", name: "Fable", resolvedId: "claude-fable-5" },
      { id: "opus", name: "Opus", resolvedId: "claude-opus-5" },
    ]);
  });

  // A CLI too old to report models must leave the manifest's static
  // `defaultModels` in charge — blanking the picker would be worse than a
  // slightly stale list.
  test("leaves available_models unset when the CLI reports no list", () => {
    const bridge = new WsBridge();
    const sid = "session-old-cli";
    const session = bridge.getOrCreateSession(sid);
    const sent = attachRecordingCli(bridge, sid);
    const req = findInitializeRequest(sent)!;

    bridge.feedCLIMessage(sid, initializeResponse(req.request_id, { commands: [], agents: [] }));

    expect(session.state.available_models).toBeUndefined();
    expect(session.state.default_models?.length).toBeGreaterThan(0);
  });

  test("survives an error response without clobbering the fallback", () => {
    const bridge = new WsBridge();
    const sid = "session-error";
    const session = bridge.getOrCreateSession(sid);
    const sent = attachRecordingCli(bridge, sid);
    const req = findInitializeRequest(sent)!;

    bridge.feedCLIMessage(sid, JSON.stringify({
      type: "control_response",
      response: { subtype: "error", request_id: req.request_id, error: "unknown subtype" },
    }));

    expect(session.state.available_models).toBeUndefined();
    expect(session.state.default_models?.length).toBeGreaterThan(0);
  });
});

describe("set_model", () => {
  /**
   * The CLI accepts a top-level `{type:"set_model"}` input frame and then
   * silently drops it — verified against Claude Code 2.1.220, where the turn
   * still ran on the previous model. Only the control request takes effect,
   * so this pins the wire form, not just the resulting state.
   */
  test("goes out as a control request, not a top-level frame", () => {
    const bridge = new WsBridge();
    const sid = "session-switch";
    bridge.getOrCreateSession(sid);
    const sent = attachRecordingCli(bridge, sid);
    sent.length = 0;

    bridge.handleBrowserMessage(browserWs(sid), JSON.stringify({ type: "set_model", model: "haiku" }));

    const frames = sent.map((l) => JSON.parse(l) as {
      type?: string;
      request?: { subtype?: string; model?: string };
    });
    expect(frames.some((f) => f.type === "set_model")).toBe(false);
    expect(frames).toContainEqual(
      expect.objectContaining({
        type: "control_request",
        request: { subtype: "set_model", model: "haiku" },
      }),
    );
  });

  test("updates the reported model optimistically", () => {
    const bridge = new WsBridge();
    const sid = "session-switch";
    const session = bridge.getOrCreateSession(sid);
    attachRecordingCli(bridge, sid);
    session.state.model = "claude-opus-5";

    bridge.handleBrowserMessage(browserWs(sid), JSON.stringify({ type: "set_model", model: "haiku" }));

    expect(session.state.model).toBe("haiku");
  });

  test("snaps back to the previous model when the CLI rejects the switch", () => {
    const bridge = new WsBridge();
    const sid = "session-switch";
    const session = bridge.getOrCreateSession(sid);
    const sent = attachRecordingCli(bridge, sid);
    session.state.model = "claude-opus-5";
    sent.length = 0;

    bridge.handleBrowserMessage(browserWs(sid), JSON.stringify({ type: "set_model", model: "bogus" }));
    const reqId = (JSON.parse(sent.find((l) => l.includes("set_model"))!) as { request_id: string })
      .request_id;

    bridge.feedCLIMessage(sid, JSON.stringify({
      type: "control_response",
      response: { subtype: "error", request_id: reqId, error: "unknown model" },
    }));

    expect(session.state.model).toBe("claude-opus-5");
  });
});

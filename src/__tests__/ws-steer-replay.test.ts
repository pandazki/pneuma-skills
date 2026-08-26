import { beforeEach, describe, expect, test } from "bun:test";
import { useStore } from "../store/index.js";

describe("steer acknowledgement replay", () => {
  beforeEach(() => {
    useStore.setState({
      messages: [],
      pendingMessages: [{
        id: "queued-replay",
        kind: "user",
        text: "already accepted guidance",
      }],
      pendingSteerIds: new Set(["queued-replay"]),
      connectionStatus: "disconnected",
      sessionStatus: "running",
      turnInProgress: true,
    });
  });

  test("canonical history plus replayed success renders the steered user message once", async () => {
    const { handleParsedMessage } = await import("../ws.js");
    handleParsedMessage({
      type: "message_history",
      messages: [{
        type: "user_message",
        id: "history-steer",
        content: "already accepted guidance",
        timestamp: 100,
      }],
    });

    handleParsedMessage({
      type: "event_replay",
      events: [{
        seq: 1_000_000,
        message: {
          type: "steer_result",
          client_msg_id: "queued-replay",
          success: true,
        },
      }],
    });

    const state = useStore.getState();
    expect(state.messages.filter((message) => message.role === "user")).toHaveLength(1);
    expect(state.pendingMessages).toHaveLength(0);
    expect(state.pendingSteerIds.has("queued-replay")).toBe(false);
  });

  test("turn completion cannot auto-flush a queue item while its steer ack is pending", async () => {
    const { handleParsedMessage } = await import("../ws.js");
    useStore.setState({
      messages: [],
      pendingMessages: [{ id: "queued-race", kind: "user", text: "race guidance" }],
      pendingSteerIds: new Set(["queued-race"]),
      connectionStatus: "connected",
      sessionStatus: "running",
      turnInProgress: true,
    });

    handleParsedMessage({
      type: "result",
      data: {
        type: "result",
        subtype: "success",
        is_error: false,
        duration_ms: 1,
        duration_api_ms: 1,
        num_turns: 1,
        result: "done",
        total_cost_usd: 0,
        stop_reason: null,
        uuid: "result-race",
        session_id: "session-race",
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(useStore.getState().pendingMessages.map((message) => message.id)).toEqual(["queued-race"]);
    expect(useStore.getState().connectionStatus).toBe("connected");

    handleParsedMessage({
      type: "steer_result",
      client_msg_id: "queued-race",
      success: true,
    });
    expect(useStore.getState().pendingMessages).toHaveLength(0);
  });

  test("a refusal Pneuma decided itself is worded by the browser, not the server", async () => {
    const { handleParsedMessage } = await import("../ws.js");
    useStore.setState({
      messages: [],
      pendingMessages: [{ id: "queued-refused", kind: "user", text: "too late" }],
      pendingSteerIds: new Set(["queued-refused"]),
      connectionStatus: "connected",
      sessionStatus: "running",
      turnInProgress: true,
    });

    handleParsedMessage({
      type: "steer_result",
      client_msg_id: "queued-refused",
      success: false,
      error: "There is no active agent turn to steer.",
      reason: "no-active-turn",
    });

    const system = useStore.getState().messages.find((message) => message.role === "system");
    // The `reason` code drives the sentence so it can be translated; the
    // server's English `error` is only the fallback for transport failures.
    expect(system?.content).toBe("Steer-in failed: there is no active agent turn to steer");
  });

  test("a transport failure keeps the message the transport actually gave", async () => {
    const { handleParsedMessage } = await import("../ws.js");
    useStore.setState({
      messages: [],
      pendingMessages: [{ id: "queued-transport", kind: "user", text: "guidance" }],
      pendingSteerIds: new Set(["queued-transport"]),
      connectionStatus: "connected",
      sessionStatus: "running",
      turnInProgress: true,
    });

    handleParsedMessage({
      type: "steer_result",
      client_msg_id: "queued-transport",
      success: false,
      error: "socket closed",
      reason: "transport-error",
    });

    const system = useStore.getState().messages.find((message) => message.role === "system");
    expect(system?.content).toBe("Steer-in failed: socket closed");
  });

  test("durable history reconciles the queue even when steer_result aged out", async () => {
    const { handleParsedMessage } = await import("../ws.js");

    handleParsedMessage({
      type: "message_history",
      messages: [{
        type: "user_message",
        id: "steer-queued-replay",
        client_msg_id: "queued-replay",
        content: "already accepted guidance",
        timestamp: 100,
      }],
    });

    const state = useStore.getState();
    expect(state.pendingMessages).toHaveLength(0);
    expect(state.pendingSteerIds.has("queued-replay")).toBe(false);
    expect(state.messages.filter((message) => message.role === "user")).toHaveLength(1);
  });

  test("live success appends one user bubble and removes the selected row", async () => {
    const { handleParsedMessage } = await import("../ws.js");

    handleParsedMessage({
      type: "steer_result",
      client_msg_id: "queued-replay",
      success: true,
    });

    const state = useStore.getState();
    expect(state.messages).toEqual([expect.objectContaining({
      id: "steer-queued-replay",
      role: "user",
      content: "already accepted guidance",
    })]);
    expect(state.pendingMessages).toHaveLength(0);
  });

  test("live failure shows an error while leaving the row retryable", async () => {
    const { handleParsedMessage } = await import("../ws.js");

    handleParsedMessage({
      type: "steer_result",
      client_msg_id: "queued-replay",
      success: false,
      error: "active turn changed",
    });

    const state = useStore.getState();
    expect(state.pendingMessages.map((message) => message.id)).toEqual(["queued-replay"]);
    expect(state.pendingSteerIds.has("queued-replay")).toBe(false);
    expect(state.messages).toEqual([expect.objectContaining({
      id: "steer-error-queued-replay",
      role: "system",
      content: "Steer-in failed: active turn changed",
    })]);
  });
});

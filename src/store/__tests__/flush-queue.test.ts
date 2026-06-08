import { describe, expect, test, beforeEach, mock } from "bun:test";

// Record what the flush subscriber would send, without loading the real
// WS transport. The flush does a dynamic `import("../ws.js")`; mock.module
// intercepts it (resolved to the same src/ws.js module the subscriber loads).
const sent: string[] = [];
// `delivered` models whether the socket carried the message. The flush relies
// on the boolean return to recover (requeue) when a send is dropped.
let delivered = true;
mock.module("../../ws.js", () => ({
  sendUserMessage: (text: string) => { if (delivered) sent.push(text); return delivered; },
  sendViewerNotification: () => delivered,
}));

// Import AFTER the mock is registered so the lazy import picks it up.
const { useStore } = await import("../index.js");

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("pending-queue flush with multiple queued messages", () => {
  beforeEach(() => {
    sent.length = 0;
    delivered = true;
    useStore.setState({
      pendingMessages: [],
      sessionStatus: "idle",
      turnInProgress: false,
      connectionStatus: "connected",
    });
  });

  test("flushes each queued message in order as the prior turn completes", async () => {
    const s = useStore.getState();

    // Agent is mid-turn; user queues two messages behind it.
    useStore.setState({ sessionStatus: "running", turnInProgress: true });
    s.addPendingMessage({ text: "A" });
    s.addPendingMessage({ text: "B" });
    expect(useStore.getState().pendingMessages).toHaveLength(2);

    // Current turn completes → first queued message should flush.
    useStore.getState().setSessionStatus("idle");
    useStore.getState().setTurnInProgress(false);
    await tick();

    expect(sent).toEqual(["A"]);
    expect(useStore.getState().pendingMessages).toHaveLength(1); // B still waiting
    expect(useStore.getState().turnInProgress).toBe(true);       // busy on A's turn

    // A's turn completes → second queued message should flush.
    useStore.getState().setSessionStatus("idle");
    useStore.getState().setTurnInProgress(false);
    await tick();

    expect(sent).toEqual(["A", "B"]);
    expect(useStore.getState().pendingMessages).toHaveLength(0);
  });

  test("does not strand the queue or freeze on busy when the socket is disconnected", async () => {
    const s = useStore.getState();

    // Agent finished its turn, but the browser socket dropped (reconnecting).
    useStore.setState({ sessionStatus: "idle", turnInProgress: false, connectionStatus: "disconnected" });
    s.addPendingMessage({ text: "A" });
    await tick();

    // The message must stay queued and the UI must NOT be marked busy —
    // flushing here would shift it out and drop it on a closed socket.
    expect(sent).toEqual([]);
    expect(useStore.getState().pendingMessages).toHaveLength(1);
    expect(useStore.getState().turnInProgress).toBe(false);

    // Socket reconnects → the queued message flushes on its own.
    useStore.getState().setConnectionStatus("connected");
    await tick();

    expect(sent).toEqual(["A"]);
    expect(useStore.getState().pendingMessages).toHaveLength(0);
    expect(useStore.getState().turnInProgress).toBe(true);
  });

  test("requeues and settles to idle when the send is dropped mid-flight", async () => {
    const s = useStore.getState();

    // Connected per the gate, but the actual transmission fails (socket closed
    // in the narrow window between the check and the send).
    delivered = false;
    useStore.setState({ sessionStatus: "running", turnInProgress: true });
    s.addPendingMessage({ text: "A" });
    useStore.getState().setSessionStatus("idle");
    useStore.getState().setTurnInProgress(false);
    await tick();

    // Not lost, not stuck busy: back in the queue, settled to idle, and the
    // connection marked down so it can't hot-loop retrying a dead socket.
    expect(sent).toEqual([]);
    expect(useStore.getState().pendingMessages).toHaveLength(1);
    expect(useStore.getState().turnInProgress).toBe(false);
    expect(useStore.getState().connectionStatus).toBe("disconnected");

    // Socket recovers → reconnect edge flushes the still-queued message.
    delivered = true;
    useStore.getState().setConnectionStatus("connected");
    await tick();

    expect(sent).toEqual(["A"]);
    expect(useStore.getState().pendingMessages).toHaveLength(0);
  });
});

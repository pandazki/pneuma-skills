/**
 * WS Bridge system-signal queue tests (design §13.2).
 *
 * The borrow return-leg must poke host session A with a
 * `<pneuma:borrow-returned>` tag at a turn boundary — never mid-turn — and the
 * existing `pendingNotifications` queue is viewer-only (it carries
 * `{ type, message, severity }` and flushes via `sendViewerNotificationToCLI`).
 * So a sibling `pendingSystemSignals` queue rides the SAME idle gate: queued
 * while the CLI is busy, flushed when the turn's `result` message lands.
 *
 * These are behavior tests through `WsBridge`'s public surface
 * (`attachCLITransport` + `enqueueSystemSignal` + `feedCLIMessage`) — they
 * exercise the real CLI message pipeline, not a private flush method.
 */

import { describe, expect, test } from "bun:test";
import { WsBridge } from "../ws-bridge.js";

/** Attach a recording CLI transport so we can observe what reaches the agent. */
function attachRecordingCli(bridge: WsBridge, sessionId: string): string[] {
  const sent: string[] = [];
  bridge.attachCLITransport(sessionId, {
    send: (line) => sent.push(line),
    close: () => {},
  });
  return sent;
}

/** The NDJSON `result` frame the CLI emits at the end of a turn. */
function resultFrame(sessionId: string): string {
  return JSON.stringify({
    type: "result",
    subtype: "success",
    total_cost_usd: 0,
    num_turns: 1,
    session_id: sessionId,
  });
}

describe("enqueueSystemSignal", () => {
  test("dispatches immediately when the CLI is idle", () => {
    const bridge = new WsBridge();
    const sid = "host-A";
    bridge.getOrCreateSession(sid);
    const sent = attachRecordingCli(bridge, sid);

    bridge.enqueueSystemSignal(sid, "<pneuma:borrow-returned borrow_id=\"brw-1\" />");

    const userFrames = sent
      .map((l) => JSON.parse(l) as { type?: string; message?: { content?: string } })
      .filter((m) => m.type === "user");
    expect(userFrames).toHaveLength(1);
    expect(userFrames[0].message?.content).toContain("<pneuma:borrow-returned");
  });

  test("queues while the CLI is busy and flushes on the next turn boundary", () => {
    const bridge = new WsBridge();
    const sid = "host-A";
    const session = bridge.getOrCreateSession(sid);
    const sent = attachRecordingCli(bridge, sid);

    // Simulate a turn in progress.
    session.cliIdle = false;

    bridge.enqueueSystemSignal(sid, "<pneuma:borrow-returned borrow_id=\"brw-1\" />");

    // Nothing reaches the agent mid-turn.
    const midTurn = sent
      .map((l) => JSON.parse(l) as { type?: string })
      .filter((m) => m.type === "user");
    expect(midTurn).toHaveLength(0);

    // Turn completes — the result frame is the idle gate.
    bridge.feedCLIMessage(sid, resultFrame(sid));

    const flushed = sent
      .map((l) => JSON.parse(l) as { type?: string; message?: { content?: string } })
      .filter((m) => m.type === "user");
    expect(flushed).toHaveLength(1);
    expect(flushed[0].message?.content).toContain("<pneuma:borrow-returned");
  });

  test("does not starve the viewer-notification queue (both flush on idle)", () => {
    const bridge = new WsBridge();
    const sid = "host-A";
    const session = bridge.getOrCreateSession(sid);
    const sent = attachRecordingCli(bridge, sid);

    session.cliIdle = false;
    // A viewer notification is queued the existing way…
    session.pendingNotifications.push({
      type: "selection",
      message: "user selected slide 3",
      severity: "warning",
    });
    // …and a system signal arrives too.
    bridge.enqueueSystemSignal(sid, "<pneuma:borrow-returned borrow_id=\"brw-1\" />");

    // First turn boundary flushes one queued item; a second boundary the other.
    bridge.feedCLIMessage(sid, resultFrame(sid));
    bridge.feedCLIMessage(sid, resultFrame(sid));

    const userContents = sent
      .map((l) => JSON.parse(l) as { type?: string; message?: { content?: string } })
      .filter((m) => m.type === "user")
      .map((m) => m.message?.content ?? "");
    expect(userContents.some((c) => c.includes("<pneuma:borrow-returned"))).toBe(true);
    expect(userContents.some((c) => c.includes("user selected slide 3"))).toBe(true);
  });
});

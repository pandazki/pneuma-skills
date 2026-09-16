/**
 * `system.status` normalisation on the Claude Code path.
 *
 * The CLI's status vocabulary is wider than the browser's. Claude Code 2.1.273
 * emits `{"type":"system","subtype":"status","status":"requesting"}` at the
 * start of every API request (after the user message, after each tool result),
 * and the browser union only knows `compacting` / `idle` / `running` / `null`.
 * The bridge used to forward the raw value, so `requesting` (and the `null`
 * that ends a compaction) fell through the frontend's `StatusDot` mapping to
 * the idle label — the root pill read "Idle" for the whole turn.
 *
 * The seam is the bridge: `compacting` stays `compacting`, everything else
 * folds into running/idle from the authoritative `session.cliIdle` flag. These
 * are behaviour tests through `WsBridge`'s public surface
 * (`attachCLITransport` + `feedCLIMessage`) with a recording browser socket.
 */

import { describe, expect, test } from "bun:test";
import { WsBridge } from "../ws-bridge.js";
import type { SocketData } from "../ws-bridge-types.js";
import type { BrowserIncomingMessage } from "../session-types.js";
import type { ServerWebSocket } from "bun";

const SID = "claude-status";

/** A `ServerWebSocket`-shaped stub: `broadcastToBrowsers` only ever calls `send`. */
function attachRecordingBrowser(bridge: WsBridge, sessionId: string) {
  const frames: BrowserIncomingMessage[] = [];
  const ws = {
    data: { kind: "browser", sessionId } as SocketData,
    send: (raw: string) => frames.push(JSON.parse(raw) as BrowserIncomingMessage),
    close: () => {},
  } as unknown as ServerWebSocket<SocketData>;
  bridge.getOrCreateSession(sessionId).browserSockets.add(ws);
  return { frames, ws };
}

function bridgeWithCli(sessionId = SID) {
  const bridge = new WsBridge();
  const session = bridge.getOrCreateSession(sessionId);
  const { frames } = attachRecordingBrowser(bridge, sessionId);
  bridge.attachCLITransport(sessionId, { send: () => {}, close: () => {} });
  return { bridge, session, frames };
}

/** One `system.status` frame as the CLI emits it. */
function statusFrame(status: string | null, permissionMode?: string): string {
  return JSON.stringify({
    type: "system",
    subtype: "status",
    status,
    ...(permissionMode ? { permissionMode } : {}),
    uuid: "u-status",
    session_id: SID,
  });
}

function statusChanges(frames: BrowserIncomingMessage[]) {
  return frames
    .filter((f): f is Extract<BrowserIncomingMessage, { type: "status_change" }> => f.type === "status_change")
    .map((f) => f.status);
}

describe("system.status → status_change", () => {
  test("`requesting` mid-turn reads as running, not idle", () => {
    const { bridge, session, frames } = bridgeWithCli();
    // A turn is in flight: the user message already flipped the idle flag.
    session.cliIdle = false;

    bridge.feedCLIMessage(SID, statusFrame("requesting"));

    expect(statusChanges(frames)).toEqual(["running"]);
    expect(session.state.is_compacting).toBe(false);
  });

  test("`requesting` while the CLI is idle reads as idle", () => {
    const { bridge, session, frames } = bridgeWithCli();
    expect(session.cliIdle).toBe(true);

    bridge.feedCLIMessage(SID, statusFrame("requesting"));

    expect(statusChanges(frames)).toEqual(["idle"]);
  });

  test("`compacting` passes through and sets is_compacting", () => {
    const { bridge, session, frames } = bridgeWithCli();
    session.cliIdle = false;

    bridge.feedCLIMessage(SID, statusFrame("compacting"));

    expect(statusChanges(frames)).toEqual(["compacting"]);
    expect(session.state.is_compacting).toBe(true);
  });

  test("`null` after compacting mid-turn returns to running and clears is_compacting", () => {
    const { bridge, session, frames } = bridgeWithCli();
    session.cliIdle = false;

    bridge.feedCLIMessage(SID, statusFrame("compacting"));
    bridge.feedCLIMessage(SID, statusFrame(null));

    expect(statusChanges(frames)).toEqual(["compacting", "running"]);
    expect(session.state.is_compacting).toBe(false);
  });

  test("`null` while the CLI is idle reads as idle", () => {
    const { bridge, frames } = bridgeWithCli();

    bridge.feedCLIMessage(SID, statusFrame(null));

    expect(statusChanges(frames)).toEqual(["idle"]);
  });

  test("an unknown future status still folds into running/idle", () => {
    const { bridge, session, frames } = bridgeWithCli();
    session.cliIdle = false;

    bridge.feedCLIMessage(SID, statusFrame("some-future-phase"));

    expect(statusChanges(frames)).toEqual(["running"]);
  });

  test("`permissionMode` on the frame still updates session state", () => {
    const { bridge, session, frames } = bridgeWithCli();
    session.cliIdle = false;

    bridge.feedCLIMessage(SID, statusFrame("requesting", "acceptEdits"));

    expect(session.state.permissionMode).toBe("acceptEdits");
    expect(statusChanges(frames)).toEqual(["running"]);
  });
});

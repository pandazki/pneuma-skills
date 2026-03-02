/**
 * WS Bridge Replay tests
 *
 * All pure functions — tested with mock Session objects.
 */

import { describe, test, expect } from "bun:test";
import {
  isDuplicateClientMessage,
  rememberClientMessage,
  shouldBufferForReplay,
  isHistoryBackedEvent,
  sequenceEvent,
} from "../ws-bridge-replay.js";
import { makeDefaultState } from "../ws-bridge-types.js";
import type { Session } from "../ws-bridge-types.js";
import type { BrowserIncomingMessage, ReplayableBrowserIncomingMessage } from "../session-types.js";

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

// ── isDuplicateClientMessage ────────────────────────────────────────────────

describe("isDuplicateClientMessage", () => {
  test("returns false for unseen message id", () => {
    const session = makeDefaultSession();
    expect(isDuplicateClientMessage(session, "msg-1")).toBe(false);
  });

  test("returns true for previously seen message id", () => {
    const session = makeDefaultSession();
    session.processedClientMessageIdSet.add("msg-1");
    expect(isDuplicateClientMessage(session, "msg-1")).toBe(true);
  });

  test("returns false for different message id", () => {
    const session = makeDefaultSession();
    session.processedClientMessageIdSet.add("msg-1");
    expect(isDuplicateClientMessage(session, "msg-2")).toBe(false);
  });
});

// ── rememberClientMessage ───────────────────────────────────────────────────

describe("rememberClientMessage", () => {
  test("adds message id to list and set", () => {
    const session = makeDefaultSession();
    rememberClientMessage(session, "msg-1", 100);

    expect(session.processedClientMessageIds).toContain("msg-1");
    expect(session.processedClientMessageIdSet.has("msg-1")).toBe(true);
  });

  test("evicts overflow entries when over limit", () => {
    const session = makeDefaultSession();
    const limit = 3;

    rememberClientMessage(session, "msg-1", limit);
    rememberClientMessage(session, "msg-2", limit);
    rememberClientMessage(session, "msg-3", limit);
    rememberClientMessage(session, "msg-4", limit);

    // msg-1 should be evicted
    expect(session.processedClientMessageIdSet.has("msg-1")).toBe(false);
    expect(session.processedClientMessageIds).not.toContain("msg-1");

    // msg-2, msg-3, msg-4 should remain
    expect(session.processedClientMessageIds).toEqual(["msg-2", "msg-3", "msg-4"]);
    expect(session.processedClientMessageIdSet.size).toBe(3);
  });

  test("evicts multiple overflow entries at once", () => {
    const session = makeDefaultSession();
    // Pre-populate with 5 entries
    for (let i = 1; i <= 5; i++) {
      session.processedClientMessageIds.push(`msg-${i}`);
      session.processedClientMessageIdSet.add(`msg-${i}`);
    }
    // Limit is 3, currently 5 → adding one more means 6, evict 3
    rememberClientMessage(session, "msg-6", 3);

    expect(session.processedClientMessageIds).toEqual(["msg-4", "msg-5", "msg-6"]);
    expect(session.processedClientMessageIdSet.size).toBe(3);
  });
});

// ── shouldBufferForReplay ───────────────────────────────────────────────────

describe("shouldBufferForReplay", () => {
  test("returns true for assistant message", () => {
    const msg = { type: "assistant" } as BrowserIncomingMessage;
    expect(shouldBufferForReplay(msg)).toBe(true);
  });

  test("returns true for result message", () => {
    const msg = { type: "result" } as BrowserIncomingMessage;
    expect(shouldBufferForReplay(msg)).toBe(true);
  });

  test("returns true for status_change message", () => {
    const msg = { type: "status_change" } as BrowserIncomingMessage;
    expect(shouldBufferForReplay(msg)).toBe(true);
  });

  test("returns true for error message", () => {
    const msg = { type: "error" } as BrowserIncomingMessage;
    expect(shouldBufferForReplay(msg)).toBe(true);
  });

  test("returns true for content_update message", () => {
    const msg = { type: "content_update" } as BrowserIncomingMessage;
    expect(shouldBufferForReplay(msg)).toBe(true);
  });

  test("returns false for session_init message", () => {
    const msg = { type: "session_init" } as BrowserIncomingMessage;
    expect(shouldBufferForReplay(msg)).toBe(false);
  });

  test("returns false for message_history message", () => {
    const msg = { type: "message_history" } as BrowserIncomingMessage;
    expect(shouldBufferForReplay(msg)).toBe(false);
  });

  test("returns false for event_replay message", () => {
    const msg = { type: "event_replay" } as BrowserIncomingMessage;
    expect(shouldBufferForReplay(msg)).toBe(false);
  });
});

// ── isHistoryBackedEvent ────────────────────────────────────────────────────

describe("isHistoryBackedEvent", () => {
  test("returns true for assistant message", () => {
    const msg = { type: "assistant" } as ReplayableBrowserIncomingMessage;
    expect(isHistoryBackedEvent(msg)).toBe(true);
  });

  test("returns true for result message", () => {
    const msg = { type: "result" } as ReplayableBrowserIncomingMessage;
    expect(isHistoryBackedEvent(msg)).toBe(true);
  });

  test("returns true for user_message", () => {
    const msg = { type: "user_message" } as ReplayableBrowserIncomingMessage;
    expect(isHistoryBackedEvent(msg)).toBe(true);
  });

  test("returns true for system_event (non-hook_progress)", () => {
    const msg = {
      type: "system_event",
      event: { subtype: "compact_boundary" },
    } as ReplayableBrowserIncomingMessage;
    expect(isHistoryBackedEvent(msg)).toBe(true);
  });

  test("returns true for error message", () => {
    const msg = { type: "error" } as ReplayableBrowserIncomingMessage;
    expect(isHistoryBackedEvent(msg)).toBe(true);
  });

  test("returns false for system_event with hook_progress subtype", () => {
    const msg = {
      type: "system_event",
      event: { subtype: "hook_progress" },
    } as ReplayableBrowserIncomingMessage;
    expect(isHistoryBackedEvent(msg)).toBe(false);
  });

  test("returns false for status_change", () => {
    const msg = { type: "status_change" } as ReplayableBrowserIncomingMessage;
    expect(isHistoryBackedEvent(msg)).toBe(false);
  });

  test("returns false for stream_event", () => {
    const msg = { type: "stream_event" } as ReplayableBrowserIncomingMessage;
    expect(isHistoryBackedEvent(msg)).toBe(false);
  });

  test("returns false for content_update", () => {
    const msg = { type: "content_update" } as ReplayableBrowserIncomingMessage;
    expect(isHistoryBackedEvent(msg)).toBe(false);
  });

  test("returns false for tool_progress", () => {
    const msg = { type: "tool_progress" } as ReplayableBrowserIncomingMessage;
    expect(isHistoryBackedEvent(msg)).toBe(false);
  });
});

// ── sequenceEvent ───────────────────────────────────────────────────────────

describe("sequenceEvent", () => {
  test("assigns incrementing seq numbers", () => {
    const session = makeDefaultSession();

    const msg1 = { type: "assistant" } as BrowserIncomingMessage;
    const msg2 = { type: "result" } as BrowserIncomingMessage;

    const seq1 = sequenceEvent(session, msg1, 100);
    const seq2 = sequenceEvent(session, msg2, 100);

    expect(seq1.seq).toBe(1);
    expect(seq2.seq).toBe(2);
    expect(session.nextEventSeq).toBe(3);
  });

  test("buffers replayable events", () => {
    const session = makeDefaultSession();
    const msg = { type: "assistant" } as BrowserIncomingMessage;

    sequenceEvent(session, msg, 100);

    expect(session.eventBuffer).toHaveLength(1);
    expect(session.eventBuffer[0].seq).toBe(1);
  });

  test("does not buffer non-replayable events (session_init)", () => {
    const session = makeDefaultSession();
    const msg = { type: "session_init" } as BrowserIncomingMessage;

    sequenceEvent(session, msg, 100);

    expect(session.eventBuffer).toHaveLength(0);
  });

  test("does not buffer event_replay messages", () => {
    const session = makeDefaultSession();
    const msg = { type: "event_replay" } as BrowserIncomingMessage;

    sequenceEvent(session, msg, 100);

    expect(session.eventBuffer).toHaveLength(0);
  });

  test("evicts overflow from event buffer", () => {
    const session = makeDefaultSession();
    const limit = 3;

    for (let i = 0; i < 5; i++) {
      sequenceEvent(session, { type: "assistant" } as BrowserIncomingMessage, limit);
    }

    expect(session.eventBuffer).toHaveLength(3);
    // Should keep the last 3 (seq 3, 4, 5)
    expect(session.eventBuffer[0].seq).toBe(3);
    expect(session.eventBuffer[2].seq).toBe(5);
  });

  test("returns message with seq property added", () => {
    const session = makeDefaultSession();
    const msg = { type: "error", message: "test" } as BrowserIncomingMessage;

    const result = sequenceEvent(session, msg, 100);

    expect(result.seq).toBe(1);
    expect((result as any).type).toBe("error");
    expect((result as any).message).toBe("test");
  });

  test("does not mutate original message", () => {
    const session = makeDefaultSession();
    const msg = { type: "assistant" } as BrowserIncomingMessage;

    sequenceEvent(session, msg, 100);

    expect((msg as any).seq).toBeUndefined();
  });
});

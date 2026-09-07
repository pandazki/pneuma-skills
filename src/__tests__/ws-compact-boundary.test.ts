import { beforeEach, describe, expect, test } from "bun:test";
import { useStore } from "../store/index.js";

/**
 * The chat's compaction marker. Claude Code's `system.compact_boundary` and
 * the Codex adapter's synthesised twin both arrive as one `system_event`;
 * live and replayed paths must produce the same `subtype: "compact"` entry.
 */
describe("compaction boundary echo", () => {
  beforeEach(() => {
    useStore.setState({ messages: [] });
  });

  test("a live compact_boundary becomes one compact marker", async () => {
    const { handleParsedMessage } = await import("../ws.js");
    handleParsedMessage({
      type: "system_event",
      event: {
        subtype: "compact_boundary",
        compact_metadata: { trigger: "manual", pre_tokens: 142_000 },
        uuid: "u-1",
        session_id: "s-1",
      },
      timestamp: 1_700_000_000_000,
    });

    const messages = useStore.getState().messages;
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("system");
    expect(messages[0].subtype).toBe("compact");
    expect(messages[0].compaction).toEqual({ trigger: "manual", preTokens: 142_000 });
    expect(messages[0].timestamp).toBe(1_700_000_000_000);
  });

  test("history replay rebuilds the marker; a missing trigger reads as auto", async () => {
    const { handleParsedMessage } = await import("../ws.js");
    handleParsedMessage({
      type: "message_history",
      messages: [
        { type: "user_message", id: "u1", content: "/compact", timestamp: 100 },
        {
          type: "system_event",
          event: { subtype: "compact_boundary", compact_metadata: { trigger: "auto", pre_tokens: 0 }, uuid: "u-2", session_id: "s-1" },
          timestamp: 200,
        },
      ],
    } as never);

    const messages = useStore.getState().messages;
    expect(messages.map((m) => m.role)).toEqual(["user", "system"]);
    expect(messages[1].subtype).toBe("compact");
    expect(messages[1].compaction).toEqual({ trigger: "auto", preTokens: 0 });
    expect(messages[1].timestamp).toBe(200);
  });

  test("other system events do not produce a marker", async () => {
    const { handleParsedMessage } = await import("../ws.js");
    handleParsedMessage({
      type: "system_event",
      event: { subtype: "task_notification", task_id: "t", status: "completed", output_file: "", summary: "", uuid: "u-3", session_id: "s-1" },
    });
    expect(useStore.getState().messages).toHaveLength(0);
  });
});

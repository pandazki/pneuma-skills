import { beforeEach, describe, expect, test } from "bun:test";
import { useStore } from "../store/index.js";
import { seekTo } from "../replay-engine.js";

/**
 * Replay rebuilds the conversation by folding the recorded envelopes again
 * (§3.2), and the roster is a projection of that fold. Everything derived from
 * `messages` therefore has to be dropped whenever `messages` is, or a scrub
 * backwards leaves the player showing agents that have not been spawned yet —
 * as synthetic orphan cards at the very top, since their spawn anchors went
 * away with the messages.
 */

function assistantEntry(id: string, text: string, parent: string | null, ts: number) {
  return {
    type: "assistant",
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "claude-x",
      content: [{ type: "text", text }],
    },
    parent_tool_use_id: parent,
    timestamp: ts,
  };
}

/** user → spawn roster → the agent's reply → a later root message. */
const RECORDING = [
  { type: "user_message", id: "u1", content: "review the captures", timestamp: 100 },
  assistantEntry("m1", "spawning a judge", null, 200),
  {
    type: "subagent_update",
    agent: { id: "task-1", parent_id: null, label: "judge_01", status: "running" },
    timestamp: 250,
  },
  assistantEntry("m2", "the third capture is the one", "task-1", 300),
  assistantEntry("m3", "agreed, shipping that one", null, 400),
];

beforeEach(() => {
  useStore.setState({ messages: [], replayMessages: RECORDING, replayCheckpoints: [], currentSeq: 0 });
  useStore.getState().resetSubagents();
});

describe("seeking in replay", () => {
  test("scrubbing back to before the spawn leaves no roster behind", () => {
    seekTo(RECORDING.length);
    expect(useStore.getState().subagents.get("task-1")).toMatchObject({ label: "judge_01" });

    // Back to just after the first root message — the judge does not exist yet.
    seekTo(2);
    const s = useStore.getState();
    expect(s.subagents.size).toBe(0);
    expect(s.messages.map((m) => m.id)).toEqual(["u1", "m1"]);
  });

  test("an agent view open at the end does not survive the scrub", () => {
    seekTo(RECORDING.length);
    useStore.getState().setViewingAgent("task-1");
    useStore.getState().setRootUnread(true);

    seekTo(1);
    const s = useStore.getState();
    expect(s.viewingAgentId).toBeNull();
    expect(s.rootUnread).toBe(false);
    expect(s.streamingByAgent.size).toBe(0);
    expect(s.activityByAgent.size).toBe(0);
  });

  test("seeking forward again rebuilds the same roster", () => {
    seekTo(RECORDING.length);
    seekTo(1);
    seekTo(RECORDING.length);
    const s = useStore.getState();
    expect(s.subagents.get("task-1")).toMatchObject({ label: "judge_01", status: "running" });
    expect(s.messages.filter((m) => (m.parentToolUseId ?? null) === "task-1")).toHaveLength(1);
  });
});

describe("entering and leaving replay", () => {
  test("the live session's roster does not bleed into the replay", () => {
    const s = () => useStore.getState();
    s().upsertSubagent({ id: "live-1", parent_id: null, label: "from the live session", status: "running" }, 1);
    s().setViewingAgent("live-1");

    s().enterReplayMode({ messages: RECORDING, checkpoints: [], metadata: null, summary: null });
    expect(s().subagents.size).toBe(0);
    expect(s().viewingAgentId).toBeNull();
  });

  test("leaving replay drops the replayed roster before the live one loads", () => {
    const s = () => useStore.getState();
    s().enterReplayMode({ messages: RECORDING, checkpoints: [], metadata: null, summary: null });
    seekTo(RECORDING.length);
    expect(s().subagents.size).toBe(1);

    s().exitReplayMode();
    expect(s().subagents.size).toBe(0);
    expect(s().viewingAgentId).toBeNull();
  });
});

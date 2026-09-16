/**
 * Subagent attribution + roster on the Claude Code path (design
 * `docs/proposals/2026-09-16-subagent-threads.md` §4.2).
 *
 * Claude reports a spawned agent through three ordinary stream-json frames and
 * nothing else: the `Task` / `Agent` `tool_use` block that spawns it, the
 * `parent_tool_use_id` every envelope from that agent carries, and the
 * `tool_result` of the spawning call when it ends. The bridge turns the first
 * and the last into `subagent_update` roster snapshots and must persist them,
 * because they are history-backed (the replay ring skips them).
 *
 * Bundled with it: the adjacent defect that made the roster unreadable on
 * reload — Claude emits ONE assistant frame per content block, all sharing
 * `message.id`, and the bridge used to REPLACE the persisted entry, so a
 * `Task` tool_use followed by text lost the tool card (the spawn anchor)
 * entirely.
 *
 * All behaviour tests through `WsBridge`'s public surface
 * (`attachCLITransport` + `feedCLIMessage` + `handleBrowserOpen`) with a
 * recording browser socket — the real CLI pipeline, no private methods.
 */

import { describe, expect, test } from "bun:test";
import { WsBridge } from "../ws-bridge.js";
import type { SocketData } from "../ws-bridge-types.js";
import type { BrowserIncomingMessage, ContentBlock, SubagentInfo } from "../session-types.js";
import type { ServerWebSocket } from "bun";

const SID = "claude-subagents";

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
  bridge.getOrCreateSession(sessionId);
  const { frames, ws } = attachRecordingBrowser(bridge, sessionId);
  bridge.attachCLITransport(sessionId, { send: () => {}, close: () => {} });
  return { bridge, frames, ws };
}

/** One assistant frame as the CLI emits it: a single content block. */
function assistantFrame(
  block: Record<string, unknown>,
  opts: { id?: string; parent?: string | null } = {},
): string {
  return JSON.stringify({
    type: "assistant",
    message: {
      id: opts.id ?? "msg_root",
      type: "message",
      role: "assistant",
      model: "claude-opus-5",
      content: [block],
      stop_reason: null,
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
    parent_tool_use_id: opts.parent ?? null,
    uuid: "u-assistant",
    session_id: SID,
  });
}

function spawnBlock(id: string, description: string, subagentType?: string): ContentBlock {
  return {
    type: "tool_use",
    id,
    name: "Task",
    input: {
      description,
      prompt: "go read the captures",
      ...(subagentType ? { subagent_type: subagentType } : {}),
    },
  };
}

/** The synthetic `user` frame the CLI emits to carry a tool_result back. */
function toolResultFrame(
  toolUseId: string,
  content: unknown,
  isError = false,
): string {
  return JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: toolUseId, content, ...(isError ? { is_error: true } : {}) }],
    },
  });
}

function rosterFrames(frames: BrowserIncomingMessage[]): SubagentInfo[] {
  return frames
    .filter((f): f is Extract<BrowserIncomingMessage, { type: "subagent_update" }> => f.type === "subagent_update")
    .map((f) => f.agent);
}

function rosterHistory(bridge: WsBridge, sessionId = SID): SubagentInfo[] {
  return rosterFrames(bridge.getMessageHistory(sessionId));
}

describe("Claude subagent roster", () => {
  test("a Task tool_use registers a running agent in history and broadcasts it", () => {
    const { bridge, frames } = bridgeWithCli();

    bridge.feedCLIMessage(SID, assistantFrame(spawnBlock("toolu_judge", "Judge round 3", "general-purpose")));

    const expected: SubagentInfo = {
      id: "toolu_judge",
      parent_id: null,
      label: "Judge round 3",
      status: "running",
      detail: "general-purpose",
    };
    expect(rosterHistory(bridge)).toEqual([expected]);
    expect(rosterFrames(frames)).toEqual([expected]);

    // The roster snapshot is persisted BEFORE the broadcast and rides
    // messageHistory, so it is also in the timestamped envelope.
    const persisted = bridge.getMessageHistory(SID).find((m) => m.type === "subagent_update");
    expect(persisted && persisted.type === "subagent_update" && typeof persisted.timestamp).toBe("number");
  });

  test("a non-spawn tool_use registers nothing", () => {
    const { bridge, frames } = bridgeWithCli();

    bridge.feedCLIMessage(SID, assistantFrame({
      type: "tool_use",
      id: "toolu_read",
      name: "Read",
      input: { file_path: "/tmp/x.md" },
    }));

    expect(rosterHistory(bridge)).toEqual([]);
    expect(rosterFrames(frames)).toEqual([]);
  });

  test("the spawning call's tool_result completes the agent", () => {
    const { bridge, frames } = bridgeWithCli();
    bridge.feedCLIMessage(SID, assistantFrame(spawnBlock("toolu_judge", "Judge round 3", "general-purpose")));

    bridge.feedCLIMessage(SID, toolResultFrame("toolu_judge", [
      { type: "text", text: "Round 3 passes: the contact sheet matches." },
    ]));

    expect(rosterHistory(bridge)).toEqual([
      { id: "toolu_judge", parent_id: null, label: "Judge round 3", status: "running", detail: "general-purpose" },
      {
        id: "toolu_judge",
        parent_id: null,
        label: "Judge round 3",
        status: "completed",
        detail: "Round 3 passes: the contact sheet matches.",
      },
    ]);
    expect(rosterFrames(frames).at(-1)?.status).toBe("completed");
  });

  test("an is_error tool_result fails the agent and the detail is capped at 200 chars", () => {
    const { bridge } = bridgeWithCli();
    bridge.feedCLIMessage(SID, assistantFrame(spawnBlock("toolu_judge", "Judge round 3")));

    bridge.feedCLIMessage(SID, toolResultFrame("toolu_judge", "x".repeat(500), true));

    const last = rosterHistory(bridge).at(-1)!;
    expect(last.status).toBe("failed");
    expect(last.detail).toBe("x".repeat(200));
  });

  test("a tool_result for an unknown tool_use_id changes nothing", () => {
    const { bridge, frames } = bridgeWithCli();

    bridge.feedCLIMessage(SID, toolResultFrame("toolu_bash", "ls output"));

    expect(rosterHistory(bridge)).toEqual([]);
    expect(frames.filter((f) => f.type === "subagent_update")).toEqual([]);
  });

  test("a re-emitted spawn block does not publish a second running snapshot", () => {
    const { bridge } = bridgeWithCli();
    const frame = assistantFrame(spawnBlock("toolu_judge", "Judge round 3"));

    bridge.feedCLIMessage(SID, frame);
    bridge.feedCLIMessage(SID, frame);

    expect(rosterHistory(bridge)).toHaveLength(1);
  });

  test("a nested spawn takes parent_id from the spawning agent's own attribution", () => {
    const { bridge } = bridgeWithCli();
    bridge.feedCLIMessage(SID, assistantFrame(spawnBlock("toolu_builder", "Build the deck")));

    // The builder itself calls Task — its frame is attributed to `toolu_builder`.
    bridge.feedCLIMessage(SID, assistantFrame(
      spawnBlock("toolu_grandchild", "Check the fonts"),
      { id: "msg_child", parent: "toolu_builder" },
    ));

    expect(rosterHistory(bridge).map((a) => [a.id, a.parent_id])).toEqual([
      ["toolu_builder", null],
      ["toolu_grandchild", "toolu_builder"],
    ]);
  });

  test("a subagent's assistant frames keep parent_tool_use_id in history and on the wire", () => {
    const { bridge, frames } = bridgeWithCli();
    bridge.feedCLIMessage(SID, assistantFrame(spawnBlock("toolu_judge", "Judge round 3")));

    bridge.feedCLIMessage(SID, assistantFrame(
      { type: "text", text: "Reading captures/round-3.png" },
      { id: "msg_sub", parent: "toolu_judge" },
    ));

    const persisted = bridge.getMessageHistory(SID)
      .filter((m): m is Extract<BrowserIncomingMessage, { type: "assistant" }> => m.type === "assistant");
    expect(persisted.map((m) => [m.message.id, m.parent_tool_use_id])).toEqual([
      ["msg_root", null],
      ["msg_sub", "toolu_judge"],
    ]);
    const broadcast = frames.filter((f) => f.type === "assistant");
    expect(broadcast.at(-1)).toMatchObject({ parent_tool_use_id: "toolu_judge" });
  });

  test("tool_progress forwards the frame's attribution", () => {
    const { bridge, frames } = bridgeWithCli();

    bridge.feedCLIMessage(SID, JSON.stringify({
      type: "tool_progress",
      tool_use_id: "toolu_glob",
      tool_name: "Glob",
      parent_tool_use_id: "toolu_judge",
      elapsed_time_seconds: 12,
      uuid: "u-progress",
      session_id: SID,
    }));
    bridge.feedCLIMessage(SID, JSON.stringify({
      type: "tool_progress",
      tool_use_id: "toolu_bash",
      tool_name: "Bash",
      parent_tool_use_id: null,
      elapsed_time_seconds: 3,
      uuid: "u-progress-2",
      session_id: SID,
    }));

    expect(frames.filter((f) => f.type === "tool_progress")).toMatchObject([
      { tool_use_id: "toolu_glob", parent_tool_use_id: "toolu_judge" },
      { tool_use_id: "toolu_bash", parent_tool_use_id: null },
    ]);
  });

  test("the slash-command stdout echo path is untouched by the tool_result branch", () => {
    const { bridge, frames } = bridgeWithCli();

    bridge.feedCLIMessage(SID, JSON.stringify({
      type: "user",
      message: { role: "user", content: "<local-command-stdout>Context Usage: 42,000 / 200,000 (21%)</local-command-stdout>" },
    }));

    const output = frames.filter((f) => f.type === "command_output");
    expect(output).toHaveLength(1);
    expect(output[0]).toMatchObject({ subtype: "context" });
    expect(bridge.getSession(SID)?.state.context_used_percent).toBe(21);
  });
});

describe("multi-block assistant history", () => {
  test("two frames with one message.id persist as ONE entry holding both blocks", () => {
    const { bridge, frames } = bridgeWithCli();
    const spawn = spawnBlock("toolu_judge", "Judge round 3");

    bridge.feedCLIMessage(SID, assistantFrame(spawn));
    bridge.feedCLIMessage(SID, assistantFrame({ type: "text", text: "Spawned the judge." }));

    const persisted = bridge.getMessageHistory(SID)
      .filter((m): m is Extract<BrowserIncomingMessage, { type: "assistant" }> => m.type === "assistant");
    expect(persisted).toHaveLength(1);
    expect(persisted[0].message.content).toEqual([spawn, { type: "text", text: "Spawned the judge." }]);
    expect(persisted[0].parent_tool_use_id).toBeNull();

    // The frame that merged broadcasts the merged entry (the browser merges
    // by `message.id` too, so both views agree).
    const lastAssistant = frames.filter((f) => f.type === "assistant").at(-1);
    expect(lastAssistant && lastAssistant.type === "assistant" && lastAssistant.message.content).toEqual([
      spawn,
      { type: "text", text: "Spawned the judge." },
    ]);
  });

  test("message_history replays both blocks to a browser that joins later", () => {
    const { bridge } = bridgeWithCli();
    const spawn = spawnBlock("toolu_judge", "Judge round 3");
    bridge.feedCLIMessage(SID, assistantFrame(spawn));
    bridge.feedCLIMessage(SID, assistantFrame({ type: "text", text: "Spawned the judge." }));

    const replayed: BrowserIncomingMessage[] = [];
    const joining = {
      data: { kind: "browser", sessionId: SID } as SocketData,
      send: (raw: string) => replayed.push(JSON.parse(raw) as BrowserIncomingMessage),
      close: () => {},
    } as unknown as ServerWebSocket<SocketData>;
    bridge.handleBrowserOpen(joining, SID);

    const history = replayed.find((m) => m.type === "message_history");
    expect(history && history.type === "message_history").toBe(true);
    const messages = (history as Extract<BrowserIncomingMessage, { type: "message_history" }>).messages;
    const assistants = messages.filter((m) => m.type === "assistant");
    expect(assistants).toHaveLength(1);
    expect(assistants[0].type === "assistant" && assistants[0].message.content).toEqual([
      spawn,
      { type: "text", text: "Spawned the judge." },
    ]);
    // The roster snapshot replays with it, so the joining browser rebuilds
    // the same team without a live `subagent_update`.
    expect(rosterFrames(messages).map((a) => a.id)).toEqual(["toolu_judge"]);
  });

  test("a repeated identical block does not duplicate on merge", () => {
    const { bridge } = bridgeWithCli();
    const block: ContentBlock = { type: "text", text: "Same block twice." };

    bridge.feedCLIMessage(SID, assistantFrame(block));
    bridge.feedCLIMessage(SID, assistantFrame(block));

    const persisted = bridge.getMessageHistory(SID)
      .filter((m): m is Extract<BrowserIncomingMessage, { type: "assistant" }> => m.type === "assistant");
    expect(persisted).toHaveLength(1);
    expect(persisted[0].message.content).toEqual([block]);
  });

  test("a resume re-emit with a fresh id still overwrites instead of appending", () => {
    const { bridge } = bridgeWithCli();
    bridge.feedCLIMessage(SID, assistantFrame({ type: "text", text: "Done." }, { id: "msg_a" }));

    // `--resume` replays the same reply under a new message id.
    bridge.feedCLIMessage(SID, assistantFrame({ type: "text", text: "Done." }, { id: "msg_b" }));

    const persisted = bridge.getMessageHistory(SID)
      .filter((m): m is Extract<BrowserIncomingMessage, { type: "assistant" }> => m.type === "assistant");
    expect(persisted).toHaveLength(1);
    expect(persisted[0].message.id).toBe("msg_b");
    expect(persisted[0].message.content).toEqual([{ type: "text", text: "Done." }]);
  });
});

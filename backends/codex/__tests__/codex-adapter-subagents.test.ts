import { describe, expect, test } from "bun:test";
import { CodexAdapter } from "../codex-adapter.js";
import type { BrowserIncomingMessage, SubagentInfo } from "../../../server/session-types.js";
import { createMockTransport, waitForInit, MAIN_THREAD_ID } from "./mock-transport.js";

/**
 * Subagent threads on the Codex app-server (`--enable multi_agent`).
 *
 * Every notification carries the `threadId` that produced it; issue #152 was
 * the adapter ignoring it, so a child's text became the main agent's words and
 * each child `turn/completed` ended the root turn. These cases pin the three
 * invariants of the spec (docs/proposals/2026-09-16-subagent-threads.md §2.1):
 * every envelope is attributed, a subagent never ends the root turn, and the
 * team is visible through the roster.
 */

const CHILD = "thr_child";
const SIBLING = "thr_sibling";
const GRANDCHILD = "thr_grandchild";

/** Fresh adapter + recorded browser envelopes. */
async function startAdapter(): Promise<{
  transport: ReturnType<typeof createMockTransport>;
  adapter: CodexAdapter;
  messages: BrowserIncomingMessage[];
}> {
  const transport = createMockTransport();
  const messages: BrowserIncomingMessage[] = [];
  const adapter = new CodexAdapter(transport, "test-session", { cwd: "/tmp/test" });
  adapter.onBrowserMessage((msg) => messages.push(msg));
  await waitForInit();
  messages.length = 0; // drop session_init noise — these cases are about turns
  return { transport, adapter, messages };
}

/** The latest roster snapshot per agent id, in arrival order. */
function roster(messages: BrowserIncomingMessage[]): Map<string, SubagentInfo> {
  const out = new Map<string, SubagentInfo>();
  for (const msg of messages) {
    if (msg.type === "subagent_update") out.set(msg.agent.id, msg.agent);
  }
  return out;
}

function assistantMessages(messages: BrowserIncomingMessage[]) {
  return messages.filter((m): m is Extract<BrowserIncomingMessage, { type: "assistant" }> => m.type === "assistant");
}

/** Every `tool_use` block the adapter emitted, with its attribution. */
function toolUses(messages: BrowserIncomingMessage[]): {
  id: string;
  name: string;
  input: Record<string, unknown>;
  parent: string | null;
}[] {
  const out: { id: string; name: string; input: Record<string, unknown>; parent: string | null }[] = [];
  for (const msg of assistantMessages(messages)) {
    for (const block of msg.message.content ?? []) {
      if ((block as { type?: string }).type !== "tool_use") continue;
      const b = block as { id: string; name: string; input: Record<string, unknown> };
      out.push({ id: b.id, name: b.name, input: b.input, parent: msg.parent_tool_use_id });
    }
  }
  return out;
}

function toolResults(messages: BrowserIncomingMessage[]): {
  toolUseId: string;
  content: string;
  isError: boolean;
  parent: string | null;
}[] {
  const out: { toolUseId: string; content: string; isError: boolean; parent: string | null }[] = [];
  for (const msg of assistantMessages(messages)) {
    for (const block of msg.message.content ?? []) {
      if ((block as { type?: string }).type !== "tool_result") continue;
      const b = block as { tool_use_id: string; content: unknown; is_error?: boolean };
      out.push({
        toolUseId: b.tool_use_id,
        content: typeof b.content === "string" ? b.content : JSON.stringify(b.content),
        isError: b.is_error === true,
        parent: msg.parent_tool_use_id,
      });
    }
  }
  return out;
}

/** A `collabAgentToolCall` item as the app-server sends it. */
function collabItem(fields: Record<string, unknown>): Record<string, unknown> {
  return {
    type: "collabAgentToolCall",
    senderThreadId: MAIN_THREAD_ID,
    receiverThreadIds: [],
    agentsStates: {},
    status: "inProgress",
    ...fields,
  };
}

describe("CodexAdapter subagent threads", () => {
  test("a child thread's message is attributed to it, never to the root agent", async () => {
    const { transport, messages } = await startAdapter();

    transport.simulateNotification("item/started", {
      threadId: CHILD,
      turnId: "turn_child",
      item: { type: "agentMessage", id: "child-msg-1" },
      startedAtMs: Date.now(),
    });
    transport.simulateNotification("item/agentMessage/delta", {
      threadId: CHILD,
      turnId: "turn_child",
      itemId: "child-msg-1",
      delta: "I judged the render.",
    });
    transport.simulateNotification("item/completed", {
      threadId: CHILD,
      turnId: "turn_child",
      item: { type: "agentMessage", id: "child-msg-1" },
      completedAtMs: Date.now(),
    });

    // No spawn item was ever seen, so the anchor is the fallback.
    const anchor = `thread:${CHILD}`;
    const streamEvents = messages.filter((m) => m.type === "stream_event");
    expect(streamEvents.length).toBe(1);
    expect(streamEvents[0].type === "stream_event" && streamEvents[0].parent_tool_use_id).toBe(anchor);

    const texts = assistantMessages(messages);
    expect(texts.length).toBe(1);
    expect(texts[0].parent_tool_use_id).toBe(anchor);
    expect(texts[0].message.content?.[0]).toMatchObject({ type: "text", text: "I judged the render." });
    // Nothing rendered as the root agent's own words.
    expect(texts.some((m) => m.parent_tool_use_id === null)).toBe(false);

    // The unknown thread is registered, never dropped.
    const entry = roster(messages).get(anchor);
    expect(entry).toMatchObject({ id: anchor, parent_id: null, label: "", status: "running" });
  });

  test("a child turn never ends the root turn", async () => {
    const { transport, messages } = await startAdapter();

    // Root is mid-turn; a child finishes its own turn inside it.
    transport.simulateNotification("turn/started", {
      threadId: MAIN_THREAD_ID,
      turn: { id: "turn_root", status: "inProgress" },
    });
    transport.simulateNotification("item/started", {
      threadId: MAIN_THREAD_ID,
      turnId: "turn_root",
      item: { type: "agentMessage", id: "root-msg" },
    });
    transport.simulateNotification("item/agentMessage/delta", {
      threadId: MAIN_THREAD_ID,
      turnId: "turn_root",
      itemId: "root-msg",
      delta: "working",
    });
    transport.simulateNotification("turn/started", {
      threadId: CHILD,
      turn: { id: "turn_child", status: "inProgress" },
    });
    transport.simulateNotification("turn/completed", {
      threadId: CHILD,
      turn: { id: "turn_child", status: "completed" },
    });

    expect(messages.filter((m) => m.type === "result").length).toBe(0);
    expect(messages.filter((m) => m.type === "status_change" && m.status === "idle").length).toBe(0);
    // The child's own turn/started must not have flipped the root pill either.
    expect(messages.filter((m) => m.type === "status_change").length).toBe(1);
    // Root streaming buffer untouched: nothing flushed for the root yet.
    expect(assistantMessages(messages).length).toBe(0);
    expect(roster(messages).get(`thread:${CHILD}`)?.status).toBe("completed");

    // The root turn then ends exactly once, counting one turn.
    transport.simulateNotification("turn/completed", {
      threadId: MAIN_THREAD_ID,
      turn: { id: "turn_root", status: "completed" },
    });
    const results = messages.filter((m) => m.type === "result");
    expect(results.length).toBe(1);
    expect(results[0].type === "result" && results[0].data.num_turns).toBe(1);
    const rootText = assistantMessages(messages).find((m) => m.parent_tool_use_id === null);
    expect(rootText?.message.content?.[0]).toMatchObject({ type: "text", text: "working" });
  });

  test("a failed child turn lands on its card, not on the session", async () => {
    const { transport, messages } = await startAdapter();

    transport.simulateNotification("turn/completed", {
      threadId: CHILD,
      turn: { id: "turn_child", status: "failed", error: { message: "sandbox denied the write" } },
    });

    const entry = roster(messages).get(`thread:${CHILD}`);
    expect(entry?.status).toBe("failed");
    expect(entry?.detail).toBe("sandbox denied the write");
    expect(messages.filter((m) => m.type === "error").length).toBe(0);
    expect(messages.filter((m) => m.type === "result").length).toBe(0);
  });

  test("a child's token usage stays on its card and leaves the root gauge alone", async () => {
    const { transport, messages } = await startAdapter();

    transport.simulateNotification("thread/tokenUsage/updated", {
      threadId: MAIN_THREAD_ID,
      tokenUsage: {
        total: { inputTokens: 900, outputTokens: 100, totalTokens: 1000 },
        last: { inputTokens: 900, outputTokens: 100, totalTokens: 1000 },
        modelContextWindow: 10_000,
      },
    });
    transport.simulateNotification("thread/tokenUsage/updated", {
      threadId: CHILD,
      tokenUsage: {
        total: { totalTokens: 9000 },
        last: { totalTokens: 9000 },
        modelContextWindow: 10_000,
      },
      model: "gpt-6-astra",
    });

    const gauges = messages
      .filter((m) => m.type === "session_update")
      .map((m) => (m.type === "session_update" ? m.session.context_used_percent : undefined))
      .filter((p) => p !== undefined);
    expect(gauges).toEqual([10]);

    const entry = roster(messages).get(`thread:${CHILD}`);
    expect(entry?.context_used_percent).toBe(90);
    expect(entry?.model).toBe("gpt-6-astra");
  });

  test("a child's status notification does not idle the session", async () => {
    const { transport, messages } = await startAdapter();

    transport.simulateNotification("thread/status/changed", {
      threadId: CHILD,
      status: { type: "idle" },
    });
    expect(messages.filter((m) => m.type === "status_change").length).toBe(0);

    transport.simulateNotification("thread/status/changed", {
      threadId: MAIN_THREAD_ID,
      status: { type: "idle" },
    });
    expect(messages.filter((m) => m.type === "status_change" && m.status === "idle").length).toBe(1);
  });

  test("spawn card, roster, child messages, then the wait result", async () => {
    const { transport, messages } = await startAdapter();

    // 1. The parent spawns. The card is the spawn item; the agent's anchor is
    //    the same id, so the card is the click target for its conversation.
    transport.simulateNotification("item/started", {
      threadId: MAIN_THREAD_ID,
      turnId: "turn_root",
      item: collabItem({
        id: "call-spawn",
        tool: "spawnAgent",
        receiverThreadIds: [CHILD],
        prompt: "judge captures/round-3.png",
        model: "gpt-6-astra",
        reasoningEffort: "high",
      }),
    });
    transport.simulateNotification("item/completed", {
      threadId: MAIN_THREAD_ID,
      turnId: "turn_root",
      item: collabItem({
        id: "call-spawn",
        tool: "spawnAgent",
        status: "completed",
        receiverThreadIds: [CHILD],
        prompt: "judge captures/round-3.png",
        agentsStates: { [CHILD]: { status: "running" } },
      }),
    });

    const spawnCards = toolUses(messages).filter((t) => t.name === "spawn_agent");
    expect(spawnCards.length).toBe(1);
    expect(spawnCards[0].id).toBe("call-spawn");
    expect(spawnCards[0].parent).toBeNull(); // the spawner's own conversation
    expect(spawnCards[0].input).toEqual({
      prompt: "judge captures/round-3.png",
      model: "gpt-6-astra",
      reasoning_effort: "high",
    });
    expect(roster(messages).get("call-spawn")).toMatchObject({
      id: "call-spawn",
      parent_id: null,
      status: "running",
    });

    // 2. The parent's activity item names the agent.
    transport.simulateNotification("item/completed", {
      threadId: MAIN_THREAD_ID,
      turnId: "turn_root",
      item: {
        type: "subAgentActivity",
        id: "act-1",
        agentThreadId: CHILD,
        agentPath: "/Users/dev/.codex/agents/judge_01",
        kind: "started",
      },
    });
    const named = roster(messages).get("call-spawn");
    expect(named?.label).toBe("judge_01");
    expect(named?.detail).toBe("/Users/dev/.codex/agents/judge_01");
    // Roster only — no chat bubble for the activity item.
    expect(toolUses(messages).some((t) => t.name === "sub_agent_activity")).toBe(false);

    // 3. The child works. Its tool card and text belong to it.
    transport.simulateNotification("turn/started", {
      threadId: CHILD,
      turn: { id: "turn_child", status: "inProgress" },
    });
    transport.simulateNotification("item/started", {
      threadId: CHILD,
      turnId: "turn_child",
      item: { type: "commandExecution", id: "child-cmd", command: ["ls"], status: "inProgress" },
    });
    transport.simulateNotification("item/completed", {
      threadId: CHILD,
      turnId: "turn_child",
      item: { type: "commandExecution", id: "child-cmd", command: ["ls"], status: "completed", exitCode: 0, aggregatedOutput: "round-3.png" },
    });
    transport.simulateNotification("item/started", {
      threadId: CHILD,
      turnId: "turn_child",
      item: { type: "agentMessage", id: "child-msg" },
    });
    transport.simulateNotification("item/agentMessage/delta", {
      threadId: CHILD,
      turnId: "turn_child",
      itemId: "child-msg",
      delta: "verdict: ok",
    });
    transport.simulateNotification("turn/completed", {
      threadId: CHILD,
      turn: { id: "turn_child", status: "completed" },
    });

    const childCard = toolUses(messages).find((t) => t.id === "child-cmd");
    expect(childCard?.parent).toBe("call-spawn");
    expect(toolResults(messages).find((r) => r.toolUseId === "child-cmd")?.parent).toBe("call-spawn");
    const childText = assistantMessages(messages).find(
      (m) => m.message.content?.[0] && (m.message.content[0] as { type: string }).type === "text",
    );
    expect(childText?.parent_tool_use_id).toBe("call-spawn");
    expect(childText?.message.content?.[0]).toMatchObject({ text: "verdict: ok" });

    // 4. The parent's `wait` closes the loop: its own card, and the roster
    //    learns the outcome from `agentsStates`.
    transport.simulateNotification("item/started", {
      threadId: MAIN_THREAD_ID,
      turnId: "turn_root",
      item: collabItem({ id: "call-wait", tool: "wait", receiverThreadIds: [CHILD] }),
    });
    transport.simulateNotification("item/completed", {
      threadId: MAIN_THREAD_ID,
      turnId: "turn_root",
      item: collabItem({
        id: "call-wait",
        tool: "wait",
        status: "completed",
        receiverThreadIds: [CHILD],
        agentsStates: { [CHILD]: { status: "completed", message: "verdict: ok" } },
      }),
    });

    const waitCard = toolUses(messages).find((t) => t.name === "wait_agent");
    expect(waitCard?.id).toBe("call-wait");
    expect(waitCard?.parent).toBeNull();
    expect(waitCard?.input).toEqual({ agent: "judge_01" });
    const waitResult = toolResults(messages).find((r) => r.toolUseId === "call-wait");
    expect(waitResult?.content).toBe("judge_01: completed — verdict: ok");
    expect(waitResult?.isError).toBe(false);
    expect(roster(messages).get("call-spawn")?.status).toBe("completed");
  });

  test("a failed collab call marks the agent and the card", async () => {
    const { transport, messages } = await startAdapter();

    transport.simulateNotification("item/completed", {
      threadId: MAIN_THREAD_ID,
      item: collabItem({
        id: "call-spawn",
        tool: "spawnAgent",
        status: "failed",
        receiverThreadIds: [CHILD],
        agentsStates: { [CHILD]: { status: "errored", message: "model unavailable" } },
      }),
    });

    const result = toolResults(messages).find((r) => r.toolUseId === "call-spawn");
    expect(result?.isError).toBe(true);
    expect(result?.content).toContain("model unavailable");
    expect(roster(messages).get("call-spawn")).toMatchObject({
      status: "failed",
      detail: "model unavailable",
    });
  });

  test("the anchor is fixed at first sight: a late spawn item reuses the fallback", async () => {
    const { transport, messages } = await startAdapter();

    // The child streams before its spawn item lands (resume replay, or simply
    // a racing notification).
    transport.simulateNotification("item/started", {
      threadId: CHILD,
      turnId: "turn_child",
      item: { type: "agentMessage", id: "child-msg" },
    });
    transport.simulateNotification("item/agentMessage/delta", {
      threadId: CHILD,
      turnId: "turn_child",
      itemId: "child-msg",
      delta: "early",
    });
    const fallback = `thread:${CHILD}`;
    expect(messages.filter((m) => m.type === "stream_event")[0]).toMatchObject({
      parent_tool_use_id: fallback,
    });

    transport.simulateNotification("item/started", {
      threadId: MAIN_THREAD_ID,
      item: collabItem({ id: "call-spawn", tool: "spawnAgent", receiverThreadIds: [CHILD] }),
    });

    // The anchor is already on the wire, so it wins: the card takes the
    // fallback id, and the dedupe key stays the Codex item id.
    const spawnCards = toolUses(messages).filter((t) => t.name === "spawn_agent");
    expect(spawnCards.length).toBe(1);
    expect(spawnCards[0].id).toBe(fallback);
    expect(roster(messages).get(fallback)?.id).toBe(fallback);
    expect(roster(messages).has("call-spawn")).toBe(false);

    // A repeat of the same item (started → completed) emits no second card.
    transport.simulateNotification("item/completed", {
      threadId: MAIN_THREAD_ID,
      item: collabItem({
        id: "call-spawn",
        tool: "spawnAgent",
        status: "completed",
        receiverThreadIds: [CHILD],
        agentsStates: { [CHILD]: { status: "running" } },
      }),
    });
    expect(toolUses(messages).filter((t) => t.name === "spawn_agent").length).toBe(1);
    expect(toolResults(messages).find((r) => r.toolUseId === fallback)).toBeDefined();

    // And the child's later text still carries the one anchor.
    transport.simulateNotification("item/completed", {
      threadId: CHILD,
      turnId: "turn_child",
      item: { type: "agentMessage", id: "child-msg" },
    });
    expect(assistantMessages(messages).find((m) => m.message.id === "child-msg")?.parent_tool_use_id)
      .toBe(fallback);
  });

  test("a nested agent hangs off its spawner, not off the root", async () => {
    const { transport, messages } = await startAdapter();

    transport.simulateNotification("item/completed", {
      threadId: MAIN_THREAD_ID,
      item: collabItem({
        id: "call-builder",
        tool: "spawnAgent",
        status: "completed",
        receiverThreadIds: [CHILD],
        agentsStates: { [CHILD]: { status: "running" } },
      }),
    });
    // The child spawns its own agent: the card is emitted in the *child's*
    // conversation, and the grandchild's parent is the child's anchor.
    transport.simulateNotification("item/completed", {
      threadId: CHILD,
      item: collabItem({
        id: "call-judge",
        tool: "spawnAgent",
        status: "completed",
        senderThreadId: CHILD,
        receiverThreadIds: [GRANDCHILD],
        agentsStates: { [GRANDCHILD]: { status: "pendingInit" } },
      }),
    });
    transport.simulateNotification("item/started", {
      threadId: GRANDCHILD,
      item: { type: "agentMessage", id: "gc-msg" },
    });
    transport.simulateNotification("item/agentMessage/delta", {
      threadId: GRANDCHILD,
      itemId: "gc-msg",
      delta: "deep",
    });
    transport.simulateNotification("turn/completed", {
      threadId: GRANDCHILD,
      turn: { id: "turn_gc", status: "completed" },
    });

    const nestedCard = toolUses(messages).find((t) => t.id === "call-judge");
    expect(nestedCard?.parent).toBe("call-builder");

    const entries = roster(messages);
    expect(entries.get("call-builder")).toMatchObject({ parent_id: null, status: "running" });
    expect(entries.get("call-judge")).toMatchObject({ parent_id: "call-builder", status: "completed" });

    const deep = assistantMessages(messages).find(
      (m) => m.message.content?.[0] && (m.message.content[0] as { type: string }).type === "text",
    );
    expect(deep?.parent_tool_use_id).toBe("call-judge");
    expect(messages.filter((m) => m.type === "result").length).toBe(0);
  });

  test("thread/started registers a subagent by nickname; a path still wins the label", async () => {
    const { transport, messages } = await startAdapter();

    transport.simulateNotification("thread/started", {
      thread: {
        id: CHILD,
        parentThreadId: MAIN_THREAD_ID,
        agentNickname: "judge",
        agentRole: "reviewer",
        model: "gpt-6-astra",
      },
    });
    const byNickname = roster(messages).get(`thread:${CHILD}`);
    expect(byNickname).toMatchObject({
      label: "judge",
      detail: "reviewer",
      model: "gpt-6-astra",
      status: "running",
    });

    transport.simulateNotification("item/completed", {
      threadId: MAIN_THREAD_ID,
      item: {
        type: "subAgentActivity",
        id: "act-1",
        agentThreadId: CHILD,
        agentPath: "agents/judge_01",
        kind: "interacted",
      },
    });
    const byPath = roster(messages).get(`thread:${CHILD}`);
    expect(byPath?.label).toBe("judge_01");
    expect(byPath?.detail).toBe("agents/judge_01 · reviewer");

    // Our own `thread/started` (no parent) stays a no-op.
    const before = messages.length;
    transport.simulateNotification("thread/started", { thread: { id: MAIN_THREAD_ID } });
    expect(messages.length).toBe(before);
  });

  test("a child error updates the card without a root error envelope", async () => {
    const { transport, messages } = await startAdapter();

    transport.simulateNotification("error", {
      threadId: CHILD,
      turnId: "turn_child",
      error: { message: "stream disconnected before completion" },
      willRetry: true,
    });
    let entry = roster(messages).get(`thread:${CHILD}`);
    expect(entry?.status).toBe("running"); // a retry is not a failure
    expect(entry?.detail).toBe("stream disconnected before completion");
    expect(messages.filter((m) => m.type === "error").length).toBe(0);

    transport.simulateNotification("error", {
      threadId: CHILD,
      error: { message: "context window exceeded" },
    });
    entry = roster(messages).get(`thread:${CHILD}`);
    expect(entry?.status).toBe("failed");
    expect(entry?.detail).toBe("context window exceeded");
    expect(messages.filter((m) => m.type === "error").length).toBe(0);

    // The root's own errors still reach the chat.
    transport.simulateNotification("error", {
      threadId: MAIN_THREAD_ID,
      error: { message: "root broke" },
    });
    expect(messages.filter((m) => m.type === "error").length).toBe(1);
  });

  test("an approval request names the agent that asked", async () => {
    const { transport, messages } = await startAdapter();

    transport.simulateNotification("item/completed", {
      threadId: MAIN_THREAD_ID,
      item: collabItem({
        id: "call-spawn",
        tool: "spawnAgent",
        status: "completed",
        receiverThreadIds: [CHILD],
        agentsStates: { [CHILD]: { status: "running" } },
      }),
    });

    transport.simulateRequest("item/commandExecution/requestApproval", 7, {
      threadId: CHILD,
      itemId: "child-cmd",
      command: "rm -rf /tmp/scratch",
    });
    // Legacy approvals carry the thread as `conversationId`.
    transport.simulateRequest("execCommandApproval", 8, {
      conversationId: CHILD,
      itemId: "child-cmd-2",
      command: "ls",
    });
    transport.simulateRequest("item/commandExecution/requestApproval", 9, {
      threadId: MAIN_THREAD_ID,
      itemId: "root-cmd",
      command: "ls",
    });

    const perms = messages.filter((m) => m.type === "permission_request");
    expect(perms.length).toBe(3);
    const attribution = perms.map((m) => (m.type === "permission_request" ? m.request.parent_tool_use_id : undefined));
    expect(attribution).toEqual(["call-spawn", "call-spawn", null]);
  });

  test("legacy notifications without threadId still drive the main thread", async () => {
    const { transport, messages } = await startAdapter();

    transport.simulateNotification("turn/started", { turn: { id: "turn_legacy" } });
    transport.simulateNotification("item/started", { item: { type: "agentMessage", id: "legacy-msg" } });
    transport.simulateNotification("item/agentMessage/delta", { itemId: "legacy-msg", delta: "hi" });
    transport.simulateNotification("item/completed", { item: { type: "agentMessage", id: "legacy-msg" } });
    transport.simulateNotification("thread/tokenUsage/updated", {
      inputTokens: 500,
      outputTokens: 500,
      modelContextWindow: 10_000,
    });
    transport.simulateNotification("turn/completed", { status: "completed" });

    const texts = assistantMessages(messages);
    expect(texts.length).toBe(1);
    expect(texts[0].parent_tool_use_id).toBeNull();
    expect(messages.filter((m) => m.type === "stream_event")[0]).toMatchObject({ parent_tool_use_id: null });
    expect(messages.filter((m) => m.type === "result").length).toBe(1);
    expect(messages.some((m) => m.type === "subagent_update")).toBe(false);
    const gauge = messages
      .filter((m) => m.type === "session_update")
      .map((m) => (m.type === "session_update" ? m.session.context_used_percent : undefined))
      .filter((p) => p !== undefined);
    expect(gauge).toEqual([10]);
  });

  test("a child's tool progress is attributed to the child", async () => {
    const { transport, messages } = await startAdapter();

    transport.simulateNotification("item/started", {
      threadId: CHILD,
      item: { type: "commandExecution", id: "child-cmd", command: ["sleep", "5"], status: "inProgress" },
    });
    transport.simulateNotification("item/updated", {
      threadId: CHILD,
      item: { type: "commandExecution", id: "child-cmd", status: "inProgress" },
    });

    const progress = messages.filter((m) => m.type === "tool_progress");
    expect(progress.length).toBe(1);
    expect(progress[0].type === "tool_progress" && progress[0].parent_tool_use_id).toBe(`thread:${CHILD}`);
  });

  test("roster snapshots are sent on change, not per message", async () => {
    const { transport, messages } = await startAdapter();

    transport.simulateNotification("turn/started", {
      threadId: CHILD,
      turn: { id: "turn_child" },
    });
    const afterFirst = messages.filter((m) => m.type === "subagent_update").length;
    expect(afterFirst).toBe(1); // registration + running is one snapshot

    for (let i = 0; i < 3; i++) {
      transport.simulateNotification("item/agentMessage/delta", {
        threadId: CHILD,
        itemId: "child-msg",
        delta: `chunk ${i}`,
      });
    }
    transport.simulateNotification("turn/started", {
      threadId: CHILD,
      turn: { id: "turn_child_2" },
    });
    expect(messages.filter((m) => m.type === "subagent_update").length).toBe(afterFirst);

    transport.simulateNotification("turn/completed", {
      threadId: CHILD,
      turn: { id: "turn_child_2", status: "interrupted" },
    });
    const snapshots = messages.filter((m) => m.type === "subagent_update");
    expect(snapshots.length).toBe(afterFirst + 1);
    expect(snapshots[snapshots.length - 1].type === "subagent_update"
      && snapshots[snapshots.length - 1].timestamp).toBeGreaterThan(0);
    expect(roster(messages).get(`thread:${CHILD}`)?.status).toBe("interrupted");
  });

  test("a child's compaction does not pin the session to compacting", async () => {
    const { transport, messages } = await startAdapter();

    transport.simulateNotification("item/started", {
      threadId: CHILD,
      item: { type: "contextCompaction", id: "cc-1" },
    });
    transport.simulateNotification("item/completed", {
      threadId: CHILD,
      item: { type: "contextCompaction", id: "cc-1" },
    });

    expect(messages.filter((m) => m.type === "status_change").length).toBe(0);
    expect(messages.filter((m) => m.type === "system_event").length).toBe(0);
  });

  test("a child's thread/compacted never draws the root's boundary", async () => {
    const { transport, adapter, messages } = await startAdapter();

    // The root's occupancy, then the user arms `/compact` on it: the boundary
    // that eventually fires must read `manual` with these `pre_tokens`.
    transport.simulateNotification("thread/tokenUsage/updated", {
      threadId: MAIN_THREAD_ID,
      tokenUsage: {
        total: { totalTokens: 8000 },
        last: { totalTokens: 8000 },
        modelContextWindow: 10_000,
      },
    });
    adapter.sendBrowserMessage({ type: "user_message", content: "/compact" });
    await new Promise((r) => setTimeout(r, 10));

    // A child compacts its own window while that is in flight.
    transport.simulateNotification("thread/compacted", { threadId: CHILD });
    expect(messages.filter((m) => m.type === "system_event").length).toBe(0);
    expect(messages.some((m) => m.type === "session_update" && m.session.is_compacting === false)).toBe(false);

    // The root's own compaction still reports exactly one boundary — the
    // child used to spend it, leaving the real one silent.
    transport.simulateNotification("thread/compacted", { threadId: MAIN_THREAD_ID });
    const boundaries = messages.filter((m) => m.type === "system_event");
    expect(boundaries.length).toBe(1);
    expect(boundaries[0].type === "system_event" && boundaries[0].event).toMatchObject({
      subtype: "compact_boundary",
      compact_metadata: { trigger: "manual", pre_tokens: 8000 },
    });
    expect(messages.some((m) => m.type === "session_update" && m.session.is_compacting === false)).toBe(true);
  });

  test("a spawn whose receiver lands late still has one identity", async () => {
    const { transport, messages } = await startAdapter();

    // 1. The spawn call starts before the agent exists — no receiver yet.
    transport.simulateNotification("item/started", {
      threadId: MAIN_THREAD_ID,
      turnId: "turn_root",
      item: collabItem({ id: "call-spawn", tool: "spawnAgent", prompt: "judge the render" }),
    });
    // 2. The child announces itself and takes the fallback anchor. It is on
    //    the wire from here on, so nothing may rewrite it.
    transport.simulateNotification("thread/started", {
      thread: { id: CHILD, parentThreadId: MAIN_THREAD_ID, agentNickname: "judge" },
    });
    // 3. Only now does the spawn call name its receiver.
    transport.simulateNotification("item/completed", {
      threadId: MAIN_THREAD_ID,
      turnId: "turn_root",
      item: collabItem({
        id: "call-spawn",
        tool: "spawnAgent",
        status: "completed",
        receiverThreadIds: [CHILD],
        prompt: "judge the render",
        agentsStates: { [CHILD]: { status: "running" } },
      }),
    });

    // One agent, one id: the card, its result and the roster entry agree.
    const anchor = `thread:${CHILD}`;
    const cards = toolUses(messages).filter((t) => t.name === "spawn_agent");
    expect(cards.length).toBe(1);
    expect(cards[0].id).toBe(anchor);
    expect(cards[0].input).toEqual({ agent: "judge", prompt: "judge the render" });
    expect(toolResults(messages).map((r) => r.toolUseId)).toEqual([anchor]);
    expect([...roster(messages).keys()]).toEqual([anchor]);

    // And the agent's own words carry that same id.
    transport.simulateNotification("item/started", {
      threadId: CHILD,
      item: { type: "agentMessage", id: "child-msg" },
    });
    transport.simulateNotification("item/agentMessage/delta", {
      threadId: CHILD,
      itemId: "child-msg",
      delta: "verdict: ok",
    });
    transport.simulateNotification("item/completed", {
      threadId: CHILD,
      item: { type: "agentMessage", id: "child-msg" },
    });
    expect(assistantMessages(messages).find((m) => m.message.id === "child-msg")?.parent_tool_use_id)
      .toBe(anchor);
  });

  test("one spawn naming two agents gives each its own identity", async () => {
    const { transport, messages } = await startAdapter();

    // Neither agent is known yet: the spawn item is the first thing the
    // adapter sees about them, and it names both.
    transport.simulateNotification("item/completed", {
      threadId: MAIN_THREAD_ID,
      item: collabItem({
        id: "call-spawn",
        tool: "spawnAgent",
        status: "completed",
        receiverThreadIds: [CHILD, SIBLING],
        agentsStates: { [CHILD]: { status: "running" }, [SIBLING]: { status: "running" } },
      }),
    });

    // Two agents, two roster entries — one card cannot be two conversations,
    // so neither may take the item id as its anchor.
    expect([...roster(messages).keys()].sort()).toEqual([`thread:${CHILD}`, `thread:${SIBLING}`].sort());
    const card = toolUses(messages).find((t) => t.name === "spawn_agent");
    expect(card?.id).toBe("call-spawn"); // the call's own id: it names a team
    expect(toolResults(messages).map((r) => r.toolUseId)).toEqual(["call-spawn"]);

    // Each agent's text carries its own anchor.
    transport.simulateNotification("thread/started", {
      thread: { id: CHILD, parentThreadId: MAIN_THREAD_ID, agentNickname: "judge" },
    });
    transport.simulateNotification("thread/started", {
      thread: { id: SIBLING, parentThreadId: MAIN_THREAD_ID, agentNickname: "builder" },
    });
    for (const [thread, itemId, text] of [[CHILD, "c1", "from judge"], [SIBLING, "c2", "from builder"]] as const) {
      transport.simulateNotification("item/started", { threadId: thread, item: { type: "agentMessage", id: itemId } });
      transport.simulateNotification("item/agentMessage/delta", { threadId: thread, itemId, delta: text });
      transport.simulateNotification("item/completed", { threadId: thread, item: { type: "agentMessage", id: itemId } });
    }
    expect(assistantMessages(messages).find((m) => m.message.id === "c1")?.parent_tool_use_id)
      .toBe(`thread:${CHILD}`);
    expect(assistantMessages(messages).find((m) => m.message.id === "c2")?.parent_tool_use_id)
      .toBe(`thread:${SIBLING}`);

    // A later call onto the same team lists them both on one card.
    transport.simulateNotification("item/started", {
      threadId: MAIN_THREAD_ID,
      item: collabItem({ id: "call-wait", tool: "wait", receiverThreadIds: [CHILD, SIBLING] }),
    });
    expect(toolUses(messages).find((t) => t.name === "wait_agent")?.input)
      .toEqual({ agents: ["judge", "builder"] });
  });

  test("a child's reroute lands on its card and never relabels the session", async () => {
    const { transport, messages } = await startAdapter();

    transport.simulateNotification("model/rerouted", {
      threadId: CHILD,
      fromModel: "o3-pro",
      toModel: "gpt-5-mini",
    });
    expect(messages.some((m) => m.type === "session_update" && m.session.model === "gpt-5-mini")).toBe(false);
    expect(roster(messages).get(`thread:${CHILD}`)?.model).toBe("gpt-5-mini");

    // The root's later words still carry the session's own model.
    transport.simulateNotification("item/started", {
      threadId: MAIN_THREAD_ID,
      item: { type: "agentMessage", id: "root-msg" },
    });
    transport.simulateNotification("item/agentMessage/delta", {
      threadId: MAIN_THREAD_ID,
      itemId: "root-msg",
      delta: "hello",
    });
    transport.simulateNotification("item/completed", {
      threadId: MAIN_THREAD_ID,
      item: { type: "agentMessage", id: "root-msg" },
    });
    expect(assistantMessages(messages).find((m) => m.message.id === "root-msg")?.message.model).toBe("o3-pro");

    // The root's own reroute still moves the session.
    transport.simulateNotification("model/rerouted", { threadId: MAIN_THREAD_ID, toModel: "gpt-6-astra" });
    expect(messages.filter((m) => m.type === "session_update" && m.session.model === "gpt-6-astra").length).toBe(1);
  });

  test("a child's codex/event error updates its card instead of the chat", async () => {
    const { transport, messages } = await startAdapter();

    // Legacy `codex/event/*` carries the thread as `conversationId`.
    transport.simulateNotification("codex/event/stream_error", {
      conversationId: CHILD,
      msg: { message: "child stream stalled" },
    });
    expect(messages.filter((m) => m.type === "error").length).toBe(0);
    expect(roster(messages).get(`thread:${CHILD}`)?.detail).toBe("child stream stalled");

    transport.simulateNotification("codex/event/error", {
      threadId: CHILD,
      msg: { message: "child stream died" },
    });
    expect(messages.filter((m) => m.type === "error").length).toBe(0);
    const entry = roster(messages).get(`thread:${CHILD}`);
    expect(entry?.detail).toBe("child stream died");
    // Status is left to the turn events; these events do not say whether the
    // agent is dead, and inventing `failed` would be a guess.
    expect(entry?.status).toBe("running");

    // The root's own still reaches the chat.
    transport.simulateNotification("codex/event/error", {
      threadId: MAIN_THREAD_ID,
      msg: { message: "root stream died" },
    });
    expect(messages.filter((m) => m.type === "error").map((m) => (m.type === "error" ? m.message : "")))
      .toEqual(["root stream died"]);
  });

  test("a notification that beats the main thread's adoption is attributed after it", async () => {
    const transport = createMockTransport();
    const messages: BrowserIncomingMessage[] = [];
    const adapter = new CodexAdapter(transport, "test-session", { cwd: "/tmp/test" });
    adapter.onBrowserMessage((msg) => messages.push(msg));

    // The window is real: `initialize()` is suspended on an await, so
    // `threadId` is still null while `processBuffer` keeps dispatching the
    // rest of the stdout chunk the `thread/start` response arrived in. A
    // resume replays a thread that already had subagents, so a child's
    // `turn/completed` can land here — and used to synthesize a root
    // `result` (issue #152 on the resume path).
    transport.simulateNotification("item/started", {
      threadId: CHILD,
      item: { type: "agentMessage", id: "child-msg" },
    });
    transport.simulateNotification("item/agentMessage/delta", {
      threadId: CHILD,
      itemId: "child-msg",
      delta: "early",
    });
    transport.simulateNotification("turn/completed", {
      threadId: CHILD,
      turn: { id: "turn_child", status: "completed" },
    });
    // Nothing is attributed while the thread is unknown.
    expect(messages.filter((m) => m.type === "stream_event" || m.type === "result").length).toBe(0);

    await waitForInit();

    const anchor = `thread:${CHILD}`;
    expect(messages.filter((m) => m.type === "result").length).toBe(0);
    const streamEvents = messages.filter((m) => m.type === "stream_event");
    expect(streamEvents.length).toBe(1);
    expect(streamEvents[0].type === "stream_event" && streamEvents[0].parent_tool_use_id).toBe(anchor);
    expect(assistantMessages(messages).find((m) => m.message.id === "child-msg")?.parent_tool_use_id).toBe(anchor);
    expect(roster(messages).get(anchor)?.status).toBe("completed");

    // A queued notification naming the thread that turns out to be the main
    // one is still the root's: the queue delays attribution, never drops it.
    const after = messages.length;
    transport.simulateNotification("turn/completed", {
      threadId: MAIN_THREAD_ID,
      turn: { id: "turn_root", status: "completed" },
    });
    expect(messages.slice(after).filter((m) => m.type === "result").length).toBe(1);
  });

  test("interrupt and steer keep targeting the root turn while a child turn is open", async () => {
    const { transport, adapter } = await startAdapter();

    adapter.sendBrowserMessage({ type: "user_message", content: "review this" });
    await new Promise((r) => setTimeout(r, 20));
    // A child opens its own turn inside the root's.
    transport.simulateNotification("turn/started", {
      threadId: CHILD,
      turn: { id: "turn_child", status: "inProgress" },
    });

    await adapter.steerUserMessage("also check the CSS");
    adapter.sendBrowserMessage({ type: "interrupt" });
    await new Promise((r) => setTimeout(r, 10));

    expect(transport._callHistory.find((c) => c.method === "turn/steer")?.params).toMatchObject({
      threadId: MAIN_THREAD_ID,
      expectedTurnId: "turn_1",
    });
    expect(transport._callHistory.find((c) => c.method === "turn/interrupt")?.params).toEqual({
      threadId: MAIN_THREAD_ID,
      turnId: "turn_1",
    });
  });
});

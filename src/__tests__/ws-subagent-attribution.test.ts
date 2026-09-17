import { beforeEach, describe, expect, test } from "bun:test";
import { useStore } from "../store/index.js";

/**
 * Attribution routing in `src/ws.ts` (§5.2). The invariant under test is
 * §2.1.2: **a subagent never ends the root turn** — no flush of the root
 * streaming bubble, no root status flip, no root activity, no root panel
 * extraction — and §2.1.4: a single-agent session is bit-for-bit unchanged.
 *
 * Issue #152 is exactly this defect on the wire: the bridge shipped
 * `parent_tool_use_id` and the frontend rendered a subagent's words as the
 * root agent's.
 */

const ROOT_DRAFT = "the root agent was mid-sentence";

function resetChat(): void {
  useStore.setState({
    messages: [],
    streaming: null,
    activity: null,
    sessionStatus: "idle",
    turnInProgress: false,
    tasks: [],
    changedFilesTick: 0,
  });
  useStore.getState().resetSubagents();
}

function assistantEnvelope(
  id: string,
  text: string,
  parent: string | null,
  extraBlocks: unknown[] = [],
) {
  return {
    type: "assistant" as const,
    message: {
      id,
      type: "message" as const,
      role: "assistant" as const,
      model: "claude-x",
      content: [{ type: "text", text }, ...extraBlocks],
      stop_reason: null,
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
    parent_tool_use_id: parent,
    timestamp: 1_700_000_000_000,
  };
}

function textDelta(text: string, parent: string | null) {
  return {
    type: "stream_event" as const,
    event: { type: "content_block_delta", delta: { type: "text_delta", text } },
    parent_tool_use_id: parent,
  };
}

beforeEach(resetChat);

describe("a subagent's stream stays in its own buffer", () => {
  test("a subagent text delta never touches the root streaming bubble", async () => {
    const { handleParsedMessage } = await import("../ws.js");
    useStore.getState().setStreaming(ROOT_DRAFT);

    handleParsedMessage(textDelta("I am the ", "task-1") as never);
    handleParsedMessage(textDelta("subagent.", "task-1") as never);

    const s = useStore.getState();
    expect(s.streaming).toBe(ROOT_DRAFT);
    expect(s.streamingByAgent.get("task-1")).toBe("I am the subagent.");
    expect(s.activityByAgent.get("task-1")?.phase).toBe("responding");
    // The root indicator was never taken over.
    expect(s.activity).toBeNull();
    // An attributed envelope alone is enough to put the agent on the roster.
    expect(s.subagents.get("task-1")).toMatchObject({ id: "task-1", label: "", status: "running" });
  });

  test("a subagent thinking delta opens its own buffer with the thinking prefix", async () => {
    const { handleParsedMessage } = await import("../ws.js");
    handleParsedMessage({
      type: "stream_event",
      event: { type: "message_start" },
      parent_tool_use_id: "task-1",
    } as never);
    handleParsedMessage({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "weighing it" } },
      parent_tool_use_id: "task-1",
    } as never);

    const s = useStore.getState();
    expect(s.streamingByAgent.get("task-1")).toBe("*Thinking:* weighing it");
    expect(s.activityByAgent.get("task-1")?.phase).toBe("thinking");
    expect(s.streaming).toBeNull();
    expect(s.activity).toBeNull();
  });

  test("root deltas behave exactly as before", async () => {
    const { handleParsedMessage } = await import("../ws.js");
    handleParsedMessage({ type: "stream_event", event: { type: "message_start" }, parent_tool_use_id: null } as never);
    handleParsedMessage(textDelta("hello", null) as never);

    const s = useStore.getState();
    expect(s.streaming).toBe("hello");
    expect(s.activity?.phase).toBe("responding");
    expect(s.streamingByAgent.size).toBe(0);
    expect(s.subagents.size).toBe(0);
  });
});

describe("a subagent's assistant message never ends the root turn", () => {
  test("root streaming, status and panels are untouched; the message keeps its attribution", async () => {
    const { handleParsedMessage } = await import("../ws.js");
    useStore.getState().setStreaming(ROOT_DRAFT);
    useStore.getState().setSessionStatus("idle");
    useStore.getState().setAgentStreaming("task-1", "partial");

    handleParsedMessage(
      assistantEnvelope("m-sub", "Session launcher row updated successfully.", "task-1", [
        { type: "tool_use", id: "t-todo", name: "TodoWrite", input: { todos: [{ content: "x", status: "pending", activeForm: "x" }] } },
        { type: "tool_use", id: "t-write", name: "Write", input: { file_path: "/tmp/x.md", content: "hi" } },
      ]) as never,
    );

    const s = useStore.getState();
    expect(s.streaming).toBe(ROOT_DRAFT);
    expect(s.sessionStatus).toBe("idle");
    // The subagent's own todo list is not the root's task panel, and its
    // file writes reach the viewer through the watcher, not through here.
    expect(s.tasks).toEqual([]);
    expect(s.changedFilesTick).toBe(0);
    // Its own streaming buffer is flushed by its own message.
    expect(s.streamingByAgent.has("task-1")).toBe(false);
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].parentToolUseId).toBe("task-1");
    expect(s.subagents.get("task-1")?.lastActivityAt).toBe(1_700_000_000_000);
  });

  test("a root message arriving while an agent view is open marks the main thread unread", async () => {
    const { handleParsedMessage } = await import("../ws.js");
    useStore.getState().setViewingAgent("task-1");
    expect(useStore.getState().rootUnread).toBe(false);

    handleParsedMessage(assistantEnvelope("m-root", "back to you", null) as never);
    expect(useStore.getState().rootUnread).toBe(true);

    // Reading the main thread clears it.
    useStore.getState().setViewingAgent(null);
    expect(useStore.getState().rootUnread).toBe(false);
  });

  test("a subagent message never dedupes against the root agent's identical text", async () => {
    const { handleParsedMessage } = await import("../ws.js");
    handleParsedMessage(assistantEnvelope("m-root", "Done.", null) as never);
    handleParsedMessage(assistantEnvelope("m-sub", "Done.", "task-1") as never);

    const messages = useStore.getState().messages;
    expect(messages).toHaveLength(2);
    expect(messages.map((m) => m.parentToolUseId ?? null)).toEqual([null, "task-1"]);
  });
});

/**
 * The `--resume` duplicate guard predates attribution: it collapses an
 * assistant message whose trimmed text equals the previous assistant turn's.
 * With two conversations in one array that rule eats real messages, so it is
 * now root-only in both directions. Both copies of the guard (live in
 * `chat-slice.ts`, history in `ws.ts`) are pinned here.
 */
describe("the resume duplicate guard is root-only", () => {
  test("live: two agents answering with the same word both survive", async () => {
    const { handleParsedMessage } = await import("../ws.js");
    handleParsedMessage(assistantEnvelope("m-root", "Judging round 3.", null) as never);
    handleParsedMessage(assistantEnvelope("m-a", "PASS", "task-a") as never);
    handleParsedMessage(assistantEnvelope("m-b", "PASS", "task-b") as never);

    const messages = useStore.getState().messages;
    expect(messages.map((m) => m.id)).toEqual(["m-root", "m-a", "m-b"]);
    expect(messages.map((m) => m.parentToolUseId ?? null)).toEqual([null, "task-a", "task-b"]);
  });

  test("live: a subagent echoing the root's line leaves the root message intact", async () => {
    const { handleParsedMessage } = await import("../ws.js");
    handleParsedMessage(
      assistantEnvelope("m-root", "Judging round 3.", null, [
        { type: "tool_use", id: "task-1", name: "Task", input: { description: "judge" } },
      ]) as never,
    );
    handleParsedMessage(assistantEnvelope("m-sub", "Judging round 3.", "task-1") as never);

    const messages = useStore.getState().messages;
    expect(messages).toHaveLength(2);
    // The spawn anchor still exists — without it the card has nothing to hang on.
    expect(messages[0].contentBlocks?.some((b) => b.type === "tool_use" && b.id === "task-1")).toBe(true);
    expect(messages[1].id).toBe("m-sub");
  });

  test("live: a genuine root re-emit still collapses, and keeps the subagent messages", async () => {
    const { handleParsedMessage } = await import("../ws.js");
    handleParsedMessage(assistantEnvelope("m-root", "Ready when you are.", null) as never);
    handleParsedMessage(assistantEnvelope("m-sub", "subagent output", "task-1") as never);
    handleParsedMessage({ type: "user_message", content: '<pneuma:env reason="opened"/>', timestamp: 1 } as never);
    // The `--resume` re-emit of the same root turn, under a new message id.
    handleParsedMessage(assistantEnvelope("m-root-again", "Ready when you are.", null) as never);

    const messages = useStore.getState().messages;
    expect(messages.filter((m) => (m.parentToolUseId ?? null) === null).map((m) => m.content))
      .toEqual(["Ready when you are."]);
    expect(messages.some((m) => m.id === "m-sub")).toBe(true);
  });

  test("history: the same three rules hold when the roster is rebuilt", async () => {
    const { handleParsedMessage } = await import("../ws.js");
    handleParsedMessage({
      type: "message_history",
      messages: [
        { type: "user_message", id: "u1", content: "judge round 3", timestamp: 100 },
        { ...assistantEnvelope("m-root", "Judging round 3.", null), timestamp: 200 },
        { ...assistantEnvelope("m-a", "PASS", "task-a"), timestamp: 300 },
        { ...assistantEnvelope("m-b", "PASS", "task-b"), timestamp: 310 },
        { ...assistantEnvelope("m-echo", "Judging round 3.", "task-a"), timestamp: 320 },
        { type: "user_message", id: "u2", content: '<pneuma:env reason="opened"/>', timestamp: 400 },
        { ...assistantEnvelope("m-root-again", "Judging round 3.", null), timestamp: 500 },
      ],
    } as never);

    const messages = useStore.getState().messages;
    // Both agents' "PASS" survive, so does the echo…
    expect(messages.filter((m) => m.content === "PASS").map((m) => m.parentToolUseId))
      .toEqual(["task-a", "task-b"]);
    expect(messages.some((m) => m.id === "m-echo")).toBe(true);
    // …and the root turn appears exactly once despite the resume re-emit.
    expect(messages.filter((m) => (m.parentToolUseId ?? null) === null && m.role === "assistant"))
      .toHaveLength(1);
  });
});

describe("tool_progress attribution", () => {
  test("a subagent's long tool run drives that agent's indicator only", async () => {
    const { handleParsedMessage } = await import("../ws.js");
    handleParsedMessage({
      type: "tool_progress",
      tool_use_id: "tu-9",
      tool_name: "Read",
      elapsed_time_seconds: 12,
      parent_tool_use_id: "task-1",
    } as never);

    const s = useStore.getState();
    expect(s.activity).toBeNull();
    expect(s.activityByAgent.get("task-1")).toMatchObject({ phase: "tool", toolName: "Read" });
    expect(s.subagents.has("task-1")).toBe(true);
  });

  test("an unattributed tool_progress still drives the root indicator", async () => {
    const { handleParsedMessage } = await import("../ws.js");
    handleParsedMessage({
      type: "tool_progress",
      tool_use_id: "tu-1",
      tool_name: "Bash",
      elapsed_time_seconds: 3,
    } as never);

    const s = useStore.getState();
    expect(s.activity).toMatchObject({ phase: "tool", toolName: "Bash" });
    expect(s.activityByAgent.size).toBe(0);
    expect(s.subagents.size).toBe(0);
  });
});

describe("the roster folds live and from history", () => {
  test("a live subagent_update upserts the entry", async () => {
    const { handleParsedMessage } = await import("../ws.js");
    handleParsedMessage({
      type: "subagent_update",
      agent: { id: "task-1", parent_id: null, label: "judge_01", status: "running", model: "gpt-6", context_used_percent: 12 },
      timestamp: 1_000,
    } as never);
    handleParsedMessage({
      type: "subagent_update",
      agent: { id: "task-1", parent_id: null, label: "judge_01", status: "failed", detail: "tool denied" },
      timestamp: 2_000,
    } as never);

    const entry = useStore.getState().subagents.get("task-1")!;
    expect(entry).toMatchObject({ label: "judge_01", status: "failed", detail: "tool denied", firstSeenAt: 1_000 });
  });

  test("message_history rebuilds roster, attribution, and resets the view", async () => {
    const { handleParsedMessage } = await import("../ws.js");
    useStore.getState().setViewingAgent("stale-agent");

    handleParsedMessage({
      type: "message_history",
      messages: [
        { type: "user_message", id: "u1", content: "review the captures", timestamp: 100 },
        {
          type: "subagent_update",
          agent: { id: "task-1", parent_id: null, label: "judge_01", status: "running" },
          timestamp: 150,
        },
        { ...assistantEnvelope("m1", "spawning a judge", null), timestamp: 200 },
        { ...assistantEnvelope("m2", "the third capture is the one", "task-1"), timestamp: 300 },
        {
          type: "subagent_update",
          agent: { id: "task-1", parent_id: null, label: "judge_01", status: "completed" },
          timestamp: 400,
        },
      ],
    } as never);

    const s = useStore.getState();
    expect(s.viewingAgentId).toBeNull();
    expect(s.subagents.get("task-1")).toMatchObject({ label: "judge_01", status: "completed" });
    expect(s.messages.map((m) => m.parentToolUseId ?? null)).toEqual([null, null, "task-1"]);
  });

  test("attributed messages with no roster event still produce a fallback entry", async () => {
    const { handleParsedMessage } = await import("../ws.js");
    // The shape of a Claude history recorded before the frontend read
    // attribution: the subagent's reply survives, its `Task` call does not.
    handleParsedMessage({
      type: "message_history",
      messages: [
        { type: "user_message", id: "u1", content: "update the launcher row", timestamp: 100 },
        { ...assistantEnvelope("m2", "Session launcher row updated successfully.", "task-gone"), timestamp: 300 },
        { ...assistantEnvelope("m3", "done", null), timestamp: 400 },
      ],
    } as never);

    const s = useStore.getState();
    // `idle`, not `running` (§3.4): a persisted record is not evidence that
    // the agent is producing output right now. It stays alive, so it keeps
    // its chip in the strip — it just doesn't claim to be mid-sentence.
    expect(s.subagents.get("task-gone")).toMatchObject({
      id: "task-gone",
      label: "",
      status: "idle",
      lastActivityAt: 300,
    });
    // The root timeline is only the two root entries; the subagent's reply is
    // in the roster's conversation, not in the main one.
    expect(s.messages.filter((m) => (m.parentToolUseId ?? null) === null)).toHaveLength(2);
  });

  test("a history with no attribution leaves the roster empty (nothing to show)", async () => {
    const { handleParsedMessage } = await import("../ws.js");
    handleParsedMessage({
      type: "message_history",
      messages: [
        { type: "user_message", id: "u1", content: "hello", timestamp: 100 },
        { ...assistantEnvelope("m1", "hi", null), timestamp: 200 },
        { type: "result", data: { type: "result", subtype: "success", is_error: false, num_turns: 1, total_cost_usd: 0, duration_ms: 1, duration_api_ms: 1, stop_reason: null, usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, uuid: "u", session_id: "s" }, timestamp: 300 },
      ],
    } as never);

    const s = useStore.getState();
    expect(s.subagents.size).toBe(0);
    expect(s.viewingAgentId).toBeNull();
    expect(s.streamingByAgent.size).toBe(0);
    expect(s.messages.every((m) => !m.parentToolUseId)).toBe(true);
  });
});

describe("turn end and disconnect clear the agent transients", () => {
  test("result clears every agent buffer but keeps the roster", async () => {
    const { handleParsedMessage } = await import("../ws.js");
    handleParsedMessage({
      type: "subagent_update",
      agent: { id: "task-1", parent_id: null, label: "judge_01", status: "running" },
      timestamp: 1_000,
    } as never);
    handleParsedMessage(textDelta("half a ", "task-1") as never);

    handleParsedMessage({
      type: "result",
      data: {
        type: "result", subtype: "success", is_error: false, num_turns: 1, total_cost_usd: 0.1,
        duration_ms: 1, duration_api_ms: 1, stop_reason: null,
        usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        uuid: "u", session_id: "s",
      },
    } as never);

    const s = useStore.getState();
    expect(s.streamingByAgent.size).toBe(0);
    expect(s.activityByAgent.size).toBe(0);
    expect(s.subagents.get("task-1")?.status).toBe("running");
  });

  test("cli_disconnected clears them too", async () => {
    const { handleParsedMessage } = await import("../ws.js");
    handleParsedMessage(textDelta("half a ", "task-1") as never);
    handleParsedMessage({ type: "cli_disconnected" } as never);

    const s = useStore.getState();
    expect(s.streamingByAgent.size).toBe(0);
    expect(s.activityByAgent.size).toBe(0);
    expect(s.subagents.has("task-1")).toBe(true);
  });
});

/**
 * Review follow-ups (#152). Each case below is a defect that shipped in the
 * first cut of the attribution routing and is now pinned.
 */
describe("the two conversations never write into each other", () => {
  test("interleaved root and agent deltas keep separate buffers and separate phases", async () => {
    const { handleParsedMessage } = await import("../ws.js");
    const thinking = (text: string, parent: string | null) => ({
      type: "stream_event" as const,
      event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: text } },
      parent_tool_use_id: parent,
    });

    // Both start a message, then their tokens arrive interleaved and each
    // switches from thinking to text at its own moment. The "*Thinking:*"
    // prefix and the blank line before the answer come from a per-agent
    // phase machine — one shared cursor would leak one agent's phase into
    // the other's transcript.
    handleParsedMessage({ type: "stream_event", event: { type: "message_start" }, parent_tool_use_id: null } as never);
    handleParsedMessage({ type: "stream_event", event: { type: "message_start" }, parent_tool_use_id: "task-1" } as never);
    handleParsedMessage(thinking("root weighs it", null) as never);
    handleParsedMessage(thinking("agent weighs it", "task-1") as never);
    handleParsedMessage(textDelta("root says hi", null) as never);
    handleParsedMessage(textDelta("agent says hi", "task-1") as never);
    handleParsedMessage(textDelta(" and more", "task-1") as never);
    handleParsedMessage(textDelta(" and more", null) as never);

    const s = useStore.getState();
    expect(s.streaming).toBe("*Thinking:* root weighs it\n\nroot says hi and more");
    expect(s.streamingByAgent.get("task-1")).toBe("*Thinking:* agent weighs it\n\nagent says hi and more");
    expect(s.activity?.phase).toBe("responding");
    expect(s.activityByAgent.get("task-1")?.phase).toBe("responding");
  });

  test("a message_start on one side never resets the other side's buffer", async () => {
    const { handleParsedMessage } = await import("../ws.js");
    handleParsedMessage(textDelta("root draft", null) as never);
    handleParsedMessage(textDelta("agent draft", "task-1") as never);

    // The root agent starts its next message while the subagent is mid-answer.
    handleParsedMessage({ type: "stream_event", event: { type: "message_start" }, parent_tool_use_id: null } as never);
    expect(useStore.getState().streaming).toBe("");
    expect(useStore.getState().streamingByAgent.get("task-1")).toBe("agent draft");

    // …and the other way round.
    handleParsedMessage(textDelta("root again", null) as never);
    handleParsedMessage({ type: "stream_event", event: { type: "message_start" }, parent_tool_use_id: "task-1" } as never);
    expect(useStore.getState().streamingByAgent.get("task-1")).toBe("");
    expect(useStore.getState().streaming).toBe("root again");
  });

  test("a subagent's streaming Write never drives the editor's live file preview", async () => {
    const { handleParsedMessage } = await import("../ws.js");
    const blockStart = (parent: string | null) => ({
      type: "stream_event" as const,
      event: { type: "content_block_start", content_block: { type: "tool_use", id: "w-1", name: "Write" } },
      parent_tool_use_id: parent,
    });
    const jsonDelta = (partial: string, parent: string | null) => ({
      type: "stream_event" as const,
      event: { type: "content_block_delta", delta: { type: "input_json_delta", partial_json: partial } },
      parent_tool_use_id: parent,
    });

    handleParsedMessage(blockStart("task-1") as never);
    handleParsedMessage(jsonDelta('{"file_path": "/agent/secret.md", "content": "not the root', "task-1") as never);
    // The live "agent is writing this file" surface belongs to the main
    // conversation (§5.2) — a subagent's write must not take it over.
    expect(useStore.getState().streamingFileWrite).toBeNull();

    // The root agent's own streaming write still resolves, and the subagent's
    // frames did not poison the accumulator it reads from.
    handleParsedMessage(blockStart(null) as never);
    handleParsedMessage(jsonDelta('{"file_path": "/site/index.html", "content": "hello', null) as never);
    expect(useStore.getState().streamingFileWrite).toEqual({ path: "/site/index.html", content: "hello" });
    handleParsedMessage({
      type: "stream_event",
      event: { type: "content_block_stop" },
      parent_tool_use_id: null,
    } as never);
    expect(useStore.getState().streamingFileWrite).toBeNull();
  });
});

describe("folding a history keeps a subagent's tool calls out of the session panels", () => {
  test("an attributed TodoWrite does not replace the root task panel on reload", async () => {
    const { handleParsedMessage } = await import("../ws.js");
    const todo = (id: string, content: string) => ({
      type: "tool_use",
      id,
      name: "TodoWrite",
      input: { todos: [{ content, status: "pending", activeForm: content }] },
    });

    handleParsedMessage({
      type: "message_history",
      messages: [
        { type: "user_message", id: "u1", content: "plan it", timestamp: 100 },
        { ...assistantEnvelope("m1", "here is the plan", null, [todo("hist-root-todo", "root plan")]), timestamp: 200 },
        {
          ...assistantEnvelope("m2", "my own plan", "task-1", [
            todo("hist-agent-todo", "subagent plan"),
            { type: "tool_use", id: "hist-agent-cron", name: "CronCreate", input: { cron: "0 9 * * *", prompt: "agent cron" } },
            { type: "tool_use", id: "hist-agent-ask", name: "AskUserQuestion", input: { question: "which one?" } },
          ]),
          timestamp: 300,
        },
      ],
    } as never);

    const s = useStore.getState();
    // The root's list survives the subagent's, exactly as on the live path.
    expect(s.tasks.map((t) => t.subject)).toEqual(["root plan"]);
    // A subagent's schedule is not the session's schedule…
    expect(s.cronJobs.some((j) => j.prompt === "agent cron")).toBe(false);
    // …and a question it asked its own runtime was never put to this user.
    expect(s.answeredQuestions.has("hist-agent-ask")).toBe(false);
  });

  test("a root AskUserQuestion in the same history is still marked answered", async () => {
    const { handleParsedMessage } = await import("../ws.js");
    handleParsedMessage({
      type: "message_history",
      messages: [
        { type: "user_message", id: "u1", content: "ask me", timestamp: 100 },
        {
          ...assistantEnvelope("m1", "", null, [
            { type: "tool_use", id: "hist-root-ask", name: "AskUserQuestion", input: { question: "which one?" } },
          ]),
          timestamp: 200,
        },
      ],
    } as never);
    expect(useStore.getState().answeredQuestions.has("hist-root-ask")).toBe(true);
  });

  test("a live attributed message still creates a running fallback entry", async () => {
    const { handleParsedMessage } = await import("../ws.js");
    handleParsedMessage(assistantEnvelope("m-live", "working on it", "task-live") as never);
    expect(useStore.getState().subagents.get("task-live")?.status).toBe("running");
  });

  test("a history rebuild returns to the root view even when the open agent still exists", async () => {
    const { handleParsedMessage } = await import("../ws.js");
    handleParsedMessage({
      type: "subagent_update",
      agent: { id: "task-1", parent_id: null, label: "judge_01", status: "running" },
      timestamp: 1_000,
    } as never);
    useStore.getState().setViewingAgent("task-1");

    handleParsedMessage({
      type: "message_history",
      messages: [
        { type: "user_message", id: "u1", content: "again", timestamp: 100 },
        { type: "subagent_update", agent: { id: "task-1", parent_id: null, label: "judge_01", status: "running" }, timestamp: 150 },
        { ...assistantEnvelope("m2", "still judging", "task-1"), timestamp: 300 },
      ],
    } as never);

    // The roster still has the agent; the view does not follow it across a
    // rebuild — `message_history` restarts the panel at the root conversation.
    expect(useStore.getState().subagents.has("task-1")).toBe(true);
    expect(useStore.getState().viewingAgentId).toBeNull();
  });
});

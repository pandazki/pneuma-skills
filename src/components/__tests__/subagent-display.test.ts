import { describe, expect, test } from "bun:test";
import {
  collectToolUseIds,
  deriveSubagentLabel,
  latestSubagentActivity,
  orphanSubagentPlacements,
  streamingTail,
  stripChipEntries,
  subagentAncestry,
} from "../subagent-display.js";
import type { SubagentEntry } from "../../store/subagent-slice.js";
import type { ChatMessage } from "../../types.js";

function entry(over: Partial<SubagentEntry> & { id: string }): SubagentEntry {
  return {
    parent_id: null,
    label: "",
    status: "running",
    firstSeenAt: 0,
    lastActivityAt: 0,
    ...over,
  };
}

function roster(...entries: SubagentEntry[]): Map<string, SubagentEntry> {
  return new Map(entries.map((e) => [e.id, e]));
}

function assistant(id: string, parent: string | null, over: Partial<ChatMessage> = {}): ChatMessage {
  return { id, role: "assistant", content: "", timestamp: 0, parentToolUseId: parent, ...over };
}

describe("deriveSubagentLabel", () => {
  test("the roster label wins", () => {
    expect(deriveSubagentLabel(entry({ id: "a", label: "judge_01" }), { description: "ignored" }, "Subagent"))
      .toBe("judge_01");
  });

  test("a fallback entry falls back to the spawn call's description, then its type", () => {
    expect(deriveSubagentLabel(entry({ id: "a" }), { description: "judge the captures" }, "Subagent"))
      .toBe("judge the captures");
    expect(deriveSubagentLabel(entry({ id: "a" }), { subagent_type: "code-reviewer" }, "Subagent"))
      .toBe("code-reviewer");
  });

  test("with nothing to go on it reads as the generic label", () => {
    expect(deriveSubagentLabel(undefined, undefined, "子代理")).toBe("子代理");
    expect(deriveSubagentLabel(entry({ id: "a", label: "   " }), {}, "子代理")).toBe("子代理");
  });
});

describe("subagentAncestry", () => {
  test("returns the chain outermost-first", () => {
    const map = roster(
      entry({ id: "builder", label: "builder_02" }),
      entry({ id: "judge", label: "judge_01", parent_id: "builder" }),
    );
    expect(subagentAncestry(map, "judge").map((e) => e.label)).toEqual(["builder_02", "judge_01"]);
  });

  test("a broken parent link still yields the agent itself", () => {
    const map = roster(entry({ id: "judge", label: "judge_01", parent_id: "gone" }));
    expect(subagentAncestry(map, "judge").map((e) => e.id)).toEqual(["judge"]);
  });

  test("a cycle terminates instead of hanging the render", () => {
    const map = roster(
      entry({ id: "a", parent_id: "b" }),
      entry({ id: "b", parent_id: "a" }),
    );
    expect(subagentAncestry(map, "a").map((e) => e.id)).toEqual(["b", "a"]);
  });
});

describe("latestSubagentActivity", () => {
  const describeTool = (name: string, input: Record<string, unknown>) => `${name} ${String(input.file_path ?? "")}`.trim();

  test("reads the last tool call of that agent's own messages", () => {
    const messages = [
      assistant("m1", null, { contentBlocks: [{ type: "text", text: "root text" }] }),
      assistant("m2", "task-1", {
        contentBlocks: [
          { type: "text", text: "looking" },
          { type: "tool_use", id: "t1", name: "Read", input: { file_path: "captures/round-3.png" } },
        ],
      }),
    ];
    expect(latestSubagentActivity(messages, "task-1", describeTool)).toBe("Read captures/round-3.png");
  });

  test("falls back to the last text it produced, collapsed to one line", () => {
    const messages = [
      assistant("m2", "task-1", { contentBlocks: [{ type: "text", text: "the third\n capture   is the one" }] }),
    ];
    expect(latestSubagentActivity(messages, "task-1", describeTool)).toBe("the third capture is the one");
  });

  test("another agent's messages never leak in", () => {
    const messages = [assistant("m2", "task-2", { contentBlocks: [{ type: "text", text: "not mine" }] })];
    expect(latestSubagentActivity(messages, "task-1", describeTool)).toBeNull();
  });
});

describe("streamingTail", () => {
  test("is the last non-empty line", () => {
    expect(streamingTail("first\n\nsecond line  ")).toBe("second line");
    expect(streamingTail("")).toBeNull();
    expect(streamingTail(undefined)).toBeNull();
  });
});

describe("orphanSubagentPlacements", () => {
  test("no roster means no synthetic cards at all", () => {
    const placements = orphanSubagentPlacements([assistant("m1", null)], new Map(), null);
    expect(placements.beforeMessageId.size).toBe(0);
    expect(placements.trailing).toEqual([]);
  });

  test("an anchored agent has a card already and gets no synthetic one", () => {
    const messages = [
      assistant("m1", null, {
        contentBlocks: [{ type: "tool_use", id: "task-1", name: "Task", input: { description: "judge" } }],
      }),
      assistant("m2", "task-1", { contentBlocks: [{ type: "text", text: "done" }] }),
    ];
    expect(collectToolUseIds(messages).has("task-1")).toBe(true);
    const placements = orphanSubagentPlacements(messages, roster(entry({ id: "task-1" })), null);
    expect(placements.beforeMessageId.size).toBe(0);
    expect(placements.trailing).toEqual([]);
  });

  test("an unanchored agent lands before the next root message, in order", () => {
    // The pre-fix Claude shape: the `Task` call is gone from history, the
    // subagent's reply survives, and a root message follows it.
    const messages = [
      assistant("m1", null),
      assistant("m2", "task-1", { contentBlocks: [{ type: "text", text: "subagent reply" }] }),
      assistant("m3", null),
      assistant("m4", null),
    ];
    const placements = orphanSubagentPlacements(messages, roster(entry({ id: "task-1" })), null);
    expect(placements.beforeMessageId.get("m3")).toEqual(["task-1"]);
    expect(placements.trailing).toEqual([]);
  });

  test("with no root message after it, the card trails the conversation", () => {
    const messages = [
      assistant("m1", null),
      assistant("m2", "task-1", { contentBlocks: [{ type: "text", text: "subagent reply" }] }),
    ];
    const placements = orphanSubagentPlacements(messages, roster(entry({ id: "task-1" })), null);
    expect(placements.beforeMessageId.size).toBe(0);
    expect(placements.trailing).toEqual(["task-1"]);
  });

  test("a nested agent's card belongs to its spawner's view, not the root's", () => {
    const messages = [
      assistant("m1", null),
      assistant("m2", "outer", { contentBlocks: [{ type: "text", text: "outer" }] }),
      assistant("m3", "inner", { contentBlocks: [{ type: "text", text: "inner" }] }),
      assistant("m4", "outer", { contentBlocks: [{ type: "text", text: "outer again" }] }),
    ];
    const map = roster(entry({ id: "outer" }), entry({ id: "inner", parent_id: "outer" }));
    // Root view: only `outer` is placed (no root message follows its first
    // attributed message, so its card trails the conversation).
    const rootPlacements = orphanSubagentPlacements(messages, map, null);
    expect(rootPlacements.trailing).toEqual(["outer"]);
    expect([...rootPlacements.beforeMessageId.values()].flat()).toEqual([]);
    // Outer's view: `inner` sits before outer's next message.
    const outerPlacements = orphanSubagentPlacements(messages, map, "outer");
    expect(outerPlacements.beforeMessageId.get("m4")).toEqual(["inner"]);
    expect(outerPlacements.trailing).toEqual([]);
  });
});

describe("an orphan that never said anything", () => {
  test("trails the conversation instead of jumping to the top of it", () => {
    // A roster entry with no anchor block *and* no attributed message has no
    // position in the conversation to claim. Searching from index 0 put its
    // card above the first message of the session — in front of history it
    // had nothing to do with.
    const messages = [
      assistant("m1", null, { contentBlocks: [{ type: "text", text: "first" }] }),
      assistant("m2", null, { contentBlocks: [{ type: "text", text: "second" }] }),
    ];
    const placements = orphanSubagentPlacements(messages, roster(entry({ id: "ghost" })), null);
    expect(placements.beforeMessageId.size).toBe(0);
    expect(placements.trailing).toEqual(["ghost"]);
  });

  test("it does not displace an orphan that did speak", () => {
    const messages = [
      assistant("m1", null),
      assistant("m2", "spoke", { contentBlocks: [{ type: "text", text: "reply" }] }),
      assistant("m3", null),
    ];
    const placements = orphanSubagentPlacements(
      messages,
      roster(entry({ id: "spoke", firstSeenAt: 1 }), entry({ id: "ghost", firstSeenAt: 2 })),
      null,
    );
    expect(placements.beforeMessageId.get("m3")).toEqual(["spoke"]);
    expect(placements.trailing).toEqual(["ghost"]);
  });
});

describe("stripChipEntries", () => {
  test("alive agents, oldest first, plus the open view even once it finished", () => {
    const map = roster(
      entry({ id: "a", firstSeenAt: 2, status: "running" }),
      entry({ id: "b", firstSeenAt: 1, status: "idle" }),
      entry({ id: "c", firstSeenAt: 3, status: "completed" }),
      entry({ id: "d", firstSeenAt: 4, status: "failed" }),
    );
    expect(stripChipEntries(map, null).map((e) => e.id)).toEqual(["b", "a"]);
    // Viewing the completed agent keeps its chip so the switcher can leave it.
    expect(stripChipEntries(map, "c").map((e) => e.id)).toEqual(["b", "a", "c"]);
  });

  test("an empty roster produces no chips at all — the panel's header row rule", () => {
    expect(stripChipEntries(new Map(), null)).toEqual([]);
    // A view opened on an agent the roster never heard of is still chip-less;
    // the ChatPanel keeps the header row for the breadcrumb in that case.
    expect(stripChipEntries(new Map(), "unknown")).toEqual([]);
  });
});

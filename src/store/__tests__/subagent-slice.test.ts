import { beforeEach, describe, expect, test } from "bun:test";
import { useStore } from "../index.js";
import { isAliveSubagent } from "../subagent-slice.js";
import type { SubagentInfo } from "../../types.js";

/**
 * The roster and the per-agent transients. `subagent_update` is a state
 * snapshot, not a delta (§3.1), and an attributed envelope may arrive before
 * — or entirely without — its snapshot (§3.4), so the fallback path is what
 * keeps a pre-fix Claude history readable.
 */

function info(over: Partial<SubagentInfo> & { id: string }): SubagentInfo {
  return { parent_id: null, label: "", status: "running", ...over };
}

beforeEach(() => {
  useStore.getState().resetSubagents();
});

describe("roster", () => {
  test("upsert replaces the whole entry and keeps the client clocks", () => {
    const s = () => useStore.getState();
    s().upsertSubagent(info({ id: "a1", label: "judge_01", model: "gpt-6" }), 1_000);
    expect(s().subagents.get("a1")).toMatchObject({
      id: "a1",
      label: "judge_01",
      status: "running",
      model: "gpt-6",
      firstSeenAt: 1_000,
      lastActivityAt: 1_000,
    });

    // A later snapshot replaces the fields it carries — including dropping
    // `model` if the emitter no longer reports it — but the elapsed clock
    // must not restart, or the card's "42s" would reset on every status flip.
    s().upsertSubagent(info({ id: "a1", label: "judge_01", status: "completed" }), 5_000);
    const entry = s().subagents.get("a1")!;
    expect(entry.status).toBe("completed");
    expect(entry.model).toBeUndefined();
    expect(entry.firstSeenAt).toBe(1_000);
    expect(entry.lastActivityAt).toBe(5_000);
  });

  test("touch creates a generic fallback entry for an unknown agent", () => {
    useStore.getState().touchSubagent("orphan-1", 2_000);
    expect(useStore.getState().subagents.get("orphan-1")).toEqual({
      id: "orphan-1",
      parent_id: null,
      label: "",
      status: "running",
      firstSeenAt: 2_000,
      lastActivityAt: 2_000,
    });
  });

  test("touch on a known agent only bumps lastActivityAt forward", () => {
    const s = () => useStore.getState();
    s().upsertSubagent(info({ id: "a1", label: "judge_01" }), 1_000);
    s().touchSubagent("a1", 3_000);
    expect(s().subagents.get("a1")).toMatchObject({ label: "judge_01", lastActivityAt: 3_000 });
    // Out-of-order history entries must not rewind the clock.
    s().touchSubagent("a1", 2_000);
    expect(s().subagents.get("a1")!.lastActivityAt).toBe(3_000);
  });

  test("a snapshot after a fallback entry fills in the real label", () => {
    const s = () => useStore.getState();
    s().touchSubagent("a1", 1_000);
    expect(s().subagents.get("a1")!.label).toBe("");
    s().upsertSubagent(info({ id: "a1", label: "judge_01", parent_id: "b1" }), 1_200);
    expect(s().subagents.get("a1")).toMatchObject({ label: "judge_01", parent_id: "b1", firstSeenAt: 1_000 });
  });

  test("only running / idle / interrupted agents count as alive for the strip", () => {
    expect(isAliveSubagent(info({ id: "x", status: "running" }))).toBe(true);
    expect(isAliveSubagent(info({ id: "x", status: "idle" }))).toBe(true);
    expect(isAliveSubagent(info({ id: "x", status: "interrupted" }))).toBe(true);
    expect(isAliveSubagent(info({ id: "x", status: "completed" }))).toBe(false);
    expect(isAliveSubagent(info({ id: "x", status: "failed" }))).toBe(false);
  });
});

describe("view stack", () => {
  test("switching views is pure UI state; returning to root clears the unread mark", () => {
    const s = () => useStore.getState();
    s().upsertSubagent(info({ id: "a1", label: "judge_01" }), 1_000);
    s().setViewingAgent("a1");
    expect(s().viewingAgentId).toBe("a1");
    s().setRootUnread(true);
    expect(s().rootUnread).toBe(true);

    s().setViewingAgent(null);
    expect(s().viewingAgentId).toBeNull();
    expect(s().rootUnread).toBe(false);
    // The roster itself is untouched by navigation.
    expect(s().subagents.size).toBe(1);
  });
});

describe("transients", () => {
  test("streaming and activity are per agent and clear independently", () => {
    const s = () => useStore.getState();
    s().setAgentStreaming("a1", "hel");
    s().setAgentStreaming("a1", "hello");
    s().setAgentActivity("a1", { phase: "tool", toolName: "Read", startedAt: 10 });
    s().setAgentStreaming("a2", "other");
    expect(s().streamingByAgent.get("a1")).toBe("hello");
    expect(s().activityByAgent.get("a1")?.toolName).toBe("Read");

    s().setAgentStreaming("a1", null);
    expect(s().streamingByAgent.has("a1")).toBe(false);
    expect(s().streamingByAgent.get("a2")).toBe("other");
    s().setAgentActivity("a1", null);
    expect(s().activityByAgent.size).toBe(0);
  });

  test("clearAgentTransients drops every buffer but keeps the roster status", () => {
    const s = () => useStore.getState();
    s().upsertSubagent(info({ id: "a1", label: "judge_01", status: "running" }), 1_000);
    s().setAgentStreaming("a1", "half a sentence");
    s().setAgentActivity("a1", { phase: "responding", startedAt: 10 });

    s().clearAgentTransients();
    expect(s().streamingByAgent.size).toBe(0);
    expect(s().activityByAgent.size).toBe(0);
    // An honest "running" for an agent whose fate is unknown (§6).
    expect(s().subagents.get("a1")!.status).toBe("running");
  });

  test("resetSubagents wipes roster, view and buffers for a history rebuild", () => {
    const s = () => useStore.getState();
    s().upsertSubagent(info({ id: "a1", label: "judge_01" }), 1_000);
    s().setViewingAgent("a1");
    s().setRootUnread(true);
    s().setAgentStreaming("a1", "text");
    s().setAgentActivity("a1", { phase: "thinking", startedAt: 1 });

    s().resetSubagents();
    expect(s().subagents.size).toBe(0);
    expect(s().viewingAgentId).toBeNull();
    expect(s().rootUnread).toBe(false);
    expect(s().streamingByAgent.size).toBe(0);
    expect(s().activityByAgent.size).toBe(0);
  });
});

describe("a terminal status ends that agent's output", () => {
  test("completing an agent drops its streaming buffer and its activity", () => {
    const s = () => useStore.getState();
    s().upsertSubagent(info({ id: "a1", label: "judge_01", status: "running" }), 1_000);
    s().setAgentStreaming("a1", "half a sentence");
    s().setAgentActivity("a1", { phase: "responding", startedAt: 10 });
    // A second agent is still working — it must not be swept up.
    s().setAgentStreaming("a2", "still going");
    s().setAgentActivity("a2", { phase: "tool", toolName: "Read", startedAt: 10 });

    s().upsertSubagent(info({ id: "a1", label: "judge_01", status: "completed" }), 2_000);

    // Otherwise the finished agent's card keeps a "writing now" dot and a
    // running elapsed clock until the whole turn ends, which can be minutes.
    expect(s().streamingByAgent.has("a1")).toBe(false);
    expect(s().activityByAgent.has("a1")).toBe(false);
    expect(s().streamingByAgent.get("a2")).toBe("still going");
    expect(s().activityByAgent.get("a2")?.toolName).toBe("Read");
    expect(s().subagents.get("a1")!.status).toBe("completed");
  });

  test("failed clears too; interrupted is still alive and keeps its buffers", () => {
    const s = () => useStore.getState();
    s().setAgentStreaming("a1", "mid-sentence");
    s().upsertSubagent(info({ id: "a1", status: "failed", detail: "tool denied" }), 1_000);
    expect(s().streamingByAgent.has("a1")).toBe(false);

    s().setAgentStreaming("a2", "mid-sentence");
    s().upsertSubagent(info({ id: "a2", status: "interrupted" }), 1_000);
    expect(s().streamingByAgent.get("a2")).toBe("mid-sentence");
  });
});

describe("where a fallback entry starts", () => {
  test("a live envelope creates it running; a folded history creates it idle", () => {
    const s = () => useStore.getState();
    s().touchSubagent("live-1", 1_000);
    expect(s().subagents.get("live-1")!.status).toBe("running");

    s().touchSubagent("hist-1", 1_000, { status: "idle" });
    expect(s().subagents.get("hist-1")!.status).toBe("idle");
    // Both are alive, so both keep their chip in the strip.
    expect(isAliveSubagent(s().subagents.get("hist-1")!)).toBe(true);
  });

  test("the requested status only seeds a new entry — a known one keeps the roster's", () => {
    const s = () => useStore.getState();
    s().upsertSubagent(info({ id: "a1", label: "judge_01", status: "completed" }), 1_000);
    s().touchSubagent("a1", 2_000, { status: "idle" });
    expect(s().subagents.get("a1")).toMatchObject({ status: "completed", lastActivityAt: 2_000 });
  });
});

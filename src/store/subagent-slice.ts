import type { StateCreator } from "zustand";
import type { SubagentInfo } from "../types.js";
import type { AppState, Activity } from "./types.js";

/**
 * A roster entry plus the two timestamps the card needs. `firstSeenAt` is the
 * clock the "running · 42s" elapsed reads from; `lastActivityAt` is bumped by
 * every attributed envelope so the strip can order agents by recency.
 */
export interface SubagentEntry extends SubagentInfo {
  firstSeenAt: number;
  lastActivityAt: number;
}

/** Statuses that keep an agent in the strip (§2.4). */
const ALIVE_STATUSES = new Set<SubagentInfo["status"]>(["running", "idle", "interrupted"]);

export function isAliveSubagent(entry: SubagentInfo): boolean {
  return ALIVE_STATUSES.has(entry.status);
}

export interface SubagentSlice {
  /** Roster, keyed by the attribution key (`SubagentInfo.id`). */
  subagents: Map<string, SubagentEntry>;
  /** null = root conversation. Transient UI state; never persisted. */
  viewingAgentId: string | null;
  /** Per-agent streaming buffer — the root agent's stays in `streaming`. */
  streamingByAgent: Map<string, string>;
  /** Per-agent activity — the root agent's stays in `activity`. */
  activityByAgent: Map<string, Activity>;
  /** Root messages arrived while an agent view was open. */
  rootUnread: boolean;

  upsertSubagent: (info: SubagentInfo, timestamp: number) => void;
  /** A message attributed to `id` arrived: create a fallback entry if missing, bump lastActivityAt. */
  touchSubagent: (id: string, timestamp: number) => void;
  setViewingAgent: (id: string | null) => void;
  setAgentStreaming: (id: string, text: string | null) => void;
  setAgentActivity: (id: string, activity: Activity | null) => void;
  /** Root messages landed while an agent view is open (or the user read them). */
  setRootUnread: (unread: boolean) => void;
  /** streaming + activity for all agents (result / disconnect). */
  clearAgentTransients: () => void;
  /** message_history rebuild — roster and view state start from scratch. */
  resetSubagents: () => void;
}

export const createSubagentSlice: StateCreator<AppState, [], [], SubagentSlice> = (set) => ({
  subagents: new Map(),
  viewingAgentId: null,
  streamingByAgent: new Map(),
  activityByAgent: new Map(),
  rootUnread: false,

  // `subagent_update` is a state snapshot, never a delta (§3.1): the whole
  // `SubagentInfo` replaces the entry. Only the client-side clocks survive, so
  // a status flip doesn't restart the elapsed counter.
  upsertSubagent: (info, timestamp) =>
    set((s) => {
      const prev = s.subagents.get(info.id);
      const next = new Map(s.subagents);
      next.set(info.id, {
        ...info,
        firstSeenAt: prev?.firstSeenAt ?? timestamp,
        lastActivityAt: Math.max(prev?.lastActivityAt ?? 0, timestamp),
      });
      return { subagents: next };
    }),

  // Fallback derivation (§3.4): an attributed envelope may arrive before (or
  // entirely without) its roster snapshot — a pre-fix Claude history has the
  // `parent_tool_use_id` but no `subagent_update` at all. An entry with an
  // empty label renders as the generic 子代理.
  touchSubagent: (id, timestamp) =>
    set((s) => {
      const prev = s.subagents.get(id);
      const next = new Map(s.subagents);
      if (!prev) {
        next.set(id, {
          id,
          parent_id: null,
          label: "",
          status: "running",
          firstSeenAt: timestamp,
          lastActivityAt: timestamp,
        });
        return { subagents: next };
      }
      if (timestamp <= prev.lastActivityAt) return s;
      next.set(id, { ...prev, lastActivityAt: timestamp });
      return { subagents: next };
    }),

  setViewingAgent: (id) =>
    set((s) =>
      // Returning to the root conversation is also reading it.
      id === null
        ? { viewingAgentId: null, rootUnread: false }
        : s.viewingAgentId === id
          ? s
          : { viewingAgentId: id },
    ),

  setAgentStreaming: (id, text) =>
    set((s) => {
      if (text === null) {
        if (!s.streamingByAgent.has(id)) return s;
        const next = new Map(s.streamingByAgent);
        next.delete(id);
        return { streamingByAgent: next };
      }
      const next = new Map(s.streamingByAgent);
      next.set(id, text);
      return { streamingByAgent: next };
    }),

  setAgentActivity: (id, activity) =>
    set((s) => {
      if (activity === null) {
        if (!s.activityByAgent.has(id)) return s;
        const next = new Map(s.activityByAgent);
        next.delete(id);
        return { activityByAgent: next };
      }
      const next = new Map(s.activityByAgent);
      next.set(id, activity);
      return { activityByAgent: next };
    }),

  setRootUnread: (unread) =>
    set((s) => (s.rootUnread === unread ? s : { rootUnread: unread })),

  // The turn ended or the CLI went away: no agent is producing output any
  // more. The roster keeps its last known status — an honest "running" of an
  // agent whose fate is unknown beats inventing "completed" (§6).
  clearAgentTransients: () =>
    set((s) => {
      if (s.streamingByAgent.size === 0 && s.activityByAgent.size === 0) return s;
      return { streamingByAgent: new Map(), activityByAgent: new Map() };
    }),

  resetSubagents: () =>
    set({
      subagents: new Map(),
      viewingAgentId: null,
      streamingByAgent: new Map(),
      activityByAgent: new Map(),
      rootUnread: false,
    }),
});

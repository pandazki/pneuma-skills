import type { StateCreator } from "zustand";
import type { SubagentInfo, SubagentStatus } from "../types.js";
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

/** Everything the roster owns, back at its empty state. */
export type SubagentResetState = Pick<
  SubagentSlice,
  "subagents" | "viewingAgentId" | "streamingByAgent" | "activityByAgent" | "rootUnread"
>;

/**
 * The single definition of "no team is known". `resetSubagents` is one caller;
 * replay's enter / exit / seek are the others — a scrub rebuilds `messages`
 * from scratch, so the roster and the open agent view have to start over with
 * it or the rebuilt conversation inherits phantom cards from the future.
 */
export function subagentResetState(): SubagentResetState {
  return {
    subagents: new Map(),
    viewingAgentId: null,
    streamingByAgent: new Map(),
    activityByAgent: new Map(),
    rootUnread: false,
  };
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
  /**
   * A message attributed to `id` arrived: create a fallback entry if missing,
   * bump lastActivityAt. `status` picks the status a *created* entry starts
   * from (a live envelope means the agent is producing output right now;
   * folding a persisted history does not — §3.4); an existing entry keeps
   * whatever status the roster last reported.
   */
  touchSubagent: (id: string, timestamp: number, opts?: { status?: SubagentStatus }) => void;
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
  ...subagentResetState(),

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
      const patch: Partial<SubagentSlice> = { subagents: next };
      // A terminal status is the end of that agent's output. Its streaming
      // buffer and activity indicator would otherwise keep a "writing now"
      // dot and a running elapsed clock on a finished agent until the whole
      // turn ends (`clearAgentTransients`), which can be many minutes later.
      if (!isAliveSubagent(info)) {
        if (s.streamingByAgent.has(info.id)) {
          const streaming = new Map(s.streamingByAgent);
          streaming.delete(info.id);
          patch.streamingByAgent = streaming;
        }
        if (s.activityByAgent.has(info.id)) {
          const activity = new Map(s.activityByAgent);
          activity.delete(info.id);
          patch.activityByAgent = activity;
        }
      }
      return patch;
    }),

  // Fallback derivation (§3.4): an attributed envelope may arrive before (or
  // entirely without) its roster snapshot — a pre-fix Claude history has the
  // `parent_tool_use_id` but no `subagent_update` at all. An entry with an
  // empty label renders as the generic 子代理.
  touchSubagent: (id, timestamp, opts) =>
    set((s) => {
      const prev = s.subagents.get(id);
      const next = new Map(s.subagents);
      if (!prev) {
        next.set(id, {
          id,
          parent_id: null,
          label: "",
          status: opts?.status ?? "running",
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

  resetSubagents: () => set(subagentResetState()),
});

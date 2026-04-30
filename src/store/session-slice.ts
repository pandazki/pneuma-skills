import type { StateCreator } from "zustand";
import type { SessionState } from "../types.js";
import type { AppState } from "./types.js";

export interface SessionSlice {
  session: SessionState | null;
  sessionId: string | null;
  /**
   * Absolute path to the agent's CWD for this session — equals the project
   * session dir for project sessions, the workspace for quick sessions.
   * Set from the `/api/session` response. Used by tabbar affordances (e.g.
   * the Editor panel's open-in-IDE button) that should target the
   * session's surface, not the shared project root. `null` until the
   * `/api/session` fetch resolves.
   */
  sessionWorkspace: string | null;
  connectionStatus: "connecting" | "connected" | "disconnected";
  cliConnected: boolean;
  sessionStatus: "idle" | "running" | "compacting" | null;
  /** True from user message send until result received — controls input disable */
  turnInProgress: boolean;

  setSession: (session: SessionState) => void;
  updateSession: (updates: Partial<SessionState>) => void;
  setSessionId: (id: string) => void;
  setSessionWorkspace: (path: string | null) => void;
  setConnectionStatus: (status: "connecting" | "connected" | "disconnected") => void;
  setCliConnected: (connected: boolean) => void;
  setSessionStatus: (status: "idle" | "running" | "compacting" | null) => void;
  setTurnInProgress: (v: boolean) => void;
}

export const createSessionSlice: StateCreator<AppState, [], [], SessionSlice> = (set) => ({
  session: null,
  sessionId: null,
  sessionWorkspace: null,
  connectionStatus: "disconnected",
  cliConnected: false,
  sessionStatus: null,
  turnInProgress: false,

  setSession: (session) => set({ session }),
  updateSession: (updates) =>
    set((s) => ({
      session: s.session ? { ...s.session, ...updates } : null,
    })),
  setSessionId: (id) => set({ sessionId: id }),
  setSessionWorkspace: (path) => set({ sessionWorkspace: path }),
  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setCliConnected: (connected) => set({ cliConnected: connected }),
  setSessionStatus: (status) => set({ sessionStatus: status }),
  setTurnInProgress: (v) => set({ turnInProgress: v }),
});

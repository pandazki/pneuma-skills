import type { StateCreator } from "zustand";
import type { SessionState } from "../types.js";
import type { AppState } from "./types.js";

export interface SessionSlice {
  session: SessionState | null;
  sessionId: string | null;
  connectionStatus: "connecting" | "connected" | "disconnected";
  cliConnected: boolean;
  sessionStatus: "idle" | "running" | "compacting" | null;
  /** True from user message send until result received — controls input disable */
  turnInProgress: boolean;

  setSession: (session: SessionState) => void;
  updateSession: (updates: Partial<SessionState>) => void;
  setSessionId: (id: string) => void;
  setConnectionStatus: (status: "connecting" | "connected" | "disconnected") => void;
  setCliConnected: (connected: boolean) => void;
  setSessionStatus: (status: "idle" | "running" | "compacting" | null) => void;
  setTurnInProgress: (v: boolean) => void;
}

export const createSessionSlice: StateCreator<AppState, [], [], SessionSlice> = (set) => ({
  session: null,
  sessionId: null,
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
  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setCliConnected: (connected) => set({ cliConnected: connected }),
  setSessionStatus: (status) => set({ sessionStatus: status }),
  setTurnInProgress: (v) => set({ turnInProgress: v }),
});

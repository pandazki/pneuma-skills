import type { StateCreator } from "zustand";
import type { AppState } from "./types.js";

export interface UiSlice {
  activeTab: "chat" | "editor" | "diff" | "terminal" | "processes" | "context" | "schedules";
  terminalId: string | null;
  debugMode: boolean;
  focusMode: boolean;

  setActiveTab: (tab: "chat" | "editor" | "diff" | "terminal" | "processes" | "context" | "schedules") => void;
  setTerminalId: (id: string | null) => void;
  setDebugMode: (v: boolean) => void;
  setFocusMode: (v: boolean) => void;
}

export const createUiSlice: StateCreator<AppState, [], [], UiSlice> = (set) => ({
  activeTab: "chat",
  terminalId: null,
  debugMode: false,
  focusMode: typeof localStorage === "undefined" || localStorage.getItem("pneuma:focusMode") !== "false",

  setActiveTab: (activeTab) => set({ activeTab }),
  setTerminalId: (terminalId) => set({ terminalId }),
  setDebugMode: (debugMode) => set({ debugMode }),
  setFocusMode: (focusMode) => {
    try { localStorage.setItem("pneuma:focusMode", String(focusMode)); } catch {}
    set({ focusMode, ...(focusMode ? { activeTab: "chat" as const } : {}) });
  },
});

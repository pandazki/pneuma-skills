import type { StateCreator } from "zustand";
import type { AppState } from "./types.js";

/**
 * Tool tabs are the inspection / dev surfaces (editor, diff, terminal, …).
 * Chat is NO LONGER a tab — it is the relocatable Agent Surface (see
 * agent-surface-slice). `activeTab === null` means no tool is open and the
 * viewer gets the full width.
 */
export type ToolTab = "editor" | "diff" | "terminal" | "processes" | "context" | "schedules";

export interface UiSlice {
  activeTab: ToolTab | null;
  terminalId: string | null;
  debugMode: boolean;

  setActiveTab: (tab: ToolTab | null) => void;
  setTerminalId: (id: string | null) => void;
  setDebugMode: (v: boolean) => void;
}

export const createUiSlice: StateCreator<AppState, [], [], UiSlice> = (set) => ({
  activeTab: null,
  terminalId: null,
  debugMode: false,

  setActiveTab: (activeTab) => set({ activeTab }),
  setTerminalId: (terminalId) => set({ terminalId }),
  setDebugMode: (debugMode) => set({ debugMode }),
});

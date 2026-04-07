import type { StateCreator } from "zustand";
import type { AppState } from "./types.js";

export interface PluginInfo {
  name: string;
  displayName: string;
  description: string;
  version: string;
  builtin: boolean;
  scope: string;
  hasRoutes: boolean;
  hooks: string[];
  slots: string[];
  settings: string[];
}

export interface PluginSlice {
  activePlugins: PluginInfo[];
  setActivePlugins: (plugins: PluginInfo[]) => void;
}

export const createPluginSlice: StateCreator<AppState, [], [], PluginSlice> = (set) => ({
  activePlugins: [],
  setActivePlugins: (activePlugins) => set({ activePlugins }),
});

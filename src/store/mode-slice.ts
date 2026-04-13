import type { StateCreator } from "zustand";
import type { ViewerContract, ViewerCommandDescriptor } from "../../core/types/viewer-contract.js";
import type { ModeManifest } from "../../core/types/mode-manifest.js";
import type { AppState } from "./types.js";
import { filterAndRemapFiles } from "./helpers.js";

export interface ModeSlice {
  modeViewer: ViewerContract | null;
  modeManifest: ModeManifest | null;
  modeDisplayName: string;
  modeCommands: ViewerCommandDescriptor[];
  initParams: Record<string, number | string>;
  layout: "editor" | "app";
  editing: boolean;
  editingSupported: boolean;

  setModeViewer: (viewer: ViewerContract) => void;
  setModeManifest: (manifest: ModeManifest | null) => void;
  setModeDisplayName: (name: string) => void;
  setModeCommands: (commands: ViewerCommandDescriptor[]) => void;
  setInitParams: (params: Record<string, number | string>) => void;
  setLayout: (layout: "editor" | "app") => void;
  setEditing: (editing: boolean) => void;
  setEditingSupported: (v: boolean) => void;
}

export const createModeSlice: StateCreator<AppState, [], [], ModeSlice> = (set) => ({
  modeViewer: null,
  modeManifest: null,
  modeDisplayName: "",
  modeCommands: [],
  initParams: {},
  layout: "editor",
  editing: true,
  editingSupported: false,

  setModeViewer: (modeViewer) =>
    set((s) => {
      const ws = modeViewer.workspace;
      const contentSets = ws?.resolveContentSets ? ws.resolveContentSets(s.files) : [];
      const contentSetsChanged =
        contentSets.length !== s.contentSets.length ||
        contentSets.some((v, i) => v.prefix !== s.contentSets[i]?.prefix);
      let activeContentSet = s.activeContentSet;
      if (!activeContentSet && contentSets.length > 0) {
        activeContentSet = contentSets[0].prefix;
      }
      const filtered = activeContentSet ? filterAndRemapFiles(s.files, activeContentSet) : s.files;
      const resolveItems = ws?.resolveItems;
      return {
        modeViewer,
        ...(contentSetsChanged ? { contentSets, activeContentSet } : {}),
        workspaceItems: resolveItems ? resolveItems(filtered) : s.workspaceItems,
      };
    }),
  setModeManifest: (modeManifest) => set({ modeManifest }),
  setModeDisplayName: (modeDisplayName) => set({ modeDisplayName }),
  setModeCommands: (modeCommands) => set({ modeCommands }),
  setInitParams: (initParams) => set({ initParams }),
  setLayout: (layout) => set({ layout }),
  setEditing: (editing) => set({ editing }),
  setEditingSupported: (editingSupported) => set({ editingSupported }),
});

import type { StateCreator } from "zustand";
import type { FileContent } from "../types.js";
import type { WorkspaceItem, ContentSet } from "../../core/types/viewer-contract.js";
import type { AppState } from "./types.js";
import { filterAndRemapFiles } from "./helpers.js";
import { fileEventBus } from "../runtime/file-event-bus.js";

export interface WorkspaceSlice {
  files: FileContent[];
  contentSets: ContentSet[];
  activeContentSet: string | null;
  contentSetUnread: Set<string>;
  workspaceItems: WorkspaceItem[];

  setFiles: (files: FileContent[]) => void;
  updateFiles: (updates: Array<FileContent & { origin?: "self" | "external" }>) => void;
  setActiveContentSet: (prefix: string | null) => void;
}

export const createWorkspaceSlice: StateCreator<AppState, [], [], WorkspaceSlice> = (set) => ({
  files: [],
  contentSets: [],
  activeContentSet: null,
  contentSetUnread: new Set(),
  workspaceItems: [],

  setFiles: (files) => {
    set((s) => {
      const ws = s.modeViewer?.workspace;
      const contentSets = ws?.resolveContentSets ? ws.resolveContentSets(files) : [];
      const contentSetsChanged =
        contentSets.length !== s.contentSets.length ||
        contentSets.some((v, i) => v.prefix !== s.contentSets[i]?.prefix);

      let activeContentSet = s.activeContentSet;
      if (activeContentSet && !contentSets.some((v) => v.prefix === activeContentSet)) {
        activeContentSet = null;
      }
      if (!activeContentSet && contentSets.length > 0) {
        activeContentSet = contentSets[0].prefix;
      }

      const filtered = activeContentSet ? filterAndRemapFiles(files, activeContentSet) : files;
      const resolveItems = ws?.resolveItems;
      const newItems = resolveItems ? resolveItems(filtered) : s.workspaceItems;
      let activeFile = s.activeFile;
      if (activeFile && newItems.length > 0 && !newItems.some((i) => i.path === activeFile)) {
        activeFile = null;
      }
      return {
        files,
        ...(contentSetsChanged ? { contentSets } : {}),
        activeContentSet,
        workspaceItems: newItems,
        activeFile,
      };
    });
    // After state has been updated, notify source providers. setFiles is
    // used both on initial mode load (fetch /api/files → setFiles) and
    // on replay-checkpoint boundaries — both cases need the source layer
    // to see the new file list. We tag origin: "external" because the
    // batch is not the echo of any specific in-viewer write.
    fileEventBus.publish(
      files.map((f) => ({
        path: f.path,
        content: f.content,
        origin: "external" as const,
      })),
    );
  },

  updateFiles: (updates) => {
    set((s) => {
      const fileMap = new Map(s.files.map((f) => [f.path, f]));
      for (const u of updates) {
        fileMap.set(u.path, u);
      }
      const files = Array.from(fileMap.values());
      const ws = s.modeViewer?.workspace;
      const contentSets = ws?.resolveContentSets ? ws.resolveContentSets(files) : [];
      const contentSetsChanged =
        contentSets.length !== s.contentSets.length ||
        contentSets.some((v, i) => v.prefix !== s.contentSets[i]?.prefix);

      let activeContentSet = s.activeContentSet;
      if (activeContentSet && !contentSets.some((v) => v.prefix === activeContentSet)) {
        activeContentSet = null;
      }
      if (!activeContentSet && contentSets.length > 0) {
        activeContentSet = contentSets[0].prefix;
      }

      // Mark content sets with changes as unread (if not the active one)
      let contentSetUnread = s.contentSetUnread;
      if (contentSets.length > 1) {
        const touchedPrefixes = new Set<string>();
        for (const u of updates) {
          const slashIdx = u.path.indexOf("/");
          if (slashIdx > 0) {
            const prefix = u.path.slice(0, slashIdx);
            if (prefix !== activeContentSet && contentSets.some((cs) => cs.prefix === prefix)) {
              touchedPrefixes.add(prefix);
            }
          }
        }
        if (touchedPrefixes.size > 0) {
          contentSetUnread = new Set(s.contentSetUnread);
          for (const p of touchedPrefixes) contentSetUnread.add(p);
        }
      }

      const filtered = activeContentSet ? filterAndRemapFiles(files, activeContentSet) : files;
      const resolveItems = ws?.resolveItems;
      const newItems = resolveItems ? resolveItems(filtered) : s.workspaceItems;
      let activeFile = s.activeFile;
      if (activeFile && newItems.length > 0 && !newItems.some((i) => i.path === activeFile)) {
        activeFile = null;
      }
      return {
        files,
        ...(contentSetsChanged ? { contentSets } : {}),
        activeContentSet,
        contentSetUnread,
        workspaceItems: newItems,
        activeFile,
      };
    });
    // After state has been updated, notify source providers.
    fileEventBus.publish(
      updates.map((u) => ({
        path: u.path,
        content: u.content,
        origin: u.origin ?? "external",
      })),
    );
  },

  setActiveContentSet: (activeContentSet) =>
    set((s) => {
      const resolveItems = s.modeViewer?.workspace?.resolveItems;
      const filtered = activeContentSet ? filterAndRemapFiles(s.files, activeContentSet) : s.files;
      // Clear unread for the content set being selected
      let contentSetUnread = s.contentSetUnread;
      if (activeContentSet && contentSetUnread.has(activeContentSet)) {
        contentSetUnread = new Set(contentSetUnread);
        contentSetUnread.delete(activeContentSet);
      }
      return {
        activeContentSet,
        contentSetUnread,
        activeFile: null,
        selection: null,
        workspaceItems: resolveItems ? resolveItems(filtered) : s.workspaceItems,
      };
    }),
});

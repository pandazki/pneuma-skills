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
  /**
   * True once the initial workspace load has RESOLVED (success or empty).
   * Before this, `files: []` is ambiguous — "still fetching" and "empty
   * workspace" look identical. The app shell flips it after the initial
   * `/api/files` (or replay package) load; it never goes back to false.
   */
  filesHydrated: boolean;
  /**
   * The file PATHS present at the moment `markFilesHydrated` first ran —
   * `null` until then, then frozen for the session. Viewers that must
   * distinguish "content existed when I opened" from "content arrived
   * while I watched" (e.g. a live-join playback decision) read THIS, never
   * the live `files`: a viewer can mount long after hydration (the seed
   * gallery replaces the viewer on an empty workspace, so the viewer
   * first mounts only once seed content already landed), and the live
   * list at that moment describes the present, not the opening.
   */
  filesAtHydration: readonly string[] | null;

  setFiles: (files: FileContent[]) => void;
  updateFiles: (updates: Array<FileContent & { origin?: "self" | "external"; deleted?: boolean }>) => void;
  setActiveContentSet: (prefix: string | null) => void;
  markFilesHydrated: () => void;
}

export const createWorkspaceSlice: StateCreator<AppState, [], [], WorkspaceSlice> = (set, get) => ({
  files: [],
  contentSets: [],
  activeContentSet: null,
  contentSetUnread: new Set(),
  workspaceItems: [],
  filesHydrated: false,
  filesAtHydration: null,

  setFiles: (files) => {
    // Which of these are actually new to us? setFiles delivers a SNAPSHOT
    // (initial workspace load, a replay checkpoint, a seed application),
    // not a changelog, and the same snapshot legitimately arrives more
    // than once per load. Diffing here is what keeps the publish below
    // honest — see the comment on it.
    const known = new Map((get().files ?? []).map((f) => [f.path, f.content]));
    const changed = files.filter((f) => known.get(f.path) !== f.content);

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
      // Trait-bearing content sets (those exposing a locale or theme) want a
      // preference-aware choice — App.tsx waits for the user's saved Pneuma
      // locale + theme before calling `selectBestContentSet`. Picking the
      // alphabetical first here would race that effect, lock in "en-dark"
      // before "zh-CN + dark" arrives, and the `!activeContentSet` guard
      // upstream would prevent the revision.
      const hasTraits = contentSets.some((cs) => !!cs.traits?.locale || !!cs.traits?.theme);
      if (!activeContentSet && contentSets.length > 0 && !hasTraits) {
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
    // After state has been updated, notify source providers — but only
    // about files whose content actually changed. setFiles is used on
    // initial mode load (fetch /api/files → setFiles), on replay-checkpoint
    // boundaries, and after a seed is applied; the source layer needs to
    // see genuinely new content in all three.
    //
    // Publishing the whole snapshot unconditionally was wrong, and
    // expensively so. `origin: "external"` means "someone other than this
    // viewer changed the world" (core/types/source.ts) — viewers treat it
    // as a cue to re-hydrate, and some rebuild everything they own. On a
    // plain clipcraft load setFiles fires four times with byte-identical
    // content, so the viewer tore down and rebuilt its whole craft store
    // four times, re-decoding every video and audio asset each time —
    // roughly half the media traffic of a session start, for nothing.
    // A value event has to mean the value changed.
    if (changed.length > 0) {
      fileEventBus.publish(
        changed.map((f) => ({
          path: f.path,
          content: f.content,
          origin: "external" as const,
        })),
      );
    }
  },

  updateFiles: (updates) => {
    set((s) => {
      const fileMap = new Map(s.files.map((f) => [f.path, f]));
      for (const u of updates) {
        if (u.deleted) {
          // Honour chokidar unlink events — drop the file from the store.
          // Without this an unlink arrives as a content="" entry and any
          // resolver that keys off path-presence (content set directory
          // grouping, workspace item enumeration, etc.) treats the ghost
          // file as still existing and re-surfaces empty content sets
          // after a directory delete.
          fileMap.delete(u.path);
          continue;
        }
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
      const hasTraits = contentSets.some((cs) => !!cs.traits?.locale || !!cs.traits?.theme);
      if (!activeContentSet && contentSets.length > 0 && !hasTraits) {
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

  // Idempotent: only the FIRST call snapshots — hydration happens once,
  // and a later call must not rewrite what the opening looked like.
  markFilesHydrated: () =>
    set((s) =>
      s.filesAtHydration !== null
        ? { filesHydrated: true }
        : {
            filesHydrated: true,
            filesAtHydration: s.files.map((f) => f.path),
          },
    ),

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

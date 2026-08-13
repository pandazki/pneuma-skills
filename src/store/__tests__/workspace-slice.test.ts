import { describe, expect, test } from "bun:test";
import { create } from "zustand";
import {
  createWorkspaceSlice,
  type WorkspaceSlice,
} from "../workspace-slice.js";

function makeStore() {
  return create<WorkspaceSlice>()((...a) => ({
    ...(createWorkspaceSlice as unknown as (...args: typeof a) => WorkspaceSlice)(
      ...a,
    ),
  }));
}

/**
 * The hydration snapshot: which files existed when the workspace finished
 * its initial load. Viewers that must tell "content existed when I opened"
 * from "content arrived while I watched" (bansho's live-join latch) read
 * THIS, never the live `files` — a viewer can mount long after hydration
 * (the seed gallery replaces the viewer on an empty workspace, so the
 * viewer's first mount happens only once seed content already landed),
 * and the live list at that moment describes the present, not the
 * opening.
 */
describe("workspace-slice — the files-at-hydration snapshot", () => {
  test("markFilesHydrated captures the paths present AT hydration, immutably", () => {
    const useStore = makeStore();
    expect(useStore.getState().filesAtHydration).toBeNull(); // not hydrated yet
    useStore.getState().setFiles([{ path: "notes.md", content: "x" }]);
    useStore.getState().markFilesHydrated();
    expect(useStore.getState().filesAtHydration).toEqual(["notes.md"]);
    // Content arriving DURING the session must not rewrite the opening: a
    // seed applied mid-session is a broadcast about to start, not a board
    // that existed when the workspace opened. (The defect: a viewer that
    // first mounted after the seed landed read the LIVE files, judged the
    // board pre-existing, and showed it fully written with no
    // performance.)
    useStore
      .getState()
      .updateFiles([{ path: "tech-zh/board.md", content: "# b" }]);
    expect(useStore.getState().files.map((f) => f.path)).toContain(
      "tech-zh/board.md",
    );
    expect(useStore.getState().filesAtHydration).toEqual(["notes.md"]);
  });

  test("an empty workspace hydrates to an EMPTY snapshot — distinct from not-yet-hydrated", () => {
    const useStore = makeStore();
    useStore.getState().markFilesHydrated();
    expect(useStore.getState().filesAtHydration).toEqual([]);
    expect(useStore.getState().filesHydrated).toBe(true);
  });

  test("markFilesHydrated is idempotent — a later call keeps the first snapshot", () => {
    const useStore = makeStore();
    useStore.getState().markFilesHydrated();
    useStore.getState().updateFiles([{ path: "board.md", content: "# b" }]);
    useStore.getState().markFilesHydrated();
    expect(useStore.getState().filesAtHydration).toEqual([]);
  });
});

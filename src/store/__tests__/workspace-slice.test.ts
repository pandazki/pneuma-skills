import { describe, expect, test } from "bun:test";
import { create } from "zustand";
import {
  createWorkspaceSlice,
  type WorkspaceSlice,
} from "../workspace-slice.js";
import { fileEventBus } from "../../runtime/file-event-bus.js";
import type { FileChangeEvent } from "../../../core/types/source.js";

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


/**
 * setFiles delivers a SNAPSHOT, not a changelog — the initial workspace
 * load, a replay checkpoint, a seed application. The same snapshot
 * legitimately arrives more than once per page load (a plain clipcraft
 * start calls setFiles four times with byte-identical content).
 *
 * `origin: "external"` means "someone other than this viewer changed the
 * world" (core/types/source.ts), and viewers act on it — clipcraft tears
 * down and rebuilds its entire craft store, re-decoding every video and
 * audio asset. Publishing an unchanged snapshot as external therefore
 * cost roughly half the media traffic of a session start, for nothing.
 */
describe("workspace-slice — setFiles publishes changes, not snapshots", () => {
  function captureBatches(fn: () => void): FileChangeEvent[][] {
    const seen: FileChangeEvent[][] = [];
    const off = fileEventBus.subscribe((batch) => seen.push(batch));
    try {
      fn();
    } finally {
      off();
    }
    return seen;
  }

  test("first load publishes the files the source layer has not seen", () => {
    const useStore = makeStore();
    const seen = captureBatches(() => {
      useStore.getState().setFiles([{ path: "a.json", content: "{}" }]);
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual([
      { path: "a.json", content: "{}", origin: "external" },
    ]);
  });

  test("re-delivering the identical snapshot publishes nothing", () => {
    const useStore = makeStore();
    useStore.getState().setFiles([{ path: "a.json", content: "{}" }]);
    const seen = captureBatches(() => {
      // App.tsx's /api/files fetch landing on top of the WS-seeded list.
      useStore.getState().setFiles([{ path: "a.json", content: "{}" }]);
      useStore.getState().setFiles([{ path: "a.json", content: "{}" }]);
    });
    expect(seen).toEqual([]);
    // The state itself is still correct — only the notification is suppressed.
    expect(useStore.getState().files).toEqual([
      { path: "a.json", content: "{}" },
    ]);
  });

  test("a genuinely changed file in an otherwise identical snapshot still publishes, alone", () => {
    const useStore = makeStore();
    useStore.getState().setFiles([
      { path: "a.json", content: "{}" },
      { path: "b.json", content: "1" },
    ]);
    const seen = captureBatches(() => {
      // A replay checkpoint boundary: b moved, a did not.
      useStore.getState().setFiles([
        { path: "a.json", content: "{}" },
        { path: "b.json", content: "2" },
      ]);
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual([
      { path: "b.json", content: "2", origin: "external" },
    ]);
  });

  test("a file that is new to this snapshot publishes even when the others repeat", () => {
    const useStore = makeStore();
    useStore.getState().setFiles([{ path: "a.json", content: "{}" }]);
    const seen = captureBatches(() => {
      useStore.getState().setFiles([
        { path: "a.json", content: "{}" },
        { path: "seed.json", content: "new" },
      ]);
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual([
      { path: "seed.json", content: "new", origin: "external" },
    ]);
  });
});

import { describe, expect, test } from "bun:test";
import { create } from "zustand";
import { createProjectSlice, type ProjectSlice, type HandoffData } from "../project-slice.js";

// Minimal stand-alone slice instantiation. The slice's StateCreator is typed
// against the full AppState, but at runtime only the slice's own fields are
// used, so it's safe to cast the creator for unit testing.
function makeStore() {
  return create<ProjectSlice>()((...a) => ({
    ...(createProjectSlice as unknown as (...args: typeof a) => ProjectSlice)(...a),
  }));
}

const sample: HandoffData = {
  path: "/p/.pneuma/handoffs/h1.md",
  frontmatter: { handoff_id: "h1", target_mode: "webcraft" },
  body: "body",
};

describe("project-slice", () => {
  test("recordHandoffCreated adds to inbox keyed by handoff_id", () => {
    const useStore = makeStore();
    useStore.getState().recordHandoffCreated(sample);
    expect(useStore.getState().handoffInbox.has("h1")).toBe(true);
    expect(useStore.getState().handoffInbox.get("h1")?.frontmatter.target_mode).toBe("webcraft");
  });

  test("recordHandoffDeleted removes from inbox", () => {
    const useStore = makeStore();
    useStore.getState().recordHandoffCreated(sample);
    useStore.getState().recordHandoffDeleted("h1");
    expect(useStore.getState().handoffInbox.has("h1")).toBe(false);
  });
});

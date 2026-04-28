import { describe, expect, test } from "bun:test";
import { create } from "zustand";
import {
  createProjectSlice,
  type ProjectSlice,
  type ProposedHandoff,
} from "../project-slice.js";

// Minimal stand-alone slice instantiation. The slice's StateCreator is typed
// against the full AppState, but at runtime only the slice's own fields are
// used, so it's safe to cast the creator for unit testing.
function makeStore() {
  return create<ProjectSlice>()((...a) => ({
    ...(createProjectSlice as unknown as (...args: typeof a) => ProjectSlice)(...a),
  }));
}

const sample: ProposedHandoff = {
  handoff_id: "hf-1",
  proposed_at: 1_000,
  payload: {
    target_mode: "webcraft",
    intent: "build a site",
  },
};

describe("project-slice", () => {
  test("setProposedHandoff sets the active proposal", () => {
    const useStore = makeStore();
    expect(useStore.getState().proposedHandoff).toBeNull();
    useStore.getState().setProposedHandoff(sample);
    expect(useStore.getState().proposedHandoff?.handoff_id).toBe("hf-1");
  });

  test("setProposedHandoff(null) clears the proposal", () => {
    const useStore = makeStore();
    useStore.getState().setProposedHandoff(sample);
    useStore.getState().setProposedHandoff(null);
    expect(useStore.getState().proposedHandoff).toBeNull();
  });

  test("setHandoffStatus tracks in-flight network state", () => {
    const useStore = makeStore();
    expect(useStore.getState().handoffStatus).toBe("idle");
    useStore.getState().setHandoffStatus("sending-confirm");
    expect(useStore.getState().handoffStatus).toBe("sending-confirm");
    useStore.getState().setHandoffStatus("idle");
    expect(useStore.getState().handoffStatus).toBe("idle");
  });

  test("setProjectContext stores context", () => {
    const useStore = makeStore();
    useStore.getState().setProjectContext({ projectRoot: "/p", projectName: "P" });
    expect(useStore.getState().projectContext?.projectRoot).toBe("/p");
  });
});

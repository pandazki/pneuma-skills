import { create } from "zustand";
import { getApiBase } from "../utils/api.js";
import type { AppState } from "./types.js";
import { createUiSlice } from "./ui-slice.js";
import { createSessionSlice } from "./session-slice.js";
import { createAgentDataSlice } from "./agent-data-slice.js";
import { createChatSlice } from "./chat-slice.js";
import { createModeSlice } from "./mode-slice.js";
import { createViewerSlice } from "./viewer-slice.js";
import { createWorkspaceSlice } from "./workspace-slice.js";
import { createReplaySlice } from "./replay-slice.js";

export const useStore = create<AppState>()((...a) => ({
  ...createUiSlice(...a),
  ...createSessionSlice(...a),
  ...createAgentDataSlice(...a),
  ...createChatSlice(...a),
  ...createModeSlice(...a),
  ...createViewerSlice(...a),
  ...createWorkspaceSlice(...a),
  ...createReplaySlice(...a),
}));

// ── Viewer state persistence (debounced) ──────────────────────────────────
let _viewerStateSaveTimer: ReturnType<typeof setTimeout> | null = null;
function saveViewerState() {
  if (_viewerStateSaveTimer) clearTimeout(_viewerStateSaveTimer);
  _viewerStateSaveTimer = setTimeout(() => {
    const { activeContentSet, activeFile } = useStore.getState();
    fetch(`${getApiBase()}/api/viewer-state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentSet: activeContentSet, file: activeFile }),
    }).catch(() => { /* ignore */ });
  }, 500);
}

useStore.subscribe(
  (state, prevState) => {
    if (state.activeContentSet !== prevState.activeContentSet || state.activeFile !== prevState.activeFile) {
      saveViewerState();
    }
  },
);

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
import { createPluginSlice } from "./plugin-slice.js";
import { createProjectSlice } from "./project-slice.js";
import { normalizeViewerState } from "../utils/viewer-state.js";

export const useStore = create<AppState>()((...a) => ({
  ...createUiSlice(...a),
  ...createSessionSlice(...a),
  ...createAgentDataSlice(...a),
  ...createChatSlice(...a),
  ...createModeSlice(...a),
  ...createViewerSlice(...a),
  ...createWorkspaceSlice(...a),
  ...createReplaySlice(...a),
  ...createPluginSlice(...a),
  ...createProjectSlice(...a),
}));

// ── Pending message queue flush ─────────────────────────────────────────
// Subscribe to state changes: whenever agent becomes idle OR queue grows,
// check if we should flush the next item. Synchronous check on push means
// no flicker (item doesn't appear in queue UI if agent is idle).
let _flushScheduled = false;

function tryFlushPendingQueue() {
  if (_flushScheduled) return;
  const state = useStore.getState();
  if (state.sessionStatus !== "idle" || state.turnInProgress) return;
  if (state.pendingMessages.length === 0) return;

  _flushScheduled = true;
  // Microtask delay — lets Zustand batch the push + flush in one render
  queueMicrotask(() => {
    _flushScheduled = false;
    const store = useStore.getState();
    if (store.sessionStatus !== "idle" || store.turnInProgress) return;
    const next = store.shiftPendingMessage();
    if (!next) return;

    // Mark busy immediately to prevent double-flush
    store.setSessionStatus("running");
    store.setTurnInProgress(true);

    // Lazy import to avoid circular dependency (store ↔ ws)
    import("../ws.js").then(({ sendUserMessage, sendViewerNotification }) => {
      if (next.kind === "user") {
        sendUserMessage(next.text, next.selection, next.images, next.annotations, next.files);
      } else {
        sendViewerNotification(next.notification, next.images);
        const fileMatches = [...next.notification.message.matchAll(/\(([^)]+\.\w+)\)/g)];
        const affectedFiles = fileMatches.map((m) => m[1]);
        const msg: Record<string, unknown> = {
          id: `notif-${next.id}`,
          role: "user",
          content: "",
          timestamp: Date.now(),
          viewerNotification: {
            type: next.notification.type,
            summary: next.notification.summary || next.notification.type,
            files: affectedFiles.length > 0 ? affectedFiles : undefined,
          },
        };
        if (store.debugMode) {
          msg.debugPayload = {
            enrichedContent: next.notification.message,
            images: next.images?.length ? next.images : undefined,
          };
        }
        store.appendMessage(msg as any);
      }
    });
  });
}

useStore.subscribe(
  (state, prevState) => {
    // Flush when: agent becomes idle, turnInProgress clears, or queue grows
    const becameIdle = state.sessionStatus === "idle" && prevState.sessionStatus !== "idle";
    const turnCleared = !state.turnInProgress && prevState.turnInProgress;
    const queueGrew = state.pendingMessages.length > prevState.pendingMessages.length;
    if (becameIdle || turnCleared || queueGrew) {
      tryFlushPendingQueue();
    }
  },
);

// ── Viewer state persistence (debounced) ──────────────────────────────────
let _viewerStateSaveTimer: ReturnType<typeof setTimeout> | null = null;
function saveViewerState() {
  if (_viewerStateSaveTimer) clearTimeout(_viewerStateSaveTimer);
  _viewerStateSaveTimer = setTimeout(() => {
    const { activeContentSet, activeFile, contentSets } = useStore.getState();
    const normalized = normalizeViewerState(
      { contentSet: activeContentSet, file: activeFile },
      contentSets,
    );
    fetch(`${getApiBase()}/api/viewer-state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(normalized),
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

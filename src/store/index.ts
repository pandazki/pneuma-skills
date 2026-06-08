import { create } from "zustand";
import { getApiBase } from "../utils/api.js";
import type { AppState } from "./types.js";
import { createUiSlice } from "./ui-slice.js";
import { createAgentSurfaceSlice } from "./agent-surface-slice.js";
import { saveSurfacePrefs } from "./agent-surface-persistence.js";
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
  ...createAgentSurfaceSlice(...a),
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
  // Don't flush into a socket that can't carry the message. `send()` silently
  // no-ops when the WS isn't OPEN, so flushing mid-reconnect would shift the
  // message out of the queue, mark the turn busy, and then drop it on the
  // floor — leaving the composer frozen on a phantom turn with no `result`
  // ever coming back. Leave it queued; the reconnect edge below retries.
  if (state.connectionStatus !== "connected") return;

  _flushScheduled = true;
  // Microtask delay — lets Zustand batch the push + flush in one render
  queueMicrotask(() => {
    _flushScheduled = false;
    const store = useStore.getState();
    if (store.sessionStatus !== "idle" || store.turnInProgress) return;
    if (store.connectionStatus !== "connected") return;
    const next = store.shiftPendingMessage();
    if (!next) return;

    // Mark busy immediately to prevent double-flush
    store.setSessionStatus("running");
    store.setTurnInProgress(true);

    // Lazy import to avoid circular dependency (store ↔ ws). The send is
    // async (context enrichment + transport); if it throws or rejects we must
    // NOT leave the turn stranded as "busy" forever — settle back to idle so
    // the queue keeps moving and the user isn't stuck behind a frozen Stop
    // button. We deliberately don't requeue `next`: a message that
    // deterministically fails to serialize would otherwise hot-loop.
    import("../ws.js")
      .then(async ({ sendUserMessage, sendViewerNotification }) => {
        let delivered: boolean;
        if (next.kind === "user") {
          delivered = await sendUserMessage(next.text, next.selection, next.images, next.annotations, next.files);
        } else {
          delivered = sendViewerNotification(next.notification, next.images);
        }

        if (!delivered) {
          // The socket closed between the connection check and the actual
          // send (a narrow race). Don't lose the message or sit on a phantom
          // busy turn: put it back at the head and settle to idle. Mark the
          // connection disconnected too — a failed send empirically proves the
          // socket is down, and this closes the flush gate so the requeue +
          // idle transition can't hot-loop before `ws.onclose` catches up. The
          // reconnect edge retries the flush once the socket is healthy again.
          store.unshiftPendingMessage(next);
          if (store.connectionStatus === "connected") store.setConnectionStatus("disconnected");
          store.setSessionStatus("idle");
          store.setTurnInProgress(false);
          return;
        }

        if (next.kind === "notification") {
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
      })
      .catch((err) => {
        // Hard failure (context enrichment / serialization threw). Don't
        // requeue — a message that deterministically fails would hot-loop —
        // but DO settle to idle so the composer isn't frozen on Stop.
        console.error("[pneuma] failed to flush queued message; settling to idle", err);
        store.setSessionStatus("idle");
        store.setTurnInProgress(false);
      });
  });
}

useStore.subscribe(
  (state, prevState) => {
    // Flush when: agent becomes idle, turnInProgress clears, the queue grows,
    // or the socket reconnects (a message left queued because we were
    // disconnected should go out as soon as the connection is healthy again).
    const becameIdle = state.sessionStatus === "idle" && prevState.sessionStatus !== "idle";
    const turnCleared = !state.turnInProgress && prevState.turnInProgress;
    const queueGrew = state.pendingMessages.length > prevState.pendingMessages.length;
    const reconnected = state.connectionStatus === "connected" && prevState.connectionStatus !== "connected";
    if (becameIdle || turnCleared || queueGrew || reconnected) {
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

// ── Agent Surface preference persistence (debounced) ───────────────────────
// Persists the layout habit (form + floating rect) per-mode + global. Dragging
// the floating panel mutates floatRect on every pointermove, so debounce.
let _surfaceSaveTimer: ReturnType<typeof setTimeout> | null = null;
function saveSurface() {
  if (_surfaceSaveTimer) clearTimeout(_surfaceSaveTimer);
  _surfaceSaveTimer = setTimeout(() => {
    const { surfaceForm, floatRect, lastExpandedForm, modeManifest } = useStore.getState();
    saveSurfacePrefs(modeManifest?.name, { form: surfaceForm, floatRect, lastExpandedForm });
  }, 300);
}

useStore.subscribe(
  (state, prevState) => {
    if (
      state.surfaceForm !== prevState.surfaceForm ||
      state.floatRect !== prevState.floatRect ||
      state.lastExpandedForm !== prevState.lastExpandedForm
    ) {
      saveSurface();
    }
  },
);

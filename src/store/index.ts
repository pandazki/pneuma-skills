import { create } from "zustand";
import { getApiBase } from "../utils/api.js";
import type { AppState } from "./types.js";
import { createUiSlice } from "./ui-slice.js";
import { createAgentSurfaceSlice } from "./agent-surface-slice.js";
import { saveSurfacePrefs } from "./agent-surface-persistence.js";
import { createSessionSlice } from "./session-slice.js";
import { createAgentDataSlice } from "./agent-data-slice.js";
import { createChatSlice } from "./chat-slice.js";
import { createSubagentSlice } from "./subagent-slice.js";
import { createModeSlice } from "./mode-slice.js";
import { createViewerSlice } from "./viewer-slice.js";
import { createWorkspaceSlice } from "./workspace-slice.js";
import { createReplaySlice } from "./replay-slice.js";
import { createPluginSlice } from "./plugin-slice.js";
import { createProjectSlice } from "./project-slice.js";
import { normalizeViewerState, saveTabViewerState, viewerStateStorageKey } from "../utils/viewer-state.js";

export const useStore = create<AppState>()((...a) => ({
  ...createUiSlice(...a),
  ...createAgentSurfaceSlice(...a),
  ...createSessionSlice(...a),
  ...createAgentDataSlice(...a),
  ...createChatSlice(...a),
  ...createSubagentSlice(...a),
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
  if (state.pendingMessages[0].kind === "user" && state.pendingMessages[0].deliveryError) return;
  // A steer RPC can resolve a few milliseconds after the active turn's
  // `result`. Do not let that idle edge auto-flush the same queue item as a
  // brand-new turn while its steer acknowledgement is still in flight.
  if (state.pendingSteerIds.size > 0) return;
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
    if (store.pendingSteerIds.size > 0) return;
    if (store.pendingMessages[0]?.kind === "user" && store.pendingMessages[0].deliveryError) return;
    const next = store.shiftPendingMessage();
    if (!next) return;
    const queuedSessionId = store.sessionId;

    // Mark busy immediately to prevent double-flush
    store.setSessionStatus("running");
    store.setTurnInProgress(true);

    // Lazy import to avoid circular dependency (store ↔ ws). The send is
    // async (context enrichment + transport); if it throws or rejects we must
    // NOT leave the turn stranded as "busy" forever — settle back to idle so
    // the queue keeps moving and the user isn't stuck behind a frozen Stop
    // button. Failed collaboration feedback remains visible with an explicit
    // Retry action; the failed-head gate prevents serialization hot-loops.
    import("../ws.js")
      .then(async ({ sendUserMessage, sendViewerNotification }) => {
        if (next.kind === "user" && next.collaborationFeedback?.length && useStore.getState().sessionId !== queuedSessionId) return;
        let delivered: boolean;
        if (next.kind === "user") {
          delivered = await sendUserMessage(next.text, next.selection, next.images, next.annotations, next.files);
        } else {
          delivered = sendViewerNotification(next.notification, next.images);
        }
        if (next.kind === "user" && next.collaborationFeedback?.length && useStore.getState().sessionId !== queuedSessionId) return;

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
        if (next.kind === "user" && next.collaborationFeedback?.length && useStore.getState().sessionId !== queuedSessionId) return;
        // Hard failure (context enrichment / serialization threw). Don't
        // automatically retry — a deterministic failure would hot-loop.
        // Preserve feedback for manual retry and settle the turn to idle.
        console.error("[pneuma] failed to flush queued message; settling to idle", err);
        if (next.kind === "user" && next.collaborationFeedback?.length) {
          store.unshiftPendingMessage({ ...next, deliveryError: "Feedback could not be sent. Retry when ready." });
        }
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
    const steerSettled = state.pendingSteerIds.size < prevState.pendingSteerIds.size;
    const feedbackRetried = prevState.pendingMessages.some((message) => message.kind === "user" && message.deliveryError
      && state.pendingMessages.some((next) => next.id === message.id && next.kind === "user" && !next.deliveryError));
    const failedHeadRemoved = prevState.pendingMessages[0]?.kind === "user" && !!prevState.pendingMessages[0].deliveryError
      && state.pendingMessages[0]?.id !== prevState.pendingMessages[0].id;
    if (becameIdle || turnCleared || queueGrew || reconnected || steerSettled || feedbackRetried || failedHeadRemoved) {
      tryFlushPendingQueue();
    }
  },
);

// ── Viewer state persistence (debounced) ──────────────────────────────────
let _viewerStateSaveTimer: ReturnType<typeof setTimeout> | null = null;
function saveViewerState() {
  if (_viewerStateSaveTimer) clearTimeout(_viewerStateSaveTimer);
  _viewerStateSaveTimer = setTimeout(() => {
    const { activeContentSet, activeFile, contentSets, staticPlayer } = useStore.getState();
    // The hosted static player has no backend to persist to — a POST here
    // can only 404 against the static host, once per content-set switch.
    if (staticPlayer || typeof sessionStorage === "undefined" || typeof location === "undefined") return;
    const normalized = normalizeViewerState(
      { contentSet: activeContentSet, file: activeFile },
      contentSets,
    );
    saveTabViewerState(viewerStateStorageKey(getApiBase(), location.href), normalized);
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

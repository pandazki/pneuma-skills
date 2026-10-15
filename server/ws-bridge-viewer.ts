/**
 * Viewer Action bridge — handles viewer action request/response flow.
 *
 * Follows the same pattern as ws-bridge-controls.ts (pendingControlRequests).
 * Server sends action request to browser → Viewer executes → browser returns result.
 */

import { randomUUID } from "node:crypto";
import type { ViewerActionResult } from "../core/types/viewer-contract.js";
import type { ServerWebSocket } from "bun";
import { isPrivateViewerInstanceId } from "../core/types/private-viewer.js";
import type { PrivateViewerIncomingMessage } from "../core/types/private-viewer.js";
import type { BrowserSocketData, SocketData, Session } from "./ws-bridge-types.js";

// Default viewer-action timeout. Most actions are sub-second (a navigate,
// a fit, a thumbnail capture); the timeout is a safety net for hung
// browsers, not a real upper bound on legitimate work.
//
// 15s used to be the default and broke a real scenario: when a Smart
// Handoff spawns a fresh session and the agent's first turn includes
// `scaffold` (e.g. "build a 4-page webcraft site"), the call lands
// while the browser is still navigating to the new per-session URL +
// loading the mode bundle + reconnecting WS. The 15s window often
// closed before the viewer could respond, even though the actual
// scaffold work was milliseconds. 60s gives the boot path room to
// breathe without making the worst-case "browser permanently dead"
// experience meaningfully worse — by then the agent's already in
// trouble for other reasons.
const VIEWER_ACTION_TIMEOUT_MS = 60_000;

function dispatchNext(session: Session, socket: ServerWebSocket<SocketData>): void {
  const pending = [...session.pendingViewerActions.values()].filter((action) => action.socket === socket);
  if (pending.some((action) => action.dispatched)) return;
  pending[0]?.dispatch();
}

/**
 * Dispatch to one registered private viewer. An explicit or user-turn target
 * must remain available; it never falls back to someone else's tab. With no
 * target, the first registered socket in connection order is the local primary.
 */
export function sendViewerActionRequest(
  session: Session,
  actionId: string,
  params: Record<string, unknown> | undefined,
  viewerInstanceId?: string,
): Promise<ViewerActionResult> {
  if (actionId === "capture" && params?.publicationReference !== undefined) {
    return Promise.resolve({ success: false, message: "Immutable publication capture is unsupported. Private capture renders the selected local viewer mount; use the pinned publication preview or copy its source explicitly" });
  }
  const targetId = viewerInstanceId ?? session.viewerTurnTargets?.[0] ?? undefined;
  const socket = [...session.browserSockets].find((ws) => {
    const id = (ws.data as BrowserSocketData)?.viewerInstanceId;
    return id && (!targetId || id === targetId);
  });
  if (!socket) {
    return Promise.resolve({
      success: false,
      message: targetId ? `Private viewer "${targetId}" is unavailable` : "No private viewer is registered",
    });
  }
  const registeredId = (socket.data as BrowserSocketData).viewerInstanceId!;
  const requestId = randomUUID();
  return new Promise<ViewerActionResult>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fail = (error: Error) => {
      clearTimeout(timer);
      session.pendingViewerActions.delete(requestId);
      reject(error);
    };
    session.pendingViewerActions.set(requestId, {
      socket,
      viewerInstanceId: registeredId,
      dispatched: false,
      dispatch: () => {
        const pending = session.pendingViewerActions.get(requestId);
        if (!pending) return;
        pending.dispatched = true;
        timer = setTimeout(() => {
          if (!session.pendingViewerActions.has(requestId)) return;
          // A deadline cannot cancel browser execution. Retire this mount;
          // only an explicit reload/remount with a fresh UUID can recover.
          const data = socket.data as BrowserSocketData;
          (data.fencedViewerInstanceIds ??= new Set()).add(registeredId);
          delete data.viewerInstanceId;
          const reason = `Viewer action "${actionId}" timed out after ${VIEWER_ACTION_TIMEOUT_MS}ms; execution may have occurred. Reload viewer to recover`;
          try { socket.send(JSON.stringify({ type: "viewer_instance_registered", viewer_instance_id: registeredId, success: false, message: reason } satisfies PrivateViewerIncomingMessage)); }
          catch { /* The disconnected browser cannot receive recovery guidance. */ }
          for (const waiting of [...session.pendingViewerActions.values()]) {
            if (waiting.socket === socket) waiting.reject(new Error(reason));
          }
        }, VIEWER_ACTION_TIMEOUT_MS);
        try { socket.send(JSON.stringify(message)); }
        catch { unregisterPrivateViewer(session, socket); }
      },
      reject: fail,
      resolve: (result) => {
        clearTimeout(timer);
        resolve(result);
      },
    });
    const message: PrivateViewerIncomingMessage = {
      type: "viewer_action_request",
      viewer_instance_id: registeredId,
      request_id: requestId,
      action_id: actionId,
      params,
    };
    dispatchNext(session, socket);
  });
}

/** A response belongs to both its registered socket and its mount generation. */
export function handleViewerActionResponse(
  session: Session,
  msg: { request_id: string; viewer_instance_id: string; result: ViewerActionResult },
  socket?: ServerWebSocket<SocketData>,
): void {
  const pending = session.pendingViewerActions.get(msg.request_id);
  if (!pending || !pending.dispatched || pending.socket !== socket
    || pending.viewerInstanceId !== msg.viewer_instance_id
    || (socket?.data as BrowserSocketData)?.viewerInstanceId !== pending.viewerInstanceId) return;
  session.pendingViewerActions.delete(msg.request_id);
  pending.resolve(msg.result);
  dispatchNext(session, socket!);
}

/** Unmount/close cancels waiting, but cannot undo an action already executed. */
export function unregisterPrivateViewer(session: Session, socket: ServerWebSocket<SocketData>): void {
  const data = socket.data as BrowserSocketData;
  const id = data.viewerInstanceId;
  delete data.viewerInstanceId;
  for (const pending of session.pendingViewerActions.values()) {
    if (pending.socket === socket) pending.reject(new Error(`Private viewer "${id}" disconnected or unmounted`));
  }
}

export function registerPrivateViewer(
  session: Session,
  socket: ServerWebSocket<SocketData>,
  viewerInstanceId: unknown,
): PrivateViewerIncomingMessage {
  const id = typeof viewerInstanceId === "string" ? viewerInstanceId : "";
  if (!isPrivateViewerInstanceId(id)) {
    return { type: "viewer_instance_registered", viewer_instance_id: id, success: false, message: "Invalid private viewer instance UUID" };
  }
  if ([...session.browserSockets].some((ws) => ws !== socket && (ws.data as BrowserSocketData)?.viewerInstanceId === id)) {
    return { type: "viewer_instance_registered", viewer_instance_id: id, success: false, message: "Private viewer instance is already registered to another connection" };
  }
  const data = socket.data as BrowserSocketData;
  if (data.fencedViewerInstanceIds?.has(id)) {
    return { type: "viewer_instance_registered", viewer_instance_id: id, success: false, message: "This private viewer has uncertain execution. Reload viewer to recover" };
  }
  if (data.viewerInstanceId && data.viewerInstanceId !== id) unregisterPrivateViewer(session, socket);
  data.viewerInstanceId = id;
  return { type: "viewer_instance_registered", viewer_instance_id: id, success: true };
}

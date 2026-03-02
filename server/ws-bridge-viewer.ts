/**
 * Viewer Action bridge — handles viewer action request/response flow.
 *
 * Follows the same pattern as ws-bridge-controls.ts (pendingControlRequests).
 * Server sends action request to browser → Viewer executes → browser returns result.
 */

import { randomUUID } from "node:crypto";
import type { ViewerActionResult } from "../core/types/viewer-contract.js";
import type { Session } from "./ws-bridge-types.js";
import type { BrowserIncomingMessage } from "./session-types.js";

const VIEWER_ACTION_TIMEOUT_MS = 15_000;

/**
 * Send a viewer action request to the browser and wait for the result.
 *
 * @returns Promise that resolves when the viewer responds, or rejects on timeout.
 */
export function sendViewerActionRequest(
  session: Session,
  actionId: string,
  params: Record<string, unknown> | undefined,
  broadcastToBrowsers: (msg: BrowserIncomingMessage) => void,
): Promise<ViewerActionResult> {
  const requestId = randomUUID();

  return new Promise<ViewerActionResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      session.pendingViewerActions.delete(requestId);
      reject(new Error(`Viewer action "${actionId}" timed out after ${VIEWER_ACTION_TIMEOUT_MS}ms`));
    }, VIEWER_ACTION_TIMEOUT_MS);

    session.pendingViewerActions.set(requestId, {
      resolve: (result) => {
        clearTimeout(timer);
        resolve(result);
      },
    });

    broadcastToBrowsers({
      type: "viewer_action_request",
      request_id: requestId,
      action_id: actionId,
      params,
    });
  });
}

/**
 * Handle a viewer_action_response from the browser.
 * Resolves the matching pending promise.
 */
export function handleViewerActionResponse(
  session: Session,
  msg: { request_id: string; result: ViewerActionResult },
): void {
  const pending = session.pendingViewerActions.get(msg.request_id);
  if (!pending) return;
  session.pendingViewerActions.delete(msg.request_id);
  pending.resolve(msg.result);
}

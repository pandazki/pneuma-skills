/**
 * useCaptureAction — handles the framework-level `capture` viewer action.
 *
 * The agent calls `POST /api/viewer/action {"actionId":"capture"}`; the runtime
 * dispatches it as an `actionRequest`. App intercepts `capture` here (it is
 * masked from the mode viewer) rather than letting each mode reimplement it —
 * the screenshot is generic. We render the viewer to a PNG, persist it under
 * the session's captures/ dir, and return the file path so the agent can Read
 * the image and visually self-QA without spawning an external browser.
 */

import { useEffect } from "react";
import type { RefObject } from "react";
import { useStore } from "../store.js";
import { getApiBase } from "../utils/api.js";
import { captureViewer } from "../utils/viewer-capture.js";

type ActionResult = { success: boolean; message?: string; data?: Record<string, unknown> };

export function useCaptureAction(
  previewRef: RefObject<HTMLElement | null>,
  captureViewport?: (() => Promise<{ data: string; media_type: string } | null>) | null,
): void {
  const actionRequest = useStore((s) => s.actionRequest);
  const setActionRequest = useStore((s) => s.setActionRequest);

  useEffect(() => {
    if (!actionRequest || actionRequest.actionId !== "capture") return;
    const { requestId, params } = actionRequest;
    let cancelled = false;

    const respond = (result: ActionResult) => {
      if (cancelled) return;
      import("../ws.js").then(({ sendViewerActionResponse }) => {
        sendViewerActionResponse(requestId, result);
      });
      setActionRequest(null);
    };

    (async () => {
      const el = previewRef.current;
      if (!el) { respond({ success: false, message: "Viewer is not mounted" }); return; }

      const selector = typeof params?.selector === "string" ? params.selector : undefined;
      const result = await captureViewer(el, { selector, captureViewport });
      if (cancelled) return;
      if (!result.ok) { respond({ success: false, message: result.message }); return; }

      // Persist the PNG and hand back a path the agent can Read.
      try {
        const res = await fetch(`${getApiBase()}/api/session/capture`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: result.base64 }),
        });
        const json = await res.json();
        if (!json.ok || !json.path) {
          respond({ success: false, message: json.message || "Failed to save the screenshot" });
          return;
        }
        respond({
          success: true,
          message: result.note,
          data: { path: json.path, width: result.width, height: result.height, method: result.method },
        });
      } catch (err) {
        respond({ success: false, message: err instanceof Error ? err.message : "Failed to save the screenshot" });
      }
    })();

    return () => { cancelled = true; };
  }, [actionRequest, setActionRequest, previewRef, captureViewport]);
}

/**
 * useCaptureAction — handles the framework-level `capture` viewer action.
 *
 * The agent calls `POST /api/viewer/action {"actionId":"capture"}`; the runtime
 * dispatches it as an `actionRequest`. App intercepts `capture` here (it is
 * masked from the mode viewer) rather than letting each mode reimplement it —
 * the screenshot is generic. We render the viewer to a PNG, persist it under
 * the session's captures/ dir, and return the file path so the agent can Read
 * the image and visually self-QA without spawning an external browser.
 *
 * `capture` consumes a ViewerAddress — the same noun a `<viewer-locator>` and a
 * selection report. When the address names a coarse target (a different page /
 * slide / content set), the framework drives the viewer there first via the
 * existing `navigateRequest` channel, then screenshots — navigate-then-shoot,
 * composed from parts that already exist, no per-mode capture plumbing. The
 * fine half of the address (`selector` / `anchor`) resolves in-place.
 */

import { useEffect } from "react";
import type { RefObject } from "react";
import { useStore } from "../store.js";
import { getApiBase } from "../utils/api.js";
import { captureViewer } from "../utils/viewer-capture.js";
import type { ViewerAddress } from "../../core/types/viewer-contract.js";

type ActionResult = { success: boolean; message?: string; data?: Record<string, unknown> };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Address keys that name a target outside the current view — the viewer must
 * navigate before the screenshot. Fine keys (`selector` / `anchor`) resolve
 * in-place and never trigger a navigation.
 */
const COARSE_ADDRESS_KEYS = ["page", "file", "slide", "contentSet", "nodeId", "elementId", "image"];

/** Extract a CSS-selector-shaped fine handle from a mode address, if any. */
function fineSelector(address: ViewerAddress | undefined): string | undefined {
  if (!address) return undefined;
  const sel = address.selector;
  if (typeof sel === "string" && sel.trim()) return sel.trim();
  const anchor = address.anchor;
  if (typeof anchor === "string" && anchor.trim()) return anchor.trim();
  return undefined;
}

export function useCaptureAction(
  previewRef: RefObject<HTMLElement | null>,
  captureViewport?: (() => Promise<{ data: string; media_type: string } | null>) | null,
): void {
  const actionRequest = useStore((s) => s.actionRequest);
  const setActionRequest = useStore((s) => s.setActionRequest);
  const setNavigateRequest = useStore((s) => s.setNavigateRequest);

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

      // `capture` consumes a ViewerAddress. Lenient at this agent-input
      // boundary: a bare `selector` string still works as a one-key address.
      const rawAddress = params?.address;
      const address: ViewerAddress | undefined =
        rawAddress && typeof rawAddress === "object"
          ? (rawAddress as ViewerAddress)
          : typeof params?.selector === "string"
            ? { selector: params.selector }
            : undefined;

      // Coarse part → drive the viewer there first, then shoot.
      if (address && COARSE_ADDRESS_KEYS.some((k) => k in address)) {
        setNavigateRequest({ label: "capture", address });
        await sleep(1100); // React re-render + iframe/content reload + settle
        if (cancelled) return;
      }

      const result = await captureViewer(el, { selector: fineSelector(address), captureViewport });
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
  }, [actionRequest, setActionRequest, setNavigateRequest, previewRef, captureViewport]);
}

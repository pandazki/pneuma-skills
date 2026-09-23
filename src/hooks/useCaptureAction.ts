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
import type { ViewerSlice } from "../store/viewer-slice.js";

type ActionResult = { success: boolean; message?: string; data?: Record<string, unknown> };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Render + settle time a viewer gets after a navigation before the shot —
 *  most viewers answer `onNavigateComplete` synchronously, before they have
 *  painted the target. */
const NAVIGATE_SETTLE_MS = 1100;
/** Longest wait for the viewer's verdict on an addressed navigation. */
export const NAVIGATE_VERDICT_TIMEOUT_MS = 15_000;

export type NavigationWait =
  | { status: "arrived" }
  | { status: "failed"; message: string }
  | { status: "superseded" }
  | { status: "timeout" };

/** Shown when another navigation replaced a capture's target before the shot. */
export const SUPERSEDED_MESSAGE =
  "Another navigation moved the viewer before this capture's address was reached; nothing was captured. Capture again.";

/** The part of the store a navigation wait reads. */
interface NavigateStore {
  getState(): Pick<ViewerSlice, "navigateDoneSeq" | "navigateOutcome" | "navigateSeq">;
  subscribe(listener: () => void): () => void;
}

/**
 * Wait for the navigation dispatched under `seq` to end: the viewer's
 * verdict, or the shell settling it itself (see `navigateDoneSeq`). A newer
 * navigation dispatched first makes it `superseded` — another request's
 * arrival never certifies this one's. A viewer
 * that loads its target asynchronously answers when the target is on
 * screen, so `capture` shoots the page it was asked for — not the one it was
 * leaving, and not a half-loaded one. Bounded: a viewer that never answers
 * yields `timeout`, never a hang.
 */
export function waitForNavigation(
  seq: number,
  timeoutMs: number = NAVIGATE_VERDICT_TIMEOUT_MS,
  store: NavigateStore = useStore,
): Promise<NavigationWait> {
  const verdict = (): NavigationWait | null => {
    const s = store.getState();
    if (s.navigateDoneSeq === seq) {
      const outcome = s.navigateOutcome;
      if (outcome && outcome.seq === seq && !outcome.ok) {
        const message = outcome.message
          ?? (outcome.code === "unknownContentSet" ? `No content set "${outcome.contentSet}"` : "The viewer could not open it");
        return { status: "failed", message };
      }
      return { status: "arrived" };
    }
    if (s.navigateSeq > seq) return { status: "superseded" };
    return null;
  };
  const now = verdict();
  if (now) return Promise.resolve(now);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      unsubscribe();
      resolve({ status: "timeout" });
    }, timeoutMs);
    const unsubscribe = store.subscribe(() => {
      const v = verdict();
      if (!v) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(v);
    });
  });
}

/**
 * Address keys that name a target outside the current view — the viewer must
 * navigate before the screenshot. Fine keys (`selector` / `anchor`) resolve
 * in-place and never trigger a navigation.
 *
 * This is the registry of coarse keys across every mode's address
 * vocabulary; each entry was added by the mode that coined it (`slide` by
 * slide, `nodeId` by diagram, `section`/`step` by bansho — where a step is
 * a MOMENT in a lecture, so reaching it is always a navigation; `audience`
 * by eli5, where each rung of the ladder is its own page; `motion`/`ref` by
 * sprite, where a character's motion and its identity references are
 * separate things to put on the stage — sprite's `frame` stays fine, since
 * seeking inside the motion already on stage is an in-place move; `round` by
 * lucid, where naming a round swaps a RECORDED capture onto the stage in
 * place of the live scene, so reaching it is a navigation — lucid's `view`
 * stays fine, since Live / Target / Split re-dresses whatever is already
 * there). A mode whose coarse key is missing here does not fail loudly:
 * `capture` would silently screenshot whatever is on screen, which is why
 * new coarse keys belong in this list.
 */
const COARSE_ADDRESS_KEYS = ["page", "file", "slide", "contentSet", "nodeId", "elementId", "image", "section", "step", "audience", "motion", "ref", "round"];

/**
 * Whether an address names something outside the current view, so `capture`
 * must navigate before it shoots. Exported for the test that pins the
 * registry above — the silent failure mode (a plausible screenshot of the
 * wrong object) is exactly the kind that needs a test, not a code read.
 */
export function isCoarseAddress(address: ViewerAddress | undefined): address is ViewerAddress {
  return !!address && COARSE_ADDRESS_KEYS.some((k) => k in address);
}

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

      // Coarse part → drive the viewer there first, then shoot — once the
      // viewer says it has arrived (and after the usual settle time).
      let navigationNote: string | undefined;
      let navigatedSeq: number | null = null;
      if (isCoarseAddress(address)) {
        const seq = setNavigateRequest({ label: "capture", address });
        const [arrival] = await Promise.all([waitForNavigation(seq), sleep(NAVIGATE_SETTLE_MS)]);
        if (cancelled) return;
        if (arrival.status === "failed") {
          respond({ success: false, message: `Could not open the addressed view: ${arrival.message}` });
          return;
        }
        // Still ours after the settle time? A navigation dispatched since
        // then would be what is on screen.
        if (arrival.status === "superseded" || useStore.getState().navigateSeq !== seq) {
          respond({ success: false, message: SUPERSEDED_MESSAGE });
          return;
        }
        navigatedSeq = seq;
        if (arrival.status === "timeout") {
          navigationNote = `The viewer had not confirmed reaching the address after ${NAVIGATE_VERDICT_TIMEOUT_MS / 1000} s; this shows what was on screen.`;
        }
      }

      const result = await captureViewer(el, { selector: fineSelector(address), captureViewport });
      if (cancelled) return;
      if (navigatedSeq !== null && useStore.getState().navigateSeq !== navigatedSeq) {
        respond({ success: false, message: SUPERSEDED_MESSAGE });
        return;
      }
      if (!result.ok) { respond({ success: false, message: result.message }); return; }
      const note = [navigationNote, result.note].filter(Boolean).join(" ") || undefined;

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
          message: note,
          data: { path: json.path, width: result.width, height: result.height, method: result.method },
        });
      } catch (err) {
        respond({ success: false, message: err instanceof Error ? err.message : "Failed to save the screenshot" });
      }
    })();

    return () => { cancelled = true; };
  }, [actionRequest, setActionRequest, setNavigateRequest, previewRef, captureViewport]);
}

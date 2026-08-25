/**
 * One rung's page, framed.
 *
 * An explainer page is a complete, self-contained document, so it renders
 * in an iframe via `srcdoc` — light-theme paper inside dark chrome, framed
 * and rounded so it reads as an artifact rather than as the app's own
 * background. Unlike a slide it SCROLLS: no viewport clamp, no zoom, no
 * fitting. The pane fills its share of the canvas and the page scrolls
 * inside it.
 *
 * The iframe is keyed by audience upstream, so switching rungs mounts a
 * new document rather than mutating one — cheap here (pages are ~10-20 KB
 * with inline CSS; slide's iframe pool exists to hide a CDN round-trip
 * that these pages do not make) and it keeps each page's scroll position
 * from leaking into the next.
 *
 * Two conversations run over `postMessage`, both filtered by
 * `e.source === contentWindow` so a second pane's page can never answer
 * for this one:
 *   parent → page: select-mode toggle, scroll-to-anchor;
 *   page → parent: the element the reader picked, the anchor verdict.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { AudienceEntry } from "../domain.js";
import { SCROLL_RESULT_MESSAGE, SCROLL_TO_MESSAGE } from "./page-script.js";

/** The raw shape the shared selection script posts back. */
export interface PageSelectionPayload {
  type: string;
  content: string;
  level?: number;
  tag?: string;
  classes?: string;
  selector?: string;
  thumbnail?: string;
  label?: string;
  nearbyText?: string;
  accessibility?: string;
}

export interface AnchorRequest {
  seq: number;
  anchor: string;
}

export interface PagePaneProps {
  audience: AudienceEntry | null;
  /** The page's HTML, or null when the agent has not written it yet. */
  html: string | null;
  /** Full document for the iframe — built by the parent from `html`. */
  srcdoc: string | null;
  /** Rendered above the frame while comparing; omitted in single-pane view. */
  header?: ReactNode;
  selectMode: boolean;
  anchorRequest?: AnchorRequest | null;
  onAnchorResult?: (seq: number, found: boolean) => void;
  onSelectElement?: (payload: PageSelectionPayload | null) => void;
}

export default function PagePane({
  audience,
  html,
  srcdoc,
  header,
  selectMode,
  anchorRequest,
  onAnchorResult,
  onSelectElement,
}: PagePaneProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const loadedRef = useRef(false);
  const sentAnchorRef = useRef<number>(-1);
  // Bumped on every document load so the effects below re-run against the
  // document that is actually on screen.
  const [loadTick, setLoadTick] = useState(0);

  const post = useCallback((message: Record<string, unknown>) => {
    try {
      iframeRef.current?.contentWindow?.postMessage(message, "*");
    } catch {
      // A document that is between loads has no window to talk to; the
      // load handler re-sends. Nothing is lost, so nothing is reported.
    }
  }, []);

  // A fresh document starts dormant — tell it which mode it is in.
  const handleLoad = useCallback(() => {
    loadedRef.current = true;
    setLoadTick((t) => t + 1);
    post({ type: "pneuma:selectMode", enabled: selectMode });
  }, [post, selectMode]);

  useEffect(() => {
    if (!loadedRef.current) return;
    post({ type: "pneuma:selectMode", enabled: selectMode });
  }, [selectMode, post]);

  // The page reloads when its HTML changes; until the new document has
  // loaded there is nobody listening.
  useEffect(() => {
    loadedRef.current = false;
  }, [srcdoc]);

  // Anchor scroll. Sent once per request, and only into a loaded document
  // — a request that arrives during a content-set switch waits for the new
  // page's load tick instead of being dropped.
  useEffect(() => {
    if (!anchorRequest) return;
    if (sentAnchorRef.current === anchorRequest.seq) return;
    if (!loadedRef.current) return;
    sentAnchorRef.current = anchorRequest.seq;
    post({
      type: SCROLL_TO_MESSAGE,
      requestId: anchorRequest.seq,
      anchor: anchorRequest.anchor,
    });
  }, [anchorRequest, loadTick, post]);

  // Everything the page says back.
  useEffect(() => {
    const handle = (e: MessageEvent) => {
      const frame = iframeRef.current;
      if (!frame || e.source !== frame.contentWindow) return;
      const data = e.data as Record<string, unknown> | null;
      if (!data) return;
      if (data.type === "pneuma:select") {
        onSelectElement?.((data.selection as PageSelectionPayload | null) ?? null);
      } else if (data.type === SCROLL_RESULT_MESSAGE) {
        onAnchorResult?.(Number(data.requestId), !!data.found);
      }
    };
    window.addEventListener("message", handle);
    return () => window.removeEventListener("message", handle);
  }, [onSelectElement, onAnchorResult]);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      {header}
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-cc-border bg-white shadow-[0_10px_40px_rgba(0,0,0,0.35)]">
        {srcdoc !== null && html !== null ? (
          <iframe
            ref={iframeRef}
            srcDoc={srcdoc}
            title={audience?.label || "Explainer page"}
            className="h-full w-full border-0"
            sandbox="allow-scripts"
            onLoad={handleLoad}
          />
        ) : (
          <PendingPage audience={audience} />
        )}
      </div>
    </section>
  );
}

/**
 * What a rung looks like before its page exists. Named, not blank: the
 * manifest already promised this audience, and the honest answer is "not
 * written yet" rather than an empty white rectangle that reads as a broken
 * render.
 */
function PendingPage({ audience }: { audience: AudienceEntry | null }) {
  return (
    <div className="grid h-full place-items-center bg-cc-surface/40 px-6 text-center">
      <div className="max-w-xs">
        <div className="mx-auto h-px w-10 bg-cc-border" />
        <p className="mt-4 text-sm font-medium text-cc-fg/80">
          {audience
            ? `No page yet for “${audience.label}”`
            : "This topic has no audiences yet"}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-cc-muted">
          {audience?.file
            ? `The manifest points at ${audience.file}. Ask the agent to write it.`
            : "Ask the agent who this should be explained to."}
        </p>
      </div>
    </div>
  );
}

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
 *
 * The anchor half of that conversation has real timing to it — a fresh
 * sandboxed document is not reachable until it has loaded — so it lives in
 * `AnchorRelay`, and this component only feeds it the three facts it cannot
 * see for itself: the request, the document swap, the load.
 */

import { useCallback, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { AudienceEntry } from "../domain.js";
import { AnchorRelay, type AnchorRequest } from "./anchor-relay.js";
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

export type { AnchorRequest };

export interface PagePaneProps {
  audience: AudienceEntry | null;
  /** The page's HTML, or null when the agent has not written it yet. */
  html: string | null;
  /** Full document for the iframe — built by the parent from `html`. */
  srcdoc: string | null;
  /** Rendered above the frame while comparing; omitted in single-pane view. */
  header?: ReactNode;
  selectMode: boolean;
  /** Pre-filtered by the parent: present only when THIS pane is the target. */
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
  // The document this pane can actually talk to — null while the agent has
  // not written the page (the placeholder below is up and there is no frame).
  const doc = srcdoc !== null && html !== null ? srcdoc : null;

  const post = useCallback((message: Record<string, unknown>) => {
    try {
      iframeRef.current?.contentWindow?.postMessage(message, "*");
    } catch {
      // A document that is between loads has no window to talk to; the
      // load handler re-sends. Nothing is lost, so nothing is reported.
    }
  }, []);

  // The relay outlives every render of this pane and reports through
  // whatever callback the latest render supplied, so the verdict cannot be
  // sent to a stale closure. It is fed, never torn down — see its header for
  // why an effect cleanup must not answer for it.
  const onAnchorResultRef = useRef(onAnchorResult);
  onAnchorResultRef.current = onAnchorResult;
  const relayRef = useRef<AnchorRelay | null>(null);
  if (!relayRef.current) {
    relayRef.current = new AnchorRelay({
      post: (seq, anchor) =>
        post({ type: SCROLL_TO_MESSAGE, requestId: seq, anchor }),
      report: (seq, found) => onAnchorResultRef.current?.(seq, found),
    });
  }
  const relay = relayRef.current;

  // A fresh document starts dormant — tell it which mode it is in.
  const handleLoad = useCallback(() => {
    loadedRef.current = true;
    post({ type: "pneuma:selectMode", enabled: selectMode });
    relay.documentLoaded();
  }, [post, selectMode, relay]);

  useEffect(() => {
    if (!loadedRef.current) return;
    post({ type: "pneuma:selectMode", enabled: selectMode });
  }, [selectMode, post]);

  // The page reloads when its HTML changes; until the new document has
  // loaded there is nobody listening.
  useEffect(() => {
    loadedRef.current = false;
    relay.setDocument(doc);
  }, [doc, relay]);

  // Anchor scroll. The relay holds it until there is a loaded document to
  // ask — a request that arrives during a rung switch or a font fetch waits
  // for that document rather than spending its budget on the network.
  useEffect(() => {
    relay.request(anchorRequest ?? null);
  }, [anchorRequest, relay]);

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
        relay.reply(Number(data.requestId), !!data.found);
      }
    };
    window.addEventListener("message", handle);
    return () => window.removeEventListener("message", handle);
  }, [onSelectElement, relay]);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      {header}
      {/* White belongs to the document, not to the frame: a finished page is a
          light document, but before one exists that white becomes a bare slab
          with the pending state's translucent tint washed out on top of it. */}
      <div
        className={`relative min-h-0 flex-1 overflow-hidden rounded-xl border border-cc-border shadow-[0_10px_40px_rgba(0,0,0,0.35)] ${
          doc !== null ? "bg-white" : "bg-cc-card"
        }`}
      >
        {doc !== null ? (
          <iframe
            ref={iframeRef}
            srcDoc={doc}
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
    <div className="grid h-full place-items-center px-6 text-center">
      <div className="max-w-sm">
        <div className="mx-auto h-px w-12 bg-cc-border" />
        <p className="mt-5 text-base font-medium text-cc-fg">
          {audience
            ? `No page yet for “${audience.label}”`
            : "This topic has no audiences yet"}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-cc-muted">
          {audience?.file
            ? "The rung is on the ladder; its page has not been written."
            : "Ask the agent who this should be explained to."}
        </p>
        {audience?.file ? (
          <p className="mt-4 font-mono text-xs text-cc-muted/70">{audience.file}</p>
        ) : null}
      </div>
    </div>
  );
}

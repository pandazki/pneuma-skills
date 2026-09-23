/**
 * viewer-capture — renders the live viewer panel to a PNG so the agent's
 * `capture` viewer action can return a screenshot the agent can Read.
 *
 * This exists so the agent can visually self-QA *inside* Pneuma. Without it,
 * a coding agent's reflex is to spawn an external browser to "verify" web
 * output — which renders the raw files without the viewer's mode-specific
 * rendering rules (slide's injected theme.css, kami's paper sizing, webcraft's
 * content-set/asset resolution), so it shows something the user never sees.
 *
 * Capture strategy, by environment:
 *   - Electron desktop: `pneumaDesktop.capturePage` — a real OS window
 *     screenshot. Pixel-perfect and sees iframe content for every mode,
 *     including slide's sandboxed iframes. The production path.
 *   - Browser dev: `@zumer/snapdom`. For a same-origin iframe (webcraft,
 *     kami) it snapshots the inner document — full page, full scroll height.
 *     For a sandboxed iframe (slide) the inner document is unreachable, so
 *     browser-dev capture degrades to a clear error.
 *
 * Shooting a same-origin iframe page (`shootIframePage`) waits for the page
 * first and survives it being replaced:
 *   - A viewer whose page is (re)loading marks the iframe `aria-busy="true"`
 *     until the page document has loaded (webcraft sets it when it navigates
 *     the iframe and from the page's `pagehide`). The capture waits for that
 *     to clear, for the document's `load`, and for its web fonts — bounded,
 *     never forever.
 *   - snapdom runs inside the iframe's own window. When that document is
 *     replaced mid-capture (an agent edit lands a moment after the capture
 *     request and the viewer reloads the page), the old window's promises
 *     never settle — the capture used to hang until the server's 60 s
 *     timeout. A replacement now aborts that attempt and shoots the new page.
 *   - A background tab gets no animation frames, and Chrome throttles its
 *     chained timers to one wake-up per minute after five minutes hidden.
 *     Nothing here polls, and scroll-reveal priming (which cannot fire
 *     without frames) is skipped there — with a note in the result.
 */

import { snapdomFor } from "./iframe-snapdom.js";

export interface CaptureSuccess {
  ok: true;
  /** PNG bytes, base64-encoded, no `data:` prefix. */
  base64: string;
  mediaType: "image/png";
  width: number;
  height: number;
  /** Which strategy produced the image — diagnostic only. */
  method: string;
  /** Non-fatal caveat (e.g. a selector that could not be honored). */
  note?: string;
}
export interface CaptureFailure {
  ok: false;
  message: string;
}
export type CaptureResult = CaptureSuccess | CaptureFailure;

type CapturePage = (
  rect?: { x: number; y: number; width: number; height: number },
) => Promise<string | null>;

/** Electron preload bridge — present only in the desktop app. */
function electronCapturePage(): CapturePage | undefined {
  if (typeof window === "undefined") return undefined;
  const api = (window as unknown as { pneumaDesktop?: { capturePage?: CapturePage } }).pneumaDesktop;
  return typeof api?.capturePage === "function" ? api.capturePage.bind(api) : undefined;
}

/** Same-origin iframe document, or null when sandboxed / cross-origin / absent. */
function accessibleIframeDoc(iframe: HTMLIFrameElement | null): Document | null {
  if (!iframe) return null;
  try {
    return iframe.contentDocument ?? null;
  } catch {
    return null; // cross-origin access throws
  }
}

/** Read the natural pixel dimensions of a PNG data URL. */
function pngDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = dataUrl;
  });
}

const stripDataPrefix = (d: string) => (d.startsWith("data:") ? d.slice(d.indexOf(",") + 1) : d);

async function snapdomToPng(el: Element, bg?: string | null): Promise<string | null> {
  // When capturing a sub-element, snapdom paints the element's own box but
  // not the inherited body/html background — the resulting PNG comes back
  // transparent against any non-white themed page (parchment, dark, etc.),
  // which the agent then sees as a "broken" capture. Apply the effective
  // background as an inline style on the target before the snapshot so the
  // captured tile carries the page's color through; also pass `backgroundColor`
  // to snapdom for belt-and-suspenders.
  const htmlEl = el as HTMLElement;
  const hasInlineStyle = !!htmlEl.style;
  let prevBg: string | null = null;
  if (bg && hasInlineStyle) {
    prevBg = htmlEl.style.backgroundColor;
    htmlEl.style.backgroundColor = bg;
  }
  // snapdom clones the element, not its ancestors, so the language the page
  // declares on <html lang> does not reach the clone. Without it the
  // rasterizer cannot hyphenate: under `hyphens: auto` every line comes out
  // longer than the page's own, spills past the height snapdom froze, and
  // justified multi-column text prints over the next paragraph. Carry the
  // effective language onto the captured root for the duration of the shot.
  const inheritedLang = el.hasAttribute("lang") ? null : el.closest("[lang]")?.getAttribute("lang") ?? null;
  if (inheritedLang) el.setAttribute("lang", inheritedLang);
  try {
    // Run snapdom in the element's own window — for an element inside a
    // same-origin iframe (webcraft, kami) this resolves the iframe's CSS vars
    // and SVG paint servers, which the outer snapdom renders black.
    const snapdom = await snapdomFor(el);
    const result = await snapdom(el as HTMLElement, {
      embedFonts: true,
      ...(bg ? { backgroundColor: bg } : {}),
    });
    const png = await result.toPng();
    return png.src || null;
  } catch {
    return null;
  } finally {
    if (bg && hasInlineStyle) {
      htmlEl.style.backgroundColor = prevBg ?? "";
    }
    if (inheritedLang) el.removeAttribute("lang");
  }
}

/**
 * Walk an element's ancestor chain to find the first opaque backgroundColor.
 * Falls back to `<body>`, then `<html>`, then `null` when nothing is set.
 * Used to keep sub-element captures from coming back transparent against a
 * themed page background.
 */
function effectiveBackgroundColor(el: Element): string | null {
  const doc = el.ownerDocument;
  const win = doc?.defaultView;
  if (!doc || !win) return null;
  const opaque = (c: string | null | undefined): c is string => {
    if (!c) return false;
    if (c === "transparent" || c === "rgba(0, 0, 0, 0)") return false;
    return true;
  };
  let node: Element | null = el;
  while (node && node !== doc.documentElement) {
    const cs = win.getComputedStyle(node);
    if (opaque(cs.backgroundColor)) return cs.backgroundColor;
    node = node.parentElement;
  }
  const bodyBg = doc.body && opaque(win.getComputedStyle(doc.body).backgroundColor)
    ? win.getComputedStyle(doc.body).backgroundColor
    : null;
  if (bodyBg) return bodyBg;
  const htmlBg = opaque(win.getComputedStyle(doc.documentElement).backgroundColor)
    ? win.getComputedStyle(doc.documentElement).backgroundColor
    : null;
  return htmlBg;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const joinNotes = (...notes: (string | undefined)[]) => notes.filter(Boolean).join(" ") || undefined;

/** Upper bound on waiting for an iframe page to be ready before shooting it anyway. */
const PAGE_READY_TIMEOUT_MS = 12_000;
/** Upper bound on waiting for a page's web fonts. */
const FONTS_READY_TIMEOUT_MS = 3_000;
/** Upper bound on one rasterization of an iframe page. */
const SHOT_TIMEOUT_MS = 20_000;
/** A page replaced this many times in a row while being shot is reported, not chased. */
const MAX_SHOT_ATTEMPTS = 3;

/** Shown when the capture ran in a tab the browser is not rendering. */
export const HIDDEN_TAB_NOTE =
  "The Pneuma viewer tab is in the background, so the page could not run scroll-triggered reveals or animations before this capture; content that animates in may be missing.";

/** Resolve after `ms`, or when `signal` fires, whichever is first. */
function waitFor(ms: number, subscribe: (fire: () => void) => () => void): Promise<boolean> {
  return new Promise((resolve) => {
    let unsubscribe = () => {};
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(false);
    }, ms);
    unsubscribe = subscribe(() => {
      clearTimeout(timer);
      unsubscribe();
      resolve(true);
    });
  });
}

const isBusy = (iframe: HTMLIFrameElement) => iframe.getAttribute("aria-busy") === "true";

/** Fire when the iframe's `aria-busy` changes. */
function onBusyChange(iframe: HTMLIFrameElement, fire: () => void): () => void {
  const Observer = (iframe.ownerDocument.defaultView as (Window & typeof globalThis) | null)?.MutationObserver;
  if (!Observer) return () => {};
  const mo = new Observer(() => fire());
  mo.observe(iframe, { attributes: true, attributeFilter: ["aria-busy"] });
  return () => mo.disconnect();
}

/**
 * Wait until the iframe's page is ready to shoot: the viewer no longer marks
 * it busy, its document has loaded, and its web fonts are in. Bounded by
 * `PAGE_READY_TIMEOUT_MS` overall; returns the document to shoot (or null
 * when it is not reachable) and whether it really settled.
 */
async function pageReady(iframe: HTMLIFrameElement): Promise<{ doc: Document | null; settled: boolean }> {
  const deadline = Date.now() + PAGE_READY_TIMEOUT_MS;
  const left = () => Math.max(0, deadline - Date.now());
  while (left() > 0) {
    if (isBusy(iframe)) {
      await waitFor(left(), (fire) => onBusyChange(iframe, fire));
      continue;
    }
    const doc = accessibleIframeDoc(iframe);
    if (!doc) return { doc: null, settled: true };
    if (doc.readyState !== "complete") {
      const win = doc.defaultView;
      await waitFor(left(), (fire) => {
        if (!win) return () => {};
        win.addEventListener("load", fire);
        iframe.addEventListener("load", fire);
        return () => {
          win.removeEventListener("load", fire);
          iframe.removeEventListener("load", fire);
        };
      });
      continue;
    }
    const fonts = doc.fonts as FontFaceSet | undefined;
    if (fonts?.ready) {
      await Promise.race([fonts.ready.catch(() => undefined), sleep(Math.min(FONTS_READY_TIMEOUT_MS, left()))]);
    }
    if (!isBusy(iframe) && iframe.contentDocument === doc) return { doc, settled: true };
  }
  return { doc: accessibleIframeDoc(iframe), settled: false };
}

type Shot = { png: string | null } | { replaced: true } | { timedOut: true };

/**
 * Run `shoot` against the iframe's settled page; if the page is replaced
 * while it runs (the iframe loads a new document or the viewer marks it
 * busy), give up on that attempt and shoot the new page instead.
 */
async function shootIframePage(
  iframe: HTMLIFrameElement,
  shoot: (doc: Document) => Promise<string | null>,
): Promise<{ png: string | null; doc: Document | null; note?: string; error?: string }> {
  let note: string | undefined;
  for (let attempt = 0; attempt < MAX_SHOT_ATTEMPTS; attempt++) {
    const { doc, settled } = await pageReady(iframe);
    if (!doc) return { png: null, doc: null };
    if (!settled) note = "The page had not finished loading when it was captured.";
    let stop = () => {};
    const replaced = new Promise<Shot>((resolve) => {
      const fire = () => resolve({ replaced: true });
      const unBusy = onBusyChange(iframe, () => { if (isBusy(iframe)) fire(); });
      iframe.addEventListener("load", fire);
      stop = () => {
        unBusy();
        iframe.removeEventListener("load", fire);
      };
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<Shot>((resolve) => {
      timer = setTimeout(() => resolve({ timedOut: true }), SHOT_TIMEOUT_MS);
    });
    const result = await Promise.race([shoot(doc).then((png): Shot => ({ png })), replaced, timedOut]);
    stop();
    clearTimeout(timer);
    if ("png" in result) {
      if (iframe.contentDocument !== doc) continue; // swapped between the last paint and now
      return { png: result.png, doc, note };
    }
    if ("timedOut" in result) {
      return { png: null, doc, error: `Rendering the page did not finish within ${SHOT_TIMEOUT_MS / 1000} s.` };
    }
  }
  return {
    png: null,
    doc: null,
    error: `The page was replaced ${MAX_SHOT_ATTEMPTS} times while it was being captured (it is being edited); try again once it settles.`,
  };
}

/**
 * Scroll a same-origin iframe through its full height once so scroll-triggered
 * entrance animations (IntersectionObserver-based reveals — common on webcraft
 * pages) fire before a full-page snapshot. Without this, everything below the
 * fold snapshots blank. Best-effort; restores the original scroll position.
 *
 * Returns false when it could not run: in a hidden tab there are no
 * rendering steps, so observers would not fire however long it waited, and
 * its chain of short sleeps is what Chrome throttles to a minute each.
 */
async function primeScrollReveals(iframe: HTMLIFrameElement): Promise<boolean> {
  try {
    const win = iframe.contentWindow;
    const doc = iframe.contentDocument;
    if (!win || !doc) return true;
    if (doc.visibilityState === "hidden") return false;
    const total = doc.documentElement.scrollHeight;
    const step = win.innerHeight || 800;
    if (total <= step + 4) return true; // single screen — nothing to reveal
    // Defeat CSS `scroll-behavior: smooth` — otherwise each scrollTo animates
    // and the loop finishes before the page has moved, so reveals never fire.
    const rootEl = doc.documentElement;
    const prevBehavior = rootEl.style.scrollBehavior;
    rootEl.style.setProperty("scroll-behavior", "auto", "important");
    const prevY = win.scrollY;
    for (let y = 0; y <= total; y += step) {
      win.scrollTo(0, y);
      await sleep(70);
    }
    win.scrollTo(0, prevY);
    rootEl.style.scrollBehavior = prevBehavior;
    await sleep(600); // let entrance animations settle
  } catch { /* best effort */ }
  return true;
}

/**
 * Render the viewer (or a region of it) to a PNG.
 *
 * @param previewEl  The element wrapping the mode's PreviewComponent.
 * @param opts.selector  Optional CSS selector — capture just that element.
 * @param opts.captureViewport  The mode viewer's domain renderer, if any
 *   (diagram/draw/sprite/lucid expose one); tried FIRST for a full capture,
 *   before the iframe and Electron strategies.
 */
export async function captureViewer(
  previewEl: HTMLElement,
  opts: {
    selector?: string;
    captureViewport?: (() => Promise<{ data: string; media_type: string } | null>) | null;
  } = {},
): Promise<CaptureResult> {
  const selector = opts.selector?.trim() || undefined;
  const iframe = previewEl.querySelector("iframe");
  const innerDoc = accessibleIframeDoc(iframe);
  const capturePage = electronCapturePage();

  const finalize = async (
    dataUrl: string,
    method: string,
    note?: string,
  ): Promise<CaptureResult> => {
    const asUrl = dataUrl.startsWith("data:") ? dataUrl : `data:image/png;base64,${dataUrl}`;
    const { width, height } = await pngDimensions(asUrl);
    if (width === 0 || height === 0) {
      return { ok: false, message: `Capture via ${method} produced an unreadable image` };
    }
    return { ok: true, base64: stripDataPrefix(dataUrl), mediaType: "image/png", width, height, method, note };
  };

  // ── Region capture (a CSS selector was given) ─────────────────────────────
  if (selector) {
    // Same-origin iframe (webcraft, kami) — resolve the selector inside it.
    if (innerDoc && iframe) {
      const { doc: readyDoc } = await pageReady(iframe);
      const pageDoc = readyDoc ?? innerDoc;
      const hiddenNote = pageDoc.visibilityState === "hidden" ? HIDDEN_TAB_NOTE : undefined;
      const target = pageDoc.querySelector(selector);
      if (!target) return { ok: false, message: `Selector not found in the rendered page: ${selector}` };
      target.scrollIntoView({ behavior: "instant", block: "center", inline: "center" });
      await sleep(450); // let any scroll-triggered reveal settle
      const targetEl = target as HTMLElement;
      const r = targetEl.getBoundingClientRect();
      // Electron-first when the target fits the iframe viewport: a real OS
      // screenshot picks up the inherited page background (parchment, etc.)
      // that snapdom drops when shooting a sub-element. For targets taller
      // than the visible iframe, snapdom is the only path that captures the
      // full content.
      const iframeWin = iframe?.contentWindow;
      const fitsViewport =
        !!iframeWin &&
        r.width <= iframeWin.innerWidth + 1 &&
        r.height <= iframeWin.innerHeight + 1;
      if (capturePage && iframe && fitsViewport) {
        const fr = iframe.getBoundingClientRect();
        const shot = await capturePage({ x: fr.left + r.left, y: fr.top + r.top, width: r.width, height: r.height });
        if (shot) return finalize(shot, "electron-iframe-element");
      }
      const bg = effectiveBackgroundColor(targetEl);
      const snap = await shootIframePage(iframe, async (doc) => {
        // A replaced page is shot again: find the element in the new one.
        const el = doc === pageDoc ? targetEl : (doc.querySelector(selector) as HTMLElement | null);
        return el ? snapdomToPng(el, bg) : null;
      });
      if (snap.error) return { ok: false, message: snap.error };
      if (snap.png) return finalize(snap.png, "snapdom-iframe-element", joinNotes(hiddenNote, snap.note));
      if (capturePage && iframe) {
        // Final fallback — try the OS screenshot even for oversized targets;
        // captures whatever portion of the element is visible in the iframe.
        const fr = iframe.getBoundingClientRect();
        const shot = await capturePage({ x: fr.left + r.left, y: fr.top + r.top, width: r.width, height: r.height });
        if (shot) return finalize(shot, "electron-iframe-element");
      }
      return { ok: false, message: `Failed to capture element: ${selector}` };
    }
    // Sandboxed iframe (slide) — the inner document is unreachable, so a
    // selector inside it cannot be resolved. Fall back to a full capture.
    if (iframe && !innerDoc) {
      if (capturePage) {
        const r = previewEl.getBoundingClientRect();
        const shot = await capturePage({ x: r.left, y: r.top, width: r.width, height: r.height });
        if (shot) {
          return finalize(
            shot,
            "electron-full",
            `Selector "${selector}" could not be resolved — this viewer's iframe is sandboxed. Captured the full viewer instead.`,
          );
        }
      }
      return {
        ok: false,
        message: `Selector capture is unavailable for this viewer outside the Pneuma desktop app (its iframe is sandboxed). Use a full capture, or run in the desktop app.`,
      };
    }
    // No iframe — resolve the selector directly in the preview DOM.
    const target = previewEl.querySelector(selector);
    if (!target) return { ok: false, message: `Selector not found: ${selector}` };
    target.scrollIntoView({ block: "center", inline: "center" });
    await sleep(450); // let any scroll-triggered reveal settle
    const targetEl = target as HTMLElement;
    const r = targetEl.getBoundingClientRect();
    const fitsViewport =
      r.width <= window.innerWidth + 1 && r.height <= window.innerHeight + 1;
    if (capturePage && fitsViewport) {
      const shot = await capturePage({ x: r.left, y: r.top, width: r.width, height: r.height });
      if (shot) return finalize(shot, "electron-element");
    }
    const bg = effectiveBackgroundColor(targetEl);
    const png = await snapdomToPng(targetEl, bg);
    if (png) return finalize(png, "snapdom-element");
    if (capturePage) {
      const shot = await capturePage({ x: r.left, y: r.top, width: r.width, height: r.height });
      if (shot) return finalize(shot, "electron-element");
    }
    return { ok: false, message: `Failed to capture element: ${selector}` };
  }

  // ── Full-viewer capture ───────────────────────────────────────────────────
  // A viewer-supplied domain renderer goes first (diagram exports the diagram,
  // sprite draws the stage canvas, lucid asks its scene bridge for a frame).
  //
  // It used to be consulted only when the viewer had NO iframe, on the theory
  // that a same-origin iframe is always better snapshotted whole. That is
  // false for a WebGL canvas: snapdom rasterizes the DOM, and a `<canvas>`
  // whose context was created without `preserveDrawingBuffer` reads back as
  // an empty (black) buffer outside its own draw call — so the mode that CAN
  // render a real frame was the one path never asked. A mode that declares a
  // renderer is stating it knows better than a generic rasterizer what its
  // viewport means; `null` or a throw is not a failure, it just falls through
  // to the same order as before. Region captures (a selector was given) are
  // unaffected — a renderer answers for the whole viewport, not a sub-element.
  if (opts.captureViewport) {
    try {
      const r = await opts.captureViewport();
      if (r?.data) return finalize(`data:${r.media_type};base64,${r.data}`, "viewer-captureViewport");
    } catch { /* fall through */ }
  }
  // Same-origin iframe: snapshot the inner document — full page incl. scroll.
  if (iframe && innerDoc) {
    let hiddenNote: string | undefined;
    const snap = await shootIframePage(iframe, async (doc) => {
      if (!(await primeScrollReveals(iframe))) hiddenNote = HIDDEN_TAB_NOTE;
      const root = doc.body || doc.documentElement;
      return root ? snapdomToPng(root) : null;
    });
    if (snap.error) return { ok: false, message: snap.error };
    if (snap.png) return finalize(snap.png, "snapdom-iframe", joinNotes(hiddenNote, snap.note));
    // fall through to Electron
  }
  // Electron real screenshot of the on-screen preview region.
  if (capturePage) {
    const r = previewEl.getBoundingClientRect();
    const shot = await capturePage({ x: r.left, y: r.top, width: r.width, height: r.height });
    if (shot) return finalize(shot, "electron-full");
  }
  // Browser-dev DOM fallback for non-iframe modes (doc, illustrate, draw).
  if (!iframe) {
    const png = await snapdomToPng(previewEl);
    if (png) return finalize(png, "snapdom-dom");
  }
  return {
    ok: false,
    message: iframe
      ? "Screenshot is unavailable for this viewer outside the Pneuma desktop app. The user is watching the live preview — trust it, or run in the desktop app to capture."
      : "Screenshot capture failed.",
  };
}

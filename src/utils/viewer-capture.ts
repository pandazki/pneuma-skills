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

/**
 * Scroll a same-origin iframe through its full height once so scroll-triggered
 * entrance animations (IntersectionObserver-based reveals — common on webcraft
 * pages) fire before a full-page snapshot. Without this, everything below the
 * fold snapshots blank. Best-effort; restores the original scroll position.
 */
async function primeScrollReveals(iframe: HTMLIFrameElement): Promise<void> {
  try {
    const win = iframe.contentWindow;
    const doc = iframe.contentDocument;
    if (!win || !doc) return;
    const total = doc.documentElement.scrollHeight;
    const step = win.innerHeight || 800;
    if (total <= step + 4) return; // single screen — nothing to reveal
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
}

/**
 * Render the viewer (or a region of it) to a PNG.
 *
 * @param previewEl  The element wrapping the mode's PreviewComponent.
 * @param opts.selector  Optional CSS selector — capture just that element.
 * @param opts.captureViewport  The mode viewer's domain renderer, if any
 *   (diagram/draw expose one); used for full captures of non-iframe modes.
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
    if (innerDoc) {
      const target = innerDoc.querySelector(selector);
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
      const png = await snapdomToPng(targetEl, bg);
      if (png) return finalize(png, "snapdom-iframe-element");
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
  // Same-origin iframe: snapshot the inner document — full page incl. scroll.
  if (iframe && innerDoc) {
    await primeScrollReveals(iframe);
    const root = innerDoc.body || innerDoc.documentElement;
    const png = root ? await snapdomToPng(root) : null;
    if (png) return finalize(png, "snapdom-iframe");
    // fall through to Electron
  }
  // A viewer-supplied domain renderer (diagram exports the diagram, etc.).
  if (opts.captureViewport && !iframe) {
    try {
      const r = await opts.captureViewport();
      if (r?.data) return finalize(`data:${r.media_type};base64,${r.data}`, "viewer-captureViewport");
    } catch { /* fall through */ }
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

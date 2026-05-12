import { getApiBase } from "../utils/api.js";

/**
 * useThumbnailCapture — captures the viewer panel as a PNG thumbnail.
 *
 * Capture path, in priority order:
 *   0. Viewer-supplied captureViewport() — a domain-specific renderer (e.g.
 *      diagram exports the diagram). Cleanest when available.
 *   1. Desktop app (Electron): a real window screenshot of the viewer's rect
 *      via `pneumaDesktop.capturePage` — renders iframe content (webcraft,
 *      mode-maker play), web fonts, and full-window viewers exactly.
 *   2. Browser dev (no Electron): best-effort DOM serializer —
 *      a) largest <canvas> (Excalidraw) b) dominant/hi-res <img> (Illustrate,
 *      Slide) c) @zumer/snapdom DOM snapshot (Doc, Slide). Cannot see into
 *      iframes — webcraft etc. won't get a real thumbnail here.
 *
 * Capture triggers (each pass overwrites the previous one, so a later, more
 * settled frame always wins):
 *   - A few escalating passes after mount (CAPTURE_PASSES_MS) — covers entry
 *     animations and content that lands a couple seconds in (including short-
 *     lived sessions that close before the file-change debounce fires).
 *   - Debounced after any file change (FILE_CHANGE_DEBOUNCE_MS).
 *   - Only when the viewer is visible (PreviewComponent loaded).
 *
 * Each pass first waits for the render to settle: a short minimum delay, then
 * until no finite CSS animations/transitions are running in the viewer subtree
 * (bounded by SETTLE_MAX_MS), then a couple of rAFs + idle. Captures that come
 * out near-uniform (blank white / blank dark chrome — e.g. an iframe viewer
 * whose contents snapdom can't reach) are dropped rather than uploaded, so a
 * blank frame never replaces a good one.
 */

import { useEffect, useRef } from "react";
import { snapdom } from "@zumer/snapdom";

const THUMB_WIDTH = 1280;
const THUMB_HEIGHT = 800;

/** Escalating capture passes (ms after the viewer mounts). */
const CAPTURE_PASSES_MS = [1500, 5000, 14000];
/** Debounce after the last file change before recapturing. */
const FILE_CHANGE_DEBOUNCE_MS = 6000;
/** Minimum settle wait inside a pass (let React commit + first paint). */
const SETTLE_MIN_MS = 250;
/** Upper bound on waiting for finite animations to finish. */
const SETTLE_MAX_MS = 6000;
/** Per-channel spread (over a downscaled grid) at/below which a frame is "blank". */
const BLANK_SPREAD_THRESHOLD = 10;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const idle = (timeout: number) =>
  new Promise<void>((r) => {
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void }).requestIdleCallback;
    if (ric) ric(() => r(), { timeout });
    else setTimeout(r, 0);
  });

/**
 * Count finite (non-infinite) CSS animations/transitions currently running in
 * the element's subtree. Infinite/looping effects (spinners, pulses) never
 * settle, so they're ignored — otherwise every capture would wait the full
 * SETTLE_MAX_MS.
 */
function runningFiniteAnimations(el: HTMLElement): number {
  const getAnimations = (el as unknown as { getAnimations?: (opts?: { subtree?: boolean }) => Animation[] }).getAnimations;
  if (typeof getAnimations !== "function") return 0;
  let anims: Animation[];
  try {
    anims = getAnimations.call(el, { subtree: true });
  } catch {
    return 0;
  }
  let n = 0;
  for (const a of anims) {
    if (a.playState !== "running") continue;
    let iterations: number | undefined;
    try {
      iterations = (a.effect as KeyframeEffect | null)?.getComputedTiming?.().iterations as number | undefined;
    } catch {
      iterations = undefined;
    }
    if (iterations !== undefined && !Number.isFinite(iterations)) continue; // skip infinite loops
    n++;
  }
  return n;
}

/**
 * Wait for the viewer subtree to look render-stable before snapshotting.
 */
async function waitForStableRender(el: HTMLElement): Promise<void> {
  const start = performance.now();
  await sleep(SETTLE_MIN_MS);
  while (performance.now() - start < SETTLE_MAX_MS) {
    if (runningFiniteAnimations(el) === 0) break;
    await nextFrame();
    await sleep(120);
  }
  await nextFrame();
  await nextFrame();
  await idle(400);
}

/**
 * True if the rendered frame is effectively a single flat color (blank white,
 * blank dark chrome, fully transparent) — i.e. there's nothing worth keeping.
 */
function looksBlank(srcCanvas: HTMLCanvasElement): boolean {
  try {
    const gw = 32;
    const gh = 20;
    const tmp = document.createElement("canvas");
    tmp.width = gw;
    tmp.height = gh;
    const tctx = tmp.getContext("2d", { willReadFrequently: true });
    if (!tctx) return false;
    tctx.drawImage(srcCanvas, 0, 0, gw, gh);
    const { data } = tctx.getImageData(0, 0, gw, gh);
    let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0, aMin = 255, aMax = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (r < rMin) rMin = r; if (r > rMax) rMax = r;
      if (g < gMin) gMin = g; if (g > gMax) gMax = g;
      if (b < bMin) bMin = b; if (b > bMax) bMax = b;
      if (a < aMin) aMin = a; if (a > aMax) aMax = a;
    }
    const spread = Math.max(rMax - rMin, gMax - gMin, bMax - bMin, aMax - aMin);
    return spread <= BLANK_SPREAD_THRESHOLD;
  } catch {
    return false;
  }
}

/**
 * Scale a source image data URL to thumbnail dimensions (cover-fit).
 * Resolves null if the source can't be loaded or the result is blank.
 */
function scaleToThumb(dataUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = THUMB_WIDTH;
      canvas.height = THUMB_HEIGHT;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(null); return; }

      const scale = Math.max(THUMB_WIDTH / img.width, THUMB_HEIGHT / img.height);
      const sw = THUMB_WIDTH / scale;
      const sh = THUMB_HEIGHT / scale;
      const sx = (img.width - sw) / 2;
      const sy = (img.height - sh) / 2;
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, THUMB_WIDTH, THUMB_HEIGHT);

      if (looksBlank(canvas)) { resolve(null); return; }

      const thumbDataUrl = canvas.toDataURL("image/png", 0.8);
      resolve(thumbDataUrl.split(",")[1] || null);
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

/**
 * Capture via viewer's captureViewport() override — returns base64 or null.
 */
async function captureViaViewer(
  captureViewport: () => Promise<{ data: string; media_type: string } | null>,
): Promise<string | null> {
  try {
    const result = await captureViewport();
    if (!result) return null;
    const dataUrl = `data:${result.media_type};base64,${result.data}`;
    return scaleToThumb(dataUrl);
  } catch {
    return null;
  }
}

/**
 * Strategy 1: Capture the largest <canvas> element (Excalidraw, etc.)
 */
function captureViaCanvas(el: HTMLElement): string | null {
  const canvases = el.querySelectorAll("canvas");
  if (canvases.length === 0) return null;

  // Pick the largest canvas by area
  let best: HTMLCanvasElement | null = null;
  let bestArea = 0;
  canvases.forEach((c) => {
    const area = c.width * c.height;
    if (area > bestArea) {
      bestArea = area;
      best = c;
    }
  });

  if (!best || bestArea === 0) return null;
  const bestCanvas = best as HTMLCanvasElement;

  try {
    // Check if canvas has actual drawn content (not just blank/transparent)
    const ctx = bestCanvas.getContext("2d");
    if (ctx) {
      const sample = ctx.getImageData(0, 0, Math.min(bestCanvas.width, 100), Math.min(bestCanvas.height, 100));
      const hasContent = sample.data.some((v, i) => i % 4 === 3 && v > 0); // any non-transparent pixel
      if (!hasContent) return null;
    }
    return bestCanvas.toDataURL("image/png");
  } catch {
    // Tainted canvas (cross-origin) or SecurityError — can't capture
    return null;
  }
}

/**
 * Strategy 2: Gather visible <img> elements and composite by bounding rect.
 * Works for viewers that render images in the DOM (React Flow / Illustrate, etc.)
 */
async function captureViaImages(el: HTMLElement): Promise<string | null> {
  const imgs = el.querySelectorAll("img");
  const containerRect = el.getBoundingClientRect();
  const containerArea = containerRect.width * containerRect.height;

  // Collect visible, loaded images with real dimensions
  const visible: { img: HTMLImageElement; rect: DOMRect }[] = [];
  imgs.forEach((img) => {
    if (!img.complete || img.naturalWidth === 0) return;
    const rect = img.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 40) return;
    if (rect.right < containerRect.left || rect.left > containerRect.right) return;
    if (rect.bottom < containerRect.top || rect.top > containerRect.bottom) return;
    visible.push({ img, rect });
  });

  if (visible.length === 0) return null;

  // Strategy A: If there's a single high-res image that dominates the container,
  // use it directly (e.g. Illustrate's main image, or a full-screen photo).
  const dominant = visible.find(({ rect }) =>
    rect.width * rect.height >= containerArea * 0.3
  );
  if (dominant) {
    const canvas = document.createElement("canvas");
    canvas.width = dominant.img.naturalWidth;
    canvas.height = dominant.img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    try { ctx.drawImage(dominant.img, 0, 0); } catch { return null; }
    return canvas.toDataURL("image/png");
  }

  // Strategy B: Pick the highest-resolution image by natural dimensions.
  // Useful when viewer shows hi-res thumbnails at small display sizes (e.g. Slide).
  const best = visible.reduce((a, b) =>
    (a.img.naturalWidth * a.img.naturalHeight) > (b.img.naturalWidth * b.img.naturalHeight) ? a : b
  );
  // Only use it if the natural resolution is meaningfully large
  if (best.img.naturalWidth >= THUMB_WIDTH && best.img.naturalHeight >= THUMB_HEIGHT) {
    const canvas = document.createElement("canvas");
    canvas.width = best.img.naturalWidth;
    canvas.height = best.img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    try { ctx.drawImage(best.img, 0, 0); } catch { return null; }
    return canvas.toDataURL("image/png");
  }

  return null;
}

/**
 * Strategy 3: snapdom DOM snapshot (Doc, Slide, etc.)
 */
async function captureViaSnapdom(el: HTMLElement): Promise<string | null> {
  try {
    // Scale down so the rendered image doesn't exceed thumbnail dimensions.
    // On a fullscreen viewer (e.g. app layout) the element can be very large;
    // capturing at DPR 2 would create a huge bitmap and OOM the tab.
    const rect = el.getBoundingClientRect();
    const maxDim = Math.max(rect.width, rect.height);
    const scale = maxDim > 0 ? Math.min(THUMB_WIDTH / rect.width, THUMB_HEIGHT / rect.height, 1) : 0.5;

    const result = await snapdom(el, { embedFonts: false });
    const png = await result.toPng({ scale });
    return png.src;
  } catch {
    return null;
  }
}

/**
 * Smart generic capture — tries strategies in order until one succeeds.
 */
async function captureGeneric(el: HTMLElement): Promise<string | null> {
  // 1. Canvas elements (Excalidraw, etc.)
  const canvasResult = captureViaCanvas(el);
  if (canvasResult) return scaleToThumb(canvasResult);

  // 2. Image elements (React Flow, etc.)
  const imgResult = await captureViaImages(el);
  if (imgResult) return scaleToThumb(imgResult);

  // 3. DOM snapshot fallback — skip for very large elements (e.g. fullscreen app layout)
  //    snapdom clones the entire DOM tree which can OOM on complex viewers
  const rect = el.getBoundingClientRect();
  const elArea = rect.width * rect.height;
  const screenArea = window.innerWidth * window.innerHeight;
  if (elArea <= screenArea * 0.8) {
    const snapResult = await captureViaSnapdom(el);
    if (snapResult) return scaleToThumb(snapResult);
  }

  return null;
}

/** Electron preload bridge — present only in the desktop app. */
type DesktopBridge = { capturePage?: (rect?: { x: number; y: number; width: number; height: number }) => Promise<string | null> };
function electronCapture(): DesktopBridge["capturePage"] | undefined {
  if (typeof window === "undefined") return undefined;
  const api = (window as unknown as { pneumaDesktop?: DesktopBridge }).pneumaDesktop;
  return typeof api?.capturePage === "function" ? api.capturePage.bind(api) : undefined;
}

/**
 * Preferred capture path in the desktop app: a real screenshot of this
 * window's viewer region. Unlike the DOM-serializer fallback (snapdom) this
 * renders iframe content (webcraft, mode-maker play), web fonts, and
 * full-window viewers exactly as the user sees them.
 *
 * Returns null if the capture failed *or* came back blank — we deliberately
 * don't fall back to snapdom on a blank result (snapdom would happily produce
 * a worse render, e.g. an iframe shown as a white rectangle); a later pass
 * retries instead.
 */
async function captureViaElectron(
  el: HTMLElement,
  capturePage: NonNullable<DesktopBridge["capturePage"]>,
): Promise<string | null> {
  try {
    const r = el.getBoundingClientRect();
    const rect = r.width > 1 && r.height > 1
      ? { x: r.left, y: r.top, width: r.width, height: r.height }
      : undefined;
    const base64 = await capturePage(rect);
    if (!base64) return null;
    return scaleToThumb(`data:image/png;base64,${base64}`);
  } catch {
    return null;
  }
}

async function uploadThumbnail(base64: string): Promise<void> {
  try {
    await fetch(`${getApiBase()}/api/session/thumbnail`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: base64 }),
    });
  } catch {
    // Network error — non-critical, silently ignore
  }
}

export function useThumbnailCapture(
  previewRef: React.RefObject<HTMLElement | null>,
  hasViewer: boolean,
  fileVersion: number,
  captureViewport?: (() => Promise<{ data: string; media_type: string } | null>) | null,
): void {
  const fileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runningRef = useRef(false);
  const pendingRef = useRef(false);
  const lastCaptureRef = useRef<string | null>(null);

  // captureOnce + trigger are kept in a ref so the timers always call the
  // latest closure (which captures the current `captureViewport` prop) without
  // re-subscribing the effects.
  const triggerRef = useRef(() => {});
  triggerRef.current = () => {
    if (runningRef.current) { pendingRef.current = true; return; }
    runningRef.current = true;
    captureOnce()
      .catch(() => {})
      .finally(() => {
        runningRef.current = false;
        if (pendingRef.current) { pendingRef.current = false; triggerRef.current(); }
      });
  };

  async function captureOnce(): Promise<void> {
    let el = previewRef.current;
    if (!el) return;
    await waitForStableRender(el);
    el = previewRef.current;
    if (!el || !el.isConnected) return;
    let base64: string | null = null;
    if (captureViewport) {
      // A viewer-supplied renderer (e.g. diagram exports the diagram) — cleanest.
      base64 = await captureViaViewer(captureViewport);
    } else {
      const capturePage = electronCapture();
      if (capturePage) {
        // Desktop app: real window screenshot. If it's blank we just skip this
        // pass rather than fall back to the worse snapdom render.
        base64 = await captureViaElectron(el, capturePage);
      } else {
        // Browser dev: best-effort DOM serializer (no iframe contents).
        base64 = await captureGeneric(el);
      }
    }
    if (base64 && base64 !== lastCaptureRef.current) {
      lastCaptureRef.current = base64;
      await uploadThumbnail(base64);
    }
  }

  // Escalating capture passes after the viewer loads.
  useEffect(() => {
    if (!hasViewer) return;
    const timers = CAPTURE_PASSES_MS.map((ms) =>
      setTimeout(() => triggerRef.current(), ms),
    );
    return () => { for (const t of timers) clearTimeout(t); };
  }, [hasViewer]);

  // Debounced capture on file changes.
  useEffect(() => {
    if (!hasViewer || fileVersion === 0) return;
    if (fileTimerRef.current) clearTimeout(fileTimerRef.current);
    fileTimerRef.current = setTimeout(() => triggerRef.current(), FILE_CHANGE_DEBOUNCE_MS);
    return () => {
      if (fileTimerRef.current) clearTimeout(fileTimerRef.current);
    };
  }, [hasViewer, fileVersion]);
}

/**
 * useThumbnailCapture — periodically captures the viewer panel as a PNG thumbnail.
 *
 * Generic smart capture — works for all viewer types without per-viewer implementation:
 *   1. Canvas elements (Excalidraw, etc.) → canvas.toDataURL()
 *   2. Image elements (React Flow/Illustrate, etc.) → composite by bounding rect
 *   3. Pure DOM (Doc, Slide, etc.) → @zumer/snapdom
 *
 * Viewers can still provide captureViewport() to override the generic behavior.
 *
 * Capture triggers:
 *   - 2s after mount (initial capture)
 *   - 30s after any file change (debounced)
 *   - Only when the viewer is visible (PreviewComponent loaded)
 */

import { useEffect, useRef } from "react";
import snapdom from "@zumer/snapdom";

const THUMB_WIDTH = 1280;
const THUMB_HEIGHT = 800;
const INITIAL_DELAY = 2_000;
const DEBOUNCE_DELAY = 10_000;

function getApiBase(): string {
  if (import.meta.env.DEV) {
    return `http://${location.hostname}:${import.meta.env.VITE_API_PORT || "17007"}`;
  }
  return "";
}

/**
 * Scale a source image data URL to thumbnail dimensions (cover-fit).
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

  try {
    // Check if canvas has actual drawn content (not just blank/transparent)
    const ctx = (best as HTMLCanvasElement).getContext("2d");
    if (ctx) {
      const sample = ctx.getImageData(0, 0, Math.min(best.width, 100), Math.min(best.height, 100));
      const hasContent = sample.data.some((v, i) => i % 4 === 3 && v > 0); // any non-transparent pixel
      if (!hasContent) return null;
    }
    return (best as HTMLCanvasElement).toDataURL("image/png");
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
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const capturingRef = useRef(false);
  const lastCaptureRef = useRef<string | null>(null);

  const doCaptureRef = useRef(() => {});
  doCaptureRef.current = () => {
    const el = previewRef.current;
    if (!el || capturingRef.current) return;
    capturingRef.current = true;

    const promise = captureViewport
      ? captureViaViewer(captureViewport)
      : captureGeneric(el);

    promise
      .then((base64) => {
        if (base64 && base64 !== lastCaptureRef.current) {
          lastCaptureRef.current = base64;
          uploadThumbnail(base64);
        }
      })
      .catch(() => {})
      .finally(() => {
        capturingRef.current = false;
      });
  };

  // Initial capture after viewer loads
  useEffect(() => {
    if (!hasViewer) return;
    const timer = setTimeout(() => doCaptureRef.current(), INITIAL_DELAY);
    return () => clearTimeout(timer);
  }, [hasViewer]);

  // Debounced capture on file changes
  useEffect(() => {
    if (!hasViewer || fileVersion === 0) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doCaptureRef.current(), DEBOUNCE_DELAY);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [hasViewer, fileVersion]);
}

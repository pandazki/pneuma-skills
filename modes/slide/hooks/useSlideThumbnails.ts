/**
 * useSlideThumbnails — captures slide thumbnails as PNG data URLs via snapdom.
 *
 * Pipeline:
 *   1. Render each slide in a hidden off-screen iframe (full isolation, scripts run)
 *   2. Use snapdom to capture the iframe body (handles CSS, fonts, images automatically)
 *   3. Convert to PNG data URL, display as <img>
 *
 * This gives full rendering fidelity (Tailwind CDN, external CSS, backdrop-filter, etc.)
 * while producing lightweight <img> thumbnails instead of N live iframes.
 */

import { useState, useEffect, useRef } from "react";
import { snapdom } from "@zumer/snapdom";
import type { ViewerFileContent } from "../../../core/types/viewer-contract.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** djb2 string hash — fast, good enough for change detection */
function djb2(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

/**
 * Sanitize curly (smart) quotes inside HTML tags so attribute values parse correctly.
 * Text content outside tags is left untouched, preserving visible curly quotes.
 */
export function sanitizeHtmlQuotes(html: string): string {
  return html.replace(/<[^>]*>/g, (tag) =>
    tag.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'"),
  );
}

/** Strip full-document wrappers, keeping only body content. Mirrors SlidePreview.tsx. */
export function stripHtmlWrapper(html: string): string {
  if (!html.includes("<!DOCTYPE") && !html.includes("<html")) return html;
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) return bodyMatch[1].trim();
  return html
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .replace(/<\/?html[^>]*>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<\/?body[^>]*>/gi, "")
    .trim();
}

export function getBaseUrl(): string {
  return import.meta.env.DEV ? `http://${location.hostname}:${import.meta.env.VITE_API_PORT || "17007"}` : "";
}

/**
 * CSS injected into capture iframes:
 * - object-fit: fill — snapdom can't reproduce cover/contain in foreignObject,
 *   but fill (stretch) is close enough at thumbnail sizes.
 */
export const CAPTURE_OVERRIDE_CSS = "img[style*='position'][style*='absolute'],img[style*='position'][style*='fixed']{display:none!important;}img{object-fit:fill!important;}";


/** Convert a Blob to a data URL */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Inline external <img src="..."> as data URLs in the HTML string.
 *
 * srcdoc iframes have origin "null", making all localhost images cross-origin.
 * snapdom can't embed cross-origin images. By pre-fetching from the main window
 * (same origin) and inlining as data URLs, the images become part of the document.
 */
export async function inlineImagesInHtml(html: string, baseHref: string): Promise<string> {
  // Match src attribute values in <img> tags
  const imgSrcRegex = /<img\s[^>]*?\bsrc=["']([^"']+)["']/gi;
  const replacements: [string, string][] = [];

  for (const match of html.matchAll(imgSrcRegex)) {
    const originalSrc = match[1];
    if (originalSrc.startsWith("data:")) continue;

    const fullUrl = new URL(originalSrc, baseHref).href;
    try {
      const resp = await fetch(fullUrl);
      if (!resp.ok) continue;
      const blob = await resp.blob();
      const dataUrl = await blobToDataUrl(blob);
      replacements.push([originalSrc, dataUrl]);
    } catch {
      // Failed to fetch — leave original src (snapdom's best effort)
    }
  }

  let result = html;
  for (const [original, dataUrl] of replacements) {
    result = result.replaceAll(original, dataUrl);
  }
  return result;
}

/**
 * Crop a captured PNG to the expected slide dimensions.
 * snapdom may produce a larger image when elements overflow the body bounds
 * (e.g. decorative glow/blur elements with negative offsets).
 * Returns the original src if the image already matches the expected size.
 */
function cropToSlideSize(img: HTMLImageElement, targetW: number, targetH: number): Promise<string> {
  return new Promise((resolve) => {
    const ready = () => {
      const imgW = img.naturalWidth;
      const imgH = img.naturalHeight;
      const ratio = targetW / targetH;
      const actualRatio = imgW / imgH;
      // No crop needed if aspect ratio matches
      if (Math.abs(actualRatio - ratio) < 0.01) {
        resolve(img.src);
        return;
      }
      // Crop to expected aspect ratio from top-left
      let cropW: number, cropH: number;
      if (actualRatio > ratio) {
        cropH = imgH;
        cropW = Math.round(imgH * ratio);
      } else {
        cropW = imgW;
        cropH = Math.round(imgW / ratio);
      }
      const canvas = document.createElement("canvas");
      canvas.width = cropW;
      canvas.height = cropH;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(img.src); return; }
      ctx.drawImage(img, 0, 0, cropW, cropH, 0, 0, cropW, cropH);
      resolve(canvas.toDataURL("image/png"));
    };
    if (img.complete && img.naturalWidth > 0) ready();
    else { img.onload = ready; img.onerror = () => resolve(img.src); }
  });
}

// ── Capture iframe management ────────────────────────────────────────────────

let captureIframe: HTMLIFrameElement | null = null;

export function getOrCreateCaptureIframe(
  width: number,
  height: number,
): HTMLIFrameElement {
  if (captureIframe && captureIframe.isConnected) {
    captureIframe.style.width = `${width}px`;
    captureIframe.style.height = `${height}px`;
    return captureIframe;
  }
  const iframe = document.createElement("iframe");
  iframe.style.cssText = `position:fixed;left:-99999px;top:-99999px;width:${width}px;height:${height}px;border:none;opacity:0;pointer-events:none;`;
  // allow-scripts: needed for Tailwind CDN or other JS-based CSS
  // allow-same-origin: needed to access contentDocument
  iframe.setAttribute("sandbox", "allow-same-origin allow-scripts");
  document.body.appendChild(iframe);
  captureIframe = iframe;
  return iframe;
}

function destroyCaptureIframe(): void {
  if (captureIframe && captureIframe.isConnected) {
    captureIframe.remove();
  }
  captureIframe = null;
}

/** Load srcdoc into iframe and wait for rendering + fonts to complete */
export function loadIframe(iframe: HTMLIFrameElement, srcdoc: string): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, 5000); // max 5s fallback
    iframe.onload = async () => {
      clearTimeout(timeout);
      // Buffer for async CSS generation (Tailwind CDN processes DOM after load)
      await new Promise((r) => setTimeout(r, 150));
      // Wait for fonts to load — prevents text reflow during capture
      try {
        const doc = iframe.contentDocument;
        if (doc?.fonts?.ready) await Promise.race([doc.fonts.ready, new Promise((r) => setTimeout(r, 3000))]);
      } catch { /* cross-origin or unavailable — proceed anyway */ }
      resolve();
    };
    iframe.srcdoc = srcdoc;
  });
}

// ── Core capture function ────────────────────────────────────────────────────

/**
 * Render a slide in a hidden iframe, then capture as PNG data URL via snapdom.
 *
 * Full-document slides (with <!DOCTYPE>) are rendered as-is — Tailwind CDN,
 * external CSS, custom scripts all execute normally in the iframe.
 * Fragment slides are wrapped in our themeCSS template.
 */
export async function captureSlideToSvg(
  slideHtml: string,
  themeCSS: string,
  width: number,
  height: number,
  contentBase = "",
): Promise<string> {
  slideHtml = sanitizeHtmlQuotes(slideHtml);
  const baseUrl = getBaseUrl();
  const baseHref = `${baseUrl}/content/${contentBase}`;

  // Pre-fetch and inline external images as data URLs.
  // srcdoc iframes have origin "null" — all localhost images are cross-origin
  // and won't be embedded by snapdom. Inlining fixes this.
  slideHtml = await inlineImagesInHtml(slideHtml, baseHref);

  const isFullDoc =
    slideHtml.includes("<!DOCTYPE") || slideHtml.includes("<html");

  // Build the srcdoc for the capture iframe
  let srcdoc: string;
  if (isFullDoc) {
    // Full document: inject <base> and sizing CSS, keep everything else
    srcdoc = slideHtml;
    const inject = `<base href="${baseHref}"><style>html,body{width:${width}px;height:${height}px;margin:0;padding:0;overflow:hidden;}${CAPTURE_OVERRIDE_CSS}</style>`;
    if (srcdoc.includes("</head>")) {
      srcdoc = srcdoc.replace("</head>", `${inject}</head>`);
    } else if (/<body/i.test(srcdoc)) {
      srcdoc = srcdoc.replace(/<body/i, `<head>${inject}</head><body`);
    }
  } else {
    // Fragment: wrap in our template
    const bodyContent = stripHtmlWrapper(slideHtml);
    srcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><base href="${baseHref}"><style>${themeCSS}</style><style>html,body{width:${width}px;height:${height}px;margin:0;padding:0;overflow:hidden;}${CAPTURE_OVERRIDE_CSS}</style></head><body>${bodyContent}</body></html>`;
  }

  // Render in hidden iframe (full isolation — scripts, external CSS all load)
  const iframe = getOrCreateCaptureIframe(width, height);
  await loadIframe(iframe, srcdoc);

  const iframeDoc = iframe.contentDocument;
  if (!iframeDoc) throw new Error("Cannot access capture iframe document");

  // Hide iframe during capture — snapdom produces more accurate text metrics
  // when the source element is not in layout (avoids foreignObject text reflow).
  // See: https://github.com/zumerlab/snapdom/issues/351
  iframe.style.display = "none";
  const result = await snapdom(iframeDoc.body, { embedFonts: true });
  iframe.style.display = "";
  const png = await result.toPng();
  return cropToSlideSize(png, width, height);
}

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Manages thumbnail capture and caching for all slides.
 *
 * Returns a Map from slide file path to PNG data URL.
 * Uses content hashing to detect changes and a sequential queue
 * to avoid overwhelming the browser with concurrent captures.
 */
export function useSlideThumbnails(
  slides: { file: string; title: string }[],
  files: ViewerFileContent[],
  themeCSS: string,
  virtualWidth: number,
  virtualHeight: number,
  contentBase = "",
): Map<string, string> {
  const [thumbnails, setThumbnails] = useState<Map<string, string>>(new Map());
  const hashesRef = useRef<Map<string, number>>(new Map());
  const queueRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Cancel any in-flight capture queue
    queueRef.current?.abort();
    const controller = new AbortController();
    queueRef.current = controller;

    // Determine which slides need re-capture
    const toCapture: { file: string; html: string; hash: number }[] = [];

    // Prefer the content-set-scoped full path to avoid picking a slide from
    // the wrong content set when multiple sets share the same relative
    // `slides/slide-01.html` name. `contentBase` is `${activeContentSet}/`
    // when a content set is active, empty string otherwise.
    for (const slide of slides) {
      const fullPath = contentBase + slide.file;
      const fileEntry =
        files.find((f) => f.path === fullPath) ??
        files.find(
          (f) => f.path === slide.file || f.path.endsWith(`/${slide.file}`),
        );
      const html = fileEntry?.content || "";
      const hash = djb2(html + themeCSS);
      const prevHash = hashesRef.current.get(slide.file);
      if (prevHash !== hash) {
        toCapture.push({ file: slide.file, html, hash });
      }
    }

    // Clean up hashes for removed slides
    const currentFiles = new Set(slides.map((s) => s.file));
    for (const key of hashesRef.current.keys()) {
      if (!currentFiles.has(key)) {
        hashesRef.current.delete(key);
      }
    }

    if (toCapture.length === 0) {
      // Remove thumbnails for deleted slides
      setThumbnails((prev) => {
        let changed = false;
        const next = new Map(prev);
        for (const key of next.keys()) {
          if (!currentFiles.has(key)) {
            next.delete(key);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
      return;
    }

    // Process captures sequentially (reuses a single hidden iframe)
    (async () => {
      for (const { file, html, hash } of toCapture) {
        if (controller.signal.aborted) return;
        try {
          const dataUrl = await captureSlideToSvg(
            html,
            themeCSS,
            virtualWidth,
            virtualHeight,
            contentBase,
          );
          if (controller.signal.aborted) return;
          hashesRef.current.set(file, hash);
          setThumbnails((prev) => {
            const next = new Map(prev);
            next.set(file, dataUrl);
            for (const key of next.keys()) {
              if (!currentFiles.has(key)) next.delete(key);
            }
            return next;
          });
        } catch {
          // Capture failed — leave old thumbnail (stale-while-revalidate)
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [slides, files, themeCSS, virtualWidth, virtualHeight, contentBase]);

  // Clean up the shared capture iframe on unmount
  useEffect(() => {
    return () => {
      destroyCaptureIframe();
    };
  }, []);

  return thumbnails;
}

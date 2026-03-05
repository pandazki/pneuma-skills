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
import snapdom from "@zumer/snapdom";
import type { ViewerPreviewProps } from "../../../core/types/viewer-contract.js";

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
  return import.meta.env.DEV ? "http://localhost:17007" : "";
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

/** Load srcdoc into iframe and wait for rendering to complete */
export function loadIframe(iframe: HTMLIFrameElement, srcdoc: string): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, 5000); // max 5s fallback
    iframe.onload = () => {
      clearTimeout(timeout);
      // Buffer for async CSS generation (Tailwind CDN processes DOM after load)
      setTimeout(resolve, 150);
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
): Promise<string> {
  slideHtml = sanitizeHtmlQuotes(slideHtml);
  const baseUrl = getBaseUrl();
  const isFullDoc =
    slideHtml.includes("<!DOCTYPE") || slideHtml.includes("<html");

  // Build the srcdoc for the capture iframe
  let srcdoc: string;
  if (isFullDoc) {
    // Full document: inject <base> and sizing CSS, keep everything else
    srcdoc = slideHtml;
    const inject = `<base href="${baseUrl}/content/"><style>html,body{width:${width}px;height:${height}px;margin:0;padding:0;overflow:hidden;}</style>`;
    if (srcdoc.includes("</head>")) {
      srcdoc = srcdoc.replace("</head>", `${inject}</head>`);
    } else if (/<body/i.test(srcdoc)) {
      srcdoc = srcdoc.replace(/<body/i, `<head>${inject}</head><body`);
    }
  } else {
    // Fragment: wrap in our template
    const bodyContent = stripHtmlWrapper(slideHtml);
    srcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><base href="${baseUrl}/content/"><style>${themeCSS}</style><style>html,body{width:${width}px;height:${height}px;margin:0;padding:0;overflow:hidden;}</style></head><body>${bodyContent}</body></html>`;
  }

  // Render in hidden iframe (full isolation — scripts, external CSS all load)
  const iframe = getOrCreateCaptureIframe(width, height);
  await loadIframe(iframe, srcdoc);

  const iframeDoc = iframe.contentDocument;
  if (!iframeDoc) throw new Error("Cannot access capture iframe document");

  // Use snapdom to capture the iframe body (handles CSS, fonts, images automatically)
  const result = await snapdom(iframeDoc.body, { embedFonts: true });
  const png = await result.toPng();
  return png.src;
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
  files: ViewerPreviewProps["files"],
  themeCSS: string,
  virtualWidth: number,
  virtualHeight: number,
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

    for (const slide of slides) {
      const fileEntry = files.find(
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
  }, [slides, files, themeCSS, virtualWidth, virtualHeight]);

  // Clean up the shared capture iframe on unmount
  useEffect(() => {
    return () => {
      destroyCaptureIframe();
    };
  }, []);

  return thumbnails;
}

/**
 * useSlideThumbnails — captures slide thumbnails as SVG data URLs.
 *
 * Pipeline:
 *   1. Render each slide in a hidden off-screen iframe (full isolation, scripts run)
 *   2. After load, extract all computed CSS from the iframe's styleSheets
 *   3. Clone the rendered body, inline external images as base64
 *   4. Build an SVG foreignObject with the extracted CSS + cleaned body
 *   5. Encode as data:image/svg+xml URL, display as <img>
 *
 * This gives full rendering fidelity (Tailwind CDN, external CSS, etc.)
 * while producing lightweight <img> thumbnails instead of N live iframes.
 */

import { useState, useEffect, useRef, useCallback } from "react";
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

/** Strip full-document wrappers, keeping only body content. Mirrors SlidePreview.tsx. */
function stripHtmlWrapper(html: string): string {
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

/** Convert a Blob to a data URL */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function getBaseUrl(): string {
  return import.meta.env.DEV ? "http://localhost:17007" : "";
}

// ── Capture iframe management ────────────────────────────────────────────────

let captureIframe: HTMLIFrameElement | null = null;

function getOrCreateCaptureIframe(
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
function loadIframe(iframe: HTMLIFrameElement, srcdoc: string): Promise<void> {
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

// ── CSS & DOM extraction ─────────────────────────────────────────────────────

/** Extract all CSS rules from the iframe's loaded stylesheets */
function extractAllCSS(doc: Document): string {
  const parts: string[] = [];
  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) {
        parts.push(rule.cssText);
      }
    } catch {
      // Cross-origin stylesheet — cssRules access throws SecurityError.
      // Try fetching the stylesheet content directly.
      const href = (sheet.ownerNode as HTMLLinkElement)?.href;
      if (href) {
        // We can't await here, so skip. Cross-origin CSS without CORS
        // headers is a known limitation of this capture approach.
      }
    }
  }
  return parts.join("\n");
}

/** Inline all <img src="..."> as base64 data URLs */
async function inlineImages(
  container: Element,
  baseUrl: string,
): Promise<void> {
  const promises: Promise<void>[] = [];
  for (const img of container.querySelectorAll("img[src]")) {
    const src = img.getAttribute("src")!;
    if (src.startsWith("data:")) continue;
    const fullUrl = src.startsWith("http")
      ? src
      : `${baseUrl}/content/${src}`;
    promises.push(
      fetch(fullUrl)
        .then((r) => r.blob())
        .then((b) => blobToDataUrl(b))
        .then((dataUrl) => img.setAttribute("src", dataUrl))
        .catch(() => {}),
    );
  }
  await Promise.all(promises);
}

/** Remove all <script> elements (scripts can't run in SVG img context) */
function removeScripts(el: Element): void {
  for (const script of Array.from(el.querySelectorAll("script"))) {
    script.remove();
  }
}

// ── SVG builder ──────────────────────────────────────────────────────────────

/**
 * Build an SVG data URL from extracted CSS + body DOM.
 * Uses document.implementation.createHTMLDocument for safe XHTML serialization.
 */
function buildSvgDataUrl(
  css: string,
  body: HTMLElement,
  width: number,
  height: number,
): string {
  const doc = document.implementation.createHTMLDocument("");

  // Add extracted CSS (all rules from the rendered iframe)
  const style = doc.createElement("style");
  style.textContent = css;
  doc.head.appendChild(style);

  // Sizing constraints
  const sizeStyle = doc.createElement("style");
  sizeStyle.textContent = `html,body{width:${width}px;height:${height}px;margin:0;padding:0;overflow:hidden;}`;
  doc.head.appendChild(sizeStyle);

  // Import body content
  while (doc.body.firstChild) doc.body.removeChild(doc.body.firstChild);
  for (const node of Array.from(body.childNodes)) {
    doc.body.appendChild(doc.importNode(node, true));
  }
  // Preserve body attributes (class, style, data-*, etc.)
  for (const attr of Array.from(body.attributes)) {
    doc.body.setAttribute(attr.name, attr.value);
  }

  // Serialize documentElement only (NOT the document — avoids <!DOCTYPE> in SVG)
  const xhtml = new XMLSerializer().serializeToString(doc.documentElement);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${xhtml}</foreignObject></svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// ── Core capture function ────────────────────────────────────────────────────

/**
 * Render a slide in a hidden iframe, then capture as SVG data URL.
 *
 * Full-document slides (with <!DOCTYPE>) are rendered as-is — Tailwind CDN,
 * external CSS, custom scripts all execute normally in the iframe.
 * Fragment slides are wrapped in our themeCSS template.
 */
async function captureSlideToSvg(
  slideHtml: string,
  themeCSS: string,
  width: number,
  height: number,
): Promise<string> {
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

  // Extract all CSS from the rendered page (includes Tailwind-generated rules etc.)
  const css = extractAllCSS(iframeDoc);

  // Clone body (preserving class, style, data-* attributes)
  const bodyClone = iframeDoc.body.cloneNode(true) as HTMLElement;
  removeScripts(bodyClone);
  await inlineImages(bodyClone, baseUrl);

  return buildSvgDataUrl(css, bodyClone, width, height);
}

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Manages thumbnail capture and caching for all slides.
 *
 * Returns a Map from slide file path to SVG data URL.
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

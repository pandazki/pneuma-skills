/**
 * captureSlideRegion — captures a specific region of a slide as a PNG data URL.
 *
 * Uses the same capture infrastructure as useSlideThumbnails (hidden iframe,
 * CSS extraction, image inlining) but crops to a specific region via SVG viewBox
 * and rasterizes to PNG via canvas.
 */

import {
  getOrCreateCaptureIframe,
  loadIframe,
  extractAllCSS,
  inlineImages,
  inlineCSSImageUrls,
  removeScripts,
  stripHtmlWrapper,
  sanitizeHtmlQuotes,
  getBaseUrl,
} from "../hooks/useSlideThumbnails.js";

export interface CaptureRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Capture a specific region of a slide as a PNG data URL.
 *
 * @param slideHtml - Raw slide HTML content
 * @param themeCSS - Theme CSS for fragment slides
 * @param virtualW - Full slide width in virtual pixels
 * @param virtualH - Full slide height in virtual pixels
 * @param region - Region to capture in virtual coordinates
 * @returns PNG data URL (data:image/png;base64,...)
 */
export async function captureSlideRegion(
  slideHtml: string,
  themeCSS: string,
  virtualW: number,
  virtualH: number,
  region: CaptureRegion,
): Promise<string> {
  slideHtml = sanitizeHtmlQuotes(slideHtml);
  const baseUrl = getBaseUrl();
  const isFullDoc =
    slideHtml.includes("<!DOCTYPE") || slideHtml.includes("<html");

  // Build srcdoc (same logic as captureSlideToSvg)
  let srcdoc: string;
  if (isFullDoc) {
    srcdoc = slideHtml;
    const inject = `<base href="${baseUrl}/content/"><style>html,body{width:${virtualW}px;height:${virtualH}px;margin:0;padding:0;overflow:hidden;}</style>`;
    if (srcdoc.includes("</head>")) {
      srcdoc = srcdoc.replace("</head>", `${inject}</head>`);
    } else if (/<body/i.test(srcdoc)) {
      srcdoc = srcdoc.replace(/<body/i, `<head>${inject}</head><body`);
    }
  } else {
    const bodyContent = stripHtmlWrapper(slideHtml);
    srcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><base href="${baseUrl}/content/"><style>${themeCSS}</style><style>html,body{width:${virtualW}px;height:${virtualH}px;margin:0;padding:0;overflow:hidden;}</style></head><body>${bodyContent}</body></html>`;
  }

  // Render in hidden iframe
  const iframe = getOrCreateCaptureIframe(virtualW, virtualH);
  await loadIframe(iframe, srcdoc);

  const iframeDoc = iframe.contentDocument;
  if (!iframeDoc) throw new Error("Cannot access capture iframe document");

  // Extract CSS, clone body, inline resources
  const rawCSS = extractAllCSS(iframeDoc);
  const bodyClone = iframeDoc.body.cloneNode(true) as HTMLElement;
  removeScripts(bodyClone);

  const [, css] = await Promise.all([
    inlineImages(bodyClone, baseUrl),
    inlineCSSImageUrls(rawCSS, baseUrl),
  ]);

  // Build SVG with viewBox cropped to the region
  const doc = document.implementation.createHTMLDocument("");
  const style = doc.createElement("style");
  style.textContent = css;
  doc.head.appendChild(style);

  const sizeStyle = doc.createElement("style");
  sizeStyle.textContent = `html,body{width:${virtualW}px;height:${virtualH}px;margin:0;padding:0;overflow:hidden;}`;
  doc.head.appendChild(sizeStyle);

  while (doc.body.firstChild) doc.body.removeChild(doc.body.firstChild);
  for (const node of Array.from(bodyClone.childNodes)) {
    doc.body.appendChild(doc.importNode(node, true));
  }
  for (const attr of Array.from(bodyClone.attributes)) {
    doc.body.setAttribute(attr.name, attr.value);
  }

  const xhtml = new XMLSerializer().serializeToString(doc.documentElement);

  // SVG with viewBox set to region — natural crop
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${region.width}" height="${region.height}" viewBox="${region.x} ${region.y} ${region.width} ${region.height}"><foreignObject width="${virtualW}" height="${virtualH}">${xhtml}</foreignObject></svg>`;

  const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

  // Rasterize SVG → PNG via canvas
  return rasterizeSvgToPng(svgDataUrl, region.width, region.height);
}

/**
 * Rasterize an SVG data URL to a PNG data URL via canvas.
 * Falls back to the SVG data URL as base64 if canvas tainting occurs.
 */
function rasterizeSvgToPng(
  svgDataUrl: string,
  width: number,
  height: number,
): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          // Fallback: encode SVG as base64
          resolve(svgToBase64Fallback(svgDataUrl));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const pngUrl = canvas.toDataURL("image/png");
        resolve(pngUrl);
      } catch {
        // Canvas tainted — fall back to SVG as base64
        resolve(svgToBase64Fallback(svgDataUrl));
      }
    };
    img.onerror = () => {
      resolve(svgToBase64Fallback(svgDataUrl));
    };
    img.src = svgDataUrl;
  });
}

/** Convert an SVG data URL (percent-encoded) to a base64 data URL */
function svgToBase64Fallback(svgDataUrl: string): string {
  // Extract the SVG content from the data URL
  const prefix = "data:image/svg+xml;charset=utf-8,";
  if (svgDataUrl.startsWith(prefix)) {
    const svgContent = decodeURIComponent(svgDataUrl.slice(prefix.length));
    return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgContent)))}`;
  }
  return svgDataUrl;
}

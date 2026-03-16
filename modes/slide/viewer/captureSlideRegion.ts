/**
 * captureSlideRegion — captures a specific region of a slide as a PNG data URL.
 *
 * Uses snapdom to capture the full slide, then crops to the specified region
 * via canvas drawImage with source coordinates.
 */

import snapdom from "@zumer/snapdom";
import {
  getOrCreateCaptureIframe,
  loadIframe,
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
  contentBase = "",
): Promise<string> {
  slideHtml = sanitizeHtmlQuotes(slideHtml);
  const baseUrl = getBaseUrl();
  const baseHref = `${baseUrl}/content/${contentBase}`;
  const isFullDoc =
    slideHtml.includes("<!DOCTYPE") || slideHtml.includes("<html");

  // Build srcdoc (same logic as captureSlideToSvg)
  let srcdoc: string;
  if (isFullDoc) {
    srcdoc = slideHtml;
    const inject = `<base href="${baseHref}"><style>html,body{width:${virtualW}px;height:${virtualH}px;margin:0;padding:0;overflow:hidden;}</style>`;
    if (srcdoc.includes("</head>")) {
      srcdoc = srcdoc.replace("</head>", `${inject}</head>`);
    } else if (/<body/i.test(srcdoc)) {
      srcdoc = srcdoc.replace(/<body/i, `<head>${inject}</head><body`);
    }
  } else {
    const bodyContent = stripHtmlWrapper(slideHtml);
    srcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><base href="${baseHref}"><style>${themeCSS}</style><style>html,body{width:${virtualW}px;height:${virtualH}px;margin:0;padding:0;overflow:hidden;}</style></head><body>${bodyContent}</body></html>`;
  }

  // Render in hidden iframe
  const iframe = getOrCreateCaptureIframe(virtualW, virtualH);
  await loadIframe(iframe, srcdoc);

  const iframeDoc = iframe.contentDocument;
  if (!iframeDoc) throw new Error("Cannot access capture iframe document");

  // Use snapdom to capture the full slide
  const result = await snapdom(iframeDoc.body, { embedFonts: true });
  const fullPng = await result.toPng();

  // Crop to the specified region via canvas
  return cropImage(fullPng, region, virtualW, virtualH);
}

/**
 * Crop an image element to a specific region via canvas.
 */
function cropImage(
  img: HTMLImageElement,
  region: CaptureRegion,
  srcW: number,
  srcH: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const ready = () => {
      const canvas = document.createElement("canvas");
      canvas.width = region.width;
      canvas.height = region.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Cannot get canvas 2d context"));
        return;
      }
      // snapdom may produce an image larger than srcW×srcH (scale factor)
      // Calculate the actual scale from the rendered image
      const scaleX = img.naturalWidth / srcW;
      const scaleY = img.naturalHeight / srcH;
      ctx.drawImage(
        img,
        region.x * scaleX, region.y * scaleY,
        region.width * scaleX, region.height * scaleY,
        0, 0,
        region.width, region.height,
      );
      resolve(canvas.toDataURL("image/png"));
    };

    if (img.complete && img.naturalWidth > 0) {
      ready();
    } else {
      img.onload = ready;
      img.onerror = () => reject(new Error("Failed to load captured image"));
    }
  });
}

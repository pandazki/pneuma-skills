/**
 * Lazy loader for draw.io viewer-static.min.js from CDN.
 * Loads rough.js first (for sketch/hand-drawn mode), then the viewer.
 * Exposes Graph, GraphViewer, mxCodec, mxUtils, mxCell globals on window.
 */

const ROUGH_CDN_URL = "https://cdn.jsdelivr.net/npm/roughjs@4.6.6/bundled/rough.min.js";
const VIEWER_CDN_URL = "https://viewer.diagrams.net/js/viewer-static.min.js";

let loaded = false;
let loading: Promise<void> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

export function loadDrawio(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (loading) return loading;

  loading = (async () => {
    if (typeof GraphViewer !== "undefined") {
      loaded = true;
      return;
    }

    // Load rough.js first so viewer-static can detect it for sketch mode
    if (typeof window.rough === "undefined") {
      await loadScript(ROUGH_CDN_URL);
    }
    await loadScript(VIEWER_CDN_URL);
    loaded = true;
  })();

  return loading;
}

export function isDrawioLoaded(): boolean {
  return loaded;
}

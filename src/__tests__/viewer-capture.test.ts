/**
 * Capture strategy precedence for a FULL viewer capture
 * (`src/utils/viewer-capture.ts::captureViewer`).
 *
 * The order is not cosmetic. Until 2026-09-16 a mode's own `captureViewport`
 * was consulted only when the viewer had no iframe, so a mode that renders
 * into a `<canvas>` inside a same-origin iframe — lucid's Three.js scene —
 * got the snapdom-on-iframe path instead, and snapdom reads a WebGL canvas
 * whose context lacks `preserveDrawingBuffer` as an empty black rectangle.
 * The one path that could produce a real frame was the one never asked.
 *
 * What is pinned here is the seam, not the pixels: who is asked first, that a
 * renderer declining (null / throw) still lands on the old order, and that a
 * REGION capture never consults the renderer at all — a viewport renderer
 * answers for the whole viewport and would silently hand back the wrong crop.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

import { captureViewer } from "../utils/viewer-capture.js";

/** 1×1 transparent PNG, base64, no `data:` prefix. */
const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

let win: Window;
let saved: Record<string, unknown> = {};

/**
 * `pngDimensions` decodes through `new Image()`; happy-dom never loads a
 * resource, so `naturalWidth` would stay 0 and every strategy would be
 * reported as "produced an unreadable image". Decoding is not what this file
 * is about, so the decoder is a stub that always answers 8×8.
 */
class StubImage {
  naturalWidth = 8;
  naturalHeight = 8;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_value: string) {
    queueMicrotask(() => this.onload?.());
  }
}

function install(key: string, value: unknown): void {
  const g = globalThis as unknown as Record<string, unknown>;
  saved[key] = g[key];
  g[key] = value;
}

beforeEach(() => {
  saved = {};
  win = new Window({ url: "http://localhost/" });
  const w = win as unknown as Record<string, unknown>;
  for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node"]) {
    install(key, w[key]);
  }
  install("Image", StubImage);
});

afterEach(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete g[key];
    else g[key] = value;
  }
});

/**
 * A preview element holding a same-origin iframe — the shape webcraft, kami
 * and lucid all mount. The iframe's own window gets a `snapdom` that throws,
 * which is how the snapdom-on-iframe strategy FAILS here without the 5-second
 * script-injection poll `snapdomFor` would otherwise run.
 */
function previewWithIframe(): HTMLElement {
  const doc = win.document as unknown as Document;
  const preview = doc.createElement("div");
  doc.body.appendChild(preview);
  const iframe = doc.createElement("iframe") as HTMLIFrameElement;
  preview.appendChild(iframe);
  const inner = iframe.contentWindow as unknown as Record<string, unknown> | null;
  if (inner) {
    inner.snapdom = () => {
      throw new Error("snapdom unavailable in this test");
    };
  }
  return preview as unknown as HTMLElement;
}

/** Electron's real-window screenshot, the strategy after snapdom-on-iframe. */
function installElectronCapture(): { calls: number } {
  const counter = { calls: 0 };
  (win as unknown as Record<string, unknown>).pneumaDesktop = {
    capturePage: async () => {
      counter.calls += 1;
      return `data:image/png;base64,${PNG_1PX}`;
    },
  };
  return counter;
}

describe("full capture — the mode's own renderer is asked first", () => {
  test("a renderer that answers wins over the same-origin iframe", async () => {
    const preview = previewWithIframe();
    installElectronCapture();
    let calls = 0;
    const result = await captureViewer(preview, {
      captureViewport: async () => {
        calls += 1;
        return { data: PNG_1PX, media_type: "image/png" };
      },
    });

    expect(calls).toBe(1);
    expect(result.ok).toBe(true);
    // The whole point: an iframe is present and it still did not win.
    expect(result.ok && result.method).toBe("viewer-captureViewport");
    expect(result.ok && result.base64).toBe(PNG_1PX);
  });

  test("a renderer that declines falls through to the previous order", async () => {
    const preview = previewWithIframe();
    const electron = installElectronCapture();
    let calls = 0;
    const result = await captureViewer(preview, {
      captureViewport: async () => {
        calls += 1;
        return null;
      },
    });

    expect(calls).toBe(1);
    // snapdom-on-iframe is tried and fails (stubbed to throw), then Electron.
    expect(electron.calls).toBe(1);
    expect(result.ok && result.method).toBe("electron-full");
  });

  test("a renderer that throws is a decline, not a failed capture", async () => {
    const preview = previewWithIframe();
    const electron = installElectronCapture();
    const result = await captureViewer(preview, {
      captureViewport: async () => {
        throw new Error("scene bridge did not answer");
      },
    });

    expect(electron.calls).toBe(1);
    expect(result.ok).toBe(true);
    expect(result.ok && result.method).toBe("electron-full");
  });

  test("no renderer at all behaves exactly as before", async () => {
    const preview = previewWithIframe();
    const electron = installElectronCapture();
    const result = await captureViewer(preview, {});
    expect(electron.calls).toBe(1);
    expect(result.ok && result.method).toBe("electron-full");
  });
});

describe("region capture — the renderer is not consulted", () => {
  test("a selector never reaches captureViewport", async () => {
    const preview = previewWithIframe();
    installElectronCapture();
    let calls = 0;
    const result = await captureViewer(preview, {
      selector: ".no-such-element",
      captureViewport: async () => {
        calls += 1;
        return { data: PNG_1PX, media_type: "image/png" };
      },
    });

    // A viewport renderer cannot honor a selector; answering with the whole
    // viewport would be a plausible screenshot of the wrong thing.
    expect(calls).toBe(0);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain(".no-such-element");
  });
});

/**
 * snapdomFor — resolve the snapdom function that runs in the SAME window as the
 * element being captured.
 *
 * Why this exists: when snapdom rasterizes an element, it resolves computed
 * styles, CSS custom properties, `@font-face` rules, and SVG paint servers
 * (`fill="url(#grad)"`) against the document of the window it runs in. Calling
 * the outer-window snapdom against an element inside a (same-origin) iframe
 * therefore fails to resolve anything defined in the iframe's own document:
 * SVG gradient / `var()` fills collapse to the SVG default (black) and webfonts
 * fall back. This is the bug behind "charts go black in the screenshot/export".
 *
 * The fix (proven by kami's capturePages and the export Screenshot PNG path) is
 * to run snapdom INSIDE the iframe. This helper injects `/vendor/snapdom.js`
 * (served for every mode by the export routes) into the iframe and returns its
 * `snapdom`. For a main-document element — or when injection is impossible
 * (cross-origin, sandbox without allow-scripts, route missing) — it returns the
 * imported outer snapdom, which is already the correct context.
 */
import { snapdom as outerSnapdom } from "@zumer/snapdom";

type SnapdomFn = typeof outerSnapdom;

/** Resolve the snapdom that runs in `el`'s own window. */
export async function snapdomFor(el: Element): Promise<SnapdomFn> {
  try {
    const doc = el.ownerDocument;
    const win = doc?.defaultView as (Window & { snapdom?: SnapdomFn }) | null;
    // Main window (or detached) — the imported snapdom is already correct.
    if (!win || win === window) return outerSnapdom;
    // Element lives in a same-origin iframe. Run snapdom there so it resolves
    // the iframe's CSS vars, @font-face, and SVG paint servers.
    if (win.snapdom) return win.snapdom;
    const script = doc.createElement("script");
    script.src = "/vendor/snapdom.js";
    doc.head.appendChild(script);
    await new Promise<void>((resolve) => {
      let tries = 0;
      const timer = setInterval(() => {
        tries++;
        if (win.snapdom || tries > 50) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
    return win.snapdom ?? outerSnapdom;
  } catch {
    return outerSnapdom;
  }
}

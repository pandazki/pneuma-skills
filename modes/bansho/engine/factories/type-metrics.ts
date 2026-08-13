/**
 * Type metrics (G8-M) — where the WRITING sits inside a line box.
 *
 * A measured row is a LINE box: its height is the line-height and its
 * centre is `(ascent - descent) / 2` above the baseline, an artifact of the
 * font's ascent/descent asymmetry. That centre is not the middle of the
 * writing, and for CJK — whose glyphs fill the em box — the difference is
 * the whole of the highlighter defect this module exists to fix.
 *
 * The one fact that locates writing in both scripts is the alphabetic
 * BASELINE, and the DOM will not hand it over: a `getClientRects()` box and
 * the line box share a centre (half-leading is symmetric), so no
 * combination of rect reads can separate ascent from descent. Canvas font
 * metrics can, and they agree with the DOM to the pixel — measured on the
 * live board, 34px/1.5 in the board's hand stack: predicted baseline 40.00,
 * DOM strut 40.00.
 *
 * Layering: this reads the LAYOUT family only (computed style + font
 * metrics), so it is transform-immune like every other reading behind the
 * G8-J funnel, and it is a pure function of (font, line-height) — no
 * randomness enters ink geometry through this door.
 */

/** One 2D context per document — `measureText` needs no canvas in the tree. */
const contexts = new WeakMap<Document, CanvasRenderingContext2D | null>();
/** `font string + line-height` → baseline offset. Metrics never change. */
const cache = new Map<string, number>();

function contextFor(doc: Document): CanvasRenderingContext2D | null {
  const hit = contexts.get(doc);
  if (hit !== undefined) return hit;
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    const canvas = doc.createElement("canvas") as HTMLCanvasElement;
    ctx = typeof canvas.getContext === "function"
      ? (canvas.getContext("2d") as CanvasRenderingContext2D | null)
      : null;
  } catch {
    // A host without a canvas implementation (happy-dom) is not an error —
    // it is the layout-free case, and ink falls back to the row-box centre.
    ctx = null;
  }
  contexts.set(doc, ctx);
  return ctx;
}

/**
 * The alphabetic baseline of one line, as an offset DOWN from the line
 * box's top — add it to a `RowRect`'s `y0`.
 *
 * `undefined` when the host cannot answer (no canvas, no numeric
 * line-height, a font whose metrics come back empty). That is a legitimate
 * degrade, not a silent failure: every caller keeps the pre-G8-M row-box
 * centre, which is exactly what it drew before.
 */
export function baselineOffset(
  doc: Document,
  sample: Element,
): number | undefined {
  const win = doc.defaultView;
  if (!win) return undefined;
  const cs = win.getComputedStyle(sample);
  const lineHeight = Number.parseFloat(cs.lineHeight);
  if (!Number.isFinite(lineHeight) || lineHeight <= 0) return undefined;
  const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const key = `${font}|${lineHeight}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const ctx = contextFor(doc);
  if (!ctx) return undefined;
  ctx.font = font;
  // The metrics wanted are the FONT's, not this string's ink, so the sample
  // character is irrelevant — but it must be one the font actually has, or
  // a fallback face answers for it.
  const m = ctx.measureText("x");
  const ascent = m.fontBoundingBoxAscent;
  const descent = m.fontBoundingBoxDescent;
  if (
    !Number.isFinite(ascent) ||
    !Number.isFinite(descent) ||
    ascent + descent <= 0
  ) {
    return undefined;
  }
  // Half-leading is distributed evenly above and below the content area
  // (CSS inline layout), so the baseline sits one half-leading plus one
  // ascent below the line box's top.
  const offset = (lineHeight - (ascent + descent)) / 2 + ascent;
  cache.set(key, offset);
  return offset;
}

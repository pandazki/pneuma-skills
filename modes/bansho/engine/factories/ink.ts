/**
 * Ink gestures (T3) — the shared pen vocabulary for in-place marks
 * (`==…==`, `**…**`, `~~…~~`, `((…))` inside prose) and stand-alone back
 * references (`@circle "…"` — the pen turns back to earlier writing).
 *
 * Hard rules carried here:
 *  - G8-B — a cross-line mark splits into one shape PER LINE (a whole-bbox
 *    shape would draw a giant frame across two lines); rows are performed
 *    top-first, strictly one after another within the beat (G1).
 *  - G8-G — ink is sized by FONT SIZE, never by the span's bounding box:
 *    the bbox height is the LINE height (measured 45px), not the glyph
 *    height (~26px); line-height-sized circles overrun neighbouring lines
 *    and consecutive marked lines collide pairwise. Circle vertical radius
 *    `h × 0.60`, with `h = min(row height, fontSize × 1.02)`; the
 *    highlighter carries its own nib (G8-M).
 *  - G8-M — ink is POSITIONED from the BASELINE, never from the row box's
 *    centre. G8-G's own reasoning, one axis over: a row box is a LINE box,
 *    so its centre is `(ascent - descent) / 2` above the baseline — a fact
 *    about the font's metrics, not about the writing. Measured on the board
 *    (34px, line-height 1.5, the hand stack): the box centre sits 14.5px
 *    above the baseline while a CJK glyph's ink centre sits 10.9px above
 *    it, so every mark rode 3.6px high. Latin hid it (x-height ink is half
 *    the band's height, so the band swallowed the error); CJK ink is
 *    1.04em — as tall as the band — so the whole error landed on the glyph
 *    bottoms, and the bottom of every character stood outside the yellow.
 *    Highlight, circle and underline therefore derive their vertical
 *    position from `row.baseline`; `@strike` deliberately does NOT (see
 *    below). A row without a baseline (layout-free host) keeps the old
 *    box-centre geometry rather than guessing.
 *  - G8-I — the highlighter is a filled shape revealed through a clip
 *    window, never a uniform stroke.
 *  - G8-D — every color goes through `element.style` (enforced by `el`).
 *  - G8-F — NO pen-tip cursor following the stroke: rejected by the
 *    product owner ("错位很严重"); the only acceptable future route is
 *    true per-path point-at-length sampling, deliberately not attempted.
 */

import { Ease, type Easing } from "../easing.js";
import { planStepUnits } from "../inference.js";
import {
  highlighterShape,
  jitterEllipse,
  jitterLine,
  mulberry32,
  type Rand,
} from "../sketch/index.js";
import { strokeReveal, type StrokeSegment } from "../strategies/stroke.js";
import { rectWipe, type HighlightWindow } from "../strategies/wipe.js";
import type {
  InkAction,
  Revealable,
  RevealableFactory,
  RowRect,
  SrcSpan,
} from "../types.js";
import {
  contentSeed,
  el,
  inertRevealable,
  overlaySvg,
  type StyledElement,
} from "./svg.js";

/** The pen character per gesture (G9). Underline shares the swipe sweep. */
export function inkEase(action: InkAction): Easing {
  switch (action) {
    case "highlight":
    case "underline":
      return Ease.swipe;
    case "circle":
      return Ease.circle;
    case "strike":
      return Ease.strike;
  }
}

/** Client-rect shape (structural — tests feed plain objects). */
export interface RectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * G8-B — group measured client rects into per-line rows: rects whose tops
 * sit within 6px belong to one line. Rows come back top-first (the pen
 * finishes the first line before starting the second). Zero-size rects
 * (an unlaid-out measure host) are dropped — the caller degrades to an
 * inert unit when nothing remains.
 *
 * `baselineOffset` (G8-M) is the distance from a line box's TOP down to its
 * alphabetic baseline — one number for the whole target, since every row
 * here is one line of the same type. Omit it and the rows come back without
 * a baseline, which is the layout-free host's honest answer.
 */
export function groupRowRects(
  rects: readonly RectLike[],
  baselineOffset?: number,
): RowRect[] {
  const rows: RowRect[] = [];
  for (const r of rects) {
    if (r.right - r.left <= 0 || r.bottom - r.top <= 0) continue;
    let row = rows.find((g) => Math.abs(g.y0 - r.top) < 6);
    if (!row) {
      row = { x0: Infinity, y0: r.top, x1: -Infinity, y1: -Infinity };
      rows.push(row);
    }
    row.x0 = Math.min(row.x0, r.left);
    row.y0 = Math.min(row.y0, r.top);
    row.x1 = Math.max(row.x1, r.right);
    row.y1 = Math.max(row.y1, r.bottom);
  }
  rows.sort((a, b) => a.y0 - b.y0);
  if (baselineOffset !== undefined && Number.isFinite(baselineOffset)) {
    for (const row of rows) row.baseline = row.y0 + baselineOffset;
  }
  return rows;
}

/** One generated ink shape for one row. */
export type InkShape =
  | {
      render: "fill"; // highlighter band (G8-I) — revealed via clip window
      d: string;
      /** Clip window geometry: x/y/height fixed, width opens 0 → span. */
      window: { x: number; y: number; height: number; span: number };
    }
  | {
      render: "stroke";
      d: string;
      /** Geometric length estimate — time apportioning across rows. */
      length: number;
      width: number;
    };

/** Ramanujan's ellipse-perimeter approximation (time apportioning only). */
const ellipsePerimeter = (rx: number, ry: number): number =>
  Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));

/**
 * G8-M — the writing's optical centre, in em above the baseline.
 *
 * Measured ink of full-square CJK glyphs in the board's hand stack: 0.84em
 * above the baseline to 0.20em below it, so the middle of the writing is
 * 0.32em up. Latin sits a little lower (x-height ink centres 0.235em up,
 * ascender-and-descender text 0.216em) and needs no separate number: its
 * ink is at most 0.98em tall against a nib of 1.16em, so the band covers it
 * either way. CJK is the tight case and therefore the one that sets it.
 */
const WRITING_CENTRE = 0.32;

/**
 * G8-M — the highlighter's nib width, in em.
 *
 * Its own constant, NOT the shared `h`: the circle and the underline are
 * calibrated against `h`, and widening it to clear the CJK em box would
 * have swollen the ring on every board. 1.16em over 1.04em of CJK ink is
 * the overshoot a real marker leaves — enough that the seeded lift and
 * tilt cannot expose a glyph, little enough that the band still reads as a
 * stroke rather than a printed block.
 */
const HIGHLIGHT_NIB = 1.16;

/**
 * G8-M — how far below the baseline the underline runs, in em.
 *
 * The old `cy + h × 0.58` put it 0.165em below the baseline, which is
 * INSIDE the CJK em box (0.20em) and 0.11em inside a Latin descender: the
 * pen went through the writing instead of under it. 0.30em clears the
 * ideographic square and grazes the deepest Latin descender, and still
 * sits inside the line's own leading (0.324em to the box's bottom edge).
 */
const UNDERLINE_DROP = 0.3;

/**
 * Pure geometry: rows + font size → per-row ink shapes. Exposed for the
 * automated multi-line zero-collision test (G8-G) — no DOM required.
 */
export function inkRowShapes(
  action: InkAction,
  rows: readonly RowRect[],
  fontSize: number,
  rnd: Rand,
): InkShape[] {
  const shapes: InkShape[] = [];
  for (const { x0, y0, x1, y1, baseline } of rows) {
    const cy = (y0 + y1) / 2;
    // G8-G — the ink height budget comes from the FONT SIZE, clamped by
    // the row so cramped line-heights never overflow either.
    const h = Math.min(y1 - y0, fontSize * 1.02);
    // G8-M — the middle of the WRITING. Falls back to the row box's centre
    // for a host that cannot measure type metrics, which is what every mark
    // used before the baseline existed.
    const wy =
      baseline === undefined ? cy : baseline - fontSize * WRITING_CENTRE;
    switch (action) {
      case "highlight": {
        const nib = Math.min(y1 - y0, fontSize * HIGHLIGHT_NIB);
        shapes.push({
          render: "fill",
          d: highlighterShape(x0 - 6, x1 + 8, wy, nib, rnd),
          window: {
            x: x0 - 14,
            // Centred on the band, not on the row: the band no longer sits
            // in the middle of its row, and a window that clipped it would
            // open the wipe on a band with its top shaved off.
            y: wy - nib * 1.5,
            height: nib * 3,
            span: x1 - x0 + 30,
          },
        });
        break;
      }
      case "circle": {
        // Horizontal overshoot past the circled span scales with the FONT
        // SIZE (same law as every other ink dimension here, G8-G) — a
        // fixed ±14px at a 26px CJK font put the opaque tip on the glyph
        // AFTER the span, where fullwidth punctuation (；，。) keeps its
        // ink: both flagship seeds visibly lost punctuation beside ((…))
        // targets. fs × 0.22 ≈ 5.7px at 26 clears an adjacent fullwidth
        // punctuation glyph while still reading as an enclosing circle.
        const rx = (x1 - x0) / 2 + fontSize * 0.22;
        const ry = h * 0.6;
        shapes.push({
          render: "stroke",
          // G8-M — around the writing, not around the line box: on the box
          // centre the ring cleared the CJK em box by 6.7px at the top and
          // 0.5px at the bottom, which reads as a ring that clips the feet
          // of what it circles.
          d: jitterEllipse((x0 + x1) / 2, wy, rx, ry, rnd, 2.0),
          length: ellipsePerimeter(rx, ry),
          width: 2,
        });
        break;
      }
      case "strike":
        // G8-M, the one deliberate exception: `@strike` stays on the row
        // box's mid-line. Measured there at 0.107em ABOVE the CJK ink
        // centre — a strike sits a touch high by convention, and the
        // product owner's ruling on the measurement was to leave it. It is
        // the only mark that still reads the box, and it is meant to be.
        shapes.push({
          render: "stroke",
          d: jitterLine(x0 - 3, cy + 1, x1 + 3, cy - 2, rnd, 1.4),
          length: Math.hypot(x1 - x0 + 6, 3),
          width: 2.4,
        });
        break;
      case "underline": {
        // G8-M — under the writing. Without a baseline this is the old
        // `cy + h × 0.58`, which is the same place to within a pixel on a
        // 1.5 line-height and the only thing a layout-free host can say.
        const yu =
          baseline === undefined
            ? cy + h * 0.58
            : baseline + fontSize * UNDERLINE_DROP;
        shapes.push({
          render: "stroke",
          d: jitterLine(x0 - 2, yu, x1 + 2, yu + 1, rnd, 1.2),
          length: Math.hypot(x1 - x0 + 4, 1),
          width: 2.2,
        });
        break;
      }
    }
  }
  return shapes;
}

/**
 * Unique clipPath ids (per JS realm — uniqueness only, not identity).
 *
 * The one part of the emitted DOM that is NOT byte-stable across rebuilds:
 * determinism (contentSeed) covers GEOMETRY — every path `d`, every window
 * rect — while these ids only need to never collide. Deriving them from
 * the content seed was considered and REJECTED: two identical-content
 * steps deliberately share a seed (see `contentSeed`), `url(#id)` resolves
 * document-wide to the FIRST matching clipPath, so seed-derived ids would
 * clip the second twin's band through the first twin's window — its
 * highlight would open on the wrong beat, an R1 fail-open. A monotone
 * counter keeps uniqueness unconditional; ids are referenced only through
 * the paired `clip-path` attribute, never by content.
 */
let clipSeq = 0;

export interface PaintInkOptions {
  doc: Document;
  /** Filled highlighter bands land here (visually under the text). */
  fillLayer: Element;
  /** Stroked gestures (circle/strike/underline) land here (over the text). */
  strokeLayer: Element;
  /** `<defs>` container for highlight clip windows. */
  defs: Element;
  action: InkAction;
  rows: readonly RowRect[];
  fontSize: number;
  rnd: Rand;
  duration: number;
  srcSpan: SrcSpan;
}

/**
 * Materialize one ink beat: generate row shapes, mount them, and return
 * the Revealable that performs them strictly in row order. Empty rows
 * (no measurable target) degrade to an inert unit — parity over throwing.
 */
export function paintInk(opts: PaintInkOptions): Revealable {
  const { doc, action, fontSize, rnd, duration, srcSpan } = opts;
  const shapes = inkRowShapes(action, opts.rows, fontSize, rnd);
  if (shapes.length === 0) {
    return inertRevealable({
      kind: "ink",
      action,
      srcSpan,
      duration,
      gapBefore: 0,
      gapAfter: 0,
    });
  }

  if (action === "highlight") {
    const windows: HighlightWindow[] = [];
    for (const shape of shapes) {
      if (shape.render !== "fill") continue;
      const path = el(doc, "path", { d: shape.d }, {
        fill: "var(--hl, #FFE072)",
        opacity: "var(--hl-a, 0.62)",
      });
      const id = `bansho-hl-${++clipSeq}`;
      const rect = el(doc, "rect", {
        x: shape.window.x,
        y: shape.window.y,
        width: 0,
        height: shape.window.height,
      });
      const clip = el(doc, "clipPath", { id, clipPathUnits: "userSpaceOnUse" });
      clip.appendChild(rect);
      opts.defs.appendChild(clip);
      path.setAttribute("clip-path", `url(#${id})`);
      opts.fillLayer.appendChild(path);
      windows.push({ rect, span: shape.window.span });
    }
    return rectWipe(windows, { duration, srcSpan, ease: inkEase(action) });
  }

  const segments: StrokeSegment[] = [];
  for (const shape of shapes) {
    if (shape.render !== "stroke") continue;
    const path = el(doc, "path", { d: shape.d }, {
      fill: "none",
      stroke: "var(--board-fg, currentColor)",
      strokeWidth: `${shape.width}px`,
      strokeLinecap: "round",
    });
    opts.strokeLayer.appendChild(path);
    segments.push({ path: path as StyledElement, length: shape.length });
  }
  return strokeReveal(segments, { duration, srcSpan, ease: inkEase(action) });
}

/**
 * `@strike "…"` / `@circle` / `@highlight` / `@underline` — the pen turns
 * back to earlier writing (I6). The HOST resolves the target's geometry
 * through `MeasureContext.backRef` (it owns the offset→DOM mapping, per
 * `stepPlainText` vocabulary); the factory turns that geometry into the
 * gesture node + its single reveal beat. Seam absent / target unmeasured
 * → inert unit, schedule parity kept.
 *
 * MOUNT CONTRACT (fill-under-text — the same layering `buildTextStep`
 * gives in-place marks): the returned node holds TWO full-bleed overlays,
 * `.bansho-backref-under` (z-index 0 — highlighter bands + their clip
 * defs) and `.bansho-backref-over` (z-index 2 — circles/strikes/
 * underlines). For the under band to actually land BENEATH the target
 * glyphs, the host must mount this node in the SAME stacking context as
 * the step nodes (the board root), with the convention under = 0,
 * step text = 1 (`.bansho-text` already sets it), over = 2 — and step
 * nodes must NOT mint stacking contexts of their own (no z-index /
 * transform / opacity / filter on `.bansho-step`; `position: relative`
 * alone is fine). Otherwise a `@highlight` band tints the glyphs at
 * `--hl-a` opacity instead of glowing under them.
 *
 * AMENDED (W3, 2026-08-12): on a STAGED board the V1 re-parenting already
 * moved this node INSIDE its target's box, so under (0), text (1) and
 * over (2) all resolve in one context whether or not that box mints its
 * own — which is why the 瑕疵 layer is allowed to put a transform on a
 * placed box, and why it is scoped to `[data-bansho-box="1"]` so it can
 * never reach the unboxed fallback (notes projection, orphaned step),
 * where this node is still a panel-level SIBLING and the rule above
 * applies verbatim.
 */
export const backRefFactory: RevealableFactory = {
  kind: "backref",
  build(step, ctx) {
    const doc = ctx.document;
    const node = doc.createElement("div") as StyledElement;
    node.className = "bansho-backref";
    node.style.position = "absolute";
    node.style.left = "0";
    node.style.top = "0";
    node.style.width = "100%";
    node.style.height = "100%";
    node.style.pointerEvents = "none";
    const under = overlaySvg(doc, 0); // filled bands, beneath the writing
    under.classList.add("bansho-backref-under");
    const over = overlaySvg(doc, 2); // circles / strikes / underlines, above
    over.classList.add("bansho-backref-over");
    const defs = el(doc, "defs");
    under.appendChild(defs);
    node.appendChild(under);
    node.appendChild(over);

    const units = planStepUnits(step, ctx.durations);
    if (step.kind !== "backref") {
      return { node, revealables: units.map(inertRevealable) };
    }
    const measure = ctx.backRef?.(step.target);
    const revealables = units.map((unit) => {
      if (!measure || measure.rows.length === 0) return inertRevealable(unit);
      return paintInk({
        doc,
        fillLayer: under,
        strokeLayer: over,
        defs,
        action: step.action,
        rows: measure.rows,
        fontSize: measure.fontSize,
        rnd: mulberry32(contentSeed(step)),
        duration: unit.duration,
        srcSpan: unit.srcSpan,
      });
    });
    return { node, revealables };
  },
};

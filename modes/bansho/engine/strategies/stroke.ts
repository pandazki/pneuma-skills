/**
 * Stroke strategy (T3) — the pen draws along a path: dashoffset reveal.
 *
 * Layering (G2): engine core — imports only sibling engine modules.
 *
 * Deliberate prototype divergence: the prototype measured every path with
 * `getTotalLength()` and drove `dashoffset = L × (1-e)`. Here every path is
 * normalized with `pathLength="1"` instead, so dash coordinates run 0..1
 * regardless of geometry — byte-identical visuals, but no layout engine is
 * needed to build (deterministic in any DOM host, directly testable in
 * Bun) and re-jitter never desynchronizes a cached length. Relative pen
 * SPEED across multi-segment beats still uses real geometric lengths,
 * supplied by the caller (`StrokeSegment.length`).
 *
 * Built state is UNREVEALED (dashoffset 1): a freshly appended unit stays
 * invisible until the playhead reaches it (§7 R1 — no premature writes).
 * At e = 0 the path is additionally `visibility: hidden`: with round line
 * caps a fully offset dash still paints a zero-length CAP DOT exactly at
 * the path boundary (observed in the T3 visual pass — stray dots scattered
 * where future strokes sit), and the visibility guard is the deterministic
 * way to keep the ink truly off the board until the pen arrives.
 */

import type { Easing } from "../easing.js";
import type { Revealable, SrcSpan } from "../types.js";
import { seekSequence, type PenSegment } from "./sequence.js";

/** Any DOM element carrying an inline style — HTML or SVG. */
export type StyledElement = Element & { style: CSSStyleDeclaration };

/** One path of the beat + its geometric length (for time apportioning). */
export interface StrokeSegment {
  path: StyledElement;
  /** Approximate drawn length; only ratios between segments matter. */
  length: number;
}

export interface StrokeOptions {
  /** Content-derived seconds (I8) — factories never apply the G3 override. */
  duration: number;
  /** G6 — the precise source range this unit performs. */
  srcSpan: SrcSpan;
  /** The pen's character (G9); must be strictly monotone (G8-H). */
  ease: Easing;
}

/**
 * Build a stroke Revealable over one or more paths. Segments are performed
 * strictly in the given order (G8-B: rows top-first), each taking a slice
 * of the beat proportional to its length.
 */
export function strokeReveal(
  segments: readonly StrokeSegment[],
  opts: StrokeOptions,
): Revealable {
  const pen: PenSegment[] = segments.map(({ path, length }) => {
    path.setAttribute("pathLength", "1");
    path.style.strokeDasharray = "1";
    path.style.strokeDashoffset = "1";
    path.style.visibility = "hidden";
    return {
      length,
      apply: (e: number) => {
        path.style.strokeDashoffset = String(1 - e);
        path.style.visibility = e > 0 ? "visible" : "hidden";
      },
    };
  });
  const { duration, srcSpan, ease } = opts;
  return {
    naturalDuration: duration,
    kind: "stroke",
    srcSpan,
    seek(p: number): void {
      seekSequence(pen, ease, p);
    },
  };
}

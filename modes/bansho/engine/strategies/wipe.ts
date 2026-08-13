/**
 * Wipe strategy (T3) — a clip window opens across the content.
 *
 * Layering (G2): engine core — imports only sibling engine modules.
 *
 * Two mechanics, both prototype-validated:
 *  - `clipWipe` — CSS `clip-path: inset(…)` on the element itself. "ltr"
 *    reveals left→right (writing text, formulas — the handwriting order);
 *    "rtl" reveals right→left (the chart series label sweeping back from
 *    where the pen landed at the line's end).
 *  - `rectWipe` — an SVG `<clipPath>` rect whose width grows: the window
 *    the highlighter opens as it sweeps (G8-I — the shape underneath is a
 *    filled band, never a uniform stroke). Width is geometry, not color,
 *    so `setAttribute` is correct here; token COLORS must go through
 *    `element.style` (G8-D).
 *
 * Built state is UNREVEALED (fully clipped): §7 R1 — a freshly appended
 * unit stays invisible until the playhead reaches it.
 */

import type { Easing } from "../easing.js";
import type { Revealable, SrcSpan } from "../types.js";
import { seekSequence, type PenSegment } from "./sequence.js";
import type { StyledElement } from "./stroke.js";

export interface ClipWipeOptions {
  duration: number;
  srcSpan: SrcSpan;
  ease: Easing;
  /** Reveal direction — "ltr" (default; writing) or "rtl" (label sweep). */
  side?: "ltr" | "rtl";
  /**
   * Optional opacity ramp factor: opacity = min(1, p × ramp) from RAW
   * progress (prototype: labels fade in at 2.4× while the clip sweeps).
   */
  opacityRamp?: number;
}

/** Reveal one element through a CSS clip-path inset window. */
export function clipWipe(el: StyledElement, opts: ClipWipeOptions): Revealable {
  const { duration, srcSpan, ease, side = "ltr", opacityRamp } = opts;
  const apply = (p: number): void => {
    const hidden = ((1 - ease(p)) * 100).toFixed(2);
    el.style.clipPath =
      side === "ltr" ? `inset(0 ${hidden}% 0 0)` : `inset(0 0 0 ${hidden}%)`;
    if (opacityRamp !== undefined) {
      el.style.opacity = String(Math.min(1, p * opacityRamp));
    }
  };
  apply(0);
  return {
    naturalDuration: duration,
    kind: "wipe",
    srcSpan,
    seek: apply,
  };
}

/** One highlighter row: its clip rect + the horizontal span to open. */
export interface HighlightWindow {
  rect: Element;
  /** Full window width (px) when the sweep completes. */
  span: number;
}

export interface RectWipeOptions {
  duration: number;
  srcSpan: SrcSpan;
  ease: Easing;
}

/**
 * Reveal filled highlighter rows by opening their clip windows left→right,
 * one row after another (G8-B: the pen finishes the first line before
 * starting the second), time apportioned by row width.
 */
export function rectWipe(
  windows: readonly HighlightWindow[],
  opts: RectWipeOptions,
): Revealable {
  const pen: PenSegment[] = windows.map(({ rect, span }) => {
    rect.setAttribute("width", "0");
    return {
      length: span,
      apply: (e: number) => {
        rect.setAttribute("width", (span * e).toFixed(2));
      },
    };
  });
  const { duration, srcSpan, ease } = opts;
  return {
    naturalDuration: duration,
    kind: "wipe",
    srcSpan,
    seek(p: number): void {
      seekSequence(pen, ease, p);
    },
  };
}

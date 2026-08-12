/**
 * Fade strategy (T3) — opacity reveal for units that pop rather than draw:
 * chart ticks, axis labels, images, html blocks.
 *
 * Layering (G2): engine core — imports only sibling engine modules.
 *
 * The default easing is identity (the prototype faded ticks linearly);
 * linear opacity is strictly monotone, so G8-H holds. Built state is
 * UNREVEALED (opacity 0) per §7 R1.
 */

import type { Easing } from "../easing.js";
import type { Revealable, SrcSpan } from "../types.js";
import type { StyledElement } from "./stroke.js";

export interface FadeOptions {
  duration: number;
  srcSpan: SrcSpan;
  /** Defaults to identity — prototype tick fades are linear. */
  ease?: Easing;
}

const identity: Easing = (p) => p;

/** Reveal an element by ramping its opacity. */
export function fadeReveal(el: StyledElement, opts: FadeOptions): Revealable {
  const { duration, srcSpan, ease = identity } = opts;
  const apply = (p: number): void => {
    el.style.opacity = String(ease(p));
  };
  apply(0);
  return {
    naturalDuration: duration,
    kind: "fade",
    srcSpan,
    seek: apply,
  };
}

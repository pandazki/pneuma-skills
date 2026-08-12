/**
 * Rule factory (T3) — `---`: a hand-drawn horizontal line, a breath in the
 * lecture. The same hand-drawn-line helper serves heading baselines and
 * asides' margin bars (prose factory) so every straight pen line on the
 * board — across or down — shares ONE gesture. A CSS border would be the
 * only mechanically straight line on a hand-drawn board.
 */

import { Ease } from "../easing.js";
import { planStepUnits } from "../inference.js";
import { jitterLine, mulberry32, type Rand } from "../sketch/index.js";
import { strokeReveal } from "../strategies/stroke.js";
import type { Revealable, RevealableFactory, SrcSpan } from "../types.js";
import { contentSeed, el, inertRevealable, type StyledElement } from "./svg.js";

/** Fallback drawing width when the measure host has no layout (tests). */
const FALLBACK_WIDTH = 720;

/** Which way the pen travels: across (`---`, baselines) or down (asides). */
export type HandLineAxis = "horizontal" | "vertical";

export interface HandLineOptions {
  duration: number;
  srcSpan: SrcSpan;
  strokeWidth?: number;
  /** Default `"horizontal"` — the gesture this helper was born for. */
  axis?: HandLineAxis;
}

/**
 * Draw one hand-drawn straight line into `svg` and return its reveal beat
 * (steady pen — the skeleton gesture: hesitate, then pull through).
 *
 * The line runs `length` px along `opts.axis` at `cross` px on the other
 * one: (width, y) for a horizontal pull, (height, x) for a vertical one.
 * Both ends are inset 2px and the span is floored at 6px, so a line asked
 * for in a layout-free host degrades to a visible stub rather than to a
 * zero-length dot.
 */
export function drawHandLine(
  doc: Document,
  svg: Element,
  length: number,
  cross: number,
  rnd: Rand,
  opts: HandLineOptions,
): Revealable {
  const from = 2;
  const to = Math.max(length - 2, 6);
  const d =
    opts.axis === "vertical"
      ? jitterLine(cross, from, cross, to, rnd, 1.6)
      : jitterLine(from, cross, to, cross, rnd, 1.6);
  const path = el(
    doc,
    "path",
    { d },
    {
      fill: "none",
      stroke: "var(--board-fg, currentColor)",
      strokeWidth: `${opts.strokeWidth ?? 2.2}px`,
      strokeLinecap: "round",
    },
  );
  svg.appendChild(path);
  return strokeReveal([{ path: path as StyledElement, length }], {
    duration: opts.duration,
    srcSpan: opts.srcSpan,
    ease: Ease.steady,
  });
}

const RULE_HEIGHT = 14;

export const ruleFactory: RevealableFactory = {
  kind: "rule",
  build(step, ctx) {
    const doc = ctx.document;
    const width = ctx.measureHost.clientWidth || FALLBACK_WIDTH;
    const node = doc.createElement("div");
    node.className = "bansho-rule";
    const svg = el(doc, "svg", {
      viewBox: `0 0 ${width} ${RULE_HEIGHT}`,
      height: RULE_HEIGHT,
    });
    svg.style.display = "block";
    svg.style.width = "100%";
    svg.style.overflow = "visible";
    node.appendChild(svg);
    // Kind guard, like every sibling factory: a mis-registered kind must
    // degrade to inert beats, not draw N hand lines.
    const units = planStepUnits(step, ctx.durations);
    if (step.kind !== "rule") {
      return { node, revealables: units.map(inertRevealable) };
    }
    const rnd = mulberry32(contentSeed(step));
    const revealables = units.map((unit) =>
      drawHandLine(doc, svg, width, RULE_HEIGHT / 2, rnd, {
        duration: unit.duration,
        srcSpan: unit.srcSpan,
      }),
    );
    return { node, revealables };
  },
};

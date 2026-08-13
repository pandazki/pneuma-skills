/**
 * Shared render-layer DOM helpers for the bansho factories (T3).
 *
 * Layering: factories are the RENDER layer — they may touch the DOM, but
 * the only external package import in the whole layer is `katex` inside
 * `factories/math.ts` (G2 / D5 boundary).
 */

import type { UnitPlan } from "../inference.js";
import { stepPlainText } from "../text.js";
import type { Revealable, Step } from "../types.js";

export const SVG_NS = "http://www.w3.org/2000/svg";

/** Any DOM element carrying an inline style — HTML or SVG. */
export type StyledElement = Element & { style: CSSStyleDeclaration };

/**
 * G8-D — SVG presentation attributes do NOT resolve `var()` (they fail
 * SILENTLY — the color is simply dropped), and stylesheet rules outrank
 * presentation attributes anyway. Every token color therefore goes through
 * `element.style`. This helper makes the rule structural: passing a color
 * as an attribute throws at build time instead of losing the color at
 * render time.
 */
const COLOR_ATTRS = new Set(["fill", "stroke", "color", "stop-color", "opacity"]);

/** Create an SVG element; attrs for geometry, style for colors (G8-D). */
export function el(
  doc: Document,
  name: string,
  attrs?: Record<string, string | number>,
  style?: Partial<Record<keyof CSSStyleDeclaration & string, string>>,
): StyledElement {
  const node = doc.createElementNS(SVG_NS, name) as StyledElement;
  if (attrs) {
    for (const key of Object.keys(attrs)) {
      if (COLOR_ATTRS.has(key)) {
        throw new Error(
          `[bansho] G8-D: "${key}" must be set via element.style, not as an ` +
            `SVG presentation attribute (var() silently fails there)`,
        );
      }
      node.setAttribute(key, String(attrs[key]));
    }
  }
  if (style) {
    for (const key of Object.keys(style) as Array<keyof CSSStyleDeclaration & string>) {
      const value = style[key];
      if (value !== undefined) {
        (node.style as unknown as Record<string, string>)[key] = value;
      }
    }
  }
  return node;
}

/** A full-bleed, non-interactive SVG overlay layer for ink gestures. */
export function overlaySvg(doc: Document, zIndex: number): StyledElement {
  const svg = el(doc, "svg");
  svg.style.position = "absolute";
  svg.style.left = "0";
  svg.style.top = "0";
  svg.style.width = "100%";
  svg.style.height = "100%";
  svg.style.overflow = "visible";
  svg.style.pointerEvents = "none";
  svg.style.zIndex = String(zIndex);
  return svg;
}

/** FNV-1a 32-bit over a string — deterministic, dependency-free. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * The jitter seed for a step — derived from CONTENT, never from position.
 * A streaming re-parse mints fresh Step objects at possibly shifted
 * offsets (§7 R1/R4); identical content must re-render with byte-identical
 * jitter or already-written lines visibly wobble on every append. The
 * deliberate flip side: two steps with identical content share a seed and
 * draw identical wobble — accepted (§4.5 identity is content + order, and
 * jitter is sub-perceptual at that granularity).
 *
 * Scope: this determinism covers GEOMETRY (path `d`, window rects) — the
 * pixels the board draws. It does NOT extend to highlight clip-path IDS,
 * which come from a monotone counter precisely BECAUSE seeds are shared
 * by identical-content twins (see `clipSeq` in ink.ts for why seed-derived
 * ids would fail open).
 */
export function contentSeed(step: Step): number {
  let body: string;
  switch (step.kind) {
    case "heading":
    case "prose":
    case "list-item":
    case "aside":
      body = stepPlainText(step);
      break;
    case "chart-frame":
    case "chart-layer": {
      const rows = step.rows
        .map((r) =>
          r.kind === "series"
            ? `s:${r.name}:${r.values.join(",")}`
            : r.kind === "mark"
              ? `m:${r.series}:${r.x}:${r.text}`
              : `n:${r.x}:${r.y}:${r.text}`,
        )
        .join("|");
      body = `${step.chart}|${rows}`;
      break;
    }
    case "graph-frame":
    case "graph-layer": {
      // This block's OWN contribution — never the container's union: the
      // union grows as later blocks land, and a seed that moved with it
      // would re-jitter ink that is already on the board (§7 R1).
      const nodes = step.nodes.map((n) => n.name).join(",");
      const edges = step.edges.map((e) => `${e.from}>${e.to}`).join(",");
      body = `${step.graph}|${nodes}|${edges}`;
      break;
    }
    case "math":
      body = step.tex;
      break;
    case "backref":
      body = `${step.action}:${step.targetText}`;
      break;
    case "image":
      body = `${step.src}:${step.alt}`;
      break;
    case "html":
      body = step.html;
      break;
    case "rule":
      // DECISION, not fall-through: a `---` has no content of its own, so
      // every rule on a board shares fnv1a("rule\0") and, at equal width,
      // draws a byte-identical squiggle. Accepted — rules are a breath, not
      // a signature; folding position in would break the R4′ same-content
      // rebuild identity that contentSeed exists to provide.
      body = "";
      break;
    default:
      body = "";
  }
  return fnv1a(`${step.kind}\x00${body}`);
}

/**
 * A unit that keeps schedule parity but paints nothing — the defensive
 * degradation for a target the factory could not resolve (host bookkeeping
 * gap, unresolvable geometry). Never a throw: the blast radius of a
 * mistake is one unit, not the board.
 *
 * `degraded: true` is the honest signal (see `Revealable.degraded`);
 * `kind` here is a placeholder, NOT the planned reveal kind — mapping
 * UnitKind → RevealKind belongs to each factory's §5.2 negotiation, and
 * duplicating that table here would be a second source of truth to drift.
 */
export function inertRevealable(unit: UnitPlan): Revealable {
  return {
    naturalDuration: unit.duration,
    kind: "fade",
    degraded: true,
    srcSpan: unit.srcSpan,
    seek: () => {},
  };
}

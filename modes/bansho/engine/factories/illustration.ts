/**
 * Illustration factory (T3, I1) — `![alt](src)`: a drawn figure the lecture
 * names, put on the board with the same hand as everything else.
 *
 * THE PICTURE IS A MATTE, NOT A PICTURE. Chalk is bright and slate is dark,
 * so the file's own luminance IS the mask: the board paints its OWN ink
 * color through it (`background-color: var(--board-fg)` + a luminance mask).
 * One asset therefore serves both themes — chalk on slate in the dark
 * theme, ink on plaster in the light one — and nothing is regenerated when
 * the theme flips. Measured in a browser on 2026-08-13.
 *
 * Two consequences that are easy to lose:
 *  - the URL must be SAME-ORIGIN. A mask reads pixels, so the browser
 *    refuses a cross-origin source — with NO output and every diagnostic
 *    reporting success (`.claude/rules/frontend.md`). The host owes a
 *    root-relative URL; this factory never builds one.
 *  - the box is sized from the DECLARED aspect, never from the file. The
 *    fold charges this box before the picture has loaded, and the same
 *    lecture must fold identically at every window size (R8).
 *
 * Reveal: a window opening across the figure — the MIDDLE rung of the
 * `stroke → wipe → fade` ladder. A picture cannot be drawn along a path,
 * so it does not get the top rung; it is still a pure function of progress
 * like every other unit on this board. (Following the drawn lines
 * themselves is the right long-term shape and an unrun experiment; it is
 * not this change.)
 */

import { imageDuration } from "../duration.js";
import { Ease } from "../easing.js";
import { planStepUnits } from "../inference.js";
import { clipWipe } from "../strategies/wipe.js";
import type {
  ImageStep,
  MeasureContext,
  Revealable,
  RevealableFactory,
} from "../types.js";
import { inertRevealable, type StyledElement } from "./svg.js";

/**
 * The badge a picture that cannot be drawn stands as — the `bad-step badge`
 * convention (`.bansho-bad-badge`), one class over. A figure that failed is
 * the most visible hole a board can have, so it says so ON the board;
 * `check-board` says the same thing in words at the same moment.
 */
function badgeNode(doc: Document, step: ImageStep): HTMLElement {
  const node = doc.createElement("div");
  node.className = "bansho-bad-badge bansho-illustration-missing";
  node.title = `picture not drawn: ${step.src}`;
  node.innerHTML =
    `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6">` +
    `<rect x="1.6" y="3" width="12.8" height="10" rx="1.4"/>` +
    `<path d="m3 11 3.4-3.6L9 10l2-2 2 2.4"/><path d="M2 2.2 14 13.8"/></svg>`;
  const label = doc.createElement("span");
  // The path, verbatim: it is what the agent has to act on, and it is the
  // one thing the alt text cannot tell them.
  label.textContent = `picture not on the board — ${step.src}`;
  node.appendChild(label);
  return node;
}

/**
 * Escape what could end a `url("…")` early. A picture path comes from the
 * lecture, so it is author input reaching a style value: quoted and
 * escaped, never interpolated raw.
 */
function cssUrl(url: string): string {
  return url.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * The mask, in both spellings. The unprefixed properties are the standard
 * and what current Chromium reads; the `-webkit-` set is what older Blink
 * and WebKit read, and it carries its OWN luminance switch
 * (`-webkit-mask-source-type`) — without that switch a prefixed engine
 * would fall back to ALPHA masking, and a fully opaque picture in alpha
 * mode paints a solid rectangle over the board. Both switches ship
 * together, always.
 */
function applyMask(ink: StyledElement, url: string): void {
  const image = `url("${cssUrl(url)}")`;
  for (const [property, value] of [
    ["mask-image", image],
    ["mask-mode", "luminance"],
    ["mask-size", "contain"],
    ["mask-repeat", "no-repeat"],
    ["mask-position", "center"],
    ["-webkit-mask-image", image],
    ["-webkit-mask-source-type", "luminance"],
    ["-webkit-mask-size", "contain"],
    ["-webkit-mask-repeat", "no-repeat"],
    ["-webkit-mask-position", "center"],
  ] as const) {
    ink.style.setProperty(property, value);
  }
}

export const illustrationFactory: RevealableFactory = {
  kind: "image",
  build(step, ctx: MeasureContext) {
    const doc = ctx.document;
    const units = planStepUnits(step, ctx.durations);
    // Kind guard, like every sibling factory: a mis-registered kind must
    // degrade to inert beats, not paint someone else's step.
    if (step.kind !== "image") {
      return {
        node: doc.createElement("div"),
        revealables: units.map(inertRevealable),
      };
    }

    const spec = ctx.illustration?.(step);
    if (!spec) {
      // Honest and visible: the badge stands in the flow, takes the step's
      // place, and draws nothing it cannot draw. Schedule parity is kept —
      // the unit is inert, so the lecture around it is untouched.
      return {
        node: badgeNode(doc, step),
        revealables: units.map(inertRevealable),
      };
    }

    const node = doc.createElement("figure");
    node.className = "bansho-illustration";
    // The box: the full width of the space it stands in, height from the
    // DECLARED aspect. `aspect-ratio` gives the fold a real height before a
    // single byte of the file has arrived, which is exactly the point.
    node.style.aspectRatio = String(spec.aspect);
    if (step.alt) {
      node.setAttribute("role", "img");
      node.setAttribute("aria-label", step.alt);
    }

    // The ink layer carries ONLY the picture. What is painted through it is
    // the board's own `--board-fg`, and that lives in the stylesheet
    // (`.bansho-illustration-ink`, board-css.ts) — a color, not geometry,
    // so it belongs with the board's other colors and stays one edit away
    // from every figure on every board.
    const ink = doc.createElement("div") as HTMLElement & StyledElement;
    ink.className = "bansho-illustration-ink";
    applyMask(ink, spec.url);
    node.appendChild(ink);

    const revealables: Revealable[] = units.map((unit, i) =>
      i === 0
        ? clipWipe(ink, {
            // The figure's OWN time, from its declared aspect. The plan
            // carried the square reference (see `IMAGE_GLUE`); a built
            // unit's value wins per unit in `engine/timeline.ts`.
            duration: imageDuration(spec.aspect),
            srcSpan: unit.srcSpan,
            // `steady` is the skeleton hand — hesitate, then pull through:
            // the same pen a chart's axes are drawn with.
            ease: Ease.steady,
          })
        : inertRevealable(unit),
    );
    return { node, revealables };
  },
};

/**
 * Text-bearing step factories (T3): prose / aside / heading / list-item.
 *
 * The DOM walk MIRRORS `planInline` (inference.ts) structurally — same
 * `splitRevealSegments`, same recursion into ink children — but the
 * revealables are built FROM the canonical plan (`planStepUnits`), looked
 * up by (kind, srcSpan) key, because plan order ≠ DOM order: deferred ink
 * marks (I2) queue to their sentence's end while their text sits earlier
 * in the line. `StepSchedule.unit` indexes both arrays, so the plan is the
 * only ordering truth (T2↔T3 seam).
 *
 * Measurement: the node is mounted into `ctx.measureHost` (hidden,
 * style-complete) just long enough to read line boxes for ink geometry
 * (G8-B row split, G8-G font-size basis) and the container width for the
 * heading baseline, then detached — the host owns real mounting.
 */

import { isClosingPunctuation, isOpeningPunctuation } from "../duration.js";
import { Ease } from "../easing.js";
import {
  planStepUnits,
  splitRevealSegments,
  type UnitPlan,
} from "../inference.js";
import { mulberry32, jitterEllipse } from "../sketch/index.js";
import { clipWipe } from "../strategies/wipe.js";
import { strokeReveal } from "../strategies/stroke.js";
import type {
  InkAction,
  InlineRun,
  MeasureContext,
  Revealable,
  RevealableFactory,
  Step,
} from "../types.js";
import { substituteHandGlyphs } from "./hand-glyphs.js";
import { groupRowRects, paintInk, type RectLike } from "./ink.js";
import { buildMathNode } from "./math.js";
import { drawHandLine } from "./rule.js";
import { baselineOffset } from "./type-metrics.js";
import {
  contentSeed,
  el,
  inertRevealable,
  overlaySvg,
  type StyledElement,
} from "./svg.js";

/** Fallbacks for layout-free hosts (Bun tests) — never hit in a browser. */
const FALLBACK_WIDTH = 720;
const FALLBACK_FONT_SIZE = 24;

/**
 * §4.3 旁注 — the aside's margin bar, in overlay space (px from the step's
 * padding-box left edge). The stylesheet's `.bansho-aside` padding-left
 * reserves the gutter it lives in; these two numbers are one decision, so
 * moving either without the other closes the gap the bar hangs in.
 * The pen is a touch lighter than a heading baseline (2.6) because an aside
 * is written a size smaller — same hand, quieter voice.
 */
const ASIDE_BAR_X = 6;
const ASIDE_BAR_STROKE = 2.4;

/**
 * 禁则 backstop — the class whose `white-space: nowrap` welds a lone
 * punctuation box to the box it belongs to (stylesheet: `.bansho-nobr`).
 *
 * `splitRevealSegments` already folds a stranded mark into its neighbour,
 * so this group only ever forms for the residue the segmenter structurally
 * cannot reach: a mark whose whole RUN is punctuation. `**先验 × 似然 →
 * 后验**。` parses to [ink][text "。"], and merging across that boundary
 * would make the unit's srcSpan swallow the `**` markers, which G6
 * forbids. The mark therefore stays its own unit — one span, as the reveal
 * contract requires — and is welded to the previous box instead.
 *
 * MEASURED, not reasoned (2026-08-12, Chrome 151): of the mechanisms that
 * could weld two atomic inlines, ONLY a nowrap ancestor works. A WORD
 * JOINER text node between them does not; neither does U+FEFF; neither
 * does making the mark `display: inline`. And the group must hold exactly
 * the two boxes — a nowrap ancestor with `white-space: normal` restored on
 * an inner wrapper breaks apart again (the later item's style governs the
 * boundary), while a nowrap wrapper around a whole marked phrase would
 * stop that phrase wrapping at all.
 */
const NOBR_CLASS = "bansho-nobr";

type TextBearingStep = Extract<
  Step,
  { kind: "prose" | "aside" | "heading" | "list-item" }
>;

interface InkTarget {
  action: InkAction;
  spans: StyledElement[];
}

const textKey = (start: number, end: number): string => `t:${start}:${end}`;
const mathKey = (start: number, end: number): string => `m:${start}:${end}`;
const inkKey = (action: InkAction, start: number, end: number): string =>
  `k:${action}:${start}:${end}`;

/** G8-G — the ink-size basis is the COMPUTED FONT SIZE, never a line box. */
function fontSizeOf(doc: Document, target: Element): number {
  const win = doc.defaultView;
  if (win) {
    const fs = Number.parseFloat(win.getComputedStyle(target).fontSize);
    if (Number.isFinite(fs) && fs > 0) return fs;
  }
  return FALLBACK_FONT_SIZE;
}

function buildTextStep(
  step: TextBearingStep,
  ctx: MeasureContext,
): { node: Element; revealables: Revealable[] } {
  const doc = ctx.document;
  const units = planStepUnits(step, ctx.durations);
  const rnd = mulberry32(contentSeed(step));

  const node = doc.createElement("div") as StyledElement;
  node.className =
    step.kind === "heading"
      ? `bansho-step bansho-heading bansho-heading-${step.level}`
      : `bansho-step bansho-${step.kind}`;
  node.style.position = "relative";

  const svgUnder = overlaySvg(doc, 0); // highlighter bands, under the text
  const defs = el(doc, "defs");
  svgUnder.appendChild(defs);
  const textEl = doc.createElement("div") as StyledElement;
  textEl.className = "bansho-text";
  textEl.style.position = "relative";
  textEl.style.zIndex = "1";
  const svgOver = overlaySvg(doc, 2); // circles / strikes / underlines, over
  node.appendChild(svgUnder);
  node.appendChild(textEl);
  node.appendChild(svgOver);

  // ── DOM walk (mirrors planInline; targets keyed for plan lookup) ────────
  const targets = new Map<string, StyledElement | InkTarget>();
  const inkCollectors: StyledElement[][] = [];

  let bulletPath: StyledElement | null = null;
  if (step.kind === "list-item") {
    const bsvg = el(doc, "svg", { viewBox: "0 0 14 14", width: 14, height: 14 });
    bsvg.classList.add("bansho-bullet");
    bsvg.style.overflow = "visible";
    bulletPath = el(
      doc,
      "path",
      { d: jitterEllipse(7, 7, 2.6, 2.6, rnd, 0.8) },
      {
        fill: "none",
        stroke: "var(--board-fg, currentColor)",
        strokeWidth: "2.4px",
        strokeLinecap: "round",
      },
    );
    bsvg.appendChild(bulletPath);
    textEl.appendChild(bsvg);
  }

  // §4.3 并列对齐 — the alignment spacer (see `MeasureContext.alignShift`).
  // `alignAt` is the separator's END in stepPlainText offsets; the walk
  // tracks its own plain cursor (mirroring `stepPlainText`: breaks = one
  // space, math = zero width) and inserts the marker at the EXACT segment
  // boundary where the cursor lands on it. A separator ending mid-segment
  // (fullwidth colon glued to a CJK value, sliced "：三"/"倍") degrades to
  // no marker — never split a written word to make a column.
  const align =
    step.kind === "list-item" && step.align !== undefined ? step.align : null;
  const alignAt =
    align === null ? -1 : align.at + (align.sep === "colon" ? 1 : " — ".length);
  let plainCursor = 0;
  let alignSpacer: StyledElement | null = null;
  const maybeInsertSpacer = (parent: Element): void => {
    if (alignAt < 0 || alignSpacer !== null || plainCursor !== alignAt) return;
    const spacer = doc.createElement("span") as StyledElement;
    spacer.className = "bansho-align-spacer";
    spacer.style.display = "inline-block";
    spacer.style.width = `${ctx.alignShift?.(step) ?? 0}px`;
    parent.appendChild(spacer);
    alignSpacer = spacer;
    // A column gap is a gap: nothing may be welded across it.
    breakGlue();
  };

  // ── 禁则 backstop state (see NOBR_CLASS) ────────────────────────────────
  // `glueAnchor` is the last written BOX; anything else written (a gap, a
  // soft break, an align spacer) clears it, because a mark must never jump
  // a space it has to stay behind. `glueOpen` is an opening mark still
  // waiting for the box it opens.
  let glueAnchor: Element | null = null;
  let glueOpen: Element | null = null;
  const breakGlue = (): void => {
    glueAnchor = null;
    glueOpen = null;
  };
  /** The nowrap group `anchor` lives in, minting it around `anchor` if new. */
  const nobrGroup = (anchor: Element): Element => {
    const home = anchor.parentElement;
    if (home && home.classList.contains(NOBR_CLASS)) return home;
    const group = doc.createElement("span");
    group.className = NOBR_CLASS;
    home?.insertBefore(group, anchor);
    group.appendChild(anchor);
    return group;
  };
  /**
   * Write one box (a segment span or a formula) into the line, welding it
   * to its neighbour when 禁则 says the two may not be split.
   */
  const appendBox = (parent: Element, box: Element, text: string | null): void => {
    const closing = text !== null && isClosingPunctuation(text);
    const opening = text !== null && isOpeningPunctuation(text);
    if (closing && glueAnchor) nobrGroup(glueAnchor).appendChild(box);
    else if (glueOpen) nobrGroup(glueOpen).appendChild(box);
    else parent.appendChild(box);
    glueAnchor = box;
    glueOpen = opening ? box : null;
  };

  /**
   * Write one run's text into the line as reveal segments plus the gaps
   * between them.
   *
   * `substituteHandGlyphs` (hand-glyphs.ts) touches ONLY what reaches the
   * DOM. Every decision above and below it — the 禁则 glue verdict, the
   * plan↔DOM `textKey`, `plainCursor` and the §4.3 align spacer that rides
   * it — reads the ORIGINAL source text, because those are statements about
   * the document and the document did not change. The table is 1:1 in UTF-16
   * code units (pinned in `hand-glyphs.test.ts`), so the two views can never
   * drift in length; keeping the source side authoritative means they could
   * not drift in meaning either.
   */
  const emitSegments = (text: string, base: number, parent: Element): void => {
    let cursor = 0;
    for (const seg of splitRevealSegments(text, base)) {
      const rel = seg.start - base;
      if (rel > cursor) {
        maybeInsertSpacer(parent);
        const gap = text.slice(cursor, rel);
        parent.appendChild(doc.createTextNode(substituteHandGlyphs(gap)));
        plainCursor += gap.length;
        breakGlue();
      }
      maybeInsertSpacer(parent);
      const span = doc.createElement("span") as StyledElement;
      span.className = "bansho-w";
      span.style.display = "inline-block";
      span.style.whiteSpace = "pre";
      // §7 R1 — unrevealed is the DEFAULT state, set at creation, not a side
      // effect of a successful plan↔DOM lookup: if the mirror ever drifts and
      // a unit degrades to inert, the span must FAIL CLOSED (stay hidden until
      // repaired), never paint the whole paragraph before the pen arrives.
      // (The prototype encoded this in the `.w` CSS class; here creation time
      // is the structural seam.)
      span.style.clipPath = "inset(0 100% 0 0)";
      span.textContent = substituteHandGlyphs(seg.text);
      appendBox(parent, span, seg.text);
      targets.set(textKey(seg.start, seg.end), span);
      for (const collector of inkCollectors) collector.push(span);
      plainCursor += seg.text.length;
      cursor = rel + seg.text.length;
    }
    if (cursor < text.length) {
      maybeInsertSpacer(parent);
      const tail = text.slice(cursor);
      parent.appendChild(doc.createTextNode(substituteHandGlyphs(tail)));
      plainCursor += tail.length;
      breakGlue();
    }
  };

  const walk = (runs: InlineRun[], parent: Element): void => {
    for (const run of runs) {
      switch (run.kind) {
        case "text":
          emitSegments(run.text, run.srcSpan.start, parent);
          break;
        case "break":
          maybeInsertSpacer(parent);
          parent.appendChild(doc.createTextNode(" "));
          plainCursor += 1; // stepPlainText: a soft break is one space
          breakGlue();
          break;
        case "em": {
          const wrap = doc.createElement("em");
          wrap.className = "bansho-em";
          parent.appendChild(wrap);
          emitSegments(run.text, run.textSpan.start, wrap);
          break;
        }
        case "term": {
          const wrap = doc.createElement("span");
          wrap.className = "bansho-term";
          parent.appendChild(wrap);
          emitSegments(run.text, run.textSpan.start, wrap);
          break;
        }
        case "math": {
          maybeInsertSpacer(parent); // math is zero-width in plain offsets
          const m = buildMathNode(doc, run.tex, false);
          // A formula is a written box like any other: a full stop after
          // `$x$` must not be able to start the next line either.
          appendBox(parent, m, null);
          targets.set(mathKey(run.srcSpan.start, run.srcSpan.end), m);
          break;
        }
        case "ink": {
          const wrap = doc.createElement("span");
          wrap.className = `bansho-ink bansho-ink-${run.action}`;
          parent.appendChild(wrap);
          const spans: StyledElement[] = [];
          inkCollectors.push(spans);
          if (run.children) walk(run.children, wrap);
          else emitSegments(run.text, run.textSpan.start, wrap);
          inkCollectors.pop();
          targets.set(inkKey(run.action, run.srcSpan.start, run.srcSpan.end), {
            action: run.action,
            spans,
          });
          break;
        }
      }
    }
  };
  walk(step.inline, textEl);

  // ── Measure (mounted just long enough), then materialize in PLAN order ──
  // try/finally makes the unmount STRUCTURAL, not positional: any throw in
  // the measure/materialize window (a G8-D el() violation introduced by a
  // future factory edit, an exotic getComputedStyle failure) must not leave
  // the node parented in the hidden measure host — on a throw it is never
  // returned to the caller, so nothing else could clean it up and
  // successive builds would accumulate.
  ctx.measureHost.appendChild(node);
  try {
    // The ink overlays are absolutely-positioned children of `node`, so
    // their user-space origin is the node's PADDING box — while
    // getBoundingClientRect() measures the BORDER box. On a bordered step
    // the two origins differ by the border width and every in-place gesture
    // would land offset by exactly that amount; clientLeft/clientTop IS
    // that delta, so fold it in. No shipped step carries a border today
    // (`.bansho-aside`'s border-left became a drawn margin bar — a board of
    // hand lines has no room for one CSS-straight one), but a content set's
    // theme.css owns this surface, so the correction stays: it costs two
    // reads and it is the difference between "no border" and "no border
    // YET".
    const baseRect = node.getBoundingClientRect();
    const originX = baseRect.left + node.clientLeft;
    const originY = baseRect.top + node.clientTop;
    const relRect = (target: Element): RectLike => {
      const r = target.getBoundingClientRect();
      return {
        left: r.left - originX,
        top: r.top - originY,
        right: r.right - originX,
        bottom: r.bottom - originY,
      };
    };
    const width = node.clientWidth || ctx.measureHost.clientWidth || FALLBACK_WIDTH;
    const height = node.clientHeight || 0;

    // Plan↔DOM drift is a bug — the unit fails CLOSED (its node was created
    // pre-clipped, so nothing paints) and we degrade loudly, never silently
    // (R6 discipline; mirrors the `materialize` drift warn in chart.ts).
    const missWarn = (unit: UnitPlan): Revealable => {
      console.warn(
        `[bansho] ${step.kind}: plan unit "${unit.kind}" ` +
          `[${unit.srcSpan.start},${unit.srcSpan.end}) found no DOM target — ` +
          `degrading to an inert (still-clipped) unit`,
      );
      return inertRevealable(unit);
    };

    const buildUnit = (unit: UnitPlan): Revealable => {
      switch (unit.kind) {
        case "text": {
          const span = targets.get(textKey(unit.srcSpan.start, unit.srcSpan.end));
          if (!span || "spans" in span) return missWarn(unit);
          return clipWipe(span, {
            duration: unit.duration,
            srcSpan: unit.srcSpan,
            ease: Ease.write,
          });
        }
        case "math": {
          const m = targets.get(mathKey(unit.srcSpan.start, unit.srcSpan.end));
          if (!m || "spans" in m) return missWarn(unit);
          return clipWipe(m, {
            duration: unit.duration,
            srcSpan: unit.srcSpan,
            ease: Ease.write,
          });
        }
        case "ink": {
          const target = unit.action
            ? targets.get(inkKey(unit.action, unit.srcSpan.start, unit.srcSpan.end))
            : undefined;
          // A key miss here is the SAME class of bug as a text/math miss —
          // real plan↔DOM mirror drift — and degrades just as loudly (R6).
          // The legitimately-quiet case (measurable target, zero rows in a
          // layout-free host) is handled inside paintInk and stays silent.
          if (!target || !("spans" in target)) return missWarn(unit);
          const rows = groupRowRects(
            target.spans.map(relRect),
            // G8-M — the baseline inside each line box, so the marks meet
            // the writing instead of the box that contains it.
            target.spans[0] ? baselineOffset(doc, target.spans[0]) : undefined,
          );
          const fontSize = target.spans[0]
            ? fontSizeOf(doc, target.spans[0])
            : FALLBACK_FONT_SIZE;
          return paintInk({
            doc,
            fillLayer: svgUnder,
            strokeLayer: svgOver,
            defs,
            action: target.action,
            rows,
            fontSize,
            rnd,
            duration: unit.duration,
            srcSpan: unit.srcSpan,
          });
        }
        case "bullet":
          return bulletPath
            ? strokeReveal([{ path: bulletPath, length: 18 }], {
                duration: unit.duration,
                srcSpan: unit.srcSpan,
                ease: Ease.circle,
              })
            : inertRevealable(unit);
        case "rule":
          // Two hand lines, one helper (see `drawHandLine`): an aside's
          // margin bar runs DOWN the gutter, every other rule runs ACROSS.
          // RESIZE POLICY (both): the line lands in `svgOver` (full-bleed,
          // NO viewBox), so its geometry stays at measure-time pixels,
          // while `ruleFactory`'s `---` stretches via viewBox. Both are
          // correct under the host's rebuild-on-resize contract —
          // BoardCanvas's ResizeObserver rebuilds every step after a resize
          // (measured geometry is invalidated wholesale), so the divergence
          // can only exist inside the debounce window, never at rest.
          return step.kind === "aside"
            ? // §4.3 旁注 — drawn BEFORE the note (planStepUnits puts it
              // first), spanning the note's MEASURED height, so a wrapped
              // two-line remark gets a two-line bar. The final height is
              // already known here even though not one glyph has been
              // written: the reveal is a clip-path, and clipping does not
              // move layout.
              drawHandLine(doc, svgOver, height, ASIDE_BAR_X, rnd, {
                duration: unit.duration,
                srcSpan: unit.srcSpan,
                strokeWidth: ASIDE_BAR_STROKE,
                axis: "vertical",
              })
            : // The heading's hand-drawn baseline (§4.3 大字写出 + 手绘底线).
              drawHandLine(doc, svgOver, width, Math.max(height - 3, 4), rnd, {
                duration: unit.duration,
                srcSpan: unit.srcSpan,
                strokeWidth: 2.6,
              });
        default:
          // Same class as every miss above: a plan unit of an unexpected
          // kind reaching a text step is plan↔DOM drift and must be
          // VISIBLE, not a quiet inert beat.
          return missWarn(unit);
      }
    };
    return { node, revealables: units.map(buildUnit) };
  } finally {
    ctx.measureHost.removeChild(node);
  }
}

const textBearingFactory = (
  kind: TextBearingStep["kind"],
): RevealableFactory => ({
  kind,
  build(step, ctx) {
    if (step.kind !== kind) {
      return {
        node: ctx.document.createElement("div"),
        revealables: planStepUnits(step, ctx.durations).map(inertRevealable),
      };
    }
    return buildTextStep(step, ctx);
  },
});

export const proseFactory = textBearingFactory("prose");
export const asideFactory = textBearingFactory("aside");
export const headingFactory = textBearingFactory("heading");
export const listItemFactory = textBearingFactory("list-item");

/**
 * Semantic inference (I1–I9) — the single translation point between the
 * lecture model and the reveal schedule (设计稿 §5).
 *
 * Layering (G2): engine core — zero DOM, zero React, zero external imports.
 * Pure functions of (Lecture | Step, DurationConstants); byte-deterministic.
 *
 * ★ UNIT-DECOMPOSITION AUTHORITY (the T2 ↔ T3 seam). `planStepUnits` is the
 * canonical decomposition of a step into reveal units. A T3
 * `RevealableFactory` MUST build its revealables 1:1 with this plan — same
 * count, same order, same meaning — because `StepSchedule.unit` indexes into
 * BOTH arrays. Factories should call `planStepUnits` themselves instead of
 * re-deriving the split. A count mismatch is a factory bug; the scheduler
 * degrades defensively (plan-duration fallback, unpaired units seek nowhere)
 * but the on-screen pen and the highlighted source line will disagree.
 *
 * Single-pen invariant (G1): the plan is a strict sequence — one unit after
 * another with non-negative pen-up gaps in between. Nothing here can express
 * simultaneity; the removed `@with`/`@after` never reach this layer (they
 * parse to BadSteps, which plan to nothing).
 *
 * Deliberate prototype divergences, all rev-4 spec-driven:
 *  - I2: `==`/`**`/`(( ))` ink defers to the END of its sentence (§4.3
 *    "荧光笔扫过(写完本句后)"); the prototype fired marks immediately.
 *    `~~strike~~` stays immediate per I3 (write → beat → strike through).
 *  - I4: chart ticks/labels are fully serialized (`tick .20` / `label .40`
 *    each); the prototype staggered overlapping fades (pre-rev4).
 *  - §4.4: axis lines draw x → y; the prototype drew y first.
 */

import {
  CAMERA_FALLBACK,
  CHART_GLUE,
  CJK_SEGMENT_CHARS,
  GRAPH_GLUE,
  HEADING_GAP_MULT,
  IMAGE_GLUE,
  asideBarDuration,
  bulletDuration,
  endsSentence,
  graphBoxDuration,
  graphEdgeDuration,
  hasCjk,
  headingBaselineLift,
  imageDuration,
  isClosingPunctuation,
  isOpeningPunctuation,
  isSegmentCutChar,
  mathDuration,
  ruleDuration,
  segmentGapAfter,
  wordDuration,
} from "./duration.js";
import type {
  ChartAxis,
  ChartFrameStep,
  ChartLayerStep,
  DurationConstants,
  GraphFrameStep,
  GraphLayerStep,
  InkAction,
  InlineRun,
  Lecture,
  SrcSpan,
  StagePlanInput,
  Step,
  StepRef,
} from "./types.js";

// ────────────────────────────────────────────────────────────────────────────
// Plan shapes
// ────────────────────────────────────────────────────────────────────────────

/**
 * What one reveal unit IS, in lecture vocabulary. T3 factories map each kind
 * to a node + RevealKind (§5.2 negotiation); the pure layer only needs the
 * kind to pick durations and gaps.
 */
export type UnitKind =
  | "text" // one written segment (I9)
  | "math" // a formula wiping left→right (inline or block)
  | "ink" // one pen gesture: in-place mark (I2/I3) or back reference (I6)
  | "bullet" // list item's hand-drawn dot (§4.3 手绘弹点)
  | "rule" // a hand-drawn line: `---`, a heading's baseline, an aside's
  //          margin bar — one pen gesture, one helper (§4.3)
  | "axis" // one chart axis line (I4)
  | "tick" // one y-axis tick (I4)
  | "axis-label" // one x-axis label (I4)
  | "series" // one data line, drawn left→right (I5)
  | "series-label" // its name, written after the line lands (I5)
  | "chart-mark" // `+ mark` row — a short annotation at a data point
  | "chart-note" // `+ note` row — a free annotation
  | "graph-node" // one hand-drawn box (T12)
  | "graph-label" // the name (and explanation) written inside it
  | "graph-edge" // one arrow between two boxes
  | "image" // one drawn figure (I1) — a picture the lecture names
  | "camera" // one camera move (C2) — exclusive stage time, draws nothing
  | "erase" // one eraser sweep (C3) — exclusive stage time, hides a board
  | "turn" // one `@turn` walk (S1) — exclusive stage time, moves the pen
  | "place"; // one `@at` walk (V2) — same, one grain finer: within a board

/** One planned reveal unit — the atom the single pen performs (G1). */
export interface UnitPlan {
  kind: UnitKind;
  /** G6 — the precise source range this unit performs. */
  srcSpan: SrcSpan;
  /** Content-derived seconds (I8). A factory-measured `naturalDuration`
   *  and the G3 override (scheduler-applied) both take precedence. */
  duration: number;
  /** Pen-lift pause before the unit starts (e.g. annotDelay). */
  gapBefore: number;
  /** Pen-up pause after the unit ends (word gap, punctuation, glue). */
  gapAfter: number;
  /** For text units: the exact written segment (byte-for-byte the source
   *  slice at `srcSpan`). For chart units: the row's display text. */
  text?: string;
  /** For ink units: which pen gesture. */
  action?: InkAction;
}

/** One step's complete reveal plan. */
export interface StepPlan {
  ref: StepRef;
  step: Step;
  /** I1 — the pause between the previous step's pen-up and this step's
   *  first unit (paraGap; ×2 after heading/rule; chartLead for charts;
   *  the explicit beat for `@wait`). */
  leadIn: number;
  units: UnitPlan[];
}

// ────────────────────────────────────────────────────────────────────────────
// I9 — reveal-unit segmentation (the rule that matters more than constants)
// ────────────────────────────────────────────────────────────────────────────

/** One text segment with ABSOLUTE source offsets (base + in-text index). */
export interface TextSegment {
  text: string;
  start: number;
  end: number;
}

const TOKEN = /\S+/g;

/**
 * 禁则, decided at the segmenter (see `isClosingPunctuation`): a mark that
 * may never begin a line must not BE a reveal unit — it belongs to the
 * word it terminates, which is also how the hand writes it (the pen does
 * not lift before a full stop). The mirror holds for an opening mark: it
 * belongs to the word it opens.
 *
 * Why the cut still happens first: `isSegmentCutChar` ends a chunk AFTER
 * every mark so the I1 pause, the I2 sentence flush and the §4.3 align
 * boundary all land on a real segment edge. That cut plus blind 2-glyph
 * slicing is what strands the mark whenever the chunk has odd length
 * (`阳性。` → 阳性 / 。). Merging here keeps every one of those boundaries
 * — the merged text still ENDS with the mark, so `segmentGapAfter` and
 * `endsSentence` read exactly what they read before — and removes the
 * stranded box.
 *
 * Merges only ADJACENT segments (`prev.end === seg.start`). Two tokens are
 * separated by whitespace the DOM walk emits as a text node, so the guard
 * is what keeps a mark from jumping a space it must stay behind.
 */
function glueLonePunctuation(segs: TextSegment[]): TextSegment[] {
  const left: TextSegment[] = [];
  for (const seg of segs) {
    const prev = left[left.length - 1];
    if (prev && prev.end === seg.start && isClosingPunctuation(seg.text)) {
      left[left.length - 1] = {
        text: prev.text + seg.text,
        start: prev.start,
        end: seg.end,
      };
      continue;
    }
    left.push(seg);
  }
  const out: TextSegment[] = [];
  for (let i = left.length - 1; i >= 0; i--) {
    const seg = left[i]!;
    const next = out[0];
    if (next && seg.end === next.start && isOpeningPunctuation(seg.text)) {
      out[0] = { text: seg.text + next.text, start: seg.start, end: next.end };
      continue;
    }
    out.unshift(seg);
  }
  return out;
}

/**
 * I9 — split visible text into reveal segments: CJK-bearing tokens slice
 * into 1–2 char pieces ("一笔一笔" 的手感), Latin tokens stay whole words.
 * Prototype-faithful, including mixed tokens ("GPU集群" → GP/U集/群), with
 * one spec-driven correction: a CJK token is first cut AFTER every
 * chunk-boundary char — pause punctuation AND label colons — then sliced
 * by 2 within each chunk. Otherwise "再说。然后" slices into 再说/。然/后
 * and the sentence pause (I1) plus the I2 flush boundary silently vanish,
 * and "性质:结构" glues the colon so the §4.3 align marker has no
 * boundary to land on (see `isSegmentCutChar`).
 * Offsets are absolute so every segment's srcSpan is exact (G6) — the
 * caller passes the token text's absolute start offset as `base`.
 * Lone punctuation is folded back into its neighbour on the way out
 * (`glueLonePunctuation`), so no segment is a bare mark that could open or
 * close a line on its own.
 */
export function splitRevealSegments(text: string, base: number): TextSegment[] {
  const out: TextSegment[] = [];
  for (const m of text.matchAll(TOKEN)) {
    const token = m[0];
    const at = base + m.index;
    if (!hasCjk(token)) {
      out.push({ text: token, start: at, end: at + token.length });
      continue;
    }
    let chunkStart = 0;
    for (let i = 0; i < token.length; i++) {
      const isLast = i === token.length - 1;
      if (!isLast && !isSegmentCutChar(token[i]!)) continue;
      const chunk = token.slice(chunkStart, i + 1);
      // Slice by CODE POINTS (grouped CJK_SEGMENT_CHARS at a time), never
      // by UTF-16 units — unit slicing cut astral chars (emoji, CJK-ext)
      // into lone surrogates that render as U+FFFD. Offsets stay UTF-16
      // (the srcSpan vocabulary): `k` accumulates each piece's unit length
      // so every segment is still the exact source slice (G6).
      const points = Array.from(chunk);
      let k = 0;
      for (let c = 0; c < points.length; c += CJK_SEGMENT_CHARS) {
        const piece = points.slice(c, c + CJK_SEGMENT_CHARS).join("");
        out.push({
          text: piece,
          start: at + chunkStart + k,
          end: at + chunkStart + k + piece.length,
        });
        k += piece.length;
      }
      chunkStart = i + 1;
    }
  }
  return glueLonePunctuation(out);
}

// ────────────────────────────────────────────────────────────────────────────
// Text-bearing steps — I2 (deferral), I3 (strike immediacy)
// ────────────────────────────────────────────────────────────────────────────

function inkUnit(action: InkAction, srcSpan: SrcSpan, d: DurationConstants): UnitPlan {
  // I2 rhythm: annotDelay before the pen lands, annotate for the gesture,
  // afterAnnot before writing resumes (单线程化的产物).
  return {
    kind: "ink",
    action,
    srcSpan,
    duration: d.annotate,
    gapBefore: d.annotDelay,
    gapAfter: d.afterAnnot,
  };
}

/**
 * Plan the inline runs of a text-bearing step. Text streams segment by
 * segment; `~~strike~~` fires right after its own text (I3, "等等,不对");
 * highlight/underline/circle queue and land after the sentence finishes
 * (I2, §4.3 "写完本句后"), or at the paragraph end when no sentence ender
 * follows. Sentence flushing only triggers at the top nesting level — a
 * sentence ender INSIDE a mark's own text never flushes the mark that is
 * still being written.
 */
function planInline(runs: InlineRun[], d: DurationConstants): UnitPlan[] {
  const units: UnitPlan[] = [];
  const queued: UnitPlan[] = [];

  const flushQueued = (): void => {
    while (queued.length > 0) units.push(queued.shift()!);
  };

  const emitText = (text: string, base: number, topLevel: boolean): void => {
    for (const seg of splitRevealSegments(text, base)) {
      units.push({
        kind: "text",
        text: seg.text,
        srcSpan: { start: seg.start, end: seg.end },
        duration: wordDuration(seg.text, d),
        gapBefore: 0,
        gapAfter: segmentGapAfter(seg.text, d),
      });
      if (topLevel && endsSentence(seg.text)) flushQueued();
    }
  };

  const walk = (rs: InlineRun[], topLevel: boolean): void => {
    for (const run of rs) {
      switch (run.kind) {
        case "text":
          emitText(run.text, run.srcSpan.start, topLevel);
          break;
        case "break":
          break; // a soft line break is whitespace — no pen time of its own
        case "em":
        case "term":
          emitText(run.text, run.textSpan.start, topLevel);
          break;
        case "math":
          units.push({
            kind: "math",
            srcSpan: run.srcSpan,
            duration: mathDuration(run.tex, d),
            gapBefore: 0,
            gapAfter: d.gap,
          });
          break;
        case "ink": {
          // The marked text is WRITTEN first (I2 "正常写出"), then the pen
          // gesture happens — immediately for strike (I3), at sentence end
          // for the rest (I2).
          if (run.children) walk(run.children, false);
          else emitText(run.text, run.textSpan.start, false);
          const action = inkUnit(run.action, run.srcSpan, d);
          if (run.action === "strike") units.push(action);
          else queued.push(action);
          // A sentence ender at the END of the mark's own text ends the
          // sentence the mark belongs to (==这一点最关键。==) — flush NOW,
          // or the ink defers a whole extra sentence (I2 violation). Safe
          // because the mark's action is already queued: an ender walked
          // INSIDE the mark's text never flushes the mark mid-write (the
          // nested walk above runs with topLevel=false), only its end can.
          if (topLevel && endsSentence(run.text.trimEnd())) flushQueued();
          break;
        }
      }
    }
  };

  walk(runs, true);
  flushQueued();
  return units;
}

// ────────────────────────────────────────────────────────────────────────────
// Charts — I4 (serial skeleton) / I5 (serial layers)
// ────────────────────────────────────────────────────────────────────────────

/** The tick/label entries an axis declares: enumeration, or its endpoints. */
function axisEntries(axis: ChartAxis | undefined): string[] {
  if (!axis) return [];
  if (axis.values) return axis.values;
  const out: string[] = [];
  if (axis.from !== undefined) out.push(axis.from);
  if (axis.to !== undefined) out.push(axis.to);
  return out;
}

/**
 * The y entries that actually earn a TICK unit: only values the y scale can
 * place — `Y(v)` needs a finite number. A categorical / non-numeric entry
 * (`y: 低 .. 高`) plans NO unit, so the factory (which consumes THIS same
 * function — one predicate, two sides of the T2↔T3 seam) draws nothing for
 * it and the board never spends `d.tick` seconds on an invisible beat (the
 * prototype likewise skipped isNaN entries and simply drew fewer ticks).
 */
export function finiteYTickEntries(axis: ChartAxis | undefined): string[] {
  return axisEntries(axis).filter((v) =>
    Number.isFinite(Number.parseFloat(v)),
  );
}

function planChart(
  step: ChartFrameStep | ChartLayerStep,
  d: DurationConstants,
): UnitPlan[] {
  const units: UnitPlan[] = [];
  const push = (
    kind: UnitKind,
    srcSpan: SrcSpan,
    duration: number,
    gapAfter: number,
    text?: string,
  ): void => {
    units.push({ kind, srcSpan, duration, gapBefore: 0, gapAfter, text });
  };

  if (step.kind === "chart-frame") {
    // I4 — the frame stands up strictly one stroke at a time: the axis
    // lines (§4.4: x → y), then each tick, then each axis label. Only
    // DECLARED axes plan units — `type:` alone marks a frame at parse
    // time, so an absent axis must not fabricate a phantom stroke, and a
    // whole-block srcSpan fallback is a G6 violation (整块共享已证伪).
    const { x, y } = step;
    if (x) push("axis", x.srcSpan, d.axis, CHART_GLUE.afterAxisLine);
    if (y) push("axis", y.srcSpan, d.axis, CHART_GLUE.afterAxisLine);
    if (y) {
      // Only numeric entries earn a tick beat (see finiteYTickEntries).
      for (const v of finiteYTickEntries(y)) {
        push("tick", y.srcSpan, d.tick, CHART_GLUE.afterEntry, v);
      }
    }
    if (x) {
      for (const v of axisEntries(x)) {
        push("axis-label", x.srcSpan, d.label, CHART_GLUE.afterEntry, v);
      }
    }
    // A breath once the whole skeleton stands, before data goes on (an
    // axis-less frame has no skeleton and earns no breath).
    if (units.length > 0) {
      units[units.length - 1]!.gapAfter += CHART_GLUE.afterSkeleton;
    }
  }

  // Layer rows, in block order (I5): each series draws fully, THEN its name
  // is written where the pen already is; marks and notes are short writes.
  for (const row of step.rows) {
    if (row.kind === "series") {
      push("series", row.srcSpan, d.series, 0, row.name);
      push("series-label", row.srcSpan, d.label, CHART_GLUE.afterSeriesLabel, row.name);
    } else if (row.kind === "mark") {
      push("chart-mark", row.srcSpan, d.label, CHART_GLUE.afterEntry, row.text);
    } else {
      push("chart-note", row.srcSpan, d.label, CHART_GLUE.afterEntry, row.text);
    }
  }

  if (units.length > 0) {
    units[units.length - 1]!.gapAfter += CHART_GLUE.tail;
  }
  return units;
}

// ────────────────────────────────────────────────────────────────────────────
// Graphs — the chart's sibling container, same single pen (T12)
// ────────────────────────────────────────────────────────────────────────────

/**
 * The text written inside a node's box: its name, plus the explanation when
 * the author gave it one. ONE unit, not two — a person writing a box does
 * not lift the pen between the label and the line under it, and splitting
 * would put a scheduled pause inside a single hand movement.
 */
export function graphLabelText(name: string, note?: string): string {
  return note ? `${name} ${note}` : name;
}

/**
 * Plan one graph block: box → its name, per node, then every arrow.
 *
 * That is the order a person draws a flow chart in — you put a box up and
 * immediately say what it is, then the next one, and only once the things
 * exist do you connect them. (The alternative literal reading of 先画框 →
 * 再写框内的字 — every empty box first, then a pass filling them in — is
 * how a machine would do it, and reads that way.) Arrows last either way.
 *
 * Only what this block is the FIRST to mention plans a unit: a node or an
 * arrow already on the board is not drawn again (domain.ts).
 */
function planGraph(
  step: GraphFrameStep | GraphLayerStep,
  d: DurationConstants,
): UnitPlan[] {
  const units: UnitPlan[] = [];
  const notes =
    step.kind === "graph-frame"
      ? new Map(step.layout.nodes.map((n) => [n.name, n.note]))
      : undefined;

  step.nodes.forEach((node, i) => {
    const last = i === step.nodes.length - 1;
    units.push({
      kind: "graph-node",
      srcSpan: node.srcSpan,
      duration: graphBoxDuration(d),
      gapBefore: 0,
      gapAfter: GRAPH_GLUE.afterBox,
      text: node.name,
    });
    // A frame knows every note in the container (a later block may annotate
    // a node this block drew); a layer only ever draws nodes it introduced
    // itself, whose notes it carries — see `MeasureContext.container`.
    const text = graphLabelText(node.name, notes?.get(node.name) ?? node.note);
    units.push({
      kind: "graph-label",
      srcSpan: node.srcSpan,
      duration: wordDuration(text, d),
      gapBefore: 0,
      gapAfter: last ? GRAPH_GLUE.beforeEdges : GRAPH_GLUE.afterNode,
      text,
    });
  });

  for (const edge of step.edges) {
    units.push({
      kind: "graph-edge",
      srcSpan: edge.srcSpan,
      duration: graphEdgeDuration(d),
      gapBefore: 0,
      gapAfter: GRAPH_GLUE.afterEdge,
      text: `${edge.from} → ${edge.to}`,
    });
  }

  if (units.length > 0) {
    units[units.length - 1]!.gapAfter += GRAPH_GLUE.tail;
  }
  return units;
}

// ────────────────────────────────────────────────────────────────────────────
// planStepUnits — the canonical per-step decomposition (T3 builds 1:1)
// ────────────────────────────────────────────────────────────────────────────

/**
 * The canonical decomposition of ONE step into reveal units — the T2 ↔ T3
 * seam (see the module header). Total over every `Step` kind: `bad` and
 * `wait` plan to no units (a wait's beat rides `StepPlan.leadIn`).
 */
export function planStepUnits(step: Step, d: DurationConstants): UnitPlan[] {
  switch (step.kind) {
    case "heading": {
      // 大字写出 + 手绘底线 (§4.3): the heading text, then its baseline.
      const units = planInline(step.inline, d);
      units.push({
        kind: "rule",
        srcSpan: step.srcSpan,
        duration: ruleDuration(d),
        gapBefore: headingBaselineLift(d),
        gapAfter: 0,
      });
      return units;
    }
    case "prose":
      return planInline(step.inline, d);
    case "aside": {
      // §4.3 旁注 — the margin bar goes down FIRST, then the note is written
      // beside it. The bar is this block's register marker (the aside's
      // 手绘弹点, the same gesture order as the graph's 先画框再写字), not a
      // decoration applied afterwards like the heading's baseline: a hand
      // marking off a remark reaches for the margin before it starts
      // writing. Its srcSpan is the `>` marker itself (G6 precision,
      // mirroring the bullet's dash); consecutive quote lines merge into
      // one step, so that is the FIRST line's marker.
      const bar: UnitPlan = {
        kind: "rule",
        srcSpan: { start: step.srcSpan.start, end: step.srcSpan.start + 1 },
        duration: asideBarDuration(d),
        gapBefore: 0,
        gapAfter: d.gap,
      };
      return [bar, ...planInline(step.inline, d)];
    }
    case "list-item": {
      // 手绘弹点 + 逐条浮现 (§4.3): the dot, then the item's text. The
      // bullet's srcSpan is the dash itself (G6 precision).
      const dash: UnitPlan = {
        kind: "bullet",
        srcSpan: { start: step.srcSpan.start, end: step.srcSpan.start + 1 },
        duration: bulletDuration(d),
        gapBefore: 0,
        gapAfter: d.gap,
      };
      return [dash, ...planInline(step.inline, d)];
    }
    case "rule":
      return [
        {
          kind: "rule",
          srcSpan: step.srcSpan,
          duration: ruleDuration(d),
          gapBefore: 0,
          gapAfter: 0,
        },
      ];
    case "image":
      // I1 — one drawn figure: a single continuous piece of drawing, so a
      // single unit, strictly serial with everything around it (G1).
      //
      // The time here is the SQUARE reference (`IMAGE_GLUE.nominalAspect`),
      // not the figure's own: the declared aspect lives in a sidecar and
      // this layer is a pure function of the document. The built figure
      // reports its real time through the measured-wins-per-unit channel
      // (`engine/timeline.ts`), exactly as a camera move reports its arc
      // length over `CAMERA_FALLBACK`.
      return [
        {
          kind: "image",
          srcSpan: step.srcSpan,
          duration: imageDuration(IMAGE_GLUE.nominalAspect),
          gapBefore: 0,
          gapAfter: IMAGE_GLUE.tail,
        },
      ];
    case "html":
      // Unperformable in v1 — no factory exists (Phase 3 骨架完备), so a
      // planned beat would burn dead board time with nothing on screen and
      // no owner. The step stays in the model; parse surfaces the loud
      // `unsupportedStep` warning (domain.ts) so the silence is declared,
      // and the plan is empty like `wait`/`bad`.
      return [];
    case "math":
      return [
        {
          kind: "math",
          srcSpan: step.srcSpan,
          duration: mathDuration(step.tex, d),
          gapBefore: 0,
          gapAfter: 0,
        },
      ];
    case "chart-frame":
    case "chart-layer":
      return planChart(step, d);
    case "graph-frame":
    case "graph-layer":
      return planGraph(step, d);
    case "backref":
      // I6 — the pen turns back to earlier writing: one gesture, strictly
      // serial with everything around it (镜头跟笔走).
      return [inkUnit(step.action, step.srcSpan, d)];
    case "camera":
      // C2 — one exclusive camera window (G1: the pen waits while the
      // camera travels). The duration here is a PLACEHOLDER: the real
      // value is the Van Wijk arc length of the move, measured by the
      // host and applied through the G3 override (engine/stage.ts). It
      // must stay > 0 or the override's naturalTotal guard rejects the
      // measurement (see CAMERA_FALLBACK). srcSpan is the directive's own
      // line (G6). No factory pairs with this unit — its schedule entry
      // rides makeSeek's unpaired "dispatch nowhere" path.
      return [
        {
          kind: "camera",
          srcSpan: step.srcSpan,
          duration: CAMERA_FALLBACK,
          gapBefore: 0,
          gapAfter: 0,
        },
      ];
    case "erase":
      // C3 — one exclusive eraser sweep (G1: the pen waits while the
      // hand erases). Which BOARD it wipes is the assignment fold's
      // verdict, not the step's — the factory learns it through the
      // `MeasureContext.eraseTarget` seam. srcSpan is the directive's
      // own line (G6). No trailing gap of its own: the next step's
      // lead-in already provides the breath.
      return [
        {
          kind: "erase",
          srcSpan: step.srcSpan,
          duration: d.erase,
          gapBefore: 0,
          gapAfter: 0,
        },
      ];
    case "turn":
      // S1 (§7.6-Q2) — the plan is tier-BLIND: tier is the fold's verdict
      // and the fold eats viewer-measured heights, so the pure plan cannot
      // (and must not) branch on it. Every turn plans exactly ONE 走位
      // unit at the topic-change breath; a tier-3 turn's eraser revealable
      // is swapped in by the host through the measurements seam, and its
      // measured naturalDuration overrides this value by the existing
      // timeline rule. srcSpan is the directive's own line (G6). No
      // factory pairs with the unit on tier-1/2 or an inert turn — its
      // schedule entry rides makeSeek's unpaired "dispatch nowhere" path,
      // so the beat is occupied either way (Q3's "one beat" for free).
      return [
        {
          kind: "turn",
          srcSpan: step.srcSpan,
          duration: d.turn,
          gapBefore: 0,
          gapAfter: 0,
        },
      ];
    case "at":
      // Canvas pivot V2 (design §3.1) — the placement walk, planned
      // verbatim like `@turn`: one exclusive 走位 unit at its own
      // duration, no revealable to pair with (its schedule entry rides
      // makeSeek's unpaired "dispatch nowhere" path, the same one the
      // camera verbs use), and measurement-free — where the pen goes is
      // a word, and a word needs no height. srcSpan is the directive's
      // own line (G6).
      return [
        {
          kind: "place",
          srcSpan: step.srcSpan,
          duration: d.place,
          gapBefore: 0,
          gapAfter: 0,
        },
      ];
    case "board-config":
    case "wait":
    case "bad":
      return [];
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Lecture-level planning — I1 inter-step gaps + document order
// ────────────────────────────────────────────────────────────────────────────

/**
 * Flatten a lecture into document order with engine addresses: each
 * section's heading (step `-1`) first, then its steps.
 */
export function flattenSteps(
  lecture: Lecture,
): Array<{ ref: StepRef; step: Step }> {
  const out: Array<{ ref: StepRef; step: Step }> = [];
  lecture.sections.forEach((section, s) => {
    if (section.heading) out.push({ ref: { section: s, step: -1 }, step: section.heading });
    section.steps.forEach((step, i) => {
      out.push({ ref: { section: s, step: i }, step });
    });
  });
  return out;
}

/**
 * I1 — document order IS playback order, globally strictly serial. Each
 * plan's `leadIn` encodes the inter-step pause:
 *
 *  - first performed step: 0 (playback starts at the first pen-down);
 *  - after an ordinary step: paraGap;
 *  - after a heading or a `---` rule: paraGap × HEADING_GAP_MULT (I1);
 *  - chart frames add chartLead, accumulation layers chartLead × 0.6
 *    (I4/I5 — the 转身 pause), on top of the base;
 *  - `@wait [n]`: the explicit beat itself (n, default one paraGap), as a
 *    unit-less plan that is TRANSPARENT for its neighbours' gap chain (I7 —
 *    an extra beat, never a replacement);
 *  - bad steps are skipped entirely and are equally transparent (R6: their
 *    blast radius is zero seconds).
 */
/**
 * I4/I5 — the 转身 pause before a named container (charts and graphs alike,
 * one rule): the full lead when the pen turns to a fresh canvas, the softer
 * `layerLeadFactor` share when it comes back to one already standing.
 */
function containerLead(step: Step, d: DurationConstants): number {
  switch (step.kind) {
    case "chart-frame":
    case "graph-frame":
      return d.chartLead;
    case "chart-layer":
    case "graph-layer":
      return d.chartLead * CHART_GLUE.layerLeadFactor;
    default:
      return 0;
  }
}

export function planLecture(
  lecture: Lecture,
  d: DurationConstants,
  stage?: StagePlanInput,
): StepPlan[] {
  const plans: StepPlan[] = [];
  let prev: "none" | "heading" | "rule" | "other" = "none";

  for (const { ref, step } of flattenSteps(lecture)) {
    // Bad steps, v1-unperformable steps (html — no factory, no beat; see
    // planStepUnits) and the opening `@board` stage direction
    // (pure configuration — zero time, zero space) are skipped and
    // gap-transparent: their blast radius is zero seconds.
    if (
      step.kind === "bad" ||
      step.kind === "html" ||
      step.kind === "board-config"
    ) {
      continue;
    }
    // The lecture-notes projection (板 ≠ 笔记): camera, erase, turn and
    // PLACEMENT steps plan to nothing — same Lecture, linear
    // nothing-ever-lost timeline (a turn is a room action like the
    // eraser, §7.6-Q4; so is a walk to a region — the notes are a
    // DOCUMENT projection, and a document has no wall to place on. That
    // is also what keeps the notes view the migration control group,
    // design §8/§12.2-1).
    if (
      stage?.omitStageSteps &&
      (step.kind === "camera" ||
        step.kind === "erase" ||
        step.kind === "turn" ||
        step.kind === "at")
    ) {
      continue;
    }
    if (step.kind === "wait") {
      plans.push({ ref, step, leadIn: step.seconds ?? d.paraGap, units: [] });
      continue;
    }
    const base =
      prev === "none"
        ? 0
        : prev === "other"
          ? d.paraGap
          : d.paraGap * HEADING_GAP_MULT;
    const lead = containerLead(step, d);
    // NO SYNTHESIZED ERASE (canvas pivot V2, design §2.3 — 2026-08-11).
    // C3 prepended an erase unit here for the content step whose arrival
    // forced the room to wipe the earliest-filled board. That physics is
    // gone: a full wall is where the room STOPS DECIDING, so every erase
    // unit on the canonical timeline now belongs to an `@erase` an author
    // wrote, and plans exactly like the step it is. The absence is
    // structural — there is no branch left that could synthesize one.
    const units = planStepUnits(step, d);
    plans.push({ ref, step, leadIn: base + lead, units });
    prev =
      step.kind === "heading" ? "heading" : step.kind === "rule" ? "rule" : "other";
  }
  return plans;
}

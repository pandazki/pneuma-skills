/**
 * Graph factories (T12) — structure on the board: boxes, the words inside
 * them, and the arrows between them.
 *
 * A graph is the chart's sibling, not a second system: a named accumulating
 * container (§4.4, engine/container.ts). The frame factory draws the nodes
 * and arrows its own block introduced; a later same-name block resolves the
 * frame through `MeasureContext.container` and draws INTO its svg — time
 * moves with the document, space returns to the container's home.
 *
 * The one thing a graph cannot borrow from a chart is the coordinate
 * system. A chart's author declares it (`x: 2023Q1 .. 2024Q4`), which is
 * exactly what keeps a later layer from moving what is already drawn. A
 * graph's is computed, so the same guarantee is bought differently:
 * `graphLayout(frame)` is a pure function of the frame — and the frame
 * carries the whole container's union (`GraphLayoutSpec`, filled in by the
 * parser) — so every block of a container lays out against ONE geometry and
 * a later block only ever adds ink.
 *
 * Layering: this is the RENDER layer. It is the second and last file in the
 * engine allowed an external import — `@dagrejs/dagre` here, `katex` in
 * `factories/math.ts` (G2 exception list; the grep gate in
 * `__tests__/reveal.test.ts` enforces exactly these two).
 *
 * Hard rules carried here:
 *  - G1 — box, then the name inside it, per node; every arrow last. One pen.
 *  - G8-D — every color goes through `element.style` (enforced by `el`).
 *  - Determinism — dagre's stability is a TEST GATE, not an assumption
 *    (`__tests__/graph.test.ts`); all jitter rides the seeded PRNG.
 */

import dagre from "@dagrejs/dagre";

import { containerKey } from "../container.js";
import { Ease } from "../easing.js";
import { planStepUnits, type UnitPlan } from "../inference.js";
import { BOARD_BODY_FS, BOARD_H2_FS } from "../layout.js";
import { jitterArrow, jitterRect, mulberry32, type Rand } from "../sketch/index.js";
import { strokeReveal } from "../strategies/stroke.js";
import { clipWipe } from "../strategies/wipe.js";
import type {
  GraphEdge,
  GraphFrameStep,
  GraphLayerStep,
  GraphLayoutSpec,
  GraphNode,
  GraphNoteWrite,
  MeasureContext,
  Revealable,
  RevealableFactory,
} from "../types.js";
import { contentSeed, el, inertRevealable, type StyledElement } from "./svg.js";

// ── Geometry constants (BOARD px — the viewBox is board px) ─────────────────
//
// Every number here is a ratio of `BOARD_BODY_FS`, and that is the whole
// point of the file's units: the viewBox is board px, so a graph laid out
// at its natural size draws its names at exactly the size the prose beside
// it is written in. The first T12 pass hardcoded 24/16 against nothing —
// 0.71 and 0.47 of a 34px board — and the explanation ended up smaller
// than the board's quietest voice (the 27px aside) inside its loudest
// element. A figure factory does not get to invent its own type scale.

/** A box's name is written in the board's own hand. */
const NAME_FS = BOARD_BODY_FS;
/** Its explanation, two thirds of that — the ratio the first pass shipped
 *  (16/24) and the one that keeps a `名字: 说明` row reading as an
 *  annotation rather than a second name. */
const NOTE_FS = Math.round((NAME_FS * 2) / 3);
/** Breathing room inside the box, in fractions of the hand that writes in
 *  it (the previous pass's 18/24 and 14/24, kept). */
const PAD_X = Math.round(NAME_FS * 0.75);
const PAD_Y = Math.round(NAME_FS * 0.58);
/** Tighter leading than the board's 1.5: a label is one or two lines in a
 *  box, not a paragraph between ruled lines. */
const NAME_LH = Math.round(NAME_FS * 1.25);
const NOTE_LH = Math.round(NOTE_FS * 1.31);
/** A box is at least four glyphs of its own name wide … */
const MIN_W = NAME_FS * 4;
/** … and at most eleven, past which a box has become a paragraph and the
 *  reference file's answer is narration, not a wider box. */
const MAX_W = NAME_FS * 11;
/** The gap between boxes stacked in one rank: one written line. */
const NODE_SEP = NAME_LH;
/** The corridor between ranks — three glyphs of arrow. */
const RANK_SEP = NAME_FS * 3;
/** The canvas margin around the drawing. */
const MARGIN = Math.round(NAME_FS / 4);

/**
 * How far a graph may be MAGNIFIED to fill the region it was given.
 *
 * The svg wears `width: 100%` like a chart's, so the region decides the
 * drawn width and the rendered hand is `NAME_FS × region / layout` — a
 * pure ratio, content-determined and unbounded above. Left alone, a
 * two-box graph on a full face would write its names at ~98px, half again
 * the board's own h1. So the growth stops where the board's type scale
 * does: at full stretch a box name is exactly a section title (h2) and
 * never louder than the headings it sits between.
 *
 * The other direction needs no constant — a graph wider than its region
 * shrinks to fit, because `width: 100%` already says so, and a figure
 * pushed past the face's edge is the one failure the board does not
 * tolerate.
 */
const MAX_GROW = BOARD_H2_FS / NAME_FS;

/**
 * The widest the shell will let a figure be drawn (board px).
 *
 * ONE expression, called by the factory that writes the style and by the
 * flow-height mirror that has to predict it. They were separate arithmetic
 * before and agreed only because both said "the natural width"; the moment
 * the shell could grow, a mirror that had not been told would under-charge
 * every figure that filled its room and leave the column cursor beneath it
 * wrong by half a face.
 */
export function graphFillWidth(layout: GraphLayout): number {
  return Math.round(layout.width * MAX_GROW);
}

const HAND_FONT = "var(--hand, cursive)";
const BOARD_FG = "var(--board-fg, currentColor)";
const NOTE_FG = "var(--accent, currentColor)";

// ── Pure layout (no DOM — the determinism gate runs it in plain Bun) ────────

export interface GraphBox {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** The name line, then the wrapped explanation lines (may be empty). */
  noteLines: string[];
}

export interface GraphLayout {
  width: number;
  height: number;
  boxes: Map<string, GraphBox>;
  /** Each edge's drawn route, keyed by `arrowKey` — see `graphLayout`. */
  arrows: Map<string, Array<[number, number]>>;
}

/** The route key for an edge. Same shape the parser dedupes edges by. */
export function arrowKey(from: string, to: string): string {
  return `${from} ${to}`;
}

/**
 * Text width WITHOUT a DOM: CJK glyphs are square, Latin averages ~0.55em.
 *
 * Deliberate: the feasibility ruling keeps dagre (and therefore layout) in
 * the factory layer, and a measured layout would make the determinism gate
 * unrunnable outside a browser and re-flow every board when a font falls
 * back (G8-A). An estimate that is stable everywhere beats a measurement
 * that is exact in one host — a box is padded on both sides anyway.
 */
const CJK_GLYPH = /[　-〿぀-ヿ一-鿿＀-￯]/;

function textWidth(text: string, fontSize: number): number {
  let w = 0;
  for (const ch of text) {
    w += CJK_GLYPH.test(ch) ? fontSize : fontSize * 0.55;
  }
  return w;
}

/**
 * What the explanation may be broken between: a CJK glyph breaks anywhere,
 * a Latin/number token never splits (the first G7 pass wrapped "step" into
 * "ste" + "p", which reads as a rendering fault, not as a line break).
 */
function noteChunks(note: string): string[] {
  const out: string[] = [];
  let latin = "";
  const flush = (): void => {
    if (latin !== "") out.push(latin);
    latin = "";
  };
  for (const ch of note) {
    if (/\s/.test(ch)) {
      flush();
      out.push(" ");
    } else if (CJK_GLYPH.test(ch)) {
      flush();
      out.push(ch);
    } else {
      latin += ch;
    }
  }
  flush();
  return out;
}

/**
 * Greedy wrap of the explanation into the box's inner width.
 *
 * EVERY line is kept. A three-line budget used to cut the rest and return,
 * and the cut had no channel at all: the row parsed, no beat was degraded,
 * no badge appeared, no finding was raised — a prefix of what the author
 * wrote reached the board and the missing half was findable only by
 * counting glyphs on a photograph of it. The board is not allowed to
 * quietly edit the lecture.
 *
 * The consequence of a long note is now the one a board has: the box grows
 * to hold it, in front of the author, and a graph whose boxes have swollen
 * into paragraphs is telling them exactly what the reference file already
 * says — "a box is a box; if a node needs real explanation, that is
 * narration's job". A visible box beats an invisible truncation, and it
 * costs no new report channel to say it.
 */
function wrapNote(note: string, innerWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const chunk of noteChunks(note)) {
    if (line === "" && chunk === " ") continue;
    const next = line + chunk;
    // Half a pixel of float drift is not a line break: the box was sized
    // from this very measurement, so an exact fit must stay one line.
    if (line !== "" && textWidth(next, NOTE_FS) > innerWidth + 0.5) {
      lines.push(line.trimEnd());
      line = chunk === " " ? "" : chunk;
    } else {
      line = next;
    }
  }
  if (line.trimEnd() !== "") lines.push(line.trimEnd());
  return lines;
}

/**
 * One node's box size + the lines written into it.
 *
 * An explanation widens the box before it wraps: sized on the name alone, a
 * two-character name gives a ~60px column and a one-clause note breaks into
 * three cramped lines (seen in the first G7 pass). A box on a board is as
 * wide as what is written in it.
 */
function boxShape(node: GraphNode): { w: number; h: number; noteLines: string[] } {
  const want = Math.max(
    textWidth(node.name, NAME_FS),
    node.note ? textWidth(node.note, NOTE_FS) : 0,
  );
  const w = Math.round(Math.min(MAX_W, Math.max(MIN_W, want + PAD_X * 2)));
  const noteLines = node.note ? wrapNote(node.note, w - PAD_X * 2) : [];
  const h = Math.round(PAD_Y * 2 + NAME_LH + noteLines.length * NOTE_LH);
  return { w, h, noteLines };
}

/** Layouts are pure but not cheap; memoize per union (frames + their layers). */
const LAYOUT_CACHE = new WeakMap<GraphLayoutSpec, GraphLayout>();

/** Round to 0.01px — float noise must never masquerade as a layout change. */
const round = (v: number): number => Math.round(v * 100) / 100;

/**
 * The container's layout — the exact analogue of `chartScales(frame)`: a
 * pure function of the frame, so the frame and every one of its layers
 * compute the identical geometry and nothing on the board ever moves.
 *
 * dagre is fed from ARRAYS in document order (never object keys), which is
 * what makes the byte-identical determinism test in `graph.test.ts` a gate
 * rather than a hope.
 */
export function graphLayout(frame: GraphFrameStep): GraphLayout {
  const spec = frame.layout;
  const cached = LAYOUT_CACHE.get(spec);
  if (cached) return cached;

  const g = new dagre.graphlib.Graph({ directed: true });
  g.setGraph({
    rankdir: "LR",
    nodesep: NODE_SEP,
    ranksep: RANK_SEP,
    marginx: MARGIN,
    marginy: MARGIN,
  });
  g.setDefaultEdgeLabel(() => ({}));
  const shapes = new Map<string, { w: number; h: number; noteLines: string[] }>();
  for (const node of spec.nodes) {
    const shape = boxShape(node);
    shapes.set(node.name, shape);
    g.setNode(node.name, { width: shape.w, height: shape.h });
  }
  for (const edge of spec.edges) {
    // An edge naming a node that never appears cannot happen (the parser
    // introduces a node the moment it is written), but dagre would throw on
    // one — a guard is cheaper than a board that fails to draw.
    if (shapes.has(edge.from) && shapes.has(edge.to)) g.setEdge(edge.from, edge.to);
  }
  dagre.layout(g);

  const boxes = new Map<string, GraphBox>();
  for (const node of spec.nodes) {
    const shape = shapes.get(node.name)!;
    const placed = g.node(node.name);
    boxes.set(node.name, {
      name: node.name,
      x: round(placed.x - shape.w / 2),
      y: round(placed.y - shape.h / 2),
      w: shape.w,
      h: shape.h,
      noteLines: shape.noteLines,
    });
  }
  // Routes. dagre reserves a corridor for every edge that skips a rank, so
  // its own points are what keep the arrow out of the boxes in between (a
  // straight centre-to-centre line does not: measured, a→d over b, c cut
  // straight through b). Both ends are then clipped to their box's border,
  // so the tip lands ON the target however the middle bends.
  const arrows = new Map<string, Array<[number, number]>>();
  for (const edge of spec.edges) {
    const from = boxes.get(edge.from);
    const to = boxes.get(edge.to);
    if (!from || !to) continue;
    const key = arrowKey(edge.from, edge.to);
    if (arrows.has(key)) continue;
    const mid: Array<[number, number]> = (
      g.edge(edge.from, edge.to)?.points ?? []
    )
      .slice(1, -1)
      .map((p): [number, number] => [round(p.x), round(p.y)]);
    const head = mid[0] ?? [to.x + to.w / 2, to.y + to.h / 2];
    const tail = mid[mid.length - 1] ?? [from.x + from.w / 2, from.y + from.h / 2];
    arrows.set(key, [
      boundaryPoint(from, head[0], head[1]),
      ...mid,
      boundaryPoint(to, tail[0], tail[1]),
    ]);
  }

  const graph = g.graph();
  const layout: GraphLayout = {
    width: round(Math.max(graph.width ?? 0, 1)),
    height: round(Math.max(graph.height ?? 0, 1)),
    boxes,
    arrows,
  };
  LAYOUT_CACHE.set(spec, layout);
  return layout;
}

/** One block's contribution to a container, for the prefix re-measurement
 *  below: its first-mention nodes/edges (off the step) and the note rows
 *  it wrote (recovered by `domain.ts::graphNoteWrites` — notes mutate the
 *  union in place and must not become step fields, or the canonical plan
 *  serialization the [8] degenerate-hash gate pins would move). */
export interface GraphPrefixBlock {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  notes: readonly GraphNoteWrite[];
}

/**
 * The container's SVG flow heights at every block PREFIX — the
 * measurement behind `LayoutStepInput.growth` (2026-08-10 review P1-2).
 * `blocks` is the frame first, then its layers in document order; entry k
 * of the result is the frame node's flow height with only blocks 0..k
 * standing, so layer k's growth is `heights[k + 1] − heights[k]`.
 *
 * Arithmetic mirror of the factory's shell: the SVG wears `width: 100%`
 * and `max-width: graphFillWidth(layout)` with its viewBox aspect, so its
 * flow height is `layout.height` scaled by whatever width it ends up
 * drawn at — which now GROWS as well as shrinks, and is why both sides
 * call the one function rather than each writing the bound out. The
 * wrapper's margins cancel in the deltas, so they are deliberately absent.
 * Pure in (union, blocks, boxW) — the streamed and the cold compile derive
 * the same numbers from the same document (R8). `boxW = 0` means "no room
 * known" and answers with the union's own size: the snapshot basis folds
 * for membership, never geometry, and must not be handed a fabricated one.
 *
 * Prefix specs are REPLAYED, not sliced blind: the union's arrays are
 * append-only in document order (slices recover the node/edge sets), but
 * a `名字: 说明` row MUTATES its node's record in place, so each block's
 * note writes are re-applied in order — a note-only layer regrows the box
 * that holds it and must charge that growth too.
 */
export function graphPrefixFlowHeights(
  union: GraphLayoutSpec,
  blocks: readonly GraphPrefixBlock[],
  boxW: number,
): number[] {
  const heights: number[] = [];
  let nodeCount = 0;
  let edgeCount = 0;
  const noteAt = new Map<string, string>();
  for (const block of blocks) {
    nodeCount += block.nodes.length;
    edgeCount += block.edges.length;
    for (const write of block.notes) noteAt.set(write.name, write.note);
    const nodes = union.nodes.slice(0, nodeCount).map((n): GraphNode => {
      const note = noteAt.get(n.name);
      return note !== undefined
        ? { name: n.name, note, srcSpan: n.srcSpan }
        : { name: n.name, srcSpan: n.srcSpan };
    });
    const prefix: GraphFrameStep = {
      kind: "graph-frame",
      graph: "",
      nodes: [],
      edges: [],
      layout: { nodes, edges: union.edges.slice(0, edgeCount) },
      srcSpan: { start: 0, end: 0 },
    };
    const layout = graphLayout(prefix);
    const usedW =
      boxW > 0 ? Math.min(boxW, graphFillWidth(layout)) : layout.width;
    heights.push(
      usedW === layout.width
        ? layout.height
        : (layout.height * usedW) / layout.width,
    );
  }
  return heights;
}

/** The rect's boundary point along the ray from its centre towards (px, py). */
function boundaryPoint(
  box: GraphBox,
  px: number,
  py: number,
): [number, number] {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const dx = px - cx;
  const dy = py - cy;
  if (dx === 0 && dy === 0) return [cx, cy];
  // The ray leaves through whichever side it reaches first.
  const tx = dx === 0 ? Infinity : box.w / 2 / Math.abs(dx);
  const ty = dy === 0 ? Infinity : box.h / 2 / Math.abs(dy);
  const t = Math.min(tx, ty);
  return [round(cx + dx * t), round(cy + dy * t)];
}

/**
 * Where an arrow starts and ends: on the two boxes' boundaries, along the
 * line between their centres.
 *
 * This is what answers "does the arrow still point at the node's edge after
 * the jitter?" structurally rather than by inspection — the tip is ON the
 * target's boundary by construction (and `jitterArrow` puts no jitter on
 * the tip), so it can neither poke inside the box nor float short of it.
 */
export function arrowEndpoints(
  from: GraphBox,
  to: GraphBox,
): { x1: number; y1: number; x2: number; y2: number } {
  const fc: [number, number] = [from.x + from.w / 2, from.y + from.h / 2];
  const tc: [number, number] = [to.x + to.w / 2, to.y + to.h / 2];
  const [x1, y1] = boundaryPoint(from, tc[0], tc[1]);
  const [x2, y2] = boundaryPoint(to, fc[0], fc[1]);
  return { x1, y1, x2, y2 };
}

// ── Builders (1:1 with `planGraph`, inference.ts — the T2↔T3 seam) ──────────

type UnitBuilder = (unit: UnitPlan) => Revealable;

/**
 * The builders for one block's own nodes and edges. Mirrors `planGraph`
 * EXACTLY: box → name per node, then every arrow.
 *
 * `ownerTag` (layer builds only): everything appended into the FRAME's svg
 * is stamped, so a same-content rebuild clears its own previous
 * contribution first — the chart layer's idempotence trick, unchanged.
 */
function graphBuilders(
  doc: Document,
  svg: StyledElement,
  layout: GraphLayout,
  nodes: readonly GraphNode[],
  edges: ReadonlyArray<{ from: string; to: string }>,
  rnd: Rand,
  ownerTag?: string,
): UnitBuilder[] {
  const builders: UnitBuilder[] = [];
  const mount = <T extends Element>(node: T): T => {
    if (ownerTag !== undefined) node.setAttribute("data-bansho-graph-owner", ownerTag);
    svg.appendChild(node);
    return node;
  };

  for (const node of nodes) {
    const box = layout.boxes.get(node.name);
    builders.push((unit) => {
      if (!box) return missing(unit, node.name);
      // G9 立骨架 — a frame goes up with the hesitate-then-pull pen.
      const path = el(doc, "path", { d: jitterRect(box.x, box.y, box.w, box.h, rnd) }, {
        fill: "none",
        stroke: BOARD_FG,
        strokeWidth: "2.4px",
        strokeLinecap: "round",
        strokeLinejoin: "round",
      });
      path.setAttribute("data-bansho-graph-node", node.name);
      mount(path);
      return strokeReveal([{ path, length: (box.w + box.h) * 2 }], {
        duration: unit.duration,
        srcSpan: unit.srcSpan,
        ease: Ease.steady,
      });
    });
    builders.push((unit) => {
      if (!box) return missing(unit, node.name);
      const lines = box.noteLines;
      const cx = round(box.x + box.w / 2);
      // The block of text is centred in the box: name line, then the
      // explanation under it.
      const top = round(
        box.y + (box.h - (NAME_LH + lines.length * NOTE_LH)) / 2 + NAME_FS * 0.82,
      );
      const text = el(
        doc,
        "text",
        { x: cx, y: top, "text-anchor": "middle", "font-size": NAME_FS },
        { fill: BOARD_FG, fontFamily: HAND_FONT },
      );
      const nameSpan = el(doc, "tspan", { x: cx });
      nameSpan.textContent = node.name;
      text.appendChild(nameSpan);
      for (const line of lines) {
        const span = el(doc, "tspan", { x: cx, dy: NOTE_LH, "font-size": NOTE_FS });
        span.style.fill = NOTE_FG;
        span.textContent = line;
        text.appendChild(span);
      }
      mount(text);
      return clipWipe(text, {
        duration: unit.duration,
        srcSpan: unit.srcSpan,
        ease: Ease.write,
        opacityRamp: 2.4,
      });
    });
  }

  for (const edge of edges) {
    builders.push((unit) => {
      const from = layout.boxes.get(edge.from);
      const to = layout.boxes.get(edge.to);
      if (!from || !to) return missing(unit, `${edge.from} → ${edge.to}`);
      const route =
        layout.arrows.get(arrowKey(edge.from, edge.to)) ??
        (({ x1, y1, x2, y2 }) => [
          [x1, y1] as [number, number],
          [x2, y2] as [number, number],
        ])(arrowEndpoints(from, to));
      const path = el(doc, "path", { d: jitterArrow(route, rnd) }, {
        fill: "none",
        stroke: BOARD_FG,
        strokeWidth: "2.2px",
        strokeLinecap: "round",
        strokeLinejoin: "round",
      });
      path.setAttribute("data-bansho-graph-edge", `${edge.from} → ${edge.to}`);
      mount(path);
      let travel = 26;
      for (let i = 1; i < route.length; i++) {
        travel += Math.hypot(
          route[i]![0] - route[i - 1]![0],
          route[i]![1] - route[i - 1]![1],
        );
      }
      return strokeReveal([{ path, length: travel }], {
        duration: unit.duration,
        srcSpan: unit.srcSpan,
        ease: Ease.write,
      });
    });
  }
  return builders;
}

/** A unit whose geometry the layout does not carry — degrade loudly (R5). */
function missing(unit: UnitPlan, what: string): Revealable {
  console.warn(
    `[bansho] graph: "${what}" has no place in the container's layout — ` +
      `degrading to an inert beat`,
  );
  return inertRevealable(unit);
}

/** Run builders against the plan 1:1, padding mismatches inertly. */
function materialize(
  units: UnitPlan[],
  builders: UnitBuilder[],
  what: string,
): Revealable[] {
  if (builders.length !== units.length) {
    console.warn(
      `[bansho] ${what}: plan has ${units.length} units but the factory ` +
        `built ${builders.length} — padding with inert units`,
    );
  }
  return units.map((unit, i) => builders[i]?.(unit) ?? inertRevealable(unit));
}

export const graphFrameFactory: RevealableFactory = {
  kind: "graph-frame",
  build(step, ctx) {
    const doc = ctx.document;
    const node = doc.createElement("div");
    node.className = "bansho-graph";
    const units = planStepUnits(step, ctx.durations);
    if (step.kind !== "graph-frame") {
      return { node, revealables: units.map(inertRevealable) };
    }
    const layout = graphLayout(step);
    const svg = el(doc, "svg", {
      viewBox: `0 0 ${layout.width} ${layout.height}`,
    });
    svg.style.display = "block";
    svg.style.width = "100%";
    // The canvas is sized by the CONTAINER's union, so the board never
    // reflows when a later block lands. The limit is a GROWTH ceiling, not
    // the natural width: a chart fills the face it was given, and a graph
    // is the same kind of centrepiece — the pair of them used to sit side
    // by side with the chart across the whole face and the graph at 64% of
    // it, for no reason but this one line.
    svg.style.maxWidth = `${graphFillWidth(layout)}px`;
    svg.style.overflow = "visible";
    node.appendChild(svg);

    const rnd = mulberry32(contentSeed(step));
    const builders = graphBuilders(
      doc,
      svg,
      layout,
      step.nodes,
      step.edges,
      rnd,
    );
    return {
      node,
      revealables: materialize(units, builders, `graph "${step.graph}" frame`),
    };
  },
};

/**
 * Rebuild semantics — identical to `chartLayerFactory` (the layer MUTATES
 * the frame's node, so `build` is not freely repeatable): a same-content
 * rebuild clears its own stamped contribution first; a changed-content
 * rebuild relies on the host's container cascade (see
 * `MeasureContext.container`). A graph adds one case the chart does not
 * have: appending a block changes the container's UNION, which the frame
 * owns, so the cascade fires on append too (`frameOwnsUnion`,
 * engine/container.ts).
 */
export const graphLayerFactory: RevealableFactory = {
  kind: "graph-layer",
  build(step, ctx: MeasureContext) {
    const doc = ctx.document;
    // A layer occupies no space of its own — space returns to the
    // container's home; the marker keeps document flow (and the host's step
    // anchors) intact without painting anything.
    const node = doc.createElement("div") as StyledElement;
    node.className = "bansho-graph-layer";
    node.style.display = "none";

    const units = planStepUnits(step, ctx.durations);
    if (step.kind !== "graph-layer") {
      return { node, revealables: units.map(inertRevealable) };
    }
    const home = ctx.container(containerKey("graph", step.graph));
    const frame = home?.frame.kind === "graph-frame" ? home.frame : undefined;
    const svg = home?.node.querySelector("svg") as StyledElement | null;
    if (!frame || !svg) {
      // Host bookkeeping gap (an orphan layer cannot exist — the first
      // block of a name IS the frame) — degrade, loudly, never throw.
      console.warn(
        `[bansho] graph layer "${step.graph}" found no frame node — ` +
          `rendering nothing for ${units.length} unit(s)`,
      );
      return { node, revealables: units.map(inertRevealable) };
    }
    const seed = contentSeed(step);
    const ownerTag = String(seed);
    for (const stale of Array.from(
      svg.querySelectorAll(`[data-bansho-graph-owner="${ownerTag}"]`),
    )) {
      stale.remove();
    }
    const builders = graphBuilders(
      doc,
      svg,
      graphLayout(frame),
      step.nodes,
      step.edges,
      mulberry32(seed),
      ownerTag,
    );
    return {
      node,
      revealables: materialize(units, builders, `graph "${step.graph}" layer`),
    };
  },
};

/**
 * Bansho engine core types — the contract every other bansho layer builds on.
 *
 * Layering discipline (design §6.1, hard rule G2): this file imports NOTHING
 * but its own layer — one type-only edge to `engine/regions.ts`, so the
 * placement verb's region word is the closed vocabulary itself rather than a
 * restated `string` union that could drift from it. The engine core (types /
 * regions / inference / duration / timeline / strategies / sketch) never
 * imports React, never imports `src/`, never holds a rAF loop.
 * DOM types used below (`Element`, `Document`) are ambient lib types only —
 * the engine builds and measures nodes but the clock lives in the host
 * (`viewer/useBoardPlayer.ts`).
 *
 * Two vocabularies meet here:
 *
 *  - the LECTURE model (`Lecture` / `Section` / `Step` / `InlineRun`) — the
 *    parsed board.md dialect, produced by `modes/bansho/domain.ts` (pure);
 *  - the REVEAL model (`Revealable` / `RevealableFactory` / `BoardTimeline`)
 *    — how the engine performs the lecture, one pen stroke at a time.
 *
 * Single-pen invariant (product-defining, G1): on the canonical timeline at
 * most ONE reveal unit is in progress at any instant. There is no syntax in
 * the dialect that can express simultaneity, and `BoardTimeline.schedule`
 * intervals are pairwise non-overlapping by construction.
 */

import type { RegionName } from "./regions.js";

// ────────────────────────────────────────────────────────────────────────────
// Source spans (G6 — 100% srcSpan coverage)
// ────────────────────────────────────────────────────────────────────────────

/**
 * A precise half-open character range `[start, end)` into the board.md
 * source. Every reveal-capable unit — every step, every inline run, and
 * every individual row inside a chart block — carries one, so the viewer
 * can highlight exactly the source line/segment being performed. A single
 * shared span per chart block was tried in the prototype and rejected
 * (whole-block highlight carries zero information).
 */
export interface SrcSpan {
  start: number;
  end: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Inline dialect (runs inside prose / list items / asides / headings)
// ────────────────────────────────────────────────────────────────────────────

/**
 * The shared ink-action vocabulary. Inline marks and stand-alone back
 * references (`@strike "…"` …) use the same verb set on purpose — an
 * in-place strike and a look-back strike are the same pen gesture.
 */
export type InkAction = "highlight" | "underline" | "circle" | "strike";

/**
 * One inline run of a text-bearing step.
 *
 * Span conventions:
 *  - `srcSpan` always covers the FULL construct including delimiters
 *    (`==三倍==`, `$E=mc^2$`).
 *  - `textSpan` (where present) covers only the inner text, so downstream
 *    reveal-unit splitting (inference I9: CJK in 1–2 char segments, Latin by
 *    word) can derive a precise srcSpan for every sub-unit by plain offset
 *    arithmetic — `text` is byte-for-byte the source slice at `textSpan`.
 *  - plain `"text"` runs need no `textSpan`: their `srcSpan` IS the text.
 *  - `"break"` marks a soft line break inside a merged paragraph; renderers
 *    decide its visual form (space vs nothing for CJK seams). It contributes
 *    a single space to `stepPlainText` (engine/text.ts).
 *
 * Nesting (ink runs only): a known mark nested inside an ink run
 * (`==重要的 **结构性** 变化==`) is tokenized recursively into `children`.
 * PRECEDENCE RULE — when `children` is present, consumers (factories,
 * `stepPlainText`) MUST render/measure from `children` and treat `text` as
 * the raw inner source slice, delimiters included (the byte-for-byte
 * `textSpan` invariant above still holds: `text` IS the slice at
 * `textSpan`, and every child run carries its own absolute `srcSpan` /
 * `textSpan` into the same source, so I9 sub-unit splitting stays plain
 * offset arithmetic per child). `children` is omitted when the inner text
 * is a single plain-text run — the flat common case stays flat.
 *
 * Residual v1 boundary (deliberate, §4.6 honest-boundary style): the inner
 * text of `em` and `term` runs stays OPAQUE — only the ink variant recurses.
 */
export type InlineRun =
  | { kind: "text"; text: string; srcSpan: SrcSpan }
  | { kind: "break"; srcSpan: SrcSpan }
  | { kind: "em"; text: string; srcSpan: SrcSpan; textSpan: SrcSpan }
  | { kind: "term"; text: string; srcSpan: SrcSpan; textSpan: SrcSpan }
  | {
      kind: "ink";
      action: InkAction;
      text: string;
      srcSpan: SrcSpan;
      textSpan: SrcSpan;
      children?: InlineRun[];
    }
  | { kind: "math"; tex: string; srcSpan: SrcSpan; textSpan: SrcSpan };

// ────────────────────────────────────────────────────────────────────────────
// Chart model (named accumulating containers, §4.4)
// ────────────────────────────────────────────────────────────────────────────

/** v1 renders "line" only; "bar" is parsed and reserved (design §4.6). */
export type ChartType = "line" | "bar";

/**
 * One axis declaration inside a chart frame. Either a range (`from`/`to`,
 * written `A .. B`) or an enumeration (`values`), with an optional trailing
 * `(unit)`. Values stay strings — the axis may be categorical ("2023Q1");
 * numeric coercion is the chart factory's concern.
 */
export interface ChartAxis {
  from?: string;
  to?: string;
  values?: string[];
  unit?: string;
  /** The `x:` / `y:` source row — per-row highlight target (G6). */
  srcSpan: SrcSpan;
}

/**
 * One `+` row of a chart block. Every row carries its own srcSpan: when the
 * NVIDIA line is being drawn, exactly the `+ NVIDIA: …` source row lights up.
 */
export type ChartLayerRow =
  | { kind: "series"; name: string; values: number[]; srcSpan: SrcSpan }
  | { kind: "mark"; series: string; x: string; text: string; srcSpan: SrcSpan }
  | { kind: "note"; x: string; y: string; text: string; srcSpan: SrcSpan };

// ────────────────────────────────────────────────────────────────────────────
// Graph model (the chart's sibling — the second named container, §4.4)
// ────────────────────────────────────────────────────────────────────────────

/**
 * One node of a ```graph``` block. IDENTITY IS THE NAME: the same name
 * written twice, in the same block or a later one, is the same node —
 * exactly the rule that makes a chain line (`讲稿 → 推断 → 播放`) build a
 * structure instead of a list.
 */
export interface GraphNode {
  name: string;
  /**
   * The optional one-line explanation from a `名字: 说明` row, written into
   * the box under the name. Carried on the CONTAINER's union record (see
   * `GraphLayoutSpec`); a block's own `nodes[]` records omit it — they
   * exist to say which node this block reveals, not what it says.
   */
  note?: string;
  /** First-appearance source range — the name token itself (G6). */
  srcSpan: SrcSpan;
}

/** One arrow. First appearance owns it; a repeat draws nothing. */
export interface GraphEdge {
  from: string;
  to: string;
  /** The `A → B` segment of the source line that drew it (G6). */
  srcSpan: SrcSpan;
}

/**
 * One `名字: 说明` row as written by ONE block. The note itself lives on
 * the container's union record (last write wins — see `GraphNode.note`),
 * but a note also REGROWS the box that holds it, so the prefix
 * re-measurement behind `LayoutStepInput.growth` must know which block
 * wrote which note when. Recovered per block by re-scanning the block's
 * own source (`domain.ts::graphNoteWrites`) — deliberately NOT a field on
 * the step: the canonical plan serializes whole steps, and the [8]
 * degenerate-hash gate pins that serialization byte for byte.
 */
export interface GraphNoteWrite {
  /** The node the row explains. */
  name: string;
  note: string;
}

/**
 * The whole container's accumulated node/edge union, in first-appearance
 * document order — the LAYOUT AUTHORITY.
 *
 * A chart's author declares the coordinate system up front (`x: … .. …`),
 * which is what lets a later layer draw into it without the space jumping.
 * A graph's layout is computed, so the equivalent guarantee has to come
 * from somewhere else: the frame carries the union of every same-name
 * block, the layout is a pure function of the frame (`graphLayout`, the
 * exact analogue of `chartScales`), and a later block therefore only ever
 * ADDS ink — it never moves what is already drawn. The parser fills this in
 * as it scans; a streaming append changes the frame, so the host rebuilds
 * the whole container (see `MeasureContext.container`).
 */
export interface GraphLayoutSpec {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** First ```graph <name>``` block for a name — the container's declaration. */
export interface GraphFrameStep {
  kind: "graph-frame";
  graph: string;
  /** Nodes this block is the first to mention — the ones it draws. */
  nodes: GraphNode[];
  /** Edges this block is the first to draw. */
  edges: GraphEdge[];
  /** The container's accumulated union (see `GraphLayoutSpec`). */
  layout: GraphLayoutSpec;
  srcSpan: SrcSpan;
}

/** A later ```graph <name>``` block — accumulates into the frame's canvas. */
export interface GraphLayerStep {
  kind: "graph-layer";
  graph: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  srcSpan: SrcSpan;
}

// ────────────────────────────────────────────────────────────────────────────
// Steps — the unit of explanation, address, and scheduling
// ────────────────────────────────────────────────────────────────────────────

/** `#` / `##` — establishes the topic / turns the section. */
export interface HeadingStep {
  kind: "heading";
  level: 1 | 2;
  inline: InlineRun[];
  srcSpan: SrcSpan;
}

/** A paragraph — one narrated step, possibly spanning soft-wrapped lines. */
export interface ProseStep {
  kind: "prose";
  inline: InlineRun[];
  srcSpan: SrcSpan;
}

/**
 * Column-alignment annotation for a list item (§4.3 并列对齐 — zero new
 * syntax). Consecutive list items whose FIRST separator is of the same type
 * form a group; the renderer aligns label/value columns per group.
 */
export interface AlignInfo {
  /** Lecture-wide group id; items sharing an id align together. */
  group: number;
  /** "colon" = `:` or `：`; "dash" = ` — ` (spaced em-dash). */
  sep: "colon" | "dash";
  /**
   * Offset of the separator RUN's first char in this step's
   * `stepPlainText` (engine/text.ts) — per-variant convention:
   *  - "colon": `plain[at]` IS the colon; the run is 1 char
   *    (label = `slice(0, at)`, value = `slice(at + 1)`).
   *  - "dash": `plain[at]` is the LEADING SPACE of ` — `; the run is
   *    3 chars (label = `slice(0, at)`, value = `slice(at + 3)`).
   * A renderer must branch on `sep` for the run length; both cases are
   * pinned in domain.test.ts (§4.3 alignment groups).
   */
  at: number;
}

/** `- 条目` — one list item per step (items reveal one by one). */
export interface ListItemStep {
  kind: "list-item";
  inline: InlineRun[];
  align?: AlignInfo;
  srcSpan: SrcSpan;
}

/** `> 旁注` — an aside; consecutive quote lines merge into one step. */
export interface AsideStep {
  kind: "aside";
  inline: InlineRun[];
  srcSpan: SrcSpan;
}

/** `---` — a hand-drawn horizontal rule; a breath in the lecture. */
export interface RuleStep {
  kind: "rule";
  srcSpan: SrcSpan;
}

/**
 * First ```chart <name>``` block for a name — establishes the frame (axes,
 * ticks, grid). May already carry layer rows in the same block.
 */
export interface ChartFrameStep {
  kind: "chart-frame";
  /** Container name; later same-name blocks accumulate into this chart. */
  chart: string;
  chartType: ChartType;
  x?: ChartAxis;
  y?: ChartAxis;
  rows: ChartLayerRow[];
  srcSpan: SrcSpan;
}

/**
 * A later ```chart <name>``` block — adds layers into the frame declared
 * earlier. Time moves with the document; space returns to the chart's home.
 */
export interface ChartLayerStep {
  kind: "chart-layer";
  chart: string;
  rows: ChartLayerRow[];
  srcSpan: SrcSpan;
}

/** `![alt](src)` on its own line. */
export interface ImageStep {
  kind: "image";
  src: string;
  alt: string;
  srcSpan: SrcSpan;
}

/**
 * ```html``` escape hatch. Stored raw — sanitization (no script / iframe /
 * event attributes) is the html factory's render-time duty, not the parser's.
 */
export interface HtmlStep {
  kind: "html";
  html: string;
  srcSpan: SrcSpan;
}

/** Block-level `$$…$$` math (KaTeX-parsed to MathML at render time). */
export interface MathStep {
  kind: "math";
  tex: string;
  srcSpan: SrcSpan;
}

/** `@wait [n]` escape hatch — an explicit extra beat (I7). */
export interface WaitStep {
  kind: "wait";
  seconds?: number;
  srcSpan: SrcSpan;
}

/**
 * `@board 2|3|4` — the lecture's opening stage direction (C3 面积配置):
 * how many boards the room has. MUST be the very first step of the
 * document (before any content block) and appears at most once —
 * anywhere else it parses to a BadStep. Absent = 1, the long-strip
 * degenerate configuration (今天的线性板). The count is CANONICAL input:
 * it feeds the panel-assignment fold, which feeds ink geometry and the
 * synthesized auto-erase units — which is exactly why it lives in
 * board.md and never in a viewer setting (rev 2 §5.1: a sidecar would
 * compile different canonical timelines from the same lecture, R8).
 */
export interface BoardConfigStep {
  kind: "board-config";
  count: 1 | 2 | 3 | 4;
  srcSpan: SrcSpan;
}

/**
 * `@erase` / `@erase "锚文本"` — the eraser (C3). Bare form erases the
 * board currently being written; the anchored form resolves its quoted
 * text nearest-upward (the `@strike` machinery) and erases the whole
 * board THAT step lives on. Granularity is deliberately the whole board
 * (rev 2 §2.3): "precisely negate one line" is `@strike`'s job, and
 * region-level erasing would drag free-space fragment management into
 * the assignment fold. NEVER takes a board number (rev 2 §1.4 — the
 * agent cannot know which board anything is on).
 *
 * G5 (new): erasing changes what the board SHOWS, never the canonical
 * timeline — scrub back before the erase and the content reappears; the
 * lecture-notes projection ignores erase steps entirely.
 */
export interface EraseStep {
  kind: "erase";
  /** Anchored form only: the quoted anchor text (explain surfaces). */
  targetText?: string;
  /** Anchored form only: the resolved anchor step (nearest-upward). */
  target?: StepRef;
  srcSpan: SrcSpan;
}

/**
 * `@turn` — the dialect family's third member (board-snapshot design §7.6):
 * "new topic, leave that board standing." A parameterless stage direction,
 * one line of its own, same family as `@erase`: it NEVER takes a board
 * number and never a coordinate (rev 2 §1.4 — the author cannot know
 * which board anything is on). Its semantic POSTCONDITION: the pen stands
 * before a clean board with everything previously written left standing.
 *
 *  - Pen already on a clean board (never used / just wiped) → the turn is
 *    spatially INERT: a one-beat breath, nothing moves.
 *  - Otherwise the target is `nextOverflowTarget` — the room's own
 *    three-tier overflow policy (fresh → wiped → erase the earliest-
 *    filled). On a full wall the turn erases — deliberately: expression
 *    must never fare worse than drifting into overflow (§7.6-Q1).
 *
 * The single long strip has no "next board", so `@turn` there is a
 * category error and parses to a BadStep (§7.6-Q3). Like erase, a turn is
 * NOT writing (P1-3 family): it never decays the camera register and adds
 * nothing to the overview union.
 */
export interface TurnStep {
  kind: "turn";
  srcSpan: SrcSpan;
}

/**
 * `@at <region>` / `@at <region> "锚文本"` — the canvas pivot's placement
 * verb (design §3, ruled 2026-08-11): the pen walks to a named region of a
 * board. The dialect's fourth stage direction, and the first one that lets
 * the author say WHERE.
 *
 * What it can say is a CLOSED vocabulary of words (`engine/regions.ts`):
 * nine on a bounded board, three on the strip. What it deliberately cannot
 * say (design §3.3): pixels, percentages, board numbers, line counts, "make
 * it fit", z-order, or "put it wherever there is room" — asking the room to
 * choose a position is exactly the physics the pivot deletes.
 *
 *  - **Bare** (`@at right`): the pen walks to that region of the CURRENT
 *    board. On a bounded board it RESUMES the region (writing continues at
 *    its cursor); on the strip every bare `@at` opens a NEW placement at the
 *    write front — the strip's places are episodic, because "put another
 *    figure on the right" means here, not eight hundred px above.
 *  - **Anchored** (`@at top-right "那个定义"`): the anchor resolves
 *    nearest-upward exactly like `@erase "…"`, and the pen walks to that
 *    step's region — the leg that reaches an earlier column to back-fill it,
 *    and the only way to resume a strip placement.
 *
 * Scope is PEN-SCOPED (design §3.4, decided A): everything after it lands in
 * that region until the next `@at` / `@turn` / the end of the document —
 * structurally the same thing `@turn` does one grain coarser.
 *
 * An anchor that resolves to nothing degrades to a `BadStep` +
 * `refUnresolved` and THE PEN DOES NOT MOVE (design §3.1) — the same posture
 * `@focus` takes. A word outside the face's vocabulary is a `BadStep` at
 * parse time whose message teaches the face's whole set.
 *
 * Camera classification is verbatim `@erase`/`@turn` (P1-3 family): a walk
 * is not writing, so a latched pose rides straight through its window. It
 * carries no revealable, is never voiced (a room action has no line), and
 * the lecture-notes projection ignores it (板 ≠ 笔记).
 */
export interface AtStep {
  kind: "at";
  /** The region word — always legal for this document's face (the parser
   *  refuses the rest before this type is ever minted). */
  region: RegionName;
  /** Anchored form only: the quoted anchor text (explain surfaces). */
  targetText?: string;
  /** Anchored form only: the resolved anchor step (nearest-upward). */
  target?: StepRef;
  srcSpan: SrcSpan;
}

/**
 * `@overview` / `@focus "锚文本"` — the director's camera verbs (C2 舞台指令).
 *
 * A camera move is one of the five exclusive stage actions (G1: 写、划、擦、
 * 移镜头、移板 — one pen, one axis): it holds its own schedule window and
 * nothing draws while the camera travels. It is NOT a `Revealable` — the
 * camera is a shared register (many steps write one value, last-wins,
 * order-dependent), so it can only be FOLDED (`engine/stage.ts::
 * stageStateAt`), never dispatched to by `makeSeek`; its schedule entries
 * ride the existing unpaired "dispatch nowhere" path.
 *
 * Dialect rules (rev 2 §1.4): the verbs anchor CONTENT, never a board
 * number and never a coordinate — `@focus` resolves its quoted anchor
 * nearest-upward exactly like `@strike` (an unresolvable anchor degrades
 * to a BadStep + `refUnresolved`, never reaches this type). `@overview`
 * takes no argument: it fits everything revealed SO FAR (scrub purity —
 * the camera is a function of t and cannot peek at the future).
 */
export interface CameraStep {
  kind: "camera";
  /** Which move: step back to all content shown so far, or go to an anchor. */
  op: "overview" | "focus";
  /** focus only: the quoted anchor text (kept for §9 explain surfaces). */
  targetText?: string;
  /** focus only: the resolved anchor step (nearest-upward, @strike machinery). */
  target?: StepRef;
  srcSpan: SrcSpan;
}

/**
 * Where a resolved back reference points: a character range inside the
 * target step's plain text (`stepPlainText`, engine/text.ts — the engine's
 * offset vocabulary), from which the renderer recovers the concrete DOM
 * range to ink over.
 */
export interface BackRefTarget {
  step: StepRef;
  start: number;
  end: number;
}

/**
 * A resolved stand-alone `@strike "…"` / `@circle` / `@highlight` /
 * `@underline` directive — the pen turns back to earlier writing. Target
 * resolution is nearest-upward exact substring match (within a single step,
 * never stitched across steps); an unresolvable directive never reaches this
 * type — it degrades to a `BadStep` plus a `refUnresolved` issue.
 */
export interface BackRefStep {
  kind: "backref";
  action: InkAction;
  targetText: string;
  target: BackRefTarget;
  srcSpan: SrcSpan;
}

/**
 * A step that failed to parse or resolve — the blast radius of a mistake is
 * exactly one step, never the board (R6). The viewer renders a small badge
 * at its position; the paired `ParseIssue` in `Lecture.errors` feeds the
 * agent's self-heal loop.
 */
export interface BadStep {
  kind: "bad";
  reason: string;
  raw: string;
  srcSpan: SrcSpan;
}

/**
 * One step of the lecture — the basic unit of protocol and address (§3).
 * There is deliberately NO step kind and NO field that expresses
 * simultaneity: `@with` / `@after` were removed with the parallel model and
 * parse to `BadStep` (G1).
 */
export type Step =
  | HeadingStep
  | ProseStep
  | ListItemStep
  | AsideStep
  | RuleStep
  | ChartFrameStep
  | ChartLayerStep
  | GraphFrameStep
  | GraphLayerStep
  | ImageStep
  | HtmlStep
  | MathStep
  | WaitStep
  | BoardConfigStep
  | EraseStep
  | TurnStep
  | AtStep
  | CameraStep
  | BackRefStep
  | BadStep;

// ────────────────────────────────────────────────────────────────────────────
// Lecture structure
// ────────────────────────────────────────────────────────────────────────────

/**
 * Stable engine-internal address of a step.
 *
 * `section` is 0-based; section 0 is the preamble (it always exists, possibly
 * empty, so section arithmetic never shifts). A document-opening `#` H1
 * becomes the preamble's heading; every OTHER heading — `##` anywhere, and
 * any `#` that is not the very first block — opens a new section.
 * `step` indexes `Section.steps`; `-1` addresses `Section.heading`.
 *
 * The user-facing ViewerAddress vocabulary (§8) presents steps 1-based;
 * that mapping is presentation-layer, not encoded here.
 */
export interface StepRef {
  section: number;
  step: number;
}

/** One `##` section (or the preamble). The heading is itself a step. */
export interface Section {
  heading?: HeadingStep;
  steps: Step[];
}

export type ParseIssueCode =
  | "stepParseError"
  | "refUnresolved"
  | "unsupportedStep";

/**
 * A block-isolated parse/resolve failure. Notification vocabulary matches
 * §9 (`stepParseError` / `refUnresolved`) so issues can flow straight into
 * viewer warnings without renaming. `unsupportedStep` is the warning class
 * for steps the model keeps but v1 cannot perform (image / html — Phase 3):
 * the planner schedules no beat for them, and this issue is the REQUIRED
 * loud signal that the step will draw nothing (silent dead time is the
 * failure mode it closes).
 */
export interface ParseIssue {
  code: ParseIssueCode;
  message: string;
  /** Address of the resulting BadStep, when one was produced. */
  step?: StepRef;
  /** Short source excerpt (R6: 原文摘要) for the agent's self-heal turn. */
  excerpt?: string;
  srcSpan: SrcSpan;
}

/**
 * One board = one lecture (per content set). Produced by
 * `domain.ts::parseLecture` — a pure function of the board.md text.
 */
export interface Lecture {
  /** First `#` heading text; falls back to the content set name. */
  title: string;
  /**
   * Section 0 is the preamble (its heading is a document-opening `#` H1,
   * when one exists); every subsequent heading — `##` anywhere, and any
   * later `#` — opens the next section.
   */
  sections: Section[];
  /** Block-isolated failures — a bad block never takes down the board. */
  errors: ParseIssue[];
  /**
   * The EXACT source text every `SrcSpan` in this lecture indexes into.
   * Carried on the value so spans and text agree by construction (G6):
   * consumers highlight against THIS string, never against an
   * independently-timed file read — a mid-edit re-read would be a torn
   * read and land highlights on the wrong characters.
   */
  source: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Reveal model (D1) — how the lecture is performed
// ────────────────────────────────────────────────────────────────────────────

/**
 * How a unit becomes visible. "stroke" draws along a single path
 * (dashoffset), "wipe" opens a left-to-right clip window, "fade" opacity;
 * "type" is reserved in v1 and not implemented. Negotiation
 * `(step kind, content, EnvCaps) → RevealKind` is a deterministic pure
 * function (§5.2) — env caps are session-fixed, so scrubbing and export
 * stay deterministic.
 */
export type RevealKind = "stroke" | "wipe" | "type" | "fade";

/**
 * One reveal unit — the atom the single pen performs.
 *
 * `seek(p)` is a PURE VISUAL MAPPING of progress 0..1 onto the node: no side
 * effects beyond idempotent style/attribute writes, no time source, callable
 * out of order and repeatedly with the same `p`. All easing applied inside
 * must be strictly monotonic (G8-H) — otherwise scrubbing backwards would
 * make the pen un-draw incorrectly.
 */
export interface Revealable {
  /**
   * Seconds, derived from content volume (I8). Factories ALWAYS report the
   * content-derived value and never consult the G3 override themselves —
   * the override is applied in exactly one place, the scheduler (see
   * `ScheduleContext.durationOverride`). Applying it here too would double
   * it silently.
   */
  naturalDuration: number;
  kind: RevealKind;
  /**
   * Present (`true`) ONLY on units that degraded to the inert fallback —
   * the planned reveal could not be materialized (missing target, host
   * bookkeeping gap, unresolvable geometry). On a degraded unit `kind` is
   * a PLACEHOLDER ("fade"), not a negotiated value: a consumer branching
   * on `kind` must check `degraded` first, or it will treat a degraded
   * stroke/wipe unit as a genuine fade. (Genuine units never set this.)
   */
  degraded?: true;
  /**
   * G6 — the precise source range this unit performs, carried through to
   * the timeline consumer: the viewer resolves `StepSchedule.{step,unit}`
   * to this span for 讲稿 line-level highlight, without re-deriving the
   * factory's internal unit ordering (for a chart frame the units are axis
   * lines, ticks, labels, then rows — unit index ≠ row index). Factories
   * derive it from the step's own spans (chart rows/axes, inline runs,
   * I9 sub-units by offset arithmetic into `textSpan`). Required: a unit
   * that cannot name its source is a G6 violation.
   */
  srcSpan: SrcSpan;
  seek(p: number): void;
}

/**
 * Session-fixed environment capabilities feeding RevealKind negotiation
 * (§5.2). Determined ONCE per session (after `document.fonts.ready`),
 * then constant — determinism of scrub/export depends on it.
 */
export interface EnvCaps {
  /**
   * Whether the handwriting display font actually renders. MUST be probed
   * via canvas width comparison against a known fallback (§6.4-A) —
   * `document.fonts.check()` returns true for any installed-or-not system
   * font and cannot be trusted.
   */
  handwritingFontActive: boolean;
  /** Whether the vendored single-line (Hershey) font covers `text`. */
  strokeFontCovers(text: string): boolean;
}

/**
 * The I8 duration model constants (seconds). Initial values live in
 * `engine/duration.ts` (prototype-measured, recalibrated after
 * serialization); the final values are tuned by the product owner in M5.
 * Carried on `MeasureContext` so hosts/tests can tune without patching
 * the engine.
 */
export interface DurationConstants {
  perChar: number;
  wordBase: number;
  cjkBoost: number;
  /** Inter-WORD gap — the pause after each revealed word/segment, not the
   *  gap between steps. Unit segmentation (CJK 1–2 chars, Latin by word)
   *  matters more than the constant itself (G10). */
  gap: number;
  comma: number;
  period: number;
  paraGap: number;
  annotate: number;
  annotDelay: number;
  afterAnnot: number;
  chartLead: number;
  axis: number;
  tick: number;
  series: number;
  label: number;
  /**
   * Van Wijk & Nuij (2003) ρ — the pan↔zoom trade-off of the camera path
   * (C2). Higher values zoom out more aggressively on long pans; √2 ≈ 1.42
   * is the paper's recommended value (and d3's). Dimensionless.
   */
  cameraRho: number;
  /**
   * Camera speed in Van Wijk perceptual arc-length units per second: a
   * camera step's duration is `S / cameraSpeed` where S is the ρ-metric
   * arc length of its own move (`engine/stage.ts`). The cost function IS
   * perceptual distance, so a short nudge is quick and a cross-board jump
   * is slow with the same constant — no per-move tuning (C2 spec).
   */
  cameraSpeed: number;
  /**
   * Seconds for one erase sweep across a board (C3). One constant, not a
   * per-area formula: multi-board panels are a fixed size, so a constant
   * IS "by area" there, and on the single long strip a constant sweep
   * reads as the hand moving faster over a bigger surface — the way a
   * teacher actually erases. T5-family: the final value is the product
   * owner's.
   */
  erase: number;
  /**
   * Seconds for one `@turn` walk when nothing is erased (board-snapshot
   * design §7.6-Q2): the plan synthesizes exactly one 走位 unit per turn
   * at this duration — the topic-change breath. On a tier-3 turn (full
   * wall) the viewer swaps the eraser revealable in 1:1 and its measured
   * `naturalDuration` (the erase constant) overrides this plan value by
   * the existing timeline rule. G10 family, T5-tunable.
   */
  turn: number;
  /**
   * Seconds for one `@at` walk (canvas pivot V2, design §3.1): the pen
   * crosses the board to a named region. Exactly one 走位 unit per
   * placement — the same shape `turn` has, one grain finer, and never
   * measured (a walk depends on no height, so a freshly appended `@at`
   * schedules correctly before its first measurement). G10 family,
   * T5-tunable.
   */
  place: number;
}

/**
 * The scheduling seam — everything the pure layer
 * (`engine/{inference,duration,timeline}.ts`, G2: no DOM, directly
 * unit-testable in Bun) may consult. The scheduler receives THIS type,
 * never `MeasureContext`, so tests never fabricate `Document` handles the
 * pure layer must not touch. Deliberately NOT a base type of
 * `MeasureContext`: `durationOverride` is unreachable from a factory —
 * the G3 single-applier rule is enforced by the type system, not by
 * JSDoc discipline.
 */
export interface ScheduleContext {
  /**
   * Tunable I8 constants (see `DurationConstants`). Hosts hand the SAME
   * object to `MeasureContext.durations` — one duration-constants truth,
   * two narrowly scoped views.
   */
  durations: DurationConstants;
  /**
   * C3 — the stage's scheduling input, optional (absent = the pre-C3
   * behaviour, which is also the pure-test default):
   *
   *  - `omitStageSteps`: the lecture-notes projection (板 ≠ 笔记).
   *    Camera, `@at` and erase steps plan to ZERO units — the same
   *    Lecture value compiles to the linear, nothing-ever-lost timeline.
   *    Steps are neutralized, never removed: removing them would renumber
   *    every StepRef and silently break agent addresses.
   *
   * It carried a second half until 2026-08-11: `autoEraseBefore`, the
   * fold's list of content steps that opened with a SYNTHESIZED erase
   * unit. The canvas pivot deleted auto-erase outright (design §2.3), so
   * the plan layer has no synthesis left to configure — every erase unit
   * on the canonical timeline belongs to an `@erase` an author wrote.
   */
  stage?: StagePlanInput;
  /**
   * G3 — external duration override, and its SINGLE owner is the scheduler:
   * `inference`/`timeline` consult this hook and, when it returns a finite
   * number of seconds for a step, REPLACE the step's content-derived total
   * FOOTPRINT — step start (post-lead-in) to last pen-up, a leading
   * pen-lift inside the step included; the trailing pen-up gap stays
   * natural — redistributing it proportionally across the step's units and
   * gaps (Phase 2 narration audio supplies the audio length here: the
   * audio covers the step from its start, pen travel included).
   * Factories never apply it — they always report content-derived
   * per-unit durations (see `Revealable.naturalDuration`), otherwise it
   * would be applied twice.
   *
   * `naturalFootprint` is that content-derived footprint in seconds, as
   * the scheduler computed it — handed TO the hook so a host policy can be
   * a function of both measurements (bansho narration clamps the audio
   * length to `[0.6, 2.5] × natural` — see `narration/types.ts`) without
   * re-deriving plan internals it cannot see. The clamp itself stays OUT
   * of the engine: the scheduler applies whatever the hook returns,
   * verbatim (policy is the host's, mechanism is the engine's).
   *
   * Step OBJECT identity does not survive the streaming re-parse (§7 R1/R4
   * mints fresh `Step`s every chokidar event), so hosts key overrides by
   * `ref` + `stepContentHash(step, lecture.source)` (engine/text.ts),
   * never by object reference. The two halves are NOT equally durable:
   * the content hash is the edit-stable half of §4.5 identity, while `ref`
   * is a POSITIONAL address — and a section-relative one, so inserting or
   * removing a heading renumbers every later section AND resets its step
   * indices (strictly less stable than the flat §4.5 block order, which is
   * derivable by flattening `Lecture.sections` in document order — the
   * order R4′ longest-common-prefix realignment runs over). A structural
   * edit may therefore drop position-keyed overrides; that is the accepted
   * §4.5 degradation, not a host bug.
   */
  durationOverride?(
    step: Step,
    ref: StepRef,
    naturalFootprint: number,
  ): number | undefined;
  /**
   * The LEAD-IN's own override (2026-08-12), `durationOverride`'s twin on
   * the other side of the step's start: it replaces the inter-step pause
   * (I1's breath, plus any container lead) that runs UP TO the step, and
   * touches nothing inside it.
   *
   * It exists because a board change is a JOURNEY. When the pen — or the
   * eraser — moves to another board, the camera has to walk there, and G1
   * says one thing happens at a time: the walk cannot share the step's own
   * window (that window is the writing, or the sweep). It rides the pause
   * before the step instead, and the pause must be at least as long as the
   * walk or the glide would be crammed into a breath. Hosts return
   * `max(natural, walk)` — never a sum, the same shape `@turn` uses — so a
   * board change costs exactly what the journey costs and a step with
   * nowhere to walk keeps its natural breath, byte for byte.
   *
   * Same contract as `durationOverride` in every other respect: finite and
   * non-negative or ignored, keyed by `ref` + content hash, and the ENGINE
   * applies it verbatim (policy is the host's).
   */
  leadInOverride?(
    step: Step,
    ref: StepRef,
    naturalLeadIn: number,
  ): number | undefined;
}

/**
 * C3 — the stage half of the scheduling seam (see `ScheduleContext.stage`).
 */
export interface StagePlanInput {
  /** Notes projection: camera, `@at` and erase steps plan no units. */
  omitStageSteps?: boolean;
}

/**
 * The eraser's target handle (C3, G8-L). `resolve()` answers the LIVE
 * element the erase owns — its dedicated run wrapper — or `null` while it
 * is unmounted (the unit then degrades to a no-op seek; schedule parity
 * kept). A live lookup, not a captured element, on purpose: the host
 * rebuilds wrappers across streaming reconciles, and every rebuild ends in
 * a fresh `makeSeek` + synchronous `seek(playhead)`, so a resolver is
 * always consistent where a captured node would go stale (the R4-family
 * relink rule, made structural).
 *
 * G8-L (hard rule): the surface behind `resolve()` is an element NO reveal
 * strategy ever touches — erase owns its wrapper's visual state (the
 * legacy sweep writes `clipPath`; the W9 chalk wipe writes the `mask-*`
 * family plus `pointerEvents` and its own `data-bansho-wiping` marker) and
 * writes nothing any strategy owns, so a scrub that dispatches
 * `C.seek(0.5); E.seek(0)` can never blow a half-revealed unit to fully
 * visible. The two flavours never mix on one unit: the verdict is fixed at
 * build (`MeasureContext.chalkWipe`), and wrappers are re-minted per
 * rebuild, so a stale flavour's state dies with its node.
 */
export interface EraseTargetHandle {
  resolve(): EraseWipeSurface | null;
}

/**
 * The eraser's wrapper, as the eraser sees it — a structural minimum so
 * the sweep stays testable with plain objects (the same shape argument
 * `QuietableSurface` makes). Only `clipPath` is required: the legacy sweep
 * writes nothing else, and pre-W9 fakes stay valid verbatim. The optional
 * members are what the chalk wipe additionally owns; in production the
 * surface is always the live `HTMLElement` wrapper, which has them all.
 */
export interface EraseWipeSurface {
  readonly style: {
    clipPath: string;
    maskImage?: string;
    maskSize?: string;
    maskRepeat?: string;
    maskPosition?: string;
    pointerEvents?: string;
  };
  readonly dataset?: Record<string, string | undefined>;
}

/**
 * Everything a `RevealableFactory.build` call may consult to construct and
 * measure nodes — the engine's ONLY seam to DOM measurement. Deliberately
 * DISJOINT from `ScheduleContext` (no `extends`): the G3 duration override
 * enters through the scheduler alone, and a factory author cannot even
 * reference `durationOverride` here without a type error (see
 * `Revealable.naturalDuration` — applying it in a factory too would double
 * it silently). Illegal states are unrepresentable, not merely documented.
 */
export interface MeasureContext {
  /**
   * Tunable I8 constants — the SAME object the host gives
   * `ScheduleContext.durations` (single duration-constants truth).
   */
  durations: DurationConstants;
  /** Host document used to create/measure DOM & SVG nodes. */
  document: Document;
  /**
   * A hidden, style-complete container the factory may mount nodes into for
   * measurement (`getTotalLength`, text width). First measurement happens
   * after `document.fonts.ready`; results are cached by step hash upstream.
   */
  measureHost: Element;
  /**
   * Session-fixed capabilities for RevealKind negotiation.
   *
   * TODO(§5.2 — not consumed yet): no factory reads `env` today; RevealKind
   * is hardcoded per factory. That is currently equivalent to the §5.2
   * ladder because `strokeFontCovers` is stubbed to `false` until the
   * Hershey single-line font is vendored (`engine/fonts/hershey-futural.json`,
   * design §6.1), so text could only ever negotiate to wipe anyway. The
   * ladder gets real consumers in two steps: T4's host wires `probeEnvCaps`
   * into this field after `document.fonts.ready`, and the chart mark
   * factory branches short-Latin text to stroke once the Hershey font
   * lands. The §6.4-A degradation warning does NOT ride this field: the
   * chip in `BanshoPreview` runs its own `probeEnvCaps` per theme-css
   * change (a seed's `theme.css` lands well after the session-fixed probe,
   * so the warning must track what the board actually renders with, while
   * the engine copy stays session-fixed per §5.2). This field's remaining
   * consumer is the future Hershey negotiation above.
   */
  env: EnvCaps;
  /**
   * §4.3 并列对齐 seam (optional, mirrors `backRef`/`chart`: cross-step
   * knowledge enters through host seams). Column alignment is GROUP-derived
   * — the spacer width one list item needs depends on every other member's
   * label width — so the factory cannot compute it alone. Protocol: a
   * list-item factory building an aligned step ALWAYS inserts a zero-width
   * `.bansho-align-spacer` marker right after the separator (at an exact
   * reveal-segment boundary; when the separator ends mid-segment the item
   * degrades to no marker rather than splitting a written word), sized by
   * THIS hook (`?? 0`). The host runs a probe build (hook absent) to
   * measure each member's natural label width, computes per-group maxima,
   * then rebuilds with the hook supplying `groupMax - ownLabel` — so ink
   * geometry is measured WITH the final column widths in place (an
   * after-the-fact spacer would strand every in-place mark on the value
   * side, G8-G/B territory). Streaming duty: a grown group invalidates
   * unchanged prefix members (`alignCascade`, viewer/reconcile.ts).
   */
  alignShift?(step: Step): number | undefined;
  /**
   * I6 back-reference seam (optional, mirrors `chart` below): resolve a
   * resolved `BackRefStep` target to measured ink geometry. The HOST owns
   * the offset→DOM mapping (per the `stepPlainText` vocabulary,
   * engine/text.ts — math runs are zero-width) and measures the target's
   * per-line rects in the coordinate space it will mount the returned
   * node into; `fontSize` is the target's computed font size, because ink
   * is sized by FONT SIZE, never by the line box (G8-G). `undefined`
   * (host not ready, target unmounted, seam absent) degrades to an inert
   * unit — schedule parity is kept, nothing is drawn, never a throw.
   */
  backRef?(target: BackRefTarget): InkTargetMeasure | undefined;
  /**
   * C2 stage-anchor seam (optional, mirrors `backRef`: cross-step node
   * knowledge enters through host seams). Resolve a mounted step to its
   * measured bounding box in BOARD coordinates — the geometry `@focus`
   * (and C3's `@erase` / C3b's `@bring`) aim the stage at. The host owns
   * the ref→node mapping and reads LAYOUT values only (`offset*` — a CSS
   * transform never changes them, G8-J's layout column, so the reading
   * needs no funnel scale-divide); for a backref step it answers with the
   * measured target rows (the pen — and the camera — turn back to earlier
   * writing). `undefined` (unmounted, hidden, seam absent) degrades the
   * consuming camera op to a no-move (schedule parity kept, nothing
   * jumps), never a throw. Resolution happens once per (re)build and the
   * results are baked into the stage schedule, so the `stageStateAt` fold
   * stays a pure function of `(schedule, t)`.
   */
  stageAnchor?(ref: StepRef): StageRect | undefined;
  /**
   * C3 erase-target seam (optional, mirrors `alignShift`: a per-build-index
   * host closure — the step value alone cannot name its board, because
   * which run an erase closes is the assignment fold's verdict, not the
   * step's). The erase factory calls this to obtain the live handle of the
   * run wrapper its unit sweeps; `undefined` (fold not run, notes view,
   * erase of an empty board) degrades the unit to an inert no-op —
   * schedule parity kept, nothing hidden, never a throw. See
   * `EraseTargetHandle` for the G8-L exclusive-channel contract.
   */
  eraseTarget?(step: Step): EraseTargetHandle | undefined;
  /**
   * W9 — the chalk-wipe verdict, `eraseTarget`'s sibling on the same seam:
   * theme knowledge the step value cannot hold, read by the HOST once per
   * rebuild (the computed `--bansho-chalk` gate times the 瑕疵 knob) and
   * handed down at build time. Present with `knob > 0` → `@erase` sweeps
   * as a hand-wipe (masked arc front + seeded residue, engine/chalk.ts).
   * Absent → the legacy hard-edge clip sweep, byte for byte; a paper
   * board (`--bansho-chalk: 0`) must never see a new code path.
   */
  chalkWipe?: { knob: number };
  /**
   * §4.4 accumulation seam — ONE seam for every named container (charts and
   * graphs alike; `key` is `containerKeyOf`, engine/container.ts, so the two
   * kinds never collide on a shared name). A layer factory calls this to
   * (a) read the frame's own declarations for placement (a chart needs
   * `x: 2023Q1 .. 2024Q4` / `y: 0 .. 40`; a graph needs the frame's union
   * layout) and (b) obtain the frame's built node — the container's spatial
   * home — to draw its layers into (time moves with the document; space
   * returns to the container's home). The host registers each frame node as
   * it builds; document order guarantees the frame is built before any of
   * its layers, and an orphan layer never reaches a factory (it degrades to
   * a BadStep at parse time, R5) — so `undefined` signals a host
   * bookkeeping bug and the factory should degrade gracefully (render
   * nothing + report), never throw.
   *
   * REBUILD RULE (§7 R4/R4′ — accumulation makes the frame's node shared
   * mutable state): a layer `build` appends into the frame's node, and
   * `seriesColor` cycling depends on mount order. When ANY step of a
   * container (frame or layer) is invalidated — content hash changed (R4)
   * or a structural re-alignment recompiles past it (R4′) — the host MUST
   * rebuild the FRAME (minting a fresh node) and then re-run every layer
   * of that container in document order against it, re-registering the new
   * `ContainerHome`. A same-content chart-layer rebuild alone is idempotent
   * (the layer clears its own tagged contribution first — see
   * `chartLayerFactory`), but a changed-content rebuild without the frame
   * cascade leaves the old layer's strokes mounted and shifts every later
   * series color.
   *
   * GRAPH ADDENDUM (`viewer/reconcile.ts::containerCascade`): a graph's
   * frame carries the container's accumulated union (`GraphLayoutSpec`), so
   * APPENDING a graph block changes the layout the frame is responsible
   * for even though the frame's own source bytes did not move. Graph
   * containers therefore cascade on append too — the one place the two
   * container kinds legitimately differ, and precisely because a chart
   * declares its coordinates up front while a graph computes them.
   */
  container(key: string): ContainerHome | undefined;
  /**
   * I1 illustration seam (optional, mirrors `container`: knowledge the step
   * value alone cannot carry enters through a host seam). Resolve a picture
   * the lecture NAMES to the two things the board needs to draw it: the
   * shape to leave room for, and where to read it from.
   *
   * `undefined` is the refusal, and it is the ONLY refusal — a path that
   * leaves the content set, a file the host confirmed is not on disk, a
   * picture with no entry in `illustrations/manifest.json`. The factory
   * degrades to a visible badge (never a throw, never an invisible gap),
   * and `check-board` names the same picture through the same verdict
   * function (`illustrations/types.ts::illustrationRefusal`), so the board
   * and the report can never disagree about what is drawn.
   */
  illustration?(step: ImageStep): IllustrationSpec | undefined;
}

/**
 * A drawable picture (see `MeasureContext.illustration`).
 *
 * `aspect` is DECLARED, never measured: the board reads a figure's height
 * off this number, so it is available before the file has loaded and it is
 * the same number at every window size (R8 — see `IMAGE_GLUE`).
 *
 * `url` must be SAME-ORIGIN. A figure is painted as a mask over the board's
 * own ink color, and a mask reads pixels, so a cross-origin source is
 * refused by the browser — silently, completely, and with every diagnostic
 * still reporting success (`.claude/rules/frontend.md`). Hosts pass a
 * root-relative URL; `getApiBase()` is a different origin in dev and must
 * NOT be used here.
 */
export interface IllustrationSpec {
  /** Width ÷ height, from the sidecar. Positive and finite. */
  aspect: number;
  /** Same-origin URL the paint reads (see above). */
  url: string;
}

/** Every step kind that can declare a named container. */
export type ContainerFrameStep = ChartFrameStep | GraphFrameStep;

/** A resolved named container: the declaring frame step + its built node. */
export interface ContainerHome {
  frame: ContainerFrameStep;
  node: Element;
}

/**
 * A step's measured bounding box in board coordinates (layout px — read
 * from `offset*`, never from `getBoundingClientRect`). The stage-anchor
 * seam's vocabulary; structurally identical to the ink layer's `RectLike`
 * on purpose (one rect shape per coordinate space, two narrow names).
 */
export interface StageRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * One line's ink target box (G8-B: cross-line marks split per line). Host
 * coordinate space — whatever the returned backref node is mounted into.
 */
export interface RowRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /**
   * The line's alphabetic BASELINE, in the same space as `y0`/`y1` (G8-M).
   *
   * A row box is a LINE box: its height is the line-height and its centre
   * is `(A - D) / 2` above the baseline — an artifact of the FONT's
   * ascent/descent asymmetry, not a fact about the writing. CJK glyphs fill
   * the em box, so ink placed on the box centre rides above every one of
   * them. The baseline is the one typographic fact both scripts share, so
   * marks that must meet the writing derive their vertical position from
   * it (see `inkRowShapes`).
   *
   * Optional: a host with no type metrics (the layout-free Bun tests)
   * leaves it out, and ink falls back to the row-box centre.
   */
  baseline?: number;
}

/** Measured geometry for a back-reference target (see `MeasureContext.backRef`). */
export interface InkTargetMeasure {
  /** Per-line boxes, top-first (the pen sweeps line by line, G8-B). */
  rows: RowRect[];
  /** Computed font size of the target text — the G8-G ink-size basis. */
  fontSize: number;
}

/**
 * Per-step builder: constructs the DOM/SVG node, negotiates RevealKind, and
 * measures naturalDuration. A single step may yield several revealables —
 * prose body (wipe) plus each ink action (stroke); a chart layer yields each
 * series line, then its label, then marks. The inference layer schedules
 * them strictly one after another (G1).
 *
 * Lifecycle contract: `build` is SINGLE-SHOT per (step content, mount
 * generation) — hosts discard the previous node + revealables and call
 * `build` again on invalidation (§7 R4), they never reuse or "refresh" a
 * built result. Most factories are self-contained (each build mints a
 * fresh node), but a chart-layer build mutates ANOTHER step's node — see
 * the rebuild rule on `MeasureContext.chart` for the cascade the host owes
 * that mutation.
 */
export interface RevealableFactory {
  kind: Step["kind"];
  build(
    step: Step,
    ctx: MeasureContext,
  ): { node: Element; revealables: Revealable[] };
}

// ────────────────────────────────────────────────────────────────────────────
// Canonical timeline
// ────────────────────────────────────────────────────────────────────────────

/**
 * One scheduled reveal unit: `unit` indexes into the step's revealables as
 * produced by its factory. `start`/`end` are canonical absolute seconds.
 */
export interface StepSchedule {
  step: StepRef;
  unit: number;
  start: number;
  end: number;
}

/**
 * The canonical timeline — the single temporal truth. Scrub, navigate-to,
 * capture, and future export all read ONLY this.
 *
 * Invariants:
 *  - schedule intervals are PAIRWISE NON-OVERLAPPING (single-pen, G1) —
 *    property-tested at compile level and sampled at runtime;
 *  - `duration` = max(end) over the schedule (0 when empty) — declared
 *    once, never recomputed by consumers;
 *  - `seek(t)` is a pure projection driven by an external clock (the engine
 *    holds no rAF): binary-searches the active window, skips units whose
 *    progress did not change, O(active units) per frame.
 */
export interface BoardTimeline {
  schedule: StepSchedule[];
  /**
   * Total canonical duration in seconds — `max(end)` over `schedule`, `0`
   * for an empty board. Set ONCE by `engine/timeline.ts` so the scrub bar,
   * the Live button (R7: seek to the last shown step's end), rate-scaled
   * clock bounds and export all read one declared value instead of folding
   * the array independently ("倍速不改总时长" is asserted against THIS).
   */
  duration: number;
  seek(t: number): void;
}

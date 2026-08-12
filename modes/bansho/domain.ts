/**
 * Bansho domain — lecture-dialect parser + aggregate-file load/save pair.
 *
 * `board.md` IS the lecture: plain structured markdown whose animation
 * semantics ride entirely on marks the author would write anyway (§4.1).
 * This module turns that text into the `Lecture` model (engine/types.ts) as
 * a PURE function — no DOM, no globals, byte-deterministic — so it runs
 * unchanged in Bun tests, the backend, and the browser.
 *
 * Hard requirements carried here:
 *  - G6: every step, every inline run, and every row inside a chart block
 *    carries a precise `srcSpan` (whole-block spans were prototype-falsified);
 *  - R5/R6: a broken block degrades to exactly one `BadStep` + one
 *    `ParseIssue` — the rest of the board parses untouched;
 *  - G1: nothing in the dialect can express simultaneity; the removed
 *    `@with` / `@after` parse to bad steps;
 *  - `$` is disambiguated from currency ($100 is money, not an open
 *    delimiter — Pandoc-style adjacency rules).
 */

import type { ViewerFileContent } from "../../core/types/viewer-contract.js";
import { wholeNumber, xFraction } from "./engine/chart-anchor.js";
import { containerKey } from "./engine/container.js";
import {
  classifyRegionWord,
  type RegionFacet,
  type RegionName,
} from "./engine/regions.js";
import { stepContentHash, stepPlainText } from "./engine/text.js";
import {
  readNarrationManifest,
  type NarrationManifestRead,
} from "./narration/types.js";
import type {
  ChartAxis,
  ChartLayerRow,
  ChartLayerStep,
  ChartFrameStep,
  ChartType,
  GraphEdge,
  GraphFrameStep,
  GraphLayerStep,
  GraphLayoutSpec,
  GraphNode,
  GraphNoteWrite,
  HeadingStep,
  InkAction,
  InlineRun,
  Lecture,
  ParseIssueCode,
  Section,
  SrcSpan,
  Step,
  StepRef,
} from "./engine/types.js";

// ── Board (aggregate-file value) ────────────────────────────────────────────

/** The whole bansho workspace: one Lecture per content set (design §3). */
export interface Board {
  byContentSet: Record<string, Lecture>;
  /**
   * Sibling `theme.css` contents keyed by content set ("" = root), riding
   * the same aggregate-file source. Theming is a viewer concern — it lives
   * HERE on the domain Board, deliberately off the engine's `Lecture`
   * (engine/types.ts stays a zero-coupling contract with no host payloads).
   */
  themeCss: Record<string, string>;
  /**
   * Sibling `narration/manifest.json` per content set (T10), same key,
   * same ride. The READ result, not just the manifest: a missing file is
   * silence by design, but a malformed one carries its reason so the
   * `narrate` action can hand it to the agent instead of laundering the
   * failure through the same silence (see `narration/types.ts`).
   */
  narration: Record<string, NarrationManifestRead>;
}

// ── Line model ──────────────────────────────────────────────────────────────

/** One source line: text without the terminator, plus absolute offsets. */
interface Line {
  text: string;
  start: number;
  /** Offset just past the last content char (excludes `\r` and `\n`). */
  end: number;
}

function splitLines(src: string): Line[] {
  const lines: Line[] = [];
  let pos = 0;
  for (;;) {
    const nl = src.indexOf("\n", pos);
    let end = nl === -1 ? src.length : nl;
    if (end > pos && src[end - 1] === "\r") end--;
    lines.push({ text: src.slice(pos, end), start: pos, end });
    if (nl === -1) break;
    pos = nl + 1;
  }
  return lines;
}

/** Span of a line's content with leading/trailing whitespace shaved off. */
function trimmedSpan(line: Line): SrcSpan {
  const leading = line.text.length - line.text.trimStart().length;
  const trailing = line.text.length - line.text.trimEnd().length;
  return { start: line.start + leading, end: line.end - trailing };
}

// ── Inline tokenizer ────────────────────────────────────────────────────────

/**
 * CJK prose glyphs — Han, kana, CJK punctuation (、。「」…) and fullwidth
 * forms (，！？：). Used by the `$` currency guard: a digit-led candidate
 * whose scan meets one of these is glued currency ("$100元"), never a
 * formula body (see the guard's comment in `tokenizeInline`).
 */
const CJK_PROSE_CHAR = /[　-〿぀-ヿ一-鿿＀-￯]/;

const INK_BY_DELIM: ReadonlyArray<{
  open: string;
  close: string;
  action: InkAction;
}> = [
  { open: "==", close: "==", action: "highlight" },
  { open: "**", close: "**", action: "underline" },
  { open: "~~", close: "~~", action: "strike" },
  { open: "((", close: "))", action: "circle" },
];

/**
 * Tokenize one source line into inline runs. Unclosed or malformed markers
 * fall back to literal text — the dialect has no parse failures at the
 * inline level, only at the block level.
 */
function tokenizeInline(text: string, base: number): InlineRun[] {
  const runs: InlineRun[] = [];
  let plainStart = 0;
  let i = 0;

  const flush = (upTo: number): void => {
    if (upTo > plainStart) {
      runs.push({
        kind: "text",
        text: text.slice(plainStart, upTo),
        srcSpan: { start: base + plainStart, end: base + upTo },
      });
    }
  };

  /** Find `close` after `open` at `at`; null when unclosed or empty. */
  const tryDelim = (
    at: number,
    open: string,
    close: string,
  ): { inner: string; end: number } | null => {
    const closeIdx = text.indexOf(close, at + open.length);
    if (closeIdx === -1 || closeIdx === at + open.length) return null;
    return { inner: text.slice(at + open.length, closeIdx), end: closeIdx + close.length };
  };

  const spans = (at: number, end: number, openLen: number, closeLen: number) => ({
    srcSpan: { start: base + at, end: base + end },
    textSpan: { start: base + at + openLen, end: base + end - closeLen },
  });

  while (i < text.length) {
    const c = text[i]!;
    let matched = false;

    // Ink marks (== / ** / ~~ / (( ))) — checked before single-char forms.
    for (const d of INK_BY_DELIM) {
      if (c !== d.open[0] || !text.startsWith(d.open, i)) continue;
      const hit = tryDelim(i, d.open, d.close);
      if (hit) {
        flush(i);
        // Recurse into the inner text: a known mark nested inside an ink
        // run (`==重要的 **结构性** 变化==`) becomes child runs instead of
        // literal delimiters on the board. The inner is strictly shorter
        // than the construct (tryDelim rejects empty inners), so recursion
        // terminates. The flat common case (a single plain-text run) omits
        // `children` — see the InlineRun precedence rule (engine/types.ts).
        const children = tokenizeInline(hit.inner, base + i + d.open.length);
        const nested =
          children.length > 1 ||
          (children.length === 1 && children[0]!.kind !== "text");
        runs.push({
          kind: "ink",
          action: d.action,
          text: hit.inner,
          ...spans(i, hit.end, d.open.length, d.close.length),
          ...(nested ? { children } : {}),
        });
        i = hit.end;
        plainStart = i;
        matched = true;
      }
      break; // first-char match decides the candidate either way
    }
    if (matched) continue;

    if (c === "*" && !text.startsWith("**", i)) {
      // Light emphasis *x* — reject space-edged content so bare arithmetic
      // ("2 * 3") never becomes emphasis.
      const hit = tryDelim(i, "*", "*");
      if (hit && hit.inner.trim() === hit.inner) {
        flush(i);
        runs.push({ kind: "em", text: hit.inner, ...spans(i, hit.end, 1, 1) });
        i = hit.end;
        plainStart = i;
        continue;
      }
    } else if (c === "`") {
      const hit = tryDelim(i, "`", "`");
      if (hit) {
        flush(i);
        runs.push({ kind: "term", text: hit.inner, ...spans(i, hit.end, 1, 1) });
        i = hit.end;
        plainStart = i;
        continue;
      }
    } else if (c === "$") {
      // Currency guard (finance boards WILL contain $100), Pandoc-style: an
      // opening $ must be followed by a non-space, non-$ char; a closing $
      // must follow a non-space char and must not precede a digit. Digit-
      // leading formulas ($2^n$, $2\pi r$) are legal — bare prices ($100,
      // 从 $7 涨到 $35, $x$100) never find a valid closer and stay literal.
      //
      // GLUED-CJK refinement: CJK prose puts no spaces around inline
      // constructs, so whitespace alone cannot separate glued-currency
      // ("价格是$100元,公式是$x$") from glued-math ("当$n$很大时"). The
      // discriminator is the candidate's INTERIOR: a digit-led candidate is
      // either a price or a digit-leading formula, and no formula body
      // contains CJK prose glyphs — so a digit-led scan that meets a CJK
      // char (Han/kana, CJK punctuation, fullwidth forms) aborts, keeping
      // the price literal while a later genuine formula still parses.
      // Non-digit-led candidates are untouched: CJK inside math stays legal
      // ($速度$), and glued-math closers ($n$ before 很) still close.
      const next = text[i + 1];
      if (next !== undefined && next !== "$" && !/\s/.test(next)) {
        const digitLed = /[0-9]/.test(next);
        let close = -1;
        for (let k = i + 2; k < text.length; k++) {
          if (digitLed && CJK_PROSE_CHAR.test(text[k]!)) break;
          if (text[k] !== "$") continue;
          const after = text[k + 1];
          if (/\s/.test(text[k - 1]!)) {
            // A whitespace-preceded $ can never CLOSE this run. If it can
            // OPEN a new one, our candidate was never math — abort so a
            // bare price cannot swallow through to a later formula's
            // closer ("单价 $100 时,复杂度 $2^n$ 才是瓶颈").
            if (after !== undefined && after !== "$" && !/\s/.test(after)) {
              break;
            }
            continue;
          }
          if (after !== undefined && /[0-9]/.test(after)) continue;
          close = k;
          break;
        }
        if (close !== -1) {
          flush(i);
          runs.push({
            kind: "math",
            tex: text.slice(i + 1, close),
            ...spans(i, close + 1, 1, 1),
          });
          i = close + 1;
          plainStart = i;
          continue;
        }
      }
    }

    i++;
  }
  flush(text.length);
  return runs;
}

// ── Text & identity vocabulary (engine-owned, re-exported for consumers) ────

// `stepPlainText` / `stepContentHash` live in engine/text.ts — the engine's
// own offset/identity vocabulary stays inside `engine/` (G2 layering); the
// domain surface re-exports them so model consumers import one module.
export { stepContentHash, stepPlainText };

// ── Chart block parsing ─────────────────────────────────────────────────────

/**
 * Something INSIDE a block that parsed: the block is readable and draws,
 * but one row of it cannot be performed. Reported without breaking the
 * block — the same shape `pushUnsupported` uses for a step the model keeps
 * and the board cannot perform, and for the same reason: a row that draws
 * nothing has to say so, or the agent reads a clean board.
 */
interface ContainerIssue {
  code: ParseIssueCode;
  message: string;
  excerpt: string;
  srcSpan: SrcSpan;
}

/**
 * One named-container block's parse outcome. Shared by charts and graphs —
 * the containment unit is the BLOCK for both (R6): any unrecognized row
 * fails the whole block and leaves its neighbours untouched.
 */
type ContainerParse<T extends Step> =
  | { ok: true; step: T; issues?: ContainerIssue[] }
  | { ok: false; code: ParseIssueCode; message: string; excerpt: string };

type ChartParse = ContainerParse<ChartFrameStep | ChartLayerStep>;

function parseAxis(spec: string, srcSpan: SrcSpan): ChartAxis | null {
  let rest = spec.trim();
  let unit: string | undefined;
  const um = rest.match(/^(.*?)\s*\(([^)]*)\)$/);
  if (um) {
    rest = um[1]!;
    unit = um[2]!;
  }
  if (!rest) return null;
  const rm = rest.match(/^(.+?)\s*\.\.\s*(.+)$/);
  if (rm) return { from: rm[1]!, to: rm[2]!, unit, srcSpan };
  return { values: rest.split(/\s+/), unit, srcSpan };
}

/**
 * The live accumulation state of ONE named chart while the board is
 * scanned — the axes the first block declared and every series drawn into
 * the picture so far. It exists so an annotation row can be checked
 * against the chart it actually attaches to (`+ mark` in a later block
 * routinely names a series declared two blocks earlier — the §4.2 board
 * does exactly that).
 *
 * Accumulated IN DOCUMENT ORDER, inside the scan: a series declared in a
 * LATER block is not on the board yet when an earlier block draws, so
 * seeing it here would license a mark that the chart cannot actually
 * place.
 */
interface ChartUnion {
  /** The x axis the first block declared (absent if it declared none). */
  x?: ChartAxis;
  /** Every series name drawn into this chart so far, blocks included. */
  series: Set<string>;
}

/**
 * Parse one ```chart <name>``` block. Containment unit is the BLOCK: any
 * unrecognized row fails the whole block (R6), leaving neighbours intact.
 * First block for a name that declares frame fields = the frame; later
 * blocks accumulate layers; layer rows with no frame anywhere = R5.
 *
 * A `+ mark` / `+ note` row that is perfectly readable but attaches to
 * nothing the chart has (an x that is not a place on the axis, a series
 * name nowhere on the chart, a height that is not a number) does NOT break
 * the block — it draws nothing and says so, as an issue on the block that
 * still draws.
 */
function parseChartBlock(
  name: string,
  body: Line[],
  span: SrcSpan,
  seen: Set<string>,
  unions: Map<string, ChartUnion>,
): ChartParse {
  const key = containerKey("chart", name);
  const isFirst = !seen.has(key);
  const err = (
    message: string,
    excerpt: string,
    code: ParseIssueCode = "stepParseError",
  ): ChartParse => ({ ok: false, code, message, excerpt });

  let chartType: ChartType = "line";
  let x: ChartAxis | undefined;
  let y: ChartAxis | undefined;
  let sawFrameField = false;
  const rows: ChartLayerRow[] = [];
  /** Each annotation row's own line, quoted back if it cannot attach. */
  const rowSource = new Map<ChartLayerRow, string>();

  for (const line of body) {
    const t = line.text.trim();
    if (t === "") continue;
    const rowSpan = trimmedSpan(line);
    let m: RegExpMatchArray | null;

    if ((m = t.match(/^type\s*:\s*(\S+)$/))) {
      sawFrameField = true;
      if (m[1] !== "line" && m[1] !== "bar") {
        return err(`unknown chart type "${m[1]}" (expected line or bar)`, t);
      }
      chartType = m[1];
    } else if ((m = t.match(/^([xy])\s*:\s*(.+)$/))) {
      sawFrameField = true;
      const axis = parseAxis(m[2]!, rowSpan);
      if (!axis) return err(`malformed ${m[1]}: axis`, t);
      if (m[1] === "x") {
        if (x) return err("duplicate x: axis", t);
        x = axis;
      } else {
        if (y) return err("duplicate y: axis", t);
        y = axis;
      }
    } else if ((m = t.match(/^\+\s*mark\s+(.+?)\s*@\s*(.+?)\s*:\s*"([^"]*)"$/))) {
      const row: ChartLayerRow = {
        kind: "mark",
        series: m[1]!,
        x: m[2]!,
        text: m[3]!,
        srcSpan: rowSpan,
      };
      rows.push(row);
      rowSource.set(row, t);
    } else if ((m = t.match(/^\+\s*note\s*@\s*([^,]+?)\s*,\s*(.+?)\s*:\s*"([^"]*)"$/))) {
      const row: ChartLayerRow = {
        kind: "note",
        x: m[1]!,
        y: m[2]!,
        text: m[3]!,
        srcSpan: rowSpan,
      };
      rows.push(row);
      rowSource.set(row, t);
    } else if (/^\+\s*mark[\s@]/.test(t)) {
      // Keyword matched but the row form did not (unquoted text is the
      // typical typo). Falling through to the series branch would rename
      // the row into a bogus series ('series "mark NVIDIA @ …" has
      // non-numeric values') and misdirect the R6 self-heal loop — report
      // the expected shape instead. A series literally named "mark"/"note"
      // (`+ mark: 1 2`) has `:` right after the keyword and still parses
      // as a series below.
      return err('malformed mark row — expected + mark <series> @ <x> : "text"', t);
    } else if (/^\+\s*note[\s@]/.test(t)) {
      return err('malformed note row — expected + note @ <x> , <y> : "text"', t);
    } else if ((m = t.match(/^\+\s*([^:]+?)\s*:\s*(.+)$/))) {
      const values = m[2]!.split(/[\s,]+/).filter(Boolean).map(Number);
      if (values.length === 0 || values.some((v) => !Number.isFinite(v))) {
        return err(`series "${m[1]}" has non-numeric values`, t);
      }
      rows.push({ kind: "series", name: m[1]!, values, srcSpan: rowSpan });
    } else {
      return err("unrecognized chart row", t);
    }
  }

  if (isFirst && !sawFrameField) {
    // A first-seen block carrying only + rows is an orphan layer, not an
    // implicit frame: the frame (axes) must be declared before layers (R5).
    return err(
      `chart "${name}" adds layers but no frame (x:/y:) was declared`,
      body[0]?.text.trim() ?? name,
      "refUnresolved",
    );
  }
  if (!isFirst && sawFrameField) {
    return err(
      "axes/type can only be declared in the chart's first block",
      body[0]?.text.trim() ?? name,
    );
  }

  // The chart as it stands at THIS point of the board: the axes the first
  // block declared, plus every series drawn into it so far — this block's
  // own series included, before its annotations are checked, because §4.4
  // imposes no ordering between rows of one block.
  const union = unions.get(key) ?? { series: new Set<string>() };
  if (isFirst) union.x = x;
  for (const row of rows) {
    if (row.kind === "series") union.series.add(row.name);
  }
  unions.set(key, union);

  // A readable row that attaches to nothing. The chart still draws; this
  // one label is not written, and THAT is what has to reach the agent —
  // the board's own report is the only place it can hear it.
  const issues: ContainerIssue[] = [];
  for (const row of rows) {
    if (row.kind === "series") continue;
    const why = unattachable(row, name, union);
    if (!why) continue;
    issues.push({
      code: "refUnresolved",
      message: `${why} — this ${row.kind} is not written`,
      excerpt: rowSource.get(row) ?? row.text,
      srcSpan: row.srcSpan,
    });
  }

  if (isFirst) {
    seen.add(key);
    return {
      ok: true,
      step: { kind: "chart-frame", chart: name, chartType, x, y, rows, srcSpan: span },
      ...(issues.length > 0 ? { issues } : {}),
    };
  }
  return {
    ok: true,
    step: { kind: "chart-layer", chart: name, rows, srcSpan: span },
    ...(issues.length > 0 ? { issues } : {}),
  };
}

/**
 * Why this row cannot attach to its chart — or `undefined` when it can.
 *
 * Deliberately the SAME question the chart factory asks before it draws
 * (`engine/chart-anchor.ts` answers it for both): whatever this says is
 * unattachable is exactly what the board will leave unwritten.
 */
function unattachable(
  row: Extract<ChartLayerRow, { kind: "mark" | "note" }>,
  chart: string,
  union: ChartUnion,
): string | undefined {
  if (xFraction(row.x, union.x) === undefined) {
    return `"${row.x}" is not a place on the x axis of chart "${chart}"`;
  }
  if (row.kind === "mark" && !union.series.has(row.series)) {
    return `chart "${chart}" has no series named "${row.series}"`;
  }
  if (row.kind === "note" && !Number.isFinite(wholeNumber(row.y))) {
    return `"${row.y}" is not a height on chart "${chart}" (a height is a plain number)`;
  }
  return undefined;
}

// ── Graph block parsing (§4.4's second container — see engine/container.ts) ──

/** The live accumulation state of ONE named graph while the board is scanned. */
interface GraphUnion {
  /** The frame's `layout` object — mutated in place as later blocks land. */
  spec: GraphLayoutSpec;
  byName: Map<string, GraphNode>;
  edgeKeys: Set<string>;
}

/**
 * `A → B`, and the ASCII spelling of the same arrow. Written as one
 * alternation so a chain line splits identically either way — the dialect
 * accepts what the author's keyboard produced, and means one thing.
 */
const GRAPH_ARROW = /→|->/g;

/** `名字: 说明` — the optional one-line explanation for a node. */
const GRAPH_NOTE = /^(.+?)\s*[:：]\s*(.+)$/;

/**
 * Parse one ```graph <name>``` block. Same containment unit as a chart (the
 * BLOCK, R6) and the same first-block-declares rule (engine/container.ts).
 *
 * Row shapes, all of which read as a line of the talk rather than a line of
 * configuration:
 *  - `讲稿 → 推断 → 播放` — a chain; consecutive names are linked in order;
 *  - `推断: 把讲稿变成串行 step` — annotates a node (and introduces it if
 *    this is where it first comes up);
 *  - `孤岛` — a lone node, mentioned with nothing hanging off it yet.
 *
 * First appearance owns the ink: a node or an edge named again — later in
 * the block or in a later block of the same container — draws nothing the
 * second time, because it is already on the board.
 */
function parseGraphBlock(
  name: string,
  body: Line[],
  span: SrcSpan,
  seen: Set<string>,
  unions: Map<string, GraphUnion>,
): ContainerParse<GraphFrameStep | GraphLayerStep> {
  const key = containerKey("graph", name);
  const isFirst = !seen.has(key);
  let union = unions.get(key);
  if (!union) {
    union = { spec: { nodes: [], edges: [] }, byName: new Map(), edgeKeys: new Set() };
    unions.set(key, union);
  }

  const ownNodes: GraphNode[] = [];
  const ownEdges: GraphEdge[] = [];

  /** Introduce a node the first time it is mentioned anywhere in this container. */
  const touch = (nodeName: string, srcSpan: SrcSpan): void => {
    if (union.byName.has(nodeName)) return;
    const record: GraphNode = { name: nodeName, srcSpan };
    union.byName.set(nodeName, record);
    union.spec.nodes.push(record);
    ownNodes.push({ name: nodeName, srcSpan });
  };

  /** Draw an arrow the first time this pair is written. */
  const link = (from: string, to: string, srcSpan: SrcSpan): void => {
    const edgeKey = `${from}\u0000${to}`;
    if (union.edgeKeys.has(edgeKey)) return;
    union.edgeKeys.add(edgeKey);
    const edge: GraphEdge = { from, to, srcSpan };
    union.spec.edges.push(edge);
    ownEdges.push(edge);
  };

  for (const line of body) {
    const t = line.text.trim();
    if (t === "") continue;

    // Split the line on arrows, keeping ABSOLUTE offsets so every name and
    // every arrow can point at exactly its own characters (G6).
    const parts: Array<{ text: string; start: number; end: number }> = [];
    let cut = 0;
    GRAPH_ARROW.lastIndex = 0;
    for (const m of line.text.matchAll(GRAPH_ARROW)) {
      parts.push(sliceSpan(line, cut, m.index));
      cut = m.index + m[0].length;
    }
    parts.push(sliceSpan(line, cut, line.text.length));

    if (parts.length > 1) {
      const empty = parts.find((p) => p.text === "");
      if (empty) {
        return {
          ok: false,
          code: "stepParseError",
          message: "a chain has an empty step — write 甲 → 乙, one name per arrow",
          excerpt: t,
        };
      }
      for (const part of parts) {
        touch(part.text, { start: part.start, end: part.end });
      }
      for (let i = 1; i < parts.length; i++) {
        link(parts[i - 1]!.text, parts[i]!.text, {
          start: parts[i - 1]!.start,
          end: parts[i]!.end,
        });
      }
      continue;
    }

    // No arrow: either an annotation or a lone node.
    const only = parts[0]!;
    const note = only.text.match(GRAPH_NOTE);
    if (note) {
      const nodeName = note[1]!.trim();
      if (!nodeName) {
        return {
          ok: false,
          code: "stepParseError",
          message: 'an explanation with no node in front of it — write 名字: 说明',
          excerpt: t,
        };
      }
      // The name sits at the head of the row; its span is its own text.
      touch(nodeName, { start: only.start, end: only.start + nodeName.length });
      // The explanation rides the CONTAINER's record: it is written into the
      // box, and the box is drawn where the node first came up — so a note
      // added later reaches the board through the container rebuild, never
      // as a second beat for something already written.
      const record = union.byName.get(nodeName)!;
      record.note = note[2]!.trim();
      continue;
    }
    touch(only.text, { start: only.start, end: only.end });
  }

  if (isFirst) {
    seen.add(key);
    return {
      ok: true,
      step: {
        kind: "graph-frame",
        graph: name,
        nodes: ownNodes,
        edges: ownEdges,
        layout: union.spec,
        srcSpan: span,
      },
    };
  }
  return {
    ok: true,
    step: {
      kind: "graph-layer",
      graph: name,
      nodes: ownNodes,
      edges: ownEdges,
      srcSpan: span,
    },
  };
}

/**
 * Re-scan one graph block's body for the `名字: 说明` rows it wrote —
 * the note-write history behind `LayoutStepInput.growth`'s prefix
 * re-measurement (2026-08-10 review P1-2). A note MUTATES its node's
 * union record in place at parse time, so the history is not recoverable
 * from the parsed steps; and it must not become a step field either — the
 * canonical plan serializes whole steps, and the [8] degenerate-hash gate
 * pins that serialization byte for byte. So the history is recovered from
 * the block's own source, with the very regexes the parser reads it by
 * (`GRAPH_ARROW` / `GRAPH_NOTE` above — parity by construction).
 */
export function graphNoteWrites(
  source: string,
  span: SrcSpan,
): GraphNoteWrite[] {
  const writes: GraphNoteWrite[] = [];
  for (const line of source.slice(span.start, span.end).split("\n")) {
    const t = line.trim();
    if (t === "" || t.startsWith("```")) continue;
    GRAPH_ARROW.lastIndex = 0;
    if (GRAPH_ARROW.test(t)) continue;
    const note = t.match(GRAPH_NOTE);
    if (!note) continue;
    const name = note[1]!.trim();
    if (name === "") continue;
    writes.push({ name, note: note[2]!.trim() });
  }
  return writes;
}

/** A line-local `[from, to)` slice, trimmed, with absolute source offsets. */
function sliceSpan(
  line: Line,
  from: number,
  to: number,
): { text: string; start: number; end: number } {
  const raw = line.text.slice(from, to);
  const lead = raw.length - raw.trimStart().length;
  const text = raw.trim();
  const start = line.start + from + lead;
  return { text, start, end: start + text.length };
}

// ── Block scanner ───────────────────────────────────────────────────────────

/** Internal placeholder: back references resolve after the full scan. */
interface PendingBackRef {
  kind: "pending-backref";
  action: InkAction;
  targetText: string;
  raw: string;
  srcSpan: SrcSpan;
}

/** Internal placeholder: `@focus` anchors resolve after the full scan,
 *  with the exact machinery back references use (nearest-upward exact
 *  substring — C2: 与 `@strike` 同款). */
interface PendingFocus {
  kind: "pending-focus";
  targetText: string;
  raw: string;
  srcSpan: SrcSpan;
}

/** Internal placeholder: anchored `@erase "…"` resolves after the full
 *  scan — the same nearest-upward machinery again (C3). */
interface PendingErase {
  kind: "pending-erase";
  targetText: string;
  raw: string;
  srcSpan: SrcSpan;
}

/** Internal placeholder: anchored `@at <region> "…"` resolves after the
 *  full scan — the same nearest-upward machinery a fourth time (canvas
 *  pivot V2). The REGION is already validated against the face when the
 *  placeholder is minted; only the anchor is still open. */
interface PendingAt {
  kind: "pending-at";
  region: RegionName;
  targetText: string;
  raw: string;
  srcSpan: SrcSpan;
}

type FlatItem =
  | Step
  | PendingBackRef
  | PendingFocus
  | PendingErase
  | PendingAt;

interface PendingIssue {
  flatIndex: number;
  code: ParseIssueCode;
  message: string;
  excerpt: string;
  srcSpan: SrcSpan;
}

const BACKREF_VERB = /^@(strike|circle|highlight|underline)\b/;
const KNOWN_DIRECTIVE =
  /^@(wait|strike|circle|highlight|underline|focus|overview|erase|board|at|with|after)\b/;
const IMAGE_LINE = /^!\[([^\]]*)\]\(([^)]+)\)$/;

/** True when the (trimmed) line opens a block form other than a paragraph. */
function isBlockStart(t: string): boolean {
  return (
    t.startsWith("```") ||
    t.startsWith("$$") ||
    /^#{1,2}\s+\S/.test(t) ||
    DEEP_HEADING.test(t) ||
    /^-{3,}$/.test(t) ||
    /^-\s+\S/.test(t) ||
    t.startsWith(">") ||
    IMAGE_LINE.test(t) ||
    KNOWN_DIRECTIVE.test(t)
  );
}

/**
 * `###`–`######` — outside the dialect (§4.6: only # / ## are headings),
 * but CommonMark treats an ATX heading as interrupting a paragraph, so it
 * gets its OWN plain-text step instead of merging mid-sentence into the
 * preceding prose. Seven-plus hashes are a paragraph in CommonMark too and
 * keep merging.
 */
const DEEP_HEADING = /^#{3,6}\s+\S/;

const TEXT_BEARING = new Set(["heading", "prose", "list-item", "aside"]);

// ── parseLecture ────────────────────────────────────────────────────────────

/**
 * Parse one board.md into a Lecture. Pure and total: every input produces a
 * Lecture — failures are per-block `BadStep`s plus `errors` entries, never
 * exceptions (约束 A: the agent will make mistakes; the blast radius of a
 * mistake is one step, not the board).
 */
export function parseLecture(src: string, fallbackTitle = "board"): Lecture {
  const lines = splitLines(src);
  const flat: FlatItem[] = [];
  const pendingIssues: PendingIssue[] = [];
  /** Declared named containers, kind-namespaced (engine/container.ts). */
  const seenContainers = new Set<string>();
  const chartUnions = new Map<string, ChartUnion>();
  const graphUnions = new Map<string, GraphUnion>();

  const excerptOf = (raw: string): string =>
    (raw.split("\n", 1)[0] ?? "").trim().slice(0, 80);

  const pushBad = (
    reason: string,
    span: SrcSpan,
    code: ParseIssueCode = "stepParseError",
    excerpt?: string,
  ): void => {
    const raw = src.slice(span.start, span.end);
    flat.push({ kind: "bad", reason, raw, srcSpan: span });
    pendingIssues.push({
      flatIndex: flat.length - 1,
      code,
      message: reason,
      excerpt: excerpt ?? excerptOf(raw),
      srcSpan: span,
    });
  };

  /**
   * v1 performs no image / html steps (they land with Phase 3 骨架完备):
   * the step parses and keeps its place in the model (srcSpan, identity),
   * but the planner schedules no beat for it — this warning is the loud
   * signal that the block will draw nothing. Without it the gap is silent:
   * no factory exists, so a scheduled beat would burn dead board time with
   * no owner and no way for the agent to self-heal.
   */
  const pushUnsupported = (kind: "image" | "html", span: SrcSpan): void => {
    pendingIssues.push({
      flatIndex: flat.length - 1,
      code: "unsupportedStep",
      message: `${kind} steps are not performed in v1 — the block stays in the model but draws nothing`,
      excerpt: excerptOf(src.slice(span.start, span.end)),
      srcSpan: span,
    });
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.text.trim();
    if (trimmed === "") {
      i++;
      continue;
    }

    // ── fenced blocks: ```chart <name> / ```html / unknown ───────────────
    if (trimmed.startsWith("```")) {
      const info = trimmed.slice(3).trim();
      let j = i + 1;
      const body: Line[] = [];
      while (j < lines.length && lines[j]!.text.trim() !== "```") {
        body.push(lines[j]!);
        j++;
      }
      const openSpan = trimmedSpan(line);
      if (j >= lines.length) {
        pushBad(
          "unclosed fenced block (missing ``` close)",
          { start: openSpan.start, end: lines[lines.length - 1]!.end },
          "stepParseError",
          trimmed,
        );
        break;
      }
      const span: SrcSpan = { start: openSpan.start, end: trimmedSpan(lines[j]!).end };
      if (info === "chart" || /^chart\s/.test(info)) {
        const name = info.slice(5).trim();
        if (!name) {
          pushBad("chart block missing a name — write ```chart <name>", span);
        } else {
          const res = parseChartBlock(name, body, span, seenContainers, chartUnions);
          if (res.ok) {
            flat.push(res.step);
            // Rows that draw nothing, on a block that does — attached to
            // the step that IS on the board, like `pushUnsupported`.
            for (const issue of res.issues ?? []) {
              pendingIssues.push({ flatIndex: flat.length - 1, ...issue });
            }
          } else pushBad(res.message, span, res.code, res.excerpt);
        }
      } else if (info === "graph" || /^graph\s/.test(info)) {
        const name = info.slice(5).trim();
        if (!name) {
          pushBad("graph block missing a name — write ```graph <name>", span);
        } else {
          const res = parseGraphBlock(name, body, span, seenContainers, graphUnions);
          if (res.ok) flat.push(res.step);
          else pushBad(res.message, span, res.code, res.excerpt);
        }
      } else if (info === "html") {
        flat.push({
          kind: "html",
          html: body.map((l) => l.text).join("\n"),
          srcSpan: span,
        });
        pushUnsupported("html", span);
      } else {
        // Unknown fence — the BODY renders literally as plain text (§4.6:
        // unknown marks degrade to text; the dialect grows by addition).
        // The ``` delimiter rows are markup, not content: writing them on
        // the board in handwriting is pure noise that carries nothing, so
        // they are dropped while the step span still covers the whole
        // block (source truth is unchanged, only what gets drawn is).
        // One PLAIN text run per line, joined by break runs: never
        // tokenized (== in code is code), never a whole-block run
        // (G6/§6.4-E falsified whole-block spans; every other text run is
        // single-line for I9), rebuilt from Line.text so CR bytes never
        // leak under CRLF. Body lines keep indentation byte-for-byte.
        const inline: InlineRun[] = [];
        for (let k = 0; k < body.length; k++) {
          const fl = body[k]!;
          if (k > 0) {
            const prev = body[k - 1]!;
            inline.push({
              kind: "break",
              srcSpan: { start: prev.end, end: Math.min(prev.end + 1, src.length) },
            });
          }
          if (fl.end > fl.start) {
            inline.push({
              kind: "text",
              text: src.slice(fl.start, fl.end),
              srcSpan: { start: fl.start, end: fl.end },
            });
          }
        }
        // An empty unknown fence has nothing to draw — emit no step rather
        // than a blank beat (F04's rule: no unit may hold silent dead time).
        if (inline.length > 0) flat.push({ kind: "prose", inline, srcSpan: span });
      }
      i = j + 1;
      continue;
    }

    // ── headings (# / ## only; deeper levels are plain text) ─────────────
    let m = line.text.match(/^(\s*)(#{1,2})(\s+)(.*?)\s*$/);
    if (m && m[4]) {
      const contentStart = line.start + m[1]!.length + m[2]!.length + m[3]!.length;
      flat.push({
        kind: "heading",
        level: m[2]!.length as 1 | 2,
        inline: tokenizeInline(m[4]!, contentStart),
        srcSpan: trimmedSpan(line),
      });
      i++;
      continue;
    }

    // ── deeper headings (### … ######) — literal text, own step ──────────
    if (DEEP_HEADING.test(trimmed)) {
      // §4.6: unknown marks render as plain text — but as their OWN step
      // (CommonMark: an ATX heading interrupts a paragraph), never merged
      // mid-sentence into surrounding prose. Single-line by construction.
      const span = trimmedSpan(line);
      flat.push({
        kind: "prose",
        inline: tokenizeInline(src.slice(span.start, span.end), span.start),
        srcSpan: span,
      });
      i++;
      continue;
    }

    // ── horizontal rule ──────────────────────────────────────────────────
    if (/^-{3,}$/.test(trimmed)) {
      flat.push({ kind: "rule", srcSpan: trimmedSpan(line) });
      i++;
      continue;
    }

    // ── list item ────────────────────────────────────────────────────────
    m = line.text.match(/^(\s*)-(\s+)(.*?)\s*$/);
    if (m && m[3]) {
      const contentStart = line.start + m[1]!.length + 1 + m[2]!.length;
      flat.push({
        kind: "list-item",
        inline: tokenizeInline(m[3]!, contentStart),
        srcSpan: trimmedSpan(line),
      });
      i++;
      continue;
    }

    // ── aside (consecutive > lines merge into one step) ──────────────────
    if (trimmed.startsWith(">")) {
      const inline: InlineRun[] = [];
      const first = line;
      let last = line;
      while (i < lines.length && lines[i]!.text.trim().startsWith(">")) {
        const cur = lines[i]!;
        const am = cur.text.match(/^(\s*)>(\s?)(.*?)\s*$/)!;
        if (inline.length > 0) {
          inline.push({
            kind: "break",
            srcSpan: { start: last.end, end: Math.min(last.end + 1, src.length) },
          });
        }
        const contentStart = cur.start + am[1]!.length + 1 + am[2]!.length;
        if (am[3]) inline.push(...tokenizeInline(am[3]!, contentStart));
        last = cur;
        i++;
      }
      flat.push({
        kind: "aside",
        inline,
        srcSpan: { start: trimmedSpan(first).start, end: trimmedSpan(last).end },
      });
      continue;
    }

    // ── image on its own line ────────────────────────────────────────────
    m = trimmed.match(IMAGE_LINE);
    if (m) {
      flat.push({
        kind: "image",
        src: m[2]!,
        alt: m[1]!,
        srcSpan: trimmedSpan(line),
      });
      pushUnsupported("image", trimmedSpan(line));
      i++;
      continue;
    }

    // ── block math: $$…$$ on one line, or a bare $$ fence pair ───────────
    if (trimmed.startsWith("$$")) {
      const sm = trimmed.match(/^\$\$(.+)\$\$$/);
      if (sm && sm[1]!.trim()) {
        flat.push({ kind: "math", tex: sm[1]!.trim(), srcSpan: trimmedSpan(line) });
        i++;
        continue;
      }
      if (trimmed === "$$") {
        let j = i + 1;
        const body: Line[] = [];
        while (j < lines.length && lines[j]!.text.trim() !== "$$") {
          body.push(lines[j]!);
          j++;
        }
        if (j >= lines.length) {
          pushBad(
            "unclosed $$ math block",
            { start: trimmedSpan(line).start, end: lines[lines.length - 1]!.end },
            "stepParseError",
            trimmed,
          );
          break;
        }
        flat.push({
          kind: "math",
          tex: body.map((l) => l.text).join("\n"),
          srcSpan: { start: trimmedSpan(line).start, end: trimmedSpan(lines[j]!).end },
        });
        i = j + 1;
        continue;
      }
      // "$$something-unclosed" — fall through to paragraph (literal text).
    }

    // ── stage directives ─────────────────────────────────────────────────
    if (trimmed.startsWith("@")) {
      const span = trimmedSpan(line);
      let dm = trimmed.match(/^@wait(?:\s+([0-9]+(?:\.[0-9]+)?))?$/);
      if (dm) {
        flat.push({
          kind: "wait",
          seconds: dm[1] === undefined ? undefined : Number(dm[1]),
          srcSpan: span,
        });
        i++;
        continue;
      }
      if (/^@wait\b/.test(trimmed)) {
        pushBad('malformed @wait — expected "@wait" or "@wait <seconds>"', span);
        i++;
        continue;
      }
      dm = trimmed.match(/^@(strike|circle|highlight|underline)\s+"([^"]+)"$/);
      if (dm) {
        flat.push({
          kind: "pending-backref",
          action: dm[1] as InkAction,
          targetText: dm[2]!,
          raw: trimmed,
          srcSpan: span,
        });
        i++;
        continue;
      }
      if (BACKREF_VERB.test(trimmed)) {
        pushBad(
          'malformed back reference — expected @strike "target text" (quoted)',
          span,
        );
        i++;
        continue;
      }
      // ── C2 camera verbs: @overview / @focus "锚文本" ───────────────────
      // Content-anchored, never a board number, never a coordinate (rev 2
      // §1.4). srcSpan = the directive's own line (G6).
      if (trimmed === "@overview") {
        flat.push({ kind: "camera", op: "overview", srcSpan: span });
        i++;
        continue;
      }
      if (/^@overview\b/.test(trimmed)) {
        pushBad(
          'malformed @overview — it stands alone and takes no arguments',
          span,
        );
        i++;
        continue;
      }
      dm = trimmed.match(/^@focus\s+"([^"]+)"$/);
      if (dm) {
        flat.push({
          kind: "pending-focus",
          targetText: dm[1]!,
          raw: trimmed,
          srcSpan: span,
        });
        i++;
        continue;
      }
      if (/^@focus\b/.test(trimmed)) {
        pushBad(
          'malformed @focus — expected @focus "anchor text" (quoted); it never takes a board number',
          span,
        );
        i++;
        continue;
      }
      // ── C3 area + eraser verbs: @board n / @erase ["锚文本"] ───────────
      // `@board` is the lecture's OPENING stage direction — literally the
      // first step of the document (a title is content too); anywhere
      // else, or twice, is a BadStep. `@erase` anchors content, never a
      // board number (rev 2 §1.4 — the agent cannot know board numbers).
      dm = trimmed.match(/^@board\s+(\S+)$/);
      if (dm) {
        const n = Number(dm[1]);
        if (!Number.isInteger(n) || n < 1 || n > 4) {
          pushBad(
            `malformed @board — the room holds 1 to 4 boards (got "${dm[1]}")`,
            span,
          );
        } else if (flat.length > 0) {
          pushBad(
            "@board must open the lecture — write it before the first content block; the board count cannot change mid-lecture",
            span,
          );
        } else {
          flat.push({
            kind: "board-config",
            count: n as 1 | 2 | 3 | 4,
            srcSpan: span,
          });
        }
        i++;
        continue;
      }
      if (/^@board\b/.test(trimmed)) {
        pushBad('malformed @board — expected "@board <1-4>" on its own line', span);
        i++;
        continue;
      }
      if (trimmed === "@erase") {
        flat.push({ kind: "erase", srcSpan: span });
        i++;
        continue;
      }
      dm = trimmed.match(/^@erase\s+"([^"]+)"$/);
      if (dm) {
        flat.push({
          kind: "pending-erase",
          targetText: dm[1]!,
          raw: trimmed,
          srcSpan: span,
        });
        i++;
        continue;
      }
      if (/^@erase\b/.test(trimmed)) {
        pushBad(
          'malformed @erase — bare "@erase" (the board being written) or @erase "anchor text" (that text\'s board); it never takes a board number',
          span,
        );
        i++;
        continue;
      }
      // ── S1 stage verb: @turn — "new topic, leave that board standing" ──
      // Parameterless, same family as @erase: never a board number, never
      // a coordinate (§7.6). The single long strip has no "next board", so
      // a turn there is a category error, judged HERE — the parser holds
      // the whole document and the board count is pinned to the document's
      // first step, already fixed by the time any @turn line is scanned.
      if (trimmed === "@turn") {
        const first = flat[0];
        const count =
          first?.kind === "board-config" ? first.count : 1;
        if (count === 1) {
          pushBad(
            "the single strip has no next board — stand boards with @board 2–4 first, or just keep writing; the strip never runs out.",
            span,
          );
        } else {
          flat.push({ kind: "turn", srcSpan: span });
        }
        i++;
        continue;
      }
      if (/^@turn\b/.test(trimmed)) {
        pushBad(
          'malformed @turn — it stands alone and takes no arguments; the room picks the board, never the author',
          span,
        );
        i++;
        continue;
      }
      // ── V2 placement verb: @at <region> ["锚文本"] ────────────────────
      // The pen walks to a named region — the first verb in the dialect
      // that says WHERE. The vocabulary is closed and FACETED
      // (engine/regions.ts): the strip admits no vertical fraction, and
      // which face this is was pinned by the document's first step, so the
      // judgement belongs HERE, beside @turn's, where the whole document
      // is in hand. A word outside the face's set is one BadStep whose
      // message teaches the set — never a silent fallback to `full`,
      // which would place the content somewhere the author never said.
      dm = trimmed.match(/^@at\s+([a-z-]+)(?:\s+"([^"]+)")?$/);
      if (dm) {
        const first = flat[0];
        const facet: RegionFacet =
          (first?.kind === "board-config" ? first.count : 1) === 1
            ? "strip"
            : "bounded";
        const verdict = classifyRegionWord(dm[1]!, facet);
        if (!verdict.ok) {
          pushBad(verdict.message, span);
        } else if (dm[2] === undefined) {
          flat.push({ kind: "at", region: verdict.name, srcSpan: span });
        } else {
          flat.push({
            kind: "pending-at",
            region: verdict.name,
            targetText: dm[2],
            raw: trimmed,
            srcSpan: span,
          });
        }
        i++;
        continue;
      }
      if (/^@at\b/.test(trimmed)) {
        pushBad(
          'malformed @at — expected "@at <region>" or \'@at <region> "anchor text"\'; a region is a word, never a number or a coordinate',
          span,
        );
        i++;
        continue;
      }
      dm = trimmed.match(/^@(with|after)\b/);
      if (dm) {
        // G1: the parallel-era anchors are dead syntax. The board has one
        // pen; ordering is document order. Reintroducing these is a bug.
        pushBad(
          `"@${dm[1]}" was removed with the parallel model — the board is ` +
            "single-threaded; order actions by document position",
          span,
        );
        i++;
        continue;
      }
      // Unknown @ directive → plain text (falls through to paragraph).
    }

    // ── paragraph (default) ──────────────────────────────────────────────
    {
      const paraLines: Line[] = [line];
      i++;
      while (
        i < lines.length &&
        lines[i]!.text.trim() !== "" &&
        !isBlockStart(lines[i]!.text.trim())
      ) {
        paraLines.push(lines[i]!);
        i++;
      }
      const inline: InlineRun[] = [];
      for (let k = 0; k < paraLines.length; k++) {
        const pl = paraLines[k]!;
        if (k > 0) {
          const prev = paraLines[k - 1]!;
          inline.push({
            kind: "break",
            srcSpan: { start: prev.end, end: Math.min(prev.end + 1, src.length) },
          });
        }
        const span = trimmedSpan(pl);
        inline.push(...tokenizeInline(src.slice(span.start, span.end), span.start));
      }
      flat.push({
        kind: "prose",
        inline,
        srcSpan: {
          start: trimmedSpan(paraLines[0]!).start,
          end: trimmedSpan(paraLines[paraLines.length - 1]!).end,
        },
      });
    }
  }

  // ── section assembly (§8: section 0 is the preamble, always present) ────
  interface SectionDraft {
    heading?: HeadingStep;
    steps: FlatItem[];
  }
  const drafts: SectionDraft[] = [{ steps: [] }];
  const refs: StepRef[] = [];
  for (const item of flat) {
    if (item.kind === "heading") {
      const preamble = drafts[0]!;
      if (
        item.level === 1 &&
        drafts.length === 1 &&
        !preamble.heading &&
        // The opening `@board` stage direction is transparent here: a
        // document reading "@board 3 / # 标题" keeps the H1 as the
        // preamble's title — the config must not renumber every section.
        preamble.steps.every((s) => s.kind === "board-config")
      ) {
        preamble.heading = item;
        refs.push({ section: 0, step: -1 });
        continue;
      }
      drafts.push({ heading: item, steps: [] });
      refs.push({ section: drafts.length - 1, step: -1 });
      continue;
    }
    const current = drafts[drafts.length - 1]!;
    current.steps.push(item);
    refs.push({ section: drafts.length - 1, step: current.steps.length - 1 });
  }

  // ── anchor resolution (nearest-upward exact substring) ──────────────────
  // One machinery, FOUR verbs (C2/C3 + canvas pivot V2): a back reference
  // resolves to a char range inside the target step; `@focus`, `@erase "…"`
  // and `@at <region> "…"` only need the step itself. A fourth verb reusing
  // this pass rather than growing its own is the point — "cross-board
  // references name CONTENT, never a board number" stays one rule with one
  // implementation.
  flat.forEach((item, k) => {
    if (
      item.kind !== "pending-backref" &&
      item.kind !== "pending-focus" &&
      item.kind !== "pending-erase" &&
      item.kind !== "pending-at"
    ) {
      return;
    }
    let replacement: Step | null = null;
    for (let j = k - 1; j >= 0 && !replacement; j--) {
      const cand = flat[j]!;
      if (!TEXT_BEARING.has(cand.kind)) continue;
      const plain = stepPlainText(cand as Step);
      // Nearest occurrence wins on ambiguity — the agent disambiguates with
      // a longer substring, never with new syntax (§4.3).
      const idx = plain.lastIndexOf(item.targetText);
      if (idx === -1) continue;
      replacement =
        item.kind === "pending-backref"
          ? {
              kind: "backref",
              action: item.action,
              targetText: item.targetText,
              target: {
                step: refs[j]!,
                start: idx,
                end: idx + item.targetText.length,
              },
              srcSpan: item.srcSpan,
            }
          : item.kind === "pending-focus"
            ? {
                kind: "camera",
                op: "focus",
                targetText: item.targetText,
                target: refs[j]!,
                srcSpan: item.srcSpan,
              }
            : item.kind === "pending-erase"
              ? {
                  kind: "erase",
                  targetText: item.targetText,
                  target: refs[j]!,
                  srcSpan: item.srcSpan,
                }
              : {
                  kind: "at",
                  region: item.region,
                  targetText: item.targetText,
                  target: refs[j]!,
                  srcSpan: item.srcSpan,
                };
    }
    if (!replacement) {
      const noun =
        item.kind === "pending-backref"
          ? "back reference"
          : item.kind === "pending-focus"
            ? "focus"
            : item.kind === "pending-erase"
              ? "erase"
              : // The pen deliberately does NOT move (design §3.1): a
                // placement whose anchor missed becomes one bad step, and
                // the content that followed stays in the region it was
                // already in rather than landing somewhere nobody named.
                "placement";
      replacement = {
        kind: "bad",
        reason: `${noun} target not found: "${item.targetText}"`,
        raw: item.raw,
        srcSpan: item.srcSpan,
      };
      pendingIssues.push({
        flatIndex: k,
        code: "refUnresolved",
        message: `${noun} target not found: "${item.targetText}"`,
        excerpt: item.raw,
        srcSpan: item.srcSpan,
      });
    }
    const ref = refs[k]!;
    drafts[ref.section]!.steps[ref.step] = replacement;
  });

  // ── finalize sections (totality: parseLecture never throws) ─────────────
  const sections: Section[] = drafts.map((d) => ({
    heading: d.heading,
    steps: d.steps.map((s): Step =>
      s.kind === "pending-backref" ||
      s.kind === "pending-focus" ||
      s.kind === "pending-erase" ||
      s.kind === "pending-at"
        ? // Unreachable by construction (every pending anchor is replaced
          // above), but the documented contract is total — failures are
          // per-block BadSteps, never exceptions (R6). Should a future edit
          // break the invariant, it surfaces as a visible bad step on the
          // board instead of taking the whole parse down.
          {
            kind: "bad",
            reason: "parser invariant breach: anchor directive left unresolved",
            raw: s.raw,
            srcSpan: s.srcSpan,
          }
        : s,
    ),
  }));

  // ── alignment groups (§4.3 并列对齐 — zero new syntax) ──────────────────
  let groupCounter = 0;
  for (const section of sections) {
    const steps = section.steps;
    let a = 0;
    while (a < steps.length) {
      if (steps[a]!.kind !== "list-item") {
        a++;
        continue;
      }
      let b = a;
      while (b < steps.length && steps[b]!.kind === "list-item") b++;
      const seps = steps
        .slice(a, b)
        .map((s) => firstSeparator(stepPlainText(s)));
      let k = 0;
      while (k < b - a) {
        const sep = seps[k];
        if (!sep) {
          k++;
          continue;
        }
        let m2 = k + 1;
        while (m2 < b - a && seps[m2] && seps[m2]!.sep === sep.sep) m2++;
        if (m2 - k >= 2) {
          const group = groupCounter++;
          for (let idx = k; idx < m2; idx++) {
            (steps[a + idx] as Extract<Step, { kind: "list-item" }>).align = {
              group,
              sep: seps[idx]!.sep,
              at: seps[idx]!.at,
            };
          }
        }
        k = m2;
      }
      a = b;
    }
  }

  // ── issues → errors with resolved refs, in document order ───────────────
  const errors = pendingIssues
    .map((pi) => ({
      code: pi.code,
      message: pi.message,
      step: refs[pi.flatIndex],
      excerpt: pi.excerpt,
      srcSpan: pi.srcSpan,
    }))
    .sort((x, y) => x.srcSpan.start - y.srcSpan.start);

  // ── title: first H1, else the content set name ──────────────────────────
  const firstH1 = flat.find(
    (s): s is HeadingStep => s.kind === "heading" && s.level === 1,
  );
  const title = firstH1 ? stepPlainText(firstH1).trim() || fallbackTitle : fallbackTitle;

  return { title, sections, errors, source: src };
}

/** First `:` / `：` (colon) or ` — ` (spaced em-dash) in a plain text. */
function firstSeparator(
  plain: string,
): { sep: "colon" | "dash"; at: number } | null {
  const candidates: Array<{ sep: "colon" | "dash"; at: number }> = [];
  const ascii = plain.indexOf(":");
  const full = plain.indexOf("：");
  const colon =
    ascii === -1 ? full : full === -1 ? ascii : Math.min(ascii, full);
  if (colon !== -1) candidates.push({ sep: "colon", at: colon });
  const dash = plain.indexOf(" \u2014 ");
  if (dash !== -1) candidates.push({ sep: "dash", at: dash });
  if (candidates.length === 0) return null;
  candidates.sort((x, y) => x.at - y.at);
  return candidates[0]!;
}

// ── loadBoard / saveBoard (aggregate-file pair) ─────────────────────────────

/**
 * Build the Board from the raw file snapshot: one Lecture per `board.md`,
 * keyed by its directory prefix ("" for a root-level board — the slide
 * `loadDeck` shape). A sibling `theme.css` rides along on `Board.themeCss`
 * (same key) so theme edits flow through the same source. Returns null when
 * no board exists yet (the source stays in "no initial" state).
 */
export function loadBoard(
  files: ReadonlyArray<ViewerFileContent>,
): Board | null {
  const boards = files.filter(
    (f) => f.path === "board.md" || f.path.endsWith("/board.md"),
  );
  if (boards.length === 0) return null;

  const byContentSet: Record<string, Lecture> = {};
  const themeCss: Record<string, string> = {};
  const narration: Record<string, NarrationManifestRead> = {};
  for (const f of boards) {
    const prefix =
      f.path === "board.md" ? "" : f.path.slice(0, -"/board.md".length);
    const fallbackTitle =
      prefix === "" ? "board" : (prefix.split("/").pop() ?? prefix);
    byContentSet[prefix] = parseLecture(f.content, fallbackTitle);
    const themePath = prefix === "" ? "theme.css" : `${prefix}/theme.css`;
    const theme = files.find((t) => t.path === themePath);
    if (theme) themeCss[prefix] = theme.content;
    const narrationPath =
      prefix === ""
        ? "narration/manifest.json"
        : `${prefix}/narration/manifest.json`;
    narration[prefix] = readNarrationManifest(
      files.find((n) => n.path === narrationPath)?.content,
    );
  }
  return { byContentSet, themeCss, narration };
}

/**
 * v1 stub (design §3, illustrate precedent): the bansho viewer is a player,
 * not an editor — nothing calls `write` yet, so the decomposer emits an
 * empty diff. The visual-editing seam (v2) replaces this with a real
 * Lecture → file-ops decomposition.
 */
export function saveBoard(
  _next: Board,
  _current: ReadonlyArray<ViewerFileContent>,
): { writes: Array<{ path: string; content: string }>; deletes: string[] } {
  return { writes: [], deletes: [] };
}

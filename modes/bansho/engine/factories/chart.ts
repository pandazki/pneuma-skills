/**
 * Chart factories (T3) — named accumulating containers (§4.4).
 *
 * The frame factory stands the skeleton up stroke by stroke (I4: x axis →
 * y axis → each tick → each x label — fully serialized, G1) and draws its
 * own rows; the layer factory resolves the frame through
 * `MeasureContext.chart(name)` and draws INTO the frame's svg — time moves
 * with the document, space returns to the chart's home.
 *
 * Builder order mirrors `planChart` (inference.ts) EXACTLY — the plan is
 * the ordering truth, `StepSchedule.unit` indexes both arrays (T2↔T3
 * seam). A builder/plan length mismatch is defensively padded with inert
 * units (and reported) rather than throwing.
 *
 * Hard rules carried here:
 *  - G8-C — series labels anchor `text-anchor="end"` at `x = W - 4`: they
 *    extend LEFT, so a long name (中文系列名) can never overflow the canvas.
 *  - G8-D — every color goes through `element.style` (enforced by `el`).
 *  - G9 — axes draw with the `steady` pen, data lines with `trace`,
 *    labels write with `write`.
 */

import {
  wholeNumber,
  xFraction,
  yAxisSpan,
  type AxisSpan,
} from "../chart-anchor.js";
import { containerKey } from "../container.js";
import { Ease } from "../easing.js";
import {
  finiteYTickEntries,
  planStepUnits,
  type UnitPlan,
} from "../inference.js";
import { jitterLine, mulberry32, sketchPath, type Rand } from "../sketch/index.js";
import { fadeReveal } from "../strategies/fade.js";
import { strokeReveal } from "../strategies/stroke.js";
import { clipWipe } from "../strategies/wipe.js";
import type {
  ChartAxis,
  ChartFrameStep,
  ChartLayerRow,
  ChartLayerStep,
  MeasureContext,
  Revealable,
  RevealableFactory,
} from "../types.js";
import { contentSeed, el, inertRevealable, type StyledElement } from "./svg.js";

// Prototype-validated canvas geometry (px, viewBox units).
const W = 900;
const H = 420;
const PL = 96;
const PR = 100;
const PT = 26;
const PB = 56;

const HAND_FONT = "var(--hand, cursive)";
const BOARD_FG = "var(--board-fg, currentColor)";

/** Series stroke palette — prototype pair, cycled. */
const seriesColor = (index: number): string =>
  index % 2 === 0 ? "var(--s1, #2E9E4F)" : "var(--s2, #3B7DD8)";

/** The tick/label entries an axis declares (mirrors inference.ts). */
function axisEntries(axis: ChartAxis | undefined): string[] {
  if (!axis) return [];
  if (axis.values) return axis.values;
  const out: string[] = [];
  if (axis.from !== undefined) out.push(axis.from);
  if (axis.to !== undefined) out.push(axis.to);
  return out;
}

interface ChartScales {
  X(i: number, n: number): number;
  Y(v: number): number;
}

/** Headroom above the highest declared value, as a fraction of the span. */
const Y_HEADROOM = 0.16;

/**
 * Coordinate mapping — computed from the FRAME's declarations alone, so a
 * later layer reconstructs the identical scale and the coordinate system
 * never jumps when lines are added (§4.4: declare the range up front).
 *
 * A range names BOTH its ends (`references/charts.md`: "a range names its
 * two ends"), so the plot's floor is the DECLARED lower end, not an
 * assumed zero. Reading only the peak put `y: -3 .. 3` on a 0..3.48 scale
 * and mapped its own lower endpoint to y ≈ 655 in a 420-tall viewBox — the
 * tick, its label and the whole negative half of the data drawn off the
 * canvas. `lo === 0` (the common declaration) scales byte-identically to
 * the peak-only arithmetic this replaces.
 *
 * A declaration that names no interval never reaches here: the parser
 * refuses `y: 0 .. 0` and the `y: 0 ..` typo as an unreadable row
 * (`domain.ts`), because a chart drawn against a substituted scale
 * contradicts its own axis labels. The guard below is what makes that
 * refusal the ONLY path — never a division by zero — for a frame built by
 * something other than the parser.
 */
export function chartScales(frame: ChartFrameStep): ChartScales {
  const declared = yAxisSpan(frame.y);
  const values = frame.rows.flatMap((r) => (r.kind === "series" ? r.values : []));
  // The data's own interval, for an axis that declares no numbers at all (a
  // categorical `y: 低 .. 高`). The floor stays 0 unless the data itself
  // goes below it, so a positive series scales exactly as it always did.
  const data: AxisSpan = {
    lo: Math.min(0, ...values),
    hi: Math.max(1, ...values),
  };
  const span = declared && declared.hi > declared.lo ? declared : data;
  const top = span.lo + (span.hi - span.lo) * (1 + Y_HEADROOM);
  return {
    X: (i, n) => PL + (n <= 1 ? 0.5 : i / (n - 1)) * (W - PL - PR),
    Y: (v) => H - PB - ((v - span.lo) / (top - span.lo)) * (H - PT - PB),
  };
}

/** Interpolate a series' y value at a fractional position along it. */
function seriesValueAt(values: number[], t: number): number {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0]!;
  const s = Math.min(Math.max(t, 0), 1) * (values.length - 1);
  const i = Math.floor(s);
  const f = s - i;
  const a = values[i]!;
  const b = values[Math.min(i + 1, values.length - 1)]!;
  return a + (b - a) * f;
}

type UnitBuilder = (unit: UnitPlan) => Revealable;

/**
 * Row builders shared by frame and layer — mirrors the `planChart` row
 * loop: series → its label, marks and notes as short writes.
 *
 * `ownerTag` (layer builds only): every node appended into the FRAME's svg
 * is stamped `data-bansho-layer-owner`, so a rebuild of the same layer
 * content can clear its previous contribution first (see the idempotence
 * note on `chartLayerFactory`). Frame builds append into their own fresh
 * node and need no tag.
 */
function rowBuilders(
  doc: Document,
  svg: StyledElement,
  frame: ChartFrameStep,
  rows: readonly ChartLayerRow[],
  scales: ChartScales,
  rnd: Rand,
  ownerTag?: string,
): UnitBuilder[] {
  const { X, Y } = scales;
  const builders: UnitBuilder[] = [];
  const mount = <T extends Element>(node: T): T => {
    if (ownerTag !== undefined) {
      node.setAttribute("data-bansho-layer-owner", ownerTag);
    }
    svg.appendChild(node);
    return node;
  };
  /**
   * Resolve the series a mark references — from the STEP MODEL first, so a
   * `+ mark` row may precede its `+ series` row in the same block (§4.4
   * imposes no ordering, and builders execute in plan = row order, so a
   * DOM-only lookup would miss any series mounted later). Resolution order
   * (name collisions are pathological — first match wins, documented):
   * this block's rows → the frame's rows → already-mounted DOM (series
   * accumulated by EARLIER layer blocks, unreachable through the model).
   */
  const findSeries = (name: string): number[] | undefined => {
    for (const r of rows) {
      if (r.kind === "series" && r.name === name) return r.values;
    }
    for (const r of frame.rows) {
      if (r.kind === "series" && r.name === name) return r.values;
    }
    for (const p of Array.from(svg.querySelectorAll("[data-bansho-series]"))) {
      if (p.getAttribute("data-bansho-series") === name) {
        try {
          return JSON.parse(p.getAttribute("data-bansho-values") ?? "[]") as number[];
        } catch {
          return undefined;
        }
      }
    }
    return undefined;
  };

  for (const row of rows) {
    if (row.kind === "series") {
      let lastPt: [number, number] = [W - PR, PT];
      let color = seriesColor(0);
      builders.push((unit) => {
        const index = svg.querySelectorAll("[data-bansho-series]").length;
        color = seriesColor(index);
        const pts = row.values.map(
          (v, i) => [X(i, row.values.length), Y(v)] as [number, number],
        );
        lastPt = pts[pts.length - 1] ?? lastPt;
        let length = 0;
        for (let i = 1; i < pts.length; i++) {
          length += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
        }
        const path = el(doc, "path", { d: sketchPath(pts, rnd, 0.9) }, {
          fill: "none",
          stroke: color,
          strokeWidth: "2.9px",
          strokeLinecap: "round",
          strokeLinejoin: "round",
        });
        path.setAttribute("data-bansho-series", row.name);
        path.setAttribute("data-bansho-values", JSON.stringify(row.values));
        mount(path);
        return strokeReveal([{ path, length: Math.max(length, 1) }], {
          duration: unit.duration,
          srcSpan: unit.srcSpan,
          ease: Ease.trace,
        });
      });
      builders.push((unit) => {
        // G8-C — right-anchored at the canvas edge, extending left; the
        // pen just landed at the line's end, the name sweeps back from it.
        const last = row.values[row.values.length - 1];
        const unitSuffix = frame.y?.unit ?? "";
        const value =
          last !== undefined
            ? `${unitSuffix === "%" && last > 0 ? "+" : ""}${last}${unitSuffix}`
            : "";
        const lab = el(
          doc,
          "text",
          { x: W - 4, y: lastPt[1] - 18, "font-size": 23, "text-anchor": "end" },
          { fill: color, fontFamily: HAND_FONT },
        );
        lab.textContent = value ? `${row.name} ${value}` : row.name;
        mount(lab);
        return clipWipe(lab, {
          duration: unit.duration,
          srcSpan: unit.srcSpan,
          ease: Ease.write,
          side: "rtl",
          opacityRamp: 2.4,
        });
      });
    } else {
      builders.push((unit) => {
        const t = xFraction(row.x, frame.x);
        let point: [number, number] | undefined;
        if (row.kind === "mark") {
          const values = findSeries(row.series);
          if (values && t !== undefined) {
            point = [PL + t * (W - PL - PR), Y(seriesValueAt(values, t))];
          }
        } else {
          // Whole-string parse, like `xFraction`: `parseFloat("40abc")`
          // silently reads 40 and mounts the note at a lie (R5).
          const y = wholeNumber(row.y);
          if (t !== undefined && Number.isFinite(y)) {
            point = [PL + t * (W - PL - PR), Y(y)];
          }
        }
        if (!point) {
          // R5-class degradation must be VISIBLE: the beat still spends its
          // planned time (parity), but a silent pause reads as a hang and
          // the agent has no signal to self-heal from.
          const what =
            row.kind === "mark"
              ? `mark references series "${row.series}" @ "${row.x}"`
              : `note @ "${row.x}" / "${row.y}"`;
          console.warn(
            `[bansho] chart "${frame.chart}": ${what} — unresolvable ` +
              `(unknown series or unplaceable coordinates); degrading to an ` +
              `inert beat`,
          );
          return inertRevealable(unit);
        }
        // Near the right edge, anchor end so the text extends left (G8-C);
        // near the LEFT edge, anchor start so it extends right — a
        // middle-anchored CJK label at t≈0 clips at the viewBox edge (the
        // mirrored side of the same overflow rule). Marks sit BELOW their
        // point: the series label already owns the space above the line's
        // end (observed overlap in the T3 visual pass), and below-the-point
        // never fights the label row.
        const nearRight = point[0] > W - PR - 60;
        const nearLeft = !nearRight && point[0] < PL + 60;
        const text = el(
          doc,
          "text",
          {
            x: nearRight
              ? Math.min(point[0], W - 4)
              : nearLeft
                ? Math.max(point[0] - 24, 4)
                : point[0],
            y: Math.min(point[1] + 24, H - PB - 6),
            "font-size": 19,
            "text-anchor": nearRight ? "end" : nearLeft ? "start" : "middle",
          },
          { fill: "var(--accent, currentColor)", fontFamily: HAND_FONT },
        );
        text.textContent = row.text;
        mount(text);
        return clipWipe(text, {
          duration: unit.duration,
          srcSpan: unit.srcSpan,
          ease: Ease.write,
          opacityRamp: 2.4,
        });
      });
    }
  }
  return builders;
}

/** Run builders against the plan 1:1, padding mismatches inertly. */
function materialize(
  units: UnitPlan[],
  builders: UnitBuilder[],
  what: string,
): Revealable[] {
  if (builders.length !== units.length) {
    // Factory/plan drift is a bug — degrade defensively, loudly (R6).
    console.warn(
      `[bansho] ${what}: plan has ${units.length} units but the factory ` +
        `built ${builders.length} — padding with inert units`,
    );
  }
  return units.map((unit, i) => builders[i]?.(unit) ?? inertRevealable(unit));
}

export const chartFrameFactory: RevealableFactory = {
  kind: "chart-frame",
  build(step, ctx) {
    const doc = ctx.document;
    const node = doc.createElement("div");
    node.className = "bansho-chart";
    const svg = el(doc, "svg", { viewBox: `0 0 ${W} ${H}` });
    svg.style.display = "block";
    svg.style.width = "100%";
    svg.style.overflow = "visible";
    node.appendChild(svg);

    const units = planStepUnits(step, ctx.durations);
    if (step.kind !== "chart-frame") {
      return { node, revealables: units.map(inertRevealable) };
    }
    const rnd = mulberry32(contentSeed(step));
    const scales = chartScales(step);
    const { X, Y } = scales;
    const builders: UnitBuilder[] = [];

    // Axis lines, x → y (§4.4; plan order — the prototype drew y first,
    // rev 4 serializes x first).
    const axisLine = (d: string): UnitBuilder => {
      return (unit) => {
        const path = el(doc, "path", { d }, {
          fill: "none",
          stroke: BOARD_FG,
          strokeWidth: "2.2px",
          strokeLinecap: "round",
        });
        svg.appendChild(path);
        return strokeReveal([{ path, length: W }], {
          duration: unit.duration,
          srcSpan: unit.srcSpan,
          ease: Ease.steady,
        });
      };
    };
    if (step.x) {
      builders.push(axisLine(jitterLine(PL, H - PB, W - PR + 38, H - PB, rnd, 1.6)));
    }
    if (step.y) {
      builders.push(axisLine(jitterLine(PL, PT, PL, H - PB, rnd, 1.6)));
    }

    // One y tick per NUMERIC entry — tick dash + value, fading in as one
    // group (fully serialized: one unit each, I4). Non-numeric entries plan
    // no unit (finiteYTickEntries — the SAME predicate `planChart` uses, so
    // plan↔builder parity holds by construction and the board never spends
    // a beat fading in an empty <g>).
    if (step.y) {
      const yUnit = step.y.unit ?? "";
      for (const entry of finiteYTickEntries(step.y)) {
        builders.push((unit) => {
          const g = el(doc, "g", {});
          const y = Y(Number.parseFloat(entry));
          g.appendChild(
            el(doc, "path", { d: jitterLine(PL - 9, y, PL + 8, y, rnd, 1) }, {
              fill: "none",
              stroke: BOARD_FG,
              strokeWidth: "2px",
              strokeLinecap: "round",
            }),
          );
          const lab = el(
            doc,
            "text",
            { x: PL - 15, y: y + 6, "text-anchor": "end", "font-size": 19 },
            { fill: BOARD_FG, fontFamily: HAND_FONT },
          );
          lab.textContent = `${entry}${yUnit}`;
          g.appendChild(lab);
          svg.appendChild(g);
          return fadeReveal(g, { duration: unit.duration, srcSpan: unit.srcSpan });
        });
      }
    }

    // One x label per declared entry.
    if (step.x) {
      const entries = axisEntries(step.x);
      entries.forEach((entry, i) => {
        builders.push((unit) => {
          const n = entries.length;
          const x =
            i === 0
              ? PL + 24
              : i === n - 1
                ? W - PR + 6
                : X(i, n);
          const text = el(
            doc,
            "text",
            { x, y: H - PB + 32, "text-anchor": "middle", "font-size": 19 },
            { fill: BOARD_FG, fontFamily: HAND_FONT },
          );
          text.textContent = entry;
          svg.appendChild(text);
          return fadeReveal(text, {
            duration: unit.duration,
            srcSpan: unit.srcSpan,
          });
        });
      });
    }

    builders.push(...rowBuilders(doc, svg, step, step.rows, scales, rnd));
    return {
      node,
      revealables: materialize(units, builders, `chart "${step.chart}" frame`),
    };
  },
};

/**
 * Rebuild semantics (§7 R4/R4′ — the layer factory MUTATES the frame's
 * node, so `build` is NOT freely repeatable):
 *
 *  - Same-content rebuild (R4′ recompile after an earlier divergence)
 *    never duplicates: every node this layer appends into the frame's svg
 *    is stamped with the layer's content seed, and a rebuild clears its
 *    own previous contribution first. Full idempotence — `seriesColor`
 *    index included — holds ONLY while this layer is the LAST-mounted
 *    contribution on its chart: the series index is read from the live
 *    DOM count at build time, so rebuilding a layer that has later layers
 *    behind it re-appends its nodes at the end and its index (hence
 *    color) shifts. That path is unreachable under the cascade rule below
 *    (re-run ALL layers in order), which is exactly why the cascade is
 *    contract, not advice.
 *  - Changed-content rebuild (R4: same block, new hash) changes the seed,
 *    so the old contribution CANNOT be recognized here. The host must
 *    honour the cascade rule on `MeasureContext.chart`: rebuild the frame
 *    (a fresh node) and re-run every layer of that chart in document
 *    order. Stale strokes after skipping the cascade are a host bug.
 *  - Caveat: two DISTINCT layer steps with byte-identical content share a
 *    seed (see `contentSeed`); the second build clears the first's nodes.
 *    The drawn pixels are identical (same seed → byte-identical jitter),
 *    so the board looks the same — only the first twin's reveal beat goes
 *    blank. Accepted: a duplicated identical block is already outside the
 *    accumulation discipline.
 */
export const chartLayerFactory: RevealableFactory = {
  kind: "chart-layer",
  build(step, ctx: MeasureContext) {
    const doc = ctx.document;
    // A layer occupies no space of its own — space returns to the chart's
    // home; this marker keeps document flow (and the host's step anchors)
    // intact without painting anything.
    const node = doc.createElement("div") as StyledElement;
    node.className = "bansho-chart-layer";
    node.style.display = "none";

    const units = planStepUnits(step, ctx.durations);
    if (step.kind !== "chart-layer") {
      return { node, revealables: units.map(inertRevealable) };
    }
    const home = ctx.container(containerKey("chart", step.chart));
    const frame = home?.frame.kind === "chart-frame" ? home.frame : undefined;
    const svg = home?.node.querySelector("svg") as StyledElement | null;
    if (!frame || !svg) {
      // Host bookkeeping gap (an orphan layer degrades to BadStep at parse
      // time, R5, and never reaches here) — degrade, loudly, never throw.
      console.warn(
        `[bansho] chart layer "${step.chart}" found no frame node — ` +
          `rendering nothing for ${units.length} unit(s)`,
      );
      return { node, revealables: units.map(inertRevealable) };
    }
    const seed = contentSeed(step);
    const ownerTag = String(seed);
    // Idempotence for the same-content rebuild path: clear this layer's own
    // previous contribution before appending afresh (see the factory JSDoc).
    for (const stale of Array.from(
      svg.querySelectorAll(`[data-bansho-layer-owner="${ownerTag}"]`),
    )) {
      stale.remove();
    }
    const rnd = mulberry32(seed);
    const builders = rowBuilders(
      doc,
      svg,
      frame,
      step.rows,
      chartScales(frame),
      rnd,
      ownerTag,
    );
    return {
      node,
      revealables: materialize(units, builders, `chart "${step.chart}" layer`),
    };
  },
};

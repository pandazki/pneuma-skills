/**
 * Where a chart annotation attaches — the ONE resolver for `@ x`.
 *
 * Layering (G2): engine core — zero DOM, zero React, pure and
 * byte-deterministic.
 *
 * It lives on its own because two layers ask the same question and MUST
 * get the same answer:
 *  - the parser (`domain.ts`) asks it to tell the agent, at parse time,
 *    that a `+ mark` / `+ note` row it wrote cannot be placed — the row is
 *    otherwise perfectly readable, so nothing else would ever say so;
 *  - the chart factory (`factories/chart.ts`) asks it to decide whether to
 *    draw the annotation or degrade the beat.
 *
 * Two copies of this arithmetic would drift into the worst possible pair
 * of bugs: the board reporting a problem it does not have, or (the M4
 * defect) drawing nothing while the report says everything is fine.
 */

import type { ChartAxis } from "./types.js";

/**
 * WHOLE-string numeric parse — `Number("2023Q3")` is NaN where
 * `parseFloat("2023Q3")` reads 2023. On a range axis like
 * `x: 2023Q1 .. 2024Q4`, prefix parsing collapsed every non-endpoint
 * quarter to t≈0/1 and SILENTLY mounted marks/notes at a lie; refusing the
 * partial parse drops such references into the caller's loud inert path
 * instead (R5-class degradation must be visible). Empty/whitespace guards
 * against the `Number("") === 0` trap.
 */
export function wholeNumber(s: string): number {
  const t = s.trim();
  return t === "" ? Number.NaN : Number(t);
}

/**
 * Resolve a mark/note x reference to a 0..1 fraction of the plot width.
 *
 * What an axis accepts (this IS the rule the reference file documents):
 *  - enumerated axis (`x: 第1月 第2月 …`) — one of the values, written
 *    exactly;
 *  - range axis (`x: a .. b`) — either endpoint, written exactly, or any
 *    number between two NUMERIC endpoints.
 *
 * Anything else is unplaceable — including every interior quarter of
 * `x: 2023Q1 .. 2024Q4`, which no arithmetic can order.
 */
export function xFraction(
  x: string,
  axis: ChartAxis | undefined,
): number | undefined {
  if (!axis) return undefined;
  if (axis.values) {
    const i = axis.values.indexOf(x);
    if (i === -1) return undefined;
    return axis.values.length <= 1 ? 0.5 : i / (axis.values.length - 1);
  }
  if (axis.from !== undefined && axis.to !== undefined) {
    if (x === axis.from) return 0;
    if (x === axis.to) return 1;
    const v = wholeNumber(x);
    const from = wholeNumber(axis.from);
    const to = wholeNumber(axis.to);
    if (Number.isFinite(v) && Number.isFinite(from) && Number.isFinite(to) && to !== from) {
      return (v - from) / (to - from);
    }
  }
  return undefined;
}

/** The two ends of the numeric interval a y axis declares. */
export interface AxisSpan {
  /** The lowest declared number — the value that sits ON the baseline. */
  lo: number;
  /** The highest declared number — before the plot's headroom is added. */
  hi: number;
}

/**
 * The numeric interval a y axis declares — the ONE reading of "what range
 * does this plot cover", and it lives here for the same reason `xFraction`
 * does: the parser asks it (to refuse a declaration that can scale
 * nothing) and the chart factory asks it (to map a value to a canvas y),
 * and the two must never answer differently.
 *
 * A range names BOTH its ends (`y: -40 .. 25`), so `lo` is a real
 * declaration and not an assumed zero — reading only the peak pinned every
 * plot's floor at 0 and threw the declared lower end off the canvas
 * (`Y(-40)` landed 410px below a 420-tall viewBox).
 *
 * Three outcomes, and the caller owes each a different answer:
 *  - `null` — the axis declares no numbers at all (a categorical
 *    `y: 低 .. 高`, or no axis): legitimate, scale off the data.
 *  - `hi > lo` — a usable interval.
 *  - `hi <= lo` — a declaration that names no interval (`y: 0 .. 0`, or
 *    the `y: 0 ..` typo whose second end never parses). NOTHING can be
 *    scaled against it, and quietly substituting a scale of one's own
 *    draws a picture whose axis labels contradict its own line. Refuse it.
 *
 * `parseFloat` rather than `wholeNumber` is deliberate: the tick beats are
 * planned off `inference.ts::finiteYTickEntries`, which reads the entries
 * exactly this way, and a tick drawn at a value the scale did not see is
 * the precise divergence this module exists to prevent.
 */
export function yAxisSpan(axis: ChartAxis | undefined): AxisSpan | null {
  if (!axis) return null;
  const entries = axis.values
    ? axis.values
    : [axis.from, axis.to].filter((v): v is string => v !== undefined);
  const numbers = entries
    .map((v) => Number.parseFloat(v))
    .filter((v) => Number.isFinite(v));
  if (numbers.length === 0) return null;
  return { lo: Math.min(...numbers), hi: Math.max(...numbers) };
}

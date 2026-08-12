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

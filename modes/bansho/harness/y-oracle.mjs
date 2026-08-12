#!/usr/bin/env bun
/**
 * y-oracle — the §7.5 box-spacing model, run offline against a layout-baseline
 * capture. It is the arithmetic half of the canvas pivot's re-basing protocol
 * (design §12.2 item 3):
 *
 *   3b  MODEL fidelity — oracle vs the OLD capture's real CSS `y`.
 *       Margin-collapse corners and baseline effects live HERE; every delta
 *       is attributed and recorded in layout-baseline/README.md.
 *   3a  IMPLEMENTATION fidelity — the NEW capture's `y` vs the same oracle,
 *       zero tolerance. Because item 2 pins h/margins unchanged, any 3a
 *       delta can only be a positioning-engine bug. The two are NOT
 *       interchangeable: a 3a failure must never be explained away as a 3b
 *       modelling difference.
 *
 * The model (design §7.5), quoted in the board's own frame:
 *
 *   y(first box) = mt(first)              // front = 0; the board's padding
 *                                         // blocks collapse-through, so CSS
 *                                         // honours the first box's own
 *                                         // margin-top and so do we
 *   y(next)      = y(prev) + h(prev) + gap(prev, next)
 *   gap(a, b)    = max(marginBottom(a), marginTop(b))   // collapsing, explicit
 *   rect.top     = boardPadding.top + y
 *
 * Feeding it the OLD capture's h and margins is what keeps it non-circular:
 * the inputs are the previous build's measured reality.
 *
 * Usage:
 *   bun modes/bansho/harness/y-oracle.mjs <capture.json> [more.json ...]
 *   bun modes/bansho/harness/y-oracle.mjs --h <old.json> <new.json>
 *     (3a: chain the oracle on OLD h/margins, check it against NEW rects)
 */

import { readFileSync } from "node:fs";

/** Float noise from `getBoundingClientRect` rounded at 0.01 in the probe. */
const ROUND_EPS = 0.02;

/**
 * A step participates in the vertical chain when it takes flow space. Two
 * classes do not: a `hidden` step (an unmaterialised chart layer — zero
 * client rect) and an absolutely positioned back-reference overlay, whose
 * ink is measured onto its target and never pushes anything down.
 */
const OUT_OF_FLOW = new Set(["bansho-ink", "bansho-backref"]);

function isFlowBox(step) {
  if (step.hidden) return false;
  if (!step.rect) return false;
  return !OUT_OF_FLOW.has(step.cls);
}

/** Chain the §7.5 model over a capture's flow boxes. */
export function oracleTops(capture, heightsFrom = capture) {
  const padTop = capture.boardPadding?.[0] ?? 0;
  const hByRef = new Map(
    heightsFrom.steps.map((s) => [s.ref, s]),
  );
  const out = new Map();
  let y = null;
  let prev = null;
  for (const step of capture.steps) {
    if (!isFlowBox(step)) continue;
    const src = hByRef.get(step.ref) ?? step;
    const mt = src.margins?.[0] ?? 0;
    const mb = src.margins?.[1] ?? 0;
    const h = src.rect?.[3] ?? 0;
    if (prev === null) {
      y = mt;
    } else {
      y = prev.y + prev.h + Math.max(prev.mb, mt);
    }
    out.set(step.ref, Math.round((padTop + y) * 100) / 100);
    prev = { y, h, mb };
  }
  return out;
}

function report(label, capture, heightsFrom) {
  const oracle = oracleTops(capture, heightsFrom);
  const rows = [];
  for (const step of capture.steps) {
    if (!isFlowBox(step)) continue;
    const actual = step.rect[1];
    const want = oracle.get(step.ref);
    const delta = Math.round((actual - want) * 100) / 100;
    if (Math.abs(delta) > ROUND_EPS) {
      rows.push({ ref: step.ref, cls: step.cls, want, actual, delta });
    }
  }
  const total = [...oracle.keys()].length;
  console.log(
    `${label}: ${total} flow boxes, ${rows.length} beyond ±${ROUND_EPS}px`,
  );
  for (const r of rows) {
    console.log(
      `  ${r.ref.padEnd(8)} ${r.cls.padEnd(16)} oracle ${r.want}  actual ${r.actual}  Δ ${r.delta > 0 ? "+" : ""}${r.delta}`,
    );
  }
  return rows;
}

// The CLI half runs only when this file IS the program. `oracleTops` is
// imported by __tests__/box-oracle.test.ts, which judges the fold against
// this very model — without the guard the import would run the argv branch
// and `process.exit` out of the test runner.
const args = import.meta.main ? process.argv.slice(2) : null;
if (args === null) {
  // imported as a module — nothing to do
} else if (args[0] === "--h") {
  // 3a: the oracle is chained on the OLD build's h/margins and checked
  // against the NEW build's rects — the check the box model must pass with
  // zero deltas and zero attribution.
  const oldCap = JSON.parse(readFileSync(args[1], "utf8"));
  const newCap = JSON.parse(readFileSync(args[2], "utf8"));
  const rows = report(`3a ${args[2]}`, newCap, oldCap);
  process.exit(rows.length === 0 ? 0 : 1);
} else {
  let bad = 0;
  for (const file of args) {
    const cap = JSON.parse(readFileSync(file, "utf8"));
    bad += report(`3b ${file}`, cap, cap).length;
  }
  process.exit(bad === 0 ? 0 : 1);
}

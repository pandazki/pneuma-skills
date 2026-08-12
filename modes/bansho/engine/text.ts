/**
 * Step text & identity vocabulary — engine-owned, zero external imports (G2).
 *
 * `BackRefTarget.start/end` and `AlignInfo.at` (engine/types.ts) are offsets
 * into the string THIS module computes; keeping the functions inside
 * `engine/` keeps the engine's own offset vocabulary from being imported
 * upward out of the layer (and keeps the G2 zero-external-import grep clean).
 */

import type { InlineRun, Step } from "./types.js";

/**
 * The step's visible plain text: inline runs concatenated, markers stripped.
 * `BackRefTarget.start/end` and `AlignInfo.at` are offsets into THIS string;
 * viewers must use this exact function when mapping them back to DOM ranges.
 * Soft breaks contribute a single space; ink runs with `children` recurse
 * (nested-mark delimiters never leak); math runs contribute NOTHING — zero
 * characters (a deliberate v1 boundary). Two downstream duties follow:
 *  - back references can never target or span formula text — a quoted
 *    target that includes or crosses a `$…$` run degrades to
 *    `refUnresolved` (adjacent text runs meet with a doubled space where
 *    the formula sat). The SKILL.md dialect guidance (T7) must state this
 *    boundary so the agent is never taught a gesture that silently fails.
 *  - the viewer's offset→DOM mapping (T4) must treat math nodes as
 *    ZERO-WIDTH when recovering ranges from these offsets.
 */
export function stepPlainText(step: Step): string {
  if (!("inline" in step)) return "";
  let out = "";
  for (const run of step.inline) out += runPlainText(run);
  return out;
}

/** One run's contribution to `stepPlainText` (recursive over ink children). */
function runPlainText(run: InlineRun): string {
  if (run.kind === "break") return " ";
  if (run.kind === "math") return "";
  if (run.kind === "ink" && run.children) {
    let out = "";
    for (const child of run.children) out += runPlainText(child);
    return out;
  }
  return run.text;
}

/**
 * The content-hash half of step identity (§4.5: identity = (block order,
 * content hash)) — the edit-stable half. The positional half is the step's
 * place in flat document order, derivable by flattening `Lecture.sections`;
 * a `StepRef` is only its section-relative address, not an edit-stable id
 * (see `ScheduleContext.durationOverride`). This is the memo key behind
 * §7 R1/R4 and §7.4 — measurement caching and React render memoization
 * ("零重播") both key on it.
 *
 * Hashes the step's own source slice (`lecture.source` at `step.srcSpan`),
 * so it is position-independent: identical content at shifted offsets (a
 * prefix edit) keeps its key, and any content change misses the cache.
 * FNV-1a 32-bit — deterministic, dependency-free, byte-stable across runs.
 */
export function stepContentHash(step: Step, source: string): string {
  const slice = source.slice(step.srcSpan.start, step.srcSpan.end);
  let h = 0x811c9dc5;
  for (let i = 0; i < slice.length; i++) {
    h ^= slice.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

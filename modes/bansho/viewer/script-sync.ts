/**
 * 讲稿 ↔ playback synchronization helpers (G6 consumers) — pure functions
 * shared by the script pane and the board host. No DOM here except the
 * plain-range → span mapper, which takes nodes as plain arguments and is
 * happy-dom testable.
 */

import type { Revealable, SrcSpan, StepSchedule } from "../engine/types.js";

/**
 * Expand a source span to full line boundaries — the 行级 highlight unit.
 * A text reveal unit's span is a 1–2 char segment; the pane highlights the
 * LINE(s) containing it. Chart rows span exactly their own source row, so
 * a playing series highlights precisely its `+ …` line, never the block
 * (G6 — the whole-block highlight was prototyped and rejected).
 */
export function lineSpanOf(source: string, span: SrcSpan): SrcSpan {
  const start = source.lastIndexOf("\n", Math.max(span.start - 1, 0)) + 1;
  let end = source.indexOf("\n", Math.max(span.end - 1, span.start));
  if (end === -1) end = source.length;
  return { start, end };
}

/**
 * The schedule entry the pen is on (or has most recently finished) at
 * canonical time `t` — the highlight anchor. Binary search for the LAST
 * entry with `start <= t`; during pen-up gaps the previous entry stays lit
 * (a flickering pane on every word gap was the alternative). -1 before the
 * first pen-down.
 */
export function activeScheduleIndex(
  schedule: readonly StepSchedule[],
  t: number,
): number {
  if (!Number.isFinite(t)) return -1;
  let lo = 0;
  let hi = schedule.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (schedule[mid]!.start <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/**
 * The precise source span an active schedule entry performs: the built
 * revealable's span (G6 — factories carry per-unit spans, chart rows
 * included) with the step's own span as fallback for units not built yet
 * (R2 — scheduled before first measurement; image/html plan no units at
 * all since round 3, so "kind without a factory" no longer reaches here).
 */
export function scheduleEntrySpan(
  entry: StepSchedule,
  units: readonly Revealable[] | undefined,
  stepSpan: SrcSpan,
): SrcSpan {
  return units?.[entry.unit]?.srcSpan ?? stepSpan;
}

// ── 讲稿 pane decoration (chrome-level, mirrors the prototype pane) ─────────

/** Dialect mark pattern — highlight/bold/strike/circle/math/directive/fence. */
const MARK_RE =
  /(==[^=\n]+==|\*\*[^*\n]+\*\*|~~[^~\n]+~~|\(\([^)\n]+\)\)|\$\$[\s\S]+?\$\$|\$[^$\n]+\$|^@[^\n]*$|```chart[\s\S]*?```|```[\s\S]*?```)/gm;

export interface ScriptSegment {
  start: number;
  end: number;
  /** `""` plain · `"m"` dialect mark · `"blk"` fenced block. */
  cls: "" | "m" | "blk";
}

/**
 * Segment the whole script by dialect marks. Depends on the source ALONE —
 * the pane memoizes it per document, so the full-source regex scan runs
 * once per agent edit and never per reveal unit (the active line advances
 * ~15×/s during playback; re-scanning tens of KB of script at that rate is
 * exactly the jank the pane's header forbids).
 */
export function decorateScript(source: string): ScriptSegment[] {
  const segments: ScriptSegment[] = [];
  let last = 0;
  for (const m of source.matchAll(MARK_RE)) {
    const at = m.index ?? 0;
    if (at > last) segments.push({ start: last, end: at, cls: "" });
    segments.push({
      start: at,
      end: at + m[0].length,
      cls: m[0].startsWith("```") ? "blk" : "m",
    });
    last = at + m[0].length;
  }
  if (last < source.length) {
    segments.push({ start: last, end: source.length, cls: "" });
  }
  return segments;
}

export interface ScriptPart {
  key: number;
  text: string;
  cls: string;
  now: boolean;
}

/**
 * Split decorated segments around the active LINE. The active range splits
 * whatever segment it lands in — chart blocks highlight per ROW, never as
 * a whole (G6). Cheap next to decoration, and the pane recomputes it only
 * when the highlighted line actually changes (value-stable `lineSpan`).
 */
export function splitAtLine(
  source: string,
  segments: readonly ScriptSegment[],
  lineSpan: SrcSpan | null,
): ScriptPart[] {
  const out: ScriptPart[] = [];
  let key = 0;
  for (const seg of segments) {
    const pieces =
      lineSpan && lineSpan.end > seg.start && lineSpan.start < seg.end
        ? [
            { s: seg.start, e: Math.max(seg.start, lineSpan.start), now: false },
            {
              s: Math.max(seg.start, lineSpan.start),
              e: Math.min(seg.end, lineSpan.end),
              now: true,
            },
            { s: Math.min(seg.end, lineSpan.end), e: seg.end, now: false },
          ]
        : [{ s: seg.start, e: seg.end, now: false }];
    for (const piece of pieces) {
      if (piece.e <= piece.s) continue;
      out.push({
        key: key++,
        text: source.slice(piece.s, piece.e),
        cls: seg.cls,
        now: piece.now,
      });
    }
  }
  return out;
}

/**
 * Map a `stepPlainText` character range onto the step's mounted `.bansho-w`
 * segment spans (the offset→DOM mapping, T4 duty; see engine/text.ts).
 *
 * Vocabulary: spans appear in plain-text order and their textContent is
 * byte-for-byte a slice of the step's plain text; whatever plain text sits
 * BETWEEN spans (inter-segment whitespace, soft-break spaces) has no span.
 * Math nodes contribute ZERO plain characters and no `.bansho-w` spans, so
 * they are transparently skipped — exactly the zero-width treatment the
 * vocabulary requires. A monotone cursor keeps repeated substrings honest.
 */
export function mapPlainRangeToSpans<E extends Element>(
  spans: readonly E[],
  plain: string,
  start: number,
  end: number,
): E[] {
  const hits: E[] = [];
  let cursor = 0;
  for (const span of spans) {
    const text = span.textContent ?? "";
    if (text.length === 0) continue;
    const at = plain.indexOf(text, cursor);
    if (at === -1) continue;
    if (at < end && start < at + text.length) hits.push(span);
    cursor = at + text.length;
  }
  return hits;
}

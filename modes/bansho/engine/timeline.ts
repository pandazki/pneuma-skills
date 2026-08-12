/**
 * Canonical timeline assembly — `(Lecture, measurements) → BoardTimeline`
 * (设计稿 §5): the single temporal truth that scrub, navigate-to, capture
 * and export all read.
 *
 * Layering (G2): engine core — pure, no DOM, no clock. The host drives
 * `seek(t)` from its own time source (`viewer/useBoardPlayer.ts`; a future
 * Remotion host uses frames). Measurements arrive as the factory-built
 * `Revealable[]` per step — in tests they are plain mocks, which is exactly
 * the point: this layer schedules and dispatches, it never builds.
 *
 * G1 (single pen) holds BY CONSTRUCTION: the schedule is laid out with one
 * monotonically advancing cursor over strictly serial plans — every entry
 * starts at or after the previous entry's end, no arithmetic path can
 * produce an overlap (negative gaps/durations are clamped to 0 upstream
 * and here).
 *
 * G3 (external duration override) is applied HERE and only here (see
 * `ScheduleContext.durationOverride` in types.ts — the single-applier
 * rule): a finite non-negative per-step override replaces the step's
 * content-derived total FOOTPRINT — measured from the step's start (right
 * after its lead-in) to its last pen-up — redistributing it proportionally
 * across the step's unit durations and gaps, a leading pen-lift inside the
 * step (a backref's travel to its target) included: narration audio starts
 * when the step starts, and the pen's travel is part of the performance it
 * covers. The trailing pen-up gap after the step's last unit stays natural
 * — the override covers the step's footprint, not the silence after it.
 * Negative / NaN / infinite overrides are ignored; a step whose natural
 * footprint is zero cannot be scaled and keeps its (zero-length) layout.
 */

import { planLecture } from "./inference.js";
import type {
  BoardTimeline,
  Lecture,
  Revealable,
  ScheduleContext,
  Step,
  StepRef,
  StepSchedule,
} from "./types.js";

/**
 * The measurement seam (§7.4 compile-measure pipeline). The host resolves
 * each step's factory-built reveal units; `undefined` means "not built yet"
 * — the schedule then falls back to the plan's content-derived durations
 * and those entries dispatch nowhere (a freshly appended step can be
 * scheduled before its first measurement lands; R2).
 *
 * Step object identity does not survive the streaming re-parse — hosts key
 * their caches by `stepContentHash` (engine/text.ts), never by reference.
 */
export interface TimelineMeasurements {
  unitsFor(ref: StepRef, step: Step): readonly Revealable[] | undefined;
}

const clampNonNegative = (n: number): number => (n > 0 ? n : 0);

/**
 * Compile the lecture into the canonical timeline. Deterministic: the same
 * lecture, constants, override hook and measurements yield a byte-identical
 * schedule (R8) — no randomness, no clocks, no key-order dependence.
 */
export function buildTimeline(
  lecture: Lecture,
  ctx: ScheduleContext,
  measurements?: TimelineMeasurements,
): BoardTimeline {
  const plans = planLecture(lecture, ctx.durations, ctx.stage);
  const schedule: StepSchedule[] = [];
  /** Parallel to `schedule`: the revealable each entry dispatches to. */
  const targets: Array<Revealable | undefined> = [];
  let cursor = 0;

  for (const plan of plans) {
    // The lead-in, host-overridable since 2026-08-12: a step whose
    // performance has migrated to another board needs the camera's walk to
    // fit in the pause before it (G1 — the pen waits while the camera
    // travels). Same single-applier discipline as `durationOverride`:
    // consulted here and only here, applied verbatim, ignored when it is
    // not a finite non-negative number.
    const naturalLead = clampNonNegative(plan.leadIn);
    const leadOverride = ctx.leadInOverride?.(plan.step, plan.ref, naturalLead);
    cursor +=
      leadOverride !== undefined &&
      Number.isFinite(leadOverride) &&
      leadOverride >= 0
        ? leadOverride
        : naturalLead;
    const n = plan.units.length;
    if (n === 0) continue; // waits contribute leadIn only; nothing to draw

    const built = measurements?.unitsFor(plan.ref, plan.step);
    // Measured naturalDuration wins per unit; the plan's content-derived
    // value is the fallback (unbuilt step, or a short measurement array —
    // the latter is a factory/plan mismatch, degraded defensively).
    const durs: number[] = plan.units.map((u, i) => {
      const measured = built?.[i]?.naturalDuration;
      return measured !== undefined && Number.isFinite(measured) && measured >= 0
        ? measured
        : clampNonNegative(u.duration);
    });
    const gapsBefore = plan.units.map((u) => clampNonNegative(u.gapBefore));
    const gapsAfter = plan.units.map((u) => clampNonNegative(u.gapAfter));

    // G3 — the step's natural FOOTPRINT: step start (post-leadIn) to last
    // pen-up. Every unit's leading pen-lift (gapBefore — unit 0's included:
    // a backref opens with the pen travelling to its target) and duration
    // count, plus the pen-up gaps BETWEEN units; the trailing gap stays out
    // (and stays unscaled below).
    let naturalTotal = 0;
    for (let i = 0; i < n; i++) {
      naturalTotal += gapsBefore[i]! + durs[i]!;
      if (i < n - 1) naturalTotal += gapsAfter[i]!;
    }
    let scale = 1;
    const override = ctx.durationOverride?.(plan.step, plan.ref, naturalTotal);
    if (
      override !== undefined &&
      Number.isFinite(override) &&
      override >= 0 &&
      naturalTotal > 0
    ) {
      scale = override / naturalTotal;
    }

    for (let i = 0; i < n; i++) {
      cursor += gapsBefore[i]! * scale;
      const start = cursor;
      const end = start + durs[i]! * scale;
      schedule.push({ step: plan.ref, unit: i, start, end });
      targets.push(built?.[i]);
      cursor = end;
      cursor += i < n - 1 ? gapsAfter[i]! * scale : gapsAfter[i]!;
    }
  }

  return {
    schedule,
    // Declared once (see BoardTimeline.duration): serial layout makes the
    // last entry's end the maximum. INTENDED consequence: a TRAILING
    // `@wait` (and any trailing pen-up gap) contributes nothing — the
    // duration ends at the last pen-up, so the scrub bar never ends on
    // silence. A wait between steps still delays everything after it.
    duration: schedule.length > 0 ? schedule[schedule.length - 1]!.end : 0,
    seek: makeSeek(schedule, targets),
  };
}

/**
 * The `seek(t)` dispatcher — a pure projection of canonical time onto unit
 * progress. Per frame it touches only the entries whose target progress
 * may have changed since the previous call (p 未变不调用):
 *
 *  - the schedule is serial, so at any `t` exactly the entries before the
 *    binary-searched boundary are done (p=1), at most the boundary entry is
 *    fractional, and everything after is untouched (p=0);
 *  - entries the playhead never reached are NEVER dispatched to — a freshly
 *    appended unit keeps its built (unrevealed) state until the pen gets
 *    there (R1: no replay of already-shown content, no premature writes);
 *  - unpaired entries (no measurement yet) dispatch nowhere;
 *  - non-finite `t` (NaN, ±Infinity) is a no-op — NaN would collapse the
 *    binary search, defeat the `lastP` guard (NaN !== NaN) and forward NaN
 *    into `Revealable.seek`, which promises p ∈ 0..1. The projection is
 *    total over its input domain.
 */
function makeSeek(
  schedule: StepSchedule[],
  targets: Array<Revealable | undefined>,
): (t: number) => void {
  const n = schedule.length;
  /** Last dispatched progress per entry; -1 = never dispatched. */
  const lastP = new Float64Array(n).fill(-1);
  let prevBoundary = 0;

  return (t: number): void => {
    if (!Number.isFinite(t)) return; // total contract: bad clocks are inert
    // Binary search: first entry whose end is strictly past `t`.
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (schedule[mid]!.end <= t) lo = mid + 1;
      else hi = mid;
    }
    const boundary = lo;

    // Only entries between the previous boundary and this one (inclusive)
    // can have a changed target progress; `lastP` guards re-dispatch.
    const from = Math.min(boundary, prevBoundary);
    const to = Math.max(boundary, prevBoundary);
    for (let i = from; i <= to && i < n; i++) {
      const s = schedule[i]!;
      const p =
        t >= s.end ? 1 : t <= s.start ? 0 : (t - s.start) / (s.end - s.start);
      if (lastP[i] !== p) {
        lastP[i] = p;
        targets[i]?.seek(p);
      }
    }
    prevBoundary = boundary;
  };
}

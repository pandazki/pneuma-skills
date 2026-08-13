/**
 * Engine contract conformance (T1 — the type freeze T2/T3 build on).
 *
 * Value-level pins for the `engine/types.ts` seams: a fake factory and
 * revealables exercise the shapes a T3 factory and the T2 scheduler must
 * satisfy, so a mis-shaped seam surfaces at T1 instead of at integration.
 * `bun test` runs the runtime shapes; `bun run typecheck` (tsc covers this
 * file) pins the declarations — including the negative space: re-adding
 * `durationOverride` to `MeasureContext` (F2) breaks the `@ts-expect-error`
 * pin below and fails the typecheck gate.
 *
 * Pins:
 *  - G2 — `Revealable.seek(p)` is a pure visual mapping: callable out of
 *    order and repeatedly; state is a function of the LAST `p` only.
 *  - G3 — `ScheduleContext.durationOverride` is per-step usable: a number
 *    for one `StepRef`, `undefined` for the rest; factories report
 *    content-derived durations from `durations` alone.
 *  - F2 — `MeasureContext` does NOT expose the G3 override (type-level).
 *  - F9/G1 — `BoardTimeline.duration` is the declared single temporal
 *    truth (= max(end), 0 when empty); schedule intervals non-overlapping.
 *  - T2↔T3 seam — `StepSchedule.unit` indexes BOTH `planStepUnits`' plan
 *    and the factory's revealables: a conforming factory derives its
 *    revealables FROM the plan (count, order, meaning — 1:1).
 */

import { describe, expect, test } from "bun:test";

import { planStepUnits } from "../engine/inference.js";
import type {
  BoardTimeline,
  DurationConstants,
  MeasureContext,
  Revealable,
  RevealableFactory,
  ScheduleContext,
  SrcSpan,
  Step,
  StepRef,
  StepSchedule,
} from "../engine/types.js";

// G10 prototype-measured initial values — any DurationConstants-shaped
// object works; using the real constants keeps the fixture honest.
const DURATIONS: DurationConstants = {
  perChar: 0.0195,
  wordBase: 0.052,
  cjkBoost: 1.5,
  gap: 0.026,
  comma: 0.13,
  period: 0.3,
  paraGap: 0.42,
  annotate: 0.44,
  annotDelay: 0.1,
  afterAnnot: 0.14,
  chartLead: 0.45,
  axis: 0.4,
  tick: 0.2,
  series: 1.45,
  label: 0.4,
  cameraRho: 1.42,
  cameraSpeed: 1.0,
  erase: 1.6,
  turn: 0.84,
  place: 0.84,
};

const PROSE: Step = {
  kind: "prose",
  inline: [{ kind: "text", text: "abc", srcSpan: { start: 0, end: 3 } }],
  srcSpan: { start: 0, end: 3 },
};

interface FakeRevealable extends Revealable {
  lastP: number | null;
  calls: number;
}

function makeRevealable(
  naturalDuration: number,
  srcSpan: SrcSpan,
): FakeRevealable {
  const unit: FakeRevealable = {
    naturalDuration,
    kind: "wipe",
    srcSpan,
    lastP: null,
    calls: 0,
    seek(p: number) {
      // Idempotent visual write — the resulting state depends on the last
      // `p` alone, never on call order or count (G2).
      unit.lastP = p;
      unit.calls += 1;
    },
  };
  return unit;
}

// The factory reports CONTENT-derived durations from `durations` only —
// it cannot even reference the G3 override (see negative-space pin below).
const factory: RevealableFactory = {
  kind: "prose",
  build(step, ctx) {
    return {
      node: {} as Element,
      revealables: [makeRevealable(ctx.durations.perChar * 3, step.srcSpan)],
    };
  },
};

// DOM handles are inert casts: the conformance subject is the seam shape;
// nothing here may actually touch a document (G2 pure layer discipline).
const measureCtx: MeasureContext = {
  durations: DURATIONS,
  document: {} as Document,
  measureHost: {} as Element,
  env: { handwritingFontActive: false, strokeFontCovers: () => false },
  container: () => undefined,
};

describe("engine/types.ts contract conformance", () => {
  test("G2 — factory build() yields revealables whose seek(p) is order-independent", () => {
    const { node, revealables } = factory.build(PROSE, measureCtx);
    expect(node).toBeDefined();
    expect(revealables).toHaveLength(1);

    const unit = revealables[0] as FakeRevealable;
    expect(unit.naturalDuration).toBeCloseTo(DURATIONS.perChar * 3);
    // G6 — a unit that cannot name its source is a contract violation.
    expect(unit.srcSpan).toEqual(PROSE.srcSpan);

    // Out-of-order and repeated seeks: state = f(last p), nothing else.
    for (const p of [0.5, 1, 0.25, 0.25, 0]) unit.seek(p);
    expect(unit.lastP).toBe(0);
    unit.seek(0.25);
    const after = unit.lastP;
    unit.seek(0.25);
    expect(unit.lastP).toBe(after);
  });

  test("G3 — ScheduleContext override is per-step: one StepRef hit, the rest undefined", () => {
    const overridden: StepRef = { section: 0, step: 2 };
    const scheduleCtx: ScheduleContext = {
      durations: DURATIONS,
      durationOverride: (_step, ref) =>
        ref.section === overridden.section && ref.step === overridden.step
          ? 9
          : undefined,
    };

    // The scheduler always supplies the step's content-derived footprint
    // as the third argument (T10: narration policy is a function of both
    // the audio length and this natural footprint).
    expect(
      scheduleCtx.durationOverride!(PROSE, { section: 0, step: 2 }, 1.5),
    ).toBe(9);
    expect(
      scheduleCtx.durationOverride!(PROSE, { section: 0, step: 0 }, 1.5),
    ).toBeUndefined();
    expect(
      scheduleCtx.durationOverride!(PROSE, { section: 1, step: 2 }, 1.5),
    ).toBeUndefined();

    // The hook is optional — a bare context is a valid ScheduleContext.
    const bare: ScheduleContext = { durations: DURATIONS };
    expect(bare.durationOverride).toBeUndefined();

    // Single duration-constants truth: hosts hand the SAME object to both
    // contexts (identity, not just equality).
    expect(measureCtx.durations).toBe(scheduleCtx.durations);
  });

  test("F2 — MeasureContext does not carry the G3 override (negative space)", () => {
    // Type-level pin: if MeasureContext ever regains `durationOverride`
    // (e.g. by re-adding `extends ScheduleContext`), this @ts-expect-error
    // becomes unused and `bun run typecheck` fails.
    // @ts-expect-error — durationOverride is ScheduleContext-only by design
    const leaked: undefined = measureCtx.durationOverride;
    expect(leaked).toBeUndefined();
  });

  test("T2↔T3 seam — a conforming factory builds 1:1 with planStepUnits (count, order, meaning)", () => {
    // `planStepUnits` is the canonical decomposition (inference.ts header):
    // `StepSchedule.unit` indexes into BOTH the plan and the factory's
    // revealables, so the canonical factory pattern is to DERIVE the
    // revealables from the plan instead of re-deriving the split. This pin
    // exercises that pattern value-level: same count, same order (srcSpan
    // per index), same meaning (content-derived duration per index).
    const twoWords: Step = {
      kind: "prose",
      inline: [{ kind: "text", text: "abc def", srcSpan: { start: 0, end: 7 } }],
      srcSpan: { start: 0, end: 7 },
    };
    const seamFactory: RevealableFactory = {
      kind: "prose",
      build(step, ctx) {
        const units = planStepUnits(step, ctx.durations);
        return {
          node: {} as Element,
          revealables: units.map((u) => makeRevealable(u.duration, u.srcSpan)),
        };
      },
    };

    const plan = planStepUnits(twoWords, DURATIONS);
    expect(plan.length).toBeGreaterThan(1); // order is only pinned with 2+
    const { revealables } = seamFactory.build(twoWords, measureCtx);
    expect(revealables).toHaveLength(plan.length);
    plan.forEach((u, i) => {
      expect(revealables[i]!.srcSpan).toEqual(u.srcSpan);
      expect(revealables[i]!.naturalDuration).toBeCloseTo(u.duration, 10);
    });
  });

  test("F9/G1 — BoardTimeline declares duration; schedule is non-overlapping", () => {
    const schedule: StepSchedule[] = [
      { step: { section: 0, step: 0 }, unit: 0, start: 0, end: 1.2 },
      { step: { section: 0, step: 0 }, unit: 1, start: 1.2, end: 2.0 },
      { step: { section: 0, step: 1 }, unit: 0, start: 2.4, end: 3.1 },
    ];
    const timeline: BoardTimeline = {
      schedule,
      duration: Math.max(0, ...schedule.map((s) => s.end)),
      seek: () => {},
    };

    expect(timeline.duration).toBe(3.1);
    // Single-pen invariant: pairwise non-overlapping, in order (G1).
    for (let i = 1; i < schedule.length; i++) {
      expect(schedule[i]!.start).toBeGreaterThanOrEqual(schedule[i - 1]!.end);
    }

    const empty: BoardTimeline = { schedule: [], duration: 0, seek: () => {} };
    expect(empty.duration).toBe(0);
  });
});

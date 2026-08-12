/**
 * T2 — canonical timeline assembly (`engine/timeline.ts`).
 *
 * The生死线 here is G1 (single pen): schedule intervals must be pairwise
 * non-overlapping on RANDOMLY GENERATED lectures — with random measurements
 * and random G3 overrides in play, because override scaling is the only
 * arithmetic that could ever manufacture an overlap. Plus: byte-level
 * determinism (R8), the G3 per-step override contract, measurement
 * injection through mock revealables (no DOM in this layer), and the
 * `seek(t)` dispatch discipline (p 未变不调用).
 */

import { describe, expect, test } from "bun:test";

import { parseLecture } from "../domain.js";
import { DEFAULT_DURATIONS } from "../engine/duration.js";
import { planLecture } from "../engine/inference.js";
import {
  buildTimeline,
  type TimelineMeasurements,
} from "../engine/timeline.js";
import type {
  Revealable,
  ScheduleContext,
  Step,
  StepRef,
  StepSchedule,
} from "../engine/types.js";

const D = DEFAULT_DURATIONS;
const CTX: ScheduleContext = { durations: D };

interface FakeRevealable extends Revealable {
  lastP: number | null;
  calls: number;
}

function fake(naturalDuration: number): FakeRevealable {
  const unit: FakeRevealable = {
    naturalDuration,
    kind: "wipe",
    srcSpan: { start: 0, end: 1 },
    lastP: null,
    calls: 0,
    seek(p: number) {
      unit.lastP = p;
      unit.calls += 1;
    },
  };
  return unit;
}

/** Deterministic mock measurements: unit i of step ref gets a formula
 *  duration — pure in (ref, i), so call order can never matter. */
function formulaMeasurements(
  lectureSrc: string,
): { measurements: TimelineMeasurements; builtFor(ref: StepRef): FakeRevealable[] | undefined } {
  const lecture = parseLecture(lectureSrc);
  const plans = planLecture(lecture, D);
  const byKey = new Map<string, FakeRevealable[]>();
  for (const plan of plans) {
    // Measure roughly half the steps — the rest fall back to plan durations.
    if ((plan.ref.section + plan.ref.step) % 2 !== 0) continue;
    byKey.set(
      `${plan.ref.section}:${plan.ref.step}`,
      plan.units.map((_, i) =>
        fake(((plan.ref.section * 31 + plan.ref.step * 7 + i) % 13) / 4 + 0.1),
      ),
    );
  }
  return {
    measurements: {
      unitsFor: (ref) => byKey.get(`${ref.section}:${ref.step}`),
    },
    builtFor: (ref) => byKey.get(`${ref.section}:${ref.step}`),
  };
}

/** G1 — assert strict serial order: sorted, non-negative, zero overlap. */
function assertSinglePen(schedule: StepSchedule[]): void {
  for (let i = 0; i < schedule.length; i++) {
    const s = schedule[i]!;
    expect(s.start).toBeGreaterThanOrEqual(0);
    expect(s.end).toBeGreaterThanOrEqual(s.start);
    if (i > 0) expect(s.start).toBeGreaterThanOrEqual(schedule[i - 1]!.end);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Random lecture generator (seeded — reproducible property tests)
// ────────────────────────────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CJK_WORDS = ["需求", "形状", "变了", "微调", "瓶颈", "结构性", "翻倍了"];
const LATIN_WORDS = ["the", "shape", "of", "demand", "GPU", "cluster"];

function randomInline(rnd: () => number): string {
  const parts: string[] = [];
  const n = 2 + Math.floor(rnd() * 6);
  for (let i = 0; i < n; i++) {
    const w =
      rnd() < 0.5
        ? CJK_WORDS[Math.floor(rnd() * CJK_WORDS.length)]!
        : LATIN_WORDS[Math.floor(rnd() * LATIN_WORDS.length)]!;
    const roll = rnd();
    if (roll < 0.12) parts.push(`==${w}==`);
    else if (roll < 0.2) parts.push(`**${w}**`);
    else if (roll < 0.26) parts.push(`~~${w}~~`);
    else if (roll < 0.3) parts.push(`((${w}))`);
    else if (roll < 0.34) parts.push(`$${w}$`);
    else if (roll < 0.38) parts.push("$100");
    else parts.push(w);
  }
  let line = parts.join(" ");
  if (rnd() < 0.5) line += "。";
  return line;
}

function randomBoard(seed: number): string {
  const rnd = mulberry32(seed);
  const blocks: string[] = [];
  let chartCount = 0;
  const n = 4 + Math.floor(rnd() * 10);
  for (let i = 0; i < n; i++) {
    const roll = rnd();
    if (roll < 0.1) blocks.push(`# 标题${i}`);
    else if (roll < 0.2) blocks.push(`## 小节${i}`);
    else if (roll < 0.45) blocks.push(randomInline(rnd));
    else if (roll < 0.53) blocks.push(`- 条目甲:${i}\n- 条目乙:${i + 1}`);
    else if (roll < 0.58) blocks.push("---");
    else if (roll < 0.63) blocks.push(`> 旁注 ${i}`);
    else if (roll < 0.7) {
      const name = `c${chartCount++}`;
      blocks.push(
        [
          `\`\`\`chart ${name}`,
          "x: A .. B",
          "y: 0 10 20",
          `+ s${i}: 1 2 3`,
          "```",
        ].join("\n"),
      );
      if (rnd() < 0.5) {
        blocks.push(`\`\`\`chart ${name}\n+ t${i}: 4 5 6\n\`\`\``);
      }
    } else if (roll < 0.72) blocks.push(`@wait ${(rnd() * 2).toFixed(1)}`);
    else if (roll < 0.77) blocks.push('@strike "需求"');
    else if (roll < 0.8) blocks.push('@circle "永远找不到的目标"'); // → bad
    else if (roll < 0.83) blocks.push("```chart\nbroken\n```"); // → bad
    else if (roll < 0.86) blocks.push("@with 甲"); // dead syntax → bad (G1)
    else if (roll < 0.89) blocks.push(`![图${i}](assets/${i}.png)`);
    // C2 camera verbs — G1 holds for stage moves exactly like pen moves.
    else if (roll < 0.92) blocks.push("@overview");
    else if (roll < 0.95) blocks.push('@focus "需求"');
    else if (roll < 0.97) blocks.push('@focus "永远找不到的锚"'); // → bad
    else blocks.push("$$E = mc^2$$");
  }
  return blocks.join("\n\n");
}

// ────────────────────────────────────────────────────────────────────────────
// G1 — the single-pen property, under measurements + overrides
// ────────────────────────────────────────────────────────────────────────────

describe("G1 single-pen invariant (property)", () => {
  test("random lectures schedule with pairwise zero overlap", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const src = randomBoard(seed);
      const { measurements } = formulaMeasurements(src);
      const ctx: ScheduleContext = {
        durations: D,
        // Pure-formula override: hits some steps, includes a zero.
        durationOverride: (_step, ref) =>
          ref.step % 5 === 2
            ? (ref.section + 1) * 1.3
            : ref.step % 7 === 3
              ? 0
              : undefined,
      };
      const timeline = buildTimeline(parseLecture(src), ctx, measurements);
      assertSinglePen(timeline.schedule);
      expect(timeline.duration).toBe(
        timeline.schedule.length
          ? timeline.schedule[timeline.schedule.length - 1]!.end
          : 0,
      );
    }
  });

  test("sampling the timeline never finds two units in progress", () => {
    for (let seed = 31; seed <= 40; seed++) {
      const src = randomBoard(seed);
      const { measurements } = formulaMeasurements(src);
      const ctx: ScheduleContext = {
        durations: D,
        durationOverride: (_step, ref) =>
          ref.step % 3 === 1 ? ref.section + 0.7 : undefined,
      };
      const timeline = buildTimeline(parseLecture(src), ctx, measurements);
      const { schedule, duration } = timeline;
      for (let k = 0; k <= 200; k++) {
        const t = (duration * k) / 200;
        let active = 0;
        for (const s of schedule) if (s.start < t && t < s.end) active++;
        expect(active).toBeLessThanOrEqual(1);
      }
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// R8 — determinism
// ────────────────────────────────────────────────────────────────────────────

describe("determinism (R8)", () => {
  /** The property tests' override formula — G3 scale multiplication is the
   *  only float arithmetic overrides add, so byte-identity must hold with
   *  it IN play. Built fresh per timeline (identical formula, distinct
   *  objects) to also prove the ctx holds no hidden state. */
  function overrideFormulaCtx(): ScheduleContext {
    return {
      durations: D,
      durationOverride: (_step, ref) =>
        ref.step % 5 === 2
          ? (ref.section + 1) * 1.3
          : ref.step % 7 === 3
            ? 0
            : undefined,
    };
  }

  test("same lecture + same measurements + same overrides → byte-identical schedule", () => {
    for (let seed = 41; seed <= 45; seed++) {
      const src = randomBoard(seed);
      const a = formulaMeasurements(src);
      const b = formulaMeasurements(src);
      const t1 = buildTimeline(parseLecture(src), overrideFormulaCtx(), a.measurements);
      const t2 = buildTimeline(parseLecture(src), overrideFormulaCtx(), b.measurements);
      expect(JSON.stringify(t1.schedule)).toBe(JSON.stringify(t2.schedule));
      expect(t1.duration).toBe(t2.duration);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// G3 — external duration override (the scheduler is the single applier)
// ────────────────────────────────────────────────────────────────────────────

const THREE_STEPS = "第一段落写字。\n\n第二段落也写字。\n\n第三段落收尾。";

function entriesOf(schedule: StepSchedule[], ref: StepRef): StepSchedule[] {
  return schedule.filter(
    (s) => s.step.section === ref.section && s.step.step === ref.step,
  );
}

describe("G3 duration override", () => {
  const target: StepRef = { section: 0, step: 1 };

  function overrideCtx(value: number): ScheduleContext {
    return {
      durations: D,
      durationOverride: (_step, ref) =>
        ref.section === target.section && ref.step === target.step
          ? value
          : undefined,
    };
  }

  test("one step's reveal window becomes exactly the injected seconds; the rest stay natural", () => {
    const baseline = buildTimeline(parseLecture(THREE_STEPS), CTX);
    const overridden = buildTimeline(parseLecture(THREE_STEPS), overrideCtx(9));

    const before = entriesOf(baseline.schedule, target);
    const after = entriesOf(overridden.schedule, target);
    const naturalSpan = before[before.length - 1]!.end - before[0]!.start;
    const newSpan = after[after.length - 1]!.end - after[0]!.start;
    expect(newSpan).toBeCloseTo(9, 6);
    expect(naturalSpan).not.toBeCloseTo(9, 6);

    // Steps before the target are byte-identical…
    const step0a = entriesOf(baseline.schedule, { section: 0, step: 0 });
    const step0b = entriesOf(overridden.schedule, { section: 0, step: 0 });
    expect(JSON.stringify(step0b)).toBe(JSON.stringify(step0a));
    // …and steps after shift by exactly the delta, keeping their length.
    const delta = newSpan - naturalSpan;
    const step2a = entriesOf(baseline.schedule, { section: 0, step: 2 });
    const step2b = entriesOf(overridden.schedule, { section: 0, step: 2 });
    expect(step2b[0]!.start).toBeCloseTo(step2a[0]!.start + delta, 6);
    expect(step2b[0]!.end - step2b[0]!.start).toBeCloseTo(
      step2a[0]!.end - step2a[0]!.start,
      6,
    );
    assertSinglePen(overridden.schedule);
  });

  test("G3 semantic on a step with a leading pen-lift (backref): the override is the step's whole FOOTPRINT from step start", () => {
    // A backref's FIRST unit carries gapBefore = annotDelay (the pen's
    // travel to its target) — the only step kind today whose unit 0 has a
    // leading pen-lift. The injected seconds cover the step's footprint
    // from step start (leading pen-lift INCLUDED, scaled with the rest),
    // not merely pen-down → pen-up: narration audio starts when the step
    // starts, and the pen's travel is part of the performance it covers.
    const src = '结论成立。\n\n@circle "结论"';
    const baseline = buildTimeline(parseLecture(src), CTX);
    const overridden = buildTimeline(parseLecture(src), overrideCtx(9));

    const before = entriesOf(baseline.schedule, target);
    const after = entriesOf(overridden.schedule, target);
    expect(before).toHaveLength(1);
    expect(after).toHaveLength(1);

    // Step start = baseline pen-down minus the natural leading pen-lift
    // (steps before the target are untouched, so it is the same in both).
    const stepStart = before[0]!.start - D.annotDelay;
    // Footprint (step start → last pen-up) becomes exactly the injection…
    expect(after[0]!.end - stepStart).toBeCloseTo(9, 6);
    // …so the pen-down → pen-up window is proportionally LESS than 9: the
    // scaled leading pen-lift consumes its share (footprint semantics —
    // asserting the window at 9 would be the rejected reading).
    const window = after[0]!.end - after[0]!.start;
    expect(window).toBeCloseTo((9 * D.annotate) / (D.annotDelay + D.annotate), 6);
    expect(window).toBeLessThan(9);
    assertSinglePen(overridden.schedule);
  });

  test("relative unit proportions survive redistribution", () => {
    const overridden = buildTimeline(parseLecture(THREE_STEPS), overrideCtx(9));
    const baseline = buildTimeline(parseLecture(THREE_STEPS), CTX);
    const a = entriesOf(baseline.schedule, target);
    const b = entriesOf(overridden.schedule, target);
    expect(b).toHaveLength(a.length);
    const ratio =
      (b[0]!.end - b[0]!.start) / (a[0]!.end - a[0]!.start);
    for (let i = 1; i < a.length; i++) {
      expect(
        (b[i]!.end - b[i]!.start) / (a[i]!.end - a[i]!.start),
      ).toBeCloseTo(ratio, 6);
    }
  });

  test("zero override collapses the step to a zero-length window (finite ⇒ applied)", () => {
    const overridden = buildTimeline(parseLecture(THREE_STEPS), overrideCtx(0));
    const entries = entriesOf(overridden.schedule, target);
    expect(entries.length).toBeGreaterThan(0);
    expect(
      entries[entries.length - 1]!.end - entries[0]!.start,
    ).toBeCloseTo(0, 10);
    assertSinglePen(overridden.schedule);
  });

  test("non-finite and negative overrides are ignored", () => {
    const baseline = JSON.stringify(
      buildTimeline(parseLecture(THREE_STEPS), CTX).schedule,
    );
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -3]) {
      expect(
        JSON.stringify(
          buildTimeline(parseLecture(THREE_STEPS), overrideCtx(bad)).schedule,
        ),
      ).toBe(baseline);
    }
  });

  test("override on a unit-less step (@wait) is a no-op, not a crash", () => {
    const src = "甲\n\n@wait 1\n\n乙";
    const seen: StepRef[] = [];
    const ctx: ScheduleContext = {
      durations: D,
      durationOverride: (_step, ref) => {
        seen.push(ref);
        return 5;
      },
    };
    const timeline = buildTimeline(parseLecture(src), ctx);
    assertSinglePen(timeline.schedule);
    // The wait step never reaches the override — it has nothing to scale.
    expect(seen.some((r) => r.section === 0 && r.step === 1)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Measurements — external measured durations flow into the schedule
// ────────────────────────────────────────────────────────────────────────────

describe("measurement injection", () => {
  test("measured naturalDuration replaces the content-derived value per unit", () => {
    const src = "one two";
    const built = [fake(10), fake(20)];
    const timeline = buildTimeline(parseLecture(src), CTX, {
      unitsFor: (ref) => (ref.section === 0 && ref.step === 0 ? built : undefined),
    });
    expect(timeline.schedule).toHaveLength(2);
    expect(timeline.schedule[0]!.end - timeline.schedule[0]!.start).toBeCloseTo(10, 10);
    expect(timeline.schedule[1]!.end - timeline.schedule[1]!.start).toBeCloseTo(20, 10);
  });

  test("a short measurement array falls back to plan durations for the rest", () => {
    const src = "one two three";
    const timeline = buildTimeline(parseLecture(src), CTX, {
      unitsFor: () => [fake(10)],
    });
    expect(timeline.schedule).toHaveLength(3);
    expect(timeline.schedule[0]!.end - timeline.schedule[0]!.start).toBeCloseTo(10, 10);
    // Units 1..2 keep the I8 content-derived duration.
    const wordLen = timeline.schedule[1]!.end - timeline.schedule[1]!.start;
    expect(wordLen).toBeLessThan(1);
    assertSinglePen(timeline.schedule);
  });

  test("an over-long measurement array truncates to the plan — surplus revealables never schedule, never dispatch", () => {
    // The mirror of the short-array fallback above: a factory that built
    // MORE revealables than `planStepUnits` planned is a T3 factory bug
    // (the 1:1 seam, inference.ts header). The scheduler degrades
    // defensively — the schedule stays 1:1 with the PLAN and the surplus
    // unit is silently dropped: it never seeks and never reports.
    const src = "one two";
    const built = [fake(10), fake(20), fake(30)]; // the plan has 2 units
    const timeline = buildTimeline(parseLecture(src), CTX, {
      unitsFor: (ref) => (ref.section === 0 && ref.step === 0 ? built : undefined),
    });
    expect(timeline.schedule).toHaveLength(2);
    timeline.seek(timeline.duration + 1);
    expect(built[0]!.lastP).toBe(1);
    expect(built[1]!.lastP).toBe(1);
    expect(built[2]!.lastP).toBeNull();
    expect(built[2]!.calls).toBe(0);
    assertSinglePen(timeline.schedule);
  });

  test("超长 step — a 2000-char CJK paragraph stays strictly serial", () => {
    const src = "字".repeat(2000);
    const timeline = buildTimeline(parseLecture(src), CTX);
    expect(timeline.schedule).toHaveLength(1000); // I9: 2 chars per segment
    assertSinglePen(timeline.schedule);
    expect(timeline.duration).toBeGreaterThan(0);
  });

  test("empty and chart-only boards are safe", () => {
    const empty = buildTimeline(parseLecture(""), CTX);
    expect(empty.schedule).toEqual([]);
    expect(empty.duration).toBe(0);
    empty.seek(0); // no crash
    empty.seek(99);

    const chartOnly = buildTimeline(
      parseLecture("```chart a\nx: A .. B\ny: 1 2\n+ s: 1 2\n```"),
      CTX,
    );
    expect(chartOnly.schedule.length).toBeGreaterThan(0);
    assertSinglePen(chartOnly.schedule);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// seek(t) — dispatch discipline
// ────────────────────────────────────────────────────────────────────────────

describe("seek(t) dispatch", () => {
  function seekFixture(): {
    timeline: ReturnType<typeof buildTimeline>;
    units: FakeRevealable[];
  } {
    const src = "one two three";
    const units = [fake(1), fake(1), fake(1)];
    const timeline = buildTimeline(parseLecture(src), CTX, {
      unitsFor: (ref) => (ref.section === 0 && ref.step === 0 ? units : undefined),
    });
    return { timeline, units };
  }

  test("mid-unit seek: done units at 1, active fractional, future untouched", () => {
    const { timeline, units } = seekFixture();
    const mid = timeline.schedule[1]!;
    timeline.seek((mid.start + mid.end) / 2);
    expect(units[0]!.lastP).toBe(1);
    expect(units[1]!.lastP).toBeGreaterThan(0);
    expect(units[1]!.lastP).toBeLessThan(1);
    // A unit the playhead never reached keeps its built state — seek must
    // not touch it (R1: freshly appended units never get replayed writes).
    expect(units[2]!.lastP).toBeNull();
    expect(units[2]!.calls).toBe(0);
  });

  test("a frame coarser than the steps it crosses leaves every one FULLY revealed", () => {
    // At 16× one rAF frame advances ~0.27 canonical seconds, which is
    // longer than several units of writing — so units get skipped by the
    // clock entirely. `seek(p)` is a projection, not an animation: a unit
    // the playhead jumped over must land at 1, exactly once, never
    // half-drawn (this is the whole point of the contract, so it is
    // measured rather than assumed).
    const { timeline, units } = seekFixture();
    expect(units.length).toBeGreaterThan(2);
    // One "frame" that swallows the first two units whole.
    const past = timeline.schedule[1]!.end + 1e-9;
    timeline.seek(past);
    expect(units[0]!.lastP).toBe(1);
    expect(units[1]!.lastP).toBe(1);
    expect(units[0]!.calls).toBe(1); // p=1 reached in ONE dispatch
    expect(units[1]!.calls).toBe(1);
    // And a single frame from 0 straight past the end reveals all of them.
    const { timeline: t2, units: u2 } = seekFixture();
    t2.seek(t2.duration * 4);
    expect(u2.map((u) => u.lastP)).toEqual([1, 1, 1]);
    expect(u2.map((u) => u.calls)).toEqual([1, 1, 1]);
  });

  test("p 未变不调用 — repeated same-t seeks do not re-dispatch", () => {
    const { timeline, units } = seekFixture();
    const mid = timeline.schedule[1]!;
    const t = (mid.start + mid.end) / 2;
    timeline.seek(t);
    const calls = units.map((u) => u.calls);
    timeline.seek(t);
    timeline.seek(t);
    expect(units.map((u) => u.calls)).toEqual(calls);
  });

  test("scrub back and forth lands on consistent state (pure projection)", () => {
    const { timeline, units } = seekFixture();
    timeline.seek(timeline.duration + 5);
    expect(units.map((u) => u.lastP)).toEqual([1, 1, 1]);
    timeline.seek(0);
    expect(units.map((u) => u.lastP)).toEqual([0, 0, 0]);
    timeline.seek(-1); // clamped
    expect(units.map((u) => u.lastP)).toEqual([0, 0, 0]);
    const end0 = timeline.schedule[0]!.end;
    timeline.seek(end0); // boundary: exactly finished
    expect(units[0]!.lastP).toBe(1);
    // Every dispatched p stays within [0, 1] (G8-H scrub safety).
    for (const u of units) {
      if (u.lastP !== null) {
        expect(u.lastP).toBeGreaterThanOrEqual(0);
        expect(u.lastP).toBeLessThanOrEqual(1);
      }
    }
  });

  test("non-finite t is ignored — NaN never reaches Revealable.seek", () => {
    // NaN would collapse the binary search to boundary 0 and make every
    // dispatched p NaN; NaN !== NaN defeats the lastP guard, so the entry
    // would re-dispatch every frame and corrupt T3 easing (Revealable.seek
    // promises p ∈ 0..1). The guard makes seek total over its domain:
    // non-finite t (NaN, ±Infinity) is a no-op.
    const { timeline, units } = seekFixture();
    timeline.seek(Number.NaN); // as the very first call: dispatches nothing
    expect(units.map((u) => u.calls)).toEqual([0, 0, 0]);

    const mid = timeline.schedule[1]!;
    timeline.seek((mid.start + mid.end) / 2);
    const state = units.map((u) => [u.lastP, u.calls]);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      timeline.seek(bad);
      expect(units.map((u) => [u.lastP, u.calls])).toEqual(state);
    }
    // The dispatcher stays healthy after the rejected inputs.
    timeline.seek(timeline.duration);
    expect(units.map((u) => u.lastP)).toEqual([1, 1, 1]);
  });

  test("steps without measurements schedule but dispatch nowhere (no crash)", () => {
    const src = "one two\n\nthree four";
    const timeline = buildTimeline(parseLecture(src), CTX);
    timeline.seek(timeline.duration / 2);
    timeline.seek(timeline.duration);
    timeline.seek(0);
    assertSinglePen(timeline.schedule);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// G3's twin — the LEAD-IN override (2026-08-12): the walk to another board
// ────────────────────────────────────────────────────────────────────────────

describe("leadInOverride — the pause before a step, widened for a journey", () => {
  const SRC = "alpha beta\n\ngamma delta\n\nepsilon zeta";

  /** The natural start of every step, with no lead-in policy at all. */
  const naturalStarts = (): number[] => {
    const t = buildTimeline(parseLecture(SRC), { durations: D });
    return t.schedule.filter((s) => s.unit === 0).map((s) => s.start);
  };

  test("a widened lead-in pushes its step (and everything after it) later, by exactly the difference", () => {
    const base = naturalStarts();
    const timeline = buildTimeline(parseLecture(SRC), {
      durations: D,
      // The second step's walk takes a full second where its breath was
      // `paraGap` — MAX, the shape the host applies.
      leadInOverride: (_step, ref, natural) =>
        ref.step === 1 ? Math.max(natural, 1) : undefined,
    });
    const starts = timeline.schedule.filter((s) => s.unit === 0).map((s) => s.start);
    const shift = 1 - D.paraGap;
    expect(starts[0]).toBeCloseTo(base[0]!, 9);
    expect(starts[1]).toBeCloseTo(base[1]! + shift, 9);
    // The pause is exclusive time: nothing was compressed to pay for it.
    expect(starts[2]).toBeCloseTo(base[2]! + shift, 9);
    assertSinglePen(timeline.schedule);
  });

  test("the walk's window is real dead air — the previous step ends a full walk earlier", () => {
    const timeline = buildTimeline(parseLecture(SRC), {
      durations: D,
      leadInOverride: (_step, ref, natural) =>
        ref.step === 1 ? Math.max(natural, 1) : undefined,
    });
    const entries = timeline.schedule;
    const target = entries.find((s) => s.step.step === 1 && s.unit === 0)!;
    const before = entries.filter((s) => s.end <= target.start).pop()!;
    // G1: the walk `[start - 1, start)` cannot reach back into it.
    expect(target.start - before.end).toBeGreaterThanOrEqual(1);
  });

  test("a shorter override still applies verbatim — the engine holds no policy", () => {
    const base = naturalStarts();
    const timeline = buildTimeline(parseLecture(SRC), {
      durations: D,
      leadInOverride: (_step, ref) => (ref.step === 1 ? 0 : undefined),
    });
    const starts = timeline.schedule.filter((s) => s.unit === 0).map((s) => s.start);
    expect(starts[1]).toBeCloseTo(base[1]! - D.paraGap, 9);
  });

  test("negative / NaN / infinite overrides are ignored — the natural breath survives", () => {
    const base = naturalStarts();
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const timeline = buildTimeline(parseLecture(SRC), {
        durations: D,
        leadInOverride: () => bad,
      });
      const starts = timeline.schedule
        .filter((s) => s.unit === 0)
        .map((s) => s.start);
      expect(starts).toEqual(base);
    }
  });

  test("no hook at all is byte-identical to before the seam existed", () => {
    const a = buildTimeline(parseLecture(SRC), { durations: D });
    const b = buildTimeline(parseLecture(SRC), {
      durations: D,
      leadInOverride: () => undefined,
    });
    expect(b.schedule).toEqual(a.schedule);
    expect(b.duration).toBe(a.duration);
  });

  test("it does NOT touch the step's footprint — that is durationOverride's half", () => {
    const plain = buildTimeline(parseLecture(SRC), { durations: D });
    const led = buildTimeline(parseLecture(SRC), {
      durations: D,
      leadInOverride: (_s, ref, natural) =>
        ref.step === 1 ? Math.max(natural, 1) : undefined,
    });
    const span = (t: typeof plain, step: number): number => {
      const own = t.schedule.filter((s) => s.step.step === step);
      return own[own.length - 1]!.end - own[0]!.start;
    };
    expect(span(led, 1)).toBeCloseTo(span(plain, 1), 9);
  });
});

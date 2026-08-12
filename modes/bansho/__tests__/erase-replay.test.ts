/**
 * Erase replay (C3) — the phase's core gate, plus G8-L's exclusive-channel
 * proof.
 *
 * The three-layer scenario the spec derives (rev 2 §2.2): C1 written, E1
 * erases it, C2 written IN THE SAME PLACE, E2 erases C2. Scrub from after
 * everything back to when only C1 stood — the board must show EXACTLY C1.
 * This exercises `makeSeek`'s real index-ascending window walk with the
 * real strategy mechanics on both sides, because that dispatch order IS
 * the G8-L failure mode: `C.seek(0.5)` then `E.seek(0)` must leave a
 * half-revealed C half-revealed, which only holds if erase never writes
 * a property any strategy owns.
 *
 * Everything here goes through the real pipeline: real dialect text →
 * `parseLecture` → `buildTimeline` with real `fadeReveal` / `clipWipe` /
 * `eraserReveal` units bound to fake style elements (the strategies are
 * pure style-writers, so a `{ style: {} }` object is a faithful board).
 */

import { describe, expect, test } from "bun:test";

import { parseLecture } from "../domain.js";
import { DEFAULT_DURATIONS } from "../engine/duration.js";
import { easeEraser, eraserReveal } from "../engine/factories/eraser.js";
import { planLecture } from "../engine/inference.js";
import { buildTimeline } from "../engine/timeline.js";
import { fadeReveal } from "../engine/strategies/fade.js";
import { clipWipe } from "../engine/strategies/wipe.js";
import type { StyledElement } from "../engine/strategies/stroke.js";
import type {
  EraseTargetHandle,
  Revealable,
  Step,
  StepRef,
} from "../engine/types.js";

const D = DEFAULT_DURATIONS;

/** A board element: records every style write, remembers only the last. */
const fakeEl = (): StyledElement =>
  ({ style: {} as CSSStyleDeclaration }) as unknown as StyledElement;

const handleOf = (el: StyledElement): EraseTargetHandle => ({
  resolve: () => el as unknown as { style: { clipPath: string } },
});

const key = (ref: StepRef): string => `${ref.section}:${ref.step}`;

describe("erase replay — the canonical three-layer scenario", () => {
  // 甲。 / @erase / 乙。 / @erase — two writings on the same board, each
  // erased. Single-segment prose ("X。" is one I9 segment) keeps every
  // step at exactly one reveal unit.
  const SRC = "甲。\n\n@erase\n\n乙。\n\n@erase\n";
  const lecture = parseLecture(SRC);

  const c1 = fakeEl();
  const c2 = fakeEl();
  const wrap1 = fakeEl();
  const wrap2 = fakeEl();

  const unitsByKey = new Map<string, Revealable[]>();
  const span = { start: 0, end: 1 };
  unitsByKey.set("0:0", [fadeReveal(c1, { duration: 1, srcSpan: span })]);
  unitsByKey.set("0:1", [
    eraserReveal(handleOf(wrap1), { duration: D.erase, srcSpan: span, seed: 7 }),
  ]);
  unitsByKey.set("0:2", [fadeReveal(c2, { duration: 1, srcSpan: span })]);
  unitsByKey.set("0:3", [
    eraserReveal(handleOf(wrap2), { duration: D.erase, srcSpan: span, seed: 8 }),
  ]);

  const timeline = buildTimeline(lecture, { durations: D }, {
    unitsFor: (ref) => unitsByKey.get(key(ref)),
  });

  const windows = new Map(
    timeline.schedule.map((s) => [key(s.step), { start: s.start, end: s.end }]),
  );

  test("the lecture compiles to four exclusive windows in document order (G1)", () => {
    expect(timeline.schedule.length).toBe(4);
    const sorted = [...timeline.schedule].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) {
      // Pairwise zero overlap — erase windows hold exclusive stage time.
      expect(sorted[i]!.start).toBeGreaterThanOrEqual(sorted[i - 1]!.end);
    }
  });

  test("at the end everything is written and both boards stand erased", () => {
    timeline.seek(timeline.duration + 1);
    expect(c1.style.opacity).toBe("1");
    expect(c2.style.opacity).toBe("1");
    expect(wrap1.style.clipPath).toBe("inset(0 0 0 100%)");
    expect(wrap2.style.clipPath).toBe("inset(0 0 0 100%)");
  });

  test("scrubbed back to when only C1 stood, the board shows EXACTLY C1", () => {
    timeline.seek(timeline.duration + 1); // from after everything…
    const c1End = windows.get("0:0")!.end;
    const e1Start = windows.get("0:1")!.start;
    timeline.seek((c1End + e1Start) / 2); // …back to between C1 and E1
    expect(c1.style.opacity).toBe("1"); // C1 reappears (E1 rolled back)
    expect(wrap1.style.clipPath).toBe(""); // E1 removed its own state
    expect(c2.style.opacity).toBe("0"); // C2 not written yet
    expect(wrap2.style.clipPath).toBe(""); // E2 rolled back too
  });

  test("scrubbed to between the erases, the board shows EXACTLY C2", () => {
    timeline.seek(0);
    timeline.seek(timeline.duration + 1);
    const c2End = windows.get("0:2")!.end;
    const e2Start = windows.get("0:3")!.start;
    timeline.seek((c2End + e2Start) / 2);
    expect(c1.style.opacity).toBe("1"); // written…
    expect(wrap1.style.clipPath).toBe("inset(0 0 0 100%)"); // …and erased
    expect(c2.style.opacity).toBe("1");
    expect(wrap2.style.clipPath).toBe("");
  });

  test("G1 at runtime: sampling the whole timeline, at most ONE unit is ever mid-flight", () => {
    // The single pen holds through erases: an eraser sweep is stage time
    // like any stroke. Track every unit's last-dispatched progress and
    // sample densely — at no instant may two units sit strictly between
    // 0 and 1.
    const lecture2 = parseLecture(SRC);
    const lastP = new Map<string, number>();
    const tracked = (key2: string, unit: Revealable): Revealable => ({
      ...unit,
      seek(p) {
        lastP.set(key2, p);
        unit.seek(p);
      },
    });
    const units2 = new Map<string, Revealable[]>();
    for (const [k, us] of unitsByKey) {
      units2.set(
        k,
        us.map((u, i) => tracked(`${k}#${i}`, u)),
      );
    }
    const tl = buildTimeline(lecture2, { durations: D }, {
      unitsFor: (ref) => units2.get(key(ref)),
    });
    for (let i = 0; i <= 400; i++) {
      tl.seek((tl.duration * i) / 400);
      let inFlight = 0;
      for (const p of lastP.values()) {
        if (p > 0 && p < 1) inFlight++;
      }
      expect(inFlight).toBeLessThanOrEqual(1);
    }
  });

  test("scrub purity: any query order lands on the same board state", () => {
    const probes = [0, timeline.duration + 1, 0.01, timeline.duration / 2];
    for (const t of probes) timeline.seek(t);
    const c1End = windows.get("0:0")!.end;
    timeline.seek((c1End + windows.get("0:1")!.start) / 2);
    expect(c1.style.opacity).toBe("1");
    expect(c2.style.opacity).toBe("0");
    expect(wrap1.style.clipPath).toBe("");
  });
});

describe("G8-L — erase owns an exclusive visual channel", () => {
  test("scrubbing into a fade's own reveal window keeps it HALF revealed", () => {
    // C fades in over [start, end]; E erases it later. From after E, scrub
    // to C's midpoint: dispatch order is C.seek(0.5) THEN E.seek(0) —
    // if erase wrote opacity, the "restore" would blow C to fully visible.
    const SRC = "甲。\n\n@erase\n";
    const lecture = parseLecture(SRC);
    const c = fakeEl();
    const wrap = fakeEl();
    const span = { start: 0, end: 1 };
    const units = new Map<string, Revealable[]>([
      ["0:0", [fadeReveal(c, { duration: 1, srcSpan: span })]],
      [
        "0:1",
        [eraserReveal(handleOf(wrap), { duration: D.erase, srcSpan: span, seed: 3 })],
      ],
    ]);
    const timeline = buildTimeline(lecture, { durations: D }, {
      unitsFor: (ref) => units.get(key(ref)),
    });
    const cWin = timeline.schedule.find((s) => key(s.step) === "0:0")!;
    timeline.seek(timeline.duration + 1); // C fully erased
    timeline.seek(cWin.start + (cWin.end - cWin.start) / 2);
    expect(c.style.opacity).toBe("0.5"); // half revealed — NOT restored to 1
    expect(wrap.style.clipPath).toBe(""); // the eraser's own state removed
  });

  test("the same holds for a wipe-revealed unit (clip-path lives on different elements)", () => {
    const SRC = "甲。\n\n@erase\n";
    const lecture = parseLecture(SRC);
    const c = fakeEl();
    const wrap = fakeEl();
    const span = { start: 0, end: 1 };
    const units = new Map<string, Revealable[]>([
      ["0:0", [clipWipe(c, { duration: 1, srcSpan: span, ease: (p) => p })]],
      [
        "0:1",
        [eraserReveal(handleOf(wrap), { duration: D.erase, srcSpan: span, seed: 3 })],
      ],
    ]);
    const timeline = buildTimeline(lecture, { durations: D }, {
      unitsFor: (ref) => units.get(key(ref)),
    });
    const cWin = timeline.schedule.find((s) => key(s.step) === "0:0")!;
    timeline.seek(timeline.duration + 1);
    timeline.seek(cWin.start + (cWin.end - cWin.start) / 2);
    // The wipe's own clip window is half open — the eraser touched only
    // ITS element, so the strategy's channel survived the round trip.
    expect(c.style.clipPath).toBe("inset(0 50.00% 0 0)");
    expect(wrap.style.clipPath).toBe("");
  });

  test("the eraser writes ONE property on ONE element — nothing a strategy owns", () => {
    const writes: string[] = [];
    const el = {
      style: new Proxy({} as Record<string, string>, {
        set(target, prop, value) {
          writes.push(String(prop));
          target[String(prop)] = String(value);
          return true;
        },
      }),
    };
    const unit = eraserReveal(
      { resolve: () => el as { style: { clipPath: string } } },
      { duration: 1, srcSpan: { start: 0, end: 1 }, seed: 5 },
    );
    for (const p of [0, 0.25, 0.5, 0.75, 1, 0.5, 0]) unit.seek(p);
    expect(new Set(writes)).toEqual(new Set(["clipPath"]));
  });

  test("an unresolvable target is a quiet no-op, never a throw", () => {
    const unit = eraserReveal(
      { resolve: () => null },
      { duration: 1, srcSpan: { start: 0, end: 1 }, seed: 5 },
    );
    expect(() => {
      unit.seek(0.5);
      unit.seek(1);
    }).not.toThrow();
  });
});

describe("eraser mechanics", () => {
  test("easeEraser is strictly monotone on [0,1] with exact endpoints (G8-H)", () => {
    expect(easeEraser(0)).toBe(0);
    expect(easeEraser(1)).toBe(1);
    let prev = 0;
    for (let k = 1; k <= 150; k++) {
      const v = easeEraser(k / 150);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });

  test("the sweep is deterministic and idempotent: same p, byte-identical clip", () => {
    const el = fakeEl();
    const opts = { duration: 1, srcSpan: { start: 0, end: 1 }, seed: 42 };
    const a = eraserReveal(handleOf(el), opts);
    a.seek(0.37);
    const first = el.style.clipPath;
    a.seek(0.9);
    a.seek(0.37);
    expect(el.style.clipPath).toBe(first);
    // A fresh unit with the same seed sweeps the same streaks (scrub
    // never makes the edge dance).
    const el2 = fakeEl();
    eraserReveal(handleOf(el2), opts).seek(0.37);
    expect(el2.style.clipPath).toBe(first);
  });

  test("the hidden fraction grows monotonically and ends EXACTLY hidden", () => {
    const el = fakeEl();
    const unit = eraserReveal(handleOf(el), {
      duration: 1,
      srcSpan: { start: 0, end: 1 },
      seed: 9,
    });
    // Track the sweep front's minimum x — visible region is right of it.
    let prevFront = -1;
    for (let k = 1; k < 40; k++) {
      unit.seek(k / 40);
      const xs = [...el.style.clipPath.matchAll(/([\d.]+)% [\d.]+%/g)]
        .map((m) => Number(m[1]))
        .slice(2); // skip the two fixed right-edge points
      const front = Math.min(...xs);
      expect(front).toBeGreaterThanOrEqual(prevFront);
      prevFront = front;
    }
    unit.seek(1);
    expect(el.style.clipPath).toBe("inset(0 0 0 100%)"); // exact, no sliver
    unit.seek(0);
    expect(el.style.clipPath).toBe(""); // own state fully removed
  });
});

describe("plan integration (C3)", () => {
  test("an @erase step plans one exclusive erase unit with its own line as srcSpan (G6)", () => {
    const SRC = "甲。\n\n@erase\n";
    const lecture = parseLecture(SRC);
    const plans = planLecture(lecture, D);
    const erasePlan = plans.find((p) => p.step.kind === "erase")!;
    expect(erasePlan.units.length).toBe(1);
    expect(erasePlan.units[0]!.kind).toBe("erase");
    expect(erasePlan.units[0]!.duration).toBe(D.erase);
    expect(erasePlan.units[0]!.srcSpan).toEqual({
      start: SRC.indexOf("@erase"),
      end: SRC.indexOf("@erase") + "@erase".length,
    });
  });

  test("NO content step ever plans a leading erase unit — the synthesis has no way back in (design §2.3)", () => {
    // Until 2026-08-11 this test read "auto-erase rides the triggering
    // step as a LEADING unit". The plan layer took an `autoEraseBefore`
    // set and prepended an eraser to the named steps. Auto-erase is gone,
    // and so is the option — an erase unit on the canonical timeline can
    // now only come from an `@erase` STEP an author wrote.
    const SRC = "甲。\n\n乙。\n";
    const lecture = parseLecture(SRC);
    const plans = planLecture(lecture, D);
    for (const plan of plans) {
      expect(plan.step.kind).not.toBe("erase"); // no erase in this source…
      for (const unit of plan.units) expect(unit.kind).not.toBe("erase"); // …so none in the plan
    }
    // The seam itself: the whole stage input is one boolean now, and no
    // value of it can synthesize a unit onto a content step.
    for (const stage of [{}, { omitStageSteps: true }, { omitStageSteps: false }]) {
      for (const plan of planLecture(lecture, D, stage)) {
        for (const unit of plan.units) expect(unit.kind).not.toBe("erase");
      }
    }
    // Every unit still names its source (G6 100%).
    for (const p of plans) {
      for (const u of p.units) {
        expect(u.srcSpan.end).toBeGreaterThan(u.srcSpan.start);
      }
    }
  });

  test("the notes projection plans NOTHING for camera and erase steps, and renumbers nothing", () => {
    const SRC = "甲。\n\n@erase\n\n@overview\n\n乙。\n";
    const lecture = parseLecture(SRC);
    const board = planLecture(lecture, D);
    const notes = planLecture(lecture, D, { omitStageSteps: true });
    expect(board.some((p) => p.step.kind === "erase")).toBe(true);
    expect(board.some((p) => p.step.kind === "camera")).toBe(true);
    expect(notes.some((p) => p.step.kind === "erase")).toBe(false);
    expect(notes.some((p) => p.step.kind === "camera")).toBe(false);
    // The content steps keep their engine addresses — the projection
    // neutralizes, it never renumbers (agent addresses stay valid).
    const contentRefs = (plans: typeof board) =>
      plans
        .filter((p) => p.step.kind === "prose")
        .map((p) => `${p.ref.section}:${p.ref.step}`);
    expect(contentRefs(notes)).toEqual(contentRefs(board));
    expect(contentRefs(notes)).toEqual(["0:0", "0:3"]);
  });
});

/**
 * T11 — the complete end-to-end suite. Five commissioned coverage areas
 * (spec: docs/proposals/2026-08-07-bansho-tasks.md §T11-impl); the sections
 * below are numbered to match:
 *
 *  [1] Streaming R1–R8, per rule, driven by SIMULATED FileChangeEvent
 *      sequences through the REAL production seam — the bansho manifest's
 *      `aggregate-file` config (loadBoard) mounted on a fake FileChannel.
 *      No chokidar anywhere.
 *  [2] G1 single-pen regression on ALL FOUR seed boards — compile-layer
 *      zero overlap AND runtime sampling ≤ 1 with real factory-built
 *      revealables, on the Board produced by the SOURCE pipeline (not a
 *      direct parse — the two paths diverging is itself a bug class).
 *  [3] Inference-layer property: canonical determinism — same input bytes,
 *      byte-identical plan and schedule, on generated boards and on the
 *      shipped seeds.
 *  [4] Dialect combination surface: formula × backref × align group ×
 *      chart continuation, all six pairs, plus the known
 *      formula-crossing-strike trap.
 *  [5] board.md → playable timeline, full chain (here); the
 *      `bun run dev bansho` boot smoke lives in `dev-smoke.test.ts`.
 *
 * Assertion discipline (T11-impl, from the infinite-canvas feasibility
 * study): everything is pinned at the CANONICAL / SCHEDULE layer — where a
 * step sits on the timeline and how far its reveal has progressed. Nothing
 * here asserts scroll positions, viewports, or any camera mechanism: when
 * the scrolling camera is replaced by camera steps, this suite must survive
 * unchanged.
 *
 * Known-trap map (T11-5). Five traps this mode has already paid for; each
 * is pinned at the seam that OWNS the decision, and this header is the
 * index so the next reader can see the bar is met without grepping:
 *
 *  - Formula-crossing strike — HERE, "[4] formula × backref": a quoted
 *    target that crosses a $…$ formula cannot match and degrades LOUDLY
 *    to refUnresolved.
 *  - Multi-line annotation ink collisions — reveal.test.ts, "G8-G — ink
 *    sized by FONT SIZE; consecutive marked lines never collide"
 *    (circle / highlight / underline / strike, pairwise over three rows).
 *  - Silent handwriting-font fallback — reveal.test.ts, "G8-A —
 *    handwriting font probe measures widths on canvas", test "identical
 *    width = silent fallback (the Hannotate trap) → NOT active". This
 *    suite's host pins `handwritingFontActive: true` DELIBERATELY:
 *    EnvCaps is session-fixed and today has zero factory/strategy
 *    consumers (engine/factories/env.ts §5.2 TODO), so a second host env
 *    variant would measure byte-identically — an always-green test. The
 *    fallback is pinned where the branch lives: the probe.
 *  - `$` delimiter vs currency — domain.test.ts, "$ delimiter vs
 *    currency" ($100 is money, not math; glued-currency stays literal).
 *  - SVG presentation attributes don't parse var() — reveal.test.ts,
 *    "G8-D — token colors go through element.style": `el()` THROWS on
 *    fill/stroke/color/opacity attrs, a structural guard rather than a
 *    pin, so the trap cannot be re-introduced silently.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseLecture } from "../domain.js";
import { containerKeyOf, isContainerFrame } from "../engine/container.js";
import { DEFAULT_DURATIONS } from "../engine/duration.js";
import { factoryFor } from "../engine/factories/index.js";
import { flattenSteps, planLecture } from "../engine/inference.js";
import { stepContentHash, stepPlainText } from "../engine/text.js";
import { buildTimeline } from "../engine/timeline.js";
import { clipWindows, createNarrationHook } from "../narration/timing.js";
import type { NarrationManifest } from "../narration/types.js";
import { stepKey } from "../viewer/address.js";
import type {
  Lecture,
  Revealable,
  ScheduleContext,
  Step,
  StepRef,
  StepSchedule,
} from "../engine/types.js";
import {
  createPlayer,
  goLive,
  scrub,
  tick,
  timelineReplaced,
} from "../viewer/player-core.js";
import {
  relatchOnSelectionChange,
  resolveSetKey,
} from "../viewer/set-latch.js";
import {
  lastLecture,
  lastNarration,
  openFeed,
  settle,
  type BoardFeed,
} from "./board-feed.js";
import {
  makeHost,
  reconcileStep,
  refIndex,
  trackUnits,
  type Host,
  type IncrementalHost,
  type UnitTracker,
} from "./incremental-host.js";
import { canonicalHash } from "./determinism-probe.js";

const CTX: ScheduleContext = { durations: DEFAULT_DURATIONS };

// ────────────────────────────────────────────────────────────────────────────
// Shared plumbing — the simulated chokidar→WS pipeline lives in
// board-feed.ts (FakeChannel / openFeed / settle / lastLecture), shared
// with stage-e2e.test.ts; the DOM host in incremental-host.ts.
// ────────────────────────────────────────────────────────────────────────────

const compile = (lecture: Lecture) => buildTimeline(lecture, CTX);

/** G1 — strict serial order: sorted, non-negative, zero overlap. */
function assertSinglePen(schedule: StepSchedule[]): void {
  for (let i = 0; i < schedule.length; i++) {
    const s = schedule[i]!;
    expect(s.start).toBeGreaterThanOrEqual(0);
    expect(s.end).toBeGreaterThanOrEqual(s.start);
    if (i > 0) expect(s.start).toBeGreaterThanOrEqual(schedule[i - 1]!.end);
  }
}

const json = (v: unknown): string => JSON.stringify(v);

// ── DOM host (happy-dom; no layout — geometry is G7's job, identity and
//    scheduling are this suite's). The host, the reconcile-driven
//    incremental build and the progress trackers live in
//    incremental-host.ts, shared with streaming.test.ts. ────────────────────

const refKey = (ref: StepRef): string => `${ref.section}:${ref.step}`;

const windowOf = (schedule: readonly StepSchedule[], ref: StepRef) => {
  const entries = schedule.filter(
    (s) => s.step.section === ref.section && s.step.step === ref.step,
  );
  expect(entries.length).toBeGreaterThan(0);
  return { start: entries[0]!.start, end: entries[entries.length - 1]!.end };
};

/** Build every performable step through the real factories. */
function buildAll(lecture: Lecture, host: Host) {
  const built = new Map<string, Revealable[]>();
  for (const { ref, step } of flattenSteps(lecture)) {
    const factory = factoryFor(step.kind);
    if (!factory) continue;
    const { node, revealables } = factory.build(step, host.ctx);
    // `isContainerFrame`, not a kind literal: chart AND graph frames both
    // register homes — hardcoding "chart-frame" here would let a graph
    // board degrade to nothing while every assertion stayed green (the
    // exact two-parallel-mechanisms trap engine/container.ts abolishes).
    if (isContainerFrame(step)) {
      host.containers.set(containerKeyOf(step)!, { frame: step, node });
    }
    built.set(refKey(ref), revealables);
  }
  return built;
}

// ────────────────────────────────────────────────────────────────────────────
// [1] Streaming R1–R8 — simulated FileChangeEvent sequences, no chokidar
// ────────────────────────────────────────────────────────────────────────────

const V1 = `# 直播板

开场白先立住背景。

第二段推进,==关键== 转折在这里。
`;

const V2 = `${V1}
第三段刚追加,含一个公式 $a^2+b^2=c^2$。
`;

const V3 = `${V2}
\`\`\`chart rev
x: 2023 .. 2024
y: 0 .. 40
+ 甲: 1 2 3 4
\`\`\`
`;

const V4 = `${V3}
\`\`\`chart rev
+ 乙: 2 3 4 5
\`\`\`
`;

// The graph dialect rides the same stream (T12): V5 declares a named
// graph, V6 appends a layer. Appending to a graph invalidates the FRAME
// as well (frameOwnsUnion — its layout is computed from the accumulated
// union), the exact cache-invalidation class the R8 seal must survive.
const V5 = `${V4}
\`\`\`graph 流程
写板书 → 学生看
\`\`\`
`;

const V6 = `${V5}
\`\`\`graph 流程
学生看 → 提问
\`\`\`
`;

describe("[1] streaming — R1/R2 append extends the canonical tail only", () => {
  test("each append event leaves the already-scheduled prefix byte-identical", async () => {
    const feed = await openFeed({ "board.md": V1 });
    expect(feed.values.map((v) => v.origin)).toEqual(["initial"]);

    const t1 = compile(lastLecture(feed));
    feed.channel.emit([{ path: "board.md", content: V2, origin: "external" }]);
    const t2 = compile(lastLecture(feed));
    feed.channel.emit([{ path: "board.md", content: V3, origin: "external" }]);
    const t3 = compile(lastLecture(feed));
    // R2 covers chart continuation arriving as its own event (chart 续写).
    feed.channel.emit([{ path: "board.md", content: V4, origin: "external" }]);
    const t4 = compile(lastLecture(feed));

    expect(feed.values.map((v) => v.origin)).toEqual([
      "initial",
      "external",
      "external",
      "external",
    ]);

    const chain = [t1, t2, t3, t4];
    for (let i = 1; i < chain.length; i++) {
      const prev = chain[i - 1]!;
      const next = chain[i]!;
      // Tail extension: strictly more scheduled units, strictly later end.
      expect(next.schedule.length).toBeGreaterThan(prev.schedule.length);
      expect(next.duration).toBeGreaterThan(prev.duration);
      // R1 semantic consequence at the canonical layer: every already
      // scheduled unit keeps its exact position — replay is structurally
      // impossible because nothing before the tail moved.
      expect(json(next.schedule.slice(0, prev.schedule.length))).toBe(
        json(prev.schedule),
      );
      assertSinglePen(next.schedule);
    }
  });

  test("an event for an unrelated file does not emit a board", async () => {
    const feed = await openFeed({ "board.md": V1 });
    feed.channel.emit([
      { path: "notes.txt", content: "irrelevant", origin: "external" },
    ]);
    await settle();
    expect(feed.values).toHaveLength(1);
  });
});

describe("[1] streaming — the empty-at-open workspace (the seed-gallery front door)", () => {
  test("a board arriving AFTER open is the broadcast, not history: first value is 'initial', the hydration latch plays it from 0, the set matcher does not re-judge it", async () => {
    // The mode's actual front door: `pneuma bansho` on an empty workspace,
    // then a seed-gallery apply (or the agent's first write) lands the
    // board as a FileChangeEvent. Two shipped bugs lived exactly here —
    // 8b03794 (an empty-at-open board played its first append from the
    // tip, never performing) and 11515a8 (the async set matcher re-judged
    // the same opening and turned a seeded board into history) — and the
    // join decision was pinned only by unit tests over createPlayer /
    // set-latch, never through loadBoard + a first append. This walks the
    // whole flow through the production seam.
    const feed = await openFeed({});
    // No board → loadBoard returns null → the source stays silent (no
    // value, no error) rather than emitting an empty board.
    expect(feed.values).toEqual([]);
    expect(feed.errors).toEqual([]);

    // The join latch reads the FILE SNAPSHOT at hydration (BanshoPreview):
    // nothing there → this session's first compile is the broadcast itself.
    const hasBoardAtHydration = feed.channel
      .snapshot()
      .some((f) => f.path === "board.md" || f.path.endsWith("/board.md"));
    expect(hasBoardAtHydration).toBe(false);

    // The seed-apply write arrives (content-set directory — the applied-
    // seed layout). The FIRST successful load emits as "initial" even
    // though an external batch triggered it: that is the seam's contract,
    // and it is the value the viewer hydrates from.
    feed.channel.emit([
      { path: "demo/board.md", content: V1, origin: "external" },
    ]);
    expect(feed.values.map((v) => v.origin)).toEqual(["initial"]);

    const timeline = compile(lastLecture(feed, "demo"));
    expect(timeline.duration).toBeGreaterThan(0);

    // Join decision, latched at hydration: play from 0 — the demo PERFORMS.
    let player = createPlayer(timeline.duration, hasBoardAtHydration);
    expect(player).toMatchObject({ t: 0, playing: true, follow: "live" });
    player = tick(player, 0.2);
    expect(player.t).toBeCloseTo(0.2, 6); // advancing from the start, not the tip

    // The async set matcher then names the opening ("demo"). That is the
    // SAME opening the hydration latch already judged — the relatch must
    // leave the verdict alone (11515a8: re-judging here converted the
    // seeded board into history and the demo never performed).
    expect(
      resolveSetKey(Object.keys(feed.values[0]!.board.byContentSet), null),
    ).toBe("demo");
    expect(relatchOnSelectionChange(null, "demo", true)).toBeNull();
  });

  test("the contrast: a board already on disk at open IS history — the latch joins it at the tip", async () => {
    const feed = await openFeed({ "demo/board.md": V1 });
    expect(feed.values.map((v) => v.origin)).toEqual(["initial"]);
    const hasBoardAtHydration = feed.channel
      .snapshot()
      .some((f) => f.path === "board.md" || f.path.endsWith("/board.md"));
    expect(hasBoardAtHydration).toBe(true);
    const timeline = compile(lastLecture(feed, "demo"));
    const player = createPlayer(timeline.duration, hasBoardAtHydration);
    expect(player.t).toBe(timeline.duration); // history is never replayed at the viewer's expense
  });
});

describe('[1] streaming — origin: "self" rides the same seam', () => {
  test("a self-origin batch emits tagged 'self'; the canonical result is byte-identical to the same bytes arriving as 'external'", async () => {
    // `origin` is the discriminator the viewer keys its one soft pulse on
    // (an external edit pulses, our own write round-trip does not) — but
    // it is presentation-layer ONLY. Pin both halves at the source seam:
    // the tag propagates through the real config, and the canonical
    // schedule cannot see it.
    const selfFeed = await openFeed({ "board.md": V1 });
    selfFeed.channel.emit([{ path: "board.md", content: V2, origin: "self" }]);
    expect(selfFeed.values.map((v) => v.origin)).toEqual(["initial", "self"]);

    const externalFeed = await openFeed({ "board.md": V1 });
    externalFeed.channel.emit([
      { path: "board.md", content: V2, origin: "external" },
    ]);
    expect(externalFeed.values.map((v) => v.origin)).toEqual([
      "initial",
      "external",
    ]);

    expect(json(compile(lastLecture(selfFeed)).schedule)).toBe(
      json(compile(lastLecture(externalFeed)).schedule),
    );
  });
});

describe("[1] streaming — R4 in-place edit (same block count, one hash changed)", () => {
  test("prefix identical; edited step recompiled; downstream shifts by a constant delta, lengths preserved", async () => {
    const feed = await openFeed({ "board.md": V2 });
    const before = compile(lastLecture(feed));

    const edited = V2.replace("==关键== 转折", "==核心而且更长的== 转折");
    feed.channel.emit([
      { path: "board.md", content: edited, origin: "external" },
    ]);
    const after = compile(lastLecture(feed));

    // Step order: heading 0:-1 (the section title), para 0:0, para 0:1
    // (edited), para 0:2.
    const editedRef: StepRef = { section: 0, step: 1 };
    const splitAt = (tl: typeof before) => {
      const first = tl.schedule.findIndex(
        (s) =>
          s.step.section === editedRef.section && s.step.step === editedRef.step,
      );
      expect(first).toBeGreaterThan(0);
      return first;
    };
    const cut = splitAt(before);
    expect(splitAt(after)).toBe(cut);

    // Steps before the divergence point: byte-identical schedule.
    expect(json(after.schedule.slice(0, cut))).toBe(
      json(before.schedule.slice(0, cut)),
    );

    // The edited step's reveal window changed — DIRECTIONALLY: a longer
    // emphasis is more writing, so it must take MORE time, not merely a
    // different amount.
    const window = (tl: typeof before, ref: StepRef) => {
      const entries = tl.schedule.filter(
        (s) => s.step.section === ref.section && s.step.step === ref.step,
      );
      return entries[entries.length - 1]!.end - entries[0]!.start;
    };
    expect(window(after, editedRef)).toBeGreaterThan(window(before, editedRef));

    // Downstream steps: absolute shift is legal (R4), but every unit keeps
    // its own length and their relative spacing — one constant delta.
    const downBefore = before.schedule.filter((s) => s.step.step > editedRef.step);
    const downAfter = after.schedule.filter((s) => s.step.step > editedRef.step);
    expect(downAfter).toHaveLength(downBefore.length);
    expect(downBefore.length).toBeGreaterThan(0);
    const delta = downAfter[0]!.start - downBefore[0]!.start;
    for (let i = 0; i < downBefore.length; i++) {
      expect(downAfter[i]!.start).toBeCloseTo(downBefore[i]!.start + delta, 6);
      expect(downAfter[i]!.end).toBeCloseTo(downBefore[i]!.end + delta, 6);
    }
    assertSinglePen(after.schedule);
  });
});

describe("[1] streaming — R4′ structural change (mid-document insertion)", () => {
  test("longest-common-prefix realign: canonical prefix identical, insertion scheduled in document order, suffix keeps its durations", async () => {
    const feed = await openFeed({ "board.md": V2 });
    const before = compile(lastLecture(feed));

    const inserted = V2.replace(
      "第二段推进",
      "插进来的新段落,纪律外但不许崩。\n\n第二段推进",
    );
    feed.channel.emit([
      { path: "board.md", content: inserted, origin: "external" },
    ]);
    const after = compile(lastLecture(feed));

    // Step order before: heading 0:-1, para 0:0, para 0:1, para 0:2 — the
    // insertion lands before 0:1, so heading + 0:0 are the stable prefix.
    const prefixLen = before.schedule.filter((s) => s.step.step < 1).length;
    expect(prefixLen).toBeGreaterThan(0);
    expect(json(after.schedule.slice(0, prefixLen))).toBe(
      json(before.schedule.slice(0, prefixLen)),
    );

    // The document gained exactly one step; the old suffix steps kept
    // their unit counts and window lengths (they only moved).
    const stepsBefore = flattenSteps(parseLecture(V2)).length;
    const stepsAfter = flattenSteps(lastLecture(feed)).length;
    expect(stepsAfter).toBe(stepsBefore + 1);
    const lengths = (tl: typeof before, ref: StepRef) =>
      tl.schedule
        .filter((s) => s.step.section === ref.section && s.step.step === ref.step)
        .map((s) => (s.end - s.start).toFixed(6));
    // Old 0:1 / 0:2 became 0:2 / 0:3 — same content, same unit lengths.
    expect(lengths(after, { section: 0, step: 2 })).toEqual(
      lengths(before, { section: 0, step: 1 }),
    );
    expect(lengths(after, { section: 0, step: 3 })).toEqual(
      lengths(before, { section: 0, step: 2 }),
    );
    assertSinglePen(after.schedule);
  });
});

describe("[1] streaming — R4/R4′ zero-replay at the REVEAL-PROGRESS layer (the swap re-seek)", () => {
  // §7.3 promises more than schedule shape: an already-revealed step that
  // an event rebuilds must LAND as its seek(1) end state — R4 "已完全揭示 →
  // 瞬时替换为 seek(1) 终态,不重播", R4′ "已揭示的重编译 step 直接以终态呈现,
  // 不重播". The describes above pin the canonical layer only; these two
  // drive the SAME events through the incremental host with real
  // factories, swap the timeline at a held live playhead (timelineReplaced
  // keeps it — pinned in the R7 describe), re-seek — the exact move
  // BoardCanvas performs — and read the progress every unit actually
  // received. Falsifiability, both regression classes by name: a host that
  // re-animates a rebuilt revealed step from p=0 puts FRACTIONALS in its
  // log; a host that DROPS the post-swap re-seek leaves the log EMPTY.
  // Both go red against `toEqual([1])`.

  test("R4 in-place edit at a held playhead: prefix units re-pin at exactly p=1; the rebuilt revealed step receives exactly seek(1), never a 0→1 ramp", async () => {
    const feed = await openFeed({ "board.md": V2 });
    const lec1 = lastLecture(feed);
    const s1 = reconcileStep(null, lec1);
    const w1 = trackUnits(s1.built);
    const tl1 = buildTimeline(lec1, CTX, {
      unitsFor: (ref) => w1.wrapped[refIndex(s1, ref)],
    });
    let player = createPlayer(tl1.duration); // watching live, at the tip
    tl1.seek(player.t);
    expect(w1.trackers.flat().every((u) => u.p === 1)).toBe(true); // fully revealed

    // The same edit event as the canonical R4 describe above.
    feed.channel.emit([
      {
        path: "board.md",
        content: V2.replace("==关键== 转折", "==核心而且更长的== 转折"),
        origin: "external",
      },
    ]);
    const lec2 = lastLecture(feed);
    const s2 = reconcileStep(s1, lec2);

    // The zero-replay claim is about REUSE — prove the prefix actually
    // reused (fresh prefix nodes would make "no replay" vacuous).
    const editedRef: StepRef = { section: 0, step: 1 };
    const editedIndex = refIndex(s2, editedRef);
    expect(editedIndex).toBe(2); // heading 0:-1, para 0:0, edited 0:1, para 0:2
    for (let i = 0; i < editedIndex; i++) {
      expect(s2.nodes[i]).toBe(s1.nodes[i]!);
      expect(s2.built[i]).toBe(s1.built[i]!);
    }

    const w2 = trackUnits(s2.built);
    const tl2 = buildTimeline(lec2, CTX, {
      unitsFor: (ref) => w2.wrapped[refIndex(s2, ref)],
    });
    player = timelineReplaced(player, tl2.duration);
    expect(player.t).toBe(tl1.duration); // live hold: the playhead did not move
    // Fixture guarantee, asserted so drift turns LOUD instead of silently
    // weakening the pin: the edit's extra writing is shorter than the tail
    // after it, so the rebuilt step's new window still ends before the
    // held playhead — the "already fully revealed" premise of R4.
    expect(windowOf(tl2.schedule, editedRef).end).toBeLessThanOrEqual(player.t);

    tl2.seek(player.t); // the swap re-seek

    // Prefix: re-pinned at final state, exactly — never a fractional, and
    // never SKIPPED (an empty log IS the dropped-re-seek regression).
    for (const unit of w2.trackers.slice(0, editedIndex).flat()) {
      expect(unit.log.length).toBeGreaterThan(0);
      for (const p of unit.log) expect(p).toBe(1);
    }
    // The rebuilt revealed step: exactly ONE dispatch, exactly seek(1).
    const editedUnits = w2.trackers[editedIndex]!;
    expect(editedUnits.length).toBeGreaterThan(0);
    for (const unit of editedUnits) expect(unit.log).toEqual([1]);
    // (The tail step is also rebuilt — planReconcile rebuilds from the
    // divergence point — but the held playhead legally sits inside its
    // SHIFTED window (R4 allows the constant downstream delta), so its
    // fractional projection is not pinned here.)
  });

  test("R4′ mid-document insertion at a held playhead: renumbered revealed steps land as exactly seek(1); the inserted step pops complete, not performed", async () => {
    const feed = await openFeed({ "board.md": V2 });
    const lec1 = lastLecture(feed);
    const s1 = reconcileStep(null, lec1);
    const w1 = trackUnits(s1.built);
    const tl1 = buildTimeline(lec1, CTX, {
      unitsFor: (ref) => w1.wrapped[refIndex(s1, ref)],
    });
    let player = createPlayer(tl1.duration);
    tl1.seek(player.t);
    expect(w1.trackers.flat().every((u) => u.p === 1)).toBe(true);

    // A SHORT insertion before 0:1 — shorter than the tail after it, so
    // every renumbered revealed step still ends before the held playhead
    // (guarded below, same discipline as the R4 test).
    feed.channel.emit([
      {
        path: "board.md",
        content: V2.replace("第二段推进", "插一句。\n\n第二段推进"),
        origin: "external",
      },
    ]);
    const lec2 = lastLecture(feed);
    const s2 = reconcileStep(s1, lec2);

    const insertedRef: StepRef = { section: 0, step: 1 };
    const insertedIndex = refIndex(s2, insertedRef);
    expect(insertedIndex).toBe(2); // heading, para 0:0, INSERTED 0:1, old 0:1→0:2, old 0:2→0:3
    for (let i = 0; i < insertedIndex; i++) {
      expect(s2.nodes[i]).toBe(s1.nodes[i]!);
      expect(s2.built[i]).toBe(s1.built[i]!);
    }

    const w2 = trackUnits(s2.built);
    const tl2 = buildTimeline(lec2, CTX, {
      unitsFor: (ref) => w2.wrapped[refIndex(s2, ref)],
    });
    player = timelineReplaced(player, tl2.duration);
    expect(player.t).toBe(tl1.duration);
    const renumberedRef: StepRef = { section: 0, step: 2 }; // old 0:1
    expect(windowOf(tl2.schedule, insertedRef).end).toBeLessThanOrEqual(player.t);
    expect(windowOf(tl2.schedule, renumberedRef).end).toBeLessThanOrEqual(player.t);

    tl2.seek(player.t); // the swap re-seek

    // Prefix: final-state pins only, never skipped.
    for (const unit of w2.trackers.slice(0, insertedIndex).flat()) {
      expect(unit.log.length).toBeGreaterThan(0);
      for (const p of unit.log) expect(p).toBe(1);
    }
    // The inserted step sits BEHIND the held playhead: it pops complete —
    // a pure projection, never a performance the user is yanked through.
    const insertedUnits = w2.trackers[insertedIndex]!;
    expect(insertedUnits.length).toBeGreaterThan(0);
    for (const unit of insertedUnits) expect(unit.log).toEqual([1]);
    // The renumbered already-revealed step (old 0:1, rebuilt by the
    // longest-common-prefix realign): terminal state directly — the R4′
    // promise verbatim.
    const renumberedUnits = w2.trackers[refIndex(s2, renumberedRef)]!;
    expect(renumberedUnits.length).toBeGreaterThan(0);
    for (const unit of renumberedUnits) expect(unit.log).toEqual([1]);
    // (The tail step 0:3 is the boundary entry at the held playhead — its
    // shift is legal and its fractional projection unpinned, as in R4.)
  });
});

describe("[1] streaming — R5 reference failure arriving as an event", () => {
  test("an unresolvable backref degrades to ONE bad step; every other step's schedule is untouched", async () => {
    const feed = await openFeed({ "board.md": V2 });
    const before = compile(lastLecture(feed));

    feed.channel.emit([
      {
        path: "board.md",
        content: `${V2}\n@circle "这个目标不存在于任何一步"\n`,
        origin: "external",
      },
    ]);
    const lecture = lastLecture(feed);
    const after = compile(lecture);

    // The offending step is bad, with the R5 warning attached — carrying
    // the exact address (the append lands after V2's paras at 0:3), the
    // quoted target in the message, and the raw line as the excerpt.
    const bads = flattenSteps(lecture).filter((e) => e.step.kind === "bad");
    expect(bads).toHaveLength(1);
    expect(lecture.errors).toHaveLength(1);
    expect(lecture.errors[0]).toMatchObject({
      code: "refUnresolved",
      message: 'back reference target not found: "这个目标不存在于任何一步"',
      step: { section: 0, step: 3 },
    });
    expect(lecture.errors[0]!.excerpt).toContain(
      '@circle "这个目标不存在于任何一步"',
    );
    // …and the blast radius is exactly that step: the canonical schedule
    // of everything else is byte-identical to the pre-event board.
    expect(json(after.schedule)).toBe(json(before.schedule));
  });

  test("a bad step in the MIDDLE of the document: the prefix is untouched AND the suffix keeps its exact windows", async () => {
    // The tail-append cases above prove "a bad step plans no units" — but
    // whole-schedule equality there follows trivially from the bad step
    // being LAST. The real blast-radius claim is positional: a mid-document
    // failure must not shift or drop the steps AFTER it.
    const feed = await openFeed({ "board.md": V2 });
    const before = compile(lastLecture(feed));

    feed.channel.emit([
      {
        path: "board.md",
        content: V2.replace(
          "第三段刚追加",
          '@circle "不存在的目标"\n\n第三段刚追加',
        ),
        origin: "external",
      },
    ]);
    const lecture = lastLecture(feed);
    const after = compile(lecture);

    // The failure is addressed mid-document: heading 0:-1, paras 0:0/0:1,
    // then the inserted backref at 0:2; old 0:2 renumbers to 0:3.
    expect(lecture.errors).toHaveLength(1);
    expect(lecture.errors[0]).toMatchObject({
      code: "refUnresolved",
      step: { section: 0, step: 2 },
    });

    // Prefix (everything before the bad step): byte-identical schedule.
    const prefixLen = before.schedule.filter((s) => s.step.step < 2).length;
    expect(prefixLen).toBeGreaterThan(0);
    expect(prefixLen).toBeLessThan(before.schedule.length); // a real suffix exists
    expect(json(after.schedule.slice(0, prefixLen))).toBe(
      json(before.schedule.slice(0, prefixLen)),
    );

    // Suffix: the old 0:2 entries survive as 0:3 with their EXACT absolute
    // windows — a bad step plans no units, so nothing after it moves.
    const oldSuffix = before.schedule.slice(prefixLen);
    const newSuffix = after.schedule.slice(prefixLen);
    expect(newSuffix).toHaveLength(oldSuffix.length);
    for (let i = 0; i < oldSuffix.length; i++) {
      expect(newSuffix[i]!.step).toEqual({ section: 0, step: 3 });
      expect(newSuffix[i]!.start).toBe(oldSuffix[i]!.start);
      expect(newSuffix[i]!.end).toBe(oldSuffix[i]!.end);
    }
    assertSinglePen(after.schedule);
  });

  test("a chart layer naming a frame that does not exist degrades the same way", async () => {
    const feed = await openFeed({ "board.md": V1 });
    const before = compile(lastLecture(feed));
    feed.channel.emit([
      {
        path: "board.md",
        content: `${V1}\n\`\`\`chart 没有这个frame\n+ 甲: 1 2 3\n\`\`\`\n`,
        origin: "external",
      },
    ]);
    const lecture = lastLecture(feed);
    // Same R5 contract: address (V1 is heading 0:-1 + paras 0:0/0:1, so
    // the orphan block is 0:2), the frame name in the message, and the
    // offending row as the excerpt.
    expect(lecture.errors).toHaveLength(1);
    expect(lecture.errors[0]).toMatchObject({
      code: "refUnresolved",
      message: 'chart "没有这个frame" adds layers but no frame (x:/y:) was declared',
      step: { section: 0, step: 2 },
    });
    expect(lecture.errors[0]!.excerpt).toContain("+ 甲: 1 2 3");
    expect(json(compile(lecture).schedule)).toBe(json(before.schedule));
  });
});

describe("[1] streaming — R6 broken block arriving as an event", () => {
  test("a syntactically broken chart is isolated: stepParseError with address + excerpt, neighbours untouched", async () => {
    const feed = await openFeed({ "board.md": V2 });
    const before = compile(lastLecture(feed));

    feed.channel.emit([
      {
        path: "board.md",
        content: `${V2}\n\`\`\`chart rev\n这不是合法的图表行\n\`\`\`\n\n坏块之后照常讲。\n`,
        origin: "external",
      },
    ]);
    const lecture = lastLecture(feed);
    const after = compile(lecture);

    const issue = lecture.errors.find((e) => e.code === "stepParseError");
    // R6 wants the agent's self-heal turn to know WHERE and WHAT — the
    // exact {section, step} address of the broken block (V2 is heading
    // 0:-1 + three paras 0:0‥0:2, so the appended chart is 0:3) and the
    // offending source line itself, not just "something, somewhere".
    expect(issue).toMatchObject({
      code: "stepParseError",
      message: "unrecognized chart row",
      step: { section: 0, step: 3 },
    });
    expect(issue!.excerpt).toContain("这不是合法的图表行");

    // The pre-event schedule survives byte-identically…
    expect(json(after.schedule.slice(0, before.schedule.length))).toBe(
      json(before.schedule),
    );
    // …and the prose AFTER the bad block still performs.
    const tailProse = flattenSteps(lecture).find(
      (e) => e.step.kind === "prose" && stepPlainText(e.step).includes("坏块之后"),
    );
    expect(tailProse).toBeDefined();
    expect(
      after.schedule.some(
        (s) =>
          s.step.section === tailProse!.ref.section &&
          s.step.step === tailProse!.ref.step,
      ),
    ).toBe(true);
    assertSinglePen(after.schedule);
  });
});

describe("[1] streaming — R7 scrub vs live append; R3 forward-only clamp", () => {
  test("a scrubbing user keeps the playhead while appends extend the canonical; Live returns to the new tip", async () => {
    const feed = await openFeed({ "board.md": V2 });
    const t1 = compile(lastLecture(feed));
    let player = createPlayer(t1.duration); // watching live, at the tip

    // User grabs the timeline → detached, paused (R7).
    player = scrub(player, t1.duration / 2);
    expect(player.follow).toBe("detached");
    const held = player.t;

    // Two appends land while the user is back in time.
    feed.channel.emit([{ path: "board.md", content: V3, origin: "external" }]);
    player = timelineReplaced(player, compile(lastLecture(feed)).duration);
    feed.channel.emit([{ path: "board.md", content: V4, origin: "external" }]);
    const t4 = compile(lastLecture(feed));
    player = timelineReplaced(player, t4.duration);

    // The canonical grew; the user's playhead did not move (no yanking).
    expect(player.duration).toBe(t4.duration);
    expect(player.t).toBe(held);
    expect(player.follow).toBe("detached");

    // The Live button: seek to the CURRENT tip, re-enter live (R7).
    player = goLive(player);
    expect(player.t).toBe(t4.duration);
    expect(player.follow).toBe("live");
  });

  test("live hold-and-resume: the held playhead never rewinds when the append lands (R2), and ticking resumes from it", async () => {
    const feed = await openFeed({ "board.md": V1 });
    const t1 = compile(lastLecture(feed));
    let player = createPlayer(t1.duration);
    player = tick(player, 5); // held at the tip, still playing (live hold)
    expect(player).toMatchObject({ t: t1.duration, playing: true, follow: "live" });

    feed.channel.emit([{ path: "board.md", content: V2, origin: "external" }]);
    const t2 = compile(lastLecture(feed));
    player = timelineReplaced(player, t2.duration);
    // Zero replay: resume EXACTLY from the held position, not from 0.
    expect(player.t).toBe(t1.duration);
    player = tick(player, 0.2);
    expect(player.t).toBeCloseTo(t1.duration + 0.2, 6);
  });

  test("R3 defensive: a recompile that SHORTENS the board clamps forward-only, never below the new end, never negative", async () => {
    const feed = await openFeed({ "board.md": V2 });
    const t2 = compile(lastLecture(feed));
    let player = createPlayer(t2.duration); // live at the tip

    // Discipline-violating tail deletion (the board shrank).
    feed.channel.emit([{ path: "board.md", content: V1, origin: "external" }]);
    const t1 = compile(lastLecture(feed));
    expect(t1.duration).toBeLessThan(t2.duration);
    player = timelineReplaced(player, t1.duration);
    expect(player.t).toBe(t1.duration); // clamped to the new end, no rewind past it
    expect(player.t).toBeGreaterThanOrEqual(0);
    expect(player.follow).toBe("live");
  });
});

// ── Narration manifest as a mid-stream event ────────────────────────────────

/** Hash a step by a text fragment it contains — the manifest's clip key. */
function hashFor(lecture: Lecture, fragment: string): string {
  const found = flattenSteps(lecture).find(({ step }) =>
    stepPlainText(step).includes(fragment),
  );
  expect(found).toBeDefined();
  return stepContentHash(found!.step, lecture.source);
}

/** The exact compile the production host performs (BoardCanvas): a fresh
 *  per-compile hook, `durationOverride` only when there is a manifest. */
function compileNarrated(lecture: Lecture, manifest: NarrationManifest | null) {
  const hook = createNarrationHook(lecture.source, manifest);
  const timeline = buildTimeline(lecture, {
    durations: DEFAULT_DURATIONS,
    ...(hook ? { durationOverride: hook.durationOverride } : {}),
  });
  return { hook, timeline };
}

describe("[1] streaming — a narration manifest landing mid-stream (the ONE ScheduleContext the shipped viewer builds)", () => {
  test("the manifest is a first-class event of the SAME feed: it re-paces the narrated step through the G3 channel, single-pen holds, and the audio windows read back with their hold points", async () => {
    // A content-set-shaped workspace — the narration file is keyed per set.
    const feed = await openFeed({ "live/board.md": V2 });
    const lecture = lastLecture(feed, "live");
    const silent = compileNarrated(lecture, null).timeline;

    // Two clips: one far LONGER than any natural footprint (clamps to the
    // 2.5× ceiling, voice overruns → a HOLD at the next pen-down), one far
    // shorter (clamps to the 0.6× floor, fits → no hold). Chosen mid-board
    // so a next pen-down exists.
    const longRef: StepRef = { section: 0, step: 1 };
    const fitRef: StepRef = { section: 0, step: 0 };
    const longHash = hashFor(lecture, "第二段推进");
    const fitHash = hashFor(lecture, "开场白");
    const manifest: NarrationManifest = {
      voice: "Kore",
      clips: {
        [longHash]: { file: `narration/${longHash}.wav`, seconds: 600, text: "长" },
        [fitHash]: { file: `narration/${fitHash}.wav`, seconds: 0.001, text: "短" },
      },
    };

    const valuesBefore = feed.values.length;
    feed.channel.emit([
      {
        path: "live/narration/manifest.json",
        content: JSON.stringify(manifest),
        origin: "external",
      },
    ]);
    // The manifest write alone produced a new board value — it is watched
    // by the same production source config as board.md.
    expect(feed.values.length).toBe(valuesBefore + 1);
    const read = lastNarration(feed, "live");
    expect(read.issue).toBeNull();
    expect(read.manifest).not.toBeNull();

    const { hook, timeline } = compileNarrated(
      lastLecture(feed, "live"),
      read.manifest,
    );
    expect(hook).not.toBeNull();
    // Both clips were applied by THIS compile (the record is per compile).
    expect(hook!.applied.size).toBe(2);
    expect(hook!.applied.has(stepKey(longRef))).toBe(true);
    expect(hook!.applied.has(stepKey(fitRef))).toBe(true);

    // Re-pacing, directionally: the long-voiced step takes MORE time, the
    // short-voiced one LESS; everything downstream of the long clip moved
    // later; the prefix identity of R1 legitimately breaks — what must
    // hold instead is the single pen.
    const span = (w: { start: number; end: number }) => w.end - w.start;
    expect(span(windowOf(timeline.schedule, longRef))).toBeGreaterThan(
      span(windowOf(silent.schedule, longRef)),
    );
    expect(span(windowOf(timeline.schedule, fitRef))).toBeLessThan(
      span(windowOf(silent.schedule, fitRef)),
    );
    expect(windowOf(timeline.schedule, { section: 0, step: 2 }).start)
      .toBeGreaterThan(windowOf(silent.schedule, { section: 0, step: 2 }).start);
    expect(timeline.schedule).toHaveLength(silent.schedule.length);
    assertSinglePen(timeline.schedule);

    // The audio windows, pinned INDEPENDENTLY of the window math's own
    // inputs (`start = lastEnd − footprint` restated with the hook's own
    // record would be a mirror — the implementation compared to itself).
    // Per the G3 contract the voice covers the step's WHOLE performance,
    // so it must begin exactly where that performance begins: the previous
    // step's last pen-up (a schedule fact), its unscaled trailing pen-lift
    // and the narrated step's own lead-in (plan facts) — none of which
    // clipWindows consumes. The long clip's voice overruns its clamped
    // footprint and must HOLD at the next pen-down; the fitting clip
    // holds nothing.
    const windows = clipWindows(timeline.schedule, hook!.applied);
    expect(windows).toHaveLength(2);
    const [fitWindow, longWindow] = windows; // sorted by start
    expect(fitWindow!.ref).toMatchObject(fitRef);
    expect(longWindow!.ref).toMatchObject(longRef);
    expect(fitWindow!.holdAt).toBeNull();
    const plans = planLecture(lecture, DEFAULT_DURATIONS);
    const planOf = (ref: StepRef) =>
      plans.find(
        (p) => p.ref.section === ref.section && p.ref.step === ref.step,
      )!;
    const prevPlan = planOf(fitRef); // the step right before the narrated one
    const voiceStart =
      windowOf(timeline.schedule, fitRef).end +
      prevPlan.units[prevPlan.units.length - 1]!.gapAfter +
      planOf(longRef).leadIn;
    expect(longWindow!.start).toBeCloseTo(voiceStart, 6);
    // …and the voice sounds for exactly the manifest's 600 s from there.
    expect(longWindow!.audioEnd).toBeCloseTo(voiceStart + 600, 6);
    expect(longWindow!.holdAt).toBe(
      windowOf(timeline.schedule, { section: 0, step: 2 }).start,
    );
  });

  test("a manifest landing while the user scrubs: the detached playhead holds (R7); a re-pace that SHORTENS the board clamps the live playhead forward-only (R3)", async () => {
    const feed = await openFeed({ "board.md": V2 });
    const lecture = lastLecture(feed);
    const silent = compileNarrated(lecture, null).timeline;

    // One live viewer at the tip, one user scrubbing mid-board.
    let live = createPlayer(silent.duration);
    let scrubbing = createPlayer(silent.duration);
    scrubbing = scrub(scrubbing, silent.duration / 2);
    const held = scrubbing.t;
    expect(scrubbing.follow).toBe("detached");

    // A tiny clip shrinks its step to the 0.6× floor — the ONLY way the
    // shipped viewer's board legitimately gets SHORTER without an edit.
    const hash = hashFor(lecture, "第三段刚追加");
    feed.channel.emit([
      {
        path: "narration/manifest.json",
        content: JSON.stringify({
          clips: { [hash]: { file: `narration/${hash}.wav`, seconds: 0.001, text: "短" } },
        } satisfies NarrationManifest),
        origin: "external",
      },
    ]);
    const read = lastNarration(feed);
    expect(read.issue).toBeNull();
    const narrated = compileNarrated(lastLecture(feed), read.manifest).timeline;
    expect(narrated.duration).toBeLessThan(silent.duration);
    expect(held).toBeLessThan(narrated.duration); // the scrub point survived the shrink
    assertSinglePen(narrated.schedule);

    // R3: the live playhead (at the OLD tip, now past the end) clamps to
    // the new end — forward-only, never negative, still live.
    live = timelineReplaced(live, narrated.duration);
    expect(live.t).toBe(narrated.duration);
    expect(live.t).toBeGreaterThanOrEqual(0);
    expect(live.follow).toBe("live");

    // R7: the scrubbing user is not yanked by the re-pace.
    scrubbing = timelineReplaced(scrubbing, narrated.duration);
    expect(scrubbing.t).toBe(held);
    expect(scrubbing.follow).toBe("detached");
  });

  test("the degradation round trip: emptying the manifest returns the schedule byte-identical to the silent board", async () => {
    const feed = await openFeed({ "board.md": V2 });
    const lecture = lastLecture(feed);
    const silent = compileNarrated(lecture, null).timeline;

    const hash = hashFor(lecture, "第二段推进");
    feed.channel.emit([
      {
        path: "narration/manifest.json",
        content: JSON.stringify({
          clips: { [hash]: { file: `narration/${hash}.wav`, seconds: 600, text: "长" } },
        } satisfies NarrationManifest),
        origin: "external",
      },
    ]);
    const narrated = compileNarrated(
      lastLecture(feed),
      lastNarration(feed).manifest,
    ).timeline;
    expect(json(narrated.schedule)).not.toBe(json(silent.schedule));

    // The agent deletes the narration (empty file = the documented "no
    // narration" state): no manifest → no hook → byte-identical schedule.
    feed.channel.emit([
      { path: "narration/manifest.json", content: "", origin: "external" },
    ]);
    const read = lastNarration(feed);
    expect(read).toEqual({ manifest: null, issue: null });
    const { hook, timeline } = compileNarrated(lastLecture(feed), read.manifest);
    expect(hook).toBeNull();
    expect(json(timeline.schedule)).toBe(json(silent.schedule));
    expect(timeline.duration).toBe(silent.duration);
  });
});

describe("[1] streaming — R8 arrival-order determinism (the closing seal)", () => {
  // A pure `compile(parse(finalBytes))` comparison across histories cannot
  // go red: the aggregate source re-loads from the FULL snapshot, so every
  // history ends in the same pure function over the same bytes. Where
  // arrival order genuinely can leak is the INCREMENTAL host — cached
  // built nodes, accumulated container homes (chart/graph frames that
  // later layers mutate), reused revealables; a proven bug class in this
  // mode (chart-layer rebuild idempotence). So the seal streams each
  // history through a reconcile-driven host with REAL factories and
  // demands (a) the MEASURED schedule equal a fresh single-shot build of
  // the same final bytes, and (b) every container home hold the FINAL
  // document's frame step — (b) is what catches a stale graph frame whose
  // union misses a later layer, a leak the schedule alone cannot see in a
  // layout-less DOM.

  const measured = (state: IncrementalHost, lecture: Lecture) =>
    buildTimeline(lecture, CTX, {
      unitsFor: (ref) => {
        const i = refIndex(state, ref);
        return i >= 0 ? state.built[i] : undefined;
      },
    });

  /** Stream a history of board bytes through ONE stateful host. */
  async function streamThroughHost(history: readonly string[]) {
    const feed = await openFeed({ "board.md": history[0]! });
    let state = reconcileStep(null, lastLecture(feed));
    const firstNodes = state.nodes.slice();
    for (const src of history.slice(1)) {
      feed.channel.emit([{ path: "board.md", content: src, origin: "external" }]);
      state = reconcileStep(state, lastLecture(feed));
    }
    return { state, lecture: lastLecture(feed), firstNodes };
  }

  /** The referee: a fresh host builds the final bytes in one shot. */
  function freshMeasured(src: string) {
    const lecture = parseLecture(src);
    const host = makeHost();
    const built = buildAll(lecture, host);
    return buildTimeline(lecture, CTX, {
      unitsFor: (ref) => built.get(refKey(ref)),
    });
  }

  /**
   * Every container home must describe the FINAL document. A home still
   * holding a stale frame step — e.g. a graph frame built before a later
   * layer widened its union, the cascade `planReconcile` owes to
   * `frameOwnsUnion` — is exactly how arrival order leaks while the
   * schedule stays green (positions live in geometry, not in time).
   */
  function assertHomesCurrent(state: IncrementalHost, lecture: Lecture): void {
    const frames = flattenSteps(lecture).filter((e) => isContainerFrame(e.step));
    expect(frames.length).toBeGreaterThan(0);
    for (const { step } of frames) {
      const home = state.host.containers.get(containerKeyOf(step)!);
      expect(home).toBeDefined();
      expect(home!.frame).toEqual(step as never);
    }
    expect(state.host.containers.size).toBe(frames.length);
  }

  test("five incremental appends — prose, formula, chart frame, chart layer, graph frame, graph layer — measure byte-identically to a single-shot build of the final bytes", async () => {
    const { state, lecture, firstNodes } = await streamThroughHost([
      V1,
      V2,
      V3,
      V4,
      V5,
      V6,
    ]);

    // The stream really exercised the CACHED path: the very first built
    // node survived every event untouched (otherwise this test is just
    // freshMeasured vs freshMeasured — structurally unable to fail).
    expect(state.nodes[0]).toBe(firstNodes[0]!);

    // The graph did not silently degrade: both its steps hold scheduled
    // time, and both homes (chart AND graph) reflect the final document.
    assertHomesCurrent(state, lecture);
    const graphRefs = flattenSteps(lecture)
      .filter(
        (e) => e.step.kind === "graph-frame" || e.step.kind === "graph-layer",
      )
      .map((e) => e.ref);
    expect(graphRefs).toHaveLength(2);
    const streamed = measured(state, lecture);
    for (const ref of graphRefs) {
      expect(
        streamed.schedule.some(
          (s) => s.step.section === ref.section && s.step.step === ref.step,
        ),
      ).toBe(true);
    }

    const fresh = freshMeasured(V6);
    expect(json(streamed.schedule)).toBe(json(fresh.schedule));
    expect(streamed.duration).toBe(fresh.duration);
    assertSinglePen(streamed.schedule);
  });

  test("an edit-then-append history — a wrong paragraph fixed in place before the rest arrives — measures byte-identically too", async () => {
    const wrong = V2.replace("第三段刚追加", "第三段先写错了");
    const { state, lecture, firstNodes } = await streamThroughHost([
      V1,
      wrong,
      V2,
      V4,
      V6,
    ]);
    expect(state.nodes[0]).toBe(firstNodes[0]!); // prefix cache survived the edit
    assertHomesCurrent(state, lecture);

    const streamed = measured(state, lecture);
    const fresh = freshMeasured(V6);
    expect(json(streamed.schedule)).toBe(json(fresh.schedule));
    expect(streamed.duration).toBe(fresh.duration);
    assertSinglePen(streamed.schedule);
  });

  test("a shrink history — deleting the graph's tail layer rebuilds the frame it had fed; the home matches the final document and the measured schedule equals a fresh build", async () => {
    // V6 → V5 drops the LAST flat step. The new-entries `frameOwnsUnion`
    // scan covers only i >= divergence — an empty range here — so the ONLY
    // path that can rebuild the frame is the prev-side cascade reading the
    // dropped layer's container key out of the previous build state. Reuse
    // the frame instead and its home keeps V6's union: a three-node layout
    // on a two-node board, ink with no source. The schedule cannot see it
    // (positions live in geometry); the home-currency check is the tripwire.
    const { state, lecture, firstNodes } = await streamThroughHost([
      V1,
      V4,
      V6,
      V5,
    ]);
    expect(state.nodes[0]).toBe(firstNodes[0]!); // prefix cache survived the shrink
    assertHomesCurrent(state, lecture);

    const streamed = measured(state, lecture);
    const fresh = freshMeasured(V5);
    expect(json(streamed.schedule)).toBe(json(fresh.schedule));
    expect(streamed.duration).toBe(fresh.duration);
    assertSinglePen(streamed.schedule);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// [2] + [5] Seeds e2e — file bytes → source → factories → playable timeline
// ────────────────────────────────────────────────────────────────────────────

const SEED_DIR = join(import.meta.dir, "..", "seed");
const SEED_IDS = ["tech-zh", "pitch-zh", "tech-en", "pitch-en"] as const;

/**
 * A floor, not a pin: every shipped seed compiles to well over this many
 * scheduled units / revealables / srcSpan-carrying units, so the check
 * catches "the pipeline silently dropped most of the board" without
 * hardcoding per-seed counts that every board edit would bump.
 */
const NOT_A_TOY_FLOOR = 40;

for (const id of SEED_IDS) {
  describe(`[2/5] e2e seed ${id} — the full chain plays to completion`, () => {
    const boardBytes = readFileSync(join(SEED_DIR, id, "board.md"), "utf8");
    const themeBytes = readFileSync(join(SEED_DIR, id, "theme.css"), "utf8");

    // Lazily built once per seed — module-level work would run even when
    // the file is filtered to another describe.
    let cache: {
      lecture: Lecture;
      tracked: UnitTracker[];
      timeline: ReturnType<typeof buildTimeline>;
    } | null = null;

    async function pipeline() {
      if (cache) return cache;
      // The applied-seed workspace layout: a content-set directory.
      const feed = await openFeed({
        [`${id}/board.md`]: boardBytes,
        [`${id}/theme.css`]: themeBytes,
      });
      expect(feed.errors).toEqual([]);
      const board = feed.values[0]!.board;
      expect(board.themeCss[id]).toBe(themeBytes);
      const lecture = board.byContentSet[id]!;
      expect(lecture).toBeDefined();
      // The chain claims below (G1, completion, srcSpan) all hold
      // trivially over degraded steps — a seed must be CLEAN for them to
      // mean anything.
      expect(lecture.errors).toEqual([]);

      // Real factories in the DOM host; wrap every revealable to observe
      // the progress each seek dispatches (incremental-host.ts trackers).
      const host = makeHost();
      const built = buildAll(lecture, host);
      const keys = [...built.keys()];
      const { wrapped, trackers } = trackUnits(keys.map((k) => built.get(k)!));
      const wrappedByKey = new Map(keys.map((k, i) => [k, wrapped[i]!]));
      const tracked = trackers.flat();
      const timeline = buildTimeline(lecture, CTX, {
        unitsFor: (ref) => wrappedByKey.get(refKey(ref)),
      });
      cache = { lecture, tracked, timeline };
      return cache;
    }

    test("the source pipeline's lecture compiles byte-identically to a direct parse of the same bytes", async () => {
      const { lecture } = await pipeline();
      const direct = parseLecture(boardBytes, id);
      expect(json(planLecture(lecture, DEFAULT_DURATIONS))).toBe(
        json(planLecture(direct, DEFAULT_DURATIONS)),
      );
      expect(json(compile(lecture).schedule)).toBe(json(compile(direct).schedule));
    });

    test("G1 compile layer: the measured schedule is sorted, non-negative, pairwise zero-overlap", async () => {
      const { timeline } = await pipeline();
      expect(timeline.schedule.length).toBeGreaterThan(NOT_A_TOY_FLOOR);
      expect(timeline.duration).toBeGreaterThan(0);
      assertSinglePen(timeline.schedule);
    });

    test("G1 runtime: sampling the playback never finds two units in progress; the board plays to completion", async () => {
      const { timeline, tracked } = await pipeline();
      expect(tracked.length).toBeGreaterThan(NOT_A_TOY_FLOOR);
      for (let t = 0; t <= timeline.duration + 0.1; t += 0.05) {
        timeline.seek(t);
        const inProgress = tracked.filter((s) => s.p > 0 && s.p < 1).length;
        expect(inProgress).toBeLessThanOrEqual(1);
      }
      // Playable to completion: after the final seek every unit is done.
      timeline.seek(timeline.duration + 1);
      expect(tracked.every((s) => s.p === 1)).toBe(true);
      // …and scrubbing home restores the blank board (pure projection).
      timeline.seek(0);
      expect(tracked.every((s) => s.p === 0)).toBe(true);
    });

    test("G6 srcSpan: every revealed unit carries a span inside the real seed bytes", async () => {
      const { lecture } = await pipeline();
      const plans = planLecture(lecture, DEFAULT_DURATIONS);
      let units = 0;
      for (const plan of plans) {
        for (const unit of plan.units) {
          expect(unit.srcSpan).toBeDefined();
          expect(unit.srcSpan.start).toBeGreaterThanOrEqual(0);
          expect(unit.srcSpan.end).toBeGreaterThanOrEqual(unit.srcSpan.start);
          expect(unit.srcSpan.end).toBeLessThanOrEqual(boardBytes.length);
          units++;
        }
      }
      expect(units).toBeGreaterThan(NOT_A_TOY_FLOOR);
      // Chart rows must NOT share the block-level span (G6: whole-block
      // sharing was falsified by the prototype — every unit points at its
      // own `x:` / `y:` / series / mark ROW, a PROPER subrange).
      const chartPlans = plans.filter(
        (p) => p.step.kind === "chart-frame" || p.step.kind === "chart-layer",
      );
      expect(chartPlans.length).toBeGreaterThan(0);
      for (const plan of chartPlans) {
        const block = plan.step.srcSpan;
        for (const unit of plan.units) {
          expect(unit.srcSpan.start).toBeGreaterThanOrEqual(block.start);
          expect(unit.srcSpan.end).toBeLessThanOrEqual(block.end);
          expect(unit.srcSpan.end - unit.srcSpan.start).toBeLessThan(
            block.end - block.start,
          );
        }
        // A frame writes two axes — their rows are DIFFERENT spans.
        if (plan.step.kind === "chart-frame") {
          const spans = new Set(plan.units.map((u) => json(u.srcSpan)));
          expect(spans.size).toBeGreaterThan(1);
        }
      }
    });
  });
}

// ────────────────────────────────────────────────────────────────────────────
// [3] Inference-layer property — canonical determinism, byte level
// ────────────────────────────────────────────────────────────────────────────

/** Seeded PRNG (mulberry32) — reproducible failures. */
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

/**
 * Random board generator biased toward the [4] combination surface:
 * formulas, backrefs, aligned lists and chart continuations appear far
 * more often than in organic boards, so the determinism property is
 * exercised exactly where the dialect features interact.
 */
function randomComboBoard(seed: number): string {
  const rnd = mulberry32(seed);
  const blocks: string[] = [];
  const anchors: string[] = []; // texts a later backref can hit
  let charts = 0;
  const n = 5 + Math.floor(rnd() * 9);
  for (let i = 0; i < n; i++) {
    const roll = rnd();
    if (roll < 0.14) {
      const word = rnd() < 0.5 ? `锚点${i}` : `anchor${i}`;
      anchors.push(word);
      blocks.push(`第${i}段有 ${word} 和公式 $x_${i}^2$ 同行。`);
    } else if (roll < 0.28 && anchors.length > 0) {
      const target = anchors[Math.floor(rnd() * anchors.length)]!;
      blocks.push(rnd() < 0.5 ? `@circle "${target}"` : `@strike "${target}"`);
    } else if (roll < 0.42) {
      blocks.push(`- 甲${i}: $\\frac{1}{${i + 2}}$\n- 乙${i}: 数值${i}`);
    } else if (roll < 0.56) {
      const name = `c${charts++}`;
      blocks.push(
        `\`\`\`chart ${name}\nx: A .. B\ny: 0 ${10 + i}\n+ s${i}: 1 ${i + 2} 3\n\`\`\``,
      );
      if (rnd() < 0.6) {
        blocks.push(`\`\`\`chart ${name}\n+ t${i}: ${i} 4 5\n\`\`\``);
      }
    } else if (roll < 0.64) {
      blocks.push(`## 小节${i}`);
    } else if (roll < 0.72) {
      blocks.push(`$$e^{i\\pi} + ${i} = ${i - 1}$$`);
    } else if (roll < 0.8) {
      blocks.push(`@wait ${(rnd() * 1.5).toFixed(1)}`);
    } else if (roll < 0.88) {
      const word = `词${i}`;
      anchors.push(word);
      blocks.push(`==${word}== 值得强调,顺带 $100 是货币不是公式。`);
    } else {
      blocks.push("---");
    }
  }
  return blocks.join("\n\n");
}

describe("[3] canonical determinism — same input bytes, byte-identical output", () => {
  test("plan and schedule are byte-identical across two independent parse→plan→compile runs (25 generated boards)", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const src = randomComboBoard(seed);
      const runA = parseLecture(src);
      const runB = parseLecture(src);
      expect(json(planLecture(runA, DEFAULT_DURATIONS))).toBe(
        json(planLecture(runB, DEFAULT_DURATIONS)),
      );
      const tA = buildTimeline(runA, CTX);
      const tB = buildTimeline(runB, CTX);
      expect(json(tA.schedule)).toBe(json(tB.schedule));
      expect(tA.duration).toBe(tB.duration);
      assertSinglePen(tA.schedule);
    }
  });

  test(
    "the four shipped seeds hold the property ACROSS PROCESSES — a fresh Bun process reproduces the exact plan+schedule+duration bytes",
    async () => {
      // A same-process double call (`expect(f(x)).toBe(f(x))`) cannot go
      // red here: clock/RNG/global-state reads are banned by the static
      // grep already, and iteration order / hash seeding / cached module
      // state only vary BETWEEN processes. So the referee is a child
      // process running determinism-probe.ts — the same hash function over
      // the same seed bytes, in a fresh runtime.
      const probe = Bun.spawn(
        [process.execPath, join(import.meta.dir, "determinism-probe.ts")],
        { stdout: "pipe", stderr: "pipe" },
      );
      const [out, err, exitCode] = await Promise.all([
        new Response(probe.stdout).text(),
        new Response(probe.stderr).text(),
        probe.exited,
      ]);
      if (exitCode !== 0) {
        throw new Error(`determinism probe exited ${exitCode}:\n${err}`);
      }
      const lines = out.trim().split("\n");
      expect(lines).toHaveLength(SEED_IDS.length);
      const childHashes = new Map(
        lines.map((l) => l.split(" ") as [string, string]),
      );
      for (const id of SEED_IDS) {
        const src = readFileSync(join(SEED_DIR, id, "board.md"), "utf8");
        expect(`${id} ${childHashes.get(id)}`).toBe(
          `${id} ${canonicalHash(src, id)}`,
        );
      }
    },
    30_000,
  );
});

// ────────────────────────────────────────────────────────────────────────────
// [4] Dialect combination surface — all six pairs of
//     formula × backref × align group × chart continuation
// ────────────────────────────────────────────────────────────────────────────

/** Shared bar for every combo: clean parse, G1, determinism. */
function assertComboHealthy(src: string): Lecture {
  const lecture = parseLecture(src);
  expect(lecture.errors.map((e) => `${e.code}: ${e.message}`)).toEqual([]);
  expect(
    flattenSteps(lecture).filter((e) => e.step.kind === "bad"),
  ).toEqual([]);
  const timeline = buildTimeline(lecture, CTX);
  assertSinglePen(timeline.schedule);
  expect(json(timeline.schedule)).toBe(
    json(buildTimeline(parseLecture(src), CTX).schedule),
  );
  return lecture;
}

const stepOfKind = <K extends Step["kind"]>(lecture: Lecture, kind: K) =>
  flattenSteps(lecture).filter(
    (e): e is typeof e & { step: Extract<Step, { kind: K }> } =>
      e.step.kind === kind,
  );

describe("[4] formula × backref", () => {
  test("a backref target AFTER an inline formula resolves — the formula is zero-width in the plain-text 口径, offsets must survive it", () => {
    const lecture = assertComboHealthy(
      '质能关系 $E=mc^2$ 先立住再说。\n\n@circle "先立住"\n',
    );
    const [backref] = stepOfKind(lecture, "backref");
    expect(backref).toBeDefined();
    const target = flattenSteps(lecture).find(
      (e) =>
        e.ref.section === backref!.step.target.step.section &&
        e.ref.step === backref!.step.target.step.step,
    )!;
    // The resolved range reads back as exactly the quoted text.
    const plain = stepPlainText(target.step);
    expect(
      plain.slice(backref!.step.target.start, backref!.step.target.end),
    ).toBe("先立住");
  });

  test("the KNOWN trap: a quoted target that crosses a $…$ formula cannot match and degrades LOUDLY to refUnresolved", () => {
    // Formulas are zero-width in plain text, so the quoted bytes can never
    // be found. Silent misplacement here was the seed-board bug class the
    // T5 suite was built against; the contract is a LOUD bad step.
    const lecture = parseLecture(
      '质能关系 $E=mc^2$ 先立住。\n\n@strike "关系 $E=mc^2$ 先"\n',
    );
    expect(lecture.errors.map((e) => e.code)).toEqual(["refUnresolved"]);
    const bads = flattenSteps(lecture).filter((e) => e.step.kind === "bad");
    expect(bads).toHaveLength(1);
    // The rest of the board still performs.
    const timeline = buildTimeline(lecture, CTX);
    expect(timeline.schedule.length).toBeGreaterThan(0);
    assertSinglePen(timeline.schedule);
  });
});

describe("[4] formula × align group", () => {
  test("aligned list rows carrying formulas parse into list items with math runs and ONE align group whose offsets the formulas leave intact", () => {
    const lecture = assertComboHealthy(
      "- 动能: $\\frac{1}{2}mv^2$\n- 势能: $mgh$\n- 合计: 守恒\n",
    );
    const items = stepOfKind(lecture, "list-item");
    expect(items).toHaveLength(3);
    const mathRuns = items.flatMap((e) =>
      e.step.inline.filter((r) => r.kind === "math"),
    );
    expect(mathRuns.length).toBe(2);

    // The align contract itself (§4.3): every row carries a colon align in
    // the SAME group, `at` agrees with the plain-text 口径 the renderer
    // slices by, and value-side formulas do not move the label offset.
    const aligned = items.map((e) => ({
      plain: stepPlainText(e.step),
      align: e.step.align,
    }));
    for (const { plain, align } of aligned) {
      expect(align).toBeDefined();
      expect(align!.sep).toBe("colon");
      expect(plain[align!.at]).toBe(":");
    }
    expect(new Set(aligned.map(({ align }) => align!.group)).size).toBe(1);
    expect(
      aligned.map(({ plain, align }) => plain.slice(0, align!.at)),
    ).toEqual(["动能", "势能", "合计"]);
  });

  test("a formula on the LABEL side shifts the separator offset — `at` must stay true to the zero-width plain-text 口径", () => {
    // Math runs are ZERO-WIDTH in stepPlainText, so a label-side formula
    // moves the colon's plain-text offset. This is the offset class that
    // produced two shipped fixes (856907a: label colons cut reveal
    // segments; d1c27f0: the math wipe window must hug the formula) —
    // here it is pinned at the parse layer's half of the contract.
    const lecture = assertComboHealthy(
      "- 动能 $E_k$: 二分之一mv方\n- 势能 $E_p$: mgh\n- 合计: 守恒\n",
    );
    const items = stepOfKind(lecture, "list-item");
    expect(items).toHaveLength(3);
    const aligns = items.map((e) => e.step.align);
    for (const [i, item] of items.entries()) {
      expect(aligns[i]).toBeDefined();
      expect(aligns[i]!.sep).toBe("colon");
      // Whatever the offset, it must index the colon in the plain text.
      expect(stepPlainText(item.step)[aligns[i]!.at]).toBe(":");
    }
    // Same separator type → still ONE group…
    expect(new Set(aligns.map((a) => a!.group)).size).toBe(1);
    // …but the offsets genuinely DIFFER across the group: the zero-width
    // formula leaves its flanking space in the label ("动能 " = 3 chars)
    // while the formula-less row keeps 2. A measurer that assumed one
    // shared `at` per group would misalign exactly here.
    expect(aligns.map((a) => a!.at)).toEqual([3, 3, 2]);
    expect(stepPlainText(items[0]!.step).slice(0, aligns[0]!.at)).toBe("动能 ");
    expect(stepPlainText(items[2]!.step).slice(0, aligns[2]!.at)).toBe("合计");
  });
});

describe("[4] formula × chart continuation", () => {
  test("a display formula between a chart and its continuation does not break the continuation's frame resolution", () => {
    const lecture = assertComboHealthy(
      "```chart f\nx: A .. B\ny: 0 10\n+ 甲: 1 2\n```\n\n$$E = mc^2$$\n\n```chart f\n+ 乙: 3 4\n```\n",
    );
    expect(stepOfKind(lecture, "chart-frame")).toHaveLength(1);
    expect(stepOfKind(lecture, "chart-layer")).toHaveLength(1);
    expect(stepOfKind(lecture, "math")).toHaveLength(1);
    // Document order on the canonical timeline: frame, math, layer.
    const order = flattenSteps(lecture).map((e) => e.step.kind);
    expect(order).toEqual(["chart-frame", "math", "chart-layer"]);
  });
});

describe("[4] backref × align group", () => {
  test("a backref lands INSIDE an aligned list item's text", () => {
    const lecture = assertComboHealthy(
      '- 需求: 三倍\n- 供给: 受限\n\n@circle "三倍"\n',
    );
    const [backref] = stepOfKind(lecture, "backref");
    const items = stepOfKind(lecture, "list-item");
    expect(backref).toBeDefined();
    const hit = items.find(
      (e) =>
        e.ref.section === backref!.step.target.step.section &&
        e.ref.step === backref!.step.target.step.step,
    );
    expect(hit).toBeDefined();
    expect(
      stepPlainText(hit!.step).slice(
        backref!.step.target.start,
        backref!.step.target.end,
      ),
    ).toBe("三倍");
  });
});

describe("[4] backref × chart continuation", () => {
  test("nearest-upward matching walks OVER chart blocks to reach earlier prose", () => {
    const lecture = assertComboHealthy(
      '结论先立。\n\n```chart f\nx: A .. B\ny: 0 10\n+ 甲: 1 2\n```\n\n```chart f\n+ 乙: 3 4\n```\n\n@strike "结论先立"\n',
    );
    const [backref] = stepOfKind(lecture, "backref");
    expect(backref).toBeDefined();
    // It resolved to the prose at 0:0 — not to a chart step, not nothing.
    expect(backref!.step.target.step).toEqual({ section: 0, step: 0 });
  });
});

describe("[4] align group × chart continuation", () => {
  test("an aligned list between a chart and its continuation leaves BOTH intact: the continuation resolves by name, and the rows still form one align group", () => {
    const lecture = assertComboHealthy(
      "```chart f\nx: A .. B\ny: 0 10\n+ 甲: 1 2\n```\n\n- 需求: 三倍\n- 供给: 受限\n\n```chart f\n+ 乙: 3 4\n```\n",
    );
    const order = flattenSteps(lecture).map((e) => e.step.kind);
    expect(order).toEqual([
      "chart-frame",
      "list-item",
      "list-item",
      "chart-layer",
    ]);
    // The pair's align half — without it, deleting alignment entirely
    // would leave this test green: both rows carry the SAME colon group
    // with the plain-text offset the renderer slices by.
    const items = stepOfKind(lecture, "list-item");
    const aligns = items.map((e) => e.step.align);
    expect(aligns).toHaveLength(2);
    for (const [i, item] of items.entries()) {
      expect(aligns[i]).toBeDefined();
      expect(aligns[i]!.sep).toBe("colon");
      expect(stepPlainText(item.step)[aligns[i]!.at]).toBe(":");
    }
    expect(aligns[0]!.group).toBe(aligns[1]!.group);
    expect(
      items.map((e) => stepPlainText(e.step).slice(0, e.step.align!.at)),
    ).toEqual(["需求", "供给"]);
  });
});

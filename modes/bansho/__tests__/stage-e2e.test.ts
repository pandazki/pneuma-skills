/**
 * Stage-layer e2e (C1/C2/C3) — the streaming rules R1–R8 and the erase /
 * camera / board vocabulary driven through the REAL chain: simulated
 * FileChangeEvent batches → the manifest's `aggregate-file` source
 * (board-feed.ts) → the reconcile-driven incremental host with real
 * factories (incremental-host.ts) → the assignment fold → the canonical
 * timeline → `stageStateAt`. Specs: 2026-08-09-bansho-c1-tasks.md /
 * 2026-08-09-bansho-c2-c3-tasks.md; §G in 2026-08-07-bansho-tasks.md.
 *
 * Assertion discipline (same as e2e.test.ts): everything is pinned at the
 * CANONICAL / SCHEDULE layer or at the PURE FOLDS the design created for
 * exactly this purpose — `foldBoardLayout` for board membership,
 * `stageStateAt` for the camera register. Nothing here reads a DOM rect or
 * a live camera: where production measures, this suite substitutes a
 * DETERMINISTIC synthetic geometry (heights and rects as pure functions of
 * step content), because the claims under test are about scheduling,
 * zero-replay and determinism — geometry is G7's job.
 *
 * Sections:
 *  [1] R1/R2 — stage verbs arriving as APPENDS extend the tail only; a
 *      later `@erase` never replays the prefix (reveal-progress layer).
 *  [2] The `@board` discipline mid-stream: an append is a LOUD BadStep
 *      (R6 family); a top-of-document edit renumbers refs but keeps every
 *      canonical time — and the rebuilt revealed steps land as seek(1),
 *      never a replay (R4′).
 *  [3] Mid-document `@erase` / camera insertions at a held playhead (R4′):
 *      the inserted erase POPS applied (terminal state), scrubbing back
 *      reveals the erased run again (G5).
 *  [4] R5 — camera anchor failures arriving as events degrade to ONE loud
 *      bad step, blast radius zero.
 *  [5] R4 family — an edit that changes a step's measured height moves
 *      downstream PANEL membership (prefix verdicts stable) and can
 *      synthesize an auto-erase that enters the canonical schedule.
 *  [6] R8 — arrival-order determinism with stage steps in the document,
 *      sealed through the stateful host AND through `stageStateAt`.
 *  [7] Erase replay through the FULL chain — the rev 2 §2.2 three-layer
 *      scenario, streamed in, scrubbed out of order.
 *  [8] The degenerate gate: a lecture with NO stage vocabulary compiles
 *      byte-identically to the pre-stage engine (hash pinned against the
 *      real pre-C2 commit).
 *  [9] The notes projection e2e — same source, two projections, erasing
 *      never loses history (G5).
 * [10] G1 at runtime over a lecture using write, strike, erase and camera
 *      moves — at most one unit mid-flight at any instant; the pen waits
 *      while the camera travels. (`@bring` / move-board does not exist
 *      yet — its C3b placeholder, `panelOffsets`, is pinned empty.)
 * [11] The two P1s the 2026-08-10 Codex review confirmed, pinned against
 *      the CORRECT contract — promoted to permanent regressions by the
 *      amendment that fixed them.
 *
 * (The former "Known caveat" here — stageCompile mirroring the erase-as-
 * write classification — is resolved: 擦不是写 (review P1-3), an erase is
 * its own StageStepInput/StageEntry kind, never a decay boundary, and
 * both mirrors in this file reproduce that classification.)
 */

import { describe, expect, test } from "bun:test";

import { parseLecture } from "../domain.js";
import { containerKeyOf } from "../engine/container.js";
import { DEFAULT_DURATIONS } from "../engine/duration.js";
import { flattenSteps, planLecture } from "../engine/inference.js";
import {
  boardCount,
  foldBoardLayout,
  layoutKey,
  PANEL_GAP,
  panelHeightFor,
  type BoardLayout,
  type LayoutStepInput,
} from "../engine/layout.js";
import {
  buildStageSchedule,
  resolveCameraOps,
  stageStateAt,
  type CameraPose,
  type StageEntry,
  type StageSchedule,
  type StageStepInput,
  type StageView,
} from "../engine/stage.js";
import { stepPlainText } from "../engine/text.js";
import { buildTimeline } from "../engine/timeline.js";
import type {
  Lecture,
  ScheduleContext,
  StageRect,
  Step,
  StepRef,
  StepSchedule,
} from "../engine/types.js";
import {
  createPlayer,
  tick,
  timelineReplaced,
} from "../viewer/player-core.js";
import { lastLecture, openFeed } from "./board-feed.js";
import { canonicalHash } from "./determinism-probe.js";
import {
  makeHost,
  reconcileStep,
  refIndex,
  trackUnits,
  type IncrementalHost,
} from "./incremental-host.js";

const CTX: ScheduleContext = { durations: DEFAULT_DURATIONS };
const D = DEFAULT_DURATIONS;

const json = (v: unknown): string => JSON.stringify(v);

/** G1 — strict serial order: sorted, non-negative, zero overlap. */
function assertSinglePen(schedule: StepSchedule[]): void {
  for (let i = 0; i < schedule.length; i++) {
    const s = schedule[i]!;
    expect(s.start).toBeGreaterThanOrEqual(0);
    expect(s.end).toBeGreaterThanOrEqual(s.start);
    if (i > 0) expect(s.start).toBeGreaterThanOrEqual(schedule[i - 1]!.end);
  }
}

const windowOf = (schedule: readonly StepSchedule[], ref: StepRef) => {
  const entries = schedule.filter(
    (s) => s.step.section === ref.section && s.step.step === ref.step,
  );
  expect(entries.length).toBeGreaterThan(0);
  return { start: entries[0]!.start, end: entries[entries.length - 1]!.end };
};

const entriesFor = (schedule: readonly StepSchedule[], ref: StepRef) =>
  schedule.filter(
    (s) => s.step.section === ref.section && s.step.step === ref.step,
  );

const stepAt = (lecture: Lecture, ref: StepRef): Step | undefined =>
  flattenSteps(lecture).find(
    (e) => e.ref.section === ref.section && e.ref.step === ref.step,
  )?.step;

// ────────────────────────────────────────────────────────────────────────────
// Synthetic geometry — deterministic pure functions of step content.
// Production measures these in the DOM; the claims under test (scheduling,
// zero-replay, determinism) consume them only through the pure folds, so a
// content-keyed synthetic stands in exactly (and keeps every history
// comparison honest: both sides derive geometry from the same bytes).
// ────────────────────────────────────────────────────────────────────────────

/** A step's measured outer height, board px — content-keyed. */
const syntheticHeight = (step: Step): number =>
  60 + 10 * stepPlainText(step).length;

/**
 * A graph FRAME's measured height is a function of the ACCUMULATED UNION,
 * not of the frame block alone — appending a same-name layer regrows the
 * prefix frame's node (frameOwnsUnion: the parser keeps the union on the
 * frame step's `layout`, reconcile deliberately rebuilds it, the dagre
 * canvas widens). Mirrored here off `step.layout` — without it the [11]
 * P1-2 reproduction would be structurally impossible to express.
 */
const graphFrameHeight = (layout: {
  nodes: unknown[];
  edges: unknown[];
}): number => 60 + 40 * (layout.nodes.length + layout.edges.length);

/** The fold input derivation — BoardCanvas's, verbatim in miniature:
 *  pure-time / pure-config steps skipped, erase steps as erase inputs
 *  (anchored form carries the target key), content steps with measured
 *  height + container/anchor homes — and graph layers carrying the
 *  GROWTH their arrival adds to the frame's union measurement (P1-2:
 *  `graphFrameHeight` is linear in counts, so a layer's growth is
 *  exactly its own nodes' and edges' share; the invariant the real
 *  measurement pipeline keeps — frame height = own + Σ growth — holds
 *  here by construction). */
function foldInputsOf(lecture: Lecture): LayoutStepInput[] {
  const inputs: LayoutStepInput[] = [];
  for (const { ref, step } of flattenSteps(lecture)) {
    if (
      step.kind === "wait" ||
      step.kind === "camera" ||
      step.kind === "board-config"
    ) {
      continue;
    }
    if (step.kind === "erase") {
      inputs.push({
        kind: "erase",
        key: layoutKey(ref),
        ...(step.target ? { anchorKey: layoutKey(step.target) } : {}),
      });
      continue;
    }
    if (step.kind === "bad" || step.kind === "image" || step.kind === "html") {
      continue; // no built item in production — nothing to place
    }
    const container = containerKeyOf(step);
    inputs.push({
      kind: "content",
      key: layoutKey(ref),
      height:
        step.kind === "graph-frame"
          ? graphFrameHeight(step.layout)
          : syntheticHeight(step),
      ...(container !== undefined ? { container } : {}),
      ...(step.kind === "backref"
        ? { anchorKey: layoutKey(step.target.step) }
        : {}),
      ...(step.kind === "graph-layer"
        ? { growth: 40 * (step.nodes.length + step.edges.length) }
        : {}),
    });
  }
  return inputs;
}

/** Board rects for every content step: y accumulates in document order,
 *  x from the fold's panel verdict — a deterministic stand-in for the
 *  host's measured stage anchors. */
function syntheticRects(
  lecture: Lecture,
  layout: BoardLayout,
  view: StageView,
): Map<string, StageRect> {
  const rects = new Map<string, StageRect>();
  let y = 0;
  for (const input of foldInputsOf(lecture)) {
    if (input.kind !== "content") continue;
    const left =
      (layout.assignments.get(input.key)?.panel ?? 0) *
      (view.panelW + (view.panelGap ?? 0));
    rects.set(input.key, {
      left,
      top: y,
      right: left + view.panelW,
      bottom: y + input.height,
    });
    y += input.height;
  }
  return rects;
}

// ────────────────────────────────────────────────────────────────────────────
// The rig — reconcile + refold + erase wiring per event: BoardCanvas's
// rebuild pass in miniature. Wrappers are REMINTED per event exactly like
// production (the mandatory post-swap seek re-applies eraser state); the
// factory's late-bound handle resolves key → run → wrapper, with the key
// captured at BUILD time (incremental-host.ts, HostOptions).
// ────────────────────────────────────────────────────────────────────────────

interface FakeWrapper {
  style: { clipPath: string };
}

class StageRig {
  state: IncrementalHost | null = null;
  layout: BoardLayout | null = null;
  runEls = new Map<string, FakeWrapper>();
  private runByKey = new Map<string, string>();
  private readonly host;

  constructor(private readonly budget: number = Infinity) {
    this.host = makeHost({
      eraseTarget: (_step, ref) => {
        const key = layoutKey(ref); // captured at BUILD time — never lazily
        return {
          resolve: () => {
            const run = this.runByKey.get(key);
            return run ? (this.runEls.get(run) ?? null) : null;
          },
        };
      },
    });
  }

  /** One event: reconcile the lecture, refold, remint wrappers. */
  apply(lecture: Lecture): IncrementalHost {
    this.state = reconcileStep(this.state, lecture, this.host);
    const layout = foldBoardLayout(
      foldInputsOf(lecture),
      boardCount(lecture),
      this.budget,
    );
    this.layout = layout;
    this.runByKey = new Map();
    this.runEls = new Map();
    for (const op of layout.eraseOps) {
      // Every erase is an author's `@erase` now (design §2.3) — the rig
      // used to filter `op.kind === "explicit"` past the synthesized ones.
      this.runByKey.set(op.key, op.run);
      if (op.run !== "" && !this.runEls.has(op.run)) {
        this.runEls.set(op.run, { style: { clipPath: "" } });
      }
    }
    return this.state;
  }

  /** The wrapper an explicit erase step sweeps (undefined = erased empty
   *  board — the quiet no-op path). */
  wrapperOfErase(key: string): FakeWrapper | undefined {
    const run = this.runByKey.get(key);
    return run ? this.runEls.get(run) : undefined;
  }
}

/** Measured compile off a rig state — the production `unitsFor` seam. */
const measured = (
  state: IncrementalHost,
  lecture: Lecture,
  ctx: ScheduleContext = CTX,
) =>
  buildTimeline(lecture, ctx, {
    unitsFor: (ref) => {
      const i = refIndex(state, ref);
      return i >= 0 ? state.built[i] : undefined;
    },
  });

// ────────────────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────────────────

// The stage family: an opening @board, then content and stage verbs
// arriving one event at a time.
const S1 = `@board 2

# 直播板

开场白先立住背景。

第二段推进,==关键== 转折在这里。
`;
const S2 = `${S1}
第三段继续推进背景。
`;
const S3 = `${S2}
@focus "关键"
`;
const S4 = `${S3}
@overview
`;
const S5 = `${S4}
@erase
`;

// The bare strip family (no @board — count 1, budget ∞).
const B1 = `甲部分先讲。

乙部分跟上。
`;

const compile = (lecture: Lecture) => buildTimeline(lecture, CTX);

// ────────────────────────────────────────────────────────────────────────────
// [1] R1/R2 — stage verbs arriving as appends
// ────────────────────────────────────────────────────────────────────────────

describe("[1] streaming — camera and erase verbs arriving as appends extend the tail only (R1/R2)", () => {
  test("each append event leaves the already-scheduled prefix byte-identical; every stage verb adds exactly one exclusive window", async () => {
    const feed = await openFeed({ "board.md": S1 });
    const chain = [compile(lastLecture(feed))];
    for (const src of [S2, S3, S4, S5]) {
      feed.channel.emit([{ path: "board.md", content: src, origin: "external" }]);
      chain.push(compile(lastLecture(feed)));
    }
    for (let i = 1; i < chain.length; i++) {
      const prev = chain[i - 1]!;
      const next = chain[i]!;
      expect(next.schedule.length).toBeGreaterThan(prev.schedule.length);
      expect(next.duration).toBeGreaterThan(prev.duration);
      // R1 at the canonical layer: nothing before the tail moved.
      expect(json(next.schedule.slice(0, prev.schedule.length))).toBe(
        json(prev.schedule),
      );
      assertSinglePen(next.schedule);
    }
    // The three stage events each appended EXACTLY one schedule entry —
    // a camera step is one exclusive window, an erase one sweep (G1).
    expect(chain[2]!.schedule.length + 1).toBe(chain[3]!.schedule.length);
    expect(chain[3]!.schedule.length + 1).toBe(chain[4]!.schedule.length);
    // …and the appended verbs landed as the steps the dialect promises:
    // @focus resolved its anchor to the ==关键== paragraph.
    const lecture = lastLecture(feed);
    expect(lecture.errors).toEqual([]);
    const focus = stepAt(lecture, { section: 0, step: 4 });
    expect(focus).toMatchObject({
      kind: "camera",
      op: "focus",
      target: { section: 0, step: 2 },
    });
    expect(stepAt(lecture, { section: 0, step: 5 })).toMatchObject({
      kind: "camera",
      op: "overview",
    });
    expect(stepAt(lecture, { section: 0, step: 6 })).toMatchObject({
      kind: "erase",
    });
  });

  test("a later @erase never replays the prefix: reveal-progress layer, through the host (R1)", async () => {
    const feed = await openFeed({ "board.md": B1 });
    const rig = new StageRig();
    const s1 = rig.apply(lastLecture(feed));
    const w1 = trackUnits(s1.built);
    const tl1 = buildTimeline(lastLecture(feed), CTX, {
      unitsFor: (ref) => w1.wrapped[refIndex(s1, ref)],
    });
    let player = createPlayer(tl1.duration); // live at the tip
    tl1.seek(player.t);
    expect(w1.trackers.flat().every((u) => u.p === 1)).toBe(true);

    // The erase lands as an append while the viewer holds live.
    feed.channel.emit([
      { path: "board.md", content: `${B1}\n@erase\n`, origin: "external" },
    ]);
    const lec2 = lastLecture(feed);
    const s2 = rig.apply(lec2);
    // Prefix nodes keep IDENTITY — the erase rebuilt only its own entry.
    for (let i = 0; i < s1.nodes.length; i++) {
      expect(s2.nodes[i]).toBe(s1.nodes[i]!);
      expect(s2.built[i]).toBe(s1.built[i]!);
    }

    const w2 = trackUnits(s2.built);
    const tl2 = buildTimeline(lec2, CTX, {
      unitsFor: (ref) => w2.wrapped[refIndex(s2, ref)],
    });
    player = timelineReplaced(player, tl2.duration);
    expect(player.t).toBe(tl1.duration); // live hold — no rewind
    tl2.seek(player.t); // the swap re-seek

    // Prefix: re-pinned at exactly p = 1 — never a fractional again.
    const prefixCount = s1.nodes.length;
    for (const unit of w2.trackers.slice(0, prefixCount).flat()) {
      for (const p of unit.log) expect(p).toBe(1);
    }
    // The erase window sits AFTER the held playhead: not dispatched yet,
    // the board stands unswept.
    const eraseRef: StepRef = { section: 0, step: 2 };
    expect(windowOf(tl2.schedule, eraseRef).start).toBeGreaterThanOrEqual(
      player.t,
    );
    const wrapper = rig.wrapperOfErase("0:2");
    expect(wrapper).toBeDefined();
    expect(wrapper!.style.clipPath).toBe("");

    // The clock advances INTO the eraser's sweep: only the erase unit
    // moves; the prefix receives nothing.
    for (const unit of w2.trackers.flat()) unit.log.length = 0;
    const win = windowOf(tl2.schedule, eraseRef);
    tl2.seek((win.start + win.end) / 2);
    for (const unit of w2.trackers.slice(0, prefixCount).flat()) {
      expect(unit.log).toEqual([]);
    }
    expect(wrapper!.style.clipPath).toMatch(/^polygon\(/); // mid-sweep
    tl2.seek(tl2.duration + 1);
    expect(wrapper!.style.clipPath).toBe("inset(0 0 0 100%)"); // clean board
  });
});

// ────────────────────────────────────────────────────────────────────────────
// [2] The @board discipline mid-stream
// ────────────────────────────────────────────────────────────────────────────

describe("[2] streaming — @board arriving mid-stream", () => {
  test("appended mid-lecture it is a LOUD BadStep with the address; the schedule is untouched (R6 family)", async () => {
    const feed = await openFeed({ "board.md": B1 });
    const before = compile(lastLecture(feed));
    feed.channel.emit([
      { path: "board.md", content: `${B1}\n@board 3\n`, origin: "external" },
    ]);
    const lecture = lastLecture(feed);
    expect(lecture.errors).toHaveLength(1);
    expect(lecture.errors[0]).toMatchObject({
      code: "stepParseError",
      message:
        "@board must open the lecture — write it before the first content block; the board count cannot change mid-lecture",
      step: { section: 0, step: 2 },
    });
    expect(boardCount(lecture)).toBe(1); // the count did NOT change
    expect(json(compile(lecture).schedule)).toBe(json(before.schedule));
  });

  test("a top-of-document edit adding @board 2 keeps every canonical TIME, renumbers refs — and the rebuilt revealed steps land as exactly seek(1) (R4′)", async () => {
    const P0 = `# 直播板

开场白先立住背景。

第二段推进,==关键== 转折在这里。
`;
    const feed = await openFeed({ "board.md": P0 });
    const lec1 = lastLecture(feed);
    const rig = new StageRig();
    const s1 = rig.apply(lec1);
    const w1 = trackUnits(s1.built);
    const tl1 = buildTimeline(lec1, CTX, {
      unitsFor: (ref) => w1.wrapped[refIndex(s1, ref)],
    });
    const player = createPlayer(tl1.duration);
    tl1.seek(player.t);
    expect(w1.trackers.flat().every((u) => u.p === 1)).toBe(true);

    // The agent upgrades the played strip to a two-board room in place.
    feed.channel.emit([
      { path: "board.md", content: `@board 2\n\n${P0}`, origin: "external" },
    ]);
    const lec2 = lastLecture(feed);
    expect(lec2.errors).toEqual([]);
    expect(boardCount(lec2)).toBe(2);
    const tl2 = compile(lec2);

    // The stage direction is pure configuration — zero time, zero space:
    // the schedule is byte-identical once refs are set aside…
    const times = (tl: { schedule: StepSchedule[] }) =>
      tl.schedule.map((s) => ({ unit: s.unit, start: s.start, end: s.end }));
    expect(json(times(tl2))).toBe(json(times(tl1)));
    expect(tl2.duration).toBe(tl1.duration);
    // …and the refs renumbered exactly +1 past the heading (board-config
    // claimed 0:0).
    expect(stepAt(lec2, { section: 0, step: 0 })).toMatchObject({
      kind: "board-config",
      count: 2,
    });
    for (let i = 0; i < tl1.schedule.length; i++) {
      const a = tl1.schedule[i]!.step;
      const b = tl2.schedule[i]!.step;
      expect(b.section).toBe(a.section);
      expect(b.step).toBe(a.step === -1 ? -1 : a.step + 1);
    }

    // Reveal layer: everything after the heading rebuilds (the insertion
    // diverges at flat index 1), and every rebuilt REVEALED unit lands as
    // exactly seek(1) — never a replay, never skipped (R4′ verbatim).
    const s2 = rig.apply(lec2);
    expect(s2.nodes[0]).toBe(s1.nodes[0]!); // the heading survived by hash
    const w2 = trackUnits(s2.built);
    const tl2m = buildTimeline(lec2, CTX, {
      unitsFor: (ref) => w2.wrapped[refIndex(s2, ref)],
    });
    const held = timelineReplaced(player, tl2m.duration);
    expect(held.t).toBe(tl1.duration);
    tl2m.seek(held.t);
    for (const unit of w2.trackers.flat()) {
      expect(unit.log.length).toBeGreaterThan(0);
      for (const p of unit.log) expect(p).toBe(1);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// [3] Mid-document insertions at a held playhead (R4′)
// ────────────────────────────────────────────────────────────────────────────

const M0 = `甲部分先讲。

乙部分跟上。

丙部分收束,内容要长一些拖住尾巴,让前面的重排都发生在已播区间之内。
`;

describe("[3] streaming — mid-document stage-verb insertions at a held playhead", () => {
  test("an inserted @erase POPS applied — terminal state, exactly one seek(1), never a performed sweep; scrubbing back past it reveals the run again (R4′ + G5)", async () => {
    const feed = await openFeed({ "board.md": M0 });
    const lec1 = lastLecture(feed);
    const rig = new StageRig();
    const s1 = rig.apply(lec1);
    const w1 = trackUnits(s1.built);
    const tl1 = buildTimeline(lec1, CTX, {
      unitsFor: (ref) => w1.wrapped[refIndex(s1, ref)],
    });
    let player = createPlayer(tl1.duration);
    tl1.seek(player.t);
    expect(w1.trackers.flat().every((u) => u.p === 1)).toBe(true);

    // The erase is inserted BEFORE 乙 — a mid-document structural change.
    feed.channel.emit([
      {
        path: "board.md",
        content: M0.replace("乙部分跟上", "@erase\n\n乙部分跟上"),
        origin: "external",
      },
    ]);
    const lec2 = lastLecture(feed);
    const s2 = rig.apply(lec2);
    expect(s2.nodes[0]).toBe(s1.nodes[0]!); // 甲 reused (prefix)

    const w2 = trackUnits(s2.built);
    const tl2 = buildTimeline(lec2, CTX, {
      unitsFor: (ref) => w2.wrapped[refIndex(s2, ref)],
    });
    player = timelineReplaced(player, tl2.duration);
    expect(player.t).toBe(tl1.duration);

    // Fixture guarantees, asserted so drift turns loud: the erase and the
    // renumbered 乙 both end before the held playhead (the R4′ premise);
    // only the long tail 丙 may straddle it.
    const eraseRef: StepRef = { section: 0, step: 1 };
    const renumbered: StepRef = { section: 0, step: 2 }; // old 乙
    expect(windowOf(tl2.schedule, eraseRef).end).toBeLessThanOrEqual(player.t);
    expect(windowOf(tl2.schedule, renumbered).end).toBeLessThanOrEqual(
      player.t,
    );

    tl2.seek(player.t); // the swap re-seek

    // 甲: re-pinned at final state only.
    for (const unit of w2.trackers[0]!) {
      expect(unit.log.length).toBeGreaterThan(0);
      for (const p of unit.log) expect(p).toBe(1);
    }
    // The inserted erase: exactly ONE dispatch, exactly seek(1) — the
    // board it closed stands hidden INSTANTLY (a projection, not a
    // performance the user is yanked through).
    const eraseIdx = refIndex(s2, eraseRef);
    for (const unit of w2.trackers[eraseIdx]!) expect(unit.log).toEqual([1]);
    const wrapper = rig.wrapperOfErase("0:1");
    expect(wrapper).toBeDefined();
    expect(wrapper!.style.clipPath).toBe("inset(0 0 0 100%)");
    // The renumbered revealed 乙: terminal state directly (R4′ verbatim).
    for (const unit of w2.trackers[refIndex(s2, renumbered)]!) {
      expect(unit.log).toEqual([1]);
    }

    // G5: scrub back to before the erase — the erased run REAPPEARS.
    const jiaEnd = windowOf(tl2.schedule, { section: 0, step: 0 }).end;
    const eraseStart = windowOf(tl2.schedule, eraseRef).start;
    tl2.seek((jiaEnd + eraseStart) / 2);
    expect(wrapper!.style.clipPath).toBe(""); // the eraser removed its own state
    for (const unit of w2.trackers[0]!) expect(unit.p).toBe(1); // 甲 stands written
  });

  test("an inserted camera verb shifts the suffix by its window and nothing else: prefix byte-identical, suffix windows keep their lengths (R4′)", async () => {
    const feed = await openFeed({ "board.md": M0 });
    const before = compile(lastLecture(feed));
    feed.channel.emit([
      {
        path: "board.md",
        content: M0.replace("乙部分跟上", "@overview\n\n乙部分跟上"),
        origin: "external",
      },
    ]);
    const lecture = lastLecture(feed);
    expect(lecture.errors).toEqual([]);
    const after = compile(lecture);

    // Prefix (甲): byte-identical schedule.
    const prefixLen = before.schedule.filter((s) => s.step.step < 1).length;
    expect(prefixLen).toBeGreaterThan(0);
    expect(json(after.schedule.slice(0, prefixLen))).toBe(
      json(before.schedule.slice(0, prefixLen)),
    );
    // The camera window is one exclusive entry at 0:1 (unmeasured here —
    // the placeholder keeps the window > 0 so the G3 override can land).
    const camWin = entriesFor(after.schedule, { section: 0, step: 1 });
    expect(camWin).toHaveLength(1);
    expect(camWin[0]!.end).toBeGreaterThan(camWin[0]!.start);
    // Old 0:1/0:2 became 0:2/0:3 — same unit lengths, shifted later.
    const lengths = (tl: typeof before, ref: StepRef) =>
      entriesFor(tl.schedule, ref).map((s) => (s.end - s.start).toFixed(6));
    expect(lengths(after, { section: 0, step: 2 })).toEqual(
      lengths(before, { section: 0, step: 1 }),
    );
    expect(lengths(after, { section: 0, step: 3 })).toEqual(
      lengths(before, { section: 0, step: 2 }),
    );
    expect(
      windowOf(after.schedule, { section: 0, step: 2 }).start,
    ).toBeGreaterThan(windowOf(before.schedule, { section: 0, step: 1 }).start);
    assertSinglePen(after.schedule);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// [4] R5 — camera anchor failures arriving as events
// ────────────────────────────────────────────────────────────────────────────

describe("[4] streaming — R5 camera anchor failure arriving as an event", () => {
  test("an unresolvable @focus degrades to ONE bad step with the address and message; every other window is untouched", async () => {
    const feed = await openFeed({ "board.md": B1 });
    const before = compile(lastLecture(feed));
    feed.channel.emit([
      {
        path: "board.md",
        content: `${B1}\n@focus "这个锚不存在于任何一步"\n`,
        origin: "external",
      },
    ]);
    const lecture = lastLecture(feed);
    expect(lecture.errors).toHaveLength(1);
    expect(lecture.errors[0]).toMatchObject({
      code: "refUnresolved",
      message: 'focus target not found: "这个锚不存在于任何一步"',
      step: { section: 0, step: 2 },
    });
    expect(lecture.errors[0]!.excerpt).toContain("@focus");
    expect(
      flattenSteps(lecture).filter((e) => e.step.kind === "bad"),
    ).toHaveLength(1);
    expect(json(compile(lecture).schedule)).toBe(json(before.schedule));
  });

  test("the formula-crossing trap holds for @focus exactly as for @strike: a quoted anchor crossing $…$ cannot match and degrades LOUDLY", async () => {
    const src = "质能关系 $E=mc^2$ 先立住。\n";
    const feed = await openFeed({ "board.md": src });
    feed.channel.emit([
      {
        path: "board.md",
        content: `${src}\n@focus "关系 $E=mc^2$ 先"\n`,
        origin: "external",
      },
    ]);
    const lecture = lastLecture(feed);
    expect(lecture.errors.map((e) => e.code)).toEqual(["refUnresolved"]);
    expect(
      flattenSteps(lecture).filter((e) => e.step.kind === "bad"),
    ).toHaveLength(1);
    const timeline = compile(lecture);
    expect(timeline.schedule.length).toBeGreaterThan(0);
    assertSinglePen(timeline.schedule);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// [5] R4 family — a height-changing edit moves downstream panel membership
// ────────────────────────────────────────────────────────────────────────────

describe("[5] streaming — R4 family: an edit's height change moves downstream board membership; prefix verdicts never move", () => {
  const SRC = `@board 2

# 双板

甲段。

乙段。

丙段。

丁段。
`;
  // Budget chosen against the synthetic heights (60 + 10·plain): before
  // the edit board 0 holds heading+甲+乙 (80+90+90 = 260 ≤ 270) and 丙丁
  // open board 1; after 乙 grows past the budget it moves to board 1, and
  // 丁 finds BOTH boards standing full. Until 2026-08-11 that forced a
  // synthesized erase of the earliest-filled board; the canvas pivot
  // deleted the physics (design §2.3), so 丁 now stays where the pen is
  // and the board stands over-full — visibly.
  const BUDGET = 270;

  test("prefix stability + the R4 shift + a full wall that erases NOTHING and enters the schedule as an ordinary step", async () => {
    const feed = await openFeed({ "board.md": SRC });
    const lec1 = lastLecture(feed);
    const fold1 = foldBoardLayout(foldInputsOf(lec1), boardCount(lec1), BUDGET);
    expect(fold1.assignments.get("0:2")).toEqual({ panel: 0, region: "full", run: "0.0" });
    expect(fold1.assignments.get("0:3")).toEqual({ panel: 1, region: "full", run: "1.0" });
    expect(fold1.assignments.get("0:4")).toEqual({ panel: 1, region: "full", run: "1.0" });
    expect(fold1.eraseOps).toEqual([]);

    // The edit: 乙 grows — its measured height rises with its content.
    feed.channel.emit([
      {
        path: "board.md",
        content: SRC.replace("乙段。", "乙段现在长了很多很多。"),
        origin: "external",
      },
    ]);
    const lec2 = lastLecture(feed);
    expect(lec2.errors).toEqual([]);
    const fold2 = foldBoardLayout(foldInputsOf(lec2), boardCount(lec2), BUDGET);

    // PREFIX STABILITY (R1 extended): every step before the edit keeps
    // its board AND its run, byte-identically.
    expect(fold2.assignments.get("0:-1")).toEqual(fold1.assignments.get("0:-1"));
    expect(fold2.assignments.get("0:1")).toEqual(fold1.assignments.get("0:1"));
    // The R4 shift: the edited 乙 no longer fits board 0 and moved — the
    // same class as the R4 time shift, same treatment.
    expect(fold2.assignments.get("0:2")).toEqual({ panel: 1, region: "full", run: "1.0" });
    expect(fold2.assignments.get("0:3")).toEqual({ panel: 1, region: "full", run: "1.0" });
    // 丁 found every board full. The room USED to wipe the earliest-filled
    // board here and continue there; it no longer does. 丁 joins the run
    // already open on the board the pen stands on, and board 1 stands
    // over-full — the burst the author is expected to answer with their
    // own `@erase "锚"`.
    expect(fold2.assignments.get("0:4")).toEqual({ panel: 1, region: "full", run: "1.0" });
    expect(fold2.eraseOps).toEqual([]);
    expect(fold2.cur).toBe(1);
    expect(fold2.panels[1]!.cursor).toBeGreaterThan(BUDGET);

    // …and the CANONICAL schedule shows it: with no synthesis left, 丁
    // plans exactly the units its own content plans — no leading sweep,
    // no extra exclusive window, and the timeline is byte-identical to
    // the one the plain compile produces. That equality IS the deletion:
    // there is no stage input that could re-introduce the sweep.
    const silent = compile(lec2);
    const staged = buildTimeline(lec2, { durations: D, stage: {} });
    const trigger: StepRef = { section: 0, step: 4 };
    expect(entriesFor(staged.schedule, trigger)).toHaveLength(
      entriesFor(silent.schedule, trigger).length,
    );
    const plan = planLecture(lec2, D).find(
      (p) => layoutKey(p.ref) === "0:4",
    )!;
    expect(plan.units.some((u) => u.kind === "erase")).toBe(false);
    expect(staged.duration).toBe(silent.duration);
    assertSinglePen(staged.schedule);
    expect(json(staged.schedule)).toBe(json(silent.schedule));
  });
});

// ────────────────────────────────────────────────────────────────────────────
// [6] R8 — arrival-order determinism with stage steps in the document
// ────────────────────────────────────────────────────────────────────────────

// Paragraphs long enough that the synthetic geometry has real depth —
// shallow content collapses every pose to HOME and the camera moves
// degenerate to zero seconds (asserted against below: a zero-length move
// would make half of [6] and [10] vacuous).
const F1 = `@board 2

# 双板演绎

甲段先立论,篇幅铺开一些,让它在板上占据实打实的高度。

乙段跟进推演,同样写得更满,推着跟随镜头继续往下走。
`;
const F2 = `${F1}
@focus "立论"
`;
const F3 = `${F2}
丙段继续,镜头已经衰减回笔尖,这一段也压足了分量。
`;
const F4 = `${F3}
@overview
`;
const F5 = `${F4}
@erase
`;
const F6 = `${F5}
丁段在擦过的板上重新开写,结尾也拉出足够的长度。
`;

const VIEW: StageView = {
  viewW: 1280,
  viewH: 480,
  panelW: 1280,
  panelH: panelHeightFor(1280),
  panelCount: 2,
  panelGap: PANEL_GAP,
};

/** The full stage compile off a rig state — production's derivation in
 *  miniature: fold → rects → resolveCameraOps → G3 override → timeline →
 *  StageEntry zip → StageSchedule. Deterministic in (state, lecture). */
function stageCompile(state: IncrementalHost, lecture: Lecture) {
  const layout = foldBoardLayout(
    foldInputsOf(lecture),
    boardCount(lecture),
    Infinity,
  );
  const rects = syntheticRects(lecture, layout, VIEW);
  // An explicit erase performs at the head of the BOARD it wipes —
  // production's `erasedBoardHead`, in synthetic geometry.
  const eraseHead = (key: string): StageRect | null => {
    const op = layout.eraseOps.find((o) => o.key === key);
    if (!op) return null;
    const left = op.panel * (VIEW.panelW + (VIEW.panelGap ?? 0));
    return { left, top: 0, right: left + VIEW.panelW, bottom: 0 };
  };
  const orphans = new Set(layout.orphaned);
  const inputs: StageStepInput[] = [];
  const inputKeys: string[] = [];
  for (const { ref, step } of flattenSteps(lecture)) {
    if (step.kind === "camera") {
      inputs.push({
        kind: "camera",
        op: step.op,
        anchor:
          step.op === "focus" && step.target
            ? (rects.get(layoutKey(step.target)) ?? null)
            : null,
      });
      inputKeys.push(layoutKey(ref));
      continue;
    }
    // Only performed steps enter — the production gate is "has at least
    // one revealable"; orphans (P1-1) are gap-transparent.
    const i = refIndex(state, ref);
    if (i < 0 || state.built[i]!.length === 0) continue;
    if (orphans.has(layoutKey(ref))) continue;
    if (step.kind === "erase") {
      // 擦不是写 (P1-3): the sweep never decays a latched pose and adds
      // nothing to the union; its follow target is the board's head.
      inputs.push({ kind: "erase", rect: eraseHead(layoutKey(ref)) });
      inputKeys.push(layoutKey(ref));
      continue;
    }
    inputs.push({ kind: "write", rect: rects.get(layoutKey(ref)) ?? null });
    inputKeys.push(layoutKey(ref));
  }
  const durations = new Map<string, number>();
  const moves = new Map<
    string,
    { from: CameraPose; to: CameraPose } | null
  >();
  for (const op of resolveCameraOps(inputs, VIEW, D)) {
    durations.set(inputKeys[op.index]!, op.duration);
    moves.set(inputKeys[op.index]!, op.move);
  }
  const timeline = measured(state, lecture, {
    durations: D,
    durationOverride: (step, ref) =>
      step.kind === "camera" ? durations.get(layoutKey(ref)) : undefined,
  });
  const stageEntries: StageEntry[] = timeline.schedule.map((s) => {
    const key = layoutKey(s.step);
    const kind = stepAt(lecture, s.step)?.kind;
    return kind === "camera"
      ? {
          kind: "camera",
          start: s.start,
          end: s.end,
          move: moves.get(key) ?? null,
        }
      : kind === "erase"
        ? { kind: "erase", start: s.start, end: s.end }
        : { kind: "write", start: s.start, end: s.end };
  });
  const stage = buildStageSchedule(stageEntries, VIEW, D.cameraRho);
  return { timeline, stage, layout };
}

/** Sample the register over a fixed grid — the fold's observable truth. */
function sampleStage(stage: StageSchedule, duration: number): string {
  const samples: unknown[] = [];
  for (let i = 0; i <= 97; i++) {
    samples.push(stageStateAt(stage, (duration * i) / 97));
  }
  return json(samples);
}

describe("[6] streaming — R8 arrival-order determinism with stage steps (the closing seal)", () => {
  /** Stream a history of board bytes through ONE stateful rig. */
  async function streamThroughRig(history: readonly string[]) {
    const feed = await openFeed({ "board.md": history[0]! });
    const rig = new StageRig();
    let state = rig.apply(lastLecture(feed));
    const firstNodes = state.nodes.slice();
    for (const src of history.slice(1)) {
      feed.channel.emit([{ path: "board.md", content: src, origin: "external" }]);
      state = rig.apply(lastLecture(feed));
    }
    return { state, lecture: lastLecture(feed), firstNodes };
  }

  /** The referee: a fresh rig builds the final bytes in one shot. */
  function freshCompile(src: string) {
    const lecture = parseLecture(src);
    const rig = new StageRig();
    return { ...stageCompile(rig.apply(lecture), lecture), lecture };
  }

  const seal = (
    streamedState: IncrementalHost,
    lecture: Lecture,
    finalSrc: string,
  ) => {
    const streamed = stageCompile(streamedState, lecture);
    const fresh = freshCompile(finalSrc);
    expect(json(streamed.timeline.schedule)).toBe(
      json(fresh.timeline.schedule),
    );
    expect(streamed.timeline.duration).toBe(fresh.timeline.duration);
    assertSinglePen(streamed.timeline.schedule);
    // The stage fold reads back byte-identically over the whole timeline —
    // camera poses included (the Van Wijk moves resolved off the streamed
    // host equal the fresh referee's).
    expect(sampleStage(streamed.stage, streamed.timeline.duration)).toBe(
      sampleStage(fresh.stage, fresh.timeline.duration),
    );
    // Scrub purity at the fold: shuffled query order, same answers.
    const ts = [0.3, 0.9, 0.1, 0.99, 0.5, 0.0, 0.7].map(
      (f) => f * streamed.timeline.duration,
    );
    for (const t of ts) {
      expect(json(stageStateAt(streamed.stage, t))).toBe(
        json(stageStateAt(fresh.stage, t)),
      );
    }
    return streamed;
  };

  test("five appends — content, focus, decay-write, overview, erase, coda — measure byte-identically to a single-shot build of the final bytes", async () => {
    const { state, lecture, firstNodes } = await streamThroughRig([
      F1,
      F2,
      F3,
      F4,
      F5,
      F6,
    ]);
    // The stream really exercised the CACHED path.
    expect(state.nodes[0]).toBe(firstNodes[0]!);
    const streamed = seal(state, lecture, F6);
    // The stage genuinely has moves — two camera steps resolved (a seal
    // over zero moves would be vacuous)…
    expect(streamed.stage.moves).toHaveLength(2);
    for (const m of streamed.stage.moves) {
      expect(m.end).toBeGreaterThan(m.start);
    }
    // …and every camera window carries its MEASURED Van Wijk seconds, not
    // the plan placeholder (the override really landed).
    expect(streamed.stage.moves[0]!.holdUntil).toBeGreaterThan(
      streamed.stage.moves[0]!.end,
    );
  });

  test("an edit-then-append history — a wrong paragraph fixed in place — measures byte-identically too", async () => {
    const wrong = F2.replace("乙段跟进推演", "乙段先写错了字");
    const { state, lecture, firstNodes } = await streamThroughRig([
      F1,
      wrong,
      F2,
      F4,
      F6,
    ]);
    expect(state.nodes[0]).toBe(firstNodes[0]!);
    seal(state, lecture, F6);
  });

  test("a shrink history — the coda deleted again — measures byte-identically to the shorter document", async () => {
    const { state, lecture, firstNodes } = await streamThroughRig([
      F1,
      F4,
      F6,
      F5,
    ]);
    expect(state.nodes[0]).toBe(firstNodes[0]!);
    seal(state, lecture, F5);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// [7] Erase replay through the FULL chain
// ────────────────────────────────────────────────────────────────────────────

describe("[7] erase replay through the full chain — the three-layer scenario, streamed", () => {
  // rev 2 §2.2: C1 written → E1 erases it → C2 written in the same place
  // → E2 erases C2. Unlike erase-replay.test.ts (hand-assembled units),
  // everything here is assembled by the chain itself: file events → the
  // aggregate source → reconcile with real factories → the assignment
  // fold wiring the eraser handles → buildTimeline → makeSeek.
  const H1 = "甲。\n";
  const H2 = "甲。\n\n@erase\n";
  const H3 = "甲。\n\n@erase\n\n乙。\n";
  const H4 = "甲。\n\n@erase\n\n乙。\n\n@erase\n";

  async function streamIn() {
    const feed = await openFeed({ "board.md": H1 });
    const rig = new StageRig();
    let state = rig.apply(lastLecture(feed));
    for (const src of [H2, H3, H4]) {
      feed.channel.emit([{ path: "board.md", content: src, origin: "external" }]);
      state = rig.apply(lastLecture(feed));
    }
    const lecture = lastLecture(feed);
    const w = trackUnits(state.built);
    const timeline = buildTimeline(lecture, CTX, {
      unitsFor: (ref) => w.wrapped[refIndex(state, ref)],
    });
    return { rig, state, lecture, w, timeline };
  }

  test("the streamed board scrubbed OUT OF ORDER lands on exactly the right layer each time", async () => {
    const { rig, w, timeline } = await streamIn();
    // The two runs the fold minted: 甲 in 0.0 (closed by 0:1), 乙 in 0.1
    // (closed by 0:3) — the "same place" of the scenario.
    const wrap1 = rig.wrapperOfErase("0:1")!;
    const wrap2 = rig.wrapperOfErase("0:3")!;
    expect(wrap1).toBeDefined();
    expect(wrap2).toBeDefined();
    expect(wrap1).not.toBe(wrap2);
    const pOf = (flatIndex: number) => w.trackers[flatIndex]![0]!.p;

    const win = (key: string) => {
      const [sec, st] = key.split(":").map(Number);
      return windowOf(timeline.schedule, { section: sec!, step: st! });
    };

    // At the end everything is written and both runs stand erased.
    timeline.seek(timeline.duration + 1);
    expect(pOf(0)).toBe(1); // 甲 written…
    expect(pOf(2)).toBe(1); // …乙 written…
    expect(wrap1.style.clipPath).toBe("inset(0 0 0 100%)"); // …both erased
    expect(wrap2.style.clipPath).toBe("inset(0 0 0 100%)");

    // Out-of-order scrub: from after everything, back to when ONLY 甲
    // stood — the board must show exactly 甲.
    timeline.seek((win("0:0").end + win("0:1").start) / 2);
    expect(pOf(0)).toBe(1); // 甲 reappears (E1 rolled back)
    expect(wrap1.style.clipPath).toBe(""); // E1 removed its own state
    expect(pOf(2)).toBe(0); // 乙 not written yet
    expect(wrap2.style.clipPath).toBe("");

    // Forward again to between the erases: exactly 乙.
    timeline.seek(timeline.duration + 1);
    timeline.seek((win("0:2").end + win("0:3").start) / 2);
    expect(pOf(0)).toBe(1); // 甲 written…
    expect(wrap1.style.clipPath).toBe("inset(0 0 0 100%)"); // …and erased
    expect(pOf(2)).toBe(1); // 乙 stands
    expect(wrap2.style.clipPath).toBe("");

    // Scrub purity: a chaotic query order lands on the same board state.
    for (const t of [0, timeline.duration + 1, 0.01, timeline.duration / 2]) {
      timeline.seek(t);
    }
    timeline.seek((win("0:0").end + win("0:1").start) / 2);
    expect(pOf(0)).toBe(1);
    expect(pOf(2)).toBe(0);
    expect(wrap1.style.clipPath).toBe("");
  });

  test("G8-L through the chain: scrubbing from beyond an erase INTO the content's own reveal window leaves it mid-reveal, not blown to full", async () => {
    const { rig, w, timeline } = await streamIn();
    const jiaWin = windowOf(timeline.schedule, { section: 0, step: 0 });
    timeline.seek(timeline.duration + 1); // everything erased
    timeline.seek((jiaWin.start + jiaWin.end) / 2); // into 甲's own window
    // Dispatch order was 甲.seek(fraction) THEN erase.seek(0): had the
    // eraser written any property a strategy owns, the "restore" would
    // have blown 甲 to fully revealed. The tracker holds the fraction.
    const p = w.trackers[0]![0]!.p;
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(1);
    expect(rig.wrapperOfErase("0:1")!.style.clipPath).toBe("");
  });

  test("G1 at runtime: sampling the streamed board never finds two units mid-flight — the eraser's sweep is stage time like any stroke", async () => {
    const { w, timeline } = await streamIn();
    const tracked = w.trackers.flat();
    expect(tracked.length).toBeGreaterThanOrEqual(4);
    for (let i = 0; i <= 400; i++) {
      timeline.seek((timeline.duration * i) / 400);
      const inFlight = tracked.filter((u) => u.p > 0 && u.p < 1).length;
      expect(inFlight).toBeLessThanOrEqual(1);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// [8] The degenerate gate — a stage-free lecture compiles byte-identically
//     to the pre-stage engine
// ────────────────────────────────────────────────────────────────────────────

/** Every pre-stage dialect family, ZERO stage vocabulary. */
const DEGENERATE_SRC = `# 勾股定理

先立一个==直角三角形==,两条直角边分别是 $a$ 和 $b$。

- 斜边: $c = \\sqrt{a^2+b^2}$
- 周长: $a+b+c$
- 面积: 二分之一 ab

$$a^2 + b^2 = c^2$$

@circle "直角三角形"

@wait 0.8

\`\`\`chart 验证
x: 3 .. 5
y: 0 .. 30
+ 平方和: 9 16 25
\`\`\`

---

## 推广

到了三维,~~直觉~~ 要让位给代数。

\`\`\`chart 验证
+ 斜边平方: 9 16 25
\`\`\`

\`\`\`graph 推理
勾股 → 距离公式
\`\`\`

\`\`\`graph 推理
距离公式 → 内积
\`\`\`
`;

/**
 * The stored expectation: SHA-256 over the canonical triple (plan,
 * schedule, duration) of DEGENERATE_SRC — computed IDENTICALLY by the
 * pre-stage engine at daa1c2b ("C1 delivered", the last commit before the
 * camera dialect) and by today's. A drift here means the stage layer
 * changed what a stage-free lecture compiles to — the one thing C1/C2/C3
 * all promised not to do.
 *
 * Recompute DELIBERATELY and only on a sanctioned change to the canonical
 * layer (a T5 duration retune, a dialect change that touches plans) —
 * never casually to silence a red. The hash moving IS the signal.
 *
 * Recomputed 2026-08-12 for the 禁则 segmentation fix: a mark that may not
 * begin a line is no longer a reveal unit of its own (it merges into the
 * word it terminates), which is by definition a change to the unit
 * decomposition every canonical plan is built from. `daa1c2b`'s value was
 * 7b7d753b745ea519ed01128d610ebaf1109b2908ffcdf2faf0164bfd353bd5c2.
 */
const DEGENERATE_HASH =
  "1cf82cb8a714c1a95ccec4ce8cc8a8d96743b7a8cf40643ed7e28b916104edc0";

describe("[8] the degenerate gate — no stage vocabulary, byte-stable canonical", () => {
  test("the stage-free lecture still hashes to the pre-stage engine's exact canonical triple", () => {
    const lecture = parseLecture(DEGENERATE_SRC);
    expect(lecture.errors).toEqual([]); // degraded steps would hold trivially
    expect(boardCount(lecture)).toBe(1);
    expect(canonicalHash(DEGENERATE_SRC, "")).toBe(DEGENERATE_HASH);
  });

  test("an empty stage input is inert: `stage: {}` and an empty auto-erase set compile byte-identically to no stage at all", () => {
    const lecture = parseLecture(DEGENERATE_SRC);
    const plain = buildTimeline(lecture, { durations: D });
    for (const stage of [{}, { omitStageSteps: false }]) {
      const staged = buildTimeline(lecture, { durations: D, stage });
      expect(json(staged.schedule)).toBe(json(plain.schedule));
      expect(staged.duration).toBe(plain.duration);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// [9] The notes projection e2e — 板 ≠ 笔记, erasing never loses history
// ────────────────────────────────────────────────────────────────────────────

describe("[9] the notes projection — same streamed source, two projections (G5)", () => {
  test("every content step the board projection performs, the notes projection performs too; erase and camera steps project to nothing; refs never renumber", async () => {
    // The full stage vocabulary in one streamed board — including an
    // explicit `@erase`, which since 2026-08-11 is the ONLY kind there is.
    const SRC = `@board 2

# 双板

甲段。

乙段现在长了很多很多。

@focus "甲段"

丙段。

@erase

丁段。
`;
    const feed = await openFeed({ "board.md": SRC });
    const lecture = lastLecture(feed);
    expect(lecture.errors).toEqual([]);
    const fold = foldBoardLayout(foldInputsOf(lecture), boardCount(lecture), 270);
    expect(fold.eraseOps.length).toBeGreaterThan(0); // the board really erases

    const board = buildTimeline(lecture, { durations: D });
    const notes = buildTimeline(lecture, {
      durations: D,
      stage: { omitStageSteps: true },
    });

    const kindOf = (ref: StepRef) => stepAt(lecture, ref)?.kind;
    const contentRefs = (tl: { schedule: StepSchedule[] }) => {
      const keys = new Set<string>();
      for (const s of tl.schedule) {
        const kind = kindOf(s.step);
        if (kind !== "camera" && kind !== "erase") keys.add(layoutKey(s.step));
      }
      return keys;
    };

    // The invariant: the notes projection contains EVERY content step the
    // board projection does — erasing never loses history.
    const boardContent = contentRefs(board);
    const notesContent = contentRefs(notes);
    for (const key of boardContent) expect(notesContent.has(key)).toBe(true);
    expect([...notesContent].sort()).toEqual([...boardContent].sort());

    // The steps an erase HID on the board are still performed in notes —
    // with their full windows, not vestiges.
    for (const op of fold.eraseOps) {
      for (const target of op.targets) {
        const [sec, st] = target.split(":").map(Number);
        const ref: StepRef = { section: sec!, step: st! };
        expect(notesContent.has(target)).toBe(true);
        const noteWin = windowOf(notes.schedule, ref);
        expect(noteWin.end).toBeGreaterThan(noteWin.start);
      }
    }

    // Notes: zero stage windows. The `@erase` step itself is neutralized
    // (it plans no units) while every step it HID on the board keeps its
    // full window above.
    for (const s of notes.schedule) {
      expect(kindOf(s.step)).not.toBe("camera");
      expect(kindOf(s.step)).not.toBe("erase");
    }
    // No content step carries a leading sweep in EITHER projection: the
    // difference between them is the stage steps and nothing else, which
    // is only true because no erase is synthesized onto a content step.
    for (const key of boardContent) {
      const [sec, st] = key.split(":").map(Number);
      const ref: StepRef = { section: sec!, step: st! };
      expect(entriesFor(board.schedule, ref).length).toBe(
        entriesFor(notes.schedule, ref).length,
      );
    }

    // The projection neutralizes, it never renumbers: the SAME refs name
    // the SAME steps in both projections (agent addresses stay valid).
    for (const key of boardContent) {
      const [sec, st] = key.split(":").map(Number);
      expect(kindOf({ section: sec!, step: st! })).toBeDefined();
    }
    assertSinglePen(board.schedule);
    assertSinglePen(notes.schedule);
    // Both projections perform — and the board's stage windows make it
    // strictly longer than its own content share.
    expect(notes.duration).toBeGreaterThan(0);
    expect(board.duration).toBeGreaterThan(notes.duration);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// [10] G1 at runtime over write · strike · erase · camera — one axis
// ────────────────────────────────────────────────────────────────────────────

describe("[10] G1 at runtime — a lecture using write, strike, erase and both camera verbs", () => {
  const SRC = `# 五个动作

先写下论点,写是第一个动作,这一句要写得足够长,好让镜头有路可走。

- 要点: 圈与划属于第二类
- 备注: 擦与镜头随后

@strike "第二类"

@focus "论点"

@overview

@erase

尾声在擦净的板上再写一段,收束也拉出足够的长度来。
`;
  // The single strip: production feeds the board's own extent as the
  // panel geometry (BoardCanvas's unstaged branch), so panelH here is
  // simply "taller than the content".
  const STRIP_VIEW: StageView = {
    viewW: 1280,
    viewH: 480,
    panelW: 1280,
    panelH: 2400,
  };

  test("at most one unit mid-flight at ANY instant; the pen rests while the camera travels; move-board stays the empty C3b placeholder", async () => {
    const feed = await openFeed({ "board.md": SRC });
    const lecture = lastLecture(feed);
    expect(lecture.errors).toEqual([]);
    const kinds = new Set(flattenSteps(lecture).map((e) => e.step.kind));
    for (const k of ["prose", "list-item", "backref", "camera", "erase"]) {
      expect(kinds.has(k as Step["kind"])).toBe(true);
    }

    const rig = new StageRig();
    const state = rig.apply(lecture);
    const { timeline, stage } = (() => {
      // stageCompile but with tracked units: wrap, then re-measure.
      const w = trackUnits(state.built);
      const layout = rig.layout!;
      const rects = syntheticRects(lecture, layout, STRIP_VIEW);
      const inputs: StageStepInput[] = [];
      const inputKeys: string[] = [];
      for (const { ref, step } of flattenSteps(lecture)) {
        if (step.kind === "camera") {
          inputs.push({
            kind: "camera",
            op: step.op,
            anchor:
              step.op === "focus" && step.target
                ? (rects.get(layoutKey(step.target)) ?? null)
                : null,
          });
          inputKeys.push(layoutKey(ref));
          continue;
        }
        const i = refIndex(state, ref);
        if (i < 0 || state.built[i]!.length === 0) continue;
        if (step.kind === "erase") {
          // 擦不是写 (P1-3) — the strip has one board; its head is 0.
          inputs.push({
            kind: "erase",
            rect: { left: 0, top: 0, right: STRIP_VIEW.panelW, bottom: 0 },
          });
          inputKeys.push(layoutKey(ref));
          continue;
        }
        inputs.push({ kind: "write", rect: rects.get(layoutKey(ref)) ?? null });
        inputKeys.push(layoutKey(ref));
      }
      const durations = new Map<string, number>();
      const moves = new Map<
        string,
        { from: CameraPose; to: CameraPose } | null
      >();
      for (const op of resolveCameraOps(inputs, STRIP_VIEW, D)) {
        durations.set(inputKeys[op.index]!, op.duration);
        moves.set(inputKeys[op.index]!, op.move);
      }
      // Both moves must have real measured seconds — a zero-width camera
      // window would make "the pen waits" vacuously green.
      for (const d of durations.values()) expect(d).toBeGreaterThan(0);
      const timeline = buildTimeline(
        lecture,
        {
          durations: D,
          durationOverride: (step, ref) =>
            step.kind === "camera" ? durations.get(layoutKey(ref)) : undefined,
        },
        { unitsFor: (ref) => w.wrapped[refIndex(state, ref)] },
      );
      const stageEntries: StageEntry[] = timeline.schedule.map((s) => {
        const key = layoutKey(s.step);
        const kind = stepAt(lecture, s.step)?.kind;
        return kind === "camera"
          ? {
              kind: "camera",
              start: s.start,
              end: s.end,
              move: moves.get(key) ?? null,
            }
          : kind === "erase"
            ? { kind: "erase", start: s.start, end: s.end }
            : { kind: "write", start: s.start, end: s.end };
      });
      return {
        timeline: Object.assign(timeline, { trackers: w.trackers }),
        stage: buildStageSchedule(stageEntries, STRIP_VIEW, D.cameraRho),
      };
    })();

    const tracked = timeline.trackers.flat();
    expect(tracked.length).toBeGreaterThan(8);
    const cameraWindows = timeline.schedule.filter(
      (s) => stepAt(lecture, s.step)?.kind === "camera",
    );
    expect(cameraWindows).toHaveLength(2);

    for (let i = 0; i <= 600; i++) {
      const t = (timeline.duration * i) / 600;
      timeline.seek(t);
      const inFlight = tracked.filter((u) => u.p > 0 && u.p < 1).length;
      // THE invariant: one pen, one stage, one thing at a time.
      expect(inFlight).toBeLessThanOrEqual(1);
      const st = stageStateAt(stage, t);
      // Move-board does not exist yet (C3b): the fold's placeholder must
      // stay empty at every t.
      expect(st.panelOffsets).toEqual([]);
      // While the camera is STRICTLY mid-window the pen rests entirely —
      // and the register really holds a director pose, not follow.
      const inCamera = cameraWindows.some((s) => t > s.start && t < s.end);
      if (inCamera) {
        expect(inFlight).toBe(0);
        expect(st.camera.kind).toBe("pose");
      }
    }

    // Plays to completion; the erase leaves the final run standing.
    timeline.seek(timeline.duration + 1);
    expect(tracked.every((u) => u.p === 1)).toBe(true);
    // …and scrubbing home restores the blank board (pure projection).
    timeline.seek(0);
    expect(tracked.every((u) => u.p === 0)).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// [11] The two confirmed P1s (Codex review, 2026-08-10) — permanent
//      regressions
// ────────────────────────────────────────────────────────────────────────────
//
// docs/proposals/2026-08-10-bansho-stage-codex-review.md, P1-1 and P1-2.
// Both assert what the CONTRACT promises (G5's "erasure changes only the
// present board face"; the fold header's own PREFIX STABILITY invariant).
// They were written as `test.failing` while the defects stood, and were
// promoted to ordinary tests when the amendment landed — which is the only
// honest way to know a fix fixed the thing rather than something adjacent.
// Do NOT weaken these assertions: they are the two places where a test and
// an implementation once agreed with each other while both contradicted
// the spec, and that is precisely what they now stand guard against.

describe("[11] review P1s — the correct contract, pinned as permanent regressions", () => {
  test(
    "P1-1: an erase's declared target set EQUALS the run it actually hides — content created after the erase never joins the closed run",
    async () => {
      // 甲 written → erased → circled AFTER the erase. The circle's ink is
      // new expression at t₃; an erase at t₂ must not affect it (G5: 擦除
      // 只改变板面此刻的呈现). The fold orphans the late backref LOUDLY
      // (`layout.orphaned`) instead of assigning it to its target's
      // closed run — declared targets and actually-hidden subtree are one
      // set again.
      const feed = await openFeed({
        "board.md": '甲要点先立住。\n\n@erase\n\n@circle "甲要点"\n',
      });
      const lecture = lastLecture(feed);
      expect(lecture.errors).toEqual([]);
      const fold = foldBoardLayout(
        foldInputsOf(lecture),
        boardCount(lecture),
        Infinity,
      );
      // The invariant (review triage row 1, verbatim): for every erase,
      // the declared target set and the set of steps living in the run it
      // closed must be THE SAME SET.
      for (const op of fold.eraseOps) {
        if (op.run === "") continue;
        const hidden = fold.runs.get(op.run)?.steps ?? [];
        expect([...hidden].sort()).toEqual([...op.targets].sort());
      }
    },
  );

  test(
    "P1-2: appending a same-name graph layer never moves ALREADY-WRITTEN steps to another panel (prefix stability under measurement-driven regrowth)",
    async () => {
      // The frame's measured height derives from the accumulated union
      // (frameOwnsUnion) — so a pure APPEND changes a PREFIX step's
      // measurement. The fold now charges the frame at its first-written
      // size and the layer's growth at the LAYER's position
      // (LayoutStepInput.growth), so downstream membership stands still.
      // The union-derived synthetic height above keeps the regrowth
      // expressible; the growth the mirror feeds keeps the measurement
      // invariant (frame height = own + Σ growth) the real pipeline has.
      const G1 = `@board 2

# 图上作业

\`\`\`graph 流程
写板书 → 学生看
\`\`\`

中间段落写在图的下面,内容适中不长不短。

尾声段落。
`;
      const G2 = `${G1}
\`\`\`graph 流程
学生看 → 提问
学生看 → 复述
\`\`\`
`;
      // Pre-append board 0 holds heading(100) + frame(180) + 中段(260) =
      // 540 ≤ 600; the appended layer regrows the frame to 340, pushing
      // the ALREADY-WRITTEN 中段 over the budget and onto board 1.
      const BUDGET = 600;
      const feed = await openFeed({ "board.md": G1 });
      const lec1 = lastLecture(feed);
      expect(lec1.errors).toEqual([]);
      const fold1 = foldBoardLayout(foldInputsOf(lec1), boardCount(lec1), BUDGET);

      feed.channel.emit([
        { path: "board.md", content: G2, origin: "external" },
      ]);
      const lec2 = lastLecture(feed);
      expect(lec2.errors).toEqual([]);
      const fold2 = foldBoardLayout(foldInputsOf(lec2), boardCount(lec2), BUDGET);

      // Fixture guarantee, loud on drift: the append really regrew the
      // prefix frame's measurement (otherwise this test is vacuous).
      const frameKey = [...fold1.assignments.keys()].find(
        (k) => stepAt(lec1, refOfKey(k))?.kind === "graph-frame",
      )!;
      const heightIn = (lecture: Lecture) =>
        foldInputsOf(lecture).find(
          (i): i is Extract<LayoutStepInput, { kind: "content" }> =>
            i.kind === "content" && i.key === frameKey,
        )!.height;
      expect(heightIn(lec2)).toBeGreaterThan(heightIn(lec1));

      // THE CONTRACT: every step the audience already saw keeps its board
      // and its run, byte-identically, across the append.
      for (const [key, verdict] of fold1.assignments) {
        expect({ key, ...fold2.assignments.get(key) }).toEqual({
          key,
          ...verdict,
        });
      }
    },
  );
});

/** Parse an engine step key back to a ref (layoutKey's inverse). */
function refOfKey(key: string): StepRef {
  const [section, step] = key.split(":").map(Number);
  return { section: section!, step: step! };
}

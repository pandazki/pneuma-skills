/**
 * Streaming reconcile (T4, §7 R1–R4′) — the plan layer and the flow-level
 * zero-replay guarantee.
 *
 * Bar (T4-impl 验收):
 *  - R1 prefix stability: an append reuses every previously built index —
 *    replay is structurally impossible (pinned below with real factories:
 *    prefix DOM nodes keep IDENTITY and their revealables never receive a
 *    fractional progress again once complete);
 *  - R4 in-place edit: divergence-point suffix rebuild, prefix reused;
 *  - R4′ structural change: longest-common-prefix realign;
 *  - chart cascade: editing any member of an accumulated chart rebuilds
 *    the frame + every layer (shared-mutable-node rule), while a pure
 *    append of a new layer accumulates without a cascade;
 *  - align cascade: group-derived widths invalidate prefix items whose own
 *    hash did not change.
 *
 * DOM host: happy-dom (no layout — ink degrades to inert; identity and
 * dispatch behavior are what these tests pin, geometry is G7's job).
 */

import { describe, expect, test } from "bun:test";

import { parseLecture } from "../domain.js";
import { containerKeyOf } from "../engine/container.js";
import { DEFAULT_DURATIONS } from "../engine/duration.js";
import { buildTimeline } from "../engine/timeline.js";
import {
  reconcileStep,
  refIndex,
  trackUnits,
} from "./incremental-host.js";
import {
  alignCascade,
  boxWidthCascade,
  planReconcile,
  toEntries,
  type BuiltStepState,
  type ReconcileEntry,
} from "../viewer/reconcile.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

const BASE = `# 板书直播

第一段讲解,先把背景放上板。

第二段推进,==关键== 的转折在这里。
`;

const APPENDED = `${BASE}
第三段刚刚追加,直播继续。
`;

const CHART_BOARD = `图表前置说明。

\`\`\`chart rev
x: 2023 .. 2024
y: 0 .. 40
+ 甲: 1 2 3 4
\`\`\`

中间一段与图无关。

\`\`\`chart rev
+ 乙: 2 3 4 5
\`\`\`
`;

// Total over container kinds (`containerKeyOf`, not kind literals) — the
// same graph-blindness class the shared harness fixes; see
// incremental-host.ts.
const asBuilt = (entries: ReconcileEntry[]): BuiltStepState[] =>
  entries.map((e) => {
    const key = containerKeyOf(e.step);
    return { hash: e.hash, ...(key !== undefined ? { container: key } : {}) };
  });

// ── R1 — append reuses the whole prefix ─────────────────────────────────────

describe("planReconcile — R1 prefix stability", () => {
  test("append rebuilds only the new indices", () => {
    const prevEntries = toEntries(parseLecture(BASE));
    const prev = asBuilt(prevEntries);
    const next = toEntries(parseLecture(APPENDED));
    expect(next.length).toBe(prevEntries.length + 1);

    const plan = planReconcile(prev, next);
    expect(plan.divergence).toBe(prevEntries.length);
    expect(plan.rebuild).toEqual([prevEntries.length]);
    expect(plan.reuse).toEqual(prevEntries.map((_, i) => i));
  });

  test("identical document rebuilds nothing", () => {
    const entries = toEntries(parseLecture(BASE));
    const plan = planReconcile(asBuilt(entries), entries);
    expect(plan.rebuild).toEqual([]);
    expect(plan.reuse.length).toBe(entries.length);
  });

  test("hashes are position-independent — a prefix edit keeps suffix content keys", () => {
    // (§4.5: content hash is the edit-stable half; positional divergence
    // still rebuilds, but the hash itself must not depend on offsets.)
    const a = toEntries(parseLecture("固定的第一段。\n\n固定的第二段。\n"));
    const b = toEntries(
      parseLecture("改掉了的第一段,而且更长了。\n\n固定的第二段。\n"),
    );
    expect(a[1]!.hash).toBe(b[1]!.hash);
  });
});

// ── R4 / R4′ — edits and structural changes ─────────────────────────────────

describe("planReconcile — R4 edit / R4′ realign", () => {
  test("in-place edit rebuilds from the divergence point", () => {
    const prev = asBuilt(toEntries(parseLecture(APPENDED)));
    const edited = APPENDED.replace("==关键== 的转折", "==核心== 的转折");
    const next = toEntries(parseLecture(edited));

    const plan = planReconcile(prev, next);
    // flat order: heading, para1, para2(edited), para3
    expect(plan.divergence).toBe(2);
    expect(plan.rebuild).toEqual([2, 3]);
    expect(plan.reuse).toEqual([0, 1]);
  });

  test("mid-document insertion realigns on the longest common prefix", () => {
    const prev = asBuilt(toEntries(parseLecture(APPENDED)));
    const inserted = APPENDED.replace(
      "第二段推进",
      "插进来的新段落。\n\n第二段推进",
    );
    const next = toEntries(parseLecture(inserted));
    const plan = planReconcile(prev, next);
    expect(plan.divergence).toBe(2);
    expect(plan.reuse).toEqual([0, 1]);
    expect(plan.rebuild).toEqual([2, 3, 4]);
  });

  test("tail deletion rebuilds nothing — the host discards the orphaned tail", () => {
    const prev = asBuilt(toEntries(parseLecture(APPENDED)));
    const next = toEntries(parseLecture(BASE));
    const plan = planReconcile(prev, next);
    expect(plan.rebuild).toEqual([]);
    expect(plan.divergence).toBe(next.length);
  });
});

// ── Chart cascade ───────────────────────────────────────────────────────────

describe("planReconcile — chart cascade (shared mutable frame node)", () => {
  test("editing a later layer rebuilds frame + every layer, not the prose between", () => {
    const entries = toEntries(parseLecture(CHART_BOARD));
    // flat order: 0 prose, 1 frame, 2 prose, 3 layer
    expect(entries[1]!.step.kind).toBe("chart-frame");
    expect(entries[3]!.step.kind).toBe("chart-layer");

    const prev = asBuilt(entries);
    const edited = CHART_BOARD.replace("+ 乙: 2 3 4 5", "+ 乙: 2 3 4 9");
    const next = toEntries(parseLecture(edited));
    const plan = planReconcile(prev, next);

    expect(plan.divergence).toBe(3);
    expect(plan.rebuild).toEqual([1, 3]); // frame cascades in; prose 0/2 reused
    expect(plan.reuse).toEqual([0, 2]);
  });

  test("appending a NEW layer accumulates — no cascade, frame reused", () => {
    const entries = toEntries(parseLecture(CHART_BOARD));
    const prev = asBuilt(entries);
    const appended = `${CHART_BOARD}
\`\`\`chart rev
+ 丙: 3 4 5 6
\`\`\`
`;
    const next = toEntries(parseLecture(appended));
    const plan = planReconcile(prev, next);
    expect(plan.rebuild).toEqual([entries.length]); // just the new layer
    expect(plan.reuse).toEqual(entries.map((_, i) => i));
  });
});

// ── Align cascade ───────────────────────────────────────────────────────────

describe("alignCascade — group-derived widths beat hash identity", () => {
  test("a changed target width invalidates an unchanged prefix item", () => {
    const prev: BuiltStepState[] = [
      { hash: "aaaa", alignWidth: 12 },
      { hash: "bbbb", alignWidth: 30 },
      { hash: "cccc" },
    ];
    const target = new Map<number, number>([
      [0, 30], // group max grew — stale spacer
      [1, 30], // already right
      [3, 30], // not built yet — base plan covers it
    ]);
    expect(alignCascade(prev, target)).toEqual(new Set([0]));
  });

  test("an item without a spacer counts as width 0", () => {
    const prev: BuiltStepState[] = [{ hash: "aaaa" }];
    expect(alignCascade(prev, new Map([[0, 18]]))).toEqual(new Set([0]));
    expect(alignCascade(prev, new Map([[0, 0]]))).toEqual(new Set());
  });
});

// ── Box-width cascade (W2b) ─────────────────────────────────────────────────

describe("boxWidthCascade — a re-columned step must be BUILT again", () => {
  // A step's ink is the line boxes its run occupied at build time. Change
  // the width under it and the underline is drawn for lines that no longer
  // exist — and the content hash cannot see it, because not one byte of
  // the step moved.
  const entriesOf = (source: string): ReconcileEntry[] =>
    toEntries(parseLecture(source));

  const TWO_STEPS = `第一段落,占一个盒子。\n\n第二段落,也占一个盒子。\n`;

  test("a changed width invalidates a step whose bytes never moved", () => {
    const entries = entriesOf(TWO_STEPS);
    const prev: BuiltStepState[] = entries.map((e) => ({
      hash: e.hash,
      boxWidth: 1154,
    }));
    const widths = new Map(
      entries.map((e, i) => [`${e.ref.section}:${e.ref.step}`, i === 0 ? 565 : 1154]),
    );
    expect(boxWidthCascade(prev, entries, widths)).toEqual(new Set([0]));
    // Hash identity alone would have reused BOTH — that is the point.
    expect(planReconcile(prev, entries).rebuild).toEqual([]);
  });

  test("an unchanged width rebuilds nothing", () => {
    const entries = entriesOf(TWO_STEPS);
    const prev: BuiltStepState[] = entries.map((e) => ({
      hash: e.hash,
      boxWidth: 565,
    }));
    const widths = new Map(
      entries.map((e) => [`${e.ref.section}:${e.ref.step}`, 565]),
    );
    expect(boxWidthCascade(prev, entries, widths)).toEqual(new Set());
  });

  test("a step built with no recorded width is left to the base plan", () => {
    // The notes projection measures in CSS flow and records no width; a
    // switch back to the board must not be read as "every step moved".
    const entries = entriesOf(TWO_STEPS);
    const prev: BuiltStepState[] = entries.map((e) => ({ hash: e.hash }));
    const widths = new Map(
      entries.map((e) => [`${e.ref.section}:${e.ref.step}`, 565]),
    );
    expect(boxWidthCascade(prev, entries, widths)).toEqual(new Set());
  });

  test("a step the scan has no width for is left alone", () => {
    // `@wait` / `@camera` never reach the width scan; a missing entry is
    // "no opinion", never "width 0".
    const entries = entriesOf(TWO_STEPS);
    const prev: BuiltStepState[] = entries.map((e) => ({
      hash: e.hash,
      boxWidth: 565,
    }));
    expect(boxWidthCascade(prev, entries, new Map())).toEqual(new Set());
  });
});

// ── Flow-level zero-replay: real factories + canonical timeline ─────────────
// (Incremental host + progress trackers live in incremental-host.ts —
//  shared with e2e.test.ts so the two suites cannot drift apart again.)

describe("flow — append never replays already-shown content (R1/R2)", () => {
  test("prefix nodes keep identity; complete units never see fractional progress again", () => {
    // 1. Initial board, fully shown (live playhead at the tip).
    const lec1 = parseLecture(BASE);
    const s1 = reconcileStep(null, lec1);
    const w1 = trackUnits(s1.built);
    const tl1 = buildTimeline(
      lec1,
      { durations: DEFAULT_DURATIONS },
      { unitsFor: (ref) => w1.wrapped[refIndex(s1, ref)] },
    );
    tl1.seek(tl1.duration); // everything shown

    // 2. Agent appends one step (chokidar → re-parse → reconcile).
    const lec2 = parseLecture(APPENDED);
    const s2 = reconcileStep(s1, lec2);

    // Prefix DOM nodes are the SAME objects — no remount, no flicker.
    for (let i = 0; i < s1.nodes.length; i++) {
      expect(s2.nodes[i]).toBe(s1.nodes[i]!);
      expect(s2.built[i]).toBe(s1.built[i]!);
    }

    // 3. Recompile canonical, restore visual state at the held playhead.
    const w2 = trackUnits(s2.built);
    const tl2 = buildTimeline(
      lec2,
      { durations: DEFAULT_DURATIONS },
      { unitsFor: (ref) => w2.wrapped[refIndex(s2, ref)] },
    );
    expect(tl2.duration).toBeGreaterThan(tl1.duration);
    tl2.seek(tl1.duration); // the held live position (R2 hold)

    // Prefix units may be re-pinned to their final state (p = 1, an
    // idempotent no-op) but must NEVER receive 0 ≤ p < 1 again.
    const prefixCount = s1.nodes.length;
    for (const unit of w2.trackers.slice(0, prefixCount).flat()) {
      for (const p of unit.log) expect(p).toBe(1);
    }

    // 4. The clock advances INTO the appended step's first unit — probed at
    //    the unit's own midpoint, because a merely nudged clock can still
    //    sit inside the step's lead-in (pen travel) where NOTHING
    //    dispatches, which would leave this claim vacuously green. Only
    //    suffix units move; the appended unit really is mid-reveal.
    for (const unit of w2.trackers.flat()) unit.log.length = 0;
    const appended = tl2.schedule.find(
      (s) => s.step.section === 0 && s.step.step === 2,
    );
    expect(appended).toBeDefined();
    tl2.seek((appended!.start + appended!.end) / 2);
    for (const unit of w2.trackers.slice(0, prefixCount).flat()) {
      expect(unit.log).toEqual([]);
    }
    expect(
      w2.trackers
        .slice(prefixCount)
        .flat()
        .some((unit) => unit.log.some((p) => p > 0 && p < 1)),
    ).toBe(true);
  });

  test("R8 determinism — final board compiles byte-identically regardless of arrival order", () => {
    const direct = buildTimeline(parseLecture(APPENDED), {
      durations: DEFAULT_DURATIONS,
    });
    const streamed = buildTimeline(parseLecture(APPENDED), {
      durations: DEFAULT_DURATIONS,
    });
    expect(JSON.stringify(streamed.schedule)).toBe(
      JSON.stringify(direct.schedule),
    );
    expect(streamed.duration).toBe(direct.duration);
  });
});

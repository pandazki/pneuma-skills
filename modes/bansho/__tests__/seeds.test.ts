/**
 * T5/T8 — the four shipped demo boards, pinned as artifacts.
 *
 * A seed board is not decoration: it is the first thing a user sees and the
 * agent's few-shot 范文. So it gets the same bar as code —
 *
 *  - it must parse CLEAN (零 bad step、零 refUnresolved): a seed that ships
 *    a broken block teaches the agent to write broken blocks, and the known
 *    silent failure (a `@strike` target that crosses `$…$` — formulas are
 *    zero-width in the plain-text 口径) would land exactly here;
 *  - it must actually DEMONSTRATE what it was commissioned to demonstrate,
 *    so a later copy-edit can't quietly gut the 范文;
 *  - G1 (单笔不变式) is asserted on the REAL seed bytes, not only on the
 *    generated lectures of timeline.test.ts — the板 the product owner looks
 *    at is the one whose serial-ness has to hold.
 *
 * G8-A (the font stack) is checked at EVERY site that writes one down —
 * the seeds' `theme.css`, the engine default in `board-css.ts` (what a
 * seedless board actually renders with) and the harness — for the one trap
 * that cost the prototype its handwriting feel: `Hannotate SC` silently
 * falls back to PingFang, so it must not appear anywhere.
 *
 * T8 doubles the catalogue: every board ships in Chinese AND English, so
 * the commissioned-content suites below run per FAMILY (tech / pitch)
 * rather than per board. That parameterization is the point — an English
 * board that quietly drops the formula, the turn-back strike or the
 * three-way aligned list is not "the English version", it is a different
 * and lesser board, and the family loop is what makes that fail. The
 * language-neutral suites (parse health, G1, theme.css) run over all four.
 *
 * S1+ — the seeds also carry the STAGE layer, and each family carries the
 * half its own argument earns. Before this, all four boards were single
 * scrolling strips: `@board` / `@turn` / `@erase` / `@focus` / `@overview`
 * and ```graph appeared ZERO times across the catalogue, so a user starting
 * from a seed would conclude the mode does one long strip and nothing else.
 * The suites below pin the split that fixed it, because the split is a
 * judgement a copy-edit can quietly undo:
 *
 *  - **tech is the room's board** — two competing models (Amdahl's ceiling,
 *    then the coherence cost that bends the curve down) belong side by side,
 *    so it stands four boards, `@turn`s at the topic boundaries, retires the
 *    algebra board by name once the curves have taken it over, and steps back
 *    with `@overview` before the close;
 *  - **pitch is the strip's board** — its contrast is two trends in ONE chart
 *    (charts.md's own teaching), so it stays a strip and spends its stage
 *    budget where the argument is structural: a ```graph for the pipeline and
 *    one `@focus` back to the claim the close rests on.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { LocalizedString } from "../../../core/types/mode-manifest.js";
import { resolveSeedCatalog } from "../../../server/seed-installer.js";
import banshoManifest from "../manifest.js";
import { parseLecture } from "../domain.js";
import { DEFAULT_DURATIONS } from "../engine/duration.js";
import { flattenSteps } from "../engine/inference.js";
import { stepPlainText } from "../engine/text.js";
import { buildTimeline } from "../engine/timeline.js";
import { BOARD_BASE_CSS } from "../viewer/board-css.js";
import type {
  Lecture,
  ScheduleContext,
  Step,
  StepSchedule,
} from "../engine/types.js";

const SEED_DIR = join(import.meta.dir, "..", "seed");
const GALLERY_DIR = join(import.meta.dir, "..", "seed-gallery");

/** The two commissioned boards, each in both languages (T5 + T8). */
const TECH_IDS = ["tech-zh", "tech-en"] as const;
const PITCH_IDS = ["pitch-zh", "pitch-en"] as const;
const SEED_IDS = [...TECH_IDS, ...PITCH_IDS] as const;
type SeedId = (typeof SEED_IDS)[number];

const read = (id: SeedId, file: string): string =>
  readFileSync(join(SEED_DIR, id, file), "utf8");

const lectureOf = (id: SeedId): Lecture => parseLecture(read(id, "board.md"), id);

const stepsOf = (id: SeedId): Step[] =>
  flattenSteps(lectureOf(id)).map((e) => e.step);

/** Every step of `kind`, in document order. */
const ofKind = <K extends Step["kind"]>(
  steps: Step[],
  kind: K,
): Array<Extract<Step, { kind: K }>> =>
  steps.filter((s): s is Extract<Step, { kind: K }> => s.kind === kind);

// ────────────────────────────────────────────────────────────────────────────
// Parse health — a seed board must be flawless, not merely survivable
// ────────────────────────────────────────────────────────────────────────────

for (const id of SEED_IDS) describe(`seed ${id} parses clean`, () => {
  test("no parse issues and no bad steps", () => {
    const lecture = lectureOf(id);
    // Message text included so a failure names the offending block instead of
    // just "expected 1 to be 0".
    expect(lecture.errors.map((e) => `${e.code}: ${e.message}`)).toEqual([]);
    expect(ofKind(stepsOf(id), "bad")).toEqual([]);
  });

  test("every back reference resolves to a real target range", () => {
    const lecture = lectureOf(id);
    const byRef = new Map(
      flattenSteps(lecture).map((e) => [`${e.ref.section}:${e.ref.step}`, e.step]),
    );
    const backrefs = ofKind(stepsOf(id), "backref");
    // A seed with zero backrefs would silently pass the resolution check —
    // both commissioned boards use the 回头划/圈 gesture.
    expect(backrefs.length).toBeGreaterThan(0);
    for (const ref of backrefs) {
      const target = byRef.get(`${ref.target.step.section}:${ref.target.step.step}`);
      expect(target).toBeDefined();
      const plain = stepPlainText(target!);
      expect(plain.slice(ref.target.start, ref.target.end)).toBe(ref.targetText);
    }
  });

  test("no dead dialect: @with / @after never appear", () => {
    // G1 history note — the parallel verbs were removed; a seed that used
    // them would both break AND teach the agent a removed syntax.
    expect(read(id, "board.md")).not.toMatch(/^@(with|after)\b/m);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Commissioned content — what each board was built to demonstrate (T5 spec)
// ────────────────────────────────────────────────────────────────────────────

for (const id of TECH_IDS) describe(`${id} — 拆概念 + 公式 + 回头划掉错误提法`, () => {
  // Lazy on purpose: a describe body runs at COLLECTION time, so reading the
  // seed there turns a missing/unreadable board.md into a file-level
  // explosion before any test exists — instead of the targeted "seed parses
  // clean" failure this suite is built to give.
  const steps = () => stepsOf(id);
  const src = () => read(id, "board.md");

  test("carries block math and inline math", () => {
    const all = steps();
    expect(ofKind(all, "math").length).toBeGreaterThan(0);
    const inlineMath = all.flatMap((s) =>
      "inline" in s ? s.inline.filter((r) => r.kind === "math") : [],
    );
    expect(inlineMath.length).toBeGreaterThan(0);
  });

  test("先立、再驳、后划: a @strike back reference lands on an EARLIER step", () => {
    const lecture = lectureOf(id);
    const flat = flattenSteps(lecture);
    const byRef = new Map(
      flat.map((e) => [`${e.ref.section}:${e.ref.step}`, e.step]),
    );
    const strikes = flat.filter(
      (e) => e.step.kind === "backref" && e.step.action === "strike",
    );
    expect(strikes.length).toBeGreaterThan(0);
    for (const entry of strikes) {
      const step = entry.step as Extract<Step, { kind: "backref" }>;
      const targetRef = step.target.step;
      const isEarlier =
        targetRef.section < entry.ref.section ||
        (targetRef.section === entry.ref.section &&
          targetRef.step < entry.ref.step);
      expect(isEarlier).toBe(true);
      // There must be narration BETWEEN the claim and its rebuttal — that
      // gap is the whole point of 回头划 (vs. an in-place `~~x~~`): the
      // audience hears the reasoning first and only then sees the pen turn
      // back. A strike sitting right under its target is just a slow `~~`.
      const target = byRef.get(`${targetRef.section}:${targetRef.step}`);
      expect(target).toBeDefined();
      expect(step.srcSpan.start - target!.srcSpan.end).toBeGreaterThan(200);
    }
  });

  test("拆概念: at least two sections, each opened by a heading", () => {
    const lecture = lectureOf(id);
    const named = lecture.sections.filter((s) => s.heading);
    expect(named.length).toBeGreaterThanOrEqual(2);
  });

  test("多行标注: at least two passages each carry 2+ ink marks", () => {
    // The 零碰撞 acceptance item needs an authored scene to photograph —
    // several ink actions in one neighbourhood, so their overlays land on
    // adjacent wrapped lines (§6.4-G). Bun has no layout, so the collision
    // itself is unassertable here (the screenshot is that evidence); what
    // this pins is that the authored scene still EXISTS. The name states
    // exactly that bound — a name promising more than the assertion checks
    // is how a later copy-edit quietly guts the commissioned 范文.
    const dense = steps().filter(
      (s) =>
        "inline" in s &&
        s.inline.filter((r) => r.kind === "ink").length >= 2,
    );
    expect(dense.length).toBeGreaterThanOrEqual(2);
  });

  test("back-reference targets never touch a formula (the F7 silent trap)", () => {
    // `$…$` is zero-width in stepPlainText, so a target substring that
    // contains or crosses a formula soft-fails to refUnresolved. Belt and
    // braces on top of the resolution test: the quoted text itself must be
    // formula-free.
    for (const m of src().matchAll(/^@(?:strike|circle|highlight|underline)\s+"([^"]*)"/gm)) {
      expect(m[1]).not.toContain("$");
    }
  });
});

// The SAME trap, on every OTHER verb that quotes an anchor. `@focus` and
// `@erase "…"` resolve through the identical nearest-upward matcher, so a
// quote that crosses `$…$` degrades identically — and the tech boards are
// exactly where it bites, because their erase anchor sits in a sentence
// that carries an inline formula. Language-neutral: run it on all four.
for (const id of SEED_IDS) describe(`seed ${id} — every quoted anchor is formula-free`, () => {
  test("@focus / @erase anchors never touch a formula either", () => {
    for (const m of read(id, "board.md").matchAll(/^@(?:focus|erase)\s+"([^"]*)"/gm)) {
      expect(m[1], `${id}: anchor "${m[1]}" crosses a formula`).not.toContain("$");
    }
  });
});

for (const id of PITCH_IDS) describe(`${id} — 并列三点 + 对比 + 箭头串联 + 圈起结论`, () => {
  // Lazy for the same collection-time reason as the tech family above.
  const steps = () => stepsOf(id);

  test("并列三点: one align group holds three or more list items", () => {
    const groups = new Map<number, number>();
    for (const item of ofKind(steps(), "list-item")) {
      if (!item.align) continue;
      groups.set(item.align.group, (groups.get(item.align.group) ?? 0) + 1);
    }
    expect(Math.max(0, ...groups.values())).toBeGreaterThanOrEqual(3);
  });

  test("the align group's labels differ in width — otherwise it demos nothing", () => {
    // §4.3 exists because a natural text flow does NOT line the value column
    // up. If every label in the group happens to be the same length the
    // columns align by accident and the seed silently stops showing the
    // feature it was commissioned to show (measured on the board: only the
    // varying-width group renders a visible spacer).
    const byGroup = new Map<number, number[]>();
    for (const item of ofKind(steps(), "list-item")) {
      if (!item.align) continue;
      const widths = byGroup.get(item.align.group) ?? [];
      widths.push(item.align.at);
      byGroup.set(item.align.group, widths);
    }
    const spread = [...byGroup.values()].map(
      (w) => Math.max(...w) - Math.min(...w),
    );
    expect(Math.max(0, ...spread)).toBeGreaterThan(0);
  });

  test("对比: one chart accumulates two series across separate blocks", () => {
    const all = steps();
    const frames = ofKind(all, "chart-frame");
    expect(frames.length).toBeGreaterThan(0);
    const layers = ofKind(all, "chart-layer");
    const seriesByChart = new Map<string, Set<string>>();
    for (const frame of frames) {
      const names = new Set<string>();
      for (const row of frame.rows) {
        if (row.kind === "series") names.add(row.name);
      }
      seriesByChart.set(frame.chart, names);
    }
    for (const layer of layers) {
      const names = seriesByChart.get(layer.chart);
      if (!names) continue;
      for (const row of layer.rows) {
        if (row.kind === "series") names.add(row.name);
      }
    }
    // Accumulation is the point: 讲完那句 → 转身加那层.
    expect(layers.length).toBeGreaterThan(0);
    expect(Math.max(0, ...[...seriesByChart.values()].map((s) => s.size))).toBeGreaterThanOrEqual(2);
  });

  test("箭头串联: the pipeline is a ```graph — boxes and arrows, not typed arrows", () => {
    // Was: "an arrow chain is written as板书 text" — the pipeline shipped as
    // a bare paragraph of `提交 → 自动测试 → …`, which draws as handwriting
    // with literal arrow glyphs. That is the poor man's version of the block
    // the dialect actually has, and since the catalogue used ```graph
    // nowhere, the seeds taught the poor man's version as THE way. Structure,
    // comparison and arrows are what a graph is for (SKILL.md move 5), so the
    // pin is now the real container: one frame, the whole four-stage chain in
    // it, and an annotation writing an explanation into a node's box (the
    // `名字: 说明` row — the half an author is most likely to never discover).
    const frames = ofKind(steps(), "graph-frame");
    expect(frames.length).toBe(1);
    const frame = frames[0]!;
    expect(frame.nodes.length).toBeGreaterThanOrEqual(4);
    expect(frame.edges.length).toBeGreaterThanOrEqual(3);
    // The note rides the container's UNION record, never the block's own
    // `nodes[]` (engine/types.ts::GraphNode.note) — read it where it lives.
    const annotated = frame.layout.nodes.filter((n) => (n.note ?? "").length > 0);
    expect(annotated.length, "no node carries a `名字: 说明` annotation").toBeGreaterThan(0);
  });

  test("圈起结论: the closing move is a circle on the conclusion", () => {
    const all = steps();
    const circles = [
      ...ofKind(all, "backref").filter((s) => s.action === "circle"),
      ...all.flatMap((s) =>
        "inline" in s
          ? s.inline.filter((r) => r.kind === "ink" && r.action === "circle")
          : [],
      ),
    ];
    expect(circles.length).toBeGreaterThan(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// The stage layer — which verb each family earned, and which it did not
//
// These are the seeds' most fragile property, because nothing about a board
// LOOKS wrong when a stage verb goes missing: drop `@board 4` from tech and
// the four boards silently become one strip that still parses clean, still
// plays, and still reads well — it just stops teaching that the room exists,
// which is precisely the state the catalogue shipped in before this change.
// So the room is pinned as commissioned content, per family, exactly like
// the formula and the aligned list above.
// ────────────────────────────────────────────────────────────────────────────

for (const id of TECH_IDS) describe(`${id} — the room: four boards, turns, one named retirement`, () => {
  const steps = () => stepsOf(id);
  const src = () => read(id, "board.md");

  test("stands four boards, and the stage direction is the very first line", () => {
    // A `@board` anywhere but the document's first step is a BadStep, so
    // "parses clean" covers the position — what it cannot cover is someone
    // dropping the line entirely. Four is the count the argument needs: the
    // saying, Amdahl, the coherence cost and the chart each stand while the
    // next is written, and the close reuses the one board it retires.
    expect(src().startsWith("@board 4\n")).toBe(true);
    const config = ofKind(steps(), "board-config");
    expect(config.length).toBe(1);
    expect(config[0]!.count).toBe(4);
  });

  test("@turn walks the room at the topic boundaries — never on the strip", () => {
    // Three turns, one per movement that gets its own board. The count is a
    // floor with a CEILING on purpose: a turn per step would be a demo reel,
    // and the whole judgement this seed encodes is that the room moves at the
    // turns of the ARGUMENT.
    const turns = ofKind(steps(), "turn");
    expect(turns.length).toBeGreaterThanOrEqual(3);
    expect(turns.length).toBeLessThanOrEqual(4);
  });

  test("the retirement is ANCHORED — @erase names the board it retires", () => {
    // Bare `@erase` clears whatever board the pen happens to be on; the
    // anchored form names the content. The distinction is the whole reason
    // the tech board can retire its algebra without the room taking the
    // saying (board 1) that the closing `@strike` still has to reach — the
    // taught escape from board-language.md ("if you disagree with the room's
    // pick, say your own retirement first"). A copy-edit that drops the quote
    // still parses, still plays, and erases the WRONG board.
    const erases = ofKind(steps(), "erase");
    expect(erases.length).toBe(1);
    expect(erases[0]!.targetText, "the erase lost its anchor").toBeTruthy();
    expect(erases[0]!.target, "the erase anchor resolved to nothing").toBeDefined();
  });

  test("the erase happens AFTER the evidence that supersedes it", () => {
    // "This served its purpose" is a claim the lecture has to have earned:
    // the algebra board may only be retired once the curves have taken it
    // over. An erase before the chart would be retiring live working.
    const flat = flattenSteps(lectureOf(id));
    const eraseAt = flat.findIndex((e) => e.step.kind === "erase");
    const lastLayerAt = flat.reduce(
      (last, e, i) => (e.step.kind === "chart-layer" ? i : last),
      -1,
    );
    expect(lastLayerAt).toBeGreaterThan(-1);
    expect(eraseAt).toBeGreaterThan(lastLayerAt);
  });

  test("@overview steps back once, right before the room is rearranged", () => {
    // The teacher's "glance before you turn", said out loud in the lecture:
    // look at the whole wall, then retire a board, then walk to it. A
    // directed view holds through erase and turn (both are room actions, not
    // writing) and hands back to the pen at the next written step — so this
    // ORDER is what makes the gesture legible instead of a flash.
    const flat = flattenSteps(lectureOf(id));
    const cameras = flat.filter((e) => e.step.kind === "camera");
    expect(cameras.length).toBe(1);
    expect((cameras[0]!.step as Extract<Step, { kind: "camera" }>).op).toBe("overview");
    const overviewAt = flat.indexOf(cameras[0]!);
    const eraseAt = flat.findIndex((e) => e.step.kind === "erase");
    expect(eraseAt).toBeGreaterThan(overviewAt);
    // Nothing WRITTEN may sit between them, or the camera is back on the pen
    // before the erase it was meant to frame.
    const between = flat.slice(overviewAt + 1, eraseAt);
    expect(between.map((e) => e.step.kind)).toEqual([]);
  });

  test("the closing strike still reaches a board that is never erased", () => {
    // The one way this board can break at RUNTIME while parsing perfectly:
    // retire the board the final `@strike` points at, and the ink lands on
    // nothing (reported as refUnresolved / inkAfterErase by the live board,
    // which no pure test can see). The structural guard is that the strike's
    // target sits EARLIER than the erase's target — different movement,
    // therefore a different board, and the erased one is behind it.
    const flat = flattenSteps(lectureOf(id));
    const strike = flat.find(
      (e) => e.step.kind === "backref" && e.step.action === "strike",
    );
    const erase = flat.find((e) => e.step.kind === "erase");
    expect(strike).toBeDefined();
    expect(erase).toBeDefined();
    const strikeTarget = (strike!.step as Extract<Step, { kind: "backref" }>).target.step;
    const eraseTarget = (erase!.step as Extract<Step, { kind: "erase" }>).target!;
    const earlier =
      strikeTarget.section < eraseTarget.section ||
      (strikeTarget.section === eraseTarget.section &&
        strikeTarget.step < eraseTarget.step);
    expect(earlier).toBe(true);
  });
});

for (const id of PITCH_IDS) describe(`${id} — the strip's board: one camera move, no room verbs`, () => {
  const steps = () => stepsOf(id);

  test("@focus walks back to the claim the close rests on", () => {
    // The close ("releases small enough to ship without a meeting") is an
    // inference from ONE of the three lines tabulated at the top — so the pen
    // goes back and shows it rather than restating it. One move, not a tour.
    const cameras = ofKind(steps(), "camera");
    expect(cameras.length).toBe(1);
    expect(cameras[0]!.op).toBe("focus");
    expect(cameras[0]!.target, "the focus anchor resolved to nothing").toBeDefined();
  });

  test("the focus anchor is an EARLIER step, in another section", () => {
    // A focus inside the paragraph it follows is just a pause with extra
    // syntax; the gesture only means anything when the target has scrolled
    // out of the argument's present.
    const flat = flattenSteps(lectureOf(id));
    const camera = flat.find((e) => e.step.kind === "camera")!;
    const target = (camera.step as Extract<Step, { kind: "camera" }>).target!;
    expect(target.section).toBeLessThan(camera.ref.section);
  });

  test("stays the single strip — no @board, no @turn, no @erase", () => {
    // Deliberate, and the reason it is pinned rather than merely absent:
    // pitch's contrast is two trends in ONE chart (the taught instrument),
    // so standing a second board for it would teach the room as decoration.
    // The strip is also the mode's default, and the catalogue has to show
    // someone what a good default board looks like.
    const all = steps();
    expect(ofKind(all, "board-config")).toEqual([]);
    expect(ofKind(all, "turn")).toEqual([]);
    expect(ofKind(all, "erase")).toEqual([]);
  });
});

describe("the catalogue covers the whole stage vocabulary, once", () => {
  test("every room and camera verb is demonstrated by some seed", () => {
    // The catalogue-level bar. Per-seed suites can each pass while the SET
    // still leaves a verb undemonstrated — which is exactly how `@board`,
    // `@turn`, `@erase`, `@focus`, `@overview` and ```graph all reached ship
    // with zero occurrences across four boards.
    const kinds = new Set<string>();
    const cameraOps = new Set<string>();
    for (const id of SEED_IDS) {
      for (const step of stepsOf(id)) {
        kinds.add(step.kind);
        if (step.kind === "camera") cameraOps.add(step.op);
      }
    }
    for (const kind of ["board-config", "turn", "erase", "camera", "graph-frame"]) {
      expect(kinds.has(kind), `no seed demonstrates a ${kind} step`).toBe(true);
    }
    for (const op of ["overview", "focus"]) {
      expect(cameraOps.has(op), `no seed demonstrates @${op}`).toBe(true);
    }
  });

  test("strike and erase keep their meanings apart", () => {
    // The semantic split the mode teaches: `~~x~~` / `@strike` = I am
    // refuting this and you must keep seeing it; `@erase` = this is finished,
    // let it go. A seed that retired a claim it meant to refute would teach
    // every future author the wrong verb — so the refutation stays a strike
    // (present in both tech boards) and the erasers stay unrefuting.
    for (const id of TECH_IDS) {
      const all = stepsOf(id);
      expect(
        ofKind(all, "backref").some((s) => s.action === "strike"),
        `${id}: the refutation is not a strike`,
      ).toBe(true);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// T8 — the two rules the English boards taught, pinned on the 范文
//
// Both are authoring rules, and the skill is where an agent reads them
// (`skill/references/board-language.md` and `charts.md` carry the prose;
// `skill.test.ts` pins that they are still written down there). What is
// pinned HERE is the other half: the seeds are the few-shot material, so
// a copy-edit that re-lengthens a circled phrase or re-glues a measure to
// its number would teach the failure back — silently, because neither
// mistake is a parse error. Both were found by looking at the shipped
// screenshots, not by any assertion, which is exactly why they get one.
// ────────────────────────────────────────────────────────────────────────────

/** The boards written in Latin script — where both rules bite. */
const LATIN_IDS = ["tech-en", "pitch-en"] as const;

/** Every phrase the pen draws an ARC around: inline `((…))` and `@circle`. */
function circledPhrases(id: SeedId): string[] {
  const all = stepsOf(id);
  return [
    ...ofKind(all, "backref")
      .filter((s) => s.action === "circle")
      .map((s) => s.targetText),
    ...all.flatMap((s) =>
      "inline" in s
        ? s.inline
            .filter((r) => r.kind === "ink" && r.action === "circle")
            .map((r) => (r as Extract<typeof r, { kind: "ink" }>).text)
        : [],
    ),
  ];
}

for (const id of LATIN_IDS) describe(`${id} — a circled phrase stays short`, () => {
  test("two or three short words, never a clause", () => {
    // A circle is ONE arc around whatever the phrase occupies: long enough
    // to wrap and it is drawn as two arcs, the second lassoing a stranded
    // word, and its tips land on the letters of the neighbouring word
    // (Latin word gaps are ~4px, not a CJK em). The first cut of tech-en
    // circled `the serial fraction` / `the coherence cost` and did exactly
    // that. Word count is the machine-checkable shadow of "short".
    const phrases = circledPhrases(id);
    expect(phrases.length).toBeGreaterThan(0);
    for (const phrase of phrases) {
      const words = phrase.trim().split(/\s+/);
      expect(
        words.length,
        `circled phrase "${phrase}" in ${id} is ${words.length} words`,
      ).toBeLessThanOrEqual(3);
    }
  });
});

describe("chart axes — what the axis measures", () => {
  /** Every axis declared by any seed, with its parenthesised measure. */
  const axes = (id: SeedId) =>
    ofKind(stepsOf(id), "chart-frame").flatMap((f) =>
      [f.x, f.y].filter((a): a is NonNullable<typeof a> => a != null),
    );

  for (const id of SEED_IDS) {
    test(`${id}: the parentheses hold a measure, not a scenario label`, () => {
      // T5 fixed this once on pitch-zh (a scenario label in the slot);
      // pitch-en shipped `(2026)` — a year measures nothing, and a seed
      // that does it teaches the agent the slot takes arbitrary context.
      for (const axis of axes(id)) {
        expect(axis.unit ?? "", `${id} axis measure`).not.toMatch(/^\s*\d{4}\s*$/);
      }
    });
  }

  for (const id of LATIN_IDS) {
    test(`${id}: a y measure is glued to its number, so it must read glued`, () => {
      // `${value}${measure}` — right for `24分钟`, wrong for `24min`. In
      // Latin script the measure either reads glued (×, %, °) or brings
      // its own separator: `( min)` → `0 min` / `Daily release 24 min`.
      const GLUES = ["×", "%", "°", "x"];
      for (const frame of ofKind(stepsOf(id), "chart-frame")) {
        const measure = frame.y?.unit;
        if (measure === undefined || measure === "") continue;
        const readsGlued =
          GLUES.includes(measure.trim()) || /^\s/.test(measure);
        expect(
          readsGlued,
          `${id}: y measure "${measure}" renders as "0${measure}"`,
        ).toBe(true);
      }
    });
  }

  test("pitch-en's y measure survives as a separated one, end to end", () => {
    // The leading space inside the parentheses is load-bearing and
    // invisible — a tidy-up that trims it silently reverts `0 min` to
    // `0min`. parseAxis keeps the parenthesised text verbatim; this pins
    // both halves of that (`domain.test.ts` pins the parser itself).
    const frame = ofKind(stepsOf("pitch-en"), "chart-frame")[0]!;
    expect(frame.y?.unit).toBe(" min");
    expect(`${frame.y?.from}${frame.y?.unit}`).toBe("0 min");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// G1 单笔不变式 — on the real seed bytes
// ────────────────────────────────────────────────────────────────────────────

for (const id of SEED_IDS) describe(`G1 single pen on seed ${id}`, () => {
  const ctx: ScheduleContext = { durations: DEFAULT_DURATIONS };
  const timelineOf = () => buildTimeline(lectureOf(id), ctx, { unitsFor: () => undefined });

  test("schedule intervals are sorted and pairwise non-overlapping", () => {
    const { schedule } = timelineOf();
    expect(schedule.length).toBeGreaterThan(0);
    let prev: StepSchedule | null = null;
    for (const s of schedule) {
      expect(s.start).toBeGreaterThanOrEqual(0);
      expect(s.end).toBeGreaterThanOrEqual(s.start);
      if (prev) expect(s.start).toBeGreaterThanOrEqual(prev.end);
      prev = s;
    }
  });

  test("sampling the whole timeline never finds two units in progress", () => {
    const { schedule, duration } = timelineOf();
    expect(duration).toBeGreaterThan(0);
    for (let k = 0; k <= 400; k++) {
      const t = (duration * k) / 400;
      let active = 0;
      for (const s of schedule) if (s.start < t && t < s.end) active++;
      expect(active).toBeLessThanOrEqual(1);
    }
  });

  test("the板 runs long enough to be a real lecture, short enough to watch", () => {
    // Content-derived, so this also catches an accidental truncation of the
    // seed (a half-deleted board would still parse clean).
    const { duration } = timelineOf();
    expect(duration).toBeGreaterThan(40);
    expect(duration).toBeLessThan(240);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// theme.css — G8-A, the font stack the seed owns
// ────────────────────────────────────────────────────────────────────────────

for (const id of SEED_IDS) describe(`seed ${id} theme.css`, () => {
  const css = () => read(id, "theme.css");

  test("declares the handwriting stack for both themes", () => {
    const text = css();
    expect(text).toContain(".bansho-board-surface");
    expect(text).toContain('[data-bansho-theme="dark"]');
    // Light leads with Bradley Hand, dark with Chalkboard SE (T5 spec).
    expect(text).toMatch(/--hand:\s*"Bradley Hand"/);
    expect(text).toMatch(/--hand:\s*"Chalkboard SE"/);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// G8-A at EVERY declaration site — not just the seed copies
// ────────────────────────────────────────────────────────────────────────────

/** Comments stripped: every file's comments name the banned face on purpose
 *  (that warning is the whole reason the trap stays fixed), so the ban is
 *  asserted against declarations only. */
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * Every place a `--hand` stack is written down. The seed copies are NOT the
 * only ones that matter: a board with no seed (agent writes a root
 * `board.md` — the ordinary path once the mode is in use) renders with
 * `BOARD_BASE_CSS`, so leaving that one unguarded left the G8-A failure
 * mode — reintroducing the silently-falling-back `Hannotate SC` — free to
 * come back with nothing going red. The harness carries its own copy for
 * the engine-only screenshots and is pinned for the same reason.
 *
 * Deliberately NOT asserted: that the copies AGREE. A content set owning a
 * different stack is the point of §6.3; what must hold everywhere is the
 * invariant, not the value.
 */
const HAND_STACK_SITES: Array<[label: string, css: () => string]> = [
  ["engine default (viewer/board-css.ts)", () => BOARD_BASE_CSS],
  ...SEED_IDS.map(
    (id) => [`seed ${id}/theme.css`, () => read(id, "theme.css")] as [string, () => string],
  ),
  [
    "harness/index.html",
    () => readFileSync(join(import.meta.dir, "..", "harness", "index.html"), "utf8"),
  ],
];

for (const [label, source] of HAND_STACK_SITES) describe(`G8-A — ${label}`, () => {
  const stacks = (): string[] =>
    [...stripComments(source()).matchAll(/--hand:\s*([^;]+);/g)].map((m) => m[1]!.trim());

  test("declares at least one handwriting stack", () => {
    expect(stacks().length).toBeGreaterThan(0);
  });

  test("CJK handwriting is HanziPen SC, never the silently-falling-back Hannotate SC", () => {
    for (const stack of stacks()) {
      expect(stack).toContain("HanziPen SC");
      expect(stack).not.toContain("Hannotate SC");
    }
  });

  test("ends in a generic family so non-macOS degrades to something cursive", () => {
    for (const stack of stacks()) {
      expect(stack.endsWith("cursive")).toBe(true);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Manifest wiring — the seeds must be reachable, not just present on disk
// ────────────────────────────────────────────────────────────────────────────

describe("manifest init.seedFiles", () => {
  test("all four seeds are declared in directory shape", () => {
    const seedFiles = banshoManifest.init?.seedFiles ?? {};
    for (const id of SEED_IDS) {
      const src = `modes/bansho/seed/${id}/`;
      expect(seedFiles[src]).toBe(`${id}/`);
    }
    // Nothing else: a stray entry would become a fifth gallery card the
    // moment the explicit catalogue below is ever dropped.
    expect(Object.keys(seedFiles).sort()).toEqual(
      SEED_IDS.map((id) => `modes/bansho/seed/${id}/`).sort(),
    );
  });

  test("every declared source directory exists with a board.md and a theme.css", () => {
    const repoRoot = join(import.meta.dir, "..", "..", "..");
    for (const src of Object.keys(banshoManifest.init?.seedFiles ?? {})) {
      expect(src.endsWith("/")).toBe(true);
      expect(readFileSync(join(repoRoot, src, "board.md"), "utf8").length).toBeGreaterThan(0);
      expect(readFileSync(join(repoRoot, src, "theme.css"), "utf8").length).toBeGreaterThan(0);
    }
  });

  test("contentCheckPattern still matches the seeded board", () => {
    expect(banshoManifest.init?.contentCheckPattern).toBe("**/board.md");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// T8 — the gallery catalogue and the seven-locale surface
// ────────────────────────────────────────────────────────────────────────────

/** The locales the launcher ships copy for (T8: 七语种补全). */
const LOCALES = ["en", "zh-CN", "zh-TW", "ja", "ko", "es", "de"] as const;

/** Locales whose copy cannot be Latin script — a pasted English string is
 *  pure ASCII, which is exactly the "把英文直接塞进 zh-TW" failure. */
const CJK_LOCALES = ["zh-CN", "zh-TW", "ja", "ko"] as const;

/**
 * Simplified-only forms that appear in this mode's zh-CN copy. Their
 * presence in a zh-TW string means the Simplified text was pasted across
 * rather than converted — the second half of the same failure, and one no
 * "is it non-ASCII" check can see.
 */
const SIMPLIFIED_ONLY = [
  "书", "讲", "图", "时", "间", "动", "线", "写", "节", "变", "说", "问", "张", "样", "题", "会",
];

/** Gallery card order, top-left first: the accepted zh pair, then the en pair. */
const CATALOGUE_ORDER = ["tech-zh", "pitch-zh", "tech-en", "pitch-en"] as const;

const asMap = (value: LocalizedString | undefined): Record<string, string> => {
  expect(typeof value).toBe("object");
  return value as Record<string, string>;
};

/**
 * Every locale carries a value. Applies to EVERY localized string,
 * including a brand name that is deliberately the same in all seven (house
 * style: `modes/kami/manifest.ts` ships "Kami" ×7) — what matters there is
 * that the launcher never falls back for a missing key.
 */
function expectLocalesPresent(label: string, value: LocalizedString | undefined): void {
  const map = asMap(value);
  for (const locale of LOCALES) {
    const text = map[locale];
    expect(text, `${label}: ${locale} missing`).toBeTruthy();
    expect(text!.trim().length, `${label}: ${locale} empty`).toBeGreaterThan(0);
  }
  // Cheap and always valid: a zh-TW string carrying Simplified-only forms
  // was pasted from zh-CN. A romanized brand has no CJK at all and passes.
  for (const ch of SIMPLIFIED_ONLY) {
    expect(
      map["zh-TW"]!.includes(ch),
      `${label}: zh-TW carries the Simplified form "${ch}"`,
    ).toBe(false);
  }
}

/**
 * The stricter bar for PROSE — anything the user reads as a sentence or a
 * subject line, as opposed to a proper noun. Prose that was never
 * translated is the failure this catches, in both of its shapes: English
 * left sitting in a CJK slot (pure ASCII), and English left sitting in a
 * Latin slot (byte-identical to `en`).
 */
function expectLocalizedProse(label: string, value: LocalizedString | undefined): void {
  expectLocalesPresent(label, value);
  const map = asMap(value);
  for (const locale of CJK_LOCALES) {
    expect(
      /[^\x00-\x7F]/.test(map[locale]!),
      `${label}: ${locale} is pure ASCII — English left in a CJK locale`,
    ).toBe(true);
  }
  for (const locale of ["es", "de"] as const) {
    expect(map[locale], `${label}: ${locale} is the English string verbatim`).not.toBe(
      map.en,
    );
  }
}

describe("mode identity is localized for all seven launcher locales", () => {
  test("displayName reaches every locale", () => {
    expectLocalesPresent("displayName", banshoManifest.displayName);
  });

  test("description is real prose in every locale", () => {
    expectLocalizedProse("description", banshoManifest.description);
  });
});

describe("init.seeds — the explicit gallery catalogue", () => {
  const seeds = () => banshoManifest.init?.seeds ?? [];

  test("declared explicitly, one card per seed, in gallery order", () => {
    // `.claude/rules/modes.md`: without `init.seeds[]` the gallery
    // auto-derives, which works for directory-shaped seeds but loses every
    // piece of authored copy. T8 declares the catalogue for real.
    expect(seeds().map((s) => s.id)).toEqual([...CATALOGUE_ORDER]);
  });

  test("every card survives resolveSeedCatalog — no silently dropped sourceKey", () => {
    // The runtime drops a descriptor whose sourceKey is absent from
    // seedFiles, and says nothing. A one-character typo in a path would
    // therefore remove a card from the gallery with everything still
    // "declared". This runs the real resolver the server route runs.
    const resolved = resolveSeedCatalog(banshoManifest.init?.seedFiles, seeds());
    expect(resolved.map((s) => s.id)).toEqual([...CATALOGUE_ORDER]);
  });

  test("each card points at its own seed directory", () => {
    for (const seed of seeds()) {
      expect(seed.sourceKey).toBe(`modes/bansho/seed/${seed.id}/`);
    }
  });

  test("each card ships a thumbnail that exists on disk", () => {
    for (const seed of seeds()) {
      expect(seed.thumbnail, `${seed.id}: no thumbnail`).toBeTruthy();
      expect(
        existsSync(join(GALLERY_DIR, seed.thumbnail!)),
        `${seed.id}: seed-gallery/${seed.thumbnail} missing`,
      ).toBe(true);
    }
  });

  test("card titles are localized and short enough to scan", () => {
    for (const seed of seeds()) {
      // A card title names a subject and a language, so it is prose, not a
      // brand: "Concept explainer · Chinese" has to be said in Korean too.
      expectLocalizedProse(`seed ${seed.id} displayName`, seed.displayName);
      // A card title is read at a glance, next to a thumbnail.
      expect(asMap(seed.displayName).en.length).toBeLessThanOrEqual(40);
    }
  });

  test("card blurbs say what the board is about, in both shipped languages", () => {
    for (const seed of seeds()) {
      const map = asMap(seed.description);
      for (const locale of ["en", "zh-CN"] as const) {
        const text = map[locale];
        expect(text, `${seed.id}: ${locale} blurb missing`).toBeTruthy();
        // Long enough to name the subject, short enough to read in three
        // seconds — a card that only repeats its own title is not a blurb.
        expect(text!.length, `${seed.id}: ${locale} blurb too thin`).toBeGreaterThan(20);
        expect(text!.length, `${seed.id}: ${locale} blurb too long`).toBeLessThanOrEqual(160);
        expect(text!).not.toBe(asMap(seed.displayName)[locale]);
      }
      expect(
        /[^\x00-\x7F]/.test(map["zh-CN"]!),
        `${seed.id}: zh-CN blurb is pure ASCII — English left untranslated`,
      ).toBe(true);
    }
  });

  test("each card carries chips naming its language", () => {
    for (const seed of seeds()) {
      const tags = seed.tags ?? [];
      expect(tags.length, `${seed.id}: no tags`).toBeGreaterThan(0);
      expect(tags).toContain(seed.id.endsWith("-en") ? "English" : "中文");
    }
  });
});

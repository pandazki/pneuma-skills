/**
 * T2 — semantic inference (I1–I9) + duration model (I8/G10).
 *
 * These tests pin the PURE compile layer: `engine/duration.ts` (constants +
 * word-duration model) and `engine/inference.ts` (unit decomposition and gap
 * semantics). No DOM anywhere — lectures come from the real parser
 * (`domain.ts::parseLecture`), plans are plain data.
 *
 * Spec anchors, cited per test:
 *  - I9 (设计稿 §5.1): CJK splits into 1–2 char segments, Latin by word —
 *    "这条比常数本身更重要" (G10).
 *  - I2 (§4.3 "荧光笔扫过(写完本句后)"): the ==, ** and (( )) ink lands AFTER the
 *    sentence finishes — a deliberate divergence from the prototype, which
 *    fired marks immediately (pre-rev4).
 *  - I3: ~~x~~ strikes right after its own text — write, beat, strike.
 *  - I4/I5 (§4.4 rev 4 全串行): chart skeleton and layers are fully serial;
 *    the prototype's staggered tick fades are superseded.
 *  - G6: every unit carries a precise srcSpan; text units are byte-for-byte
 *    slices of the source.
 */

import { describe, expect, test } from "bun:test";

import { parseLecture } from "../domain.js";
import {
  CHART_GLUE,
  DEFAULT_DURATIONS,
  HEADING_GAP_MULT,
  asideBarDuration,
  mathDuration,
  segmentGapAfter,
  wordDuration,
} from "../engine/duration.js";
import {
  flattenSteps,
  planLecture,
  planStepUnits,
  splitRevealSegments,
  type StepPlan,
  type UnitPlan,
} from "../engine/inference.js";
import type { Step } from "../engine/types.js";

const D = DEFAULT_DURATIONS;

/** Plan a one-source lecture and return its step plans (bad steps skipped). */
function plansOf(src: string): StepPlan[] {
  return planLecture(parseLecture(src), D);
}

/** The single step plan of a one-step source. */
function planOf(src: string): StepPlan {
  const plans = plansOf(src);
  expect(plans).toHaveLength(1);
  return plans[0]!;
}

// ────────────────────────────────────────────────────────────────────────────
// duration.ts — the I8 model (G10 constants)
// ────────────────────────────────────────────────────────────────────────────

describe("duration model (I8/G10)", () => {
  test("G10 — constants match the prototype-measured table", () => {
    expect(D).toEqual({
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
      // S1 — the @turn walk: paraGap × HEADING_GAP_MULT, the `---` tier's
      // longest breath (board-snapshot design §7.6-Q2).
      turn: 0.84,
    place: 0.84,
    });
  });

  test("wordDuration — CJK chars carry the cjkBoost, Latin chars do not", () => {
    expect(wordDuration("需求", D)).toBeCloseTo(
      D.wordBase + 2 * D.cjkBoost * D.perChar,
      10,
    );
    expect(wordDuration("abc", D)).toBeCloseTo(D.wordBase + 3 * D.perChar, 10);
    // Mixed: 2 CJK + 3 Latin.
    expect(wordDuration("GPU集群", D)).toBeCloseTo(
      D.wordBase + (2 * D.cjkBoost + 3) * D.perChar,
      10,
    );
    expect(wordDuration("", D)).toBe(0);
    expect(wordDuration("   ", D)).toBe(0);
  });

  test("segmentGapAfter — word gap always; comma/period stack on top (I1)", () => {
    expect(segmentGapAfter("词", D)).toBeCloseTo(D.gap, 10);
    expect(segmentGapAfter("词，", D)).toBeCloseTo(D.gap + D.comma, 10);
    expect(segmentGapAfter("词。", D)).toBeCloseTo(D.gap + D.period, 10);
    expect(segmentGapAfter("word;", D)).toBeCloseTo(D.gap + D.comma, 10);
    expect(segmentGapAfter("done!", D)).toBeCloseTo(D.gap + D.period, 10);
  });

  test("mathDuration — whitespace-insensitive content volume", () => {
    expect(mathDuration("E = mc^2", D)).toBeCloseTo(
      wordDuration("E=mc^2", D),
      10,
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
// I9 — reveal-unit segmentation (the rule that matters more than constants)
// ────────────────────────────────────────────────────────────────────────────

describe("I9 segmentation", () => {
  test("CJK splits into 1–2 char segments", () => {
    const segs = splitRevealSegments("需求的形状变了", 0);
    expect(segs.map((s) => s.text)).toEqual(["需求", "的形", "状变", "了"]);
    expect(segs.map((s) => [s.start, s.end])).toEqual([
      [0, 2],
      [2, 4],
      [4, 6],
      [6, 7],
    ]);
  });

  test("Latin splits by whitespace word", () => {
    const segs = splitRevealSegments("the quick  brown fox", 10);
    expect(segs.map((s) => s.text)).toEqual(["the", "quick", "brown", "fox"]);
    // Offsets are absolute (base + in-text index), double space respected.
    expect(segs[2]!.start).toBe(10 + 11);
    expect(segs[2]!.end).toBe(10 + 16);
  });

  test("mixed CJK/Latin token slices by 2 (prototype-faithful)", () => {
    const segs = splitRevealSegments("GPU集群", 0);
    expect(segs.map((s) => s.text)).toEqual(["GP", "U集", "群"]);
  });

  test("pause punctuation ends its segment — never glued onto the next chars", () => {
    // Blind 2-char slicing would give 再说/。然/后继/续 and lose the I1
    // period pause + the I2 sentence-flush boundary (see duration.ts
    // isPauseChar). The cut lands AFTER the punctuation — and the mark
    // then rides the word it terminates rather than standing alone (禁则,
    // below), so the boundary survives with one box fewer.
    const segs = splitRevealSegments("再说。然后继续", 0);
    expect(segs.map((s) => s.text)).toEqual(["再说。", "然后", "继续"]);
    expect(segs.map((s) => [s.start, s.end])).toEqual([
      [0, 3],
      [3, 5],
      [5, 7],
    ]);
    // Odd-position punctuation rides its preceding char.
    expect(splitRevealSegments("完。收尾", 0).map((s) => s.text)).toEqual([
      "完。",
      "收尾",
    ]);
    // Comma class chunks the same way.
    expect(splitRevealSegments("甲，乙丙", 0).map((s) => s.text)).toEqual([
      "甲，",
      "乙丙",
    ]);
  });

  test("禁则 — a mark never stands alone as a reveal unit", () => {
    // THE DEFECT (measured on the wall, 2026-08-12): every segment is its
    // own inline-block, Blink feeds each atomic inline to UAX14 as U+FFFC
    // and breaks freely around it, so a lone 。 landed at the head of a
    // line — a thing no person writing on a board would ever produce.
    // Fixed where the units are decided: the mark belongs to the word it
    // terminates, at EVERY parity of the chunk it ends.
    const d = DEFAULT_DURATIONS;
    expect(splitRevealSegments("阳性。你有病", 0).map((s) => s.text)).toEqual([
      "阳性。",
      "你有",
      "病",
    ]);
    // ... and the sentence beat + the I2 flush boundary ride the merged
    // segment, because it still ENDS with the mark.
    expect(segmentGapAfter("阳性。", d)).toBe(d.gap + d.period);
    // The mirror: an opening mark belongs to the word it opens.
    expect(splitRevealSegments("看（例如）", 0).map((s) => s.text)).toEqual([
      "看（",
      "例如）",
    ]);
    // An even chunk already leaves no mark stranded — nothing to merge,
    // and the merge does not go looking for work (2-glyph slicing stands).
    expect(splitRevealSegments("结果（a）好", 0).map((s) => s.text)).toEqual([
      "结果",
      "（a",
      "）好",
    ]);
    // Spans stay exact source slices (G6) across every merge.
    const src = "阳性。你有病";
    for (const s of splitRevealSegments(src, 0)) {
      expect(src.slice(s.start, s.end)).toBe(s.text);
    }
    // A mark NEVER jumps whitespace to reach a word: two tokens are two
    // reveal units and the DOM writes a space between them.
    expect(splitRevealSegments("完 。", 0).map((s) => s.text)).toEqual([
      "完",
      "。",
    ]);
    // A whole token of punctuation has no neighbour to join — it stays a
    // unit of its own (`**…**。` is exactly this) and is welded to the
    // previous box in the DOM instead (factories/prose.ts, NOBR_CLASS).
    expect(splitRevealSegments("。", 0).map((s) => s.text)).toEqual(["。"]);
    // Latin tokens are never sliced, so a marked-up word is untouched.
    expect(splitRevealSegments("(bar), baz.", 0).map((s) => s.text)).toEqual([
      "(bar),",
      "baz.",
    ]);
  });

  test("empty and whitespace-only input yields no segments", () => {
    expect(splitRevealSegments("", 0)).toEqual([]);
    expect(splitRevealSegments("   \t ", 0)).toEqual([]);
  });

  test("astral chars are never split into lone surrogates (code points, not UTF-16 units)", () => {
    // UTF-16 slicing cut 看🎉了 into 看\ud83c / \udf89了 — two lone
    // surrogates rendering as U+FFFD. Segments must break on code points
    // while srcSpan offsets stay UTF-16 (the source-slice vocabulary).
    const segs = splitRevealSegments("看🎉了", 0);
    expect(segs.map((s) => s.text)).toEqual(["看🎉", "了"]);
    expect(segs.map((s) => [s.start, s.end])).toEqual([
      [0, 3],
      [3, 4],
    ]);
    for (const s of segs) {
      expect("看🎉了".slice(s.start, s.end)).toBe(s.text);
      // No lone surrogate anywhere in the visible pen output.
      expect(s.text).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
    }
  });

  test("a label colon ends its segment for EVERY label parity (§4.3 align)", () => {
    // Blind 2-char slicing glues the fullwidth colon onto the value's
    // first char whenever the label has an even char count (性质:结 vs
    // 权:) — the align marker's offset then lands mid-segment and the
    // column silently never forms for exactly half the labels. The colon
    // is a cut char (like pause punctuation) but carries NO pause.
    // The colon ENDS its segment at either parity — 禁则 then folds the
    // odd-parity leftover back onto the label, which keeps the marker's
    // boundary exactly where it was (right after the colon) with one box
    // fewer, and stops a line ever beginning with a bare colon.
    expect(
      splitRevealSegments("需求性质:结构性转移", 0).map((s) => s.text),
    ).toEqual(["需求", "性质:", "结构", "性转", "移"]);
    expect(splitRevealSegments("定价权:在卖方", 0).map((s) => s.text)).toEqual(
      ["定价", "权:", "在卖", "方"],
    );
    expect(splitRevealSegments("供给弹性:低", 0).map((s) => s.text)).toEqual([
      "供给",
      "弹性:",
      "低",
    ]);
    // Both parities now end a segment AT the colon — that offset is what
    // the align marker lands on (§4.3), so the column forms either way.
    for (const label of ["需求性质:结构性转移", "定价权:在卖方"]) {
      const ends = splitRevealSegments(label, 0).map((s) => s.end);
      expect(ends).toContain(label.indexOf(":") + 1);
    }
    // ASCII colon in a CJK-bearing token cuts the same way.
    expect(splitRevealSegments("R:自反性", 0).map((s) => s.text)).toEqual([
      "R:",
      "自反",
      "性",
    ]);
    // A colon-ending segment adds no comma/period pause (cut ≠ pause).
    const d = DEFAULT_DURATIONS;
    expect(segmentGapAfter("性质:", d)).toBe(d.gap);
    expect(segmentGapAfter("：", d)).toBe(d.gap);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Text-bearing steps — I2 deferral, I3 immediacy, G6 spans
// ────────────────────────────────────────────────────────────────────────────

describe("prose planning (I2/I3)", () => {
  test("plain prose becomes text units with word gaps; srcSpans are exact slices (G6)", () => {
    const src = "the quick fox";
    const lecture = parseLecture(src);
    const plan = planLecture(lecture, D)[0]!;
    expect(plan.units.map((u) => u.kind)).toEqual(["text", "text", "text"]);
    for (const u of plan.units) {
      expect(lecture.source.slice(u.srcSpan.start, u.srcSpan.end)).toBe(u.text!);
      expect(u.duration).toBeCloseTo(wordDuration(u.text!, D), 10);
      expect(u.gapAfter).toBeCloseTo(D.gap, 10);
    }
    // First step of the document has no lead-in (I1: playback starts at 0).
    expect(plan.leadIn).toBe(0);
  });

  test("I2 — ==highlight== ink defers to the end of its sentence", () => {
    const plan = planOf("先看 ==关键数字== 再说。然后继续");
    const kinds = plan.units.map((u) => u.kind);
    const texts = plan.units.map((u) => u.text ?? "");
    // Written text streams in document order…
    expect(texts.filter(Boolean)).toEqual([
      "先看",
      "关键",
      "数字",
      "再说。",
      "然后",
      "继续",
    ]);
    // …but the ink lands after the sentence-ending segment ("再说。" — the
    // full stop rides the word it terminates, 禁则), before the next
    // sentence's text (§4.3: 荧光笔扫过(写完本句后)).
    const inkIdx = kinds.indexOf("ink");
    expect(inkIdx).toBeGreaterThan(texts.indexOf("再说。"));
    expect(inkIdx).toBeLessThan(texts.indexOf("然后"));
    const ink = plan.units[inkIdx]!;
    expect(ink.action).toBe("highlight");
    expect(ink.duration).toBeCloseTo(D.annotate, 10);
    expect(ink.gapBefore).toBeCloseTo(D.annotDelay, 10);
    expect(ink.gapAfter).toBeCloseTo(D.afterAnnot, 10);
  });

  test("I2 — a sentence ender INSIDE the mark still flushes at that sentence's end", () => {
    // ==这一点最关键。== — the mark's own text ends the sentence. The ender
    // is walked at nesting depth (never flushes mid-mark, correct), but the
    // action is queued AFTER that walk, so flushing right then is safe and
    // required: without it the highlight deferred a WHOLE sentence, landing
    // at paragraph end instead of after its own sentence (I2 violation).
    const plan = planOf("==这一点最关键。== 接着讲下一段内容。");
    const kinds = plan.units.map((u) => u.kind);
    const texts = plan.units.map((u) => u.text ?? "");
    const inkIdx = kinds.indexOf("ink");
    expect(inkIdx).toBeGreaterThan(-1);
    // The ink lands right after its own sentence's text…
    expect(inkIdx).toBeGreaterThan(texts.indexOf("关键"));
    // …and BEFORE the next sentence starts.
    expect(inkIdx).toBeLessThan(texts.indexOf("接着"));
  });

  test("I2 — multiple marks in one sentence flush in document order", () => {
    const plan = planOf("==甲== 与 **乙** 完。尾声");
    const inks = plan.units.filter((u) => u.kind === "ink");
    expect(inks.map((u) => u.action)).toEqual(["highlight", "underline"]);
    // Both queued inks land between the sentence ender and the next text.
    const kinds = plan.units.map((u) => u.kind);
    const lastTextBeforeInk = plan.units
      .slice(0, kinds.indexOf("ink"))
      .filter((u) => u.kind === "text")
      .map((u) => u.text);
    expect(lastTextBeforeInk).toContain("完。");
    expect(lastTextBeforeInk).not.toContain("尾声");
  });

  test("I2 — marks with no sentence ender flush at paragraph end", () => {
    const plan = planOf("只有 ==重点== 没有句号");
    expect(plan.units[plan.units.length - 1]!.kind).toBe("ink");
  });

  test("I3 — ~~strike~~ fires immediately after its own text", () => {
    const plan = planOf("价格是 ~~十元~~ 五元");
    const kinds = plan.units.map((u) => u.kind);
    const texts = plan.units.map((u) => u.text ?? "");
    const strikeIdx = kinds.indexOf("ink");
    expect(plan.units[strikeIdx]!.action).toBe("strike");
    // Strike sits after 十元 and BEFORE 五元 — the "等等,不对" beat.
    expect(strikeIdx).toBeGreaterThan(texts.indexOf("十元"));
    expect(strikeIdx).toBeLessThan(texts.indexOf("五元"));
  });

  test("inline $math$ becomes one math unit spanning the full construct", () => {
    const src = "复杂度是 $2^n$ 才对";
    const lecture = parseLecture(src);
    const plan = planLecture(lecture, D)[0]!;
    const math = plan.units.find((u) => u.kind === "math")!;
    expect(math).toBeDefined();
    expect(lecture.source.slice(math.srcSpan.start, math.srcSpan.end)).toBe(
      "$2^n$",
    );
    expect(math.duration).toBeCloseTo(mathDuration("2^n", D), 10);
  });

  test("em/term inner text segments with exact spans (G6)", () => {
    const src = "看 *轻重* 与 `术语` 收尾";
    const lecture = parseLecture(src);
    const plan = planLecture(lecture, D)[0]!;
    const texts = plan.units.filter((u) => u.kind === "text");
    for (const u of texts) {
      expect(lecture.source.slice(u.srcSpan.start, u.srcSpan.end)).toBe(u.text!);
    }
    expect(texts.map((u) => u.text)).toContain("轻重");
    expect(texts.map((u) => u.text)).toContain("术语");
  });

  test("nested ink children write text once and queue both actions", () => {
    const plan = planOf("这是 ==重要的 **结构性** 变化== 收尾。");
    const texts = plan.units.filter((u) => u.kind === "text").map((u) => u.text);
    // Inner text appears exactly once — no delimiter leakage, no doubling.
    expect(texts).toEqual([
      "这是",
      "重要",
      "的",
      "结构",
      "性",
      "变化",
      "收尾。",
    ]);
    const inks = plan.units.filter((u) => u.kind === "ink");
    expect(inks.map((u) => u.action).sort()).toEqual(["highlight", "underline"]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Step-level shapes — heading, list, rule, backref, wait, image, math block
// ────────────────────────────────────────────────────────────────────────────

describe("step shapes", () => {
  test("heading writes text then draws its hand-drawn baseline (§4.3 手绘底线)", () => {
    const plans = plansOf("# 大标题");
    const plan = plans[0]!;
    const kinds = plan.units.map((u) => u.kind);
    expect(kinds[kinds.length - 1]).toBe("rule");
    expect(plan.units[plan.units.length - 1]!.duration).toBeCloseTo(D.axis, 10);
  });

  test("I1 — the step after a heading (and after ---) waits paraGap × 2", () => {
    const plans = plansOf("# 标题\n\n正文一\n\n---\n\n正文二\n\n正文三");
    const byKind = plans.map((p) => [p.step.kind, p.leadIn] as const);
    expect(byKind[0]![1]).toBe(0); // heading opens the board
    expect(byKind[1]![1]).toBeCloseTo(D.paraGap * HEADING_GAP_MULT, 10); // after heading
    expect(byKind[2]![1]).toBeCloseTo(D.paraGap, 10); // rule after prose
    expect(byKind[3]![1]).toBeCloseTo(D.paraGap * HEADING_GAP_MULT, 10); // after ---
    expect(byKind[4]![1]).toBeCloseTo(D.paraGap, 10); // prose after prose
  });

  test("list item leads with a hand-drawn bullet dot (§4.3 手绘弹点)", () => {
    const src = "- 第一条";
    const lecture = parseLecture(src);
    const plan = planLecture(lecture, D)[0]!;
    expect(plan.units[0]!.kind).toBe("bullet");
    // The bullet's srcSpan is the dash itself (G6 precision).
    expect(
      lecture.source.slice(plan.units[0]!.srcSpan.start, plan.units[0]!.srcSpan.end),
    ).toBe("-");
  });

  test("aside leads with its hand-drawn margin bar (§4.3 旁注)", () => {
    const src = "> 旁注一句。\n> 还有第二句。";
    const lecture = parseLecture(src);
    const plan = planLecture(lecture, D)[0]!;
    expect(plan.step.kind).toBe("aside");
    // The bar goes down FIRST — it is the block's register marker, like the
    // list item's dot, not a decoration applied afterwards like the
    // heading's baseline.
    expect(plan.units[0]!.kind).toBe("rule");
    expect(plan.units.slice(1).every((u) => u.kind === "text")).toBe(true);
    // Its srcSpan is the `>` marker itself (G6 precision, mirroring the
    // bullet's dash) — merged quote lines share one step, so the marker of
    // the FIRST line is the one the bar performs.
    expect(
      lecture.source.slice(plan.units[0]!.srcSpan.start, plan.units[0]!.srcSpan.end),
    ).toBe(">");
    expect(plan.units[0]!.duration).toBeCloseTo(asideBarDuration(D), 10);
    expect(plan.units[0]!.gapBefore).toBe(0);
    expect(plan.units[0]!.gapAfter).toBeCloseTo(D.gap, 10);
  });

  test("backref becomes a single ink unit (I6)", () => {
    const plans = plansOf('结论成立\n\n@circle "结论"');
    expect(plans).toHaveLength(2);
    const back = plans[1]!;
    expect(back.step.kind).toBe("backref");
    expect(back.units).toHaveLength(1);
    expect(back.units[0]!.kind).toBe("ink");
    expect(back.units[0]!.action).toBe("circle");
    expect(back.units[0]!.duration).toBeCloseTo(D.annotate, 10);
  });

  test("@wait plans zero units and carries its beat as leadIn (I7)", () => {
    const plans = plansOf("甲\n\n@wait 2\n\n乙");
    expect(plans).toHaveLength(3);
    const wait = plans[1]!;
    expect(wait.units).toHaveLength(0);
    expect(wait.leadIn).toBe(2);
    // A wait is transparent for the neighbour gap chain: 乙 still gets its
    // ordinary paraGap base (the wait is an EXTRA beat, I7).
    expect(plans[2]!.leadIn).toBeCloseTo(D.paraGap, 10);
    // Bare @wait defaults to one paragraph beat.
    expect(plansOf("甲\n\n@wait\n\n乙")[1]!.leadIn).toBeCloseTo(D.paraGap, 10);
  });

  test("bad steps are skipped entirely and stay transparent for gaps", () => {
    const plans = plansOf("甲\n\n@with x\n\n乙");
    expect(plans.map((p) => p.step.kind)).toEqual(["prose", "prose"]);
    expect(plans[1]!.leadIn).toBeCloseTo(D.paraGap, 10);
  });

  test("camera steps plan exactly ONE exclusive unit with a positive fallback duration (C2/G1)", () => {
    const src = '锚点在这里\n\n@focus "锚点"\n\n@overview\n\n收尾。';
    const plans = plansOf(src);
    expect(plans.map((p) => p.step.kind)).toEqual([
      "prose",
      "camera",
      "camera",
      "prose",
    ]);
    for (const plan of [plans[1]!, plans[2]!]) {
      expect(plan.units).toHaveLength(1);
      const unit = plan.units[0]!;
      expect(unit.kind).toBe("camera");
      // The plan value is the pre-measurement placeholder; the Van Wijk
      // measurement replaces it through the G3 override, whose
      // `naturalTotal > 0` guard makes a positive placeholder LOAD-BEARING
      // (zero here would pin every camera step at zero seconds).
      expect(unit.duration).toBeGreaterThan(0);
      // An ordinary performed step: standard paragraph lead, no glue.
      expect(plan.leadIn).toBeCloseTo(D.paraGap, 10);
    }
    // G6 — each camera unit's srcSpan is the directive's own line.
    const src1 = plans[1]!.units[0]!.srcSpan;
    expect(src.slice(src1.start, src1.end)).toBe('@focus "锚点"');
    const src2 = plans[2]!.units[0]!.srcSpan;
    expect(src.slice(src2.start, src2.end)).toBe("@overview");
  });

  test("rule / block-math each yield one unit with a precise span", () => {
    const src = "---\n\n$$E=mc^2$$";
    const lecture = parseLecture(src);
    const plans = planLecture(lecture, D);
    expect(plans.map((p) => p.units.map((u) => u.kind))).toEqual([
      ["rule"],
      ["math"],
    ]);
    for (const p of plans) {
      const u = p.units[0]!;
      expect(u.srcSpan.end).toBeGreaterThan(u.srcSpan.start);
      expect(u.srcSpan.end).toBeLessThanOrEqual(lecture.source.length);
    }
  });

  test("image / html steps plan NO beat and surface a loud unsupportedStep warning", () => {
    // v1 has no factory for either kind (factoryFor returns undefined), so
    // a planned 0.40s beat was pure dead board time — no node, no
    // degradation signal, no owner. The plan is now empty and gap-
    // transparent (like bad steps), and the parse declares the silence.
    const src = "早上好。\n\n![说明](a.png)\n\n```html\n<b>x</b>\n```\n\n晚上好。";
    const lecture = parseLecture(src);
    expect(lecture.errors.map((e) => e.code)).toEqual([
      "unsupportedStep",
      "unsupportedStep",
    ]);
    const plans = planLecture(lecture, D);
    expect(plans.map((p) => p.step.kind)).toEqual(["prose", "prose"]);
    // Gap-transparent: the second prose step still leads in with ONE
    // paraGap, exactly as if the unperformable blocks were not there.
    expect(plans[1]!.leadIn).toBeCloseTo(D.paraGap, 10);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Charts — I4 (frame serial skeleton) / I5 (layers, series then label)
// ────────────────────────────────────────────────────────────────────────────

const CHART_SRC = [
  "```chart 增长",
  "x: 2023Q1 .. 2024Q4",
  "y: 0 10 20 40 (%)",
  "+ NVIDIA: 7 14 28 40",
  '+ mark NVIDIA @ 2024Q4 : "翻倍"',
  "```",
].join("\n");

describe("chart planning (I4/I5)", () => {
  test("frame skeleton is fully serial: axes → ticks → labels → rows", () => {
    const plan = planOf(CHART_SRC);
    expect(plan.step.kind).toBe("chart-frame");
    expect(plan.units.map((u) => u.kind)).toEqual([
      "axis", // x line (§4.4: 画轴 x→y)
      "axis", // y line
      "tick", // y: 0
      "tick", // y: 10
      "tick", // y: 20
      "tick", // y: 40
      "axis-label", // x: 2023Q1
      "axis-label", // x: 2024Q4
      "series", // + NVIDIA line
      "series-label", // its name, after the line (I5)
      "chart-mark",
    ]);
    const durs = plan.units.map((u) => u.duration);
    expect(durs[0]).toBeCloseTo(D.axis, 10);
    expect(durs[2]).toBeCloseTo(D.tick, 10);
    expect(durs[6]).toBeCloseTo(D.label, 10);
    expect(durs[8]).toBeCloseTo(D.series, 10);
    expect(durs[9]).toBeCloseTo(D.label, 10);
    // I4: the frame is introduced by chartLead.
    expect(plan.leadIn).toBeCloseTo(D.chartLead, 10);
  });

  test("G6 — every chart unit points at ITS source row, never the block", () => {
    const lecture = parseLecture(CHART_SRC);
    const plan = planLecture(lecture, D)[0]!;
    const rowText = (u: UnitPlan): string =>
      lecture.source.slice(u.srcSpan.start, u.srcSpan.end);
    expect(rowText(plan.units[0]!)).toBe("x: 2023Q1 .. 2024Q4");
    expect(rowText(plan.units[1]!)).toBe("y: 0 10 20 40 (%)");
    for (let i = 2; i <= 5; i++) {
      expect(rowText(plan.units[i]!)).toBe("y: 0 10 20 40 (%)");
    }
    expect(rowText(plan.units[6]!)).toBe("x: 2023Q1 .. 2024Q4");
    expect(rowText(plan.units[8]!)).toBe("+ NVIDIA: 7 14 28 40");
    expect(rowText(plan.units[9]!)).toBe("+ NVIDIA: 7 14 28 40");
    expect(rowText(plan.units[10]!)).toBe('+ mark NVIDIA @ 2024Q4 : "翻倍"');
  });

  test("non-numeric y entries plan NO tick unit — no beat spent on an invisible tick", () => {
    // A categorical y axis (`y: 低 .. 高`) cannot be placed by the numeric
    // Y scale: the prototype skipped isNaN entries and drew fewer ticks.
    // Planning a unit for one would spend d.tick seconds fading in an
    // empty <g> — a dead beat the user reads as a hang.
    const categorical = planOf(
      '```chart c\nx: A .. B\ny: 低 .. 高\n+ s: 1 2\n```',
    );
    expect(categorical.units.map((u) => u.kind)).toEqual([
      "axis", // x line
      "axis", // y line — the line itself still draws
      "axis-label", // x: A
      "axis-label", // x: B
      "series",
      "series-label",
    ]);

    // Mixed entries: only the numeric ones earn a tick beat.
    const mixed = planOf('```chart d\ny: 0 中位 40\n+ s: 1 2\n```');
    const ticks = mixed.units.filter((u) => u.kind === "tick");
    expect(ticks.map((u) => u.text)).toEqual(["0", "40"]);
  });

  test("G6 — a frame plans axis units for DECLARED axes only, never a phantom whole-block stroke", () => {
    // `type:` alone marks a frame (domain.ts), so an axis-less frame
    // parses clean — it must plan ZERO axis units, not two units falling
    // back to the whole block's span (整块共享一个区间已被原型证伪).
    const bare = planOf("```chart a\ntype: line\n+ s: 1 2 3\n```");
    expect(bare.step.kind).toBe("chart-frame");
    expect(bare.units.map((u) => u.kind)).toEqual(["series", "series-label"]);
    for (const u of bare.units) {
      expect(u.srcSpan).not.toEqual(bare.step.srcSpan);
    }

    // One declared axis → exactly one axis unit, carrying ITS row span.
    const src = "```chart b\nx: A .. B\n+ s: 1 2\n```";
    const lecture = parseLecture(src);
    const half = planLecture(lecture, D)[0]!;
    const axes = half.units.filter((u) => u.kind === "axis");
    expect(axes).toHaveLength(1);
    expect(
      lecture.source.slice(axes[0]!.srcSpan.start, axes[0]!.srcSpan.end),
    ).toBe("x: A .. B");
    for (const u of half.units) {
      expect(u.srcSpan).not.toEqual(half.step.srcSpan);
    }
  });

  test("I5 — a later same-name block plans as a layer with the softer lead", () => {
    const src = `${CHART_SRC}\n\n讲一段\n\n\`\`\`chart 增长\n+ AMD: 3 6 9 12\n\`\`\``;
    const plans = plansOf(src);
    const layer = plans[2]!;
    expect(layer.step.kind).toBe("chart-layer");
    expect(layer.units.map((u) => u.kind)).toEqual(["series", "series-label"]);
    expect(layer.leadIn).toBeCloseTo(
      D.paraGap + D.chartLead * CHART_GLUE.layerLeadFactor,
      10,
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Lecture-level invariants
// ────────────────────────────────────────────────────────────────────────────

const RICH_SRC = `# 为什么这轮 AI 周期不同

## 需求的形状变了

需求从 ==每季一次的大版本== 变成了 **持续不断的微调**,单价 $100 时,复杂度 $2^n$ 才是瓶颈。

- R:自反性 — 成立
- S:对称性 — 不成立

> 旁注:这里 ~~写错了~~ 改对了

${CHART_SRC}

@highlight "需求的形状"

---

$$E = mc^2$$

@wait 1.5
`;

describe("lecture-level invariants", () => {
  test("flattenSteps addresses headings as step -1 in document order", () => {
    const lecture = parseLecture(RICH_SRC);
    const flat = flattenSteps(lecture);
    expect(flat[0]!.ref).toEqual({ section: 0, step: -1 }); // opening H1
    expect(flat[1]!.ref).toEqual({ section: 1, step: -1 }); // the H2
    expect(flat[1]!.step.kind).toBe("heading");
    // Refs resolve back to the same step objects.
    for (const { ref, step } of flat) {
      const section = lecture.sections[ref.section]!;
      expect(ref.step === -1 ? section.heading : section.steps[ref.step]).toBe(
        step,
      );
    }
  });

  test("G6 — 100% srcSpan coverage: every unit names a real source range", () => {
    const lecture = parseLecture(RICH_SRC);
    expect(lecture.errors).toHaveLength(0);
    const plans = planLecture(lecture, D);
    expect(plans.length).toBeGreaterThan(8);
    for (const plan of plans) {
      for (const u of plan.units) {
        expect(u.srcSpan.start).toBeGreaterThanOrEqual(0);
        expect(u.srcSpan.end).toBeGreaterThan(u.srcSpan.start);
        expect(u.srcSpan.end).toBeLessThanOrEqual(lecture.source.length);
        if (u.kind === "text") {
          expect(
            lecture.source.slice(u.srcSpan.start, u.srcSpan.end),
          ).toBe(u.text!);
        }
        // G1/H: no negative time anywhere in the plan.
        expect(u.duration).toBeGreaterThanOrEqual(0);
        expect(u.gapBefore).toBeGreaterThanOrEqual(0);
        expect(u.gapAfter).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test("planStepUnits is total over every step kind (bad/wait → no units)", () => {
    const bad: Step = { kind: "bad", reason: "x", raw: "x", srcSpan: { start: 0, end: 1 } };
    const wait: Step = { kind: "wait", srcSpan: { start: 0, end: 5 } };
    expect(planStepUnits(bad, D)).toEqual([]);
    expect(planStepUnits(wait, D)).toEqual([]);
  });

  test("determinism — same lecture plans byte-identically", () => {
    const a = JSON.stringify(planLecture(parseLecture(RICH_SRC), D));
    const b = JSON.stringify(planLecture(parseLecture(RICH_SRC), D));
    expect(a).toBe(b);
  });
});

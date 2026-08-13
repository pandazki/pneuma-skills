/**
 * Bansho dialect parser + domain pair (T1 acceptance).
 *
 * Pins:
 *  - the full §4.2 demo board (structure, inline ink, chart accumulation)
 *  - the inline dialect (== / ** / (( )) / ~~ / * / ` / $…$)
 *  - the $-delimiter vs currency disambiguation ($100 is money, not math)
 *  - back references (@strike/@circle/@highlight/@underline: nearest-upward
 *    exact substring; unresolved → BadStep + refUnresolved, never a crash)
 *  - chart blocks: frame vs layer classification, per-ROW srcSpans (G6),
 *    block-level error isolation (R6)
 *  - G1: @with / @after parse to bad steps — no simultaneity syntax exists
 *  - alignment groups (§4.3 并列对齐 — zero new syntax)
 *  - 100% srcSpan coverage walker over every step / run / chart row, plus
 *    span ordering / non-overlap / run-in-step containment invariants
 *  - CRLF sources parse with exact spans (Windows-authored boards)
 *  - Lecture.source carries the exact parsed text (spans agree by construction)
 *  - step identity: stepContentHash is position-independent + content-sensitive
 *  - section formation: multi-H1 / late-H1 boards
 *  - loadBoard/saveBoard purity and the byContentSet + themeCss aggregate shape
 */

import { describe, expect, test } from "bun:test";

import {
  loadBoard,
  parseLecture,
  saveBoard,
  stepContentHash,
  stepPlainText,
  type Board,
} from "../domain.js";
import type {
  AsideStep,
  BackRefStep,
  CameraStep,
  ChartFrameStep,
  ChartLayerStep,
  ImageStep,
  InlineRun,
  Lecture,
  ListItemStep,
  MathStep,
  ProseStep,
  Section,
  SrcSpan,
  Step,
  WaitStep,
} from "../engine/types.js";

// ── helpers ─────────────────────────────────────────────────────────────────

/** Fenced blocks are written with ''' in literals and swapped to ``` here. */
const board = (s: string): string => s.replaceAll("'''", "```");

const allSteps = (lecture: Lecture): Step[] =>
  lecture.sections.flatMap((s: Section) =>
    s.heading ? [s.heading, ...s.steps] : [...s.steps],
  );

const kinds = (steps: Step[]): string[] => steps.map((s) => s.kind);

const inkRuns = (step: Step) =>
  "inline" in step
    ? step.inline.filter(
        (r): r is Extract<InlineRun, { kind: "ink" }> => r.kind === "ink",
      )
    : [];

const slice = (src: string, span: SrcSpan): string =>
  src.slice(span.start, span.end);

/**
 * G6 — every step, inline run, and chart row carries a valid, precise span.
 * Also pins the structural invariants the 讲稿行级高亮 consumer relies on:
 * spans and text agree via `lecture.source`; step spans are in document
 * order and pairwise non-overlapping; run/axis/row spans are contained in
 * their step's span; runs within a step are ordered and non-overlapping.
 */
function assertFullSpanCoverage(lecture: Lecture, src: string): void {
  // Spans and the text they index into must agree by construction (F6):
  // the lecture carries the exact source it was parsed from.
  expect(lecture.source).toBe(src);

  const checkSpan = (span: SrcSpan | undefined, what: string): SrcSpan => {
    if (!span) throw new Error(`missing srcSpan on ${what}`);
    expect(span.start).toBeGreaterThanOrEqual(0);
    expect(span.end).toBeGreaterThan(span.start);
    expect(span.end).toBeLessThanOrEqual(src.length);
    return span;
  };

  /** `inner` must sit fully inside `outer`. */
  const checkContained = (inner: SrcSpan, outer: SrcSpan, what: string): void => {
    if (inner.start < outer.start || inner.end > outer.end) {
      throw new Error(
        `${what} span [${inner.start},${inner.end}) escapes its step span ` +
          `[${outer.start},${outer.end})`,
      );
    }
  };

  /**
   * Recursive over ink `children`: every level is ordered, non-overlapping,
   * contained in its container span, and byte-for-byte against the source.
   */
  const checkRuns = (
    runs: InlineRun[],
    container: SrcSpan,
    where: string,
  ): void => {
    let prevRunEnd = container.start;
    for (const run of runs) {
      checkSpan(run.srcSpan, `${where} run ${run.kind}`);
      checkContained(run.srcSpan, container, `${where} run ${run.kind}`);
      // Runs are ordered and non-overlapping within their container.
      expect(run.srcSpan.start).toBeGreaterThanOrEqual(prevRunEnd);
      prevRunEnd = run.srcSpan.end;
      if (run.kind === "text") {
        expect(slice(src, run.srcSpan)).toBe(run.text);
      } else if (run.kind === "break") {
        expect(slice(src, run.srcSpan)).toMatch(/^\s+$/);
      } else if (run.kind === "math") {
        checkSpan(run.textSpan, "math textSpan");
        checkContained(run.textSpan, run.srcSpan, "math textSpan");
        expect(slice(src, run.textSpan)).toBe(run.tex);
      } else {
        checkSpan(run.textSpan, `${run.kind} textSpan`);
        checkContained(run.textSpan, run.srcSpan, `${run.kind} textSpan`);
        expect(slice(src, run.textSpan)).toBe(run.text);
        if (run.kind === "ink" && run.children) {
          checkRuns(run.children, run.textSpan, `${where} ink-children`);
        }
      }
    }
  };

  let prevStepEnd = 0;
  for (const step of allSteps(lecture)) {
    checkSpan(step.srcSpan, `step ${step.kind}`);
    // Steps appear in document order with pairwise non-overlapping spans.
    expect(step.srcSpan.start).toBeGreaterThanOrEqual(prevStepEnd);
    prevStepEnd = step.srcSpan.end;

    if ("inline" in step) {
      checkRuns(step.inline, step.srcSpan, step.kind);
    }

    if (step.kind === "chart-frame" || step.kind === "chart-layer") {
      if (step.kind === "chart-frame") {
        if (step.x) {
          const span = checkSpan(step.x.srcSpan, "x axis");
          checkContained(span, step.srcSpan, "x axis");
          const sliced = slice(src, span);
          expect(sliced.startsWith("x:")).toBe(true);
          expect(sliced).not.toContain("\n");
        }
        if (step.y) {
          const span = checkSpan(step.y.srcSpan, "y axis");
          checkContained(span, step.srcSpan, "y axis");
          const sliced = slice(src, span);
          expect(sliced.startsWith("y:")).toBe(true);
          expect(sliced).not.toContain("\n");
        }
      }
      let prevRowEnd = step.srcSpan.start;
      for (const row of step.rows) {
        const span = checkSpan(row.srcSpan, `row ${row.kind}`);
        checkContained(span, step.srcSpan, `row ${row.kind}`);
        // Rows are ordered and non-overlapping within the block.
        expect(span.start).toBeGreaterThanOrEqual(prevRowEnd);
        prevRowEnd = span.end;
        const sliced = slice(src, span);
        // Each row's span is exactly its own (trimmed) source line.
        expect(sliced).not.toContain("\n");
        expect(sliced).toBe(sliced.trim());
        expect(sliced.startsWith("+")).toBe(true);
      }
    }
  }
}

// ── §4.2 demo board ─────────────────────────────────────────────────────────

const DEMO = board(`# 为什么这轮 AI 周期不同

GPU 的故事要从 2023 年讲起。

## 需求的形状变了

英伟达的数据中心营收在 18 个月里翻了 ==三倍==。

~~这只是一次常规的周期性反弹~~ —— 这是**结构性**的需求转移。

我们把两家公司的数据中心营收放到同一张图上:

'''chart revenue
x: 2023Q1 .. 2024Q4  (季度)
y: 0 .. 40  (十亿美元)
'''

先看英伟达——每个季度都在加速:

'''chart revenue
+ NVIDIA: 7.2 10.3 14.5 18.4 22.6 26.0 30.8 35.6
'''

再看 AMD,同一时期的曲线要平得多:

'''chart revenue
+ AMD: 1.3 1.3 1.5 2.3 2.3 2.8 3.5 3.9
'''

差距不是常数——是一条越张越开的口子,终点停在 ((35.6B))。

'''chart revenue
+ mark NVIDIA @ 2024Q4 : "35.6B"
'''

---

> 供给侧的故事我们下一节再讲。
`);

describe("§4.2 demo board", () => {
  const lecture = parseLecture(DEMO);

  test("parses cleanly — no errors", () => {
    expect(lecture.errors).toEqual([]);
  });

  test("title from first H1; preamble is section 0", () => {
    expect(lecture.title).toBe("为什么这轮 AI 周期不同");
    expect(lecture.sections).toHaveLength(2);

    const s0 = lecture.sections[0]!;
    expect(s0.heading?.level).toBe(1);
    expect(kinds(s0.steps)).toEqual(["prose"]);
    expect(stepPlainText(s0.steps[0]!)).toBe("GPU 的故事要从 2023 年讲起。");
  });

  test("section 1 step sequence — narration and chart layers interleave", () => {
    const s1 = lecture.sections[1]!;
    expect(s1.heading?.level).toBe(2);
    expect(stepPlainText(s1.heading!)).toBe("需求的形状变了");
    expect(kinds(s1.steps)).toEqual([
      "prose",
      "prose",
      "prose",
      "chart-frame",
      "prose",
      "chart-layer",
      "prose",
      "chart-layer",
      "prose",
      "chart-layer",
      "rule",
      "aside",
    ]);
  });

  test("inline ink actions land on the right steps", () => {
    const s1 = lecture.sections[1]!.steps;

    const hl = inkRuns(s1[0]!);
    expect(hl.map((r) => [r.action, r.text])).toEqual([["highlight", "三倍"]]);
    expect(slice(DEMO, hl[0]!.srcSpan)).toBe("==三倍==");
    expect(slice(DEMO, hl[0]!.textSpan)).toBe("三倍");

    const correction = inkRuns(s1[1]!);
    expect(correction.map((r) => [r.action, r.text])).toEqual([
      ["strike", "这只是一次常规的周期性反弹"],
      ["underline", "结构性"],
    ]);

    const circle = inkRuns(s1[8]!);
    expect(circle.map((r) => [r.action, r.text])).toEqual([
      ["circle", "35.6B"],
    ]);
  });

  test("chart frame: named container, typed axes with units", () => {
    const frame = lecture.sections[1]!.steps[3] as ChartFrameStep;
    expect(frame.chart).toBe("revenue");
    expect(frame.chartType).toBe("line");
    expect(frame.x).toMatchObject({
      from: "2023Q1",
      to: "2024Q4",
      unit: "季度",
    });
    expect(frame.y).toMatchObject({ from: "0", to: "40", unit: "十亿美元" });
    expect(slice(DEMO, frame.x!.srcSpan)).toBe("x: 2023Q1 .. 2024Q4  (季度)");
    expect(frame.rows).toEqual([]);
  });

  test("same-name blocks accumulate as layers; per-row srcSpans are exact", () => {
    const steps = lecture.sections[1]!.steps;
    const nvidia = steps[5] as ChartLayerStep;
    const amd = steps[7] as ChartLayerStep;
    const mark = steps[9] as ChartLayerStep;

    expect(nvidia.chart).toBe("revenue");
    expect(nvidia.rows).toHaveLength(1);
    expect(nvidia.rows[0]).toMatchObject({
      kind: "series",
      name: "NVIDIA",
      values: [7.2, 10.3, 14.5, 18.4, 22.6, 26.0, 30.8, 35.6],
    });
    expect(slice(DEMO, nvidia.rows[0]!.srcSpan)).toBe(
      "+ NVIDIA: 7.2 10.3 14.5 18.4 22.6 26.0 30.8 35.6",
    );

    expect(amd.rows[0]).toMatchObject({ kind: "series", name: "AMD" });

    expect(mark.rows[0]).toMatchObject({
      kind: "mark",
      series: "NVIDIA",
      x: "2024Q4",
      text: "35.6B",
    });
    expect(slice(DEMO, mark.rows[0]!.srcSpan)).toBe(
      '+ mark NVIDIA @ 2024Q4 : "35.6B"',
    );
  });

  test("aside merges into one step", () => {
    const aside = lecture.sections[1]!.steps.at(-1) as AsideStep;
    expect(aside.kind).toBe("aside");
    expect(stepPlainText(aside)).toBe("供给侧的故事我们下一节再讲。");
  });

  test("G6 — 100% srcSpan coverage, chart rows included", () => {
    assertFullSpanCoverage(lecture, DEMO);
  });

  test("Lecture retains the exact source its spans index into", () => {
    // The viewer highlights against lecture.source — never against an
    // independently-timed file read (a mid-edit re-read is a torn read).
    expect(lecture.source).toBe(DEMO);
  });

  test("parse is pure and deterministic", () => {
    expect(parseLecture(DEMO)).toEqual(lecture);
  });
});

// ── inline dialect ──────────────────────────────────────────────────────────

describe("inline dialect", () => {
  const prose = (src: string): ProseStep => {
    const lecture = parseLecture(src);
    const step = allSteps(lecture)[0]!;
    expect(step.kind).toBe("prose");
    return step as ProseStep;
  };

  test("em (*x*) and term (`x`) are non-ink runs", () => {
    const step = prose("这是 *轻强调* 和 `术语` 的用法。");
    const em = step.inline.find((r) => r.kind === "em");
    const term = step.inline.find((r) => r.kind === "term");
    expect(em).toMatchObject({ text: "轻强调" });
    expect(term).toMatchObject({ text: "术语" });
    expect(inkRuns(step)).toEqual([]);
  });

  test("unclosed markers stay literal text", () => {
    const step = prose("这里有 ==没有闭合 的标记 和 **另一个。");
    expect(inkRuns(step)).toEqual([]);
    expect(stepPlainText(step)).toBe("这里有 ==没有闭合 的标记 和 **另一个。");
  });

  test("a known mark nested inside an ink run tokenizes into children", () => {
    // Contract (engine/types.ts InlineRun): nested marks inside an ink run
    // become child runs — delimiters never leak onto the board. `text` stays
    // the raw inner slice (byte-for-byte at textSpan), and each child carries
    // its own absolute spans into the same source.
    const src = "这是 ==重要的 **结构性** 变化== 的部分。";
    const step = prose(src);
    const runs = inkRuns(step);
    expect(runs.map((r) => [r.action, r.text])).toEqual([
      ["highlight", "重要的 **结构性** 变化"],
    ]);
    expect(src.slice(runs[0]!.textSpan.start, runs[0]!.textSpan.end)).toBe(
      runs[0]!.text,
    );

    const children = runs[0]!.children!;
    expect(children.map((c) => c.kind)).toEqual(["text", "ink", "text"]);
    const nested = children[1] as Extract<InlineRun, { kind: "ink" }>;
    expect(nested.action).toBe("underline");
    expect(nested.text).toBe("结构性");
    expect(slice(src, nested.srcSpan)).toBe("**结构性**");
    expect(slice(src, nested.textSpan)).toBe("结构性");

    // Plain text strips ALL delimiters — the §4.1 判据: remove the animation
    // and board.md still reads as publishable prose.
    expect(stepPlainText(step)).toBe("这是 重要的 结构性 变化 的部分。");
  });

  test("nesting recurses to depth 2 and back refs match the stripped text", () => {
    const src =
      "外层 ==一 **二 ~~三~~ 四** 五== 收尾。\n\n@circle \"一 二 三 四 五\"\n";
    const lecture = parseLecture(src);
    const steps = allSteps(lecture);
    expect(kinds(steps)).toEqual(["prose", "backref"]);
    expect(lecture.errors).toEqual([]);

    const hl = inkRuns(steps[0]!)[0]!;
    expect(hl.action).toBe("highlight");
    const mid = hl.children![1] as Extract<InlineRun, { kind: "ink" }>;
    expect(mid.action).toBe("underline");
    const deep = mid.children![1] as Extract<InlineRun, { kind: "ink" }>;
    expect(deep.action).toBe("strike");
    expect(deep.text).toBe("三");
    expect(slice(src, deep.srcSpan)).toBe("~~三~~");

    // The back reference resolves against the fully stripped plain text.
    expect(stepPlainText(steps[0]!)).toBe("外层 一 二 三 四 五 收尾。");
    assertFullSpanCoverage(lecture, src);
  });

  test("G6 walker breadth: block math + image + @wait + aligned items all covered", () => {
    // The strongest invariant in this suite, applied to the step kinds it
    // previously never walked (each parses fine — this pins the walker's
    // reach so a T2–T4 model change cannot shrink coverage unnoticed).
    const src =
      "开场白。\n\n$$E=mc^2$$\n\n![示意](assets/x.png)\n\n@wait 2\n\n- R:自反性\n- S:对称性\n\n收尾。\n";
    const lecture = parseLecture(src);
    expect(kinds(allSteps(lecture))).toEqual([
      "prose",
      "math",
      "image",
      "wait",
      "list-item",
      "list-item",
      "prose",
    ]);
    assertFullSpanCoverage(lecture, src);
  });

  test("flat ink runs stay flat — no children field for plain inner text", () => {
    const step = prose("普通 ==高亮== 内容。");
    const run = inkRuns(step)[0]!;
    expect(run.children).toBeUndefined();
  });

  test("nested marks keep exact spans under CRLF", () => {
    const src = "前文。\r\n\r\n这是 ==重要的 **结构性** 变化== 的部分。\r\n";
    const lecture = parseLecture(src);
    const step = allSteps(lecture)[1]!;
    const nested = inkRuns(step)[0]!.children![1] as Extract<
      InlineRun,
      { kind: "ink" }
    >;
    expect(slice(src, nested.srcSpan)).toBe("**结构性**");
    expect(slice(src, nested.textSpan)).toBe("结构性");
    assertFullSpanCoverage(lecture, src);
  });

  test("unknown markers render as plain text (### and @custom)", () => {
    const lecture = parseLecture("### 三级标题\n\n@custom 未知指令\n");
    const steps = allSteps(lecture);
    expect(kinds(steps)).toEqual(["prose", "prose"]);
    expect(stepPlainText(steps[0]!)).toBe("### 三级标题");
    expect(stepPlainText(steps[1]!)).toBe("@custom 未知指令");
    expect(lecture.errors).toEqual([]);
  });

  test("a ### directly under prose interrupts the paragraph — own step (F8)", () => {
    // CommonMark: an ATX heading interrupts a paragraph. The literal ###
    // stays plain text (§4.6) but never lands mid-sentence in merged prose.
    const src = "正文一行。\n### 三级标题\n更多。\n";
    const lecture = parseLecture(src);
    const steps = allSteps(lecture);
    expect(kinds(steps)).toEqual(["prose", "prose", "prose"]);
    expect(stepPlainText(steps[0]!)).toBe("正文一行。");
    expect(stepPlainText(steps[1]!)).toBe("### 三级标题");
    expect(stepPlainText(steps[2]!)).toBe("更多。");
    expect(slice(src, steps[1]!.srcSpan)).toBe("### 三级标题");
    expect(lecture.errors).toEqual([]);

    // Seven-plus hashes are a paragraph in CommonMark — they keep merging.
    const lazy = parseLecture("正文一行。\n####### 不是标题\n");
    expect(kinds(allSteps(lazy))).toEqual(["prose"]);
  });

  test("bare * used as multiplication does not become emphasis", () => {
    const step = prose("结果是 2 * 3 * 4 这样。");
    expect(step.inline.filter((r) => r.kind === "em")).toEqual([]);
    expect(stepPlainText(step)).toBe("结果是 2 * 3 * 4 这样。");
  });

  test("soft-wrapped paragraph merges into one prose step with break runs", () => {
    const src = "第一行内容\n第二行内容\n\n新段落。\n";
    const lecture = parseLecture(src);
    const steps = allSteps(lecture);
    expect(kinds(steps)).toEqual(["prose", "prose"]);
    const first = steps[0] as ProseStep;
    expect(first.inline.some((r) => r.kind === "break")).toBe(true);
    expect(stepPlainText(first)).toBe("第一行内容 第二行内容");
    expect(slice(src, first.srcSpan)).toBe("第一行内容\n第二行内容");
  });
});

// ── $ math vs currency ──────────────────────────────────────────────────────

describe("$ delimiter vs currency", () => {
  const mathRuns = (src: string) => {
    const lecture = parseLecture(src);
    const step = allSteps(lecture)[0]!;
    return "inline" in step
      ? step.inline.filter(
          (r): r is Extract<InlineRun, { kind: "math" }> => r.kind === "math",
        )
      : [];
  };

  test("$100 is money, not an opening delimiter", () => {
    const runs = mathRuns("这台设备要 $100 一台。");
    expect(runs).toEqual([]);
  });

  test("two prices on one line stay literal", () => {
    const src = "从 $7 涨到 $35 之间波动。";
    expect(mathRuns(src)).toEqual([]);
    const lecture = parseLecture(src);
    expect(stepPlainText(allSteps(lecture)[0]!)).toBe(src);
  });

  test("closing $ followed by a digit is rejected ($x$100)", () => {
    expect(mathRuns("变量 $x$100 混写。")).toEqual([]);
  });

  test("real inline math parses", () => {
    const runs = mathRuns("质能方程 $E=mc^2$ 说明了一切。");
    expect(runs.map((r) => r.tex)).toEqual(["E=mc^2"]);
  });

  test("digit-leading formulas parse ($2^n$, $2\\pi r$)", () => {
    // Pandoc's rule only forbids whitespace after the opener and a digit
    // after the closer — a digit-leading formula is legal math, and the
    // currency cases above still stay literal (they never find a closer).
    expect(mathRuns("复杂度是 $2^n$ 级别。").map((r) => r.tex)).toEqual([
      "2^n",
    ]);
    expect(mathRuns("面积是 $2\\pi r$ 的形式。").map((r) => r.tex)).toEqual([
      "2\\pi r",
    ]);
  });

  test("digit-leading formula and a price can share a board", () => {
    const src = "单价 $100 时,复杂度 $2^n$ 才是瓶颈。";
    const runs = mathRuns(src);
    expect(runs.map((r) => r.tex)).toEqual(["2^n"]);
  });

  test("multiple inline formulas on one line", () => {
    const runs = mathRuns("已知 $a+b$ 与 $c$ 的关系。");
    expect(runs.map((r) => r.tex)).toEqual(["a+b", "c"]);
  });

  test("glued CJK price + glued formula: the price never swallows prose", () => {
    // CJK prose puts no spaces around inline constructs, so the whitespace
    // guard alone missed this: the digit-led candidate at 价格是$ scanned
    // through to the formula's own $ and swallowed "100元,公式是" into a
    // bogus math run — and, because math runs contribute ZERO chars to
    // stepPlainText, every backref offset in the step silently shifted.
    const src = "价格是$100元,公式是$x$。";
    expect(mathRuns(src).map((r) => r.tex)).toEqual(["x"]);
    const step = allSteps(parseLecture(src))[0]!;
    expect(stepPlainText(step)).toBe("价格是$100元,公式是。");
  });

  test("glued CJK price with unit suffix + glued formula ($35B)", () => {
    const src = "营收$35B,增长率$g$。";
    expect(mathRuns(src).map((r) => r.tex)).toEqual(["g"]);
    const step = allSteps(parseLecture(src))[0]!;
    expect(stepPlainText(step)).toBe("营收$35B,增长率。");
  });

  test("glued CJK math keeps working (当$n$很大时)", () => {
    // The discriminating counter-case: glued math is supported — the fix
    // must separate glued-currency from glued-math, not demand spaces.
    const src = "当$n$很大时,复杂度爆炸。";
    expect(mathRuns(src).map((r) => r.tex)).toEqual(["n"]);
  });

  test("a lone glued CJK price stays literal ($100元)", () => {
    expect(mathRuns("价格是$100元整。")).toEqual([]);
  });

  test("math runs contribute zero characters to stepPlainText (v1 boundary)", () => {
    // Documented in engine/text.ts: formulas do not exist in the plain-text
    // offset vocabulary — adjacent text runs meet with a doubled space.
    // T4's offset→DOM mapping must treat math nodes as zero-width.
    const src = "当 $n$ 很大时,复杂度爆炸。";
    const step = allSteps(parseLecture(src))[0]!;
    expect(stepPlainText(step)).toBe("当  很大时,复杂度爆炸。");
  });

  test("a back reference targeting across a formula degrades to refUnresolved", () => {
    // Consequence of the zero-character rule: no back reference can point
    // at or across formula text. The SKILL.md dialect guidance (T7) must
    // not teach this gesture — it fails softly (BadStep + warning), never
    // crashes.
    const src = "当 $n$ 很大时,复杂度爆炸。\n\n@circle \"当 n 很大时\"\n";
    const lecture = parseLecture(src);
    expect(kinds(allSteps(lecture))).toEqual(["prose", "bad"]);
    expect(lecture.errors).toHaveLength(1);
    expect(lecture.errors[0]?.code).toBe("refUnresolved");
  });

  test("block math: single line $$…$$", () => {
    const lecture = parseLecture("$$a + b = c$$\n");
    const step = allSteps(lecture)[0] as MathStep;
    expect(step.kind).toBe("math");
    expect(step.tex).toBe("a + b = c");
  });

  test("block math: fenced multi-line $$", () => {
    const lecture = parseLecture("$$\na\nb\n$$\n");
    const step = allSteps(lecture)[0] as MathStep;
    expect(step.kind).toBe("math");
    expect(step.tex).toBe("a\nb");
  });
});

// ── section formation (multi-H1 / late-H1) ──────────────────────────────────

describe("section formation — H1 beyond the document opener", () => {
  test("a second H1 opens a new section", () => {
    const lecture = parseLecture("# A\n\n正文\n\n# B\n\n正文2\n");
    expect(lecture.sections).toHaveLength(2);
    expect(lecture.sections[0]!.heading?.level).toBe(1);
    expect(stepPlainText(lecture.sections[0]!.heading!)).toBe("A");
    expect(kinds(lecture.sections[0]!.steps)).toEqual(["prose"]);
    expect(stepPlainText(lecture.sections[1]!.heading!)).toBe("B");
    expect(kinds(lecture.sections[1]!.steps)).toEqual(["prose"]);
    expect(lecture.title).toBe("A");
  });

  test("an H1 that is not the very first block opens a section — the preamble stays headingless", () => {
    const lecture = parseLecture("引言段。\n\n# 迟到的标题\n\n正文\n");
    expect(lecture.sections).toHaveLength(2);
    expect(lecture.sections[0]!.heading).toBeUndefined();
    expect(kinds(lecture.sections[0]!.steps)).toEqual(["prose"]);
    expect(lecture.sections[1]!.heading?.level).toBe(1);
    // Title still comes from the first H1 wherever it sits.
    expect(lecture.title).toBe("迟到的标题");
  });
});

// ── step identity (§4.5 — block index + content hash) ───────────────────────

describe("stepContentHash (R1/R4 memo key)", () => {
  test("position-independent: identical content at shifted offsets keeps its key", () => {
    const a = parseLecture("短前缀。\n\n目标句子,内容完全一致。\n");
    const b = parseLecture("一段长得多的前缀,把后文推远。\n\n目标句子,内容完全一致。\n");
    const stepA = allSteps(a)[1]!;
    const stepB = allSteps(b)[1]!;
    expect(stepA.srcSpan.start).not.toBe(stepB.srcSpan.start);
    expect(stepContentHash(stepA, a.source)).toBe(
      stepContentHash(stepB, b.source),
    );
  });

  test("content-sensitive: a one-character edit changes the key", () => {
    const a = parseLecture("同样的前缀。\n\n目标句子甲。\n");
    const b = parseLecture("同样的前缀。\n\n目标句子乙。\n");
    expect(stepContentHash(allSteps(a)[1]!, a.source)).not.toBe(
      stepContentHash(allSteps(b)[1]!, b.source),
    );
  });

  test("deterministic across re-parses (memo key survives streaming re-parse)", () => {
    const src = "# 标题\n\n正文段落,带 ==标记==。\n";
    const a = parseLecture(src);
    const b = parseLecture(src);
    for (const [i, step] of allSteps(a).entries()) {
      expect(stepContentHash(step, a.source)).toBe(
        stepContentHash(allSteps(b)[i]!, b.source),
      );
    }
  });
});

// ── back references ─────────────────────────────────────────────────────────

describe("back references (@strike / @circle / @highlight / @underline)", () => {
  test("resolves nearest-upward when several steps match", () => {
    const src =
      "第一段提到了 关键结论 一次。\n\n第二段也提到 关键结论 再次。\n\n@circle \"关键结论\"\n";
    const lecture = parseLecture(src);
    const steps = allSteps(lecture);
    expect(kinds(steps)).toEqual(["prose", "prose", "backref"]);

    const ref = steps[2] as BackRefStep;
    expect(ref.action).toBe("circle");
    expect(ref.target.step).toEqual({ section: 0, step: 1 });
    const plain = stepPlainText(steps[1]!);
    expect(plain.slice(ref.target.start, ref.target.end)).toBe("关键结论");
    expect(lecture.errors).toEqual([]);
  });

  test("@highlight resolves like its three siblings (the fourth verb, previously untested)", () => {
    const src = "重点是 这一句要发光 没错。\n\n@highlight \"这一句要发光\"\n";
    const lecture = parseLecture(src);
    const steps = allSteps(lecture);
    expect(kinds(steps)).toEqual(["prose", "backref"]);
    const ref = steps[1] as BackRefStep;
    expect(ref.action).toBe("highlight");
    const plain = stepPlainText(steps[0]!);
    expect(plain.slice(ref.target.start, ref.target.end)).toBe("这一句要发光");
    expect(lecture.errors).toEqual([]);
  });

  test("ambiguity within a step takes the nearest occurrence", () => {
    const src = "先说 结论 然后再说一次 结论 结束。\n\n@underline \"结论\"\n";
    const lecture = parseLecture(src);
    const ref = allSteps(lecture)[1] as BackRefStep;
    const plain = stepPlainText(allSteps(lecture)[0]!);
    expect(ref.target.start).toBe(plain.lastIndexOf("结论"));
  });

  test("matches text inside ink marks (plain-text matching)", () => {
    const src = "这是 ==重要的部分== 的内容。\n\n@underline \"重要的部分\"\n";
    const lecture = parseLecture(src);
    const ref = allSteps(lecture)[1] as BackRefStep;
    expect(ref.target.step).toEqual({ section: 0, step: 0 });
    expect(lecture.errors).toEqual([]);
  });

  test("unresolved target degrades to BadStep + refUnresolved (no crash)", () => {
    const src = "一些内容。\n\n@strike \"不存在的文本\"\n\n后续内容照常。\n";
    const lecture = parseLecture(src);
    const steps = allSteps(lecture);
    expect(kinds(steps)).toEqual(["prose", "bad", "prose"]);
    expect(lecture.errors).toHaveLength(1);
    expect(lecture.errors[0]).toMatchObject({
      code: "refUnresolved",
      step: { section: 0, step: 1 },
    });
  });

  test("malformed directive (missing quoted target) is a bad step", () => {
    const lecture = parseLecture("@strike 没有引号\n");
    expect(kinds(allSteps(lecture))).toEqual(["bad"]);
    expect(lecture.errors[0]?.code).toBe("stepParseError");
  });
});

// ── C2 camera verbs (@overview / @focus) ────────────────────────────────────

describe("camera verbs (@overview / @focus)", () => {
  test("@overview stands alone; srcSpan is its own line (G6)", () => {
    const src = "先讲一段。\n\n@overview\n\n再讲一段。\n";
    const lecture = parseLecture(src);
    const steps = allSteps(lecture);
    expect(kinds(steps)).toEqual(["prose", "camera", "prose"]);
    const cam = steps[1] as CameraStep;
    expect(cam.op).toBe("overview");
    expect(cam.target).toBeUndefined();
    expect(src.slice(cam.srcSpan.start, cam.srcSpan.end)).toBe("@overview");
    expect(lecture.errors).toEqual([]);
  });

  test('@focus "锚文本" resolves nearest-upward like @strike; srcSpan is its own line (G6)', () => {
    const src =
      '第一段提到 关键结论 一次。\n\n第二段也提到 关键结论 再次。\n\n@focus "关键结论"\n';
    const lecture = parseLecture(src);
    const steps = allSteps(lecture);
    expect(kinds(steps)).toEqual(["prose", "prose", "camera"]);
    const cam = steps[2] as CameraStep;
    expect(cam.op).toBe("focus");
    expect(cam.targetText).toBe("关键结论");
    expect(cam.target).toEqual({ section: 0, step: 1 }); // nearest wins
    expect(src.slice(cam.srcSpan.start, cam.srcSpan.end)).toBe(
      '@focus "关键结论"',
    );
    expect(lecture.errors).toEqual([]);
  });

  test("unresolved @focus degrades to BadStep + refUnresolved (no crash)", () => {
    const src = '一些内容。\n\n@focus "不存在的文本"\n\n后续内容照常。\n';
    const lecture = parseLecture(src);
    expect(kinds(allSteps(lecture))).toEqual(["prose", "bad", "prose"]);
    expect(lecture.errors).toHaveLength(1);
    expect(lecture.errors[0]).toMatchObject({
      code: "refUnresolved",
      step: { section: 0, step: 1 },
    });
  });

  test.each(["@focus", "@focus 没有引号", "@focus 2", "@overview 2"])(
    "malformed camera directive %s is a bad step (never a board number)",
    (line) => {
      const lecture = parseLecture(`前文。\n\n${line}\n`);
      expect(kinds(allSteps(lecture))).toEqual(["prose", "bad"]);
      expect(lecture.errors[0]?.code).toBe("stepParseError");
    },
  );

  test("a camera line interrupts a paragraph instead of merging into it", () => {
    const src = "第一行接着\n@overview\n继续写。\n";
    const lecture = parseLecture(src);
    expect(kinds(allSteps(lecture))).toEqual(["prose", "camera", "prose"]);
  });
});

// ── G1: no simultaneity syntax ──────────────────────────────────────────────

describe("G1 — @with / @after are dead syntax", () => {
  test.each(["@with", "@after 2", "@with chart"])(
    "%s parses to a bad step",
    (line) => {
      const lecture = parseLecture(`前文。\n\n${line}\n\n后文。\n`);
      const steps = allSteps(lecture);
      expect(kinds(steps)).toEqual(["prose", "bad", "prose"]);
      expect(lecture.errors).toHaveLength(1);
      expect(lecture.errors[0]?.code).toBe("stepParseError");
    },
  );
});

// ── @wait escape hatch ──────────────────────────────────────────────────────

describe("@wait", () => {
  test("bare @wait and @wait <seconds>", () => {
    const lecture = parseLecture("@wait\n\n@wait 2\n\n@wait 1.5\n");
    const steps = allSteps(lecture) as WaitStep[];
    expect(kinds(steps)).toEqual(["wait", "wait", "wait"]);
    expect(steps.map((s) => s.seconds)).toEqual([undefined, 2, 1.5]);
    expect(lecture.errors).toEqual([]);
  });
});

// ── chart robustness ────────────────────────────────────────────────────────

describe("chart blocks", () => {
  test("frame accepts type/x/y plus layer rows in the same block", () => {
    const src = board(
      "'''chart m1\ntype: bar\nx: Q1 Q2 Q3 Q4 (季度)\ny: 0 .. 10\n+ S: 1 2 3 4\n+ mark S @ Q3 : \"峰值\"\n+ note @ Q2,5 : \"自由标注\"\n'''\n",
    );
    const lecture = parseLecture(src);
    const frame = allSteps(lecture)[0] as ChartFrameStep;
    expect(frame.kind).toBe("chart-frame");
    expect(frame.chartType).toBe("bar");
    expect(frame.x).toMatchObject({ values: ["Q1", "Q2", "Q3", "Q4"], unit: "季度" });
    expect(frame.y).toMatchObject({ from: "0", to: "10" });
    expect(frame.rows.map((r) => r.kind)).toEqual(["series", "mark", "note"]);
    expect(frame.rows[2]).toMatchObject({ x: "Q2", y: "5", text: "自由标注" });
    expect(lecture.errors).toEqual([]);
    assertFullSpanCoverage(lecture, src);
  });

  test("the parenthesised measure is kept verbatim, inner spaces and all", () => {
    // What the axis measures is written GLUED to the number (`${v}${unit}`),
    // which is right for `24分钟` and wrong for `24min`. The only way an
    // author can say "this language separates them" is to write the space
    // into the parentheses — so the parser must not tidy it away. Only the
    // padding OUTSIDE the parentheses is the author's formatting.
    const src = board("'''chart m1\nx: Jan Feb (month)\ny: 0 .. 240  ( min)\n+ S: 1 2\n'''\n");
    const frame = allSteps(parseLecture(src))[0] as ChartFrameStep;
    expect(frame.y).toMatchObject({ from: "0", to: "240", unit: " min" });
    expect(frame.x).toMatchObject({ values: ["Jan", "Feb"], unit: "month" });
  });

  test("a bad block is isolated — neighbours parse untouched (R6)", () => {
    const src = board(
      "前面的段落。\n\n'''chart bad1\nx: 0 .. 10\nthis is nonsense\n'''\n\n后面的段落。\n",
    );
    const lecture = parseLecture(src);
    const steps = allSteps(lecture);
    expect(kinds(steps)).toEqual(["prose", "bad", "prose"]);
    expect(lecture.errors).toHaveLength(1);
    expect(lecture.errors[0]).toMatchObject({
      code: "stepParseError",
      step: { section: 0, step: 1 },
    });
    expect(lecture.errors[0]?.excerpt).toContain("nonsense");
  });

  test("layer before any frame → refUnresolved bad step (R5)", () => {
    const lecture = parseLecture(board("'''chart nofr\n+ A: 1 2 3\n'''\n"));
    expect(kinds(allSteps(lecture))).toEqual(["bad"]);
    expect(lecture.errors[0]?.code).toBe("refUnresolved");
  });

  test("a failed frame does not register its name", () => {
    const src = board(
      "'''chart broken\nx: 0 .. 10\ngarbage row\n'''\n\n'''chart broken\n+ A: 1 2\n'''\n",
    );
    const lecture = parseLecture(src);
    expect(kinds(allSteps(lecture))).toEqual(["bad", "bad"]);
    expect(lecture.errors.map((e) => e.code)).toEqual([
      "stepParseError",
      "refUnresolved",
    ]);
  });

  test("axes redeclared in a later block → bad step", () => {
    const src = board(
      "'''chart rev2\nx: 0 .. 5\n'''\n\n'''chart rev2\nx: 0 .. 9\n+ A: 1 2\n'''\n",
    );
    const lecture = parseLecture(src);
    expect(kinds(allSteps(lecture))).toEqual(["chart-frame", "bad"]);
    expect(lecture.errors[0]?.code).toBe("stepParseError");
  });

  test("non-numeric series values → bad block", () => {
    const lecture = parseLecture(board("'''chart n1\nx: 0 .. 2\n+ A: 1 x 3\n'''\n"));
    expect(kinds(allSteps(lecture))).toEqual(["bad"]);
  });

  test("unquoted mark row gets a mark-shaped diagnostic, not a bogus series (R6)", () => {
    // The single most likely typo for this row form: quotes omitted. The
    // diagnostic is the agent's self-heal input — it must name the expected
    // mark shape, never rename the row into a non-numeric "series".
    const src = board(
      "'''chart m2\nx: 0 .. 2\n+ mark NVIDIA @ 2024Q4 : 35.6B\n'''\n",
    );
    const lecture = parseLecture(src);
    expect(kinds(allSteps(lecture))).toEqual(["bad"]);
    expect(lecture.errors[0]?.message).toBe(
      'malformed mark row — expected + mark <series> @ <x> : "text"',
    );
    expect(lecture.errors[0]?.message).not.toContain("non-numeric");
  });

  test("unquoted note row gets a note-shaped diagnostic (R6)", () => {
    const src = board("'''chart n2\nx: 0 .. 2\n+ note @ 1, 5 : 自由文本\n'''\n");
    const lecture = parseLecture(src);
    expect(kinds(allSteps(lecture))).toEqual(["bad"]);
    expect(lecture.errors[0]?.message).toBe(
      'malformed note row — expected + note @ <x> , <y> : "text"',
    );
  });

  test("a series literally named mark/note still parses as a series", () => {
    const src = board("'''chart k1\nx: 0 .. 2\n+ mark: 1 2\n+ note: 3 4\n'''\n");
    const lecture = parseLecture(src);
    const frame = allSteps(lecture)[0] as ChartFrameStep;
    expect(frame.kind).toBe("chart-frame");
    expect(frame.rows.map((r) => r.kind)).toEqual(["series", "series"]);
    expect(lecture.errors).toEqual([]);
  });

  test("invalid chart type → bad block", () => {
    const lecture = parseLecture(board("'''chart t1\ntype: pie\nx: 0 .. 1\n'''\n"));
    expect(kinds(allSteps(lecture))).toEqual(["bad"]);
  });

  test("unnamed chart block → bad block", () => {
    const lecture = parseLecture(board("'''chart\nx: 0 .. 1\n'''\n"));
    expect(kinds(allSteps(lecture))).toEqual(["bad"]);
  });

  test("unclosed fence → bad step, not a crash", () => {
    const lecture = parseLecture(board("段落。\n\n'''chart u\nx: 0 .. 1\n"));
    const steps = allSteps(lecture);
    expect(kinds(steps)).toEqual(["prose", "bad"]);
    expect(lecture.errors[0]?.message).toMatch(/unclosed/i);
  });
});

// ── other blocks ────────────────────────────────────────────────────────────

describe("other block forms", () => {
  test("image on its own line", () => {
    const lecture = parseLecture("![架构图](assets/arch.png)\n");
    const step = allSteps(lecture)[0] as ImageStep;
    expect(step).toMatchObject({
      kind: "image",
      src: "assets/arch.png",
      alt: "架构图",
    });
  });

  test("html escape hatch stores raw content", () => {
    const lecture = parseLecture(
      board("'''html\n<div class=\"x\">hi</div>\n'''\n"),
    );
    const steps = allSteps(lecture);
    expect(kinds(steps)).toEqual(["html"]);
    expect((steps[0] as { html: string }).html).toBe(
      '<div class="x">hi</div>',
    );
  });

  test("unknown fence stays literal plain text, one run per line", () => {
    const src = board("'''js\nconst x = ==nope==;\n'''\n");
    const lecture = parseLecture(src);
    const steps = allSteps(lecture);
    expect(kinds(steps)).toEqual(["prose"]);
    // Content is never tokenized — == inside code is code, not ink.
    expect(inkRuns(steps[0]!)).toEqual([]);
    expect(stepPlainText(steps[0]!)).toContain("const x = ==nope==;");
    expect(lecture.errors).toEqual([]);

    // Per-line runs (G6/§6.4-E: whole-block spans are falsified — a
    // 20-line fence must not become one multi-line highlight/I9 unit).
    const step = steps[0] as ProseStep;
    const texts = step.inline.filter((r) => r.kind === "text");
    // The ``` rows are markup, not content — drawing them in handwriting
    // carries nothing, so only the body is drawn. The step span still
    // covers the whole block (assertFullSpanCoverage below pins that).
    expect(texts.map((r) => (r as { text: string }).text)).toEqual([
      "const x = ==nope==;",
    ]);
    for (const r of texts) {
      expect((r as { text: string }).text).not.toContain("\n");
    }
    expect(step.inline.filter((r) => r.kind === "break")).toHaveLength(0);
    assertFullSpanCoverage(lecture, src);
  });

  test("unknown fence under CRLF leaks no carriage returns (F6)", () => {
    const src = board("'''js\r\nconst a = 1;\r\n'''\r\n");
    const lecture = parseLecture(src);
    const step = allSteps(lecture)[0] as ProseStep;
    expect(step.kind).toBe("prose");
    for (const run of step.inline) {
      if (run.kind === "text") {
        expect(run.text).not.toContain("\r");
        expect(run.text).not.toContain("\n");
      }
    }
    expect(stepPlainText(step)).toBe("const a = 1;");
    assertFullSpanCoverage(lecture, src);
  });

  test("unknown fence keeps body indentation and rides blank lines", () => {
    const src = board("'''py\ndef f():\n    return 1\n\nx = f()\n'''\n");
    const lecture = parseLecture(src);
    const step = allSteps(lecture)[0] as ProseStep;
    const texts = step.inline
      .filter((r) => r.kind === "text")
      .map((r) => (r as { text: string }).text);
    expect(texts).toEqual(["def f():", "    return 1", "x = f()"]);
    assertFullSpanCoverage(lecture, src);
  });
});

// ── alignment groups ────────────────────────────────────────────────────────

describe("alignment groups (并列对齐, zero new syntax)", () => {
  test("consecutive items sharing a first separator type form a group", () => {
    const src =
      "- R:自反性 — 成立\n- S:对称性 — 成立\n- T:传递性 — 不成立\n";
    const lecture = parseLecture(src);
    const items = allSteps(lecture) as ListItemStep[];
    expect(kinds(items)).toEqual(["list-item", "list-item", "list-item"]);

    const groups = items.map((s) => s.align);
    expect(groups[0]).toBeDefined();
    // Same group id, colon type (full-width colon counts), consistent offsets.
    expect(new Set(groups.map((g) => g?.group)).size).toBe(1);
    for (const [i, g] of groups.entries()) {
      expect(g?.sep).toBe("colon");
      expect(stepPlainText(items[i]!)[g!.at]).toMatch(/[:：]/);
    }
  });

  test("separator-type change splits groups; lone items get none", () => {
    const src =
      "- 苹果:红\n- 香蕉:黄\n- 没有分隔符的条目\n- A — 1\n- B — 2\n";
    const lecture = parseLecture(src);
    const items = allSteps(lecture) as ListItemStep[];

    expect(items[0]!.align?.sep).toBe("colon");
    expect(items[1]!.align?.sep).toBe("colon");
    expect(items[0]!.align?.group).toBe(items[1]!.align!.group);

    expect(items[2]!.align).toBeUndefined();

    expect(items[3]!.align?.sep).toBe("dash");
    expect(items[4]!.align?.sep).toBe("dash");
    expect(items[3]!.align?.group).toBe(items[4]!.align!.group);
    expect(items[3]!.align!.group).not.toBe(items[0]!.align!.group);

    // Positional convention for the DASH variant (AlignInfo.at JSDoc):
    // `at` is the LEADING SPACE of the 3-char ` — ` run — the renderer
    // slices label = [0, at) and value = [at + 3, …).
    for (const item of [items[3]!, items[4]!]) {
      const plain = stepPlainText(item);
      const at = item.align!.at;
      expect(plain.slice(at, at + 3)).toBe(" — ");
      expect(plain[at]).toBe(" ");
    }
  });

  test("a single item with a separator is not a group", () => {
    const lecture = parseLecture("段落。\n\n- 唯一:条目\n\n又一段。\n");
    const item = allSteps(lecture).find(
      (s) => s.kind === "list-item",
    ) as ListItemStep;
    expect(item.align).toBeUndefined();
  });
});

// ── loadBoard / saveBoard ───────────────────────────────────────────────────

describe("loadBoard / saveBoard", () => {
  test("keys lectures by content-set prefix; theme.css rides on Board.themeCss", () => {
    const files = [
      { path: "alpha/board.md", content: "# Alpha 讲解\n\n内容。\n" },
      { path: "alpha/theme.css", content: ".board { color: red }" },
      { path: "beta/board.md", content: "# Beta\n" },
      { path: "notes.txt", content: "ignored" },
    ];
    const boardValue = loadBoard(files) as Board;
    expect(boardValue).not.toBeNull();
    expect(Object.keys(boardValue.byContentSet).sort()).toEqual([
      "alpha",
      "beta",
    ]);
    expect(boardValue.byContentSet["alpha"]!.title).toBe("Alpha 讲解");
    // Theming stays a domain/viewer concern — keyed per content set on the
    // Board, never a field of the engine's Lecture.
    expect(boardValue.themeCss).toEqual({ alpha: ".board { color: red }" });
    expect(boardValue.themeCss["beta"]).toBeUndefined();
    // Each lecture retains the exact source its spans index into.
    expect(boardValue.byContentSet["alpha"]!.source).toBe(
      "# Alpha 讲解\n\n内容。\n",
    );
  });

  test("root-level board.md uses the empty prefix", () => {
    const boardValue = loadBoard([
      { path: "board.md", content: "# 根板\n" },
    ]) as Board;
    expect(Object.keys(boardValue.byContentSet)).toEqual([""]);
  });

  test("title falls back to the content set name when no H1", () => {
    const boardValue = loadBoard([
      { path: "mydir/board.md", content: "普通段落,没有标题。\n" },
    ]) as Board;
    expect(boardValue.byContentSet["mydir"]!.title).toBe("mydir");
  });

  test("returns null when no board.md exists", () => {
    expect(loadBoard([{ path: "theme.css", content: "" }])).toBeNull();
    expect(loadBoard([])).toBeNull();
  });

  test("loadBoard does not mutate its input", () => {
    const files = [{ path: "board.md", content: "# T\n" }];
    const snapshot = structuredClone(files);
    loadBoard(files);
    expect(files).toEqual(snapshot);
  });

  test("saveBoard is the documented v1 stub — empty diff", () => {
    const boardValue = loadBoard([
      { path: "board.md", content: "# T\n" },
    ]) as Board;
    expect(saveBoard(boardValue, [])).toEqual({ writes: [], deletes: [] });
  });
});

// ── CRLF sources (Windows-authored boards) ──────────────────────────────────

describe("CRLF line endings", () => {
  test("the full demo board parses with exact spans under \\r\\n", () => {
    const src = DEMO.replaceAll("\n", "\r\n");
    const lecture = parseLecture(src);
    expect(lecture.errors).toEqual([]);
    expect(lecture.title).toBe("为什么这轮 AI 周期不同");
    // Same structure as the LF parse…
    expect(lecture.sections).toHaveLength(2);
    expect(kinds(lecture.sections[1]!.steps)).toEqual(
      kinds(parseLecture(DEMO).sections[1]!.steps),
    );
    // …and every span still slices the CRLF source exactly (the walker
    // verifies text/slice agreement, ordering and containment throughout).
    assertFullSpanCoverage(lecture, src);
    const hl = inkRuns(lecture.sections[1]!.steps[0]!)[0]!;
    expect(slice(src, hl.srcSpan)).toBe("==三倍==");
    expect(slice(src, hl.textSpan)).toBe("三倍");
    const frame = lecture.sections[1]!.steps[3] as ChartFrameStep;
    expect(slice(src, frame.x!.srcSpan)).toBe("x: 2023Q1 .. 2024Q4  (季度)");
  });
});

// ── error isolation at scale ────────────────────────────────────────────────

describe("whole-board resilience", () => {
  test("one broken block never takes down the rest of the board", () => {
    const src = board(
      [
        "# 标题",
        "",
        "好段落一。",
        "",
        "'''chart broken",
        "!!!",
        "'''",
        "",
        "好段落二,有 ==标记==。",
        "",
        "@with",
        "",
        "好段落三。",
        "",
      ].join("\n"),
    );
    const lecture = parseLecture(src);
    const steps = allSteps(lecture);
    expect(kinds(steps)).toEqual([
      "heading",
      "prose",
      "bad",
      "prose",
      "bad",
      "prose",
    ]);
    expect(lecture.errors).toHaveLength(2);
    // Every error points at a real step with a valid span.
    for (const err of lecture.errors) {
      expect(err.step).toBeDefined();
      expect(err.srcSpan.end).toBeGreaterThan(err.srcSpan.start);
    }
    assertFullSpanCoverage(lecture, src);
  });

  test("empty and whitespace-only sources parse to an empty lecture", () => {
    for (const src of ["", "\n\n\n", "   \n  \n"]) {
      const lecture = parseLecture(src, "fallback");
      expect(lecture.title).toBe("fallback");
      expect(lecture.sections).toHaveLength(1);
      expect(lecture.sections[0]!.steps).toEqual([]);
      expect(lecture.errors).toEqual([]);
    }
  });
});

/**
 * 讲稿 sync helpers (T4, G6 consumers) — line-level highlight resolution
 * and the plain-offset → DOM span mapping (math runs are zero-width).
 */

import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

import { parseLecture } from "../domain.js";
import { DEFAULT_DURATIONS } from "../engine/duration.js";
import { factoryFor } from "../engine/factories/index.js";
import { flattenSteps } from "../engine/inference.js";
import { stepPlainText } from "../engine/text.js";
import { buildTimeline } from "../engine/timeline.js";
import type { MeasureContext } from "../engine/types.js";
import {
  activeScheduleIndex,
  decorateScript,
  lineSpanOf,
  mapPlainRangeToSpans,
  scheduleEntrySpan,
  splitAtLine,
} from "../viewer/script-sync.js";

describe("lineSpanOf — 行级 expansion", () => {
  const src = "第一行\n第二行有内容\n第三行\n";

  test("expands a mid-line span to its full line", () => {
    const at = src.indexOf("有");
    expect(lineSpanOf(src, { start: at, end: at + 1 })).toEqual({
      start: src.indexOf("第二行"),
      end: src.indexOf("第二行") + "第二行有内容".length,
    });
  });

  test("first and last lines are handled without terminators", () => {
    expect(lineSpanOf(src, { start: 0, end: 1 })).toEqual({ start: 0, end: 3 });
    const tail = "尾行无换行";
    const s2 = `头\n${tail}`;
    expect(lineSpanOf(s2, { start: 2, end: 3 })).toEqual({
      start: 2,
      end: s2.length,
    });
  });

  test("chart rows highlight exactly their own source row, never the block", () => {
    const board = `\`\`\`chart rev
x: 2023 .. 2024
y: 0 .. 40
+ 甲: 1 2 3 4
\`\`\`
`;
    const lecture = parseLecture(board);
    const frame = flattenSteps(lecture)[0]!.step;
    if (frame.kind !== "chart-frame") throw new Error("expected chart frame");
    const row = frame.rows[0]!;
    const line = lineSpanOf(board, row.srcSpan);
    expect(board.slice(line.start, line.end)).toBe("+ 甲: 1 2 3 4");
  });
});

describe("activeScheduleIndex — the entry the pen is on", () => {
  const schedule = [
    { step: { section: 0, step: 0 }, unit: 0, start: 0, end: 1 },
    { step: { section: 0, step: 0 }, unit: 1, start: 1.5, end: 2 },
    { step: { section: 0, step: 1 }, unit: 0, start: 3, end: 4 },
  ];

  test("binary search finds the last started entry; gaps keep it lit", () => {
    expect(activeScheduleIndex(schedule, -0.5)).toBe(-1);
    expect(activeScheduleIndex(schedule, 0)).toBe(0);
    expect(activeScheduleIndex(schedule, 0.7)).toBe(0);
    expect(activeScheduleIndex(schedule, 1.2)).toBe(0); // pen-up gap
    expect(activeScheduleIndex(schedule, 1.6)).toBe(1);
    expect(activeScheduleIndex(schedule, 10)).toBe(2);
    expect(activeScheduleIndex(schedule, NaN)).toBe(-1);
  });

  test("entry span prefers the built unit's precise span, falls back to the step", () => {
    const stepSpan = { start: 0, end: 100 };
    const units = [
      { naturalDuration: 1, kind: "wipe" as const, srcSpan: { start: 3, end: 7 }, seek() {} },
    ];
    expect(scheduleEntrySpan(schedule[0]!, units, stepSpan)).toEqual({
      start: 3,
      end: 7,
    });
    expect(scheduleEntrySpan(schedule[1]!, units, stepSpan)).toBe(stepSpan);
    expect(scheduleEntrySpan(schedule[0]!, undefined, stepSpan)).toBe(stepSpan);
  });
});

describe("mapPlainRangeToSpans — stepPlainText vocabulary (math zero-width)", () => {
  test("maps a plain range across a formula onto the right spans", () => {
    const window = new Window();
    const doc = window.document as unknown as Document;
    const measureHost = doc.createElement("div");
    doc.body.appendChild(measureHost);
    const ctx: MeasureContext = {
      durations: DEFAULT_DURATIONS,
      document: doc,
      measureHost,
      env: { handwritingFontActive: true, strokeFontCovers: () => false },
      container: () => undefined,
    };

    const lecture = parseLecture("质能方程 $E=mc^2$ 之后接文字尾巴。\n");
    const step = flattenSteps(lecture)[0]!.step;
    const { node } = factoryFor(step.kind)!.build(step, ctx);

    const plain = stepPlainText(step);
    // Math contributed zero characters — the plain text glues the sides.
    expect(plain).not.toContain("E=mc");

    const spans = Array.from(node.querySelectorAll(".bansho-w"));
    const target = "尾巴";
    const at = plain.indexOf(target);
    expect(at).toBeGreaterThan(-1);
    const hits = mapPlainRangeToSpans(spans, plain, at, at + target.length);
    expect(hits.length).toBeGreaterThan(0);
    const joined = hits.map((h) => h.textContent).join("");
    expect(joined).toContain("尾");
    // No hit is the MathML node or from before the formula.
    for (const hit of hits) {
      expect(hit.textContent).not.toContain("E");
      expect(hit.textContent).not.toContain("质");
    }
  });

  test("repeated substrings resolve monotonically, not to the first occurrence", () => {
    const window = new Window();
    const doc = window.document as unknown as Document;
    const spans = ["三倍", "又是", "三倍"].map((t) => {
      const s = doc.createElement("span");
      s.textContent = t;
      return s;
    });
    const plain = "三倍又是三倍";
    const hits = mapPlainRangeToSpans(spans, plain, 4, 6); // the SECOND 三倍
    expect(hits).toEqual([spans[2]!]);
  });
});

describe("decorateScript / splitAtLine — 讲稿 pane decoration", () => {
  const src = "开场白\n==重点== 与 $x^2$\n```chart rev\n+ 甲: 1 2\n```\n尾声\n";

  test("decoration segments cover the source exactly once, in order", () => {
    const segs = decorateScript(src);
    let cursor = 0;
    for (const seg of segs) {
      expect(seg.start).toBe(cursor);
      expect(seg.end).toBeGreaterThan(seg.start);
      cursor = seg.end;
    }
    expect(cursor).toBe(src.length);
  });

  test("marks tint, fences dim, plain text stays plain", () => {
    const segs = decorateScript(src);
    const at = (needle: string) =>
      segs.find((s) => src.slice(s.start, s.end).includes(needle))!;
    expect(at("==重点==").cls).toBe("m");
    expect(at("$x^2$").cls).toBe("m");
    expect(at("```chart").cls).toBe("blk");
    expect(at("开场白").cls).toBe("");
  });

  test("empty source produces no segments", () => {
    expect(decorateScript("")).toEqual([]);
  });

  test("the active line splits its segment; text reassembles losslessly", () => {
    const segs = decorateScript(src);
    const line = lineSpanOf(src, {
      start: src.indexOf("重点"),
      end: src.indexOf("重点") + 2,
    });
    const parts = splitAtLine(src, segs, line);
    expect(parts.map((p) => p.text).join("")).toBe(src);
    const now = parts.filter((p) => p.now);
    expect(now.length).toBeGreaterThan(0);
    expect(now.map((p) => p.text).join("")).toBe(src.slice(line.start, line.end));
  });

  test("a chart ROW highlights inside the block, never the whole fence (G6)", () => {
    const segs = decorateScript(src);
    const row = "+ 甲: 1 2";
    const line = lineSpanOf(src, {
      start: src.indexOf(row),
      end: src.indexOf(row) + row.length,
    });
    const parts = splitAtLine(src, segs, line);
    const now = parts.filter((p) => p.now);
    expect(now.map((p) => p.text).join("")).toBe(row);
    // The highlighted piece keeps its block styling — only the range splits.
    for (const p of now) expect(p.cls).toBe("blk");
  });

  test("no active line → pass-through segments, nothing marked now", () => {
    const segs = decorateScript(src);
    const parts = splitAtLine(src, segs, null);
    expect(parts.map((p) => p.text).join("")).toBe(src);
    expect(parts.some((p) => p.now)).toBe(false);
  });
});

describe("schedule/highlight integration — the pen and the pane agree", () => {
  test("every schedule entry resolves to a source span inside the document", () => {
    const board = `# 标题

一段文字,==有标注==。

\`\`\`chart rev
x: 2023 .. 2024
y: 0 .. 40
+ 甲: 1 2 3 4
\`\`\`
`;
    const lecture = parseLecture(board);
    const timeline = buildTimeline(lecture, { durations: DEFAULT_DURATIONS });
    const flat = flattenSteps(lecture);
    for (const entry of timeline.schedule) {
      const step = flat.find(
        (f) =>
          f.ref.section === entry.step.section && f.ref.step === entry.step.step,
      )!.step;
      const span = scheduleEntrySpan(entry, undefined, step.srcSpan);
      const line = lineSpanOf(board, span);
      expect(line.start).toBeGreaterThanOrEqual(0);
      expect(line.end).toBeLessThanOrEqual(board.length);
      expect(line.end).toBeGreaterThan(line.start);
    }
  });
});

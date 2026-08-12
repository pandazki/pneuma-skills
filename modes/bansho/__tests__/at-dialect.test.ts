/**
 * at-dialect.test.ts (canvas pivot V2) — `@at` as LANGUAGE: what the parser
 * admits, what it refuses and with which words, how the anchored form
 * resolves, and how the placement is planned and projected.
 *
 * Scope note: this file pins the VERB. Where the pen actually lands (the
 * region fold, boxes, collision, burst) is `engine/layout.ts`'s business
 * and is pinned beside it.
 */

import { describe, expect, it } from "bun:test";

import { parseLecture } from "../domain.js";
import { DEFAULT_DURATIONS } from "../engine/duration.js";
import { planLecture, planStepUnits } from "../engine/inference.js";
import { STRIP_VERTICAL_WORD_MESSAGE } from "../engine/regions.js";
import type { AtStep, Step } from "../engine/types.js";

const stepsOf = (src: string): Step[] =>
  parseLecture(src).sections.flatMap((section) => section.steps);

const firstOfKind = <K extends Step["kind"]>(
  src: string,
  kind: K,
): Extract<Step, { kind: K }> => {
  const hit = stepsOf(src).find((step) => step.kind === kind);
  if (!hit) throw new Error(`no ${kind} step in:\n${src}`);
  return hit as Extract<Step, { kind: K }>;
};

const BOUNDED = "@board 2\n\n";

describe("@at — the bare form", () => {
  it("parses every word the bounded face admits", () => {
    for (const word of [
      "full",
      "left",
      "right",
      "top",
      "bottom",
      "top-left",
      "top-right",
      "bottom-left",
      "bottom-right",
    ]) {
      const step = firstOfKind(`${BOUNDED}@at ${word}\n\n话。\n`, "at");
      expect(step.region).toBe(word as AtStep["region"]);
      expect(step.targetText).toBeUndefined();
      expect(step.target).toBeUndefined();
    }
  });

  it("carries its own line as its srcSpan (G6)", () => {
    const src = `${BOUNDED}@at right\n\n话。\n`;
    const step = firstOfKind(src, "at");
    expect(src.slice(step.srcSpan.start, step.srcSpan.end)).toBe("@at right");
  });

  it("breaks a paragraph even without a blank line before it", () => {
    // `@at` is a KNOWN_DIRECTIVE, so it opens a block the way `@erase`
    // does: a placement written straight under a sentence is a placement,
    // never a literal line of that sentence. Adjacency is the whole reason
    // the verb belongs in that set.
    const steps = stepsOf(`${BOUNDED}第一句。\n@at right\n\n第二句。\n`);
    expect(steps.filter((s) => s.kind === "at").length).toBe(1);
    const prose = steps.filter((s) => s.kind === "prose");
    expect(prose.length).toBe(2);
    for (const step of prose) {
      expect(JSON.stringify(step)).not.toContain("@at");
    }
  });

  it("does not swallow the content that follows it", () => {
    const steps = stepsOf(`${BOUNDED}@at right\n\n第一句。\n\n第二句。\n`);
    expect(steps.filter((s) => s.kind === "prose").length).toBe(2);
    expect(steps.filter((s) => s.kind === "bad").length).toBe(0);
  });
});

describe("@at — the anchored form", () => {
  it("resolves nearest-upward, exactly like @erase and @focus", () => {
    const src = `${BOUNDED}这是那个定义。\n\n别的话。\n\n@at top-right "那个定义"\n\n补充。\n`;
    const step = firstOfKind(src, "at");
    expect(step.region).toBe("top-right");
    expect(step.targetText).toBe("那个定义");
    // step 0 is the `@board 2` opening direction, so the prose is step 1.
    expect(step.target).toEqual({ section: 0, step: 1 });
  });

  it("takes the NEAREST occurrence when the text repeats", () => {
    const src = `${BOUNDED}增长率在这里。\n\n增长率又出现。\n\n@at left "增长率"\n`;
    const step = firstOfKind(src, "at");
    expect(step.target).toEqual({ section: 0, step: 2 });
  });

  it("degrades to one bad step + refUnresolved, and the pen does not move", () => {
    const src = `${BOUNDED}只有这句。\n\n@at right "从没写过的话"\n\n后面的话。\n`;
    const lecture = parseLecture(src);
    const steps = lecture.sections.flatMap((s) => s.steps);
    // No placement was minted — nothing after it changes region.
    expect(steps.some((s) => s.kind === "at")).toBe(false);
    const bad = steps.filter((s) => s.kind === "bad");
    expect(bad.length).toBe(1);
    expect(bad[0]!.kind === "bad" && bad[0]!.reason).toBe(
      'placement target not found: "从没写过的话"',
    );
    expect(lecture.errors.map((e) => e.code)).toContain("refUnresolved");
    // The blast radius is exactly one step (R6).
    expect(steps.filter((s) => s.kind === "prose").length).toBe(2);
  });
});

describe("@at — what the parser refuses", () => {
  it("refuses a word that is in no vocabulary, and lists the whole set", () => {
    const bad = firstOfKind(`${BOUNDED}@at middle\n\n话。\n`, "bad");
    expect(bad.reason).toContain("unknown region");
    expect(bad.reason).toContain("bottom-right");
  });

  it("refuses a number, a percentage and a coordinate", () => {
    for (const attempt of ["@at 3", "@at 50%", "@at x=40", "@at 120px"]) {
      const steps = stepsOf(`${BOUNDED}${attempt}\n\n话。\n`);
      const bad = steps.find((s) => s.kind === "bad");
      expect(bad).toBeDefined();
      expect(steps.some((s) => s.kind === "at")).toBe(false);
    }
  });

  it("teaches the shape when the line is malformed", () => {
    const bad = firstOfKind(`${BOUNDED}@at right 那个定义\n\n话。\n`, "bad");
    expect(bad.reason).toContain("malformed @at");
    expect(bad.reason).toContain("never a number or a coordinate");
  });
});

describe("@at on the strip — the two faces are not the same vocabulary", () => {
  it("keeps full / left / right", () => {
    for (const word of ["full", "left", "right"]) {
      const step = firstOfKind(`@at ${word}\n\n话。\n`, "at");
      expect(step.region).toBe(word as AtStep["region"]);
    }
  });

  it("refuses every vertical fraction with the ruled teaching message", () => {
    for (const word of [
      "top",
      "bottom",
      "top-left",
      "top-right",
      "bottom-left",
      "bottom-right",
    ]) {
      const bad = firstOfKind(`@at ${word}\n\n话。\n`, "bad");
      expect(bad.reason).toBe(STRIP_VERTICAL_WORD_MESSAGE);
    }
  });

  it("judges the face from the document's own first step, not from context", () => {
    // `@board 3` opens the lecture ⇒ bounded ⇒ a corner is legal.
    expect(firstOfKind("@board 3\n\n@at bottom-left\n\n话。\n", "at").region).toBe(
      "bottom-left",
    );
    // No `@board` ⇒ the strip ⇒ the same word is a category error.
    expect(firstOfKind("@at bottom-left\n\n话。\n", "bad").reason).toBe(
      STRIP_VERTICAL_WORD_MESSAGE,
    );
  });
});

describe("@at on the timeline", () => {
  const at: AtStep = { kind: "at", region: "right", srcSpan: { start: 0, end: 9 } };

  it("plans exactly one exclusive walk unit at the place duration", () => {
    const units = planStepUnits(at, DEFAULT_DURATIONS);
    expect(units.length).toBe(1);
    expect(units[0]!.kind).toBe("place");
    expect(units[0]!.duration).toBe(DEFAULT_DURATIONS.place);
    expect(units[0]!.srcSpan).toEqual(at.srcSpan);
  });

  it("reads its duration from the constants — no number is invented", () => {
    const doubled = { ...DEFAULT_DURATIONS, place: DEFAULT_DURATIONS.place * 2 };
    expect(planStepUnits(at, doubled)[0]!.duration).toBe(doubled.place);
  });

  it("occupies a beat on the board, and none in the notes projection", () => {
    const lecture = parseLecture(`${BOUNDED}一句话。\n\n@at right\n\n第二句。\n`);
    const board = planLecture(lecture, DEFAULT_DURATIONS);
    expect(board.some((plan) => plan.step.kind === "at")).toBe(true);

    const notes = planLecture(lecture, DEFAULT_DURATIONS, {
      omitStageSteps: true,
    });
    expect(notes.some((plan) => plan.step.kind === "at")).toBe(false);
    // …and the content is untouched: the notes are a DOCUMENT projection.
    expect(notes.filter((plan) => plan.step.kind === "prose").length).toBe(2);
  });
});

/**
 * T6 — the ViewerAddress vocabulary (§8) and the words the board uses to
 * describe itself to the agent.
 *
 * Bar (T6-impl 验收 + T6-review 词汇纯度):
 *  - `{contentSet?, section?, step?}` round-trips against a real parsed
 *    lecture, sections counted from 0 (the opening before the first `##`)
 *    and steps from 1 — the presentation mapping over the engine's
 *    `StepRef`, which is 0-based with `-1` for the heading;
 *  - the address is the ONLY handle: it must resolve back to a step, and
 *    an out-of-range one must fail LOUDLY (null), never silently land on a
 *    neighbour;
 *  - every step describes itself in lecture words. Rendering vocabulary
 *    (beat / wipe / stroke / fade / easing / frame) anywhere in the words
 *    the agent reads is a T6-review blocker, so the vocabulary table is
 *    asserted against the ban list here rather than trusted to review;
 *  - a step's reveal status is derived from the canonical schedule, and a
 *    step the board never performs says so instead of claiming "upcoming"
 *    (a status that would never resolve).
 */

import { describe, expect, test } from "bun:test";

import { parseLecture } from "../domain.js";
import { DEFAULT_DURATIONS } from "../engine/duration.js";
import { buildTimeline } from "../engine/timeline.js";
import type { Step, StepRef } from "../engine/types.js";
import {
  EXPLAIN_KINDS,
  describeStep,
  foreignSet,
  parseStepKey,
  resolveAddress,
  revealStatus,
  stepKey,
  stepWindow,
  summarizeStep,
  toAddress,
} from "../viewer/address.js";
import { BANNED_WORDS } from "./vocabulary.js";

const SOURCE = `# Why this cycle is different

The opening paragraph sits in the preamble.

## Supply

Data-centre revenue tripled to ==87.4B==.

- Demand: three times
- Supply: constrained

> A side note about the same quarter.

$$a^2 + b^2 = c^2$$

---

\`\`\`chart revenue
x: 2023Q1 .. 2024Q4  (quarter)
y: 0 .. 40  (billion)
+ NVIDIA: 7.2 10.3 14.5 18.4 22.6 26.0 30.8 35.6
\`\`\`

@circle "87.4B"

@wait 1

![a picture](assets/x.png)

\`\`\`html
<b>an embedded block</b>
\`\`\`
`;

const lecture = parseLecture(SOURCE);
const timeline = buildTimeline(lecture, { durations: DEFAULT_DURATIONS });

/** Locate a step by kind — the tests address by meaning, not by index. */
function findRef(predicate: (step: Step) => boolean): StepRef {
  for (let s = 0; s < lecture.sections.length; s++) {
    const section = lecture.sections[s]!;
    if (section.heading && predicate(section.heading)) {
      return { section: s, step: -1 };
    }
    for (let i = 0; i < section.steps.length; i++) {
      if (predicate(section.steps[i]!)) return { section: s, step: i };
    }
  }
  throw new Error("no step matched the predicate");
}

describe("the lecture parses into the shape the address vocabulary assumes", () => {
  test("no unreadable blocks — the fixture is a clean board", () => {
    const bad = lecture.errors.filter((e) => e.code !== "unsupportedStep");
    expect(bad).toEqual([]);
  });

  test("section 0 is the opening, section 1 opens at the first ##", () => {
    expect(lecture.sections.length).toBe(2);
    expect(lecture.sections[0]!.heading?.kind).toBe("heading");
    expect(lecture.sections[1]!.heading?.kind).toBe("heading");
  });
});

describe("toAddress — engine StepRef to the user-facing vocabulary", () => {
  test("steps are 1-based inside their section", () => {
    expect(toAddress({ section: 1, step: 0 })).toEqual({ section: 1, step: 1 });
    expect(toAddress({ section: 0, step: 4 })).toEqual({ section: 0, step: 5 });
  });

  test("a section heading is the section itself — no step key", () => {
    expect(toAddress({ section: 2, step: -1 })).toEqual({ section: 2 });
  });

  test("never leaks a zero-based index", () => {
    for (let i = 0; i < lecture.sections[1]!.steps.length; i++) {
      expect(toAddress({ section: 1, step: i }).step).toBe(i + 1);
    }
  });
});

describe("resolveAddress — the address is a real handle, or nothing", () => {
  test("round-trips every step of the board", () => {
    for (let s = 0; s < lecture.sections.length; s++) {
      const section = lecture.sections[s]!;
      const refs: StepRef[] = section.heading ? [{ section: s, step: -1 }] : [];
      section.steps.forEach((_, i) => refs.push({ section: s, step: i }));
      for (const ref of refs) {
        expect(resolveAddress(lecture, toAddress(ref))).toEqual(ref);
      }
    }
  });

  test("a section with no step names its heading", () => {
    expect(resolveAddress(lecture, { section: 1 })).toEqual({
      section: 1,
      step: -1,
    });
  });

  test("a headless section falls back to its first step, never to null", () => {
    const headless = parseLecture("Just one paragraph, no heading at all.\n");
    expect(headless.sections[0]!.heading).toBeUndefined();
    expect(resolveAddress(headless, { section: 0 })).toEqual({
      section: 0,
      step: 0,
    });
  });

  test("out-of-range addresses fail loudly instead of clamping", () => {
    expect(resolveAddress(lecture, { section: 9, step: 1 })).toBeNull();
    expect(resolveAddress(lecture, { section: 1, step: 999 })).toBeNull();
    expect(resolveAddress(lecture, { section: -1 })).toBeNull();
    expect(resolveAddress(lecture, {})).toBeNull();
    expect(resolveAddress(lecture, { section: 1.5, step: 1 })).toBeNull();
    expect(resolveAddress(lecture, { section: "1", step: 1 })).toBeNull();
  });

  test("step 0 is read as the section heading (agent-input boundary)", () => {
    expect(resolveAddress(lecture, { section: 1, step: 0 })).toEqual({
      section: 1,
      step: -1,
    });
  });

  test("the framework-owned contentSet key is not this function's business", () => {
    // `resolveAddress` resolves against the lecture it is handed and knows
    // nothing about which board that is. Whether the address names ANOTHER
    // board is `foreignSet`'s question, asked by the caller before this
    // point — see below.
    expect(
      resolveAddress(lecture, { contentSet: "tech-zh", section: 1, step: 1 }),
    ).toEqual({ section: 1, step: 0 });
  });
});

describe("foreignSet — an address for a board this action cannot reach", () => {
  // T7-review F1: `contentSet` is resolved by the framework on the locator
  // channel only. Action params arrive verbatim, so an address naming
  // another board used to be silently ignored — the action moved the board
  // the user WAS watching to those coordinates and answered "success".
  test("an address with no contentSet is about the open board", () => {
    expect(foreignSet({ section: 1, step: 2 }, "tech-zh")).toBeNull();
    expect(foreignSet({ section: 1, step: 2 }, "")).toBeNull();
    expect(foreignSet({ section: 1, step: 2 }, null)).toBeNull();
  });

  test("naming the open board is naming the open board", () => {
    expect(foreignSet({ contentSet: "tech-zh", section: 1 }, "tech-zh")).toBeNull();
    // The seed catalogue writes directories as `tech-zh/`, and that is the
    // shape an agent copies — lenient at an agent-input boundary.
    expect(foreignSet({ contentSet: "tech-zh/", section: 1 }, "tech-zh")).toBeNull();
    expect(foreignSet({ contentSet: "/tech-zh", section: 1 }, "tech-zh")).toBeNull();
    expect(foreignSet({ contentSet: "", section: 1 }, "tech-zh")).toBeNull();
  });

  test("another board is named, and named back", () => {
    expect(foreignSet({ contentSet: "pitch-zh", section: 1 }, "tech-zh")).toBe(
      "pitch-zh",
    );
    expect(foreignSet({ contentSet: "pitch-zh/", section: 1 }, "tech-zh")).toBe(
      "pitch-zh",
    );
    // A root board (no content-set directories) is still a board: an
    // address for a named set is not about it.
    expect(foreignSet({ contentSet: "pitch-zh" }, "")).toBe("pitch-zh");
    expect(foreignSet({ contentSet: "pitch-zh" }, null)).toBe("pitch-zh");
  });

  test("junk is not a board (the check never throws)", () => {
    expect(foreignSet(null, "tech-zh")).toBeNull();
    expect(foreignSet(undefined, "tech-zh")).toBeNull();
    expect(foreignSet({ contentSet: 7 } as never, "tech-zh")).toBeNull();
    expect(foreignSet({ contentSet: "///" }, "tech-zh")).toBeNull();
  });
});

describe("stepKey / parseStepKey — the click handle on the DOM", () => {
  test("round-trips every address on the board", () => {
    for (let s = 0; s < lecture.sections.length; s++) {
      const section = lecture.sections[s]!;
      const refs: StepRef[] = section.heading ? [{ section: s, step: -1 }] : [];
      section.steps.forEach((_, i) => refs.push({ section: s, step: i }));
      for (const ref of refs) {
        expect(parseStepKey(stepKey(ref))).toEqual(ref);
      }
    }
  });

  test("a section title's -1 survives the string trip", () => {
    expect(stepKey({ section: 3, step: -1 })).toBe("3:-1");
    expect(parseStepKey("3:-1")).toEqual({ section: 3, step: -1 });
  });

  test("anything malformed resolves to nothing, never to step 0", () => {
    for (const junk of ["", "1", "a:b", "1:2:3", "1:", ":2", "-2:0", "1:-2"]) {
      expect(parseStepKey(junk)).toBeNull();
    }
    expect(parseStepKey(null)).toBeNull();
    expect(parseStepKey(undefined)).toBeNull();
  });
});

describe("describeStep — lecture words only (T6-review word purity)", () => {
  const BANNED = BANNED_WORDS;

  test("every kind the parser can produce has a description", () => {
    const kinds: Step["kind"][] = [
      "heading",
      "prose",
      "list-item",
      "aside",
      "rule",
      "chart-frame",
      "chart-layer",
      "image",
      "html",
      "math",
      "wait",
      "backref",
      "bad",
    ];
    for (const kind of kinds) {
      const step = { kind, action: "circle" } as unknown as Step;
      const words = describeStep(step);
      expect(words.length).toBeGreaterThan(0);
      expect(EXPLAIN_KINDS).toContain(words);
    }
  });

  test("no rendering vocabulary anywhere in the table", () => {
    for (const words of EXPLAIN_KINDS) {
      for (const banned of BANNED) {
        expect(words.toLowerCase()).not.toContain(banned);
      }
    }
  });

  test("a crossed-out look-back reads as a correction, not as emphasis", () => {
    const strike = { kind: "backref", action: "strike" } as unknown as Step;
    const circle = { kind: "backref", action: "circle" } as unknown as Step;
    expect(describeStep(strike)).not.toBe(describeStep(circle));
    expect(describeStep(strike)).toContain("correct");
  });

  test("the board's real steps describe themselves", () => {
    expect(describeStep(lecture.sections[1]!.heading!)).toBe("section title");
    const chart = findRef((s) => s.kind === "chart-frame");
    expect(describeStep(lecture.sections[chart.section]!.steps[chart.step]!))
      .toBe("chart");
  });
});

describe("summarizeStep — a readable anchor, not just an index", () => {
  test("prose summarizes as its own words", () => {
    const ref = findRef(
      (s) => s.kind === "prose" && s.srcSpan.start > SOURCE.indexOf("## Supply"),
    );
    const summary = summarizeStep(
      lecture.sections[ref.section]!.steps[ref.step]!,
    );
    expect(summary).toContain("Data-centre revenue tripled");
    // Dialect marks are the agent's syntax, not what the user sees written.
    expect(summary).not.toContain("==");
  });

  test("a chart summarizes as its name and its series", () => {
    const ref = findRef((s) => s.kind === "chart-frame");
    const summary = summarizeStep(
      lecture.sections[ref.section]!.steps[ref.step]!,
    );
    expect(summary).toContain("revenue");
    expect(summary).toContain("NVIDIA");
  });

  test("a look-back summarizes as the words it points back at", () => {
    const ref = findRef((s) => s.kind === "backref");
    const summary = summarizeStep(
      lecture.sections[ref.section]!.steps[ref.step]!,
    );
    expect(summary).toContain("87.4B");
  });

  test("long steps are cut to a readable length with an ellipsis", () => {
    const long = parseLecture(`${"word ".repeat(200)}\n`);
    const summary = summarizeStep(long.sections[0]!.steps[0]!);
    expect(summary.length).toBeLessThanOrEqual(121);
    expect(summary.endsWith("…")).toBe(true);
  });

  test("every step of the board produces a non-empty summary", () => {
    for (const section of lecture.sections) {
      for (const step of [
        ...(section.heading ? [section.heading] : []),
        ...section.steps,
      ]) {
        expect(summarizeStep(step).length).toBeGreaterThan(0);
      }
    }
  });

  test("the summaries this mode writes itself carry no rendering words", () => {
    // Board CONTENT is the agent's own prose and is quoted verbatim — the
    // purity rule binds the words the MODE authors. Those are the
    // content-free summaries: a break, a pause, a look-back.
    const authored = [
      summarizeStep({ kind: "rule" } as unknown as Step),
      summarizeStep({ kind: "wait" } as unknown as Step),
      summarizeStep({ kind: "wait", seconds: 2 } as unknown as Step),
    ];
    for (const summary of authored) {
      for (const banned of BANNED_WORDS) {
        expect(summary.toLowerCase()).not.toContain(banned);
      }
    }
  });
});

describe("revealStatus vocabulary", () => {
  test("every status is a lecture word", () => {
    const statuses = ["shown", "showing", "upcoming", "never written"];
    for (const status of statuses) {
      for (const banned of BANNED_WORDS) {
        expect(status).not.toContain(banned);
      }
    }
  });
});

describe("stepWindow / revealStatus — where a step sits in the lecture", () => {
  const proseRef = findRef(
    (s) => s.kind === "prose" && s.srcSpan.start > SOURCE.indexOf("## Supply"),
  );

  test("a performed step has a window inside the canonical duration", () => {
    const window = stepWindow(timeline.schedule, proseRef)!;
    expect(window).not.toBeNull();
    expect(window.start).toBeGreaterThanOrEqual(0);
    expect(window.end).toBeGreaterThan(window.start);
    expect(window.end).toBeLessThanOrEqual(timeline.duration);
  });

  test("before / during / after map to upcoming / showing / shown", () => {
    const window = stepWindow(timeline.schedule, proseRef)!;
    expect(revealStatus(timeline.schedule, proseRef, 0)).toBe("upcoming");
    expect(
      revealStatus(timeline.schedule, proseRef, (window.start + window.end) / 2),
    ).toBe("showing");
    expect(revealStatus(timeline.schedule, proseRef, timeline.duration)).toBe(
      "shown",
    );
  });

  test("the exact end of the window already counts as written", () => {
    const window = stepWindow(timeline.schedule, proseRef)!;
    expect(revealStatus(timeline.schedule, proseRef, window.end)).toBe("shown");
  });

  test("a step the board never performs says so — it is not 'upcoming'", () => {
    // An embedded block, not a picture: a picture has been drawn since
    // 2026-08-13 and has a window like any other block (asserted below).
    const html = findRef((s) => s.kind === "html");
    expect(stepWindow(timeline.schedule, html)).toBeNull();
    expect(revealStatus(timeline.schedule, html, 0)).toBe("never written");
    expect(revealStatus(timeline.schedule, html, timeline.duration)).toBe(
      "never written",
    );
  });

  test("a picture has a window of its own — it is performed", () => {
    const image = findRef((s) => s.kind === "image");
    const window = stepWindow(timeline.schedule, image)!;
    expect(window).not.toBeNull();
    expect(window.end).toBeGreaterThan(window.start);
    expect(revealStatus(timeline.schedule, image, 0)).toBe("upcoming");
    expect(revealStatus(timeline.schedule, image, window.end)).toBe("shown");
  });

  test("an explicit pause is time without writing — also never written", () => {
    const wait = findRef((s) => s.kind === "wait");
    expect(revealStatus(timeline.schedule, wait, 0)).toBe("never written");
  });
});

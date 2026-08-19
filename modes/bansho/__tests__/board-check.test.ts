/**
 * T6 — the board's self-check loop: what `check-board` reports back and
 * what the board tells the agent on its own (§9 notifications).
 *
 * Bar:
 *  - `check-board` is the COMPLETE inventory of everything the board could
 *    not perform — unreadable blocks, quoted look-backs and chart names
 *    that matched nothing, formulas that failed to render, lines wider
 *    than the board, and steps this version simply does not perform. Every
 *    finding names an address the agent can navigate to and a readable
 *    excerpt, otherwise the report is unactionable;
 *  - notifications fire on TRANSITIONS, never once per recompile — an
 *    agent editing a board rebuilds it dozens of times per turn, and one
 *    warning per rebuild is spam that trains the agent to ignore the
 *    channel;
 *  - a fixed board CLEARS its warning (info + `replaces`, the queue's pure
 *    clear signal), so a stale warning can never reach the agent after the
 *    condition is gone;
 *  - the wording is lecture vocabulary (T6-review word purity).
 */

import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

import { parseLecture } from "../domain.js";
import type { StepRef } from "../engine/types.js";
import { readMathErrors } from "../viewer/BoardCanvas.js";
import { detectCollisions } from "../engine/regions.js";
import {
  BURST_MARK_NOTE,
  CLAIM_VS_INK_NOTE,
  collectFindings,
  deriveCollisionNotification,
  deriveNotifications,
  REGION_BURST_SENTENCE,
  reportBoardCheck,
  rightOverflows,
  TURN_ON_FULL_WALL_MESSAGE,
  type BoardFinding,
  type OverflowObservation,
} from "../viewer/board-check.js";
import { BANNED_WORDS } from "./vocabulary.js";

const CLEAN = `# A clean board

One paragraph, nothing wrong with it.
`;

const BROKEN = `# A board with problems

Revenue tripled last year.

@circle "a phrase that was never written"

\`\`\`chart missing
+ series that has no home: 1 2 3
\`\`\`

\`\`\`html
<b>an embedded block</b>
\`\`\`
`;

const MATHY = `# A board with a formula

The ceiling is set by the serial fraction.

$$S(n) = \\frac{1}{(1-p) + p/n}$$
`;

const clean = parseLecture(CLEAN);
const broken = parseLecture(BROKEN);
const mathy = parseLecture(MATHY);

const codesOf = (findings: readonly BoardFinding[]): string[] =>
  findings.map((f) => f.code);

describe("collectFindings — everything the board could not perform", () => {
  test("a clean board reports nothing", () => {
    expect(collectFindings(clean, { mathErrors: [], overflowing: [] })).toEqual(
      [],
    );
  });

  test("an unresolvable look-back is reported as a missed reference", () => {
    const findings = collectFindings(broken, {
      mathErrors: [],
      overflowing: [],
    });
    expect(codesOf(findings)).toContain("refUnresolved");
  });

  test("a step this version does not perform is reported, not hidden", () => {
    const findings = collectFindings(broken, {
      mathErrors: [],
      overflowing: [],
    });
    expect(codesOf(findings)).toContain("unsupportedStep");
  });

  test("every finding carries an address and readable words", () => {
    const findings = collectFindings(broken, {
      mathErrors: [],
      overflowing: [],
    });
    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) {
      expect(typeof finding.message).toBe("string");
      expect(finding.message.length).toBeGreaterThan(0);
      if (finding.address) {
        expect(Number.isInteger(finding.address.section)).toBe(true);
      }
    }
  });

  test("a formula that failed to render is addressed and quoted", () => {
    // T7-review F2: this was the one finding that came back with neither —
    // just "1 formula could not be written out", which the agent could
    // read and not act on. The step it sits in IS the address: a formula
    // can be inline, so there is nothing finer to name.
    const findings = collectFindings(mathy, {
      mathErrors: [{ section: 0, step: 1 }],
      overflowing: [],
    });
    expect(codesOf(findings)).toEqual(["mathRenderError"]);
    expect(findings[0]!.address).toEqual({ section: 0, step: 2 });
    expect(findings[0]!.excerpt).toContain("frac");
  });

  test("two failed formulas in one step are two findings, not one count", () => {
    const ref: StepRef = { section: 0, step: 1 };
    const findings = collectFindings(mathy, {
      mathErrors: [ref, ref],
      overflowing: [],
    });
    expect(codesOf(findings)).toEqual(["mathRenderError", "mathRenderError"]);
  });

  test("a formula the board could not place is reported, never dropped", () => {
    const findings = collectFindings(clean, {
      mathErrors: [],
      unplacedMathErrors: 2,
      overflowing: [],
    });
    expect(codesOf(findings)).toEqual(["mathRenderError"]);
    expect(findings[0]!.address).toBeUndefined();
    expect(findings[0]!.message).toContain("2");
  });

  test("lines too wide for the board are reported with their address", () => {
    const ref: StepRef = { section: 0, step: 0 };
    const findings = collectFindings(clean, {
      mathErrors: [],
      overflowing: [{ edge: "right", ref, overBy: 40 }],
    });
    expect(codesOf(findings)).toEqual(["boardOverflow"]);
    expect(findings[0]!.address).toEqual({ section: 0, step: 1 });
    expect(findings[0]!.excerpt).toContain("One paragraph");
  });

  test("a width overflow says how far over, and names the token to break", () => {
    const ref: StepRef = { section: 0, step: 0 };
    const [finding] = collectFindings(clean, {
      mathErrors: [],
      overflowing: [
        {
          edge: "right",
          ref,
          overBy: 1333,
          culprit: { kind: "token", text: "VeryLongConfigurationKey" },
        },
      ],
    });
    // The three things a fix needs: the amount, the responsible piece,
    // and the lever — not "edit board.md".
    expect(finding!.message).toContain("1333px");
    expect(finding!.message).toContain("right edge");
    expect(finding!.message).toContain('"VeryLongConfigurationKey"');
    expect(finding!.message).toContain("Break it");
  });

  test("an over-wide inline formula is told the display-formula move", () => {
    const ref: StepRef = { section: 0, step: 0 };
    const [finding] = collectFindings(clean, {
      mathErrors: [],
      overflowing: [
        { edge: "right", ref, overBy: 135, culprit: { kind: "formula" } },
      ],
    });
    expect(finding!.message).toContain("135px");
    expect(finding!.message).toContain("$$");
    expect(finding!.message).toContain("never wraps");
  });

  test("a width overflow nobody could attribute says so instead of guessing", () => {
    const ref: StepRef = { section: 0, step: 0 };
    const [finding] = collectFindings(clean, {
      mathErrors: [],
      overflowing: [{ edge: "right", ref, overBy: 90 }],
    });
    expect(finding!.code).toBe("boardOverflow");
    expect(finding!.message).toContain("90px");
    // The honest fallback: the writing itself is the widest thing the
    // board knows of on a prose step.
    expect(finding!.message.length).toBeGreaterThan(40);
  });

  test("a step taller than one board is a bottom-edge sentence, not a right-edge one", () => {
    const ref: StepRef = { section: 0, step: 0 };
    const [finding] = collectFindings(clean, {
      mathErrors: [],
      overflowing: [{ edge: "bottom", ref, overBy: 150, cause: "step" }],
    });
    expect(finding!.code).toBe("boardOverflow");
    expect(finding!.message).toContain("150px");
    expect(finding!.message).toContain("taller");
    expect(finding!.message).toContain("bottom edge");
    expect(finding!.message).not.toContain("right edge");
    // The lever for a too-tall step is splitting, so the flow can carry on.
    expect(finding!.message).toContain("Split");
  });

  test("a layer that grew past the board's bottom edge names the growth", () => {
    const ref: StepRef = { section: 0, step: 0 };
    const [finding] = collectFindings(clean, {
      mathErrors: [],
      overflowing: [{ edge: "bottom", ref, overBy: 100, cause: "growth" }],
    });
    expect(finding!.code).toBe("boardOverflow");
    expect(finding!.message).toContain("100px");
    expect(finding!.message).toContain("@turn");
    expect(finding!.message).not.toContain("right edge");
  });

  test("ink aimed at erased writing is a loud refUnresolved finding with its own sentence (review P1-1)", () => {
    // 甲 erased, then circled: the fold orphans the circle (its home run
    // is closed) and the host reports it here — the one wrong answer is
    // the circle silently never appearing.
    const src = '甲要点先立住。\n\n@erase\n\n@circle "甲要点"\n';
    const lecture = parseLecture(src);
    expect(lecture.errors).toEqual([]); // the quote itself resolved fine
    const findings = collectFindings(lecture, {
      mathErrors: [],
      overflowing: [],
      inkAfterErase: [{ section: 0, step: 2 }],
    });
    expect(codesOf(findings)).toEqual(["refUnresolved"]);
    expect(findings[0]!.address).toEqual({ section: 0, step: 3 });
    // Its OWN sentence — the stock refUnresolved wording would tell the
    // agent the quote failed, which is exactly wrong here.
    expect(findings[0]!.message).toContain("erased");
    // …and refUnresolved is a notified kind: the board interrupts.
    const { notifications } = deriveNotifications(new Set(), findings);
    expect(notifications.length).toBe(1);
  });

  test("no rendering vocabulary in anything the agent reads", () => {
    const findings = collectFindings(broken, {
      mathErrors: [{ section: 0, step: 0 }],
      // Every overflow branch that speaks: token, formula, bare width,
      // too-tall, and growth — the new sentences say the most, so they
      // are the most able to say it in the wrong dialect.
      overflowing: [
        {
          edge: "right",
          ref: { section: 0, step: 0 },
          overBy: 633,
          culprit: { kind: "token", text: "VeryLongToken" },
        },
        {
          edge: "right",
          ref: { section: 0, step: 0 },
          overBy: 135,
          culprit: { kind: "formula" },
        },
        { edge: "right", ref: { section: 0, step: 0 }, overBy: 90 },
        { edge: "bottom", ref: { section: 0, step: 0 }, overBy: 150, cause: "step" },
        { edge: "bottom", ref: { section: 0, step: 0 }, overBy: 100, cause: "growth" },
      ],
      inkAfterErase: [{ section: 0, step: 0 }],
      // W8 — the burst's two branches say the most, so they are the most
      // able to say it in the wrong dialect. A cut burst reaches both the
      // consequence sentence and the ways out.
      bursts: [
        {
          panel: 0,
          region: "left",
          name: "left",
          key: "0:1",
          overflow: 120,
          frameHeight: 794,
          frame: { x: 0, y: 0, w: 577, h: 794 },
          cut: 120,
        },
      ],
    });
    for (const finding of findings) {
      const text = `${finding.message} ${finding.excerpt ?? ""}`.toLowerCase();
      for (const banned of BANNED_WORDS) {
        // Board CONTENT is quoted verbatim; the fixtures deliberately
        // contain none of the banned words, so any hit is ours.
        expect(text).not.toContain(banned);
      }
    }
  });
});

// M4 — the one place `check-board` was caught saying "nothing failed"
// about a board that had lost a whole annotation. The row parses, the
// block is healthy, the chart draws — and the label was never written,
// because "2023Q3" is not a place the board can find on that x axis. The
// only signal was a developer-console warning, which neither the user nor
// the agent ever sees, so `check-board` answered ok:true.
describe("an annotation the board cannot place is reported, not swallowed", () => {
  const QUARTERS = `# 季度

\`\`\`chart 季度
x: 2023Q1 .. 2024Q4
y: 0 .. 40
+ 系列: 7 10 14 18 22 26 30 35
+ mark 系列 @ 2023Q3 : "拐点"
\`\`\`
`;
  const lecture = parseLecture(QUARTERS);
  const findings = collectFindings(lecture, { mathErrors: [], overflowing: [] });

  test("check-board says the board is NOT clean", () => {
    const report = reportBoardCheck(findings);
    expect(report.ok).toBe(false);
    expect(report.findings.length).toBe(1);
  });

  test("the finding names the row the agent wrote, and where it sits", () => {
    const finding = findings[0]!;
    expect(finding.code).toBe("refUnresolved");
    expect(finding.excerpt).toContain("2023Q3");
    expect(finding.excerpt).toContain("拐点");
    // Addressed like every other finding — `navigate-to` takes this.
    expect(finding.address).toBeDefined();
    expect(Number.isInteger(finding.address!.section)).toBe(true);
  });

  test("the same row with an anchor the axis HAS is not reported", () => {
    // The endpoint is on the axis, exactly as written — this is the form
    // the reference teaches, and it must stay silent.
    const ok = parseLecture(QUARTERS.replace("@ 2023Q3", "@ 2024Q4"));
    expect(collectFindings(ok, { mathErrors: [], overflowing: [] })).toEqual([]);
  });

  test("a series name that is nowhere on the chart is reported too", () => {
    // Same invisible path: the label mounts nowhere, the block stays
    // healthy. A typo'd series name must not read as a clean board either.
    const typo = parseLecture(QUARTERS.replace("mark 系列 @ 2023Q3", "mark 系別 @ 2024Q4"));
    const f = collectFindings(typo, { mathErrors: [], overflowing: [] });
    expect(f.map((x) => x.code)).toEqual(["refUnresolved"]);
    expect(f[0]!.excerpt).toContain("系別");
  });

  test("an annotation in a LATER block is reported against that block", () => {
    // The shape the §4.2 board uses: axes, then a series, then the mark —
    // three blocks. The series it names IS on the chart (declared a block
    // earlier, which is why the check accumulates across blocks), so the
    // only thing wrong is where the mark points. The address has to be the
    // block the agent wrote it in, or "go fix it" points at the axes.
    const lecture = parseLecture(`# 季度

\`\`\`chart 季度
x: 2023Q1 .. 2024Q4
y: 0 .. 40
\`\`\`

\`\`\`chart 季度
+ 系列: 7 10 14 18 22 26 30 35
\`\`\`

\`\`\`chart 季度
+ mark 系列 @ 2023Q3 : "拐点"
\`\`\`
`);
    const findings = collectFindings(lecture, { mathErrors: [], overflowing: [] });
    expect(findings.map((f) => f.code)).toEqual(["refUnresolved"]);
    expect(findings[0]!.excerpt).toContain("2023Q3");
    // Third block of the section, not the first.
    expect(findings[0]!.address).toEqual({ section: 0, step: 3 });
  });

  test("a free note whose height is not a number is reported too", () => {
    const bad = parseLecture(
      QUARTERS.replace('+ mark 系列 @ 2023Q3 : "拐点"', '+ note @ 2024Q4 , 40abc : "假高度"'),
    );
    const f = collectFindings(bad, { mathErrors: [], overflowing: [] });
    expect(f.map((x) => x.code)).toEqual(["refUnresolved"]);
    expect(f[0]!.excerpt).toContain("40abc");
  });
});

describe("reportBoardCheck — the agent-facing answer", () => {
  test("a clean board says so in one line", () => {
    const report = reportBoardCheck([]);
    expect(report.ok).toBe(true);
    expect(report.summary.toLowerCase()).toContain("nothing");
    expect(report.findings).toEqual([]);
  });

  test("a broken board counts its problems and keeps them structured", () => {
    const findings = collectFindings(broken, {
      mathErrors: [],
      overflowing: [],
    });
    const report = reportBoardCheck(findings);
    expect(report.ok).toBe(false);
    expect(report.findings.length).toBe(findings.length);
    expect(report.summary).toContain(String(findings.length));
  });
});

// `readMathErrors` reads the LIVE board — the only place "this formula did
// not come out" exists — so it gets a real (happy-dom) DOM, built the way
// BoardCanvas builds one: a step node per address, stamped with
// `data-bansho-ref`, the failure markup nested inside it.
describe("readMathErrors — a failed formula knows which step it is in", () => {
  const boardWith = (html: string): HTMLElement => {
    const doc = new Window().document as unknown as Document;
    const board = doc.createElement("div");
    board.innerHTML = html;
    doc.body.appendChild(board);
    return board;
  };

  test("KaTeX's own error markup is attributed to its step", () => {
    // The COMMON failure: a malformed body never throws
    // (`throwOnError: false`) — KaTeX returns `.katex-error` markup and the
    // raw TeX shows in red on the board.
    const board = boardWith(
      `<p data-bansho-ref="1:2"><span class="katex-error">\\frac{1}{</span></p>`,
    );
    expect(readMathErrors(board)).toEqual({
      mathErrors: [{ section: 1, step: 2 }],
      unplacedMathErrors: 0,
    });
  });

  test("a hard render failure counts the same, from the same step", () => {
    const board = boardWith(
      `<div data-bansho-ref="0:0" data-bansho-math-error>$x$</div>`,
    );
    expect(readMathErrors(board)).toEqual({
      mathErrors: [{ section: 0, step: 0 }],
      unplacedMathErrors: 0,
    });
  });

  test("two failures in one step are two entries, in document order", () => {
    const board = boardWith(
      `<p data-bansho-ref="0:1"><span class="katex-error">a</span></p>` +
        `<p data-bansho-ref="0:3"><span class="katex-error">b</span>` +
        `<span class="katex-error">c</span></p>`,
    );
    expect(readMathErrors(board).mathErrors).toEqual([
      { section: 0, step: 1 },
      { section: 0, step: 3 },
      { section: 0, step: 3 },
    ]);
  });

  test("a clean board reports nothing at all", () => {
    expect(readMathErrors(boardWith(`<p data-bansho-ref="0:0">fine</p>`)))
      .toEqual({ mathErrors: [], unplacedMathErrors: 0 });
  });

  test("a failure with no step above it is counted, never dropped", () => {
    const board = boardWith(`<span class="katex-error">orphan</span>`);
    expect(readMathErrors(board)).toEqual({
      mathErrors: [],
      unplacedMathErrors: 1,
    });
  });
});

describe("rightOverflows — the classifier, measured elsewhere", () => {
  const ref = (step: number): StepRef => ({ section: 0, step });

  test("content wider than its box overflows, with the amount", () => {
    expect(
      rightOverflows([
        { ref: ref(0), scrollWidth: 900, clientWidth: 800 },
        { ref: ref(1), scrollWidth: 800, clientWidth: 800 },
      ]),
    ).toEqual([{ edge: "right", ref: ref(0), overBy: 100 }]);
  });

  test("sub-pixel rounding is not an overflow", () => {
    expect(
      rightOverflows([{ ref: ref(0), scrollWidth: 801, clientWidth: 800 }]),
    ).toEqual([]);
  });

  test("an unmeasured box (no layout yet) is never reported", () => {
    expect(
      rightOverflows([{ ref: ref(0), scrollWidth: 0, clientWidth: 0 }]),
    ).toEqual([]);
  });

  test("a back-reference overlay bleeding past the box is not an overflow", () => {
    // The measured false positive (2026-08-19, tech-zh seed live in
    // Chromium): the @strike target's box is a 565px column, and the W3
    // re-based overlay inside it is the panel's full 1242px on purpose —
    // its ink has to land in panel coordinates. scrollWidth reads 1198,
    // "633px over", while every written word fits and the strike sits
    // exactly on its target. Decoration that is DESIGNED to bleed must
    // not accuse the writing it decorates.
    expect(
      rightOverflows([
        {
          ref: ref(0),
          scrollWidth: 1198,
          clientWidth: 565,
          parts: [{ classes: "bansho-backref", right: 1198 }],
        },
      ]),
    ).toEqual([]);
  });

  test("in-place mark overlays are decoration too", () => {
    expect(
      rightOverflows([
        {
          ref: ref(0),
          scrollWidth: 700,
          clientWidth: 565,
          parts: [
            { classes: "bansho-ink-under", right: 700 },
            { classes: "bansho-ink-over", right: 700 },
          ],
        },
      ]),
    ).toEqual([]);
  });

  test("an unbreakable token is the culprit, measured by its own edge", () => {
    // The measured true positive (same board): a 1898px token span in a
    // 565px column. The amount is the CONTENT's overrun, not scrollWidth's.
    expect(
      rightOverflows([
        {
          ref: ref(0),
          scrollWidth: 1898,
          clientWidth: 565,
          parts: [
            { classes: "bansho-text", right: 1898, text: "配置项 VeryLongKey 决定这个行为。" },
            { classes: "bansho-w", right: 1898, text: "VeryLongKey" },
          ],
        },
      ]),
    ).toEqual([
      {
        edge: "right",
        ref: ref(0),
        overBy: 1333,
        culprit: { kind: "token", text: "VeryLongKey" },
      },
    ]);
  });

  test("a text-length tie names the deepest part — the token, not its wrapper", () => {
    // Seen live: the host caps part text at 80 chars, so a paragraph
    // wrapper and the token span inside it can read the same length. The
    // walk is parent-then-child, so the later part is the tighter box.
    expect(
      rightOverflows([
        {
          ref: ref(0),
          scrollWidth: 1898,
          clientWidth: 565,
          parts: [
            { classes: "bansho-text", right: 1898, text: "配置项 VeryLongToken 决定" },
            { classes: "bansho-w", right: 1898, text: "VeryLongTokenItself…" },
          ],
        },
      ]),
    ).toEqual([
      {
        edge: "right",
        ref: ref(0),
        overBy: 1333,
        culprit: { kind: "token", text: "VeryLongTokenItself…" },
      },
    ]);
  });

  test("content still accuses when decoration bleeds beside it", () => {
    expect(
      rightOverflows([
        {
          ref: ref(0),
          scrollWidth: 1198,
          clientWidth: 565,
          parts: [
            { classes: "bansho-backref", right: 1198 },
            { classes: "bansho-w", right: 800, text: "LongToken" },
          ],
        },
      ]),
    ).toEqual([
      {
        edge: "right",
        ref: ref(0),
        overBy: 235,
        culprit: { kind: "token", text: "LongToken" },
      },
    ]);
  });

  test("an inline formula crossing the edge is named a formula", () => {
    expect(
      rightOverflows([
        {
          ref: ref(0),
          scrollWidth: 700,
          clientWidth: 565,
          parts: [
            { classes: "bansho-math bansho-math-inline", right: 700 },
          ],
        },
      ]),
    ).toEqual([
      { edge: "right", ref: ref(0), overBy: 135, culprit: { kind: "formula" } },
    ]);
  });

  test("a walked step with nothing attributable keeps its finding, honestly", () => {
    // The raw numbers flagged it and the walk found no crossing part at
    // all — the one wrong answer is silence, so the finding stays, with
    // no culprit invented.
    expect(
      rightOverflows([
        { ref: ref(0), scrollWidth: 900, clientWidth: 800, parts: [] },
      ]),
    ).toEqual([{ edge: "right", ref: ref(0), overBy: 100 }]);
  });
});

describe("deriveNotifications — transitions, not repetitions", () => {
  const finding = (
    code: BoardFinding["code"],
    step: number,
  ): BoardFinding => ({
    code,
    address: { section: 0, step },
    message: `problem at step ${step}`,
  });

  test("the first appearance of a problem is announced", () => {
    const { notifications } = deriveNotifications(new Set(), [
      finding("refUnresolved", 1),
    ]);
    expect(notifications.length).toBe(1);
    expect(notifications[0]!.type).toBe("refUnresolved");
    expect(notifications[0]!.severity).toBe("warning");
  });

  test("the same problem on the next rebuild is silent", () => {
    const first = deriveNotifications(new Set(), [finding("refUnresolved", 1)]);
    const second = deriveNotifications(first.seen, [finding("refUnresolved", 1)]);
    expect(second.notifications).toEqual([]);
    expect(second.seen).toEqual(first.seen);
  });

  test("a NEW problem of an already-reported kind is announced again", () => {
    const first = deriveNotifications(new Set(), [finding("refUnresolved", 1)]);
    const second = deriveNotifications(first.seen, [
      finding("refUnresolved", 1),
      finding("refUnresolved", 2),
    ]);
    expect(second.notifications.length).toBe(1);
    // Fresher information supersedes the queued older warning.
    expect(second.notifications[0]!.replaces).toEqual(["refUnresolved"]);
  });

  test("one notification per kind, however many problems of that kind", () => {
    const { notifications } = deriveNotifications(new Set(), [
      finding("refUnresolved", 1),
      finding("refUnresolved", 2),
      finding("stepParseError", 3),
    ]);
    expect(notifications.map((n) => n.type).sort()).toEqual([
      "refUnresolved",
      "stepParseError",
    ]);
  });

  test("fixing the board clears the warning instead of leaving it queued", () => {
    const first = deriveNotifications(new Set(), [finding("boardOverflow", 1)]);
    const cleared = deriveNotifications(first.seen, []);
    expect(cleared.notifications.length).toBe(1);
    const clear = cleared.notifications[0]!;
    expect(clear.type).toBe("boardOverflow");
    expect(clear.severity).toBe("info");
    expect(clear.replaces).toEqual(["boardOverflow"]);
    expect(cleared.seen.size).toBe(0);
  });

  test("a board that was clean and stays clean says nothing", () => {
    const { notifications, seen } = deriveNotifications(new Set(), []);
    expect(notifications).toEqual([]);
    expect(seen.size).toBe(0);
  });

  test("only the three declared kinds ever reach the agent (§9)", () => {
    const { notifications } = deriveNotifications(new Set(), [
      finding("refUnresolved", 1),
      finding("stepParseError", 2),
      finding("boardOverflow", 3),
      // Not one of the three: a v1 boundary and a render failure are
      // reported by `check-board`, but they are not the board interrupting
      // the agent.
      finding("unsupportedStep", 4),
      finding("mathRenderError", 5),
    ]);
    expect(notifications.map((n) => n.type).sort()).toEqual([
      "boardOverflow",
      "refUnresolved",
      "stepParseError",
    ]);
  });

  test("what the agent reads is lecture vocabulary", () => {
    const { notifications } = deriveNotifications(new Set(), [
      finding("refUnresolved", 1),
      finding("stepParseError", 2),
      finding("boardOverflow", 3),
    ]);
    for (const n of notifications) {
      const text = `${n.message} ${n.summary ?? ""}`.toLowerCase();
      for (const banned of BANNED_WORDS) {
        expect(text).not.toContain(banned);
      }
    }
  });

  test("the warning carries each finding's own sentence, not just its address", () => {
    // The owner watched an agent receive "1 spot … run past the right
    // edge" with an address and an excerpt and churn for a long time: the
    // channel had dropped the finding's message — the amount, the culprit,
    // the lever — on the floor. The notification is the agent's only
    // unasked sense; it must carry what a fix needs.
    const overflowing: OverflowObservation[] = [
      {
        edge: "right",
        ref: { section: 0, step: 0 },
        overBy: 1333,
        culprit: { kind: "token", text: "VeryLongConfigurationKey" },
      },
    ];
    const findings = collectFindings(clean, { mathErrors: [], overflowing });
    const { notifications } = deriveNotifications(new Set(), findings);
    expect(notifications.length).toBe(1);
    const message = notifications[0]!.message;
    expect(message).toContain("1333px");
    expect(message).toContain('"VeryLongConfigurationKey"');
    expect(message).toContain("Break it");
    // …and still says where, and what stands written there.
    expect(message).toContain("the opening, step 1");
    expect(message).toContain("One paragraph");
  });

  test("a changed overflow amount does not re-announce the same spot", () => {
    // The amount lives in the MESSAGE, never in the identity: a rebuild
    // that re-measures 633 as 634 must stay silent, or the channel trains
    // the agent to ignore it (the transitions bar above).
    const at = (overBy: number): OverflowObservation[] => [
      { edge: "right", ref: { section: 0, step: 0 }, overBy },
    ];
    const first = deriveNotifications(
      new Set(),
      collectFindings(clean, { mathErrors: [], overflowing: at(633) }),
    );
    expect(first.notifications.length).toBe(1);
    const second = deriveNotifications(
      first.seen,
      collectFindings(clean, { mathErrors: [], overflowing: at(634) }),
    );
    expect(second.notifications).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Canvas pivot V2 (§5) — what the room stopped preventing
// ────────────────────────────────────────────────────────────────────────────

describe("the three V2 codes: collision, burst, and a turn with nowhere to go", () => {
  const LECTURE = parseLecture(
    "@board 2\n\n# 题\n\n甲段落。\n\n乙段落。\n\n丙段落。\n",
  );
  // 0:0 board-config, 0:-1 heading, 0:1 甲, 0:2 乙, 0:3 丙.
  const boxAt = (
    key: string,
    region: string,
    rect: { x: number; y: number; w: number; h: number },
  ) => ({ key, panel: 0, region, rect });

  test("a collision names both parties, the overlap, and the three ways out", () => {
    const hits = detectCollisions([
      boxAt("0:1", "full", { x: 0, y: 0, w: 1000, h: 200 }),
      boxAt("0:2", "top-right", { x: 512, y: 100, w: 488, h: 200 }),
    ]);
    expect(hits).toHaveLength(1);
    const findings = collectFindings(LECTURE, {
      mathErrors: [],
      overflowing: [],
      collisions: hits,
    });
    expect(codesOf(findings)).toEqual(["regionCollision"]);
    const message = findings[0]!.message;
    expect(message).toContain("On board 1, top-right overlaps full by");
    // The claim-vs-ink honesty, verbatim — the flow is one of the two, so
    // the report must not let the agent read a claim as a fact about ink.
    expect(message).toContain(CLAIM_VS_INK_NOTE);
    expect(message).toContain('Erase one of them (@erase "锚")');
    expect(message).toContain("rewrite the unperformed one under a different region word");
    expect(message).toContain("leave it if writing over is what you meant");
    // It is addressed at the LATER of the two — the rewritable one.
    expect(findings[0]!.address).toEqual({ section: 0, step: 3 });
  });

  test("two named regions colliding get no claim-vs-ink note — neither one is the flow", () => {
    const hits = detectCollisions([
      boxAt("0:1", "top-left", { x: 0, y: 0, w: 488, h: 400 }),
      boxAt("0:2", "bottom-left", { x: 0, y: 312, w: 488, h: 200 }),
    ]);
    const findings = collectFindings(LECTURE, {
      mathErrors: [],
      overflowing: [],
      collisions: hits,
    });
    expect(findings[0]!.message).not.toContain(CLAIM_VS_INK_NOTE);
  });

  test("a burst that stays ON the board reports the numbers and the three ways out", () => {
    const findings = collectFindings(LECTURE, {
      mathErrors: [],
      overflowing: [],
      bursts: [
        {
          panel: 1,
          region: "top-left",
          name: "top-left",
          key: "0:2",
          overflow: 112,
          frameHeight: 288,
          frame: { x: 0, y: 0, w: 488, h: 288 },
          cut: 0,
        },
      ],
    });
    expect(codesOf(findings)).toEqual(["regionBurst"]);
    expect(findings[0]!.message).toBe(
      "On board 2, top-left holds 112px more writing than the 288px it has (39% over). It stands where it was put, over whatever is below it — nothing was moved and nothing was shrunk. Say less here, place it under a word with more room (a corner is a quarter of the board, left or right a half), or give the passage a board of its own with @turn.",
    );
  });

  // W8 — the finding that taught an agent to keep writing.
  //
  // The lecture that produced this fix measured its own overrun BEFORE
  // writing the board — its `plan.md` says 「数人头的叙述写到第三段就已经溢
  // 出 101px（regionBurst，照写不误）」, 照写不误 being a straight reading of
  // the old sentence's "It is written in full anyway". It then wrote the
  // passage, and two boards lost the end of a sentence to the panel's edge.
  // The numbers below are that lecture's, so the sentence this pins is the
  // sentence that author would have read.
  test("a burst the board's edge CUTS says so, and says it first", () => {
    const findings = collectFindings(LECTURE, {
      mathErrors: [],
      overflowing: [],
      bursts: [
        {
          panel: 0,
          region: "bottom",
          name: "bottom",
          key: "0:2",
          overflow: 101,
          frameHeight: 385,
          frame: { x: 0, y: 409, w: 1000, h: 385 },
          cut: 101,
        },
      ],
    });
    expect(codesOf(findings)).toEqual(["regionBurst"]);
    expect(findings[0]!.message).toBe(
      "On board 1, bottom holds 101px more writing than the 385px it has (26% over). The last 101px falls past the board's own bottom edge, and past that edge nothing is written — a reader watches the sentence stop in the middle. The board draws the cut line, so capture shows it too. Say less here, place it under a word with more room (a corner is a quarter of the board, left or right a half), or give the passage a board of its own with @turn.",
    );
    // The reassurance is gone from every burst sentence, and so is the one
    // way out that could not work: a named region never migrates, so two
    // shorter steps in the same frame stand exactly as tall as one long one.
    expect(findings[0]!.message).not.toContain("written in full anyway");
    expect(findings[0]!.message).not.toContain("split the step");
  });

  test("the room's own flow is told the two moves it has — never @turn", () => {
    // A `full` burst means the flow had nowhere to carry on to. There is no
    // wider word above `full`, and `@turn` into a full wall is a second
    // refusal (`turnOnFullWall`), so advising either would send the author
    // at a door the room has already closed.
    const findings = collectFindings(LECTURE, {
      mathErrors: [],
      overflowing: [],
      bursts: [
        {
          panel: 2,
          region: "full",
          name: "full",
          key: "0:3",
          overflow: 220,
          frameHeight: 794,
          frame: { x: 0, y: 0, w: 1000, h: 794 },
          cut: 220,
        },
      ],
    });
    const message = findings[0]!.message;
    expect(message).toContain("On board 3, full holds 220px more writing");
    expect(message).toContain('retire a finished board (@erase "锚")');
    expect(message).not.toContain("@turn");
    expect(message).not.toContain("a word with more room");
  });

  test("the mark the READER sees speaks the same dialect as the finding", () => {
    // The caption is delivered text like any other, and it lands on the
    // board itself — the one surface a human reads without asking for it.
    for (const banned of BANNED_WORDS) {
      expect(BURST_MARK_NOTE.toLowerCase()).not.toContain(banned);
    }
    // It reports; it does not scold and does not claim something broke.
    expect(BURST_MARK_NOTE).toBe(
      "the writing goes on below; the board does not",
    );
  });

  test("every burst sentence carries a way out, the whole table's shape", () => {
    // The finding that started W8 stated a property and stopped, so its
    // author read it as a recorded fact rather than something to answer.
    // `turnUnderfilled` is the shape: what happened, then what to do.
    expect(REGION_BURST_SENTENCE).toContain("Say less here");
    expect(REGION_BURST_SENTENCE).toContain("@turn");
  });

  test("a strip placement is named by its word AND its episode", () => {
    const findings = collectFindings(LECTURE, {
      mathErrors: [],
      overflowing: [],
      collisions: detectCollisions([
        boxAt("0:1", "right#2", { x: 512, y: 0, w: 488, h: 200 }),
        boxAt("0:2", "full", { x: 0, y: 100, w: 1000, h: 200 }),
      ]),
    });
    expect(findings[0]!.message).toContain("right (placement 2)");
  });

  test("a @turn on a full wall is a finding with the design's exact sentence — and it is NOT notified", () => {
    const findings = collectFindings(LECTURE, {
      mathErrors: [],
      overflowing: [],
      turnsOnFullWall: [{ section: 0, step: 3 }],
    });
    expect(codesOf(findings)).toEqual(["turnOnFullWall"]);
    expect(findings[0]!.message).toBe(TURN_ON_FULL_WALL_MESSAGE);
    // §5.5: it is a line in the script the author is looking at, and its
    // badge is already on screen — interrupting for it would be noise.
    const { notifications } = deriveNotifications(new Set(), findings);
    expect(notifications).toEqual([]);
  });

  test("a @turn that walks away from a barely-written board says the percentage — and does NOT interrupt", () => {
    // W2. The waste the room could not name before: a lecture that turns at
    // a fifth of a board spends four blackboards on one board's worth of
    // talk, and nobody standing inside the room can see it. The percentage
    // is in the sentence because "mostly empty" is an opinion and "18%" is
    // a reading the author can argue with.
    const findings = collectFindings(LECTURE, {
      mathErrors: [],
      overflowing: [],
      turnsUnderfilled: [{ ref: { section: 0, step: 3 }, fill: 0.18 }],
    });
    expect(codesOf(findings)).toEqual(["turnUnderfilled"]);
    expect(findings[0]!.message).toContain("18%");
    // ...and it teaches the way out, which is the thing the author does not
    // know: a face keeps taking writing after the first column.
    expect(findings[0]!.message).toContain("column");
    // A ref is 0-based and an ADDRESS is 1-based (`toAddress` adds the one),
    // so the step-3 ref above is the author's step 4 — the same conversion
    // every other finding in this file goes through, stated here because
    // this is the one case whose ref is hand-supplied rather than read off
    // the fixture.
    expect(findings[0]!.address).toEqual({ section: 0, step: 4 });
    // Same posture as `turnOnFullWall`: a line in the script, never an
    // interruption — it is a composition note, not a failure.
    const { notifications } = deriveNotifications(new Set(), findings);
    expect(notifications).toEqual([]);
  });

  test("neither collision nor burst interrupts through the FINDING channel — `boardCollision` is its own push", () => {
    const findings = collectFindings(LECTURE, {
      mathErrors: [],
      overflowing: [],
      collisions: detectCollisions([
        boxAt("0:1", "full", { x: 0, y: 0, w: 1000, h: 200 }),
        boxAt("0:2", "top-right", { x: 512, y: 100, w: 488, h: 200 }),
      ]),
      bursts: [
        {
          panel: 0,
          region: "left",
          name: "left",
          key: "0:3",
          overflow: 10,
          frameHeight: 288,
          frame: { x: 0, y: 0, w: 488, h: 288 },
          cut: 10,
        },
      ],
    });
    expect(findings).toHaveLength(2);
    expect(deriveNotifications(new Set(), findings).notifications).toEqual([]);
  });
});

describe("boardCollision — the push that replaced boardAutoErased (§5.5)", () => {
  const hit = (panel: number, a: string, b: string) =>
    detectCollisions([
      { key: "0:1", panel, region: a, rect: { x: 0, y: 0, w: 1000, h: 200 } },
      { key: "0:2", panel, region: b, rect: { x: 512, y: 100, w: 488, h: 200 } },
    ])[0]!;

  test("one aggregated push, and it always ends by naming the two organs that can answer", () => {
    const { notification } = deriveCollisionNotification(new Set(), [
      hit(0, "full", "top-right"),
      hit(1, "full", "right"),
    ]);
    expect(notification).toEqual({
      type: "boardCollision",
      severity: "warning",
      message: [
        "On board 1, top-right now stands on full (50% of the smaller one).",
        "On board 2, right now stands on full (50% of the smaller one).",
        "Both are written — nothing was moved and nothing was erased.",
        "Look (frame-board / glance-board) before your next append.",
      ].join("\n"),
      summary: "2 pairs of declarations overlap",
      replaces: ["boardCollision"],
    });
  });

  test("the dedupe key is the region PAIR: appending into a column that already overlaps never re-pushes", () => {
    const first = deriveCollisionNotification(new Set(), [hit(0, "full", "top-right")]);
    expect(first.notification).not.toBeNull();
    // A third paragraph in the same column — a NEW box, the same pair.
    const again = deriveCollisionNotification(first.seen, [
      hit(0, "full", "top-right"),
      {
        ...hit(0, "full", "top-right"),
        b: { key: "0:9", panel: 0, region: "top-right", rect: { x: 512, y: 150, w: 488, h: 100 } },
      },
    ]);
    expect(again.notification).toBeNull();
    // A DIFFERENT pair does push.
    const other = deriveCollisionNotification(again.seen, [
      hit(0, "full", "top-right"),
      hit(0, "left", "bottom-left"),
    ]);
    expect(other.notification!.summary).toBe("two declarations overlap");
  });

  test("the pair key is order-free: the same two regions in either order is one collision", () => {
    const ab = deriveCollisionNotification(new Set(), [hit(0, "full", "top-right")]);
    const ba = deriveCollisionNotification(ab.seen, [
      {
        ...hit(0, "full", "top-right"),
        a: { key: "0:2", panel: 0, region: "top-right", rect: { x: 512, y: 100, w: 488, h: 200 } },
        b: { key: "0:1", panel: 0, region: "full", rect: { x: 0, y: 0, w: 1000, h: 200 } },
      },
    ]);
    expect(ba.notification).toBeNull();
  });
});

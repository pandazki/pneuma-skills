/**
 * T7 — SKILL.md acceptance gate.
 *
 * The skill is the mode's expression guide, not an API manual (design
 * §12.1): the agent reading it must come away knowing how to EXPLAIN, not
 * which renderer knobs exist. That positioning is testable:
 *
 *  - render vocabulary is banned from every surface the agent reads — that
 *    gate now lives in `word-purity.test.ts`, over the one surface list in
 *    `vocabulary.ts` (three hand-kept copies is how `agent.greeting`
 *    escaped it);
 *  - the tone-setting sentence is written 原文 (the product owner's exact
 *    words), because the single-pen invariant IS the mode;
 *  - the six expression moves are all present, each backed by a fenced
 *    board.md example an agent can copy rather than an abstract paragraph;
 *  - the honest v1 boundaries are named — including the formula/back-
 *    reference limit that engine/text.ts explicitly delegates to T7 —
 *    because teaching a silently-failing gesture is worse than omitting it;
 *  - the body stays under 400 lines with depth pushed to references/;
 *  - and — T7-review F2/F3/F4/F5 — what the skill SHOWS the agent is
 *    pinned to what the code produces. Every one of those findings was the
 *    same failure: a promise in the skill that was true when it was
 *    written and quietly stopped being true. Prose about a response shape
 *    is a copy of the shape, and copies drift; the last section of this
 *    file generates the real thing and holds the document to it.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { parseLecture } from "../domain.js";
import { DEFAULT_DURATIONS } from "../engine/duration.js";
import { buildTimeline } from "../engine/timeline.js";
import { BOUNDED_REGION_WORDS } from "../engine/regions.js";
import banshoManifest from "../manifest.js";
import { describeStep, toAddress } from "../viewer/address.js";
import {
  FINDING_CODES,
  collectFindings,
  reportBoardCheck,
} from "../viewer/board-check.js";
import { BOARD_BASE_CSS } from "../viewer/board-css.js";
import { buildViewerContext, type BoardMoment } from "../viewer/context.js";
import { readSkillFile as read, referenceFiles } from "./vocabulary.js";

/** Discovered, never listed — see `vocabulary.ts::referenceFiles`. */
const REFERENCES = referenceFiles();

describe("T7 — the skill teaches explaining, not rendering", () => {
  test("the tone-setting sentence is written verbatim, up front", () => {
    const skill = read("SKILL.md");
    const motto = "板上只有一支笔。你写下的每一件事都会等前一件事收笔。";
    const at = skill.indexOf(motto);
    expect(at).toBeGreaterThan(-1);
    // Up front — before any section body, not buried in an appendix.
    expect(at).toBeLessThan(skill.indexOf("## "));
  });

  test("all six expression moves are present", () => {
    const skill = read("SKILL.md");
    for (const move of ["铺垫", "强调", "对比", "修正", "给证据", "收束"]) {
      expect(skill, `move "${move}" missing`).toContain(move);
    }
  });

  test("the moves are taught by copyable examples, not abstractions", () => {
    const skill = read("SKILL.md");
    // Fenced board.md samples exercising the whole ink vocabulary…
    for (const mark of ["==", "((", "~~", '@strike "']) {
      expect(skill, `no example uses ${mark}`).toContain(mark);
    }
    // …and both evidence containers (```graph shipped in T12 — the
    // "structure unsupported" parenthetical in the tasks doc predates it).
    expect(skill).toContain("```chart");
    expect(skill).toContain("```graph");
    // At least one fenced example per move is the floor.
    const fences = skill.match(/^\s*`{3,4}/gm) ?? [];
    expect(fences.length).toBeGreaterThanOrEqual(12);
  });

  test("the honest boundaries are named, formulas by name", () => {
    const skill = read("SKILL.md");
    // The formula/back-reference limit engine/text.ts delegates here:
    // formulas are zero characters to the match, so the degradation code
    // must be taught next to the gesture.
    expect(skill).toContain("refUnresolved");
    expect(skill).toContain("zero characters");
    // Steps that parse but draw nothing must be flagged as such.
    expect(skill).toContain("unsupportedStep");
  });

  test("the body stays under 524 lines; depth lives in references/", () => {
    // 400 → 430: the S1 gate raise the product owner approved (board-
    // snapshot design §10.2 rev 3) — one deliberate raise buying the
    // whole horizon (@turn + the third discipline + the sensory table,
    // plus C3b's projected teaching), instead of shaving craft prose or
    // training the gate into noise with micro-raises.
    //
    // 430 → 450 (canvas pivot §17.3, ruled 2026-08-11): the placement verb
    // needs a section of its own, and the coordinator ruled RAISE, NOT
    // TRIM — the 0.5.0 raise had already cut three pieces of reviewed copy
    // and said it would not cut a fourth. 450 rather than 440 on purpose:
    // handwriting simulation and the 3D moves still have to be taught, and
    // a gate that gets nudged every release is a gate nobody reads.
    //
    // 450 → 524 (W6, 2026-08-12): the number is derived, not chosen. The
    // change measures +74 / −3 against 448, landing at 519 — the planning
    // move is 66 lines of it, the intent/state distinction inside the third
    // discipline 11, the references row 1, and the deletions are the
    // now-false "no side-by-side layout" boundary, contradicted by the
    // `@at` section that shipped with the canvas pivot. The gate sits 4
    // above what landed: deliberately too little slack to absorb another
    // section, so the next author who needs room has to cut, which is the
    // only thing that keeps this number meaningful.
    //
    // Why the raise is earned rather than tolerated: every other section
    // here teaches a gesture the board can perform. This one is the only
    // one that governs what gets written AT ALL, and it exists because a
    // measured lecture (four faces, three at 46% width, zero figures in a
    // lecture whose central idea was a picture) proved that an agent
    // reading all 448 previous lines still had no reason to design before
    // writing. Depth went to `references/lecture-plan.md`; what stayed is
    // what an author must have in front of them at the first keystroke.
    const lines = read("SKILL.md").split("\n").length;
    expect(lines).toBeLessThan(524);
    for (const f of REFERENCES) {
      const text = read(`references/${f}`);
      expect(text.split("\n").length, `${f} too thin`).toBeGreaterThan(30);
    }
  });

  test("SKILL.md indexes every reference file", () => {
    const skill = read("SKILL.md");
    for (const f of REFERENCES) {
      expect(skill).toContain(`references/${f}`);
    }
  });

  test("the two rules the English boards taught are IN the skill", () => {
    // Both were learned by shooting the English seeds and were first
    // written down only in a screenshots README — where no agent reads.
    // The seeds are few-shot material; the skill is the instruction
    // surface, so the rules have to live here or the next English board
    // reproduces both failures. (The seeds' own half is pinned by
    // seeds.test.ts.)
    const ink = read("references/board-language.md");
    expect(ink).toContain("Circle two or three short words");
    expect(ink).toMatch(/never a clause/i);
    // Why, not just what: the arc is what makes length a risk.
    expect(ink).toMatch(/wrap/i);

    const charts = read("references/charts.md");
    // What the axis measures is appended with no separator.
    expect(charts).toContain("( min)");
    expect(charts).toContain("24min");
    expect(charts).toMatch(/glued/i);
    // A year is not what an axis measures.
    expect(charts).toContain("(2026)");
  });

  test("the full grammar teaches `@at` — both forms, the whole word table", () => {
    // The reference is where an author goes for syntax. It shipped the
    // canvas pivot with ZERO occurrences of the verb that pivot added, so
    // an author looking for the form found nothing and read the parser
    // instead. Every other verb has a section here; so must this one.
    const grammar = read("references/board-language.md");
    expect(grammar).toContain("@at");
    // Both forms: bare, and the anchored one that resumes / top-aligns.
    expect(grammar).toMatch(/@at\s+(left|right|top-right)\s+"/);
    // The closed table, every word — the vocabulary IS the grammar here.
    for (const word of BOUNDED_REGION_WORDS) {
      expect(grammar, `region word "${word}" missing`).toContain(`\`${word}\``);
    }
    // The strip's narrower facet and its refusal are part of the grammar.
    expect(grammar).toMatch(/strip/i);
  });

  test("the full grammar teaches the origin asymmetry — the trap `@at` sets", () => {
    // The one fact that makes `@at` safe to reach for, and the only one an
    // author cannot infer from the word table: `full` chains BELOW
    // everything standing, a named region starts at its own word's y. Say
    // both halves, or the first board an author writes is the collision.
    const grammar = read("references/board-language.md");
    expect(grammar).toMatch(/below everything standing/i);
    // The trap, stated as a trap.
    expect(grammar).toMatch(/starts at (its|the) (own )?word'?s? own y|word'?s own y/i);
    // …with §3.2's recorded way out, by name, so the author can act.
    expect(grammar).toContain("@at top");
    expect(grammar).toContain("bottom-left");
    expect(grammar).toContain("bottom-right");
    // …and what happens when it happens: both written, nothing repaired.
    expect(grammar).toContain("regionCollision");
    expect(grammar).toContain("regionBurst");
  });

  test("the full grammar no longer promises physics the room deleted", () => {
    // The V2 pivot deleted auto-erase and made the eraser region-scoped.
    // SKILL.md was updated; the reference was not, so the two surfaces
    // told an author opposite things about the same room. A reference that
    // contradicts the code is worse than a missing one — it is believed.
    const grammar = read("references/board-language.md");
    expect(grammar).not.toMatch(/erases the earliest[- ]filled/i);
    expect(grammar).not.toMatch(/by itself and continues/i);
    // The eraser's unit is the region now (§17.2), not the whole board.
    expect(grammar).not.toMatch(/granularity is the \*\*whole board\*\*/i);
    expect(grammar).toContain("turnOnFullWall");
  });

  test("@turn is taught as 'no room left', not as 'new topic'", () => {
    // Measured on a cold agent's lecture (2026-08-11): ten `@turn`s, zero
    // `@at`, and four boards left 76% / 74% / 74% / 64% full — the last
    // holding a single step. The physics was not the cause; the framing
    // was. A teacher turns because there is no room, and the room already
    // migrates overflow on its own, so a turn written at a topic boundary
    // spends a whole blackboard on a paragraph.
    for (const surface of ["SKILL.md", "references/board-language.md"]) {
      const text = read(surface);
      const turnSection = text.slice(text.indexOf("@turn"));
      expect(turnSection, `${surface}: turn's trigger is room`).toMatch(
        /no room left|there is no room/i,
      );
      expect(turnSection, `${surface}: the room turns for you`).toMatch(
        /room\s+already\s+turns\s+for\s+you/i,
      );
      expect(turnSection, `${surface}: a heading is not a turn`).toMatch(
        /heading\s+(therefore\s+)?needs\s*\n?\s*no/i,
      );
      expect(turnSection, `${surface}: fill the face first`).toMatch(
        /fill\s+the\s+face/i,
      );
    }
    // And the alternative to a premature turn is named where the turn is:
    // a board is a surface, so the next block goes BESIDE what stands.
    expect(read("SKILL.md")).toMatch(/@at` puts the next block BESIDE/);
  });

  // ── W6: the lecture gets designed before it gets written ────────────────
  //
  // Measured on a real four-board wall (2026-08-12): three faces at 46% of
  // their width and ZERO figures, in a lecture whose central idea 「先别算，
  // 先数人」 is a picture. Nothing in that lecture was written badly. The
  // skill had six moves, all of them rhetorical moves INSIDE a lecture, and
  // no move that happens before one — so an agent under pressure to start
  // producing produced, section by section, and the whole was never
  // designed. These pins hold the fix to being load-bearing rather than
  // advisory: a paragraph of encouragement would satisfy none of them.

  test("designing the lecture is taught BEFORE the six moves, not among them", () => {
    const skill = read("SKILL.md");
    const design = skill.indexOf("## Before the first word");
    const moves = skill.indexOf("## The six moves");
    expect(design).toBeGreaterThan(-1);
    // Order is the teaching: a planning section filed after the six moves
    // is a section an agent reaches once it is already writing prose.
    expect(design).toBeLessThan(moves);
  });

  test("the design is a FILE, named, beside board.md and never inside it", () => {
    const skill = read("SKILL.md");
    expect(skill).toContain("`plan.md`");
    // Where it lives, and — the part that is a fact about this mode rather
    // than a preference — why it cannot live in board.md: everything in
    // board.md is performed, so a design written there is handwritten onto
    // the user's board.
    const section = skill.slice(
      skill.indexOf("## Before the first word"),
      skill.indexOf("## The six moves"),
    );
    expect(section).toMatch(/beside `board\.md`/);
    expect(section).toMatch(/not inside `board\.md`/i);
    expect(section).toMatch(/performed/);
    // And it is not optional: no board step is written before it exists.
    expect(section).toMatch(/no board step is written before it exists/i);
  });

  test("every passage carries a medium, a room and a length — the three decisions that went missing", () => {
    const section = read("SKILL.md").slice(
      read("SKILL.md").indexOf("## Before the first word"),
      read("SKILL.md").indexOf("## The six moves"),
    );
    for (const decision of ["MEDIUM", "ROOM", "LENGTH"]) {
      expect(section, `${decision} not named as a per-passage decision`).toContain(decision);
    }
    // The medium rule has to be a TEST the author can apply, not "consider a
    // figure" — that is the sentence the failed lecture would have passed.
    expect(section).toMatch(/counts, compares, splits,? or traces a flow is a picture/i);
    // The room rule has to carry the column arithmetic, or a plan says
    // "board 2" and spends half of every face.
    expect(section).toMatch(/fills in COLUMNS/);
    expect(section).toMatch(/four boards is EIGHT\s+columns/);
    // …in the dialect's own placement words, so the plan is executable.
    expect(section).toMatch(/`left`/);
    expect(section).toMatch(/`right`/);
    expect(section).toMatch(/`full`/);
    // A copyable design, not an abstract instruction to make one.
    expect(section).toContain("```markdown");
    expect(section).toMatch(/@at (left|right|full)/);
  });

  test("revision is an explicit written act — the silent abandon is named as the failure", () => {
    const section = read("SKILL.md").slice(
      read("SKILL.md").indexOf("## Before the first word"),
      read("SKILL.md").indexOf("## The six moves"),
    );
    // The rhythm that keeps the design in contact with the board.
    expect(section).toContain("glance-board");
    // Revising is written down, in the file, with a reason.
    expect(section).toMatch(/edit `plan\.md` and say in one line what\s+changed and why/i);
    // And the failure mode is named as such, because it is invisible from
    // the inside — every individual sentence still reads fine.
    expect(section).toMatch(/silently\s+abandoned/i);
  });

  test("the design and the board's own answer are distinguished where the ban on outlines lives", () => {
    // The third discipline says "never keep your own outline of the board".
    // That is about the board's STATE. A design is about INTENT and cannot
    // be read off the board at all. Both are right; stated apart they read
    // as a contradiction, and an agent resolves a contradiction by dropping
    // one — which here means dropping the design. So the distinction must
    // sit in the same breath as the ban.
    const skill = read("SKILL.md");
    const ban = skill.indexOf("never keep your\nown outline of the board");
    expect(ban).toBeGreaterThan(-1);
    const after = skill.slice(ban, ban + 900);
    expect(after).toMatch(/does not ban `plan\.md`/);
    // Promise vs fact, each answering the question the other cannot.
    expect(after).toMatch(/promise about what you mean to teach/i);
    expect(after).toMatch(/fact about what got\s+written/i);
    // And the tie-break when they disagree: look, then rewrite the promise.
    expect(after).toMatch(/rewrite the promise in the file/i);
  });

  test("the Claude-Code workflow exists, is named the same in the skill, and is shipped where the installer looks", () => {
    // Three-place registration (.claude/rules/modes.md): the install path,
    // the test, and the documentation have to agree. The install path is
    // `<modeSourceDir>/workflows/*.js` — discovered, so a script filed
    // anywhere else is silently never installed and the skill's pointer
    // becomes a lie.
    const script = readFileSync(
      join(import.meta.dir, "..", "workflows", "plan-lecture.js"),
      "utf8",
    );
    expect(script).toMatch(/export const meta = \{/);
    expect(script).toMatch(/name: 'plan-lecture'/);
    // The skill names it, and — the load-bearing half — says plainly that a
    // backend without the tool still runs the same strategy from the prose.
    const skill = read("SKILL.md");
    expect(skill).toContain("`plan-lecture`");
    expect(skill).toMatch(/Without it these\s+words are the whole instrument/i);
    // The workflow produces the design and stops; writing the board is the
    // session's job. A workflow that also wrote board.md would be a second
    // author, and the session would be holding a lecture it did not write.
    expect(script).toContain("plan.md");
    expect(script).toMatch(/Do not write \\`board\.md\\`/);
  });

  test("the manifest scene is present and told in expression terms", () => {
    const scene = banshoManifest.skill.mdScene ?? "";
    expect(scene.length).toBeGreaterThan(100);
    expect(scene).toContain("board.md");
  });

  test("the stage dialect reaches the agent: camera verbs taught, erase permitted (review P2-5)", () => {
    // The whole stage layer exists for the authoring agent — a capability
    // the skill does not teach (or, worse, forbids) might as well not
    // ship. The review caught exactly that: no @focus / @overview
    // anywhere, and instructions still saying "never erase".
    const skill = read("SKILL.md");
    for (const verb of ["@focus", "@overview", "@erase", "@board"]) {
      expect(skill, `${verb} missing from SKILL.md`).toContain(verb);
    }
    const grammar = read("references/board-language.md");
    for (const verb of ["@focus", "@overview"]) {
      expect(grammar, `${verb} missing from the full grammar`).toContain(verb);
    }
    const greeting = banshoManifest.agent?.greeting ?? "";
    const scene = banshoManifest.skill.mdScene ?? "";
    expect(greeting).not.toMatch(/never erase|nothing is erased/i);
    expect(scene).not.toMatch(/never erase|nothing is erased/i);
    expect(`${scene} ${greeting}`).toContain("@erase");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// What the skill SHOWS, held against what the code PRODUCES
// ────────────────────────────────────────────────────────────────────────────

/**
 * A line with its particulars removed — numbers become `N`, quoted runs
 * become `"…"`. What survives is the grammar of the line, which is the part
 * an agent parses and the part that drifts: `section N "…", N of N` and
 * `section N, step N "…", N of N` are different shapes, and the skill
 * carried the first while the code produced the second.
 */
const shape = (line: string): string =>
  line.replace(/"[^"]*"/g, '"…"').replace(/\d+(?:\.\d+)?/g, "N");

/** The fenced block that follows a heading in SKILL.md. */
function fencedAfter(skill: string, heading: string): string[] {
  const from = skill.indexOf(heading);
  expect(from, `heading not found: ${heading}`).toBeGreaterThan(-1);
  const open = skill.indexOf("\n```", from);
  const body = skill.slice(skill.indexOf("\n", open + 1) + 1);
  return body.slice(0, body.indexOf("```")).trimEnd().split("\n");
}

describe("the viewer-context example is the block the code builds (F4)", () => {
  // The same board the example is written from.
  const SOURCE = `# Why this cycle is different

The opening paragraph sits before any section.

## Supply

Data-centre revenue tripled to ==87.4B==.

- Demand: three times
- Supply: constrained
`;
  const lecture = parseLecture(SOURCE);
  const timeline = buildTimeline(lecture, { durations: DEFAULT_DURATIONS });
  const ref = { section: 1, step: 0 };
  const moment: BoardMoment = {
    // Past the pointed-at step, so its status reads "already written".
    t: timeline.duration,
    duration: timeline.duration,
    follow: "live",
    playing: true,
    schedule: timeline.schedule,
  };
  const built = buildViewerContext(
    {
      type: "narration",
      content: "Data-centre revenue tripled to 87.4B.",
      file: "board.md",
      address: toAddress(ref),
    },
    [{ path: "board.md", content: SOURCE }],
    moment,
  )
    .split("\n")
    .slice(1, -1); // drop the <viewer-context …> wrapper the example omits

  test("every documented line has the shape the builder produces", () => {
    const documented = fencedAfter(
      read("SKILL.md"),
      "### The user pointing at the board",
    );
    expect(documented.map(shape)).toEqual(built.map(shape));
  });

  test("the example is a real example, not a placeholder", () => {
    // Guards the guard: shape-only comparison would pass on a block of
    // bare labels, so the example must still read like a board.
    const documented = fencedAfter(
      read("SKILL.md"),
      "### The user pointing at the board",
    );
    expect(documented.length).toBeGreaterThanOrEqual(6);
    expect(documented.join("\n")).toMatch(/"[^"]{8,}"/);
  });
});

describe("an unresolved look-back degrades the way the skill says (F3)", () => {
  const lecture = parseLecture(
    `# A board

A line that is on the board.

@strike "a phrase that was never written"
`,
  );
  const bad = lecture.sections[0]!.steps.find((s) => s.kind === "bad");

  test("it becomes a step the board DRAWS, not a step it skips", () => {
    // The skill used to teach this as a silent failure. It is not silent:
    // the step degrades to a bad step, and BoardCanvas gives every bad step
    // a small badge reading exactly this — in front of the user.
    expect(bad).toBeDefined();
    expect(describeStep(bad!)).toBe("unreadable block");
    expect(BOARD_BASE_CSS).toContain(".bansho-bad-badge");
  });

  test("and the skill names that badge where it teaches the gesture", () => {
    const skill = read("SKILL.md");
    // Both places: the look-back section, and the formula boundary.
    expect(skill.split("unreadable block").length - 1).toBeGreaterThanOrEqual(2);
    // …and nowhere calls the degradation quiet.
    expect(skill).not.toMatch(/quietly matches nothing|silently matches/i);
  });
});

describe("the check-board answer the skill documents (F5)", () => {
  const BROKEN = `# A board with problems

Revenue tripled last year.

@circle "a phrase that was never written"

![a picture](assets/x.png)
`;
  const report = reportBoardCheck(
    collectFindings(parseLecture(BROKEN), {
      mathErrors: [{ section: 0, step: 0 }],
      overflowing: [{ section: 0, step: 0 }],
    }),
  );

  test("the report's own fields are the ones the skill names", () => {
    // SKILL.md: "the verdict is inside `data`: `data.ok` and
    // `data.findings: [{ code, address, message, excerpt }]`".
    const skill = read("SKILL.md");
    expect(Object.keys(report).sort()).toEqual(["findings", "ok", "summary"]);
    expect(skill).toContain("data.ok");
    expect(skill).toContain("data.findings");
    for (const field of ["code", "address", "message", "excerpt"]) {
      expect(skill, `finding field ${field} undocumented`).toContain(field);
    }
  });

  test("a finding carries exactly the documented fields, nothing extra", () => {
    expect(report.findings.length).toBeGreaterThan(0);
    for (const finding of report.findings) {
      expect(Object.keys(finding).sort()).toEqual(
        ["address", "code", "excerpt", "message"].filter((k) => k in finding),
      );
      expect(new Set(FINDING_CODES).has(finding.code)).toBe(true);
    }
  });

  test("every finding of a real board names where it happened", () => {
    // The promise the skill's action table makes. Every code above is
    // produced here — including mathRenderError, which used to come back
    // as a bare count (F2).
    expect(new Set(report.findings.map((f) => f.code)).size).toBeGreaterThan(2);
    for (const finding of report.findings) {
      expect({ code: finding.code, addressed: !!finding.address }).toEqual({
        code: finding.code,
        addressed: true,
      });
    }
  });

  test("the codes the skill lists are exactly the codes that exist", () => {
    const skill = read("SKILL.md");
    const listed = FINDING_CODES.filter((code) =>
      skill.includes(`\`${code}\``),
    );
    // Set equality both ways: a code the board can report and the skill
    // never names is a warning the agent cannot interpret, and a code the
    // skill names that no longer exists is a lie.
    expect([...listed].sort()).toEqual([...FINDING_CODES].sort());
    const invented = [...read("SKILL.md").matchAll(/`([a-z][A-Za-z]+Error|[a-z][A-Za-z]*(?:Unresolved|Overflow|Step))`/g)]
      .map((m) => m[1]!)
      // Documented glance-board DATA fields are not finding-code claims —
      // `nextOverflow` is `data.pen.nextOverflow` (S1), and the guard's
      // job is codes, not field names.
      .filter((name) => !FINDING_CODES.includes(name as never) && name !== "nextOverflow");
    expect(invented).toEqual([]);
  });
});

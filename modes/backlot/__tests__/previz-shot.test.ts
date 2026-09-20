/**
 * What `shot.json` means — the invariants, without a render.
 *
 * `shot.mjs` is pure, so every rule the mode is built on can be exercised
 * here: the frame-exact spec, cause before effect, "nothing is passed
 * unseen", the stuck rule, the take-policy gate, and the stage order that
 * `status` reports as `next`.
 */

import { describe, expect, test } from "bun:test";

import type { Check, CheckStatus, Line } from "../skill/scripts/shot.d.mts";
import {
  computeStuck,
  findCheck,
  hasSpokenLine,
  makeContinuity,
  makeSpec,
  makeTrim,
  newProject,
  parsePromptTimeline,
  promptAssignments,
  nextStage,
  nextTakeId,
  normalizeShot,
  normalizeSpeech,
  parsePromptPack,
  parseSize,
  promptReferences,
  PROMPT_TEMPLATE_BODY,
  recordCheck,
  revisionOfTarget,
  seedChecklist,
  shotStatus,
  slugId,
  STANDARD_CHECKS,
  summarizeChecks,
  takePolicy,
  timelineProblems,
  transcriptCoverage,
  validateBeats,
  validateLines,
  validatePromptRefs,
  validateReferenceAssignments,
  newShot,
} from "../skill/scripts/shot.mjs";

const SPEC = makeSpec({ seconds: 8, fps: 24, width: 1280, height: 720 });
const T = (n: number) => new Date(Date.UTC(2026, 8, 20, 10, n)).toISOString();

function shotWith(overrides: Record<string, unknown> = {}) {
  const shot = newShot({ id: "lab-walk", title: "The researcher wakes the device", spec: SPEC });
  seedChecklist(shot);
  return normalizeShot({ ...shot, ...overrides });
}

/** A shot whose greybox has been rendered and fully accepted. */
function acceptedShot() {
  const shot = shotWith();
  shot.beats = validateBeats(
    [
      { id: "establish", label: "Doorway", from: 0, to: 0.5, kind: "hold" },
      { id: "walk", label: "Walks", from: 0.5, to: 3.8, kind: "action" },
      { id: "touch", label: "Hand", from: 4.5, to: 5.5, kind: "action" },
      { id: "glow", label: "Brightens", from: 5.5, to: 7.5, kind: "trigger", causedBy: "touch" },
    ],
    SPEC,
  );
  shot.greybox.revision = 2;
  shot.greybox.preview = { file: "greybox/preview.mp4", revision: 1, probe: null, renderedAt: T(1), renderSeconds: 4.1 };
  shot.greybox.final = { file: "greybox/greybox.mp4", revision: 2, probe: null, renderedAt: T(2), renderSeconds: 11.2 };
  for (const check of STANDARD_CHECKS.greybox) {
    recordCheck(shot, { id: check.id, status: "pass", target: "greybox", at: T(3) });
  }
  return shot;
}

describe("the spec", () => {
  test("refuses a duration whose seconds x fps is not a whole frame count", () => {
    expect(makeSpec({ seconds: 8, fps: 24 })).toEqual({ seconds: 8, fps: 24, width: 1280, height: 720, frames: 192 });
    expect(makeSpec({ seconds: 7.5, fps: 24 }).frames).toBe(180);
    expect(() => makeSpec({ seconds: 7.9, fps: 24 })).toThrow(/189.6 frames, which is not whole/);
    // The refusal offers the nearest duration that does work.
    expect(() => makeSpec({ seconds: 7.9, fps: 24 })).toThrow(/use 7.9167 s \(190 frames\)/);
    expect(() => makeSpec({ seconds: 8, fps: 23.5 })).toThrow(/fps must be a whole number/);
  });

  test("sizes and ids are parsed or refused by name", () => {
    expect(parseSize("1280x720")).toEqual({ width: 1280, height: 720 });
    expect(parseSize(" 854 X 480 ")).toEqual({ width: 854, height: 480 });
    expect(() => parseSize("big", "--size")).toThrow(/--size must look like 1280x720/);
    expect(slugId("Lab Walk — take 2")).toBe("lab-walk-take-2");
    expect(() => slugId("!!!", "shot id")).toThrow(/no letters or digits/);
  });
});

describe("beats", () => {
  test("every problem is reported at once, not one round trip at a time", () => {
    let message = "";
    try {
      validateBeats(
        [
          { id: "touch", label: "Hand", from: 6, to: 6.5, kind: "action" },
          { id: "glow", label: "Glow", from: 5.5, to: 9.5, kind: "trigger", causedBy: "touch" },
          { id: "glow", label: "Dup", from: 1, to: 2, kind: "nope" },
          { id: "late", label: "Late", from: 3, to: 1, kind: "action" },
        ],
        SPEC,
      );
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("to 9.5 is past the shot's 8 s");
    expect(message).toContain('duplicate id "glow"');
    expect(message).toContain("kind must be one of action|trigger|camera|hold");
    expect(message).toContain("to 1 is before from 3");
    expect(message).toContain('an effect cannot precede its cause');
  });

  test("a trigger's cause must exist, not be itself, and not run in a circle", () => {
    expect(() => validateBeats([{ id: "glow", from: 1, to: 2, kind: "trigger", causedBy: "nobody" }], SPEC)).toThrow(
      /causedBy "nobody" is not a beat in this list/,
    );
    expect(() => validateBeats([{ id: "glow", from: 1, to: 2, kind: "trigger", causedBy: "glow" }], SPEC)).toThrow(
      /causedBy points at itself/,
    );
    expect(() =>
      validateBeats(
        [
          { id: "a", from: 1, to: 2, kind: "trigger", causedBy: "b" },
          { id: "b", from: 1, to: 2, kind: "trigger", causedBy: "a" },
        ],
        SPEC,
      ),
    ).toThrow(/runs in a circle/);
  });

  test("a beat carries its DESIGNED detail, and a beat without one says so", () => {
    // The detail is written at the boards stage, before the greybox exists:
    // the greybox is built from it and can only carry its geometry and its
    // clock, so the prompt hands the design back to the model at the
    // greybox's seconds. The label stays short — it is what a rail shows.
    const beats = validateBeats(
      [
        {
          id: "walk",
          label: "Walks to the console",
          from: 0.5,
          to: 3.8,
          kind: "action",
          detail: "  four heavy steps, coat dripping, eyes on the console; he does not look back  ",
        },
        { id: "touch", label: "Hand", from: 4.5, to: 5.5, kind: "action" },
        { id: "glow", label: "Glow", from: 5.5, to: 7.5, kind: "trigger", causedBy: "touch", detail: "" },
      ],
      SPEC,
    );
    expect(beats[0].detail).toBe("four heavy steps, coat dripping, eyes on the console; he does not look back");
    expect(beats[0].label).toBe("Walks to the console");
    // Absent and empty are the same fact, and it is stated rather than missing.
    expect(beats[1].detail).toBeNull();
    expect(beats[2].detail).toBeNull();
    expect(beats[2].causedBy).toBe("touch");
  });

  test("a cause that starts at the same second as its effect is allowed", () => {
    const beats = validateBeats(
      [
        { id: "touch", from: 4.5, to: 5.5, kind: "action" },
        { id: "glow", from: 4.5, to: 7.5, kind: "trigger", causedBy: "touch" },
      ],
      SPEC,
    );
    expect(beats).toHaveLength(2);
    expect(beats[1].causedBy).toBe("touch");
    expect(beats[0].kind).toBe("action");
  });
});

describe("the acceptance record", () => {
  test("the standard list is seeded unverified, and re-seeding never overwrites a verdict", () => {
    const shot = shotWith();
    expect(shot.checks).toHaveLength(STANDARD_CHECKS.greybox.length);
    expect(shot.checks.every((check) => check.status === "unverified")).toBe(true);
    shot.greybox.revision = 1;
    recordCheck(shot, { id: "blocking", status: "fail", target: "greybox", at: T(1) });
    expect(seedChecklist(shot)).toEqual([]);
    expect(findCheck(shot, "blocking", "greybox")?.status).toBe("fail");
  });

  test("a recreate shot also carries the reference checks", () => {
    const shot = normalizeShot(newShot({ id: "s", title: "s", entry: "recreate", spec: SPEC }));
    seedChecklist(shot);
    expect(shot.checks.map((check) => check.id)).toContain("ref-framing");
    expect(shot.checks.map((check) => check.id)).toContain("ref-timing");
  });

  test("recording moves the previous state into history", () => {
    const shot = shotWith();
    shot.greybox.revision = 1;
    recordCheck(shot, { id: "pace", status: "fail", target: "greybox", note: "skates at the stop", at: T(1) });
    shot.greybox.revision = 2;
    const second = recordCheck(shot, { id: "pace", status: "pass", target: "greybox", range: [3.5, 4.5], note: "0.4 mm/frame", at: T(2) });
    expect(second.status).toBe("pass");
    expect(second.revision).toBe(2);
    expect(second.range).toEqual([3.5, 4.5]);
    expect(second.history).toEqual([{ revision: 1, status: "fail", note: "skates at the stop", at: T(1) }]);
  });

  test("checking before there is anything to look at is refused", () => {
    const shot = shotWith();
    expect(() => recordCheck(shot, { id: "blocking", status: "pass", target: "greybox" })).toThrow(
      /no greybox render to check yet/,
    );
    shot.greybox.revision = 1;
    expect(() => recordCheck(shot, { id: "take-motion", status: "pass", target: "take-09" })).toThrow(
      /neither "greybox" nor a recorded take/,
    );
    expect(() => recordCheck(shot, { id: "blocking", status: "looks-ok" as CheckStatus, target: "greybox" })).toThrow(
      /--status must be one of pass\|fail\|unverified/,
    );
  });

  test("unverified is counted apart from fail, and an empty record is not acceptance", () => {
    const shot = shotWith();
    shot.greybox.revision = 1;
    recordCheck(shot, { id: "blocking", status: "pass", target: "greybox", at: T(1) });
    recordCheck(shot, { id: "pace", status: "fail", target: "greybox", at: T(1) });
    const summary = summarizeChecks(shot, "greybox");
    expect(summary.pass).toBe(1);
    expect(summary.fail).toBe(1);
    expect(summary.unverified).toBe(STANDARD_CHECKS.greybox.length - 2);
    expect(summary.failIds).toEqual(["pace"]);
    expect(summary.accepted).toBe(false);

    const empty = normalizeShot(newShot({ id: "s", title: "s", spec: SPEC }));
    expect(summarizeChecks(empty, "greybox").accepted).toBe(false);
  });

  test("a check recorded before the current revision is reported stale, but does not gate", () => {
    const shot = acceptedShot();
    shot.greybox.revision = 3;
    const summary = summarizeChecks(shot, "greybox");
    expect(summary.accepted).toBe(true);
    expect(summary.staleIds).toHaveLength(STANDARD_CHECKS.greybox.length);
  });

  test("a take's revision is its own number, so two bad takes in a row are stuck too", () => {
    const shot = acceptedShot();
    expect(revisionOfTarget(shot, "greybox")).toBe(2);
    expect(revisionOfTarget(shot, "take-03")).toBe(3);
    expect(revisionOfTarget(shot, "reference")).toBeNull();
  });
});

describe("the stuck rule", () => {
  const trail = (entries: Array<[number, CheckStatus]>): Check[] => {
    const history = entries.slice(0, -1).map(([revision, status]) => ({ revision, status, note: "", at: null }));
    const [revision, status] = entries[entries.length - 1];
    return [{ id: "blocking", label: "", target: "greybox", status, range: null, note: "", revision, at: null, history }];
  };

  test("two distinct revisions ending fail is stuck; one is not", () => {
    expect(computeStuck(trail([[1, "fail"]]))).toEqual([]);
    expect(computeStuck(trail([[1, "fail"], [2, "fail"]]))).toEqual(["blocking"]);
    expect(computeStuck(trail([[1, "fail"], [2, "pass"]]))).toEqual([]);
    expect(computeStuck(trail([[1, "pass"], [2, "fail"]]))).toEqual([]);
  });

  test("distinct, not adjacent: revisions 3 and 5 count, revision 4 does not have to exist", () => {
    expect(computeStuck(trail([[3, "fail"], [5, "fail"]]))).toEqual(["blocking"]);
  });

  test("within one revision the LAST word wins", () => {
    // Looked again and changed the answer: that is a different answer, not
    // a second one.
    expect(computeStuck(trail([[1, "fail"], [1, "pass"], [2, "fail"]]))).toEqual([]);
    expect(computeStuck(trail([[1, "pass"], [1, "fail"], [2, "fail"]]))).toEqual(["blocking"]);
  });

  test("only the last two distinct revisions matter", () => {
    expect(computeStuck(trail([[1, "fail"], [2, "fail"], [3, "pass"], [4, "fail"]]))).toEqual([]);
  });

  test("a check nobody has recorded has no trail and cannot be stuck", () => {
    const shot = shotWith();
    expect(computeStuck(shot.checks)).toEqual([]);
  });
});

describe("the prompt pack", () => {
  test("takes the FIRST fenced prompt block and stops at its closing fence", () => {
    const markdown = [
      "# Pack",
      "",
      "```prompt",
      "Follow @Video1 exactly. A lab at night.",
      "```",
      "",
      "## Negative",
      "",
      "```text",
      "no crowds",
      "```",
    ].join("\n");
    const parsed = parsePromptPack(markdown);
    expect(parsed.ok).toBe(true);
    expect(parsed.prompt).toBe("Follow @Video1 exactly. A lab at night.");
    // The rest of the file must not leak in — that is how a prompt ends up
    // carrying a mode's own instructions to the model.
    expect(parsed.prompt).not.toContain("Negative");
  });

  test("refuses a missing block, an empty one, and one that never addresses the greybox", () => {
    expect(parsePromptPack("# Pack\n\nno fences here")).toMatchObject({ prompt: null, ok: false });
    expect(parsePromptPack("```prompt\n\n```")).toMatchObject({ ok: false });
    expect(parsePromptPack("```prompt\nA lab at night.\n```")).toMatchObject({
      ok: false,
      reason: expect.stringContaining("@Video1"),
    });
  });

  test("the scaffolded placeholder does not satisfy its own gate", () => {
    const untouched = parsePromptPack(`# Pack\n\n\`\`\`prompt\n${PROMPT_TEMPLATE_BODY}\n\`\`\`\n`);
    expect(untouched.ok).toBe(false);
    expect(untouched.reason).toContain("scaffolded placeholder");
    // Re-wrapping it is still the placeholder.
    expect(parsePromptPack(`\`\`\`prompt\n${PROMPT_TEMPLATE_BODY.replace(/\n/g, " ")}\n\`\`\``).ok).toBe(false);
  });

  test("a tilde fence works and closes on tildes", () => {
    expect(parsePromptPack("~~~prompt\nFollow @Video1 into the dark.\n~~~\ntail").prompt).toBe(
      "Follow @Video1 into the dark.",
    );
  });

  test("[Video1] is read as @Video1 and reported as the deprecated spelling", () => {
    // Seedance documents @Video1; this mode shipped brackets first, and a
    // pack written then must not stop working silently.
    const parsed = parsePromptPack("```prompt\nFollow [Video1] exactly. Neon rain.\n```");
    expect(parsed.ok).toBe(true);
    expect(parsed.refs?.video).toEqual([1]);
    expect(parsed.refs?.legacy).toEqual(["[Video1]"]);
    expect(parsePromptPack("```prompt\nFollow @Video1 exactly. Neon rain.\n```").refs?.legacy).toEqual([]);
  });

  test("every reference index a prompt names is collected, in both spellings", () => {
    const refs = promptReferences("Match @Video1, dress her like @Image2 and [Image1], voice of @Audio1.");
    expect(refs).toMatchObject({ video: [1], image: [1, 2], audio: [1], legacy: ["[Image1]"] });
  });

  test("a prompt that names a reference nothing was attached at is refused BY INDEX", () => {
    // The failure this prevents does not error at fal: the job renders, is
    // billed, and comes back conditioned on something else.
    const refs = promptReferences("@Video1 with @Image3 and @Audio1");
    expect(validatePromptRefs(refs, { video: 1, image: 2, audio: 1 })).toMatchObject({ ok: false });
    expect(validatePromptRefs(refs, { video: 1, image: 2, audio: 1 }).errors[0]).toContain("@Image3");
    expect(validatePromptRefs(refs, { video: 1, image: 2, audio: 1 }).errors[0]).toContain("only 2 image reference(s)");
    expect(validatePromptRefs(refs, { video: 1, image: 3, audio: 1 }).ok).toBe(true);
    // Nothing attached at all is its own sentence — "only 0" reads as a bug.
    expect(validatePromptRefs(promptReferences("@Video1 @Audio1"), { video: 1, image: 0, audio: 0 }).errors[0]).toContain(
      "no audio reference is attached",
    );
  });
});

describe("the prompt pack v2", () => {
  test("a reference is ASSIGNED by =, : or is — naming it is not giving it a job", () => {
    const assigned = promptAssignments(
      "@Video1 = layout only. @Image1: the opening frame. @Image2 is her appearance. @Audio1 — her voice. @Image3 appears somewhere.",
    );
    expect(assigned).toMatchObject({ video: [1], image: [1, 2], audio: [1] });
    // @Image3 is NAMED, not assigned: it is the one that bleeds.
    const only = promptAssignments("@Video1 = layout only. @Image3 also shows up.");
    expect(only.image).toEqual([]);
    // The bracket spelling assigns too — a pack written before @Video1 was
    // the documented form must not silently lose its jobs.
    expect(promptAssignments("[Video1] = layout only.").video).toEqual([1]);
    // …and a word that merely starts with "is" does not.
    expect(promptAssignments("@Image1 island in the rain").image).toEqual([]);
  });

  test("every attached reference must have a job, and the missing ones are named", () => {
    const prompt = "@Video1 = layout only. @Image1 = the board.";
    expect(validateReferenceAssignments(prompt, { video: 1, image: 1, audio: 0 }).ok).toBe(true);
    const short = validateReferenceAssignments(prompt, { video: 1, image: 3, audio: 1 });
    expect(short.ok).toBe(false);
    expect(short.missing).toEqual(["@Image2", "@Image3", "@Audio1"]);
    expect(short.errors[0]).toContain("bleeds");
    // Nothing attached is nothing to assign.
    expect(validateReferenceAssignments("anything", {}).ok).toBe(true);
  });

  test("a time-coded timeline is read, and disagreements with the clock are warnings", () => {
    const timeline = parsePromptTimeline(
      [
        "@Video1 = layout only.",
        "Seconds 0.0–0.5: he stops in the doorway.",
        "Seconds 0.5-3.8: he crosses the room.",
        "Seconds 5.2: kai says \"还开着吗？\"",
        "Look: cold blue.",
      ].join("\n"),
    );
    expect(timeline.map((row) => [row.from, row.to])).toEqual([[0, 0.5], [0.5, 3.8], [5.2, 5.2]]);
    expect(timelineProblems(timeline, { seconds: 8 })).toEqual([]);

    const broken = parsePromptTimeline(["Seconds 0.0–0.5: a", "Seconds 5.5–9.0: b", "Seconds 1.0–2.0: c"].join("\n"));
    const problems = timelineProblems(broken, { seconds: 8 });
    expect(problems.some((line) => line.includes("runs past the shot's 8 s"))).toBe(true);
    expect(problems.some((line) => line.includes("goes backwards"))).toBe(true);
    // Prose is not a timeline.
    expect(parsePromptTimeline("It takes about 8 seconds: he walks.")).toEqual([]);
  });
});

describe("the hand-off", () => {
  const ORDER = ["s01-enter", "s02-fridge", "s03-counter"];

  test("a shot continues an EARLIER shot of the same film, never itself", () => {
    const block = makeContinuity(
      { from: "s01-enter", entry: "mid-stride through the door", exit: "hand on the fridge handle" },
      { id: "s02-fridge", order: ORDER },
    );
    expect(block).toEqual({
      from: "s01-enter",
      entry: "mid-stride through the door",
      exit: "hand on the fridge handle",
    });

    expect(() => makeContinuity({ from: "s02-fridge", entry: "a", exit: "b" }, { id: "s02-fridge", order: ORDER })).toThrow(
      /this shot itself/,
    );
    // Contiguous shots are shot in order: the frame this one opens on has to
    // exist already.
    expect(() => makeContinuity({ from: "s03-counter", entry: "a", exit: "b" }, { id: "s02-fridge", order: ORDER })).toThrow(
      /comes AFTER "s02-fridge"/,
    );
    expect(() => makeContinuity({ from: "s09-nowhere", entry: "a", exit: "b" }, { id: "s02-fridge", order: ORDER })).toThrow(
      /not a shot in this film/,
    );
    // A shot the film has never registered has no "earlier" to speak of.
    expect(() => makeContinuity({ from: "s01-enter", entry: "a", exit: "b" }, { id: "stray", order: ORDER })).toThrow(
      /not in the film's shot list/,
    );
  });

  test("a hand-off owes both ends; an exit alone is allowed on any shot", () => {
    expect(() => makeContinuity({ from: "s01-enter", exit: "b" }, { id: "s02-fridge", order: ORDER })).toThrow(/--entry/);
    expect(() => makeContinuity({ from: "s01-enter", entry: "a" }, { id: "s02-fridge", order: ORDER })).toThrow(/--exit/);
    // A shot with no hand-off may still say how it ends, for a later shot to
    // pick up. That is what `exit` is for.
    expect(makeContinuity({ exit: "blades in contact" }, { id: "s02-fridge", order: ORDER })).toEqual({
      from: null,
      entry: null,
      exit: "blades in contact",
    });
    // An entry with nothing to continue describes a frame that has no
    // predecessor.
    expect(() => makeContinuity({ entry: "mid-lunge" }, { id: "s02-fridge", order: ORDER })).toThrow(/--continues-from/);
    // Nothing declared is the default, and the default is NO hand-off.
    expect(makeContinuity({}, { id: "s02-fridge", order: ORDER })).toBeNull();
    expect(makeContinuity({ from: "", entry: "", exit: "  " }, { id: "s02-fridge", order: ORDER })).toBeNull();
    expect(shotWith().continuity).toBeNull();
    expect(normalizeShot({ id: "x" }).continuity).toBeNull();
  });

  test("take-handoff is seeded only for a shot that declares one", () => {
    const alone = shotWith();
    alone.takes.push({ id: "take-01", status: "done" } as never);
    seedChecklist(alone);
    expect(alone.checks.some((check) => check.id === "take-handoff")).toBe(false);

    const continued = shotWith({
      continuity: { from: "s01-enter", entry: "mid-stride", exit: "hand on the handle" },
    });
    continued.takes.push({ id: "take-01", status: "done" } as never);
    const added = seedChecklist(continued);
    expect(added).toContain("take-01:take-handoff");
    expect(findCheck(continued, "take-handoff", "take-01")?.label).toBe(
      "First frame continues the previous shot's last used frame — positions, facing, weapons, action",
    );
    expect(findCheck(continued, "take-handoff", "take-01")?.status).toBe("unverified");
    // A shot whose hand-off was dropped keeps the verdicts it already has —
    // seeding never removes, it only adds what is missing.
    expect(seedChecklist(continued)).toEqual([]);
  });
});

describe("lines", () => {
  const spec = makeSpec({ seconds: 8, fps: 24 });
  const LINES = [
    { id: "l1", speaker: "kai", kind: "spoken", text: "还开着吗？", at: 5.2 },
    { id: "l2", speaker: "narrator", kind: "vo", text: "凌晨三点。", at: 0.8 },
  ];

  test("validates the whole list at once and normalizes what it keeps", () => {
    const { lines } = validateLines(LINES, spec);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ id: "l1", kind: "spoken", at: 5.2, file: null, seconds: null, cost: null });
  });

  test("every problem is reported together, not one round trip at a time", () => {
    let message = "";
    try {
      validateLines(
        [
          { id: "l1", speaker: "kai", kind: "shouted", text: "hi", at: 1 },
          { id: "l1", speaker: "", kind: "vo", text: "", at: 99 },
        ],
        spec,
      );
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("kind must be one of spoken|vo");
    expect(message).toContain('duplicate id "l1"');
    expect(message).toContain("speaker is required");
    expect(message).toContain("text is required");
    expect(message).toContain("outside the shot's 8 s");
  });

  test("a re-set keeps the recording of a line whose text did not change", () => {
    const previous: Line[] = [
      { id: "l2", speaker: "narrator", kind: "vo", text: "凌晨三点。", at: 0.8, file: "sound/l2.mp3", seconds: 3.1, cost: { usd: 0.01, basis: "table" } },
    ];
    const same = validateLines(LINES, spec, previous);
    expect(same.kept).toEqual(["l2"]);
    expect(same.lines[1]).toMatchObject({ file: "sound/l2.mp3", seconds: 3.1, cost: { usd: 0.01 } });

    // An edited line is a line the old audio does not say: the file goes,
    // the cost stays (the money was spent), and the change is reported.
    const edited = validateLines(
      [{ ...LINES[1], text: "凌晨四点。" }],
      spec,
      previous,
    );
    expect(edited.stale).toEqual(["l2"]);
    expect(edited.lines[0].file).toBeNull();
    expect(edited.lines[0].seconds).toBeNull();
    expect(edited.lines[0].cost).toMatchObject({ usd: 0.01 });
  });

  test("a spoken line adds take-lines to a finished take, a silent shot never sees it", () => {
    const silent = shotWith();
    silent.takes.push({ id: "take-01", status: "done" } as never);
    seedChecklist(silent);
    expect(silent.checks.some((check) => check.id === "take-lines")).toBe(false);
    expect(hasSpokenLine(silent)).toBe(false);

    const talking = shotWith();
    talking.lines = validateLines(LINES, SPEC).lines;
    talking.takes.push({ id: "take-01", status: "done" } as never);
    const added = seedChecklist(talking);
    expect(hasSpokenLine(talking)).toBe(true);
    expect(added).toContain("take-01:take-lines");
    expect(findCheck(talking, "take-lines", "take-01")?.label).toBe("Spoken lines are audible and correct");
    // …and it is unverified until a transcript answers it.
    expect(findCheck(talking, "take-lines", "take-01")?.status).toBe("unverified");
  });
});

describe("the trim", () => {
  const spec = makeSpec({ seconds: 4, fps: 24 });

  test("a shot starts whole, and a trim is a range inside its own clock", () => {
    expect(shotWith().trim).toBeNull();
    expect(makeTrim({ in: 0.4, out: 1.6 }, spec)).toEqual({ in: 0.4, out: 1.6 });
    expect(makeTrim({ in: 0, out: 4 }, spec)).toEqual({ in: 0, out: 4 });
    // Rounded like every other second this mode records.
    expect(makeTrim({ in: 0.40001234, out: 1.6 }, spec).in).toBe(0.4);
  });

  test("refuses a range the shot does not have, or one of no length", () => {
    expect(() => makeTrim({ in: 0.4, out: 9 }, spec)).toThrow(/past the shot's 4 s/);
    expect(() => makeTrim({ in: 3, out: 1 }, spec)).toThrow(/must be later than --trim-in 3/);
    expect(() => makeTrim({ in: 1, out: 1 }, spec)).toThrow(/a segment of no length/);
    expect(() => makeTrim({ in: -1, out: 2 }, spec)).toThrow(/--trim-in must be a second from 0/);
    expect(() => makeTrim({ in: 0, out: "soon" as unknown as number }, spec)).toThrow(/--trim-out must be a second/);
  });

  test("a trim survives normalizeShot and is reported by status", () => {
    const shot = normalizeShot({ ...shotWith(), trim: { in: 0.4, out: 1.6 } });
    expect(shot.trim).toEqual({ in: 0.4, out: 1.6 });
    expect((shotStatus(shot) as Record<string, any>).trim).toEqual({ in: 0.4, out: 1.6 });
    // An older file with no trim reads as the whole shot, not as broken.
    expect(normalizeShot({ id: "x" }).trim).toBeNull();
  });
});

describe("the transcript check", () => {
  test("punctuation, case and spacing are not what a line is judged on", () => {
    expect(normalizeSpeech("还开着吗？")).toBe("还开着吗");
    expect(normalizeSpeech("Are you still OPEN?")).toBe("areyoustillopen");
    // Whisper re-punctuates and re-spaces; the line is still the line.
    const coverage = transcriptCoverage("还开着吗... 我们打烊了。", [
      { id: "l1", text: "还开着吗？" },
      { id: "l3", text: "我们打烊了" },
    ]);
    expect(coverage.ok).toBe(true);
    expect(coverage.found).toEqual(["l1", "l3"]);
  });

  test("a line the take never said is named, so the next take is not a guess", () => {
    const coverage = transcriptCoverage("我们打烊了。", [
      { id: "l1", text: "还开着吗？" },
      { id: "l3", text: "我们打烊了" },
    ]);
    expect(coverage.ok).toBe(false);
    expect(coverage.missing).toEqual([{ id: "l1", text: "还开着吗？" }]);
  });

  test("an empty transcript is not acceptance", () => {
    expect(transcriptCoverage("", [{ id: "l1", text: "hello" }]).ok).toBe(false);
    // No lines at all is not a pass either — the caller never asks.
    expect(transcriptCoverage("anything", []).ok).toBe(false);
  });
});

describe("the film's manifest", () => {
  test("a new project stores only approvals, and starts with the gates closed", () => {
    const project = newProject({ title: "Last Customer", logline: "A clerk waits", defaults: { seconds: 6, fps: 24, width: 640, height: 360 } });
    expect(project).toEqual({
      version: 1,
      title: "Last Customer",
      logline: "A clerk waits",
      defaults: { seconds: 6, fps: 24, width: 640, height: 360 },
      gates: "closed",
      approvals: {},
      scenes: [],
      characters: [],
      sets: [],
      shots: [],
    });
    // No stage statuses are stored: they are derived, so the viewer and the
    // scripts cannot disagree about what the creator has seen.
    expect(Object.keys(project)).not.toContain("stages");
  });
});

describe("the take policy", () => {
  test("refuses without a final greybox at the current revision", () => {
    const shot = acceptedShot();
    shot.greybox.final = null;
    expect(takePolicy(shot).errors[0]).toContain("no final greybox");
    shot.greybox.final = { file: "greybox/greybox.mp4", revision: 1, probe: null, renderedAt: null, renderSeconds: null };
    shot.greybox.revision = 4;
    expect(takePolicy(shot).errors[0]).toContain("revision 1 but the scene is at revision 4");
  });

  test("a failing greybox check blocks a paid job until a reason is named", () => {
    const shot = acceptedShot();
    recordCheck(shot, { id: "penetration", status: "fail", target: "greybox", at: T(4) });
    expect(takePolicy(shot).ok).toBe(false);
    expect(takePolicy(shot).failingChecks).toEqual(["penetration"]);
    expect(takePolicy(shot, { allowFailing: "the hand clips a prop the model repaints anyway" }).ok).toBe(true);
  });

  test("first take free, second needs --fix, third needs --user-approved as well", () => {
    const shot = acceptedShot();
    expect(takePolicy(shot)).toMatchObject({ ok: true, takeNumber: 1, takeId: "take-01" });

    shot.takes.push({ id: "take-01", status: "done" } as never);
    expect(takePolicy(shot).ok).toBe(false);
    expect(takePolicy(shot).errors[0]).toContain('--fix "<what this take changes>"');
    expect(takePolicy(shot, { fix: "the hand missed the button" })).toMatchObject({ ok: true, takeNumber: 2, takeId: "take-02" });

    shot.takes.push({ id: "take-02", status: "failed" } as never);
    // A failed take still counts: its request left this machine.
    expect(takePolicy(shot, { fix: "again" }).ok).toBe(false);
    expect(takePolicy(shot, { fix: "again" }).errors[0]).toContain("--user-approved");
    expect(takePolicy(shot, { fix: "again", userApproved: true })).toMatchObject({ ok: true, takeNumber: 3 });
    expect(nextTakeId(shot)).toBe("take-03");
  });

  test("unverified greybox checks are reported but do not block", () => {
    const shot = acceptedShot();
    recordCheck(shot, { id: "end-hold", status: "unverified", target: "greybox", at: T(5) });
    const policy = takePolicy(shot);
    expect(policy.ok).toBe(true);
    expect(policy.unverifiedChecks).toEqual(["end-hold"]);
  });
});

describe("where the shot stands", () => {
  test("next walks the stages in order and names the command that closes each", () => {
    const shot = shotWith();
    expect(nextStage(shot).stage).toBe("plan");

    shot.beats = validateBeats([{ id: "walk", from: 0, to: 3, kind: "action" }], SPEC);
    expect(nextStage(shot).stage).toBe("greybox-preview");

    shot.greybox.revision = 1;
    shot.greybox.preview = { file: "greybox/preview.mp4", revision: 1, probe: null, renderedAt: null, renderSeconds: null };
    expect(nextStage(shot)).toMatchObject({ stage: "checks" });
    expect(nextStage(shot).reason).toContain("unverified");

    for (const check of STANDARD_CHECKS.greybox) recordCheck(shot, { id: check.id, status: "pass", target: "greybox", at: T(1) });
    expect(nextStage(shot).stage).toBe("final-render");

    shot.greybox.revision = 2;
    shot.greybox.final = { file: "greybox/greybox.mp4", revision: 2, probe: null, renderedAt: null, renderSeconds: null };
    // The picture before the video: an accepted greybox with no anchor asks
    // for one, and the lineup is how it is looked at.
    expect(nextStage(shot)).toMatchObject({ stage: "anchor" });
    expect(nextStage(shot).command).toContain("previz.mjs anchor");
    expect(nextStage(shot).command).toContain("lineup");

    shot.anchors.push({ id: "first", at: 0, file: "anchors/first.png", revision: 1 } as never);
    expect(nextStage(shot).stage).toBe("prompt");
    expect(nextStage(shot, { promptOk: true }).stage).toBe("take");

    shot.takes.push({ id: "take-01", status: "done", selected: false } as never);
    seedChecklist(shot);
    expect(nextStage(shot, { promptOk: true }).stage).toBe("take-checks");

    for (const check of STANDARD_CHECKS.take) recordCheck(shot, { id: check.id, status: "pass", target: "take-01", at: T(2) });
    expect(nextStage(shot, { promptOk: true }).stage).toBe("select");

    shot.takes[0].selected = true;
    expect(nextStage(shot, { promptOk: true })).toEqual({
      stage: null,
      reason: "every stage is closed — this shot is delivered",
      command: null,
    });
  });

  test("the anchor step is a suggestion, not a gate — a shot that went straight to video moves on", () => {
    // Some shots are bought without a picture first, on purpose (the skill
    // says when). A step that never closed would make every later `next` a
    // lie about where the shot stands.
    const shot = acceptedShot();
    expect(shot.anchors).toEqual([]);
    expect(nextStage(shot, { promptOk: true }).stage).toBe("anchor");
    shot.takes.push({ id: "take-01", status: "done", selected: false } as never);
    seedChecklist(shot);
    expect(nextStage(shot, { promptOk: true }).stage).toBe("take-checks");
  });

  test("a failing TAKE check asks for a named fix or a report, never a blind re-shoot", () => {
    const shot = acceptedShot();
    shot.takes.push({ id: "take-01", status: "done", selected: false } as never);
    seedChecklist(shot);
    for (const check of STANDARD_CHECKS.take) recordCheck(shot, { id: check.id, status: "pass", target: "take-01", at: T(2) });
    recordCheck(shot, { id: "take-camera", status: "fail", target: "take-01", note: "the camera drifts right from 5 s", at: T(3) });

    const next = nextStage(shot, { promptOk: true });
    expect(next.stage).toBe("take-checks");
    expect(next.reason).toContain("take-camera");
    // The move after a failing take is another take WITH a fix, or telling
    // the user what deviated — the scene is not what is wrong.
    expect(next.reason).toContain("named fix");
    expect(next.reason).toContain("report");
    expect(next.command).toContain('generate <shot-dir> --fix "<what this take changes>"');
    expect(next.command).toContain("keep take-01");
    expect(next.command).not.toContain("--user-approved");

    // A third take needs the user's yes as well, and the command says so.
    shot.takes.push({ id: "take-02", status: "failed" } as never);
    expect(nextStage(shot, { promptOk: true }).command).toContain('--fix "<what this take changes>" --user-approved');
  });

  test("a failing check reopens checks with the ids, even after a take exists", () => {
    const shot = acceptedShot();
    recordCheck(shot, { id: "framing", status: "fail", target: "greybox", at: T(6) });
    const next = nextStage(shot, { promptOk: true });
    expect(next.stage).toBe("checks");
    expect(next.reason).toContain("framing");
  });

  test("a recreate shot cuts its reference before anything else", () => {
    const shot = normalizeShot(newShot({ id: "s", title: "s", entry: "recreate", spec: SPEC }));
    seedChecklist(shot);
    expect(nextStage(shot).stage).toBe("reference");
    shot.reference = { file: "reference/source.mp4" };
    expect(nextStage(shot).stage).toBe("plan");
  });

  test("status never calls a shot accepted while a check is not pass", () => {
    const shot = acceptedShot();
    recordCheck(shot, { id: "camera-smooth", status: "unverified", target: "greybox", at: T(7) });
    const status = shotStatus(shot, { promptOk: true }) as Record<string, any>;
    expect(status.checks.byTarget.greybox.accepted).toBe(false);
    expect(status.checks.byTarget.greybox.unverified).toBe(1);
    expect(status.checks.byTarget.greybox.fail).toBe(0);
    expect(status.next.stage).toBe("checks");
    expect(status.greybox.finalIsCurrent).toBe(true);
    expect(status.selected).toBeNull();
  });
});

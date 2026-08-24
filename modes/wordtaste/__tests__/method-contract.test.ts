import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const skill = readFileSync(join(root, "skill", "SKILL.md"), "utf8");
const generation = readFileSync(
  join(root, "skill", "references", "generation.md"),
  "utf8",
);
const workflow = readFileSync(
  join(root, "skill", "references", "workflow-design.md"),
  "utf8",
);
const anchors = readFileSync(
  join(root, "skill", "references", "anchor-spec.md"),
  "utf8",
);
const primer = readFileSync(
  join(root, "skill", "references", "primer", "README.md"),
  "utf8",
);

/**
 * Every file the orchestrator or a workflow runtime reads as method — the skill
 * itself, all of its references, and both workflow artifacts. Not the manifest
 * changelog and not DESIGN-BRIEF.md: those are records of what the mode used to
 * be, and rewriting a record to match the present is how a project forgets what
 * it decided.
 */
const skillTextFiles = [
  join(root, "skill", "SKILL.md"),
  ...readdirSync(join(root, "skill", "references"))
    .filter((name) => name.endsWith(".md"))
    .map((name) => join(root, "skill", "references", name)),
  ...readdirSync(join(root, "skill", "workflows"))
    .filter((name) => name.endsWith(".js"))
    .map((name) => join(root, "skill", "workflows", name)),
];

describe("upstream method contract at 786c579", () => {
  it("states the purpose and all three no-leak directions", () => {
    expect(skill).toContain("## Purpose");
    expect(skill).toContain("orchestration discussion");
    expect(skill).toContain("model family, generation order");
    expect(skill).toContain("complete logs and intermediate artifacts");
    expect(skill).toContain("Never call the private adapters directly");
    expect(skill).toContain("Never\n  inspect bundled adapter source");
    expect(skill).toMatch(/Never\s+use `cat`, `sed`, or `jq -r`/);
    expect(skill).toContain(
      ".agents/skills/pneuma-wordtaste",
    );
    expect(skill).toContain(
      ".claude/skills/pneuma-wordtaste",
    );
  });

  it("plans prose form from unit function before formal parameters", () => {
    expect(workflow).toContain("function before length");
    expect(workflow).toContain("bring the problem into focus");
    expect(workflow).toContain("state the conclusion");
    expect(workflow).toContain("same force");
  });

  it("makes structured-output degradation explicit", () => {
    expect(workflow).toMatch(
      /Do not parse free-form\s+model output as JSON/,
    );
    expect(workflow).toContain("quote + problem");
    expect(workflow).toContain("record the degradation");
  });

  it("allows useful article structure but rejects formatting as a prose shortcut", () => {
    expect(generation).toContain("Sections and headings are normal");
    expect(generation).toMatch(
      /bold, italic, or\s+list-shaped argument/,
    );
    expect(generation).toContain("consumed verbatim as a candidate");
  });

  it("makes the two-cycle repair terminal executable and unambiguous", () => {
    expect(skill).toContain("The initial draft is attempt 0");
    expect(skill).toContain(
      "bun <SKILL_DIR>/scripts/run_check_cycle.ts <candidate> <brief> <scope> <result> <parts-dir>",
    );
    expect(skill).toContain("every repair still goes through `run_leaf.ts repair`");
    expect(skill).toContain("A third repair");
    expect(skill).toContain("Do not relabel");
    expect(generation).toContain("Every post-check rewrite is a repair cycle");
    expect(workflow).toContain("runner rejects a third repair");
  });

  it("preserves continuity across a clean leaf cwd by inlining inputs", () => {
    expect(skill).toContain("A leaf cannot read the workspace");
    expect(skill).toMatch(/File paths in a leaf prompt are\s+inert text/);
    expect(generation).toContain("Inline the full required contents");
    expect(workflow).toMatch(
      /never ask the leaf to open a workspace\s+path/,
    );
  });

  it("keeps even check status tokens out of visible terminal output", () => {
    expect(skill).toMatch(
      /Never echo `clean`,\s+`issues`, `pass`, `fail`, or another status token/,
    );
    expect(skill).toContain("rechecks without exposing which path ran");
    expect(workflow).toContain("A standalone status probe is a leak");
    expect(workflow).toContain("raw judge summaries and issue arrays are never copied");
  });

  it("keeps raw prompt construction out of expandable terminal cards", () => {
    expect(skill).toContain(
      "Never construct a\n  leaf prompt inside a shell command",
    );
    expect(skill).toContain("no heredoc, `printf`, inline string");
    expect(generation).toContain("terminal commands are user-visible");
    expect(workflow).toContain(
      "The shell command itself is also a visible artifact",
    );
    expect(workflow).toContain("under\n`.pneuma/private/`");
  });

  it("takes the writer's Chinese out of the orchestrator's hands", () => {
    // The orchestrator writes no Chinese for a model: it prepares parts and a
    // script assembles the prompt around them.
    expect(skill).toContain("## You write no Chinese for a model");
    expect(skill).toContain("A writer transcribes what it is given");
    for (
      const part of [
        "`brief.en.md`",
        "`material.md`",
        "`kernel.md`",
        "`preceding.md`",
        "`constraints.en.md`",
      ]
    ) {
      expect(skill).toContain(part);
    }
    for (
      const command of [
        "bun <SKILL_DIR>/scripts/compose_unit_parts.ts workflow.json u1 .pneuma/private/u1",
        "bun <SKILL_DIR>/scripts/compose_leaf_prompt.ts .pneuma/private/u1 .pneuma/private/u1/prompt.md",
        "bun <SKILL_DIR>/scripts/run_leaf.ts writer .pneuma/private/u1/prompt.md > .pneuma/private/u1/candidate.md",
      ]
    ) {
      expect(skill).toContain(command);
    }
    // The refused-brief path is no longer taught; the composed path replaced it.
    expect(skill).not.toContain("<!-- brief:start -->");
    expect(generation).toContain("## The prompt is composed, not written");
    expect(generation).toContain(
      "bun <SKILL_DIR>/scripts/compose_unit_parts.ts workflow.json u2 .pneuma/private/u2",
    );
    expect(workflow).toContain("`compose_leaf_prompt.ts` assembles them into the prompt");
  });

  /**
   * The composed prompt ends on the essay so far. Three texts argue that
   * placement to a reader — the skill, the generation brief, and the primer
   * README whose own recency argument it supersedes — and a fourth (the
   * anchor spec) is where somebody would otherwise read "last" as "wins".
   * A prose claim that drifts out of step with the assembler is worse than
   * no claim, so all four are pinned here.
   */
  it("says the finished prose ends the writer's prompt, and why", () => {
    expect(skill).toMatch(/`preceding\.md` under\s+`<preceding_prose>`/);
    expect(skill).toContain(
      "carry straight on from where that text stops",
    );
    expect(skill).toMatch(/A first unit has nothing\s+behind it/);
    expect(generation).toContain("last of all `preceding.md`");
    expect(generation).toContain("A composed repair inherits the same order");
    // The user's voice is no longer the last block a writer reads, and no
    // skill text anywhere may still say it is — the claim was written into
    // four of them, so the sweep is the pin.
    const stale = skillTextFiles.filter((file) =>
      readFileSync(file, "utf8").includes("last of the content blocks")
    );
    expect(stale).toEqual([]);
    expect(anchors).toContain("That position is about continuation, not authority");
    // The primer README argued the opposite placement; it now says so, and
    // says which way the decision went.
    expect(primer).toContain("that recency argument no longer holds");
    expect(primer).toContain("continuation momentum outweighs primer recency");
  });

  /**
   * The system/user split (0.14.0). The charter is its own artifact, the task
   * message begins at the brief, each route carries the charter through its
   * strongest channel, and the checker/planner exclusion is stated with its
   * reason — in every text a reader would consult.
   */
  it("documents the writer's charter, its channels, and who is excluded", () => {
    expect(skill).toContain("`system.en.md`");
    expect(skill).toMatch(/begins at the brief and holds\s+only this task's instances/);
    expect(skill).toContain("`--system-prompt-file`");
    expect(skill).toMatch(/deliberately replacing\s+that CLI's own default system prompt/);
    expect(skill).toMatch(/Checker and planner prompts stay single-message/);
    expect(generation).toContain("`system.en.md`");
    expect(generation).toContain("`--system-prompt-file`");
    expect(generation).toContain("prepended above the one message");
    expect(workflow).toContain("prepends the same charter");
    expect(workflow).toContain("Checker prompts get no charter on either path.");
  });

  /**
   * The creation posture (0.15.0). From-idea intake is an interview whose
   * answers land verbatim in `materials/notes.md`, the charter has one
   * posture per entry, and the checker deliberately does not change between
   * them — stated in every text a reader would consult, with the reason.
   */
  it("teaches the from-idea interview and the two charter postures", () => {
    expect(skill).toContain("the intake is an interview");
    expect(skill).toContain("`materials/notes.md`");
    expect(skill).toMatch(/never paraphrase, never summarize/);
    expect(skill).toMatch(/the user's chat\s+Chinese is human Chinese/);
    // The plan step names both from-idea inputs and keeps their provenance.
    expect(skill).toContain("<!-- materials/notes.md -->");
    // The charter's entry conditionality, and the part that carries it.
    expect(skill).toMatch(/varies by which blocks are\s+present, and by the workflow's entry/);
    expect(skill).toContain("no factual claim the material does not support may");
    expect(generation).toContain("The charter has two postures");
    expect(generation).toContain("no factual claim the material does not\nsupport may enter");
    // Why the checker is the same on both entries — stated, not implied.
    expect(generation).toContain("creation needed a different charter, not a different judge");
    expect(workflow).toContain("they ask opposite things of a writer");
    expect(workflow).toContain("creation needs a different charter, not a different judge");
  });

  it("keeps priming with the runner and the checker out of it", () => {
    expect(skill).toContain("Priming is automatic and belongs to the runner");
    expect(skill).toMatch(/do not\s+read or list `references\/primer\/`/);
    expect(skill).toContain("checker is never primed");
  });

  it("plans through the scripts and states the verbatim rule to the orchestrator", () => {
    for (
      const command of [
        "bun <SKILL_DIR>/scripts/compose_plan_prompt.ts .pneuma/private/plan .pneuma/private/plan/prompt.md",
        "bun <SKILL_DIR>/scripts/run_leaf.ts planner .pneuma/private/plan/prompt.md > .pneuma/private/plan/plan.json",
        "bun <SKILL_DIR>/scripts/validate_plan.ts .pneuma/private/plan/plan.json",
        "bun <SKILL_DIR>/scripts/project_plan.ts .pneuma/private/plan/plan.json workflow.json",
      ]
    ) {
      expect(skill).toContain(command);
    }
    // The failure path is bounded: one more planner run, then the user hears
    // one sentence and the session stays at intake.
    expect(skill).toContain("run the planner once more");
    expect(skill).toContain("stop at intake");
    expect(skill).toContain("Never repair a plan by hand");
    // The rule the guard enforces is also stated in prose, because a rule the
    // orchestrator cannot see is a rule it will work around.
    expect(skill).toContain(
      "Chinese in the plan is verbatim from the author's material",
    );
    expect(skill).toContain("`notes_en`");
    expect(skill).toContain("`open_question`");
    expect(skill).toMatch(/At no point in this sequence do you\s+write Chinese for a model/);
    expect(workflow).toContain("`references/plan-schema.json`");
    expect(workflow).toContain("refuses any plan whose Chinese is not a literal quote");
  });

  it("says plainly what the Claude Workflow path shares and what it still cannot do", () => {
    expect(workflow).toContain("Codex and Kimi do not inherit that runtime.");
    // Since the scaffolding moved into one file, that path composes the same
    // prompts as the scripts — the old "it goes through neither composer"
    // caveat is no longer true and must not be restated.
    expect(workflow).toContain("`references/prompt-scaffolding.en.json`");
    expect(workflow).toContain("It composes what the scripts compose.");
    // What it still cannot do for itself, stated where an orchestrator reads it.
    expect(workflow).toContain("`referenceProse`");
    expect(workflow).toContain("its check is not a fresh-family check");
  });

  it("makes the private check exchange executable instead of prompt-only", () => {
    expect(skill).toContain("project_check_cycle.ts unit");
    expect(skill).toContain("project_check_cycle.ts whole");
    expect(skill).toContain("These two commands emit nothing");
    expect(generation).toContain("carries raw\n  issue evidence between them");
    expect(skill).toContain("never\n  pass `draft.md` itself");
    expect(workflow).toContain("cannot mutate `draft.md`");
    // The judge's brief is composed too, so its rubric is English every time
    // and the only Chinese in it is the plan's own quoted sentences.
    expect(skill).toContain(
      "bun <SKILL_DIR>/scripts/compose_check_brief.ts workflow.json <unit-id|whole> <brief>",
    );
    expect(skill).toContain("compose_check_brief.ts workflow.json whole <brief>");
  });

  it("teaches one different version instead of a graded series of settings", () => {
    // 0.8.0 removed the four-step hard-place escalation; 0.9.0 retired the
    // register it had been taught in. The rule that replaces it is a single
    // sentence, stated in both places an orchestrator reads method from.
    for (const text of [skill, generation, workflow]) {
      expect(text).not.toMatch(/Escalate one step/);
      expect(text).not.toContain("Hard-place escalation");
      expect(text).not.toContain("different reasoning setting");
    }
    expect(skill).toContain("Do not produce a graded series of settings.");
    expect(workflow).toContain("Do not produce a graded series of settings.");
    for (const text of [skill, workflow]) {
      expect(text).toMatch(/differs\s+in kind/);
      expect(text).toContain("`reject-candidates`");
    }
    // The choice gate itself stays: it is a real stage the viewer renders.
    expect(skill).toContain('stage: "choice"');
    expect(skill).toContain("`choose-candidate`");
  });

  it("keeps the retired ladder register out of every file read as method", () => {
    // The orchestrator learns its own nouns from this text, and a word it
    // learns here comes back out in what it writes. The mode has no ladder, no
    // rungs, and no disruption dial; nothing that teaches method may still
    // speak as though it did.
    for (const file of skillTextFiles) {
      const text = readFileSync(file, "utf8");
      const hits = text
        .split("\n")
        .map((line, index) => [index + 1, line] as const)
        .filter(([, line]) => /ladder|rung|disruption/i.test(line))
        .map(([line, text]) => `${file}:${line}: ${text.trim()}`);
      expect(hits).toEqual([]);
    }
    // And the sweep actually looked at more than the three files above.
    expect(skillTextFiles.length).toBeGreaterThan(5);
    expect(skillTextFiles.some((file) => file.endsWith("distill.workflow.js"))).toBe(true);
    expect(skillTextFiles.some((file) => file.endsWith("distill.md"))).toBe(true);
  });

  it("composes the repair with the writer's framing, not the judge's brief", () => {
    // A repairer handed the judge's brief answers like a judge; the parts
    // directory is what turns the repair back into writing, so the sequence
    // that passes it has to be the one the orchestrator reads.
    expect(skill).toContain(
      "run_check_cycle.ts <candidate> <brief> <scope> <result> <parts-dir>",
    );
    expect(generation).toContain(
      "run_check_cycle.ts <candidate> <check-brief> <scope> <result> <parts-dir>",
    );
    expect(generation).toContain("`<current_text>`");
    expect(generation).toContain("`<issues>`");
    // The whole piece has no parts directory, and the skill says so rather
    // than leaving the orchestrator to invent one.
    expect(skill).toContain("runs with four arguments");
    expect(generation).toContain("no parts directory");
  });

  it("keeps the linted vocabulary out of the skill prose the orchestrator learns from", () => {
    // The orchestrator carries this skill's nouns into everything it still
    // writes in Chinese, so the skill text must not teach the words the brief
    // lint refuses.
    const linted = readFileSync(
      join(root, "skill", "references", "primer", "brief-lint.txt"),
      "utf8",
    )
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    for (const term of linted) {
      expect(skill.includes(term)).toBe(false);
      expect(generation.includes(term)).toBe(false);
      expect(workflow.includes(term)).toBe(false);
    }
  });
});

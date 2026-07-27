import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
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
      "<SKILL_DIR>/scripts/run_check_cycle.sh <candidate> <brief> <scope> <result>",
    );
    expect(skill).toContain("every repair still goes through `run_leaf.sh repair`");
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

  it("makes the private check exchange executable instead of prompt-only", () => {
    expect(skill).toContain("project_check_cycle.sh unit");
    expect(skill).toContain("project_check_cycle.sh whole");
    expect(skill).toContain("These two commands emit nothing");
    expect(generation).toContain("carries raw\n  issue evidence between them");
    expect(skill).toContain("never\n  pass `draft.md` itself");
    expect(workflow).toContain("cannot mutate `draft.md`");
  });
});

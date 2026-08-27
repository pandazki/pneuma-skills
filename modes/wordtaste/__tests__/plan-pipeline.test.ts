import { describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ViewerFileContent } from "../../../core/types/viewer-contract.js";
import { loadWorkflow } from "../domain.js";

const scriptsDir = join(import.meta.dir, "..", "skill", "scripts");
const validatePath = join(scriptsDir, "validate_plan.ts");
const composePlanPath = join(scriptsDir, "compose_plan_prompt.ts");
const projectPlanPath = join(scriptsDir, "project_plan.ts");
const unitPartsPath = join(scriptsDir, "compose_unit_parts.ts");
const checkBriefPath = join(scriptsDir, "compose_check_brief.ts");
const schemaPath = join(import.meta.dir, "..", "skill", "references", "plan-schema.json");
const fixturesDir = join(import.meta.dir, "fixtures");

/**
 * The four golden prompts below were recorded from these same composers before
 * their English sentences moved out into `references/prompt-scaffolding.en.json`
 * for the Claude Workflow path to share. They are the proof that the move
 * changed no byte of what a planner, a writer, or a judge reads. Regenerate one
 * only when its wording is meant to change, and say so in the same commit.
 */
function golden(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf8");
}

/**
 * Everything below is synthetic: an invented essay about two workbenches,
 * written for this test. No published text and no author appear anywhere.
 * Every spawn gets its own HOME, PNEUMA_SESSION_DIR, and PNEUMA_PROJECT_ROOT
 * under a temp dir, so no script can reach a real workspace or primer library.
 */
const ORIGINAL = [
  "# 两张工作台",
  "",
  "## 一、开工之前",
  "",
  "第一张台子只做粗活，三年里换过四套夹具，大部分时候够用。",
  "",
  "第二张台子做细活，谁也不许在上面放锤子。",
  "",
  "## 二、卡住的地方",
  "",
  "粗活的碎屑落进细活的槽里，第二天谁都不认这笔账。",
  "",
  "## 三、怎么分",
  "",
  "把两张台子隔开，碎屑就不会跑过去。",
  "",
].join("\n");

const GOAL = "把两张工作台的事写清楚，给自己带团队的人看。\n";

const TITLE = "两张工作台";
const CLAIM = "粗活的碎屑落进细活的槽里，第二天谁都不认这笔账。";
const KEEP_U1 = "第一张台子只做粗活，三年里换过四套夹具，大部分时候够用。";
const OPEN_QUESTION = "要不要把第三节也写进来？";

/** U+3000-U+9FFF plus the full-width forms: the same range the other suites use. */
const CJK = /[　-〿㐀-鿿＀-￯]/;

interface Plan {
  version: number;
  title: string;
  claims: Array<{ text: string; source: string }>;
  units: Array<{
    id: string;
    role: string;
    spans: Array<{ file: string; from: string; to: string }>;
    must_keep: string[];
    target_chars: number;
    pace: string;
    ends: string;
    notes_en: string;
    opens_section?: boolean;
  }>;
  open_question?: string;
}

function basePlan(): Plan {
  return {
    version: 1,
    title: TITLE,
    claims: [{ text: CLAIM, source: "materials/original.md#L11" }],
    units: [
      {
        id: "u1",
        role: "background",
        spans: [
          {
            file: "materials/original.md",
            from: "## 一、开工之前",
            to: "## 二、卡住的地方",
          },
        ],
        must_keep: [KEEP_U1],
        target_chars: 700,
        pace: "loose",
        ends: "open",
        notes_en:
          "The reader has not seen either bench yet. Show both and stop before the trouble starts.",
      },
      {
        id: "u2",
        role: "problem",
        spans: [{ file: "materials/original.md", from: "## 二、卡住的地方", to: "" }],
        must_keep: [CLAIM],
        target_chars: 800,
        pace: "dense",
        ends: "stop",
        notes_en: "Do not resolve anything here.",
      },
    ],
    open_question: OPEN_QUESTION,
  };
}

const BASE_WORKFLOW = {
  version: 2,
  stage: "intake",
  goal: "把两张工作台的事写清楚",
  entry: "draft",
  taskId: "task-bench",
  emphasis: [1],
  progress: { currentUnit: "", completedUnits: [], totalUnits: 0, note: "" },
  review: { summary: "", issues: [] },
  candidates: [],
};

interface Harness {
  root: string;
  planDir: string;
  planFile: string;
  workflowFile: string;
  env: Record<string, string>;
}

/** One content set: materials, workflow.json, and the private plan inputs. */
function makeHarness(prefix: string): Harness {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const home = join(root, "home");
  const planDir = join(root, ".pneuma", "private", "plan");
  mkdirSync(home, { recursive: true });
  mkdirSync(join(root, "materials"), { recursive: true });
  mkdirSync(planDir, { recursive: true });
  writeFileSync(join(root, "materials", "original.md"), ORIGINAL);
  writeFileSync(join(planDir, "goal.md"), GOAL);
  writeFileSync(join(planDir, "material.md"), ORIGINAL);
  const workflowFile = join(root, "workflow.json");
  writeFileSync(workflowFile, `${JSON.stringify(BASE_WORKFLOW, null, 2)}\n`);
  const planFile = join(root, "plan.json");
  writeFileSync(planFile, `${JSON.stringify(basePlan(), null, 2)}\n`);
  return {
    root,
    planDir,
    planFile,
    workflowFile,
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: home,
      TMPDIR: process.env.TMPDIR ?? "/tmp",
      LANG: "en_US.UTF-8",
      PNEUMA_SESSION_DIR: root,
      PNEUMA_PROJECT_ROOT: home,
    },
  };
}

async function run(
  harness: Harness,
  script: string,
  args: string[],
): Promise<{ status: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([process.execPath, script, ...args], {
    cwd: harness.root,
    env: harness.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [status, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { status, stdout, stderr };
}

async function withHarness(prefix: string, fn: (harness: Harness) => Promise<void>) {
  const harness = makeHarness(prefix);
  try {
    await fn(harness);
  } finally {
    rmSync(harness.root, { recursive: true, force: true });
  }
}

function writePlan(harness: Harness, mutate: (plan: Plan) => void): void {
  const plan = basePlan();
  mutate(plan);
  writeFileSync(harness.planFile, `${JSON.stringify(plan, null, 2)}\n`);
}

function validateArgs(harness: Harness): string[] {
  return [
    harness.planFile,
    join(harness.planDir, "goal.md"),
    join(harness.planDir, "material.md"),
  ];
}

describe("validate_plan.ts — the verbatim guard", () => {
  it("accepts a plan whose Chinese is all quoted from the human input", async () => {
    await withHarness("wordtaste-plan-ok-", async (harness) => {
      const result = await run(harness, validatePath, validateArgs(harness));
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
    });
  }, 20_000);

  it("rejects a claim the planner reworded, without quoting it back", async () => {
    await withHarness("wordtaste-plan-paraphrase-", async (harness) => {
      // One character changed: 落进 -> 落到. A writer transcribes its brief, so
      // a "clarified" claim would arrive in the finished essay as the
      // planner's Chinese.
      writePlan(harness, (plan) => {
        plan.claims[0].text = CLAIM.replace("落进", "落到");
      });
      const result = await run(harness, validatePath, validateArgs(harness));
      expect(result.status).toBe(2);
      expect(result.stderr).toContain(
        "wordtaste: plan — claims[].text is not a verbatim quote from the material",
      );
      // The diagnosis must not become one more visible artifact.
      expect(CJK.test(result.stderr)).toBe(false);
      expect(result.stdout).toBe("");
    });
  }, 20_000);

  it("rejects a must_keep sentence that lives outside its own unit's spans", async () => {
    await withHarness("wordtaste-plan-span-", async (harness) => {
      // The sentence is genuinely in the material — just not in u1's range.
      writePlan(harness, (plan) => {
        plan.units[0].must_keep = [CLAIM];
      });
      const result = await run(harness, validatePath, validateArgs(harness));
      expect(result.status).toBe(2);
      expect(result.stderr).toContain(
        "wordtaste: plan — units[].must_keep[] is not a verbatim quote from the material",
      );
    });
  }, 20_000);

  it("accepts opens_section, and rejects anything that is not a boolean", async () => {
    // Where a section opens is the plan's call; what it is called is the
    // writer's. A boolean is the whole of the plan's say in it, which is why
    // sections cost the verbatim rule nothing.
    await withHarness("wordtaste-plan-section-ok-", async (harness) => {
      writePlan(harness, (plan) => {
        plan.units[0].opens_section = true;
      });
      const result = await run(harness, validatePath, validateArgs(harness));
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
    });
    await withHarness("wordtaste-plan-section-bad-", async (harness) => {
      writePlan(harness, (plan) => {
        (plan.units[0] as Record<string, unknown>).opens_section = "两条腿走路";
      });
      const result = await run(harness, validatePath, validateArgs(harness));
      expect(result.status).toBe(2);
      expect(result.stderr).toContain(
        "wordtaste: plan — units[].opens_section does not match the schema",
      );
    });
  }, 40_000);

  it("rejects Chinese in notes_en", async () => {
    await withHarness("wordtaste-plan-notes-", async (harness) => {
      writePlan(harness, (plan) => {
        plan.units[0].notes_en = "先交代背景，再讲问题。";
      });
      const result = await run(harness, validatePath, validateArgs(harness));
      expect(result.status).toBe(2);
      expect(result.stderr).toContain(
        "wordtaste: plan — units[].notes_en does not match the schema",
      );
    });
  }, 20_000);

  it("leaves the one user-facing field free: Chinese in open_question passes", async () => {
    await withHarness("wordtaste-plan-question-", async (harness) => {
      writePlan(harness, (plan) => {
        plan.open_question = "第三节要不要单独成段？这句不在原文里。";
      });
      const result = await run(harness, validatePath, validateArgs(harness));
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
    });
  }, 20_000);

  it("rejects a bad enum, a missing unit, a duplicate id, and a span that is not in the file", async () => {
    await withHarness("wordtaste-plan-shape-", async (harness) => {
      const cases: Array<[string, (plan: Plan) => void]> = [
        ["units[].role", (plan) => { plan.units[0].role = "middle"; }],
        ["units", (plan) => { plan.units = []; }],
        ["units[].id", (plan) => { plan.units[1].id = "u1"; }],
        ["units[].target_chars", (plan) => { plan.units[0].target_chars = 120; }],
        ["units[].spans[].to", (plan) => { plan.units[0].spans[0].to = "## 九、不存在的一节"; }],
        ["units[].spans[].from", (plan) => { plan.units[0].spans[0].from = "## 一、开工之前 "; }],
        ["units[].spans[].file", (plan) => { plan.units[0].spans[0].file = "../outside.md"; }],
        ["claims", (plan) => { plan.claims = []; }],
        ["version", (plan) => { plan.version = 2; }],
      ];
      for (const [field, mutate] of cases) {
        writePlan(harness, mutate);
        const result = await run(harness, validatePath, validateArgs(harness));
        expect(result.status).toBe(2);
        expect(result.stderr).toContain(`wordtaste: plan — ${field} does not match the schema`);
      }
    });
  }, 30_000);

  it("refuses to run without a plan and at least one human input", async () => {
    await withHarness("wordtaste-plan-usage-", async (harness) => {
      const result = await run(harness, validatePath, [harness.planFile]);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("usage: validate_plan.ts");
    });
  }, 20_000);
});

describe("compose_plan_prompt.ts — the planner's prompt", () => {
  it("marks itself, embeds the schema, and quotes goal and material verbatim", async () => {
    await withHarness("wordtaste-plan-compose-", async (harness) => {
      const out = join(harness.planDir, "prompt.md");
      const result = await run(harness, composePlanPath, [harness.planDir, out]);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");

      const prompt = readFileSync(out, "utf8");
      expect(prompt.split("\n")[0]).toBe("<!-- wordtaste:composed v1 plan -->");
      expect(prompt).toContain(readFileSync(schemaPath, "utf8").trimEnd());
      expect(prompt).toContain(`<goal>\n${GOAL}</goal>`);
      expect(prompt).toContain(`<material>\n${ORIGINAL}</material>`);
      expect(prompt).toContain("Output the JSON object only.");
      // The rule the whole plan exists to obey is stated to the planner.
      expect(prompt).toContain("character for character");
      expect(prompt).toContain("`notes_en`");
      expect(prompt).toContain("`open_question`");
      expect(prompt).toContain("600-1200 Chinese characters");
    });
  }, 20_000);

  it("writes no Chinese of its own: every CJK character sits inside a human part", async () => {
    await withHarness("wordtaste-plan-english-", async (harness) => {
      writeFileSync(join(harness.planDir, "voice.md"), "作者自己的一段旧文，用来定调子。\n");
      const out = join(harness.planDir, "prompt.md");
      expect((await run(harness, composePlanPath, [harness.planDir, out])).status).toBe(0);
      const prompt = readFileSync(out, "utf8");
      expect(prompt).toContain("<voice>\n作者自己的一段旧文，用来定调子。\n</voice>");

      const scaffolding = prompt
        .replace(/<goal>[\s\S]*?<\/goal>/g, "")
        .replace(/<material>[\s\S]*?<\/material>/g, "")
        .replace(/<voice>[\s\S]*?<\/voice>/g, "");
      expect(CJK.test(scaffolding)).toBe(false);
    });
  }, 20_000);

  it("composes the recorded planner prompt byte for byte", async () => {
    await withHarness("wordtaste-plan-golden-", async (harness) => {
      writeFileSync(join(harness.planDir, "voice.md"), "作者自己的一段旧文，用来定调子。\n");
      const out = join(harness.planDir, "prompt.md");
      const result = await run(harness, composePlanPath, [harness.planDir, out]);
      expect(result).toEqual({ status: 0, stdout: "", stderr: "" });
      expect(readFileSync(out, "utf8")).toBe(golden("plan-prompt.golden.md"));
    });
  }, 20_000);

  it("refuses a parts directory without a goal or without material", async () => {
    await withHarness("wordtaste-plan-parts-", async (harness) => {
      const empty = join(harness.root, "empty-parts");
      mkdirSync(empty, { recursive: true });
      const result = await run(harness, composePlanPath, [empty, join(empty, "prompt.md")]);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("required part is missing");
      expect(existsSync(join(empty, "prompt.md"))).toBe(false);
    });
  }, 20_000);
});

describe("project_plan.ts — plan into the viewer's workflow.json", () => {
  it("fills the fields the viewer reads with fixed labels and verbatim quotes", async () => {
    await withHarness("wordtaste-project-plan-", async (harness) => {
      const result = await run(harness, projectPlanPath, [
        harness.planFile,
        harness.workflowFile,
      ]);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");

      // Read it the way the viewer does, through the domain loader.
      const files: ViewerFileContent[] = [
        { path: "workflow.json", content: readFileSync(harness.workflowFile, "utf8") },
      ];
      const state = loadWorkflow(files)!;
      expect(state.stage).toBe("layout");
      expect(state.layout!.title).toBe(TITLE);
      expect(state.layout!.thesis).toEqual([CLAIM]);
      expect(state.layout!.openQuestion).toBe(OPEN_QUESTION);
      expect(state.layout!.units).toEqual([
        {
          id: "u1",
          role: "交代背景",
          brief: "## 一、开工之前 … ## 二、卡住的地方",
          rhythm: "疏，留个口",
          targetChars: 700,
        },
        {
          id: "u2",
          role: "把问题摆到读者面前",
          brief: "## 二、卡住的地方 …",
          rhythm: "密，说完就停",
          targetChars: 800,
        },
      ]);
      // Nothing a model wrote in its own words reached the viewer: every
      // Chinese string above is either a fixed label or a line of the material.
      for (const unit of state.layout!.units) {
        expect(ORIGINAL).toContain(unit.brief.split(" …")[0]);
      }
    });
  }, 20_000);

  it("round-trips the whole plan under layout.plan and leaves every other field alone", async () => {
    await withHarness("wordtaste-project-keep-", async (harness) => {
      expect(
        (await run(harness, projectPlanPath, [harness.planFile, harness.workflowFile])).status,
      ).toBe(0);
      const written = JSON.parse(readFileSync(harness.workflowFile, "utf8"));
      expect(written.layout.plan).toEqual(basePlan());
      expect(written.emphasis).toEqual([1]);
      expect(written.taskId).toBe("task-bench");
      expect(written.entry).toBe("draft");
      expect(written.goal).toBe(BASE_WORKFLOW.goal);
      expect(written.progress).toEqual(BASE_WORKFLOW.progress);
      expect(written.review).toEqual(BASE_WORKFLOW.review);
      expect(written.candidates).toEqual([]);
      // Atomic rewrite: the staged file is moved, never left behind.
      expect(readdirSync(harness.root).filter((name) => name.includes(".tmp."))).toEqual([]);
    });
  }, 20_000);

  it("refuses an invalid or unit-less plan instead of half-writing workflow.json", async () => {
    await withHarness("wordtaste-project-bad-", async (harness) => {
      const before = readFileSync(harness.workflowFile, "utf8");
      writeFileSync(harness.planFile, "{ not json ");
      const broken = await run(harness, projectPlanPath, [
        harness.planFile,
        harness.workflowFile,
      ]);
      expect(broken.status).toBe(2);
      expect(readFileSync(harness.workflowFile, "utf8")).toBe(before);

      writePlan(harness, (plan) => {
        plan.units = [];
      });
      const empty = await run(harness, projectPlanPath, [
        harness.planFile,
        harness.workflowFile,
      ]);
      expect(empty.status).toBe(2);
      expect(readFileSync(harness.workflowFile, "utf8")).toBe(before);
    });
  }, 20_000);
});

describe("compose_unit_parts.ts — one unit's parts directory", () => {
  async function project(harness: Harness): Promise<void> {
    expect(
      (await run(harness, projectPlanPath, [harness.planFile, harness.workflowFile])).status,
    ).toBe(0);
  }

  it("slices the span heading-to-heading, excluding the closing heading", async () => {
    await withHarness("wordtaste-parts-slice-", async (harness) => {
      await project(harness);
      const parts = join(harness.root, ".pneuma", "private", "u1");
      const result = await run(harness, unitPartsPath, [harness.workflowFile, "u1", parts]);
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");

      const material = readFileSync(join(parts, "material.md"), "utf8");
      expect(material).toBe(
        ["## 一、开工之前", "", KEEP_U1, "", "第二张台子做细活，谁也不许在上面放锤子。", "", ""].join("\n"),
      );
      expect(material).not.toContain("## 二、卡住的地方");
    });
  }, 20_000);

  it("runs an empty `to` to the end of the file", async () => {
    await withHarness("wordtaste-parts-eof-", async (harness) => {
      await project(harness);
      const parts = join(harness.root, ".pneuma", "private", "u2");
      expect((await run(harness, unitPartsPath, [harness.workflowFile, "u2", parts])).status).toBe(
        0,
      );
      const material = readFileSync(join(parts, "material.md"), "utf8");
      expect(material.startsWith("## 二、卡住的地方")).toBe(true);
      expect(material).toContain("把两张台子隔开，碎屑就不会跑过去。");
    });
  }, 20_000);

  it("writes an English brief, verbatim kernel, and the first-unit title constraint", async () => {
    await withHarness("wordtaste-parts-brief-", async (harness) => {
      await project(harness);
      const parts = join(harness.root, ".pneuma", "private", "u1");
      expect((await run(harness, unitPartsPath, [harness.workflowFile, "u1", parts])).status).toBe(
        0,
      );

      const brief = readFileSync(join(parts, "brief.en.md"), "utf8");
      expect(brief).toContain(`Its title is: ${TITLE}`);
      expect(brief).toContain("This section establishes the background");
      expect(brief).toContain("Show both and stop before the trouble starts.");
      expect(brief).toContain("Let it breathe");
      expect(brief).toContain("Leave the ending open");
      expect(brief).toContain("Length: roughly 700 Chinese characters");
      expect(brief).toContain("Stop where this section's material ends.");
      // The only Chinese a generated brief may carry is the author's title.
      expect(brief.replace(TITLE, "")).not.toMatch(CJK);

      expect(readFileSync(join(parts, "kernel.md"), "utf8").trim()).toBe(KEEP_U1);
      expect(readFileSync(join(parts, "constraints.en.md"), "utf8")).toContain(
        "First line: the author's own title",
      );
    });
  }, 20_000);

  it("writes the recorded English brief byte for byte", async () => {
    await withHarness("wordtaste-parts-golden-", async (harness) => {
      await project(harness);
      const parts = join(harness.root, ".pneuma", "private", "u1");
      expect((await run(harness, unitPartsPath, [harness.workflowFile, "u1", parts])).status).toBe(
        0,
      );
      expect(readFileSync(join(parts, "brief.en.md"), "utf8")).toBe(
        golden("unit-brief.golden.md"),
      );
    });
  }, 20_000);

  it("tells every later unit not to repeat the title", async () => {
    await withHarness("wordtaste-parts-later-", async (harness) => {
      await project(harness);
      const parts = join(harness.root, ".pneuma", "private", "u2");
      expect((await run(harness, unitPartsPath, [harness.workflowFile, "u2", parts])).status).toBe(
        0,
      );
      expect(readFileSync(join(parts, "constraints.en.md"), "utf8")).toBe(
        "- Do not repeat the title.\n",
      );
    });
  }, 20_000);

  it("carries the preceding prose only when the draft is not empty", async () => {
    await withHarness("wordtaste-parts-preceding-", async (harness) => {
      await project(harness);
      const parts = join(harness.root, ".pneuma", "private", "u2");
      writeFileSync(join(harness.root, "draft.md"), "");
      expect((await run(harness, unitPartsPath, [harness.workflowFile, "u2", parts])).status).toBe(
        0,
      );
      expect(existsSync(join(parts, "preceding.md"))).toBe(false);

      const finished = "第一节写完了，两张台子都摆出来了。\n";
      writeFileSync(join(harness.root, "draft.md"), finished);
      expect((await run(harness, unitPartsPath, [harness.workflowFile, "u2", parts])).status).toBe(
        0,
      );
      expect(readFileSync(join(parts, "preceding.md"), "utf8")).toBe(finished);
    });
  }, 20_000);

  it("takes the asset slots out of the preceding prose and leaves the sections in", async () => {
    // `<preceding_prose>` is the last thing a writer reads, and a block of
    // keys and values in that position is a register it would imitate. The
    // workflow path has its own guard on the same rule; this is the script
    // path, which is the one most backends actually run.
    await withHarness("wordtaste-parts-asset-", async (harness) => {
      await project(harness);
      const parts = join(harness.root, ".pneuma", "private", "u2");
      const fence = "`".repeat(3);
      writeFileSync(
        join(harness.root, "draft.md"),
        [
          "# 两张工作台",
          "",
          "第一节写完了，两张台子都摆出来了。",
          "",
          `${fence}asset`,
          "what: 一张示意图，两张工作台并排",
          "copy: 粗活台",
          fence,
          "",
          "## 两条腿走路",
          "",
          "第二节接着写。",
          "",
        ].join("\n"),
      );
      expect((await run(harness, unitPartsPath, [harness.workflowFile, "u2", parts])).status).toBe(
        0,
      );
      expect(readFileSync(join(parts, "preceding.md"), "utf8")).toBe(
        "# 两张工作台\n\n第一节写完了，两张台子都摆出来了。\n\n## 两条腿走路\n\n第二节接着写。\n",
      );
    });
  }, 20_000);

  /**
   * The content set's `taste/` is where the distill step leaves what it has
   * learned about how this person writes. The unit composer wires it through
   * to `voice_sample.ts`, which is the only step allowed to touch it — and the
   * whole path stays silent for a content set whose taste has not grown yet,
   * which is every content set on its first task.
   */
  it("samples the user's voice out of the content set's taste directory", async () => {
    await withHarness("wordtaste-parts-voice-", async (harness) => {
      await project(harness);
      mkdirSync(join(harness.root, "taste", "examples"), { recursive: true });
      writeFileSync(
        join(harness.root, "taste", "style.en.md"),
        [
          "Open on the concrete case, never on a definition. <!-- evidence: swap #3 -->",
          "",
        ].join("\n"),
      );
      writeFileSync(
        join(harness.root, "taste", "examples", "swaps.jsonl"),
        `${JSON.stringify({
          before: "这个问题值得注意的是并不简单。",
          after: "这个问题不简单。",
        })}\n`,
      );

      const parts = join(harness.root, ".pneuma", "private", "u1");
      const result = await run(harness, unitPartsPath, [harness.workflowFile, "u1", parts]);
      expect([result.status, result.stdout, result.stderr]).toEqual([0, "", ""]);

      expect(readFileSync(join(parts, "voice_style.en.md"), "utf8")).toBe(
        "Open on the concrete case, never on a definition.\n",
      );
      expect(readFileSync(join(parts, "voice_examples.md"), "utf8")).toBe(
        ["- 这个问题值得注意的是并不简单。", "+ 这个问题不简单。", ""].join("\n"),
      );
    });
  }, 20_000);

  it("gives two units of one essay different draws from the same taste", async () => {
    await withHarness("wordtaste-parts-voice-seed-", async (harness) => {
      await project(harness);
      mkdirSync(join(harness.root, "taste", "examples", "positive"), { recursive: true });
      const sentence = "这是一段没有来源的测试文字只用来凑够长度好让窗口挑得动。";
      const paragraphs: string[] = [];
      for (let i = 1; i <= 12; i += 1) {
        paragraphs.push(`${i}、${sentence.repeat(5)}`);
      }
      writeFileSync(
        join(harness.root, "taste", "examples", "positive", "accepted.md"),
        `${paragraphs.join("\n\n")}\n`,
      );

      const draws = new Set<string>();
      for (const unit of ["u1", "u2"]) {
        const parts = join(harness.root, ".pneuma", "private", unit);
        expect(
          (await run(harness, unitPartsPath, [harness.workflowFile, unit, parts])).status,
        ).toBe(0);
        draws.add(readFileSync(join(parts, "voice_examples.md"), "utf8"));
      }
      expect(draws.size).toBe(2);

      // And re-composing one unit reads back what it read the first time.
      const parts = join(harness.root, ".pneuma", "private", "u1");
      const first = readFileSync(join(parts, "voice_examples.md"), "utf8");
      expect(
        (await run(harness, unitPartsPath, [harness.workflowFile, "u1", parts])).status,
      ).toBe(0);
      expect(readFileSync(join(parts, "voice_examples.md"), "utf8")).toBe(first);
    });
  }, 30_000);

  it("says nothing and writes no voice part when the content set has no taste yet", async () => {
    await withHarness("wordtaste-parts-voice-empty-", async (harness) => {
      await project(harness);
      const parts = join(harness.root, ".pneuma", "private", "u1");
      const result = await run(harness, unitPartsPath, [harness.workflowFile, "u1", parts]);
      expect([result.status, result.stdout, result.stderr]).toEqual([0, "", ""]);
      expect(existsSync(join(parts, "voice_style.en.md"))).toBe(false);
      expect(existsSync(join(parts, "voice_examples.md"))).toBe(false);
      // Nothing was logged either: an absent taste directory is the normal
      // state of a first task, not a failure to report.
      expect(existsSync(join(harness.root, ".pneuma", "leaf-logs"))).toBe(false);
    });
  }, 20_000);

  it("refuses an unknown unit id and a workflow without a plan", async () => {
    await withHarness("wordtaste-parts-bad-", async (harness) => {
      const parts = join(harness.root, ".pneuma", "private", "u9");
      const noPlan = await run(harness, unitPartsPath, [harness.workflowFile, "u1", parts]);
      expect(noPlan.status).toBe(2);
      expect(noPlan.stderr).toContain("carries no plan");

      await project(harness);
      const unknown = await run(harness, unitPartsPath, [harness.workflowFile, "u9", parts]);
      expect(unknown.status).toBe(2);
      expect(unknown.stderr).toContain("no unit with that id");
    });
  }, 20_000);

  /**
   * The creation posture (0.15.0). The stored workflow's `entry` field is
   * carried to the prompt composer as a metadata part named `entry`, written
   * only for `"idea"` and removed for anything else — so a workflow whose
   * entry changed cannot leave the old charter behind, and every pre-0.15.0
   * parts directory composes byte-identically.
   */
  it("carries entry idea to the parts directory, and removes a stale part", async () => {
    await withHarness("wordtaste-parts-entry-", async (harness) => {
      await project(harness);
      const parts = join(harness.root, ".pneuma", "private", "u1");

      const setEntry = (entry: string | undefined) => {
        const workflow = JSON.parse(readFileSync(harness.workflowFile, "utf8"));
        if (entry === undefined) delete workflow.entry;
        else workflow.entry = entry;
        writeFileSync(harness.workflowFile, `${JSON.stringify(workflow, null, 2)}\n`);
      };

      setEntry("idea");
      expect((await run(harness, unitPartsPath, [harness.workflowFile, "u1", parts])).status).toBe(0);
      expect(readFileSync(join(parts, "entry"), "utf8")).toBe("idea\n");

      // Back to draft: the stale part is removed, not left to select the old
      // charter.
      setEntry("draft");
      expect((await run(harness, unitPartsPath, [harness.workflowFile, "u1", parts])).status).toBe(0);
      expect(existsSync(join(parts, "entry"))).toBe(false);

      // A workflow without the field — every workflow before it existed —
      // writes none either.
      setEntry("idea");
      expect((await run(harness, unitPartsPath, [harness.workflowFile, "u1", parts])).status).toBe(0);
      setEntry(undefined);
      expect((await run(harness, unitPartsPath, [harness.workflowFile, "u1", parts])).status).toBe(0);
      expect(existsSync(join(parts, "entry"))).toBe(false);
    });
  }, 20_000);
});

/**
 * The from-idea entry plans over two verbatim sources: the author's outline
 * and `materials/notes.md`, the interview record whose sentences are the
 * user's own chat answers copied verbatim. Both are copied into the plan
 * parts, both are named by spans, and the verbatim guard quotes from both —
 * with no logic change to `validate_plan.ts`: it always took `<human-input>...`
 * and always resolved spans against the real files.
 */
describe("validate_plan.ts — from-idea planning over outline + notes", () => {
  const OUTLINE = [
    "# 写作素材",
    "",
    "## 这篇文章要完成什么",
    "",
    "想说清楚为什么小作坊也要分两张工作台。",
    "",
    "## 现在手里有哪些材料",
    "",
    "- 我们车间去年把粗活和细活分开，返工少了差不多三成。",
    "",
  ].join("\n");
  const NOTES = [
    "# 访谈记录",
    "",
    "## 2026-08-24 谁来读",
    "",
    "写给自己带小团队的人看，他们手上都有活，不用解释什么是工作台。",
    "",
    "## 2026-08-24 不能写错的判断",
    "",
    "分台不是为了整洁，是为了出了问题能认账。这句话不能软。",
    "",
  ].join("\n");
  const NOTES_KEEP = "分台不是为了整洁，是为了出了问题能认账。这句话不能软。";
  const OUTLINE_KEEP = "我们车间去年把粗活和细活分开，返工少了差不多三成。";

  function ideaPlan(): Plan {
    return {
      version: 1,
      title: "写作素材",
      claims: [{ text: NOTES_KEEP, source: "materials/notes.md#L9" }],
      units: [
        {
          id: "u1",
          role: "background",
          spans: [
            { file: "materials/outline.md", from: "## 现在手里有哪些材料", to: "" },
          ],
          must_keep: [OUTLINE_KEEP],
          target_chars: 700,
          pace: "loose",
          ends: "open",
          notes_en: "Open on the workshop itself; the reader has not seen the two benches yet.",
        },
        {
          id: "u2",
          role: "conclusion",
          spans: [
            { file: "materials/notes.md", from: "## 2026-08-24 不能写错的判断", to: "" },
          ],
          must_keep: [NOTES_KEEP],
          target_chars: 600,
          pace: "dense",
          ends: "stop",
          notes_en: "This judgment must not soften. State it and stop.",
        },
      ],
    };
  }

  function stageIdea(harness: Harness, plan: Plan): string[] {
    writeFileSync(join(harness.root, "materials", "outline.md"), OUTLINE);
    writeFileSync(join(harness.root, "materials", "notes.md"), NOTES);
    // The plan-input step of SKILL.md: outline and notes concatenated into
    // material.md, each under a comment line naming its file so the planner
    // can place spans; the Chinese itself is byte-for-byte.
    writeFileSync(
      join(harness.planDir, "material.md"),
      `<!-- materials/outline.md -->\n${OUTLINE}\n<!-- materials/notes.md -->\n${NOTES}`,
    );
    writeFileSync(harness.planFile, `${JSON.stringify(plan, null, 2)}\n`);
    return [
      harness.planFile,
      join(harness.planDir, "goal.md"),
      join(harness.planDir, "material.md"),
    ];
  }

  it("accepts a plan that quotes the outline and the interview notes", async () => {
    await withHarness("wordtaste-plan-idea-ok-", async (harness) => {
      const result = await run(harness, validatePath, stageIdea(harness, ideaPlan()));
      expect(result).toEqual({ status: 0, stdout: "", stderr: "" });
    });
  }, 20_000);

  it("still refuses a softened judgment from the notes", async () => {
    await withHarness("wordtaste-plan-idea-soft-", async (harness) => {
      const plan = ideaPlan();
      // The judgment the user said must never soften, softened by one word.
      plan.units[1].must_keep = [NOTES_KEEP.replace("不能软", "尽量不要软")];
      const result = await run(harness, validatePath, stageIdea(harness, plan));
      expect(result.status).toBe(2);
      expect(result.stderr).toContain(
        "wordtaste: plan — units[].must_keep[] is not a verbatim quote from the material",
      );
      expect(CJK.test(result.stderr)).toBe(false);
    });
  }, 20_000);

  it("refuses a notes sentence claimed from an outline span", async () => {
    await withHarness("wordtaste-plan-idea-span-", async (harness) => {
      const plan = ideaPlan();
      // Genuinely in the notes — but u1's spans cover only the outline.
      plan.units[0].must_keep = [NOTES_KEEP];
      const result = await run(harness, validatePath, stageIdea(harness, plan));
      expect(result.status).toBe(2);
      expect(result.stderr).toContain(
        "wordtaste: plan — units[].must_keep[] is not a verbatim quote from the material",
      );
    });
  }, 20_000);
});

describe("compose_check_brief.ts — the judge's brief", () => {
  async function project(harness: Harness): Promise<void> {
    expect(
      (await run(harness, projectPlanPath, [harness.planFile, harness.workflowFile])).status,
    ).toBe(0);
  }

  it("renders the rubric in English, quotes must_keep, and states the output contract", async () => {
    await withHarness("wordtaste-brief-unit-", async (harness) => {
      await project(harness);
      const out = join(harness.root, ".pneuma", "private", "u1.check-brief.md");
      const result = await run(harness, checkBriefPath, [harness.workflowFile, "u1", out]);
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");

      const brief = readFileSync(out, "utf8");
      expect(brief).toContain("You are checking one section of a long-form Chinese essay.");
      expect(brief).toContain("## 1. Meaning first");
      expect(brief).toContain("## 2. Chinese a person would actually say");
      expect(brief).toContain("## 3. Pattern collapse");
      expect(brief).toContain("## 4. Readability is a separate axis");
      expect(brief).toContain("## 5. Colloquial language can also overshoot");
      expect(brief).toContain("## 6. Rechecking a repair");
      expect(brief).toContain("moved into a different form");
      expect(brief).toContain(`<must_keep>\n${KEEP_U1}\n</must_keep>`);
      expect(brief).toContain(
        '{"pass":boolean,"kernelOk":boolean,"issues":[{"kind":"meaning|style","quote":"exact quote","problem":"specific problem"}]}',
      );
      // Only the quoted sentences are Chinese; the rubric itself is English.
      expect(CJK.test(brief.replace(/<must_keep>[\s\S]*?<\/must_keep>/, ""))).toBe(false);
    });
  }, 20_000);

  it("aggregates every unit's sentences for the whole-piece check", async () => {
    await withHarness("wordtaste-brief-whole-", async (harness) => {
      await project(harness);
      const out = join(harness.root, ".pneuma", "private", "whole.check-brief.md");
      expect(
        (await run(harness, checkBriefPath, [harness.workflowFile, "whole", out])).status,
      ).toBe(0);
      const brief = readFileSync(out, "utf8");
      expect(brief).toContain("You are checking a complete long-form Chinese essay.");
      expect(brief).toContain(`<must_keep>\n${KEEP_U1}\n\n${CLAIM}\n</must_keep>`);
    });
  }, 20_000);

  it("renders both recorded briefs byte for byte", async () => {
    await withHarness("wordtaste-brief-golden-", async (harness) => {
      await project(harness);
      const unitOut = join(harness.root, ".pneuma", "private", "u1.check-brief.md");
      expect(
        (await run(harness, checkBriefPath, [harness.workflowFile, "u1", unitOut])).status,
      ).toBe(0);
      expect(readFileSync(unitOut, "utf8")).toBe(golden("check-brief-unit.golden.md"));

      const wholeOut = join(harness.root, ".pneuma", "private", "whole.check-brief.md");
      expect(
        (await run(harness, checkBriefPath, [harness.workflowFile, "whole", wholeOut])).status,
      ).toBe(0);
      expect(readFileSync(wholeOut, "utf8")).toBe(golden("check-brief-whole.golden.md"));
    });
  }, 20_000);

  it("refuses an unknown unit id", async () => {
    await withHarness("wordtaste-brief-bad-", async (harness) => {
      await project(harness);
      const out = join(harness.root, ".pneuma", "private", "u9.check-brief.md");
      const result = await run(harness, checkBriefPath, [harness.workflowFile, "u9", out]);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("no unit with that id");
      expect(existsSync(out)).toBe(false);
    });
  }, 20_000);
});

import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const skillDir = join(import.meta.dir, "..", "skill");
const scriptsDir = join(skillDir, "scripts");
const WORKFLOW_PATH = join(skillDir, "workflows", "writing.workflow.js");
const SCAFFOLD_PATH = join(skillDir, "references", "prompt-scaffolding.en.json");
const SCHEMA_PATH = join(skillDir, "references", "plan-schema.json");

const SOURCE = readFileSync(WORKFLOW_PATH, "utf8");
const CODE = SOURCE
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .map((line) => line.replace(/\/\/.*$/, ""))
  .join("\n");

/**
 * A workflow script cannot read a file, so it carries its own copy of the
 * English scaffolding, of the plan schema, and of the prompt assembly the bash
 * composers perform. The three regions below are marked in the source so this
 * suite can read each copy back out and hold it against the original. The
 * runtime contract is a pure coordinator — no filesystem, no shell, no Node
 * API — and module resolution is not part of it, which is why the assembly is
 * inlined here instead of imported from a shared module.
 */
function region(name: string): string {
  const open = `// wordtaste:${name}:start\n`;
  const close = `// wordtaste:${name}:end`;
  const start = SOURCE.indexOf(open);
  const end = SOURCE.indexOf(close, start);
  if (start < 0 || end < 0) throw new Error(`workflow region not found: ${name}`);
  return SOURCE.slice(start + open.length, end);
}

interface UnitPlan {
  id: string;
  role: string;
  spans: Array<{ file: string; from: string; to: string }>;
  must_keep: string[];
  target_chars: number;
  pace: string;
  ends: string;
  notes_en: string;
}

interface Plan {
  version: number;
  title: string;
  claims: Array<{ text: string; source: string }>;
  units: UnitPlan[];
  open_question?: string;
}

interface LeafParts {
  brief?: string;
  material: string;
  current?: string;
  kernel?: string;
  preceding?: string;
  issues?: string;
  constraints?: string;
  referenceProse?: string;
  voiceStyle?: string;
  voiceExamples?: string;
  entry?: string;
}

type Scaffolding = Record<string, unknown>;

interface PureRegion {
  assembleLeafPrompt(scaffolding: Scaffolding, parts: LeafParts): string;
  assembleLeafSystem(scaffolding: Scaffolding, parts: LeafParts): string;
  prependSystem(system: string, prompt: string): string;
  assembleUnitBrief(scaffolding: Scaffolding, unit: UnitPlan, title: string): string;
  assembleUnitConstraints(scaffolding: Scaffolding, isFirstUnit: boolean): string;
  assembleUnitKernel(unit: UnitPlan): string;
  assemblePlanPrompt(
    scaffolding: Scaffolding,
    inputs: { schemaText: string; goal: string; material: string; voice?: string },
  ): string;
  assembleCheckBrief(scaffolding: Scaffolding, scope: string, mustKeep: string[]): string;
  assembleCheckPrompt(
    scaffolding: Scaffolding,
    brief: string,
    candidate: string,
    previousReport?: string,
  ): string;
  assembleRepairPrompt(
    scaffolding: Scaffolding,
    brief: string,
    candidate: string,
    report: string,
  ): string;
  assembleRepairIssues(check: {
    issues: Array<{ kind: string; quote: string; problem: string }>;
  }): string;
  guardPlan(plan: Plan, goal: string, material: string | Record<string, string>): string | null;
  unitMaterial(unit: UnitPlan, material: string | Record<string, string>): string | null;
}

const EMBEDDED_SCAFFOLD = new Function(
  `${region("scaffolding")}\nreturn SCAFFOLD;`,
)() as Scaffolding;

const EMBEDDED_SCHEMA_TEXT = new Function(
  `${region("plan-schema")}\nreturn PLAN_SCHEMA_TEXT;`,
)() as string;

const pure = new Function(
  `${region("pure-region")}
  return {
    assembleLeafPrompt, assembleLeafSystem, prependSystem,
    assembleUnitBrief, assembleUnitConstraints, assembleUnitKernel,
    assemblePlanPrompt, assembleCheckBrief, assembleCheckPrompt, assembleRepairPrompt,
    assembleRepairIssues, guardPlan, unitMaterial,
  };`,
)() as PureRegion;

const SCAFFOLD_FILE = JSON.parse(readFileSync(SCAFFOLD_PATH, "utf8")) as Scaffolding;

/**
 * Everything below is synthetic: an invented essay about two workbenches. No
 * published text and no author appear anywhere. Every spawn gets its own HOME,
 * PNEUMA_SESSION_DIR, and PNEUMA_PROJECT_ROOT under a temp dir, so no script
 * can reach a real workspace or primer library.
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
const VOICE = "作者自己的一段旧文，用来定调子。\n";
const DRAFT = "上一节说完了那间屋子的门朝哪边开。\n";
const ISSUES = "第二段把「大部分时候」写成了「一直」。\n";
const CURRENT = "两张台子的事，先说清楚第一张。它一直够用。\n";
const TITLE = "两张工作台";
const CLAIM = "粗活的碎屑落进细活的槽里，第二天谁都不认这笔账。";
const KEEP_U1 = "第一张台子只做粗活，三年里换过四套夹具，大部分时候够用。";

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
    open_question: "要不要把第三节也写进来？",
  };
}

/** A content set with materials, a stored plan, and an isolated HOME. */
interface Harness {
  root: string;
  workflowFile: string;
  planDir: string;
  env: Record<string, string>;
}

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
  writeFileSync(join(root, "plan.json"), `${JSON.stringify(basePlan(), null, 2)}\n`);
  const workflowFile = join(root, "workflow.json");
  writeFileSync(
    workflowFile,
    `${JSON.stringify({ version: 2, stage: "intake", goal: "x", taskId: "t" }, null, 2)}\n`,
  );
  return {
    root,
    workflowFile,
    planDir,
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
  extraEnv: Record<string, string> = {},
): Promise<{ status: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([process.execPath, join(scriptsDir, script), ...args], {
    cwd: harness.root,
    env: { ...harness.env, ...extraEnv },
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

/** A synthetic primer library, so the reference block can be exercised. */
function writeLibrary(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "library.json"), JSON.stringify({ name: "synthetic" }));
  ["甲", "乙", "丙", "丁"].forEach((marker, index) => {
    const sentence = `这是一段${marker}类测试文字没来源只用来凑字数。`;
    const body = [220, 260, 240, 200, 280]
      .map((n) => sentence.repeat(Math.max(1, Math.round(n / sentence.length))))
      .join("\n\n");
    const front = ["---", `author: 作者${marker}`, `title: piece-${index}`, "---", ""].join("\n");
    writeFileSync(join(dir, `piece-${index}.md`), `${front}${body}\n`);
  });
}

/** The text between a tag's own lines, exclusive. */
function blockBetween(text: string, tag: string): string | null {
  const open = `<${tag}>\n`;
  const close = `\n</${tag}>`;
  const start = text.indexOf(open);
  if (start < 0) return null;
  const end = text.indexOf(close, start);
  if (end < 0) return null;
  return text.slice(start + open.length, end + 1);
}

describe("writing.workflow.js — one scaffolding, two assemblers", () => {
  it("embeds the scaffolding file, not a paraphrase of it", () => {
    expect(EMBEDDED_SCAFFOLD).toEqual(SCAFFOLD_FILE);
  });

  it("embeds the plan schema byte for byte, and validates against that same text", () => {
    expect(`${EMBEDDED_SCHEMA_TEXT}\n`).toBe(readFileSync(SCHEMA_PATH, "utf8"));
    expect(SOURCE).toContain("const PLAN_SCHEMA = JSON.parse(PLAN_SCHEMA_TEXT)");
    expect(SOURCE).toContain("schema: PLAN_SCHEMA");
  });

  it("keeps every embedded region generated from its source", async () => {
    const proc = Bun.spawn(
      [process.execPath, join(scriptsDir, "generate_workflow_regions.ts"), "--check"],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [status, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stderr).text(),
    ]);
    expect([stderr, status]).toEqual(["", 0]);
  });
});

describe("writing.workflow.js — prompt parity with the composer scripts", () => {
  it("assembles the writer's prompt byte for byte, primed and unprimed", async () => {
    await withHarness("wordtaste-parity-leaf-", async (harness) => {
      // The script chain: plan -> workflow.json -> parts -> prompt.
      expect(
        (await run(harness, "project_plan.ts", [
          join(harness.root, "plan.json"),
          harness.workflowFile,
        ])).status,
      ).toBe(0);
      writeFileSync(join(harness.root, "draft.md"), DRAFT);
      const parts = join(harness.root, ".pneuma", "private", "u1");
      expect(
        (await run(harness, "compose_unit_parts.ts", [harness.workflowFile, "u1", parts])).status,
      ).toBe(0);
      // A repair list and the text under repair are the two parts the unit
      // composer never writes; give both sides the same ones so those blocks
      // are covered too.
      writeFileSync(join(parts, "issues.md"), ISSUES);
      writeFileSync(join(parts, "current.md"), CURRENT);

      const unprimed = join(harness.root, "unprimed.md");
      expect(
        (await run(harness, "compose_leaf_prompt.ts", [parts, unprimed], {
          WORDTASTE_PRIMER: "0",
        })).status,
      ).toBe(0);

      // The JS chain: the same plan, straight from the stored JSON.
      const plan = basePlan();
      const unit = plan.units[0];
      const jsParts: LeafParts = {
        brief: pure.assembleUnitBrief(EMBEDDED_SCAFFOLD, unit, plan.title),
        material: pure.unitMaterial(unit, ORIGINAL)!,
        kernel: pure.assembleUnitKernel(unit),
        current: CURRENT,
        preceding: DRAFT,
        issues: ISSUES,
        constraints: pure.assembleUnitConstraints(EMBEDDED_SCAFFOLD, true),
      };
      expect(jsParts.material).toBe(readFileSync(join(parts, "material.md"), "utf8"));
      expect(jsParts.brief).toBe(readFileSync(join(parts, "brief.en.md"), "utf8"));
      expect(pure.assembleLeafPrompt(EMBEDDED_SCAFFOLD, jsParts)).toBe(
        readFileSync(unprimed, "utf8"),
      );
      // The standing charter the composer wrote beside the prompt is the same
      // bytes the workflow's own assembler produces from the same parts.
      expect(pure.assembleLeafSystem(EMBEDDED_SCAFFOLD, jsParts)).toBe(
        readFileSync(join(harness.root, "system.en.md"), "utf8"),
      );

      // Primed: the sampler is the script's, the passages are handed to the
      // workflow by the orchestrator, and the two prompts still match whole.
      const lib = join(harness.root, "lib");
      writeLibrary(lib);
      const primed = join(harness.root, "primed.md");
      expect(
        (await run(harness, "compose_leaf_prompt.ts", [parts, primed], {
          WORDTASTE_PRIMER_LIBS: lib,
        })).status,
      ).toBe(0);
      const primedText = readFileSync(primed, "utf8");
      const passages = blockBetween(primedText, "reference_prose");
      expect(passages).not.toBeNull();
      const primedParts = { ...jsParts, referenceProse: passages! };
      expect(pure.assembleLeafPrompt(EMBEDDED_SCAFFOLD, primedParts)).toBe(primedText);
      // A primed compose rewrites the charter too: its typology gains the
      // `<reference_prose>` rule, and the bytes still match the workflow's.
      expect(pure.assembleLeafSystem(EMBEDDED_SCAFFOLD, primedParts)).toBe(
        readFileSync(join(harness.root, "system.en.md"), "utf8"),
      );
    });
  }, 30_000);

  /**
   * The creation posture, on both paths. The script path reads the stored
   * workflow's `entry` and carries it as the `entry` part; the workflow path
   * reads `args.entry`. The two charters must match byte for byte on both
   * entries — and the task message must not move at all, because the entry
   * changes what the writer may do with the material, not what the material
   * is.
   */
  it("assembles the creation charter byte for byte, and moves nothing else", async () => {
    await withHarness("wordtaste-parity-entry-", async (harness) => {
      expect(
        (await run(harness, "project_plan.ts", [
          join(harness.root, "plan.json"),
          harness.workflowFile,
        ])).status,
      ).toBe(0);

      // Draft entry first: the baseline bytes.
      const parts = join(harness.root, ".pneuma", "private", "u1");
      expect(
        (await run(harness, "compose_unit_parts.ts", [harness.workflowFile, "u1", parts])).status,
      ).toBe(0);
      const draftOut = join(harness.root, "draft-entry.md");
      expect(
        (await run(harness, "compose_leaf_prompt.ts", [parts, draftOut], {
          WORDTASTE_PRIMER: "0",
        })).status,
      ).toBe(0);
      const draftSystem = readFileSync(join(harness.root, "system.en.md"), "utf8");

      // Idea entry: the stored workflow flips, the parts follow.
      const workflow = JSON.parse(readFileSync(harness.workflowFile, "utf8"));
      workflow.entry = "idea";
      writeFileSync(harness.workflowFile, `${JSON.stringify(workflow, null, 2)}\n`);
      expect(
        (await run(harness, "compose_unit_parts.ts", [harness.workflowFile, "u1", parts])).status,
      ).toBe(0);
      expect(readFileSync(join(parts, "entry"), "utf8")).toBe("idea\n");
      const ideaOut = join(harness.root, "idea-entry.md");
      expect(
        (await run(harness, "compose_leaf_prompt.ts", [parts, ideaOut], {
          WORDTASTE_PRIMER: "0",
        })).status,
      ).toBe(0);
      const ideaSystem = readFileSync(join(harness.root, "system.en.md"), "utf8");

      // The task message did not move between entries.
      expect(readFileSync(ideaOut, "utf8")).toBe(readFileSync(draftOut, "utf8"));
      // Both charters match the workflow's assembler byte for byte.
      const plan = basePlan();
      const unit = plan.units[0];
      const jsParts: LeafParts = {
        brief: pure.assembleUnitBrief(EMBEDDED_SCAFFOLD, unit, plan.title),
        material: pure.unitMaterial(unit, ORIGINAL)!,
        kernel: pure.assembleUnitKernel(unit),
        constraints: pure.assembleUnitConstraints(EMBEDDED_SCAFFOLD, true),
      };
      expect(pure.assembleLeafSystem(EMBEDDED_SCAFFOLD, jsParts)).toBe(draftSystem);
      expect(pure.assembleLeafSystem(EMBEDDED_SCAFFOLD, { ...jsParts, entry: "idea" }))
        .toBe(ideaSystem);
      // And the two postures actually differ where they should.
      expect(ideaSystem).toContain("Two things are hard constraints");
      expect(draftSystem).toContain("One thing is a hard constraint");
    });
  }, 30_000);

  /**
   * The workflow cannot sample the user's voice — sampling reads
   * `<content-set>/taste/` and draws from a seed, and a workflow script has no
   * filesystem. So the orchestrator runs `voice_sample.ts` and inlines the two
   * files it wrote. Which means these two assemblers can drift exactly where
   * nobody would look: the blank line between the directives and the examples,
   * and the case where only one of the two parts exists.
   */
  it("assembles the user's voice byte for byte, both parts, one part, and none", async () => {
    await withHarness("wordtaste-parity-voice-", async (harness) => {
      expect(
        (await run(harness, "project_plan.ts", [
          join(harness.root, "plan.json"),
          harness.workflowFile,
        ])).status,
      ).toBe(0);
      const parts = join(harness.root, ".pneuma", "private", "u1");
      expect(
        (await run(harness, "compose_unit_parts.ts", [harness.workflowFile, "u1", parts])).status,
      ).toBe(0);

      const plan = basePlan();
      const unit = plan.units[0];
      const jsParts: LeafParts = {
        brief: pure.assembleUnitBrief(EMBEDDED_SCAFFOLD, unit, plan.title),
        material: pure.unitMaterial(unit, ORIGINAL)!,
        kernel: pure.assembleUnitKernel(unit),
        constraints: pure.assembleUnitConstraints(EMBEDDED_SCAFFOLD, true),
      };

      const style = [
        "Open on the concrete case, never on a definition.",
        'Never open a paragraph with "值得注意的是".',
        "",
      ].join("\n");
      const examples = [
        "- 这个问题值得注意的是并不简单。",
        "+ 这个问题不简单。",
        "",
        "他想了很久，最后还是把那套夹具换了。",
        "",
      ].join("\n");

      const cases: Array<{ name: string; style?: string; examples?: string }> = [
        { name: "both", style, examples },
        { name: "style-only", style },
        { name: "examples-only", examples },
        { name: "none" },
      ];

      for (const testCase of cases) {
        for (const part of ["voice_style.en.md", "voice_examples.md"]) {
          rmSync(join(parts, part), { force: true });
        }
        if (testCase.style) writeFileSync(join(parts, "voice_style.en.md"), testCase.style);
        if (testCase.examples) {
          writeFileSync(join(parts, "voice_examples.md"), testCase.examples);
        }

        const out = join(harness.root, `voice-${testCase.name}.md`);
        expect(
          (await run(harness, "compose_leaf_prompt.ts", [parts, out], {
            WORDTASTE_PRIMER: "0",
          })).status,
        ).toBe(0);
        const composed = readFileSync(out, "utf8");
        expect([
          testCase.name,
          pure.assembleLeafPrompt(EMBEDDED_SCAFFOLD, {
            ...jsParts,
            voiceStyle: testCase.style,
            voiceExamples: testCase.examples,
          }),
        ]).toEqual([testCase.name, composed]);
        expect([testCase.name, composed.includes("<user_voice>")]).toEqual([
          testCase.name,
          testCase.name !== "none",
        ]);
      }
    });
  }, 30_000);

  it("assembles the planner's prompt byte for byte, with and without a voice", async () => {
    await withHarness("wordtaste-parity-plan-", async (harness) => {
      const bare = join(harness.planDir, "bare.md");
      expect((await run(harness, "compose_plan_prompt.ts", [harness.planDir, bare])).status).toBe(
        0,
      );
      expect(
        pure.assemblePlanPrompt(EMBEDDED_SCAFFOLD, {
          schemaText: EMBEDDED_SCHEMA_TEXT,
          goal: GOAL,
          material: ORIGINAL,
        }),
      ).toBe(readFileSync(bare, "utf8"));

      writeFileSync(join(harness.planDir, "voice.md"), VOICE);
      const withVoice = join(harness.planDir, "voice-prompt.md");
      expect(
        (await run(harness, "compose_plan_prompt.ts", [harness.planDir, withVoice])).status,
      ).toBe(0);
      expect(
        pure.assemblePlanPrompt(EMBEDDED_SCAFFOLD, {
          schemaText: EMBEDDED_SCHEMA_TEXT,
          goal: GOAL,
          material: ORIGINAL,
          voice: VOICE,
        }),
      ).toBe(readFileSync(withVoice, "utf8"));
    });
  }, 30_000);

  it("assembles the judge's brief byte for byte, per unit and whole", async () => {
    await withHarness("wordtaste-parity-check-", async (harness) => {
      expect(
        (await run(harness, "project_plan.ts", [
          join(harness.root, "plan.json"),
          harness.workflowFile,
        ])).status,
      ).toBe(0);

      const unitOut = join(harness.root, ".pneuma", "private", "u1.brief.md");
      expect(
        (await run(harness, "compose_check_brief.ts", [harness.workflowFile, "u1", unitOut]))
          .status,
      ).toBe(0);
      expect(pure.assembleCheckBrief(EMBEDDED_SCAFFOLD, "u1", [KEEP_U1])).toBe(
        readFileSync(unitOut, "utf8"),
      );

      const wholeOut = join(harness.root, ".pneuma", "private", "whole.brief.md");
      expect(
        (await run(harness, "compose_check_brief.ts", [harness.workflowFile, "whole", wholeOut]))
          .status,
      ).toBe(0);
      expect(pure.assembleCheckBrief(EMBEDDED_SCAFFOLD, "whole", [KEEP_U1, CLAIM])).toBe(
        readFileSync(wholeOut, "utf8"),
      );
    });
  }, 30_000);

  /**
   * `run_check_cycle.ts` appends the candidate to the brief itself. Its tail
   * sentences live in the scaffolding file under `check_tail_*` /
   * `repair_tail_*`, and the cycle assembles them through the same shared
   * module whose generated copy this suite evaluates — one implementation, so
   * the two paths cannot drift.
   */
  it("keeps the check-cycle tail on the shared assembler", () => {
    const cycleSource = readFileSync(join(scriptsDir, "run_check_cycle.ts"), "utf8");
    expect(cycleSource).toContain("assembleCheckPrompt(");
    expect(cycleSource).toContain("assembleRepairPrompt(");
    expect(cycleSource).toContain('from "./lib/prompt-assembly.ts"');
  });

  it("frames the candidate the way run_check_cycle.ts frames it", () => {
    const brief = pure.assembleCheckBrief(EMBEDDED_SCAFFOLD, "whole", [KEEP_U1]);
    const candidate = "两张台子的事，先说清楚第一张。";
    const report = '{"pass":false,"kernelOk":true,"issues":[]}';

    const check = pure.assembleCheckPrompt(EMBEDDED_SCAFFOLD, brief, candidate);
    expect(check.startsWith(brief)).toBe(true);
    expect(check).toContain("\n\nWORDTASTE_CHECK\n");
    expect(check).toContain(`\nCandidate to check:\n${candidate}`);
    expect(check).not.toContain("Previous private issue report:");
    expect(check.trimEnd().endsWith(String(EMBEDDED_SCAFFOLD.check_tail_output_rules))).toBe(true);

    const recheck = pure.assembleCheckPrompt(EMBEDDED_SCAFFOLD, brief, candidate, report);
    expect(recheck).toContain(`\nPrevious private issue report:\n${report}`);

    const repair = pure.assembleRepairPrompt(EMBEDDED_SCAFFOLD, brief, candidate, report);
    expect(repair.startsWith(brief)).toBe(true);
    expect(repair).toContain("\n\nWORDTASTE_REPAIR\n");
    expect(repair).toContain(`\nCurrent candidate:\n${candidate}`);
    expect(repair).toContain(`\nOne-use private issue report:\n${report}`);
  });

  /**
   * The repair this path actually dispatches is a writer prompt: the same
   * assembler, with the text under repair and the problems to fix. The whole
   * piece has no unit brief and none is invented for it — an English sentence
   * in front of a model that is not in the scaffolding file is exactly what
   * this mode does not do. The writer's persona rides in the charter, which
   * `agent()` — having no system channel — receives prepended, exactly as the
   * codex adapter degrades.
   */
  it("repairs with the writer's framing, not the judge's brief", () => {
    const check = {
      pass: false,
      kernelOk: true,
      issues: [
        { kind: "meaning", quote: "它一直够用", problem: "flattened a qualification" },
        { kind: "style", quote: "两张台子", problem: "a flat opening" },
      ],
    };
    expect(pure.assembleRepairIssues(check)).toBe(
      "- 它一直够用\n  flattened a qualification\n- 两张台子\n  a flat opening",
    );

    const repairParts: LeafParts = {
      material: ORIGINAL,
      kernel: KEEP_U1,
      current: CURRENT,
      issues: pure.assembleRepairIssues(check),
    };
    const prompt = pure.assembleLeafPrompt(EMBEDDED_SCAFFOLD, repairParts);
    expect(prompt.split("\n")[0]).toBe(String(EMBEDDED_SCAFFOLD.leaf_marker));
    expect(prompt).toContain(`<current_text>\n${CURRENT}</current_text>`);
    expect(prompt).toContain("<issues>");
    expect(prompt).toContain("flattened a qualification");
    expect(prompt.trimEnd().endsWith(String(EMBEDDED_SCAFFOLD.closing))).toBe(true);
    // No brief section at all, rather than an invented one.
    expect(prompt).not.toContain(String(EMBEDDED_SCAFFOLD.brief_heading));
    // And nothing of the judge's vocabulary.
    expect(prompt).not.toContain("WORDTASTE_REPAIR");
    expect(prompt).not.toContain(String(EMBEDDED_SCAFFOLD.check_output_shape));

    // The charter opens the combined dispatch, carries the repair rule, and
    // sits one blank line above the task message.
    const system = pure.assembleLeafSystem(EMBEDDED_SCAFFOLD, repairParts);
    const combined = pure.prependSystem(system, prompt);
    expect(system).toContain("You are a writer of long-form Chinese knowledge essays");
    expect(system).toContain("`<current_text>` with `<issues>` — a repair.");
    expect(combined).toBe(`${system}\n${prompt}`);

    // What the workflow dispatches is that combined prompt, not the legacy one.
    expect(SOURCE).toContain("const repairPrompt = prependSystem(");
    expect(SOURCE).toContain("assembleLeafSystem(SCAFFOLD, repairParts)");
    expect(SOURCE).toContain("assembleLeafPrompt(SCAFFOLD, repairParts)");
    expect(SOURCE).toContain("const repaired = await agent(repairPrompt, {");
  });

  /**
   * Both writer dispatches carry the same split: unit prompts and the repair
   * are `prependSystem(assembleLeafSystem(...), assembleLeafPrompt(...))`, and
   * the checker's prompt never grows a charter.
   */
  it("prepends the charter to every writer dispatch, and only to writers", () => {
    expect(SOURCE).toContain("const prompt = prependSystem(");
    expect(SOURCE).toContain("assembleLeafSystem(SCAFFOLD, unitParts)");
    expect(SOURCE).toContain("assembleLeafPrompt(SCAFFOLD, unitParts)");
    expect(SOURCE).toContain("const draft = await agent(prompt, { label: unit.id, phase: 'Write' })");
    // The check prompt is assembled without a charter of any kind.
    expect(SOURCE).toContain("agent(assembleCheckPrompt(SCAFFOLD, brief, prose)");
    expect(SOURCE).not.toContain("prependSystem(assembleCheckPrompt");
  });
});

function mutated(mutate: (plan: Plan) => void): Plan {
  const plan = basePlan();
  mutate(plan);
  return plan;
}

/**
 * validate_plan.ts's verdict, reduced to the field it names, so it can be
 * compared with what the JS guard returns.
 */
async function bashVerdict(
  harness: Harness,
  plan: Plan,
  material: string,
): Promise<string | null> {
  writeFileSync(join(harness.root, "materials", "original.md"), material);
  writeFileSync(join(harness.planDir, "material.md"), material);
  const planFile = join(harness.root, "plan.json");
  writeFileSync(planFile, `${JSON.stringify(plan, null, 2)}\n`);
  const result = await run(harness, "validate_plan.ts", [
    planFile,
    join(harness.planDir, "goal.md"),
    join(harness.planDir, "material.md"),
  ]);
  if (result.status === 0) return null;
  const named = result.stderr.match(
    /wordtaste: plan — (.+?) (?:is not a verbatim quote|does not match the schema)/,
  );
  return named ? named[1] : result.stderr.trim();
}

describe("writing.workflow.js — the verbatim guard in JS", () => {
  const material = ORIGINAL;

  it("accepts a plan whose Chinese is all quoted from the human input", () => {
    expect(pure.guardPlan(basePlan(), GOAL, material)).toBeNull();
  });

  function refuse(mutate: (plan: Plan) => void): string | null {
    return pure.guardPlan(mutated(mutate), GOAL, material);
  }

  it("refuses a reworded claim and a reworded title", () => {
    expect(refuse((plan) => {
      plan.claims[0].text = CLAIM.replace("落进", "落到");
    })).toBe("claims[].text");
    expect(refuse((plan) => {
      plan.title = "两张 工作台";
    })).toBe("title");
  });

  it("tells a full-width space from an ASCII one", () => {
    // `\s` in JavaScript matches U+3000, so a `\s`-based normaliser would
    // collapse both of these to the same string and call the retyped quote
    // verbatim. A full-width space is a character of the author's text, exactly
    // as `tr -s ' \t\r\n'` treats it, so only the copied one passes.
    const spaced = ORIGINAL.replace("第一张台子只做粗活", "第一张台子　只做粗活");
    const copied = basePlan();
    copied.units[0].must_keep = [KEEP_U1.replace("第一张台子只做粗活", "第一张台子　只做粗活")];
    expect(pure.guardPlan(copied, GOAL, spaced)).toBeNull();

    const retyped = basePlan();
    retyped.units[0].must_keep = [KEEP_U1.replace("第一张台子只做粗活", "第一张台子 只做粗活")];
    expect(pure.guardPlan(retyped, GOAL, spaced)).toBe("units[].must_keep[]");
  });

  it("still accepts a quote that crossed a line break", () => {
    // Both sides collapse runs of ASCII whitespace, so a sentence the planner
    // copied across a wrap still reads as verbatim — and one that does not
    // match the wrapping does not.
    const wrapped = ORIGINAL.replace("三年里换过", "三年里\n换过");
    const plan = basePlan();
    plan.units[0].must_keep = [KEEP_U1.replace("三年里换过", "三年里\n换过")];
    expect(pure.guardPlan(plan, GOAL, wrapped)).toBeNull();
    expect(pure.guardPlan(basePlan(), GOAL, wrapped)).toBe("units[].must_keep[]");
  });

  it("refuses Chinese in notes_en and leaves English typography alone", () => {
    expect(refuse((plan) => {
      plan.units[0].notes_en = "先交代背景，再讲问题。";
    })).toBe("units[].notes_en");
    expect(refuse((plan) => {
      plan.units[0].notes_en = "Stop before the “how” — that comes later…";
    })).toBeNull();
  });

  it("refuses a must_keep sentence that lives outside its own unit's spans", () => {
    expect(refuse((plan) => {
      plan.units[0].must_keep = [CLAIM];
    })).toBe("units[].must_keep[]");
  });

  it("refuses a span that is not in the material, and a duplicate unit id", () => {
    expect(refuse((plan) => {
      plan.units[0].spans[0].from = "## 一、开工之前 ";
    })).toBe("units[].spans[].from");
    expect(refuse((plan) => {
      plan.units[0].spans[0].to = "## 九、不存在的一节";
    })).toBe("units[].spans[].to");
    expect(refuse((plan) => {
      plan.units[1].id = "u1";
    })).toBe("units[].id");
  });

  it("refuses a span whose material file was not inlined", () => {
    const plan = basePlan();
    expect(pure.guardPlan(plan, GOAL, { "materials/other.md": ORIGINAL })).toBe(
      "units[].spans[].file",
    );
    expect(pure.guardPlan(plan, GOAL, { "materials/original.md": ORIGINAL })).toBeNull();
  });

  /**
   * The JS guard is not "like" validate_plan.ts; it has to reach the same
   * verdict on the same plan, because the two paths accept and refuse the same
   * work. Only the checks the JSON schema already enforces (enums, integer
   * ranges, `version`) are left to the schema and not repeated here.
   */
  it("agrees with validate_plan.ts, verdict for verdict", async () => {
    await withHarness("wordtaste-guard-parity-", async (harness) => {
      const wrapped = ORIGINAL.replace("三年里换过", "三年里\n换过");
      const spaced = ORIGINAL.replace("第一张台子只做粗活", "第一张台子　只做粗活");
      const wrappedPlan = basePlan();
      wrappedPlan.units[0].must_keep = [KEEP_U1.replace("三年里换过", "三年里\n换过")];
      const copiedPlan = basePlan();
      copiedPlan.units[0].must_keep = [
        KEEP_U1.replace("第一张台子只做粗活", "第一张台子　只做粗活"),
      ];
      const retypedPlan = basePlan();
      retypedPlan.units[0].must_keep = [
        KEEP_U1.replace("第一张台子只做粗活", "第一张台子 只做粗活"),
      ];

      const cases: Array<[string, Plan, string]> = [
        ["clean", basePlan(), ORIGINAL],
        ["reworded claim", mutated((plan) => {
          plan.claims[0].text = CLAIM.replace("落进", "落到");
        }), ORIGINAL],
        ["kept sentence outside its own span", mutated((plan) => {
          plan.units[0].must_keep = [CLAIM];
        }), ORIGINAL],
        ["Chinese in notes_en", mutated((plan) => {
          plan.units[0].notes_en = "先交代背景，再讲问题。";
        }), ORIGINAL],
        ["span start not in the file", mutated((plan) => {
          plan.units[0].spans[0].from = "## 一、开工之前 ";
        }), ORIGINAL],
        ["span end not after its start", mutated((plan) => {
          plan.units[0].spans[0].to = "## 九、不存在的一节";
        }), ORIGINAL],
        ["duplicate unit id", mutated((plan) => {
          plan.units[1].id = "u1";
        }), ORIGINAL],
        ["quote copied across a wrap", wrappedPlan, wrapped],
        ["wrap not copied", basePlan(), wrapped],
        ["full-width space copied", copiedPlan, spaced],
        ["full-width space retyped as ASCII", retypedPlan, spaced],
      ];

      for (const [name, plan, material] of cases) {
        const fromBash = await bashVerdict(harness, plan, material);
        expect([name, pure.guardPlan(plan, GOAL, material)]).toEqual([name, fromBash]);
      }
    });
  }, 40_000);

  it("slices a unit's material the way the span rule slices it", () => {
    const unit = basePlan().units[0];
    expect(pure.unitMaterial(unit, ORIGINAL)).toBe(
      ["## 一、开工之前", "", KEEP_U1, "", "第二张台子做细活，谁也不许在上面放锤子。", "", ""]
        .join("\n"),
    );
    expect(pure.unitMaterial(unit, "# 别的文章\n")).toBeNull();
  });
});

describe("writing.workflow.js — control shape", () => {
  it("declares the source project's two-level phases", () => {
    expect(SOURCE).toContain("name: 'wordtaste-writing-loop'");
    for (const phase of ["Shape", "Write", "Check"]) {
      expect(SOURCE).toContain(`title: '${phase}'`);
      expect(SOURCE).toContain(`phase('${phase}')`);
    }
  });

  it("returns at the layout boundary before writing", () => {
    const layoutReturn = SOURCE.indexOf("stage: 'layout'");
    const writePhase = SOURCE.indexOf("phase('Write')");
    expect(layoutReturn).toBeGreaterThan(-1);
    expect(writePhase).toBeGreaterThan(layoutReturn);
    expect(SOURCE).toContain("if (!A.approved)");
  });

  it("guards the plan, re-asks once, and gives up at intake", () => {
    expect(SOURCE).toContain("guardPlan(plan, A.goal, material)");
    expect(SOURCE).toContain("label: 'plan-again'");
    expect(SOURCE).toContain("return intake(`the plan was refused twice: ${failure}`)");
  });

  it("writes units sequentially and passes finished preceding prose", () => {
    expect(SOURCE).toContain("for (const unit of plan.units)");
    // The prose so far, minus its asset blocks — a specification block in the
    // last position a writer reads is a register it would imitate.
    expect(SOURCE).toContain("preceding: stripAssetBlocks(prose)");
    expect(SOURCE).toContain("label: unit.id");
    expect(SOURCE).not.toContain("parallel(");
    expect(SOURCE).not.toContain("pipeline(");
  });

  it("repairs at most once, only for lost meaning, then rechecks against the same report", () => {
    expect(SOURCE).toContain("if (meaningLost(check))");
    expect(SOURCE).toContain("issue.kind === 'meaning'");
    expect(SOURCE).not.toContain("if (check.issues.length > 0)");
    expect(SOURCE).toContain("label: 'repair'");
    expect(SOURCE).toContain("label: 'recheck'");
    expect(SOURCE).toContain("assembleCheckPrompt(SCAFFOLD, brief, prose, report)");
  });

  it("routes lost meaning to a finite blocked state and keeps style findings advisory", () => {
    expect(SOURCE).toContain("const stage = meaningLost(check) ? 'blocked' : 'done'");
    expect(SOURCE).toContain("issue.kind === 'style'");
    expect(SOURCE).toContain("advisory,");
    expect(SOURCE).not.toContain("'needs-review'");
    expect(SOURCE).toContain("do not overwrite an existing source draft");
    expect(SOURCE).toContain("do not start another internal repair loop");
  });

  it("never treats a missing leaf answer as a clean one", () => {
    for (const halt of [
      "unit ${unit.id} came back empty",
      "the check did not come back",
      "the repair did not come back",
      "the recheck did not come back",
    ]) {
      expect(SOURCE).toContain(halt);
    }
  });

  it("says whether the writers were primed", () => {
    expect(SOURCE).toContain("const primed = present(A.referenceProse)");
    expect(SOURCE).toContain("primed,");
  });

  it("hands the entry to every writer and repairer, normalized once", () => {
    // Only the exact string 'idea' selects the creation charter — the same
    // rule the composer applies to the `entry` part file.
    expect(SOURCE).toContain("const entry = A.entry === 'idea' ? 'idea' : undefined");
    // Both parts objects carry it; the checker's prompt takes no parts and
    // needs no pin — the charter never reaches a checker on either path.
    expect(SOURCE.split("\n    entry,\n")).toHaveLength(3);
  });

  it("contains no nondeterministic or sandbox-forbidden escape", () => {
    expect(CODE).not.toContain("Date.now(");
    expect(CODE).not.toContain("Math.random(");
    expect(CODE).not.toMatch(/new Date\(\s*\)/);
    expect(CODE).not.toMatch(/\brequire\s*\(/);
    expect(CODE).not.toMatch(/\bprocess\./);
    expect(CODE).not.toMatch(/from\s+['"]node:/);
    // No filesystem, no import of anything: every input arrives through `args`.
    expect(CODE).not.toMatch(/^\s*import\s/m);
    expect(CODE).not.toMatch(/\breadFile|writeFile|Bun\./);
  });
});

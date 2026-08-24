import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ViewerFileContent } from "../../../core/types/viewer-contract.js";
import {
  ENDS_LABELS,
  PACE_LABELS,
  ROLE_LABELS,
} from "../skill/scripts/project_plan.ts";
import type { Plan } from "../domain.js";
import {
  PLAN_ENDS_LABELS,
  PLAN_PACE_LABELS,
  PLAN_ROLE_LABELS,
  PLAN_SPAN_OPEN_END,
  STAGES,
  buildSpanAddress,
  candidateMarkdown,
  commandMessage,
  deriveDraft,
  deriveWorkflow,
  findPlanUnit,
  inferStage,
  normalizeEmphasis,
  planRows,
  planSourceLabel,
  planSpanLabel,
  planUnitCaption,
  progressPercent,
  stageIndex,
} from "../viewer/studio-logic.js";

function files(map: Record<string, string>): ViewerFileContent[] {
  return Object.entries(map).map(([path, content]) => ({ path, content }));
}

describe("stage projection", () => {
  it("maps the seven file stages onto the five human steps", () => {
    expect(STAGES.map((stage) => stage.label)).toEqual([
      "Goal",
      "Shape",
      "Write",
      "Check",
      "Keep",
    ]);
    expect(stageIndex("intake")).toBe(0);
    expect(stageIndex("layout")).toBe(1);
    expect(stageIndex("writing")).toBe(2);
    expect(stageIndex("review")).toBe(3);
    expect(stageIndex("choice")).toBe(3);
    expect(stageIndex("final")).toBe(4);
    expect(stageIndex("distilled")).toBe(4);
  });

  it("infers review for a legacy draft and intake for an empty workspace", () => {
    expect(inferStage(null, deriveDraft(files({ "draft.md": "text" }), ""))).toBe(
      "review",
    );
    expect(inferStage(null, null)).toBe("intake");
  });

  it("uses unit progress when available", () => {
    const workflow = deriveWorkflow(
      files({
        "workflow.json": JSON.stringify({
          stage: "writing",
          goal: "goal",
          progress: {
            completedUnits: ["u1", "u2"],
            totalUnits: 4,
          },
        }),
      }),
      "",
    )!;
    expect(progressPercent(workflow)).toBe(50);
  });
});

describe("current-draft span address", () => {
  it("builds quote + absolute offsets without stable block identity", () => {
    const markdown = "第一段。\n\n第二段里有一句最假的话。";
    const address = buildSpanAddress({
      contentSet: "essay",
      markdown,
      quote: "一句最假的话",
    })!;
    expect(address.file).toBe("essay/draft.md");
    expect(address.quote).toBe("一句最假的话");
    expect(markdown.slice(address.start, address.end)).toBe("一句最假的话");
    expect("block" in address).toBe(false);
    expect("rung" in address).toBe(false);
  });

  it("returns null for text that is not in the current draft", () => {
    expect(
      buildSpanAddress({
        contentSet: "",
        markdown: "current",
        quote: "stale",
      }),
    ).toBeNull();
  });

  it("takes the quote from the file when a rebuilt one only nearly matches", () => {
    // A selection that crossed a formula arrives with the range read back in
    // source form. `remark-math` handed KaTeX `\mathbb{J}` for the file's
    // `$ \mathbb{J} $`, so the rebuild is one space off on each side — the
    // segment lookup finds the span anyway, and the address quotes the file.
    // The DOM walk that produces these segments is pinned in
    // `math-selection.test.ts`; here they are written out by hand, because
    // this half of the contract needs no DOM at all.
    const markdown = "指带 $ \\mathbb{J} $ 值属性的结构。";
    const address = buildSpanAddress({
      contentSet: "essay",
      markdown,
      quote: "指带 $\\mathbb{J}$ 值属性的结构。",
      segments: [
        { kind: "text", text: "指带 " },
        { kind: "math", tex: "\\mathbb{J}", display: false },
        { kind: "text", text: " 值属性的结构。" },
      ],
    })!;
    expect(address.quote).toBe(markdown);
    expect(markdown.slice(address.start, address.end)).toBe(address.quote);
  });

  it("still returns null when even the segments are not in the draft", () => {
    expect(
      buildSpanAddress({
        contentSet: "",
        markdown: "这一版里没有这句话。",
        quote: "另一段 $x$ 文字",
        segments: [
          { kind: "text", text: "另一段 " },
          { kind: "math", tex: "x", display: false },
          { kind: "text", text: " 文字" },
        ],
      }),
    ).toBeNull();
  });
});

describe("choices and commands", () => {
  it("resolves embedded and file-backed neutral candidates", () => {
    const snapshot = files({ "essay/candidates/t/a.md": "Version A" });
    expect(
      candidateMarkdown(snapshot, "essay", {
        id: "a",
        label: "A",
        path: "candidates/t/a.md",
      }),
    ).toBe("Version A");
    expect(
      candidateMarkdown(snapshot, "essay", {
        id: "b",
        label: "B",
        markdown: "Version B",
      }),
    ).toBe("Version B");
  });

  it("keeps at most three valid emphasis indexes", () => {
    expect(normalizeEmphasis([3, 1, 1, -1, 0, 2], 4)).toEqual([0, 1, 3]);
  });

  it("serializes a machine-readable viewer command", () => {
    const message = commandMessage("approve-layout", {
      emphasis: [0, 2],
      note: "claim two is too strong",
    });
    expect(message).toContain('<wordtaste-command id="approve-layout">');
    expect(message).toContain('"emphasis": [');
    expect(message).toContain("</wordtaste-command>");
  });
});

describe("content-set derivation", () => {
  it("derives draft and workflow from the active writing project", () => {
    const snapshot = files({
      "essay/draft.md": "正文",
      "essay/workflow.json": JSON.stringify({
        stage: "final",
        goal: "goal",
      }),
    });
    expect(deriveDraft(snapshot, "essay")?.markdown).toBe("正文");
    expect(deriveWorkflow(snapshot, "essay")?.stage).toBe("final");
    expect(deriveDraft(snapshot, "")).toBeNull();
  });
});

describe("plan labels", () => {
  /**
   * The viewer and the projection script both name a unit's function in
   * Chinese, and they must name it with the same words. The script is the
   * older of the two, so its exported maps are read here as the reference: a label edited on
   * one side and not the other fails this test instead of quietly giving the
   * same unit two names depending on whether the session carries a plan.
   */
  it("names every role exactly as project_plan.ts does", () => {
    expect(PLAN_ROLE_LABELS).toEqual(ROLE_LABELS);
    expect(Object.keys(PLAN_ROLE_LABELS)).toEqual([
      "background",
      "problem",
      "reasoning",
      "conclusion",
      "close",
    ]);
  });

  it("names pace and ending exactly as project_plan.ts does", () => {
    expect(PLAN_PACE_LABELS).toEqual(PACE_LABELS);
    expect(PLAN_ENDS_LABELS).toEqual(ENDS_LABELS);
  });

  it("carries no label the schema has no enum value for", () => {
    const schema = JSON.parse(
      readFileSync(
        join(import.meta.dir, "..", "skill", "references", "plan-schema.json"),
        "utf8",
      ),
    );
    const unit = schema.properties.units.items.properties;
    expect(Object.keys(PLAN_ROLE_LABELS).sort()).toEqual([...unit.role.enum].sort());
    expect(Object.keys(PLAN_PACE_LABELS).sort()).toEqual([...unit.pace.enum].sort());
    expect(Object.keys(PLAN_ENDS_LABELS).sort()).toEqual([...unit.ends.enum].sort());
  });
});

describe("plan projection", () => {
  const plan: Plan = {
    version: 1,
    title: "局部最优的幻觉",
    claims: [
      { text: "更快不总是更近", source: "materials/original.md#L12" },
      { text: "反馈延迟会扭曲判断", source: "materials/outline.md" },
    ],
    units: [
      {
        id: "u1",
        role: "background",
        spans: [{ file: "materials/original.md", from: "## 〇", to: "### 1.2" }],
        must_keep: ["那年冬天没有人愿意先停下来", "谁先停谁吃亏"],
        target_chars: 800,
        pace: "dense",
        ends: "open",
        notes_en: "  Open on the concrete decision.  ",
      },
      {
        id: "u2",
        role: "conclusion",
        spans: [
          { file: "materials/original.md", from: "### 3.1", to: "" },
          { file: "materials/outline.md", from: "## 收束", to: "## 附录" },
        ],
        must_keep: [],
        target_chars: 600,
        pace: "mixed",
        ends: "stop",
        notes_en: "",
      },
    ],
  };

  it("gives one row per unit, in the plan's own order", () => {
    const rows = planRows(plan);
    expect(rows.map((row) => [row.order, row.id])).toEqual([
      [1, "u1"],
      [2, "u2"],
    ]);
  });

  it("resolves every enum into the label a reader recognises", () => {
    const [first, second] = planRows(plan);
    expect(first.roleLabel).toBe("交代背景");
    expect(first.paceLabel).toBe("密");
    expect(first.endsLabel).toBe("留个口");
    expect(second.roleLabel).toBe("说出结论");
    expect(second.paceLabel).toBe("疏密相间");
    expect(second.endsLabel).toBe("说完就停");
  });

  it("counts must-keep sentences instead of spilling them into the row", () => {
    const rows = planRows(plan);
    expect(rows[0].mustKeepCount).toBe(2);
    expect(rows[1].mustKeepCount).toBe(0);
    expect(JSON.stringify(rows)).not.toContain("那年冬天");
  });

  it("carries the target length through untouched and trims the planner's notes", () => {
    const rows = planRows(plan);
    expect(rows[0].targetChars).toBe(800);
    expect(rows[0].notes).toBe("Open on the concrete decision.");
    expect(rows[1].notes).toBe("");
  });

  it("marks a span that runs to the end of its file rather than showing nothing", () => {
    expect(planSpanLabel({ file: "m.md", from: "### 3.1", to: "" })).toEqual({
      from: "### 3.1",
      to: PLAN_SPAN_OPEN_END,
    });
    expect(planSpanLabel({ file: "m.md", from: " ## 〇 ", to: " ### 1.2 " })).toEqual({
      from: "## 〇",
      to: "### 1.2",
    });
    expect(planRows(plan)[1].spans).toEqual([
      { from: "### 3.1", to: PLAN_SPAN_OPEN_END },
      { from: "## 收束", to: "## 附录" },
    ]);
  });

  it("shortens a claim's source to the file and its line anchor", () => {
    expect(planSourceLabel("materials/original.md#L12")).toBe("original.md · L12");
    expect(planSourceLabel("materials/outline.md")).toBe("outline.md");
    expect(planSourceLabel("original.md")).toBe("original.md");
    expect(planSourceLabel("  materials/deep/notes.md#L3-L9  ")).toBe("notes.md · L3-L9");
    expect(planSourceLabel("#L12")).toBe("L12");
    expect(planSourceLabel("")).toBe("");
  });

  it("finds the unit being written, and no unit for a plan-less session", () => {
    expect(findPlanUnit(plan, "u2")?.role).toBe("conclusion");
    expect(findPlanUnit(plan, "u9")).toBeUndefined();
    expect(findPlanUnit(plan, undefined)).toBeUndefined();
    expect(findPlanUnit(undefined, "u1")).toBeUndefined();
  });

  it("captions the unit being written with its function and its span", () => {
    expect(planUnitCaption(plan.units[0])).toBe("交代背景 · ## 〇 → ### 1.2");
    expect(planUnitCaption(plan.units[1])).toBe(`说出结论 · ### 3.1 → ${PLAN_SPAN_OPEN_END}`);
    expect(planUnitCaption({ ...plan.units[0], spans: [] })).toBe("交代背景");
  });
});

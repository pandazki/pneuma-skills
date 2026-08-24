import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ViewerFileContent } from "../../../core/types/viewer-contract.js";
import type { Plan } from "../domain.js";
import {
  loadDraft,
  loadTaste,
  loadWorkflow,
  saveDraft,
  saveWorkflow,
} from "../domain.js";

function files(map: Record<string, string>): ViewerFileContent[] {
  return Object.entries(map).map(([path, content]) => ({ path, content }));
}

describe("draft domain", () => {
  it("loads the current markdown and deterministic ephemeral blocks", () => {
    const draft = loadDraft(
      files({
        "draft.md":
          "# Title\n\nFirst paragraph.\n\n```js\nconst a = 1;\n\nconst b = 2;\n```",
      }),
    )!;
    expect(draft.contentSet).toBe("");
    expect(draft.blocks.map((block) => block.id)).toEqual(["p1", "p2", "p3"]);
    expect(draft.blocks[2].markdown).toContain("const b = 2");
    expect(draft.blocks[1].start).toBeGreaterThan(draft.blocks[0].end);
  });

  it("loads and saves inside a content set without legacy sidecars", () => {
    const draft = loadDraft(files({ "essay/draft.md": "原稿" }), "essay")!;
    draft.markdown = "新稿";
    const result = saveDraft(draft, []);
    expect(result.writes).toEqual([
      { path: "essay/draft.md", content: "新稿" },
    ]);
    expect(result.writes.some((write) => write.path.includes("blocks"))).toBe(
      false,
    );
    expect(result.writes.some((write) => write.path.includes("freeze"))).toBe(
      false,
    );
  });

  it("returns null when draft.md is absent", () => {
    expect(loadDraft(files({ "materials/brief.md": "goal" }))).toBeNull();
  });
});

describe("workflow domain", () => {
  const raw = {
    version: 2,
    stage: "layout",
    goal: "写一篇解释为什么局部最优会骗人",
    entry: "idea",
    taskId: "t-1",
    layout: {
      title: "局部最优的幻觉",
      thesis: ["更快不总是更近", "反馈延迟会扭曲判断"],
      units: [
        {
          id: "u1",
          role: "把问题逼出来",
          brief: "从一个具体决策进入",
          rhythm: "短开场，随后放慢",
          targetChars: 800,
        },
      ],
      openQuestion: "结尾落在个人决策还是团队机制？",
    },
    emphasis: [1, 99, "bad"],
    progress: {
      currentUnit: "u1",
      completedUnits: [],
      totalUnits: 1,
    },
    review: {
      summary: "意思还活着",
      issues: [{ quote: "某句话", problem: "太工整", status: "open" }],
    },
    candidates: [
      { id: "a", label: "A", path: "candidates/t-1/a.md" },
    ],
  };

  it("normalizes the file-backed viewer projection", () => {
    const state = loadWorkflow(
      files({ "essay/workflow.json": JSON.stringify(raw) }),
      "essay",
    )!;
    expect(state.version).toBe(2);
    expect(state.stage).toBe("layout");
    expect(state.contentSet).toBe("essay");
    expect(state.layout?.units[0]).toMatchObject({
      id: "u1",
      role: "把问题逼出来",
      targetChars: 800,
    });
    expect(state.emphasis).toEqual([1, 99]);
    expect(state.review?.issues[0].status).toBe("open");
    expect(state.candidates[0].label).toBe("A");
  });

  it("degrades malformed JSON to null and unknown stages to intake", () => {
    expect(loadWorkflow(files({ "workflow.json": "{" }))).toBeNull();
    const state = loadWorkflow(
      files({
        "workflow.json": JSON.stringify({
          stage: "machine-secret-stage",
          goal: "",
        }),
      }),
    )!;
    expect(state.stage).toBe("intake");
  });

  it("saves workflow.json without leaking the derived contentSet field", () => {
    const state = loadWorkflow(
      files({ "essay/workflow.json": JSON.stringify(raw) }),
      "essay",
    )!;
    const saved = saveWorkflow(state, []);
    expect(saved.writes[0].path).toBe("essay/workflow.json");
    const parsed = JSON.parse(saved.writes[0].content);
    expect(parsed.contentSet).toBeUndefined();
    expect(parsed.stage).toBe("layout");
  });
});

describe("structured plan", () => {
  const projected = {
    version: 2,
    stage: "layout",
    goal: "写一篇解释为什么局部最优会骗人",
    emphasis: [],
    candidates: [],
    layout: {
      title: "局部最优的幻觉",
      thesis: ["更快不总是更近", "反馈延迟会扭曲判断"],
      units: [
        {
          id: "u1",
          role: "交代背景",
          brief: "## 〇 … ### 1.2",
          rhythm: "密，留个口",
          targetChars: 800,
        },
      ],
      openQuestion: "结尾落在个人决策还是团队机制？",
    },
  };

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
        must_keep: ["那年冬天没有人愿意先停下来"],
        target_chars: 800,
        pace: "dense",
        ends: "open",
        notes_en: "Open on the concrete decision, not on the abstraction.",
      },
      {
        id: "u2",
        role: "conclusion",
        spans: [{ file: "materials/original.md", from: "### 3.1", to: "" }],
        must_keep: [],
        target_chars: 600,
        pace: "loose",
        ends: "stop",
        notes_en: "",
      },
    ],
    open_question: "结尾落在个人决策还是团队机制？",
  };

  function withPlan(candidate: unknown): ViewerFileContent[] {
    return files({
      "workflow.json": JSON.stringify({
        ...projected,
        layout: { ...projected.layout, plan: candidate },
      }),
    });
  }

  it("loads a legacy workflow.json that has no plan at all", () => {
    const state = loadWorkflow(
      files({ "workflow.json": JSON.stringify(projected) }),
    )!;
    expect(state.layout?.plan).toBeUndefined();
    expect(state.layout?.title).toBe("局部最优的幻觉");
    expect(state.layout?.units[0].brief).toBe("## 〇 … ### 1.2");
  });

  it("keeps the validated plan byte-for-byte, snake_case and all", () => {
    const state = loadWorkflow(withPlan(plan))!;
    expect(state.layout?.plan).toEqual(plan);
    const unit = state.layout!.plan!.units[0];
    expect(unit.role).toBe("background");
    expect(unit.spans[0].to).toBe("### 1.2");
    expect(unit.must_keep).toEqual(["那年冬天没有人愿意先停下来"]);
    expect(unit.target_chars).toBe(800);
    expect(unit.pace).toBe("dense");
    expect(unit.ends).toBe("open");
    expect(unit.notes_en).toContain("concrete decision");
    expect(state.layout?.plan?.open_question).toBe("结尾落在个人决策还是团队机制？");
  });

  it("survives a save/load round trip without rewriting the plan", () => {
    const state = loadWorkflow(withPlan(plan))!;
    const saved = saveWorkflow(state, []);
    expect(JSON.parse(saved.writes[0].content).layout.plan).toEqual(plan);
  });

  for (const [name, broken] of [
    ["a plan that is not an object", "materials/original.md"],
    ["an unknown schema version", { ...plan, version: 2 }],
    ["a title that is not the author's", { ...plan, title: "" }],
    ["no claims to approve", { ...plan, claims: [] }],
    ["a claim with no source", { ...plan, claims: [{ text: "更快不总是更近" }] }],
    ["no units to write", { ...plan, units: [] }],
    [
      "one unit whose role is off the enum",
      { ...plan, units: [plan.units[0], { ...plan.units[1], role: "banter" }] },
    ],
    [
      "one unit whose pace is off the enum",
      { ...plan, units: [{ ...plan.units[0], pace: "brisk" }, plan.units[1]] },
    ],
    [
      "one unit whose ending is off the enum",
      { ...plan, units: [{ ...plan.units[0], ends: "fade" }, plan.units[1]] },
    ],
    [
      "a span that names no file",
      {
        ...plan,
        units: [{ ...plan.units[0], spans: [{ from: "## 〇", to: "" }] }, plan.units[1]],
      },
    ],
    [
      "a target length that is not a whole number of characters",
      { ...plan, units: [{ ...plan.units[0], target_chars: "long" }, plan.units[1]] },
    ],
    [
      "planner notes that are not a string",
      { ...plan, units: [{ ...plan.units[0], notes_en: 12 }, plan.units[1]] },
    ],
  ] as Array<[string, unknown]>) {
    it(`drops ${name} and keeps the projected fields`, () => {
      const state = loadWorkflow(withPlan(broken))!;
      expect(state.layout?.plan).toBeUndefined();
      expect(state.layout?.title).toBe("局部最优的幻觉");
      expect(state.layout?.thesis).toEqual(["更快不总是更近", "反馈延迟会扭曲判断"]);
      expect(state.layout?.units).toHaveLength(1);
      expect(state.layout?.openQuestion).toBe("结尾落在个人决策还是团队机制？");
      expect(state.stage).toBe("layout");
    });
  }

  it("rejects one bad unit by dropping the whole sequence, never half of it", () => {
    const state = loadWorkflow(
      withPlan({
        ...plan,
        units: [plan.units[0], { ...plan.units[1], role: "banter" }],
      }),
    )!;
    expect(state.layout?.plan).toBeUndefined();
  });
});

describe("taste summary", () => {
  it("reads the voice floor and trajectory counters", () => {
    const profile = [
      "# Taste Profile",
      "",
      "## 0. Calibration",
      "uncalibrated",
      "",
      "## 1. Voice floor",
      "句子会迟疑，也会自拆台。",
      "",
      "## 2. Rejections",
      "none",
    ].join("\n");
    const taste = loadTaste(
      files({
        "taste/taste-profile.md": profile,
        "taste/recipes/longform.md": "recipe",
        "taste/prefs.log.jsonl": '{"event":"reject"}\n{"event":"accept"}\n',
        "taste/examples/swaps.jsonl": '{"before":"a","after":"b"}\n',
      }),
    )!;
    expect(taste.voiceFloor).toContain("自拆台");
    expect(taste.recipeNames).toEqual(["longform.md"]);
    expect(taste.prefsCount).toBe(2);
    expect(taste.swapCount).toBe(1);
  });
});

describe("shipped seeds", () => {
  for (const seed of ["from-idea", "from-draft"]) {
    it(`${seed} starts at the intake stage with an uncalibrated profile`, () => {
      const root = join(import.meta.dir, "..", "seed", seed);
      const workflow = loadWorkflow(
        files({
          "workflow.json": readFileSync(join(root, "workflow.json"), "utf8"),
        }),
      )!;
      const taste = loadTaste(
        files({
          "taste/taste-profile.md": readFileSync(
            join(root, "taste", "taste-profile.md"),
            "utf8",
          ),
        }),
      )!;
      expect(workflow.stage).toBe("intake");
      expect(workflow.entry).toBe(seed === "from-idea" ? "idea" : "draft");
      expect(taste.voiceFloor.length).toBeGreaterThan(0);
    });
  }
});

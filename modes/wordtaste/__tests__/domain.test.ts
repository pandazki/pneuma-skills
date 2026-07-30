import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ViewerFileContent } from "../../../core/types/viewer-contract.js";
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

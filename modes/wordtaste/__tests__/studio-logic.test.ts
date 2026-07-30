import { describe, expect, it } from "bun:test";
import type { ViewerFileContent } from "../../../core/types/viewer-contract.js";
import {
  STAGES,
  buildSpanAddress,
  candidateMarkdown,
  commandMessage,
  deriveDraft,
  deriveWorkflow,
  inferStage,
  normalizeEmphasis,
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

import { describe, expect, it } from "bun:test";
import type { ViewerSelectionContext } from "../../../core/types/viewer-contract.js";
import wordtasteMode from "../pneuma-mode.js";

const { extractContext } = wordtasteMode.viewer;

describe("wordtaste extractContext", () => {
  it("returns empty text without a selection", () => {
    expect(extractContext(null, [])).toBe("");
  });

  it("describes a cheap current-draft signal without internal machinery", () => {
    const selection: ViewerSelectionContext = {
      type: "span",
      content: "这句话最假",
      address: {
        contentSet: "essay",
        file: "essay/draft.md",
        quote: "这句话最假",
        start: 12,
        end: 18,
      },
    };
    const output = extractContext(selection, []);
    expect(output).toContain('<viewer-context mode="wordtaste"');
    expect(output).toContain('contentSet="essay"');
    expect(output).toContain('file="essay/draft.md"');
    expect(output).toContain("这句话最假");
    expect(output).toContain('"start":12');
    expect(output).toContain("cheap human signal");
    expect(output).not.toContain("rung");
    expect(output).not.toContain("symptom");
    expect(output).not.toContain("frozen");
  });
});

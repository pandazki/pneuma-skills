import { describe, it, expect } from "bun:test";
import palateMode from "../pneuma-mode.js";
import type { ViewerSelectionContext } from "../../../core/types/viewer-contract.js";

const { extractContext } = palateMode.viewer;

function ctx(s: ViewerSelectionContext | null): string {
  return extractContext(s, []);
}

describe("palate extractContext", () => {
  it("returns empty string for no selection", () => {
    expect(ctx(null)).toBe("");
  });

  it("emits the §5.1 viewer-context block for a span selection", () => {
    const selection: ViewerSelectionContext = {
      type: "span",
      content: "the AI metaphor",
      address: {
        contentSet: "essay",
        block: "b7",
        span: { start: 0, end: 42, quote: "the AI metaphor" },
        frozen: false,
        rung: 4,
        symptoms: ["S7"],
      },
    };
    const out = ctx(selection);
    expect(out).toContain('<viewer-context mode="palate"');
    expect(out).toContain('contentSet="essay"');
    expect(out).toContain('block="b7"');
    expect(out).toContain('Selected (rewrite target): "the AI metaphor"');
    // The full machine-routable address is included.
    expect(out).toContain('"block":"b7"');
    expect(out).toContain('"quote":"the AI metaphor"');
    expect(out).toContain("Block frozen: false");
    expect(out).toContain("Active rung: 4");
    expect(out).toContain("Symptoms flagged here: S7");
    expect(out).toMatch(/<\/viewer-context>\s*$/);
  });

  it("reports a frozen block and omits symptoms when none are flagged", () => {
    const selection: ViewerSelectionContext = {
      type: "block",
      content: "Frozen kernel sentence.",
      address: {
        contentSet: "",
        block: "b3",
        frozen: true,
        rung: 2,
        symptoms: [],
      },
    };
    const out = ctx(selection);
    expect(out).toContain('block="b3"');
    expect(out).toContain("Block frozen: true");
    expect(out).toContain("Active rung: 2");
    expect(out).not.toContain("Symptoms flagged here");
  });

  it("handles a block-only selection with no span", () => {
    const selection: ViewerSelectionContext = {
      type: "block",
      content: "Whole paragraph text.",
      address: { contentSet: "", block: "b1", rung: 0 },
    };
    const out = ctx(selection);
    expect(out).toContain('block="b1"');
    expect(out).toContain("Active rung: 0");
  });
});

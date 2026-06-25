import { describe, it, expect } from "bun:test";
import {
  rungLabel,
  clampRung,
  applyLadder,
  DEFAULT_DIRECTIONS,
  chipsFromProposal,
  buildSpanHandle,
  buildAddress,
  isDenseBlock,
  denseBlockIds,
  deriveDraft,
  deriveTaste,
  layoutAnnotations,
  MAX_RUNG,
} from "../viewer/studio-logic.js";
import type { Draft } from "../domain.js";
import type { ViewerFileContent } from "../../../core/types/viewer-contract.js";

describe("rung dial — human temperature, never a number", () => {
  it("labels every rung with a word, not a digit", () => {
    for (let r = 0; r <= MAX_RUNG; r++) {
      const label = rungLabel(r);
      expect(label.length).toBeGreaterThan(0);
      expect(/\d/.test(label)).toBe(false);
    }
  });

  it("clamps out-of-range and non-finite rungs into [0,5]", () => {
    expect(clampRung(-3)).toBe(0);
    expect(clampRung(9)).toBe(5);
    expect(clampRung(2.6)).toBe(3);
    expect(clampRung(NaN)).toBe(0);
  });
});

describe("applyLadder — set vs bump (the set-ladder contract)", () => {
  it("absolute rung wins over delta", () => {
    expect(applyLadder(1, { rung: 4 })).toBe(4);
    expect(applyLadder(1, { rung: 4, delta: 1 })).toBe(4);
  });

  it("delta bumps and clamps (the still-ai dial-up)", () => {
    expect(applyLadder(2, { delta: 1 })).toBe(3);
    expect(applyLadder(5, { delta: 1 })).toBe(5); // saturates at bolder
    expect(applyLadder(0, { delta: -1 })).toBe(0); // saturates at faithful
  });

  it("no-op payload keeps the current rung", () => {
    expect(applyLadder(3, {})).toBe(3);
  });
});

describe("direction chips — static default then agent-refine", () => {
  it("ships exactly 5 canonical defaults covering S2/S4/S5/S7 + tighten", () => {
    expect(DEFAULT_DIRECTIONS.length).toBe(5);
    const symptoms = DEFAULT_DIRECTIONS.map((c) => c.symptom).filter(Boolean);
    expect(symptoms).toEqual(expect.arrayContaining(["S2", "S4", "S5", "S7"]));
    expect(DEFAULT_DIRECTIONS.some((c) => c.label.toLowerCase().includes("tighten"))).toBe(true);
  });

  it("parses a bare string[] proposal into labelled chips", () => {
    const chips = chipsFromProposal(["Let it breathe", "Sink the argument"]);
    expect(chips.map((c) => c.label)).toEqual(["Let it breathe", "Sink the argument"]);
  });

  it("parses a { directions: [...] } proposal with symptom tags", () => {
    const chips = chipsFromProposal({
      directions: [{ label: "Cut the simile", symptom: "S7" }, "Tighten"],
    });
    expect(chips[0]).toEqual({ label: "Cut the simile", symptom: "S7" });
    expect(chips[1]).toEqual({ label: "Tighten" });
  });

  it("falls back to defaults for garbage / empty proposals", () => {
    expect(chipsFromProposal(null)).toBe(DEFAULT_DIRECTIONS);
    expect(chipsFromProposal({})).toBe(DEFAULT_DIRECTIONS);
    expect(chipsFromProposal([])).toBe(DEFAULT_DIRECTIONS);
    expect(chipsFromProposal([42, { nope: true }])).toBe(DEFAULT_DIRECTIONS);
  });
});

describe("buildSpanHandle — offsets + self-healing quote", () => {
  const block = "The model knows it is a model. The metaphor sits wrong.";

  it("locates the quote and returns char offsets", () => {
    const span = buildSpanHandle(block, "metaphor sits wrong");
    expect(span).not.toBeNull();
    expect(block.slice(span!.start, span!.end)).toBe("metaphor sits wrong");
    expect(span!.quote).toBe("metaphor sits wrong");
  });

  it("returns null when the quote is not in the block (coarse fallback)", () => {
    expect(buildSpanHandle(block, "absent text")).toBeNull();
    expect(buildSpanHandle(block, "   ")).toBeNull();
  });

  it("uses the hint to disambiguate a repeated quote", () => {
    const repeated = "model. and again model.";
    const first = buildSpanHandle(repeated, "model");
    const second = buildSpanHandle(repeated, "model", 5);
    expect(first!.start).toBe(0);
    expect(second!.start).toBe(repeated.indexOf("model", 5));
  });
});

describe("buildAddress — one noun, every verb", () => {
  it("carries span + decorations for a fine selection", () => {
    const addr = buildAddress({
      contentSet: "essay",
      block: "b7",
      span: { start: 0, end: 4, quote: "Test" },
      frozen: false,
      rung: 4,
      symptoms: ["S7"],
    });
    expect(addr).toEqual({
      contentSet: "essay",
      block: "b7",
      span: { start: 0, end: 4, quote: "Test" },
      frozen: false,
      rung: 4,
      symptoms: ["S7"],
    });
  });

  it("omits contentSet/span/symptoms for a coarse root-block selection", () => {
    const addr = buildAddress({ contentSet: "", block: "b1", frozen: true, rung: 99 });
    expect(addr).toEqual({ block: "b1", frozen: true, rung: 5 });
    expect("contentSet" in addr).toBe(false);
    expect("span" in addr).toBe(false);
    expect("symptoms" in addr).toBe(false);
  });
});

describe("readability guard — the orthogonal axis", () => {
  it("flags a monster paragraph but not a heading or code", () => {
    const monster = "x".repeat(700);
    expect(isDenseBlock(monster)).toBe(true);
    expect(isDenseBlock("# " + "x".repeat(700))).toBe(false);
    expect(isDenseBlock("```\n" + "x".repeat(700) + "\n```")).toBe(false);
    expect(isDenseBlock("a short paragraph")).toBe(false);
  });

  it("collects dense block ids across a draft", () => {
    const draft: Draft = {
      contentSet: "",
      blocks: [
        { id: "b1", markdown: "short", frozen: false },
        { id: "b2", markdown: "y".repeat(800), frozen: false },
      ],
    };
    expect(denseBlockIds(draft)).toEqual(["b2"]);
    expect(denseBlockIds(null)).toEqual([]);
  });
});

describe("deriveDraft / deriveTaste — content-set scoped (source is root-only)", () => {
  const files: ViewerFileContent[] = [
    { path: "worked-example/draft.md", content: "# Title\n\nFirst block.\n\nSecond block." },
    {
      path: "worked-example/taste/taste-profile.md",
      content: "## 0. Calibration\nlaunch rung 4\n\n## 1. Voice floor\nBreathing prose.\n",
    },
  ];

  it("derives the draft for the active content set, not the (empty) root", () => {
    expect(deriveDraft(files, "")).toBeNull();
    const draft = deriveDraft(files, "worked-example");
    expect(draft).not.toBeNull();
    expect(draft!.contentSet).toBe("worked-example");
    expect(draft!.blocks.length).toBe(3);
  });

  it("derives the taste profile for the active content set", () => {
    expect(deriveTaste(files, "")).toBeNull();
    const taste = deriveTaste(files, "worked-example");
    expect(taste).not.toBeNull();
    expect(taste!.launchRung).toBe(4);
    expect(taste!.voiceFloor).toContain("Breathing prose");
  });
});

// ── Annotation column layout — vertical collision avoidance ──────────────────
// The block-aligned margin-notes column anchors each card at its block's top.
// Without collision resolution, cards whose anchors sit close together (or a
// card taller than the gap to the next anchor) render on top of each other and
// cover their text. layoutAnnotations is the pure, testable push-down resolver:
// sort by anchor, walk top→down, push each card just far enough to clear the
// previous card + a gap.
describe("layoutAnnotations — margin-notes collision avoidance", () => {
  it("keeps a card at its anchor when there is room before the next one", () => {
    const out = layoutAnnotations(
      [
        { id: "a", anchorTop: 0, height: 40 },
        { id: "b", anchorTop: 200, height: 40 },
      ],
      12,
    );
    expect(out).toEqual([
      { id: "a", top: 0 },
      { id: "b", top: 200 },
    ]);
  });

  it("pushes a card down so it clears the previous card + gap when they overlap", () => {
    // b anchors only 20px below a, but a is 50px tall → b would overlap a.
    // It must be pushed to a.top + a.height + gap = 0 + 50 + 12 = 62.
    const out = layoutAnnotations(
      [
        { id: "a", anchorTop: 0, height: 50 },
        { id: "b", anchorTop: 20, height: 30 },
      ],
      12,
    );
    expect(out).toEqual([
      { id: "a", top: 0 },
      { id: "b", top: 62 },
    ]);
  });

  it("cascades the push-down across a dense cluster (never any overlap)", () => {
    const items = [
      { id: "a", anchorTop: 0, height: 60 },
      { id: "b", anchorTop: 10, height: 60 },
      { id: "c", anchorTop: 20, height: 60 },
    ];
    const out = layoutAnnotations(items, 10);
    // a→0; b→0+60+10=70; c→70+60+10=140.
    expect(out).toEqual([
      { id: "a", top: 0 },
      { id: "b", top: 70 },
      { id: "c", top: 140 },
    ]);
    // Assert the invariant directly: no two laid-out cards overlap.
    const byId = new Map(out.map((o) => [o.id, o.top]));
    for (let i = 1; i < items.length; i++) {
      const prev = items[i - 1];
      const cur = items[i];
      expect(byId.get(cur.id)!).toBeGreaterThanOrEqual(byId.get(prev.id)! + prev.height + 10);
    }
  });

  it("sorts by anchorTop before resolving, regardless of input order", () => {
    const out = layoutAnnotations(
      [
        { id: "late", anchorTop: 300, height: 40 },
        { id: "early", anchorTop: 0, height: 40 },
      ],
      12,
    );
    // Output is ordered by anchor; early sits at its anchor, late far below.
    expect(out.map((o) => o.id)).toEqual(["early", "late"]);
    expect(out[0]).toEqual({ id: "early", top: 0 });
    expect(out[1]).toEqual({ id: "late", top: 300 });
  });

  it("returns an empty layout for no items", () => {
    expect(layoutAnnotations([], 12)).toEqual([]);
  });
});

// ── Bug 2: a freshly seeded SOLE content set must auto-activate ──────────────
// After a live gallery seed-apply, the worked-example lands in a single subdir
// with an empty workspace root. The studio must surface that lone content set
// and auto-activate it so deriveDraft reads <prefix>/draft.md instead of the
// empty root. This pins wordtaste's ACTUAL resolver wiring (allowSingle) against
// the store's auto-activation rule, end to end.
describe("single seeded content-set auto-activation (Bug 2)", () => {
  const seeded: ViewerFileContent[] = [
    { path: "worked-example/draft.md", content: "# Title\n\nFirst block.\n\nSecond block." },
    { path: "worked-example/materials/kernel.md", content: "kernel" },
    { path: "worked-example/taste/taste-profile.md", content: "## 1. Voice floor\nVoice.\n" },
  ];

  /**
   * Mirror the store's content-set auto-selection (workspace-slice.ts): with no
   * active set and >0 trait-free content sets, the first is activated.
   */
  function autoActivate(sets: { prefix: string; traits?: { locale?: string; theme?: string } }[]): string {
    const hasTraits = sets.some((cs) => !!cs.traits?.locale || !!cs.traits?.theme);
    if (sets.length > 0 && !hasTraits) return sets[0].prefix;
    return "";
  }

  it("wordtaste's resolver surfaces the sole subdir as a content set", async () => {
    const wordtasteMode = (
      await import("../pneuma-mode.js")
    ).default;
    const resolve = wordtasteMode.viewer.workspace?.resolveContentSets;
    expect(typeof resolve).toBe("function");
    const sets = resolve!(seeded);
    expect(sets).toHaveLength(1);
    expect(sets[0].prefix).toBe("worked-example");
  });

  it("the lone set auto-activates and the draft then renders its blocks", async () => {
    const wordtasteMode = (await import("../pneuma-mode.js")).default;
    const sets = wordtasteMode.viewer.workspace!.resolveContentSets!(seeded);
    const active = autoActivate(sets);
    expect(active).toBe("worked-example");

    // The regression symptom was 0 blocks (root-derived). With the set active
    // the draft derives from worked-example/draft.md.
    const draft = deriveDraft(seeded, active);
    expect(draft).not.toBeNull();
    expect(draft!.blocks.length).toBeGreaterThan(0); // not the empty-root 0 blocks
    expect(deriveTaste(seeded, active)).not.toBeNull();
  });
});

import { describe, it, expect } from "bun:test";
import {
  loadAnnotations,
  annotationsForBlock,
  hasAnnotations,
  type DraftAnnotations,
} from "../domain.js";
import type { ViewerFileContent } from "../../../core/types/viewer-contract.js";

function files(map: Record<string, string>): ViewerFileContent[] {
  return Object.entries(map).map(([path, content]) => ({ path, content }));
}

const SAMPLE_JSON = JSON.stringify({
  version: 1,
  annotations: {
    b3: [
      { kind: "revision", text: "Cut the AI cadence opener.", ts: "2026-06-25T10:30:00Z" },
    ],
    b7: [
      { kind: "revision", text: "Corrected 1969 → 1972 per the source.", ts: "2026-06-25T10:31:00Z" },
      { kind: "note", text: "Kernel left untouched on purpose.", ts: "2026-06-25T10:32:00Z" },
    ],
  },
});

describe("loadAnnotations — the pinned draft.annotations.json contract", () => {
  it("returns null when no annotations file exists (default full-width article)", () => {
    expect(loadAnnotations(files({ "draft.md": "x" }))).toBeNull();
    expect(loadAnnotations([])).toBeNull();
  });

  it("parses the root annotations file keyed by block id", () => {
    const ann = loadAnnotations(files({ "draft.annotations.json": SAMPLE_JSON }))!;
    expect(ann.contentSet).toBe("");
    expect(Object.keys(ann.annotations).sort()).toEqual(["b3", "b7"]);
    expect(ann.annotations.b3[0].text).toContain("AI cadence");
    expect(ann.annotations.b7).toHaveLength(2);
  });

  it("reads annotations under a content-set prefix (writing-project scoped)", () => {
    const ann = loadAnnotations(
      files({ "essay/draft.annotations.json": SAMPLE_JSON }),
      "essay",
    )!;
    expect(ann.contentSet).toBe("essay");
    expect(ann.annotations.b3).toHaveLength(1);
  });

  it("degrades gracefully — malformed JSON yields null, never throws", () => {
    expect(loadAnnotations(files({ "draft.annotations.json": "{not json" }))).toBeNull();
    // A structurally-wrong payload (no annotations object) is also null.
    expect(
      loadAnnotations(files({ "draft.annotations.json": JSON.stringify({ version: 1 }) })),
    ).toBeNull();
  });

  it("drops malformed entries but keeps the valid ones", () => {
    const messy = JSON.stringify({
      version: 1,
      annotations: {
        b1: [
          { kind: "revision", text: "good", ts: "t" },
          { kind: "revision" }, // missing text — dropped
          "garbage", // not an object — dropped
        ],
        b2: "not an array", // dropped wholesale
      },
    });
    const ann = loadAnnotations(files({ "draft.annotations.json": messy }))!;
    expect(ann.annotations.b1).toHaveLength(1);
    expect(ann.annotations.b1[0].text).toBe("good");
    expect("b2" in ann.annotations).toBe(false);
  });

  it("normalizes an unknown kind to 'note' (only revision|note are valid)", () => {
    const odd = JSON.stringify({
      version: 1,
      annotations: { b1: [{ kind: "weird", text: "t", ts: "t" }] },
    });
    const ann = loadAnnotations(files({ "draft.annotations.json": odd }))!;
    expect(ann.annotations.b1[0].kind).toBe("note");
  });
});

describe("annotationsForBlock / hasAnnotations — viewer alignment helpers", () => {
  const ann: DraftAnnotations = {
    contentSet: "",
    annotations: {
      b3: [{ kind: "revision", text: "a", ts: "t" }],
      b7: [
        { kind: "revision", text: "b", ts: "t" },
        { kind: "note", text: "c", ts: "t" },
      ],
    },
  };

  it("returns the notes for a block, empty for an unannotated block", () => {
    expect(annotationsForBlock(ann, "b3")).toHaveLength(1);
    expect(annotationsForBlock(ann, "b7")).toHaveLength(2);
    expect(annotationsForBlock(ann, "b1")).toEqual([]);
    expect(annotationsForBlock(null, "b3")).toEqual([]);
  });

  it("hasAnnotations is true only when at least one block carries a note", () => {
    expect(hasAnnotations(ann)).toBe(true);
    expect(hasAnnotations(null)).toBe(false);
    expect(hasAnnotations({ contentSet: "", annotations: {} })).toBe(false);
    expect(
      hasAnnotations({ contentSet: "", annotations: { b1: [] } }),
    ).toBe(false);
  });
});

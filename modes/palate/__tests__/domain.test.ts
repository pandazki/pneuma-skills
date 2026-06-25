import { describe, it, expect } from "bun:test";
import {
  loadDraft,
  saveDraft,
  loadTaste,
  type Draft,
} from "../domain.js";
import type { ViewerFileContent } from "../../../core/types/viewer-contract.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function files(map: Record<string, string>): ViewerFileContent[] {
  return Object.entries(map).map(([path, content]) => ({ path, content }));
}

const SAMPLE = "# Title\n\nFirst paragraph.\n\nSecond paragraph.";

// ── loadDraft: block splitting ───────────────────────────────────────────────

describe("loadDraft — block splitting", () => {
  it("returns null on an empty workspace", () => {
    expect(loadDraft([])).toBeNull();
  });

  it("returns null when no draft.md exists", () => {
    expect(loadDraft(files({ "materials/outline.md": "# Outline" }))).toBeNull();
  });

  it("splits the root draft into top-level markdown blocks", () => {
    const d = loadDraft(files({ "draft.md": SAMPLE }))!;
    expect(d.contentSet).toBe("");
    expect(d.blocks.map((b) => b.markdown)).toEqual([
      "# Title",
      "First paragraph.",
      "Second paragraph.",
    ]);
  });

  it("keeps a fenced code block as a single block (does not split on its blank lines)", () => {
    const src = "Intro.\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n\nOutro.";
    const d = loadDraft(files({ "draft.md": src }))!;
    expect(d.blocks.map((b) => b.markdown)).toEqual([
      "Intro.",
      "```js\nconst a = 1;\n\nconst b = 2;\n```",
      "Outro.",
    ]);
  });

  it("keeps a multi-line list as one block", () => {
    const src = "Lead.\n\n- one\n- two\n- three\n\nTail.";
    const d = loadDraft(files({ "draft.md": src }))!;
    expect(d.blocks.map((b) => b.markdown)).toEqual([
      "Lead.",
      "- one\n- two\n- three",
      "Tail.",
    ]);
  });

  it("assigns fresh monotonic block ids when no sidecar exists", () => {
    const d = loadDraft(files({ "draft.md": SAMPLE }))!;
    expect(d.blocks.map((b) => b.id)).toEqual(["b1", "b2", "b3"]);
  });
});

// ── loadDraft: content-set prefixing ─────────────────────────────────────────

describe("loadDraft — content sets", () => {
  it("reads draft.md under a content-set prefix", () => {
    const d = loadDraft(files({ "essay/draft.md": SAMPLE }), "essay")!;
    expect(d.contentSet).toBe("essay");
    expect(d.blocks).toHaveLength(3);
  });
});

// ── loadDraft: id reconciliation (the fiddly invariant) ──────────────────────

describe("loadDraft — block-id reconciliation", () => {
  it("preserves ids by position+hash when content is unchanged", () => {
    const first = loadDraft(files({ "draft.md": SAMPLE }))!;
    const sidecar = JSON.stringify({
      version: 1,
      nextId: 4,
      blocks: first.blocks.map((b) => ({ id: b.id, hash: hashOf(b.markdown) })),
    });
    const reloaded = loadDraft(
      files({ "draft.md": SAMPLE, "draft.blocks.json": sidecar }),
    )!;
    expect(reloaded.blocks.map((b) => b.id)).toEqual(["b1", "b2", "b3"]);
  });

  it("keeps a block's id when a DIFFERENT block is rewritten (position match)", () => {
    const first = loadDraft(files({ "draft.md": SAMPLE }))!;
    const sidecar = JSON.stringify({
      version: 1,
      nextId: 4,
      blocks: first.blocks.map((b) => ({ id: b.id, hash: hashOf(b.markdown) })),
    });
    // Rewrite only the second block; first and third keep their position.
    const edited = "# Title\n\nFirst paragraph, now rewritten entirely.\n\nSecond paragraph.";
    const reloaded = loadDraft(
      files({ "draft.md": edited, "draft.blocks.json": sidecar }),
    )!;
    // b1 (heading) and b3 (last para) stay anchored; b2 is reconciled at its position.
    expect(reloaded.blocks[0].id).toBe("b1");
    expect(reloaded.blocks[2].id).toBe("b3");
    // The middle block reconciles to b2 (same position).
    expect(reloaded.blocks[1].id).toBe("b2");
  });

  it("assigns a fresh id to a genuinely new block from the monotonic counter", () => {
    const first = loadDraft(files({ "draft.md": SAMPLE }))!;
    const sidecar = JSON.stringify({
      version: 1,
      nextId: 4,
      blocks: first.blocks.map((b) => ({ id: b.id, hash: hashOf(b.markdown) })),
    });
    // Append a brand-new paragraph.
    const grown = SAMPLE + "\n\nThird paragraph appended.";
    const reloaded = loadDraft(
      files({ "draft.md": grown, "draft.blocks.json": sidecar }),
    )!;
    expect(reloaded.blocks).toHaveLength(4);
    expect(reloaded.blocks[3].id).toBe("b4");
  });
});

// ── loadDraft: freeze set ────────────────────────────────────────────────────

describe("loadDraft — freeze set", () => {
  it("marks blocks frozen from draft.freeze.json", () => {
    const first = loadDraft(files({ "draft.md": SAMPLE }))!;
    const sidecar = JSON.stringify({
      version: 1,
      nextId: 4,
      blocks: first.blocks.map((b) => ({ id: b.id, hash: hashOf(b.markdown) })),
    });
    const freeze = JSON.stringify({ frozen: ["b1"] });
    const reloaded = loadDraft(
      files({
        "draft.md": SAMPLE,
        "draft.blocks.json": sidecar,
        "draft.freeze.json": freeze,
      }),
    )!;
    expect(reloaded.blocks[0].frozen).toBe(true);
    expect(reloaded.blocks[1].frozen).toBe(false);
  });
});

// ── saveDraft: round-trip + diff ─────────────────────────────────────────────

describe("saveDraft", () => {
  it("re-serializes blocks back to draft.md joined with blank lines", () => {
    const draft = loadDraft(files({ "draft.md": SAMPLE }))!;
    const { writes } = saveDraft(draft, files({ "draft.md": SAMPLE }));
    const draftWrite = writes.find((w) => w.path === "draft.md")!;
    expect(draftWrite.content).toBe(SAMPLE);
  });

  it("round-trips: load → save → load yields stable ids", () => {
    const draft = loadDraft(files({ "draft.md": SAMPLE }))!;
    const { writes } = saveDraft(draft, files({ "draft.md": SAMPLE }));
    const written: Record<string, string> = {};
    for (const w of writes) written[w.path] = w.content;
    const reloaded = loadDraft(files(written))!;
    expect(reloaded.blocks.map((b) => b.id)).toEqual(["b1", "b2", "b3"]);
  });

  it("does not alter a frozen block's markdown when another block changes", () => {
    const base = loadDraft(files({ "draft.md": SAMPLE }))!;
    base.blocks[0].frozen = true;
    const frozenText = base.blocks[0].markdown;
    // Mutate a non-frozen block only.
    base.blocks[1].markdown = "First paragraph, edited.";
    const { writes } = saveDraft(base, files({ "draft.md": SAMPLE }));
    const draftWrite = writes.find((w) => w.path === "draft.md")!;
    // The frozen block's text survives verbatim in the serialized output.
    expect(draftWrite.content.startsWith(frozenText)).toBe(true);
    // The freeze sidecar records the frozen block.
    const freezeWrite = writes.find((w) => w.path === "draft.freeze.json")!;
    expect(JSON.parse(freezeWrite.content).frozen).toContain("b1");
  });

  it("writes draft.md under the content-set prefix", () => {
    const draft = loadDraft(files({ "essay/draft.md": SAMPLE }), "essay")!;
    const { writes } = saveDraft(draft, files({ "essay/draft.md": SAMPLE }));
    expect(writes.some((w) => w.path === "essay/draft.md")).toBe(true);
    expect(writes.some((w) => w.path === "essay/draft.blocks.json")).toBe(true);
  });
});

// ── loadTaste ────────────────────────────────────────────────────────────────

describe("loadTaste", () => {
  const PROFILE = [
    "# Taste Profile — test",
    "",
    "## 0. Calibration",
    "- longform → rung 4",
    "",
    "## 1. Voice floor",
    "The voice floor prose lives here.",
    "",
    "## 2. Symptom rubric",
    "1. **S1 term-scaffolding** — tell: jargon. fix: plain words.",
    "2. **S7 ai-metaphor** — tell: tidy analogies. fix: cut to plain.",
    "",
    "## 5. Meta-principles",
    "Over-patterning is the mother symptom.",
  ].join("\n");

  it("returns null when no taste-profile.md exists", () => {
    expect(loadTaste(files({ "draft.md": SAMPLE }))).toBeNull();
  });

  it("parses voice floor, rubric, launch rung and counts", () => {
    const t = loadTaste(
      files({
        "taste/taste-profile.md": PROFILE,
        "taste/recipes/longform.md": "recipe",
        "taste/swaps.jsonl": '{"a":1}\n{"a":2}\n',
        "taste/prefs.log.jsonl": '{"x":1}\n{"x":2}\n{"x":3}\n',
      }),
    )!;
    expect(t.voiceFloor).toContain("voice floor prose");
    expect(t.rubric.map((s) => s.id)).toEqual(["S1", "S7"]);
    expect(t.launchRung).toBe(4);
    expect(t.recipeNames).toEqual(["longform.md"]);
    expect(t.swapCount).toBe(2);
    expect(t.prefsCount).toBe(3);
  });

  it("counts jsonl lines ignoring trailing blank lines", () => {
    const t = loadTaste(
      files({
        "taste/taste-profile.md": PROFILE,
        "taste/swaps.jsonl": '{"a":1}\n\n',
      }),
    )!;
    expect(t.swapCount).toBe(1);
  });

  it("treats only line-leading `N.`/`-` list items as rubric cards, not prose/blockquote **Sn** refs", () => {
    // A real taste profile cross-references symptoms in scan-aid blockquotes and
    // warnings, sometimes bolding them (`**S5 is the drain of S7**`). Those are
    // PROSE, not card headers — they must not mint phantom or duplicate cards
    // (the right panel would otherwise show ghost symptoms).
    const profile = [
      "## 2. Symptom rubric",
      "> quick scan: skeleton (S2) first, then the **S5 reflex** and **S7 metaphor** templates.",
      "1. **S1 term-scaffolding** — tell: jargon. fix: plain words.",
      "2. **S2 marching skeleton** — tell: even beats. fix: reorder.",
      "",
      "> ⚠ **S5 is the drain of S7** — cut a metaphor and the urge reroutes here.",
      "",
      "## 5. Meta",
      "Over-patterning is the mother symptom.",
    ].join("\n");
    const t = loadTaste(files({ "taste/taste-profile.md": profile }))!;
    expect(t.rubric.map((s) => s.id)).toEqual(["S1", "S2"]);
  });
});

// ── Seed-content parse pins ──────────────────────────────────────────────────
//
// The shipped seed taste-profiles are the teaching artifacts AND the canonical
// schema palate writes for every user. They must parse cleanly through the very
// same loadTaste the viewer runs — no phantom cards from scan-aid blockquotes,
// no malformed tell/fix splits. These tests load the real seed files from disk
// so any future edit that re-introduces a parser collision fails here, not in
// the user's right panel.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SEED_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "seed");

function seedTaste(entry: string, extra: string[] = []): ViewerFileContent[] {
  const out: ViewerFileContent[] = [
    {
      path: "taste/taste-profile.md",
      content: readFileSync(join(SEED_DIR, entry, "taste/taste-profile.md"), "utf8"),
    },
  ];
  for (const rel of extra) {
    out.push({ path: rel, content: readFileSync(join(SEED_DIR, entry, rel), "utf8") });
  }
  return out;
}

describe("seed: worked-example taste-profile parses cleanly", () => {
  const t = loadTaste(
    seedTaste("worked-example", [
      "taste/recipes/longform.md",
      "taste/swaps.jsonl",
      "taste/prefs.log.jsonl",
    ]),
  )!;

  it("yields exactly the seven S1..S7 symptom cards (no phantom/duplicate cards)", () => {
    expect(t.rubric.map((s) => s.id)).toEqual([
      "S1",
      "S2",
      "S3",
      "S4",
      "S5",
      "S6",
      "S7",
    ]);
  });

  it("splits a non-empty tell and fix for every card", () => {
    for (const s of t.rubric) {
      expect(s.title.length, `${s.id} title`).toBeGreaterThan(0);
      expect(s.tell.length, `${s.id} tell`).toBeGreaterThan(0);
      expect(s.fix.length, `${s.id} fix`).toBeGreaterThan(0);
    }
  });

  it("reads the calibrated launch rung and golden-material counters", () => {
    expect(t.launchRung).toBe(4);
    expect(t.voiceFloor.length).toBeGreaterThan(0);
    expect(t.recipeNames).toEqual(["longform.md"]);
    expect(t.swapCount).toBe(4);
    expect(t.prefsCount).toBe(12);
  });
});

describe("seed: starter taste-profile parses as an uncalibrated bootstrap", () => {
  for (const entry of ["from-idea", "from-draft"]) {
    it(`${entry}: launch rung 1, voice-floor prose, two example symptom cards`, () => {
      const t = loadTaste(seedTaste(entry))!;
      expect(t.launchRung).toBe(1);
      expect(t.voiceFloor.length).toBeGreaterThan(0);
      expect(t.rubric.map((s) => s.id)).toEqual(["S1", "S2"]);
      for (const s of t.rubric) {
        expect(s.tell.length, `${s.id} tell`).toBeGreaterThan(0);
        expect(s.fix.length, `${s.id} fix`).toBeGreaterThan(0);
      }
    });
  }
});

// Local re-implementation of the content hash for test fixtures — kept in
// sync with domain.ts via the round-trip tests above (which never depend on
// the exact algorithm, only on stability).
function hashOf(s: string): string {
  // FNV-1a 32-bit — small, deterministic, no deps. Mirrors domain.ts.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

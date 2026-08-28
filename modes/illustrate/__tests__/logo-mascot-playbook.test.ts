/**
 * The logo & mascot playbook — pinned as source text, because `SKILL.md`,
 * `references/logo-mascot.md` and the `ip-mascots` seed are the only places
 * this craft is ever stated, and the agent is their only reader.
 *
 * Two failures this suite exists to prevent:
 *
 *  1. **Silent drift from upstream.** The playbook is adapted from
 *     `s1dashu/ip-as-logo-skill` (MIT). Before 0.5.0 it recorded no pin, so
 *     nobody could tell what it had been synced against and every re-sync
 *     started by re-reading the whole upstream history. The pin line is pinned.
 *  2. **A half-applied sync.** Guidance lives in three files that are read at
 *     different moments — the playbook by the agent mid-task, the routing blurb
 *     in `SKILL.md` when it decides to open the playbook at all, and the seed
 *     prompts by whoever starts from the `ip-mascots` content set. A rule
 *     changed in one and left stale in another is invisible until an agent
 *     follows the stale copy. So each end-state rule is asserted in every file
 *     that states it, and the superseded numbers are asserted absent.
 *
 * What is deliberately NOT synced is pinned too — see the rubric block at the
 * bottom. Upstream deleted candidate evaluation outright; Illustrate keeps it
 * and bans silent filtering instead. That divergence is a decision, not a
 * lag, and a future sync should have to delete a failing test to undo it.
 *
 * None of this polices prose: no assertion here fixes a sentence. They check
 * that a rule is stated, and that its superseded form is gone.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import illustrateManifest from "../manifest.js";

const MODE_DIR = join(import.meta.dir, "..");
const SKILL = readFileSync(join(MODE_DIR, "skill", "SKILL.md"), "utf-8");
const PLAYBOOK = readFileSync(
  join(MODE_DIR, "skill", "references", "logo-mascot.md"),
  "utf-8",
);
const SEED = JSON.parse(
  readFileSync(join(MODE_DIR, "seed", "ip-mascots", "manifest.json"), "utf-8"),
) as {
  rows: { label: string; items: { title: string; prompt: string }[] }[];
};

/** The fenced ```text block that follows `heading`. */
function fencedTextAfter(source: string, heading: string): string {
  const start = source.indexOf(heading);
  expect([heading, start]).not.toEqual([heading, -1]);
  const open = source.indexOf("```text", start);
  expect([heading, open]).not.toEqual([heading, -1]);
  const bodyStart = open + "```text\n".length;
  const close = source.indexOf("```", bodyStart);
  expect([heading, close]).not.toEqual([heading, -1]);
  return source.slice(bodyStart, close);
}

const SKELETON = fencedTextAfter(PLAYBOOK, "## Prompt skeleton");
const SEED_ITEMS = SEED.rows.flatMap((row) => row.items);
/** Every string this mode ever sends to an image generator, or teaches as one. */
const GENERATION_PROMPTS: [string, string][] = [
  ["playbook skeleton", SKELETON],
  ...SEED_ITEMS.map((item): [string, string] => [item.title, item.prompt]),
];

// ── provenance ──────────────────────────────────────────────────────────────

describe("upstream provenance", () => {
  test("the playbook header records the commit it was synced against", () => {
    const header = PLAYBOOK.slice(0, PLAYBOOK.indexOf("## "));
    expect(header).toContain("s1dashu/ip-as-logo-skill@acb834c");
    // The attribution is a licence obligation, not decoration.
    expect(header).toContain("@s1dashu");
    expect(header).toContain("MIT");
  });
});

// ── the generation prompt never names the use case ──────────────────────────

describe("prompt hygiene", () => {
  // Naming the deliverable steers these models toward badges, frames, mask
  // shapes and flat clip-art; image-mode vocabulary steers them toward
  // cut-outs and matte edges. Both classes of word are banned from the prompt
  // and from nowhere else — the playbook states the rule using the very words
  // it bans, which is why this asserts over the fenced prompts only.
  const BANNED = [
    /\blogos?\b/i,
    /\bbrand marks?\b/i,
    /\bapp[- ]icons?\b/i,
    /\bicon assets?\b/i,
    /\bopaque\b/i,
    /\balpha\b/i,
    /\btransparency\b/i,
  ];

  for (const [label, prompt] of GENERATION_PROMPTS) {
    test(`${label} names an image, not its use`, () => {
      for (const banned of BANNED) {
        expect([label, banned.source, banned.test(prompt)]).toEqual([
          label,
          banned.source,
          false,
        ]);
      }
    });
  }

  test("the playbook states the rule where the skeleton is filled in", () => {
    const section = PLAYBOOK.slice(PLAYBOOK.indexOf("## Prompt skeleton"));
    expect(section).toContain("Never tell the generator what the image is for");
    // ...and scopes it, so nobody strips the logo framing off the conversation.
    expect(section).toContain("the generation prompt only");
  });
});

// ── composition: a dominant corner, not a prescribed crop ───────────────────

describe("dominant corner composition", () => {
  test("the playbook asks for 85-95% out of an assigned corner", () => {
    expect(PLAYBOOK).toMatch(/85[-–]95%/);
    expect(SKELETON).toMatch(/85[-–]95%/);
    expect(PLAYBOOK).toContain("assigned corner");
    expect(PLAYBOOK).toContain("do not prescribe an exact edge contact or a fixed crop");
  });

  test("the superseded 75-85% band and head-only crop are gone everywhere", () => {
    for (const [label, text] of [
      ["playbook", PLAYBOOK] as const,
      ["SKILL.md", SKILL] as const,
      ...SEED_ITEMS.map((i) => [i.title, i.prompt] as const),
    ]) {
      expect([label, /75[-–]85/.test(text)]).toEqual([label, false]);
      expect([label, /head-only/i.test(text)]).toEqual([label, false]);
    }
    // The 0.3.0 changelog entry still says "corner-crop composition"; it is a
    // historical record and must not be retro-edited. The routing blurb is not.
    expect(SKILL).not.toContain("corner-crop composition");
    expect(SKILL).toContain("dominant corner composition");
  });

  test("a batch assigns corners rather than leaving the side to the model", () => {
    const workflow = PLAYBOOK.slice(
      PLAYBOOK.indexOf("## Identity workflow"),
      PLAYBOOK.indexOf("## Complexity budget"),
    );
    expect(workflow).toContain("assign every candidate a corner");
    expect(workflow).toContain("lower-left");
    expect(workflow).toContain("lower-right");
  });

  test("every seed candidate names its corner in both prompt and title", () => {
    expect(SEED_ITEMS).toHaveLength(6);
    const sides = SEED_ITEMS.map((item) => {
      expect([item.title, /lower-(left|right)/.test(item.title)]).toEqual([
        item.title,
        true,
      ]);
      expect([item.title, /filling about 85/.test(item.prompt)]).toEqual([
        item.title,
        true,
      ]);
      const inPrompt = item.prompt.match(/emerging from the (lower-left|lower-right)/);
      expect([item.title, inPrompt?.[1]]).not.toEqual([item.title, undefined]);
      expect(item.title).toContain(inPrompt![1]);
      return inPrompt![1];
    });
    // Three directions × two takes, each direction seen once from each side.
    expect(sides.filter((s) => s === "lower-left")).toHaveLength(3);
    expect(sides.filter((s) => s === "lower-right")).toHaveLength(3);
  });
});

// ── depth: one sentence, no number ──────────────────────────────────────────

describe("barely-there depth", () => {
  test("the skeleton asks for depth in the one sanctioned sentence", () => {
    expect(SKELETON).toContain(
      "extremely, extremely subtle, almost imperceptible sense of depth through a barely-there neo-skeuomorphic treatment",
    );
    expect(PLAYBOOK).toContain("one sentence with no numbers");
  });

  test("the 8-12% modeling budget is gone from every file that stated it", () => {
    for (const [label, text] of [
      ["playbook", PLAYBOOK] as const,
      ["SKILL.md", SKILL] as const,
      ...SEED_ITEMS.map((i) => [i.title, i.prompt] as const),
    ]) {
      expect([label, /8[-–]12\s?%/.test(text)]).toEqual([label, false]);
    }
  });

  test("incidental shading is a property of the draw, not a defect", () => {
    expect(PLAYBOOK).toContain("What is not a failure:");
    const rubric = PLAYBOOK.slice(PLAYBOOK.indexOf("**What is not a failure:**"));
    for (const allowed of ["tonal variation", "mild dimensionality", "transparent background"]) {
      expect(rubric).toContain(allowed);
    }
  });

  test("every seed prompt keeps the color-family exemption it depends on", () => {
    for (const item of SEED_ITEMS) {
      expect([item.title, item.prompt.includes("Tonal variation within either")]).toEqual([
        item.title,
        true,
      ]);
    }
  });
});

// ── the genre stays logo-first, and the model floor is explicit ─────────────

describe("genre and model floor", () => {
  test("the playbook is still a logo first and a character second", () => {
    // Upstream pivoted to "the simplest possible cute IP character" in the same
    // window. Illustrate did not: the complexity budget stays at 6-10 shapes
    // and the mark still has to survive at 32 x 32.
    expect(PLAYBOOK.replace(/\s+/g, " ")).toContain("logo first and a character second");
    expect(PLAYBOOK).toMatch(/6[-–]10 basic geometric/);
    expect(SKELETON).toContain("use 6-10 broad basic shapes");
    expect(PLAYBOOK).toContain("32 × 32");
  });

  test("identity work names the models the scripts actually dispatch to", () => {
    const settings = PLAYBOOK.slice(
      PLAYBOOK.indexOf("## Script settings"),
      PLAYBOOK.indexOf("## Prompt skeleton"),
    );
    expect(settings).toContain("gpt-image-2");
    expect(settings).toContain("gemini-3-pro");
    // A missing key is a blocker to report, never a licence to hand-draw one.
    expect(settings).toContain("FAL_KEY");
    expect(settings).toContain("OPENROUTER_API_KEY");
    expect(settings).toContain("Never stand in for a generation");
    expect(settings).toMatch(/never a reason to fabricate a result/);
  });
});

// ── the divergence we chose to keep ─────────────────────────────────────────

describe("candidate evaluation (deliberately not synced)", () => {
  test("the rubric survives, and says why it survives", () => {
    expect(PLAYBOOK).toContain("Mark a candidate **non-recommended** when:");
    expect(PLAYBOOK).toContain("**Result integrity:**");
    expect(PLAYBOOK).toContain("no hidden retries");
    // The note exists so a later sync sees a decision, not an oversight.
    expect(PLAYBOOK).toContain("Upstream dropped this rubric");
  });

  test("SKILL.md still routes to the rubric it promises", () => {
    const blurb = SKILL.slice(SKILL.indexOf("### Logos & mascots"));
    expect(blurb).toContain("references/logo-mascot.md");
    expect(blurb).toContain("the **evaluation rubric**");
    expect(blurb).toContain("never silently filter or retry");
  });
});

// ── the version that carries all of it ──────────────────────────────────────

describe("skill version", () => {
  test("0.5.0 ships the sync with a changelog the update prompt can read", () => {
    expect(illustrateManifest.version).toBe("0.5.0");
    // A bump without a same-key entry ships a silent update — the launcher's
    // skill-update prompt reads its bullets straight out of this map.
    expect(illustrateManifest.changelog?.[illustrateManifest.version!]).toBeDefined();
    expect(illustrateManifest.changelog?.["0.5.0"]?.join(" ")).toContain("acb834c");
    // Earlier entries are history and stay put.
    expect(illustrateManifest.changelog?.["0.3.0"]).toHaveLength(4);
    expect(illustrateManifest.changelog?.["0.4.0"]).toHaveLength(3);
  });
});

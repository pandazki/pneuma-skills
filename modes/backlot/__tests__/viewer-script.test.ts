/**
 * Screenplay typography and the stage copy.
 *
 * The classifier is the only part of the Script view with a rule in it, and
 * the rule it has to keep is modest: NOTHING IS DROPPED and nothing is
 * rewritten. A block it cannot place is action — the neutral setting — so
 * the worst case is a paragraph a typesetter would have centred, never a
 * line of the creator's screenplay that disappeared off the page.
 */

import { describe, expect, test } from "bun:test";

import { STAGES } from "../domain.js";
import { hasInlineMarkdown, screenplayBlocks } from "../viewer/screenplay.js";
import { STAGE_BLURB } from "../viewer/StageEmpty.js";

const kinds = (markdown: string) => screenplayBlocks(markdown).map((b) => b.kind);
const texts = (markdown: string) => screenplayBlocks(markdown).map((b) => b.text);

describe("screenplay blocks", () => {
  test("a heading is a scene heading, at its own depth", () => {
    const blocks = screenplayBlocks("# Act one\n\n## INT. 便利店 — 夜\n");
    expect(blocks).toEqual([
      { kind: "scene", text: "Act one", level: 1 },
      { kind: "scene", text: "INT. 便利店 — 夜", level: 2 },
    ]);
  });

  test("a bold name is a cue and the line under it is dialogue", () => {
    expect(kinds("**小凯**\n还开着吗？")).toEqual(["cue", "dialogue"]);
    expect(texts("**小凯**\n还开着吗？")).toEqual(["小凯", "还开着吗？"]);
  });

  test("a Chinese name with a colon is a cue", () => {
    expect(kinds("小凯：\n还开着吗？")).toEqual(["cue", "dialogue"]);
  });

  test("an all-caps name is a cue, but a slug line is not", () => {
    expect(kinds("KAI\nIs it still open?")).toEqual(["cue", "dialogue"]);
    // `INT.` / `EXT.` are caps too, and they are the one thing that must not
    // be read as somebody's name.
    expect(kinds("INT. STORE — NIGHT\n\nHe pushes the door.")).toEqual(["action", "action"]);
  });

  test("a cue standing alone hands the next block its line", () => {
    expect(kinds("**小凯**\n\n还开着吗？\n\n他推开门。")).toEqual(["cue", "dialogue", "action"]);
  });

  test("a cue that already carries its line does NOT capture the next block", () => {
    // The commonest shape in the wild, and the one a naive "speaking" flag
    // gets wrong: the action after the speech must stay action.
    expect(kinds("**小凯**\n还开着吗？\n\n他推开门，风铃响。")).toEqual([
      "cue",
      "dialogue",
      "action",
    ]);
  });

  test("a parenthetical sits between the cue and the line", () => {
    expect(kinds("**KAI**\n(quietly)\nIs it still open?")).toEqual([
      "cue",
      "parenthetical",
      "dialogue",
    ]);
  });

  test("a name and its line on ONE line is a cue and a line", () => {
    // The commonest Chinese shape, and the one the first fixture caught the
    // classifier missing: `小凯：还开着吗？` was being set as action.
    expect(kinds("小凯：还开着吗？")).toEqual(["cue", "dialogue"]);
    expect(texts("小凯：还开着吗？")).toEqual(["小凯", "还开着吗？"]);
  });

  test("a parenthetical written BEFORE the name still finds the name", () => {
    expect(kinds("（很轻）\n店员：\n开着。就剩你了。")).toEqual([
      "parenthetical",
      "cue",
      "dialogue",
    ]);
  });

  test("prose attribution is not a cue — it quotes what was said", () => {
    expect(kinds("他说：“还开着吗？”")).toEqual(["action"]);
  });

  test("a quoted block is speech wherever it appears", () => {
    expect(kinds("> 还开着吗？\n\n他推开门。")).toEqual(["dialogue", "action"]);
  });

  test("lists and tables are handed back to the markdown renderer whole", () => {
    expect(kinds("- one\n- two")).toEqual(["markdown"]);
    expect(kinds("| a | b |\n| - | - |")).toEqual(["markdown"]);
  });

  test("nothing is dropped: every non-empty paragraph produces a block", () => {
    const md = "## Scene\n\nAction.\n\n**KAI**\nLine.\n\nMore action.\n\n> Quoted.\n";
    const paragraphs = md.split(/\n{2,}/).filter((p) => p.trim().length > 0);
    // The cue paragraph becomes two blocks (cue + dialogue), so the count is
    // never LOWER than the paragraph count.
    expect(screenplayBlocks(md).length).toBeGreaterThanOrEqual(paragraphs.length);
    const joined = texts(md).join("\n");
    for (const needle of ["Scene", "Action.", "KAI", "Line.", "More action.", "Quoted."]) {
      expect(joined).toContain(needle);
    }
  });

  test("an empty screenplay is no blocks, not one empty one", () => {
    expect(screenplayBlocks("")).toEqual([]);
    expect(screenplayBlocks("\n\n   \n")).toEqual([]);
  });

  test("inline markdown is only parsed when there is any", () => {
    expect(hasInlineMarkdown("plain 中文 text.")).toBe(false);
    expect(hasInlineMarkdown("a *stressed* word")).toBe(true);
  });
});

describe("stage copy", () => {
  test("every stage says what the agent will produce there", () => {
    for (const stage of STAGES) {
      const blurb = STAGE_BLURB[stage];
      expect(blurb.length).toBeGreaterThan(60);
      // The copy is for a person, not a console: no script names or flags.
      expect(blurb).not.toMatch(/\.mjs|--[a-z]/);
    }
  });

  test("the greybox is called a greybox — 白模 in Chinese, never 灰模", () => {
    expect(STAGE_BLURB.previz).toContain("greybox");
    expect(Object.values(STAGE_BLURB).join(" ")).not.toContain("灰模");
  });
});

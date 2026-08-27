/** @jsxImportSource react */
/**
 * Sections, and the asset slot.
 *
 * Until 0.17.0 a WordTaste draft was a title and a run of paragraphs: the
 * writer's constraints banned every other construct, and the pipeline had no
 * way to say a piece needed something that was not a sentence. Two constructs
 * exist now, and both are deliberately narrow.
 *
 * A **section** is one heading level and no more. Where a section opens is the
 * plan's decision — `opens_section`, a boolean, so nothing about it touches
 * the rule that every Chinese string in a plan is a verbatim quote of the
 * author's material. What the heading says is the writer's decision, written
 * where the rest of the Chinese is written and checked where the rest of the
 * Chinese is checked.
 *
 * An **asset slot** is a multimodal element written down in words rather than
 * made: what belongs there, and the words that thing has to carry. Nothing is
 * generated and no file is linked. The draft holds the description so that a
 * later agent whose job is making artifacts has a brief to read.
 */

import { describe, expect, it, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ReactMarkdown from "react-markdown";
import { renderToStaticMarkup } from "react-dom/server";
import type { ViewerFileContent } from "../../../core/types/viewer-contract.js";
import { loadDraft, parseAssetSlot } from "../domain.js";
import { buildSpanAddress, planRows } from "../viewer/studio-logic.js";
import type { Plan } from "../domain.js";
import { WORDTASTE_MARKDOWN_COMPONENTS } from "../viewer/markdown-components.js";
import {
  WORDTASTE_REHYPE_PLUGINS,
  WORDTASTE_REMARK_PLUGINS,
} from "../viewer/markdown-plugins.js";
import {
  assembleUnitConstraints,
  stripAssetBlocks,
  type Scaffolding,
} from "../skill/scripts/lib/prompt-assembly.ts";
import { sampleVoice } from "../skill/scripts/lib/sampling.ts";

const skillDir = join(import.meta.dir, "..", "skill");
const S = JSON.parse(
  readFileSync(join(skillDir, "references", "prompt-scaffolding.en.json"), "utf8"),
) as Scaffolding;

const render = (markdown: string): string =>
  renderToStaticMarkup(
    <ReactMarkdown
      remarkPlugins={WORDTASTE_REMARK_PLUGINS}
      rehypePlugins={WORDTASTE_REHYPE_PLUGINS}
      components={WORDTASTE_MARKDOWN_COMPONENTS}
    >
      {markdown}
    </ReactMarkdown>,
  );

const ASSET = ["```asset", "what: 一张回路示意图", "copy: 输入", "copy: 第一次改写", "```"].join("\n");

function files(map: Record<string, string>): ViewerFileContent[] {
  return Object.entries(map).map(([path, content]) => ({ path, content }));
}

describe("the asset slot format", () => {
  it("reads what and the copy lines, in the order they were written", () => {
    expect(parseAssetSlot("what: 一张回路示意图\ncopy: 输入\ncopy: 第一次改写\n")).toEqual({
      what: "一张回路示意图",
      copy: ["输入", "第一次改写"],
    });
  });

  it("accepts the full-width colon the writer is told to type", () => {
    // The constraints say full-width Chinese punctuation; a parser that only
    // knew `:` would reject roughly half of what the writer actually produces.
    expect(parseAssetSlot("what：一张回路示意图\ncopy：输入")).toEqual({
      what: "一张回路示意图",
      copy: ["输入"],
    });
  });

  it("carries no copy at all when the thing has no words in it", () => {
    expect(parseAssetSlot("what: 一张办公室的照片")).toEqual({
      what: "一张办公室的照片",
      copy: [],
    });
  });

  it.each([
    ["an unknown key", "what: 图\ncaption: 说明"],
    ["a repeated what", "what: 图一\nwhat: 图二"],
    ["no what at all", "copy: 输入"],
    ["an empty value", "what:"],
    ["prose instead of keys", "这里应该放一张图。"],
  ])("refuses %s rather than guessing", (_label, body) => {
    expect(parseAssetSlot(body)).toBeNull();
  });
});

describe("a draft that has sections and slots", () => {
  const draft = loadDraft(
    files({ "draft.md": `# 标题\n\n第一段。\n\n## 两条腿走路\n\n第二段。\n\n${ASSET}\n` }),
  )!;

  it("tells structure apart from prose, block by block", () => {
    expect(draft.blocks.map((block) => block.kind)).toEqual([
      "heading",
      "prose",
      "heading",
      "prose",
      "asset",
    ]);
  });

  it("hands the parsed slot along with the block that holds it", () => {
    expect(draft.blocks[4].asset).toEqual({ what: "一张回路示意图", copy: ["输入", "第一次改写"] });
  });

  it("leaves a malformed slot as an ordinary code block", () => {
    // Visible and fixable beats parsed-away and invisible.
    const bad = loadDraft(files({ "draft.md": "```asset\n这里放张图\n```\n" }))!;
    expect(bad.blocks[0].kind).toBe("prose");
    expect(bad.blocks[0].asset).toBeUndefined();
  });
});

describe("the reading surface", () => {
  it("prints a slot as a card, not as source", () => {
    const html = render(ASSET);
    expect(html).toContain('class="wordtaste-asset"');
    expect(html).toContain("一张回路示意图");
    expect(html).toContain("第一次改写");
    expect(html).not.toContain("<pre>");
    expect(html).not.toContain("what:");
  });

  it("still prints an ordinary fenced block as a code block", () => {
    const html = render("```js\nconst a = 1;\n```");
    expect(html).toContain("<pre>");
    expect(html).not.toContain("wordtaste-asset");
  });

  it("mounts the same components map on every markdown surface", () => {
    // Same reason the plugin list is one value: a draft that draws a card and
    // a candidate that draws raw source teaches the reader that the surface
    // is unreliable.
    const viewer = readFileSync(
      join(import.meta.dir, "..", "viewer", "WordtastePreview.tsx"),
      "utf8",
    );
    const mounts = viewer.match(/<ReactMarkdown/g)?.length ?? 0;
    const wired = viewer.match(/components=\{WORDTASTE_MARKDOWN_COMPONENTS\}/g)?.length ?? 0;
    expect(mounts).toBeGreaterThan(0);
    expect(wired).toBe(mounts);
  });
});

describe("pointing at a section", () => {
  it("addresses the heading text itself, not the `## ` that draws it", () => {
    // Headings never had an address before, because drafts never had headings.
    // They need no new machinery: what the reader selects is the heading text,
    // and that text is a verbatim slice of the markdown, which is all the
    // address lookup ever asked for.
    const markdown = "# 标题\n\n第一段。\n\n## 两条腿走路\n\n第二段。\n";
    const address = buildSpanAddress({ contentSet: "", markdown, quote: "两条腿走路" })!;
    expect(address).not.toBeNull();
    expect(markdown.slice(address.start, address.end)).toBe("两条腿走路");
    expect(address.quote).toBe("两条腿走路");
  });
});

describe("the layout gate", () => {
  const plan = (marks: Array<boolean | undefined>): Plan => ({
    version: 1,
    title: "两张工作台",
    claims: [{ text: "大部分时候它够用。", source: "materials/original.md" }],
    units: marks.map((opens, index) => ({
      id: `u${index + 1}`,
      role: "reasoning" as const,
      spans: [],
      must_keep: [],
      target_chars: 700,
      pace: "mixed" as const,
      ends: "open" as const,
      notes_en: "",
      ...(opens === undefined ? {} : { opens_section: opens }),
    })),
  });

  it("shows which units open a section, because that is what the gate ratifies", () => {
    // The gate is also where units are reordered and merged. A section
    // boundary the user cannot see is one they cannot move.
    expect(planRows(plan([undefined, true, false])).map((row) => row.opensSection)).toEqual([
      false,
      true,
      false,
    ]);
  });

  it("never marks the first unit, whose opening is the title", () => {
    expect(planRows(plan([true, false])).map((row) => row.opensSection)).toEqual([false, false]);
  });
});

describe("what the writer is told", () => {
  test("a unit that opens a section is asked for a heading; one that does not is not", () => {
    const opening = assembleUnitConstraints(S, false, true);
    expect(opening).toContain(S.unit_constraint_section);
    expect(opening).toContain("## ");
    expect(assembleUnitConstraints(S, false, false)).not.toContain(S.unit_constraint_section);
    expect(assembleUnitConstraints(S, false)).not.toContain(S.unit_constraint_section);
  });

  test("the first unit is asked for the title as a level-one heading", () => {
    expect(assembleUnitConstraints(S, true, false)).toContain("`# `");
  });

  test("a first unit marked as opening a section is not asked for two first lines", () => {
    // The title is that opening. Ignoring the flag beats refusing the plan
    // over it — a whole plan is expensive, a redundant boolean is not.
    const first = assembleUnitConstraints(S, true, true);
    expect(first).toContain("`# `");
    expect(first).not.toContain(S.unit_constraint_section);
    expect(first.trim().split("\n")).toHaveLength(1);
  });

  test("the charter shows the asset format and stays free of Chinese", () => {
    // The charter is machine-written English by design — the prompt's whole
    // thesis is that the Chinese a writer reads is the Chinese it writes, so
    // even the worked example is in English.
    const shape = [
      S.system.shape_heading,
      ...S.system.shape,
      ...S.system.shape_asset_example,
      ...S.system.shape_close,
    ].join("\n");
    expect(shape).toContain("```asset");
    expect(shape).toContain("what:");
    expect(shape).toContain("copy:");
    expect(shape).not.toMatch(/[　-〿㐀-鿿＀-￯]/);
  });
});

describe("what the next writer reads", () => {
  test("a slot never comes back as the user's own voice", () => {
    // `<preceding_prose>` is one door into a writer's prompt; `<user_voice>`
    // is the other. Accepted pieces are stored verbatim and sampled into that
    // block as the way this person writes — so the window is cut after the
    // slots come out, or a specification arrives labelled as someone's voice.
    const root = mkdtempSync(join(tmpdir(), "wordtaste-voice-asset-"));
    try {
      const positive = join(root, "taste", "examples", "positive");
      mkdirSync(positive, { recursive: true });
      const out = join(root, "out");
      mkdirSync(out);
      writeFileSync(
        join(positive, "accepted.md"),
        [
          "第一张台子只做粗活，木屑随手扫到地上，做坏了就再来一块，大部分时候它够用。",
          "",
          ASSET,
          "",
          "第二张台子干净得多，尺量到半毫米，胶干透之前不许碰，慢到让人焦躁。",
          "",
        ].join("\n"),
      );
      sampleVoice(join(root, "taste"), out, "voice-asset-seed");
      const examples = readFileSync(join(out, "voice_examples.md"), "utf8");
      // Both surrounding paragraphs, so the window provably spans the place
      // the slot used to sit — an assertion that only saw one of them would
      // pass on a window that never reached the slot at all.
      expect(examples).toContain("第一张台子");
      expect(examples).toContain("第二张台子");
      expect(examples).not.toContain("asset");
      expect(examples).not.toContain("what:");
      expect(examples).not.toContain("粗活台");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("asset blocks come out of the preceding prose, headings stay", () => {
    // `<preceding_prose>` is the last thing a writer reads, and a block of
    // keys and values in that position is a register it would imitate.
    const draft = `# 标题\n\n第一段。\n\n${ASSET}\n\n## 两条腿走路\n\n第二段。\n`;
    const stripped = stripAssetBlocks(draft);
    expect(stripped).not.toContain("```asset");
    expect(stripped).not.toContain("what:");
    expect(stripped).toContain("## 两条腿走路");
    expect(stripped).toBe("# 标题\n\n第一段。\n\n## 两条腿走路\n\n第二段。\n");
  });

  test("a draft with no slot is handed over unchanged", () => {
    const draft = "# 标题\n\n第一段。\n\n第二段。\n";
    expect(stripAssetBlocks(draft)).toBe(draft);
  });

  test("an unterminated fence is left alone rather than eating the rest", () => {
    const draft = "第一段。\n\n```asset\nwhat: 图\n\n第二段。\n";
    expect(stripAssetBlocks(draft)).toBe(draft);
  });
});

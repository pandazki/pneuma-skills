/**
 * Selecting a sentence the renderer did not print verbatim.
 *
 * The bug this pins is a silent one: once `rehype-katex` typesets a draft,
 * `Selection.toString()` returns glyphs (`t=(user_id,agent_id)`) while
 * `draft.md` holds TeX (`$t = (\mathit{user\_id}, \mathit{agent\_id})$`), so
 * the span lookup finds nothing, no menu opens, and the reader is told
 * nothing. On a math-heavy essay — the kind this mode exists for — that is
 * most of the sentences.
 *
 * Markdown's own inline markup opens the same gap with no math anywhere: the
 * page shows `recipe_json.py` where the file wrote `` `recipe_json.py` ``,
 * 强调 where it wrote `**强调**`, and a link's text where it wrote
 * `[text](url)`. Measured on this mode's demo draft, that alone cost every
 * one of the 19 paragraphs carrying a code span. So the walk knows those
 * constructs the way it knows `.katex`, and the two halves are pinned here
 * together — they are one mechanism.
 *
 * Fixtures are rendered by the real pipeline (`WORDTASTE_REMARK_PLUGINS` +
 * `WORDTASTE_REHYPE_PLUGINS` through `renderToStaticMarkup`) and parsed by
 * happy-dom, so the walk is tested against KaTeX's actual markup rather than
 * a hand-written imitation of it. Hand-written KaTeX HTML drifts; this does
 * not.
 *
 * happy-dom has no CSS engine, so `.katex-mathml { user-select: none }` — the
 * rule that keeps the assistive copy out of a browser selection — does
 * nothing here. That is not a gap in the fixture: the walk skips the whole
 * `.katex` subtree by construction, which is exactly why it does not care
 * what a Selection would or would not have picked up.
 */

import { describe, expect, it } from "bun:test";
import { Window } from "happy-dom";
import ReactMarkdown from "react-markdown";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  WORDTASTE_REHYPE_PLUGINS,
  WORDTASTE_REMARK_PLUGINS,
} from "../viewer/markdown-plugins.js";
import {
  locateSegments,
  readRangeSegments,
  segmentsHaveConstruct,
  segmentsToSource,
  type SourceSegment,
} from "../viewer/math-selection.js";
import { buildSpanAddress } from "../viewer/studio-logic.js";

// ── harness ─────────────────────────────────────────────────────────────────

/** Exactly the markup the viewer's draft surface mounts, in a real DOM. */
function mount(markdown: string): { doc: Document; article: Element } {
  const html = renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      {
        remarkPlugins: WORDTASTE_REMARK_PLUGINS,
        rehypePlugins: WORDTASTE_REHYPE_PLUGINS,
      },
      markdown,
    ),
  );
  return mountHtml(html);
}

function mountHtml(html: string): { doc: Document; article: Element } {
  const window = new Window({ url: "http://localhost/" });
  const doc = window.document as unknown as Document;
  doc.body.innerHTML = `<article class="wordtaste-draft">${html}</article>`;
  return { doc, article: doc.body.firstElementChild as Element };
}

function textNodes(root: Node): Text[] {
  const out: Text[] = [];
  const walk = (node: Node): void => {
    if (node.nodeType === 3) {
      out.push(node as Text);
      return;
    }
    for (const child of Array.from(node.childNodes)) walk(child);
  };
  walk(root);
  return out;
}

/** The (node, offset) boundary at the start of `needle`'s first occurrence. */
function point(root: Node, needle: string, shift = 0): [Text, number] {
  for (const node of textNodes(root)) {
    const index = node.data.indexOf(needle);
    if (index >= 0) return [node, index + shift];
  }
  throw new Error(`no text node holding ${JSON.stringify(needle)}`);
}

function rangeBetween(
  doc: Document,
  start: [Node, number],
  end: [Node, number],
): Range {
  const range = doc.createRange();
  range.setStart(start[0], start[1]);
  range.setEnd(end[0], end[1]);
  return range;
}

/** A boundary inside a formula's rendered glyphs — where a drag can stop. */
function insideFormula(article: Element, index = 0): [Text, number] {
  const formula = article.querySelectorAll(".katex")[index];
  if (!formula) throw new Error(`no .katex at index ${index}`);
  const glyphs = textNodes(formula.querySelector(".katex-html") ?? formula);
  const node = glyphs.find((candidate) => candidate.data.trim().length > 0);
  if (!node) throw new Error("formula rendered no glyph text");
  return [node, Math.max(1, Math.floor(node.data.length / 2))];
}

/** A boundary in the middle of a rendered inline element's text. */
function insideElement(
  article: Element,
  selector: string,
  index = 0,
): [Text, number] {
  const element = article.querySelectorAll(selector)[index];
  if (!element) throw new Error(`no ${selector} at index ${index}`);
  const node = textNodes(element).find(
    (candidate) => candidate.data.trim().length > 0,
  );
  if (!node) throw new Error(`${selector} rendered no text`);
  return [node, Math.max(1, Math.floor(node.data.length / 2))];
}

/** What the viewer does on mouseup, reduced to its one decision. */
function resolve(
  markdown: string,
  range: Range,
  rendered: string,
): { quote: string; start: number; end: number } | null {
  const segments = readRangeSegments(range);
  const construct = segmentsHaveConstruct(segments);
  const address = buildSpanAddress({
    contentSet: "",
    markdown,
    quote: construct ? segmentsToSource(segments) : rendered.trim(),
    segments: construct ? segments : undefined,
  });
  return address
    ? { quote: address.quote, start: address.start, end: address.end }
    : null;
}

/** The whole of a block element, the way a triple-click selects it. */
function wholeBlock(doc: Document, article: Element, selector: string): Range {
  const block = article.querySelector(selector);
  if (!block) throw new Error(`no ${selector} in the article`);
  const range = doc.createRange();
  range.selectNodeContents(block);
  return range;
}

// ── the walk ────────────────────────────────────────────────────────────────

describe("a range is read back as the source it was rendered from", () => {
  const markdown =
    "固定租户 $t = (\\mathit{user\\_id}, \\mathit{agent\\_id})$ 与 schema 坐标 $(\\sigma, v)$ 后，一个图状态是 $G = (N, E)$。";

  it("rebuilds a whole sentence, TeX and all, from a prose-to-prose drag", () => {
    const { doc, article } = mount(markdown);
    const range = rangeBetween(
      doc,
      point(article, "固定租户"),
      point(article, "。", 1),
    );
    const segments = readRangeSegments(range);
    expect(segmentsHaveConstruct(segments)).toBe(true);
    // Three formulas, four prose runs — and the formulas carry TeX, never
    // the glyphs KaTeX drew.
    expect(segments.filter((segment) => segment.kind === "math")).toHaveLength(3);
    expect(segmentsToSource(segments)).toBe(markdown);
    // The rendered text is emphatically not the source; that is the bug.
    expect(range.toString()).not.toBe(markdown);
  });

  it("resolves to the byte range the file actually holds", () => {
    const { doc, article } = mount(markdown);
    const range = rangeBetween(
      doc,
      point(article, "固定租户"),
      point(article, "。", 1),
    );
    const hit = resolve(markdown, range, range.toString())!;
    expect(hit.start).toBe(0);
    expect(markdown.slice(hit.start, hit.end)).toBe(hit.quote);
    expect(hit.quote).toBe(markdown);
    expect(hit.quote).toContain("\\mathit{user\\_id}");
  });

  it("addresses a mid-sentence span, not the whole paragraph", () => {
    const { doc, article } = mount(markdown);
    const range = rangeBetween(
      doc,
      point(article, "与 schema 坐标", 2),
      point(article, "后，一个图状态是", 1),
    );
    const hit = resolve(markdown, range, range.toString())!;
    expect(hit.quote).toBe("schema 坐标 $(\\sigma, v)$ 后");
    expect(markdown.slice(hit.start, hit.end)).toBe(hit.quote);
  });
});

describe("a formula is included whole or not at all", () => {
  const markdown = "载荷映射 $\\alpha : \\mathrm{Intent} \\rightharpoonup_{\\mathrm{fin}} \\mathbb{J}$ 决定一切。";

  it("snaps outward when the drag stops inside the glyphs", () => {
    const { doc, article } = mount(markdown);
    const range = rangeBetween(
      doc,
      point(article, "载荷映射"),
      insideFormula(article),
    );
    const segments = readRangeSegments(range);
    // Truncating the TeX at the drag point would fabricate a string that is
    // in no file anywhere; the formula comes along whole.
    expect(segments).toEqual([
      // The space before the formula belongs to the prose run: only the outer
      // edges of a selection are trimmed, so the interior stays verbatim.
      { kind: "text", text: "载荷映射 " },
      {
        kind: "math",
        tex: "\\alpha : \\mathrm{Intent} \\rightharpoonup_{\\mathrm{fin}} \\mathbb{J}",
        display: false,
      },
    ]);
    const hit = resolve(markdown, range, range.toString())!;
    expect(hit.quote).toBe(
      "载荷映射 $\\alpha : \\mathrm{Intent} \\rightharpoonup_{\\mathrm{fin}} \\mathbb{J}$",
    );
    expect(markdown.slice(hit.start, hit.end)).toBe(hit.quote);
  });

  it("snaps outward when the drag starts inside the glyphs", () => {
    const { doc, article } = mount(markdown);
    const range = rangeBetween(
      doc,
      insideFormula(article),
      point(article, "决定一切。", 5),
    );
    const hit = resolve(markdown, range, range.toString())!;
    expect(hit.quote).toBe(
      "$\\alpha : \\mathrm{Intent} \\rightharpoonup_{\\mathrm{fin}} \\mathbb{J}$ 决定一切。",
    );
    expect(markdown.slice(hit.start, hit.end)).toBe(hit.quote);
  });

  it("a drag that never left one formula addresses that formula", () => {
    const { doc, article } = mount(markdown);
    const formula = article.querySelector(".katex")!;
    const glyphs = textNodes(formula.querySelector(".katex-html")!).filter(
      (node) => node.data.trim().length > 0,
    );
    const range = rangeBetween(
      doc,
      [glyphs[0]!, 0],
      [glyphs[glyphs.length - 1]!, 1],
    );
    const hit = resolve(markdown, range, range.toString())!;
    expect(hit.quote).toBe(
      "$\\alpha : \\mathrm{Intent} \\rightharpoonup_{\\mathrm{fin}} \\mathbb{J}$",
    );
    expect(markdown.slice(hit.start, hit.end)).toBe(hit.quote);
  });
});

describe("display math", () => {
  const markdown =
    "定义如下：\n\n$$\n\\mathbb{J} = \\mu X.\\ \\{\\mathsf{null}\\} \\cup \\mathbb{B}\n$$\n\n后面接着说。";

  it("carries $$ delimiters and reaches across the blank line", () => {
    const { doc, article } = mount(markdown);
    const range = rangeBetween(
      doc,
      point(article, "定义如下："),
      insideFormula(article),
    );
    const segments = readRangeSegments(range);
    expect(segments).toEqual([
      { kind: "text", text: "定义如下：" },
      // mdast-util-to-hast puts a newline text node between block children,
      // so the DOM really does carry one separator here — one, where the
      // file has a blank line. The seam is why interior text runs are never
      // merged: `locateSegments` glues each one with optional whitespace.
      { kind: "text", text: "\n" },
      {
        kind: "math",
        tex: "\\mathbb{J} = \\mu X.\\ \\{\\mathsf{null}\\} \\cup \\mathbb{B}",
        display: true,
      },
    ]);
    // The exact rebuild cannot match — the file has newlines inside `$$`
    // that never reach the DOM — so this case is carried entirely by the
    // tolerant lookup, and the quote still comes out of the file verbatim.
    expect(segmentsToSource(segments)).not.toBe(
      markdown.slice(0, markdown.indexOf("\n\n后面")),
    );
    const hit = resolve(markdown, range, range.toString())!;
    expect(hit.quote).toBe(
      "定义如下：\n\n$$\n\\mathbb{J} = \\mu X.\\ \\{\\mathsf{null}\\} \\cup \\mathbb{B}\n$$",
    );
    expect(markdown.slice(hit.start, hit.end)).toBe(hit.quote);
  });
});

describe("what remark-math normalises away, the lookup forgives", () => {
  it("a formula padded with spaces — the file keeps them, the annotation does not", () => {
    // `$ \mathbb{J} $` reaches KaTeX as `\mathbb{J}`: micromark strips one
    // space from each end, exactly as it does for a code span.
    const markdown = "「知识结构」，指带 $ \\mathbb{J} $ 值属性的有限结构。";
    const { doc, article } = mount(markdown);
    const segments = readRangeSegments(
      rangeBetween(doc, point(article, "「知识结构」"), point(article, "。", 1)),
    );
    expect(segmentsToSource(segments)).toBe(
      "「知识结构」，指带 $\\mathbb{J}$ 值属性的有限结构。",
    );
    expect(segmentsToSource(segments)).not.toBe(markdown);
    const range = rangeBetween(
      doc,
      point(article, "「知识结构」"),
      point(article, "。", 1),
    );
    const hit = resolve(markdown, range, range.toString())!;
    // The address quotes the file, spaces and all.
    expect(hit.quote).toBe(markdown);
    expect(markdown.slice(hit.start, hit.end)).toBe(hit.quote);
  });

  it("two dollar signs written inline still resolve", () => {
    const markdown = "内联双美元 $$a+b$$ 在句中。";
    const { doc, article } = mount(markdown);
    const range = rangeBetween(
      doc,
      point(article, "内联双美元"),
      point(article, "在句中。", 4),
    );
    const segments = readRangeSegments(range);
    // remark-math calls it inline math, so the rebuild says one dollar…
    expect(segmentsToSource(segments)).toBe("内联双美元 $a+b$ 在句中。");
    // …and the lookup still lands on the two the author typed.
    const hit = resolve(markdown, range, range.toString())!;
    expect(hit.quote).toBe(markdown);
  });

  it("a soft line break in the file is a space on the page", () => {
    const markdown = "固定租户 $t = 1$ 之后，\n一个图状态是 $G$。";
    const { doc, article } = mount(markdown);
    const range = rangeBetween(
      doc,
      point(article, "固定租户"),
      point(article, "。", 1),
    );
    const hit = resolve(markdown, range, range.toString())!;
    expect(hit.quote).toBe(markdown);
    expect(markdown.slice(hit.start, hit.end)).toBe(hit.quote);
  });

  it("the money-range cost of single-dollar math is still addressable", () => {
    // `singleDollarTextMath` reads `从 $100 涨到 $200` as one formula — a
    // known, pinned cost of this mode's plugin choice. It must not also
    // make the sentence unselectable.
    const markdown = "从 $100 涨到 $200，翻了一倍。";
    const { doc, article } = mount(markdown);
    const range = rangeBetween(
      doc,
      point(article, "从 "),
      point(article, "，翻了一倍。", 6),
    );
    const hit = resolve(markdown, range, range.toString())!;
    expect(hit.quote).toBe(markdown);
  });

  it("TeX KaTeX could not parse is read off the error span it fell back to", () => {
    const markdown = "这里写错了 $\\frac{1}{$ 但页面还在。";
    const { doc, article } = mount(markdown);
    expect(article.querySelector(".katex-error")).not.toBeNull();
    const range = rangeBetween(
      doc,
      point(article, "这里写错了"),
      point(article, "但页面还在。", 6),
    );
    const segments = readRangeSegments(range);
    expect(segments.some((segment) => segment.kind === "math")).toBe(true);
    const hit = resolve(markdown, range, range.toString())!;
    expect(hit.quote).toBe(markdown);
  });
});

// ── the inline markup markdown renders away ─────────────────────────────────

describe("inline elements are read back as the markup the file holds", () => {
  it("a code span comes back inside its backticks", () => {
    const markdown = "实现锚点在 `omne_engram_contracts/recipe_json.py`，深度上限 64。";
    const { doc, article } = mount(markdown);
    const range = wholeBlock(doc, article, "p");
    const segments = readRangeSegments(range);
    expect(segments).toEqual([
      { kind: "text", text: "实现锚点在 " },
      { kind: "code", text: "omne_engram_contracts/recipe_json.py" },
      { kind: "text", text: "，深度上限 64。" },
    ]);
    // The page never showed the backticks; the rebuild puts them back, and
    // in this case it *is* the file, character for character.
    expect(range.toString()).not.toContain("`");
    expect(segmentsToSource(segments)).toBe(markdown);
    const hit = resolve(markdown, range, range.toString())!;
    expect(hit.quote).toBe(markdown);
    expect(markdown.slice(hit.start, hit.end)).toBe(hit.quote);
  });

  it("a code span the author wrote with two backticks is still found", () => {
    const markdown = "用 ``ls -l`` 列目录。";
    const { doc, article } = mount(markdown);
    const range = wholeBlock(doc, article, "p");
    const segments = readRangeSegments(range);
    // The DOM cannot say how many backticks the author used, so the rebuild
    // guesses one and the lookup forgives the difference.
    expect(segmentsToSource(segments)).toBe("用 `ls -l` 列目录。");
    expect(segmentsToSource(segments)).not.toBe(markdown);
    const hit = resolve(markdown, range, range.toString())!;
    expect(hit.quote).toBe(markdown);
    expect(markdown.slice(hit.start, hit.end)).toBe(hit.quote);
  });

  it("bold and italic come back with markers", () => {
    const markdown = "这句里有 **加重** 和 *轻挑*。";
    const { doc, article } = mount(markdown);
    const range = wholeBlock(doc, article, "p");
    const segments = readRangeSegments(range);
    expect(segments).toEqual([
      { kind: "text", text: "这句里有 " },
      { kind: "strong", children: [{ kind: "text", text: "加重" }] },
      { kind: "text", text: " 和 " },
      { kind: "em", children: [{ kind: "text", text: "轻挑" }] },
      { kind: "text", text: "。" },
    ]);
    expect(segmentsToSource(segments)).toBe(markdown);
    const hit = resolve(markdown, range, range.toString())!;
    expect(hit.quote).toBe(markdown);
  });

  it("finds the same sentence written with the underscore markers", () => {
    const markdown = "这句里有 __加重__ 和 _轻挑_。";
    const { doc, article } = mount(markdown);
    const range = wholeBlock(doc, article, "p");
    const segments = readRangeSegments(range);
    // `<strong>` says nothing about which pair of markers made it, so the
    // rebuild picks the asterisks and the lookup accepts either pair.
    expect(segmentsToSource(segments)).toBe("这句里有 **加重** 和 *轻挑*。");
    const hit = resolve(markdown, range, range.toString())!;
    expect(hit.quote).toBe(markdown);
    expect(markdown.slice(hit.start, hit.end)).toBe(hit.quote);
  });

  it("a link comes back whole, target and all", () => {
    const markdown = "见 [文档](https://example.com/docs) 里说。";
    const { doc, article } = mount(markdown);
    const range = wholeBlock(doc, article, "p");
    const segments = readRangeSegments(range);
    expect(segments).toEqual([
      { kind: "text", text: "见 " },
      {
        kind: "link",
        children: [{ kind: "text", text: "文档" }],
        href: "https://example.com/docs",
        title: "",
      },
      { kind: "text", text: " 里说。" },
    ]);
    expect(segmentsToSource(segments)).toBe(markdown);
    const hit = resolve(markdown, range, range.toString())!;
    expect(hit.quote).toBe(markdown);
    expect(markdown.slice(hit.start, hit.end)).toBe(hit.quote);
  });

  it("a titled link is found even when the DOM cannot say how it was written", () => {
    // `'标题'` and `"标题"` reach the DOM as the same attribute, so the
    // rebuild cannot be the file here — the tolerant match has to carry it,
    // and it must swallow the whole `(...)` or the quote is malformed.
    const markdown = "见 [文档](https://example.com/docs '标题') 里说。";
    const { doc, article } = mount(markdown);
    const range = wholeBlock(doc, article, "p");
    const segments = readRangeSegments(range);
    expect(segmentsToSource(segments)).toBe(
      '见 [文档](https://example.com/docs "标题") 里说。',
    );
    const hit = resolve(markdown, range, range.toString())!;
    expect(hit.quote).toBe(markdown);
    expect(markdown.slice(hit.start, hit.end)).toBe(hit.quote);
  });

  it("a link whose target has parentheses is not cut in half", () => {
    const markdown = "见 [维基](https://example.com/X_(dis)) 里说。";
    const { doc, article } = mount(markdown);
    const range = wholeBlock(doc, article, "p");
    const hit = resolve(markdown, range, range.toString())!;
    expect(hit.quote).toBe(markdown);
    expect(markdown.slice(hit.start, hit.end)).toBe(hit.quote);
  });

  it("a reference link keeps its second pair of brackets", () => {
    const markdown = "见 [文档][ref] 里说。\n\n[ref]: https://example.com/docs";
    const { doc, article } = mount(markdown);
    const range = wholeBlock(doc, article, "p");
    const hit = resolve(markdown, range, range.toString())!;
    expect(hit.quote).toBe("见 [文档][ref] 里说。");
    expect(markdown.slice(hit.start, hit.end)).toBe(hit.quote);
  });

  it("an autolink keeps its angle brackets", () => {
    const markdown = "见 <https://example.com/docs> 里说。";
    const { doc, article } = mount(markdown);
    const range = wholeBlock(doc, article, "p");
    const hit = resolve(markdown, range, range.toString())!;
    expect(hit.quote).toBe(markdown);
    expect(markdown.slice(hit.start, hit.end)).toBe(hit.quote);
  });

  it("a bare URL GFM linkified addresses the URL the author typed", () => {
    // Nothing wraps this one in the file, so the lookup has to accept a
    // link that is only its own text — the reason the search runs a second,
    // permissive pass at all.
    const markdown = "见 https://example.com/docs 里说。";
    const { doc, article } = mount(markdown);
    const range = wholeBlock(doc, article, "p");
    const hit = resolve(markdown, range, range.toString())!;
    expect(hit.quote).toBe(markdown);
    expect(markdown.slice(hit.start, hit.end)).toBe(hit.quote);
  });

  it("nesting composes — bold around code, a link around code", () => {
    const markdown = "强调里带 **`code`** 的写法，链接里带 [`code`](https://example.com) 的写法。";
    const { doc, article } = mount(markdown);
    const range = wholeBlock(doc, article, "p");
    const segments = readRangeSegments(range);
    expect(segments[1]).toEqual({
      kind: "strong",
      children: [{ kind: "code", text: "code" }],
    });
    expect(segments[3]).toEqual({
      kind: "link",
      children: [{ kind: "code", text: "code" }],
      href: "https://example.com",
      title: "",
    });
    expect(segmentsToSource(segments)).toBe(markdown);
    const hit = resolve(markdown, range, range.toString())!;
    expect(hit.quote).toBe(markdown);
    expect(markdown.slice(hit.start, hit.end)).toBe(hit.quote);
  });

  it("a fenced block's code is prose, not a construct", () => {
    // Its rendered text *is* what the file holds, so the old literal path is
    // right there — and treating it as an inline code span would wrap the
    // whole block in backticks that are not in the file.
    const markdown = "说明：\n\n```py\nx = 1\n```\n\n结束。";
    const { doc, article } = mount(markdown);
    const range = wholeBlock(doc, article, "pre code");
    const segments = readRangeSegments(range);
    expect(segmentsHaveConstruct(segments)).toBe(false);
    expect(segmentsToSource(segments)).toBe("x = 1");
    const hit = resolve(markdown, range, range.toString())!;
    expect(hit.quote).toBe("x = 1");
    expect(markdown.slice(hit.start, hit.end)).toBe(hit.quote);
  });
});

describe("an inline element is included whole or not at all", () => {
  const markdown = "实现锚点在 `recipe_json.py`，由迭代式遍历强制执行。";

  it("snaps outward when the drag stops inside a code span", () => {
    const { doc, article } = mount(markdown);
    const range = rangeBetween(
      doc,
      point(article, "实现锚点在"),
      insideElement(article, "code"),
    );
    const segments = readRangeSegments(range);
    expect(segments).toEqual([
      { kind: "text", text: "实现锚点在 " },
      { kind: "code", text: "recipe_json.py" },
    ]);
    const hit = resolve(markdown, range, range.toString())!;
    expect(hit.quote).toBe("实现锚点在 `recipe_json.py`");
    expect(markdown.slice(hit.start, hit.end)).toBe(hit.quote);
  });

  it("snaps outward when the drag starts inside a code span", () => {
    const { doc, article } = mount(markdown);
    const range = rangeBetween(
      doc,
      insideElement(article, "code"),
      point(article, "，由迭代式遍历强制执行。", 12),
    );
    const hit = resolve(markdown, range, range.toString())!;
    expect(hit.quote).toBe("`recipe_json.py`，由迭代式遍历强制执行。");
    expect(markdown.slice(hit.start, hit.end)).toBe(hit.quote);
  });

  it("a drag that never left one code span addresses that code span", () => {
    const { doc, article } = mount(markdown);
    const code = article.querySelector("code")!;
    const inner = textNodes(code)[0]!;
    const range = rangeBetween(doc, [inner, 2], [inner, 5]);
    const segments = readRangeSegments(range);
    expect(segments).toEqual([{ kind: "code", text: "recipe_json.py" }]);
    const hit = resolve(markdown, range, range.toString())!;
    expect(hit.quote).toBe("`recipe_json.py`");
    expect(markdown.slice(hit.start, hit.end)).toBe(hit.quote);
  });

  it("a drag inside bold takes the whole bold run", () => {
    const bold = "这一句里 **说得很重的一段** 收尾。";
    const { doc, article } = mount(bold);
    const range = rangeBetween(
      doc,
      insideElement(article, "strong"),
      insideElement(article, "strong"),
    );
    range.setEnd(range.endContainer, range.endOffset + 2);
    const hit = resolve(bold, range, range.toString())!;
    expect(hit.quote).toBe("**说得很重的一段**");
    expect(bold.slice(hit.start, hit.end)).toBe(hit.quote);
  });
});

describe("the paragraph shape the demo draft is actually made of", () => {
  it("resolves a sentence carrying both a formula and a code span", () => {
    const markdown =
      "容器深度也不是任意的，recipe JSON 面被限定在 $\\le 64$。实现锚点在 `omne_engram_contracts/recipe_json.py`，`MAX_RECIPE_JSON_CONTAINER_DEPTH = 64` 由迭代式遍历强制执行。";
    const { doc, article } = mount(markdown);
    const range = wholeBlock(doc, article, "p");
    const segments = readRangeSegments(range);
    expect(segments.filter((segment) => segment.kind === "math")).toHaveLength(1);
    expect(segments.filter((segment) => segment.kind === "code")).toHaveLength(2);
    const hit = resolve(markdown, range, range.toString())!;
    expect(hit.quote).toBe(markdown);
    expect(markdown.slice(hit.start, hit.end)).toBe(hit.quote);
  });
});

describe("prose with no math takes the old path, byte for byte", () => {
  const markdown = "这份报告的性质要先说清楚：它是一次性分析报告，不是 ADR。";

  it("reports no math, so the caller never leaves Selection.toString()", () => {
    const { doc, article } = mount(markdown);
    const range = rangeBetween(
      doc,
      point(article, "这份报告"),
      point(article, "不是 ADR。", 7),
    );
    const segments = readRangeSegments(range);
    expect(segmentsHaveConstruct(segments)).toBe(false);
    expect(segments).toEqual([{ kind: "text", text: markdown }]);
  });

  it("resolves exactly as it did before math existed", () => {
    const { doc, article } = mount(markdown);
    const range = rangeBetween(
      doc,
      point(article, "它是一次性分析报告"),
      point(article, "不是 ADR。", 7),
    );
    const rendered = range.toString();
    const before = buildSpanAddress({
      contentSet: "essay",
      markdown,
      quote: rendered.trim(),
    });
    const after = resolve(markdown, range, rendered);
    expect(after).not.toBeNull();
    expect(after!.quote).toBe(before!.quote);
    expect(after!.start).toBe(before!.start);
    expect(after!.end).toBe(before!.end);
  });
});

describe("a formula whose source cannot be read contributes nothing", () => {
  it("fails to an address of null rather than inventing TeX", () => {
    // A `.katex` with its MathML copy stripped — what a future KaTeX option
    // or a sanitising rehype step could produce. Guessing from the glyphs
    // would hand the agent a byte range over text nobody wrote.
    const { doc, article } = mountHtml(
      '<p>前面 <span class="katex"><span class="katex-html">x2</span></span> 后面。</p>',
    );
    const markdown = "前面 $x^2$ 后面。";
    const range = rangeBetween(
      doc,
      point(article, "前面"),
      point(article, " 后面。", 4),
    );
    const segments = readRangeSegments(range);
    expect(segmentsHaveConstruct(segments)).toBe(false);
    // The formula left a hole, not a guess: the two prose runs meet with
    // only the spaces that were around it.
    expect(segmentsToSource(segments)).toBe("前面  后面。");
    expect(
      buildSpanAddress({
        contentSet: "",
        markdown,
        quote: segmentsToSource(segments),
        segments,
      }),
    ).toBeNull();
  });
});

describe("locateSegments needs no DOM at all", () => {
  const segments: SourceSegment[] = [
    { kind: "text", text: "深度" },
    { kind: "math", tex: "\\le 64", display: false },
    { kind: "text", text: "。" },
  ];

  it("finds the span and reports a real byte range", () => {
    const markdown = "一句无关的话。深度 $\\le 64$。再一句。";
    const hit = locateSegments(markdown, segments)!;
    expect(markdown.slice(hit.start, hit.end)).toBe("深度 $\\le 64$。");
  });

  it("returns null when the prose around the math is not there", () => {
    expect(locateSegments("完全不同的一段文字。", segments)).toBeNull();
  });

  it("returns null for an empty segment list", () => {
    expect(locateSegments("任何文字", [])).toBeNull();
  });

  it("prefers the occurrence at or after the hint", () => {
    const markdown = "深度 $\\le 64$。中间。深度 $\\le 64$。";
    const second = markdown.lastIndexOf("深度");
    const hit = locateSegments(markdown, segments, second)!;
    expect(hit.start).toBe(second);
  });

  it("falls back to the first occurrence when the hint overshoots", () => {
    const markdown = "深度 $\\le 64$。";
    const hit = locateSegments(markdown, segments, 999)!;
    expect(hit.start).toBe(0);
  });

  it("keeps emphasis markers paired", () => {
    // `*轻挑_` is not emphasis in any markdown, and a lookup that accepted it
    // would hand back a byte range over a string the renderer never made.
    const em: SourceSegment[] = [
      { kind: "em", children: [{ kind: "text", text: "轻挑" }] },
    ];
    expect(locateSegments("这里 *轻挑_ 结束", em)).toBeNull();
    expect(locateSegments("这里 _轻挑_ 结束", em)!.start).toBe(3);
  });

  it("prefers a delimited link to an earlier word that reads the same", () => {
    // Both the bare word and the link's text are `docs`; the link is the one
    // the reader pointed at, and only the delimited forms are searched first.
    const link: SourceSegment[] = [
      {
        kind: "link",
        children: [{ kind: "text", text: "docs" }],
        href: "https://example.com",
        title: "",
      },
    ];
    const markdown = "早先提到 docs 这个词。后面 [docs](https://example.com/x) 才是链接。";
    const hit = locateSegments(markdown, link)!;
    expect(markdown.slice(hit.start, hit.end)).toBe(
      "[docs](https://example.com/x)",
    );
  });

  it("refuses a word that merely reads like a link the file does not hold", () => {
    // Nothing in this markdown is a link, so the honest answer is no
    // address — not the bare word, which would send the agent to edit a
    // sentence the reader never pointed at. A link whose target is not its
    // own text was written with brackets, or it is not in this file.
    const link: SourceSegment[] = [
      {
        kind: "link",
        children: [{ kind: "text", text: "docs" }],
        href: "https://example.com",
        title: "",
      },
    ];
    expect(locateSegments("早先提到 docs 这个词。", link)).toBeNull();
  });

  it("still finds a link the author typed bare", () => {
    // GFM linkifies a naked URL, and there the DOM's href *is* the text, so
    // the bare form is the only form — this is what the permissive pass is
    // for, and the only kind of link it is opened for.
    const bare: SourceSegment[] = [
      {
        kind: "link",
        children: [{ kind: "text", text: "https://example.com/docs" }],
        href: "https://example.com/docs",
        title: "",
      },
    ];
    const markdown = "见 https://example.com/docs 里说。";
    const hit = locateSegments(markdown, bare)!;
    expect(markdown.slice(hit.start, hit.end)).toBe("https://example.com/docs");
  });
});

describe("the draft surface is wired to it", () => {
  const viewer = Bun.file(
    new URL("../viewer/WordtastePreview.tsx", import.meta.url),
  );

  it("reads the range instead of the Selection when a construct is in the way", async () => {
    const source = await viewer.text();
    expect(source).toContain("readRangeSegments(range)");
    expect(source).toContain("segmentsHaveConstruct(segments)");
    expect(source).toContain("segmentsToSource(segments)");
    // The prose path is still literally the old one.
    expect(source).toContain("selection.toString().trim()");
    // …and the segments reach the lookup, which is what makes the tolerant
    // match possible at all.
    expect(source).toMatch(
      /segments:\s*hasConstruct\s*\?\s*segments\s*:\s*undefined/,
    );
  });
});

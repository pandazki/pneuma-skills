/** @jsxImportSource react */
/**
 * Math on the reading surface.
 *
 * WordTaste is a prose mode, and prose is where the dollar signs live: a
 * technical essay writes `$\mathbb{J}$` in the middle of a Chinese sentence
 * and expects to read a blackboard-bold J, not four characters of TeX
 * source. Every markdown surface in the viewer therefore runs the same two
 * plugins — `remark-math` to find the math, `rehype-katex` to typeset it —
 * and this file pins that they are ONE definition shared by all of them,
 * because a draft that renders and a rail that does not is worse than
 * neither.
 *
 * Rendering here goes through `react-dom/server`: react-markdown resolves
 * its plugin pipeline synchronously during render, so static markup is the
 * full pipeline output with no DOM host needed (same reason as
 * `modes/clipcraft/viewer/setup/__tests__/SetupTab.test.tsx`).
 *
 * The viewer component itself is read as text rather than imported — it
 * pulls in `katex/dist/katex.min.css`, which only a bundler can resolve.
 * That is also why the plugin list lives in its own React-free module.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ReactMarkdown from "react-markdown";
import { renderToStaticMarkup } from "react-dom/server";
import {
  WORDTASTE_REHYPE_PLUGINS,
  WORDTASTE_REMARK_PLUGINS,
} from "../viewer/markdown-plugins.js";

const viewer = readFileSync(
  join(import.meta.dir, "..", "viewer", "WordtastePreview.tsx"),
  "utf8",
);

/** Exactly what the viewer mounts, for any markdown surface. */
const render = (markdown: string): string =>
  renderToStaticMarkup(
    <ReactMarkdown
      remarkPlugins={WORDTASTE_REMARK_PLUGINS}
      rehypePlugins={WORDTASTE_REHYPE_PLUGINS}
    >
      {markdown}
    </ReactMarkdown>,
  );

/**
 * What a reader's eye gets.
 *
 * KaTeX emits two copies of every formula: `.katex-mathml` (a MathML tree
 * carrying an `<annotation>` with the verbatim TeX, kept for assistive
 * technology and clipped out of sight) and `.katex-html` (the glyphs).
 * "The source must not be visible" is therefore an assertion about the
 * second copy only — the raw `\mathbb{J}` lives on forever inside the
 * first, by design, and asserting over the whole string would pin the
 * opposite of what is meant.
 */
const visible = (html: string): string =>
  html.replace(/<span class="katex-mathml">[\s\S]*?<\/math><\/span>/g, "");

/** The characters that end up on screen, markup removed. */
const visibleText = (html: string): string =>
  visible(html)
    .replace(/<[^>]+>/g, "")
    .trim();

describe("inline math inside Chinese prose", () => {
  test("a single-dollar span is typeset, not printed", () => {
    const html = render("「知识结构」，指带 $\\mathbb{J}$ 值属性的有限结构。");
    expect(html).toContain('class="katex"');
    // The source must be gone from the page: seeing `$\mathbb{J}$` is the bug.
    expect(visible(html)).not.toContain("$");
    expect(visible(html)).not.toContain("\\mathbb");
    // …while the assistive copy keeps it, which is what MathML is for.
    expect(html).toContain(
      '<annotation encoding="application/x-tex">\\mathbb{J}</annotation>',
    );
    // The prose around it is untouched, character for character.
    expect(html).toContain("「知识结构」，指带 ");
    expect(html).toContain(" 值属性的有限结构。");
  });

  test("the harpoon arrow reaches the page as a glyph", () => {
    const html = visible(
      render(
        "载荷映射 $\\alpha : \\mathrm{Intent} \\rightharpoonup_{\\mathrm{fin}} \\mathbb{J}$ 决定一切。",
      ),
    );
    // U+21C0 — proof that KaTeX actually typeset the command rather than
    // the pipeline merely wrapping the source in a span.
    expect(html).toContain("\u21c0");
    expect(html).not.toContain("\\rightharpoonup");
    // The subscript is set as a subscript, not printed as `_{...}`.
    expect(html).toContain("msupsub");
    expect(html).not.toContain("_{");
  });

  test("display math gets its own block", () => {
    const html = render(
      "定义如下：\n\n$$\n\\mathbb{J} = \\mu X.\\ \\{\\mathsf{null}\\} \\cup \\mathbb{B}\n$$\n",
    );
    expect(html).toContain("katex-display");
    expect(visible(html)).not.toContain("\\mathsf{null}");
    expect(visible(html)).toContain("\u222a"); // \cup
  });

  test("GFM survives alongside math — the two plugins coexist", () => {
    const html = render("| 记号 | 含义 |\n| --- | --- |\n| $\\mathbb{J}$ | JSON 值 |\n");
    expect(html).toContain("<table>");
    expect(html).toContain("katex");
  });
});

describe("prose that merely contains a dollar sign", () => {
  test("a lone money amount stays literal", () => {
    // Math needs a closing delimiter, so one dollar sign in a paragraph is
    // just a dollar sign — the layout does not move.
    expect(visibleText(render("花了 $100，值。"))).toBe("花了 $100，值。");
    expect(render("花了 $100，值。")).not.toContain("katex");
    expect(visibleText(render("月费 $9.99/月。"))).toBe("月费 $9.99/月。");
  });

  test("two amounts in one paragraph — the known cost, stated in the open", () => {
    // `singleDollarTextMath` cannot tell a price range from inline math, and
    // it is kept on because these drafts are full of `$x$`. The price range
    // is what that costs: the span between the two signs is typeset, and the
    // signs themselves disappear. Pinned so a plugin bump cannot move it
    // silently, and so the trade-off is discoverable from the tests.
    const html = render("从 $100 涨到 $200，翻了一倍。");
    expect(html).toContain('class="katex"');
    expect(visibleText(html)).toBe("从 100涨到200，翻了一倍。");
  });
});

describe("bad TeX degrades, it never crashes", () => {
  test("an undefined control sequence renders as plain prose-coloured text", () => {
    let html = "";
    expect(() => {
      html = render("这里写错了 $\\notarealmacro{x}$ 但页面还在。");
    }).not.toThrow();
    // rehype-katex re-renders a throwing formula with `throwOnError: false`,
    // and KaTeX paints the part it could not parse in `errorColor`.
    // `currentColor` makes that the prose colour — a broken formula reads as
    // what the author typed instead of a red alarm inside their paragraph.
    expect(html).toContain("color:currentColor");
    expect(html).not.toContain("#cc0000");
    expect(visible(html)).toContain("\\notarealmacro");
    expect(html).toContain("这里写错了 ");
    expect(html).toContain("但页面还在。");
  });

  test("an unterminated group does not take the surface down", () => {
    expect(() => render("$\\frac{1}{$")).not.toThrow();
    expect(() => render("$$\n\\begin{matrix}\n$$")).not.toThrow();
  });
});

describe("every markdown surface in the viewer is wired the same way", () => {
  const sites = viewer.match(/<ReactMarkdown\b/g) ?? [];

  test("the viewer still has markdown surfaces to wire", () => {
    expect(sites.length).toBeGreaterThanOrEqual(3);
  });

  test("each one takes the shared plugin lists — no per-site literal", () => {
    const remark = viewer.match(/remarkPlugins=\{WORDTASTE_REMARK_PLUGINS\}/g) ?? [];
    const rehype = viewer.match(/rehypePlugins=\{WORDTASTE_REHYPE_PLUGINS\}/g) ?? [];
    expect(remark).toHaveLength(sites.length);
    expect(rehype).toHaveLength(sites.length);
    expect(viewer).not.toContain("remarkPlugins={[");
    expect(viewer).not.toContain("rehypePlugins={[");
  });

  test("the stylesheet KaTeX's HTML output depends on is loaded", () => {
    expect(viewer).toContain('import "katex/dist/katex.min.css"');
  });
});

describe("what KaTeX's two-copy output costs the page, and the two rules that pay it", () => {
  test("the hidden MathML copy is kept out of the selection", () => {
    // Measured on a live draft: selecting one paragraph returned 675
    // characters where the eye saw ~340, because `.katex-mathml` is clipped
    // out of sight but still live text to `Selection`. With the rule the
    // same paragraph returns 440 — the glyphs, once.
    expect(viewer).toContain(
      ".wordtaste-v2 .katex-mathml { -webkit-user-select: none; user-select: none; }",
    );
  });

  test("a display formula scrolls itself instead of being cut off", () => {
    // Measured with an 1800px probe inside the 938px reading column: the
    // article's scrollWidth went to 1892 while the page did not grow, so
    // the right end of the formula was unreachable, not merely off-screen.
    expect(viewer).toContain(
      ".wordtaste-draft .katex-display { overflow-x: auto; overflow-y: hidden; padding-block: 2px; }",
    );
  });
});

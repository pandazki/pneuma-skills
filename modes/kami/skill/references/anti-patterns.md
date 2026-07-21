<!--
  Adapted from tw93/kami (MIT) — references/anti-patterns.md.
  Source: https://github.com/tw93/kami/blob/main/references/anti-patterns.md
  Credit retained per MIT License; see ../../NOTICE.md.
-->

# Anti-Patterns: AI Document Quality

Common failures when AI generates professional documents. Organized by failure type, each with a bad example and the fix. Use alongside `writing.md` quality bars.

## Content Emptiness

| # | Pattern | Bad | Fix |
|---|---------|-----|-----|
| 1 | Adjective pile-up, no numbers | "Achieved significant growth across key metrics" | State the number: "Revenue grew 34% YoY to $12M" |
| 2 | Opening-paragraph filler | "In today's rapidly evolving landscape..." | Delete the opener. Start with the first real claim. |
| 3 | Restating the heading as a sentence | Heading "Revenue Growth", body "Our revenue growth has been notable" | Body must add information the heading does not carry |
| 4 | Vague time references | "Recently launched", "in the near future" | Pin to a date or quarter: "Launched Q1 2026" |
| 5 | Synonyms masking repetition | Three paragraphs saying "we are growing" in different words | One claim, one proof, move on |

## Metric Fabrication

| # | Pattern | Bad | Fix |
|---|---------|-----|-----|
| 6 | Round numbers implying precision | "Exactly 10,000 users" when the source says "around 10K" | Match the source's precision: "approximately 10,000" |
| 7 | Fake decimal precision | "Market share: 23.7%" with no cited source | Either cite the source or round to "roughly 24%" |
| 8 | Metric-narrative disconnect | Chart shows flat revenue, text says "strong momentum" | Text must match what the chart shows |
| 9 | Invented comparison baselines | "3x faster than alternatives" with no benchmark | Name the alternative and the benchmark method, or remove |
| 10 | Mixing time periods | YoY growth next to QoQ growth as if comparable | Label every comparison window explicitly |

## Structure Mimicry

| # | Pattern | Bad | Fix |
|---|---------|-----|-----|
| 11 | Resume bullet without result | "Managed a cross-functional team" | Action + Scope + Result: "Led 8-person team to ship v2.0, reducing churn 15%" |
| 12 | Template slots filled with filler | Skills section listing "Communication, Teamwork, Problem-solving" | Name the specific skill and where it was applied, or cut the section |
| 13 | Equity report without variant perception | "Company is well-positioned for growth" | State what the market gets wrong and why your thesis differs |
| 14 | One-pager without a clear ask | Three sections of context, no "what we need from you" | The ask belongs above the fold, not implied |
| 15 | Slide title as label, not assertion | "Q3 Results" | Assertion-evidence: "Q3 revenue beat guidance by 12%" |

## Visual Excess

| # | Pattern | Bad | Fix |
|---|---------|-----|-----|
| 16 | More than 3 brand-color accents per page | Four different colored highlights on the same page | One accent color for emphasis; use weight or size for hierarchy |
| 17 | Chart with no insight title | Chart titled "Revenue by Quarter" | Title states the insight: "Revenue accelerated after Q2 price change" |
| 18 | Decorative chart that restates the text | Bar chart showing the same three numbers the paragraph just listed | If the text already communicates it, the chart must add a dimension (comparison, trend, distribution) |
| 19 | Icon or emoji as section marker | Sections led by decorative icons with no semantic value | Use typographic hierarchy (size, weight, spacing) instead |

## Source Gaps

| # | Pattern | Bad | Fix |
|---|---------|-----|-----|
| 20 | Unverified version numbers | "Compatible with v4.2" when latest is v5.1 | Check the official source before citing any version |
| 21 | "Latest" without a date | "Uses the latest framework" | "Uses Next.js 15 (as of 2026-04)" |
| 22 | Competitor comparison without market data | "Leading solution in the market" | Cite the ranking source, or use "one of the established solutions" |
| 23 | Assumed availability | "Available on all major platforms" | List the actual platforms verified |
| 24 | Source identity leaks into demo content | A demo or example distilled from a real resume or proposal keeps job-search phrases, client names, quote amounts, or engagement periods that identify the source | Swap in public figures, public projects, or invented generic data before the content lands anywhere shareable; list the swapped signals when handing back |

## Tone Contamination

| # | Pattern | Bad | Fix |
|---|---------|-----|-----|
| 25 | Chinese AI corporate speak | "赋能企业数字化转型", "打造一站式解决方案" | Say what it does: "帮公司把纸质流程搬到线上" |
| 26 | English AI corporate speak | "Leverage our platform to unlock synergies" | "Use the platform to share data between teams" |
| 27 | Caption restates the flow diagram | "六类来源 → 六道过滤 → 配比设计 → 训练分片，四步串联" | Cap 给出图意以外的判断："来源决定知识边界，过滤决定干净程度，配比决定能力侧重" |
| 28 | AI tone cliches (CN dashes and connectors) | "本质上是模型在做预测——这意味着..." / 大量破折号 | 删元评论框架，直接说结论。破折号换冒号或句号。自检: `grep -nE '本质是\|这意味着\|值得注意的是\|不仅.*而且\|[——–]'` |
| 29 | Sans font stack missing CJK fallback | `font-family: Inter` 用在含中文的 th / h3 | CJK 回退到系统 sans (PingFang) 跟 serif 主调冲突。任何可能渲染 CJK 的元素用 `var(--serif)` |
| 30 | Caption restates the slide title | Title "Q3 beat guidance", caption "Q3 results beat guidance" | Caption adds judgment, a trade-off, or a next step — never re-word the title |

## Image Generation

Applies whenever you generate or place an image (see SKILL.md "Image generation"). The page is printed paper, not a SaaS hero — decide the slot before the pixels.

| # | Pattern | Bad | Fix |
|---|---------|-----|-----|
| 31 | Image generated before the slot is decided | Generate a 1:1 portrait, then find the page needs a 4:3 figure | Decide the slot and aspect ratio first, then crop, pad, or generate to that ratio |
| 32 | Real screenshot redrawn as fake UI | Re-illustrating a product screenshot as an "AI mockup" | Preserve the real screenshot; pad or split-panel it to fit, never redraw it |
| 33 | Mixed image ratios in one group | A portfolio row pairing a 16:9, a 1:1, and a 3:2 | Normalize the frame and padding so the group shares one ratio; keep the image content intact |
| 34 | Missing product image filled with atmosphere | A generic stock cityscape standing in for an absent product shot | Mark the gap in the material status block or omit the panel — never substitute unrelated imagery, never render a broken image |

## Slides

Applies to the slides genre (decks render as HTML paper pages here, not PPTX). A deck is an argument, not a topic list.

| # | Pattern | Bad | Fix |
|---|---------|-----|-----|
| 35 | Ghost deck — layout before argument | Twelve slides titled "Overview", "Details", "Summary" | Rewrite titles and order to form an argument first; only then touch layout |
| 36 | Multiple evidence shapes on one slide | A chart, a table, and three bullets competing on one slide | Pick the primary proof; split the rest into adjacent slides or an appendix |
| 37 | Visual brief leaks into audience copy | The image prompt printed as the slide caption | Keep image prompts in the slot map; the caption states the insight |

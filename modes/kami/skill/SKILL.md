---
name: pneuma-kami
description: Paper-canvas web design. Edit HTML/CSS/JS; viewer renders your content as a single paper sheet at the size locked at workspace creation. Design language adapted from tw93/kami (MIT). Triggers when the user mentions 纸张排版, 一页纸, 简历, 作品集, 白皮书, 正式信件, "make a resume", "portfolio", "one-pager", "white paper", "letter", "typeset this".
---

# Pneuma Kami Mode

> **Credit.** This mode's design language, tokens, seed templates, and
> reference documents are adapted from [tw93/kami](https://github.com/tw93/kami)
> under the MIT License. See `../NOTICE.md` for full attribution.

## What this mode is

Paper-canvas web design. The viewer renders your content as a single
paper sheet. Size is **{{paperSize}} {{orientation}}**
({{pageWidthMm}} × {{pageHeightMm}} mm), locked at workspace creation
in `.pneuma/config.json`. **Do not change paper size** — if the user
wants a different size, they must create a new workspace.

You edit HTML / CSS / JS files inside each content set directly with the
Edit and Write tools. The iframe preview reflects changes live.

## Working with the viewer

The kami viewer renders the active HTML file as a single paper sheet at
the locked paper size, inside an iframe with a paper-style chrome (page
tabs along the bottom for multi-page documents, viewport presets,
view / edit / select / annotate mode toggles, an Export menu). Everything
below is how you (the agent) coordinate with that surface.

### Reading what the user sees

Each user message may arrive wrapped in two channels — read them before
acting:

- `<viewer-context>` — the live preview state at send time. For kami
  this includes `mode="kami"`, the active HTML `file="..."` (full
  workspace path, e.g. `kaku-portfolio/page-3.html`), and a page label
  like `Viewing page 3/6: "Projects"` derived from the content set's
  `manifest.json`. When the user clicks an element in the page, you also
  get `Selected: <selector>`, `Element: <accessible name>`, `Tag: <h2>`,
  `Classes: ...`, `Context: <nearby text>`, and `Accessibility: ...`. In
  **Annotate** mode the block lists multiple annotated elements with the
  user's per-element `Feedback:` comment. Resolve deictic phrases like
  "this heading", "tighten this section", "the figure here" against
  these fields first.

  Example:

  ```
  <viewer-context mode="kami" file="kaku-portfolio/page-3.html" content-set="kaku-portfolio">
  Viewing page 3/6: "Projects"
  Selected: h2.section-title
    Element: Projects
    Tag: <h2>
    Classes: section-title
    Context: Projects 2024 — selected work
  </viewer-context>
  ```

- `<user-actions>` — discrete UI actions the user took since their last
  turn. Kami emits one kind: `edit-text` — inline text edits made
  directly inside the iframe in **Edit** mode (the user double-clicked a
  text node and rewrote it). The action's `description` includes the
  before → after diff per element, so treat it as a record of changes
  the user already committed; don't re-apply them.

  ```
  <user-actions>
    <action time="12s ago" id="edit-text">Edited text on "kaku-portfolio/page-3.html":
      <h2>: "项目" → "Projects"
      <p>: "2024 年精选" → "Selected work, 2024"</action>
  </user-actions>
  ```

  After an `edit-text` action, **re-read `.pneuma/kami-fit.json`** —
  text rewrites can flip a page's status from `fits` to `overflow`.

If neither block is present, the user has nothing specifically selected;
default to the most recently edited file or ask.

### Locator cards

After creating or editing pages, embed `<viewer-locator>` cards in your
reply so the user can jump straight to the result. The card's `data`
attribute is JSON; for kami the navigable key is the HTML page path
inside the active content set:

| Key | Meaning |
|---|---|
| `page` | HTML page path inside the active content set (e.g. `index.html`, `page-3.html`). Alias `file` is accepted. |

Real examples:

```html
<viewer-locator label="Open the cover" data='{"page":"index.html"}' />
<viewer-locator label="Jump to the Projects page" data='{"page":"page-3.html"}' />
<viewer-locator label="See the rewritten Methods page" data='{"file":"methods.html"}' />
```

One card per landmark you want the user to verify. Switching content
sets (e.g. from `pneuma-one-pager` to `kaku-portfolio`) is driven by the
viewer chrome, not the locator card — point the user there in prose if
they need to switch sets.

### Viewer actions

Kami exposes **no agent-invocable viewer actions** today. There is no
`scaffold`, no `navigate`, no programmatic page-size or orientation
change (paper size and orientation are locked at workspace creation in
`.pneuma/config.json`; see "What this mode is"). To start a new
document, create a new content-set directory with `index.html` +
`manifest.json` directly using `Write` — see "When the user hands over
raw content" below.

The base `POST $PNEUMA_API/api/viewer/action` endpoint exists for modes
that declare actions; calling it for kami will not match any registered
action.

### Native bridge

Desktop APIs (clipboard, shell, notifications, …) are available at
`$PNEUMA_API/api/native/*` when the session runs inside the Pneuma App.
Discover what's actually wired up at runtime with
`GET $PNEUMA_API/api/native` — web-only sessions report `available: false`
for unsupported modules.

## Core rules

- Edit HTML/CSS/JS files directly — the user sees updates live.
- Keep the canvas warm (`#f5f4ed` parchment, never pure white).
- Single accent color: ink blue `#1B365D`. No gradients, no second
  chromatic hue, no hard drop shadows.
- Serif (TsangerJinKai02 CN / Newsreader EN) weight locked at 500.
  Never bold.
- Do not edit `_shared/styles.css` tokens casually. Aesthetic drift
  compounds fast.
- When importing raw content, create a new content set
  (see `references/writing.md`).
- Do not modify `.claude/` — it's runtime-managed.

## Aesthetic rules (kami adapted)

| Element | Rule |
|---|---|
| Canvas | `#f5f4ed` parchment. Never pure white. |
| Accent | Ink blue `#1B365D` only. No second chromatic hue. |
| Neutrals | Warm-toned (yellow-brown undertone). No cool blue-grays. |
| Serif | **One serif per page.** CN: `TsangerJinKai02`. EN: `Charter` (system). JA: `YuMincho` (system). Weight 400 body / 500 headings. Never bold. |
| Letter-spacing | CN body 0.3pt (locks in TsangerJinKai02 density). EN body 0. Tracking only on small labels and overlines. |
| Line-height | Titles 1.1–1.3. Dense body 1.4–1.45. Reading body 1.5–1.55. Never 1.6+. |
| Shadows | Ring or whisper only. No hard drop shadows. No gradients. |
| Tags | Solid hex backgrounds only — rgba() can break in print. |

`--sans` aliases `--serif` in `_shared/styles.css`; use one serif per page
unless the design calls for an explicit mono code block. Match the user's
language: CN content stays on the TsangerJinKai02 stack, EN on Charter,
JA on YuMincho (best-effort, visually verify before shipping).

## Workspace layout

```
_shared/
  styles.css          # Tokens + paper dimensions. Don't edit casually.
  assets/fonts/       # Bundled fonts: TsangerJinKai02-W04.ttf, JetBrainsMono.woff2
  assets/diagrams/    # 14 self-contained SVG templates — copy the <svg>
                      # block out, drop it inside a <figure> on a page.
pneuma-one-pager/      # EN one-pager demo (Pneuma product brief)
kaku-portfolio/        # CN 6-page portfolio demo (from kami)
.pneuma/kami-fit.json  # Auto-written fit report — READ after every edit
```

Each content set has an `index.html` + `manifest.json` (+ a `README.md`
for provenance). The user can switch between sets, or you can create new
ones when they hand over raw content.

## Doc types this mode handles

One design language across these document genres. Pick the genre from the
user's intent before choosing a layout — the genre dictates length, page
count, density, and which diagrams sit naturally inside.

| User says | Genre |
|---|---|
| "one-pager / 方案 / 执行摘要 / exec summary" | One-Pager |
| "white paper / 白皮书 / 长文 / 年度总结 / technical report" | Long Doc |
| "formal letter / 信件 / 辞职信 / 推荐信 / memo" | Letter |
| "portfolio / 作品集 / case studies" | Portfolio |
| "resume / CV / 简历 / 履歴書" | Resume |
| "slides / PPT / deck / 演示" | Slides |
| "个股研报 / equity report / 估值分析 / investment memo / 股票分析" | Equity Report |
| "更新日志 / changelog / release notes / 版本记录" | Changelog |

Seed demos cover three points on this spectrum (`pneuma-one-pager/`,
`kaku-portfolio/`, `nvda-equity-report/`); the rest you build from
scratch into a new content set.

> Output format selection is driven by the viewer's Export menu (PDF /
> PNG); do not auto-trigger PDF/PNG generation from the agent side.

## When the user hands over raw content

The flow below assumes you've already classified the doc type using the
table above.

### Step 1 · Source and material pass

Run this before distilling or filling when the document depends on facts
or materials outside the user's draft. Skip only for personal drafts
where the user supplied everything needed.

**Source check.** Trigger when the document mentions a specific company,
product, person, release date, version, funding round, metric, market
fact, or technical spec — any current fact likely to change.

- Use primary sources before writing: user-provided material, official
  site, docs, filings, press release, app store page, or repo release.
- Keep a short note of source names and dates for facts that drive the
  document.
- If sources conflict or a fact cannot be checked quickly, ask the user
  instead of choosing silently.
- Avoid current-sounding claims ("latest", "recent", "new", version
  numbers, launch dates, financial figures) unless they are checked.

**Material check.** Trigger when the document is about a company,
product, project, venue, or personal brand. Confirm the materials that
make the subject recognizable before layout:

| Need | Required when | Accept |
|---|---|---|
| Logo | Any branded document | User file or official SVG/PNG |
| Product image | Physical product / venue / object | Official image, user image, or marked gap |
| UI screenshot | App / SaaS / website / tool | Current screenshot, official product image, or user capture |
| Brand colors | Branded one-pager / portfolio / deck | Official value, extracted asset value, or keep kami ink-blue |
| Fonts | Only if brand typography matters | Official font, close system fallback, or kami default |

If a required item is missing, use a compact gap table and ask once. Do
not replace missing material with generic imagery, approximate logo
drawings, or invented values.

**Materials status block.** After the material check, output a structured
status block before continuing. One-shot transparency display, not a
question:

```
Materials status:
- Logo: OK assets/client-logo.svg
- Brand colors: OK #1B365D mapped to --brand
- Product screenshot: MISSING (proceeding with kami default placeholder)
- UI screenshot: not required for this doc type
```

Use `OK`, `MISSING`, or `not required`. If a required item is missing and
no user input arrived, ask once with the gap table; otherwise continue
silently.

### Step 2 · Layout note (transparent, non-blocking)

Before creating the content set, write a short editor-style note stating
the layout intent: doc genre, length target, narrative arc, embedded
diagrams, material status. Match the user's language. Keep it under 80
words, written as prose, not a status panel. Continue immediately after;
do not wait for approval.

Example (EN):

> Layout intent: Equity Report (EN), two pages A4. Open with thesis and
> price target, run through valuation (DCF and comparables), close on
> catalysts and risks. A revenue line chart and an FY26 waterfall sit
> mid-doc. Logo is in hand; product image is absent, so the header stays
> text-only.

Example (CN):

> 排版意图：Equity Report 中文版，2 页 A4。先立论与目标价，进入估值 (DCF
> 与可比公司)，落于催化剂与风险。中段嵌一张营收趋势折线和 FY26 收入桥瀑
> 布。Logo 已就位，产品图暂缺，header 改走纯文字。

The note is for transparency, not approval. If the user pushes back,
adjust; otherwise proceed to Step 3.

### Step 3 · Create the content set

1. Pick a short content-set name (e.g. `acme-whitepaper/`).
2. Create the directory with an `index.html` that starts from the closest
   existing demo as a skeleton, a `manifest.json`, and a `README.md`.
3. Extract every factual claim from the raw content; classify into
   sections that match the target doc type's structure.
4. Gap-check: list what the layout needs but the content doesn't have.
   Share the gap table with the user before guessing.

## Fit discipline — the kami authoring loop

Kami is a **strict-page** medium. The AUTHOR decides how many sheets a
document spans by writing that many `<div class="page">` blocks. Every
page's content must be **tuned to fit exactly one sheet** — not overflow,
not sit half-empty. This is kami's core discipline, adapted from the
WeasyPrint-verified workflow in the upstream project.

The viewer makes this loop machine-checkable: after every render, it
writes a measurement report to **`.pneuma/kami-fit.json`**. **You MUST
read this file after every meaningful edit** and iterate until every
page reports `status: "fits"`.

Report shape:

```json
{
  "content_set": "musk-resume",
  "file": "index.html",
  "paper": { "size": "A4", "orientation": "Portrait", "height_mm": 297 },
  "pages": [
    { "index": 1, "content_height_mm": 289.2, "overflow_mm": -7.8, "status": "fits" },
    { "index": 2, "content_height_mm": 314.5, "overflow_mm":  17.5, "status": "overflow" }
  ],
  "summary": { "overflow_count": 1, "sparse_count": 0, "fits_count": 1 }
}
```

| Status     | Meaning                           | What to do |
|------------|-----------------------------------|------------|
| `fits`     | Content is within ±50mm of paper height | Stop. Move on. |
| `overflow` | `overflow_mm > 2` — will not print on one sheet | **Must trim.** Drop a bullet, tighten phrasing, remove a section, or merge duplicated concepts. Do NOT just shrink font-size or line-height — those are locked by the design system. |
| `sparse`   | `overflow_mm < -50` — paper is ~20%+ blank | Consider filling: expand a weak section with concrete specifics, add a pull-quote, include a metric, OR merge adjacent pages if the content genuinely fits tighter. |

**The loop** (run it automatically after every edit; don't wait for the user to point out overflow):

1. Make a content edit.
2. Read `.pneuma/kami-fit.json`.
3. If `overflow_count > 0` → trim the overflowing pages → loop to step 2.
4. If `sparse_count > 0` and content intent allows → enrich → loop to step 2.
5. When every page is `fits` → stop.

Reaching `fits` across every page is the quality bar before you tell
the user the document is ready. Silence on your part implies the fit is
passing. See `references/cmd-fit.md` for edge cases (sparse-on-purpose
cover pages, multi-sheet sections, how to choose what to trim).

### Per-page density target (multi-page docs only)

Applies to long-doc / portfolio / slides / equity-report / changelog.
Does **not** apply to resume / one-pager / letter — those have their own
length contracts.

Body-page fill target is **60–80%**. Cover, table-of-contents, and final
sign-off pages are exempt. This rule guards against AI-generated drafts
that fragment content too thin to fill the sheets they occupy. The fill
percentage is `content_height_mm / paper_height_mm` from `kami-fit.json`;
the existing `sparse` status (`overflow_mm < -50` ≈ <~83% on A4) already
flags the worst cases — the per-template thresholds below sharpen the
decision for borderline pages.

**Items-per-page contract** (thresholds from upstream V1.5.0):

| Genre | Typical body page | Hard floor (merge if below) |
|---|---|---|
| Slides | 1 assertion title + 3–5 supporting items, or 1 chart + 2–3 callouts | <3 items and no chart → merge into adjacent slide |
| Long doc | 1 chapter heading + 2–4 paragraphs + at most 1 figure | Chapter renders <40% page → merge into neighbor |
| Portfolio | 1 project header + 1 hero image + 3–5 outcome bullets | No image and <3 outcomes → merge with adjacent project |
| Equity report | 1 section + 1 table/chart + supporting prose | Only a 2-row table on the page → combine sections |
| Changelog | 1 version block + 4–8 entries | Version has <4 entries → place on the same page as the prior version |

**Sparse-page merge rule.** Any body page rendering under 50% full
(i.e. `kami-fit.json` reports `status: "sparse"` *and* the items-per-page
floor for the genre is breached) → apply, in order:

1. Merge upward into the previous section.
2. Merge downward into the next section.
3. Promote a list to a small diagram or table that earns the space.
4. Pin a `.co` callout to the bottom (slides only). Whitespace above a
   pinned callout is intentional, not sparse.

Forbidden ways to "fill" a sparse page: padding with filler prose,
repeating the heading as a sentence, inventing statistics, restating the
prior page in different words. If the merge options don't apply, the page
itself shouldn't exist — delete the `<div class="page">` block.

**Last-page exemption.** The last body page is allowed 40–60% fill;
forcing balance there usually means padding. The cover and closing
colophon may have any fill level.

## Image generation (only when the user has configured a key)

A script lives at `{SKILL_PATH}/scripts/generate_image.mjs`. Default model
is `gpt-image-2` (fal.ai) — the right choice for kami because it renders
**legible typography inside images**: figure captions, diagram labels,
mock book spines, imagined postage stamps, rendered monograms. Opt in to
`--model gemini-3-pro` only for painterly / watercolor / woodcut-style
decorative artwork.

Images here live on a **printed paper page**. That constraint is absolute
and distinguishes kami from every other Pneuma mode. The images can't
look like they escaped from a SaaS landing page.

### The kami image slop test

Before you call the generator, picture where the image will sit — next to
warm parchment, serif body at weight 500, ink-blue accents, generous
margins. If the honest answer to *"does this image look like it belongs
in a printed book"* is no, rewrite the prompt.

Reject on sight:

- Saturated HDR colors, glossy 3D renders, neon / cyan highlights, space
  backgrounds, data-orb / "AI hero" aesthetics
- Purple-to-blue or cyan-on-dark gradients (kami has exactly one accent —
  ink blue — and *no* gradients, period)
- Drop shadows *inside* the image. The paper frame provides its own
  whisper ring-shadow; another shadow stacked on top is noise.
- AI-rendered people with waxy symmetrical faces
- Generic stock photography: boardroom handshakes, laptop-on-desk flat
  lays, "team standing in a circle"
- Tech-sticker aesthetics: chunky rounded rectangles with tiny icons,
  gradient backgrounds, retro-wave grids

Lean toward:

- **Documentary / editorial photography** — muted warm neutrals, diffuse
  natural light, analog film grain, print magazine composition
- **Risograph / woodcut / letterpress illustration** — limited palette,
  visible mark-making, handmade quality
- **Duotone / warm monochrome portraits** — ink blue + bone, or sepia +
  parchment; never full-color high-saturation headshots
- **Technical drawings & schematics** — thin ink lines on parchment,
  annotated with serif labels, in the spirit of 19th-century engineering
  manuals
- **Mock objects on paper ground** — a rendered museum label, a ticket
  stub, a book spine — imagined as if sitting on the page itself

### Prompt discipline

Bake these ingredients into every prompt so the result harmonizes with
the page it will land on:

1. **Palette anchor** — include phrases like *"warm parchment background
   tone (bone / off-white / #f5f4ed range), single ink-blue accent, no
   other chromatic hues, muted warm neutrals throughout"*.
2. **Weight & tone** — *"editorial restraint, print publication quality,
   not SaaS landing page"*.
3. **Medium** — pick one and commit (documentary photo / Risograph /
   woodcut / technical ink drawing / pressed botanical / museum archive).
4. **Composition** — *"generous negative space, off-center or rule-of-
   thirds, small subject on wide ground"* — paper pages breathe.
5. **No-fly zone** (explicit) — *"no gradients, no drop shadows on the
   subject, no glossy highlights, no neon"*. Models are suggestible; say
   it out loud.

Two worked examples:

> *Portrait for a resume page, A4 Portrait layout:*
> "A head-and-shoulders duotone portrait of a woman in her thirties,
> three-quarter profile, natural diffuse window light, printed as ink
> blue (#1B365D) duotone against a warm bone #f5f4ed ground, slight
> analog film grain, editorial restraint, generous negative space around
> the subject, no full-color, no drop shadow, no gradient — a magazine
> page portrait, not a LinkedIn avatar."

> *Inline diagram for a whitepaper section:*
> "A simple hand-drawn ink schematic of a four-node circular buffer,
> labeled nodes reading 'head', 'read', 'write', 'tail' in thin serif
> typography, thin ink-blue (#1B365D) lines on a warm parchment ground
> (#f5f4ed), generous whitespace around the diagram, visible hatched
> shading and hand-set labels, the feel of a 19th-century engineering
> manual — no gradients, no digital glow, no drop shadow."

### How to call it

```bash
cd {SKILL_PATH} && node scripts/generate_image.mjs \
  "Your kami-aligned prompt here" \
  --aspect-ratio 4:3 \
  --quality high \
  --output-format png \
  --output-dir <workspace>/<content-set>/assets \
  --filename-prefix figure-01
```

Flag guidance in paper terms:

| Flag | Kami guidance |
|---|---|
| `--aspect-ratio` | `4:3` or `3:2` for figures inline with body text; `1:1` for portraits and spot illustrations; `3:4` for vertical portraits set beside body text; `16:9` only for landscape-paper covers. Avoid `21:9` — it rarely sits well on a page. |
| `--quality` | `high`. Kami is a printed-page medium; no reason to ship draft-quality to final. |
| `--output-format` | `png` for illustrations / diagrams / monochrome portraits (preserves clean edges and text); `jpeg` only for full-color photography. |
| `--output-dir` | Always the active content set's `assets/` directory. Don't dump into `_shared/assets/` — that's the upstream-sourced font & diagram folder. |
| `--filename-prefix` | Role + index: `portrait-founder`, `figure-02-buffer`, `stamp-motif`. |
| `--model gemini-3-pro` | Reach for this when the style is explicitly painterly / watercolor / woodcut — Gemini's aesthetic range is broader at that end. Everything else stays on `gpt-image-2`. |

### After generating

1. Embed inside a `<div class="page">` with appropriate framing. Keep
   captions in small serif below the image if it's a figure.
2. Match the figure's real paper width in CSS — don't let an image bleed
   past the page's safe margins. The page's safe zone is
   `{{pageWidthMm - safeSideMm*2}} × {{pageHeightMm - safeTopMm - safeBottomMm}} mm`.
3. If the image has its own visible background, prefer PNG with a
   transparent or `#f5f4ed`-matched background so it blends into the
   paper. No extra box around it — the page *is* the frame.
4. **Re-read `.pneuma/kami-fit.json`.** An image adds height; a page that
   used to `fit` can flip to `overflow` after the embed. Loop the fit
   discipline until every page reads `fits` again.

### Consistency across figures

When a document needs multiple images (a multi-page portfolio, a
whitepaper with several diagrams), record the first prompt's style
descriptors and reuse them verbatim on every subsequent prompt. Kami
documents read as one voice across every sheet; the imagery must too.

## Don'ts

- Don't add a second accent color, gradients, or hard drop shadows.
- Don't change paper size — it is locked in `.pneuma/config.json`. If the
  user wants a different size, tell them to create a new workspace.
- Don't edit tokens in `_shared/styles.css` casually. Aesthetic drift
  compounds fast.
- Don't modify `.claude/` — runtime-managed.
- Don't try to render Python-driven slide decks in this mode; that's a
  separate (future) mode.

## Diagrams (14 self-contained templates)

When a page benefits from a chart, pick the closest match from
`_shared/assets/diagrams/`, copy the `<svg>` block out, and drop it inside
a `<figure>` on the page. Don't link the file via `<iframe>` — diagrams
are meant to live inline so they paginate with the surrounding text.

| User intent | Diagram | File |
|---|---|---|
| 架构 / system / components | Architecture | `architecture.html` |
| 流程 / flowchart / branching | Flowchart | `flowchart.html` |
| 象限 / quadrant / 2×2 matrix | Quadrant | `quadrant.html` |
| 柱状 / bar / category compare | Bar Chart | `bar-chart.html` |
| 折线 / line / time series | Line Chart | `line-chart.html` |
| 环形 / donut / pie / 占比 | Donut | `donut-chart.html` |
| 状态机 / lifecycle | State Machine | `state-machine.html` |
| 时间线 / milestones / roadmap | Timeline | `timeline.html` |
| 泳道 / cross-team flow | Swimlane | `swimlane.html` |
| 树状 / hierarchy / org chart | Tree | `tree.html` |
| 分层 / OSI / stack | Layer Stack | `layer-stack.html` |
| 维恩 / overlap / 集合 | Venn | `venn.html` |
| K 线 / OHLC / 股价 | Candlestick | `candlestick.html` |
| 瀑布 / revenue bridge / decomposition | Waterfall | `waterfall.html` |

Read `references/diagrams.md` once before drawing — it has the selection
guide, kami token map, and the AI-slop anti-pattern table.

**Auto-select charts from data.** When the page content includes numeric
data, pick the right chart type and embed it without waiting for the user
to ask. Decision tree (first match wins, from upstream V1.5.0):

| Data shape | Chart |
|---|---|
| Has open/high/low/close fields, or per-day price | Candlestick |
| Has + and − contributions that sum to a total (bridge, waterfall, P&L) | Waterfall |
| One series, values sum to ~100%, items ≤ 6 | Donut |
| One series, values sum to ~100%, items ≥ 7 | Horizontal bar |
| Two or more series across time (months, quarters, years) | Line |
| One series across time, large count changes dominate (not rate) | Bar |
| Multiple categories, same time snapshot, 2+ series | Grouped bar |
| 2×2 strategic or priority positioning | Quadrant |
| Hierarchical data with depth ≥ 2 | Tree |
| Process with decision branches | Flowchart |
| Cross-team or cross-role process with ≥ 3 actors | Swimlane |
| Set overlaps or shared attributes between 2–3 groups | Venn |
| Category comparison, single series, no time axis | Bar |

When data fits multiple types, prefer the one that shows variance most
clearly. Always embed inside a `<figure>` with a caption that states the
insight, not just the data range.

Before drawing, ask: **would a well-written paragraph teach the reader
less than this diagram?** If no, don't draw.

## References (read on demand)

Load only what the task needs. Default to the lowest tier.

| When | Read |
|---|---|
| Updating text / translating / swapping bullets | Nothing — just edit, then check `kami-fit.json` |
| A page shows `overflow` or `sparse` | `references/cmd-fit.md` — trimming + filling tactics |
| Adjusting layout or tweaking spacing | Look at the closest existing demo |
| Building a new doc type from scratch | `references/design.md` |
| Writing tone / structure guidance | `references/writing.md` |
| Embedding a diagram | `references/diagrams.md` |

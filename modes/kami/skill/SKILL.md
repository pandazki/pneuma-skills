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

## When the user hands over raw content

1. Pick a short content-set name (e.g. `acme-whitepaper/`).
2. Create the directory with an `index.html` that starts from the blank
   scaffold (copy `blank/index.html` as the skeleton), a `manifest.json`,
   and a `README.md`.
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
data (revenue splits, trends, category comparisons), pick the right chart
type and embed it without waiting for the user to ask. Selection guide:
proportional → donut, time series → line, category compare → bar, price
history → candlestick, value decomposition → waterfall.

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

## Viewer API

<!-- pneuma:viewer-api:start -->
{{viewerCapabilities}}
<!-- pneuma:viewer-api:end -->

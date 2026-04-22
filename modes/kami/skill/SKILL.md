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
({{pageWidthMm}} × {{pageHeightMm}} mm), locked at workspace creation.

You edit HTML / CSS / JS files inside each content set directly with the
Edit and Write tools. The iframe preview reflects changes live.

## Aesthetic rules (kami adapted)

| Element | Rule |
|---|---|
| Canvas | `#f5f4ed` parchment. Never pure white. |
| Accent | Ink blue `#1B365D` only. No second chromatic hue. |
| Neutrals | Warm-toned (yellow-brown undertone). No cool blue-grays. |
| Serif | `TsangerJinKai02` (CN) / `Newsreader` (EN). Weight locked 500. Never bold. |
| Line-height | Titles 1.1–1.3. Body 1.5–1.55. Never 1.6+. |
| Shadows | Ring or whisper only. No hard drop shadows. No gradients. |
| Tags | Solid hex backgrounds only — rgba() can break in print. |

If the user writes in Chinese, prefer the CN demos and Chinese typography
fallbacks. If they write in English, prefer the EN demos and Newsreader.

## Workspace layout

```
_shared/
  styles.css          # Tokens + paper dimensions. Don't edit casually.
  assets/fonts/       # Bundled fonts (6 files).
  assets/diagrams/    # architecture.html, flowchart.html, quadrant.html
pneuma-one-pager/      # EN one-pager demo (Pneuma product brief)
musk-resume/           # EN resume demo (from kami)
kaku-portfolio/        # CN 6-page portfolio demo (from kami)
blank/                 # Empty .page starter
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

## Don'ts

- Don't add a second accent color, gradients, or hard drop shadows.
- Don't change paper size — it is locked in `.pneuma/config.json`. If the
  user wants a different size, tell them to create a new workspace.
- Don't edit tokens in `_shared/styles.css` casually. Aesthetic drift
  compounds fast.
- Don't modify `.claude/` — runtime-managed.
- Don't try to render Python-driven slide decks in this mode; that's a
  separate (future) mode.

## References (read on demand)

Load only what the task needs. Default to the lowest tier.

| When | Read |
|---|---|
| Updating text / translating / swapping bullets | Nothing — just edit, then check `kami-fit.json` |
| A page shows `overflow` or `sparse` | `references/cmd-fit.md` — trimming + filling tactics |
| Adjusting layout or tweaking spacing | Look at the closest existing demo |
| Building a new doc type from scratch | `references/design.md` (CN) / `design.en.md` (EN) |
| Writing tone / structure guidance | `references/writing.md` / `writing.en.md` |
| Embedding a diagram | `references/diagrams.md` / `diagrams.en.md` |

## Viewer API

<!-- pneuma:viewer-api:start -->
{{viewerCapabilities}}
<!-- pneuma:viewer-api:end -->

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
tesla-one-pager/       # CN one-pager demo (from kami)
musk-resume/           # EN resume demo (from kami)
kaku-portfolio/        # CN 6-page portfolio demo (from kami)
blank/                 # Empty .page starter
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
| Updating text / translating / swapping bullets | Nothing — just edit |
| Adjusting layout or tweaking spacing | Look at the closest existing demo |
| Building a new doc type from scratch | `references/design.md` (CN) / `design.en.md` (EN) |
| Writing tone / structure guidance | `references/writing.md` / `writing.en.md` |
| Embedding a diagram | `references/diagrams.md` / `diagrams.en.md` |

## Viewer API

<!-- pneuma:viewer-api:start -->
{{viewerCapabilities}}
<!-- pneuma:viewer-api:end -->

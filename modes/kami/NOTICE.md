# Pneuma Kami Mode — Third-Party Notices

## Design system: tw93/kami

This mode's visual language, tokens, seed templates, and reference documents
are adapted from [tw93/kami](https://github.com/tw93/kami), an open-source
typesetting design system.

Kami is distributed under the MIT License. See the upstream repository for
the full license text. Excerpt:

> MIT License
>
> Copyright (c) 2024 Tw93
>
> Permission is hereby granted, free of charge, to any person obtaining a
> copy of this software and associated documentation files (the "Software"),
> to deal in the Software without restriction, including without limitation
> the rights to use, copy, modify, merge, publish, distribute, sublicense,
> and/or sell copies of the Software, and to permit persons to whom the
> Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included
> in all copies or substantial portions of the Software.

## Fonts

### TsangerJinKai02-W04 + W05 (CN serif, dual face)

`seed/_shared/assets/fonts/TsangerJinKai02-W04.ttf` (400-weight body)
and `seed/_shared/assets/fonts/TsangerJinKai02-W05.ttf` (500-weight
headings) are bundled under the vendor's free-for-personal-use license.
The dual-face setup matches upstream V1.5.0: two separate `@font-face`
declarations under the same family name let the browser pick a real
500-weight file for headings instead of synthetically bolding W04.
**Commercial use requires a separate license** from
[tsanger.cn](https://tsanger.cn). End-users producing commercial
documents are responsible for securing that license.

### JetBrains Mono (OFL)

`seed/_shared/assets/fonts/JetBrainsMono.woff2` is distributed under the
[SIL Open Font License 1.1](https://openfontlicense.org/). No additional
fee or permission required.

### English, Japanese & Korean serif (system-bundled)

English templates fall through to **Charter** (macOS / iOS bundled),
**Georgia**, and **Palatino**. Japanese templates fall through to
**YuMincho** / **Hiragino Mincho ProN** (macOS / iOS bundled) and **Noto
Serif CJK JP**. Korean templates fall through to **AppleMyungjo** /
**Nanum Myeongjo** (macOS / iOS bundled, when present) and **Source Han
Serif K** / **Noto Serif CJK KR**. None are shipped with this mode; the
OS provides them or the page falls through to a generic serif. This
matches the upstream single-serif-per-page model (locked since v1.2.0).
As with Japanese, Korean is a best-effort language requiring visual QA —
it mirrors upstream V1.7.0's "Korean Paper" without bundling the font.

## Tracked upstream version

Diagrams and reference docs in this mode are synced against
[tw93/kami **V1.16.0**](https://github.com/tw93/Kami/releases/tag/V1.16.0)
("Good content deserves good paper"), plus the post-release commit
`a489e39` that finishes V1.16.0's verified-numbers wording in
`references/writing.md`. Upstream moved its skill into `skills/kami/` in
V1.15.0; the file-level mapping is unchanged.

Adopted from V1.14.0 – V1.16.0:

- **V1.14.0 subtractive visual system.** `references/design.md` drops the
  brand left rule, eyebrow ticks, short cover / contact rules, the
  callout and quote side bars, the accent-edge card, ring and hover
  shadows, and the dash bullet in favour of the «Subtractive rule»
  (a line must separate regions, encode state, or carry data) and a flat
  «Depth & Separation» section. The table recipe moves to neutral
  `0.6pt` / `0.25pt` `--border` hairlines with a padding floor, earned
  `.compact` and exceptional `.striped`; the metric-suffix rule for `×`
  is added. SKILL.md gains the table pass and the subtractive pass as
  Step 5. The three seeds follow (bars, ticks and brand rules removed,
  equity-report tables re-ruled and un-striped, analyst box loses its
  closed border), and their gallery cards were re-rendered.
- **V1.14.0 sparse-page policy.** Sparse pages merge or fold into a
  neighbour before they are filled, and nothing (callout, chart, image)
  is added only to occupy space — SKILL.md fit table, `cmd-fit.md`,
  design.md deck recipe, and the `.co` pinned-callout rule.
- **V1.16.0 verified numbers only.** `writing.md`, `resume-writing.md`
  and anti-pattern #7 stop demanding a figure in every bullet or
  paragraph; outcomes use verified metrics or concrete qualitative
  evidence, and localization reports coverage rather than rewrite counts.
- **V1.16.0 typography cross-check** (measure 40–70 characters, optical
  alignment, contrast over ornament; multi-weight families rejected) in
  design.md §2.
- **V1.16.0 lighter deck intake.** `deck-preflight.md`'s six questions
  become an internal checklist; only open, material choices are asked.
- **V1.16.0 comparison variants** render in the document's own page and
  background, changing only the compared property.
- The checker-independent half of V1.16.0's architecture geometry rules
  (edge attachment, label masks, preserving relationship labels) lands in
  `diagrams.md` «Relationship geometry», verified by eye on a `capture`.

Items intentionally not synced from upstream because they don't apply to
Pneuma's iframe paper-canvas / browser-print model:

- V1.15.0 strict LaTeX mathematics (MathJax SVG via `ensure_mathjax.sh`
  and `math_render.py`, Node runtime). It is a build-time renderer this
  mode does not have; without it the rule would print raw TeX.
- V1.15.0 skills-CLI install slimming and checkout font recovery, and the
  `skills/kami/` + `site/` repository split — packaging plumbing.
- V1.16.0 diagram geometry checker (`data-node` / `data-edge` /
  `data-label-for` annotations, `diagram_geometry.py`, `--check`). The
  18 diagram templates here stay unannotated; the principles ride
  `diagrams.md` instead.
- V1.16.0 long-doc TOC anchor fix and `--verify` page-number check
  (WeasyPrint 70 `target-counter()`), and the post-release Korean
  MuPDF preview pitfall — WeasyPrint-only.
- V1.16.0 intake changes that target flows this mode lacks: the
  page-count question (Pneuma never asked it) and the narrowed trigger
  that stops auditing existing product sites (landing pages are already
  out of model).
- V1.14.0 `--inline-code-bg` token and the screen-only landing-page
  changes (CTA stacking at 320px, inline-code, card hover, pricing, hero
  entrance, gallery sweep) — screen-first genre, not synced.
- V1.14.0 PPTX-only-on-request output rule — Pneuma exports PDF / PNG
  from the viewer and has no PPTX path.

- The WeasyPrint runtime and the `slides-weasy` PDF path; the Marp /
  `marp-cli` and python-pptx slide-rendering paths (V1.6.0 "Markdown
  Stage" — Pneuma renders slides as HTML in the iframe).
- The screen-first landing-page genre and its multilingual site
  companions (sitemap / robots / `llms.txt` / JSON-LD / hreflang),
  including the V1.9.1–V1.10.0 additions to that genre (single-line
  surfaces, testimonial walls, pricing/social-proof/SEO-article rules,
  dashboards, docs pages).
- The `build.py` / `ensure-fonts.sh` build pipeline, CJK font
  auto-recovery, the quiet daily update check, the plugin marketplace
  install paths (Claude Code, and Codex added in V1.8.0), release
  packaging allowlists, and the brand profile loaded from
  `~/.config/kami/brand.md`.
- The Mermaid authoring pipeline (V1.9.0: beautiful-mermaid,
  `mermaid_normalize.py`, `mermaid-theme.json`, `references/mermaid.md`).
  The three Mermaid-sourced diagrams (`sequence` / `class` / `er`) ship
  here as static kami-themed SVG with their `.mmd` sources kept for
  provenance; regeneration happens upstream, not in this mode.
- WeasyPrint paged-media long-doc features (V1.9.2): TOC page numbers
  via `target-counter()` and per-chapter running headers — browser print
  has no reliable equivalent.
- The PDF check pipeline (`--check-resume-balance`, `--check-markdown`,
  `--check-content`, `--check-visual`, `--check-density`, V1.7.4–V1.10.0)
  and the `references/schemas/*.json` content contracts. Their
  principles are adapted as agent-side guidance instead: two-page
  balance and the recruiter pass ride `.pneuma/kami-fit.json`
  (resume-writing reference), and the pre-layout structure / post-fill
  fact check lives in SKILL.md — without mechanical validators.
- The MCP server tools (V1.10.0 `mcp_server.py`) — Pneuma's viewer API
  and `capture` action cover the render/check/screenshot loop.
- Placeholder-hint parity across upstream fill-in templates (V1.9.4) —
  Pneuma seeds are complete demo documents, not `{{...}}` templates.
- The repo-maintained diagram PNG-export trio (V1.9.4 `index.html` +
  PNG + `prompt.md`, headless-Chrome export chain). The lifecycle
  guidance (evidence pass, intent note, maturity encoding, terminology
  sync) is adapted in the diagrams reference; the export mechanics are
  upstream delivery plumbing.
- The V1.9.3 changelog-template `--mono` fix is structurally covered
  here: documents build on `_shared/styles.css`, which already defines
  the `--mono` stack with CJK fallback.
- `references/production.md` has never been adopted and stays that way
  after V1.13.0. It is the PDF / PPTX / ZIP delivery pipeline —
  WeasyPrint invocation, `pdffonts` reading, python-pptx palette
  constants, Marp render commands. Its V1.13.0 additions (the
  `--check-fonts` verdict, pitfall 4.1 on Latin-first stacks splitting
  CJK inside inline SVG) are fontconfig-and-WeasyPrint truths, not
  browser ones; the *stack ordering* they argue for is adopted in
  `references/design.md` §2 and in the diagram templates, the tooling
  around them is not.
- `references/deck-preflight.md` (new in V1.13.0) is adopted **in part**.
  The six pre-flight questions and the slide content rules are
  medium-independent and ship here. Its path-selection table
  (WeasyPrint / python-pptx / Marp) and its page-size table are dropped:
  a Pneuma deck is HTML paper pages in the viewer, and the page size is
  locked at workspace creation, so neither is a decision the agent gets
  to make.
- The V1.12.0–V1.13.0 check mechanics: `scripts/checks.py` and the
  `--check-fonts` / `--check-style` / `--check-rhythm` / `--doctor`
  flags, the MCP report shape that grades content / coverage / visual
  separately, the render-to-temp-file-then-swap strategy for PDF, PPTX
  and ZIP builds, `release_gate.py`, the CI matrix that renders every
  page-limited template, the font-integrity gate, the desktop-package
  byte comparison, and the "announce an update only once the Release
  and ZIP exist" flow. All of it is delivery plumbing around a build
  pipeline this mode does not have. **Their principles are adapted as
  agent-side guidance instead**: plan-before-layout (Step 2 now records
  output target, page target and the checks the document must pass),
  bounded visual repair (name the target, name what stays untouched,
  verify the blast radius), and weak-evidence-does-not-pass — hidden
  text, an unresolvable image, and an empty `<div class="page">` cannot
  satisfy a check, and "I did not look" is the honest verdict.
- The V1.13.0 `references/schemas/*.json` tightening (`minItems` on the
  changelog contract) — unchanged stance: the JSON content contracts are
  not adopted, and their intent rides SKILL.md's post-fill fact check.
- Upstream's V1.13.0 `references/anti-patterns.md` change is a pure
  renumbering that fixes a duplicate-number collision (41–45 appeared
  twice in V1.10.0). This mode's adapted copy never had the collision,
  so its numbering is already correct and unchanged.
- Upstream's root `styles.css` V1.13.0 changes are almost entirely its
  public design-system *site* (a `.anti` ledger layout, `.hero.doc`,
  `.doc-nav`, `.prose`). Only the CN font-chain addition applies to this
  mode's `seed/_shared/styles.css`. Upstream also retired
  `--ring-warm` / `--ring-deep`; this mode still defines and uses them,
  so `references/design.md` keeps naming them. As of the V1.16.0 sync,
  design.md names only `--ring-warm` (the sheet's own edge in
  `_shared/styles.css`); `--ring-deep` stays declared but unused.

## Seed demos

The two demo content sets (`pneuma-one-pager/`, `kaku-portfolio/`) ship as
seed templates for the mode. `kaku-portfolio/` is adapted from kami's
README showcase; `pneuma-one-pager/` is a Pneuma-authored executive-brief
template. The content in either is illustrative — names and claims in the
showcase demo are from kami's original public-figure / fictional examples
and are not endorsed by, sponsored by, or affiliated with the named
entities.

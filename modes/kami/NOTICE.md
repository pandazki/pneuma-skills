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
[tw93/kami **V1.7.3**](https://github.com/tw93/Kami/releases/tag/V1.7.3)
("Wider Gallery", 2026-06-14). Items intentionally not synced from
upstream because they don't apply to Pneuma's iframe paper-canvas /
browser-print model: the WeasyPrint runtime and the `slides-weasy` PDF
path, the Marp / `marp-cli` and python-pptx slide-rendering paths (V1.6.0
"Markdown Stage" — Pneuma renders slides as HTML in the iframe), the
screen-first landing-page genre and its multilingual site companions
(sitemap / robots / `llms.txt` / JSON-LD / hreflang), the `build.py` /
`ensure-fonts.sh` build pipeline and CJK font auto-recovery, the quiet
daily update check, the Claude Code plugin marketplace install path, and
the brand profile loaded from `~/.config/kami/brand.md`.

## Seed demos

The two demo content sets (`pneuma-one-pager/`, `kaku-portfolio/`) ship as
seed templates for the mode. `kaku-portfolio/` is adapted from kami's
README showcase; `pneuma-one-pager/` is a Pneuma-authored executive-brief
template. The content in either is illustrative — names and claims in the
showcase demo are from kami's original public-figure / fictional examples
and are not endorsed by, sponsored by, or affiliated with the named
entities.

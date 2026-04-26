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

### TsangerJinKai02-W04 (CN serif)

`seed/_shared/assets/fonts/TsangerJinKai02-W04.ttf` is bundled under the
vendor's free-for-personal-use license. **Commercial use requires a
separate license** from [tsanger.cn](https://tsanger.cn). End-users
producing commercial documents are responsible for securing that license.

### JetBrains Mono (OFL)

`seed/_shared/assets/fonts/JetBrainsMono.woff2` is distributed under the
[SIL Open Font License 1.1](https://openfontlicense.org/). No additional
fee or permission required.

### English & Japanese serif (system-bundled)

English templates fall through to **Charter** (macOS / iOS bundled),
**Georgia**, and **Palatino**. Japanese templates fall through to
**YuMincho** / **Hiragino Mincho ProN** (macOS / iOS bundled) and **Noto
Serif CJK JP**. None are shipped with this mode; the OS provides them or
the page falls through to a generic serif. This matches the upstream v1.2.0
single-serif-per-page model.

## Seed demos

The two demo content sets (`pneuma-one-pager/`, `kaku-portfolio/`) ship as
seed templates for the mode. `kaku-portfolio/` is adapted from kami's
README showcase; `pneuma-one-pager/` is a Pneuma-authored executive-brief
template. The content in either is illustrative — names and claims in the
showcase demo are from kami's original public-figure / fictional examples
and are not endorsed by, sponsored by, or affiliated with the named
entities.

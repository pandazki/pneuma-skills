# Themes — the board's look

Each content set may carry a `theme.css` next to its `board.md`. It is
injected verbatim into the app document after the board's base styles —
equal specificity, later wins — so a theme overrides exactly what it
declares and inherits the rest.

## The one hard rule: always scoped

Every rule must be scoped under `.bansho-board-surface`. The file lands in
the same document as the script pane, the transport and the app chrome; a
bare selector restyles all of it.

```css
/* Yes */
.bansho-board-surface { --accent: #8a5a2b; }
.bansho-board-surface[data-bansho-theme="dark"] { --board: #1d2b33; }

/* No — restyles the whole app, not the board */
body { background: #1d2b33; }
* { font-family: cursive; }
```

## Token vocabulary

The board look is driven by a small set of custom properties:

| Token | Colors |
|---|---|
| `--board` | the board surface itself |
| `--board-fg` | the writing |
| `--accent` | hand-drawn underlines, circles, strike lines, terms, aside tint |
| `--hl` | the marker's color (`==…==` sweeps) |
| `--hl-a` | the marker's opacity — lower on dark boards so writing shows through |
| `--s1`, `--s2` | first and second chart series line colors |
| `--hand` | the handwriting font stack |

Defaults: a white board (`#ffffff` / near-black writing, light marker at
0.62) and, under `data-bansho-theme="dark"`, a deep green-gray chalk
board (`#22302a` / warm off-white, dim marker at 0.32). The user flips
light/dark in the viewer.

**Colors and `--hand` inherit differently, on purpose.** A theme that
declares only the light *palette* still gets the stock dark palette — a
parchment board must not stay parchment in the dark. `--hand` is the
opposite: it is one decision about the board's hand, so a single
`.bansho-board-surface { --hand: … }` rule takes effect on **both** boards.
Give the dark board a different hand only by saying so:

```css
.bansho-board-surface { --hand: "Bradley Hand", "HanziPen SC", cursive; }
.bansho-board-surface[data-bansho-theme="dark"] { --hand: "Chalkboard SE", "HanziPen SC", cursive; }
```

## A chalkboard theme, copyable

```css
.bansho-board-surface {
  --board: #f6f1e7;
  --board-fg: #26221c;
  --accent: #a04a1c;
  --hl: #f5d76e;
  --hl-a: 0.55;
}
.bansho-board-surface[data-bansho-theme="dark"] {
  --board: #263238;
  --board-fg: #eceff1;
  --accent: #e8894b;
  --hl: #e8c24a;
  --hl-a: 0.30;
  --s1: #80cbc4;
  --s2: #90caf9;
}
```

## Fonts — the honest part

`--hand` is a whole stack; order it by platform reality. This one rule is
the whole font declaration — it reaches the light board and the dark one:

```css
.bansho-board-surface {
  --hand: "Bradley Hand", "HanziPen SC", "Chalkboard SE", "Segoe Print", cursive;
}
```

- **CJK on macOS: use `HanziPen SC` (翩翩体).** It genuinely loads and
  carries the handwriting feel for Chinese.
- **Never use `Hannotate SC`.** The font API claims it exists, but text
  silently renders in PingFang — the handwriting feel evaporates with no
  error anywhere. This was measured, not guessed; do not rediscover it.
- Latin handwriting faces that ship on macOS: `Bradley Hand`,
  `Chalkboard SE`; on Windows, `Segoe Print`. Always end with `cursive`
  so other platforms degrade to something hand-ish rather than a default
  serif.
- If the user supplies a webfont, `@font-face` inside `theme.css` is fine
  — the rule's `font-family` name is global by nature, but every selector
  that *uses* it must still be scoped.

## `--bansho-flaw` — how much of a hand the board has

A real board is not clean and a real hand does not track a ruler. One
token controls all of it:

```css
.bansho-board-surface {
  --bansho-flaw: 1;
}
```

| Value | What the board looks like |
|---|---|
| `0` | Perfectly clean. Every block square on the ruler, no chalk grain. Byte-for-byte the board of before this token existed. |
| `1` | The default. Each block sits at its own fraction of a degree, each word drifts a hair off the line, the slate carries grain and the smears a cloth leaves. |
| `2`–`3` | Deliberately overdone — useful to SEE what the token does before choosing a value between. |
| above `6` | Capped. |

Two things worth knowing before you tune it:

- **It is content-seeded, never random.** The same lecture leans the same
  way on every reload, in every screenshot and in every export. Two blocks
  with identical text lean identically; at this amplitude nobody can see
  it.
- **It is paint-time, and only paint-time.** The writing leans where it
  already stood, so line breaks, timings, the board's height and the ink
  measured onto the writing are exactly what they were at `0`. Turning it
  up cannot make a board overflow or a paragraph re-wrap.

Reach for `0` when the board is a reference someone will read closely, or
when a very small viewport makes every pixel count. Otherwise leave it
alone — it is the difference between a board and a slide.

## What themes do not do

Themes recolor; they do not re-layout. Font sizes, spacing, line heights
and the writing rhythm are the board's own — overriding them shifts
measurements the performance depends on. If a board needs bigger writing
or a different shape, that is a request for the mode itself, not a theme.

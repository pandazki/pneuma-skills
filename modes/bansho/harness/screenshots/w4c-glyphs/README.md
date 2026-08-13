# W4c — the glyph sweep, the chip that names, and the air around a unary plus

Shot on a dedicated dev server (backend 18601, Vite 18002, own Chrome profile
on CDP 19333, workspace `~/bansho-w4c`, dark theme) against a scratch content
set built for the sweep. Before and after are the SAME frame of the same
board, captured in one browser process.

## The instruments

A font-family check answers about the family and never about the glyph
(G8-A), so neither instrument is one:

1. **The faces' own `cmap` tables**, parsed off disk. The parser was
   validated against W4b's published counts before it was trusted —
   Chalkboard SE **1056** codepoints, Bradley Hand **1505**, exact match —
   then run over HanziPen SC (29184) and PingFang SC (35854).
2. **CDP `CSS.getPlatformFontsForNode`** on the live board, which names the
   face the rasterizer actually picked, plus `measureText`'s advance and
   `actualBoundingBox*` ink extents at 40px.

The number that decided every case is **fill = ink ÷ advance**.

## The sweep — dark stack `"Chalkboard SE", "HanziPen SC", "Bradley Hand", "Segoe Print", cursive`

| glyph | Chalkboard / Bradley | drawn by | advance | ink | fill | decision |
|---|---|---|---|---|---|---|
| `∣` U+2223 | no / no | HanziPen SC | 41.2 | 2.3 | **0.06** | → `\|` U+007C |
| `⋅` U+22C5 | no / no | HanziPen SC | 12.6 | 4.4 | 0.35 | → `·` U+00B7 |
| `−` U+2212 | no / yes | HanziPen SC | 32.0 | 27.8 | 0.87 | → `-` U+002D |
| `→` U+2192 | no / no | HanziPen SC | 41.2 | 37.2 | **0.90** | LEAVE |
| `←` U+2190 | no / no | HanziPen SC | 41.2 | 37.2 | 0.90 | LEAVE |
| `∥` U+2225 | no / no | HanziPen SC | 41.2 | 21.2 | 0.52 | LEAVE |
| `∴` U+2234 | no / no | HanziPen SC | 41.2 | 26.0 | 0.63 | LEAVE |
| `×` U+00D7 | no / yes | HanziPen SC | 20.6 | 16.5 | 0.80 | LEAVE |
| `′` U+2032 | no / no | HanziPen SC | 10.9 | 6.8 | 0.63 | LEAVE |
| `⋯` U+22EF | no / no | **Kaiti SC** | 40.0 | 30.8 | 0.77 | LEAVE + named |
| `⊂` U+2282 | no / no | **Apple Symbols** | — | — | — | LEAVE + named |
| `— – … · ÷ ≈ ≤ ≥ ∞ √ ± ≠ § \| -` | yes | Chalkboard SE | — | — | — | already the hand |

`→` and `∣` share a face and an advance and get opposite verdicts, which is
the whole finding: the full-width slot was never the defect. `∣` is a 2.3px
hairline adrift in it; `→` fills 0.90 of it, from a face the board itself
declares, beside CJK neighbours drawn at exactly that width by exactly that
face. There is also no honest alternative — no arrow codepoint exists in
either hand face, and `->` is two codepoints and a different mark.

## Frames

| File | Shows |
|---|---|
| `01-before-prose-arrow.jpeg` / `05-after-prose-arrow.jpeg` | 「一句话：先验 × 似然 → 后验。」 and 「有病的：100 人 → 阳性 99 人。」 at t = 10.8 s. **Identical by design** — the arrow and the `×` were left exactly as the author wrote them. |
| `02-before-symbol-sweep.jpeg` / `06-after-symbol-sweep.jpeg` | The whole symbol line. After: 点乘 `⋅` is now the same chalk dot as 中点 `·` beside it; 减号 is the pen's own short dash instead of HanziPen's long thin rule; 竖线 `\|` sits tight against the character before it instead of floating in a full-width slot. 平行 `∥` and both arrows are unchanged, as decided. |
| `03-before-formula-unary-plus.jpeg` / `07-after-formula-unary-plus.jpeg` | `P(D \mid +) = \frac{P(+ \mid D)\,P(D)}{P(+)}`. Before: `P( + )` — a full thick space on each side of every `+`. After: `P(+)`, tight, while the `\mid` keeps its relation spacing. The formula's measured width falls **519 → 475 px** (−8.5%), exactly the 3 operators × 2 sides × 7.4 px the operator dictionary was adding. |
| `04-before-operator-cases.jpeg` / `08-after-operator-cases.jpeg` | The four control formulas stacked: `a + b - c`, `(a + b) - c`, `-x + y`, `n! + m`. Measured widths **175 / 206 / 128 / 125 px before and after** — every genuinely infix operator kept its air. |
| `09-after-chip-names-glyphs.jpeg` | The §6.4-A chip naming characters: `handwriting font fallback: ⋯ ⊂` — the two glyphs on that board that no declared family covers, independently confirmed in the cmap tables. |
| `10-after-chip-blind-trial-stack.jpeg` | The blind trial's own failure reproduced: the seed's `--hand` with `HanziPen SC` deleted (findings §2.1). The chip now reads `handwriting font fallback: 字 形 巡 检 一 句 话 ： +49` — a CJK list is a five-second diagnosis of a missing CJK family, where "handwriting font fallback" alone sent that author to `document.fonts.check` and then to giving up. |

## Duration — both open questions, one A/B

`aria-valuemax` on the timeline track, read only after the active content set
matches AND the value has repeated twice (a fixed sleep gives readings off a
half-compiled board; that is what produced the 79.0 / 79.8 noise on an early
pass).

| board | HEAD | with W4c | substitutions off entirely |
|---|---|---|---|
| glyphs | 14.5 s | 14.5 s | 14.5 s |
| pitch | 81.8 s | 81.8 s | 81.8 s |
| bayes | 519.4 s | 519.4 s | 519.4 s |

The third column also closes **W4b's open question**: its own width change is
the substitution table, so turning the table off is the A/B it left unrun.
Zero, on a 519 s board built around `\mid` formulas. Beat lengths are
content-derived (`clipWipe` carries the plan's duration through as
`naturalDuration`); glyph width feeds layout and `fitMathToBox`, never the
clock.

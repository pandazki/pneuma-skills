# T5 seeds — G7 visual verification artifacts

Captured against the real viewer, one scratch workspace per seed board
(`bun bin/pneuma.ts bansho --dev --viewing --workspace <scratch>`, Vite dev
server, 1440×1000 @ DPR 2, chrome-devtools screenshots). Timestamps are the
transport clock in each frame.

> **Read frames 13–17 first.** Frames `00`–`12` were shot with the seed's
> `board.md` + `theme.css` copied to the workspace ROOT, which is **not the
> layout `init.seedFiles` installs** — the shipped config copies each seed
> into `tech-zh/` / `pitch-zh/`, making it a CONTENT SET and routing the
> opening through the async content-set matcher. That difference is exactly
> where the round-2 blocker lived (the board joined at its tip and never
> performed), so no root-copied frame can stand as evidence for the shipped
> configuration. Frames `13`–`17` are shot through the real gallery path
> (`POST /api/seeds/apply`) and are the acceptance set; the earlier frames
> are kept for the per-behaviour details they document, which the fix does
> not touch.

The round-2 seed reword shortened tech-zh: the totals are now **tech-zh
91.8 s**, **pitch-zh 70.7 s**, matching what `buildTimeline` computes in
`seeds.test.ts`, so the frames and the compile-layer assertions are looking
at the same schedule. The reworded sentence is the last prose line, so the
`00`–`12` timestamps still point at the same moments up to `08` (78.8 s).
One exception: `06`'s `@strike` executes AFTER that line in document order,
so its moment shifts ~0.3 s earlier (87.7 → ~87.4 s).

> **Frame `06` is partially STALE — read it only for what survives.** Its
> script pane shows the pre-reword closing sentence (`它不是错在结论，是错在
> 悄悄假设了两个不存在的前提：…`, superseded by `13`) and the pre-a873465
> x unit `(机器数)` (now `(台)`). What it remains valid evidence FOR: the
> 先立/再驳/后划 mid-stroke camera turn and the per-line `==…==` band split
> — those behaviours are position-independent and unchanged by the rewords.
> What it must NOT be read for: the adjacent-circle punctuation clearance
> (its `、` evidence is superseded twice over — first by the reword, then by
> the round-3 circle-overshoot fix; see frames `18`–`21`).

## Acceptance set — shot through the real seed-apply path

Empty workspace → `POST /api/seeds/apply {"sourceKey":"modes/bansho/seed/<id>/"}`
→ the seed lands in `<id>/` as a content set → the board performs. Nothing
was pre-copied; nothing but the transport was touched.

| File | Proves |
|------|--------|
| `13-tech-zh-dark-end-seeded.jpeg` | **tech-zh × dark**, end state, seeded. Chart accumulation, both annotation clusters, hand-drawn heading baselines, rule, aside. The closing sentence now reads `错的不是结论，是它藏着的两个前提：一是 ((串行段为零))，二是 ((协调不要钱))。` on ONE line — the `，` between the two circles survives (three glyphs sit between the two ink targets, well clear of the 2×14 px tip overshoot that erased the old `、`) and the final `。` is no longer orphaned onto a line of its own. x axis reads `(台)`. |
| `14-tech-zh-light-end-seeded.jpeg` | **tech-zh × light**, seeded. White board, black ink, `--hl` yellow band, light series tokens, the seed's light `--hand` stack (Bradley Hand first) live. Replaces the stale `02`, which still showed the pre-fix colon. |
| `15-pitch-zh-seeded-live-mid.jpeg` | **The blocker, closed.** A board applied from the seed gallery, caught mid-performance at **21.8 s / 70.7 s** with the transport LIVE and the pen part-way through a list row — not a scrub, not a replay. Before the fix this same path produced a fully-written board in one frame. |
| `16-pitch-zh-dark-end-seeded.jpeg` | **pitch-zh × dark**, end state, seeded. 对比 chart (月发 flat, 日发 falling, `mark 24 分钟`), the closing `@circle`, rule, aside. |
| `17-pitch-zh-light-end-seeded.jpeg` | **pitch-zh × light**, seeded. Same board under the light tokens; the script pane shows the `(月)` x unit. |

**Transport sampling, before and after** (250 ms samples, from the moment
the seed lands). Round-2 review, on the shipped layout:

```
0.0s/0.0s   0.0s/0.0s   92.1s/92.1s   92.1s/92.1s  …   ← joined at the tip
```

Same path, same method, after the fix:

```
0.0s/0.0s  0.0s/0.0s  0.0s/0.0s  0.0s/0.0s  0.0s/91.8s  0.3s/91.8s
0.5s/91.8s  0.8s/91.8s  1.0s/91.8s  1.3s/91.8s  …  11.3s/91.8s
```

and pitch-zh, independently: `0.0s/0.0s ×4 → 0.1s/70.7s → 0.3 → 0.6 → 0.8
→ 1.1 → 1.3 → … → 10.3s/70.7s`. Monotonic from 0 in both — the duration
appears first, then the playhead walks it.

## Earlier frames — root-copied layout, per-behaviour detail

| File | Proves |
|------|--------|
| `00-tech-zh-t0-blank.jpeg` | t = 0: the board is **fully blank** before the pen arrives (R1 fail-closed) while the whole 讲稿 already sits in the script pane with its dialect marks tinted. Also the readable inventory of tech-zh's source. |
| `01-tech-zh-dark-end.jpeg` | **tech-zh × dark**, end state. Chart accumulation (串行占比 curve, then 相干开销 turning over past n=32, `mark 峰值`), both annotation clusters inked, hand-drawn heading baselines, `---` rule, aside. |
| `02-tech-zh-light-end.jpeg` | **tech-zh × light**. White board, black ink, `--hl` yellow band, light series tokens — the seed's light `--hand` stack (Bradley Hand first) live. Chrome flips to light `cc-*` tokens with it. |
| `03-pitch-zh-dark-end.jpeg` | **pitch-zh × dark**, end state. 对比 chart (月发 flat, 日发 falling, `mark 24 分钟`), the closing `@circle` around the conclusion, rule, aside. |
| `04-pitch-zh-light-end.jpeg` | **pitch-zh × light**. Same board under the light tokens. |
| `05a-tech-zh-formula-before-30.2s.jpeg` | **公式左→右展开**, and the bug the walkthrough found. The block is cut mid-reveal (`S(n) = 1/(1-p)` written, `+ p/n` not yet) so the left→right order is real — but it is *already* ~90% written at 43% of the beat. Measured cause: the clip window is a percentage of the HOST, and a block-level `<math display="block">` host was **994 px** wide around a **229 px** formula, so the sweep spent 38% of the beat left of the first glyph, 38% right of the last, and the formula visibly wrote during ~18% of its own reveal. G6 holds throughout: the script pane highlights exactly the `$$…$$` line. |
| `05b-tech-zh-formula-after-30.2s.jpeg` | The same board, same t = 30.2 s, after the host was shrink-wrapped (`width: fit-content` + auto inline margins). The formula is now **43.7% written at a 43.66% clip** — the reveal uses the whole beat instead of popping in the middle third — and stays centered (measured host 229 px, hug 100%, centre offset 0 px; second formula 408 px, same). |
| `06-tech-zh-backref-strike-87.7s.jpeg` | **先立、再驳、后划**, mid-stroke: 80 s after the claim 「慢了就加机器」 was written plain, and after the whole rebuttal has been argued, the camera turns UP to it and the strike is **half drawn** (it covers 慢了就加机 and has not reached 器). The script pane highlights the `@strike` directive line. Also in frame: the `==…==` band over a sentence that wraps, **split per line** (§6.4-B) instead of one giant box; the §4.3 align group with its visible spacers; two circles on adjacent lines, no collision. |
| `07-tech-zh-ink-waits-78.0s.jpeg` | I2: the annotation-dense paragraph's **text is fully written and none of its ink has landed yet** — the marks wait for the sentence to finish. |
| `08-tech-zh-ink-single-pen-78.8s.jpeg` | **G1 in one frame**: 0.8 s later the first circle (串行占比) is finished, the second (相干开销) is **just starting**, and the highlight on 机器数本身 has not begun. One pen — never two marks in progress. |
| `09-pitch-zh-align-and-arrows.jpeg` | **并列三点** with the column actually doing work: labels 频率 / 每次改动量 / 回滚 differ in width, so the value column only lines up because of the §4.3 spacers. Same frame: the arrow chain 提交 → 自动测试 → 灰度 10% → 全量, the two-line `**…**` underline split per row, and the in-place circle on 十分之一的事故. |
| `10-pitch-zh-dark-top.jpeg` | The head of pitch-zh in dark: the `==…==` band wrapping across two lines, the align group, the arrow chain — the light-theme evidence of `09` repeated on the chalkboard. |

## G8-A — the handwriting font, measured, not assumed

`document.fonts.check()` is worthless here and this is the receipt. Measured
in-page with `canvas.measureText("板书手写字宽验证样本")` at `28px`, on the
running viewer, once per theme:

```
HanziPen SC                        288.4 px
PingFang SC     (known fallback)   280.0 px
Hannotate SC    (the banned face)  280.0 px   ← identical to PingFang: it
__no_such_font__ (generic baseline) 280.0 px      silently does not load

board --hand stack (from the seed's theme.css)
  dark  "Chalkboard SE", "HanziPen SC", …      288.4 px   ⇒ HanziPen SC
  light "Bradley Hand",  "HanziPen SC", …      288.4 px   ⇒ HanziPen SC

document.fonts.check("28px '…'")   HanziPen SC → true
                                   Hannotate SC → true   ← the lie
                                   __no_such_font__ → true ← still the lie
```

The board's own computed stack measures at HanziPen SC's width in both
themes, so the CJK handwriting face is really what renders — and
`Hannotate SC` measures at exactly the fallback width, which is why the
seed's `theme.css` bans it. The viewer's `handwriting font fallback` chip
was absent throughout, consistent with the numbers.

**Round 2 — the runtime check now does what this receipt did.** The measured
stack above came from a hand-run in-page measurement; the shipped probe
compared a hardcoded `HanziPen SC` and never read the board's computed
`--hand`, so a seed could still have walked the trap back in. `probeEnvCaps`
now reads `--hand` off a `.bansho-board-surface` probe element (both theme
variants) and measures those stacks verbatim, and the chip re-measures when
the board's `theme.css` changes — a seed's stylesheet lands well after
`document.fonts.ready` on the gallery path. The chip was absent in all five
acceptance frames (`13`–`17`), which is now a statement about the seeds'
own stacks rather than about `HanziPen SC` in the abstract.

## Round-1 amendments (two seed copy-edits)

Frames `01`–`10` above were shot before two review fixes to the seed source.
Neither changed the schedule at the time — `buildTimeline` still computed
**92.05 s** for tech-zh and **70.71 s** for pitch-zh — but two of those frames
show text that has since changed. (The round-2 reword has since taken tech-zh
to **91.78 s**; `11`'s closing sentence is superseded by `13`.)

| File | Proves |
|------|--------|
| `11-tech-zh-colon-fixed-dark.jpeg` | The fullwidth colon before `((…))` is legible again. In `01` the ellipse's left tip lands on the two dots of `：` and the sentence reads as if it lost its punctuation (measured on the live board: the colon's box is 26.8 px wide and the circle path started inside it). With one space between `：` and `((`, the colon clears the tip — 763.9→790.7 px for the glyph box against a path starting at 787.2 px, and the second passage 1031.8→1058.5 px against 1053.7 px, i.e. the tip now grazes the box's right edge instead of the ink. Same board, same theme, same end state as `01`. |
| `12-pitch-zh-axis-unit-dark.jpeg` | pitch-zh's x axis now declares `(月)` instead of the scenario label `(试点)` — the unit slot every other axis in both boards fills with a real unit. Only the **x** unit changed and only the y unit is drawn on the board (`chart.ts` appends `frame.y.unit` to ticks and series labels; the x unit is parsed and never rendered), so the board pixels are identical to `03` — the visible change is in the script pane, which is what the agent reads as its few-shot 范文. |

## Round-3 amendment — circle overshoot scales with font size (frames 18–22)

The circle's fixed ±14 px horizontal overshoot (an opaque 2 px stroke) landed
its tip on the glyph following a `((…))` span at the board's 26 px font —
CJK punctuation (`；，。`) keeps its ink exactly there, and the acceptance
frames show it being visually eaten (`06`: the `；` after `((20 倍))` is
GONE; `13`/`14`: the `，`/`。` around the closing circles crossed; `17`: the
left tip cutting into 都). The overshoot is now `fontSize × 0.22`
(`ink.ts::inkRowShapes`), so **every circle in frames 06/13/14/16/17 is
superseded in geometry** (tighter tips, same everything else). Re-shot
through the seed-apply path, light theme, end state:

| File | Proves |
|------|--------|
| `18-tech-zh-light-end-circle-overshoot-fix.jpeg` | tech-zh full end state with the new circle geometry, seeded, 91.8 s. |
| `19-tech-zh-20bei-semicolon-survives.jpeg` | Zoom of `((20 倍))；` — the `；` frame `06` showed erased is back, clear of the tip. |
| `20-tech-zh-closing-line-comma-period-survive.jpeg` | Zoom of `一是((串行段为零))，二是((协调不要钱))。` — both the `，` and the terminal `。` legible beside the tips. |
| `21-pitch-zh-circle-left-tip-clears.jpeg` | Zoom of `都((小到不值得开会))。` — the LEFT tip no longer cuts through 都 (compare `17`). |
| `22-env-chip-light-scoped-hannotate.jpeg` | G8-A guard live: a light-scoped `--hand: "Hannotate SC"` override in the seed's `theme.css` now raises the `handwriting font fallback` chip (before the `THEME_VARIANTS` fix the light-scoped stack was never measured); reverting the override clears the chip. |

## Regenerating

Regenerate through the **seed-apply path**, never by copying files into the
workspace — a root copy exercises a different code path (no content set, no
async matcher, no prefix-keyed theme lookup, no BoardCanvas remount) and is
what let the round-2 blocker ship with a full evidence set attached.

1. `mkdir` an **empty** scratch workspace and run
   `bun bin/pneuma.ts bansho --dev --viewing --workspace <scratch> --no-open --no-prompt --port <p>`
   from the repo root. (If `dist/index.html` exists the server silently runs
   the stale production bundle — `--dev` is not optional here.)
2. Open `http://localhost:17996?session=<id>&mode=bansho&layout=app` (the id
   is printed as `[pneuma] ready …`) and resize to 1440×1000.
3. From the page, `fetch("/api/seeds/apply", { method: "POST", body:
   JSON.stringify({ sourceKey: "modes/bansho/seed/tech-zh/" }) })` — the same
   call a gallery card click makes. Sample the transport clock on an interval
   across the apply if you are re-proving the live-join behaviour.
4. Drive the transport by dispatching a `pointerdown` on
   `[role="slider"][aria-label="Timeline"]` at `left + (t / duration) × width`.
   Theme is server state: `POST /api/user-theme` then dispatch
   `pneuma:theme-changed` on `window`.

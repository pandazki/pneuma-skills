# W2c — two things a person would never write

Same browser process throughout (`harness/cdp.mjs` on its own port and
user-data-dir, its own dev server), viewport **1600x1100**, dark theme, the
four-board `bayes` wall. BEFORE was captured FIRST out of the unmodified
working tree and the browser kept alive across the whole implementation.

| Frame | What to look at |
|---|---|
| `01-before-wall.jpeg` | Zoomed out to `cameraMinZ` (0.4). The wall (2516x1820) is smaller than the viewport gives it at that zoom and sits hard against the TOP-LEFT with dead room right and below. Board 2's aside reads 「…六分之一是真的」 / 「。」 — **a full stop alone on its own line.** |
| `02-after-wall.jpeg` | Same zoom, same content. The wall hangs in the MIDDLE of the space it has on both axes, and the aside reads 「…六分之一是」 / 「真的。」 |
| `03-after-board2-closeup.jpeg` | That aside at 1x — the mark sits on the line it belongs to. |
| `04-after-board1-closeup.jpeg` | Board 1's opening line, 「一句話：先验 × 似然 → 后验**。**」 — the welded residual itself, the case the brief named. |

## The measurement behind the frames

Punctuation-only `.bansho-w` boxes on this wall, before → after:

```
194 spans, 14 of them a bare mark   ->   182 spans, 2 of them a bare mark
                                          both welded into a .bansho-nobr group
orphaned marks (a mark whose line differs from the word before it):
  1600x1100:  2  ->  0
  1180x900 :  -  ->  0
  1000x800 :  -  ->  0
```

The twelve that disappeared are the segmenter's work (the mark merged into
the word it terminates). The two that remain are the residue no segmenter
can reach — `**先验 × 似然 → 后验**。` and `**30%**：`, where the mark is its
own RUN — and each is welded to the box before it, `[后验][。]` and
`[30%][：]`, inside the ink wrapper so document order never moves.

## The strips: no box moved, and the ink moved by the ruler's own resolution

`layout-baseline/`'s protocol, run as its own same-session A/B on
`fourier` / `kelly` / `brain` (board **and** notes legs):

| | fourier | kelly | brain |
|---|---|---|---|
| rows | 52 | 30 | 22 |
| `x` / `w` / `h` / `margins` / `y` changed | **0** | **0** | **0** |
| board height | 5293 → 5293 | 3199 → 3199 | 2253 → 2253 |
| ink rows changed | 9 | 4 | 3 |
| max \|Δ\| in any `d` | **0.02px** | **0.02px** | **0.02px** |

Not one box moved: no re-wrap, no re-flow, no measurement change — which is
the strong claim, because the segmentation feeding those boxes DID change.
What moved is ink drawn OVER text, by at most 0.02px, and that is the
instrument's own resolution (the probe rounds every reading to 0.01px;
`layout-baseline/README.md` calls 0.01 "the instrument's resolution, not a
tolerance"). It is also exactly what a merge predicts: one box for 「阳性。」
does not have byte-identical advance to two boxes 「阳性」+「。」, so the row
union the ink is drawn from lands a hundredth of a pixel away.

**The residual is attributable, and that was checked rather than assumed.**
Two controls in the same browser process, after the change:

```
capture -> re-capture, nothing whatever varied          BYTE-IDENTICAL
capture -> resize 1600->1180->1600 -> capture           BYTE-IDENTICAL
```

So the instrument was stable to the byte in this session, and neither the
repeat nor a resize round-trip can account for the 0.02px — it belongs to
the change, and it is bounded by the ruler.

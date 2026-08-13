# `bayes` — 一张「99% 准确」的阳性报告

Playback frames from the `bayes` content set (`~/bansho-boards/_all/bayes/`),
shot against a live viewer session on a dedicated dev server (backend 18055,
Vite 18056, own Chrome profile on CDP 19222, workspace `~/bansho-boards/_all`,
dark theme).

The lecture teaches base-rate neglect by counting people before it writes a
single symbol: 10,000 people, 1-in-1000 prevalence, a 99%/99% test, 10 true
positives against ~100 false positives, so a positive report means ~9% — not
99%. The Bayes formula arrives late, as shorthand for the counting; the
lecture then refuses the over-correction ("so the test is useless") by
counting a second time, and closes on where the same shape recurs.

**Compiled duration: 547.3 s, silent** (was 403.0 s until the 2026-08-11 depth
pass below) — measured from the player readout,
with `glance-board` reporting basis `measured: "complete"` over 118 steps.
Grown from 205.5 s / 61 steps by deepening in place; this board had never been
performed for a user, so the append-only discipline did not bind.

| Frame | Moment | Why it matters |
|---|---|---|
| `01-stake-the-wrong-answer.jpeg` | §0 | The wrong intuition stated in the reader's own voice, with the reasoning step that produces it spelled out — and the fact that clinicians asked this question answer it the same way. It has to be *staked* before the lecture can knock it down. |
| `02-both-counts-one-board.jpeg` | §3 step 6 | Both counted groups in one picture: the `一万个人做完检查` graph is declared with the sick branch alone, then a second same-name block adds the healthy branch, so `报阳性 10 人` ends up directly above `误报阳性 100 人`. **This frame was captured parked at the graph, and the "held comparison" claim it once carried was wrong — see the closed finding below.** |
| `06-before-verdict-on-a-blank-board.jpeg` | §3, played, 151.7 s | Why the comparison did not land. The board was full when the graph finished, so the room turned, and 「假阳性的人数，是真病人的十倍。」 — the sentence that names the comparison — was written **alone on a blank board** with both counts out of frame. |
| `06-ten-against-a-hundred.jpeg` | §4 「十个，和一百个」 | The repair. Two counts measured on one vertical scale (`0 .. 110 (人)`) instead of spelled as digits: 10 on the floor, 100 at the ceiling, the climb marked `十倍`, the inked verdict directly under the picture, and a `@wait` after it so the camera cannot walk off first. |
| `03-strike-lands.jpeg` | §4 step 7 | The restated wrong answer with the strike-through ink visibly drawn. Re-shot after the fix recorded below; the placement also keeps target and strike on the same panel. |
| `05-second-test-91.jpeg` | §6 | The over-correction refused: retest the 110, count again — 10 true positives against 1 false positive, 10/11 ≈ 91%. Same machine, same two 99%s, a smaller denominator. |

## Verification notes

- `check-board`: `ok: true`, **zero findings**.
- `glance-board`: §3's graph board and §4's strike board are each entered
  through an explicit `@erase "anchor"` + `@turn`, so the room takes a board
  that is spent instead of choosing one for itself. Both were re-captured
  after the final edit and verified by eye (frames 02 and 03).
- **The one cross-board back-reference was removed, on teaching grounds.** The
  draft had `@focus "报阳性的一共 110 个人"` in the formula section, walking the
  camera back to §3's graph board. On a 4-board wall a 400 s lecture wraps the
  room repeatedly, and by the formula section that board is roughly four fills
  back: played, the camera did not move. It is now `@overview` — at the moment
  the formula is revealed as shorthand for counting, the lecture steps back so
  the struck-out wrong answer and the formula stand in one view. That gesture
  cannot be broken by any wall geometry.
- **Handwriting on formulas holds** (unchanged from the previous pass): the
  `--hand` stack is computed on `.bansho-math-block`, the KaTeX span and the
  `<math>` element. Dark theme resolves the Latin hand to Chalkboard SE, an
  upright chalk face — the theme's font stack, not a typeset fallback. Light
  theme not re-shot.
- **No narration shipped.** One credential attempt this pass, as instructed:
  `~/.pneuma/api-keys.json` → `FAL_API_KEY` (92 chars, no `key_id:secret`
  colon shape) is still rejected by `fal-ai/gemini-3.1-flash-tts` with
  `401 … Authentication is required to access this application`. The board
  ships silent rather than faked, and no `narration/manifest.json` was written
  — a manifest with missing clips would raise `narrationClipMissing` and cost
  the zero-findings result.

## Closed finding — the strike does not visibly land (fixed 2026-08-11)

**Symptom as recorded here:** `@strike "我大概有 99% 的可能，是真的病了"`
resolved (`check-board` clean, `navigate-to` naming the step `correction of
earlier writing`), yet in two independent frames — mid-playback at 117.6 s and
parked at the step boundary at 109.4 s — the restated sentence stood with **no
strike-through ink on it**, while the board's other 118 ink SVGs drew normally.

**Not the suspect named at the time.** The freshly-turned board is a red
herring: `measureBackRef` already resolves its target's panel (C3), and a
strike whose target stands on a *different* board inks correctly — pinned now
by `backref-ink.test.tsx`'s "a plain cross-board strike lands on its target's
board", which is green on the pre-fix commit too.

**Actual cause:** the P1-1 guard added in `c60eb48` re-derived the fold's
orphan rule inside the viewer, from the document-**final** `eraseOps` list. It
therefore asked "was this run erased *anywhere* in the document?" instead of
"was it *already* erased when the ink arrived". This lecture erases the board
carrying the restatement further down, so the strike — drawn while its target
stood — was vetoed. Ordering is the whole distinction, and the fold already
computes it (`BoardLayout.orphaned`, one ordered forward pass). The seam now
reads that verdict instead of re-deriving one.

All four gestures shared the defect; `@erase` before the ink still refuses,
still degrades inert, still reports `inkAfterErase`.

Verified on this board, same window, same content: pre-fix the annotation node
mounts with an **empty stroke overlay**, post-fix it carries its path and the
line lands on the restated sentence. `03-strike-lands.jpeg` is a post-fix
frame of the rewritten lecture — the ink there is the fix's, not the
rewrite's, and the rewrite should not be read as having cured it.

## Environment caveat

This pass ran while the engine/viewer fix above was landing. A Vite HMR update
to `BoardCanvas.tsx` remounted the viewer mid-session and silently reset it to
a different content set — the readout then showed `82.3s / 82.3s`, which is
the `brain` board's duration, not a truncated `bayes`. Every frame here was
re-confirmed on `bayes`; if a frame ever disagrees with the script pane beside
it, check the set switcher before believing the board.

## Closed finding — the comparison did not land, and the earlier fix missed why (2026-08-11)

An independent acceptance pass reported that 10 sick vs 100 false positives
never read as a direct comparison at 1x. The previous pass had put both counts
into one graph on one board and believed that closed it. Played back, it did
not: `06-before-verdict-on-a-blank-board.jpeg` is 151.7 s of the pre-fix board —
the graph board filled right after the second `graph` block, the room turned,
and the sentence naming the comparison landed on a **blank** board. The counts
and the verdict were never in one frame. A capture parked at the graph step
(frame 02) cannot see this; only playback can.

Two things changed. The verdict moved onto its own movement, 「十个，和一百个」,
entered through the existing `@erase` + `@turn` so it starts on a spent board.
And the counts stopped being digits: a `两堆人` chart puts both on one
`0 .. 110 (人)` axis, so the swamping is a HEIGHT — `+ note @ 真病人 , 10` on
the floor, the series' own end label at the ceiling, `+ mark … : "十倍"` on the
climb. `@wait 3` after the inked verdict holds the finished frame before the
next `@turn` walks the camera away.

Same pass, the lecture grew 403.0 s → 547.3 s by deepening the numerical beats
(the 9.9-person rounding, the two denominators inside "99% 准确", the formula's
numerator and denominator as separate steps, the 1% multiplier in the retest,
the airport gate counted like the main problem, the prevalence curve read at
both ends). `check-board` clean, 165 steps, `glance-board` basis `measured`.

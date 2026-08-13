# Layout baseline — the C1 degradation gate

These JSON files are the **pre-C1 instrument**: the exact geometry the board
produced when the viewport was a native scroll container, before the stage
camera took over. C1's central promise is that a board with no camera
instructions renders **identically** — this is what "identically" is measured
against.

## What is in a file

Per mounted step (`[data-bansho-ref]`, document order):

| Field | Why it is here |
|---|---|
| `rect` | `[left, top, width, height]` **relative to the board origin, divided by the live scale**. Board-relative kills translation, so a camera pan cannot pollute it; the scale divide kills zoom. Under a correct C1 these numbers are camera-invariant by construction. |
| `paths` | Every `svg path`'s raw `d` string. This is the sharp edge: ink geometry is *measured* at build time, so a sub-pixel drift in any measurement rewrites `d`. Exact string equality. |
| `svgs` | Each overlay's `viewBox` + inline `left/top/width/height` — catches an overlay that moved without its path changing. |

Plus `scale` (must read `1` whenever the camera is at rest), `boardLayoutWidth`
/ `boardLayoutHeight` (`offsetWidth`/`offsetHeight` — layout values, which a
CSS transform must never change), and `stepCount`.

## How to use it: A/B **inside one browser session**

The noise floor is zero *within a session* and only within a session. Both
halves of the comparison must be captured back-to-back in the same browser
process, with no app-state changes in between:

```bash
# 1. capture the branch under test
modes/bansho/harness/capture-layout.sh /tmp/after
# 2. same browser, same session — swap the code and capture again
git checkout <baseline-commit> && <restart the dev server> && reload the page
modes/bansho/harness/capture-layout.sh /tmp/before
# 3. compare
for f in fourier kelly brain; do cmp /tmp/before/$f.json /tmp/after/$f.json; done
```

Measured 2026-08-09 under that protocol: pre-C1 (`9a66293`) and post-C1
captures are **byte-identical on all three boards**, as are two captures of
unchanged code, as are captures either side of a resize-driven
`invalidateMeasurements` rebuild. Sketch jitter is a seeded `mulberry32` and
layout is deterministic, so:

> **Within a session, any diff at all is a regression.** Do not add a fuzz
> factor to make it pass.

**Across sessions it is NOT byte-stable, so never diff today's capture against
a committed file from another day.** Observed the same day: after a batch of
browser experiments (a persisted-theme round-trip, a zoom, a synthetic
resize), 11 of fourier's 48 ink paths came back shifted ~3px horizontally —
with every step rect, the board height, and all line positions **identical**,
which rules out re-wrapping or a font-family change and points at glyph
rasterization state. Root cause not identified; it is a property of the
harness environment, not of the board (the same code re-captured in a clean
session reproduces exactly).

That is why the committed JSON is a **reference snapshot** — good for step
counts, path counts, board dimensions, and eyeballing structure — while the
authoritative gate is the same-session A/B above.

## Capture conditions (all of them matter)

- Boards: `~/bansho-boards/_all` — content sets `fourier`, `kelly`, `brain`
  (52 / 30 / 23 steps; between them they exercise chart, graph, strike,
  circle, highlight, aside bar, formula, align groups and back references).
- Browser viewport **1600×1100**, board layout width **1076**. Width feeds
  every wrap decision, so a different viewport produces a legitimately
  different — and useless — baseline.
- App theme **light**. The dark stack names a different font face, so it is a
  separate measurement universe; it is guarded by `theme-remeasure.test.tsx`
  plus post-change visual check rather than by a second baseline.
- Wait for `fontsReady` and the rebuild to settle (the script sleeps 6s per
  board) — capturing early measures the fallback face.
- Fresh page load for each side of the A/B, and **no app-state changes between
  the two captures** (see the cross-session caveat above).

## A dead end, recorded so nobody re-walks it

"A resize-driven rebuild produces different ink than a fresh build" looked
true and is **false**. It came from comparing a post-resize capture against a
committed file from an earlier session — the cross-session drift above, read
as a resize effect. Captured properly (before and after a resize cycle in one
session) the two are byte-identical, on both pre-C1 and post-C1 code.

The general lesson, which is the reason this paragraph exists: with an
instrument this sharp, **every comparison must vary exactly one thing.** A
diff against a stored artifact varies the code *and* the session.

## Refreshing the committed snapshot

Refresh it **only** when a change is meant to move ink, or when the probe's
output format changes — and say which in the commit message. A silently
refreshed snapshot is the same as having no reference at all.

When you do refresh it, prove the refresh is honest the same way the
2026-08-09 one was: capture the comparison commit in the **same session** with
the **same probe** and show the two are byte-identical, so the refresh is
demonstrably a format change and not a quiet acceptance of moved ink.

## When ink is SUPPOSED to move: bound the blast radius

Some changes are meant to move ink — the 2026-08-10 handwritten-formula work
is the case in point. Then the gate's question changes from *"did anything
move?"* to **"did exactly the right things move, and nothing else?"**, and
that question is answerable because the three boards differ in what they
contain (`fourier` 22 `$`, `kelly` 22, **`brain` zero**).

Measured that day, same window, same probe, one board width:

| board | formulas | ink rows moved | rect rows moved |
|---|---|---|---|
| `fourier` | 22 | 1 | 30 |
| `kelly` | 22 | 2 | 19 |
| **`brain`** | **0** | **0** | **0** |

A formula-only change that leaves the formula-free board byte-identical, and
moves the other two only from their first formula onward, has a blast radius
equal to its intent. **That is a pass.** A change that also moved `brain`
would be a regression no matter how good the formulas looked.

**Two procedural notes that cost real time:**

- Run the "before" side from a **separate `git worktree`** at the comparison
  commit (symlink `node_modules`), not `git checkout` in the shared tree —
  a checkout destroys concurrent agents' uncommitted work. Find which Vite
  serves which tree by fetching a source file and grepping for the change:
  `curl -s localhost:PORT/modes/bansho/engine/factories/math.ts | grep -c MATH_JITTER`.
- **Both captures must share one browser window at one size.** A resize
  between halves changes the board width, which changes wrapping, which makes
  the comparison meaningless — it showed up here as `842` vs `1242` and
  invalidated the first attempt.

## The canvas pivot (V1): the re-basing protocol, and what it replaced

The 2026-08-11 canvas pivot moves every space-occupying step onto an
absolutely positioned box whose `y` comes from the fold, not from CSS flow
(design §7.5). The product owner's ruling that the long strip is a canvas too
**killed the degradation gate** — "a board that declares no placement renders
identically" was the mechanical proof C1/C2/C3 each leaned on, and the strips
are exactly the boards that now legitimately move. Design §12.2 replaces it
with five pieces of evidence that answer the section-above question: *did
exactly, and only, what the model says should move, move?*

**The instrument gained three things, in a commit of their own, BEFORE the box
model** — capture the "before" side with the *new* probe against the *old*
code, or the two sides are incomparable and there is no way back:

| Probe field | Answers |
|---|---|
| `margins` (`[marginTop, marginBottom]`, computed) | the §7.5 model's other input — `rect[3]` is the border box, so `h` and the margins must be separate numbers |
| `boardPadding` | the frame `rect` is quoted in, so "distance down the content face" (the fold) converts to "distance from the top edge" (`rect`) |
| `cls` | attributes a `y` delta to a KIND of block, not to a bare index |
| `$SET.notes.json` (the notes leg) | the **new control group**, below |

### The five pieces

1. **The notes projection is the surviving byte gate.** The notes view stays
   in CSS flow on purpose (design §8), so a notes diff can only mean the
   parser, one of the six factories, in-box ink or the measurement pipeline
   moved — none of which the box model may touch. If you find yourself
   changing notes rendering, stop: you are destroying the control group.
   *Today, on these three strips, `$SET.notes.json` is byte-identical to
   `$SET.json`* — they carry no stage verb at all, so both projections are
   one flow strip. That is the point: after the box model the board side
   becomes boxes and the two files must **diverge**, while the notes side
   stays byte-equal to its pre-V1 capture.
2. **`x` / `w` / `h` / `margin` unchanged, step by step.** Width unchanged ⇒
   wrapping unchanged; a re-wrap is this protocol's one-vote veto. Margins
   unchanged is also the precondition that makes 3a attributable.
3. **`y` is checked twice, and the two checks are not interchangeable**
   (`y-oracle.mjs`):
   - **3a — implementation fidelity.** New `y` == oracle, byte-exact, zero
     tolerance, **zero attribution**. Since 2 pins `h`/`margin`, a 3a delta
     can *only* be a positioning-engine bug. Never explain one away as a
     modelling difference — that inversion is the specific self-deception
     this split exists to prevent.
   - **3b — model fidelity.** Oracle vs the old capture's real CSS `y`.
     Margin-collapse corners and baseline effects live here, each delta
     attributed and recorded below.
4. **Box-relative ink is byte-identical.** `d` strings are recorded per box;
   the box moves, the ink rides along, and the `d` inside it must not change.
5. **Same-session visual A/B**, archived under
   `harness/screenshots/v1-canvas/{before,after}/`.

### 3b, measured 2026-08-11 (pre-V1 code, new probe)

Captures: `layout-baseline/pre-v1/` — the raw "before" side, kept because it
is the one artifact that cannot be re-taken once the box model lands.

```
bun modes/bansho/harness/y-oracle.mjs modes/bansho/harness/layout-baseline/pre-v1/{fourier,kelly,brain}.json
3b fourier: 47 flow boxes, 2 beyond ±0.02px   (6:-1 Δ −0.03, 6:6 Δ −0.03)
3b kelly:   29 flow boxes, 0 beyond ±0.02px
3b brain:   22 flow boxes, 0 beyond ±0.02px
```

**The §7.5 model reproduces today's CSS flow.** 98 flow boxes, two residuals
of −0.03px, both on the deepest board and both attributable to accumulated
probe rounding (each `rect` is rounded to 0.01 before the chain adds ~47 of
them) — not to margin collapsing, which the model reproduces exactly. No
fudge factor was added and none is needed.

Two modelling decisions the spec left open, decided from the data:

- **The first box keeps its own `margin-top`.** §7.5 says `y(first) = front`
  and `front = 0` on an empty board, which reads as "drop the first box's
  margin". CSS does not drop it — the board's padding blocks collapse-through
  — and dropping it would move every strip up by `mt(first)` for no reason.
  The oracle therefore chains `y(first) = mt(first)`. (`fourier` 0:-1 has
  `mt = 0`, so the strips do not discriminate; `bansho-step` headings with
  `margin: 26px 0 20px` would.)
- **Out-of-flow steps are not in the chain.** `bansho-backref` (and
  `bansho-ink`) are absolutely positioned overlays measured onto their target
  and `hidden` chart layers have no client rect; neither pushes anything
  down. Including them was the first oracle's only error and it cascaded a
  full board height.

### The V1 verdict, measured 2026-08-11 (box model landed)

Captures: `layout-baseline/v1-canvas/` — the "after" side, committed
**beside** `pre-v1/` rather than over the top-level `{fourier,kelly,brain}.json`.
Those three are still the 2026-08-09 **light / 1076** reference snapshot,
and overwriting a light-universe file with a dark-universe capture would
be exactly the cross-universe diff this document warns against. The V1
A/B keeps both of its own sides, in one universe, next to each other.

```
bun modes/bansho/harness/y-oracle.mjs --h layout-baseline/pre-v1/$SET.json layout-baseline/v1-canvas/$SET.json
3a fourier: 47 flow boxes, 0 beyond ±0.02px
3a kelly:   29 flow boxes, 0 beyond ±0.02px
3a brain:   22 flow boxes, 0 beyond ±0.02px
```

| # | What it proves | Result |
|---|---|---|
| 1 | notes projection untouched | `$SET.notes.json` **byte-identical** on all three — and the board side now **diverges** from it, so the control group is a real signal and not the tautology it was pre-V1 |
| 2 | no re-wrap, margins pinned | `x` **0** changed, `w` **0**, `margin` **0**; `h` changed on exactly one row per strip — the `bansho-backref` overlay's own full bleed, ±0.02px, which is the model's 3b residual reaching the face extent the bleed is quoted from. No content box changed height |
| 3a | implementation fidelity | **exactly zero** — every one of the 98 flow boxes lands on the oracle, on every strip |
| 3b | model fidelity | unchanged from the pre-V1 measurement (2 rows of −0.03px on fourier, attributed above); max \|Δy\| of the new capture against the old CSS flow is **0.02px** |
| 4 | box-relative ink | **no `d` string changed by a byte.** One row per strip reports "changed" and the diff is pure nesting: a back reference now hangs INSIDE its target's box, so the probe's descendant query lists its two overlays under the target as well. Verified mechanically: `new(target).paths === old(target).paths ++ old(backref).paths`, and `new(backref).paths === old(backref).paths` |
| 5 | visual A/B | `harness/screenshots/v1-canvas/{before,after}/` — three strips plus `bayes`, `four-boards`, `turn-demo`, same session. The staged boards are indistinguishable; the strips read as before |

**Why 3a can be exactly zero at all:** the fold quantises measured `h` and
margins to 1/100 px before chaining them — the resolution the probe quotes,
so the engine and the oracle do the *same* arithmetic on the *same*
numbers instead of racing at float precision. Each box's `top` is then
written absolutely, so the browser's 1/64 px snapping stays per-box and
never accumulates. The price is the ≤0.02px the boxes sit away from where
CSS flow put them, which is 3b's already-attributed residual and nothing
new. `__tests__/box-oracle.test.ts` keeps this loop closed under `bun test`
by replaying the committed capture through the fold.

### Capture conditions for the V1 A/B (differ from the section above — read this)

- Viewport **1600×1100** (`chrome-devtools emulate --viewport 1600x1100`),
  board layout width **1242** — not the 1076 of the 2026-08-09 baseline,
  because this session's shell gives the viewer more room. Both sides of the
  V1 A/B share it; it is a different, self-consistent universe.
- App theme **dark**, not light. The theme's SSOT is `~/.pneuma/settings.json`
  (served via `/api/user-theme`); flipping it would mutate the user's own
  environment, so the A/B was pinned to whatever was already set. Dark names
  a different font face than light, so **do not cross-diff these captures
  against the 2026-08-09 light ones** — they are separate measurement
  universes, and the light one stays guarded by `theme-remeasure.test.tsx`
  plus the visual pass.

### The five interpretations V1 made, ruled 2026-08-11

The implementer surfaced five places the spec left to judgement rather than
absorbing them. Ruled here so the next phase inherits decisions, not guesses.

1. **Re-parent the back reference, but keep its coordinate frame on the panel
   — RATIFIED, and V2 owns the rest.** Design §8 says the frame moves to the
   box; doing that in V1 would have translated every `d` string and turned
   items 2 and 4 from byte gates into attributed exceptions, buying nothing,
   because in V1 nothing relocates. Re-parenting alone already gives §13 what
   it wants (a future box transform carries its ink along). **V2 must finish
   this the moment boxes actually move** — that is when the frame change earns
   its cost, and it will need its own before/after.

2. **Quantising measured `h` and margins to 1/100px before chaining —
   RATIFIED.** Not in the spec, and it is what makes 3a *decidable*: engine
   and oracle then do identical arithmetic on identical numbers instead of
   racing at float precision. Without it 3a would inherit 3b's rounding
   accumulation and report failures that are neither engine bugs nor
   modelling differences — precisely the muddle the 3a/3b split exists to
   prevent. Note the probe itself rounds every reading to 0.01px
   (`Math.round(n * 100) / 100`), so **0.01 is the instrument's resolution,
   not a tolerance**: with a ruler graduated in hundredths you cannot measure
   an equality finer than a hundredth.

3. **The refreshed baselines live at `v1-canvas/`, beside `pre-v1/`, and the
   top-level `{fourier,kelly,brain}.json` stay untouched — RATIFIED.** Those
   three are the 2026-08-09 **light / 1076** reference; overwriting them with
   a **dark / 1242** capture is exactly the cross-universe diff this file
   forbids. "Refresh" here means *add a dated universe*, never *overwrite a
   different one*.

4. **`LayoutStepInput` carrying two heights (`height` margin-box, `box`
   fractional border-box + margins) — ACCEPTED FOR V1, and it is a debt.**
   It is what keeps V1's promise of no physics change: charging the fill
   cursor in fractional heights would shrink every cursor and could delay an
   overflow on a staged board — a behaviour change smuggled into a structural
   cut. **V2 collapses it to one truth**, where a physics change is the point
   and can be measured deliberately.

5. **Dropping the erased-run wrapper's mirrored padding — RATIFIED.** With
   `inset: 0` its padding box already coincides with the panel's, so the
   padding offset absolute face coordinates a second time. The fix is proven
   by the two extra frames (a closed run scrubbed back into, and a mid-reveal
   turn) plus the numeric check that a closed run's first box sits at the same
   panel-relative coordinates as an open run's.

## V1.5 (CSS 3D): the byte gate held, and the instrument found the bug

The 2026-08-11 CSS-3D phase gives the board a depth surface
(`.bansho-depth`, between the viewport and the stage) carrying one
`perspective()` and one 3D pose. Its claim to the gate is stronger than
V1's: **this phase moves no ink at all**, so "byte-identical" is the
whole verdict, not a blast radius to attribute.

Captured in the V1 A/B's universe — **dark / 1242, viewport 1600×1100**,
one browser page navigated between two dev servers back to back (before =
a `git worktree` at `39ef925` on 17997, after = the branch on 17998,
identified by `curl -s localhost:PORT/modes/bansho/viewer/board-css.ts |
grep -c bansho-depth`).

| Leg | Result |
|---|---|
| `{fourier,kelly,brain}.json` (board) | **byte-identical**, all three |
| `{fourier,kelly,brain}.notes.json` (the control group) | **byte-identical**, all three |
| the fresh BEFORE side vs the committed `v1-canvas/` | **byte-identical**, all three — the universe reproduces |

Nothing was added under `layout-baseline/` for V1.5: an identical capture
is not a new universe, and the fresh before-side reproducing `v1-canvas/`
byte-for-byte is the stronger statement. It also means `v1-canvas/`
remains a live reference rather than a historical one.

### What made it byte-identical BY CONSTRUCTION

`.bansho-depth` carries **no transform at rest** — an empty inline
`transform`, not an identity one. With no transition in flight and
parallax off there is no `perspective`, no 3D rendering context, and no
compositing decision; `.bansho-stage` still wears exactly
`cameraCss(camera)`. The wrapper is `height: 100%` and stays in normal
flow on purpose: the height pins `transform-origin` to the VIEWPORT's
centre (sized from the stage, a 4300px strip would put the vanishing
point two thousand px below the fold), and staying static keeps it out of
the `offsetParent` chain `stageOffsetOf` walks.

### The measurement proof, and the bug it caught

The css3d brief §5.2-2 predicted the failure and the task asked for it to
be *proved rather than reasoned*. It was, and the proof failed first.

Measured on the live board with parallax on and the pointer parked in the
bottom-right corner (pose
`perspective(1600px) rotateX(-3.984deg) rotateY(3.987deg)`), over 400
mounted word spans:

```
max drift of the funnel's own arithmetic, surface NOT suspended : 322.58 px
max delta across a suspend / restore round trip                 :   0.00 px
```

Then the real test: deflect the board, force a full re-measure **without
remounting** (resize the viewport 1600 → 1560 → 1600, which trips
`invalidateMeasurements`; the deflection is a ref and survives), square
the board up, and probe.

- **First run — FAIL.** `fourier` folded from **4218px to 7629px**. Every
  row's `h`, `x`, `w` and margins still measured correct afterwards; only
  the accumulated `y` was wrong, so nothing about the symptom pointed at
  the measurement. Cause: `computeFoldInputs::measureItem` reads each
  box's fractional border box through `boardRects` — **a second, entirely
  correct funnel call site that had just acquired a transformed
  ancestor.** This is precisely the class the G8-J source scan cannot
  catch: it pins where `getBoundingClientRect` may appear, not what is
  above it.
- **Fix, structural:** `boardRects(base, targets, depth)` now takes the
  depth surface as a **required** argument and suspends it itself.
  Forgetting it is a compile error. (Same move as
  `factories/svg.ts::el()` for G8-D, same reason: silent, output-shaped,
  one-combination failure.)
- **Second run — PASS**, with a control:

```
                                     board height   rows differing from the at-rest capture
at-rest baseline                        4218        —
resize round-trip, parallax OFF         4218        1  (4:6, the backref overlay's own bleed)
resize round-trip, board ROCKED         4218        1  (4:6, the same row)
control vs test                         byte-identical to each other
every ink `d` string, all three         byte-identical
```

The one moving row is the resize round-trip's own artifact — it appears
with parallax off — so the deflection contributes **nothing**. The mouse
is provably not in the measurement.

## The 2026-08-12 phase (every board change walks + the wall map): measured

The phase's claim to this gate is V1.5's, not V1's: **it moves no ink at
all.** The camera work lives entirely inside the stage schedule, which is
only built when a lecture declares a camera verb or a `@turn`
(`hasCamera`) — the three strips declare none — and the wall map is behind
a `panelCount > 1` **mount** gate, so on a one-panel strip the node does
not exist rather than being hidden. Both are structural absences, and the
previous phase's task was told plainly that reasoning is not measuring, so
this one measured.

Captured in the V1 A/B's universe — **dark / 1242, viewport 1600×1100** —
through `harness/cdp.mjs` (an isolated Chrome on its own port and
user-data-dir; the shared `chrome-devtools` daemon has stolen another
agent's page mid-run, so the harness no longer uses it).

| Leg | Result |
|---|---|
| `{fourier,kelly,brain}.json` (board) | **identical to the committed `v1-canvas/` capture** |
| `{fourier,kelly,brain}.notes.json` (the control group) | **identical**, all three |

"Identical" here is byte equality modulo one trailing newline
(`cdp.mjs` terminates the file; the old `chrome-devtools` CLI did not) —
verified mechanically, `mine == ref + b"\n"` on every leg.

**What was NOT achieved, and why it matters less than it looks.** The
protocol's same-session A/B needs the BEFORE side served from a second
worktree, and that side would not render: two Vite servers over one
symlinked `node_modules` share `node_modules/.vite`, and the second to
re-optimize leaves the first serving an import map its page cannot load.
So this is an *across-session* comparison against the committed reference
— which this document warns is not byte-stable, and that warning cuts the
right way here: cross-session drift can only ADD differences (11 of
fourier's 48 ink paths moved ~3px in the observed case). A clean match
across sessions therefore cannot be a coincidence, and it is the same
statement V1.5's third row made from the other side. A *diff* would have
been inconclusive; a match is not.

### The G7 frames

`harness/screenshots/v1.5-css3d/` — see its README.

## The 2026-08-12 room phase (the wall becomes a grid, the map becomes a map)

The wall stopped being a row (`engine/wall.ts`: `cols = ceil(sqrt(n))`,
row-major) and the overview widget became a scaled drawing of the whole
wall. The claim to this gate is V1.5's again — **it moves no ink at all** —
and for three structural reasons rather than by measurement luck:

- the arrangement is a stage-level offset; `panelW` is still the viewport's
  own width, so no wrap decision changes;
- nothing touches `.bansho-panel`'s box — the frame, the chalk tray and the
  wall light are all box-shadow or absolutely positioned pseudo elements,
  and the slot wrapper is `display: contents` on a single strip (no box, so
  it is invisible to layout and to the `offsetParent` walk);
- the wall map is behind a `panelCount > 1` **mount** gate, so on a strip
  the node does not exist rather than being hidden.

Measured anyway, and this time as the protocol's own **same-session A/B**:
one isolated Chrome (`harness/cdp.mjs`, own port and user-data-dir), the
BEFORE side captured from the working tree at its pre-change commit and the
AFTER side captured in the same browser process after the change, dark /
1242, viewport 1600x1100.

| Leg | Result |
|---|---|
| `{fourier,kelly,brain}.json` (board) | **byte-identical**, all three |
| `{fourier,kelly,brain}.notes.json` (the control group) | **byte-identical**, all three |

This is the first time the protocol's own A/B has actually been run since
V1.5 — the previous phase could only compare across sessions, because two
Vite servers over one symlinked `node_modules` broke the second worktree.
The trick that made it possible needs no second worktree at all: capture the
BEFORE side FIRST, out of the unmodified working tree, and keep the browser
alive while you implement.

Frames: `harness/screenshots/wall-room/` — see its README.

## The 2026-08-12 composition phase (columns + the type scale): measured

This is the phase where ink is SUPPOSED to move, so the gate's question is
the one this document's "bound the blast radius" section poses: **did exactly
the right things move, and nothing else?** It is answerable because the
change has two legs with opposite predictions, and they were captured
SEPARATELY, in one browser process, before / between / after.

Universe: **dark / board layout width 1242** (face 1154), viewport
1600x1100, through `harness/cdp.mjs` + the new `harness/capture-cdp.sh`
(the same `probe-layout.js`, driven by the isolated CDP driver instead of
the shared daemon). BEFORE was captured FIRST out of the unmodified working
tree and the browser kept alive across the whole implementation — the trick
the room phase found, and it is what makes both legs same-session.

### Leg A — the column flow alone: BYTE-IDENTICAL on all three strips

```
fourier        BYTE-IDENTICAL      fourier.notes  BYTE-IDENTICAL
kelly          BYTE-IDENTICAL      kelly.notes    BYTE-IDENTICAL
brain          BYTE-IDENTICAL      brain.notes    BYTE-IDENTICAL
```

Predicted, not lucky: `columnCountFor` returns **1 on a face with no bottom**,
and all three references are strips. A column break is "the flow reached the
bottom and resumed at the top of the next one"; an unbounded axis has no
bottom to reach, so the arithmetic — not a special case — makes the whole
feature inert here. The blast radius of the fold change is therefore bounded
to BOUNDED faces, and the strips prove it rather than illustrate it.

### Leg B — the type scale: everything moves, and every mover is attributed

| set | rows | x changed | w changed | h changed | margins changed | y changed | board height |
|---|---|---|---|---|---|---|---|
| `fourier` | 48 | **3** | **3** | 44 | 43 | 46 | 4218 -> 5262 |
| `kelly` | 30 | **3** | **3** | 28 | 27 | 28 | 2464 -> 3170 |
| **`brain`** | 22 | **0** | **0** | 19 | 21 | 21 | 1800 -> 2253 |

- **Every horizontal mover is a `bansho-math` block**, and every math block
  moved: 3 of 3 on `fourier`, 3 of 3 on `kelly`, **0 of 0 on `brain`**. That
  is the class whose box is `width: fit-content` with `margin: 0 auto`, so a
  larger font makes it wider and re-centres it. Nothing else changed `x` or
  `w` — no box was re-columned, and no prose re-flowed into a different
  measure, which is the strip's promise from leg A restated per row.
- `h` / `margins` / `y` changing nearly everywhere IS the change: the type
  scale is upstream of every measurement.

### 3a — implementation fidelity, at zero tolerance

The question that survives when `h` is allowed to move: given each box's
OWN new measured height and margins, does the engine put it exactly where
the §7.5 model says?

```
bun modes/bansho/harness/y-oracle.mjs layout-baseline/w2-compose/{fourier,kelly,brain}.json
3b /tmp/w2ab/legB/fourier.json: 47 flow boxes, 0 beyond ±0.02px
3b /tmp/w2ab/legB/kelly.json:   29 flow boxes, 0 beyond ±0.02px
3b /tmp/w2ab/legB/brain.json:   22 flow boxes, 0 beyond ±0.02px
```

**98 flow boxes, zero residual** — and note this is now STRICTLY better than
the pre-V1 measurement, which carried two rows of −0.03px on `fourier` from
accumulated probe rounding. The deeper board did not accumulate more error.

### The notes leg moved too, and that is not a control-group failure

`$SET.notes.json` differs on all three. The control group's contract is that
a notes diff means "the parser, a factory, in-box ink or the measurement
pipeline moved" — and the type scale is precisely the measurement pipeline's
input, upstream of BOTH projections. A notes leg that had stayed identical
while every board box grew would have meant the notes projection was reading
a stale stylesheet. What the control still guarantees is unchanged: leg A,
where nothing about measurement moved, kept it byte-identical.

### Captures

`layout-baseline/w2-compose/` — `$SET.before.json` and `$SET.json` (plus
both notes legs), a new dated universe committed BESIDE `pre-v1/` and
`v1-canvas/` rather than over them (ruling #3). Content provenance: the three
strips were served from a private copy of `~/bansho-boards/_all` and `brain`
has drifted to 22 steps against `v1-canvas/`'s 23, so **do not cross-diff
this universe against the earlier ones** — both of its own sides are in it.

Frames: `harness/screenshots/w2-compose/` — see its README.

## The 2026-08-12 measure-width phase (W2b): both legs byte-identical

The phase repairs the thing W2 left behind: after the room's flow moved into
COLUMNS the hidden measure host was still a full-width panel, so every run
was measured — wrapped, row-grouped, height-read — against a face its box
does not stand in. Ink is measured at build time, so an underline was drawn
for a line the reader never sees.

Two legs, captured SEPARATELY in one browser process, before / between /
after, in the V1 A/B's universe (**dark / board layout width 1242, face
1154**, viewport 1600x1100) through `harness/cdp.mjs` + `capture-cdp.sh`.
BEFORE was captured FIRST out of the unmodified working tree and the browser
kept alive across the whole implementation.

### Leg A — the measure host's own width: BYTE-IDENTICAL on all three strips

```
fourier        BYTE-IDENTICAL      fourier.notes  BYTE-IDENTICAL
kelly          BYTE-IDENTICAL      kelly.notes    BYTE-IDENTICAL
brain          BYTE-IDENTICAL      brain.notes    BYTE-IDENTICAL
```

Predicted, and predicted twice over. A strip is a face with no bottom, so
`columnCountFor` returns 1 and `scanBoxRects` hands back the whole face —
the same number `left: 44px; right: 44px` was already giving the host on a
1242px board. And the notes projection has no face at all: it measures in
CSS flow (§8's control group), so the host keeps the stylesheet's inset. The
blast radius of the fix is therefore bounded to BOUNDED faces, exactly like
W2's leg A, and the strips prove it rather than illustrate it.

The board where it does move is the four-board `bayes` wall, and that is the
`screenshots/w2b-measure/` A/B.

### Leg B — the wrapped bullet's hang: BYTE-IDENTICAL on all three strips

```
fourier        BYTE-IDENTICAL      fourier.notes  BYTE-IDENTICAL
kelly          BYTE-IDENTICAL      kelly.notes    BYTE-IDENTICAL
brain          BYTE-IDENTICAL      brain.notes    BYTE-IDENTICAL
```

This one needed its evidence checked rather than assumed, because a CSS
change to `.bansho-list-item` is upstream of BOTH projections — the class
W2's type scale belonged to, which legitimately moved the notes leg. Two
facts, both read off the live board, make the identity the right answer:

- the hang's net inline advance is **zero** (`−advance + glyph + gutter`),
  so line one's available measure — and so its wrapping, and so its ink — is
  untouched by construction; only a line that ALREADY wrapped can move;
- all **12** list items across the three strips are single-line at a 1154px
  face (`clientHeight / lineHeight === 1`, checked per item), with the 28px
  padding confirmed live — so the feature is applied and has nothing to
  move.

### Captures

`/tmp` only — no new universe was added. Adding one would claim the strips
moved; they did not, and `w2-compose/` remains the live reference this
phase's before-side reproduces.

Frames: `harness/screenshots/w2b-measure/` — see its README.

## The 2026-08-12 禁则 phase (W2c): NO BOX MOVED, and the ink moved by the ruler

The phase makes punctuation stop being a reveal unit of its own (a mark
merges into the word it terminates; the residue a run boundary strands is
welded by a two-box `white-space: nowrap` group). Ink was EXPECTED to move,
so the gate's question is the blast-radius one — and the answer has a
sharper shape than usual, because the change is upstream of the segments
every box is built from and yet not one box moved.

Universe and protocol: **dark / board layout width 1242**, viewport
1600x1100, `harness/cdp.mjs` + `capture-cdp.sh`, BEFORE captured FIRST out
of the unmodified working tree with the browser kept alive across the whole
implementation — the room phase's trick, run as the protocol's own
same-session A/B.

| set | rows | `x` | `w` | `h` | `margins` | `y` | board height | ink rows | max \|Δ\| in any `d` |
|---|---|---|---|---|---|---|---|---|---|
| `fourier` | 52 | **0** | **0** | **0** | **0** | **0** | 5293 → 5293 | 9 | **0.02px** |
| `kelly` | 30 | **0** | **0** | **0** | **0** | **0** | 3199 → 3199 | 4 | **0.02px** |
| `brain` | 22 | **0** | **0** | **0** | **0** | **0** | 2253 → 2253 | 3 | **0.02px** |

Both projections, identical numbers: the notes leg moved exactly where the
board leg did, which is right — a segmentation change is upstream of BOTH.

**Zero geometry change is the strong statement.** Merging two boxes into one
could have re-wrapped a line, and did not, anywhere: no `x`, no `w`, no
height, no margin, no `y`, no board height. What moved is ink drawn OVER
text, by at most 0.02px — the instrument's own resolution (this document's
ruling #2: the probe rounds every reading to 0.01px, so "0.01 is the
instrument's resolution, not a tolerance"). It is also what a merge
predicts: one box for 「阳性。」 has no byte-identical advance to two boxes
「阳性」+「。」, so the row union the ink is drawn from lands a hundredth away.

**The residual is attributed, not assumed.** Two controls in the same
browser process, after the change:

```
capture -> re-capture, nothing whatever varied          BYTE-IDENTICAL
capture -> resize 1600->1180->1600 -> capture           BYTE-IDENTICAL
```

So the instrument was byte-stable in this session and a re-measure cannot
account for the 0.02px. It belongs to the change and is bounded by the ruler.

### The universe ruling, and a warning the next phase needs

Captures: `layout-baseline/w2c-punct/` — `$SET.before.json` /
`$SET.after.json` (plus both notes legs), committed BESIDE the earlier
universes per ruling #3, never over them.

A new dated universe IS added here, and W2b's "an identical capture is not
a new universe" argument deliberately does NOT apply: ink moved, even if
only sub-resolution. Which means the warning: **`w2-compose/` no longer
reproduces byte-for-byte as a before-side.** A phase that diffs against it
will hit these 9 / 4 / 3 ink rows and burn its time re-attributing them.
Diff against `w2c-punct/$SET.after.json`.

## The 2026-08-12 瑕疵 phase (W3): the paint-time claim, MEASURED from both sides

The phase gives the board a hand — per-block lean and shear, per-word
baseline drift, chalk grain and cloth smears on the slate — behind one
content-set token, `--bansho-flaw` (0 = perfectly clean, 1 = the tuned
default). Its whole claim to this gate is that **all of it is paint-time
and therefore canonical layout does not move**, and that claim is the one
thing this phase was told to prove rather than assert.

Universe and protocol: **dark / board layout width 1242**, viewport
1600x1100, `harness/cdp.mjs` + `capture-cdp.sh` on an isolated Chrome
(own port, own user-data-dir). BEFORE was captured FIRST out of the
unmodified working tree with the browser kept alive across the whole
implementation — the room phase's trick, run as the protocol's own
same-session A/B. **`--bansho-flaw: 0` was written into each strip's
`theme.css` BEFORE the before-side capture**: on pre-W3 code an unread
custom property changes nothing, and adding the file between legs would
have varied two things at once.

### Leg 1 — knob 0 is byte-identical to the board of before the feature

```
fourier        BYTE-IDENTICAL      fourier.notes  BYTE-IDENTICAL
kelly          BYTE-IDENTICAL      kelly.notes    BYTE-IDENTICAL
brain          BYTE-IDENTICAL      brain.notes    BYTE-IDENTICAL
```

Predicted by construction, not by luck: at 0 the host never sets the gate
attribute, so not one rule of the layer matches. A clean board carries no
transform — **not `rotate(0deg)`**, which would still mint a stacking
context and a containing block. "Provably inert" has to mean the property
is absent, and `flaw.test.ts` pins the gating structurally so a future
rule cannot escape it.

### Leg 2 — the knob ON, and canonical layout still does not move

Same browser, same session, only the knob line edited (0 -> 1):

```
fourier        BYTE-IDENTICAL      fourier.notes  BYTE-IDENTICAL
kelly          BYTE-IDENTICAL      kelly.notes    BYTE-IDENTICAL
brain          BYTE-IDENTICAL      brain.notes    BYTE-IDENTICAL
```

`probe-layout.js` now LIFTS the layer for the read, exactly the way
`boardRects` does — one attribute, restored in `finally`. That is not the
probe looking away: the fold's verdict is written into each box's inline
`top`, so a layer that had polluted a measurement would show up here
instantly as moved boxes. What the suspension removes is only the paint
offset, which is the third leg's subject.

(The suspension is a no-op when the attribute is absent, so captures
either side of W3 stay directly comparable — leg 1 above is that.)

### Leg 3 — the perturbation is REAL, and it is paint and nothing else

The same board read with `{ asPainted: true }`, diffed against its own
canonical capture (`fourier`, 52 steps):

| | |
|---|---|
| `rect` rows moved | **48 of 52**, max \|Δ\| **8.53 px** |
| `boardLayoutWidth` | 1242 -> **1242** |
| `boardLayoutHeight` | 5293 -> **5293** |
| `boardPadding` | unchanged |
| `margins` rows moved | **0** |
| ink `d` rows moved | **0** |
| svg box rows moved | **0** |

Paint moved by up to eight and a half pixels; every layout value, every
margin and every ink path string is byte-identical. That is the whole
design in one table — and it is why the fold, `naturalDuration`, the wrap
decisions and the reconcile hash cannot see this feature.

### What made it safe, structurally

`boardRects` gained the imperfection surface as a **required** parameter
(the V1.5 precedent: forgetting to lift it is a compile error, not a
discipline). It matters because `measureItem` reads each box's fractional
border box through the funnel: a 0.58° lean inflates `rect.bottom -
rect.top`, the fold charges the inflated height, and the board grows a
little every time somebody nudges a theme — V1.5's parallax bug wearing a
different hat. Every other raw `getBoundingClientRect` in the mode is on
the G8-J exemption list and reads inside `ctx.measureHost`, which carries
neither the gate nor a `data-bansho-box` flag, so factory ink is measured
on flat text by construction.

### Frames

`harness/screenshots/w3-flaw/` — the same four-board `bayes` wall at the
same camera and the same playhead, at knob 0, 1 and 3.

## The 2026-08-12 camera/map phase (W4a): no ink, and the one contaminated leg

The phase makes the wall map show the CURRENT board rather than the
finished lecture, turns the wheel into a zoom, and repairs a follow that
still reasoned in one dimension on a two-dimensional wall. Its claim to
this gate is V1.5's — **it moves no ink at all**: the map is behind a
`panelCount > 1` mount gate (absent on a strip), the camera work lives in
the stage schedule, which is only built when a lecture declares a camera
verb or a `@turn` (the three strips declare none), and nothing in it
touches a box.

Universe and protocol: **dark / board layout width 1242**, viewport
1600x1100, `harness/cdp.mjs` + `capture-cdp.sh` on an isolated Chrome.
BEFORE was captured FIRST out of the unmodified working tree, browser kept
alive across the whole implementation.

| Leg | Result |
|---|---|
| `brain` + `brain.notes` | **BYTE-IDENTICAL** |
| `fourier`, `fourier.notes` | 1 of 52 rows differ — `cls: bansho-math`, `rect` only |
| `kelly`, `kelly.notes` | 2 of 30 rows differ — both `cls: bansho-math` |
| board heights, all three | unchanged (5293 / 3199 / 2253) |

**The differing rows are not this phase's.** A concurrent agent was editing
`engine/factories/math.ts` in the same working tree, and it changed between
the two captures — `shasum` taken at both ends, `9e0f4d63` → `5ef78fe7`,
with `viewer/board-css.ts` byte-equal throughout. The math change's own
blast radius is formula rows, and `brain` carries **zero** formulas, which
is why it is the leg that decides: a camera/map change that moved a box
could not have spared the formula-free board.

**Procedural note for the next phase sharing a tree.** Hash the files
another agent owns at BOTH ends of the A/B. Without those two hashes the
three moved rows are unattributable and the whole capture is worth nothing;
with them the verdict took one command. The before side also reproduced
`w2c-punct/$SET.after.json` byte-for-byte on all six legs, which is the
other half of the same statement — the universe still reproduces.

## The 2026-08-12 canonical-size phase (W7): the gate gained a second axis

W7 gives a board a fixed size (`engine/layout.ts::PANEL_WIDTH` = 1242,
`PANEL_HEIGHT` = 894) instead of the reader's window. Every phase before it
could only ever say "nothing moved **at this window**", because a board's
width WAS the window and the two could not be varied independently. This
one adds the check that sentence was always missing.

### The standing leg: `harness/two-width.sh`

> Capture the probe's own JSON at **1280** and at **1990**, in one browser
> process, and diff. **Byte-identical is the proof.**

It is a standing leg of this gate now, and it exists because the defect it
closes is invisible from inside one window: the owner and the implementer
looked at the same `board.md` on two screens and saw two different lectures
— his wall had boards 3 and 4 blank, no figure and half-size type — and
**both captures were honest**. There was no measurement either of them could
have run that would have disagreed.

Measured 2026-08-12, one isolated Chrome, both widths back to back:

```
fourier        BYTE-IDENTICAL      fourier.notes  BYTE-IDENTICAL
kelly          BYTE-IDENTICAL      kelly.notes    BYTE-IDENTICAL
brain          BYTE-IDENTICAL      brain.notes    BYTE-IDENTICAL
```

Both projections, because the notes leg is canonical too: it stays in CSS
flow (§8's control group is about the rendering PATH, not about the measure),
and a notes reader at two widths seeing two documents is the same defect one
projection over.

### What had to change in the instrument, and why it is not looking away

The probe now **suspends the camera transform** for the read
(`.bansho-stage` / `.bansho-depth`, one inline style, restored in `finally`
— the same shape as the W3 flaw lift and `boardRects`' depth lift).

It is not cosmetic. Once a board has its own size the at-rest zoom is
`viewW / PANEL_WIDTH`, not 1, so `scale` differs at every window and every
reading would be divided by a DIFFERENT float. Board coordinates land on
1/64 px LayoutUnits and that divide is not exact, so a row sitting on a
`.xx5` boundary would flip by 0.01 between two windows — an instrument
artefact indistinguishable from moved ink, inside the one gate whose whole
job is to prove nothing moved. Suspended, `scale` reads **1 at every width**,
the divide is the identity, and the two-width diff is byte equality with no
exclusions.

It is a no-op wherever the camera was at rest AND rest meant identity, which
is every capture taken before W7 — verified: the fresh before-side below was
captured with the NEW probe against the OLD code and reproduces
`w2c-punct/brain.json` byte for byte.

### The re-basing A/B: the ink did not have to move at all

`PANEL_WIDTH` is **1242 because that is what the board already was** in this
universe (dark / board layout width 1242 — the geometry every accepted
screenshot was taken at, and the one the 34px body and the 13-character
column were tuned against). Choosing 1240 "because the brief said ~1240"
would have moved every wrap in the corpus by two pixels to buy nothing.

So this ink-moves wave moved no ink. Same-session A/B, BEFORE captured FIRST
out of the unmodified working tree with the browser kept alive across the
whole implementation (the room phase's trick), dark / 1242, viewport
1600x1100:

| Leg | Result |
|---|---|
| `{fourier,kelly,brain}.json` (board) | **BYTE-IDENTICAL**, all three |
| `{fourier,kelly,brain}.notes.json` (the control group) | **BYTE-IDENTICAL**, all three |
| the fresh BEFORE side vs committed `w2c-punct/` | `brain` byte-identical; `fourier` 1 row and `kelly` 2 rows differ, **all `cls: bansho-math`** — a concurrent agent's `engine/factories/math.ts` work, the same contamination W4a recorded, and the formula-free board is the one that decides |

No new universe is committed under `layout-baseline/`: an identical capture
is not a new universe (W2b's ruling), and `w2c-punct/$SET.after.json` stays
the live before-side for the next phase.

### The number to quote when someone asks what W7 cost

Nothing, at the reference window — and that is the point of choosing the
number the room was already at. What it BUYS is that the sentence above
("nothing moved") is now width-free.

## W9 (2026-08-12): the fill instrument stopped lying, and moved nothing

Occupancy counted only the room's own flow — `place()` charged a column
only on the `full` path — so a face composed with `@at` reported near-zero
while standing full. The fix is pure ACCOUNTING (a private charge per named
region, unioned on the unit face), and the claim it owes this gate is the
strongest one available: **not one pixel of ink moves.** It is structural —
a named region never migrates and never runs a fits-in test, so its charge
reaches no placement decision, and the flow's column charges are untouched
— but the previous phases were told that reasoning is not measuring.

Same-session A/B, ONE isolated Chrome (`harness/cdp.mjs`, own port and
user-data-dir) held alive across the code swap: AFTER captured first out of
the working tree, then `git checkout <parent> -- engine/layout.ts
engine/regions.ts viewer/board-{snapshot,check}.ts`, one full page reload,
BEFORE captured. Dark / 1242, viewport 1600×1100.

| Leg | Result |
|---|---|
| `{fourier,kelly,brain}.json` (board) | **BYTE-IDENTICAL**, all three |
| `{fourier,kelly,brain}.notes.json` (the control group) | **BYTE-IDENTICAL**, all three |

No new universe is committed: an identical capture is not a new universe
(W2b's ruling).

### The other half of the same session: what the reading was worth

The same browser, the same swap, three lectures that compose with `@at`,
asked `glance-board` on each side. These are the boards that produced the
field reports — the numbers are the defect, measured.

| Lecture | Board | BEFORE | AFTER |
|---|---|---|---|
| `bansho-new/three-months` (165 steps) | 1 | **blank (wiped)** | 67% |
| | 2 | 44% | 44% |
| | 3 | **blank (wiped)** | 63% |
| | 4 | **blank (wiped)** | 73% |
| | pen line | "board 4 — **0% used**, room for ~12 more steps" | "board 4 — 73% used, room for ~2 more steps" |
| `bansho-wall/bayes` (51 steps) | 3 | **14%**, `§6 steps 5–7 standing` | 52%, `§5 steps 1–3 · §6 steps 1–7 standing` |
| | pen line | "room for ~12 more steps" | "room for ~6 more steps" |
| `bansho-e2e/bayes` (136 steps) | 1 / 2 / 3 | full / 43% / 78% | full / 43% / 78% |

Three things to read off it. The 14% is the exact number the first field
report quoted. The three-months author's twelve false `turnUnderfilled`
findings had a worse cause than a wrong percentage — three of its four
boards were reported BLANK, and `renderSnapshot` short-circuits on `blank`,
so no percentage printed at all; that is why the fix had to reach the
glance's `standing` and `blank` as well as its `occupancy`. And the third
lecture is the control: its tail is flow-composed, so every number on it is
unchanged to the digit.

## What the gate does NOT cover: camera durations follow the viewport

Measured 2026-08-12, while proving the script drawer cannot reach the
lecture. `two-width.sh` came back byte-identical on every leg, drawer open
and drawer shut — and the transport's **total duration still moved**, by
0.1s over 446s, when the drawer opened.

Both facts are true and they are about different things. The probe reads
LAYOUT: rects, `d` strings, overlay boxes, board dimensions. Camera poses
are not in it, and a camera move's duration is a function of how far the
camera travels — which is a function of the viewport it has to fill
(`restZoom(viewport.clientWidth, PANEL_WIDTH)`). So on a board carrying
camera verbs, the schedule is viewport-sensitive by existing design; C1's
resize handler says so in as many words.

The attribution, measured the same session, drawer held shut:

| board | camera verbs | total at 1280 | total at 1990 |
|---|---|---|---|
| `fourier` | 0 | 153.9s | 153.9s |
| `three-months` | 1 (`@focus`) | 444.8s | 446.8s |

A board with no camera verbs is duration-invariant across widths; the one
with a camera verb is not, and a drawer that changes the viewport is just
another window resize to it. **Read a byte-identical `two-width.sh` as "the
lecture is written the same", not as "the lecture plays for the same
length."** If the second claim ever has to be true, it needs its own
instrument — this one cannot see the question.

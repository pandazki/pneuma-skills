/**
 * Board surface stylesheet (T4) — the DEFAULT bansho board look, injected
 * as a <style> tag by BanshoPreview.
 *
 * Token split (deliberate, review-relevant): the PLAYER CHROME (panes,
 * transport, script pane) uses the app's `cc-*` design tokens via Tailwind
 * classes in the components. The BOARD CONTENT below is content-domain —
 * like a slide deck's own palette — driven by bansho board tokens from the
 * prototype, switched by `data-bansho-theme` and overridable per content
 * set by a sibling `theme.css` (§6.3: the seed owns the font stack; the
 * engine is font-agnostic).
 *
 * G8-A: the handwriting stack must put `HanziPen SC` (翩翩体) for CJK —
 * `Hannotate SC` silently falls back to PingFang and the handwriting feel
 * evaporates. Non-macOS platforms degrade to `cursive`.
 */

export const BOARD_BASE_CSS = `
.bansho-board-surface {
  --board: #ffffff;
  --board-fg: #1c1b19;
  --accent: #c2571e;
  --hl: #ffe072;
  --hl-a: 0.62;
  --s1: #2e9e4f;
  --s2: #3b7dd8;
  --hand: "Bradley Hand", "HanziPen SC", "Chalkboard SE", "Segoe Print", cursive;
  /* The ROOM the boards hang in (multi-board only). A board-domain token
     like every other on this surface: a seed's theme.css owns the wall
     the same way it owns the slate. Warm plaster against a white board. */
  --wall: #cfc7ba;
  /* 瑕疵 (W3) — how much of a hand this board has. 0 is a machine's board,
     1 is the tuned default, and a content set's theme.css owns it like
     every other token here. See the 瑕疵 block near the end of this sheet
     for what it drives and why all of it is paint-time. */
  --bansho-flaw: 1;
}
.bansho-board-surface[data-bansho-theme="dark"] {
  --board: #22302a;
  --board-fg: #f2efe6;
  --accent: #e8894b;
  --hl: #e8c24a;
  --hl-a: 0.32;
  --s1: #6fd98d;
  --s2: #7fb2f0;
  /* A LIT ROOM, not a hole. It has to be plainly a surface — darker than
     the slate so the boards stay the brightest thing in the frame, but
     clearly lighter than the app chrome behind it, or the room reads as
     the void the product owner rejected. */
  --wall: #2b302e;
}
/* The dark board's handwriting default, deliberately at LOWER specificity
   than the colors above. :where() weighs nothing, so this selector counts
   as one class — the same as .bansho-board-surface — and a content set's
   theme.css, injected after this sheet, overrides --hand for BOTH boards
   with the ONE declaration references/themes.md teaches.

   Written as [data-bansho-theme="dark"] (specificity 0,2,0) it silently
   beat every such theme: the custom stack applied on the light board and
   evaporated on the dark one, with the §6.4-A fallback chip staying green
   because the stack that won was itself a valid handwriting stack. That is
   the G8-A failure mode — a font that quietly is not the font you asked for.

   The colors keep their higher specificity on purpose: a theme that
   declares only the light side still inherits the stock dark palette (a
   parchment board must not stay parchment in the dark), which is the
   documented behaviour. A font stack is the opposite case — it is one
   decision about the board's hand, not two. */
.bansho-board-surface:where([data-bansho-theme="dark"]) {
  --hand: "Chalkboard SE", "HanziPen SC", "Bradley Hand", "Segoe Print", cursive;
}

/* ── THE TYPE SCALE: a board is read from the BACK ROW (W2, 2026-08-12) ────
   The product owner, on the previous scale: 「谁会写这么小的字？学生能看见吗？
   没有主次。」 He was right, and the appendix measured why: 26px body on a
   937px face is 36 glyphs per line — a PAGE measure, what a paragraph in a
   book is set to. A teacher at a board writes ten to fifteen glyphs a line,
   because they write large and they break lines by MEANING. h1 was 1.6x the
   body under it; on a real board a section title is two to three times it.

   Both levers had to move and both did: the room's flow now fills a face in
   COLUMNS (engine/regions.ts::columnCountFor), which halves the measure, and
   the scale below raises the type into it. 34px in a 565px column is ~16
   glyphs; in the owner's 456px column, ~13.

   The ratios, not the pixels, are the design: body 1, h2 1.47, h1 2.0,
   display math 1.47, aside 0.79. h1 is capped at 68 rather than the 76 the
   brief opened with because a 13-glyph board title has to fit the FACE on
   the narrower of the two live windows (13 x 68 = 884 < 937) — a title that
   wraps to three lines is not a title. */
.bansho-board {
  position: relative;
  padding: 36px 44px 64px;
  background: var(--board);
  color: var(--board-fg);
  font-family: var(--hand);
  font-size: 34px;
  /* 1.72 was page leading, and the appendix names airy leading as half of
     why the board read as sparse. 1.5 is a hand writing between ruled
     lines. */
  line-height: 1.5;
  min-height: 100%;
}

/* ── The stage camera (C1 + the C1′ grab) ──────────────────────────────────
   The viewport CLIPS (the native scrollbar is still gone — an accepted
   loss); the stage wears the one transform camera.ts computes. Layout
   inside the stage always happens at scale 1 — a transform is paint-time —
   so every offset* / client* reading on the board keeps meaning board px
   (G8-J).

   The flex chain exists for exactly one reason: a short board must still
   fill the viewport with board background. min-height percentages cannot
   cross the auto-height stage, flex-grow can — and a flex ITEM's inner
   layout stays plain block flow, so step geometry is untouched (the C1
   layout baseline is the proof).

   cursor: grab is the affordance: the board has to LOOK grabbable before
   it is grabbed, or the gesture is a secret. touch-action: none is what
   makes the grab exist on a touchscreen at all — without it the browser
   claims the finger for its own (nonexistent, overflow: hidden) scroll
   and pointermove never arrives. It also declines the browser's pinch,
   which is correct: page zoom is not this camera's zoom. */
.bansho-viewport {
  position: relative;
  overflow: hidden;
  cursor: grab;
  touch-action: none;
}
/* The room's ambient, behind everything. The stage carries the wall's
   LIGHT (see ".bansho-panels[data-bansho-multi]::before") so it pans with
   the boards; this flat fill is what the reader sees when the camera pulls
   back further than the wall is wide, and it exists only on a wall —
   ":has()" is the honest way to ask, since the multi marker lives on a
   descendant and a single strip must keep its app-chrome backdrop. */
.bansho-viewport:has(.bansho-panels[data-bansho-multi]) {
  background: color-mix(in srgb, var(--wall) 74%, #000);
}
/* ── V1.5: the depth surface ───────────────────────────────────────────────
   The board as a plane in three dimensions. It carries the ONE perspective
   and the ONE 3D pose (the director's transition swing plus the reader's
   parallax, composed in viewer/depth.ts), and it carries them INLINE —
   there is deliberately no transform declared here.

   "No transform at rest" is the whole safety argument, not tidiness:
     - the V1 layout baseline is byte-identical BY CONSTRUCTION, since an
       absent transform cannot move a pixel;
     - no perspective property is ever resident, so a 4300px board is
       never handed a permanent 3D rendering context — the compositing
       question C1 closed by omitting will-change stays closed, and what
       V1.5 adds is a surface that exists for the few hundred ms of a
       transition and is released again;
     - .bansho-stage keeps wearing EXACTLY cameraCss(camera). Every
       G8-J argument about the stage's one transform survives verbatim,
       and the funnel's same-frame scale still means what it meant.

   height: 100% and NOT position: absolute, for two separate reasons.
   The height is the vanishing point: transform-origin is a percentage of
   the border box, so a viewport-tall box pins it to the VIEWPORT's centre —
   sized from the stage instead, a long strip would put the origin two
   thousand pixels below the fold and a 4° tilt would throw the visible
   board sideways. Staying in normal flow is the other half: an absolutely
   positioned wrapper would insert itself into the offsetParent chain
   stageOffsetOf walks, and that chain is the stage-anchor seam's whole
   arithmetic. Static, it is invisible to it. The stage keeps overflowing
   downward exactly as before (the viewport clips), and its min-height:
   100% still resolves against a definite box. */
.bansho-depth {
  height: 100%;
  transform-origin: 50% 50%;
}
.bansho-stage {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  min-height: 100%;
  transform-origin: 0 0;
  /* Identity from the first frame: the stacking context the transform
     mints exists BEFORE the first camera write, so wheel #1 cannot
     reorder paint. */
  transform: translate(0px, 0px) scale(1);
}
.bansho-panels {
  flex: 1 0 auto;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
/* ── W7: A BOARD HAS A SIZE ────────────────────────────────────────────────
   The panel used to be as wide as the viewer's pane and as tall as it
   liked; now it is PANEL_WIDTH (engine/layout.ts), published as
   --bansho-panel-w on .bansho-board-surface. That is what makes the fold
   canonical: the same board.md wraps the same way, fills the same boards
   and finds the same clean board on every screen. The reader's window is
   absorbed by the camera's rest zoom (engine/stage.ts::restZoom), not by
   the board.

   Height stays a strip's own business — it grows with its content and the
   host writes it back. A WALL's panels get --bansho-panel-h below. */
.bansho-panel {
  flex: none;
  width: var(--bansho-panel-w);
}

/* ── C3: the WALL (@board n) ───────────────────────────────────────────────
   Not a filmstrip. A lecture hall's boards are sliding panels stacked in
   columns AND rows, and four of them in one line makes a wall 5.7
   viewports wide and 0.9 tall — fit it and you are looking at postcards
   over a void. So the panels container is a GRID whose column count comes
   from "engine/wall.ts::wallGrid" (2 across for 2, 3 or 4 boards) and
   whose auto-placement order is row-major, which is exactly the order
   "wallSlot" puts boards in. The grid IS the slot function; there is no
   second copy of the arithmetic anywhere in CSS.

   Panel size is CANONICAL and reads nothing from the window (W7): width =
   PANEL_WIDTH, height = width × 0.72 — both fixed constants in
   engine/layout.ts, published as custom properties by BoardCanvas. Nothing
   below adds a border or padding to ".bansho-panel": its content box is the
   face every box is measured against, so dressing that changed it would
   move ink.

   width: max-content makes the container report the whole wall's extent
   (the camera's clamp box). Single-panel boards never carry
   [data-bansho-multi] and keep the C1 column layout above, bit for bit. */
.bansho-panels[data-bansho-multi] {
  flex: none;
  display: grid;
  grid-template-columns: repeat(var(--bansho-wall-cols, 2), var(--bansho-panel-w));
  grid-auto-rows: var(--bansho-panel-h);
  justify-content: start;
  align-content: start;
  width: max-content;
  gap: var(--bansho-panel-gap, 32px);
}
.bansho-panels[data-bansho-multi] .bansho-panel {
  height: var(--bansho-panel-h);
  overflow: hidden;
}

/* ── The room's furniture ──────────────────────────────────────────────────
   A board hung on nothing is a floating rectangle; a board with a frame
   and a chalk tray beneath it is ON A WALL. The slot is the grid cell —
   it exists ONLY on a wall ("display: contents" collapses it out of the
   single strip's layout entirely, so the C1 flex chain, the offsetParent
   walk "stageOffsetOf" makes, and the layout baseline are untouched by
   construction rather than by care).

   Everything the frame draws is box-shadow and an overflowing pseudo
   element: no border, no padding, nothing that could change the panel's
   own box. The tray hangs in the gap BETWEEN rows (position: absolute, so
   it adds no layout height either) — the wall's own extent stays exactly
   what "wallExtent" says it is, which is what the camera clamps against. */
.bansho-slot {
  display: contents;
}
.bansho-panels[data-bansho-multi] .bansho-slot {
  display: block;
  position: relative;
}
/* The frame: a dark rail around the slate, a thin bright top edge where
   the room's light catches the rail, and the board's own shadow on the
   wall behind it. Rendered on the SLOT, not the panel, so the panel's
   overflow: hidden cannot clip it. */
.bansho-panels[data-bansho-multi] .bansho-slot::before {
  content: "";
  position: absolute;
  inset: -13px;
  border-radius: 5px;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--board-fg) 34%, var(--wall)),
    color-mix(in srgb, var(--board-fg) 14%, var(--wall)) 26%,
    color-mix(in srgb, #000 46%, var(--wall))
  );
  box-shadow:
    0 22px 46px color-mix(in srgb, #000 58%, transparent),
    inset 0 1px 0 color-mix(in srgb, var(--board-fg) 40%, transparent),
    inset 0 -1px 0 color-mix(in srgb, #000 50%, transparent);
  pointer-events: none;
}
/* The chalk tray: a ledge under the frame, lit from above, with the dust
   of a used board along it. It hangs in the gap between rows and below
   the last row — absolutely positioned, so it never enters the wall's
   extent and never moves a board. */
.bansho-panels[data-bansho-multi] .bansho-slot::after {
  content: "";
  position: absolute;
  left: -13px;
  right: -13px;
  top: 100%;
  height: 17px;
  margin-top: 13px;
  border-radius: 0 0 4px 4px;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--board-fg) 52%, var(--wall)),
    color-mix(in srgb, var(--board-fg) 20%, var(--wall)) 34%,
    color-mix(in srgb, #000 52%, var(--wall))
  );
  box-shadow:
    0 10px 20px color-mix(in srgb, #000 55%, transparent),
    inset 0 1px 0 color-mix(in srgb, var(--board-fg) 55%, transparent);
  pointer-events: none;
}
/* The panel sits above its own frame, and reads as slate rather than as a
   pasted rectangle: a hair of inner shadow at the top edge is what a
   recessed board does under room light. */
.bansho-panels[data-bansho-multi] .bansho-panel {
  position: relative;
  z-index: 1;
  box-shadow: inset 0 2px 10px color-mix(in srgb, #000 22%, transparent);
}

/* THE WALL ITSELF. It rides the STAGE (it is the panels container's own
   backdrop, spread out past the boards), not the viewport — a wall that
   stayed still while the boards panned would give the whole illusion away
   on the first drag. The spread is generous because the camera can pull
   back further than the wall is wide, and the radial fall-off is the room
   light: brightest behind the boards, darker toward the corners. */
.bansho-panels[data-bansho-multi]::before {
  content: "";
  position: absolute;
  inset: -26%;
  z-index: -1;
  /* The last stop is EXACTLY the viewport's ambient fill, so the lit patch
     of wall dissolves into the rest of the room instead of ending on a
     visible rectangle. */
  background:
    radial-gradient(
      108% 82% at 50% 18%,
      color-mix(in srgb, var(--wall) 76%, #fff),
      var(--wall) 46%,
      color-mix(in srgb, var(--wall) 74%, #000) 100%
    );
  pointer-events: none;
}
.bansho-panels[data-bansho-multi] {
  position: relative;
  isolation: isolate;
}

/* An erased run (C3): one board's content between two cursor resets, after
   its erase closed it. Absolutely positioned over the panel's origin with
   the panel's own padding (set inline from the computed style), so every
   step keeps the exact coordinates it had in flow — erasing hides, it
   never moves (墨迹是物质). The wrapper is the eraser's EXCLUSIVE visual
   channel (G8-L): the sweep writes clip-path on THIS element and nothing
   any reveal strategy owns. */
.bansho-erased-run {
  position: absolute;
  inset: 0;
}
/* G8-K — the measure layer is the stage's SIBLING, never its descendant.
   Probe readings feed canonical (align widths enter the reconcile hash,
   ink path lengths enter naturalDuration): under a zooming ancestor the
   same source would compile different timelines at different zooms (R8).
   It wears .bansho-board so typography matches the panel byte for byte;
   the compound selector outweighs .bansho-board's position: relative. */
.bansho-measure-layer.bansho-board {
  position: absolute;
  top: 0;
  left: 0;
  /* W7 — the CANONICAL board's width, not the pane's. A run measured
     against the window would wrap where the reader's monitor says, and ink
     is measured at build time, so the underline would be drawn for a line
     nobody sees. The staged build pins the host per box on top of this
     (setMeasureWidth); the notes projection, which pins nothing, gets its
     measure from here. */
  width: var(--bansho-panel-w);
  visibility: hidden;
  pointer-events: none;
}

.bansho-measure-host {
  position: absolute;
  visibility: hidden;
  pointer-events: none;
  left: 44px;
  right: 44px;
  top: 0;
}

/* Step nodes must NOT mint stacking contexts (backref mount contract). */
.bansho-step {
  margin: 0 0 18px;
}
/* The board's own title, written ACROSS the face (BoardCanvas marks a level-1 heading as
   centrepiece, so its box is the whole face rather than one column). Twice
   the writing under it, which is the ratio a lecture still reads at from
   the back of the room. */
.bansho-heading-1 {
  font-size: 68px;
  line-height: 1.28;
  margin: 0 0 36px;
}
/* A section title INSIDE the flow: it stands in its column, and its space
   is asymmetric on purpose — the gap above it is what groups the writing
   below it into a section rather than leaving one even rhythm of blocks. */
.bansho-heading-2 {
  font-size: 50px;
  line-height: 1.32;
  margin: 40px 0 20px;
}
/* The quote block's left bar is DRAWN, not bordered: padding-left only
   reserves the gutter, and the prose factory pulls a jittered vertical hand
   line down it (ASIDE_BAR_X must stay inside this padding). A border-left
   was the one mechanically straight, uniformly thick, perfectly round-capped
   line on a board where every other stroke wobbles — visible at a glance. */
.bansho-aside {
  font-size: 27px;
  opacity: 0.78;
  padding-left: 26px;
}
/* 悬挂缩进 — A WRAPPED BULLET HANGS (W2b, 2026-08-12). Its continuation
   lines sit under the item's TEXT, never back out under the bullet: on a
   board that indent is the whole signal for "still the same item" versus
   "a new one", and a column narrow enough to be a measure wraps items
   often enough for it to matter on every board.

   --bansho-bullet-advance is the bullet's own inline advance, and it is ONE
   decision written in three places — the glyph box (14px, minted by
   factories/prose.ts), the gutter after it, and the hang. They have to
   agree exactly or a continuation line lands beside the first line's text
   instead of under it, which reads as a mistake rather than as an indent.
   Hence the custom property: every other number is derived FROM it.

   THE MECHANISM IS PADDING PLUS A NEGATIVE MARGIN, NOT text-indent, and
   that is not a preference. text-indent is INHERITED and applies to every
   block container it reaches — and every written word on this board is an
   inline-block span (the reveal clip needs a box), so a negative indent
   lands on each of them individually and shreds the line into overlapping
   glyphs. Measured on the live board, 2026-08-12: the first attempt drew
   「据给案 据改比」 for 「证据不给答案，证据只改变比例」.

   The padding moves the whole text column right; the bullet's negative
   margin-left pulls it back to where it always sat. Its NET ADVANCE is
   therefore zero (−advance + glyph + gutter = 0), which is what keeps line
   one's available measure — and so its wrapping, and so every ink path on
   an unwrapped item — exactly what it was. */
.bansho-list-item {
  --bansho-bullet-advance: 28px;
}
.bansho-list-item .bansho-text {
  padding-left: var(--bansho-bullet-advance);
}
.bansho-list-item .bansho-bullet {
  /* Tailwind preflight sets svg { display: block } — the bullet is the one
     in-flow inline svg on the board, so undo it here or the bullet breaks
     onto its own line (invisible in the Tailwind-less engine harness). */
  display: inline-block;
  margin-left: calc(-1 * var(--bansho-bullet-advance));
  /* 14px glyph + this = the advance the hang above is quoted from. */
  margin-right: calc(var(--bansho-bullet-advance) - 14px);
  vertical-align: baseline;
}
.bansho-term {
  color: var(--accent);
}
/* 禁则 — NO LINE MAY BEGIN WITH 。，、？！：；, NONE MAY END WITH 「（(.
   A browser enforces that inside text and cannot enforce it here: every
   written word is its own inline-block (the reveal clip needs a box), and
   Blink hands each atomic inline to the line breaker as U+FFFC, which
   UAX14 breaks freely around. The mode's own per-word reveal is what
   destroys the rule, so the mode has to restore it.

   engine/inference.ts::splitRevealSegments folds a stranded mark into the
   word it belongs to and removes most of these boxes outright; this class
   is the backstop for the residue it cannot reach — a mark whose whole run
   is punctuation (**…**。), where merging would make the unit's srcSpan
   swallow the ** markers. The group holds EXACTLY the two boxes; measured
   2026-08-12 (Chrome 151), a nowrap ancestor is the only mechanism that
   welds two atomic inlines at all — a WORD JOINER between them does not,
   and neither does display:inline on the mark. */
.bansho-nobr {
  white-space: nowrap;
}
/* 主次 — THE CENTREPIECE. A section is usually about one thing, and a
   display formula is the commonest one: it should be visibly what the other
   lines are talking about, not another item in the queue at bullet weight.
   Three moves and it needs all three: 1.35x the body (it was 1.15x),
   CENTRED IN ITS COLUMN, and roughly a body line of air each side — a
   formula packed tight against the prose above it reads as a line of the
   paragraph no matter what size it is set at.

   50 is a CEILING, not a fixed size. MathML never wraps and the corpus's
   widest formula is ~13.5x its own font size wide, so any fixed display
   size is a bet on the reader's window — at 42 that formula fits a 565px
   column and is EATEN by the panel's overflow: hidden in a 465px one. So a
   formula wider than its box shrinks to fit it
   (BoardCanvas::fitMathToBox), and this number is what a formula that fits
   gets to be: half again the body, the size the brief asked for. A formula stays in its column rather than
   taking the face because a face-wide one cannot fit below a filled column
   and walks to a clean board — which spends a whole blackboard on one line
   and re-creates the under-fill this phase exists to kill (measured on the
   bayes wall, 2026-08-12). Charts and graphs DO take the face: they are
   sized by their own drawing rather than by wrapping.

   auto inline margins, not 0: the factory shrinks this host to
   width:fit-content so the clip window hugs the formula (see
   factories/math.ts) — without the auto margins the shrunk block would sit
   against the left padding instead of staying centered on its box, and
   centred-on-the-face is exactly the "written across the board" reading. */
.bansho-math-block {
  font-size: 50px;
  text-align: center;
  margin: 34px auto 40px;
}

/* A structure diagram (T12). The svg is sized by the container's whole
   union, so this only has to give the drawing room to breathe — the
   canvas itself never reflows when a later block lands. */
.bansho-graph {
  margin: 26px 0 34px;
}

/* R6 — a bad step's blast radius is a small badge, never the board. */
.bansho-bad-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-family: ui-sans-serif, system-ui, sans-serif;
  color: color-mix(in srgb, var(--accent) 80%, var(--board-fg));
  border: 1px dashed color-mix(in srgb, var(--accent) 55%, transparent);
  border-radius: 6px;
  padding: 2px 8px;
  margin: 0 0 14px;
  opacity: 0.85;
}

/* Canvas pivot §5.3 — the overlap, DIAGNOSED. Two declarations standing on
   each other look exactly like a broken renderer; this is the difference
   between "the app is wrong" and "you wrote something that collides", so it
   has to be legible without a tooltip and honest about being a report.

   Everything about it is additive. The hatch is faint and the fill is
   nearly nothing, so BOTH parties' ink stays fully readable underneath —
   §5.3 forbids moving, dimming or erasing either one, and a marker that
   obscured its own subject would be doing exactly that in another costume.
   The board's own tokens (--accent, --board-fg) rather than the app's
   cc-* ones: this rides on a seed-themed surface that can be chalk-dark or
   paper-light, and .bansho-bad-badge above set the precedent for an
   on-board diagnostic. */
.bansho-collision {
  border: 1px dashed color-mix(in srgb, var(--accent) 60%, transparent);
  border-radius: 3px;
  background-image: repeating-linear-gradient(
    45deg,
    color-mix(in srgb, var(--accent) 16%, transparent) 0 2px,
    transparent 2px 9px
  );
}

/* The caption sits ABOVE the rectangle's top edge where there is no ink of
   the overlap to cover, and falls back inside it at the board's head. */
.bansho-collision-label {
  position: absolute;
  bottom: 100%;
  left: -1px;
  margin-bottom: 2px;
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  white-space: nowrap;
  font-family: ui-sans-serif, system-ui, sans-serif;
  font-size: 11px;
  line-height: 1.5;
  padding: 1px 7px;
  border-radius: 3px;
  border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
  background: color-mix(in srgb, var(--board-bg, #0b0b0d) 88%, var(--accent));
}
.bansho-collision[data-bansho-collision-caption="inside"]
  .bansho-collision-label {
  bottom: auto;
  top: 0;
  left: 0;
  margin-bottom: 0;
}
.bansho-collision-pair {
  font-weight: 600;
  letter-spacing: 0.02em;
  color: color-mix(in srgb, var(--accent) 85%, var(--board-fg));
}
.bansho-collision-note {
  color: color-mix(in srgb, var(--board-fg) 60%, transparent);
}

/* W8 — THE CUT LINE. A board's panel clips at its edge, so a burst that
   passes the floor takes the rest of the sentence with it and leaves a
   clean bottom edge: the reader sees a sentence stop in the middle, and
   capture hands the agent that same tidy picture. This is the one thing
   on the board that says a word was lost.

   A rule, not a box: the ink below it is clipped, so there is no area to
   draw. It sits at the board's floor, which is the top of the bottom
   margin — the one strip of slate the writing never claims — and the
   caption hangs BELOW it, in that margin, where it cannot cover the last
   line the reader still has.

   Same restraint as .bansho-collision above and the same tokens: it
   reports, it does not scold. Nothing here is measurable — the layer is
   absolutely positioned and pointer-events: none, so no number the fold
   reads can move because a board overflowed. */
.bansho-burst {
  border-top: 1px dashed color-mix(in srgb, var(--accent) 62%, transparent);
}
.bansho-burst-label {
  position: absolute;
  top: 0;
  right: 0;
  margin-top: 3px;
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  white-space: nowrap;
  font-family: ui-sans-serif, system-ui, sans-serif;
  font-size: 11px;
  line-height: 1.5;
  padding: 1px 7px;
  border-radius: 3px;
  border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
  background: color-mix(in srgb, var(--board) 88%, var(--accent));
}
.bansho-burst-where {
  font-weight: 600;
  letter-spacing: 0.02em;
  color: color-mix(in srgb, var(--accent) 85%, var(--board-fg));
}
.bansho-burst-note {
  color: color-mix(in srgb, var(--board-fg) 60%, transparent);
}

/* I1 — a drawn figure. The box is sized by the DECLARED aspect the factory
   writes inline (never by the file), so it holds its place in the fold
   before a single byte of the picture has arrived; the ink layer is the
   board's own color painted through the picture's luminance, which is why
   one asset serves both themes. Bottom margin matches the block rhythm
   (.bansho-placeholder / .bansho-bad-badge). */
.bansho-illustration {
  position: relative;
  display: block;
  /* NO percentage width here — that line was the defect. The mount makes every box
     absolute, and a PERCENTAGE width on an absolute box resolves against
     the containing block, not against the left / right insets the mount just
     wrote: measured 2026-08-13, every figure came out 1242px wide (the
     whole board) at left 633px, hanging 633px off the right edge. The
     width is written explicitly by the mount now, from the region's own
     rectangle; in flow a block box fills its container anyway, so nothing
     is lost by saying nothing here.

     "margin: 0 auto" is how the leftover is split when the picture is
     narrower than its box — with left, right and width all set, auto
     inline margins are the one thing CSS still has to solve for, so it
     gives them equal values and the figure lands in the middle of its
     region. The same mechanism centres display math (.bansho-math-block)
     one rule down; a teacher pins a picture in the middle of the column it
     belongs to, not flush against its edge. The BLOCK margins stay real
     numbers: the fold's §7.5 spacing reads them. */
  margin: 0 auto 14px;
}
.bansho-illustration-ink {
  position: absolute;
  inset: 0;
  /* The picture is a MATTE, not a picture: what you see is the board's own
     ink, painted THROUGH the file's luminance (the mask itself is written
     inline by the factory, which is the only part that varies per figure).
     That is why one asset serves both themes — chalk on slate here, ink on
     plaster in the light one — with nothing regenerated on a theme flip. */
  background-color: var(--board-fg);
}

/* Phase-3 placeholder (html steps have no factory yet). */
.bansho-placeholder {
  font-size: 14px;
  font-family: ui-sans-serif, system-ui, sans-serif;
  color: color-mix(in srgb, var(--board-fg) 55%, transparent);
  border: 1px dashed color-mix(in srgb, var(--board-fg) 25%, transparent);
  border-radius: 8px;
  padding: 10px 12px;
  margin: 0 0 14px;
}

/* T6 — pointing at the board. The whole interaction is "click the thing
   you want to talk about", so every step has to LOOK reachable; the hover
   tint is deliberately faint (a board is not a list of buttons) and the
   selected outline sits outside the box so it never nudges the writing.
   Ink overlays are pointer-events:none, so a click on circled writing
   selects the writing underneath — which is what the user meant. */
.bansho-board[data-bansho-pointing="on"] [data-bansho-ref] {
  cursor: pointer;
  border-radius: 6px;
}
.bansho-board[data-bansho-pointing="on"] [data-bansho-ref]:hover {
  background: color-mix(in srgb, var(--accent) 7%, transparent);
}
.bansho-board [data-bansho-selected],
.bansho-board[data-bansho-pointing="on"] [data-bansho-selected]:hover {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  outline: 2px solid color-mix(in srgb, var(--accent) 65%, transparent);
  outline-offset: 4px;
}

/* C1′ — the board in hand. Both cursor rules are one specificity class
   ABOVE the pointing rule above (surface + attribute + viewport), so a
   step's cursor: pointer yields to grabbing for the whole gesture
   instead of flickering between the two; the ordering is belt to that
   braces. user-select: none lands at the same moment: the press may
   already have begun a native selection, and the host clears it once —
   this keeps the browser from extending it under the moving hand.
   Neither rule exists at rest, so nothing here can touch the layout
   baseline: an ungrabbed board renders byte-identically. */
.bansho-board-surface[data-bansho-grabbing] .bansho-viewport,
.bansho-board-surface[data-bansho-grabbing] .bansho-viewport * {
  cursor: grabbing;
  user-select: none;
  -webkit-user-select: none;
}

/* ── The wall map ──────────────────────────────────────────────────────────
   Board-domain colours, like everything else that depicts the board: the
   map is a picture OF the slate, so it is drawn in the slate's own palette
   rather than in the app's cc-* chrome (the same reasoning the collision
   marker and the bad-step badge already follow).

   The ink is drawn at map scale, where a single word is under a pixel
   tall, so both kinds are quoted at partial opacity and the strokes get a
   vector-effect non-scaling stroke — without it a hand line 1.6px wide on
   the board becomes 0.1px on the map and disappears entirely. */
/* The map's own backdrop is the ROOM, in the same fill the viewport uses
   behind the wall — so a board on the map reads as a board hanging on a
   wall rather than as a tile in a grid. */
.bansho-map {
  background: color-mix(in srgb, var(--wall) 74%, #000);
}
.bansho-map-board {
  fill: var(--board);
  stroke: color-mix(in srgb, var(--board-fg) 34%, transparent);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
  cursor: pointer;
}
.bansho-map-board:hover {
  stroke: var(--accent);
}
.bansho-map-board[data-current="true"] {
  stroke: var(--accent);
  stroke-width: 2;
}
.bansho-map-ink rect {
  fill: color-mix(in srgb, var(--board-fg) 62%, transparent);
}
.bansho-map-ink path {
  fill: none;
  stroke: color-mix(in srgb, var(--board-fg) 72%, transparent);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}
/* The reader's own rectangle. It must read as a WINDOW onto the wall, so
   it is an outline with a faint wash rather than a filled block — the
   writing underneath has to stay visible through it, or the map stops
   answering the question it exists for. */
.bansho-map-viewport {
  fill: color-mix(in srgb, var(--accent) 12%, transparent);
  stroke: var(--accent);
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}

/* ── 瑕疵 — THE IMPERFECTION LAYER (W3) ────────────────────────────────────
   「除了流程，我觉得影响真实感的，是瑕疵……书写区域的四边形随机旋转和形变（我们
   写字有时也会斜）……粉笔随机周边的点击，没有那么干净的黑板。这些程度都可以配置，
   调成 0 就是干干净净的状态。」

   ONE KNOB, and a content set's own "theme.css" owns it, exactly like the
   hand and the wall: "--bansho-flaw: 0" is a perfectly clean board, "1" is
   the tuned default, "3" is the exaggerated look you use to see what the
   knob does. The host reads it once per compile, stamps the seeded
   per-block / per-word values as custom properties, and sets ONE gate
   attribute — "data-bansho-flawed" — only when the knob is above zero.

   THE WHOLE LAYER IS PAINT-TIME, AND THAT IS THE SAFETY ARGUMENT. A CSS
   transform does not affect layout: a leaning box occupies its unleaning
   slot, so nothing here reaches "naturalDuration", a wrap decision, the
   reconcile hash or the fold. The layout baseline is byte-identical with
   the knob ON, which is measured rather than asserted (see
   harness/layout-baseline/README.md, the W3 section).

   Three scoping decisions, each structural:

   - GATED BY AN ATTRIBUTE, NOT BY A ZERO MULTIPLIER. At knob 0 no rule
     below matches at all, so a clean board carries no transform — not
     "rotate(0deg)", which would still mint a stacking context and a
     containing block. Structural absence is the same argument
     ".bansho-depth" makes at rest, and it is what makes 0 provably inert.
   - THE GATE IS ALSO THE MEASUREMENT SUSPENSION. "withFlawSuspended" lifts
     the one attribute for the duration of a funnel read, so the engine
     always measures a dead-flat board. One DOM write, not N.
   - SCOPED TO "[data-bansho-box="1"]" — the flag the fold writes onto a
     placed box. The notes projection (CSS flow, no boxes) and the hidden
     measure host never carry it, so a factory's ink is measured on flat
     text by construction. It also keeps the layer off the backref-at-panel
     -level fallback path, where a step-level stacking context could
     reorder a highlight band under its own glyphs.

   Both transforms are "transform", which no reveal strategy owns (fade
   writes opacity, wipe writes clip-path, stroke writes dashoffset), so the
   channel is disjoint from every reveal state by construction — the same
   discipline G8-L states for the eraser. */
.bansho-board-surface[data-bansho-flawed] [data-bansho-box="1"] {
  transform: translate(var(--bansho-flaw-dx, 0px), var(--bansho-flaw-dy, 0px))
    rotate(var(--bansho-flaw-rot, 0deg)) skewX(var(--bansho-flaw-skew, 0deg));
}
/* 我们写字有时也会斜 — at the WORD scale it is baseline drift, not lean: a
   hand does not track a ruler across a line. The amplitude is about a
   pixel, which is the difference between "written" and "typeset" and is
   NOT visible as motion — every word keeps its own box, so a drifting word
   cannot push its neighbours. */
.bansho-board-surface[data-bansho-flawed] [data-bansho-box="1"] .bansho-w {
  transform: translateY(var(--bansho-flaw-wy, 0px))
    rotate(var(--bansho-flaw-wr, 0deg));
}
/* 没有那么干净的黑板 — the slate REMEMBERS. Chalk grain over the whole face
   plus the broad soft smears a cloth leaves, both quoted in the board's own
   ink colour so a parchment theme grimes brown and a slate theme grimes
   white.

   Deliberately CSS-only and deliberately not ink:
   - it is a background image on a pseudo element, so "wall-outline.ts"
     (which reads ".bansho-w" boxes and "svg" paths) cannot see it — dust is
     not ink and must never enter the wall map;
   - "pointer-events: none" and no "data-bansho-ref", so it is unreachable
     by the pointing seam and invisible to the layout probe;
   - "z-index: 0" and first in paint order, so it sits UNDER the writing:
     grime the teacher wrote over, not a film over the lecture.
   The measure layer is excluded by name — it wears ".bansho-board" for
   typography parity and must stay a pure ruler. */
.bansho-board-surface[data-bansho-flawed]
  .bansho-board:not(.bansho-measure-layer)::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  opacity: calc(var(--bansho-flaw, 0) * 0.85);
  background-image:
    radial-gradient(
      54% 28% at 18% 22%,
      color-mix(in srgb, var(--board-fg) 5%, transparent),
      transparent 70%
    ),
    radial-gradient(
      46% 22% at 76% 44%,
      color-mix(in srgb, var(--board-fg) 4%, transparent),
      transparent 72%
    ),
    radial-gradient(
      62% 18% at 42% 78%,
      color-mix(in srgb, var(--board-fg) 4%, transparent),
      transparent 74%
    ),
    radial-gradient(
      38% 30% at 92% 88%,
      color-mix(in srgb, var(--board-fg) 5%, transparent),
      transparent 70%
    ),
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='260' height='260'%3E%3Cfilter id='f'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.78' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='260' height='260' filter='url(%23f)' opacity='0.42'/%3E%3C/svg%3E");
  background-repeat: no-repeat, no-repeat, no-repeat, no-repeat, repeat;
  background-size: auto, auto, auto, auto, 260px 260px;
}

/* R4 — origin:"external" in-place replacement gives one soft pulse. */
@keyframes bansho-step-pulse {
  0% { background: color-mix(in srgb, var(--accent) 18%, transparent); }
  100% { background: transparent; }
}
.bansho-pulse {
  animation: bansho-step-pulse 700ms ease-out 1;
  border-radius: 6px;
}
`;

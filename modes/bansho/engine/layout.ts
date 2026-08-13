/**
 * layout.ts (C3 面积 + 擦除; canvas pivot V1/V2) — the placement fold:
 * which board AND WHICH REGION every step lives on, where its box lands on
 * that face, and which erase closes which run.
 *
 * Layering (G2): engine core — zero DOM, zero React, no clock, one
 * type-only edge to `engine/regions.ts` (the closed region vocabulary, so
 * this file quotes it rather than restating it). Geometry arrives as
 * measured heights the host read (layout values); the fold is a pure
 * function of `(step sequence, board count, panel budget, face width)`.
 *
 * THE FOLD (rev 2 §1.4 — the one rule that must not break): board
 * membership is a pure PREFIX fold. Steps fill boards in document order;
 * a step that does not fit moves — whole — to the next board (breaks only
 * at step boundaries); an erase resets its board's fill cursor. Three
 * invariants, all property-tested:
 *
 *  1. PREFIX STABILITY (R1 extended): an append lands at the fold's tail;
 *     no existing step's board or coordinates ever move — erasing hides,
 *     it never moves (墨迹是物质).
 *  2. R4 family: a mid-document height change may shift downstream
 *     membership — same class, same treatment as R4 time shifts.
 *  3. A named container's home never migrates: the frame keeps the board
 *     it was first assigned, and every later layer draws back into that
 *     board and RUN — while the run is still OPEN. Ink aimed at a home an
 *     erase has already CLOSED is an ORPHAN: it joins no run (the erase's
 *     declared target set and the DOM subtree it hides must be the same
 *     set — an erase at t=20 must never swallow ink born at t=30) and is
 *     surfaced loudly via `orphaned` (an authoring mistake, never silent
 *     invisibility, never a crash).
 *
 * RUNS: one board's content between two cursor resets is a RUN — the
 * eraser's target unit. Every run starts at its board's top, so target
 * sets are pairwise disjoint by construction (each step belongs to
 * exactly one run; each run is closed by at most one erase; a closed
 * run's membership is FROZEN at close time), which is precisely the §2.2
 * judgement that made erase a `Revealable` instead of a shared register.
 *
 * THE ROOM STOPPED ERASING (canvas pivot V2, design §2.3/§7.3 —
 * 2026-08-11). Auto-erase is GONE, and with it the third tier of the
 * overflow policy, `autoEraseBefore`, and every synthesized `EraseOp`.
 * What survives is the one automatic act nobody has to be told about:
 * taking the pen to a CLEAN board (`cleanBoardTarget` — a never-used one,
 * then a wiped-empty one). When there is no clean board the room STOPS
 * DECIDING: writing continues where it stands and bursts past the bottom
 * edge — visibly, which since W8 means the board draws the cut line the
 * ink dies at — and the author says their own `@erase "锚"`. The room
 * never picks a victim — that is the whole of D-3, and it is a structural
 * property here: after this commit no code path in the fold synthesizes
 * an erase.
 *
 * REGIONS (design §2/§3/§7.2). Board membership folds one grain finer:
 * every content step belongs to a (board, REGION) run. `full` is the
 * room's own flow and the default — today's board is exactly the
 * "one `full` region per board" special case, which is why a document
 * that never says `@at` folds through arithmetically identical
 * operations. A NAMED region (`@at right`, `@at top-left`) is the
 * author's frame: `resolveRegionRect` gives it x/w and a height BUDGET,
 * its cursor is private, and it NEVER migrates — a full frame bursts
 * where it stands (§4). On the strip a placement is EPISODIC: each bare
 * `@at left|right` opens a new one at the write front, and only the
 * anchored form resumes an older one (§3.6).
 *
 * THE BOARD HAS A SIZE (W7, 2026-08-12): `PANEL_WIDTH` x `PANEL_HEIGHT`,
 * fixed, in board px. The panel's height is a pure function of its WIDTH,
 * and its width is a CONSTANT — neither reads the viewport. That is what
 * makes this fold canonical in the full sense R8 always claimed: the same
 * `board.md` folds to the same boards, the same wraps and the same erase
 * verdicts on every screen, and a window resize can no longer rewrite the
 * timeline. The reader's window is absorbed by the CAMERA (`restZoom`),
 * which is the only place it belongs.
 *
 * THE BOX MODEL (canvas pivot V1, design §2/§7.5 — 2026-08-11): every
 * space-occupying step is a BOX on the board's face, and its (x, y, w) is
 * the fold's verdict, not CSS flow's. V1 stands one region per board
 * (`full`), so x = 0 and w = the board's content width for every box; the
 * whole novelty is `y`:
 *
 *     y(first box of a run) = marginTop(first)
 *     y(next)               = y(prev) + h(prev) + gap(prev, next)
 *     gap(a, b)             = max(marginBottom(a), marginTop(b))
 *
 * — CSS adjacent-margin collapsing, written out. The first box keeps its
 * own margin-top because the board's padding blocks collapse-through, so
 * CSS honours it and so must we (measured 2026-08-11 against the pre-V1
 * capture; layout-baseline/README.md records the two residual boxes).
 * `h` and the margins arrive QUANTISED to 1/100 px (`quantise` below):
 * measured geometry is quoted at that resolution, which is what makes the
 * chain reproducible and the offline y-oracle a decidable judge instead of
 * a float race.
 *
 * The box chain is deliberately a SECOND track beside the fill cursor: the
 * cursor keeps charging what it always charged (`foldCharges`), so V1
 * changed no overflow / turn verdict — only where the ink physically
 * lands, and that by design to within the residual §12.2's 3b accounts
 * for. `front` (§2.2) is the deepest STANDING box bottom on the board
 * (every region's, not just the flow's); an erase retires one region's
 * run, and the front falls back to whatever the erase left standing —
 * never blindly to zero, or the flow would write over ink in a corner the
 * erase never touched.
 *
 * WHY BOTH `standing` AND `members` EXIST. `members` is run MEMBERSHIP —
 * the unit an erase closes and the unit "is this board clean?" is judged
 * by, answerable with no geometry at all. `standing` is the measured BOX
 * list — what the front rule, the burst predicate and the collision pass
 * read. They are not interchangeable: a fold handed no box metrics has an
 * empty `standing` and must still refuse to call a charged board clean.
 */

import {
  columnRect,
  columnSpan,
  columnWidth,
  DEFAULT_REGION,
  overlapW,
  regionSpan,
  resolveRegionRect,
  spanUnionArea,
  writtenSpan,
  type FaceSpan,
  type Rect,
  type RegionName,
  type StandingBox,
} from "./regions.js";
import type { Lecture, StepRef } from "./types.js";

// ────────────────────────────────────────────────────────────────────────────
// Geometry constants (board px)
// ────────────────────────────────────────────────────────────────────────────

/**
 * THE BOARD'S OWN WIDTH (board px) — W7, 2026-08-12. A board is a THING
 * with a size, the way a slide is 1920x1080; it is not a view of the
 * reader's window.
 *
 * Until this constant existed the host set `panelW = viewport.clientWidth`,
 * and every consequence of that followed the window: how wide a line is,
 * where it wraps, how much a board holds, which board a passage lands on,
 * whether a `@turn` finds a clean board. Two people opening one `board.md`
 * at two window sizes were watching two different lectures — measured, and
 * the defect this constant closes. R8 ("resizing a window would rewrite the
 * canonical layout") stops being an apology for a dependency the code
 * carried anyway and becomes an invariant: NOTHING downstream of here may
 * read the viewport again.
 *
 * 1242 is CHOSEN, not derived. It is the geometry every screenshot accepted
 * during the composition work was taken at (a 1600x1100 window's viewer
 * pane), and the geometry the 34px body and the 13-character column were
 * tuned against — so adopting it as the canonical board reproduces that
 * reference universe byte for byte instead of moving every wrap by a couple
 * of px for nothing.
 *
 * The camera is what absorbs the reader's window now: see
 * `stage.ts::restZoom`.
 */
export const PANEL_WIDTH = 1242;

/**
 * Multi-board panel height = panel width × THIS. The proportions of a real
 * classroom sliding blackboard — wider than tall. A pure function of the
 * width on purpose (see the module header).
 */
export const PANEL_HEIGHT_RATIO = 0.72;

/** Horizontal gap between side-by-side boards (board px). */
export const PANEL_GAP = 32;

/**
 * A board's total height for a given width (multi-board configurations).
 * The single-board strip has no height — it grows with its content.
 */
export function panelHeightFor(panelW: number): number {
  return Math.round(panelW * PANEL_HEIGHT_RATIO);
}

/** The canonical board's height (board px) — `PANEL_WIDTH` through the
 *  ratio, computed once so no caller re-derives it. */
export const PANEL_HEIGHT = panelHeightFor(PANEL_WIDTH);

// ────────────────────────────────────────────────────────────────────────────
// Keys & the board count
// ────────────────────────────────────────────────────────────────────────────

/**
 * The engine's step key for fold verdicts — same `section:step` format the
 * viewer's `stepKey` (viewer/address.ts) uses, minted here so the pure
 * layer never imports upward.
 */
export function layoutKey(ref: StepRef): string {
  return `${ref.section}:${ref.step}`;
}

/**
 * The lecture's board count: the opening `@board n` stage direction, or 1
 * (the long strip). The parser only ever admits a board-config step as the
 * document's very first step, so only section 0's head can carry one.
 */
export function boardCount(lecture: Lecture): number {
  const first = lecture.sections[0]?.steps[0];
  return first?.kind === "board-config" ? first.count : 1;
}

// ────────────────────────────────────────────────────────────────────────────
// Fold input / output shapes
// ────────────────────────────────────────────────────────────────────────────

/**
 * The §7.5 spacing model's per-step input: the BORDER box height and the
 * two vertical margins, separately (`height` above is the margin box, the
 * fill cursor's charge — one number cannot answer both questions once
 * margins collapse). Absent ⇒ the step occupies no box on the face
 * (a `display:none` container-layer marker), and the chain skips it.
 */
export interface BoxMetrics {
  /** Border-box height, board px. */
  h: number;
  marginTop: number;
  marginBottom: number;
}

/** One step's placed box on the board face (design §7.1's `boxes`). */
export interface LayoutBox {
  /** Distance across the board's CONTENT face — the region word's `x`. */
  x: number;
  /** Distance down the board's CONTENT face to the box's BORDER edge. */
  y: number;
  /** Border-box width — the region word's `w` (`full` ⇒ the whole face). */
  w: number;
}

/** Measured geometry is quoted at 1/100 px — see the module header. */
const quantise = (n: number): number => Math.round(n * 100) / 100;

/** How one step participates in the fold. */
export type LayoutStepInput =
  | {
      kind: "content";
      key: string;
      /** Measured outer height (margin box), board px. */
      height: number;
      /** §7.5 spacing inputs — see `BoxMetrics`. */
      box?: BoxMetrics;
      /**
       * W2 (2026-08-12) — this step is the section's CENTREPIECE and takes
       * the whole face rather than one column of the room's flow: a display
       * formula, a chart, a graph. The thing the other lines are talking
       * about is written ACROSS the board, at a size the back row can read;
       * squeezed into a column it would be neither (measured: the bayes
       * corpus's widest formula is 13.5x its own font size wide, so a 456px
       * column caps display math at body size — no hierarchy at all).
       *
       * A property of the step's KIND, so it is knowable before any
       * measurement — §7.2's build order needs the width up front, and a
       * span that depended on the content's measured width would put a
       * geometry read back in front of the fold. Named regions are
       * untouched: this word is about the room's own flow.
       */
      span?: "face";
      /** Named-container key — a layer returns home to its frame's run. */
      container?: string;
      /**
       * Container layers only: the flow height this step's arrival ADDED
       * to its container's frame node (a graph's dagre canvas regrowing
       * under a new same-name block). The frame's own `height` is measured
       * off the accumulated union — it retroactively includes every
       * layer's growth — so the fold charges the frame at
       * `height − Σ growth` (its first-written size) and charges each
       * layer's growth at the LAYER's document position: space is paid for
       * when the ink that consumes it lands. That is what keeps a pure
       * append from ever moving a step already placed (PREFIX STABILITY
       * under measurement-driven regrowth — the 2026-08-10 review's P1-2).
       */
      growth?: number;
      /**
       * Home by anchor (back references): assign me to THIS step's board
       * and run — my ink draws over it, so I live (and get erased) with
       * it. No cursor spend, exactly the container-layer treatment.
       */
      anchorKey?: string;
    }
  | {
      kind: "erase";
      key: string;
      /** Anchored form: the resolved target step's key; bare form: absent. */
      anchorKey?: string;
    }
  | {
      /**
       * `@at <region>` (canvas pivot V2, design §3): the pen walks to a
       * named region of a board. Pen-scoped — every later content step
       * lands here until the next `@at` / `@turn` / the end. Like `@turn`
       * it is measurement-free: the walk's verdict depends on no height,
       * so a freshly appended placement folds correctly before its first
       * measurement.
       *
       * Anchored form (`anchorKey`): the pen walks to the BOARD holding
       * that step (bounded), or — on the strip — to the placement holding
       * it, resuming it when the words agree and opening a top-ALIGNED
       * sibling when they differ (§3.6's two-column leg). An anchor the
       * parser could not resolve never reaches the fold: it is a bad step
       * and THE PEN DOES NOT MOVE.
       */
      kind: "at";
      key: string;
      region: RegionName;
      anchorKey?: string;
    }
  | {
      /**
       * `@turn` (S1, board-snapshot design §7.6): "new topic, leave that
       * board standing." Inert when the pen's board is already clean;
       * otherwise the pen walks to `nextOverflowTarget`'s pick — the same
       * three-tier policy the overflow branch runs, one implementation.
       * Measurement-free: the fold effect depends on no height, so a
       * freshly appended `@turn` folds correctly before its first
       * measurement (R2-friendly).
       */
      kind: "turn";
      key: string;
    };

/** Where one content step lives. */
export interface PanelAssignment {
  panel: number;
  /**
   * The region it stands in: the word itself on a bounded board
   * (`"full"`, `"top-right"`), the placement id on the strip
   * (`"right#2"` — placements are episodic, so the word alone cannot
   * name one). Unique WITH `panel`; `regions` is keyed
   * `${panel}:${region}`.
   */
  region: string;
  /** The run (one region's content between two resets) it belongs to. */
  run: string;
}

/**
 * One erase. Every one of them is an `@erase` an author wrote: the room
 * synthesizes none (design §2.3 — there is no auto-erase path left).
 */
export interface EraseOp {
  /** The erase step's key. */
  key: string;
  panel: number;
  /** The region/placement it wiped (design §3.5 — erase is region-scoped). */
  region: string;
  /** The run this erase closes ("" when it erased an empty region). */
  run: string;
  /** The steps this erase hides — the closed run's members. */
  targets: readonly string[];
}

/** One region/placement the fold opened, and its frame (design §7.1). */
export interface RegionRecord {
  panel: number;
  /** The region key (`"full"`, `"right#2"`) — `PanelAssignment.region`. */
  key: string;
  /** The word said (or defaulted to). */
  name: RegionName;
  /** The frame on the board's content face. `h` is `Infinity` wherever the
   *  face has no bottom (the strip), which is what makes vertical burst
   *  impossible there rather than merely unlikely. */
  frame: Rect;
  /** The run standing in it now ("" once an erase closed it). */
  standingRun: string;
  /** Placement sequence number of its open run's first step. */
  startSeq: number;
  /** Has it ever held a box? */
  opened: boolean;
  /**
   * The charge standing in it (W9) — what an erase of this region drops to
   * zero. `full`'s is the room's flow summed over its columns, which is
   * `BoardLayout.panels[].cursor` verbatim. Read by the snapshot to answer
   * "how much room is left where the pen actually stands": a named frame's
   * remaining depth is its own, never the board's (the frame does not
   * migrate, so the face's spare room is not the pen's).
   */
  cursor: number;
}

/**
 * A region whose standing content is taller than its frame (design §4):
 * the writing stands where it was put — never shrunk, never moved to
 * another board — and is reported. The room's honesty about the
 * consequence IS the consequence.
 *
 * WHERE THE HONESTY RAN OUT (W8, 2026-08-12). A frame is a budget, so
 * bursting past it is a fact, not a fault — but a board is a physical
 * object with an edge, and writing that passes THE BOARD's bottom is
 * clipped by the panel and simply is not there. `overflow` alone could not
 * tell those two apart, so every surface said "written in full anyway"
 * about ink no reader would ever see. `cut` is that missing distinction:
 * it is the part of the burst that falls past the board's own floor, and
 * it is what the finding warns about and what the board draws a line at.
 */
export interface RegionBurst {
  panel: number;
  region: string;
  name: RegionName;
  /** The deepest standing step in it — the one that went over the edge. */
  key: string;
  /** How far past the frame's bottom the standing content reaches (px). */
  overflow: number;
  /** The frame's own height, for "N px past a 320px frame" wording. */
  frameHeight: number;
  /**
   * The frame it burst out of, on the board's content face — the x/width
   * of the mark the host draws at the cut, so a reader can see WHICH
   * column ran off the board.
   */
  frame: Rect;
  /**
   * How much of the burst falls past THE BOARD's own bottom edge, where
   * the panel clips it and the reader loses it (px). 0 when the writing
   * merely stands past its frame and is still on the board, and 0 on the
   * strip by arithmetic — a face with no bottom cannot cut anything.
   */
  cut: number;
}

export interface BoardLayout {
  count: number;
  /**
   * W2 — how many COLUMNS the room's own flow fills each face in
   * (`regions.ts::columnCountFor`). 1 on the strip and on any face the
   * caller gave no width, which is the pre-W2 arithmetic exactly. A board's
   * flow capacity is `columns × budget`, and consumers that quote
   * occupancy (`board-snapshot.ts`) must multiply.
   */
  columns: number;
  /** Content-step key → board membership. */
  assignments: ReadonlyMap<string, PanelAssignment>;
  /**
   * Canvas pivot V1 — content-step key → its placed box on the board's
   * content face (§7.1/§7.5). Only steps that OCCUPY space appear: a home
   * placement (container layer, back reference) draws into space that
   * already exists and gets no box of its own, and a step whose host
   * supplied no `box` metrics is skipped rather than placed at a guessed
   * zero (silence is not a coordinate).
   */
  boxes: ReadonlyMap<string, LayoutBox>;
  /**
   * Per board, the deepest MARGIN-box bottom standing on its face — what
   * the host writes back as the strip's own height (design §8 rev 2.1:
   * absolutely positioned children cannot hold their parent open). The
   * last box's margin-bottom counts, for the same reason the first box's
   * margin-top does: the board's padding blocks collapse-through. Closed
   * runs count too — a scrub back into one must not meet a short board.
   */
  faceExtent: readonly number[];
  /** Run id → its board and members, in creation order. */
  runs: ReadonlyMap<string, { panel: number; steps: readonly string[] }>;
  /** `${panel}:${region}` → the region/placement, in opening order. */
  regions: ReadonlyMap<string, RegionRecord>;
  /** Every region standing taller than its frame (design §4). */
  bursts: readonly RegionBurst[];
  /** Every erase, document order. */
  eraseOps: readonly EraseOp[];
  /** Steps taller than one board — soft-passed (§9 boardOverflow family).
   *  Also carries a container layer whose growth pushed its home board's
   *  standing content past the board's bottom edge (same family: content
   *  the user cannot see, said out loud). */
  overflowing: readonly string[];
  /**
   * Steps whose home — the run their container frame or anchor target
   * lives in — was already CLOSED by an erase when they arrived. Their ink
   * has no board face to land on (it was wiped before the ink existed):
   * they join no run and no erase's target set, and the host surfaces
   * them as loud findings. Writing aimed at erased content is an
   * authoring mistake — the one wrong answer is silent invisibility.
   */
  orphaned: readonly string[];
  /**
   * The fold's final per-board state, read out for the snapshot projection
   * (S1) — the fold held all of this internally all along; returning it is
   * pure addition. `standingRun` is the board's CURRENT (open) `full` run
   * id; `startSeq` is that run's first placement sequence number
   * (Infinity = empty).
   */
  panels: readonly {
    /** Total flow charge standing on this board — Σ over its columns, so
     *  on a one-column face this is the pre-W2 number verbatim. Judge it
     *  against `columns × budget`, never against `budget`.
     *
     *  IT IS THE FLOW'S CHARGE, NOT THE BOARD'S OCCUPANCY (W9): ink an
     *  `@at` put in a named region charges no column and never appears
     *  here. Anything asking "how full is this board" wants `fill`. */
    cursor: number;
    /**
     * How much of the face STANDS WRITTEN ON, 0..1 (W9) — every claim's
     * ink counted once: the room's flow columns and every named region an
     * `@at` opened, unioned on the unit face
     * (`regions.ts::spanUnionArea`). Two half-width pools written to 80%
     * read 0.8; a `full` box standing over a `left` corner is not counted
     * twice; and no input makes it exceed 1.
     *
     * `1` where there is no capacity to be a fraction of (the strip has no
     * bottom, so it has no fill), which is what keeps a fill-based finding
     * silent on a face that cannot be full.
     *
     * THE ONE OCCUPANCY NUMBER. `turnUnderfilled`'s percentage and the
     * glance's per-board percentage are both this field: an author reads
     * them minutes apart and they may not disagree.
     */
    fill: number;
    opened: boolean;
    startSeq: number;
    standingRun: string;
    /**
     * Does the board hold NOTHING standing — in `full` AND in every named
     * region? That, not an empty `full` cursor, is what "clean" means once
     * a corner can hold ink of its own (`cleanBoardTarget`'s second tier).
     *
     * The predicate is RUN MEMBERSHIP, not measured boxes: membership is
     * the same unit an erase closes, and it is the only one a fold given no
     * box metrics can still answer. (A box-based predicate would call a
     * board carrying real charge "clean" whenever the host supplied no
     * heights — the fold's board-selection verdicts must not depend on
     * whether it was handed geometry. `layout.test.ts` pins that parity.)
     */
    empty: boolean;
  }[];
  /** The board the NEXT stroke lands on — the fold's final write cursor. */
  cur: number;
  /** Where the pen stands at the cut: its board AND its region (§2.1 —
   *  the pen is always in exactly one region). */
  pen: { panel: number; region: string };
  /**
   * Every `@turn`, document order, with its destination board (`panel` =
   * the pen's board after the walk; an inert turn's own board). Needed by
   * the stage mapping: a tier-1/2 or inert turn leaves no trace in
   * `eraseOps`, and a document-tail turn has no later assignment to infer
   * the destination from — without this field a consumer would have to
   * re-run the selection policy, the copy-then-drift §4.1 forbids.
   */
  turns: readonly {
    key: string;
    panel: number;
    inert: boolean;
    /**
     * The turn found no clean board and STAYED (design §3.5/§5.5): the
     * room used to erase the earliest-filled board here and no longer
     * does. Lazy and loud — the host raises `turnOnFullWall`, and the
     * fold produces NO erase (a negative test pins that).
     */
    fullWall: boolean;
    /**
     * W2 — how full the board the pen LEFT was, 0..1, read BEFORE the walk.
     * The source board, not the destination: the question `turnUnderfilled`
     * asks is "did you walk away from a board you had barely written on",
     * and the destination is clean by construction.
     *
     * The same number as `panels[].fill` (W9 — it is that function, read at
     * the turn): every claim on the face counted once, `@at` placements
     * included. Before W9 it was the flow's cursors alone, so a board
     * composed of two side-by-side pools reported 14% while standing full
     * and was accused of being abandoned half-written.
     */
    fill: number;
  }[];
}

// ────────────────────────────────────────────────────────────────────────────
// The overflow selection policy — ONE implementation, three consumers
// ────────────────────────────────────────────────────────────────────────────

/** The per-board facts the clean-board policy reads (a structural subset
 *  of both the fold's internal state and `BoardLayout.panels`). */
export interface CleanPanelState {
  opened: boolean;
  /** Nothing standing in ANY region — see `BoardLayout.panels[].empty`. */
  empty: boolean;
}

/**
 * The ONE automatic act the room still performs: taking the pen to a
 * CLEAN board (design §7.3). Two tiers — a NEVER-USED board first (boards
 * open in document order), then one an erase has emptied. `null` is the
 * full wall, and it means the room has nothing to say: it does not pick a
 * victim, does not erase, does not move the pen. Writing continues where
 * it stands and bursts (§2.3) — and `visibly` is a promise the BOARD keeps,
 * not this fold: the panel's edge clips whatever passes it, so the reader's
 * half of the honesty is the cut line the host draws from `RegionBurst.cut`
 * (`viewer/board-check.ts::burstMarks`). Before W8 that line did not exist
 * and the word here was simply untrue.
 *
 * The single implementation behind three consumers: the fold's `full`
 * overflow branch, `@turn`'s target selection, and the snapshot's
 * `pen.next`. A second copy of this policy is the drift the design most
 * wants to avoid — extend HERE or nowhere.
 *
 * The third tier this function used to have (erase the earliest-filled)
 * died with auto-erase on 2026-08-11; `startSeq` was ONLY ever read to
 * choose that victim, which is why the state shape lost it.
 */
export function cleanBoardTarget(
  panelStates: readonly CleanPanelState[],
): { panel: number; kind: "fresh" | "wiped" } | null {
  for (let p = 0; p < panelStates.length; p++) {
    if (!panelStates[p]!.opened) return { panel: p, kind: "fresh" };
  }
  for (let p = 0; p < panelStates.length; p++) {
    if (panelStates[p]!.empty) return { panel: p, kind: "wiped" };
  }
  return null;
}

/**
 * The board's STANDING boxes, as the collision pass sees them (design
 * §5.1) — the join the fold deliberately does not make for you.
 *
 * The fold publishes a box's origin and width; its HEIGHT stays with the
 * measurement that produced it (§7.1), so the two halves meet here, in one
 * exported place, rather than in each of the three consumers. Standing
 * means the step's run is still its region's OPEN run: an erased run's
 * boxes are hidden, and hidden ink collides with nothing.
 */
export function standingBoxes(
  layout: BoardLayout,
  inputs: readonly LayoutStepInput[],
): StandingBox[] {
  const heights = new Map<string, number>();
  for (const input of inputs) {
    if (input.kind === "content" && input.box) heights.set(input.key, input.box.h);
  }
  const out: StandingBox[] = [];
  for (const [key, box] of layout.boxes) {
    const assignment = layout.assignments.get(key);
    if (!assignment) continue;
    const record = layout.regions.get(`${assignment.panel}:${assignment.region}`);
    if (!record || record.standingRun !== assignment.run) continue;
    const h = heights.get(key);
    if (h === undefined) continue;
    out.push({
      key,
      panel: assignment.panel,
      region: assignment.region,
      rect: { x: box.x, y: box.y, w: box.w, h: quantise(h) },
    });
  }
  return out;
}

/**
 * Which region WORD every content step is written in — a pure prefix scan
 * of the step sequence, taking NO heights (design §7.2's build-order pin).
 *
 * The measure pass has to know a step's width before the fold can run,
 * because a named step must be measured at its region's width or its
 * height answers the wrong question (§9's guard). The pen's WORD is
 * knowable without geometry: `@at` says it, `@turn` returns it to `full`
 * unconditionally, nothing else touches it. What is NOT knowable without
 * geometry — which BOARD, which strip PLACEMENT, hence a placement's frame
 * top — is not needed here: on any one face every `left` is the same
 * width.
 *
 * The one inexactness is deliberate and bounded: an anchored `@at` whose
 * anchor folds to nothing leaves the pen where it stood, and only the fold
 * knows that. This scan believes the word. The host's corrective pass
 * (measure → fold → compare `box.w` against the width the step was
 * measured at → re-measure once) repairs that step and would repair any
 * other divergence, which is what keeps this an OPTIMISATION rather than a
 * second source of truth.
 */
export function scanRegionWords(
  steps: readonly LayoutStepInput[],
): Map<string, RegionName> {
  const words = new Map<string, RegionName>();
  let pen: RegionName = DEFAULT_REGION;
  for (const input of steps) {
    if (input.kind === "at") {
      pen = input.region;
      continue;
    }
    if (input.kind === "turn") {
      pen = DEFAULT_REGION;
      continue;
    }
    if (input.kind === "content") words.set(input.key, pen);
  }
  return words;
}

/** The face a measure pass is standing on, in the fold's own terms. */
export interface MeasureFace {
  /** The board's CONTENT face width (board px). */
  faceW: number;
  /** The face's height; `Infinity` on the strip. */
  faceH: number;
  /** The room's flow column count for this face (`columnCountFor`). */
  columns: number;
}

/**
 * The rectangle every content step's box will CLAIM on this face — the
 * width half of design §7.2's build-order pin, computed with no heights
 * and therefore before the fold.
 *
 * THIS IS THE ONE ANSWER TO "HOW WIDE IS THIS BOX", and it has two
 * consumers that must not be allowed to disagree: the MEASURE pass (which
 * sizes the hidden host so a run wraps where it will really wrap, so its
 * ink is drawn under the lines it will really occupy) and the MOUNT pass
 * (which writes `left`/`right` on the node). A second copy of the region
 * arithmetic in either would be §4.1 drift with a very quiet symptom —
 * text that wraps one way and ink that was drawn for another.
 *
 * How the three cases are decided, all of them from the region word alone:
 *  - a NAMED word (`left`, `top-right`, …) claims exactly what §3.2's
 *    table says on this face — `resolveRegionRect`, no second copy;
 *  - `full` + `span: "face"` (a centrepiece) claims the whole face;
 *  - `full` claims ONE COLUMN. Which column is the fold's verdict and is
 *    not knowable here, but how WIDE it is, is: every column of a face is
 *    the same width by construction, which is exactly why the measure pass
 *    can run first (design §7.2).
 *
 * `x` is the word's own edge and is PROVISIONAL for a `full` step — the
 * fold restates every box's origin once membership is known. Only `w` is
 * a promise.
 */
export function scanBoxRects(
  steps: readonly LayoutStepInput[],
  face: MeasureFace,
): Map<string, Rect> {
  const words = scanRegionWords(steps);
  const colW = columnWidth(face.faceW, face.columns);
  const rects = new Map<string, Rect>();
  for (const input of steps) {
    if (input.kind !== "content") continue;
    const word = words.get(input.key) ?? DEFAULT_REGION;
    const verdict = resolveRegionRect(word, face.faceW, face.faceH);
    if (!verdict.ok) {
      // Unreachable through `scanRegionWords` (its output is typed to the
      // vocabulary) — the whole face is the conservative claim if a future
      // caller hands in a word the face does not admit.
      rects.set(input.key, { x: 0, y: 0, w: face.faceW, h: face.faceH });
      continue;
    }
    rects.set(
      input.key,
      word === DEFAULT_REGION && input.span !== "face"
        ? { ...verdict.rect, w: colW }
        : verdict.rect,
    );
  }
  return rects;
}

/**
 * Each content step's fold CHARGE — the height the fold bills it at: a
 * plain step its measured height, a container frame its first-written size
 * (`height − Σ growth`), a container layer the growth its arrival caused,
 * an anchored back reference nothing. The snapshot's roomSteps hint reads
 * these for its median-unit estimate; the fold's own cursors remain the
 * authoritative occupancy (`BoardLayout.panels`).
 */
export function foldCharges(
  steps: readonly LayoutStepInput[],
): Map<string, number> {
  const growthOf = new Map<string, number>();
  for (const input of steps) {
    if (
      input.kind === "content" &&
      input.container !== undefined &&
      input.growth !== undefined &&
      input.growth > 0
    ) {
      growthOf.set(
        input.container,
        (growthOf.get(input.container) ?? 0) + input.growth,
      );
    }
  }
  const charges = new Map<string, number>();
  const seenContainers = new Set<string>();
  for (const input of steps) {
    if (input.kind !== "content") continue;
    if (input.anchorKey !== undefined) {
      charges.set(input.key, 0);
      continue;
    }
    if (input.container !== undefined) {
      if (seenContainers.has(input.container)) {
        charges.set(input.key, Math.max(0, input.growth ?? 0));
      } else {
        seenContainers.add(input.container);
        charges.set(
          input.key,
          Math.max(0, input.height - (growthOf.get(input.container) ?? 0)),
        );
      }
      continue;
    }
    charges.set(input.key, Math.max(0, input.height));
  }
  return charges;
}

// ────────────────────────────────────────────────────────────────────────────
// The fold
// ────────────────────────────────────────────────────────────────────────────

/**
 * One NAMED region/placement's private state. `full` has none: it IS the
 * panel's own flow (its front is the board-wide front, §2.2), which is
 * also why a document that never says `@at` allocates none of these and
 * runs through exactly the arithmetic it ran through before regions
 * existed.
 */
interface RegionState {
  key: string;
  name: RegionName;
  frame: Rect;
  /**
   * The charge standing in this region — its own column of the flow's
   * `cols[i].cursor`, in the same currency (W9). It buys nothing in
   * PLACEMENT (a named region chains on its private front and never
   * migrates, so it needs no fits-in test); it exists so the face can be
   * asked how full it is and answer for ALL of its ink. Before W9 nothing
   * counted it, and a board composed entirely of `@at` placements read
   * near-zero while standing visibly full.
   */
  cursor: number;
  /** The §7.5 chain, based at `frame.y` instead of the board's front. */
  front: number;
  frontMarginBottom: number;
  frontOpen: boolean;
  run: string;
  startSeq: number;
  opened: boolean;
  members: string[];
}

/** One placed box on a board face, kept so an erase can recompute the
 *  front from what is LEFT standing rather than snapping it to zero, and so
 *  a column can ask which standing ink is actually IN ITS WAY (`x`/`w`).
 *  The fold's own bookkeeping — the exported, geometry-carrying shape the
 *  collision pass reads is `regions.ts::StandingBox`. */
interface PlacedBox {
  key: string;
  region: string;
  x: number;
  w: number;
  bottom: number;
  marginBottom: number;
}

/** The §7.5 chain's three numbers, for whichever cursor is being chained
 *  on: a named region's private front, or one column of the room's flow. */
interface Front {
  front: number;
  marginBottom: number;
  open: boolean;
}

/** One column of the room's own flow: its rectangle on the face, and the
 *  charge standing in it (the overflow ladder's rung). */
interface ColumnState {
  rect: Rect;
  cursor: number;
}

interface PanelState {
  /**
   * The room's flow, one rung per column, and which rung the pen is on.
   * `cols[i].cursor` is the charge standing in column `i`; the pen walks to
   * `col + 1` when the current column will not take the next box, and only
   * a FULL FACE (every column past the budget) walks to a clean board.
   * A one-column face is the pre-W2 fold exactly: one cursor, one rung, no
   * column break to reach.
   */
  cols: ColumnState[];
  col: number;
  /**
   * The deepest MARGIN-box bottom the board has ever held, closed runs
   * included — the face's height, which an erase must NOT shrink (G5: a
   * scrub back into a closed run needs the board still tall enough to show
   * it).
   */
  extent: number;
  /** Sequence number of the current run's first step; Infinity = empty. */
  startSeq: number;
  /** The `full` region's open run id; null until its first box (run ids
   *  are minted lazily now that named regions draw from the same
   *  per-board counter). */
  run: string | null;
  /** How many runs this board has opened (run id suffix). */
  runIndex: number;
  /** Whether the board has EVER held content — boards open in index
   *  order (按文档序填板), so a never-used board beats reusing an
   *  erased-empty one. */
  opened: boolean;
  members: string[];
  /** Named regions only, in opening order (`full` is the panel itself). */
  regions: Map<string, RegionState>;
  /** Every box standing on this face, any region, in placement order. */
  standing: PlacedBox[];
  /** Strip placements are episodic, so their keys carry a sequence. */
  placementSeq: number;
}

const runId = (panel: number, index: number): string => `${panel}.${index}`;

/**
 * Fold the document into board membership. `budget` is one board's
 * CONTENT height allowance (panel height minus its paddings) —
 * `Infinity` for the single-board strip, which therefore never overflows
 * and never auto-erases.
 *
 * Deterministic and prefix-stable by construction: one forward pass, all
 * outputs append-only.
 *
 * `cutIndex` (S1, board-snapshot design §3): stop the MAIN loop after
 * consuming that many inputs — the snapshot's "fold stopped at a document
 * position". The `growthOf` pre-pass still runs over ALL inputs, never a
 * slice: a container frame's measured height is the accumulated union
 * (post-cut layers already grown into it), so its charge is
 * `height − Σ growth` over the FULL document — slicing the input instead
 * would re-create P1-2's mechanism (the frame over-charged, cursors
 * inflated, overflow verdicts flipped). Prefix stability makes the result
 * literally the full fold's mid-state at that position.
 */
export function foldBoardLayout(
  steps: readonly LayoutStepInput[],
  count: number,
  budget: number,
  cutIndex?: number,
  /**
   * The board's CONTENT face width — a `full` box's own `w`, and the `W`
   * the region table divides to give a named region its `x`/`w` (§3.2).
   * Omitted (0) when the caller only wants membership verdicts: the
   * snapshot basis reads runs and cursors, never geometry, and a
   * fabricated width there would be a second source of truth for the same
   * number. `budget` doubles as the face's HEIGHT (`H`) — on a bounded
   * board they are the same quantity read twice (the content box's
   * height), and on the strip both are `Infinity`, which is exactly what
   * makes vertical burst impossible there by arithmetic instead of by a
   * special case.
   */
  frameWidth = 0,
  /**
   * W2 — how many COLUMNS the room's own flow fills a face in
   * (`regions.ts::columnCountFor`, computed by the caller because the fold
   * must not read geometry it was not handed).
   *
   * It is an EXPLICIT parameter rather than something derived from
   * `frameWidth` here, and that is load-bearing: the snapshot basis folds
   * with no width at all (membership needs no geometry), so deriving the
   * count from the width would give the glance a one-column fold and the
   * board a two-column one — the two would disagree about board membership
   * at the first overflow, and the glance would answer for a board that is
   * not the one performing. Both call sites compute it the same way, from
   * the same function. `layout.test.ts` pins the parity.
   */
  columns = 1,
): BoardLayout {
  const colCount = Math.max(1, Math.floor(columns));
  const assignments = new Map<string, PanelAssignment>();
  const boxes = new Map<string, LayoutBox>();
  const runs = new Map<string, { panel: number; steps: string[] }>();
  const eraseOps: EraseOp[] = [];
  const overflowing: string[] = [];
  const orphaned: string[] = [];
  const turns: {
    key: string;
    panel: number;
    inert: boolean;
    fullWall: boolean;
    fill: number;
  }[] = [];
  /** Container key → the home run recorded at the frame's assignment. */
  const containerHome = new Map<string, PanelAssignment>();
  /** Σ declared growth per container — the slice of a frame's measured
   *  height that its later layers added. Subtracted from the frame's own
   *  charge (the layers pay it at THEIR positions), which is what keeps
   *  the charge sequence identical whether the layers exist yet or not. */
  const growthOf = new Map<string, number>();
  for (const input of steps) {
    if (
      input.kind === "content" &&
      input.container !== undefined &&
      input.growth !== undefined &&
      input.growth > 0
    ) {
      growthOf.set(
        input.container,
        (growthOf.get(input.container) ?? 0) + input.growth,
      );
    }
  }

  /** The face this fold is standing on: the strip's has no bottom. */
  const faceHeight = budget;
  const strip = !Number.isFinite(faceHeight);
  /** The room's flow columns on this face — one rectangle each, shared by
   *  every board (the wall's faces are identical by construction). */
  const colRects: Rect[] = [];
  for (let i = 0; i < colCount; i++) {
    colRects.push(columnRect(frameWidth, faceHeight, i, colCount));
  }
  /** The whole face, as the centrepiece's own claim (`span: "face"`). */
  const faceRect: Rect = { x: 0, y: 0, w: frameWidth, h: faceHeight };

  const panels: PanelState[] = [];
  for (let p = 0; p < Math.max(1, count); p++) {
    panels.push({
      cols: colRects.map((rect) => ({ rect, cursor: 0 })),
      col: 0,
      extent: 0,
      startSeq: Infinity,
      run: null,
      runIndex: 0,
      opened: false,
      members: [],
      regions: new Map(),
      standing: [],
      placementSeq: 0,
    });
  }
  let cur = 0;
  let seq = 0;
  /** The pen's region on its board — `full` until an `@at` says otherwise. */
  let penRegion: string = DEFAULT_REGION;

  /**
   * Does this board hold NOTHING standing — `full` empty and every named
   * region empty? The unit is RUN MEMBERSHIP (what an erase closes), not
   * the measured box list: a fold handed no box metrics still answers this
   * correctly, so board selection never depends on whether the caller had
   * geometry to give. See `BoardLayout.panels[].empty`.
   */
  const boardEmpty = (state: PanelState): boolean => {
    if (state.members.length > 0) return false;
    for (const named of state.regions.values()) {
      if (named.members.length > 0) return false;
    }
    return true;
  };

  /**
   * How much of this face STANDS WRITTEN ON, 0..1 (W9) — the area its
   * claims cover between them, on the unit face.
   *
   * WHAT IT COUNTS AND WHY IT IS AN AREA. A board's ink lives in several
   * claims at once: the room's flow, one column at a time, and every named
   * region an `@at` opened, each with its own private cursor and its own
   * budget. Summing cursors answered for the flow alone — so a face
   * composed entirely of `@at` placements reported near-zero while
   * standing full, and `turnUnderfilled` accused it of being abandoned.
   * Summing the claims instead would double-count the one overlap design
   * §5.2 ratifies (`full` and `left` may both hold ink). The union of what
   * is written does neither, and cannot exceed 1 by construction rather
   * than by a clamp.
   *
   * IT READS `name`, NEVER `frame`. The glance folds with no face width
   * (`viewer/glance.ts`), where `resolveRegionRect`'s pixels are garbage
   * and `RegionState.frame` with them — but the word and the charge are
   * exact. That is what makes the glance's percentage and the board's the
   * same number instead of two numbers that usually agree.
   *
   * `1` where there is no capacity to be a fraction of (the strip has no
   * bottom, so it has no fill), so a fill-based finding cannot fire on a
   * face with nothing to fill.
   */
  const boardFill = (state: PanelState): number => {
    if (!Number.isFinite(budget) || budget <= 0) return 1;
    const written: FaceSpan[] = [];
    for (let i = 0; i < state.cols.length; i++) {
      const part = writtenSpan(
        columnSpan(i, state.cols.length),
        state.cols[i]!.cursor,
        budget,
      );
      if (part) written.push(part);
    }
    for (const named of state.regions.values()) {
      const part = writtenSpan(regionSpan(named.name), named.cursor, budget);
      if (part) written.push(part);
    }
    return spanUnionArea(written);
  };

  /** The clean-board policy's view of the wall (design §7.3). */
  const cleanStates = (): CleanPanelState[] =>
    panels.map((state) => ({
      opened: state.opened,
      empty: boardEmpty(state),
    }));

  /** Mint a run id from the board's own counter — one counter per board,
   *  so run ids read the same whether the board holds one region or five. */
  const mintRun = (p: number): string => {
    const state = panels[p]!;
    const id = runId(p, state.runIndex);
    state.runIndex += 1;
    return id;
  };

  /**
   * The write front IN A GIVEN COLUMN OF THE FACE (§2.2, W2's one
   * generalisation): the deepest bottom among boxes STILL STANDING that
   * are actually IN THE WAY — that is, whose own span overlaps the
   * rectangle about to be written in — with the margin-bottom of the box
   * that defines it.
   *
   * ONE COLUMN IS THE OLD RULE, STATEMENT FOR STATEMENT. Every region
   * rectangle lies inside the face, so with a single full-width column
   * every standing box overlaps it and this is the board-wide front the
   * pre-W2 fold computed — no special case, no second path. What the
   * generalisation buys is the only thing that makes columns work at all:
   * column 2 starts at the TOP of the face, because the ink filling column
   * 1 is not in its way — while a named `left` corner's ink, or a
   * face-spanning centrepiece, still IS.
   *
   * It is computed on demand rather than cached because an erase already
   * had to recompute it (清场开新章, but only past what the erase actually
   * took: content standing in ANOTHER region is still there and the flow
   * must not write over it), so a cache would have exactly one live
   * reader and one invalidation site.
   */
  const frontIn = (state: PanelState, claim: Rect): Front => {
    let front = 0;
    let marginBottom = 0;
    let open = false;
    for (const box of state.standing) {
      if (overlapW(claim, { x: box.x, y: 0, w: box.w, h: 0 }) <= 0) continue;
      open = true;
      if (box.bottom >= front) {
        front = box.bottom;
        marginBottom = box.marginBottom;
      }
    }
    return { front, marginBottom, open };
  };

  /** The board-wide front — every column at once. What a strip placement's
   *  frame top is measured from (design §3.6: a placement opens at the
   *  write front, and on the strip that is the whole face's). */
  const boardFront = (state: PanelState): number =>
    frontIn(state, faceRect).front;

  /** The open run of one region ("" when nothing stands in it). */
  const openRunOf = (p: number, region: string): string => {
    const state = panels[p]!;
    if (region === DEFAULT_REGION) return state.run ?? "";
    return state.regions.get(region)?.run ?? "";
  };

  /**
   * Close one REGION's run (design §3.5 — the eraser's unit narrowed from
   * a board to a region/placement) and reset its cursor. Bare `@erase`
   * wipes the pen's region, so on a board that never said `@at` this is
   * word for word the old whole-board erase: the pen stands in `full` and
   * `full` is the whole board.
   */
  const reset = (p: number, region: string, key: string): void => {
    const state = panels[p]!;
    const named = region === DEFAULT_REGION ? null : state.regions.get(region);
    const members = named ? named.members : state.members;
    const hadContent = members.length > 0;
    eraseOps.push({
      key,
      panel: p,
      region,
      run: hadContent ? openRunOf(p, region) : "",
      targets: hadContent ? [...members] : [],
    });
    if (named) {
      if (hadContent) named.members = [];
      named.run = "";
      named.startSeq = Infinity;
      // The region's charge goes with its ink — an erased corner is empty
      // room again, exactly as an erased flow drops its columns to zero.
      named.cursor = 0;
      named.front = named.frame.y;
      named.frontMarginBottom = 0;
      named.frontOpen = false;
    } else {
      if (hadContent) state.members = [];
      state.run = null;
      // The room's flow is ONE region across all its columns, so its erase
      // wipes every column of it and the pen returns to the first — a
      // teacher who wipes the board starts at the top left again.
      for (const col of state.cols) col.cursor = 0;
      state.col = 0;
      state.startSeq = Infinity;
    }
    // The erased run stops standing, so the front falls back — 清场开新章
    // — but only past what the erase actually took: content standing in
    // ANOTHER region is still there, and the flow must not write over it.
    // (`frontIn` reads `standing` directly, so filtering it IS the fall
    // back.) `extent` deliberately does NOT fall back: the ink is still
    // mounted (hidden), and a scrub back must find a board tall enough to
    // show it.
    state.standing = state.standing.filter((box) => box.region !== region);
  };

  const place = (
    p: number,
    region: string,
    input: Extract<LayoutStepInput, { kind: "content" }>,
    charge: number,
  ): void => {
    const state = panels[p]!;
    const named = region === DEFAULT_REGION ? null : state.regions.get(region)!;
    if (named) {
      if (named.startSeq === Infinity) named.startSeq = seq;
      named.opened = true;
      if (!named.run) named.run = mintRun(p);
    } else {
      if (state.startSeq === Infinity) state.startSeq = seq;
      if (!state.run) state.run = mintRun(p);
    }
    state.opened = true;
    seq += 1;
    const run = openRunOf(p, region);
    if (named) {
      named.members.push(input.key);
      // The author's frame is charged like a column of the room's own
      // flow — same currency, private cursor (W9). It changes no
      // placement: a named region chains on its own front and never
      // migrates, so nothing here is ever asked "does it fit".
      named.cursor += charge;
    } else {
      state.members.push(input.key);
      // The flow's charge lands on the rung the pen is standing on — and a
      // face-spanning centrepiece charges EVERY rung, because it occupies
      // that much of every column's remaining depth.
      if (input.span === "face") for (const col of state.cols) col.cursor += charge;
      else state.cols[state.col]!.cursor += charge;
    }
    assignments.set(input.key, { panel: p, region, run });
    let record = runs.get(run);
    if (!record) {
      record = { panel: p, steps: [] };
      runs.set(run, record);
    }
    record.steps.push(input.key);
    if (input.container !== undefined && !containerHome.has(input.container)) {
      containerHome.set(input.container, { panel: p, region, run });
    }
    if (charge > budget) overflowing.push(input.key);
    placeBox(state, named, input);
  };

  /**
   * The §7.5 chain (module header): the next box lands at its region's
   * write front plus the collapsed gap, or — opening a run — at the
   * frame's top plus its own margin-top. Pure arithmetic on quantised
   * measurements; it moves no box already placed, which is prefix
   * stability in the geometric register.
   *
   * `full` chains on the front OF THE COLUMN IT IS WRITTEN IN (§2.2 as
   * generalised by `frontIn`): the room's flow never writes over ink, so
   * "carry on below" means below everything standing IN ITS WAY — a named
   * corner sharing that column included, a centrepiece written across the
   * face included, and the other column's writing excluded, which is the
   * whole point. A named region chains on its own private front — the
   * author's frame, the author's cursor, the author's consequence.
   */
  const placeBox = (
    state: PanelState,
    named: RegionState | null,
    input: Extract<LayoutStepInput, { kind: "content" }>,
  ): void => {
    const box = input.box;
    if (!box) return;
    const h = quantise(box.h);
    const marginTop = quantise(box.marginTop);
    const marginBottom = quantise(box.marginBottom);
    // The claim: a named region's frame, the centrepiece's whole face, or
    // the column the pen is standing in.
    const claim: Rect = named
      ? named.frame
      : input.span === "face"
        ? faceRect
        : state.cols[state.col]!.rect;
    const chain: Front = named
      ? {
          front: named.front,
          marginBottom: named.frontMarginBottom,
          open: named.frontOpen,
        }
      : frontIn(state, claim);
    const y = chain.open
      ? quantise(chain.front + Math.max(chain.marginBottom, marginTop))
      : quantise(claim.y + marginTop);
    boxes.set(input.key, { x: claim.x, y, w: claim.w });
    const bottom = quantise(y + h);
    if (named) {
      named.front = Math.max(named.front, bottom);
      named.frontMarginBottom = marginBottom;
      named.frontOpen = true;
    }
    state.standing.push({
      key: input.key,
      region: named ? named.key : DEFAULT_REGION,
      x: claim.x,
      w: claim.w,
      bottom,
      marginBottom,
    });
    state.extent = Math.max(state.extent, quantise(y + h + marginBottom));
  };

  /**
   * Walk the pen to a region (design §3). Bounded boards RESUME a named
   * region that already stands; the strip opens a NEW placement for every
   * bare `@at`, because a placement there is an episode at the write
   * front, not a fixed column to be continued hundreds of px above.
   */
  const openRegion = (
    p: number,
    name: RegionName,
    resumeKey: string | null,
    frameTopOverride: number | null,
  ): string => {
    if (name === DEFAULT_REGION) return DEFAULT_REGION;
    const state = panels[p]!;
    if (resumeKey && state.regions.has(resumeKey)) return resumeKey;
    const verdict = resolveRegionRect(name, frameWidth, faceHeight);
    // A word illegal on this face never reaches the fold (the parser makes
    // it a bad step, design §3.2/§3.6). Refusing to guess here as well is
    // the same rule stated twice on purpose: no silent fallback to `full`.
    if (!verdict.ok) return DEFAULT_REGION;
    const key = strip
      ? `${name}#${(state.placementSeq += 1)}`
      : name;
    const existing = state.regions.get(key);
    if (existing) return key;
    const frame: Rect = strip
      ? {
          ...verdict.rect,
          y: frameTopOverride ?? boardFront(state),
          h: Infinity,
        }
      : verdict.rect;
    state.regions.set(key, {
      key,
      name,
      frame,
      cursor: 0,
      front: frame.y,
      frontMarginBottom: 0,
      frontOpen: false,
      run: "",
      startSeq: Infinity,
      opened: false,
      members: [],
    });
    return key;
  };

  const limit = Math.min(cutIndex ?? steps.length, steps.length);
  for (let idx = 0; idx < limit; idx++) {
    const input = steps[idx]!;
    if (input.kind === "erase") {
      // Design §3.5: the eraser's unit is the REGION now. Bare form wipes
      // the pen's region; the anchored form wipes the region the anchor
      // stands in. On a board that never said `@at` both read exactly as
      // they used to — the pen is in `full`, and `full` IS the board.
      const anchored =
        input.anchorKey !== undefined
          ? assignments.get(input.anchorKey)
          : undefined;
      if (input.anchorKey !== undefined) {
        if (anchored) reset(anchored.panel, anchored.region, input.key);
        else reset(cur, penRegion, input.key);
      } else {
        reset(cur, penRegion, input.key);
      }
      continue;
    }

    if (input.kind === "at") {
      // The pen walks (design §3). The anchored form crosses to the board
      // holding the anchor; on the strip it resumes the placement holding
      // it, or — when the word differs — opens a sibling at the SAME
      // frame top, which is how two columns get set against each other.
      const anchor =
        input.anchorKey !== undefined
          ? assignments.get(input.anchorKey)
          : undefined;
      if (input.anchorKey !== undefined && !anchor) {
        // The anchor resolved at parse time but folded to nothing (its
        // step is an orphan, or lies past the cut). THE PEN DOES NOT MOVE.
        continue;
      }
      const panel = anchor ? anchor.panel : cur;
      const anchorRegion = anchor
        ? panels[panel]!.regions.get(anchor.region)
        : undefined;
      const resumeKey =
        anchor && anchorRegion && anchorRegion.name === input.region
          ? anchor.region
          : null;
      cur = panel;
      penRegion = openRegion(
        panel,
        input.region,
        resumeKey,
        anchorRegion ? anchorRegion.frame.y : null,
      );
      continue;
    }

    if (input.kind === "turn") {
      // Postcondition — the pen stands before a clean board with the
      // previous content left standing. Already true (nothing stands on
      // the pen's board, in any region) ⇒ spatially inert, the beat still
      // plays. Otherwise the room's own policy picks a CLEAN board — the
      // same exported function the overflow branch calls.
      //
      // On a full wall the room used to erase the earliest-filled board.
      // It no longer does (design §3.5, overturned 2026-08-11 — drifting
      // into overflow stopped erasing too, so the argument that expression
      // must not fare worse inverts consistently): the turn goes LAZY and
      // the host says so out loud. It produces NO erase.
      //
      // WHATEVER the walk's verdict, the pen ends in `full` (§3.5: "到达
      // 后笔站在目标板的 full 区域"; an inert turn's target board is its
      // own). Unconditional on purpose: it is what makes a step's region
      // WORD a pure function of the document — no heights, hence no board
      // membership, hence nothing that could make the pen's word depend on
      // a measurement. §7.2's build order needs exactly that, because the
      // measure pass has to know a step's width BEFORE the fold runs.
      penRegion = DEFAULT_REGION;
      // Read the SOURCE board's fill before the walk — the destination is
      // clean by construction, so the destination's fill answers nothing.
      const fill = boardFill(panels[cur]!);
      if (boardEmpty(panels[cur]!)) {
        turns.push({
          key: input.key,
          panel: cur,
          inert: true,
          fullWall: false,
          fill,
        });
        continue;
      }
      const target = cleanBoardTarget(cleanStates());
      if (!target) {
        turns.push({
          key: input.key,
          panel: cur,
          inert: true,
          fullWall: true,
          fill,
        });
        continue;
      }
      cur = target.panel;
      turns.push({
        key: input.key,
        panel: cur,
        inert: false,
        fullWall: false,
        fill,
      });
      continue;
    }

    // Home placement — the step returns to space that already exists:
    //  - a container layer draws inside its frame's node (the frame's
    //    board and RUN), charging only the GROWTH its arrival caused;
    //  - a back reference (anchorKey) draws OVER its target, so it lives
    //    — and gets erased — with the target's run, charging nothing.
    // (A frame itself, first occurrence of its key, falls through to
    // normal placement below and records the home.) A home whose run an
    // erase has already CLOSED is an ORPHAN: it joins neither the run's
    // record nor any erase's targets — the declared target set and the
    // hidden subtree must be the same set (review P1-1) — and the host
    // reports it loudly.
    const home =
      input.container !== undefined
        ? containerHome.get(input.container)
        : input.anchorKey !== undefined
          ? assignments.get(input.anchorKey)
          : undefined;
    if (home) {
      seq += 1;
      if (openRunOf(home.panel, home.region) !== home.run) {
        orphaned.push(input.key);
        continue;
      }
      assignments.set(input.key, home);
      runs.get(home.run)?.steps.push(input.key);
      const state = panels[home.panel]!;
      const homeRegion =
        home.region === DEFAULT_REGION ? null : state.regions.get(home.region)!;
      if (homeRegion) homeRegion.members.push(input.key);
      else state.members.push(input.key);
      const growth = input.growth ?? 0;
      if (growth > 0) {
        // A frame that grew inside a named region grew THERE, and its
        // region's occupancy has to say so (W9). The columns are charged
        // as well, below, and that is deliberately left alone: it is a
        // PLACEMENT charge, and re-aiming it would move ink. The union
        // absorbs the overlap wherever the region and the columns cover
        // the same face; where they do not (a corner's growth billed to
        // the far column) the reading is conservative by that much.
        if (homeRegion) homeRegion.cursor += growth;
        // Every container frame there is (a chart, a graph) is a
        // face-spanning centrepiece, so its regrowth crowds EVERY column —
        // charge them all, the same rungs the frame itself charged.
        let over = false;
        for (const col of state.cols) {
          const before = col.cursor;
          col.cursor += growth;
          if (before <= budget && col.cursor > budget) over = true;
        }
        // The regrown frame crowds its board: standing content below it
        // is pushed past the board's bottom edge. Loud, named after the
        // layer that did the crowding (§9 boardOverflow family).
        if (over) overflowing.push(input.key);
      }
      continue;
    }

    // A container frame's measured height is the accumulated union — its
    // later layers' growth included. Charge it at its first-written size;
    // the layers pay their own growth when they land.
    //
    // WHICH prefix stability this buys, exactly — because the two registers
    // this fold keeps do NOT make the same promise, and reading one promise
    // onto the other is a repair that silently lands ink on ink (2026-08-13
    // review F1, measured; `layout.test.ts` pins both halves):
    //
    //  - the CHARGE sequence is byte-identical whether the later layers
    //    exist yet or not, so an append never re-decides an earlier step's
    //    BOARD or RUN. That is the whole of the 2026-08-10 review's P1-2,
    //    and it is what this subtraction is for.
    //  - the BOX CHAIN (`placeBox`) deliberately does NOT subtract it and
    //    must not: `input.box.h` is the frame's LIVE measurement, and the
    //    frame's node is the whole accumulated dagre canvas — a layer
    //    mounts a hidden zero-rect marker, so the box the browser holds
    //    open really is the union from the first paint after the append.
    //    Chaining on the first-written height would place the next box
    //    INSIDE the picture, and `detectCollisions` skips same-region pairs
    //    (the chain IS the flow's collision guarantee), so nothing in this
    //    mode would ever report it.
    //
    // So a graph that grows across blocks moves the ink below it down by
    // exactly its growth, and that is the documented cost of growing one
    // (`references/charts.md`: declare the whole structure in the first
    // block when the picture must not shift). A chart never pays it — its
    // axes are declared up front, so a layer adds no height at all.
    const charge =
      input.container !== undefined
        ? Math.max(
            0,
            input.height - (growthOf.get(input.container) ?? 0),
          )
        : Math.max(0, input.height);

    // A NAMED region never migrates (design §4): the author's frame is a
    // budget, not a wall. It fills, it bursts where it stands, and the
    // fold says how far over — walking it to another board would be the
    // room choosing a position, which is the physics this pivot deleted.
    if (penRegion !== DEFAULT_REGION) {
      place(cur, penRegion, input, charge);
      continue;
    }

    const state = panels[cur]!;
    // THE ROOM'S FLOW FILLS IN COLUMNS (W2). A teacher fills the left of a
    // board top to bottom, then starts again at the TOP OF THE RIGHT, and
    // only walks to a clean board once the whole face is written on. So the
    // ladder has a rung the pre-W2 fold did not have: column, then column,
    // then board.
    //
    // A centrepiece is judged against the deepest column rather than the
    // pen's: it is written across all of them, so it fits only where they
    // all have room, and it never triggers a column break of its own (a
    // formula cannot start "at the top of the next column" — there is no
    // next column for something that spans them all).
    const fitsIn = (col: ColumnState): boolean =>
      col.cursor === 0 || col.cursor + charge <= budget;
    if (input.span === "face") {
      if (!state.cols.every(fitsIn)) {
        const target = cleanBoardTarget(cleanStates());
        if (target) cur = target.panel;
      }
      place(cur, DEFAULT_REGION, input, charge);
      continue;
    }
    while (!fitsIn(state.cols[state.col]!) && state.col + 1 < state.cols.length) {
      state.col += 1;
    }
    if (fitsIn(state.cols[state.col]!)) {
      place(cur, DEFAULT_REGION, input, charge);
      continue;
    }
    // The face is full — the room's two-tier policy, via the ONE exported
    // implementation (`cleanBoardTarget`): a never-used board, then an
    // erased-empty one. `null` is the full wall, and there the room STOPS
    // DECIDING: the pen stays, the box chains on past the bottom edge, and
    // the burst is reported rather than repaired.
    const target = cleanBoardTarget(cleanStates());
    if (target) cur = target.panel;
    place(cur, DEFAULT_REGION, input, charge);
  }

  // Regions and their bursts, read out of the fold's own state (§7.1/§4).
  // A region bursts when its deepest STANDING box reaches past its frame's
  // bottom; the strip's frames have none, so the predicate is false there
  // by arithmetic rather than by a special case.
  const regions = new Map<string, RegionRecord>();
  const bursts: RegionBurst[] = [];
  for (let p = 0; p < panels.length; p++) {
    const state = panels[p]!;
    const record = (
      key: string,
      name: RegionName,
      frame: Rect,
      standingRun: string,
      startSeq: number,
      opened: boolean,
      cursor: number,
    ): void => {
      regions.set(`${p}:${key}`, {
        panel: p,
        key,
        name,
        frame,
        standingRun,
        startSeq,
        opened,
        cursor,
      });
      let deepest: PlacedBox | null = null;
      for (const box of state.standing) {
        if (box.region !== key) continue;
        if (!deepest || box.bottom > deepest.bottom) deepest = box;
      }
      if (!deepest) return;
      const bottom = frame.y + frame.h;
      if (!(deepest.bottom > bottom)) return;
      bursts.push({
        panel: p,
        region: key,
        name,
        key: deepest.key,
        overflow: quantise(deepest.bottom - bottom),
        frameHeight: frame.h,
        frame,
        // Past the BOARD's floor, not the frame's (W8). A `top` band that
        // bursts into the lower half is ink the reader still has; a `left`
        // column that bursts is ink the panel eats. Same predicate, two
        // different things to say, and only this number tells them apart.
        cut: Number.isFinite(faceHeight)
          ? quantise(Math.max(0, deepest.bottom - faceHeight))
          : 0,
      });
    };
    if (state.opened || state.run) {
      record(
        DEFAULT_REGION,
        DEFAULT_REGION,
        { x: 0, y: 0, w: frameWidth, h: faceHeight },
        state.run ?? "",
        state.startSeq,
        state.members.length > 0 || state.run !== null,
        state.cols.reduce((sum, col) => sum + col.cursor, 0),
      );
    }
    for (const named of state.regions.values()) {
      record(
        named.key,
        named.name,
        named.frame,
        named.run,
        named.startSeq,
        named.opened,
        named.cursor,
      );
    }
  }

  return {
    count: Math.max(1, count),
    columns: colCount,
    assignments,
    boxes,
    faceExtent: panels.map((state) => state.extent),
    runs,
    regions,
    bursts,
    eraseOps,
    overflowing,
    orphaned,
    panels: panels.map((state, p) => ({
      cursor: state.cols.reduce((sum, col) => sum + col.cursor, 0),
      fill: boardFill(state),
      opened: state.opened,
      startSeq: state.startSeq,
      standingRun: state.run ?? runId(p, state.runIndex),
      empty: boardEmpty(state),
    })),
    cur,
    pen: { panel: cur, region: penRegion },
    turns,
  };
}

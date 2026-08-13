/**
 * BoardCanvas (T4 + C1) — the board host: factory-built step DOM,
 * incremental streaming reconcile (§7 R1–R4′), chart home + back-reference
 * + align seams, canonical compile, and the stage camera.
 *
 * Architecture: React renders only the static containers (surface,
 * viewport, stage, panel, measure layer); the step nodes are factory-built
 * raw DOM managed imperatively against the reconcile plan — that is what
 * makes R1's zero-replay STRUCTURAL (prefix nodes keep identity across
 * appends; a React re-render can never remount them). The canonical
 * timeline is recompiled per change and `seek(playhead)` runs
 * synchronously in the same task as the DOM swap, so already-shown content
 * is restored to its final state before the browser ever paints (no flash
 * frame).
 *
 * The camera (C1): the viewport clips, it does not scroll — the stage
 * inside it wears the ONE transform camera.ts computes, written directly
 * to the DOM (continuous state, hot path; same discipline as Timeline's
 * frame writes). Two structural facts everything below leans on:
 *
 *  - layout values (offset* / client*) are untouched by the transform, so
 *    board coordinates keep meaning layout px at every zoom;
 *  - the measure host is the stage's SIBLING (G8-K), so every probe the
 *    engine runs measures at scale 1 forever and canonical stays
 *    zoom-independent (R8). The one reading that cannot leave the stage —
 *    measureBackRef, which measures MOUNTED targets — goes through the
 *    stage-measure.ts funnel (G8-J).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { DEFAULT_DURATIONS } from "../engine/duration.js";
import { factoryFor } from "../engine/factories/index.js";
import { groupRowRects, type RectLike } from "../engine/factories/ink.js";
import { baselineOffset } from "../engine/factories/type-metrics.js";
import { buildTimeline } from "../engine/timeline.js";
import { stepPlainText } from "../engine/text.js";
import type {
  BackRefTarget,
  BoardTimeline,
  ContainerHome,
  EnvCaps,
  GraphFrameStep,
  GraphLayerStep,
  InkTargetMeasure,
  Lecture,
  MeasureContext,
  ParseIssue,
  Revealable,
  RowRect,
  SrcSpan,
  StageRect,
  Step,
  StepRef,
} from "../engine/types.js";
import { isContainerFrame } from "../engine/container.js";
import {
  clipWindows,
  createNarrationHook,
  type ClipWindow,
} from "../narration/timing.js";
import { figureAspect } from "../engine/factories/illustration.js";
import {
  illustrationBox,
  type IllustrationSource,
} from "../illustrations/types.js";
import type { NarrationManifest } from "../narration/types.js";
import { parseStepKey, stepKey } from "./address.js";
import WallMap from "./WallMap.js";
import {
  readPanelOutline,
  sameOutlines,
  type PanelOutline,
} from "./wall-outline.js";

/**
 * The board face ONE build measures against, read before anything is built
 * (design §7.2's build-order pin) and then handed to every consumer that
 * needs it — the measure host's per-step width, the fold, and the mount
 * that writes each box's `left`/`right`.
 *
 * It extends the engine's `MeasureFace` rather than restating it: the width
 * arithmetic (`scanBoxRects`) takes exactly that, so there is nothing here
 * for a second copy of the region table to hide in. What this adds is the
 * DOM's own frame — the paddings a face coordinate converts through — which
 * the engine has no business knowing.
 */
interface BuildFace extends MeasureFace {
  padTop: number;
  padLeft: number;
  padBottom: number;
  /** The board's padding box — the containing block `left`/`right` resolve
   *  against, hence the width the mount quotes a box's right inset from. */
  containingWidth: number;
}

/**
 * The step kinds whose FACTORY reads geometry out of the measure host, and
 * therefore the kinds whose built node is a function of the host's width.
 *
 * Exactly three factories touch it (`prose.ts` line boxes + heading
 * baseline, `rule.ts` viewBox, `math.ts` fraction bars), and this is the
 * list of kinds they own. Everything else — charts, graphs, back
 * references, erases — measures against its own mounted container or its
 * target, so its ink survives a width it was not built at.
 */
const MEASURED_IN_HOST: ReadonlySet<Step["kind"]> = new Set<Step["kind"]>([
  "heading",
  "prose",
  "aside",
  "list-item",
  "rule",
  "math",
]);

/** A board whose panel never mounted — an outline of nothing, shared. */
const EMPTY_PANEL_OUTLINE: PanelOutline = Object.freeze({ groups: [] });
const EMPTY_OUTLINES: readonly PanelOutline[] = Object.freeze([]);
import { BURST_MARK_NOTE, burstMarks, overflowingRefs } from "./board-check.js";
import type { SnapshotBasis } from "./glance.js";
import {
  boardCount,
  foldBoardLayout,
  PANEL_GAP,
  PANEL_HEIGHT,
  PANEL_WIDTH,
  scanBoxRects,
  standingBoxes,
  type BoardLayout,
  type LayoutStepInput,
  type MeasureFace,
  type RegionBurst,
} from "../engine/layout.js";
import {
  wallGrid,
  wallSlot,
  wallSlotAt,
  type WallGeometry,
} from "../engine/wall.js";
import {
  columnCountFor,
  detectCollisions,
  intersection,
  type BoxCollision,
  type Rect,
  type StandingBox,
} from "../engine/regions.js";
import type { FrameGeometry } from "./board-frame.js";
import { eraserReveal } from "../engine/factories/eraser.js";
import {
  graphPrefixFlowHeights,
  type GraphPrefixBlock,
} from "../engine/factories/graph.js";
import { graphNoteWrites } from "../domain.js";
import {
  buildStageSchedule,
  resolveCameraOps,
  type CameraPose,
  type StageEntry,
  type StageSchedule,
  type StageStepInput,
  type StageView,
} from "../engine/stage.js";
import {
  cameraCss,
  clampCamera,
  exceedsGrabSlop,
  followShift,
  gateCamera,
  grabPan,
  handBackCamera,
  homeCamera,
  latchInput,
  reattachCamera,
  restZoom,
  wheelZoomFactor,
  zoomAt,
  type Camera,
  type FollowBoard,
  type FollowLatch,
  type Viewbox,
} from "./camera.js";
import {
  boardRects,
  deltaLeft,
  viewportPoint,
  withDepthSuspended,
} from "./stage-measure.js";
import { contentSeed } from "../engine/factories/svg.js";
import {
  blockFlaw,
  clampFlaw,
  FLAW_FLAG,
  FLAW_KNOB_PROP,
  FLAW_VARS,
  wordFlaw,
  wordStream,
} from "../engine/flaw.js";
import {
  collisionMarks,
  COLLISION_MARK_NOTE,
  TURN_UNDERFILL_THRESHOLD,
} from "./board-check.js";
import {
  addDepth,
  depthTransformCss,
  FLAT,
  parallaxAxes,
  parallaxPose,
  transitionDepthAt,
  type DepthPose,
} from "./depth.js";
import {
  alignCascade,
  boxWidthCascade,
  illustrationCascade,
  containerKeyOf,
  planReconcile,
  toEntries,
  type BuiltStepState,
  type ReconcileEntry,
} from "./reconcile.js";
import {
  activeScheduleIndex,
  mapPlainRangeToSpans,
  scheduleEntrySpan,
} from "./script-sync.js";
import type { FrameListener, SeekListener } from "./useBoardPlayer.js";

/** What the host hands upward after every (re)compile. */
export interface CompiledBoard {
  timeline: BoardTimeline;
  /** Precise source span of a schedule entry (G6 讲稿 highlight). */
  entrySpan(index: number): SrcSpan | null;
  issues: ParseIssue[];
  /**
   * Formulas that failed to RENDER (KaTeX hard failure — the node degrades
   * to visible TeX source with `data-bansho-math-error`, R6). Read from the
   * live board DOM per rebuild; distinct from `issues` (parse-level).
   *
   * One entry per failed formula, naming the STEP it sits in (a formula
   * can be inline, so the step is the finest address there is). A bare
   * count was what shipped first, and it made the only §9 finding the
   * agent could not act on — `check-board` promises an address per finding
   * and handed back "1 formula failed" with no way to reach it.
   */
  mathErrors: StepRef[];
  /**
   * Failed formulas whose step could not be identified — never observed
   * (every mounted step node carries `data-bansho-ref`), reported as a
   * count rather than dropped, because a finding nobody can see is worse
   * than one nobody can navigate to.
   */
  unplacedMathErrors: number;
  /**
   * Steps whose writing runs past the right edge of the board (§9
   * `boardOverflow`). Measured here because only the host has layout; the
   * verdict itself is the pure classifier in `board-check.ts`. The board
   * clips horizontally, so an overflowing step is content the user simply
   * never sees — exactly the silent loss worth telling the agent about.
   */
  overflowing: StepRef[];
  /**
   * The voice layer of THIS compile (T10): each applied clip's exact audio
   * window on the canonical timeline. Empty when the board has no
   * narration — playback then follows content-derived pacing untouched.
   */
  narration: ClipWindow[];
  /**
   * Steps that turn back to — or extend — writing an erase had already
   * taken off the board when they arrived (the fold's orphans, P1-1).
   * Their ink has no board face to land on, so nothing is inked; each is
   * reported as a refUnresolved-family finding ("points at something that
   * is not on the board") instead of disappearing silently.
   */
  inkAfterErase: StepRef[];
  /**
   * Canvas pivot V2 (§5) — what the room stopped preventing, measured on
   * THIS compile: standing boxes that overlap, regions standing past their
   * frame, and `@turn`s that found nowhere clean to go. Facts, not faults
   * (§5.3): the board draws them, `check-board` reports them, and
   * `boardCollision` pushes the first of the three.
   */
  collisions: readonly BoxCollision[];
  bursts: readonly RegionBurst[];
  turnsOnFullWall: readonly StepRef[];
  /** W2 — `@turn`s that walked away from a board still mostly empty, with
   *  the fraction of its capacity the writing had reached. */
  turnsUnderfilled: readonly { ref: StepRef; fill: number }[];
}

/** The imperative half the host exposes — camera moves the shell asks for. */
export interface BoardApi {
  /** Bring a step into view. Returns false when it is not on the board. */
  showStep(ref: StepRef): boolean;
  /**
   * The glance's raw material (S1) — lazy and READ-ONLY: no DOM writes,
   * no geometry moved. `null` before the first build. Heights ride the
   * per-item `foldHeight` cache (the first notes-view glance pays one
   * round of computed-style reads; every later one hits the cache).
   * The two basis numbers are pinned to the LECTURE, never the mounted
   * projection: `count` is always `boardCount(lecture)` (the notes view
   * forces panelCount 1 — reporting that would call a four-board lecture
   * a strip), and `budget` is recomputed from the panel-width rule.
   */
  readSnapshotBasis(): SnapshotBasis | null;
  /**
   * `frame-board`'s raw material (canvas pivot §6): the pen's face, as the
   * FOLD sized it. `null` before the first build. Read-only, like the
   * glance's basis — the preview never moves geometry.
   */
  readFrameGeometry(): FrameGeometry | null;
  /** Standing boxes on every board, the collision pass's own list (§5.1). */
  readStandingBoxes(): StandingBox[];
  /**
   * Draw the annotation layer and return its undo. Everything drawn is a
   * rectangle already known: standing boxes, the candidate frames the
   * caller resolved, and their intersections. NOTHING is simulated — the
   * layer holds no text node of the candidate's content, and it holds no
   * frame the caller did not hand it (design §6.3). NOTE: the DOM half's
   * negative tests (no content node, unmounted after the shoot, the user's
   * camera pose untouched) are §14's and are NOT written yet — the pure
   * half's refusals are pinned in `__tests__/board-frame.test.ts`, this
   * half's are owed.
   */
  paintFrames(layer: FrameLayer): () => void;
  /** The element `frame-board` images — the panels, at LAYOUT size. */
  framesTarget(): HTMLElement | null;
}

/** What `paintFrames` draws — all of it rectangles the caller resolved. */
export interface FrameLayer {
  panel: number;
  standing: readonly StandingBox[];
  frames: readonly {
    tag: string;
    rect: Rect;
    /** No declared depth (strip): drawn with its bottom edge left open. */
    open: boolean;
  }[];
  /** Strip only: the band the image covers, face coordinates. */
  window: { from: number; to: number } | null;
}

interface BuiltItem {
  hash: string;
  ref: StepRef;
  step: Step;
  node: Element;
  revealables: Revealable[];
  /** Named-container key (`chart:名` / `graph:名`) when the step has one. */
  container?: string;
  alignWidth?: number;
  /** Image steps: the picture identity this node was built against (I1). */
  illustration?: string;
  /** Backref steps: measured target rows (PANEL coords) — follow anchor. */
  anchorRows?: RowRect[];
  /** C3: which panel `anchorRows` are relative to (0 when unstaged). */
  anchorPanel?: number;
  /**
   * The assignment fold's charge for this step, cached with the item.
   *
   * ONE TRUTH (canvas pivot V2, layout-baseline README ruling #4 —
   * 2026-08-11): it is `boxMetrics.h + marginTop + marginBottom`, the
   * margin box of the very rectangle the §7.5 chain places. V1 measured
   * the charge a SECOND time in `offsetHeight`'s integers, deliberately,
   * so a structural cut could promise no physics change; V2 is the release
   * where a physics change is the point, so the second measurement is
   * gone. The visible consequence is that cursors are fractional and very
   * slightly smaller, which can DELAY an overflow on a staged board by one
   * step — measured on purpose, not smuggled.
   */
  foldHeight?: number;
  /**
   * The §7.5 spacing model's inputs for this step's BOX: the fractional
   * border-box height (read through the G8-J funnel) and the two vertical
   * margins. Undefined for a step that occupies no space (a display:none
   * layer marker).
   */
  boxMetrics?: { h: number; marginTop: number; marginBottom: number };
  /**
   * The face width this step was MEASURED at (design §9's guard). A named
   * step must be measured in its region's frame or its height answers a
   * question nobody asked; caching a height without the width it belongs
   * to is how that goes wrong silently. The rebuild compares this against
   * the fold's verdict for the same step and re-measures on a mismatch.
   */
  measuredWidth?: number;
  /**
   * The width the measure host PRESENTED while this node was built — the
   * width its lines wrapped at, hence the width its ink was drawn for.
   *
   * Sibling of `measuredWidth` and NOT the same fact: that one is about a
   * cached HEIGHT and may be restated by the fold's corrective pass, this
   * one is about geometry baked into `d` strings, which only a rebuild can
   * restate. It is the pre-fold SCAN's answer, so `boxWidthCascade` can
   * compare scan against scan across builds. `undefined` in the notes
   * projection, which measures in CSS flow.
   */
  boxWidth?: number;
}

interface BuildState {
  items: BuiltItem[];
}

export interface BoardCanvasProps {
  /** Non-null by contract: the host unmounts the canvas when there is no board. */
  lecture: Lecture;
  /**
   * Which projection of the canonical timeline this canvas performs (C3):
   * `"board"` — the stage (area-limited panels, erasing, camera);
   * `"notes"` — the lecture notes (one unbounded strip, nothing ever
   * lost: camera and erase steps plan to zero units). The HOST remounts
   * the canvas on a switch (a `key` change) — the factory contract is
   * single-shot per mount generation, so the projections never dual-build.
   */
  view: "board" | "notes";
  theme: "light" | "dark";
  /**
   * The active content set's own `theme.css`, verbatim — NOT for injection
   * (the host owns the <style> tag) but as the one signal that a board
   * TOKEN may have changed. Reconcile cannot see it: the board bytes did
   * not move, so every hash still matches. The W3 imperfection knob
   * (`--bansho-flaw`) lives in that stylesheet, so an author tuning it
   * needs this dependency to see the board answer.
   */
  themeCss?: string | undefined;
  fontsReady: boolean;
  env: EnvCaps;
  getPlayheadT(): number;
  onCompiled(compiled: CompiledBoard | null): void;
  /** Active schedule entry index (from the player) — viewport follow. */
  activeIndex: number;
  playing: boolean;
  follow: "live" | "detached";
  /**
   * Explicit-navigation subscription (player.onSeek) — a scrub / keyboard
   * seek / Live / replay jump re-engages the camera even while paused or
   * after a manual scroll. Must be identity-stable across renders.
   */
  onSeek(listener: SeekListener): () => void;
  /**
   * Per-frame subscription (player.onFrame) — the director's camera glide
   * (C2). The interpolated pose is a pure function of the playhead
   * (`stageStateAt`), so the listener only queries and writes a transform;
   * it holds no animation state. Camera-free boards early-return before
   * any fold work. Must be identity-stable across renders.
   */
  onFrame(listener: FrameListener): () => void;
  /**
   * The step the user is currently pointing at (T6). Highlighted on the
   * board and re-applied after every rebuild, so an append while a step is
   * selected never drops the outline.
   */
  selectedRef: StepRef | null;
  /**
   * Pointing at the board is the mode's core interaction, so it needs no
   * "select mode": a plain click on any step reports it. `null` when the
   * click landed on bare board. Absent (undefined) turns pointing OFF
   * entirely — replay and viewing sessions have no agent to point at.
   */
  onSelectStep?: (ref: StepRef | null) => void;
  /**
   * The user just took the camera in hand (C1′): a press cleared the grab
   * slop and became a pan. The host stops the performance — a board that
   * moves under your hand cannot be read — through an IDEMPOTENT pause,
   * never a toggle: this fires on every grab, including grabs of an
   * already-paused board, precisely so the canvas never has to reason
   * about a `playing` prop that is one render stale.
   *
   * Releasing the grab is deliberately NOT reported: letting go does not
   * resume. The user grabbed the board to look at something, and yanking
   * both the transport and the view back the moment they let go is the
   * silent-kill class of bug camera-latch.ts was written about. Resuming
   * is the user's explicit act; its EFFECT is the camera's return.
   */
  onGrab?: () => void;
  /** Publishes the imperative camera handle; called with null on unmount. */
  onApi?: (api: BoardApi | null) => void;
  /**
   * The content set's narration manifest (T10), or null for a silent
   * board. Scheduling reads ONLY this parsed value — clip audio length
   * flows into the compile through the G3 override, so a manifest edit
   * recompiles like any other measurement change.
   */
  narration?: NarrationManifest | null;
  /**
   * I1 — how a picture the lecture names becomes a picture on the board.
   * Null (or absent) draws every figure as its honest badge, which is also
   * what a host that has not wired this gets: a hole is never invisible.
   *
   * `identity` is the cascade key: a figure's node is a function of the
   * sidecar and of the host's on-disk probe, and NEITHER is a byte of
   * board.md, so the content hash cannot see them change (see
   * `reconcile.ts::illustrationCascade`).
   */
  illustrations?: IllustrationSource | null;
  /**
   * V1.5 — the reader's parallax (css3d brief §5.2). With it on, the
   * pointer rocks the board a few degrees so the depth the transitions
   * build can be FELT rather than believed: real depth produces parallax,
   * painted-on perspective falls apart the moment it is rocked.
   *
   * It is a VIEWING POSE, the same family as the wheel and the grab. It
   * never enters canonical, never reaches `stageStateAt`, and never
   * survives a measurement (`withDepthSuspended`). Default off, and the
   * host forces it off under `prefers-reduced-motion`.
   */
  parallax?: boolean;
  /**
   * V1.5 — whether transitions carry depth at all. False under
   * `prefers-reduced-motion`, where the camera keeps its existing 2D Van
   * Wijk glide (the brief's §6-2 preference: degrade to today's transition,
   * never to an instant cut).
   */
  depthMotion?: boolean;
}

/** Per-step map key AND the `data-bansho-ref` attribute — one format. */
const refKey = stepKey;

/** The camera's decision inputs — all four are LAYOUT values (a transform
 *  never changes them), read fresh at each decision point. */
const viewboxOf = (board: HTMLElement, viewport: HTMLElement): Viewbox => ({
  panelW: board.offsetWidth,
  panelH: board.offsetHeight,
  viewW: viewport.clientWidth,
  viewH: viewport.clientHeight,
});

export default function BoardCanvas({
  lecture,
  view,
  theme,
  themeCss,
  fontsReady,
  env,
  getPlayheadT,
  onCompiled,
  activeIndex,
  playing,
  follow,
  onSeek,
  onFrame,
  selectedRef,
  onSelectStep,
  onGrab,
  onApi,
  narration = null,
  illustrations = null,
  parallax = false,
  depthMotion = true,
}: BoardCanvasProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const depthRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const panelsRef = useRef<HTMLDivElement>(null);
  const panelElsRef = useRef<Array<HTMLDivElement | null>>([]);
  const boardRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);

  // ── C3: how many boards this projection stands ───────────────────────────
  // The notes view is ALWAYS the single unbounded strip — the whole point
  // of the projection is that nothing is ever area-limited there.
  const panelCount = view === "notes" ? 1 : boardCount(lecture);

  /**
   * I1 — the identity of everything the picture seam can answer with. It is
   * the cascade key AND a rebuild trigger: the same board.md draws a
   * different figure when its declared aspect changes or when its file
   * arrives, and neither event moves a byte the hash can see.
   */
  const illustrationIdentity = illustrations?.identity ?? "";

  /** The assignment fold of the LAST staged rebuild; null when the board
   *  is unstaged (single strip, no erases — the pristine C1 path). */
  const layoutRef = useRef<BoardLayout | null>(null);
  /** The inputs `layoutRef.current` was folded from — the measured heights
   *  the fold's `boxes` deliberately do not carry (§7.1), and which the
   *  collision pass needs to make a rectangle out of an origin. */
  const foldInputsRef = useRef<readonly LayoutStepInput[]>([]);
  /** Run id → its erased-run wrapper element (closed runs only). */
  const runElsRef = useRef(new Map<string, HTMLElement>());
  /** Explicit erase step key → the run its sweep hides. */
  const eraseRunByKeyRef = useRef(new Map<string, string>());
  /** Erase step key → the PANEL it wipes (camera anchor). */
  const erasePanelByKeyRef = useRef(new Map<string, number>());
  /** Auto-erase composition per triggering step key (unit 0 = the sweep). */
  /** Turn step key → its destination PANEL (from `layout.turns` — the one
   *  place the selection policy's verdicts are read from, §4.1). */
  const turnPanelByKeyRef = useRef(new Map<string, number>());
  /** The snapshot basis of the LAST build (S1): entries + the parse they
   *  came from. Read lazily by `readSnapshotBasis`; null before a build. */
  const basisRef = useRef<{ entries: ReconcileEntry[]; lecture: Lecture } | null>(
    null,
  );
  /** The face the last fold sized every box against (frame-board §6 reads
   *  it back; the fold is the only writer). */
  const faceRef = useRef<{ faceW: number; faceH: number } | null>(null);
  /** Whether the last staged rebuild ever read a face (the canonical size
   *  is a constant now, so this is a "has it been built" flag, not a
   *  measurement). */
  const panelSizedRef = useRef(false);
  /** Viewport size of the last staged rebuild — what the map's viewport
   *  rectangle is drawn from, and the other half of "which board is the
   *  reader looking at" once the wall has ROWS. */
  const viewWRef = useRef(0);
  const viewHRef = useRef(0);
  /** Board count as a ref: the wall arithmetic below runs on the camera's
   *  hot path, and a dependency there would re-subscribe every input
   *  effect on a rebuild. */
  const panelCountRef = useRef(1);
  panelCountRef.current = panelCount;
  /** Whether the CURRENT build is staged multi-board (camera x handling). */
  const stagedMultiRef = useRef(false);

  /**
   * The room, as `engine/wall.ts` wants it. ONE place derives it, and every
   * slot question in this file is asked through `wallSlot` / `wallSlotAt` /
   * `wallExtent`. The inline slot arithmetic this replaced lived in five
   * places and every copy silently assumed the wall had exactly one row.
   * `wall.test.ts`'s source scan keeps it that way.
   */
  const wallGeom = useCallback(
    (): WallGeometry => ({
      panelW: PANEL_WIDTH,
      panelH: PANEL_HEIGHT,
      gap: PANEL_GAP,
    }),
    [],
  );

  const stateRef = useRef<BuildState | null>(null);
  const containersRef = useRef(new Map<string, ContainerHome>());
  /** Aligned-label width cache, keyed by step content hash (null = no marker). */
  const labelWidthRef = useRef(new Map<string, number | null>());
  const compiledRef = useRef<CompiledBoard | null>(null);
  const itemByRefRef = useRef(new Map<string, BuiltItem>());
  /** User-input detach policy (pure, tested) — see camera.ts::latchInput. */
  const latchRef = useRef<FollowLatch>("following");
  /**
   * A re-attach is owed: the reader had taken the camera and has just
   * handed it back (play / Live / an explicit seek). The next follow puts
   * them at the canonical pose (`reattachCamera`) instead of the smallest
   * shift, and spends the flag doing it — see `resetLatch`.
   */
  const reattachRef = useRef(false);
  /**
   * The grab in flight (C1′), or null when no press is down. `panning`
   * is the slop verdict: false while the press could still be T6's click,
   * true once it has travelled and become a camera gesture.
   */
  const grabRef = useRef<{
    pointerId: number;
    pointerType: string;
    /** Where the press landed (screen px) — the slop is measured here. */
    startX: number;
    startY: number;
    /** Where the camera last tracked the hand to (screen px). */
    lastX: number;
    lastY: number;
    panning: boolean;
  } | null>(null);
  /**
   * A pan swallows the click that ends it: pointerdown + move + up on the
   * same element still fires `click`, and that click is the user letting
   * go of the board, not pointing at a step. Set when a pan ends, cleared
   * by the next press (one owner, and a pan whose pointerup lands outside
   * the window cannot leave a stale suppression behind).
   */
  const grabbedRef = useRef(false);
  /** `onGrab` as a ref: the input effect must not re-subscribe mid-drag. */
  const onGrabRef = useRef(onGrab);
  onGrabRef.current = onGrab;
  /**
   * The camera, as a ref + direct transform write: continuous state on the
   * hot path (follow advances per reveal unit, a pinch fires per event) —
   * exactly Timeline's frame-write discipline. It survives rebuilds for
   * free, which is why the pre-C1 scroll-restore dance is gone: a wipe
   * collapsing the content cannot clamp a transform.
   */
  // The camera starts at the board's own corner, at the zoom that shows one
  // board. `viewW` is 0 before the first layout, and `restZoom` answers 1
  // there — the pre-W7 value, replaced by a real one the moment the first
  // rebuild reads the viewport (`applyRestCamera`).
  const cameraRef = useRef<Camera>(homeCamera(0));
  /**
   * The compiled stage schedule (C2) — camera moves with baked poses and
   * canonical windows; null on a board without camera verbs, which is what
   * keeps the C1 hot path at zero per-frame stage work.
   */
  const stageScheduleRef = useRef<StageSchedule | null>(null);
  /** Whether the CURRENT lecture carries camera steps — gates the
   *  height-resize invalidation (viewport height feeds camera poses, and
   *  through them canonical camera durations, only on such boards). */
  const hasCameraRef = useRef(false);
  const [rebuildTick, setRebuildTick] = useState(0);
  /** THE WALL MAP'S DRAWING — the real shape of the ink on every board,
   *  read once per COMPILE (`wall-outline.ts`) and never per frame. */
  const [outlines, setOutlines] = useState<readonly PanelOutline[]>([]);

  /** The map's board rectangles, in board order — imperative on purpose:
   *  which board the reader is standing in front of changes on the
   *  camera's hot path, and a setState there would re-render the viewer
   *  every frame of every glide. Same discipline as `applyDepth`. */
  const mapTilesRef = useRef<Array<SVGRectElement | null>>([]);
  const mapAtRef = useRef(-1);
  /** The map's viewport rectangle — the ONE element the camera writes. */
  const mapViewRef = useRef<SVGRectElement | null>(null);
  const registerBoardRect = useCallback(
    (panel: number, el: SVGRectElement | null): void => {
      mapTilesRef.current[panel] = el;
    },
    [],
  );
  const registerViewRect = useCallback((el: SVGRectElement | null): void => {
    mapViewRef.current = el;
    // A freshly mounted map has neither a viewport rectangle nor a current
    // board yet, and `markWallMap` short-circuits on an unchanged index —
    // so forget the last answer and let the next camera write paint it.
    mapAtRef.current = -1;
  }, []);
  /** The outlines as a ref, for the one place that must know whether a
   *  strip has stale state to clear without depending on the value. */
  const outlinesRef = useRef<readonly PanelOutline[]>(outlines);
  outlinesRef.current = outlines;

  /** Which board the viewport centre is looking at (the map's "you are
   *  here"), from the camera alone — no measurement, no DOM read. */
  const markWallMap = useCallback((camera: Camera): void => {
    const geom = wallGeom();
    if (!(geom.panelW > 0)) return;
    // Where the reader stands, in board px — the map's viewBox is in board
    // px too, so this is the camera itself, not a projection of it.
    const rect = mapViewRef.current;
    if (rect) {
      rect.setAttribute("x", `${camera.x}`);
      rect.setAttribute("y", `${camera.y}`);
      rect.setAttribute("width", `${Math.max(0, viewWRef.current / camera.z)}`);
      rect.setAttribute("height", `${Math.max(0, viewHRef.current / camera.z)}`);
    }
    const tiles = mapTilesRef.current;
    if (tiles.length === 0) return;
    // The viewport's own centre, in board px — the point the reader is
    // actually looking at. Two axes now: the wall has rows.
    const at = wallSlotAt(
      {
        x: camera.x + viewWRef.current / (2 * camera.z),
        y: camera.y + viewHRef.current / (2 * camera.z),
      },
      panelCountRef.current,
      geom,
    );
    if (at === mapAtRef.current) return;
    mapAtRef.current = at;
    tiles.forEach((tile, i) => {
      if (!tile) return;
      if (i === at) {
        tile.setAttribute("data-current", "true");
        tile.setAttribute("aria-current", "true");
      } else {
        tile.removeAttribute("data-current");
        tile.removeAttribute("aria-current");
      }
    });
  }, [wallGeom]);

  /** The one writer: commit a camera and paint it onto the stage. */
  const applyCamera = useCallback((camera: Camera): void => {
    cameraRef.current = camera;
    const stage = stageRef.current;
    if (stage) stage.style.transform = cameraCss(camera);
    markWallMap(camera);
  }, [markWallMap]);

  /**
   * THE ONE RE-ENGAGE DOOR (`latchInput(_, "reset")`) — Live, resuming
   * playback and every explicit seek all come through here, and it is the
   * only place that can see the transition that matters: a camera the
   * READER was holding coming back to the performance. That transition
   * owes them the canonical re-attach pose, so it is recorded here rather
   * than re-derived by each caller (three call sites, one policy).
   */
  const resetLatch = useCallback((): void => {
    if (latchRef.current === "detached") reattachRef.current = true;
    latchRef.current = latchInput(latchRef.current, "reset");
  }, []);

  // ── V1.5: the depth surface ─────────────────────────────────────────────
  // Two independent producers, kept apart on purpose (brief §5.2-1). The
  // DIRECTOR's term is a pure function of the fold's own moves; the
  // READER's term is where the pointer is. Only the written CSS string
  // knows about both — nothing downstream of `directorDepthRef` can ever
  // see the pointer, which is what keeps "where the mouse happens to be"
  // out of canonical and R8 intact.
  const directorDepthRef = useRef<DepthPose>(FLAT);
  const parallaxDepthRef = useRef<DepthPose>(FLAT);
  /** The last string written — writing an unchanged transform every frame
   *  is a style invalidation the compositor does not need. */
  const depthCssRef = useRef("");
  /** The one writer: compose the two poses and paint the depth surface. */
  const applyDepth = useCallback((): void => {
    const el = depthRef.current;
    if (!el) return;
    const css = depthTransformCss(
      addDepth(directorDepthRef.current, parallaxDepthRef.current),
    );
    if (css === depthCssRef.current) return;
    depthCssRef.current = css;
    // Empty, not "none": an absent transform leaves the surface exactly as
    // the V1 baseline found it — no 3D context, no stacking context, no
    // compositing decision. `withDepthSuspended` restores to this same
    // empty string, and treats it as "nothing to suspend".
    el.style.transform = css;
  }, []);
  /** The director's term at a canonical time — flat outside a transition,
   *  and flat outright under reduced motion. */
  const applyDirectorDepth = useCallback(
    (t: number): void => {
      directorDepthRef.current = depthMotion
        ? transitionDepthAt(stageScheduleRef.current, t)
        : FLAT;
      applyDepth();
    },
    [applyDepth, depthMotion],
  );

  // ── Back-reference seam: offset→DOM per stepPlainText (math zero-width) ──
  const pendingRowsRef = useRef<RowRect[] | null>(null);
  /** Which panel the last backref measurement was based against (C3). */
  const pendingPanelRef = useRef(0);
  const measureBackRef = useCallback(
    (
      target: BackRefTarget,
      /** The annotating step's own key — the erase seam's `currentBuildKey`
       *  pattern: a step value cannot name its board, the fold can. */
      selfKey?: string,
    ): InkTargetMeasure | undefined => {
      const item = itemByRefRef.current.get(refKey(target.step));
      if (!item) return undefined;
      // Ink aimed at a board an erase had ALREADY taken away has no face
      // to land on (P1-1): measuring it would paint over whatever occupies
      // that space now. That verdict belongs to the FOLD — it walks the
      // document IN ORDER, refuses the home whose run was closed before
      // the ink arrived, and publishes the refusal as `orphaned` (§4.1:
      // read the fold's record, never re-derive it). The stage pass reads
      // the same list.
      //
      // Re-deriving it here from `eraseOps` — "was this run erased
      // ANYWHERE in the document?" — is what silently broke the mode's
      // signature move: a claim struck WHILE IT STOOD, on a board the
      // lecture wipes ten steps later, is not an orphan; the fold gives
      // it a home, `check-board` finds nothing, and the erase still hides
      // exactly one set (the ink is a member of its target's run, so it
      // is wiped WITH the target). Ordering is the whole distinction.
      //
      // Degrade exactly like an unmatched quote — inert, with the fold
      // reporting the orphan loudly. The notes projection has no fold and
      // keeps inking (nothing is ever lost there).
      const staged = layoutRef.current;
      if (
        staged &&
        selfKey !== undefined &&
        staged.orphaned.includes(selfKey)
      ) {
        return undefined;
      }
      // The measurement base is the board the TARGET stands on: panel 0
      // on an unstaged board (今天的整块板), the target's assigned panel
      // once the fold has run — the overlay mounts into that panel, so
      // rows must be that panel's coordinates (C3).
      const panel =
        layoutRef.current?.assignments.get(refKey(target.step))?.panel ?? 0;
      const base = panelElsRef.current[panel] ?? boardRef.current;
      if (!base) return undefined;
      const plain = stepPlainText(item.step);
      const spans = Array.from(
        item.node.querySelectorAll<HTMLElement>(".bansho-w"),
      );
      const hits = mapPlainRangeToSpans(spans, plain, target.start, target.end);
      if (hits.length === 0) return undefined;
      // The ONE measurement that cannot leave the stage: a back reference
      // measures its already-MOUNTED target (that is its definition), so
      // the reading happens under the camera's transform and must fall
      // back to board px through the G8-J funnel — screen rects divided by
      // the same-frame accumulated scale.
      //
      // V1.5 adds the second half of that sentence: the divide undoes a
      // uniform SCALE, and a 3D rotation is projective, so the funnel
      // lifts the depth surface for the whole batch rather than trying to
      // correct for it. Without it the anchor would drift with the mouse —
      // the exact failure the css3d brief §5.2-2 names.
      const rects: RectLike[] = boardRects(
        base,
        hits,
        depthRef.current,
        surfaceRef.current,
      );
      // Layout-family reading (computed style) — transform-immune.
      const fontSize = Number.parseFloat(
        getComputedStyle(hits[0]!).fontSize,
      );
      // G8-M — same family of reading, and the reason a back reference
      // lands on the writing rather than above it. Board px on both sides:
      // the rects came through the funnel's scale divide, and computed type
      // metrics are layout values a transform never touches.
      const rows = groupRowRects(rects, baselineOffset(document, hits[0]!));
      pendingRowsRef.current = rows;
      pendingPanelRef.current = panel;
      return { rows, fontSize: Number.isFinite(fontSize) ? fontSize : 26 };
    },
    [],
  );

  // ── Stage-anchor seam (C2/C3): a mounted step's STAGE rect ──────────────
  // `offset*` only — the layout family a CSS transform never touches
  // (G8-J's safe column), so no funnel divide and no new
  // getBoundingClientRect call site. Offsets are summed up the
  // offsetParent chain to the stage: on the single panel the chain is
  // node → panel(0,0) → stage, bit-identical to the pre-C3 direct read;
  // on a staged board it adds the panel's (and run wrapper's zero)
  // origin, so every consumer speaks stage coordinates. A backref step
  // answers with its measured target rows (panel coords + its panel's
  // origin): the pen — and the camera — turn back to earlier writing.
  const stageOffsetOf = useCallback(
    (el: HTMLElement): { left: number; top: number } => {
      const stage = stageRef.current;
      let left = 0;
      let top = 0;
      let cur: Element | null = el;
      while (cur instanceof HTMLElement && cur !== stage) {
        left += cur.offsetLeft;
        top += cur.offsetTop;
        cur = cur.offsetParent;
      }
      return { left, top };
    },
    [],
  );
  const measureStageAnchor = useCallback(
    (ref: StepRef): StageRect | undefined => {
      const item = itemByRefRef.current.get(refKey(ref));
      if (!item || !(item.node instanceof HTMLElement)) return undefined;
      if (item.anchorRows && item.anchorRows.length > 0) {
        const panelEl = panelElsRef.current[item.anchorPanel ?? 0];
        const origin = panelEl ? stageOffsetOf(panelEl) : { left: 0, top: 0 };
        return {
          left: origin.left + Math.min(...item.anchorRows.map((r) => r.x0)),
          top: origin.top + Math.min(...item.anchorRows.map((r) => r.y0)),
          right: origin.left + Math.max(...item.anchorRows.map((r) => r.x1)),
          bottom: origin.top + Math.max(...item.anchorRows.map((r) => r.y1)),
        };
      }
      const n = item.node;
      // A display:none node (wait/camera/erase spans) reports an all-zero
      // box — that is camera echo, not geometry; feeding it into an
      // overview union or a follow proxy would drag the stage to the
      // board head.
      if (n.offsetWidth === 0 && n.offsetHeight === 0) return undefined;
      const at = stageOffsetOf(n);
      return {
        left: at.left,
        top: at.top,
        right: at.left + n.offsetWidth,
        bottom: at.top + n.offsetHeight,
      };
    },
    [stageOffsetOf],
  );

  /** The head of one BOARD as a stage rect (bottom == top — the follow's
   *  pull-up branch shows the board from where the hand starts). One rect
   *  convention for both room actions: an erase performs at the board it
   *  wipes, a turn at the board it walks to (P1-3 family). */
  const panelHeadRect = useCallback(
    (panel: number): StageRect | undefined => {
      const panelEl = panelElsRef.current[panel];
      if (!panelEl) return undefined;
      const at = stageOffsetOf(panelEl);
      return {
        left: at.left,
        top: at.top,
        right: at.left + panelEl.offsetWidth,
        bottom: at.top,
      };
    },
    [stageOffsetOf],
  );
  const erasedBoardHead = useCallback(
    (key: string): StageRect | undefined => {
      const panel = erasePanelByKeyRef.current.get(key);
      return panel === undefined ? undefined : panelHeadRect(panel);
    },
    [panelHeadRect],
  );
  /** The turn's destination board head — the walk's camera anchor (S1). */
  const turnBoardHead = useCallback(
    (key: string): StageRect | undefined => {
      const panel = turnPanelByKeyRef.current.get(key);
      return panel === undefined ? undefined : panelHeadRect(panel);
    },
    [panelHeadRect],
  );

  // ── Pointing at a step (T6) ──────────────────────────────────────────────
  // The outline lives on the DOM node, not in React state: the step nodes
  // are factory-built and managed imperatively (that is what makes R1's
  // zero-replay structural), so the marker is applied the same way — and
  // re-applied after every rebuild, or an append while a step is selected
  // would silently drop the outline the user is looking at.
  //
  // Pointing is SINGLE selection (`selectedRef` is one ref or none), and the
  // chat's context chip is a pure function of that value — so the board is
  // the only surface that can disagree with it, and it disagrees exactly as
  // far as this sweep fails to reach. The sweep is therefore the WALL
  // (`.bansho-panels`), never `boardRef`: that ref is panel 0 wearing the
  // name of the whole board, and clearing through it left every outline set
  // on boards 2–4 standing forever — a `@board 4` lecture claiming six
  // selections while the chip named one, and none of them current once the
  // chip was cleared. A marked node can stand on any panel, inside an
  // erased-run wrapper, or inside a target's box as a back-reference
  // overlay; all of those live under the panels container, none of them
  // under panel 0 alone. Same scope, same reason, as `readMathErrors`.
  const selectedRefRef = useRef<StepRef | null>(selectedRef);
  selectedRefRef.current = selectedRef;
  const applySelectionMark = useCallback((): void => {
    const wall = panelsRef.current ?? boardRef.current;
    if (!wall) return;
    for (const marked of Array.from(
      wall.querySelectorAll("[data-bansho-selected]"),
    )) {
      marked.removeAttribute("data-bansho-selected");
    }
    const ref = selectedRefRef.current;
    if (!ref) return;
    const item = itemByRefRef.current.get(refKey(ref));
    if (item?.node instanceof HTMLElement) {
      item.node.setAttribute("data-bansho-selected", "");
    }
  }, []);
  useEffect(() => {
    applySelectionMark();
  }, [selectedRef, applySelectionMark]);

  /** Which step a click landed on — `null` for bare board. */
  const stepFromEvent = useCallback(
    (target: EventTarget | null): StepRef | null =>
      target instanceof Element
        ? parseStepKey(target.closest("[data-bansho-ref]")?.getAttribute("data-bansho-ref"))
        : null,
    [],
  );

  /** The camera's decision box: the whole STAGE on a multi-board build
   *  (the panels container's `width: max-content` reports the full wall),
   *  the single panel otherwise — C1's `viewboxOf(board, viewport)`
   *  verbatim. All layout reads (G8-J's safe column). */
  const liveViewbox = useCallback((viewport: HTMLElement): Viewbox => {
    const panelsEl = panelsRef.current;
    if (stagedMultiRef.current && panelsEl) {
      return {
        panelW: panelsEl.offsetWidth,
        panelH: panelsEl.offsetHeight,
        viewW: viewport.clientWidth,
        viewH: viewport.clientHeight,
      };
    }
    const board = boardRef.current;
    return board
      ? viewboxOf(board, viewport)
      : {
          panelW: 0,
          panelH: 0,
          viewW: viewport.clientWidth,
          viewH: viewport.clientHeight,
        };
  }, []);

  /**
   * THE fold-input builder — one implementation for the rebuild's
   * assignment fold AND the snapshot basis (S1). A second copy that
   * drifted (a step class skipped here but not there) would make the
   * glance answer a different board than the one performing.
   *
   * Read-only over the built items: measured outer heights ride the
   * per-item `foldHeight` cache (geometry is a pure function of content +
   * width; every width/theme change already drops the whole build state),
   * and a graph layer's growth is derived arithmetically from the same
   * prefix layouts the frame renders (P1-2).
   */
  /**
   * W2 主次 — the three step kinds a section is usually ABOUT: a display
   * formula, a chart, a graph. They take the whole face while prose narrows
   * into columns, which is both the hierarchy the board was missing and the
   * only way a formula can be written at a size the back row reads (the
   * bayes corpus's widest is 13.5x its own font size wide — a 456px column
   * caps display math at body size).
   *
   * A property of the KIND, so a step's width is knowable before its height
   * is measured (§7.2's build order). Everything else flows.
   */
  const isCentrepiece = (step: Step): boolean =>
    // A board's own TITLE is written ACROSS the top of it, not down one
    // column — the one heading level that names the whole board. `##`
    // turns a section INSIDE the flow and stays in its column.
    (step.kind === "heading" && step.level === 1) ||
    // A chart / graph frame is sized by its own drawing, not by prose
    // wrapping, and dagre lays a graph out against the width it is given:
    // squeezed to a column it would re-layout, and a column cannot hold a
    // ruled pair of axes at a legible scale.
    step.kind === "chart-frame" ||
    step.kind === "graph-frame";

/**
 * W2 — a display formula SHRINKS TO FIT its box, and this is the only
 * mechanism that lets it be commanding AND safe.
 *
 * MathML never wraps, and the corpus's widest formula is ~13.5x its own font
 * size wide, so a fixed display size is a bet on the reader's window: at
 * 42px it fits a 565px column and runs 59px past the panel edge in a 465px
 * one, where the panel's `overflow: hidden` EATS it. Measured on the live
 * board, 2026-08-12, at both live viewport widths.
 *
 * Worse than the arithmetic suggests: the box is absolutely positioned with
 * both `left` and `right`, so a `fit-content` width wider than the box is
 * OVER-CONSTRAINED and CSS drops the `auto` margins that centre it — the
 * formula stops being centred and grows rightward from its left edge, which
 * doubles the overflow and puts all of it on one side.
 *
 * So the stylesheet's size is a CEILING (what a short formula gets) and this
 * is the floor-fitting: one measurement, one ratio, deterministic. Reset
 * first so the reading is the ceiling rather than the last fit — that is
 * what makes it idempotent across rebuilds and re-measures, which matters
 * because a wrong fit here would be baked into `naturalDuration` and the
 * reconcile hash like any other measured height.
 */
const MATH_FIT_SAFETY = 0.98;

function fitMathToBox(node: HTMLElement, boxW: number): void {
  const host = node.classList.contains("bansho-math-block")
    ? node
    : node.querySelector<HTMLElement>(".bansho-math-block");
  if (!host || !(boxW > 0)) return;
  host.style.fontSize = "";
  const natural = host.scrollWidth;
  if (!(natural > boxW)) return;
  const ceiling = Number.parseFloat(getComputedStyle(host).fontSize) || 0;
  if (!(ceiling > 0)) return;
  host.style.fontSize = `${Math.floor(ceiling * (boxW / natural) * MATH_FIT_SAFETY * 100) / 100}px`;
}

/**
 * The STAGE half of the fold input — every step's kind, key and region
 * verb, with no height anywhere in it.
 *
 * It is its own function because it is read TWICE per build, from opposite
 * ends of the measure pass: once before the first node exists (to size the
 * measure host each step is built in — design §7.2's "a named step's
 * measure container width must equal the word's width") and once after (to
 * feed the fold the heights that measure produced). One implementation, so
 * a step can never be built in one region's frame and folded as if it
 * stood in another.
 */
function stageInputsOf(entries: readonly ReconcileEntry[]): {
  inputs: LayoutStepInput[];
  contentAt: Map<string, ReconcileEntry>;
} {
  const inputs: LayoutStepInput[] = [];
  const contentAt = new Map<string, ReconcileEntry>();
  for (const entry of entries) {
    const k = refKey(entry.ref);
    const step = entry.step;
    if (
      step.kind === "wait" ||
      step.kind === "camera" ||
      step.kind === "board-config"
    ) {
      continue; // pure time / pure config — no space, no fold effect
    }
    if (step.kind === "erase") {
      inputs.push({
        kind: "erase",
        key: k,
        ...(step.target ? { anchorKey: refKey(step.target) } : {}),
      });
      continue;
    }
    if (step.kind === "turn") {
      inputs.push({ kind: "turn", key: k });
      continue;
    }
    if (step.kind === "at") {
      // A placement occupies no space on the face — it moves the pen, it
      // does not write. It is a fold input all the same: the walk is what
      // every later content step's region depends on.
      inputs.push({
        kind: "at",
        key: k,
        region: step.region,
        ...(step.target ? { anchorKey: refKey(step.target) } : {}),
      });
      continue;
    }
    contentAt.set(k, entry);
    inputs.push({
      kind: "content",
      key: k,
      height: 0,
      ...(isCentrepiece(step) ? { span: "face" as const } : {}),
    });
  }
  return { inputs, contentAt };
}

/**
 * Present the measure host at the width the content will finally occupy —
 * G8-M, the measure pass's own contract.
 *
 * Every text-bearing factory measures its node while it is parented HERE
 * (prose.ts's line-box read, rule.ts's `clientWidth`, math.ts's fraction
 * bars), and an underline is nothing but "the line boxes this run
 * occupied". So a host wider than the box does not merely mis-report a
 * height: the run does not wrap where it will really wrap, there is one
 * row where there will be two, and the ink is drawn for a line the reader
 * never sees. The host is the stage's SIBLING (G8-K) and this width comes
 * from the fold's own arithmetic rather than from any live rect, so
 * nothing about it varies with the camera.
 *
 * `undefined` restores the stylesheet's own inset — the notes projection
 * measures in CSS flow on purpose (§8's control group), and a board→notes
 * switch must not inherit a column width from the board it left.
 */
function setMeasureWidth(host: HTMLElement, width: number | undefined): void {
  if (width === undefined || !(width > 0)) {
    host.style.width = "";
    host.style.right = "";
    return;
  }
  // `right` must go: with `left`, `right` and `width` all set, CSS drops
  // one of them by direction rather than by intent.
  host.style.right = "auto";
  host.style.width = `${width}px`;
}

/**
 * Give a figure its box — EXPLICITLY, and fitted inside its region on both
 * axes. 「不能有什么东西被挤出画面」.
 *
 * A picture is the only box on a board whose height is not a consequence
 * of how much was written but of how wide it was made, and it was the only
 * box the mount never sized. Measured in Chromium on 2026-08-13: every
 * figure came out 1242px wide — the WHOLE board — at whatever `left` its
 * region gave it, so a half-width column figure hung 633px off the right
 * edge, and a 1:1 figure hung 384px off the bottom as well. The insets
 * were right; the box ignored them, because `.bansho-illustration` carried
 * `width: 100%` and a percentage on an absolute box resolves against the
 * containing block. Both halves are fixed: the stylesheet no longer says a
 * width, and this says the only one that is true.
 *
 * The number is arithmetic on the region's own rectangle
 * (`illustrationBox`) — canonical coordinates the plan layer already has.
 * No `naturalWidth`, no client rect, nothing measured: a figure's geometry
 * stays a function of the DOCUMENT, so the same lecture folds identically
 * at every window size (R8) and the two-width byte gate still holds.
 *
 * Why this was not winnable from the authoring side, and so had to be
 * fixed here: the cold-agent trial watched an author see the cut, move the
 * figure to a bigger region, and get a WORSE overflow (44px → 633px),
 * because the size ignored the region it was moved to. Their judgement was
 * right at every step and the engine made the correction impossible.
 */
function sizeFigure(item: BuiltItem, region: { w: number; h: number }): void {
  const node = item.node;
  if (!(node instanceof HTMLElement)) return;
  const aspect = figureAspect(node);
  // Not a figure, or a picture that could not be drawn: a badge is not a
  // box with a shape, and nothing else on the board is sized this way.
  if (aspect === undefined) return;
  const width = `${illustrationBox(region, aspect).w}px`;
  if (node.style.width === width) return;
  node.style.width = width;
  // Its height IS this width through the declared aspect, so a new width
  // is a new height and the cached fold charge belongs to the old box.
  // (`measuredWidth` is deliberately untouched: that one records the BOX
  // the fold placed, which the corrective pass compares against, and a
  // figure narrower than its box must not read as a width mismatch.)
  item.foldHeight = undefined;
}

  const computeFoldInputs = useCallback(
    (
      entries: ReconcileEntry[],
      lecture: Lecture,
      /**
       * The face this build is measuring against (design §7.2's build-order
       * pin). Present on the rebuild path, where a NAMED step must be put
       * in its region's frame before its height is read; absent on the
       * snapshot-basis path, whose items are already measured and cached
       * (a glance measures nothing — it reads the board that is standing).
       */
      frame?: BuildFace,
      /**
       * The corrective pass's answer key: step → the width the FOLD placed
       * it at. Present only on a re-measure, and it OUTRANKS the pre-scan —
       * re-measuring at the width that was already wrong would just produce
       * the same wrong height a second time.
       */
      widthOverride?: ReadonlyMap<string, number>,
    ): LayoutStepInput[] => {
      const byRef = itemByRefRef.current;
      /**
       * ONE measurement per item, ONE height (README ruling #4, collapsed
       * 2026-08-11): the fractional border-box height CSS flow itself
       * spaces with — read through the G8-J funnel so a live camera scale
       * can never leak in — plus the two margins. The fill cursor's charge
       * is that margin box; the box chain's metrics are its three parts.
       */
      const measureItem = (item: BuiltItem, wantWidth: number): number => {
        if (item.foldHeight !== undefined && item.measuredWidth === wantWidth) {
          return item.foldHeight;
        }
        let h = 0;
        const n = item.node;
        const base = boardRef.current;
        if (
          n instanceof HTMLElement &&
          (n.offsetWidth > 0 || n.offsetHeight > 0)
        ) {
          const cs = getComputedStyle(n);
          const marginTop = Number.parseFloat(cs.marginTop) || 0;
          const marginBottom = Number.parseFloat(cs.marginBottom) || 0;
          h = n.offsetHeight + marginTop + marginBottom;
          if (base) {
            // The depth surface must be lifted here too, and this is the
            // call site that PROVED the rule (V1.5): measured through a 4°
            // parallax tilt, `rect.bottom - rect.top` came back inflated,
            // every box in the chain inherited it, and a 4218px board
            // folded to 7629px — with every individual `h` still reading
            // correct afterwards, so nothing about the symptom pointed
            // here. The funnel now demands the surface as an argument, so
            // the omission is a compile error rather than a board that
            // grows when the reader moves the mouse.
            const rect = boardRects(
              base,
              [n],
              depthRef.current,
              surfaceRef.current,
            )[0]!;
            item.boxMetrics = {
              h: rect.bottom - rect.top,
              marginTop,
              marginBottom,
            };
            // The charge IS the box's margin box — one measurement, one
            // truth. (V1 billed `offsetHeight + margins` here instead.)
            h = rect.bottom - rect.top + marginTop + marginBottom;
          }
        }
        item.foldHeight = h;
        item.measuredWidth = wantWidth;
        return h;
      };
      // P1-2 — a graph layer's arrival regrows its container's frame (the
      // dagre canvas is the accumulated union), and the fold charges that
      // growth at the LAYER's document position (see
      // `LayoutStepInput.growth`) so an append never moves a step the
      // audience has already seen.
      const layerGrowth = new Map<string, number>();
      {
        const asBlock = (
          step: GraphFrameStep | GraphLayerStep,
        ): GraphPrefixBlock => ({
          nodes: step.nodes,
          edges: step.edges,
          notes: graphNoteWrites(lecture.source, step.srcSpan),
        });
        const graphs = new Map<
          string,
          { frame: GraphFrameStep; blocks: GraphPrefixBlock[]; keys: string[] }
        >();
        for (const entry of entries) {
          const step = entry.step;
          if (step.kind === "graph-frame") {
            graphs.set(step.graph, {
              frame: step,
              blocks: [asBlock(step)],
              keys: [],
            });
          } else if (step.kind === "graph-layer") {
            const g = graphs.get(step.graph);
            if (!g) continue;
            g.blocks.push(asBlock(step));
            g.keys.push(refKey(entry.ref));
          }
        }
        for (const { frame, blocks, keys } of graphs.values()) {
          if (keys.length === 0) continue;
          const home = containersRef.current.get(containerKeyOf(frame)!);
          const boxW =
            home?.node instanceof HTMLElement ? home.node.clientWidth : 0;
          const heights = graphPrefixFlowHeights(frame.layout, blocks, boxW);
          keys.forEach((key, i) => {
            const grew = heights[i + 1]! - heights[i]!;
            if (grew > 0) layerGrowth.set(key, grew);
          });
        }
      }
      // The stage half of the fold input, built FIRST and without a single
      // height (design §7.2's build-order pin) — the SAME list the measure
      // pass scanned its widths off before the first node was built, minus
      // the steps that failed to build.
      const { inputs: allStageInputs, contentAt: allContentAt } =
        stageInputsOf(entries);
      const stageInputs = allStageInputs.filter(
        (input) => input.kind !== "content" || byRef.has(input.key),
      );
      const contentAt = new Map<string, ReconcileEntry>();
      for (const [k, entry] of allContentAt) {
        if (byRef.has(k)) contentAt.set(k, entry);
      }

      // §9's guard: put every NAMED step in its region's frame before its
      // height is read. `full` steps are deliberately left alone — not as
      // an optimisation but as a guarantee: a document that never says
      // `@at` takes byte-for-byte the path it took before regions existed,
      // down to the absence of the style writes.
      //
      // ONE EXCEPTION, and it is not an erosion of that guarantee: a
      // FIGURE is sized here whatever its region (`sizeFigure`). Its box
      // is the only one on the board that is not a consequence of how much
      // was written, so leaving it unsized does not preserve an older
      // behaviour — it reproduces a defect that has no older correct
      // version to preserve (see `sizeFigure`). Figures postdate regions
      // entirely, so there is no pre-region path of theirs to be faithful
      // to.
      const widthOf = new Map<string, number>();
      if (frame) {
        // ONE ANSWER to "how wide is this box" (`layout.ts::scanBoxRects`),
        // and this is its second consumer: the first is the measure host
        // the node was BUILT in, so the lines this mount shows are the
        // lines its ink was drawn under.
        const scan = scanBoxRects(stageInputs, frame);
        for (const k of contentAt.keys()) {
          const scanned = scan.get(k) ?? {
            x: 0,
            y: 0,
            w: frame.faceW,
            h: frame.faceH,
          };
          const forced = widthOverride?.get(k);
          // A forced width is a WIDTH, not a frame: keep the scanned x
          // unless the two disagree, in which case the only honest x is
          // the one that pairs with the forced width — and the mount below
          // will restate both from the fold a moment later anyway.
          const rect =
            forced === undefined || forced === scanned.w
              ? scanned
              : { ...scanned, x: scanned.x === 0 ? 0 : frame.faceW - forced, w: forced };
          widthOf.set(k, rect.w);
          const item = byRef.get(k);
          // A FIGURE IS SIZED, NOT INSET — and it is sized here, BEFORE
          // its height is measured a few lines down, because its height
          // IS its width through the declared aspect.
          //
          // Ahead of the `full` skip below on purpose: this one is not a
          // style write the pre-region path can do without. A `full`
          // figure is still made absolute by the mount ("Boxes land"), and
          // an absolute box with no explicit width takes its containing
          // block — which is how a half-width figure came to be drawn
          // 1242px wide, 633px of it off the board (2026-08-13). It also
          // has to be clamped on the OTHER axis whether or not it is
          // named: a 1:1 figure across a full 1154 × 794 face would be
          // 1154 deep in a board 794 deep.
          if (item && item.node instanceof HTMLElement) {
            sizeFigure(item, rect);
          }
          if (rect.w === frame.faceW && forced === undefined) continue;
          const node = item?.node;
          if (!(node instanceof HTMLElement)) continue;
          node.style.position = "absolute";
          node.style.left = `${frame.padLeft + rect.x}px`;
          node.style.right = `${frame.containingWidth - frame.padLeft - rect.x - rect.w}px`;
          fitMathToBox(node, rect.w);
        }
      }

      const foldInputs: LayoutStepInput[] = [];
      for (const input of stageInputs) {
        if (input.kind !== "content") {
          foldInputs.push(input);
          continue;
        }
        const k = input.key;
        const entry = contentAt.get(k)!;
        const item = byRef.get(k)!;
        const step = entry.step;
        // With no frame the caller is not measuring at all (the snapshot
        // basis reads cached heights): keep the item's own key so a glance
        // can never invalidate a measurement it did not take.
        const want = frame
          ? (widthOf.get(k) ?? frame.faceW)
          : (item.measuredWidth ?? 0);
        const height = measureItem(item, want);
        foldInputs.push({
          kind: "content",
          key: k,
          height,
          ...(item.boxMetrics !== undefined ? { box: item.boxMetrics } : {}),
          ...(item.container !== undefined ? { container: item.container } : {}),
          ...(input.span !== undefined ? { span: input.span } : {}),
          ...(step.kind === "backref"
            ? { anchorKey: refKey(step.target.step) }
            : {}),
          ...(layerGrowth.has(k) ? { growth: layerGrowth.get(k)! } : {}),
        });
      }
      return foldInputs;
    },
    [],
  );

  /**
   * The glance's raw material (S1, BoardApi) — see the interface JSDoc.
   * Budget mirrors the rebuild's arithmetic on the LECTURE's board count;
   * `Infinity` on the strip (count 1 never overflows).
   */
  const readSnapshotBasis = useCallback((): SnapshotBasis | null => {
    const basis = basisRef.current;
    const viewport = viewportRef.current;
    const board = boardRef.current;
    if (!basis || !viewport || !board) return null;
    const count = boardCount(basis.lecture);
    const boardStyle = getComputedStyle(board);
    const padLeft = Number.parseFloat(boardStyle.paddingLeft) || 0;
    const padRight = Number.parseFloat(boardStyle.paddingRight) || 0;
    let budget = Infinity;
    if (count > 1) {
      const padTop = Number.parseFloat(boardStyle.paddingTop) || 0;
      const padBottom = Number.parseFloat(boardStyle.paddingBottom) || 0;
      budget = Math.max(1, PANEL_HEIGHT - padTop - padBottom);
    }
    // W2 — the SAME arithmetic the rebuild runs. The glance folds without a
    // face width (membership needs no geometry), so if the column count
    // were derived from that absent width the glance would answer for a
    // one-column board while the reader watches a two-column one.
    const faceWidth = Math.max(0, board.clientWidth - padLeft - padRight);
    return {
      inputs: computeFoldInputs(basis.entries, basis.lecture),
      count,
      budget,
      columns: columnCountFor(faceWidth, budget),
      source: basis.lecture.source,
      lecture: basis.lecture,
    };
  }, [computeFoldInputs]);

  // ── frame-board's surface (canvas pivot §6) ──────────────────────────────
  // Three methods, one discipline: two READ the fold and one DRAWS what it
  // is handed. None of them resolves a region word — that lives in
  // `engine/regions.ts` and reaches here already resolved, which is what
  // makes "the preview and the fold cannot disagree" mechanical rather
  // than a promise.

  const readFrameGeometry = useCallback((): FrameGeometry | null => {
    const layout = layoutRef.current;
    const face = faceRef.current;
    if (!layout || !face) return null;
    const panel = layout.cur;
    return {
      panel,
      boards: layout.count,
      faceW: face.faceW,
      faceH: face.faceH,
      // The write front — where a NEW placement starts. On the strip that
      // is the fold's own cursor for the pen's board; on a bounded board a
      // region word says its own y, so the front is not consulted.
      front: layout.panels[panel]?.cursor ?? 0,
      stripDepth: layout.faceExtent[panel] ?? 0,
    };
  }, []);

  const readStandingBoxes = useCallback((): StandingBox[] => {
    const layout = layoutRef.current;
    if (!layout) return [];
    return standingBoxes(layout, foldInputsRef.current);
  }, []);

  const framesTarget = useCallback(
    (): HTMLElement | null => panelsRef.current,
    [],
  );

  const paintFrames = useCallback((layer: FrameLayer): (() => void) => {
    const panelEl = panelElsRef.current[layer.panel] ?? boardRef.current;
    const board = boardRef.current;
    if (!panelEl || !board) return () => {};
    const style = getComputedStyle(board);
    const padLeft = Number.parseFloat(style.paddingLeft) || 0;
    const padTop = Number.parseFloat(style.paddingTop) || 0;

    // A face coordinate converts to a panel coordinate by ONE padding —
    // exactly the conversion every box already makes (see "Boxes land").
    const at = (r: Rect, cap: number): Partial<CSSStyleDeclaration> => ({
      position: "absolute",
      left: `${padLeft + r.x}px`,
      top: `${padTop + r.y}px`,
      width: `${Math.max(0, r.w)}px`,
      height: `${Math.max(0, Number.isFinite(r.h) ? r.h : cap)}px`,
    });
    const put = (
      cls: string,
      css: Partial<CSSStyleDeclaration>,
    ): HTMLDivElement => {
      const el = document.createElement("div");
      el.className = cls;
      Object.assign(el.style, css);
      root.appendChild(el);
      return el;
    };

    const root = document.createElement("div");
    root.setAttribute("data-bansho-frames", "");
    Object.assign(root.style, {
      position: "absolute",
      inset: "0",
      pointerEvents: "none",
      zIndex: "40",
    } satisfies Partial<CSSStyleDeclaration>);

    // How deep an open (depth-undeclared) frame is DRAWN. It is a drawing
    // length, never a claim: the frame gets no bottom edge, and the report
    // says the depth is undeclared.
    const openCap = layer.window
      ? layer.window.to - Math.max(layer.window.from, 0)
      : panelEl.offsetHeight;

    for (const box of layer.standing) {
      if (box.panel !== layer.panel) continue;
      put("bansho-frame-standing", {
        ...at(box.rect, openCap),
        border: "1px solid color-mix(in oklab, var(--s2, #7dd3fc) 70%, transparent)",
        background: "color-mix(in oklab, var(--s2, #7dd3fc) 8%, transparent)",
        borderRadius: "2px",
      });
    }

    layer.frames.forEach((frame, i) => {
      const hue = 24 + i * 47;
      const tint = `hsl(${hue} 92% 60%)`;
      const el = put("bansho-frame-candidate", {
        ...at(frame.rect, openCap),
        border: `2px dashed ${tint}`,
        ...(frame.open ? { borderBottom: "none" } : {}),
        background: `color-mix(in oklab, ${tint} 18%, transparent)`,
        borderRadius: "3px",
      });
      // The caption is the candidate's TAG — a letter the report keys on,
      // never a word of the content that has not been written yet.
      const tagEl = document.createElement("div");
      tagEl.textContent = frame.tag;
      Object.assign(tagEl.style, {
        position: "absolute",
        top: "0",
        left: "0",
        padding: "1px 6px",
        font: "600 13px/1.4 ui-sans-serif, system-ui, sans-serif",
        color: "#09090b",
        background: tint,
        borderRadius: "0 0 3px 0",
      } satisfies Partial<CSSStyleDeclaration>);
      el.appendChild(tagEl);

      // The intersections, hatched. Also already-known rectangles.
      for (const box of layer.standing) {
        if (box.panel !== layer.panel) continue;
        const hit = intersection(frame.rect, box.rect);
        if (hit.w <= 0 || hit.h <= 0) continue;
        put("bansho-frame-hit", {
          ...at(hit, openCap),
          backgroundImage: `repeating-linear-gradient(45deg, ${tint} 0 3px, transparent 3px 8px)`,
          opacity: "0.55",
        });
      }
    });

    panelEl.appendChild(root);
    return () => root.remove();
  }, []);

  /**
   * The collision marks (design §5.3's human channel) — repainted from
   * scratch on every rebuild, because a mark is a statement about the board
   * as it stands NOW and a stale one would be a lie.
   *
   * Unlike `paintFrames` (a transient preview of a hypothesis, torn down
   * when the agent's question is answered) these live as long as the
   * overlap does: they are what stops a colliding board from reading as a
   * broken renderer. They add nothing to the layout — one absolutely
   * positioned, `pointer-events: none` layer per panel, sitting under the
   * frame preview's z-index and over the writing, so both parties stay
   * exactly where and how the author declared them.
   */
  const paintCollisions = useCallback(
    (collisions: readonly BoxCollision[]): void => {
      /** Board px a caption needs above an overlap to sit outside it. */
      const CAPTION_CLEARANCE = 22;
      for (const panelEl of panelElsRef.current) {
        for (const stale of Array.from(
          panelEl?.querySelectorAll<HTMLElement>("[data-bansho-collisions]") ??
            [],
        )) {
          stale.remove();
        }
      }
      const board = boardRef.current;
      if (!board || collisions.length === 0) return;

      // Face → panel coordinates by ONE padding, the same conversion every
      // box and every frame makes.
      const style = getComputedStyle(board);
      const padLeft = Number.parseFloat(style.paddingLeft) || 0;
      const padTop = Number.parseFloat(style.paddingTop) || 0;

      const roots = new Map<number, HTMLElement>();
      const rootFor = (panel: number): HTMLElement | null => {
        const existing = roots.get(panel);
        if (existing) return existing;
        const panelEl = panelElsRef.current[panel];
        if (!panelEl) return null;
        const root = document.createElement("div");
        root.setAttribute("data-bansho-collisions", "");
        Object.assign(root.style, {
          position: "absolute",
          inset: "0",
          pointerEvents: "none",
          zIndex: "30",
        } satisfies Partial<CSSStyleDeclaration>);
        panelEl.appendChild(root);
        roots.set(panel, root);
        return root;
      };

      for (const mark of collisionMarks(collisions)) {
        const root = rootFor(mark.panel);
        if (!root) continue;
        const el = document.createElement("div");
        el.className = "bansho-collision";
        el.setAttribute("data-bansho-collision", mark.pair);
        Object.assign(el.style, {
          position: "absolute",
          left: `${padLeft + mark.rect.x}px`,
          top: `${padTop + mark.rect.y}px`,
          width: `${Math.max(0, mark.rect.w)}px`,
          height: `${Math.max(0, mark.rect.h)}px`,
          pointerEvents: "none",
        } satisfies Partial<CSSStyleDeclaration>);
        if (mark.label) {
          // The caption prefers the clear air ABOVE the overlap — inside
          // it, it would cover the very doubled ink it is describing. Only
          // when there is no room above (an overlap at the board's head)
          // does it fall inside, which the CSS keys on.
          if (padTop + mark.rect.y < CAPTION_CLEARANCE) {
            el.setAttribute("data-bansho-collision-caption", "inside");
          }
          const label = document.createElement("div");
          label.className = "bansho-collision-label";
          const head = document.createElement("span");
          head.className = "bansho-collision-pair";
          head.textContent = mark.label;
          const note = document.createElement("span");
          note.className = "bansho-collision-note";
          note.textContent = COLLISION_MARK_NOTE;
          label.append(head, note);
          el.appendChild(label);
        }
        root.appendChild(el);
      }
    },
    [],
  );

  /**
   * The cut line (W8) — the reader's half of `visibly`.
   *
   * A panel clips at its own edge, so a burst that passes the board's floor
   * takes the rest of the sentence with it and leaves a clean edge behind:
   * nothing in the picture, and nothing in a `capture`, says a word was
   * lost. This draws that loss where it happens — one dashed rule across
   * the bursting region's own width, captioned with how much is below it.
   *
   * Same construction as `paintCollisions`, for the same reason: one
   * absolutely positioned, `pointer-events: none` layer per panel, wiped
   * and repainted on every rebuild. It reaches no layout number — the fold
   * measures the step boxes it placed, this is neither — so the board can
   * never grow because it overflowed.
   */
  const paintBursts = useCallback((bursts: readonly RegionBurst[]): void => {
    for (const panelEl of panelElsRef.current) {
      for (const stale of Array.from(
        panelEl?.querySelectorAll<HTMLElement>("[data-bansho-bursts]") ?? [],
      )) {
        stale.remove();
      }
    }
    const board = boardRef.current;
    const face = faceRef.current;
    if (!board || !face) return;
    const marks = burstMarks(bursts, face.faceH);
    if (marks.length === 0) return;

    const style = getComputedStyle(board);
    const padLeft = Number.parseFloat(style.paddingLeft) || 0;
    const padTop = Number.parseFloat(style.paddingTop) || 0;

    const roots = new Map<number, HTMLElement>();
    const rootFor = (panel: number): HTMLElement | null => {
      const existing = roots.get(panel);
      if (existing) return existing;
      const panelEl = panelElsRef.current[panel];
      if (!panelEl) return null;
      const root = document.createElement("div");
      root.setAttribute("data-bansho-bursts", "");
      Object.assign(root.style, {
        position: "absolute",
        inset: "0",
        pointerEvents: "none",
        zIndex: "30",
      } satisfies Partial<CSSStyleDeclaration>);
      panelEl.appendChild(root);
      roots.set(panel, root);
      return root;
    };

    for (const mark of marks) {
      const root = rootFor(mark.panel);
      if (!root) continue;
      const el = document.createElement("div");
      el.className = "bansho-burst";
      el.setAttribute("data-bansho-burst", mark.region);
      Object.assign(el.style, {
        position: "absolute",
        left: `${padLeft + mark.rect.x}px`,
        top: `${padTop + mark.rect.y}px`,
        width: `${Math.max(0, mark.rect.w)}px`,
        pointerEvents: "none",
      } satisfies Partial<CSSStyleDeclaration>);
      // The caption hangs BELOW the rule, in the board's own bottom margin
      // — above it, it would cover the last line the reader still has.
      const label = document.createElement("div");
      label.className = "bansho-burst-label";
      const head = document.createElement("span");
      head.className = "bansho-burst-where";
      head.textContent = mark.label;
      const note = document.createElement("span");
      note.className = "bansho-burst-note";
      note.textContent = BURST_MARK_NOTE;
      label.append(head, note);
      el.appendChild(label);
      root.appendChild(el);
    }
  }, []);

  /** The stage origin of the board a stage rect lives on (home unstaged).
   *  Both axes: on a wall with rows, "which board" is a 2D question. */
  const panelSlotOf = useCallback(
    (rect: StageRect): { x: number; y: number } => {
      if (!stagedMultiRef.current || !panelSizedRef.current) {
        return { x: 0, y: 0 };
      }
      const geom = wallGeom();
      const point = {
        x: (rect.left + rect.right) / 2,
        y: (rect.top + rect.bottom) / 2,
      };
      return wallSlot(wallSlotAt(point, panelCount, geom), panelCount, geom);
    },
    [panelCount, wallGeom],
  );

  // ── 瑕疵 lands (W3) ───────────────────────────────────────────────────────
  // The imperfection layer, stamped onto the boxes the fold has already
  // placed. EVERY number written here reaches a CSS `transform` and nothing
  // else, which is the whole safety argument: a rotated box occupies its
  // unrotated slot, so the fold above cannot see this pass, `naturalDuration`
  // cannot see it, and the reconcile hash cannot see it.
  //
  // Three structural choices, each load-bearing:
  //
  //   - CUSTOM PROPERTIES, not finished transform strings. The stylesheet
  //     holds ONE rule per kind; lifting the whole layer for a measurement
  //     is then one attribute write instead of N (`withFlawSuspended`), and
  //     a stale property on a reused node is inert the moment the gate is
  //     off.
  //   - THE GATE IS SET ONLY WHEN THE KNOB IS ABOVE ZERO. At 0 no rule
  //     matches, so a clean board carries no transform at all — not
  //     `rotate(0deg)`, which would mint a stacking context and a
  //     containing block for nothing. "0 is provably inert" is a structural
  //     absence, the same argument `.bansho-depth` makes at rest.
  //   - SCOPED TO `[data-bansho-box="1"]`. The notes projection and the
  //     hidden measure host never carry that flag, so the ink a factory
  //     draws is measured on a board that is dead flat, by construction
  //     rather than by care.
  //
  // Write-only: no rect is read in this loop, so it costs one style recalc
  // at compile rate and never a forced reflow.
  const stampFlaw = useCallback((): void => {
    const surface = surfaceRef.current;
    const layout = layoutRef.current;
    if (!surface) return;
    const knob = clampFlaw(
      Number.parseFloat(
        getComputedStyle(surface).getPropertyValue(FLAW_KNOB_PROP),
      ),
    );
    if (knob === 0) {
      delete surface.dataset[FLAW_FLAG];
      return;
    }
    surface.dataset[FLAW_FLAG] = "";
    if (!layout) return;
    const stamp = String(knob);
    for (const k of layout.boxes.keys()) {
      const item = itemByRefRef.current.get(k);
      const node = item?.node;
      if (!(node instanceof HTMLElement)) continue;
      if (node.dataset.banshoFlawAt === stamp) continue;
      node.dataset.banshoFlawAt = stamp;
      // Content-seeded, never positional — a streaming append must not
      // re-lean writing the audience is already looking at (§7 R1/R4).
      const seed = contentSeed(item!.step);
      const b = blockFlaw(seed, knob);
      node.style.setProperty(FLAW_VARS.rotate, `${b.rotate}deg`);
      node.style.setProperty(FLAW_VARS.skewX, `${b.skewX}deg`);
      node.style.setProperty(FLAW_VARS.shiftX, `${b.shiftX}px`);
      node.style.setProperty(FLAW_VARS.shiftY, `${b.shiftY}px`);
      // One stream per block, walked in DOM order: a word's drift is a
      // function of its block's content and of its place in it, and of
      // nothing else — so a re-mount reproduces it exactly.
      const rnd = wordStream(seed);
      for (const w of node.querySelectorAll<HTMLElement>(".bansho-w")) {
        const f = wordFlaw(rnd, knob);
        w.style.setProperty(FLAW_VARS.wordDrift, `${f.drift}px`);
        w.style.setProperty(FLAW_VARS.wordRotate, `${f.rotate}deg`);
      }
    }
  }, []);

  // A content set's `theme.css` OWNS the knob, and an author tuning it has
  // to see the board change. The stylesheet is injected by the host, so a
  // knob edit is invisible to reconcile (the board bytes did not move) —
  // hence this one dependency. Re-stamping is paint-only and cannot
  // invalidate a measurement, so it is deliberately NOT routed through
  // `invalidateMeasurements`: a knob edit must not re-fold the board.
  useEffect(() => {
    stampFlaw();
  }, [stampFlaw, themeCss]);

  // ── The reconcile-driven rebuild ─────────────────────────────────────────
  useEffect(() => {
    const board = boardRef.current;
    const measureHost = measureRef.current;
    if (!board || !measureHost || !fontsReady) return;

    // Last build's fold is not this build's board. Everything below until
    // the fold runs happens in the PROVISIONAL flow — the build loop puts
    // every node in panel 0, in document order — so a measurement taken
    // there must read the provisional truth (base panel 0, nothing
    // orphaned) and not last build's panel numbers and verdicts. Every
    // such measurement is re-taken after distribution (the re-anchor
    // pass), except on a board that stopped being staged this build — the
    // one case where the stale verdict would be the FINAL word.
    layoutRef.current = null;

    // A resize invalidated every measured geometry: the debounced handler
    // cleared the build state but left the DOM alone — the stale nodes are
    // wiped HERE, in the same task as the rebuild + seek below, so the
    // browser can never paint an empty board in between (G5: content never
    // disappears, not even for one frame). No-op on the very first build.
    if (!stateRef.current) {
      for (const p of panelElsRef.current) {
        if (p) wipeSteps(p);
      }
    }

    const doc = board.ownerDocument;
    let currentAlign: number | undefined;
    /** The entry under construction — the erase seam's key (alignShift's
     *  pattern: the step value cannot name its board; the fold can). */
    let currentBuildKey = "";
    const ctx: MeasureContext = {
      durations: DEFAULT_DURATIONS,
      document: doc,
      measureHost,
      env,
      alignShift: () => currentAlign,
      container: (key) => containersRef.current.get(key),
      // The seam needs to know WHICH annotation is asking (the fold's
      // orphan verdict is about the ink, not about its target), and the
      // step value cannot name itself — same closure the erase seam and
      // `alignShift` use, so `MeasureContext.backRef` keeps its contract
      // signature.
      backRef: (target) => measureBackRef(target, currentBuildKey),
      stageAnchor: measureStageAnchor,
      // I1 — the picture seam. The host owns path → URL (it must be
      // ROOT-RELATIVE: a mask reads pixels, so a cross-origin source
      // paints nothing at all and says nothing about it) and owns the
      // refusal; the factory owns the box and the reveal.
      illustration: (step) => illustrations?.resolve(step.src),
      // C3 — the eraser's live handle: a DOUBLE deferred lookup (key →
      // run → wrapper), because at build time the fold has not run yet
      // (it needs every height), and wrappers are reminted per rebuild.
      // Every rebuild ends in a fresh makeSeek + synchronous
      // seek(playhead), so a late-bound handle is always consistent.
      // The notes projection schedules no erase units, so the factory's
      // degraded path is fine there.
      ...(view === "board"
        ? {
            eraseTarget: (step: Step) => {
              if (step.kind !== "erase") return undefined;
              const k = currentBuildKey;
              return {
                resolve: () => {
                  const run = eraseRunByKeyRef.current.get(k);
                  return run ? (runElsRef.current.get(run) ?? null) : null;
                },
              };
            },
          }
        : {}),
    };
    // Probe builds run with `currentAlign` unset — the factory then inserts
    // its zero-width marker, which is exactly the probe protocol.
    const probeCtx: MeasureContext = ctx;

    const entries = toEntries(lecture);

    // ── The face, read BEFORE one node is built (design §7.2) ────────────
    // The build order is parse → mount each step AT ITS OWN WIDTH → measure
    // h → fold → place, and it is the second arrow that needs the face. So
    // the panel geometry is read here, above the measure passes, instead of
    // beside the fold that also consumes it.
    //
    // Reading it early reads exactly the same numbers: every input — the
    // viewport's width, the board count, the stylesheet's padding — is
    // independent of what is about to be built (a panel's width is the
    // room's, never its content's), and the CSS custom properties the wall
    // grid keys on are written here, before anything reads back from them.
    // Reading it LATE is what left every run measured against a face its
    // box never stands in.
    const viewportEl = viewportRef.current;
    const staged = view === "board";
    stagedMultiRef.current = staged && panelCount > 1;
    const panelsEl = panelsRef.current;
    let face: BuildFace | null = null;
    if (staged && viewportEl && panelsEl) {
      // A BOARD HAS A SIZE (W7). It used to be `viewportEl.clientWidth`,
      // and everything downstream — the measure, the wraps, the fold, the
      // erase verdicts — therefore followed the reader's window: two people
      // opening one `board.md` at two window sizes watched two different
      // lectures. The size is a constant now, and the geometry the board is
      // built at is the SAME on every screen. The window is read only for
      // the CAMERA (`viewW`/`viewH` below), which is where it belongs.
      //
      // The panel's own `--bansho-panel-w` / `-h` are written in JSX from
      // the same constants (they must exist in the notes projection too,
      // which never reaches this branch), so nothing is set here.
      const panelW = PANEL_WIDTH;
      panelSizedRef.current = true;
      viewWRef.current = viewportEl.clientWidth;
      viewHRef.current = viewportEl.clientHeight;
      const panelH = PANEL_HEIGHT;
      const boardStyle = getComputedStyle(board);
      const padTop = Number.parseFloat(boardStyle.paddingTop) || 0;
      const padBottom = Number.parseFloat(boardStyle.paddingBottom) || 0;
      const padLeft = Number.parseFloat(boardStyle.paddingLeft) || 0;
      const padRight = Number.parseFloat(boardStyle.paddingRight) || 0;
      const budget =
        panelCount > 1 ? Math.max(1, panelH - padTop - padBottom) : Infinity;
      // The face every box is quoted against: the board's CONTENT box.
      // `clientWidth` is the padding box (the containing block absolute
      // positioning resolves against), so the face is what is left of it.
      const faceWidth = Math.max(0, board.clientWidth - padLeft - padRight);
      faceRef.current = { faceW: faceWidth, faceH: budget };
      face = {
        padTop,
        padLeft,
        padBottom,
        faceW: faceWidth,
        faceH: budget,
        // W2 — one function, both fold call sites (see `foldBoardLayout`'s
        // `columns` parameter for why it may not be derived inside the
        // fold).
        columns: columnCountFor(faceWidth, budget),
        containingWidth: board.clientWidth,
      };
    }
    /**
     * The width each step's node is BUILT at — §7.2's build-order pin made
     * mechanical. Empty for the notes projection, which measures in CSS
     * flow on purpose (design §8's control group).
     */
    const buildWidths = new Map<string, number>();
    if (face) {
      for (const [key, rect] of scanBoxRects(
        stageInputsOf(entries).inputs,
        face,
      )) {
        buildWidths.set(key, rect.w);
      }
    }
    /** Present the host at the width THIS step's box will occupy. */
    const measureAt = (key: string): void => {
      setMeasureWidth(measureHost, buildWidths.get(key));
    };

    // Align probe pass (§4.3): measure each NEW aligned item's natural
    // label width once (cached by content hash), then derive per-group
    // column targets. Group maxima feed `alignShift` in the real build so
    // ink geometry is measured with the final column widths in place.
    const alignedIdx: number[] = [];
    for (let i = 0; i < entries.length; i++) {
      const step = entries[i]!.step;
      if (step.kind === "list-item" && step.align) alignedIdx.push(i);
    }
    const labelCache = labelWidthRef.current;
    for (const i of alignedIdx) {
      const entry = entries[i]!;
      if (labelCache.has(entry.hash)) continue;
      const factory = factoryFor("list-item");
      if (!factory) break;
      // The probe measures in the SAME frame the real build will use — a
      // column target quoted against a wrap the reader never sees is the
      // very disease the width pin exists to cure, one grain finer.
      measureAt(refKey(entry.ref));
      const { node } = factory.build(entry.step, probeCtx);
      measureHost.appendChild(node);
      let width: number | null = null;
      const spacer = node.querySelector(".bansho-align-spacer");
      const textEl = node.querySelector(".bansho-text");
      if (spacer && textEl) {
        // Measured inside the measure host — G8-K keeps it at scale 1, so
        // the funnel's divide is exact identity; routed through it anyway
        // so this file holds ZERO raw rect reads (the G8-J scan gate).
        const w = deltaLeft(measureHost, spacer, textEl);
        if (Number.isFinite(w) && w > 0) width = w;
      }
      measureHost.removeChild(node);
      labelCache.set(entry.hash, width);
    }
    // The cache is a perf memo for the CURRENT document only. An agent
    // editing list items all session accretes one entry per historical
    // hash — sweep the dead ones so the map stays bounded by document
    // size (it lives on the live path). The size guard skips the sweep
    // on the common append-only rebuild.
    if (labelCache.size > entries.length) {
      const live = new Set(entries.map((e) => e.hash));
      for (const key of labelCache.keys()) {
        if (!live.has(key)) labelCache.delete(key);
      }
    }
    const groupMax = new Map<number, number>();
    for (const i of alignedIdx) {
      const step = entries[i]!.step;
      if (step.kind !== "list-item" || !step.align) continue;
      const width = labelCache.get(entries[i]!.hash);
      if (width == null) continue;
      const g = step.align.group;
      groupMax.set(g, Math.max(groupMax.get(g) ?? 0, width));
    }
    const targetWidths = new Map<number, number>();
    for (const i of alignedIdx) {
      const step = entries[i]!.step;
      if (step.kind !== "list-item" || !step.align) continue;
      const width = labelCache.get(entries[i]!.hash);
      if (width == null) continue;
      const target = (groupMax.get(step.align.group) ?? width) - width;
      // Round to 0.1px so float noise never masquerades as a width change.
      targetWidths.set(i, Math.max(0, Math.round(target * 10) / 10));
    }

    const oldItems = stateRef.current?.items ?? [];
    const prev: BuiltStepState[] = oldItems.map((it) => ({
      hash: it.hash,
      ...(it.container !== undefined ? { container: it.container } : {}),
      ...(it.alignWidth !== undefined ? { alignWidth: it.alignWidth } : {}),
      ...(it.boxWidth !== undefined ? { boxWidth: it.boxWidth } : {}),
      ...(it.illustration !== undefined ? { illustration: it.illustration } : {}),
    }));
    const forcedRebuild = alignCascade(prev, targetWidths);
    // I1 × §7 — a figure whose sidecar entry moved, or whose file has just
    // arrived (or gone), must be BUILT again: its box comes from the
    // declared aspect and its paint from the resolved URL, and board.md
    // carries neither. Same class as the two cascades below.
    for (const i of illustrationCascade(prev, entries, illustrationIdentity)) {
      forcedRebuild.add(i);
    }
    // §7.2 × §7 — a step whose column changed under it must be BUILT again,
    // not merely re-measured: its ink is the line boxes its run occupied,
    // and those lines are a property of the width it was built at. The
    // content hash cannot see this (an `@at` inserted upstream re-columns a
    // suffix without touching one byte of it).
    for (const i of boxWidthCascade(prev, entries, buildWidths)) {
      forcedRebuild.add(i);
    }
    const plan = planReconcile(prev, entries, forcedRebuild);
    const rebuildSet = new Set(plan.rebuild);

    // Container frames being rebuilt drop their stale home first — layers
    // of the cascade re-run against the fresh node in document order.
    for (const i of plan.rebuild) {
      const step = entries[i]?.step;
      if (step && isContainerFrame(step)) {
        containersRef.current.delete(containerKeyOf(step)!);
      }
    }

    const newItems: BuiltItem[] = [];
    const byRef = new Map<string, BuiltItem>();
    itemByRefRef.current = byRef;
    // Insertion cursor: null = "next node belongs at the board's head"
    // (the measure host is the stage's sibling now, so the board holds
    // step nodes and nothing else).
    let cursor: Element | null = null;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      let item: BuiltItem;
      const old = oldItems[i];
      if (!rebuildSet.has(i) && old) {
        item = old;
      } else {
        // A stale node may live in any panel or run wrapper (C3).
        if (old) old.node.parentNode?.removeChild(old.node);
        pendingRowsRef.current = null;
        currentAlign = targetWidths.get(i);
        currentBuildKey = refKey(entry.ref);
        // §7.2's build order, at the one point it can actually be honoured:
        // the node is built INSIDE a host of exactly the width its box will
        // have, so every line box the factory reads is a line box the
        // reader will see.
        measureAt(currentBuildKey);
        item = buildItem(doc, entry, ctx);
        item.boxWidth = buildWidths.get(currentBuildKey);
        if (entry.step.kind === "image") item.illustration = illustrationIdentity;
        currentAlign = undefined;
        if (item.step.kind === "backref" && pendingRowsRef.current) {
          item.anchorRows = pendingRowsRef.current;
          item.anchorPanel = pendingPanelRef.current;
        }
        if (targetWidths.has(i)) item.alignWidth = targetWidths.get(i)!;
        // R4 — an in-place replacement of previously shown content gets
        // one soft origin:"external" pulse (align-only rebuilds keep the
        // same hash and stay silent).
        if (old && old.hash !== entry.hash && item.node instanceof HTMLElement) {
          item.node.classList.add("bansho-pulse");
          item.node.addEventListener(
            "animationend",
            () => item.node.classList.remove("bansho-pulse"),
            { once: true },
          );
        }
      }
      const at: ChildNode | null = cursor
        ? cursor.nextSibling
        : board.firstChild;
      if (item.node !== at) board.insertBefore(item.node, at);
      // The click → step handle (T6). Stamped on every mount, including
      // reused prefix nodes whose POSITION changed under an edit — the
      // attribute is an address, and an address that drifts would report
      // the wrong step.
      if (item.node instanceof HTMLElement) {
        item.node.dataset.banshoRef = refKey(entry.ref);
      }
      cursor = item.node;
      if (isContainerFrame(entry.step)) {
        containersRef.current.set(containerKeyOf(entry.step)!, {
          frame: entry.step,
          node: item.node,
        });
      }
      byRef.set(refKey(entry.ref), item);
      newItems.push(item);
    }
    // Orphaned tail (document shrank) — G5 is about the DIALECT having no
    // implicit loss; when the file itself dropped blocks the board follows.
    for (let i = entries.length; i < oldItems.length; i++) {
      oldItems[i]!.node.parentNode?.removeChild(oldItems[i]!.node);
    }
    /** key → flat index, for the passes below that start from a step key. */
    const indexOfKey = new Map<string, number>();
    entries.forEach((entry, i) => indexOfKey.set(refKey(entry.ref), i));

    // ── The canvas: panels, runs, erases, and every step's BOX ───────────
    // The canvas pivot (V1, design §7.2) kills the pristine/staged split:
    // the long strip is a board too, so EVERY board projection folds and
    // every space-occupying step is positioned by the fold rather than by
    // CSS flow. The notes projection is the one that stays in flow — on
    // purpose, as the migration's control group (§8/§12.2 item 1).
    if (staged && face) {
      const { padTop, padLeft, padBottom, faceW: faceWidth } = face;
      const budget = face.faceH;

      // Fold input: THE shared builder (S1) — the same implementation the
      // snapshot basis reads, so the glance can never answer a different
      // board than the one performing. It is handed the SAME `face` the
      // build loop measured against — read once, above, before the first
      // node was built (§7.2).
      const foldOnce = (
        widthOverride?: ReadonlyMap<string, number>,
      ): {
        inputs: LayoutStepInput[];
        layout: BoardLayout;
      } => {
        const inputs = computeFoldInputs(entries, lecture, face, widthOverride);
        return {
          inputs,
          layout: foldBoardLayout(
            inputs,
            panelCount,
            budget,
            undefined,
            faceWidth,
            face.columns,
          ),
        };
      };
      // §7.2's build order, closed as a loop rather than as a hope: the
      // measure pass puts each step in the frame `scanRegionWords` says it
      // is in, and then the FOLD is asked whether it agreed. It can differ
      // in exactly one case — an anchored `@at` whose anchor folded to
      // nothing, which only the fold knows — so a single corrective pass
      // repairs it. Bounded at one, and loud if the second answer still
      // disagrees: a height measured at the wrong width is precisely the
      // silent wrongness §9 asks to be guarded against.
      let { inputs: foldInputs, layout } = foldOnce();
      const mismatched = (l: BoardLayout): string[] => {
        const bad: string[] = [];
        for (const [k, box] of l.boxes) {
          const item = itemByRefRef.current.get(k);
          if (!item || item.measuredWidth === undefined) continue;
          if (item.measuredWidth !== box.w) bad.push(k);
        }
        return bad;
      };
      const stale = mismatched(layout);
      if (stale.length > 0) {
        const forcedWidth = new Map<string, number>();
        for (const k of stale) {
          const item = itemByRefRef.current.get(k);
          if (!item) continue;
          item.foldHeight = undefined;
          item.measuredWidth = undefined;
          forcedWidth.set(k, layout.boxes.get(k)!.w);
        }
        // A width the pre-scan got wrong is baked into the node's INK, not
        // only into its cached height: re-measuring alone would leave an
        // underline drawn under line boxes that no longer exist. So the
        // steps whose factories measure against the host are BUILT again,
        // at the fold's own width, before the re-measure. `boxWidth` still
        // records the SCAN's answer (see `boxWidthCascade`) — recording the
        // correction would make every later build disagree with its own
        // scan and rebuild for ever.
        for (const [k, w] of forcedWidth) {
          const i = indexOfKey.get(k);
          const old = byRef.get(k);
          if (i === undefined || !old) continue;
          if (!MEASURED_IN_HOST.has(entries[i]!.step.kind)) continue;
          pendingRowsRef.current = null;
          currentAlign = targetWidths.get(i);
          currentBuildKey = k;
          setMeasureWidth(measureHost, w);
          const rebuilt = buildItem(doc, entries[i]!, ctx);
          currentAlign = undefined;
          rebuilt.boxWidth = buildWidths.get(k);
          if (entries[i]!.step.kind === "image") {
            rebuilt.illustration = illustrationIdentity;
          }
          if (targetWidths.has(i)) rebuilt.alignWidth = targetWidths.get(i)!;
          if (rebuilt.node instanceof HTMLElement) {
            rebuilt.node.dataset.banshoRef = k;
          }
          old.node.parentNode?.replaceChild(rebuilt.node, old.node);
          byRef.set(k, rebuilt);
          newItems[i] = rebuilt;
        }
        ({ inputs: foldInputs, layout } = foldOnce(forcedWidth));
        const still = mismatched(layout);
        if (still.length > 0) {
          console.warn(
            `[bansho] ${still.length} step(s) were measured at a width the fold did not place them at (${still.join(", ")}) — their heights answer the wrong question`,
          );
        }
      }
      layoutRef.current = layout;
      foldInputsRef.current = foldInputs;
      // Back reference → the step it draws over, read off the SAME fold
      // input the assignment used (never re-derived from the step values,
      // §4.1). The mount below hangs each overlay inside that step's box.
      const anchorHomeOf = new Map<string, string>();
      for (const input of foldInputs) {
        if (input.kind === "content" && input.anchorKey !== undefined) {
          anchorHomeOf.set(input.key, input.anchorKey);
        }
      }
      // Turn destinations, read from the fold's own record (never
      // re-derived — §4.1): the walk's camera anchor and showStep's rect.
      turnPanelByKeyRef.current = new Map(
        layout.turns.map((t) => [t.key, t.panel]),
      );

      // Runs → containers. Closed runs get fresh absolute wrappers (the
      // eraser's exclusive G8-L surface); their padding mirrors the
      // panel's, so a step keeps the exact coordinates it had in flow.
      const staleWrappers: HTMLElement[] = [];
      for (const p of panelElsRef.current) {
        if (!p) continue;
        for (const w of Array.from(
          p.querySelectorAll<HTMLElement>(":scope > .bansho-erased-run"),
        )) {
          staleWrappers.push(w);
        }
      }
      runElsRef.current = new Map();
      const closedRuns = new Set<string>();
      for (const op of layout.eraseOps) {
        if (op.run !== "") closedRuns.add(op.run);
      }
      const containerOfRun = new Map<string, HTMLElement>();
      for (const [runId, run] of layout.runs) {
        const panelEl = panelElsRef.current[run.panel];
        if (!panelEl) continue;
        if (closedRuns.has(runId)) {
          const wrapper = doc.createElement("div");
          wrapper.className = "bansho-erased-run";
          // The run's identity, on the run. The wall map reads it back
          // (`wall-outline.ts`) to know which sweep takes these marks off
          // the map, so a scrubbed-back board shows the writing that
          // stood there THEN rather than the union of every run.
          wrapper.dataset.banshoRun = runId;
          // No padding of its own any more (canvas pivot V1): `inset: 0`
          // already makes the wrapper's padding box coincide with the
          // panel's, and every step inside it is an absolutely positioned
          // box carrying its own face coordinates. Mirroring the panel's
          // padding here would offset those coordinates a second time.
          panelEl.appendChild(wrapper);
          runElsRef.current.set(runId, wrapper);
          containerOfRun.set(runId, wrapper);
        } else {
          containerOfRun.set(runId, panelEl);
        }
      }

      // Distribute nodes: document order per container; only misplaced
      // nodes move (zero-replay economy — reveal state rides the nodes).
      // A back reference is the one step that does NOT go to its run's
      // container: it hangs inside its TARGET's box, so a box that moves
      // (or, later, tilts) carries the ink drawn over it — 锚随目标住,
      // the same ownership that makes an erase take the ink with the
      // writing. Its coordinates stay the panel's (that is the frame
      // `measureBackRef` reads the target's glyph rows in), so the mount
      // compensates the box origin instead of re-quoting every `d`.
      const cursorIn = new Map<Element, Element>();
      const boxHost = (k: string): HTMLElement | null => {
        const anchorKey = anchorHomeOf.get(k);
        if (anchorKey === undefined) return null;
        const host = byRef.get(anchorKey)?.node;
        return host instanceof HTMLElement && layout.boxes.has(anchorKey)
          ? host
          : null;
      };
      for (const entry of entries) {
        const k = refKey(entry.ref);
        const item = byRef.get(k);
        if (!item) continue;
        const a = layout.assignments.get(k);
        const host = a ? boxHost(k) : null;
        const container = host
          ? host
          : a
            ? (containerOfRun.get(a.run) ?? panelElsRef.current[a.panel] ?? board)
            : board; // neutral steps (hidden spans) stay on panel 0
        if (host) {
          if (item.node.parentNode !== host) host.appendChild(item.node);
          continue; // an overlay is not part of any container's cursor
        }
        const prev = cursorIn.get(container);
        const at: ChildNode | null = prev
          ? prev.nextSibling
          : container.firstChild;
        if (item.node !== at) container.insertBefore(item.node, at);
        cursorIn.set(container, item.node);
      }
      for (const w of staleWrappers) w.remove();

      // ── Boxes land ───────────────────────────────────────────────────
      // Absolute positioning resolves against the containing block's
      // PADDING box (the panel's, and — `inset: 0`, no padding — the
      // erased-run wrapper's alike), so a face coordinate converts by one
      // padding. `top` places the MARGIN edge, hence the `− marginTop`:
      // the margins stay on the node, because they are what the §7.5 gap
      // is computed from and zeroing them would make the instrument read
      // zeros. `left` + `right` rather than `width` reproduces the flow
      // box exactly — including `.bansho-math-block`'s `margin: 0 auto`
      // centering of a `fit-content` formula, which an explicit width
      // would silently un-center.
      const cbW = board.clientWidth;
      for (const [k, box] of layout.boxes) {
        const node = byRef.get(k)?.node;
        if (!(node instanceof HTMLElement)) continue;
        const marginTop = byRef.get(k)?.boxMetrics?.marginTop ?? 0;
        node.style.position = "absolute";
        node.style.left = `${padLeft + box.x}px`;
        node.style.right = `${cbW - padLeft - box.x - box.w}px`;
        node.style.top = `${padTop + box.y - marginTop}px`;
        node.dataset.banshoBox = "1";
      }
      // A step the fold stopped placing (an orphan — its home was erased
      // before its ink arrived) must not keep a stale box: it would stand
      // at coordinates nothing computes any more. Give it back to flow,
      // where a zero-revealable orphan is invisible anyway.
      for (const item of newItems) {
        const node = item.node;
        if (!(node instanceof HTMLElement)) continue;
        if (node.dataset.banshoBox !== "1") continue;
        if (layout.boxes.has(refKey(item.ref))) continue;
        delete node.dataset.banshoBox;
        node.style.position = "";
        node.style.left = "";
        node.style.right = "";
        node.style.top = "";
      }
      // The back-reference overlays, re-based onto their hosts: still the
      // panel's full bleed, expressed from inside the box. The bleed is
      // quoted from the FOLD's face extent, not from `clientHeight` —
      // `client*` is an integer and the panel's padding box is fractional,
      // so reading it back would resize the overlay by up to half a pixel
      // the first time a board is re-based.
      const faceH =
        panelCount === 1
          ? padTop + (layout.faceExtent[0] ?? 0) + padBottom
          : board.clientHeight;
      for (const [k, anchorKey] of anchorHomeOf) {
        const node = byRef.get(k)?.node;
        const box = layout.boxes.get(anchorKey);
        if (!(node instanceof HTMLElement) || !box) continue;
        if (node.parentElement !== byRef.get(anchorKey)?.node) continue;
        const marginTop = byRef.get(anchorKey)?.boxMetrics?.marginTop ?? 0;
        node.style.left = `${-(padLeft + box.x)}px`;
        node.style.top = `${-(padTop + box.y - marginTop)}px`;
        node.style.right = "";
        node.style.width = `${cbW}px`;
        node.style.height = `${faceH}px`;
      }

      // 瑕疵 (W3): the boxes are placed, so the paint-time layer can lean
      // them. Deliberately AFTER every geometry write above and before
      // nothing that measures — see `stampFlaw`.
      stampFlaw();

      // ── §8 rev 2.1: the strip's height, written back ─────────────────
      // Absolutely positioned children hold nothing open, so the fold's
      // own face extent becomes the element's height — the number the
      // camera's fit and follow arithmetic read off `offsetHeight`. Closed
      // runs are inside it (a scrub back must not meet a short board), and
      // `min-height: 100%` still fills a short board with board.
      // Bounded panels keep `panelHeightFor` and are left alone.
      if (panelCount === 1) {
        const extent = layout.faceExtent[0] ?? 0;
        board.style.minHeight = "";
        board.style.height = `${padTop + extent + padBottom}px`;
      } else {
        board.style.height = "";
        board.style.minHeight = "";
      }

      // Fresh backrefs re-anchor AFTER distribution: their ink geometry
      // was measured in the provisional flow, and the target now stands
      // at its final panel position. Reused prefix backrefs keep their
      // rows — prefix stability pins both the assignment and the run
      // (zero replay, zero re-measurement).
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]!;
        if (entry.step.kind !== "backref" || !rebuildSet.has(i)) continue;
        const k = refKey(entry.ref);
        const old = byRef.get(k);
        if (!old) continue;
        pendingRowsRef.current = null;
        currentBuildKey = k;
        // A back reference measures its TARGET's mounted glyph rows, never
        // the host — but the host is shared state, so it is restated here
        // rather than left holding the last box's width.
        measureAt(k);
        const rebuilt = buildItem(doc, entry, ctx);
        if (pendingRowsRef.current) {
          rebuilt.anchorRows = pendingRowsRef.current;
          rebuilt.anchorPanel = pendingPanelRef.current;
        }
        if (rebuilt.node instanceof HTMLElement) {
          rebuilt.node.dataset.banshoRef = k;
        }
        old.node.parentNode?.replaceChild(rebuilt.node, old.node);
        byRef.set(k, rebuilt);
        newItems[i] = rebuilt;
      }

      // Erase wiring: every erase is an `@erase` STEP with its own
      // revealable, and it resolves key → run → wrapper through the
      // factory's late-bound handle (`eraseTarget`). There is no second
      // path: the branch that COMPOSED an eraser onto the content step a
      // synthesized erase interrupted died with auto-erase on 2026-08-11
      // (design §2.3), and with it the whole `composedRef` seam.
      eraseRunByKeyRef.current = new Map();
      erasePanelByKeyRef.current = new Map();
      for (const op of layout.eraseOps) {
        eraseRunByKeyRef.current.set(op.key, op.run);
        erasePanelByKeyRef.current.set(op.key, op.panel);
      }
    } else {
      // Unstaged (pristine / notes): drop every staged residue, including
      // wrappers left behind when the last @erase was removed from the
      // document.
      layoutRef.current = null;
      foldInputsRef.current = [];
      runElsRef.current = new Map();
      eraseRunByKeyRef.current = new Map();
      erasePanelByKeyRef.current = new Map();
      turnPanelByKeyRef.current = new Map();
      // The notes projection is CSS flow, start to finish (§8) — no fold,
      // no boxes, and therefore no written-back height either.
      board.style.minHeight = "";
      board.style.height = "";
      if (panelsEl) {
        for (const w of Array.from(
          panelsEl.querySelectorAll<HTMLElement>(".bansho-erased-run"),
        )) {
          w.remove();
        }
      }
    }

    // Nothing measures again until the next build sizes the host itself:
    // leave it on the stylesheet's own inset rather than on the last box's
    // width, so a probe added later cannot silently inherit a column.
    setMeasureWidth(measureHost, undefined);

    stateRef.current = { items: newItems };
    // The snapshot basis of THIS build (S1) — read lazily by the glance.
    basisRef.current = { entries, lecture };
    applySelectionMark();

    // Width check (§9 `boardOverflow`) — read here, BEFORE the timeline's
    // seek writes styles back, so the whole pass is one forced layout
    // rather than a write/read ping-pong. Reveal state does not affect it:
    // clipping and opacity are not layout.
    const overflowing = overflowingRefs(
      newItems.map((item) => ({
        ref: item.ref,
        scrollWidth: item.node instanceof HTMLElement ? item.node.scrollWidth : 0,
        clientWidth: item.node instanceof HTMLElement ? item.node.clientWidth : 0,
      })),
    );

    // ── Stage pass (C2): camera poses + Van Wijk durations ───────────────
    // Document order + layout rects only (no times — the no-circularity
    // argument pinned in the C2 spec): poses first, durations from poses,
    // windows from durations, and the fold's schedule zips the two after
    // the compile below. Skipped entirely on a camera-free board — and in
    // the notes projection, where camera steps plan no units at all.
    // A `@turn` counts (2026-08-11): the walk to the next board is a
    // camera move now, so a lecture written with nothing but turns — which
    // is every lecture a cold agent writes — must build the stage schedule
    // too. Gating this on `@focus` / `@overview` alone is precisely why
    // V1.5's depth was invisible in practice: the fold it reads was never
    // constructed on the boards that needed it most.
    const hasCamera =
      view === "board" &&
      entries.some((e) => e.step.kind === "camera" || e.step.kind === "turn");
    hasCameraRef.current = hasCamera;
    let stageView: StageView | null = null;
    let cameraDurations: Map<string, number> | null = null;
    let cameraMoves: Map<string, { from: CameraPose; to: CameraPose } | null> | null =
      null;
    if (hasCamera && viewportEl) {
      const geometry: StageView = {
        viewW: viewportEl.clientWidth,
        viewH: viewportEl.clientHeight,
        // Multi-board: the FIXED panel geometry plus count/gap widen the
        // stage (focus clamps, overview fits, follow proxies snap to the
        // writing board's origin). Single panel: the strip's own extent —
        // C2 verbatim.
        ...(stagedMultiRef.current
          ? {
              panelW: PANEL_WIDTH,
              panelH: PANEL_HEIGHT,
              panelCount,
              panelGap: PANEL_GAP,
            }
          : {
              panelW: board.offsetWidth,
              panelH: board.offsetHeight,
            }),
      };
      if (geometry.viewW > 0 && geometry.viewH > 0) {
        stageView = geometry;
        const orphans = new Set(layoutRef.current?.orphaned ?? []);
        const inputs: StageStepInput[] = [];
        const inputKeys: string[] = [];
        for (const entry of entries) {
          const step = entry.step;
          if (step.kind === "camera") {
            inputs.push({
              kind: "camera",
              op: step.op,
              anchor:
                step.op === "focus" && step.target
                  ? (measureStageAnchor(step.target) ?? null)
                  : null,
            });
            inputKeys.push(refKey(entry.ref));
          } else {
            if (step.kind === "at") {
              // A placement holds a schedule window with zero revealables
              // and moves the camera by itself not at all (stage.ts's
              // `at` input) — it maps here so the window still exists and
              // the entry stays neutral, exactly like a turn's.
              inputs.push({ kind: "at" });
              inputKeys.push(refKey(entry.ref));
              continue;
            }
            if (step.kind === "turn") {
              // 走位不是写 (S1, P1-3 family): never a decay boundary,
              // never content — with the register silent the camera walks
              // to the DESTINATION board's head (the fold's own verdict,
              // turnPanelByKeyRef). A turn holds a schedule window even
              // with zero revealables, so it maps before the check below.
              inputs.push({
                kind: "turn",
                rect: turnBoardHead(refKey(entry.ref)) ?? null,
              });
              inputKeys.push(refKey(entry.ref));
              continue;
            }
            // Only performed steps write: zero-revealable steps (wait,
            // bad, image/html) neither decay the register nor add content.
            // Orphans (P1-1 — ink aimed at erased writing) join that
            // gap-transparent class: nothing of theirs lands on the board,
            // so they must not decay the register or feed the union a
            // full-panel echo rect.
            const item = byRef.get(refKey(entry.ref));
            if (!item || item.revealables.length === 0) continue;
            if (orphans.has(refKey(entry.ref))) continue;
            if (step.kind === "erase") {
              // 擦不是写 (P1-3): the sweep performs at the BOARD it wipes
              // — its own span is a hidden zero-rect — and never decays a
              // latched pose. (Auto-erase rides its triggering WRITE
              // step's entry and stays a write.)
              inputs.push({
                kind: "erase",
                rect: erasedBoardHead(refKey(entry.ref)) ?? null,
              });
              inputKeys.push(refKey(entry.ref));
              continue;
            }
            // `penX` is the fold's verdict, not a measurement, so it
            // survives what the stage anchor cannot: a hidden chart LAYER
            // draws onto a frame standing on another board and reports an
            // all-zero client box. The host walks the camera there anyway
            // (`followAt`'s hand-back reads the very same assignment), so
            // the simulation is told about it and the walk becomes a move
            // instead of the cut it used to be.
            const penPanel = stagedMultiRef.current
              ? layoutRef.current?.assignments.get(refKey(entry.ref))?.panel
              : undefined;
            const penSlot =
              penPanel !== undefined
                ? wallSlot(penPanel, panelCount, wallGeom())
                : undefined;
            inputs.push({
              kind: "write",
              rect: measureStageAnchor(entry.ref) ?? null,
              ...(penSlot ? { penX: penSlot.x, penY: penSlot.y } : {}),
            });
            // `penY` rides along unconditionally: `resolveCameraOps`
            // builds the same `FollowBoard` from it and `view.panelH` that
            // the host builds from `wallGeom()`, and the "does a whole
            // board fit" question is asked inside the one arithmetic
            // (`boardBandY`) rather than by either caller — so the two
            // cannot disagree and the host does not second-guess it here.
            inputKeys.push(refKey(entry.ref));
          }
        }
        cameraDurations = new Map();
        cameraMoves = new Map();
        for (const op of resolveCameraOps(inputs, geometry, DEFAULT_DURATIONS)) {
          const key = inputKeys[op.index]!;
          cameraDurations.set(key, op.duration);
          cameraMoves.set(key, op.move);
        }
      }
    }

    // ── Canonical compile + synchronous visual restore ───────────────────
    // Narration rides the ONE G3 channel: a fresh per-compile hook records
    // what it applies, and the clip windows are read back from that record
    // (never re-derived from timeline internals). No manifest → no hook →
    // the context is byte-identical to a silent board's. Camera steps ride
    // the SAME channel (composed, camera-first): their measured Van Wijk
    // seconds replace the plan's placeholder; a narration clip never paces
    // a camera move.
    const narrationHook = createNarrationHook(lecture.source, narration);
    const durationOverride =
      cameraDurations || narrationHook
        ? (step: Step, ref: StepRef, natural: number): number | undefined => {
            if (step.kind === "camera") {
              return cameraDurations?.get(refKey(ref));
            }
            if (step.kind === "turn") {
              // The walk gets whichever is longer: the topic-change breath
              // it always had, or the time the journey actually takes.
              // MAX, not replace — a turn to the board next door resolves
              // to about the breath anyway, while a walk clear across the
              // wall must not be crammed into it, and a turn that walks
              // nowhere must not lose its breath.
              const walk = cameraDurations?.get(refKey(ref));
              return walk === undefined ? undefined : Math.max(natural, walk);
            }
            return narrationHook?.durationOverride(step, ref, natural);
          }
        : undefined;
    // The lead-in's own override (2026-08-12) — the walk to another board.
    // A write's window is the writing and an erase's is the sweep, so their
    // journey cannot ride it (G1): it rides the pause BEFORE the step, and
    // that pause has to be at least as long as the journey. MAX for the
    // same reason `@turn` uses MAX — a step that stays on its own board
    // resolves no walk and keeps its natural breath, byte for byte.
    const leadInOverride = cameraDurations
      ? (step: Step, ref: StepRef, natural: number): number | undefined => {
          if (step.kind === "camera" || step.kind === "turn") return undefined;
          const walk = cameraDurations.get(refKey(ref));
          return walk === undefined ? undefined : Math.max(natural, walk);
        }
      : undefined;
    // C3 — the stage's scheduling input: the fold's auto-erase verdicts
    // on a staged board; the notes projection neutralizes camera, `@at`
    // and erase steps (zero units, refs untouched). The measurements seam
    // hands the BUILT unit arrays straight through — since 2026-08-11 the
    // plan prepends nothing to anything, so plan units and built units
    // line up 1:1 by construction rather than by composition.
    const stagePlan = view === "notes" ? { omitStageSteps: true } : undefined;
    const timeline = buildTimeline(
      lecture,
      {
        durations: DEFAULT_DURATIONS,
        ...(stagePlan ? { stage: stagePlan } : {}),
        ...(durationOverride ? { durationOverride } : {}),
        ...(leadInOverride ? { leadInOverride } : {}),
      },
      { unitsFor: (ref) => byRef.get(refKey(ref))?.revealables },
    );
    timeline.seek(getPlayheadT());

    // ── Zip the resolved moves with their canonical windows (the fold's
    //    input — poses and times baked in, stageStateAt stays pure) ───────
    if (cameraMoves && stageView) {
      const moves = cameraMoves;
      const stageEntries: StageEntry[] = timeline.schedule.map((s) => {
        const key = refKey(s.step);
        const kind = byRef.get(key)?.step.kind;
        // The walk to another board belongs to the step, and a step's
        // arrival is its FIRST unit — a multi-unit write would otherwise
        // stamp the same journey in front of every line it draws. (Camera
        // and turn steps never exposed this: they hold exactly one unit.)
        const lead =
          s.unit === 0 ? (cameraDurations?.get(key) ?? 0) : 0;
        return kind === "camera"
          ? {
              kind: "camera",
              start: s.start,
              end: s.end,
              move: moves.get(key) ?? null,
            }
          : kind === "erase"
            ? // 擦不是写 (P1-3): not a decay boundary — a held pose rides
              // straight through the sweep. Since 2026-08-12 it can carry
              // the walk to the board it is about to wipe, in the pause
              // before the sweep (never during it — G1).
              {
                kind: "erase",
                start: s.start,
                end: s.end,
                move: lead > 0 ? (moves.get(key) ?? null) : null,
                lead,
              }
            : kind === "turn"
              ? // 走位也不是写 (S1): same neutrality, same family — and
                // since 2026-08-11 the walk carries its own move, so the
                // switch between boards is a glide with depth instead of
                // an instant cut. Neutrality is untouched: the move never
                // latches (stage.ts) and `holdUntil` still breaks only on
                // a write.
                {
                  kind: "turn",
                  start: s.start,
                  end: s.end,
                  move: moves.get(key) ?? null,
                }
              : kind === "at"
                ? // …and neither is a placement (V2): same family again.
                  { kind: "at", start: s.start, end: s.end }
                : // A write carries the pen's own walk when the pen has
                  // moved to another board — in the widened pause before
                  // it, so the writing itself is never watched from a
                  // moving camera.
                  {
                    kind: "write",
                    start: s.start,
                    end: s.end,
                    move: lead > 0 ? (moves.get(key) ?? null) : null,
                    lead,
                  };
      });
      stageScheduleRef.current = buildStageSchedule(
        stageEntries,
        stageView,
        DEFAULT_DURATIONS.cameraRho,
      );
    } else {
      stageScheduleRef.current = null;
    }
    // Fold-detected too-tall steps join the §9 boardOverflow family the
    // horizontal scan already feeds (soft-passed on the board, loudly
    // reported to the agent).
    const tooTall: StepRef[] = [];
    for (const key of layoutRef.current?.overflowing ?? []) {
      const ref = parseStepKey(key);
      if (ref) tooTall.push(ref);
    }
    const inkAfterErase: StepRef[] = [];
    for (const key of layoutRef.current?.orphaned ?? []) {
      const ref = parseStepKey(key);
      if (ref) inkAfterErase.push(ref);
    }
    // §5.3 — asked once, answered on three surfaces: the board wears the
    // marks (below), `check-board` inventories them and the `boardCollision`
    // push names the fresh pairs. Computing it here rather than inline in
    // the literal is what lets the human channel share the agent's answer.
    const collisions = layoutRef.current
      ? detectCollisions(standingBoxes(layoutRef.current, foldInputsRef.current))
      : [];
    paintCollisions(collisions);
    // W8 — the same discipline for the burst: the agent's finding and the
    // reader's cut line are read off ONE list, so the number and the board
    // can never disagree about which board lost a sentence.
    const bursts = layoutRef.current?.bursts ?? [];
    paintBursts(bursts);

    const compiled: CompiledBoard = {
      timeline,
      entrySpan(index) {
        const entry = timeline.schedule[index];
        if (!entry) return null;
        const k = refKey(entry.step);
        const item = byRef.get(k);
        if (!item) return null;
        return scheduleEntrySpan(entry, item.revealables, item.step.srcSpan);
      },
      issues: lecture.errors,
      ...readMathErrors(panelsEl ?? board),
      overflowing: [...overflowing, ...tooTall],
      narration: narrationHook
        ? clipWindows(timeline.schedule, narrationHook.applied)
        : [],
      inkAfterErase,
      collisions,
      bursts,
      turnsOnFullWall: (layoutRef.current?.turns ?? [])
        .filter((t) => t.fullWall)
        .map((t) => parseStepKey(t.key))
        .filter((ref): ref is StepRef => ref !== null),
      // W2 — only turns that actually WALKED: an inert turn left nothing
      // behind that could be under-filled.
      turnsUnderfilled: (layoutRef.current?.turns ?? [])
        .filter((t) => !t.inert && t.fill < TURN_UNDERFILL_THRESHOLD)
        .map((t) => ({ ref: parseStepKey(t.key), fill: t.fill }))
        .filter((t): t is { ref: StepRef; fill: number } => t.ref !== null),
    };
    compiledRef.current = compiled;
    onCompiled(compiled);

    // The browser used to clamp scrollTop into the post-rebuild range on
    // its own; a transform clamps nothing, so the camera re-clamps itself
    // against the fresh panel height here (a reflow that shortened the
    // board must not leave the viewport staring past its end — G5's
    // "content never disappears" includes "the view never goes blank").
    // Gated (C2): while the register holds a director pose the recomputed
    // pose is re-applied VERBATIM — an overview legitimately sits below
    // the user-gesture zoom floor, and clamping it here would yank the
    // camera on every agent append mid-hold.
    const viewport = viewportRef.current;
    if (viewport) {
      const verdict = gateCamera(
        stageScheduleRef.current,
        getPlayheadT(),
        latchRef.current,
      );
      if (verdict.kind === "director") {
        applyCamera(verdict.camera);
      } else {
        // W7 — the board no longer resizes with the window, so a resize is
        // the CAMERA's business: while the reader has not taken it, re-fit
        // to the rest zoom (one board wide). Detached, the pose is theirs
        // and only the clamp touches it.
        const base =
          latchRef.current === "following"
            ? { ...cameraRef.current, z: restZoom(viewport.clientWidth, PANEL_WIDTH) }
            : cameraRef.current;
        applyCamera(clampCamera(base, liveViewbox(viewport)));
      }
    }

    // THE WALL MAP'S DRAWING, read once here — after every step, every
    // overlay and every erased-run wrapper is mounted, and at COMPILE rate
    // exactly like the fill bars it replaces. One batched funnel call per
    // board; nothing about the map is ever recomputed on a frame.
    //
    // Each group also gets its WINDOW in schedule indices, resolved here
    // because this is the layer that holds the timeline: a step's marks
    // appear at its first unit, and leave when the sweep of the run they
    // stand in begins. The map then needs one integer comparison per
    // playhead step — see `wall-outline.ts`'s header for why measuring
    // once is still sound (reveal state is opacity and clip paths, and
    // neither moves a rect).
    if (panelCount > 1) {
      const depth = depthRef.current;
      const firstUnitAt = new Map<string, number>();
      for (let i = 0; i < timeline.schedule.length; i++) {
        const key = refKey(timeline.schedule[i]!.step);
        if (!firstUnitAt.has(key)) firstUnitAt.set(key, i);
      }
      const wipedAt = new Map<string, number>();
      for (const [eraseKey, runId] of eraseRunByKeyRef.current) {
        const at = firstUnitAt.get(eraseKey);
        if (at !== undefined) wipedAt.set(runId, at);
      }
      const windowOf = (key: string, run: string | null) => ({
        from: firstUnitAt.get(key) ?? -1,
        until: (run !== null ? wipedAt.get(run) : undefined) ?? Infinity,
      });
      const next = panelElsRef.current
        .slice(0, panelCount)
        .map((el) =>
          el
            ? readPanelOutline(el, depth, surfaceRef.current, windowOf)
            : EMPTY_PANEL_OUTLINE,
        );
      setOutlines((prev) => (sameOutlines(prev, next) ? prev : next));
    } else if (outlinesRef.current.length > 0) {
      setOutlines(EMPTY_OUTLINES);
    }
  }, [
    lecture,
    view,
    panelCount,
    narration,
    illustrations,
    illustrationIdentity,
    fontsReady,
    env,
    rebuildTick,
    getPlayheadT,
    onCompiled,
    measureBackRef,
    measureStageAnchor,
    applySelectionMark,
    applyCamera,
    liveViewbox,
    computeFoldInputs,
    turnBoardHead,
    paintCollisions,
    paintBursts,
    stampFlaw,
  ]);

  // ── Measured geometry is invalid: drop every cache and rebuild ───────────
  // Every ink overlay, every back-reference anchor and every aligned column
  // is a MEASUREMENT of the text as it is laid out right now. Anything that
  // reflows that text (the board's width, the face it is written in)
  // invalidates all of them at once, and reconcile alone cannot see it —
  // the bytes did not change, so every hash still matches and the plan is a
  // no-op. So the caches are cleared and the rebuild is forced by tick.
  const invalidateMeasurements = useCallback((): void => {
    // DOM untouched here — the rebuild effect wipes and rebuilds in
    // one task, so no blank board is ever painted (G5). The camera needs
    // no snapshot/restore: it is a transform, not a scroll offset, so the
    // wipe cannot clamp it (the rebuild re-clamps against fresh heights).
    stateRef.current = null;
    containersRef.current.clear();
    labelWidthRef.current.clear();
    itemByRefRef.current.clear();
    // C3: fold verdicts and erase wiring are measurements too (heights
    // feed the assignment fold; wrappers are reminted by the rebuild).
    layoutRef.current = null;
    foldInputsRef.current = [];
    runElsRef.current = new Map();
    eraseRunByKeyRef.current = new Map();
    erasePanelByKeyRef.current = new Map();
    turnPanelByKeyRef.current = new Map();
    // The snapshot basis is a measurement product too (S1) — a glance
    // between the invalidation and the rebuild must wait, not answer
    // with heights the reflow just voided.
    basisRef.current = null;
    setRebuildTick((n) => n + 1);
  }, []);

  // ── Width changes invalidate every measured geometry: full rebuild ───────
  // The VIEWPORT is observed, not the panel: the panel's width is derived
  // from it (C1's single panel fills the viewport), and clientWidth is a
  // layout value the camera transform never touches.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    let lastWidth = viewport.clientWidth;
    let lastHeight = viewport.clientHeight;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver(() => {
      const width = viewport.clientWidth;
      const height = viewport.clientHeight;
      // Height feeds camera POSES (and through them canonical camera
      // durations) — but only on boards that carry camera verbs, so only
      // those pay a height-resize rebuild (C2). Width feeds every wrap
      // decision on every board (C1, unchanged).
      const widthMoved = Math.abs(width - lastWidth) > 1;
      const heightMoved =
        hasCameraRef.current && Math.abs(height - lastHeight) > 1;
      if (!widthMoved && !heightMoved) return;
      lastWidth = width;
      lastHeight = height;
      if (timer) clearTimeout(timer);
      timer = setTimeout(invalidateMeasurements, 150);
    });
    ro.observe(viewport);
    return () => {
      ro.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [invalidateMeasurements]);

  // ── A theme flip is a font change, so it invalidates geometry too ────────
  // The light and dark `--hand` stacks name different faces (board-css.ts:
  // Bradley Hand vs Chalkboard SE) with different metrics, so the moment
  // the user toggles the theme every line re-flows underneath overlays that
  // were measured against the old face — circles land beside their words,
  // back references point at the wrong line. `env` is deliberately NOT
  // re-probed: §5.2 pins it for the session so a scrub stays deterministic.
  // Re-MEASURING with the same caps is the fix; re-probing would break that.
  const measuredThemeRef = useRef(theme);
  useEffect(() => {
    if (measuredThemeRef.current === theme) return;
    measuredThemeRef.current = theme;
    invalidateMeasurements();
  }, [theme, invalidateMeasurements]);

  // ── User input (C1 + the C1′ grab, W4a's infinite-canvas table) ──────────
  //   wheel / trackpad scroll   ZOOM at the cursor; DETACH + pause
  //   pinch (ctrl+wheel)        the same zoom, same door
  //   left press, no travel     NEVER a camera gesture (T6 pointing)
  //   left press + travel       GRAB: pan, DETACH, pause the performance
  //   middle press + travel     the same grab, by the other hand
  //   alt+drag                  text selection (the copy escape hatch)
  //   nothing, ever             page scrolling — the board is not a page
  //
  // The wheel used to pan y (shift+wheel x, ctrl+wheel zoom): a document's
  // gesture set on a thing that stopped being a document. The owner's
  // ruling (2026-08-12): 「既然是无限画布了，滚轮就直接作为放大，中键就作为
  // pan，这些基础操作与 xyflow 保持一致吧。无需加 ctrl 滚轮」. So the wheel is
  // the zoom, unconditionally, with d3-zoom's own deltaMode factors behind
  // it (`wheelZoomFactor`) — it is now the ONLY zoom, and a line-mode wheel
  // that moved the board by half a percent per notch would read as broken.
  // shift+wheel is deliberately inert rather than reassigned: the same
  // answer xyflow gives, and one fewer modifier to remember.
  //
  // EVERY camera gesture also STOPS THE PERFORMANCE (`onGrabRef`), which
  // the grab has always done — 「你不可能读一块在你手下移动的黑板」. The
  // wheel did not, and that hole was defect W4a-3a's first cause: spin the
  // wheel once during playback and the lecture kept walking the wall
  // behind a camera the reader now owned, so an `@turn` to the next board
  // happened entirely off screen and 「黑板切换有时候会无效」. A performance
  // may not advance behind a camera somebody is holding.
  //
  // The grab overturns C1's "拖拽平移 C1 不做" row (product owner, 2026-08-10:
  // 「至少拖拽的时候可以让我像无限画布一样去操作」). C1 filed two real
  // objections and both are answered here rather than waived:
  //
  //  - POINTING: `exceedsGrabSlop` is the whole answer. A press only
  //    becomes a pan by travelling past the slop; below it the click
  //    reaches `onSelectStep` untouched, and above it the click that ends
  //    the pan is swallowed (`grabbedRef`).
  //  - TEXT COPY: a left-drag pans everywhere, because a board the user
  //    can only grab in its margins is not grabbable — they cannot see
  //    where the margins are. Copying keeps two intact native paths:
  //    double/triple-click (word / block, no drag involved, and nothing
  //    here preventDefaults the press that would break it) with shift-click
  //    to extend, and alt+drag for an arbitrary range. Both leave a
  //    non-collapsed selection, which the pointing handler already reads
  //    as "the user was copying, not pointing".
  //
  // A transform write fires no scroll events, so the old latch's whole
  // echo-suppression channel (cameraWrite / scroll / pointer tracking) is
  // still deleted, not ported: the detach signals are the two CAMERA
  // gestures (wheel, grab), never a bare press — camera.test.ts pins both
  // halves. Wheel is non-passive on purpose: the gesture is fully owned
  // here (no page scroll chaining behind the board, no browser page-zoom
  // on pinch). Pointer events cover mouse, pen and touch uniformly, which
  // is what finally closes C1's open touch-panning gap (see .bansho-viewport
  // `touch-action: none` in board-css.ts).
  useEffect(() => {
    const viewport = viewportRef.current;
    const board = boardRef.current;
    if (!viewport || !board) return;
    // Mutually recursive by nature (the teardown names the listeners, one
    // listener names the teardown) — const arrows, not hoisted function
    // declarations, so `viewport`'s null-narrowing survives into them.
    const onPointerMove = (event: PointerEvent): void => {
      const grab = grabRef.current;
      if (!grab || event.pointerId !== grab.pointerId) return;
      if (!grab.panning) {
        if (
          !exceedsGrabSlop(
            event.clientX - grab.startX,
            event.clientY - grab.startY,
            grab.pointerType,
          )
        ) {
          return;
        }
        grab.panning = true;
        // The hand on the board detaches the follow through the same door
        // as the wheel...
        latchRef.current = latchInput(latchRef.current, "grab");
        // ...and stops the performance. Unconditional — the host's pause
        // is idempotent, so this never needs a stale `playing` read.
        onGrabRef.current?.();
        // Whatever the press had begun selecting is not what the user
        // meant; the surface stops selecting for the rest of the gesture
        // (the attribute carries both that and the grabbing cursor).
        surfaceRef.current?.setAttribute("data-bansho-grabbing", "");
        viewport.ownerDocument.getSelection()?.removeAllRanges();
      }
      const dx = event.clientX - grab.lastX;
      const dy = event.clientY - grab.lastY;
      if (dx === 0 && dy === 0) return;
      grab.lastX = event.clientX;
      grab.lastY = event.clientY;
      applyCamera(grabPan(cameraRef.current, liveViewbox(viewport), dx, dy));
    };
    const endGrab = (): void => {
      const grab = grabRef.current;
      grabRef.current = null;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      if (!grab?.panning) return;
      grabbedRef.current = true;
      surfaceRef.current?.removeAttribute("data-bansho-grabbing");
    };
    const onPointerUp = (event: PointerEvent): void => {
      const grab = grabRef.current;
      if (grab && event.pointerId !== grab.pointerId) return;
      endGrab();
    };
    const onPointerDown = (event: PointerEvent): void => {
      // A fresh press: whatever the last gesture suppressed is spent.
      grabbedRef.current = false;
      if (grabRef.current) {
        // A second finger landed. That is a pinch attempt, not a pan —
        // let go rather than chase the midpoint of two moving fingers.
        endGrab();
        return;
      }
      // Left or MIDDLE (xyflow's pan button); a context menu is not a
      // gesture, and alt is the text-selection escape hatch, so neither
      // starts a grab. The middle button rides the identical slop
      // machinery rather than panning from the first pixel: it costs one
      // predicate, and it means a stray middle click cannot pause a
      // lecture — a press only becomes a camera gesture by travelling.
      const pans = event.button === 0 || event.button === 1;
      if (!pans || !event.isPrimary || event.altKey) return;
      grabRef.current = {
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        panning: false,
      };
      // Deliberately NO preventDefault: the browser's own press behaviour
      // (focus, double-click word selection, shift-click extension) has to
      // survive a press that turns out to be a click.
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerUp);
    };
    const onWheel = (event: WheelEvent): void => {
      // Non-passive and always cancelled: no page scroll chaining behind
      // the board, no browser page-zoom on a pinch. The board is not a
      // page, so nothing here ever scrolls one.
      event.preventDefault();
      latchRef.current = latchInput(latchRef.current, "wheel");
      // The reader is driving, so the performance stops — the same door
      // the hand uses, for the same reason (see the table above).
      onGrabRef.current?.();
      // One gesture, one answer: zoom about the cursor. A pinch arrives as
      // ctrl+wheel (browser convention) and is the same gesture at a
      // different amplitude; shift is not read at all.
      const point = viewportPoint(viewport, event.clientX, event.clientY);
      applyCamera(
        zoomAt(
          cameraRef.current,
          liveViewbox(viewport),
          point,
          wheelZoomFactor(event.deltaY, event.deltaMode),
        ),
      );
    };
    // The middle button's own defaults are the browser's, not ours:
    // autoscroll on Windows (armed by mousedown) and paste-primary-
    // selection on X11 (auxclick). Both are cancelled here, on the
    // viewport only, so a middle-drag over the board is a pan and nothing
    // else. `pointerdown` is NOT the place for this — cancelling it would
    // also suppress the compatibility events the LEFT press needs.
    const onMouseDown = (event: MouseEvent): void => {
      if (event.button === 1) event.preventDefault();
    };
    const onAuxClick = (event: MouseEvent): void => {
      if (event.button === 1) event.preventDefault();
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    viewport.addEventListener("pointerdown", onPointerDown);
    viewport.addEventListener("mousedown", onMouseDown);
    viewport.addEventListener("auxclick", onAuxClick);
    return () => {
      viewport.removeEventListener("wheel", onWheel);
      viewport.removeEventListener("pointerdown", onPointerDown);
      viewport.removeEventListener("mousedown", onMouseDown);
      viewport.removeEventListener("auxclick", onAuxClick);
      // Unmounting mid-drag must not leave window listeners behind.
      endGrab();
    };
  }, [applyCamera, liveViewbox]);
  // ── V1.5: the parallax probe (brief §5.2) ───────────────────────────────
  // A separate listener from the grab on purpose. The grab moves the
  // CAMERA (a pose, clamped, latched, and remembered); this moves only the
  // board's ORIENTATION, holds nothing the rest of the canvas can read,
  // and dies with the effect the moment the switch goes off. Subscribed
  // only while the switch is on, so a board nobody asked to rock pays
  // exactly nothing — the C1 hot path is untouched by default.
  //
  // `pointermove` on the viewport (not the window): the pose answers "where
  // are you looking at this board from", which is only a question while the
  // pointer is over the board. Leaving squares it up.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!parallax || !viewport) {
      // Turning the switch off must return the board to square-on, not
      // freeze it at whatever angle the pointer last left it.
      parallaxDepthRef.current = FLAT;
      applyDepth();
      return;
    }
    const onMove = (event: PointerEvent): void => {
      // A grab in flight owns the pointer: the reader is dragging the
      // board, and rocking it at the same time reads as the board fighting
      // the hand.
      if (grabRef.current?.panning) return;
      // Through the funnel, exactly like the anchored zoom: the viewport is
      // the ancestor of every transformed surface and wears none itself,
      // so its origin shift needs no scale divide — and routing it here
      // keeps this file at zero raw rect reads (the G8-J source scan).
      // `clientWidth/Height` is the layout family, transform-immune.
      const p = viewportPoint(viewport, event.clientX, event.clientY);
      const { nx, ny } = parallaxAxes(
        {
          left: 0,
          top: 0,
          width: viewport.clientWidth,
          height: viewport.clientHeight,
        },
        p.x,
        p.y,
      );
      parallaxDepthRef.current = parallaxPose(nx, ny);
      applyDepth();
    };
    const onLeave = (): void => {
      parallaxDepthRef.current = FLAT;
      applyDepth();
    };
    viewport.addEventListener("pointermove", onMove);
    viewport.addEventListener("pointerleave", onLeave);
    return () => {
      viewport.removeEventListener("pointermove", onMove);
      viewport.removeEventListener("pointerleave", onLeave);
      parallaxDepthRef.current = FLAT;
      applyDepth();
    };
  }, [parallax, applyDepth]);
  // Reduced motion (or the host turning depth off) must square the board up
  // immediately, not at the next frame tick.
  useEffect(() => {
    if (depthMotion) return;
    directorDepthRef.current = FLAT;
    applyDepth();
  }, [depthMotion, applyDepth]);
  useEffect(() => {
    // Re-engage the camera whenever the user returns to the live feed.
    if (follow === "live") resetLatch();
  }, [follow, resetLatch]);
  /** The wall map's click: stand in front of board `i`. It is a USER
   *  GESTURE, so it goes through the doors the hand and the wheel already
   *  use — detach the follow, stop the performance, write the camera once
   *  — rather than opening a second, viewer-side glide loop next to the
   *  canonical one. Instant is right here: the reader asked to BE there. */
  const jumpToBoard = useCallback((panel: number): void => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    latchRef.current = latchInput(latchRef.current, "grab");
    onGrabRef.current?.();
    const slot = wallSlot(panel, panelCountRef.current, wallGeom());
    applyCamera(
      clampCamera(
        { x: slot.x, y: slot.y, z: restZoom(viewport.clientWidth, PANEL_WIDTH) },
        liveViewbox(viewport),
      ),
    );
  }, [applyCamera, liveViewbox, wallGeom]);

  /** Drag on the map: move the reader by this many BOARD px. A user
   *  gesture, so it goes through the same doors the hand and the wheel
   *  use — detach the follow, stop the performance, write once. */
  const panCameraBoard = useCallback(
    (dx: number, dy: number): void => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      latchRef.current = latchInput(latchRef.current, "grab");
      onGrabRef.current?.();
      const camera = cameraRef.current;
      applyCamera(
        clampCamera(
          { x: camera.x + dx, y: camera.y + dy, z: camera.z },
          liveViewbox(viewport),
        ),
      );
    },
    [applyCamera, liveViewbox],
  );

  /** Bring one built step into view. Returns false when it is not mounted. */
  const showStep = useCallback((ref: StepRef): boolean => {
    const viewport = viewportRef.current;
    const item = itemByRefRef.current.get(refKey(ref));
    if (!viewport || !item) return false;
    const k = refKey(ref);
    // C3: an explicit erase performs on a BOARD — the camera walks to the
    // board being wiped, not to the step's own (hidden, zero-rect) span.
    // A back reference performs at its TARGET — the pen (and the camera)
    // turn back to earlier writing (anchorRows inside).
    const rect =
      item.step.kind === "erase"
        ? erasedBoardHead(k)
        : item.step.kind === "turn"
          ? // S1: a turn performs at its DESTINATION board — the camera
            // walks with the pen to the board it turned to.
            turnBoardHead(k)
          : measureStageAnchor(ref);
    if (!rect) return false;
    // Both axes: standing in front of a board on the second row is a walk
    // to that board, not a scroll down the wall. The board carries its own
    // HEIGHT (`FollowBoard`), so the arithmetic — not a gate here — decides
    // whether standing in front of it means its corner (it fits the view)
    // or the nearest height inside it (it does not); the canonical
    // simulation reads the same field.
    const slot = stagedMultiRef.current ? panelSlotOf(rect) : null;
    const board = slot ? { ...slot, h: wallGeom().panelH } : undefined;
    const box = liveViewbox(viewport);
    const target = {
      top: rect.top,
      bottom: rect.bottom,
      ...(board ? { left: rect.left, right: rect.right, board } : {}),
    };
    // The reader is coming back (they took the camera, then pressed play /
    // Live / seeked): they get the canonical re-attach pose, not the
    // minimum shift that would suit a pen already in view. One flag, spent
    // the moment it is honoured.
    if (reattachRef.current) {
      reattachRef.current = false;
      applyCamera(reattachCamera(cameraRef.current, box, target));
      return true;
    }
    const next = followShift(cameraRef.current, box, target);
    if (next) applyCamera(next);
    return true;
  }, [applyCamera, liveViewbox, measureStageAnchor, panelSlotOf, erasedBoardHead, turnBoardHead, wallGeom]);

  /** Bring the given schedule entry into view (ref reads only — stable). */
  const followEntry = useCallback((index: number): void => {
    const compiled = compiledRef.current;
    if (!compiled || index < 0) return;
    const entry = compiled.timeline.schedule[index];
    if (!entry) return;
    showStep(entry.step);
  }, [showStep]);

  /**
   * The gate's follow branch on a camera board: first hand a
   * director-residue camera back to the pen (camera.ts::handBackCamera —
   * z = the rest zoom, x = 0; measured on the first G7 trace, where an @overview's
   * zoom otherwise stuck to the whole rest of the lecture and the next
   * move's window opened with a one-frame z jump), then the C1 follow.
   * Camera-free boards skip the hand-back entirely — C1 untouched.
   */
  const followAt = useCallback((index: number): void => {
    const sched = stageScheduleRef.current;
    if (sched && sched.moves.length > 0) {
      const viewport = viewportRef.current;
      // The pen camera's rest is the WRITING board (C3) — the origin on a
      // single panel, exactly the C2 contract. A board is supplied only on
      // a wall: on a strip the hand-back keeps the director's y, which is
      // the C2 behaviour the G7 trace pinned.
      let board: FollowBoard | undefined;
      if (stagedMultiRef.current) {
        const entry = compiledRef.current?.timeline.schedule[index];
        const a = entry
          ? layoutRef.current?.assignments.get(refKey(entry.step))
          : undefined;
        if (a) {
          const geom = wallGeom();
          const slot = wallSlot(a.panel, panelCountRef.current, geom);
          board = { ...slot, h: geom.panelH };
        }
      }
      const rebased = handBackCamera(
        cameraRef.current,
        restZoom(viewWRef.current, PANEL_WIDTH),
        board,
        viewHRef.current,
      );
      if (rebased && viewport) {
        applyCamera(clampCamera(rebased, liveViewbox(viewport)));
      }
    }
    followEntry(index);
  }, [followEntry, applyCamera, liveViewbox, wallGeom]);

  // Publish the imperative camera to the shell (navigate-to / play-from /
  // a locator card all land here).
  useEffect(() => {
    if (!onApi) return;
    onApi({
      showStep,
      readSnapshotBasis,
      readFrameGeometry,
      readStandingBoxes,
      paintFrames,
      framesTarget,
    });
    return () => onApi(null);
  }, [
    onApi,
    showStep,
    readSnapshotBasis,
    readFrameGeometry,
    readStandingBoxes,
    paintFrames,
    framesTarget,
  ]);
  // Resuming returns the camera to the performance (C1′ — the product
  // owner's design: 「你可以拖拽时暂停部分。。继续的时候回到之前的位置」).
  // "之前的位置" is where the performance IS, not the pose the user dragged
  // away from, so resuming re-engages the follow at the playhead — through
  // `reset`, the same door Live and every explicit seek use, never a second
  // policy. Releasing the grab does none of this on purpose: letting go
  // must not yank the view back from whatever the user let go to look at.
  //
  // DECLARATION ORDER IS LOAD-BEARING: React runs a commit's effects in the
  // order they are declared, and the passive follow below reads
  // `latchRef` in that same commit (both fire on the `playing` flip). This
  // reset must stay above it. The re-engage itself is free — the follow
  // effect already runs on the flip; it was only ever gated by the latch.
  const wasPlayingRef = useRef(playing);
  useEffect(() => {
    const resumed = playing && !wasPlayingRef.current;
    wasPlayingRef.current = playing;
    if (resumed) resetLatch();
  }, [playing, resetLatch]);
  // Passive follow: the pen advancing during playback. Guarded on `playing`
  // so a paused user's camera is never yanked by an agent recompile. Gated
  // (C2): while the register holds a director pose the pen follow yields —
  // without the gate, a camera step's own schedule entry becoming active
  // would followEntry() onto its hidden zero-rect span and slam the view
  // to the board head.
  useEffect(() => {
    if (!playing) return;
    const verdict = gateCamera(
      stageScheduleRef.current,
      getPlayheadT(),
      latchRef.current,
    );
    if (verdict.kind === "follow") followAt(activeIndex);
    else if (verdict.kind === "director") {
      // Symmetric with the seek path: a director pose IS canonical, so it
      // settles any re-attach the reader is owed. An armed flag that
      // survived a hold would fire at whatever step the register happens
      // to decay on, which is the stale-flag bug this one line closes.
      reattachRef.current = false;
      applyCamera(verdict.camera);
    }
  }, [activeIndex, playing, followAt, getPlayheadT, applyCamera]);
  // The director's glide (C2): the interpolated pose advances with the
  // clock. All animation state lives in the FOLD (a pure function of t —
  // that is what makes scrub correct); this listener only queries and
  // writes. Camera-free boards return before any fold work — the C1
  // per-frame hot path stays untouched.
  useEffect(() => {
    return onFrame((t) => {
      const sched = stageScheduleRef.current;
      if (!sched) return;
      const verdict = gateCamera(sched, t, latchRef.current);
      if (verdict.kind === "director") {
        // Same rule on the glide's own path — a read, not a write, so the
        // per-frame hot path pays a branch and nothing else.
        if (reattachRef.current) reattachRef.current = false;
        applyCamera(verdict.camera);
      }
      // V1.5 — the transition's depth, from the same fold, at the same t.
      // Written even when the user has detached: the pose they dragged to
      // is theirs, but the board's ORIENTATION is the director's, and a
      // transition that ran flat for detached readers would make the
      // feature depend on who is holding the camera.
      applyDirectorDepth(t);
    });
  }, [onFrame, applyCamera, applyDirectorDepth]);
  // Explicit navigation (scrub / keyboard seek / Live / replay jump): the
  // player pauses+detaches on a scrub, so the passive path never fires —
  // this seam is what keeps the camera on the pen when the user seeks a
  // tall board. An explicit seek supersedes a manual scroll (it IS the
  // user saying "show me this moment"), so the scroll latch resets. Gated
  // (C2): a seek into a camera window lands on the director's pose at
  // exactly that t.
  useEffect(() => {
    return onSeek((t) => {
      resetLatch();
      // A scrub that lands inside a transition window shows that
      // transition's depth — the pose is a pure function of t, so the
      // dragged playhead and the played one agree exactly (and landing
      // anywhere else lands square-on, by the same function).
      applyDirectorDepth(t);
      const verdict = gateCamera(stageScheduleRef.current, t, latchRef.current);
      if (verdict.kind === "director") {
        // The director's pose IS canonical, so it settles the re-attach
        // this seek owed the reader — leaving the flag armed would fire a
        // re-attach at some unrelated later step.
        reattachRef.current = false;
        applyCamera(verdict.camera);
        return;
      }
      const compiled = compiledRef.current;
      if (!compiled) return;
      followAt(activeScheduleIndex(compiled.timeline.schedule, t));
    });
  }, [onSeek, followAt, applyCamera, applyDirectorDepth, resetLatch]);

  return (
    <div
      ref={surfaceRef}
      className="bansho-board-surface relative h-full min-h-0 flex flex-col rounded-lg overflow-hidden border border-cc-border"
      data-bansho-theme={theme}
      // THE BOARD'S SIZE, published once for every descendant that needs it
      // — the panels, and the hidden measure layer, which is the viewport's
      // SIBLING and so could not read a variable set on the panels. On the
      // surface it also reaches the NOTES projection, which never runs the
      // staged branch of the rebuild and would otherwise keep measuring
      // against the window (W7).
      style={
        {
          "--bansho-panel-w": `${PANEL_WIDTH}px`,
          "--bansho-panel-h": `${PANEL_HEIGHT}px`,
          "--bansho-panel-gap": `${PANEL_GAP}px`,
        } as React.CSSProperties
      }
    >
      {/* The stage camera (C1). The viewport clips — it does NOT scroll
          (the native scrollbar is still an accepted loss; the hand, the
          wheel, Live and the timeline are the recovery surfaces). The
          stage carries the one camera transform; .bansho-panels exists
          NOW, one panel strong, so C3's `@board 2–4` is pure addition. */}
      <div
        ref={viewportRef}
        className="bansho-viewport flex-1 min-h-0"
        data-testid="bansho-board-viewport"
      >
        {/* V1.5 — the depth surface. It carries the ONE perspective and
            the ONE 3D pose (the director's transition swing composed with
            the reader's parallax), written inline by `applyDepth` and
            ABSENT at rest, which is what keeps the V1 layout baseline
            byte-identical and a 4300px board off the compositor. It is
            deliberately OUTSIDE the stage: `.bansho-stage` still wears
            exactly `cameraCss(camera)` and nothing else, so every G8-J
            argument about the stage's one transform survives verbatim. */}
        <div ref={depthRef} className="bansho-depth">
        <div ref={stageRef} className="bansho-stage">
          {/* C3: 1–4 boards. Panel 0 doubles as `boardRef` (the pristine
              C1 path is byte-identical: one panel, direct flow). Extra
              panels appear only under an `@board 2–4` stage direction. */}
          <div
            ref={panelsRef}
            className="bansho-panels"
            // THE ROOM'S SHAPE, and the only thing CSS needs to know about
            // it. Grid auto-placement fills row-major, which is exactly the
            // order `wallSlot` slots boards in, so the grid IS the slot
            // function — no per-panel placement, one number, no second copy.
            style={
              {
                "--bansho-wall-cols": `${wallGrid(panelCount).cols}`,
              } as React.CSSProperties
            }
            data-bansho-multi={panelCount > 1 ? "" : undefined}
          >
            {Array.from({ length: panelCount }, (_, i) => (
              // The slot is the grid cell AND the board's furniture (frame
              // + chalk tray, drawn by CSS pseudo elements that overflow
              // it). On a single strip it is `display: contents` — it
              // generates no box at all, so the C1 flex chain, the
              // offsetParent walk `stageOffsetOf` makes, and the layout
              // baseline are untouched BY CONSTRUCTION.
              <div key={i} className="bansho-slot">
              <div
                ref={(el) => {
                  panelElsRef.current[i] = el;
                  if (i === 0) boardRef.current = el;
                }}
                className="bansho-panel bansho-board"
                // Pointing is a plain click — no select mode, because
                // "point at the board and say what you want" IS this
                // mode's interaction. Clicks reach here by React's root
                // delegation even though the step nodes below are raw,
                // factory-built DOM. A press is NEVER a camera gesture
                // (camera.ts pins that policy); only a press that TRAVELS
                // past the grab slop becomes one, and it is the two guards
                // below — not the absence of drag-panning — that keep this
                // click meaning what it always meant.
                data-bansho-pointing={onSelectStep ? "on" : undefined}
                onClick={
                  onSelectStep
                    ? (event) => {
                        // The click that ends a pan is the user letting go
                        // of the board, not pointing at a step (C1′).
                        if (grabbedRef.current) return;
                        // A click that ends a text drag is the user
                        // copying words, not pointing at a step.
                        if (!event.currentTarget.ownerDocument.getSelection()?.isCollapsed) {
                          return;
                        }
                        onSelectStep(stepFromEvent(event.target));
                      }
                    : undefined
                }
              />
              </div>
            ))}
          </div>
        </div>
        </div>
      </div>
      {/* THE WALL MAP. 「总览肯定不是右上角的控件，是一个类似无限画布的缩
          略图。可以缩放拖拽去观测的，并且能看到黑板中内容的轮廓形状。」
          The fill-bar group that used to stand here answered "how full is
          board 3"; a reader in a room asks "which board has the diagram,
          and where am I looking". So it is a scaled drawing of the whole
          wall with the real ink on it, and it is inspectable the way an
          infinite canvas is — drag to pan the stage, wheel to zoom the
          map, click a board to stand in front of it.

          Mounted only on a real wall (`panelCount > 1`): a single strip IS
          its own overview, and the MOUNT gate — not a hidden node — is
          what keeps the byte-gate captures untouched. Bottom right and
          collapsible, because the widget it replaces sat over board 4. */}
      {panelCount > 1 && (
        <WallMap
          panelCount={panelCount}
          geom={wallGeom()}
          outlines={outlines}
          revealIndex={activeIndex}
          registerBoard={registerBoardRect}
          registerViewRect={registerViewRect}
          onJump={jumpToBoard}
          onPanBoard={panCameraBoard}
        />
      )}
      {/* G8-K: the measure layer is the stage's SIBLING — no camera
          transform can ever reach the probes, so canonical stays
          zoom-independent (R8). It wears .bansho-board so the typography
          context matches the panel byte for byte. */}
      <div className="bansho-measure-layer bansho-board" aria-hidden="true">
        <div ref={measureRef} className="bansho-measure-host" />
      </div>
    </div>
  );
}

/** Remove every step/backref node (the board holds nothing else now). */
function wipeSteps(board: HTMLElement): void {
  board.replaceChildren();
}

/**
 * Formulas the board could not write out, each pinned to the step it sits
 * in — read off the live DOM, which is the only place this fact exists.
 *
 * Two failure surfaces, one read: `[data-bansho-math-error]` is the
 * factory's catch around a HARD katex throw, but the common failure — a
 * malformed TeX body — never throws (`throwOnError: false`): KaTeX returns
 * its own `.katex-error` markup (raw TeX in red). Both are "this formula
 * did not come out", so both are collected (a `.katex-error` never sits
 * inside a `[data-bansho-math-error]` node — the attribute path renders
 * plain text — so nothing is counted twice).
 *
 * The measure host is empty by this point (probe nodes are appended and
 * removed within the align pass), so a board-wide query sees mounted steps
 * only.
 *
 * Exported for its own test: this is the measurement half of a §9 finding
 * (the same split `overflowingRefs` has — the host reads the DOM, the pure
 * classifier in board-check.ts turns it into words), and the attribution
 * from a failed formula to the step that owns it is the whole point.
 */
export function readMathErrors(board: HTMLElement): {
  mathErrors: StepRef[];
  unplacedMathErrors: number;
} {
  const mathErrors: StepRef[] = [];
  let unplacedMathErrors = 0;
  for (const node of board.querySelectorAll(
    "[data-bansho-math-error], .katex-error",
  )) {
    const ref = parseStepKey(
      node.closest("[data-bansho-ref]")?.getAttribute("data-bansho-ref"),
    );
    if (ref) mathErrors.push(ref);
    else unplacedMathErrors++;
  }
  return { mathErrors, unplacedMathErrors };
}

/** Build one flat entry through its factory (badge / placeholder fallbacks). */
function buildItem(
  doc: Document,
  entry: ReconcileEntry,
  ctx: MeasureContext,
): BuiltItem {
  const { step } = entry;
  const base = {
    hash: entry.hash,
    ref: entry.ref,
    step,
    ...(containerKeyOf(step) !== undefined
      ? { container: containerKeyOf(step) }
      : {}),
  };

  if (step.kind === "bad") {
    // R6 — the blast radius of a mistake is exactly one badge.
    const node = doc.createElement("div");
    node.className = "bansho-bad-badge";
    node.title = step.reason;
    node.innerHTML =
      `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 2 1.8 13.2h12.4Z"/><path d="M8 6.4v3.2"/><circle cx="8" cy="11.6" r="0.4"/></svg>` +
      `<span>unreadable block</span>`;
    return { ...base, node, revealables: [] };
  }

  const factory = factoryFor(step.kind);
  if (!factory) {
    if (
      step.kind === "wait" ||
      step.kind === "camera" ||
      step.kind === "turn" ||
      step.kind === "at" ||
      step.kind === "board-config"
    ) {
      // An explicit beat / a camera move / a turn / the opening stage
      // direction — pure time (or pure configuration), no space. The
      // camera's schedule entry deliberately has NO revealable to pair
      // with (makeSeek's unpaired "dispatch nowhere" path): the register
      // is folded by stageStateAt, never dispatched to. EVERY turn rides
      // the same unpaired path now — including one that found a full wall,
      // which since 2026-08-11 stays put instead of sweeping a board.
      const node = doc.createElement("span");
      (node as HTMLElement).style.display = "none";
      return { ...base, node, revealables: [] };
    }
    // image / html land in Phase 3 — visible, honest placeholder.
    const node = doc.createElement("div");
    node.className = "bansho-placeholder";
    node.textContent = `${step.kind} block (not yet performed in this version)`;
    return { ...base, node, revealables: [] };
  }

  const { node, revealables } = factory.build(step, ctx);
  return { ...base, node, revealables };
}

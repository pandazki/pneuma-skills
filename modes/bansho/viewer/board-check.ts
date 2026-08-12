/**
 * The board's self-check loop (§9) — what `check-board` answers and what
 * the board says to the agent on its own.
 *
 * Two surfaces, one set of facts:
 *  - `check-board` is the COMPLETE inventory the agent asks for after a
 *    batch of edits: everything it wrote that the board could not perform.
 *  - the notification channel is the board INTERRUPTING the agent, and it
 *    carries only the three kinds §9 declares (`stepParseError` /
 *    `refUnresolved` / `boardOverflow`). A step this version simply does
 *    not perform, and a formula that failed to render, are real findings
 *    but not interruptions — they show in the report and in the board's
 *    own issue chip.
 *
 * Every word here is LECTURE vocabulary. The parser's own diagnostics are
 * deliberately NOT forwarded verbatim — they speak the dialect's internal
 * terms; what reaches the agent is a sentence about the lecture plus the
 * agent's own writing, quoted back.
 *
 * Pure: no DOM. Geometry enters as already-measured numbers
 * (`overflowingRefs`) so the classifier is testable without a layout
 * engine.
 */

import type { ViewerNotification } from "../../../core/types/viewer-contract.js";
import type { RegionBurst } from "../engine/layout.js";
import type { BoxCollision, Rect } from "../engine/regions.js";
import type { Lecture, StepRef } from "../engine/types.js";
import {
  formatAddress,
  parseStepKey,
  stepAt,
  summarizeStep,
  toAddress,
  type BoardAddress,
} from "./address.js";

/**
 * Everything `check-board` can report. Declared as a value, with the type
 * derived from it, so the skill's own list of codes can be asserted against
 * this one rather than kept in step with it by hand (T7-review F5).
 */
export const FINDING_CODES = [
  "stepParseError",
  "refUnresolved",
  "unsupportedStep",
  "mathRenderError",
  "boardOverflow",
  "narrationClipMissing",
  // Canvas pivot V2 (design §5.4) — the two consequences the room stopped
  // preventing. Neither is a fault: they are declared physics, reported so
  // the author can see what their own declarations did.
  "regionCollision",
  "regionBurst",
  // …and the one refusal (§5.5): a `@turn` with nowhere clean to go.
  "turnOnFullWall",
  // W2 — and the one WASTE: a `@turn` that walked away from a board the
  // author had barely written on. Not a fault either; a board is the
  // author's to leave. But a lecture that turns at 15% fill is spending
  // four boards on one board's worth of talk, and nobody watching the
  // room from inside it can see that.
  "turnUnderfilled",
] as const;

export type FindingCode = (typeof FINDING_CODES)[number];

/** One thing the board could not perform, addressed and quoted. */
export interface BoardFinding {
  code: FindingCode;
  /** Where on the board — the same address `navigate-to` and `capture` take. */
  address?: BoardAddress;
  /** One sentence, in the words the lecture uses. */
  message: string;
  /** What the agent wrote there, quoted back so the fix is obvious. */
  excerpt?: string;
}

/** A recorded narration clip whose audio file is confirmed absent (M3). */
export interface MissingNarrationClip {
  /** The step whose voice is gone. */
  ref: StepRef;
  /** The manifest `file` value — where re-synthesis must land. */
  file: string;
}

/** What only the live board knows — measured by the host, passed in. */
export interface BoardObservations {
  /**
   * Formulas that failed to render, each named by the step it sits in
   * (BoardCanvas reads them off the board per rebuild). One entry per
   * failed formula, so a step with two bad formulas reports two.
   */
  mathErrors: readonly StepRef[];
  /**
   * Failed formulas the host could not attribute to a step. Reported as a
   * count rather than dropped — a finding with no address is still a
   * finding, and silence would be the worse failure.
   */
  unplacedMathErrors?: number;
  /** Steps whose writing runs past the right edge of the board. */
  overflowing: readonly StepRef[];
  /**
   * Steps that turn back to — or extend — writing an erase had already
   * taken off the board when they arrived (the assignment fold's
   * orphans). Nothing is inked for them; reported under `refUnresolved`
   * (they point at something that is not on the board any more) with a
   * sentence that names the erase, so the agent knows the quote itself
   * was fine.
   */
  inkAfterErase?: readonly StepRef[];
  /**
   * Manifest clips whose audio file the host's `/api/file` probe
   * confirmed absent — the step plays silent at its natural pace (the
   * host filters the clip out of the compile), and this finding is how
   * the agent learns to re-synthesize. Confirmed misses only: an
   * unanswerable probe accuses nothing.
   */
  missingNarrationClips?: readonly MissingNarrationClip[];
  /**
   * Standing boxes that overlap (design §5.2's predicate, run by
   * `engine/regions.ts::detectCollisions` over `layout.standingBoxes`).
   * The room does not prevent these and does not repair them — the whole
   * of their handling is BEING SEEN (§5.3).
   */
  collisions?: readonly BoxCollision[];
  /** Regions whose standing content runs past their frame's bottom (§4). */
  bursts?: readonly RegionBurst[];
  /** `@turn`s that found no clean board and stayed (§5.5). */
  turnsOnFullWall?: readonly StepRef[];
  /**
   * W2 — `@turn`s that LEFT a board well under-filled, with the fraction of
   * that board's FACE the writing had covered (`layout.turns[].fill`, read
   * before the walk). Only turns that actually walked appear: an inert turn
   * left nothing behind to be under-filled.
   */
  turnsUnderfilled?: readonly { ref: StepRef; fill: number }[];
}

/**
 * Under this much of a board's capacity, walking away from it is worth
 * saying out loud.
 *
 * Calibrated to the COLUMN, because since W2 that is the unit of room a
 * face has. `layout.turns[].fill` is the share of the FACE that stands
 * written on (W9 — every claim counted once: the room's flow columns and
 * every named region an `@at` opened), so on the two-column face a lecture
 * that filled the left of a board and turned scores exactly 0.5 — one
 * whole blank column, half a blackboard, left standing for the rest of the
 * talk. That is the waste this finding exists to name, so the threshold has
 * to sit ABOVE it; the old 0.35 was calibrated when a face was one column
 * deep, and there "half a board" really was a legitimate composition.
 *
 * W9 IS WHY THIS NUMBER IS NOW SAFE TO RAISE. Until the fill counted `@at`
 * ink, raising the threshold to 0.75 WIDENED the window in which a board
 * composed of named placements — reading 0% while standing full — was
 * falsely accused of being abandoned half-written. One author counted
 * twelve such accusations in a single lecture and verified every board by
 * hand. The louder the finding got, the more often it was wrong.
 *
 * 0.75 is the midpoint between that blank column and a written-out face.
 * It speaks for every turn that never reached the last column at all, and
 * for one that only just started it, and goes quiet once the last column
 * is more than half written — past which what is left could not have held
 * the section anyway. One number reads the three-column face the same way:
 * two full columns of three is 0.67, still said back.
 *
 * The bias is deliberately toward speaking, because the finding is
 * advisory — nothing moves, nothing refuses, it is a line in the script.
 * A sentence the author disagrees with costs one read; a blank half-wall
 * nobody named costs the audience the lecture.
 */
export const TURN_UNDERFILL_THRESHOLD = 0.75;

/** How a collision or a burst names the region it happened in. */
function regionWord(region: string): string {
  const [word = region, episode] = region.split("#");
  return episode ? `${word} (placement ${episode})` : word;
}

const pct = (fraction: number): number => Math.round(fraction * 100);

/**
 * One overlap's identity: `collision|panel|regionA|regionB`, the two region
 * names sorted (design §5.5). ONE key generator for every surface that
 * speaks about collisions — the notification's transition dedupe and the
 * board's own marks — so the push and the mark can never name the same
 * overlap differently.
 */
function collisionKey(hit: BoxCollision): string {
  const [a, b] = [hit.a.region, hit.b.region].sort();
  return `collision|${hit.panel}|${a}|${b}`;
}

/**
 * What a collision looks like ON THE BOARD (design §5.3) — the human half
 * of "a collision is a fact, not a prohibition".
 *
 * §5.3 lists four channels, and three of them (`frame-board`, `check-board`,
 * the `boardCollision` push) speak to the AGENT. The fourth — "the board
 * already draws it" — is true of the INK and false of the DIAGNOSIS: two
 * paragraphs written through each other look exactly like a broken
 * renderer, and a fact the author cannot recognise is not being reported.
 * These marks are that missing recognition, and nothing more: they are
 * drawn OVER the overlap that already exists, so nothing is moved, nothing
 * is dimmed and nothing is erased.
 *
 * Pure on purpose — rectangles in, rectangles out, no DOM. The host paints
 * them (`BoardCanvas`), which is the seam `collision-mark.test.tsx` pins.
 */
export interface CollisionMark {
  /** `collisionKey` — shared with the §5.5 push. */
  key: string;
  panel: number;
  /** The two region words, sorted, as one attribute value (`full×left`). */
  pair: string;
  /** The overlapping rectangle, in the same face coordinates as the boxes. */
  rect: Rect;
  /**
   * The caption, on the FIRST mark of each pair only. A pair that overlaps
   * in four places is ONE fact said four times; captioning every rectangle
   * would bury the board it is describing.
   */
  label?: string;
}

/**
 * The §5.3 wording, pinned like `CLAIM_VS_INK_NOTE`: what the reader is
 * looking at is both declarations, honoured. Deliberately not an
 * imperative — the room does not forbid this, and the caption must not
 * pretend it does.
 */
export const COLLISION_MARK_NOTE = "both written, the later ink on top";

/** Every collision as a mark, in the order `detectCollisions` found them. */
export function collisionMarks(
  collisions: readonly BoxCollision[],
): CollisionMark[] {
  const captioned = new Set<string>();
  return collisions.map((hit) => {
    const key = collisionKey(hit);
    const [a, b] = [hit.a.region, hit.b.region].sort();
    const mark: CollisionMark = {
      key,
      panel: hit.panel,
      pair: `${a}×${b}`,
      rect: hit.overlap,
    };
    if (captioned.has(key)) return mark;
    captioned.add(key);
    return {
      ...mark,
      label: `${regionWord(a)} × ${regionWord(b)} overlap`,
    };
  });
}

/**
 * What a BURST looks like ON THE BOARD (W8) — the reader's half of the
 * design's word `visibly` (`engine/layout.ts`), which until now only the
 * agent's finding honoured.
 *
 * The gap this closes is not decorative. A board's panel clips at its own
 * edge, so writing that runs past it is GONE from the picture: a reader
 * sees a sentence stop in the middle and nothing says more was there, and
 * `capture` — the one organ this mode's skill tells its author to trust
 * over their own reading — hands back that same clean edge. A finding that
 * exists only as a number, inside a discipline built on looking, is a
 * finding an author learns to scroll past. That is exactly what happened.
 *
 * ONLY THE CUT IS MARKED, not every burst. A `top` band whose writing
 * spills into the lower half is ink still in the picture — the reader has
 * it, and any overlap it causes already wears a collision mark. Marking
 * that too would pin a permanent flag on a 3px overrun (the predicate has
 * no minimum) and turn declared physics into nagging. The mark exists for
 * the one case the picture cannot show: ink past the board's own floor.
 *
 * Pure like `collisionMarks` — rectangles in, rectangles out. The host
 * paints it as one absolutely positioned, `pointer-events: none` layer per
 * panel, repainted per rebuild, so it can never become measurable ink that
 * feeds the fold (a board that grew because it overflowed would be the
 * worst possible answer here).
 */
export interface BurstMark {
  /** `burst|panel|region` — one mark per bursting region, per board. */
  key: string;
  panel: number;
  /** The region word, for the data attribute the test reads. */
  region: string;
  /**
   * The cut line, in the same face coordinates as every box: the frame's
   * x/width (so the reader sees WHICH column ran off) at the BOARD's
   * floor (`h: 0` — a line, not a band; the ink below it is clipped, so
   * there is no area to draw).
   */
  rect: Rect;
  /** `left · 128px below the board's edge`. */
  label: string;
}

/**
 * The §4 wording on the board, pinned like `COLLISION_MARK_NOTE`: what the
 * reader is looking at is writing that exists and a board that ends.
 * Deliberately not an imperative and not an error — the room permits this,
 * and the caption must neither scold nor pretend something broke.
 */
export const BURST_MARK_NOTE = "the writing goes on below; the board does not";

/**
 * Every burst the board's own edge cuts, as a mark on that cut.
 *
 * `faceHeight` is the board's floor in face coordinates (the fold's
 * budget) — the host has it and the burst does not, because it is one
 * number for the whole wall rather than a property of any one region.
 */
export function burstMarks(
  bursts: readonly RegionBurst[],
  faceHeight: number,
): BurstMark[] {
  if (!Number.isFinite(faceHeight)) return [];
  const marks: BurstMark[] = [];
  const seen = new Set<string>();
  for (const burst of bursts) {
    if (burst.cut <= 0) continue;
    const key = `burst|${burst.panel}|${burst.region}`;
    if (seen.has(key)) continue;
    seen.add(key);
    marks.push({
      key,
      panel: burst.panel,
      region: burst.region,
      rect: { x: burst.frame.x, y: faceHeight, w: burst.frame.w, h: 0 },
      label: `${regionWord(burst.region)} · ${Math.round(
        burst.cut,
      )}px below the board's edge`,
    });
  }
  return marks;
}

/**
 * What a burst says to the agent (W8).
 *
 * Three sentences, in the shape `turnUnderfilled` set: the numbers, what
 * the READER gets, and the ways out that apply here. The old sentence
 * ended at "It is written in full anyway", and an author who had measured
 * their own overrun read that as permission and kept writing — the
 * lecture that produced this fix says 「照写不误」 in its own plan. It was
 * also false: past the board's edge nothing is written at all.
 *
 * "Split the step" is gone with it. A named region never migrates, so two
 * shorter steps in the same frame stand exactly as tall as one long one —
 * it was advice that could not work. What is left is the three moves that
 * change the height: write less, take a word with more room, or take a
 * whole board. The flow (`full`) has no wider word above it and `@turn`
 * on a full wall is a second refusal (`turnOnFullWall`), so it is told the
 * two moves it actually has.
 */
function burstMessage(burst: RegionBurst): string {
  const word = regionWord(burst.region);
  const over =
    burst.frameHeight > 0 && Number.isFinite(burst.frameHeight)
      ? ` (${pct(burst.overflow / burst.frameHeight)}% over)`
      : "";
  const room =
    burst.frameHeight > 0 && Number.isFinite(burst.frameHeight)
      ? `the ${Math.round(burst.frameHeight)}px it has`
      : "the space it was given";
  const consequence =
    burst.cut > 0
      ? `The last ${Math.round(
          burst.cut,
        )}px falls past the board's own bottom edge, and past that edge nothing is written — a reader watches the sentence stop in the middle. The board draws the cut line, so capture shows it too.`
      : "It stands where it was put, over whatever is below it — nothing was moved and nothing was shrunk.";
  const waysOut =
    burst.name === "full"
      ? 'Say less here, or retire a finished board (@erase "锚") so the pen has a clean one to carry on to.'
      : "Say less here, place it under a word with more room (a corner is a quarter of the board, left or right a half), or give the passage a board of its own with @turn.";
  return `On board ${burst.panel + 1}, ${word} holds ${Math.round(
    burst.overflow,
  )}px more writing than ${room}${over}. ${consequence} ${waysOut}`;
}

/** Longest quoted excerpt handed to the agent. */
const EXCERPT_LIMIT = 160;

/** The three kinds the board is allowed to interrupt the agent with (§9). */
const NOTIFIED_CODES: readonly FindingCode[] = [
  "stepParseError",
  "refUnresolved",
  "boardOverflow",
];

/**
 * §5.5, verbatim: the wall is full and the room will not choose for you.
 * A finding rather than a notification on purpose — it is a line in the
 * script the author is looking at, and its badge is already on screen.
 */
export const TURN_ON_FULL_WALL_MESSAGE =
  'the wall is full — every board holds standing ink; say your own retirement (@erase "锚") before turning.';

/**
 * §5.4's pinned honesty about what a collision rectangle IS. A `full` prose
 * box claims the whole board width even where its last line stops short, so
 * an overlap with the flow is a claim overlap, not necessarily an ink one —
 * and saying so is the difference between a report and an accusation.
 */
export const CLAIM_VS_INK_NOTE =
  "…overlaps the flow's CLAIMED width — its ink may stop short; judge by frame-board or capture.";

/**
 * W8 — the sentence that taught an agent to keep writing.
 *
 * It stated a property and stopped, so the author read it as a recorded
 * fact about their board rather than something to answer, and wrote on:
 * their own plan says 「照写不误」 about a burst they had already measured.
 * Its neighbour in this table (`turnUnderfilled`) says what happened AND
 * what to do, and that is the shape every finding here owes its reader.
 * Exported like `TURN_ON_FULL_WALL_MESSAGE` so the shape can be pinned.
 */
export const REGION_BURST_SENTENCE =
  "The writing here stands taller than the space it was placed in and runs past its bottom edge; past the board's own edge nothing of it is written. Say less here, place it under a word with more room, or give it a board of its own with @turn.";

const SENTENCE: Record<FindingCode, string> = {
  stepParseError: "This block could not be read, so nothing is written for it.",
  refUnresolved:
    "This points at something that is not on the board, so nothing is written for it.",
  unsupportedStep:
    "This version does not perform this kind of block — nothing is written for it.",
  mathRenderError:
    "This formula could not be written out; the board shows its raw text instead.",
  boardOverflow: "This runs past the right edge of the board and is cut off.",
  narrationClipMissing:
    "This step's recorded voice clip is missing on disk — it plays silent at its written pace; re-synthesize the clip to the quoted path.",
  regionCollision:
    "Two declarations stand on top of each other here — both are written, the later ink lies over the earlier.",
  regionBurst: REGION_BURST_SENTENCE,
  turnOnFullWall: TURN_ON_FULL_WALL_MESSAGE,
  turnUnderfilled:
    "This turns to a new board while the one it leaves is still mostly empty — the writing before it could have kept going.",
};

const HEADLINE: Record<FindingCode, string> = {
  stepParseError: "could not be read",
  refUnresolved: "point at something that is not on the board",
  unsupportedStep: "are not performed in this version",
  mathRenderError: "could not be written out",
  boardOverflow: "run past the right edge of the board",
  narrationClipMissing: "have a recorded voice clip missing on disk",
  regionCollision: "have declarations standing on top of each other",
  regionBurst: "stand taller than the space they were placed in",
  turnOnFullWall: "turn away from a wall with nothing clean left",
  turnUnderfilled: "leave a board that is still mostly empty",
};

// ── Reading the board ───────────────────────────────────────────────────────

/** Everything the board could not perform, in document order. */
export function collectFindings(
  lecture: Lecture,
  observations: BoardObservations,
): BoardFinding[] {
  const findings: BoardFinding[] = [];

  for (const issue of lecture.errors) {
    const ref = issue.step;
    // A block that failed carries its WHOLE source on the bad step; the
    // issue's own excerpt is only the offending row, which can leave out
    // the very thing that is wrong (a chart's name, say).
    const step = ref ? stepAt(lecture, ref) : null;
    const raw = step?.kind === "bad" ? step.raw : undefined;
    findings.push({
      code: issue.code,
      ...(ref ? { address: toAddress(ref) } : {}),
      message: SENTENCE[issue.code],
      ...quote(raw ?? issue.excerpt),
    });
  }

  // One finding per failed formula, addressed like every other finding —
  // "1 formula failed" with no address was the only verdict `check-board`
  // handed back that the agent could not act on.
  for (const ref of observations.mathErrors) {
    const step = stepAt(lecture, ref);
    findings.push({
      code: "mathRenderError",
      address: toAddress(ref),
      message: SENTENCE.mathRenderError,
      ...quote(step ? summarizeStep(step, EXCERPT_LIMIT) : undefined),
    });
  }
  const unplaced = observations.unplacedMathErrors ?? 0;
  if (unplaced > 0) {
    findings.push({
      code: "mathRenderError",
      message: `${unplaced} ${plural(
        unplaced,
        "formula",
        "formulas",
      )} could not be written out, in a place the board could not name; the board shows the raw text instead.`,
    });
  }

  for (const ref of observations.overflowing) {
    const step = stepAt(lecture, ref);
    findings.push({
      code: "boardOverflow",
      address: toAddress(ref),
      message: SENTENCE.boardOverflow,
      ...quote(step ? summarizeStep(step, EXCERPT_LIMIT) : undefined),
    });
  }

  // Ink aimed at writing an erase already took off the board (the fold's
  // orphans): the quote resolved, but its home is gone — nothing is
  // inked. Same code as an unmatched quote (it points at something that
  // is not on the board), its own sentence so the fix is obvious.
  for (const ref of observations.inkAfterErase ?? []) {
    const step = stepAt(lecture, ref);
    findings.push({
      code: "refUnresolved",
      address: toAddress(ref),
      message:
        "This aims at writing that has been erased from the board, so nothing is inked for it — write the content again on a standing board first if it still matters.",
      ...quote(step ? summarizeStep(step, EXCERPT_LIMIT) : undefined),
    });
  }

  // Two declarations standing on top of each other (§5.4). Named on the
  // LATER of the two — the one whose tail is still rewritable — with both
  // parties and the overlap quoted, and the three ways out spelled in the
  // message: erase one, rewrite the unplayed one under a different word,
  // or ignore it if the overlay is what you meant.
  for (const hit of observations.collisions ?? []) {
    const ref = parseStepKey(hit.b.key);
    const other = parseStepKey(hit.a.key);
    const flowInvolved = hit.a.region === "full" || hit.b.region === "full";
    findings.push({
      code: "regionCollision",
      ...(ref ? { address: toAddress(ref) } : {}),
      message: [
        `On board ${hit.panel + 1}, ${regionWord(hit.b.region)} overlaps ${regionWord(
          hit.a.region,
        )} by ${pct(hit.fraction)}% of the smaller one${
          other ? ` (§${other.section} step ${other.step < 0 ? 0 : other.step + 1})` : ""
        }.`,
        ...(flowInvolved ? [CLAIM_VS_INK_NOTE] : []),
        'Erase one of them (@erase "锚"), rewrite the unperformed one under a different region word, or leave it if writing over is what you meant.',
      ].join(" "),
      ...quote(
        ref && stepAt(lecture, ref)
          ? summarizeStep(stepAt(lecture, ref)!, EXCERPT_LIMIT)
          : undefined,
      ),
    });
  }

  // Content taller than the frame it was placed in (§4): reported, never
  // repaired — the region does not migrate and nothing is shrunk.
  for (const burst of observations.bursts ?? []) {
    const ref = parseStepKey(burst.key);
    findings.push({
      code: "regionBurst",
      ...(ref ? { address: toAddress(ref) } : {}),
      message: burstMessage(burst),
      ...quote(
        ref && stepAt(lecture, ref)
          ? summarizeStep(stepAt(lecture, ref)!, EXCERPT_LIMIT)
          : undefined,
      ),
    });
  }

  // A `@turn` that found nowhere clean to go (§5.5).
  for (const ref of observations.turnsOnFullWall ?? []) {
    findings.push({
      code: "turnOnFullWall",
      address: toAddress(ref),
      message: SENTENCE.turnOnFullWall,
    });
  }

  // A `@turn` that walked away from a board it had barely written on (W2).
  for (const turn of observations.turnsUnderfilled ?? []) {
    findings.push({
      code: "turnUnderfilled",
      address: toAddress(turn.ref),
      message: `This board is about ${Math.round(
        turn.fill * 100,
      )}% written on when the pen turns away. A board fills in columns — writing carries on at the top of the next column before it needs a new board. Keep going here, or say @turn later.`,
    });
  }

  // A recorded voice whose file is gone (M3) — the excerpt quotes the
  // manifest path so re-synthesis lands exactly where the entry points.
  for (const clip of observations.missingNarrationClips ?? []) {
    findings.push({
      code: "narrationClipMissing",
      address: toAddress(clip.ref),
      message: SENTENCE.narrationClipMissing,
      ...quote(clip.file),
    });
  }

  return findings;
}

/**
 * Which measured steps are wider than the space they have. Measurement is
 * the host's job (it owns the layout); this is only the verdict, so it can
 * be pinned without a layout engine. The tolerance absorbs sub-pixel
 * rounding — a 1px difference is not a board the user can see overflowing.
 */
export function overflowingRefs(
  measured: readonly { ref: StepRef; scrollWidth: number; clientWidth: number }[],
  tolerance = 2,
): StepRef[] {
  return measured
    .filter(
      (m) => m.clientWidth > 0 && m.scrollWidth - m.clientWidth > tolerance,
    )
    .map((m) => m.ref);
}

// ── `check-board` ───────────────────────────────────────────────────────────

export interface BoardCheckReport {
  ok: boolean;
  summary: string;
  findings: BoardFinding[];
}

/** The answer `check-board` hands back to the agent. */
export function reportBoardCheck(
  findings: readonly BoardFinding[],
): BoardCheckReport {
  if (findings.length === 0) {
    return {
      ok: true,
      summary:
        "Nothing on the board failed — everything you wrote is being written out.",
      findings: [],
    };
  }
  return {
    ok: false,
    summary: `${findings.length} ${plural(
      findings.length,
      "thing",
      "things",
    )} on the board did not come out as written.`,
    findings: [...findings],
  };
}

// ── The notification channel ────────────────────────────────────────────────

export interface NotificationDelta {
  notifications: ViewerNotification[];
  /** Signatures of everything currently reportable — feed back next time. */
  seen: Set<string>;
}

/**
 * What the board should say to the agent, given what it already said.
 *
 * Transitions only. An agent editing a board recompiles it dozens of times
 * per turn; one warning per rebuild would train it to ignore the channel.
 * A kind that has disappeared sends the queue's pure clear signal (info +
 * `replaces`) so a warning about a problem the agent already fixed can
 * never surface after the fact.
 */
export function deriveNotifications(
  seen: ReadonlySet<string>,
  findings: readonly BoardFinding[],
): NotificationDelta {
  const next = new Set<string>();
  const byCode = new Map<FindingCode, BoardFinding[]>();
  for (const finding of findings) {
    if (!NOTIFIED_CODES.includes(finding.code)) continue;
    next.add(signature(finding));
    const bucket = byCode.get(finding.code);
    if (bucket) bucket.push(finding);
    else byCode.set(finding.code, [finding]);
  }

  const notifications: ViewerNotification[] = [];
  for (const code of NOTIFIED_CODES) {
    const current = byCode.get(code) ?? [];
    const hadAny = [...seen].some((sig) => sig.startsWith(`${code}|`));
    if (current.length === 0) {
      // Fixed — retract whatever is still queued about it.
      if (hadAny) {
        notifications.push({
          type: code,
          severity: "info",
          message: `The board no longer has anything that ${HEADLINE[code]}.`,
          summary: "board is clear",
          replaces: [code],
        });
      }
      continue;
    }
    const isNew = current.some((f) => !seen.has(signature(f)));
    if (!isNew) continue;
    notifications.push({
      type: code,
      severity: "warning",
      message: warningText(code, current),
      summary: `${current.length} ${plural(
        current.length,
        "spot",
        "spots",
      )} ${HEADLINE[code]}`,
      // Fresher information supersedes an older queued warning of the same
      // kind — the agent should read the board as it is now, not as it was.
      replaces: [code],
    });
  }

  return { notifications, seen: next };
}

/**
 * `boardCollision` (design §5.5) — the push that took `boardAutoErased`'s
 * place when the room stopped retiring boards and started letting
 * declarations land on top of each other.
 *
 * Transition-detected on the PAIR, not on the step: the dedupe key is
 * `collision|panel|regionA|regionB` with the two region names sorted, so
 * appending a third paragraph into a column that already overlaps its
 * neighbour does not re-push. One aggregated notification per batch,
 * `replaces` itself, and it always ends by naming the two organs that can
 * actually answer "what does it look like".
 */
export function deriveCollisionNotification(
  seen: ReadonlySet<string>,
  collisions: readonly BoxCollision[],
): { notification: ViewerNotification | null; seen: Set<string> } {
  const next = new Set<string>();
  const fresh = new Map<string, BoxCollision>();
  for (const hit of collisions) {
    const key = collisionKey(hit);
    next.add(key);
    if (!seen.has(key) && !fresh.has(key)) fresh.set(key, hit);
  }
  if (fresh.size === 0) return { notification: null, seen: next };
  const lines = [...fresh.values()].map(
    (hit) =>
      `On board ${hit.panel + 1}, ${regionWord(hit.b.region)} now stands on ${regionWord(
        hit.a.region,
      )} (${pct(hit.fraction)}% of the smaller one).`,
  );
  return {
    notification: {
      type: "boardCollision",
      severity: "warning",
      message: [
        ...lines,
        "Both are written — nothing was moved and nothing was erased.",
        "Look (frame-board / glance-board) before your next append.",
      ].join("\n"),
      summary:
        fresh.size === 1
          ? "two declarations overlap"
          : `${fresh.size} pairs of declarations overlap`,
      replaces: ["boardCollision"],
    },
    seen: next,
  };
}

function warningText(
  code: FindingCode,
  findings: readonly BoardFinding[],
): string {
  const lines = findings.map(
    (f) => `  - ${formatAddress(f.address)}: ${f.excerpt ?? "(no text)"}`,
  );
  return [
    `${findings.length} ${plural(findings.length, "spot", "spots")} on the board ${HEADLINE[code]}:`,
    ...lines,
    "Edit board.md to fix them. The rest of the board keeps going either way.",
  ].join("\n");
}

/** Identity of one reportable problem — kind, place, and what is written. */
function signature(finding: BoardFinding): string {
  const { section, step } = finding.address ?? {};
  return `${finding.code}|${section ?? "-"}:${step ?? "-"}|${finding.excerpt ?? ""}`;
}

function quote(text: string | undefined): { excerpt?: string } {
  if (!text) return {};
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (!collapsed) return {};
  return {
    excerpt:
      collapsed.length > EXCERPT_LIMIT
        ? `${collapsed.slice(0, EXCERPT_LIMIT)}…`
        : collapsed,
  };
}

const plural = (n: number, one: string, many: string): string =>
  n === 1 ? one : many;

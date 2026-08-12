/**
 * The board snapshot (S1, board-snapshot design) — the canonical
 * timeline's THIRD projection: the existing assignment fold stopped at a
 * document position and read out. 板（播放态）· 笔记（导出态）·
 * **快照（状态态）**.
 *
 * `board-check.ts`'s twin, same discipline: pure, zero DOM, every word
 * lecture vocabulary, the render pinned to exact wording by tests. The
 * answer's size is bounded by the BOARD, not the lecture (§2): at any cut
 * each board holds at most one open run, so a 200-step lecture still
 * answers in a dozen lines.
 *
 * One computation, two consumers: the agent's `glance-board` action
 * (cut = end of document) and the human dashboard (cut = the playhead's
 * step, S2). The fold's own numbers are the authority throughout —
 * `occupancy` reads `BoardLayout.panels[].fill` verbatim (the SAME number
 * `turnUnderfilled` quotes; W9 made it one field so the two surfaces an
 * author reads minutes apart cannot disagree), and `pen.nextOverflow`
 * calls the SAME `nextOverflowTarget` the fold's overflow branch and
 * `@turn` run (§4.1 forbids a re-derivation on pain of copy-then-drift).
 * The only locally computed number is the roomSteps median — a HINT,
 * labelled as such.
 */

import type { ViewerNotification } from "../../../core/types/viewer-contract.js";
import {
  foldCharges,
  cleanBoardTarget,
  type BoardLayout,
  type LayoutStepInput,
} from "../engine/layout.js";
import { DEFAULT_REGION, regionSpan } from "../engine/regions.js";
import type { Lecture, StepRef } from "../engine/types.js";
import {
  parseStepKey,
  sectionTitle,
  stepAt,
  summarizeStep,
  toAddress,
  type BoardAddress,
} from "./address.js";

// ── The answer's shape (design §4.1, pinned to fields) ─────────────────────

export interface SnapshotSegment {
  /** Section index (0 = the opening). */
  section: number;
  /** The section's heading text (the opening: the lecture title), ≤ 40
   *  chars; "" when the section has no title of its own. */
  label: string;
  /**
   * Inclusive USER-FACING step range of this segment's standing content
   * steps (steps count from 1, the ViewerAddress convention), e.g.
   * [1, 6]. `[0, 0]` when the segment holds only the section's title.
   */
  steps: [from: number, to: number];
  /** section < tip.section — the lecture has moved past this section. */
  finished: boolean;
}

export interface SnapshotBoard {
  /** 0-based; rendered as "board 1..n". */
  panel: number;
  /** null when the board has standing content — in ANY region (W9: a face
   *  holding two `@at` pools and no flow run is not a blank face). */
  blank: "fresh" | "wiped" | null;
  /** Standing = every open run on the face — the room's flow AND each
   *  named region's — split per section, document order. */
  standing: SnapshotSegment[];
  /**
   * Closed runs so far: how many, how many the ROOM closed (auto-erase —
   * retirement the agent never expressed; rev 2), which sections they
   * held (deduped, pre-formatted as `§N "title"`), and how many steps
   * they held in total (the render's honest count).
   */
  erased: { runs: number; byAuto: number; sections: string[]; steps: number };
  /** Every standing segment finished AND the tip is not on this board. */
  dormant: boolean;
  /**
   * How full the board is (W9): `fraction` is `panels[].fill` — the share
   * of the face that STANDS WRITTEN ON, every claim counted once —
   * `usedPx` is that share as a depth of the face's `columns × budget`,
   * and `budgetPx` is null on the strip (no bottom, so no fraction; there
   * `usedPx` is the flow's charge, the only honest "how much is written").
   */
  occupancy: {
    usedPx: number;
    budgetPx: number | null;
    fraction: number | null;
  };
}

export interface BoardSnapshot {
  boards: SnapshotBoard[];
  /** Where the NEXT stroke lands — the fold's current panel. Fact, not
   *  promise: the next step's height is unknowable, so roomSteps is a
   *  hint. */
  pen: {
    panel: number;
    roomSteps: number | null;
    /**
     * (rev 2) What the ROOM will do when the pen's board fills — the
     * fold's own three-tier overflow policy read out on the CURRENT
     * panel states. Deterministic, zero candidate input: perception of
     * standing policy, never a prediction about any particular block
     * (§7.5). null on the single strip (it never overflows).
     */
    nextOverflow:
      | { kind: "fresh" | "wiped"; panel: number }
      /** No clean board left. The room has nothing to give and does not
       *  choose a victim (design §7.3) — retiring is the author's to say. */
      | { kind: "full-wall" }
      | null;
  };
  /** The last CONTENT step written (never camera/erase/wait/board-config). */
  tip: { address: BoardAddress; excerpt: string; panel: number } | null;
  basis: {
    /** Fold-relevant steps this answer covers. */
    steps: number;
    /** "catching-up": the compile (or the on-disk file) is ahead. */
    measured: "complete" | "catching-up";
  };
}

/** Tip excerpts reuse the schedule-summary width (`summarizeStep`, 70). */
const TIP_EXCERPT = 70;
/** Section labels stay anchors, never paragraphs. */
const LABEL_LIMIT = 40;

/** The answer for a board that does not exist yet (mirrors check-board's
 *  empty branch — success, honestly empty). */
export function emptyBoardSnapshot(): BoardSnapshot {
  return {
    boards: [],
    pen: { panel: 0, roomSteps: null, nextOverflow: null },
    tip: null,
    basis: { steps: 0, measured: "complete" },
  };
}

// ── The projection ─────────────────────────────────────────────────────────

/** `§N "title"` — the one way this module names a section. */
function sectionName(lecture: Lecture, section: number): string {
  const title = sectionTitle(lecture, section);
  const label =
    title.length > LABEL_LIMIT ? `${title.slice(0, LABEL_LIMIT)}…` : title;
  return label ? `§${section} "${label}"` : `§${section}`;
}

/**
 * Every step STANDING on each board, document order — from EVERY open run
 * on the face (W9), not the room's flow alone.
 *
 * A board's flow is one run; each named region an `@at` opened is another.
 * Reading only `panels[].standingRun` was the second half of the same
 * blindness `panels[].fill` fixed: a board composed entirely of `@at`
 * placements had no flow run at all, so the glance called it "blank
 * (wiped)" — and `renderSnapshot` short-circuits on `blank`, which would
 * have swallowed the corrected occupancy on exactly the boards that need
 * it.
 *
 * Document order comes from walking `inputs` rather than concatenating
 * runs: two regions interleave in the source, and their runs do not. Home
 * placements (a container layer, a back reference) carry their home's
 * assignment, so they join their frame's board here exactly as they did
 * when this read the run's own member list; an orphan has no assignment
 * and joins nothing.
 */
function standingKeysPerBoard(
  layout: BoardLayout,
  inputs: readonly LayoutStepInput[],
  cut: number,
): string[][] {
  const perBoard: string[][] = layout.panels.map(() => []);
  const openRuns = new Map<string, number>();
  for (let p = 0; p < layout.panels.length; p++) {
    openRuns.set(layout.panels[p]!.standingRun, p);
  }
  for (const region of layout.regions.values()) {
    if (!region.standingRun) continue;
    openRuns.set(region.standingRun, region.panel);
  }
  for (let i = 0; i < cut; i++) {
    const input = inputs[i]!;
    if (input.kind !== "content") continue;
    const assignment = layout.assignments.get(input.key);
    if (!assignment) continue;
    if (openRuns.get(assignment.run) !== assignment.panel) continue;
    perBoard[assignment.panel]?.push(input.key);
  }
  return perBoard;
}

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/**
 * Derive the snapshot from a fold the caller already ran (`layout` MUST be
 * the fold of `inputs` at `cutIndex` — the caller owns that pairing; the
 * glance runner folds fresh from `readSnapshotBasis`, the S2 dashboard
 * will fold at the playhead's step). `measured` is the honesty marker the
 * runner sets (§6): "catching-up" when the answer is known to trail the
 * on-disk board.
 */
export function deriveBoardSnapshot(
  lecture: Lecture,
  layout: BoardLayout,
  inputs: readonly LayoutStepInput[],
  budget: number,
  measured: BoardSnapshot["basis"]["measured"] = "complete",
  cutIndex?: number,
): BoardSnapshot {
  const cut = Math.min(cutIndex ?? inputs.length, inputs.length);
  const charges = foldCharges(inputs);

  // The tip: the last content step within the cut that actually landed on
  // a board (an orphan never landed — it cannot be "the last thing
  // written" on any board face).
  let tip: BoardSnapshot["tip"] = null;
  let tipRef: StepRef | null = null;
  for (let i = cut - 1; i >= 0; i--) {
    const input = inputs[i]!;
    if (input.kind !== "content") continue;
    const assignment = layout.assignments.get(input.key);
    const ref = parseStepKey(input.key);
    if (!assignment || !ref) continue;
    const step = stepAt(lecture, ref);
    if (!step) continue;
    tipRef = ref;
    tip = {
      address: toAddress(ref),
      excerpt: summarizeStep(step, TIP_EXCERPT),
      panel: assignment.panel,
    };
    break;
  }

  const standingKeysOf = standingKeysPerBoard(layout, inputs, cut);

  const boards: SnapshotBoard[] = layout.panels.map((panel, p) => {
    const standingKeys = standingKeysOf[p] ?? [];

    // Split the open run into per-section segments, document order.
    const standing: SnapshotSegment[] = [];
    for (const key of standingKeys) {
      const ref = parseStepKey(key);
      if (!ref) continue;
      const userStep = ref.step < 0 ? 0 : ref.step + 1;
      const last = standing[standing.length - 1];
      if (last && last.section === ref.section) {
        // The range covers CONTENT steps; a title-only segment ([0, 0])
        // upgrades to the first content step's range (the title's
        // standing-ness is already implied by the segment's label).
        last.steps =
          last.steps[1] === 0
            ? [userStep, userStep]
            : [Math.min(last.steps[0], userStep), Math.max(last.steps[1], userStep)];
        continue;
      }
      const title = sectionTitle(lecture, ref.section);
      standing.push({
        section: ref.section,
        label:
          title.length > LABEL_LIMIT
            ? `${title.slice(0, LABEL_LIMIT)}…`
            : title,
        steps: [userStep, userStep],
        finished: tipRef !== null && ref.section < tipRef.section,
      });
    }

    // Closed runs on this board (an explicit erase of an empty board
    // closed nothing — run "" is excluded).
    let runs = 0;
    // The room synthesizes no erases any more (design §2.3), so every one
    // of them is an author's `@erase`. Kept at zero rather than deleted
    // here: the field's own death belongs to the §10.1 glance reshape.
    const byAuto = 0;
    let erasedSteps = 0;
    const erasedSections: string[] = [];
    for (const op of layout.eraseOps) {
      if (op.panel !== p || op.run === "") continue;
      runs++;
      erasedSteps += op.targets.length;
      for (const key of op.targets) {
        const ref = parseStepKey(key);
        if (!ref) continue;
        const name = sectionName(lecture, ref.section);
        if (!erasedSections.includes(name)) erasedSections.push(name);
      }
    }

    // "Blank" is the FOLD's own predicate (`panels[].empty` — nothing
    // standing in ANY region), not "the flow's run is empty": a board
    // holding two `@at` pools is not a blank board, and saying so was the
    // sentence that hid its occupancy (W9).
    const blank: SnapshotBoard["blank"] = !panel.empty
      ? null
      : panel.opened
        ? "wiped"
        : "fresh";
    // W2 — a board's flow capacity is `columns x budget`: the room fills a
    // face in columns now, so the denominator occupancy is a fraction OF
    // grew with it. One column reproduces the pre-W2 number exactly.
    const budgetPx = Number.isFinite(budget) ? budget * layout.columns : null;
    return {
      panel: p,
      blank,
      standing,
      erased: { runs, byAuto, sections: erasedSections, steps: erasedSteps },
      dormant:
        standing.length > 0 &&
        standing.every((s) => s.finished) &&
        tip?.panel !== p,
      occupancy: {
        // W9 — the depth of face the writing COVERS, every claim on it
        // counted once (`panels[].fill`), not the flow's charge alone.
        // On a face whose ink is all in the room's own flow this is
        // `panel.cursor` to the last pixel, which is why the number a
        // reader has been looking at does not jump. The strip has no
        // fraction to be a depth of, so there the charge is the honest
        // answer to "how much is written".
        usedPx: budgetPx !== null ? panel.fill * budgetPx : panel.cursor,
        budgetPx,
        fraction: budgetPx !== null ? panel.fill : null,
      },
    };
  });

  // roomSteps — the median-unit HINT (§4.1): the pen board's standing
  // charges first, every standing step on the wall as the fallback.
  const penPanel = layout.cur;
  let roomSteps: number | null = null;
  if (Number.isFinite(budget)) {
    const chargesOf = (p: number): number[] =>
      (standingKeysOf[p] ?? [])
        .map((key) => charges.get(key))
        .filter((c): c is number => c !== undefined && c > 0);
    let unit = median(chargesOf(penPanel));
    if (unit === null) {
      unit = median(layout.panels.flatMap((_, p) => chargesOf(p)));
    }
    if (unit !== null) {
      // THE ROOM THE PEN ACTUALLY HAS (W9). Standing in the room's own
      // flow, the pen may use whatever of the FACE is still bare — which
      // is `fill`'s complement, so ink an `@at` put in a corner shortens
      // this answer instead of being invisible to it. Standing in a named
      // frame, the pen has that FRAME's remaining depth and no more: the
      // frame does not migrate, so the face's spare room is not the pen's
      // to promise.
      const penRegion =
        layout.pen.region === DEFAULT_REGION
          ? null
          : layout.regions.get(`${penPanel}:${layout.pen.region}`);
      const span = penRegion ? regionSpan(penRegion.name) : null;
      const remaining =
        penRegion && span
          ? budget * (span.y1 - span.y0) - penRegion.cursor
          : (1 - layout.panels[penPanel]!.fill) * budget * layout.columns;
      roomSteps =
        remaining > 0 && unit > 0 ? Math.floor(remaining / unit) : 0;
    }
  }

  // nextOverflow — the SAME exported policy the fold and @turn run
  // (`cleanBoardTarget`). Its third tier died with auto-erase, so the
  // room can no longer name a victim: a full wall is `full-wall`, and
  // retiring something is the AUTHOR's to say (design §7.3/§10.1).
  let nextOverflow: BoardSnapshot["pen"]["nextOverflow"] = null;
  if (layout.count > 1) {
    const target = cleanBoardTarget(layout.panels);
    nextOverflow = target
      ? { kind: target.kind, panel: target.panel }
      : { kind: "full-wall" };
  }

  return {
    boards,
    pen: { panel: penPanel, roomSteps, nextOverflow },
    tip,
    basis: { steps: cut, measured },
  };
}

// THE AUTO-ERASE NOTIFICATION IS GONE (design §2.3/§5.5 — 2026-08-11).
// `boardAutoErased` existed because the room could retire a board the
// agent never asked it to: the one event where not looking up corrupted
// its map of what is anchorable. The room no longer retires anything, so
// the event cannot occur and the push has nothing to push. Its successor
// in the same slot — the event that IS newly worth a push, because the
// room now lets declarations land on top of each other — is
// `boardCollision` (design §5.5), which lives with the collision pass.

// ── The render (design §4.3 — tests pin the exact wording) ─────────────────

const pct = (fraction: number): number => Math.round(fraction * 100);

/** "full" once the board reads as full to a glance; the exact % otherwise.
 *  A board a @turn abandoned half-way honestly shows its number. */
const occupancyWord = (fraction: number): string =>
  fraction >= 0.95 ? "full" : `${pct(fraction)}%`;

const times = (n: number): string =>
  n === 1 ? "once" : n === 2 ? "twice" : `${n} times`;

function segmentText(seg: SnapshotSegment): string {
  const name = seg.label ? `§${seg.section} "${seg.label}"` : `§${seg.section}`;
  const range =
    seg.steps[0] === 0 && seg.steps[1] === 0
      ? "title standing"
      : seg.steps[0] === seg.steps[1]
        ? `step ${seg.steps[0]} standing`
        : `steps ${seg.steps[0]}–${seg.steps[1]} standing`;
  return `${name} ${range}`;
}

/** The action's `message` — the exact text the agent reads. */
export function renderSnapshot(snapshot: BoardSnapshot): string {
  const lines: string[] = [];
  const { pen, boards, tip, basis } = snapshot;
  const strip =
    boards.length === 1 && boards[0]!.occupancy.budgetPx === null;

  // 1 — where the pen is.
  if (strip) {
    lines.push("The pen is on the long strip — it never runs out.");
  } else {
    const fraction = boards[pen.panel]?.occupancy.fraction ?? 0;
    const room =
      pen.roomSteps === null
        ? ""
        : pen.roomSteps === 0
          ? ", no room for another step like the ones standing"
          : `, room for ~${pen.roomSteps} more ${pen.roomSteps === 1 ? "step" : "steps"} like the ones standing`;
    lines.push(
      `The pen is on board ${pen.panel + 1} — ${pct(fraction)}% used${room}.`,
    );
  }

  // 2 — what the room will do next (rev 2).
  if (pen.nextOverflow) {
    const nx = pen.nextOverflow;
    if (nx.kind === "full-wall") {
      lines.push(
        "The wall is full — nothing clean to give; retiring is yours to say.",
      );
    } else {
      lines.push(
        `If board ${pen.panel + 1} fills, writing continues on board ${nx.panel + 1} (blank, ${nx.kind}).`,
      );
    }
  }

  // 3 — one line per board.
  for (const board of boards) {
    const n = board.panel + 1;
    if (board.blank !== null) {
      lines.push(`board ${n} — blank (${board.blank})`);
      continue;
    }
    const parts: string[] = [];
    if (board.occupancy.fraction !== null) {
      parts.push(occupancyWord(board.occupancy.fraction));
    }
    parts.push(...board.standing.map(segmentText));
    if (board.panel === pen.panel) parts.push("current");
    else if (board.dormant) parts.push("finished");
    lines.push(`board ${n} — ${parts.join(" · ")}`);
  }

  // 4 — the erasure ledger (only when something was erased).
  const erasedParts: string[] = [];
  for (const board of boards) {
    const e = board.erased;
    if (e.runs === 0) continue;
    const byRoom =
      e.byAuto === e.runs
        ? `${times(e.runs)} by the room`
        : e.byAuto > 0
          ? `${times(e.runs)} (${e.byAuto} by the room)`
          : times(e.runs);
    erasedParts.push(
      `board ${board.panel + 1}, ${byRoom} (${e.sections.join(", ")}, ${e.steps} steps)`,
    );
  }
  if (erasedParts.length > 0) {
    lines.push(`Erased so far: ${erasedParts.join("; ")}.`);
  }

  // 5 — the tip (the §6 backstop: "check the tip echoes your append").
  if (tip) {
    const where =
      tip.address.step === undefined
        ? `§${tip.address.section}`
        : `§${tip.address.section} step ${tip.address.step}`;
    lines.push(`Tip: ${where} "${tip.excerpt}" — the last thing written.`);
  }

  // 6 — the honesty line (§6: the answer never lies).
  lines.push(
    basis.measured === "complete"
      ? `This answers all ${basis.steps} steps of board.md, measured.`
      : "The board is still catching up to board.md — this answers what is standing now; ask again in a moment for the tail.",
  );

  return lines.join("\n");
}

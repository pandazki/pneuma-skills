/**
 * `<viewer-context>` (§8, direction ⑥) — what the agent is told when the
 * user points at the board and says "this bit".
 *
 * The product decision this mode is built around is that the user does NOT
 * write the dialect: they point at the board and talk. So this block is
 * the mode's core contract, not decoration. It has to answer, in the
 * lecture's own words, four questions the agent cannot otherwise answer:
 * WHICH step (a machine handle it can hand straight back to
 * `navigate-to` / `capture` / `<viewer-locator>`), WHAT it says (a
 * readable anchor — an index alone leaves the agent guessing), WHERE the
 * board is right now, and WHETHER that step has been written yet (the user
 * may well be pointing at something the board has not reached).
 *
 * Called once per user message, from `pneuma-mode.ts::extractContext`. The
 * lecture is re-parsed HERE rather than reused from the viewer: the agent
 * may have appended to the board between the click and the send, and the
 * agent needs the board as it is now. That is also why a stale address
 * degrades loudly (see below) instead of resolving to whatever step now
 * sits at those coordinates.
 *
 * Pure: parse + string building, no DOM, no React. The board's live
 * position arrives as a plain `BoardMoment` snapshot.
 */

import type {
  ViewerCommandDescriptor,
  ViewerFileContent,
  ViewerNotification,
  ViewerSelectionContext,
} from "../../../core/types/viewer-contract.js";
import { parseLecture } from "../domain.js";
import type { StepSchedule } from "../engine/types.js";
import {
  describeStep,
  formatAddress,
  resolveAddress,
  revealStatus,
  sectionSize,
  sectionTitle,
  stepAt,
  stepWindow,
  summarizeStep,
  toAddress,
  type BoardAddress,
} from "./address.js";

/** Where the board is, as of the moment the user pressed send. */
export interface BoardMoment {
  /** Canonical playhead, seconds. */
  t: number;
  /** Canonical total, seconds. */
  duration: number;
  follow: "live" | "detached";
  playing: boolean;
  schedule: readonly StepSchedule[];
}

/** How each reveal status reads to someone watching the board. */
const STATUS_WORDS = {
  shown: "already written on the board",
  showing: "being written right now",
  upcoming: "not written yet",
  "never written": "never written — this version does not perform it",
} as const;

export function buildViewerContext(
  selection: ViewerSelectionContext | null,
  files: readonly ViewerFileContent[],
  moment: BoardMoment | null,
): string {
  const described = describeSituation(selection, files, moment);
  if (!described) return "";
  return [
    `<viewer-context mode="bansho" file="${described.file}">`,
    ...described.lines,
    "</viewer-context>",
  ].join("\n");
}

/**
 * A command button press (①→⑥). The notification flushes as a SYSTEM
 * message, which never carries a `<viewer-context>` prefix — so the whole
 * situation has to travel inside the message itself, or the agent is asked
 * to "say this part again" with no idea which part.
 */
export function buildCommandNotification(
  command: ViewerCommandDescriptor,
  selection: ViewerSelectionContext | null,
  files: readonly ViewerFileContent[],
  moment: BoardMoment | null,
): ViewerNotification {
  const described = describeSituation(selection, files, moment);
  const lines = [`The user pressed "${command.label}" on the board.`];
  if (described) lines.push(...described.lines);
  if (command.description) lines.push("", command.description);
  return {
    type: "banshoCommand",
    // "warning" is the protocol's "actually deliver this to the agent"
    // level; "info" is log-only, which would swallow the request.
    severity: "warning",
    summary: command.label,
    message: lines.join("\n"),
  };
}

/**
 * What the shell is told the user picked (direction ⑥). One builder so the
 * chat chip, the ask bar and `extractContext` all name the same step the
 * same way — and so `address` is never forgotten, which is the one field
 * that makes select → point → capture close.
 *
 * `file` is the content-set-relative board path, matching what `src/ws.ts`
 * hands `extractContext` and re-prefixes on the way out.
 */
export function selectionForStep(
  lecture: ReturnType<typeof parseLecture>,
  ref: { section: number; step: number },
): ViewerSelectionContext | null {
  const step = stepAt(lecture, ref);
  if (!step) return null;
  const address = toAddress(ref);
  return {
    type: describeStep(step),
    content: summarizeStep(step),
    file: "board.md",
    address,
    label: `${formatAddress(address)} — ${describeStep(step)}`,
  };
}

/** The shared body: what is on the board, where it is, what is pointed at. */
function describeSituation(
  selection: ViewerSelectionContext | null,
  files: readonly ViewerFileContent[],
  moment: BoardMoment | null,
): { file: string; lines: string[] } | null {
  const board = files.find(
    (f) => f.path === "board.md" || f.path.endsWith("/board.md"),
  );
  if (!board) return null;

  const lecture = parseLecture(board.content);
  const lines: string[] = [describeBoard(lecture, moment)];
  if (moment) lines.push(describeMoment(moment));

  const pointed = selection?.address as BoardAddress | undefined;
  const clicked = (selection?.content ?? "").trim();
  if (pointed) {
    const ref = resolveAddress(lecture, pointed);
    const step = ref ? stepAt(lecture, ref) : null;
    if (ref && step) {
      lines.push(
        `Pointing at: ${describeStep(step)} — "${summarizeStep(step)}"`,
        // The exact handle to hand back — copy it verbatim into
        // `navigate-to`, `capture`, or a <viewer-locator> card.
        `Address: ${JSON.stringify(toAddress(ref))}`,
        `Where: ${whereLine(lecture, ref)}`,
      );
      if (moment) lines.push(`Status: ${statusLine(moment, ref)}`);
    } else {
      // The board moved under the user's click (an append or an edit
      // between clicking and sending). Naming whatever step now sits at
      // those coordinates would be a confident lie, so say what happened
      // and hand over the only anchor that survives: the words.
      if (clicked) lines.push(`Pointing at: "${clicked}"`);
      lines.push(
        `Note: the step the user clicked (${formatAddress(pointed)}) is no longer on the board — it was edited or removed since the click. Search board.md for those words instead of trusting the position.`,
      );
    }
  } else if (clicked) {
    lines.push(`Pointing at: "${clicked}"`);
  }

  return { file: board.path, lines };
}

/** One line about the board as a whole — what is up there at all. */
function describeBoard(
  lecture: ReturnType<typeof parseLecture>,
  moment: BoardMoment | null,
): string {
  const sections = lecture.sections.length;
  const steps = lecture.sections.reduce(
    (n, s) => n + (s.heading ? 1 : 0) + s.steps.length,
    0,
  );
  const size = `${sections} ${plural(sections, "section", "sections")}, ${steps} ${plural(steps, "step", "steps")}`;
  const long = moment ? `, ${moment.duration.toFixed(1)}s of lecture` : "";
  return `Board: "${lecture.title}" — ${size}${long}.`;
}

/** One line about where the board is and who is driving it. */
function describeMoment(moment: BoardMoment): string {
  const state = moment.playing ? "playing" : "paused";
  const mode =
    moment.follow === "live"
      ? "following the live board"
      : "the user moved the playhead here themselves";
  return `Playhead: ${moment.t.toFixed(1)}s of ${moment.duration.toFixed(1)}s, ${state}, ${mode}.`;
}

/** Which section and which step within it — said the way a person would. */
function whereLine(
  lecture: ReturnType<typeof parseLecture>,
  ref: { section: number; step: number },
): string {
  const address = toAddress(ref);
  const title = sectionTitle(lecture, ref.section);
  const named = title ? `${formatAddress(address)} "${title}"` : formatAddress(address);
  if (ref.step < 0) return named;
  const total = sectionSize(lecture, ref.section);
  return `${named}, ${address.step} of ${total}`;
}

/** Whether the board has written this step yet, and when it does. */
function statusLine(
  moment: BoardMoment,
  ref: { section: number; step: number },
): string {
  const status = revealStatus(moment.schedule, ref, moment.t);
  const words = STATUS_WORDS[status];
  const window = stepWindow(moment.schedule, ref);
  if (!window) return words;
  if (status === "shown") return `${words} (finished at ${window.end.toFixed(1)}s)`;
  if (status === "upcoming") {
    return `${words} — the board gets there at ${window.start.toFixed(1)}s`;
  }
  return words;
}

const plural = (n: number, one: string, many: string): string =>
  n === 1 ? one : many;

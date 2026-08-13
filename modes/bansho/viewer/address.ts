/**
 * The ViewerAddress vocabulary (§8) — how a place on the board is named,
 * and how the board describes that place in words.
 *
 * `{ contentSet?, section?, step? }` and nothing else. The whole point is
 * that a user, an agent and the board can all say "that step" and mean the
 * same thing, so every word this module produces is LECTURE vocabulary —
 * what a person watching would call it. How the board draws it is the
 * board's private business and never surfaces here.
 *
 * Counting: `section` starts at 0 (the opening, before the first `##`) and
 * `step` starts at 1, which is what a reader would say. The engine's
 * `StepRef` counts steps from 0 and uses `-1` for the section's own title,
 * so this module owns that mapping in both directions — it exists nowhere
 * else.
 *
 * Pure: no DOM, no React, no clock. The board's live position enters
 * through `revealStatus(schedule, ref, t)` as a plain number.
 */

import type { ViewerAddress } from "../../../core/types/viewer-contract.js";
import { stepPlainText } from "../engine/text.js";
import type {
  ChartLayerRow,
  Lecture,
  Step,
  StepRef,
  StepSchedule,
} from "../engine/types.js";

/**
 * A place on the board. `contentSet` is the framework's own key; the other
 * two are ours.
 *
 * The framework resolves `contentSet` on ONE channel only — a
 * `<viewer-locator>` card, and `capture`, go through
 * `store::setNavigateRequest`, which switches the active set and hands this
 * mode the rest of the address. An agent-invoked action does NOT: its
 * params arrive verbatim, so an action reading `section`/`step` while
 * ignoring `contentSet` would act on whichever board is open and report
 * success. See `foreignSet` — that is refused, not guessed.
 */
export interface BoardAddress extends ViewerAddress {
  contentSet?: string;
  section?: number;
  step?: number;
}

/**
 * The board an address names, when that is NOT the board being watched —
 * `null` when the address is about the open board (the ordinary case).
 *
 * Lenient in the two ways an agent-input boundary should be: a missing or
 * empty `contentSet` means "the board the user is watching", and a trailing
 * slash is forgiven (the seed catalogue writes directories as `tech-zh/`,
 * and that is the shape an agent copies).
 */
export function foreignSet(
  address: ViewerAddress | null | undefined,
  openSet: string | null | undefined,
): string | null {
  if (!address || typeof address !== "object") return null;
  const named = (address as BoardAddress).contentSet;
  if (typeof named !== "string") return null;
  const wanted = trimSlashes(named);
  if (!wanted) return null;
  return wanted === trimSlashes(openSet ?? "") ? null : wanted;
}

const trimSlashes = (key: string): string => key.replace(/^\/+|\/+$/g, "");

// ── Naming a place ──────────────────────────────────────────────────────────

/**
 * The engine address as a DOM-safe key. One format serves two jobs: the
 * host's per-step maps, and the `data-bansho-ref` attribute a click is
 * resolved through. Sharing it is the point — a click and a lookup that
 * disagreed about the format would report the wrong step.
 */
export function stepKey(ref: StepRef): string {
  return `${ref.section}:${ref.step}`;
}

/**
 * The inverse. `null` for anything that is not a well-formed key —
 * strictly, because `Number("")` is 0: a truncated key like `"1:"` read
 * loosely would resolve to a real step and report the wrong one.
 */
const KEY_PART = /^-?\d+$/;
export function parseStepKey(key: string | null | undefined): StepRef | null {
  if (!key) return null;
  const parts = key.split(":");
  if (parts.length !== 2) return null;
  if (!KEY_PART.test(parts[0]!) || !KEY_PART.test(parts[1]!)) return null;
  const section = Number(parts[0]);
  const step = Number(parts[1]);
  if (section < 0 || step < -1) return null;
  return { section, step };
}

/** Engine address → the address the user and the agent speak. */
export function toAddress(ref: StepRef): BoardAddress {
  return ref.step < 0
    ? { section: ref.section }
    : { section: ref.section, step: ref.step + 1 };
}

/**
 * The address the user and the agent speak → an engine address, checked
 * against the board that actually exists.
 *
 * Returns `null` rather than clamping: an address pointing past the end of
 * the board is a mistake worth reporting back, and silently landing on the
 * nearest neighbour would make the agent think it navigated somewhere it
 * did not. Lenient in exactly one direction (this is an agent-input
 * boundary): `step` omitted, or `step: 0`, both mean the section's title,
 * and a section with no title of its own falls back to its first step.
 */
export function resolveAddress(
  lecture: Lecture,
  address: ViewerAddress | null | undefined,
): StepRef | null {
  if (!address || typeof address !== "object") return null;
  const rawSection = (address as BoardAddress).section;
  if (!Number.isInteger(rawSection)) return null;
  const section = rawSection as number;
  if (section < 0 || section >= lecture.sections.length) return null;
  const target = lecture.sections[section]!;

  const rawStep = (address as BoardAddress).step;
  if (rawStep === undefined || rawStep === null || rawStep === 0) {
    if (target.heading) return { section, step: -1 };
    return target.steps.length > 0 ? { section, step: 0 } : null;
  }
  if (!Number.isInteger(rawStep)) return null;
  const step = (rawStep as number) - 1;
  if (step < 0 || step >= target.steps.length) return null;
  return { section, step };
}

/** The step a resolved address points at, or `null` when it points nowhere. */
export function stepAt(lecture: Lecture, ref: StepRef): Step | null {
  const section = lecture.sections[ref.section];
  if (!section) return null;
  return ref.step < 0 ? (section.heading ?? null) : (section.steps[ref.step] ?? null);
}

/** How many steps a section holds, title included — for "step 3 of 9". */
export function sectionSize(lecture: Lecture, section: number): number {
  return lecture.sections[section]?.steps.length ?? 0;
}

/** The section's own title text, when it has one. */
export function sectionTitle(lecture: Lecture, section: number): string {
  const heading = lecture.sections[section]?.heading;
  return heading ? stepPlainText(heading).trim() : "";
}

/**
 * A place on the board, said the way a person would say it. Section 0 is
 * "the opening" — calling it "section 0" would be the one place this
 * vocabulary leaks an index the user never counted.
 */
export function formatAddress(address: BoardAddress | undefined): string {
  if (!address || address.section === undefined) return "the board";
  const where =
    address.section === 0 ? "the opening" : `section ${address.section}`;
  return address.step === undefined
    ? `${where} (its title)`
    : `${where}, step ${address.step}`;
}

// ── Describing a place ──────────────────────────────────────────────────────

/**
 * The words the board uses for what kind of step something is. Lecture
 * vocabulary throughout — a person watching would say "a side note", never
 * anything about how it arrives on the board.
 */
export const EXPLAIN_KINDS = [
  "section title",
  "narration",
  "point in a list",
  "side note",
  "topic break",
  "chart",
  "addition to a chart",
  "diagram",
  "addition to a diagram",
  "formula",
  "picture",
  "embedded block",
  "pause",
  "camera move",
  "board erase",
  "turn to the next board",
  "placement",
  "stage setup",
  "emphasis on earlier writing",
  "correction of earlier writing",
  "unreadable block",
] as const;

export type ExplainKind = (typeof EXPLAIN_KINDS)[number];

/** What kind of step this is, in the words the lecture uses. */
export function describeStep(step: Step): ExplainKind {
  switch (step.kind) {
    case "heading":
      return "section title";
    case "prose":
      return "narration";
    case "list-item":
      return "point in a list";
    case "aside":
      return "side note";
    case "rule":
      return "topic break";
    case "chart-frame":
      return "chart";
    case "chart-layer":
      return "addition to a chart";
    case "graph-frame":
      return "diagram";
    case "graph-layer":
      return "addition to a diagram";
    case "math":
      return "formula";
    case "image":
      return "picture";
    case "html":
      return "embedded block";
    case "wait":
      return "pause";
    case "camera":
      return "camera move";
    case "erase":
      return "board erase";
    case "turn":
      return "turn to the next board";
    case "at":
      return "placement";
    case "board-config":
      return "stage setup";
    case "backref":
      return step.action === "strike"
        ? "correction of earlier writing"
        : "emphasis on earlier writing";
    case "bad":
      return "unreadable block";
  }
}

/** Longest summary handed to the agent — a readable anchor, not the text. */
const SUMMARY_LIMIT = 120;

/**
 * What the step says, as a person would read it back: an anchor the agent
 * can match against `board.md` without counting steps itself (T6-review —
 * "光有 index 不够，要有可读的内容摘要"). Dialect marks are stripped: the
 * agent wrote them, but they are not what the board shows.
 */
export function summarizeStep(step: Step, limit = SUMMARY_LIMIT): string {
  return cut(rawSummary(step), limit);
}

function rawSummary(step: Step): string {
  switch (step.kind) {
    case "heading":
    case "prose":
    case "list-item":
    case "aside":
      return collapse(stepPlainText(step));
    case "rule":
      return "— a break between topics —";
    case "chart-frame": {
      const parts = [step.chart, ...rowNames(step.rows)];
      const axes = [step.x?.unit, step.y?.unit].filter(Boolean).join(" / ");
      return collapse(
        axes ? `${parts.join(", ")} (${axes})` : parts.join(", "),
      );
    }
    case "chart-layer":
      return collapse([step.chart, ...rowNames(step.rows)].join(", "));
    case "graph-frame":
    case "graph-layer":
      return collapse(
        [
          step.graph,
          ...step.nodes.map((n) => n.name),
          ...step.edges.map((e) => `${e.from} → ${e.to}`),
        ].join(", "),
      );
    case "math":
      return collapse(step.tex);
    case "image":
      return collapse(step.alt || step.src);
    case "html":
      return collapse(step.html);
    case "wait":
      return step.seconds === undefined
        ? "a moment of silence"
        : `${step.seconds}s of silence`;
    case "camera":
      return step.op === "focus"
        ? collapse(`the camera turns to "${step.targetText ?? ""}"`)
        : "the camera steps back for an overview";
    case "erase":
      return step.targetText === undefined
        ? "the board under the pen is erased"
        : collapse(`the board holding "${step.targetText}" is erased`);
    case "turn":
      return "the pen turns to the next board";
    case "at":
      return step.targetText === undefined
        ? `the pen moves to the ${step.region} of the board`
        : collapse(
            `the pen moves to the ${step.region} where "${step.targetText}" stands`,
          );
    case "board-config":
      return step.count === 1
        ? "one long board"
        : `${step.count} boards side by side`;
    case "backref":
      return collapse(`"${step.targetText}"`);
    case "bad":
      return collapse(step.raw || step.reason);
  }
}

/** The named things a chart block adds — series, marks, notes. */
function rowNames(rows: readonly ChartLayerRow[]): string[] {
  return rows.map((row) =>
    row.kind === "series" ? row.name : row.kind === "mark" ? row.text : row.text,
  );
}

const collapse = (text: string): string => text.replace(/\s+/g, " ").trim();

const cut = (text: string, limit: number): string =>
  text.length > limit ? `${text.slice(0, limit)}…` : text;

// ── Where a place sits in time ──────────────────────────────────────────────

/**
 * Reveal status in the words the user would use.
 *
 * `"never written"` is the honest fourth state §8's three do not cover: a
 * picture, an embedded block, an unreadable block and an explicit pause
 * occupy space (or time) on the board but nothing is ever written for
 * them. Calling those "upcoming" would be a status that never resolves —
 * the agent would wait for a moment that cannot arrive.
 */
export type RevealStatus = "shown" | "showing" | "upcoming" | "never written";

/** When a step starts and finishes being written, in canonical seconds. */
export function stepWindow(
  schedule: readonly StepSchedule[],
  ref: StepRef,
): { start: number; end: number } | null {
  let start = Infinity;
  let end = -Infinity;
  for (const entry of schedule) {
    if (entry.step.section !== ref.section || entry.step.step !== ref.step) {
      continue;
    }
    if (entry.start < start) start = entry.start;
    if (entry.end > end) end = entry.end;
  }
  return end < start ? null : { start, end };
}

/** Whether the board has written this step yet, at canonical time `t`. */
export function revealStatus(
  schedule: readonly StepSchedule[],
  ref: StepRef,
  t: number,
): RevealStatus {
  const window = stepWindow(schedule, ref);
  if (!window) return "never written";
  if (!Number.isFinite(t) || t < window.start) return "upcoming";
  return t >= window.end ? "shown" : "showing";
}

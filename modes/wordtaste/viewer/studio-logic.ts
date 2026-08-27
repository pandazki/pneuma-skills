/**
 * Pure helpers for the stage-driven WordTaste viewer.
 *
 * The newest palate workflow intentionally keeps the disruption ladder and
 * symptom taxonomy internal. The viewer projects only decisions a person can
 * make quickly: approve the argument, mark the few strongest landing points,
 * choose by feel, or point at one sentence that still misses.
 */

import type { ViewerFileContent } from "../../../core/types/viewer-contract.js";
import { locateSegments, type SourceSegment } from "./math-selection.js";
import {
  loadDraft,
  loadTaste,
  loadWorkflow,
  type Draft,
  type Plan,
  type PlanEnds,
  type PlanPace,
  type PlanRole,
  type PlanSpan,
  type PlanUnit,
  type TasteProfile,
  type WorkflowState,
  type WritingCandidate,
  type WritingStage,
} from "../domain.js";

export interface WordtasteAddress extends Record<string, unknown> {
  contentSet?: string;
  file: string;
  quote: string;
  start: number;
  end: number;
}

export interface StageDefinition {
  id: "goal" | "shape" | "write" | "check" | "keep";
  label: string;
  description: string;
}

export const STAGES: StageDefinition[] = [
  { id: "goal", label: "Goal", description: "What this piece must do" },
  { id: "shape", label: "Shape", description: "Argument and emphasis" },
  { id: "write", label: "Write", description: "Sequential units" },
  { id: "check", label: "Check", description: "Fresh eyes and hard choices" },
  { id: "keep", label: "Keep", description: "Final text and learning" },
];

export function stageIndex(stage: WritingStage): number {
  switch (stage) {
    case "intake":
      return 0;
    case "layout":
      return 1;
    case "writing":
      return 2;
    case "review":
    case "choice":
      return 3;
    case "final":
    case "distilled":
      return 4;
  }
}

export function inferStage(
  workflow: WorkflowState | null,
  draft: Draft | null,
): WritingStage {
  if (workflow) return workflow.stage;
  return draft?.markdown.trim() ? "review" : "intake";
}

export function progressPercent(workflow: WorkflowState | null): number {
  const progress = workflow?.progress;
  if (!progress || progress.totalUnits <= 0) {
    return stageIndex(workflow?.stage ?? "intake") * 25;
  }
  return Math.min(
    100,
    Math.round((progress.completedUnits.length / progress.totalUnits) * 100),
  );
}

/**
 * The byte range in `draft.md` that a reader pointed at.
 *
 * The plain path is a literal lookup of what was selected, and stays that:
 * for plain prose the page and the file hold the same characters. Rendering
 * breaks that equality wherever it prints something other than what was
 * typed — glyphs for TeX, `recipe_json.py` for `` `recipe_json.py` ``, a
 * link's text for `[text](url)` — so a selection that crossed any such
 * construct also carries `segments`, the range read back in source form
 * (`viewer/math-selection.ts`). The rebuilt string is tried verbatim first,
 * because in the common case it *is* the file; when the renderer normalised
 * something away (`$ x $` arriving as `x`, two backticks arriving as one,
 * `__x__` and `**x**` arriving as the same element) the segment lookup finds
 * the span anyway, and the quote is then taken from the file rather than
 * from the rebuild — so `markdown.slice(start, end) === quote` holds on
 * every path.
 *
 * Null stays a real outcome: a stale quote, or prose the renderer changed in
 * a way this does not model, has no honest address.
 */
export function buildSpanAddress(args: {
  contentSet: string;
  markdown: string;
  quote: string;
  hintStart?: number;
  segments?: readonly SourceSegment[];
}): WordtasteAddress | null {
  const quote = args.quote.trim();
  if (!quote) return null;
  const hint = Math.max(0, args.hintStart ?? 0);
  let start = args.markdown.indexOf(quote, hint);
  if (start < 0) start = args.markdown.indexOf(quote);
  let end = start + quote.length;
  let text = quote;
  if (start < 0 && args.segments && args.segments.length > 0) {
    const located = locateSegments(args.markdown, args.segments, hint);
    if (!located) return null;
    start = located.start;
    end = located.end;
    text = args.markdown.slice(start, end);
  }
  if (start < 0 || !text) return null;
  return {
    ...(args.contentSet ? { contentSet: args.contentSet } : {}),
    file: args.contentSet ? `${args.contentSet}/draft.md` : "draft.md",
    quote: text,
    start,
    end,
  };
}

export function deriveDraft(
  files: ReadonlyArray<ViewerFileContent>,
  contentSet: string,
): Draft | null {
  return loadDraft(files, contentSet);
}

export function deriveWorkflow(
  files: ReadonlyArray<ViewerFileContent>,
  contentSet: string,
): WorkflowState | null {
  return loadWorkflow(files, contentSet);
}

export function deriveTaste(
  files: ReadonlyArray<ViewerFileContent>,
  contentSet: string,
): TasteProfile | null {
  return loadTaste(files, contentSet);
}

export function candidateMarkdown(
  files: ReadonlyArray<ViewerFileContent>,
  contentSet: string,
  candidate: WritingCandidate,
): string {
  if (typeof candidate.markdown === "string") return candidate.markdown;
  if (!candidate.path) return "";
  const path =
    contentSet && !candidate.path.startsWith(`${contentSet}/`)
      ? `${contentSet}/${candidate.path}`
      : candidate.path;
  return files.find((file) => file.path === path)?.content ?? "";
}

export function normalizeEmphasis(indexes: number[], thesisCount: number): number[] {
  return [...new Set(indexes)]
    .filter((index) => Number.isInteger(index) && index >= 0 && index < thesisCount)
    .slice(0, 3)
    .sort((a, b) => a - b);
}

/**
 * The three fixed label maps, and the only Chinese this viewer writes.
 *
 * They are byte-identical to the maps in `skill/scripts/project_plan.ts`, and
 * `studio-logic.test.ts` reads that script and asserts it. The duplication is
 * deliberate: the script projects the legacy `layout.units[]` for sessions the
 * viewer renders as prose, the viewer labels the plan table for sessions that
 * carry one, and a reader must recognise the same unit by the same words on
 * both paths. Two spellings of "交代背景" would be a silent fork.
 *
 * These are labels, not prose — the reason the mode is allowed to say them in
 * Chinese at all is that they are written once, in code, and never composed by
 * a model. The surrounding chrome stays English because this viewer has no
 * i18n surface; when it grows one, these maps are what it translates.
 */
export const PLAN_ROLE_LABELS: Record<PlanRole, string> = {
  background: "交代背景",
  problem: "把问题摆到读者面前",
  reasoning: "一步一步讲道理",
  conclusion: "说出结论",
  close: "收尾",
};

export const PLAN_PACE_LABELS: Record<PlanPace, string> = {
  dense: "密",
  loose: "疏",
  mixed: "疏密相间",
};

export const PLAN_ENDS_LABELS: Record<PlanEnds, string> = {
  stop: "说完就停",
  open: "留个口",
};

/**
 * The mark on a unit the essay breaks a new section at. One of the same
 * label family as the maps above — written once in code, never composed by a
 * model — and Chinese for the same reason they are: it sits inside a row whose
 * every other word is Chinese.
 */
export const PLAN_SECTION_LABEL = "新一节";

/** A span with an empty `to` runs to the end of its file. */
export const PLAN_SPAN_OPEN_END = "…";

export interface PlanSpanLabel {
  from: string;
  to: string;
}

/** One plan unit, resolved into everything a table row shows and nothing else. */
export interface PlanRow {
  id: string;
  order: number;
  roleLabel: string;
  spans: PlanSpanLabel[];
  targetChars: number;
  mustKeepCount: number;
  paceLabel: string;
  endsLabel: string;
  notes: string;
  /**
   * Whether the essay starts a new section here. The gate is where the user
   * ratifies a plan and where they reorder or merge its units, so where the
   * sections fall has to be visible in the same table those decisions are made
   * in. The first unit never carries one: the title is its opening.
   */
  opensSection: boolean;
}

export function planSpanLabel(span: PlanSpan): PlanSpanLabel {
  return {
    from: span.from.trim(),
    to: span.to.trim() || PLAN_SPAN_OPEN_END,
  };
}

/**
 * The short tag beside a claim: the file it was quoted from, plus the line
 * anchor when the planner gave one. `materials/original.md#L12` reads as
 * `original.md · L12` — enough to go and look, short enough not to compete
 * with the claim itself.
 */
export function planSourceLabel(source: string): string {
  const trimmed = source.trim();
  const hash = trimmed.indexOf("#");
  const path = hash >= 0 ? trimmed.slice(0, hash) : trimmed;
  const anchor = hash >= 0 ? trimmed.slice(hash + 1).trim() : "";
  const file = path.split("/").filter(Boolean).pop() ?? "";
  if (!file) return anchor || trimmed;
  return anchor ? `${file} · ${anchor}` : file;
}

export function planRows(plan: Plan): PlanRow[] {
  return plan.units.map((unit, index) => ({
    id: unit.id,
    order: index + 1,
    roleLabel: PLAN_ROLE_LABELS[unit.role],
    spans: unit.spans.map(planSpanLabel),
    targetChars: unit.target_chars,
    mustKeepCount: unit.must_keep.length,
    paceLabel: PLAN_PACE_LABELS[unit.pace],
    endsLabel: PLAN_ENDS_LABELS[unit.ends],
    notes: unit.notes_en.trim(),
    opensSection: index > 0 && unit.opens_section === true,
  }));
}

export function findPlanUnit(
  plan: Plan | undefined,
  unitId: string | undefined,
): PlanUnit | undefined {
  if (!plan || !unitId) return undefined;
  return plan.units.find((unit) => unit.id === unitId);
}

/**
 * What the unit being written is for, and where it reads from —
 * `交代背景 · ## 〇 → ### 1.2`. The span is dropped when the unit has none.
 */
export function planUnitCaption(unit: PlanUnit): string {
  const role = PLAN_ROLE_LABELS[unit.role];
  const span = unit.spans[0];
  if (!span) return role;
  const { from, to } = planSpanLabel(span);
  return `${role} · ${from} → ${to}`;
}

export function commandMessage(
  id: string,
  payload: Record<string, unknown>,
): string {
  return `<wordtaste-command id="${escapeAttr(id)}">\n${JSON.stringify(payload, null, 2)}\n</wordtaste-command>`;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

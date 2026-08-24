/**
 * WordTaste domain model.
 *
 * The July 2026 palate workflow is stage-driven: intake → layout gate →
 * sequential writing → review/choice → final → distillation. `workflow.json`
 * is the small, file-backed projection the viewer renders. The agent remains
 * the owner of every semantic transition; the viewer only sends cheap human
 * decisions back through the notification channel.
 *
 * This module is pure and React-free so it can be loaded by both the Bun
 * backend (through manifest.ts) and the frontend viewer.
 */

import { fromMarkdown } from "mdast-util-from-markdown";
import type { ViewerFileContent } from "../../core/types/viewer-contract.js";

export type WritingStage =
  | "intake"
  | "layout"
  | "writing"
  | "review"
  | "choice"
  | "final"
  | "distilled";

export interface DraftBlock {
  /** Ephemeral, deterministic address within the current draft. */
  id: string;
  markdown: string;
  start: number;
  end: number;
}

export interface Draft {
  contentSet: string;
  markdown: string;
  blocks: DraftBlock[];
}

export interface LayoutUnit {
  id: string;
  /** What this unit does in the article; prose form follows this function. */
  role?: string;
  brief: string;
  rhythm?: string;
  targetChars?: number;
  emphasis?: string;
}

/**
 * The structured plan a planner returns for one essay.
 *
 * The shape mirrors `skill/references/plan-schema.json` field for field,
 * snake_case included: `layout.plan` is the plan as it was validated on disk,
 * and a later writing unit is composed out of it. Renaming keys here would put
 * the viewer's spelling and the pipeline's spelling one rename apart forever.
 *
 * Every Chinese string in a plan is a verbatim quote from the author's own
 * material; everything the planner says in its own words is English, in
 * `notes_en`. `open_question` is the one exception — it is shown to the user
 * and never composed into a prompt.
 */
export type PlanRole =
  | "background"
  | "problem"
  | "reasoning"
  | "conclusion"
  | "close";

export type PlanPace = "dense" | "loose" | "mixed";

export type PlanEnds = "stop" | "open";

export interface PlanSpan {
  /** A material file path relative to the content set. */
  file: string;
  /** A whole line of that file, copied exactly. */
  from: string;
  /** A later whole line, copied exactly, or empty for end of file. */
  to: string;
}

export interface PlanClaim {
  /** Verbatim from the material. */
  text: string;
  /** Where it came from, optionally with a line anchor such as `#L12`. */
  source: string;
}

export interface PlanUnit {
  id: string;
  role: PlanRole;
  spans: PlanSpan[];
  must_keep: string[];
  target_chars: number;
  pace: PlanPace;
  ends: PlanEnds;
  notes_en: string;
}

export interface Plan {
  version: 1;
  title: string;
  claims: PlanClaim[];
  units: PlanUnit[];
  open_question?: string;
}

export interface WritingLayout {
  title: string;
  thesis: string[];
  units: LayoutUnit[];
  openQuestion?: string;
  /**
   * The full structured plan, when the session was planned by the deterministic
   * pipeline. Legacy sessions have only the projected fields above.
   */
  plan?: Plan;
}

export interface WritingProgress {
  currentUnit?: string;
  completedUnits: string[];
  totalUnits: number;
  note?: string;
}

export interface ReviewIssue {
  quote: string;
  problem: string;
  status?: "open" | "fixed" | "moved";
}

export interface WritingCandidate {
  id: string;
  /** Neutral label only. Never expose model family or word count. */
  label: string;
  /** Markdown may be embedded for small choices or referenced by path. */
  markdown?: string;
  path?: string;
  note?: string;
}

export interface WorkflowState {
  version: 2;
  contentSet: string;
  stage: WritingStage;
  goal: string;
  entry?: "idea" | "draft";
  taskId?: string;
  layout?: WritingLayout;
  /** Thesis indexes the user marked as the few strongest landing points. */
  emphasis: number[];
  progress?: WritingProgress;
  review?: {
    summary?: string;
    issues: ReviewIssue[];
  };
  candidates: WritingCandidate[];
  acceptedCandidateId?: string;
  finalNote?: string;
  updatedAt?: string;
}

export interface TasteProfile {
  contentSet: string;
  voiceFloor: string;
  recipeNames: string[];
  swapCount: number;
  prefsCount: number;
}

function prefixed(contentSet: string, rel: string): string {
  return contentSet ? `${contentSet}/${rel}` : rel;
}

function findFile(
  files: ReadonlyArray<ViewerFileContent>,
  path: string,
): ViewerFileContent | undefined {
  return files.find((file) => file.path === path);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function asStage(value: unknown): WritingStage {
  switch (value) {
    case "intake":
    case "layout":
    case "writing":
    case "review":
    case "choice":
    case "final":
    case "distilled":
      return value;
    default:
      return "intake";
  }
}

function splitBlocks(source: string): DraftBlock[] {
  const tree = fromMarkdown(source);
  const blocks: DraftBlock[] = [];
  for (const child of tree.children) {
    const start = child.position?.start.offset;
    const end = child.position?.end.offset;
    if (start == null || end == null) continue;
    const markdown = source.slice(start, end);
    if (!markdown.trim()) continue;
    blocks.push({
      id: `p${blocks.length + 1}`,
      markdown,
      start,
      end,
    });
  }
  return blocks;
}

export function loadDraft(
  files: ReadonlyArray<ViewerFileContent>,
  contentSet = "",
): Draft | null {
  const file = findFile(files, prefixed(contentSet, "draft.md"));
  if (!file) return null;
  return {
    contentSet,
    markdown: file.content,
    blocks: splitBlocks(file.content),
  };
}

export function saveDraft(
  next: Draft,
  _current: ReadonlyArray<ViewerFileContent>,
): { writes: Array<{ path: string; content: string }>; deletes: string[] } {
  return {
    writes: [{ path: prefixed(next.contentSet, "draft.md"), content: next.markdown }],
    deletes: [],
  };
}

const PLAN_ROLES = new Set(["background", "problem", "reasoning", "conclusion", "close"]);
const PLAN_PACES = new Set(["dense", "loose", "mixed"]);
const PLAN_ENDS = new Set(["stop", "open"]);

function isFilledString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPlanSpan(value: unknown): value is PlanSpan {
  return (
    isRecord(value)
    && isFilledString(value.file)
    && isFilledString(value.from)
    && typeof value.to === "string"
  );
}

function isPlanClaim(value: unknown): value is PlanClaim {
  return isRecord(value) && isFilledString(value.text) && isFilledString(value.source);
}

function isPlanUnit(value: unknown): value is PlanUnit {
  return (
    isRecord(value)
    && isFilledString(value.id)
    && typeof value.role === "string"
    && PLAN_ROLES.has(value.role)
    && Array.isArray(value.spans)
    && value.spans.every(isPlanSpan)
    && Array.isArray(value.must_keep)
    && value.must_keep.every(isFilledString)
    && typeof value.target_chars === "number"
    && Number.isInteger(value.target_chars)
    && typeof value.pace === "string"
    && PLAN_PACES.has(value.pace)
    && typeof value.ends === "string"
    && PLAN_ENDS.has(value.ends)
    && typeof value.notes_en === "string"
  );
}

/**
 * Accept or reject `layout.plan` — never repair it.
 *
 * The plan on disk is the pipeline's source of truth: a later unit is composed
 * out of `workflow.json` alone. So this function validates the structure and
 * then hands back the parsed object untouched, extra keys included. Filling in
 * a missing `notes_en` or quietly dropping one malformed span would make the
 * viewer's copy diverge from the file, and `saveWorkflow` round-trips whatever
 * it is given.
 *
 * A plan is all or nothing. One unmappable unit means the sequence on screen is
 * not the sequence that will be written, and the user would be approving
 * something false; dropping the whole plan falls back to the projected legacy
 * fields, which the same projection step wrote from the same plan and which are
 * therefore still accurate. Ranges (`target_chars` bounds) are the planner's
 * business and were already gated by `validate_plan.ts` upstream — this is a
 * render-safety check, not a second validator.
 */
function normalizePlan(value: unknown): Plan | undefined {
  if (!isRecord(value)) return undefined;
  if (value.version !== 1) return undefined;
  if (!isFilledString(value.title)) return undefined;
  if (!Array.isArray(value.claims) || value.claims.length === 0) return undefined;
  if (!value.claims.every(isPlanClaim)) return undefined;
  if (!Array.isArray(value.units) || value.units.length === 0) return undefined;
  if (!value.units.every(isPlanUnit)) return undefined;
  if (value.open_question !== undefined && typeof value.open_question !== "string") {
    return undefined;
  }
  return value as unknown as Plan;
}

function normalizeLayout(value: unknown): WritingLayout | undefined {
  if (!isRecord(value)) return undefined;
  const rawUnits = Array.isArray(value.units) ? value.units : [];
  const units = rawUnits
    .filter(isRecord)
    .map((unit, index): LayoutUnit => ({
      id: asString(unit.id, String(index + 1)),
      ...(typeof unit.role === "string" ? { role: unit.role } : {}),
      brief: asString(unit.brief),
      ...(typeof unit.rhythm === "string" ? { rhythm: unit.rhythm } : {}),
      ...(typeof unit.targetChars === "number" ? { targetChars: unit.targetChars } : {}),
      ...(typeof unit.emphasis === "string" ? { emphasis: unit.emphasis } : {}),
    }))
    .filter((unit) => unit.brief.length > 0);
  const plan = normalizePlan(value.plan);
  return {
    title: asString(value.title),
    thesis: asStringArray(value.thesis),
    units,
    ...(typeof value.openQuestion === "string" && value.openQuestion.trim()
      ? { openQuestion: value.openQuestion }
      : {}),
    ...(plan ? { plan } : {}),
  };
}

function normalizeProgress(value: unknown): WritingProgress | undefined {
  if (!isRecord(value)) return undefined;
  const completedUnits = asStringArray(value.completedUnits);
  const totalUnits =
    typeof value.totalUnits === "number" && Number.isFinite(value.totalUnits)
      ? Math.max(0, Math.round(value.totalUnits))
      : completedUnits.length;
  return {
    completedUnits,
    totalUnits,
    ...(typeof value.currentUnit === "string" ? { currentUnit: value.currentUnit } : {}),
    ...(typeof value.note === "string" ? { note: value.note } : {}),
  };
}

function normalizeReview(value: unknown): WorkflowState["review"] {
  if (!isRecord(value)) return undefined;
  const rawIssues = Array.isArray(value.issues) ? value.issues : [];
  const issues = rawIssues
    .filter(isRecord)
    .map((issue): ReviewIssue => ({
      quote: asString(issue.quote),
      problem: asString(issue.problem),
      ...(issue.status === "fixed" || issue.status === "moved" || issue.status === "open"
        ? { status: issue.status }
        : {}),
    }))
    .filter((issue) => issue.quote || issue.problem);
  return {
    issues,
    ...(typeof value.summary === "string" ? { summary: value.summary } : {}),
  };
}

function normalizeCandidates(value: unknown): WritingCandidate[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((candidate, index): WritingCandidate => ({
      id: asString(candidate.id, `candidate-${index + 1}`),
      label: asString(candidate.label, String.fromCharCode(65 + index)),
      ...(typeof candidate.markdown === "string" ? { markdown: candidate.markdown } : {}),
      ...(typeof candidate.path === "string" ? { path: candidate.path } : {}),
      ...(typeof candidate.note === "string" ? { note: candidate.note } : {}),
    }));
}

export function loadWorkflow(
  files: ReadonlyArray<ViewerFileContent>,
  contentSet = "",
): WorkflowState | null {
  const file = findFile(files, prefixed(contentSet, "workflow.json"));
  if (!file) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(file.content);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  const emphasis = Array.isArray(parsed.emphasis)
    ? parsed.emphasis
        .filter((entry): entry is number => typeof entry === "number" && Number.isFinite(entry))
        .map((entry) => Math.max(0, Math.round(entry)))
    : [];
  const layout = normalizeLayout(parsed.layout);
  const progress = normalizeProgress(parsed.progress);
  const review = normalizeReview(parsed.review);

  return {
    version: 2,
    contentSet,
    stage: asStage(parsed.stage),
    goal: asString(parsed.goal),
    ...(parsed.entry === "idea" || parsed.entry === "draft" ? { entry: parsed.entry } : {}),
    ...(typeof parsed.taskId === "string" ? { taskId: parsed.taskId } : {}),
    ...(layout ? { layout } : {}),
    emphasis,
    ...(progress ? { progress } : {}),
    ...(review ? { review } : {}),
    candidates: normalizeCandidates(parsed.candidates),
    ...(typeof parsed.acceptedCandidateId === "string"
      ? { acceptedCandidateId: parsed.acceptedCandidateId }
      : {}),
    ...(typeof parsed.finalNote === "string" ? { finalNote: parsed.finalNote } : {}),
    ...(typeof parsed.updatedAt === "string" ? { updatedAt: parsed.updatedAt } : {}),
  };
}

export function saveWorkflow(
  next: WorkflowState,
  _current: ReadonlyArray<ViewerFileContent>,
): { writes: Array<{ path: string; content: string }>; deletes: string[] } {
  const { contentSet, ...serializable } = next;
  return {
    writes: [
      {
        path: prefixed(contentSet, "workflow.json"),
        content: `${JSON.stringify(serializable, null, 2)}\n`,
      },
    ],
    deletes: [],
  };
}

export function loadTaste(
  files: ReadonlyArray<ViewerFileContent>,
  contentSet = "",
): TasteProfile | null {
  const profile = findFile(files, prefixed(contentSet, "taste/taste-profile.md"));
  if (!profile) return null;
  const voiceFloor = section(profile.content, 1);
  const recipePrefix = prefixed(contentSet, "taste/recipes/");
  const recipeNames = files
    .filter((file) => file.path.startsWith(recipePrefix) && file.path.endsWith(".md"))
    .map((file) => file.path.slice(recipePrefix.length))
    .filter((name) => !name.includes("/"))
    .sort();
  return {
    contentSet,
    voiceFloor,
    recipeNames,
    swapCount: countJsonl(findFile(files, prefixed(contentSet, "taste/examples/swaps.jsonl")))
      || countJsonl(findFile(files, prefixed(contentSet, "taste/swaps.jsonl"))),
    prefsCount: countJsonl(findFile(files, prefixed(contentSet, "taste/prefs.log.jsonl"))),
  };
}

export function saveTaste(
  _next: TasteProfile,
  _current: ReadonlyArray<ViewerFileContent>,
): { writes: Array<{ path: string; content: string }>; deletes: string[] } {
  return { writes: [], deletes: [] };
}

function section(markdown: string, number: number): string {
  const lines = markdown.split("\n");
  const collected: string[] = [];
  let active = false;
  for (const line of lines) {
    const heading = /^##\s+(\d+)\.?\s/.exec(line);
    if (heading) {
      if (active) break;
      active = Number(heading[1]) === number;
      continue;
    }
    if (active) collected.push(line);
  }
  return collected.join("\n").trim();
}

function countJsonl(file: ViewerFileContent | undefined): number {
  if (!file) return 0;
  return file.content.split("\n").filter((line) => line.trim()).length;
}

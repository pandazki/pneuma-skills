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

export interface WritingLayout {
  title: string;
  thesis: string[];
  units: LayoutUnit[];
  openQuestion?: string;
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
  return {
    title: asString(value.title),
    thesis: asStringArray(value.thesis),
    units,
    ...(typeof value.openQuestion === "string" && value.openQuestion.trim()
      ? { openQuestion: value.openQuestion }
      : {}),
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

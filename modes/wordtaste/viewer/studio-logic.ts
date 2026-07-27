/**
 * Pure helpers for the stage-driven WordTaste viewer.
 *
 * The newest palate workflow intentionally keeps the disruption ladder and
 * symptom taxonomy internal. The viewer projects only decisions a person can
 * make quickly: approve the argument, mark the few strongest landing points,
 * choose by feel, or point at one sentence that still misses.
 */

import type { ViewerFileContent } from "../../../core/types/viewer-contract.js";
import {
  loadDraft,
  loadTaste,
  loadWorkflow,
  type Draft,
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

export function buildSpanAddress(args: {
  contentSet: string;
  markdown: string;
  quote: string;
  hintStart?: number;
}): WordtasteAddress | null {
  const quote = args.quote.trim();
  if (!quote) return null;
  const hint = Math.max(0, args.hintStart ?? 0);
  let start = args.markdown.indexOf(quote, hint);
  if (start < 0) start = args.markdown.indexOf(quote);
  if (start < 0) return null;
  return {
    ...(args.contentSet ? { contentSet: args.contentSet } : {}),
    file: args.contentSet ? `${args.contentSet}/draft.md` : "draft.md",
    quote,
    start,
    end: start + quote.length,
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

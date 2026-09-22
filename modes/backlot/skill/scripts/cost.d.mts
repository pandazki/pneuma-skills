/** Type surface of `cost.mjs` — see that file for the semantics. */

import type { ProjectTexts, StageId } from "./stage-state.d.mts";

export type CostKind = "image" | "tts" | "music" | "take";
export type CostBasisSource = "table" | "reported" | "estimate";

export const COST_KINDS: readonly CostKind[];

export interface CostLine {
  stage: StageId;
  kind: CostKind;
  /** What a person reads in the Cost view ("小凯 — character sheet"). */
  label: string;
  /** The project-relative path of the artefact this call paid for. */
  ref: string;
  /** Null means UNPRICED — recorded, but nobody wrote down what it cost. */
  usd: number | null;
  /** Verbatim: "reported", or the price table's own sentence for a take. */
  basis: string | null;
  /** Which of the three provenances that sentence is, for grouping. */
  source: CostBasisSource | null;
  /** Epoch milliseconds for the records this mode writes; a take carries
   *  its ISO `submittedAt`, which predates the film around it. */
  at: number | string | null;
}

export interface CostSummary {
  currency: "USD";
  count: number;
  priced: number;
  total: number;
  byStage: Partial<Record<StageId, number>>;
  byKind: Partial<Record<CostKind, number>>;
  unpriced: string[];
  estimate: true;
}

export function costLines(texts: ProjectTexts): CostLine[];
export function basisSource(basis: string | null | undefined): CostBasisSource | null;
export function summarizeCost(lines: CostLine[]): CostSummary;
export function costOfStage(lines: CostLine[], stage: StageId): number;

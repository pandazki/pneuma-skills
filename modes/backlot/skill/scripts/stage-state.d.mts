/** Type surface of `stage-state.mjs` — see that file for the semantics. */

export type StageId = "idea" | "script" | "bible" | "boards" | "previz" | "takes" | "sound" | "cut";
export type StageStatus = "empty" | "draft" | "approved" | "changed";
export type GatedCommand =
  | "bible-image"
  | "voice"
  | "board"
  | "anchor"
  | "generate"
  | "vo"
  | "music"
  | "cut-final";

export const STAGES: readonly StageId[];
export const STAGE_STATUSES: readonly StageStatus[];
export const GATES: Readonly<Record<GatedCommand, StageId>>;

/** Project-relative path → file text. Text files only; media never enters a hash. */
export type ProjectTexts = Readonly<Record<string, string>>;

export interface StageApproval {
  at: number;
  hash: string;
}
export type Approvals = Readonly<Partial<Record<StageId, StageApproval>>> | null | undefined;

export interface StageInput {
  path: string;
  value: string | unknown;
}

export interface GateResult {
  ok: boolean;
  stage: StageId | null;
  status: StageStatus | null;
  reason: string | null;
}

export function stableStringify(value: unknown): string;
export function fnv1a(text: string): string;
export function isStage(value: unknown): value is StageId;
export function stageInputs(stage: StageId, texts: ProjectTexts): StageInput[];
export function hashStage(stage: StageId, texts: ProjectTexts): string | null;
export function stageStatus(stage: StageId, texts: ProjectTexts, approvals: Approvals): StageStatus;
export function stageStatuses(
  texts: ProjectTexts,
  approvals: Approvals,
): Array<{ stage: StageId; status: StageStatus }>;
export function gateFor(command: string): StageId | null;
export function gateCheck(
  command: string,
  texts: ProjectTexts,
  manifest: { gates?: unknown; approvals?: unknown } | null | undefined,
): GateResult;

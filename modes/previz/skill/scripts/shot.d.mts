// Type declarations for shot.mjs (plain JS so an installed skill runs it
// under bare `node`). The shapes here mirror `modes/previz/domain.ts`; that
// file is the viewer's reading of the same JSON and stays the contract of
// record.

import type { Probe, ShotSpec } from "./media.d.mts";

export const SHOT_VERSION: number;
export const PROJECT_VERSION: number;
export const ENTRIES: string[];
export const BEAT_KINDS: string[];
export const CHECK_STATUSES: string[];
export const TAKE_STATUSES: string[];
export const DEFAULT_SPEC: { seconds: number; fps: number; width: number; height: number };
export const STAGES: string[];
export const STANDARD_CHECKS: Record<"greybox" | "take" | "reference", Array<{ id: string; label: string }>>;

export type BeatKind = "action" | "trigger" | "camera" | "hold";
export type CheckStatus = "pass" | "fail" | "unverified";
export type TakeStatus = "submitted" | "done" | "failed";

export interface Beat {
  id: string;
  label: string;
  from: number;
  to: number;
  kind: BeatKind;
  causedBy?: string;
  note?: string;
}

export interface CheckHistoryEntry {
  revision: number;
  status: CheckStatus;
  note: string;
  at: string | null;
}

export interface Check {
  id: string;
  label: string;
  target: string;
  status: CheckStatus;
  range: [number, number] | null;
  note: string;
  revision: number | null;
  at: string | null;
  history: CheckHistoryEntry[];
}

export interface RenderRecord {
  file: string;
  revision: number;
  probe: Probe | null;
  renderedAt: string | null;
  renderSeconds: number | null;
  scale?: number;
}

export interface Take {
  id: string;
  status: TakeStatus;
  model: string;
  endpoint: string;
  resolution: string;
  seconds: number;
  refSeconds: number;
  greyboxRevision: number;
  requestId: string | null;
  file: string | null;
  promptFile: string;
  probe: Probe | null;
  cost: { usd: number; basis: string } | null;
  submittedAt: string | null;
  finishedAt: string | null;
  fix: string | null;
  allowFailing?: string | null;
  selected: boolean;
  note: string;
  url?: string | null;
}

export interface Shot {
  version: number;
  id: string;
  title: string;
  entry: "original" | "recreate";
  spec: ShotSpec;
  assumptions: string[];
  beats: Beat[];
  reference: Record<string, unknown> | null;
  greybox: {
    revision: number;
    script: string;
    preview: RenderRecord | null;
    final: RenderRecord | null;
    glb: string;
    meta: string;
    blend: string;
    sheet: string;
  };
  checks: Check[];
  stuck: string[];
  prompt: { file: string };
  takes: Take[];
}

export interface Project {
  version: number;
  title: string;
  defaults: { seconds: number; fps: number; width: number; height: number };
  shots: string[];
}

export interface CheckSummary {
  target: string;
  total: number;
  pass: number;
  fail: number;
  unverified: number;
  failIds: string[];
  unverifiedIds: string[];
  staleIds: string[];
  accepted: boolean;
}

export interface StageAnswer {
  stage: string | null;
  reason: string;
  command: string | null;
}

export function makeSpec(
  input?: { seconds?: number; fps?: number; width?: number; height?: number },
  defaults?: { seconds: number; fps: number; width: number; height: number },
): ShotSpec;
export function parseSize(value: string, label?: string): { width: number; height: number };
export function slugId(text: string, label?: string): string;
export function newProject(input: { title: string; defaults?: Partial<ShotSpec> }): Project;
export function newShot(input: {
  id: string;
  title: string;
  entry?: string;
  spec: ShotSpec;
  assumptions?: string[];
}): Shot;
export function normalizeShot(doc: unknown): Shot;
export function validateBeats(beats: unknown, spec: { seconds: number }): Beat[];
export function labelForCheck(id: string, target: string): string;
export function seedChecklist(shot: Shot): string[];
export function findCheck(shot: Shot, id: string, target: string): Check | null;
export function revisionOfTarget(shot: Shot, target: string): number | null;
export function recordCheck(
  shot: Shot,
  input: {
    id: string;
    status: CheckStatus;
    target?: string;
    range?: [number, number] | null;
    note?: string;
    at?: string | null;
    label?: string | null;
  },
): Check;
export function computeStuck(checks?: Check[]): string[];
export function summarizeChecks(shot: Shot, target: string): CheckSummary;
export function checkTargets(shot: Shot): string[];
export function nextTakeId(shot: Shot): string;
export function takePolicy(
  shot: Shot,
  options?: { fix?: string | null; userApproved?: boolean; allowFailing?: string | null },
): {
  ok: boolean;
  errors: string[];
  takeNumber: number;
  takeId: string;
  failingChecks: string[];
  unverifiedChecks: string[];
  allowFailing: string | null;
};
export const PROMPT_TEMPLATE_BODY: string;
export function parsePromptPack(markdown: string): { prompt: string | null; ok: boolean; reason: string | null };
export function nextStage(shot: Shot, options?: { promptOk?: boolean; promptReason?: string | null }): StageAnswer;
export function shotStatus(
  shot: Shot,
  options?: {
    promptOk?: boolean;
    promptReason?: string | null;
    costs?: unknown;
    files?: Record<string, boolean>;
  },
): Record<string, unknown>;

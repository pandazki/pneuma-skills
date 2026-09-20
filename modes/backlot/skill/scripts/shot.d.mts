// Type declarations for shot.mjs (plain JS so an installed skill runs it
// under bare `node`). The shapes here mirror `modes/backlot/domain.ts`; that
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
export const LINE_KINDS: string[];
export const REF_KINDS: string[];
/** `lines` is seeded only when the shot HAS a spoken line: an unanswerable
 *  check would sit unverified forever and block `select`. */
export const STANDARD_CHECKS: Record<"greybox" | "take" | "reference" | "lines", Array<{ id: string; label: string }>>;

export type BeatKind = "action" | "trigger" | "camera" | "hold";
export type CheckStatus = "pass" | "fail" | "unverified";
export type TakeStatus = "submitted" | "done" | "failed";
export type LineKind = "spoken" | "vo";
export type RefKind = "image" | "video" | "audio";

export interface Cost {
  usd: number;
  /** "table" | "reported" | "estimate", or the price table's own sentence
   *  for a take. Where a number came from is part of the number. */
  basis: string;
  estimate?: boolean;
}

export interface MediaRecord {
  file: string;
  revision: number;
  prompt?: string;
  refs?: string[];
  at?: number | null;
  cost?: Cost | null;
}

/**
 * One line of this shot. `spoken` is rendered BY THE VIDEO MODEL (the take
 * carries the text and the speaker's voice sample, and a transcript answers
 * `take-lines`); `vo` is a TTS file the cut mixes in. `at` is WHERE the line
 * lands in the shot, in seconds; `recordedAt` is when its audio was made.
 */
export interface Line {
  id: string;
  speaker: string;
  kind: LineKind;
  text: string;
  at: number | null;
  file: string | null;
  seconds: number | null;
  cost: Cost | null;
  recordedAt?: number | null;
  voice?: { model: string | null; voiceId: string | null; style: string | null } | null;
}

/** A reference attached to a take, in the order the prompt addresses it by
 *  (`@Video1`, `@Image1`, `@Audio1`). Paths are project-relative. */
export interface TakeRef {
  kind: RefKind;
  index: number;
  file: string;
}

/**
 * The sub-range of the shot's own clock that reaches the CUT — the greybox,
 * the take, the beats and a line's `at` all still run on the full clock.
 * `0 <= in < out <= spec.seconds`; null means the whole shot.
 */
export interface Trim {
  in: number;
  out: number;
}

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
  cost: Cost | null;
  refs?: TakeRef[];
  audio?: boolean;
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
  /** Where the shot sits in the film: `generate` reads these to attach the
   *  right sheets, set concept and voice samples. */
  scene: string | null;
  characters: string[];
  set: string | null;
  entry: "original" | "recreate";
  spec: ShotSpec;
  assumptions: string[];
  beats: Beat[];
  /** Null means the whole shot reaches the film. */
  trim: Trim | null;
  board: MediaRecord | null;
  lines: Line[];
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

export interface Scene {
  id: string;
  number: number;
  heading: string;
  summary: string;
}

/** `backlot.json`. Only APPROVALS are stored — a stage's status is derived
 *  from the files that define it (`stage-state.mjs`). */
export interface Project {
  version: number;
  title: string;
  logline: string;
  defaults: { seconds: number; fps: number; width: number; height: number };
  gates: "open" | "closed";
  approvals: Record<string, { at: number; hash: string; note?: string }>;
  scenes: Scene[];
  characters: string[];
  sets: string[];
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
/** A validated cut range on the shot's clock, or a thrown refusal naming
 *  the flag: `0 <= in < out <= spec.seconds`. */
export function makeTrim(input: { in: number; out: number }, spec: { seconds: number }): Trim;
export function slugId(text: string, label?: string): string;
export function newProject(input: { title: string; logline?: string; defaults?: Partial<ShotSpec> }): Project;
export function newShot(input: {
  id: string;
  title: string;
  entry?: string;
  spec: ShotSpec;
  assumptions?: string[];
  scene?: string | null;
  characters?: string[];
  set?: string | null;
}): Shot;
export function normalizeShot(doc: unknown): Shot;
export function validateBeats(beats: unknown, spec: { seconds: number }): Beat[];

/**
 * Validate a whole line list, carrying the PAID half over: a line whose id
 * and text are unchanged keeps its recording (`kept`); a line whose text
 * changed keeps its cost but loses its file (`stale`), because the audio
 * says something else now. Throws with every problem at once.
 */
export function validateLines(
  lines: unknown,
  spec: { seconds: number },
  previous?: Line[],
): { lines: Line[]; kept: string[]; stale: string[] };
export function spokenLines(shot: Shot): Line[];
export function hasSpokenLine(shot: Shot): boolean;
export function voiceOverLines(shot: Shot): Line[];
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

/** Every reference index a prompt names, in both spellings. `legacy` lists
 *  the `[Video1]` forms — Seedance documents `@Video1`. */
export interface PromptRefs {
  image: number[];
  video: number[];
  audio: number[];
  legacy: string[];
}

export function promptReferences(text: string): PromptRefs;
export function parsePromptPack(markdown: string): {
  prompt: string | null;
  ok: boolean;
  reason: string | null;
  refs: PromptRefs | null;
};
/** Whether a prompt only names references that were actually attached — the
 *  mismatch that does not error at fal, it just renders the wrong thing. */
export function validatePromptRefs(
  refs: PromptRefs | null,
  attached?: Partial<Record<RefKind, number>>,
): { ok: boolean; errors: string[] };

/** Case-folded, with punctuation, symbols and spacing removed — what a
 *  transcript can honestly be compared against. */
export function normalizeSpeech(text: string): string;
export function transcriptCoverage(
  transcript: string,
  lines?: Array<{ id?: string; text?: string }>,
): { ok: boolean; found: string[]; missing: Array<{ id: string | null; text: string }>; transcript: string };
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

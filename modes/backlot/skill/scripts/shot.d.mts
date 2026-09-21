// Type declarations for shot.mjs (plain JS so an installed skill runs it
// under bare `node`). The shapes here mirror `modes/backlot/domain.ts`; that
// file is the viewer's reading of the same JSON and stays the contract of
// record.

import type { Probe, ShotSpec } from "./media.d.mts";

export const SHOT_VERSION: number;
export const PROJECT_VERSION: number;
export const ENTRIES: string[];
/** `greybox` | `free` | `hybrid` — how a shot is conditioned, decided per
 *  shot in the plan. `greybox` is the default and what a file written before
 *  the field existed means. */
export const CONDITIONINGS: string[];
export const DEFAULT_CONDITIONING: string;
export const BEAT_KINDS: string[];
export const CHECK_STATUSES: string[];
export const TAKE_STATUSES: string[];
export const DEFAULT_SPEC: { seconds: number; fps: number; width: number; height: number };
export const STAGES: string[];
export const LINE_KINDS: string[];
export const REF_KINDS: string[];
/** `lines` is seeded only when the shot HAS a spoken line and `handoff` only
 *  when it declares continuity: an unanswerable check would sit unverified
 *  forever and block `select`. */
export const STANDARD_CHECKS: Record<
  "greybox" | "take" | "reference" | "lines" | "handoff",
  Array<{ id: string; label: string }>
>;

export type BeatKind = "action" | "trigger" | "camera" | "hold";
/**
 * How the take is conditioned:
 *  - `greybox` — `@Video1` is attached and the prompt inherits its layout,
 *    timing and camera (space, geography, a camera move the model cannot do);
 *  - `free` — no `@Video1`: the sheets and the style frame are the whole
 *    reference set and the prompt is written for the action itself;
 *  - `hybrid` — `@Video1` for the positions and the camera path, with the
 *    prompt allowing dynamic body action and camera speed inside it.
 */
export type Conditioning = "greybox" | "free" | "hybrid";
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

/**
 * A reference attached to a take, in the order the prompt addresses it by
 * (`@Video1`, `@Image1`, `@Audio1`). Paths are project-relative.
 *
 * `role` says what the reference is there to hold, and it is what the prompt
 * skeleton writes its assignment sentence from:
 * `greybox` | `anchor:<id>` | `board` | `character:<id>` | `set:<id>` |
 * `handoff` | `voice:<id>`.
 */
export interface TakeRef {
  kind: RefKind;
  index: number;
  file: string;
  role: string;
}

/**
 * The frame a take was told to open on — the previous shot's last used frame
 * — or `"skipped"` when it was generated with `--no-handoff`. Absent on a
 * shot that continues nothing.
 */
export interface TakeHandoff {
  from: string;
  take: string;
  /** The previous shot's take, project-relative. */
  source: string;
  frame: number;
  at: number;
  trimmed: Trim | null;
  /** `takes/handoff-in.png`, relative to THIS shot. */
  file: string;
}

/**
 * What this shot continues, and how it ends. Opt-in: a shot with no block is
 * generated alone, which is the right answer for every cut that exists to
 * break continuity. `from` names an EARLIER shot in `backlot.json`'s order;
 * `entry` and `exit` are free text about bodies, weapons and facing.
 * `exit` may stand alone — that is how a shot tells the next one where it
 * ended.
 */
export interface Continuity {
  from: string | null;
  entry: string | null;
  exit: string | null;
}

/**
 * An anchor frame: the still that says what the shot LOOKS like, made
 * image-to-image from the greybox frame at `at` (composition and camera) plus
 * the bible (appearance). `first` is the opening frame and the take's
 * `@Image1`.
 */
export interface Anchor {
  id: string;
  at: number;
  file: string;
  revision: number;
  prompt: string;
  /** Everything handed to the image model, project-relative, composition first. */
  refs: string[];
  greybox: { file: string; source: string; revision: number; frame: number };
  model: string | null;
  cost: Cost | null;
  createdAt: number | null;
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
  /** Short — what a rail, a sheet label or a beat row can show. */
  label: string;
  from: number;
  to: number;
  kind: BeatKind;
  /**
   * The DESIGNED picture of this beat, written at the boards stage before the
   * greybox exists: body action, expression, wardrobe and material, the
   * physical consequence, the tempo word. The greybox is built from it and
   * carries only its geometry and its clock; `prompt-skeleton` hands it back
   * to the model as the timeline, at the greybox's seconds.
   */
  detail: string | null;
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
  handoff?: TakeHandoff | "skipped";
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
  /** How this shot is conditioned; `greybox` when the file predates it. */
  conditioning: Conditioning;
  spec: ShotSpec;
  assumptions: string[];
  beats: Beat[];
  /** Null means the whole shot reaches the film. */
  trim: Trim | null;
  /** Null means this shot is generated alone — the default. */
  continuity: Continuity | null;
  board: MediaRecord | null;
  anchors: Anchor[];
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
/**
 * A validated hand-off, or null when nothing was declared. `from` must be an
 * EARLIER shot of `order` and not `id`; `entry` and `exit` are both required
 * beside it; `exit` may stand alone. Throws naming the flag.
 */
export function makeContinuity(
  input?: { from?: string | null; entry?: string | null; exit?: string | null },
  context?: { id?: string | null; order?: string[] | null },
): Continuity | null;
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
/** The take acceptance list this conditioning carries: on a `free` shot
 *  `take-motion` and `take-camera` are about the PLAN, not the greybox. */
export function takeChecks(conditioning?: Conditioning): Array<{ id: string; label: string }>;
/** How a shot is conditioned, defaulting an older or hand-edited file to
 *  `greybox`. */
export function conditioningOf(shot: unknown): Conditioning;
/** Whether the greybox is SENT for this shot — true for `greybox` and
 *  `hybrid`, false for `free`. */
export function usesGreybox(shot: unknown): boolean;
export function labelForCheck(id: string, target: string, conditioning?: Conditioning): string;
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
  conditioning: Conditioning;
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
/** `requireVideo` is false for a `free` shot: no video reference is
 *  attached, so a pack that never says `@Video1` is correct. */
export function parsePromptPack(markdown: string, options?: { requireVideo?: boolean }): {
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

/** The reference indices a prompt gives a JOB to — the tag followed by `=`,
 *  `:` or `is`. Naming a reference is not assigning it. */
export function promptAssignments(text: string): Record<RefKind, number[]>;
/** The other half of the rule: every reference the job CARRIES must have a
 *  job in the prompt, or it bleeds its own lighting and framing into the
 *  shot. */
export function validateReferenceAssignments(
  prompt: string,
  attached?: Partial<Record<RefKind, number>>,
): { ok: boolean; errors: string[]; missing: string[]; assigned: Record<RefKind, number[]> };

/** The `Seconds a–b:` rows of a v2 prompt pack. A bare `Seconds a:` moment
 *  is read as the range `[a, a]`. */
export function parsePromptTimeline(text: string): Array<{ from: number; to: number; line: string }>;
/** What is wrong with a timeline, as sentences — WARNINGS, never refusals. */
export function timelineProblems(
  timeline: Array<{ from: number; to: number; line: string }>,
  spec: { seconds: number },
): string[];

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

/**
 * Backlot domain types + aggregate-file load/save.
 *
 * A `Film` value is the whole backlot workspace: every `backlot.json` found
 * under a top-level directory (the content set = one short film project),
 * each carrying the eight stages' files — the idea and the screenplay, the
 * character and set bible, the shots with their boards, greyboxes and takes,
 * the sound records and the cut's edit list.
 *
 * ONE ALGORITHM FOR STAGE STATE. Whether a stage is empty, drafted, approved
 * or changed since approval is decided by `skill/scripts/stage-state.mjs`,
 * the same pure module `backlot.mjs` and `previz.mjs` gate their spending
 * with. This file only builds the `texts` map that module reads (every text
 * file of one project, keyed project-relative) and attaches the money. A
 * second implementation here is how a rail and a script start disagreeing
 * about what the creator approved.
 *
 * `backlot.json`, the bible records, `sound/sound.json` and `cut/edl.json`
 * are written ONLY by `skill/scripts/backlot.mjs`; `shot.json` only by
 * `skill/scripts/previz.mjs` (invariant 2 of the design brief). The agent
 * authors the prose (`idea.md`, `screenplay.md`, `shot-plan.md`,
 * `prompts.md`, `comparison.md`) and the Blender script; the viewer writes
 * nothing at all, which is why `saveFilm` throws instead of decomposing.
 *
 * Parsing is defensive on purpose. `shot.json` is rewritten mid-render while
 * the viewer is watching, so a half-written or hand-edited shot is SKIPPED
 * with a warning rather than thrown on — one broken shot must not blank the
 * whole film (same stance as `modes/lucid/domain.ts`).
 */

import type { ViewerFileContent } from "../../core/types/viewer-contract.js";
import {
  costLines,
  summarizeCost,
  type CostKind,
  type CostLine,
  type CostSummary,
} from "./skill/scripts/cost.mjs";
import {
  STAGES,
  fnv1a,
  stableStringify,
  stageStatuses,
  type ProjectTexts,
  type StageApproval,
  type StageId,
  type StageStatus,
} from "./skill/scripts/stage-state.mjs";

export {
  STAGES,
  type CostKind,
  type CostLine,
  type CostSummary,
  type ProjectTexts,
  type StageApproval,
  type StageId,
  type StageStatus,
};

// ── On-disk contract ────────────────────────────────────────────────────────

export const BACKLOT_MANIFEST = "backlot.json" as const;
export const SHOT_MANIFEST = "shot.json" as const;
export const SCENE_META = "scene.meta.json" as const;
export const IDEA_DOC = "idea.md" as const;
export const SCREENPLAY_DOC = "screenplay.md" as const;
export const SOUND_MANIFEST = "sound/sound.json" as const;
export const EDL_MANIFEST = "cut/edl.json" as const;

/** The frame arithmetic of one shot. `frames === seconds × fps`, frames 1..N. */
export interface ShotSpec {
  seconds: number;
  fps: number;
  width: number;
  height: number;
  frames: number;
}

/** `original` starts from an idea; `recreate` starts from a reference video. */
export type ShotEntry = "original" | "recreate";

/** What a beat is: the four rows the timeline draws. */
export type BeatKind = "action" | "trigger" | "camera" | "hold";

export interface Beat {
  id: string;
  label: string;
  from: number;
  to: number;
  kind: BeatKind;
  /** A trigger beat names the beat that caused it (invariant 5). */
  causedBy: string | null;
}

/** ffprobe facts about a media file — what was MEASURED, never what was asked for. */
export interface Probe {
  codec: string | null;
  pixFmt: string | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  frames: number | null;
  seconds: number | null;
  bytes: number | null;
}

/** One rendered MP4 with the revision it belongs to. */
export interface RenderRecord {
  file: string;
  revision: number;
  probe: Probe | null;
  renderedAt: number | null;
  renderSeconds: number | null;
}

export interface ReferenceState {
  file: string;
  sourceName: string | null;
  in: number | null;
  out: number | null;
  probe: Probe | null;
  /** Cut timestamps detected inside the trimmed segment, in seconds. */
  cuts: number[];
  sheet: string | null;
}

export interface GreyboxState {
  revision: number;
  script: string | null;
  preview: RenderRecord | null;
  /** The MP4 the video model receives — the conditioning truth (invariant 1). */
  final: RenderRecord | null;
  glb: string | null;
  meta: string | null;
  blend: string | null;
  sheet: string | null;
}

/** Nothing is "passed" unseen: a check nobody looked at stays `unverified`. */
export type CheckStatus = "pass" | "fail" | "unverified";

export interface CheckHistoryEntry {
  revision: number;
  status: CheckStatus;
  note: string;
}

export interface Check {
  id: string;
  label: string;
  /** `greybox` or a take id (`take-01`). */
  target: string;
  status: CheckStatus;
  /** Seconds on the shared clock, or null for a whole-shot check. */
  range: [number, number] | null;
  note: string;
  revision: number;
  history: CheckHistoryEntry[];
}

export type TakeStatus = "submitted" | "done" | "failed";

/**
 * What one paid call cost, beside the artefact it paid for.
 *
 * `basis` is `"table"` (a price table), `"reported"` (the vendor's own
 * `usage.cost`) or `"estimate"` — older take records carry the arithmetic
 * string `previz.mjs` wrote, and it is printed as given rather than
 * re-derived here.
 */
export interface Cost {
  usd: number;
  basis: string;
}

/** Historical name kept for the take ledger's callers. */
export type TakeCost = Cost;

/**
 * One reference attached to a take request (`@Video1`, `@Image2`, `@Audio1`).
 *
 * `kind` is the vocabulary `seedance-video.mjs` documents and `previz.mjs`
 * records; it is kept verbatim rather than narrowed, so a reference kind this
 * viewer has never heard of is still shown instead of silently dropped.
 */
export interface TakeRef {
  kind: string;
  index: number;
  file: string;
}

export interface Take {
  id: string;
  status: TakeStatus;
  model: string;
  endpoint: string;
  resolution: string;
  seconds: number | null;
  refSeconds: number | null;
  greyboxRevision: number | null;
  requestId: string | null;
  file: string | null;
  promptFile: string | null;
  probe: Probe | null;
  cost: Cost | null;
  submittedAt: number | null;
  finishedAt: number | null;
  /** The named defect this take was made to fix (invariant 6). */
  fix: string | null;
  selected: boolean;
  note: string;
  /** Why a `failed` take failed. */
  error: string | null;
  /** The references this take was rendered against, in attachment order. */
  refs: TakeRef[];
}

/**
 * A generated still with the revision that busts its cache.
 *
 * Media is never watched (a watched `.png` would be read into the file store
 * as text), so the record beside it is the only signal that the bytes moved —
 * which is why `revision` belongs here and in the URL.
 */
export interface MediaRecord {
  file: string;
  revision: number;
  cost: Cost | null;
}

/** The board frame of one shot: a still, its prompt and what it referenced. */
export interface BoardRecord extends MediaRecord {
  prompt: string;
  refs: string[];
  /** When it was generated (epoch ms), not where it sits in the shot. */
  at: number | null;
}

/** A character's TTS sample — what the voice sounds like, before any line. */
export interface VoiceSample {
  file: string;
  text: string;
  seconds: number | null;
  cost: Cost | null;
}

export interface VoiceRecord {
  model: string | null;
  voiceId: string | null;
  style: string | null;
  sample: VoiceSample | null;
}

/**
 * One line of dialogue.
 *
 * `spoken` is rendered BY THE VIDEO MODEL (the take prompt carries the line
 * and the speaker's voice sample), `vo` is a TTS file mixed into the cut.
 * Mixing TTS over a mouth the model animated is the lip-sync failure the two
 * kinds exist to avoid, so the kind is never guessed: anything the loader
 * cannot read is `vo`, the kind that never claims the screen.
 */
export interface Line {
  id: string;
  speaker: string;
  kind: "spoken" | "vo";
  text: string;
  /** Seconds into the shot, or null when the agent has not placed it. */
  at: number | null;
  file: string | null;
  seconds: number | null;
  cost: Cost | null;
}

/** Exactly what one `shot.json` holds, plus where it lives. */
export interface Shot {
  id: string;
  title: string;
  entry: ShotEntry;
  spec: ShotSpec;
  assumptions: string[];
  beats: Beat[];
  reference: ReferenceState | null;
  greybox: GreyboxState;
  checks: Check[];
  /** Check ids that failed on two consecutive revisions (invariant 7). */
  stuck: string[];
  promptFile: string | null;
  takes: Take[];
  /** The scene this shot belongs to (`backlot.json.scenes[].id`), or null. */
  scene: string | null;
  /** Bible character ids present in the shot, in the agent's order. */
  characters: string[];
  /** The bible set (a place) this shot is played in. */
  set: string | null;
  board: BoardRecord | null;
  lines: Line[];
  /** Workspace-relative shot directory (`first-light/shots/lab-walk`). */
  dir: string;
  /** Loader-level caveats (missing fields defaulted, unknown version). */
  warnings: string[];
}

export interface ProjectDefaults {
  seconds: number;
  fps: number;
  width: number;
  height: number;
}

/** One scene of the screenplay, with the shots that were broken out of it. */
export interface Scene {
  id: string;
  number: number;
  heading: string;
  summary: string;
  /** Shot ids whose `scene` names this one, in shot order. */
  shots: string[];
}

export interface Character {
  id: string;
  name: string;
  description: string;
  /** The prompt text the sheet was generated from. */
  look: string;
  sheet: MediaRecord | null;
  voice: VoiceRecord | null;
  /** Workspace-relative directory (`first-light/bible/characters/kai`). */
  dir: string;
}

/** A *place*: the set a scene is played on. */
export interface SetPiece {
  id: string;
  name: string;
  description: string;
  look: string;
  concept: MediaRecord | null;
  dir: string;
}

export interface MusicRecord {
  file: string;
  prompt: string;
  model: string;
  seconds: number | null;
  cost: Cost | null;
}

/** One dialogue line with the shot it belongs to — what the Sound view lists. */
export interface SoundLine extends Line {
  shot: string;
  /** The shot's title, for a table nobody should have to decode ids in. */
  shotTitle: string;
  /** Workspace-relative shot directory, for resolving a shot-relative file. */
  shotDir: string;
}

export interface SoundState {
  music: MusicRecord | null;
  /** Every line of every shot, in shot order then the order they were written. */
  lines: SoundLine[];
}

export interface CutSegment {
  shot: string;
  /** `take-02` — or `greybox`, which makes the whole cut a reel. */
  source: string;
  offset: number;
  seconds: number;
}

export interface CutVo {
  shot: string;
  line: string;
  /** Seconds on the CUT's clock, already offset by the segment. */
  at: number;
  file: string;
}

export interface CutMusic {
  file: string;
  gainDb: number;
  fadeOutSeconds: number;
}

/**
 * The last cut or reel, exactly as `edl.json` records it.
 *
 * A reel is a cut with greybox stand-ins. It is labelled a reel everywhere it
 * is shown and never a final (invariant: the cut is an honest projection of
 * the shots).
 */
export interface CutState {
  kind: "reel" | "final";
  file: string;
  seconds: number;
  builtAt: number | null;
  probe: Probe | null;
  segments: CutSegment[];
  vo: CutVo[];
  music: CutMusic | null;
}

/** One stage of the eight, with what the creator has approved and spent. */
export interface StageState {
  id: StageId;
  status: StageStatus;
  approvedAt: number | null;
  /** Sum of the cost lines attributed to this stage. */
  usd: number;
}

/** One project = one content set = one short film. */
export interface Project {
  /** Content-set prefix (`"first-light"`, `""` for a root-level project). */
  dir: string;
  title: string;
  logline: string;
  defaults: ProjectDefaults;
  /** Open gates let the agent spend without waiting for an approval. */
  gates: "open" | "closed";
  approvals: Partial<Record<StageId, StageApproval>>;
  /** All eight stages, in order, derived — never read from the file. */
  stages: StageState[];
  scenes: Scene[];
  characters: Character[];
  sets: SetPiece[];
  /** Shots in `backlot.json` order; shots found on disk but unlisted come last. */
  shots: Shot[];
  sound: SoundState;
  cut: CutState | null;
  cost: CostLine[];
  /** `idea.md` as written, or null when the stage is empty. */
  idea: string | null;
  /** `screenplay.md` as written, or null when the stage is empty. */
  screenplay: string | null;
  warnings: string[];
}

export interface Film {
  projects: Record<string, Project>;
}

/** `greybox/scene.meta.json`, written by the Blender kit at render time. */
export interface SceneAccent {
  objects: string[];
  from: number;
  to: number;
  /** Linear RGB in 0..1, as Blender wrote it. */
  color: [number, number, number];
}

/**
 * One frame of the focal-length curve.
 *
 * The SECOND thing glTF drops on the floor after the accent colours: a
 * camera's lens animation does not survive the export, so a dolly zoom would
 * look like a plain dolly in the 3D lane. The kit writes one entry per frame
 * (`previz_kit.py::_lens_track`), so the lane can step it exactly.
 */
export interface LensKey {
  frame: number;
  mm: number;
}

export interface SceneMeta {
  fps: number;
  frames: number;
  seconds: number;
  width: number;
  height: number;
  /** glTF node name of the shot camera. */
  camera: string | null;
  /** glTF node names whose floor trail the 3D lane draws. */
  subjects: string[];
  accents: SceneAccent[];
  /** Empty when the lens never moved — then the glTF camera is the truth. */
  cameraLens: LensKey[];
  blender: string | null;
  engine: string | null;
}

// ── Parsing helpers ─────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** JSON text → object, or null for anything else (half-written, a list, ""). */
function parseJsonRecord(text: string | undefined): Record<string, unknown> | null {
  if (typeof text !== "string") return null;
  try {
    const raw: unknown = JSON.parse(text);
    return isRecord(raw) ? raw : null;
  } catch {
    return null;
  }
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

const BEAT_KINDS: ReadonlySet<string> = new Set(["action", "trigger", "camera", "hold"]);
const CHECK_STATUSES: ReadonlySet<string> = new Set(["pass", "fail", "unverified"]);
const TAKE_STATUSES: ReadonlySet<string> = new Set(["submitted", "done", "failed"]);

export function parseProbe(raw: unknown): Probe | null {
  if (!isRecord(raw)) return null;
  return {
    codec: asNullableString(raw.codec),
    pixFmt: asNullableString(raw.pixFmt),
    width: asNullableNumber(raw.width),
    height: asNullableNumber(raw.height),
    fps: asNullableNumber(raw.fps),
    frames: asNullableNumber(raw.frames),
    seconds: asNullableNumber(raw.seconds),
    bytes: asNullableNumber(raw.bytes),
  };
}

function parseRange(raw: unknown): [number, number] | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const from = asNullableNumber(raw[0]);
  const to = asNullableNumber(raw[1]);
  if (from === null || to === null) return null;
  return from <= to ? [from, to] : [to, from];
}

function parseRender(raw: unknown): RenderRecord | null {
  if (!isRecord(raw)) return null;
  const file = asNullableString(raw.file);
  if (!file) return null;
  return {
    file,
    revision: asNumber(raw.revision, 0),
    probe: parseProbe(raw.probe),
    renderedAt: asNullableNumber(raw.renderedAt),
    renderSeconds: asNullableNumber(raw.renderSeconds),
  };
}

function parseBeat(raw: unknown): Beat | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id, "");
  if (!id) return null;
  const kind = asString(raw.kind, "action");
  const from = asNumber(raw.from, 0);
  const to = asNumber(raw.to, from);
  return {
    id,
    label: asString(raw.label, id),
    from,
    to: Math.max(from, to),
    kind: (BEAT_KINDS.has(kind) ? kind : "action") as BeatKind,
    causedBy: asNullableString(raw.causedBy),
  };
}

function parseCheck(raw: unknown): Check | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id, "");
  if (!id) return null;
  const status = asString(raw.status, "unverified");
  return {
    id,
    label: asString(raw.label, id),
    target: asString(raw.target, "greybox"),
    // An unknown status is NOT green. A check the loader cannot read is a
    // check nobody has looked at (invariant 4).
    status: (CHECK_STATUSES.has(status) ? status : "unverified") as CheckStatus,
    range: parseRange(raw.range),
    note: asString(raw.note, ""),
    revision: asNumber(raw.revision, 0),
    history: Array.isArray(raw.history)
      ? raw.history.filter(isRecord).map((h) => {
          const hs = asString(h.status, "unverified");
          return {
            revision: asNumber(h.revision, 0),
            status: (CHECK_STATUSES.has(hs) ? hs : "unverified") as CheckStatus,
            note: asString(h.note, ""),
          };
        })
      : [],
  };
}

function parseCost(raw: unknown): Cost | null {
  if (!isRecord(raw)) return null;
  const usd = asNullableNumber(raw.usd);
  if (usd === null) return null;
  return { usd, basis: asString(raw.basis, "estimate") };
}

function parseTakeRefs(raw: unknown): TakeRef[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isRecord).flatMap((entry) => {
    const file = asNullableString(entry.file);
    const kind = asNullableString(entry.kind);
    if (!file || !kind) return [];
    return [{ kind, index: asNumber(entry.index, 1), file }];
  });
}

function parseTake(raw: unknown): Take | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id, "");
  if (!id) return null;
  const status = asString(raw.status, "submitted");
  const cost = parseCost(raw.cost);
  return {
    id,
    // An unreadable status is `submitted`, not `done`: a take is never
    // reported finished on the strength of a field nobody could parse.
    status: (TAKE_STATUSES.has(status) ? status : "submitted") as TakeStatus,
    model: asString(raw.model, ""),
    endpoint: asString(raw.endpoint, ""),
    resolution: asString(raw.resolution, ""),
    seconds: asNullableNumber(raw.seconds),
    refSeconds: asNullableNumber(raw.refSeconds),
    greyboxRevision: asNullableNumber(raw.greyboxRevision),
    requestId: asNullableString(raw.requestId),
    file: asNullableString(raw.file),
    promptFile: asNullableString(raw.promptFile),
    probe: parseProbe(raw.probe),
    cost,
    submittedAt: asNullableNumber(raw.submittedAt),
    finishedAt: asNullableNumber(raw.finishedAt),
    fix: asNullableString(raw.fix),
    selected: raw.selected === true,
    note: asString(raw.note, ""),
    error: asNullableString(raw.error),
    refs: parseTakeRefs(raw.refs),
  };
}

function parseMedia(raw: unknown): MediaRecord | null {
  if (!isRecord(raw)) return null;
  const file = asNullableString(raw.file);
  if (!file) return null;
  return { file, revision: asNumber(raw.revision, 0), cost: parseCost(raw.cost) };
}

function parseBoard(raw: unknown): BoardRecord | null {
  const media = parseMedia(raw);
  if (!media || !isRecord(raw)) return null;
  return {
    ...media,
    prompt: asString(raw.prompt, ""),
    refs: asStringArray(raw.refs),
    at: asNullableNumber(raw.at),
  };
}

function parseLines(raw: unknown): Line[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isRecord).flatMap((entry): Line[] => {
    const id = asString(entry.id, "");
    if (!id) return [];
    return [
      {
        id,
        speaker: asString(entry.speaker, ""),
        // A line whose kind cannot be read is voice-over: `spoken` is a claim
        // that the video model will render the mouth, and that claim is never
        // made on the strength of a field nobody could parse.
        kind: entry.kind === "spoken" ? "spoken" : "vo",
        text: asString(entry.text, ""),
        at: asNullableNumber(entry.at),
        file: asNullableString(entry.file),
        seconds: asNullableNumber(entry.seconds),
        cost: parseCost(entry.cost),
      },
    ];
  });
}

function parseGreybox(raw: unknown, warnings: string[]): GreyboxState {
  if (!isRecord(raw)) {
    warnings.push("greybox block missing, shown as not rendered");
    return {
      revision: 0,
      script: null,
      preview: null,
      final: null,
      glb: null,
      meta: null,
      blend: null,
      sheet: null,
    };
  }
  return {
    revision: asNumber(raw.revision, 0),
    script: asNullableString(raw.script),
    preview: parseRender(raw.preview),
    final: parseRender(raw.final),
    glb: asNullableString(raw.glb),
    meta: asNullableString(raw.meta),
    blend: asNullableString(raw.blend),
    sheet: asNullableString(raw.sheet),
  };
}

function parseReference(raw: unknown): ReferenceState | null {
  if (!isRecord(raw)) return null;
  const file = asNullableString(raw.file);
  if (!file) return null;
  return {
    file,
    sourceName: asNullableString(raw.sourceName),
    in: asNullableNumber(raw.in),
    out: asNullableNumber(raw.out),
    probe: parseProbe(raw.probe),
    cuts: Array.isArray(raw.cuts)
      ? raw.cuts.filter((c): c is number => typeof c === "number" && Number.isFinite(c))
      : [],
    sheet: asNullableString(raw.sheet),
  };
}

/**
 * Parse one `shot.json` text. Returns null when the text is not JSON or not a
 * shot at all; otherwise defaults what is missing and records it in
 * `warnings`.
 *
 * `dir` is the workspace-relative shot directory; `fallbackId` is the
 * directory name, used when the file does not name itself.
 */
export function parseShot(dir: string, fallbackId: string, text: string): Shot | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;

  const warnings: string[] = [];
  if (raw.version !== 1) {
    if (typeof raw.version !== "number") return null;
    warnings.push(`unknown shot version ${raw.version}, read as 1`);
  }

  const specRaw = isRecord(raw.spec) ? raw.spec : {};
  const seconds = asNumber(specRaw.seconds, 8);
  const fps = asNumber(specRaw.fps, 24);
  // Frame arithmetic is exact (invariant 3). A file whose `frames` disagrees
  // with `seconds × fps` is reported, not silently trusted — the viewer's
  // frame readout and the 3D lane's clip mapping both read this number.
  const declaredFrames = asNullableNumber(specRaw.frames);
  const computedFrames = Math.round(seconds * fps);
  if (declaredFrames !== null && declaredFrames !== computedFrames) {
    warnings.push(
      `spec.frames is ${declaredFrames} but ${seconds} s × ${fps} fps is ${computedFrames}`,
    );
  }

  const entry = asString(raw.entry, "original");
  const beats = Array.isArray(raw.beats)
    ? raw.beats.map(parseBeat).filter((b): b is Beat => b !== null)
    : [];
  // Cause before effect (invariant 5): a dangling `causedBy` would draw a
  // connector to nothing, so it is reported and dropped to null.
  const beatIds = new Set(beats.map((b) => b.id));
  for (const beat of beats) {
    if (beat.causedBy && !beatIds.has(beat.causedBy)) {
      warnings.push(`beat "${beat.id}" names an unknown cause "${beat.causedBy}"`);
      beat.causedBy = null;
    }
  }

  const promptRaw = isRecord(raw.prompt) ? raw.prompt : {};

  return {
    id: asString(raw.id, fallbackId),
    title: asString(raw.title, fallbackId),
    entry: (entry === "recreate" ? "recreate" : "original") as ShotEntry,
    spec: {
      seconds,
      fps,
      width: asNumber(specRaw.width, 1280),
      height: asNumber(specRaw.height, 720),
      frames: declaredFrames ?? computedFrames,
    },
    assumptions: asStringArray(raw.assumptions),
    beats,
    reference: parseReference(raw.reference),
    greybox: parseGreybox(raw.greybox, warnings),
    checks: Array.isArray(raw.checks)
      ? raw.checks.map(parseCheck).filter((c): c is Check => c !== null)
      : [],
    stuck: asStringArray(raw.stuck),
    promptFile: asNullableString(promptRaw.file) ?? "prompts.md",
    takes: Array.isArray(raw.takes)
      ? raw.takes.map(parseTake).filter((t): t is Take => t !== null)
      : [],
    scene: asNullableString(raw.scene),
    characters: asStringArray(raw.characters),
    set: asNullableString(raw.set),
    board: parseBoard(raw.board),
    lines: parseLines(raw.lines),
    dir,
    warnings,
  };
}

/**
 * Parse one `bible/characters/<id>/character.json`.
 *
 * Defensive in the same way as `parseShot`: the file is rewritten by
 * `backlot.mjs` while the viewer watches, and a half-written record must
 * become a named absence on one card, never a blank bible.
 */
export function parseCharacter(dir: string, fallbackId: string, text: string): Character | null {
  const raw = parseJsonRecord(text);
  if (!raw) return null;
  const voiceRaw = isRecord(raw.voice) ? raw.voice : null;
  const sampleRaw = voiceRaw && isRecord(voiceRaw.sample) ? voiceRaw.sample : null;
  const sampleFile = sampleRaw ? asNullableString(sampleRaw.file) : null;
  return {
    id: asString(raw.id, fallbackId),
    name: asString(raw.name, fallbackId),
    description: asString(raw.description, ""),
    look: asString(raw.look, ""),
    sheet: parseMedia(raw.sheet),
    voice: voiceRaw
      ? {
          model: asNullableString(voiceRaw.model),
          voiceId: asNullableString(voiceRaw.voiceId),
          style: asNullableString(voiceRaw.style),
          sample:
            sampleRaw && sampleFile
              ? {
                  file: sampleFile,
                  text: asString(sampleRaw.text, ""),
                  seconds: asNullableNumber(sampleRaw.seconds),
                  cost: parseCost(sampleRaw.cost),
                }
              : null,
        }
      : null,
    dir,
  };
}

/** Parse one `bible/sets/<id>/set.json`. A set is a PLACE, not a prop. */
export function parseSetPiece(dir: string, fallbackId: string, text: string): SetPiece | null {
  const raw = parseJsonRecord(text);
  if (!raw) return null;
  return {
    id: asString(raw.id, fallbackId),
    name: asString(raw.name, fallbackId),
    description: asString(raw.description, ""),
    look: asString(raw.look, ""),
    concept: parseMedia(raw.concept),
    dir,
  };
}

/** Parse `sound/sound.json` — the music record; the lines live on the shots. */
export function parseMusic(text: string): MusicRecord | null {
  const raw = parseJsonRecord(text);
  if (!raw || !isRecord(raw.music)) return null;
  const file = asNullableString(raw.music.file);
  if (!file) return null;
  return {
    file,
    prompt: asString(raw.music.prompt, ""),
    model: asString(raw.music.model, ""),
    seconds: asNullableNumber(raw.music.seconds),
    cost: parseCost(raw.music.cost),
  };
}

/**
 * Parse `cut/edl.json`.
 *
 * A cut with a greybox stand-in among its segments is a REEL, and is shown
 * as one. `kind` is read from the file, but a `final` that still stands a
 * greybox in is corrected to `reel` here: the label is a claim about what the
 * user is watching, and the segment list is the evidence.
 */
export function parseCut(text: string): CutState | null {
  const raw = parseJsonRecord(text);
  if (!raw) return null;
  const file = asNullableString(raw.file);
  if (!file) return null;
  const segments: CutSegment[] = Array.isArray(raw.segments)
    ? raw.segments.filter(isRecord).flatMap((entry): CutSegment[] => {
        const shot = asNullableString(entry.shot);
        if (!shot) return [];
        return [
          {
            shot,
            source: asString(entry.source, "greybox"),
            offset: asNumber(entry.offset, 0),
            seconds: asNumber(entry.seconds, 0),
          },
        ];
      })
    : [];
  const standIn = segments.some((s) => s.source === "greybox");
  const declared = raw.kind === "final" ? "final" : "reel";
  const musicRaw = isRecord(raw.music) ? raw.music : null;
  const musicFile = musicRaw ? asNullableString(musicRaw.file) : null;
  return {
    kind: declared === "final" && !standIn ? "final" : "reel",
    file,
    seconds: asNumber(
      raw.seconds,
      segments.reduce((sum, s) => sum + s.seconds, 0),
    ),
    builtAt: asNullableNumber(raw.builtAt),
    probe: parseProbe(raw.probe),
    segments,
    vo: Array.isArray(raw.vo)
      ? raw.vo.filter(isRecord).flatMap((entry): CutVo[] => {
          const voFile = asNullableString(entry.file);
          if (!voFile) return [];
          return [
            {
              shot: asString(entry.shot, ""),
              line: asString(entry.line, ""),
              at: asNumber(entry.at, 0),
              file: voFile,
            },
          ];
        })
      : [],
    music:
      musicRaw && musicFile
        ? {
            file: musicFile,
            gainDb: asNumber(musicRaw.gainDb, 0),
            fadeOutSeconds: asNumber(musicRaw.fadeOutSeconds, 0),
          }
        : null,
  };
}

/** `greybox/scene.meta.json` → `SceneMeta`, or null when it is not one. */
export function parseSceneMeta(text: string): SceneMeta | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  const fps = asNullableNumber(raw.fps);
  const frames = asNullableNumber(raw.frames);
  if (fps === null || frames === null) return null;
  const accents: SceneAccent[] = Array.isArray(raw.accents)
    ? raw.accents.filter(isRecord).flatMap((a) => {
        const color = Array.isArray(a.color) ? a.color.map((c) => asNumber(c, 0)) : [];
        if (color.length < 3) return [];
        const objects = asStringArray(a.objects);
        if (objects.length === 0) return [];
        return [
          {
            objects,
            from: asNumber(a.from, 0),
            to: asNumber(a.to, 0),
            color: [color[0], color[1], color[2]] as [number, number, number],
          },
        ];
      })
    : [];
  return {
    fps,
    frames,
    seconds: asNumber(raw.seconds, frames / fps),
    width: asNumber(raw.width, 0),
    height: asNumber(raw.height, 0),
    camera: asNullableString(raw.camera),
    subjects: asStringArray(raw.subjects),
    accents,
    cameraLens: Array.isArray(raw.camera_lens)
      ? raw.camera_lens
          .filter(isRecord)
          .flatMap((key): LensKey[] => {
            const frame = asNullableNumber(key.frame);
            const mm = asNullableNumber(key.mm);
            // A lens of zero is not a wide lens, it is a broken record.
            return frame === null || mm === null || mm <= 0 ? [] : [{ frame, mm }];
          })
          .sort((a, b) => a.frame - b.frame)
      : [],
    blender: asNullableString(raw.blender),
    engine: asNullableString(raw.engine),
  };
}

/**
 * The vertical field of view a focal length gives THIS shot, in degrees.
 *
 * Blender's default sensor is 36 mm on the fitted axis and the kit never
 * touches `sensor_width` or `sensor_fit` (`previz_kit.py` sets `data.lens`
 * and nothing else), so AUTO fit puts those 36 mm across the LONG side —
 * the width, for every aspect this mode shoots. Three's camera takes the
 * vertical angle, hence the second conversion.
 */
export function fovForLens(mm: number, width: number, height: number): number {
  const aspect = width > 0 && height > 0 ? width / height : 16 / 9;
  const half = aspect >= 1 ? Math.atan(36 / (2 * mm)) : Math.atan((36 / aspect) / (2 * mm));
  const vertical = aspect >= 1 ? Math.atan(Math.tan(half) / aspect) : half;
  return (vertical * 360) / Math.PI;
}

/** The lens in force at `frame`; the curve is keyed on every frame. */
export function lensAt(keys: ReadonlyArray<LensKey>, frame: number): number | null {
  if (keys.length === 0) return null;
  let current = keys[0].mm;
  for (const key of keys) {
    if (key.frame > frame) break;
    current = key.mm;
  }
  return current;
}

// ── Path helpers ────────────────────────────────────────────────────────────

/**
 * Content-set prefix for a `backlot.json` path, or null when the path is not
 * one. Only a direct top-level directory is a project: `a/b/backlot.json`
 * would be invisible to the content-set resolver, so it is not offered.
 */
export function projectDirOf(path: string): string | null {
  if (path === BACKLOT_MANIFEST) return "";
  const suffix = `/${BACKLOT_MANIFEST}`;
  if (!path.endsWith(suffix)) return null;
  const dir = path.slice(0, -suffix.length);
  if (dir.includes("/") || dir.startsWith(".")) return null;
  return dir;
}

/** `{ project, shot }` for a `…/shots/<id>/shot.json` path, else null. */
export function shotRefOf(path: string): { project: string; shot: string } | null {
  const suffix = `/${SHOT_MANIFEST}`;
  if (!path.endsWith(suffix)) return null;
  const parts = path.slice(0, -suffix.length).split("/");
  // `shots/<id>` (root project) or `<project>/shots/<id>`.
  if (parts.length === 2 && parts[0] === "shots") return { project: "", shot: parts[1] };
  if (parts.length === 3 && parts[1] === "shots" && !parts[0].startsWith(".")) {
    return { project: parts[0], shot: parts[2] };
  }
  return null;
}

/** Workspace-relative directory holding a shot's files. */
export function shotDir(projectDir: string, shotId: string): string {
  return projectDir ? `${projectDir}/shots/${shotId}` : `shots/${shotId}`;
}

/** Workspace-relative path of a project-relative one (`sound/music.mp3`). */
export function projectPath(projectDir: string, relative: string): string {
  return projectDir ? `${projectDir}/${relative}` : relative;
}

/**
 * The project a workspace path belongs to, or null when none claims it.
 *
 * Only a top-level directory is a project (`projectDirOf`), so the owner is
 * the path's first segment when that is a known project, and the root project
 * otherwise. A file under a directory that holds no `backlot.json` belongs to
 * nobody and is ignored rather than folded into the root film.
 */
export function projectOwnerOf(path: string, dirs: ReadonlySet<string>): string | null {
  const slash = path.indexOf("/");
  if (slash > 0) {
    const head = path.slice(0, slash);
    if (dirs.has(head)) return head;
    // A root project owns only its own top level and the trees below it; a
    // sibling directory that is not a project is not part of any film.
    if (dirs.has("")) return "";
    return null;
  }
  return dirs.has("") ? "" : null;
}

/**
 * The id inside a bible path, or null when it is not one.
 *
 * `kind` is `characters` or `sets`; the path is project-relative
 * (`bible/characters/kai/character.json`).
 */
export function bibleIdOf(relative: string, kind: "characters" | "sets"): string | null {
  const file = kind === "characters" ? "character.json" : "set.json";
  const parts = relative.split("/");
  if (parts.length !== 4) return null;
  if (parts[0] !== "bible" || parts[1] !== kind || parts[3] !== file) return null;
  return parts[2] || null;
}

// ── The manifest ────────────────────────────────────────────────────────────

interface ManifestFacts {
  title: string;
  logline: string;
  defaults: ProjectDefaults;
  gates: "open" | "closed";
  approvals: Partial<Record<StageId, StageApproval>>;
  scenes: Array<Omit<Scene, "shots">>;
  characterIds: string[];
  setIds: string[];
  shotIds: string[];
}

const DEFAULT_SPEC: ProjectDefaults = { seconds: 8, fps: 24, width: 1280, height: 720 };

/**
 * Read `backlot.json` v1. Everything except the title is optional, because
 * the `first-light` seed predates the project fields and a film that has only
 * reached its first shot has no scenes, no bible and no approvals either.
 *
 * Only what the loader had to GUESS is warned about: an absent field is the
 * schema working as designed, a malformed one is not.
 */
function parseManifest(dir: string, text: string, warnings: string[]): ManifestFacts | null {
  const raw = parseJsonRecord(text);
  if (!raw) {
    // A half-written manifest still names a project — the directory is there
    // and its shots are readable. Say so rather than dropping it.
    warnings.push("backlot.json could not be parsed, shots listed in discovery order");
    return null;
  }
  if (raw.version !== undefined && raw.version !== 1) {
    warnings.push(`unknown backlot.json version ${JSON.stringify(raw.version)}, read as 1`);
  }

  const defaults = isRecord(raw.defaults)
    ? {
        seconds: asNumber(raw.defaults.seconds, DEFAULT_SPEC.seconds),
        fps: asNumber(raw.defaults.fps, DEFAULT_SPEC.fps),
        width: asNumber(raw.defaults.width, DEFAULT_SPEC.width),
        height: asNumber(raw.defaults.height, DEFAULT_SPEC.height),
      }
    : { ...DEFAULT_SPEC };

  // A gate value nobody can read is CLOSED. Open gates let the agent spend
  // without an approval, and that is never inferred from a typo.
  let gates: "open" | "closed" = "closed";
  if (raw.gates === "open") gates = "open";
  else if (raw.gates !== undefined && raw.gates !== "closed") {
    warnings.push(`gates is ${JSON.stringify(raw.gates)}, read as "closed"`);
  }

  const approvals: Partial<Record<StageId, StageApproval>> = {};
  if (isRecord(raw.approvals)) {
    for (const stage of STAGES) {
      const entry = raw.approvals[stage];
      if (!isRecord(entry)) continue;
      // An approval with no hash cannot prove WHAT was approved, so it is
      // kept as an approval (the creator did press the button) and
      // `stage-state.mjs` reads it as `changed`.
      approvals[stage] = { at: asNumber(entry.at, 0), hash: asString(entry.hash, "") };
    }
  } else if (raw.approvals !== undefined) {
    warnings.push("approvals is not an object; no stage is treated as approved");
  }

  const scenes: Array<Omit<Scene, "shots">> = [];
  if (Array.isArray(raw.scenes)) {
    raw.scenes.forEach((entry, index) => {
      if (!isRecord(entry)) {
        warnings.push(`scene ${index + 1} is not an object and was dropped`);
        return;
      }
      const id = asString(entry.id, "");
      if (!id) {
        warnings.push(`scene ${index + 1} has no id and was dropped`);
        return;
      }
      scenes.push({
        id,
        number: asNumber(entry.number, index + 1),
        heading: asString(entry.heading, id),
        summary: asString(entry.summary, ""),
      });
    });
  } else if (raw.scenes !== undefined) {
    warnings.push("scenes is not a list; the screenplay stage reads as empty");
  }

  return {
    title: asString(raw.title, dir || "Untitled"),
    logline: asString(raw.logline, ""),
    defaults,
    gates,
    approvals,
    scenes,
    characterIds: asStringArray(raw.characters),
    setIds: asStringArray(raw.sets),
    shotIds: asStringArray(raw.shots),
  };
}

// ── Cost ────────────────────────────────────────────────────────────────────
//
// THE MONEY IS NOT COMPUTED TWICE. `skill/scripts/cost.mjs` reads the same
// project-relative `texts` map `stage-state.mjs` hashes, and it is the module
// `backlot.mjs cost` prints from — so the rail, the Cost tab and the script
// cannot disagree about what the film has cost. Everything this file adds is
// the projection into stage totals.

/** The film's total, skipping the records nobody wrote a price on. */
export function totalCost(lines: ReadonlyArray<CostLine>): number {
  return summarizeCost([...lines]).total;
}

/**
 * Where a line's audio file actually lives.
 *
 * `previz.mjs` records a shot-relative name (`sound/l2.mp3` under the shot)
 * while `edl.json` quotes the same file project-relative
 * (`shots/s01/sound/l2.mp3`). Both forms are read: a path that starts at a
 * project-level directory is project-relative, anything else belongs to the
 * shot.
 */
export function resolveLinePath(projectDir: string, dirOfShot: string, file: string): string {
  const projectLevel = /^(shots|sound|bible|cut)\//.test(file);
  return projectLevel ? projectPath(projectDir, file) : `${dirOfShot}/${file}`;
}

// ── Load / save ─────────────────────────────────────────────────────────────

export function loadFilm(files: ReadonlyArray<ViewerFileContent>): Film | null {
  // 1. The projects: one per `backlot.json` at a top level.
  const facts: Record<string, ManifestFacts | null> = {};
  const warningsOf: Record<string, string[]> = {};
  for (const file of files) {
    const dir = projectDirOf(file.path);
    if (dir === null) continue;
    const warnings: string[] = [];
    facts[dir] = parseManifest(dir, file.content, warnings);
    warningsOf[dir] = warnings;
  }
  const dirs = new Set(Object.keys(facts));

  // 2. Every text file, keyed project-relative — the map `stage-state.mjs`
  //    hashes. It is built from the SAME snapshot the viewer draws from, so
  //    the rail and `backlot.mjs approve` cannot disagree.
  const textsOf: Record<string, Record<string, string>> = {};
  for (const dir of dirs) textsOf[dir] = {};
  for (const file of files) {
    const owner = projectOwnerOf(file.path, dirs);
    if (owner === null) continue;
    const relative = owner ? file.path.slice(owner.length + 1) : file.path;
    textsOf[owner][relative] = file.content;
  }

  const projects: Record<string, Project> = {};
  for (const dir of dirs) {
    const texts = textsOf[dir];
    const manifest = facts[dir];
    const warnings = warningsOf[dir];

    // 3. Shots, in manifest order; strays come last rather than vanishing.
    const shots: Shot[] = [];
    for (const [relative, content] of Object.entries(texts)) {
      const ref = shotRefOf(relative);
      if (ref === null || ref.project !== "") continue;
      const shot = parseShot(shotDir(dir, ref.shot), ref.shot, content);
      if (shot) shots.push(shot);
    }
    const listed = manifest?.shotIds ?? [];
    const rank = new Map(listed.map((id, i) => [id, i]));
    shots.sort((a, b) => {
      const ra = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const rb = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      if (ra !== rb) return ra - rb;
      return a.id.localeCompare(b.id);
    });
    for (const id of listed) {
      if (!shots.some((s) => s.id === id)) {
        warnings.push(`shot "${id}" is listed in backlot.json but has no shot.json`);
      }
    }

    // 4. The bible, listed ids first and anything found on disk after them.
    const characters = collectBible(
      texts,
      dir,
      "characters",
      manifest?.characterIds ?? [],
      parseCharacter,
      warnings,
    );
    const sets = collectBible(texts, dir, "sets", manifest?.setIds ?? [], parseSetPiece, warnings);

    // 5. Scenes carry the shots that were broken out of them.
    const scenes: Scene[] = (manifest?.scenes ?? []).map((scene) => ({
      ...scene,
      shots: shots.filter((s) => s.scene === scene.id).map((s) => s.id),
    }));
    const sceneIds = new Set(scenes.map((s) => s.id));
    for (const shot of shots) {
      if (shot.scene && !sceneIds.has(shot.scene)) {
        warnings.push(`shot "${shot.id}" names an unknown scene "${shot.scene}"`);
      }
    }

    const music = parseMusic(texts[SOUND_MANIFEST] ?? "");
    const soundLines: SoundLine[] = shots.flatMap((shot) =>
      shot.lines.map((line) => ({
        ...line,
        shot: shot.id,
        shotTitle: shot.title,
        shotDir: shot.dir,
      })),
    );
    const cut = parseCut(texts[EDL_MANIFEST] ?? "");
    // The money comes from the scripts' own module, over the same map.
    const cost = costLines(texts as ProjectTexts);
    const spentBy = summarizeCost(cost).byStage;

    // 6. Stage state — one algorithm, two runtimes.
    const approvals = manifest?.approvals ?? {};
    const stages: StageState[] = stageStatuses(texts as ProjectTexts, approvals).map((entry) => ({
      id: entry.stage,
      status: entry.status,
      approvedAt: approvals[entry.stage]?.at ?? null,
      usd: round2(spentBy[entry.stage] ?? 0),
    }));

    projects[dir] = {
      dir,
      title: manifest?.title ?? dir ?? "Untitled",
      logline: manifest?.logline ?? "",
      defaults: manifest?.defaults ?? { ...DEFAULT_SPEC },
      gates: manifest?.gates ?? "closed",
      approvals,
      stages,
      scenes,
      characters,
      sets,
      shots,
      sound: { music, lines: soundLines },
      cut,
      cost,
      idea: nonEmpty(texts[IDEA_DOC]),
      screenplay: nonEmpty(texts[SCREENPLAY_DOC]),
      warnings,
    };
  }

  return { projects };
}

function nonEmpty(text: string | undefined): string | null {
  return typeof text === "string" && text.trim().length > 0 ? text : null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Listed bible entries in their manifest order, then whatever else is there. */
function collectBible<T extends { id: string }>(
  texts: Record<string, string>,
  dir: string,
  kind: "characters" | "sets",
  listed: ReadonlyArray<string>,
  parse: (entryDir: string, fallbackId: string, text: string) => T | null,
  warnings: string[],
): T[] {
  const found = new Map<string, T>();
  for (const [relative, content] of Object.entries(texts)) {
    const id = bibleIdOf(relative, kind);
    if (id === null) continue;
    const parsed = parse(projectPath(dir, `bible/${kind}/${id}`), id, content);
    if (parsed) found.set(id, parsed);
    else warnings.push(`bible/${kind}/${id} could not be read and is not shown`);
  }
  const out: T[] = [];
  for (const id of listed) {
    const entry = found.get(id);
    if (entry) {
      out.push(entry);
      found.delete(id);
    } else {
      warnings.push(`${kind === "characters" ? "character" : "set"} "${id}" is listed in backlot.json but has no record`);
    }
  }
  for (const id of [...found.keys()].sort()) out.push(found.get(id)!);
  return out;
}

/**
 * The backlot viewer is strictly read-only (invariant 2). `backlot.json`, the
 * bible records, `sound/sound.json` and `cut/edl.json` are written only by
 * `skill/scripts/backlot.mjs`, and `shot.json` only by
 * `skill/scripts/previz.mjs`, which owns the revision counter, the acceptance
 * record and the take ledger. Approval from the viewer is a COMMAND to the
 * agent, never a write. When write-back ever lands, replace this with a real
 * decomposer rather than teaching the viewer a second way to write machine
 * state.
 */
export function saveFilm(
  _next: Film,
  _current: ReadonlyArray<ViewerFileContent>,
): { writes: Array<{ path: string; content: string }>; deletes: string[] } {
  throw new Error(
    "backlot viewer is read-only; backlot.json and shot.json are written by scripts/backlot.mjs and scripts/previz.mjs",
  );
}

// ── Helpers the viewer and extractContext share ────────────────────────────

/**
 * Frame number at `t` on the shared clock, 1-based and clamped to the spec.
 *
 * Blender numbers frames 1..N and the glTF exporter puts frame 1 at `1/fps`,
 * so t = 0 is frame 1 — and t = seconds would be frame N+1, which never
 * exists (invariant 3).
 */
export function frameAt(t: number, spec: ShotSpec): number {
  const frame = 1 + Math.round(t * spec.fps);
  return Math.min(Math.max(frame, 1), Math.max(1, spec.frames));
}

/** The beat containing `t`, preferring the narrowest match. */
export function beatAt(beats: ReadonlyArray<Beat>, t: number): Beat | null {
  let best: Beat | null = null;
  for (const beat of beats) {
    if (t < beat.from || t > beat.to) continue;
    if (!best || beat.to - beat.from < best.to - best.from) best = beat;
  }
  return best;
}

/** The take the shot delivers, or the first one when none is marked. */
export function selectedTake(shot: Shot): Take | null {
  return shot.takes.find((t) => t.selected) ?? shot.takes[0] ?? null;
}

/**
 * The acceptance summary, honest by construction (invariant 4). A shot is
 * only `accepted` when EVERY check of that target passed.
 */
export function checkTally(
  checks: ReadonlyArray<Check>,
): { pass: number; fail: number; unverified: number } {
  let pass = 0;
  let fail = 0;
  let unverified = 0;
  for (const check of checks) {
    if (check.status === "pass") pass += 1;
    else if (check.status === "fail") fail += 1;
    else unverified += 1;
  }
  return { pass, fail, unverified };
}

/** Distinct check targets in a stable order: `greybox` first, then take ids. */
export function checkTargets(checks: ReadonlyArray<Check>): string[] {
  const seen = new Set<string>();
  const targets: string[] = [];
  for (const check of checks) {
    if (seen.has(check.target)) continue;
    seen.add(check.target);
    targets.push(check.target);
  }
  return targets.sort((a, b) => {
    if (a === "greybox") return -1;
    if (b === "greybox") return 1;
    return a.localeCompare(b);
  });
}

/**
 * Per-shot progress dots for the shots rail: plan · greybox · accepted · take.
 *
 * NOT the eight pipeline stages — this is one shot's own progress, which is
 * why it keeps the older name the rail and the panel already read.
 */
export interface ShotStages {
  plan: boolean;
  greybox: boolean;
  accepted: boolean;
  take: boolean;
}

export function shotStages(shot: Shot): ShotStages {
  const greyboxChecks = shot.checks.filter((c) => c.target === "greybox");
  return {
    plan: shot.beats.length > 0,
    greybox: shot.greybox.final !== null,
    // "Accepted" means every greybox check passed — an `unverified` one is
    // not green, and `stuck` is never accepted.
    accepted:
      greyboxChecks.length > 0 &&
      greyboxChecks.every((c) => c.status === "pass") &&
      shot.stuck.length === 0,
    take: shot.takes.some((t) => t.status === "done"),
  };
}

// ── Stage helpers the rail and the context block share ─────────────────────

/**
 * The stage the film is standing at: the first one in order that the creator
 * has not approved, or null when all eight are approved.
 *
 * `changed` counts as open — the creator approved a version that has since
 * moved, so the current one still needs their eyes. This is the same reading
 * `gateCheck` uses to refuse spending, so the rail's "next" and the script's
 * refusal always name the same stage.
 */
export function nextOpenStage(project: Project): StageState | null {
  return project.stages.find((stage) => stage.status !== "approved") ?? null;
}

const STAGE_LABELS: Record<StageId, { en: string; zh: string }> = {
  idea: { en: "Idea", zh: "构思" },
  script: { en: "Screenplay", zh: "剧本" },
  bible: { en: "Bible", zh: "设定" },
  boards: { en: "Boards", zh: "分镜" },
  previz: { en: "Previz", zh: "白模" },
  takes: { en: "Takes", zh: "成片镜头" },
  sound: { en: "Sound", zh: "声音" },
  cut: { en: "Cut", zh: "成片" },
};

/** The stage's name for a human. `zh` is the film-crew word, not a calque. */
export function stageLabel(stage: StageId, lang: "en" | "zh" = "en"): string {
  return STAGE_LABELS[stage][lang];
}

/**
 * The cut segment playing at `t` seconds, or null when `t` is outside the cut.
 *
 * Segments are half-open (`offset ≤ t < offset + seconds`) so a boundary
 * belongs to the shot that starts there; the very end of the film belongs to
 * the last segment, because a playhead parked on the final frame is still
 * watching that shot.
 */
export function segmentAt(cut: CutState | null, t: number): CutSegment | null {
  if (!cut || cut.segments.length === 0) return null;
  for (const segment of cut.segments) {
    if (t >= segment.offset && t < segment.offset + segment.seconds) return segment;
  }
  const last = cut.segments[cut.segments.length - 1];
  return t >= last.offset + last.seconds ? last : null;
}

/**
 * A cache buster for media whose record carries no revision (a voice sample,
 * the music, a line's MP3).
 *
 * The record beside the file IS the file's identity: `backlot.mjs` rewrites
 * it in the same write that replaces the bytes, so hashing the record changes
 * the URL exactly when the audio changes — and never when it does not. Media
 * is not watched, so nothing else can tell the browser to fetch again.
 */
export function recordRev(record: unknown): string {
  return fnv1a(stableStringify(record));
}

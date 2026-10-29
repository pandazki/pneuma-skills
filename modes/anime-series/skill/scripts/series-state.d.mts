/**
 * Types for `series-state.mjs` — and the shapes of the three files that
 * module reads. The scripts stay plain ESM; this declaration keeps
 * `tsc --noEmit` honest for the tests and for the viewer's `domain.ts`.
 *
 *   bible.json                    Bible        (human + agent; viewer writes directly)
 *   episodes/<id>/episode.json    EpisodeFile  (human + agent; viewer writes directly)
 *   project.json → "series"       SeriesSidecar (machine state; series.mjs is the only writer)
 */

// ---------------------------------------------------------------------------
// bible.json
// ---------------------------------------------------------------------------

export type EntityKind = "character" | "group" | "scene";
/** `"style"` or `"<kind>:<id>"`. */
export type EntityKey = string;

export interface Character {
  /** `^[a-z0-9][a-z0-9-]{0,31}$`, unique among characters. */
  id: string;
  name: string;
  /** Appearance written down once: species/shape, size, colours, eyes, signature accessory. */
  look: string;
  /** The signature ability the comedy comes from. Never reaches a model. */
  ability?: string;
  /** One line. Never reaches a model. */
  personality?: string;
  /** Text that belongs to the character and must stay in frame (a printed label). Exempted from "no text in frame". */
  markings?: string;
  /** Display colours: a list of CSS colours, or label → CSS colour. Never reaches a model. */
  palette?: string[] | Record<string, string>;
  /** Sheet prompt input; defaults apply when empty. */
  expressions?: string[];
  poses?: string[];
  /** Other words shot text uses for this character (who-the-shot-names check only; never reaches a model). */
  aliases?: string[];
  /** Words that contain the name without meaning the character (光 in 冷蓝光); same check only. */
  notNames?: string[];
  /** The picked design-sheet asset id (craft `project.json`), or null. */
  sheet?: string | null;
}

export interface Group {
  id: string;
  name: string;
  look: string;
  /** The one member that stands out (bigger, a different colour …); drawn as its own panel on the sheet. */
  leader?: string;
  /** Text that belongs to the group (e.g. the leader's printed label). Exempted from "no text in frame". */
  markings?: string;
  palette?: string[] | Record<string, string>;
  /** Sheet poses; defaults apply when empty. */
  poses?: string[];
  /** As on a character; a group with a `leader` is also named by the leader's role word. */
  aliases?: string[];
  notNames?: string[];
  /** Optional sheet; a group without one is described in text. */
  sheet?: string | null;
}

export interface Scene {
  id: string;
  name: string;
  look: string;
  /** Time of day the scene is drawn at; an episode without `time` uses it. */
  time?: string;
  /**
   * Short constraints every image and clip of the set must keep ("the clock
   * face has no numbers"): sent with the scene sheet, every storyboard and
   * panel, and every clip.
   */
  rules?: string;
  sheet?: string | null;
}

export interface BibleLock {
  /** 1, 2, 3 … — the bible's version after this lock. */
  version: number;
  /** ISO 8601. */
  at: string;
  /** One hash per entity over its lock-covered fields. */
  hashes: Record<EntityKey, string>;
  /** Per entity, per field (ENTITY_FIELDS) — what lets a flag say which field changed. */
  fields: Record<EntityKey, Record<string, string>>;
}

export interface Bible {
  title: string;
  /** Frame ratio for storyboards and clips, e.g. "16:9". */
  ratio: string;
  dialogue: boolean;
  /**
   * The language prompt scaffolding is written in. Absent: detected from the
   * bible's own text (`prompts.mjs` `bibleLang`). Not covered by locks.
   */
  lang?: "en" | "zh";
  /** Series look, sent with every video prompt. */
  style: string;
  /** Sheet look, sent with every design-sheet prompt. */
  sheetStyle: string;
  characters: Character[];
  groups: Group[];
  scenes: Scene[];
  locks: BibleLock[];
}

// ---------------------------------------------------------------------------
// episodes/<id>/episode.json (the id is the directory name; the file does not carry it)
// ---------------------------------------------------------------------------

export type PartId = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H";

export interface Shot {
  /** Seconds, at least SHOT_MIN_S, tenths at most. */
  dur: number;
  /** What happens on screen (camera move welcome). Goes to the video prompt. */
  desc: string;
  /** 2–3 sound cues. Goes to the video prompt. */
  sfx?: string;
  /** Storyboard-only wording for the panel; `desc` is used when absent. */
  sketch?: string;
}

export interface Part {
  id: PartId;
  shots: Shot[];
}

export interface EpisodeLog {
  /** Defaults to the scene's name in the derived record. */
  location?: string;
  goal?: string;
  abilities?: string[];
  ending?: string;
}

export interface AcceptedDrift {
  /** The take or patch (clip asset id) the drift was accepted on. */
  take: string;
  shot: number;
  /** The cell key: a character id, or `group:<id>`. */
  character: string;
}

export interface EpisodePicks {
  /** Per part: the storyboard candidate in use. Absent → newest ready candidate. */
  storyboard?: Partial<Record<PartId, string>>;
  /** Per part: the take in use. Absent → newest ready take. */
  take?: Partial<Record<PartId, string>>;
  acceptedDrift?: AcceptedDrift[];
  /** Quiets the bible flag while it is ≥ the bible's latest lock version. */
  acknowledgedBibleVersion?: number | null;
}

export interface EpisodeFile {
  title: string;
  /** 15, 30 or 60 by convention; parts = duration / 30 rounded up. */
  duration: number;
  cast: string[];
  groups?: string[];
  scene?: string | null;
  time?: string;
  continuity?: string[];
  parts: Part[];
  log?: EpisodeLog | null;
  picks?: EpisodePicks;
}

/** An episode as the rules see it: the file plus its directory name. */
export interface Episode extends EpisodeFile {
  id: string;
}

// ---------------------------------------------------------------------------
// project.json → "series" sidecar (machine state)
// ---------------------------------------------------------------------------

/** `absent`: not in that shot's frames — neither a pass nor a drift. */
export type Verdict = "ok" | "drift" | "absent" | "unverified";
/** What a sheet candidate can be judged. */
export type SheetVerdict = "ok" | "drift" | "unverified";

/** What a generation consumed from the bible: the version and per-field hashes. */
export interface Basis {
  version: number;
  fields: Record<EntityKey, Record<string, string>>;
}

export interface SheetCheck {
  verdict: SheetVerdict;
  note: string;
  /** Epoch ms. */
  at: number;
}

export interface SheetCandidate {
  asset: string;
  basis: Basis;
  check?: SheetCheck;
}

export interface SheetSlot {
  candidates: SheetCandidate[];
  /** Side-by-side compare images built by `check-sheets` (derive assets). */
  compares: string[];
}

export interface BoardRecord {
  asset: string;
  basis: Basis;
  /** boardShotHash per shot when drawn. */
  shots: string[];
  /** Reference asset ids sent, in order. */
  refs: string[];
  /** Set when this board is a re-composite: the base board and the redrawn panel. */
  from?: { board: string; panel: string; shot: number };
}

export interface PanelRecord {
  shot: number;
  asset: string;
  /** The board it was drawn for. */
  board: string;
  /** The re-composited board, or null until it lands. */
  result: string | null;
}

export interface TakeRecord {
  asset: string;
  board: string;
  refs: string[];
  basis: Basis;
  /** clipShotHash per shot when shot. */
  shots: string[];
  /** Shot durations the take was shot with — its own clock (review and patches use it). */
  durs: number[];
  /** setupHash of the episode when shot. */
  setup: string;
  resolution: string;
  /** Requested whole seconds. */
  seconds: number;
}

export interface PatchRecord {
  asset: string;
  /** Shot durations the patch was shot with, for the covered shots (newer records). */
  durs?: number[];
  /** The take it patches. */
  take: string;
  /** Shots a–b to splice back (1-based, inclusive). */
  shots: [number, number];
  /** Shots the patch clip covers (wider when a–b is under the minimum render). */
  covered: [number, number];
  /** What is cut out of the take: shots a–b on the TAKE's clock (its recorded durations), seconds. */
  span: [number, number];
  /** Where a–b starts inside the patch clip, seconds. */
  offset: number;
  /** Seconds taken from the patch clip (a–b as the shot list stood at patch time). */
  length: number;
  seconds: number;
  requestSeconds: number;
  board: string;
  refs: string[];
  basis: Basis;
  shotHashes: string[];
  /** Set by `final`: whether the latest final splices this patch in. */
  applied?: boolean;
}

export interface ReviewStrip {
  shot: number;
  asset: string;
  /** Sample times in the take, seconds. */
  times: number[];
}

export interface ReviewRecord {
  /** The overview contact sheet (the sheets once, then one row of frames per shot). */
  asset: string;
  /** The take — or the patch — the frames were sampled from. */
  take: string;
  /** The sheets row of the overview (newer records). */
  sheets?: string | null;
  strips: ReviewStrip[];
  /** Detected scene cuts in the take, seconds. */
  cuts: number[];
}

export interface ShotCheck {
  verdict: Verdict;
  note: string;
  /** The strip asset the verdict was made from. */
  frame: string | null;
  at: number;
}

export interface PartSlots {
  boards: BoardRecord[];
  panels: PanelRecord[];
  takes: TakeRecord[];
  patches: PatchRecord[];
  reviews: ReviewRecord[];
  /** checks[takeOrPatchId][shotNumber][cellKey] — cellKey: a character id, or `group:<id>`. */
  checks: Record<string, Record<string, Record<string, ShotCheck>>>;
}

export interface AssembledPrompts {
  /** Epoch ms. */
  at: number;
  basis: Basis;
  boardShots: string[];
  clipShots: string[];
  setup: string;
  refs: Array<{ n: number; kind: EntityKind | "storyboard"; id: string | null; name: string; asset: string | null }>;
  storyboard: string;
  video: string;
  jimeng: { storyboard: string; video: string };
}

export interface SpliceWindow {
  /** Seconds on the take's own clock that the patch replaces. */
  take: [number, number];
  /** Seconds of the patch clip that go in. */
  patch: [number, number];
}

export interface FinalSplice {
  part: PartId;
  shots: [number, number];
  /** Where the patch sits in the final cut, seconds (output clock). */
  at: [number, number];
  patch: string;
  /** The splice by the shot list (newer records). */
  planned?: SpliceWindow;
  /** The splice as cut: each interior point moved to a detected scene cut within SNAP_S (newer records). */
  snapped?: SpliceWindow;
}

export interface FinalRecord {
  asset: string;
  takes: Partial<Record<PartId, string>>;
  patches: string[];
  /** Where each part sits in the final cut, seconds (output clock). */
  parts: Array<{ part: PartId; take: string; at: [number, number] }>;
  splices: FinalSplice[];
}

export interface EpisodeSlots {
  parts: Partial<Record<PartId, PartSlots>>;
  prompts: Partial<Record<PartId, AssembledPrompts>>;
  finals: FinalRecord[];
}

export interface Compilation {
  asset: string;
  episodes: string[];
  titles: boolean;
}

/** A lineup probe: picked sheets drawn side by side at one scale (`series.mjs lineup`). */
export interface Lineup {
  asset: string;
  /** Character ids, in reference order. */
  characters: string[];
  /** The sheet asset ids sent, in the same order. */
  sheets: string[];
}

export interface SeriesSidecar {
  schema: 1;
  sheets: Record<EntityKey, SheetSlot>;
  episodes: Record<string, EpisodeSlots>;
  compilations: Compilation[];
  /** Absent in files written before lineups existed. */
  lineups?: Lineup[];
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export declare const SHOT_MIN_S: number;
export declare const SHOT_LONG_S: number;
export declare const PART_MAX_S: number;
export declare const PART_MIN_S: number;
export declare const PART_IDS: readonly PartId[];
export declare const GRIDS: Readonly<Record<number, readonly [number, number]>>;
export declare const SUGGESTED_SHOTS: Readonly<Record<number, number>>;
export declare const ENTITY_KINDS: readonly EntityKind[];
export declare const STYLE_KEY: "style";
export declare const ENTITY_ID_RE: RegExp;
export declare const EPISODE_ID_RE: RegExp;
export declare const VERDICTS: readonly Verdict[];
export declare const SHEET_VERDICTS: readonly SheetVerdict[];
export declare const BIBLE_LANGS: readonly ("en" | "zh")[];
export declare const ENTITY_FIELDS: Readonly<Record<EntityKind | "style", readonly string[]>>;
export declare const SHOT_FIELDS: Readonly<Record<EntityKind | "style", readonly string[]>>;
export declare const SHEET_FIELDS: Readonly<Record<EntityKind | "style", readonly string[]>>;

export declare function canonicalJson(value: unknown): string;
export declare function fnv1a(text: string): string;
export declare function hashValue(value: unknown): string;
export declare function fieldHashes(kind: EntityKind | "style", entity: object | null | undefined): Record<string, string>;
export declare function entityKey(kind: EntityKind | "style", id: string | null): EntityKey;
export declare function parseEntityKey(key: string): { kind: EntityKind | "style"; id: string | null } | null;

export interface BibleEntity {
  key: EntityKey;
  kind: EntityKind | "style";
  id: string | null;
  name: string;
  entity: Bible | Character | Group | Scene;
}
export declare function bibleEntities(bible: Partial<Bible> | null | undefined): BibleEntity[];
export declare function findEntity(bible: Partial<Bible> | null | undefined, kind: EntityKind | "style", id: string | null): Character | Group | Scene | Partial<Bible> | null;
export declare function bibleFieldHashes(bible: Partial<Bible> | null | undefined): Record<EntityKey, Record<string, string>>;
export declare function entityHashOf(fields: Record<string, string>): string;

export declare function latestLock(bible: Partial<Bible> | null | undefined): BibleLock | null;
export declare function bibleVersion(bible: Partial<Bible> | null | undefined): number;
export declare function lockEntry(bible: Partial<Bible>, at: string): BibleLock;
export interface LockState {
  state: "unlocked" | "locked" | "edited";
  version: number | null;
  changed: string[];
}
export declare function lockStates(bible: Partial<Bible> | null | undefined): Record<EntityKey, LockState>;

export declare function consumedKeys(episode: Partial<EpisodeFile> | null | undefined): EntityKey[];
export declare function shotBasis(bible: Partial<Bible>, episode: Partial<EpisodeFile>): Basis;
export declare function sheetBasis(bible: Partial<Bible>, kind: EntityKind, id: string): Basis;
export interface BasisChange {
  key: EntityKey;
  name: string;
  fields: string[];
}
export declare function basisChanges(bible: Partial<Bible>, basis: Basis | null | undefined): BasisChange[];
export interface BibleFlag {
  /** Raise the flag: something this take consumed differs from the bible now in force. */
  stale: boolean;
  shotUnder: number | null;
  latest: number;
  changes: BasisChange[];
  /** Changes exist but the human acknowledged the latest version. */
  acknowledged: boolean;
}
export declare function bibleFlag(bible: Partial<Bible>, basis: Basis | null | undefined, acknowledgedVersion?: number | null): BibleFlag;

export declare function boardShotHash(shot: Partial<Shot>): string;
export declare function clipShotHash(shot: Partial<Shot>): string;
export declare function setupHash(episode: Partial<EpisodeFile>): string;
export declare function boardShotHashes(part: Partial<Part> | null | undefined): string[];
export declare function clipShotHashes(part: Partial<Part> | null | undefined): string[];
export declare function staleShots(recorded: string[] | null | undefined, current: string[]): number[];
/** Shots the cut in effect shows from an older shot list; a shot an applied patch re-shot is current. */
export declare function cutStaleShots(
  take: Pick<TakeRecord, "asset" | "shots"> | null | undefined,
  slots: Partial<PartSlots> | null | undefined,
  statusOf: (assetId: string) => string | undefined,
  current: string[],
): number[];

export declare function gridOf(n: number): { rows: number; cols: number; tidy: boolean };
export declare function fmtSeconds(x: number): string;
export declare function partCountFor(duration: number): number;
export declare function partSeconds(episode: Partial<EpisodeFile>): number;
export interface TimelineEntry {
  shot: number;
  start: number;
  end: number;
  dur: number;
}
export declare function shotTimeline(shots: Array<Pick<Shot, "dur">>): TimelineEntry[];
export interface Issue {
  level: "error" | "warning";
  code: string;
  message: string;
  part?: string;
  shot?: number;
}
export declare function checkEpisode(episode: Partial<EpisodeFile>): { errors: Issue[]; warnings: Issue[] };
export declare function rebalance<S extends Pick<Shot, "dur">>(shots: S[], index: number, dur: number, from?: "both" | "next" | "prev"): S[];
export interface PatchPlan {
  shots: [number, number];
  covered: [number, number];
  extended: boolean;
  span: [number, number];
  offset: number;
  seconds: number;
  requestSeconds: number;
}
export declare const SNAP_S: number;
export declare function snapToCut(t: number, cuts: number[] | null | undefined, tolerance?: number): number;
/** The interior ends of a splice span with no detected cut within `tolerance` (default SNAP_S). */
export declare function uncutSpliceEnds(span: readonly number[], cuts: number[] | null | undefined, length?: number | null, tolerance?: number): number[];
export declare function patchPlan(shots: Array<Pick<Shot, "dur">>, a: number, b: number, minSeconds?: number): PatchPlan;

export declare function effectivePick(
  picked: string | null | undefined,
  candidates: string[],
  statusOf: (assetId: string) => string | undefined,
): { asset: string | null; picked: boolean };
export interface CheckCell {
  shot: number;
  kind: "character" | "group";
  /** The entity id. */
  id: string;
  /** The cell key: the character id, or `group:<id>`. */
  character: string;
  verdict: Verdict;
  note: string;
  frame: string | null;
  accepted: boolean;
  /** `true` when the shot's words name the entity; `null` when that cannot be told (or no bible was given). */
  expected: true | null;
  /** The clip the verdict belongs to: the take, or the applied patch the shot is spliced from. */
  source: string;
}
export declare function cellKey(kind: "character" | "group", id: string): string;
export declare function parseCellKey(key: string): { kind: "character" | "group"; id: string };
export declare function namesEntity(text: string | null | undefined, name: string | null | undefined, exclusions?: string[]): boolean;
export interface NameableEntity { name?: string; id?: string; aliases?: string[]; notNames?: string[]; leader?: string }
export declare function entityNames(entity: NameableEntity | null | undefined): { names: string[]; exclusions: string[] };
export declare function expectedIn(shot: Partial<Shot> | null | undefined, entity: NameableEntity | null | undefined): true | null;
export declare function appliedPatches(
  slots: Partial<PartSlots> | null | undefined,
  take: string,
  statusOf: (assetId: string) => string | undefined,
): { kept: PatchRecord[]; dropped: PatchRecord[] };
export declare function checkCells(
  episode: Partial<EpisodeFile>,
  partId: string,
  takeId: string,
  checks: Record<string, Record<string, Partial<ShotCheck>>> | null | undefined,
  acceptedDrift?: AcceptedDrift[],
  options?: { bible?: Partial<Bible> | null },
): CheckCell[];
export declare function partCells(
  episode: Partial<EpisodeFile>,
  partId: string,
  slots: Partial<PartSlots> | null | undefined,
  takeId: string,
  statusOf: (assetId: string) => string | undefined,
  acceptedDrift?: AcceptedDrift[],
  options?: { bible?: Partial<Bible> | null },
): CheckCell[];
export interface UsedIdeas {
  episodes: Array<{ episode: string; title: string; location: string; goal: string; abilities: string[]; ending: string }>;
  locations: string[];
  goals: string[];
  abilities: string[];
  endings: string[];
}
export declare function usedIdeas(bible: Partial<Bible>, episodes: Array<Partial<Episode>>): UsedIdeas;
export type EpisodeStage = "draft" | "planned" | "boarded" | "shot" | "reviewed" | "done";
export interface StageResult {
  stage: EpisodeStage;
  busy: boolean;
  /** Cells of the cut in effect without a verdict (0 before every part has a take). */
  unverified: number;
  /** A ready final built from the takes in effect exists (with `unverified > 0`, the stage stays `reviewed`). */
  finalReady: boolean;
}
export declare function episodeStage(
  episode: Partial<Episode>,
  slots: Partial<EpisodeSlots> | null | undefined,
  statusOf: (assetId: string) => string | undefined,
): StageResult;

export declare function checkBible(bible: unknown): string[];
export declare function checkEpisodeFile(episode: unknown, bible?: Partial<Bible> | null): string[];

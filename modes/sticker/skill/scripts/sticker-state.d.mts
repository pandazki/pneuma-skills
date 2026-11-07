/**
 * Types for `sticker-state.mjs` — and the shapes of the two files it reads.
 * The scripts stay plain ESM; this declaration keeps `tsc --noEmit` honest
 * for the tests and for the viewer's `domain.ts`.
 *
 *   pack.json                Pack            (agent Edit + viewer Source.write)
 *   project.json → "sticker" StickerSidecar  (machine state; sticker.mjs is the only writer)
 */

import type { CraftAsset, CraftProjectFile, CraftProvenanceEdge } from "../../../_shared/scripts/craft-project.mjs";

// ---------------------------------------------------------------------------
// Messages — what the rules say, as codes (English: `messageText`)
// ---------------------------------------------------------------------------

/** A stable code, its parameters, and the sticker.mjs command that takes the step, when there is one. */
export interface Said<C extends string, P> {
  code: C;
  params: P;
  command?: string;
}
type None = Record<string, never>;
type Ids = { stickers: string[] };
type Size = { width: number; height: number };
type TextLength = { length: number; width: boolean };

export type StateMessage =
  // take staleness
  | Said<"stale.sticker-gone", { sticker: string }>
  | Said<"stale.no-record", { take: string }>
  | Said<"stale.changed", { field: "description" | "style" | "word" | "caption" | "action" }>
  | Said<"stale.no-prompt", None>
  | Said<"stale.prompt", None>
  | Said<"stale.motion", { key: "frames" | "frameMs" | "size"; from: number | null; to: number }>
  | Said<"stale.anchor", { from: string | null; to: string | null }>
  // a sticker's state
  | Said<"state.in-flight", { takes: string[] }>
  | Said<"state.unpicked", None>
  | Said<"state.pick-not-ready", { take: string; status: string | null }>
  | Said<"state.ready-takes", { takes: string[] }>
  | Said<"state.failed", { count: number }>
  // the character anchor
  | Said<"anchor.unset", None>
  | Said<"anchor.not-ready", { anchor: string; status: string | null }>
  // where an export comes from
  | Said<"source.no-sticker", None>
  | Said<"source.sticker", { sticker: string; status: StickerStatus; why: StateMessage[] }>
  | Said<"source.art-unpicked", { art: ArtKind }>
  | Said<"source.art-not-ready", { art: ArtKind; asset: string; status: string | null }>
  // an export's state
  | Said<"export.not-exported", None>
  | Said<"export.from-other", { from: string; now: string }>
  | Said<"export.other-inputs", None>
  | Said<"export.again", { why: StateMessage }>
  | Said<"export.optional-none", { why: StateMessage; platform: Platform }>
  | Said<"export.measured", { problems: StateMessage[]; summary: StateMessage }>
  // an exported file against its platform's rules
  | Said<"file.bytes-over", { bytes: number; max: number }>
  | Said<"file.format", { format: string; expected: string[] }>
  | Said<"file.size", Size & { expectedWidth: number; expectedHeight: number }>
  | Said<"file.loop-none", None>
  | Said<"file.loop-count", { count: number }>
  | Said<"file.still", None>
  | Said<"file.codec", { format: string; codec: string | null }>
  | Said<"file.no-alpha", None>
  | Said<"file.telegram-edge", Size & { edge: number }>
  | Said<"file.duration-over", { ms: number; max: number }>
  | Said<"file.fps-over", { fps: number; max: number }>
  | Said<"file.audio", None>
  | Said<"file.outside", Size & { maxWidth: number; maxHeight: number }>
  | Said<"file.min-side", Size & { min: number }>
  | Said<"file.frames-range", { frames: number; min: number; max: number }>
  | Said<"file.loop-long", { ms: number; max: number }>
  /** `plays` 0 = forever. */
  | Said<"file.plays-range", { plays: number; min: number; max: number }>
  | Said<"file.plays-total", { plays: number; ms: number; max: number }>
  | Said<"file.main-plays", { plays: number; ms: number; min: number; max: number; maxTotal: number }>
  | Said<"file.identical", None>
  | Said<"file.not-transparent", None>
  | Said<"file.margin", { px: number }>
  | Said<"file.first-frame", { percent: number }>
  | Said<"file.corner", None>
  | Said<"file.white-outline", { percent: number }>
  | Said<"file.not-opaque", None>
  | Said<"file.white-background", { percent: number }>
  | Said<"file.take-stale", { why: StateMessage[] }>
  // what an exported file is
  | Said<"summary.wechat", Size & { bytes: number; frames: number; loops: boolean }>
  | Said<"summary.telegram", Size & { alpha: boolean; bytes: number; ms: number; fps: number }>
  | Said<"summary.line", Size & { bytes: number; frames: number; ms: number; plays: number }>
  | Said<"summary.still", Size & { format: string; bytes: number }>
  /** A still made from a sticker's frame (Telegram's thumbnail with no portrait art). */
  | Said<"summary.still-from-sticker", Size & { format: string; bytes: number; sticker: string; frame: number }>
  // checklist rows
  | Said<"rights.ok", { basis: RightsBasis; confirmedAt: string; note: string }>
  | Said<"rights.missing", None>
  | Said<"platform.unchosen", { platform: Platform }>
  | Said<"count.allowed", { count: number; platform: Platform; allowed: number[] }>
  | Said<"count.range", { count: number; platform: Platform; min: number; max: number; setMax: number | null }>
  | Said<"animated.static", Ids>
  | Said<"animated.all", { count: number }>
  | Said<"words.bad", { long: { sticker: string; word: string }[]; dupes: { sticker: string; word: string }[]; max: number }>
  | Said<"words.ok", { count: number; max: number }>
  | Said<"emoji.bad", { items: { sticker: string; emoji: string }[] }>
  | Said<"emoji.ok", None>
  | Said<"listing.empty", { platform: Platform; field: string }>
  | Said<"listing.unset", None>
  | Said<"listing.bad", { text: string; problems: StateMessage[] }>
  | Said<"listing.long", TextLength & { text: string; best: number }>
  | Said<"listing.ok", TextLength & { text: string; max: number | null; min: number | null }>
  /** `width`: LINE's count, Asian characters 2. */
  | Said<"text.over", TextLength & { max: number }>
  | Said<"text.under", TextLength & { min: number }>
  | Said<"text.punctuation", None>
  /** `over`: the byte limit the archive exceeds, else null. */
  | Said<"zip.ok", { uri: string; bytes: number; files: number; over: number | null }>
  | Said<"zip.blocked", None>
  | Said<"zip.missing", { platform: Platform }>
  | Said<"zip.stale", { platform: Platform }>
  | Said<"unconfirmed.reward-thumb", None>
  | Said<"unconfirmed.zip-naming", None>
  // the next step
  | Said<"next.rights", None>
  | Said<"next.anchor", { candidates: string[] }>
  | Said<"next.describe", None>
  | Said<"next.character", None>
  | Said<"next.stickers", None>
  | Said<"next.generate", Ids & { uncertain: string[] }>
  | Said<"next.recover", Ids>
  | Said<"next.retry", Ids>
  | Said<"next.generating", Ids>
  | Said<"next.pick", Ids>
  | Said<"next.reroll", { stale: { sticker: string; why: StateMessage[] }[] }>
  | Said<"next.export", { platform: Platform }>
  | Said<"next.check", { platform: Platform; rows: { id: string; label: string }[] }>
  | Said<"next.confirm", { rows: { platform: Platform; id: string; label: string }[] }>
  | Said<"next.done", None>;

export type MessageCode = StateMessage["code"];
export type MessageParams<C extends MessageCode> = Extract<StateMessage, { code: C }>["params"];
/** Every code the rules can say (the keys of the English table). */
export const MESSAGE_CODES: readonly MessageCode[];
/** The message in English — what sticker.mjs prints — with ` — <command>` when it has one. Throws on an unknown code. */
export function messageText(message: StateMessage): string;

// ---------------------------------------------------------------------------
// pack.json
// ---------------------------------------------------------------------------

export type Platform = "wechat" | "telegram" | "line";
export type RightsBasis = "original" | "own-pet" | "self" | "consenting-adult" | "client";
export type ArtKind = "portrait" | "head" | "banner" | "reward-guide" | "reward-thanks";
export type StickerStatus = "empty" | "generating" | "failed" | "pick" | "ready" | "stale";

export interface Rights {
  basis: RightsBasis;
  /** Who / what, in a sentence ("our own mascot", "the client confirmed in writing"). */
  note: string;
  /** YYYY-MM-DD. */
  confirmedAt: string;
}

export interface Character {
  /** Identity features in English; part of every prompt. */
  description: string;
  /** Default `DEFAULT_STYLE`. */
  style: string;
  /** The picked character asset id (`character-<n>`), or null. */
  anchor: string | null;
}

export interface Motion {
  /** Default 16. */
  frames: number;
  /** Default 120. */
  frameMs: number;
  /** Square edge in px, a multiple of 16; default 512. */
  size: number;
}

export interface WechatListing {
  /** 表情名称: ≤ 8 characters, no punctuation (≤ 5 shows best). */
  name?: string;
  /** 表情介绍: ≤ 80. */
  intro?: string;
  /** 版权: ≤ 10. */
  copyright?: string;
  /** 赞赏引导语: 5–15. Setting it turns the reward art on. */
  rewardLine?: string;
}
export interface TelegramListing {
  title?: string;
  shortName?: string;
}
export interface LineListing {
  /** ≤ 40 (Asian characters count 2). */
  title?: string;
  /** ≤ 50. */
  creator?: string;
  /** ≤ 160. */
  description?: string;
  /** ≤ 50. */
  copyright?: string;
}
export interface Listing {
  wechat?: WechatListing;
  telegram?: TelegramListing;
  line?: LineListing;
}

export interface Sticker {
  /** `^s[0-9]{2,3}$`, stable; export numbering follows array order. */
  id: string;
  /** WeChat 含义词 (≤ 4, unique in the set); the meaning the prompt uses when `caption` is empty. */
  word: string;
  /** Drawn by the model; "" = no text in the sticker. */
  caption: string;
  /** Telegram's emoji: exactly one. */
  emoji: string;
  /** The motion, in English. */
  action: string;
  /** The picked take (`<id>-take-<n>`), or null. */
  take: string | null;
  /** 0-based frame indices of the take to keep (≥ 2, increasing), or null for all. */
  keepFrames: number[] | null;
}

/** Picked art asset ids by kind (`art-<kind>-<n>`), plus LINE's main-image sticker. */
export interface PackArt {
  portrait?: string;
  head?: string;
  banner?: string;
  "reward-guide"?: string;
  "reward-thanks"?: string;
  /** Sticker id whose take becomes LINE's main image; default the first sticker. */
  lineMain?: string;
}

/** A pack after `validatePack`: defaults applied, absent containers present. */
export interface Pack {
  version: 1;
  /** null until recorded — every paid command refuses without it. */
  rights: Rights | null;
  platforms: Platform[];
  character: Character;
  motion: Motion;
  listing: Listing;
  stickers: Sticker[];
  art: PackArt;
}

export interface PackIssue {
  /** The field: `version`, `rights.basis`, `stickers[2].caption`, `listing.line.title`, … */
  path: string;
  /** Starts with the path. */
  message: string;
}

export type PackParse =
  | { ok: true; pack: Pack; warnings: string[] }
  | { ok: false; errors: PackIssue[]; warnings: string[] };

// ---------------------------------------------------------------------------
// project.json → "sticker"
// ---------------------------------------------------------------------------

export interface AlphaMeasure {
  /** The file carries an alpha channel (WebM: alpha_mode 1; PNG: RGBA or a tRNS palette). */
  channel: boolean;
  /** Fraction of all pixels (all frames) that are fully transparent. */
  clear: number;
  /** Fraction with 0 < alpha < 255. */
  semi: number;
  /** All four corners of every frame are transparent. */
  cornersClear: boolean;
  /** On frame 0, the share of outline pixels that are near-white. */
  edgeWhite: number;
}

export interface MotionMeasure {
  /** Mean |Δ premultiplied luma| / 255 between frame i-1 and i. */
  steps: number[];
  mean: number;
  /** The same between the last frame and the first. */
  seam: number;
  /** seam / median step; > 2 reads as a jump in the loop. */
  seamRatio: number | null;
  /** px the bottom of the figure moves across frames. */
  groundDrift: number;
  /** (max − min figure height) / median height. */
  sizeDrift: number;
  /** Indices of frames with nothing visible. */
  emptyFrames: number[];
}

export interface ExportFit {
  /** False when no setting met the byte limit (the best attempt was kept; the check fails it). */
  ok: boolean;
  colors?: number;
  /** Frame decimation step (1 = every frame). */
  step?: number;
  crf?: number;
  /** < 1 when the loop was played faster to fit a time limit. */
  speed?: number;
  /** LINE: times the loop repeats inside the file to reach 5 frames. */
  repeats?: number;
  plays?: number;
  /** Stills: png | png-palette | png-opaque | jpg. */
  format?: string;
  quality?: number;
}

/**
 * What sticker.mjs measured of a file when it landed or exported it. Takes,
 * exports, art and character images share the shape; fields that do not
 * apply are absent.
 */
export interface Measure {
  format: "gif" | "apng" | "webm" | "png" | "jpg";
  bytes: number;
  width: number;
  height: number;
  /** Animations. */
  frames?: number;
  delaysMs?: number[];
  /** One loop, ms. */
  durationMs?: number;
  /** WebM. */
  fps?: number;
  /** GIF NETSCAPE count (0 = forever, null = no loop block); APNG num_plays (0 = forever); WebM null. */
  loopCount?: number | null;
  codec?: string;
  hasAudio?: boolean;
  alpha?: AlphaMeasure;
  /** Takes landed without ffmpeg: pixel numbers not measured. */
  pixels?: null;
  /** `inspect` of a trimmed take: the kept frames (0-based) the numbers are over, of `framesInTake`. */
  kept?: number[];
  framesInTake?: number;
  /** Every frame byte-identical. */
  identical?: boolean;
  /** Frame 0's figure coverage / the median frame's. */
  firstFrameCoverage?: number;
  /** Empty px between the figure (all frames) and the nearest edge. */
  margin?: number | null;
  motion?: MotionMeasure;
  /** Opaque stills: share of near-white pixels. */
  nearWhite?: number;
  /** Exports: the `exportKey` the file was made from. */
  key?: string;
  fit?: ExportFit;
  /** Epoch ms the measurement was recorded. */
  at?: number;
}

export interface ArchiveRecord {
  /** `exports/<platform>.zip`. */
  uri: string;
  bytes: number;
  /** File names inside, in order. */
  entries: string[];
  /** `archiveKey` of its members. */
  key: string;
  at: number;
}

export interface StickerSidecar {
  schema: 1;
  /** By asset id: takes, character and art images, every export. */
  measures: Record<string, Measure>;
  /** By platform: the upload archive (not a craft asset). */
  archives: Partial<Record<Platform, ArchiveRecord>>;
}

export type StickerProject = CraftProjectFile<{ sticker: StickerSidecar }>;
/** The sidecar without records the project no longer backs (measures of absent assets, archives of absent files). */
export function pruneSidecar(project: ProjectInput): { sidecar: StickerSidecar; dropped: { measures: string[]; archives: string[] } };
/** A project as read (or null before the first write). */
type ProjectInput = Pick<CraftProjectFile, "assets" | "provenance"> & { sticker?: unknown } | null | undefined;

// ---------------------------------------------------------------------------
// Platform profiles (data)
// ---------------------------------------------------------------------------

export interface ProfileSource {
  url: string;
  what: string;
}

export interface DeliverableSpec {
  label: string;
  /** Art kind it derives from, or "sticker" (LINE main image). */
  from: ArtKind | "sticker";
  formats: readonly ("png" | "jpg" | "apng")[];
  width: number;
  height: number;
  maxBytes: number;
  alpha: "transparent" | "opaque";
  fit: "pad" | "cover";
  /** The background must not be mostly white (WeChat banner). */
  notWhite?: boolean;
  /** No white outline around the figure: a rule of the WeChat cover (表情封面图) only. */
  noWhiteOutline?: boolean;
  /** Only when the WeChat listing has a rewardLine. */
  when?: "reward";
  /** Telegram thumbnail: absent art is a pass. */
  optional?: boolean;
  /** Telegram thumbnail: with no art picked, made from the first sticker's first kept frame. */
  fallback?: "first-sticker";
  animated?: boolean;
}

export interface TextSpec {
  label: string;
  max?: number;
  min?: number;
  best?: number;
  noPunctuation?: boolean;
  /** LINE: Asian characters count 2. */
  asianWidth?: boolean;
  required: boolean;
}

export interface UnconfirmedRule {
  id: string;
  label: string;
  detail: string;
  when?: "reward";
}

export interface PlatformProfile {
  id: Platform;
  label: string;
  /** When the official pages were read. */
  checked: string;
  sources: readonly ProfileSource[];
  count: { min?: number; max?: number; setMax?: number; allowed?: readonly number[] };
  sticker: Record<string, unknown> & { format: "gif" | "webm" | "apng"; ext: "gif" | "webm" | "png"; maxBytes: number };
  deliverables: Record<string, DeliverableSpec>;
  text: Record<string, TextSpec>;
  word?: { max: number; unique: boolean };
  emoji?: { min: number; max: number; exported: number };
  zip?: { maxBytes: number };
  listingFile: string;
  /** Rules with no official value: a warning row, never a pass. */
  unconfirmed: readonly UnconfirmedRule[];
}

export const PACK_VERSION: 1;
export const SIDECAR_KEY: "sticker";
export const SIDECAR_SCHEMA: 1;
export const PLATFORMS: readonly Platform[];
export const RIGHTS_BASES: readonly RightsBasis[];
export const ART_KINDS: readonly ArtKind[];
export const STICKER_STATUSES: readonly StickerStatus[];
export const STICKER_ID_RE: RegExp;
export const ASSET_ID_RE: RegExp;
export const DATE_RE: RegExp;
export const DEFAULT_STYLE: string;
export const DEFAULT_MOTION: Readonly<Motion>;
export const TAKE_REQUEST_DEFAULTS: Readonly<{ quality: string; background: string; model: string }>;
/** Part of every export key; bumped when the exporter's bytes would change. */
export const EXPORT_RECIPES: Readonly<Record<Platform, number>>;
export const ESTIMATES: Readonly<{
  gifUsd: number;
  gifRangeUsd: readonly [number, number];
  gifSeconds: number;
  imageUsd: number;
  imageSeconds: readonly [number, number];
  note: string;
}>;
export const PLATFORM_PROFILES: Readonly<Record<Platform, PlatformProfile>>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function canonicalJson(value: unknown): string;
export function fnv1a(text: string): string;
export function hashValue(value: unknown): string;
/** craft's rule: an absent status is `ready`; undefined for no asset. */
export function assetStatus(asset: Pick<CraftAsset, "status"> | null | undefined): CraftAsset["status"] | undefined;
export function charLength(text: string): number;
export function asianWidthLength(text: string): number;
export function hasPunctuation(text: string): boolean;
export function isSingleEmoji(text: string): boolean;
/** "Chinese" | "Japanese" | "Korean" | "". */
export function captionLanguage(caption: string): string;

export function validatePack(value: unknown): PackParse;
export function parsePack(text: string): PackParse;

export const ids: Readonly<{
  characterSource(n: number): string;
  character(n: number): string;
  take(sid: string, n: number): string;
  art(kind: ArtKind, n: number): string;
  exported(platform: Platform, deliverable: string): string;
}>;
export const paths: Readonly<{
  characterSource(n: number, ext: string): string;
  character(n: number, ext?: string): string;
  take(sid: string, n: number): string;
  art(kind: ArtKind, n: number, ext?: string): string;
  exportDir(platform: Platform): string;
  archive(platform: Platform): string;
  listing(platform: Platform): string;
  inspect(takeId: string): string;
}>;
export function nextNumber(project: ProjectInput, prefix: string): number;
export function characterAssets(project: ProjectInput): { candidates: CraftAsset[]; sources: CraftAsset[] };
export function artAssets(project: ProjectInput, kind: ArtKind): CraftAsset[];

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

export interface StickerRequest {
  frames: number;
  frameMs: number;
  size: number;
  quality: string;
  background: string;
  model: string;
}
export interface PromptInputs {
  description: string;
  style: string;
  word: string;
  caption: string;
  action: string;
}
export function stickerRequest(pack: Pack): StickerRequest;
export function stickerPromptInputs(pack: Pack, sticker: Sticker): PromptInputs;
/** The white die-cut border clause every take carries (the 2026-11-06 outline experiment). */
export const STICKER_BORDER: string;
/** THE prompt for a take; recorded on its edge; the viewer recomputes it for staleness. */
export function stickerPrompt(pack: Pack, sticker: Sticker): string;
export function characterPrompt(pack: Pack, options?: { fromImage?: boolean }): string;
/** `themed` kinds are scenes; their prompt carries the pack's theme (`packTheme`). */
export const ART_SPECS: Readonly<Record<ArtKind, { aspectRatio: string; background: "transparent" | "opaque"; themed: boolean; body: string }>>;
/** What the pack is about: the first chosen platform's listing name and blurb, and the stickers' words. */
export function packTheme(pack: Pack): { name: string; about: string; words: string[] };
export function artPrompt(pack: Pack, kind: ArtKind): { prompt: string; aspectRatio: string; background: "transparent" | "opaque" };

// ---------------------------------------------------------------------------
// Takes and status
// ---------------------------------------------------------------------------

export interface TakeView {
  id: string;
  n: number;
  status: CraftAsset["status"];
  asset: CraftAsset;
  edge: CraftProvenanceEdge | null;
  actor: "agent" | "human" | null;
  op: string | null;
}
export function takesOf(project: ProjectInput, sid: string): TakeView[];
export interface Staleness {
  stale: boolean;
  /** `messages` in English. */
  reasons: string[];
  messages: StateMessage[];
}
export function takeStaleness(pack: Pack, project: ProjectInput, takeId: string): Staleness;

export interface StickerState {
  id: string;
  status: StickerStatus;
  /** Why (stale reasons joined, what is in flight, what to pick); null for ready / empty. `messages` in English, joined with "; ". */
  reason: string | null;
  /** The same, as codes; empty for ready / empty. */
  messages: StateMessage[];
  /** Stale only: each reason. */
  reasons?: string[];
  /** Every take id, in number order. */
  takes: string[];
  ready: string[];
  failed: string[];
  inFlight: string[];
  /** pack.json's pick, as written. */
  picked: string | null;
  /** The picked take when it is ready (what exports use), else null. */
  effective: string | null;
}
export function stickerState(pack: Pack, project: ProjectInput, sid: string): StickerState;
export function stickerStates(pack: Pack, project: ProjectInput): StickerState[];
/** What `sticker.mjs gen` makes; gen, quote and nextStep all read this. */
export interface GenPlan {
  targets: { id: string; status: StickerStatus }[];
  skipped: { id: string; status: StickerStatus }[];
  /** Latest take failed with billing unknown: a plain gen leaves them; `only` naming them retries. */
  uncertain: {
    id: string;
    take: string | null;
    reason: string;
    /** The fal request the failed take was accepted under, when one is on record. */
    requestId: string | null;
    /** `recoverable(project, take)`: fetch it (`sticker.mjs recover`, free) before any retry. */
    recoverable: boolean;
  }[];
}
export function genTargets(pack: Pack, project: ProjectInput, options?: { only?: string[]; redo?: boolean }): GenPlan;
/** A failed take fal accepted (request id recorded, billing unknown) that nobody has fetched by that request yet. */
export function recoverable(project: ProjectInput, takeId: string): boolean;
export interface AnchorState {
  anchor: string | null;
  ready: boolean;
  /** `message` in English. */
  reason: string | null;
  message: StateMessage | null;
}
export function anchorState(pack: Pack, project: ProjectInput): AnchorState;

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export function exportNumber(index: number, total: number): string;
export function lineMainSticker(pack: Pack): string | null;

export interface Deliverable {
  /** Sticker id, or the deliverable name (cover, icon, banner, reward-guide, reward-thanks, thumb, main, tab). */
  deliverable: string;
  kind: "sticker" | "art" | "main";
  /** `<platform>-<deliverable>`. */
  assetId: string;
  /** File name without extension inside exports/<platform>/ ("01", "cover"). */
  name: string;
  /** Fixed for stickers and main; null for art (png or jpg, chosen by the exporter). */
  ext: string | null;
  sticker: string | null;
  art: ArtKind | null;
  optional?: boolean;
  /** Art with a `fallback` (Telegram's thumbnail): the sticker it is made from when no art is picked. */
  fallbackSticker?: string | null;
}
export function platformDeliverables(pack: Pack, platform: Platform): Deliverable[];
export interface DeliverableSourceResult {
  asset: CraftAsset | null;
  /** Set when a still is made from a sticker's picked take: which sticker, and its first kept frame. */
  sticker?: string;
  frame?: number;
  reason: string | null;
  message: StateMessage | null;
}
export function deliverableSource(pack: Pack, project: ProjectInput, item: Deliverable): DeliverableSourceResult;
/** Hash of everything the deliverable's bytes depend on; null while its source is missing. */
export function exportKey(pack: Pack, project: ProjectInput, platform: Platform, item: Deliverable): string | null;
export function sidecarOf(project: ProjectInput): StickerSidecar;
export function archiveKey(platform: Platform, members: [string | null, string | null][]): string;

export type ExportItemState = "current" | "stale" | "missing" | "blocked";
export interface ExportItem extends Deliverable {
  /** The export asset's uri, when it exists. */
  file: string | null;
  measure: Measure | null;
  /** A still made from a sticker's frame, not from art: which sticker and frame. */
  derivedFrom: { sticker: string; frame: number } | null;
  key: string | null;
  state: ExportItemState;
  /** `message` in English; null when current. */
  reason: string | null;
  message: StateMessage | null;
}
export interface ExportState {
  platform: Platform;
  items: ExportItem[];
  archive: { state: ExportItemState; key: string | null; uri: string; measure: ArchiveRecord | null };
  /** Anything missing or stale (blocked items alone do not count). */
  stale: boolean;
}
export function exportState(pack: Pack, project: ProjectInput, platform: Platform): ExportState;

// ---------------------------------------------------------------------------
// Checks and next step
// ---------------------------------------------------------------------------

export interface ViewerAddressLike {
  sticker?: string;
  frame?: number;
  take?: string;
  art?: ArtKind;
  character?: true;
  platform?: Platform;
}

export type CheckLevel = "pass" | "warn" | "fail";
export interface CheckRow {
  /** Unique within one platform's rows: rights, platform, count, sticker-<sid>, cover, icon, banner,
   *  reward-guide, reward-thanks, thumb, main, tab, all-animated, words, emoji, listing-<field>, zip,
   *  reward-thumb, zip-naming. */
  id: string;
  label: string;
  level: CheckLevel;
  /** `message` in English (with its command, when it has one). */
  detail: string;
  message: StateMessage;
  address?: ViewerAddressLike;
}
export function checkPack(pack: Pack, project: ProjectInput, platform: Platform): CheckRow[];
export function tally(rows: CheckRow[]): Record<CheckLevel, number>;

export interface NextStep {
  /**
   * `recover`: takes fal accepted that never arrived — fetched by request, free, before anything else.
   * `retry`: only stickers whose last take failed with billing unknown are left — a retry is the user's call, never a gap to fill.
   * `confirm`: nothing fails, but warnings remain for the person to confirm by hand; `done` has none.
   */
  id: "rights" | "anchor" | "character" | "stickers" | "recover" | "generate" | "retry" | "generating" | "pick" | "reroll" | "export" | "check" | "confirm" | "done";
  /** `message` in English. */
  line: string;
  message: StateMessage;
  /** The sticker.mjs command that takes the step, when there is one. */
  command?: string;
  stickers?: string[];
}
export function nextStep(pack: Pack, project: ProjectInput): NextStep;

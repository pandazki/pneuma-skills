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
export function takeStaleness(pack: Pack, project: ProjectInput, takeId: string): { stale: boolean; reasons: string[] };

export interface StickerState {
  id: string;
  status: StickerStatus;
  /** Why (stale reasons joined, what is in flight, what to pick); null for ready / empty. */
  reason: string | null;
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
  uncertain: { id: string; take: string | null; reason: string }[];
}
export function genTargets(pack: Pack, project: ProjectInput, options?: { only?: string[]; redo?: boolean }): GenPlan;
export function anchorState(pack: Pack, project: ProjectInput): { anchor: string | null; ready: boolean; reason: string | null };

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
}
export function platformDeliverables(pack: Pack, platform: Platform): Deliverable[];
export function deliverableSource(pack: Pack, project: ProjectInput, item: Deliverable): { asset: CraftAsset | null; reason: string | null };
/** Hash of everything the deliverable's bytes depend on; null while its source is missing. */
export function exportKey(pack: Pack, project: ProjectInput, platform: Platform, item: Deliverable): string | null;
export function sidecarOf(project: ProjectInput): StickerSidecar;
export function archiveKey(platform: Platform, members: [string | null, string | null][]): string;

export type ExportItemState = "current" | "stale" | "missing" | "blocked";
export interface ExportItem extends Deliverable {
  /** The export asset's uri, when it exists. */
  file: string | null;
  measure: Measure | null;
  key: string | null;
  state: ExportItemState;
  reason: string | null;
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
  detail: string;
  address?: ViewerAddressLike;
}
export function checkPack(pack: Pack, project: ProjectInput, platform: Platform): CheckRow[];
export function tally(rows: CheckRow[]): Record<CheckLevel, number>;

export interface NextStep {
  id: "rights" | "anchor" | "character" | "stickers" | "generate" | "generating" | "pick" | "reroll" | "export" | "check" | "done";
  line: string;
  /** The sticker.mjs command that takes the step, when there is one. */
  command?: string;
  stickers?: string[];
}
export function nextStep(pack: Pack, project: ProjectInput): NextStep;

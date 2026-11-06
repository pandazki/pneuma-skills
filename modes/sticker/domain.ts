/**
 * Sticker domain — `loadPack` / `savePack` for the `pack` aggregate source,
 * plus the pure edits the viewer writes back.
 *
 * Two files make one pack:
 *
 *   pack.json      the pack — text and the person's decisions (agent Edit +
 *                  this viewer)
 *   project.json   the craft project; its `sticker` sidecar holds the
 *                  measurements. Only `sticker.mjs` writes it.
 *
 * EVERY RULE LIVES ELSEWHERE. Validation, prompts, take staleness, the
 * per-sticker status, export staleness, the platform checklists and the next
 * step come from `skill/scripts/sticker-state.mjs`, the module the CLI runs;
 * reading the craft project and pricing its calls come from
 * `_shared/scripts/craft-project.mjs`. This file only arranges their answers
 * into what the viewer draws, so the viewer can never read `ready` where
 * `sticker.mjs status` reads `stale`.
 *
 * `savePack` writes pack.json — never project.json, never a delete — and
 * only when the pack's value changed, keeping its key order, unknown keys
 * and indentation so an edit is a minimal diff.
 */

import type { ViewerFileContent } from "../../core/types/viewer-contract.js";
import type {
  CraftAsset,
  CraftAssetStatus,
  CraftCost,
  CraftCostSummary,
  CraftFailure,
} from "../_shared/scripts/craft-project.mjs";
import { indexAssets, readProjectFile, statusOf, summarizeCosts } from "../_shared/scripts/craft-project.mjs";
import type {
  AnchorState,
  ArtKind,
  CheckLevel,
  CheckRow,
  ExportItem,
  ExportState,
  Measure,
  NextStep,
  Pack,
  PackIssue,
  Platform,
  PlatformProfile,
  Staleness,
  Sticker,
  StickerProject,
  StickerState,
} from "./skill/scripts/sticker-state.mjs";
import {
  ART_KINDS,
  PLATFORM_PROFILES,
  SIDECAR_KEY,
  anchorState,
  artAssets,
  characterAssets,
  checkPack,
  exportNumber,
  exportState,
  nextStep,
  parsePack,
  platformDeliverables,
  sidecarOf,
  stickerState,
  takeStaleness,
  takesOf,
  tally,
  validatePack,
} from "./skill/scripts/sticker-state.mjs";

export type {
  ArtKind,
  CheckLevel,
  CheckRow,
  ExportItem,
  ExportItemState,
  ExportState,
  Measure,
  NextStep,
  Pack,
  PackIssue,
  Platform,
  PlatformProfile,
  Sticker,
  StickerState,
  StickerStatus,
  StateMessage,
  MessageCode,
  MessageParams,
} from "./skill/scripts/sticker-state.mjs";

export const PACK_PATH = "pack.json";
export const PROJECT_PATH = "project.json";

type Json = Record<string, unknown>;

// ── What the viewer draws ──────────────────────────────────────────────────

/** One craft asset as the viewer needs it: state, file, provenance, measurement. */
export interface AssetBrief {
  id: string;
  type: CraftAsset["type"];
  status: CraftAssetStatus;
  /** Relative to the workspace root; "" until the file lands. */
  uri: string;
  /** Epoch ms the file landed — the cache-buster on its URL. */
  createdAt: number;
  name: string;
  width: number | null;
  height: number | null;
  actor: "agent" | "human" | null;
  op: string | null;
  model: string | null;
  /** Epoch ms the call was reserved (the edge's timestamp): "generating for N s". */
  submittedAt: number | null;
  failure: CraftFailure | null;
  cost: CraftCost | null;
  /** What sticker.mjs measured of the file, when it did. */
  measure: Measure | null;
}

export interface TakeView extends AssetBrief {
  n: number;
  /** pack.json picks this take. */
  picked: boolean;
  /** Ready takes only: `takeStaleness` against pack.json as it is now. */
  staleness: Staleness | null;
}

export interface StickerView {
  id: string;
  index: number;
  /** Export number in pack order ("01"). */
  number: string;
  sticker: Sticker;
  /** `stickerState` — the status and its reason. */
  state: StickerState;
  takes: TakeView[];
  /** What plays on the card: the picked ready take, else the newest ready one (a pick candidate). */
  shown: TakeView | null;
  /** Failed takes whose billing is unknown — they may have been charged. */
  uncertain: string[];
}

export interface CharacterView {
  anchor: AnchorState;
  /** The anchor's asset, whatever its state. */
  asset: AssetBrief | null;
  candidates: AssetBrief[];
  sources: AssetBrief[];
}

export interface ArtKindView {
  kind: ArtKind;
  picked: string | null;
  /** The picked asset, whatever its state. */
  asset: AssetBrief | null;
  candidates: AssetBrief[];
  /** Deliverables of the chosen platforms this kind becomes. */
  becomes: Array<{ platform: Platform; deliverable: string; label: string }>;
}

export interface PlatformView {
  platform: Platform;
  profile: PlatformProfile;
  /** `checkPack` — the rows `sticker.mjs check` prints. */
  rows: CheckRow[];
  tally: Record<CheckLevel, number>;
  /** `exportState` — every deliverable's file and whether it is current. */
  exports: ExportState;
}

export interface PackCost {
  /** craft's total: priced calls, excluding provably unbilled ones. */
  total: number;
  calls: number;
  estimate: number;
  reported: number;
  inFlight: string[];
  /** Failed with billing unknown — counted in the total; whether they were charged is not knowable. */
  uncertain: string[];
  unpriced: string[];
  notBilled: string[];
}

export interface StickerPack {
  /** pack.json as parsed — the value `savePack` writes back; null when absent or not JSON. */
  raw: Json | null;
  hasPack: boolean;
  /** Named errors (`stickers[2].caption: …`); a pack with errors is not drawn or edited. */
  packErrors: PackIssue[];
  packWarnings: string[];
  pack: Pack | null;
  /** The craft project as read strictly; `savePack` never writes it. */
  project: StickerProject | null;
  hasProject: boolean;
  /** project.json failed the strict craft reader — statuses are computed without it. */
  projectError: string | null;
  title: string;
  character: CharacterView | null;
  stickers: StickerView[];
  art: ArtKindView[];
  platforms: PlatformView[];
  next: NextStep | null;
  cost: PackCost;
  assets: Record<string, AssetBrief>;
}

// ── Small readers ──────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Json {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function numberMeta(asset: CraftAsset, key: string): number | null {
  const value = asset.metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function emptyCost(): PackCost {
  return { total: 0, calls: 0, estimate: 0, reported: 0, inFlight: [], uncertain: [], unpriced: [], notBilled: [] };
}

function costOf(summary: CraftCostSummary | null): PackCost {
  if (!summary) return emptyCost();
  return {
    total: summary.total,
    calls: summary.calls,
    estimate: summary.byBasis.estimate ?? 0,
    reported: summary.byBasis.reported ?? 0,
    inFlight: [...summary.inFlight],
    uncertain: [...summary.uncertain],
    unpriced: [...summary.unpriced],
    notBilled: [...summary.notBilled],
  };
}

function briefs(project: StickerProject | null): Record<string, AssetBrief> {
  const out: Record<string, AssetBrief> = {};
  if (!project) return out;
  const { assets, edges } = indexAssets(project);
  const measures = sidecarOf(project).measures;
  for (const [id, asset] of assets) {
    const edge = edges.get(id);
    const params = edge?.operation.params;
    out[id] = {
      id,
      type: asset.type,
      status: statusOf(asset),
      uri: asset.uri ?? "",
      createdAt: asset.createdAt,
      name: asset.name ?? id,
      width: numberMeta(asset, "width"),
      height: numberMeta(asset, "height"),
      actor: edge?.operation.actor ?? null,
      op: edge?.operation.type ?? null,
      model: typeof params?.model === "string" ? params.model : null,
      submittedAt: edge?.operation.timestamp ?? null,
      failure: (params?.failure as CraftFailure | undefined) ?? null,
      cost: (params?.cost as CraftCost | undefined) ?? null,
      measure: measures[id] ?? null,
    };
  }
  return out;
}

function titleOf(pack: Pack, project: StickerProject | null): string {
  const l = pack.listing;
  return (l.wechat?.name || l.telegram?.title || l.line?.title || project?.title || "").trim();
}

// ── Building the aggregate ─────────────────────────────────────────────────

function buildStickers(pack: Pack, project: StickerProject | null, assets: Record<string, AssetBrief>): StickerView[] {
  return pack.stickers.map((sticker, index) => {
    const state = stickerState(pack, project, sticker.id);
    const takes: TakeView[] = takesOf(project, sticker.id).map((t) => ({
      ...assets[t.id],
      n: t.n,
      picked: sticker.take === t.id,
      staleness: t.status === "ready" ? takeStaleness(pack, project, t.id) : null,
    }));
    const ready = takes.filter((t) => t.status === "ready");
    const shown = (state.effective ? takes.find((t) => t.id === state.effective) : null) ?? ready[ready.length - 1] ?? null;
    return {
      id: sticker.id,
      index,
      number: exportNumber(index, pack.stickers.length),
      sticker,
      state,
      takes,
      shown,
      uncertain: takes.filter((t) => t.status === "failed" && t.failure?.billing === "unknown").map((t) => t.id),
    };
  });
}

function buildCharacter(pack: Pack, project: StickerProject | null, assets: Record<string, AssetBrief>): CharacterView {
  const { candidates, sources } = characterAssets(project);
  const anchor = anchorState(pack, project);
  return {
    anchor,
    asset: anchor.anchor ? assets[anchor.anchor] ?? null : null,
    candidates: candidates.map((a) => assets[a.id]),
    sources: sources.map((a) => assets[a.id]),
  };
}

function buildArt(pack: Pack, project: StickerProject | null, assets: Record<string, AssetBrief>): ArtKindView[] {
  const becomes = new Map<ArtKind, ArtKindView["becomes"]>();
  for (const platform of pack.platforms) {
    for (const item of platformDeliverables(pack, platform)) {
      if (item.kind !== "art" || !item.art) continue;
      const label = PLATFORM_PROFILES[platform].deliverables[item.deliverable]?.label ?? item.deliverable;
      becomes.set(item.art, [...(becomes.get(item.art) ?? []), { platform, deliverable: item.deliverable, label }]);
    }
  }
  const out: ArtKindView[] = [];
  for (const kind of ART_KINDS) {
    const candidates = artAssets(project, kind).map((a) => assets[a.id]);
    const picked = pack.art[kind] ?? null;
    const uses = becomes.get(kind) ?? [];
    // A kind no chosen platform uses and nobody made or picked is not part of this pack.
    if (!uses.length && !candidates.length && !picked) continue;
    out.push({ kind, picked, asset: picked ? assets[picked] ?? null : null, candidates, becomes: uses });
  }
  return out;
}

function build(raw: Json | null, parseErrors: PackIssue[], hasPack: boolean, project: StickerProject | null, projectError: string | null): StickerPack {
  const parsed = raw ? validatePack(raw) : null;
  const pack = parsed?.ok ? parsed.pack : null;
  const packErrors = parsed && !parsed.ok ? parsed.errors : parseErrors;
  const packWarnings = parsed?.warnings ?? [];
  // A project the strict reader refused is not evidence of anything: the
  // rules run without it, and the viewer says why.
  const rules = projectError ? null : project;
  const assets = briefs(rules);
  const summary = rules ? summarizeCosts(rules) : null;
  const base = {
    raw,
    hasPack,
    packErrors,
    packWarnings,
    pack,
    project: rules,
    hasProject: project !== null || projectError !== null,
    projectError,
    cost: costOf(summary),
    assets,
  };
  if (!pack) {
    return { ...base, title: "", character: null, stickers: [], art: [], platforms: [], next: null };
  }
  return {
    ...base,
    title: titleOf(pack, rules),
    character: buildCharacter(pack, rules, assets),
    stickers: buildStickers(pack, rules, assets),
    art: buildArt(pack, rules, assets),
    platforms: pack.platforms.map((platform) => {
      const rows = checkPack(pack, rules, platform);
      return { platform, profile: PLATFORM_PROFILES[platform], rows, tally: tally(rows), exports: exportState(pack, rules, platform) };
    }),
    // The rules would answer for a pack with no record at all ("make the
    // character"), which is not this pack: its record exists and is unreadable.
    next: projectError ? null : nextStep(pack, rules),
  };
}

/**
 * Files → StickerPack. Always returns a value: an empty workspace is a pack
 * with `hasPack: false`, which the viewer draws as its empty state, rather
 * than `null`, which would leave it waiting forever. Never throws — a
 * malformed pack.json or project.json is an error the viewer shows by name.
 */
export function loadPack(files: ReadonlyArray<ViewerFileContent>): StickerPack {
  let raw: Json | null = null;
  let parseErrors: PackIssue[] = [];
  let hasPack = false;
  let project: StickerProject | null = null;
  let projectError: string | null = null;
  for (const file of files) {
    if (file.path === PACK_PATH) {
      hasPack = true;
      try {
        const value: unknown = JSON.parse(file.content);
        if (isRecord(value)) raw = value;
        else parseErrors = [{ path: "pack.json", message: "pack.json: must be a JSON object" }];
      } catch {
        // parsePack names the JSON error the same way the CLI does.
        const parsed = parsePack(file.content);
        parseErrors = parsed.ok ? [] : parsed.errors;
      }
    } else if (file.path === PROJECT_PATH) {
      const read = readProjectFile<{ sticker: StickerProject["sticker"] }>(file.content, { sidecarKey: SIDECAR_KEY });
      if (read.ok) project = read.value as StickerProject;
      else projectError = read.error;
    }
  }
  return build(raw, parseErrors, hasPack, project, projectError);
}

/** Same JSON value, regardless of whitespace — a re-save must be a no-op. */
function sameJson(text: string | undefined, value: unknown): boolean {
  if (text === undefined) return false;
  try {
    return JSON.stringify(JSON.parse(text)) === JSON.stringify(value);
  } catch {
    return false;
  }
}

/** Serialise in the file's own indentation (default two spaces) with its trailing newline. */
function serializeLike(previous: string | undefined, value: unknown): string {
  const indent = previous ? /\n([ \t]+)"/.exec(previous)?.[1] ?? "  " : "  ";
  const newline = previous === undefined || previous.endsWith("\n") ? "\n" : "";
  return `${JSON.stringify(value, null, indent)}${newline}`;
}

/**
 * StickerPack → file operations. pack.json only, and only when its value
 * changed; never project.json, never a delete.
 */
export function savePack(
  value: StickerPack,
  current: ReadonlyArray<ViewerFileContent>,
): { writes: Array<{ path: string; content: string }>; deletes: string[] } {
  if (!value.raw) return { writes: [], deletes: [] };
  const previous = current.find((f) => f.path === PACK_PATH)?.content;
  if (sameJson(previous, value.raw)) return { writes: [], deletes: [] };
  return { writes: [{ path: PACK_PATH, content: serializeLike(previous, value.raw) }], deletes: [] };
}

// ── Lookups ────────────────────────────────────────────────────────────────

export function findSticker(value: StickerPack, id: string | null | undefined): StickerView | null {
  return id ? value.stickers.find((s) => s.id === id) ?? null : null;
}

export function findPlatform(value: StickerPack, platform: string | null | undefined): PlatformView | null {
  return platform ? value.platforms.find((p) => p.platform === platform) ?? null : null;
}

export function findArt(value: StickerPack, kind: string | null | undefined): ArtKindView | null {
  return kind ? value.art.find((a) => a.kind === kind) ?? null : null;
}

/** Takes still pending or generating, oldest first. */
export function inFlight(value: StickerPack): TakeView[] {
  return value.stickers
    .flatMap((s) => s.takes.filter((t) => t.status === "pending" || t.status === "generating"))
    .sort((a, b) => (a.submittedAt ?? 0) - (b.submittedAt ?? 0));
}

// ── Edits (pure; each returns a new StickerPack ready for `source.write`) ──

/** Edits work on a valid pack only; anything else names why first. */
function requireValid(value: StickerPack): void {
  if (!value.raw || !value.pack) {
    throw new Error(`pack.json is not valid — ${value.packErrors[0]?.message ?? "fix it before editing here"}`);
  }
}

/** Rebuild the derived state from an edited raw pack; the project is reused as read. */
function edit(value: StickerPack, mutate: (raw: Json) => void): StickerPack {
  requireValid(value);
  const raw = structuredClone(value.raw!);
  mutate(raw);
  return build(raw, [], true, value.project, value.projectError);
}

function rawSticker(raw: Json, id: string): Json {
  const list = Array.isArray(raw.stickers) ? (raw.stickers as unknown[]) : [];
  const found = list.find((s): s is Json => isRecord(s) && s.id === id);
  if (!found) throw new Error(`no sticker "${id}" in pack.json`);
  return found;
}

export type StickerField = "word" | "caption" | "emoji" | "action";
export const STICKER_FIELDS: readonly StickerField[] = ["word", "caption", "emoji", "action"];

/** A sticker's word, caption, emoji or action. Unchanged text is no edit at all. */
export function setStickerField(value: StickerPack, id: string, field: StickerField, text: string): StickerPack {
  requireValid(value);
  if (!STICKER_FIELDS.includes(field)) throw new Error(`"${field}" is not an editable sticker field (${STICKER_FIELDS.join(", ")})`);
  const view = findSticker(value, id);
  if (!view) throw new Error(`no sticker "${id}" in pack.json`);
  if (view.sticker[field] === text) return value;
  return edit(value, (raw) => {
    rawSticker(raw, id)[field] = text;
  });
}

/** Pick the take a sticker exports from: one of its ready takes. */
export function pickTake(value: StickerPack, id: string, takeId: string): StickerPack {
  requireValid(value);
  const view = findSticker(value, id);
  if (!view) throw new Error(`no sticker "${id}" in pack.json`);
  const take = view.takes.find((t) => t.id === takeId);
  if (!take) throw new Error(`no take "${takeId}" for ${id} (has: ${view.takes.map((t) => t.id).join(", ") || "none"})`);
  if (take.status !== "ready") throw new Error(`${takeId} is ${take.status} — only a ready take can be picked`);
  if (view.sticker.take === takeId) return value;
  return edit(value, (raw) => {
    rawSticker(raw, id).take = takeId;
  });
}

/** Pick the character every take is drawn from: one of the ready candidates. */
export function pickAnchor(value: StickerPack, assetId: string): StickerPack {
  requireValid(value);
  const candidates = value.character?.candidates ?? [];
  const found = candidates.find((a) => a.id === assetId);
  if (!found) throw new Error(`no character candidate "${assetId}" (has: ${candidates.map((a) => a.id).join(", ") || "none"})`);
  if (found.status !== "ready") throw new Error(`${assetId} is ${found.status} — only a ready character can be picked`);
  if (value.pack?.character.anchor === assetId) return value;
  return edit(value, (raw) => {
    raw.character = { ...(isRecord(raw.character) ? raw.character : {}), anchor: assetId };
  });
}

/** Pick the art of one kind the exports derive from. */
export function pickArt(value: StickerPack, kind: ArtKind, assetId: string): StickerPack {
  requireValid(value);
  if (!ART_KINDS.includes(kind)) throw new Error(`"${kind}" is not an art kind (${ART_KINDS.join(", ")})`);
  const view = findArt(value, kind);
  const found = view?.candidates.find((a) => a.id === assetId);
  if (!found) throw new Error(`no ${kind} art "${assetId}" (has: ${view?.candidates.map((a) => a.id).join(", ") || "none"})`);
  if (found.status !== "ready") throw new Error(`${assetId} is ${found.status} — only ready art can be picked`);
  if (view?.picked === assetId) return value;
  return edit(value, (raw) => {
    raw.art = { ...(isRecord(raw.art) ? raw.art : {}), [kind]: assetId };
  });
}

/** One listing text field of a chosen platform. */
export function setListingField(value: StickerPack, platform: Platform, field: string, text: string): StickerPack {
  requireValid(value);
  const profile = PLATFORM_PROFILES[platform];
  if (!profile) throw new Error(`"${platform}" is not a platform`);
  if (!value.pack?.platforms.includes(platform)) throw new Error(`${platform} is not in pack.platforms`);
  if (!(field in profile.text)) throw new Error(`"${field}" is not a ${profile.label} listing field (${Object.keys(profile.text).join(", ")})`);
  const now = (value.pack.listing[platform] as Record<string, string | undefined> | undefined)?.[field] ?? "";
  if (now === text) return value;
  return edit(value, (raw) => {
    const listing = isRecord(raw.listing) ? raw.listing : {};
    const fields = isRecord(listing[platform]) ? (listing[platform] as Json) : {};
    raw.listing = { ...listing, [platform]: { ...fields, [field]: text } };
  });
}

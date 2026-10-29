/**
 * Anime Series domain — `loadSeries` / `saveSeries` for the `series`
 * aggregate source, plus the pure edits the viewer writes back.
 *
 * Three kinds of file make one series:
 *
 *   bible.json                    human + agent text, `locks[]`
 *   episodes/<id>/episode.json    human + agent text, `picks`
 *   project.json                  the craft project; its `series` sidecar is
 *                                 machine state that only the scripts write
 *
 * EVERY RULE LIVES ELSEWHERE. Hashing, lock states, the stale-bible flag,
 * conservation of a part's seconds, the take in effect, an episode's stage
 * and the check cells come from `skill/scripts/series-state.mjs`, the module
 * the scripts run; reading the craft project, indexing its assets and
 * pricing its calls come from `_shared/scripts/craft-project.mjs`. This file
 * only arranges their answers into what the viewer draws, so the viewer can
 * never read `locked` where a script would read `edited`.
 *
 * `saveSeries` writes bible.json and episode.json — the text and the
 * decisions a person makes (an edited field, a picked sheet, a lock, a
 * dragged second, an accepted drift). It never writes project.json:
 * generation, provenance, checks and cost belong to the scripts.
 */

import type { ViewerFileContent } from "../../core/types/viewer-contract.js";
import type {
  CraftAsset,
  CraftAssetStatus,
  CraftCost,
  CraftCostSummary,
  CraftFailure,
  CraftProjectFile,
} from "../_shared/scripts/craft-project.mjs";
import {
  edgeInputs,
  indexAssets,
  readProjectFile,
  statusOf,
  summarizeCosts,
} from "../_shared/scripts/craft-project.mjs";
import type {
  AcceptedDrift,
  AssembledPrompts,
  Basis,
  Bible,
  BibleFlag,
  BoardRecord,
  Character,
  CheckCell,
  EntityKind,
  Episode,
  EpisodeFile,
  EpisodePicks,
  EpisodeSlots,
  EpisodeStage,
  FinalRecord,
  Group,
  Issue,
  Lineup,
  LockState,
  PanelRecord,
  Part,
  PartId,
  PartSlots,
  PatchRecord,
  ReviewRecord,
  ReviewStrip,
  Scene,
  SeriesSidecar,
  SheetCandidate,
  Shot,
  TakeRecord,
  TimelineEntry,
} from "./skill/scripts/series-state.mjs";
import {
  PART_IDS,
  STYLE_KEY,
  bibleFlag,
  bibleVersion,
  boardShotHashes,
  partCells,
  appliedPatches,
  checkEpisode,
  clipShotHashes,
  cutStaleShots,
  effectivePick,
  entityKey,
  episodeStage,
  latestLock,
  lockEntry,
  lockStates,
  partSeconds,
  rebalance,
  setupHash,
  sheetBasis,
  shotTimeline,
  staleShots,
  usedIdeas,
} from "./skill/scripts/series-state.mjs";

export type {
  Bible,
  Character,
  CheckCell,
  EntityKind,
  EpisodeFile,
  EpisodeStage,
  Group,
  Issue,
  LockState,
  PartId,
  Scene,
  Shot,
  TimelineEntry,
} from "./skill/scripts/series-state.mjs";

// ── Paths ──────────────────────────────────────────────────────────────────

export const BIBLE_PATH = "bible.json";
export const PROJECT_PATH = "project.json";
export const SIDECAR_KEY = "series";
const EPISODE_PATH_RE = /^episodes\/([^/]+)\/episode\.json$/;

export function episodePath(id: string): string {
  return `episodes/${id}/episode.json`;
}

// ── Types the viewer draws ─────────────────────────────────────────────────

type Json = Record<string, unknown>;

/** One craft asset as the viewer needs it: state, file, provenance, price. */
export interface AssetView {
  id: string;
  /** False when the sidecar names an id the craft project does not have. */
  exists: boolean;
  status: CraftAssetStatus | "missing";
  type: CraftAsset["type"] | null;
  /** Relative to the workspace root; "" until the file lands. */
  uri: string;
  name: string;
  createdAt: number;
  width: number | null;
  height: number | null;
  /** Seconds, for a clip, when the scripts measured it. */
  duration: number | null;
  model: string | null;
  /** The resolution the call asked for (`params.request.resolution`), when it was a render. */
  resolution: string | null;
  /** The prompt this call sent, as its provenance edge recorded it. */
  prompt: string | null;
  /** Input asset ids, in order (sheets, storyboard, …). */
  inputs: string[];
  /** Epoch ms the call was reserved (the edge's timestamp). */
  submittedAt: number | null;
  failure: CraftFailure | null;
  /** This call's own recorded price (`null` = unpriced, never free). */
  cost: CraftCost | null;
  /** Every billed attempt for this asset, summed; null when none is priced. */
  spent: number | null;
  /**
   * This asset's calls that failed with billing `unknown` — craft's
   * `summarizeCosts().uncertain` labels (`id`, or `id#n` for an earlier
   * attempt). Counted in `spent`: whether they were charged is not knowable.
   */
  uncertain: string[];
}

export type SheetState = "none" | "generating" | "failed" | "pick" | "ready";

export interface SheetCandidateView extends AssetView {
  basis: Basis | null;
  check: SheetCandidate["check"] | null;
  /** Sheet-prompt fields that changed since this candidate was drawn. */
  outdated: string[];
}

export interface DriftRef {
  episode: string;
  part: PartId;
  shot: number;
  /** The check cell key (`niuma`, `group:stickies`) — what `{check}` addresses. */
  check: string;
  /** The clip the verdict belongs to: the take, or the patch spliced over that shot. */
  take: string;
  note: string;
  accepted: boolean;
}

export interface EntityCard {
  key: string;
  kind: EntityKind;
  id: string;
  name: string;
  /** The raw entity, as bible.json holds it. */
  entity: Character | Group | Scene;
  lock: LockState;
  /** The picked sheet (`entity.sheet`), whatever its state. */
  sheet: SheetCandidateView | null;
  candidates: SheetCandidateView[];
  sheetState: SheetState;
  /** Episode ids this entity appears in (cast / groups / scene). */
  appearances: string[];
  /** Drift verdicts on this character in the takes in effect. */
  drift: DriftRef[];
}

export interface StyleCard {
  key: typeof STYLE_KEY;
  lock: LockState;
  style: string;
  sheetStyle: string;
  ratio: string;
  dialogue: boolean;
}

export interface Rec<R> {
  record: R;
  view: AssetView;
}

export interface PartView {
  id: PartId;
  index: number;
  /** Where this part starts on the episode clock, seconds. */
  offset: number;
  /** What the part's shots must add up to. */
  seconds: number;
  shots: Shot[];
  timeline: TimelineEntry[];
  boards: Rec<BoardRecord>[];
  board: Rec<BoardRecord> | null;
  /** The human picked this board (vs. the newest ready one standing in). */
  boardPicked: boolean;
  panels: Rec<PanelRecord>[];
  takes: Rec<TakeRecord>[];
  take: Rec<TakeRecord> | null;
  takePicked: boolean;
  patches: Rec<PatchRecord>[];
  /** Patches the final cut splices into the take in effect (series-state's appliedPatches). */
  applied: string[];
  /** The contact sheet made from the take in effect. */
  review: Rec<ReviewRecord> | null;
  /** Every contact sheet of this part, of takes and of patches, oldest first. */
  reviews: Rec<ReviewRecord>[];
  /**
   * Shot × cast-member and shot × group verdicts for the cut in effect (the
   * take, with applied patches judged on their own frames); `unverified`
   * when unread. A cell's `character` is its key (`niuma`, `group:stickies`).
   */
  checks: CheckCell[];
  /** Unaccepted drift verdicts per take id (every take, not only the one in effect). */
  takeDrift: Record<string, number>;
  /** 1-based shots whose panel text changed after the board was drawn. */
  staleBoard: number[];
  /** 1-based shots that changed (text, seconds or panel) after the take. */
  staleClip: number[];
  /** The episode setup (cast, place, time, duration) changed after the take. */
  setupStale: boolean;
  /** Shots with a single-panel redraw pending or generating. */
  redrawing: number[];
  prompts: AssembledPrompts | null;
}

export interface CostBucket {
  usd: number;
  count: number;
  inFlight: number;
}

export interface EpisodeCost {
  total: number;
  inFlight: number;
  unpriced: number;
  /** craft `uncertain` labels of this episode's calls: failed, billing unknown, counted in `total`. */
  uncertain: string[];
  boards: CostBucket;
  panels: CostBucket;
  takes: CostBucket;
  patches: CostBucket;
}

export interface CheckTally {
  ok: number;
  drift: number;
  accepted: number;
  unverified: number;
  /** The character is not in that shot — neither a pass nor a gap. */
  absent: number;
  /** Of those, how many the shot's own words name: a beat the clip lost. */
  lost: number;
}

/**
 * A check cell's verdict as the viewer draws it. Read as a string so a
 * verdict series-state adds later (`absent`) is drawn rather than misread.
 */
export type CellVerdict = "ok" | "drift" | "unverified" | "absent";

export function cellVerdict(cell: Pick<CheckCell, "verdict">): CellVerdict {
  const v = cell.verdict as string;
  return v === "ok" || v === "drift" || v === "absent" ? v : "unverified";
}

/**
 * Absent from a shot whose words name it (`expected`, series-state): the
 * clip dropped a beat — `series.mjs status` reports these as lost beats.
 */
export function isLostBeat(cell: Pick<CheckCell, "verdict" | "expected">): boolean {
  return cellVerdict(cell) === "absent" && cell.expected === true;
}

export interface EpisodeView {
  id: string;
  path: string;
  /** The raw episode as episode.json holds it (plus its directory id). */
  episode: Episode;
  title: string;
  duration: number;
  cast: string[];
  groups: string[];
  scene: string | null;
  stage: EpisodeStage;
  busy: boolean;
  /**
   * Shot × cast/group cells of the takes in effect nobody has checked
   * (series-state's episodeStage count). A "reviewed" episode with any is
   * not finished.
   */
  unverified: number;
  issues: { errors: Issue[]; warnings: Issue[] };
  parts: PartView[];
  /** Seconds each part runs. */
  partSeconds: number;
  /** Was the work in effect made under a bible that no longer holds? */
  flag: BibleFlag | null;
  final: Rec<FinalRecord> | null;
  cost: EpisodeCost;
  checks: CheckTally;
}

export interface BrokenEpisode {
  id: string;
  path: string;
  error: string;
}

export interface LineupView {
  record: Lineup;
  view: AssetView;
  /** The characters' names, in reference order. */
  names: string[];
  /** A character's picked sheet is no longer the one this lineup was drawn from. */
  stale: boolean;
}

/**
 * The season's spend, split so the lines add up to `total` (craft's
 * summarizeCosts): design sheets, lineups, season compilations, each
 * episode's own work (`EpisodeView.cost.total`), and whatever priced call
 * none of those claim (`other`, normally 0).
 */
export interface SeasonCost {
  total: number;
  inFlight: number;
  sheets: number;
  lineups: number;
  compilations: number;
  other: number;
  unpriced: number;
  uncertain: number;
}

export interface Series {
  /** Raw documents — what `saveSeries` serialises back. */
  raw: {
    bible: Json | null;
    episodes: Record<string, Json>;
  };
  /** bible.json exists and parses. */
  hasBible: boolean;
  bibleError: string | null;
  bible: Bible;
  /**
   * The craft project as read (strictly) from project.json — kept for
   * rebuilding after an edit; `saveSeries` never writes it.
   */
  project: CraftProjectFile | null;
  /** project.json failed the strict craft reader. */
  projectError: string | null;
  hasProject: boolean;
  sidecar: SeriesSidecar;
  title: string;
  version: number;
  lockedAt: string | null;
  style: StyleCard;
  cards: EntityCard[];
  episodes: EpisodeView[];
  broken: BrokenEpisode[];
  cost: SeasonCost;
  summary: CraftCostSummary | null;
  ideas: ReturnType<typeof usedIdeas>;
  /** The newest lineup probe (picked sheets side by side at one scale), if any. */
  lineup: LineupView | null;
  /** Asset lookup for stamps and media. */
  assets: Record<string, AssetView>;
}

// ── Small readers ──────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Json {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function list<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

function emptySidecar(): SeriesSidecar {
  return { schema: 1, sheets: {}, episodes: {}, compilations: [], lineups: [] };
}

function emptyPartSlots(): PartSlots {
  return { boards: [], panels: [], takes: [], patches: [], reviews: [], checks: {} };
}

function normalizeSidecar(value: unknown): SeriesSidecar {
  if (!isRecord(value)) return emptySidecar();
  return {
    schema: 1,
    sheets: isRecord(value.sheets) ? (value.sheets as SeriesSidecar["sheets"]) : {},
    episodes: isRecord(value.episodes) ? (value.episodes as SeriesSidecar["episodes"]) : {},
    compilations: list(value.compilations),
    lineups: list<Lineup>(value.lineups).filter((l) => isRecord(l) && typeof l.asset === "string"),
  };
}

function normalizeSlots(value: unknown): EpisodeSlots {
  if (!isRecord(value)) return { parts: {}, prompts: {}, finals: [] };
  const parts: EpisodeSlots["parts"] = {};
  if (isRecord(value.parts)) {
    for (const [id, slot] of Object.entries(value.parts)) {
      const s = isRecord(slot) ? slot : {};
      parts[id as PartId] = {
        ...emptyPartSlots(),
        boards: list(s.boards),
        panels: list(s.panels),
        takes: list(s.takes),
        patches: list(s.patches),
        reviews: list(s.reviews),
        checks: isRecord(s.checks) ? (s.checks as PartSlots["checks"]) : {},
      };
    }
  }
  return {
    parts,
    prompts: isRecord(value.prompts) ? (value.prompts as EpisodeSlots["prompts"]) : {},
    finals: list(value.finals),
  };
}

/**
 * Money at craft's precision (summarizeCosts rounds to 1/10000 of a dollar).
 * Rounding to cents per asset would turn a $0.0554 sheet into $0.06 and
 * drift every sum away from craft's total; cents are the formatter's job.
 */
function roundUsd(n: number): number {
  return Math.round(n * 10000) / 10000;
}

// ── Assets ─────────────────────────────────────────────────────────────────

interface AssetIndex {
  views: Record<string, AssetView>;
  statusOf(id: string): string | undefined;
  view(id: string): AssetView;
}

function numberMeta(asset: CraftAsset | undefined, key: string): number | null {
  const value = asset?.metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function buildAssetIndex(
  doc: CraftProjectFile | null,
  summary: CraftCostSummary | null,
): AssetIndex {
  const views: Record<string, AssetView> = {};
  const spent = new Map<string, number>();
  for (const line of summary?.lines ?? []) {
    // Same exclusions as summarizeCosts' total: a retry that landed the
    // same request is one call, not two.
    if (line.billing === "none" || line.usd === null || line.sameCallAsLater) continue;
    spent.set(line.assetId, roundUsd((spent.get(line.assetId) ?? 0) + line.usd));
  }
  // craft's own list, grouped by asset — not re-derived from the lines.
  const uncertain = new Map<string, string[]>();
  for (const label of summary?.uncertain ?? []) {
    const id = label.replace(/#\d+$/, "");
    uncertain.set(id, [...(uncertain.get(id) ?? []), label]);
  }
  if (doc) {
    const { assets, edges } = indexAssets(doc);
    for (const [id, asset] of assets) {
      const edge = edges.get(id);
      const params = edge?.operation.params;
      const request = isRecord(params?.request) ? params.request : null;
      views[id] = {
        id,
        exists: true,
        status: statusOf(asset),
        type: asset.type,
        uri: asset.uri ?? "",
        name: asset.name ?? id,
        createdAt: asset.createdAt,
        width: numberMeta(asset, "width"),
        height: numberMeta(asset, "height"),
        duration: numberMeta(asset, "duration"),
        model: typeof params?.model === "string" ? params.model : null,
        resolution: typeof request?.resolution === "string" ? request.resolution : null,
        prompt: typeof params?.prompt === "string" ? params.prompt : null,
        inputs: edgeInputs(edge),
        submittedAt: edge?.operation.timestamp ?? null,
        failure: (params?.failure as CraftFailure | undefined) ?? null,
        cost: (params?.cost as CraftCost | undefined) ?? null,
        spent: spent.has(id) ? spent.get(id)! : null,
        uncertain: uncertain.get(id) ?? [],
      };
    }
  }
  const missing = (id: string): AssetView => ({
    id,
    exists: false,
    status: "missing",
    type: null,
    uri: "",
    name: id,
    createdAt: 0,
    width: null,
    height: null,
    duration: null,
    model: null,
    resolution: null,
    prompt: null,
    inputs: [],
    submittedAt: null,
    failure: null,
    cost: null,
    spent: null,
    uncertain: [],
  });
  return {
    views,
    statusOf: (id) => (views[id]?.exists ? views[id].status : undefined),
    view: (id) => views[id] ?? missing(id),
  };
}

const BUSY = new Set(["pending", "generating"]);

export function isBusy(view: AssetView | null | undefined): boolean {
  return !!view && BUSY.has(view.status);
}

// ── Bible cards ────────────────────────────────────────────────────────────

const LISTS: Record<EntityKind, "characters" | "groups" | "scenes"> = {
  character: "characters",
  group: "groups",
  scene: "scenes",
};

/** Hash-map differences between two bases (field names, entity keys kept). */
function basisFieldDiff(now: Basis, then: Basis | null | undefined): string[] {
  if (!then) return [];
  const out: string[] = [];
  for (const [key, fields] of Object.entries(now.fields)) {
    const recorded = then.fields?.[key];
    if (!recorded) continue;
    for (const [field, hash] of Object.entries(fields)) {
      if (field in recorded && recorded[field] !== hash) out.push(field);
    }
  }
  return [...new Set(out)];
}

function buildCards(
  bible: Bible,
  sidecar: SeriesSidecar,
  assets: AssetIndex,
  episodes: EpisodeView[],
): EntityCard[] {
  const locks = lockStates(bible);
  const cards: EntityCard[] = [];
  for (const kind of ["character", "group", "scene"] as EntityKind[]) {
    for (const entity of list<Character | Group | Scene>(bible[LISTS[kind]])) {
      if (!isRecord(entity) || typeof entity.id !== "string") continue;
      const key = entityKey(kind, entity.id);
      const slot = sidecar.sheets[key];
      const now = sheetBasis(bible, kind, entity.id);
      const toView = (asset: string, record?: SheetCandidate): SheetCandidateView => ({
        ...assets.view(asset),
        basis: record?.basis ?? null,
        check: record?.check ?? null,
        outdated: basisFieldDiff(now, record?.basis),
      });
      const candidates = list<SheetCandidate>(slot?.candidates)
        .filter((c) => isRecord(c) && typeof c.asset === "string")
        .map((c) => toView(c.asset, c));
      const pickedId = typeof entity.sheet === "string" && entity.sheet ? entity.sheet : null;
      const sheet = pickedId
        ? (candidates.find((c) => c.id === pickedId) ?? toView(pickedId))
        : null;

      let sheetState: SheetState = "none";
      const anyBusy = candidates.some((c) => BUSY.has(c.status));
      const anyReady = candidates.some((c) => c.status === "ready");
      if (sheet && sheet.status === "ready") sheetState = "ready";
      else if (anyBusy) sheetState = "generating";
      else if (anyReady) sheetState = "pick";
      else if (candidates.length > 0 && candidates.every((c) => c.status === "failed")) sheetState = "failed";

      const appearances = episodes
        .filter((ep) =>
          kind === "character"
            ? ep.cast.includes(entity.id)
            : kind === "group"
              ? ep.groups.includes(entity.id)
              : ep.scene === entity.id,
        )
        .map((ep) => ep.id);

      const drift: DriftRef[] = [];
      if (kind !== "scene") {
        for (const ep of episodes) {
          for (const part of ep.parts) {
            for (const cell of part.checks) {
              if (cell.kind !== kind || cell.id !== entity.id || cell.verdict !== "drift") continue;
              drift.push({
                episode: ep.id,
                part: part.id,
                shot: cell.shot,
                check: cell.character,
                take: cell.source,
                note: cell.note,
                accepted: cell.accepted,
              });
            }
          }
        }
      }

      cards.push({
        key,
        kind,
        id: entity.id,
        name: str(entity.name) || entity.id,
        entity,
        lock: locks[key] ?? { state: "unlocked", version: null, changed: [] },
        sheet,
        candidates,
        sheetState,
        appearances,
        drift,
      });
    }
  }
  return cards;
}

// ── Episodes ───────────────────────────────────────────────────────────────

function emptyBucket(): CostBucket {
  return { usd: 0, count: 0, inFlight: 0 };
}

function addTo(bucket: CostBucket, view: AssetView): void {
  bucket.count += 1;
  if (view.spent !== null) bucket.usd = roundUsd(bucket.usd + view.spent);
  if (BUSY.has(view.status)) bucket.inFlight = roundUsd(bucket.inFlight + (view.cost?.usd ?? 0));
}

/** Shots changed by a chain of panel redraws between the take's board and the board now in effect. */
function redrawnSince(boards: BoardRecord[], current: BoardRecord | null, takeBoard: string): number[] {
  const out: number[] = [];
  const byId = new Map(boards.map((b) => [b.asset, b]));
  let cursor = current;
  const seen = new Set<string>();
  while (cursor && cursor.asset !== takeBoard && !seen.has(cursor.asset)) {
    seen.add(cursor.asset);
    if (cursor.from?.shot) out.push(cursor.from.shot);
    cursor = cursor.from ? (byId.get(cursor.from.board) ?? null) : null;
  }
  return out;
}

function mergeFlags(a: BibleFlag, b: BibleFlag): BibleFlag {
  const keys = new Set<string>(a.changes.map((c) => c.key));
  const under = [a.shotUnder, b.shotUnder].filter((v): v is number => typeof v === "number");
  return {
    stale: a.stale || b.stale,
    shotUnder: under.length > 0 ? Math.min(...under) : null,
    latest: b.latest,
    changes: [...a.changes, ...b.changes.filter((c) => !keys.has(c.key))],
    acknowledged: a.acknowledged && b.acknowledged,
  };
}

function buildEpisode(
  id: string,
  raw: Json,
  bible: Bible,
  sidecar: SeriesSidecar,
  assets: AssetIndex,
): EpisodeView {
  const episode = { ...(raw as unknown as EpisodeFile), id } as Episode;
  const slots = normalizeSlots(sidecar.episodes[id]);
  const picks: EpisodePicks = isRecord(episode.picks) ? episode.picks : {};
  const accepted = list<AcceptedDrift>(picks.acceptedDrift);
  const perPart = partSeconds(episode);
  const setup = setupHash(episode);
  const cost: EpisodeCost = {
    total: 0,
    inFlight: 0,
    unpriced: 0,
    uncertain: [],
    boards: emptyBucket(),
    panels: emptyBucket(),
    takes: emptyBucket(),
    patches: emptyBucket(),
  };
  const checks: CheckTally = { ok: 0, drift: 0, accepted: 0, unverified: 0, absent: 0, lost: 0 };

  const parts: PartView[] = list<Part>(episode.parts).map((part, index) => {
    const partId = (isRecord(part) && typeof part.id === "string" ? part.id : PART_IDS[index]) as PartId;
    const shots = list<Shot>(isRecord(part) ? part.shots : []);
    const s = slots.parts[partId] ?? emptyPartSlots();
    const rec = <R extends { asset: string }>(r: R): Rec<R> => ({ record: r, view: assets.view(r.asset) });

    const boards = list<BoardRecord>(s.boards).filter((r) => isRecord(r) && typeof r.asset === "string").map(rec);
    const takes = list<TakeRecord>(s.takes).filter((r) => isRecord(r) && typeof r.asset === "string").map(rec);
    const panels = list<PanelRecord>(s.panels).filter((r) => isRecord(r) && typeof r.asset === "string").map(rec);
    const patches = list<PatchRecord>(s.patches).filter((r) => isRecord(r) && typeof r.asset === "string").map(rec);
    const reviews = list<ReviewRecord>(s.reviews).filter((r) => isRecord(r) && typeof r.asset === "string").map(rec);

    const boardPick = effectivePick(picks.storyboard?.[partId], boards.map((b) => b.record.asset), assets.statusOf);
    const takePick = effectivePick(picks.take?.[partId], takes.map((t) => t.record.asset), assets.statusOf);
    const board = boards.find((b) => b.record.asset === boardPick.asset) ?? null;
    const take = takes.find((t) => t.record.asset === takePick.asset) ?? null;
    const review = take
      ? ([...reviews].reverse().find((r) => r.record.take === take.record.asset && r.view.status === "ready") ?? null)
      : null;

    // The cut the part shows: shots under an applied patch are judged on
    // that patch, the rest on the take (series-state's partCells — the
    // same cells `series.mjs status` counts).
    const cells = take ? partCells(episode, partId, s, take.record.asset, assets.statusOf, accepted, { bible }) : [];
    for (const cell of cells) {
      const verdict = cellVerdict(cell);
      if (verdict === "ok") checks.ok += 1;
      else if (verdict === "absent") {
        checks.absent += 1;
        if (isLostBeat(cell)) checks.lost += 1;
      }
      else if (verdict === "drift") {
        if (cell.accepted) checks.accepted += 1;
        else checks.drift += 1;
      } else checks.unverified += 1;
    }

    const takeDrift: Record<string, number> = {};
    for (const t of takes) {
      takeDrift[t.record.asset] = partCells(episode, partId, s, t.record.asset, assets.statusOf, accepted).filter(
        (c) => c.verdict === "drift" && !c.accepted,
      ).length;
    }

    const staleBoard = board ? staleShots(board.record.shots, boardShotHashes({ shots })) : [];
    let staleClip: number[] = [];
    if (take) {
      // A shot an applied patch re-shot is current (series-state cutStaleShots).
      const changed = new Set(cutStaleShots(take.record, s, assets.statusOf, clipShotHashes({ shots })));
      if (board && take.record.board !== board.record.asset) {
        const takeBoard = boards.find((b) => b.record.asset === take.record.board);
        for (const n of staleShots(takeBoard?.record.shots, board.record.shots)) changed.add(n);
        for (const n of redrawnSince(boards.map((b) => b.record), board.record, take.record.board)) changed.add(n);
      }
      staleClip = [...changed].filter((n) => n >= 1 && n <= shots.length).sort((a, b) => a - b);
    }

    const redrawing = panels
      .filter((p) => BUSY.has(p.view.status))
      .map((p) => p.record.shot)
      .filter((n) => typeof n === "number");

    for (const b of boards) addTo(cost.boards, b.view);
    for (const p of panels) addTo(cost.panels, p.view);
    for (const t of takes) addTo(cost.takes, t.view);
    for (const p of patches) addTo(cost.patches, p.view);
    for (const r of [...boards, ...panels, ...takes, ...patches]) cost.uncertain.push(...r.view.uncertain);

    return {
      id: partId,
      index,
      offset: Math.round(perPart * index * 10) / 10,
      seconds: perPart,
      shots,
      timeline: shotTimeline(shots),
      boards,
      board,
      boardPicked: boardPick.picked,
      panels,
      takes,
      take,
      takePicked: takePick.picked,
      patches,
      review,
      reviews,
      applied: take ? appliedPatches(s, take.record.asset, assets.statusOf).kept.map((p) => p.asset) : [],
      checks: cells,
      takeDrift,
      staleBoard,
      staleClip,
      setupStale: !!take && typeof take.record.setup === "string" && take.record.setup !== setup,
      redrawing,
      prompts: (slots.prompts[partId] as AssembledPrompts | undefined) ?? null,
    };
  });

  for (const bucket of [cost.boards, cost.panels, cost.takes, cost.patches]) {
    cost.total = roundUsd(cost.total + bucket.usd);
    cost.inFlight = roundUsd(cost.inFlight + bucket.inFlight);
  }

  // The flag reads what each part's work in effect consumed: the take when
  // there is one, otherwise the storyboard. Parts are merged — one stale
  // part raises the episode's flag.
  let flag: BibleFlag | null = null;
  for (const part of parts) {
    const basis = part.take?.record.basis ?? part.board?.record.basis ?? null;
    if (!basis) continue;
    const next = bibleFlag(bible, basis, picks.acknowledgedBibleVersion ?? null);
    flag = flag ? mergeFlags(flag, next) : next;
  }

  const finals = list<FinalRecord>(slots.finals).filter((f) => isRecord(f) && typeof f.asset === "string");
  const finalRecord =
    [...finals].reverse().find(
      (f) =>
        assets.statusOf(f.asset) === "ready" &&
        parts.length > 0 &&
        parts.every((p) => p.take && f.takes?.[p.id] === p.take.record.asset),
    ) ?? null;

  const stage = episodeStage(episode, slots, assets.statusOf);

  return {
    id,
    path: episodePath(id),
    episode,
    title: str(episode.title) || id,
    duration: Number(episode.duration) || 0,
    cast: list<string>(episode.cast).filter((c) => typeof c === "string"),
    groups: list<string>(episode.groups).filter((c) => typeof c === "string"),
    scene: typeof episode.scene === "string" ? episode.scene : null,
    stage: stage.stage,
    busy: stage.busy,
    unverified: stage.unverified,
    issues: checkEpisode(episode),
    parts,
    partSeconds: perPart,
    flag,
    final: finalRecord ? { record: finalRecord, view: assets.view(finalRecord.asset) } : null,
    cost,
    checks,
  };
}

// ── Assembly ───────────────────────────────────────────────────────────────

function buildSeries(
  rawBible: Json | null,
  bibleError: string | null,
  rawEpisodes: Record<string, Json>,
  broken: BrokenEpisode[],
  project: CraftProjectFile | null,
  projectError: string | null,
): Series {
  const bible = (rawBible ?? {}) as unknown as Bible;
  const sidecar = normalizeSidecar(project?.[SIDECAR_KEY]);
  const summary = project ? summarizeCosts(project) : null;
  const assets = buildAssetIndex(project, summary);

  const episodes = Object.keys(rawEpisodes)
    .sort()
    .map((id) => buildEpisode(id, rawEpisodes[id], bible, sidecar, assets));
  const cards = buildCards(bible, sidecar, assets, episodes);

  const locks = lockStates(bible);
  const lock = latestLock(bible);

  const sheetIds = new Set<string>();
  for (const slot of Object.values(sidecar.sheets)) {
    for (const c of list<SheetCandidate>(slot?.candidates)) if (isRecord(c)) sheetIds.add(c.asset);
  }
  const lineupIds = new Set(list<Lineup>(sidecar.lineups).map((l) => l.asset));
  const compilationIds = new Set(list<{ asset?: unknown }>(sidecar.compilations).map((c) => String(c?.asset ?? "")));
  let sheets = 0;
  let lineups = 0;
  let compilations = 0;
  let inFlight = 0;
  for (const line of summary?.lines ?? []) {
    if (line.billing === "none" || line.sameCallAsLater) continue;
    if (line.usd !== null) {
      if (sheetIds.has(line.assetId)) sheets += line.usd;
      else if (lineupIds.has(line.assetId)) lineups += line.usd;
      else if (compilationIds.has(line.assetId)) compilations += line.usd;
    }
    if ((line.status === "pending" || line.status === "generating") && line.usd !== null) inFlight += line.usd;
  }
  const total = summary?.total ?? 0;
  const claimed = sheets + lineups + compilations + episodes.reduce((sum, e) => sum + e.cost.total, 0);
  // Below a twentieth of a cent the difference is rounding, not a call.
  const other = Math.abs(total - claimed) < 0.0005 ? 0 : roundUsd(total - claimed);

  return {
    raw: { bible: rawBible, episodes: rawEpisodes },
    hasBible: rawBible !== null,
    bibleError,
    bible,
    project,
    projectError,
    hasProject: project !== null,
    sidecar,
    title: str(bible.title),
    version: bibleVersion(bible),
    lockedAt: lock?.at ?? null,
    style: {
      key: STYLE_KEY,
      lock: locks[STYLE_KEY] ?? { state: "unlocked", version: null, changed: [] },
      style: str(bible.style),
      sheetStyle: str(bible.sheetStyle),
      ratio: str(bible.ratio) || "16:9",
      dialogue: bible.dialogue === true,
    },
    cards,
    episodes,
    broken,
    cost: {
      total,
      inFlight: roundUsd(inFlight),
      sheets: roundUsd(sheets),
      lineups: roundUsd(lineups),
      compilations: roundUsd(compilations),
      other,
      unpriced: summary?.unpriced.length ?? 0,
      uncertain: summary?.uncertain.length ?? 0,
    },
    summary,
    ideas: usedIdeas(
      bible,
      episodes.map((e) => e.episode),
    ),
    lineup: latestLineup(sidecar, cards, assets),
    assets: assets.views,
  };
}

function latestLineup(sidecar: SeriesSidecar, cards: EntityCard[], assets: AssetIndex): LineupView | null {
  const record = list<Lineup>(sidecar.lineups).at(-1);
  if (!record) return null;
  const characters = list<string>(record.characters);
  const sheets = list<string>(record.sheets);
  const cardOf = (id: string) => cards.find((c) => c.kind === "character" && c.id === id);
  return {
    record,
    view: assets.view(record.asset),
    names: characters.map((id) => cardOf(id)?.name ?? id),
    stale: characters.some((id, i) => (cardOf(id)?.sheet?.id ?? null) !== (sheets[i] ?? null)),
  };
}

/**
 * Files → Series. Always returns a value — an empty workspace is a series
 * with no bible yet, which the viewer draws as its empty state, rather than
 * `null`, which would leave it waiting forever.
 */
export function loadSeries(files: ReadonlyArray<ViewerFileContent>): Series {
  let rawBible: Json | null = null;
  let bibleError: string | null = null;
  let project: CraftProjectFile | null = null;
  let projectError: string | null = null;
  const rawEpisodes: Record<string, Json> = {};
  const broken: BrokenEpisode[] = [];

  for (const file of files) {
    if (file.path === BIBLE_PATH) {
      const parsed = parseJson(file.content);
      if (!parsed.ok) bibleError = parsed.error;
      else if (!isRecord(parsed.value)) bibleError = "bible.json must be a JSON object";
      else rawBible = parsed.value;
      continue;
    }
    if (file.path === PROJECT_PATH) {
      const read = readProjectFile(file.content, { sidecarKey: SIDECAR_KEY });
      if (read.ok) project = read.value;
      else projectError = read.error;
      continue;
    }
    const match = EPISODE_PATH_RE.exec(file.path);
    if (match) {
      const id = match[1];
      const parsed = parseJson(file.content);
      if (!parsed.ok) broken.push({ id, path: file.path, error: parsed.error });
      else if (!isRecord(parsed.value)) broken.push({ id, path: file.path, error: "episode.json must be a JSON object" });
      else rawEpisodes[id] = parsed.value;
    }
  }

  return buildSeries(rawBible, bibleError, rawEpisodes, broken, project, projectError);
}

function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Same JSON value, regardless of whitespace — a re-save must be a no-op. */
function sameJson(text: string | undefined, value: unknown): boolean {
  if (text === undefined) return false;
  const parsed = parseJson(text);
  return parsed.ok && JSON.stringify(parsed.value) === JSON.stringify(value);
}

/**
 * Series → file operations. Writes bible.json and each episode.json whose
 * value differs from the file on disk; never project.json, never a delete.
 */
export function saveSeries(
  value: Series,
  current: ReadonlyArray<ViewerFileContent>,
): { writes: Array<{ path: string; content: string }>; deletes: string[] } {
  const byPath = new Map(current.map((f) => [f.path, f.content]));
  const writes: Array<{ path: string; content: string }> = [];
  if (value.raw.bible && !sameJson(byPath.get(BIBLE_PATH), value.raw.bible)) {
    writes.push({ path: BIBLE_PATH, content: serialize(value.raw.bible) });
  }
  for (const [id, episode] of Object.entries(value.raw.episodes)) {
    const path = episodePath(id);
    if (!sameJson(byPath.get(path), episode)) writes.push({ path, content: serialize(episode) });
  }
  return { writes, deletes: [] };
}

// ── Edits (pure; each returns a new Series ready for `source.write`) ──────

/** Rebuild derived state from edited raw documents; the project is reused as read. */
function rebuild(series: Series, bible: Json | null, episodes: Record<string, Json>): Series {
  return buildSeries(bible, series.bibleError, episodes, series.broken, series.project, series.projectError);
}

export function editBible(series: Series, mutate: (bible: Json) => void): Series {
  const bible = structuredClone(series.raw.bible ?? {}) as Json;
  mutate(bible);
  return rebuild(series, bible, series.raw.episodes);
}

export function editEpisode(series: Series, id: string, mutate: (episode: Json) => void): Series {
  const current = series.raw.episodes[id];
  if (!current) throw new Error(`no episode "${id}"`);
  const episode = structuredClone(current) as Json;
  mutate(episode);
  return rebuild(series, series.raw.bible, { ...series.raw.episodes, [id]: episode });
}

function entityIn(bible: Json, kind: EntityKind, id: string): Json {
  const items = list<Json>(bible[LISTS[kind]]);
  const found = items.find((e) => isRecord(e) && e.id === id);
  if (!found) throw new Error(`no ${kind} "${id}" in bible.json`);
  return found;
}

/** Edit one text field of a character, group or scene. */
export function setEntityField(
  series: Series,
  kind: EntityKind,
  id: string,
  field: "name" | "look" | "ability" | "personality",
  value: string,
): Series {
  return editBible(series, (bible) => {
    entityIn(bible, kind, id)[field] = value;
  });
}

/** Edit one of the bible's style fields. */
export function setStyleField(series: Series, field: "style" | "sheetStyle", value: string): Series {
  return editBible(series, (bible) => {
    bible[field] = value;
  });
}

/** "Use this one": point the entity's `sheet` at a ready candidate. */
export function pickSheet(series: Series, kind: EntityKind, id: string, assetId: string): Series {
  const status = series.assets[assetId]?.status;
  if (status !== "ready") throw new Error(`sheet "${assetId}" is not ready (${status ?? "missing"})`);
  return editBible(series, (bible) => {
    entityIn(bible, kind, id).sheet = assetId;
  });
}

/** Append the next lock (version, time, hashes) — computed by series-state. */
export function lockBible(series: Series, at: string): Series {
  return editBible(series, (bible) => {
    const entry = lockEntry(bible as unknown as Bible, at);
    bible.locks = [...list(bible.locks), entry];
  });
}

function partIn(episode: Json, partId: string): Json {
  const part = list<Json>(episode.parts).find((p) => isRecord(p) && p.id === partId);
  if (!part) throw new Error(`no part "${partId}"`);
  return part;
}

/** Edit a shot's `desc` or `sfx` (index is 0-based). */
export function setShotText(
  series: Series,
  episodeId: string,
  partId: string,
  index: number,
  field: "desc" | "sfx",
  value: string,
): Series {
  return editEpisode(series, episodeId, (episode) => {
    const shots = list<Json>(partIn(episode, partId).shots);
    if (!isRecord(shots[index])) throw new Error(`no shot ${index + 1} in part ${partId}`);
    shots[index][field] = value;
  });
}

/**
 * Drag the border between shot `index` and the next: shot `index` becomes
 * `dur` seconds and only its right neighbour absorbs the difference, so the
 * part's total never moves (`rebalance`, series-state). Throws with the
 * rule's own message when a neighbour would drop below the minimum.
 */
export function dragShotBorder(
  series: Series,
  episodeId: string,
  partId: string,
  index: number,
  dur: number,
): Series {
  return editEpisode(series, episodeId, (episode) => {
    const part = partIn(episode, partId);
    part.shots = rebalance(list<Shot & Json>(part.shots), index, dur, "next");
  });
}

function picksOf(episode: Json): Json {
  if (!isRecord(episode.picks)) episode.picks = {};
  return episode.picks as Json;
}

/**
 * Only a ready asset that the part's sidecar lists can be pinned — the rule
 * `series.mjs pick` enforces, so a pin the viewer writes is one the scripts
 * will honour.
 */
function requirePickable(series: Series, episodeId: string, partId: string, field: "storyboard" | "take", assetId: string): void {
  const part = findEpisode(series, episodeId)?.parts.find((p) => p.id === partId);
  if (!part) throw new Error(`no part "${partId}" in episode "${episodeId}"`);
  const pool = field === "storyboard" ? part.boards : part.takes;
  const hit = pool.find((r) => r.record.asset === assetId);
  if (!hit) throw new Error(`"${assetId}" is not a ${field} of ${episodeId} part ${partId}`);
  if (hit.view.status !== "ready") throw new Error(`${field} "${assetId}" is not ready (${hit.view.status})`);
}

/** Pin the storyboard candidate in use for one part. */
export function pickStoryboard(series: Series, episodeId: string, partId: string, assetId: string): Series {
  requirePickable(series, episodeId, partId, "storyboard", assetId);
  return editEpisode(series, episodeId, (episode) => {
    const picks = picksOf(episode);
    picks.storyboard = { ...(isRecord(picks.storyboard) ? picks.storyboard : {}), [partId]: assetId };
  });
}

/** Pin the take in use for one part. */
export function pickTake(series: Series, episodeId: string, partId: string, assetId: string): Series {
  requirePickable(series, episodeId, partId, "take", assetId);
  return editEpisode(series, episodeId, (episode) => {
    const picks = picksOf(episode);
    picks.take = { ...(isRecord(picks.take) ? picks.take : {}), [partId]: assetId };
  });
}

/** "Accept it as it is": keep this drift on the record for this take. */
export function acceptDrift(
  series: Series,
  episodeId: string,
  take: string,
  shot: number,
  character: string,
): Series {
  return editEpisode(series, episodeId, (episode) => {
    const picks = picksOf(episode);
    const current = list<AcceptedDrift>(picks.acceptedDrift);
    if (current.some((d) => d.take === take && d.shot === shot && d.character === character)) return;
    picks.acceptedDrift = [...current, { take, shot, character }];
  });
}

/** "Got it": quiet the stale-bible flag until the next lock. */
export function acknowledgeBible(series: Series, episodeId: string, version: number): Series {
  return editEpisode(series, episodeId, (episode) => {
    picksOf(episode).acknowledgedBibleVersion = version;
  });
}

// ── Lookups the viewer and the context share ───────────────────────────────

export function findEpisode(series: Series, id: string | null | undefined): EpisodeView | null {
  if (!id) return null;
  return series.episodes.find((e) => e.id === id) ?? null;
}

export function findCard(series: Series, kind: EntityKind, id: string): EntityCard | null {
  return series.cards.find((c) => c.kind === kind && c.id === id) ?? null;
}

/**
 * The frames a check cell is judged from: one shot's strip in the newest
 * ready contact sheet of the cell's own clip (the take, or the patch that
 * shot is spliced from).
 */
export function framesFor(
  series: Series,
  part: PartView,
  cell: Pick<CheckCell, "shot" | "source">,
): { strip: ReviewStrip; view: AssetView | null } | null {
  for (const review of [...part.reviews].reverse()) {
    if (review.record.take !== cell.source || review.view.status !== "ready") continue;
    const strip = review.record.strips?.find((s) => s.shot === cell.shot);
    if (strip) return { strip, view: series.assets[strip.asset] ?? null };
  }
  return null;
}

/** The clip that supplies a shot, with what its provenance stamps need. */
export interface ShotClip {
  kind: "take" | "patch";
  asset: string;
  view: AssetView;
  /** How long the clip runs: measured when the scripts measured it, else as requested. */
  seconds: number;
  resolution: string | null;
}

/**
 * The clip a shot is made from, by the rule the check cells use
 * (series-state's `partCells`): the applied patch whose shots a–b hold it,
 * else the take in effect. A clip the user opened in Takes (`viewing`)
 * wins when it holds the shot — a take holds every shot of its part, a
 * patch only its a–b — since that is the clip on screen.
 */
export function shotClip(part: PartView, shot: number, viewing: string | null = null): ShotClip | null {
  const holds = (p: Rec<PatchRecord>) => shot >= p.record.shots[0] && shot <= p.record.shots[1];
  const ofPatch = (p: Rec<PatchRecord>): ShotClip => ({
    kind: "patch",
    asset: p.record.asset,
    view: p.view,
    seconds: p.view.duration ?? p.record.seconds,
    resolution: p.view.resolution,
  });
  const ofTake = (t: Rec<TakeRecord>): ShotClip => ({
    kind: "take",
    asset: t.record.asset,
    view: t.view,
    seconds: t.view.duration ?? t.record.seconds ?? part.seconds,
    resolution: t.view.resolution ?? t.record.resolution ?? null,
  });
  if (viewing) {
    const patch = part.patches.find((p) => p.record.asset === viewing);
    if (patch && holds(patch)) return ofPatch(patch);
    const take = part.takes.find((t) => t.record.asset === viewing);
    if (take) return ofTake(take);
  }
  const applied = part.patches.find((p) => part.applied.includes(p.record.asset) && holds(p));
  if (applied) return ofPatch(applied);
  return part.take ? ofTake(part.take) : null;
}

/** The name of the character or group a check cell is about. */
export function cellName(series: Series, cell: Pick<CheckCell, "kind" | "id">): string {
  return cardName(series, cell.kind, cell.id);
}

export function cardName(series: Series, kind: EntityKind, id: string): string {
  return findCard(series, kind, id)?.name ?? id;
}

/** The part whose span holds `time` on the episode clock. */
export function partAt(episode: EpisodeView, time: number): PartView | null {
  if (episode.parts.length === 0) return null;
  for (const part of episode.parts) {
    if (time < part.offset + part.seconds - 1e-6) return part;
  }
  return episode.parts[episode.parts.length - 1];
}

/** The 1-based shot under `time` (episode clock) within `part`. */
export function shotAt(part: PartView, time: number): number | null {
  const local = time - part.offset;
  for (const entry of part.timeline) {
    if (local < entry.end - 1e-6) return entry.shot;
  }
  return part.timeline.length > 0 ? part.timeline[part.timeline.length - 1].shot : null;
}

/** A shot's span on the episode clock. */
export function shotSpan(part: PartView, shot: number): [number, number] | null {
  const entry = part.timeline[shot - 1];
  if (!entry) return null;
  return [round1(part.offset + entry.start), round1(part.offset + entry.end)];
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Ids of every asset that is pending or generating, oldest first. */
export function inFlight(series: Series): AssetView[] {
  return Object.values(series.assets)
    .filter((a) => BUSY.has(a.status))
    .sort((a, b) => (a.submittedAt ?? 0) - (b.submittedAt ?? 0));
}


// Type surface of the pure craft project module (craft-project.mjs). The
// types themselves are the contract in core/types/craft-project.ts and are
// re-exported here, so the JavaScript every consumer runs is declared in
// exactly those types. Reference: docs/reference/craft-project-file.md.

import type {
  CraftActor,
  CraftAsset,
  CraftAssetStatus,
  CraftAssetType,
  CraftBilling,
  CraftCompositionSettings,
  CraftCost,
  CraftCostBasis,
  CraftOperation,
  CraftOperationType,
  CraftParseResult,
  CraftProjectFile,
  CraftProvenanceEdge,
} from "../../../core/types/craft-project.js";

export type {
  CraftActor,
  CraftAsset,
  CraftAssetStatus,
  CraftAssetType,
  CraftBilling,
  CraftComposition,
  CraftCompositionSettings,
  CraftCost,
  CraftCostBasis,
  CraftFailure,
  CraftJsonValue,
  CraftOperation,
  CraftOperationParams,
  CraftOperationType,
  CraftParseResult,
  CraftProjectBase,
  CraftProjectFile,
  CraftProvenanceEdge,
} from "../../../core/types/craft-project.js";

export const CRAFT_PROJECT_SCHEMA: "pneuma-craft/project/v1";

export const ASSET_TYPES: readonly CraftAssetType[];
export const ASSET_STATUSES: readonly CraftAssetStatus[];
export const OPERATION_TYPES: readonly CraftOperationType[];
export const ACTORS: readonly CraftActor[];
export const COST_BASES: readonly CraftCostBasis[];
export const BILLINGS: readonly CraftBilling[];
/** Allowed status moves; an absent status is `ready`. */
export const TRANSITIONS: Readonly<Record<CraftAssetStatus, readonly CraftAssetStatus[]>>;

export const PROJECT_KEYS: readonly string[];
export const COMPOSITION_KEYS: readonly string[];
export const SETTINGS_KEYS: readonly string[];
export const ASSET_KEYS: readonly string[];
export const EDGE_KEYS: readonly string[];
export const OPERATION_KEYS: readonly string[];
/** `params` keys a caller's free-form params may not set. */
export const RESERVED_PARAM_KEYS: readonly string[];
/** `^[a-z0-9][a-z0-9-]{0,63}$` */
export const ASSET_ID_PATTERN: RegExp;
export const DEFAULT_COMPOSITION_SETTINGS: Readonly<CraftCompositionSettings>;

export interface CraftReadOptions {
  /** When given, the file must carry this top-level key (the mode's sidecar). */
  sidecarKey?: string;
}

/** Effective status: an absent status is `ready`. */
export function statusOf(asset: Pick<CraftAsset, "status"> | undefined): CraftAssetStatus;
export function aspectRatio(width: number, height: number): string;
/** Why `id` is not a usable asset id, or null when it is. */
export function assetIdProblem(id: unknown): string | null;

/** Structural + referential validation. Never throws. */
export function validateProjectFile<S extends Record<string, unknown> = Record<string, unknown>>(
  value: unknown,
  options?: CraftReadOptions,
): CraftParseResult<CraftProjectFile<S>>;

/** `JSON.parse` + `validateProjectFile`. Never throws. */
export function readProjectFile<S extends Record<string, unknown> = Record<string, unknown>>(
  raw: string,
  options?: CraftReadOptions,
): CraftParseResult<CraftProjectFile<S>>;

/** A new project; `settings` may be partial. Throws on a bad title or sidecar key. */
export function emptyProject<S = Record<string, unknown>>(options: {
  title: string;
  settings?: Partial<CraftCompositionSettings>;
  sidecarKey: string;
  sidecar?: S;
}): CraftProjectFile;

/** Craft key order on disk; sidecar keys follow in their original order, untouched. */
export function orderCraftKeys<T extends Record<string, unknown>>(doc: T): T;

export interface CraftAssetIndex {
  assets: Map<string, CraftAsset>;
  /** Each asset's edge, by `toAssetId`. */
  edges: Map<string, CraftProvenanceEdge>;
}
export function indexAssets(doc: Pick<CraftProjectFile, "assets" | "provenance">): CraftAssetIndex;
/** `params.inputs` when listed, else `[fromAssetId]`, else `[]`. */
export function edgeInputs(edge: CraftProvenanceEdge | undefined): string[];
/**
 * `<prefix>/<uri>?r=<createdAt>`, each path segment encoded; null unless the
 * asset is ready with a uri. A uri that is already a URL comes back unchanged.
 */
export function resolveAssetUri(prefix: string, asset: CraftAsset | undefined): string | null;

/** Mutators take the document and change it in place. */
type MutableProject = Pick<CraftProjectFile, "assets" | "provenance">;

export function upsertAsset(doc: MutableProject, asset: CraftAsset): void;
export function setEdge(doc: MutableProject, edge: CraftProvenanceEdge): void;
/** Remove assets and their edges; cascades `fromAssetId` and `params.inputs`. */
export function dropAssets(doc: MutableProject, ids: readonly string[]): void;
export function operation(
  type: CraftOperationType,
  timestamp: number,
  params?: Record<string, unknown>,
  inputs?: readonly string[],
  actor?: CraftActor,
): CraftOperation;
export function edge(toAssetId: string, inputs: readonly string[] | undefined, op: CraftOperation): CraftProvenanceEdge;
/** The asset with `status: next`; throws naming a move TRANSITIONS does not allow. */
export function transition(asset: CraftAsset, next: CraftAssetStatus): CraftAsset;
/** A `generate`, or an edge naming a `model`/`provider` or carrying a `cost`. */
export function isCallEdge(edge: CraftProvenanceEdge | undefined): boolean;

export interface CraftReserveSpec {
  id: string;
  type: CraftAssetType;
  name: string;
  op: CraftOperationType;
  /** Planned path relative to the project file's directory; default "". */
  uri?: string;
  /** Input asset ids; omitted keeps a replaced same-op edge's inputs. */
  from?: readonly string[];
  /** Default: `human` for `upload`, otherwise `agent`. */
  actor?: CraftActor;
  agentId?: string;
  label?: string;
  model?: string;
  prompt?: string;
  provider?: string;
  /** Free-form params; may not set RESERVED_PARAM_KEYS. */
  params?: Record<string, unknown>;
  /** Basis `estimate` or `table` — a vendor report cannot exist yet. */
  cost?: CraftCost;
  /** Write `generating` instead of `pending`. */
  generating?: boolean;
  /** Allow replacing a `ready` asset. */
  force?: boolean;
  tags?: string[];
}

export interface CraftRecord {
  asset: CraftAsset;
  edge: CraftProvenanceEdge;
}

/** Throws (message names the problem); leaves `doc` unchanged on a throw. */
export function reserveAsset(doc: MutableProject, spec: CraftReserveSpec, now: number): CraftRecord;

export interface CraftLandSpec {
  id: string;
  /** Relative to the project file's directory. */
  uri: string;
  metadata?: CraftAsset["metadata"];
  requestId?: string;
  /** Replaces the reservation's cost. */
  cost?: CraftCost;
}
export function landAsset(doc: MutableProject, spec: CraftLandSpec, now: number): CraftRecord;

export interface CraftFailSpec {
  id: string;
  reason: string;
  /** `none` only when the request provably never left. */
  billing: CraftBilling;
  requestId?: string;
}
export function failAsset(doc: MutableProject, spec: CraftFailSpec, now: number): CraftRecord;

export interface CraftCostLine {
  assetId: string;
  /** null for the current call; 1-based index into `params.earlier` otherwise. */
  attempt: number | null;
  operation: CraftOperationType;
  status: CraftAssetStatus;
  /** null = UNPRICED, never free. */
  usd: number | null;
  basis: CraftCostBasis | null;
  billing: CraftBilling | null;
  /** Epoch ms the call was reserved. */
  at: number;
  /** The provider's request id this attempt recorded, or null. */
  requestId: string | null;
  /**
   * A later attempt of the same asset carries the same `requestId`: the same
   * remote job, landed afterwards. Counted once, as that later line.
   */
  sameCallAsLater: boolean;
}

export interface CraftCostSummary {
  currency: "USD";
  /** Sum of priced calls, excluding provably unbilled ones. */
  total: number;
  calls: number;
  priced: number;
  byBasis: Record<CraftCostBasis, number>;
  /** `assetId` (or `assetId#n` for an earlier attempt) of calls with no number. */
  unpriced: string[];
  /** Failed with billing `unknown`. */
  uncertain: string[];
  /** Failed with billing `none`. */
  notBilled: string[];
  /** Still pending or generating. */
  inFlight: string[];
  /** Earlier attempts whose request a later attempt of the same asset landed (`sameCallAsLater`); not counted twice. */
  reconciled: string[];
  lines: CraftCostLine[];
}
export function summarizeCosts(doc: Pick<CraftProjectFile, "assets" | "provenance">): CraftCostSummary;

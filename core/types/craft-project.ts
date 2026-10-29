/**
 * Craft project file — the on-disk `pneuma-craft/project/v1` format that
 * modes use to persist generated media as craft assets with provenance.
 *
 * Upstream `@pneuma-craft/core` owns the *semantics* (`Asset`, `AssetStatus`,
 * `Operation`, `ProvenanceEdge`) but defines no file format. This module is
 * the one type authority for that format; the executable rules live in
 * `modes/_shared/scripts/craft-project.mjs` (pure: validation, indexing,
 * lifecycle, cost reading) and `craft-project-io.mjs` (atomic load/save,
 * probing, the CLI, `runRegistered`). Their `.d.mts` sidecars re-export these
 * types, so the JavaScript every consumer runs has exactly this declared
 * surface. `core/__tests__/craft-project.test.ts` pins the mapping to the
 * upstream types and to the runtime enums.
 *
 * Mapping to upstream (see `docs/reference/craft-project-file.md`):
 *   - `CraftAsset` = upstream `Asset` with JSON-only `metadata`.
 *   - `CraftProvenanceEdge` = upstream `ProvenanceEdge` WITHOUT `id`: the
 *     on-disk identity of an edge is its `toAssetId` (one edge per asset);
 *     an id is assigned at hydration.
 *   - Multi-input steps: craft edges are single-parent, so on disk
 *     `fromAssetId = inputs[0]` and `operation.params.inputs` lists every
 *     input when there is more than one. This is the file format's extension,
 *     not an upstream concept.
 *
 * Pure types and one constant. No React, no runtime imports.
 */

/** The `$schema` value every craft project file carries. */
export const CRAFT_PROJECT_SCHEMA = "pneuma-craft/project/v1" as const;

export type CraftAssetType = "video" | "image" | "audio" | "text";

/**
 * Lifecycle of an asset. An absent `status` is equivalent to `ready`
 * (upstream's backward-compatibility rule). Allowed moves:
 * `pending → generating → ready | failed` and `pending → ready | failed`.
 */
export type CraftAssetStatus = "pending" | "generating" | "ready" | "failed";

/** Upstream's six operation types, exactly. */
export type CraftOperationType = "upload" | "import" | "generate" | "derive" | "select" | "composite";

export type CraftActor = "human" | "agent";

/** Anything `JSON.parse` can produce. */
export type CraftJsonValue =
  | string
  | number
  | boolean
  | null
  | CraftJsonValue[]
  | { [key: string]: CraftJsonValue };

/**
 * Where a recorded price came from — never guessed:
 *   - `"estimate"` — somebody's estimate, labelled as one;
 *   - `"table"`    — a published price table;
 *   - `"reported"` — the vendor's own figure for that call.
 */
export type CraftCostBasis = "estimate" | "reported" | "table";

/**
 * `operation.params.cost`. `usd: null` means the call is known to be paid
 * but carries no number. An edge without `cost` that is a call (see
 * `summarizeCosts`) is UNPRICED, never free.
 */
export interface CraftCost {
  usd: number | null;
  basis: CraftCostBasis;
  note?: string;
}

/**
 * Whether a failed call may have been billed.
 *   - `"none"`    — provably never left this machine (a refused socket, an
 *     unresolved name); the only safe retry.
 *   - `"unknown"` — everything else: an abort, a timeout, an upstream error.
 *     Cancellation is compensation, not undo.
 */
export type CraftBilling = "none" | "unknown";

/** `operation.params.failure`, required on the edge of a `failed` asset. */
export interface CraftFailure {
  reason: string;
  /** Epoch milliseconds. */
  at: number;
  billing: CraftBilling;
}

/**
 * `operation.params`. The named keys are the ones the shared writer reads or
 * writes; every other key is the caller's and is preserved verbatim.
 */
export interface CraftOperationParams {
  model?: string;
  prompt?: string;
  provider?: string;
  /** Every input of a multi-input step, `inputs[0] === fromAssetId`. */
  inputs?: string[];
  cost?: CraftCost;
  failure?: CraftFailure;
  /** The provider's id for the call (fal `request_id`, …). */
  requestId?: string;
  /** Epoch milliseconds the file landed. */
  finishedAt?: number;
  [key: string]: unknown;
}

/** Key order on disk: `type, actor, agentId?, timestamp, label?, params?`. */
export interface CraftOperation {
  type: CraftOperationType;
  actor: CraftActor;
  agentId?: string;
  /** Epoch milliseconds the operation was recorded (for a call: when it was reserved). */
  timestamp: number;
  label?: string;
  params?: CraftOperationParams;
}

/**
 * One asset. Key order on disk: `id, type, uri, name, metadata, createdAt,
 * status, tags`. `uri` is relative to the project file's directory.
 *
 * `ready` (or absent status) ⇒ `uri` non-empty and, for an image, measured
 * (`metadata.width` / `metadata.height`). A `text` asset may keep its content
 * inline elsewhere and so may have an empty `uri`. `pending`, `generating`
 * and `failed` may carry `uri: ""` (or the planned path) and `metadata: {}`.
 */
export interface CraftAsset {
  /** `^[a-z0-9][a-z0-9-]{0,63}$`, unique per file, semantic. */
  id: string;
  type: CraftAssetType;
  uri: string;
  name: string;
  metadata: { [key: string]: CraftJsonValue };
  /** Epoch milliseconds. */
  createdAt: number;
  status?: CraftAssetStatus;
  tags?: string[];
}

/** One provenance edge. Key order on disk: `toAssetId, fromAssetId, operation`. */
export interface CraftProvenanceEdge {
  toAssetId: string;
  fromAssetId: string | null;
  operation: CraftOperation;
}

export interface CraftCompositionSettings {
  width: number;
  height: number;
  fps: number;
  aspectRatio: string;
  sampleRate?: number;
}

/**
 * The composition. The shared layer reads only `settings`; `tracks` and
 * `transitions` are opaque here (clipcraft owns their shape).
 */
export interface CraftComposition {
  settings: CraftCompositionSettings;
  tracks: unknown[];
  transitions: unknown[];
}

/** The craft-owned top-level keys, in on-disk order. */
export interface CraftProjectBase {
  $schema: typeof CRAFT_PROJECT_SCHEMA;
  title: string;
  composition: CraftComposition;
  assets: CraftAsset[];
  provenance: CraftProvenanceEdge[];
}

/**
 * A whole project file. Every top-level key that is not craft's is the
 * mode's sidecar (`series`, `sprite`, `scenes` + `captionStyle`, …): it is
 * written back in its original position and key order, and the shared
 * writer never reads, reorders or validates it.
 */
export type CraftProjectFile<Sidecar extends Record<string, unknown> = Record<string, unknown>> =
  CraftProjectBase & Sidecar;

/** Result of reading or validating a project file. Errors name the violation. */
export type CraftParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

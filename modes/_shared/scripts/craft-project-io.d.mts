// Type surface of the craft project writer (craft-project-io.mjs): atomic
// load/save, probing, runRegistered, and the CLI. The pure rules and the
// shared types are in craft-project.d.mts / core/types/craft-project.ts.

import type {
  CraftAsset,
  CraftAssetType,
  CraftBilling,
  CraftCost,
  CraftProjectFile,
  CraftProvenanceEdge,
} from "../../../core/types/craft-project.js";
import type { CraftReserveSpec } from "./craft-project.mjs";

export interface CraftLoadOptions {
  /** When given, a file without this top-level key is refused. */
  sidecarKey?: string;
}

/**
 * Read and validate a project file. NEVER RETURNS on failure: a missing
 * file, bad JSON or any violation prints one `ERROR:` line and exits 1.
 */
export function loadProject<S extends Record<string, unknown> = Record<string, unknown>>(
  path: string,
  options?: CraftLoadOptions,
): CraftProjectFile<S>;

/**
 * Validate → order craft keys → write a unique scratch file beside `path` →
 * rename over `path`; the scratch file is removed on every exit. NEVER
 * RETURNS on failure (`ERROR:` + exit 1). Returns the document as written.
 */
export function saveProject<T extends Record<string, unknown>>(path: string, doc: T): T;

/**
 * The asset uri for `file` (absolute, or relative to the project file's
 * directory): relative, `/`-separated. Throws when it is outside that
 * directory.
 */
export function toProjectUri(projectPath: string, file: string, label?: string): string;

export interface ProbeResult {
  metadata: Record<string, number>;
  /** Set when a video/audio file could not be measured (best effort). */
  warning: string | null;
}

/**
 * Measure a landed file. Throws for a missing file and for an image that
 * neither its WebP header nor ffprobe can measure; video and audio are best
 * effort with a named warning; text has nothing to measure.
 */
export function probeMedia(path: string, type: CraftAssetType): ProbeResult;

/** What a successful `call` hands back. */
export interface RunRegisteredCallResult {
  /** The landed file; default: the reservation's planned uri. */
  file?: string;
  /** Provider id for the call (fal `request_id`, …). */
  requestId?: string;
  /** Replaces the reservation's estimate (typically `basis: "reported"`). */
  cost?: CraftCost;
}

export type RunRegisteredPhase = "reserve" | "land" | "fail";

export interface RunRegisteredOptions<R extends RunRegisteredCallResult> {
  path: string;
  sidecarKey?: string;
  /** Reserved as `generating` unless `generating: false`. */
  reserve: CraftReserveSpec;
  call: (context: { signal: AbortSignal; asset: CraftAsset; edge: CraftProvenanceEdge }) => Promise<R>;
  /** Proof that a thrown request never left. Default: fal-queue's `neverReached`. */
  neverReached?: (error: unknown) => boolean;
  /** Mutate the mode's sidecar inside the same atomic write as each phase. */
  updateSidecar?: (doc: CraftProjectFile, phase: RunRegisteredPhase) => void;
  /** An extra abort source (a mode deadline). */
  signal?: AbortSignal;
  /** Install SIGINT/SIGTERM → abort for the call's duration. Default true. */
  handleSignals?: boolean;
  now?: () => number;
  /** Where WARN lines go. Default stderr. */
  onNote?: (message: string) => void;
}

export type RunRegisteredOutcome<R> =
  | {
      ok: true;
      asset: CraftAsset;
      edge: CraftProvenanceEdge;
      result: R;
      warning: string | null;
      /** Set when `updateSidecar` threw at the land phase (the asset is recorded). */
      sidecarError: string | null;
    }
  | {
      ok: false;
      asset: CraftAsset;
      edge: CraftProvenanceEdge;
      error: unknown;
      reason: string;
      billing: CraftBilling;
      /** "SIGINT" | "SIGTERM" when a signal aborted the call. */
      interrupted: string | null;
      /** 130 when interrupted, 1 otherwise. */
      exitCode: 1 | 130;
      sidecarError: string | null;
    };

/**
 * Reserve (saved before the call) → call with an AbortSignal → land or fail.
 * A refused reservation exits 1 with `ERROR:` and sends nothing. Outcomes of
 * the call are returned, never thrown; the caller exits with `exitCode`.
 */
export function runRegistered<R extends RunRegisteredCallResult>(
  options: RunRegisteredOptions<R>,
): Promise<RunRegisteredOutcome<R>>;

/** Run one CLI command (`init|validate|reserve|land|fail|drop|show|cost`). */
export function main(argv?: string[]): void;

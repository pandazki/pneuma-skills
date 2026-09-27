// Type declarations for the untyped shared background-removal script
// (remove-background.mjs). The module is plain JS so it can be copied into
// a skill and run by `node` with no build step; these stubs exist so
// TypeScript callers and `modes/_shared/scripts/__tests__/` can use it
// under `tsc --noEmit`.

/** The fal app this script drives. */
export const BIREFNET_URL: string;

/** Short alias → the exact string fal's `model` enum accepts. */
export const MODEL_ALIASES: Record<string, string>;

/** Short form → fal's `operating_resolution` spelling. */
export const RESOLUTIONS: Record<string, string>;

export const DEFAULT_MODEL: string;
export const DEFAULT_RESOLUTION: string;

export interface RemoveBackgroundOptions {
  /** Local path or URL: png, jpg or webp. */
  input?: string;
  /** Destination path; must end in `.png` — the cut-out carries alpha. */
  output?: string;
  /** A key of `MODEL_ALIASES`; fal's display name itself is refused. */
  model?: string;
  /** A key of `RESOLUTIONS` (1024 | 2048 | 2304). */
  resolution?: string | number;
  /** false sends `refine_foreground: false`. */
  refine?: boolean;
}

export interface RemoveBackgroundRequestBody {
  image_url: string;
  model: string;
  operating_resolution: string;
  output_format: "png";
  refine_foreground: boolean;
}

export interface RemoveBackgroundRequest {
  url: string;
  /** The alias as passed, for reporting; `body.model` is fal's spelling. */
  model: string;
  body: RemoveBackgroundRequestBody;
}

/** fal's list price for BiRefNet v2, and the date it was read. */
export const BIREFNET_PRICE: Readonly<{ usd: number; unit: string; checked: string }>;

/**
 * What one job cost, always an estimate: inference time at the list price,
 * else the wall time as an upper bound, else unknown (`usd: null`).
 */
export interface BirefnetCost {
  usd: number | null;
  estimate: true;
  basis: "inference-time" | "wall-time-upper-bound" | "unknown";
  /** The seconds priced; absent when unknown. */
  seconds?: number;
  unitPriceUsd: number;
  unit: string;
}

export function birefnetCost(timing?: { inferenceSeconds?: number; apiMs?: number }): BirefnetCost;
export function formatUsd(usd: number | null | undefined): string;
/** The stderr `cost:` line for a cost object. */
export function costLine(cost: BirefnetCost | null | undefined): string;

/** The `--json` contract. `model` is fal's display name, as sent. */
export interface RemoveBackgroundResult {
  path: string;
  url: string;
  width: number | null;
  height: number | null;
  model: string;
  /** Added 2026-09-27; every earlier key is unchanged. */
  cost: BirefnetCost;
}

export interface RemoveBackgroundDependencies {
  /** Defaults to `fal-queue.mjs::runFalJob`. */
  runJob?: (options: {
    url: string;
    /** Exactly what this script builds — never a free-form payload. */
    body: RemoveBackgroundRequestBody;
    key: string;
    signal?: AbortSignal;
    label?: string;
    deadlineMs?: number;
    onRetry?: (info: { attempt: number; attempts: number; delayMs: number; reason: string }) => void;
  }) => Promise<{ data?: any; apiMs?: number; inferenceSeconds?: number; attempts?: number }>;
  /** Defaults to `fal-queue.mjs::downloadFalFile`. */
  download?: (url: string, options?: { signal?: AbortSignal }) => Promise<Uint8Array>;
}

/**
 * The exact request BiRefNet is sent, with a local input inlined as a data
 * URI. Throws — naming the flag — for an unknown model alias, an
 * unsupported resolution, a non-PNG output path or a missing input.
 */
export function buildRemoveBackgroundRequest(options?: RemoveBackgroundOptions): RemoveBackgroundRequest;

/** Width/height from a PNG's IHDR, or null when the bytes are not a PNG. */
export function pngSize(bytes: Uint8Array | null | undefined): { width: number; height: number } | null;

/**
 * Run one BiRefNet job and write the cut-out to `output` atomically.
 * Dimensions come from fal when reported, from the PNG header otherwise.
 */
export function removeBackground(
  options: RemoveBackgroundOptions & {
    output: string;
    apiKey?: string;
    signal?: AbortSignal;
    deadlineMs?: number;
  },
  dependencies?: RemoveBackgroundDependencies,
): Promise<RemoveBackgroundResult>;

/** The CLI entry. Resolves to the process exit code (0, or 130 on interrupt). */
export function main(argv?: string[]): Promise<number>;

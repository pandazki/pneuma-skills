// Type declarations for the untyped shared Topaz interpolation script
// (interpolate-video.mjs). The module is plain JS so it can be copied into
// a skill and run by `node` with no build step; these stubs exist so
// TypeScript callers and `modes/_shared/scripts/__tests__/` can use it
// under `tsc --noEmit`.

/** The two fal apps this script drives. */
export const TOPAZ_URL: string;
export const RIFE_URL: string;

/** Topaz model alias → the exact string fal's `model` enum accepts. */
export const MODEL_ALIASES: Record<string, string>;

/** Every `--model` value → the endpoint family it names ("topaz" | "rife"). */
export const INTERPOLATORS: Record<string, string>;

export const DEFAULT_MODEL: string;
export const DEFAULT_TARGET_FPS: number;
/** 1 — retime only. Passed through as given, never coerced. */
export const DEFAULT_UPSCALE: number;
/** 1 — RIFE invents one frame between each pair, so 24 fps becomes 48. */
export const DEFAULT_BETWEEN: number;

/** This script's own range; fal documents output up to 120 fps. */
export const TARGET_FPS_MIN: number;
export const TARGET_FPS_MAX: number;
/** fal: "Supports up to 8x upscaling". */
export const MAX_UPSCALE: number;

export interface InterpolateOptions {
  /** Local path or URL of the clip to retime. */
  input?: string;
  /** Destination path; must end in `.mp4` — both endpoints write H.264. */
  output?: string;
  /** A key of `INTERPOLATORS` (`proteus` | `gaia-2` | `rife`); fal's enum
   *  string itself is refused. */
  model?: string;

  // ── Topaz only; refused with `--model rife` ────────────────────────────
  /** Whole number, TARGET_FPS_MIN..TARGET_FPS_MAX. */
  targetFps?: string | number;
  /** Resize factor, 0 < n <= MAX_UPSCALE. 1 means retime only. */
  upscale?: string | number;

  // ── RIFE only; refused with a Topaz model ─────────────────────────────
  /** Frames invented BETWEEN each pair — a multiplier, not a target rate. */
  between?: string | number;
  /** `loop: true` — interpolate the wrap so the last frame leads into the
   *  first. The reason this endpoint is wired at all. */
  loop?: boolean;
  /** `use_scene_detection` — do not interpolate across a cut. */
  sceneDetect?: boolean;
  /** Pin the output rate; without it `use_calculated_fps: true` is sent and
   *  no `fps` field travels at all. */
  fps?: string | number;
}

/** Topaz's own field names — the only spelling that reaches that endpoint. */
export interface TopazInterpolateRequestBody {
  video_url: string;
  /** fal's enum spelling, e.g. "Proteus". */
  model: string;
  upscale_factor: number;
  target_fps: number;
  H264_output: true;
}

/** RIFE's own field names. `fps` is present only when `--fps` pinned one,
 *  in which case `use_calculated_fps` is false. */
export interface RifeInterpolateRequestBody {
  video_url: string;
  num_frames: number;
  use_scene_detection: boolean;
  use_calculated_fps: boolean;
  loop: boolean;
  fps?: number;
}

export type InterpolateRequestBody =
  | TopazInterpolateRequestBody
  | RifeInterpolateRequestBody;

export interface InterpolateRequest {
  url: string;
  /** The alias as passed, for reporting; a Topaz `body.model` is fal's spelling. */
  model: string;
  /** Which endpoint the alias named: `"topaz"` or `"rife"`. */
  family: string;
  body: InterpolateRequestBody;
}

/** The `--json` contract for a Topaz run. `model` is fal's enum spelling. */
export interface TopazInterpolateResult {
  path: string;
  url: string;
  /** Bytes of the file on disk. */
  file_size: number;
  target_fps: number;
  upscale_factor: number;
  model: string;
}

/** The `--json` contract for a RIFE run: what it was really given. There is
 *  no `target_fps` — the rate was multiplied, not named. */
export interface RifeInterpolateResult {
  path: string;
  url: string;
  file_size: number;
  /** The alias, `"rife"`: this endpoint has no model enum of its own. */
  model: string;
  between: number;
  loop: boolean;
  /** Only when `--fps` pinned the output rate. */
  fps?: number;
}

export type InterpolateResult = TopazInterpolateResult | RifeInterpolateResult;

/** Turns a local path into the hosted URL fal fetches. `uploadFalFile` by default. */
export type FalUploader = (
  path: string,
  options: { key?: string; label?: string; signal?: AbortSignal; onNote?: (message: string) => void },
) => Promise<string>;

export interface InterpolateDependencies {
  /** Defaults to `fal-queue.mjs::uploadFalFile`. */
  upload?: FalUploader;
  /** Defaults to `fal-queue.mjs::runFalJob`. */
  runJob?: (options: {
    url: string;
    /** Exactly what this script builds — never a free-form payload. */
    body: InterpolateRequestBody;
    key: string;
    signal?: AbortSignal;
    label?: string;
    deadlineMs?: number;
    onRetry?: (info: { attempt: number; attempts: number; delayMs: number; reason: string }) => void;
  }) => Promise<{ data?: any; apiMs?: number; attempts?: number }>;
  /** Defaults to `fal-queue.mjs::downloadFalFile`. */
  download?: (url: string, options?: { signal?: AbortSignal; attempts?: number }) => Promise<Uint8Array>;
}

/**
 * The exact request the chosen endpoint is sent. A local input is uploaded
 * to fal storage first (never inlined — these endpoints refuse a data URI as
 * "URL too long"), which is why this is async. Throws — naming the flag —
 * for an unknown model alias, a flag belonging to the OTHER endpoint, a
 * target fps outside the supported range, an upscale factor out of bounds,
 * a `--between` below 1, a non-MP4 output path, a data URI or a missing
 * file; every one of those is checked before the upload starts.
 */
export function buildInterpolateRequest(
  options?: InterpolateOptions & { apiKey?: string; signal?: AbortSignal },
  dependencies?: { upload?: FalUploader; onNote?: (message: string) => void },
): Promise<InterpolateRequest>;

/**
 * Run one interpolation job and write the retimed clip to `output` atomically.
 * Rejects with the upstream message on failure; the remote job is cancelled
 * before this gives up on it.
 */
export function interpolateVideo(
  options: InterpolateOptions & {
    output: string;
    apiKey?: string;
    signal?: AbortSignal;
    deadlineMs?: number;
  },
  dependencies?: InterpolateDependencies,
): Promise<InterpolateResult>;


/** The CLI entry. Resolves to the process exit code (0, or 130 on interrupt). */
export function main(argv?: string[]): Promise<number>;

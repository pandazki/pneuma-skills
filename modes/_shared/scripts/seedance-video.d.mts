// Type declarations for the untyped shared Seedance 2.5 script
// (seedance-video.mjs). The module is plain JS so it can be copied into a
// skill and run by `node` with no build step; these stubs exist so
// TypeScript callers and `modes/_shared/scripts/__tests__/` can use it
// under `tsc --noEmit`.

/** The fal app every endpoint below belongs to. */
export const SEEDANCE_MODEL: string;

export type SeedanceEndpointName = "text" | "image" | "reference";

export interface SeedanceEndpoint {
  /** Synchronous fal URL; `runFalJob` rewrites it onto the queue host. */
  url: string;
  /** Whether this endpoint can be told an aspect ratio at all. */
  aspectRatio: boolean;
}

export const ENDPOINTS: Record<SeedanceEndpointName, SeedanceEndpoint>;
export const RESOLUTIONS: string[];
export const ASPECT_RATIOS: string[];
export const BITRATE_MODES: string[];
export const DURATION_MIN_S: number;
export const DURATION_MAX_S: number;

/** Every knob the CLI exposes, in the spelling the builder takes. */
export interface SeedanceOptions {
  prompt?: string;
  /** "text" | "image" | "reference", long spellings accepted; else inferred. */
  endpoint?: string;
  image?: string;
  endImage?: string;
  refImages?: string[];
  refVideos?: string[];
  refAudios?: string[];
  /** "auto" or a whole number of seconds from 4 to 30. */
  duration?: string | number;
  resolution?: string;
  aspectRatio?: string;
  /** false sends `generate_audio: false`. */
  audio?: boolean;
  bitrate?: string;
  seed?: string | number;
}

/** fal's own field names — the only spelling that reaches the endpoint. */
export interface SeedanceRequestBody {
  prompt: string;
  image_url?: string;
  end_image_url?: string;
  image_urls?: string[];
  video_urls?: string[];
  audio_urls?: string[];
  resolution: string;
  duration: string;
  aspect_ratio?: string;
  generate_audio: boolean;
  bitrate_mode?: string;
  seed?: number;
}

export interface SeedanceRequest {
  endpoint: SeedanceEndpointName;
  url: string;
  body: SeedanceRequestBody;
}

/** The `--json` contract callers persist for provenance and re-shoots. */
export interface SeedanceResult {
  path: string;
  url: string;
  /** Bytes of the file on disk, measured after the faststart remux. */
  file_size: number;
  model: string;
  endpoint: SeedanceEndpointName;
  requested_duration: number | "auto";
  resolution: string;
  seed?: number;
}

export interface SeedanceDependencies {
  /** Defaults to `fal-queue.mjs::runFalJob`. */
  runJob?: (options: {
    url: string;
    /** Exactly what this script builds — never a free-form payload. */
    body: SeedanceRequestBody;
    key: string;
    signal?: AbortSignal;
    label?: string;
    deadlineMs?: number;
    onRetry?: (info: { attempt: number; attempts: number; delayMs: number; reason: string }) => void;
  }) => Promise<{ data?: any; apiMs?: number; attempts?: number; inferenceSeconds?: number; requestId?: string }>;
  /** Defaults to `fal-queue.mjs::downloadFalFile`. */
  download?: (url: string, options?: { signal?: AbortSignal; attempts?: number }) => Promise<Uint8Array>;
  /** Defaults to `remuxFaststart`; injected so a test needs no ffmpeg. */
  remuxFile?: (path: string, options?: { onNote?: (message: string) => void }) => boolean;
}

/**
 * The endpoint a run belongs to — explicit when given, inferred from the
 * inputs otherwise. Throws on any combination fal cannot honour (a
 * reference on the text endpoint, an image on it, a reference endpoint
 * with nothing to reference, more anchors than the model accepts).
 */
export function resolveEndpointName(options?: SeedanceOptions): SeedanceEndpointName;

/**
 * The exact request Seedance 2.5 is sent, with local files inlined as data
 * URIs. Throws — naming the flag — for anything out of range, before a
 * paid submit can happen.
 */
export function buildSeedanceRequest(options?: SeedanceOptions): SeedanceRequest;

/**
 * Move an MP4's index to the front (`-c copy -movflags +faststart`) so a
 * browser can seek without an extra round trip. Best effort: returns false
 * and notes on stderr when ffmpeg is absent or the pass fails.
 */
export function remuxFaststart(path: string, options?: { onNote?: (message: string) => void }): boolean;

/**
 * Run one Seedance job and write its clip to `output` atomically. Rejects
 * with the upstream message on failure; the remote job is cancelled before
 * this gives up on it.
 */
export function generateSeedanceVideo(
  options: SeedanceOptions & {
    output: string;
    apiKey?: string;
    signal?: AbortSignal;
    deadlineMs?: number;
    /** Skip the ffmpeg faststart pass (tests, or clips fed straight to ffmpeg). */
    remux?: boolean;
  },
  dependencies?: SeedanceDependencies,
): Promise<SeedanceResult>;

/** The CLI entry. Resolves to the process exit code (0, or 130 on interrupt). */
export function main(argv?: string[]): Promise<number>;

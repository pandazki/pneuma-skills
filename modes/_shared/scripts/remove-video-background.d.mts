// Type declarations for the untyped shared video-matting script
// (remove-video-background.mjs). The module is plain JS so it can be copied
// into a skill and run by `node` with no build step; these stubs exist so
// TypeScript callers and `modes/_shared/scripts/__tests__/` can use it
// under `tsc --noEmit`.

/** Which fal endpoint a `--model` alias names, and what it can write. */
export interface MatteModel {
  /** Synchronous fal URL; `runFalJob` rewrites it onto the queue host. */
  url: string;
  /** The only extension `--output` may carry for this model (".webm" | ".mov"). */
  extension: string;
  /** Names the job in deadline and cancellation messages. */
  label: string;
  /** True when fal's schema says `video` is a list rather than one file. */
  resultIsList: boolean;
}

/** Keys: `veed`, `veed-gs` (the chroma-green endpoint), `bria`. */
export const MATTE_MODELS: Record<string, MatteModel>;
export const DEFAULT_MATTE_MODEL: string;
/** fal's own default for `spill_suppression_strength` (veed-gs). */
export const DEFAULT_SPILL_SUPPRESSION: number;

/** Bria's documented input ceiling: "duration less than 30s". */
export const BRIA_MAX_DURATION_S: number;
/** Bria's documented input ceiling: "Size should be less than 4000x4000". */
export const BRIA_MAX_DIMENSION: number;

/** What ffprobe could read off a clip; any field is null when unreadable. */
export interface ProbedVideo {
  width: number | null;
  height: number | null;
  duration: number | null;
}

export interface RemoveVideoBackgroundOptions {
  /** Local path or URL of the clip to matte. */
  input?: string;
  /** Destination path; `.webm` for veed, `.mov` for bria. */
  output?: string;
  /** A key of `MATTE_MODELS` (veed | veed-gs | bria). */
  model?: string;
  /** veed only: sends `subject_is_person`. Defaults to false — an icon, not a person. */
  person?: boolean;
  /** veed only: false sends `refine_foreground_edges: false` (cheaper, softer edges). */
  refine?: boolean;
  /** veed-gs only: `spill_suppression_strength`. Defaults to `DEFAULT_SPILL_SUPPRESSION`. */
  spill?: string | number;
}

/** VEED's field names — the only spelling that reaches that endpoint. */
export interface VeedMatteRequestBody {
  video_url: string;
  output_codec: "vp9";
  refine_foreground_edges: boolean;
  subject_is_person: boolean;
}

/** The green-screen endpoint's field names — it is told the plate up front,
 *  so it has no subject hint and no refinement tier. */
export interface VeedGreenScreenMatteRequestBody {
  video_url: string;
  output_codec: "vp9";
  spill_suppression_strength: number;
}

/** Bria's field names — the only spelling that reaches that endpoint. */
export interface BriaMatteRequestBody {
  video_url: string;
  background_color: "Transparent";
  output_container_and_codec: "mov_proresks";
  preserve_audio: false;
}

export type RemoveVideoBackgroundRequestBody =
  | VeedMatteRequestBody
  | VeedGreenScreenMatteRequestBody
  | BriaMatteRequestBody;

export interface RemoveVideoBackgroundRequest {
  url: string;
  /** The alias as passed (veed | bria); the endpoint itself is `url`. */
  model: string;
  body: RemoveVideoBackgroundRequestBody;
}

/** The `--json` contract. `alpha` is always true: both models are configured for it. */
export interface RemoveVideoBackgroundResult {
  path: string;
  url: string;
  /** Bytes of the file on disk. */
  file_size: number;
  model: string;
  endpoint: string;
  alpha: true;
}

/** One entry of a fal `File` / `Video` result. */
export interface FalFileRef {
  url: string;
  content_type?: string;
  file_name?: string;
  file_size?: number;
}

/** Turns a local path into the hosted URL fal fetches. `uploadFalFile` by default. */
export type FalUploader = (
  path: string,
  options: { key?: string; label?: string; signal?: AbortSignal; onNote?: (message: string) => void },
) => Promise<string>;

export interface RemoveVideoBackgroundDependencies {
  /** Defaults to `fal-queue.mjs::uploadFalFile`. */
  upload?: FalUploader;
  /** Defaults to `probeVideoFile`; injected so the limit check needs no ffprobe. */
  probe?: (path: string) => ProbedVideo | null;
  /** Defaults to `fal-queue.mjs::runFalJob`. */
  runJob?: (options: {
    url: string;
    /** Exactly what this script builds — never a free-form payload. */
    body: RemoveVideoBackgroundRequestBody;
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
 * Pixel dimensions and duration of a local clip, or null when ffprobe is
 * absent or cannot read the file. Null means "not measured", never "fine".
 */
export function probeVideoFile(path: string): ProbedVideo | null;

/**
 * The exact request the chosen endpoint is sent. A local input is uploaded
 * to fal storage first (never inlined — these endpoints cap `video_url` at
 * 2083 characters), which is why this is async. Throws — naming the flag —
 * for an unknown model, an output extension the model cannot write, a
 * veed-only flag on another model, `--spill` on anything but `veed-gs`, a
 * data URI, a missing file, or a clip past Bria's documented size/duration
 * limits; every one of those is checked before the upload starts.
 */
export function buildRemoveVideoBackgroundRequest(
  options?: RemoveVideoBackgroundOptions & { apiKey?: string; signal?: AbortSignal },
  dependencies?: {
    probe?: (path: string) => ProbedVideo | null;
    upload?: FalUploader;
    onNote?: (message: string) => void;
  },
): Promise<RemoveVideoBackgroundRequest>;

/**
 * The matted clip in a finished job: `video[0]` for the two VEED endpoints,
 * `video` for bria.
 * The other shape is returned with a warning rather than dropped — this runs
 * after the render is paid for. Null when neither shape carries a URL.
 */
export function mattedFile(
  data: any,
  model: string,
  options?: { onNote?: (message: string) => void },
): FalFileRef | null;

/**
 * Run one matting job and write the transparent clip to `output` atomically.
 * Rejects with the upstream message on failure; the remote job is cancelled
 * before this gives up on it.
 */
export function removeVideoBackground(
  options: RemoveVideoBackgroundOptions & {
    output: string;
    apiKey?: string;
    signal?: AbortSignal;
    deadlineMs?: number;
  },
  dependencies?: RemoveVideoBackgroundDependencies,
): Promise<RemoveVideoBackgroundResult>;

/** The CLI entry. Resolves to the process exit code (0, or 130 on interrupt). */
export function main(argv?: string[]): Promise<number>;

// Type declarations for the untyped shared motion-transfer script
// (motion-transfer.mjs). The module is plain JS so it can be copied into a
// skill and run by `node` with no build step; these stubs exist so
// TypeScript callers and `modes/_shared/scripts/__tests__/` can use it
// under `tsc --noEmit`.

export type MotionModelName = "kling-mc" | "kling-mc-pro" | "wan-animate";
export type MotionFamily = "kling" | "wan";
export type Orientation = "image" | "video";

export interface MotionModel {
  /** fal endpoint id, e.g. `fal-ai/kling-video/v3/standard/motion-control`. */
  endpoint: string;
  /** Decides the request shape and which flags apply. */
  family: MotionFamily;
  /** fal's unit price per output second (pricing API, {@link PRICES_CHECKED}). */
  usdPerSecond: number;
  /** Names the job in deadline and cancellation messages. */
  label: string;
}

export const MODELS: Readonly<Record<MotionModelName, Readonly<MotionModel>>>;
export const PRICES_CHECKED: string;
export const DEFAULT_MODEL: MotionModelName;
export const ORIENTATIONS: Orientation[];
export const DEFAULT_ORIENTATION: Orientation;
export const WAN_RESOLUTIONS: string[];
export const DEFAULT_WAN_RESOLUTION: string;
export const DEFAULT_DEADLINE_S: number;

/** Every knob the CLI exposes, in the spelling the builder takes. */
export interface MotionTransferOptions {
  image?: string;
  video?: string;
  output?: string;
  model?: string;
  /** Kling only. */
  orientation?: string;
  /** Kling only. */
  prompt?: string;
  /** Wan only. */
  resolution?: string;
  /** Wan only. */
  seed?: string | number;
}

/** The options after validation: defaults filled in, other models' flags absent. */
export interface ValidatedMotionOptions {
  image: string;
  video: string;
  output: string;
  model: MotionModelName;
  orientation?: Orientation;
  prompt?: string;
  resolution?: string;
  seed?: number;
}

/** fal's own field names — the only spelling that reaches the endpoint. */
export interface MotionRequestBody {
  image_url: string;
  video_url: string;
  /** Kling. */
  character_orientation?: Orientation;
  prompt?: string;
  /** Kling: always false. */
  keep_original_sound?: false;
  /** Wan. */
  resolution?: string;
  seed?: number;
}

/** Longest driving clip the model takes: 10 s for Kling + orientation image, else 30 s. */
export function maxDrivingSeconds(model: string, orientation?: string): number;
/** `https://fal.run/<endpoint>` for a model. */
export function endpointUrl(model: MotionModelName): string;
/** Throws a refusal naming the flag at fault; no I/O. */
export function validateOptions(options?: MotionTransferOptions): ValidatedMotionOptions;
/**
 * Throws when the driving clip is over the model's ceiling. Returns true
 * when it was checked and fits, false (with a note) when `duration` is null.
 */
export function checkDrivingDuration(args: {
  model: string;
  orientation?: string;
  duration: number | null | undefined;
  source?: string;
  onNote?: (message: string) => void;
}): boolean;
export function buildRequestBody(
  model: string,
  inputs?: { imageUrl?: string; videoUrl?: string; orientation?: string; prompt?: string; resolution?: string; seed?: number },
): MotionRequestBody;

export interface ProbedVideo {
  width: number | null;
  height: number | null;
  duration: number | null;
}
/** Width, height and duration of a local clip, or null without ffprobe. */
export function probeVideo(path: string): ProbedVideo | null;

export interface PreparedMotionRequest {
  model: MotionModelName;
  endpoint: string;
  url: string;
  body: MotionRequestBody;
  options: ValidatedMotionOptions;
}
/** Validate, check the driving clip's length, inline the image, upload the video. */
export function prepareRequest(
  options?: MotionTransferOptions & { apiKey?: string; signal?: AbortSignal },
  dependencies?: {
    probe?: (path: string) => ProbedVideo | null;
    upload?: (path: string, options: { key?: string; label?: string; signal?: AbortSignal; onNote?: (message: string) => void }) => Promise<string>;
    onNote?: (message: string) => void;
  },
): Promise<PreparedMotionRequest>;

/** What a transfer cost at fal's per-second price — always an estimate. */
export interface MotionTransferCost {
  usd: number | null;
  estimate: true;
  basis: "seconds-of-delivered-clip" | "unknown";
  usdPerSecond?: number;
  duration?: number;
  checked?: string;
  note?: string;
}
export function transferCost(clip?: { model?: string; duration?: number | null }): MotionTransferCost;
/** The stderr `cost:` line for a cost object. */
export function costLine(cost: MotionTransferCost | null | undefined, model?: string): string;

/** `-c copy -movflags +faststart`, best effort; false (with a note) without ffmpeg. */
export function remuxFaststart(path: string, options?: { onNote?: (message: string) => void }): boolean;

/** The `--json` contract. */
export interface MotionTransferResult {
  path: string;
  url: string;
  /** Bytes of the file on disk, measured after the faststart remux. */
  file_size: number;
  model: MotionModelName;
  endpoint: string;
  duration: number | null;
  width: number | null;
  height: number | null;
  orientation?: Orientation;
  resolution?: string;
  seed?: number;
  /** fal's queue id, when the queue reported one. */
  request_id?: string;
  cost: MotionTransferCost;
}

export interface MotionTransferDependencies {
  runJob?: (options: {
    url: string;
    body: MotionRequestBody;
    key: string;
    signal?: AbortSignal;
    label?: string;
    deadlineMs?: number;
    onRetry?: (info: { attempt: number; attempts: number; delayMs: number; reason: string }) => void;
  }) => Promise<{ data?: any; apiMs?: number; attempts?: number; requestId?: string }>;
  download?: (url: string, options?: { signal?: AbortSignal; attempts?: number }) => Promise<Uint8Array>;
  upload?: (path: string, options: { key?: string; label?: string; signal?: AbortSignal; onNote?: (message: string) => void }) => Promise<string>;
  probe?: (path: string) => ProbedVideo | null;
  remuxFile?: (path: string, options?: { onNote?: (message: string) => void }) => boolean;
  onNote?: (message: string) => void;
}

/** Run one job and write its clip to `output` atomically. */
export function transferMotion(
  options: MotionTransferOptions & {
    apiKey?: string;
    signal?: AbortSignal;
    deadlineMs?: number;
    /** Skip the ffmpeg faststart pass. */
    remux?: boolean;
  },
  dependencies?: MotionTransferDependencies,
): Promise<MotionTransferResult>;

/** The CLI entry. Resolves to the process exit code (0, or 130 on interrupt). */
export function main(argv?: string[]): Promise<number>;

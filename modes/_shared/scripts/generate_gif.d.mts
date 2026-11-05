// Type declarations for the untyped shared GIF script (generate_gif.mjs).
// The module is plain JS so it can be copied into a skill and run by `node`
// with no build step; these stubs exist so TypeScript callers and
// `modes/_shared/scripts/__tests__/` can use it under `tsc --noEmit`.

export const GIF_MODELS: string[];
export const DEFAULT_GIF_MODEL: string;
export const GIF_QUALITIES: string[];
export const GIF_BACKGROUNDS: string[];

/** fal's published GIF limits (read 2026-11-05). */
export const GIF_LIMITS: Readonly<{
  minFrames: number;
  maxFrames: number;
  minFrameDurationMs: number;
  maxFrameDurationMs: number;
  sizeMultiple: number;
  maxEdge: number;
  maxAspect: number;
  /** frames × width × height of one request may not exceed this. */
  pixelBudget: number;
  maxReferences: number;
  maxPromptLength: number;
}>;

export const DEFAULT_FRAME_COUNT: number;
export const DEFAULT_FRAME_DURATION_MS: number;
export const DEFAULT_GIF_SIZE: string;
export const DEFAULT_GIF_QUALITY: string;

/** fal's per-million-token list price for GPT Image 2.6, and when it was read. */
export const GPT_IMAGE_26_FAL_PRICE: Readonly<{
  imageOutputPer1M: number;
  imageInputPer1M: number;
  textInputPer1M: number;
  checked: string;
}>;

/** `flare` → `openai/gpt-image-2.6-flare`. */
export function gifModelId(model: string): string;
/** The fal endpoint: `.../text-to-image` without references, `.../edit` with them. */
export function gifEndpoint(model: string, hasReferences: boolean): string;
/** `WxH` per frame, checked against fal's multiple-of-16, edge and aspect rules. */
export function parseFrameSize(raw: string): { width: number; height: number };

export interface GifOptions {
  /** The animation, in words. */
  prompt?: string;
  /** Destination; must end in `.gif`. */
  output?: string;
  /** `flare` (default) or `sunburst`. */
  model?: string;
  /** Local paths or URLs, in order; any reference selects the edit endpoint. */
  imageUrls?: string[];
  frameCount?: number | string;
  frameDurationMs?: number | string;
  /** Per frame, `WxH`. */
  imageSize?: string;
  quality?: string;
  /** Omitted from the body when absent. */
  background?: string;
}

export interface GifRequestBody {
  prompt: string;
  output_format: "gif";
  frame_count: number;
  frame_duration_ms: number;
  image_size: { width: number; height: number };
  quality: string;
  background?: string;
  image_urls?: string[];
}

export interface GifRequest {
  url: string;
  /** The recorded model id, e.g. `openai/gpt-image-2.6-flare`. */
  model: string;
  body: GifRequestBody;
}

/** The exact request fal is sent; throws, naming the flag, before any network call. */
export function buildGifRequest(options?: GifOptions): GifRequest;

export interface GifInfo {
  width: number;
  height: number;
  frames: number;
  /** Each frame's delay from its Graphic Control Extension, in ms (0 when absent). */
  delaysMs: number[];
  /** Any frame names a transparent palette index. */
  transparent: boolean;
  /** NETSCAPE repeat count (0 = forever), or null when the file has none. */
  loops: number | null;
}

/** Read a GIF's block structure; throws for anything that is not a complete GIF. */
export function readGifInfo(bytes: Uint8Array | ArrayLike<number>): GifInfo;

export interface GifCost {
  /** Always null: fal reports no token counts for these requests. */
  usd: null;
  basis: "unknown";
  note: string;
  listPrice: { imageOutputPer1M: number; imageInputPer1M: number; textInputPer1M: number; checked: string };
}

export function gifCost(): GifCost;
/** The stderr `cost:` line. */
export function costLine(cost?: GifCost): string;

/** The `--json` contract. */
export interface GifResult {
  backend: "fal";
  model: string;
  endpoint: string;
  requestId?: string;
  files: string[];
  /** fal's CDN URL of the GIF. */
  url: string;
  /** Read from the file; equal to the request, or the call failed. */
  frameCount: number;
  /** The file's own per-frame delay (the mean when frames differ, with a warning). */
  frameDurationMs: number;
  durationMs: number;
  /** The file's logical screen. */
  size: { width: number; height: number };
  background?: string;
  hasTransparency: boolean;
  cost: GifCost;
}

export interface GifDependencies {
  /** Defaults to `fal-queue.mjs::runFalJob`. */
  runJob?: (options: {
    url: string;
    body: GifRequestBody;
    key: string;
    signal?: AbortSignal;
    deadlineMs?: number;
    label?: string;
    onStatus?: (update: { status: string; queue_position?: number }) => void;
    onRetry?: (info: { attempt: number; attempts: number; delayMs: number; reason: string }) => void;
  }) => Promise<{ data?: any; requestId?: string; apiMs?: number; attempts?: number }>;
  /** Defaults to `fal-queue.mjs::downloadFalFile`. */
  download?: (url: string, options?: { signal?: AbortSignal }) => Promise<Uint8Array>;
}

/**
 * One job, written to `output`. Throws with `requestId` on any failure after
 * fal accepted the job; a GIF whose frame count differs from the request is
 * kept on disk (`error.path`) and thrown as a failure.
 */
export function generateGif(
  options: GifOptions & {
    output: string;
    apiKey?: string;
    signal?: AbortSignal;
    deadlineMs?: number;
    onStatus?: (update: { status: string; queue_position?: number }) => void;
  },
  dependencies?: GifDependencies,
): Promise<GifResult>;

/** The CLI entry. Resolves to the exit code (0, or 130 on interrupt). */
export function main(argv?: string[]): Promise<number>;

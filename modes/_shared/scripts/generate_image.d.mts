/** Importable surface of the shared GPT Image 2.5 adapter. */
export const DEFAULT_IMAGE_MODEL: string;
export const DEFAULT_EDIT_IMAGE_MODEL: string;
export const IMAGE_MODELS: string[];
export const IMAGE_QUALITIES: string[];
export const IMAGE_ASPECTS: string[];
export const IMAGE_BACKGROUNDS: string[];

export interface ImageOptions {
  prompt: string;
  model?: string;
  numImages?: number;
  aspectRatio?: string;
  imageSize?: string;
  quality?: string;
  outputFormat?: string;
  imageUrls?: string[];
  maskUrl?: string;
  /** "auto" | "transparent" | "opaque". Omitted from the body when absent. */
  background?: string;
}
export interface ImageRequest {
  model: string;
  prompt: string;
  n: number;
  quality: string;
  output_format: string;
  size?: string;
  aspect_ratio?: string;
  background?: string;
  input_references?: Array<{ type: "image_url"; image_url: { url: string } }>;
}
export interface ImageResult {
  backend: "openrouter";
  model: string;
  endpoint: string;
  files: string[];
  urls: string[];
  description: string;
  usage?: { cost?: number; [key: string]: unknown };
  /**
   * Only present when `background: "transparent"` was requested: whether
   * every saved file actually carries an alpha channel. `false` means the
   * provider ignored the request (a stderr warning names the files).
   */
  hasAlpha?: boolean;
}
export interface ImageDependencies {
  fetchImpl?: (url: string, options: RequestInit) => Promise<Response>;
}
export function loadEnvKeys(): { OPENROUTER_API_KEY?: string };
export function resolveImageModel(model?: string): string;
export function imageReference(source: string): string;
export function buildImageRequest(options: ImageOptions): ImageRequest;
/**
 * Whether these image bytes can carry transparency, read from the
 * container header alone: PNG colour type 4/6 or a `tRNS` chunk, the WebP
 * VP8X alpha flag or the VP8L `alpha_is_used` bit. JPEG and anything
 * unreadable answer `false`.
 */
export function hasAlphaChannel(image: Uint8Array | ArrayBufferView | ArrayLike<number>): boolean;
export function generateImage(
  options: ImageOptions & { apiKey?: string; outputDir?: string; filenamePrefix?: string; signal?: AbortSignal },
  dependencies?: ImageDependencies,
): Promise<ImageResult>;
export function main(args?: string[]): Promise<void>;

/** Importable surface of the shared GPT Image 2.5 adapter. */
export const DEFAULT_IMAGE_MODEL: string;
export const DEFAULT_EDIT_IMAGE_MODEL: string;
export const IMAGE_MODELS: string[];
export const IMAGE_QUALITIES: string[];
export const IMAGE_ASPECTS: string[];

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
}
export interface ImageRequest {
  model: string;
  prompt: string;
  n: number;
  quality: string;
  output_format: string;
  size?: string;
  aspect_ratio?: string;
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
}
export interface ImageDependencies {
  fetchImpl?: (url: string, options: RequestInit) => Promise<Response>;
}
export function loadEnvKeys(): { OPENROUTER_API_KEY?: string };
export function resolveImageModel(model?: string): string;
export function imageReference(source: string): string;
export function buildImageRequest(options: ImageOptions): ImageRequest;
export function generateImage(
  options: ImageOptions & { apiKey?: string; outputDir?: string; filenamePrefix?: string; signal?: AbortSignal },
  dependencies?: ImageDependencies,
): Promise<ImageResult>;
export function main(args?: string[]): Promise<void>;

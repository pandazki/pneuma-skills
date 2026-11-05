// Type declarations for the untyped shared SVG generator (generate_svg.mjs).
// The module is plain JS so an installed skill can run it with `node`;
// these stubs let TypeScript callers and tests use it under `tsc --noEmit`.

/** Image model → fal's synchronous text-to-image endpoint. */
export const SVG_ENDPOINTS: Readonly<{ flare: string; sunburst: string }>;
export const DEFAULT_SVG_MODEL: "sunburst";
export const DEFAULT_SVG_AUTHOR: string;
/**
 * Author models measured on 2026-11-05: typical wall time, and the caution
 * printed before a paid run when their measured results were unreliable.
 */
export const MEASURED_SVG_AUTHORS: Readonly<Record<string, Readonly<{ time: string; caution: string | null }>>>;
export const SVG_QUALITIES: string[];
export const DEFAULT_SVG_QUALITY: string;
export const SVG_BACKGROUNDS: string[];
export const DEFAULT_SVG_SIZE: string;
export const DEFAULT_SVG_PREFIX: string;
export const MAX_PROMPT_LENGTH: number;
/** fal's published `image_size` rule for these endpoints. */
export const SVG_SIZE_LIMITS: Readonly<{ multiple: number; maxEdge: number; maxAspect: number; minPixels: number; maxPixels: number }>;
/** fal's list price per 1M tokens; a run's own cost is not reported by fal. */
export const SVG_LIST_PRICE: Readonly<{
  imageOutputPer1M: number;
  imageInputPer1M: number;
  textInputPer1M: number;
  textOutputPer1M: number;
  checked: string;
}>;

export interface SvgOptions {
  prompt: string;
  /** sunburst (default) or flare; `gpt-image-2.6-` and `openai/` prefixes are accepted. */
  model?: string;
  /** SVG author model sent as `provider_options.svg.model`. Default gpt-6.1-terra. */
  author?: string;
  /** auto | low | medium | high — the reference picture's quality. Default medium. */
  quality?: string;
  /** `WxH`, checked against fal's published limits. Default 1024x1024. */
  imageSize?: string;
  /** auto | transparent | opaque. Omitted from the body when absent. */
  background?: string;
}

export interface SvgRequest {
  url: string;
  /** `openai/gpt-image-2.6-flare` or `openai/gpt-image-2.6-sunburst`. */
  model: string;
  author: string;
  body: {
    prompt: string;
    output_format: "svg";
    num_images: 1;
    image_size: { width: number; height: number };
    quality: string;
    provider_options: { svg: { model: string } };
    background?: string;
  };
}

export interface SvgReport {
  bytes: number;
  viewBox: string | null;
  width: string | null;
  height: string | null;
  title: string | null;
  desc: string | null;
  elements: { total: number; byTag: Record<string, number> };
  /** `pure` is false when the file embeds raster (`<image>` or raster data URIs). */
  vector: { pure: boolean; imageElements: number; rasterDataUris: number; externalRefs: number };
  /** `<text>` renders in whatever font the viewer has. */
  text: { elements: number; fonts: string[] };
  /** Distinct paint colours, `#rrggbb` (alpha dropped) or a lower-cased name. */
  colors: string[];
  /** Present only when a palette was given: colours not in it. */
  offPalette?: string[];
  /** The full-canvas rect's paint when the first drawn shape is one, else null. */
  background: string | null;
  activeContent: { scripts: number; eventHandlers: number; foreignObjects: number };
  warnings: string[];
}

export interface SvgCost {
  usd: null;
  estimate: true;
  basis: "unknown";
  note: string;
  listPrice: typeof SVG_LIST_PRICE & { unit: string };
}

export interface SvgResult {
  backend: "fal";
  model: string;
  author: string;
  endpoint: string;
  requestId: string | null;
  quality: string;
  imageSize: string;
  background?: string;
  /** Local completion time; not fal's billing timestamp. */
  generatedAt: string;
  /** Wall time from submit to result. */
  seconds: number;
  files: string[];
  urls: string[];
  report: SvgReport;
  cost: SvgCost;
}

export interface SvgDependencies {
  /** Reaches fal's queue and the artifact download. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export function resolveSvgModel(model?: string): "flare" | "sunburst";
export function parseSvgSize(size?: string): { width: number; height: number };
export function parsePalette(palette?: string | string[] | null): string[] | null;
export function normalizeColor(value: string): string | null;
export function buildSvgRequest(options: SvgOptions): SvgRequest;
/** The root `<svg …>` start tag; throws when the bytes are not a complete SVG document. */
export function svgRootTag(input: Uint8Array | string): string;
/** Facts about an SVG document; throws when it is not one. */
export function inspectSvg(input: Uint8Array | string, options?: { palette?: string | string[] | null }): SvgReport;
export function svgCost(options?: { author?: string }): SvgCost;
export function costLine(cost?: SvgCost): string;
/**
 * One request; writes `<outputDir>/<filenamePrefix>.svg`. Refuses before the
 * request when the target exists, the key is missing or an option is invalid.
 * Errors thrown after fal accepted the job carry `requestId`.
 */
export function generateSvg(
  options: SvgOptions & {
    apiKey?: string | null;
    outputDir?: string;
    filenamePrefix?: string;
    palette?: string | string[] | null;
    signal?: AbortSignal;
    deadlineMs?: number;
    onNote?: (message: string) => void;
  },
  dependencies?: SvgDependencies,
): Promise<SvgResult>;
export function main(argv?: string[]): Promise<number>;

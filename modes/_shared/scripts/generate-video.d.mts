// Type declarations for the untyped shared H3 Max script (generate-video.mjs).
// The module is plain JS so it can be copied into a skill and run by `node`
// with no build step; these stubs exist so TypeScript callers and
// `modes/_shared/scripts/__tests__/` can use its cost helpers under
// `tsc --noEmit`. Importing it runs nothing: the CLI lives in `main`.

/** fal's list price for H3 Max (model pages read `checked`). */
export const H3_PRICES: {
  readonly usdPerSecond: Readonly<Record<"480P" | "768P", number>>;
  readonly includedReferenceTokens: number;
  readonly usdPer1000ReferenceTokens: number;
  readonly squareImageTokens: number;
  /** The last day fal's text/image pages advertise their launch rate. */
  readonly launchRateUntil: string;
  readonly checked: string;
};

/** What one clip costs at fal's list price, from the request. */
export interface H3Cost {
  /** Null for a resolution or duration with no known rate. */
  usd: number | null;
  estimate: true;
  basis: "requested-duration" | "unknown";
  endpoint?: string;
  resolution?: string;
  checked: string;
  seconds?: number;
  usdPerSecond?: number;
  /** What the estimate leaves out (reference tokens) or does not apply (a launch rate). */
  note?: string;
}

export function h3Cost(input?: {
  endpoint?: "text" | "image" | "reference" | string;
  resolution?: string;
  duration?: number;
  refImages?: number;
  refVideos?: number;
  refAudios?: number;
  today?: Date;
}): H3Cost;

/** The one stderr line: `cost: ≈ $X (estimate: …)` or `cost: unknown (…)`. */
export function costLine(cost: H3Cost | null | undefined): string;

/** The CLI entry. Resolves to 0; a refused argument exits the process with 1. */
export function main(argv?: string[]): Promise<number>;

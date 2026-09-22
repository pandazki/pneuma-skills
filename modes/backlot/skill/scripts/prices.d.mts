// Type declarations for prices.mjs, which is plain JS so `node` can run it
// from an installed skill with no build step. These stubs exist so the
// TypeScript tests in `modes/backlot/__tests__/` type-check.

export interface PrizeTable {
  asOf: string;
  currency: string;
  basis: string;
  seedance: {
    withReference: Record<string, number>;
    withoutReference: Record<string, number>;
  };
}

export const PRICES: PrizeTable;
export const PRICED_RESOLUTIONS: string[];

export interface TakePrice {
  usd: number;
  basis: string;
  perSecond: number;
  billedSeconds: number;
  resolution: string;
  seconds: number;
  refSeconds: number;
  estimate: true;
}

/** Throws for a resolution with no list price, before any paid submit. */
export function priceTake(
  job: { seconds: number; refSeconds?: number; resolution?: string },
  prices?: PrizeTable,
): TakePrice;

export interface TakeCostSummary {
  asOf: string;
  currency: string;
  basis: string;
  estimate: true;
  count: number;
  total: number;
  unpriced: string[];
  takes: Array<{ id: string | null; status: string | null; usd: number | null; basis: string | null }>;
}

export function summarizeTakeCosts(
  takes?: Array<{ id?: string; status?: string; cost?: { usd?: number; basis?: string } | null }>,
  prices?: PrizeTable,
): TakeCostSummary;

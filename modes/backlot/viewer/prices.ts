/**
 * The per-second price table the Cost tab prints.
 *
 * ONE AUTHORITY: `skill/scripts/prices.mjs` is the table, and it is the same
 * module `previz.mjs generate --estimate` prices a job with before it
 * submits. The viewer imports it rather than keeping a second copy — a panel
 * with its own numbers would eventually quote a price the script did not
 * charge. What a TAKE cost is still read from `shot.json`, where the script
 * wrote it at submission time; this table only explains where that number
 * came from.
 */

import { PRICES } from "../skill/scripts/prices.mjs";

export interface PriceRow {
  resolution: string;
  /** USD per second with a video reference (reference-to-video). */
  withReference: number | null;
  /** USD per second with no reference (text-to-video). */
  withoutReference: number | null;
}

/** Every resolution the script will price, in the table's own order. */
export const SEEDANCE_PRICE_TABLE: ReadonlyArray<PriceRow> = Object.keys(
  PRICES.seedance.withReference,
).map((resolution) => ({
  resolution,
  withReference: PRICES.seedance.withReference[resolution] ?? null,
  withoutReference: PRICES.seedance.withoutReference[resolution] ?? null,
}));

export const PRICES_AS_OF = PRICES.asOf;

export const PRICE_BASIS = PRICES.basis;

/**
 * What a Seedance take costs, in USD.
 *
 * One table for the script (`previz.mjs generate --estimate`, `status` →
 * `costs`) and the viewer's cost panel, so the two never disagree. Every
 * figure is a PUBLIC LIST PRICE at the date below, read off the fal.ai model
 * page; what a take actually cost is whatever fal billed, and every number
 * this module produces is labelled an estimate.
 *
 * The shape of the bill is the part worth remembering: on the
 * reference-to-video endpoint fal bills the REFERENCE clip's duration
 * alongside the output's, so an 8 s take conditioned on an 8 s greybox is
 * billed as 16 s. A previz take always has a reference — that is the whole
 * point of the mode — so `withReference` is the row this mode normally uses.
 */
export const PRICES = {
  asOf: "2026-09-20",
  currency: "USD",
  basis: "fal.ai public list prices for bytedance/seedance-2.5; on the reference endpoint the reference clip's duration is billed alongside the output's",
  /** USD per billed second, by whether the job carries a video reference. */
  seedance: {
    withReference: { "480p": 0.1323, "720p": 0.2838 },
    withoutReference: { "480p": 0.2205, "720p": 0.473 },
  },
};

/** The resolutions this mode will price, and therefore the ones it will run. */
export const PRICED_RESOLUTIONS = Object.keys(PRICES.seedance.withReference);

/**
 * Price one take before it is submitted.
 *
 * Throws — naming the flag — for a resolution the table has no row for, so a
 * paid job is never started at a price nobody can state. `refSeconds` of 0
 * means no video reference, which moves the job to the dearer row.
 *
 * @param {{ seconds: number, refSeconds?: number, resolution?: string }} job
 * @param {typeof PRICES} [prices]
 * @returns {{ usd: number, basis: string, perSecond: number, billedSeconds: number, resolution: string, seconds: number, refSeconds: number, estimate: true }}
 */
export function priceTake({ seconds, refSeconds = 0, resolution = "480p" }, prices = PRICES) {
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`seconds must be a positive number (got: ${seconds})`);
  if (!Number.isFinite(refSeconds) || refSeconds < 0) throw new Error(`refSeconds must be zero or more (got: ${refSeconds})`);
  const row = refSeconds > 0 ? prices.seedance.withReference : prices.seedance.withoutReference;
  const perSecond = row[resolution];
  if (typeof perSecond !== "number") {
    throw new Error(
      `no list price for resolution "${resolution}" (priced: ${Object.keys(row).join(", ")}) — ` +
        "this mode refuses to start a paid job at a price it cannot state",
    );
  }
  const billedSeconds = seconds + refSeconds;
  const basis = refSeconds > 0
    ? `(${trim(seconds)} s out + ${trim(refSeconds)} s ref) x $${perSecond}/s at ${resolution}`
    : `${trim(seconds)} s out x $${perSecond}/s at ${resolution}`;
  return {
    usd: round(billedSeconds * perSecond),
    basis,
    perSecond,
    billedSeconds: round(billedSeconds),
    resolution,
    seconds,
    refSeconds,
    estimate: true,
  };
}

/**
 * What a shot's recorded takes add up to.
 *
 * A take whose price was never recorded is reported as unpriced rather than
 * as free; a `failed` take still counts, because a job that left this machine
 * was paid for whether or not its clip arrived.
 *
 * @param {Array<{ id?: string, status?: string, cost?: { usd?: number, basis?: string } | null }>} takes
 */
export function summarizeTakeCosts(takes = [], prices = PRICES) {
  const rows = takes.map((take) => ({
    id: take?.id ?? null,
    status: take?.status ?? null,
    usd: typeof take?.cost?.usd === "number" ? round(take.cost.usd) : null,
    basis: take?.cost?.basis ?? null,
  }));
  return {
    asOf: prices.asOf,
    currency: prices.currency,
    basis: prices.basis,
    estimate: true,
    count: rows.length,
    total: round(rows.reduce((sum, row) => sum + (row.usd ?? 0), 0)),
    unpriced: rows.filter((row) => row.usd === null).map((row) => row.id ?? "?"),
    takes: rows,
  };
}

function round(usd) {
  return Math.round(usd * 10000) / 10000;
}

/** 8 rather than 8.0, 7.5 stays 7.5 — the basis string is read by people. */
function trim(seconds) {
  return Number.isInteger(seconds) ? String(seconds) : String(Math.round(seconds * 1000) / 1000);
}

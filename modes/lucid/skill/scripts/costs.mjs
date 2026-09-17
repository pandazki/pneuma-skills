/**
 * The loop's cost, estimated from what it recorded.
 *
 * Three things cost money here and each is read from a different place:
 * fal jobs from `assets/fal-jobs.json` (priced per endpoint and option), image
 * generations from the session's tool calls (a flat estimate per image), and
 * the model's tokens from the session's cumulative usage (list price per
 * million). Every figure is an ESTIMATE at list price — `PRICES.basis` says
 * so, and the panel repeats it — and a job on an endpoint the table does not
 * know is reported as unpriced rather than as free.
 *
 * Pure functions over plain data, so the script and the viewer compute the
 * same numbers from the same file.
 */
import { PRICES } from "./prices.mjs";

/** Price of one fal job from its endpoint and input; null when the endpoint is unknown. */
export function estimateFalJob(job, prices = PRICES) {
  const table = prices.fal[job?.endpoint];
  if (!table) return null;
  if (typeof table.flat === "number") return round(table.flat);
  const input = job.input ?? {};
  let usd = table.base;
  if (input.texture !== false) {
    usd += table.texture;
    if (input.texture_quality === "detailed") usd += table.hdTexture;
  }
  if (input.geometry_quality === "detailed") usd += table.detailedGeometry;
  if (input.quad === true) usd += table.quad;
  return round(usd);
}

/** Price of the model's tokens at list price; null when the model is not in the table. */
export function estimateTokens(usage, model, prices = PRICES) {
  if (!usage) return null;
  const rate = prices.tokensPer1M[model];
  if (!rate) return null;
  const cached = usage.cached_input_tokens ?? 0;
  const uncached = Math.max(0, (usage.input_tokens ?? 0) - cached);
  const output = usage.output_tokens ?? 0;
  return round((uncached * rate.input + cached * rate.cachedInput + output * rate.output) / 1_000_000);
}

/**
 * Everything the panel shows.
 *
 * @param {object} args
 * @param {Array<object>} [args.jobs] fal jobs (`assets/fal-jobs.json` → `jobs`)
 * @param {number[]} [args.imageTimestamps] one entry per image generation, ms since epoch
 * @param {object|null} [args.tokenUsage] the session's cumulative usage
 * @param {string} [args.model]
 * @param {Array<{index:number, at:string, verdict?:{total:number}|null}>} [args.rounds]
 * @param {object} [args.prices]
 */
export function summarizeCosts({ jobs = [], imageTimestamps = [], tokenUsage = null, model = "", rounds = [], prices = PRICES } = {}) {
  const pricedJobs = jobs.map((job) => ({ job, usd: estimateFalJob(job, prices), at: Date.parse(job.submitted_at ?? "") }));
  const fal = {
    count: jobs.length,
    usd: round(pricedJobs.reduce((sum, p) => sum + (p.usd ?? 0), 0)),
    unpriced: pricedJobs.filter((p) => p.usd === null).map((p) => p.job.id ?? p.job.endpoint ?? "?"),
    jobs: pricedJobs.map((p) => ({ id: p.job.id ?? null, endpoint: p.job.endpoint ?? null, state: p.job.state ?? null, usd: p.usd })),
  };
  const images = { count: imageTimestamps.length, usd: round(imageTimestamps.length * prices.imageGeneration.perImage) };
  const tokensUsd = estimateTokens(tokenUsage, model, prices);
  const tokens = { usage: tokenUsage, model, usd: tokensUsd, priced: tokensUsd !== null };

  // Per round: what was spent between the previous round's capture and this
  // one's, and after the last one ("in progress"). Tokens are cumulative
  // only, so they stay at the session level.
  const sorted = [...rounds].filter((r) => Number.isFinite(Date.parse(r.at ?? ""))).sort((a, b) => a.index - b.index);
  const byRound = [];
  let from = -Infinity;
  for (const round_ of sorted) {
    const to = Date.parse(round_.at);
    byRound.push(window_(round_.index, from, to, round_.verdict?.total ?? null, pricedJobs, imageTimestamps, prices));
    from = to;
  }
  const tail = window_(null, from, Infinity, null, pricedJobs, imageTimestamps, prices);
  if (tail.fal.count > 0 || tail.images.count > 0) byRound.push(tail);

  const total = round(fal.usd + images.usd + (tokensUsd ?? 0));
  return { asOf: prices.asOf, basis: prices.basis, currency: prices.currency, total, fal, images, tokens, byRound };
}

function window_(index, from, to, score, pricedJobs, imageTimestamps, prices) {
  const inWindow = (t) => Number.isFinite(t) && t > from && t <= to;
  const jobs = pricedJobs.filter((p) => inWindow(p.at));
  const imageCount = imageTimestamps.filter((t) => inWindow(t)).length;
  return {
    index,
    score,
    fal: { count: jobs.length, usd: round(jobs.reduce((sum, p) => sum + (p.usd ?? 0), 0)) },
    images: { count: imageCount, usd: round(imageCount * prices.imageGeneration.perImage) },
  };
}

function round(usd) {
  return Math.round(usd * 100) / 100;
}

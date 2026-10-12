/**
 * What the loop's outside services list as their price, in USD.
 *
 * One table for the script (`lucid.mjs status` → `costs`) and the viewer's
 * cost panel, so the two never disagree. Every figure here is a PUBLIC LIST
 * PRICE at the date below — a subscription pays for the model in quota, not
 * dollars, and the panel says so. Update the numbers here when a provider
 * changes them; nothing else needs to know.
 *
 * Sources: fal.ai model pages for the three endpoints (2026-09-17);
 * platform.openai.com/docs/pricing, "Standard, short context" table and the
 * image models table (2026-09-17).
 */
export const PRICES = {
  asOf: "2026-09-17",
  currency: "USD",
  basis: "OpenRouter image receipts use reported costs; other services use public list prices, and native model subscriptions consume quota",
  fal: {
    // "$0.20 (without textures), $0.30 (with standard textures), or $0.40
    // (with HD textures), plus an additional $0.20 for detailed geometry and
    // $0.05 for quad mesh if selected."
    "tripo3d/h3.1/image-to-3d": { base: 0.2, texture: 0.1, hdTexture: 0.1, detailedGeometry: 0.2, quad: 0.05 },
    "tripo3d/h3.1/multiview-to-3d": { base: 0.2, texture: 0.1, hdTexture: 0.1, detailedGeometry: 0.2, quad: 0.05 },
    // "$0.02 per generation."
    "fal-ai/trellis": { flat: 0.02 },
  },
  imageGeneration: {
    // Legacy native image-tool calls do not report usage. Preserve their
    // historical estimate; OpenRouter GPT Image 2.5 receipts always use
    // usage.cost instead, and missing reported costs remain unpriced.
    perImage: 0.15,
  },
  tokensPer1M: {
    "gpt-6-astra": { input: 10, cachedInput: 1, output: 50 },
    "gpt-5.6-sol": { input: 4, cachedInput: 0.4, output: 20 },
    "gpt-5.6-terra": { input: 2, cachedInput: 0.2, output: 12 },
    "gpt-5.6-luna": { input: 0.2, cachedInput: 0.02, output: 1.2 },
  },
};

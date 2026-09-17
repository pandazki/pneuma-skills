import { describe, expect, test } from "bun:test";

import { estimateFalJob, estimateTokens, summarizeCosts } from "../skill/scripts/costs.mjs";
import { PRICES } from "../skill/scripts/prices.mjs";

const T = (minutes: number): string => new Date(Date.UTC(2026, 8, 17, 10, minutes)).toISOString();
const ms = (minutes: number): number => Date.parse(T(minutes));

describe("estimateFalJob", () => {
  test("prices a Tripo job from its options, as the fal page lists them", () => {
    const hero = { endpoint: "tripo3d/h3.1/image-to-3d", input: { texture: true, pbr: true, texture_quality: "detailed", geometry_quality: "detailed" } };
    // $0.20 base + $0.10 textures + $0.10 HD + $0.20 detailed geometry.
    expect(estimateFalJob(hero)).toBe(0.6);
    expect(estimateFalJob({ endpoint: "tripo3d/h3.1/image-to-3d", input: { texture: true } })).toBe(0.3);
    expect(estimateFalJob({ endpoint: "tripo3d/h3.1/image-to-3d", input: { texture: false, geometry_quality: "detailed" } })).toBe(0.4);
    expect(estimateFalJob({ endpoint: "tripo3d/h3.1/multiview-to-3d", input: { texture: true, texture_quality: "detailed", quad: true } })).toBe(0.45);
    expect(estimateFalJob({ endpoint: "fal-ai/trellis", input: {} })).toBe(0.02);
  });

  test("an endpoint the table does not know is unpriced, not free", () => {
    expect(estimateFalJob({ endpoint: "fal-ai/hunyuan3d", input: {} })).toBeNull();
    expect(estimateFalJob({})).toBeNull();
  });
});

describe("estimateTokens", () => {
  test("bills uncached input, cached input and output at the model's list price", () => {
    // 10M input of which 9.65M cached, 48.7k output, GPT-6 Astra standard.
    const usage = { input_tokens: 10_016_821, cached_input_tokens: 9_651_328, output_tokens: 48_712, reasoning_output_tokens: 14_991 };
    const expected = ((10_016_821 - 9_651_328) * 10 + 9_651_328 * 1 + 48_712 * 50) / 1e6;
    expect(estimateTokens(usage, "gpt-6-astra")).toBe(Math.round(expected * 100) / 100);
    expect(estimateTokens(usage, "some-model")).toBeNull();
    expect(estimateTokens(null, "gpt-6-astra")).toBeNull();
  });
});

describe("summarizeCosts", () => {
  const jobs = [
    { id: "saint", endpoint: "tripo3d/h3.1/image-to-3d", state: "downloaded", submitted_at: T(5), input: { texture: true, texture_quality: "detailed", geometry_quality: "detailed" } },
    { id: "fern", endpoint: "fal-ai/trellis", state: "downloaded", submitted_at: T(20), input: {} },
    { id: "mystery", endpoint: "fal-ai/unknown", state: "downloaded", submitted_at: T(21), input: {} },
    { id: "lamp", endpoint: "tripo3d/h3.1/image-to-3d", state: "submitted", submitted_at: T(50), input: { texture: true } },
  ];
  const rounds = [
    { index: 1, at: T(10), verdict: { total: 4.85 } },
    { index: 2, at: T(30), verdict: { total: 5.75 } },
  ];

  test("totals every kind, keeps the unpriced visible, and attributes jobs and images to the round they preceded", () => {
    const s = summarizeCosts({
      jobs,
      imageTimestamps: [ms(1), ms(2), ms(15), ms(45)],
      tokenUsage: { input_tokens: 1_000_000, cached_input_tokens: 500_000, output_tokens: 10_000, reasoning_output_tokens: 0 },
      model: "gpt-6-astra",
      rounds,
    });
    expect(s.fal).toMatchObject({ count: 4, usd: 0.92, unpriced: ["mystery"] });
    expect(s.images).toEqual({ count: 4, usd: 0.6 });
    // 0.5M × $10 + 0.5M × $1 + 10k × $50 = $5.5 + $0.5
    expect(s.tokens).toMatchObject({ usd: 6, priced: true, model: "gpt-6-astra" });
    expect(s.total).toBe(Math.round((0.92 + 0.6 + 6) * 100) / 100);
    expect(s.byRound).toEqual([
      { index: 1, score: 4.85, fal: { count: 1, usd: 0.6 }, images: { count: 2, usd: 0.3 } },
      { index: 2, score: 5.75, fal: { count: 2, usd: 0.02 }, images: { count: 1, usd: 0.15 } },
      { index: null, score: null, fal: { count: 1, usd: 0.3 }, images: { count: 1, usd: 0.15 } },
    ]);
    expect(s.basis).toBe(PRICES.basis);
  });

  test("an empty loop costs nothing and says so without inventing a token price", () => {
    const s = summarizeCosts({});
    expect(s.total).toBe(0);
    expect(s.tokens).toEqual({ usage: null, model: "", usd: null, priced: false });
    expect(s.byRound).toEqual([]);
  });
});

/**
 * What a take costs, before it is ordered.
 *
 * The one thing worth pinning here is the shape of the bill: on the
 * reference endpoint fal charges for the REFERENCE clip's duration as well as
 * the output's, so an 8 s take conditioned on an 8 s greybox costs twice what
 * a naive per-second reading would suggest. Getting that wrong would show up
 * as a surprise on somebody's invoice, not as a failing render.
 */

import { describe, expect, test } from "bun:test";

import { PRICED_RESOLUTIONS, PRICES, priceTake, summarizeTakeCosts } from "../skill/scripts/prices.mjs";

describe("priceTake", () => {
  test("bills the reference's duration alongside the output's", () => {
    const price = priceTake({ seconds: 8, refSeconds: 8, resolution: "480p" });
    expect(price.billedSeconds).toBe(16);
    expect(price.usd).toBeCloseTo(16 * 0.1323, 6);
    expect(price.basis).toBe("(8 s out + 8 s ref) x $0.1323/s at 480p");
    expect(price.estimate).toBe(true);
    expect(priceTake({ seconds: 8, refSeconds: 8, resolution: "720p" }).usd).toBeCloseTo(16 * 0.2838, 6);
  });

  test("no reference moves the job to the dearer row and says so", () => {
    const price = priceTake({ seconds: 5, resolution: "480p" });
    expect(price.billedSeconds).toBe(5);
    expect(price.perSecond).toBe(PRICES.seedance.withoutReference["480p"]);
    expect(price.basis).toBe("5 s out x $0.2205/s at 480p");
  });

  test("a resolution with no list price is refused rather than guessed", () => {
    expect(PRICED_RESOLUTIONS).toEqual(["480p", "720p"]);
    expect(() => priceTake({ seconds: 8, refSeconds: 8, resolution: "1080p" })).toThrow(
      /no list price for resolution "1080p" \(priced: 480p, 720p\)/,
    );
    expect(() => priceTake({ seconds: 0, resolution: "480p" })).toThrow(/positive number/);
    expect(() => priceTake({ seconds: 8, refSeconds: -1, resolution: "480p" })).toThrow(/zero or more/);
  });

  test("fractional durations survive into the basis string readably", () => {
    expect(priceTake({ seconds: 7.5, refSeconds: 7.9167, resolution: "480p" }).basis).toBe(
      "(7.5 s out + 7.917 s ref) x $0.1323/s at 480p",
    );
  });
});

describe("summarizeTakeCosts", () => {
  test("totals every take, counts a failed one, and keeps an unpriced one visible", () => {
    const summary = summarizeTakeCosts([
      { id: "take-01", status: "done", cost: { usd: 2.1168, basis: "(8 s out + 8 s ref) x $0.1323/s at 480p" } },
      // A job whose request left this machine was paid for whether or not a
      // clip came back.
      { id: "take-02", status: "failed", cost: { usd: 4.5408, basis: "(8 s out + 8 s ref) x $0.2838/s at 720p" } },
      { id: "take-03", status: "submitted", cost: null },
    ]);
    expect(summary.count).toBe(3);
    expect(summary.total).toBeCloseTo(2.1168 + 4.5408, 6);
    expect(summary.unpriced).toEqual(["take-03"]);
    expect(summary.estimate).toBe(true);
    expect(summary.basis).toBe(PRICES.basis);
  });

  test("a shot with no takes costs nothing and invents no price", () => {
    expect(summarizeTakeCosts([])).toMatchObject({ count: 0, total: 0, unpriced: [], takes: [] });
  });
});

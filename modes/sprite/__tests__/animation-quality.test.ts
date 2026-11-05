import { expect, test } from "bun:test";
import { cleanAlphaHaze } from "../skill/scripts/alpha-clean.mjs";
import { diagnoseAnimation } from "../skill/scripts/animation-diagnostics.mjs";

function image(alphas: number[], width = alphas.length) {
  return { width, height: alphas.length / width, data: Uint8Array.from(alphas.flatMap((a, i) => [17 + i, 31, 93, a])) };
}

test("cleanup preserves original diagonal edge and stronger support byte for byte, without growing the band", () => {
  const source = image([8, 8, 8, 8, 8, 8, 254, 8, 8, 8, 8, 8, 8, 8, 8], 5);
  const before = source.data.slice();
  const result = cleanAlphaHaze(source, { maxAlpha: 15, keepEdge: 1 });
  expect(source.data).toEqual(before);
  expect(result.report.removedPixels).toBe(6);
  for (const i of [0, 1, 2, 5, 6, 7, 10, 11, 12]) expect(result.image.data.slice(i * 4, i * 4 + 4)).toEqual(before.slice(i * 4, i * 4 + 4));
  expect(result.image.data.slice(12, 20)).toEqual(new Uint8Array(8));
  expect(cleanAlphaHaze(result.image, { maxAlpha: 15, keepEdge: 1 }).image).toEqual(result.image);
});

test("wholly faint effects are skipped and thresholds are bounded", () => {
  const source = image([0, 3, 15]);
  expect(cleanAlphaHaze(source, { maxAlpha: 15, keepEdge: 2 }).image).toEqual(source);
  expect(cleanAlphaHaze(source, { maxAlpha: 15, keepEdge: 2 }).report.skipped).toBe("no-stronger-support");
  for (const maxAlpha of [-1, 255, 1.5, NaN]) expect(() => cleanAlphaHaze(source, { maxAlpha, keepEdge: 2 })).toThrow();
  expect(() => cleanAlphaHaze(source, { maxAlpha: 15, keepEdge: 65 })).toThrow();
});

test("held drawings retain exact GIF delays and are measurements, never a failure", () => {
  const a = image([255]); const b = image([127]);
  const report = diagnoseAnimation([a, a, b, b, a], { durationsMs: [20, 90, 150, 40, 70], timingSource: "gif-delays", loop: true });
  expect(report.drawingCount).toBe(3);
  expect(report.frameCount).toBe(5);
  expect(report.timing.totalMs).toBe(370);
  expect(report.holds.map((h) => h.durationMs)).toEqual([110, 190]);
  expect(report.heldMs).toBe(300);
  expect(report.heldFrameCount).toBe(4);
  expect(report.adjacentDistinctDrawings).toBe(2);
  expect(report.holds[0]?.certainty).toBe("measured");
  expect(report.artisticQuality).toBe("unknown");
});

test("unknown timing stays unknown; alpha variation is not proof of a temporal artifact", () => {
  const report = diagnoseAnimation([image([0]), image([255]), image([0])]);
  expect(report.timing.source).toBe("unknown");
  expect(report.timing.totalMs).toBeNull();
  expect(report.alphaMass).toEqual([0, 1, 0]);
  expect(report.interpretation.applicability).toBe("unknown");
  expect(() => diagnoseAnimation([image([0])], { durationsMs: [0], timingSource: "gif-delays" })).toThrow();
});

test("zero-radius, inclusive ceiling and existing transparent RGB preserve exactly the declared pixel set", () => {
  const source = image([0, 15, 16, 254]);
  const { image: cleaned, report } = cleanAlphaHaze(source, { maxAlpha: 15, keepEdge: 0 });
  expect(cleaned.data.slice(0, 4)).toEqual(source.data.slice(0, 4));
  expect(cleaned.data.slice(4, 8)).toEqual(new Uint8Array(4));
  expect(cleaned.data.slice(8)).toEqual(source.data.slice(8));
  expect(report.bounds).toEqual({ x: 1, y: 0, width: 1, height: 1 });
  expect(cleanAlphaHaze(source, { maxAlpha: 254, keepEdge: 64 }).report.skipped).toBe("no-stronger-support");
});

test("edge protection is clipped correctly on small canvases and never propagates through faint chains", () => {
  const source = image([254, 8, 8, 8, 8]);
  expect([...cleanAlphaHaze(source, { maxAlpha: 15, keepEdge: 2 }).image.data].filter((_, i) => i % 4 === 3)).toEqual([254, 8, 8, 0, 0]);
  expect(cleanAlphaHaze(source, { maxAlpha: 15, keepEdge: 64 }).image).toEqual(source);
});

test("a sparse flash is a suspected change spike with measured alpha changes, never a proven ghost", () => {
  const empty = image([0]); const flash = image([255]);
  const report = diagnoseAnimation([empty, empty, empty, flash, flash, flash]);
  expect(report.changeSpikes.map(({ from, to, certainty }) => ({ from, to, certainty }))).toEqual([{ from: 2, to: 3, certainty: "suspected" }]);
  expect(report.alphaChanges.map(({ delta }) => delta)).toEqual([0, 0, 1, 0, 0]);
  expect(report.interpretation.reason).toContain("may be intentional");
  expect(report.artisticQuality).toBe("unknown");
});

test("diagnostics compare rendered premultiplied colour rather than hidden or faint straight RGB", () => {
  const red = (alpha: number) => ({ width: 1, height: 1, data: Uint8Array.from([255, 0, 0, alpha]) });
  const blue = (alpha: number) => ({ width: 1, height: 1, data: Uint8Array.from([0, 0, 255, alpha]) });
  expect(diagnoseAnimation([red(0), blue(0)]).steps[0]).toBe(0);
  expect(diagnoseAnimation([red(1), blue(1)]).steps[0]).toBeLessThan(1 / 255);
  expect(diagnoseAnimation([red(1), blue(1)]).drawingCount).toBe(1);
  expect(diagnoseAnimation([red(255), blue(255)]).steps[0]).toBeCloseTo(0.5, 6);
  expect(diagnoseAnimation([red(255), blue(255)]).drawingCount).toBe(2);
});

test("GIF fallback estimates never become measured hold timing", () => {
  const frame = image([255]);
  const report = diagnoseAnimation([frame, frame], { durationsMs: [90, 90], timingSource: "gif-delays-with-reported-fallback" });
  expect(report.timing.source).toBe("unknown");
  expect(report.timing.totalMs).toBeNull();
  expect(report.heldMs).toBeNull();
  expect(report.holds[0]?.durationMs).toBeNull();
});

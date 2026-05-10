import { describe, expect, test } from "bun:test";
import { computePreviewSegments } from "./PreviewFrameStrip.js";
import type { Clip, PreviewFrame } from "@pneuma-craft/timeline";

const clip = (id: string, start: number, dur: number): Clip => ({
  id, trackId: "t1", assetId: "a-" + id,
  startTime: start, duration: dur,
  inPoint: 0, outPoint: dur,
});

const pf = (id: string, time: number): PreviewFrame => ({
  id, trackId: "t1", time, assetId: "a-" + id,
});

describe("computePreviewSegments", () => {
  test("empty inputs → no segments", () => {
    expect(computePreviewSegments([], [], 10)).toEqual([]);
  });

  test("single preview, no clips, duration 10 → segment [0|2 → 10]", () => {
    expect(computePreviewSegments([pf("p1", 2)], [], 10)).toEqual([
      { previewFrameId: "p1", startTime: 2, endTime: 10 },
    ]);
  });

  test("two previews, no clips → adjacent segments", () => {
    expect(computePreviewSegments([pf("p1", 0), pf("p2", 4)], [], 10)).toEqual([
      { previewFrameId: "p1", startTime: 0, endTime: 4 },
      { previewFrameId: "p2", startTime: 4, endTime: 10 },
    ]);
  });

  test("preview hidden under clip is not emitted", () => {
    const previews = [pf("p1", 0), pf("p2", 4), pf("p3", 8)];
    const clips = [clip("c1", 4, 4)];   // covers [4, 8)
    expect(computePreviewSegments(previews, clips, 10)).toEqual([
      { previewFrameId: "p1", startTime: 0, endTime: 4 },
      // p2 fully covered by clip
      { previewFrameId: "p3", startTime: 8, endTime: 10 },
    ]);
  });

  test("preview spanning a clip → emits before-clip and after-clip segments", () => {
    const previews = [pf("p1", 2)];
    const clips = [clip("c1", 4, 4)];   // covers [4, 8)
    // p1 displays [2, 4) before clip, hides during clip, then RESUMES
    // [8, 10) until duration cap (matches upstream's "greatest pf.time ≤ T").
    expect(computePreviewSegments(previews, clips, 10)).toEqual([
      { previewFrameId: "p1", startTime: 2, endTime: 4 },
      { previewFrameId: "p1", startTime: 8, endTime: 10 },
    ]);
  });

  test("preview at exactly clip start → hidden during clip, resumes after", () => {
    const previews = [pf("p1", 4)];
    const clips = [clip("c1", 4, 4)];   // covers [4, 8)
    // Half-open: clip wins at t=4 (preview hidden during [4, 8)). After
    // the clip ends, preview resumes [8, 10) per upstream's "greatest
    // pf.time ≤ T" rule.
    expect(computePreviewSegments(previews, clips, 10)).toEqual([
      { previewFrameId: "p1", startTime: 8, endTime: 10 },
    ]);
  });
});

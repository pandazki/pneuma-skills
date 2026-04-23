import { describe, test, expect } from "bun:test";
import type { Clip } from "@pneuma-craft/timeline";
import { computeRipplePreview, snapDraggedStart } from "../dragEngine.js";

function makeClip(id: string, startTime: number, duration: number): Clip {
  return {
    id,
    trackId: "t1",
    assetId: `asset-${id}`,
    startTime,
    duration,
    inPoint: 0,
    outPoint: duration,
  } as Clip;
}

describe("computeRipplePreview", () => {
  test("pins the dragged clip at the requested position", () => {
    const clips = [makeClip("a", 0, 2), makeClip("b", 5, 2)];
    const p = computeRipplePreview(clips, "a", 1);
    expect(p.get("a")).toBe(1);
  });

  test("pushes an overlapped neighbor forward by the dragged clip's tail", () => {
    const clips = [makeClip("a", 0, 2), makeClip("b", 1, 2)];
    const p = computeRipplePreview(clips, "a", 0);
    // b originally at 1 overlaps dragged end (0+2=2), so push b to 2
    expect(p.get("b")).toBe(2);
  });

  test("does not move non-overlapping neighbors", () => {
    const clips = [makeClip("a", 0, 2), makeClip("b", 5, 2)];
    const p = computeRipplePreview(clips, "a", 0);
    expect(p.get("b")).toBe(5);
  });

  test("ripples through a chain when multiple overlaps occur", () => {
    const clips = [makeClip("a", 0, 2), makeClip("b", 1, 2), makeClip("c", 2, 2)];
    const p = computeRipplePreview(clips, "a", 0);
    expect(p.get("a")).toBe(0);
    expect(p.get("b")).toBe(2);
    expect(p.get("c")).toBe(4);
  });

  test("returns empty map when draggedClipId is unknown", () => {
    const clips = [makeClip("a", 0, 2)];
    const p = computeRipplePreview(clips, "missing", 5);
    expect(p.size).toBe(0);
  });
});

describe("snapDraggedStart", () => {
  const clips = [makeClip("a", 0, 2), makeClip("b", 5, 3)];

  test("snaps to neighbor start when within threshold", () => {
    const r = snapDraggedStart(clips, "a", 4.9, 0.2);
    expect(r.start).toBe(5);
    expect(r.snapTime).toBe(5);
  });

  test("snaps dragged end to neighbor start (subtracting duration)", () => {
    // dragged duration 2, want newEnd ≈ 5 → newStart ≈ 3
    const r = snapDraggedStart(clips, "a", 3.05, 0.2);
    expect(r.start).toBe(3);
    expect(r.snapTime).toBe(5);
  });

  test("snaps to zero", () => {
    const r = snapDraggedStart(clips, "a", 0.05, 0.2);
    expect(r.start).toBe(0);
    expect(r.snapTime).toBe(0);
  });

  test("returns candidate unchanged when nothing is in range", () => {
    const r = snapDraggedStart(clips, "a", 12, 0.2);
    expect(r.start).toBe(12);
    expect(r.snapTime).toBe(null);
  });

  test("clamps negative drag to zero without reporting a snap", () => {
    const r = snapDraggedStart(clips, "a", -1, 0.01);
    expect(r.start).toBe(0);
  });
});

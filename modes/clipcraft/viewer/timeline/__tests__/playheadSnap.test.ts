import { describe, test, expect } from "bun:test";
import type { Clip, Composition, Track } from "@pneuma-craft/timeline";
import { PLAYHEAD_SNAP_PX, snapPlayheadTime } from "../playheadSnap.js";

function makeClip(id: string, trackId: string, startTime: number, duration: number): Clip {
  return {
    id,
    trackId,
    assetId: `asset-${id}`,
    startTime,
    duration,
    inPoint: 0,
    outPoint: duration,
  } as Clip;
}

function makeTrack(id: string, type: Track["type"], clips: Clip[]): Track {
  return { id, type, name: id, clips, previewFrames: [] } as unknown as Track;
}

/**
 * Mirrors the seed project in issue #98: three video clips anchored at
 * 0 / 4 / 12 / 19, plus a subtitle on a second track so the cross-track
 * requirement is actually exercised.
 */
const composition = {
  id: "c1",
  duration: 19,
  tracks: [
    makeTrack("video", "video", [
      makeClip("v1", "video", 0, 4),
      makeClip("v2", "video", 4, 8),
      makeClip("v3", "video", 12, 7),
    ]),
    makeTrack("subs", "subtitle", [makeClip("s1", "subs", 6.5, 1)]),
  ],
} as unknown as Composition;

// 100 px/s → the 5px radius is 0.05s of timeline.
const PPS = 100;
const RADIUS = PLAYHEAD_SNAP_PX / PPS;

describe("snapPlayheadTime", () => {
  test("snaps onto a clip boundary within the radius", () => {
    const r = snapPlayheadTime(composition, 4 - RADIUS / 2, PPS, true);
    expect(r.time).toBe(4);
    expect(r.snappedTo).toBe(4);
  });

  test("snaps onto a boundary on a different track than the nearest clip", () => {
    const r = snapPlayheadTime(composition, 6.52, PPS, true);
    expect(r.time).toBe(6.5);
    expect(r.snappedTo).toBe(6.5);
  });

  test("snaps to t=0", () => {
    const r = snapPlayheadTime(composition, 0.02, PPS, true);
    expect(r.time).toBe(0);
    expect(r.snappedTo).toBe(0);
  });

  test("leaves a time with no boundary in range untouched", () => {
    // 0:06 mid-gap — the case from the issue's screenshot.
    const r = snapPlayheadTime(composition, 6, PPS, true);
    expect(r.time).toBe(6);
    expect(r.snappedTo).toBe(null);
  });

  test("never snaps to where the playhead already is", () => {
    // A lone t=0 composition: 8.31 has nothing near it, so a result of
    // 8.31 must come from "no snap", never from a playhead self-point.
    const empty = { id: "c0", duration: 20, tracks: [] } as unknown as Composition;
    const r = snapPlayheadTime(empty, 8.31, PPS, true);
    expect(r.snappedTo).toBe(null);
  });

  test("Shift bypass returns the exact frame the user asked for", () => {
    const r = snapPlayheadTime(composition, 4 - RADIUS / 2, PPS, false);
    expect(r.time).toBe(4 - RADIUS / 2);
    expect(r.snappedTo).toBe(null);
  });

  test("radius follows zoom — the same time snaps zoomed out, not zoomed in", () => {
    const off = 4.04;
    expect(snapPlayheadTime(composition, off, 10, true).snappedTo).toBe(4);
    expect(snapPlayheadTime(composition, off, 400, true).snappedTo).toBe(null);
  });

  test("degenerate zoom is a no-op rather than a divide-by-zero", () => {
    const r = snapPlayheadTime(composition, 4.01, 0, true);
    expect(r.time).toBe(4.01);
    expect(r.snappedTo).toBe(null);
  });

  test("a null composition still snaps to t=0 and nothing else", () => {
    expect(snapPlayheadTime(null, 0.02, PPS, true).snappedTo).toBe(0);
    expect(snapPlayheadTime(null, 4.01, PPS, true).snappedTo).toBe(null);
  });
});

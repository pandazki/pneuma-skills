/**
 * The pre-mixed track's layout arithmetic (T10-5) — the one place that
 * knows how canonical seconds become track seconds, pinned here because
 * three consumers depend on it agreeing with itself: the `narrate` action
 * (which hands the mixer a plan), the mixer (which places PCM by sample
 * index), and the viewer's load-time verifier (which recomputes the layout
 * from the LIVE compile and refuses a track that disagrees).
 */

import { describe, expect, test } from "bun:test";

import type { ClipWindow } from "../narration/timing.js";
import {
  TRACK_ALIGN_TOLERANCE,
  canonicalToTrack,
  clipAtTrackTime,
  layOutTrack,
  readTrackManifest,
  verifyTrack,
} from "../narration/track.js";

const ref = (step: number) => ({ section: 0, step });

function w(
  hash: string,
  start: number,
  audioSeconds: number,
  holdAt: number | null = null,
): ClipWindow {
  return {
    ref: ref(1),
    hash,
    start,
    audioSeconds,
    audioEnd: start + audioSeconds,
    holdAt,
  };
}

const SR = 48000;

describe("layOutTrack", () => {
  test("an unheld lecture lays every clip at its canonical second", () => {
    const layout = layOutTrack([w("a", 1, 2), w("b", 10, 3)], 20, SR);
    expect(layout.sampleRate).toBe(SR);
    expect(layout.clips.map((c) => c.offset)).toEqual([1 * SR, 10 * SR]);
    expect(layout.clips.map((c) => c.samples)).toEqual([2 * SR, 3 * SR]);
    expect(layout.clips.map((c) => c.start)).toEqual([1, 10]);
    // No hold anywhere: the track is exactly the board's own duration.
    expect(layout.samples).toBe(20 * SR);
  });

  test("a hold pushes every later clip by the tail it plays over the pin", () => {
    // "a" starts at 1 s and is voiced 6 s, but the next pen-down comes at
    // 4 s: the board pins at 4 while 3 s of voice finish, so wall time
    // runs 3 s ahead of canonical time from there on.
    const layout = layOutTrack([w("a", 1, 6, 4), w("b", 10, 3)], 20, SR);
    expect(layout.clips[0]!.offset).toBe(1 * SR);
    expect(layout.clips[1]!.offset).toBe(13 * SR); // 10 + 3
    expect(layout.samples).toBe(23 * SR); // 20 + 3
  });

  test("holds accumulate, and clips never overlap in the track", () => {
    const layout = layOutTrack(
      [w("a", 1, 6, 4), w("b", 10, 5, 12), w("c", 20, 1)],
      30,
      SR,
    );
    // a: +3 · b lands at 10 + 3 = 13, holds 15 − 12 = 3 → +6 total
    expect(layout.clips.map((c) => c.offset / SR)).toEqual([1, 13, 26]);
    for (let i = 1; i < layout.clips.length; i++) {
      const prev = layout.clips[i - 1]!;
      expect(layout.clips[i]!.offset).toBeGreaterThanOrEqual(
        prev.offset + prev.samples,
      );
    }
  });

  test("a final clip's tail past the board's end still fits in the track", () => {
    // Nothing follows, so `holdAt` is null — but the gate pins at the
    // board's duration all the same, and the tail has to be IN the file.
    const layout = layOutTrack([w("a", 18, 6)], 20, SR);
    expect(layout.samples).toBe(24 * SR);
  });

  test("windows are laid in start order whatever order they arrive in", () => {
    const layout = layOutTrack([w("b", 10, 3), w("a", 1, 2)], 20, SR);
    expect(layout.clips.map((c) => c.hash)).toEqual(["a", "b"]);
  });

  test("no clips is an empty track, not a crash", () => {
    expect(layOutTrack([], 20, SR).clips).toEqual([]);
    expect(layOutTrack([], 20, SR).samples).toBe(20 * SR);
  });
});

describe("canonicalToTrack / clipAtTrackTime", () => {
  const layout = layOutTrack([w("a", 1, 6, 4), w("b", 10, 3)], 20, SR);

  test("silence maps by the accumulated hold offset", () => {
    expect(canonicalToTrack(layout, 0)).toBeCloseTo(0, 9);
    expect(canonicalToTrack(layout, 8)).toBeCloseTo(11, 9); // past a's hold
    expect(canonicalToTrack(layout, 18)).toBeCloseTo(21, 9);
  });

  test("inside a clip the map follows that clip's own placement", () => {
    expect(canonicalToTrack(layout, 1)).toBeCloseTo(1, 9);
    expect(canonicalToTrack(layout, 3)).toBeCloseTo(3, 9);
    // The pin: canonical 4 is the LAST canonical instant the clip owns.
    expect(canonicalToTrack(layout, 4)).toBeCloseTo(4, 9);
    expect(canonicalToTrack(layout, 11)).toBeCloseTo(14, 9);
  });

  test("the handover at the end of a hold is continuous", () => {
    // Where the clip's tail stops is exactly where silence resumes: the
    // two branches of the map must meet, or the board jumps at every hold.
    const clip = layout.clips[0]!;
    const trackEnd = (clip.offset + clip.samples) / SR;
    expect(canonicalToTrack(layout, 4 + 1e-9)).toBeCloseTo(trackEnd, 6);
  });

  test("the sounding clip is decided by the track position", () => {
    expect(clipAtTrackTime(layout, 0)?.hash).toBeUndefined();
    expect(clipAtTrackTime(layout, 1)?.hash).toBe("a");
    expect(clipAtTrackTime(layout, 6.5)?.hash).toBe("a"); // over the pin
    expect(clipAtTrackTime(layout, 7.5)?.hash).toBeUndefined();
    expect(clipAtTrackTime(layout, 12)?.hash).toBeUndefined(); // still silence
    expect(clipAtTrackTime(layout, 13.5)?.hash).toBe("b");
    expect(clipAtTrackTime(layout, 99)?.hash).toBeUndefined();
  });

  test("a non-finite time owns nothing and maps to nothing", () => {
    expect(clipAtTrackTime(layout, Number.NaN)).toBeNull();
    expect(canonicalToTrack(layout, Number.NaN)).toBe(0);
  });
});

describe("readTrackManifest", () => {
  const good = JSON.stringify({
    file: "narration/track.mp3",
    sampleRate: SR,
    samples: 20 * SR,
    clips: [{ hash: "a", offset: SR, samples: 2 * SR, start: 1, holdAt: null }],
  });

  test("absent is the documented no-track state, not a problem", () => {
    expect(readTrackManifest(undefined)).toEqual({ manifest: null, issue: null });
    expect(readTrackManifest("  ")).toEqual({ manifest: null, issue: null });
  });

  test("a good manifest reads back verbatim", () => {
    const read = readTrackManifest(good);
    expect(read.issue).toBeNull();
    expect(read.manifest?.file).toBe("narration/track.mp3");
    expect(read.manifest?.clips).toHaveLength(1);
  });

  test("malformed never hides behind the no-track silence", () => {
    expect(readTrackManifest("{").issue).toContain("not valid JSON");
    expect(readTrackManifest("[]").issue).toContain("must be a JSON object");
    expect(readTrackManifest('{"file":"x"}').issue).toContain("sampleRate");
    expect(
      readTrackManifest(
        JSON.stringify({ file: "x", sampleRate: SR, samples: SR }),
      ).issue,
    ).toContain("clips");
    // One bad entry poisons the WHOLE track — unlike the per-clip
    // manifest, a track's positions are only meaningful as a sequence.
    const holed = JSON.stringify({
      file: "narration/track.mp3",
      sampleRate: SR,
      samples: SR,
      clips: [{ hash: "a", offset: -1, samples: SR, start: 0, holdAt: null }],
    });
    expect(readTrackManifest(holed).manifest).toBeNull();
    expect(readTrackManifest(holed).issue).toContain("clip");
  });
});

describe("verifyTrack", () => {
  const windows = [w("a", 1, 6, 4), w("b", 10, 3)];
  const live = layOutTrack(windows, 20, SR);
  const manifest = {
    file: "narration/track.mp3",
    sampleRate: live.sampleRate,
    samples: live.samples,
    clips: live.clips,
  };

  test("the track the live board still agrees with is used", () => {
    expect(verifyTrack(manifest, live)).toEqual({ ok: true, reason: null });
  });

  test("a changed hash sequence is stale, not a near miss", () => {
    const edited = layOutTrack([w("a", 1, 6, 4), w("c", 10, 3)], 20, SR);
    const verdict = verifyTrack(manifest, edited);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("c");
  });

  test("an added step is stale even though every old clip still fits", () => {
    const grown = layOutTrack([...windows, w("c", 21, 2)], 25, SR);
    expect(verifyTrack(manifest, grown).ok).toBe(false);
    expect(verifyTrack(manifest, grown).reason).toContain("clip");
  });

  test("a moved clip past the tolerance is stale", () => {
    const moved = layOutTrack([w("a", 1, 6, 4), w("b", 10.5, 3)], 20, SR);
    expect(verifyTrack(manifest, moved).ok).toBe(false);
    expect(verifyTrack(manifest, moved).reason).toContain("b");
  });

  test("float-noise disagreement is not staleness", () => {
    const nudged = {
      ...manifest,
      clips: manifest.clips.map((c) => ({ ...c, offset: c.offset + 3 })),
    };
    expect(verifyTrack(nudged, live).ok).toBe(true);
    // …but a shift the ear could hear is.
    const shifted = {
      ...manifest,
      clips: manifest.clips.map((c) => ({
        ...c,
        offset: c.offset + Math.ceil(TRACK_ALIGN_TOLERANCE * SR) + 1,
      })),
    };
    expect(verifyTrack(shifted, live).ok).toBe(false);
  });

  test("a different sample rate is stale (the track is a different file)", () => {
    expect(verifyTrack({ ...manifest, sampleRate: 44100 }, live).ok).toBe(false);
  });

  test("a track with no clips against a board with none is fine", () => {
    const empty = layOutTrack([], 20, SR);
    expect(
      verifyTrack(
        { file: "narration/track.mp3", sampleRate: SR, samples: empty.samples, clips: [] },
        empty,
      ).ok,
    ).toBe(true);
  });
});

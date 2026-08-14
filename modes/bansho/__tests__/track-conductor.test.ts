/**
 * The track conductor (T10-5) — the element-side half of the pre-mixed
 * track. The defect it exists to remove is measurable in exactly one
 * observable: how many times `src` is assigned and how many times
 * `currentTime` is written while a voice is sounding. Both must be zero
 * after the program is installed, and the tests below say so in those
 * words.
 */

import { describe, expect, test } from "bun:test";

import { gatedTick } from "../viewer/clock-gate.js";
import { createPlayer, type PlayerState } from "../viewer/player-core.js";
import { layOutTrack } from "../narration/track.js";
import type { ClipWindow } from "../narration/timing.js";
import { TrackConductor } from "../viewer/track-conductor.js";
import { FakeAudioElement, FakeGestureTarget, settle } from "./fake-audio.js";

const SR = 48000;

function w(
  hash: string,
  start: number,
  audioSeconds: number,
  holdAt: number | null = null,
): ClipWindow {
  return {
    ref: { section: 0, step: 1 },
    hash,
    start,
    audioSeconds,
    audioEnd: start + audioSeconds,
    holdAt,
  };
}

function harness(
  windows: readonly ClipWindow[] = [w("a", 1, 2), w("b", 10, 3)],
  duration = 20,
) {
  const el = new FakeAudioElement();
  const gestures = new FakeGestureTarget();
  const conductor = new TrackConductor({
    resolveUrl: (path) => `/api/file?path=${path}`,
    createElement: () => el,
    gestureTarget: gestures,
  });
  const layout = layOutTrack(windows, duration, SR);
  conductor.setProgram(layout, windows, "set/narration/track.mp3");
  return { el, gestures, conductor, layout, windows, duration };
}

describe("the src is set once and never again", () => {
  test("installing the program loads the track and arms preload", () => {
    const { el } = harness();
    expect(el.src).toBe("/api/file?path=set/narration/track.mp3");
    expect(el.preload).toBe("auto");
  });

  test("a recompile at the same path leaves the element untouched", () => {
    const { el, conductor, layout, windows } = harness();
    el.src = "SENTINEL";
    conductor.setProgram(layout, windows, "set/narration/track.mp3");
    expect(el.src).toBe("SENTINEL");
  });

  test("playing the whole lecture never re-assigns src", () => {
    const { el, conductor } = harness();
    const before = el.src;
    for (let i = 0; i < 400; i++) {
      conductor.frame(i * 0.05, 1, 0.05);
      el.advance(0.05);
    }
    expect(el.src).toBe(before);
  });
});

describe("no seek ever lands under a voice", () => {
  test("the element is not seeked while a clip is sounding", () => {
    const { el, conductor } = harness();
    conductor.frame(0, 1, 0);
    el.seeks.length = 0;
    // Walk the playhead straight through clip "a" (track 1.0 – 3.0 s).
    for (let t = 0.9; t < 3.2; t += 0.05) {
      el.moveTo(t);
      conductor.frame(t, 1, 0.05);
    }
    expect(el.seeks).toEqual([]);
  });

  test("a clip's first sound is asked for from an element already playing", () => {
    // The whole defect: on the per-clip path the element was re-src'd and
    // play()ed at the clip boundary. Here play() happens once, at t≈0.
    const { el, conductor } = harness();
    conductor.frame(0, 1, 0.016);
    const startsBefore = el.playCalls;
    for (let t = 0; t < 12; t += 0.1) {
      el.moveTo(t);
      conductor.frame(t, 1, 0.1);
    }
    expect(el.playCalls).toBe(startsBefore);
    expect(el.paused).toBe(false);
  });

  test("the element keeps running through the silence between clips", () => {
    const { el, conductor } = harness();
    conductor.frame(0, 1, 0.016);
    el.moveTo(5); // squarely between clip a (1–3) and clip b (10–13)
    conductor.frame(5, 1, 0.016);
    expect(el.paused).toBe(false);
    expect(el.pauseCalls).toBe(0);
  });
});

describe("the snapshot the gate projects", () => {
  test("inside a clip the time reported is clip-relative", () => {
    const { el, conductor } = harness();
    el.moveTo(2.5); // 1.5 s into clip "a", which starts at track 1.0
    const { window, audio } = conductor.frame(2.5, 1, 0.016);
    expect(window?.hash).toBe("a");
    expect(audio?.time).toBeCloseTo(1.5, 9);
    expect(audio?.sounding).toBe(true);
  });

  test("silence reports no window at all — rAF is master there", () => {
    const { el, conductor } = harness();
    el.moveTo(6);
    expect(conductor.frame(6, 1, 0.016)).toEqual({ window: null, audio: null });
  });

  test("the gate projects the canonical playhead from that snapshot", () => {
    const { el, conductor } = harness();
    let s: PlayerState = { ...createPlayer(20, false), playing: true, t: 1.2 };
    el.moveTo(1.4); // 0.4 s into a clip whose canonical start is 1.0
    const { window, audio } = conductor.frame(s.t, 1, 0.016);
    s = gatedTick(s, 0.016, window, audio);
    expect(s.t).toBeCloseTo(1.4, 9);
  });

  test("a held clip pins the picture, then rAF resumes where it left off", () => {
    // "a" is voiced 6 s from canonical 1, but the next pen-down is at 4:
    // the board must sit at 4 until the voice runs out at track 7.
    const windows = [w("a", 1, 6, 4)];
    const { el, conductor } = harness(windows, 20);
    let s: PlayerState = { ...createPlayer(20, false), playing: true, t: 3.9 };
    for (let tt = 3.9; tt < 7; tt += 0.1) {
      el.moveTo(tt);
      const { window, audio } = conductor.frame(s.t, 1, 0.1);
      s = gatedTick(s, 0.1, window, audio);
    }
    expect(s.t).toBeCloseTo(4, 6); // pinned at the pen-down
    // Past the clip's last sample the track is silent again and rAF runs.
    el.moveTo(7.2);
    const after = conductor.frame(s.t, 1, 0.1);
    expect(after.window).toBeNull();
    s = gatedTick(s, 0.1, after.window, after.audio);
    expect(s.t).toBeCloseTo(4.1, 6);
  });
});

describe("drift is repaired only where it is free", () => {
  test("a drifted element in open silence is realigned", () => {
    const { el, conductor, layout } = harness([w("a", 1, 2)], 60);
    conductor.frame(0, 1, 0.016);
    el.seeks.length = 0;
    el.moveTo(20); // the tab was backgrounded; rAF fell behind
    conductor.frame(30, 1, 0.016);
    expect(el.seeks).toHaveLength(1);
    expect(el.seeks[0]).toBeCloseTo(30, 6);
    void layout;
  });

  test("small drift is left to the gate, not seeked away", () => {
    const { el, conductor } = harness([w("a", 1, 2)], 60);
    conductor.frame(0, 1, 0.016);
    el.seeks.length = 0;
    el.moveTo(30.02);
    conductor.frame(30, 1, 0.016);
    expect(el.seeks).toEqual([]);
  });

  test("drift is NOT repaired just before a clip — that seek would eat the word", () => {
    const { el, conductor } = harness([w("a", 30, 2)], 60);
    conductor.frame(0, 1, 0.016);
    el.seeks.length = 0;
    el.moveTo(29.5); // silence, but the clip starts at track 30.0
    conductor.frame(29.0, 1, 0.016);
    expect(el.seeks).toEqual([]);
  });
});

describe("navigation and transport", () => {
  test("a scrub maps canonical time into the track", () => {
    const { el, conductor } = harness([w("a", 1, 6, 4), w("b", 10, 3)], 20);
    el.seeks.length = 0;
    conductor.seek(11, true); // clip b: canonical 10 sits at track 13
    expect(el.seeks.at(-1)).toBeCloseTo(14, 9);
    expect(el.paused).toBe(false);
  });

  test("a paused scrub aligns silently", () => {
    const { el, conductor } = harness();
    conductor.seek(2, false);
    expect(el.paused).toBe(true);
    expect(el.seeks.at(-1)).toBeCloseTo(2, 9);
  });

  test("a plain resume continues from the element's own clock", () => {
    const { el, conductor } = harness();
    conductor.frame(1.5, 1, 0.016);
    el.moveTo(2.4);
    conductor.pause();
    el.seeks.length = 0;
    conductor.resume(1.5);
    expect(el.seeks).toEqual([]);
    expect(el.paused).toBe(false);
  });

  test("above the max rate the voice steps aside instead of being stretched", () => {
    const { el, conductor } = harness();
    conductor.frame(1.5, 1, 0.016);
    const result = conductor.frame(1.5, 8, 0.016);
    expect(result).toEqual({ window: null, audio: null });
    expect(el.paused).toBe(true);
    expect(el.playbackRate).toBe(1); // never written a rate no browser honours
  });

  test("rate rides the element so both clocks scale together, inside the band", () => {
    const { el, conductor } = harness();
    conductor.frame(1.5, 1.25, 0.016);
    expect(el.playbackRate).toBe(1.25);
  });

  test("outside the band the rate is never written — the track is released", () => {
    const { el, conductor } = harness();
    conductor.frame(1.5, 1, 0.016);
    expect(el.src).not.toBe("");
    // 2× is outside the band: an unportable `playbackRate` is never asked
    // for, and the file is let go rather than left decoding for nobody.
    const out = conductor.frame(1.5, 2, 0.016);
    expect(out.window).toBeNull();
    expect(out.audio).toBeNull();
    expect(el.playbackRate).toBe(1);
    expect(el.src).toBe("");
    expect(el.srcRemovals).toBe(1);
    expect(el.loadCalls).toBe(1);
  });
});

describe("degradation is loud", () => {
  test("autoplay refusal latches blocked, and a gesture re-arms it", async () => {
    const { el, gestures, conductor } = harness();
    const seen: boolean[] = [];
    conductor.onBlocked((b) => seen.push(b));
    el.playMode = "block";
    conductor.frame(1.5, 1, 0.016);
    await settle();
    expect(conductor.isBlocked()).toBe(true);
    expect(gestures.armed()).toBeGreaterThan(0);
    el.playMode = "resolve";
    gestures.fire("pointerdown");
    await settle();
    expect(conductor.isBlocked()).toBe(false);
    expect(seen).toEqual([false, true, false]);
  });

  test("an abort (a scrub racing a pending start) is benign", async () => {
    const { el, conductor } = harness();
    const degraded: string[] = [];
    conductor.onDegraded((d) => degraded.push(d.reason));
    el.playMode = "abort";
    conductor.frame(1.5, 1, 0.016);
    await settle();
    expect(degraded).toEqual([]);
    expect(conductor.hasFailed()).toBe(false);
  });

  test("a load error fails the whole track — the host's cue to fall back", () => {
    const { el, conductor } = harness();
    const degraded: string[] = [];
    conductor.onDegraded((d) => degraded.push(d.reason));
    el.emit("error");
    expect(conductor.hasFailed()).toBe(true);
    expect(degraded).toEqual(["failed"]);
    // A failed track reports nothing rather than pretending to play.
    expect(conductor.frame(1.5, 1, 0.016)).toEqual({
      window: null,
      audio: null,
    });
  });

  test("a stalled track stops claiming to sound so the board plays on", () => {
    const { el, conductor } = harness();
    const degraded: string[] = [];
    conductor.onDegraded((d) => degraded.push(d.reason));
    el.moveTo(1.5);
    conductor.frame(1.5, 1, 0.1);
    let last = conductor.frame(1.5, 1, 0.1);
    for (let i = 0; i < 4; i++) last = conductor.frame(1.5, 1, 0.1);
    expect(last.audio?.sounding).toBe(false);
    expect(degraded).toEqual(["stalled"]);
  });

  test("no program means no element writes at all", () => {
    const el = new FakeAudioElement();
    const conductor = new TrackConductor({
      resolveUrl: (p) => p,
      createElement: () => el,
      gestureTarget: new FakeGestureTarget(),
    });
    expect(conductor.frame(1, 1, 0.016)).toEqual({ window: null, audio: null });
    expect(el.playCalls).toBe(0);
    expect(el.src).toBe("");
  });

  test("dispose stops the sound and drops the listeners", () => {
    const { el, conductor } = harness();
    conductor.frame(1.5, 1, 0.016);
    conductor.dispose();
    expect(el.paused).toBe(true);
    expect(el.listenerCount("error")).toBe(0);
  });
});

/**
 * T10-4 — the audio conductor (`viewer/audio-conductor.ts`): the one
 * DOM-facing piece of the voice layer. The clock-gate tests pin WHO owns
 * the clock; these pin how the element is DRIVEN so the gate's snapshot is
 * ever true:
 *
 *  - a clip loads on demand and is aligned to the picture before it plays
 *    (the no-jump half the gate cannot see);
 *  - content-addressed identity: a recompile that keeps the hash keeps the
 *    sounding element untouched — an agent append never restarts the voice
 *    mid-word;
 *  - every failure is a quiet, ISOLATED degradation: autoplay rejection
 *    latches `blocked` (re-armed by one page gesture), a load error mutes
 *    that one clip, an interrupted play start (AbortError) is benign;
 *  - a paused scrub never sounds a fragment; a plain resume never re-seeks
 *    (paused mid-hold the element is AHEAD of the pinned clock);
 *  - an ended clip never replays on its own — only an explicit seek
 *    re-arms it.
 *
 * Windows come from real compiles (never hand-built); the element is the
 * shared fake (fake-audio.ts), whose play() settles asynchronously like
 * the real promise.
 */

import { describe, expect, test } from "bun:test";

import { parseLecture } from "../domain.js";
import { DEFAULT_DURATIONS } from "../engine/duration.js";
import { buildTimeline } from "../engine/timeline.js";
import { flattenSteps } from "../engine/inference.js";
import { stepContentHash, stepPlainText } from "../engine/text.js";
import { clipWindows, createNarrationHook } from "../narration/timing.js";
import type { NarrationManifest } from "../narration/types.js";
import {
  AudioConductor,
  type NarrationDegradation,
} from "../viewer/audio-conductor.js";
import {
  FakeAudioElement,
  FakeGestureTarget,
  settle,
} from "./fake-audio.js";

const BOARD = `# 标题

第一句话,讲清楚一件事。

第二句话,再讲一件事。

@wait 1

结尾一句。
`;

function hashOf(lecture: ReturnType<typeof parseLecture>, text: string): string {
  const found = flattenSteps(lecture).find(({ step }) =>
    stepPlainText(step).includes(text),
  );
  if (!found) throw new Error(`no step containing "${text}"`);
  return stepContentHash(found.step, lecture.source);
}

function compile(entries: Array<[fragment: string, seconds: number]>) {
  const lecture = parseLecture(BOARD);
  const clips: NarrationManifest["clips"] = {};
  for (const [fragment, seconds] of entries) {
    const hash = hashOf(lecture, fragment);
    clips[hash] = { file: `narration/${hash}.wav`, seconds, text: fragment };
  }
  const hook = createNarrationHook(lecture.source, { clips })!;
  const timeline = buildTimeline(lecture, {
    durations: DEFAULT_DURATIONS,
    durationOverride: hook.durationOverride,
  });
  const windows = clipWindows(timeline.schedule, hook.applied);
  const files = new Map<string, string>();
  for (const w of windows) files.set(w.hash, `tech-zh/${clips[w.hash]!.file}`);
  return { lecture, timeline, windows, files };
}

function makeConductor(entries: Array<[string, number]>) {
  const compiled = compile(entries);
  const elements: FakeAudioElement[] = [];
  const gestures = new FakeGestureTarget();
  const conductor = new AudioConductor({
    resolveUrl: (path) => `/api/file?path=${path}`,
    createElement: () => {
      const el = new FakeAudioElement();
      elements.push(el);
      return el;
    },
    gestureTarget: gestures,
  });
  conductor.setProgram(compiled.windows, compiled.files);
  return { ...compiled, conductor, elements, gestures };
}

describe("AudioConductor — loading and aligning", () => {
  test("entering a voiced window loads the clip, aligns it to the picture, plays", () => {
    const { conductor, windows, files, elements } = makeConductor([
      ["第一句话", 1],
    ]);
    const w = windows[0]!;
    const { window, audio } = conductor.frame(w.start + 0.2, 1);
    expect(window?.hash).toBe(w.hash);
    const el = elements[0]!;
    expect(el.src).toBe(`/api/file?path=${files.get(w.hash)!}`);
    // Aligned BEFORE playing: audio meets the picture, never the reverse.
    expect(el.seeks[0]!).toBeCloseTo(0.2, 10);
    expect(el.playCalls).toBe(1);
    expect(audio).toEqual({
      hash: w.hash,
      time: el.currentTime,
      sounding: true,
      ended: false,
    });
  });

  test("a silent stretch reports no audio and quiets the element", () => {
    const { conductor, windows, timeline, elements } = makeConductor([
      ["第一句话", 1],
    ]);
    const w = windows[0]!;
    conductor.frame(w.start + 0.2, 1);
    const { audio } = conductor.frame(timeline.duration - 1e-4, 1);
    expect(audio).toBeNull();
    expect(elements[0]!.paused).toBe(true);
  });

  test("a recompile that keeps the hash keeps the sounding element untouched", () => {
    const { conductor, windows, files, elements } = makeConductor([
      ["第一句话", 1],
    ]);
    const w = windows[0]!;
    conductor.frame(w.start + 0.2, 1);
    const el = elements[0]!;
    const seeksBefore = el.seeks.length;
    // The agent appended; the compile re-lays the same clip windows.
    conductor.setProgram([...windows], new Map(files));
    conductor.frame(w.start + 0.25, 1);
    expect(el.playCalls).toBe(1); // never restarted
    expect(el.seeks.length).toBe(seeksBefore); // never re-aligned
  });

  test("a hash that vanished from the program stops sounding now", () => {
    const { conductor, windows, elements } = makeConductor([["第一句话", 1]]);
    conductor.frame(windows[0]!.start + 0.2, 1);
    expect(elements[0]!.paused).toBe(false);
    conductor.setProgram([], new Map());
    expect(elements[0]!.paused).toBe(true);
  });

  test("rate reaches the element, and only on change", () => {
    const { conductor, windows, elements } = makeConductor([["第一句话", 1]]);
    const w = windows[0]!;
    conductor.frame(w.start + 0.1, 1.5);
    const el = elements[0]!;
    expect(el.playbackRate).toBe(1.5);
    const sets = el.rateSets;
    conductor.frame(w.start + 0.2, 1.5);
    expect(el.rateSets).toBe(sets); // hot path: no per-frame DOM write
    conductor.setRate(1.25);
    expect(el.playbackRate).toBe(1.25);
  });
});

describe("AudioConductor — degradation, one failure at a time", () => {
  test("autoplay rejection latches blocked; playback stays silent, not stuck", async () => {
    const { conductor, windows, elements } = makeConductor([["第一句话", 1]]);
    const w = windows[0]!;
    elementsPlayMode(elements, conductor, w.start + 0.1, "block");
    await settle();
    expect(conductor.isBlocked()).toBe(true);
    const { audio } = conductor.frame(w.start + 0.2, 1);
    // Not sounding → the gate keeps rAF as master: the board plays on.
    expect(audio?.sounding).toBe(false);
    // The latch also stops per-frame play() spam.
    const el = elements[0]!;
    const calls = el.playCalls;
    conductor.frame(w.start + 0.3, 1);
    expect(el.playCalls).toBe(calls);
  });

  test("one page gesture re-arms the voice after a block", async () => {
    const { conductor, windows, elements, gestures } = makeConductor([
      ["第一句话", 1],
    ]);
    const w = windows[0]!;
    elementsPlayMode(elements, conductor, w.start + 0.1, "block");
    await settle();
    expect(conductor.isBlocked()).toBe(true);
    expect(gestures.armed()).toBeGreaterThan(0);
    elements[0]!.playMode = "resolve";
    gestures.fire("pointerdown");
    await settle();
    expect(conductor.isBlocked()).toBe(false);
    expect(gestures.armed()).toBe(0); // one-shot
    expect(elements[0]!.paused).toBe(false); // the voice is back
  });

  test("a failed clip is muted alone — the next clip still sounds", async () => {
    const { conductor, windows, elements } = makeConductor([
      ["第一句话", 1],
      ["第二句话", 1],
    ]);
    const [a, b] = [windows[0]!, windows[1]!];
    conductor.frame(a.start + 0.1, 1);
    const el = elements[0]!;
    el.emit("error");
    const after = conductor.frame(a.start + 0.2, 1);
    expect(after.audio).toBeNull(); // rAF master through the broken window
    expect(el.paused).toBe(true);
    const atB = conductor.frame(b.start + 0.1, 1);
    expect(atB.audio?.sounding).toBe(true);
    expect(atB.audio?.hash).toBe(b.hash);
  });

  test("an interrupted play start (AbortError) is benign, not a block, not a failure", async () => {
    const { conductor, windows, elements } = makeConductor([["第一句话", 1]]);
    const w = windows[0]!;
    elementsPlayMode(elements, conductor, w.start + 0.1, "abort");
    conductor.pause(); // the interleave that produces AbortError in the wild
    await settle();
    expect(conductor.isBlocked()).toBe(false);
    elements[0]!.playMode = "resolve";
    const { audio } = conductor.frame(w.start + 0.2, 1);
    expect(audio?.sounding).toBe(true); // the clip was never marked failed
  });

  test("a blocked latch outlives the window: the next clip does not try to autoplay", async () => {
    const { conductor, windows, elements } = makeConductor([
      ["第一句话", 1],
      ["第二句话", 1],
    ]);
    elementsPlayMode(elements, conductor, windows[0]!.start + 0.1, "block");
    await settle();
    const el = elements[0]!;
    const calls = el.playCalls;
    conductor.frame(windows[1]!.start + 0.1, 1);
    expect(el.playCalls).toBe(calls); // still latched — no rejection spam
  });
});

describe("AudioConductor — the sticky hold (M1: a sounding clip finishes before the boundary hands over)", () => {
  test("mid-hold, the shared boundary instant stays with the sounding clip; spent hands it over", () => {
    const { conductor, windows, elements, files } = makeConductor([
      ["第二句话", 600],
      ["结尾一句", 3],
    ]);
    const [a, b] = [windows[0]!, windows[1]!];
    expect(b.start).toBe(a.holdAt!); // the same pen-down, snapped exact
    conductor.frame(a.start + 0.1, 1);
    const el = elements[0]!;
    el.advance(5); // A is well into its long tail, mid-word
    // The pinned instant: position alone says B (later window), but A is
    // still sounding — it keeps the board.
    const held = conductor.frame(a.holdAt!, 1);
    expect(held.window?.hash).toBe(a.hash);
    expect(el.src).toBe(`/api/file?path=${files.get(a.hash)!}`);
    expect(el.pauseCalls).toBe(0);
    // The voice finishes: the SAME instant now belongs to B, from its start.
    el.end();
    const after = conductor.frame(a.holdAt!, 1);
    expect(after.window?.hash).toBe(b.hash);
    expect(el.src).toBe(`/api/file?path=${files.get(b.hash)!}`);
    expect(el.paused).toBe(false);
  });
});

describe("AudioConductor — a buffering stall never freezes the board (M2)", () => {
  test("not paused but clock frozen: sounding drops after the grace — loudly, once", () => {
    const { conductor, windows, elements } = makeConductor([["第一句话", 600]]);
    const w = windows[0]!;
    conductor.frame(w.start + 0.1, 1, 1 / 30);
    const el = elements[0]!;
    expect(el.paused).toBe(false);
    const degraded: NarrationDegradation[] = [];
    conductor.onDegraded((d) => degraded.push(d));
    // The report's trace: consecutive 50ms frames, element claiming to
    // play, currentTime pinned — a buffering stall with no error event.
    let lastSounding = true;
    for (let i = 0; i < 5; i++) {
      const { audio } = conductor.frame(w.start + 0.1, 1, 0.05);
      lastSounding = audio!.sounding;
    }
    expect(lastSounding).toBe(false); // the gate returns to rAF — no hang
    expect(degraded).toEqual([{ hash: w.hash, reason: "stalled" }]); // once
    // While stalled the conductor does not spam realign seeks either.
    const seeks = el.seeks.length;
    conductor.frame(w.start + 1.0, 1, 0.05);
    expect(el.seeks.length).toBe(seeks);
  });

  test("recovery realigns the voice FORWARD to the picture and sounds again", () => {
    const { conductor, windows, elements } = makeConductor([["第一句话", 600]]);
    const w = windows[0]!;
    conductor.frame(w.start + 0.1, 1, 1 / 30);
    const el = elements[0]!;
    for (let i = 0; i < 6; i++) conductor.frame(w.start + 0.1, 1, 0.05);
    expect(conductor.frame(w.start + 0.1, 1, 0.05).audio!.sounding).toBe(false);
    // The media engine unfreezes; the board meanwhile moved on to t+1.0.
    el.advance(0.05);
    const { audio } = conductor.frame(w.start + 1.0, 1, 0.05);
    expect(audio?.sounding).toBe(true);
    expect(el.currentTime).toBeCloseTo(1.0, 10); // audio meets picture
  });
});

describe("AudioConductor — transport discipline", () => {
  test("a paused scrub aligns but never sounds a fragment", () => {
    const { conductor, windows, elements } = makeConductor([["第一句话", 2]]);
    const w = windows[0]!;
    conductor.seek(w.start + 0.4, false);
    conductor.seek(w.start + 0.9, false);
    conductor.seek(w.start + 0.2, false);
    const el = elements[0]!;
    expect(el.playCalls).toBe(0);
    expect(el.currentTime).toBeCloseTo(0.2, 10);
  });

  test("a playing seek starts the clip from the mapped offset", () => {
    const { conductor, windows, elements } = makeConductor([["第一句话", 2]]);
    const w = windows[0]!;
    conductor.seek(w.start + 0.7, true);
    const el = elements[0]!;
    expect(el.playCalls).toBe(1);
    expect(el.currentTime).toBeCloseTo(0.7, 10);
    expect(el.paused).toBe(false);
  });

  test("resume after a plain pause continues the element — never re-seeks", () => {
    const { conductor, windows, elements } = makeConductor([["第一句话", 2]]);
    const w = windows[0]!;
    conductor.frame(w.start + 0.1, 1);
    const el = elements[0]!;
    el.advance(0.5); // the voice ran ahead (a hold, or just playback)
    conductor.pause();
    expect(el.paused).toBe(true);
    const seeks = el.seeks.length;
    conductor.resume(w.start + 0.1);
    expect(el.paused).toBe(false);
    expect(el.seeks.length).toBe(seeks); // the element keeps its own clock
  });

  test("an ended clip never replays on its own; an explicit seek re-arms it", () => {
    const { conductor, windows, elements } = makeConductor([["第一句话", 2]]);
    const w = windows[0]!;
    conductor.frame(w.start + 0.1, 1);
    const el = elements[0]!;
    el.end();
    const after = conductor.frame(w.start + 0.5, 1);
    expect(after.audio?.ended).toBe(true);
    expect(after.audio?.sounding).toBe(false);
    expect(el.playCalls).toBe(1); // no auto-replay
    // resume (a plain play press) must not resurrect a spent clip either.
    conductor.resume(w.start + 0.5);
    expect(el.playCalls).toBe(1);
    // But the user scrubbing back into the window re-arms it.
    conductor.seek(w.start + 0.3, true);
    expect(el.playCalls).toBe(2);
    expect(el.currentTime).toBeCloseTo(0.3, 10);
  });

  test("above the skim threshold the voice steps aside and the element is never asked for that rate", () => {
    const { conductor, windows, elements } = makeConductor([["第一句话", 1]]);
    const w = windows[0]!;
    conductor.frame(w.start + 0.1, 1);
    const el = elements[0]!;
    expect(el.paused).toBe(false);
    expect(el.playbackRate).toBe(1);

    // The reader jumps to 16× to skim. `playbackRate = 16` is outside what
    // browsers agree to honour (some clamp, some ignore it silently, some
    // mute), and a voice that kept its own speed would drag the board back
    // to it through the gate — so the element is NEVER handed the rate. It
    // simply stops.
    conductor.setRate(16);
    expect(el.paused).toBe(true);
    expect(el.playbackRate).toBe(1);
    const { audio } = conductor.frame(w.start + 0.2, 16);
    expect(audio).toBeNull(); // rAF is master — the silent board
    expect(el.playbackRate).toBe(1);
    expect(el.paused).toBe(true);

    // Explicit navigation at a skim rate stays silent too (Live / play-from
    // would otherwise blip one frame of 1× voice before the next frame).
    conductor.seek(w.start + 0.3, true);
    expect(el.paused).toBe(true);
    conductor.resume(w.start + 0.3);
    expect(el.paused).toBe(true);
  });

  test("dropping back from a skim rate re-aligns the voice instead of replaying it", () => {
    const { conductor, windows, elements } = makeConductor([["第一句话", 3]]);
    const w = windows[0]!;
    // Somewhere further inside the SAME window, still that clip's ground.
    const back = Math.min(w.start + 0.9, (w.holdAt ?? w.audioEnd) - 1e-3);
    expect(back - w.start).toBeGreaterThan(0.6); // room for a real lag

    conductor.frame(w.start + 0.1, 1);
    const el = elements[0]!;
    el.advance(0.1); // the voice has been heard up to 0.2s into the clip

    conductor.setRate(16);
    conductor.frame(w.start + 0.3, 16);
    expect(el.paused).toBe(true);

    // Back to 1×: the element still holds the right clip, so nothing
    // reloads — but its clock is now behind the picture and must be seeked
    // FORWARD, never the picture back to it.
    conductor.setRate(1);
    conductor.frame(back, 1);
    expect(el.paused).toBe(false);
    expect(el.playbackRate).toBe(1);
    expect(el.currentTime).toBeCloseTo(back - w.start, 6);
  });

  test("dispose stops the sound and detaches everything", async () => {
    const { conductor, windows, elements, gestures } = makeConductor([
      ["第一句话", 1],
    ]);
    elementsPlayMode(elements, conductor, windows[0]!.start + 0.1, "block");
    await settle();
    expect(gestures.armed()).toBeGreaterThan(0);
    conductor.dispose();
    const el = elements[0]!;
    expect(el.paused).toBe(true);
    expect(gestures.armed()).toBe(0);
    expect(el.listenerCount("ended")).toBe(0);
    expect(el.listenerCount("error")).toBe(0);
  });
});

/** First frame with a chosen play() behavior (the element is born lazily). */
function elementsPlayMode(
  elements: FakeAudioElement[],
  conductor: AudioConductor,
  t: number,
  mode: FakeAudioElement["playMode"],
): void {
  // The element does not exist until the conductor needs it; prime the
  // factory result's mode through a first frame at a silent instant is
  // impossible (creation happens inside the voiced window), so set the
  // mode immediately after the creating frame's play() was issued — the
  // promise settles asynchronously, and for "block"/"abort" the fake
  // rejects on the SAME call, so the mode must be set before. Hence:
  // create-on-frame with the mode pre-set via a monkeypatched factory is
  // avoided by setting the mode on a probe element first.
  if (elements.length === 0) {
    // No element yet: the first frame will create one; playMode must be
    // set before its play() runs, so intercept via a zero-length frame at
    // the same t after pre-seeding is not possible — instead, create the
    // element through a PAUSED seek (never plays), set the mode, then
    // frame.
    conductor.seek(t, false);
  }
  const el = elements[elements.length - 1]!;
  el.playMode = mode;
  conductor.frame(t, 1);
}

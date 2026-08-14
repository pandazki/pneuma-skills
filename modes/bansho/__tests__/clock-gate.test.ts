/**
 * T10-4 — the clock gate (`viewer/clock-gate.ts`): who owns the canonical
 * clock, frame by frame.
 *
 * Pins the gate rules against REAL compiled timelines (never hand-built
 * windows — whether a window's start coincides with the previous step's
 * last pen-up is timeline.ts's business, and the tests must read it off a
 * real compile):
 *
 *  - rAF is master everywhere audio is not actually sounding: no window,
 *    no snapshot, wrong clip, blocked/failed/ended — every degradation is
 *    byte-identical to `tick` (the silent board);
 *  - audio is master inside a sounding window: t = window.start +
 *    audio.time, and the rAF dt never leaks in;
 *  - the canonical clock never passes a pen-down (`holdAt`) or the board's
 *    end while the clip is still sounding — one pin rule, two places;
 *  - t is monotonic during playback: audio lagging the picture freezes t
 *    (identical object), never rewinds it;
 *  - a voiced next step takes the board at ITS window start (activeClipAt
 *    precedence) — the hold only ever binds when what follows is unvoiced;
 *  - release is seamless: the frame after `ended` resumes rAF from the
 *    pinned t, advancing exactly dt × rate.
 */

import { describe, expect, test } from "bun:test";

import { parseLecture } from "../domain.js";
import { DEFAULT_DURATIONS } from "../engine/duration.js";
import { buildTimeline } from "../engine/timeline.js";
import { flattenSteps } from "../engine/inference.js";
import { stepContentHash, stepPlainText } from "../engine/text.js";
import {
  activeClipAt,
  clipWindows,
  createNarrationHook,
  type ClipWindow,
} from "../narration/timing.js";
import type { NarrationManifest } from "../narration/types.js";
import { stepKey } from "../viewer/address.js";
import { AudioConductor } from "../viewer/audio-conductor.js";
import {
  gatedTick,
  NARRATION_RATE_BAND,
  narrationAudibleAtRate,
  type AudioClockSnapshot,
} from "../viewer/clock-gate.js";
import {
  createPlayer,
  scrub,
  tick,
  togglePlay,
  type PlayerState,
} from "../viewer/player-core.js";
import { FakeAudioElement, FakeGestureTarget } from "./fake-audio.js";

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

/** Real compile: manifest → hook → timeline → windows, one truth. */
function compile(entries: Array<[fragment: string, seconds: number]>) {
  const lecture = parseLecture(BOARD);
  const clips: NarrationManifest["clips"] = {};
  for (const [fragment, seconds] of entries) {
    const hash = hashOf(lecture, fragment);
    clips[hash] = { file: `narration/${hash}.wav`, seconds, text: fragment };
  }
  const manifest: NarrationManifest = { clips };
  const hook = createNarrationHook(lecture.source, manifest)!;
  const timeline = buildTimeline(lecture, {
    durations: DEFAULT_DURATIONS,
    durationOverride: hook.durationOverride,
  });
  const windows = clipWindows(timeline.schedule, hook.applied);
  const files = new Map<string, string>();
  for (const w of windows) files.set(w.hash, clips[w.hash]!.file);
  return { lecture, timeline, windows, files };
}

/** The production wiring, minus React: one conductor over a real compile. */
function conductorFor(compiled: ReturnType<typeof compile>) {
  const element = new FakeAudioElement();
  const conductor = new AudioConductor({
    resolveUrl: (path) => `/api/file?path=${path}`,
    createElement: () => element,
    gestureTarget: new FakeGestureTarget(),
  });
  conductor.setProgram(compiled.windows, compiled.files);
  return { element, conductor };
}

function playingAt(t: number, duration: number): PlayerState {
  return { ...createPlayer(duration, false), t, playing: true };
}

function snap(
  w: ClipWindow,
  time: number,
  over: Partial<AudioClockSnapshot> = {},
): AudioClockSnapshot {
  return { hash: w.hash, time, sounding: true, ended: false, ...over };
}

describe("gatedTick — rAF master wherever audio is not actually sounding", () => {
  test("paused or degenerate dt: identical object, exactly like tick", () => {
    const { windows, timeline } = compile([["第一句话", 1]]);
    const w = windows[0]!;
    const paused: PlayerState = {
      ...playingAt(w.start + 0.1, timeline.duration),
      playing: false,
    };
    expect(gatedTick(paused, 0.016, w, snap(w, 0.1))).toBe(paused);
    const s = playingAt(w.start + 0.1, timeline.duration);
    expect(gatedTick(s, 0, w, snap(w, 0.1))).toBe(s);
    expect(gatedTick(s, NaN, w, snap(w, 0.1))).toBe(s);
  });

  test("no window / no snapshot / wrong clip / not sounding / ended → tick verbatim", () => {
    const { windows, timeline } = compile([["第一句话", 1]]);
    const w = windows[0]!;
    const s = playingAt(w.start + 0.1, timeline.duration);
    const viaTick = tick(s, 0.016);
    expect(gatedTick(s, 0.016, null, null)).toEqual(viaTick);
    expect(gatedTick(s, 0.016, w, null)).toEqual(viaTick);
    expect(
      gatedTick(s, 0.016, w, snap(w, 0.1, { hash: "someone-else" })),
    ).toEqual(viaTick);
    expect(gatedTick(s, 0.016, w, snap(w, 0.1, { sounding: false }))).toEqual(
      viaTick,
    );
    expect(gatedTick(s, 0.016, w, snap(w, 0.1, { ended: true }))).toEqual(
      viaTick,
    );
  });
});

describe("gatedTick — audio master inside a sounding window", () => {
  test("t maps to window.start + audio.time; the rAF dt never leaks in", () => {
    const { windows, timeline } = compile([["第一句话", 1]]);
    const w = windows[0]!;
    const s = playingAt(w.start + 0.1, timeline.duration);
    // dt is enormous; the audio advanced only 0.05s — audio wins.
    const next = gatedTick(s, 5, w, snap(w, 0.15));
    expect(next.t).toBeCloseTo(w.start + 0.15, 10);
    expect(next.playing).toBe(true);
  });

  test("rate does not double-apply: the gate reads clip seconds only", () => {
    const { windows, timeline } = compile([["第一句话", 1]]);
    const w = windows[0]!;
    const s: PlayerState = {
      ...playingAt(w.start, timeline.duration),
      rate: 1.5,
    };
    // At 1.5× the ELEMENT advances 1.5× wall clock; the gate must map that
    // advance verbatim, not scale it again.
    const next = gatedTick(s, 0.016, w, snap(w, 0.024));
    expect(next.t).toBeCloseTo(w.start + 0.024, 10);
  });

  test("monotonic: audio lagging the picture freezes t, never rewinds it", () => {
    const { windows, timeline } = compile([["第一句话", 1]]);
    const w = windows[0]!;
    const s = playingAt(w.start + 0.5, timeline.duration);
    // Engagement latency: the element is still at 0.1 (maps to start+0.1,
    // behind the playhead). The picture must not jump back.
    const next = gatedTick(s, 0.016, w, snap(w, 0.1));
    expect(next).toBe(s);
  });
});

describe("gatedTick — the pin rule: never pass a pen-down or the end while sounding", () => {
  test("a long clip holds the clock exactly at holdAt (identical object once pinned)", () => {
    const { windows, timeline } = compile([["第一句话", 600]]);
    const w = windows[0]!;
    expect(w.holdAt).not.toBeNull();
    // Approaching from below: mapped time would pass holdAt — pins there.
    const before = playingAt(w.holdAt! - 0.01, timeline.duration);
    const atHold = gatedTick(
      before,
      0.016,
      w,
      snap(w, w.holdAt! - w.start + 3),
    );
    expect(atHold.t).toBe(w.holdAt!);
    expect(atHold.playing).toBe(true);
    // Pinned: further sounding frames return the identical object (the
    // hot-path discipline tick has at the live tip).
    const pinned = gatedTick(atHold, 0.016, w, snap(w, w.holdAt! - w.start + 4));
    expect(pinned).toBe(atHold);
  });

  test("release is seamless: the frame after ended resumes rAF from the pinned t", () => {
    const { windows, timeline } = compile([["第一句话", 600]]);
    const w = windows[0]!;
    const pinned = playingAt(w.holdAt!, timeline.duration);
    const released = gatedTick(
      pinned,
      0.016,
      w,
      snap(w, w.audioSeconds, { sounding: false, ended: true }),
    );
    expect(released.t).toBeCloseTo(w.holdAt! + 0.016, 10);
    expect(released).toEqual(tick(pinned, 0.016));
  });

  test("a final clip's tail pins at the board's end, still playing, until it ends", () => {
    const { windows, timeline } = compile([["结尾一句", 600]]);
    const w = windows[windows.length - 1]!;
    expect(w.holdAt).toBeNull();
    expect(w.audioEnd).toBeGreaterThan(timeline.duration);
    const s: PlayerState = {
      ...playingAt(timeline.duration, timeline.duration),
      follow: "detached",
    };
    // Sounding at the end: the clock pins, playback does NOT stop (the
    // voice is finishing its last sentence).
    const held = gatedTick(s, 0.016, w, snap(w, timeline.duration - w.start + 1));
    expect(held).toBe(s);
    expect(held.playing).toBe(true);
    // Once the tail ends, the rAF branch applies end-of-media as usual.
    const done = gatedTick(
      s,
      0.016,
      w,
      snap(w, w.audioSeconds, { sounding: false, ended: true }),
    );
    expect(done.playing).toBe(false);
  });
});

describe("the rate band — outside NARRATION_RATE_BAND the voice steps aside", () => {
  test("engaged inside the band, released at either edge of it", () => {
    const { windows, timeline } = compile([["第一句话", 1]]);
    const w = windows[0]!;
    expect(NARRATION_RATE_BAND).toEqual({ min: 1, max: 1.5 });
    // Inside, INCLUSIVE at both ends: the element runs at that rate and
    // the gate maps it.
    for (const rate of [1, 1.25, 1.5] as const) {
      const at = { ...playingAt(w.start, timeline.duration), rate };
      expect(narrationAudibleAtRate(rate)).toBe(true);
      expect(gatedTick(at, 0.016, w, snap(w, 0.064)).t).toBeCloseTo(
        w.start + 0.064,
        10,
      );
    }
    // Outside — in EITHER direction — the gate refuses engagement no
    // matter what the element claims: a browser that silently ignored
    // `playbackRate = 16` would otherwise drive the board at the clip's
    // own speed while the reader asked for sixteen, and one that ignored
    // 0.75 would race the picture ahead of a voice studying a stroke.
    for (const rate of [0.75, 2, 4, 8, 16] as const) {
      const s = { ...playingAt(w.start, timeline.duration), rate };
      const stale = snap(w, 0.064); // element crawling at 1×
      expect(narrationAudibleAtRate(rate)).toBe(false);
      expect(gatedTick(s, 0.016, w, stale)).toEqual(tick(s, 0.016));
      expect(gatedTick(s, 0.016, w, stale).t).toBeCloseTo(
        w.start + 0.016 * rate,
        10,
      );
    }
  });

  test("a hold cannot pin the board at a skim rate — no deadlock on a long clip", () => {
    // The deadlock this rules out: a ten-minute clip pins the clock at its
    // pen-down while sounding, so a board waiting on a voice that will
    // never finish at 16× would sit still forever.
    const { windows, timeline } = compile([["第一句话", 600]]);
    const w = windows[0]!;
    expect(w.holdAt).not.toBeNull();
    const s = {
      ...playingAt(w.holdAt! - 0.01, timeline.duration),
      rate: 16 as const,
    };
    const sounding = snap(w, w.holdAt! - w.start + 3);
    const next = gatedTick(s, 0.016, w, sounding);
    expect(next.t).toBeGreaterThan(w.holdAt!); // walked straight past it
    expect(next).toEqual(tick(s, 0.016));
  });

  test("the end pin is released too: a skimmed final tail ends the media", () => {
    const { windows, timeline } = compile([["结尾一句", 600]]);
    const w = windows[windows.length - 1]!;
    expect(w.holdAt).toBeNull();
    const s: PlayerState = {
      ...playingAt(timeline.duration, timeline.duration),
      follow: "detached",
      rate: 16,
    };
    const done = gatedTick(
      s,
      0.016,
      w,
      snap(w, timeline.duration - w.start + 1),
    );
    expect(done.playing).toBe(false); // end-of-media, not a wait for a voice
  });
});

describe("the voiced-next handover (position decides cold; the runtime lets the voice finish)", () => {
  test("cold navigation at the shared boundary belongs to the NEW step's window", () => {
    const { windows } = compile([
      ["第一句话", 600],
      ["第二句话", 3],
    ]);
    expect(windows).toHaveLength(2);
    const [a, b] = [windows[0]!, windows[1]!];
    // A's tail overruns into B's territory, and B's window begins no later
    // than A's hold point (equal up to float summation noise — both are
    // the same pen-down laid by the same compile).
    expect(a.audioEnd).toBeGreaterThan(b.start);
    expect(a.holdAt).not.toBeNull();
    expect(b.start).toBeLessThanOrEqual(a.holdAt! + 1e-9);
    // Position alone (a paused scrub landing here, nothing sounding):
    // before the boundary the moment is A's, from the boundary on it is
    // B's. Whether a clip ALREADY SOUNDING at the boundary keeps the board
    // is runtime state — the conductor's sticky hold, pinned in the
    // transport-chain suite below: A finishes first, THEN B starts.
    expect(activeClipAt(windows, b.start - 1e-6)?.hash).toBe(a.hash);
    expect(activeClipAt(windows, b.start + 1e-6)?.hash).toBe(b.hash);
  });

  test("when the next step is unvoiced, the hold binds at its own instant — and no further", () => {
    const { windows } = compile([["第一句话", 600]]);
    const w = windows[0]!;
    // The pinned instant IS the hold: the held clip still resolves there.
    expect(activeClipAt(windows, w.holdAt!)?.hash).toBe(w.hash);
    // Past the pen-down the canonical timeline is the next step's writing.
    // The tail beyond holdAt plays over the PIN (wall-clock spent at one
    // canonical instant) — it does not occupy canonical seconds, so no t
    // past the pen-down may resolve to this voice (G1 at runtime).
    expect(activeClipAt(windows, w.holdAt! + 0.01)).toBeNull();
  });
});

describe("the transport chain across a hold (B1 — scrub → resume → gatedTick)", () => {
  test("scrubbing past holdAt and resuming does not carry the held voice into the next step", () => {
    const compiled = compile([["第一句话", 600]]);
    const { timeline, windows } = compiled;
    const w = windows[0]!;
    expect(w.holdAt).not.toBeNull();
    const { element, conductor } = conductorFor(compiled);

    // Play from 0 until the pin binds — the designed hold: A's voice over
    // a stationary pen at the next pen-down.
    let s = createPlayer(timeline.duration, false);
    const dt = 1 / 30;
    for (let i = 0; i < 4000 && s.t < w.holdAt!; i++) {
      const { window, audio } = conductor.frame(s.t, s.rate);
      s = gatedTick(s, dt, window, audio);
      element.advance(dt);
    }
    expect(s.t).toBe(w.holdAt!);
    expect(element.paused).toBe(false); // A is mid-word, held

    // The user drags just past the hold (a scrub pauses + aligns silently)…
    s = scrub(s, w.holdAt! + 0.01);
    conductor.seek(s.t, false);
    expect(element.paused).toBe(true);
    // …and presses play again (same playhead → a plain resume).
    s = togglePlay(s);
    conductor.resume(s.t);

    // Past the pen-down the board is the NEXT step's writing: A's tail was
    // skipped by the scrub and must never sound there (G1 at runtime —
    // one step's voice may not accompany another step's moving pen).
    const before = s.t;
    const { window, audio } = conductor.frame(s.t, s.rate);
    expect(audio?.sounding ?? false).toBe(false);
    expect(element.paused).toBe(true);
    const next = gatedTick(s, dt, window, audio);
    expect(next.t).toBeCloseTo(before + dt, 10); // rAF master, not the projection
  });

  test("a stale engaged snapshot past holdAt cannot drive the clock (gate-level guard)", () => {
    const { windows, timeline } = compile([["第一句话", 600]]);
    const w = windows[0]!;
    const s = playingAt(w.holdAt! + 0.01, timeline.duration);
    // Even a snapshot that CLAIMS this clip is sounding here must not get
    // the projection: past its own hold point the clip owns no canonical
    // time, and rAF is master.
    const next = gatedTick(s, 0.016, w, snap(w, w.holdAt! - w.start + 3));
    expect(next).toEqual(tick(s, 0.016));
  });

  // The M1 pair: the follower's window start and the leader's hold point
  // are the SAME pen-down laid by the same compile (clipWindows snaps the
  // float summation noise between them to exact equality). Position-only
  // ownership hands that shared instant to the follower the moment the
  // clock pins there — seizing the element mid-word.
  test("M1 — a long clip holds a VOICED next step's pen-down until the voice finishes", () => {
    const compiled = compile([
      ["第二句话", 600],
      ["结尾一句", 3],
    ]);
    const { timeline, windows, files } = compiled;
    const [a, b] = [windows[0]!, windows[1]!];
    expect(a.holdAt).not.toBeNull();
    expect(b.start).toBe(a.holdAt!); // the same pen-down, exactly
    const { element, conductor } = conductorFor(compiled);
    const aSrc = `/api/file?path=${files.get(a.hash)!}`;
    const bSrc = `/api/file?path=${files.get(b.hash)!}`;

    // Play from 0 for ~15s of wall clock — several times past the moment
    // the pin binds (A's writing is a few canonical seconds).
    let s = createPlayer(timeline.duration, false);
    const dt = 1 / 30;
    for (let i = 0; i < 450; i++) {
      const { window, audio } = conductor.frame(s.t, s.rate);
      s = gatedTick(s, dt, window, audio);
      element.advance(dt);
      // While A's voice still sounds, the element stays A's clip and the
      // clock never passes the pen-down — the contract the manifest
      // changelog and references/narration.md promise: a clip far longer
      // than its sentence makes the clock wait at the next pen-down until
      // the voice finishes. B does NOT seize the board at its own start.
      if (element.src !== "") {
        expect(element.src).toBe(aSrc);
        expect(s.t).toBeLessThanOrEqual(a.holdAt! + 1e-9);
      }
    }
    expect(element.currentTime).toBeGreaterThan(5); // A really kept sounding

    // A's voice finishes — only NOW does B take the board.
    element.end();
    for (let i = 0; i < 5; i++) {
      const { window, audio } = conductor.frame(s.t, s.rate);
      s = gatedTick(s, dt, window, audio);
      element.advance(dt);
    }
    expect(element.src).toBe(bSrc);
    expect(element.paused).toBe(false);
    expect(s.t).toBeGreaterThan(a.holdAt!); // B's voice now drives the clock
  });

  test("paused mid-hold, resume continues the HELD voice — it does not arm the next clip", () => {
    const compiled = compile([
      ["第二句话", 600],
      ["结尾一句", 3],
    ]);
    const { timeline, windows, files } = compiled;
    const a = windows[0]!;
    const { element, conductor } = conductorFor(compiled);
    const aSrc = `/api/file?path=${files.get(a.hash)!}`;

    let s = createPlayer(timeline.duration, false);
    const dt = 1 / 30;
    for (let i = 0; i < 450 && s.t < a.holdAt!; i++) {
      const { window, audio } = conductor.frame(s.t, s.rate);
      s = gatedTick(s, dt, window, audio);
      element.advance(dt);
    }
    expect(s.t).toBe(a.holdAt!); // pinned, A mid-word

    // Pause, then a plain resume at the same playhead: the element must
    // continue A from its own clock, not re-derive ownership by position
    // (position alone would hand the overlapped instant to B).
    s = togglePlay(s);
    conductor.pause();
    expect(element.paused).toBe(true);
    s = togglePlay(s);
    conductor.resume(s.t);
    expect(element.src).toBe(aSrc);
    expect(element.paused).toBe(false);
    expect(element.playCalls).toBe(2); // started once, resumed once
  });

  test("M2 — a stalled voice releases the hold: the board crosses the pen-down instead of hanging", () => {
    const compiled = compile([["第一句话", 600]]);
    const { element, conductor } = conductorFor(compiled);
    const w = compiled.windows[0]!;
    let s = createPlayer(compiled.timeline.duration, false);
    const dt = 1 / 30;
    // Reach the pin with a healthy element…
    for (let i = 0; i < 300 && s.t < w.holdAt!; i++) {
      const { window, audio } = conductor.frame(s.t, s.rate, dt);
      s = gatedTick(s, dt, window, audio);
      element.advance(dt);
    }
    expect(s.t).toBe(w.holdAt!);
    // …then the element buffers: it claims to play, its clock stands
    // still, and no error event ever fires. The canonical clock is pinned
    // to a projection of that frozen clock — without a stall channel this
    // deadlocks (the MAX_LAG recovery compares the audio to a t that IS
    // the frozen audio time). One second of frames must be enough to
    // cross the grace and hand the clock back to rAF.
    for (let i = 0; i < 30; i++) {
      const { window, audio } = conductor.frame(s.t, s.rate, dt);
      s = gatedTick(s, dt, window, audio);
      // element.advance deliberately NOT called — the stall.
    }
    expect(s.t).toBeGreaterThan(w.holdAt!); // the board plays on
  });
});

describe("G1 at runtime — the sound and the pen always belong to the same step", () => {
  /**
   * The single-pen invariant extended to audio (release-gate hard
   * constraint): at any moment while a clip is SOUNDING, the canonical
   * playhead never lies strictly inside a schedule entry of a different
   * step. The shared boundary instant is allowed — the pen is stationary
   * there (a hold is the voice finishing over a stationary pen).
   */
  function auditFrames(
    compiled: ReturnType<typeof compile>,
    conductor: AudioConductor,
    element: FakeAudioElement,
    s: PlayerState,
    frames: number,
  ): { s: PlayerState; violations: string[] } {
    const dt = 1 / 30;
    const violations: string[] = [];
    const byHash = new Map(compiled.windows.map((w) => [w.hash, w]));
    for (let i = 0; i < frames; i++) {
      const { window, audio } = conductor.frame(s.t, s.rate);
      s = gatedTick(s, dt, window, audio);
      if (audio?.sounding) {
        const voiced = byHash.get(audio.hash)!;
        const voicedKey = stepKey(voiced.ref);
        for (const e of compiled.timeline.schedule) {
          if (stepKey(e.step) === voicedKey) continue;
          if (e.start < s.t - 1e-9 && s.t < e.end - 1e-9) {
            violations.push(
              `t=${s.t.toFixed(4)} is inside step ${stepKey(e.step)} while voice ${voicedKey} sounds`,
            );
          }
        }
      }
      element.advance(dt);
      // The fake media engine runs out exactly at the loaded clip's
      // recorded length, like the real file would.
      if (audio && element.currentTime >= byHash.get(audio.hash)!.audioSeconds) {
        element.end();
      }
    }
    return { s, violations };
  }

  test("unvoiced-next hold, including a scrub past it mid-run", () => {
    const compiled = compile([["第一句话", 600]]);
    const { element, conductor } = conductorFor(compiled);
    let s = createPlayer(compiled.timeline.duration, false);
    const first = auditFrames(compiled, conductor, element, s, 200);
    expect(first.violations).toEqual([]);

    // The B1 shape as a property: scrub past the hold, resume, keep going.
    s = scrub(first.s, compiled.windows[0]!.holdAt! + 0.01);
    conductor.seek(s.t, false);
    s = togglePlay(s);
    conductor.resume(s.t);
    const after = auditFrames(compiled, conductor, element, s, 200);
    expect(after.violations).toEqual([]);
  });

  test("voiced pair: the whole performance, hold and handover included", () => {
    const compiled = compile([
      ["第二句话", 8],
      ["结尾一句", 3],
    ]);
    const { element, conductor } = conductorFor(compiled);
    const s = createPlayer(compiled.timeline.duration, false);
    // Each clip ends at its recorded length; the run crosses A's hold,
    // the A→B handover and B's own playback.
    const done = auditFrames(compiled, conductor, element, s, 600);
    expect(done.violations).toEqual([]);
    expect(done.s.t).toBeGreaterThan(compiled.windows[1]!.start);
  });
});

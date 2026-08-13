/**
 * The mute seam (`voice-output.ts`) — the listener's silence, proved to be
 * silence and nothing else.
 *
 * The board has two voice paths and both are CLOCKS: while a clip sounds,
 * `clock-gate.ts` projects the canonical playhead from the element's own
 * clock and pins it at the step's hold point, so a 30-second clip over a
 * one-line sentence keeps the pen stationary until the voice finishes.
 * Anything that stops the element therefore changes the lecture — the pen
 * would stop waiting and race ahead.
 *
 * So this file pins the two halves of "gate the voice, not the clock":
 *
 *  1. **The seam reaches both conductors identically** — the flag lands on
 *     whatever element the path owns, an element created after the choice
 *     is born muted, and setting it never calls `pause()` and never writes
 *     `currentTime`.
 *  2. **Trajectory equality** — the same lecture run muted and unmuted
 *     produces the SAME playhead, frame for frame, across a hold. This is
 *     the assertion that forbids the tempting `pause()` implementation:
 *     with it, the muted run sails past the hold and the two trajectories
 *     diverge immediately.
 */

import { describe, expect, test } from "bun:test";

import { gatedTick } from "../viewer/clock-gate.js";
import { AudioConductor } from "../viewer/audio-conductor.js";
import { TrackConductor } from "../viewer/track-conductor.js";
import { layOutTrack } from "../narration/track.js";
import type { ClipWindow } from "../narration/timing.js";
import { createPlayer, type PlayerState } from "../viewer/player-core.js";
import type { VoiceOutput } from "../viewer/voice-output.js";
import { FakeAudioElement, FakeGestureTarget } from "./fake-audio.js";

const SR = 48000;
const DURATION = 40;

/**
 * ONE long clip over a short sentence: the pen reaches its own pen-down at
 * canonical 3 s while the voice has 30 s to say. That gap IS the hold, and
 * it is the part of the schedule a wrong mute would destroy.
 */
const WINDOWS: readonly ClipWindow[] = [
  {
    ref: { section: 0, step: 1 },
    hash: "a",
    start: 1,
    audioSeconds: 30,
    audioEnd: 31,
    holdAt: 3,
  },
];

/** One voice path, wired the way the host wires it. */
interface Path {
  el: FakeAudioElement;
  /** The clock half — driven per frame by the player loop. */
  clock: {
    frame(
      t: number,
      rate: number,
      dt?: number,
    ): ReturnType<AudioConductor["frame"]>;
  };
  /** The output half — what the transport's toggle drives. */
  voice: VoiceOutput;
  /** Hand the conductor its program — deferred so a test can mute first. */
  install(): void;
}

function clipPath(): Path {
  const el = new FakeAudioElement();
  const conductor = new AudioConductor({
    resolveUrl: (path) => `/api/file?path=${path}`,
    createElement: () => el,
    gestureTarget: new FakeGestureTarget(),
  });
  return {
    el,
    clock: conductor,
    voice: conductor,
    install: () =>
      conductor.setProgram(
        WINDOWS,
        new Map(WINDOWS.map((w) => [w.hash, `narration/${w.hash}.mp3`])),
      ),
  };
}

function trackPath(): Path {
  const el = new FakeAudioElement();
  const conductor = new TrackConductor({
    resolveUrl: (path) => `/api/file?path=${path}`,
    createElement: () => el,
    gestureTarget: new FakeGestureTarget(),
  });
  return {
    el,
    clock: conductor,
    voice: conductor,
    install: () =>
      conductor.setProgram(
        layOutTrack(WINDOWS, DURATION, SR),
        WINDOWS,
        "set/narration/track.mp3",
      ),
  };
}

/** A path with its program already installed — the ordinary case. */
function ready(make: () => Path): Path {
  const path = make();
  path.install();
  return path;
}

const PATHS: ReadonlyArray<{ name: string; make: () => Path }> = [
  { name: "per-clip", make: clipPath },
  { name: "pre-mixed track", make: trackPath },
];

/**
 * The production frame loop, minus React: conductor → gate → playhead, with
 * the fake media engine advancing between frames exactly as the real one
 * does (and running out at the clip's recorded length, on the per-clip path
 * where `ended` is an event).
 */
function play(
  path: Path,
  frames: number,
  opts: { muteAt?: number } = {},
): number[] {
  const dt = 1 / 60;
  let s: PlayerState = createPlayer(DURATION, false);
  const trajectory: number[] = [];
  for (let i = 0; i < frames; i++) {
    if (opts.muteAt === i) path.voice.setMuted(true);
    const { window, audio } = path.clock.frame(s.t, s.rate, dt);
    s = gatedTick(s, dt, window, audio);
    trajectory.push(s.t);
    path.el.advance(dt);
    if (audio && path.el.currentTime >= WINDOWS[0]!.audioEnd - WINDOWS[0]!.start) {
      path.el.end();
    }
  }
  return trajectory;
}

describe("the mute lands on the element, on both voice paths", () => {
  for (const { name, make } of PATHS) {
    test(`${name}: the flag reaches the live element and comes back off`, () => {
      const path = ready(make);
      path.clock.frame(1.5, 1, 1 / 60); // the element exists and is sounding
      expect(path.el.muted).toBe(false);
      path.voice.setMuted(true);
      expect(path.el.muted).toBe(true);
      path.voice.setMuted(false);
      expect(path.el.muted).toBe(false);
    });

    test(`${name}: an element created AFTER the choice is born muted`, () => {
      // The persisted preference is pushed in on mount, before any program
      // and before any element exists. Both conductors build their element
      // lazily, so the flag has to survive the gap — or the first clip
      // sounds out loud for the frames it takes the host to catch up.
      const path = make();
      path.voice.setMuted(true);
      path.install();
      path.clock.frame(1.5, 1, 1 / 60);
      expect(path.el.muted).toBe(true);
      expect(path.el.paused).toBe(false); // muted, and playing
    });

    test(`${name}: muting never pauses the element and never seeks it`, () => {
      const path = ready(make);
      for (let i = 0; i < 120; i++) {
        path.clock.frame(1 + i / 60, 1, 1 / 60);
        path.el.advance(1 / 60);
      }
      const pausesBefore = path.el.pauseCalls;
      const seeksBefore = [...path.el.seeks];
      path.voice.setMuted(true);
      path.voice.setMuted(false);
      path.voice.setMuted(true);
      expect(path.el.pauseCalls).toBe(pausesBefore);
      expect(path.el.seeks).toEqual(seeksBefore);
      expect(path.el.paused).toBe(false); // still running: mute is not stop
    });

    test(`${name}: setting the same value twice writes nothing new`, () => {
      const path = ready(make);
      path.clock.frame(1.5, 1, 1 / 60);
      path.voice.setMuted(true);
      const pauses = path.el.pauseCalls;
      const seeks = path.el.seeks.length;
      path.voice.setMuted(true);
      expect(path.el.muted).toBe(true);
      expect(path.el.pauseCalls).toBe(pauses);
      expect(path.el.seeks).toHaveLength(seeks);
    });
  }
});

describe("a muted lecture is the SAME lecture", () => {
  // 400 frames ≈ 6.7 s: long enough to reach the clip at canonical 1 s,
  // ride its projection to the pen-down at 3 s, and sit pinned there while
  // the 30-second voice keeps going. A mute that stopped the element would
  // release that pin on the very next frame.
  const FRAMES = 400;

  for (const { name, make } of PATHS) {
    test(`${name}: muted from the first frame, the playhead is identical`, () => {
      const loud = play(ready(make), FRAMES);
      const quiet = play(ready(make), FRAMES, { muteAt: 0 });
      expect(quiet).toEqual(loud);
      // Guard against a vacuous pass: the run must actually have reached
      // the hold and stopped there, which is the thing being preserved.
      expect(loud[FRAMES - 1]).toBeCloseTo(WINDOWS[0]!.holdAt!, 6);
      expect(loud[0]).toBeLessThan(WINDOWS[0]!.holdAt!);
    });

    test(`${name}: muting mid-lecture does not move the pen`, () => {
      // Frame 120 is 2 s in — inside the clip's window, with the voice
      // owning the clock. This is the moment a `pause()` implementation
      // would hand the clock back to rAF and skip the hold.
      const loud = play(ready(make), FRAMES);
      const quiet = play(ready(make), FRAMES, { muteAt: 120 });
      expect(quiet).toEqual(loud);
    });

    test(`${name}: the muted run still holds the pen for the long clip`, () => {
      const quiet = play(ready(make), FRAMES, { muteAt: 0 });
      const hold = WINDOWS[0]!.holdAt!;
      // Never past the pen-down while the voice is still sounding (gate
      // rule 4) — the whole point of a hold.
      expect(Math.max(...quiet)).toBeLessThanOrEqual(hold + 1e-9);
      expect(quiet[FRAMES - 1]).toBeCloseTo(hold, 6);
    });
  }
});

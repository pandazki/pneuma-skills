/**
 * ONE CLOCK. Everything on the previz stage reads this and nothing else.
 *
 * A shot's lanes are different files with different real durations — a
 * greybox rendered to exactly 8.00 s next to a take ffprobe measured at
 * 8.04 s — and the only way a drift is visible is if both are driven from a
 * single time in seconds rather than each playing itself.
 *
 * Three rules make that hold:
 *
 * 1. THE CLOCK IS NOT THE VIDEO. While playing, `time` advances from
 *    `performance.now()` deltas × rate and the `<video>` elements play
 *    natively, re-seeked only when they drift more than ~1.5 frames. While
 *    paused, scrubbing or stepping, every element is SET exactly — a paused
 *    player that is one frame off is a player nobody can trust.
 * 2. EACH LANE CLAMPS TO ITS OWN END. A lane shorter than the shot holds its
 *    last frame instead of restarting or going black.
 * 3. SUBSCRIBERS, NOT STATE. The clock ticks at animation-frame rate; putting
 *    that in React state would re-render the whole stage, the three.js lane
 *    included, sixty times a second. Components that need the number
 *    (`useClock`) subscribe for themselves; the rest never re-render.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** `beat` loops the window the caller last set; `shot` loops the whole shot. */
export type LoopMode = "off" | "shot" | "beat";

export interface ClockSnapshot {
  time: number;
  playing: boolean;
  rate: number;
  loop: LoopMode;
}

export interface Clock {
  /** Seconds on the shared clock, authoritative and always current. */
  getTime(): number;
  getSnapshot(): ClockSnapshot;
  subscribe(listener: (snapshot: ClockSnapshot) => void): () => void;
  seek(time: number): void;
  play(): void;
  pause(): void;
  toggle(): void;
  /** Move by whole frames of the SHOT's frame rate, and pause. */
  stepFrames(frames: number): void;
  setRate(rate: number): void;
  setLoop(mode: LoopMode): void;
  /** The window `loop: "beat"` repeats. Null falls back to the whole shot. */
  setLoopWindow(window: [number, number] | null): void;
  getLoopWindow(): [number, number] | null;
  readonly duration: number;
  readonly fps: number;
}

/** Re-seek a playing video only past this much drift, in frames. */
const DRIFT_FRAMES = 1.5;

/**
 * Exported for its tests. The hook below is the only production consumer;
 * the class is here because the clock's rules — frame snapping, clamping,
 * loop windows, restarting from the end — are worth pinning without a DOM.
 */
export class Playhead implements Clock {
  duration: number;
  fps: number;

  private time = 0;
  private playing = false;
  private rate = 1;
  private loop: LoopMode = "off";
  private loopWindow: [number, number] | null = null;
  private listeners = new Set<(snapshot: ClockSnapshot) => void>();
  private raf: number | null = null;
  private last = 0;

  constructor(duration: number, fps: number) {
    this.duration = duration;
    this.fps = fps;
  }

  getTime(): number {
    return this.time;
  }

  getSnapshot(): ClockSnapshot {
    return { time: this.time, playing: this.playing, rate: this.rate, loop: this.loop };
  }

  subscribe(listener: (snapshot: ClockSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  private window(): [number, number] {
    if (this.loop === "beat" && this.loopWindow) {
      const [from, to] = this.loopWindow;
      if (to > from) return [Math.max(0, from), Math.min(this.duration, to)];
    }
    return [0, this.duration];
  }

  seek(time: number): void {
    const next = Math.min(Math.max(time, 0), this.duration);
    if (next === this.time) return;
    this.time = next;
    this.emit();
  }

  play(): void {
    if (this.playing) return;
    // Pressing play at the very end restarts rather than doing nothing.
    const [from, to] = this.window();
    if (this.time >= to - 1e-4) this.time = from;
    this.playing = true;
    this.last = now();
    this.emit();
    this.schedule();
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    this.cancel();
    this.emit();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  stepFrames(frames: number): void {
    this.pause();
    // Snap to the frame grid first: stepping from a scrubbed 3.817 s must
    // land on a frame boundary, not 3.817 + 1/fps.
    const index = Math.round(this.time * this.fps) + frames;
    const next = Math.min(Math.max(index / this.fps, 0), this.duration);
    if (next === this.time) return;
    this.time = next;
    this.emit();
  }

  setRate(rate: number): void {
    if (rate === this.rate) return;
    this.rate = rate;
    this.emit();
  }

  setLoop(mode: LoopMode): void {
    if (mode === this.loop) return;
    this.loop = mode;
    this.emit();
  }

  setLoopWindow(window: [number, number] | null): void {
    this.loopWindow = window;
    if (this.loop === "beat") this.emit();
  }

  getLoopWindow(): [number, number] | null {
    return this.loopWindow;
  }

  /** Re-clamp after the shot (and therefore the duration) changed. */
  rebind(duration: number, fps: number): void {
    this.duration = duration;
    this.fps = fps;
    if (this.time > duration) {
      this.time = duration;
      this.emit();
    }
  }

  dispose(): void {
    this.cancel();
    this.listeners.clear();
  }

  private schedule(): void {
    if (typeof requestAnimationFrame === "undefined") return;
    this.raf = requestAnimationFrame(this.tick);
  }

  private cancel(): void {
    if (this.raf !== null && typeof cancelAnimationFrame !== "undefined") {
      cancelAnimationFrame(this.raf);
    }
    this.raf = null;
  }

  private tick = (): void => {
    if (!this.playing) return;
    const current = now();
    const delta = ((current - this.last) / 1000) * this.rate;
    this.last = current;
    const [from, to] = this.window();
    let next = this.time + delta;
    if (next >= to) {
      if (this.loop === "off") {
        next = to;
        this.playing = false;
        this.cancel();
      } else {
        const span = Math.max(to - from, 1 / this.fps);
        next = from + ((next - to) % span);
      }
    }
    this.time = next;
    this.emit();
    if (this.playing) this.schedule();
  };
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/**
 * The shot's clock. One instance per mounted viewer; `duration` and `fps`
 * follow the selected shot without tearing the object down, so a lane's
 * subscription survives a shot switch.
 */
export function usePlayhead(duration: number, fps: number): Clock {
  const ref = useRef<Playhead | null>(null);
  if (!ref.current) ref.current = new Playhead(duration, fps);
  const clock = ref.current;

  useEffect(() => {
    clock.rebind(duration, fps);
  }, [clock, duration, fps]);

  useEffect(() => () => clock.dispose(), [clock]);

  return clock;
}

/** Subscribe to the clock from a component that displays the number. */
export function useClock(clock: Clock): ClockSnapshot {
  const [snapshot, setSnapshot] = useState<ClockSnapshot>(() => clock.getSnapshot());
  useEffect(() => clock.subscribe(setSnapshot), [clock]);
  return snapshot;
}

/**
 * Drive one `<video>` from the clock.
 *
 * `laneDuration` is what ffprobe measured for THIS file; when it is shorter
 * than the shot, the element holds its last frame instead of looping or
 * blanking. `enabled` is false for a lane that is not on screen — a hidden
 * video that keeps playing costs a decoder for nothing.
 */
export function useVideoClock(
  clock: Clock,
  video: HTMLVideoElement | null,
  laneDuration: number | null,
  enabled: boolean,
): void {
  useEffect(() => {
    if (!video || !enabled) return;
    const end = laneDuration ?? clock.duration;
    // The last addressable instant of this file. Seeking exactly to the
    // duration lands past the final frame in some decoders and shows black.
    const lastFrame = Math.max(0, end - 0.5 / Math.max(clock.fps, 1));

    const apply = ({ time, playing, rate }: ClockSnapshot) => {
      const target = Math.min(time, lastFrame);
      video.playbackRate = rate;
      if (!playing || time > end) {
        if (!video.paused) video.pause();
        if (Math.abs(video.currentTime - target) > 1e-3) video.currentTime = target;
        return;
      }
      if (video.paused) {
        video.currentTime = target;
        void video.play().catch(() => {
          /* autoplay refused (unmuted lane before a gesture) — the frame
             still tracks the clock through the drift correction below */
        });
      } else if (Math.abs(video.currentTime - target) > DRIFT_FRAMES / Math.max(clock.fps, 1)) {
        video.currentTime = target;
      }
    };

    const unsubscribe = clock.subscribe(apply);
    return () => {
      unsubscribe();
      video.pause();
    };
  }, [clock, video, laneDuration, enabled]);
}

/**
 * The track conductor (T10-5) — the second `NarrationClock`, over ONE
 * continuous pre-mixed file instead of one clip at a time.
 *
 * It exists to delete a seam rather than manage it. `audio-conductor.ts`
 * reuses a single element and swaps `src` at every clip change, so the
 * first sound of every clip is asked for at `readyState 0` (measured: 4 of
 * 4 starts) and the opening syllable is lost. Here the src is set ONCE,
 * when the program is installed, and never touched again while the board
 * plays: `preload="auto"` finally applies to the thing that will actually
 * be played, and a clip's first sample is already decoded long before the
 * pen reaches it.
 *
 * The contract with the gate is unchanged — that is the point. The gate
 * projects `t = window.start + audio.time` from a per-clip snapshot, so
 * this conductor reports the element's position RELATIVE to whichever clip
 * the track is currently inside (`clipAtTrackTime`). Holds, pins, rate
 * rules and every degradation path therefore behave exactly as they do on
 * the per-clip path, and `clock-gate.ts` needed no change at all.
 *
 * Three rules are this module's own:
 *
 *  - **The element is never paused for silence.** A gap between clips is
 *    part of the file. Pausing there would put the seam back.
 *  - **Drift is repaired only in silence, and never near a clip.** rAF and
 *    the audio hardware are different oscillators, and a backgrounded tab
 *    throttles one of them; when the two disagree the element is seeked to
 *    where the canonical playhead says it should be. That seek costs a
 *    decode, which is exactly what eats a syllable — so it is allowed only
 *    where no voice is sounding AND no clip starts within `ALIGN_GUARD`.
 *    Inside a clip the gate's own monotonic projection absorbs the
 *    difference instead (it freezes the picture; it never rewinds it).
 *  - **`ended` is a position, not an event.** One file fires `ended` once,
 *    at the very end. A clip is over when the track has passed its last
 *    sample, which `clipAtTrackTime` reports by returning null — the gate
 *    then falls back to rAF, exactly as it does when a per-clip element
 *    ends.
 *
 * Hot-path discipline matches the per-clip conductor: `frame()` runs once
 * per rAF and every DOM write is guarded behind a real state change.
 */

import {
  canonicalToTrack,
  clipAtTrackTime,
  type TrackClip,
  type TrackLayout,
} from "../narration/track.js";
import type { ClipWindow } from "../narration/timing.js";
import type {
  AudioElementLike,
  GestureTargetLike,
  NarrationDegradation,
} from "./audio-conductor.js";
import {
  NARRATION_MAX_RATE,
  type AudioClockSnapshot,
  type NarrationClock,
} from "./clock-gate.js";

export interface TrackConductorOptions {
  /** Workspace-relative track path → fetchable URL (`/api/file?path=…`). */
  resolveUrl(workspacePath: string): string;
  /** Injectable for tests; defaults to `new Audio()` when available. */
  createElement?(): AudioElementLike | null;
  /** Injectable for tests; defaults to `document` when available. */
  gestureTarget?: GestureTargetLike | null;
}

/**
 * Track seconds the element may differ from where the canonical playhead
 * says it should be before a silence-time seek repairs it. Well above
 * ordinary oscillator skew over a lecture, well below anything an ear
 * pairs with a moving pen.
 */
const DRIFT_TOLERANCE = 0.08;

/**
 * How close a clip may be before a repair seek is refused. A seek drops
 * the decoded buffer, and a buffer refilled under a clip's opening word is
 * the exact defect this whole path exists to remove — so near a clip the
 * drift is left to the gate, which is built to absorb it.
 */
const ALIGN_GUARD = 0.75;

/** Wall seconds a claimed-playing element may stand still before the board stops waiting. */
const STALL_GRACE = 0.25;

export class TrackConductor implements NarrationClock {
  private layout: TrackLayout | null = null;
  private windowByHash = new Map<string, ClipWindow>();
  private element: AudioElementLike | null = null;
  /** The URL currently on the element — the ONE thing that may set `src`. */
  private loadedUrl: string | null = null;
  private blocked = false;
  private failed = false;
  private rate = 1;
  private wantsPlay = false;
  private gestureArmed = false;
  private readonly blockedListeners = new Set<(blocked: boolean) => void>();
  private readonly degradedListeners = new Set<
    (degradation: NarrationDegradation) => void
  >();
  private readonly gestureTarget: GestureTargetLike | null;
  private lastElementTime = -1;
  private stallSeconds = 0;
  private stallReported = false;

  constructor(private readonly opts: TrackConductorOptions) {
    this.gestureTarget =
      opts.gestureTarget !== undefined
        ? opts.gestureTarget
        : typeof document !== "undefined"
          ? document
          : null;
  }

  /**
   * Install the verified track. `windows` are the LIVE compile's clip
   * windows (the caller has already checked the layout against them —
   * `verifyTrack`); `layout` is what the file actually contains.
   *
   * The src is set here and only here. A recompile that keeps the same
   * track path leaves the element completely untouched — that is the
   * seamless-across-appends guarantee, and here it is free.
   */
  setProgram(
    layout: TrackLayout | null,
    windows: readonly ClipWindow[],
    trackPath: string | null,
  ): void {
    this.layout = layout;
    this.windowByHash = new Map(windows.map((w) => [w.hash, w]));
    if (layout === null || trackPath === null) {
      this.silence();
      this.loadedUrl = null;
      return;
    }
    const url = this.opts.resolveUrl(trackPath);
    if (url === this.loadedUrl) return;
    this.loadedUrl = url;
    this.failed = false;
    const el = this.ensureElement();
    if (el) el.src = url;
  }

  // ── NarrationClock ───────────────────────────────────────────────────────

  frame(
    t: number,
    rate: number,
    dt = 0,
  ): { window: ClipWindow | null; audio: AudioClockSnapshot | null } {
    this.rate = rate;
    if (rate > NARRATION_MAX_RATE) {
      // Rule 6 — a skimming reader has no voice, and no browser agrees on
      // what `playbackRate = 16` means. The element stops rather than
      // being asked for a rate it will not honour.
      this.silence();
      return { window: null, audio: null };
    }
    const layout = this.layout;
    const el = this.element;
    if (!layout || !el || this.failed) return { window: null, audio: null };
    if (el.playbackRate !== rate) el.playbackRate = rate;

    this.wantsPlay = true;
    if (el.paused && !this.blocked) this.startPlay(el);

    const tt = el.currentTime;
    const stalled = this.trackStall(el, tt, dt);
    const clip = clipAtTrackTime(layout, tt);
    if (!clip) {
      // Silence between clips: the file keeps running (never paused — the
      // gap is part of the track) and rAF is master. This is the ONE place
      // a repair seek is allowed.
      this.alignInSilence(el, layout, t, tt);
      return { window: null, audio: null };
    }
    const window = this.windowByHash.get(clip.hash);
    if (!window) return { window: null, audio: null };
    return {
      window,
      audio: {
        hash: clip.hash,
        time: tt - clip.offset / layout.sampleRate,
        sounding: !el.paused && !this.blocked && !stalled,
        ended: false,
      },
    };
  }

  seek(t: number, playing: boolean): void {
    if (this.rate > NARRATION_MAX_RATE) {
      this.silence();
      return;
    }
    const layout = this.layout;
    const el = this.element;
    if (!layout || !el || this.failed) return;
    // An explicit navigation is the one moment a seek is EXPECTED — the
    // user moved the playhead, and the decode gap lands under their own
    // gesture rather than under a word.
    el.currentTime = canonicalToTrack(layout, t);
    this.clearStall();
    this.wantsPlay = playing;
    // Playing seeks run inside the user's gesture (scrub / play-from /
    // Live) — this synchronous play() is what unlocks strict autoplay.
    if (playing) this.startPlay(el);
    else if (!el.paused) el.pause();
  }

  resume(t: number): void {
    if (this.rate > NARRATION_MAX_RATE) {
      this.silence();
      return;
    }
    const el = this.element;
    if (!el || !this.layout || this.failed) return;
    // The element continues from its OWN clock: nothing moved while the
    // board was paused, so element and playhead are still the pair they
    // were — and paused mid-hold the element deliberately sits ahead of
    // the pinned canonical time (re-deriving it would replay heard voice).
    this.wantsPlay = true;
    this.startPlay(el);
    void t;
  }

  pause(): void {
    this.wantsPlay = false;
    this.quiet();
    this.clearStall();
  }

  setRate(rate: number): void {
    this.rate = rate;
    if (rate > NARRATION_MAX_RATE) {
      this.silence();
      return;
    }
    const el = this.element;
    if (el && el.playbackRate !== rate) el.playbackRate = rate;
  }

  // ── Autoplay policy surface (the chip) ───────────────────────────────────

  isBlocked(): boolean {
    return this.blocked;
  }

  onBlocked(listener: (blocked: boolean) => void): () => void {
    this.blockedListeners.add(listener);
    listener(this.blocked);
    return () => {
      this.blockedListeners.delete(listener);
    };
  }

  onDegraded(listener: (degradation: NarrationDegradation) => void): () => void {
    this.degradedListeners.add(listener);
    return () => {
      this.degradedListeners.delete(listener);
    };
  }

  /** Called from a real user gesture (the chip): clear the latch and sound. */
  unlock(): void {
    this.disarmGestureRetry();
    this.setBlocked(false);
    const el = this.element;
    if (this.wantsPlay && el && el.paused) this.startPlay(el);
  }

  dispose(): void {
    this.disarmGestureRetry();
    const el = this.element;
    if (el) {
      if (!el.paused) el.pause();
      el.removeEventListener("error", this.onError);
    }
    this.element = null;
    this.loadedUrl = null;
    this.blockedListeners.clear();
    this.degradedListeners.clear();
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private ensureElement(): AudioElementLike | null {
    if (this.element) return this.element;
    const created = this.opts.createElement
      ? this.opts.createElement()
      : typeof Audio !== "undefined"
        ? (new Audio() as AudioElementLike)
        : null;
    if (!created) return null;
    // The whole reason this class exists: one src, buffered from the
    // moment the board loads, so no clip is ever asked to start cold.
    created.preload = "auto";
    created.addEventListener("error", this.onError);
    this.element = created;
    return created;
  }

  /**
   * Keep the element honest against the canonical playhead — but only
   * where a seek costs nothing audible. See ALIGN_GUARD.
   */
  private alignInSilence(
    el: AudioElementLike,
    layout: TrackLayout,
    t: number,
    tt: number,
  ): void {
    const expected = canonicalToTrack(layout, t);
    if (Math.abs(expected - tt) <= DRIFT_TOLERANCE) return;
    const next = this.nextClipStart(layout, Math.min(expected, tt));
    if (next !== null && next - Math.max(expected, tt) < ALIGN_GUARD) return;
    el.currentTime = expected;
    this.clearStall();
  }

  /** Track second the first clip at or after `tt` begins, or null. */
  private nextClipStart(layout: TrackLayout, tt: number): number | null {
    for (const clip of layout.clips) {
      const start = clip.offset / layout.sampleRate;
      if (start >= tt) return start;
    }
    return null;
  }

  /**
   * "Not paused" is a claim, not a fact: a buffering element keeps playing
   * state while its clock stands still and fires no error. Past the grace
   * the snapshot stops reporting `sounding`, the gate returns to rAF and
   * the board plays on rather than freezing on a voice that never comes.
   */
  private trackStall(el: AudioElementLike, tt: number, dt: number): boolean {
    if (!el.paused && !this.blocked) {
      if (tt === this.lastElementTime) this.stallSeconds += dt;
      else {
        this.stallSeconds = 0;
        this.stallReported = false;
      }
    } else {
      this.stallSeconds = 0;
      this.stallReported = false;
    }
    this.lastElementTime = tt;
    const stalled = this.stallSeconds >= STALL_GRACE;
    if (stalled && !this.stallReported) {
      this.stallReported = true;
      console.warn(
        "[bansho] narration track stalled — the board plays on without waiting",
      );
      this.notifyDegraded("track", "stalled");
    }
    return stalled;
  }

  private quiet(): void {
    const el = this.element;
    if (el && !el.paused) el.pause();
  }

  private silence(): void {
    this.wantsPlay = false;
    this.quiet();
    this.clearStall();
  }

  private clearStall(): void {
    this.lastElementTime = -1;
    this.stallSeconds = 0;
    this.stallReported = false;
  }

  private startPlay(el: AudioElementLike): void {
    el.play().then(
      () => {
        this.setBlocked(false);
      },
      (err: unknown) => {
        const name = (err as { name?: string } | null)?.name;
        if (name === "NotAllowedError") {
          this.setBlocked(true);
          this.armGestureRetry();
        } else if (name !== "AbortError") {
          // A track that cannot start takes the whole voice with it — so
          // it degrades LOUDLY (the host falls back to per-clip playback
          // on this signal) instead of muting one step.
          this.failed = true;
          console.warn("[bansho] narration track failed to start:", err);
          this.notifyDegraded("track", "failed");
        }
      },
    );
  }

  private setBlocked(next: boolean): void {
    if (this.blocked === next) return;
    this.blocked = next;
    for (const listener of this.blockedListeners) listener(next);
  }

  private readonly onGesture = (): void => {
    this.unlock();
  };

  private armGestureRetry(): void {
    if (this.gestureArmed || !this.gestureTarget) return;
    this.gestureArmed = true;
    this.gestureTarget.addEventListener("pointerdown", this.onGesture);
    this.gestureTarget.addEventListener("keydown", this.onGesture);
  }

  private disarmGestureRetry(): void {
    if (!this.gestureArmed || !this.gestureTarget) return;
    this.gestureArmed = false;
    this.gestureTarget.removeEventListener("pointerdown", this.onGesture);
    this.gestureTarget.removeEventListener("keydown", this.onGesture);
  }

  private readonly onError = (): void => {
    this.failed = true;
    console.warn(
      "[bansho] narration track failed to load — falling back to per-clip playback",
    );
    this.notifyDegraded("track", "failed");
  };

  /** Whether the track has given up (the host's cue to fall back). */
  hasFailed(): boolean {
    return this.failed;
  }

  private notifyDegraded(
    hash: string,
    reason: NarrationDegradation["reason"],
  ): void {
    for (const listener of this.degradedListeners) listener({ hash, reason });
  }
}

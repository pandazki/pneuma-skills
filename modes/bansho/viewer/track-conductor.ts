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
import {
  HAVE_METADATA,
  type AudioElementLike,
  type GestureTargetLike,
  type NarrationDegradation,
} from "./audio-conductor.js";
import {
  narrationAudibleAtRate,
  type AudioClockSnapshot,
  type NarrationClock,
} from "./clock-gate.js";
import type { VoiceOutput } from "./voice-output.js";

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

export class TrackConductor implements NarrationClock, VoiceOutput {
  private layout: TrackLayout | null = null;
  private windowByHash = new Map<string, ClipWindow>();
  private element: AudioElementLike | null = null;
  /**
   * The track this board WANTS loaded — set by `setProgram` and kept
   * across a teardown, which is what lets an unmute (or a return into the
   * rate band) reinstall the src without the host recompiling.
   */
  private trackUrl: string | null = null;
  /** The URL actually on the element — null whenever there is no element. */
  private loadedUrl: string | null = null;
  /**
   * The element exists but has not been placed at the canonical playhead
   * yet. True from the moment an element is (re)created until a frame
   * finds it at `HAVE_METADATA` and seeks it — until then the conductor
   * reports no audio and stays silent, because a fresh element sits at 0
   * and playing it would sound the opening of the lecture under whatever
   * the pen is actually writing.
   */
  private needsResync = false;
  /**
   * The SILENT METRONOME (see `setMuted`). While the listener has muted
   * the board there is no element, but the lecture must keep its shape —
   * so the conductor keeps counting the track's clock itself, in track
   * seconds, advancing exactly as the element would have.
   */
  private virtualTrackTime = 0;
  /** Whether `virtualTrackTime` has been placed since the metronome took over. */
  private virtualPrimed = false;
  private blocked = false;
  private failed = false;
  private rate = 1;
  private wantsPlay = false;
  /** The listener's own silence (`VoiceOutput`) — see `setMuted`. */
  private muted = false;
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
      this.trackUrl = null;
      this.silence();
      return;
    }
    const url = this.opts.resolveUrl(trackPath);
    if (url === this.trackUrl) return;
    this.trackUrl = url;
    this.failed = false;
    // A different file is a different clock: whatever is loaded is wrong.
    this.releaseElement();
    // Installed only if the voice is wanted at all — a board opened muted,
    // or opened at 2×, downloads nothing.
    this.ensureLoaded();
  }

  // ── NarrationClock ───────────────────────────────────────────────────────

  frame(
    t: number,
    rate: number,
    dt = 0,
  ): { window: ClipWindow | null; audio: AudioClockSnapshot | null } {
    if (rate !== this.rate) {
      this.rate = rate;
      // Rule 6 — outside the band there is no voice, and no browser agrees
      // on what `playbackRate = 16` means. The element is not merely
      // stopped, it is released: nothing decodes, nothing downloads.
      this.reconcile();
    }
    // Outside the band the conductor is INERT — no window, no clock, no
    // pin. That is rule 6's deliberate consequence (a ten-minute clip must
    // not pin a board being skimmed), and it is why the band and the mute
    // do not share this exit.
    if (!narrationAudibleAtRate(rate)) return { window: null, audio: null };
    const layout = this.layout;
    if (!layout || this.failed) return { window: null, audio: null };
    if (this.muted) return this.metronomeFrame(layout, t, rate, dt);
    const el = this.ensureLoaded();
    if (!el) return { window: null, audio: null };
    if (el.playbackRate !== rate) el.playbackRate = rate;

    // A just-installed element is at 0 and knows nothing. Until metadata
    // lands there is no `seekable` to clamp into, so a `currentTime` write
    // would be silently dropped and `play()` would sound the opening word
    // over the middle of the lecture. rAF stays master for those frames.
    if (this.needsResync) {
      if (el.readyState < HAVE_METADATA) return { window: null, audio: null };
      el.currentTime = canonicalToTrack(layout, t);
      this.needsResync = false;
      this.clearStall();
    }

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
    if (!narrationAudibleAtRate(this.rate)) {
      this.silence();
      return;
    }
    const layout = this.layout;
    if (!layout || this.failed) return;
    if (this.muted) {
      // The metronome is a clock too, and an explicit navigation moves it
      // exactly as it moves the element — otherwise unmuting after a scrub
      // would find the lecture where it was before the scrub.
      this.virtualTrackTime = canonicalToTrack(layout, t);
      this.virtualPrimed = true;
      this.wantsPlay = playing;
      return;
    }
    const el = this.ensureLoaded();
    if (!el) return;
    this.wantsPlay = playing;
    if (el.readyState < HAVE_METADATA) {
      // Nothing to seek yet. The next frame carries the LIVE playhead and
      // positions it there, which is strictly better than remembering this
      // `t` — by the time metadata lands the board has moved on.
      this.needsResync = true;
      return;
    }
    // An explicit navigation is the one moment a seek is EXPECTED — the
    // user moved the playhead, and the decode gap lands under their own
    // gesture rather than under a word.
    el.currentTime = canonicalToTrack(layout, t);
    this.needsResync = false;
    this.clearStall();
    // Playing seeks run inside the user's gesture (scrub / play-from /
    // Live) — this synchronous play() is what unlocks strict autoplay.
    if (playing) this.startPlay(el);
    else if (!el.paused) el.pause();
  }

  resume(t: number): void {
    if (!narrationAudibleAtRate(this.rate)) {
      this.silence();
      return;
    }
    if (this.muted) {
      // The metronome never stopped counting anywhere it mattered; a
      // resume simply means frames start arriving again.
      this.wantsPlay = true;
      return;
    }
    const el = this.element;
    // No element (released while muted / out of band) or one not yet
    // placed: the next frame installs and positions it. Resuming a
    // fresh element here would sound the lecture's opening.
    if (!el || this.needsResync || !this.layout || this.failed) {
      this.wantsPlay = true;
      return;
    }
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
    if (rate === this.rate) return;
    this.rate = rate;
    this.reconcile();
    const el = this.element;
    if (el && el.playbackRate !== rate) el.playbackRate = rate;
  }

  // ── Voice output (the transport's mute) ──────────────────────────────────

  /**
   * The listener asked for silence — and on this path silence means the
   * track is LET GO, not merely turned down. A muted element would go on
   * downloading two megabytes and decoding them for nobody.
   *
   * What must not change is the lecture: the gate's holds are a function
   * of the compiled schedule, which already encodes every clip's duration,
   * so a released element leaves the pen waiting exactly as long as a
   * sounding one would have (`mute-seam.test.ts` pins that equality).
   * Unmuting mid-lecture reinstalls the file and places it at the
   * canonical playhead before a sound is made — never at 0.
   */
  setMuted(muted: boolean): void {
    if (muted === this.muted) return;
    this.muted = muted;
    const el = this.element;
    // Applied first so the moment between deciding and releasing is silent
    // even if the release itself is a frame away.
    if (el && el.muted !== muted) el.muted = muted;
    this.reconcile();
  }

  /**
   * Whether an ELEMENT should exist. Deliberately narrower than "is the
   * conductor participating": outside the band the conductor goes inert
   * (no clock, no pin), while muted it keeps clocking without an element.
   */
  private wantsElement(): boolean {
    return !this.muted && narrationAudibleAtRate(this.rate);
  }

  /**
   * Reconcile the element with `wantsElement()`. Called from every input
   * that can change the answer — the mute, the rate — so no caller has to
   * remember the teardown/reinstall dance.
   */
  private reconcile(): void {
    if (!narrationAudibleAtRate(this.rate)) {
      // Inert: neither an element nor a metronome. The next re-entry into
      // the band re-places whichever one it needs from the live playhead.
      this.virtualPrimed = false;
      this.silence();
      return;
    }
    if (!this.wantsElement()) {
      // Muted: the metronome takes over from exactly where the element
      // stood, so the lecture does not skip a beat at the handover.
      const el = this.element;
      if (el) {
        this.virtualTrackTime = el.currentTime;
        this.virtualPrimed = true;
      }
      this.silence();
      return;
    }
    // Coming back to sound: the next frame installs the file and places it
    // at the live playhead. Deliberately not done here — `setMuted` /
    // `setRate` are not told `t`, and guessing it is how the voice ends up
    // at 0, which is the defect this release exists to remove.
    this.virtualPrimed = false;
    if (!this.element) this.needsResync = true;
  }

  /**
   * One frame of the silent metronome — the muted board's clock.
   *
   * It reports the same snapshot shape an element would, so `clock-gate`
   * engages exactly as it does with sound: the same clip owns the same
   * canonical seconds, and a voice longer than its writing pins the pen
   * for precisely as long. That is what makes a muted lecture the SAME
   * lecture (`voice-output.ts`) even though nothing is loaded or decoded.
   *
   * Read-then-advance, in that order: the host advances a real element
   * BETWEEN frames, so counting first would put the metronome one frame
   * ahead of the voice it is standing in for.
   */
  private metronomeFrame(
    layout: TrackLayout,
    t: number,
    rate: number,
    dt: number,
  ): { window: ClipWindow | null; audio: AudioClockSnapshot | null } {
    if (!this.virtualPrimed) {
      this.virtualTrackTime = canonicalToTrack(layout, t);
      this.virtualPrimed = true;
    }
    const tt = this.virtualTrackTime;
    this.virtualTrackTime = tt + dt * rate;
    const clip = clipAtTrackTime(layout, tt);
    if (!clip) return { window: null, audio: null };
    const window = this.windowByHash.get(clip.hash);
    if (!window) return { window: null, audio: null };
    return {
      window,
      audio: {
        hash: clip.hash,
        time: tt - clip.offset / layout.sampleRate,
        // "Sounding" here means "this clip owns the clock", which is the
        // only thing the gate asks it. Nothing is audible; the listener
        // chose that, and the pacing is not theirs to change.
        sounding: true,
        ended: false,
      },
    };
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
    this.releaseElement();
    this.trackUrl = null;
    this.blockedListeners.clear();
    this.degradedListeners.clear();
  }

  // ── Internals ────────────────────────────────────────────────────────────

  /**
   * The element with this board's track on it, or null when there should
   * not be one. The ONLY place `src` is assigned.
   *
   * Idempotent and cheap: with the right file already loaded it is a
   * single reference return, which is what keeps the seamless-across-
   * appends guarantee (a recompile that keeps the track path never
   * touches the element) while letting an unmute reinstall it.
   */
  private ensureLoaded(): AudioElementLike | null {
    if (!this.wantsElement() || this.trackUrl === null) return null;
    if (this.element && this.loadedUrl === this.trackUrl) return this.element;
    const el = this.element ?? this.createElement();
    if (!el) return null;
    el.src = this.trackUrl;
    this.loadedUrl = this.trackUrl;
    // Deliberately NOT marking a resync here. A first install starts the
    // element and the lecture from their own natural positions, and
    // `alignInSilence` is the mechanism that has always reconciled them —
    // seeking on the opening frame would cost a decode for nothing, which
    // is the very thing this conductor exists to avoid. Only a RE-install
    // into a lecture already under way needs placing, and `reconcile` is
    // what knows that happened.
    return el;
  }

  private createElement(): AudioElementLike | null {
    const created = this.opts.createElement
      ? this.opts.createElement()
      : typeof Audio !== "undefined"
        ? (new Audio() as AudioElementLike)
        : null;
    if (!created) return null;
    // The whole reason this class exists: one src, buffered from the
    // moment the board loads, so no clip is ever asked to start cold.
    created.preload = "auto";
    created.muted = this.muted;
    created.addEventListener("error", this.onError);
    this.element = created;
    return created;
  }

  /**
   * Let the element go — the mechanism behind both the listener's mute
   * and the rate band.
   *
   * `removeAttribute("src")` + `load()` before dropping the reference is
   * the part that matters: without it the browser keeps streaming the
   * track to an object nobody holds, and "the voice is off" would still
   * cost the network everything it cost before.
   */
  private releaseElement(): void {
    const el = this.element;
    this.element = null;
    this.loadedUrl = null;
    this.needsResync = false;
    this.clearStall();
    if (!el) return;
    el.removeEventListener("error", this.onError);
    if (!el.paused) el.pause();
    el.removeAttribute("src");
    el.load();
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

  /** No voice is wanted: stop wanting one, and stop holding the file. */
  private silence(): void {
    this.wantsPlay = false;
    this.releaseElement();
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

/**
 * The audio conductor (T10-4) — the one DOM-facing piece of the voice
 * layer. It owns a single reusable audio element and keeps it truthful to
 * the clock gate's snapshot contract (`clock-gate.ts` — read its header
 * for the master rules; this module is their element-side half):
 *
 *  - **Audio aligns to the picture, never the reverse.** Before a clip
 *    sounds, the element is seeked to `t − window.start`; if it ever falls
 *    behind the playhead by more than `MAX_LAG` (accumulated play()
 *    latency), it is seeked FORWARD — the canonical clock is never yanked
 *    to meet the element.
 *  - **Content-addressed identity.** The loaded clip is keyed by step
 *    hash; a recompile that keeps the hash (every agent append) keeps the
 *    element untouched mid-word. Only a hash swap reloads.
 *  - **Failures degrade one clip at a time, never the board.** Autoplay
 *    rejection (NotAllowedError) latches `blocked` — playback continues
 *    silent, one page gesture (or the chip's `unlock()`) re-arms.
 *    A load/decode error mutes exactly that hash. An interrupted play
 *    start (AbortError — pause()/src swap racing a pending play()) is
 *    benign. Nothing throws into the rAF loop.
 *  - **Transport discipline.** A paused scrub aligns silently (no clip
 *    fragments while dragging); a plain resume continues the element from
 *    its OWN clock (paused mid-hold it is deliberately ahead of the
 *    pinned canonical time — re-deriving its offset would replay voice
 *    already heard); an ended clip is spent until an explicit seek
 *    re-arms it, so it can never replay on its own.
 *  - **Outside `NARRATION_RATE_BAND` the element is released, not
 *    stretched.** A rate no browser agrees on (see the constant) is never
 *    written to `playbackRate`; nor is the clip kept loaded, because a
 *    voice that will not be heard is not worth a download or a decoder.
 *    This is the element-side half of the gate's rule 6, and the
 *    listener's mute takes exactly the same path — one mechanism, two
 *    reasons. The gate refuses the projection independently, so neither
 *    side can be the only guard. Coming back re-enters through the
 *    ordinary path: the next frame loads the clip the playhead is inside
 *    and aligns it before sounding, so the voice resumes where the pen is
 *    rather than where the clip begins.
 *
 * Hot-path discipline: `frame()` runs once per rAF while playing — every
 * DOM write (src, currentTime, playbackRate, play/pause) is guarded
 * behind an actual state change.
 */

import { activeClipAt, type ClipWindow } from "../narration/timing.js";
import {
  narrationAudibleAtRate,
  type AudioClockSnapshot,
  type NarrationClock,
} from "./clock-gate.js";
import type { VoiceOutput } from "./voice-output.js";

/**
 * `HTMLMediaElement.HAVE_METADATA` — duration and `seekable` are known, so
 * a `currentTime` write will be honoured. Below it the seek algorithm has
 * an empty `seekable` to clamp into and the assignment is silently lost,
 * which is why a freshly installed element is never positioned (or played)
 * until it reaches this.
 */
export const HAVE_METADATA = 1;

/** The element surface the conductor drives (HTMLAudioElement satisfies it). */
export interface AudioElementLike {
  src: string;
  currentTime: number;
  playbackRate: number;
  readonly paused: boolean;
  readonly readyState: number;
  preload: string;
  /**
   * The listener's silence, applied while an element still exists — the
   * transient state between deciding to go quiet and letting the element
   * go. Output-stage only: it never stops the clock (see `voice-output.ts`
   * for why stopping it would change the lecture).
   */
  muted: boolean;
  play(): Promise<void>;
  pause(): void;
  /**
   * Abandon the current resource. `removeAttribute("src")` followed by
   * `load()` is the only sequence that actually stops an in-flight media
   * download; dropping the reference alone leaves the fetch running until
   * GC gets there, which is exactly what "the voice is off" must not mean.
   */
  removeAttribute(name: string): void;
  load(): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

/** Where the one-shot autoplay re-arm listens (document in production). */
export interface GestureTargetLike {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface AudioConductorOptions {
  /** Workspace-relative clip path → fetchable URL (`/api/file?path=…`). */
  resolveUrl(workspacePath: string): string;
  /** Injectable for tests; defaults to `new Audio()` when available. */
  createElement?(): AudioElementLike | null;
  /** Injectable for tests; defaults to `document` when available. */
  gestureTarget?: GestureTargetLike | null;
}

/**
 * How far the element may lag the playhead before it is seeked forward.
 * Ordinary play() latency is 1–3 frames (≤ ~50 ms) and is absorbed by the
 * gate freezing t; only a genuine stall crosses this and gets realigned.
 */
const MAX_LAG = 0.3;

/**
 * Wall-clock seconds an element may CLAIM to play without its clock
 * moving before the board stops waiting for it (M2). A buffering or
 * decode stall raises no error event and keeps `paused === false`, so
 * "not paused" must never be read as "advancing" — while the gate
 * projects a frozen clock, the canonical playhead freezes with it, and
 * the MAX_LAG recovery cannot see it (it compares the audio to a t that
 * IS the frozen audio time). Below MAX_LAG so a stall and a lag stay one
 * discipline; comfortably above ordinary play() start latency.
 */
const STALL_GRACE = 0.25;

/** One clip-level degradation, surfaced to the host (never silent). */
export interface NarrationDegradation {
  hash: string;
  reason: "failed" | "stalled";
}

export class AudioConductor implements NarrationClock, VoiceOutput {
  private windows: readonly ClipWindow[] = [];
  /** hash → its window (frame() is hot path — no per-frame scans). */
  private windowByHash = new Map<string, ClipWindow>();
  /** hash → workspace-relative clip path. */
  private files = new Map<string, string>();
  private element: AudioElementLike | null = null;
  private loadedHash: string | null = null;
  /**
   * The clip the element has actually been POSITIONED for. Distinct from
   * `loadedHash` because a just-assigned `src` knows nothing yet: below
   * `HAVE_METADATA` there is no `seekable` to clamp into and a
   * `currentTime` write is silently dropped, so the element would sound
   * the clip's opening under the middle of a step.
   */
  private alignedHash: string | null = null;
  /** Clips whose element errored — muted individually, never the board. */
  private readonly failed = new Set<string>();
  /** Clips that played to their end — spent until an explicit seek. */
  private readonly spent = new Set<string>();
  private blocked = false;
  /**
   * The transport's current rate. `frame()` is told it every call, but
   * `seek`/`resume` are not — and a Live jump or a play-from at 16× must
   * not blip one frame of voice before the next frame quiets it.
   */
  private rate = 1;
  /** Whether a gesture-unlock should start sound (last transport intent). */
  private wantsPlay = false;
  /**
   * The listener's own silence (`VoiceOutput`). Held here rather than only
   * on the element because the element is created lazily — a preference
   * restored on mount arrives before the first clip is ever asked for.
   */
  private muted = false;
  /**
   * The SILENT METRONOME (see `setMuted`) — seconds into `virtualHash`'s
   * clip. While muted there is no element, but the lecture keeps its
   * shape, so the conductor counts the clip's clock itself.
   */
  private virtualTime = 0;
  private virtualHash: string | null = null;
  private gestureArmed = false;
  private readonly blockedListeners = new Set<(blocked: boolean) => void>();
  private readonly degradedListeners = new Set<
    (degradation: NarrationDegradation) => void
  >();
  private readonly gestureTarget: GestureTargetLike | null;
  // ── Stall detection (M2) — see STALL_GRACE ──────────────────────────────
  /** The element clock as last observed by frame(); −1 = nothing observed. */
  private lastElementTime = -1;
  /** Wall-clock accumulated while the claimed-playing clock stood still. */
  private stallSeconds = 0;
  /** One warning per stall episode, cleared when the clock moves again. */
  private stallReported = false;

  constructor(private readonly opts: AudioConductorOptions) {
    this.gestureTarget =
      opts.gestureTarget !== undefined
        ? opts.gestureTarget
        : typeof document !== "undefined"
          ? document
          : null;
  }

  /**
   * A new compile landed. Same-hash clips keep their element untouched
   * (the seamless-across-appends guarantee); a vanished hash stops
   * sounding now; the per-clip latches are pruned to live hashes so they
   * stay bounded by the document.
   */
  setProgram(
    windows: readonly ClipWindow[],
    files: ReadonlyMap<string, string>,
  ): void {
    this.windows = windows;
    this.windowByHash = new Map(windows.map((w) => [w.hash, w]));
    this.files = new Map(files);
    if (this.loadedHash !== null && !this.files.has(this.loadedHash)) {
      this.quiet();
    }
    for (const latch of [this.failed, this.spent]) {
      for (const hash of [...latch]) {
        if (!this.files.has(hash)) latch.delete(hash);
      }
    }
  }

  /**
   * The window whose voice owns playhead `t`, runtime state included.
   * `activeClipAt` decides by POSITION — right for cold navigation, where
   * later windows win the one instant a hold's pen-down shares with the
   * next voiced window's start. But a clip already sounding mid-hold —
   * loaded, not spent, not failed, `t` still inside its `[start, holdAt]`
   * domain — keeps the board until its voice finishes: a long clip holds
   * a voiced next step's pen-down exactly as it holds an unvoiced one
   * (the contract in references/narration.md), and the handover happens
   * at the END of the voice, never at the touch of the boundary. `seek`
   * deliberately stays position-only: explicit navigation re-decides
   * ownership.
   */
  private activeWindowAt(t: number): ClipWindow | null {
    const picked = activeClipAt(this.windows, t);
    const held = this.loadedHash;
    if (held === null || picked?.hash === held) return picked;
    if (this.spent.has(held) || this.failed.has(held)) return picked;
    const w = this.windowByHash.get(held);
    if (!w || w.holdAt === null) return picked;
    return t >= w.start && t <= w.holdAt ? w : picked;
  }

  // ── NarrationClock ───────────────────────────────────────────────────────

  frame(
    t: number,
    rate: number,
    dt = 0,
  ): { window: ClipWindow | null; audio: AudioClockSnapshot | null } {
    if (rate !== this.rate) {
      this.rate = rate;
      this.reconcile();
    }
    // Outside the band the conductor is INERT — no clip owns any canonical
    // time, no pin binds (gate rule 6, and the reason a ten-minute clip
    // cannot deadlock a board being skimmed). The mute does NOT share this
    // exit: it keeps the clock and drops only the sound.
    if (!narrationAudibleAtRate(rate)) return { window: null, audio: null };
    if (this.muted) return this.metronomeFrame(t, rate, dt);
    const window = this.activeWindowAt(t);
    if (!window) {
      this.wantsPlay = false;
      this.quiet();
      return { window: null, audio: null };
    }
    const file = this.files.get(window.hash);
    if (file === undefined || this.failed.has(window.hash)) {
      // Missing or broken clip: rAF stays master, the board plays on.
      this.wantsPlay = false;
      this.quiet();
      return { window, audio: null };
    }
    const el = this.ensureElement();
    if (!el) return { window, audio: null };

    if (this.loadedHash !== window.hash) {
      this.loadedHash = window.hash;
      this.alignedHash = null;
      el.src = this.opts.resolveUrl(file);
    }
    if (this.alignedHash !== window.hash) {
      // Align BEFORE sounding — and only once the element can be aligned.
      // Until then rAF is master and the board plays on silently, which is
      // the same degradation a slow clip already produces.
      if (el.readyState < HAVE_METADATA) return { window, audio: null };
      el.currentTime = t - window.start;
      this.alignedHash = window.hash;
    }
    if (el.playbackRate !== rate) el.playbackRate = rate;

    if (this.spent.has(window.hash)) {
      // Already sounded to its end this pass (a hold's aftermath): the
      // remainder of the window belongs to rAF.
      this.wantsPlay = false;
      if (!el.paused) el.pause();
      return {
        window,
        audio: {
          hash: window.hash,
          time: el.currentTime,
          sounding: false,
          ended: true,
        },
      };
    }

    this.wantsPlay = true;
    if (el.paused && !this.blocked) this.startPlay(el);

    // ── Stall bookkeeping (M2) ──────────────────────────────────────────
    // "Not paused" is a claim, not a fact: a buffering element keeps
    // playing state while its clock stands still, and no error event ever
    // fires. Measure the claim against the observed clock; past the grace
    // the snapshot stops reporting `sounding`, the gate returns to rAF and
    // the board plays on — silent here is a WAIT (rule 3) only while it is
    // short. Any observed movement (its own progress or our seek) resets
    // the episode.
    if (!el.paused && !this.blocked) {
      if (el.currentTime === this.lastElementTime) {
        this.stallSeconds += dt;
      } else {
        this.stallSeconds = 0;
        this.stallReported = false;
      }
    } else {
      this.stallSeconds = 0;
      this.stallReported = false;
    }
    this.lastElementTime = el.currentTime;
    const stalled = this.stallSeconds >= STALL_GRACE;
    if (stalled && !this.stallReported) {
      this.stallReported = true;
      console.warn(
        `[bansho] narration clip stalled (${window.hash}) — the board plays on without waiting`,
      );
      this.notifyDegraded(window.hash, "stalled");
    }

    if (!el.paused && !stalled && window.start + el.currentTime < t - MAX_LAG) {
      // The voice fell behind the picture (start latency, or a stall just
      // recovered) — audio meets picture, never the reverse. Guarded off
      // while stalled: seeking a buffering element every frame is spam.
      el.currentTime = t - window.start;
      this.lastElementTime = el.currentTime;
    }
    return {
      window,
      audio: {
        hash: window.hash,
        time: el.currentTime,
        sounding: !el.paused && !this.blocked && !stalled,
        ended: false,
      },
    };
  }

  seek(t: number, playing: boolean): void {
    // Explicit navigation re-arms spent clips: scrubbing back into a
    // played window must sound again from that position. Done before the
    // skim check so dropping back to a listening rate finds the clips
    // around the new playhead armed.
    this.spent.clear();
    if (!narrationAudibleAtRate(this.rate)) {
      this.silence();
      return;
    }
    if (this.muted) {
      // The metronome is a clock too — an explicit navigation moves it
      // exactly as it moves the element.
      const w = activeClipAt(this.windows, t);
      this.virtualHash = w?.hash ?? null;
      this.virtualTime = w ? t - w.start : 0;
      this.wantsPlay = playing;
      return;
    }
    const window = activeClipAt(this.windows, t);
    const file = window ? this.files.get(window.hash) : undefined;
    if (!window || file === undefined || this.failed.has(window.hash)) {
      this.wantsPlay = false;
      this.quiet();
      return;
    }
    const el = this.ensureElement();
    if (!el) return;
    if (this.loadedHash !== window.hash) {
      this.loadedHash = window.hash;
      this.alignedHash = null;
      el.src = this.opts.resolveUrl(file);
    }
    this.wantsPlay = playing;
    if (el.readyState < HAVE_METADATA) {
      // Nothing to seek yet. The next frame carries the LIVE playhead and
      // positions it there — better than remembering this `t`, which the
      // board will have moved past by the time metadata lands.
      this.alignedHash = null;
      return;
    }
    el.currentTime = t - window.start;
    this.alignedHash = window.hash;
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
      this.wantsPlay = true;
      return;
    }
    const window = this.activeWindowAt(t);
    if (window && this.spent.has(window.hash)) return; // already heard
    const el = this.element;
    if (
      window &&
      el &&
      this.loadedHash === window.hash &&
      !this.failed.has(window.hash) &&
      this.files.has(window.hash)
    ) {
      // The element continues from its own clock — no re-seek (see header).
      this.wantsPlay = true;
      this.startPlay(el);
      return;
    }
    this.seek(t, true);
  }

  pause(): void {
    this.wantsPlay = false;
    this.quiet();
  }

  setRate(rate: number): void {
    if (rate === this.rate) return;
    this.rate = rate;
    // Never written to the element outside the band: `playbackRate = 16`
    // is not portable (clamped here, ignored there, muted elsewhere), and
    // the whole point of stepping aside is to depend on none of that.
    this.reconcile();
    const el = this.element;
    if (el && el.playbackRate !== rate) el.playbackRate = rate;
  }

  // ── Voice output (the transport's mute) ──────────────────────────────────

  /**
   * The listener asked for silence — and silence means the clip is LET GO,
   * not merely turned down. The lecture is unchanged either way: the
   * gate's holds come from the compiled schedule, which already encodes
   * every clip's duration, so a released element leaves the pen waiting
   * exactly as long as a sounding one would have (`mute-seam.test.ts`
   * pins that equality). Unmuting mid-lecture reloads the clip the
   * playhead is inside and aligns it before sounding.
   */
  setMuted(muted: boolean): void {
    if (muted === this.muted) return;
    this.muted = muted;
    const el = this.element;
    if (el && el.muted !== muted) el.muted = muted;
    this.reconcile();
  }

  /**
   * Whether an ELEMENT should exist. Narrower than "is the conductor
   * participating": outside the band it goes inert, while muted it keeps
   * clocking without an element.
   */
  private wantsElement(): boolean {
    return !this.muted && narrationAudibleAtRate(this.rate);
  }

  /** Reconcile the element with `wantsElement()` — every input funnels here. */
  private reconcile(): void {
    if (!narrationAudibleAtRate(this.rate)) {
      this.virtualHash = null;
      this.silence();
      return;
    }
    if (!this.wantsElement()) {
      // Muted: hand the clock to the metronome from exactly where the
      // element stood, so the lecture does not skip a beat at the handover.
      const el = this.element;
      if (el && this.loadedHash !== null) {
        this.virtualHash = this.loadedHash;
        this.virtualTime = el.currentTime;
      }
      this.silence();
      return;
    }
    // Coming back to sound: the next frame loads the clip the playhead is
    // inside and aligns it before sounding.
    this.virtualHash = null;
  }

  /**
   * One frame of the silent metronome — the muted board's clock.
   *
   * Reports the snapshot shape an element would, so `clock-gate` engages
   * exactly as it does with sound and a voice longer than its writing pins
   * the pen for precisely as long. That is what makes a muted lecture the
   * SAME lecture (`voice-output.ts`) with nothing loaded or decoded.
   *
   * Read-then-advance: the host advances a real element BETWEEN frames, so
   * counting first would put the metronome a frame ahead of the voice it
   * stands in for. The end of the clip is synthesized too — without it the
   * hold would never be released and a long clip would pin the board
   * forever.
   */
  private metronomeFrame(
    t: number,
    rate: number,
    dt: number,
  ): { window: ClipWindow | null; audio: AudioClockSnapshot | null } {
    const window = this.activeWindowAt(t);
    if (!window) {
      this.virtualHash = null;
      return { window: null, audio: null };
    }
    if (!this.files.has(window.hash) || this.failed.has(window.hash)) {
      // A missing clip is silent on this path too — same degradation the
      // sounding path reports, so muting cannot mask or invent one.
      return { window, audio: null };
    }
    if (this.virtualHash !== window.hash) {
      this.virtualHash = window.hash;
      this.virtualTime = t - window.start;
    }
    const time = this.virtualTime;
    if (this.spent.has(window.hash)) {
      return { window, audio: { hash: window.hash, time, sounding: false, ended: true } };
    }
    this.virtualTime = time + dt * rate;
    // The `ended` event the element would have fired, at the same frame.
    if (this.virtualTime >= window.audioSeconds) this.spent.add(window.hash);
    return {
      window,
      audio: { hash: window.hash, time, sounding: true, ended: false },
    };
  }

  // ── Autoplay policy surface (the chip) ───────────────────────────────────

  isBlocked(): boolean {
    return this.blocked;
  }

  /** Subscribe to the blocked latch; fires immediately with the current value. */
  onBlocked(listener: (blocked: boolean) => void): () => void {
    this.blockedListeners.add(listener);
    listener(this.blocked);
    return () => {
      this.blockedListeners.delete(listener);
    };
  }

  /**
   * Subscribe to per-clip degradations (a load/start failure, a buffering
   * stall). The host surfaces them — a muted voice must never pretend to
   * be a silent board. Fires once per episode, not per frame.
   */
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
    created.preload = "auto";
    // Born with the listener's choice already applied: the preference is
    // restored on mount, long before any clip asks for an element.
    created.muted = this.muted;
    created.addEventListener("ended", this.onEnded);
    created.addEventListener("error", this.onError);
    this.element = created;
    return created;
  }

  private quiet(): void {
    const el = this.element;
    if (el && !el.paused) el.pause();
  }

  /**
   * No voice is wanted here at all (muted, or outside the rate band) —
   * stop wanting one and let the element GO. Distinct from `quiet()`,
   * which merely pauses and is what an ordinary transport pause uses: a
   * paused board still intends to sound, and its element must survive so
   * `resume` can continue from its own clock.
   */
  private silence(): void {
    this.wantsPlay = false;
    this.releaseElement();
  }

  /**
   * Abandon the loaded clip. The `removeAttribute("src")` + `load()` pair
   * is what actually stops an in-flight download — dropping the reference
   * alone leaves the browser streaming audio to an object nobody holds.
   */
  private releaseElement(): void {
    const el = this.element;
    this.element = null;
    this.loadedHash = null;
    this.alignedHash = null;
    this.clearStall();
    if (!el) return;
    el.removeEventListener("ended", this.onEnded);
    el.removeEventListener("error", this.onError);
    if (!el.paused) el.pause();
    el.removeAttribute("src");
    el.load();
  }

  /** Forget the stall episode; `-1` can equal no element clock. */
  private clearStall(): void {
    this.lastElementTime = -1;
    this.stallSeconds = 0;
    this.stallReported = false;
  }

  // No pending-play guard on purpose: a successful play() flips `paused`
  // synchronously (so the per-frame `el.paused` check already stops spam),
  // and a NEWER intent — a scrub racing a pending start — must always win;
  // the loser start surfaces as a benign AbortError below.
  private startPlay(el: AudioElementLike): void {
    el.play().then(
      () => {
        this.setBlocked(false);
      },
      (err: unknown) => {
        const name = (err as { name?: string } | null)?.name;
        if (name === "NotAllowedError") {
          // Autoplay policy: degrade to a silent board and wait for one
          // real gesture. The latch also stops per-frame rejection spam.
          this.setBlocked(true);
          this.armGestureRetry();
        } else if (name !== "AbortError") {
          // AbortError is a pause()/src swap racing the start — benign.
          // Anything else is a real start failure: mute this clip alone.
          if (this.loadedHash !== null) {
            this.failed.add(this.loadedHash);
            console.warn(
              `[bansho] narration clip failed to start (${this.loadedHash}):`,
              err,
            );
            this.notifyDegraded(this.loadedHash, "failed");
          }
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

  private readonly onEnded = (): void => {
    if (this.loadedHash !== null) this.spent.add(this.loadedHash);
  };

  private readonly onError = (): void => {
    if (this.loadedHash === null) return;
    this.failed.add(this.loadedHash);
    console.warn(
      `[bansho] narration clip failed to load (${this.loadedHash}) — playing on without it`,
    );
    this.notifyDegraded(this.loadedHash, "failed");
  };

  private notifyDegraded(
    hash: string,
    reason: NarrationDegradation["reason"],
  ): void {
    for (const listener of this.degradedListeners) listener({ hash, reason });
  }
}

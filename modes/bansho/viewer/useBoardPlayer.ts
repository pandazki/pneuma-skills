/**
 * useBoardPlayer — the ONLY rAF holder in the bansho stack (G2: the engine
 * has no clock; `BoardTimeline.seek(t)` is a pure projection this hook
 * drives).
 *
 * Continuous state (`t`) lives in refs and reaches the DOM through frame
 * listeners (transport fill/clock write DOM directly) — React state holds
 * only the DISCRETE surface: the handle's `ui` (playing / rate / follow /
 * duration) plus the active schedule index for the 讲稿 highlight, which is
 * returned BESIDE the handle. The split matters: the index advances per
 * reveal unit (~15×/s during playback), and keeping it out of the handle
 * keeps the handle's identity stable across those advances — consumers
 * keyed on the handle (Timeline's frame subscription, memoized children)
 * see a new object only on a real transport transition, never per unit.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { BoardTimeline } from "../engine/types.js";
import type { CameraMotion } from "./camera-glide.js";
import { gatedTick, type NarrationClock } from "./clock-gate.js";
import {
  createPlayer,
  goLive,
  pause,
  playFrom,
  scrub,
  setRate,
  tick,
  timelineReplaced,
  togglePlay,
  type PlayerState,
  type Rate,
} from "./player-core.js";
import { activeScheduleIndex } from "./script-sync.js";

export type FrameListener = (t: number, duration: number) => void;
/**
 * `motion` is the seek's OWN channel speaking (task #213): a scrub drag
 * omits it and the camera TRACKS the dragged playhead (every tick a cut —
 * the settled rule); a navigation that means "take me there" (a locator
 * card click) passes `"glide"` and the camera walks. The hint rides the
 * seek fan-out because only the caller knows which gesture it is — the
 * playhead value alone cannot say.
 */
export type SeekListener = (t: number, motion?: CameraMotion) => void;

export interface BoardPlayerHandle {
  /** Discrete UI state — safe to render from, with ONE exception: `ui.t`
   *  is deliberately kept OUT of the change comparison (updating it per
   *  frame would re-render every frame), so it holds the playhead as of
   *  the last discrete transition and is stale during playback. Read the
   *  live playhead through `getT()` / `onFrame` instead. */
  ui: PlayerState;
  /** Current playhead (ref read — for imperative consumers). */
  getT(): number;
  /** Per-frame subscription for direct-DOM transport updates. */
  onFrame(listener: FrameListener): () => void;
  /**
   * Explicit transport navigation (scrub, keyboard seek, Live, the replay
   * jump) — fired AFTER the state applied, so the timeline is already
   * projected at the new playhead. The camera re-engages here (a scrub is
   * "show me this moment"; it supersedes a manual scroll). Stable identity
   * across renders — safe as an effect dependency.
   */
  onSeek(listener: SeekListener): () => void;
  togglePlay(): void;
  /**
   * Idempotent stop (C1′) — what a gesture calls. Grabbing the board must
   * halt the performance without any chance of starting it, so the board
   * host is given this and never `togglePlay`. Already paused: no-op, down
   * to leaving the voice alone.
   */
  pause(): void;
  /** `motion` reaches the seek listeners verbatim: omitted = a tracking
   *  scrub (cut); `"glide"` = an explicit "take me there" (locator card). */
  scrubTo(t: number, motion?: CameraMotion): void;
  /** `play-from` (§9): start playing at `t`, detached — the agent's replay. */
  playFrom(t: number): void;
  goLive(): void;
  /** Jump to a rung of the ladder (`RATES`) — the transport's rate menu. */
  setRate(rate: Rate): void;
}

export interface BoardPlayer {
  /** Identity-stable across index advances — changes only on ui transitions. */
  player: BoardPlayerHandle;
  /** Schedule entry the pen is on (讲稿 highlight anchor); -1 before pen-down. */
  activeIndex: number;
}

export function useBoardPlayer(
  timeline: BoardTimeline | null,
  /**
   * Where the FIRST compiled timeline joins: `true` = at the content tip
   * (opening an existing board — history is shown, not replayed); `false`
   * = at 0 (the board was empty when the workspace hydrated, so the first
   * compile IS the live broadcast, R2). Read once, at init.
   */
  joinAtTip = true,
  /**
   * Identity of the board being played (the active content set). When it
   * changes, the NEXT compiled timeline is a different board being OPENED —
   * it goes through `createPlayer` (join semantics, honoring `joinAtTip`)
   * instead of `timelineReplaced` (playhead-preserving recompile).
   */
  resetKey = "",
  /**
   * The voice layer (T10-4). When installed, the rAF loop runs through the
   * clock gate (`clock-gate.ts` — the master rules live there): a sounding
   * clip owns the canonical playhead inside its window, rAF owns it
   * everywhere else, and every explicit transport act keeps the element in
   * step (scrub aligns silently, resume continues, rate rides
   * `audio.playbackRate` so 倍速 never splits sound from picture). `null`
   * keeps the hook byte-identical to the silent player.
   */
  narration: NarrationClock | null = null,
): BoardPlayer {
  const stateRef = useRef<PlayerState>(createPlayer(0));
  const timelineRef = useRef<BoardTimeline | null>(null);
  const initializedRef = useRef(false);
  const joinAtTipRef = useRef(joinAtTip);
  joinAtTipRef.current = joinAtTip;
  const resetKeyRef = useRef(resetKey);
  if (resetKeyRef.current !== resetKey) {
    // Render-phase latch (idempotent ref writes): un-initialize before the
    // new set's first timeline arrives so it re-joins instead of inheriting
    // the previous board's playhead.
    resetKeyRef.current = resetKey;
    initializedRef.current = false;
  }
  const listenersRef = useRef(new Set<FrameListener>());
  const seekListenersRef = useRef(new Set<SeekListener>());
  const narrationRef = useRef<NarrationClock | null>(narration);
  narrationRef.current = narration;
  const [ui, setUi] = useState<PlayerState>(stateRef.current);
  const [activeIndex, setActiveIndex] = useState(-1);
  const activeIndexRef = useRef(-1);

  /** Apply a transition: seek the timeline, notify, mirror discrete state. */
  const apply = useCallback((next: PlayerState): void => {
    stateRef.current = next;
    const tl = timelineRef.current;
    if (tl) {
      tl.seek(next.t);
      const idx = activeScheduleIndex(tl.schedule, next.t);
      if (idx !== activeIndexRef.current) {
        activeIndexRef.current = idx;
        setActiveIndex(idx);
      }
    }
    for (const listener of listenersRef.current) {
      listener(next.t, next.duration);
    }
    // `t` matters to render only at discrete transition points (the
    // transport swaps play/replay icons at the end); duration/playing
    // cover those, so t itself stays out of the comparison.
    setUi((prev) =>
      prev.playing === next.playing &&
      prev.rate === next.rate &&
      prev.follow === next.follow &&
      prev.duration === next.duration
        ? prev
        : next,
    );
  }, []);

  /** Explicit-navigation fan-out — always after `apply` (state committed). */
  const notifySeek = useCallback((t: number, motion?: CameraMotion): void => {
    for (const listener of seekListenersRef.current) listener(t, motion);
  }, []);
  const onSeek = useCallback((listener: SeekListener) => {
    seekListenersRef.current.add(listener);
    return () => {
      seekListenersRef.current.delete(listener);
    };
  }, []);

  // Timeline (re)compiled — R2/R3/R4: adopt the new duration, keep the
  // playhead (live join on the very first compile).
  useEffect(() => {
    timelineRef.current = timeline;
    if (!timeline) return;
    if (!initializedRef.current) {
      initializedRef.current = true;
      apply(createPlayer(timeline.duration, joinAtTipRef.current));
      return;
    }
    apply(timelineReplaced(stateRef.current, timeline.duration));
  }, [timeline, apply]);

  // Whatever stopped playback — the pause button, a scrub, tick reaching a
  // detached end inside the loop — the voice must stop with it. The
  // explicit transport paths below already pause the conductor; this
  // covers the loop-internal transition (end-of-media), where no
  // imperative method runs. Idempotent, so double-pausing is free.
  const playing = ui.playing;
  useEffect(() => {
    if (!playing) narrationRef.current?.pause();
  }, [playing]);

  // The rAF clock — rate scales dt only; canonical time is never touched.
  useEffect(() => {
    if (!playing || !timeline) return;
    let raf = 0;
    let last = 0;
    const loop = (now: number): void => {
      const dt = last === 0 ? 0 : Math.min((now - last) / 1000, 0.05);
      last = now;
      if (dt > 0) {
        // Live hold at the tip: `tick` returns the IDENTICAL object (pinned
        // in player-core tests) — skip `apply` so an idle board does zero
        // seek/DOM work per frame. The loop keeps running (playing stays
        // true) so an append resumes ticking on the next frame.
        //
        // With a narration clock installed the frame goes through the
        // clock gate instead: the conductor keeps the right clip sounding
        // for the current playhead and reports the element facts;
        // `gatedTick` projects them (or falls back to `tick` wherever
        // audio is not actually sounding). Same identical-object
        // discipline — a pinned hold does zero work per frame.
        const s = stateRef.current;
        const clock = narrationRef.current;
        let next: PlayerState;
        if (clock) {
          // dt reaches the conductor too — its stall detector measures the
          // element's claimed playback against wall clock (M2).
          const { window, audio } = clock.frame(s.t, s.rate, dt);
          next = gatedTick(s, dt, window, audio);
        } else {
          next = tick(s, dt);
        }
        if (next !== s) apply(next);
      }
      if (stateRef.current.playing) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, timeline, apply]);

  // Imperative surface — memoized apart from `ui` so every method keeps a
  // stable identity for the whole life of the hook (apply/onSeek/notifySeek
  // are themselves stable useCallbacks).
  const controls = useMemo(
    () => ({
      getT: () => stateRef.current.t,
      onFrame(listener: FrameListener) {
        listenersRef.current.add(listener);
        listener(stateRef.current.t, stateRef.current.duration);
        return () => listenersRef.current.delete(listener);
      },
      onSeek,
      togglePlay: () => {
        // Toggling play at the end restarts from 0 — that jump is an
        // explicit navigation too (the camera should show the top).
        const before = stateRef.current.t;
        apply(togglePlay(stateRef.current));
        const s = stateRef.current;
        const clock = narrationRef.current;
        if (clock) {
          // Pause silences; the replay-from-0 jump is a real navigation
          // (seek); a plain resume continues the element from its OWN
          // clock — paused mid-hold it sits ahead of the pinned canonical
          // time, and re-deriving its offset would replay heard voice.
          if (!s.playing) clock.pause();
          else if (s.t !== before) clock.seek(s.t, true);
          else clock.resume(s.t);
        }
        if (s.t !== before) notifySeek(s.t);
      },
      pause: () => {
        // No seek: the playhead does not move, so this is not a
        // navigation — the camera stays exactly where the user is putting
        // it (the grab that called this is mid-flight). The voice stops
        // only if there was playback to stop; `pause` returns the
        // identical state otherwise, so a grab on a paused board is inert.
        const prev = stateRef.current;
        apply(pause(prev));
        if (stateRef.current !== prev) narrationRef.current?.pause();
      },
      scrubTo: (t: number, motion?: CameraMotion) => {
        apply(scrub(stateRef.current, t));
        // Align the voice to the new playhead WITHOUT sounding it — a
        // drag must not spray clip fragments (scrub always pauses).
        narrationRef.current?.seek(stateRef.current.t, false);
        notifySeek(stateRef.current.t, motion);
      },
      playFrom: (t: number) => {
        // Explicit navigation like a scrub — the camera re-engages on the
        // step being replayed, then playback carries it forward.
        const prev = stateRef.current;
        apply(playFrom(prev, t));
        // A refused address (non-finite t) returns the identical state —
        // it must not touch the voice either.
        if (stateRef.current !== prev) {
          narrationRef.current?.seek(stateRef.current.t, true);
        }
        notifySeek(stateRef.current.t);
      },
      goLive: () => {
        apply(goLive(stateRef.current));
        narrationRef.current?.seek(stateRef.current.t, true);
        notifySeek(stateRef.current.t);
      },
      setRate: (rate: Rate) => {
        apply(setRate(stateRef.current, rate));
        // 倍速 rides the element's own playbackRate — never only the rAF
        // dt — or the picture would speed up while the voice keeps 1×.
        // Past NARRATION_MAX_RATE that is no longer possible and the
        // conductor stops instead; the decision is its own (clock-gate
        // rule 6), so the transport hands over the rate either way.
        narrationRef.current?.setRate(stateRef.current.rate);
      },
    }),
    [apply, onSeek, notifySeek],
  );
  const player = useMemo<BoardPlayerHandle>(
    () => ({ ui, ...controls }),
    [ui, controls],
  );
  return { player, activeIndex };
}

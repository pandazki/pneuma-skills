import { useRef, useCallback, useEffect } from "react";
import { useClipCraft } from "../store/ClipCraftContext.js";
import { selectSortedScenes } from "../store/selectors.js";
import type { Scene } from "../../types.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Given sorted scenes and a globalTime, return { sceneIndex, localTime }. */
function resolveTime(scenes: Scene[], globalTime: number): { sceneIndex: number; localTime: number; cumulative: number } {
  let cumulative = 0;
  for (let i = 0; i < scenes.length; i++) {
    if (globalTime < cumulative + scenes[i].duration || i === scenes.length - 1) {
      return { sceneIndex: i, localTime: Math.max(0, globalTime - cumulative), cumulative };
    }
    cumulative += scenes[i].duration;
  }
  return { sceneIndex: 0, localTime: 0, cumulative: 0 };
}

// ── Hook ────────────────────────────────────────────────────────────────────

/**
 * Unified playback controller.
 *
 * Architecture:
 *  - During PLAYBACK: video.currentTime is the source of truth.
 *    rAF loop reads it and syncs to store (one-way: video → store).
 *  - During SEEK: store.globalTime is the source of truth.
 *    We detect external seeks and write to video (one-way: store → video).
 *  - A monotonic `seekGeneration` counter distinguishes our own rAF
 *    dispatches from user-initiated seeks via the timeline.
 *
 * This hook also manages the active video element — it receives a
 * videoRefs map from VideoPreview and handles element switching.
 */
export function usePlayback(videoRefs: React.RefObject<Map<string, HTMLVideoElement>>) {
  const { state, dispatch } = useClipCraft();

  const scenes = selectSortedScenes(state);
  const { playing, currentSceneIndex, globalTime } = state.playback;

  // Stable refs for use inside rAF / effects without causing re-runs
  const scenesRef = useRef(scenes);
  scenesRef.current = scenes;
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const sceneIndexRef = useRef(currentSceneIndex);
  sceneIndexRef.current = currentSceneIndex;

  // The currently-active video element
  const activeVideoRef = useRef<HTMLVideoElement | null>(null);

  // Seek generation: incremented by our rAF dispatches.
  // External seeks (timeline drag) won't increment this, so we can detect them.
  const seekGenRef = useRef(0);
  const lastDispatchedGenRef = useRef(0);

  // ── Actions ─────────────────────────────────────────────────────────────

  const play = useCallback(() => dispatch({ type: "PLAY" }), [dispatch]);
  const pause = useCallback(() => dispatch({ type: "PAUSE" }), [dispatch]);

  const togglePlay = useCallback(() => {
    if (playingRef.current) pause();
    else play();
  }, [play, pause]);

  const handleVideoEnd = useCallback(() => {
    const sorted = scenesRef.current;
    if (sceneIndexRef.current < sorted.length - 1) {
      dispatch({ type: "SCENE_ENDED" });
    } else {
      dispatch({ type: "PAUSE" });
    }
  }, [dispatch]);

  // ── Switch active video element when scene changes ──────────────────────
  //
  // Tracks the active scene by ID (not index) to handle both scene switching
  // and initial storyboard load (where index stays 0 but scene appears).

  const activeSceneIdRef = useRef<string | null>(null);

  // Derive the active scene ID from current index
  const activeSceneId = scenes[currentSceneIndex]?.id ?? null;

  useEffect(() => {
    if (!activeSceneId) return;
    const refs = videoRefs.current;
    if (!refs) return;

    // Only act if scene actually changed
    if (activeSceneId === activeSceneIdRef.current) return;
    const prevId = activeSceneIdRef.current;
    activeSceneIdRef.current = activeSceneId;

    // Pause previous video
    if (prevId) {
      const prevEl = refs.get(prevId);
      if (prevEl) {
        prevEl.pause();
        prevEl.currentTime = 0;
      }
    }

    // Activate new video
    const newEl = refs.get(activeSceneId);
    if (!newEl) return;
    activeVideoRef.current = newEl;

    // Bind onended: immediately start next video, THEN update store.
    // This bypasses the React render cycle for seamless transitions.
    newEl.onended = () => {
      const sorted = scenesRef.current;
      const idx = sorted.findIndex((s) => s.id === activeSceneId);
      if (idx >= 0 && idx < sorted.length - 1) {
        // Immediately activate next video (skip React)
        const nextScene = sorted[idx + 1];
        const nextEl = videoRefs.current?.get(nextScene.id);
        if (nextEl) {
          newEl.pause();
          newEl.currentTime = 0;
          nextEl.currentTime = 0;
          nextEl.play().catch(() => {});
          activeVideoRef.current = nextEl;
          activeSceneIdRef.current = nextScene.id;
        }
        // Then update store (triggers render, but video is already playing)
        dispatch({ type: "SCENE_ENDED" });
      } else {
        dispatch({ type: "PAUSE" });
      }
    };

    // Set correct local time from current globalTime
    const sorted = scenesRef.current;
    const { localTime } = resolveTime(sorted, globalTime);
    newEl.currentTime = localTime;

    if (playing) {
      newEl.play().catch(() => {});
    }
  }, [activeSceneId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Play/pause sync ─────────────────────────────────────────────────────

  useEffect(() => {
    const video = activeVideoRef.current;
    if (!video) return;
    if (playing) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [playing]);

  // ── Detect external seeks (from timeline) ───────────────────────────────
  //
  // When the rAF loop dispatches SEEK, it increments seekGenRef first.
  // When the store updates and this effect fires, if seekGenRef matches
  // lastDispatchedGenRef, the change came from us — skip.
  // If they differ, it's an external seek — write to video.

  useEffect(() => {
    if (seekGenRef.current !== lastDispatchedGenRef.current) {
      // This globalTime came from our rAF dispatch — don't write back to video
      lastDispatchedGenRef.current = seekGenRef.current;
      return;
    }

    // External seek: update video.currentTime
    const video = activeVideoRef.current;
    if (!video) return;
    const sorted = scenesRef.current;
    const { localTime } = resolveTime(sorted, globalTime);
    video.currentTime = localTime;
  }, [globalTime]);

  // ── rAF loop: video.currentTime → store (during playback) ──────────────

  useEffect(() => {
    if (!playing) return;

    let rafId: number;
    let lastDispatchTime = 0;
    const DISPATCH_INTERVAL = 100; // ms — ~10fps

    const tick = () => {
      if (!playingRef.current) return;

      const video = activeVideoRef.current;
      if (video) {
        const localTime = video.currentTime;
        let cumulative = 0;
        const sorted = scenesRef.current;
        for (let i = 0; i < sceneIndexRef.current && i < sorted.length; i++) {
          cumulative += sorted[i].duration;
        }
        const newGlobalTime = cumulative + localTime;

        const now = performance.now();
        if (now - lastDispatchTime >= DISPATCH_INTERVAL) {
          lastDispatchTime = now;
          // Mark this as our own dispatch so the seek effect ignores it
          seekGenRef.current++;
          dispatch({ type: "SEEK", globalTime: newGlobalTime });
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [playing, dispatch]);

  // ── Global space bar toggle ─────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;
      e.preventDefault();
      if (playingRef.current) pause();
      else play();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [play, pause]);

  return { activeVideoRef, playing, togglePlay, handleVideoEnd, play, pause };
}

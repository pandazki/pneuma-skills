import { useRef, useEffect, useMemo, useCallback, useState } from "react";
import { useClipCraftState } from "../store/ClipCraftContext.js";
import { selectSortedScenes, selectTotalDuration } from "../store/selectors.js";
import type { Scene, BGMConfig } from "../../types.js";

// ── Public interface ─────────────────────────────────────────────────────────

export interface AudioMixerState {
  ready: boolean;
  loading: number;
  total: number;
}

// ── Internals ────────────────────────────────────────────────────────────────

/** Resolve an asset path to its content URL. */
function assetUrl(source: string): string {
  return `/content/${source}`;
}

const VIDEO_EXT_RE = /\.(mp4|webm|mov)$/i;

/** Collect all audio URLs that need preloading from scenes + BGM. */
function collectAudioUrls(scenes: Scene[], bgm: BGMConfig | null): string[] {
  const urls: string[] = [];
  for (const scene of scenes) {
    // Only decode video files for their audio track (skip images)
    if (scene.visual?.source && scene.visual.status === "ready" && VIDEO_EXT_RE.test(scene.visual.source)) {
      urls.push(assetUrl(scene.visual.source));
    }
    if (scene.audio?.source && scene.audio.status === "ready") {
      urls.push(assetUrl(scene.audio.source));
    }
  }
  if (bgm?.source) {
    urls.push(assetUrl(bgm.source));
  }
  return urls;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useAudioMixer(): AudioMixerState {
  const state = useClipCraftState();
  const scenes = selectSortedScenes(state);
  const totalDuration = selectTotalDuration(state);
  const { playing, globalTime } = state.playback;
  const bgm = state.storyboard.bgm as BGMConfig | null;
  const { imageVersion } = state;

  // Lazy AudioContext — created once, reused across play/pause cycles.
  const ctxRef = useRef<AudioContext | null>(null);
  const getAudioContext = useCallback((): AudioContext => {
    if (!ctxRef.current) {
      ctxRef.current = new AudioContext();
    }
    return ctxRef.current;
  }, []);

  // Buffer cache keyed by URL. Cleared when imageVersion changes.
  const bufferCacheRef = useRef<Map<string, AudioBuffer>>(new Map());
  const cacheVersionRef = useRef<number>(-1);

  // Active source nodes for teardown.
  const activeNodesRef = useRef<AudioBufferSourceNode[]>([]);
  const activeGainRef = useRef<GainNode | null>(null);

  // Loading state.
  const [loading, setLoading] = useState(0);
  const [total, setTotal] = useState(0);
  const [ready, setReady] = useState(false);

  // Debounce seek timer.
  const seekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Snapshot refs for scheduling (avoids stale closures).
  const scenesRef = useRef(scenes);
  scenesRef.current = scenes;
  const bgmRef = useRef(bgm);
  bgmRef.current = bgm;
  const totalDurationRef = useRef(totalDuration);
  totalDurationRef.current = totalDuration;

  // ── Preload buffers ──────────────────────────────────────────────────────

  const urls = useMemo(
    () => collectAudioUrls(scenes, bgm),
    [scenes, bgm],
  );

  useEffect(() => {
    // Invalidate cache when files change on disk.
    if (cacheVersionRef.current !== imageVersion) {
      bufferCacheRef.current.clear();
      cacheVersionRef.current = imageVersion;
    }

    if (urls.length === 0) {
      setTotal(0);
      setLoading(0);
      setReady(true);
      return;
    }

    const ctx = getAudioContext();
    let cancelled = false;
    let loaded = 0;
    const toLoad = urls.filter((u) => !bufferCacheRef.current.has(u));

    if (toLoad.length === 0) {
      setTotal(urls.length);
      setLoading(0);
      setReady(true);
      return;
    }

    setTotal(urls.length);
    setLoading(toLoad.length);
    setReady(false);

    const load = async (url: string) => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        const arrayBuf = await res.arrayBuffer();
        const audioBuf = await ctx.decodeAudioData(arrayBuf);
        if (!cancelled) {
          bufferCacheRef.current.set(url, audioBuf);
        }
      } catch (err) {
        console.warn(`[AudioMixer] Failed to load ${url}:`, err);
      } finally {
        if (!cancelled) {
          loaded++;
          setLoading((prev) => Math.max(0, prev - 1));
        }
      }
    };

    Promise.all(toLoad.map(load)).then(() => {
      if (!cancelled) setReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, [urls, imageVersion, getAudioContext]);

  // ── Stop all active nodes ────────────────────────────────────────────────

  const stopAll = useCallback(() => {
    for (const node of activeNodesRef.current) {
      try {
        node.stop();
      } catch {
        // Already stopped or never started — safe to ignore.
      }
      node.disconnect();
    }
    activeNodesRef.current = [];
    if (activeGainRef.current) {
      activeGainRef.current.disconnect();
      activeGainRef.current = null;
    }
  }, []);

  // ── Schedule all audio from a given globalTime ───────────────────────────

  const scheduleFrom = useCallback(
    (fromTime: number) => {
      stopAll();

      const ctx = getAudioContext();
      const now = ctx.currentTime;
      const currentScenes = scenesRef.current;
      const currentBgm = bgmRef.current;
      const playDuration = totalDurationRef.current;

      // -- Scene audio (TTS + video audio tracks) --
      let sceneStart = 0;
      for (const scene of currentScenes) {
        const sceneEnd = sceneStart + scene.duration;

        // Collect audio sources for this scene.
        const sources: string[] = [];
        if (scene.visual?.source && scene.visual.status === "ready" && VIDEO_EXT_RE.test(scene.visual.source)) {
          sources.push(assetUrl(scene.visual.source));
        }
        if (scene.audio?.source && scene.audio.status === "ready") {
          sources.push(assetUrl(scene.audio.source));
        }

        for (const url of sources) {
          const buffer = bufferCacheRef.current.get(url);
          if (!buffer) continue;

          if (sceneEnd <= fromTime) {
            // Scene is in the past — skip.
            continue;
          }

          const sourceNode = ctx.createBufferSource();
          sourceNode.buffer = buffer;
          sourceNode.connect(ctx.destination);

          if (sceneStart <= fromTime && fromTime < sceneEnd) {
            // Currently within this scene — start from offset.
            sourceNode.start(0, fromTime - sceneStart);
          } else {
            // Scene is in the future — schedule ahead.
            sourceNode.start(now + (sceneStart - fromTime));
          }

          activeNodesRef.current.push(sourceNode);
        }

        sceneStart = sceneEnd;
      }

      // -- BGM with fade automation --
      if (currentBgm?.source) {
        const bgmUrl = assetUrl(currentBgm.source);
        const buffer = bufferCacheRef.current.get(bgmUrl);
        if (buffer) {
          const sourceNode = ctx.createBufferSource();
          sourceNode.buffer = buffer;

          const gain = ctx.createGain();
          sourceNode.connect(gain);
          gain.connect(ctx.destination);
          activeGainRef.current = gain;

          const volume = currentBgm.volume ?? 0.5;
          const fadeIn = currentBgm.fadeIn ?? 0;
          const fadeOut = currentBgm.fadeOut ?? 0;

          // Fade in
          if (fadeIn > 0 && fromTime < fadeIn) {
            gain.gain.setValueAtTime(volume * (fromTime / fadeIn), now);
            gain.gain.linearRampToValueAtTime(volume, now + (fadeIn - fromTime));
          } else {
            gain.gain.setValueAtTime(volume, now);
          }

          // Fade out
          if (fadeOut > 0) {
            const fadeOutStart = playDuration - fadeOut;
            if (fromTime < fadeOutStart) {
              gain.gain.setValueAtTime(volume, now + (fadeOutStart - fromTime));
              gain.gain.linearRampToValueAtTime(0, now + (playDuration - fromTime));
            } else if (fromTime < playDuration) {
              const fadeProgress = (fromTime - fadeOutStart) / fadeOut;
              gain.gain.setValueAtTime(volume * (1 - fadeProgress), now);
              gain.gain.linearRampToValueAtTime(0, now + (playDuration - fromTime));
            }
          }

          // Limit BGM to project duration (don't play beyond last scene)
          const bgmPlayDuration = Math.max(0, playDuration - fromTime);
          if (bgmPlayDuration > 0) {
            sourceNode.start(0, fromTime, bgmPlayDuration);
            activeNodesRef.current.push(sourceNode);
          }
        }
      }
    },
    [getAudioContext, stopAll],
  );

  // ── React to play/pause ──────────────────────────────────────────────────

  const wasPlayingRef = useRef(false);

  useEffect(() => {
    if (playing && !wasPlayingRef.current) {
      // Play started.
      const ctx = getAudioContext();
      ctx.resume().then(() => {
        scheduleFrom(globalTime);
        lastScheduledTimeRef.current = globalTime;
        scheduleTimestampRef.current = performance.now();
      });
    } else if (!playing && wasPlayingRef.current) {
      // Paused.
      stopAll();
    }
    wasPlayingRef.current = playing;
  }, [playing]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── React to seek while playing (debounced) ──────────────────────────────
  //
  // During normal playback, globalTime increments by ~0.1s every 100ms (rAF loop).
  // We must NOT reschedule on these small updates — audio is already scheduled ahead.
  // Only reschedule on user-initiated seeks (discontinuous jumps > 0.5s).

  const lastScheduledTimeRef = useRef<number>(-1);
  const scheduleTimestampRef = useRef<number>(0);

  useEffect(() => {
    if (!playing) {
      lastScheduledTimeRef.current = -1;
      scheduleTimestampRef.current = 0;
      return;
    }

    // Skip initial schedule (handled by play effect above).
    if (lastScheduledTimeRef.current === -1) {
      lastScheduledTimeRef.current = globalTime;
      scheduleTimestampRef.current = performance.now();
      return;
    }

    // Compute expected globalTime based on wall-clock elapsed since last schedule.
    const elapsed = (performance.now() - scheduleTimestampRef.current) / 1000;
    const expectedTime = lastScheduledTimeRef.current + elapsed;
    const drift = Math.abs(globalTime - expectedTime);

    // If drift is small (< 0.5s), this is normal playback flow — don't reschedule.
    if (drift < 0.5) return;

    // Large drift = user seek. Debounce and reschedule.
    if (seekTimerRef.current) {
      clearTimeout(seekTimerRef.current);
    }

    seekTimerRef.current = setTimeout(() => {
      stopAll();
      scheduleFrom(globalTime);
      lastScheduledTimeRef.current = globalTime;
      scheduleTimestampRef.current = performance.now();
      seekTimerRef.current = null;
    }, 200);

    return () => {
      if (seekTimerRef.current) {
        clearTimeout(seekTimerRef.current);
        seekTimerRef.current = null;
      }
    };
  }, [globalTime, playing, stopAll, scheduleFrom]);

  // ── Cleanup on unmount ───────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      stopAll();
      if (ctxRef.current) {
        ctxRef.current.close().catch(() => {});
        ctxRef.current = null;
      }
      if (seekTimerRef.current) {
        clearTimeout(seekTimerRef.current);
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { ready, loading, total };
}

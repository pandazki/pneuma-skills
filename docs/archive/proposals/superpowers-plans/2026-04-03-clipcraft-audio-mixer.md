# ClipCraft Audio Mixer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real-time multi-track audio mixing (video original audio + TTS + BGM) to ClipCraft preview playback via Web Audio API.

**Architecture:** A `useAudioMixer` hook creates a single AudioContext, preloads all audio sources as AudioBuffers, and schedules playback synchronized to the store's `playing`/`globalTime` state. Video elements are muted; all audio goes through the Web Audio graph.

**Tech Stack:** Web Audio API (AudioContext, AudioBufferSourceNode, GainNode), React hooks, TypeScript

---

## File Structure

| File | Responsibility |
|------|---------------|
| **Create:** `modes/clipcraft/viewer/hooks/useAudioMixer.ts` | Core hook — AudioContext lifecycle, buffer preloading, play/pause/seek scheduling, BGM gain automation |
| **Modify:** `modes/clipcraft/viewer/VideoPreview.tsx` | Integrate useAudioMixer, mute video elements |

---

### Task 1: Create `useAudioMixer` hook — buffer preloading

**Files:**
- Create: `modes/clipcraft/viewer/hooks/useAudioMixer.ts`

- [ ] **Step 1: Create the hook with AudioContext lifecycle and preloading**

Create `modes/clipcraft/viewer/hooks/useAudioMixer.ts`:

```ts
// modes/clipcraft/viewer/hooks/useAudioMixer.ts
import { useRef, useEffect, useState, useCallback } from "react";
import { useClipCraftState } from "../store/ClipCraftContext.js";
import { selectSortedScenes, selectTotalDuration } from "../store/selectors.js";
import type { Scene, BGMConfig } from "../../types.js";

export interface AudioMixerState {
  ready: boolean;
  loading: number;
  total: number;
}

interface ActiveSource {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

const VIDEO_EXT_RE = /\.(mp4|webm|mov)$/i;

/**
 * Collects all audio URLs that need preloading from scenes and BGM config.
 * Returns deduplicated list of `/content/{path}` URLs.
 */
function collectAudioUrls(scenes: Scene[], bgm: BGMConfig | null): string[] {
  const urls = new Set<string>();

  for (const scene of scenes) {
    // Video file audio track
    if (scene.visual?.status === "ready" && scene.visual.source && VIDEO_EXT_RE.test(scene.visual.source)) {
      urls.add(`/content/${scene.visual.source}`);
    }
    // TTS audio
    if (scene.audio?.status === "ready" && scene.audio.source) {
      urls.add(`/content/${scene.audio.source}`);
    }
  }

  // BGM
  if (bgm?.source) {
    urls.add(`/content/${bgm.source}`);
  }

  return [...urls];
}

export function useAudioMixer(): AudioMixerState {
  const state = useClipCraftState();
  const scenes = selectSortedScenes(state);
  const totalDuration = selectTotalDuration(state);
  const { playing, globalTime } = state.playback;
  const bgm = state.storyboard.bgm;

  // AudioContext — created lazily, reused across play/pause cycles
  const ctxRef = useRef<AudioContext | null>(null);
  const getCtx = useCallback(() => {
    if (!ctxRef.current) {
      ctxRef.current = new AudioContext();
    }
    return ctxRef.current;
  }, []);

  // Buffer cache: url → AudioBuffer
  const buffersRef = useRef<Map<string, AudioBuffer>>(new Map());

  // Active source nodes (stopped on pause/seek/unmount)
  const activeSourcesRef = useRef<ActiveSource[]>([]);

  // Preload state
  const [loadState, setLoadState] = useState<AudioMixerState>({ ready: true, loading: 0, total: 0 });

  // Track which URLs we've started loading to avoid duplicate fetches
  const loadingUrlsRef = useRef<Set<string>>(new Set());

  // Preload audio buffers when scenes/bgm change
  useEffect(() => {
    const urls = collectAudioUrls(scenes, bgm);
    const newUrls = urls.filter((u) => !buffersRef.current.has(u) && !loadingUrlsRef.current.has(u));

    if (newUrls.length === 0) {
      setLoadState({ ready: true, loading: 0, total: urls.length });
      return;
    }

    const ctx = getCtx();
    let cancelled = false;
    let completed = 0;

    setLoadState({ ready: false, loading: newUrls.length, total: urls.length });

    for (const url of newUrls) {
      loadingUrlsRef.current.add(url);

      fetch(url)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.arrayBuffer();
        })
        .then((buf) => ctx.decodeAudioData(buf))
        .then((audioBuffer) => {
          if (cancelled) return;
          buffersRef.current.set(url, audioBuffer);
          loadingUrlsRef.current.delete(url);
          completed++;
          const stillLoading = newUrls.length - completed;
          setLoadState({
            ready: stillLoading === 0,
            loading: stillLoading,
            total: urls.length,
          });
        })
        .catch((err) => {
          if (cancelled) return;
          console.warn(`[AudioMixer] Failed to load ${url}:`, err);
          loadingUrlsRef.current.delete(url);
          completed++;
          const stillLoading = newUrls.length - completed;
          setLoadState({
            ready: stillLoading === 0,
            loading: stillLoading,
            total: urls.length,
          });
        });
    }

    return () => { cancelled = true; };
  }, [scenes, bgm, getCtx]);

  // ── Scheduling ──────────────────────────────────────────────────────────────

  const stopAll = useCallback(() => {
    for (const s of activeSourcesRef.current) {
      try { s.source.stop(); } catch {}
      try { s.source.disconnect(); } catch {}
      try { s.gain.disconnect(); } catch {}
    }
    activeSourcesRef.current = [];
  }, []);

  const schedulePlayback = useCallback((fromTime: number) => {
    const ctx = ctxRef.current;
    if (!ctx) return;

    stopAll();
    const now = ctx.currentTime;
    const sources: ActiveSource[] = [];

    // Helper: create and schedule a source node
    const scheduleSource = (buffer: AudioBuffer, sceneStart: number, sceneDuration: number, volume: number = 1) => {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const gain = ctx.createGain();
      gain.gain.value = volume;
      source.connect(gain).connect(ctx.destination);

      const sceneEnd = sceneStart + sceneDuration;

      if (sceneEnd <= fromTime) {
        // Already past — skip
        source.disconnect();
        gain.disconnect();
        return;
      }

      if (sceneStart <= fromTime) {
        // Currently in this scene — play from offset
        const offset = fromTime - sceneStart;
        const remaining = sceneDuration - offset;
        // Clamp offset to buffer duration to avoid errors
        const clampedOffset = Math.min(offset, buffer.duration);
        const clampedDuration = Math.min(remaining, buffer.duration - clampedOffset);
        if (clampedDuration > 0) {
          source.start(now, clampedOffset, clampedDuration);
          sources.push({ source, gain });
        }
      } else {
        // Future scene — schedule ahead
        const when = now + (sceneStart - fromTime);
        const clampedDuration = Math.min(sceneDuration, buffer.duration);
        source.start(when, 0, clampedDuration);
        sources.push({ source, gain });
      }
    };

    // Schedule per-scene audio (video audio + TTS)
    let sceneStart = 0;
    for (const scene of scenes) {
      // Video audio track
      if (scene.visual?.status === "ready" && scene.visual.source && VIDEO_EXT_RE.test(scene.visual.source)) {
        const url = `/content/${scene.visual.source}`;
        const buffer = buffersRef.current.get(url);
        if (buffer) {
          scheduleSource(buffer, sceneStart, scene.duration);
        }
      }

      // TTS audio
      if (scene.audio?.status === "ready" && scene.audio.source) {
        const url = `/content/${scene.audio.source}`;
        const buffer = buffersRef.current.get(url);
        if (buffer) {
          scheduleSource(buffer, sceneStart, scene.duration);
        }
      }

      sceneStart += scene.duration;
    }

    // Schedule BGM
    if (bgm?.source) {
      const url = `/content/${bgm.source}`;
      const buffer = buffersRef.current.get(url);
      if (buffer) {
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        const gain = ctx.createGain();
        source.connect(gain).connect(ctx.destination);

        const { volume, fadeIn, fadeOut } = bgm;
        const playDuration = Math.min(totalDuration, buffer.duration);

        // Calculate BGM offset and timing
        const bgmOffset = Math.min(fromTime, buffer.duration);
        const remaining = playDuration - fromTime;

        if (remaining > 0) {
          source.start(now, bgmOffset, remaining);

          // Fade automation — compute relative to current playback position
          // Start value depends on where we are in the fadeIn
          if (fromTime < fadeIn) {
            // Still in fadeIn zone
            const currentFadeGain = volume * (fromTime / fadeIn);
            gain.gain.setValueAtTime(currentFadeGain, now);
            gain.gain.linearRampToValueAtTime(volume, now + (fadeIn - fromTime));
          } else {
            gain.gain.setValueAtTime(volume, now);
          }

          // FadeOut
          const fadeOutStart = playDuration - fadeOut;
          if (fromTime < fadeOutStart) {
            const fadeOutWhen = now + (fadeOutStart - fromTime);
            gain.gain.setValueAtTime(volume, fadeOutWhen);
            gain.gain.linearRampToValueAtTime(0, fadeOutWhen + fadeOut);
          } else if (fromTime < playDuration) {
            // Already in fadeOut zone
            const fadeProgress = (fromTime - fadeOutStart) / fadeOut;
            const currentFadeGain = volume * (1 - fadeProgress);
            gain.gain.setValueAtTime(currentFadeGain, now);
            gain.gain.linearRampToValueAtTime(0, now + (playDuration - fromTime));
          }

          sources.push({ source, gain });
        }
      }
    }

    activeSourcesRef.current = sources;
  }, [scenes, bgm, totalDuration, stopAll]);

  // ── Play/Pause sync ─────────────────────────────────────────────────────────

  const prevPlayingRef = useRef(false);
  const prevGlobalTimeRef = useRef(0);
  const seekDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const ctx = ctxRef.current;

    if (playing && !prevPlayingRef.current) {
      // Started playing
      if (ctx?.state === "suspended") {
        ctx.resume().then(() => schedulePlayback(globalTime));
      } else {
        schedulePlayback(globalTime);
      }
    } else if (!playing && prevPlayingRef.current) {
      // Stopped playing
      stopAll();
    } else if (playing && globalTime !== prevGlobalTimeRef.current) {
      // Seek while playing — debounce to avoid excessive rescheduling
      if (seekDebounceRef.current) clearTimeout(seekDebounceRef.current);
      seekDebounceRef.current = setTimeout(() => {
        schedulePlayback(globalTime);
      }, 200);
    }

    prevPlayingRef.current = playing;
    prevGlobalTimeRef.current = globalTime;
  }, [playing, globalTime, schedulePlayback, stopAll]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAll();
      if (ctxRef.current) {
        ctxRef.current.close().catch(() => {});
        ctxRef.current = null;
      }
    };
  }, [stopAll]);

  return loadState;
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd /Users/pandazki/Codes/pneuma-skills && npx tsc --noEmit modes/clipcraft/viewer/hooks/useAudioMixer.ts 2>&1 || echo "Type check done (errors above if any)"`

Note: TypeScript errors from this isolated check may occur due to path resolution. The real verification is that `bun run dev clipcraft` loads without errors (tested in Task 2).

- [ ] **Step 3: Commit**

```bash
git add modes/clipcraft/viewer/hooks/useAudioMixer.ts
git commit -m "feat(clipcraft): add useAudioMixer hook — Web Audio multi-track mixing

Preloads all audio sources (video audio, TTS, BGM) as AudioBuffers.
Schedules playback synchronized to store's playing/globalTime state.
Supports seek (stop + re-schedule), BGM fadeIn/fadeOut via GainNode."
```

---

### Task 2: Integrate into VideoPreview — mute videos, wire up mixer

**Files:**
- Modify: `modes/clipcraft/viewer/VideoPreview.tsx:1-8,155-161`

- [ ] **Step 1: Add import and hook call**

In `modes/clipcraft/viewer/VideoPreview.tsx`, add the import at line 6:

```ts
import { useAudioMixer } from "./hooks/useAudioMixer.js";
```

Then inside the `VideoPreview` function body, after the existing `usePlayback()` call (line 11), add:

```ts
  const audioMixer = useAudioMixer();
```

- [ ] **Step 2: Mute all video elements**

In `modes/clipcraft/viewer/VideoPreview.tsx`, change line 161 from:

```tsx
                muted={false}
```

to:

```tsx
                muted={true}
```

This ensures video audio goes through the AudioContext mixer instead of playing directly from the element (which would cause double audio).

- [ ] **Step 3: Start dev server and verify**

Run: `cd /Users/pandazki/Codes/pneuma-skills && bun run dev clipcraft`

Open a ClipCraft project with video + TTS + BGM. Verify:
1. Videos play with no audio from the `<video>` element (muted)
2. Audio plays through the mixer (TTS + BGM + video original audio all audible)
3. Seek to different positions — audio re-schedules correctly
4. Pause/resume — audio stops and restarts
5. Scene transitions — TTS switches, BGM continues
6. No console errors

- [ ] **Step 4: Commit**

```bash
git add modes/clipcraft/viewer/VideoPreview.tsx
git commit -m "feat(clipcraft): integrate audio mixer into VideoPreview

Mute video elements (audio routed through Web Audio API mixer).
All three audio layers (video original, TTS, BGM) now play during preview."
```

---

### Task 3: Edge case hardening

**Files:**
- Modify: `modes/clipcraft/viewer/hooks/useAudioMixer.ts`

- [ ] **Step 1: Handle stale buffers when storyboard changes**

When the agent regenerates a TTS file, the URL stays the same but the content changes. The `imageVersion` in the store increments on file changes. Add `imageVersion` to the preload effect's dependency to trigger re-fetch.

In `useAudioMixer.ts`, after `const bgm = state.storyboard.bgm;` add:

```ts
  const { imageVersion } = state;
```

Then modify the `collectAudioUrls` function call inside the preload `useEffect` to also evict stale buffers. Replace the preload `useEffect` with:

```ts
  // Preload audio buffers when scenes/bgm/assets change
  useEffect(() => {
    const urls = collectAudioUrls(scenes, bgm);

    // On imageVersion change, evict all cached buffers to pick up regenerated files
    // This is simple and correct — the browser HTTP cache prevents re-downloading unchanged files
    if (urls.length > 0) {
      buffersRef.current.clear();
      loadingUrlsRef.current.clear();
    }

    const newUrls = urls.filter((u) => !buffersRef.current.has(u));

    if (newUrls.length === 0) {
      setLoadState({ ready: true, loading: 0, total: urls.length });
      return;
    }

    const ctx = getCtx();
    let cancelled = false;
    let completed = 0;

    setLoadState({ ready: false, loading: newUrls.length, total: urls.length });

    for (const url of newUrls) {
      loadingUrlsRef.current.add(url);

      fetch(url)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.arrayBuffer();
        })
        .then((buf) => ctx.decodeAudioData(buf))
        .then((audioBuffer) => {
          if (cancelled) return;
          buffersRef.current.set(url, audioBuffer);
          loadingUrlsRef.current.delete(url);
          completed++;
          const stillLoading = newUrls.length - completed;
          setLoadState({
            ready: stillLoading === 0,
            loading: stillLoading,
            total: urls.length,
          });
        })
        .catch((err) => {
          if (cancelled) return;
          console.warn(`[AudioMixer] Failed to load ${url}:`, err);
          loadingUrlsRef.current.delete(url);
          completed++;
          const stillLoading = newUrls.length - completed;
          setLoadState({
            ready: stillLoading === 0,
            loading: stillLoading,
            total: urls.length,
          });
        });
    }

    return () => { cancelled = true; };
  }, [scenes, bgm, imageVersion, getCtx]);
```

- [ ] **Step 2: Prevent scheduling when no buffers loaded**

In the `schedulePlayback` function, add an early return at the top:

```ts
  const schedulePlayback = useCallback((fromTime: number) => {
    const ctx = ctxRef.current;
    if (!ctx || buffersRef.current.size === 0) return;
    // ... rest unchanged
```

- [ ] **Step 3: Test edge cases**

Verify manually:
1. Project with no audio at all (no TTS, no BGM) — plays video silently, no errors
2. Project with only BGM, no TTS — BGM plays, no errors
3. Seek to very end of timeline — no audio glitch
4. Rapid seek (drag scrub) — debounce prevents audio chaos
5. Agent regenerates a TTS while preview is open — new audio loads on next play

- [ ] **Step 4: Commit**

```bash
git add modes/clipcraft/viewer/hooks/useAudioMixer.ts
git commit -m "fix(clipcraft): handle stale audio buffers and edge cases

Evict buffer cache on imageVersion change (picks up regenerated TTS/BGM).
Guard against scheduling with empty buffer cache."
```

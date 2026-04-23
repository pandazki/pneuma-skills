# ClipCraft Audio Mixer — Design Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add real-time multi-track audio mixing to ClipCraft preview playback — video original audio + per-scene TTS + BGM, all synchronized to the existing video-driven timeline.

**Architecture:** A single `useAudioMixer` hook manages an AudioContext, preloads all audio sources as AudioBuffers, and schedules playback in sync with the existing store-driven playback state. No server-side changes needed.

**Tech Stack:** Web Audio API (AudioContext, AudioBufferSourceNode, GainNode), React hook

---

## Scope

**In scope:**
- Browser-side multi-track audio mixing during preview playback
- Three audio layers: video original audio, per-scene TTS, BGM
- Preload all audio into AudioBuffers for zero-latency switching
- BGM volume, fadeIn, fadeOut via GainNode automation
- Seek support (stop + re-schedule from new position)

**Out of scope:**
- Server-side ffmpeg assembly/export (Phase 3)
- Audio volume control UI (future enhancement)
- Audio waveform visualization changes (already working)
- Store/reducer changes (existing playback state is sufficient)

---

## Architecture

### Data Flow

```
Store (playback.playing / playback.globalTime)
  ├── usePlayback  → controls <video> elements (existing, unchanged)
  └── useAudioMixer → controls AudioContext (new)
        │
        AudioContext
        ├── VideoAudioSource (scene 1 video audio) → GainNode → destination
        ├── TTSSource (scene 1 TTS)                → GainNode → destination
        ├── VideoAudioSource (scene 2 video audio) → GainNode → destination
        ├── TTSSource (scene 2 TTS)                → GainNode → destination
        └── BGMSource                              → GainNode (fade automation) → destination
```

### Core Principle

Video elements stay as the master clock. `useAudioMixer` is a **follower** — it reads `playing` and `globalTime` from the store and schedules audio accordingly. The two hooks (`usePlayback` and `useAudioMixer`) are independent peers, both subscribing to the same store state.

---

## Component: `useAudioMixer` Hook

**File:** `modes/clipcraft/viewer/hooks/useAudioMixer.ts`

### Interface

```ts
interface AudioMixerState {
  ready: boolean;    // all audio buffers loaded
  loading: number;   // files currently loading
  total: number;     // total files to load
}

function useAudioMixer(
  scenes: Scene[],
  bgm: BGMConfig | null,
): AudioMixerState;
```

### Preloading

On mount or when scenes/bgm change:

1. Collect all audio URLs:
   - For each scene with `visual.status === "ready"` and video source (mp4/webm/mov): `/content/{visual.source}` (video audio track)
   - For each scene with `audio.status === "ready"` and `audio.source`: `/content/{audio.source}` (TTS)
   - If bgm with source: `/content/{bgm.source}` (BGM)
2. Deduplicate by URL
3. For each new URL not already in cache: `fetch(url) → arrayBuffer → audioContext.decodeAudioData()`
4. Store in `Map<string, AudioBuffer>`
5. Update `ready` / `loading` / `total` state

Cache key is the URL string. If a URL changes (agent re-generated a TTS), the old buffer is evicted and the new one loaded.

### Scheduling (play)

When `playing` becomes `true` (or after seek while playing):

1. Stop all existing source nodes (if any)
2. Read current `globalTime` from store
3. For each scene, compute `sceneStart` (cumulative duration of prior scenes)
4. For each audio source in each scene:
   - If `sceneStart + scene.duration <= globalTime`: skip (already past)
   - If `sceneStart > globalTime`: schedule for future — `source.start(audioCtx.currentTime + (sceneStart - globalTime))`
   - If `sceneStart <= globalTime < sceneStart + scene.duration`: play now from offset — `source.start(0, globalTime - sceneStart)`
5. BGM: always `source.start(0, globalTime)` with GainNode fade automation

### Scheduling (pause)

When `playing` becomes `false`:

1. Stop all active source nodes via `stop()`
2. Disconnect and discard references (AudioBufferSourceNode is single-use)

### Scheduling (seek)

When `globalTime` changes while playing:

1. Stop all active source nodes
2. Re-run the play scheduling from the new globalTime

Throttle seek-triggered rescheduling to avoid excessive node creation during dragging (~200ms debounce).

### BGM Gain Automation

```ts
const gainNode = audioCtx.createGain();
const { volume, fadeIn, fadeOut } = bgm;
const bgmDuration = bgmBuffer.duration;
const playbackDuration = totalDuration; // use shorter of bgm duration and total project duration

// Fade in
gainNode.gain.setValueAtTime(0, startTime);
gainNode.gain.linearRampToValueAtTime(volume, startTime + fadeIn);

// Sustain at volume (implicit)

// Fade out
const fadeOutStart = startTime + playbackDuration - fadeOut;
gainNode.gain.setValueAtTime(volume, fadeOutStart);
gainNode.gain.linearRampToValueAtTime(0, startTime + playbackDuration);
```

### AudioContext Lifecycle

- Created once (lazy, on first access)
- `resume()` called on first user-initiated play (browser autoplay policy)
- Not destroyed on pause — reused across play/pause cycles
- Cleaned up on component unmount

---

## Integration Points

### `VideoPreview.tsx`

Minimal changes:

1. Import and call `useAudioMixer(scenes, storyboard.bgm)`
2. Change all `<video>` elements to `muted={true}` (audio goes through AudioContext instead)

### `usePlayback.ts`

**No changes.** Mixer reads store state independently.

### Store / Reducer

**No changes.** Existing `playback.playing` and `playback.globalTime` provide all needed signals.

---

## Edge Cases

| Case | Behavior |
|------|----------|
| Scene has no TTS and no video audio | Silent for that scene, no error |
| Scene has TTS but video also has audio | Both play simultaneously (mixed) |
| No BGM configured | BGM scheduling skipped |
| BGM shorter than total duration | BGM plays once then stops (no loop) |
| BGM longer than total duration | BGM stops when project ends |
| Audio file fails to load | Skip that source, log warning, don't block other audio |
| User seeks rapidly (drag scrubbing) | Debounce re-scheduling at ~200ms |
| Browser autoplay policy blocks AudioContext | `resume()` on first user-initiated play action |
| All scenes lack audio | Hook returns `ready: true` with total=0, does nothing |

---

## Testing Plan

1. **Basic playback:** Project with TTS + BGM + video → play → hear all three layers mixed
2. **Seek:** Seek to middle of a scene → audio starts from correct offset
3. **Scene transition:** Play through scene boundary → TTS switches, BGM continues
4. **No audio scene:** Scene without TTS/audio → silent, no error
5. **BGM fade:** Listen for fadeIn at start, fadeOut at end
6. **Pause/resume:** Pause → resume → audio continues from correct position
7. **Rapid seek (scrubbing):** Drag playhead quickly → no audio glitches or errors
8. **Late audio load:** Start playing before all audio loaded → plays what's available, loads rest in background

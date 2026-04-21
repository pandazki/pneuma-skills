/**
 * Decode an audio file to a downsampled peaked waveform. Uses a
 * one-shot AudioContext per decode; results are cached in module
 * state keyed by URL so repeated AssetThumbnail mounts don't
 * re-decode. All zero values if decode fails.
 */

const cache = new Map<string, number[]>();
const inFlight = new Map<string, Promise<number[]>>();

const PEAK_COUNT = 128;

async function decodeAndPeak(url: string): Promise<number[]> {
  const existing = cache.get(url);
  if (existing) return existing;
  const pending = inFlight.get(url);
  if (pending) return pending;

  const task = (async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    const buf = await res.arrayBuffer();
    const ctx = new (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    try {
      const decoded = await ctx.decodeAudioData(buf.slice(0));
      const channel = decoded.getChannelData(0);
      const bucketSize = Math.max(1, Math.floor(channel.length / PEAK_COUNT));
      const peaks: number[] = new Array(PEAK_COUNT).fill(0);
      for (let i = 0; i < PEAK_COUNT; i++) {
        let max = 0;
        const start = i * bucketSize;
        const end = Math.min(channel.length, start + bucketSize);
        for (let j = start; j < end; j++) {
          const v = Math.abs(channel[j]);
          if (v > max) max = v;
        }
        peaks[i] = max;
      }
      cache.set(url, peaks);
      return peaks;
    } finally {
      ctx.close().catch(() => {});
    }
  })();

  inFlight.set(url, task);
  try {
    return await task;
  } catch (err) {
    console.warn(`[waveform] decode failed for ${url}:`, err);
    const zeros = new Array(PEAK_COUNT).fill(0);
    cache.set(url, zeros);
    return zeros;
  } finally {
    inFlight.delete(url);
  }
}

export function peakCount(): number {
  return PEAK_COUNT;
}

/** Synchronous cache peek — returns cached peaks if present, null otherwise.
 *  No side effects. Callers that want to trigger a decode use getOrLoadPeaks. */
export function peekPeaks(url: string): number[] | null {
  return cache.get(url) ?? null;
}

/** Returns cached peaks if present, otherwise kicks off decoding and returns null. */
export function getOrLoadPeaks(url: string, onReady: (peaks: number[]) => void): number[] | null {
  const existing = cache.get(url);
  if (existing) return existing;
  decodeAndPeak(url).then(onReady);
  return null;
}

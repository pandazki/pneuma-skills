/**
 * Types for `gif-frames.mjs` — the script stays plain ESM; the declaration
 * keeps `tsc --noEmit` honest for the tests that import it.
 */

export interface GifDelays {
  /** One delay per frame (per ffprobe packet), in ms. */
  delaysMs: number[];
  /** Indices of frames whose delay was unreadable and took the median. */
  unreadable: number[];
  /** The median of the readable delays, or null for no packets. */
  fallbackMs: number | null;
}

/** ffprobe's `packet=duration_time` CSV → one delay per frame; throws when none is readable. */
export declare function gifDelaysFromProbe(stdout: string): GifDelays;

/** Probe a GIF with ffprobe and apply the rule; throws on an unreadable file. */
export declare function probeGifDelays(path: string): GifDelays;

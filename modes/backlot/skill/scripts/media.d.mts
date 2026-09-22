// Type declarations for media.mjs (plain JS so an installed skill runs it
// under bare `node`). Only the exports the tests and previz.mjs use.

export interface ShotSpec {
  seconds: number;
  fps: number;
  width: number;
  height: number;
  frames: number;
}

/** What shot.json stores about one video file. */
export interface Probe {
  codec: string | null;
  pixFmt: string | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  frames: number | null;
  seconds: number | null;
  bytes: number | null;
}

export function framesForSpec(spec: { seconds: number; fps: number }): number;
export function frameAtTime(t: number, fps: number, frames: number): number;
export function timeOfFrame(frame: number, fps: number): number;
/** The 1-based frames a cut over the half-open range `[start, end)` shows at
 *  its edges — what a hand-off is cut at. */
export function firstFrameFrom(start: number, fps: number, frames: number): number;
export function lastFrameBefore(end: number, fps: number, frames: number): number;
export function snapSeconds(seconds: number, fps: number): { frames: number; seconds: number };
export function evenSize(width: number, height: number): { width: number; height: number };
export function previewSize(width: number, height: number): { width: number; height: number };
export function parseRational(value: string | number | null | undefined): number | null;
export function parseProbe(probeJson: unknown, options?: { bytes?: number | null }): Probe | null;
export function probeMismatches(
  probe: Probe | null,
  expected: { frames?: number | null; fps?: number | null; width?: number | null; height?: number | null },
): string[];
export function parseSceneCuts(stderr: string, options?: { minSeconds?: number }): number[];
export function parseTimeList(value: string, label?: string): number[];
export function parseRange(value: string, label?: string): [number, number];
export function evenlySpacedTimes(options: { frames: number; fps: number; count?: number }): number[];
export function stripFrames(
  from: number,
  to: number,
  fps: number,
  frames: number,
  options?: { max?: number },
): number[];
export function gridFor(count: number, options?: { maxCols?: number }): { cols: number; rows: number };
export function hasDrawtext(filterListing: string): boolean;
export function pngSize(buffer: Uint8Array): { width: number; height: number } | null;
export function stamp(seconds: number): string;

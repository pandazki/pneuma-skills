/**
 * Types for `sticker-media.mjs` (node: ffmpeg/ffprobe steps, pixel
 * measurements, GIF/APNG container helpers, exporters). The script stays
 * plain ESM; this declaration keeps the tests under `tsc --noEmit`.
 */

import type { AlphaMeasure, DeliverableSpec, Measure, MotionMeasure, Platform } from "./sticker-state.mjs";

export function sharedScriptUrl(name: string): string | null;
export function importShared(name: string, why: string): Promise<any>;

export function readGifInfo(bytes: Uint8Array | ArrayLike<number>): { width: number; height: number; frames: number; delaysMs: number[] };
export function zipStore(files: { name: string; data: Uint8Array }[], options?: { date?: Date }): Buffer;

export function run(tool: string, args: string[], options?: { step?: string; input?: Uint8Array; timeoutMs?: number }): { stdout: Buffer; stderr: Buffer; status: number | null };
export function hasTool(tool: string): boolean;
export function hasDrawtext(): boolean;
export function writeAtomic(path: string, bytes: Uint8Array | string): void;

export interface GifStructure {
  width: number;
  height: number;
  frames: number;
  delaysMs: number[];
  /** Byte offset of each frame's GCE delay field; -1 when the frame has none. */
  delayOffsets: number[];
  /** NETSCAPE2.0 loop count: 0 = forever, null = no loop block (plays once). */
  loopCount: number | null;
}
export function gifStructure(bytes: Uint8Array): GifStructure;
export function setGifDelays(bytes: Uint8Array, delaysMs: number[]): Buffer;

export interface ApngInfo {
  width: number;
  height: number;
  animated: boolean;
  frames: number;
  /** acTL num_plays (0 = forever); null for a still PNG. */
  plays: number | null;
  delaysMs: number[];
  fctl: { type: string; offset: number; length: number }[];
}
export function apngInfo(bytes: Uint8Array): ApngInfo;
export function setApngDelays(bytes: Uint8Array, delaysMs: number[]): Buffer;

export function effectiveDelays(delaysMs: number[]): number[];
export const STILL_ALPHA: Readonly<{ clearAtOrBelow: number; opaqueAtOrAbove: number }>;
export function cleanStillAlpha(rgba: Uint8Array, options?: { clearAtOrBelow?: number; opaqueAtOrAbove?: number }): { rgba: Buffer; cleared: number; raised: number };
export function coverage(frame: Uint8Array, threshold?: number): number;
export interface Box { x: number; y: number; width: number; height: number }
export function alphaBox(frame: Uint8Array, width: number, height: number, threshold?: number): Box | null;
export function unionBox(boxes: (Box | null)[]): Box | null;
export function frameDiff(a: Uint8Array, b: Uint8Array, width: number, height: number): number;
export function alphaStats(frames: Uint8Array[], width: number, height: number): AlphaMeasure;
export function nearWhiteFraction(frame: Uint8Array): number;
export function motionStats(frames: Uint8Array[], width: number, height: number): MotionMeasure;
export function allIdentical(frames: Buffer[]): boolean;

export function decodeFrames(path: string, options?: { width?: number; height?: number; codec?: string; scaleTo?: { width: number; height: number } }): Buffer[];
export interface GifFrames {
  width: number;
  height: number;
  frames: Buffer[];
  /** Effective delays (≤ 10 ms read as 100 ms, as browsers and ffmpeg show them). */
  delaysMs: number[];
  info: { width: number; height: number; frames: number; delaysMs: number[] };
}
export function readGifFrames(path: string, options?: { scaleTo?: { width: number; height: number } }): GifFrames;

/** With `keepFrames`: the trimmed loop's numbers (`measure.kept`, `measure.framesInTake`). */
export function measureTake(path: string, options?: { pixels?: boolean; keepFrames?: number[] | null }): { measure: Measure; note: string | null };
export function measureAnimation(path: string, format: "gif" | "apng" | "webm"): Measure;
export function measureStill(path: string): Measure;

export function keptIndices(count: number, keepFrames: number[] | null): number[];
export function decimate(indices: number[], delaysMs: number[], step: number): { indices: number[]; delaysMs: number[] };
export interface LineTiming {
  indices: number[];
  delaysMs: number[];
  plays: number;
  step: number;
  repeats: number;
  speed: number;
  loopMs: number;
}
export function lineTiming(indices: number[], delaysMs: number[], options?: { extraStep?: number }): LineTiming;
export function constantRateTimeline(indices: number[], delaysMs: number[], options: { fps: number; maxMs: number }): { order: number[]; frames: number; durationMs: number; speed: number };

export function fitInside(w: number, h: number, W: number, H: number): { width: number; height: number };
export type Geometry =
  | { kind: "pad"; width: number; height: number }
  | { kind: "crop-fit"; crop: Box; maxWidth: number; maxHeight: number }
  | { kind: "edge"; edge: number }
  | { kind: "cover"; width: number; height: number };
export function geometryChain(src: { width: number; height: number }, target: Geometry): { chain: string; width: number; height: number };

export function encodeGif(options: { frames: Buffer[]; width: number; height: number; delaysMs: number[]; chain: string; colors: number }): Buffer;
export function encodeApng(options: { frames: Buffer[]; width: number; height: number; delaysMs: number[]; chain: string; colors: number; plays: number }): Buffer;
export function encodeWebm(options: { frames: Buffer[]; width: number; height: number; chain: string; fps: number; crf: number }): Buffer;
export function encodeStill(options: { frame: Buffer; width: number; height: number; chain: string; format: "png" | "png-palette" | "png-opaque" | "jpg"; colors?: number; quality?: number }): Buffer;

export interface Exported {
  bytes: Buffer;
  ext: "gif" | "webm" | "png" | "jpg";
  measure: Measure & { fit: NonNullable<Measure["fit"]> };
}
export function exportSticker(platform: Platform, source: GifFrames, keepFrames: number[] | null): Exported;
export function exportLineMain(source: GifFrames, keepFrames: number[] | null): Exported;
/** A still from art, or (`frame`) from that 0-based frame of a sticker's take. */
export function exportStill(spec: DeliverableSpec, artPath: string, options?: { frame?: number }): Exported;
export const ARCHIVE_DATE: Date;
export function archive(entries: { name: string; data: Uint8Array }[]): Buffer;

export const PLATES: Readonly<{ light: readonly [number, number, number]; dark: readonly [number, number, number] }>;
/** `numbers`: each frame's number in the take (default 0, 1, …). */
export function contactLayout(frames: Uint8Array[], cellW: number, cellH?: number, options?: { gap?: number; numbers?: number[] | null }): { rgb: Buffer; width: number; height: number; labels: { text: string; x: number; y: number; dark: boolean }[] };
/** `keepFrames`: only the kept frames, labelled with their numbers in the take (`labels`). */
export function contactSheet(gifPath: string, out: string, options?: { cell?: number; keepFrames?: number[] | null }): { width: number; height: number; frames: number; labels: number[]; cell: { width: number; height: number }; labelled: boolean };
export function fileSize(path: string): number;

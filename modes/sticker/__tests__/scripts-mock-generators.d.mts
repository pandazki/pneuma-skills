/** Types for the test-only stand-in generators (scripts-mock-generators.mjs). */

/** A structurally complete GIF89a (NETSCAPE loop forever, 1×1 image blocks). */
export function structuralGif(frames: number, options?: { delayCs?: number; width?: number; height?: number }): Buffer;
/** A real transparent GIF drawn by ffmpeg: a box that moves, loop forever. */
export function drawGif(output: string, options: { frames: number; frameMs: number; width: number; height: number }): void;
/** A real PNG; a transparent one carries GPT Image 2.6's alpha haze. */
export function drawPng(output: string, options: { width: number; height: number; transparent: boolean }): void;
export const falKey: () => string | null;
export const imageKey: () => string | null;
export function generateGif(options: Record<string, unknown>): Promise<Record<string, unknown>>;
export function attachGif(options: Record<string, unknown>): Promise<Record<string, unknown>>;
export function generateImage(options: Record<string, unknown>): Promise<Record<string, unknown>>;

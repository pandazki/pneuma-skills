// Type declarations for the untyped shared storyboard script (storyboard.mjs).
// The script is plain JS with rich runtime-shaped return values; these stubs
// expose the call surface with permissive return types rather than mirroring
// every nested field (which would be brittle to keep in sync). `computeBboxes`
// keeps a typed `panels` array so callers can `.map` it without implicit-any.

export interface Grid {
  rows: number;
  cols: number;
}

export interface ImageSize {
  width: number;
  height: number;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function pickGrid(panels: number, aspect: string): any;
export function pickImageSize(grid: Grid, aspect: string): any;
export function computeBboxes(
  grid: Grid,
  imgSize: ImageSize,
  aspect: string,
): { panels: any[]; cellWidth: number; cellHeight: number };
export function assemblePrompt(opts: {
  userPrompt: string;
  grid: Grid;
  aspect: string;
  includeAnnotations?: boolean;
}): string;
export function buildStdoutJson(opts: Record<string, any>): any;

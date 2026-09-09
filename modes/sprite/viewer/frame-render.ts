/**
 * Drawing one frame of a motion — the only place in the viewer that touches a
 * 2D context.
 *
 * Two frame sources reach the same pixels: aligned frame PNGs (one image per
 * frame) and the generated sheet sliced on the fly (one image, `cols x rows`
 * crops). `frameRect` collapses that difference into a source rectangle, so
 * everything downstream — the stage, the onion skin, the strip thumbnails, the
 * selection thumbnail, the `capture` action — draws through one path and can
 * never disagree about which frame is which.
 *
 * Sprite-specific rendering rules encoded here:
 *   - Upscaling is NEAREST and INTEGER. A 46 px frame blown up 13x with
 *     bilinear smoothing is a blur of the thing the user is animating; a
 *     fractional scale makes some pixels 1 px wide and others 2, which reads
 *     as the sprite shimmering while it plays.
 *   - The checkerboard is drawn INTO the canvas rather than set as a CSS
 *     background, because `capture` returns the canvas: a screenshot of a
 *     transparent sprite on nothing is unreadable.
 *   - The ground line is the atlas PIVOT — the point a game engine will place
 *     on the floor. It is the promise the atlas makes, so it is the line worth
 *     showing. Where that point IS is a measurement (`pivotGuide` below), not
 *     the cell edge: with any `--pad` the feet sit above the floor.
 */

import type { MeasuredAnchor } from "../domain.js";
import { clampFrame, type FrameSource } from "./playback.js";

export type StageBackground = "checker" | "dark" | "light";
export type StageZoom = "fit" | "1x" | "2x";

/** Decoded images for the current source, index-aligned with its frames. */
export interface StageImages {
  /** One entry per frame for a `frames` source; empty otherwise. */
  frames: ReadonlyArray<HTMLImageElement | null>;
  /** The sheet for a `raw-sheet` source; null otherwise. */
  sheet: HTMLImageElement | null;
  /** True once every image has settled (loaded or failed). */
  ready: boolean;
  /** How many images failed to decode. */
  failed: number;
}

export const EMPTY_IMAGES: StageImages = {
  frames: [],
  sheet: null,
  ready: false,
  failed: 0,
};

/** Where one frame lives inside a decoded image. */
export interface FrameRect {
  image: HTMLImageElement;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** The source rectangle for `index`, or null when that frame has no pixels. */
export function frameRect(
  source: FrameSource,
  images: StageImages,
  index: number,
): FrameRect | null {
  if (source.kind === "frames") {
    const image = images.frames[index] ?? null;
    if (!image || !image.naturalWidth) return null;
    return {
      image,
      sx: 0,
      sy: 0,
      sw: image.naturalWidth,
      sh: image.naturalHeight,
    };
  }
  if (source.kind === "raw-sheet") {
    const image = images.sheet;
    if (!image || !image.naturalWidth) return null;
    const sw = image.naturalWidth / source.cols;
    const sh = image.naturalHeight / source.rows;
    const col = index % source.cols;
    const row = Math.floor(index / source.cols);
    if (row >= source.rows) return null;
    return { image, sx: col * sw, sy: row * sh, sw, sh };
  }
  return null;
}

const CHECKER_COLORS: Record<"light" | "dark", [string, string]> = {
  dark: ["#1a1a1f", "#242429"],
  light: ["#e8e5e0", "#f5f3ef"],
};

const SOLID_COLORS: Record<StageBackground, string | null> = {
  checker: null,
  dark: "#0d0d10",
  light: "#f2f0ec",
};

/** Onion-skin tints: the frame before is cool, the frame after is warm. */
const ONION_PREV = "#38bdf8";
const ONION_NEXT = "#fb7185";
const ONION_ALPHA = 0.3;

const CHECKER_SIZE = 10;

function paintBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  background: StageBackground,
  theme: "light" | "dark",
): void {
  const solid = SOLID_COLORS[background];
  if (solid) {
    ctx.fillStyle = solid;
    ctx.fillRect(0, 0, width, height);
    return;
  }
  const [a, b] = CHECKER_COLORS[theme];
  ctx.fillStyle = a;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = b;
  for (let y = 0; y < height; y += CHECKER_SIZE) {
    for (let x = 0; x < width; x += CHECKER_SIZE) {
      if (((x / CHECKER_SIZE) + (y / CHECKER_SIZE)) % 2 === 0) continue;
      ctx.fillRect(x, y, CHECKER_SIZE, CHECKER_SIZE);
    }
  }
}

/**
 * Scale for the frame inside the stage box.
 *
 * `fit` fills the box but snaps to an integer when it is enlarging, so every
 * source pixel is the same size on screen. Shrinking (a sheet bigger than the
 * pane) stays fractional — there is no integer answer that fits.
 */
export function stageScale(
  zoom: StageZoom,
  frameWidth: number,
  frameHeight: number,
  boxWidth: number,
  boxHeight: number,
): number {
  if (zoom === "1x") return 1;
  if (zoom === "2x") return 2;
  if (frameWidth <= 0 || frameHeight <= 0) return 1;
  const raw = Math.min((boxWidth * 0.86) / frameWidth, (boxHeight * 0.86) / frameHeight);
  if (raw >= 1) return Math.max(1, Math.floor(raw));
  return raw;
}

/** A tinted copy of one frame, used for the onion skin. Reused per call —
 *  the stage redraws at most once per frame of animation. */
const tintCanvas =
  typeof document === "undefined" ? null : document.createElement("canvas");

function drawTinted(
  ctx: CanvasRenderingContext2D,
  rect: FrameRect,
  color: string,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  alpha: number,
): void {
  if (!tintCanvas) return;
  tintCanvas.width = Math.max(1, Math.round(rect.sw));
  tintCanvas.height = Math.max(1, Math.round(rect.sh));
  const tctx = tintCanvas.getContext("2d");
  if (!tctx) return;
  tctx.clearRect(0, 0, tintCanvas.width, tintCanvas.height);
  tctx.drawImage(
    rect.image,
    rect.sx, rect.sy, rect.sw, rect.sh,
    0, 0, tintCanvas.width, tintCanvas.height,
  );
  tctx.globalCompositeOperation = "source-in";
  tctx.fillStyle = color;
  tctx.fillRect(0, 0, tintCanvas.width, tintCanvas.height);
  tctx.globalCompositeOperation = "source-over";

  const previousAlpha = ctx.globalAlpha;
  ctx.globalAlpha = alpha;
  ctx.drawImage(tintCanvas, dx, dy, dw, dh);
  ctx.globalAlpha = previousAlpha;
}

/** Where the pivot guides go, in stage (CSS pixel) coordinates. */
export interface PivotGuide {
  /** x of the vertical line. */
  x: number;
  /** y of the ground line. */
  y: number;
  /** True when the point came from the pipeline's measurement rather than
   *  from the anchor's assumed position in the cell. */
  measured: boolean;
}

/**
 * Where to draw the pivot guides for the picture currently on stage.
 *
 * The measured point is expressed in the pixels of the cell `inspect` measured
 * — so it only describes what is on screen when the picture on screen IS that
 * cell. The raw sheet sliced in the browser has its own geometry, and a
 * re-align with a different `--cell` leaves a stale measurement behind; in
 * both cases a point taken in someone else's cell would put the guide at an
 * arbitrary spot that looks exactly as authoritative as a correct one. So the
 * cell is checked, and the anchor's assumed position is the honest fallback:
 * bottom-centre for `bottom`, dead centre for `center` — the same points the
 * atlas falls back to when the frames carry no `align.json`.
 */
export function pivotGuide(options: {
  anchor: "bottom" | "center";
  /** The motion's measurement, when it has one (`domain::measuredAnchor`). */
  measured: MeasuredAnchor | null;
  /** Source-pixel size of the frame being drawn. */
  frameWidth: number;
  frameHeight: number;
  /** Top-left of that frame on the stage, and its magnification. */
  dx: number;
  dy: number;
  scale: number;
}): PivotGuide {
  const { measured, frameWidth, frameHeight, dx, dy, scale } = options;
  if (
    measured &&
    measured.cell.width === frameWidth &&
    measured.cell.height === frameHeight
  ) {
    return {
      x: dx + measured.point.x * scale,
      y: dy + measured.point.y * scale,
      measured: true,
    };
  }
  const dw = frameWidth * scale;
  const dh = frameHeight * scale;
  return {
    x: dx + dw / 2,
    y: options.anchor === "center" ? dy + dh / 2 : dy + dh,
    measured: false,
  };
}

export interface DrawStageOptions {
  source: FrameSource;
  images: StageImages;
  frame: number;
  /** CSS pixel size of the stage box. */
  width: number;
  height: number;
  background: StageBackground;
  zoom: StageZoom;
  onion: boolean;
  ground: boolean;
  anchor: "bottom" | "center";
  /** The motion's measured anchor point, when `register-run` recorded one. */
  measured: MeasuredAnchor | null;
  theme: "light" | "dark";
}

export interface DrawStageResult {
  scale: number;
  frameWidth: number;
  frameHeight: number;
  /** False when the frame itself had nothing to draw (missing / empty). */
  drew: boolean;
  /** Where the guides went — `measured` is what the toolbar tells the user. */
  pivot: PivotGuide;
}

/**
 * Paint the stage: background, onion skin, the frame, the pivot guides.
 * The canvas is assumed to already be sized (and dpr-scaled) by the caller.
 */
export function drawStage(
  ctx: CanvasRenderingContext2D,
  opts: DrawStageOptions,
): DrawStageResult {
  const { width, height } = opts;
  ctx.clearRect(0, 0, width, height);
  paintBackground(ctx, width, height, opts.background, opts.theme);

  const count = opts.source.kind === "none" ? 0 : opts.source.count;
  // The playhead belongs to the MOTION; the source on screen may briefly be
  // something else (a reference image, or a re-run that came back shorter).
  // Clamping here means the stage always draws a real frame instead of going
  // blank while the two disagree.
  const index = clampFrame(opts.frame, count);
  const current = frameRect(opts.source, opts.images, index);
  // A blank frame must not collapse the stage: fall back to any decoded frame
  // for the geometry so the guides and the box stay where they were.
  const geometry =
    current ??
    (count > 0
      ? frameRect(opts.source, opts.images, 0) ??
        frameRect(opts.source, opts.images, Math.max(0, count - 1))
      : null);
  if (!geometry) {
    return {
      scale: 1,
      frameWidth: 0,
      frameHeight: 0,
      drew: false,
      pivot: { x: 0, y: 0, measured: false },
    };
  }

  const scale = stageScale(opts.zoom, geometry.sw, geometry.sh, width, height);
  const dw = geometry.sw * scale;
  const dh = geometry.sh * scale;
  const dx = Math.round((width - dw) / 2);
  const dy = Math.round((height - dh) / 2);

  ctx.imageSmoothingEnabled = scale < 1;

  if (opts.onion && count > 1) {
    const prev = frameRect(opts.source, opts.images, (index - 1 + count) % count);
    const next = frameRect(opts.source, opts.images, (index + 1) % count);
    if (prev) drawTinted(ctx, prev, ONION_PREV, dx, dy, dw, dh, ONION_ALPHA);
    if (next) drawTinted(ctx, next, ONION_NEXT, dx, dy, dw, dh, ONION_ALPHA);
  }

  if (current) {
    ctx.drawImage(
      current.image,
      current.sx, current.sy, current.sw, current.sh,
      dx, dy, dw, dh,
    );
  }

  const pivot = pivotGuide({
    anchor: opts.anchor,
    measured: opts.measured,
    frameWidth: geometry.sw,
    frameHeight: geometry.sh,
    dx,
    dy,
    scale,
  });

  if (opts.ground) {
    const guide = opts.theme === "dark"
      ? "rgba(249, 115, 22, 0.55)"
      : "rgba(234, 88, 12, 0.6)";
    ctx.save();
    ctx.strokeStyle = guide;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(dx - 16, Math.round(pivot.y) + 0.5);
    ctx.lineTo(dx + dw + 16, Math.round(pivot.y) + 0.5);
    ctx.stroke();
    ctx.setLineDash([2, 6]);
    ctx.beginPath();
    ctx.moveTo(Math.round(pivot.x) + 0.5, dy - 8);
    ctx.lineTo(Math.round(pivot.x) + 0.5, dy + dh + 8);
    ctx.stroke();
    ctx.restore();
  }

  return {
    scale,
    frameWidth: geometry.sw,
    frameHeight: geometry.sh,
    drew: current !== null,
    pivot,
  };
}

/**
 * A PNG data URL of one frame, at most `maxPx` on its longest side.
 *
 * This is what rides along with a selection into the chat context, so the
 * agent sees the frame the user clicked rather than a description of it.
 * Returns null when the frame has no pixels — a caller must not send a blank
 * square that reads as "the frame is empty".
 */
export function frameThumbnail(
  source: FrameSource,
  images: StageImages,
  frame: number,
  maxPx = 200,
): string | null {
  if (typeof document === "undefined") return null;
  const rect = frameRect(source, images, frame);
  if (!rect) return null;
  const scale = Math.min(1, maxPx / Math.max(rect.sw, rect.sh));
  const w = Math.max(1, Math.round(rect.sw * scale));
  const h = Math.max(1, Math.round(rect.sh * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = scale < 1;
  ctx.drawImage(rect.image, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, w, h);
  try {
    return canvas.toDataURL("image/png");
  } catch {
    // A tainted canvas (an asset served cross-origin) — the selection still
    // carries its address and label, it just has no picture.
    return null;
  }
}

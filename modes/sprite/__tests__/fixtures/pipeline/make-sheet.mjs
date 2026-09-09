#!/usr/bin/env node
/**
 * Synthetic sprite-sheet builder for the pipeline tests.
 *
 * Zero fixtures on disk: every sheet the suite needs is drawn by ffmpeg at
 * test time, so the repo carries no binary blobs and the tests exercise the
 * same decode path as production.
 *
 * ffmpeg gotcha this file exists to encode: `drawbox` alpha-blends by
 * default and leaves the *alpha* plane untouched, so drawing an opaque box
 * onto `color=black@0` yields a fully transparent image. `replace=1` is what
 * makes drawbox overwrite colour AND alpha. Without it the whole fixture is
 * invisible and every bbox assertion reads "empty frame".
 */

import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** Cell offsets of the drawn square, in cell-local pixels, per grid cell. */
export const SQUARE = { w: 30, h: 30 };
export const CELL_OFFSETS = [
  { x: 10, y: 20, color: "red" },
  { x: 10, y: 24, color: "orange" },
  { x: 18, y: 24, color: "blue" },
  { x: 16, y: 28, color: "purple" },
];

function drawboxes({ cell, cols, filled, squares = CELL_OFFSETS }) {
  return filled
    .map((index) => {
      const square = squares[index % squares.length];
      const col = index % cols;
      const row = Math.floor(index / cols);
      const x = col * cell + square.x;
      const y = row * cell + square.y;
      return `drawbox=x=${x}:y=${y}:w=${SQUARE.w}:h=${SQUARE.h}:color=${square.color}@1:t=fill:replace=1`;
    })
    .join(",");
}

/**
 * Build an N x M sheet. `background` is any ffmpeg colour expression;
 * `black@0` yields a transparent sheet, `0x00b140` an opaque green one.
 * `cells` selects which grid cells get a square (default: all).
 */
export function buildSheet(outPath, {
  cell = 64,
  rows = 2,
  cols = 2,
  background = "black@0",
  cells = null,
  extras = [],
  squares = CELL_OFFSETS,
} = {}) {
  const total = rows * cols;
  const filled = cells ?? Array.from({ length: total }, (_, i) => i);
  const boxes = drawboxes({ cell, cols, filled, squares });
  // Extra boxes in cell-local coordinates — a stray limb that widens one
  // frame's bbox without moving the body, which is what --smooth is for.
  const extraBoxes = extras
    .map(({ index, x, y, w, h, color = "white" }) => {
      const px = (index % cols) * cell + x;
      const py = Math.floor(index / cols) * cell + y;
      return `drawbox=x=${px}:y=${py}:w=${w}:h=${h}:color=${color}@1:t=fill:replace=1`;
    })
    .join(",");
  const chain = [`color=c=${background}:s=${cols * cell}x${rows * cell}`, "format=rgba", boxes, extraBoxes]
    .filter(Boolean)
    .join(",");
  mkdirSync(dirname(outPath), { recursive: true });
  const r = spawnSync(
    "ffmpeg",
    ["-v", "error", "-y", "-f", "lavfi", "-i", chain, "-frames:v", "1", "-pix_fmt", "rgba", "--", outPath],
    { encoding: "utf-8" },
  );
  if (r.status !== 0) {
    throw new Error(`fixture ffmpeg failed: ${r.stderr ?? r.error?.message ?? "unknown"}`);
  }
  return outPath;
}

/**
 * Decode any image to RGBA and hand back the raw buffer plus its size — the
 * one decode `readBbox` and `readColorBbox` both measure on.
 */
function decode(path) {
  const probe = spawnSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", path],
    { encoding: "utf-8" },
  );
  if (probe.status !== 0) throw new Error(`ffprobe failed for ${path}`);
  const [width, height] = String(probe.stdout).trim().split(",").map(Number);
  const r = spawnSync(
    "ffmpeg",
    ["-v", "error", "-i", path, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "-"],
    { maxBuffer: 256 * 1024 * 1024 },
  );
  if (r.status !== 0) throw new Error(`ffmpeg decode failed for ${path}`);
  return { width, height, data: r.stdout };
}

/** Bbox of every pixel a predicate accepts, in the script's own convention. */
function bboxWhere({ width, height, data }, accept) {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1, count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (!accept(data[i], data[i + 1], data[i + 2], data[i + 3])) continue;
      count++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return {
    width,
    height,
    coverage: count / (width * height),
    bbox: count ? { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } : null,
  };
}

/** Decode any image to RGBA and report its alpha bbox — the tests' eyes. */
export function readBbox(path, threshold = 16) {
  return bboxWhere(decode(path), (_r, _g, _b, a) => a >= threshold);
}

/**
 * The bbox of one exact colour. A prop-carrying fixture draws the body and the
 * prop in different colours, so this measures where the BODY ended up without
 * the test having to re-implement the feet-band arithmetic it is checking —
 * which would only prove the script agrees with itself.
 */
export function readColorBbox(path, hex, threshold = 16) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) throw new Error(`readColorBbox: expected #rrggbb, got '${hex}'`);
  const [wr, wg, wb] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  return bboxWhere(decode(path), (r, g, b, a) => a >= threshold && r === wr && g === wg && b === wb);
}

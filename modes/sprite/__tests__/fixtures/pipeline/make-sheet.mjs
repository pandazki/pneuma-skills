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
} = {}) {
  const total = rows * cols;
  const filled = cells ?? Array.from({ length: total }, (_, i) => i);
  const boxes = drawboxes({ cell, cols, filled });
  const chain = [`color=c=${background}:s=${cols * cell}x${rows * cell}`, "format=rgba", boxes]
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

/** Decode any image to RGBA and report its alpha bbox — the tests' eyes. */
export function readBbox(path, threshold = 16) {
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
  const data = r.stdout;
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1, count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] < threshold) continue;
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

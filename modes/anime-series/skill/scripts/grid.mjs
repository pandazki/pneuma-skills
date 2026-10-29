/**
 * anime-series grid and frame geometry. Pure: no `node:*` imports.
 *
 * Cell arithmetic is the one ai-anime-series `scripts/grid.py split` uses
 * (MIT, (c) 2026 硅基废话 / 10291124jcjc-dotcom; the licence text is in
 * LICENSE-ai-anime-series.txt beside this file): a grid image is divided
 * into equal rows × cols with each edge rounded, so neighbouring cells tile
 * the image exactly with no gap and no overlap. A generated storyboard's
 * gutters are wherever the model drew them; equal division is the only
 * placement that does not guess.
 */

import { gridOf } from "./series-state.mjs";

/** Aspect ratios the shared image script accepts (generate_image.mjs IMAGE_ASPECTS, minus auto). */
export const IMAGE_ASPECTS = Object.freeze(["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"]);

/** "16:9" → 1.777…; throws on anything that is not W:H. */
export function ratioValue(ratio) {
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(String(ratio ?? ""));
  if (!match || Number(match[1]) <= 0 || Number(match[2]) <= 0) throw new Error(`ratio must look like 16:9 (got: ${ratio})`);
  return Number(match[1]) / Number(match[2]);
}

/**
 * The rectangle of panel `index` (1-based, row-major) in a `width` ×
 * `height` grid image of `rows` × `cols`.
 */
export function cellRect(width, height, rows, cols, index) {
  if (!(width > 0 && height > 0)) throw new Error(`grid image size must be positive (got: ${width}×${height})`);
  if (!Number.isInteger(index) || index < 1 || index > rows * cols) throw new Error(`panel must be 1–${rows * cols} (got: ${index})`);
  const r = Math.floor((index - 1) / cols);
  const c = (index - 1) % cols;
  const x0 = Math.round((c * width) / cols);
  const x1 = Math.round(((c + 1) * width) / cols);
  const y0 = Math.round((r * height) / rows);
  const y1 = Math.round(((r + 1) * height) / rows);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, row: r + 1, col: c + 1 };
}

/** Every panel rectangle of an n-panel storyboard image. */
export function gridCells(width, height, panels) {
  const { rows, cols } = gridOf(panels);
  return Array.from({ length: panels }, (_, i) => cellRect(width, height, rows, cols, i + 1));
}

/**
 * The width-to-height range a reference image has to stay in. It is the
 * Jimeng canvas's upload limit, which upstream's `grid.py rewrap` exists for
 * (a four-view turnaround in one row is refused there). Seedance's own limit
 * is reported to be the same but has not been checked on fal, so an upload
 * outside the range is warned about, not refused. Sheets and boards this
 * mode draws are inside it by construction (21:9 to 9:16).
 */
export const REFERENCE_ASPECT = Object.freeze({ min: 0.4, max: 2.5 });

/** Width ÷ height of an image when it is outside `REFERENCE_ASPECT`, else null. */
export function referenceAspectOutside(width, height) {
  if (!(width > 0 && height > 0)) return null;
  const aspect = width / height;
  return aspect < REFERENCE_ASPECT.min || aspect > REFERENCE_ASPECT.max ? aspect : null;
}

/** The supported aspect closest to w:h, compared on a log scale. */
export function nearestAspect(width, height, choices = IMAGE_ASPECTS) {
  const want = Math.log(width / height);
  let best = choices[0];
  let bestDistance = Infinity;
  for (const choice of choices) {
    const distance = Math.abs(Math.log(ratioValue(choice)) - want);
    if (distance < bestDistance) {
      best = choice;
      bestDistance = distance;
    }
  }
  return best;
}

/** The aspect to draw one panel at, for a frame `ratio` laid out rows × cols. */
export function panelAspect(ratio, panels) {
  const { rows, cols } = gridOf(panels);
  const frame = ratioValue(ratio);
  return nearestAspect(frame * rows, cols);
}

/**
 * The pixel area Seedance renders per resolution tier. The model picks the
 * exact size from the aspect (a 480p square came back 640×640, the same
 * area as 854×480), so a pre-flight estimate keeps the area and the ratio.
 */
export const TIER_AREA = Object.freeze({ "480p": 854 * 480, "720p": 1280 * 720, "1080p": 1920 * 1080 });

/** The clip size to price before a render: same area as the tier, at `ratio`, even pixels. */
export function assumedVideoSize(resolution, ratio) {
  const area = TIER_AREA[resolution];
  if (!area) throw new Error(`resolution must be one of ${Object.keys(TIER_AREA).join(", ")} (got: ${resolution})`);
  const r = ratioValue(ratio);
  const even = (x) => Math.max(2, Math.round(x / 2) * 2);
  return { width: even(Math.sqrt(area * r)), height: even(Math.sqrt(area / r)) };
}

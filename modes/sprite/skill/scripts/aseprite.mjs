/**
 * aseprite.mjs — an Aseprite-shaped sheet description, for engines that build
 * their animations from one.
 *
 * Ported from aldegad/sprite-gen (Apache-2.0) sprite_gen/compose/export_aseprite.py@fbd1a08:
 * the document shape — frames keyed by their global playback index "0"…"N-1",
 * each with its sheet rect and its own `duration` in ms, and one
 * `meta.frameTags` entry `{ name, from, to, direction: "forward" }` per
 * animation over a global frame range, `meta.format` "RGBA8888", `meta.scale`
 * "1". Phaser's `createFromAseprite` looks every tagged frame up by
 * `String(i)` and reads its `duration`; Flame's `fromAsepriteData` wants the
 * frames as a map. Changes: always the json-hash form (upstream defaults to
 * json-array; the hash is what Phaser, PixiJS and Flame all read); every frame
 * also carries `anchor` (and `pivot`, the same point) — the normalized point
 * the sprite stands on, which Phaser's hash parser (`anchor || pivot`) and
 * PixiJS 8 (`anchor`) turn into the frame's origin; the rects come from our
 * per-motion atlases rather than upstream's manifest `frame_layout`.
 *
 * Pure: layouts and JSON in, nothing read or written. `sprite-sheet.mjs
 * export --format aseprite` does the pixels.
 */

/**
 * One document over one sheet image.
 *
 * `tags`: the animations in order, each `{ name, frames: [{ rect: {x,y,w,h},
 * duration, anchor: {x,y} }] }`. Frames are numbered across tags in that
 * order, so tag i's range starts where tag i−1's ended.
 */
export function asepriteDocument({ image, size, tags }) {
  if (!Array.isArray(tags) || !tags.length) throw new RangeError("aseprite: no animations to describe");
  const frames = {};
  const frameTags = [];
  let index = 0;
  for (const tag of tags) {
    if (!tag || typeof tag.name !== "string" || !tag.name) throw new RangeError("aseprite: an animation has no name");
    if (!Array.isArray(tag.frames) || !tag.frames.length) throw new RangeError(`aseprite: '${tag.name}' has no frames`);
    if (frameTags.some((t) => t.name === tag.name)) throw new RangeError(`aseprite: two animations are named '${tag.name}'`);
    const from = index;
    for (const frame of tag.frames) {
      const { rect, duration, anchor } = frame;
      if (!(duration > 0)) throw new RangeError(`aseprite: '${tag.name}' frame ${index - from} has no duration`);
      const box = { w: rect.w, h: rect.h };
      frames[String(index)] = {
        frame: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
        rotated: false,
        trimmed: false,
        spriteSourceSize: { x: 0, y: 0, ...box },
        sourceSize: box,
        duration: Math.round(duration),
        anchor: { x: anchor.x, y: anchor.y },
        pivot: { x: anchor.x, y: anchor.y },
      };
      index++;
    }
    frameTags.push({ name: tag.name, from, to: index - 1, direction: "forward" });
  }
  return {
    frames,
    meta: {
      app: "pneuma-sprite",
      version: "1",
      image,
      format: "RGBA8888",
      size: { w: size.w, h: size.h },
      scale: "1",
      frameTags,
    },
  };
}

/**
 * Sheets stacked top to bottom, left-aligned: where each one's top-left lands
 * and the size of the whole. Each motion keeps its own packed sheet — and so
 * its atlas rects — intact, offset by its row.
 */
export function stackLayout(sizes) {
  let y = 0;
  let width = 0;
  const offsets = sizes.map((size) => {
    const at = { x: 0, y };
    y += size.height;
    width = Math.max(width, size.width);
    return at;
  });
  return { width, height: y, offsets };
}

/**
 * `count` cells of one size in a near-square grid, row-major — the same
 * `ceil(sqrt(n))` columns `pack` uses.
 */
export function gridLayout(count, cell) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.ceil(count / cols);
  return {
    width: cols * cell.width,
    height: rows * cell.height,
    rects: Array.from({ length: count }, (_, i) => ({
      x: (i % cols) * cell.width,
      y: Math.floor(i / cols) * cell.height,
      w: cell.width,
      h: cell.height,
    })),
  };
}

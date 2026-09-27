/**
 * mirror.mjs — what `sprite-sheet.mjs mirror` decides before a pixel moves:
 * whether a motion can be flipped into the other side at all, and where its
 * anchor lands once it is.
 *
 * Inspired by aldegad/sprite-gen docs/directional-anchor-workflow.md and
 * sprite_gen/gen/prepare.py (`build_generation_plan`'s mirrored directions,
 * the asymmetric-identity gate): a side covered by a mirror is not generated,
 * and a character whose hairpin, handed prop or one-sided marking would land
 * on the wrong side is not mirrored silently. Our design differs: upstream
 * leaves the flip to the game engine at runtime; here the flipped frames are
 * real files with their own atlas, registered as a motion whose frame i
 * derives from the source's frame i, so every export carries the direction
 * in its keys and the stage shows exactly what ships.
 *
 * Pure and zero-dependency: `sprite-sheet.mjs` flips the pixels (ffmpeg's
 * `hflip`, a lossless permutation) and packs them through the pipeline every
 * other motion goes through; this module holds the rules, so they are
 * testable without ffmpeg.
 */

/** The one flip a mirror makes: a side view into the other side. The same
 *  table `sprite-project.mjs` carries — the scripts are standalone files. */
export const MIRRORED = Object.freeze({ left: "right", right: "left" });

/**
 * Why `source` (a motion of the sidecar) cannot be mirrored, or null when it
 * can. These are the rules `register-run` enforces on a mirror summary
 * (`sprite-project.mjs` `mirrorSource`), asked here first so a mirror that
 * could never be registered writes nothing: a ready sprite motion — not a
 * loop, not a transition, not itself a mirror — that faces left or right.
 */
export function mirrorRefusal(source) {
  const id = source.id;
  if (source.kind === "loop" || source.kind === "transition") {
    return `'${id}' is a ${source.kind} — loops and transitions are not mirrored`;
  }
  if (source.source === "mirror") {
    return source.mirrorOf
      ? `'${id}' is itself a mirror of ${source.mirrorOf} — mirror ${source.mirrorOf} instead`
      : `'${id}' is declared a mirror (source: mirror) — mirror the motion it flips instead`;
  }
  if (source.status !== "ready") {
    return `'${id}' is ${source.status ?? "not registered"}, not ready — finish it before mirroring it`;
  }
  if (!MIRRORED[source.direction]) {
    return source.direction
      ? `'${id}' faces ${source.direction} — a mirror flips one side into the other; a ${source.direction} view flipped is still ${source.direction} with its hands swapped`
      : `'${id}' has no direction — say which side it faces first: sprite-project.mjs set-motion --motion ${id} --direction left|right`;
  }
  return null;
}

/**
 * The sentence naming what must never flip, or null. `character.asymmetric`
 * is one sentence ("the red hairpin is on her right side"): a mirror would
 * move exactly that to the other side, so `mirror` refuses without `--force`
 * and says the sentence back.
 */
export function asymmetry(character) {
  const sentence = typeof character?.asymmetric === "string" ? character.asymmetric.trim() : "";
  return sentence || null;
}

/**
 * The align record of the flipped frames, or null when the source has no
 * measured point to flip: the anchor at x → cell.width − x (a pixel edge at x
 * lands at width − x under a horizontal flip), y unchanged. `pack` reads this
 * record, so the mirror's atlas pivot is the mirrored point without a second
 * code path. `align` puts the anchor on the cell's centre line, where the flip
 * changes nothing; frames anchored any other way keep their true point.
 *
 * The source's atlas is the authority, as it is for every export: its
 * `meta.anchorPoint` (divided by `meta.scale`) is the point the source ships
 * with, and it survives where the record does not (the Lumi seed carries its
 * atlases without frames/align.json). The source's own `align.json` (`record`,
 * raw or null) only lends the fields `pack` does not read — pad, smooth,
 * xFrom — when it describes the same point, cell and anchor. An atlas without
 * `anchorPoint` declared the anchor's default, and so does the mirror: null.
 */
export function mirrorAnchorRecord({ record, atlas, cell, anchor, mirrorOf }) {
  const finite = (v) => typeof v === "number" && Number.isFinite(v);
  const meta = atlas && typeof atlas.meta === "object" && atlas.meta ? atlas.meta : {};
  const point = meta.anchorPoint;
  if (meta.anchor !== anchor || !finite(point?.x) || !finite(point?.y)) return null;
  const scale = finite(meta.scale) && meta.scale > 0 ? meta.scale : 1;
  const x = point.x / scale;
  const y = point.y / scale;
  const same = record && record.anchor === anchor
    && record.cell?.width === cell.width && record.cell?.height === cell.height
    && Math.abs(record.anchorPoint?.x - x) < 1e-6 && Math.abs(record.anchorPoint?.y - y) < 1e-6;
  return {
    ...(same ? record : { from: "atlas" }),
    anchor,
    cell: { width: cell.width, height: cell.height },
    anchorPoint: { x: cell.width - x, y },
    mirrorOf,
  };
}

/**
 * How the source's atlas was packed, so the mirror is packed the same way:
 * its anchor, its scale and how many frames sit in a row. Anything the atlas
 * does not state is null, and `pack`'s own default applies.
 */
export function atlasLayout(atlas) {
  const meta = atlas && typeof atlas.meta === "object" && atlas.meta ? atlas.meta : {};
  const anchor = meta.anchor === "bottom" || meta.anchor === "center" ? meta.anchor : null;
  const scale = typeof meta.scale === "number" && Number.isFinite(meta.scale) && meta.scale > 0 ? meta.scale : null;
  const frames = atlas && typeof atlas.frames === "object" && atlas.frames ? Object.values(atlas.frames) : [];
  const cellWidth = Number(frames[0]?.frame?.w);
  const sheetWidth = Number(meta.size?.w);
  const cols = cellWidth > 0 && sheetWidth > 0 ? Math.round(sheetWidth / cellWidth) : null;
  return { anchor, scale, cols: Number.isInteger(cols) && cols > 0 ? cols : null };
}

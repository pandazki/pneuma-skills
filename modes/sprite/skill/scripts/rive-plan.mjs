/**
 * rive-plan.mjs — what a character costs in Rive, decided before a pixel is
 * read.
 *
 * Every Rive runtime decodes every embedded image when the file LOADS
 * (`FileAssetImporter` calls `ImageAsset::decode` on each one), not when a
 * frame is shown. The cost is Σ width × height × 4 over the embedded frames,
 * paid up front whichever motion plays. A sprite motion is a dozen small
 * frames; a UI loop is cut at the clip's own rate and width — 230-300 frames
 * of 512 px at 60 fps for one character's loops, ~90 MB each as they are — so
 * a loop goes into a `.riv` resampled and downscaled.
 *
 * This module is the one statement of how: the frames a motion keeps at a
 * rate, the factor its frames shrink by, and the memory that leaves. Pure and
 * zero-dependency, because two consumers need the same numbers:
 * `sprite-sheet.mjs rive` follows the plan, and the sprite viewer's Export tab
 * imports this file to quote the plan before anyone asks for the file — a
 * panel with its own arithmetic would eventually promise a size the script
 * did not make.
 */

/** A loop's rate in a `.riv` unless `--fps` says otherwise. */
export const RIVE_LOOP_FPS = 24;

/**
 * How a `.riv` embeds its frames unless `--images` says otherwise. WebP, lossy
 * at quality 85: on tanka-connect (10 loops, 10 transitions, 320 px) it made a
 * 13.0 MB file where PNG made 81.1 MB, with the same 324.9 MB decoded. Every
 * Rive runtime decodes it — rive-runtime, the core the native runtimes share,
 * builds its own WebP decoder in (`decoders/src/decode_webp.cpp`). PNG stays
 * `--images png`, for frames that must be lossless.
 */
export const RIVE_DEFAULT_IMAGES = "webp";

/**
 * Whether `character.style` says pixel art. One reading, two uses: `rive
 * --filter auto` downscales pixel art nearest-neighbour, and `rive` embeds it
 * lossless by default — a lossy WebP stores colour at quarter resolution and
 * would put colours between the hard pixels nearest-neighbour just kept.
 */
export const RIVE_PIXEL_ART_STYLE = /pixel[\s-]*art|pixel[\s-]*(?:style|sprite|character)s?|\b(?:8|16|32)[\s-]?bit\b|像素/i;

/**
 * The image format a `.riv` embeds when `--images` is not given: lossless
 * WebP (`webp-lossless`: ARGB, no chroma subsampling — every visible pixel
 * exactly as drawn) for pixel art, lossy WebP for everything else.
 */
export function riveDefaultImages(style) {
  return RIVE_PIXEL_ART_STYLE.test(String(style ?? "")) ? "webp-lossless" : RIVE_DEFAULT_IMAGES;
}

/** A loop's longest edge in a `.riv` unless `--max-size` says otherwise. */
export const RIVE_LOOP_MAX_SIZE = 320;

/** Past this, the up-front decode is worth a warning. */
export const RIVE_DECODE_WARN_BYTES = 128 * 1024 * 1024;

/**
 * Past this, `rive` refuses. A phone browser tab is killed well before a
 * gigabyte, and a file that cannot open anywhere is not a deliverable.
 */
export const RIVE_DECODE_LIMIT_BYTES = 768 * 1024 * 1024;

/**
 * Whole megabytes of memory, 1 MB = 1024 × 1024 bytes — the unit the two
 * limits are set in and the one the viewer prints sizes in, so "128 MB" means
 * the same thing in a warning, a refusal and the Export tab.
 */
export function riveMB(bytes) {
  return Math.round(bytes / 1024 / 1024);
}

/** The warning for a decode estimate, or null when it is within budget. */
export function riveDecodeWarning(bytes) {
  if (!(bytes > RIVE_DECODE_WARN_BYTES)) return null;
  return `the runtime decodes every frame when the file loads: about ${riveMB(bytes)} MB of memory before anything plays (over ${riveMB(RIVE_DECODE_WARN_BYTES)} MB) — lower --fps or --max-size, or pass fewer motions with --motions`;
}

/**
 * Which source frames a motion keeps at `fps`, and the rate it ends up at.
 *
 * The motion's duration stays: `round(count × fps / sourceFps)` frames. A
 * LOOP takes `floor(i × count / kept)`: frame 0 first, evenly spaced, and the
 * step from the last kept frame back to frame 0 is one of the steps the loop
 * takes anyway — the source's own last frame is already one step short of
 * its first, so no frame is doubled at the wrap. A ONE-SHOT takes
 * `round(i × (count − 1) / (kept − 1))`, which keeps its last frame: it ends
 * on a pose and hands over from there.
 *
 * A rate at or above the motion's own keeps every frame: more frames than
 * there are would only repeat them, at full memory cost.
 */
export function riveSampleFrames(count, sourceFps, fps, loop) {
  const every = { fps: sourceFps, indices: Array.from({ length: count }, (_, i) => i) };
  if (!(fps > 0) || !(sourceFps > 0) || fps >= sourceFps) return every;
  const kept = Math.max(1, Math.round((count * fps) / sourceFps));
  if (kept >= count) return every;
  const indices = loop || kept === 1
    ? Array.from({ length: kept }, (_, i) => Math.floor((i * count) / kept))
    : Array.from({ length: kept }, (_, i) => Math.round((i * (count - 1)) / (kept - 1)));
  return { fps, indices };
}

/**
 * The one factor a set of frames shrinks by so the largest fits `maxSize` on
 * its longest edge. One factor for the set, not one per frame size: a loop
 * with a thought bubble is taller than the others, and fitting each on its
 * own would draw the character smaller in that motion. Never enlarges.
 *
 * A size may carry `clipScale`: how many of its pixels stand for one pixel of
 * the clip it was cut from (`loop` crops each clip to its own union box and
 * then scales that box to one width, so two loops of the same character come
 * out at different scales). The factor is then in CLIP pixels — each frame
 * is first divided by its clipScale, so every loop is measured at the one
 * scale the clips share — and it stops at the smallest clipScale, so no set
 * of frames is ever drawn larger than it was cut (the loop cut closest to
 * its clip's scale keeps its frames when `maxSize` allows). Without clipScale a size is
 * taken as it is (clipScale 1), which is the whole rule for sprite motions.
 */
export function riveScaleFactor(sizes, maxSize) {
  if (!sizes.length) return 1;
  const clip = sizes.map((s) => (s.clipScale > 0 ? s.clipScale : 1));
  // Never past the frames as cut: every motion's own scale is factor / clipScale ≤ 1.
  const ceiling = Math.min(...clip);
  if (!(maxSize > 0)) return ceiling;
  const longest = Math.max(...sizes.map((s, i) => Math.max(s.width, s.height) / clip[i]));
  return Math.min(ceiling, maxSize / longest);
}

/**
 * The plan for a set of motions.
 *
 * `motions`: `[{ id, kind: "sprite" | "loop" | "transition", loop, fps, frames,
 * width, height, clipScale?, reverseOf? }]` — the frame count, rate and frame
 * size as registered; for a loop or a transition whose scale against its clip
 * is known, that scale (see `riveScaleFactor`); for a transition that plays
 * another backwards, the one it plays.
 * `options.fps` / `options.maxSize`: the caller's `--fps` / `--max-size`, or
 * null. Loops and transitions fall back to 24 fps and 320 px; a sprite
 * motion keeps its own rate and size unless the caller named one.
 *
 * Two groups each shrink by ONE factor of their own, so the character stays
 * one size across a group's motions: sprite motions share the character's
 * cell; loops and the transitions between them share their clips' scale once
 * each is divided by its clipScale. A motion's `scale` is what its own
 * frames are multiplied by — the group's factor over its clipScale. Across
 * groups the pipeline never related the two scales, and this does not
 * pretend to. A transition samples as a one-shot: its first and last frames
 * are the loops' frame 0s it joins, and they are always kept.
 *
 * A reverse whose source is in the same file SHARES the source's images —
 * its frames are the source's kept frames in reverse order, `shares` names
 * the source, and it adds nothing to `decodeBytes`: every runtime decodes an
 * embedded image once, however many timelines show it.
 */
export function rivePlan(motions, { fps = null, maxSize = null } = {}) {
  const settings = {
    loop: { fps: fps ?? RIVE_LOOP_FPS, maxSize: maxSize ?? RIVE_LOOP_MAX_SIZE },
    sprite: { fps, maxSize },
  };
  const kindOf = (motion) => (motion.kind === "loop" || motion.kind === "transition" ? motion.kind : "sprite");
  const groupOf = (motion) => (kindOf(motion) === "sprite" ? "sprite" : "loop");
  const factor = {};
  for (const group of ["loop", "sprite"]) {
    factor[group] = riveScaleFactor(
      motions.filter((m) => groupOf(m) === group).map((m) => ({ width: m.width, height: m.height, clipScale: m.clipScale })),
      settings[group].maxSize,
    );
  }
  const own = (motion) => {
    const group = groupOf(motion);
    const sampled = riveSampleFrames(motion.frames, motion.fps, settings[group].fps, motion.kind === "transition" ? false : motion.loop);
    const clipScale = motion.clipScale > 0 ? motion.clipScale : null;
    const scale = factor[group] / (clipScale ?? 1);
    const width = Math.max(1, Math.round(motion.width * scale));
    const height = Math.max(1, Math.round(motion.height * scale));
    return {
      id: motion.id,
      kind: kindOf(motion),
      loop: motion.kind === "transition" ? false : !!motion.loop,
      source: { frames: motion.frames, fps: motion.fps, width: motion.width, height: motion.height },
      fps: sampled.fps,
      frames: sampled.indices.length,
      indices: sampled.indices,
      width,
      height,
      scale,
      clipScale,
      decodeBytes: sampled.indices.length * width * height * 4,
    };
  };
  const byId = new Map(motions.map((m) => [m.id, m]));
  const sharesWith = (motion) => {
    const source = motion.kind === "transition" && motion.reverseOf ? byId.get(motion.reverseOf) : undefined;
    return source && source.kind === "transition" && !source.reverseOf && source.frames === motion.frames ? source : undefined;
  };
  const first = new Map(motions.filter((m) => !sharesWith(m)).map((m) => [m.id, own(m)]));
  const planned = motions.map((motion) => {
    const source = sharesWith(motion);
    if (!source) return first.get(motion.id);
    const shared = first.get(source.id);
    return {
      ...shared,
      id: motion.id,
      shares: source.id,
      source: { frames: motion.frames, fps: motion.fps, width: motion.width, height: motion.height },
      // Frame r of the reverse IS frame (count − 1 − r) of the source.
      indices: shared.indices.map((i) => motion.frames - 1 - i).reverse(),
      clipScale: motion.clipScale > 0 ? motion.clipScale : shared.clipScale,
      decodeBytes: 0,
    };
  });
  return {
    settings,
    motions: planned,
    decodeBytes: planned.reduce((sum, m) => sum + m.decodeBytes, 0),
  };
}

/**
 * Whether a registered reverse transition still shows its source backwards,
 * so the `.riv` can draw it from the source's images (see `rivePlan`).
 *
 * Frame ids are reused when a transition is cut again, so matching ids prove
 * nothing. Time does: frame r of the reverse was derived (`step: "reverse"`)
 * from the source's frame n − 1 − r, and a source registered again since then
 * has newer frames than that edge. The reverse still holds the old pictures;
 * sharing the new ones would quietly change what it shows.
 *
 * `reverse` and `source` are `{ frames: assetId[] }`; `edgeOf(assetId)` is the
 * frame's provenance edge; `createdAt(assetId)` its asset's registration time.
 */
export function riveReverseIsCurrent(reverse, source, { edgeOf, createdAt }) {
  const n = source.frames.length;
  if (!n || reverse.frames.length !== n) return false;
  return reverse.frames.every((id, r) => {
    const edge = edgeOf(id);
    const from = source.frames[n - 1 - r];
    const made = Number(edge?.operation?.timestamp);
    const shot = Number(createdAt(from));
    return edge?.fromAssetId === from
      && edge.operation?.params?.step === "reverse"
      && Number.isFinite(made) && Number.isFinite(shot) && shot <= made;
  });
}

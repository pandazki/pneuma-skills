/**
 * stage-measure.ts (C1) — the ONE G8-J funnel: every rect reading that
 * falls back to board coordinates goes through here.
 *
 * The rule it enforces: once the stage wears a CSS transform, the two
 * measurement families part ways — and part QUIETLY:
 *
 *   - getBoundingClientRect        -> RENDERED coordinates (transformed)
 *   - offset* / client* / scroll*  -> layout values (never transformed)
 *
 * Mixing them in one formula is exactly correct at zoom 1 and silently
 * wrong at every other zoom, so it never shows up in development — it
 * detonates the first time a user pinches. Hence G8-J: any rect reading
 * bound for board coordinates is divided by the accumulated scale measured
 * in the SAME frame (`rect.width / offsetWidth` — numerator and
 * denominator from the same instant, so the value is self-consistent even
 * while a transform is mid-flight; a React-state z would lag a frame).
 *
 * The teeth live in stage-measure.test.ts: a source scan pins
 * `getBoundingClientRect` + "(" to this file plus a named exemption list.
 * (Precedent: engine/factories/svg.ts::el() made G8-D a throw.)
 *
 * Interfaces are structural minima so the arithmetic is testable with
 * plain objects — happy-dom has no layout to measure.
 */

import type { RectLike } from "../engine/factories/ink.js";
import { FLAW_FLAG } from "../engine/flaw.js";

/** The slice of DOMRect the funnel consumes. */
export interface ClientRectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface RectReader {
  getBoundingClientRect(): ClientRectLike;
}

/** A base whose layout width anchors the same-frame scale measurement. */
export interface LayoutRectReader extends RectReader {
  offsetWidth: number;
}

/**
 * Empirical accumulated scale of `base`, measured this frame. Reads 1 for
 * anything outside the stage (the viewport, the measure layer — G8-K), and
 * 1 on degenerate layout (unmounted, zero width) rather than NaN.
 */
export function liveScale(base: LayoutRectReader): number {
  const width = base.getBoundingClientRect().width;
  return base.offsetWidth > 0 && width > 0 ? width / base.offsetWidth : 1;
}

/**
 * Screen rects of `targets`, expressed in `base`'s BOARD coordinates: the
 * base origin subtracted, then divided by the base's same-frame scale. One
 * base reading serves the whole batch — one scale, one origin, one frame.
 *
 * At scale 1 the divide is division by exactly 1.0 (bit-identity), which
 * is what keeps the C1 layout baseline byte-for-byte at rest.
 *
 * `depth` is REQUIRED, and required rather than optional on purpose (V1.5).
 * The divide undoes a uniform scale; a 3D rotation is projective and no
 * scalar undoes it, so a reading taken through a tilted ancestor is simply
 * wrong — and the wrongness is silent, board-shaped and driven by the
 * MOUSE. Making the parameter mandatory turns "remember to suspend the
 * depth surface" from a discipline into a compile error, which is the same
 * move `el()` made for G8-D: the second call site in this codebase was
 * found by measurement, not by review, and it inflated every box in the
 * fold by reading `rect.bottom - rect.top` through a 4° tilt.
 * Pass `null` from anywhere that provably has no depth surface above it.
 */
export function boardRects(
  base: LayoutRectReader,
  targets: readonly RectReader[],
  depth: SuspendableLayer | null | undefined,
  flaw: QuietableSurface | null | undefined,
): RectLike[] {
  return withFlawSuspended(flaw, () =>
    withDepthSuspended(depth, () => {
    const b = base.getBoundingClientRect();
    const scale =
      base.offsetWidth > 0 && b.width > 0 ? b.width / base.offsetWidth : 1;
    return targets.map((target) => {
      const r = target.getBoundingClientRect();
      return {
        left: (r.left - b.left) / scale,
        top: (r.top - b.top) / scale,
        right: (r.right - b.left) / scale,
        bottom: (r.bottom - b.top) / scale,
      };
    });
    }),
  );
}

/**
 * Horizontal distance from `b` to `a` in `base`'s board px — the align
 * probe's one measurement. The probe runs inside the measure host, which
 * G8-K pins at scale 1, so the divide is belt-and-braces; routing it here
 * anyway keeps BoardCanvas at ZERO raw rect reads.
 */
export function deltaLeft(
  base: LayoutRectReader,
  a: RectReader,
  b: RectReader,
): number {
  return (
    (a.getBoundingClientRect().left - b.getBoundingClientRect().left) /
    liveScale(base)
  );
}

/**
 * An element whose INLINE transform can be lifted for the duration of one
 * measurement. Structural minimum on purpose — the arithmetic above is
 * testable with plain objects, and so is this.
 */
export interface SuspendableLayer {
  style: { transform: string };
}

/**
 * Run `read` with the depth surface's transform lifted (V1.5).
 *
 * G8-J's divide undoes a UNIFORM scale, which is all the camera ever
 * applies: `translate(...) scale(z)` maps every interior offset by the same
 * factor, so one same-frame scalar recovers board px exactly. A 3D rotation
 * under perspective is PROJECTIVE — interior points move by different
 * factors depending on their depth — and no single scalar can undo it. A
 * back reference measured while the board is tilted would therefore land
 * its ink beside its target, and the tilt is driven by the MOUSE: the ink
 * would drift as the reader moved. That is the failure brief §5.2-2 names.
 *
 * So the fix is not a correction, it is an exclusion: the depth surface is
 * lifted for the whole batch and restored before control leaves this
 * function. `getBoundingClientRect` flushes pending style and layout, so
 * the read inside sees the flat board; nothing is painted in between, so
 * the reader sees no flicker. `finally` is load-bearing — a throwing read
 * must not leave a board stuck flat.
 *
 * Wrap the WHOLE batch, never a single rect: base and targets must be
 * quoted from the same frame in the same pose (the funnel's one-scale,
 * one-origin, one-frame rule).
 */
export function withDepthSuspended<T>(
  layer: SuspendableLayer | null | undefined,
  read: () => T,
): T {
  if (!layer) return read();
  const saved = layer.style.transform;
  if (saved === "") return read();
  layer.style.transform = "";
  try {
    return read();
  } finally {
    layer.style.transform = saved;
  }
}

/**
 * The board surface, whose ONE `data-bansho-flawed` attribute gates the
 * whole 瑕疵 layer (W3). Structural minimum, like `SuspendableLayer`.
 */
export interface QuietableSurface {
  readonly dataset: Record<string, string | undefined>;
}

/**
 * Run `read` with the imperfection layer lifted (W3).
 *
 * The 瑕疵 layer tilts, shears and drifts what the reader SEES. Every one
 * of those is a CSS transform, so `getBoundingClientRect` reports the
 * leaned box while `offset*` keeps reporting the canonical one — the exact
 * split this file exists for, arriving from a second direction. Measured
 * through a 0.3° lean, a step's `rect.bottom - rect.top` comes back taller
 * than the box CSS laid out; the fold would charge that inflated height,
 * the next box would start lower, and the board would grow a little every
 * time somebody nudged the knob. That is V1.5's parallax bug wearing a
 * different hat, and it gets V1.5's answer: the parameter is REQUIRED, so
 * forgetting to lift the layer is a compile error rather than a board that
 * grows when a theme is edited.
 *
 * One attribute, one write, one restore — which is why the layer is driven
 * by a gated stylesheet rule over per-node custom properties instead of by
 * N inline transform strings. `finally` is load-bearing: a throwing read
 * must not leave a board stuck clean.
 */
export function withFlawSuspended<T>(
  surface: QuietableSurface | null | undefined,
  read: () => T,
): T {
  if (!surface) return read();
  const saved = surface.dataset[FLAW_FLAG];
  if (saved === undefined) return read();
  delete surface.dataset[FLAW_FLAG];
  try {
    return read();
  } finally {
    surface.dataset[FLAW_FLAG] = saved;
  }
}

/**
 * A client point relative to the viewport's rendered origin, in screen px
 * (the anchored-zoom input). The viewport is the ancestor of every
 * transformed surface — the depth layer and the stage both sit inside it,
 * and it wears nothing itself — so this is an origin shift, not a scale
 * conversion; the screen->board divide happens in camera.ts against the
 * model z.
 */
export function viewportPoint(
  viewport: RectReader,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const r = viewport.getBoundingClientRect();
  return { x: clientX - r.left, y: clientY - r.top };
}

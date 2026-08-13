/**
 * Shared multi-segment pen sequencing (G8-B, T3).
 *
 * Layering (G2): engine core — imports only sibling engine modules.
 *
 * A single reveal BEAT may cover several drawn segments (a `==…==` mark
 * wrapping across lines splits into one shape per line). The single-pen
 * invariant reaches inside the beat too: segments are performed strictly
 * one after another in the order given (rows are passed top-first — the
 * pen finishes the first line before starting the second), each segment
 * getting a slice of the beat proportional to its drawn length, and each
 * slice eased with the pen's own character (every stroke keeps its
 * personality). Overall progress stays strictly monotone in `p` because
 * slices are disjoint and the per-slice easing is monotone (G8-H).
 */

import type { Easing } from "../easing.js";

/** One drawable segment of a beat: its length share + its visual writer. */
export interface PenSegment {
  /** Drawn length (px-ish) — only the RATIO between segments matters. */
  length: number;
  /** Apply eased progress e ∈ [0,1] to the visual (idempotent write). */
  apply(e: number): void;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Project beat progress `p` onto every segment. Zero-length segments pop
 * into place the instant the pen reaches them; a fully degenerate beat
 * (all lengths 0 — e.g. an unlaid-out measure host) falls back to equal
 * shares so progress still flows and parity semantics hold.
 */
export function seekSequence(
  segments: readonly PenSegment[],
  ease: Easing,
  p: number,
): void {
  const n = segments.length;
  if (n === 0) return;
  let total = 0;
  for (const s of segments) total += s.length > 0 ? s.length : 0;
  let acc = 0;
  for (const s of segments) {
    const share = total > 0 ? (s.length > 0 ? s.length : 0) / total : 1 / n;
    const local =
      share > 0 ? clamp01((p - acc) / share) : p > acc || p >= 1 ? 1 : 0;
    s.apply(ease(local));
    acc += share;
  }
}

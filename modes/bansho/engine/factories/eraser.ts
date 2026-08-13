/**
 * Eraser (C3) — the reveal unit that takes content OFF the board.
 *
 * Layering (G2): engine core — imports only sibling engine modules.
 *
 * THE EXCLUSIVE CHANNEL (G8-L, hard rule): the eraser styles ONE element —
 * the run wrapper the host dedicates to it — and writes ONE property on it
 * (`clipPath`). It never touches anything a reveal strategy owns: the
 * strategies style factory-built nodes INSIDE the wrapper (opacity for
 * fade, clip-path for wipe, dashoffset for stroke — on their own
 * elements), so the two state families are disjoint by construction. The
 * failure this closes is real and silent: had erase hidden content with
 * `opacity`, a scrub landing inside a fade's own reveal window would
 * dispatch `C.seek(0.5)` (opacity 0.5) then `E.seek(0)` ("restore"
 * opacity 1) and the half-revealed step would blow to fully visible.
 *
 * `seek(p)`: p = 0 removes the eraser's own state (clipPath cleared —
 * whatever the inner reveal states say, shows); p = 1 hides everything;
 * in between, the sweep front moves left → right with a seeded, jittered
 * edge — eraser streaks, not a shutter. Monotone easing (G8-H),
 * idempotent style writes, deterministic per seed (scrubbing never makes
 * the streaks dance).
 *
 * The target arrives as a LIVE RESOLVER (`EraseTargetHandle`), never a
 * captured element — see the handle's contract in engine/types.ts (the
 * R4-family relink rule made structural).
 */

import { mulberry32 } from "../sketch/index.js";
import type {
  EraseTargetHandle,
  Revealable,
  RevealableFactory,
  SrcSpan,
} from "../types.js";
import { planStepUnits } from "../inference.js";

/**
 * The eraser's hand: brisk into the sweep, easing off as the board comes
 * clean — strictly monotone on [0,1] with exact endpoints (G8-H).
 */
export function easeEraser(p: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  return 1 - Math.pow(1 - p, 1.9);
}

/** Rows of the sweep front (jitter samples down the wrapper's height). */
const EDGE_ROWS = 6;
/** Horizontal jitter amplitude of the sweep front (% of width). */
const EDGE_AMP = 3.5;
/** Fully hidden — the terminal state is exact, never a jittered sliver. */
const HIDDEN = "inset(0 0 0 100%)";

export interface EraserOptions {
  duration: number;
  srcSpan: SrcSpan;
  /** Deterministic jitter seed — scrub replays the same streaks. */
  seed: number;
}

/**
 * The erase reveal unit over a run wrapper. Unresolvable targets are a
 * quiet no-op per seek (schedule parity kept) — the host's post-rebuild
 * `seek(playhead)` re-applies the correct state the moment the wrapper
 * exists.
 */
export function eraserReveal(
  handle: EraseTargetHandle,
  opts: EraserOptions,
): Revealable {
  // The sweep front's shape is fixed at build (seeded), only its position
  // moves with p — same p, byte-identical clip string, forever.
  const rnd = mulberry32(opts.seed >>> 0);
  const jitter: number[] = [];
  for (let i = 0; i <= EDGE_ROWS; i++) jitter.push((rnd() * 2 - 1) * EDGE_AMP);

  const clipAt = (p: number): string => {
    if (p <= 0) return "";
    if (p >= 1) return HIDDEN;
    const base = easeEraser(p) * (100 + 2 * EDGE_AMP) - EDGE_AMP;
    // Visible region = right of the sweep front: down the right edge,
    // back across the bottom, then up the jittered front.
    const pts: string[] = ["100% 0%", "100% 100%"];
    for (let i = EDGE_ROWS; i >= 0; i--) {
      const x = Math.min(100, Math.max(0, base + jitter[i]!));
      const y = (i / EDGE_ROWS) * 100;
      pts.push(`${x.toFixed(2)}% ${y.toFixed(2)}%`);
    }
    return `polygon(${pts.join(", ")})`;
  };

  return {
    naturalDuration: opts.duration,
    kind: "wipe",
    srcSpan: opts.srcSpan,
    seek(p: number): void {
      const el = handle.resolve();
      if (!el) return;
      el.style.clipPath = clipAt(p);
    },
  };
}

/** Inert unit for an erase whose board cannot be resolved (empty board,
 *  notes view, fold not run) — schedule parity, nothing drawn. */
const degradedUnit = (duration: number, srcSpan: SrcSpan): Revealable => ({
  naturalDuration: duration,
  kind: "fade",
  degraded: true,
  srcSpan,
  seek: () => {},
});

/**
 * The `@erase` step's factory. Builds 1:1 with `planStepUnits` (one erase
 * unit); the target handle enters through the `MeasureContext.eraseTarget`
 * seam — the fold's verdict, which the step value alone cannot know.
 */
export const eraseFactory: RevealableFactory = {
  kind: "erase",
  build(step, ctx) {
    const node = ctx.document.createElement("span");
    node.style.display = "none";
    const [plan] = planStepUnits(step, ctx.durations);
    const duration = plan?.duration ?? ctx.durations.erase;
    const handle = ctx.eraseTarget?.(step);
    return {
      node,
      revealables: [
        handle
          ? eraserReveal(handle, {
              duration,
              srcSpan: step.srcSpan,
              seed: step.srcSpan.start,
            })
          : degradedUnit(duration, step.srcSpan),
      ],
    };
  },
};

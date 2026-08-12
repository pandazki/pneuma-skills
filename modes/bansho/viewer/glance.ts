/**
 * `glance-board` (S1 §6) — the look-up action's timing core, extracted
 * from the React shell so the wait semantics are testable with fakes
 * (the narration-actions pattern: pure halves in modules, thin runner).
 *
 * The loop this makes reliable BY CONSTRUCTION rather than by discipline:
 * the agent appends, looks up, and the answer must be about the board
 * that includes the append — or say honestly that it is not.
 *
 * Two gaps, two treatments (§6):
 *  - gap A (emit arrived, rebuild pending): the basis's source trails the
 *    live parse — wait for the next compile;
 *  - gap B (write landed on disk, watcher event in flight): the viewer
 *    cannot see it — so it LOOKS, via the host's disk probe. A probe that
 *    cannot answer accuses nothing and blocks nothing (the M3 posture).
 *
 * Bounded at `SNAPSHOT_WAIT_MS`; on timeout the answer is the current
 * basis marked "catching-up" — the render's honest tail line. The answer
 * never lies and never hangs the agent.
 */

import type { ViewerActionResult } from "../../../core/types/viewer-contract.js";
import { foldBoardLayout, type LayoutStepInput } from "../engine/layout.js";
import type { Lecture } from "../engine/types.js";
import {
  deriveBoardSnapshot,
  emptyBoardSnapshot,
  renderSnapshot,
} from "./board-snapshot.js";

/**
 * What one snapshot answer is derived FROM (S1 §6/§8): the fold inputs of
 * the last build plus the geometry facts the projection needs. `source`
 * is the wait loop's compare handle; `lecture` is the same build's parse
 * (labels and excerpts must come from the document the inputs were keyed
 * against, never a newer parse the fold has not caught up with).
 */
export interface SnapshotBasis {
  inputs: LayoutStepInput[];
  count: number;
  budget: number;
  /**
   * W2 — the room's flow column count for this face. Carried on the basis
   * rather than recomputed here: the glance must fold the SAME board the
   * reader is looking at, and the count is a function of the measured face
   * width, which only the host has read.
   */
  columns: number;
  source: string;
  lecture: Lecture;
}

/** §6 — the bounded wait for the board to catch up to board.md. */
export const SNAPSHOT_WAIT_MS = 2000;

/** The seams the timing core needs from the shell — fakeable wholesale. */
export interface GlanceHost {
  /** The live parse's source; null when no board is open. */
  liveSource(): string | null;
  /** The last build's basis (BoardApi.readSnapshotBasis); null pre-build. */
  readBasis(): SnapshotBasis | null;
  /** The on-disk board.md, or null when the probe cannot answer —
   *  bounded by the host; a failed probe accuses nothing (§6 step 1). */
  probeDisk(): Promise<string | null>;
  /** Resolves on the next compile or after `ms`, whichever comes first. */
  waitForCompile(ms: number): Promise<void>;
  now(): number;
}

export async function glanceBoard(
  host: GlanceHost,
  waitMs = SNAPSHOT_WAIT_MS,
): Promise<ViewerActionResult> {
  if (host.liveSource() === null) {
    return {
      success: true,
      message: "The board is empty — nothing is standing yet.",
      data: { ...emptyBoardSnapshot() },
    };
  }
  const deadline = host.now() + waitMs;
  const disk = await host.probeDisk();

  const fresh = (): boolean => {
    const basis = host.readBasis();
    const live = host.liveSource();
    return (
      basis !== null &&
      live !== null &&
      basis.source === live &&
      (disk === null || disk === live)
    );
  };

  while (!fresh() && host.now() < deadline) {
    await host.waitForCompile(Math.max(0, deadline - host.now()));
  }

  const basis = host.readBasis();
  if (!basis) {
    // Mounted but never built (fonts still loading, measurements voided):
    // an honest refusal, mirroring the subtitles action's posture.
    return {
      success: false,
      message: "The board is still being measured — ask again in a moment.",
    };
  }
  const layout = foldBoardLayout(
    basis.inputs,
    basis.count,
    basis.budget,
    undefined,
    0,
    basis.columns,
  );
  const snapshot = deriveBoardSnapshot(
    basis.lecture,
    layout,
    basis.inputs,
    basis.budget,
    fresh() ? "complete" : "catching-up",
  );
  return {
    success: true,
    message: renderSnapshot(snapshot),
    data: { ...snapshot },
  };
}

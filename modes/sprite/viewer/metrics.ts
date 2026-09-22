/**
 * The numbers the header and the inspect block say — and what counts as over.
 *
 * Two round-2 findings live here. The first is that "how big is this sprite"
 * had three different answers on screen and no relation between them: the
 * header printed the DECLARED cell (`character.cell`, a target the agent sets
 * once), the inspect block printed the MEASURED cell (what the frames on disk
 * actually are), and the atlas tab printed the PACKED sheet — so a user who
 * asked for 128 px saw 128, 250 and 500 in three places and no sentence
 * saying 128 had become 125. `sizeLine` is that sentence's data: one phrase,
 * declared → measured → the pack's own scale.
 *
 * The second is that a bare "SCALE DRIFT 27.9%" tells nobody whether the
 * pipeline is unhappy — three testers watched an agent call warnings
 * ignorable while the viewer showed the same numbers with no scale beside
 * them. The thresholds below are the pipeline's own constants
 * (`sprite-sheet.mjs`: `MAX_SCALE_DRIFT`, `MAX_JUMP_FRACTION`,
 * `MAX_BODY_DRIFT_FRACTION`), duplicated here on purpose: the viewer must be
 * able to colour a value without running the script, and a number that
 * disagrees with the script's own warning would be worse than none.
 */

import type { CharacterProject, InspectSummary, Motion } from "../domain.js";
import type { AtlasGeometry } from "./atlas.js";

/** The inspect step's thresholds, verbatim from `sprite-sheet.mjs`. */
export const THRESHOLDS = {
  /** `scaleDrift` is a fraction of the mean bbox height. */
  scaleDrift: 0.15,
  /** `maxJump` and `bodyDrift` are px, judged against the cell WIDTH. */
  maxJumpFraction: 0.08,
  bodyDriftFraction: 0.05,
} as const;

/**
 * The DECLARED cell — a target the user usually said in one number ("make it
 * 128"), so a square one is printed the way they said it.
 */
export function cellText(cell: { width: number; height: number }): string {
  if (cell.width <= 0 || cell.height <= 0) return "";
  return cell.width === cell.height
    ? String(cell.width)
    : `${cell.width}×${cell.height}`;
}

/**
 * A MEASURED cell, always as both axes. Collapsing `250×250` to `250` would
 * make a measurement read like the target it is being compared against —
 * and the whole point of the phrase is that the two can differ.
 */
export function measuredCellText(cell: {
  width: number;
  height: number;
}): string {
  if (cell.width <= 0 || cell.height <= 0) return "";
  return `${cell.width}×${cell.height}`;
}

export interface SizeLine {
  /** `character.cell` — the target the agent declared. */
  declared: string | null;
  /** `inspect.cell` — what the frames on disk measure. */
  measured: string | null;
  /** `pack --scale`, when it was not 1 (and when it is knowable). */
  packedScale: number | null;
}

/**
 * The one size phrase, as data.
 *
 * Every part is optional because every part can genuinely be unknown: a
 * character before its first run has a declared cell and nothing else, and a
 * motion whose frames carry no recorded size has no pack scale to report.
 * An unknown part is left out, never defaulted — a `×1` invented for a sheet
 * nobody measured would claim a fact.
 */
export function sizeLine(
  project: CharacterProject | null,
  motion: Motion | null,
  geometry: AtlasGeometry | null,
): SizeLine {
  const declaredCell = project?.sprite.character.cell;
  const declared = declaredCell ? cellText(declaredCell) || null : null;
  const inspect = motion?.inspect;
  const measured = inspect ? measuredCellText(inspect.cell) || null : null;
  const scale = geometry && geometry.trusted ? geometry.scale : null;
  return {
    declared,
    measured,
    packedScale: scale !== null && scale !== 1 ? scale : null,
  };
}

// ── Thresholds ─────────────────────────────────────────────────────────────

/** A measured value, the bar it is judged against, and the verdict. */
export interface MetricVerdict {
  /** The threshold in the value's own unit; null when the cell is unknown. */
  limit: number | null;
  over: boolean;
}

const verdict = (value: number, limit: number | null): MetricVerdict => ({
  limit,
  over: limit !== null && value > limit,
});

export function scaleDriftVerdict(inspect: InspectSummary): MetricVerdict {
  return verdict(inspect.scaleDrift, THRESHOLDS.scaleDrift);
}

/** The jump bar is a fraction of the cell WIDTH, so an unmeasured cell has no
 *  bar at all — a fixed px limit would be a different claim on every sheet. */
export function maxJumpVerdict(inspect: InspectSummary): MetricVerdict {
  const cell = inspect.cell.width;
  return verdict(
    inspect.maxJump,
    cell > 0 ? round2(THRESHOLDS.maxJumpFraction * cell) : null,
  );
}

/**
 * `bodyDrift` — the feet-centre std-dev `align --x-from feet` was built to
 * kill — is measured by `inspect`, carried into the sidecar by `register-run`
 * and declared on `InspectSummary` (optional: motions registered before the
 * metric existed have none). The row stays absent, rather than showing a
 * fabricated 0, when the sidecar carries no number.
 */
export function bodyDriftOf(inspect: InspectSummary): number | null {
  const value = inspect.bodyDrift;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function bodyDriftVerdict(inspect: InspectSummary): MetricVerdict {
  const cell = inspect.cell.width;
  const value = bodyDriftOf(inspect) ?? 0;
  return verdict(
    value,
    cell > 0 ? round2(THRESHOLDS.bodyDriftFraction * cell) : null,
  );
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

// ── A loop's own numbers ───────────────────────────────────────────────────

/**
 * The seam, the step and the alpha coverage, finite-or-null.
 *
 * Same discipline as `bodyDriftOf`: 0 is a real reading for each of them — a
 * loop that closes exactly, a motion that never moves, a frame with nothing in
 * it — so a missing measurement must come out as null and leave the row off
 * the block, never as a confident zero.
 */
const finite = (value: number | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export function seamOf(inspect: InspectSummary): number | null {
  return finite(inspect.seam);
}

export function stepOf(inspect: InspectSummary): number | null {
  return finite(inspect.step);
}

export function alphaCoverageOf(inspect: InspectSummary): number | null {
  return finite(inspect.alphaCoverage);
}

/**
 * Does the loop close?
 *
 * The bar is the pipeline's own: a seam worth more than TWICE the median
 * frame-to-frame step reads as a jump when the animation wraps, and `loop`
 * warns about exactly that. The bar therefore moves with the motion — a slow
 * sway forgives less than a flicker — which is why it is computed from the
 * step rather than fixed. No step, no bar: a single-frame or unmeasured loop
 * is not judged, it is simply not judged YET.
 */
export const SEAM_STEP_FACTOR = 2;

export function seamVerdict(inspect: InspectSummary): MetricVerdict {
  const seam = seamOf(inspect);
  const step = stepOf(inspect);
  const limit = step === null ? null : round4(SEAM_STEP_FACTOR * step);
  return { limit, over: limit !== null && seam !== null && seam > limit };
}

const round4 = (value: number): number => Math.round(value * 1e4) / 1e4;

/** How long the loop runs, in seconds — frames over fps. Null when either is
 *  missing: a duration of 0 would read as a clip with nothing in it. */
export function loopDuration(frames: number, fps: number): number | null {
  if (!(frames > 0) || !(fps > 0)) return null;
  return Math.round((frames / fps) * 100) / 100;
}

/** `1.8 MB` — the size beside a download link. Binary units, one decimal, and
 *  null for a file whose size nobody recorded (a link with no size is honest;
 *  "0 B" is not). */
export function formatBytes(bytes: number | null | undefined): string | null {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** The header phrase for a loop: what it measures, and how long it runs. */
export interface LoopLine {
  /** `inspect.cell` — what the frames on disk actually are. */
  measured: string | null;
  frames: number;
  fps: number;
}

/**
 * A loop's size phrase.
 *
 * `sizeLine`'s three parts answer a sprite motion's question ("the cell I
 * asked for, the cell I got, what the pack did to it"). A loop has no declared
 * cell and no pack: it is cropped to its own content and delivered at whatever
 * that is, so the useful facts are the measured size and the length of the
 * cycle.
 */
export function loopLine(motion: Motion): LoopLine {
  const inspect = motion.inspect;
  const measured = inspect ? measuredCellText(inspect.cell) || null : null;
  return {
    measured,
    frames: motion.frames.length || inspect?.frameCount || 0,
    fps: motion.fps,
  };
}

// ── What is still rendering ────────────────────────────────────────────────

/** True while any clip of this motion is still coming back from the model. */
export function hasGeneratingVideo(motion: Motion): boolean {
  return motion.videos.some((video) => video.status === "generating");
}

/**
 * Every motion with a clip still rendering, in declared order.
 *
 * A video render outlives the turn that asked for it: the agent says "about
 * six minutes" and stops, the composer unlocks, the status light goes idle,
 * and the only thing still moving is a shimmer inside a tab the user may not
 * have open. This is what the header chip needs to say so anyway.
 */
export function generatingVideoMotions(
  project: CharacterProject | null,
): Motion[] {
  if (!project) return [];
  return project.sprite.motions.filter(hasGeneratingVideo);
}

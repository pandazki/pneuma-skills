/**
 * Streaming reconcile planning (§7 R1/R4/R4′) — the pure half of the T4
 * host. Given the previous build state and a freshly parsed Lecture, decide
 * which flat step indices can REUSE their built node + revealables and
 * which must be (re)built. No DOM, no React — directly Bun-testable.
 *
 * R1 (prefix stability): step identity = (flat position, content hash).
 * An append leaves every previous index's hash untouched, so the whole
 * prefix is reused — already-shown steps keep their DOM nodes and their
 * revealed state; replay is structurally impossible.
 *
 * R4/R4′ (edits / structural changes): the first position whose hash
 * differs is the divergence point; everything from there on is rebuilt in
 * document order. Rebuilt steps are presented at their final state by the
 * host's post-swap `seek(t)` — never re-animated.
 *
 * Chart cascade (see `MeasureContext.chart` REBUILD RULE): a chart frame's
 * node is shared mutable state — layers append strokes into it and series
 * colors cycle by mount order. When the OLD build had chart members at or
 * past the divergence point, their contributions are already mounted in
 * the (possibly still-prefix) frame node; rebuilding just the suffix would
 * leave stale strokes behind. Those charts rebuild wholesale: fresh frame,
 * every layer re-run in document order. A pure APPEND of a new layer is
 * the accumulate path by design — no cascade, the layer builds into the
 * live frame.
 *
 * Align cascade (§4.3): alignment column widths are group-derived, so an
 * APPENDED list item can invalidate a prefix item whose own hash did not
 * change (its spacer was measured against the old group max). The host
 * feeds the previously applied widths and the newly computed targets;
 * mismatching indices join the rebuild set.
 */

import { containerKeyOf, frameOwnsUnion } from "../engine/container.js";
import { flattenSteps } from "../engine/inference.js";
import { stepContentHash } from "../engine/text.js";
import type { Lecture, Step, StepRef } from "../engine/types.js";
import { stepKey } from "./address.js";

/** What the host remembers about one built flat index. */
export interface BuiltStepState {
  hash: string;
  /** Named-container key (`chart:名` / `graph:名`) when the step has one. */
  container?: string;
  /** Align spacer width (px) applied at build time — aligned list items only. */
  alignWidth?: number;
  /**
   * The box width (px) this step's node was BUILT at — the width its
   * measure host presented, hence the width its lines wrapped at and its
   * ink was drawn for. See `boxWidthCascade`.
   */
  boxWidth?: number;
}

/** One entry of the new flat document order, hash precomputed. */
export interface ReconcileEntry {
  ref: StepRef;
  step: Step;
  hash: string;
}

export interface ReconcilePlan {
  /** The full new flat list (document order) with content hashes. */
  entries: ReconcileEntry[];
  /** Flat indices to (re)build, ascending — frames sort before layers. */
  rebuild: number[];
  /** Flat indices whose previous build is reused as-is. */
  reuse: number[];
  /**
   * The divergence point: the first flat index whose (position, hash)
   * identity changed, `entries.length` on a pure append with no edits.
   * Everything before it kept its identity (though a chart/align cascade
   * may still rebuild individual earlier indices).
   */
  divergence: number;
}

export { containerKeyOf };

/** Flatten + hash a lecture — the entry list every reconcile works over. */
export function toEntries(lecture: Lecture): ReconcileEntry[] {
  return flattenSteps(lecture).map(({ ref, step }) => ({
    ref,
    step,
    hash: stepContentHash(step, lecture.source),
  }));
}

/**
 * Compute the reconcile plan. `forceRebuild` lets the host inject extra
 * invalidations computed outside the hash identity — today the align-width
 * cascade (see `alignCascade`).
 */
export function planReconcile(
  prev: readonly BuiltStepState[],
  entries: readonly ReconcileEntry[],
  forceRebuild?: ReadonlySet<number>,
): ReconcilePlan {
  // Divergence: first position whose hash changed; a shorter new document
  // diverges at its own end (the removed tail is discarded by the host).
  const shared = Math.min(prev.length, entries.length);
  let divergence = shared;
  for (let i = 0; i < shared; i++) {
    if (prev[i]!.hash !== entries[i]!.hash) {
      divergence = i;
      break;
    }
  }
  if (divergence === shared && entries.length > prev.length) {
    divergence = prev.length;
  }

  const rebuild = new Set<number>();
  for (let i = divergence; i < entries.length; i++) rebuild.add(i);
  if (forceRebuild) for (const i of forceRebuild) rebuild.add(i);

  // Container cascade: containers whose OLD build had members at/past
  // divergence (their strokes are mounted state that a suffix rebuild alone
  // would strand) rebuild wholesale — frame + every layer, any index.
  const cascade = new Set<string>();
  for (let i = divergence; i < prev.length; i++) {
    const key = prev[i]!.container;
    if (key !== undefined) cascade.add(key);
  }
  // A forced rebuild of a container member (align never applies to
  // containers, but the seam is generic) cascades identically.
  if (forceRebuild) {
    for (const i of forceRebuild) {
      const step = entries[i]?.step;
      const key = step ? containerKeyOf(step) : undefined;
      if (key !== undefined) cascade.add(key);
    }
  }
  // GRAPHS ALSO CASCADE ON APPEND. A chart declares its coordinate system in
  // the frame's own source, so appending a layer changes nothing the frame
  // owns — the pure-append accumulate path, which is the whole point of
  // declaring the range up front. A graph's frame owns the container's
  // accumulated UNION (`GraphLayoutSpec`), so a new block changes the
  // layout the frame is responsible for even though the frame's own bytes
  // never moved. Reuse the frame there and the new nodes would have nowhere
  // to go; rebuilding the whole container is what keeps "a later block only
  // ever adds ink" true.
  for (let i = divergence; i < entries.length; i++) {
    const step = entries[i]!.step;
    const key = containerKeyOf(step);
    if (key !== undefined && frameOwnsUnion(step)) cascade.add(key);
  }
  if (cascade.size > 0) {
    for (let i = 0; i < entries.length; i++) {
      const key = containerKeyOf(entries[i]!.step);
      if (key !== undefined && cascade.has(key)) rebuild.add(i);
    }
  }

  const reuse: number[] = [];
  for (let i = 0; i < entries.length; i++) {
    if (!rebuild.has(i)) reuse.push(i);
  }
  return {
    entries: entries as ReconcileEntry[],
    rebuild: [...rebuild].sort((a, b) => a - b),
    reuse,
    divergence,
  };
}

/**
 * Align-width cascade (§4.3 × §7): indices whose previously applied spacer
 * width no longer matches the target width for their group. Their content
 * hash is unchanged — this is a DERIVED invalidation the hash identity
 * cannot see, and it is the common streaming case (a group grows one item
 * per agent edit; a wider new label widens every earlier member's column).
 */
export function alignCascade(
  prev: readonly BuiltStepState[],
  targetWidths: ReadonlyMap<number, number>,
): Set<number> {
  const out = new Set<number>();
  for (const [index, width] of targetWidths) {
    const built = prev[index];
    if (!built) continue; // not built yet — the base plan already covers it
    if ((built.alignWidth ?? 0) !== width) out.add(index);
  }
  return out;
}

/**
 * Box-width cascade (design §7.2 × §7): indices whose box is about to be
 * a DIFFERENT WIDTH than the one their node was built at.
 *
 * A step's ink is geometry MEASURED at build time — an underline is the
 * set of line boxes the run occupied — so a node built at one width and
 * shown at another draws its ink under lines that no longer exist. The
 * content hash cannot see this: inserting an `@at` earlier in the document
 * re-columns everything downstream without changing one byte of it (§7.1's
 * R4 family), and so does an `@at` that a later edit deletes.
 *
 * The comparison is SCAN AGAINST SCAN — the width the pre-fold scan said
 * last build against the width it says now — never against a width the
 * fold corrected afterwards. Recording a corrected width here would make
 * every subsequent build disagree with its own scan and rebuild forever.
 */
export function boxWidthCascade(
  prev: readonly BuiltStepState[],
  entries: readonly ReconcileEntry[],
  widths: ReadonlyMap<string, number>,
): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < entries.length; i++) {
    const built = prev[i];
    if (!built || built.boxWidth === undefined) continue;
    const want = widths.get(stepKey(entries[i]!.ref));
    if (want === undefined) continue;
    if (built.boxWidth !== want) out.add(i);
  }
  return out;
}

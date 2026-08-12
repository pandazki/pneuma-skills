/**
 * Named accumulating containers (§4.4) — the ONE vocabulary charts and
 * graphs share.
 *
 * Layering (G2): engine core — zero external imports, no DOM, no clock.
 *
 * A chart and a graph are the same primitive seen twice: a block names a
 * container, the FIRST block for that name declares it (the frame), every
 * later same-name block accumulates into it (a layer), and space returns to
 * the container's home while time moves with the document. That primitive
 * lives here — the parser's first-block rule, the host's home registry, the
 * reconcile cascade and the `MeasureContext.container` seam all key on
 * `containerKeyOf`, so neither kind carries its own private copy of "what a
 * named container is" (T12-review: two parallel container mechanisms would
 * mean the abstraction was never lifted).
 *
 * The key is KIND-NAMESPACED: a board may legitimately hold a chart and a
 * graph called 数据流, and they are two different homes.
 */

import type { ContainerFrameStep, Step } from "./types.js";

/** The container kinds — one per pair of frame/layer step kinds. */
export type ContainerKind = "chart" | "graph";

/** The registry/home key for a container. Kind-namespaced, never bare. */
export function containerKey(kind: ContainerKind, name: string): string {
  return `${kind}:${name}`;
}

/**
 * The container key of a step, or `undefined` when the step declares no
 * container. Total over `Step` — the four container step kinds are the only
 * hits, and TypeScript's exhaustiveness makes a future fifth kind loud.
 */
export function containerKeyOf(step: Step): string | undefined {
  switch (step.kind) {
    case "chart-frame":
    case "chart-layer":
      return containerKey("chart", step.chart);
    case "graph-frame":
    case "graph-layer":
      return containerKey("graph", step.graph);
    default:
      return undefined;
  }
}

/** True when the step DECLARES a container (the layout/coordinate authority). */
export function isContainerFrame(step: Step): step is ContainerFrameStep {
  return step.kind === "chart-frame" || step.kind === "graph-frame";
}

/**
 * True when appending a later block of this container invalidates the
 * FRAME as well.
 *
 * A chart declares its coordinate system in the frame's own source
 * (`x:` / `y:`), so a later layer changes nothing the frame owns — the
 * accumulate path is a pure append, which is the whole point of declaring
 * the range up front. A graph's layout is COMPUTED from the container's
 * accumulated union, which the frame carries (`GraphLayoutSpec`), so a new
 * block changes what the frame is responsible for even though its own
 * bytes never moved. Those containers rebuild whole (frame + every layer,
 * document order) — see `MeasureContext.container`'s GRAPH ADDENDUM.
 */
export function frameOwnsUnion(step: Step): boolean {
  return step.kind === "graph-frame" || step.kind === "graph-layer";
}

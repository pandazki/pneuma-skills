/**
 * Shared incremental-host harness — the BoardCanvas reconcile-driven build
 * loop in miniature: one happy-dom measure host, real factories, and a
 * `planReconcile`-guided rebuild that reuses prefix nodes by identity.
 * Consumed by `streaming.test.ts` (T4 flow-level zero-replay) and
 * `e2e.test.ts` (T11 R8 arrival-order seal + R4/R4′ reveal-progress pins).
 *
 * Not a `*.test.ts` file on purpose (Bun would collect it): a fixture
 * module, precedent `vocabulary.ts` and
 * `backends/__tests__/lifecycle-harness.ts`. The two suites used to carry
 * near-verbatim private copies of this machinery and they drifted: the
 * older copy keyed container homes on the "chart-frame"/"chart-layer" kind
 * literals, blinding the prev-side reconcile cascade to graph containers —
 * a graph board could degrade to nothing with every assertion green. One
 * copy, total over container kinds via `isContainerFrame`/`containerKeyOf`,
 * ends that class: the next container kind lands here once and both suites
 * see it.
 *
 * DOM host: happy-dom (no layout — ink degrades to inert; identity and
 * dispatch behavior are what the consumers pin, geometry is G7's job).
 */

import { Window } from "happy-dom";

import { containerKeyOf, isContainerFrame } from "../engine/container.js";
import { DEFAULT_DURATIONS } from "../engine/duration.js";
import { factoryFor } from "../engine/factories/index.js";
import type {
  ContainerHome,
  EraseTargetHandle,
  Lecture,
  MeasureContext,
  Revealable,
  Step,
  StepRef,
} from "../engine/types.js";
import {
  planReconcile,
  toEntries,
  type BuiltStepState,
  type ReconcileEntry,
} from "../viewer/reconcile.js";

export interface HostOptions {
  /**
   * C3 — the eraser's target seam (`MeasureContext.eraseTarget`). The
   * entry currently passing through its factory build arrives as the
   * second argument — the BoardCanvas `currentBuildKey` pattern: the step
   * value cannot name its board (only the fold can), so consumers key the
   * returned LATE-BOUND handle by this ref AT BUILD TIME. Capturing lazily
   * (reading "the last built entry" at resolve time) would bind every
   * eraser to the final build's key — wrong but usually green, the silent
   * drift class this harness exists to kill.
   */
  eraseTarget?(step: Step, ref: StepRef): EraseTargetHandle | undefined;
}

export interface Host {
  ctx: MeasureContext;
  containers: Map<string, ContainerHome>;
  /** Ref of the entry currently inside `factory.build` (reconcileStep
   *  maintains it; undefined outside a build). */
  building?: StepRef;
}

export function makeHost(options?: HostOptions): Host {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const measureHost = doc.createElement("div");
  doc.body.appendChild(measureHost);
  const containers = new Map<string, ContainerHome>();
  const eraseTarget = options?.eraseTarget;
  const building: { ref?: StepRef } = {};
  const ctx: MeasureContext = {
    durations: DEFAULT_DURATIONS,
    document: doc,
    measureHost,
    env: { handwritingFontActive: true, strokeFontCovers: () => false },
    container: (key: string) => containers.get(key),
    ...(eraseTarget
      ? {
          eraseTarget: (step: Step) =>
            building.ref ? eraseTarget(step, building.ref) : undefined,
        }
      : {}),
  };
  return {
    ctx,
    containers,
    get building() {
      return building.ref;
    },
    set building(ref: StepRef | undefined) {
      building.ref = ref;
    },
  };
}

export interface IncrementalHost {
  host: Host;
  entries: ReconcileEntry[];
  nodes: Element[];
  built: Revealable[][];
}

/** One reconcile pass — the BoardCanvas algorithm in miniature.
 *  `firstHost` seeds the very first pass (e.g. one built with an
 *  `eraseTarget` seam); ignored once a state exists. */
export function reconcileStep(
  state: IncrementalHost | null,
  lecture: Lecture,
  firstHost?: Host,
): IncrementalHost {
  const host = state?.host ?? firstHost ?? makeHost();
  // `containerKeyOf` is total over Step and kind-namespaced — the exact
  // derivation BoardCanvas records per built item. A kind check here
  // (e.g. only chart kinds) would blind the prev-side container cascade
  // to graphs: drop a graph layer from the tail and the frame's home
  // would silently keep the old union.
  const prev: BuiltStepState[] =
    state?.entries.map((e) => {
      const key = containerKeyOf(e.step);
      return { hash: e.hash, ...(key !== undefined ? { container: key } : {}) };
    }) ?? [];
  const next = toEntries(lecture);
  const plan = planReconcile(prev, next);

  const nodes: Element[] = [];
  const built: Revealable[][] = [];
  for (let i = 0; i < next.length; i++) {
    const entry = next[i]!;
    if (!plan.rebuild.includes(i) && state && i < state.nodes.length) {
      nodes[i] = state.nodes[i]!;
      built[i] = state.built[i]!;
      continue;
    }
    const factory = factoryFor(entry.step.kind);
    if (!factory) {
      nodes[i] = host.ctx.document.createElement("div");
      built[i] = [];
      continue;
    }
    host.building = entry.ref;
    const { node, revealables } = factory.build(entry.step, host.ctx);
    host.building = undefined;
    if (isContainerFrame(entry.step)) {
      host.containers.set(containerKeyOf(entry.step)!, {
        frame: entry.step,
        node,
      });
    }
    nodes[i] = node;
    built[i] = revealables;
  }
  return { host, entries: next, nodes, built };
}

/** Flat index of a step ref in the host's current entries; -1 if absent. */
export function refIndex(state: IncrementalHost, ref: StepRef): number {
  return state.entries.findIndex(
    (e) => e.ref.section === ref.section && e.ref.step === ref.step,
  );
}

/**
 * Observed progress for one wrapped revealable: the last dispatched value
 * and the full dispatch history. `p === -1` = never dispatched — distinct
 * from a dispatched 0 on purpose (`makeSeek` only reaches entries the
 * boundary has crossed; "untouched" and "reset to blank" are different
 * observations).
 */
export interface UnitTracker {
  p: number;
  log: number[];
}

/**
 * Wrap every revealable so each dispatched progress is recorded —
 * `wrapped[i][j]` reports into `trackers[i][j]`. Consumers hand `wrapped`
 * to `buildTimeline` and read the trackers: the last value answers "how
 * far is this unit now", the log answers "did it ever replay".
 */
export function trackUnits(built: ReadonlyArray<readonly Revealable[]>): {
  wrapped: Revealable[][];
  trackers: UnitTracker[][];
} {
  const trackers: UnitTracker[][] = [];
  const wrapped = built.map((units, i) => {
    const row: UnitTracker[] = [];
    trackers[i] = row;
    return units.map((r) => {
      const tracker: UnitTracker = { p: -1, log: [] };
      row.push(tracker);
      return {
        ...r,
        seek(p: number) {
          tracker.p = p;
          tracker.log.push(p);
          r.seek(p);
        },
      };
    });
  });
  return { wrapped, trackers };
}

/**
 * Factory registry (T3) — one `RevealableFactory` per performable step
 * kind. The host resolves factories ONLY through here; `wait` and `bad`
 * plan to no units and have no factory. `image` / `html` land in a later
 * task (Phase 3 骨架完备) — until then they ALSO plan no units, and the
 * parse surfaces an `unsupportedStep` warning (a factory added here must
 * remove both halves of that gate: `planStepUnits` and `pushUnsupported`).
 */

import type { RevealableFactory, Step } from "../types.js";
import { chartFrameFactory, chartLayerFactory } from "./chart.js";
import { eraseFactory } from "./eraser.js";
import { graphFrameFactory, graphLayerFactory } from "./graph.js";
import { backRefFactory } from "./ink.js";
import { mathFactory } from "./math.js";
import {
  asideFactory,
  headingFactory,
  listItemFactory,
  proseFactory,
} from "./prose.js";
import { ruleFactory } from "./rule.js";

const REGISTRY: Partial<Record<Step["kind"], RevealableFactory>> = {
  heading: headingFactory,
  prose: proseFactory,
  aside: asideFactory,
  "list-item": listItemFactory,
  rule: ruleFactory,
  math: mathFactory,
  backref: backRefFactory,
  erase: eraseFactory,
  "chart-frame": chartFrameFactory,
  "chart-layer": chartLayerFactory,
  "graph-frame": graphFrameFactory,
  "graph-layer": graphLayerFactory,
};

/** The factory for a step kind, or `undefined` when the kind has none. */
export function factoryFor(kind: Step["kind"]): RevealableFactory | undefined {
  return REGISTRY[kind];
}

export {
  FALLBACK_GLYPH_LIST_CAP,
  glyphsFallingBack,
  probeEnvCaps,
  readHandStacks,
} from "./env.js";
export {
  asideFactory,
  backRefFactory,
  chartFrameFactory,
  chartLayerFactory,
  eraseFactory,
  graphFrameFactory,
  graphLayerFactory,
  headingFactory,
  listItemFactory,
  mathFactory,
  proseFactory,
  ruleFactory,
};

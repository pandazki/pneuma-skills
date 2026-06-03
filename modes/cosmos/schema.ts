/**
 * Cosmos schema — the single structured-output truth (zod-defined).
 *
 * `types.ts` is the TypeScript truth the viewer consumes at runtime
 * (rich doc-comments, `normalizeCosmos`, deprecated-field migration).
 * This module is the *validation + structured-output* truth:
 *
 *   - The zod schemas below are the source. `validateCosmos(value)`
 *     and `safeParse` give the main agent a pre-write gate and the
 *     tests a real validator (no hand-rolled checker).
 *   - `jsonSchemas.*` are derived via `z.toJSONSchema` — plain JSON
 *     Schema objects the projection Workflow inlines into its
 *     `agent({ schema })` calls so every extracted node / edge /
 *     perspective is validated at the tool-call layer.
 *
 * Why two representations (zod here, interfaces in `types.ts`)? The
 * viewer wants documented interfaces + the legacy normalizer; the
 * workflow wants JSON Schema literals it can embed (its sandbox has no
 * imports). `__tests__/schema.test.ts` locks the two together by
 * validating the shipped seed cosmoses (post-`normalizeCosmos`) against
 * `zCosmos` and asserting the derived JSON Schema generates cleanly.
 *
 * The projection workflow (next step) cannot import this file — it runs
 * as sandboxed plain JS. It will inline copies of `jsonSchemas.*`; a
 * test compares the inlined literals against what `z.toJSONSchema`
 * produces here, so drift turns the suite red.
 */

import { z } from "zod";

/** Bump only on a breaking shape change; additive optional fields do not. */
export const COSMOS_SCHEMA_VERSION = "0.1.0";

// ── Enums (exported for reuse + the types.ts cross-check) ─────────────

/** `CosmosNodeCategory` — the domain-agnostic chip-filter axis. */
export const NODE_CATEGORIES = [
  "code",
  "config",
  "docs",
  "infra",
  "data",
  "domain",
  "knowledge",
  "other",
] as const;

/** `CosmosNodeComplexity`. */
export const NODE_COMPLEXITIES = ["simple", "moderate", "complex"] as const;

/**
 * `node.trust` — verification verdict from the workflow's adversarial
 * verify pass. Reserved now so the contract is stable from day one; the
 * viewer's trust badge lands in a later step. `verified` = sources
 * exist and substantiate the summary; `weak` = sourced but the cited
 * material only partially supports the claim; `unverifiable` = no
 * citable source could be confirmed (an inference).
 */
export const NODE_TRUST = ["verified", "weak", "unverifiable"] as const;

/** `CosmosSourceRef` discriminants. */
export const SOURCE_KINDS = ["file", "url", "passage", "image", "audio", "video"] as const;

/** `CosmosEdge.direction`. */
export const EDGE_DIRECTIONS = ["forward", "backward", "bidirectional"] as const;

// ── Building blocks ──────────────────────────────────────────────────

/** A real visual extract cropped from the source (never AI-generated). */
export const zExcerpt = z.object({
  path: z
    .string()
    .describe(
      "Workspace-relative or absolute path to a REAL extract from the source (cropped PDF page, video frame, UI screenshot). Never an AI-generated illustration.",
    ),
  caption: z.string().optional().describe("Optional caption under the thumbnail."),
});

// Modelled as a 2-item number array (not a tuple) so the derived JSON
// Schema uses minItems/maxItems rather than the draft-2020 `prefixItems`
// keyword — the Workflow agent's validator runs an older draft.
const zRange = z
  .array(z.number())
  .min(2)
  .max(2)
  .describe("Inclusive [start, end] line numbers.");

const zLocator = z
  .string()
  .describe('Where-inside hint ("p.23", "5:32", "figure 3", "ch.3 ¶12", "nav-header").');

/**
 * `CosmosSourceRef` — the six-kind pointer back to a node's origin.
 * A discriminated union on `kind`: each branch carries exactly its
 * required fields. This is the spine of cosmos's trust model — every
 * node cites where it came from, and the verify pass confirms the
 * citation resolves.
 */
export const zSourceRef = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("file"),
    path: z.string(),
    range: zRange.optional(),
    label: z.string().optional(),
    locator: zLocator.optional(),
    excerpt: zExcerpt.optional(),
  }),
  z.object({
    kind: z.literal("url"),
    url: z.string(),
    label: z.string().optional(),
    locator: zLocator.optional(),
    excerpt: zExcerpt.optional(),
  }),
  z.object({
    kind: z.literal("passage"),
    file: z.string(),
    locator: z.string().describe("Required passage address — e.g. 'ch.3 ¶12', '§4.2', 'slide 7'."),
    quote: z.string().optional().describe("Lifted text the inference rests on (≤80 chars)."),
    label: z.string().optional(),
    excerpt: zExcerpt.optional(),
  }),
  z.object({
    kind: z.literal("image"),
    path: z.string(),
    label: z.string().optional(),
    locator: zLocator.optional(),
    excerpt: zExcerpt.optional(),
  }),
  z.object({
    kind: z.literal("audio"),
    path: z.string(),
    t: z.number().optional().describe("Optional timestamp in seconds."),
    label: z.string().optional(),
    locator: zLocator.optional(),
    excerpt: zExcerpt.optional(),
  }),
  z.object({
    kind: z.literal("video"),
    path: z.string(),
    t: z.number().optional().describe("Optional timestamp in seconds."),
    label: z.string().optional(),
    locator: zLocator.optional(),
    excerpt: zExcerpt.optional(),
  }),
]);

/** `CosmosLayer` — drives node color + grouping. */
export const zLayer = z.object({
  id: z.string().describe("Stable id referenced by node.layerId."),
  label: z.string(),
  color: z.string().optional().describe("CSS color (hex / hsl)."),
  description: z.string().optional(),
});

const zDomainMeta = z.object({
  entities: z.array(z.string()).optional(),
  businessRules: z.array(z.string()).optional(),
  crossDomainInteractions: z.array(z.string()).optional(),
  entryPoint: z.string().optional(),
  entryType: z.string().optional(),
});

const zKnowledgeMeta = z.object({
  wikilinks: z.array(z.string()).optional(),
  backlinks: z.array(z.string()).optional(),
  category: z.string().optional(),
  content: z.string().optional(),
});

/** `CosmosNode` — a typed referent in the projection. */
export const zNode = z.object({
  id: z
    .string()
    .describe("Stable kebab-case id, short layer-hint prefix encouraged (c-eliot, fn-auth-login)."),
  type: z
    .string()
    .describe("Open vocabulary for the content domain (file, character, claim, …). English kebab-case."),
  name: z.string().describe("Display noun the user reads."),
  summary: z.string().describe("One sentence, two at most."),
  layerId: z.string().optional().describe("Must reference a layers[].id."),
  category: z.enum(NODE_CATEGORIES).optional().describe("Domain-agnostic chip-filter axis."),
  complexity: z.enum(NODE_COMPLEXITIES).optional(),
  sources: z
    .array(zSourceRef)
    .optional()
    .describe("Pointers back to the artifacts that produced this node. Most real nodes have 1–3."),
  trust: z
    .enum(NODE_TRUST)
    .optional()
    .describe("Verification verdict from the workflow's verify pass. Omit when unverified."),
  languageNotes: z.string().optional(),
  tags: z.array(z.string()).optional(),
  domainMeta: zDomainMeta.optional(),
  knowledgeMeta: zKnowledgeMeta.optional(),
  meta: z.record(z.string(), z.unknown()).optional().describe("Opaque agent bag; framework ignores it."),
});

/** `CosmosEdge` — a labelled relationship. */
export const zEdge = z.object({
  source: z.string().describe("Source node id."),
  target: z.string().describe("Target node id."),
  type: z
    .string()
    .describe("Relationship verb (calls, imports, discovers, supports, …). Prefer specific over generic."),
  direction: z.enum(EDGE_DIRECTIONS).optional().describe("Defaults to forward."),
  description: z.string().optional(),
  weight: z.number().optional().describe("Optional 0–1 emphasis."),
  sources: z.array(zSourceRef).optional(),
});

/** `CosmosTourStep` — one beat of the canonical overall tour. */
export const zTourStep = z.object({
  step: z.number().int(),
  nodeId: z.string(),
  narrative: z.string(),
});

/** `CosmosPerspectiveStep` — one beat of a variant walk. */
export const zPerspectiveStep = z.object({
  focus: z
    .array(z.string())
    .min(1)
    .describe("Node ids lit on this beat. First is the primary anchor."),
  narrative: z.string().describe("THIS step's paragraph — not the perspective's thesis."),
});

/** `CosmosPerspective` — a variant tour framed by one design lens. */
export const zPerspective = z.object({
  id: z.string().describe("Stable id, prefix perspective-."),
  name: z.string().describe("The lens phrased as a noun, in user language."),
  lens: z.string().describe("Open vocabulary, English kebab-case (cybernetic-loop, tension, …)."),
  insight: z.string().describe("One-paragraph thesis."),
  steps: z.array(zPerspectiveStep).min(1),
  evidence: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

/** `CosmosProject` — metadata about the projected work. */
export const zProject = z.object({
  name: z.string(),
  kind: z.string().optional(),
  description: z.string().optional(),
  analyzedAt: z.string().optional(),
  source: z.string().optional(),
  sourceRoot: z
    .string()
    .optional()
    .describe("Absolute path to the source root; relative refs resolve against it."),
});

/**
 * Full `cosmos.json` schema — validates a complete (normalized)
 * projection. `subgraphs[]` is deliberately omitted: drill-down is a
 * runtime, user-driven concern, not something the projection workflow
 * produces. Validate the main graph; let subgraphs ride the looser
 * runtime path.
 */
export const zCosmos = z.object({
  version: z.string(),
  kind: z.enum(["codebase", "knowledge", "general"]).optional(),
  project: zProject,
  nodes: z.array(zNode),
  edges: z.array(zEdge),
  layers: z.array(zLayer),
  tour: z.array(zTourStep).optional(),
  perspectives: z.array(zPerspective).optional(),
});

// ── Workflow stage schemas ───────────────────────────────────────────
// What each phase of the projection workflow forces its subagents to
// return. They compose the building blocks above, so workflow output
// and the cosmos the viewer renders share one contract.

/** Phase "Extract" — one subagent per partition returns its slice. */
export const zPartitionExtraction = z.object({
  nodes: z.array(zNode),
  edges: z.array(zEdge),
  layers: z.array(zLayer).optional().describe("Layers this partition discovered; merge phase reconciles."),
});

/** Phase "Merge" — resolve edges that cross partition boundaries. */
export const zCrossEdges = z.object({
  edges: z.array(zEdge),
});

/** Phase "Verify" — one adversarial verdict on one node. */
export const zNodeVerdict = z.object({
  nodeId: z.string(),
  trust: z.enum(NODE_TRUST),
  reason: z.string().describe("Why this verdict — what the source did or did not substantiate."),
  issues: z
    .array(z.string())
    .optional()
    .describe("Concrete problems: missing file, range without the claimed content, fabricated excerpt."),
});

/**
 * Phase "Verify" (batched) — one skeptic re-reads a partition's files
 * and returns a verdict for every node that partition produced. Batching
 * by partition re-grounds each node against its real sources at a
 * fraction of the cost of a per-node skeptic; a future intensification
 * can fan out N independent skeptics per node for the high-value graph.
 */
export const zVerificationBatch = z.object({
  verdicts: z.array(zNodeVerdict),
});

/** Phase "Complete" — empty `gaps` is the loop-until-dry signal. */
export const zCompleteness = z.object({
  gaps: z.array(
    z.object({
      area: z.string().describe("The under-covered partition / concern / entrypoint."),
      why: z.string().describe("What signal says it is under-covered."),
      suggestedFocus: z.array(z.string()).optional().describe("Paths / symbols to re-extract."),
    }),
  ),
});

/**
 * Phase "Perspectives" (generation) — one agent surveys the finished
 * graph and proposes the perspectives whose lens actually fits, each
 * grounded in concrete node ids. A judge panel then refutes the
 * ungrounded ones (see `zPerspectiveJudgment`).
 */
export const zPerspectiveSet = z.object({
  perspectives: z.array(zPerspective),
});

/** Phase "Perspectives" — a judge's verdict on one candidate. */
export const zPerspectiveJudgment = z.object({
  grounded: z.boolean(),
  reason: z.string(),
  weakSteps: z
    .array(z.number().int())
    .optional()
    .describe("Indices of steps whose narrative just repeats the thesis or lacks concrete focus."),
});

// ── Derived JSON Schema (for the projection workflow) ─────────────────
// The workflow inlines these literals into `agent({ schema })`. Kept as
// a lazily-built map so importing this module stays cheap for the
// viewer, which only needs the zod validators.

export type CosmosJsonSchemaName =
  | "cosmos"
  | "node"
  | "edge"
  | "perspective"
  | "partitionExtraction"
  | "crossEdges"
  | "nodeVerdict"
  | "verificationBatch"
  | "completeness"
  | "perspectiveSet"
  | "perspectiveJudgment";

const ZOD_BY_NAME = {
  cosmos: zCosmos,
  node: zNode,
  edge: zEdge,
  perspective: zPerspective,
  partitionExtraction: zPartitionExtraction,
  crossEdges: zCrossEdges,
  nodeVerdict: zNodeVerdict,
  verificationBatch: zVerificationBatch,
  completeness: zCompleteness,
  perspectiveSet: zPerspectiveSet,
  perspectiveJudgment: zPerspectiveJudgment,
} satisfies Record<CosmosJsonSchemaName, z.ZodType>;

/**
 * Build the JSON Schema for one stage. The root `$schema` dialect
 * declaration is stripped: the Workflow agent's validator (ajv) runs an
 * older draft and rejects an unregistered 2020-12 meta-schema ref. The
 * schemas themselves use only draft-07-compatible keywords.
 */
export function toJsonSchema(name: CosmosJsonSchemaName): Record<string, unknown> {
  const js = z.toJSONSchema(ZOD_BY_NAME[name]) as Record<string, unknown>;
  delete js.$schema;
  return js;
}

/** All stage JSON Schemas, built on demand. */
export function allJsonSchemas(): Record<CosmosJsonSchemaName, Record<string, unknown>> {
  const out = {} as Record<CosmosJsonSchemaName, Record<string, unknown>>;
  for (const name of Object.keys(ZOD_BY_NAME) as CosmosJsonSchemaName[]) {
    out[name] = toJsonSchema(name);
  }
  return out;
}

// ── Validation helper ────────────────────────────────────────────────

export interface CosmosValidation {
  ok: boolean;
  /** Flattened `path: message` issues; empty when ok. */
  errors: string[];
}

/**
 * Validate a full cosmos object (already normalized — run
 * `normalizeCosmos` from types.ts first for legacy files). Returns a
 * flat error list rather than throwing, so the main agent can gate a
 * write and report problems inline.
 */
export function validateCosmos(value: unknown): CosmosValidation {
  const result = zCosmos.safeParse(value);
  if (result.success) return { ok: true, errors: [] };
  return {
    ok: false,
    errors: result.error.issues.map((i) => `${i.path.join(".") || "$"}: ${i.message}`),
  };
}

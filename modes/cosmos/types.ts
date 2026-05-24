/**
 * Cosmos domain types.
 *
 * A Cosmos is the structured projection of any content (code, prose,
 * research, business workflow…) into an interactive graph. `node.type`
 * is intentionally an open string — agents pick vocabulary per content
 * domain (codebase: file/function/class; fiction: character/event/clue;
 * research: claim/evidence; …). The viewer renders type → color via the
 * accompanying `layers[]` table.
 *
 * The schema's shape borrows from Lum1104/Understand-Anything (MIT);
 * see NOTICE.md for the full borrow/adapt/drop mapping.
 */

export interface CosmosProject {
  /** Human-readable name of the projected work (e.g. "src/", "The Antiqued Map", "Paper §4"). */
  name: string;
  /** Coarse content-domain tag for the agent's bookkeeping (e.g. "codebase", "fiction:mystery", "research:abstract"). Free-form. */
  kind?: string;
  /** Optional one-paragraph summary of the work being projected. */
  description?: string;
  /** ISO timestamp of when the projection was last produced. */
  analyzedAt?: string;
  /** Optional pointer back to source (git commit, file path, URL). */
  source?: string;
}

export interface CosmosNode {
  /** Stable id, kebab-case prefix encouraged (e.g. `c-eliot`, `cl-x-mark`, `fn-auth-login`). */
  id: string;
  /** Open string — agent's vocabulary for this content domain. Examples: file, function, class, character, event, clue, claim, evidence, concept, entity. */
  type: string;
  /** Display name for the node (the noun the user reads). */
  name: string;
  /** Layer this node belongs to (must reference a `layers[].id`). Drives color in the viewer. */
  layerId?: string;
  /** Plain-English summary of what this node is. One sentence ideal, two max. */
  summary: string;
  /** Optional pointer back into the source material (file path, page, paragraph). */
  source?: string;
  /** Optional line range [start, end] for source-backed nodes (codebase, paper). */
  lineRange?: [number, number];
  /** Optional free-form tags for filtering and search. */
  tags?: string[];
  /** Domain-specific extra metadata. Agent can stash anything here; framework treats it as opaque. */
  meta?: Record<string, unknown>;
}

export interface CosmosEdge {
  /** Source node id. */
  source: string;
  /** Target node id. */
  target: string;
  /** Open string — relationship verb. Examples: calls, imports, contains, depends_on, references, discovers, supports, contradicts, refers_to, marks_location, vanished_near, captains, related_to, authored. */
  type: string;
  /** `forward` (default), `backward`, or `bidirectional`. Drives arrow direction in the viewer. */
  direction?: "forward" | "backward" | "bidirectional";
  /** Optional one-sentence description of the relationship (shown on edge hover). */
  description?: string;
  /** Optional 0–1 weight for layout / visual emphasis. */
  weight?: number;
}

export interface CosmosLayer {
  /** Stable id used by nodes' `layerId`. */
  id: string;
  /** Human-readable label. */
  label: string;
  /** CSS color (hex, hsl, etc.) — drives node tint in the viewer. */
  color?: string;
  /** Optional description shown in the layer legend. */
  description?: string;
}

export interface CosmosTourStep {
  /** Order in the tour (1-based). */
  step: number;
  /** Node to focus this step on. */
  nodeId: string;
  /** Plain-English narrative — what does the user learn at this step? */
  narrative: string;
}

export interface Cosmos {
  /** Schema version. */
  version: string;
  /** Metadata about the projected work. */
  project: CosmosProject;
  /** All nodes in the graph. */
  nodes: CosmosNode[];
  /** All edges (directed by default). */
  edges: CosmosEdge[];
  /** Layer table — drives color, optional grouping in the viewer. */
  layers: CosmosLayer[];
  /** Optional curated walkthrough — what to look at first, second, third. */
  tour?: CosmosTourStep[];
}

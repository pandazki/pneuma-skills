# Cosmos Schema

> The complete schema for `cosmos.json` — types, required fields,
> validation rules. Source of truth is `modes/cosmos/types.ts`; this
> document mirrors it with examples.

## Top-level shape

```ts
interface Cosmos {
  version: string;             // "0.1.0" for now
  project: CosmosProject;
  nodes: CosmosNode[];
  edges: CosmosEdge[];
  layers: CosmosLayer[];
  tour?: CosmosTourStep[];     // optional curated walkthrough
}
```

## `project` — metadata about the work being projected

```ts
interface CosmosProject {
  name: string;                // "The Antiqued Map", "src/", "Paper §4"
  kind?: string;               // free-form domain tag: "codebase", "fiction:mystery", "research:abstract", "business:flow"
  description?: string;        // one paragraph
  source?: string;             // pointer back: file path, URL, git commit
  analyzedAt?: string;         // ISO timestamp
}
```

**Rule:** `name` is required and should match how the user thinks of
the work, not just a file path. `kind` is your shorthand; the viewer
doesn't render it but the evolution agent reads it to spot patterns
across sessions.

## `layers[]` — the grouping table

```ts
interface CosmosLayer {
  id: string;          // stable kebab-case: "characters", "clues", "service"
  label: string;       // display label: "Characters", "Clues", "Service Layer"
  color?: string;      // CSS color: "#f97316", "hsl(280 60% 60%)"
  description?: string; // shown in the legend on hover
}
```

**Rule:** every `layerId` referenced in a node MUST exist here. The
viewer treats unknown `layerId` values as "no layer" and falls back
to a neutral color.

Use 3–6 layers. Fewer than 3 means the cosmos isn't grouped (visual
chaos); more than 6 means the layers are doing the work of node-types
(re-think).

## `nodes[]` — the atoms

```ts
interface CosmosNode {
  id: string;          // stable, kebab-case, layer-prefixed: "c-eliot", "fn-auth-login", "cl-x-mark"
  type: string;        // OPEN STRING — your vocabulary for this domain
  name: string;        // display name (the noun the user reads)
  layerId?: string;    // must reference layers[].id
  summary: string;     // one sentence, two max
  source?: string;     // pointer: "src/auth/login.ts", "input.md:para 3"
  lineRange?: [number, number];  // for source-backed nodes
  tags?: string[];     // search/filter tags
  meta?: Record<string, unknown>; // domain-specific extras; framework-opaque
}
```

**Rules:**
- `id` is stable across re-projections — preserve when content didn't change.
- `type` is your vocabulary choice (see `references/node-type-vocabularies.md`).
- `summary` is what the user reads in the card; keep it tight.
- `meta` is yours — stash anything (cyclomaticComplexity for code, sentiment for prose). The viewer doesn't render it in v0.1 but the agent can read it on the next pass.

## `edges[]` — the relationships

```ts
interface CosmosEdge {
  source: string;      // node id
  target: string;      // node id
  type: string;        // OPEN STRING — relationship verb
  direction?: "forward" | "backward" | "bidirectional";  // default "forward"
  description?: string; // shown on edge hover
  weight?: number;     // 0–1; drives layout emphasis
}
```

**Rules:**
- `source` and `target` must reference existing `nodes[].id`. The
  viewer drops edges with unknown endpoints (defensively), but you
  shouldn't write them.
- Use **specific verbs**: `discovers`, `authored`, `vanished_near`,
  `imports`, `refutes`, `precedes`. Avoid `relates_to` /
  `connected_to` — they convey nothing.
- `bidirectional` is sparingly used — it usually means you haven't
  decided which side owns the relationship.

## `tour[]` — the optional walkthrough

```ts
interface CosmosTourStep {
  step: number;        // 1-based order
  nodeId: string;      // node to focus this step
  narrative: string;   // one paragraph
}
```

**Rules:**
- 5–8 steps. If you can't tell the story in 8, the cosmos needs
  pruning or its layers are wrong.
- The tour is a **reading path**, not a complete tour. It can skip
  nodes that aren't load-bearing for the gestalt.

## Validation rules (defensive, viewer-side)

The viewer doesn't reject malformed cosmos — it shows what it can. But:

1. Missing `layerId` → node renders with neutral gray.
2. Unknown `layerId` → same.
3. Edge endpoints not in `nodes[]` → edge silently dropped.
4. `tour[]` step with unknown `nodeId` → tour step silently skipped.
5. Duplicate `nodes[].id` → last write wins (don't do this).

When in doubt, run `capture({})` after writing to see what the user
will see — that's the only test that matters.

## Example (mystery scene, abridged)

```json
{
  "version": "0.1.0",
  "project": {
    "name": "The Antiqued Map",
    "kind": "fiction:mystery-scene"
  },
  "layers": [
    { "id": "characters", "label": "Characters", "color": "#f97316" },
    { "id": "clues", "label": "Clues", "color": "#fbbf24" }
  ],
  "nodes": [
    { "id": "c-eliot", "type": "character", "name": "Eliot", "layerId": "characters", "summary": "Estate cataloger; protagonist." },
    { "id": "cl-x-mark", "type": "clue", "name": "X off Marblehead", "layerId": "clues", "summary": "Deliberate X on the verso of the map." }
  ],
  "edges": [
    { "source": "c-eliot", "target": "cl-x-mark", "type": "examines", "direction": "forward" }
  ]
}
```

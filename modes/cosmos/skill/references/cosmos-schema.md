# Cosmos Schema

> The complete schema for `cosmos.json` — types, required fields,
> validation rules. Source of truth is `modes/cosmos/types.ts`; this
> document mirrors it with examples. When in doubt, the .ts file
> wins.

## Top-level shape

```ts
interface Cosmos {
  version: string;                     // "0.1.0" for now
  kind?: "codebase" | "knowledge" | "general";  // optional projection hint; default "general"
  project: CosmosProject;
  nodes: CosmosNode[];
  edges: CosmosEdge[];
  layers: CosmosLayer[];
  tour?: CosmosTourStep[];             // optional canonical walkthrough
  perspectives?: CosmosPerspective[];  // optional variant tours (design lenses)
  subgraphs?: CosmosSubgraph[];        // user-driven drill-down results
}
```

`tour`, `perspectives`, and `subgraphs` are all optional and have
clearly distinct roles:

| Field | Who writes it | When | What it does |
|---|---|---|---|
| `tour[]` | Agent, pre-curated | After nodes+edges, Pass 3 | Single canonical walking path through the cosmos |
| `perspectives[]` | Agent, pre-curated | Pass 4 (optional) | Variant walks framed by design lenses |
| `subgraphs[]` | Agent, in response to user drill | On demand | Focused expansions the user requested |

See SKILL.md's *Perspective tours* and *Drill-down* chapters for the
full discipline around the latter two.

## `project` — metadata about the work being projected

```ts
interface CosmosProject {
  name: string;                // "The Antiqued Map", "OMNE-Next", "Paper §4"
  kind?: string;               // free-form domain tag: "codebase", "fiction:mystery", "research:abstract"
  description?: string;        // one paragraph (user language)
  source?: string;             // pointer back: git commit, URL, or short identifier
  sourceRoot?: string;         // ABSOLUTE filesystem path to source root — drives the "Open project root in editor" affordance
  analyzedAt?: string;         // ISO timestamp
}
```

**Rules:**
- `name` is required and should match how the user thinks of the
  work, not just a file path.
- `kind` is your shorthand; the evolution agent reads it across
  sessions to spot patterns.
- `sourceRoot` is the **single most useful field** when the cosmos
  projects on-disk content (codebase, notes folder, manuscript
  directory). Set it to the absolute path of the source root. The
  viewer's INFO tab renders a "Open project root in editor" button
  from this — the user clicks once to open Cursor/VS Code with the
  whole project as the workspace, and from that point on, clicking
  any `file` source-chip on a node lands in the same editor window
  naturally (the editor activates the file within the open
  workspace). Leave undefined for cosmoses whose sources are URLs,
  conversation transcripts, or otherwise have no single on-disk
  root.

## `layers[]` — the grouping table

```ts
interface CosmosLayer {
  id: string;          // stable kebab-case: "characters", "clues", "service"
  label: string;       // display label (user language): "Characters", "Clues", "Service Layer"
  color?: string;      // CSS color: "#f97316", "hsl(280 60% 60%)"
  description?: string; // shown in the legend on hover (user language)
}
```

**Rule:** every `layerId` referenced in a node MUST exist here. The
viewer treats unknown `layerId` as "no layer" and falls back to a
neutral color.

Use 3–6 layers as the comfortable range. Fewer than 3 means the
cosmos isn't grouped (visual chaos). 7–8 is fine when each is a
genuinely distinct concern. Beyond 8, layers are doing the work of
node-types — re-think.

## `nodes[]` — the atoms

```ts
interface CosmosNode {
  id: string;                       // stable kebab-case, often layer-prefixed: "c-eliot", "fn-auth-login"
  type: string;                     // OPEN STRING — vocabulary for this domain (English kebab-case)
  name: string;                     // display name (user language; verbatim if it lives in the source)
  layerId?: string;                 // must reference layers[].id
  summary: string;                  // one sentence, two max (user language)

  // Cross-vocabulary classification ──────────────────────────
  category?: CosmosNodeCategory;    // domain-agnostic chip-filter axis (see below)
  complexity?: "simple" | "moderate" | "complex";  // subjective; viewer renders as a badge on layer cards

  // Source references ───────────────────────────────────────
  sources?: CosmosSourceRef[];      // one or more pointers back to the artifacts that produced the node (see Source Refs)

  // Display hints ───────────────────────────────────────────
  languageNotes?: string;           // stack / framework / dialect note shown in INFO panel
  tags?: string[];                  // search / filter tags

  // Domain projections (rare; mode-specific extras) ────────
  domainMeta?: CosmosNodeDomainMeta;       // for business / DDD nodes (entities, businessRules, flow entry, …)
  knowledgeMeta?: CosmosNodeKnowledgeMeta; // for wiki / knowledge nodes (wikilinks, backlinks, content)
  meta?: Record<string, unknown>;          // free escape hatch; framework-opaque

  // Deprecated (kept for back-compat) ──────────────────────
  source?: string;                  // pre-sources[] single-pointer field; normalizer migrates to sources[0]
  lineRange?: [number, number];     // pre-sources[] file range; normalizer folds into sources[0].range
}

type CosmosNodeCategory =
  | "code" | "config" | "docs" | "infra"
  | "data" | "domain" | "knowledge" | "other";
```

**Rules:**
- `id` is stable across re-projections — preserve when content didn't change.
- `type` is your vocabulary choice (see `references/node-type-vocabularies.md`). English kebab-case.
- `summary` is what the user reads on the card; keep it tight; user language.
- `category` is **orthogonal** to `type` — it powers the top-strip type-chip filter (CODE / DOCS / INFRA / DATA / DOMAIN / KNOWLEDGE / OTHER). Set it whenever the node clearly belongs to one of those.
- `complexity` is a subjective hint; the viewer's layer-overview cards aggregate it.
- `sources` — see the dedicated section below; every node should have at least one.
- `meta` is yours — stash anything. Framework doesn't interpret it.

## `CosmosSourceRef` — multi-formed source pointers

Six kinds, all sharing an optional `label` override:

```ts
type CosmosSourceRef =
  | { kind: "file"; path: string; range?: [number, number]; label?: string }
  | { kind: "url"; url: string; label?: string }
  | { kind: "passage"; file: string; locator: string; quote?: string; label?: string }
  | { kind: "image"; path: string; label?: string }
  | { kind: "audio"; path: string; t?: number; label?: string }
  | { kind: "video"; path: string; t?: number; label?: string };
```

| kind | Open via | Use case |
|---|---|---|
| `file` | OS default app / picked editor | Code, prose files, structured docs |
| `url` | Default browser | Web references, external docs, related work |
| `passage` | Underlying file (locator + quote in tooltip) | Pinpoints inside long-form prose (novels, papers) |
| `image` | OS image viewer | Diagrams, screenshots, photos |
| `audio` | OS audio app | Interview clips, transcripts of audio |
| `video` | OS video app | Demo videos, lectures |

See SKILL.md's *Source references* chapter for per-domain examples
(codebase / fiction / research) and the citation discipline.

## `edges[]` — the relationships

```ts
interface CosmosEdge {
  source: string;      // node id
  target: string;      // node id
  type: string;        // OPEN STRING — relationship verb (English kebab-case or snake)
  direction?: "forward" | "backward" | "bidirectional";  // default "forward"
  description?: string; // shown on edge hover (user language)
  weight?: number;     // 0–1; drives layout emphasis
}
```

**Rules:**
- `source` and `target` must reference existing `nodes[].id` (or, in
  a subgraph's edges, ids in either the main graph or the subgraph).
  The viewer drops edges with unknown endpoints (defensively), but
  you shouldn't write them.
- Use **specific verbs**: `discovers`, `authored`, `vanished_near`,
  `imports`, `refutes`, `precedes`. Avoid `relates_to` /
  `connected_to` — they convey nothing.
- `bidirectional` is sparingly used — it usually means you haven't
  decided which side owns the relationship.

## `tour[]` — the canonical walkthrough

```ts
interface CosmosTourStep {
  step: number;        // 1-based order
  nodeId: string;      // node to focus this step
  narrative: string;   // one paragraph (user language)
}
```

**Rules:**
- 5–8 steps. If you can't tell the story in 8, the cosmos needs
  pruning or its layers are wrong.
- The tour is a **reading path**, not a complete walk. It can skip
  nodes that aren't load-bearing for the gestalt.

## `perspectives[]` — variant tours (design lenses)

```ts
interface CosmosPerspective {
  id: string;          // "perspective-cybernetic-loop", "perspective-orthogonality"
  name: string;        // noun phrase (user language)
  lens: string;        // OPEN STRING, English kebab-case: "cybernetic-loop", "tension", "orthogonality"
  insight: string;     // 1-paragraph thesis (user language); shown as stepper header — NOT reused per step
  steps: CosmosPerspectiveStep[];  // ordered walk
  evidence?: string;   // optional — why the inference is reasonable
  tags?: string[];
}

interface CosmosPerspectiveStep {
  focus: string[];     // 1+ node ids lit on this beat (first is primary anchor for INFO panel)
  narrative: string;   // step's OWN paragraph — not the perspective's thesis (user language)
}
```

**Rules:**
- 3–6 steps per perspective typically.
- Every step's `focus` must contain ids that exist in `nodes[]`.
- Every step's `narrative` must be **distinct** from the
  perspective's `insight` and from other steps. Repeating the
  thesis on every step is the tell that the perspective isn't sharp
  enough. See SKILL.md's *Perspective tours / Discipline* chapter.

**Backward compat:** old files used `cosmos.tao[]` with `type` field
and flat `manifestsIn: string[]`. The normalizer auto-migrates:
`tao → perspectives`, `type → lens`, `manifestsIn → steps` (each id
becomes a step with `insight` reused as narrative — degraded). New
files should write `perspectives[]` with `steps[]` directly.

## `subgraphs[]` — user-driven drill-down results

```ts
interface CosmosSubgraph {
  id: string;                   // "subgraph-<slug>", stable kebab-case
  anchors: string[];            // node ids (in parent graph or parent subgraph) the drill expands from
  prompt: string;               // verbatim user prompt that triggered the drill
  status: "pending" | "ready" | "failed";
  generatedAt?: string;         // ISO timestamp
  message?: string;             // failure explanation when status === "failed"
  parentSubgraphId?: string;    // for nested drills (recursive depth)
  title?: string;               // 4–8 word noun phrase (user language); shown in DRILLS list + breadcrumb
  nodes?: CosmosNode[];         // subgraph's own nodes (full CosmosNode shape — cite sources!)
  edges?: CosmosEdge[];         // edges inside this subgraph; endpoints can reference anchors (main-graph ids) or new subgraph ids
}
```

**Rules:**
- `anchors` is the drill's primary key — same anchor set + same
  prompt would conceptually mean "same drill"; write a new id if
  you're refining it.
- `status: "ready"` is what the viewer actually navigates into.
  Write `"pending"` only if you're doing two-phase generation; one-
  shot ready writes are fine and simpler.
- A subgraph's `nodes[]` can re-reference anchor ids to link back
  to the main graph; ids unique to the subgraph render as new
  scope-local content.
- After writing a subgraph, emit a `<viewer-locator
  address='{"subgraphId":"…"}' label="…"/>` in chat so the user
  can navigate.

See SKILL.md's *Drill-down* chapter for the full request/response
protocol.

## Validation rules (defensive, viewer-side)

The viewer doesn't reject malformed cosmos — it shows what it can. But:

1. Missing `layerId` → node renders with neutral gray.
2. Unknown `layerId` → same.
3. Edge endpoints not in `nodes[]` (or, for subgraph edges, not in
   anchors + subgraph nodes) → edge silently dropped.
4. `tour[]` step with unknown `nodeId` → tour step silently skipped.
5. `perspective.steps[].focus` ids unknown → step renders the
   narrative but the canvas doesn't light up; user gets confused.
6. `subgraph.status: "ready"` with no nodes → viewer renders an
   empty subgraph view; not useful.
7. Duplicate `nodes[].id` → last write wins (don't do this).

When in doubt, run `capture({})` after writing to see what the user
will see — that's the only test that matters.

## Auto-migration (read-time normalization)

The viewer's source parser runs `normalizeCosmos()` on every read.
It converts these legacy shapes transparently — older `cosmos.json`
files never have to be rewritten, but new writes should use the new
shapes:

| Legacy | Current | Action |
|---|---|---|
| `cosmos.tao[]` | `cosmos.perspectives[]` | Field rename |
| `perspective.type` | `perspective.lens` | Field rename per entry |
| `perspective.manifestsIn: string[]` | `perspective.steps: CosmosPerspectiveStep[]` | Each id → `{ focus: [id], narrative: insight }` (degraded — same narrative every step) |
| `node.source: string` | `node.sources: CosmosSourceRef[]` | Wrap as `{ kind: "url" \| "file", … }` based on `http(s)://` prefix; carry `lineRange` into `sources[0].range` |

## Example (abridged — code domain)

```json
{
  "version": "0.1.0",
  "kind": "codebase",
  "project": {
    "name": "OMNE-Next",
    "description": "Always-on agentic system; published-language migration v0.2 → v0.3."
  },
  "layers": [
    { "id": "foundation", "label": "契约层", "color": "#94a3b8" },
    { "id": "perception", "label": "感知与交互", "color": "#22d3ee" }
  ],
  "nodes": [
    {
      "id": "ct-published-language",
      "type": "concept",
      "name": "Published Language",
      "layerId": "foundation",
      "summary": "omne_core_v1 是 published language；omne_core 是过渡期共存的 legacy。",
      "category": "code",
      "complexity": "moderate",
      "sources": [
        { "kind": "file", "path": "packages/omne_core_v1/__init__.py", "label": "v1 入口" },
        { "kind": "file", "path": "packages/omne_core/__init__.py", "label": "legacy" }
      ]
    }
  ],
  "edges": [
    { "source": "ct-published-language", "target": "sp-omne-core-v1", "type": "embodies" }
  ],
  "tour": [
    { "step": 1, "nodeId": "ct-published-language", "narrative": "从命名学开始：_v1 后缀不是版本号，是 published-language 的字面标记。" }
  ],
  "perspectives": [
    {
      "id": "perspective-succession",
      "name": "v0.2 单体 → v0.3 published-language 并行迁移",
      "lens": "paradigm-shift",
      "insight": "新旧两套契约并存是中间态而非债务——v1 是发布的语言，老代码继续供血到迁完。",
      "steps": [
        {
          "focus": ["ct-published-language", "sp-omne-core", "sp-omne-core-v1"],
          "narrative": "先看命名学：_v1 是发布语言的字面标记，omne_core 仍在为没迁完的子项目供血。"
        }
      ]
    }
  ]
}
```

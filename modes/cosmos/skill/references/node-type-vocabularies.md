# Node-Type Vocabularies

> When you start a fresh projection, pick a vocabulary that fits the
> content's domain. These are starting points — extend them when the
> content demands. The point is to pick **a coherent set**, not to
> use every name listed.

## Codebase

**Nodes:** `file`, `function`, `class`, `module`, `interface`, `type`,
`config`, `service`, `endpoint`, `table`, `schema`, `resource`, `test`

**Edges:** `imports`, `calls`, `contains`, `extends`, `implements`,
`depends_on`, `references`, `tests`, `configures`

**Layers (typical):** `api`, `service`, `data`, `ui`, `utility`,
`config`

**Project kind:** `"codebase"` or `"codebase:<framework>"` (e.g.,
`"codebase:react"`).

## Fiction (novels, stories, scripts)

**Nodes:** `character`, `place`, `object`, `event`, `clue`, `motif`,
`inference`, `chapter`, `scene`

**Edges:** `discovers`, `meets`, `vanished_near`, `belongs_to`,
`occurs_at`, `precedes`, `refers_to`, `supports`, `contradicts`,
`related_to`

**Layers (typical):** `characters`, `objects`, `places`, `events`,
`clues`, `inferences`

**Project kind:** `"fiction:mystery"`, `"fiction:literary"`,
`"fiction:script"`.

## Research (papers, reports)

**Nodes:** `claim`, `evidence`, `concept`, `method`, `result`,
`limitation`, `dataset`, `figure`, `citation`, `counter-argument`

**Edges:** `supports`, `refutes`, `cites`, `extends`, `qualifies`,
`relies_on`, `contrasts_with`, `precedes`

**Layers (typical):** `claims`, `evidence`, `methods`, `results`,
`limitations`

**Project kind:** `"research:paper"`, `"research:survey"`,
`"research:abstract"`.

## Business workflow

**Nodes:** `domain`, `flow`, `step`, `actor`, `system`, `decision`,
`event`, `metric`, `policy`

**Edges:** `triggers`, `consumes`, `produces`, `decides`, `escalates_to`,
`measures`, `governs`

**Layers (typical):** `domains`, `flows`, `actors`, `systems`,
`metrics`

**Project kind:** `"business:flow"`, `"business:org"`,
`"business:process"`.

## Knowledge base (Karpathy-style LLM wiki)

**Nodes:** `topic`, `article`, `entity`, `concept`, `claim`, `source`

**Edges:** `categorizes`, `references`, `defines`, `cites`,
`example_of`, `subclass_of`

**Layers (typical):** `topics`, `articles`, `entities`, `sources`

**Project kind:** `"wiki"` or `"wiki:<community>"`.

## Conversation / thread

**Nodes:** `participant`, `message`, `claim`, `question`, `decision`,
`open-loop`

**Edges:** `replies_to`, `agrees_with`, `disagrees_with`, `clarifies`,
`asks`, `resolves`

**Layers (typical):** `participants`, `claims`, `questions`,
`decisions`

**Project kind:** `"thread"`, `"thread:slack"`, `"thread:meeting"`.

## Photo / media collection

**Nodes:** `photo`, `subject`, `place`, `event`, `motif`, `caption`

**Edges:** `depicts`, `taken_at`, `during`, `references`

**Layers (typical):** `photos`, `subjects`, `places`, `events`

**Project kind:** `"media:photo"`, `"media:scrapbook"`.

## Mixed / unknown

Sometimes the user brings a tarball with code + docs + screenshots,
or a project folder with everything. In that case:

1. **Pick the dominant lens** — what's the user most likely asking
   about? If it's "explain the code", treat docs as adjacent.
   If it's "explain the design", treat code as evidence for design
   decisions.
2. **Layer cuts the rest** — use layers to make the secondary domain
   findable without re-typing every node.
3. **Don't mix `file` and `character` in one cosmos** — that's two
   different projections fighting. Ask the user which one they want
   first, project that, and offer the other as a separate workspace.

## Extending vocabularies

Add a new `type` value when:
- You find yourself reaching for a verb-y noun that doesn't fit
  any existing one ("this is a `hypothesis`, not a `claim`").
- The user explicitly names a domain concept ("treat regions as
  `region` nodes").

Don't add a new `type` for:
- Subdivision of an existing type — that's what `tags` are for.
  (Don't make `internal-function` + `external-function` — use
  `type: function, tags: [internal]`.)
- One-off cases — if you're only going to use it once, just put it
  in the summary.

When in doubt, fewer types is better. Edges carry most of the
expressive load.

# NOTICE

The Cosmos mode borrows substantial design from an upstream project.
This file pins what we took, what we adapted, and what we dropped.

**The pin below is a provenance record, not a sync baseline.** Unlike
`kami` and `webcraft` — where Pneuma genuinely tracks upstream content
and a version pin measures real debt — Cosmos borrowed a schema shape,
a tech-stack choice, and a UI concept, then diverged deliberately. No
source file was copied (see Compliance posture). Upstream has since
moved on to domain graphs, knowledge bases, and design-file analysis
while Pneuma's Cosmos generalized the projection and rebuilt its engine
on the Workflow tool. Counting commits between the pinned SHA and
upstream `HEAD` measures upstream's own development pace, not a Pneuma
backlog; there is no sync obligation here. Read upstream releases for
ideas worth stealing, and update this file when we steal one.

**The pin therefore moves only when we steal.** It marks the newest
upstream release we have actually taken something from — not the last
one we read, and never upstream `HEAD`. Reading a release and deciding
it holds nothing for us is a complete and legitimate outcome that
changes nothing in this file.

## Upstream

- **Name**: Understand Anything (`Lum1104/Understand-Anything`)
- **Author**: Yuxiang Lin ([@Lum1104](https://github.com/Lum1104))
- **Homepage**: <https://understand-anything.com>
- **Repository**: <https://github.com/Lum1104/Understand-Anything>
- **License**: MIT (SPDX: `MIT`)
- **Version pinned**: commit `f08763d11d0202a8a8f52b5dedda6d1b2e2ebac8`
  (tag `v2.9.0`, 2026-07-10) — the release we last took something from.
  The previous pin was `470cc01dc5f9236a93eb704afdd479cd5db79710`
  (2026-05-25); 142 upstream commits separate the two, of which we
  adopted the two listed below. Upstream `HEAD` is another 90 commits
  past this pin — deliberately not tracked, per the paragraph above.
- **Synced at**: 2026-08-28

> The repository has since moved to `Egonex-AI/Understand-Anything`;
> the `Lum1104` URL above redirects there, and the upstream `LICENSE`
> gained a second copyright holder at `v2.9.0` (reflected verbatim
> below).

## What we borrowed

| Pneuma file | Upstream source | Note |
|---|---|---|
| `modes/cosmos/types.ts` (Cosmos / CosmosNode / CosmosEdge / CosmosLayer / CosmosTourStep shape) | `understand-anything-plugin/packages/core/src/schema.ts` (`KnowledgeGraph` zod schema) | Direct shape borrow — top-level keys (nodes / edges / layers / tour) and node/edge fields. Generalized `node.type` from closed enum to open string; see Adapt. |
| Tech-stack choice (React Flow + dagre for layout) | `understand-anything-plugin/packages/dashboard/src/components/GraphView.tsx` + `utils/elk-layout.ts` | Same library family. Pneuma reused `@xyflow/react@12` already on dependency manifest (illustrate); `@dagrejs/dagre` likewise. |
| Persona-density UI concept (`overview` / `learn` / `deep-dive`) | `understand-anything-plugin/packages/dashboard/src/App.tsx` (persona selector) | Same three-level density model; same names. Implementation re-written for Pneuma's viewer shell. |
| `modes/cosmos/skill/references/node-type-vocabularies.md` → **Design system** vocabulary | `understand-anything-plugin/packages/core/src/schema.ts` design node/edge types + `agents/design-analyzer.md` (`v2.9.0`, the `/understand-figma` mode) | Took the *distinctions*: `component` vs `instance` vs `component-set`, and `token` as the leaf everything bottoms out in, with `instance_of` / `variant_of` / `uses_token`. See Adapt for what we did not take. |

## What we adapted

- **`node.type` from closed enum → open string.** Upstream's schema
  fixes ~20 node types (`file`, `function`, `class`, `claim`,
  `topic`, …) optimized for code + knowledge-base domains. Pneuma's
  Cosmos generalizes the projection to *any* content; the agent
  chooses the vocabulary per content domain. `references/
  node-type-vocabularies.md` documents starting vocabularies for
  several domains.
- **Slash commands → actions + commands.** Upstream exposes 8
  `/understand-*` slash commands (Claude Code plugin convention).
  Pneuma folds most into ordinary chat (`/understand-explain`,
  `/understand-chat`, `/understand-knowledge` etc. all become "ask
  the agent in the chat"). What remains is split per Pneuma's
  protocol: agent-invoked **actions** (`navigate-to`, `focus-layer`,
  `fit-view`, `switch-persona`) and user-invoked **commands**
  (`regenerate`, `onboard`).
- **Brand color.** Upstream's rose-gold accent (`#d4a574`) is
  replaced by Pneuma's Ethereal Tech orange (`#f97316`) for selection
  state. Per-layer colors are mode-defined (the agent picks them in
  `cosmos.json::layers[].color`).
- **Design vocabulary: no API, no `kind` enum, layers by node kind
  (`v2.9.0`).** Upstream's `/understand-figma` pairs its design types
  with a deterministic Figma REST parse, a `FIGMA_TOKEN`, and a
  top-level `kind: "design"` added to its graph enum. We took none of
  that. Cosmos's agent reads whatever files the user hands it (a
  component tree, a token file, an exported document), so the
  vocabulary is prose guidance rather than a parser contract; `node.type`
  stays an open string and `project.kind` an open string, so nothing in
  `schema.ts` moved. Upstream also layers a design graph one-layer-per-
  Figma-page — Pneuma's layers are *what kind of node*, so ours cut
  `screens` / `components` / `tokens` / `flows`.
- **Merge loudness: adopted the principle, not the mechanism
  (`v2.9.0`).** Upstream's `merge-batch-graphs.py` flags batch files
  that load but contribute zero nodes/edges, and
  `merge-subdomain-graphs.py` persists a `merge-report.json` so
  structural edges dropped for a missing endpoint get retried on the
  *next* run. Pneuma's projection pipeline had the same silence for a
  different reason: `parallel()` turns a thrown thunk into `null` and
  `agent()` resolves to `null` for a dead subagent, so a whole partition
  could disappear between Extract and Merge without a log line. We took
  the principle — a partition that contributes nothing is a reported
  outcome — and fit it to our shape: a per-partition contribution ledger
  in `stats.partitions[]`, one in-run re-dispatch (upstream only flags;
  we can retry because our slices are re-readable, not one-shot files),
  and dropped edges itemised with the endpoint id that went missing.
  No report file: a Workflow script has no filesystem access, so the
  report rides the return value and SKILL.md Path A step 3 makes acting
  on it the agent's job.
- **Storage location.** Upstream writes to
  `.understand-anything/knowledge-graph.json` in the analyzed
  codebase root. Pneuma's Cosmos writes to `cosmos.json` at workspace
  root — matches Pneuma's mode/workspace convention.

## What we dropped

- **Multi-platform install scripts** (`install.sh`, `install.ps1`,
  per-platform manifest wrappers `.cursor-plugin/`, `.copilot-plugin/`
  etc.). Pneuma has its own distribution via the mode marketplace.
- **Standalone Astro homepage** (`homepage/`). Replaced by Pneuma's
  showcase JSON + launcher gallery cards.
- **`.understand-anything/config.json`**. Pneuma init params + the
  `pneuma-cosmos` skill handle configuration.
- **Tree-sitter pre-parse** for code. The Pneuma agent reads source
  natively via Read / Glob / Grep tools. Still not adopted; sub-function
  granularity has not been needed so far.
- **ELK layout engine.** We use Dagre LR — simpler, ships smaller,
  sufficient for typical cosmos sizes (≤ 200 nodes). Still Dagre today
  (`viewer/CosmosPreview.tsx`). Upstream moved to ELK in its v2.5.0 to
  fix horizontal sprawl on layers with 50+ nodes, pairing it with
  folder/community containers and a two-stage lazy layout — a live idea
  worth revisiting for Pneuma if cosmos sizes grow, not something we
  shipped.
- **Multi-platform batch orchestration.** Upstream batches files with
  size auto-scaling and merges sub-graphs via `compute-batches.mjs` /
  `merge-batch-graphs.py`. Pneuma does not use that machinery — but note
  Pneuma now runs its *own* multi-agent pipeline: on Claude Code, large
  projections hand off to `skill/references/projection.workflow.js`
  (Extract → Merge → Verify → Complete → Perspectives, one subagent per
  partition, adversarial per-node verification, a completeness critic
  looping until dry, and a judge panel over perspectives). Codex / Kimi
  backends and small inputs fall back to the in-context passes. The
  convergence is on the idea of a multi-pass pipeline, not on upstream's
  implementation — Pneuma's is built on the Workflow tool and grounded
  in a `node.trust` model that upstream does not have.

## Compliance posture

MIT only requires that the copyright + license notice be included
"in all copies or substantial portions of the Software". We did
not copy any source files verbatim — `modes/cosmos/types.ts` was
hand-written against upstream's documented schema shape (nodes /
edges / layers / tour), not a transcription of
`understand-anything-plugin/packages/core/src/schema.ts`. Strictly
speaking, the no-substantial-copy posture means MIT attribution
isn't legally required here at all.

We're reproducing the full notice anyway as a good-faith citation
of the design's origin, and surface the upstream as `inspiredBy`
in `manifest.ts` so the launcher gallery card carries a clickable
"Inspired by Lum1104/Understand-Anything" chip. That mirrors how
`kami` credits `tw93/kami` and `webcraft` credits
`pbakaus/impeccable`.

## License — verbatim from upstream LICENSE

The MIT license text below is the exact wording from the upstream
`LICENSE` file at the pinned commit (verified against `git show
v2.9.0:LICENSE` in a fresh clone; the second copyright line was added
upstream between the old pin and this one):

```
MIT License

Copyright (c) 2026 Yuxiang Lin
Copyright (c) 2026 Infinite Universe, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

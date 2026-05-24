# NOTICE

The Cosmos mode borrows substantial design from an upstream project.
This file pins what we took, what we adapted, and what we dropped, so
future syncs can be performed against the pinned upstream version.

## Upstream

- **Name**: Understand Anything (`Lum1104/Understand-Anything`)
- **URL**: <https://github.com/Lum1104/Understand-Anything>
- **License**: MIT
- **Version pinned**: commit `470cc01dc5f9236a93eb704afdd479cd5db79710`
- **Synced at**: 2026-05-24

## What we borrowed

| Pneuma file | Upstream source | Note |
|---|---|---|
| `modes/cosmos/types.ts` (Cosmos / CosmosNode / CosmosEdge / CosmosLayer / CosmosTourStep shape) | `understand-anything-plugin/packages/core/src/schema.ts` (`KnowledgeGraph` zod schema) | Direct shape borrow — top-level keys (nodes / edges / layers / tour) and node/edge fields. Generalized `node.type` from closed enum to open string; see Adapt. |
| Tech-stack choice (React Flow + dagre for layout) | `understand-anything-plugin/packages/dashboard/src/components/GraphView.tsx` + `utils/elk-layout.ts` | Same library family. Pneuma reused `@xyflow/react@12` already on dependency manifest (illustrate); `@dagrejs/dagre` likewise. |
| Persona-density UI concept (`overview` / `learn` / `deep-dive`) | `understand-anything-plugin/packages/dashboard/src/App.tsx` (persona selector) | Same three-level density model; same names. Implementation re-written for Pneuma's viewer shell. |

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
  natively via Read / Glob / Grep tools; parallel Task subagents
  handle large codebases. Tree-sitter MCP server is a possible
  v0.2 addition for sub-function granularity.
- **ELK layout engine.** We use Dagre LR for v0.1 — simpler, ships
  smaller, sufficient for typical cosmos sizes (≤ 200 nodes).
  ELK is a sensible v0.2 upgrade when sizes grow.
- **Multi-agent batch analysis pipeline.** Upstream batches files
  with size auto-scaling and merges sub-graphs. Pneuma's agent
  achieves the same through the Task subagent pattern (which is
  framework-native) — no separate `compute-batches.mjs` /
  `merge-batch-graphs.py` machinery required.

## License excerpts

The upstream is MIT-licensed. The full license is reproduced from
the pinned commit:

```
MIT License

Copyright (c) 2025 Lum1104 / Understand-Anything contributors

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

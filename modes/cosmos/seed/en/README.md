# Welcome to Cosmos — bootstrap edition

The cosmos you're looking at is **Pneuma Skills projected onto itself**.

That's not just a cute demo. Pneuma is the project that makes cosmos
possible — its protocol surface, its runtime, its viewer-contract, its
backends, its modes, its reference docs. Projecting it as a cosmos
gives you the gestalt in one screen: which abstractions are
load-bearing, what depends on what, where to start reading.

> **A note on language** — every prose field here is in English
> because pneuma-skills itself is an English-source project. When you
> ask the agent to project *your* content (Chinese codebase, Japanese
> story, French paper, …), it should follow your working language
> instead — names, summaries, layer labels, tour narratives,
> perspective insights all switch over. Stable identifiers and the type system
> (`node.type`, `edge.type`, all `id`s) stay English / kebab-case
> regardless, because they function as a vocabulary, not as display
> text. See the **Language** core rule in `skill/SKILL.md`.

## What's in this cosmos

- **~55 nodes** across six layers:
  - **Contracts** (amber) — the types in `core/types/` that everyone
    else is written against. `ModeManifest`, `ViewerContract`,
    `Source<T>`, `AgentBackend`, `BackendModule`, …
  - **Runtime** (violet) — server-side machinery: mode-loader,
    source-registry, skill-installer, ws-bridge, handoff-routes, …
  - **Backends** (cyan) — Claude Code, Codex, Kimi CLI.
  - **Modes** (orange) — the 14 mode packages, including `cosmos`
    itself (the meta loop).
  - **Shell** (pink) — the React frontend that mounts viewers and
    drives the chat.
  - **Reference** (mint) — the canonical narratives in
    `docs/reference/`, `CLAUDE.md`, and the `create-mode` skill.
- **~65 edges** with specific verbs — `implements` / `subscribes_to`
  / `documents` / `composes` / `dispatches` / `generated_via` / …
- **A 7-step tour** that walks you from the protocol surface down to
  the `cosmos` node that represents this very mode, and out to the
  skill that produced it.

Click the **Onboard** command in the viewer to walk the tour. Click a
layer in the sidebar to focus it (others dim). Switch **Density** for
more or less detail per node card.

## Try it on your own content

This seed replaces itself the first time you say "regenerate from
fresh input". Some patterns:

- **Drop a folder of source code** and ask the agent to project it —
  you'll get a graph with `file` / `function` / `class` / `module`
  nodes and `imports` / `calls` / `extends` edges. Useful on a new
  codebase.
- **Drop a short story or chapter** (e.g. `story.md`) — you'll get
  `character` / `event` / `clue` / `inference` nodes and verbs like
  `discovers` / `supports` / `contradicts`. Useful for dense fiction
  or detective work.
- **Drop a research paper or technical brief** — you'll get `claim` /
  `evidence` / `method` nodes and `supports` / `refutes` / `cites`
  edges.
- **Drop a conversation transcript** — you'll get a decision graph
  with `participant` / `claim` / `decision` / `open-loop` nodes and
  `replies_to` / `agrees_with` / `resolves` edges.

The vocabulary is open. The agent picks it per content domain; see
`skill/references/node-type-vocabularies.md` for starting catalogs.

## When you're ready

Replace this `cosmos.json` (the agent will do it on `regenerate`), or
just say "project this file as a cosmos" and point the agent at the
content. The viewer re-renders live.

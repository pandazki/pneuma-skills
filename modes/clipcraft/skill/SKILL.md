---
name: clipcraft
description: AI-orchestrated video production on @pneuma-craft
---

# ClipCraft

> **Skill status:** persistence-only (read/write `project.json` round-trips cleanly). Playback, interactive timeline UI, and MCP generation tools are **not yet implemented** — Plan 4+. Until then your interaction with ClipCraft is primarily: (a) read the current state in the viewer's StateDump, (b) edit `project.json` directly to adjust composition / assets / provenance.

## What ClipCraft is

ClipCraft is a video-production mode where the **source of truth is a structured domain model**, not a file. The in-memory model is an event-sourced craft store from `@pneuma-craft`: an Asset registry, a Composition with Tracks and Clips, and a Provenance DAG that tracks how each asset was generated (and from what). The file `project.json` at the workspace root is a projection of that store — editing it re-hydrates the store, and store changes auto-serialize back to it.

The viewer consumes `project.json` through the runtime's `Source<T>` abstraction, so any time you edit the file with Write/Edit, the viewer auto-reflects the change. You don't need to do anything special after a write — no reload, no refresh signal.

This matters because ClipCraft is designed for **AIGC workflows**: assets are not uploaded, they're generated (Flux, Runway, GPT-Image, TTS, Lyria). Generations are async, expensive, and often come in variant sets that the user picks from. The Provenance DAG captures that lineage as a first-class concept, and the `Asset.status` lifecycle (`pending` → `generating` → `ready` / `failed`) represents async generations directly in the domain model.

## The `project.json` schema (`pneuma-craft/project/v1`)

Full type definitions live in [`modes/clipcraft/persistence.ts`](../persistence.ts). Minimum shape:

```json
{
  "$schema": "pneuma-craft/project/v1",
  "title": "Untitled",
  "composition": {
    "settings": { "width": 1920, "height": 1080, "fps": 30, "aspectRatio": "16:9" },
    "tracks": [],
    "transitions": []
  },
  "assets": [],
  "provenance": []
}
```

### `assets[]`

Each asset has:

- `id` (string) — stable id that survives round-trips; ids you write to disk are honored by the store
- `type` — `"video"` / `"image"` / `"audio"` / `"text"`
- `uri` — workspace-relative path (may be empty for `pending`/`generating` assets)
- `name` — human-readable label
- `metadata` — physical media properties only (`width`, `height`, `duration`, `fps`, `codec`, `sampleRate`, `channels`). **Do not put prompts or generation params here** — those belong on the provenance edge's `operation.params`.
- `createdAt` — Unix ms timestamp; survives hydration (Plan 3c)
- `tags?` — string array
- `status?` — `"pending"` / `"generating"` / `"ready"` / `"failed"`; absent means `"ready"`

### `provenance[]`

Each edge describes **how an asset was created**. For AIGC this is the most semantically important part of the file:

```json
{
  "toAssetId": "asset-forest-shot",
  "fromAssetId": null,
  "operation": {
    "type": "generate",
    "actor": "agent",
    "agentId": "clipcraft-videogen",
    "timestamp": 1712934000000,
    "label": "runway gen3-alpha-turbo",
    "params": {
      "model": "gen3-alpha-turbo",
      "prompt": "wide shot of a foggy forest at dawn",
      "seed": 42,
      "durationMs": 47000,
      "costUsd": 0.25,
      "providerJobId": "run_abc123"
    }
  }
}
```

- `fromAssetId` is `null` when the asset is generated from nothing (text prompt → image). Use a real asset id when deriving one asset from another (e.g. upscaling an image, extracting audio from a video). Both cases are first-class; don't force one into the other.
- `operation.type` is `"upload" | "import" | "generate" | "derive" | "select" | "composite"`. For AIGC work, almost everything is `"generate"` or `"derive"`.
- `operation.params` is a free-form object. The keys above (`model`, `prompt`, `seed`, `durationMs`, `costUsd`, `providerJobId`) are the **shared ClipCraft convention** — use them when they apply. You can add more keys as needed.
- `operation.actor` should be `"agent"` for agent-driven generations and `"human"` for direct user actions.

### `composition.tracks[]` and `tracks[].clips[]`

Plan 3a+ lets you specify explicit `id` fields for both tracks and clips; they round-trip through the store unchanged. All id fields are globally unique within their scope (clip ids are unique across all tracks in the composition, per craft-timeline's validation).

Time is in **seconds**, not frames. `fps` only matters for playback/export, not for data.

### `title`

The top-level `title` is tracked out-of-band in the viewer (craft's domain model has no `title` concept). Edit it freely — the viewer carries it across hydrate/serialize via a parent-owned ref.

## Editing workflow (today)

1. **Read** the viewer's StateDump to see the current composition/assets/event log.
2. **Edit** `project.json` with the Write / Edit tools. The file watcher picks the change up and re-hydrates the store automatically.
3. Status transitions (pending → generating → ready / failed) are expressed by editing the `status` field on the asset.
4. After a successful generation, set the asset's `uri` to the generated file path (relative to the workspace).

**What NOT to edit:**

- The `$schema` field — always `"pneuma-craft/project/v1"`.
- Raw craft event log files (there aren't any; craft's event log is in-memory only).
- Anything outside `project.json` unless instructed — the mode only watches that one file today.

## Known limitations you should be aware of

- **No playback.** You cannot preview the composition yet. Plan 4.
- **No MCP generation tools.** You cannot trigger image / video / TTS / BGM generation via tool calls yet; you have to edit `project.json` directly or shell out to provider APIs yourself. Plan 9.
- **No interactive viewer UI.** Clicking things in StateDump does nothing. Plan 5.
- **External file edits interrupt in-memory state.** Because there's no useful in-memory state yet, this is invisible. Once Plan 4 adds playback, agent-edited files will drop the PlaybackEngine position.
- **The skill vocabulary will change** when Plan 10 lands. For now, you're editing the on-disk schema directly; future plans will add higher-level MCP tools and a richer `<viewer-context>` payload.

## See also

- [`modes/clipcraft/ARCHITECTURE.md`](../ARCHITECTURE.md) — architecture narrative, data-flow diagrams, reading order for contributors
- [`docs/reference/viewer-agent-protocol.md`](../../../docs/reference/viewer-agent-protocol.md) — the protocol ClipCraft implements
- [`docs/superpowers/plans/NEXT.md`](../../../docs/superpowers/plans/NEXT.md) — completed and upcoming plans

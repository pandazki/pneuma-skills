---
name: pneuma-clipcraft
description: AI-orchestrated video production on @pneuma-craft. Use whenever the user wants to generate, edit, or compose video clips, audio tracks, captions, or background music — including text-to-video / image-to-video generation, TTS narration, music generation, provenance tracking, and timeline composition. Trigger on phrases like "generate video", "make a clip", "add narration", "try another take", "add BGM", "edit project.json", "place on the timeline", "AIGC assets", "regenerate this shot", or any request that touches the exploded timeline or the dive-in panels. Also use when editing `project.json` by hand, registering assets, or wiring provenance edges. Do not assume the user knows the schema — they usually don't; read `references/project-json.md` before committing to an edit.
---

# ClipCraft

ClipCraft is a video-production mode where the **source of truth is a
structured domain model**, not a file. The in-memory model is an
event-sourced craft store from `@pneuma-craft`: an Asset registry, a
Composition with Tracks and Clips, and a Provenance DAG that tracks
how each asset was generated (and from what). The file `project.json`
at the workspace root is a projection of that store — when you edit
it with Write/Edit, the viewer auto-re-hydrates. No reload, no
refresh signal.

ClipCraft is built for **AIGC workflows**: assets are generated, not
uploaded. You orchestrate image / video / TTS / BGM generation by
running bundled scripts, then record the lineage in `project.json`.

## Domain vocabulary (2-minute version)

- **Asset** — an addressable piece of media. Has `id`, `type`, `uri`,
  `name`, `metadata`, `status`, `createdAt`.
- **Track** — a horizontal lane in the timeline.
  `type` is `video` / `audio` / `subtitle`.
- **Clip** — a span on a track that references an asset via
  `assetId`. Has `startTime`, `duration`, `inPoint`, `outPoint` (all
  in seconds). Subtitle clips also carry `text` directly.
- **Scene** — a logical chunk of the composition that groups clips
  across tracks. Purely a human organization aid.
- **Provenance edge** — `{ toAssetId, fromAssetId, operation }`.
  Captures "how was this asset created".
  `fromAssetId: null` means generated from nothing; a real id means
  derived from another asset.
- **Composition** — the top-level container: settings
  (`width`/`height`/`fps`), tracks, transitions, duration.

Full schema in `references/project-json.md`. Id rules in
`references/asset-ids.md`.

## Generation scripts

Four bundled CLI scripts wrap the provider APIs. Call them via the
Bash tool; they write files and print the output path on stdout.

| Script | Purpose | Provider | Env var |
|---|---|---|---|
| `scripts/generate-image.mjs` | Text→image + image→image edit | fal.ai nano-banana-2 | `FAL_KEY` |
| `scripts/generate-video.mjs` | Text→video + image→video | fal.ai veo3.1 (~$0.20–0.60/sec) | `FAL_KEY` |
| `scripts/generate-tts.mjs` | Text→speech | OpenRouter `openai/gpt-audio` | `OPENROUTER_API_KEY` |
| `scripts/generate-bgm.mjs` | Text→background music | OpenRouter `google/lyria-3-pro-preview` | `OPENROUTER_API_KEY` |

All scripts share the same shape:

- `--output <path>` is always required and is workspace-relative.
- API keys come from `process.env`. If a key is missing, the script
  exits 1 with a clear error.
- On success: prints the output path on stdout, exits 0.
- On failure: prints an error on stderr, exits non-zero.
- The script creates the parent directory of `--output` if it's
  missing, and does not produce thumbnails or side-effect files.

Run `node .claude/skills/pneuma-clipcraft/scripts/<script>.mjs --help`
(or just read the script's argv-parse block) for the full arg list.

**Why this shape:** the script only does what a Bash subprocess does
best — call a provider API and save bytes. Schema knowledge lives in
this file + `references/project-json.md`, not in the scripts. You
compose provenance yourself via Edit on `project.json`.

## Typical workflow

1. **Read** the current `project.json` to understand the composition.
2. **Generate** assets by running one of the scripts with Bash.
3. **Register** each new asset in `project.json`:
   - Add an entry to `assets[]` with a stable semantic id.
   - Add a matching edge to `provenance[]` with
     `operation.type: "generate"` and `operation.params` filled out.
4. **Place** assets on the timeline by adding clips to the relevant
   track.
5. The viewer auto-reflects every edit — no reload needed.

Full worked examples for the three most common flows are in
`references/workflows.md`. When the user asks for a generation task,
pattern-match the closest example there first, then adapt.

## Viewer commands

The viewer exposes a row of command buttons (Generate image,
Generate video, Try another take, Add narration, Add BGM, Export
video). Clicks arrive as short natural-language messages in the
chat — they're hints about what the user wants next, usually with a
clip or scene pre-selected, not rigid tool calls.

Interpret them conversationally: read the viewer context to see
what's currently selected, then execute the matching workflow. If
the intent is ambiguous (for example a vague "generate video"),
confirm with the user before spending money on veo3.1.

## Gotchas

- **Metadata is for physical properties only.** Put `width`,
  `height`, `duration`, `fps`, `codec`, `sampleRate`, `channels` in
  `asset.metadata`. Put `prompt`, `model`, `seed`, `cost` etc. in
  `provenance.operation.params`.
- **`createdAt` must be stable.** When editing an existing asset,
  keep its `createdAt` unchanged — hydration relies on it.
- **Empty uri is legal** for `pending` or `generating` assets. Set
  the uri when the script finishes and the file exists.
- **Never edit `$schema`.** It's always `"pneuma-craft/project/v1"`.
- **Time is in seconds.** Not frames. `fps` only matters for
  playback/export.
- **`fromAssetId: null` means "from nothing"**, not "no lineage
  known". If the asset was generated from a text prompt alone, null
  is the correct value.
- **Clip ids are unique across all tracks**, not per-track. Use
  semantic names so collisions are easy to avoid.

## See also

- `references/project-json.md` — full `project.json` schema
- `references/workflows.md` — three end-to-end worked examples
- `references/asset-ids.md` — id naming and stability rules
- `scripts/` — the four bundled generator CLIs

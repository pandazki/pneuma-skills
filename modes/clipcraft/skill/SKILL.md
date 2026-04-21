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

Five bundled CLI scripts wrap the provider APIs. Call them via the
Bash tool; they write files and print the output path on stdout.

| Script | Purpose | Default model | Env var |
|---|---|---|---|
| `scripts/generate-image.mjs` | Text→image + image→image edit | fal.ai `nano-banana-2` | `FAL_KEY` |
| `scripts/generate-video.mjs` | Text→video + image→video + reference-to-video | bytedance `seedance-2.0` (fallback: `veo3.1` via `--model veo3.1`) | `FAL_KEY` |
| `scripts/generate-tts.mjs` | Text→speech (expressive: inline `[laughing]` / `[sigh]` tags, 30 voices) | fal.ai `gemini-3.1-flash-tts` | `FAL_KEY` |
| `scripts/generate-bgm.mjs` | Text→background music | OpenRouter `google/lyria-3-pro-preview` | `OPENROUTER_API_KEY` |
| `scripts/make-character-sheet.mjs` | Photo → photo-body / sketch-head 16:9 character reference sheet (recovery tool — call after seedance rejects a photorealistic human ref; see `references/filter-retries.md`) | fal.ai `nano-banana-2/edit` | `FAL_KEY` |

All scripts share the same shape:

- `--output <path>` is always required and is workspace-relative.
- API keys come from `process.env`. If a key is missing, the script
  exits 1 with a clear error.
- On success: prints the output path on stdout, exits 0.
- On failure: prints an error on stderr, exits non-zero.
- The script creates the parent directory of `--output` if it's
  missing, and does not produce thumbnails or side-effect files.

### Video subcommands

`generate-video.mjs` has three subcommands — one per scenario:

```bash
# 1. Text-to-video — default subcommand.
# Routes to bytedance/seedance-2.0/reference-to-video with zero refs
# (= pure t2v). Add --model veo3.1 to fall back to Google Veo 3.1.
node scripts/generate-video.mjs \
  --prompt "a serene bamboo forest with gentle wind" \
  --duration 4 --aspect-ratio 16:9 \
  --output assets/video/forest.mp4

# 2. First / last frame continuity — the `from-image` subcommand.
# Routes to bytedance/seedance-2.0/image-to-video by default.
# --image-url is the START frame; --end-image-url (seedance only)
# is an optional END frame for frame-to-frame interpolation.
node scripts/generate-video.mjs from-image \
  --prompt "the panda slowly rolls over and looks at the camera" \
  --image-url assets/images/panda-rolling.png \
  --duration 4 --aspect-ratio 16:9 \
  --output assets/video/panda-rolls.mp4

# 3. Multi-reference — the `reference` subcommand, seedance only.
# A compositional directing system: each ref is an addressable asset
# you assign a specific role in the prompt — character, first frame,
# destination environment, camera motion, style, audio bed.
# Addressing: 1-indexed by the order of the flag. First --image-url
# is @image1, second --image-url is @image2; videos and audios are
# numbered separately (@video1, @audio1, ...).
# Slots: up to 9 --image-url, 3 --video-url, 3 --audio-url (total ≤12).
# Audio refs require at least one image or video ref.
node scripts/generate-video.mjs reference \
  --prompt "Replace the character in @video1 with @image1, with @image1 as the first frame. Match the camera movement of @video1. Travel into the environment of @image2." \
  --image-url assets/image/hero.jpg         `# @image1: character` \
  --image-url assets/image/destination.jpg  `# @image2: destination` \
  --video-url assets/video/dolly-shot.mp4   `# @video1: camera grammar` \
  --duration 8 --aspect-ratio 16:9 \
  --output assets/video/shot.mp4
```

Full directive vocabulary (character / first frame / destination /
camera transfer / style / prop / POV / audio) lives in
`references/reference-directives.md`. Use it whenever more than one
visual intent needs to be pinned down — a single image plus long
prose prompt does not constrain seedance enough.

Shared flags across subcommands: `--duration` (required; `4`–`15`
seconds or `auto`; veo3.1 only allows `4`/`6`/`8`), `--aspect-ratio`
(seedance: `auto | 21:9 | 16:9 | 4:3 | 1:1 | 3:4 | 9:16`; veo3.1:
`16:9 | 9:16`), `--resolution` (seedance: `480p | 720p`; veo3.1:
`720p | 1080p`), `--no-audio` (disables generated audio — use when
the content policy rejects auto-audio), `--seed` (integer, seedance
only), `--model seedance | veo3.1`.

### Content-policy retries

Seedance has two distinct content-filter failure modes. The script
surfaces the full API response to stderr; match the error signature
and apply the matching recovery:

- `loc:["body","image_urls"]` + `partner_validation_failed` —
  image-side rejection. A photorealistic human face was detected in
  a reference. Run `scripts/make-character-sheet.mjs` on the photo
  to produce a photo-body / sketch-head 16:9 sheet, replace the
  `--image-url` with the sheet, and retry (add `--no-audio` on the
  retry too).
- `loc:["body","generated_video"]` + `"Output audio has sensitive
  content"` — audio-side rejection. Video frames are fine; just
  retry the exact same command with `--no-audio` appended.

Full decision tree, fallback to `--model veo3.1`, and hard-limit
notes (when to stop retrying and surface to the user) are in
`references/filter-retries.md`. The `character-consistency.md` doc
covers the sheet anatomy, honest limits, and prompt rules for the
image-side case.

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

## Character consistency (photorealistic humans)

When a specific human character appears — especially photorealistic,
and especially across multiple shots — follow the protocol in
`references/character-consistency.md`. Do **not** pass a photorealistic
headshot or all-photo character sheet directly to
`generate-video.mjs reference`: seedance 2.0's image-side filter
rejects photorealistic human faces at input with
`partner_validation_failed`, and prompt-side "virtual character" / "not
a real person" phrasing does not defeat it (the filter does not read
the prompt).

The verified-passing shape: a 16:9 sheet of 4 vertical panels, three
of them photographic full-body views with the **heads replaced by
white-line pencil sketches**, and a fourth panel holding a detailed
pencil portrait plus typewriter-style `OUTFIT` / `CHARACTER` notes.
Pass that sheet as the sole `--image-url`, use plain photorealistic
prompt words (no "CG render" / "virtual character" — they degrade
output quality), and always include `--no-audio` (seedance's
output-audio filter rejects these generations at the second gate).
Full recipe and honest-limits disclosures in the reference doc.

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
- `references/reference-directives.md` — @-addressing, role vocabulary, worked multi-ref example
- `references/character-consistency.md` — photo-body + sketch-head sheet workflow for realistic human characters
- `references/filter-retries.md` — decision tree for the two seedance 422 signatures
- `scripts/` — the five bundled generator CLIs (including `make-character-sheet.mjs` recovery tool)

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

## Working with the viewer

The viewer is the exploded 3D timeline rendering of `project.json`.
It is the user's source of truth for what's currently selected, what
the playhead is on, and what they're pointing at. Four channels link
the three actors (you, the user, the viewer):

### Reading what the user sees

Every user message arrives wrapped in `<viewer-context>` and (if the
user just clicked / dragged / seeked) `<user-actions>`. Read them
before you act. Typical clipcraft payloads:

- `<viewer-context>` — `selectedClipId`, `selectedAssetId`,
  `selectedTrackId`, `playheadTime` (seconds), `composition.duration`,
  the active asset's metadata. Use this to disambiguate a vague
  request like "try another take" — there's almost always a clip
  selected that tells you which one.
- `<user-actions>` — recent UI events: `playhead:seek`
  (`{time}`), `clip:select` (`{clipId, trackId}`),
  `asset:select` (`{assetId}`), `clip:drag` (`{clipId, startTime,
  trackId}`), `track:toggle-mute`, `track:toggle-visible`. Treat
  these as hints, not commands — the user usually expects you to
  read them and act, not echo them back.

If both are absent (cold start, command-button click), inspect
`project.json` directly and ask if intent is ambiguous.

### Locator cards

After creating or editing assets, clips, or moving the playhead,
embed `<viewer-locator>` cards so the user can jump straight to the
change. Emit one card per distinct thing you changed — a newly
generated asset, a clip you just placed, a time beat you built
around — not one per response. The user sees these as clickable
chips in chat. Use short concrete labels — "新的 VO 开场",
"panda clip on Main", "3.5s — punchline beat" — not generic ones
like "see asset".

Four `data` shapes for clipcraft:

```html
<!-- assetId — scrolls the asset library to the asset and flashes it. -->
<viewer-locator data='{"assetId":"asset-vo-tagline"}'>新的 VO 开场</viewer-locator>

<!-- clipId — selects the clip on the timeline AND seeks the playhead
     to its startTime, so the user lands on the frame you mean. -->
<viewer-locator data='{"clipId":"clip-shot1-spark"}'>panda clip on Main</viewer-locator>

<!-- time — seeks the playhead only (no selection change). Use for
     pure "go look at this beat" pointers. -->
<viewer-locator data='{"time":3.5}'>3.5s — punchline beat</viewer-locator>

<!-- trackId — scrolls and flashes a track header. Use when the
     change is track-level (mute/solo, reordered, new track). -->
<viewer-locator data='{"trackId":"track-narration"}'>narration track</viewer-locator>
```

### Viewer commands (user → agent)

The viewer toolbar exposes six command buttons. Clicks arrive as
short natural-language messages in chat — they're hints about what
the user wants next, usually with a clip or scene pre-selected, not
rigid tool calls. Read `<viewer-context>` to figure out the target,
then run the matching workflow. If intent is ambiguous (e.g. a vague
"generate video"), confirm before spending money on `veo3.1`.

| Command | Typical handling |
|---|---|
| Generate image | New image asset for the current selection — read context for scene/clip |
| Generate video | New video clip; confirm before veo3.1 if vague |
| Try another take | Variant of the selected clip's asset; register as a derived asset (provenance edge) so the variant switcher shows both options |
| Add narration | TTS for the selected subtitle clip (or the whole caption track); match audio clip timing to subtitle clip timing |
| Add BGM | Ask for mood/style if not given; generate, register, place on a new or existing audio track |
| Export video | Handled in the viewer — runs `@pneuma-craft/video` ExportEngine. **No agent involvement.** |

### Agent → viewer actions (HTTP)

When you need to *drive* the viewer (not just respond), POST to
`$PNEUMA_API/api/viewer/action`. Reach for this when the user asks
"show me the part where..." and you want the playhead to land
there before you explain, or when you've just registered an asset
and want it pre-selected for the next take.

```bash
# Seek the playhead to a specific second.
curl -s -X POST "$PNEUMA_API/api/viewer/action" \
  -H 'content-type: application/json' \
  -d '{"action":"playhead:seek","payload":{"time":4.2}}'

# Select a clip on the timeline (also seeks to its start).
curl -s -X POST "$PNEUMA_API/api/viewer/action" \
  -H 'content-type: application/json' \
  -d '{"action":"clip:select","payload":{"clipId":"clip-shot1-spark"}}'
```

Prefer `<viewer-locator>` cards when the user benefits from a
clickable hand-off. Use HTTP actions when *you* need the viewer
state to change before the next step (e.g. taking a screenshot via
`/api/native/screenshot`).

## When to reach for which reference

This SKILL.md is the map. Drill into the references when the
situation matches:

- `references/craft.md` — before any creative decision (open brief,
  generated clip feels close-but-wrong, picking music, deciding what
  to cut). It's principles, not procedures.
- `references/project-json.md` — before editing `project.json`. The
  user usually doesn't know the schema; you have to.
- `references/workflows.md` — when the user asks for a generation
  task. Pattern-match the closest end-to-end example, then adapt.
- `references/reference-directives.md` — when more than one visual
  intent needs to be pinned down for a seedance generation (multi-ref
  @-addressing, role vocabulary).
- `references/character-consistency.md` — when a specific human
  character appears, especially photorealistic, especially across
  multiple shots.
- `references/filter-retries.md` — when seedance rejects with a 422.
  Decision tree for the two distinct content-filter signatures.
- `references/asset-ids.md` — id naming and stability rules.

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

## Making creative decisions

Most of the work in ClipCraft is judgment, not mechanics. Before
writing a generation prompt, choosing shots, picking music, or
deciding what to cut, read `references/craft.md` — a field guide to
short-video craft. It's principles, not procedures. Reach for it when
the brief is open ("make something about X"), when a generated clip
feels close but wrong, or any time you're about to settle for a
generic answer. The rest of this document tells you *how* to produce;
`craft.md` tells you *what* is worth producing.

## Generation scripts

Six CLI scripts wrap the provider APIs. Call them via the Bash tool.

| Script | Purpose | Default model | Env var |
|---|---|---|---|
| `scripts/generate_image.mjs` | Text→image; edits via `--image-urls`/`--mask-url`; 1–4 images per call | OpenAI `gpt-image-2` (fal.ai); `--model gemini-3-pro` alternative | `FAL_KEY` (or `OPENROUTER_API_KEY` for gemini-3-pro) |
| `scripts/edit_image.mjs` | Modify a local image with optional highlighter annotation (multimodal reasoning) | Gemini 3.1 flash image via OpenRouter | `OPENROUTER_API_KEY` |
| `scripts/generate-video.mjs` | Text→video + image→video + reference-to-video | bytedance `seedance-2.0` (fallback: `veo3.1` via `--model veo3.1`) | `FAL_KEY` |
| `scripts/generate-tts.mjs` | Text→speech (expressive: inline `[laughing]` / `[sigh]` tags, 30 voices) | fal.ai `gemini-3.1-flash-tts` | `FAL_KEY` |
| `scripts/generate-bgm.mjs` | Text→background music | OpenRouter `google/lyria-3-pro-preview` | `OPENROUTER_API_KEY` |
| `scripts/make-character-sheet.mjs` | Photo → photo-body / sketch-head 16:9 character reference sheet (deterministic recovery shortcut for seedance's image-side filter; see `references/filter-retries.md`) | fal.ai `nano-banana-2/edit` | `FAL_KEY` |

`generate_image.mjs` and `edit_image.mjs` share their output shape —
a JSON object on stdout with `files`, `urls`, and `description`. They
take `--output-dir` + `--filename-prefix` (NOT `--output`). The prompt
is a **positional** argument, not a flag. The other four follow the
older flag-based convention where `--output <path>` is required and
stdout is just the output path.

All scripts read their API keys from `process.env` or from a `.env`
file in the skill directory.

### Why GPT-Image-2 matters for video work

The default image model was swapped from `nano-banana-2` to
`gpt-image-2` because the video-side pipeline gets dramatically more
controllable when the image step holds up:

- **First / last frames**. Seedance's `from-image` and first-last-frame
  video modes inherit the quality of their anchor images. GPT-Image-2
  holds a specific aesthetic, character, and composition across paired
  calls — so the two frames actually look like they belong to the same
  shot, and the interpolated video doesn't need to fight a stylistic
  mismatch at the seams.
- **Complex single-frame compositions** — foreground subject +
  environment + overlay text all in one image, rendered legibly. Title
  cards, end cards, lower thirds, memes with baked-in captions, data
  callouts over b-roll, diagrammed explainers — all possible as
  standalone assets now, rather than needing ffmpeg/post overlays.
- **Text rendering that actually reads**. "A sign that says X" or "a
  poster with the headline Y" comes back legible, not glyph soup. Use
  it for signage, lower-third strap text, brand marks, chyron-style
  overlays.
- **Multi-reference stitching via `--image-urls`**. Pass a character
  portrait plus an environment plate plus a style plate and
  GPT-Image-2 composes them coherently — a stronger control surface
  for prompting first frames and character sheets than free-text alone.
- **`--mask-url` for precise edits**. Paint a mask, change only that
  region. Useful for patching one shot's framing without redoing the
  whole pipeline.

Because the image step is this much stronger, be more ambitious with
the creative brief: text-heavy frames, multi-layer compositions, and
explicit character continuity are now viable in a single generation
rather than a multi-step workaround. See `references/craft.md` for
the principles that should drive those choices.

### Sizing images for video (critical)

When an image is destined to be a video **first or last frame** (for
`generate-video.mjs from-image` or the seedance first-last-frame
mode), its pixel dimensions must match the video output exactly. An
off-size anchor image gets letterboxed, cropped, or distorted by the
video model at the seams.

Pass `--image-size WxH` with the exact composition dimensions —
**do not** rely on `--aspect-ratio`, which routes to a fal.ai preset
(e.g. `landscape_16_9` lands on whatever size fal picks that day).

Composition-to-image-size cheat sheet for the common cases:

| Composition | Seedance output | Use `--image-size` |
|---|---|---|
| 9:16 portrait @ 720p | 720×1280 | `720x1280` |
| 9:16 portrait @ 1080p (veo3.1) | 1080×1920 | `1080x1920` |
| 16:9 landscape @ 720p | 1280×720 | `1280x720` |
| 16:9 landscape @ 1080p (veo3.1) | 1920×1080 | `1920x1080` |
| 1:1 square | depends on resolution | match composition.settings |

For standalone assets that never enter the video pipeline (wallpapers,
moodboards, illustrations the user just wants to look at),
`--aspect-ratio` is fine.

### Calling `generate_image.mjs`

```bash
# Text-to-image (positional prompt)
node .claude/skills/pneuma-clipcraft/scripts/generate_image.mjs \
  "A dimly lit kitchen at 3am, kettle steam catching the overhead bulb, shot on 35mm" \
  --aspect-ratio 9:16 --quality high \
  --output-dir assets/image --filename-prefix kitchen-3am

# Edit / reference — pass one or more image URLs. Switches the script
# to the GPT-Image-2 edit endpoint. Mask optional.
node .claude/skills/pneuma-clipcraft/scripts/generate_image.mjs \
  "Same character, now at a neon-lit ramen counter, back to camera" \
  --image-urls https://example.com/character-ref.png \
  --aspect-ratio 9:16 --quality high \
  --output-dir assets/image --filename-prefix kitchen-to-ramen

# Video first-frame — exact pixel dimensions to match the composition.
# Use --image-size WxH (not --aspect-ratio) so the anchor lands at the
# seedance output size with no letterbox/crop.
node .claude/skills/pneuma-clipcraft/scripts/generate_image.mjs \
  "Overhead shot of a desk at 3am: laptop closed, spiral notebook, cold coffee ring, warm tungsten lamp in upper right" \
  --image-size 720x1280 --quality high \
  --output-dir assets/image --filename-prefix opening-desk

# Multiple takes in one call — 1–4 per request.
node .claude/skills/pneuma-clipcraft/scripts/generate_image.mjs \
  "Four phone mockups of the app home screen, each with a different colorway" \
  --num-images 4 --aspect-ratio 9:16 \
  --output-dir assets/image --filename-prefix colorway-grid

# Gemini 3 Pro alternative — painterly / watercolor / less literal.
# Works with FAL_KEY or OPENROUTER_API_KEY.
node .claude/skills/pneuma-clipcraft/scripts/generate_image.mjs \
  "Watercolor of a city at dusk, soft bleeds, visible cold-press texture" \
  --model gemini-3-pro --aspect-ratio 16:9 \
  --output-dir assets/image --filename-prefix dusk-watercolor
```

`edit_image.mjs` is the sibling for *local file + highlighter-
annotation* edits. Use it when the source is a file on disk (not a
URL) and the user has circled a region they want changed — the
highlighter annotation is sent as a second image so the model knows
*which* part to modify.

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

**Seedance minimum duration is 4 seconds.** Any beat shorter than
that — a two-second reaction, a three-second punchline, a half-second
sting — must still be generated at `--duration 4` and then *trimmed
on the timeline* by setting `clip.outPoint` lower than the source
asset's full length. Plan beats in multiples of 4s when possible, and
treat "I need 2 seconds here" as "I need 4 seconds of which I'll use
the first 2". Never try to request `--duration 2`; the API will
reject it, not silently clamp.

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

### Audio layering — video tracks carry their own audio

Since @pneuma-craft/video 0.4.0, video tracks play their clips'
embedded audio alongside audio-track clips. A seedance clip on a
video track and a TTS clip on an audio track will both be audible
at once. This unlocks one-shot videos (generate once, get both
picture and sound), but it means you have to *plan* whether a
video's auto-audio should survive into the mix:

- **Picture only** (common for b-roll where you'll add narration
  or BGM separately): pass `--no-audio` when generating with
  `generate-video.mjs`, OR mute the video track after the fact
  via the eye-beside-speaker icon on the track label (dispatches
  `composition:toggle-track-mute`, writes `muted: true`).
- **Picture + ambient** (standalone clip, no competing audio):
  keep seedance's auto-audio.
- **Picture + dialogue from seedance**: don't mute, but skip a
  separate narration track for that segment.

`muted` and `visible` on a track are now **orthogonal** — `muted`
governs audio only, `visible` governs picture only. Hiding a video
track's picture means `visible: false`; silencing its audio means
`muted: true`.

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

- `references/craft.md` — the craft of short video: principles over procedures
- `references/project-json.md` — full `project.json` schema
- `references/workflows.md` — three end-to-end worked examples
- `references/asset-ids.md` — id naming and stability rules
- `references/reference-directives.md` — @-addressing, role vocabulary, worked multi-ref example
- `references/character-consistency.md` — photo-body + sketch-head sheet workflow for realistic human characters
- `references/filter-retries.md` — decision tree for the two seedance 422 signatures
- `scripts/` — the five bundled generator CLIs (including `make-character-sheet.mjs` recovery tool)

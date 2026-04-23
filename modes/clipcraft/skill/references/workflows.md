# ClipCraft Workflows

Pattern-match these when the user asks for a generation task. Every
flow follows the same shape: pick a stable asset id + output path,
call a bundled script, register the output in `project.json`
(`assets[]` + `provenance[]`), optionally place it on the timeline.
The viewer auto-reflects every edit. Schema in `project-json.md`;
id rules in `asset-ids.md`.

---

## Workflow 1 — Generate a new video clip

**User:** "Make a 4-second shot of a panda eating bamboo for the intro."

### Step 1: pick ids + paths

- Asset: `asset-panda-intro`
- Output: `assets/video/panda-intro.mp4`
- Clip: `clip-panda-intro`

### Step 2: run the generator

```bash
node .claude/skills/pneuma-clipcraft/scripts/generate-video.mjs \
  --prompt "close-up of a giant panda happily eating bamboo, warm natural light" \
  --duration 4 \
  --aspect-ratio 16:9 \
  --output assets/video/panda-intro.mp4
```

Default model: `bytedance/seedance-2.0/reference-to-video` called
with zero refs (= pure text-to-video). The script prints the output
path on stdout + exits 0 on success.

If the first call errors with
`{"type":"content_policy_violation","msg":"Output audio has sensitive content."}`,
retry the same command with `--no-audio` — see the SKILL.md
"Content-policy retry pattern" section.

### Step 3: register the asset

Edit `project.json` — add to `assets[]`:

```json
{
  "id": "asset-panda-intro",
  "type": "video",
  "uri": "assets/video/panda-intro.mp4",
  "name": "Panda intro",
  "metadata": { "width": 1920, "height": 1080, "duration": 4, "fps": 30, "codec": "h264" },
  "createdAt": 1712934000000,
  "status": "ready"
}
```

Only **physical** properties go in `metadata`; prompt + model belong
on the provenance edge.

### Step 4: record provenance

Add to `provenance[]`:

```json
{
  "toAssetId": "asset-panda-intro",
  "fromAssetId": null,
  "operation": {
    "type": "generate",
    "actor": "agent",
    "agentId": "clipcraft-videogen",
    "timestamp": 1712934000000,
    "label": "intro shot",
    "params": {
      "model": "bytedance/seedance-2.0/reference-to-video",
      "prompt": "close-up of a giant panda happily eating bamboo",
      "duration": "4",
      "aspect_ratio": "16:9"
    }
  }
}
```

`fromAssetId: null` because the asset came from a text prompt alone.
Use the same `timestamp` as `createdAt`.

### Step 5: place on the timeline

Pick the target video track (create one if the composition has
none), append a clip to its `clips[]`:

```json
{ "id": "clip-panda-intro", "assetId": "asset-panda-intro",
  "startTime": 0, "duration": 4, "inPoint": 0, "outPoint": 4 }
```

`startTime` is timeline position; `inPoint`/`outPoint` index into
the source asset. For a full-length clip, `inPoint = 0` and
`outPoint = asset.metadata.duration`. Save the file — the viewer
re-hydrates and renders the clip immediately.

---

## Workflow 2 — Regenerate a variant

**User:** "Try another take of the sad panda, make it droop harder."

The seed project has this exact pair: `asset-panda-sad-v1` →
`asset-panda-sad-v2`, linked via a `derive` provenance edge.
Re-creating that pattern:

### Step 1: pick a sibling id

Given existing `asset-panda-sad-v1`, create `asset-panda-sad-v2`.
`-v1` / `-v2` is the conventional suffix; any semantic suffix
(`-nighttime`, `-close`) works too.

### Step 2: run the generator with the tweaked prompt

For a variant that preserves the look of the source, use the
`from-image` subcommand with the source asset as the start frame.
That routes through `bytedance/seedance-2.0/image-to-video`:

```bash
node .claude/skills/pneuma-clipcraft/scripts/generate-video.mjs from-image \
  --prompt "Same panda from behind, emphasize a slower exaggerated head droop; shoulders sag visibly; keep camera + lighting identical" \
  --image-url assets/clips/panda-sad-v1.mp4 \
  --duration 4 \
  --aspect-ratio 16:9 \
  --no-audio \
  --output assets/clips/panda-sad-v2.mp4
```

`--no-audio` is a defensive default for variant regens because
character-focused prompts hit ByteDance's audio content policy
more often than environment prompts.

### Step 3: register + link via provenance

Add the new asset to `assets[]` as in Workflow 1. Then add a
provenance edge that **points at the source asset**:

```json
{
  "toAssetId": "asset-panda-sad-v2",
  "fromAssetId": "asset-panda-sad-v1",
  "operation": {
    "type": "derive",
    "actor": "agent",
    "agentId": "clipcraft-videogen",
    "timestamp": 1712930200000,
    "label": "regenerate with stronger droop",
    "params": {
      "model": "bytedance/seedance-2.0/image-to-video",
      "prompt": "Same panda from behind, emphasize head droop",
      "seed": 11
    }
  }
}
```

Two things make this a variant, not a fresh generation: `fromAssetId`
points at v1, and `operation.type` is `"derive"`. The variant
switcher picks both siblings up from the provenance DAG.

### Step 4: optionally rebind the clip

If the user wants v2 to become the active take, update the existing
clip's `assetId` in place (keep `id`, `startTime`, `duration`, etc.):

```json
{
  "id": "clip-panda-sad",
  "assetId": "asset-panda-sad-v2",
  "startTime": 0, "duration": 4, "inPoint": 0, "outPoint": 4
}
```

Otherwise leave v1 in the clip and let the variant switcher show
both options. Both v1 and v2 still live in `assets[]`.

---

## Workflow 3 — Add narration for subtitles

**User:** "Narrate the caption track."

The seed project has a subtitle track (`track-subtitle-1`) with
clips like `clip-caption-1` / `clip-caption-2`, each carrying the
caption text in the clip-level `text` field. Goal: produce a TTS
audio clip on an audio track that lines up with each subtitle clip.

### Step 1: find the subtitle track + clips

Read `project.json`, locate the track with `type: "subtitle"`, and
iterate its `clips[]`. Each clip exposes `id` (use as audio id
suffix), `text` (feed to TTS), and `startTime` + `duration` (copy
over to the audio clip).

### Step 2: run TTS for each caption

For `clip-caption-1` with text `"别跟我说话！"`:

```bash
node .claude/skills/pneuma-clipcraft/scripts/generate-tts.mjs \
  --text "别跟我说话！" \
  --voice Kore \
  --output assets/audio/narration-caption-1.mp3
```

Repeat per caption. Keep the output filename tied to the caption
clip's id so the provenance is easy to trace. Output format is
inferred from the extension — `.mp3` (recommended), `.wav`, or
`.ogg`/`.opus`. Use inline `[sigh]` / `[laughing]` / `[whispering]`
tags directly in `--text` for expression, and `--style "..."` for
whole-utterance direction ("warm conversational", "dramatic newscast").

### Step 3: register each audio asset + edge

For the first caption, add to `assets[]`:

```json
{
  "id": "asset-narration-caption-1",
  "type": "audio",
  "uri": "assets/audio/narration-caption-1.mp3",
  "name": "Narration · caption 1",
  "metadata": { "duration": 1.8, "sampleRate": 24000, "channels": 1, "codec": "mp3" },
  "createdAt": 1712934500000,
  "status": "ready"
}
```

And to `provenance[]`:

```json
{
  "toAssetId": "asset-narration-caption-1",
  "fromAssetId": null,
  "operation": {
    "type": "generate",
    "actor": "agent",
    "agentId": "clipcraft-tts",
    "timestamp": 1712934500000,
    "params": { "model": "fal-ai/gemini-3.1-flash-tts", "prompt": "别跟我说话！", "voice": "Kore" }
  }
}
```

### Step 4: add a matching audio clip

Create a dedicated narration track (or reuse an existing one),
then append a clip whose `startTime` and `duration` mirror the
subtitle clip:

```json
{ "id": "clip-narration-caption-1", "assetId": "asset-narration-caption-1",
  "startTime": 0.5, "duration": 3.5, "inPoint": 0, "outPoint": 1.8 }
```

Notes:

- `startTime` + `duration` come from the subtitle clip so the
  voice-over lines up on screen.
- `outPoint` is the actual TTS length (1.8s here), which can be
  shorter than the subtitle duration (3.5s). The clip pads with
  silence until `startTime + duration`.
- Give the narration track its own unique id
  (`track-audio-narration`) — don't reuse `track-audio-bgm`.

Repeat for every subtitle clip. The viewer shows a new waveform on
the narration track as each asset lands.

---

## Workflow 4 — Filesystem discovery

An asset lives on two axes: the file on disk under `assets/`, and the
`project.json` registry entry (`assets[]` + provenance). The asset
panel scans both and shows three combinations, so the user can
reconcile drift in either direction:

- **Registered** — present in `project.json.assets[]` AND on disk.
  The normal state; nothing special to do.
- **Orphan** — a file exists under `assets/` but no `assets[]` entry
  references it. Shows with a subtle "N not imported" hint. These are
  usually files you generated but didn't register yet, or leftovers
  from prior experiments.
- **Missing** — an `assets[]` entry points at a `uri` that no longer
  resolves on disk. Shows with a warning badge. The file was moved,
  deleted, or never finished generating.

Users can bulk-import orphans or bulk-trash unwanted files from an
in-app asset manager; trashed files disappear from both the fs
listing and (if they had been registered) from `project.json`. You
don't need to call a delete tool — that path is user-driven.

### Two paths for generated files

When a generator script finishes, you have two options for how to
land the output in the project:

**Full registration (preferred).** Run the generator, then edit
`project.json` in the same turn to add the `assets[]` entry and
matching `provenance[]` edge. The asset shows up as a normal
registered entry immediately, timeline-ready, and the user doesn't
need to take a separate action. Follow the exact shape from
Workflow 1 (`assets[]` fields + `provenance[]` with
`operation.type: "generate"` or `"derive"`). This is the right
default for anything the user asked for as a deliverable.

```bash
# 1. Run the generator.
node .claude/skills/pneuma-clipcraft/scripts/generate-image.mjs \
  --prompt "a sleepy panda on a moss log" \
  --output assets/image/panda-sleepy.jpg

# 2. In the same turn, Edit project.json:
#    - Append { id: "asset-panda-sleepy", type: "image", uri: "...",
#      metadata: {...}, createdAt, status: "ready" } to assets[].
#    - Append the matching { toAssetId, fromAssetId: null,
#      operation: { type: "generate", ... } } to provenance[].
```

**File-only.** Run the generator and stop — don't touch
`project.json`. The file surfaces as an orphan under the "N not
imported" hint, and the user decides later whether to import it via
the asset manager or trash it. Reach for this path only when the
user explicitly framed the request as a throwaway experiment
("just try something", "quick sanity check"). It exists so you don't
churn `project.json` with variants the user may discard; don't use
it as a shortcut to avoid writing provenance.

When in doubt, prefer full registration — an extra registered asset
is cheap to trash, but a generated file the user forgot about is
easy to miss.

### Reacting to a "missing" asset in context

When a generation request's viewer context flags an existing asset
as missing (file absent, registry entry still present), don't
silently regenerate over the gap. Ask the user whether to
regenerate (re-fill the same id), unregister (drop the `assets[]`
entry and any dangling `provenance[]` edges), or locate the
original file (they may have moved it). The missing state often
means the user deliberately deleted bytes they didn't like — a
silent regen would undo that decision and burn provider credits.

If the missing asset was the source of a variant chain, losing it
cascades: variants derived from it still reference
`fromAssetId: asset-...` in provenance. Unregistering the root is
fine as long as you also clean up orphaned edges. See
`filter-retries.md` for the related case where seedance rejects a
regen; the recovery path for a missing character reference is the
same character-sheet flow described there and in
`character-consistency.md`.

---

## Workflow 5 — Structured generation notifications from the viewer

The viewer can send you a **structured generation request** when the
user fills out an in-app form in the dive panel (variant generation)
or the asset panel (fresh creation). These arrive as system messages
tagged with either `[clipcraft:create-asset]` or
`[clipcraft:generate-variant]` and carry a fenced JSON block with
exact parameters.

**Why they exist:** the viewer captures user intent in a rich form
(prompt, type, params, source asset) and hands you a single,
unambiguous spec. Treat the JSON as the source of truth and follow
its `script` + `script_args` + `provenance_hint` fields literally.

### Shape

Each notification message looks like:

```
[clipcraft:create-asset] Create a new asset — image — "a panda eating bamboo"

```json
{
  "mode": "create",
  "kind": "image",
  "prompt": "a panda eating bamboo",
  "params": { "aspect_ratio": "16:9", "width": 1920, "height": 1080, "style": null },
  "script": "scripts/generate-image.mjs",
  "script_args": { "--prompt": "a panda eating bamboo", "--width": 1920, "--height": 1080 },
  "provenance_hint": {
    "operation_type": "generate",
    "from_asset_id": null,
    "agent_id": "clipcraft-imagegen",
    "label": "fal-ai/nano-banana-2",
    "model": "fal-ai/nano-banana-2"
  }
}
```

Handling:
1. Parse the JSON block above.
2. Pick a semantic asset id...
```

Variant requests include a `source` field:

```json
{
  "mode": "variant",
  "kind": "video",
  "source": { "asset_id": "asset-panda-sad-v1", "asset_name": "Panda Sad · v1", "model": "fal-ai/veo3.1" },
  "prompt": "Same panda from behind, slower droop",
  "params": { "duration": "4s", "aspect_ratio": "16:9" },
  "script": "scripts/generate-video.mjs",
  "script_args": { "--prompt": "...", "--duration": "4s", "--aspect-ratio": "16:9" },
  "provenance_hint": {
    "operation_type": "derive",
    "from_asset_id": "asset-panda-sad-v1",
    "agent_id": "clipcraft-videogen",
    "label": "fal-ai/veo3.1",
    "model": "fal-ai/veo3.1"
  }
}
```

### Handler (identical for both tags)

1. **Parse** the JSON block. Don't reason about the human summary line
   — it's for the chat log only.
2. **Pick a semantic asset id** — look at nearby assets in `project.json`
   and pick something like `asset-forest-sunset` or `asset-panda-tea`.
   Never use a random UUID.
3. **Pick an output path** under the matching `assets/{kind}/` dir
   (`assets/image/*.jpg`, `assets/video/*.mp4`, `assets/audio/*.{wav,mp3}`).
4. **Run the script** — prepend `node .claude/skills/pneuma-clipcraft/`
   to the `script` field, expand `script_args` into `--flag value`
   pairs, and append `--output <path>`. The script prints the output
   path on stdout + exits 0 on success.
5. **Register the asset** — add to `assets[]` with the chosen id,
   `type: kind`, `uri: <output-path>`, `name: <asset-name-or-prompt-preview>`,
   `metadata: { /* physical props only */ }`, `createdAt: Date.now()`,
   `status: "ready"`.
6. **Add the provenance edge** — use `provenance_hint` verbatim:
   - `operation.type` = `provenance_hint.operation_type` (must not be
     changed; "generate" for create mode, "derive" for variant mode)
   - `fromAssetId` = `provenance_hint.from_asset_id` (null for create,
     the source asset id for variant — never swap them)
   - `operation.agentId` = `provenance_hint.agent_id`
   - `operation.label` = `provenance_hint.label`
   - `operation.params.model` = `provenance_hint.model`
   - `operation.params.prompt` = the top-level `prompt`
   - Copy other fields from `params` as useful (aspect_ratio, duration, etc.)
   - `operation.timestamp` = same as the asset's `createdAt`
7. **Do NOT add a clip to any track.** The viewer gives the user a
   separate opportunity to place the new asset — your job ends at
   `assets[]` + `provenance[]`.
8. **Save the file.** The viewer auto-re-hydrates and the new asset
   shows up in the asset panel or as a sibling in the dive panel.

### Why the handler is identical

The only real difference between create and variant is
`provenance_hint.operation_type` + `from_asset_id`, and those are
pre-filled in the payload so you don't need a branch. The viewer is
the one that knows whether this is a fresh root or a sibling
derivation; the agent just follows the hint.

### What you should NOT do

- Do not compose a clip-add operation — leave timeline placement to
  the user.
- Do not modify the source asset (for variants) — it stays in the
  registry so the variant switcher can show both options.
- Do not reinterpret the `prompt` — pass it to the script unchanged
  (including non-ASCII, punctuation, emoji). The scripts handle
  escaping correctly.
- Do not ignore `script_args` — if you override one, the viewer's
  intent might not be faithfully represented.
- Do not print the JSON back to the user in your response. They
  already filled the form; they know what they asked for. Give them a
  short confirmation ("Generating the panda tea variant — 30-60s for
  veo3.1.") and act.

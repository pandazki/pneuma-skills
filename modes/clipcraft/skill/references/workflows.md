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
  --duration 4s \
  --aspect-ratio 16:9 \
  --output assets/video/panda-intro.mp4
```

The script prints the output path on stdout + exits 0 on success.

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
      "model": "fal-ai/veo3.1",
      "prompt": "close-up of a giant panda happily eating bamboo",
      "duration": "4s",
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

```bash
node .claude/skills/pneuma-clipcraft/scripts/generate-video.mjs \
  --prompt "Same panda from behind, emphasize a slower exaggerated head droop; shoulders sag visibly; keep camera + lighting identical" \
  --duration 4s \
  --aspect-ratio 16:9 \
  --output assets/clips/panda-sad-v2.mp4
```

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
      "model": "fal-ai/veo3.1",
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
  --output assets/audio/narration-caption-1.wav
```

Repeat per caption. Keep the output filename tied to the caption
clip's id so the provenance is easy to trace.

### Step 3: register each audio asset + edge

For the first caption, add to `assets[]`:

```json
{
  "id": "asset-narration-caption-1",
  "type": "audio",
  "uri": "assets/audio/narration-caption-1.wav",
  "name": "Narration · caption 1",
  "metadata": { "duration": 1.8, "sampleRate": 24000, "channels": 1, "codec": "pcm16" },
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
    "params": { "model": "openai/gpt-audio", "prompt": "别跟我说话！", "voice": "alloy" }
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

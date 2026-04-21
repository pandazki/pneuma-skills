# project.json Schema Reference

> Canonical types: `modes/clipcraft/persistence.ts` (`ProjectFile`,
> `ProjectAsset`, `ProjectClip`, `ProjectTrack`,
> `ProjectProvenanceEdge`). When this doc and the types disagree, the
> types win.

`project.json` is a projection of the in-memory craft store. Edits you
make with Write/Edit are re-hydrated back into the store by the
runtime — no reload or refresh signal is needed.

## Minimum shape

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

## Top-level fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `$schema` | `"pneuma-craft/project/v1"` | yes | Literal. Never edit. |
| `title` | `string` | yes | Out-of-band — see "Title handling". |
| `composition` | object | yes | `settings` + `tracks[]` + `transitions[]`. |
| `assets` | `ProjectAsset[]` | yes | May be empty. |
| `provenance` | `ProjectProvenanceEdge[]` | yes | May be empty. |
| `scenes` | `ProjectScene[]` | no | Mode-local grouping; not part of the craft store. |
| `captionStyle` | object | no | Mode-local subtitle styling. |

`composition.settings`: `{ width, height, fps, aspectRatio, sampleRate? }`.

## assets[]

```json
{
  "id": "asset-panda-sad-v1",
  "type": "video",
  "uri": "assets/clips/panda-sad-v1.mp4",
  "name": "Panda Sad · v1",
  "metadata": { "width": 640, "height": 360, "duration": 4, "fps": 24, "codec": "h264" },
  "createdAt": 1712930000000,
  "tags": ["panda", "sad"],
  "status": "ready"
}
```

| Field | Notes |
|---|---|
| `id` | Stable semantic id. See `asset-ids.md`. |
| `type` | `"video" \| "image" \| "audio" \| "text"`. |
| `uri` | Workspace-relative path. **Empty string is legal** for `pending` / `generating` assets; set it when the file lands. |
| `name` | Human-readable label. |
| `metadata` | **Physical media properties only.** Recognized keys: `size`, `width`, `height`, `duration` (seconds), `fps`, `codec`, `sampleRate`, `channels`. |
| `createdAt` | Unix ms timestamp. Stable across round-trips. |
| `tags?` | Free-form strings. |
| `status?` | `"pending" \| "generating" \| "ready" \| "failed"`. Absent means `"ready"`. |

### Metadata vs provenance.params — the split rule

Single most common mistake. Keep them separated:

| Goes in `asset.metadata` | Goes in `operation.params` |
|---|---|
| Physical file properties (`width`, `height`, `duration`, `fps`, `codec`, `sampleRate`, `channels`, `size`) | How the asset was produced (`model`, `prompt`, `seed`, `durationMs`, `costUsd`, `providerJobId`, `aspect_ratio`) |

If you're about to write a prompt into `metadata`, stop — it belongs
on the provenance edge.

## provenance[]

Each edge captures "how was this asset created". For AIGC workflows
this is the most semantically important part of the file.

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

- `toAssetId` — the asset this edge creates.
- `fromAssetId` — source asset id, or `null` if generated from
  nothing. Both are first-class; don't force one into the other.
- `operation.type` — `"upload" | "import" | "generate" | "derive" | "select" | "composite"`.
  For AIGC you almost always want `"generate"` (from a prompt) or
  `"derive"` (edit, regen, upscale, extract from another asset).
- `operation.actor` — `"agent"` for agent-driven work, `"human"` for
  uploads / variant picks.

`operation.params` is a free-form `Record<string, unknown>`.
Convention keys — use when they apply:

| Key | Meaning |
|---|---|
| `model` | Provider model id (`"fal-ai/veo3.1"`, `"nano-banana-2"`, `"fal-ai/gemini-3.1-flash-tts"`) |
| `prompt` | Text prompt |
| `seed` | Integer seed |
| `durationMs` | Wall-clock generator time (ms) |
| `costUsd` | Provider cost (USD) |
| `providerJobId` | Opaque provider job id |
| `aspect_ratio` | `"16:9"`, `"9:16"` etc. |

### `fromAssetId: null` vs a real id

- `null` = "from nothing" (text→image, text→video, text→audio).
- real id = "derived from that asset" (edit, upscale, regen).

`null` is **not** "no lineage known" — if the asset came from a
prompt alone, `null` is correct.

## composition.tracks[] + tracks[].clips[]

```json
{
  "id": "track-video-1",
  "type": "video",
  "name": "Main",
  "muted": false, "volume": 1, "locked": false, "visible": true,
  "clips": [
    {
      "id": "clip-panda-sad",
      "assetId": "asset-panda-sad-v2",
      "startTime": 0, "duration": 4, "inPoint": 0, "outPoint": 4
    }
  ]
}
```

- Track `type` — `"video" | "audio" | "subtitle"`.
- `muted`, `volume`, `locked`, `visible` are all required.
- Clip required fields: `id`, `assetId`, `startTime`, `duration`,
  `inPoint`, `outPoint`. Optional: `text` (subtitles), `volume`,
  `fadeIn`, `fadeOut`.
- **Time is in seconds**, not frames. `fps` only matters for
  playback/export.
- `inPoint` / `outPoint` are measured into the source asset;
  `outPoint - inPoint` equals `duration` for a non-speed-ramped clip.
- `composition.transitions` exists in the schema but is currently
  unused — leave as `[]` unless adding one explicitly.
- Subtitle clips typically share one text-holder asset (e.g.
  `asset-caption-stub`) and carry the actual caption in the clip's
  `text` field. The seed project uses this pattern.

## Title handling

`title` is a top-level string but is **not** part of the craft domain
model — the store has no concept of a project title. The viewer
keeps it in a side-channel ref and threads it through
hydrate/serialize, so you can edit it freely and it round-trips.

## Id stability — short version

- Asset, track, and clip ids are all preserved across a round-trip.
- Asset ids are globally unique in the registry.
- Clip ids are globally unique across **all** tracks in the
  composition (craft-timeline rejects duplicates at hydration).
- Track ids are globally unique.

Full rules in `asset-ids.md`.

## Common gotchas

- **Never edit `$schema`.** Always `"pneuma-craft/project/v1"`.
- **`createdAt` must be stable.** When editing an existing asset,
  keep its `createdAt` unchanged. Hydration relies on it.
- **Empty `uri` is legal** for `pending` / `generating` assets. Set
  it when the generator finishes.
- **`fromAssetId: null` means "from nothing",** not "no lineage".
- **`metadata` is physical only.** Prompts, models, seeds, costs all
  belong on the provenance edge.
- **Time is seconds.** The number `4` in `duration` is four seconds.
- **Clip ids collide across tracks.** Use track-prefixed names like
  `clip-video-intro` / `clip-caption-intro`.

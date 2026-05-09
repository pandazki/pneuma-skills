# Storyboard Workflow — progressive-fidelity video planning

ClipCraft's planning layer is the `previewFrames` array on each video track. It lets you stage three layers of fidelity on the timeline before any expensive video generation runs:

1. **Sketch layer** — line-art images placed across the timeline. Cheap (`gpt-image-2 --style sketch --quality low` ≈ $0.01 per image). Defines vibe, blocking, pacing.
2. **Anchor layer** — photoreal first/last frames at planned generation boundaries (`gpt-image-2 --style photo --quality high`). Replaces specific sketch positions. Used as seedance from-image / end-image-url.
3. **Real clip layer** — `Clip` on the same track from a seedance run. Replaces the planning layer in its time range via the upstream auto-fallback rule (clip wins per half-open interval).

The user reviews at every layer transition. Your job is to surface the right artifact at the right time and ask "ready to commit?" before each escalation.

## When to reach for this

Use storyboard workflow when the request implies a multi-beat segment: "make me a 15-second latte art musical video", "a 30s opening with three cuts", anything that's clearly more than a single moment.

Skip it for trivial single-shot requests: "make me a 4-second clip of a panda rolling over" — just generate.

If you're unsure: ask the user "do you want to plan this out first with sketches, or go straight to generation?"

## Working with `previewFrames`

A preview frame is `{ id, trackId, time, assetId }` — a track-level entry that shows a planning visual at a single time point until a real clip overrides. Time is in seconds (always quantize to milliseconds: `Math.round(t * 1000) / 1000`). The `assetId` must point at a `type: 'image'` asset.

The four upstream commands you'll dispatch by editing `project.json` (the on-disk shape — round-trip into `track.previewFrames`):

- `composition:add-preview-frame { trackId, time, assetId, id? }` — place a new entry. Rejects on `(trackId, time)` collision.
- `composition:remove-preview-frame { previewFrameId }` — by id.
- `composition:move-preview-frame { previewFrameId, time, trackId? }` — atomic move; preserves `id` so locator cards survive. Rejects collision at destination.
- `composition:rebind-preview-frame { previewFrameId, assetId }` — swap the referenced image without changing placement.

For "ensure asset X is the preview at this slot" (the typical upgrade flow), use the `buildSetPreviewFrameCommand` helper from `@pneuma-craft/timeline` — returns an `add` if empty, a `rebind` if occupied (preserves id), or `null` if already correct.

In practice: edit `project.json` directly. Add entries to `assets[]`, `provenance[]`, and the relevant `track.previewFrames[]` array. The viewer auto-rehydrates.

## Stage 1 — sketch the whole timeline

Decide N panels and their times. Density rule of thumb:

- ~1 panel per 1s for fast cuts / dialogue
- ~1 panel per 2-3s for action sequences
- ~1 panel per 4s+ for long held shots / slow zooms

For each panel:

```bash
node .claude/skills/pneuma-clipcraft/scripts/generate_image.mjs \
  "<panel description>" \
  --style sketch \
  --aspect-ratio 16:9 \
  --output-dir assets/sketches \
  --filename-prefix panel-<N>
```

Then for each output file, register the asset and add the preview frame in `project.json`. **Important — set `metadata.fidelity = "sketch"`** so the timeline row renders with the sketch visual treatment (dashed border, 70% opacity).

```jsonc
// In project.json:
"assets": [
  {
    "id": "asset-sketch-01",
    "type": "image",
    "uri": "assets/sketches/panel-01-1.png",
    "name": "Panel 01 sketch",
    "metadata": { "fidelity": "sketch", "width": 1280, "height": 720 },
    "tags": [],
    "status": "ready",
    "createdAt": 1714200000000
  }
],
"provenance": [
  {
    "toAssetId": "asset-sketch-01",
    "fromAssetId": null,
    "operation": {
      "type": "generate",
      "actor": "agent",
      "agentId": "claude-clipcraft",
      "timestamp": 1714200000000,
      "params": { "model": "gpt-image-2", "style": "sketch", "prompt": "..." }
    }
  }
],
"composition": {
  "tracks": [
    {
      "id": "track-1",
      "type": "video",
      "name": "Main",
      "clips": [],
      "previewFrames": [
        { "id": "pf-01", "trackId": "track-1", "time": 0, "assetId": "asset-sketch-01" }
      ]
    }
  ]
}
```

After all sketches are placed, **emit a `<viewer-locator>` for each notable panel** (don't spam — one per beat the user might want to verify). Then prompt for stage-2 review (next section).

## Stage 2 — review with a draft export

Suggest: "我先做个草样片让你看看节奏，再决定哪几段做真视频。"

User clicks the **Export draft** toolbar button (or you tell them about the `export-draft` command). The resulting MP4 bakes in the sketches as visible frames at their placement times. The user scrubs the file or watches it.

If the user wants changes:

- "make panel 3 faster" → remove the entry at panel 3's time, place new sketches at sub-second timings
- "different vibe overall" → regenerate sketches with a different prompt style; rebind via `buildSetPreviewFrameCommand` (preserves id, locator cards survive)
- "this beat doesn't fit" → `remove-preview-frame { previewFrameId }`

When the user says "this looks right", proceed to stage 3.

## Stage 3 — upgrade to anchors at gen boundaries

Decide the gen segments. Each seedance segment needs from-image (and optionally end-image-url) at exact composition pixel dimensions. Sketch quality is too low to use directly.

For each gen boundary (typically at the start of each future clip — and optionally at the end for first-last-frame mode), generate a photoreal anchor:

```bash
node .claude/skills/pneuma-clipcraft/scripts/generate_image.mjs \
  "<the same panel description, possibly more detailed>" \
  --image-size 1280x720 \
  --quality high \
  --output-dir assets/anchors \
  --filename-prefix anchor-<segment-N>
```

Register the asset with `metadata.fidelity = "anchor"`. Then upgrade the slot:

```typescript
// Conceptually (you'll edit project.json directly):
import { buildSetPreviewFrameCommand } from "@pneuma-craft/timeline";
const cmd = buildSetPreviewFrameCommand(composition, "track-1", 4.0, "asset-anchor-01");
if (cmd) await dispatch(cmd);  // returns rebind-preview-frame, preserving id
```

In `project.json`: find the track's `previewFrames` entry at `time: 4.0`, change its `assetId` to the new anchor's id, **keep the `id` unchanged**. Add the new asset to `assets[]` with `metadata.fidelity: "anchor"`. Add a provenance edge — the anchor's `fromAssetId` is the sketch (so the lineage shows sketch → anchor).

The slot's id stays stable across the upgrade. Locator cards pointing at this preview frame keep working.

## Stage 4 — second review, then generate

Suggest: "我再做个 draft，你看看 anchor 接得上不上。"

Second draft export → user reviews. If anchors look right, run seedance:

```bash
# For each segment:
node .claude/skills/pneuma-clipcraft/scripts/generate-video.mjs from-image \
  --prompt "<segment narration>" \
  --image-url assets/anchors/anchor-segment-01.png \
  --end-image-url assets/anchors/anchor-segment-02.png \
  --duration 4 \
  --aspect-ratio 16:9 \
  --output assets/clips/segment-01.mp4
```

Register the resulting video asset (with `metadata.fidelity` either absent or `"final"`). Add a `Clip` to the same video track at the segment's start time:

```jsonc
"clips": [
  { "id": "clip-segment-01", "assetId": "asset-clip-01",
    "trackId": "track-1", "startTime": 0, "duration": 4,
    "inPoint": 0, "outPoint": 4 }
]
```

The preview frames in the clip's interval auto-fall-go (clip wins per the upstream resolveFrame rule — half-open `[start, end)`). The preview frame data **stays in `track.previewFrames`** for audit / undo / revisit. The strip in the timeline row only shows preview thumbnails in regions not covered by clips.

## Stage 5 — polish and finalize

The user may not care about the planning layer once final clips land. By default, leave the preview frames in place. Only remove them if the user explicitly says "clean up the sketches".

If they do, dispatch `composition:remove-preview-frame { previewFrameId }` for each, in any order. The undo will be one step per frame; warn the user before bulk-removing more than 5 at a time ("撤销会一格一格回，要彻底清空建议直接让我重新生成").

## Path B — single long-form generation with internal beats

When the user wants a single 15s continuous shot with multiple internal beats (the Kōda latte art recipe), don't split into N seedance calls. Place anchors at the visible "beat moments" but at gen time issue **one** seedance call:

```bash
node .claude/skills/pneuma-clipcraft/scripts/generate-video.mjs from-image \
  --prompt "<full 15s narration with embedded beat directions: 'first lift the milk pitcher, push in close, then [beat 2: tiny waves dancing in], [beat 3: foam goes round]…'>" \
  --image-url assets/anchors/anchor-start.png \
  --end-image-url assets/anchors/anchor-end.png \
  --duration 15 \
  --aspect-ratio 16:9 \
  --output assets/clips/full-shot.mp4
```

Result is a single 15s clip; it auto-fall-goes all preview frames in `[0, 15)`. The interleaved beat anchors stay in the data as audit trail (and as backup if the user wants to redo with a different gen strategy).

## Density and pacing recipes

| Total length | Cuts / beats | Pattern |
|---|---|---|
| 4-8s | 1 (single shot) | No storyboard needed; just generate |
| 10-15s | 1 (long held shot) | No storyboard needed |
| 10-15s | 3-5 (musical / dialogue) | Path B: single gen, N internal beats, ~3 anchors total |
| 30s | 2-3 cuts | Path A: 2-3 separate gens, 3-4 anchors at boundaries, 5-8 sketches between |
| 60s | 3-5 cuts | Path A: 3-5 separate gens, 4-6 anchors, 10-15 sketches |

## Move semantics — re-pacing without losing identity

If the user says "shift everything 0.5s later", iterate from the *last* preview frame to the first (high time first). For each, dispatch:

```typescript
{ type: "composition:move-preview-frame", previewFrameId: pf.id, time: pf.time + 0.5 }
```

Reverse iteration order avoids destination collisions because each move's destination is currently empty. If a destination is somehow occupied (shouldn't happen with reverse-iteration but defensive: agent dispatched something in parallel), `move-preview-frame` will reject; remove the destination first or move it elsewhere first.

`buildSetPreviewFrameCommand` is for *upserts at a slot*, not for moves — don't reach for it during repositioning.

## Bulk-undo expectation

Placing 8 sketches is 8 undo steps, not one. Warn the user before satellite operations: "I'll plant 8 sketches now; if you want to wipe them, ask me to clear them rather than mash undo." If they want to clear: dispatch 8 `remove-preview-frame` calls.

## Locator cards

When you've placed sketches or anchors, emit one locator card per *distinct thing you want the user to verify*. Don't emit one per frame — emit one per "look at this beat":

```html
<viewer-locator data='{"previewFrameId":"pf-04"}'>panel 4 — opening close-up</viewer-locator>
```

Click flashes the strip thumbnail and selects the asset. Use sparingly. (See SKILL.md "Locator cards" section for the full list of data shapes.)

## Pitfalls

- **Atomic edits to `project.json`** — when upgrading a sketch slot to an anchor, write the new asset entry, the provenance edge, AND the rebound `previewFrame.assetId` in **a single Write**. If you write the previewFrame change first (referencing an asset not yet in `assets[]`), the viewer hydrates, the I3 invariant fires (asset must exist + be type=image), the `composition:add-preview-frame` envelope is rejected, that previewFrame never lands in craft state, and the next auto-serialize cycle drops it from disk. Same caution applies to clips referencing not-yet-registered video assets. **Single-write rule**: any edit that introduces a new cross-reference must include both ends in the same Write.
- **Provenance must carry the full `prompt` + provider + endpoint + every ref id** — the inspector and dive view read directly from `operation.params`. If you only put `model` and `subcommand`, the user clicks a clip and sees a useless one-liner. Required keys per generation: `model`, `provider`, `endpoint`, `prompt` (full text, not truncated), `subcommand` (when applicable), `imageRefs` / `videoRefs` / `audioRefs` (asset id lists), `aspectRatio`, `resolution`, plus any model-specific knobs (`duration`, `seed`, `noAudio`, `style`). Also set `fromAssetId` to the most semantically-important parent asset (the anchor for a seedance clip; the source sketch for an anchor) — this drives the dive lineage view. **Don't compress `params` to "save space"** — provenance is the audit trail and the variant-generation foundation; without the prompt, "try another take" can't recover what made the original.
- **Forgetting `metadata.fidelity`** — without it, the timeline row renders sketches as anchors. Always set the field at registration time.
- **Floating-point time** — always `Math.round(t * 1000) / 1000` before passing to commands. Otherwise, equality checks (e.g. for `(trackId, time)` invariant collisions) misbehave.
- **Adding a preview frame at exact `time === composition.duration`** — engine pauses at duration, so the last preview won't render. Add a sentinel preview slightly after to keep the visual tail visible during scrub.
- **Anchor ≠ a video first frame in disguise** — the anchor *is* the seedance from-image. Generate at the exact composition pixel dimensions (`--image-size WxH`), not via `--aspect-ratio` which routes through fal.ai presets.
- **Sketch fidelity in the final cut** — the user occasionally says "I want to keep the sketch in the final video". That's a real `Clip` of an image asset, not a preview frame. Add it via `composition:add-clip { assetId: sketchAssetId, ... }`. Preview frames don't show up in final exports by default.
- **Skipping the draft export checkpoint** — don't run seedance without first showing a draft. Seedance is the most expensive step; the user should approve the rough video file before money flows.

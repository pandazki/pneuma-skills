# Video: the second motion source, and the preview

A clip does two jobs in this mode, and they are not the same job.

1. **A motion source.** A clip shot on a flat chroma-green plate is sampled
   into frames by `sprite-sheet.mjs from-video`, keyed, cleaned, aligned and
   packed exactly like a sheet's cells. This is the smoother of the two
   sources — the model draws the in-betweens — and it is what a walk, a run or
   an attack should be built from. It costs about a dollar and several minutes
   per motion.
2. **A preview.** A clip rendered *from* finished frames, so the user can feel
   the motion. That clip is never sampled back into frames.

The rule that used to read "video clips are previews, never sources" is now
about job 2 only: a clip you rendered from the frames must not become the
frames. A clip shot deliberately, on green, with the camera locked, IS a
legitimate source — that is what `from-video` and `add-motion --source video`
are for.

Two scripts, deliberately the same CLI shape so one grammar covers both:

| Script | Model | Role |
|---|---|---|
| `{SKILL_PATH}/scripts/seedance-video.mjs` | ByteDance Seedance 2.5 on fal | cheap, quick, all three endpoints |
| `{SKILL_PATH}/scripts/generate-video.mjs` | MiniMax H3 Max on fal | stronger motion, slower, ≥ 5 s |

Invoked like everything else in this skill — `node {SKILL_PATH}/scripts/<name>.mjs`
from the workspace, no `cd`, every path workspace-relative. Unlike
`generate_image.mjs`, both of these **do** take `--prompt` as a flag; it is the
one place in this mode where the prompt is not a positional argument.

This session's default is **`{{defaultVideoModel}}`** — use it unless the
user's `render-video` choice says otherwise.

Both need `FAL_KEY`, both submit through the shared fal queue driver
(`fal-queue.mjs`) which polls, cancels on deadline or SIGINT, and retries only
failures proven not to have reached fal. Call each one **once**; if it fails,
report the failure and stop.

## Endpoint choice

| Endpoint | Use when | How the motion gets in |
|---|---|---|
| `image` (i2v) | The default preview. You want the character to start exactly as drawn. | `--image <flattened frame 00>`; the prompt describes the motion |
| `image` + `--end-image` (first-last) | The motion has a definite end pose, or it loops and must land back where it started | first frame and last frame pin both ends; the model fills between |
| `reference` (r2v) | The clip must perform *these* beats, not a reinterpretation | `--ref-image <character>/refs/turnaround.png --ref-image <character>/motions/<id>/sheet.png`, addressed in the prompt as `@Image1` / `@Image2` |
| `text` | Almost never here — you have a character and you want it kept | — |

**Flatten before i2v.** Video models mishandle alpha; a transparent PNG comes
back with black fringing or a grey plate.

```bash
node {SKILL_PATH}/scripts/sprite-sheet.mjs flatten \
  <character>/motions/<id>/frames/00.png \
  --out <character>/motions/<id>/first.png \
  --bg <a colour that suits the character>
```

**Reference binding grammar.** Both scripts number references in the order
passed: the first `--ref-image` is `@Image1`, the second `@Image2`, videos are
`@Video1`, audio `@Audio1`. The prompt must say what each one is, or the model
guesses:

> @Image1 is the character — keep the face, proportions, palette and costume
> exactly. @Image2 is a sprite sheet showing the motion to perform, read left
> to right, top to bottom. Animate @Image1 performing that motion, one
> continuous action, side view, plain background.

## `seedance-video.mjs` flags

The i2v preview, end to end:

```bash
node {SKILL_PATH}/scripts/seedance-video.mjs \
  --prompt "The character bounces in place, one continuous loop, plain background." \
  --image <character>/motions/<id>/first.png \
  --duration 4 \
  --resolution 480p \
  --no-audio \
  --output <character>/motions/<id>/video-seedance-1.mp4 \
  --json
```


| Flag | Values | Default | Notes |
|---|---|---|---|
| `--prompt` | text | — | required |
| `--output` | path | — | required |
| `--endpoint` | `text` \| `image` \| `reference` | inferred | `--ref-*` → reference, `--image` → image, else text |
| `--image` | path or URL | — | first frame |
| `--end-image` | path or URL | — | last frame |
| `--ref-image` | repeatable, ≤ 30 | — | `@Image1`, `@Image2`, … |
| `--ref-video` | repeatable, ≤ 10 | — | `@Video1`, … |
| `--ref-audio` | repeatable, ≤ 10 | — | `@Audio1`, … |
| `--duration` | `auto` or 4–30 | `auto` | outside 4–30 is refused |
| `--resolution` | `480p` \| `720p` \| `1080p` | `480p` | the cheap tier is the right default for a preview |
| `--aspect-ratio` | `auto`, `21:9`, `16:9`, `4:3`, `1:1`, `3:4`, `9:16` | — | **refused on the image endpoint**, which is fixed to `auto` by the first frame |
| `--no-audio` | flag | audio on | always pass it here — a sprite motion has no dialogue and audio costs time |
| `--bitrate` | `standard` \| `high` | `standard` | |
| `--seed` | integer | — | for reproducing a take |
| `--deadline-s` | seconds | `900` | |
| `--json` | flag | | one JSON object on stdout |

`--json` returns `{ path, url, file_size, model, endpoint, requested_duration,
resolution, seed? }`. Local files are converted to data URIs; anything over
30 MB is refused with a clear message (a 480p 4 s clip and a 2048×2048
reference are both far under it).

## `generate-video.mjs` (H3 Max) flags

Same shape, different limits:

```bash
node {SKILL_PATH}/scripts/generate-video.mjs \
  --prompt "@Image1 is the character … @Image2 is a sprite sheet showing the motion to perform …" \
  --ref-image <character>/refs/turnaround.png \
  --ref-image <character>/motions/<id>/sheet.png \
  --duration 5 \
  --resolution 480P \
  --output <character>/motions/<id>/video-h3-1.mp4 \
  --json
```

| Flag | Values | Default |
|---|---|---|
| `--endpoint` | `text` \| `image` \| `reference` | inferred |
| `--duration` | integer 5–15 | `5` |
| `--resolution` | `480P` \| `768P` | `480P` |
| `--expansion` | `balanced` \| `quality` | `balanced` |
| `--image` / `--end-image` / `--ref-image` / `--ref-video` / `--ref-audio` | as above | |
| `--seed`, `--json`, `--deadline-s` | as above | |

Note the minimum duration of 5 seconds and the upper-case resolution values —
they are not interchangeable with Seedance's.

## Cost and latency

Numbers known today. Treat them as the order of magnitude, not a quote; check
fal's pricing page before promising a user a figure.

| Model / setting | Cost | Wall time |
|---|---|---|
| Seedance 2.5 i2v, 480p | ≈ $0.22 per second of output | — |
| Seedance 2.5 i2v, 720p | ≈ $0.47 per second of output | — |
| H3 Max r2v, 480P, 7 s shot | — | ≈ 14 s (≈ 18 s with a voice reference) |
| H3 Max i2v, 480P, 7 s shot | — | ≈ 28 s |
| H3 Max t2v, 480P | — | ≈ 2–3 s on a quiet queue; reference analysis dominates r2v |

So a 4-second 480p Seedance preview is roughly a dollar. Render one per motion
by default; ask before rendering a set.

Measured at 480P (plotwise, 2026-09-03): the model reproduces structure and
large shapes faithfully, and turns small text into plausible fake glyphs. For
a sprite preview that is fine — there is no text in the frame. Go to 720p /
768P only when the user asks for a keepsake.

## The motion-source clip

Shooting a clip to be *sampled* is a different prompt from shooting one to be
*watched*. Six things have to be true or the frames are unusable, and the
model will not do any of them unless asked:

| Requirement | Why the pipeline needs it |
|---|---|
| Flat solid pure chroma green (#00FF00) filling the frame, evenly lit | `from-video --key auto` reads the corner patches of frame 00; a gradient or a vignette leaves the plate half-keyed |
| No floor, no cast shadow, no reflection, no green spill on the character | A shadow keys as part of the silhouette; spill turns the character's edge green |
| Locked-off camera — no pan, no tilt, no zoom, no parallax, no cut | Every camera move is read as the character moving, and the aligner faithfully removes it |
| Whole character and props inside the frame with margin, consistent proportions and camera scale | Crouching or turning may change silhouette dimensions; clipping and unintended rescaling are faults |
| Explicit support contacts, facing changes and in-place or travelling movement | Pin contacts only while they support the body; the alignment step cannot infer which displacement is intentional |
| One continuous performance, ending in the starting pose when the motion loops | The frames are sampled evenly, so the clip's arc *is* the animation's arc |

Use the motion plan from `prompting.md` to fill this template. Adapt contacts,
movement and ending to the action; planted feet are specific to a grounded
idle, not a requirement for every clip. Read `pipeline.md`'s alignment limits
when the action needs travel preserved in the exported frames.

> One continuous [motion] of the character. The camera is locked off: no pan,
> no tilt, no zoom, no parallax, no cut. The whole character and props stay
> inside the frame with clear margins, consistent body proportions and
> drawing scale. [Starting view, contact changes, and in-place or travelling
> movement.] The motion: [related phases and their pacing, what leads, and
> what follows]. The background is a flat solid pure chroma green filling
> the whole frame, evenly
> lit, no gradient, no floor, no cast shadow, no reflection, and no green
> light spilling onto the character. [Ending: return to the opening pose for
> a continuous loop, or settle into the stated destination pose.]

For a non-looping motion, use `--no-loop` when sampling and name the end pose
in the prompt. The worked idle below is one grounded-loop example.

The `--image` is the character on that same green plate: take a reference (or
frame 00 of an existing motion) and `sprite-sheet.mjs flatten --bg "#00ff00"`
it, so the first frame the model extends already has the background the prompt
asks for. The worked call, end to end:

```bash
node {SKILL_PATH}/scripts/sprite-sheet.mjs flatten <character>/refs/portrait.png \
  --out <character>/motions/<id>/first-green.png --bg "#00ff00" --json

node {SKILL_PATH}/scripts/seedance-video.mjs \
  --prompt "One continuous idle loop of the character. The camera is locked off: no pan, no tilt, no zoom, no parallax, no cut. The character stays centred and fully inside the frame at a constant size, planted on one fixed baseline — no walking, no turning, no stepping toward or away from the camera. The motion: the chest and shoulders rise and fall once in one slow breath, the hair and the cloak trail a beat behind, the paper lantern beside her sways gently, and she blinks once. The background is a flat solid pure chroma green filling the whole frame, evenly lit, no gradient, no floor, no cast shadow, no reflection, and no green light spilling onto the character. The final frame returns to the opening pose so the loop closes seamlessly." \
  --image <character>/motions/<id>/first-green.png \
  --duration 4 --resolution 480p --no-audio \
  --output <character>/motions/<id>/video-seedance-1.mp4 --json

node {SKILL_PATH}/scripts/sprite-sheet.mjs from-video \
  <character>/motions/<id>/video-seedance-1.mp4 \
  --out <character>/motions/<id> --name <id> --frames 16 --loop --json \
  > <character>/motions/<id>/run.json
```

Only a reference that already shows the whole character can be flattened
straight to green. A reference with a white plate is white *inside* the
character too (eye whites, a cream cloak), so keying the white first would
punch holes in it — flatten an existing motion's `frames/00.png`, which is
already cut out, or accept the white plate and let the model repaint the
background from the prompt.

## Bookkeeping around the call

Always, in this order:

1. ```bash
   node {SKILL_PATH}/scripts/sprite-project.mjs add-video --dir <character> \
     --motion <id> --file motions/<id>/video-<model>-<n>.mp4 \
     --model … --mode … --from <the frame assets you fed it> \
     --prompt "…" --status generating --json
   ```
2. run the script once
3. ```bash
   node {SKILL_PATH}/scripts/sprite-project.mjs set-video --dir <character> \
     --motion <id> --video <videoId> --status ready --json
   ```
   — or `--status failed --notes "<what the script reported>"`

Note the two path shapes in one flow: the video script's `--output` is
workspace-relative (`<character>/motions/<id>/…`), while `add-video --file` is
relative to `--dir`, because that string becomes the asset uri inside
`project.json`.

Registering before the call is what puts a "rendering" chip on the stage; a
user who sees nothing for forty seconds assumes you did not hear them. And
registering the failure is what stops the next turn from believing a clip
exists.

## Measured (Lumi seed, 2026-09-09)

One real Seedance 2.5 clip, `image` endpoint with `--end-image` (first-last),
rendered from the `attack` motion's flattened frame 00 and frame 15:

```bash
node {SKILL_PATH}/scripts/seedance-video.mjs \
  --prompt "The chibi lantern courier swings her paper lantern through one continuous arc: …" \
  --endpoint image \
  --image lumi/motions/attack/first.png \
  --end-image lumi/motions/attack/last.png \
  --duration 4 --resolution 480p --no-audio \
  --output lumi/motions/attack/video-seedance-1.mp4 --json
```

| Measurement | Value |
|---|---|
| wall time | **404 s** (6 min 44 s) for a 4-second 480p clip |
| output | 860 089 bytes, h264, 588×716, 24 fps, 4.04 s |
| `--duration 4` (numeric) | **accepted** — the script sends the enum string and fal echoed `requested_duration: 4` |
| aspect ratio | taken from the first frame (416×506 → 588×716); `--aspect-ratio` stays refused on this endpoint |
| seed (returned) | 479351011 |

**Budget seven minutes, not one.** The cost table above is about money; this is
the number that matters to a waiting user. Register the video with
`add-video --status generating` *before* the call — that chip on the stage is
the only thing standing between the user and seven minutes of silence — and
say out loud that it takes several minutes, *before* you start. Call the script
once and then leave it alone: it is already polling the queue for you, so
there is nothing to check on, and a second submission because the first went
quiet is a second render and a second bill. It retries transient failures
itself.

## Measured: the video source (Lumi portrait, 2026-09-10)

One Seedance 2.5 i2v clip of the seed's portrait flattened onto pure green,
shot with the template above and sampled with `from-video --frames 16 --loop`:

| Measurement | Value |
|---|---|
| clip | 640×640, 24 fps, 97 frames, 4.04 s, 552 KB, `--duration 4 --resolution 480p --no-audio` |
| the plate the model actually painted | `#08f00d` — near the #00FF00 asked for, not equal to it, which is why `--key auto` measures it instead of assuming |
| alpha coverage after keying | **0.4438** (the character is 44 % of the frame; the plate is gone) |
| green fringe | a **1 px** dark-green rim on the silhouette — 2.8 % of the sprite's opaque pixels. It is the anti-aliased ramp between the plate and the black ink outline, so no similarity setting reaches it without eating the drawing. It disappears under `pack --scale 0.5` and is invisible at sprite size |
| `bodyDrift` | **0.343 px** on a 622 px cell — 0.06 % of the cell, against a 5 % warning threshold |
| `anchorDrift` | x 2.921 px, y 0 |
| `maxJump` | 3 px (threshold: 8 % of 622 = 50 px) |
| `scaleDrift` | 0.0226 (threshold 0.15) |
| `cleaned` | `[]` — nothing to remove; a single-subject clip on a flat plate produces one blob per frame, and the lantern is far too big to be litter |
| warnings | none |
| `from-video` wall time | **12.4 s** for 16 frames (17 seeks + 16 decodes + align + pack + gif + webp + inspect) |
| cell | 622×644 from a 640×640 frame, `--cell auto` |
| default fps | 3.959 = 16 frames / 4.042 s — the clip at its own speed |

**Why `--similarity` defaults to 0.22 on video and 0.12 on a sheet.** Sweeping
the key on frame 00 of that clip:

| `--similarity` | alpha coverage | greenish pixels left in the sprite |
|---|---|---|
| 0.10 | 0.4398 | 3.48 % |
| 0.15 | 0.4368 | 2.82 % |
| 0.22 | 0.4334 | 2.06 % |
| 0.30 | 0.4295 | 1.17 % |
| 0.35 | 0.4272 | 0.67 % |

Every pixel lost between 0.10 and 0.35 is a greenish one — on *this* character
the wider key only ate fringe. 0.22 is the default because it roughly halves
the fringe while staying far from any palette; raise it toward 0.30 for a
character with no green in its colours, and lower it toward the sheet default
for one that is partly green, where a wide key would eat the costume.

**Flatten first, always.** Both keyframes went through
`sprite-sheet.mjs flatten --bg "#f0ece4"`; a light neutral suits this
character's cream palette better than white (which loses the cloak's edge) or
black. The flattened `first.png` / `last.png` are working files, not assets —
they are not registered in `project.json` and are not shipped in the seed.

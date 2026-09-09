# Video preview

A clip is how the user *feels* a motion. It is never the source of frames —
frames come from the sheet, cell-aligned; a clip's frames are neither aligned
nor reliably the same character.

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

**Flatten first, always.** Both keyframes went through
`sprite-sheet.mjs flatten --bg "#f0ece4"`; a light neutral suits this
character's cream palette better than white (which loses the cloak's edge) or
black. The flattened `first.png` / `last.png` are working files, not assets —
they are not registered in `project.json` and are not shipped in the seed.

# Video: the motion source, the preview, and the loop

A clip does three jobs in this mode, and they are not the same job.

1. **A motion source.** A clip shot on a flat chroma-green plate is sampled
   into frames by `sprite-sheet.mjs from-video`, keyed, cleaned, aligned and
   packed exactly like a sheet's cells. This is the smoother of the two
   sources — the model draws the in-betweens — and it is what a walk, a run or
   an attack should be built from. It costs about a dollar and several minutes
   per motion.
2. **A preview.** A clip rendered *from* finished frames, so the user can feel
   the motion. That clip is never sampled back into frames.
3. **A seamless loop.** A clip shot first-last with the same image at both
   ends, whose every frame becomes the transparent animation a UI plays
   forever (workflow E). Same price as job 1, a different prompt, and a
   different question asked of it: not "is this one cycle?" but "do the two
   ends match?". It has its own section below.

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

Two more fal scripts work on a clip that already exists rather than making one
— `remove-video-background.mjs` (matting to alpha) and `interpolate-video.mjs`
(frame interpolation). Both belong to the loop workflow and are documented
under *The seamless loop clip* below.

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
| `image` + `--end-image` (first-last) | The motion has a definite end pose, or it loops and must land back where it started | first frame and last frame pin both ends; the model fills between. A seamless loop passes the **same** file to both |
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

## The seamless loop clip

A third job for a clip, and the only one where the *ends* matter more than the
middle: a loop for a UI (workflow E). It is shot **first-last with the same
image at both ends** — `--image` and `--end-image` naming the same file — so
the model is given the frame it has to land back on. That is a target, not a
guarantee: a clip whose ends differ produces a visible jump on every cycle, and
the only fixes are another clip or a retime. What settles the question is
`loop`'s measured `seam` against `step`, never the shape of the recipe.

The model still has to be told not to wander on the way, so the template pins
the camera, the scale and the return:

> One continuous [motion verb] of the [subject]. The camera is locked off: no
> pan, no tilt, no zoom, no parallax, no cut. The [subject] stays centred at a
> constant size, fully inside the frame with clear margins — it does not
> travel, turn away, or change scale. The motion: [the organic movement in one
> sentence: what leads, what follows, how many beats]. The background is a flat
> solid pure chroma green filling the whole frame, evenly lit, no gradient, no
> floor, no cast shadow, no reflection, and no green light spilling onto the
> subject. The motion slows and settles back into exactly the opening pose
> over the final second, so the loop closes seamlessly.

The last sentence is not a formality — it is what turns a four-second
performance into a cycle, and it is the one clause worth re-reading before you
spend the dollar. **Ask for the settle, not just the return**: on the measured
clip below Seedance spent its final three frames hurrying back to the keyframe,
at about twice the median step, which reads as a flinch right where the loop
joins. Two beats need five seconds; one needs four.

The worked call, from the cut-out keyframe to the clip:

```bash
node {SKILL_PATH}/scripts/sprite-sheet.mjs flatten \
  <character>/motions/<id>/keyframe-alpha.png \
  --out <character>/motions/<id>/first-green.png --bg "#00ff00" --json

node {SKILL_PATH}/scripts/seedance-video.mjs \
  --prompt "One continuous flicker of the clay flame. The camera is locked off: no pan, no tilt, no zoom, no parallax, no cut. The flame stays centred at a constant size, fully inside the frame with clear margins — it does not travel, turn away, or change scale. The motion: the flame sways slowly to the left and back, its tip curling a beat behind the body, in two soft breaths. The background is a flat solid pure chroma green filling the whole frame, evenly lit, no gradient, no floor, no cast shadow, no reflection, and no green light spilling onto the flame. The motion slows and settles back into exactly the opening pose over the final second, so the loop closes seamlessly." \
  --image <character>/motions/<id>/first-green.png \
  --end-image <character>/motions/<id>/first-green.png \
  --duration 5 --resolution 480p --no-audio \
  --output <character>/motions/<id>/video-seedance-1.mp4 --json
```

Cost is the same tier as any Seedance clip — ≈ $0.22 per second of 480p
output, so ≈ $0.9 for four seconds and ≈ $1.1 for five. Flatten onto pure green
rather than a neutral: the whole point of the plate is that `loop --key auto`
can measure and remove it.

### Seedance idle loops — known failure modes

These are reproducible model behaviour, not bad prompts. **Prompt wording does
not fix them; `retime` does** (pipeline.md, and workflow E step 6b). Measured
on the Kiki trial, 2026-09-22, two 5 s 480p first-last takes of a mascot
breathing — both takes showed all three:

| What it does | How it reads in `contact` | What to do |
|---|---|---|
| **Freezes at the inhale apex** for 1.5–2 s of the five | A long run of ~0 in `profile.deltas`, and `loops[]` comes back **empty** — the clip has no window whose ends match, because most of it is one pose | `retime --keep` around the freeze. The take's own frames still contain a full inhale and a full exhale |
| **Blinks twice** — closed 3 frames, open 2, closed 2 | Two dips in the dark-pixel count about 5 frames apart | Keep the first blink's range and drop the second |
| **Sits still in the tail** after the return | `stillEnd` well before the duration | `--trim-holds` (on by default in `loop`) drops it, or a retime ends the range earlier |

The prompt in the template above already says *the body is never still* and
*a single smooth sine-wave breath with no pause at the top*. Both takes froze
anyway. Re-shooting is $1.1 that buys the same three defects, which is why step
6b exists and why a second take is a decision to put to the user rather than a
correction to make.

On the same trial the freeze was cut and one beat repeated into a two-beat
breath: ranges `2-45,60-66,75-112,2-52,75-112`, then Topaz to 48 fps and VEED-gs
for the matte. The result measured `seam 0.0022` against `step 0.0018` — a
loop that closes, established by measurement, since the wrap was by then source
frame 112 back to frame 2 rather than the keyframe on both sides.

### Matting the clip: `remove-video-background.mjs`

The colour key that `loop` applies by default is free and good on a flat plate,
but it cuts by colour distance, so a soft 3D edge keeps a green rim. The two
paid alternatives cut on the silhouette and hand back a clip that *carries*
alpha, which `loop --key alpha` then decodes instead of keying.

```bash
node {SKILL_PATH}/scripts/remove-video-background.mjs \
  --input <character>/motions/<id>/video-seedance-1.mp4 \
  --output <character>/motions/<id>/video-veed-2.webm \
  --model veed-gs --json
```

| Flag | Values | Default | Notes |
|---|---|---|---|
| `--input` | path or URL | **required** | a local clip is **uploaded to fal storage** and the hosted URL travels in `video_url`; an `http(s)` URL is passed through as given; a `data:` URI is refused — both endpoints cap `video_url` at 2083 characters (measured: VEED 422 `url_too_long`, Topaz 400 "URL too long"), which every real clip exceeds |
| `--output` | path | **required** | must end `.webm` for `veed` / `veed-gs`, `.mov` for `bria` — the codec is not negotiable |
| `--model` | `veed` \| `veed-gs` \| `bria` | `veed` | see the table below |
| `--person` | flag | off | `veed` only: `subject_is_person: true`. An icon is not a person; leave it off |
| `--no-refine` | flag | refinement on | `veed` only: skips edge refinement, cheaper and softer |
| `--spill` | number | `0.8` | `veed-gs` only: `spill_suppression_strength` |
| `--deadline-s` | seconds | | as the other fal scripts |
| `--json` | flag | | `{ path, url, file_size, model, endpoint, alpha: true }` |

Each flag belongs to exactly one endpoint and is **refused** on the others,
rather than travelling as a field the schema does not have.

| Model | Endpoint | Price | Output | Limits |
|---|---|---|---|---|
| `veed` | `veed/video-background-removal` | **$0.0225 per 30 frames** with edge refinement, **$0.015** without | VP9 `.webm` with alpha | — |
| `veed-gs` | `veed/video-background-removal/green-screen` | **$0.015 per 30 frames** | VP9 `.webm` with alpha | — |
| `bria` | `bria/video/background-removal` | **$0.14 per second** | ProRes 4444 `.mov`, `Transparent` background | ≤ 30 s, ≤ 4000² |

**Pick the endpoint by the plate.** A clip shot on flat chroma green — which
is what workflow E shoots — goes to **`veed-gs`**, the documented default for
this pipeline's own loop clips: measured 2026-09-22 on the trial clip, 617 KB
of VP9 with `ALPHA_MODE=1`, 18.7 s of inference and 30 s wall for ≈ **$0.06**
over 121 frames, zero green pixels left, and a *softer* edge than plain `veed`
on the same frame (8535 partial-alpha pixels against 6198). Any other plate
goes to **`veed`** — it cuts on the silhouette rather than on a colour — at
about **$0.09** for the same clip. **`bria`** is the alternative to reach for
if VEED's edge ever fails a subject: about **$0.70** for that clip, a factor
of eight, and it has not been run here.

### Interpolating: three ways, and the user picks

Seedance renders at 24 fps. A UI loop at a higher rate reads noticeably
smoother, and there are three ways to get there. **Which one is the user's
call, not the agent's** — the session's `defaultInterpolator` setting says
which to reach for when they have no preference, and it ships as `topaz`.
Put all three in one message with their prices and take the answer.

| | Command | Rate | Cost | The wrap |
|---|---|---|---|---|
| **Topaz** on fal | `interpolate-video.mjs --target-fps 60` | Exactly 60 fps — it is *told* the rate | ≈ **$0.10** per 5 s clip; 49–69 s | **Not closed.** It interpolates the clip as a clip and never sees the last frame against the first |
| **RIFE** on fal | `interpolate-video.mjs --model rife --between 1 --loop` | *Multiplies* the rate: `--between 1` takes 24 fps to 48, `2` to 72 | ≈ **$0.03** per 5 s clip ($0.0013 per compute second) | **Closed.** fal documents `loop: true` as "the final frame will be looped back to the first frame to create a seamless loop" |
| **ffmpeg** | `sprite-sheet.mjs loop --fps 60` — no extra call | Whatever `--fps` says | free | Closed — it interpolates with a copy of frame 0 appended |

The owner's position: **Topaz's ten cents is acceptable**, and it is the
documented default. RIFE is the cheap one that also closes the wrap. The free
`minterpolate` is the fallback for a session with no fal key, not the
recommendation — its in-betweens are the weakest of the three.

```bash
# the default
node {SKILL_PATH}/scripts/interpolate-video.mjs \
  --input <character>/motions/<id>/video-seedance-1.mp4 \
  --output <character>/motions/<id>/video-topaz-2.mp4 \
  --target-fps 60 --json

# or RIFE, which closes the wrap on its way
node {SKILL_PATH}/scripts/interpolate-video.mjs \
  --input <character>/motions/<id>/video-seedance-1.mp4 \
  --output <character>/motions/<id>/video-rife-2.mp4 \
  --model rife --between 1 --loop --json
```

| Flag | Values | Default | Notes |
|---|---|---|---|
| `--input` / `--output` | paths | **required** | a local clip is uploaded to fal storage, exactly as above; `--output` is an `.mp4` (H.264) either way |
| `--model` | `proteus` \| `gaia-2` \| `rife` | `proteus` | `proteus` / `gaia-2` are Topaz models, sent as `Proteus` / `Gaia 2` (`gaia-2` targets animation and bills at half price); `rife` names the other endpoint |
| `--target-fps` | 16–60 | `60` | **Topaz only** — refused with `rife`, which has no target to name |
| `--upscale` | factor | `1` | **Topaz only** — 1 keeps the frame size; the trial confirms fal accepts it |
| `--between` | whole number ≥ 1 | `1` | **RIFE only** — frames invented between each pair |
| `--loop` | flag | off | **RIFE only** — interpolate the wrap too |
| `--scene-detect` | flag | off | **RIFE only** — do not interpolate across a cut |
| `--fps` | 16–60 | calculated | **RIFE only** — pin the output rate instead of multiplying |
| `--deadline-s` | seconds | | |
| `--json` | flag | | Topaz: `{ path, url, file_size, target_fps, upscale_factor, model }`, `model` fal's own spelling. RIFE: `{ path, url, file_size, model: "rife", between, loop, fps? }` — no `target_fps`, because nobody set one |

Each flag is refused on the endpoint that does not have it, rather than
travelling as a field the schema never reads.

Endpoints: `fal-ai/topaz/upscale/video`, **$0.01 per second at ≤ 720p, doubled
at 60 fps** (≈ $0.10 for a five-second clip); `fal-ai/rife/video`, **$0.0013
per compute second** (≈ $0.03 for the same clip). `--upscale 1` is accepted by
Topaz (measured): the frame size is kept and only the frame rate changes.

**Measured, on the trial clip (640², 24 fps, 121 frames).** RIFE with
`{ num_frames: 1, use_scene_detection: false, use_calculated_fps: true,
loop: true }` came back 640² h264 at **48 fps, 243 frames**, 5.06 s, 570 KB —
**21.0 s of inference, but 231 s of wall time** on a cold queue, so say "twenty
seconds of compute, but the queue can hold it for minutes" rather than quoting
the inference figure. Its median step is 0.0275, half the 24 fps clip's 0.046
exactly as doubling the rate predicts, and its seam is **0.0107** — under half
a step. `loop: true` really does close the wrap. Topaz's wrap on the same
subject came back at **6.5× its own step**: the 24 fps original closes (seam
0.028 against a median step of 0.046) and the Topaz 60 fps version does not
(seam 0.067 against a step of 0.029, past the 2× line). That is not a reason
to avoid Topaz — `loop --seam-fill` closes a near miss — but it is a reason to
re-read the seam after any interpolation.

### The order: interpolate, then matte

Interpolation invents in-between frames by looking at colour motion, and it
wants opaque pixels; run it on the **plate** clip, before anything is cut out.
Matting is the last step, because after it there is nothing left to interpolate
honestly — `loop` refuses `--fps` on an alpha clip and says so rather than
quietly producing blended half-transparent frames.

So the chain, when you want both:

```
video-1 (Seedance, green plate, 24 fps)
  → interpolate → video-2 (plate, 48–60 fps)   topaz | rife | (or loop --fps, no clip)
    → matte → video-3 (alpha)                  veed-gs on green | veed | bria
      → loop --key alpha
```

### Bookkeeping around a derived clip

Each derived clip is registered like any other, with the parent named instead
of a prompt:

```bash
node {SKILL_PATH}/scripts/sprite-project.mjs add-video --dir <character> \
  --motion <id> --file motions/<id>/video-topaz-2.mp4 \
  --derived-from <id>-video-1 --op interpolate --model topaz --json

node {SKILL_PATH}/scripts/sprite-project.mjs add-video --dir <character> \
  --motion <id> --file motions/<id>/video-veed-3.webm \
  --derived-from <id>-video-2 --op matte --model veed-gs --json
```

`--derived-from` writes a `derive` edge from the parent clip's asset carrying
`params: { op, model }`, and the sidecar entry records `mode: "derived"`. There
is no `--mode`, no `--prompt` and no `--from` on a derived clip — nothing was
prompted, and inventing a prompt to fill the field is how a later turn comes to
believe a clip was generated. `--model` takes the endpoint that really cut it
(`veed`, `veed-gs`, `bria`, `topaz`) — a `veed-gs` matte recorded as `veed`
names a model nobody called — and `--status` defaults to `ready`, because the
file was written before there was anything to register. `show` prints the
chain as `video-3 ← video-2 (matte, veed-gs)`. Then
`register-run --video <the clip the frames were actually cut from>`, which
with a chain is not the newest clip by default.

### Measured: the loop clip (Flame trial, 2026-09-22)

One real first-last Seedance clip from a claymation flame keyframe — the same
subject as the reference clip this workflow was built against — with each
post-processing path run against it.

| Step | Wall time | Cost | Result |
|---|---|---|---|
| keyframe (GPT Image, 1024², `--quality high`) | **29 s** | $0.05 | one flame on white |
| `remove-background.mjs --model heavy --resolution 1024` | **6 s** | | the cut-out |
| clip, first-last, same image both ends (`--duration 5 --resolution 480p --no-audio`) | **199 s** (3 min 19 s) | ≈ $1.1 | 640×640, h264, 24 fps, **121 frames**, 5.04 s, 366 KB |
| `remove-video-background.mjs --model veed` | **22.6 s** (17 s inference) | ≈ $0.09 | VP9 webm carrying alpha |
| `remove-video-background.mjs --model veed-gs` | **30 s** (18.7 s inference) | ≈ $0.06 | 617 KB VP9 webm, `ALPHA_MODE=1`, zero green pixels |
| `interpolate-video.mjs --target-fps 60 --upscale 1` (Topaz) | **49 s** (43 s inference) | ≈ $0.10 | 300 frames, 4.3 MB h264, the green plate kept |
| `interpolate-video.mjs --model rife --between 1 --loop` | **231 s** wall on a cold queue (21.0 s inference) | ≈ $0.03 | 48 fps, 243 frames, 5.06 s, 570 KB; seam 0.0107 against a step of 0.0275 |
| `sprite-sheet.mjs loop` (119 frames, 512×596, four exports) | **24 s** | free | webp 3.4 MB, apng 21 MB, webm 367 KB, lottie 28 MB — the Lottie warning fired |
| `--model bria` | not run | | VEED was eight times cheaper and good enough; Bria stays documented, unmeasured |

**The edge, three ways, compared at 1:1:**

| Path | Cost | Edge |
|---|---|---|
| `veed-gs` matte → `loop --key alpha` | ≈ $0.06 | **the best of the four** — zero green pixels, and the softest edge measured: 8535 partial-alpha pixels on the frame where plain `veed` has 6198 |
| `veed` matte → `loop --key alpha` | ≈ $0.09 | soft, zero green pixels, no dark rim |
| `loop --key auto` (colorkey **then** despill) | free | acceptable: a faint 1 px dark rim |
| colorkey with `--no-despill` | free | **not acceptable** — a visible 1–2 px green fringe at 640² |

So: **with a fal key, matte and cut with `loop --key alpha` — `veed-gs` when
the clip was shot on chroma green (which workflow E's is), `veed` for any other
plate; without a key, `loop --key auto` and its despill**, which is honest at
UI size. Never ship a chroma-plate loop keyed with `--no-despill` — a loop is
rendered at the size it was cut at, so there is no downscale further along to
hide the fringe the way a sprite motion has.

**Seam, as a worked verdict.** `loop` measured the Seedance clip at seam
**0.028** against a median step of **0.046** — the last frame is closer to the
first than a normal frame is to its neighbour, which is a loop that closes. The
Topaz 60 fps version of the same clip came back at seam **0.067** against a step
of **0.029**: past the 2× line, and the warning fires. Nothing about the
subject changed; only the wrap did.

**Budget three to eleven minutes for the clip.** 199 s here against 404 s for
the 4 s i2v clip measured above, and **632 s** and **≈ 300 s** for the two Kiki
takes (2026-09-22) — the spread is the fal queue, not the duration, so quote
the range and register the placeholder before you call.

**The same loop at 60 fps, two ways** (trial clip, `--width 512`, key +
despill):

| | Frames | Seam vs step | webm | webp | apng | lottie |
|---|---|---|---|---|---|---|
| Topaz → `loop` | 296 | 0.0268 vs 0.0041 | 1.0 MB | 5.0 MB | 62 MB | 85 MB |
| `loop --fps 60` (minterpolate) | 297 | 0.0186 vs 0.0050 | 0.97 MB | 5.1 MB | 53 MB | 72 MB |

The in-between frames of both are clean at 1:1; Topaz's are slightly sharper.
The seams are the story: neither is closed by its interpolator (both are well
past 2× their own step), which is what `--seam-fill` is for. And every export
except the WebM roughly triples when the rate does — a 60 fps loop is a
`--width` decision before it is a smoothness one.

**Export sizes, and what `--width` does to them.** The `loop` run above was
cut at `--width 512` from 119 frames of a 512×596 crop at 24 fps: WebP 3.4 MB,
APNG 21 MB, WebM 367 KB, Lottie 28 MB. Only the WebM is indifferent to the
width; the Lottie carries every frame as a base64 PNG and is the one that
blows up. At `--width 256` the same loop lands near 7 MB of Lottie and 5 MB of
APNG. Choose the width from the size the UI renders at (double it for retina),
not from the clip. `loop` also stages its working PNGs under
`<motionDir>/.loop-work` while it runs — about frames × W × H × 4 bytes, so
roughly 600 MB for a 122-frame 1440² clip — which is the other reason to pass
`--width` before cutting a large clip rather than after.

Still unmeasured, and still worth filling in: Bria against VEED at 1:1.

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

## Look before you sample: one cycle, not the clip

`from-video` cuts frames evenly across whatever window it is given, and the
default window is the whole clip. That default is wrong for almost every
image-to-video clip, and the way to know the right window is to look —
`sprite-sheet.mjs contact` (`pipeline.md`) is the free, deterministic look.

Measured on a real image-to-video walk clip (4.0 s, 24 fps, 96 frames; the
fox sample shipped with the character-animation-skill repository, keyed off
its black plate), the same clip sampled two ways:

| | Even 16 frames, whole clip | 16 frames, one detected cycle |
|---|---|---|
| window | 0 – 4.000 s | 1.000 – 2.333 s (`contact` → `loops[0]`) |
| playback fps (the clip's own speed) | 4.0 | 12.0 |
| gait cycles per loop | ≈ 2.6, plus the opening hold | 1 |
| dead frames at the start | 2 (silhouette change 0.0006 and 0.032) | 0 |
| frame-to-frame silhouette change | 0.0006 – 0.205 | 0.033 – 0.163 |
| `maxJump` | 86 px | 62.5 px |
| seam, last frame → first | 0.106 | 0.156 |

(Silhouette change is `Σ|a−b| / Σ max(a,b)` over two frames' alpha — 0 is the
same picture — measured with ffmpeg independently of the pipeline.)

The two dead frames are the opening hold: the model held the first frame's
pose for half a second before the first step, and even sampling put two of sixteen
frames inside it — a visible pause every time the loop came round. The rest
of the clip walks about two and a half strides, so sixteen even samples land
on different phases of different strides and the step sizes jitter between a
near-still and a lunge. One cycle sampled at the same count moves evenly and
plays at the clip's own stride rate. The seam did not improve, and that is
honest: this clip carries a jump every fourth source frame (the model's
keyframe cadence), the one-cycle window's last sample happens to straddle
one, and every seam in the table is within a normal step for its own set.
The wins are the rows above it.

What `contact` reports for that clip, before a frame is cut (2.4 s wall,
analysis at 12 fps): `stillStart` 0.5, `stillEnd` 3.833, `loops[0]` =
`{ start 1.0, end 2.333, period 1.333, seam 0.0764, step 0.1763 }`. The
window's end differs from its start by less than half a normal
frame-to-frame change — that is what a loop that closes looks like in
numbers, and it is the check to make before promising a seamless loop.
The table above is that window, sampled with the flags step 7 gives.

So, for a clip: shoot it, `contact` it, sample `loops[0]` (a loop) or
`stillStart`–`stillEnd` (a one-shot) with the frame budget from the SKILL's
step 1 table, and only then `from-video`. When the beats are not evenly
spaced, read the times off the contact sheet and pass them as `--at`.

## Measured: the documented walk workflow on Lumi (2026-09-14)

One Seedance 2.5 i2v clip of the seed's idle frame 00 flattened onto pure
green, shot with the in-place walk prompt (locked camera, treadmill walk,
flat chroma green, return to the opening pose), `--duration 4 --resolution
480p --no-audio`: 556×754, 24 fps, 97 frames, 4.042 s, **355 s wall**.

`contact` (2.6 s): plate `#04ed0a`; `stillStart` 0.167 — Seedance starts
moving almost at once, so the half-second opening hold of the fox clip above
is a property of that clip, not of every model; `stillEnd` 3.917; `loops[0]`
= `{ start 2.083, end 3.75, period 1.667, seam 0.0035, step 0.066 }` — the
window closes on itself twenty times more tightly than a normal frame step.
The whole clip is about 2.4 of those cycles and does not end on its opening
pose, prompt or no prompt.

| | even 16 frames, whole clip | 16 frames, `loops[0]` | 12 frames, `loops[0]` |
|---|---|---|---|
| playback fps (the clip's own speed) | 3.96 | 9.6 | 7.2 |
| frame-to-frame silhouette change | 0.056 – 0.143 | 0.024 – 0.087 | 0.042 – 0.074 |
| seam, last frame → first | 0.126 — twice a step; the loop does not close | 0.036 — one step | 0.081 — one step |
| `maxJump` | 34.5 px | 19.5 px | 16.5 px |
| `bodyDrift` | 0.30 px | 0.31 px | 0.29 px |

Same lesson as the fox clip, with the cleaner outcome a clip shot the way
this page asks for gives: the window `contact` finds is the animation; the
footage around it is not.

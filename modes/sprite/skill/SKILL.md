---
name: pneuma-sprite
description: >
  Pneuma Sprite Mode workspace guidelines. Use for ANY task in this workspace:
  designing a character, writing motion prompts, generating sprite sheets,
  slicing and aligning frames, packing atlases, rendering GIF or video
  previews, diagnosing misaligned or empty frames, or handing assets to a game
  engine. Defines the project.json contract, the pipeline scripts, and how to
  look through the viewer before claiming a motion is done.
  Consult before your first generation in a new conversation.
---

# Pneuma Sprite Skill

<!-- pneuma:start -->

## Scene

You are the animator in this workspace. In front of the user is a motion
stage: a rail of the character's reference images, a list of its motions, and
a player running the selected motion at its own fps beside the GIF, the video
clip and the packed atlas. Your job is to design a character once — a name, a
look, a style sentence — and then turn each motion the user asks for into a
sheet, a set of aligned frames, an atlas a game engine can load, and a preview
they can watch. The user watches every file land as you write it, and clicks a
motion to hand you back exactly which one they mean.

## Viewer contract

One **character** is one top-level directory (a content set). It holds
`project.json`, `refs/`, and one `motions/<id>/` directory per motion.
Everything the stage renders comes from `project.json` plus files under
`/content/<character>/…` — so a motion appears the moment the pipeline writes
its frames, without you telling the viewer anything.

### What the user can select

The user clicks a motion in the list, a reference in the rail, or scrubs to a
frame on the stage. Their next message carries a `<viewer-context mode="sprite">`
block with the character, the selected motion's grid / fps / loop / anchor /
status / frame count, any inspect warnings, and an `Address:` line — the
machine-routable handle for that exact object.

### ViewerAddress vocabulary

| Key | Kind | Meaning |
|---|---|---|
| `contentSet` | framework-reserved | The character directory (`"lumi"`). There is no separate `character` key — the character **is** the content set. |
| `motion` | coarse | Motion id inside the character (`"idle"`). |
| `ref` | coarse | Reference image id (`"turnaround"`). Mutually exclusive with `motion`. |
| `frame` | fine | 0-based frame index inside `motion`. Navigating to an address that carries it seeks there and pauses. |

Example: `{ "contentSet": "lumi", "motion": "attack", "frame": 7 }`.

Copy an address verbatim into:

- `<viewer-locator label="…" address='{…}' />` — a clickable card that takes
  the user to that motion or frame.
- the `capture` action's `params.address` — to screenshot it.

### Actions you can invoke

- **`navigate-to`** — point the stage at a character, motion, ref, or frame.
  Call it before `capture` so you screenshot the thing you mean, and after a
  motion is finished so the user lands on it.
- **`play`** — run the motion at its fps. Timing is the one property a sheet
  PNG cannot show you; a walk that reads fine as 8 stills can still stutter.
  `fps` and `loop` params override the motion's stored values for that
  playback only.
- **`pause`** — stop on the current frame. Call it before capturing a specific
  frame, or your screenshot is whichever frame happened to be up.
- **`get-playback-state`** — read back what the stage actually shows:
  `{ contentSet, motion, frame, frameCount, fps, loop, playing, source, warnings }`.
  `source` is `"frames"` when it plays real sliced frames, `"raw-sheet"` when
  it is falling back to the unprocessed sheet, `"none"` when there is nothing
  to play. A `frameCount` that disagrees with `rows × cols`, or a `source` of
  `"raw-sheet"`, means the pipeline did not land — whatever the script printed.
- **`capture`** — framework built-in. Screenshot an address and look at it.

### Three sensing layers, in cost order

1. **Diagnose** — `sprite-sheet.mjs inspect` (deterministic, free, no model).
   Anchor drift, scale drift, empty frames, clipped cells. Read this first.
2. **Look** — `get-playback-state` + `capture`. Cheap, and the only way to see
   what the user sees.
3. **Verify** — `play`, then `pause` + `capture` at two or three frames. Do
   this before you report a motion ready.

## Core rules

- **Every script runs from the workspace, never from the skill.** The form is
  `node {SKILL_PATH}/scripts/<script>.mjs …`. `{SKILL_PATH}` is an absolute
  path, so there is nothing to `cd` into — and a `cd` would re-root every path
  you pass inside the skill directory, where `motions/idle/sheet-raw.png` does
  not exist. File arguments are **workspace-relative** and therefore carry the
  character directory — `lumi/motions/idle/sheet-raw.png`,
  `--output-dir lumi/refs`. The one exception is `sprite-project.mjs`, where `--dir` names
  the character directory and `--file` is relative to *it*, because a `--file`
  is literally the uri stored in `project.json`.
- **`project.json` is written only by `{SKILL_PATH}/scripts/sprite-project.mjs`.** A single
  motion adds sixteen frame assets plus their provenance edges; ids and edges
  drift the moment they are typed by hand, and a drifted project renders a
  motion with missing frames while every file sits correctly on disk. Read it
  freely — write it through the script.
- **Frames, atlases and previews are written only by `sprite-sheet.mjs`.** It
  owns cell geometry and the anchor maths; a hand-cropped frame breaks the
  invariant the atlas promises (every cell the same size, the anchor at the
  same point).
- **Every sheet is generated with the character references attached**
  (`--image-urls <each ref>`) and `--background transparent`, and the prompt
  opens with the `character.style` sentence verbatim. Drop the references and
  the model redesigns the character between motions; drop the style sentence
  and it drifts within one sheet.
- **Never pass `--style` to `generate_image.mjs`.** It is not a switch — it
  appends `, no shading, white background` to your prompt, which is exactly
  the background you are trying not to get. The style lives in your prompt.
- **Look before you claim.** After `register-run`, read the inspect warnings,
  `navigate-to` the motion, `play` it, `capture` two or three frames, and only
  then report. The sheet PNG is not the animation — a sheet can look perfect
  and still play as a character sliding across the cell.
- **Scripts retry upstream failures themselves.** `generate_image.mjs`,
  `seedance-video.mjs` and `generate-video.mjs` back off and retry on
  transient 5xx / 429 / dropped connections. Call once. If it fails, report
  the failure state to the user and stop — a retry loop you write by hand
  re-bills every attempt and the user watches it happen.
- **Video clips are previews, not sources.** Frames come from the sheet. Never
  extract frames from a generated clip and pass them off as the motion — they
  will not be cell-aligned, and their character consistency is whatever the
  video model felt like.
- **Never touch `.claude/` or `.pneuma/`.**

## Workflows

### A. Design a character

Do this before any motion exists. The character is the thing every later
prompt is anchored to; the ten minutes here save every motion afterwards.

1. **Interview briefly** — name, one paragraph of description, a style
   sentence (the exact words that will open every prompt), facing
   (`left`/`right`), and cell size (256×256 is a good default; 128×128 for a
   pixel look). Ask in one message, not five.
2. **Generate `<character>/refs/turnaround.png`** — a three-view sheet (front /
   side / back) of the character standing neutral, on a transparent
   background, 2048×2048, `--quality high`. This is the reference that carries
   identity into every motion, so it is worth the top quality tier.
3. **Generate `<character>/refs/portrait.png`** — head and shoulders, same
   style, same transparent background.
4. **Record it** — `sprite-project.mjs init` then `add-ref` for each
   reference.
5. **Show them** — `navigate-to { "ref": "turnaround" }`, `capture`, look at
   it yourself, then hand the user a locator card. If the three views do not
   agree with each other, regenerate now; every motion inherits this.

{{#imageGenEnabled}}
Both reference generations are one `generate_image.mjs` call each:

```bash
node {SKILL_PATH}/scripts/generate_image.mjs \
  "<the style sentence verbatim>. A front, side and back view of the same character standing neutral, evenly spaced on one row, identical height in all three. Fully transparent background, no ground shadow, no text." \
  --background transparent \
  --image-size 2048x2048 \
  --quality high \
  --output-format png \
  --output-dir <character>/refs \
  --filename-prefix turnaround
```

The prompt is a **positional argument** — there is no `--prompt` flag on
`generate_image.mjs` (the video scripts do have one, which is what makes this
worth saying twice). One image lands at exactly
`<character>/refs/turnaround.png`, no numeric suffix, which is the file
`add-ref --dir <character> --file refs/turnaround.png` then registers. The
portrait is the same call with `--filename-prefix portrait`. Prompt grammar,
every flag, and worked examples are in `references/prompting.md`.
{{/imageGenEnabled}}

### B. Add a motion

1. **Pick the grid, fps, loop and anchor from the motion type.** Defaults that
   work; deviate when the motion needs it and say why.

   | Motion type | Grid | fps | Loop | Anchor |
   |---|---|---|---|---|
   | idle | 4×4 | 8 | yes | bottom |
   | walk / run | 4×2 or 4×4 | 10–12 | yes | bottom |
   | attack | 4×4 | 10 | no | bottom |
   | jump | 4×2 | 10 | no | center |
   | story key poses | 3×3 | 6 | no | bottom |

2. **Register it before you generate** — `add-motion --status planned`, then
   `set-sheet … --file motions/<id>/sheet-raw.png --status generating` right
   before the image call. `generating` is the one status that accepts a file
   that does not exist yet: it reserves the sheet asset with empty metadata and
   records the model and prompt you are about to send. The stage shows a
   placeholder while the model works, so the user is not staring at nothing
   wondering whether you heard them.
3. **Generate the sheet** — one `generate_image.mjs` call with every reference
   attached, `--background transparent`, and the style sentence first:

   ```bash
   node {SKILL_PATH}/scripts/generate_image.mjs \
     "<style sentence verbatim>. A single image laid out as a strict 4x4 grid of 16 equal cells, read left to right, top to bottom. …" \
     --image-urls <character>/refs/turnaround.png \
     --image-urls <character>/refs/portrait.png \
     --background transparent \
     --image-size 2048x2048 \
     --quality high \
     --output-format png \
     --output-dir <character>/motions/<id> \
     --filename-prefix sheet-raw
   ```

   Positional prompt, one `--image-urls` per reference, and the file lands at
   `<character>/motions/<id>/sheet-raw.png` — the path `set-sheet --file
   motions/<id>/sheet-raw.png` registers.
4. **Run `set-sheet` again, now that the file exists** — the same command as
   step 2 without `--status`, so it defaults to `processing`. The first call
   could not measure a file that was not there; this one probes it and flips
   the same asset id from `generating` to `ready` with its real dimensions.
   Skip it and the sheet stays a placeholder in `project.json` forever —
   `register-run` writes the frames and the atlas, but never revisits the raw
   sheet.
5. **Probe the alpha** — `node {SKILL_PATH}/scripts/sprite-sheet.mjs probe <character>/motions/<id>/sheet-raw.png`.
   Models honour `background: transparent` inconsistently; probing is free and
   tells you which branch you are on.
6. **Key it if it came back opaque** — `remove-background.mjs` (fal, best
   quality) or, with no fal key, `sprite-sheet.mjs key` (ffmpeg `colorkey` on
   the detected corner colour). Either one writes
   `<character>/motions/<id>/sheet-alpha.png`.
7. **Run the pipeline** — `run` does probe → key → slice → align → pack → gif →
   inspect in one call and prints one JSON object. Feed it the sheet you
   actually have: `sheet-alpha.png` when you keyed one in step 6 (`run` probes
   first and will not re-key a sheet that already has alpha), otherwise
   `sheet-raw.png`.

   ```bash
   node {SKILL_PATH}/scripts/sprite-sheet.mjs run <character>/motions/<id>/sheet-raw.png \
     --rows 4 --cols 4 --out <character>/motions/<id> --name <id> --fps 8 --loop \
     --json > <character>/motions/<id>/run.json
   ```

   It leaves the raw sliced cells at `<character>/motions/<id>/cells/NN.png`
   next to the aligned `frames/`. They are not assets — nothing registers
   them — but they are what `inspect` judges "leaves its grid cell" on, and
   what `align` re-reads when only the alignment has to be redone.
8. **Record the run** — `node {SKILL_PATH}/scripts/sprite-project.mjs register-run --dir <character> --motion <id> --run <character>/motions/<id>/run.json`.
   This registers every frame, the atlas, the previews, copies the inspect
   summary into the motion, and sets the status to `ready`. The summary's
   `cells` key is ignored.
9. **Read the inspect warnings**, then verify: `navigate-to`, `play`,
   `pause` + `capture` at a couple of frames.
10. **Fix the loop when it is wrong.** One bad cell → `edit_image.mjs` on
    `<character>/motions/<id>/sheet-raw.png` targeting that cell, then re-run
    from step 7. Anchor drift or a jump between frames → the drawing is fine
    and only the alignment is off: re-run `align` from `cells/` with a
    different `--anchor` / `--smooth`, then `pack` + `gif` + `inspect` +
    `register-run`, or just re-run `run` with the new flags (one command, one
    fresh `run.json`, at the cost of re-slicing). `references/pipeline.md`
    spells out both and says when each is worth it. Scale drift or mixed
    facing across the sheet → regenerate with a tightened prompt; that is a
    drawing problem, not an alignment problem. `references/prompting.md` has
    the phrasings that fix each, and the worked `edit_image.mjs` call.

### C. Render a video preview

A clip is how the user feels the motion; the frames stay the deliverable.

{{#videoGenEnabled}}
1. **Pick the model** — default `{{defaultVideoModel}}`, or whatever the user
   asked for in the `render-video` command.
2. **Pick the mode:**
   - `i2v` — flatten frame 00 onto the character's background colour
     (`sprite-sheet.mjs flatten`), then
     `node {SKILL_PATH}/scripts/seedance-video.mjs --prompt "…" --image <character>/motions/<id>/first.png --duration 4 --resolution 480p --no-audio --output <character>/motions/<id>/video-seedance-1.mp4`.
     Video models mishandle alpha; hand them an opaque frame. These two are the
     one place a prompt travels as `--prompt` instead of a positional.
   - `first-last` — add `--end-image` (the last frame, or frame 00 again when
     the motion loops) so the clip lands where it started.
   - `r2v` — `--ref-image <character>/refs/turnaround.png --ref-image <character>/motions/<id>/sheet.png`
     with a prompt that says `@Image1` is the character and `@Image2` is the
     motion sequence to perform. Use this when the motion must be recognisably
     the same beats, not a reinterpretation.
3. **H3 Max instead** — `generate-video.mjs` takes the same `--image`,
   `--end-image`, `--ref-image` grammar; use `480P` and a duration of at least
   5 seconds.
4. **Register around the call** — `add-video … --status generating` before,
   `set-video --status ready` (or `failed`, with `--notes`) after.

Flags, endpoints, and the cost/latency table are in
`references/video-preview.md`.
{{/videoGenEnabled}}

{{#videoGenDisabled}}
Video previews need a fal.ai key and this session has none, so there is
nothing to render a clip with. Say that plainly when the user asks for one and
point them at session settings to add the key. Meanwhile hand them the GIF and
WebP previews — those are built from the real frames and always work.
{{/videoGenDisabled}}

### D. Hand off to a game engine

`motions/<id>/sheet.png` + `atlas.json` is a TexturePacker JSON-hash pair.
Phaser: `this.load.atlas(key, 'sheet.png', 'atlas.json')` then
`this.anims.createFromAseprite`-style frame names (`<motion>_00`, `<motion>_01`,
…) listed in `animations`. PixiJS: `Assets.load('atlas.json')` yields a
`Spritesheet` whose `animations` map is ready for `AnimatedSprite`. Frame
timing rides in each frame's `duration` (ms), the pivot in `pivot` (`{0.5,1}`
for `bottom`, `{0.5,0.5}` for `center`). For a pixel-art look, re-pack with
`pack --scale 0.5 --nearest` so downscaling stays hard-edged.

## Commands

The user can press three buttons on the stage. Each arrives as a notification
naming the selected motion.

- **`render-video`** — they picked a model and a mode in the popover. Use
  their choices, not your defaults, and follow workflow C.
- **`regenerate-motion`** — redraw the selected motion's sheet, folding in any
  note they attached. Keep the motion id; `register-run` replaces the old
  frames and their edges, so the motion is updated, never duplicated.
- **`fix-alignment`** — the character swims or jumps between frames. Read the
  motion's inspect warnings first. `maxJump` warnings → re-run `align` with
  `--smooth` or the other anchor. `scaleDrift` warnings or "cell NN is
  clipped" → the drawing is the problem; regenerate with a fixed-scale
  instruction.

<!-- pneuma:end -->

## References

Read when you need depth on the topic.

| Topic | File |
|---|---|
| Sheet prompt grammar, worked prompts, what breaks consistency, fixing one cell | `references/prompting.md` |
| Every `sprite-sheet.mjs` / `sprite-project.mjs` subcommand, the atlas schema, inspect warnings | `references/pipeline.md` |
| Seedance 2.5 and H3 Max flags, endpoint choice, reference binding, cost and latency (needs the fal key) | `references/video-preview.md` |
| The `project.json` schema — craft fields, the sprite sidecar, asset id conventions | `references/project-json.md` |

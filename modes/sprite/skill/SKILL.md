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
stage: a rail of the character's references, a list of its motions, and a
player running the selected motion at its own fps beside the GIF, the video
clip and the packed atlas. Your job is to design a character once — a name, a
look, a style sentence — and then turn each motion the user asks for into
aligned frames, an atlas a game engine can load and a preview they can watch.
They see every file land as you write it, and click a motion to hand you back
exactly which one they mean.

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

Example: `{ "contentSet": "lumi", "motion": "attack", "frame": 7 }`. Copy an
address verbatim into `<viewer-locator label="…" address='{…}' />` — a
clickable card that takes the user there — or into the `capture` action's
`params.address`, to screenshot it.

### Actions you can invoke

- **`navigate-to`** — point the stage at a character, motion, ref, or frame.
  Call it before `capture`, and after a motion is finished so the user lands
  on it.
- **`play`** — run the motion at its fps. Timing is the one property a sheet
  PNG cannot show you; a walk that reads fine as 8 stills can still stutter.
  `fps` / `loop` params override the stored values for that playback only.
- **`pause`** — stop on the current frame. Call it before capturing a specific
  frame, or your screenshot is whichever frame happened to be up.
- **`get-playback-state`** — read back what the stage actually shows:
  `{ contentSet, motion, frame, frameCount, fps, loop, playing, source, warnings }`.
  A `source` of `"raw-sheet"` (the unprocessed sheet) or a `frameCount` that
  disagrees with the grid means the pipeline did not land — whatever the
  script printed.
- **`capture`** — framework built-in. Screenshot an address and look at it.

### Three sensing layers, in cost order

1. **Diagnose** — `sprite-sheet.mjs inspect`: deterministic, free, no model.
   Anchor drift, scale drift, empty frames, clipped cells. Read this first.
2. **Look** — `get-playback-state` + `capture`: the only way to see what the
   user sees.
3. **Verify** — `play`, then `pause` + `capture` at two or three frames,
   before you report a motion ready.

## Core rules

- **Every script runs from the workspace, never from the skill.** The form is
  `node {SKILL_PATH}/scripts/<script>.mjs …` — `{SKILL_PATH}` is absolute, so
  there is nothing to `cd` into, and a `cd` would re-root every path you pass
  inside the skill directory where none of those files exist. File arguments
  are **workspace-relative** and carry the character directory
  (`lumi/motions/idle/sheet-raw.png`). The one exception is
  `sprite-project.mjs`, where `--dir` names the character directory and
  `--file` is relative to *it* — a `--file` is literally the uri stored in
  `project.json`.
- **`project.json` is written only by `{SKILL_PATH}/scripts/sprite-project.mjs`.**
  A single motion adds sixteen frame assets plus their provenance edges; ids
  and edges drift the moment they are typed by hand, and a drifted project
  renders a motion with missing frames while every file sits correctly on
  disk. Read it freely — write it through the script.
- **Frames, atlases and previews are written only by `sprite-sheet.mjs`.** It
  owns cell geometry and the anchor maths; a hand-cropped frame breaks the
  invariant the atlas promises.
- **Every sheet is generated with the character references attached**
  (`--image-urls <each ref>`), and the prompt opens with the `character.style`
  sentence verbatim. Drop the references and the model redesigns the character
  between motions; drop the style sentence and it drifts within one sheet.
- **A sheet's background is asked for in words, then cut off afterwards.** The
  prompt ends with *a flat solid pure white background, no shadow, no
  vignette*, the call passes `--background opaque`, and the alpha comes from
  keying afterwards. That is the path, not a fallback: OpenRouter refuses
  `--background transparent` with a `400` *before* generating anything, so the
  attempt costs nothing and always fails the same way (`references/prompting.md`
  has the exact rejection). A *clip* is the mirror image: its background is
  asked for as flat chroma green and keyed the same way afterwards.
- **Never pass `--style` to `generate_image.mjs`.** It is not an art-direction
  switch — it rewrites your prompt ("no shading, white background") and drops
  `--quality` to `low`. The style lives in your prompt, verbatim.
- **Look before you claim.** After `register-run`, read the inspect warnings,
  `navigate-to` the motion, `play` it, `capture` two or three frames, and only
  then report. The sheet PNG is not the animation — a sheet can look perfect
  and still play as a character sliding across the cell.
- **Scripts retry upstream failures themselves.** `generate_image.mjs`,
  `seedance-video.mjs` and `generate-video.mjs` back off and retry on
  transient 5xx / 429 / dropped connections. Call once; if it fails, report
  the failure state and stop. A retry loop you write by hand re-bills every
  attempt and the user watches it happen.
- **A clip is a source only when it was shot to be one.** A preview rendered
  from finished frames is never sampled back into frames — its frames are not
  cell-aligned and its character is whatever the model felt like. A clip shot
  deliberately on flat chroma green with a locked camera *is* a legitimate
  source: that is workflow B-video, and `from-video` is the only thing that
  may cut frames out of it.
- **Never touch `.claude/` or `.pneuma/`.**

## Workflows

### A. Design a character

Do this before any motion exists — every later prompt is anchored to it.

1. **Interview briefly** — name, one paragraph of description, a style
   sentence (the exact words that will open every prompt), facing
   (`left`/`right`), and cell size (256×256 is a good default; 128×128 for a
   pixel look). Ask in one message, not five.
2. **Generate `<character>/refs/turnaround.png`** — a three-view sheet (front /
   side / back) of the character standing neutral, on a flat solid pure white
   background, 2048×2048, `--quality high`. This is the reference that carries
   identity into every motion, so it is worth the top quality tier.
3. **Generate `<character>/refs/portrait.png`** — head and shoulders, same
   style, same white background, **with the turnaround attached** plus a
   clause naming what to match. Without the reference it is a fresh draw of
   your description, not your character: the first Lumi portrait came back
   with dark hair and a red cloak, and the fix was the reference, not more
   adjectives.
4. **Record it** — `sprite-project.mjs init` then `add-ref` for each
   reference.
5. **Show them** — `navigate-to { "ref": "turnaround" }`, `capture`, look at
   it yourself, then hand the user a locator card. If the three views do not
   agree with each other, regenerate now; every motion inherits this.

{{#imageGenEnabled}}
Each reference is one `generate_image.mjs` call. The prompt is a **positional
argument** — there is no `--prompt` flag on it — and one image lands at
exactly `<output-dir>/<filename-prefix>.png`, which is the path `add-ref
--file refs/<name>.png` then registers. The full invocation, every flag and
the prompt grammar are in `references/prompting.md`; the portrait adds
`--image-urls <character>/refs/turnaround.png`, because every reference after
the first is drawn with the earlier ones attached.

The refs stay white-plated on disk; nothing keys a reference. They are the
model's input, and the model reads a white plate fine — only the *sheets* and
the *clips* become frames, and only those are cut out.
{{/imageGenEnabled}}

### B. Add a motion

**Step 0 — pick the source, and ask.** A motion's frames come from one of two
places, and the choice is the user's unless they already made it:

| Source | Cost & time | Best for |
|---|---|---|
| **sheet** — one generated image, sliced into cells | ≈ 35 s, one image | idle and micro motions; key poses. Frames are unevenly spaced — the model draws 16 pictures, not an animation |
| **video** — one clip on chroma green, sampled into frames | ≈ $1 and 5–7 min | walk, run, attack, anything where smoothness is the point: the model draws the in-betweens |

Say those two lines to the user, in one message, and wait — this is the one
decision in the workflow that costs real money to get wrong. Then record it:
`add-motion --source sheet|video`.

**Step 1 — pick the grid, fps, loop and anchor.** Defaults that work; deviate
when the motion needs it and say why.

| Motion type | Frames / grid | fps | Loop | Anchor |
|---|---|---|---|---|
| idle | 16, 4×4 | 6–7 (≈ 2.4 s cycle) | yes | bottom |
| walk / run | 8, 4×2 or 16, 4×4 | 10–12 | yes | bottom |
| attack | 16, 4×4 | 10 | no | bottom |
| jump | 8, 4×2 | 10 | no | center |
| story key poses | 9, 3×3 | 6 | no | bottom |

**A looping motion's last frame must lead back into the first** — say so in
the prompt, by cell number for a sheet and as "the final frame returns to the
opening pose" for a clip. Nobody asks for this and every model forgets it.

**Every motion is drawn in the character's declared `facing`** unless the user
asks for another view, and the prompt says which ("facing right in every
cell"). `inspect` cannot see facing; only you can, by looking.

**Step 2 — register the placeholder and say how long it takes.** Before any
paid call: `add-motion --status planned --source …`, then the placeholder for
what is about to be generated (`set-sheet … --status generating` for a sheet,
`add-video … --status generating` for a clip), and **one line to the user with
the expected wait** from the table at the end of this workflow. The stage
shows the placeholder while the model works; the sentence is what stops the
user wondering whether you heard them.

Then take one of the two legs.

#### B-sheet — the generated sheet

3. **Generate the sheet** — one `generate_image.mjs` call with **every**
   reference attached (`--image-urls` once each), the `character.style`
   sentence first, the canonical 4×4 / 1024 / 256-cell spec, and the white
   plate asked for in the prompt. Grammar, the five clauses that make the cut
   clean, the idle recipe and three worked prompts: `references/prompting.md`.
4. **Run `set-sheet` again**, now without `--status`, so the same asset is
   measured and flips from `generating` to `ready`. Skip it and the sheet
   stays a placeholder forever — `register-run` never revisits the raw sheet.
5. **Probe the alpha** —
   `node {SKILL_PATH}/scripts/sprite-sheet.mjs probe <character>/motions/<id>/sheet-raw.png`.
   It comes back opaque (`hasAlpha: false`, a near-white `cornerColor`). That
   is the expected reading, and it hands the colour to the fallback keyer.
6. **Cut the background out** — the normal step, not a branch:

   ```bash
   node {SKILL_PATH}/scripts/remove-background.mjs \
     --input <character>/motions/<id>/sheet-raw.png \
     --output <character>/motions/<id>/sheet-alpha.png \
     --model heavy --resolution 2048 --json
   ```

   BiRefNet matting cuts on the silhouette instead of by colour distance, so
   it keeps white highlights *inside* the character. With no fal key, the
   ffmpeg fallback is `sprite-sheet.mjs key … --color auto`. Either one writes
   the same `sheet-alpha.png`.
7. **Run the pipeline** — probe → key → slice → clean → align → pack → gif →
   inspect in one call. Always hand it `sheet-raw.png` and pass `--alpha` for
   what step 6 produced, so it slices that instead of keying the white plate
   again:

   ```bash
   node {SKILL_PATH}/scripts/sprite-sheet.mjs run <character>/motions/<id>/sheet-raw.png \
     --alpha <character>/motions/<id>/sheet-alpha.png \
     --rows 4 --cols 4 --out <character>/motions/<id> --name <id> --fps 8 --loop \
     --json > <character>/motions/<id>/run.json
   ```

   It keeps the raw sliced cells at `<character>/motions/<id>/cells/NN.png`:
   not assets, but what `inspect` judges "leaves its grid cell" on and what
   `align` re-reads when only the alignment has to be redone.

#### B-video — the sampled clip

3. **Register the clip first** — `add-video --motion <id> --file
   motions/<id>/video-seedance-1.mp4 --model seedance-2.5 --mode i2v --from
   <the ref or frame you feed it> --prompt "…" --status generating`. This is
   the motion's *source* clip, and `register-run` will hang every frame's
   provenance off it, so it has to exist as an asset before the frames do.
4. **Flatten the input onto pure green** —
   `sprite-sheet.mjs flatten <the ref or frame 00> --out <character>/motions/<id>/first-green.png --bg "#00ff00"`.
   Flatten something already cut out (an existing motion's `frames/00.png`);
   a white-plated reference has white *inside* the character too.
5. **Shoot the clip** — one `seedance-video.mjs` call, `--duration 4
   --resolution 480p --no-audio`, with the chroma-green prompt template from
   `references/video-preview.md`. That template is not decoration: a locked
   camera, a flat green plate with no floor or spill, a centred character on a
   fixed baseline and a loop that closes are what make the frames usable.
   Then `set-video --status ready` (or `failed`, with `--notes`).
6. **Sample it** —

   ```bash
   node {SKILL_PATH}/scripts/sprite-sheet.mjs from-video \
     <character>/motions/<id>/video-seedance-1.mp4 \
     --out <character>/motions/<id> --name <id> --frames 16 --loop \
     --json > <character>/motions/<id>/run.json
   ```

   `--key auto` (the default) measures the plate the model actually painted
   rather than the green you asked for. `--frames` is the frame count from the
   table in step 1; the packed atlas comes out as its own grid, so
   `add-motion --rows/--cols` should describe that layout (16 → 4×4).

#### Both legs end the same way

8. **Record the run** —
   `node {SKILL_PATH}/scripts/sprite-project.mjs register-run --dir <character> --motion <id> --run <character>/motions/<id>/run.json`.
   For a video run add `--video <videoId>` when the motion has more than one
   clip. This registers every frame, the atlas and the previews, copies the
   inspect summary into the motion and sets the status to `ready`.
9. **Read the numbers, then look.** Report the inspect values, not "no
   warnings": `navigate-to` the motion, `play` it, `pause` + `capture` at two
   or three frames, and check the facing while you are there.
10. **Keep it or fix it, and say which.** A warning you are keeping gets
    acknowledged with the reason, in one sentence the user reads:
    `set-motion --motion <id> --ack-warnings "the lantern swings out of the
    bbox by design"`. Regenerate instead when the warning names **scale drift
    over 15 %** or **a clipped cell on a sheet motion** — those are drawing
    faults that no alignment fixes. Anchor drift or a jump is alignment: re-run
    `align` from `cells/` with a different `--x-from` / `--smooth`, or re-run
    the whole chain with the new flags. One bad cell on a sheet →
    `edit_image.mjs` on that cell and re-run from step 5.
    `references/pipeline.md` and `references/prompting.md` spell both out.

**How long each step takes** (measured on the Lumi seed). Nothing here has a
progress bar, so this is how you tell "working" from "hung" — and it is the
number you give the user in step 2:

| Step | Wall time |
|---|---|
| a reference image (2048², `--quality high`) | 30–40 s |
| a sheet (2048², both refs attached) | ≈ 35 s |
| `remove-background.mjs --model heavy --resolution 2048` | 10–20 s |
| `sprite-sheet.mjs run` | ≈ 5 s |
| `sprite-sheet.mjs from-video` (16 frames, 640² clip) | ≈ 12 s |
| **a 4 s Seedance 480p clip** | **≈ 400 s — nearly seven minutes** |

The clip is the one that looks broken and is not: fal queues it, then renders.
Say so before you start one, register the placeholder, and then wait — no
polling, no second call. It retries transient failures itself, and a second
submission is a second bill.

### C. Render a preview clip

{{#videoGenEnabled}}
A *preview* clip is rendered **from finished frames** so the user can feel the
motion; it is never sampled back into frames (that is B-video, which shoots a
clip on green on purpose). Default model `{{defaultVideoModel}}`, or whatever
the user picked in the `render-video` command.

1. **Flatten frame 00** onto a colour that suits the character
   (`sprite-sheet.mjs flatten`) — video models mishandle alpha.
2. **Pick the mode**: `i2v` (`--image`), `first-last` (add `--end-image`, or
   frame 00 again when the motion loops), or `r2v` (`--ref-image` the
   turnaround and the packed sheet, addressed as `@Image1` / `@Image2`) when
   the clip must perform *these* beats.
3. **Register around the call**: `add-video … --status generating` before,
   `set-video --status ready|failed [--notes]` after.
4. **Tell the user it takes minutes, then leave it alone.**

Flags, endpoints, the reference-binding grammar and the cost/latency table are
in `references/video-preview.md`.
{{/videoGenEnabled}}

{{#videoGenDisabled}}
Video needs a fal.ai key and this session has none, so there is nothing to
render a clip with — and no video motion source either: B-video is not
available, so every motion is a generated sheet. Say that plainly when the
user asks and point them at session settings to add the key. The GIF and WebP
previews are built from the real frames and always work.
{{/videoGenDisabled}}

### D. Hand off to a game engine

`motions/<id>/sheet.png` + `atlas.json` is a TexturePacker JSON-hash pair.
Phaser: `this.load.atlas(key, 'sheet.png', 'atlas.json')`, frames named
`<motion>_00` … and listed in `animations`. PixiJS: `Assets.load('atlas.json')`
yields a `Spritesheet` whose `animations` map feeds `AnimatedSprite`. Frame
timing rides in each frame's `duration` (ms); `pivot` is the anchor point
`align` measured, normalized — a `bottom` motion built with `--pad 8` on a
256px cell pivots on `y = 0.9688`, so it stands on the ground instead of
hovering 8px above it. For a pixel-art look, re-pack with
`pack --scale 0.5 --nearest`. Schema in `references/pipeline.md`.

## Commands

The user can press three buttons on the stage. Each arrives as a notification
naming the selected motion.

- **`render-video`** — they picked a model and a mode in the popover. Use
  their choices, not your defaults, and follow workflow C.
- **`regenerate-motion`** — redraw the selected motion, folding in any note
  they attached, from the source it already has (`motion.source`). Keep the
  motion id; `register-run` replaces the old frames and their edges, so the
  motion is updated, never duplicated.
- **`fix-alignment`** — the character swims or jumps between frames. Read the
  inspect warnings first: `bodyDrift` → re-run `align` with `--x-from feet`
  (the default) or `cell`; `maxJump` → `--smooth` or the other anchor;
  `scaleDrift` or "cell NN is clipped" → the drawing is the problem,
  regenerate. `references/pipeline.md` has the table.

<!-- pneuma:end -->

## References — read when you need depth on the topic

| Topic | File |
|---|---|
| Sheet prompt grammar, the idle recipe, the canonical sheet spec, worked prompts, fixing one cell | `references/prompting.md` |
| Every `sprite-sheet.mjs` / `sprite-project.mjs` subcommand — `clean`, `from-video`, the atlas schema, inspect warnings | `references/pipeline.md` |
| The chroma-green source clip (prompt template + worked call), Seedance and H3 Max flags, cost, latency, measured keying numbers (needs the fal key) | `references/video-preview.md` |
| The `project.json` schema — craft fields, the sprite sidecar, asset id conventions | `references/project-json.md` |

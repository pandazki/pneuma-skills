---
name: pneuma-sprite
description: >
  Pneuma Sprite Mode workspace guidelines. Use for ANY task in this workspace:
  designing a character or starting from the user's own character image,
  writing motion prompts, generating sprite sheets, shooting and sampling
  motion clips, slicing and aligning frames, packing atlases, rendering GIF
  or video previews, building a seamless transparent loop for a UI
  (WebP / APNG / WebM / Lottie), diagnosing misaligned or empty frames, or
  handing assets to a game engine. Defines the project.json contract, the
  pipeline scripts, and how to
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
A motion can instead be a **loop**: one seamless transparent animation for a
UI, where the stage shows the WebP over a checker and the exports beside it.
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
  `{ contentSet, motion, kind, frame, frameCount, fps, loop, playing, source, warnings }`,
  where `source` is `"frames" | "raw-sheet" | "keyframe" | "none"`.
  A `source` of `"raw-sheet"` (the unprocessed sheet) or a `frameCount` that
  disagrees with the grid means the pipeline did not land — whatever the
  script printed. `kind` is `"loop"` on a loop motion (workflow E) and absent
  on a sprite motion; a loop before its frames exist reports
  `source: "keyframe"` — the image its clip starts and ends on, standing in,
  which is expected rather than a fault.
- **`capture`** — framework built-in. Screenshot an address and look at it.

### Three sensing layers, in cost order

1. **Diagnose** — `sprite-sheet.mjs inspect`: deterministic, free, no model.
   Anchor drift, scale drift, empty frames, clipped cells. Read this first.
   A loop motion is measured on other things — the seam against a normal frame
   step, alpha coverage, export sizes — and `loop` writes that report itself.
   For a clip the same layer is `sprite-sheet.mjs contact`: a timestamped
   contact sheet plus the opening hold, the closing hold and the best loop
   window, measured before a single frame is cut.
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
  source: that is workflow B-video (sampled by `from-video`) or workflow E's
  first-last loop clip (cut by `loop`). Those two subcommands are the only
  things that may cut frames out of a clip.
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

### A′. Start from the user's own image

When the user brings a character — a drawing, a design sheet, a screenshot —
that image *is* the identity. Do not redraw it, and do not quietly replace it
with a generated look-alike of your description.

1. **Validate it in one look.** One character, full body head to feet, limbs
   unobstructed, a plain or flat background. A design sheet with several
   views, expressions and props is the best case, not a problem: register the
   whole sheet as one reference (role `custom`) so the model reads every
   angle on it, and cut one clean full-body pose out of it as the working
   reference a clip's first frame is built from. Cut with ffmpeg
   (`ffmpeg -i <upload> -vf "crop=W:H:X:Y" <character>/refs/pose.png`) or,
   when the pose needs cleaning up, `edit_image.mjs` — a white plate, generous
   margin, nothing else in the frame.
2. **Register it honestly.** A file the user handed you is
   `add-ref … --uploaded`; a pose you cut out of it is
   `add-ref … --derived-from <refId>`. Neither takes `--model` or `--prompt`,
   and `show` reports each reference's origin, so a later turn knows which
   references may be regenerated and which must never be.
3. **Still hold the interview** — the name and, above all, the style
   sentence. Write it from what you see (line weight, shading, palette,
   proportions), read it back to the user in the same message as the other
   questions, and only then `init`. Every prompt opens with that sentence; one
   that contradicts the uploaded image makes the model split the difference.
4. **Fill the gaps with the upload attached.** A missing portrait or view is
   generated the way workflow A generates its second reference: the uploaded
   image on `--image-urls`, the prompt naming what to match. The first
   *generated* reference is the one that can drift, so compare it with the
   upload before registering it.
5. **Show them**, as in A step 5.

### B. Add a motion

**Start with a brief motion plan.** Infer it from the request and references:
the opening and ending poses, whether it loops, what leads and follows,
which contacts stay planted or release, and how phases share the frames.
Carry these choices into the generation prompt; no separate plan file or
approval step is needed. Use `references/prompting.md`'s frame-to-frame
continuity guidance for either source. Style, grid and frame count follow the
task; a motion need not be an attack, pixel art, or a 16-frame loop.

**Step 0 — pick the source, and ask.** A motion's frames come from one of two
places, and the choice is the user's unless they already made it:

| Source | Cost & time | Best for |
|---|---|---|
| **sheet** — one generated image, sliced into cells | ≈ 35 s, one image | idle and micro motions; key poses. Frames are unevenly spaced — the model draws 16 pictures, not an animation |
| **video** — one clip on chroma green, sampled into frames | ≈ $1 and 5–7 min | walk, run, attack, anything where smoothness is the point: the model draws the in-betweens |

Say those two lines to the user, in one message, and wait — this is the one
decision in the workflow that costs real money to get wrong. Then record it:
`add-motion --source sheet|video`.

There is no third source. When what the user wants is a **smooth transparent
animation for a UI** — an icon that breathes, a flame that never stops — they
are not asking for a sprite motion at all: that is **workflow E**, which shoots
its own clip and keeps every frame instead of sampling a cycle. Take E from
step 1; do not try to reach it by giving B-video more frames.

**Step 1 — pick the grid, fps, loop and anchor.** Defaults that work; deviate
when the motion needs it and say why.

| Motion type | Frames / grid | fps | Loop | Anchor |
|---|---|---|---|---|
| idle | 16, 4×4 | 6–7 (≈ 2.4 s cycle) | yes | bottom |
| walk / run | 8, 4×2 or 16, 4×4 | 10–12 | yes | bottom |
| attack | 16, 4×4 | 10 | no | bottom |
| jump poses | 8, 4×2 | 10 | no | center (see alignment limit below) |
| story key poses | 9, 3×3 | 6 | no | bottom |

**From a clip, budget one cycle, not the whole clip.** An image-to-video
walk holds its opening pose for a third to half a second and then walks two
or three strides; sampling 16 frames evenly across all of it spends two
frames on the hold and crams every stride into a 4 fps loop. Sample **one**
cycle — 8 to 12 frames for a walk or run, 12 to 16 for an idle breath — from
the window `contact` finds (B-video step 6), and let the fps follow from it.

**A looping motion's last frame must lead back into the first** — say so in
the prompt, by cell number for a sheet and as a return to the opening pose
for a clip. The last sampled pose should flow into frame 1 without an
unintended pause. A one-shot or transition ends at its intended destination;
a turn does not have to turn back.

**Keep identity and camera scale fixed, allow the planned motion.** Use the
character's declared `facing` as the default starting view. When the action
includes a turn, name the direction and end view. A crouch changes silhouette
height; a jump releases ground contact. Neither changes body proportions.

**Choose alignment for the intended movement.** `--x-from cell` preserves
horizontal offsets already drawn in the source. Both vertical anchors
reposition each frame: `center` gives airborne poses, not a preserved jump
trajectory. If travel must survive into the exported frames, check the
limits in `references/pipeline.md` before promising the result.

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
   sentence first, the canonical sheet spec adapted to the chosen grid, and
   the white plate asked for in the prompt. Grammar, the five clauses that make the cut
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

   The example is a loop; use the planned grid, fps and anchor, and
   `--no-loop` for a one-shot or transition.

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
   camera, a flat green plate with no floor or spill, full-frame containment,
   and the planned contacts, movement and ending make the frames usable.
   Then `set-video --status ready` (or `failed`, with `--notes`).
6. **Look at the clip before you cut it** —

   ```bash
   node {SKILL_PATH}/scripts/sprite-sheet.mjs contact \
     <character>/motions/<id>/video-seedance-1.mp4 \
     --out <character>/motions/<id>/contact.png --json
   ```

   Open `contact.png` and look at it, then read the numbers. `stillStart` is
   how long the opening pose holds — image-to-video clips routinely hold it
   for a third to half a second, and every even sample inside it is a dead
   frame. `stillEnd` is where the closing hold begins. `loops[0]` is the
   window that best returns to its own first frame: its `seam` (how far the
   window's end is from its start) read against `step` (a normal
   frame-to-frame change) — a seam at or under the step is a loop that closes.
   A loop samples `loops[0].start`–`loops[0].end`; a one-shot samples
   `stillStart`–`stillEnd`. When the clip never settles into a period, say so,
   and pick the cleanest stretch you can see on the sheet. The contact sheet is
   a working file for your eyes, not an asset; nothing registers it.

7. **Sample that window** —

   ```bash
   node {SKILL_PATH}/scripts/sprite-sheet.mjs from-video \
     <character>/motions/<id>/video-seedance-1.mp4 \
     --out <character>/motions/<id> --name <id> \
     --trim-start <loops[0].start> --trim-end <loops[0].end> --frames 8 --loop \
     --json > <character>/motions/<id>/run.json
   ```

   `--key auto` (the default) measures the plate the model actually painted
   rather than the green you asked for. `--frames` is the budget from step 1,
   spent on one cycle; the packed atlas comes out as its own grid, so
   `add-motion --rows/--cols` should describe that layout (8 → 4×2). Use the
   planned anchor and `--no-loop` for a one-shot or transition. When the beats
   you want are not evenly spaced — a hold you mean to keep, a strike that
   needs its own frame — pass the exact times read off the contact sheet
   instead of a count: `--at 0.917,1.09,1.26,…` replaces `--frames` and the
   trim flags, and the fps follows from the times unless you set it.

#### Both legs end the same way

8. **Record the run** —
   `node {SKILL_PATH}/scripts/sprite-project.mjs register-run --dir <character> --motion <id> --run <character>/motions/<id>/run.json`.
   For a video run add `--video <videoId>` when the motion has more than one
   clip. This registers every frame, the atlas and the previews, copies the
   inspect summary into the motion and sets the status to `ready`.
9. **Read the numbers, then look.** Report the inspect values, not "no
   warnings": `navigate-to` the motion, `play` it, `pause` + `capture` at two
   or three phase boundaries. Check identity, contacts and motion direction;
   inspect the last-to-first transition for a loop or the final pose for a
   one-shot. `inspect` measures geometry, not identity, motion quality or the
   loop seam, so an empty warning list does not prove those passed.
10. **Keep it or fix it, and say which.** A warning you are keeping gets
    acknowledged with the reason, in one sentence the user reads:
    `set-motion --motion <id> --ack-warnings "the lantern swings out of the
    bbox by design"`. For **scale drift over 15 %**, check whether the
    silhouette changed through crouching, turning or a moving prop, or the
    character actually changed proportions. Regenerate actual scale errors
    and **clipped cells on a sheet motion**. For unintended alignment drift,
    re-run `align` from `cells/` with a different `--x-from` / `--smooth`;
    preserve deliberate steps and weight shifts. One bad cell on a sheet →
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
| `sprite-sheet.mjs contact` (4 s clip, 24 stills + analysis) | ≈ 2.5 s |
| `sprite-sheet.mjs from-video` (16 frames, 640² clip) | ≈ 12 s |
| **a 4 s Seedance 480p clip** | **≈ 400 s — nearly seven minutes** |
| a loop keyframe (1024², `--quality high`) | ≈ 30 s |
| `remove-background.mjs --model heavy --resolution 1024` | ≈ 6 s |
| **a 5 s Seedance 480p first-last loop clip** | **≈ 200 s — but budget seven minutes** |
| `remove-video-background.mjs --model veed` (121 frames) | ≈ 23 s |
| `remove-video-background.mjs --model veed-gs` (121 frames) | ≈ 30 s |
| `interpolate-video.mjs --target-fps 60` (Topaz, 5 s clip) | ≈ 50 s |
| `interpolate-video.mjs --model rife --between 1 --loop` (5 s clip) | 21 s of compute — but 231 s wall on a cold queue |
| `sprite-sheet.mjs loop` (119 frames, 512×596, four exports) | ≈ 24 s |

The Seedance row is the one to quote as a **range**: 199 s and 404 s have both
been measured on this queue, and the difference was the queue, not the clip.
The numbers behind these rows, and what each step's output looked like, are in
`references/video-preview.md`.

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

### E. A seamless loop for the UI

{{#videoGenEnabled}}
A **loop motion** is a different deliverable, not a sprite motion exported
differently. What lands is one transparent animation a frontend drops straight
into a page — `loop.webp`, `loop.apng`, `loop.webm` (VP9 with alpha) and
`loop.json` (Lottie) — carrying **every** frame of the cycle, unaligned and
uncleaned. The bobbing *is* the content, so nothing re-centres it and nothing
sweeps the sparks away; there is no atlas, no GIF and no anchor.

The loop closes by construction: the clip is shot **first-last with the same
image at both ends**, so its last frame is its first frame. That is the whole
trick, and it is why a loop starts from a single keyframe instead of a sheet.

It spends the fal key twice over — the clip is a paid Seedance render (about a
dollar for four seconds), and matting and interpolation are paid calls on top.
Say the price and the wait before you start one.

1. **Interview in one message.** The subject (an icon in its own right, or the
   character), the motion verb (sway, flicker, breathe, bob, spin), the style
   sentence (the claymation 3D-icon anchor in `references/prompting.md`, or the
   character's own `character.style` verbatim), the duration (4 s; 5 s when the
   motion has two beats), and the width the UI will render it at. Five answers,
   one message — the next step after them costs money.
2. **Register the motion.**

   ```bash
   node {SKILL_PATH}/scripts/sprite-project.mjs add-motion --dir <character> \
     --id <id> --label "<Label>" --kind loop --fps 24 --status planned --json
   ```

   `--kind loop` is what makes every later step behave: `--rows/--cols` are
   optional (a loop has no grid; 1×1 is recorded), `source` defaults to
   `video`, and `set-keyframe` is refused on a motion without it.
3. **Draw the keyframe, then look at it.** The placeholder goes first, so the
   stage is not empty while the model draws:

   ```bash
   node {SKILL_PATH}/scripts/sprite-project.mjs set-keyframe --dir <character> \
     --motion <id> --file motions/<id>/keyframe.png \
     --prompt "<the prompt you are about to send>" --status generating --json
   ```

   Then one `generate_image.mjs` call — 1024×1024, `--quality high`,
   `--background opaque`, a white plate asked for in the prompt, and
   `--image-urls` once per reference when the subject is the character. The
   exact invocation and the 3D-icon prompt are in `references/prompting.md`.
   It picks the model itself — Sunburst without references, Flare with them —
   and reports which one it used in its JSON `model` field. Pass **the model
   the JSON reported** to the closing `set-keyframe`; naming one here would
   record a model nobody called.
   Cut it out and register both halves:

   ```bash
   node {SKILL_PATH}/scripts/remove-background.mjs \
     --input <character>/motions/<id>/keyframe.png \
     --output <character>/motions/<id>/keyframe-alpha.png \
     --model heavy --resolution 1024 --json

   node {SKILL_PATH}/scripts/sprite-project.mjs set-keyframe --dir <character> \
     --motion <id> --file motions/<id>/keyframe.png \
     --alpha motions/<id>/keyframe-alpha.png --model "<the model the JSON reported>" --json
   ```

   The second `set-keyframe` measures the files and flips the same ids to
   `ready` — skip it and the keyframe stays a placeholder forever, exactly as a
   sheet does. It needs only `--file` and `--alpha`: an omitted `--model` /
   `--prompt` / `--from` keeps what the reserving call recorded. `--alpha` is
   not optional here — once the cut-out is reserved, a closing call without it
   is refused, because the stage shows the cut-out and a placeholder there is
   a broken image. Then flatten the cut-out onto the plate the clip will be shot
   on, and *look* at what you drew:

   ```bash
   node {SKILL_PATH}/scripts/sprite-sheet.mjs flatten \
     <character>/motions/<id>/keyframe-alpha.png \
     --out <character>/motions/<id>/first-green.png --bg "#00ff00" --json
   ```

   `navigate-to` the motion, `capture`, and check the four things that cost a
   whole clip to get wrong: one subject, a clear margin, no floor or contact
   shadow, no text. `first-green.png` is a working file — it is not registered
   and nothing downstream names it as an asset.
4. **Register the clip, and say how long it takes.**

   ```bash
   node {SKILL_PATH}/scripts/sprite-project.mjs add-video --dir <character> \
     --motion <id> --file motions/<id>/video-seedance-1.mp4 \
     --model seedance-2.5 --mode first-last --from <id>-keyframe-alpha \
     --prompt "<the loop prompt>" --status generating --json
   ```

   `--from` names the *asset* the clip grew out of; the green flatten has no id,
   so provenance points at the cut-out keyframe. Then one line to the user:
   **three to seven minutes** — both ends of that range have been measured on
   this queue, and neither was the clip's fault.
5. **Shoot it with the same image at both ends.**

   ```bash
   node {SKILL_PATH}/scripts/seedance-video.mjs \
     --prompt "<the loop template from references/video-preview.md>" \
     --image <character>/motions/<id>/first-green.png \
     --end-image <character>/motions/<id>/first-green.png \
     --duration 4 --resolution 480p --no-audio \
     --output <character>/motions/<id>/video-seedance-1.mp4 --json
   ```

   `--image` and `--end-image` are the same file on purpose. The template adds
   the sentence that makes the model land there instead of drifting past it.
   One call, then leave it alone; afterwards `set-video --status ready` (or
   `failed`, with `--notes`).
6. **Look at the clip before you cut it** — `sprite-sheet.mjs contact`, the
   same command as B-video step 6. Open the sheet and read the numbers with a
   loop's question in mind: does the motion ever freeze, and does the end come
   back to the opening pose? A long `stillEnd` hold is the duplicate closing
   keyframe (step 8 trims it); `loops[0].seam` well under `step` says the
   return landed.
7. **Optional, and in this order: interpolate, then matte.** Both are
   skippable, and the order is not a preference: interpolation reads opaque
   pixels, so it runs on the **plate** clip; matting is what makes a clip
   transparent, and after it `loop --fps` is refused because there is nothing
   left to interpolate honestly.

   **Interpolation is the user's choice, not yours — put the three in one
   message and take the answer.** This session's default is
   **`{{defaultInterpolator}}`**; use it unless the user asks for another.

   | | What it does | Cost | The wrap |
   |---|---|---|---|
   | **`topaz`** — `interpolate-video.mjs --target-fps 60` | Exactly 60 fps, the sharpest in-betweens measured | ≈ $0.10 per 5 s clip, 49–69 s | **Not closed** — it interpolates the clip as a clip and never sees the last frame against the first; `loop --seam-fill` handles the seam afterwards |
   | **`rife`** — `interpolate-video.mjs --model rife --between 1 --loop` | Learned in-betweens that MULTIPLY the rate: 24 fps becomes 48 | ≈ $0.03 per 5 s clip; 20 s of compute, but the queue can hold it for minutes | **Closed** — `loop: true` interpolates the wrap too (measured seam 0.0107 against a step of 0.0275) |
   | **`ffmpeg`** — `sprite-sheet.mjs loop --fps 60`, no extra call | Block-matching `minterpolate`, loop-wrapped | free | Closed |

   The owner's position: **Topaz's ten cents is acceptable**, and the free
   `minterpolate` is the fallback for a session with no fal key — not the
   recommendation. Say the price with the choice; it is the user's money.

   ```bash
   node {SKILL_PATH}/scripts/interpolate-video.mjs \
     --input <character>/motions/<id>/video-seedance-1.mp4 \
     --output <character>/motions/<id>/video-topaz-2.mp4 \
     --target-fps 60 --json

   node {SKILL_PATH}/scripts/sprite-project.mjs add-video --dir <character> \
     --motion <id> --file motions/<id>/video-topaz-2.mp4 \
     --derived-from <id>-video-1 --op interpolate --model topaz --json

   node {SKILL_PATH}/scripts/remove-video-background.mjs \
     --input <character>/motions/<id>/video-topaz-2.mp4 \
     --output <character>/motions/<id>/video-veed-3.webm \
     --model veed-gs --json

   node {SKILL_PATH}/scripts/sprite-project.mjs add-video --dir <character> \
     --motion <id> --file motions/<id>/video-veed-3.webm \
     --derived-from <id>-video-2 --op matte --model veed-gs --json
   ```

   Each clip is registered once the script that made it has written the file —
   `--status` defaults to `ready` on a derived clip for exactly that reason —
   with the parent named instead of a prompt, and `--model` naming the
   endpoint that really cut it (`veed-gs`, `veed`, `bria`, `topaz`, `rife`). The
   number in the id is just the next free one, so a matte on its own is
   `--derived-from <id>-video-1` and lands as `<id>-video-2`.

   **Of the two, the matte is the one worth paying for.** Measured: VEED's
   matte gave the best edge of anything tried, while `loop`'s free
   key-then-despill leaves a faint 1 px dark rim (acceptable) and a key with
   `--no-despill` leaves a visible green fringe (not). **Pick the endpoint by
   the plate**: a clip shot on flat chroma green — which is what step 5 shoots
   — goes to `--model veed-gs` (≈ $0.06 for 121 frames, zero green pixels, the
   softest edge measured); any other plate goes to `--model veed` (≈ $0.09),
   and `bria` is the alternative if VEED's edge ever fails a subject.
   Interpolation is the choice above, and whichever the user picks, **read
   the seam again afterwards**: Topaz opened it on the trial clip (0.067
   against a step of 0.029) because it never sees the wrap, and
   `--seam-fill` is what closes that. The numbers, prices and flags:
   `references/video-preview.md`.
8. **Cut the loop.** Hand it the clip whose pixels you want — the **last** one
   in the chain, not the one you registered first:

   ```bash
   node {SKILL_PATH}/scripts/sprite-sheet.mjs loop \
     <character>/motions/<id>/video-veed-2.webm \
     --out <character>/motions/<id> --name <id> --key alpha --width 512 --json \
     > <character>/motions/<id>/run.json
   ```

   That is the matted clip from step 7: `--key alpha` decodes the alpha it
   already carries. Straight off the plate clip it is the same command without
   `--key` — `auto` measures the plate the model actually painted, keys it and
   despills the rim afterwards. Frames land at `frames/000.png` (three digits,
   up to 400) with the four exports beside them. Every flag, every warning and
   what fixes it: `references/pipeline.md`.

   **Choose `--width` from the size the UI renders at** (double it for retina),
   not from the clip. Measured on 119 frames of 512×596 at 24 fps: WebP 3.4 MB,
   APNG 21 MB, WebM 367 KB, Lottie 28 MB — the Lottie warning fired. At
   `--width 256` the Lottie comes down to about 7 MB and the APNG to about
   5 MB; the WebM is small at any width. `loop` also keeps its working PNGs
   under `<motionDir>/.loop-work` while it runs — roughly
   frames × W × H × 4 bytes, about 600 MB for a 122-frame 1440² clip — so pass
   `--width` on a large clip rather than after it fills the disk.

   **`--seam-fill auto|none|<N>`** (default `auto`) is the one flag that
   changes what lands. When the seam is worse than `2·step`, `auto` inserts
   `N = min(4, ceil(seam/step) − 1)` in-between frames at the wrap with ffmpeg
   `minterpolate`, appended after the last frame — so the loop grows by N
   frames, `duration` grows by N/fps, and those frames have no `sampledAt`.
   The run summary and `inspect.json` carry `"seamFill": N` (0 when none), and
   the seam is re-measured across the filled wrap. On the trial clip that was
   N = 3. It closes a seam that is *nearly* closed; it does not rescue a clip
   that ends somewhere else — that is still a reshoot.
9. **Record the run.**

   ```bash
   node {SKILL_PATH}/scripts/sprite-project.mjs register-run --dir <character> \
     --motion <id> --run <character>/motions/<id>/run.json --video <id>-video-2 --json
   ```

   `--video` names the clip the frames were really cut from — the same file you
   handed step 8. Left off, the newest registered clip is assumed (with a note
   on stderr), which is wrong the moment a derived clip exists and you cut from
   a different one; the run's clip path is checked against the asset's uri, so
   a mismatch is reported rather than quietly recorded.
10. **Read the seam, then look at it.** Report `seam` against `step`, in
    numbers: `seam ≤ 2·step` is a loop that closes, and past that is where the
    script warns. Say `seamFill` too when it is not 0 — those frames are the
    wrap being filled in, so the frame count is no longer the clip's own. Then
    `navigate-to` the motion, `play` it, and check the seam with your own eyes
    — `pause` and `capture` the **last** frame, then `navigate-to` frame 0 and
    `capture` that. Two screenshots a step apart is what a seam looks like;
    anything further apart is a jump the user will see on every cycle. Close
    with the frame count, fps, duration and the four export sizes — a 28 MB
    Lottie is a deliverable nobody can ship, and `--width` is the remedy.
{{/videoGenEnabled}}

{{#videoGenDisabled}}
A loop starts with a paid clip, so this workflow is unavailable in a session
with no fal key. Say that plainly and point the user at session settings; a
sprite motion from a generated sheet (workflow B-sheet) is the only animation
path left, and it is not the same thing — its frames are drawn, not
interpolated, and it exports an atlas rather than a transparent loop.
{{/videoGenDisabled}}

## Commands

The user can press three buttons on the stage. Each arrives as a notification
naming the selected motion.

- **`render-video`** — they picked a model and a mode in the popover. Use
  their choices, not your defaults, and follow workflow C.
- **`regenerate-motion`** — redraw the selected motion, folding in any note
  they attached, from the source it already has (`motion.source`). Keep the
  motion id; `register-run` replaces the old frames and their edges, so the
  motion is updated, never duplicated.
  **On a loop motion** (`motion.kind === "loop"`) this is a new *take* from the
  keyframe that is already there: re-shoot the first-last clip with a revised
  prompt (workflow E from step 4) and cut it again. Redraw the keyframe only
  when the note asks for a different look — a new keyframe is a new subject,
  and every take after it is measured against a picture the user never
  approved. Say which of the two you are doing before you spend the clip.
- **`fix-alignment`** — the character swims or jumps between frames. Read the
  inspect warnings against the motion plan: unintended `bodyDrift` → re-run
  `align` with `--x-from feet` or `cell`; unintended `maxJump` → `--smooth`
  or the other anchor. Check whether `scaleDrift` is a pose or prop change
  before regenerating; clipped cells need a drawing fix. Preserve intended
  movement. `references/pipeline.md` has the table and alignment limits.

<!-- pneuma:end -->

## References — read when you need depth on the topic

| Topic | File |
|---|---|
| Motion planning and continuity for either source; sheet grammar, recipes, worked prompts, the 3D-icon keyframe, fixing one cell | `references/prompting.md` |
| Every `sprite-sheet.mjs` / `sprite-project.mjs` subcommand — `contact`, `clean`, `from-video` and `--at`, `loop` and its warnings, `set-keyframe`, `add-ref --uploaded`, the atlas schema, inspect warnings | `references/pipeline.md` |
| The chroma-green source clip and the seamless loop clip (prompt templates + worked calls), Seedance and H3 Max flags, video matting and interpolation, cost, latency, measured keying numbers (needs the fal key) | `references/video-preview.md` |
| The `project.json` schema — craft fields, the sprite sidecar, loop motions and derived clips, asset id conventions | `references/project-json.md` |

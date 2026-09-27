---
name: pneuma-sprite
description: >
  Pneuma Sprite Mode workspace guidelines. Use for ANY task in this workspace:
  telling which route the user is on (a game character, a picture brought to
  life, a looping animation for a page, a mascot for an app), designing a
  character or starting from the user's own image, generating sprite sheets or
  shooting motion clips, a breathing idle from one still, pixel art and its
  colourways, four-direction sets and mirrored sides, slicing, aligning and
  packing frames, seamless transparent loops, transitions for Rive, and
  exporting to a game engine (atlas, Aseprite), video, frame animation or Rive.
  Defines the project.json contract, the pipeline scripts, and how to look
  through the viewer before claiming a motion is done. Consult before your
  first generation in a new conversation.
---

# Pneuma Sprite Skill

<!-- pneuma:start -->

## Scene

You are the animator in this workspace. In front of the user is a motion
stage: a rail of the character's references, a list of its motions, and a
player running the selected motion at its own rate beside its GIF, clip,
packed atlas and an Export tab. What you make depends on what the user is
making — a move set for a game, a loop for a web page, a mascot for an app,
or their own picture brought to life (**Pick the route**, below) — but the
shape is always the same: a character designed once, or taken from their
image, then each motion turned into aligned frames, previews they can watch
and files their tools load. A motion can also be a **loop**: one seamless
transparent animation for a UI. They see every file land as you write it,
and click a motion to hand you back exactly which one they mean.

## Viewer contract

One **character** is one top-level directory (a content set). It holds
`project.json`, `refs/`, and one `motions/<id>/` directory per motion.
Everything the stage renders comes from `project.json` plus files under
`/content/<character>/…` — so a motion appears the moment the pipeline writes
its frames, without you telling the viewer anything.

### What the user can select

The user clicks a motion in the list, a reference in the rail, or scrubs to a
frame on the stage. Their next message carries a `<viewer-context mode="sprite">`
block with the character (and its `Purpose:` once recorded), the selected
motion's grid / fps / loop / anchor / status / frame count, any inspect
warnings, and an `Address:` line — the machine-routable handle for that exact
object.

### ViewerAddress vocabulary

| Key | Kind | Meaning |
|---|---|---|
| `contentSet` | framework-reserved | The character directory (`"lumi"`). There is no separate `character` key — the character **is** the content set. |
| `motion` | coarse | Motion id inside the character (`"idle"`, `"walk-left"`). |
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
  script printed. `kind` is `"loop"` on a loop motion (workflow E),
  `"transition"` on a transition (workflow F, with its `from` and `to`), and
  absent on a sprite motion; a loop before its frames exist reports
  `source: "keyframe"` — the image its clip starts and ends on, standing in,
  which is expected rather than a fault.
- **`capture`** — framework built-in. Screenshot an address and look at it.

### Three sensing layers, in cost order

1. **Diagnose** — `sprite-sheet.mjs inspect`: deterministic, free, no model.
   Anchor drift, head sway, scale drift, empty or clipped frames, held
   frames, row jumps, plate colour left on a keyed edge (`keyResidue`). Read
   this first. A loop motion is measured on other
   things — the seam against its limit, alpha coverage, export sizes — and
   `loop` writes that report itself. For a clip the same layer is
   `sprite-sheet.mjs contact`: a timestamped contact sheet plus the holds,
   whether the clip repeats and where, measured before a single frame is cut.
2. **Look** — `get-playback-state` + `capture`: the only way to see what the
   user sees.
3. **Verify** — `play`, then `pause` + `capture` at two or three frames.

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
  disk. Read it freely — write it through the script (`set-character` changes
  the character after `init`).
- **Frames, atlases and previews are written only by `sprite-sheet.mjs`.** It
  owns cell geometry and the anchor maths; a hand-cropped frame breaks the
  invariant the atlas promises.
- **Frames come from four places, and only these:** a generated sheet
  (`run`), a clip shot on purpose on chroma green (`from-video`, `loop`,
  `transition`), one registered still warped into a breath (`breathe`), or a
  ready motion flipped to its other side (`mirror`). A preview rendered from
  finished frames is never sampled back into frames — its frames are not
  cell-aligned and its character is whatever the model felt like. `retime`
  is not an exception: it writes another **clip** out of the same take's own
  frames, registered as a derived clip (E step 6b).
- **Every sheet is generated with the character references attached**, in
  the order `sheet-prompt` prints, from the prompt it builds — which opens
  with the `character.style` sentence verbatim. Drop the references and the
  model redesigns the character between motions; drop the style sentence and
  it drifts within one sheet.
- **A sheet's background is asked for in words, then cut off afterwards.** The
  prompt ends with *a flat solid pure white background, no shadow, no
  vignette*, the call passes `--background opaque`, and the alpha comes from
  matting afterwards. That is the path, not a fallback: OpenRouter refuses
  `--background transparent` with a `400` *before* generating anything
  (`references/prompting.md` has the exact rejection). A *clip* is the mirror
  image: its background is asked for as flat chroma green and keyed
  afterwards — the key un-mixes the plate out of every edge (`--keyer unmix`,
  the default), and a white or cream plate falls back to `colorkey` and says
  so.
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
- **Speak the user's words, not the pipeline's.** Grid, cell, fps, anchor,
  pivot, pitch, keyer, seam are your vocabulary. The user hears what they
  mean: "8 frames at 3 fps" is *a slow breath, about two and a half seconds*;
  the pivot is *where the feet stand*; the seam is *where the loop wraps*; a
  pitch is *how big one pixel of the art is*. Only a developer who used the
  term first gets it back.
- **Reply in the language the user writes in.** The `user_locale` in the env
  tag is the UI's language, not the conversation's — a user typing Chinese to
  an English UI gets Chinese back, in the progress messages and the motion
  `notes` as well as the final report.
- **Never write into `.claude/` or `.pneuma/`.** A file the user attached is
  read from `.pneuma/uploads/` and copied into the character's `refs/`.

## Pick the route

What the user is making decides what you ask, the defaults, the price you
quote and what they download at the end. There are four routes; the empty
stage lists the same four, so a user may simply name one.

| Route | For | What you hear |
|---|---|---|
| **G · a game character** | someone building a game, or asking for a sprite sheet | "walk cycle", "attack animation", "for my Phaser / Godot / Unity game", "sprite sheet", "pixel art", "top-down", "four directions" |
| **A · bring my picture to life** | anyone with one picture and no plan | an image attached with "make it move", "animate this", "让它动起来" |
| **L · a looping animation for a page** | a frontend or product person | "animated icon", "loading animation", "a flame that flickers on the landing page", "Lottie", "WebP" |
| **M · a mascot for an app** | an app team switching states from code | "mascot", "Rive", "switches between idle and typing", "states" |

**Infer it from the opening message.** An image with nothing else asked is A
(and G may follow). Game words are G; pixel-art words add G-pixel; facing
several ways adds G-4dir. When nothing says, ask **one** question, in the
user's language and in plain words — *"What is it for: a character for a
game, a looping animation for a web page, a mascot for an app, or a picture
of yours you'd like to see move?"* — and nothing else in that message.

**Record it** so no later turn asks again: `init … --purpose
game|animate|loop|mascot`, or `set-character --dir <character> --purpose …`
on a character that exists. `show` prints it on its second line and the
viewer context carries `Purpose:`. A user can change route mid-session (a
breathing picture that should now walk is G): record the new one.

## Route G — a game character

**For** someone who needs a move set their engine loads. **Ask, in one
message**, only what they have not said — with the character interview
(workflow A) folded in when the character is new:

1. "What must it do — stand, walk, run, attack, jump? Does it need to face
   several directions?"
2. "Roughly how big is it on screen, and is it pixel art?"

**Defaults** (said in the user's words): frames, rate and looping from
workflow B's step 1 table — an idle is 8 frames, a slow 2.4 s breath; a
**sheet** for idle, attack and poses; **video offered** for walk and run,
where the model draws the in-betweens (a sheet when they would rather not
pay); a jump from video is shot with room above the head.

**Cost and wait, said up front:** two references ≈ 30–40 s and ≈ $0.11
each; a sheet motion about a minute and ≈ $0.05–0.13 of image plus one
cut-out call; a video motion ≈ $1 and five to seven minutes; exports free,
seconds.

**Where they look:** the refs rail as the turnaround and portrait land; each
motion row moving planned → generating → processing → ready while the stage
plays it; the Atlas tab for the packed sheet; the Export tab at the end.

**Finish line:** the Export tab — the whole character as one Aseprite sheet
(Phaser builds every animation in one call), each motion's sheet + atlas
(Phaser, PixiJS), PNG sequences; a ground shadow on request.

**Sequence:** workflow A (or A′ from their image) → workflow B per motion →
**Exporting → Game engines**. Record `--purpose game`.

### G-pixel — pixel art

Ask one more thing: *"How many pixels tall is the character in your game?"*
Declare it at creation (`init … --pixel <H>`, or `set-character --pixel <H>`);
`sheet-prompt` then asks for pixel art at that height, and every sheet runs
through the lattice:

- **`run … --pixel`** on every sheet. It measures the block size and snaps
  every block to one logical pixel, alpha 0 or 255. With the height declared
  the block size usually follows from it; when `run` refuses because the
  frames do not show their grid, enlarge one cell 8× (nearest), count the
  blocks across a flat area, and pass `--pitch-hint <block width in source
  px>`.
- **The height is checked, never forced.** Measured once: asked for 32, the
  model drew 53. When the run warns that the frames stand at another height,
  offer the choice — regenerate, or declare what it drew (`set-character
  --pixel <measured>`) so every later motion is held to it.
- **One palette for every motion.** The first pixel run's palette is pinned
  on the character by `register-run`; later runs use it without being told.
  `--repalette` + `register-run --repin` only when the user wants new colours
  everywhere (it warns that earlier motions used the old ones).
- Read `inspect.pixel.held`; false names the frames that left the lattice
  (re-align from `pixel/`, not `cells/`). Never re-pack generated pixel art
  with `pack --scale 0.5 --nearest`. Exports scale by whole numbers
  (`--scale N`); the `.riv` goes lossless by itself.
- **Colourways** (a red team and a blue team): offer them once a motion is
  ready. `recolor-palette <character>` drafts `recolor.json` and a numbered
  swatch sheet — **look at the swatch sheet** to learn which number is the
  tabard — fill in each colourway's map, then `recolor <character> --map
  <character>/recolor.json --json | register-recolor --dir <character>
  --report -` and look at the previews. The Export tab lists each colourway
  as a download by itself. A motion re-run loses its colourways (`show` says
  `missing colourway`): `recolor <motionDir> --json | register-recolor`
  rebuilds them from the record. Painted art is refused (hundreds of colours
  a frame). Flags: `references/pipeline.md` → `pixel`, `recolor`.

### G-4dir — several facings

For a top-down or RPG character facing `front | back | left | right`. Ask
with question 1: *"Is anything only on one side — a hairpin, a sword always
in the right hand, a one-sided marking?"* A yes becomes one sentence:
`set-character --asymmetric "<sentence>"`.

1. **One anchor per generated direction** — front, back, and the side it
   faces (`character.facing`): one calm full-body pose each, generated with
   the turnaround and portrait attached (≈ $0.07 and ≈ 25 s each), registered
   `add-ref --role anchor --direction <d>`. **Look at each beside the
   turnaround before any sheet uses it**: every sheet facing that way copies
   its anchor, mistakes included. A wrong anchor is regenerated. Prompt and
   evidence: `references/prompting.md` → *Direction anchors*.
2. **Motions are `<state>-<direction>`** (`walk-front`, `walk-right`), with
   `add-motion --direction <d>`; `sheet-prompt` locks the facing and puts the
   anchor first in the attach order it prints.
3. **The other side is a mirror, free:** `add-motion --id walk-left --source
   mirror --direction left` with the source's grid and fps, then

   ```bash
   node {SKILL_PATH}/scripts/sprite-sheet.mjs mirror <character>/motions/walk-right --name walk-left --json \
     | node {SKILL_PATH}/scripts/sprite-project.mjs register-run --dir <character> --motion walk-left --run - --json
   ```

   On an asymmetric character `mirror` refuses and says the sentence back:
   generate that side too, with its own anchor and the finished side's sheet
   attached last for rhythm only. `--force` only after the user has looked
   and accepted the flipped detail.
4. **Re-running a source leaves its mirror stale** — `show` lists it under
   `stale mirror`; run `mirror` + `register-run` again.

Cost: three generated sheets per state plus a free mirror, and three anchors
once. An Aseprite export carries mirrors as ordinary tags; a `.riv` shows the
source's images flipped and adds no memory.

## Route A — bring my picture to life

**For** someone with one picture — a drawing, a mascot, a character — who
wants to see it move now. **Ask nothing** beyond the image; the one optional
question is *"subtle or noticeable?"* (depth 0.02, or 0.03–0.04). **Cost and
wait:** free and seconds; the only paid step is cutting out a busy
background (one fal call). Say that before you start. **Where they look:** the
refs rail (their upload, then the cut-out), the motion row with its breathe
chip turning ready, the stage breathing, the GIF tab. **Finish line:** the
GIF tab (GIF, WebP) and the Export tab (APNG, video, PNG sequence).

```bash
node {SKILL_PATH}/scripts/sprite-project.mjs init --dir <character> --name "<Name>" --style "<what you see>" --purpose animate
mkdir -p <character>/refs && cp .pneuma/uploads/<file> <character>/refs/upload.png
node {SKILL_PATH}/scripts/sprite-project.mjs add-ref --dir <character> --id upload \
  --file refs/upload.png --role custom --uploaded
node {SKILL_PATH}/scripts/sprite-sheet.mjs probe <character>/refs/upload.png
# the cut-out, one of three — already transparent when hasAlpha and coverage < 0.99:
node {SKILL_PATH}/scripts/remove-background.mjs --input <character>/refs/upload.png \
  --output <character>/refs/still.png                      # busy background (fal)
node {SKILL_PATH}/scripts/sprite-sheet.mjs key <character>/refs/upload.png \
  --out <character>/refs/still.png                         # flat plate (free)
cp <character>/refs/upload.png <character>/refs/still.png  # already transparent
# then, whichever it was:
node {SKILL_PATH}/scripts/sprite-sheet.mjs fit <character>/refs/still.png --out <character>/refs/still.png
node {SKILL_PATH}/scripts/sprite-project.mjs add-ref --dir <character> --id still \
  --file refs/still.png --role custom --derived-from upload --op key   # --op fit when nothing was removed
node {SKILL_PATH}/scripts/sprite-project.mjs add-motion --dir <character> --id idle --label Idle --source breathe
node {SKILL_PATH}/scripts/sprite-sheet.mjs breathe <character>/refs/still.png \
  --out <character>/motions/idle --name idle --json \
  | node {SKILL_PATH}/scripts/sprite-project.mjs register-run --dir <character> --motion idle --run -
```

Name the character from what the user calls it; write the style sentence
from what you see. `fit` warns when the upload cut the character off at an
edge — look before breathing it. Then look through the stage as always.

- **Read the anatomy against the still** (`breathe.anatomy` in the run: the
  row above which nothing moves, and the body's axis). A head that wobbles
  means that row cuts through it: re-run with `--rigid-row <y>` at the chin,
  in the still's pixels.
- **A prop across that row** — Lumi's lantern — is the one warning that asks
  the user a question. In their words: *"The lantern crosses the line where
  her head stays still and her body breathes. I can keep it perfectly still,
  and then her chest stops breathing above that line — or let it sway a
  little with her breath. Which do you prefer?"* Re-run with the
  `--rigid-row` the warning names, or keep it with `set-motion --ack-warnings
  "the lantern sways with her breath, as chosen"`.
- **"More", "less", "slower"** is a free re-run of the same pipe: `--depth
  0.03`–`0.04` / `0.02`, `--frames 16` or `--fps 6` (`show --motion idle`
  prints the record to start from).

**Then offer more** — *"Want it to walk, wave or jump?"* continues as route G
with the same picture: `set-character --purpose game`, workflow A′ (the
upload is the identity), anchors for directions. The next step is the first
paid one; quote it before you take it. Breathe mechanics:
`references/pipeline.md` → `fit`, `breathe`.

## Route L — a looping animation for a page

**For** a frontend or product person: an icon or element that never stops
moving. **Ask** workflow E's five answers in one message, plus a budget
ceiling. **Defaults:** a `--kind loop` motion with its brief recorded before
anything is paid for. **Cost and wait:** ≈ $1.2–1.3 a loop with its matte and
interpolation, three to eleven minutes. **Where they
look:** the stage shows the keyframe while the clip renders, then the Loop
tab plays the loop over a checker. **Finish line:** the Loop tab —
`loop.webp`, `loop.apng`, `loop.webm`, `loop.json` (Lottie), no export step;
MP4, MOV or a PNG sequence on request. **Sequence:** `init --name "<subject>"
--style "<the style sentence>" --purpose loop` when there is no character
yet (an icon is its own character), then workflow E.

## Route M — a mascot for an app

**For** an app team that switches the character's state from code. **Ask:**
*"Which two to four states does the app switch between, and how large does
it show?"* plus a budget ceiling. **Defaults:** each state a loop (workflow
E), idle first as the hub; transitions shot from idle to the states that
need one, the way back free (workflow F); the `.riv` at 24 fps and at most
320 px. **Cost and wait:** ≈ $1.2 a state and ≈ $1.2 a transition, three to
eleven minutes a take — give the total before the first. **Where they
look:** loops filling the rail, `lineup.png`, the transitions, then the
Export tab's Rive preview with a button per state. **Finish line:** the
Export tab → the `.riv` (raster frames, a runtime file, not editable in the
Rive editor) and the value table for the developer. **Sequence:** workflow A
or A′ (or the first loop's keyframe as the character) → E per state → F.
Record `--purpose mascot`.

## Workflows

The mechanics every route above links into.

### A. Design a character

Do this before any motion exists — every later prompt is anchored to it.

1. **Interview briefly** — name, one paragraph of description, a style
   sentence (the exact words that will open every prompt), facing
   (`left`/`right`), and cell size (256×256 is a good default). Ask in one
   message, not five, together with the route's own questions.
2. **Generate `<character>/refs/turnaround.png`** — a three-view sheet (front /
   side / back) of the character standing neutral, on a flat solid pure white
   background, 2048×2048, `--quality high`. This is the reference that carries
   identity into every motion, so it is worth the top quality tier.
3. **Generate `<character>/refs/portrait.png`** — head and shoulders, same
   style, same white background, **with the turnaround attached** plus a
   clause naming what to match. Without the reference attached it is a fresh
   draw of your description, not your character (`references/prompting.md` →
   Reference images).
4. **Record it** — `sprite-project.mjs init` (with `--purpose`, and
   `--pixel` / `--asymmetric` when the route asked), then `add-ref` for each
   reference. Later changes go through `set-character`.
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
   views, expressions and props is the best case: register the whole sheet
   as one reference (role `custom`) so the model reads every angle on it, and
   cut one clean full-body pose out of it as the working reference a clip's
   first frame is built from (`ffmpeg -i <upload> -vf "crop=W:H:X:Y"
   <character>/refs/pose.png`, or `edit_image.mjs` when it needs cleaning up
   — a white plate, generous margin, nothing else in the frame).
2. **Register it honestly.** A file the user handed you is
   `add-ref … --uploaded`; a pose you cut out of it is
   `add-ref … --derived-from <refId>`. Neither takes `--model` or `--prompt`,
   and `show` reports each reference's origin, so a later turn knows which
   references may be regenerated and which must never be.
3. **Still hold the interview** — the name and, above all, the style
   sentence. Write it from what you see (line weight, shading, palette,
   proportions), read it back to the user in the same message as the other
   questions, and only then `init`. One that contradicts the uploaded image
   makes the model split the difference.
4. **Fill the gaps with the upload attached.** A missing portrait or view is
   generated the way workflow A generates its second reference: the uploaded
   image on `--image-urls`, the prompt naming what to match. Compare the
   first *generated* reference with the upload before registering it.
5. **Show them**, as in A step 5.

### B. Add a motion

**Start with a brief motion plan.** Infer it from the request and references:
the opening and ending poses, whether it loops, what leads and follows,
which contacts stay planted or release, and how phases share the frames.
Carry these choices into the action you write; no separate plan file or
approval step is needed (`references/prompting.md` → frame-to-frame
continuity).

**Step 0 — pick the source.** A motion's frames come from one of four places:

| Source | Cost & time | Best for |
|---|---|---|
| **sheet** — one generated image, sliced into cells | ≈ 35 s, one image | idle, poses, attacks. Frames are unevenly spaced — the model draws pictures, not an animation |
| **video** — one clip on chroma green, sampled into frames | ≈ $1 and 5–7 min | walk, run, anything where smoothness is the point: the model draws the in-betweens |
| **breathe** — one registered still, warped | free, seconds | a breathing idle from a single picture (route A) |
| **mirror** — a ready side-facing motion, flipped | free, seconds | the other side of a left/right motion (G-4dir) |

Between sheet and video the choice is the user's unless they already made it:
say those two lines in one message and wait — it is the one decision that
costs real money to get wrong. Record it: `add-motion --source
sheet|video|breathe|mirror`. A **smooth transparent animation for a UI** is
not a sprite motion at all: that is route L, workflow E.

**Step 1 — pick the grid, fps, loop and anchor.** Defaults that work; deviate
when the motion needs it and say why.

| Motion type | Frames / grid | fps | Loop | Anchor |
|---|---|---|---|---|
| idle | 8, 4×2 | ≈ 3.3 (a 2.4 s cycle) | yes | bottom |
| walk / run | 8, 4×2 (8–12 from a clip) | 10–12 | yes | bottom |
| attack | 8, 4×2 or 16, 4×4 | 10 | no | bottom |
| jump poses | 8, 4×2 | 10 | no | center (see alignment limit below) |
| story key poses | 9, 3×3 | 6 | no | bottom |

An idle drawn as 4×4 pops at a row boundary or at the wrap, and 2×2 holds
each pose 0.6 s; 4×2 read best in both measured takes (`sheet-prompt` notes
an idle of any other count). **From a clip, budget one cycle, not the whole
clip** — the window `contact` finds (B-video step 6), with the fps following
from it.

**A looping motion's last frame must lead back into the first**; a one-shot
or transition ends at its intended destination. **Keep identity and camera
scale fixed, allow the planned motion** — a crouch changes silhouette height,
a jump releases ground contact, neither changes proportions. **Choose
alignment for the intended movement**: `--x-from cell` preserves horizontal
offsets already drawn, `trend` removes only a clip's slow slide; both
vertical anchors reposition each frame, so `center` gives airborne poses,
not a preserved jump trajectory (`references/pipeline.md` → `align`).

**Step 2 — register the placeholder and say how long it takes.** Before any
paid call: `add-motion --status planned --source …` (with `--direction` in
G-4dir), and **one line to the user with the expected wait** from the table
at the end of this workflow. Each leg below reserves its asset before its
paid call, so the stage shows it working.

#### B-sheet — the generated sheet

3. **Build the prompt in code.** You write only the action — the view if it
   matters, the phases by cell, what leads and follows, the one secondary
   motion, the blink, a one-shot's final pose, and how a prop is carried (an
   action that did not say drew a second floating lantern in 3 of 8 cells):

   ```bash
   mkdir -p <character>/motions/<id> && node {SKILL_PATH}/scripts/sprite-project.mjs sheet-prompt \
     --dir <character> --motion <id> --action "<the phase plan, by cell>" --frames 8 \
     > <character>/motions/<id>/sheet-prompt.txt
   ```

   It records `prompt` + `promptParts` on the motion and prints the prompt —
   into a file, because a shell variable does not survive to your next call —
   and, on stderr, the `--image-size` and the references to attach in
   order. `--frames` redraws the motion's grid (8 → 4 columns × 2 rows) and
   `run --rows/--cols` must match it; `--state` overrides the state read off
   the id. The code writes everything else — style sentence first, facing,
   guards, the white plate (`references/prompting.md` → *Building the
   prompt*).
4. **Reserve and generate** — `set-sheet --file motions/<id>/sheet-raw.png
   --from ref-turnaround,ref-portrait --prompt "$(cat <that file>)"
   --background opaque --status generating`, then one `generate_image.mjs
   "$(cat <that file>)"` call with
   `--image-urls` once per printed reference, in that order, and the printed
   `--image-size` (the call: `references/prompting.md` → The call). Then
   **run `set-sheet` again without `--status`**, so the same asset is
   measured and flips to `ready` — skip it and the sheet stays a placeholder
   forever.
5. **Cut the background out** — the normal step, not a branch. `probe` the
   sheet first (`hasAlpha: false`, a near-white `cornerColor` is expected),
   then:

   ```bash
   node {SKILL_PATH}/scripts/remove-background.mjs \
     --input <character>/motions/<id>/sheet-raw.png \
     --output <character>/motions/<id>/sheet-alpha.png \
     --model heavy --resolution 2048 --json
   ```

   BiRefNet matting cuts on the silhouette, so it keeps white highlights
   *inside* the character. With no fal key, `sprite-sheet.mjs key … --color
   auto` is the fallback; either writes the same `sheet-alpha.png`.
6. **Run the pipeline** — key → slice → clean → align → pack → gif →
   inspect in one call, on `sheet-raw.png` with `--alpha` for what step 5 made:

   ```bash
   node {SKILL_PATH}/scripts/sprite-sheet.mjs run <character>/motions/<id>/sheet-raw.png \
     --alpha <character>/motions/<id>/sheet-alpha.png \
     --rows 2 --cols 4 --out <character>/motions/<id> --name <id> --fps 3.3 --loop \
     --json > <character>/motions/<id>/run.json
   ```

   The example is an idle; use the planned grid, fps and anchor, `--no-loop`
   for a one-shot, and `--pixel` for pixel art (G-pixel). The raw cells stay
   in `cells/` for `inspect` and for a re-`align`.

#### B-video — the sampled clip

3. **Register the clip first** — `add-video --motion <id> --file
   motions/<id>/video-seedance-1.mp4 --model seedance-2.5 --mode i2v --from
   <the asset you feed it> --prompt "…" --status generating` (`--mode
   first-last` for idle and attack, step 5). It is the motion's *source*, and
   `register-run` hangs every frame's provenance off it.
4. **Flatten the input onto pure green, with room for the motion** —
   `sprite-sheet.mjs flatten <a cut-out: a ready motion's frame 00, or a ref
   through remove-background> --out <character>/motions/<id>/first-green.png
   --bg "#00ff00"`, plus `--room`:

   | Motion | `flatten` adds |
   |---|---|
   | jump, hop | `--room tall` (34 % empty above the head) |
   | attack | `--room wide` (room above, in front, behind) |
   | wave, cheer | `--room wide --headroom 0 --lead 0.3 --trail 0` |
   | everything else | nothing |

   A model keeps the input's framing: a jump shot from a tight frame cut the
   head off in 38 of 97 frames, from a `tall` one in none. Read `flatten`'s
   `plateCheck` warning before paying — a subject colour inside the key
   radius is cut away with the plate. Never flatten a white-plated
   reference: it has white *inside* the character too.
5. **Shoot the clip** — one `seedance-video.mjs` call, `--duration 4
   --resolution 480p --no-audio`, with the chroma-green template and the
   per-state sentence from `references/video-preview.md`. **Idle and attack
   pin their first frame**: first-last with the same image as `--image` and
   `--end-image`, ending "The last frame returns to the exact pose of the
   first frame." Timing words and "one jump" do not hold on Seedance — the
   spare seconds become holds, and a jump came back as two hops; you cut
   those afterwards. Then `set-video --status ready` (or `failed`, `--notes`).
6. **Look at the clip before you cut it** —

   ```bash
   node {SKILL_PATH}/scripts/sprite-sheet.mjs contact \
     <character>/motions/<id>/video-seedance-1.mp4 \
     --out <character>/motions/<id>/contact.png --json
   ```

   Open `contact.png` and look, then read the verdict. `stillStart` /
   `stillEnd` are where the opening pose breaks and the closing hold begins.
   - **`cycle.verdict: "periodic"`** — sample `loops[0].start`–`.end`; its
     `seam` well under `step` is a cycle that closes. `loops[0].ambiguous`
     names two lengths (a step or a stride?): look at both windows on the
     sheet — legs alternating inside the short one make it a stride — or
     re-run with `--gait walk|run` to let the gait decide.
   - **`"none"`** — `loops` is empty on purpose: nothing repeats. A
     `oneShots[]` entry (rest → action → rest) is sampled over its whole
     `start`–`end`, not only its `action`; with no one-shot either, sample
     `stillStart`–`stillEnd`. A repeated strike or a second hop is a second
     one-shot: take one.

   The contact sheet is a working file for your eyes; nothing registers it.
7. **Sample that window** —

   ```bash
   node {SKILL_PATH}/scripts/sprite-sheet.mjs from-video \
     <character>/motions/<id>/video-seedance-1.mp4 \
     --out <character>/motions/<id> --name <id> \
     --trim-start <start> --trim-end <end> --frames 8 --loop --x-from trend \
     --json > <character>/motions/<id>/run.json
   ```

   **`--x-from trend` is for a walk or run cycle only** — it removes the slow
   slide and keeps the step, where pinning the feet lurches the body by a
   stride; on a one-shot it reads the lunge itself as drift, so leave those
   at the default. **One `--body-height N`** on every video motion of a
   character puts it at one size across clips shot with different room.
   `add-motion --rows/--cols` describe the packed layout (8 → 4×2). Beats
   that are not evenly spaced are named instead of counted: `--at
   0.917,1.09,1.26,…` replaces `--frames` and the trim flags.

#### Every source ends the same way

8. **Record the run** —
   `node {SKILL_PATH}/scripts/sprite-project.mjs register-run --dir <character> --motion <id> --run <character>/motions/<id>/run.json`
   (or piped with `--run -`, as breathe and mirror are). For a video run add
   `--video <videoId>` when the motion has more than one clip. This
   registers every frame, the atlas and the previews, copies the inspect
   summary into the motion and sets it `ready`.
9. **Read the numbers, then look.** Report the inspect values, not "no
   warnings": `navigate-to` the motion, `play` it, `pause` + `capture` at two
   or three phase boundaries. Check identity, contacts and direction; the
   last-to-first transition of a loop or the final pose of a one-shot.
   `inspect` measures geometry, not identity or motion quality.
10. **Keep it or fix it, and say which.** A warning you keep is acknowledged
    in one sentence the user reads: `set-motion --motion <id> --ack-warnings
    "the lantern swings out of the bbox by design"`. Scale drift over 15 %:
    a crouch or a prop, or a real proportion change (regenerate that, and
    clipped cells). Head sway the alignment added: re-align from `cells/`
    with `--x-from trend` (clip) or `cell` (sheet). Near-duplicates: a clip
    sampled into a hold (resample with `--at`), or a sheet's repeated
    drawing. Row jumps: regenerate with fewer rows (4×2). One bad cell →
    `edit_image.mjs` on it and re-run. `references/pipeline.md`'s warning
    table has each fix.

**How long each step takes** (measured). Nothing here has a progress bar, so
this is how you tell "working" from "hung" — and the number you give the
user in step 2:

| Step | Wall time |
|---|---|
| a reference image (2048², `--quality high`); a direction anchor (1024²) | 30–40 s; ≈ 25 s |
| a sheet (2048 wide, refs attached) | 20–35 s |
| `remove-background.mjs --model heavy` at 2048 / 1024 | 10–20 s / ≈ 6 s |
| `sprite-sheet.mjs run` | ≈ 5 s |
| `breathe --name … \| register-run` (route A, the cut-out aside) | 7–15 s |
| `mirror` + `register-run` | ≈ 5 s |
| `sprite-sheet.mjs contact` (4 s clip, 24 stills + analysis) | ≈ 3 s |
| `sprite-sheet.mjs from-video` (16 frames, 640² clip) | ≈ 12 s |
| **a 4 s Seedance 480p clip** | **≈ 400 s — nearly seven minutes** |
| a loop keyframe (1024², `--quality high`) | ≈ 30 s |
| **a 5 s Seedance 480p first-last loop clip** | **≈ 200 s — but budget seven minutes** |
| `remove-video-background.mjs --model veed` / `veed-gs` (121 frames) | 23–30 s |
| `interpolate-video.mjs --target-fps 60` (Topaz, 5 s clip) | ≈ 50 s |
| `interpolate-video.mjs --model rife --between 1 --loop` (5 s clip) | 21 s of compute — but 231 s wall on a cold queue |
| `sprite-sheet.mjs loop` (119 frames, 512×596, four exports) | ≈ 24 s |

Quote the Seedance rows as a **range**: 199 s and 404 s have both been
measured, and the difference was the queue, not the clip. The clip is the step that looks broken and
is not: say so before you start one, register the placeholder, and wait — no
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
available, so every motion is a generated sheet, a breathe or a mirror. Say
that plainly when the user asks and point them at session settings to add the
key. The GIF and WebP previews are built from the real frames and always work.
{{/videoGenDisabled}}

### E. A seamless loop for the UI

{{#videoGenEnabled}}
A **loop motion** is a different deliverable, not a sprite motion exported
differently. What lands is one transparent animation a frontend drops straight
into a page — `loop.webp`, `loop.apng`, `loop.webm` (VP9 with alpha) and
`loop.json` (Lottie) — carrying **every** frame of the cycle, unaligned and
uncleaned. The bobbing *is* the content, so nothing re-centres it; there is
no atlas, no GIF and no anchor. Those four files need no export step; an MP4,
a MOV, a PNG sequence or a Rive file of the loops is made on request
(**Exporting** below).

Shooting the clip **first-last with the same image at both ends** gives the
model a target to land back on. It is not a guarantee: the model can stop
short, and a retime (6b) changes which frames sit at the wrap. The proof is
the **measured** seam — `loop` reports `seam` against `seamLimit`
(max(2·step, 0.005), recorded with the run), and `seam ≤ seamLimit` is a
loop that closes. Say "it closes" from that number, never from the shape of
the workflow.

It spends the fal key twice over — the clip is a paid Seedance render (about a
dollar for four seconds), and matting and interpolation are paid calls on top.
Say the price and the wait before you start one.

1. **Interview in one message.** The subject (an icon in its own right, or the
   character), the motion verb (sway, flicker, breathe, bob, spin), the style
   sentence (the claymation 3D-icon anchor in `references/prompting.md`, or the
   character's own `character.style` verbatim), the duration (4 s; 5 s when the
   motion has two beats), and the width the UI will render it at. Five answers,
   one message — the next step after them costs money.

   **The frame ceiling belongs in that message.** `loop` writes at most 400
   frames, so `duration × fps ≤ 400`: 60 fps fits up to 6.6 s, and a 7–8 s
   loop is a 48 fps loop. Say so while the duration is still a question.

   **Ask for a budget ceiling when the user has not named one** — a take is
   ≈ $1.1, the matte ≈ $0.06 and the interpolation ≈ $0.10 — and put the
   running total in every message that spends.

   Then record the answers on the motion, right after `add-motion` in step 2:

   ```bash
   node {SKILL_PATH}/scripts/sprite-project.mjs set-motion --dir <character> \
     --motion <id> --brief-duration 4 --brief-width 512 \
     --brief-interpolator topaz --brief-budget 3 --json
   ```

   `add-video` **refuses** a generated clip on a loop motion with no brief;
   any answer can change later with one flag.
2. **Register the motion.**

   ```bash
   node {SKILL_PATH}/scripts/sprite-project.mjs add-motion --dir <character> \
     --id <id> --label "<Label>" --kind loop --fps 24 --status planned --json
   ```

   `--kind loop` needs no grid, defaults `source` to `video`, and is the only
   motion `set-keyframe` accepts. Record the brief (step 1) next.
3. **Draw the keyframe, then look at it.** Reserve it first, so the stage is
   not empty while the model draws:

   ```bash
   node {SKILL_PATH}/scripts/sprite-project.mjs set-keyframe --dir <character> \
     --motion <id> --file motions/<id>/keyframe.png \
     --prompt "<the prompt you are about to send>" --status generating --json
   ```

   Then one `generate_image.mjs` call — 1024×1024, `--quality high`,
   `--background opaque`, a white plate asked for in the prompt, and
   `--image-urls` once per reference when the subject is the character
   (`references/prompting.md` has the call and the 3D-icon prompt). It picks
   the model itself and reports it in its JSON `model` field; pass **that**
   to the closing `set-keyframe`. Cut it out and register both halves:

   ```bash
   node {SKILL_PATH}/scripts/remove-background.mjs \
     --input <character>/motions/<id>/keyframe.png \
     --output <character>/motions/<id>/keyframe-alpha.png \
     --model heavy --resolution 1024 --json

   node {SKILL_PATH}/scripts/sprite-project.mjs set-keyframe --dir <character> \
     --motion <id> --file motions/<id>/keyframe.png \
     --alpha motions/<id>/keyframe-alpha.png --model "<the model the JSON reported>" --json
   ```

   The second call flips the same ids to `ready` (it needs `--alpha`;
   omitted `--model` / `--prompt` keep what the reserving call recorded).
   Then flatten the cut-out onto the clip's plate and *look* at what you drew:

   ```bash
   node {SKILL_PATH}/scripts/sprite-sheet.mjs flatten \
     <character>/motions/<id>/keyframe-alpha.png \
     --out <character>/motions/<id>/first-green.png --bg "#00ff00" --json
   ```

   `navigate-to` the motion, `capture`, and check the four things that cost a
   whole clip to get wrong: one subject, a clear margin, no floor or contact
   shadow, no text — and read `plateCheck`. `first-green.png` is a working
   file, never registered.
4. **Register the clip, and say how long it takes.**

   ```bash
   node {SKILL_PATH}/scripts/sprite-project.mjs add-video --dir <character> \
     --motion <id> --file motions/<id>/video-seedance-1.mp4 \
     --model seedance-2.5 --mode first-last --from <id>-keyframe-alpha \
     --prompt "<the loop prompt>" --status generating --json
   ```

   `--from` names the *asset* the clip grew out of — the cut-out keyframe.
   Then one line to the user: **three to eleven minutes**, every end of that
   range measured on this queue, none of it the clip's fault.
5. **Shoot it with the same image at both ends.**

   ```bash
   node {SKILL_PATH}/scripts/seedance-video.mjs \
     --prompt "<the loop template from references/video-preview.md>" \
     --image <character>/motions/<id>/first-green.png \
     --end-image <character>/motions/<id>/first-green.png \
     --duration 4 --resolution 480p --no-audio \
     --output <character>/motions/<id>/video-seedance-1.mp4 --json
   ```

   The template adds the sentence that makes the model land there. One call,
   then leave it alone; afterwards `set-video --status ready` (or `failed`,
   with `--notes`).

   **A second take is the user's money too.** When `contact` shows a freeze or
   an open seam, do not re-shoot on your own judgement — put the numbers, the
   price (≈ $1.1) and the wait in front of the user *together with the free
   alternative* (6b, a retime of the take you already have), and take the
   answer. The same applies to a second Topaz or VEED call.
6. **Look at the clip before you cut it** — `sprite-sheet.mjs contact`, as in
   B-video step 6, with a loop's question in mind: does the motion ever
   freeze, and does the end come back to the opening pose? A first-last loop
   usually reads **no cycle** — it drifts from its keyframe and back once,
   which is fine; a long `stillEnd` hold is the duplicate closing keyframe
   (step 8 trims it).

   6b. **Retime the plate (optional, free).** Seedance has idle-loop failure
   modes no prompt wording fixes — a 1.5–2 s freeze at the inhale apex, a
   double blink, a tail that sits still (`references/video-preview.md`).
   `contact`'s `profile.deltas` shows them as a run of near-zero steps.
   Reordering the clip's own frames costs nothing and invents nothing:

   ```bash
   node {SKILL_PATH}/scripts/sprite-sheet.mjs retime \
     <character>/motions/<id>/video-seedance-1.mp4 \
     --keep 2-45,60-66,75-112 --out <character>/motions/<id>/video-retime-2.mp4 --json

   node {SKILL_PATH}/scripts/sprite-project.mjs add-video --dir <character> \
     --motion <id> --file motions/<id>/video-retime-2.mp4 \
     --derived-from <id>-video-1 --op retime --model ffmpeg --json
   ```

   Ranges are inclusive frame indices **in playback order**, repeats allowed.
   It runs on the PLATE, before interpolation and matting. After a retime the
   frames at the wrap are whichever your ranges put there (`firstIs` /
   `lastIs`), so step 10's measured seam is the only evidence the cycle still
   closes — say that rather than "same image at both ends".
7. **Optional, and in this order: interpolate, then matte.** Interpolation
   reads opaque pixels, so it runs on the **plate** clip; matting makes the
   clip transparent, and after it `loop --fps` is refused.

   **Interpolation is the user's choice, and they already made it** — the
   brief's `interpolator`, printed by `show`. Use it and do not ask twice.
   Only when there is no brief (a motion from before the interview existed)
   put the three in one message; this session's default is
   **`{{defaultInterpolator}}`**. `none` ships the clip's own rate.

   | | What it does | Cost | The wrap |
   |---|---|---|---|
   | **`topaz`** — `interpolate-video.mjs --target-fps 60` | Exactly 60 fps, the sharpest in-betweens measured | ≈ $0.10 per 5 s clip, 49–69 s | **Not closed** — it never sees the last frame against the first; `loop --seam-fill` handles the seam |
   | **`rife`** — `interpolate-video.mjs --model rife --between 1 --loop` | Learned in-betweens that MULTIPLY the rate: 24 fps becomes 48 | ≈ $0.03 per 5 s clip; the queue can hold it for minutes | **Closed** — `loop: true` interpolates the wrap too |
   | **`ffmpeg`** — `sprite-sheet.mjs loop --fps 60`, no extra call | Block-matching `minterpolate`, loop-wrapped | free | **Half closed** — `--seam-fill` finishes the job |

   The owner's position: **Topaz's ten cents is acceptable**, and the free
   `minterpolate` is the fallback for a session with no fal key — not the
   recommendation. Say the price with the choice.

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

   Each derived clip is registered once its file exists (`--status`
   defaults to `ready`), naming its parent and the endpoint that really made
   it; the number in the id is the next free one.

   **Of the two, the matte is the one worth paying for**: VEED's is the
   softest edge measured, and the fix for what a colour key cannot separate
   (smoke, glow, a plate that is not green). The free key is no compromise
   either — it un-mixes the plate out of every edge (ten real loops: no plate
   colour, no dark rim), not yet compared side by side. **Pick the endpoint
   by the plate**: chroma green → `--model veed-gs` (≈ $0.06 for 121
   frames); any other → `--model veed` (≈ $0.09), `bria` if VEED fails. Whatever the user picks, **read the seam
   again afterwards**: Topaz opened it on the trial clip because it never
   sees the wrap (`references/video-preview.md`).
8. **Cut the loop.** Hand it the clip whose pixels you want — the **last** one
   in the chain:

   ```bash
   node {SKILL_PATH}/scripts/sprite-sheet.mjs loop \
     <character>/motions/<id>/video-veed-3.webm \
     --out <character>/motions/<id> --name <id> --key alpha --width 512 --json \
     > <character>/motions/<id>/run.json
   ```

   `--key alpha` decodes the alpha a matted clip carries. Straight off the
   plate clip it is the same command without `--key`: `auto` measures the
   plate the model painted and un-mixes it. Frames land at `frames/000.png`
   (three digits, up to 400) with the four exports beside them.

   **`--width` comes from the brief** — `brief.width`, doubled for retina if
   the user gave you the CSS size; never from the clip. Omitted, `loop` caps
   the frames at 512 px (`widthDefaulted: true`) — a guard, not a choice.
   Measured on 119 frames of 512×596: WebP 3.4 MB, APNG 21 MB, WebM 367 KB,
   Lottie 28 MB; at `--width 256` the Lottie is about 7 MB.

   **`--seam-fill auto|none|<N>`** (default `auto`). When the seam is past
   `seamLimit`, `auto` appends `N = min(4, ceil(seam/step) − 1)` in-between
   frames at the wrap (`minterpolate`), so the loop grows by N frames and
   `seamFill` says N. It closes a seam that is *nearly* closed; a clip that
   ends somewhere else is still a reshoot.
9. **Record the run.**

   ```bash
   node {SKILL_PATH}/scripts/sprite-project.mjs register-run --dir <character> \
     --motion <id> --run <character>/motions/<id>/run.json --video <id>-video-3 --json
   ```

   `--video` names the clip the frames were really cut from — the file you
   handed step 8; left off, the newest clip is assumed (with a note), and a
   mismatch against the run's clip path is reported. `register-run` also
   warns when the frames are more than 2 px off `brief.width`: cut again
   with the right `--width` (free) before you report.
10. **Read the seam, then look at it.** Report `seam` against `seamLimit`, in
    numbers, and `seamFill` when it is not 0 — those frames are the wrap
    filled in. Then `navigate-to` the motion, `play` it, `pause` and
    `capture` the **last** frame, then `navigate-to` frame 0 and `capture`
    that: two screenshots a step apart is what a seam looks like. After a
    retime this is the *only* evidence the cycle closes. Close with the frame
    count, fps, duration, the four export sizes and the running cost; a
    28 MB Lottie is a deliverable nobody can ship, and a narrower `--width`
    is the remedy.
{{/videoGenEnabled}}

{{#videoGenDisabled}}
A loop starts with a paid clip, so this workflow is unavailable in a session
with no fal key. Say that plainly and point the user at session settings; a
sprite motion from a generated sheet (workflow B-sheet) or a breathe is the
only animation path left, and it is not the same thing — its frames are
drawn or warped, not filmed, and it exports an atlas rather than a
transparent loop.
{{/videoGenDisabled}}

### F. Connect the loops for Rive

When the user wants **one Rive file whose loops switch in an app** — a mascot
that goes from idle to typing to a coffee break on cue. Every loop was shot
from its own keyframe, so switching between two of them jumps: a mug is in
one frame and gone in the next, the body stands and then sits. Rive cannot
blend two frames, so the continuity has to be in the pictures: a **hub** loop
(idle), **transition clips** that start on one loop's frame 0 and end on
another's, and a state machine that changes state only where the pictures
meet. `rive` builds that machine from whatever transitions are registered;
this workflow makes them.

{{#videoGenEnabled}}
1. **Look first — it is free.**

   ```bash
   node {SKILL_PATH}/scripts/sprite-sheet.mjs lineup <character> --json
   ```

   It writes `<character>/lineup.png`, every ready loop's frame 0 beside the
   hub's on one floor line, and per loop a `poseGap` and a `suggestion`
   (`direct` or `transition`). Open the PNG and look: the threshold was
   calibrated on one character (`references/pipeline.md`, "lineup").
2. **Decide which loops need a clip.** A loop whose frame 0 is already the
   hub's pose can cut; one that sits, or holds a mug, cannot. Only **hub → X**
   is shot: the way back is X → hub played backwards, free (step 7).
3. **Price it and ask for a budget.** Per entry: one take ≈ $1.1 (Seedance,
   4 s, 480p) and one matte ≈ $0.06 (`veed-gs`); no interpolation, because a
   Rive file plays at 24 fps. Five entries is about $5.8. Put the list, the
   price and the wait (three to eleven minutes a take) in one message, take
   the answer, and keep a running total.
4. **Register, brief and shoot each entry.**

   ```bash
   node {SKILL_PATH}/scripts/sprite-project.mjs add-motion --dir <character> \
     --kind transition --from idle --to coffee --json
   node {SKILL_PATH}/scripts/sprite-project.mjs set-motion --dir <character> \
     --motion idle-to-coffee --brief-duration 1.2 --brief-budget 1.2 --json
   node {SKILL_PATH}/scripts/sprite-project.mjs add-video --dir <character> \
     --motion idle-to-coffee --file motions/idle-to-coffee/video-seedance-1.mp4 \
     --model seedance-2.5 --mode first-last \
     --from idle-keyframe-alpha,coffee-keyframe-alpha \
     --prompt "<the prompt>" --duration 4 --status generating --json
   node {SKILL_PATH}/scripts/seedance-video.mjs \
     --prompt "<the transition template from references/video-preview.md>" \
     --image <character>/motions/idle/first-green.png \
     --end-image <character>/motions/coffee/first-green.png \
     --duration 4 --resolution 480p --no-audio \
     --output <character>/motions/idle-to-coffee/video-seedance-1.mp4 --json
   ```

   The id is `<from>-to-<to>`. `--brief-duration` is how long the clip should
   **play** in the file (one to one and a half seconds), not the take's
   length. `first-green.png` is each loop's flattened keyframe from workflow E
   step 3 (flatten it again if it is gone). Then `set-video --status ready`,
   or `failed` with `--notes`.
5. **Matte it** with `remove-video-background.mjs --model veed-gs`, registered
   with `add-video --derived-from <that video id> --op matte --model veed-gs`,
   exactly as in workflow E step 7.
6. **Cut it, and read both ends.**

   ```bash
   node {SKILL_PATH}/scripts/sprite-sheet.mjs transition \
     <character>/motions/idle-to-coffee/video-veed-2.webm --character <character> \
     --from idle --to coffee --key alpha --duration 1.2 --json \
     > <character>/motions/idle-to-coffee/run.json
   node {SKILL_PATH}/scripts/sprite-project.mjs register-run --dir <character> \
     --motion idle-to-coffee --run <character>/motions/idle-to-coffee/run.json \
     --video <the matte's video id> --json
   ```

   It drops the frames a first-last take spends waiting at each end, retimes
   to `--duration`, and measures `startGap` (against idle's frame 0) and
   `endGap` (against coffee's) beside the clip's own `step`. `gap ≤ 2·step`
   lands. Quote all three numbers. A warning means the take did not begin or
   end on the keyframe: a later `--trim-start` or an earlier `--trim-end` is
   free, a new take is the user's money.
7. **Make the exits, free.**

   ```bash
   node {SKILL_PATH}/scripts/sprite-project.mjs add-motion --dir <character> \
     --kind transition --from coffee --to idle --json
   node {SKILL_PATH}/scripts/sprite-sheet.mjs transition --reverse-of idle-to-coffee \
     --character <character> --json \
     | node {SKILL_PATH}/scripts/sprite-project.mjs register-run --dir <character> \
       --motion coffee-to-idle --run - --json
   ```

   The exit is the entry's frames backwards (`reverseOf`); the `.riv` embeds
   nothing for it. Play it before you report it. **When a reversed exit reads
   wrong** — a mug put down is not a mug picked up backwards — say what you
   saw, and offer a real exit take at the price of an entry.
8. **Export, and look through the preview.** `rive <character>
   --include-loops`, registered (see **Exporting**). In the Export tab's Rive
   preview, press a loop's button and watch the state line: idle →
   idle-to-coffee → coffee. Report from the file's `stateMachine`: the
   routes, each loop's wait, and every direct cut with its `poseGap`.

**Say the limits plainly.** Leaving a loop waits for the end of its cycle
(`stateMachine.waits`; tanka's loops run 3.8–5.1 s). Routes go through the
hub: from coffee to typing plays coffee → idle, then idle → typing. A pair
with no transition cuts, and the report lists where and how far apart the
poses are.
{{/videoGenEnabled}}

{{#videoGenDisabled}}
The transition clips are paid Seedance takes, so this workflow needs the fal
key. Without one, `lineup` still runs and `rive` still routes through the
hub: say which switches will cut, and how far apart their poses are.
{{/videoGenDisabled}}

## Exporting

Every file a motion's own run makes is already a deliverable and needs **no
export step**: a sprite motion's `preview.gif`, `preview.webp`, `sheet.png` +
`atlas.json` and its clips; a loop's `loop.webp`, `loop.apng`, `loop.webm`
and `loop.json`; colourways once `recolor` baked them. The Export tab lists
them as ready, next to everything else a **ready** motion can be made into
on request. Match the format to where it is going:

| Where it goes | Format | How |
|---|---|---|
| Editing software — Premiere, Final Cut, After Effects, DaVinci | MOV, ProRes 4444 with alpha | `export --format mov` |
| Anywhere a plain video plays — chat, slides, social | MP4, H.264 on a solid colour | `export --format mp4 --bg "#rrggbb"` |
| A web page | WebM (VP9 with alpha), or the animated WebP the run made | `export --format webm` |
| Lossless frame animation; an app that plays Lottie | APNG; Lottie (raster frames) | `export --format apng` / `lottie` |
| A game engine | the sheet + atlas the run made; an Aseprite sheet of one motion or the whole character; a PNG sequence | `export --format aseprite` (motion or `<character>`) / `png-seq` — see **Game engines** |
| Product or app animation driven from code — a mascot switching states | Rive — the whole character: a number input picks the loop, a trigger per one-shot | `rive <character>` (loops and transitions: `--include-loops` or `--motions`) |

Each export is one command and one registration, piped:

```bash
node {SKILL_PATH}/scripts/sprite-sheet.mjs export lumi/motions/attack --format mp4 --bg "#ffffff" --json \
  | node {SKILL_PATH}/scripts/sprite-project.mjs register-export --dir lumi --report - --json

node {SKILL_PATH}/scripts/sprite-sheet.mjs export lumi --format aseprite --json \
  | node {SKILL_PATH}/scripts/sprite-project.mjs register-export --dir lumi --report - --json

node {SKILL_PATH}/scripts/sprite-sheet.mjs rive tanka --motions idle,wave,typing --json \
  | node {SKILL_PATH}/scripts/sprite-project.mjs register-export --dir tanka --report - --json
```

A motion's files land in `<character>/motions/<id>/exports/`, the whole
character's in `<character>/exports/`; exporting again replaces the file and
its record. A failed export prints its `ERROR:` and nothing on stdout, so
`register-export` registers nothing — fix what the `ERROR:` says and run
both again. Re-running a motion retires the exports made from its old
frames (`register-run` says so): export again if the user still wants them.

- **`--repeat N`** (video only): how many times the motion plays. Left out, a
  looping motion repeats until the clip lasts at least 3 s and a one-shot
  plays once (`repeatDefaulted`). Tell the user the length.
- **`--scale N`**: a whole number, nearest-neighbour, so pixel art stays crisp.
- **`--bg`**: MP4 only, default white; on any other format it is reported as
  ignored — those keep their transparency.
- **`--shadow`** — a ground shadow cast from the figure's own silhouette about
  its feet, on request (the tab has no switch for it; users ask in chat).
  On MP4 / MOV / WebM it is cast into the frames and the canvas grows to
  hold it — the default slant nearly doubles a tall figure's width (offer a
  smaller `--shadow-shear`); a loop's own WebM is its deliverable,
  so its shadowed video is MOV or MP4. On an Aseprite export it is a
  separate shadow sheet (tags `<motion>-shadow`) the engine places one depth
  below the sprite. Tuning flags: `references/pipeline.md` → `export`.
- The script probes every video it writes and refuses one that is not what it
  claims. Quote the size and the duration from the report.

### Game engines

Every sprite run already made `sheet.png` + `atlas.json` (TexturePacker
JSON-hash, frames `<motion>_NN`). Each frame carries `anchor` and `pivot`,
the same point: where the feet stand (`{0.5, 0.9688}` on a 256 px cell with
the default 8 px pad), so the sprite's position is its footing.

- **Phaser** reads `anchor || pivot`: `this.load.atlas(key, 'sheet.png',
  'atlas.json')`. It does not play an atlas's per-frame durations — set the
  animation's `frameRate` to the motion's fps.
- **PixiJS 8** reads only `anchor`: `Assets.load('atlas.json')` gives a
  `Spritesheet` whose `animations[<motion>]` feed `AnimatedSprite`. The seed
  character's atlases predate `anchor` and stand every Pixi sprite on its
  top-left corner: re-run the motion to give it one (re-packing alone
  cannot). A sheet packed at `--scale 0.5` draws at twice its size in Pixi,
  which reads `meta.scale` as the texture resolution.
- **Aseprite JSON** — Phaser's one-call setup, and Flame's: `export
  <motionDir> --format aseprite` for one motion, `export <character> --format
  aseprite` for every ready sprite motion on one sheet with a tag per motion
  and each frame's duration. Hand the developer:

  ```js
  this.load.aseprite('lumi', 'lumi.png', 'lumi.json');
  this.anims.createFromAseprite('lumi');
  sprite.play({ key: 'idle', repeat: -1 });  // looping is not in the file: repeat: -1
  ```

  Loops and transitions are left out of the character sheet (their PNG
  sequence or the `.riv` carries them); mirrors go in as ordinary tags.
- **Loose frames** — `export --format png-seq`: PNGs plus `animation.json`
  with the fps, per-frame durations and the pivot.
- **Pixel art** stays pixel art: export at whole-number `--scale`, never
  re-pack a generated sheet at 0.5 (G-pixel). A colourway is the same atlas
  over another sheet — swap the directory.

Schema and every report field: `references/pipeline.md` (`atlas.json`,
`export`).

**Rive** — say these to the user plainly, every time:

- The frames are **raster images**, not vector shapes. The `.riv` plays in
  every Rive runtime (web, iOS, Android, Flutter, Unity…), but it is a runtime
  file and **cannot be opened and edited in the Rive editor**.
- **Which motions**: by default every ready sprite motion. Loops go in only
  when asked — `--include-loops` for every ready motion, transitions
  included, or `--motions a,b,c` to name exactly which (and their order). A
  transition goes in only with both loops it joins. Ask which states their
  app switches between rather than putting in all ten loops.
- **Loops are resampled, and say so**: a loop goes in at **24 fps** (`--fps`)
  and at most **320 px** (`--max-size`), one factor for all of them, each
  brought back to its clip's scale and place; sprite motions keep their
  atlas rate and size. Quote each motion's `frames`, `fps`, `width` ×
  `height` from the report — never the source's 60 fps and 512 px. A loop
  whose clip scale is unknown is warned about (it may not match in size;
  re-cutting it with `loop` fixes it).
- **Memory**: `estimatedDecodeBytes` in the report is what the file costs
  once opened. Past 128 MB the report warns; past 768 MB `rive` refuses. Say
  the number; when it is large, offer a lower `--fps`, a smaller
  `--max-size`, or fewer motions.
- **Wiring**: `State Machine 1`. A number input, **`motion`**, names the
  loop to be in (values in `stateMachine.inputs`); each one-shot has a
  trigger, `play_<motionId>`. It starts on the **hub** (the looping idle;
  `--hub <id>` picks another). Setting `motion` moves the character at the
  **end of the current cycle**, through transition clips or the hub; a
  one-shot plays at once, then goes to the loop `motion` names. Give the
  developer the value table and the waits.
- **Connected or not**: `stateMachine.routes` spells out every loop-to-loop
  route with its worst-case seconds, and `stateMachine.cuts` every place the
  file cuts between two poses, with its `poseGap`. Say how many cuts there
  are and the largest; workflow F is how they go away. Reverse transitions
  and mirrors show their source's images and add no memory.
- The frames go in as WebP, lossy at quality 85 (tanka's twenty motions:
  13.0 MB against PNG's 81.1 MB, the same memory once opened); pixel art goes
  in lossless. With no libwebp in ffmpeg the default falls back to PNG and
  the report warns; say so.
- The user can play the file in the Export tab (Preview): one button per
  loop sets `motion`, one per one-shot fires it. After registering,
  `navigate-to` a motion of the character so they land on it.

Every flag and report field: `references/pipeline.md`; the asset ids and
sidecar fields: `references/project-json.md`.

## Commands

The user can press four kinds of button on the stage. Each arrives as a
notification naming the selected motion — or, for a whole-character file, the
character.

- **`render-video`** — they picked a model and a mode in the popover. Use
  their choices, not your defaults, and follow workflow C.
- **`regenerate-motion`** — redraw the selected motion, folding in any note
  they attached, from the source it already has (`motion.source`). Keep the
  motion id; `register-run` replaces the old frames and their edges, so the
  motion is updated, never duplicated.
  **On a breathe** it is free and seconds: the same `breathe … |
  register-run` pipe with the parameter the note asks for, the rest from the
  record (`show --motion <id>`). **On a mirror**, the drawing lives in its
  source: regenerate that and mirror again (say so first). **On a pixel
  motion** keep `--pixel`, then rebuild its colourways. **On a loop motion**
  (`motion.kind === "loop"`) this is a new *take* from the keyframe that is
  already there: re-shoot the first-last clip with a revised prompt (workflow
  E from step 4) and cut it again. Redraw the keyframe only when the note
  asks for a different look — a new keyframe is a new subject, and every take
  after it is measured against a picture the user never approved. Say which
  of the two you are doing before you spend the clip.
- **`fix-alignment`** — the character swims or jumps between frames (not
  offered on a breathe or a mirror: their frames share one footing by
  construction). Read the inspect warnings against the motion plan:
  unintended `bodyDrift` → re-run `align` from `cells/` with `--x-from feet`
  or `cell`; head sway the alignment added (`headDrift` over
  `sourceHeadDrift`) on a clip's walk → `--x-from trend`; unintended
  `maxJump` → `--smooth` or the other anchor. Pixel frames re-align from
  `pixel/`. Check whether `scaleDrift` is a pose or prop change before
  regenerating; clipped cells need a drawing fix. Preserve intended movement.
  `references/pipeline.md` has the table and alignment limits.
- **`export`** — they pressed Generate (or Regenerate) on a row of the Export
  tab. The facts line names `character`, `motion` (absent for a
  whole-character file), `format` and, for `mp4`, the `background` they
  picked. Run exactly that export — with that colour, quoted (`--bg
  "#1a2b3c"`; unquoted, the shell reads `#` as a comment) — and register it,
  as **Exporting** shows. `format: aseprite` with `scope: whole character` is
  `export <character> --format aseprite`. For `riv` the facts line also lists
  `motions` and, when there are any, `transitions` — run `rive <character>
  --motions <the motions>,<the transitions>`, at the defaults. On a
  transition's own tab the row is still the character's `.riv`: a transition
  is never a Rive file of its own. Report the file and its size, and for Rive
  the caveats above. Do not swap in a format they did not ask for; if the
  export refuses, say why in their words.

<!-- pneuma:end -->

## References — read when you need depth on the topic

| Topic | File |
|---|---|
| Motion planning and continuity for either source; `sheet-prompt` (what it writes, state guards, frames and grid, the layout guide), sheet grammar, the idle recipe, worked prompts, the 3D-icon keyframe, fixing one cell, direction anchors | `references/prompting.md` |
| Every `sprite-sheet.mjs` / `sprite-project.mjs` subcommand — `key` and the two keyers, `flatten --room`, `align` (`trend`, `body`), `inspect` and its warnings, `run --pixel` / `pixel`, `recolor`, `contact` and its verdicts, `from-video` (`--at`, `--body-height`), `retime`, `loop`, `transition`, `mirror`, `lineup`, `export` (Aseprite, `--shadow`), `rive`, `fit`, `breathe`, `register-*`, the atlas schema, measured numbers | `references/pipeline.md` |
| The chroma-green source clip, per-state motion sentences and the first-frame pin, the seamless loop clip and the transition clip (prompt templates + worked calls), Seedance and H3 Max flags, video matting and interpolation, cost, latency, cycle analysis measured (needs the fal key) | `references/video-preview.md` |
| The `project.json` schema — craft fields, the sprite sidecar (purpose, pixel spec and colourways, directions and anchors, breathe and mirror records, prompt parts), loop and transition motions, derived clips, exports and the `.riv` record, asset id conventions | `references/project-json.md` |

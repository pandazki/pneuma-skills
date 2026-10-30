# The game asset pipeline (0.6.0)

Everything beyond one character's moves: eight facings, props sets, a whole
move set, variants, restyles, borrowed movements, storyboards, a rigged 3D
model and cutscenes. SKILL.md says when; this file says how, flag by flag,
with what each step was measured to do. Every path is workspace-relative and
every command runs from the workspace, like the rest of the mode.

## Prices and waits

| Step | Price | Wait |
|---|---|---|
| facing sheet (2048², references attached) | ≈ $0.12 | 30–40 s |
| item sheet (2000×800, ten items) | ≈ $0.03 | 30 s |
| pack clip, 720p, 4 s (3×3 → 320 px cells) | ≈ $1.87 | 4–12 min |
| pack clip, 480p, 4 s (3×3 → 213 px cells) | ≈ $0.83 | 2–7 min |
| items pack clip, 720p, 4 s, 4×3 plate | ≈ $1.88 | 4–12 min |
| variant reference (Sunburst edit) | ≈ $0.11–0.13 | 40–60 s |
| motion-library clip (Seedance text-to-video, 9:16, 480p, 5 s) | ≈ $1.04 | 3–6 min |
| motion transfer, Kling v3 Standard | $0.126 / s of output (≈ $0.47–0.60) | ≈ 5 min |
| motion transfer, Kling v3 Pro | $0.168 / s | ≈ 5 min |
| motion transfer, Wan 2.2 Animate Move | $0.08 / s | ≈ 10 min |
| storyboard keyframe (1024², turnaround attached) | ≈ $0.07 | 25 s |
| storyboard clip (Seedance reference, 720p, 5 s) | ≈ $2.33 | 5–10 min |
| clip matte (`veed`) | ≈ $0.09 | ≈ 30 s |
| 3D model, Meshy 7.1 with rig (+ walk, run) | $0.80 | 3–5 min |
| 3D animations, ≤ 10 per call | $0.08 | 1–2 min |
| cutscene (Seedance reference, 16:9, 720p, 8 s, audio) | ≈ $3.70 | 6–12 min |

Everything else here — splitting, plates, cutting, registering — is free.

## Facing sheets and packs

`facing-prompt [--layout 8|4] [--json]` prints the facing sheet's prompt
(`pack.mjs::facingSheetPrompt`, builder `pack-prompt/1`): the style sentence,
the grid, every copy's facing by its cell ("the top-middle copy faces
straight away…"), the recorded camera (`character.view`), the side sentence
of every facing on an asymmetric character, the white plate. `--json` adds
`imageSize` and `attach` (the turnaround and portrait). Registered with
`add-ref --role directions --layout 8|4`; the layout is recorded on the ref.

Layouts, row-major (`null` an empty cell):

| `--layout` | Grid | Cells |
|---|---|---|
| `8` | 3×3 | back-left, back, back-right / left, —, right / front-left, front, front-right |
| `4` | 2×2 | front, back / left, right |

In compass terms (an isometric game's names): front = S, back = N, left = W,
right = E, front-left = SW, front-right = SE, back-left = NW, back-right = NE.

`sprite-sheet.mjs split-facings <cut-out> --character <dir> --ref <id> --out <dir> [--pad 8]`
crops every cell of the CUT-OUT sheet, trims it to its drawing plus the pad
and writes `anchor-<direction>.png`; a drawing touching its cell's edge is
warned. `register-facings --report <json|->` registers each as
`anchor-<direction>` (role anchor, derived from the sheet, op crop) — the
anchors the per-direction sheet route and motion transfer use.

`add-pack --state <state> [--ref directions] [--id] [--label] [--fps]` adds
the pack motion (`kind: "pack"`, `pack: { state, rows, cols, cells }`) and
one planned motion per facing, `<state>-<direction>`, `source: video`,
`packOf` the pack. `pack-prompt --motion <pack> [--action "<what every copy
does>"]` builds and records the clip prompt: the built-in states are idle,
walk, run, attack, jump, hurt, death, cast (and `loop` for items); any other
needs `--action`. It prints whether the clip is pinned (first-last with the
plate at both ends: idle, attack, hurt, cast, and every items pack).

`sprite-sheet.mjs pack-plate [<facing sheet cut-out>] --character <dir> (--ref <id> | --pack <items pack>) --out <png> [--fill 0.62] [--size W] [--bg #00ff00]`
lays every drawing onto a flat plate, centred in its cell, all at one scale so
the tallest stands `--fill` of its cell, sharing a baseline (items are centred
vertically instead). An items pack takes each item's registered cut-out — its
grid is not the item sheet's — so it takes no picture argument.

`sprite-sheet.mjs pack-split <clip> --character <dir> --pack <id> [--frames N] [--loop|--no-loop] [--gait walk|run] [--trim-start s --trim-end s] [from-video flags]`

1. Crops every cell into `motions/<cell motion>/cell-<clip name>.mp4`
   (x264 crf 10 — the keyer reads its edges next).
2. Reads one window for all cells: each cell's thumbnails keyed and
   **registered** (shifted so the subject's bottom-centre is where the
   median frame's is), their distance matrices averaged, the cycle read off
   the average. Without registration a cell that drifts a few pixels a
   second reads as no cycle (measured: monotonic lag profile 0.023 → 0.129
   on Pip's front-right cell; registered, one clean dip at 23 frames).
   A looping state with no shared cycle samples the whole clip and says so;
   a one-shot takes the first rest → action → rest window.
3. Runs `from-video` on every cell on that window with the same frame count
   (`--frames`, else the period × 12 fps, 6–16) — `--x-from trend` for walk
   and run; an item cell is centred and keeps its float (`--anchor center
   --y-from clip`) unless told otherwise.

Before anything is cut, every cell's first frame is compared with every
other cell's and with the pictures they were shot from (a facing's anchor,
an item's cut-out): two cells that look more alike than their pictures do
(ratio < 0.6) mean the take turned or swapped copies, and `pack-split`
refuses it and writes nothing — the frames a registered take left stay as
they were. `--force` cuts it anyway, after you have looked; `register-pack`
refuses such a report too unless `--force`. Measured on Pip: walk and idle
takes ≥ 0.83 for every pair. Run is the hard state: six 720p run takes
(≈ $11) all failed it — one re-laid the grid into repeated columns (0.23),
another collapsed it to three columns (0.18), and the rest turned the
diagonals into side profiles (0.55; 0.33 even with the diagonal sentence and
the plate pinned as first and last frame). Fast motion pulls Seedance toward
profiles. Offer run as a 4-direction pack (a 2×2 sheet: `facing-prompt --layout 4`,
`add-pack --ref <it>`) or as single-facing clips, and say so before booking an 8-direction run.

The report (`kind: "pack"`) carries `window`, `cycle`, `facingCheck`, and per cell its
motion, direction or item, rect, cropped clip and full run summary.
`register-pack --motion <pack> --report <json|->` registers each cropped clip
on its cell as a derived clip (`op: crop`, `derivedFrom: "<pack>/<video>"`)
and the run on top of it, then marks the pack ready (and an items pack's
`items[].loop`). Measured runs: Pip walk 720p — window 1.792–2.792 s, period
1 s, 12 frames a cell; idle (pinned) — the whole 4.04 s at 16 frames.

## Props sets

`init --set props` records `sprite.set = "props"` and an empty `items[]`;
the `character` block holds the set's name, style sentence and cell, and no
facing. `items-prompt --items "A,B,C…" [--max-cols 5] [--json]` prints the
item sheet prompt (`pack.mjs::itemSheetPrompt`): every item once, numbered in
cell order, one angle, one light from the upper left, one outline weight,
about 65 % of a cell, the white plate — with the grid (`itemGrid`: fewest
empty cells, then the squarest at least as wide as tall), the slug ids and
the `imageSize` (cells of 2048 ÷ the longer side, rounded to 16).

`sprite-sheet.mjs split-items <cut-out> --rows R --cols C --ids a,b,c --out <dir> [--pad 8]`
trims every cell's drawing and centres it on ONE square canvas — the largest
drawing plus the pad — so every icon has the same slot size.
`register-items --report <json|-> --sheet <file> [--labels "A,B,…"] [--model] [--prompt] [--from]`
registers the sheet (`items-sheet-<n>`, a generate edge) and every item
(`item-<id>`, derived from the sheet, `step: split-items`) and upserts
`sprite.items`.

`add-pack` on a props set (`--items a,b|all`) lays the items on a grid at
most four across (a 5:2 plate is wider than a video model takes) with one
looping motion per item, `<item>-loop`, anchored at the centre. Measured: a
first-last 720p clip of a 4×3 plate of ten items gave every item its own idle
— flame flowing along a blade, a glint on a ring, frost light on a staff —
and back to the first frame; `pack-split --frames 32` cut each into a
32-frame loop at 8 fps.

## A move set at once

`plan-moveset [--states idle,walk,run,…] [--source sheet|video] [--packs]`
adds every state not already there with its defaults and prints one quote:

| State | Source | Frames | Fps | Loop |
|---|---|---|---|---|
| idle | clip, pinned | 12 | 12 | yes |
| walk | clip | 12 | 12 | yes |
| run | clip | 10 | 12 | yes |
| jump | sheet | 8 | 10 | no |
| attack | clip, pinned | 12 | 12 | no |
| hurt | sheet | 6 | 10 | no |
| death | sheet | 8 | 10 | no |
| cast | clip, pinned | 12 | 12 | no |
| guard | sheet | 6 | 10 | no |
| victory | clip, pinned | 12 | 12 | no |

`--packs` books one direction pack per state instead (≈ $1.87 each). The
sheet states have their own guards in `sheet-prompt` (hurt, death, cast,
guard, victory joined idle, walk, run, jump, attack and wave in 0.6.0).

## Variants

`init --dir <new> --name "<Name>" --variant-of <content set> --variant "<what changes>"`
copies the original's style, description, cell, facing, purpose, camera,
asymmetry and pixel height (any flag given wins) and records
`character.variantOf: { contentSet, note }`. `variant-prompt [--what turnaround|directions|portrait]`
prints the edit (`remake.mjs::variantEditPrompt`: keep the person and the
layout, "Change only this: …") and the original's file to pass:

```bash
node {SKILL_PATH}/scripts/edit_image.mjs "$(node {SKILL_PATH}/scripts/sprite-project.mjs variant-prompt --dir pip-witch 2>/dev/null)" \
  --input pip/refs/turnaround.png --model sunburst --image-size 2048x2048 --output-dir pip-witch/refs --filename-prefix turnaround
```

Measured: three outfits of Pip (witch, frost mage, pirate), each one Sunburst
edit of her turnaround — the face, hair, eyes and proportions held in every
view; the facing sheet edited the same way kept every facing in its cell.
**Re-check `--asymmetric` on a variant**: the original's sentence is copied,
and the outfit is usually what made something one-sided.

## Restyles

A restyle keeps a motion's movement and changes its look. The movement is
in the clip, so the clip DRIVES the new look — a motion transfer whose
driving clip is the original motion's, not a library performance:

```bash
node {SKILL_PATH}/scripts/sprite-project.mjs add-motion --dir pip-witch --id walk-front --label "Walk front" \
  --rows 1 --cols 1 --fps 12 --loop --source video --direction front --restyle-of pip/walk-front
cp pip/motions/walk-front/cell-video-seedance-1.mp4 pip-witch/motions/walk-front/driver.mp4   # upscale to ≥ 720 px first
node {SKILL_PATH}/scripts/sprite-project.mjs add-driver --dir pip-witch --motion walk-front --file motions/walk-front/driver.mp4 --from pip/walk-front
#   motion-transfer.mjs --image <the new look's front anchor on green> --video <driver> --model kling-mc --orientation image
```

Measured: Pip's front walk cell (upscaled to 720²) drove Witch Pip's front
anchor through the same steps, foot for foot ($0.47). A pack is restyled
cell by cell — eight transfers — because a whole-grid restyle does not keep
the grid: Seedance's reference endpoint (`@Video1` the pack clip, `@Image1`
the new facing sheet) redrew the look but turned every copy to face front
and filled the empty centre; Kling O1's video edit returned the reference
picture as a still. Neither is a restyle.

## The motion library and motion transfer

`library [--id <id>] [--json]` lists ten performances (victory dance, hip-hop
groove, wave hello, sword combo, punch combo, spell cast, hit reaction, jump
for joy, sneak, stretch); `--id` prints the text-to-video recipe that films
one: a realistic performer in plain clothes, whole body in frame, a locked
camera, a plain studio. Film it once per workspace:

```bash
node {SKILL_PATH}/scripts/seedance-video.mjs --endpoint text --prompt "<the recipe>" --aspect-ratio 9:16 \
  --duration 5 --resolution 480p --no-audio --output motion-library/victory-dance.mp4 --json
```

`add-driver --motion <id> --file <inside the character> --from <library id|upload|<set>/<motion>> [--label]`
registers the driving clip as `<motion>-driver` (a generate edge naming the
library entry, an upload edge for the user's video, a select edge for another
character's motion) and sets `motion.transfer`. The character's image goes on
chroma green, padded to the driver's shape (9:16 for a performer):

```bash
node {SKILL_PATH}/scripts/motion-transfer.mjs --image <character>/motions/<id>/still-green-916.png \
  --video <character>/motions/<id>/driver.mp4 --output <character>/motions/<id>/video-kling-1.mp4 \
  --model kling-mc --orientation image --prompt "$(…the recorded motion.prompt…)" --json
```

Register it `add-video --model kling-mc --mode motion-transfer --from <id>-driver`,
then cut it with `from-video` (a dance is a one-shot: `--no-loop`, 24–32
frames). Measured on the victory-dance recipe: Pip (chibi), Kael (anime
swordsman) and Mira (druid) each danced every beat on green ($0.60 each,
4.8 s, ≈ 5 min); the green plate keyed cleanly with the default unmix keyer.
Wan 2.2 Animate Move followed the beats too but pulled Pip toward realistic
proportions and took 10 minutes — `kling-mc` is the default.

`motion-transfer.mjs` refuses a driving clip over 10 s with `--orientation
image` (30 s with `video`), and the wrong model's flags by name.

## Storyboards

```bash
node {SKILL_PATH}/scripts/sprite-project.mjs add-motion --dir mira --id staff-ritual --label "Staff ritual" --rows 1 --cols 1 --fps 12 --source video --no-loop
node {SKILL_PATH}/scripts/sprite-project.mjs set-storyboard --dir mira --motion staff-ritual \
  --beat "0:stands calm" --beat "1:twirls the staff overhead" --beat "2:slams the staff down, leaves swirling" \
  --beat "3:raises the glowing orb high" --beat "4.5:settles back"
#   one keyframe per beat that needs pinning: generate_image.mjs "<style> A single full-body keyframe … pose: …"
#     --image-urls mira/refs/turnaround.png --image-size 1024x1024 --output-dir mira/motions/staff-ritual --filename-prefix key-1
node {SKILL_PATH}/scripts/sprite-project.mjs set-storyboard --dir mira --motion staff-ritual --keyframe "1=motions/staff-ritual/key-1.png" …
node {SKILL_PATH}/scripts/sprite-project.mjs storyboard-prompt --dir mira --motion staff-ritual --duration 5
#   seedance-video.mjs --endpoint reference --ref-image <turnaround> --ref-image <key-1> … --aspect-ratio 1:1 --duration 5 --resolution 720p
```

`--beat "<seconds>:<text>"` adds or replaces the beat at that second;
`--keyframe "<seconds>=<file>"` registers `<motion>-beat-<n>` for it;
`--clear` starts over. The prompt names `@Image1` the turnaround and the
keyframes `@Image2…` in beat order. Measured: Mira's five-beat ritual came
back beat for beat (the twirl, the slam with leaves, the orb raised) — on a
muted grey-green, not a pure plate, with glows and leaves around her: matte
it (`remove-video-background.mjs --model veed`, $0.09), register the matte
as a derived clip, and cut that with `from-video --key none`. The stage shows
the beats above the player.

## The 3D model

`rig-3d.mjs model --image <a cut-out front view> --out <character>/model [--height <m>] [--pose a-pose]`
(Meshy 7.1 image-to-3D with rigging) writes `model.glb` (the rigged
character), `mesh.glb`, `thumbnail.png`, `anim-walk.glb`, `anim-run.glb`.
`rig-3d.mjs animate --model <character>/model/model.glb --actions <names or ids, ≤ 10>`
(Meshy multi-animation) writes `anim-<id>.glb` each; `rig-3d.mjs actions`
lists the catalog (idle, walk, run, jump, attack, sword-slash, thrust, combo,
hammer, archery, punch, kick, block, roll, dodge, hit, death, knockdown,
victory, cheer, dance, cast, spell, …). `register-model --report <json>`
registers both steps: `model-glb`, `model-thumbnail`, `model-anim-<id>`
(images with `metadata.container: "glb"`) and `sprite.model`. Measured on
Pip's front anchor: a textured, rigged chibi with her beret, satchel and
potion vials, $0.80 + $0.08 for eight more clips. Paths in the report are
relative to where `rig-3d.mjs` ran.

## Cutscenes

`add-motion --kind cutscene --id <id> --label <text>` — no grid, no frames,
plays once at 24 fps. One Seedance reference clip: the characters'
turnarounds as `@Image1`, `@Image2` (copy another character's into
`refs/` and `add-ref` it first — files stay inside the character), shot by
shot in the prompt, `--aspect-ratio 16:9 --resolution 720p --duration 8`,
audio on. Registered `add-video --mode r2v`. The stage plays the newest
ready take.

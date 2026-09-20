# Building and accepting the greybox

A greybox is geometry, motion and a camera — nothing else. White and grey
untextured models, one simple light, soft shadows and a little cavity shading
so volumes read. One accent colour is allowed when the story needs it (the
device that turns blue). Everything a video model should *not* have to guess —
where things are, who moves when, what the camera does — is decided here;
everything it is good at — surfaces, light, faces — is left out on purpose.

## Files

`greybox/scene.py` is yours. `previz.mjs render` runs it in headless Blender
and produces everything else: `preview.mp4` or `greybox.mp4`, `scene.blend`
(the editable project — part of the delivery), `scene.glb` +
`scene.meta.json` (what the viewer's 3D lane plays), and `sheet.png`. The PNG
sequence it encodes from lives in `greybox/frames/` and is **deleted once the
MP4 has encoded, decoded and probed clean** — 192 frames of 720p is ~163 MB
per shot, and the MP4 is the artefact. `--keep-frames` keeps them; a render
that failed keeps them without being asked, which is when they are worth
having. Every render is a new revision; an older final is never silently
overwritten as "the" version — the revision number travels with every check
and every take.

## The kit

`scene.py` imports the kit (`import previz_kit as pv`; it is already on
`sys.path` when `render` runs the script). Metres, Z up, times in **seconds**
— the kit converts to frames. A whole shot reads as

> `setup → space → subject → blocking → camera → accent → finish`

| call | what it gives you |
|---|---|
| `pv.setup(seconds, fps, width, height)` | an empty file with the shot's clock and size and the Workbench greybox look (studio light, soft shadow, cavity, grey world). Must match the shot spec — `render` refuses a mismatch |
| `pv.box(name, (x,y,z) size, location, material, parent)` · `pv.cylinder(name, radius, depth, location, …)` · `pv.sphere(…)` · `pv.plane(…)` | primitives; `pv.WHITE`, `pv.GREY`, `pv.DARK` are the three greys. With `parent`, `location` is in the parent's space |
| `pv.room(width, depth, height, door=(x, width))` | floor, three walls and a front wall with a door gap |
| `pv.figure(name, height=1.75, location=(x, y), yaw=0)` | a person-sized **pawn**: a root that travels, one body volume (0.46 m across the shoulders, 0.26 m deep, so the facing reads), a head and a dark visor on its face. No arms, no legs — the body action is the prompt's job. `dims["arm"]` is the 0.72 m reach to check a prop against |
| `pv.travel(fig, [(x,y), …], start, end, settle=0.7, ramp=0.3, pace="walk")` | root motion along the ground path: eased away, one cruise speed, eased to a stop, yaw following the path and rounding its corners. `start` may be **negative** — the figure is already moving at frame 1. The cruise speed is **checked** against `pace` (walk 0.7–1.9 m/s, run 2.5–6.5, `None` to skip) and refused if a gait could not be animated at it. Returns the arrival `(x, y, yaw)` |
| `pv.turn(fig, to_yaw, start, end)` · `pv.hold(fig, start, end)` | turn in place to an absolute yaw; keep the pose (the settled tail) |
| `pv.hinge(name, (x,y), axis="Z")` + `pv.swing(pivot, [(t, degrees), …], ease="EASE_IN_OUT")` | a pivot empty **on the hinge edge**; parent the leaf and its handle to it with `parent=`, then key the absolute angle. `ease="LINEAR"` for a constant rate |
| `pv.move(obj, [(t, (x,y,z)) or (t, (x,y,z), (rx,ry,rz)°)])` | eased keys for a prop that travels: a button going down, a lift, a car |
| `pv.camera(lens, location=…, look_at=…)` + `pv.camera_move(cam, [(t, location, look_at), …], settle=0.5)` | the shot camera aimed at a target; eased keys, and the last key is pulled back so the final `settle` seconds are still — `end-hold`, made structural |
| `pv.accent_material(name)` + `pv.accent(objects, start, end, (r,g,b))` | the one colour event a greybox is allowed: keys the Workbench colour from grey to the accent over `[start, end]` and records it so the 3D lane replays it. Give accented props their own material |
| `pv.set_interpolation(obj, mode="BEZIER", ease="EASE_IN_OUT")` | force the curve shape on something you keyed by hand with raw `bpy` — `"LINEAR"` for keys that are already a sampled curve |
| `pv.finish()` | checks the frame range against the spec, renders the PNG sequence, saves `scene.blend`, exports `scene.glb`, writes `scene.meta.json`. Always the last line |

Two complete worked examples live in
`{SKILL_PATH}/scripts/scene-starter/examples/`: `lab_walk.py` (the eight-second
lab shot — travel, stop, a prop that dips, an accent) and `door_pull.py` (the
same shape with a hinged cabinet door). Read one before writing your first
scene.

### Props that move, bodies that do not

The division of labour is the whole design. The greybox fixes **space,
blocking and camera** — where things are, who is where and facing which way at
each second, what the lens does. It says nothing about limbs: a gait, a hand
rising, a press is what the video model is good at and what boxes are bad at,
and a model conditioned on a puppet paints a puppet. So the figure travels and
turns, and the prompt says "walks in, raises the left hand and presses the
button".

A **prop is different** — a door opening is a spatial event, and a video model
asked to invent one will invent a different one. Keep it:

```python
door = pv.hinge("cabinet_door", (0.45, 4.35))          # the pivot, on the hinge edge
pv.box("cabinet_leaf", (0.72, 0.04, 1.85), (-0.36, -0.02, 1.02), pv.GREY, door)
pv.box("cabinet_handle", (0.035, 0.05, 0.40), (-0.63, -0.055, 1.20), pv.DARK, door)
pv.swing(door, [(5.5, 0), (6.8, 68)])                  # absolute degrees, eased
```

Then **cause before effect**: the interior accent starts at 5.75 s, *after* the
door began to move at 5.5 s — never the same frame, never before.

Two things to get right when a body meets a prop:

* **Stop within reach, facing it.** `fig["dims"]["arm"]` is 0.72 m at the
  1.75 m default. If the prompt says the hand presses something, the something
  has to be closer than that to the shoulder, or the take invents a lunge.
* **Stay out of the swing.** A leaf `w` metres long sweeps a disc of radius `w`
  about its hinge; keep the figure's root further than `w` + half its body
  width from the hinge and nothing passes through anything.

`pv.travel(..., start=-0.6)` is worth knowing: a negative start means the
travel began before the shot did, so frame 1 opens on someone already walking
instead of someone standing still waiting for their cue.

The kit is a vocabulary, not a fence: `bpy` is fully available in `scene.py`,
and anything the kit lacks (a vehicle, an animal, a second storey) you build
with it — keep the same grammar: a root that travels, parts that move relative
to it, keys on whole frames, everything in metres with Z up.

## Build order

Each layer is checked before the next hides its mistakes.

1. **Layout.** Floor, walls, entrance, the main props at their real sizes (a
   door 2.0–2.1 m, a counter 0.9 m, a fridge about 2 m — the model reads a
   person's height off the props around them), a pawn for each person at its
   start and end positions. Check: can the figure get through (passage
   ≥ 0.8 m)? Does the camera see the subject, the prop and the reaction in one
   frame? Does each person stop within arm's reach (`fig["dims"]["arm"]`,
   0.72 m) of what they will touch, facing it? Render one still before
   animating.
2. **Blocking.** Each pawn's path, start and stop seconds and facing, from the
   plan's arithmetic. `travel` refuses a pace no walking body has; believe it
   and fix the plan, not the pace check.
3. **Prop events and reactions.** The door swings, the button dips, the light
   comes on — the spatial consequences of what the body will do. An effect
   starts after its cause has visibly begun, never on the same frame. A blue
   accent material is enough to say "it is on"; do not depend on glow
   post-processing.
4. **Camera, last.** Slow, eased, no interpolation overshoot. By default the
   camera and the main action are still for the last half second; when the
   user wants motion through the end, that wins.

Nothing in a greybox bends. If you find yourself wanting an arm so the reach
"reads", write the reach into the prompt with its second instead — that is
where it will actually come from.

## Render and verify

1. `render --preview` — the whole timeline at half size. Cheap; do it often.
2. Look. `sheet --at …` for the key moments; `sheet --strip a,b` for every
   consecutive frame in a range. Check where each pawn is at every beat, the
   start and stop transitions, the frames either side of the trigger, and the
   end. Stills prove positions; only neighbouring frames prove the absence of
   jitter and of a camera that drifts.
3. Record each item with `check`. Fix what fails; re-render; re-check what the
   fix could have touched.
4. `render` — the final pass. It writes a PNG sequence first (a long render
   can resume from it), encodes H.264 / yuv420p, decodes the whole file to
   catch broken frames, and records what ffprobe measured: codec, size, frame
   rate, frame count, duration. The frames are deleted once the MP4 has passed
   (`--keep-frames` keeps them; a failed render always does). A clean encode
   is not an accepted shot.

## The acceptance list

| id | what must be true | how to look | when it fails, fix |
|---|---|---|---|
| `frame-count` | frames = seconds × fps, size and fps as specified | `render` records it from ffprobe | the scene's frame range or the spec |
| `blocking` | every subject is where the plan says, facing what it says, at the second it says | `sheet --at` on the beat edges | the path, its start/end seconds, a `turn` |
| `pace` | distances are covered at a speed a body can move at | `travel` logs distance and cruise speed and refuses the impossible; read the log | the distance, the duration, or the number of beats — never the validator |
| `framing` | the subject, the prop and the reaction are in frame when the shot is about them; nothing important hides behind a prop | stills at each beat | camera position, lens, where the figure stops |
| `penetration` | no figure passes through a prop or a wall, no door sweeps through a figure | stills where paths come close, a strip across a door swing | the path, the stop point, the hinge side |
| `trigger-order` | the effect starts after the cause has begun, never before | strip across the trigger second | the effect's first key |
| `camera-smooth` | no jitter, no overshoot, eased start and stop | a strip of the last second and of any direction change | duplicate keys, constraint switches, interpolation |
| `end-hold` | last ≈ 0.5 s settled (unless motion was asked for) | strip of the final half second | end keys, the settle window |
| `ref-framing` *(recreate)* | subject position and size on screen match at key moments | `compare --b reference --blend` | camera position, lens, subject path |
| `ref-timing` *(recreate)* | events land on the reference's seconds | `compare --b reference` side by side | the beat times |
| `take-motion` | the person follows the pawn's path on the pawn's seconds, and performs the prompted action | `compare --b take-NN` | the prompt's action timeline, or a clearer greybox |
| `take-body` | the body moves naturally: real steps, no gliding, no stiff or extra limbs in motion | a strip of the take's walk | the body-action sentences ("real steps, never gliding") |
| `take-camera` | the take keeps the camera move and its ending | `compare --b take-NN` at the last beat | the prompt's camera sentence, the final-framing sentence |
| `take-order` | cause still precedes effect in the take, and the action before it can be seen | a strip of the take around the trigger | state the order, the visibility and the ramp duration in the prompt |
| `take-integrity` | the same number of people, whole limbs, no cut, no captions | the take's own sheet | the structure sentence of the prompt |

Statuses are `pass`, `fail` and `unverified`. A `pass` names what was looked
at (`--note "sheet 0.25–7.8 s"`). Anything not actually examined stays
`unverified` — writing "all passed" over it is the one thing this record
exists to prevent.

## When to stop

Change only the part that is wrong. If the same check fails on two
consecutive revisions, `status` reports it as `stuck`: keep the current
version, tell the user which seconds fail, what you tried and why it did not
work, and stop. They can steer; an agent rendering its tenth variation of the
same prop cannot.

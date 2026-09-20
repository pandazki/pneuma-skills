# The camera vocabulary

The camera is the other half of what a greybox buys. A video model asked in
words for "orbit around them" will drift, cut, or simply push in; the same move
keyed in the greybox arrives intact. Read this with `greybox.md` — the moves
here are the last layer of the build order, after layout, blocking and prop
events.

Every move below still needs its **final framing named in the prompt**. The one
camera failure that survived the blind trials was a model that kept pushing
past the reference's last frame, and the fix was a sentence, not a key.

## Two behaviours that hold for every camera call

1. **A move owns its channel from frame 1 when nobody else does.** A move that
   begins at 2 s on a camera nothing has keyed would otherwise leave the camera
   parked where it was built until frame 48 and then *pop* onto the start of
   the move. Instead the opening station (or focal length) is held from frame
   1, which is the shot the author drew. When a `camera_move` already owns
   those frames, the later move keeps its hands off them.
2. **A move that would start somewhere else than where the camera already is
   is refused.** The refusal names the frame, what is already animated there,
   what this move opens at, and the fix — the orbit's or dolly zoom's
   position, or the zoom's focal length. The shot would *cut* there, and a cut
   inside one clip is exactly what a greybox exists to prevent. Take the
   refusal as an instruction: change the opening value so the move begins from
   the frame the shot is already on.

## Orbit

```python
pv.orbit(cam, center, radius, height, deg_from, deg_to, start, end, look_at=None, ease=True)
```

The camera travels an arc of `radius` metres at `height` metres around
`center` — an `(x, y)`, a figure, or an object — while a TRACK_TO holds on
`look_at or center`, so the middle of the shot stays in the middle of the
frame. Returns the camera handle.

- **Angles are ordinary maths angles in the ground plane**: 0° is the +X side
  of the centre, 90° the +Y side.
- **They are absolute, not a sweep.** `deg_from=0, deg_to=540` is one and a
  half turns the long way round; a negative sweep goes the other way. Choose
  the two numbers that describe where the camera *stands*, and the direction
  falls out of their order.
- **Keyed on every frame and left LINEAR**, because the easing is already in
  the samples. Two eased keys would cut the chord across the arc and the
  camera would pass through the middle of the shot.
- `look_at` defaults to the centre at the height the camera's target already
  sits at, so the tilt you set in `camera(..., look_at=…)` survives.
- `start` may be negative: the orbit was already running when the shot began.

Reading notes from the material:

- **Keep the radius constant.** An orbit that also pushes in is two moves, and
  the model will do one of them.
- **40–90° over 4–6 s** is the readable band. Under 30° it looks like a wobble;
  over 120° in six seconds is a whip and the background smears.
- **Height matters more than degrees.** An orbit at 1.6 m reads as a circling
  observer; at 3 m it reads as a drone and flattens the fight.
- A duel filmed from 6–9 m reads; the call refuses a radius under 0.2 m,
  because from zero the camera is inside the fight.
- Say it in the prompt: *"the camera orbits continuously to the left around the
  pair and ends on a wide two-shot with both fighters fully in frame. One
  continuous shot, the camera never cuts."*

## Zoom

```python
pv.zoom(cam, mm_from, mm_to, start, end, ease=True)
```

Animates the focal length; the camera does not move. A zoom is not a push-in:
the perspective does not change, so it reads as a flat, deliberate, slightly
artificial emphasis. Use it when that is what you want, and `camera_move` when
you want a real push. Returns the camera handle.

**The 3D lane may not show it.** glTF carries no lens animation, so `zoom`
also writes the curve into `scene.meta.json` as
`camera_lens: [{ frame, mm }, …]`. The Workbench MP4 — the file the video
model is actually conditioned on — always has it. If the browser's 3D
inspection view looks like a static lens, check the render before you call it
a bug.

## Dolly zoom

```python
pv.dolly_zoom(cam, subject, dist_from, dist_to, start, end, ease=True)
```

Hitchcock. The camera travels its own sightline toward or away from `subject`
— a point, an object, or a figure (in which case it is the figure's chest,
where its tracks put it at `start`) — from `dist_from` to `dist_to` metres,
while the focal length scales by the same ratio. **The subject's on-screen
height holds and the background rushes**; the compensation starts from the
camera's current focal length, and a result outside a real lens is refused.
Returns the camera handle.

That constancy is the whole effect: if the subject changes size, it is not a
dolly zoom, it is a mistimed push. It only reads when three things are true:

1. **There is depth behind the subject** — a colonnade, a tower, a receding
   terrace. Against a flat wall nothing happens, because there is nothing for
   the perspective to move.
2. **The subject holds still**, or nearly. A subject walking during a dolly
   zoom fights the compensation and the effect disappears.
3. **It has room**: 1.5–2.5 s and a real distance change (3 m → 8 m, not 3 m →
   4 m). Too short reads as a glitch.

Use it once, on the beat that deserves it — the moment a fighter lands, the
moment somebody realises where they are. Twice in one film is once too many.

## Crane

**There is no `crane` function.** A crane is `pv.camera_move` with a rising (or
falling) location and a `look_at` that stays on the action, optionally with a
`zoom` over the same window:

```python
pv.camera_move(cam, [
    (0.0, (0.0, -7.0, 1.6), (0.0, 0.0, 1.2)),
    (4.5, (0.0, -8.5, 6.5), (0.0, 0.0, 1.0)),
], settle=0.5)
```

Rise slowly — under about 1.5 m/s — keep the target on the ground action so the
horizon tilts rather than the subject sliding out of frame, and let the last
half second settle. A crane at the end of a film is a closing gesture: name the
final wide framing in the prompt so the model does not keep climbing.

## Aiming at where somebody *will* be

```python
x, y, z, yaw = pv.pose_at(fig, 3.8)
```

`pose_at` answers where a figure is and which way it faces at any shot time,
as `(x, y, z, yaw_radians)`, read straight off its tracks before `finish`
bakes anything. Tracks carry forward, so a `travel` that has ended still holds
its arrival. Use it to aim a camera at the mark somebody arrives on rather than
the mark they were built on — and to place an orbit's centre between two
fighters at the second the strike lands.

## The collage — several shots, one space

A single beat can be several shots: one strike cut from three cameras reads as
choreography that no single generated clip delivers. **A collage is something
the cut does, not something one shot does.** There is no `camera_cut()` in the
kit and there should not be: a shot here is one continuous clip that one take
is conditioned on, and a clip that cuts inside itself asks the model to invent
two framings and the edit between them — which is the judgement the greybox
exists to take away. `take-integrity` checks for exactly that.

So the strike is three shots, registered like any others, each with its own
camera block and its own take, put back-to-back by `cut/edl.json`. Each asks
the model for less, and a failed take costs one angle instead of the whole
beat.

**The mechanism is the trim.** `generate` will not return less than 4 s, so
every angle is its own **≥ 4 s shot** — blocked, rendered and generated at
that length — and then trimmed to the second or so the film actually uses:

```bash
node {SKILL_PATH}/scripts/previz.mjs meta <shot-dir> --trim-in 1.9 --trim-out 3.1
```

The trim is a range on the shot's own clock; the greybox, the take and every
beat still run on the full clock, and only the cut sees less. Three 4 s takes
become three ~1.2 s segments, and the paid work is three short takes rather
than one long clip that has to invent its own edit. A re-trim turns the
`boards` stage `changed`, so the creator re-approves the shot list — the shot
list they approved is the one the film plays.

Five rules make three angles cut together:

1. **Write the blocking once and reuse it.** Same `build_courtyard()`, same
   `duel_pawns()`, same marks, same seconds. If angle B's fighters stand 30 cm
   from where angle A's do, no prompt will rescue the cut.
2. **Give every angle the same clock for the shared moment.** If the strike
   lands at 2.4 s in A, it lands at 2.4 s in B and C, even when the shots are
   different lengths — then each trim is taken around that second, and the cut
   works on any frame of it.
3. **Change only the camera block between the files.** That is the whole diff,
   and it is what makes a re-blocking cheap: fix `courtyard.py`, re-render
   three shots.
4. **Do not cross the line.** Pick a side of the axis between the two fighters
   and keep all three cameras on it, or a fighter changes shoulders between
   cuts. `orbit`'s absolute angles make this checkable: if the axis runs at
   about −25°, cameras between −115° and 55° are all on one side of it.
5. **Prompt each take with the same action sentence and its own framing
   sentence.** The action is what has to match across the cut; the framing is
   what makes the three clips worth cutting.

## The worked examples

In `{SKILL_PATH}/scripts/scene-starter/examples/`:

| file | what it shows |
|---|---|
| `courtyard.py` | the reusable set: `build_courtyard()`, `duel_pawns()`, plus the helpers `facing()`, `ring()` and `strut()` |
| `duel_orbit.py` | 6 s — a long orbit around the pair |
| `duel_dolly_zoom.py` | 4 s — the Hitchcock move on a landing fighter |
| `duel_crane.py` | 5 s — a crane rise built from `camera_move` and a `zoom` |
| `duel_collage.py` | the three-camera pattern, in prose. **It builds nothing and refuses to render on purpose** — run it and it prints the pattern and exits non-zero. Copy one of the three angles into `greybox/scene.py` instead |

Read one before writing your first camera block.

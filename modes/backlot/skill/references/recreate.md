# Recreating a reference video

Some shots do not start from a written beat — they start from a video the
creator hands you and wants rebuilt. The job is to turn what can be *observed*
in that video — framing, spatial relations, the rhythm of the action, the
camera move — into an editable greybox, and then generate a new video in the
look they want. It is a reconstruction in 3D.

**Do not rotoscope.** Feeding the original to a model and restyling it is a
different job, and calling that a recreation would be a lie about what was
made. The reference is something you study; the video model never receives it
as the motion source.

## Where it sits in the eight stages

A recreate shot replaces the *planning* half of one shot, not the film:

- **Stages 1–3 still apply when the shot belongs to a film.** The people in
  the reference are still characters with sheets and voices; the place is
  still a set with a concept frame. That is what makes a recreated shot cut
  together with the shots around it.
- **Stage 4** — instead of inventing the timeline, you read it off the
  reference (below) and write the same `shot-plan.md` and beats. Nothing is
  drawn here either: the reference decides the blocking, and the *look* is
  decided at the key frame, which is rendered from the greybox once it passes
  (`greybox.md`).
- **Stages 5–8 are unchanged.** The greybox gains two extra acceptance checks,
  `ref-framing` and `ref-timing`, and the shot gains a fourth lane so the
  player can run reference, greybox and take on one clock.

When the creator brings a single reference video and no film — "rebuild this
shot" — say plainly which stages you are skipping and that the result is one
shot, not a film.

## Read the video first

```bash
node {SKILL_PATH}/scripts/previz.mjs reference <shot-dir> <video> [--in s --out s] [--adopt-spec]
```

- The script reports the **real** duration, frame rate and size, the cuts it
  found, and writes `reference/source.mp4` (the trimmed segment),
  `reference/frames/` and `reference/sheet.png`. Open the sheet, then individual
  frames where the action turns.
- If the file or link cannot be read, try what you have (a browser, a
  download); if that fails, say so and ask for a readable file. While you wait
  you may prepare the project and its parameters. You may not describe shots
  you have not seen — a title is not footage.
- **One shot per continuous take.** A reference with cuts becomes several
  shots, in the original's order, registered with `backlot.mjs shot add` like
  any others, unless the creator picked a segment. Ask only when an ambiguity
  such as the segment's range actually blocks the work.
- `--adopt-spec` takes the reference's duration, fps and size as the shot's
  spec (duration rounded to whole frames). Use it unless the creator gave
  their own. Remember the floor: Seedance will not return less than 4 s, so a
  2-second reference segment becomes a 4-second shot or part of a longer one.
- If the creator named no target look, finish the greybox first; for the final
  generation assume a clean, restrained look, and write that assumption down.

## What to extract into the plan

For each shot: time range; composition (where the subject sits in frame and how
large — head-to-toe as a fraction of frame height is the most useful single
number); the ground plane and where the props stand on it; the path the
subject travels, where it stops and which way it faces; the camera — static,
pan, tilt, push, track, orbit, crane, handheld — with direction and rough
speed. Those are what the greybox rebuilds.

What the body does — the gait, a hand on a rail, a look over the shoulder —
you describe in words, with its second, for the prompt's action timeline. Do
not try to reproduce limb motion in 3D: the greybox's people are pawns, and a
recreated performance comes from the model reading your description, not from
a box rig imitating it.

Keep two columns: **observed** and **estimated**. A monocular video does not
determine depth, and what is hidden is hidden. Build only as much of the unseen
structure as the frame needs to stand up, and never call the result an exact
reconstruction.

## Estimating the space

1. **Scale from something you know.** A door is about 2.0–2.1 m, a standing
   adult 1.6–1.85 m, a table 0.72–0.76 m, a car about 4.5 m long. Pick one,
   state it as the scale assumption, size everything else from it. If the shot
   belongs to a set that already has a bible record, its dimensions win —
   reconcile the reference to them rather than building a second room.
2. **Lens from perspective.** Strong convergence and large foreground objects
   mean a wide lens (18–28 mm); flat, compressed depth means a long one
   (70 mm+); an unremarkable interior is usually 28–40 mm. Start there.
3. **Camera height and tilt from the horizon.** The horizon line sits at
   camera height on everything standing on the ground: if it crosses a standing
   adult at the chest, the camera is about 1.3 m up.
4. **Match stills before motion.** Set the first frame's camera so the greybox
   silhouette lands on the reference's — subject position, subject size,
   horizon, the main prop's edges. Then the last frame. Only then animate
   between them. Tuning motion against an unmatched frame wastes revisions.

## Compare, and write it down

```bash
node {SKILL_PATH}/scripts/previz.mjs compare <shot-dir> --a greybox --b reference --at 0.2,1.5,3.0,4.4 [--blend]
```

Side by side shows timing and direction; `--blend` overlays the two at 50 % so
silhouettes either coincide or visibly do not. At each key moment compare:

- where the subject is on screen, and how large
- the direction of motion
- the second each event happens
- proximity — is the subject standing where it must stand to touch what the
  reference shows it touching

Locate the deviation, fix that part, compare again. Record the result in
`comparison.md`: a row per key moment, what matches, what differs and by
roughly how much, and what stayed unmatched and why. "The style is different"
is not an entry — style is the one thing a greybox is *supposed* to lack, and
the phrase is how framing and timing errors get waved through.

Record `ref-framing` and `ref-timing` with `check` like any other item.

When the creator asks for a simplified version, keep the action and the camera
rhythm and drop decoration — never the other way round.

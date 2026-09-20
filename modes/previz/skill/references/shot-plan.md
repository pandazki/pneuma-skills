# The shot plan

The plan is the contract between the three lanes. The greybox is built from
it, the prompt's timeline is copied from it, and the take is checked against
it. Write it before you touch Blender; an action you have not timed on paper
will be timed by accident in the scene.

Every line of the timeline lands in one of two places, and the plan says
which. **Blocked** lines are the greybox's: where a person is, the path they
travel, when they start and stop, which way they face, a door that swings, a
light that comes on, the camera. **Acted** lines are the prompt's: how the
body does it — the gait, the raised hand, the glance, the expression. A
greybox person is a pawn; nothing in the acted column is ever animated.

## What `shot-plan.md` holds

1. **Idea** — one sentence. If it needs two, it is probably two shots.
2. **Layout** — the space in metres: room size, where the entrance is, the
   main props and their positions, where the subject starts and ends. Real
   distances, because the timeline is computed from them.
3. **Timeline** — a table in seconds: what happens from when to when, with a
   column saying whether the line is *blocked* (greybox) or *acted* (prompt).
4. **Camera** — lens, start position and what it looks at, the move, its
   speed, how it ends.
5. **Triggers** — every cause → effect pair, with the second the cause lands
   and the second the effect starts.
6. **End state** — what is on screen in the last half second.
7. **Assumptions** — every value the user did not give and you chose. Default
   duration, size and frame rate always appear here when you used them.

In a recreate job add two columns to the timeline — *observed* and *estimated*
— and keep them honest: what is behind the subject, any depth, anything
occluded is an estimate.

## Timing arithmetic

Do the sums; they decide whether the action fits.

| quantity | working value |
|---|---|
| relaxed walk | 1.2–1.4 m/s; brisk 1.5–1.7 m/s |
| stride cycle (two steps) at 1.75 m tall | ≈ 1.4 m, a little under 1 s |
| stopping from a walk | 0.6–0.8 s of decelerating, the last step shorter |
| standing still before a deliberate gesture | 0.2–0.4 s |
| raising a hand to waist/chest height | 0.8–1.0 s |
| a reaction that should read as "slow" (a glow, a door) | 1.5–2.5 s |
| establishing beat before anything moves | 0.4–0.6 s |
| settled tail | ≈ 0.5 s unless the user wants motion through the cut |
| "slow" camera push | under 0.5 m/s, eased at both ends |

A walk of 5.5 m at 1.5 m/s needs about 3.3 s plus 0.7 s to stop: that is half
of an 8-second shot. If the actions do not fit, shorten the distance, cut an
action or lengthen the shot — never raise the speed. The pawn glides by
design, and the model gives it a gait at exactly that speed: a pawn crossing
six metres in two seconds comes back as a sprint, whatever the prompt says.
The kit's `travel` refuses a pace no walking body has.

Order every pair so the cause is complete before the effect begins, and leave
the body time to arrive: *walk → settle → gesture → contact → reaction → hold*.

## The worked example (use it only when the brief matches)

An 8-second lab shot, 24 fps, 192 frames:

| s | what happens | where it lives |
|---|---|---|
| 0.0–0.5 | the doorway establishes; nobody moves | blocked |
| 0.5–3.8 | the researcher crosses from the door to the console, 5.5 m | blocked (path, pace) · acted (a relaxed walk) |
| 3.8–4.5 | slows and stands at the console, facing the device | blocked (the stop) · acted (the last step) |
| 4.5–5.5 | raises the left hand and presses the button | **acted only** — the greybox shows the button dip at 5.4 s |
| 5.5–7.5 | the device at the centre brightens blue — after the touch, never before | blocked |
| 7.5–8.0 | camera and figure hold | blocked |
| 0.0–7.5 | the camera pushes in and settles | blocked |

The times move with distance and pace. They do not move to make a crowded
plan fit.

## Beats

The same timeline, registered so the viewer can draw it and the checks can
point at it:

```json
[
  { "id": "establish", "label": "Doorway establishes", "from": 0, "to": 0.5, "kind": "hold" },
  { "id": "walk", "label": "Walks to the console", "from": 0.5, "to": 3.8, "kind": "action" },
  { "id": "settle", "label": "Slows and stands", "from": 3.8, "to": 4.5, "kind": "action" },
  { "id": "touch", "label": "Raises a hand to the button", "from": 4.5, "to": 5.5, "kind": "action" },
  { "id": "glow", "label": "Device brightens blue", "from": 5.5, "to": 7.5, "kind": "trigger", "causedBy": "touch" },
  { "id": "push", "label": "Camera pushes in, settles", "from": 0, "to": 7.5, "kind": "camera" },
  { "id": "hold", "label": "Everything holds", "from": 7.5, "to": 8, "kind": "hold" }
]
```

`kind` is `action`, `trigger`, `camera` or `hold`. A `trigger` names its
`causedBy` beat, and the script refuses one that starts before its cause does.
An acted-only beat (the raised hand) is still a beat: the viewer draws it, the
prompt copies its seconds, and `take-motion` is checked against it.
Labels are what the user reads on the timeline: short, in their language.

When the plan changes, change the beats in the same breath — a timeline the
viewer draws that the greybox no longer follows is worse than none.

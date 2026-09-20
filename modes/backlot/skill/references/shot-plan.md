# The shot plan

Stage 4, per shot. The plan is the contract between the lanes: the greybox is
built from it, the board frame is composed from it, the prompt's timeline is
copied from it, and the take is checked against it. Write it before you touch
Blender; an action you have not timed on paper will be timed by accident in
the scene.

Every line of the timeline lands in one of two places, and the plan says
which. **Blocked** lines are the greybox's: where a person is, the path they
travel, when they start and stop, which way they face, a door that swings, a
light that comes on, the camera. **Acted** lines are the prompt's: how the
body does it — the gait, the raised hand, the sword form, the glance, the
expression. A greybox person is a pawn; nothing in the acted column is ever
animated.

## What `shots/<id>/shot-plan.md` holds

1. **Idea** — one sentence. If it needs two, it is probably two shots.
2. **Ties** — the scene it belongs to, the characters in frame, the set. The
   same values you register with `backlot.mjs shot add` or
   `previz.mjs meta --scene --characters --set`; `generate` reads them to
   decide which bible sheets go to the model, so a character missing here is a
   face missing from the take.
3. **Layout** — the space in metres: room or terrace size, where the entrance
   is, the main props and their positions, where each subject starts and ends.
   Real distances, because the timeline is computed from them, and the set's
   own dimensions come from the bible record — do not invent a second room.
4. **Timeline** — a table in seconds: what happens from when to when, with a
   column saying whether the line is *blocked* (greybox) or *acted* (prompt).
   The shot's lines sit on this table too, at the second each one starts.
5. **Camera** — lens, start position and what it looks at, the move (see the
   camera vocabulary in `camera.md`), its speed, and how it ends.
6. **Triggers** — every cause → effect pair, with the second the cause lands
   and the second the effect starts.
7. **End state** — what is on screen in the last half second.
8. **Assumptions** — every value the creator did not give and you chose.
   Default duration, size and frame rate always appear here when you used them.

In a recreate job add two columns to the timeline — *observed* and *estimated*
— and keep them honest: what is behind the subject, any depth, anything
occluded is an estimate.

## Timing arithmetic

Do the sums; they decide whether the action fits, and they decide the shot's
duration back in the screenplay breakdown.

| quantity | working value |
|---|---|
| relaxed walk | 1.2–1.4 m/s; brisk 1.5–1.7 m/s |
| stride cycle (two steps) at 1.75 m tall | ≈ 1.4 m, a little under 1 s |
| stopping from a walk | 0.6–0.8 s of decelerating, the last step shorter |
| a run | 2.5–6.5 m/s — the kit's `run` pace band |
| a leap or a burst of speed | faster than any walk; `dash` carries it and validates its own band. Read its refusal, do not widen the walk paces |
| standing still before a deliberate gesture | 0.2–0.4 s |
| raising a hand to waist/chest height | 0.8–1.0 s |
| a single sword strike, draw to contact | 0.4–0.7 s; the recovery another 0.3–0.5 s |
| a reaction that should read as "slow" (a glow, a door) | 1.5–2.5 s |
| establishing beat before anything moves | 0.4–0.6 s |
| settled tail | ≈ 0.5 s unless the creator wants motion through the cut |
| "slow" camera push | under 0.5 m/s, eased at both ends |
| speech | 2.5–3.5 words per second |

A walk of 5.5 m at 1.5 m/s needs about 3.3 s plus 0.7 s to stop: that is half
of an 8-second shot. If the actions do not fit, shorten the distance, cut an
action, split the beat into two shots, or lengthen the shot — **never raise
the speed**. The pawn glides by design, and the model gives it a gait at
exactly that speed: a pawn crossing six metres in two seconds comes back as a
sprint, whatever the prompt says. The kit's `travel` refuses a pace no walking
body has, and `dash` is the call for the ones a walk cannot cover.

Order every pair so the cause is complete before the effect begins, and leave
the body time to arrive: *walk → settle → gesture → contact → reaction → hold*.

## A worked example

Six seconds, 24 fps, 144 frames — the challenger crosses the terrace and the
keeper turns to meet him:

| s | what happens | where it lives |
|---|---|---|
| 0.0–0.5 | the terrace establishes; nobody moves | blocked |
| 0.5–3.2 | the challenger crosses 3.6 m from the stair to the terrace centre | blocked (path, pace) · acted (an unhurried walk, coat moving) |
| 1.4–2.9 | the keeper's line, `l1` | acted (spoken — the model renders it) |
| 3.2–3.8 | he slows and stops, facing the keeper | blocked (the stop) · acted (the last step) |
| 3.8–4.6 | his right hand settles on the sword hilt | **acted only** — no limb exists in the greybox |
| 4.4–5.2 | the keeper turns to face him | blocked (a `turn`) |
| 0.0–5.5 | the camera orbits 40° around the pair and settles | blocked |
| 5.5–6.0 | both hold; the camera is still | blocked |

The times move with distance and pace. They do not move to make a crowded
plan fit.

## Beats

The same timeline, registered so the viewer can draw it and the checks can
point at it:

```bash
node {SKILL_PATH}/scripts/previz.mjs beats <shot-dir> --set beats.json
```

```json
[
  { "id": "establish", "label": "The terrace holds", "from": 0, "to": 0.5, "kind": "hold" },
  { "id": "cross", "label": "The challenger crosses", "from": 0.5, "to": 3.2, "kind": "action" },
  { "id": "settle", "label": "He stops, facing the keeper", "from": 3.2, "to": 3.8, "kind": "action" },
  { "id": "hilt", "label": "His hand settles on the hilt", "from": 3.8, "to": 4.6, "kind": "action" },
  { "id": "turn", "label": "The keeper turns to meet him", "from": 4.4, "to": 5.2, "kind": "trigger", "causedBy": "settle" },
  { "id": "orbit", "label": "Camera orbits and settles", "from": 0, "to": 5.5, "kind": "camera" },
  { "id": "hold", "label": "Both hold", "from": 5.5, "to": 6, "kind": "hold" }
]
```

`kind` is `action`, `trigger`, `camera` or `hold`. A `trigger` names its
`causedBy` beat, and the script refuses one that starts before its cause does.
An acted-only beat (the hand on the hilt) is still a beat: the viewer draws
it, the prompt copies its seconds, and `take-motion` is checked against it.
Labels are what the creator reads on the timeline: short, in their language.

When the plan changes, change the beats in the same breath — a timeline the
viewer draws that the greybox no longer follows is worse than none. The beats
are part of the `boards` stage's content, so editing them after approval turns
that stage `changed` and closes the gate in front of `generate` until the
creator has seen the new version.

## Then the board

The plan says what happens; the board frame shows what it looks like. Generate
one still per shot from the bible images (`bible.md`), register it with
`previz.mjs board <shot-dir> --file board.png --prompt "…" --refs …`, and put
the board's composition and the plan's layout in the same room: if the board
frames the pair from a low angle and the plan puts the camera at 1.6 m, one of
the two is wrong, and it is cheaper to find out now than in the take.

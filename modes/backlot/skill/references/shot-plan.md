# The shot plan

Stage 4, per shot, and **it makes no image**. The plan is the contract between
the lanes: the greybox is built from it, the prompt's timeline is copied from
it, and the take is checked against it. Write it before you touch Blender; an
action you have not timed on paper will be timed by accident in the scene.

**Design the picture in words first, then build the greybox, then hand the
model that block and those words.** This stage is where the film is actually
directed: what each beat *looks* like — the body, the face, the cloth, the
dust, the speed — is written here, in words, before a single Blender
primitive exists. The greybox is built from this plan, and at the takes stage
the prompt is assembled *from these same words* plus what the greybox cannot
express plus the bible's faces and the film's style frame. Nothing about the
picture is invented fresh in `prompts.md`; a shot designed at the takes stage
is a shot the creator never approved.

Every line of the timeline lands in one of two places, and the plan says
which. **Blocked** lines are the greybox's: where a person is, the path they
travel, when they start and stop, which way they face, a door that swings, a
light that comes on, the camera. **Acted** lines are the prompt's: how the
body does it — the gait, the raised hand, the sword form, the glance, the
expression. A greybox person is a pawn; nothing in the acted column is ever
animated — which is exactly why the acted column has to be *written*.

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
4. **Timeline** — a table in seconds: what happens from when to when, a column
   saying whether the line is *blocked* (greybox) or *acted* (prompt), and a
   **detail** column holding the designed picture of that beat in one sentence.
   The shot's lines sit on this table too, at the second each one starts.
5. **Camera** — lens, start position and what it looks at, the move (see the
   camera vocabulary in `camera.md`), its speed, and how it ends. **One move
   per shot**: a second move is a second shot.
6. **Triggers** — every cause → effect pair, with the second the cause lands
   and the second the effect starts.
7. **Entry state** — what is on screen in the first half second: each body's
   position, facing, weapon and any contact. When this shot continues the
   previous one's action, this sentence *is* the previous shot's exit sentence
   — and it is the **only** thing the model is told about the join, so write
   it as a picture rather than as a label.
8. **Exit state** — the last half second in the same grammar, because the next
   shot's entry is written from it, and because the frame it produces is what
   `take-handoff` is judged against.
9. **Continuity decision** — how this shot is cut *into*, one of the five
   below, with the one-line reason.
10. **Assumptions** — every value the creator did not give and you chose.
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

| s | what happens | where it lives | detail — the designed picture |
|---|---|---|---|
| 0.0–0.5 | the terrace establishes; nobody moves | blocked | dusk, dust drifting through low side light; the keeper motionless under the tree |
| 0.5–3.2 | the challenger crosses 3.6 m from the stair to the terrace centre | blocked (path, pace) · acted (the gait) | an unhurried weighted walk, real steps, never gliding; the travelling coat swings behind him, dust off each heel |
| 1.4–2.9 | the keeper's line, `l1` | acted (spoken — the model renders it) | said low and flat, jaw barely moving, eyes on the challenger's sword hand |
| 3.2–3.8 | he slows and stops, facing the keeper | blocked (the stop) · acted (the last step) | the last step shortens and plants; the coat keeps going for a beat, then settles |
| 3.8–4.6 | his right hand settles on the sword hilt | **acted only** — no limb exists in the greybox | the hand rises slowly and closes on the hilt without drawing; knuckles tighten |
| 4.4–5.2 | the keeper turns to face him | blocked (a `turn`) | the head goes first, then the shoulders; his robe lifts and falls back |
| 0.0–5.5 | the camera orbits 40° around the pair and settles | blocked | slow, level, the pair held mid-frame; ends on a wide two-shot, both fully in frame |
| 5.5–6.0 | both hold; the camera is still | blocked | nothing moves but the dust and the flags |

The times move with distance and pace. They do not move to make a crowded
plan fit.

The **detail** column is the film's picture, and it is the column that reaches
the model: at the takes stage `prompt-skeleton` carries each one **whole** into
the prompt's timeline, at that beat's seconds, and that *is* the prompt's
timeline (`prompting.md`). So write it as direction, not as a label — bodies as
verbs with physical consequences ("dust lifts on the landing"), the wardrobe
and the material where they read, the expression where the face is legible
(not 「很悲伤」 but 「鼻翼一紧、泪在下睑停住」), and the tempo word for the
segment ("in a blur", "in slow motion, dust hanging"). Written here it is cheap
and the creator sees it on the shot list; written for the first time in
`prompts.md` it is a second design nobody approved.

**Length is not a constraint — there is no word budget on the prompt.** Write
the picture you mean. What *is* constrained is the number of segments the
prompt can hold: about one per 1–1.5 s of clip (four in a 4 s shot, five in a
6 s), because one segment must hold one main event. Beats denser than that are
merged into one segment whose text concatenates their details, so nothing is
lost — but a shot planned as eight half-second beats will read as four or five
segments to the model, and it is better to know that here.

## Beats

The same timeline, registered so the viewer can draw it and the checks can
point at it:

```bash
node {SKILL_PATH}/scripts/previz.mjs beats <shot-dir> --set beats.json
```

```json
[
  { "id": "establish", "label": "The terrace holds", "from": 0, "to": 0.5, "kind": "hold",
    "detail": "Dusk, dust drifting through low side light; the keeper motionless under the tree." },
  { "id": "cross", "label": "The challenger crosses", "from": 0.5, "to": 3.2, "kind": "action",
    "detail": "He crosses with an unhurried, weighted walk — real steps, never gliding — the travelling coat swinging behind him, dust off each heel." },
  { "id": "settle", "label": "He stops, facing the keeper", "from": 3.2, "to": 3.8, "kind": "action",
    "detail": "The last step shortens and plants; the coat keeps going for a beat, then settles." },
  { "id": "hilt", "label": "His hand settles on the hilt", "from": 3.8, "to": 4.6, "kind": "action",
    "detail": "His right hand rises slowly and closes on the hilt without drawing; the knuckles tighten." },
  { "id": "turn", "label": "The keeper turns to meet him", "from": 4.4, "to": 5.2, "kind": "trigger", "causedBy": "settle",
    "detail": "The head goes first, then the shoulders; the robe lifts and falls back." },
  { "id": "orbit", "label": "Camera orbits and settles", "from": 0, "to": 5.5, "kind": "camera",
    "detail": "The camera orbits slowly left around the pair and settles, ending on a wide two-shot with both fighters fully in frame." },
  { "id": "hold", "label": "Both hold", "from": 5.5, "to": 6, "kind": "hold",
    "detail": "Nothing moves but the dust and the flags." }
]
```

`kind` is `action`, `trigger`, `camera` or `hold`. A `trigger` names its
`causedBy` beat, and the script refuses one that starts before its cause does.
An acted-only beat (the hand on the hilt) is still a beat: the viewer draws
it, the prompt copies its seconds, and `take-motion` is checked against it.
Labels are what the creator reads on the timeline: short, in their language.

`detail` is optional and is the beat's designed picture, written in the
**film's language** — it is carried into the video pack verbatim, and a
translation step is a place for the design to get shortened (the `label`
stays short, for the rail and the sheet tiles). Write one for **every** beat, the `camera` beat included:
`prompt-skeleton` carries each `detail` whole into the timeline and the *first
camera beat's* `detail` whole into the prompt's 运镜总原则. A beat with no
`detail` comes back as its label plus a `<TODO>` you fill in by hand, which is
the same work done later and worse. Give a shot **one** camera beat: a second
is warned about, because one clip holds one move.

The pack is scaffolded in the film's language, so a `detail` written in that
language is pasted as it is. If a `detail` was written in another language
(an older project), translate it **in full, in place** as it is carried across
— never by shortening: `generate` warns when a designed `detail` no longer
survives in any timeline line, and that warning is the design being deleted.

When the plan changes, change the beats in the same breath — a timeline the
viewer draws that the greybox no longer follows is worse than none. The beats
are part of the `boards` stage's content, so editing them after approval turns
that stage `changed` and closes the gate in front of `generate` until the
creator has seen the new version.

## The cut into the shot: continuity, or not

Every shot but the first is cut *into* from another one, and the plan says how.
Pick one of five, and write the one-line reason next to it:

| decision | what it is | gets a `continuity` block? |
|---|---|---|
| **continuous action** | one motion seen from a new camera: the bodies are where the previous shot left them, the blade is still where it was, the dust is still in the air | **yes**, on the later shot |
| **match cut** | another time or place, but a pose, a shape or a movement carries across the join | yes, when the pose is what makes the cut work |
| **ellipsis / time jump** | time has passed and the film skips over it | no |
| **montage** | a rhythmic series that never claims to be continuous | no |
| **deliberate mismatch** | the join is meant to jar — a jump cut, a hard smash | no |

**The hand-off is opt-in, and that is the design.** Some cuts exist precisely
*to* break continuity, and a blanket "every shot continues the last one" would
make the ellipsis, the jump cut and the montage inexpressible — as well as
spending a reference slot and a constraint on shots that do not want either. A
shot with no `continuity` block is generated exactly as it was before this
existed. So the decision is yours to make per cut, here, in the plan, where the
creator can read it and disagree for free.

Declare one when the two shots are **one continuous action** — a fight
exchange, a fall, a hand-off of an object, anything the audience must read as
uninterrupted — or when a **match cut** only lands if the pose survives it.

Then write the two sentences and register them:

```bash
node {SKILL_PATH}/scripts/previz.mjs meta <shot-dir> \
  --continues-from s03-orbit \
  --entry "challenger mid-lunge, blade extended at chest height, 1.2 m from the keeper, facing screen right" \
  --exit  "blades in contact, keeper's blade turning the thrust aside, both weight forward"
```

- `--continues-from` must name an **earlier** shot in `backlot.json.shots`.
- `--entry` is the first half second of *this* shot, and it is the same
  sentence as the previous shot's `--exit`. Write it once and paste it.
- `--exit` is worth recording even on a shot that continues nothing: it is how
  the shot *before* a hand-off tells the next one what to open on.
- `--no-continuity` clears the block — the honest way to change your mind.
- Positions in a hand-off sentence are named **as they read on screen**
  (screen left/right), never from a character's point of view.

**The model is NOT shown the frame it continues. Those two sentences are the
hand-off.** `prompt-skeleton` opens the pack's 第一帧 line with 「承接上一镜
（sXX）的结束状态：」 followed by the `--entry` text, and adds 「机位与景别以
本镜白模 @Video1 为准，不沿用上一镜的机位。」 to the global block. That is the
whole contract, so the two sentences have to carry it: each body's position,
facing, what is in their hands, the distance between them.

The eight-take run is why (2026-09-21 night, 720p). While the previous shot's
out-frame *was* attached, every continuing shot came back with the **previous
shot's camera** — `s02` from `s01`'s high viewpoint instead of its designed
low angle, `s04` and `s05` in `s03`'s over-the-shoulder framing instead of the
side two-shot and the profile close-up — while the shots without one followed
their block. A hand-off frame is a composition, and it is the most persuasive
one there is: the same action, one moment earlier. `generate --with-handoff`
attaches it when a join has already failed in words, and the report says the
take carried it.

**Contiguous shots are still shot in order.** `generate` extracts the
hand-off frame from the previous shot's *selected* take — into
`takes/handoff-in.png`, for `compare --handoff` and the `take-handoff` check —
so a shot that continues another one cannot be generated until that one has a
take the creator kept. Plan the order, generate in it, and select as you go.
`--no-handoff` generates out of order and cuts nothing, and records
`"skipped"` on the take; it is the creator's call to accept the join unseen,
not a way around the queue.

A `continuity` block is part of the `boards` stage's content, exactly like the
beats and the trim: changing a hand-off turns that stage `changed` and the
creator re-approves the shot list before anything else is bought.

## Then the greybox — and it is the picture

**Do not draw a frame here.** The plan says what happens and what it looks
like, in words; the picture is the greybox, one stage later (`greybox.md`).
Once the plan is approved, block the shot, check it, and the take is
conditioned on that clip plus the faces and the film's style frame.

Round 3 (2026-09-21) is why nothing is drawn here. Every shot got a
storyboard frame drawn from its plan and the bible before anything was
blocked: eight pictures, eight invented rooms, eight cameras, no two of them
the same space — and the greybox, which is one space with one camera, could
not be built to satisfy any of them. Rendering the picture *from* the
greybox instead fixed the contradiction and left the cost: a still is a
composition, and a take given two averages them. So the design stays in
words here, and the one picture is the block.

`previz.mjs anchor` can still render a key frame from an accepted greybox for
the creator to *look at*, and `previz.mjs board` still exists for a film shot
under the old order. Neither reaches a take unless that take is generated
with `--with-anchors` / `--with-board`.

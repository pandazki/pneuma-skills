# From greybox to video model

Stage 6, per shot. The greybox is accepted, the board frame and the bible
exist, and now one paid call turns all of it into a take.

## Match the capability, do not guess it

A model's name says nothing about what it accepts. Before planning a take,
know: does it take a **video** reference (not just images), how long a clip it
returns, which aspect ratios and resolutions, and how large an input may be.
`previz.mjs generate --estimate` answers for the model this mode ships with.

**Seedance 2.5 reference-to-video** (fal.ai, facts read 2026-09-20):

- takes up to 10 reference **videos**, 30 reference **images** and 10
  reference **audio** clips; local files are inlined, 30 MB each at most — a
  Workbench greybox is about 1 MB
- references are addressed in the prompt by modality and order: `@Video1`,
  `@Image1`, `@Audio1`. (`seedance-video.mjs`'s own header is the authority on
  this syntax; earlier previz text said `[Video1]` and was wrong.)
- output 4–30 s; 480p and 720p; aspect ratios 21:9, 16:9, 4:3, 1:1, 3:4, 9:16
- a video reference is used for motion, editing and extension, and **its
  duration is billed alongside the output's** — so send the greybox trimmed to
  the shot and nothing else

| per second | 480p | 720p |
|---|---|---|
| with a video reference | $0.1323 | $0.2838 |
| without | $0.2205 | $0.4730 |

A 6-second take from a 6-second greybox is (6 + 6) × $0.1323 ≈ **$1.6** at
480p and ≈ **$3.4** at 720p, and takes about five minutes. Draft at 480p; go
to 720p once a draft has shown that the motion holds. These are list prices
and an estimate; the script's table is the one the cost panel uses, and what
fal actually billed is what happened. **The table prices output seconds and
the video reference. It does not yet price audio references or audio output**
— when a take carries `@Audio`, say that the estimate excludes it rather than
quoting the number as complete.

When no key is configured, finish the greybox, the `.blend` and the prompt
pack, build the reel, and state plainly that no take has been generated.

## Authority to spend

- The `previz` stage must be `approved` (or the project's gates open):
  `generate` checks it and refuses by name. A `changed` previz stage is not
  approved.
- The creator asked for a take and a key is configured → one take at the draft
  resolution is inside that request. Run it.
- A new paid service, a new account, a price beyond what was discussed, or
  uploading the creator's own footage to a service they have not agreed to →
  ask first, naming the service, the material and the cost.
- **Submit once.** `generate` records the take as `submitted` — with the exact
  prompt saved to `takes/<id>.prompt.txt` and the references it carries —
  before the request leaves, keeps the request id, and cancels the job
  remotely if its deadline passes. After a crash or a timeout read `status`
  first; a second submit for the same take is a second bill.
- A second take needs a named fix (`--fix "…"`), a third or later the
  creator's explicit yes (`--user-approved`) as well.
- A failing greybox check blocks generation. `--allow-failing "<reason>"`
  overrides it and the reason is recorded — use it when the creator has
  accepted a known deviation, not to get past your own unfinished work.

## The references `generate` attaches

You do not attach references by hand. `generate` gathers them from the shot's
own record, in a fixed order, and passes them to `seedance-video.mjs`:

| index | what | from |
|---|---|---|
| `@Video1` | the final greybox render | `shots/<id>/greybox/greybox.mp4` |
| `@Image1` | the board frame, **when the shot has one** | `shots/<id>/board.png` |
| `@Image2…` | one character sheet per id in `shot.characters`, in bible order, then the set concept for `shot.set` | `bible/**` |
| `@Audio1…` | the voice sample of each character with a `spoken` line in this shot | `bible/characters/<id>/voice.mp3` |

Two consequences worth internalising:

1. **The indices depend on the shot's record.** A shot with a board, two
   characters and a set has `@Image1` board, `@Image2` and `@Image3` sheets,
   `@Image4` concept; a shot with no board frame starts the sheets at
   `@Image1`. Read the shot's `characters`, `set` and `lines` before you write
   the prompt — or run `generate --estimate`, which prices the job, lists
   exactly what it would attach, and stops.
2. **The prompt may only name indices that were attached.** `generate` refuses
   a pack that mentions `@Image4` when it attached three images, before the
   request leaves — a dangling index is a prompt describing something the
   model cannot see, and the failure is silent unless it is caught here. The
   prompt must address `@Video1`; the old `[Video1]` spelling is read as
   `@Video1` and warned about, but write it the new way.

## The prompt pack — `prompts.md`

The greybox already says *where*, *when* and *from which camera*, and the
references already say *who* and *what it looks like*. It deliberately says
nothing about bodies: its people are pawns. The prompt is the only place a
walk, a reach, a sword form, a turn of the head or an expression exists — so
the prompt is a screenplay for the body as much as a look.

1. **What each reference is** — one sentence per index: *"@Video1 is the
   greybox: the exact layout, paths, timing and camera move. @Image1 is the
   storyboard frame for this shot's look and composition. @Image2 is the
   challenger's character sheet, @Image3 the keeper's, @Image4 the courtyard."*
   A model that is not told what a reference is will average them.
2. **Who the pawns are** — say in so many words that each pawn-shaped figure
   stands in for a real person, **and which one**: by colour when there are
   two (`greybox.md`), by sheet when there is a bible. A model that is not
   told will sometimes render a walking bollard.
3. **Body action, in seconds** — copied from the beats, written as acting
   direction: *"walks in with a relaxed natural gait — real steps, arms
   swinging, never gliding — along the pawn's path; slows and stops where the
   pawn stops; around second five raises the left hand and presses the
   button."* Every action the plan has and the greybox does not show goes here
   with its moment. Say "never gliding" — the reference glides, and that
   sentence is what turns it into steps.
4. **Spoken lines, verbatim** — the exact words, the speaker, and the second:
   *"at about 1.4 s the keeper says, in a low unhurried voice: '…'. His voice
   is @Audio1."* Quote the line character for character; `take-lines` compares
   the transcript against it.
5. **Look** — materials of the space, colour, light, mood. Translate every
   grey object into what it *is* ("the box in front of the person is a slim
   control pedestal") so the model does not have to guess what a cube means.
6. **Camera** — aspect, the move, its speed, continuity, and the **final
   framing** ("ends on the same wide two-shot as the reference, both fighters
   fully in frame") — models like to push in further than the reference.
7. **Structure** — what must stay: number of people, where the props are, the
   order of events, the contacts. No new shots, no new people, no cuts.
8. **Negatives** — only in a form the service supports. Seedance has no
   separate negative-prompt field, so they are sentences in the prompt; never
   invent an API parameter to carry them.
9. One fenced block tagged `prompt` — the exact text that will be sent. The
   script sends the first such block verbatim and refuses a pack without one,
   or one that names an unattached reference.

````markdown
```prompt
@Video1 is a grey previsualisation of this shot: use it as the exact reference
for the spatial layout, both characters' paths and timing, and the camera
move. @Image1 is the storyboard frame for the look and composition. The
blue-grey pawn is the challenger — @Image2 — a lean swordsman in a grey
travelling coat, road dust on him. The rust-coloured pawn is the keeper —
@Image3 — older, in dark layered robes. The courtyard is @Image4.
Show the challenger crossing the terrace with an unhurried, weighted human
gait — real steps, coat moving, never gliding — along the pawn's path, slowing
and stopping exactly where and when the pawn stops, facing the keeper. Around
second four his right hand settles on the sword hilt without drawing. The
keeper turns to face him only after the challenger has stopped. Dusk, low warm
side light across cracked stone, long shadows, dust in the air; photographic,
shallow depth of field. The camera orbits slowly to the left around the pair
and settles, ending on a wide two-shot with both fighters fully in frame. One
continuous shot, one camera, two people only, no cuts, no extra limbs, no
on-screen text.
```
````

## Sentences the trials paid for

Three from the blind trials, each worth a re-shot:

- **A dark look hides the cause.** In a night interior the model will happily
  render the reach and the first movement of the door in shadow, and then
  nobody can see that cause came before effect. Say that the action stays
  readable *before* the light event ("the store is dim but the man and the
  door handle are clearly visible throughout").
- **A light that "comes on" snaps.** Give the ramp in words and seconds ("the
  glow rises slowly over two seconds"), and say what the object looks like
  before it ("dull grey metal until the press").
- **The camera keeps pushing.** Name the final framing, not only the move.

Three more the fight material demands:

- **Two pawns are two costumes waiting to be swapped.** Name which colour is
  which fighter, in the same sentence as their sheet index, and repeat the
  identity when you describe an action ("the blue-grey pawn — the challenger —
  steps in"). Without it the model reassigns them, sometimes mid-shot.
- **Fast action: the greybox owns the timing, the prompt owns the technique.**
  `dash` fixes when the leap leaves the ground and when it lands; the prompt
  says *what kind of movement it is*, with its second — the sword form, the
  stance, which hand, whether the blade is drawn ("at 2.1 s he pushes off into
  a low forward leap, drawing on the rise, and lands in a braced low stance at
  2.9 s"). Neither half works alone: timing without technique gives you a
  floating body, technique without timing gives you a different fight.
- **A wide orbit invites a cut.** Say the camera never cuts and name the final
  framing, or the model will deliver two angles spliced together and call it
  one shot.

What makes a prompt work: it names each reference's role first; it says who
each pawn is; it directs the body in the order the beats happen; it states the
causal order in words; and it closes the doors a model likes to walk through —
gliding, extra people, cuts, captions, a camera that keeps pushing. Name left
and right as they appear **on screen**, not from the character's point of view.

## After the take lands

- Probe what actually came back: size, duration, frame rate. A model that does
  not render 1080p natively did not give you 1080p; say the native size, and
  call an upscale an upscale only after it has really been done.
- Compare the take with the greybox segment by segment
  (`compare --a greybox --b take-01 --at …`). Models leave paths, skip
  gestures and drift cameras; nothing locks them frame by frame. Record
  `take-motion`, `take-body` (real steps — no gliding, no stiff or extra
  limbs; look at a strip of the walk, this is the check the greybox can no
  longer make for you), `take-camera`, `take-order` and `take-integrity` (the
  right number of people, whole limbs, no cut, and each character in the
  costume their sheet gave them).
- **A shot with a spoken line is generated with audio and transcribed on
  arrival.** `generate` stores the transcript at
  `takes/<id>.transcript.json`, and `take-lines` passes only if every line is
  in it. Read the transcript rather than assuming the check: a near miss is a
  fail, because the audience hears the difference. If a line fails twice, move
  it to `vo` and say so — a voice-over that is right beats a spoken line that
  is nearly right.
- Retry only with a specific fix and inside the budget — by default one more
  take at most. A fix is a changed sentence or a changed greybox, not a hope
  that the dice fall better. Otherwise report the deviation and keep the
  greybox, the prompt and the request id.
- `select` the take the shot delivers, then tell the creator what exists per
  file, each marked *generated*, *inputs prepared only*, or *waiting for a key
  or an approval*.

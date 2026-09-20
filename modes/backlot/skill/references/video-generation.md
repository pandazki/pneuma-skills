# From greybox to video model

Stage 6, per shot. The greybox is accepted, its **anchor frame** was approved
beside it at the previz gate (`greybox.md`), the board frame and the bible
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
- **A shot that declares `continuity.from` waits for the shot it continues.**
  The hand-off frame is extracted from that shot's *selected* take, so
  contiguous shots are generated in order and `generate` refuses until the
  earlier one is selected. `--no-handoff` generates it alone and records that
  on the take — the creator's decision to shoot out of order and accept the
  join, not a way around the queue.

## The references `generate` attaches

You do not attach references by hand. `generate` gathers them from the shot's
own record, in a fixed order, and passes them to `seedance-video.mjs`:

| index | what | from |
|---|---|---|
| `@Video1` | the final greybox render | `shots/<id>/greybox/greybox.mp4` |
| `@Image1` | the **anchor frame**, when the shot has one — this shot's composition and look, already correct in one still | `shots/<id>/anchors/first.png` |
| `@Image2` | the board frame, when the shot has one | `shots/<id>/board.png` |
| `@Image3…` | one character sheet per id in `shot.characters`, in bible order, then the set concept for `shot.set`, then any **other** anchors the shot carries (a `last` anchor, say) | `bible/**`, `shots/<id>/anchors/**` |
| the **last** `@Image` | the hand-off frame, when the shot declares `continuity.from` — the previous shot's last used frame, cut by `generate` into `takes/handoff-in.png` | the previous shot's selected take |
| `@Audio1…` | the voice sample of each character with a `spoken` line in this shot | `bible/characters/<id>/voice.mp3` |

**The anchor leads the images on purpose.** It is the only reference that shows
*this* shot's framing in the film's own look; the board shows the intent, the
sheets show the people, the greybox shows the geometry. Seedance leans hard on
its first image reference, so the closest thing to the finished frame goes
there (`greybox.md`, "From greybox frame to anchor").

Three consequences worth internalising:

1. **The indices depend on the shot's record.** A shot with an anchor, a board,
   two characters and a set has `@Image1` anchor, `@Image2` board, `@Image3`
   and `@Image4` sheets, `@Image5` concept; a shot with no anchor starts the
   board at `@Image1`. Never count them by hand — `prompt-skeleton` writes the
   assignment lines at the indices `generate` will actually attach, and
   `generate --estimate` prices the job, lists exactly what it would attach,
   and stops.
2. **The prompt may only name indices that were attached.** `generate` refuses
   a pack that mentions `@Image4` when it attached three images, before the
   request leaves — a dangling index is a prompt describing something the
   model cannot see, and the failure is silent unless it is caught here. The
   prompt must address `@Video1`; the old `[Video1]` spelling is read as
   `@Video1` and warned about, but write it the new way.
3. **Every attached reference must be given a job**, and `generate` refuses a
   pack that leaves one unassigned. A reference nobody explained is not
   ignored by the model — it is averaged in, and it brings its own lighting,
   framing and palette with it. The greybox is the worst offender: unassigned,
   its flat grey studio light becomes the look of the take.

## The prompt pack — `prompts.md` (v2)

The greybox already says *where*, *when* and *from which camera*, and the
references already say *who* and *what they look like*. The greybox
deliberately says nothing about bodies: its people are pawns. The prompt is
the only place a walk, a reach, a sword form, a turn of the head, an
expression or a **tempo** exists — so the prompt is a screenplay for the body
as much as a look.

**This is version 2 of the pack**, rewritten 2026-09-21 from fal.ai's own
Seedance prompting guide, the community guides, and our first acceptance run.
The v1 packs were ~250 words of well-meaning prose, and two of them came back
having cut to a new angle halfway through. Two facts explain most of it:
**adherence decays with position** — what must not be negotiated goes first —
and **every attached reference is used whether or not you explained it**.

### The skeleton, in this order

1. **Reference assignments** — one clause per attached index, naming the job
   *and its limits*: `@Video1 = layout, positions, timing and the camera move
   only — its grey shapes are placeholders, not the look. @Image1 = this
   shot's composition and look; match it. @Image2 = the board's framing.
   @Image3 = the challenger's appearance, hold it. @Audio1 = the keeper's
   voice.` Keep each to a clause so the subject still arrives in the opening
   lines. `generate` refuses a pack that leaves an attached reference
   unassigned.
2. **Subject and motion** — the sentence the whole clip is about, first:
   *"Two swordsmen fight on a cracked stone terrace at dusk."* Then which pawn
   is who, by colour and by sheet (`greybox.md`): a model that is not told
   assigns the two costumes at random and sometimes swaps them mid-shot.
3. **Entry state** — only when the shot has a `continuity` block: the first
   half-second in the same words the plan used, in or straight after the
   subject sentence, before any timeline line. See `shot-plan.md`.
4. **Time-coded timeline** — one `Seconds a.a–b.b: …` line per beat, its
   ranges copied from the registered beats (the greybox clock, after any
   `slowmo` — `camera.md`) and **its words copied from each beat's `detail`,
   written back at the boards stage**. You are not composing this at the takes
   stage; you are carrying the designed picture forward (`shot-plan.md`). What
   a good `detail` reads like: bodies as verbs with physical consequences
   (*"dust lifts on the landing"*, *"the coat snaps round on the turn"*, never
   *"he moves dramatically"*), `never gliding` where somebody walks — the pawn
   glides, and that phrase is what turns it into steps — and the tempo named
   *per segment*: *"the lunge in a blur, then the blades meet in slow motion,
   dust hanging."* A spoken line is quoted verbatim on the line of the second
   it lands, with its speaker and its `@Audio` index; `take-lines` compares
   the transcript against those exact words. A paragraph is acceptable only
   for a single-beat clip under about 5 s; anything longer gets the timeline.
5. **Camera — one move, with its end state.** Exactly one primary move per
   clip, its speed, and where it ends (*"ending on a wide two-shot with both
   fighters fully in frame"*). When the camera does not move, say
   `locked-off`; when it must not cut, say `one continuous shot, no cut`.
   Stacked moves are what made the model change direction — and then angle —
   mid-clip. A whip, a snap-zoom or a second angle is **another shot**
   (`camera.md`).
6. **Look** — materials, colour, light, era, and the rendering idiom the
   bible and the boards were drawn in, so the references agree with the words.
   Translate every grey object into what it *is* ("the box in front of the
   person is a slim control pedestal"). Named, concrete visual facts only:
   "atmospheric", "cinematic" and "epic" are the words that produce the
   generic average of everything.
7. **Audio** — name the sounds you want (*"blade ring, boots on stone, cloth"*)
   and write **`no music`**. Seedance scores an open prompt by default, and the
   cut lays its own score under the film; two pieces of music in one film is a
   re-shot. Voice-over is never asked for here — it is added in the cut.
8. **Exit state** — the last half second, in the same grammar as the entry.
   It is what makes the frame the *next* shot hands off from usable, and it
   stops the model from drifting past the end of the move.
9. **Guardrails, affirmatively.** *"Two fighters only, whole limbs, no
   on-screen text."* Say what must be true rather than listing what must not
   happen; Seedance has no negative-prompt field, so a negative is just a
   sentence and an affirmative one reads better. Keep the list to the few
   doors this model actually walks through: an extra person, an invented cut,
   a caption, a camera that keeps pushing.

### The prompt is not written here — it is the design, carried forward

**Think out the shots and the pictures first, build the greybox from them, and
then hand the video model the designed picture plus what the greybox cannot
express plus the bible.** That is the order this mode exists to enforce, and
the prompt is where the three meet. By the time you reach this stage the
picture of every beat already exists: it was written at the boards stage, into
each beat's `detail` (`shot-plan.md`), *before* any Blender file. Arriving here
with an empty `prompts.md` and inventing the shot again is how a take stops
matching the film the creator approved.

```bash
node {SKILL_PATH}/scripts/previz.mjs prompt-skeleton <shot-dir>
node {SKILL_PATH}/scripts/previz.mjs prompt-skeleton <shot-dir> --write
```

It emits the slots above already filled with everything the record knows: the
assignment lines with the indices `generate` will actually attach, one
`Seconds a.a–b.b: <detail>` line per registered beat, the entry line when the
shot declares `continuity`, each spoken line quoted at its second with its
`@Audio` index, the trim, and `no music`. It prints the text in the JSON's
`skeleton` field, and `--write` puts it in **`prompts.skeleton.md`** —
deliberately not `prompts.md`, which is yours. Fill the block in there or in
the pack, then copy the finished fenced block into `prompts.md`, which is the
only file `generate` reads.

What is left for you is only what the beats do not carry: the reference
assignments' wording, the subject sentence, the look, the camera's one move
and its end state, the exit, the guardrails — and any detail the greybox
cannot express that the design assumed (a material, an expression, a prop's
weight). A `detail` that was written badly at the boards stage is fixed with
`beats --set`, not silently rewritten in the prompt: the beats are what the
viewer draws and what `take-motion` is checked against, and the two must say
the same thing.

### What `generate` checks before the request leaves

- there is a fenced `prompt` block (it sends the **first** one, verbatim) and
  it addresses `@Video1`;
- no index is named that was not attached;
- **no attached reference is left without an assignment sentence**;
- when the shot declares `continuity.from`, the shot it continues has a
  selected take (`--no-handoff` generates without the frame and records
  `"skipped"` on the take);
- the film's `previz` stage is approved, a final greybox exists at the current
  revision, no greybox check is failing, and the retry rules are satisfied.

A `Seconds a–b:` line that runs past the shot or goes backwards is **warned
about, not refused** — the script cannot know whether you meant it. Read the
warnings; a timeline that overruns the clip is usually a `slowmo` whose cost
you did not subtract.

### Word budget

**120–180 words in the fenced block** for a reference-to-video shot, and never
much over 200. The references are carrying the look and the layout; the words
are there to direct bodies, tempo and the one camera move. Our v1 packs ran to
~250 words and the camera instruction, sitting at the bottom, lost. If the
pack will not fit, the shot is trying to be two shots.

````markdown
```prompt
@Video1 = layout, positions, timing and the camera move only — grey
placeholders, not the look. @Image1 = this shot's composition and look; match
it. @Image2 = the board's framing. @Image3 = the challenger, @Image4 = the
keeper — hold both. @Image5 = the courtyard. @Image6 = the previous shot's last
frame; open on exactly this position.
Two swordsmen on a cracked stone terrace at dusk; the blue-grey pawn is the
challenger, the rust pawn the keeper. The clip opens mid-lunge, his blade
extended at chest height, a metre from the keeper.
Seconds 0.0–0.6: the lunge drives in, in a blur, coat snapping, dust lifting.
Seconds 0.6–2.4: the blades meet in slow motion, the keeper turning the thrust
aside, dust hanging.
Seconds 2.4–4.0: both hold, weight forward, blades in contact.
Camera: one slow push in from knee height, ending tight on the locked blades,
both faces in frame. One continuous shot, no cut.
Low warm side light, long shadows, drifting dust; stylised 3D animation.
Sound: blades ringing, boots scraping stone, cloth. No music.
Two fighters only, whole limbs, no on-screen text.
```
````

That is about 180 words — the top of the budget, for a shot carrying six
references and a hand-off. Drop the two hand-off elements (the `@Image6`
assignment and the clause that opens on the entry state) and the same pack is
about 165. Every one of the six attached references has a job, and the camera
has exactly one move with its end state.

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

Two more the fight material demands:

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

## What the first acceptance run paid for (2026-09-21)

The first film made with this mode reached a cut, and five things it got wrong
are now rules rather than hopes.

1. **The model cut to a new angle inside the clip — twice.** Both packs
   described more than one camera behaviour ("orbits … and pushes in", "rises
   and settles"), and the model resolved the contradiction the way an editor
   would: by cutting. **One primary move per clip, with its end state**, and
   `locked-off` in so many words when the camera is static. Say *"one
   continuous shot, no cut"* near the camera sentence, not at the bottom of the
   pack. A whip, a snap-zoom or a second size is another shot and another take
   (`camera.md`, the collage).
2. **Shot-to-shot the action did not connect.** Each take invented its own
   body positions, so the pose shot N ended on was not the pose shot N+1
   opened on, and a fight cut from them reads as three unrelated fights. The
   answer is the **hand-off** — entry and exit states in the plan, the previous
   take's out-frame attached as the last image reference — and it is **opt-in**,
   because plenty of cuts exist to break continuity. `shot-plan.md` holds the
   decision.
3. **Nothing had a tempo, so everything moved at one speed.** A fight needs the
   hold, the blur and the slow beat of contact. Tempo is built in the greybox
   (`slowmo`, `impact` — `camera.md`) and *named per segment* in the prompt:
   *"the lunge in a blur, then the blades meet in slow motion, dust hanging."*
   Do not write a bare "fast" or "high speed": on its own it buys smearing and
   loses detail. Name what is fast and what the result looks like.
4. **fal's likeness filter rejected a shot twice with HTTP 422.** The trigger
   was almost certainly a reference image, not the prompt: a photoreal,
   low-angle close-up board frame of a face reads to the filter as a real
   person. Keep character sheets and board frames in an **illustrated or
   3D-animation design idiom** — never a photographic portrait, and especially
   never a photoreal facial close-up (`bible.md`). When a 422 comes back,
   **regenerate the offending reference in that idiom and try again**;
   resubmitting the same pack spends the same money on the same refusal.
5. **What comes back is one frame longer than the request.** A 6 s request
   returned 145 frames and a 4 s request 97 — seconds × fps + 1. That is the
   model's file, not a fault, and it is why the cut works from the **trim** and
   the plan rather than from the take's own duration. Report the measured
   duration when you report the take, and do not "fix" a 145-frame take.

## After the take lands

- Probe what actually came back: size, duration, frame rate. A model that does
  not render 1080p natively did not give you 1080p; say the native size, and
  call an upscale an upscale only after it has really been done. **Expect one
  frame more than you asked for** — 6 s at 24 fps came back as 145 frames,
  4 s as 97. The cut works from the plan and the trim, so that extra frame is
  a measurement to report, not a defect to re-shoot.
- Compare the take with the greybox segment by segment
  (`compare --a greybox --b take-01 --at …`). Models leave paths, skip
  gestures and drift cameras; nothing locks them frame by frame. Record
  `take-motion`, `take-body` (real steps — no gliding, no stiff or extra
  limbs; look at a strip of the walk, this is the check the greybox can no
  longer make for you), `take-camera`, `take-order` and `take-integrity` (the
  right number of people, whole limbs, no cut, and each character in the
  costume their sheet gave them).
- **A hand-off shot is also checked against the shot before it.**
  `compare <shot-dir> --handoff` writes `takes/qa/<take>/handoff.png` — the
  previous take's out-frame beside this take's in-frame — and `take-handoff`
  is answered from that picture: same positions, same facing, same weapons,
  the action continuing. Open it; a hand-off you did not look at is a hand-off
  you cannot claim. When it fails, the fix is the entry sentence or the
  hand-off assignment line, not a new greybox.
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

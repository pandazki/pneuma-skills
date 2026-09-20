# From greybox to video model

## Match the capability, do not guess it

A model's name says nothing about what it accepts. Before planning a take,
know: does it take a **video** reference (not just images), how long a clip it
returns, which aspect ratios and resolutions, and how large an input may be.
`previz.mjs generate --estimate` answers for the model this mode ships with.

**Seedance 2.5 reference-to-video** (fal.ai, facts read 2026-09-20):

- takes up to 10 reference videos (plus images and audio); local files are
  inlined, 30 MB each at most — a Workbench greybox is about 1 MB
- references are addressed in the prompt by modality and order: `[Video1]`
- output 4–30 s; 480p and 720p; aspect ratios 21:9, 16:9, 4:3, 1:1, 3:4, 9:16
- a video reference is used for motion, editing and extension, and **its
  duration is billed alongside the output's** — so send the greybox trimmed to
  the shot and nothing else

| per second | 480p | 720p |
|---|---|---|
| with a video reference | $0.1323 | $0.2838 |
| without | $0.2205 | $0.4730 |

An 8-second take from an 8-second greybox is (8 + 8) × $0.1323 ≈ **$2.1** at
480p and ≈ **$4.5** at 720p, and takes about five minutes. Draft at 480p. Go
to 720p once a draft has shown that the motion holds. These are list prices
and an estimate; the script's table is the one the cost panel uses.

When only an image-conditioned model is available, export key frames and say
plainly that this is a **weak** constraint: it fixes a composition, not an
action, and full motion fidelity cannot be promised. When no service or key is
available, finish the greybox and the prompt pack and state that the final
video has not been generated.

## Authority to spend

- The user asked for a generated video and a key is configured → one take at
  the draft resolution is inside the request. Run it.
- A new paid service, a new account, a price beyond what was discussed, or
  uploading the user's own footage to a service they have not agreed to → ask
  first, naming the service, the material and the cost.
- **Submit once.** `generate` records the take as `submitted` before the
  request leaves, keeps the request id, and cancels the job remotely if its
  deadline passes. After a crash or a timeout read `status` first; a second
  submit for the same take is a second bill.

## The prompt pack — `prompts.md`

The greybox already says *where*, *when* and *from which camera*. It
deliberately says nothing about bodies: its people are pawns. The prompt is the
only place a walk, a reach, a turn of the head or a facial expression exists —
so the prompt is a screenplay for the body as much as a look.

1. **Who the pawns are** — say in so many words that each pawn-shaped figure
   stands in for a real person (or animal, or vehicle), and who: age, clothes,
   bearing. A model that is not told will sometimes render a walking bollard.
2. **Body action, in seconds** — copied from the beats, written as acting
   direction: *walks in with a relaxed natural gait — real steps, arms
   swinging, never gliding — along the pawn's path; slows and stops at the
   pedestal where the pawn stops; around second five raises the left hand and
   presses the button.* Every action the plan has and the greybox does not
   show goes here with its moment. Say "never gliding" — the reference glides,
   and the sentence is what turns that into steps.
3. **Look** — materials of the space, colour, light, mood. Translate every
   grey object into what it *is* ("the box in front of the person is a slim
   control pedestal") so the model does not have to guess what a cube means.
4. **Camera** — aspect, position, direction and speed of the move, continuity,
   and the **final framing** ("ends on the same medium-wide frame as the
   reference, with the whole device still in shot") — models like to push in
   further than the reference.
5. **Structure** — what must stay: number of people, where the props are, the
   order of events, the contacts. No new shots, no new people, no cuts.
6. **Negatives** — only in a form the service supports. Seedance has no
   separate negative-prompt field, so they are sentences in the prompt; never
   invent an API parameter to carry them.
7. One fenced block tagged `prompt` — the exact text that will be sent. The
   script sends the first such block verbatim and refuses a pack without one,
   or one that never mentions `[Video1]`.

````markdown
```prompt
Use [Video1] as the exact reference for the spatial layout, the character's
path and timing, and the camera move. The white pawn-shaped figure in the
reference is a placeholder for a real person: a scientist in a pale lab coat.
Show the scientist walking with a natural, relaxed human gait along the pawn's
path — real steps, arms swinging, never gliding — entering from the right,
slowing down and stopping at the pedestal exactly where and when the pawn
stops, facing the device. Once standing still, around second five, the
scientist raises the left hand and presses the lit button on top of the
pedestal. Only after that press do the central sphere and its rings begin to
glow blue, brightening slowly. Render the room as a clean near-future
laboratory: brushed-metal racks, soft cool overhead light, a polished dark
floor; the box in front of the person is a slim control pedestal. The camera
pushes in slowly and settles, ending on the same medium-wide framing as the
reference with the whole device still in shot. One continuous shot, one
person, no cuts, no extra limbs, no on-screen text.
```
````

Three sentences the blind trials paid for:

- **A dark look hides the cause.** In a night interior the model will happily
  render the reach and the first movement of the door in shadow, and then
  nobody can see that cause came before effect. Say that the action stays
  readable *before* the light event ("the store is dim but the man and the
  door handle are clearly visible throughout").
- **A light that "comes on" snaps.** Give the ramp in words and seconds ("the
  glow rises slowly over two seconds"), and say what the object looks like
  before it ("dull grey metal until the press").
- **The camera keeps pushing.** Name the final framing, not only the move.

What makes this work: it names the greybox's role and the pawn's role first;
it directs the body in the order the beats happen; it states the causal order
in words; and it closes the doors a model likes to walk through — gliding,
extra people, cuts, captions, a camera that keeps pushing. Name left and right
as they appear **on screen**, not from the character's point of view.

## After the take lands

- Probe what actually came back: size, duration, frame rate. A model that does
  not render 1080p natively did not give you 1080p; say the native size, and
  call an upscale an upscale only after it has really been done.
- Compare the take with the greybox segment by segment
  (`compare --a greybox --b take-01 --at …`). Models leave paths, skip
  gestures and drift cameras; nothing locks them frame by frame. Record
  `take-motion` (on the pawn's path, on its seconds, and the prompted action
  actually performed), `take-body` (real steps — no gliding, no stiff or extra
  limbs; look at a strip of the walk, this is the check the greybox can no
  longer make for you), `take-camera`, `take-order` and `take-integrity` (one
  person stays one person, limbs stay whole, no cut appears).
- Retry only with a specific fix and inside the budget — by default one more
  take at most. A fix is a changed sentence or a changed greybox, not a hope
  that the dice fall better. Otherwise report the deviation and keep the
  greybox, the prompt and the request id.
- Deliver separately: the greybox MP4, the editable `.blend`, the prompt pack,
  the acceptance record and the take — each marked *generated*, *inputs
  prepared only*, or *waiting for a key / authorisation*.

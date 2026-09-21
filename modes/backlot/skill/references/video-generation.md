# From greybox to video model

Stage 6, per shot. The greybox is accepted and reviewed at the previz gate
(`greybox.md`), the bible exists, and now one paid call turns all of it into
a take.

**How the prompt itself is written lives in `prompting.md`** — the template,
its block order, the timeline rules and two worked examples. This page is the
machinery around it: what the model accepts, what it costs, who may spend, what
`generate` attaches and checks, and what to do with the clip that comes back.

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
| `@Video1` | the final greybox render — **the only picture of layout, behaviour and camera the take gets** | `shots/<id>/greybox/greybox.mp4` |
| `@Image…` | one character sheet per id in `shot.characters`, in bible order | `bible/characters/<id>/sheet.png` |
| `@Image…` | the film's **style key frame** — how this film is drawn, and nothing about what is in the frame | `style/keyframe.png` (`backlot.mjs style`) |
| the **last** `@Image` | the hand-off frame, when the shot declares `continuity.from` — the previous shot's last used frame, cut by `generate` into `takes/handoff-in.png` | the previous shot's selected take |
| `@Audio1…` | the voice sample of each character with a `spoken` line in this shot | `bible/characters/<id>/voice.mp3` |

**The set is not in that list.** Its structure is already in `@Video1`, and
its materials, colours and scale reach the model as text: `prompt-skeleton`
pre-fills 【全局设定】's 场景 line from the set's bible `look`. That sentence
is now the set's only carrier — write it (`backlot.mjs set set --look "…"`),
and `generate` warns when a film has no style key frame, because then the look
has no picture at all.

**Three pictures were tried beside the greybox and all three were removed**
(2026-09-21, three acceptance rounds): a storyboard drawing per shot, a key
frame rendered from the greybox, and the set concept. Each one carries a
composition, and a model given two compositions of the same second averages
them — the greybox always lost. The upstream practice this mode reproduces
never attached them either; there, a key frame exists only as a **weak
constraint** for a model that cannot take a video reference at all.

So they are opt-in, per call, and the pack must be scaffolded for the same
call (`prompt-skeleton` takes the same flags):

| flag | attaches | where |
|---|---|---|
| `--with-anchors` | this shot's key frames — `first` then the others | leading the images |
| `--with-board` | a legacy `board.png` | leading the images |
| `--with-concept` | the set concept for `shot.set` | after the sheets |

Use one when the words have already failed on a re-shoot, never as a default,
and name it in the report: that take was conditioned on a second composition.

Three consequences worth internalising:

1. **The indices depend on the shot's record.** A shot with two characters and
   a style frame has `@Image1` and `@Image2` sheets and `@Image3` style; add
   `--with-anchors` and every index moves. Never count them by hand —
   `prompt-skeleton` writes the assignment lines at the indices `generate`
   will actually attach, and `generate --estimate` prices the job, lists
   exactly what it would attach, and stops.
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

## The prompt pack — `prompts.md`

The greybox already says *where*, *when* and *from which camera*, and the
references already say *who* and *what they look like*. The greybox
deliberately says nothing about bodies: its people are pawns. The prompt is
the only place a walk, a reach, a sword form, a turn of the head, an
expression or a **tempo** exists.

**Read `prompting.md` before writing one** — the template and its block order,
the contiguous timeline, the density rule, the two clauses a greybox always
needs, and two worked examples. Start every pack at

```bash
node {SKILL_PATH}/scripts/previz.mjs prompt-skeleton <shot-dir> --write
```

which writes `prompts.skeleton.md` — never `prompts.md`, which is yours. There
is **no word limit**: the pack carries the whole designed beat plus what the
greybox cannot show, and what gets cut is vagueness, never length.

### What `generate` checks before the request leaves

Refused, before anything is paid for:

- there is a fenced `prompt` block (it sends the **first** one, verbatim) and
  it addresses `@Video1`;
- no index is named that was not attached;
- **no attached reference is left without an assignment sentence** — the tag
  followed by `=`, `:`, `：` or `is`;
- when the shot declares `continuity.from`, the shot it continues has a
  selected take (`--no-handoff` generates without the frame and records
  `"skipped"` on the take);
- the film's `previz` stage is approved, a final greybox exists at the current
  revision, no greybox check is failing, and the retry rules are satisfied.

**Warned about and sent** — the script cannot know whether you meant it, and
each of these is a take that came back wrong once: a timeline line that runs
past the shot, goes backwards, leaves a gap or overlaps the one before it; a
segment naming two camera moves; a beat whose designed `detail` no timeline
line carries any more; a missing 【全局锁】/【Locks】 block; an `@Video1` line
with no exclusion; an unfilled `<TODO: …>` placeholder. Read them — a timeline
that overruns the clip is usually a `slowmo` whose cost you did not subtract,
and a missing detail is usually the design being deleted.
## What the three acceptance runs paid for (2026-09-21)

The lessons about the *prompt* — the invented cut, the missing tempo, the
swapped identities, the starved timeline — are in `prompting.md`, where the
rule that fixes each of them lives. Four that are about this machinery:

0. **Each round added a picture beside the greybox, and each one fought it.**
   A drawn storyboard first (eight shots, eight invented rooms), then a key
   frame rendered from the greybox — which agreed with the blocking and still
   competed for the composition — then the set concept, which brought a wide
   camera of its own. The fix is arithmetic, not phrasing: **one composition
   per take**. The greybox is it; everything else says a face, an idiom or a
   pose, and says so in its own line.

1. **Shot-to-shot the action did not connect.** Each take invented its own
   body positions, so the pose shot N ended on was not the pose shot N+1
   opened on, and a fight cut from them reads as three unrelated fights. The
   answer is the **hand-off** — entry and exit states in the plan, the previous
   take's out-frame attached as the last image reference — and it is **opt-in**,
   because plenty of cuts exist to break continuity. `shot-plan.md` holds the
   decision.
2. **fal's likeness filter rejected a shot twice with HTTP 422.** The trigger
   was almost certainly a reference image, not the prompt: a photoreal,
   low-angle close-up frame of a face reads to the filter as a real
   person. Keep the character sheets and the style frame in an **illustrated
   or 3D-animation design idiom** — never a photographic portrait, and
   especially never a photoreal facial close-up (`bible.md`). When a 422 comes back,
   **regenerate the offending reference in that idiom and try again**;
   resubmitting the same pack spends the same money on the same refusal.
3. **What comes back is one frame longer than the request.** A 6 s request
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

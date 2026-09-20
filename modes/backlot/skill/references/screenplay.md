# The idea and the screenplay

Stages 1 and 2. Everything downstream is built from these two files: the bible
designs the people and places the screenplay names, the boards draw the shots
the screenplay is broken into, the greybox blocks those shots, and the cut
assembles them in that order. A story decision that never reaches
`screenplay.md` does not reach the film.

Both files are written in the **film's language**. You answer the creator in
whatever language they write to you in; those two are often, but not always,
the same. Prompts sent to image and video models are written in English.

## `idea.md`

One page, written before anything else, so the creator can disagree cheaply.

1. **Logline** — one sentence: who wants what, and what is in the way.
2. **Tone** — the feeling, with two or three named touchstones ("the stillness
   of a wuxia duel before the first strike, not an action-film brawl").
3. **Length** — total seconds, and roughly how many shots that buys. Six to
   eight shots of 4–6 s is about half a minute; say the arithmetic out loud so
   the creator can push back on the size before it is built.
4. **Audience and where it plays** — a 9:16 phone clip and a 16:9 festival
   short are different films; the aspect belongs here, not at render time.
5. **Look, in words** — palette, light, lens feel, era, materials. Name the
   references the creator gave you. If they gave none, propose one and mark it
   an assumption.
6. **Assumptions** — every value you chose because it was not given: duration,
   fps, aspect, resolution, cast size.

Then `backlot.mjs init <project> --title "…" --logline "…"` writes
`backlot.json`; its spec (`--seconds`, `--fps`, `--width`, `--height`) becomes
the default for every shot and for the cut. Gates start closed.

## `screenplay.md`

Plain markdown a person can read, with enough structure that scenes can be
lifted out of it mechanically.

```markdown
## 1. EXT. RUINED TEMPLE COURTYARD — DUSK

Broken colonnade around a cracked stone terrace. Prayer flags snap in the
wind. A great tree leans over the bell tower.

THE CHALLENGER stands at the terrace edge, sword still sheathed. THE KEEPER
waits under the tree, unmoving.

**KEEPER**
You came up the south path. Nobody does that twice.

**CHALLENGER (V.O.)**
I only needed to do it once.

## 2. EXT. RUINED TEMPLE COURTYARD — DUSK, CONTINUOUS
...
```

- **Scene heading** — `## <n>. INT.` or `EXT.` + PLACE + ` — ` + TIME. The
  place is the same name you will give the set in the bible; that is what ties
  a scene to a designed look.
- **Action** — present tense, short paragraphs, only what a camera can see. A
  character's first appearance is in CAPS. Do not write what a character
  thinks or remembers; the camera cannot photograph it.
- **Cue line** — `**NAME**` on its own line, the spoken line under it. A
  parenthetical for delivery goes on its own line between them, in brackets.
- **`(V.O.)`** after the name marks a line nobody's mouth says on screen —
  narration, a thought, a voice from elsewhere. That mark is what decides,
  later, whether the line is rendered by the video model or synthesised with
  TTS. Get it right here and the sound stage is already decided.

Keep the screenplay short. A 30-second film is about three quarters of a page;
a page of action for six shots is a page of decisions the greybox cannot hold.

## Registering the scenes

The prose is yours; the machine-readable scene list belongs to `backlot.mjs`:

```bash
node {SKILL_PATH}/scripts/backlot.mjs scene add <project> --id sc1 \
  --number 1 --heading "EXT. RUINED TEMPLE COURTYARD — DUSK" \
  --summary "The challenger arrives; the keeper does not move."
```

(`scene set <project> --id sc1 …` amends one that already exists.)

Scene ids are stable (`sc1`, `sc2`) because shots point at them. The `script`
stage's content is `screenplay.md` plus this list, and nothing else — so
approving the screenplay approves exactly what the creator read.

## Breaking a scene into shots

**One shot is one continuous camera.** If the camera cuts, it is two shots. If
the camera moves — orbits, pushes, cranes — that is still one shot as long as
it never cuts. A shot is the unit the greybox blocks, the model renders and
the cut assembles.

Rules of thumb that hold for this pipeline:

| question | answer |
|---|---|
| how long? | 4–8 s. **Seedance will not return less than 4 s**, so there is no such thing as a 2-second shot here |
| how many actions in one shot? | as many as the pace arithmetic allows — see `shot-plan.md`. A 5.5 m walk at 1.5 m/s plus a stop is already 4 s |
| when does a beat become its own shot? | when the camera would have to be in two places, or when the moment deserves a size change (wide → close) |
| what makes a shot too long? | anything over 8 s doubles the bill (the greybox is billed alongside the output) and gives the model more room to drift |
| can the film show less than a whole shot? | yes — that is the **trim** (`previz.mjs meta --trim-in/--trim-out`). The shot is still built and generated at its full length; only the cut takes a sub-range of it |

Write the breakdown into the scene's shot list, then register each shot. The
id carries its order so a directory listing reads as the film:

```bash
node {SKILL_PATH}/scripts/backlot.mjs shot add <project> s01-arrival \
  --title "The challenger arrives" --scene sc1 \
  --characters challenger,keeper --set courtyard --seconds 6
```

`shot add` appends the id to `backlot.json.shots` (that list **is** the film's
order) and scaffolds `shots/s01-arrival/`. `previz.mjs meta <shot-dir> --scene
--characters --set` changes those ties later without touching the order.

Registering shots moves the `boards` stage, not the `script` stage — so
breaking the screenplay into shots after the creator approved it does not turn
the screenplay `changed`.

## The collage pattern

A single beat can be several shots. One strike, cut from three cameras —
a wide of the approach, a tight low angle of the blade, a reverse of the
landing — reads as choreography that no single 6-second generated clip
delivers, and each of the three is short, cheap and easy to block.

The mechanics live in `camera.md` (one set function, reused; only the camera
block changes between the angles; all three cameras on one side of the line).
What belongs *here* is the decision: when the action is fast, buy angles
rather than seconds. Three 4-second shots of one exchange cost about the same
as two 6-second ones and are far more likely to survive their acceptance
checks, because each one asks the model for less.

Register each angle as its **own shot at 4 s or more** — the Seedance floor
applies to every one of them — and then give each a **trim**, the short range
the film uses:

```bash
node {SKILL_PATH}/scripts/previz.mjs meta <shot-dir> --trim-in 1.9 --trim-out 3.1
```

The cut plays the trims back-to-back. A re-trim turns the `boards` stage
`changed`, so the creator re-approves the shot list before anything else is
bought.

## The lines

Each shot carries its lines, with the second each one lands:

```bash
node {SKILL_PATH}/scripts/previz.mjs lines <shot-dir> --set '[
  { "id": "l1", "speaker": "keeper", "kind": "spoken", "text": "You came up the south path.", "at": 1.4 },
  { "id": "l2", "speaker": "challenger", "kind": "vo", "text": "I only needed to do it once.", "at": 4.2 }
]'
```

`--set` takes the JSON array itself. A line whose text is unchanged keeps any
recording it already has; a line whose text changed loses it and says so — the
audio says something else now.

- **`spoken`** — the mouth is on screen and the **video model renders it**. The
  line goes into the take prompt verbatim, the speaker's `voice.mp3` goes with
  it as an `@Audio` reference, and the take is checked with `take-lines`
  against a `transcribe.mjs` transcript.
- **`vo`** — nobody's on-screen mouth says it. Synthesised with TTS
  (`previz.mjs vo`) and mixed into the cut at `segment.offset + line.at`.

**Choose `vo` when the speaker's face is not legibly on screen** — a wide
orbit, a back view, a crowd, a masked fighter, anything under 720p where a
mouth is a dozen pixels. Choose `spoken` only when the model has a real chance
of matching the words, and then check it. Laying a TTS file over a mouth the
model already animated is never right; the lip-sync mismatch is worse than
either option alone, and the two kinds exist to stop you reaching for it.

A line's own arithmetic matters too: speech runs about 2.5–3.5 words a second.
Seven words need roughly 2.5 s of shot, and a 4-second shot does not hold two
exchanges.

## When the creator changes something

A change at stage 2 is cheap and a change at stage 6 is not. When they ask for
one:

1. Edit `screenplay.md` (and the scene records, if a heading or summary moved).
   The `script` stage turns `changed` on the rail — that is the mechanism
   working, not a fault.
2. Say which later stages the change invalidates, in files and in dollars: a
   renamed place means a new set concept ($); a new line means a new shot or a
   re-shot take ($$); a re-ordered scene means only `backlot.json.shots` (free).
3. Get the screenplay approved again before spending on any of it.

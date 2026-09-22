# Sound and the cut

Stages 7 and 8. By now every shot has a selected take (or a greybox standing
in for one), and what is left is the film's second half: the voice that is not
on screen, the music under it, and the assembly that turns a folder of clips
into one file with an edit list beside it.

Three sources of sound, and each has exactly one home:

| sound | where it comes from |
|---|---|
| spoken dialogue | **the take** — rendered by the video model from the prompt and the speaker's voice reference, checked with `take-lines` |
| ambience and effects | **the take's own audio track**, kept by the cut. This mode has no SFX generator and does not pretend to have one |
| voice-over, narration, music | **generated here** — TTS per line, Lyria for the score |

Both stages are paid and gated: `vo` and `music` need the `takes` stage
`approved`; `cut --final` needs `sound` approved. `cut --reel` needs nothing.

```bash
node {SKILL_PATH}/scripts/backlot.mjs gate <project> vo
node {SKILL_PATH}/scripts/backlot.mjs gate <project> music
node {SKILL_PATH}/scripts/backlot.mjs gate <project> cut-final
```

Each of `previz.mjs vo`, `backlot.mjs music` and `cut --final` also checks its
own gate and refuses by name, so `gate` is for knowing before you commit.

## Voice-over lines

A line registered as `kind: "vo"` (see `screenplay.md`) is synthesised one at
a time, against the speaker's registered voice:

```bash
node {SKILL_PATH}/scripts/previz.mjs vo <shot-dir> l2 [--model --voice --style]
```

It runs `generate-tts.mjs` with the speaker's recorded voice from the bible,
writes `sound/<line>.mp3` beside the shot, and records `{ file, seconds, cost }`
back onto the line. The `seconds` is measured from the written bytes, not
estimated — which is what lets the cut place the line and know whether it fits.
It refuses a line marked `spoken`: that one belongs to the video model.

Then check the arithmetic, because TTS does not respect your plan:

- **Does the line fit its shot?** A 3.4 s line starting at `at: 4.2` in a 6 s
  shot runs 1.6 s past the cut point. Either move `at` earlier, shorten the
  text, or let it run over the next shot deliberately (a line that bridges a
  cut is a normal, good thing — decide it, do not discover it).
- **Is `at` inside the shot's trim?** `at` is a second on the *shot's* clock,
  and a trimmed shot reaches the film only between its `in` and `out`. A line
  spoken outside that window is dropped by the cut, with a reason. Check the
  trim before you pay for the line.
- **Is it the right voice?** Play it. A voice id typed from memory instead of
  read from `generate-tts.mjs`'s header produces a perfectly fluent stranger.
- **Two lines from the same speaker should come from the same voice record.**
  If they do not, the bible was edited between them and the film now has two
  narrators.

## The music brief

One piece for the film, commissioned from Lyria through the shared script.
`backlot.mjs music` runs `generate-bgm.mjs`, writes `sound/music.mp3` and
records the prompt, the model, the measured seconds and the cost in
`sound/sound.json`.

```bash
node {SKILL_PATH}/scripts/backlot.mjs music <project> --seconds 30 \
  --prompt "Wuxia duel cue, about 30 seconds. Sparse and tense, then driving. \
Low frame drums keeping a slow heartbeat pulse at roughly 72 BPM, a solo guqin \
playing a spare modal line over them, a bamboo flute entering in the last third. \
No vocals, no synthesisers, no western orchestra. Ends on a single unresolved \
struck note, no fade-in."
```

A brief that works names five things:

1. **Genre and idiom** — what tradition the piece belongs to.
2. **Tempo** — a BPM or a feeling tied to the action ("a slow heartbeat pulse").
3. **Instruments** — by name, and the ones you do *not* want. Lyria will reach
   for strings and synthesiser pads unless told otherwise; "drums and guqin"
   with "no western orchestra" is what keeps a wuxia duel out of a trailer.
4. **Mood and its arc** — one adjective is a loop; "sparse, then driving" is a
   piece that goes somewhere.
5. **Length** — about the film's length. Lyria has no duration parameter, so
   `--seconds` is only a hint appended to the prompt; the cut trims and fades
   whatever actually arrives. Ask for a little more than you need, never less.

Listen to the result — measure it, check that it is not a fade-in over your
opening beat, and tell the creator what it cost. If the piece is wrong, a new
brief is a new paid call: say so before you run it.

## The cut

```bash
node {SKILL_PATH}/scripts/backlot.mjs cut <project> --reel    # free, ungated
node {SKILL_PATH}/scripts/backlot.mjs cut <project> --final   # gated on `sound`
```

Both scale and frame-rate match every segment to the project spec, **honour
each shot's trim** for take and greybox sources alike, concatenate in
`backlot.json.shots` order with a re-encode, keep each take's own audio as
ambience, place each VO line at its second of the film, lay the music under at
`--music-db` (default −18 dB) with a `--music-fade` fade-out (default 2 s),
probe the result, and write `cut/edl.json` **last**, so an edit list never
describes a file that was not finished.

A negative decibel needs the `=` spelling — `--music-db=-22`, not
`--music-db -22`.

| | `--reel` | `--final` |
|---|---|---|
| what fills a shot with no take | its greybox | nothing — it refuses |
| gate | none | `sound` must be `approved` |
| output | `cut/reel.mp4` | `cut/final.mp4` |
| audio of a stand-in segment | silent (a greybox has none) | n/a |
| what it is called | a reel | the film |

`edl.json` is the honest projection of what was assembled — every segment's
shot, its source (`take-02` or `greybox`), its `in`/`out` on that shot's
clock, its offset in the film and its duration, plus where every VO line and
the music landed. The viewer's segment strip seeks by it, and hatches the
stand-ins.

### Read the report, not just the file

Two fields decide whether the cut is finished:

- **`trimmed`** — the shots the film shows only part of. Expect the ones you
  trimmed deliberately, and nothing else. A shot in that list you did not trim
  means a `meta --trim-*` you forgot about.
- **`droppedVo`** — a voice-over line that had nowhere to land, with the
  reason: either it is spoken at a second outside the range the cut uses from
  its shot, or it would land past the end of the film. **A dropped line is
  silence in the film.** Fix it by moving the line's `at` inside the trim
  (`previz.mjs lines --set`) or by widening the trim (`previz.mjs meta
  --trim-in/--trim-out`), then cut again — and if the creator decided to leave
  it dropped, say so in the delivery rather than letting them discover it.

### Mix levels

- **Music under dialogue: about −18 dB**, which is the default. Music at −6 dB
  is a music video; at −30 dB it is not there. Move `--music-db` for a reason
  you can name.
- **Fade the music out over the last ~2 s** (the default) rather than cutting
  it off, unless the film ends on a hard stop you chose.
- **VO sits on top of the take's own audio**, not instead of it: the ambience
  from the take is what makes the voice sound like it belongs to the place.

### Show the reel early, and say what it is

`cut <project> --reel` is free and needs no approval, so build it as soon as the
greyboxes are accepted — before a single take is bought. It is the first time
anybody, including you, sees whether the film *works*: whether the pacing
holds, whether a beat is missing, whether two shots say the same thing.

When you show it, say three things plainly: **this is a reel**, the grey shots
are greybox stand-ins for takes that do not exist yet, and here is what the
remaining takes would cost. A pacing problem found in the reel costs nothing;
the same problem found after six takes costs the takes.

Never present a reel as the film, and never let `reel.mp4` be the file you
hand over when someone asks for the film.

## Delivering

When the cut is done, tell the creator what exists, per file, and which of the
three states it is in — *generated*, *inputs prepared only*, or *waiting for a
key or an approval*:

| file | what it is |
|---|---|
| `cut/final.mp4` | the film, at the project spec ffprobe actually measured |
| `cut/edl.json` | the edit list: every segment, its source, its offset, the VO and music placement |
| `shots/<id>/takes/…` | the selected take per shot, and the ones that were not chosen |
| `shots/<id>/greybox/{greybox.mp4,scene.blend,scene.glb}` | the blocking, and the editable Blender project |
| `shots/<id>/{shot-plan,prompts,comparison}.md` | how each shot was planned, what was asked of the model, and how the take compared |
| `shots/<id>/shot.json` | the acceptance record: every check, its status, its note and its history |
| `bible/**`, `sound/**` | the cast, the places, the voice files and the score |
| `backlot.mjs cost <project>` | what the film cost, by stage and kind, with each figure's basis; a call with no recorded price is listed as unpriced, never as free |

Read the acceptance records before you write the summary. A film delivered
with a failing or `unverified` check is delivered with that check named — the
creator can accept a deviation they know about, and cannot accept one you
summarised away.

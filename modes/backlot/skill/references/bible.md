# The bible — cast, look and places

Stage 3, and it produces exactly **two kinds of picture a take receives**: a
**character sheet** per person, and **one style key frame** for the whole
film. Speaking characters also get a **voice**. Every place gets its
appearance **written down**; a concept frame is optional and is not sent to a
take.

**A face comes from an image; everything else can come from words.** "A
weathered swordsman in a grey travelling coat" produces a different man in
every shot, however carefully you word it — the same `sheet.png` attached as
a reference produces the same man. That is the lesson plotwise paid for, and
it is about *identity*. It does not generalise to places: a set concept is a
wide establishing picture with a camera of its own, and the camera belongs to
the greybox (three acceptance rounds, 2026-09-21 — `prompting.md`). So the
bible's pictures are the faces and the idiom, and the place is a sentence.

## One rule before any of it: design, not photography

Every image on this stage — and every key frame made from one — is drawn as
an **illustrated or 3D-animation production design**, never
as a photograph of a person. Say so in the prompt, in the same sentence as the
look: *"rendered as stylised 3D animation production art"*, *"painted
concept-art illustration"*, whichever idiom the film is in.

This is not taste, it is a gate. In the first acceptance run fal's likeness
filter refused a shot twice with **HTTP 422**, and the reference it choked on
was a photoreal, low-angle close-up frame of a face — an image that
reads to a safety filter as a real person. The cost of the idiom rule is
nothing; the cost of ignoring it is a shot you cannot buy.

- **Never a photoreal portrait, and especially never a photoreal facial
  close-up.** A close-up key frame is the highest-risk image in the whole film.
- **When a 422 comes back, regenerate the offending reference in the design
  idiom and try again.** Resubmitting the same pack spends the same money on
  the same refusal, and neither the prompt nor the retry counter is the thing
  that needs changing.
- **The take's look should agree with the idiom the references were drawn in.**
  References bleed their rendering style; a stylised bible and a "photographic,
  shallow depth of field" prompt are two films arguing inside one take.

Everything on this stage is **paid and gated**. The `script` stage must be
`approved` before a sheet, a concept or a voice sample may be bought.
`character look`, `set look` and `character voice` check the gate themselves;
`generate_image.mjs` does not know what a stage is, so ask before you run it:

```bash
node {SKILL_PATH}/scripts/backlot.mjs gate <project> bible-image
node {SKILL_PATH}/scripts/backlot.mjs gate <project> voice
```

## Characters

### 1. Write the record first

```bash
node {SKILL_PATH}/scripts/backlot.mjs character add <project> challenger \
  --name "The Challenger" \
  --description "Mid-thirties, lean, a straight sword still sheathed. Came up the south path in one night." \
  --look "grey travelling coat over dark trousers, cloth wrapped forearms, road dust, hair tied back, no ornament"
```

`description` is who they are (the creator reads it); `look` is what a model
needs to draw them — clothing, silhouette, hair, age, build, distinguishing
marks. Keep `look` concrete and finite: five to eight visual facts. A
paragraph of mood produces variety, which is the one thing the bible exists to
prevent.

### 2. Generate the sheet

**Write the sheet as a design brief, not a spec sheet.** The first film's
sheets were technically correct turnarounds and the creator called them
「一般」; the redesign that replaced them (2026-09-21) differed only in the
prompt: a one-line temperament, the face feature by feature, the hair and
what holds it, every costume layer with its material and how it hangs, the
weapon, a large lit portrait beside the three views, and a named idiom
(today's best 国风 animation — stylised forms, ink-wash texture, bold
silhouettes, one accent colour — never photoreal, never cute anime). Default
`--quality xhigh`; a sheet is made once and travels into every key frame and
every take, so it is the cheapest place to spend. One image, one frame:

```bash
node {SKILL_PATH}/scripts/generate_image.mjs \
  "Character design sheet for a contemporary Chinese animated wuxia feature — \
stylised 3D forms with hand-painted ink-wash texture, bold graphic silhouettes, \
dramatic chiaroscuro, one saturated accent colour; NOT photoreal, NOT cute anime. \
ONE character: <name, age, one line of temperament>. Face: <eyes, brows, nose, \
mouth, skin, one mark>. Hair: <length, style, what holds it>. Costume: <each layer, \
its material and colour, how it hangs, sash, footwear>. Weapon: <what, how held>. \
Layout: left, three full-body views on one ground line (three-quarter, front, \
profile), identical face and costume; right, a large head-and-shoulders portrait \
lit by <the character's light>. Soft warm-grey studio gradient behind the views. \
No text, no labels, no scenery." \
  --aspect-ratio 16:9 --quality xhigh \
  --output-dir bible/characters/<id> --filename-prefix sheet
```

Give the two leads opposite lights and opposite palettes — the colour
relationship between the sheets is the story's relationship, and it will
carry into every frame the two share.

The spec, and why each part is there:

| requirement | why |
|---|---|
| **neutral grey background** | the sheet is a reference for a person, not for a place; a background travels into every take that uses it |
| **three-quarter + front + profile, one frame** | the model conditioning a later take sees the head from more than one angle, so the face survives a camera that orbits |
| **full body** | the take needs the costume's full silhouette, not a portrait crop |
| **the same face in all three** | say it in the prompt. Without it the generator draws three siblings |
| **no text, labels or borders** | any text in a reference tends to reappear, baked into a take |
| **16:9 or 3:2** | three full-body figures side by side need the width |
| **an illustrated / 3D-design idiom** | a photoreal face is what the likeness filter refuses, and the sheet travels into every key frame and every take that uses it |

Look at the file before you register it. Three views, one person, the costume
from the record, nothing written on it — if any of those fails, fix the prompt
and generate again rather than registering a sheet you would not use.

### 3. Register it

```bash
node {SKILL_PATH}/scripts/backlot.mjs character look <project> challenger \
  --file bible/characters/challenger/sheet.png \
  --prompt "<the prompt you actually sent>" \
  --cost-usd 0.13 --cost-basis reported
```

`backlot.mjs` copies the file in, bumps its revision and writes
`character.json` — the record, the prompt and the cost the shared script
reported. The prompt is kept because a second character made "in the same
style" is made from it. `--move` moves the file instead of copying it.

### 4. Give a speaking character a voice

Pick a voice **once**, per character, and never change it silently — a
character whose voice moves between shots is a different person to a listener.
`character voice` does the synthesis itself; you choose the voice and the
sentence:

```bash
node {SKILL_PATH}/scripts/backlot.mjs character voice <project> challenger \
  --text "<one sentence this character would say, in the film's language>" \
  --model seed-speech --voice <voice-id> --style "low, unhurried, dry"
```

- **Read `generate-tts.mjs`'s header for the real model and voice lists**
  before you pass `--model` / `--voice`. It ships two vendors with different
  voice names, different `--language` spellings and different output formats,
  and each refuses the other's. Do not guess a voice id from memory; the
  header is the list.
- **Match the voice to the language.** A voice trained on one language reading
  another is immediately audible.
- **The sample sentence should be in the character's language and about four
  seconds** (roughly ten to twelve words). Four seconds is long enough for a
  timbre to be recognisable and short enough that the model reads it as a
  voice sample rather than as a line to perform. A sentence from the
  screenplay is ideal — the creator hears the character, not a test phrase.
- The measured length and the cost are recorded for you; play the file before
  you show it to the creator.

## The film's style key frame — the second essential picture

One picture for the whole film that says **how it is drawn** — idiom,
palette, light quality, finish — and **nothing about what is in the frame**.
It is what carries the look now that no other still is allowed a composition,
it costs one image, and `generate` warns when a film has none.

```bash
node {SKILL_PATH}/scripts/backlot.mjs style <project> --keyframe style.png \
  --prompt "<the prompt it was made from>"
```

**It must be location-neutral.** This is the one picture attached to EVERY
take of the film, so a recognisable place in it is a place the model paints
into shots that place is not in. In the urban trial (2026-09-22) the style
frame was a girl under a shop awning, and the awning came back in takes where
the shop was behind the camera. A character bust, a texture study, a patch of
sky, a hand on a wet railing — anything whose subject is the RENDERING. A set
concept frame is the one thing it must never be, and `backlot.mjs style` warns
when the file is one (it is inside a set's bible record, its bytes are a
registered concept frame, or `--prompt` names a set the film has).

How to make one:

1. **Pick one key moment of the film** — the image a poster would use. A real
   moment, with real people in it, but **not a picture of a place**: frame it
   so the idiom is what the picture is about. An idiom is easiest to read off
   a picture that had to solve something; it is hardest to keep out of a shot
   when the picture also solved a street.
2. **Generate it in the intended idiom, at `--quality xhigh`**, from the
   screenplay and the sheets. One image, one frame, no text.
3. **Generate two or three directions and let the creator choose.** This is
   the film's look; it is their call, it is free to look at, and a direction
   nobody chose is a look nobody approved.
4. Register the chosen one. It is copied to `style/keyframe.png`, and from
   then on every take — and every key frame `previz.mjs anchor` renders —
   carries it with the job *"only the idiom, never the composition"*. That
   sentence is not enough on its own: a place inside the frame arrives anyway,
   which is why the picture has to be location-neutral before it is registered.

Because it travels into every take, the likeness rule applies to it exactly
as to a sheet: an illustrated or 3D-design idiom, never a photoreal face.

## Sets (the places) — written, not drawn

```bash
node {SKILL_PATH}/scripts/backlot.mjs set add <project> courtyard \
  --name "Ruined temple courtyard" \
  --description "The terrace where the duel happens. Half the colonnade has fallen." \
  --look "cracked stone terrace 12 m across, broken stone columns along the north side, \
a bell tower at the east corner, a leaning tree over it, prayer flags, scattered blocks"
```

**`--look` is the set's picture.** It is pre-filled into the prompt pack's
【全局设定】 as the 场景 line, and it is the only thing that tells the model
what this place is made of. `set add` warns when it is missing. Write it the
way the sheets are written: five to eight concrete visual facts, with **real
metres** — a 12 m terrace, a 2.1 m doorway, a 0.9 m counter. Those same
numbers are what `scene.py` builds, so the words and the greybox describe one
room rather than two.

A concept frame is **optional**, and it is not attached to a take unless the
job is asked for it (`generate --with-concept`). It is still worth generating
when the creator wants to *see* the place, or when a set is hard to describe
and the greybox needs a target to be built against:

```bash
node {SKILL_PATH}/scripts/generate_image.mjs \
  "Wide establishing shot of <the set's look sentence>. Empty of people. \
Eye-level camera about 1.6 m high, 28 mm lens, looking across the terrace \
from the south. Dusk, low warm side light, long shadows. Rendered as stylised \
3D-animation production design, no text, no people, no logos." \
  --aspect-ratio 16:9 --quality high \
  --output-dir bible/sets/courtyard --filename-prefix concept

node {SKILL_PATH}/scripts/backlot.mjs set look <project> courtyard \
  --file bible/sets/courtyard/concept.png --prompt "…" \
  --cost-usd 0.13 --cost-basis reported
```

Empty of people: the people come from the character sheets, and a figure baked
into a set concept turns up as an extra in any take that carries it.

## How the bible travels

| stage | what it attaches |
|---|---|
| `boards` | nothing. The shot plan is text and makes no image — the picture is the greybox, one stage later |
| `previz` | optional. `previz.mjs anchor` renders a key frame for the creator to look at, from the greybox frame plus the sheets, the set concept if there is one, and the style reference last (`greybox.md`) |
| `takes` | `previz.mjs generate` attaches the greybox as `@Video1`, then the sheets of the shot's `characters` in bible order, then the style key frame, then the hand-off frame, then the voice samples as `@Audio1…`. The set travels as text |

That order is fixed and the prompt must address the indices as attached — see
`video-generation.md`. This is also why `shot.characters` matters: it is the
list `generate` and `anchor` read to decide which sheets go along. The
likeness rule follows a sheet everywhere it goes: a key frame is an image of
a face made from your sheet, and if the sheet is photoreal the key frame is
the call that gets refused.

## Revisions, cost and honesty

- Every regenerated sheet is a new revision on the record; the old file is not
  silently overwritten, and key frames made from the old one still say which
  revision they used.
- Each image is a paid call. Record what the shared script reported
  (`usage.cost` → `basis: "reported"`), not a guess, and tell the creator the
  running total when you show them the bible.
- A character with no sheet is shown to the creator as exactly that — an
  empty card on the bible grid. Do not describe a look you have not
  generated as though it exists. A set with no concept frame is **not** a
  gap: its card carries the written look, which is what a take receives.

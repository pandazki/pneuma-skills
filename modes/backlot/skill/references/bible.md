# The bible — cast and places

Stage 3. Every person who appears gets a **character sheet** and, if they
speak, a **voice**; every place gets a **set concept**. These images are not
illustrations of the script — they are the continuity mechanism for the rest
of the film.

**Continuity comes from images, never from adjectives alone.** "A weathered
swordsman in a grey travelling coat" produces a different man in every shot,
however carefully you word it. The same `sheet.png` attached as a reference
produces the same man. This is the lesson plotwise paid for: the text of a
prompt controls what happens, and an attached image controls who it happens
to. So the bible is generated once, approved once, and then travels — into
every key frame, and into every take — as an `@Image` reference.

## One rule before any of it: design, not photography

Every image on this stage — and every key frame made from it — is drawn as an
**illustrated or 3D-animation production design**, never
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

## Sets (the places)

```bash
node {SKILL_PATH}/scripts/backlot.mjs set add <project> courtyard \
  --name "Ruined temple courtyard" \
  --description "The terrace where the duel happens. Half the colonnade has fallen." \
  --look "cracked stone terrace 12 m across, broken stone columns along the north side, \
a bell tower at the east corner, a leaning tree over it, prayer flags, scattered blocks"
```

The concept frame is a **wide establishing shot of the place, from roughly
where the scene's main camera will stand**:

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

Two things make a concept frame useful rather than decorative:

1. **It is shot from the film's camera**, so the greybox and the key frames
   agree with it instead of describing a place nobody will photograph.
2. **Its dimensions are the greybox's dimensions.** The `look` sentence carries
   real metres — a 12 m terrace, a 2.1 m doorway, a 0.9 m counter — and
   `scene.py` builds those same numbers. When the concept says "wide terrace"
   and the greybox builds 6 m, the take is fighting two different rooms.
   Write the numbers into the set record and reuse them in `scene.py`.

Empty of people: the people come from the character sheets, and a figure baked
into the set concept turns up as an extra in a take.

## How the bible travels

| stage | what it attaches |
|---|---|
| `boards` | nothing. The shot plan is text and makes no image — the pictures come from the greybox one stage later |
| `previz` | `previz.mjs anchor` sends the greybox frame for the composition and the sheets and the concept for the appearance (plus the film's style reference, when there is one) — the same faces again, now in the shot's real framing (`greybox.md`) |
| `takes` | `previz.mjs generate` attaches the greybox as `@Video1`, the `first` key frame as `@Image1`, the shot's other key frames next, then the sheets of its `characters` and the set concept, the hand-off frame last, and the voice samples of any spoken line's speaker as `@Audio1…` |

That order is fixed and the prompt must address the indices as attached — see
`video-generation.md`. This is also why `shot.characters` and `shot.set`
matter: they are the list `generate` and `anchor` read to decide which sheets
go along. The likeness rule follows the sheet everywhere it goes: a key frame
is an image of a face made from your sheet, and if the sheet is photoreal the
key frame is the call that gets refused.

## Revisions, cost and honesty

- Every regenerated sheet is a new revision on the record; the old file is not
  silently overwritten, and key frames made from the old one still say which
  revision they used.
- Each image is a paid call. Record what the shared script reported
  (`usage.cost` → `basis: "reported"`), not a guess, and tell the creator the
  running total when you show them the bible.
- A character with no sheet, or a set with no concept, is shown to the creator
  as exactly that — an empty card on the bible grid. Do not describe a look
  you have not generated as though it exists.

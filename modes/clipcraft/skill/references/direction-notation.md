# Direction Notation — encoding intent precisely in prompts and references

> **Layer 3 of 6** in the ClipCraft technique stack. Pull from this
> when prompts feel imprecise, when multiple intents need to ride in
> a single image/video, when a generation comes back close-but-wrong,
> or when timing/synchronization matters (music, dance, dialogue).

A prompt is a **command interface to a frontier model**. Like any
command interface, the more precise the vocabulary, the more
predictable the output. Free-form prose works for casual generations
("a happy panda"), but breaks down for production work where:

- a single reference image needs to encode body + camera + lighting
  intent simultaneously,
- timing must match a musical bar or beat exactly,
- a face must hold a specific micro-expression,
- the model's "creative reinterpretation" instinct works against the
  director (you want literal execution of the storyboard).

This document collects the notation systems that solve each of these
precision problems. Use them **selectively** — if a casual prompt
works, don't reach for FACS. But when you're paying $1.50+ per take
and need it to land first try, the notation pays back its tax.

## 1. Production-grade triggers — pushing the model onto the high-effort track

Frontier image models (gpt-image-2 in particular) have multiple
internal "tracks" they can render on. The default track produces
serviceable casual output. The **production track** — the one that
returns "looks like a Pixar pitch board" or "looks like an actual
storyboard page" rather than "AI image" — is reliably activated by a
specific vocabulary in the prompt.

### The trigger vocabulary

| Trigger phrase | Effect |
|---|---|
| `CORE DIRECTIVE (NON-NEGOTIABLE):` | Switches the model into "follow exactly" mode for the rule that follows |
| `STRICT` | Marks a constraint as load-bearing (turnaround consistency, layout, palette, etc.) |
| `MUST include:` / `MUST NOT:` | Hard inclusions / exclusions; works better than soft "should" |
| `Production-ready fidelity` / `Pitch-deck quality` | Pushes detail level up |
| `Suitable for [film development / merchandising / pitch decks / case study]` | Names the use-case the model should optimize for |
| `Must feel art-directed, not auto-generated` | Specifically counters the model's symmetric / evenly-spaced default |
| `Real actor caught mid-moment, NOT posing` | Specifically counters the model's neutral-headshot default |

### When to reach for them

- **Always** for character cards and setting cards (Layer 1) — the
  reference images are load-bearing and need to be production-grade.
- **Always** for hero-shot anchors (single critical first/last frame
  of an expensive seedance run).
- **Often** for composite storyboards (Path C) — the trigger words
  push the model to actually treat the grid as a designed page
  rather than six pasted thumbnails.
- **Sometimes** for narrative shots — when the user says "this needs
  to look like an ad / film / studio render" and the casual prompt
  isn't getting there.
- **Rarely** for casual variants ("show me 4 colorways of this") —
  they don't need the production push and the triggers waste tokens.

### Worked example

Compare these two prompts for a character anchor:

```
# Casual track (don't use for production):
"A young chef working in a kitchen, focused, cinematic"

# Production track (use for character cards / hero anchors):
"Cinematic, film-production-grade portrait of [NAME], a young chef.

CORE DIRECTIVE (NON-NEGOTIABLE): Real actor caught mid-moment, NOT
posing. Micro-expression required (slight brow furrow, weight on
left foot). Avoid staged symmetry.

[full character bible as defined in setup/cast/<name>.md]

STYLE: Cinematic realism, 50mm lens, shallow depth of field, soft
practical kitchen lighting (overhead fluorescent + warm under-counter
LED).

OUTPUT: Production-ready fidelity. Suitable for film development.
Sharp focus, extremely high detail."
```

The casual track returns a generic stock photo. The production track
returns something with weight and intention. Same model, same cost
(~$0.16), dramatically different signal-to-noise.

## 2. Annotation Color System — encoding multiple intents in one reference image

The biggest constraint of reference-driven generation is the
"one image carries one intent" assumption. In real productions, a
storyboard panel encodes body movement *and* camera arc *and*
framing *and* lighting *and* emotional tone — all visible to the
director, all communicated to crew. The annotation color system
brings that capacity to AIGC.

The technique: **bake colored annotation overlays into the reference
image itself**, using a fixed color vocabulary the model recognizes.
gpt-image-2 will respect explicit "annotation" instructions in its
prompt — colored arrows, dashes, dotted lines, callouts — and
seedance's `reference` mode will read those annotations as
directorial intent on top of the photographic content.

### The vocabulary

| Color | Meaning | Typical encoding |
|---|---|---|
| **Red** | Body movement / posture | Solid arrows tracing motion paths; outlined silhouettes for pose changes |
| **Blue** | Camera movement | Dashed arrows for tracking shots; concentric arcs for arcs/orbits |
| **Green** | Framing / composition | Brackets marking the rule-of-thirds intersections; rectangular frames |
| **Orange** | Lighting / shadow direction | Sun-ray glyphs at light source; shaded zones for shadow |
| **Purple** | Emotional / vocal beat | Note-glyphs at musical hits; speech-bubble fragments for vocal beats |
| **Black** | Lens / technical notes | Typewriter-style margin notes ("85mm", "f/1.8", "120 BPM") |

This isn't a universal AI standard — the model wasn't pre-trained on
"red = body". The vocabulary works because **you state it explicitly
in the generation prompt**, and gpt-image-2 carries that vocabulary
into the rendered annotations. Then when the annotated image is
passed to seedance, you reinforce the vocabulary in the seedance
prompt: "the red arrows in the reference indicate body motion to
follow."

### Worked example — a music-driven dance shot

Generation prompt for the annotated reference:

```
A 16:9 contemporary dance storyboard panel.

Subject: a single dancer in mid-movement, contemporary dance studio,
soft warm overhead light, polished wood floor.

Annotations (explicit, baked into the image):
  - RED solid arrows from current pose toward upcoming pose
    (forward extension of right arm; left foot pivot to 45 degrees)
  - BLUE dashed arrow from camera position arcing 90 degrees
    counterclockwise around the dancer
  - GREEN bracket at the right-thirds intersection where the
    dancer's torso should land at frame end
  - ORANGE sun-ray glyph at the upper-left light source, with a
    soft shadow zone pooled to the dancer's right
  - PURPLE eighth-note glyph at the dancer's left hand, marking the
    musical accent that triggers the gesture
  - BLACK typewriter margin notes: "85mm, f/2", "120 BPM, beat 3 of
    bar 4"

Style: clean studio reference, photographic body, hand-drawn-style
annotations. Annotations should be visually clear without obscuring
the dancer.
```

Then for the seedance call:

```bash
node scripts/generate-video.mjs reference \
  --prompt "Dancer follows the red motion arrows from start to end
  pose. Camera follows the blue dashed arc, 90 degrees CCW around
  subject. Frame the dancer at the green bracket position by end
  of shot. Lighting maintained per the orange sun-ray (warm, upper-
  left, soft shadow right). Hit the purple eighth-note accent on
  beat 3 of bar 4. Match the lens specification (85mm, shallow DoF)
  in the black margin notes." \
  --image-url assets/refs/dance-panel-3.png \
  --duration 4 --aspect-ratio 16:9 \
  --output assets/clips/dance-3.mp4
```

What this buys you: the agent has communicated body, camera,
framing, light, music sync, and lens — six independent intents — to
seedance through ONE reference image, **without diluting the prompt
text**. The prompt stays a directive ("follow the annotations"); the
intents live where the model can see them.

### When to reach for it

- **Path C composite storyboards** — see
  `references/storyboard-design.md`. The whole point of a composite
  is that each panel can encode rich intent; the color system is
  what makes that legible.
- **Music-driven generation** — dance, song-driven, dialogue-with-
  rhythm. The purple beat glyphs are how you encode musical sync.
- **Camera-grammar-heavy shots** — when the camera move is the main
  storytelling device (orbits, pushes, reveals).
- **Multi-character blocking** — red arrows can encode who moves
  toward whom, when.

### When NOT to use

- **Single-subject talking-head** — overkill; just describe in prose.
- **Casual t2v** — the annotation generation step is overhead.
- **When the user is iterating quickly on look** — don't lock down
  precise blocking with annotations until the look is approved.

## 3. Faithfulness directives — countering the model's reinterpretation instinct

Frontier video models, especially seedance, default to "creative
reinterpretation" mode. Pass it a storyboard and it will sometimes
re-block the action ("I'll make the dance more dynamic"), re-frame
the shot, or insert beats that weren't in the reference. For
director work this is hostile.

The counter-vocabulary:

```
Do not reinterpret. Match the storyboard exactly.

Faithfully execute the blocking shown in the reference. The dancer
follows the arrows precisely. Camera follows the dashed path
precisely. Frame end-position must match the green bracket exactly.

This is a faithful execution shot. No creative liberties on body
movement, camera movement, framing, or pacing.
```

Stack these alongside the per-annotation directives. The phrase
"faithful execution" specifically disarms the model's
reinterpretation default in seedance 2.0.

## 4. Temporal compression directives — making time precise

Seedance generates at a fixed duration (4–15s). When your storyboard
has N panels that map to a specific musical bar count, you need to
**explicitly tell the model how to compress the panels into the
target duration**.

The vocabulary:

```
TIMING:
  - Compress the 12 panels into 3.0 seconds total.
  - Each panel = 0.25 seconds.
  - Hold the final panel for 1.0 seconds before fade.
  - Snap transitions at every panel boundary; no easing between
    panels.
```

The first line is the headline directive. The follow-up lines remove
ambiguity (fixed cell duration, explicit hold, no inter-panel
easing). Without the follow-ups, seedance will sometimes ease
between cells (looks rotoscoped) or hold the first cell instead of
the last (wrong emphasis).

For music sync specifically:

```
TIMING (music-locked):
  - Total 3.0 seconds = 6 musical beats at 120 BPM.
  - Each panel transitions on a beat.
  - Panel 1 falls on beat 1 (downbeat).
  - The PURPLE eighth-note glyphs in the reference indicate the
    panels with musical accents — those panels should hold for 0.5s
    each (the others 0.25s each).
```

This is the highest-precision form of timing direction. Use only
when timing is genuinely load-bearing (music, voiceover sync,
dialogue cuts).

## 5. Anti-pattern directives — naming the failure mode

The most powerful single technique for getting better seedance
output is **naming the failure mode you're trying to avoid**. Models
have strong defaults; explicit anti-patterns counter them.

The most common ones to disarm:

| Failure mode | Anti-pattern directive |
|---|---|
| Subject ends in a static standing pose | `Avoid static standing poses. The subject must remain in motion at end of shot.` |
| Symmetric framing / centered composition | `Avoid symmetric framing. Composition must feel art-directed.` |
| Generic plastic-doll skin / fabric | `Avoid plastic skin / smooth synthetic fabric. Surfaces must show pore, weave, wear.` |
| Default "AI cinematic" warm-orange grade | `Avoid generic warm-orange color grade. Match the palette as specified.` |
| Center-frame talking-head default | `Avoid center-frame talking-head composition unless explicitly framed that way.` |
| Smooth easy easing on every move | `Avoid easing on cuts; transitions must be hard cuts unless explicitly directed.` |

Stack 2-3 anti-patterns most relevant to your shot. Don't dump all
of them every time — the prompt budget matters and over-stuffing
dilutes the active directives.

## 6. FACS notation — face control for character work

FACS (Facial Action Coding System) is the academic vocabulary for
naming individual facial muscle movements. AU1 = inner brow raise.
AU4 = brow lowerer. AU12 = lip corner puller (smile). gpt-image-2
and seedance both have enough exposure to FACS in their training to
respect explicit AU specifications.

Use FACS when:

- The face is the primary storytelling element (close-up reaction
  shots, character study).
- A specific micro-expression matters and prose ("subtly worried
  smile") isn't landing.
- You're directing across multiple shots and need the same
  micro-expression to recur.

The vocabulary table for the most useful AUs:

| Code | Name | What it does | When to use |
|---|---|---|---|
| AU1 | Inner brow raiser | Lifts inner brow only | Worry, sadness, vulnerability |
| AU2 | Outer brow raiser | Lifts outer brow | Surprise, attention |
| AU4 | Brow lowerer | Furrows brow | Concentration, anger, displeasure |
| AU5 | Upper lid raiser | Widens eyes | Surprise, fear, interest |
| AU6 | Cheek raiser | Pulls cheek up (true smile) | Genuine happiness, warmth |
| AU7 | Lid tightener | Narrows eyes | Suspicion, scrutiny |
| AU9 | Nose wrinkler | Wrinkles nose | Disgust |
| AU10 | Upper lip raiser | Curls upper lip | Disdain, contempt |
| AU12 | Lip corner puller | Pulls corners up (smile) | Polite smile, social |
| AU14 | Dimpler | Tightens corners inward | Repressed emotion, stoicism |
| AU15 | Lip corner depressor | Pulls corners down | Sadness, disappointment |
| AU17 | Chin raiser | Pushes chin up | Determination, defiance |
| AU20 | Lip stretcher | Pulls lips horizontally | Fear, tension |
| AU23 | Lip tightener | Compresses lips | Anger, suppressed emotion |
| AU25 | Lips part | Mouth slightly open | Speaking, breathing visible |
| AU26 | Jaw drop | Mouth fully open | Shock, awe, speech |
| AU45 | Blink | Standard blink | Naturalness, beat marker |

Combine AUs to specify compound expressions:

- **Genuine smile** (Duchenne smile): AU6 + AU12
- **Polite smile** (non-Duchenne): AU12 only
- **Worried smile**: AU1 + AU12 + AU14
- **Suppressed anger**: AU4 + AU7 + AU23
- **Mid-thought concentration**: AU4 + AU45 (occasional blink)

### Worked example

Prompt for a reaction-shot anchor:

```
Close-up portrait of [character], reaction shot.

Expression (FACS-specified): AU1 + AU2 (inner and outer brow
raised, surprise) + AU5 (upper lid raised, eyes widened) +
AU25 (lips parted) — registering surprise at the off-screen event
named in the previous panel. Hold for ~0.3s before transitioning
to AU4 + AU7 + AU23 (concentration / suppressed reaction).

This is a transitional micro-expression, not a held pose.
```

### When NOT to use FACS

- Wide shots where the face is < 5% of frame.
- Casual / cartoony styles where realistic muscle activation is
  off-aesthetic.
- When prose works ("she looked surprised, then guarded") — don't
  reach for academic notation if the model is already getting it.

## 7. IPA notation — vocal precision for songs and dialogue

IPA (International Phonetic Alphabet) lets you specify exact
pronunciation for sung or spoken content. Most TTS and lip-sync
generation systems will respect IPA when given alongside or in place
of orthographic text.

When to use:

- **Lyrics with non-standard pronunciation** — proper nouns, foreign
  words, intentional regional accents.
- **Dialogue with specific phonetic timing** — when a beat falls on
  a specific phoneme.
- **Songs in any language other than the model's default
  English-prior** — explicit IPA outperforms orthographic input for
  most non-English vocals.

### The minimal vocabulary

You don't need to write production lyrics in IPA. Use it
**selectively** for the words/phonemes that matter. Format:

```
Lyrics:
  "Walking through the [/ˈmiːəʊwiːŋ/] city lights"
                       ↑ explicit IPA only for the made-up word
```

Or for accent specification:

```
Speaker accent: educated southern Edinburgh — note especially:
  - "house" → /huːs/ (long u, not the standard diphthong)
  - "right" → /rɛit/ (open onset)
```

### When NOT to use IPA

- Standard English lyrics — the TTS handles it.
- Models without explicit IPA support (most image models — IPA only
  matters for audio/video models that render speech).

## 8. How these notations stack

Most production prompts use **2-4 notation systems** at once. A
typical character-anchor prompt:

```
Production trigger:        CORE DIRECTIVE / NON-NEGOTIABLE
Faithfulness directive:    Match storyboard exactly
Anti-patterns:             Avoid static pose, avoid plastic skin
FACS micro-expression:     AU1 + AU12 + AU14 (worried smile)
[Plus the bible-derived prose: who, where, what they wear]
```

For a Path C composite storyboard:

```
Production trigger:        STRICT, NON-NEGOTIABLE
Annotation color system:   full vocabulary explicit
Faithfulness directive:    embedded in seedance call later
Temporal compression:      panel→duration mapping
[Plus the per-panel prose for each cell]
```

For a music-locked shot:

```
Annotation color system:   purple beat glyphs in reference
Faithfulness directive:    "no creative reinterpretation of timing"
Temporal compression:      music-locked variant with BPM
Anti-pattern:              avoid easing on cuts
[Plus minimal prose — the annotations and timing carry it]
```

The art is choosing which notations are load-bearing for *this* shot
and skipping the rest. Over-specification (every notation maxed)
produces stiff, over-constrained output. Under-specification gets
you the casual track.

## See also

- `references/reference-directives.md` — `@-addressing`, role
  vocabulary, multi-ref slot rules. **Complementary** to this doc:
  `reference-directives.md` is *how to address* multiple references;
  this doc is *how to encode intent within a reference*.
- `references/production-bible.md` — where these notations get baked
  into the upstream artifacts (character cards, setting cards).
- `references/storyboard-design.md` — where these notations get
  applied per-panel.
- `references/storyboard-workflow.md` — the mechanical workflow that
  consumes notation-rich references.
- `references/character-consistency.md` — *separate problem*: when
  to reach for the photo-body / sketch-head workaround instead of
  (or in addition to) these notations.

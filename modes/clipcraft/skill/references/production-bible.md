# Production Bible — locking the world before generating any pixel

> **Layer 1 of 6** in the ClipCraft technique stack. Read this first
> on any project that involves recurring characters, repeated settings,
> or more than two shots. Skip on one-off single-clip requests.

The biggest single failure mode of "agent-driven AIGC video" is
**drift**: each generation re-rolls the dice on faces, wardrobes,
lighting, palette, and lens grammar. Twelve panels in, the protagonist
has changed jaw shape, the kitchen has changed countertops, and the
"warm afternoon" tone has wandered into "cold studio." The visual
through-line is gone.

**A production bible is the durable upstream artifact that prevents
drift.** It exists *before* any image generation and is **referenced
by every later prompt**. It has three components:

1. **Project Bible** — the project-level metadata (tone, format,
   duration, palette, camera grammar, flow intention)
2. **Character Cards** — one per recurring person/creature; design,
   psychology, performance, wardrobe — plus a generated reference
   image
3. **Setting Cards** — one per recurring location, key prop, or
   signature object; same shape, lighter

You spend ~$0.50–$2 once on these, then every subsequent generation
references them via `--image-urls` (cheap, deterministic continuity).
Skipping this step is the most common, most expensive mistake in
multi-shot AIGC.

## When to build a bible

| Brief shape | What to build |
|---|---|
| "make a 4s panda rolling over" | Nothing. Just generate. |
| "10s opening, single character, single location" | Project Bible (light) + 1 character card |
| "30s mini-story, recurring chef" | Full Project Bible + 1 character card + maybe 1 setting card |
| "60s ad, two characters across three scenes" | Full Project Bible + 2 character cards + 2-3 setting cards |
| "music video / dance / dialogue-heavy" | Full Project Bible + character cards + Direction Notation upfront (`references/direction-notation.md`) |

If unsure, ask the user: *"do you want me to build a quick character
sheet first so the look stays consistent across all the shots, or
just generate and iterate?"* — most users say yes.

## 1. Project Bible

A YAML-ish header at the top of `setup/bible.md` next to `project.json`:

```
TITLE: <project name>
FORMAT: 9:16 / 16:9 / 1:1
DURATION: ~Ns
TONE: <2–4 adjectives, ideally with one tension — "fast, playful,
       musical mischief"; "calm, contemplative, slightly melancholy">
SHOT NUMBERING: 1.1.1, 1.1.2, ... (scene.beat.panel — load-bearing
                                  ids; use them in chat: "regen 1.1.4")

FLOW INTENTION: <one-sentence emotional metaphor — "Each action is a
                breath of attention", "Every beat is a heartbeat",
                "Each cut is a page turn">

CAMERA GRAMMAR: <1-3 lines describing the pacing arc — "Start close
                for intimacy, open up for energy. Use low angles for
                fire & power. End wide with harmony.">

COLOR PALETTE:
  - <Named Swatch 1> — <visual color> — <mood label>
  - <Named Swatch 2> — ...
  - 3-5 swatches total

BGM LANGUAGE: <if music-driven — "lyria-3-pro: warm jazz piano,
              soft brushes, 90 BPM, melancholic but uplifting">

CASTING:
  - <character-name-1> → see setup/cast/<name-1>.md
  - <character-name-2> → ...

LOCATIONS:
  - <location-1> → see setup/world/<loc-1>.md
```

This is the same five-layer structure documented in
`references/storyboard-design.md`. The bible *is* the design pass;
the storyboard is the shot list that cites it.

**Why one file, not split:** the project bible is the document the
user reads when they ask "what is this video?". Keep it scrollable
and human-readable. Each character/location card lives in its own
file because they're referenced *individually* by per-shot prompts.

## 2. Character Cards — director-grade, not actor-grade

A character card has **two outputs**:

1. A markdown bible (`setup/cast/<name>.md`) — the design document
2. A reference image (`setup/cast/<name>.png`) — the visual canon

The reference image is what every subsequent generation passes via
`--image-urls`. The markdown bible is what the agent reads to *write*
the prompts.

### The director-grade template

Most agents produce "actor headshots" — front view, neutral
expression, plain background. That's an actor's casting photo, not a
character design. The shape that actually drives consistent, alive
generation is a **production-grade design sheet**: identity +
psychology + performance direction + wardrobe + turnaround +
expressions + cinematic portrait, all on one carefully composed page.

The full template (use as the prompt body for the reference image,
swap in your character):

```
Create a cinematic, film-production-grade character design sheet for
a director, casting team, and costume department. Character name:
[YOUR CHARACTER NAME HERE]. Must feel like a high-budget animated
film pitch board, not a generic model sheet.

CORE DIRECTIVE (NON-NEGOTIABLE): No generic layouts. No evenly spaced
grids. No symmetry for symmetry's sake. Composition must feel art-
directed, intentional, slightly asymmetrical. Every section must feel
placed, not auto-generated.

CHARACTER IDENTITY:
  Name: [Full name]
  Alias: [Nickname or codename]
  Age: [Real or stylized]
  Height: [cm or ft]
  Build: [Body type, proportions, posture tendencies]
  Ethnicity / Design Language: [e.g. Pixar-esque, anime-inspired,
                               culturally grounded]

FACE DESIGN:
  Structure: [Face shape, bone structure, exaggeration level]
  Skin: [Tone, texture, imperfections]
  Eyes: [Size, spacing, color, expressiveness]
  Hair: [Style, texture, movement, imperfections]
  Distinct Features: [Scars, dimples, moles, anything unique]

PSYCHOLOGICAL PROFILE:
  Core Traits: [3 to 5 dominant personality traits]
  Internal Conflict: [What they want vs what holds them back]
  Behavior Patterns: [3 habits that reveal their personality]
  Emotional Baseline: [Default mood + how fast it shifts]

PERFORMANCE DIRECTION:
  Character must feel like a real actor caught mid-moment, NOT
  posing. Micro-expressions required (lip tension, eye flicker, brow
  shift). Avoid staged symmetry. Capture transitional emotion.
  Body Language: [Posture tendencies]
  [Movement rhythm: stiff, sharp, bouncy, dragging]
  [Idle behavior: fidgeting, stillness, tension]

WARDROBE:
  Garment 1: [fabric type, wear, imperfections]
  Garment 2: [fit, distortion, stitching]
  Layering logic
  Footwear: [material, wear patterns]
  Accessories: [items that reveal personality]
  Props: [objects that reinforce who they are]

MATERIAL ACCURACY:
  Fabrics must show stretch, stitching, wrinkles, wear. No plastic
  look unless intentional. Skin must have soft light interaction.
  Include imperfections: dirt, smudges, aging, usage marks.

TURNAROUND (STRICT): Full-body front, 3/4, side, back, 3/4 back
views. Identical proportions and design fidelity. No drift in face
or costume across any angle.

HEAD STUDY: Front (neutral), 3/4 (primary personality), Profile
(structure), Looking Down, Looking Up, Dynamic Angle (intense
state). All expressions mid-thought, not posed.

CINEMATIC PORTRAIT:
  Environment: [Location tied to character]
  Lighting: [Practical sources, contrast level]
  Color Tone: [Warm, cool, stylized]
  Expression: [Specific narrative moment]
  Camera: [50mm or 85mm lens, shallow depth of field, cinematic
          realism]

LAYOUT: Clean, art-directed sheet. Neutral gray background. Include
height scale, annotation callouts, wardrobe breakdown, production
notes. Must feel like a premium studio board.

STYLE: [e.g. Pixar-style stylized realism / Semi-realistic cinematic
       design]. Must include: appealing exaggeration, soft geometry,
       cinematic lighting, high emotional readability.

CONSISTENCY RULE (STRICT): Face, proportions, costume, and details
must remain IDENTICAL across all views. No reinterpretation between
angles. Ever.

OUTPUT: Extremely high detail. Sharp focus. Production-ready
fidelity. Suitable for film development, merchandising, and pitch
decks.
```

Three things make this template work where shorter prompts fail:

1. **Production triggers** — `CORE DIRECTIVE (NON-NEGOTIABLE)`,
   `STRICT`, `MUST` — push gpt-image-2 onto its high-effort
   "production board" track. See `references/direction-notation.md`
   for the full vocabulary.
2. **Performance over pose** — "real actor caught mid-moment, NOT
   posing" + micro-expressions specified. This is the difference
   between a Wikipedia-cover face and a character with interiority.
3. **Material accuracy block** — fabrics, wear, imperfections. Forces
   the model out of plastic-doll territory into film-material space.

### Calling it

```bash
# Save the prompt above (with your character substituted) to
# setup/cast/<name>.prompt.md, then:

node .claude/skills/pneuma-clipcraft/scripts/generate_image.mjs \
  "$(cat setup/cast/anya.prompt.md)" \
  --aspect-ratio 16:9 \
  --quality high \
  --output-dir setup/cast \
  --filename-prefix anya
```

Cost: ~$0.16 (gpt-image-2 high quality, 16:9). Inspect, regenerate
once or twice if needed. The cost of the wrong character bible is N
shots × $0.16-1.50 each, so pay for the high-quality bible.

### Distinction from `character-consistency.md`

Both docs deal with "keep the character looking the same across
shots", but they solve different problems:

- **This doc** (`production-bible.md`) — *creative direction*:
  defining who the character IS so prompts read consistently.
- **`character-consistency.md`** — *seedance filter recovery*: a
  specific photo-body / sketch-head sheet shape used **only** when
  the character is photorealistic AND seedance keeps rejecting your
  references. That doc's sheet is a workaround, not a creative
  artifact.

In practice: **build the director-grade card first**. If the
character is photorealistic and seedance starts rejecting at
generation time, *additionally* run the photo-body / sketch-head
sheet workflow from `character-consistency.md`. The two artifacts
coexist — director card for prompt writing, sketch-head sheet for
seedance ingest.

### Worked example — minimal Anya

```
Character: Anya Petrov

CHARACTER IDENTITY:
  Name: Anya Petrov
  Alias: "Spire" (her tower-climbing radio handle)
  Age: 28
  Height: 168 cm
  Build: Lean wiry, slightly hollow shoulders from working long
         hours hunched over signal equipment, posture tilts forward
         when listening
  Ethnicity / Design Language: Eastern European, cinematic-realism

FACE DESIGN:
  Structure: Sharp jaw, high cheekbones, slightly asymmetric — left
             cheek a millimeter higher
  Skin: Cool pale, freckles concentrated on bridge of nose, faint
        scar on left brow
  Eyes: Steel gray, narrow, slow-blink rhythm
  Hair: Ash blonde, jaw-length cut, perpetually pushed behind right
        ear, never both ears
  Distinct Features: Old radio-tower burn on right wrist, three
                     small piercings on left ear

PSYCHOLOGICAL PROFILE:
  Core Traits: Patient, suspicious, dryly funny, completionist,
               quietly defiant
  Internal Conflict: Wants to be heard / refuses to broadcast
  Behavior Patterns: (1) taps morse on her thigh when bored,
                     (2) repeats words back to herself at half-volume
                     before responding, (3) checks signal cables
                     before exits
  Emotional Baseline: Composed and watchful; flares to anger fast
                      then collapses back to composure

PERFORMANCE DIRECTION: ...
WARDROBE:
  Garment 1: Worn olive-drab field jacket, fraying cuffs, faint
             solder burn on right sleeve
  Garment 2: Black thermal henley, sleeve perpetually pushed to
             elbow on the burn-wrist side
  Footwear: Scuffed black combat boots, salt rings from old water
  Accessories: Bone-conduction earpiece in left ear, leather wrist
               wrap on right covering the burn, antique signal
               whistle on a steel chain
  Props: Soldering pen, pocket-sized signal scanner

[... rest of template filled in ...]
```

That bible plus the generated reference image is what every later
shot prompt cites: `--image-urls setup/cast/anya.png` plus, in the
prompt, `"Anya Petrov (see reference) — composed, watchful, jacket
sleeve pushed to elbow, ash blonde hair behind right ear"`. The
prompt stays compact because the bible carries the burden.

## 3. Setting / Prop Cards

For locations and signature props, the same dual-output approach but
with a stripped-down template:

```
Setting card for [LOCATION NAME].

ENVIRONMENT IDENTITY:
  Location: [where it is, era, scale]
  Atmosphere: [time of day, weather, mood]
  Sound profile: [what you hear — "rain on tin roof, distant
                  bells, faint hum of a refrigerator"]

VISUAL DESIGN:
  Materials: [what surfaces are made of, wear patterns]
  Color: [palette colors that dominate, named from project bible]
  Light: [practical sources — windows, lamps, neon signs, fire,
          screens; their direction and softness]
  Decay / use: [what's worn, what's new, what's broken]

SIGNATURE DETAILS: [3-5 specific things that should always appear
                   when this location is shown — "the dripping
                   ceiling pipe in the corner", "the radio tower
                   shadow on the wall after 5pm"]

LAYOUT: Establishing shot composition + 2-3 alternate angles.
        Annotated with camera positions.

STYLE: [match project bible style anchor]

CONSISTENCY RULE (STRICT): Materials, decay, signature details
remain identical across every shot in this location.
```

Generate at the same aspect as your shots (so the establishing shot
in the card doubles as a usable plate). Save to
`setup/world/<location>.png` and cite from prompts the same way as
characters.

For props (the soldering pen, the signal whistle, etc.), generate a
2-3 angle prop sheet only if the prop is hero — likely to be a focus
in multiple shots. Background props don't need cards.

## 4. Workflow integration

When the user hands you a multi-shot brief, the production-bible
phase comes BEFORE storyboard. Order:

1. **Bible** (this doc) — write `setup/bible.md`, generate character
   cards, generate setting cards. Show the user, get approval.
2. **Storyboard** (`references/storyboard-design.md`) — write the
   shot list, citing characters and locations from the bible.
3. **Sketch / anchor / clip** (`references/storyboard-workflow.md`)
   — produce the timeline.

A common shortcut: for projects with one character and one location,
fold the bible into the storyboard's project metadata header. Don't
build separate cards. The threshold for breaking out per-character
files is *2+ recurring people* or *2+ recurring locations*.

## Pitfalls

- **Generating shots before generating the bible.** The agent reads
  the brief, jumps to per-shot prompts, and the user gets twelve
  drifting characters. Always write the bible (markdown + reference
  images) first; show the user; get approval.
- **Skimping on character cards.** A four-line "young chef, leather
  apron, focused" prompt produces an inconsistent character. Use the
  full template; the time and dollar cost are negligible vs the
  downstream regeneration cost.
- **Bible without reference image.** A character card that's
  text-only doesn't constrain seedance. Always generate the
  accompanying image and cite it via `--image-urls`.
- **Re-writing the bible mid-project.** Once shots reference the
  bible, changing the bible silently breaks consistency. If the user
  wants to evolve the character, version the bible
  (`anya-v2.png`) and migrate shots deliberately.
- **Forgetting to register the bible artifacts in `project.json`.**
  Cards are assets too. Register them with
  `operation.params.role: "character-card"` /
  `"setting-card"` so the inspector / dive surfaces them.

## See also

- `references/storyboard-design.md` — the project metadata structure
  and per-panel template (the "shot list" that the bible feeds into)
- `references/character-consistency.md` — *separate problem*:
  seedance filter recovery for photoreal humans (orthogonal artifact)
- `references/direction-notation.md` — production triggers,
  annotation color system, FACS, IPA, and other notation that goes
  inside the character card prompt
- `references/craft.md` — broader principles of short-video craft

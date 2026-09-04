# Style presets

Eighteen built-in recipes — the first nine detailed below, plus the
extended roster at the end (same contract: recipe fragment + narration
mode + best-for). All eighteen were sample-shot, reviewed, and adopted on
2026-09-01; the viewer's style catalog (`viewer/styleCatalog.ts` +
`viewer/style-thumbs/`) mirrors this roster with stills from those
shoots — keep the two in sync when a recipe is added or renamed. Each is a prompt fragment the scriptwriter weaves into the
video prompt, a narration mode, and a sense of what it teaches best. When
auditioning, pick the 3 whose "best for" matches the topic, shoot the SAME
content fragment in each, and let the user choose.

Two facts that shape every recipe:

- **Narration mode decides who speaks.** `on-camera` styles put a character
  on screen whose quoted lines are lipsynced. `voiceover` styles have no
  speaker on screen; the prompt requests a clear narrator voiceover
  speaking the quoted text. Both are spoken verbatim — the QA gate applies
  equally.
- **Knowledge visuals still need reference figures in every style.** A
  chalkboard style does not make a hallucinated chalk diagram acceptable;
  it makes the CORRECT rendered figure need a chalk-styled rendering (draw
  the figure with code in the style's palette, then anchor with
  `--ref-image`).

---

## chalkboard

- **Recipe**: "Hand-drawn chalkboard animation, 16:9. Palette: dark green matte slate
  (#1f3a2e), clean white chalk lines, one warm yellow chalk (#f2d98b) for
  emphasis, no other color. Material: soft chalk texture with faint dust,
  lines that build stroke by stroke and hold. Light: even, slightly warm
  classroom light with a gentle vignette at the edges. Camera moves are slow
  and small."
- **Narration**: voiceover.
- **Best for**: concepts that build up stroke by stroke — processes,
  cycles, cause-and-effect chains. Smoke-validated: excellent line
  coherence for non-quantitative drawings.

## math-anim

- **Recipe**: "Elegant mathematical animation, 16:9. Palette: deep navy background
  (#0b1a3a), curves and shapes in glowing white and warm amber (#f5a623),
  thin luminous grid lines in dim slate blue, no other hue. Material: clean
  vector geometry with a soft bloom on every line, curves that draw
  themselves and morph smoothly. Light: the lines are the light source;
  calm, no flare. Camera drifts gently."
- **Narration**: voiceover.
- **Best for**: math, physics, algorithms — anything whose story is a
  transformation. Highest figure-reference discipline required: every
  curve, axis, and label on screen must come from a rendered figure.

## comic

- **Recipe**: "Hand-drawn ink-line comic, 16:9. Palette: bold black outlines over flat
  colors — warm cream paper (#f4ead6), brick red (#b3382c), teal (#2b7a78),
  mustard (#e0a526) — with halftone dot shading in black. Material: visible
  ink texture, panel-like compositions with clean gutters, expressive
  characters, snappy motion. Light: flat comic lighting with hard cast
  shadows."
- **Narration**: on-camera (a character speaks) or voiceover for
  action-only panels.
- **Best for**: history, stories, dialogues, anything with actors and
  stakes. Pairs well with a recurring user-uploaded character
  (reference-to-video).

## documentary

- **Recipe**: "Cinematic live-action documentary, 16:9. Palette: muted natural grade —
  desaturated greens and earth tones, cool shadows (#2a3038), warm skin.
  Material: real locations, shallow depth of field, fine film grain. Light:
  available natural light, soft and directional, no studio glow. Camera
  handheld-steady with slow reframes."
- **Narration**: voiceover (authoritative, calm).
- **Best for**: geography, nature, industry, biography — topics with a
  physical world to show.

## teacher

- **Recipe**: "Live-action lesson with a warm, credible instructor speaking to camera,
  16:9. Palette: a bright, simple study or classroom — warm white walls
  (#f3efe7), natural wood (#b98a5a), one plain matte board behind the
  speaker, soft navy or charcoal clothing. Material: real skin, fabric and
  wood; a clean uncluttered background. Light: soft daylight from a window
  on one side, gentle fill, no harsh shadows. Medium shot, subtle hand
  gestures, camera steady with tiny natural drift."
- **Narration**: on-camera, lipsynced. Smoke-validated: verbatim speech,
  word-for-word.
- **Best for**: direct explanation, definitions, "let me tell you the one
  thing that matters here" moments. Keep the background SIMPLE — a
  detailed blackboard behind the teacher will be hallucinated unless
  anchored by a reference figure.

## storybook

- **Recipe**: "Soft watercolor picture-book illustration, 16:9. Palette: warm cream paper
  (#f6efe3), gentle washes of sage green (#8fae8b), dusty rose (#d9a5a0),
  sky blue (#a9c8e8) and honey (#e8c27a). Material: visible paper grain,
  feathered wash edges, rounded characters and shapes, storybook framing
  with a soft white border. Light: even, sunny, diffuse. Camera slow and
  dreamy."
- **Narration**: voiceover (warm, unhurried) or an on-camera character.
- **Best for**: young learners, fables, gentle introductions. The natural
  home for a user-uploaded character as the story's hero.

## pixel-quest

- **Recipe**: "Retro 16-bit pixel-art game, 16:9. Palette: a limited 16-color set — deep
  indigo night (#1b1f3b), grass green (#4caf50), sand (#e0c68a), brick
  (#a04a2a), a single gold accent (#ffd54f). Material: chunky crisp pixels,
  no anti-aliasing, parallax layered backgrounds, game-UI framing with no
  readable text. Light: flat pixel shading with two tones per surface.
  Camera side-scrolls or holds."
- **Narration**: voiceover (playful).
- **Best for**: gamified topics — systems, resources, rules, trade-offs
  ("your kingdom's economy" beats "the economy").

## papercraft

- **Recipe**: "Stop-motion paper cutout animation, 16:9. Palette: layered colored card —
  kraft brown (#c9a373), off-white (#f5f0e6), coral (#e57a5a), teal
  (#3d8c8c), mustard (#e3b23c). Material: visible paper fiber and cut edges,
  real drop shadows between layers, slightly jittery handmade motion at 12
  frames per second. Light: a soft overhead lamp casting short shadows.
  Camera overhead or straight-on."
- **Narration**: voiceover.
- **Best for**: structures and compositions — anatomy, layers, parts of a
  whole. Things that assemble.

## holo-lab

- **Recipe**: "Futuristic holographic laboratory, 16:9. Palette: near-black room
  (#05070d), translucent cyan (#3fd6ff) and amber (#ffb347) projections,
  thin white wireframes, faint particle motes. Material: glowing volumetric
  projections floating in dark space, clean wireframe geometry. Light: the
  holograms light the scene; cool rim light on surfaces. Camera orbits
  slowly."
- **Narration**: voiceover (crisp).
- **Best for**: technology, data, systems architecture, space. Wireframe
  "displays" on screen are knowledge visuals — anchor them with figures
  like everything else.

---

## Extended roster

### ink-wash

- **Recipe**: "Traditional Chinese ink-wash (shuimo) painting animation, 16:9. Palette:
  black ink in five tones on warm textured rice paper (#efe8d8), one
  vermilion seal-red accent (#c0392b) at most. Material: flowing brush
  strokes with soft ink blooms and gradients, vast negative space, paper
  grain visible. Light: flat, paper-lit, no cast shadows. Camera slow and
  contemplative."
- **Narration**: voiceover (serene, unhurried).
- **Best for**: philosophy, poetry, classical Chinese culture, nature —
  anything whose mood IS the lesson.

### toy-bricks

- **Recipe**: "Colorful plastic interlocking toy-brick stop-motion, 16:9. Palette: bright
  primaries — red (#d62828), blue (#1d4ed8), yellow (#facc15), green
  (#16a34a) — on a clean pale gray tabletop (#e5e7eb). Material: glossy
  studded generic bricks (never a brand) snapping together piece by piece,
  playful snappy motion. Light: crisp studio softbox lighting with small
  specular highlights. Camera holds or glides gently." (Generic bricks only — never name a brand.)
- **Narration**: voiceover (cheerful).
- **Best for**: construction, structure, engineering — things that
  assemble and bear load.

### flat-vector

- **Recipe**: "Flat vector-design science animation, 16:9. Palette: bold saturated
  gradients — violet (#6d28d9) to blue (#2563eb), coral (#fb7185) to orange
  (#f97316) — on deep charcoal (#111827). Material: clean geometric shapes
  with a subtle grain texture, smooth motion-graphics choreography, no
  outlines. Light: flat, with soft glows behind key shapes. Camera glides
  and eases." (The flagship science-explainer look.)
- **Narration**: voiceover (bright, curious).
- **Best for**: space, biology, big-question science at cosmic or
  microscopic scale.

### doodle-notes

- **Recipe**: "Whiteboard marker doodle animation, 16:9. Palette: clean white paper
  (#fbfbf7), black marker lines, exactly one accent color — orange
  (#f97316). Material: a real hand rapidly sketching simple doodles in
  time-lapse, visible marker stroke texture, slight paper texture. Light:
  bright, even, top-down. Camera holds still from above with small pans to
  follow the hand."
- **Narration**: voiceover (quick-witted).
- **Best for**: quick intuitions, everyday physics, "here's the trick"
  explanations.

### clean-3d

- **Recipe**: "Minimal clean 3D simulation aesthetic, 16:9. Palette: soft matte pastels —
  mint (#a7e3d0), peach (#f6c9b0), sky (#b8d8f5), lavender (#d7c8f0) — on an
  infinite light ground (#f2f2f2). Material: simple rounded 3D shapes with
  matte surfaces, populations of small agents moving cleanly. Light: gentle
  studio lighting with soft contact shadows. Camera slow orbits and dollies."
- **Narration**: voiceover (calm, thoughtful).
- **Best for**: simulations, evolution, probability, emergent systems.

### isometric-tech

- **Recipe**: "Isometric technical infographic animation, 16:9. Palette: cool gray-blue
  (#3b4a5c, #9fb3c8) with orange accents (#f97316) on a light slate ground
  (#e6ebf0). Material: a clean isometric miniature world with crisp edges
  and precise geometry, matte surfaces. Light: soft ambient with a single
  consistent shadow direction. Camera glides smoothly across the miniature."
- **Narration**: voiceover (precise, brisk).
- **Best for**: logistics, infrastructure, how-industry-works topics.
  Floating labels count as knowledge visuals — anchor them with figures.

### vintage-collage

- **Recipe**: "Vintage paper-collage animation, 16:9. Palette: warm sepia — aged
  parchment (#e6d5b0), ink brown (#4a3628), faded teal (#6b8e8e) and rust
  (#a8542f) accents. Material: cut-out antique engraving illustrations with
  visible paper edges, moving with stop-motion jitter over textured
  parchment. Light: warm lamplight with soft vignette. Camera slow pushes
  and pans."
- **Narration**: voiceover (storytelling).
- **Best for**: history of ideas, inventions, biography.

### clay-motion

- **Recipe**: "Claymation stop-motion, 16:9. Palette: saturated plasticine — tomato red
  (#e53935), sky blue (#4fc3f7), sunflower (#fdd835), leaf green (#66bb6a) —
  on a warm tabletop set (#d8c3a5). Material: handmade clay models with
  visible fingerprints and seams, slightly jittery handcrafted motion,
  cutaway views sculpted in clay. Light: warm toy-set key light with soft
  fill. Camera holds or dollies slowly."
- **Narration**: voiceover (amused, warm).
- **Best for**: earth science, anatomy-lite, playful cause-and-effect for
  younger learners.

### anime-scenery

- **Recipe**: "Cinematic Japanese animation film aesthetic, 16:9. Palette: painterly
  skies — deep twilight blue (#1e2a5a), warm apricot (#f8b26a), pale gold
  (#ffe3a3) — with rich cinematic color grading. Material: hand-painted
  backgrounds with soft edges, clean-lined characters in quiet awe of the
  phenomenon on screen. Light: golden-hour glow, lens glints, long soft
  shadows. Camera slow pans and gentle pushes."
- **Narration**: voiceover (soft, wistful) or character lipsync.
- **Best for**: astronomy, weather, emotionally-charged wonder topics.

---

## Sampling well

The style step ends in ONE sample the learner confirms on the board
(`make-style-sample.mjs`: anchor still from the recipe, then a 5s clip
shot from it). Your inputs to it are small; make them count:

- **The hook line, and its action.** Choose the content fragment FIRST:
  the single most receivable sentence of the subject — the hook, the
  "oh that's why", the image the topic is remembered by. Then write what
  the five seconds SHOW (`--action`): that sentence made visible in the
  style's own materials — for a Fourier hook in papercraft, layered
  paper waves rising from the stage, stacking into one jagged wave on
  the board, then peeling apart into three smooth paper curves. Motion
  and objects only: no on-screen text, formulas, labels or numbers
  (those are the course's job, with real figures). The sample teaches
  while it samples, and its last frame is where the course begins. The
  first live sample of this mode skipped the action and came back as an
  empty papercraft blackboard under a Fourier voiceover — the look
  without the topic.
- **Recommending.** One candidate, chosen by "best for" against the
  topic and the learner's stated depth; the `--rationale` is one sentence
  in their language saying why. Never a list of alternatives — the board
  already is the list.
- **Custom briefs.** Turn the learner's words into a recipe in the same
  shape as the entries above: concrete materials, palette, line quality,
  camera manner — never abstract adjectives. Name it in their language.
  Keep what they said; add only what the video model needs to render it.
- **Adjustments.** One revision per request. Change only what the
  feedback names; pass the revised text as `--recipe` so the course
  keeps it.
- A learner's reference images ride along as `--ref-image` (Image 2+ in
  the sample shoot) and, after confirmation, as `refImages[1..]` on
  every segment — a character they uploaded stays the course's cast.
- Confirmed is final: never re-open the style on the stage unless the
  user asks.

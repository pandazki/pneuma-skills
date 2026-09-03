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

- **Recipe**: "Hand-drawn chalkboard animation: clean white chalk lines on
  a dark green matte slate, smooth morphing transitions between drawings,
  slight chalk dust texture, static camera."
- **Narration**: voiceover.
- **Best for**: concepts that build up stroke by stroke — processes,
  cycles, cause-and-effect chains. Smoke-validated: excellent line
  coherence for non-quantitative drawings.

## math-anim

- **Recipe**: "Elegant mathematical animation on a deep navy background:
  glowing white and amber geometric shapes, smoothly morphing curves and
  transforms, thin luminous grid lines, precise serif labels, gentle
  camera drift."
- **Narration**: voiceover.
- **Best for**: math, physics, algorithms — anything whose story is a
  transformation. Highest figure-reference discipline required: every
  curve, axis, and label on screen must come from a rendered figure.

## comic

- **Recipe**: "Hand-drawn ink-line comic: bold black outlines, flat
  colors, halftone shading, expressive characters, panel-like
  compositions, snappy motion."
- **Narration**: on-camera (a character speaks) or voiceover for
  action-only panels.
- **Best for**: history, stories, dialogues, anything with actors and
  stakes. Pairs well with a recurring user-uploaded character
  (reference-to-video).

## documentary

- **Recipe**: "Cinematic live-action documentary: natural light, shallow
  depth of field, handheld-steady camera, real-world locations, muted
  color grade."
- **Narration**: voiceover (authoritative, calm).
- **Best for**: geography, nature, industry, biography — topics with a
  physical world to show.

## teacher

- **Recipe**: "A warm, credible instructor in a bright classroom or study,
  speaking directly to camera, medium shot, natural light, subtle
  hand gestures."
- **Narration**: on-camera, lipsynced. Smoke-validated: verbatim speech,
  word-for-word.
- **Best for**: direct explanation, definitions, "let me tell you the one
  thing that matters here" moments. Keep the background SIMPLE — a
  detailed blackboard behind the teacher will be hallucinated unless
  anchored by a reference figure.

## storybook

- **Recipe**: "Soft watercolor picture-book illustration: warm paper
  texture, gentle washes, rounded characters, storybook framing, slow
  dreamy camera."
- **Narration**: voiceover (warm, unhurried) or an on-camera character.
- **Best for**: young learners, fables, gentle introductions. The natural
  home for a user-uploaded character as the story's hero.

## pixel-quest

- **Recipe**: "Retro 16-bit pixel-art game aesthetic: side-scrolling or
  top-down scenes, chunky sprites, limited palette, parallax backgrounds,
  game-UI framing."
- **Narration**: voiceover (playful).
- **Best for**: gamified topics — systems, resources, rules, trade-offs
  ("your kingdom's economy" beats "the economy").

## papercraft

- **Recipe**: "Stop-motion paper cutout animation: layered colored paper,
  visible texture and drop shadows, slightly jittery handmade motion,
  overhead or straight-on camera."
- **Narration**: voiceover.
- **Best for**: structures and compositions — anatomy, layers, parts of a
  whole. Things that assemble.

## holo-lab

- **Recipe**: "Futuristic holographic laboratory: translucent cyan and
  amber projections floating in a dark space, thin luminous wireframes,
  particle accents, slow orbiting camera."
- **Narration**: voiceover (crisp).
- **Best for**: technology, data, systems architecture, space. Wireframe
  "displays" on screen are knowledge visuals — anchor them with figures
  like everything else.

---

## Extended roster

### ink-wash

- **Recipe**: "Traditional Chinese ink-wash (shuimo) painting animation:
  black ink on textured rice paper, flowing brush strokes with soft ink
  blooms and gradients, vast negative space, slow contemplative camera."
- **Narration**: voiceover (serene, unhurried).
- **Best for**: philosophy, poetry, classical Chinese culture, nature —
  anything whose mood IS the lesson.

### toy-bricks

- **Recipe**: "Colorful plastic interlocking toy-brick stop-motion:
  glossy studded bricks in bright primary colors snapping together piece
  by piece on a clean tabletop, playful snappy motion, crisp studio
  lighting." (Generic bricks only — never name a brand.)
- **Narration**: voiceover (cheerful).
- **Best for**: construction, structure, engineering — things that
  assemble and bear load.

### flat-vector

- **Recipe**: "Flat vector-design science animation: bold saturated
  gradients, clean geometric shapes with subtle grain texture, smooth
  motion-graphics choreography." (The flagship science-explainer look.)
- **Narration**: voiceover (bright, curious).
- **Best for**: space, biology, big-question science at cosmic or
  microscopic scale.

### doodle-notes

- **Recipe**: "Whiteboard marker doodle animation: a real hand rapidly
  sketches simple black marker doodles on clean white paper, time-lapse
  strokes, one accent color."
- **Narration**: voiceover (quick-witted).
- **Best for**: quick intuitions, everyday physics, "here's the trick"
  explanations.

### clean-3d

- **Recipe**: "Minimal clean 3D simulation aesthetic: soft matte pastel
  colors, simple rounded 3D shapes on an infinite light ground, gentle
  studio lighting, populations of simple agents shown with clean motion."
- **Narration**: voiceover (calm, thoughtful).
- **Best for**: simulations, evolution, probability, emergent systems.

### isometric-tech

- **Recipe**: "Isometric technical infographic animation: a clean
  isometric miniature world, crisp edges and precise geometry, cool
  gray-blue palette with orange accents, smooth camera glide."
- **Narration**: voiceover (precise, brisk).
- **Best for**: logistics, infrastructure, how-industry-works topics.
  Floating labels count as knowledge visuals — anchor them with figures.

### vintage-collage

- **Recipe**: "Vintage paper-collage animation: aged parchment
  background, cut-out antique engraving illustrations moving with
  stop-motion jitter, warm sepia with muted accents."
- **Narration**: voiceover (storytelling).
- **Best for**: history of ideas, inventions, biography.

### clay-motion

- **Recipe**: "Claymation stop-motion: handmade plasticine models with
  visible fingerprints, slightly jittery handcrafted motion, warm toy-set
  lighting, cutaway views sculpted in clay."
- **Narration**: voiceover (amused, warm).
- **Best for**: earth science, anatomy-lite, playful cause-and-effect for
  younger learners.

### anime-scenery

- **Recipe**: "Cinematic Japanese animation film aesthetic: painterly
  skies and light, rich color grading, lens glints, characters in quiet
  awe of the phenomenon on screen."
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

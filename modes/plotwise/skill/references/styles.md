# Style presets

Eighteen built-in looks, each written as **art direction a director could
shoot** rather than as a mood. An entry has four working parts:

- **Recipe** — the quoted fragment. It is copied VERBATIM as block 1 of
  every clip prompt (`1. Style anchor: …`) and again as the opening of
  the anchor key frame's image prompt, so it is a standing instruction
  for a MONTAGE — up to 15 seconds, 3-9 time-coded cuts — and never for
  one long take. It fixes kind and frame, the palette *with a rule about
  the palette*, material, light, and how the camera behaves ACROSS cuts.
- **Graphic devices** — this look's own compositional moves: what the
  writer reaches for cut by cut so that eight cuts are eight different
  pictures instead of one framing shown eight times. (Not the beat's
  *visual device*, which is the concrete thing that carries the idea —
  the plan chooses that, and the writer builds it out of these
  materials.)
- **Narration** — who speaks (see the two facts below).
- **Best for / Never for** — what this look teaches well, and the
  subjects it actively damages. Both halves are needed to choose between
  candidates; "never for" is the half that stops a three-colour casino
  poster from being proposed for compound interest.

**Narrowing and sampling.** Read "Best for" and "Never for" against the
topic and the learner's stated depth, keep the two or three that survive
both, then shoot ONE — the recommendation (see *Sampling well* at the
end). The sample is the hook's first montage clip, written by the same
writer and assembled by the same prompt builder as a real scene, over an
anchor that is a composed key frame of the hook's own device: what the
learner confirms is what they will get. If they want to compare, shoot
the SAME hook and the SAME device in the other look — only then is the
difference the style.

All eighteen were sample-shot and reviewed on 2026-09-01, under the
pre-montage grammar; the stills in the viewer's style catalog
(`viewer/styleCatalog.ts` + `viewer/style-thumbs/`) come from those
shoots. Keep that catalog in sync with the entries below: its card pitch
is the short form of this entry's "Best for" (one truncated line, so keep
it short), and `__tests__/style-board.test.tsx` fails if the roster, its
order or a narration mode drifts from this file. Measured notes inside an
entry record what was actually observed — keep them.

Two facts that shape every recipe:

- **Narration mode decides who speaks.** `on-camera` styles put a
  character on screen whose quoted lines are lipsynced. `voiceover`
  styles have no speaker on screen; the prompt requests a clear narrator
  voiceover speaking the quoted text. Both are spoken verbatim — the QA
  gate applies equally.
- **Knowledge visuals still need reference figures in every style.** A
  chalkboard look does not make a hallucinated chalk diagram acceptable;
  it makes the CORRECT rendered figure need a chalk-styled rendering
  (draw the figure with code in the style's palette, then bind it as a
  reference on the cut that shows it).

---

## chalkboard

- **Recipe**: "Chalk-drawn board animation, 16:9. The slate fills the frame; the room
  is never shown. Palette: dark green matte slate (#1f3a2e), white chalk
  for everything, one warm yellow chalk (#f2d98b) for the single thing
  that matters in a cut — three values, no fourth colour, no gradients.
  Material: soft chalk with dust in the stroke, lines laid down stroke by
  stroke and left standing, erasures leaving a grey ghost. Light: even,
  slightly warm room light with a gentle vignette at the board's edges.
  Across cuts the framing changes rather than the camera — the whole
  board, then one corner of it, then a detail; within a cut a slow push,
  a short pan following a line as it is drawn, or a dead hold. Nobody in
  frame."
- **Graphic devices**: the board as one surface revisited at three scales;
  arrows and braces tying together things already drawn; a chalk-boxed
  label; a numbered column down the left edge; a ghost-smear erasure
  clearing a region for what comes next; the same drawing redrawn one
  step further beside its earlier state.
- **Narration**: voiceover.
- **Best for**: anything whose truth is the order it is built in —
  derivations, procedures, cause-and-effect chains, proofs. The board
  keeps a running record, so a later cut can point back at what an
  earlier cut drew. Smoke-validated: excellent line coherence for
  non-quantitative drawings.
- **Never for**: subjects whose lesson is how something looks or feels —
  food, materials, landscape, art — and anything with human stakes in
  it: chalk turns grief, war and illness into diagrams.

## math-anim

- **Recipe**: "Elegant mathematical animation, 16:9. A dark field with a faint
  coordinate grid; the objects are lines and surfaces, never props.
  Palette: deep navy ground (#0b1a3a), curves and shapes in glowing white
  with warm amber (#f5a623) for the one quantity under discussion, grid
  lines in dim slate blue — two inks on navy, no third hue. Material:
  clean vector geometry, thin luminous strokes with a soft bloom, curves
  that draw themselves and morph into one another, the grid fading up
  beneath them. Light: the lines are the only light source; no flare, no
  ambient glow. Across cuts the frame jumps scale — the whole field, one
  region, a single point — and within a cut it drifts slowly, eases into
  a scale change centred on the object, or holds while a line draws."
- **Graphic devices**: the grid as a stage that can be zoomed by orders of
  magnitude; the same object in three registers across three cuts (the
  whole curve, the tangent at a point, the point); a split frame with
  before and after a transformation; a value tracing along an axis;
  layers stacking into a surface; an amber residual left standing over a
  white ideal.
- **Narration**: voiceover.
- **Best for**: mathematics, physics and algorithms — a lesson whose story
  IS a transformation, and one that gains from seeing the same object at
  two scales in two cuts. Highest figure-reference discipline on the
  roster: every curve, axis, label and number on screen must come from a
  rendered figure.
- **Never for**: anything social, historical or embodied — a navy void has
  no period, no place and no bodies; and anything whose lesson is a real
  object's material (a cell, an engine, a dish), which the glow abstracts
  into geometry.

## comic

- **Recipe**: "Ink-line comic in motion, 16:9. Compositions are panels with clean
  gutters, one panel filling the frame at a time. Palette: bold black
  outlines over four flats — warm cream paper (#f4ead6), brick red
  (#b3382c), teal (#2b7a78), mustard (#e0a526) — with shading only as
  black halftone dots; no gradients, no fifth colour. Material: visible
  ink texture with the weight varying along the line, expressive faces,
  snap motion with speed lines. Light: flat comic light, cast shadows as
  one solid black shape. Across cuts every cut is a new panel — a wide
  establishing panel, a close on a face, an insert of the object in
  question — and within a panel the camera pushes a little, whip-pans, or
  holds."
- **Graphic devices**: a panel grid, and one splash panel that breaks it;
  hard silhouettes against a single flat; halftone as sky, smoke or
  dread; speed lines and impact bursts; extreme scale jumps (an eye, then
  the city); two panels side by side putting cause next to effect; a
  lettered sound word, only where the prompt spells it in quotes.
- **Narration**: on-camera (a character speaks) or voiceover for
  action-only panels.
- **Best for**: history, biography, negotiation, ethics — any lesson where
  somebody wants something and might fail. The panel grid is built for
  stakes and for cutting between the two sides of a conflict. Pairs well
  with a recurring learner-uploaded character (reference-to-video).
- **Never for**: quantitative work — the ink line flatters approximation
  and halftone eats fine figures; and material that must be handled
  soberly (a medical procedure, a death toll, a living tragedy), where
  the comic register reads as making light of it.

## documentary

- **Recipe**: "Cinematic live-action documentary, 16:9. Real locations, real people at
  real work, real faces; nothing is animated. Palette: a muted natural
  grade — desaturated greens and earth tones, cool shadows (#2a3038),
  warm skin — and no colour that is not in the location. Material: shallow
  depth of field, fine film grain, sweat and dust and wear left in.
  Light: available light, soft and directional, no studio glow. Across
  cuts the same subject is shown wide, then medium, then macro, cutting
  on the action; within a cut the camera is handheld-steady and reframes
  slowly, never zooms."
- **Graphic devices**: the wide-medium-macro triad on one subject;
  over-the-shoulder on the work; a static frame the subject walks into
  and out of; the same place at two times of day; parallel cuts between
  two places doing the same thing; a body beside the thing to set its
  scale.
- **Narration**: voiceover (authoritative, calm).
- **Best for**: geography, ecology, industry, craft, biography — lessons
  whose evidence is a real place, a real process or a real face, where
  seeing it once beats any diagram.
- **Never for**: anything that cannot be photographed. An abstract
  transformation, an equation, a probability, the inside of an atom:
  live action will invent a convincing-looking laboratory instead, and
  the invention is what the learner remembers. Also not for history or
  crime, where reconstructed footage reads as evidence.

## teacher

- **Recipe**: "Live-action lesson, a warm and credible instructor speaking to camera,
  16:9. Palette: a bright plain study — warm white walls (#f3efe7),
  natural wood (#b98a5a), one matte board behind the speaker, navy or
  charcoal clothing; nothing hangs on the walls. Material: real skin,
  fabric and wood, and a background identical in every cut. Light: soft
  daylight from one side, gentle fill, no harsh shadow. Across cuts the
  shot changes size but never the axis — a medium of the speaker, a
  tighter frame for the sentence that matters, an insert of the object in
  their hands — and within a cut the camera is steady with a tiny natural
  drift."
- **Graphic devices**: the same speaker at two focal lengths as emphasis;
  an object held up to camera and turned; the plain board behind used as
  the one place a bound figure appears; a cutaway to the object alone on
  the desk; the speaker stepping out of frame so the figure has it to
  itself.
- **Narration**: on-camera, lipsynced. Smoke-validated: verbatim speech,
  word-for-word.
- **Best for**: definitions, the one thing that matters, and unlearning a
  named misconception — topics where trust is the payload and a face
  saying it outweighs an animation of it.
- **Never for**: anything the speaker could only describe — a mechanism, a
  scale, a transformation, a population; the frame is a person talking,
  so the lesson stays words. Keep the background SIMPLE: a detailed
  blackboard behind the speaker is hallucinated unless a reference figure
  is bound to that cut.

## storybook

- **Recipe**: "Soft watercolour picture-book illustration, 16:9, each picture inside a
  soft white margin. Palette: warm cream paper (#f6efe3) with gentle
  washes of sage green (#8fae8b), dusty rose (#d9a5a0), sky blue
  (#a9c8e8) and honey (#e8c27a) — washes only, no saturated hue and no
  coloured outline. Material: visible paper grain, feathered wash edges,
  rounded shapes, shadows painted as a wash rather than drawn. Light:
  even, sunny and diffuse. Across cuts the pictures turn like pages — a
  full spread, a small vignette detail floating in white, then the spread
  again with one thing changed — and within a cut the camera drifts or
  pushes gently, never fast."
- **Graphic devices**: the spread with its white margin; a vignette detail
  alone in empty white; a repeated layout returned to with one element
  different; a small hero against a large landscape for scale; three
  small pictures in a row across the frame; the wash bleeding to carry
  weather, season or time.
- **Narration**: voiceover (warm, unhurried) or an on-camera character.
- **Best for**: young learners and first encounters — a fable, a life
  cycle, a journey with a small hero who wants something. The natural
  home for a learner-uploaded character as the story's lead.
- **Never for**: work that must be exact or adult — quantities,
  engineering, medicine, money; the wash turns numbers into decoration.
  And not for real horror (war, extinction, disease): the register
  promises it turns out well.

## pixel-quest

- **Recipe**: "Retro 16-bit pixel-art game, 16:9. Palette: a limited sixteen-colour
  set — deep indigo night (#1b1f3b), grass green (#4caf50), sand
  (#e0c68a), brick (#a04a2a) and one gold accent (#ffd54f) — two tones
  per surface, no anti-aliasing, no gradients. Material: chunky crisp
  pixels, parallax background layers, sprites animating on a few frames,
  game-UI framing with no readable text. Light: flat pixel shading, the
  gold reserved for whatever the cut is about. Across cuts the game
  changes screen — a side-scrolling level, one room held static, a sprite
  close-up, a zoomed-out map — and within a cut the camera scrolls at a
  constant speed or holds."
- **Graphic devices**: a side-scrolling level as a progress bar;
  room-to-room cuts as the steps of a process; sprite meters, hearts and
  coin counters as quantities; a map screen for the whole system; one
  sprite in three states; a tiled resource multiplying to show
  accumulation.
- **Narration**: voiceover (playful).
- **Best for**: rules, resources, incentives and trade-offs — an economy,
  an ecosystem read as a system, game theory, anything understood by
  playing it. "Your kingdom's grain reserve" beats "the supply of grain".
- **Never for**: subjects needing fine detail or gravity — anatomy, a real
  atrocity, a precise chart — and anything where the learner must trust
  the picture as reality (medicine, law, safety).

## papercraft

- **Recipe**: "Stop-motion paper cutout animation, 16:9, shot on a table. Palette:
  layered coloured card — kraft brown (#c9a373), off-white (#f5f0e6),
  coral (#e57a5a), teal (#3d8c8c), mustard (#e3b23c) — flat colour only,
  nothing shiny and no printed detail. Material: visible paper fibre and
  scissor-cut edges, real drop shadows between the layers, handmade
  motion at twelve frames per second with a slight jitter. Light: one
  soft overhead lamp, short shadows all falling the same way. Across cuts
  the table is seen from above as a flat lay, then straight on as an
  elevation, then macro on a single cut edge; within a cut the camera
  pushes down slowly or slides across the table."
- **Graphic devices**: the top-down flat lay; an exploded stack lifted
  layer by layer; a cross-section straight through the middle; pieces
  sliding in from off-frame to assemble; a paper band or ramp used as an
  axis; one shape multiplied into a grid to be counted.
- **Narration**: voiceover.
- **Best for**: structure and composition — layers, the parts of a whole,
  how a thing is assembled and taken apart — and growth by repetition
  (validated in W1: self-replicating paper coins climbing a rising teal
  band).
- **Never for**: anything smooth, glowing or fast — fluids, light,
  electricity, high-speed motion; and any topic that must feel
  authoritative, since cut card says "made at a table this afternoon".

## holo-lab

- **Recipe**: "Futuristic holographic laboratory, 16:9. A near-black room (#05070d) in
  which translucent projections float; the room itself is barely visible.
  Palette: cyan (#3fd6ff) and amber (#ffb347) projections with thin white
  wireframes and faint particle motes — two projection colours, black
  everywhere else. Material: volumetric light with clean wireframe
  geometry inside it, glass-like surfaces taking a cool rim. Light: the
  holograms are the light; no lamps, no daylight. Across cuts the model
  is seen in orbit, then from directly above as an array, then from
  inside the volume; within a cut the camera orbits slowly, dollies
  through, or holds while a projection builds."
- **Graphic devices**: an exploded assembly rotating in mid-air; a ring of
  small panels around one large one; a wireframe skeleton filling in to a
  solid; a slice plane travelling through a volume; a scale jump from the
  whole array to one node; a ribbon of light flowing between two nodes.
- **Narration**: voiceover (crisp).
- **Best for**: engineering, systems architecture, networks, spacecraft —
  anything whose real form is invisible and is best understood as a
  three-dimensional model you can walk around. Wireframe displays are
  knowledge visuals: bind a figure to the cut that shows one.
- **Never for**: anything human, historical or made by craft — a life, a
  trade, a social process; the dark lab has no period and no place, and
  it turns every subject into a product demo. Also wrong for a gentle
  first contact with a field: the register is expert, not welcoming.

## ink-wash

- **Recipe**: "Traditional Chinese ink-wash (shuimo) painting animation, 16:9, with
  more empty paper than image. Palette: black ink in five tones on warm
  textured rice paper (#efe8d8) and at most one vermilion seal-red
  (#c0392b) — ink, paper, one red, nothing else. Material: flowing brush
  strokes with soft blooms spreading into the fibre, wet edges, visible
  paper grain. Light: flat and paper-lit, no cast shadows. Across cuts
  the frame moves between a wide expanse holding one small mark, a mid
  frame of a stroke being made, and a macro of ink blooming; within a cut
  the camera pans slowly across the paper or holds while the ink
  spreads."
- **Graphic devices**: extreme negative space with one small subject; a
  scroll panned right to left as a timeline; the single stroke that
  resolves into a mountain; ink dropped into water as a change spreading;
  a red seal stamped to close a beat; two washes overlapping where they
  meet.
- **Narration**: voiceover (serene, unhurried).
- **Best for**: philosophy, poetry, classical Chinese subjects, and
  weather or ecology taken slowly — lessons where the mood is part of the
  meaning and what is left out does the work.
- **Never for**: anything that must be enumerated or exact — a table, a
  mechanism, a dosage, a rate; the wash cannot hold a number. And not for
  comedy or urgency: the pace IS the style, and hurrying it destroys the
  look.

## toy-bricks

- **Recipe**: "Colourful plastic interlocking toy-brick stop-motion, 16:9, on a clean
  pale grey tabletop (#e5e7eb). Generic bricks only, never a brand, no
  decals. Palette: bright primaries — red (#d62828), blue (#1d4ed8),
  yellow (#facc15), green (#16a34a) — plus the grey table, and no other
  hue. Material: glossy studded bricks snapping together piece by piece,
  small specular highlights, snappy stop-motion. Light: crisp studio
  softbox with one shadow direction. Across cuts the build is seen
  straight on as an elevation, from above on its baseplate, and macro as
  a single stud clicks home; within a cut the camera glides a short
  distance or holds while a piece lands."
- **Graphic devices**: brick-by-brick assembly as numbered steps; a column
  of bricks as a bar in a chart; a structure flexing and failing under
  load; two builds compared side by side in one frame; the baseplate grid
  as coordinates; a cross-section made by lifting out one row.
- **Narration**: voiceover (cheerful).
- **Best for**: construction, structure, modularity and standards —
  anything understood by watching it assembled from identical units, and
  anything that can be made to fail under load.
- **Never for**: organic or continuous subjects — bodies, fluids, weather,
  feeling; studs and right angles quantize everything. And not where a
  toy register would trivialize the stakes.

## flat-vector

- **Recipe**: "Flat vector-design science animation, 16:9 — the flagship
  science-explainer look. Palette: deep charcoal ground (#111827) with
  two gradient families, violet (#6d28d9) to blue (#2563eb) and coral
  (#fb7185) to orange (#f97316); no outlines and no third family.
  Material: clean geometric shapes with a fine grain over them,
  motion-graphics choreography where shapes translate, scale and morph on
  eased curves. Light: flat, with a soft glow set behind the shape that
  matters. Across cuts the frame jumps scale hard — a full-frame
  composition, a detail of the same shapes, a wide of the whole field —
  and within a cut the shapes move while the frame glides and eases."
- **Graphic devices**: extreme scale jumps (a galaxy, then a cell, in two
  cuts); nested circles for containment; one shape morphing into the next
  idea across a cut; a radial burst for a cause; a stacked bar or ring as
  a quantity, taken from a figure; a silhouette against the glow.
- **Narration**: voiceover (bright, curious).
- **Best for**: big-question science at scales nobody can photograph —
  cosmology, evolution, cell biology, the statistics of a population —
  and quantities that grow (validated in W1: a coin tree budding upward
  for compound interest).
- **Never for**: lessons whose payload is texture, place or a face — a
  craft, a city, one person's life — and topics that must not look
  polished (a tragedy, a live controversy), where the motion-graphics
  sheen reads as advertising.

## doodle-notes

- **Recipe**: "Whiteboard marker doodle animation in time-lapse, 16:9, shot from
  straight above the sheet. Palette: clean white paper (#fbfbf7), black
  marker, and exactly one accent orange (#f97316) — no other colour at
  any point. Material: a real hand drawing quick simple doodles in fast
  time-lapse, marker stroke texture with an uneven squeaky line, faint
  paper tooth. Light: bright, even and top-down. Across cuts the sheet is
  seen whole, then close on the drawing being made, then whole again with
  more on it; within a cut the frame holds and pans a little to follow
  the pen."
- **Graphic devices**: a sheet filled outward around one central doodle;
  arrows and circled words tying together what is already drawn; a
  two-column comparison; the wrong version crossed out beside the right
  one; stick figures for people and blobs for everything else; one big
  orange ring to say "this one"; the drawing hand entering frame to add a
  single thing.
- **Narration**: voiceover (quick-witted).
- **Best for**: quick intuitions and mental models — the trick behind a
  formula, why an everyday thing works, a rule of thumb — and correcting
  a named misconception, since the wrong version can stay on the page
  beside the right one.
- **Never for**: claims that must look considered — a medical fact, a
  legal rule, a real dataset — and anything whose lesson is beauty or
  place (art, landscape, food), which a marker cannot render.

## clean-3d

- **Recipe**: "Minimal clean 3D simulation aesthetic, 16:9, on an infinite light
  ground (#f2f2f2). Palette: soft matte pastels — mint (#a7e3d0), peach
  (#f6c9b0), sky (#b8d8f5), lavender (#d7c8f0) — matte throughout, no
  texture, no reflection, no outline. Material: simple rounded
  primitives, populations of small identical agents moving cleanly, soft
  contact shadows under everything. Light: gentle studio light from
  above, no specular highlight. Across cuts the same run is seen high and
  wide over the whole population, at eye level tracking beside a few
  agents, and from directly above as a field; within a cut the camera
  orbits slowly, dollies alongside the motion, or holds."
- **Graphic devices**: a population of identical agents with one coloured
  differently; a top-down field showing a distribution; a ramp, funnel or
  gate as the constraint; the same run repeated as a small multiple
  across the frame; one agent multiplying into a crowd; a crowd settling
  into the shape of a histogram (bound from a figure).
- **Narration**: voiceover (calm, thoughtful).
- **Best for**: simulation, probability, evolution, emergence, queueing —
  lessons where the point is what a population does rather than what one
  member does. Validated in W1 (a mint mother ball spawning peach
  offspring up a ramp).
- **Never for**: subjects with real texture, culture or history; the
  infinite white ground erases place. And not one individual's story —
  the look is built for many, and a single pastel shape carries no
  personality.

## isometric-tech

- **Recipe**: "Isometric technical infographic animation, 16:9, a miniature world on a
  light slate ground (#e6ebf0) with no perspective convergence. Palette:
  cool grey-blues (#3b4a5c, #9fb3c8) carrying the world and orange
  (#f97316) marking exactly one thing per cut; matte surfaces, no other
  hue. Material: crisp edges, precise repeated geometry, small machines
  and vehicles moving along the isometric axes. Light: soft ambient with
  a single consistent shadow direction. Across cuts the frame moves from
  the whole miniature to one district of it to a macro of one machine;
  within a cut the camera glides along an isometric axis and never
  rotates off it."
- **Graphic devices**: the whole plate panned across on one axis; a
  district lifting out of the plate; an orange flow line travelling a
  route from end to end; stacked plates for a layered system (network
  tiers, floors, stages); one unit tiled to show volume; a cutaway of a
  single building.
- **Narration**: voiceover (precise, brisk).
- **Best for**: logistics, infrastructure, supply chains and how an
  industry actually runs — anything with routes, stages and throughput,
  where the whole and one node belong in the same look. Floating labels
  count as knowledge visuals: bind a figure to the cut that shows one.
- **Never for**: anything intimate or urgent — one person's experience, a
  feeling, a moment of danger; the god's-eye axonometric holds everything
  at arm's length. And not for organic form (a body, a forest), which the
  grid stiffens.

## vintage-collage

- **Recipe**: "Vintage paper-collage animation, 16:9, cut-outs moved over textured
  parchment. Palette: warm sepia — aged parchment (#e6d5b0), ink brown
  (#4a3628) with faded teal (#6b8e8e) and rust (#a8542f) accents; nothing
  that looks printed after 1900. Material: antique engraving
  illustrations with visible cut paper edges, hinged at the joints,
  moving with stop-motion jitter; the parchment's tooth visible under
  everything. Light: warm lamplight with a soft vignette. Across cuts the
  collage is seen as a full spread, close on one cut-out, and macro on a
  torn edge; within a cut the camera pushes slowly or pans across the
  paper."
- **Graphic devices**: engraving cut-outs hinged to move at a joint; a torn
  strip across the frame as a timeline; a portrait cut-out beside the
  thing that person made; one paper sliding over another to replace it;
  an old map with a route inked across it; the same object in three
  historical versions in a row.
- **Narration**: voiceover (storytelling).
- **Best for**: the history of ideas, invention, the biography of a
  discovery — subjects genuinely of the past, where the material itself
  dates the story and a superseded model can be visibly covered over.
- **Never for**: anything current or forward-looking — a live technology, a
  policy argument, this year's data; parchment says "settled long ago".
  And not for precise quantitative work: the engraving texture eats fine
  figures.

## clay-motion

- **Recipe**: "Claymation stop-motion, 16:9, on a warm tabletop set (#d8c3a5).
  Palette: saturated plasticine — tomato red (#e53935), sky blue
  (#4fc3f7), sunflower (#fdd835), leaf green (#66bb6a); plasticine
  colours only, no metal, no glass, no gloss. Material: handmade clay
  models with fingerprints and seams left in, everything sculptable
  including cutaways, slightly jittery handcrafted motion. Light: warm
  toy-set key with soft fill and one shadow direction. Across cuts the
  set is seen straight on, from above, and macro on a fingerprinted
  surface; within a cut the camera holds or dollies slowly."
- **Graphic devices**: a cutaway sculpted through a model (a planet, a
  tooth, a volcano); clay squashed, stretched or torn to show a force;
  two lumps merging or splitting; a layered slab peeled apart; the same
  model re-sculpted into its next state; a small clay stand-in placed
  beside the model to set its scale.
- **Narration**: voiceover (amused, warm).
- **Best for**: earth science, weather, the body at a friendly level, and
  playful cause-and-effect for younger learners — anything you can cut in
  half, squash, or watch deform.
- **Never for**: precision or authority — a real procedure, a financial
  model, a dataset — and any topic where visible fingerprints undercut
  the claim (a safety instruction, a legal fact, a diagnosis).

## anime-scenery

- **Recipe**: "Cinematic Japanese animation film aesthetic, 16:9: painted backgrounds
  with clean-lined characters small inside them. Palette: painterly skies
  — deep twilight blue (#1e2a5a), warm apricot (#f8b26a), pale gold
  (#ffe3a3) — richly graded, and the sky sets the palette for everything
  under it. Material: hand-painted backgrounds with soft edges,
  cel-shaded figures against them, haze and air between the layers.
  Light: golden-hour glow, lens glints, long soft shadows. Across cuts
  the frame moves between a wide landscape with a small figure in it, a
  low angle up at the sky, and a close on a face reacting; within a cut
  the camera pans slowly, pushes gently, or holds while only the clouds
  move."
- **Graphic devices**: a small figure at the bottom of a huge sky; a low
  angle up through power lines or branches; the same landscape at three
  times of day; the phenomenon carried in a reflection (water, a window,
  an eye); a long hold on a face; everything still except moving light
  and cloud.
- **Narration**: voiceover (soft, wistful) or character lipsync.
- **Best for**: astronomy, weather, seasons, the slow drama of geology —
  subjects whose payload is awe, where a learner has to feel the scale
  before they will care about the mechanism.
- **Never for**: anything that must be read exactly — a chart, a
  procedure, a definition; the grading and the glints fight fine detail.
  And not for briskly practical material (a how-to, a quick tip), where
  the wistful pace stalls the lesson.

---

## Sampling well

The style step ends in ONE sample the learner confirms on the board
(`make-style-sample.mjs`: a composed STYLE KEY FRAME in the recipe, then
the hook's first MONTAGE CLIP shot from it — the same writer, the same
prompt builder and the same QA as a real scene). Your inputs to it are
small; make them count:

- **The hook line, and its action.** Choose the content fragment FIRST:
  the single most receivable sentence of the subject — the hook, the
  "oh that's why", the image the topic is remembered by. Then write what
  those seconds SHOW (`--action`): that sentence made visible in the
  style's own materials — for a Fourier hook in papercraft, layered
  paper waves rising from the stage, stacking into one jagged wave on
  the board, then peeling apart into three smooth paper curves. Motion
  and objects only: no on-screen text, formulas, labels or numbers
  (those are the course's job, with real figures). The `--action` device
  also composes the key frame, so it decides what the whole course
  inherits: the clip becomes the course's voice reference and the anchor
  becomes Image 1 of every clip. The first live sample of this mode
  skipped the action and came back as an empty papercraft blackboard
  under a Fourier voiceover — the look without the topic.
- **Recommending.** One candidate, chosen by reading "Best for" AND
  "Never for" against the topic and the learner's stated depth; the
  `--rationale` is one sentence in their language saying why. Never a
  list of alternatives — the board already is the list.
- **Custom briefs.** Turn the learner's words into a recipe in the same
  shape as the entries above: kind and frame, palette with a rule,
  material, light, camera behaviour across cuts — never abstract
  adjectives. Name it in their language. Keep what they said; add only
  what the video model needs to render it.
- **Adjustments.** One revision per request. Change only what the
  feedback names; pass the revised text as `--recipe` so the course
  keeps it.
- A learner's reference images ride along as `--ref-image` (Image 2+ in
  the sample shoot) and, after confirmation, as `refImages[1..]` on
  every clip — a character they uploaded stays the course's cast.
- Confirmed is final: never re-open the style on the stage unless the
  user asks.

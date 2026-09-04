# Plotwise — H3 best practices baked into the scripts

**Status:** implementing (branch `plotwise/h3-best-practices`), 2026-09-04
**Source of the practices:** [LIUFelix2004/God-minmax-H3](https://github.com/LIUFelix2004/God-minmax-H3)
(MIT; five validated prompt templates + a prompt grammar for MiniMax H3),
the fal H3 Max API schema, and our own smoke tests (2026-09-01/02) and blind
trials (2026-09-03).

## Why

The play manager already gets the *facts* right (figures as references,
narration transcribed and checked). What the trials showed is that the
*production* still lives below what H3 can do: the narrator's voice is
free to change between shots, every shot's camera is a default "slow
push-in", the soundscape is one generic sentence, and the style recipes
name a material but not a palette. The user tried the community's
practices by hand and found the difference obvious. The principle this
proposal follows is the user's: **the best practice lives in the script,
not in the model's head** — Luna writes narration and picture, and a
deterministic builder turns that into the prompt H3 wants. When the
practice improves, one module changes.

## What we take from God-minmax-H3 (and what we don't)

| Practice | Take | Where |
|---|---|---|
| Style anchor first, five elements (kind / frame / **concrete colors** / material / light), rewritten verbatim in every segment | Yes — recipes rewritten to five elements; always the first sentence of every shot's prompt | `references/styles.md`, `h3-prompt.mjs` |
| No camera = dead static shot; every beat carries a camera move | Yes — camera is part of every beat; the builder supplies a default and the validator names the omission | `h3-prompt.mjs`, `screenplay-lib.mjs` |
| Time-coded shot list ("0-4s … 4-9s …") makes the model's time allocation precise | Yes — a shot's picture is written as timed beats aligned to the narration; still ONE continuous take, no cuts | writer schema `beats[]` |
| Audio in three layers (ambience / action SFX / voice) with the moment they land | Yes — narration is the voice layer; the writer adds one `sound` line (ambience + SFX with timing) that becomes `overall_soundscape` | writer schema `sound` |
| Reference material governs identity; `reference_audio` or the voice changes across segments | **Yes, the biggest gap** — the confirmed sample's narration becomes the course's voice reference on every reference-to-video shot | manager, `segment-lib::planRefs` |
| Character sheet (2–3 angles) to *every* segment including the first | Yes for on-camera / recurring-character courses, as part of `continuity: locked` | manager start-up (`make-continuity-kit`) |
| Negative constraints always; people → limbs/faces/lipsync | Yes — style-family negatives appended by the builder | `h3-prompt.mjs` |
| Seams: 0.2 s audio crossfades, cut at breaths | Yes, scaled: 30 ms fades at every shot join; shots already end at sentence boundaries | manager `concat` |
| 8–12 cuts inside one 15 s prompt | **No** — a teaching shot is one continuous take; cuts inside a shot fight continuity and the frame chain. Beats give the timing benefit without cuts | — |
| Bracket camera tags `[推进]` | No — fal's H3 Max expander is documented against natural-language camera (motion + amplitude + speed); the tags are the MiniMax-platform dialect | — |
| 768P → 2K regeneration, Context-IR | Not on fal H3 Max | — |

## Decisions

**D1 — One module owns the H3 prompt.** `skill/scripts/h3-prompt.mjs`
exports `buildShotPrompt` (moved from `screenplay-lib.mjs`, which
re-exports it) and `H3_PRACTICES_VERSION`. The prompt keeps fal's
three-section shape (`integrated_multimodal_description` /
`overall_soundscape` / `non_diegetic_music`) because that is what the
expander rewrites toward, and inside the description follows the
four-block order: style anchor → (bindings injected at shoot time) →
continuity → timed beats with camera → figure clause → narration →
negatives. `references/h3-best-practices.md` is the human-readable twin
with provenance; SKILL.md points at it and says nothing about prompt
craft itself.

**D2 — The writer's shot gains `beats[]` and `sound`.** A beat is
`{ from, to, action, camera }` in seconds inside the shot; beats cover the
shot, one continuous take. `sound` is one sentence: ambience + action SFX
and when they land. Both optional — a shot with only `visual` still
builds. The validator clamps beat times to the duration and reports a
beat without a camera (the builder fills a default so nothing breaks).
`visual` stays as the one-line summary the viewer shows.

**D3 — The confirmed sample is the voice reference.** At manager start
(`ensureContinuityKit`) the sample's audio is extracted to
`style/voice.mp3` (≥ 2 s, ≤ 15 s) and every reference-to-video shot
passes it as `--ref-audio`, with an `Audio N is the narrator's voice…`
binding injected like the image bindings. Measured 2026-09-04 (480P,
7 s shot, same prompt): reference-to-video 14.4 s without, 18.4 s with
the audio reference — the cost is four seconds a shot.

**D4 — `continuity` init param: `locked` (default) | `chain`.** Revised
twice. E2 showed image-to-video from the previous last frame is a true
continuation while reference-to-video given the same frame reframes it
(a matched cut, ~7 s slower), which argued for a `chain` default; the
user then set the rule that decides it: **narration and voice continuity
across a course is non-negotiable**, and H3's image-to-video takes no
audio reference. So `locked` is the default — every shot reference-to-
video with the voice as Audio 1, joins inside a scene are matched cuts —
and `chain` is the opt-in for a seamless frame chain on voiceover shots
that carry nothing else, at the price of the voice drifting on those
shots. The manager takes `--continuity`, templated into SKILL.md like
`--resolution`. The figure budget is unchanged: `4 − 1 (frame) −
characters`.

**D5 — Character sheet for on-camera courses, `locked` only.** Revised
after E3. When `continuity` is `locked` and the style's narration is
on-camera or the learner supplied reference images, the kit step
generates two more angles of the host from the sample's first frame
(GPT-Image-2 edit: same person, outfit and set; three-quarter view;
medium close-up) into `style/character-{1,2}.png` and appends them to
`refImages`. In `chain`, a speaker on screen is still always a
reference-to-video shot with the voice — the anchor still shows the host
and holds the face (E3) — and the figure budget stays at three.

**D6 — Seam fades in the scene concat.** 30 ms audio fade-in/out at every
join (the shots already end on sentence boundaries); the video stays
stream-copied when the shapes are uniform.

**D7 — Recipes rewritten to five elements.** Kind, 16:9 frame, concrete
palette (named colors, hex where useful), material/texture, light — one
sentence each, no abstract adjectives ("cinematic" alone is banned).
The style board copy is unchanged.

**D8 — Documentation.** `references/h3-best-practices.md` (the living
document — how to update it is written in it), `generation.md` points to
it, SKILL.md gains the `continuity` param and the voice/character
facts, `.claude/rules/modes.md` gets the lesson.

## Experiments

**E1 — voice reference is accepted and cheap (done 2026-09-04).** Same 7 s
shot, math-anim, four variants at 480P: A r2v anchor only 14.4 s;
B r2v anchor + `reference_audio` (sample's narration) 18.4 s; C i2v from
the anchor 27.8 s; D r2v + audio + timed beats 18.7 s. Narration verbatim
in all four (C had one homophone). MFCC-mean cosine similarity to the
sample voice: A 0.975, B 0.996, C 0.994, D 0.997 — a weak proxy; the
user's ear decides. Frames: A pushed in hard; B and D stayed on the
anchor's set and D's "amber gap lights up at 3 s" landed on time; C's first
frame was the anchor itself (podium and hourglass) before a jump.

**E2 — chain vs locked inside a scene (done 2026-09-04).** The scene's
second shot from the same last frame, 480P: image-to-video 10.3 s;
reference-to-video with the frame as Image 1 + the voice 17.4 s.
Narration verbatim in both. Frames: the image-to-video clip's first frame
IS the previous last frame and the picture evolves inside that
composition; the reference-to-video clip starts near it and reframes
(curve shape and camera drift) — a matched cut, not a continuation.
Voice proxy identical (0.994 / 0.994). Decision: keep the frame chain as
the default (`chain`), put the voice on every reference shot, offer
`locked` for courses where one narrator on every shot outranks the join.

**E3 — character sheet (done 2026-09-04).** `teacher` style, sample
(anchor 36 s + clip 16 s), then the real manager on a two-shot scene:
the kit made the voice at once and the two-angle sheet in 77 s; both
shots reference-to-video with anchor + sheet + voice, narration
similarity 1.0, concat 16.02 s. Control: the same two shots with the
anchor + voice only. Frames at 1 s and 6 s of each shot: the same
instructor, outfit and set in all eight frames, with and without the
sheet — the anchor still of an on-camera style already shows the host,
and reference-to-video on it holds the face. The sheet bought nothing
visible here and costs 77 s once plus two of the four reference slots on
every shot (figures down to one). Decision: the sheet is `locked` only;
in `chain` a speaker on screen is still always a reference shot with the
voice (their voice must not change mid-take). Both runs drew a small
arrow-curve on the board that the prompt placed "in the air" — the model
put the gesture on the board; harmless, noted.

**E4 — the course re-shot with the practice, for the showcase (done
2026-09-04).** n3, n4 and n3d at 768P through the real manager: ten
shots in 2 min 50 s on three slots, one narration re-shoot, every shot
passing. Stills against the 0.4 shoot: not better — one figure shot
pasted the figure flat on an empty background, another invented axis
numbers, and every figure shot kept the previous shot's curves under the
figure. A three-way A/B of one figure shot (as shot / the blunt "nothing
the prompt did not describe" negative removed + "drawn in the scene's own
materials, filling the frame" / the 0.4 prompt) came out near-identical:
seed variance outweighs the wording. Decisions: the blunt negative is
gone (wrong in principle); the showcase images stay as they are (the
practice's gains — voice, camera, beats, seams — are not visible in a
still); open question: a writer's beat that clears the board before a
figure draws itself.

**E5 — four references at once (to run).** frame + 2 characters + 1
figure + voice: latency and whether the figure still reproduces.

## Out of scope

Multi-cut shots, MiniMax-platform-only features (2K regeneration,
Context-IR), music.

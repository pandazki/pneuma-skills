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

**D4 — `continuity` init param: `locked` (default) | `fast`.**
`locked`: every shot is reference-to-video — Image 1 the previous shot's
last frame (the style anchor for a scene opening), then the character
sheet, then the shot's figures, Audio 1 the voice. `fast`: today's chain
(image-to-video inside a scene, no voice reference, reference-to-video
only when a figure or character rides along) — cheaper per shot, the
voice may drift. The manager takes `--continuity`, templated into
SKILL.md like `--resolution`. Reference budget in `locked` is
`4 − 1 (frame) − characters` for figures; the screenplay validator already
caps by that number.

**D5 — Character sheet for on-camera courses.** In `locked` mode, when the
style's narration is on-camera or the learner supplied reference images,
the kit step generates two more angles of the host from the sample's
first frame (GPT-Image-2 edit: same person, outfit and set; three-quarter
view; medium close-up) into `style/character-{1,2}.png` and appends them
to `refImages`. Every shot then carries the same face. Experiment E3
decides the exact prompt and whether two angles or one suffice.

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

**E2 — locked vs fast continuity inside a scene (to run).** Shot k+1 from
the same last frame: i2v vs r2v(frame + voice). Judge the seam and the
voice.

**E3 — character sheet (to run).** `teacher` style: sample → two angles →
two shots with and without the sheet; compare the face across shots.

**E4 — four references at once (to run).** frame + 2 characters + 1
figure + voice: latency and whether the figure still reproduces.

## Out of scope

Multi-cut shots, MiniMax-platform-only features (2K regeneration,
Context-IR), music.

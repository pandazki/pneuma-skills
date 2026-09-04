# H3 best practices — what the scripts do for you, and why

This is the living record of how plotwise talks to MiniMax H3 (fal's H3
Max). **The practice is implemented in `scripts/h3-prompt.mjs`
(the prompt) and `scripts/play-manager.mjs` (the references and the
continuity kit); this file is its reasoning.** Nothing here is for you to
type into a prompt — if a rule should change, change it in the script,
record why here, and bump `H3_PRACTICES_VERSION`. Every shot records the
version it was shot under (`shots[].h3Practices`), so a course can be
read against the practice of its day.

Sources: [God-minmax-H3](https://github.com/LIUFelix2004/God-minmax-H3)
(MIT — five prompts validated on H3, a prompt grammar and a stitching
guide; the user confirmed the difference by hand), fal's H3 Max API
schema, MiniMax's published prompt spec, and our measurements
(2026-09-01 smoke, 2026-09-03 blind trials, 2026-09-04 A/B).

## The prompt (`h3-prompt.mjs`)

fal's H3 Max expander rewrites toward three labeled sections —
`integrated_multimodal_description`, `overall_soundscape`,
`non_diegetic_music` — so that is the frame. Inside the description the
order is the one that H3 weights: **style anchor → bindings → continuity
→ picture as a timeline → figure → narration → negatives.**

1. **Style anchor first, verbatim, every shot.** The model has no memory
   across shots; "as before" is nothing. Every recipe in `styles.md`
   names five things — kind of picture, 16:9 frame, concrete colors
   (named, hex where useful), material/texture, light — because an
   anchor missing one of them is filled in by the model differently each
   time. "High contrast" is not a color; "deep navy (#0b1a3a) and warm
   amber (#f5a623)" is.
2. **Bindings are injected at shoot time.** `Image 1 is …`, `Audio 1 is
   …` are written by the manager from what the shot actually binds
   (`segment-lib::planRefs`), never by the writer — a writer guessing
   numbers guesses wrong.
3. **The picture is a timeline inside one take.** `beats[]` —
   `{from, to, action, camera}` in seconds — give the model its time
   allocation, and each beat carries a camera move written as motion +
   amplitude + speed. **No camera means a dead static shot** (the
   community's most common failure); a beat without one gets
   `DEFAULT_CAMERA`. Still ONE continuous take: cuts inside a shot fight
   the frame chain, so the multi-cut trick the community uses for
   trailers is deliberately not used for teaching.
4. **Figures are references it reproduces**, never keyframes — one
   sentence per figure, "every label, axis and number unaltered".
5. **Narration verbatim in the tagged clause** — `<d>[Chinese] …</d>`,
   voiceover or on-camera speaker (S1).
6. **Negatives close every prompt**: no text the prompt did not spell,
   no garbled glyphs, no dissolves/morphs/cuts, no shake, nothing not
   described; and when the style has people: no extra fingers or limbs,
   no deformed hands or faces, one speaker, lips in sync.
7. **Sound in three layers.** The voice is the narration; the writer's
   `sound` line carries the ambience and the action effects with the
   moment they land ("a soft chalk tap when the second curve appears at
   3s"). Music is never requested (`N/A`) — unspecified music is the
   documented cause of random tracks.

## The references (`play-manager.mjs`)

Reference material governs *who and what*; the prompt governs *what
happens*. fal analyses at most four images per shot (`MAX_REFS`), plus
audio, twelve files in all.

- **Image 1** is the continuity frame — the previous shot's last frame
  inside a scene, the style anchor for a scene opening.
- **Characters** ride next: the learner's references, and in `locked`
  mode the **character sheet** the kit draws for a speaker on screen (two
  more angles from the sample's first frame). Given to *every* shot
  including the first — a face the first shot invented cannot be caught
  up with later. Measured 2026-09-04 (teacher style): the anchor still of
  an on-camera style already shows the host, and reference-to-video on it
  kept the same face across shots with or without the sheet — so `chain`
  skips the sheet (77 s once, two of the four slots on every shot) and
  simply keeps every shot of a speaking host a reference shot with the
  voice.
- **Figures** take what is left; the screenplay validator caps by the
  same budget (`figureBudget`), and the manager fails a shot over it
  rather than drop one silently.
- **Audio 1 is the voice.** The confirmed sample's narration
  (`style/voice.mp3`) rides on every reference-to-video shot, so the
  narrator keeps one voice across shots and scenes. Without it the model
  picks a voice per shot.

`--continuity chain` (default): inside a scene a voiceover shot with no
figure and no character is image-to-video from the previous last frame —
the frame IS the first frame, the join is seamless (measured:
reference-to-video given the same frame reframes it; a matched cut, not a
continuation, and 7 s slower) — and every reference-to-video shot
(openings, figures, characters, any shot with a speaker on screen)
carries the voice. `locked`: every shot reference-to-video with the
voice, plus the character sheet for a speaker — one narrator and one face
guaranteed on every shot, looser joins.

## Seams

Shots end on sentence boundaries (the writer's unit is what is spoken in
the shot), which is where the community puts its cuts too. The scene
concat fades 30 ms of audio in and out at every join — a waveform
discontinuity clicks, and the shots are already loudness-matched.

## Measured

- 2026-09-04, math-anim, 7 s shot, 480P, same narration: reference-to-
  video 14.4 s; with the voice reference 18.4 s; with voice + timed beats
  18.7 s; image-to-video from the anchor 27.8 s. Narration verbatim in
  all. Frames: the beat "the amber gap lights up at 3 s" landed on time.
- 2026-09-04, same course, the scene's second shot from the same last
  frame: image-to-video 10.3 s and the first frame is that frame, the
  picture evolving in place; reference-to-video with the frame as Image 1
  plus the voice 17.4 s, starting near the frame and reframing. Voice
  proxy identical. Hence `chain` as the default.
- 2026-09-04, the same course re-shot at 768P with this practice (n3,
  n4, n3d: ten shots, 2 min 50 s on three slots, one narration re-shoot,
  all passing). Stills side by side with the 0.4 shoot: **not better** —
  one figure shot came out as the figure pasted flat on an empty
  background, another invented axis numbers, and in every figure shot the
  previous shot's curves stayed on screen under the figure. A three-way
  A/B of one figure shot (prompt as shot / prompt with the blunt "nothing
  the prompt did not describe" negative removed and "drawn in the scene's
  own materials, filling the frame" added / the 0.4 prompt) came out
  near-identical: **seed-to-seed variance is larger than the wording
  difference**, so a two-scene comparison cannot rank prompts. The blunt
  negative was dropped anyway (it is wrong in principle — the anchor's set
  dressing is welcome). What the practice buys — one voice, a camera on
  every beat, timed beats, clean seams — is not visible in a still.
  Open: figure shots inherit the previous shot's content; a writer's beat
  that clears the board before the figure draws itself may be the fix.
- 2026-09-01 smoke: text-to-video 2 s wall, image-to-video 3 s,
  reference-to-video 19 s (reference analysis dominates) — the numbers
  fal's queue gives on a quiet night; the 2026-09-04 numbers are a busy
  afternoon.
- 2026-09-02: a figure pinned as a keyframe fills the screen with the
  raw bitmap and the next shot chains from it — the course became a
  slideshow. Figures are references only.
- 2026-09-03: at 480P the model reproduces structure and large labels;
  small text becomes plausible fake glyphs. Figures: ≤ 6 labels, each
  ≥ 1/20 of the image height.

## Not adopted, and why

- Bracket camera tags (`[推进]`) — the MiniMax-platform dialect; fal's
  expander is documented against natural-language camera.
- 8–12 cuts in one 15 s prompt — great for a trailer, wrong for a
  teaching take that must chain frame to frame.
- 768P → 2K regeneration, Context-IR — MiniMax platform only.

## How to update this practice

1. Change the rule in `h3-prompt.mjs` (prompt) or `play-manager.mjs`
   (references / kit / concat) and bump `H3_PRACTICES_VERSION`.
2. Shoot the same shot before and after (the A/B runner from 2026-09-04
   is the model: one shot, one variable, four variants, transcribe each,
   frames at 0.5 / 3.5 / 6.5 s) and record the numbers under *Measured*.
3. Update the tests in `__tests__/h3-prompt.test.ts` — they pin the
   shape, so a change is a deliberate one.

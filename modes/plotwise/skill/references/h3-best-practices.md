# H3 best practices — what the scripts do for you, and why

This is the living record of how plotwise talks to MiniMax H3 (fal's H3
Max). **The practice is implemented in `scripts/h3-prompt.mjs` (the
prompt), `scripts/screenplay-lib.mjs` (what the writer is asked for) and
`scripts/play-manager.mjs` (the references and the continuity kit); this
file is its reasoning.** Nothing here is for you to type into a prompt —
if a rule should change, change it in the script, record why here, and
bump `H3_PRACTICES_VERSION`. Every clip records the version it was shot
under (`clips[].h3Practices`), so a course can be read against the
practice of its day.

Sources: [God-minmax-H3](https://github.com/LIUFelix2004/God-minmax-H3)
(MIT — five prompts validated on H3, a prompt grammar and a stitching
guide), fal's H3 Max API schema, MiniMax's published prompt spec, and our
own measurements (2026-09-01 smoke, 2026-09-03 blind trials, 2026-09-04
reproduction and writer trial).

## What 0.6 changed, and what proved it

Until 0.6 a scene was a chain of one-take shots and every prompt opened
with "One continuous shot, no cuts". The courses came out as talking
illustrations. Four measurements on 2026-09-04 settled why:

1. **The model is not the ceiling.** The community's published 15-second
   prompts, sent to fal's H3 Max unchanged, come back at their published
   quality — at **480P with `--expansion balanced`, in about 10 seconds**.
   Three settings were tried; the cheapest one reproduced the reference.
2. **A voiceover does not break a montage** (X1). A `<d>` narration line
   added to such a prompt is spoken verbatim and the cutting survives.
3. **A lesson written in that grammar reaches the same level** (X2):
   coins, a staircase, a snowball, one two-word title card — narration
   verbatim.
4. **Our writer can write it** (W1). Given a director's brief — the
   visual device first, then a time-coded shot list with a bracketed
   camera per cut, the narration split across the cuts, three-layer
   audio, style-specific negatives — Luna returned, for three different
   styles, a fitting device and 8-9 cuts per 15 seconds inside the speech
   budget. Shot as plain text-to-video at 768P, with no anchor and no
   references: the device carries through every cut, no invented text,
   narration verbatim. A different league from the 0.5 pipeline's output.
   That brief is the seed of today's `SCREENPLAY_SYSTEM`.

So the final-video practice is copied from the community as it stands.
What we build well is upstream: the content plan (what carries each idea
visually), the writing (a shot list a director would sign), and the style
anchor (art direction that fits the topic).

## The prompt: four blocks (`h3-prompt.mjs::buildClipPrompt`)

One clip, plain text, in this order — the community's form, which fal's
expander then rewrites into H3's own `[Shot N]` / `overall_soundscape`
sections. **`--expansion balanced` is therefore not optional**; the
expander is doing that translation.

```
1. Style anchor: <recipe verbatim>
Subject: <what this clip is about>

Reference material: Image 1 is …  Audio 1 is …          ← injected at the shoot

2. Shot list — 6 cuts in 15s, cut on the times given:
0-2s Cut 1: <subject + action + setting>. [camera]
…

3. Narration — off-screen voiceover; no one on screen opens their mouth:
0-3s <d>[Chinese]…</d>

4. Audio: <ambience + effects with their moments> Nothing louder than the voice, and no music.

5. Do not show: <standing negatives> <the style's own>
```

1. **Style anchor first, verbatim, every clip.** The model has no memory
   across clips; "as before" is nothing. Every recipe in `styles.md`
   names kind, frame, palette (with hex and a rule), material, light and
   camera behaviour, because an anchor missing one of them is filled in
   differently each time. "High contrast" is not a colour; "deep navy
   (#0b1a3a) and warm amber (#f5a623)" is.
2. **The shot list is time-coded and it cuts.** 3-9 cuts in 15 seconds,
   4-8 being the zone the published prompts live in. Each cut is one
   sentence — subject + action + setting — and carries **its own camera
   move in brackets**. A cut with no camera is a dead frame, so
   `normalizeCuts` fills one in and says it did.
3. **The narration is distributed, and it fills the clip at speaking
   pace.** One `<d>` line per moment where the picture changes, each with
   the span it is spoken over — and the total sized to the clip:
   **60-85 Chinese characters for 15 seconds**, about 4.5-5.5 a second.
   Both edges are real (measured 2026-09-04, below): under about 50
   characters H3 pads the unspoken seconds by repeating a line or
   inventing speech; over about 100 it cannot fit the words and swallows
   a stretch. The validator reports a clip outside the band
   (`SPARSE_FLOOR`, `DENSE_CEILING`, and the hard cap
   `SPEECH_OVERRUN`), and the writer is asked once more with those
   problems as revision notes before anything is shot — the one place in
   this pipeline where a model is re-asked, because a clip outside the
   band fails its transcript gate more often than not and each failure
   costs two renders. The prompt's narration block also ends with "these
   are the only words spoken", which helps at the margin but does not
   rescue a sparse clip.
4. **Bindings are injected at the shoot,** never written by the writer:
   `insertReferenceBlock` puts `Image 1 is …` / `Audio 1 is …` between
   block 1 and block 2, numbered from what that clip actually binds
   (`planRefs` + `bindingLines`). A writer guessing numbers guesses wrong.
5. **A figure is content to reproduce, not a picture to paste.** Its cut
   names it, and the binding says which cut it appears in, "drawn in the
   scene's own materials and filling the frame, every label, axis and
   number unaltered".
6. **Audio is two layers under the voice**, with the moments they land,
   and music is never requested. Unspecified music is the documented
   cause of random tracks.
7. **Negatives close the prompt**: no text the prompt did not spell, no
   invented glyphs, no dissolves or morphs, no shake; for a style with
   people, no extra limbs, no deformed hands or faces, one speaker, lips
   in sync. Then the style's own ("no metal coins, no neon, no plastic"
   for papercraft).
   Two clauses are deliberately **absent**: "hard cuts" (a montage is
   cuts) and "nothing the prompt did not describe" — with a figure on
   screen that one made the model paste the figure flat on an empty
   background (2026-09-04).

**Language.** The content — cuts, narration, audio, negatives — is
written in the **course's language**; the structural labels this module
emits, and the style recipe it quotes, are **English**. That is exactly
the mix W1 validated (an English style anchor inside an otherwise Chinese
shot list), and it keeps the repository's source in one language. The
narration is always verbatim in its own language inside `<d>`.

## The references (`play-manager.mjs`)

Reference material governs *who and what*; the prompt governs *what
happens*. fal analyses at most four images per clip (`MAX_REFS`), plus
audio, twelve files in all. **Every clip gets the same shape** — that is
where continuity comes from now:

- **Image 1 is the style anchor**, a composed key frame of the topic's
  device in the course's style (`make-style-sample.mjs`). It is a look
  reference, not a picture to show.
- **Characters ride next**: the learner's references, and for a speaker
  on screen the **character sheet** the kit draws once (two more angles
  from the sample's first frame). Given to *every* clip, including the
  first — a face the first clip invented cannot be caught up with later.
- **Figures take what is left**, in the order of the cuts that show them;
  the screenplay validator caps by the same budget (`figureBudget`) and
  the manager fails a clip over it rather than drop one silently.
- **Audio 1 is the voice.** The confirmed sample's narration
  (`style/voice.mp3`) rides on every clip, so the narrator keeps one
  voice across a whole course. Without it the model picks a voice per
  clip. The user set this as non-negotiable (2026-09-04).

**The frame chain is retired.** Image-to-video from the previous shot's
last frame was a true continuation, and it bought two things we now
refuse to pay for: no voice reference on those shots (H3's
image-to-video takes no audio reference), and no cuts inside a shot. A
scene is 1-3 clips joined by matched cuts, which is where the community
puts its cuts too. `--continuity` is accepted and ignored, because a
session resumed with the 0.5 skill text still passes it and dying on an
unknown flag would leave the learner waiting for a manager that never
started.

## Seams

Clips end on sentence boundaries. The scene concat fades 30 ms of audio
in and out at every join — a waveform discontinuity clicks, and the clips
are already loudness-matched. The concat verifies that the joined file is
as long as its parts (a stream-copy join of mixed sample rates once
produced 141 s from 47 s of clips, and the demuxer does not check).

## Measured

- **2026-09-04, the reproduction.** A community 15-second multi-cut
  montage prompt, unchanged: 480P + balanced ≈ 10 s wall and matches the
  published reference; higher settings cost more and did not read better.
  X1 (same prompt + one `<d>` line): montage intact, narration verbatim.
  X2 (a compound-interest lesson written in the same grammar): same
  level.
- **2026-09-04, W1.** Compound interest, three styles (flat-vector,
  papercraft, clean-3d), Luna under the director's brief: a fitting
  device each, 8-9 cuts per 15 s, five narration lines inside budget,
  style-tuned negatives. Shot text-to-video at 768P, 24-36 s each.
  Bracket camera tags survived the expander as proper camera moves.
- **2026-09-04, narration density — the live e2e of 0.6.** A two-beat
  compound-interest course, papercraft, 480P, every clip
  reference-to-video with the anchor and the voice. First-shoot results
  by characters spoken in a 15 s clip:

  | characters | clean on the first take |
  |---|---|
  | 44-45 | 1 of 4 — transcript 30-60% LONGER, a line spoken twice or gibberish spliced between the lines |
  | 50-56 | 2 of 2 |
  | 84-89 | 4 of 6 |
  | 118 | 0 of 2 — transcript SHORTER, a swallowed stretch |

  On the 44-character clip, three takes each of two hypotheses: with the
  per-line time spans stripped from the prompt, 2 of 3 clean — **the
  spans are not the cause**; without the voice reference, 0 of 3, every
  take repeating a line — **the voice is not the cause, and it helps**.
  So the failure is the ratio of words to seconds, at both ends, and the
  fix is the band plus one revision ask. The W1 trial spoke 40 characters
  over 15 s cleanly, but as text-to-video at 768P with no references —
  not the production path.
- **2026-09-04, the ceiling check.** A GPT-Image-2 key frame as Image 1
  with the voice (reference-to-video) is about as good as
  image-to-video from that same frame — so the anchor does its work as a
  reference, and per-cut storyboards are not needed. Kept as a later
  option, not part of 0.6.
- **2026-09-04, the 0.5 re-shoot that did not work.** The same course
  re-shot at 768P under the 0.5 practice (ten shots, one narration
  re-shoot, all passing) was **not better** than the 0.4 shoot: a figure
  pasted flat, invented axis numbers, the previous shot's curves left
  under the figure. A three-way A/B of one shot came out near-identical —
  **seed-to-seed variance is larger than prompt wording** on a single
  shot, so a two-scene comparison cannot rank prompts. This is the
  measurement that sent us upstream instead of on to a fourth wording.
- 2026-09-04, timings on a busy afternoon (math-anim, 7 s shot, 480P):
  reference-to-video 14.4 s; with the voice reference 18.4 s; with voice
  + timed beats 18.7 s; image-to-video from the anchor 27.8 s.
- 2026-09-04, the character sheet: on an on-camera style the anchor
  already shows the host and reference-to-video kept the same face with
  or without the sheet. So the sheet is drawn only for a course that has
  a person to keep (77 s once, two of four slots on every clip).
- 2026-09-01 smoke: text-to-video 2 s wall, image-to-video 3 s,
  reference-to-video 19 s (reference analysis dominates) — a quiet night.
- 2026-09-02: a figure pinned as a keyframe fills the screen with the raw
  bitmap and the next shot chains from it — the course became a
  slideshow. Figures are references only.
- 2026-09-03: at 480P the model reproduces structure and large labels;
  small text becomes plausible fake glyphs. Figures: ≤ 6 labels, each
  ≥ 1/20 of the image height.
- 2026-09-04, voice: the objective proxy (MFCC-mean cosine) barely
  separates a matched voice from an unmatched one (0.996 vs 0.975).
  Whether the timbre is locked is judged by ear, so a voice experiment
  leaves the clips for a person to listen to.

## Not adopted, and why

- **768P → 2K regeneration, Context-IR** — MiniMax platform only, not on
  fal.
- **Per-cut storyboards** — with 4-8 cuts per clip that is too many
  images for the time budget; the anchor already lifts composition.

Adopted since 0.5, having been listed here as rejected: **bracket camera
tags** (`[缓慢推进]`) and **multi-cut prompts**. Both were rejected on the
theory that the frame chain needed one continuous take. The chain is
gone, and both are now the practice.

## How to update this practice

1. Change the rule in `h3-prompt.mjs` (prompt), `screenplay-lib.mjs`
   (what the writer is asked for) or `play-manager.mjs` (references, kit,
   concat), and bump `H3_PRACTICES_VERSION`.
2. Shoot the same clip before and after — one clip, one variable, a
   handful of variants, transcribe each, pull frames across the timeline
   — and record the numbers under *Measured*. Remember what the 0.5
   re-shoot proved: on a single clip, seed variance beats wording, so a
   difference has to survive more than one pair.
3. Update `__tests__/h3-prompt.test.ts` — it pins the shape, so a change
   is a deliberate one.

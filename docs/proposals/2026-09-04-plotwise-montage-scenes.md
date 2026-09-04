# Plotwise 0.6 — a scene is a montage, and the work moves upstream

**Status:** design, 2026-09-04 (supersedes the shot-chain half of
`2026-09-04-plotwise-h3-best-practices.md`; keeps its plumbing)
**Decided by:** the user, after the FINAL BET reproduction (this day).

## What the reproduction proved

- fal's H3 Max reproduces the community's validated 15-second montage
  prompts at their published quality — at 480P + balanced expansion in 10
  seconds. The model and the resolution are not our ceiling.
- A voiceover line inside such a prompt does not break the montage, and
  is spoken verbatim (X1). A lesson written in that grammar — coins,
  staircase, snowball, a title card — reaches the same level (X2), with
  the narration verbatim.
- Our courses look like "talking illustrations" because our pipeline
  forbids cuts ("One continuous shot"), gives the writer abstract
  concepts with no visual device, wraps a little content in a lot of
  scaffolding, and uses recipes written as safe educational looks rather
  than art direction.
- **The user's framing:** the final video practice can be copied from the
  community as it stands. What has to be built well is upstream — the
  content plan (what carries each idea visually), the writing (a shot
  list a director would sign), and the style anchor (art direction that
  fits the topic; the three-color casino look does not teach compound
  interest).

## Decisions

**D1 — The unit of production is a 15-second montage clip.** A scene
(one outline beat) is 1–3 clips of up to 15 s; inside a clip 4–8 cuts,
time-coded, each cut a composed picture with its own camera move; the
narration is distributed across the cuts inside `<d>` tags; cuts are
allowed and expected. The frame chain (image-to-video from the previous
last frame) is retired as the continuity mechanism; continuity is style
anchor + character sheet + voice reference on every clip, all
reference-to-video. A 40 s scene is therefore 3 clips, not 4–6 chained
shots — fewer calls, and every clip carries the voice.

**D2 — Content planning gains a visual layer.** `plan-course` writes,
per beat, a **visual device**: the concrete objects, metaphor or
character that carry the idea (coins → staircase → snowball for compound
growth), chosen to fit both the topic and the chosen style, plus the
recurring motifs of the course (a "visual bible": palette use, the one
running example's look, what is never drawn). Knowledge figures remain
code-rendered and enter named cuts as references — the device is for the
idea, the figure is for the fact. This is planning-time work, done once,
written into `course.json` beside the evidence.

**D3 — The writer becomes a director.** Luna's system prompt is rewritten
around the community's grammar: style anchor first (verbatim, every
clip), then a time-coded shot list — one line per cut: subject + action +
setting + camera — then the audio in three layers with the moments they
land, then the negatives. The narration is placed inside the cut where it
belongs. Prompts are written **in the course's language** (the validated
prompts are Chinese; H3 reads both), scaffolding is minimal, and
`h3-prompt.mjs` assembles the four blocks from Luna's structured output
rather than wrapping a `visual` in boilerplate. Validation: cuts ≤ 8 per
clip, times cover the clip, speech budget per clip, figures on disk, no
on-screen text beyond quoted words.

**D4 — The style board becomes art direction.** Every recipe is
rewritten as a director's brief the community would recognize — kind,
frame, palette named with intent ("three colors, no gradients"),
material, light, and its *graphic devices* (diagonal splits, halftone,
panel grids) — and each carries a sharper "teaches best / never for"
so the recommendation fits the topic. The anchor image is generated as a
**style key frame** in that brief (not "the set, ready but not in use")
and may be accompanied by a second anchor for the running example. The
sample clip is the first montage of the course's hook, shot in the new
grammar, so what the learner confirms is what they will get.

**D5 — The manager shoots clips, not shots.** `renderScene` iterates
clips; every clip is reference-to-video with Image 1 = the style anchor,
then the character sheet, then that clip's figures, Audio 1 = the voice;
QA transcribes the whole clip against its narration; the scene's clips
are concatenated with the seam fades. `continuity` collapses to one mode
(the voice always rides); the param is retired or kept as a no-op alias.
The viewer's shot model becomes a clip model (captions follow the cut's
narration segment).

**D6 — Storyboards stay optional.** The ceiling experiment showed a
GPT-Image-2 key frame as Image 1 lifts composition; with 4–8 cuts per
clip a per-cut board is too many. A per-clip key frame is a later
option (`boards`), not part of 0.6.

**D7 — Practice, recorded.** `references/h3-best-practices.md` is
rewritten around the four blocks and the montage; the FINAL BET
reproduction (three settings, X1, X2) is its evidence; the community's
prompts are cited as the grammar's source.

## Experiments that gate the build

- **W1 — can the writer write it? (done 2026-09-04: yes.)** Compound
  interest, three fitting styles (flat-vector, papercraft, clean-3d),
  Luna under a director's brief in Chinese: "first the visual device,
  then the four-block shot list — time codes, one line per cut with a
  bracketed camera, the narration split across the cuts in `<d>` tags,
  three-layer audio with its moments, style-specific negatives". She
  returned a fitting device for each style (a compounding coin-tree
  growing from a seed coin; self-replicating paper coins along a rising
  teal band; a mint mother ball spawning peach offspring up a ramp),
  8–9 cuts per 15 s, five narration lines inside the speech budget, and
  negatives tuned to the style ("no metal coins, no neon, no plastic" for
  papercraft). Shot as plain text-to-video at 768P (24–36 s each): the
  device carries through every cut, no invented text, narration verbatim
  (homophones only). This is a different league from the current
  pipeline's output — without an anchor, without references. The
  director-brief prompt used is the seed of the new `SCENE_SYSTEM`.
- **W2 — anchor as art direction.** The same clip with and without a
  style key frame as Image 1; and with the current "set, not in use"
  anchor. Which anchor makes the montage hold the look?
- **W3 — a whole scene as 2–3 clips.** Continuity across clips with
  anchor + voice only (no frame chain): does it read as one scene?

## Out of scope for 0.6

Multi-course visual bibles, learner-editable devices, 2K.

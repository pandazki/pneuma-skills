# Grounding — accuracy tiers, figures, evidence

The mode's premise is that a learner can trust every segment. That trust is
manufactured here, at planning time, and spent cheaply in the per-segment
loop. This file is the how.

## Accuracy tiers

Every outline beat gets a tier when the course is planned. The tier decides
how much verification the beat's segments need — and all of that
verification happens at PLANNING time, so the segment loop stays fast.

| Tier | When | What you do | Evidence written |
|---|---|---|---|
| `world-knowledge` | Uncontroversial, stable, textbook-level facts (a country's capital, what photosynthesis is) | Nothing beyond your own check | One `world-knowledge` ref with a note saying why no lookup was needed |
| `citation` | Specific, niche, recent, or contested facts (a company's history, a statistic, a quote) | Search the web; keep only claims you can pin to a source you'd show the user | `citation` refs with `url` + note per claim |
| `code-verification` | Anything derivable or checkable: math, algorithms, data claims, unit conversions | Write and RUN the code — derive the result, verify the identity, compute the table. Keep the code and its output | `code-verification` refs with `file` pointing at the script/output, plus `rendered-figure` refs for any visual |

Tier is per-beat, but a segment can escalate: if a "world-knowledge" beat's
segment ends up wanting a plot, that plot is a rendered figure regardless
of the beat's tier.

## The visual layer — the other half of a plan

The tier decides what a beat may CLAIM. The visual layer decides what it
SHOWS, and it is settled at the same time, in the same file, for the same
reason: the play loop cannot invent either one.

**Per beat, a `device`.** One or two sentences in the course language
naming the concrete objects, metaphor or character that carry that beat's
idea — what a camera could film. Compound interest: *"a coin that buds a
second coin, then both bud again, and the pile climbs one step higher each
time"*. Not *"the exponential effect of interest earning interest"* — that
is the concept a second time, and a writer given it answers with a
narrator in front of a pretty background.

Three rules make a device usable:

1. **Style-agnostic.** No palette, material, lighting or camera words. The
   learner confirms the style separately on the board, and the writer
   translates the device into that style's own materials — paper coins for
   papercraft, chalk coins for a chalkboard. "Flat vector coins in coral,
   seen top-down" pre-empts a decision that is not the plan's, and is
   simply wrong once the learner picks something else.
2. **Filmable and concrete.** Objects, an action, a change. If you cannot
   say what moves in the first two seconds, it is not a device yet.
3. **It composes with its neighbours.** One running example carries the
   whole course: beat 3's device grows out of beat 2's (the coins pile
   into a staircase; the staircase feeds a snowball). A new world per beat
   reads as a new course per beat. Only the plan sees the whole course,
   which is exactly why the writer cannot be asked to do this.

**Per course, a visual bible** — `course.visual` (written in the course's
language; shown here in English):

```json
{ "bible": "The whole course happens on one sheet of paper seen from above. Every quantity is made of paper, and more of it means a taller pile; the running example is a single coin that keeps budding.",
  "motifs": ["the coin that buds", "the pile that climbs", "the crease across the sheet"],
  "neverDraw": ["a formula with no rendered figure behind it", "floating text", "gradients", "real metal coins"] }
```

- `bible` — one paragraph: where the course happens, how the running
  example is drawn, what recurs from beat to beat, what tells the audience
  they are still inside the same course.
- `motifs` — 2–5 things a viewer would notice a second time.
- `neverDraw` — what this course never draws, whatever the topic invites
  and this pipeline cannot deliver. Almost always: a formula or a labelled
  axis with no rendered figure behind it (the video model writes
  plausible-looking wrong glyphs), floating text, gradients. Add what your
  own topic tempts — for money, real metal coins and brand logos.
  Style-agnostic like the rest; the writer turns these into the clip's
  negative constraints.

**The device is for the idea, the figure is for the fact.** A device
carries what a beat MEANS and needs no evidence; a rendered figure carries
what must be exact on screen and needs all of it (below). Most beats want
only a device — a beat that reaches for a figure to say something a coin
could have said pays 19 s of reference analysis for a worse picture.

Both are written by `course-edit.mjs outline --set <set> --file
outline.json`, where the file is `{ "beats": [ … "device": "…" … ],
"visual": { "bible", "motifs", "neverDraw" } }`. The op merges: a re-land
that omits the visual layer keeps what is on file (an older planner must
not erase the direction of a course already shooting), a `visual` of the
wrong shape is refused rather than dropped, and its JSON result reports
`devices` and `visual` so a land is verifiable in one read.
`course-edit.mjs audit` names a beat with no device in that beat's
`problems` and a course with no bible in the report's top-level
`problems`; both are planning holes to fill before `write-screenplay.mjs`
runs.

Why it lives here at all (2026-09-04): our courses looked like talking
illustrations partly because the writer was handed abstract concepts with
nothing concrete to film. Under a director's brief that started from a
device — "self-replicating paper coins climbing a rising band" — the same
model, the same topic and the same style returned montages of a
completely different league, with the device carrying through every cut.

## Rendering knowledge figures

Shape first: one idea per figure, few large labels, and a screen-like
frame — 16:9 or 4:3. fal's reference upload rejects any image wider than
2.5:1 or taller than 1:2.5 (`image_aspect_ratio_error`; a 2.78:1
three-panel matplotlib strip failed three scenes on 2026-09-03). The
generator letterboxes an out-of-range figure onto a white canvas rather
than fail, but the padding is wasted screen: split a strip into figures
instead. `course-edit.mjs audit` names every figure outside the range.

The only acceptable sources for a knowledge visual, in order of preference:

1. **Matplotlib (or any plotting library) via Python** — plots, coordinate
   systems, function graphs, data charts. Style the figure toward the
   course's visual style (background color, line color) so the video model
   can integrate it; correctness first, palette second.
2. **Hand-authored SVG** — geometric diagrams, labeled figures, anything
   you can state exactly. Convert to PNG for the shoot when needed
   (fal accepts PNG/JPEG references; keep the SVG as the canonical
   evidence file).
3. **Computed tables rendered to an image** — when the knowledge IS the
   numbers.

Never `generate_image.mjs` for knowledge figures — an image model
hallucinates axis labels exactly like a video model. Generated images are
allowed only for decorative material (a backdrop, a character portrait),
and even then prefer the style recipe to carry decoration.

A figure reaches the shoot only as a REFERENCE (reference-to-video, Image
2+ — the prompt says "the reference figure appears on the board,
faithfully reproduced, every label unaltered") and the model draws it
inside its own picture. Never as a first or last frame: a keyframe is
copied pixel for pixel, the raw bitmap fills the screen and the next shot
chains from it (a course turned into a slideshow that way, 2026-09-02).
The reference image outranks prompt wording: this is the mechanism that
keeps the model honest. Budget: fal analyses at most four references —
one is the continuity frame or the style anchor, one each for the
course's recurring characters, the rest for figures; a shot that needs
more is two shots.

When the learner reports a figure that came out wrong, look at the scene
(`capture`) against the rendered original before answering: a mangled
figure is a too-dense figure — simplify it under `evidence/<beatId>/`
(fewer, larger labels) and let them 再拍一次; it fails the scene exactly
like a misspoken fact fails QA.

## The outline is the evidence index

Planning ends by writing every beat's references INTO `course.json`:

```json
{ "id": "b3", "title": "概念脊柱:Connector → Source → Capability",
  "summary": "...", "tier": "citation",
  "evidence": [
    { "kind": "rendered-figure", "file": "evidence/b3/spine.png",
      "note": "三层脊柱示意,代码渲染,标签与官方概念页一致" },
    { "kind": "citation", "url": "https://plexus.vibecoding.icu/concepts/",
      "note": "官方概念页第 1 节的三层定义" },
    { "kind": "code-verification", "file": "evidence/b3/check.py",
      "note": "对照仓库源码确认 capability id 的点分构成" }
  ] }
```

`write-screenplay.mjs` reads this list (plus whatever sits in
`evidence/<beatId>/` and `evidence/<nodeId>/` — figures, a `sources.json`
of `[{url, note}]`, an `evidence.json`) and offers it to the writer by
path; a shot's `figures[]` must name files from it, and validation drops
any other figure and reports it. The manager binds the same list at
shoot time. Consequences worth internalizing:

- A figure that exists on disk but is listed nowhere is invisible to the
  course. List it.
- The same beat entry carries its `device`, and the course carries its
  `visual` bible ("The visual layer", above) — one file, one command, one
  lock. A beat with evidence but no device is only half planned, and the
  audit says so.
- Figures must be raster (PNG/JPG) to be shot — render SVG to PNG beside
  it at planning time.
- **Nothing is rendered, searched or derived during play.** A gate failure
  is a planning defect: fix `evidence/<beatId>/` and the outline entry,
  then re-run the producer.
- Keep each figure to one idea with few labels. Measured 2026-09-02 at
  480P on H3 Max: structure and LARGE labels (a five-step sequence header,
  step names down the left edge) come through legibly; every line of
  small text turns into plausible-looking fake glyphs. Design figures so
  that what must be read is large — ≤ 6 labels, ≥ 1/20 of the image
  height — and put the detail in the narration. Replacing the clip's
  visuals with the still is not an option.

## evidence.json schema

`nodes/<id>/evidence.json` is a JSON array (or `{ "evidence": [...] }`).
The producer writes it from the beat's list (figures the prompt bound, plus
every citation / verification / world-knowledge ref):

```json
[
  { "kind": "rendered-figure", "file": "nodes/n3/figure-proof.svg",
    "note": "Area-rearrangement proof diagram, hand-authored SVG, checked against the derivation" },
  { "kind": "code-verification", "file": "evidence/b2/verify-345.py",
    "note": "Computed 3²+4²=5² and confirmed the general identity for the shown triples" },
  { "kind": "citation", "url": "https://...",
    "note": "Dates of the Zhoubi Suanjing reference to the gougu rule" },
  { "kind": "world-knowledge",
    "note": "Right-angle definition — textbook material, no lookup needed" }
]
```

Rules:

- `note` is user-facing (the evidence panel shows it) — one line, in the
  course language, saying what the evidence establishes.
- Files live in the workspace (`nodes/<id>/` for segment-local,
  `evidence/<beatId>/` for planning-time) so the panel and the hosted
  player can reach them.
- An empty evidence list is valid ONLY for pure-atmosphere segments (an
  opening mood shot, a transition). Any segment that teaches carries at
  least one ref.

## A learner's question

A mid-course question gets the same treatment at runtime — the user asked,
so they will tolerate the wait. Classify the question's tier, verify
accordingly, render any figure the answer needs under
`evidence/<sceneId>/` (the scene id is `q<n>`), THEN hand the scene to
the manager as a request file (SKILL.md, "A learner's question"). Say in
one line what you are doing ("checking sources...") so the wait reads as
diligence, not lag.

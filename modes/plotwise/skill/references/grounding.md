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

Feed figures to the shoot as `--ref-image` (reference-to-video — the
prompt says "the diagram from Image 1 appears on the blackboard,
faithfully reproduced") or as `--image` (image-to-video first frame — the
figure IS the opening shot and the camera moves from it). The reference
image outranks prompt wording: this is the mechanism that keeps the model
honest.

After the shoot, `capture` the segment and CHECK the figure on screen
against the rendered original. A mangled figure fails the segment exactly
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

## Side quests

A mid-course question gets the same treatment at runtime — the user asked,
so they will tolerate the wait. Classify the question's tier, verify
accordingly, render figures if the answer needs visuals, THEN shoot.
Announce what you are doing ("checking sources...") so the wait reads as
diligence, not lag.

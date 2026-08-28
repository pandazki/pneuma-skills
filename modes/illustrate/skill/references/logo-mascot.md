# Genre Playbook — Logos & Mascots

> Inspired by [ip-as-logo](https://github.com/s1dashu/ip-as-logo-skill) by **@s1dashu** (MIT).
> Synced against s1dashu/ip-as-logo-skill@acb834c (2026-08-22).
> Adapted for Illustrate's content-set / row workflow and its built-in generation scripts.

Read this playbook when the user asks for a logo, app icon, mascot, or brand identity —
especially an open-ended request like "make a logo for my product". The goal is a **logo
first and a character second**: reduce the subject to a compact symbol that stays
recognizable at 32 × 32. Do not produce a character illustration.

## Identity workflow

Simple, explicit generations stay confirmation-free (see Core Rules in SKILL.md). A
**multi-candidate identity batch** is different: directions are cheap to compare in text and
expensive to compare in wasted generations — so propose before you generate.

1. **Ground in context.** If the user named a subject ("a rounded ghost on navy"), keep it.
   Otherwise mine available product context before asking questions: in a project session
   read the project atlas and README; in a quick session use whatever the user has shared.
   Context is sufficient once you can infer the product's purpose, audience, and intended
   personality. If it is still thin, ask **one** consolidated round of questions (what the
   product does, who it serves, how it should feel) — never a second questionnaire.
2. **Propose three directions**, one compact line each:
   `<IP subject> — <product connection> — <defining silhouette>`
   - Subject specified → three distinct *treatments*: silhouette handling, secondary color
     region, defining feature, or personality emphasis.
   - Subject open → three genuinely different subjects or metaphors, each tied to a
     different product attribute or brand promise. Never three arbitrary animals with no
     rationale.
   End with a direct proposal to generate six independent candidates. Keep this phase short —
   no branding workshop unless the user asks for one. Do not generate until the user agrees,
   unless the request already explicitly authorized a batch.
3. **Interpret the answer exactly, and assign every candidate a corner.** The subject
   emerges from a corner (see composition); which corner is a decision you make up front, not
   something you leave to the model, so the batch tests both sides evenly.
   - All three directions accepted → two variants per direction, titled `A1 A2 B1 B2 C1 C2`.
     `A1 B1 C1` take the lower-left, `A2 B2 C2` the lower-right — every direction is seen
     once from each side.
   - One direction chosen → six controlled variants `A1`–`A6`, odd numbers lower-left and
     even numbers lower-right, each varying one further deliberate dimension (secondary color
     region, defining feature, expression, silhouette treatment).
   - Any other even batch splits evenly between the two corners. An odd batch gives its extra
     candidate to one side deliberately — and you say which side got it.
   - The user overrides quantity, directions, or distribution → follow their replacement
     without arguing for the default.
4. **One row per direction.** The row label carries the direction line (e.g.
   `Direction A — fox — swift search — one sweeping tail`); item titles carry the variant
   labels and their assigned corner (`A1 — lower-left, tail sweep`). Write ALL placeholder
   items with `"status": "generating"` before the first generation call.
5. **One candidate per call.** Every candidate is a separate full-resolution square asset
   with its own prompt — never ask the model to compose a contact sheet, grid, or multi-logo
   image. Calls may run concurrently for a six-candidate batch (see Batch Operations in
   SKILL.md), but manifest updates stay yours alone, serialized.
6. **Evaluate every output, then report honestly** — see the rubric at the end.
7. **Refinement** of a picked candidate is the normal edit workflow (`edit_image.mjs`, or the
   GPT-Image-2 URL + mask path): new row labeled after the change, original preserved.

## Complexity budget

- Build one dominant, continuous outer silhouette from roughly **6–10 basic geometric
  shapes**.
- At most **one species-defining feature**: one large pouch beak, one pair of curled horns,
  one broad visor — not all three.
- At most **two broad internal color regions**, matching the two IP base colors. Keep the
  face to two eyes and one mouth; omit eyebrows, highlights, nostrils, texture, and
  decorative marks unless essential.
- Do not explain the full anatomy, costume, machinery, or backstory. Do not prescribe a
  crop either — how tightly the subject is cut is the composition's business, below.
- Strip repeated feathers, scales, fur tufts, armor plates, buttons, screws, numbers, and
  labels.
- The black silhouette alone must read, and the mark must survive at **32 × 32**.

## Shape language & composition

- Thick, rounded, weighty contours and broad color masses.
- Forbid sharp corners, pointed ears or beaks, needle-like tails, thin antennae, thin
  smiles, narrow gaps, and acute flame or feather tips. Every necessary tip gets a visibly
  blunt, rounded end.
- Show **both** members of paired identifying features — ears, horns, wings, gills, bells.
- Let the subject emerge from its **assigned corner** — lower-left or lower-right — filling
  about **85–95%** of the canvas, so the mark stays visually dominant.
- Cropping at the bottom or the assigned side is welcome when it strengthens that sense of
  emerging from the corner, but do not prescribe an exact edge contact or a fixed crop — let
  the model find the framing. Cropping a paired identifier is still wrong.
- Never center the subject, float it with background all around, or sit it bottom-center
  unless the user explicitly asks for that.
- Keep the artwork upright. Never tilt or rotate the mark without an explicit request.

## Flat-first, barely-there depth

- Start from flat semantic shapes and a strong, simple silhouette. The first read must be a
  clean flat graphic mark.
- Ask for depth in **one sentence with no numbers** — the skeleton's "extremely, extremely
  subtle, almost imperceptible sense of depth through a barely-there neo-skeuomorphic
  treatment". Never expand it into a percentage, a gradient location, a direction, a span, or
  a highlight/shadow count. A number invites the model to hit it; the sentence keeps the
  restraint.
- Incidental gradients, soft shading, or mild dimensionality that come back inside the
  subject are acceptable — a property of the draw, not a defect to filter or retry.
- Keep the background visually flat and uniform. Depth lives inside the subject only — never
  as a background vignette, spotlight, or directional gradient.
- No external cast shadows, dramatic bevels, glossy hotspots, deep occlusion, extrusion, or
  photorealistic material. Reject clay, inflatable, plastic, plush, toy-like, or strongly
  three-dimensional results.

## Color & canvas

- Default to **exactly three semantic colors** in the complete artwork: two IP base colors
  plus one background color. Treat each IP color as a color *family* — tonal variation inside
  a family is still that one color and never counts as a fourth. Follow an explicit user
  request for a different count.
- Choose the two IP colors from product context, subject identity, and personality. Organize
  both into broad purposeful masses — reuse one for facial marks, keep the other in one
  continuous defining region. Never scatter the second color into decorative fragments.
- If the user supplies a background palette, reserve those colors for backgrounds unless
  they say otherwise; pick the two IP colors independently. Treat example palettes as
  inspiration, never as an allowlist.
- Unless the user asks for vivid color, mute the background a little — drop its saturation so
  it reads gently restrained while staying clearly chromatic and intentional, never gray or
  muddy. The subject carries the energy.
- If a requested background causes weak separation, adjust the subject colors first rather
  than replacing the requested background.
- Across a batch, vary the two-color strategies deliberately instead of repeating one
  neutral-heavy combination.
- Name the intended background color directly and ask it to fill the square — visible in
  every open area and in the corners the subject does not occupy (the assigned emergence
  corner is occupied by design). **Never write `opaque`, `alpha`, or `transparency` into a
  generation prompt**; image-mode vocabulary pushes these models toward cut-outs and matte
  edges instead of a painted field. If a generator still returns transparency, preserve and
  report it — never silently flatten or repair it in post-processing.
- Generate direct **1:1 squares** with normal square outer corners.

## Script settings (built-in models only)

- **Model: `gpt-image-2` — the default, and the right one here.** It holds crisp geometry,
  flat masses, and clean marks. `gemini-3-pro` (Gemini 3 Pro Image) is the only other model
  the scripts dispatch to, and it is a fine second choice; it drifts painterly, so pick it
  when the user asks or when only `OPENROUTER_API_KEY` is configured. Identity work is the
  last place to economize — never drop to a cheaper path than these two.
- **Never stand in for a generation.** No hand-written SVG, no code-drawn shape, no borrowed
  placeholder passed off as a candidate. If neither `FAL_KEY` nor `OPENROUTER_API_KEY` is
  configured, say exactly that and ask the user to add one — an unconfigured key is a
  reportable blocker, never a reason to fabricate a result.
- `--aspect-ratio 1:1` (maps to the `square_hd` preset). For a final render of a chosen
  candidate you may pin `--image-size 1536x1536`.
- **Never pass `--style`.** That flag rewrites the prompt before dispatch (e.g. `sketch`
  appends `, no shading, white background`), which fights both the solid backdrop and the
  barely-there depth this playbook asks for. The default (`photo`) leaves the prompt
  untouched.
- Constraints ride **inside the prompt** as the `Constraints:` line below. Both built-in
  models are modern instruction-following models; the scripts expose no negative-prompt
  parameter, so never try to invent one.
- `--quality high` for candidates the user will judge; drop to `medium` only for throwaway
  drafts.

## Prompt skeleton

Fill in `<subject>`, `<background>`, the assigned corner, and the color choices; keep the
section labels. Store the filled prompt verbatim in the manifest item.

**Never tell the generator what the image is for.** The words `logo`, `brand mark`,
`app icon`, and `icon asset` bias these models toward badges, frames, mask shapes, and flat
clip-art. Describe an image; the logo is what you and the user make of it afterwards. The
rule covers the generation prompt only — your conversation, the row labels, this playbook,
and the manifest metadata all keep the logo framing.

```text
Create one complete full-bleed 1:1 square image.
Background: fill the entire square with solid <background>. Keep <background> visible in every open area and in the corners the character does not occupy; the assigned emergence corner is occupied by the character.
Subject: place one highly simplified <subject> character on the background, reduced to one rounded continuous silhouette and one defining feature.
Complexity: use 6-10 broad basic shapes, at most two broad internal color regions, and a face with two eyes and one mouth. Keep the character readable at 32 x 32.
Color behavior: use exactly three semantic colors in the complete image: exactly two base character colors plus the background color. Organize both character colors into broad purposeful masses and reuse them for facial marks. Unless the user asks for vivid color, lower the background saturation slightly so it feels gently muted and restrained while staying clearly chromatic, clean, and intentional rather than gray or muddy. Keep the character, its facial marks, and the background clearly separated. Tonal variation within either character color stays inside that color and is not an additional semantic color.
Composition: keep the character upright and emerging from the assigned <lower-left or lower-right>, filling about 85-95% of the square so it stays visually dominant. Cropping at the bottom or the assigned side is welcome when it strengthens that corner emergence. Preserve both members of every paired identifying feature. Never center or bottom-center the character.
Style: use an ultra-clean flat graphic treatment with minimal broad masses, thick rounded contours, and one clear shape in place of several explanatory details. Add an extremely, extremely subtle, almost imperceptible sense of depth through a barely-there neo-skeuomorphic treatment.
Finish: show only the character on the full-canvas background, with clean geometric surfaces and normal square outer corners.
Constraints: Use no text or watermark. Add no borders, frames, cards, or presentation masks. Include one character only, with no extra subjects or scenery. Keep the contours thick and rounded, without fragile lines or sharp tips. Add no photorealistic material, dramatic bevel, glossy hotspot, deep occlusion, extrusion, strong three-dimensional rendering, or external cast shadow. Keep the background solid and uniform, with no texture, vignette, or lighting variation.
```

Every candidate keeps the corner it was assigned. Beyond that, change exactly one deliberate
dimension per candidate (secondary color region, defining feature, expression, silhouette
treatment) and note that dimension in the item title.

## Evaluate every candidate — and report it straight

After the batch lands, open each generated image file and inspect it against every rule
above. Give each candidate a verdict in your report, with the exact findings. Looking at your
own output is not optional here: the canvas shows the user every candidate anyway, so an
unlooked-at batch means only that you are the one person in the room who has not seen it.

Mark a candidate **non-recommended** when:

- it reads as an illustration rather than a symbol, exceeds the complexity budget, or fails
  at small size;
- without an explicit user override, it does not resolve to exactly two IP base colors plus
  one background, or the second IP color is scattered into decorative fragments;
- the palette reads gray, muddy, or washed out with no product reason, or a color supplied
  for background-only use appears painted on the subject;
- the subject, facial marks, and background lack clear separation;
- any contour is thin, sharp, spiky, or visually fragile;
- a paired identifier (ear, horn, wing, gill, bell) is missing or cropped;
- the mark is too small, centered, bottom-centered, tilted, framed, or surrounded by
  excessive empty space — or it emerges from the corner it was not assigned;
- the depth reads as a rendered object — volumetric, inflated, molded, or fully shaded —
  instead of an almost-flat mark;
- the background became a scene, texture, halo, vignette, or strong gradient instead of a
  solid field.

**What is not a failure:** incidental tonal variation inside one of the two color families,
mild dimensionality from the barely-there depth ask, and a transparent background are all
properties of the draw. Never mark a candidate down for them, and never repair them.

Upstream dropped this rubric in its 2026-08-20 rewrite (`d0c1ea8`) — it treats a batch as a
stochastic draw and forbids inspecting outputs at all, to stop an agent from silently
filtering its own results.
Illustrate solves that failure the other way: inspection stays, silent filtering is banned
below. Keep both halves; dropping either one is how the rule breaks.

**Result integrity:** keep and present every generated image — no silent filtering, no
scoring results out of view, no post-processing repair, no hidden retries. One targeted
re-generation is fine when a constraint clearly failed, but say so, and keep the failed
attempt in its row. Actual generation errors are reported as technical failures, not papered
over with a substitute.

## Manifest conventions for identity batches

- `style`: `"flat-logo"` on every candidate — keeps series grouping intact.
- `tags`: `["logo", "identity"]` plus a per-direction tag like `"direction-a"`.
- Item `title`: variant label + assigned corner + the varied dimension —
  `"A2 — fox, lower-right, tail sweep"`.
- Item `prompt`: the full filled skeleton, verbatim — reproducibility is the point.
- After the batch: drop a `rowId` locator per direction row, report each candidate's assigned
  corner alongside its verdict, then ask which candidate the user wants to refine.

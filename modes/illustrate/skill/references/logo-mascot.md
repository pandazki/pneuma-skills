# Genre Playbook — Logos & Mascots

> Inspired by [ip-as-logo](https://github.com/s1dashu/ip-as-logo-skill) by **@s1dashu** (MIT).
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
   - Subject specified → three distinct *treatments*: composition, silhouette handling,
     secondary color region, or personality emphasis.
   - Subject open → three genuinely different subjects or metaphors, each tied to a
     different product attribute or brand promise. Never three arbitrary animals with no
     rationale.
   End with a direct proposal to generate six independent candidates. Keep this phase short —
   no branding workshop unless the user asks for one. Do not generate until the user agrees,
   unless the request already explicitly authorized a batch.
3. **Interpret the answer exactly.**
   - All three directions accepted → two variants per direction, titled `A1 A2 B1 B2 C1 C2`.
   - One direction chosen → six controlled variants `A1`–`A6`, each varying one deliberate
     dimension (composition, secondary color region, expression, crop).
   - The user overrides quantity, directions, or distribution → follow their replacement
     without arguing for the default.
4. **One row per direction.** The row label carries the direction line (e.g.
   `Direction A — fox — swift search — one sweeping tail`); item titles carry the variant
   labels (`A1 — tail sweep left`). Write ALL placeholder items with `"status": "generating"`
   before the first generation call.
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
- Prefer a head or compact upper-body crop. Do not explain the full anatomy, costume,
  machinery, or backstory.
- Strip repeated feathers, scales, fur tufts, armor plates, buttons, screws, numbers, and
  labels.
- The black silhouette alone must read, and the mark must survive at **32 × 32**.

## Shape language & composition

- Thick, rounded, weighty contours and broad color masses.
- Forbid sharp corners, pointed ears or beaks, needle-like tails, thin antennae, thin
  smiles, narrow gaps, and acute flame or feather tips. Every necessary tip gets a visibly
  blunt, rounded end.
- Show **both** members of paired identifying features — ears, horns, wings, gills, bells.
- Let the subject emerge from the **lower-left or lower-right corner**, filling about
  **75–85%** of the canvas. Cropping at the bottom or side is intentional; cropping a paired
  identifier is not.
- Keep the artwork upright. Never tilt or rotate the mark without an explicit request.

## Flat-first, ultra-light modeling

- Start from flat semantic shapes and a strong, simple silhouette. The first read must be a
  clean flat graphic mark.
- Allow only **8–12%** extremely subtle internal tonal modeling inside the subject — barely
  neo-skeuomorphic, mostly flat. Let the model realize that restraint naturally; do not
  prescribe gradient locations, directions, spans, or highlight/shadow counts.
- Keep the background visually flat and uniform. Tonal modeling lives inside the subject
  only — never as a background vignette, spotlight, or directional gradient.
- No external cast shadows, dramatic bevels, glossy hotspots, deep occlusion, extrusion, or
  photorealistic material. Reject clay, inflatable, plastic, plush, toy-like, or strongly
  three-dimensional results.

## Color & canvas

- Default to **exactly three semantic colors** in the complete artwork: two IP base colors
  plus one background color. Tonal variants created by the allowed internal modeling stay
  inside their parent color's family and do not count. Follow an explicit user request for a
  different count.
- Choose the two IP colors from product context, subject identity, and personality. Organize
  both into broad purposeful masses — reuse one for facial marks, keep the other in one
  continuous defining region. Never scatter the second color into decorative fragments.
- If the user supplies a background palette, reserve those colors for backgrounds unless
  they say otherwise; pick the two IP colors independently. Treat example palettes as
  inspiration, never as an allowlist.
- If a requested background causes weak separation, adjust the subject colors first rather
  than replacing the requested background.
- Across a batch, vary the two-color strategies deliberately instead of repeating one
  neutral-heavy combination.
- Default to a fully opaque, edge-to-edge solid background, visible in all four square
  corners. A transparent result from the generator is an allowed variation — preserve and
  report it, never silently flatten or repair it in post-processing.
- Generate direct **1:1 squares** with normal square outer corners.

## Script settings (built-in models only)

- **Model: `gpt-image-2` — the default, and the right one here.** It holds crisp geometry,
  flat masses, and clean marks. `gemini-3-pro` drifts painterly; pick it only if the user
  asks for it or only `OPENROUTER_API_KEY` is configured.
- `--aspect-ratio 1:1` (maps to the `square_hd` preset). For a final render of a chosen
  candidate you may pin `--image-size 1536x1536`.
- **Never pass `--style`.** That flag rewrites the prompt before dispatch (e.g. `sketch`
  appends `, no shading, white background`), which fights both the solid backdrop and the
  8–12% modeling this playbook prescribes. The default (`photo`) leaves the prompt untouched.
- Constraints ride **inside the prompt** as the `Constraints:` line below. Both built-in
  models are modern instruction-following models; the scripts expose no negative-prompt
  parameter, so never try to invent one.
- `--quality high` for candidates the user will judge; drop to `medium` only for throwaway
  drafts.

## Prompt skeleton

Fill in `<subject>`, `<background>`, and the color choices; keep the section labels. Store
the filled prompt verbatim in the manifest item.

```text
Create one complete full-bleed 1:1 square IP mascot logo artwork.
Backdrop: cover the entire canvas with one visible, fully opaque solid <background>. Keep <background> clearly visible in all four square corners and every open area surrounding the mascot.
Subject: place one highly simplified <subject> mascot over the backdrop, reduced to one rounded continuous silhouette and one defining feature.
Complexity: use 6-10 broad basic shapes, at most two broad internal color regions, and a face with two eyes and one mouth. Keep the symbol readable at 32 x 32.
Color behavior: use exactly three semantic colors in the complete artwork: exactly two IP base colors plus the backdrop color. Organize both IP colors into broad purposeful masses and reuse them for facial marks. Keep the IP, facial marks, and backdrop clearly separated. Closely related tonal variants used for the ultra-light internal modeling do not count as additional semantic colors.
Composition: keep the mascot upright, emerging from the lower-left or lower-right, filling 75-85% of the square, with both paired identifying features visible.
Style: use an ultra-clean flat-first logo treatment with minimal graphic masses and only 8-12% extremely subtle internal tonal modeling inside the IP; barely neo-skeuomorphic, thick, soft, restrained, and scalable. Keep the result mostly flat.
Finish: show only the mascot over the full-canvas backdrop, with clean geometric surfaces and normal square outer corners.
Constraints: Use no text or watermark. Add no borders, frames, cards, or app-icon masks. Include one mascot only, with no extra subjects or scenery. Keep the contours thick and rounded, without fragile lines or sharp tips. Add no photorealistic material, dramatic bevel, glossy hotspot, deep occlusion, extrusion, strong three-dimensional rendering, or external cast shadow. Keep the background flat, with no gradient, texture, vignette, or lighting variation.
```

For variants, change exactly one deliberate dimension per candidate (composition angle,
secondary color region, expression, crop tightness) and note that dimension in the item
title.

## Evaluate every candidate — and report it straight

After the batch lands, open each generated image file and inspect it against every rule
above. Give each candidate a verdict in your report, with the exact findings.

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
- the mark is too small, sticker-centered, tilted, framed, or surrounded by excessive empty
  space;
- the internal modeling is materially stronger than the intended 8–12% — the result reads
  volumetric, inflated, molded, or fully shaded;
- an opaque background became a scene, texture, halo, vignette, or strong gradient instead
  of a solid field.

A transparent background by itself is an allowed variation, never a failure.

**Result integrity:** keep and present every generated image — no silent filtering, no
scoring results out of view, no post-processing repair, no hidden retries. One targeted
re-generation is fine when a constraint clearly failed, but say so, and keep the failed
attempt in its row. Actual generation errors are reported as technical failures, not papered
over with a substitute.

## Manifest conventions for identity batches

- `style`: `"flat-logo"` on every candidate — keeps series grouping intact.
- `tags`: `["logo", "identity"]` plus a per-direction tag like `"direction-a"`.
- Item `title`: variant label + the varied dimension — `"A2 — fox, tail sweep left"`.
- Item `prompt`: the full filled skeleton, verbatim — reproducibility is the point.
- After the batch: drop a `rowId` locator per direction row, then ask which candidate the
  user wants to refine.

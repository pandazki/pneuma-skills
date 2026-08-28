---
name: colorize
description: "Add strategic color to features that are too monochromatic or lack visual interest, making interfaces more engaging and expressive. Use when the user mentions the design looking gray, dull, lacking warmth, needing more color, or wanting a more vibrant or expressive palette."
argument-hint: "[target]"
user-invocable: true
---

Introduce color as hierarchy, meaning, and atmosphere. Preserve confirmed brand and semantic conventions; do not replace a visual world under the guise of colorizing it.

## MANDATORY PREPARATION

Before proceeding, consult the "Impeccable.style Design Intelligence" section of the pneuma-webcraft skill (SKILL.md) — it carries the setup steps, the visitor modes, and the Context Gathering Protocol. The quality floor and the ban list live in [craft-floor.md](craft-floor.md); load it immediately before you edit UI. If no design context exists yet, you MUST run the `init` command (see [cmd-init](cmd-init.md)) first. Additionally gather: existing brand colors.

---

## Visitor mode

- **Persuade / Experience:** color may carry the voice and own large regions when the selected world calls for it.
- **Operate / Read:** color primarily encodes action, selection, status, wayfinding, and reading hierarchy. Rarity gives an accent force.

## Audit before choosing

Read `DESIGN.md`, tokens, assets, current themes, and representative states. Identify:

- which colors are confirmed brand commitments;
- current surface, text, action, and semantic roles;
- places where grayscale obscures hierarchy or state;
- contrast failures and color-only communication;
- light/dark or data-visualization requirements;
- whether the task asks for more color or a new identity.

If a new identity is required, follow the new-work flow in [cmd-craft](cmd-craft.md). Ask only when a binding brand decision cannot be inferred.

## Choose a strategy

Name the intended emotional temperature, dominant relationship, contrast range, and color dosage before editing. The strategy may be restrained or immersive; it must follow the brief and selected world rather than a fixed percentage rule. The four named strategies — Restrained, Committed, Full palette, Drenched — and their dosages live in [cmd-craft](cmd-craft.md)'s "Commit the world"; inherit the one this surface already committed to rather than inventing a new dosage here.

Build roles, not a bag of swatches:

- canvas and elevated surfaces;
- primary and secondary text;
- action, focus, and selection;
- borders and separators;
- success, warning, error, and information;
- data categories or scales when needed.

Use the project's existing color space. For a new web palette, prefer OKLCH because lightness and chroma can be adjusted predictably. Choose hue from product meaning and visual direction, never from a default category association.

## Apply at system scale

- Let the strongest color own a deliberate region or role instead of scattering tiny accents.
- Keep the primary action easy to find; do not spend its color on decoration.
- Tint neutrals only when the brand hue genuinely creates cohesion. Neutral gray is valid when it serves the world.
- On colored surfaces, derive secondary text from the foreground or surface hue rather than using washed-out generic gray.
- Keep semantic meanings consistent, but respect platform and domain conventions instead of assuming fixed hues.
- For data, use distinct lightness, chroma, shape, label, or pattern so color is not the only code.
- In dark mode, design surface elevation and contrast explicitly; do not invert the light theme mechanically.
- Define primitive values and semantic tokens when the project has a token system. Theme changes should normally remap semantic roles.

Decoration without a relationship to hierarchy, state, content, or the visual world is not a color strategy.

## Contrast and perception

Verify computed foreground/background pairs:

| Content | WCAG AA minimum |
|---|---|
| body text | 4.5:1 |
| large text | 3:1 |
| controls, icons, focus indicators | 3:1 |

Do not rely on eyesight alone. Check interactive states, overlays, text on images, disabled content, and both themes. Simulate common vision deficiencies. Information conveyed by color also needs text, shape, iconography, or position.

When deriving OKLCH ramps, vary lightness and reduce chroma near white and black. Do not keep high chroma at extreme lightness merely to make the math uniform. Prefer explicit colors over chains of translucent overlays when alpha would make contrast context-dependent.

## Verify

- Every color has a stable role or a world-specific atmospheric purpose.
- Attention lands on the intended action, content, or state.
- The palette works across quiet, dense, interactive, error, and empty states.
- Light and dark themes are each composed, not mechanically inverted.
- Contrast and non-color cues pass in all relevant states.
- The result is recognizably this product, not a generic "colorful" treatment.

When the palette earns its place, hand off to the `polish` command (see [cmd-polish](cmd-polish.md)) for the final pass.

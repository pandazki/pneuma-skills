# Pneuma Console (product register seed)

A product-register example that pairs with the brand-register `pneuma/`
seed: same fictional product (Pneuma), now seen from the inside as a
team admin console.

**Pages**

- `index.html` — Sessions overview with a metric strip and a 248-row
  data table (mode pills, status dots, runtime, tokens, cost).
- `settings.html` — Workspace settings with sections for general,
  agent backend, budgets, and integrations. Form-heavy product UI:
  segmented controls, toggles, prefix inputs, sticky save bar.

**What this seed demonstrates** (impeccable v3.0 product register):

- System font stack, no display font. Tool disappears into the task.
- Fixed `rem` size scale, never `clamp()`. Product UI stays consistent
  at every viewport.
- Restrained palette: warm-tinted neutrals + one ink-blue accent that
  occupies <10% of surface area. Status colors (green / red) are
  semantic only, never decorative.
- Data density: 9 rows visible per screenful, tabular-nums on numbers,
  monospace on session IDs.
- Keyboard hints (`⌘K`, `S`, `,`) shown in the UI — assumed competence.
- 60-30-10 weight: surface dominates, secondary text and borders carry
  structure, accent only for current nav and primary actions.

Compare side-by-side with the `pneuma/` brand seed (same product, brand
register) to see the v3.0 register split in action: the brand site
opinionates (Outfit display font, dark theme, accent-on-accent hero),
the console disappears (system fonts, light surface, restrained
accent).

Edit copy / table rows freely; the structure is meant to be reused for
any internal-tool dashboard. Keep system fonts unless you have a strong
reason to switch — falling back to Inter or other reflex picks is the
exact training-data attractor v3.0 warns against.

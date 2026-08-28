---
name: typeset
description: "Improves typography by fixing font choices, hierarchy, sizing, weight, and readability so text feels intentional. Use when the user mentions fonts, type, readability, text hierarchy, sizing looks off, or wants more polished, intentional typography."
argument-hint: "[target]"
user-invocable: true
---

## MANDATORY PREPARATION

Before proceeding, consult the "Impeccable.style Design Intelligence" section of the pneuma-webcraft skill (SKILL.md) — it carries the setup steps, the visitor modes, and the Context Gathering Protocol. The quality floor and the ban list live in [craft-floor.md](craft-floor.md); load it immediately before you edit UI. If no design context exists yet, you MUST run the `init` command (see [cmd-init](cmd-init.md)) first.

Load [craft-floor.md](craft-floor.md) before you edit — its **Type** line is the floor this command has to clear.

---

Typography carries the information, the hierarchy, and the voice. Improve it inside the established visual world; do not replace the identity unless the user asked you to.

---

## Visitor mode

- **Persuade / Experience:** display type may carry the voice. Use decisive contrast and a responsive scale when the composition benefits — fluid `clamp()` sizing, ≥1.25 ratio between steps. The font selection procedure and the reflex-reject list of training-data default faces live in [cmd-craft](cmd-craft.md) under **Commit the world**.
- **Operate / Read:** stability, scanability, and measure come first. A single well-tuned family and a fixed `rem` role scale (1.125–1.2 between steps) are often right; the depth is in [operate.md](operate.md).

If replacing the typography would create a new identity, route through the new-work flow in [cmd-craft](cmd-craft.md) and rewrite `DESIGN.md`. Otherwise preserve the confirmed families and improve how they are used.

## Two isolated assessments

When a sub-agent tool is available and permitted, run these independently; otherwise run them yourself in this order. Do not let ban-list findings anchor the design assessment.

1. **Typographic assessment.** Inspect the representative pages and styles. Answer every question below with a file, a selector, or a computed value:
   - **Authority and fit:** which faces, weights, and roles are established? Do they fit the product and the committed world, or are they unexamined defaults? Is every family necessary?
   - **Hierarchy:** can heading, body, label, metadata, and data roles be distinguished at a glance? Are adjacent sizes or weights too close to carry different jobs?
   - **Scale and consistency:** is there a deliberate role scale, or a collection of arbitrary values? Do repeated roles stay identical across pages and states?
   - **Reading:** does body copy stay within a comfortable 45–75 character measure? Are line height, paragraph rhythm, contrast, and tracking tuned to the actual face, width, language, and surface?
   - **Stress:** what happens with long headings, localization expansion, zoom, narrow containers, missing weights, and font fallback?
   - **Delivery:** are only the used assets loaded? Do the fallback metrics, loading strategy, and variable-font settings avoid invisible text and disruptive reflow?
2. **Pattern check.** Read [craft-floor.md](craft-floor.md) and check the rendered type against its **Type** line and its typographic bans — the tracking floor, balanced headings, the display-face and kicker bans, monospace worn as a costume — over a `capture` of the live viewer (SKILL.md, "Verifying your work"). Also inspect the dynamic or arbitrary font values a rendered view cannot resolve.

Synthesize both assessments before editing, noting what each caught alone. A clean pattern check is a floor, not proof of good typography.

## Set the system

Before editing, state:

- the roles the interface needs;
- the intended contrast between those roles;
- the reading measure and the density;
- which existing faces and weights are authoritative;
- any performance, localization, or accessibility constraint that binds.

Use the fewest roles and families that make the hierarchy unmistakable — more than three families is almost always a mess, and two similar-but-not-identical faces are worse than one. Combine size, weight, space, and tone deliberately instead of asking size alone to do all the work. Name role tokens for their purpose (`--text-body`, `--text-heading`), never for their value (`--font-16`).

## Apply

- Keep body copy comfortably readable and zoomable. Use 1rem / 16px as the ordinary web body floor unless a dense role or a user setting justifies otherwise, and set sizes in `rem` so browser preferences still apply.
- Keep prose in the 45–75ch range with `max-width` in `ch` units. Tune line height inversely with measure: wider lines generally need more leading; headings want 1.1–1.2, body 1.5–1.7.
- Compensate light text on dark surfaces on all three perceptual axes: slightly more line height, a touch more tracking, and one step more weight when the face needs it.
- Tune line height to the face, width, language, and contrast, not to a universal ratio.
- Keep repeated roles consistent across pages and states, and define a clear job for each weight you load.
- Use numeric, tabular, code, and label features (`tabular-nums`, `font-variant-numeric`, `font-kerning: normal`) when the content benefits.
- Load only the font assets and weights you use. Provide metric-compatible fallbacks (`size-adjust`, `ascent-override`) and `font-display: swap` so text never blocks; preload the critical weight only, and prefer a variable font past three weights.
- Let display type respond to available space on Persuade and Experience surfaces; keep dense Operate and Read surfaces spatially predictable. Bound a `clamp()` at roughly `max ≤ 2.5 × min` so wide viewports do not shout.
- Preserve browser zoom and user font settings. Never `user-scalable=no`; if the layout breaks at 200%, fix the layout.
- Use paragraph spacing or first-line indentation as the paragraph rhythm; combining both double-marks the boundary.

Do not make type decorative at the expense of comprehension, and do not introduce a second family without a clear role only it can perform.

## Verify

- Primary, secondary, body, and metadata roles are recognizable without reading the copy.
- Long text stays comfortable across the relevant widths and languages.
- The typography belongs to the product and to its established world.
- Loading creates neither disruptive reflow nor invisible text.
- Zoom, text scaling, focus, contrast, and the narrow-viewport path all remain usable.
- The final pattern check against [craft-floor.md](craft-floor.md) has no unexplained findings.

Answer each item with rendered or source evidence, then run the pattern check once more. Do not substitute a bare "yes" for verification.

When the type carries the hierarchy on its own, hand off to the `polish` command (see [cmd-polish](cmd-polish.md)) for the final pass.

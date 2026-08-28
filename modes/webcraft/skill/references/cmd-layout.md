---
name: layout
description: "Improve layout, spacing, and visual rhythm. Fixes monotonous grids, inconsistent spacing, and weak visual hierarchy. Use when the user mentions layout feeling off, spacing issues, visual hierarchy, crowded UI, alignment problems, or wanting better composition."
argument-hint: "[target]"
user-invocable: true
---

## MANDATORY PREPARATION

Before proceeding, consult the "Impeccable.style Design Intelligence" section of the pneuma-webcraft skill (SKILL.md) — it carries the setup steps, the visitor modes, and the Context Gathering Protocol. The quality floor and the ban list live in [craft-floor.md](craft-floor.md); load it immediately before you edit UI. If no design context exists yet, you MUST run the `init` command (see [cmd-init](cmd-init.md)) first.

Load [craft-floor.md](craft-floor.md) before you edit — its **Spacing** line and its page-scaffold bans are the floor this command has to clear.

---

Layout turns product priority into reading order, grouping, rhythm, and usable space. Diagnose the structural problem before moving any boxes.

---

## Visitor mode

- **Persuade / Experience:** the composition may be asymmetric, fluid, or intentionally disruptive when the committed world earns it. Rhythm comes from contrast — tight groupings paired with generous separations.
- **Operate / Read:** predictable structure, stable density, and navigable linearity are affordances. Responsive behavior is structural (collapse the sidebar, reflow the table), not fluid typography; the depth is in [operate.md](operate.md).

Preserve the established visual world. A layout pass changes structure inside it; replacing the identity belongs to the new-work flow in [cmd-craft](cmd-craft.md).

## Two isolated assessments

When a sub-agent tool is available and permitted, run these independently; otherwise run them yourself in this order. Do not let ban-list findings anchor the design assessment.

1. **Layout assessment.** Inspect the representative states and viewports. Answer every question below with rendered or source evidence:
   - **Reading order:** apply the squint test. With the detail blurred, can you still identify the primary element, the secondary element, and the major groups, in order?
   - **Grouping:** are related items close and distinct groups separated, or are containers compensating for weak proximity?
   - **Rhythm:** do tight and generous intervals create a deliberate cadence, or is one spacing value repeated until everything carries equal weight?
   - **Structure:** does the topology match the content and the task? Are repeated cards, columns, or sections genuinely equivalent, or merely a framework default?
   - **Density:** does the amount of information per region fit use frequency, decision complexity, and visitor mode?
   - **Adaptation:** at narrow, intermediate, wide, zoomed, and localized states, what reorders, collapses, wraps, scrolls, or stays fixed? Do DOM and focus order still agree with the visual order?
   - **Extremes:** do long content, empty states, overlays, sticky elements, and small touch targets expose structural failures?
2. **Pattern check.** Read [craft-floor.md](craft-floor.md) and check the rendered page against its **Spacing** line and its page-scaffold bans — same-size card grids as page structure, nested cards, the hero-metric template, section-number scaffolding, first-viewport overflow, body text running to the viewport edge — over a `capture` of the live viewer (SKILL.md, "Verifying your work"). Also inspect the arbitrary spacing, overflow, stacking, and container behavior a rendered view cannot resolve.

`capture` shoots the live viewer at its current viewport, so the adaptation questions are answered by reading the real breakpoints and container queries with the actual copy in place, and by asking the user to set a width when one genuinely matters. Synthesize both passes before editing. A clean pattern check cannot prove hierarchy or rhythm.

## Set the spatial thesis

Before editing, name:

- the primary reading or task path;
- what belongs together and what must separate;
- which element leads and which supports;
- the intended density and spacing rhythm;
- how the structure changes across containers, viewports, input modes, and content extremes.

Choose the simplest structural model that expresses those relationships: Flexbox for one-dimensional runs, Grid (with named areas at page scale) for two-dimensional structure, container queries for a component that appears in different contexts. Name reusable spacing and container roles semantically (`--space-md`, not `--spacing-16`).

## Apply

- Group by meaning. Use proximity before adding a container or any decoration.
- Create rhythm through deliberate contrast between tight and generous intervals: 8–12px between siblings, 48–96px between distinct sections, and not every row on the same gap.
- Use a documented spacing scale rather than one-off values. A 4-unit base (4, 8, 12, 16, 24, 32, 48, 64, 96) provides the useful middle steps an 8-only scale misses.
- Let hierarchy follow product priority, not framework defaults, and build it from the fewest dimensions that work — space and weight alone are often enough. Size at 3:1 or more, bold against regular, and generous surrounding space read as primary; 15-versus-16px and medium-versus-regular do not.
- Keep distinct content visually distinct without turning every group into an isolated component.
- Make responsive behavior structural: reorder, collapse, reflow, or reveal based on what stays important.
- Use `gap` for sibling rhythm when it expresses the relationship more directly than child margins, and `clamp()` for spacing that should breathe on larger screens.
- Keep touch targets usable at 44×44px even when the visible mark is smaller — expand the hit area with padding or a pseudo-element.
- Use depth only when it clarifies state or hierarchy, on a consistent, restrained shadow scale.
- Make optical corrections only after inspecting the rendered result: nudge a glyph that reads off-center, pull text back by about `-0.05em` where letterform whitespace fakes an indent. Never adjust speculatively.

Variation is not a goal by itself. Repetition should support recognition; break it only when the content or the priority changes.

## Verify

- The squint test still reveals the primary element, the secondary element, and the major groups, in order.
- The reading and task path stays clear at every supported size.
- Related content groups naturally; unrelated content does not blur together.
- Tight and generous spacing create an intentional rhythm instead of monotonous repetition.
- Density matches use frequency and content complexity.
- Long text, empty states, localization, zoom, and dynamic content do not break the structure.
- Keyboard, touch, and assistive-technology order agree with the visual order.
- The final pattern check against [craft-floor.md](craft-floor.md) has no unexplained findings.

Answer each item with rendered or source evidence, then run the pattern check once more. Do not substitute a bare "yes" for verification.

When the rhythm and the hierarchy land, hand off to the `polish` command (see [cmd-polish](cmd-polish.md)) for the final pass.

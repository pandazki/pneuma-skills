---
name: shape
description: "Plan the UX and UI for a feature before writing code. Runs a structured discovery interview, then produces a design brief that guides implementation. Use during the planning phase to establish design direction, constraints, and strategy before any code is written."
argument-hint: "[feature to shape]"
user-invocable: true
---

# Shape

Discover what should be made and how it should work, then return a confirmed design brief without code. Shape produces the thinking that makes the code good; it never writes the code.

## MANDATORY PREPARATION

Before proceeding, consult the "Impeccable.style Design Intelligence" section of the pneuma-webcraft skill (SKILL.md) — it carries the setup steps, the visitor modes, and the Context Gathering Protocol. If no design context exists yet, run the `init` command (see [cmd-init](cmd-init.md)) first; a missing `DESIGN.md` does **not** route back to `init`.

Do not load [craft-floor.md](craft-floor.md) here — shape is planning-only work, and the floor is for building.

---

## Phase 1: Discovery interview

Do not write code or choose a visual direction yet.

### Cadence

- {{ask_instruction}} Ask two or three related questions per round, then wait. One round is the default; add a second only when the answers expose a material gap.
- Do not dump a questionnaire, repeat settled facts, or turn obvious facts into menus. Assert the likely reading and invite correction.
- A sparse prompt requires at least one answer round. A precise prompt may need only a compact confirmation.
- Treat `PRODUCT.md`, `DESIGN.md`, and a legacy `.impeccable.md` as anchors: they remove repeated questions, but they never replace shape, which is task-specific.

### Round 1: purpose, people, and outcome

Choose the two or three questions that most change the result:

- What is this surface or feature for, and what problem must it solve?
- Who specifically reaches it, in what situation and state of mind?
- What is the primary thing they must understand or do? What would success look like?
- What is uniquely true here that a neighboring product or a generic template could not claim?

### Round 2: material, behavior, and boundaries

Run only for material unresolved decisions:

- What real content, evidence, data, and assets must the experience carry? What are the realistic minimum, typical, and maximum ranges?
- Which states and transitions matter: first-run, empty, loading, error, success, permissions, overflow, or expert use?
- What is the intended fidelity, breadth, and interactivity: exploration, production-ready screen, full flow, or broader surface?
- What must remain untouched? What would make the result feel wrong even if it looked polished?
- Which framework, performance, accessibility, localization, or delivery constraints are binding?

Never ask for CSS values or canned aesthetic lanes. The new-work flow owns visual-world and concept choices.

## Phase 2: Resolve the design direction

For a new surface, a brand expansion, or a replacement world, follow the new-work flow in [cmd-craft](cmd-craft.md) through visual authority, any world derivation, and the direction choice. Reuse the discovery answers instead of re-asking, then return here before its intent contract, persistence, or implementation — cmd-craft names that exit explicitly at the end of its "Record the decision" step.

Inside an established world, use that flow's direction process only when composition or interaction is still materially open. Otherwise inherit the world and resolve structure in the brief.

## Phase 3: Write the brief

Write the smallest useful brief:

1. **Job and audience:** who arrives, their context, their need, and the visitor mode.
2. **Outcome and proof:** the primary task or action, what success is, the real evidence on hand, and the product-specific truth.
3. **Selected direction:** visual authority, the structural and interaction thesis, sequence, focal moment, and implementation consequence.
4. **Scope and boundaries:** fidelity, breadth, interactivity, the named target, what remains untouched, and explicit anti-goals.
5. **States and ranges:** the realistic content and data ranges, and the material states.
6. **Interaction and layout:** hierarchy, topology, responsiveness, affordances, feedback, and transitions — intent, not CSS.
7. **Constraints and open decisions:** framework, delivery, accessibility, localization, reusable components, and the choices a builder must not invent.

Use three to five bullets when the task is settled; use the full structure only for ambiguous, multi-screen, or standalone planning. Do not restate the conversation, and do not pad a clear brief to look thorough.

## Confirm and stop

Present the brief for explicit confirmation or one correction round, then stop: shape never writes code or a direction contract. You are not the judge of whether the user already approved — the pause is what separates shape from premature implementation.

When no human or structured answer mechanism exists, mark the assumptions plainly, return the brief, and stop.

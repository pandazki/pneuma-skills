---
name: polish
description: "Performs a final quality pass fixing alignment, spacing, consistency, and micro-detail issues before shipping. Use when the user mentions polish, finishing touches, pre-launch review, something looks off, or wants to go from good to great."
argument-hint: "[target]"
user-invocable: true
---

Polish is refinement, never a concealed redesign. Preserve the incumbent visual world, content, behavior, and everything outside the scope of the ask. If the concept itself is wrong, say so and recommend a redesign or `bolder` instead of smuggling a replacement in under the name "polish".

An automated check is defect evidence, not proof of quality. Inspect the rendered experience and the real interaction path.

## MANDATORY PREPARATION

Before proceeding, consult the "Impeccable.style Design Intelligence" section of the pneuma-webcraft skill (SKILL.md) — it carries the setup steps, the visitor modes, and the Context Gathering Protocol. The quality floor and the ban list live in [craft-floor.md](craft-floor.md); load it immediately before you edit UI. If no design context exists yet, you MUST run the `init` command first (see [cmd-init](cmd-init.md)). Additionally gather: the quality bar and the shipping constraints.

Load [craft-floor.md](craft-floor.md) before you edit — polish is building, and the floor is the standard you are polishing to.

---

## 1. Establish the system

Read `DESIGN.md` and the representative tokens, shared components, patterns, and neighboring flows of the active content set. If no formal system exists, use the coherent conventions already visible in the code.

Classify each drift before fixing it:

- **missing token:** the system needs a reusable value;
- **one-off implementation:** an existing shared component or pattern should replace it;
- **conceptual mismatch:** the flow, information architecture, or hierarchy differs from comparable areas of the product;
- **local defect:** the implementation is simply incomplete or inconsistent.

Fix the cause at the narrowest correct level. Aligning the feature to the system is not optional — polish without alignment is decoration on top of drift. Ask when a binding system principle cannot be inferred; never guess at it.

## 2. Gather the evidence

Use the feature yourself at the surface's representative sizes. Batch the views you need into one `capture` round (SKILL.md, "Verifying your work") — the full page, then each region the polish touches, at legible scale. `capture` shoots the live viewer at its current viewport, so responsive claims are not evidence you can produce alone: verify the narrow, intermediate, and wide compositions by reading the real breakpoints and clamp scales with the actual copy in place, and when a width genuinely matters, ask the user to set the viewport and say what they see.

Determine:

- whether the path is functionally complete — polish is the last step, never the first;
- the intended quality bar and the time available;
- known constraints and deliberately unfinished work;
- the states, content lengths, roles, and input methods users will actually encounter.

If a prior critique exists, use it as one input. Resolve the target to a concrete file path, compute its slug with the same lowercase + `-`/`_` rule the `critique` command uses, list `.impeccable/critique/` for the most recent `*__<slug>.md` snapshot, and read it with your `Read` tool. Fold its P0/P1 findings into the polish list and name the snapshot you read, so the user sees what informed you. Honor `.impeccable/critique/ignore.md` when present: those lines are user-curated intentional deviations that polish must never "fix". Perform an independent pass either way.

## 3. Triage

Separate functional defects from cosmetic ones and fix in this order:

1. broken or blocked tasks, data loss, misleading state, and inaccessible paths;
2. missing loading, empty, error, success, disabled, and permission states;
3. flow, hierarchy, responsive, and design-system drift;
4. visual and motion inconsistencies;
5. code and asset cleanup.

When polish time is tight, functional issues ship first. Do not perfect one corner while leaving the rest below the same quality bar.

## 4. Polish the whole path

### Flow and hierarchy

- Match neighboring mental models, terminology, disclosure, routing, save behavior, and optimistic or pessimistic patterns. A "Workspace" here must not be a "Project" three screens away.
- Make the primary task and the current state obvious without flattening every element to equal weight.
- Ensure arrival, transition, empty, and recovery paths connect instead of behaving as isolated screens.

### Layout and type

- Align to the project's grid and spacing scale; fix optical as well as mathematical alignment.
- Group related content tightly and separate distinct groups generously.
- Keep same-role typography consistent; test measure, wrapping, localization expansion, zoom, and font loading.
- Verify every supported viewport rather than correcting only the view you captured.

### Color, imagery, and icons

- Use semantic tokens and keep color meanings stable across themes; no hard-coded values where a token exists.
- Verify text, control, and focus contrast in every state. Never put gray text on a colored surface — tint it from that hue or from the foreground.
- Keep icon families, stroke weight, sizing, and optical alignment coherent.
- Prevent image layout shift; use correct aspect ratios, responsive sources, and useful alt text.

### Interaction and state

- Every control needs appropriate default, hover, focus, active, disabled, loading, error, and success behavior. Missing states are broken experiences, not cosmetic gaps.
- Preserve visible keyboard focus, logical tab order, labels, and 44×44px touch targets.
- Keep motion coherent, interruptible, and performant, with a `prefers-reduced-motion` alternative. Do not add animation merely to make the polish visible.
- Validate long, missing, localized, offline, and slow content wherever the product can encounter it.

### Content and code

- Keep terminology, capitalization, punctuation, and factual copy consistent. Ask before changing a claim.
- Remove debug output, dead code, unused imports, obsolete styles, and any duplication polish itself introduced.
- Replace a custom implementation with the shared component whenever the system owns that pattern.
- Promote a genuinely reusable value to a token; do not build a system abstraction for one local exception.

## 5. Verify and finish

Go through the complete path once more. Check:

- mobile, intermediate, and wide layouts — captured where the viewer can show them, read from the breakpoints where it cannot;
- loading, empty, error, success, disabled, long-content, and missing-content states;
- zoom, contrast, focus order, semantics, and accessible names, read from the markup;
- console errors, layout shift, interaction latency, and image loading;
- agreement with `DESIGN.md`, with neighboring features, and with the user's scope.

Keyboard, pointer, and touch behavior you cannot exercise from here is verified by reading the interaction code, and by asking the user to try the one path a screenshot cannot prove. Never report an interaction as tested when what you did was read it.

Then check the result against [craft-floor.md](craft-floor.md)'s ban list and fix what it names; document only a narrow intentional exception. A clean pass over the ban list is a floor, never proof that the design is strong.

Finish with a source diff: remove accidental churn, orphaned code, redundant values, and temporary artifacts. Ship only when the feature is functionally complete and consistently finished across the whole path.

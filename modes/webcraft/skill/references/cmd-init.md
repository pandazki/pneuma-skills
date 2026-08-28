---
name: init
description: "Sets up a project for design work. Explores the workspace, runs a focused interview for product truth, and writes PRODUCT.md (users, purpose, positioning, evidence on hand, brand commitments, principles), then recommends the best commands to run next. It never invents a visual world and never writes DESIGN.md — the `document` command records that. Use once per project. `teach` is a deprecated alias for this command."
argument-hint: "[target]"
user-invocable: true
---

# Init flow

`init` captures durable product truth in `PRODUCT.md`. It does not invent a visual world and it does not write `DESIGN.md`: the new-work flow in [cmd-craft](cmd-craft.md) creates or expands one, and [cmd-document](cmd-document.md) records an incumbent one. `.impeccable.md` is the accepted legacy single-file equivalent of `PRODUCT.md` — pneuma-webcraft keeps reading and updating it so existing workspaces don't break.

Every other webcraft command reads `PRODUCT.md` and `DESIGN.md` (whichever exist) before doing any work. `teach` is the deprecated name for this command: a `teach` invocation runs this flow unchanged.

## Step 1: Load current state

Read the project root and the active content set with your `Read` tool: `PRODUCT.md`, `DESIGN.md`, a legacy `.impeccable.md`, and any `README.md` or brand docs. Update the file that already carries authority instead of creating a competing one.

- **No `PRODUCT.md`:** explore, interview, and write it.
- **`PRODUCT.md` exists:** ask what product knowledge is stale or missing; do not reopen confirmed fields without a reason.
- **Legacy `PRODUCT.md`:** add only durable missing facts. A `## Register` section or a `register:` field is the retired brand/product split — replace it with the confirmed visitor mode rather than carrying both.
- **Legacy `.impeccable.md` and no `PRODUCT.md`:** keep updating `.impeccable.md` in place with the structure in Step 4. Offer to migrate it to `PRODUCT.md` only if the user agrees.
- **Only `DESIGN.md` exists:** leave it untouched and create `PRODUCT.md`.
- **Redesign or rebrand request:** preserve confirmed product truth unless the user changes it. Visual replacement happens later in the new-work flow, not here.

Never silently overwrite an existing file, and never offer `DESIGN.md` during init. If another request invoked init as a setup blocker, finish `PRODUCT.md` and resume that request: your own writes are the freshest source, so no reload is needed. New visual work continues in [cmd-craft](cmd-craft.md); `shape` resumes its task interview first, because init is not a substitute for the task-specific brief.

## Step 2: Explore the project

Before asking anything, scan enough that the user never repeats a fact the workspace already states: README and product docs; package and config files; pages, routes, content sets, and roles; names, logos, and legal or proof assets; existing design tokens, CSS variables, and components; accessibility signals.

Treat repository evidence as a hypothesis, not user approval. Note the visual maturity you find without documenting, extending, or replacing that world.

Form a **visitor-mode hypothesis** (Persuade / Operate / Read / Experience — see SKILL.md's Modes section) from what the code shows:

- Persuade signals: `/`, `/about`, `/pricing`, hero sections, big typography, scroll-driven sections, landing-page-shaped content.
- Operate signals: `/app/*`, `/dashboard`, `/settings`, forms, data tables, side or top nav, app-shell components.
- Read signals: `/docs/*`, `/blog/*`, changelogs, long-form article templates, tables of contents.
- Experience signals: galleries, case-study pages, full-bleed media, work indexes where the artifact leads.

It stays a hypothesis; Step 3 confirms it. Also note rough edges worth a follow-up command (thin hierarchy, flat palette, missing error or empty states, dull copy) — Step 5 turns them into recommendations without re-analyzing.

## Step 3: Interview for product truth

{{ask_instruction}} Ask only about material gaps the workspace and the original request do not already answer with strong evidence. Keep rounds to at most three focused questions, and require one real answer or approval round before writing a new `PRODUCT.md`. Confirm every inference; never synthesize `PRODUCT.md` from the original prompt alone.

Whether anyone can answer is a mechanical test, not a judgment call. Probe once with the real first round before concluding no one is there. Only after that probe goes unanswered may you infer from the explicit brief — and then you label every inferred fact in `PRODUCT.md` and disclose the substitution in your first reply, not your last.

Start with the unknowns that most change future product decisions:

1. Who is the primary user, in what situation, and what job are they doing?
2. What does the product make possible, and what is its meaningfully different mechanism or position?
3. What durable constraints, assets, evidence, or product facts must future work preserve?

Confirm the visitor mode separately when Step 2's signal is genuinely split (a product with a big marketing landing, say): lead with the hypothesis — *"this reads as an Operate surface, does that match your intent?"* — rather than offering a four-option menu. The mode is decided per surface and one project can hold all four; `PRODUCT.md` carries the primary one.

When the workspace has no framework or scaffold and the request implies building, the stack is a user decision, not yours: ask once whether they want plain static HTML/CSS, a specific framework, or your recommendation, plus any deploy target that constrains the answer. Record the outcome under `## Stack`, including "delegated" when they leave it to you, so later work knows the choice was offered.

Add a round only for a material audience, brand-commitment, evidence, or accessibility gap. Record undecided facts instead of inventing them.

Do not ask for an aesthetic direction, emotional feel, visual references, colors, typography, or style during init. If the user volunteers a binding visual constraint, record it without expanding it.

### What belongs here

- users, jobs, workflows, purpose, success, positioning, and operating context;
- capabilities, constraints, terminology, evidence, and accessibility;
- confirmed voice, assets, and brand commitments.

### What does not belong here

- visual worlds, palettes, typography, components, or page concepts;
- visitor-mode strategy per surface, narrative, CTA or proof sequence;
- invented testimonials, customers, benchmarks, pricing, or deployment claims;
- a requirement to decide every optional field.

## Step 4: Write PRODUCT.md

Write only confirmed facts and explicitly marked open decisions. Omit an irrelevant section rather than filling it with generic prose.

Where it goes:

- **Greenfield:** write `PRODUCT.md` at the project root.
- **Existing `PRODUCT.md`:** merge into it rather than starting from scratch.
- **Legacy `.impeccable.md`:** update it in place with the same structure; it already serves as that workspace's design-context source of truth.

```markdown
# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack
[Greenfield only: the user's answer to the stack question, e.g. "static HTML/CSS", "Astro", or "delegated: <what you chose and why>". Omit the section when an existing codebase already answers it.]

## Users
[Primary users, their situation, and job. Add other audiences only when confirmed.]

## Product Purpose
[What the product does, why it exists, and what success means.]

## Positioning
[The product mechanism or claim a neighboring product could not truthfully copy.]

## Operating Context
[Workflows, environments, tools, documents, materials, and rituals that are factual parts of using or evaluating the product.]

## Capabilities and Constraints
[Confirmed functionality, technical constraints, terminology, and explicitly undecided product facts.]

## Brand Commitments
[Existing name, voice, assets, personality, identity constraints, and references the user explicitly made binding. Omit when none exist.]

## Evidence on Hand
[Real content, data, demonstrations, testimonials, case studies, press, or assets, with paths where applicable. State absences that future work must not fabricate.]

## Product Principles
[Three to five durable strategic principles derived from confirmed answers; no visual recipes.]

## Accessibility & Inclusion
[Known user needs or required standard. Omit when no product-specific requirement was established.]
```

Platform is the bare value `web` — webcraft renders web pages in the viewer, so there is no other value to record. Preserve useful legacy headings. Write the file before any visual-world or surface-concept work.

Copy the `impeccable:product-schema` comment verbatim, including when you update an older file. It records which version of the product record this file follows, so a later version can tell a deliberately short record from one written before a section existed, and never proposes an interview the user has already sat through. Change the number only when this reference's template changes it.

### Completion gate

Before entering the new-work flow or resuming `shape`, verify that `PRODUCT.md` (or the legacy `.impeccable.md`) exists and holds the confirmed product record. If the file is absent, init is incomplete. Do not substitute interview notes, a planning packet, or later design prose for the file.

## Step 5: Wrap up or resume

Summarize tersely: the visitor mode captured, what was written, the three to five product principles that will guide future work, and any fact deliberately left undecided. Do not offer `DESIGN.md` merely because it is missing.

Then recommend the next action from the actual project state, drawn from what your Step 2 crawl already surfaced — do not run a fresh analysis. Offer the two to four most relevant, not a menu dump, and name the exact toolbar command:

- **Empty or early project:** ask naturally for the surface to build, or `shape <surface>` when the user wants a confirmed brief without implementation. The new-work flow establishes a visual world only when the requested work needs one.
- **Existing coherent interface without `DESIGN.md`:** `document`, if the user wants the incumbent system recorded independently of a new build.
- **Existing surface needing work:** name the most relevant scoped command. When the crawl flagged a specific weakness, point the matching command at it: thin hierarchy or spacing → `layout`, flat or gray palette → `colorize`, missing error or empty states → `harden` or `onboard`, dull or unclear copy → `clarify`, a scored UX review → `critique`, accessibility / performance / responsive checks → `audit`.

The full command menu lives in the viewer toolbar; keep this list short and pointed.

If init was invoked as a blocker by another command (the user ran `polish` with no `PRODUCT.md`, say), resume that original task now. The new-work flow owns every later visual decision.

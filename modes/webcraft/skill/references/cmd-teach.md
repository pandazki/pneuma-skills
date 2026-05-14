---
name: teach
description: "Gather design context for this project and save persistent guidelines to .impeccable.md (or PRODUCT.md / DESIGN.md). Run this once per project to establish design direction."
argument-hint: "[target]"
user-invocable: true
---

# Teach Flow

Gathers design context for a project and writes one or two complementary files at the project root:

- **PRODUCT.md** (strategic): register, target users, product purpose, brand personality, anti-references, strategic design principles. Answers "who/what/why".
- **DESIGN.md** (visual): visual theme, color palette, typography, components, layout. Follows the [Google Stitch DESIGN.md format](https://stitch.withgoogle.com/docs/design-md/format/). Answers "how it looks". The `document` command writes this one (see [cmd-document](cmd-document.md)).
- **`.impeccable.md`** (legacy single-file context): pneuma-webcraft accepts this filename for back-compat with existing user workspaces. New projects should split into PRODUCT.md + DESIGN.md, but if an existing `.impeccable.md` is already present, treat it as PRODUCT.md's content and continue to update it in place.

Every other webcraft command reads these files (whichever exist) before doing any work.

---

## MANDATORY CONTEXT

Design commands produce generic output without project context. You MUST have confirmed design context before doing any design work.

**Required context** (every design command needs at minimum):
- **Register**: brand (marketing, landing, campaign, portfolio: design IS the product) or product (app UI, admin, dashboards, tools: design SERVES the product)
- **Target audience**: who uses this product and in what context
- **Use cases**: what jobs they're trying to get done
- **Brand personality/tone**: how the interface should feel

**CRITICAL**: You cannot infer this context by reading the codebase alone. Code tells you what was built, not who it's for or what it should feel like. Only the creator can fully confirm this context.

---

## Step 1: Load current state

Before asking anything, figure out what already exists. Use the Read tool against the project root.

- Is there a `PRODUCT.md` or `DESIGN.md`?
- Is there a legacy `.impeccable.md`? (single-file context from earlier pneuma-webcraft sessions)
- Anything else (`README.md`, brand docs)?

Decision tree:

- **Nothing exists**: do Steps 2-4 (write PRODUCT.md, or `.impeccable.md` for back-compat — see Step 4), then decide on DESIGN.md based on whether there's code to analyze.
- **PRODUCT.md exists, DESIGN.md missing**: skip to Step 5 and offer to run the `document` command for DESIGN.md.
- **PRODUCT.md exists but has no `## Register` section (older write)**: add it. Infer a hypothesis from the codebase (see Step 2), confirm with the user, write the field.
- **Both exist**: {{ask_instruction}} Ask which file to refresh. Skip the one the user doesn't want changed.
- **Just DESIGN.md exists (unusual)**: do Steps 2-4 to produce PRODUCT.md.
- **`.impeccable.md` exists but no PRODUCT.md/DESIGN.md**: keep updating `.impeccable.md` (Step 4 falls back to it for back-compat). Optionally offer to migrate by renaming `.impeccable.md` to `PRODUCT.md` and running the `document` command for DESIGN.md; only do it if the user agrees.

Never silently overwrite an existing file. Always confirm first.

If teach was invoked as a setup blocker by another command (e.g. the user ran `craft landing page` with no PRODUCT.md), pause that command here. Complete teach, then resume the original command with the freshly written context. For craft, resume into shape next; teach creates project context, but it is not a substitute for the task-specific shape interview and confirmed design brief.

## Step 2: Explore the codebase

Before asking questions, thoroughly scan the project to discover what you can:

- **README and docs**: Project purpose, target audience, any stated goals
- **Package.json / config files**: Tech stack, dependencies, existing design libraries
- **Existing components**: Current design patterns, spacing, typography in use
- **Brand assets**: Logos, favicons, color values already defined
- **Design tokens / CSS variables**: Existing color palettes, font stacks, spacing scales
- **Any style guides or brand documentation**

Also form a **register hypothesis** from what you find:

- Brand signals: `/`, `/about`, `/pricing`, `/blog/*`, `/docs/*`, hero sections, big typography, scroll-driven sections, landing-page-shaped content.
- Product signals: `/app/*`, `/dashboard`, `/settings`, `/(auth)`, forms, data tables, side/top nav, app-shell components.

Register is a hypothesis at this point, not a decision; Step 3 confirms it.

Note what you've learned and what remains unclear. This exploration feeds both PRODUCT.md and DESIGN.md.

## Step 3: Ask strategic questions (for PRODUCT.md)

{{ask_instruction}} Ask only about what you couldn't infer from the codebase.

### Interview mode, not confirmation mode

If the repo is empty or the user's brief is sparse, run a short interview before proposing PRODUCT.md. Do **not** turn a one-sentence request into a complete inferred PRODUCT.md and ask for blanket confirmation.

- Ask **2-3 questions per round**, then wait for answers.
- Use inferred answers as hypotheses or options, not as finished facts.
- Complete at least one real user-answer round before drafting PRODUCT.md, unless every required answer is directly discoverable from repo docs.
- Round 1 should establish register, users/purpose, and desired outcome.
- Round 2 should establish brand personality or references, anti-references, and accessibility needs.

### Minimum viable interview

Ask enough to complete PRODUCT.md. At minimum, cover register confirmation, users and purpose, brand personality, anti-references, and accessibility needs unless each answer is directly discoverable from repo context. After at least one interview round, you may propose inferred answers, but the user must confirm them before you write PRODUCT.md. Never synthesize PRODUCT.md from the original task prompt alone.

### Register (ask first; it shapes everything below)

Every design task is either **brand** (marketing, landing, campaign, long-form content, portfolio: design IS the product) or **product** (app UI, admin, dashboards, tools: design SERVES the product).

If Step 2 produced a clear hypothesis, lead with it: *"From the codebase, this looks like a [brand / product] surface. Does that match your intent, or should we treat it differently?"*

If the signal is genuinely split (e.g. a product with a big marketing landing), {{ask_instruction}} Ask which register describes the **primary** surface. The register can be overridden per task later, but PRODUCT.md carries one default.

### Users & Purpose
- Who uses this? What's their context when using it?
- What job are they trying to get done?
- For brand: what emotions should the interface evoke? (confidence, delight, calm, urgency)
- For product: what workflow are they in? What's the primary task on any given screen?

### Brand & Personality
- How would you describe the brand personality in 3 words?
- Reference sites or apps that capture the right feel? What specifically about them?
  - For brand, push for real-world references in the right lane (tech-minimal, editorial-magazine, consumer-warm, brutalist-grid, etc.), not generic "modern" adjectives.
  - For product, push for category best-tool references (Linear, Figma, Notion, Raycast, Stripe).
- What should this explicitly NOT look like? Any anti-references?

### Accessibility & Inclusion
- Specific accessibility requirements? (WCAG level, known user needs)
- Considerations for reduced motion, color blindness, or other accommodations?

Skip questions where the answer is already clear. **Do NOT ask about colors, fonts, radii, or visual styling here.** Those belong in DESIGN.md, not PRODUCT.md.

## Step 4: Write the strategic context

Write only after the user has confirmed the strategic answers from Step 3. If an inferred answer is uncertain or unconfirmed, ask before writing.

### Where to write

- **Greenfield (no prior file)**: write `PRODUCT.md` at the project root.
- **Existing `.impeccable.md` (legacy back-compat)**: update `.impeccable.md` in place using the structure below — pneuma-webcraft accepts this filename so existing user workspaces don't break. Optionally offer to migrate to `PRODUCT.md` + `DESIGN.md`; only do it if the user agrees.
- **Existing `PRODUCT.md`**: merge with the existing content rather than starting from scratch.

### Structure

```markdown
# Product

## Register

product

## Users
[Who they are, their context, the job to be done]

## Product Purpose
[What this product does, why it exists, what success looks like]

## Brand Personality
[Voice, tone, 3-word personality, emotional goals]

## Anti-references
[What this should NOT look like. Specific bad-example sites or patterns to avoid.]

## Design Principles
[3-5 strategic principles derived from the conversation. Principles like "practice what you preach", "show, don't tell", "expert confidence". NOT visual rules like "use OKLCH" or "magenta accent".]

## Accessibility & Inclusion
[WCAG level, known user needs, considerations]
```

Register is either `brand` or `product` as a bare value. No prose, no commentary.

When writing to legacy `.impeccable.md`, keep the same section structure; the file already serves as the project's design-context source of truth.

## Step 5: Decide on DESIGN.md

Offer the `document` command (see [cmd-document](cmd-document.md)) either way. Two paths:

- **Code exists** (CSS tokens, components, a running site): "I can generate a DESIGN.md that captures your visual system (colors, typography, components) so variants stay on-brand. Want to do that now?"
- **Pre-implementation** (empty project): "I can seed a starter DESIGN.md from five quick questions about color strategy, type direction, motion energy, and references. You can re-run once there's code, to capture the real tokens. Want to do that now?"

If the user agrees, hand off to the `document` command (it auto-detects scan vs seed). Load its reference and follow that flow.

If the user prefers to skip, mention they can run the `document` command any time later.

## Step 6: Confirm and wrap up

Summarize:
- Register captured (brand / product)
- What was written (PRODUCT.md, DESIGN.md, both, or updated `.impeccable.md`)
- The 3-5 strategic principles that will guide future work
- If DESIGN.md is pending, remind the user how to generate it later

The newly-written PRODUCT.md / DESIGN.md / `.impeccable.md` is now visible in the Pneuma viewer iframe and is read on demand by subsequent commands; no separate cache refresh step is needed.

If teach was invoked as a blocker by another command (e.g. the user ran `polish` with no PRODUCT.md), resume that original task now with the fresh context.

Optionally {{ask_instruction}} Ask whether they'd like a brief summary of PRODUCT.md appended to {{config_file}} for easier agent reference. If yes, append a short **Design Context** pointer section there.

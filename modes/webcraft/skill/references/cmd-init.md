---
name: init
description: "Sets up a project for design work. Runs a multi-round discovery interview when context is missing and writes PRODUCT.md (strategic: users, brand, principles); offers DESIGN.md (visual: colors, typography, components) when code exists; then recommends the best commands to run next. Every other command reads these files before doing work. Use once per project. `teach` is a deprecated alias for this command."
argument-hint: "[target]"
user-invocable: true
---

# Init Flow

The setup command for a project. One codebase crawl feeds everything it writes:

- **PRODUCT.md** (strategic): root project file for register, target users, product purpose, brand personality, anti-references, strategic design principles. Answers "who/what/why".
- **DESIGN.md** (visual): root project file for visual theme, color palette, typography, components, layout. Follows the [DESIGN.md format spec](https://raw.githubusercontent.com/google-labs-code/design.md/main/docs/spec.md). Answers "how it looks". The `document` command writes this one (see [cmd-document](cmd-document.md)).
- **`.impeccable.md`** (legacy single-file context): pneuma-webcraft accepts this filename for back-compat with existing user workspaces. New projects should split into PRODUCT.md + DESIGN.md, but if an existing `.impeccable.md` is already present, treat it as PRODUCT.md's content and continue to update it in place.

It closes by pointing the user at the best command to run next. Every other webcraft command reads PRODUCT.md and DESIGN.md (whichever exist) before doing any work.

`teach` is the deprecated name for this command: if the user invokes `teach`, follow this flow as if they ran `init`.

## Step 1: Load current state

Check what already exists. Use the Read tool against the project root (the active content set and the workspace root).

- Is there a `PRODUCT.md` or `DESIGN.md`?
- Is there a legacy `.impeccable.md`? (single-file context from earlier pneuma-webcraft sessions)
- Anything else (`README.md`, brand docs)?

Decision tree:
- **Neither file exists (empty project or no context yet)**: do Steps 2-4 (write PRODUCT.md, or `.impeccable.md` for back-compat — see Step 4), then decide on DESIGN.md based on whether there's code to analyze.
- **PRODUCT.md exists, DESIGN.md missing**: skip to Step 5 and offer to run the `document` command for DESIGN.md.
- **PRODUCT.md exists but has no `## Register` section (legacy)**: add it. Infer a hypothesis from the codebase (see Step 2), confirm with the user, write the field.
- **Both exist**: {{ask_instruction}} Ask which file to refresh. Skip the one the user doesn't want changed.
- **Just DESIGN.md exists (unusual)**: do Steps 2-4 to produce PRODUCT.md.
- **`.impeccable.md` exists but no PRODUCT.md/DESIGN.md**: keep updating `.impeccable.md` (Step 4 falls back to it for back-compat). Optionally offer to migrate by renaming `.impeccable.md` to `PRODUCT.md` and running the `document` command for DESIGN.md; only do it if the user agrees.

Never silently overwrite an existing file. Always confirm first.

If init was invoked as a setup blocker by another command (e.g. the user ran `craft landing page` with no PRODUCT.md), pause that command here. Complete init, then resume the original command. Your own writes are the freshest source; no reload needed. For craft, resume into shape next; init creates project context, but it is not a substitute for the task-specific shape interview and confirmed design brief.

## Step 2: Explore the codebase

Before asking questions, thoroughly scan the project to discover what you can. This single crawl feeds PRODUCT.md **and** DESIGN.md, so be thorough once rather than re-scanning later:

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

Note what you've learned and what remains unclear. Also note any rough edges worth a follow-up command (thin hierarchy, flat or gray palette, missing error/empty states, dull copy); Step 6 turns these into concrete recommendations without re-analyzing.

## Step 3: Ask strategic questions (for PRODUCT.md)

{{ask_instruction}} Ask only about what you couldn't infer from the codebase.

### Interview mode, not confirmation mode

If the workspace is empty or the user's brief is sparse, run a short interview before proposing PRODUCT.md. Do **not** turn a one-sentence request into a complete inferred PRODUCT.md and ask for blanket confirmation.

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
  - Push for specific named references with the *specific* thing about them that fits this brand, not generic "modern" adjectives or category-bucket lanes.
- What should this explicitly NOT look like? Any anti-references?

### Accessibility & Inclusion
- Specific accessibility requirements? (WCAG level, known user needs)
- Considerations for reduced motion, color blindness, or other accommodations?

Skip questions where the answer is already clear. **Do NOT ask about colors, fonts, radii, or visual styling here.** Those belong in DESIGN.md, not PRODUCT.md.

## Step 4: Write PRODUCT.md

Write PRODUCT.md only after the user has confirmed the strategic answers from Step 3. If an inferred answer is uncertain or unconfirmed, ask before writing.

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

- **Code exists** (CSS tokens, components, a running site): "I can generate a DESIGN.md that captures your visual system (colors, typography, components) so future work stays on-brand. Want to do that now?"
- **Pre-implementation** (empty project): "I can seed a starter DESIGN.md from five quick questions about color strategy, type direction, motion energy, and references. You can re-run once there's code, to capture the real tokens. Want to do that now?"

If the user agrees, hand off to the `document` command (it auto-detects scan vs seed). Load its reference and follow that flow.

If the user prefers to skip, mention they can run the `document` command any time later.

## Step 6: Recommend starting points, then wrap up

Summarize tersely:
- Register captured (brand / product)
- What was written (PRODUCT.md, DESIGN.md, updated `.impeccable.md`, or a subset)
- The 3-5 strategic principles from PRODUCT.md that will guide future work
- If DESIGN.md is pending, one line on how to generate it later

Then recommend the **best commands to run next**, drawn from what your Step 2 crawl already surfaced. Do not run a fresh analysis here; surface observations you already have. Tailor to register and to what you saw, offer the 2-4 most relevant (not a menu dump), and name the exact toolbar command. Group by intent:

- **Build something new**: `craft <feature>` (shape, then build end-to-end) or `shape <feature>` (plan first). Lead with this for empty or early-stage projects.
- **Improve what's there**: name the specific surface. `critique <page>` for a scored UX review; `audit <area>` for a11y / perf / responsive checks; `polish <component>` for a pre-ship pass. When the crawl flagged a specific weakness, point the matching command at it: thin hierarchy or spacing → `layout`, flat or gray palette → `colorize`, missing error / empty states → `harden` or `onboard`, dull or unclear copy → `clarify`.

The full command menu lives in the viewer toolbar; keep this list short and pointed.

If init was invoked as a blocker by another command (e.g. the user ran `polish` with no PRODUCT.md), resume that original task now. Your own writes are the freshest source; no reload needed.

Optionally {{ask_instruction}} Ask whether they'd like a brief summary of PRODUCT.md appended to {{config_file}} for easier agent reference. If yes, append a short **Design Context** pointer section there.

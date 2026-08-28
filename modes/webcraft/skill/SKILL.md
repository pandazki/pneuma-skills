---
name: pneuma-webcraft
description: >
  Pneuma WebCraft Mode workspace guidelines with Impeccable.style design intelligence.
  Use for ANY web design or development task: building pages, components, layouts,
  styling, animations, responsive design, accessibility, performance optimization,
  design system extraction, UX writing, and visual refinement.
  This skill defines how the live-preview environment works, the Impeccable design
  principles to follow, and the 22 design commands available.
  Consult before your first edit in a new conversation.
---

# Pneuma WebCraft Mode — Web Design with Impeccable.style

WebCraft is a live web development surface backed by Impeccable.style design intelligence: a comprehensive set of design principles and commands that help you produce distinctive, production-grade frontend interfaces. The user watches an iframe preview render your edits in real time, and a toolbar exposes 22 Impeccable design commands for structured passes.

## Working with the viewer

The webcraft viewer is the user's window into the workspace. It renders an iframe preview of the active HTML page, exposes responsive viewport controls, the 22 Impeccable design commands, and per-page / per-content-set switching. Everything below is how you (the agent) coordinate with that surface.

### Reading what the user sees

Each user message arrives wrapped with two channels you should read before acting:

- `<viewer-context>` — the live state of the preview at send time. For webcraft this includes the active **content set** (top-level dir), the active **page** (`file="about.html"`), the **viewport** size of the responsive preview, and — when the user clicked an element in the iframe — a CSS-selector-style **Selected** path, a human-readable element description (tag, classes, accessible name), and an **`Address:`** line: a machine-readable [ViewerAddress](#vieweraddress--naming-an-object-in-the-preview) you can paste straight into a `capture` call or a `<viewer-locator>` card. Treat this as the resolution surface for "this section", "this button", "here", "make it tighter", etc.
- `<user-actions>` — discrete UI actions the user took since their last turn: page tab switches, content set switches, viewport size changes, and explicit invocations of an Impeccable design command from the toolbar (`audit`, `critique`, `polish`, …). Always check this before responding — a `command:audit` action means "do an audit", even if the chat text is just "go".

Resolve ambiguous references against `<viewer-context>` first, then fall back to asking.

### ViewerAddress — naming an object in the preview

Webcraft has **one** vocabulary for "which object in the viewer". The same
shape — a **ViewerAddress** — is what a `<viewer-locator>` card points at, what
the `capture` action screenshots, and what a `<viewer-context>` selection
reports back to you. Learn it once; it works across all three.

| Key | Half | Meaning |
|---|---|---|
| `contentSet` | coarse | Top-level directory acting as a switchable site (`pneuma`, `gazette`, `pneuma-console`). |
| `page` | coarse | HTML page filename inside the content set (`about.html`, `pricing/index.html`). |
| `selector` | fine | A CSS selector resolved inside the rendered page (`section.pricing`, `#hero .cta`). |
| `anchor` | fine | A page anchor — shorthand for an `#id` selector. |

Use only the keys you need: `{"page":"about.html"}` names a whole page;
`{"page":"about.html","selector":"section.pricing"}` names one region of it.
When the user clicks an element, the `Address:` line in `<viewer-context>`
hands you a ready-made ViewerAddress — copy that JSON straight back.

### Locator cards

After creating or editing pages, embed `<viewer-locator>` cards in your reply so the user can jump straight to the result. The card's `address` attribute is a ViewerAddress — locators navigate the user to a **page**, so use the coarse keys (`contentSet`, `page`):

```html
<viewer-locator label="Open about.html" address='{"page":"about.html"}' />
<viewer-locator label="Switch to pneuma-console" address='{"contentSet":"pneuma-console"}' />
<viewer-locator label="Switch to gazette / contact" address='{"contentSet":"gazette","page":"contact.html"}' />
```

Embed one card per landmark you want the user to verify — don't dump a wall of cards.

### Viewer actions

Webcraft exposes one agent-invocable workspace action via `POST $PNEUMA_API/api/viewer/action`:

- **`scaffold`** — Initialize the current content set with HTML pages from a structure spec. Params: `title` (required, site/project title) and `pages` (required, JSON array of `{name, title?}` for each HTML page). Honors `clearPatterns: ["**/*.html", "**/manifest.json"]` — it wipes existing pages in the target set, so always pass `contentSet` for new sites and **always confirm with the user before invoking**.

```bash
curl -X POST "$PNEUMA_API/api/viewer/action" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "scaffold",
    "params": {
      "contentSet": "studio-portfolio",
      "title": "Studio Portfolio",
      "pages": "[{\"name\":\"index.html\",\"title\":\"Home\"},{\"name\":\"work.html\",\"title\":\"Work\"},{\"name\":\"contact.html\",\"title\":\"Contact\"}]"
    }
  }'
```

The 22 Impeccable design commands (`init`, `document`, `shape`, `craft`, `audit`, `critique`, `polish`, …) are NOT viewer actions — they're toolbar commands the user invokes, surfaced to you via `<user-actions>` (see "Reading what the user sees" above and the "Impeccable Commands" section below).

### Verifying your work

The user is already watching a live iframe preview of every edit you make — you do not need to prove the page renders.

**Hard rule:** do NOT open an external browser, the chrome-devtools MCP, headless Chrome, or browser-use tooling to verify your work.

**Why:** those tools render the raw files *outside* the webcraft viewer. Webcraft pages live inside **content sets** — asset paths, `manifest.json` page tabs, and proxy routes are all resolved by the viewer at render time. Open an HTML file directly and you see broken assets and a page detached from its set. What an external browser shows is not what the user sees. The Pneuma viewer is the only faithful render.

When you genuinely need to *see* the rendered result for a "quality check → improve" loop, use the framework-level `capture` viewer action — it returns a PNG screenshot of the live viewer, exactly what the user sees:

```bash
# Full viewer
curl -s -X POST "$PNEUMA_API/api/viewer/action" \
  -H 'Content-Type: application/json' \
  -d '{"actionId":"capture"}'

# One region — pass a ViewerAddress; `selector` resolves inside the rendered page
curl -s -X POST "$PNEUMA_API/api/viewer/action" \
  -H 'Content-Type: application/json' \
  -d '{"actionId":"capture","params":{"address":{"selector":"section.hero"}}}'

# A region on another page — capture navigates there first, then shoots
curl -s -X POST "$PNEUMA_API/api/viewer/action" \
  -H 'Content-Type: application/json' \
  -d '{"actionId":"capture","params":{"address":{"page":"pricing.html","selector":"section.plans"}}}'
```

`params.address` is a [ViewerAddress](#vieweraddress--naming-an-object-in-the-preview) — omit it for a full-viewer shot. On success the response is `{"success":true,"data":{"path":"<absolute .png path>","width":<n>,"height":<n>}}`. Use your `Read` tool on that `path` to view the screenshot inline, then iterate.

### Content sets

The webcraft workspace is organized around **content sets** — each top-level directory (e.g. `pneuma/`, `gazette/`, `pneuma-console/`) is a self-contained, switchable site. The active set appears as the `content-set` attribute in `<viewer-context>`; the user can switch sets from the viewer chrome. Per-set features (page tabs, theming, export, deploy) all key off this.

Rules:

- **Don't dump files at the workspace root.** Pages, assets, and `manifest.json` live inside a content set.
- **New site → new content set.** When the user asks for a fresh site, or imports external content (uploaded files, pasted HTML, a URL to convert), create a new directory with a short descriptive name (e.g. `portfolio/`, `landing-page/`) and a `manifest.json`, then edit inside it.
- **Don't cross sets in one edit.** A single turn should operate on the active set unless the user explicitly says otherwise.

For multi-page sites, drop a `manifest.json` at the content set root so the viewer renders page tabs at the bottom:

```json
{
  "title": "My Project",
  "pages": [
    { "file": "index.html", "title": "Home" },
    { "file": "about.html", "title": "About" },
    { "file": "contact.html", "title": "Contact" }
  ]
}
```

The first entry is the default page. Keep `pages` in sync whenever you add or remove HTML files.

### Scaffold

`scaffold` is the structured way to seed a content set with empty-but-valid HTML pages from a spec. Use it when the user describes a new site by listing its pages ("a portfolio with home, work, about, contact"), rather than hand-writing each file. Two non-negotiables:

1. **Pass `contentSet`** for any new site — without it, scaffold's `clearPatterns` wipe the active set's HTML.
2. **Confirm with the user** before invoking. Show the planned `title` + `pages` list in chat first.

After scaffold returns, the viewer auto-switches to the new set; follow up with the actual design pass.

## Core Principles

1. **Go all out.** No hedging, no shortcuts. The deliverable ships complete — beautiful, responsive, fast, precise, on brand — except for assets the user must supply.
2. **Dream big and commit.** Distinct, opinionated work. When torn between refined and committed, commit.
3. **Verify in bounded passes, not a loop.** Build fully, inspect once with a batched `capture` round, fix everything it shows in one batch, confirm with at most one more round, then stop polishing. Open-ended self-QA burns the user's money doing worse what the finish review does better.
4. **Act, don't ask.** Straightforward edits just happen — the user watches each one land in the preview. Ask only when the request is genuinely ambiguous.
5. **Honor commands.** When the user invokes a command from the toolbar, follow its reference document.

## File Conventions

- The workspace contains web files (`.html`, `.css`, `.js`, `.jsx`, `.ts`, `.tsx`, `.json`, `.svg`, etc.)
- Edit existing files or create new ones as requested — the user sees updates in real time via the iframe preview
- Use modern, semantic HTML5 with proper accessibility
- Prefer CSS custom properties for theming and consistency
- Keep files organized — separate concerns when complexity warrants it
- Preserve existing structure unless asked to reorganize
- Use `Edit` for surgical changes and `Write` for new files or full rewrites; every edit should leave the file in a valid state, because the user sees it immediately

## Constraints

- Do not modify `.claude/` directory contents — managed by the runtime
- Do not run long-running background processes
- Do not ask for confirmation before simple edits — just do them

{{#imageGenEnabled}}
## Image Generation

Two scripts live under `{SKILL_PATH}/scripts/`:

- `generate_image.mjs` — text-to-image (and precise URL+mask edits via GPT-Image-2)
- `edit_image.mjs` — modify an existing local image with an optional highlighter annotation (Gemini vision via OpenRouter)

Default model is `gpt-image-2`: strong at legible typography, labels, product-shot mockups with real copy, signage, wordmarks, and diagrams with text. Switch to `--model gemini-3-pro` for painterly or broad artistic illustration, or when only `OPENROUTER_API_KEY` is configured (`gpt-image-2` is fal.ai-only and errors out otherwise).

**Generate vs. code the visual.** Geometric shapes, icons, gradients, patterns, and decorative lines are CSS / SVG / `<canvas>` work — faster, responsive, theme-aware. Generate when the asset cannot plausibly be composed from code: a photograph, a painterly illustration, a mood image, a hand-made texture, a product-shot mockup, a logo or wordmark concept. Producing the design's imagery is part of building, at the scale the composition needs — a viewport that wants atmosphere gets a full-bleed layered scene, not a library of small centered subjects standardized for tidiness.

**The image slop test.** Before you call the generator, predict how the image will read. If the honest answer is *"this looks like every AI hero image on every AI landing page from 2024"*, that is the problem. Reject your training-data defaults every time: glowing translucent orbs and neon-halo spheres on dark space; purple-to-blue or cyan-on-dark gradient grounds; abstract flowing 3D ribbons, iridescent swooshes, soap-bubble metaballs; isometric flat-vector "dashboard with colorful chart widgets" heroes; "person at laptop with floating UI elements" stock; AI-rendered people with waxy plastic skin and perfect symmetrical eyes.

**Image-led surfaces don't get to degrade into abstract panels.** Travel, editorial, portfolio, venue, product showcase, entertainment, and education work needs credible imagery when the brief calls for it. Substituting a tasteful gradient or a geometric pattern for the hero photograph a brief demands is a missing-asset defect, not a stylistic choice. Generate the image, or surface the deviation to the user before shipping.

**Prompt discipline — reinforce the direction, never contradict it.** An image has to live next to the site's typography, color system, and voice. Name the project's three brand words (the same words that drove font selection), translate them into image language (medium, palette, composition, era, physical analog), then write the prompt with those translations baked in:

- *warm and mechanical and opinionated* → "A close-up photograph of a 1970s bakelite control panel with amber tungsten indicator lamps, shallow depth of field, warm incandescent light, film-grain texture, muted earth-tone palette."
- *calm and clinical and careful* → "A soft-focus overhead photograph of a matte ceramic dish on pale linen, diffuse north-facing daylight, restrained cold-neutral palette, minimal composition."
- *handmade and a little weird* → "A Risograph-style illustration of a pair of mismatched scissors on a flat mustard-yellow ground, visible misregistration between pink and blue plates, low-fi charm."

Write palette descriptors as concrete visual references ("muted clay red, bone white, a single cold-steel accent"), never as hex codes or raw OKLCH — models respond to the former. Record your style descriptors on the first call of a series and reuse them verbatim, or a batch of images ends up looking stitched together.

**How to call it.** Run from the skill directory so `.env` is picked up:

```bash
cd {SKILL_PATH} && node scripts/generate_image.mjs \
  "Your context-matched prompt here" \
  --aspect-ratio 16:9 \
  --quality high \
  --output-format png \
  --output-dir <workspace-relative>/<content-set>/assets \
  --filename-prefix hero-context
```

`--aspect-ratio`: `16:9` above the fold, `4:3`/`3:2` for content and card thumbs, `1:1` for avatars and icon art, `9:16` for mobile-first heroes. `--quality high` for anything the user will look at (GPT-Image-2 only). `--output-format`: `png` for clean edges and legible text, `jpeg` for photographs, `webp` when size beats fidelity. `--output-dir` is always the active content set's `assets/`. `--filename-prefix` names the image's role. For edits on an already-deployed image prefer `--image-urls <url> --mask-url <url>` against `gpt-image-2`; the annotation-driven `edit_image.mjs` is for the local file + highlighter flow.

**After generating.** Reference the image semantically (`<img>` with meaningful `alt`, `<picture>` when you need art direction), `loading="lazy"` below the fold and `decoding="async"` on heroes, and a `max-width` + `aspect-ratio` in CSS so layout doesn't jump. If you produced candidates with `--num-images`, wire both up behind a comment rather than silently discarding one. Every shipping raster is worth a one-line provenance note beside it — the exact prompt for a generated image, the origin for a sourced one — so a later session can say what it is and why it exists.
{{/imageGenEnabled}}

---

## Impeccable.style Design Intelligence

This skill carries the Impeccable.style design system. It gives you the standing and the permission to produce out-of-distribution craft: production-grade code, a clear point of view, real understanding of the audience, and exceptional detail. **This core is short on purpose — depth loads on demand from `references/`.** Read the one playbook that owns the request rather than everything.

### Setup — before any design work

Do these before your first design edit in a conversation:

1. **Gather design context** (the Context Gathering Protocol below). Design work without project context is generic work; if the project has none, run the `init` command first.
2. **Load the one playbook that owns the request.** A toolbar command (or a clearly implied one) → its `references/cmd-<command>.md`. A new surface or a replacement visual world → the new-work flow in [references/cmd-craft.md](references/cmd-craft.md). Non-optional: the reference defines the flow, and skipping it skips steps the user expects.
3. **Inspect what is already true.** Read the target and at least one representative source of incumbent visual truth in the active content set — tokens, theme, CSS, a component, an asset. Required even after step 2. Don't reinvent what is there; branch out when the UX wins.
4. **Load [references/craft-floor.md](references/craft-floor.md) immediately before editing UI**, once analysis and direction are settled. It carries the quality floor, the absolute bans, and the reflexes no review catches for you. Don't load it for planning-only work.
5. **New content set with no committed brand colors?** Run `node {SKILL_PATH}/scripts/palette.mjs` for a brand seed color with mood and composition guidance, then build the palette (bg, surface, ink, accent, muted) around it in OKLCH. Committed brand colors always win — identity preservation beats a fresh seed.

### How to design

- **The brief wins.** Honor pinned aesthetics, eras, materials, fonts, and palettes even when they collide with a saturated-pattern warning in these references. Redirecting a clear brief toward your own taste is failure.
- **Refinement preserves; redesign replaces.** Refinement keeps the incumbent identity, behavior, copy, and everything outside the scope of the ask — ask before replacing factual copy or adding claims. Redesign keeps product truth, content, function, and constraints, but treats the old look as evidence and anti-reference: choose a replacement world through the new-work flow and replace `DESIGN.md`. Never split the difference into polish on a look the user asked to be rid of.
- **Visual authority is evidence, not a filename.** A missing `DESIGN.md` does not make a content set greenfield. A coherent identity already in the code is authority — document it instead of inventing a replacement.
- **Scope stays scoped.** A section, component, feature, or state inside an established surface inherits that surface. Asking to polish one button never earns a full product interview.

### Modes — what the visitor came to do

The mode names what success looks like for the visitor on **this surface**, chosen from the requested surface rather than from what the product sells. A tool's landing page is still Persuade; a fashion house's documentation is still Read; a docs index is Read, not Persuade. One workspace can hold all four.

- **Persuade:** the visitor decides and acts; design IS the product. Landing pages, marketing, campaigns, pricing. Earn attention and action. Ship real imagery when the brief needs it, and follow the committed world rather than category habit.
- **Operate:** the visitor completes a task. App UI, dashboards, editors, admin, settings, tools. Scanability, consistency, familiar affordances, and the real usage scene outrank expression; brand lives in precise details. Depth: [references/operate.md](references/operate.md).
- **Read:** the visitor understands something. Docs, articles, guides, help, changelogs. Structure for comprehension first, then make the reading experience worth staying in. Take the typography and consistency rules in [references/operate.md](references/operate.md).
- **Experience:** the visitor is inside the work itself. Portfolios, galleries, showcases. The artifact leads from the first viewport; the interface recedes.

The new-work flow in [references/cmd-craft.md](references/cmd-craft.md) turns the mode into the questions worth asking and the freedom the surface has earned.

### Context Gathering Protocol

You must have confirmed design context before doing design work — and you cannot infer it by reading the code. Code says what was built, not who it is for or how it should feel. Required at minimum: **who** the audience is and in what context, **what jobs** they are trying to get done, and **how the interface should feel**.

Gathering order:

1. **Current instructions (instant).** A **Design Context** section already in `CLAUDE.md` → proceed.
2. **`PRODUCT.md` (fast).** Read `PRODUCT.md` from the project root, plus `DESIGN.md` when present; `.impeccable.md` is the accepted legacy single-file equivalent. Beyond audience and jobs, `PRODUCT.md` carries **positioning** (what this sits alongside and how it differs), **evidence on hand** (the proof, content, and assets that actually exist), and **brand commitments** (what may never change). If it holds the required context, proceed.
3. **Run `init` (required).** If neither source has context, run the `init` command now, before anything else (reference: [cmd-init](references/cmd-init.md)). Do not skip it, and do not substitute inference from the codebase.

### Surface briefs — a page remembers its strategy

When work settles durable strategy for one page, write it to `.impeccable/surfaces/<page-slug>.md` with the `Write` tool, and read that file back before you touch the page again. Keep it small: scope and visitor mode; audience, job, action, proof or content, constraints; the chosen direction and its memorable moment; what is still open. Never copy global product truth or `DESIGN.md` tokens into it. The point is that a later session continues this page's argument instead of inventing a new one.

### Drift — report it once, never repair it as a side quest

A project set up under an older version carries answers this one no longer reads: a `PRODUCT.md` with a `register:` field (the brand/product split the four modes replaced), a `DESIGN.md` older than the pages it claims to describe, a surface brief for a page that no longer exists. Say so once, in one line, then continue with the work the user actually asked for. Repairing that drift is a conversation (`init` or `document`), not a side effect of a design task.

---

## Impeccable Commands

The user invokes these from the viewer toolbar. When a command is invoked, follow its reference document.

### Setup
- **init** — Set up project context: gather product truth, write `PRODUCT.md` (or update a legacy `.impeccable.md`), recommend next steps. It never writes or offers `DESIGN.md` — `document` records that. `teach` is a deprecated alias — treat a `teach` invocation exactly as `init`. Reference: [cmd-init](references/cmd-init.md)
- **document** — Generate a `DESIGN.md` at the project root from the built pages, capturing the visual system that actually shipped so future sessions stay on-brand. Reference: [cmd-document](references/cmd-document.md)

### Plan
- **shape** — Run a discovery interview and produce a design brief before any code is written. Reference: [cmd-shape](references/cmd-shape.md)
- **craft** — New visual work: decide the job kind and the freedom it earns, settle the direction, write the intent contract, build, and finish. Also the flow for any "build me a page / redesign this" request, whether or not the command was invoked. Reference: [cmd-craft](references/cmd-craft.md)

### Review
- **audit** — Comprehensive quality audit across accessibility, performance, theming, and responsive design. Reference: [cmd-audit](references/cmd-audit.md)
- **critique** — Holistic UX design critique evaluating hierarchy, architecture, and emotional resonance. Reference: [cmd-critique](references/cmd-critique.md)

### Refine
- **polish** — Final quality pass aligning the feature to the design system — fixes spacing, consistency, and drift before shipping. Reference: [cmd-polish](references/cmd-polish.md)
- **distill** — Strip design to its essence by removing unnecessary complexity. Reference: [cmd-distill](references/cmd-distill.md)
- **clarify** — Improve unclear UX copy, error messages, labels, and instructions. Reference: [cmd-clarify](references/cmd-clarify.md)
- **typeset** — Improve typography: font selection, modular scale, weight, rhythm, and readability. Reference: [cmd-typeset](references/cmd-typeset.md)
- **layout** — Improve layout, spacing, and visual rhythm — fix monotonous grids and weak hierarchy. Reference: [cmd-layout](references/cmd-layout.md)

### Performance
- **optimize** — Improve performance across loading, rendering, animations, and bundle size. Reference: [cmd-optimize](references/cmd-optimize.md)
- **harden** — Make interfaces production-ready: error handling, empty states, onboarding flows, i18n, text overflow, and edge cases. Reference: [cmd-harden](references/cmd-harden.md)
- **onboard** — Design first-run flows, empty states, and activation moments that get users to value quickly. Reference: [cmd-onboard](references/cmd-onboard.md)

### Style
- **animate** — Add purposeful animations, micro-interactions, and motion effects. Reference: [cmd-animate](references/cmd-animate.md)
- **colorize** — Add strategic color to monochromatic or visually flat interfaces. Reference: [cmd-colorize](references/cmd-colorize.md)
- **bolder** — Amplify safe or boring designs by making the existing design language more decisive — inside the design system when one exists. Reference: [cmd-bolder](references/cmd-bolder.md)
- **quieter** — Tone down overly bold or aggressive designs to be more refined. Reference: [cmd-quieter](references/cmd-quieter.md)
- **delight** — Add moments of joy, personality, and unexpected polish. Reference: [cmd-delight](references/cmd-delight.md)
- **overdrive** — Push interfaces past conventional limits with technically ambitious implementations (shaders, spring physics, scroll-driven animations, virtual scrolling). Reference: [cmd-overdrive](references/cmd-overdrive.md)

### Architecture
- **extract** — Extract reusable components, design tokens, and patterns into a design system. Reference: [cmd-extract](references/cmd-extract.md)
- **adapt** — Adapt designs for different screen sizes, devices, contexts, or platforms. Reference: [cmd-adapt](references/cmd-adapt.md)

### Routing

1. **Toolbar invocation** (`command:X` in `<user-actions>`): load that command's reference and follow it. The chat text, if any, is the target.
2. **Typed command name**: if the first word of a message matches a command above (including the deprecated `teach` → `init` alias), treat it as an invocation; everything after it is the target.
3. **Clear intent, no command named**: when a request maps cleanly onto one command ("fix the spacing" → `layout`, "rewrite this error message" → `clarify`, "the colors feel flat" → `colorize`), load that reference and proceed as if invoked. If two fit, ask once which.
4. **New visual work, however it is phrased** ("build a landing page", "add a pricing section", "redesign this"): follow [cmd-craft](references/cmd-craft.md). It opens by naming the job kind, because each one earns a different amount of freedom — a blank slate derives a whole world; a new page inside an existing product keeps the world fixed and decides only its structure; a section added to a working page inherits everything and decides only what it introduces; a redesign treats the old look as evidence and replaces it; a scoped refinement stays inside the ask. Getting this wrong in either direction is the classic failure: restyling a product around a new section, or polishing the look the user asked you to discard.
5. **No clear match**: general design work. Apply Setup, the visitor mode, and the craft floor, with the request as context.

Missing `PRODUCT.md` routes new work through `init` first. A narrow refinement of existing code proceeds on the incumbent implementation and offers `init` afterwards rather than blocking on it.

### Command Execution Notes

When the user invokes a command:

1. Read the corresponding reference document for detailed instructions
2. In the reference, replace `{{ask_instruction}}` with: STOP and ask the user using a normal message
3. In the reference, replace `{{config_file}}` with: CLAUDE.md
4. In the reference, replace `{{model}}` with: Claude
5. In the reference, replace `{{available_commands}}` with the list of 22 commands above
6. References may point to "this skill" or to `references/*.md` files. Both live in the pneuma-webcraft skill — consult them directly; no separate `impeccable` skill needs to be invoked. [references/interaction-design.md](references/interaction-design.md) carries the forms, focus, and loading-pattern depth that the command references assume.
7. Follow the reference instructions step by step
8. Apply changes directly to the workspace files — the user sees results in real time

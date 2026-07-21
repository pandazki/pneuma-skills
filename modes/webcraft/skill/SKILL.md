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

1. **Act, don't ask**: For straightforward edits, just do them. Only ask for clarification on ambiguous requests
2. **Incremental edits**: Make focused changes — the user sees each edit live as you make it
3. **Design with intention**: Every visual choice should be deliberate. Avoid generic "AI slop" aesthetics
4. **Quality over speed**: Production-grade code with exceptional attention to aesthetic details
5. **Follow Impeccable.style**: avoid AI slop aesthetics, commit to bold design directions
6. **Honor commands**: when the user invokes an Impeccable command (audit, critique, polish, etc.), follow the corresponding command reference

## File Conventions

- The workspace contains web files (`.html`, `.css`, `.js`, `.jsx`, `.ts`, `.tsx`, `.json`, `.svg`, etc.)
- Edit existing files or create new ones as requested — the user sees updates in real-time via iframe preview
- Use modern, semantic HTML5 with proper accessibility
- Prefer CSS custom properties for theming and consistency
- Keep files organized — separate concerns when complexity warrants it
- Preserve existing structure unless asked to reorganize

{{#imageGenEnabled}}
## Image Generation

Two scripts live under `{SKILL_PATH}/scripts/`:
- `generate_image.mjs` — text-to-image (and precise URL+mask edits via GPT-Image-2)
- `edit_image.mjs` — modify an existing local image with an optional highlighter annotation (Gemini vision via OpenRouter)

Default model is `gpt-image-2`. It is especially strong at the things webcraft reaches for often: legible typography, labels, landing-page mockups with real copy, signage, wordmark-style logos, and diagrams with text. Switch to `--model gemini-3-pro` for painterly / watercolor / broad artistic illustration, or when only `OPENROUTER_API_KEY` is configured (`gpt-image-2` is fal.ai-only and will error out otherwise).

### When to Generate vs. Code Visuals

Webcraft can render many things with HTML/CSS/SVG. Generate an image **only when the asset can't plausibly be composed from code**:

| Want | Use |
|---|---|
| Geometric shapes, icons, gradients, patterns, decorative lines | CSS / SVG / `<canvas>` — faster, responsive, theme-aware |
| A photograph, a painterly illustration, a mood image, a hand-made texture | Generate |
| A product-shot mockup (phone, laptop, poster) with real copy on screen | Generate (`gpt-image-2` — it renders legible text) |
| A logo or wordmark concept to iterate on | Generate with clear typography + mark direction |
| "Hero abstract 3D gradient swoosh thing" | **Stop.** See the Image Slop Test below. |

### The Image Slop Test

You already know the AI Slop Test for design — the same reflex applies to imagery. Before you call the generator, predict how the image will read. If the honest answer is *"this looks like every AI hero image on every AI landing page from 2024"*, that's the problem.

Reflex images to reject — your training-data defaults:
- Glowing translucent orbs, neon-halo spheres, "data crystal" shapes floating on dark space
- Purple-to-blue / cyan-on-dark gradient backgrounds
- Abstract flowing 3D ribbons, iridescent swooshes, soap-bubble metaballs
- Isometric flat-vector "dashboard with colorful chart widgets" hero illustrations
- Generic "person at laptop with floating UI elements" stock images
- AI-rendered people with that waxy plastic skin + perfect symmetrical eyes look

These are the visual equivalent of the `reflex_fonts_to_reject` list. Reject them every time. Look further.

**Image-led surfaces don't get to degrade into abstract panels.** Travel, editorial, portfolio, venue, product showcase, entertainment, and education work needs credible imagery — generated plates, illustrations, maps, renders, destination scenes — when the approved mock or subject matter calls for them. Substituting a tasteful gradient or geometric pattern for the hero photograph a brief actually demands is a missing-asset defect, not a stylistic choice. Generate the image, or surface the deviation to the user before shipping.

### Prompt Discipline: Reinforce, Don't Contradict, the Design Direction

An image in a webcraft project has to live next to the site's typography, color system, and voice. If the site is a brutalist concrete manifesto and the hero image is a pastel unicorn, you've failed. Before typing the prompt:

1. **Read `PRODUCT.md` / `.impeccable.md` / CLAUDE.md Design Context** (tone, audience, brand personality). If none exists, run the `init` command first — same rule as any other design work.
2. **Name the project's 3 brand words** (same words you used for font selection) — e.g. "warm and mechanical and opinionated".
3. **Translate them into image language** — medium, palette, composition, era, physical analog.
4. **Write the prompt** with those translations baked in. Examples:
   - *warm and mechanical and opinionated* → "A close-up photograph of a 1970s bakelite control panel with amber tungsten indicator lamps, shallow depth of field, warm incandescent light, film-grain texture, muted earth-tone palette."
   - *calm and clinical and careful* → "A soft-focus overhead photograph of a matte ceramic dish on pale linen, diffuse north-facing daylight, restrained cold-neutral palette (pale stone, off-white, a single shadow), minimal composition."
   - *handmade and a little weird* → "A Risograph-style illustration of a pair of mismatched scissors floating on a flat mustard-yellow ground, visible misregistration between pink and blue plates, low-fi charm."

### Palette Matching

Match the image's palette to the site's theme. Write palette descriptors in prompts using concrete visual references rather than hex codes — models respond better to "muted clay red, bone white, a single cold-steel accent" than to `oklch(0.55 0.15 30)`. If the site uses OKLCH custom properties, paraphrase them for the prompt, don't paste them in.

### How to Call It

Most text-to-image calls look like this. Run from the skill's directory so `.env` is picked up:

```bash
cd {SKILL_PATH} && node scripts/generate_image.mjs \
  "Your context-matched prompt here" \
  --aspect-ratio 16:9 \
  --quality high \
  --output-format png \
  --output-dir <workspace-relative>/<content-set>/assets \
  --filename-prefix hero-context
```

Webcraft-specific flag guidance:

| Flag | Guidance |
|---|---|
| `--model` | Default `gpt-image-2`. Switch to `--model gemini-3-pro` for painterly / watercolor / broad artistic illustration, or when only OpenRouter is configured. |
| `--aspect-ratio` | `16:9` for hero banners above the fold, `4:3` or `3:2` for content images and card thumbs, `1:1` for avatars and icon-sized art, `9:16` for mobile-first hero or vertical feature images. |
| `--quality` | `high` for anything the user will actually look at; drop to `medium` for draft passes while iterating prompts. GPT-Image-2 only. |
| `--output-format` | `png` for illustrations or anything needing clean edges and legible text; `jpeg` for photographs; `webp` when size matters more than max fidelity. |
| `--output-dir` | Always the active content set's `assets/` directory. |
| `--filename-prefix` | Describe the image's role: `hero-context-lab`, `about-team-portrait`, `logo-wordmark-v1`. |

For edits on an already-deployed / uploaded image, prefer `--image-urls <url> --mask-url <url>` against `gpt-image-2` — it respects text and layout much better than Gemini vision. The annotation-driven `edit_image.mjs` is for the *local file + highlighter* flow (takes `--input <path>` and optional `--annotation <path>`).

### After Generating

- Reference the image with a semantic element (`<img>` with meaningful `alt`, or `<picture>` when you need art direction across breakpoints).
- Add `loading="lazy"` for anything below the fold; add `decoding="async"` to hero images.
- Give the image a sensible `max-width` and `aspect-ratio` in CSS so layout doesn't jump while it loads.
- If you produced 2+ candidates (via `--num-images`), wire both up behind a comment so the user can pick — don't silently discard.

### Consistency Across a Series

When generating multiple images for one site (hero + about + feature cards), record your style descriptors on the first call and reuse them verbatim on subsequent calls. The viewer lives next to the prompts; drifting midway through a batch is how decks start looking stitched-together.
{{/imageGenEnabled}}

---

## Editing Guidelines

- Use the `Edit` tool (preferred) for surgical changes to existing content
- Use the `Write` tool for creating new files or full rewrites
- Make focused, incremental edits — the user sees changes live, so each edit should leave files in a valid state
- Preserve existing content structure unless asked to reorganize

## Constraints

- Do not modify `.claude/` directory contents — managed by the runtime
- Do not run long-running background processes
- Do not ask for confirmation before simple edits — just do them

---

## Impeccable.style Design Intelligence

This skill integrates the Impeccable.style design system. Follow these principles for ALL frontend work: produce ready-to-ship, production-grade code, not prototypes or starting points. Take no shortcuts unless the user asks for them (when in doubt, ask). Don't stop until arriving at a complete implementation (beautiful, responsive, fast, precise, bug-free, on brand). Claude is capable of extraordinary work. Don't hold back.

### Setup — before any design work

You MUST do these steps before your first design edit in a conversation:

1. **Gather design context** (the Context Gathering Protocol below). Design commands produce generic output without project context; if none exists, run the `init` command first.
2. **If a command was invoked** (from the toolbar via `<user-actions>`, or by clear intent), read its `references/cmd-<command>.md` next. Non-optional. The reference defines the command's flow; without it you will skip steps the user expects.
3. **Familiarize yourself with any existing design system, conventions, and components** in the active content set. Read at least one project file (CSS / tokens / theme / a representative page). Required even when you've loaded a command reference in step 2. Don't reinvent the wheel; use what's there when it works, branch out when the UX wins.
4. **Read the matching register reference.** This is non-optional; skipping it produces generic output. If the project is marketing, a landing page, a campaign, long-form content, or a portfolio (design IS the product), read [references/brand.md](references/brand.md). If it is app UI, admin, a dashboard, or a tool (design SERVES the product), read [references/product.md](references/product.md). Pick by first match: (1) task cue ("landing page" vs "dashboard"); (2) surface in focus; (3) `register` field in PRODUCT.md / `.impeccable.md`.
5. **If the project is brand-new** (no existing CSS tokens / theme / committed brand colors found in step 3), run `node {SKILL_PATH}/scripts/palette.mjs` to receive a brand seed color and composition guidance. This is the anchor for your primary brand color. Compose the rest of the palette (bg, surface, ink, accent, muted) around it per the script's instructions. Use OKLCH throughout. **Skip this step only if step 3 found committed brand colors in existing tokens; in that case identity-preservation wins.**

### Context Gathering Protocol

Design skills produce generic output without project context. You MUST have confirmed design context before doing any design work.

**Required context** — every design command needs at minimum:
- **Target audience**: Who uses this product and in what context?
- **Use cases**: What jobs are they trying to get done?
- **Brand personality/tone**: How should the interface feel?

**CRITICAL**: You cannot infer this context by reading the codebase. Code tells you what was built, not who it's for or what it should feel like. Only the creator can provide this context.

**Gathering order:**
1. **Check current instructions (instant)**: If `CLAUDE.md` already contains a **Design Context** section, proceed immediately.
2. **Check PRODUCT.md / .impeccable.md (fast)**: If not in instructions, read `PRODUCT.md` (and `DESIGN.md` when present) from the project root; `.impeccable.md` is the accepted legacy single-file equivalent. If either exists and contains the required context, proceed.
3. **Run the `init` command (REQUIRED)**: If neither source has context, you MUST run the `init` command NOW before doing anything else (reference: [cmd-init](references/cmd-init.md)). Do NOT skip this step. Do NOT attempt to infer context from the codebase instead.

### Register: brand vs product

Every design task is one of two registers — identify before designing:

- **Brand** — design IS the product. Marketing sites, landing pages, campaign pages, portfolios, long-form content. The visitor's impression IS the deliverable. Distinctive, opinionated, willing to risk strangeness. → consult [references/brand.md](references/brand.md).
- **Product** — design SERVES the product. App UI, dashboards, settings panels, data tables, anything where the user is in a task. Earned familiarity beats novelty; the tool should disappear into the work. → consult [references/product.md](references/product.md).

The shared rules below apply to both registers; the register reference adjusts the dial.

### General rules

Existing project? Preserving its identity wins over imposing a fresh look: read its tokens, theme, and components first and work within them. New project? The rules below plus the "New projects only" section end the cold-start drift toward the same safe choices every time.

#### Color

- **Verify contrast.** Body text must hit ≥4.5:1 against its background; large text (≥18px or bold ≥14px) needs ≥3:1. Placeholder text needs the same 4.5:1, not the muted-gray default. The most common failure: muted gray body text on a tinted near-white. If the contrast is even close, bump the body color toward the ink end of the ramp; light gray "for elegance" is the single biggest reason AI designs feel hard to read.
- Gray text on a colored background looks washed out. Use a darker shade of the background's own hue, or a transparency of the text color.

#### Typography

- Cap body line length at 65–75ch.
- Don't pair fonts that are similar but not identical (two geometric sans-serifs, two humanist sans-serifs). Pair on a contrast axis (serif + sans, geometric + humanist) or use one family in multiple weights.
- Hero / display heading ceiling: clamp() max ≤ 6rem (~96px). Above that the page is shouting, not designing.
- Display heading letter-spacing floor: ≥ -0.04em. Anything tighter and letters touch; cramped, not "designed". -0.02 to -0.03em is plenty for tight grotesque display.
- Use `text-wrap: balance` on h1–h3 for even line lengths; `text-wrap: pretty` on long prose to reduce orphans.
- No more than three font families on a page. Beyond that is noise, not voice.

#### Layout

- Vary spacing for rhythm.
- Cards are the lazy answer. Use them only when they're truly the best affordance. Nested cards are always wrong.
- Flexbox for 1D, Grid for 2D. Don't default to Grid when `flex-wrap` would be simpler.
- For responsive grids without breakpoints: `repeat(auto-fit, minmax(280px, 1fr))`.
- Build a semantic z-index scale (dropdown → sticky → modal-backdrop → modal → toast → tooltip). Never arbitrary values like 999 or 9999.

#### Motion

- Motion should be intentional, not an afterthought. Consider it part of the build.
- Don't animate CSS layout properties unless truly needed.
- Ease out with exponential curves (ease-out-quart / quint / expo). No bounce, no elastic.
- Use libraries for more advanced motion needs (e.g. motion, gsap, anime.js, lenis).
- Reduced motion is not optional. Every animation needs a `@media (prefers-reduced-motion: reduce)` alternative: typically a crossfade or instant transition.
- Staggering the items within one list is legitimate. The tell is the uniform reflex (one identical entrance applied to every section), not motion itself; each reveal should fit what it reveals. Suppressing the reflex is never a reason to ship a page with no motion at all.
- Reveal animations must enhance an already-visible default. Don't gate content visibility on a class-triggered transition; transitions pause on hidden tabs and headless renderers, so the reveal never fires and the section ships blank.
- Premium motion materials are not just transform/opacity. Blur, backdrop-filter, clip-path, mask, and shadow/glow are part of the palette when they materially improve the effect and stay smooth.

#### Interaction

- Dropdowns rendered with `position: absolute` inside an `overflow: hidden` or `overflow: auto` container will be clipped. Use the native `<dialog>` / popover API, `position: fixed`, or a portal to escape the stacking context.
- Never animate `<img>` elements on hover — no `transform` on `:hover` of an image, and no parent-hover patterns that scale/rotate/translate a child image. It adds no information (the image isn't an action target) and reads as "AI animated this because it could". If a card needs hover feedback, animate the card's background, border, or shadow.

#### Copy

- Every word earns its place. No restated headings, no intros that repeat the title.
- Don't lean on em dashes. Use commas, colons, semicolons, periods, or parentheses. Also not `--`.
- No marketing buzzwords ("seamless", "effortless", "supercharge") and no aphoristic-cadence copy (short punchy sentence triads that sound profound and say nothing).
- No meta-criticism theater: naming a concept then layering an ironic modifier, or staging a strawman to "correct" it. Make the specific claim instead.

### New projects only (when no prior work exists)

#### Color & Theme

- Use OKLCH.
- **The cream / sand / beige body bg is the saturated AI default of 2026.** The whole warm-neutral band (OKLCH L 0.84-0.97, C < 0.06, hue 40-100) reads as cream/sand/paper/parchment regardless of what you call it. Token names like `--paper`, `--cream`, `--sand`, `--bone`, `--linen`, `--parchment`, `--ivory` are tells in themselves. If the brief is "warm, traditional" or "magazine-warm" or "editorial-restraint", DO NOT translate that into a near-white warm-tinted bg; that's the AI move. Pick: (a) a saturated brand color as the body (terracotta, oxblood, deep ochre, near-black), (b) a true off-white at chroma 0 (or chroma toward the brand's own hue, not toward warmth-by-default), or (c) a darker mid-tone tinted neutral that's clearly the brand's own. "Warmth" in the brand is carried by accent + typography + imagery, not by body bg.
- Tinted neutrals: add 0.005–0.015 chroma toward the brand's hue. Don't default-tint toward warm or cool "because the brand feels that way"; that's the cross-project monoculture move.
- When picking a theme: dark vs. light is never a default. Not dark "because tools look cool dark." Not light "to be safe." Before choosing, write one sentence of physical scene: who uses this, where, under what ambient light, in what mood. If the sentence doesn't force the answer, it's not concrete enough. Add detail until it does.
- Pick a **color strategy** before picking colors. Four steps on the commitment axis:
  - **Restrained**: tinted neutrals + one accent ≤10%. Product default; brand minimalism.
  - **Committed**: one saturated color carries 30–60% of the surface. Brand default for identity-driven pages.
  - **Full palette**: 3–4 named roles, each used deliberately. Brand campaigns; product data viz.
  - **Drenched**: the surface IS the color. Brand heroes, campaign pages.

### Absolute bans

Match-and-refuse. If you're about to write any of these, rewrite the element with different structure.

- **Side-stripe borders.** `border-left` or `border-right` greater than 1px as a colored accent on cards, list items, callouts, or alerts — hard-coded colors AND CSS variables alike. Never intentional. Rewrite with full borders, background tints, leading numbers/icons, or nothing. Do not just swap to box-shadow inset.
- **Gradient text.** `background-clip: text` combined with a gradient background. Decorative, never meaningful. Use a single solid color. Emphasis via weight or size.
- **Glassmorphism as default.** Blurs and glass cards used decoratively. Rare and purposeful, or nothing.
- **The hero-metric template.** Big number, small label, supporting stats, gradient accent. SaaS cliché.
- **Identical card grids.** Same-sized cards with icon + heading + text, repeated endlessly.
- **Tiny uppercase tracked eyebrow above every section.** The 2023-era kicker (small all-caps text with wide tracking, "ABOUT" "PROCESS" "PRICING" above each heading, including the pill-chip variant with a 999px border-radius) is the saturated AI scaffold; it appears on most generations regardless of brief, which is the definition of a tell. One named kicker as a deliberate brand system is voice; an eyebrow on every section is AI grammar. Choose a different cadence.
- **Numbered section markers as default scaffolding (01 / 02 / 03).** Putting `01 · About / 02 · Process / 03 · Pricing` above every section is the eyebrow trope one tier deeper: reach for it because "landing pages do this" and you're scaffolding by reflex. Numbers earn their place when the section actually IS a sequence and the order carries information the reader needs. One deliberate numbered sequence on one page is voice; numbered eyebrows on every section across the site is AI grammar.
- **Text that overflows its container.** Long heading words plus large clamp scales plus narrow grids cause headline overflow on tablet/mobile. Test the heading copy at every breakpoint; if it overflows, reduce the clamp max or rewrite the copy. The viewport is part of the design. Body text never runs to the absolute viewport edge either — wrap content in a container with horizontal padding.
- **Modal as first thought.** Modals are usually laziness. Exhaust inline / progressive alternatives first.

**Model-tell bans** — frequent giveaways of specific code models; refuse-and-rewrite regardless of which model you are:

- **The ghost card**: `border: 1px solid X` + `box-shadow: 0 Npx Mpx ...` with blur ≥ 16px on the same element. Don't pair a 1px border with a soft wide drop shadow as decoration. Pick one (a single solid border at the brand color, OR a defined shadow at no more than 8px blur), never both.
- **Over-rounding**: `border-radius: 32px+` on cards / sections / inputs. Cards top out at 12–16px; full-pill is fine for tags/buttons. 24/28/32/40px radii on a card read as "insanely rounded", and no brand wants that.
- **Hand-drawn / sketchy SVG illustrations**: class names like `loose-sketch`, `doodle`, `wavy`; `feTurbulence` / `feDisplacementMap` "paper grain" filters; crude 5-to-30-path scenes meant to depict a tangible subject. These read as amateurish, not whimsical. If you can't render the scene with real assets, ship no illustration.
- **`repeating-linear-gradient(...)` stripe backgrounds**: diagonal stripes in `body:before` or section backgrounds are pure decoration. Don't.
- **Decorative grid backgrounds**: two-axis CSS grid overlays built from `linear-gradient(... 1px, transparent 1px)` plus `background-size` are a tell unless the surface is an actual canvas, map, blueprint, or measurement tool. Use product structure, real artifacts, or a plain surface instead.

### The AI Slop Test

**Critical quality check**: If someone could look at this interface and say "AI made that" without doubt, it's failed. If you showed it to someone and asked "which AI made this?", the honest answer should be "none — a designer did." Cross-register failures are the absolute bans above. Register-specific failures live in the register references.

**Category-reflex check.** Run at two altitudes; the second one catches what the first one misses.

- **First-order:** if someone could guess the theme + palette from the category alone ("observability → dark blue", "healthcare → white + teal", "finance → navy + gold", "crypto → neon on black"), it's the first training-data reflex. Rework the scene sentence and color strategy until the answer isn't obvious from the domain.
- **Second-order:** if someone could guess the aesthetic family from category-plus-anti-references ("AI workflow tool that's not SaaS-cream → editorial-typographic", "fintech that's not navy-and-gold → terminal-native dark mode"), it's the trap one tier deeper. The first reflex was avoided; the second wasn't. Rework until both answers are not obvious. The brand register's reflex-reject aesthetic lanes list ([references/brand.md](references/brand.md)) catches the currently-saturated families.

### Implementation Principles

Match implementation complexity to the aesthetic vision. Maximalist designs need elaborate code with extensive animations and effects. Minimalist or refined designs need restraint, precision, and careful attention to spacing, typography, and subtle details.

Interpret creatively and make unexpected choices that feel genuinely designed for the context. No design should be the same. Vary between light and dark themes, different fonts, different aesthetics. NEVER converge on common choices across generations.

---

## Impeccable Commands

The user invokes these commands from the toolbar. When a command is invoked, follow the corresponding reference document. The available commands are:

### Setup
- **init** — Set up project context: gather design context, write `PRODUCT.md` (or legacy `.impeccable.md`), offer `DESIGN.md`, recommend next steps. `teach` is a deprecated alias — treat a `teach` invocation exactly as `init`. Reference: [cmd-init](references/cmd-init.md)
- **document** — Generate a `DESIGN.md` at the project root capturing the current visual design system, so future agents stay on-brand. Reference: [cmd-document](references/cmd-document.md)

### Plan
- **shape** — Run a discovery interview and produce a design brief before any code is written. Reference: [cmd-shape](references/cmd-shape.md)
- **craft** — Shape-then-build: run the discovery flow, then implement the feature in one pass. Reference: [cmd-craft](references/cmd-craft.md)

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

1. **Toolbar invocation** (`command:X` in `<user-actions>`): load the command's reference file and follow it. The chat text (if any) is the target.
2. **Typed command name**: if the first word of a message matches a command above (including the deprecated `teach` → `init` alias), treat it as an invocation; everything after it is the target.
3. **Clear intent, no command named**: when a request clearly maps to one command ("fix the spacing" → `layout`, "rewrite this error message" → `clarify`, "the colors feel flat" → `colorize`), load that command's reference and proceed as if invoked. If two commands could fit, ask once which.
4. **No clear match**: general design work. Apply Setup, the General rules, and the loaded register reference, using the request as context.

### Command Execution Notes

When the user invokes a command:
1. Read the corresponding reference document for detailed instructions
2. In the reference, replace `{{ask_instruction}}` with: STOP and ask the user using a normal message
3. In the reference, replace `{{config_file}}` with: CLAUDE.md
4. In the reference, replace `{{model}}` with: Claude
5. In the reference, replace `{{available_commands}}` with the list of 22 commands above
6. References may point to "this skill" or to `references/*.md` files. Both live in the pneuma-webcraft skill — consult them directly, no separate `impeccable` skill needs to be invoked. Deep topic material lives inline in the command references themselves (each has a "Reference Material" section); [references/interaction-design.md](references/interaction-design.md) covers forms, focus, and loading patterns.
7. Follow the reference instructions step by step
8. Apply changes directly to the workspace files — the user sees results in real-time
